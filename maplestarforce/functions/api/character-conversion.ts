import {
  buildCharacterConversionFromData,
  ConversionUnavailableError,
  type CharacterPresetPolicy,
} from "../_lib/conversion";
import {
  ApiResponseError,
  errorResponse,
  isSameOriginRequest,
  jsonResponse,
  preflightResponse,
  withSameOriginCors,
} from "../_lib/http";
import {
  CHARACTER_SKILL_SNAPSHOT_COUNT,
  fetchCharacterPotentialData,
  NexonApiError,
  type CharacterPotentialData,
  type NexonRequestDependencies,
} from "../_lib/nexon";

export type Bindings = {
  NEXON_API_KEY: string;
};

export type CharacterConversionContext = {
  request: Request;
  env: Bindings;
  waitUntil(promise: Promise<unknown>): void;
};

export type CharacterConversionDependencies = NexonRequestDependencies & {
  cache?: Cache | null;
  now?: () => number;
};

const CACHE_SECONDS = 10 * 60;
const SNAPSHOT_STALE_SECONDS = 6 * 60 * 60;
export const CHARACTER_CONVERSION_CACHE_VERSION = "combat-profile-v67";
// 현재 장착한 전투복과 마스터라벨 플러스 표시 정보를 응답에 추가했다.
// 이전 변환 응답을 10분 캐시에서 재사용하지 않도록 버전을 분리한다.
export const CHARACTER_SNAPSHOT_CACHE_VERSION = "character-snapshot-v2";
const SNAPSHOT_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const CHARACTER_NAME_PATTERN = /^[\p{L}\p{N}]+$/u;
const PRESET_QUERY_FIELDS = [
  "equipmentPreset",
  "hyperPreset",
  "unionPreset",
  "linkPreset",
  "abilityPreset",
] as const;
const PRESET_QUERY_MAX = {
  equipmentPreset: 3,
  hyperPreset: 3,
  unionPreset: 10,
  linkPreset: 3,
  abilityPreset: 3,
} as const satisfies Record<(typeof PRESET_QUERY_FIELDS)[number], number>;
const ALLOWED_QUERY_FIELDS = new Set([
  "characterName",
  "presetMode",
  "refresh",
  ...PRESET_QUERY_FIELDS,
]);

export function parseCharacterName(request: Request): string {
  const url = new URL(request.url);
  const unsupportedParameters = [...url.searchParams.keys()].filter(
    (key) => !ALLOWED_QUERY_FIELDS.has(key),
  );
  if (unsupportedParameters.length > 0) {
    throw new ApiResponseError(
      400,
      "INVALID_QUERY",
      "지원하지 않는 쿼리 파라미터가 포함되어 있습니다.",
    );
  }

  const values = url.searchParams.getAll("characterName");
  if (values.length !== 1) {
    throw new ApiResponseError(
      400,
      "INVALID_CHARACTER_NAME",
      "캐릭터 이름을 하나만 입력해 주세요.",
    );
  }
  const characterName = values[0].trim().normalize("NFC");
  const characterLength = [...characterName].length;
  if (
    characterLength < 2 ||
    characterLength > 12 ||
    !CHARACTER_NAME_PATTERN.test(characterName)
  ) {
    throw new ApiResponseError(
      400,
      "INVALID_CHARACTER_NAME",
      "캐릭터 이름은 2~12자의 한글, 영문 또는 숫자로 입력해 주세요.",
    );
  }
  return characterName;
}

export type CharacterConversionQuery = {
  characterName: string;
  presetPolicy: CharacterPresetPolicy;
  refresh: boolean;
};

function singleQueryValue(
  searchParams: URLSearchParams,
  field: string,
): string | null {
  const values = searchParams.getAll(field);
  if (values.length > 1) {
    throw new ApiResponseError(
      400,
      "INVALID_PRESET_QUERY",
      "프리셋 쿼리 파라미터는 하나씩만 입력해 주세요.",
    );
  }
  return values[0] ?? null;
}

