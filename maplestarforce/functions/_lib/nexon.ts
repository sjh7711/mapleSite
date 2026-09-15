export const NEXON_API_BASE = "https://open.api.nexon.com/maplestory/v1";

const MAX_RETRY_DELAY_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const REQUEST_INTERVAL_MS = 275;
// Workers는 한 요청에서 동시에 6개의 outbound connection을 허용한다.
// 길드 조회와 재시도 여유를 남기고 공개 캐릭터 스냅샷만 최대 4개 겹친다.
const CHARACTER_FETCH_CONCURRENCY = 4;
const CHARACTER_SKILL_GRADES = [
  "0",
  "1",
  "1.5",
  "2",
  "2.5",
  "3",
  "4",
  "5",
  "6",
  "hyperpassive",
  "hyperactive",
] as const;
export const CHARACTER_SKILL_SNAPSHOT_COUNT = CHARACTER_SKILL_GRADES.length;

export type JsonObject = Record<string, unknown>;

type QueryValue = string | number;

type EndpointDefinition = {
  path: string;
  allowedParameters: readonly string[];
};

export const NEXON_ENDPOINTS = Object.freeze({
  characterId: {
    path: "/id",
    allowedParameters: ["character_name"],
  },
  basic: {
    path: "/character/basic",
    allowedParameters: ["ocid"],
  },
  stat: {
    path: "/character/stat",
    allowedParameters: ["ocid"],
  },
  equipment: {
    path: "/character/item-equipment",
    allowedParameters: ["ocid"],
  },
  cashEquipment: {
    path: "/character/cashitem-equipment",
    allowedParameters: ["ocid"],
  },
  petEquipment: {
    path: "/character/pet-equipment",
    allowedParameters: ["ocid"],
  },
  setEffect: {
    path: "/character/set-effect",
    allowedParameters: ["ocid"],
  },
  otherStat: {
    path: "/character/other-stat",
    allowedParameters: ["ocid"],
  },
  linkSkill: {
    path: "/character/link-skill",
    allowedParameters: ["ocid"],
  },
  skill: {
    path: "/character/skill",
    allowedParameters: ["ocid", "character_skill_grade"],
  },
  symbol: {
    path: "/character/symbol-equipment",
    allowedParameters: ["ocid"],
  },
  hyperStat: {
    path: "/character/hyper-stat",
    allowedParameters: ["ocid"],
  },
  hexaStat: {
    path: "/character/hexamatrix-stat",
    allowedParameters: ["ocid"],
  },
  hexaMatrix: {
    path: "/character/hexamatrix",
    allowedParameters: ["ocid"],
  },
  vMatrix: {
    path: "/character/vmatrix",
    allowedParameters: ["ocid"],
  },
  ability: {
    path: "/character/ability",
    allowedParameters: ["ocid"],
  },
  unionRaider: {
    path: "/user/union-raider",
    allowedParameters: ["ocid"],
  },
  unionArtifact: {
    path: "/user/union-artifact",
    allowedParameters: ["ocid"],
  },
  unionChampion: {
    path: "/user/union-champion",
    allowedParameters: ["ocid"],
  },
  ringReserve: {
    path: "/character/ring-reserve-skill-equipment",
    allowedParameters: ["ocid"],
  },
  guildId: {
    path: "/guild/id",
    allowedParameters: ["guild_name", "world_name"],
  },
  guildBasic: {
    path: "/guild/basic",
    allowedParameters: ["oguild_id"],
  },
} satisfies Record<string, EndpointDefinition>);

export type NexonEndpointKey = keyof typeof NEXON_ENDPOINTS;
export type NexonErrorKind =
  | "configuration"
  | "network"
  | "timeout"
  | "rate_limited"
  | "unauthorized"
  | "not_found"
  | "upstream"
  | "malformed_response";

export class NexonApiError extends Error {
  readonly kind: NexonErrorKind;
  readonly endpoint: NexonEndpointKey;
  readonly upstreamStatus?: number;

  constructor(
    kind: NexonErrorKind,
    endpoint: NexonEndpointKey,
    upstreamStatus?: number,
  ) {
    super(`NEXON API request failed: ${kind} (${endpoint})`);
    this.name = "NexonApiError";
    this.kind = kind;
    this.endpoint = endpoint;
    this.upstreamStatus = upstreamStatus;
  }
}

export type Sleep = (milliseconds: number) => Promise<void>;

export type NexonRequestDependencies = {
  fetchImpl?: typeof fetch;
  sleep?: Sleep;
  timeoutMs?: number;
  // A scheduler may hold its next slot until the returned release callback is
  // invoked immediately after fetch() has actually been called.
  beforeRequest?: () => Promise<void | (() => void)>;
};

