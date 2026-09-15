import {
  ApiResponseError,
  errorResponse,
  isSameOriginRequest,
  jsonResponse,
  preflightResponse,
  withSameOriginCors,
} from "../_lib/http";
import {
  NexonApiError,
  requestNexonEndpoint,
  type JsonObject,
  type NexonRequestDependencies,
} from "../_lib/nexon";
import { resolveCharacterPresetSnapshot } from "maple-core/stat-efficiency";
import { inferPotentialStatProfile } from "maple-core/stat-profile";

export type Bindings = {
  NEXON_API_KEY: string;
};

export type CharacterEquipmentContext = {
  request: Request;
  env: Bindings;
  waitUntil(promise: Promise<unknown>): void;
};

export type CharacterEquipmentDependencies = NexonRequestDependencies & {
  cache?: Cache | null;
};

const CACHE_SECONDS = 10 * 60;
const CACHE_VERSION = "starforce-equipment-v5";
const CHARACTER_NAME_PATTERN = /^[\p{L}\p{N}]+$/u;
const EQUIPMENT_PRESET_NUMBERS = [1, 2, 3] as const;
const STARFORCE_PARTS = new Set([
  "무기",
  "모자",
  "상의",
  "한벌옷",
  "하의",
  "장갑",
  "신발",
  "망토",
  "어깨장식",
  "얼굴장식",
  "눈장식",
  "귀고리",
  "반지",
  "펜던트",
  "벨트",
  "기계심장",
]);

type PublicEquipment = {
  name: string;
  part: string;
  slot: string;
  level: number;
  starforce: number;
  icon: string | null;
};

type PublicEquipmentPreset = {
  presetNo: number;
  equipment: PublicEquipment[];
};

type PublicCharacterEquipment = {
  activePresetNo: number | null;
  presets: PublicEquipmentPreset[];
  equipment: Array<PublicEquipment & { presetNo: number | null }>;
};

type PublicCharacterEquipmentResult = PublicCharacterEquipment & {
  characterImage: string | null;
  recommendedPresetNo: number | null;
};

function normalizePart(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFC").replace(/[\s\d]+/gu, "")
    : "";
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim().normalize("NFC") : "";
}

function isStarforceSpecialEquipment(
  name: string,
  part: string,
  slot: string,
  level: number | null,
): boolean {
  return (
    level === 200 &&
    /^아스트라(?:\s|$)/u.test(name) &&
    [part, slot].map(normalizePart).includes("보조무기")
  );
}