export function parseCharacterConversionQuery(
  request: Request,
): CharacterConversionQuery {
  const characterName = parseCharacterName(request);
  const searchParams = new URL(request.url).searchParams;
  const modeValue = singleQueryValue(searchParams, "presetMode") ?? "auto";
  const refreshValue = singleQueryValue(searchParams, "refresh");
  if (refreshValue !== null && refreshValue !== "1") {
    throw new ApiResponseError(
      400,
      "INVALID_REFRESH_QUERY",
      "refresh는 1일 때만 사용할 수 있습니다.",
    );
  }
  const refresh = refreshValue === "1";
  if (!new Set(["active", "auto", "manual"]).has(modeValue)) {
    throw new ApiResponseError(
      400,
      "INVALID_PRESET_QUERY",
      "presetMode는 active, auto, manual 중 하나여야 합니다.",
    );
  }
  const presetValues = Object.fromEntries(
    PRESET_QUERY_FIELDS.map((field) => [
      field,
      singleQueryValue(searchParams, field),
    ]),
  ) as Record<(typeof PRESET_QUERY_FIELDS)[number], string | null>;
  if (modeValue !== "manual") {
    if (Object.values(presetValues).some((value) => value !== null)) {
      throw new ApiResponseError(
        400,
        "INVALID_PRESET_QUERY",
        "프리셋 번호는 presetMode=manual일 때만 입력할 수 있습니다.",
      );
    }
    return {
      characterName,
      presetPolicy: { mode: modeValue as "active" | "auto" },
      refresh,
    };
  }
  if (PRESET_QUERY_FIELDS.some((field) => {
    const value = presetValues[field];
    if (value === null || !/^[1-9]\d*$/.test(value)) return true;
    return Number(value) > PRESET_QUERY_MAX[field];
  })) {
    throw new ApiResponseError(
      400,
      "INVALID_PRESET_QUERY",
      "manual 모드에서는 장비·하이퍼·유니온·링크·어빌리티 프리셋 번호를 모두 입력해 주세요.",
    );
  }
  return {
    characterName,
    presetPolicy: {
      mode: "manual",
      manual: {
        equipment: Number(presetValues.equipmentPreset),
        hyper: Number(presetValues.hyperPreset),
        union: Number(presetValues.unionPreset),
        link: Number(presetValues.linkPreset),
        ability: Number(presetValues.abilityPreset),
      },
    },
    refresh,
  };
}

export function createCacheKey(
  request: Request,
  characterName: string,
  presetPolicy: CharacterPresetPolicy = { mode: "auto" },
): Request {
  const url = new URL(request.url);
  url.pathname = "/api/character-conversion";
  url.search = "";
  url.hash = "";
  url.searchParams.set("characterName", characterName);
  url.searchParams.set("presetMode", presetPolicy.mode);
  if (presetPolicy.mode === "manual" && presetPolicy.manual) {
    for (const [field, component] of [
      ["equipmentPreset", "equipment"],
      ["hyperPreset", "hyper"],
      ["unionPreset", "union"],
      ["linkPreset", "link"],
      ["abilityPreset", "ability"],
    ] as const) {
      url.searchParams.set(field, String(presetPolicy.manual[component]));
    }
  }
  url.searchParams.set("conversionVersion", CHARACTER_CONVERSION_CACHE_VERSION);
  return new Request(url.toString(), { method: "GET" });
}

export function createSnapshotCacheKey(
  request: Request,
  characterName: string,
  freshness: "fresh" | "stale",
): Request {
  const url = new URL(request.url);
  url.pathname = "/__internal/character-potential-snapshot";
  url.search = "";
  url.hash = "";
  url.searchParams.set("characterName", characterName);
  url.searchParams.set("snapshotVersion", CHARACTER_SNAPSHOT_CACHE_VERSION);
  url.searchParams.set("freshness", freshness);
  return new Request(url.toString(), { method: "GET" });
}