export type CharacterPotentialSnapshot = {
  statData: JsonObject;
  equipmentData: JsonObject;
  cashEquipmentData: JsonObject;
  petEquipmentData: JsonObject;
  setEffectData: JsonObject;
  otherStatData: JsonObject;
  linkSkillData: JsonObject;
  skillData: JsonObject[];
  symbolData: JsonObject;
  hyperStatData: JsonObject;
  hexaStatData: JsonObject;
  hexaMatrixData: JsonObject;
  vMatrixData: JsonObject;
  abilityData: JsonObject;
  unionRaiderData: JsonObject;
  unionArtifactData: JsonObject;
  unionChampionData: JsonObject;
  ringReserveData: JsonObject;
  guildData: JsonObject;
};

export type CharacterPotentialData = {
  character: JsonObject;
  snapshot: CharacterPotentialSnapshot;
};

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function buildNexonUrl(
  endpoint: NexonEndpointKey,
  parameters: Record<string, QueryValue>,
): URL {
  const definition = NEXON_ENDPOINTS[endpoint];
  const allowedParameters = new Set(definition.allowedParameters);
  for (const key of Object.keys(parameters)) {
    if (!allowedParameters.has(key)) {
      throw new TypeError(`Unsupported NEXON API parameter: ${key}`);
    }
  }

  const url = new URL(`${NEXON_API_BASE}${definition.path}`);
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, String(value));
  }
  return url;
}

function retryDelayMilliseconds(response: Response, fallback: number): number {
  const retryAfter = response.headers.get("Retry-After");
  if (!retryAfter) return Math.min(fallback, MAX_RETRY_DELAY_MS);

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.max(seconds * 1_000, 100), MAX_RETRY_DELAY_MS);
  }

  const retryAt = Date.parse(retryAfter);
  if (Number.isFinite(retryAt)) {
    return Math.min(Math.max(retryAt - Date.now(), 100), MAX_RETRY_DELAY_MS);
  }
  return Math.min(fallback, MAX_RETRY_DELAY_MS);
}

function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function discardResponseBody(response: Response): Promise<void> {
  if (!response.body) return;
  try {
    await response.body.cancel();
  } catch {
    // The response is already unusable; cleanup failure must not mask its status.
  }
}

function sanitizedFetchErrorMessage(error: unknown, apiKey: string): string {
  if (!(error instanceof Error)) return typeof error;
  return error.message
    .replaceAll(apiKey, "[redacted]")
    .replace(/([?&](?:ocid|character_name)=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 240);
}

export async function requestNexonEndpoint(
  endpoint: NexonEndpointKey,
  parameters: Record<string, QueryValue>,
  apiKey: string,
  dependencies: NexonRequestDependencies = {},
): Promise<JsonObject> {
  const resolvedApiKey = apiKey.trim();
  if (!resolvedApiKey) {
    throw new NexonApiError("configuration", endpoint);
  }

  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const sleep = dependencies.sleep ?? wait;
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = buildNexonUrl(endpoint, parameters);

  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const releaseRequestStart = await dependencies.beforeRequest?.();
    let startReleased = false;
    const releaseStart = () => {
      if (startReleased || typeof releaseRequestStart !== "function") return;
      startReleased = true;
      releaseRequestStart();
    };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let fetchFailed = false;
    let fetchError: unknown;
    try {
      const pendingResponse = fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "StarforceCalculator/1.0 (+https://starforce.pages.dev/)",
          "x-nxopen-api-key": resolvedApiKey,
        },
        // Never forward the API key to a redirect destination.
        redirect: "manual",
        signal: controller.signal,
      });
      // fetchImpl 호출 자체가 요청 시작점이다. 다음 예약을 이보다 먼저
      // 풀면 여러 worker가 같은 순간에 출발할 수 있다.
      releaseStart();
      response = await pendingResponse;
    } catch (error) {
      fetchFailed = true;
      fetchError = error;
    } finally {
      releaseStart();
      clearTimeout(timeout);
    }

    if (fetchFailed) {
      const timedOut = controller.signal.aborted;
      if (!timedOut && attempt < 2) {
        await sleep(200 * 2 ** attempt);
        continue;
      }
      console.error({
        event: "nexon_fetch_failed",
        endpoint,
        attempt: attempt + 1,
        errorType: fetchError instanceof Error ? fetchError.name : typeof fetchError,
        errorMessage: sanitizedFetchErrorMessage(fetchError, resolvedApiKey),
      });
      throw new NexonApiError(
        timedOut ? "timeout" : "network",
        endpoint,
      );
    }

    if (!response) continue;
    if (response.status !== 429 || attempt === 2) break;
    const retryDelay = retryDelayMilliseconds(response, 400 * 2 ** attempt);
    await discardResponseBody(response);
    await sleep(retryDelay);
  }

  if (!response) {
    throw new NexonApiError("network", endpoint);
  }
  if (!response.ok) {
    const upstreamStatus = response.status;
    await discardResponseBody(response);
    if (upstreamStatus === 429) {
      throw new NexonApiError("rate_limited", endpoint, upstreamStatus);
    }
    if (upstreamStatus === 401 || upstreamStatus === 403) {
      throw new NexonApiError("unauthorized", endpoint, upstreamStatus);
    }
    if (
      endpoint === "characterId" &&
      (upstreamStatus === 400 || upstreamStatus === 404)
    ) {
      throw new NexonApiError("not_found", endpoint, upstreamStatus);
    }
    throw new NexonApiError("upstream", endpoint, upstreamStatus);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new NexonApiError(
      "malformed_response",
      endpoint,
      response.status,
    );
  }
  if (!isJsonObject(payload)) {
    throw new NexonApiError(
      "malformed_response",
      endpoint,
      response.status,
    );
  }
  return payload;
}