function objectField(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function integerField(value: unknown): number | null {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    (typeof value === "string" && !value.trim())
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function sanitizeHttpsUrl(value: unknown): string | null {
  const text = stringField(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function parseCharacterEquipmentName(request: Request): string {
  const url = new URL(request.url);
  const unsupported = [...url.searchParams.keys()].filter(
    (key) => key !== "characterName",
  );
  if (unsupported.length > 0) {
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
  const name = values[0].trim().normalize("NFC");
  const length = [...name].length;
  if (length < 2 || length > 12 || !CHARACTER_NAME_PATTERN.test(name)) {
    throw new ApiResponseError(
      400,
      "INVALID_CHARACTER_NAME",
      "캐릭터 이름은 2~12자의 한글, 영문 또는 숫자로 입력해 주세요.",
    );
  }
  return name;
}

function sanitizeEquipmentArray(equipment: unknown): PublicEquipment[] | null {
  if (!Array.isArray(equipment)) return null;
  return equipment.flatMap((raw): PublicEquipment[] => {
    const item = objectField(raw);
    const base = objectField(item?.item_base_option);
    const name = stringField(item?.item_name);
    const part = stringField(item?.item_equipment_part);
    const slot = stringField(item?.item_equipment_slot);
    const level = integerField(base?.base_equipment_level);
    const starforce = integerField(item?.starforce);
    const starforceEligible =
      STARFORCE_PARTS.has(normalizePart(part)) ||
      STARFORCE_PARTS.has(normalizePart(slot)) ||
      isStarforceSpecialEquipment(name, part, slot, level);
    if (
      !name ||
      !starforceEligible ||
      level === null ||
      level < 135 ||
      starforce === null ||
      starforce < 0 ||
      // 시작 성 선택은 0~29성입니다. 완성된 30성 장비를 자동 시작값으로
      // 적용하면 계산 범위를 벗어나므로 조회 결과에서 제외합니다.
      starforce >= 30
    ) {
      return [];
    }
    const icon = sanitizeHttpsUrl(item?.item_icon);
    return [{ name, part, slot, level, starforce, icon }];
  });
}

export function sanitizeStarforceEquipment(payload: JsonObject): PublicEquipment[] {
  const equipment = sanitizeEquipmentArray(payload.item_equipment);
  if (!equipment) {
    throw new NexonApiError("malformed_response", "equipment");
  }
  return equipment;
}

export function sanitizeStarforceEquipmentPresets(
  payload: JsonObject,
): PublicCharacterEquipment {
  const activeEquipment = sanitizeEquipmentArray(payload.item_equipment);
  const presetEquipment = EQUIPMENT_PRESET_NUMBERS.map((presetNo) => ({
    presetNo,
    equipment: sanitizeEquipmentArray(
      payload[`item_equipment_preset_${presetNo}`],
    ),
  }));
  if (
    activeEquipment === null &&
    presetEquipment.every(({ equipment }) => equipment === null)
  ) {
    throw new NexonApiError("malformed_response", "equipment");
  }

  const parsedActivePreset = integerField(payload.preset_no);
  const activePresetNo = EQUIPMENT_PRESET_NUMBERS.includes(
    parsedActivePreset as (typeof EQUIPMENT_PRESET_NUMBERS)[number],
  )
    ? parsedActivePreset
    : null;
  const presets = presetEquipment.map(({ presetNo, equipment }) => ({
    presetNo,
    // 현재 프리셋 배열 자체가 빠진 경우에만 item_equipment로 보완한다.
    // 다른 번호까지 현재 장비로 복제하면 보유하지 않은 프리셋처럼 보인다.
    equipment:
      equipment ??
      (presetNo === activePresetNo && activeEquipment !== null
        ? activeEquipment
        : []),
  }));
  const flattened: Array<PublicEquipment & { presetNo: number | null }> =
    presets.flatMap(({ presetNo, equipment }) =>
      equipment.map((item) => ({ ...item, presetNo })),
    );

  // preset_no가 없거나 범위를 벗어난 구형/부분 응답은 현재 장비의 번호를
  // 추측하지 않는다. 대신 기존 평탄 목록에서는 안전하게 사용할 수 있게 한다.
  if (activePresetNo === null && activeEquipment !== null) {
    flattened.push(
      ...activeEquipment.map((item) => ({ ...item, presetNo: null })),
    );
  }

  return { activePresetNo, presets, equipment: flattened };
}

function fallbackPresetNo(equipment: PublicCharacterEquipment): number | null {
  const available = new Set(
    equipment.presets
      .filter(({ equipment: items }) => items.length > 0)
      .map(({ presetNo }) => presetNo),
  );
  if (
    equipment.activePresetNo !== null &&
    available.has(equipment.activePresetNo)
  ) {
    return equipment.activePresetNo;
  }
  return (
    equipment.presets.find(({ equipment: items }) => items.length > 0)
      ?.presetNo ?? null
  );
}

function recommendedPresetNo(
  basicPayload: JsonObject,
  equipmentPayload: JsonObject,
  equipment: PublicCharacterEquipment,
): number | null {
  const fallback = fallbackPresetNo(equipment);
  const className = stringField(basicPayload.character_class);
  const characterLevel = integerField(basicPayload.character_level);
  const profile = inferPotentialStatProfile(className);
  if (!profile.supported || characterLevel === null || characterLevel < 1) {
    return fallback;
  }

  const subStats = [
    ...new Set(
      (Array.isArray(profile.subStats)
        ? profile.subStats
        : profile.subStat
          ? [profile.subStat]
          : []
      )
        .map((stat) => String(stat).trim())
        .filter(Boolean),
    ),
  ];
  try {
    const resolved = resolveCharacterPresetSnapshot({
      equipmentData: equipmentPayload,
      hyperStatData: {},
      unionRaiderData: {},
      linkSkillData: {},
      abilityData: {},
      mainStat: profile.mainStat,
      subStats,
      attackType: profile.attackType,
      characterLevel,
      presetPolicy: { mode: "auto" },
    });
    const selected = integerField(resolved.selection.selected.equipment);
    const selectedIsAvailable = equipment.presets.some(
      ({ presetNo, equipment: items }) =>
        presetNo === selected && items.length > 0,
    );
    return EQUIPMENT_PRESET_NUMBERS.includes(
      selected as (typeof EQUIPMENT_PRESET_NUMBERS)[number],
    ) && selectedIsAvailable
      ? selected
      : fallback;
  } catch {
    return fallback;
  }
}

function cacheKey(request: Request, characterName: string): Request {
  const url = new URL(request.url);
  url.pathname = "/api/character-equipment";
  url.search = "";
  url.hash = "";
  url.searchParams.set("characterName", characterName);
  url.searchParams.set("version", CACHE_VERSION);
  return new Request(url.toString(), { method: "GET" });
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
        "장착 장비 조회 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.",
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

async function fetchEquipment(
  characterName: string,
  apiKey: string,
  dependencies: NexonRequestDependencies,
): Promise<PublicCharacterEquipmentResult> {
  const idPayload = await requestNexonEndpoint(
    "characterId",
    { character_name: characterName },
    apiKey,
    dependencies,
  );
  const ocid = stringField(idPayload.ocid);
  if (!ocid || ocid.length > 100) {
    throw new NexonApiError("not_found", "characterId");
  }
  // 캐릭터 이미지·직업 정보는 보조 정보다. basic만 일시 실패해도 장착 장비
  // 자체는 계속 제공하고, 프리셋 선택은 활성 프리셋으로 안전하게 복구한다.
  const [basicPayload, equipmentPayload] = await Promise.all([
    requestNexonEndpoint("basic", { ocid }, apiKey, dependencies).catch(
      () => ({} as JsonObject),
    ),
    requestNexonEndpoint("equipment", { ocid }, apiKey, dependencies),
  ]);
  const equipment = sanitizeStarforceEquipmentPresets(equipmentPayload);
  return {
    ...equipment,
    characterImage: sanitizeHttpsUrl(basicPayload.character_image),
    recommendedPresetNo: recommendedPresetNo(
      basicPayload,
      equipmentPayload,
      equipment,
    ),
  };
}

export async function handleCharacterEquipment(
  context: CharacterEquipmentContext,
  dependencies: CharacterEquipmentDependencies = {},
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
    const characterName = parseCharacterEquipmentName(request);
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
    const key = cacheKey(request, characterName);
    if (cache) {
      try {
        const cached = await cache.match(key);
        if (cached) return withSameOriginCors(cached, request);
      } catch (error) {
        console.error({
          event: "character_equipment_cache_match_failed",
          errorType: error instanceof Error ? error.name : typeof error,
        });
      }
    }

    const equipmentResult = await fetchEquipment(
      characterName,
      apiKey,
      dependencies,
    );
    const response = jsonResponse(
      {
        ok: true,
        characterName,
        ...equipmentResult,
        attribution: "Data based on NEXON Open API",
      },
      {
        status: 200,
        headers: { "Cache-Control": `public, max-age=${CACHE_SECONDS}` },
      },
    );
    if (cache) {
      context.waitUntil(
        cache.put(key, response.clone()).catch((error) => {
          console.error({
            event: "character_equipment_cache_put_failed",
            errorType: error instanceof Error ? error.name : typeof error,
          });
        }),
      );
    }
    return withSameOriginCors(response, request);
  } catch (error) {
    if (error instanceof ApiResponseError) return errorResponse(error, request);
    if (error instanceof NexonApiError) {
      return errorResponse(mapNexonError(error), request);
    }
    console.error({
      event: "character_equipment_unexpected_failure",
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return errorResponse(
      new ApiResponseError(
        500,
        "INTERNAL_ERROR",
        "장착 장비 조회 중 오류가 발생했습니다.",
      ),
      request,
    );
  }
}

export const onRequest: PagesFunction<Bindings> = (context) =>
  handleCharacterEquipment(context);