type CharacterSnapshotEnvelope = {
  version: typeof CHARACTER_SNAPSHOT_CACHE_VERSION;
  fetchedAt: number;
  data: CharacterPotentialData;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const SNAPSHOT_OBJECT_FIELDS = [
  "statData",
  "equipmentData",
  "cashEquipmentData",
  "petEquipmentData",
  "setEffectData",
  "otherStatData",
  "linkSkillData",
  "symbolData",
  "hyperStatData",
  "hexaStatData",
  "hexaMatrixData",
  "vMatrixData",
  "abilityData",
  "unionRaiderData",
  "unionArtifactData",
  "unionChampionData",
  "ringReserveData",
  "guildData",
] as const;

function isSnapshotEnvelope(
  value: unknown,
  now: number,
  maximumAgeMilliseconds: number,
): value is CharacterSnapshotEnvelope {
  if (!isObject(value) || value.version !== CHARACTER_SNAPSHOT_CACHE_VERSION) {
    return false;
  }
  if (
    !Number.isFinite(value.fetchedAt) || Number(value.fetchedAt) < 0 ||
    Number(value.fetchedAt) > now + SNAPSHOT_CLOCK_SKEW_MS ||
    now - Number(value.fetchedAt) > maximumAgeMilliseconds ||
    !isObject(value.data)
  ) return false;
  if (!isObject(value.data.character) || !isObject(value.data.snapshot)) {
    return false;
  }
  const snapshot = value.data.snapshot;
  return SNAPSHOT_OBJECT_FIELDS.every((field) => isObject(snapshot[field])) &&
    Array.isArray(snapshot.skillData) &&
    snapshot.skillData.length === CHARACTER_SKILL_SNAPSHOT_COUNT &&
    snapshot.skillData.every(isObject);
}

async function readSnapshot(
  cache: Cache,
  key: Request,
  now: number,
  maximumAgeMilliseconds: number,
): Promise<CharacterSnapshotEnvelope | null> {
  try {
    const response = await cache.match(key);
    if (!response) return null;
    const payload: unknown = await response.json();
    return isSnapshotEnvelope(payload, now, maximumAgeMilliseconds)
      ? payload
      : null;
  } catch (error) {
    logFailure("character_snapshot_cache_match_failed", error);
    return null;
  }
}

function snapshotResponse(
  envelope: CharacterSnapshotEnvelope,
  maxAge: number,
): Response {
  return new Response(JSON.stringify(envelope), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${maxAge}`,
    },
  });
}

function canUseStaleSnapshot(error: unknown): boolean {
  if (!(error instanceof NexonApiError)) return false;
  if (new Set([
    "network",
    "timeout",
    "rate_limited",
    "malformed_response",
  ]).has(error.kind)) return true;
  return error.kind === "upstream" && (
    error.upstreamStatus === 408 || Number(error.upstreamStatus) >= 500
  );
}

function staleSnapshotWarning(fetchedAt: number): string {
  const formatter = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `NEXON Open API의 일시적인 오류로 ${formatter.format(fetchedAt)} 기준 캐릭터 정보를 표시합니다.`;
}

function mapNexonError(error: NexonApiError): ApiResponseError {
  switch (error.kind) {
    case "not_found":
      return new ApiResponseError(
        404,
        "CHARACTER_NOT_FOUND",
        "캐릭터를 찾지 못했습니다. 이름을 확인해 주세요.",
      );
    case "rate_limited":
      return new ApiResponseError(
        503,
        "NEXON_RATE_LIMITED",
        "조회 요청이 많습니다. 잠시 후 다시 시도해 주세요.",
        { "Retry-After": "2" },
      );
    case "timeout":
      return new ApiResponseError(
        504,
        "NEXON_TIMEOUT",
        "캐릭터 조회 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.",
      );
    case "unauthorized":
    case "configuration":
      return new ApiResponseError(
        503,
        "CHARACTER_SERVICE_UNAVAILABLE",
        "캐릭터 조회 서비스를 사용할 수 없습니다.",
      );
    case "network":
    case "upstream":
    case "malformed_response":
      return new ApiResponseError(
        502,
        "NEXON_UPSTREAM_ERROR",
        "NEXON Open API 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.",
      );
  }
}

function logFailure(event: string, error: unknown): void {
  console.error({
    event,
    errorType: error instanceof Error ? error.name : typeof error,
    ...(error instanceof NexonApiError
      ? {
          errorKind: error.kind,
          endpoint: error.endpoint,
          upstreamStatus: error.upstreamStatus ?? null,
        }
      : {}),
  });
}

export async function handleCharacterConversion(
  context: CharacterConversionContext,
  dependencies: CharacterConversionDependencies = {},
): Promise<Response> {
  const { request } = context;
  if (!isSameOriginRequest(request)) {
    return errorResponse(
      new ApiResponseError(
        403,
        "CROSS_ORIGIN_FORBIDDEN",
        "동일 출처 요청만 허용됩니다.",
      ),
      request,
    );
  }
  if (request.method === "OPTIONS") return preflightResponse(request);
  if (request.method !== "GET") {
    return errorResponse(
      new ApiResponseError(
        405,
        "METHOD_NOT_ALLOWED",
        "GET 요청만 사용할 수 있습니다.",
        { Allow: "GET, OPTIONS" },
      ),
      request,
    );
  }

  try {
    const { characterName, presetPolicy, refresh } =
      parseCharacterConversionQuery(request);
    const apiKey = context.env.NEXON_API_KEY?.trim();
    if (!apiKey) {
      throw new ApiResponseError(
        503,
        "CHARACTER_SERVICE_UNAVAILABLE",
        "캐릭터 조회 서비스를 사용할 수 없습니다.",
      );
    }

    const cache =
      dependencies.cache === undefined ? caches.default : dependencies.cache;
    const cacheKey = createCacheKey(request, characterName, presetPolicy);
    if (cache && !refresh) {
      try {
        const cachedResponse = await cache.match(cacheKey);
        if (cachedResponse) {
          return withSameOriginCors(cachedResponse, request);
        }
      } catch (error) {
        logFailure("character_conversion_cache_match_failed", error);
      }
    }

    const now = dependencies.now ?? Date.now;
    const freshSnapshotKey = createSnapshotCacheKey(
      request,
      characterName,
      "fresh",
    );
    const staleSnapshotKey = createSnapshotCacheKey(
      request,
      characterName,
      "stale",
    );
    let envelope: CharacterSnapshotEnvelope | null = null;
    let staleEnvelope: CharacterSnapshotEnvelope | null = null;
    if (cache && !refresh) {
      const readAt = now();
      envelope = await readSnapshot(
        cache,
        freshSnapshotKey,
        readAt,
        CACHE_SECONDS * 1_000,
      );
      if (!envelope) {
        staleEnvelope = await readSnapshot(
          cache,
          staleSnapshotKey,
          readAt,
          SNAPSHOT_STALE_SECONDS * 1_000,
        );
      }
    }

    let fetchedFromUpstream = false;
    let usedStaleSnapshot = false;
    if (!envelope) {
      try {
        const data = await fetchCharacterPotentialData(
          characterName,
          apiKey,
          {
            fetchImpl: dependencies.fetchImpl,
            sleep: dependencies.sleep,
            timeoutMs: dependencies.timeoutMs,
            beforeRequest: dependencies.beforeRequest,
          },
        );
        envelope = {
          version: CHARACTER_SNAPSHOT_CACHE_VERSION,
          fetchedAt: now(),
          data,
        };
        fetchedFromUpstream = true;
      } catch (error) {
        if (!refresh && staleEnvelope && canUseStaleSnapshot(error)) {
          envelope = staleEnvelope;
          usedStaleSnapshot = true;
          logFailure("character_snapshot_stale_fallback", error);
        } else {
          throw error;
        }
      }
    }

    const result = buildCharacterConversionFromData(
      envelope.data,
      presetPolicy,
    );
    result.dataFreshness = {
      source: usedStaleSnapshot
        ? "stale-cache"
        : fetchedFromUpstream
          ? "nexon"
          : "snapshot-cache",
      fetchedAt: new Date(envelope.fetchedAt).toISOString(),
    };
    if (usedStaleSnapshot) {
      result.warnings = [
        ...new Set([
          ...result.warnings,
          staleSnapshotWarning(envelope.fetchedAt),
        ]),
      ];
    }
    const response = jsonResponse(result, {
      status: 200,
      headers: {
        "Cache-Control": usedStaleSnapshot
          ? "private, no-store"
          : `public, max-age=${CACHE_SECONDS}`,
        "X-Conversion-Version": CHARACTER_CONVERSION_CACHE_VERSION,
      },
    });

    if (cache && !usedStaleSnapshot) {
      const writes: Promise<unknown>[] = [
        cache.put(cacheKey, response.clone()).catch((error) => {
          logFailure("character_conversion_cache_put_failed", error);
        }),
      ];
      if (fetchedFromUpstream) {
        writes.push(
          cache.put(
            freshSnapshotKey,
            snapshotResponse(envelope, CACHE_SECONDS),
          ).catch((error) => {
            logFailure("character_snapshot_fresh_cache_put_failed", error);
          }),
          cache.put(
            staleSnapshotKey,
            snapshotResponse(envelope, SNAPSHOT_STALE_SECONDS),
          ).catch((error) => {
            logFailure("character_snapshot_stale_cache_put_failed", error);
          }),
        );
      }
      context.waitUntil(Promise.all(writes));
    }
    return withSameOriginCors(response, request);
  } catch (error) {
    if (error instanceof ApiResponseError) {
      return errorResponse(error, request);
    }
    if (error instanceof NexonApiError) {
      if (error.kind !== "not_found") {
        logFailure("character_conversion_nexon_failed", error);
      }
      return errorResponse(mapNexonError(error), request);
    }
    if (error instanceof ConversionUnavailableError) {
      return errorResponse(
        new ApiResponseError(
          422,
          "CONVERSION_UNAVAILABLE",
          error.reason,
        ),
        request,
      );
    }
    logFailure("character_conversion_unexpected_failure", error);
    return errorResponse(
      new ApiResponseError(
        500,
        "INTERNAL_ERROR",
        "캐릭터 환산 중 오류가 발생했습니다.",
      ),
      request,
    );
  }
}

export const onRequest: PagesFunction<Bindings> = (context) =>
  handleCharacterConversion(context);