export async function mapWithConcurrency<Input, Output>(
  items: readonly Input[],
  concurrency: number,
  mapper: (item: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Concurrency must be a positive integer.");
  }
  if (items.length === 0) return [];

  const results = new Array<Output>(items.length);
  let nextIndex = 0;
  let failed = false;
  let failure: unknown;
  const worker = async (): Promise<void> => {
    while (!failed && nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        results[index] = await mapper(items[index], index);
      } catch (error) {
        failed = true;
        failure = error;
      }
    }
  };

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (failed) throw failure;
  return results;
}

async function fetchGuildNoblesseData(
  character: JsonObject,
  apiKey: string,
  dependencies: NexonRequestDependencies,
): Promise<JsonObject> {
  const guildName = typeof character.character_guild_name === "string"
    ? character.character_guild_name.trim()
    : "";
  const worldName = typeof character.world_name === "string"
    ? character.world_name.trim()
    : "";
  if (!guildName) return { guild_noblesse_skill: [] };
  if (!worldName) return {};

  try {
    const guildId = await requestNexonEndpoint(
      "guildId",
      { guild_name: guildName, world_name: worldName },
      apiKey,
      dependencies,
    );
    const oguildId = typeof guildId.oguild_id === "string"
      ? guildId.oguild_id.trim()
      : "";
    if (!oguildId) return {};
    const guildPayload = await requestNexonEndpoint(
      "guildBasic",
      { oguild_id: oguildId },
      apiKey,
      dependencies,
    );
    return {
      guild_noblesse_skill: Array.isArray(
        guildPayload.guild_noblesse_skill,
      )
        ? guildPayload.guild_noblesse_skill
        : [],
    };
  } catch {
    // 길드 자료는 부가 입력이다. 실패해도 캐릭터 본체 조회를 유지하고
    // 코어가 기존 안전 기준과 경고를 사용하게 한다.
    return {};
  }
}

export async function fetchCharacterPotentialData(
  characterName: string,
  apiKey: string,
  dependencies: NexonRequestDependencies = {},
): Promise<CharacterPotentialData> {
  const sleep = dependencies.sleep ?? wait;
  let lastRequestStartedAt: number | null = null;
  let pacingQueue = Promise.resolve();
  const paceRequestStarts = async (): Promise<() => void> => {
    // 여러 endpoint를 겹쳐 조회해도 요청 시작 시각 계산만 직렬화한다.
    // 그렇지 않으면 동시에 깨어난 worker들이 같은 시각에 요청을 보내
    // NEXON API의 rolling rate limit을 넘을 수 있다.
    const previous = pacingQueue;
    let releaseQueue = () => {};
    pacingQueue = new Promise((resolvePromise) => {
      releaseQueue = resolvePromise;
    });
    let externalRelease: void | (() => void) = undefined;
    try {
      await previous;
      if (dependencies.beforeRequest) {
        externalRelease = await dependencies.beforeRequest();
      } else if (lastRequestStartedAt !== null) {
        const remaining = REQUEST_INTERVAL_MS -
          (Date.now() - lastRequestStartedAt);
        if (remaining > 0) await sleep(remaining);
      }
      lastRequestStartedAt = Date.now();
    } catch (error) {
      releaseQueue();
      throw error;
    }
    return () => {
      try {
        if (typeof externalRelease === "function") externalRelease();
      } finally {
        releaseQueue();
      }
    };
  };
  const pacedDependencies: NexonRequestDependencies = {
    ...dependencies,
    beforeRequest: paceRequestStarts,
  };
  const idPayload = await requestNexonEndpoint(
    "characterId",
    { character_name: characterName },
    apiKey,
    pacedDependencies,
  );
  const ocid = typeof idPayload.ocid === "string" ? idPayload.ocid.trim() : "";
  if (!ocid || ocid.length > 100) {
    throw new NexonApiError("not_found", "characterId");
  }
  const jobs = [
    { field: "character", endpoint: "basic", parameters: { ocid } },
    { field: "equipmentData", endpoint: "equipment", parameters: { ocid } },
    {
      field: "cashEquipmentData",
      endpoint: "cashEquipment",
      parameters: { ocid },
    },
    {
      field: "petEquipmentData",
      endpoint: "petEquipment",
      parameters: { ocid },
    },
    { field: "setEffectData", endpoint: "setEffect", parameters: { ocid } },
    { field: "otherStatData", endpoint: "otherStat", parameters: { ocid } },
    { field: "linkSkillData", endpoint: "linkSkill", parameters: { ocid } },
    { field: "symbolData", endpoint: "symbol", parameters: { ocid } },
    { field: "hyperStatData", endpoint: "hyperStat", parameters: { ocid } },
    { field: "hexaStatData", endpoint: "hexaStat", parameters: { ocid } },
    { field: "hexaMatrixData", endpoint: "hexaMatrix", parameters: { ocid } },
    { field: "vMatrixData", endpoint: "vMatrix", parameters: { ocid } },
    { field: "abilityData", endpoint: "ability", parameters: { ocid } },
    { field: "unionRaiderData", endpoint: "unionRaider", parameters: { ocid } },
    {
      field: "unionArtifactData",
      endpoint: "unionArtifact",
      parameters: { ocid },
    },
    {
      field: "unionChampionData",
      endpoint: "unionChampion",
      parameters: { ocid },
    },
    // 종합 능력치는 캐릭터의 현재 적용 상태에 따라 유니온 수치가 잠시
    // 이전 값으로 보일 수 있다. 유니온 자료를 먼저 조회한 뒤 가장
    // 마지막 스냅샷을 사용해 구성요소와의 시점 차이를 줄인다.
    { field: "statData", endpoint: "stat", parameters: { ocid } },
    {
      field: "ringReserveData",
      endpoint: "ringReserve",
      parameters: { ocid },
    },
    ...CHARACTER_SKILL_GRADES.map((grade) => ({
      field: `skillData:${grade}`,
      endpoint: "skill" as const,
      parameters: { ocid, character_skill_grade: grade },
    })),
  ] as const;

  /* 개발 키의 초당 5회 제한과 rolling window를 모두 피한다. 요청 시작은
     275ms 간격으로 유지하되 왕복 응답은 최대 네 개까지 겹쳐, 느린 endpoint
     하나가 뒤의 모든 조회를 막지 않게 한다. */
  let guildData: JsonObject = {};
  const payloads = await mapWithConcurrency(
    jobs,
    CHARACTER_FETCH_CONCURRENCY,
    async (job) => {
      const payload = await requestNexonEndpoint(
        job.endpoint,
        job.parameters,
        apiKey,
        pacedDependencies,
      );
      // basic 응답을 받은 worker가 길드 조회를 바로 이어간다. 다른 세
      // worker의 공개 스냅샷 조회와 겹치므로 마지막에 길드 RTT 두 번을
      // 따로 기다리지 않으면서 최대 동시 연결 수 4는 그대로 유지한다.
      if (job.field === "character") {
        guildData = await fetchGuildNoblesseData(
          payload,
          apiKey,
          pacedDependencies,
        );
      }
      return payload;
    },
  );
  const payloadByField = Object.fromEntries(
    jobs.map((job, index) => [job.field, payloads[index]]),
  ) as Record<string, JsonObject>;

  return {
    character: payloadByField.character,
    snapshot: {
      statData: payloadByField.statData,
      equipmentData: payloadByField.equipmentData,
      cashEquipmentData: payloadByField.cashEquipmentData,
      petEquipmentData: payloadByField.petEquipmentData,
      setEffectData: payloadByField.setEffectData,
      otherStatData: payloadByField.otherStatData,
      linkSkillData: payloadByField.linkSkillData,
      skillData: CHARACTER_SKILL_GRADES.map(
        (grade) => payloadByField[`skillData:${grade}`],
      ),
      symbolData: payloadByField.symbolData,
      hyperStatData: payloadByField.hyperStatData,
      hexaStatData: payloadByField.hexaStatData,
      hexaMatrixData: payloadByField.hexaMatrixData,
      vMatrixData: payloadByField.vMatrixData,
      abilityData: payloadByField.abilityData,
      unionRaiderData: payloadByField.unionRaiderData,
      unionArtifactData: payloadByField.unionArtifactData,
      unionChampionData: payloadByField.unionChampionData,
      ringReserveData: payloadByField.ringReserveData,
      guildData,
    },
  };
}
