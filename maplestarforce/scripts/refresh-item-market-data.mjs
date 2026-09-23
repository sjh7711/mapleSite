#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import {
  link,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateSchema } from "./lib/schema-validator.mjs";

export const PIPELINE_VERSION = "maplestarforce.item-market.v2";
export const MINIMUM_EXTENSION_VERSION = "0.7.7";
export const MINIMUM_CATALOG_VERSION = "2026-09-02.7";
export const PUBLIC_MANIFEST_SCHEMA = "maplestarforce.item-market.manifest.v1";
export const PUBLIC_CATALOG_SCHEMA = "maplestarforce.item-market.catalog.v1";
export const PUBLIC_ITEM_SCHEMA = "maplestarforce.item-market.item.v1";
export const PRIVATE_STATE_SCHEMA = "maplestarforce.item-market.state.v1";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const VALIDATOR_PATH = fileURLToPath(new URL("./lib/schema-validator.mjs", import.meta.url));
const PROJECT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const DEFAULT_EXTENSION_ROOT = path.resolve(PROJECT_ROOT, "../chrome extension/maple-auction-diagnostic");
const DEFAULT_RAW_ROOT = path.join(PROJECT_ROOT, "item_price_raw");
const DEFAULT_PRIVATE_ROOT = path.join(
  PROJECT_ROOT,
  "tools/item-market-dataset/market-data/auction"
);
const DEFAULT_PUBLIC_ROOT = path.join(PROJECT_ROOT, "public/item-market");
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T.*)?$/u;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/u;
const CATALOG_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}\.\d+$/u;
const DATASET_VERSION_PATTERN = /^[0-9a-f]{20}$/u;
const POTENTIAL_CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/u;
const ICON_ASSET_KEY_PATTERN = /^[A-Z0-9]{1,32}$/u;
const POTENTIAL_UNITS = new Set([null, "pct", "flat", "seconds", "level"]);
const POTENTIAL_TIERS = new Set([null, "legendary", "unique", "epic", "rare"]);
const STAT_SOURCES = ["base", "starforce", "scroll", "flame", "other", "total"];
const POTENTIAL_GRADE_BY_API_VALUE = new Map([
  [0, null],
  [1, "rare"],
  [2, "epic"],
  [3, "unique"],
  [4, "legendary"]
]);
const POTENTIAL_GRADE_LABEL = new Map([
  ["none", "없음"],
  ["rare", "레어"],
  ["epic", "에픽"],
  ["unique", "유니크"],
  ["legendary", "레전드리"]
]);
const POTENTIAL_GRADE_RANK = new Map([
  ["rare", 1],
  ["epic", 2],
  ["unique", 3],
  ["legendary", 4]
]);
const GLOBAL_ACCESSORY_SLOT_BY_LABEL = new Map([
  ["반지", "ring"],
  ["펜던트", "pendant"],
  ["얼굴장식", "face"],
  ["눈장식", "eye"],
  ["귀고리", "earring"]
]);
const ACCESSORY_EQUIPMENT_SLOT_LABELS = new Set([
  "반지",
  "펜던트",
  "벨트",
  "귀고리",
  "눈장식",
  "얼굴장식"
]);
const ARMOR_EQUIPMENT_SLOT_LABELS = new Set([
  "모자",
  "상의",
  "한벌옷",
  "하의",
  "신발",
  "장갑",
  "망토",
  "어깨장식"
]);
const USER_EXCLUDED_MARKET_ITEM_NAMES = new Set([
  "크리스탈 웬투스 뱃지",
  "로얄 블랙메탈 숄더",
  "혼테일의 목걸이",
  "실버블라썸 링",
  "아쿠아틱 레터 눈장식",
  "응축된 힘의 결정석",
  "지옥의 불꽃"
]);
const RAW_STAT_DEFINITIONS = new Map([
  ["str_flat", { code: "str", label: "STR", unit: "flat" }],
  ["dex_flat", { code: "dex", label: "DEX", unit: "flat" }],
  ["int_flat", { code: "int", label: "INT", unit: "flat" }],
  ["luk_flat", { code: "luk", label: "LUK", unit: "flat" }],
  ["all_stat_pct", { code: "all_stat", label: "올스탯", unit: "pct" }],
  ["hp_flat", { code: "hp", label: "최대 HP", unit: "flat" }],
  ["mp_flat", { code: "mp", label: "최대 MP", unit: "flat" }],
  ["attack_flat", { code: "attack", label: "공격력", unit: "flat" }],
  ["magic_attack_flat", { code: "magic_attack", label: "마력", unit: "flat" }],
  ["defense_flat", { code: "defense", label: "방어력", unit: "flat" }],
  ["speed_flat", { code: "speed", label: "이동속도", unit: "flat" }],
  ["jump_flat", { code: "jump", label: "점프력", unit: "flat" }],
  ["damage_pct", { code: "damage", label: "데미지", unit: "pct" }],
  ["boss_damage_pct", { code: "boss_damage", label: "보스 몬스터 공격 시 데미지", unit: "pct" }],
  ["ignore_defense_pct", { code: "ignore_defense", label: "몬스터 방어율 무시", unit: "pct" }],
  ["arcane_force_flat", { code: "arcane_force", label: "아케인포스", unit: "flat" }],
  ["authentic_force_flat", { code: "authentic_force", label: "어센틱포스", unit: "flat" }],
  ["hp_recovery_flat", { code: "hp_recovery", label: "HP 회복력", unit: "flat" }],
  ["mp_recovery_flat", { code: "mp_recovery", label: "MP 회복력", unit: "flat" }],
  ["additional_exp_flat", { code: "additional_exp", label: "추가 경험치", unit: "flat" }],
  ["exp_pct", { code: "exp", label: "경험치 획득량", unit: "pct" }],
  ["special_ring_exp_pct", { code: "special_ring_exp", label: "경험치 획득량", unit: "pct" }],
  ["special_ring_meso_pct", { code: "special_ring_meso", label: "메소 획득량", unit: "pct" }],
  ["special_ring_drop_pct", { code: "special_ring_drop", label: "아이템 드롭률", unit: "pct" }],
  ["party_quest_exp_pct", { code: "party_quest_exp", label: "파티 퀘스트 경험치", unit: "pct" }],
  ["craft_flat", { code: "craft", label: "장비 제작 숙련도", unit: "flat" }]
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizedPath(value) {
  return String(value).split(path.sep).join("/");
}

function compareVersion(left, right) {
  const leftParts = String(left || "").match(/\d+/gu)?.map(Number) || [];
  const rightParts = String(right || "").match(/\d+/gu)?.map(Number) || [];
  if (!leftParts.length || !rightParts.length) return null;
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function validVersionAtLeast(value, minimum) {
  const comparison = compareVersion(value, minimum);
  return comparison !== null && comparison >= 0;
}

async function listJsonlFiles(root) {
  const output = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "ko"));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl")) output.push(fullPath);
    }
  }
  try {
    await visit(root);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return output;
}

function parseJsonLines(text, relativePath) {
  const lines = text.split(/\r?\n/u).filter((line) => line.trim());
  if (!lines.length) throw new Error(`${relativePath}: 빈 JSONL 파일입니다.`);
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${relativePath}:${index + 1}: JSON 파싱 오류: ${error.message}`);
    }
  });
}

function verifyIntegrity(document, relativePath) {
  const integrity = document.integrity;
  if (!integrity || integrity.algorithm !== "SHA-256" || !/^[0-9a-f]{64}$/u.test(integrity.payload_sha256 || "")) {
    throw new Error(`${relativePath}: 신규 원본에 SHA-256 무결성 정보가 없습니다.`);
  }
  const { integrity: _discarded, ...unsigned } = document;
  const actual = sha256(JSON.stringify(unsigned));
  if (actual !== integrity.payload_sha256) {
    throw new Error(`${relativePath}: 원본 SHA-256 무결성 검증에 실패했습니다.`);
  }
}

function nullableInteger(value, label) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = typeof value === "string" ? value.replace(/[\s,]/gu, "") : value;
  const number = Number(normalized);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${label}: 0 이상의 안전한 정수가 아닙니다.`);
  }
  return number;
}

function semanticPriceMinimum(value) {
  const parsed = nullableInteger(value, "검색 최소값");
  return parsed === 0 ? null : parsed;
}

function semanticPriceMaximum(value) {
  const parsed = nullableInteger(value, "검색 최대값");
  return parsed === 0 ? null : parsed;
}

function sameNullable(left, right) {
  return left === right;
}

function sortedStrings(values) {
  return [...(Array.isArray(values) ? values : [])].map(String).sort((left, right) =>
    left.localeCompare(right, "ko")
  );
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumberOrNull(value) {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function assertVersion(value, pattern, label, relativePath) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${relativePath}: ${label} 버전이 없거나 형식이 잘못되었습니다.`);
  }
  return value;
}

function allowedTaskLanes(query) {
  if (query.starforce_min != null || query.starforce_max != null) return new Set(["starforce"]);
  const logical = new Set(query.logical_lanes || []);
  if (query.potential_filter) {
    return new Set([
      [...logical].some((value) => value.startsWith("POT_MITRA"))
        ? "mitra"
        : [...logical].some((value) => value === "POT_ACCESSORY_DROP_MESO" ||
          value.startsWith("POT_ACCESSORY_DROP_") || value.startsWith("POT_ACCESSORY_MESO_")) ? "accessory"
          : query.potential_filter.capability_id === "ALL_STAT_PCT" ? "allstat" : "main"
    ]);
  }
  const lanes = new Set(["baseline", "audit"]);
  if (logical.has("POT_MAX_HP")) lanes.add("hp");
  if (logical.has("POT_HAT_COOLDOWN")) lanes.add("hat");
  if (logical.has("POT_GLOVE_CRITICAL_DAMAGE")) lanes.add("glove");
  if (logical.has("POT_ACCESSORY_DROP_MESO")) lanes.add("accessory");
  if ([...logical].some((value) => value.startsWith("POT_MITRA"))) lanes.add("mitra");
  return lanes;
}

function comparableQueryContract(query) {
  return {
    catalog_id: query.catalog_id ?? null,
    catalog_ids: sortedStrings(query.catalog_ids || [query.catalog_id].filter(Boolean)),
    allowed_names: sortedStrings(query.allowed_names || [query.exact_name].filter(Boolean)),
    keyword: query.keyword ?? query.search_keyword ?? query.exact_name ?? "",
    search_scope: query.search_scope || null,
    exact_match: query.exact_match !== false,
    priority: query.priority,
    starforce_min: query.starforce_min ?? null,
    starforce_max: query.starforce_max ?? null,
    price_min_meso: query.price_min_meso ?? null,
    price_max_meso: query.price_max_meso ?? null,
    item_category_filter: query.item_category_filter ?? null,
    equipment_subcategory_filter: query.equipment_subcategory_filter ?? null,
    result_category_path_filter: query.result_category_path_filter ?? null,
    potential_filter: query.potential_filter || null,
    post_classify_profiles: sortedStrings(query.post_classify_profiles)
  };
}

function versionlessQueryId(queryId) {
  const value = String(queryId || "");
  const separator = value.indexOf(":");
  return separator > 0 ? value.slice(separator + 1) : "";
}

function findCompatibleCanonicalQuery(query, canonicalQueries) {
  const exact = canonicalQueries.get(query.query_id);
  if (exact) return exact;
  const identity = versionlessQueryId(query.query_id);
  if (!identity) return null;
  // query_id의 카탈로그 버전만 바뀐 경우만 구버전 원본으로 승계한다.
  // 검색 계약이 같더라도 임의로 만든 query_id는 현재 allowlist로 인정하지 않는다.
  const sameIdentity = [...canonicalQueries.values()].filter((candidate) =>
    versionlessQueryId(candidate.query_id) === identity
  );
  if (sameIdentity.length !== 1) return null;
  const actualContract = stableStringify(comparableQueryContract(query));
  return stableStringify(comparableQueryContract(sameIdentity[0])) === actualContract
    ? sameIdentity[0]
    : null;
}

function assertCanonicalQuery(document, canonicalQueries, relativePath) {
  const capture = document.capture || {};
  const query = capture.query_task;
  const captureCatalog = capture.catalog;
  if (!query || typeof query !== "object") throw new Error(`${relativePath}: query_task가 없습니다.`);
  if (!captureCatalog || typeof captureCatalog !== "object") {
    throw new Error(`${relativePath}: capture.catalog가 없습니다.`);
  }
  for (const key of [
    "task_id", "query_id", "catalog_id", "catalog_ids", "allowed_names", "keyword",
    "search_scope", "exact_match", "lane", "priority", "starforce_min", "starforce_max",
    "price_min_meso", "price_max_meso", "potential_filter", "post_classify_profiles"
  ]) {
    if (!Object.hasOwn(query, key)) throw new Error(`${relativePath}: query_task.${key}가 없습니다.`);
  }
  if (!String(query.query_id || "").startsWith(`${captureCatalog.version}:`)) {
    throw new Error(`${relativePath}: query_id와 capture.catalog 버전이 일치하지 않습니다.`);
  }
  // Catalog releases intentionally include their version in query_id. A
  // catalog-only extension update therefore changes the identifier even when
  // the actual sold-search contract is byte-for-byte equivalent. Resolve such
  // captures by their physical query contract so capture.v2 data produced by
  // extension 0.7.7+ remains reusable across compatible catalog revisions.
  const canonical = findCompatibleCanonicalQuery(query, canonicalQueries);
  if (!canonical) {
    throw new Error(`${relativePath}: 현재 고정 조사 목록과 호환되는 검색 조건이 아닙니다.`);
  }

  const expected = comparableQueryContract(canonical);
  const actual = comparableQueryContract(query);
  if (stableStringify(actual) !== stableStringify(expected)) {
    throw new Error(`${relativePath}: query_task가 현재 고정 조사 조건과 일치하지 않습니다.`);
  }
  if (Object.hasOwn(query, "page_sweep") &&
      stableStringify(query.page_sweep ?? null) !== stableStringify(canonical.page_sweep ?? null)) {
    throw new Error(`${relativePath}: query_task.page_sweep가 현재 카탈로그 정책과 다릅니다.`);
  }
  const lane = String(query.lane || "");
  if (!allowedTaskLanes(canonical).has(lane) || query.task_id !== `${query.query_id}#${lane}`) {
    throw new Error(`${relativePath}: query_task의 작업 lane 또는 task_id가 올바르지 않습니다.`);
  }

  const expectedCatalog = {
    catalog_id: canonical.catalog_id ?? null,
    catalog_ids: expected.catalog_ids,
    exact_name: canonical.exact_match === false ? null : expected.keyword,
    search_keyword: expected.keyword,
    allowed_names: expected.allowed_names,
    base_level: canonical.level ?? null,
    slot: canonical.slot ?? null
  };
  const actualCatalog = {
    catalog_id: captureCatalog.catalog_id ?? null,
    catalog_ids: sortedStrings(captureCatalog.catalog_ids),
    exact_name: captureCatalog.exact_name ?? null,
    search_keyword: captureCatalog.search_keyword ?? "",
    allowed_names: sortedStrings(captureCatalog.allowed_names),
    base_level: captureCatalog.base_level ?? null,
    slot: captureCatalog.slot ?? null
  };
  if (stableStringify(actualCatalog) !== stableStringify(expectedCatalog)) {
    throw new Error(`${relativePath}: capture.catalog가 query_id의 현재 정의와 다릅니다.`);
  }
  return canonical;
}

function validateQueryEvidence(document, canonical, preset, relativePath) {
  const capture = document.capture || {};
  const query = capture.query_task;
  const context = capture.search_context;
  if (!Object.prototype.hasOwnProperty.call(query, "price_min_meso") ||
      !Object.prototype.hasOwnProperty.call(query, "price_max_meso")) {
    throw new Error(`${relativePath}: 신규 가격 검색 조건이 query_task에 없습니다.`);
  }
  if (capture.source_site !== "https://auction.maplestory.nexon.com" || capture.source_path !== "/price") {
    throw new Error(`${relativePath}: 공식 경매장 시세 페이지 원본이 아닙니다.`);
  }
  if (context?.page_kind !== "sold" || context?.sort !== "trade_date_desc" ||
      context?.filter_search_applied !== true || context?.price_search_key_present !== true) {
    throw new Error(`${relativePath}: 판매 완료 필터 검색의 검증 근거가 아닙니다.`);
  }
  const expectedPage = nullableInteger(capture.attempt?.page, "attempt.page");
  const contextPage = nullableInteger(context.page, "search_context.page");
  const summaryPage = nullableInteger(capture.result_summary?.current_page, "result_summary.current_page");
  if (expectedPage == null || expectedPage < 1 || contextPage !== expectedPage || summaryPage !== expectedPage) {
    throw new Error(`${relativePath}: attempt/search_context/result_summary의 페이지가 일치하지 않습니다.`);
  }
  const pageItemCount = nullableInteger(capture.result_summary?.page_item_count, "page_item_count");
  const collection = capture.collection_summary || {};
  const strictEmptyDefaultPage =
    document.items.length === 0 &&
    pageItemCount === 0 &&
    capture.result_summary?.total_results === 0 &&
    capture.result_summary?.has_next_page === false &&
    Array.isArray(capture.result_summary?.boundary_keys) &&
    capture.result_summary.boundary_keys.length === 0 &&
    ["source_page_rows", "page_rows", "exact_name_rows", "allowed_name_rows",
      "excluded_name_mismatches", "collected_items", "failed_items"]
      .every((key) => collection[key] === 0) &&
    Array.isArray(collection.failures) &&
    collection.failures.length === 0 &&
    context.limit === 20 &&
    capture.result_summary?.requested_page_limit === 20 &&
    capture.result_summary?.displayed_page_limit == null;
  const verifiedPageLimit = strictEmptyDefaultPage ? 20 : 60;
  if (context.limit !== verifiedPageLimit ||
      capture.result_summary?.requested_page_limit !== verifiedPageLimit) {
    throw new Error(`${relativePath}: 신규 원본은 페이지당 60개 설정으로 수집해야 합니다.`);
  }
  const displayedLimit = capture.result_summary?.displayed_page_limit;
  if (pageItemCount > 0 && displayedLimit !== 60) {
    throw new Error(`${relativePath}: 60개씩 보기 적용 근거가 없습니다.`);
  }
  if (pageItemCount === 0 && ![null, undefined, 60].includes(displayedLimit)) {
    throw new Error(`${relativePath}: 빈 결과의 페이지 크기 근거가 올바르지 않습니다.`);
  }

  const matcherQuery = {
    keyword: canonical.search_keyword ?? canonical.exact_name ?? "",
    search_scope: canonical.search_scope || null,
    exact_match: canonical.exact_match !== false,
    page_limit: verifiedPageLimit,
    starforce_min: canonical.starforce_min ?? null,
    starforce_max: canonical.starforce_max ?? null,
    price_min_meso: canonical.price_min_meso ?? null,
    price_max_meso: canonical.price_max_meso ?? null,
    item_category_filter: canonical.item_category_filter ?? null,
    equipment_subcategory_filter: canonical.equipment_subcategory_filter ?? null,
    server_filter: canonical.potential_filter ? {
      code: canonical.potential_filter.auction_code,
      minimum: canonical.potential_filter.minimum,
      maximum: canonical.potential_filter.maximum ?? null
    } : null
  };
  if (!preset.queryMatchesSearchContext(context, matcherQuery, {
    page: expectedPage,
    limit: verifiedPageLimit
  })) {
    throw new Error(`${relativePath}: 화면의 검색 조건이 현재 query_id와 일치하지 않습니다.`);
  }
  const price = context?.filters?.price;
  if (!price || typeof price !== "object") {
    throw new Error(`${relativePath}: 화면에서 확인한 가격 필터 근거가 없습니다.`);
  }

  const expectedPriceMin = semanticPriceMinimum(query.price_min_meso);
  const expectedPriceMax = semanticPriceMaximum(query.price_max_meso);
  const observedPriceMin = semanticPriceMinimum(price.minimum_meso);
  const observedPriceMax = semanticPriceMaximum(price.maximum_meso);
  if (!sameNullable(expectedPriceMin, observedPriceMin) ||
      !sameNullable(expectedPriceMax, observedPriceMax)) {
    throw new Error(`${relativePath}: 제출한 가격 조건과 결과 화면의 가격 조건이 다릅니다.`);
  }

  const enhancement = context?.filters?.enhancement || {};
  const expectedStarforceMin = nullableInteger(query.starforce_min, "스타포스 최소값");
  const expectedStarforceMax = nullableInteger(query.starforce_max, "스타포스 최대값");
  const observedStarforceMin = nullableInteger(enhancement.starforce_min, "화면 스타포스 최소값");
  const observedStarforceMax = nullableInteger(enhancement.starforce_max, "화면 스타포스 최대값");
  const minimumMatches = expectedStarforceMin === observedStarforceMin ||
    (expectedStarforceMin === null && observedStarforceMin === 0);
  const maximumMatches = expectedStarforceMax === observedStarforceMax ||
    (expectedStarforceMin === 0 && expectedStarforceMax === 0 && observedStarforceMax === null);
  if (!minimumMatches || !maximumMatches) {
    throw new Error(`${relativePath}: 제출한 스타포스 조건과 결과 화면의 조건이 다릅니다.`);
  }

  const expectedPotential = query.potential_filter || null;
  const observedPotential = Array.isArray(enhancement.potential) ? enhancement.potential : [];
  if (expectedPotential) {
    const matched = observedPotential.some((candidate) =>
      candidate?.code === expectedPotential.auction_code &&
      nullableInteger(candidate?.minimum, "잠재 최소값") ===
        nullableInteger(expectedPotential.minimum, "잠재 최소값")
    );
    if (!matched) throw new Error(`${relativePath}: 제출한 잠재 조건과 결과 화면의 조건이 다릅니다.`);
  } else if (observedPotential.length > 0) {
    throw new Error(`${relativePath}: 잠재 조건 없음 검색에 잠재 필터가 남아 있습니다.`);
  }

  return {
    query_id: query.query_id,
    task_id: query.task_id || null,
    search_scope: query.search_scope || "catalog_item",
    price_min_meso: expectedPriceMin,
    price_max_meso: expectedPriceMax,
    // Preserve exact 0-star provenance. Zero is an alias only on the observed
    // unrestricted UI minimum, never in the submitted query contract.
    starforce_min: query.starforce_min ?? null,
    starforce_max: query.starforce_max ?? null,
    item_category_filter: query.item_category_filter ?? null,
    equipment_subcategory_filter: query.equipment_subcategory_filter ?? null,
    result_category_path_filter: query.result_category_path_filter ?? null,
    potential_filter: expectedPotential ? {
      capability_id: expectedPotential.capability_id || null,
      auction_code: expectedPotential.auction_code || null,
      minimum: nullableInteger(expectedPotential.minimum, "잠재 최소값"),
      maximum: expectedPotential.maximum == null
        ? null
        : nullableInteger(expectedPotential.maximum, "잠재 최대값"),
      evidence_status: expectedPotential.evidence_status || null,
      strict_semantics: expectedPotential.strict_semantics === true
    } : null
  };
}

function strictNonNegativeInteger(value, label, relativePath) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${relativePath}: ${label}가 0 이상의 안전한 정수가 아닙니다.`);
  }
  return value;
}

function validateCaptureSummary(document, relativePath, collector, canonical) {
  const collection = document.capture?.collection_summary;
  if (!collection || typeof collection !== "object") {
    throw new Error(`${relativePath}: collection_summary가 없습니다.`);
  }
  if (!Array.isArray(collection.failures)) {
    throw new Error(`${relativePath}: collection_summary.failures가 배열이 아닙니다.`);
  }
  const failedRows = strictNonNegativeInteger(collection.failed_items, "failed_items", relativePath);
  const collectedRows = strictNonNegativeInteger(collection.collected_items, "collected_items", relativePath);
  if (failedRows !== 0 || collection.failures.length !== 0) {
    throw new Error(`${relativePath}: 파싱 실패 매물이 포함되어 있어 전체 파일을 적용하지 않습니다.`);
  }
  if (collectedRows !== document.items.length) {
    throw new Error(`${relativePath}: 수집 완료 건수와 items 수가 다릅니다.`);
  }
  const summary = document.capture?.result_summary || {};
  const sourceRows = strictNonNegativeInteger(collection.source_page_rows, "source_page_rows", relativePath);
  const pageRows = strictNonNegativeInteger(collection.page_rows, "page_rows", relativePath);
  const allowedRows = strictNonNegativeInteger(collection.allowed_name_rows, "allowed_name_rows", relativePath);
  const exactRows = strictNonNegativeInteger(collection.exact_name_rows, "exact_name_rows", relativePath);
  const excludedRows = strictNonNegativeInteger(
    collection.excluded_name_mismatches,
    "excluded_name_mismatches",
    relativePath
  );
  const locallyExcludedCategoryRows = strictNonNegativeInteger(
    collection.locally_excluded_category_rows ?? 0,
    "locally_excluded_category_rows",
    relativePath
  );
  const locallyExcludedRangeRows = strictNonNegativeInteger(
    collection.locally_excluded_range_rows ?? 0,
    "locally_excluded_range_rows",
    relativePath
  );
  const locallyExcludedRows = locallyExcludedCategoryRows + locallyExcludedRangeRows;
  if (locallyExcludedRows > 0 && canonical?.group !== "global_category_potential") {
    throw new Error(`${relativePath}: 전역 장비 잠재 검색이 아닌데 로컬 분류 제외 건수가 있습니다.`);
  }
  if (sourceRows > 60) {
    throw new Error(`${relativePath}: 60개씩 보기 원본 건수가 60건을 초과합니다.`);
  }
  if (summary.page_item_count !== sourceRows || pageRows > sourceRows || allowedRows > pageRows ||
      exactRows !== allowedRows || excludedRows !== pageRows - allowedRows ||
      collectedRows + failedRows + locallyExcludedRows !== allowedRows) {
    throw new Error(`${relativePath}: 페이지/허용 장비/수집 건수의 불변식이 맞지 않습니다.`);
  }
  const cappedRows = sourceRows - pageRows;
  const qualityWarnings = document.capture?.quality_warnings;
  if (!Array.isArray(qualityWarnings)) {
    throw new Error(`${relativePath}: capture.quality_warnings가 배열이 아닙니다.`);
  }
  const capWarnings = qualityWarnings.filter((warning) =>
    /^result_cap_rows_excluded:/u.test(String(warning))
  );
  const expectedCapWarning = `result_cap_rows_excluded:${cappedRows}`;
  if ((cappedRows > 0 && (capWarnings.length !== 1 || capWarnings[0] !== expectedCapWarning)) ||
      (cappedRows === 0 && capWarnings.length !== 0)) {
    throw new Error(`${relativePath}: 결과 상한으로 제외한 원본 건수 근거가 일치하지 않습니다.`);
  }
  for (const [kind, count] of [
    ["category", locallyExcludedCategoryRows],
    ["range", locallyExcludedRangeRows]
  ]) {
    const warnings = qualityWarnings.filter((warning) =>
      new RegExp(`^global_potential_${kind}_rows_excluded:`, "u").test(String(warning))
    );
    const expectedWarning = `global_potential_${kind}_rows_excluded:${count}`;
    if ((count > 0 && (warnings.length !== 1 || warnings[0] !== expectedWarning)) ||
        (count === 0 && warnings.length !== 0)) {
      throw new Error(`${relativePath}: 로컬 ${kind} 제외 건수 근거가 일치하지 않습니다.`);
    }
  }
  const rowIndexes = new Set();
  const resultRanks = new Set();
  for (const item of document.items) {
    if (!Number.isInteger(item.row_index) || item.row_index < 1 || item.row_index > pageRows ||
        rowIndexes.has(item.row_index)) {
      throw new Error(`${relativePath}: 페이지 내 row_index가 중복되거나 범위를 벗어났습니다.`);
    }
    rowIndexes.add(item.row_index);
    if (!Number.isInteger(item.result_rank) || item.result_rank < 1 || item.result_rank > pageRows ||
        resultRanks.has(item.result_rank)) {
      throw new Error(`${relativePath}: 페이지 내 result_rank가 중복되거나 범위를 벗어났습니다.`);
    }
    resultRanks.add(item.result_rank);
  }
  const expectedBoundaries = document.items.map((item) => `native:${item.listing?.listing_id}`);
  if (stableStringify(summary.boundary_keys || []) !== stableStringify(expectedBoundaries)) {
    throw new Error(`${relativePath}: boundary_keys가 저장된 매물 순서와 일치하지 않습니다.`);
  }
  const expectedPageSignature = collector.createPageSignature(document.items);
  if (summary.page_signature !== expectedPageSignature) {
    throw new Error(`${relativePath}: 페이지 서명이 저장된 매물과 일치하지 않습니다.`);
  }
  return {
    sourceRows,
    pageRows,
    allowedRows,
    cappedRows,
    locallyExcludedCategoryRows,
    locallyExcludedRangeRows,
    locallyExcludedRows
  };
}

function validatePotentialSection(section, applicable, prefix, options = {}) {
  if (!plainObject(section) || !Array.isArray(section.lines)) {
    throw new Error(`${prefix}: 잠재 정보 또는 잠재 줄 배열이 없습니다.`);
  }
  if (typeof section.collected !== "boolean") {
    throw new Error(`${prefix}: 잠재 수집 여부가 올바르지 않습니다.`);
  }
  if (applicable) {
    if (section.collected !== true || (options.requireApiSource && section.grade_source !== "api_tooltip") ||
        !["legendary", "unique", "epic", "rare", "none"].includes(section.grade)) {
      throw new Error(`${prefix}: API 잠재 등급을 확정할 수 없습니다.`);
    }
  } else {
    if (section.lines.length > 0) {
      throw new Error(`${prefix}: 잠재 미적용 장비에 잠재 줄이 있습니다.`);
    }
    if (section.grade != null && section.grade !== "none") {
      throw new Error(`${prefix}: 잠재 미적용 장비의 등급 값이 올바르지 않습니다.`);
    }
  }
  if (section.grade === "none" && section.lines.length > 0) {
    throw new Error(`${prefix}: 잠재 없음 등급에 옵션 줄이 있습니다.`);
  }
  if (section.grade == null && section.lines.length > 0) {
    throw new Error(`${prefix}: 잠재 등급 없이 옵션 줄이 있습니다.`);
  }
  if (section.grade && section.grade !== "none" && section.lines.length === 0) {
    throw new Error(`${prefix}: 잠재 등급은 있지만 옵션 줄이 없습니다.`);
  }
  if (options.requireApiSource && (applicable || section.collected || section.grade != null)) {
    const expectedGradeRaw = POTENTIAL_GRADE_LABEL.get(section.grade);
    const heading = typeof section.raw_heading === "string"
      ? section.raw_heading.trim()
      : "";
    const headingMatches = heading.endsWith(`: ${expectedGradeRaw}`) || (
      applicable === false &&
      section.grade === "none" &&
      heading.endsWith(": 강화 불가")
    );
    if (section.grade_raw !== expectedGradeRaw || typeof section.raw_heading !== "string" ||
        !headingMatches) {
      throw new Error(`${prefix}: API 잠재 제목과 구조화 등급이 일치하지 않습니다.`);
    }
  } else if (options.requireApiSource && (
    section.collected !== false || section.grade_source != null || section.grade_raw != null ||
    section.raw_heading != null
  )) {
    throw new Error(`${prefix}: 잠재 미적용 장비의 빈 API 잠재 구조가 올바르지 않습니다.`);
  }
  for (const [index, line] of section.lines.entries()) {
    const requiredLineFields = ["line_index", "code", "value", "unit", "tier", "is_prime", "params", "raw"];
    if (!plainObject(line) || requiredLineFields.some((key) => !Object.hasOwn(line, key)) ||
        line.line_index !== index + 1 || line.line_index > 3) {
      throw new Error(`${prefix}: 잠재 줄 번호가 올바르지 않습니다.`);
    }
    if (typeof line.code !== "string" || !POTENTIAL_CODE_PATTERN.test(line.code) ||
        !finiteNumberOrNull(line.value ?? null) ||
        !POTENTIAL_UNITS.has(line.unit ?? null) || !POTENTIAL_TIERS.has(line.tier ?? null) ||
        !plainObject(line.params) || ![true, false, null].includes(line.is_prime ?? null) ||
        typeof line.raw !== "string" || !line.raw.trim()) {
      throw new Error(`${prefix}: 구조화 잠재 줄의 code/value/unit/tier/params가 올바르지 않습니다.`);
    }

    if (options.requireApiSource) {
      const apiGrade = line.evidence?.api_line_grade;
      if (!plainObject(line.evidence) || !Number.isInteger(apiGrade) ||
          !POTENTIAL_GRADE_BY_API_VALUE.has(apiGrade)) {
        throw new Error(`${prefix}: 잠재 ${index + 1}줄의 API 등급 근거가 없습니다.`);
      }
      const expectedTier = POTENTIAL_GRADE_BY_API_VALUE.get(apiGrade);
      const expectedPrime = section.grade && expectedTier ? section.grade === expectedTier : null;
      if ((line.tier ?? null) !== expectedTier || (line.is_prime ?? null) !== expectedPrime) {
        throw new Error(`${prefix}: 잠재 ${index + 1}줄의 API 등급·첫 줄 여부가 일치하지 않습니다.`);
      }
      if (expectedTier && section.grade !== "none") {
        const sectionRank = POTENTIAL_GRADE_RANK.get(section.grade);
        const lineRank = POTENTIAL_GRADE_RANK.get(expectedTier);
        if (lineRank > sectionRank) {
          throw new Error(`${prefix}: 잠재 ${index + 1}줄의 등급이 잠재 전체 등급 범위를 벗어납니다.`);
        }
      }
    }

    if (typeof options.parsePotentialOption === "function") {
      const parsed = options.parsePotentialOption(line.raw);
      const observed = {
        code: line.code,
        value: line.value ?? null,
        unit: line.unit ?? null,
        params: line.params
      };
      const expected = {
        code: parsed.code,
        value: parsed.value ?? null,
        unit: parsed.unit ?? null,
        params: parsed.params
      };
      if (stableStringify(observed) !== stableStringify(expected)) {
        throw new Error(`${prefix}: 잠재 ${index + 1}줄의 원문과 구조화 값이 일치하지 않습니다.`);
      }
    }
  }
  if (section.lines.length > 3) throw new Error(`${prefix}: 잠재 줄이 3개를 초과합니다.`);
}

function omittedZeroRawStatLine(line, stats) {
  if (!plainObject(line) || !plainObject(stats?.total) || line.total !== null ||
      line.component_sum_matches_total !== null || Object.hasOwn(stats.total, line.key) ||
      !Array.isArray(line.breakdown) || line.breakdown.length === 0) {
    return false;
  }
  const definition = RAW_STAT_DEFINITIONS.get(line.key);
  if (!definition || line.code !== definition.code || line.label !== definition.label ||
      line.unit !== definition.unit || String(line.raw || "").trim() !== definition.label) {
    return false;
  }
  const sources = new Set();
  let componentSum = 0;
  for (const token of line.breakdown) {
    if (!plainObject(token) || typeof token.value !== "number" || !Number.isFinite(token.value) ||
        token.unit !== line.unit || !STAT_SOURCES.slice(0, -1).includes(token.source_hint) ||
        sources.has(token.source_hint)) {
      return false;
    }
    sources.add(token.source_hint);
    componentSum += token.value;
  }
  return componentSum === 0;
}

function validateRawStats(stats, prefix, options = {}) {
  if (!plainObject(stats) || stats.normalized !== false || stats.collected !== true ||
      !Array.isArray(stats.lines)) {
    throw new Error(`${prefix}: API 스탯 원본 구조가 올바르지 않습니다.`);
  }

  if (stats.lines.length === 0) {
    const emptyBuckets = STAT_SOURCES.every((source) =>
      plainObject(stats[source]) && Object.keys(stats[source]).length === 0
    );
    if (options.allowEmpty === true && emptyBuckets) return;
    throw new Error(`${prefix}: API 스탯 원본 구조가 올바르지 않습니다.`);
  }

  const maps = {};
  const mapKeys = new Set();
  for (const source of STAT_SOURCES) {
    const bucket = stats[source];
    if (!plainObject(bucket)) throw new Error(`${prefix}: stats.${source} 원본이 없습니다.`);
    maps[source] = bucket;
    for (const [key, value] of Object.entries(bucket)) {
      if (!key || typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${prefix}: stats.${source}.${key || "(빈 키)"} 값이 올바르지 않습니다.`);
      }
      mapKeys.add(key);
    }
  }

  const lineKeys = new Set();
  for (const [index, line] of stats.lines.entries()) {
    const definition = RAW_STAT_DEFINITIONS.get(line?.key);
    const omittedZeroTotal = omittedZeroRawStatLine(line, stats);
    if (!plainObject(line) || typeof line.code !== "string" || !line.code.trim() ||
        typeof line.key !== "string" || !line.key.trim() || lineKeys.has(line.key) ||
        typeof line.label !== "string" || !line.label.trim() ||
        !definition || line.code !== definition.code || line.label !== definition.label ||
        line.unit !== definition.unit ||
        (!omittedZeroTotal && (typeof line.total !== "number" || !Number.isFinite(line.total))) ||
        !Array.isArray(line.breakdown) || typeof line.raw !== "string" || !line.raw.trim()) {
      throw new Error(`${prefix}: 스탯 ${index + 1}줄의 구조가 올바르지 않습니다.`);
    }
    lineKeys.add(line.key);

    const bySource = new Map();
    for (const token of line.breakdown) {
      if (!plainObject(token) || typeof token.value !== "number" || !Number.isFinite(token.value) ||
          token.unit !== line.unit || !STAT_SOURCES.slice(0, -1).includes(token.source_hint) ||
          bySource.has(token.source_hint)) {
        throw new Error(`${prefix}: 스탯 ${index + 1}줄의 출처별 값이 올바르지 않습니다.`);
      }
      bySource.set(token.source_hint, token.value);
    }

    for (const source of STAT_SOURCES.slice(0, -1)) {
      const inMap = Object.hasOwn(maps[source], line.key);
      if (inMap !== bySource.has(source) || (inMap && maps[source][line.key] !== bySource.get(source))) {
        throw new Error(`${prefix}: 스탯 ${index + 1}줄과 ${source} 원본이 일치하지 않습니다.`);
      }
    }
    const hasTotal = Object.hasOwn(maps.total, line.key);
    if ((omittedZeroTotal && hasTotal) ||
        (!omittedZeroTotal && (!hasTotal || maps.total[line.key] !== line.total))) {
      throw new Error(`${prefix}: 스탯 ${index + 1}줄과 total 원본이 일치하지 않습니다.`);
    }
    const componentSum = [...bySource.values()].reduce((sum, value) => sum + value, 0);
    const expectedMatch = omittedZeroTotal ? null : bySource.size === 0 ? null : componentSum === line.total;
    if ((line.component_sum_matches_total ?? null) !== expectedMatch) {
      throw new Error(`${prefix}: 스탯 ${index + 1}줄의 합계 검증 값이 올바르지 않습니다.`);
    }
  }

  if (lineKeys.size !== mapKeys.size || [...mapKeys].some((key) => !lineKeys.has(key))) {
    throw new Error(`${prefix}: 스탯 줄과 출처별 원본의 키 집합이 다릅니다.`);
  }
}

function prepareCaptureForNormalization(document) {
  const repairs = new Map();
  for (const [recordIndex, record] of (document.items || []).entries()) {
    for (const line of record.item?.stats?.lines || []) {
      if (!omittedZeroRawStatLine(line, record.item.stats)) continue;
      const keys = repairs.get(recordIndex) || [];
      keys.push(line.key);
      repairs.set(recordIndex, keys);
    }
  }
  if (repairs.size === 0) return { document, repairs };

  const normalizedInput = structuredClone(document);
  for (const [recordIndex, keys] of repairs) {
    const stats = normalizedInput.items[recordIndex].item.stats;
    for (const key of keys) {
      const line = stats.lines.find((candidate) => candidate.key === key);
      line.total = 0;
      line.component_sum_matches_total = true;
      stats.total[key] = 0;
    }
  }
  return { document: normalizedInput, repairs };
}

function validateNativeSoldRecord(record, catalogItem, relativePath, rowIndex, options = {}) {
  const prefix = `${relativePath}#${rowIndex}`;
  if (record.listing?.status !== "sold") throw new Error(`${prefix}: 판매 완료 매물이 아닙니다.`);
  if (record.listing?.listing_id_source !== "native" || !HASH_PATTERN.test(record.listing?.listing_id || "")) {
    throw new Error(`${prefix}: 신규 API 원본 거래 ID의 SHA-256 값이 없습니다.`);
  }
  if (record.item?.item_id_source !== "native" || !HASH_PATTERN.test(record.item?.item_id || "")) {
    throw new Error(`${prefix}: 신규 API 원본 아이템 ID의 SHA-256 값이 없습니다.`);
  }
  if (!DECIMAL_PATTERN.test(record.listing?.price_meso || "") || Number(record.listing.price_meso) <= 0) {
    throw new Error(`${prefix}: 거래 가격이 올바른 메소 정수 문자열이 아닙니다.`);
  }
  if (!Number.isSafeInteger(Number(record.listing.price_meso))) {
    throw new Error(`${prefix}: 거래 가격이 JavaScript 안전 정수 범위를 벗어납니다.`);
  }
  if (!ISO_DATE_PATTERN.test(record.listing?.sold_at || "") || Number.isNaN(Date.parse(record.listing.sold_at))) {
    throw new Error(`${prefix}: 거래 완료 시각이 없습니다.`);
  }
  if (!String(record.item?.name || "").trim()) throw new Error(`${prefix}: 장비명이 없습니다.`);
  if (options.requireRawStats) validateRawStats(record.item?.stats, `${prefix} 스탯`, {
    allowEmpty: options.allowEmptyRawStats === true
  });
  validatePotentialSection(record.item?.potential, catalogItem.potential_eligible, `${prefix} 윗잠`, options);
  validatePotentialSection(record.item?.additional_potential, catalogItem.potential_eligible, `${prefix} 에디셔널`, options);
}

function qualityForRecord(record) {
  const potentialLines = [
    ...(record.item?.potential?.lines || []),
    ...(record.item?.additional_potential?.lines || [])
  ];
  const stats = record.item?.stats;
  const hasObservedStats = STAT_SOURCES.some((source) =>
    plainObject(stats?.[source]) && Object.keys(stats[source]).length > 0
  );
  return {
    unknown_potential_lines: potentialLines.filter((line) => line.code === "UNKNOWN").length,
    starforce_unknown: record.item?.starforce?.value == null && record.item?.starforce?.applicable !== false,
    stats_missing: stats?.collected !== true || !hasObservedStats,
    stat_component_mismatch: record.item?.stats?.validation?.all_component_sums_match === false
  };
}

function qualityForReleasedRow(row) {
  const statKeys = Object.keys(row).filter((key) => /^stats_(?:base|starforce|scroll|flame|other|total)_/u.test(key));
  const totalKeys = statKeys.filter((key) => key.startsWith("stats_total_"));
  const statSuffixes = new Set(statKeys.map((key) => key.replace(/^stats_(?:base|starforce|scroll|flame|other|total)_/u, "")));
  const statComponentMismatch = [...statSuffixes].some((suffix) => {
    const total = row[`stats_total_${suffix}`];
    if (total == null || total === "") return false;
    const components = ["base", "starforce", "scroll", "flame", "other"]
      .map((source) => row[`stats_${source}_${suffix}`])
      .filter((value) => value != null && value !== "");
    if (!components.length) return false;
    return components.reduce((sum, value) => sum + Number(value), 0) !== Number(total);
  });
  return {
    unknown_potential_lines: potentialUnknownCount(row),
    starforce_unknown: row.starforce_value == null && row.starforce_applicable !== false,
    stats_missing: totalKeys.length === 0,
    stat_component_mismatch: statComponentMismatch
  };
}

function queryFrame(document, verifiedQuery) {
  return {
    catalog_version: document.capture.catalog?.version || null,
    query_id: verifiedQuery.query_id,
    search_scope: verifiedQuery.search_scope,
    price_min_meso: verifiedQuery.price_min_meso,
    price_max_meso: verifiedQuery.price_max_meso,
    starforce_min: verifiedQuery.starforce_min,
    starforce_max: verifiedQuery.starforce_max,
    item_category_filter: verifiedQuery.item_category_filter,
    equipment_subcategory_filter: verifiedQuery.equipment_subcategory_filter,
    result_category_path_filter: verifiedQuery.result_category_path_filter,
    potential_filter: verifiedQuery.potential_filter
  };
}

function isGlobalAccessoryPotentialQuery(canonical) {
  return canonical.search_scope === "catalog_global" &&
    canonical.exact_match === false &&
    canonical.search_keyword === "" &&
    canonical.group === "global_accessory_potential" &&
    Array.isArray(canonical.catalog_ids) && canonical.catalog_ids.length === 0 &&
    Array.isArray(canonical.allowed_names) && canonical.allowed_names.length === 0 &&
    ["ITEM_DROP_RATE_PCT", "MESO_OBTAINED_PCT"].includes(canonical.potential_filter?.capability_id) &&
    stableStringify(canonical.post_classify_profiles) === stableStringify(["ACCESSORY_DROP_MESO"]);
}

function isGlobalCategoryPotentialQuery(canonical) {
  const subcategory = canonical?.equipment_subcategory_filter;
  const capability = canonical?.potential_filter?.capability_id;
  const expectedProfile = capability === "ALL_STAT_PCT" ? "ALL_STAT" : "MAIN_STAT";
  return canonical?.search_scope === "catalog_global" &&
    canonical.exact_match === false &&
    canonical.search_keyword === "" &&
    canonical.group === "global_category_potential" &&
    canonical.item_category_filter === "ARMOR" &&
    ["장신구", "방어구"].includes(subcategory) &&
    canonical.result_category_path_filter === subcategory &&
    Array.isArray(canonical.catalog_ids) && canonical.catalog_ids.length === 0 &&
    Array.isArray(canonical.allowed_names) && canonical.allowed_names.length === 0 &&
    ["STR_PCT", "DEX_PCT", "INT_PCT", "LUK_PCT", "ALL_STAT_PCT"].includes(capability) &&
    stableStringify(canonical.post_classify_profiles) === stableStringify([expectedProfile]);
}

function isGlobalPotentialQuery(canonical) {
  return isGlobalAccessoryPotentialQuery(canonical) || isGlobalCategoryPotentialQuery(canonical);
}

function equipmentCategoryFromPath(categoryPath) {
  if (!Array.isArray(categoryPath)) return null;
  const values = categoryPath.map((value) => String(value || "").trim()).filter(Boolean);
  // 장신구 is more specific than the site's broad 방어구 tab. Slot fallbacks
  // cover API responses such as ["어깨장식"] with no parent category token.
  if (values.includes("장신구")) return "장신구";
  if (values.includes("방어구")) return "방어구";
  if (values.some((value) => ACCESSORY_EQUIPMENT_SLOT_LABELS.has(value))) return "장신구";
  if (values.some((value) => ARMOR_EQUIPMENT_SLOT_LABELS.has(value))) return "방어구";
  return null;
}

function observedGlobalAccessoryCatalogItem(record, canonical, relativePath, rowIndex) {
  if (!isGlobalAccessoryPotentialQuery(canonical)) return null;
  const prefix = `${relativePath}#${rowIndex}`;
  const name = String(record.item?.name || "").trim();
  const slotLabel = String(record.item?.category || "").trim();
  const slot = GLOBAL_ACCESSORY_SLOT_BY_LABEL.get(slotLabel);
  const categoryPath = record.item?.category_path;
  if (!name || !slot || !canonical.slots?.includes(slot) ||
      !Array.isArray(categoryPath) || categoryPath.length < 2 ||
      equipmentCategoryFromPath(categoryPath) !== "장신구" || categoryPath.at(-1) !== slotLabel) {
    throw new Error(`${prefix}: 전체 장신구 검색 결과가 허용된 장신구 부위가 아닙니다.`);
  }
  if (record.catalog_id != null || record.item?.catalog_id != null) {
    throw new Error(`${prefix}: 고정 카탈로그 밖 장비에 catalog_id가 임의로 지정되었습니다.`);
  }
  const requiredLevel = nullableInteger(record.item?.required_level, `${prefix} 요구 레벨`);
  const levelReduction = nullableInteger(record.item?.required_level_reduction, `${prefix} 착용 레벨 감소`) || 0;
  const level = nullableInteger(record.item?.base_level, `${prefix} 기본 레벨`) ??
    Math.max(0, (requiredLevel || 0) + levelReduction);
  return {
    id: `observed-accessory:${sha256(name).slice(0, 20)}`,
    name,
    level,
    slot,
    slot_label: slotLabel,
    main_stats: [],
    potential_profiles: ["ACCESSORY_DROP_MESO"],
    potential_eligible: true,
    starforce_eligible: record.item?.starforce?.applicable !== false
  };
}

function observedGlobalCategoryCatalogItem(record, canonical, relativePath, rowIndex) {
  if (!isGlobalCategoryPotentialQuery(canonical)) return null;
  const prefix = `${relativePath}#${rowIndex}`;
  const name = String(record.item?.name || "").trim();
  const categoryPath = record.item?.category_path;
  const expectedCategory = canonical.result_category_path_filter;
  const slotLabel = String(record.item?.category || categoryPath?.at(-1) || "").trim();
  if (!name || !slotLabel || !Array.isArray(categoryPath) || categoryPath.length === 0 ||
      equipmentCategoryFromPath(categoryPath) !== expectedCategory) {
    throw new Error(`${prefix}: 전체 ${expectedCategory} 잠재 검색 결과가 허용된 장비 분류가 아닙니다.`);
  }
  if (record.catalog_id != null || record.item?.catalog_id != null) {
    throw new Error(`${prefix}: 고정 카탈로그 밖 장비에 catalog_id가 임의로 지정되었습니다.`);
  }
  const requiredLevel = nullableInteger(record.item?.required_level, `${prefix} 요구 레벨`);
  const levelReduction = nullableInteger(record.item?.required_level_reduction, `${prefix} 착용 레벨 감소`) || 0;
  const level = nullableInteger(record.item?.base_level, `${prefix} 기본 레벨`) ??
    Math.max(0, (requiredLevel || 0) + levelReduction);
  return {
    id: `observed-category:${sha256(`${expectedCategory}\u001f${name}`).slice(0, 20)}`,
    name,
    level,
    slot: `observed_${expectedCategory}`,
    slot_label: slotLabel,
    main_stats: ["STR", "DEX", "INT", "LUK"],
    potential_profiles: ["MAIN_STAT", "ALL_STAT"],
    potential_eligible: true,
    starforce_eligible: record.item?.starforce?.applicable !== false
  };
}

function resolveCatalogItemForQuery(record, canonical, catalog, relativePath, rowIndex) {
  const fixed = catalog.getCatalogItem(record.item?.catalog_id || record.item?.name);
  if (fixed) return fixed;
  return observedGlobalAccessoryCatalogItem(record, canonical, relativePath, rowIndex) ||
    observedGlobalCategoryCatalogItem(record, canonical, relativePath, rowIndex);
}

function assertRecordMatchesQuery(record, catalogItem, canonical, catalog, relativePath, rowIndex) {
  const prefix = `${relativePath}#${rowIndex}`;
  if (isGlobalAccessoryPotentialQuery(canonical)) {
    const slot = GLOBAL_ACCESSORY_SLOT_BY_LABEL.get(record.item?.category);
    if (!slot || !canonical.slots?.includes(slot) || catalogItem.name !== record.item?.name ||
        (record.item?.catalog_id != null && record.item.catalog_id !== catalogItem.id) ||
        (record.catalog_id != null && record.catalog_id !== catalogItem.id)) {
      throw new Error(`${prefix}: 전체 장신구 검색 결과가 장비명·부위·catalog_id 계약과 일치하지 않습니다.`);
    }
  } else if (isGlobalCategoryPotentialQuery(canonical)) {
    const expectedCategory = canonical.result_category_path_filter;
    const categoryPath = record.item?.category_path;
    if (!Array.isArray(categoryPath) || equipmentCategoryFromPath(categoryPath) !== expectedCategory ||
        catalogItem.name !== record.item?.name ||
        (record.item?.catalog_id != null && record.item.catalog_id !== catalogItem.id) ||
        (record.catalog_id != null && record.catalog_id !== catalogItem.id)) {
      throw new Error(`${prefix}: 전체 ${expectedCategory} 잠재 검색 결과가 장비명·분류·catalog_id 계약과 일치하지 않습니다.`);
    }
  } else {
    const allowedNames = new Set(canonical.allowed_names || [canonical.exact_name].filter(Boolean));
    const allowedCatalogIds = new Set(canonical.catalog_ids || [canonical.catalog_id].filter(Boolean));
    if (!allowedNames.has(record.item?.name) || !allowedCatalogIds.has(catalogItem.id) ||
        record.item?.catalog_id !== catalogItem.id || record.catalog_id !== catalogItem.id) {
      throw new Error(`${prefix}: 장비명·catalog_id가 검색 query의 허용 목록과 일치하지 않습니다.`);
    }
  }
  const price = Number(record.listing.price_meso);
  if ((canonical.price_min_meso != null && price < canonical.price_min_meso) ||
      (canonical.price_max_meso != null && price > canonical.price_max_meso)) {
    throw new Error(`${prefix}: 거래 가격이 제출한 가격 범위를 벗어났습니다.`);
  }
  const starforce = record.item?.starforce?.value;
  if (Number.isInteger(starforce) && (
    (canonical.starforce_min != null && starforce < canonical.starforce_min) ||
    (canonical.starforce_max != null && starforce > canonical.starforce_max)
  )) {
    throw new Error(`${prefix}: 확인된 스타포스가 제출한 범위를 벗어났습니다.`);
  }
  if (canonical.potential_filter) {
    const classification = catalog.classifyPotentialProfiles(catalogItem, record.item?.potential);
    const stat = canonical.potential_filter.capability_id.replace(/_PCT$/u, "");
    const totals = classification.totals?.percent || {};
    let value = Number(totals[stat] || 0);
    if (["STR", "DEX", "INT", "LUK"].includes(stat)) value += Number(totals.ALL_STAT || 0);
    if (value < canonical.potential_filter.minimum) {
      throw new Error(`${prefix}: 구조화 옵션을 다시 합산한 값이 잠재 검색 최소값보다 작습니다.`);
    }
    if (canonical.potential_filter.maximum != null && value > canonical.potential_filter.maximum) {
      throw new Error(`${prefix}: 구조화 옵션을 다시 합산한 값이 잠재 검색 최대값보다 큽니다.`);
    }
  }
}

function validateFilterAudit(document, canonical, relativePath) {
  const audit = document.capture?.filter_audit ?? null;
  if (!canonical.potential_filter) {
    if (audit != null) throw new Error(`${relativePath}: 잠재 필터 없는 검색에 filter_audit가 남아 있습니다.`);
    return;
  }
  if (!audit || audit.capability_id !== canonical.potential_filter.capability_id ||
      audit.auction_code !== canonical.potential_filter.auction_code ||
      audit.minimum !== canonical.potential_filter.minimum ||
      (audit.maximum ?? null) !== (canonical.potential_filter.maximum ?? null)) {
    throw new Error(`${relativePath}: 잠재 필터의 로컬 재검산 근거가 없습니다.`);
  }
  const passed = nullableInteger(audit.passed_count, "filter_audit.passed_count");
  const failed = nullableInteger(audit.failed_count, "filter_audit.failed_count");
  const collection = document.capture?.collection_summary || {};
  const locallyExcluded = Number(collection.locally_excluded_category_rows || 0) +
    Number(collection.locally_excluded_range_rows || 0);
  const auditedRows = document.items.length + locallyExcluded;
  const expectedStatus = auditedRows === 0
    ? "inconclusive_empty"
    : failed === 0 ? "observed_compatible" : "observed_mismatch";
  if (passed == null || failed == null || passed + failed !== auditedRows ||
      failed > locallyExcluded || audit.status !== expectedStatus) {
    throw new Error(`${relativePath}: 잠재 필터 결과가 로컬 옵션 재검산을 통과하지 못했습니다.`);
  }
}

function validateSiteUsage(usage, relativePath) {
  if (!usage || usage.limit !== 100 || !Number.isInteger(usage.used) || usage.used < 0 || usage.used > 100) {
    throw new Error(`${relativePath}: 사이트 검색 횟수 근거가 없거나 올바르지 않습니다.`);
  }
  return { used: usage.used, limit: usage.limit };
}

function validateResultPaginationEvidence(summary, page, sourceRows, relativePath) {
  const totalResults = summary.total_results;
  const totalPages = summary.total_pages;
  const hasNextPage = summary.has_next_page;
  if (totalResults != null && (!Number.isSafeInteger(totalResults) || totalResults < 0)) {
    throw new Error(`${relativePath}: 전체 결과 수가 올바르지 않습니다.`);
  }
  if (totalPages != null && (!Number.isSafeInteger(totalPages) || totalPages < 1)) {
    throw new Error(`${relativePath}: 전체 페이지 수가 올바르지 않습니다.`);
  }
  if (typeof hasNextPage !== "boolean") {
    throw new Error(`${relativePath}: 다음 페이지 존재 여부를 확정할 수 없습니다.`);
  }

  if (totalResults != null) {
    const arithmeticTotalPages = totalResults === 0 ? 0 : Math.ceil(totalResults / 60);
    const expectedSourceRows = Math.min(60, Math.max(0, totalResults - ((page - 1) * 60)));
    const expectedHasNextPage = page < arithmeticTotalPages;
    if (sourceRows !== expectedSourceRows || hasNextPage !== expectedHasNextPage) {
      throw new Error(`${relativePath}: 전체 결과 수와 현재 페이지 원본 건수/다음 페이지 표기가 모순됩니다.`);
    }
    if (totalPages != null && totalPages !== (arithmeticTotalPages || 1)) {
      throw new Error(`${relativePath}: 전체 결과 수와 전체 페이지 수가 모순됩니다.`);
    }
    return { totalResults, totalPages, hasNextPage };
  }

  if (totalPages != null && hasNextPage !== (page < totalPages)) {
    throw new Error(`${relativePath}: 전체 페이지 수와 다음 페이지 표기가 모순됩니다.`);
  }
  if (hasNextPage && sourceRows !== 60) {
    throw new Error(`${relativePath}: 다음 페이지가 있는데 현재 60개 결과가 누락되었습니다.`);
  }
  return { totalResults, totalPages, hasNextPage };
}

function inspectCaptureDocument(document, relativePath, toolchain) {
  verifyIntegrity(document, relativePath);
  const captureViolations = validateSchema(document, toolchain.captureSchema);
  if (captureViolations.length) {
    throw new Error(`${relativePath}: capture.v2 스키마 오류: ${captureViolations.slice(0, 5).join("; ")}`);
  }
  const canonical = assertCanonicalQuery(
    document,
    toolchain.canonicalQueries,
    relativePath
  );
  const verifiedQuery = validateQueryEvidence(document, canonical, toolchain.preset, relativePath);
  const counts = validateCaptureSummary(document, relativePath, toolchain.collector, canonical);
  const page = document.capture.attempt.page;
  const sweepId = String(document.capture.attempt?.sweep_id || "").trim();
  const attemptId = String(document.capture.attempt?.attempt_id || "").trim();
  if (!sweepId || !attemptId) throw new Error(`${relativePath}: sweep_id 또는 attempt_id가 없습니다.`);
  const paginationEvidence = validateResultPaginationEvidence(
    document.capture.result_summary,
    page,
    counts.sourceRows,
    relativePath
  );
  if (document.capture.collection_transport !== "tooltip_api") {
    throw new Error(`${relativePath}: 0.7.7 원본이 구조화 툴팁 API로 수집되지 않았습니다.`);
  }
  const collectionMode = document.capture.collection_mode;
  if (!["catalog_sweep", "catalog_resume", "catalog_restart"].includes(collectionMode)) {
    throw new Error(`${relativePath}: 0.7.7 자동 카탈로그 수집 mode가 아닙니다.`);
  }
  const retryCount = strictNonNegativeInteger(document.capture.attempt.retry_count, "attempt.retry_count", relativePath);
  const restartReason = document.capture.attempt.resume_restart_reason;
  const hasRestartReason = typeof restartReason === "string" && restartReason.trim().length > 0;
  const modeMatchesAttempt = collectionMode === "catalog_sweep"
    ? retryCount === 0 && restartReason == null
    : collectionMode === "catalog_resume"
      ? retryCount > 0 && restartReason == null
      : retryCount > 0 && hasRestartReason;
  if (!modeMatchesAttempt) {
    throw new Error(`${relativePath}: collection_mode와 retry/restart 근거가 일치하지 않습니다.`);
  }
  validateFilterAudit(document, canonical, relativePath);

  const observationIds = new Set();
  for (const [index, record] of document.items.entries()) {
    const catalogItem = resolveCatalogItemForQuery(
      record,
      canonical,
      toolchain.catalog,
      relativePath,
      index + 1
    );
    if (!catalogItem) throw new Error(`${relativePath}#${index + 1}: 현재 카탈로그에 없는 장비입니다.`);
    validateNativeSoldRecord(record, catalogItem, relativePath, index + 1, {
      requireApiSource: true,
      requireRawStats: true,
      allowEmptyRawStats: isGlobalPotentialQuery(canonical),
      parsePotentialOption: toolchain.normalizer.parsePotentialOption
    });
    assertRecordMatchesQuery(record, catalogItem, canonical, toolchain.catalog, relativePath, index + 1);
    if (observationIds.has(record.observation_id)) {
      throw new Error(`${relativePath}: observation_id가 중복됩니다.`);
    }
    observationIds.add(record.observation_id);
  }

  return {
    canonical_query: canonical,
    verified_query: verifiedQuery,
    // 과거/현재 순회의 provenance와 chain 경계가 섞이지 않도록 원본 ID를 보존한다.
    query_id: verifiedQuery.query_id,
    sweep_id: sweepId,
    attempt_id: attemptId,
    page,
    page_rows: counts.pageRows,
    source_rows: counts.sourceRows,
    capped_rows: counts.cappedRows,
    page_signature: document.capture.result_summary.page_signature || null,
    has_next_page: paginationEvidence.hasNextPage,
    total_results: paginationEvidence.totalResults,
    total_pages: paginationEvidence.totalPages,
    collection_mode: collectionMode,
    retry_count: retryCount,
    resume_restart_reason: restartReason ?? null,
    site_usage: validateSiteUsage(document.capture.result_summary.site_search_usage, relativePath)
  };
}

class CaptureChainValidationError extends Error {}

function validateSweepGroup(group) {
  const sorted = [...group].sort((left, right) => left.inspection.page - right.inspection.page);
  const canonical = sorted[0].inspection.canonical_query;
  const label = `${canonical.query_id} / ${sorted[0].inspection.sweep_id}`;
  const pages = sorted.map((entry) => entry.inspection.page);
  if (new Set(pages).size !== pages.length) throw new CaptureChainValidationError(`${label}: 같은 페이지가 두 번 저장되었습니다.`);
  if (canonical.page_sweep?.enabled !== true && (sorted.length !== 1 || pages[0] !== 1)) {
    throw new CaptureChainValidationError(`${label}: 단일 페이지 정책 검색에 후속 페이지가 포함되었습니다.`);
  }
  if (pages[0] !== 1 || pages.some((page, index) => page !== index + 1)) {
    throw new CaptureChainValidationError(`${label}: 페이지가 1부터 연속으로 저장되지 않았습니다.`);
  }
  const attempts = new Map();
  for (const entry of sorted) {
    const key = entry.inspection.attempt_id;
    const attempt = attempts.get(key) || [];
    attempt.push(entry);
    attempts.set(key, attempt);
  }
  for (const [attemptId, attemptEntries] of attempts) {
    const usage = attemptEntries.map((entry) => stableStringify(entry.inspection.site_usage));
    if (new Set(usage).size !== 1) {
      throw new CaptureChainValidationError(`${label}: 검색 없이 이동한 같은 attempt의 페이지에서 검색 횟수가 변했습니다.`);
    }
    // A live sold-items list can change both its total count and page count
    // while we traverse it. Validate each page against its own snapshot in
    // validateResultPaginationEvidence; merge repeated sales by native ID.
    if (new Set(attemptEntries.map((entry) => entry.inspection.collection_mode)).size !== 1) {
      throw new CaptureChainValidationError(`${label}: 같은 attempt ${attemptId}의 수집 mode가 바뀌었습니다.`);
    }
    if (new Set(attemptEntries.map((entry) => stableStringify({
      retry_count: entry.inspection.retry_count,
      resume_restart_reason: entry.inspection.resume_restart_reason
    }))).size !== 1) {
      throw new CaptureChainValidationError(`${label}: 같은 attempt ${attemptId}의 retry/restart 근거가 바뀌었습니다.`);
    }
    const attemptPages = attemptEntries.map((entry) => entry.inspection.page).sort((left, right) => left - right);
    if (attemptPages.some((page, index) => index > 0 && page !== attemptPages[index - 1] + 1)) {
      throw new CaptureChainValidationError(`${label}: 같은 attempt ${attemptId}의 저장 페이지가 연속되지 않습니다.`);
    }
  }

  if (canonical.page_sweep?.enabled !== true) {
    if (sorted[0].inspection.page_rows === 0) {
      return { status: "pending", reason: "empty_first_page", entries: [] };
    }
    if (sorted[0].inspection.page_rows !== sorted[0].inspection.source_rows ||
        sorted[0].inspection.capped_rows !== 0) {
      throw new CaptureChainValidationError(`${label}: 단일 페이지 정책 결과의 원본 행이 잘려 있습니다.`);
    }
    return {
      status: "complete",
      reason: "single_page_policy",
      entries: sorted,
      truncated: sorted[0].inspection.has_next_page === true
    };
  }

  if (sorted[0].inspection.page_rows === 0) {
    if (sorted.length !== 1) {
      throw new CaptureChainValidationError(`${label}: 빈 1페이지 뒤에 추가 페이지가 저장되었습니다.`);
    }
    return { status: "pending", reason: "empty_first_page", entries: [] };
  }
  for (let index = 0; index < sorted.length - 1; index += 1) {
    if (sorted[index].inspection.has_next_page !== true) {
      throw new CaptureChainValidationError(`${label}: 종료된 페이지 뒤에 추가 페이지가 저장되었습니다.`);
    }
  }
  const limit = 60;
  const resultCap = Math.max(1, Number(canonical.page_sweep.result_cap || Number.POSITIVE_INFINITY));
  const maxPages = Math.min(
    Math.max(1, Number(canonical.page_sweep.max_pages || 1)),
    Number.isFinite(resultCap) ? Math.ceil(resultCap / limit) : Number.POSITIVE_INFINITY
  );
  let cumulativeRows = 0;
  for (const entry of sorted) {
    const remainingRows = Math.max(0, resultCap - cumulativeRows);
    const expectedPageRows = Math.min(entry.inspection.source_rows, remainingRows);
    if (entry.inspection.page_rows !== expectedPageRows) {
      throw new CaptureChainValidationError(`${label}: 페이지 ${entry.inspection.page}의 원본/상한 보존 건수가 0.7.7 수집 계약과 다릅니다.`);
    }
    cumulativeRows += entry.inspection.page_rows;
  }
  if (cumulativeRows > resultCap || pages.at(-1) > maxPages) {
    throw new CaptureChainValidationError(`${label}: 카탈로그의 페이지/결과 상한을 초과했습니다.`);
  }
  const last = sorted.at(-1).inspection;
  const naturalEnd = last.has_next_page === false;
  const policyEnd = cumulativeRows === resultCap || last.page === maxPages;
  if (!naturalEnd && !policyEnd) {
    return { status: "pending", reason: "next_page_missing", entries: [] };
  }
  return {
    status: "complete",
    reason: naturalEnd ? "natural_end" : "result_cap_reached",
    entries: sorted,
    truncated: !naturalEnd
  };
}

function selectCompleteCaptureChains(scanned, { deferInvalidChains = false } = {}) {
  const groups = new Map();
  for (const entry of scanned) {
    const key = `${entry.inspection.query_id}\u001f${entry.inspection.sweep_id}`;
    const group = groups.get(key) || [];
    group.push(entry);
    groups.set(key, group);
  }
  const included = [];
  const pending = [];
  const quarantined = [];
  const completedChains = [];
  for (const group of groups.values()) {
    let result;
    try {
      result = validateSweepGroup(group);
    } catch (error) {
      if (!deferInvalidChains || !(error instanceof CaptureChainValidationError)) throw error;
      // Keep every original, but exclude the entire inconsistent sweep from
      // training. Other independently verified sweeps can still be published.
      quarantined.push({
        query_id: group[0].inspection.query_id,
        sweep_id: group[0].inspection.sweep_id,
        pages: group.length,
        reason: "invalid_capture_chain",
        error: error.message,
        files: group.map((entry) => entry.relative_path),
        source_hashes: group.map((entry) => entry.sha256)
      });
      continue;
    }
    if (result.status === "complete") {
      included.push(...result.entries);
      completedChains.push({
        query_id: group[0].inspection.query_id,
        sweep_id: group[0].inspection.sweep_id,
        pages: group.length,
        reason: result.reason,
        truncated: result.truncated
      });
    } else {
      pending.push({
        query_id: group[0].inspection.query_id,
        sweep_id: group[0].inspection.sweep_id,
        pages: group.length,
        reason: result.reason,
        files: group.map((entry) => entry.relative_path)
      });
    }
  }
  return { included, pending, quarantined, completedChains };
}

async function loadToolchain(extensionRoot) {
  const normalizerPath = path.join(extensionRoot, "tools/normalize-lib.mjs");
  const trainingPath = path.join(extensionRoot, "tools/training-lib.mjs");
  const catalogPath = path.join(extensionRoot, "tools/catalog.mjs");
  const presetPath = path.join(extensionRoot, "tools/preset-core.mjs");
  const collectorPath = path.join(extensionRoot, "tools/collector-core.mjs");
  const captureSchemaPath = path.join(extensionRoot, "schemas/capture-v2.schema.json");
  const normalizedSchemaPath = path.join(extensionRoot, "schemas/normalized-v2.schema.json");
  const [normalizer, training, catalog, preset, collector, sourceTexts] = await Promise.all([
    import(pathToFileURL(normalizerPath).href),
    import(pathToFileURL(trainingPath).href),
    import(pathToFileURL(catalogPath).href),
    import(pathToFileURL(presetPath).href),
    import(pathToFileURL(collectorPath).href),
    Promise.all([
      SCRIPT_PATH,
      VALIDATOR_PATH,
      normalizerPath,
      trainingPath,
      catalogPath,
      presetPath,
      collectorPath,
      captureSchemaPath,
      normalizedSchemaPath
    ].map(async (sourcePath) => [normalizedPath(path.relative(PROJECT_ROOT, sourcePath)), await readFile(sourcePath, "utf8")]))
  ]);
  const captureSchema = JSON.parse(await readFile(captureSchemaPath, "utf8"));
  const normalizedSchema = JSON.parse(await readFile(normalizedSchemaPath, "utf8"));
  const fingerprint = sha256(stableStringify(Object.fromEntries(
    sourceTexts.map(([sourcePath, text]) => [sourcePath, sha256(text)])
  )));
  const canonicalQueries = new Map(catalog.expandCatalogQueries().map((query) => [query.query_id, query]));
  return {
    normalizer,
    training,
    catalog,
    preset,
    collector,
    captureSchema,
    normalizedSchema,
    canonicalQueries,
    fingerprint
  };
}

function enrichCatalog(record, canonical, catalog, relativePath, rowIndex) {
  const item = resolveCatalogItemForQuery(record, canonical, catalog, relativePath, rowIndex);
  if (!item) throw new Error(`${relativePath}: 고정 카탈로그에 없는 장비입니다: ${record.item?.name || "이름 없음"}`);
  record.item.catalog_id = item.id;
  record.item.base_level ??= item.level;
  record.item.category ??= item.slot_label;
  return item;
}

function profileChannel(profileId) {
  return ({
    MAIN_STAT: "main",
    ALL_STAT: "allstat",
    MAX_HP: "hp",
    XENON_MIXED: "allstat",
    HAT_COOLDOWN: "hat",
    GLOVE_CRITICAL_DAMAGE: "glove",
    ACCESSORY_DROP_MESO: "accessory",
    MITRA_OPTIMAL: "mitra"
  })[profileId] || null;
}

function reclassifyRecord(record, catalogItem, catalog, canonical) {
  const classification = catalog.classifyPotentialProfiles(catalogItem, record.item?.potential);
  const matched = [`${catalogItem.id}:BASE_ANY`];
  const channels = ["baseline"];
  if (isGlobalCategoryPotentialQuery(canonical)) {
    for (const targetId of canonical.selection_channels || []) {
      matched.push(`${catalogItem.id}:${targetId}`);
      channels.push(targetId);
    }
  }
  const starforceBand = catalog.starforceBandForValue(record.item?.starforce?.value);
  if (starforceBand) {
    matched.push(`${catalogItem.id}:${starforceBand}`);
    channels.push("starforce");
  }
  for (const [profileId, value] of Object.entries(classification.profiles || {})) {
    if (Array.isArray(value)) {
      for (const entry of value.filter((candidate) => candidate.matched)) {
        matched.push(`${catalogItem.id}:${profileId}:${entry.stat}:${entry.grade || "matched"}`);
      }
      if (value.some((entry) => entry.matched)) channels.push(profileChannel(profileId));
    } else if (value?.matched) {
      matched.push(`${catalogItem.id}:${profileId}:${value.matched_rule || value.grade || "matched"}`);
      channels.push(profileChannel(profileId));
    }
  }
  record.matched_preset_ids = [...new Set(matched)].sort();
  record.selection_channels = [...new Set(channels.filter(Boolean))].sort();
}

function cacheNamespace(toolchain) {
  return `${PIPELINE_VERSION.replace(/[^a-z0-9.-]+/giu, "-")}-${toolchain.fingerprint.slice(0, 20)}`;
}

async function readCache(cachePath, sourceSha, toolchain) {
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8"));
    const { cache_integrity: cacheIntegrity, ...unsigned } = cached;
    if (cached.schema_version !== "maplestarforce.item-market.cache.v2" ||
        cached.source_sha256 !== sourceSha ||
        cached.normalizer_version !== toolchain.normalizer.NORMALIZER_VERSION ||
        cached.toolchain_fingerprint !== toolchain.fingerprint ||
        !/^[0-9a-f]{64}$/u.test(cacheIntegrity || "") ||
        sha256(JSON.stringify(unsigned)) !== cacheIntegrity ||
        !Array.isArray(cached.entries)) return null;
    return cached;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeImmutable(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    const existing = await readFile(filePath, "utf8");
    if (existing !== content) throw new Error(`불변 산출물 충돌: ${filePath}`);
    return;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const temporary = `${filePath}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await link(temporary, filePath);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readFile(filePath, "utf8");
    if (existing !== content) throw new Error(`불변 산출물 충돌: ${filePath}`);
  } finally {
    try {
      await unlink(temporary);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function processEligibleFile({
  relativePath,
  buffer,
  sourceSha,
  documents,
  inspections,
  toolchain,
  cacheRoot,
  writeCache
}) {
  const cachePath = path.join(cacheRoot, cacheNamespace(toolchain), `${sourceSha}.json`);
  const cached = await readCache(cachePath, sourceSha, toolchain);
  if (cached) return { ...cached, relative_path: relativePath, from_cache: true };

  const entries = [];
  const captureIds = [];
  for (const [documentIndex, document] of documents.entries()) {
    const inspection = inspections[documentIndex];
    const verifiedQuery = inspection.verified_query;
    const normalization = prepareCaptureForNormalization(document);
    const normalizedRecords = toolchain.normalizer.normalizeCaptureV2(normalization.document);
    if (normalizedRecords.length !== document.items.length) {
      throw new Error(`${relativePath}: 정규화 전후 매물 수가 다릅니다.`);
    }
    const frame = queryFrame(document, verifiedQuery);
    for (const [index, record] of normalizedRecords.entries()) {
      const repairedZeroTotals = normalization.repairs.get(index) || [];
      if (repairedZeroTotals.length > 0) {
        record.repair_changes = Array.from(new Set([
          ...(record.repair_changes || []),
          ...repairedZeroTotals.map((key) => `stats.${key}.omitted_zero_total_recovered_from_components`)
        ])).sort();
      }
      const normalizedViolations = validateSchema(record, toolchain.normalizedSchema);
      if (normalizedViolations.length) {
        throw new Error(`${relativePath}#${index + 1}: normalized.v2 스키마 오류: ${normalizedViolations.slice(0, 5).join("; ")}`);
      }
      const catalogItem = enrichCatalog(
        record,
        inspection.canonical_query,
        toolchain.catalog,
        relativePath,
        index + 1
      );
      validateNativeSoldRecord(record, catalogItem, relativePath, index + 1);
      reclassifyRecord(record, catalogItem, toolchain.catalog, inspection.canonical_query);
      if (isGlobalAccessoryPotentialQuery(inspection.canonical_query) &&
          USER_EXCLUDED_MARKET_ITEM_NAMES.has(record.item?.name)) continue;
      const row = toolchain.training.toTrainingRow(record);
      if (!row) throw new Error(`${relativePath}#${index + 1}: 학습 행으로 변환되지 않았습니다.`);
      row.catalog_id = catalogItem.id;
      row.base_level ??= catalogItem.level;
      row.category ??= catalogItem.slot_label;
      entries.push({
        row,
        provenance: {
          ...frame,
          extension_version: document.capture.extension_version,
          captured_at: document.capture.captured_at,
          page: inspection.page,
          sweep_id: inspection.sweep_id,
          page_signature: inspection.page_signature,
          filter_audit: document.capture.filter_audit || null
        },
        quality: qualityForRecord(record)
      });
    }
    captureIds.push(document.capture.batch_id);
  }

  const payload = {
    schema_version: "maplestarforce.item-market.cache.v2",
    pipeline_version: PIPELINE_VERSION,
    normalizer_version: toolchain.normalizer.NORMALIZER_VERSION,
    toolchain_fingerprint: toolchain.fingerprint,
    source_sha256: sourceSha,
    source_bytes: buffer.length,
    capture_count: documents.length,
    capture_ids: captureIds,
    entries
  };
  const cachedPayload = {
    ...payload,
    cache_integrity: sha256(JSON.stringify(payload))
  };
  if (writeCache) await writeImmutable(cachePath, `${JSON.stringify(cachedPayload)}\n`);
  return { ...cachedPayload, relative_path: relativePath, from_cache: false };
}

function mergeJsonArrayFields(rows, field) {
  const values = new Set();
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row[field] || "[]");
      for (const value of Array.isArray(parsed) ? parsed : []) values.add(value);
    } catch (_error) {
      // The extension's training-row producer already validates these fields.
    }
  }
  return JSON.stringify([...values].sort());
}

function potentialUnknownCount(row) {
  let total = 0;
  for (const field of ["potential_json", "additional_potential_json"]) {
    try {
      const section = JSON.parse(row[field] || "{}");
      total += (section.lines || []).filter((line) => line.code === "UNKNOWN").length;
    } catch (_error) {
      total += 3;
    }
  }
  return total;
}

function completenessScore(row) {
  let score = 0;
  for (const value of Object.values(row)) if (value !== null && value !== undefined && value !== "") score += 1;
  score -= potentialUnknownCount(row) * 10;
  if (row.starforce_value != null || row.starforce_applicable === false) score += 5;
  return score;
}

function collisionInvariant(row) {
  return stableStringify({
    price_meso: row.price_meso,
    sold_at: row.sold_at,
    item_name: row.item_name,
    item_id: row.item_id
  });
}

function potentialFeature(value) {
  try {
    const section = JSON.parse(value || "{}");
    return {
      grade: section.grade ?? null,
      lines: (section.lines || []).map((line) => ({
        line_index: line.line_index,
        code: line.code,
        value: line.value,
        unit: line.unit,
        tier: line.tier,
        params: line.params || {}
      }))
    };
  } catch (_error) {
    return { invalid: true };
  }
}

function comparableFeature(row) {
  const stats = {};
  for (const [key, value] of Object.entries(row)) {
    if (/^stats_(?:base|starforce|scroll|flame|other|total)_/u.test(key)) stats[key] = value;
  }
  return {
    listing_fingerprint: row.listing_fingerprint,
    starforce_value: row.starforce_value,
    starforce_applicable: row.starforce_applicable,
    upgrade_applied: row.upgrade_applied,
    upgrade_remaining: row.upgrade_remaining,
    upgrade_recoverable: row.upgrade_recoverable,
    required_level: row.required_level,
    required_level_reduction: row.required_level_reduction,
    potential: potentialFeature(row.potential_json),
    additional_potential: potentialFeature(row.additional_potential_json),
    stats
  };
}

function compatibleObservedValues(left, right) {
  if (left == null || left === "" || right == null || right === "") return true;
  if (typeof left !== typeof right) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => compatibleObservedValues(value, right[index]));
  }
  if (typeof left === "object") {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].every((key) => compatibleObservedValues(left[key], right[key]));
  }
  if (left === "UNKNOWN" || right === "UNKNOWN") return true;
  return Object.is(left, right);
}

function deduplicateNativeEntries(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const id = entry.row.listing_id;
    const group = groups.get(id) || [];
    group.push(entry);
    groups.set(id, group);
  }
  const output = [];
  for (const [listingId, group] of groups) {
    const invariants = new Set(group.map((entry) => collisionInvariant(entry.row)));
    if (invariants.size !== 1) {
      throw new Error(`같은 네이티브 거래 ID가 서로 다른 매물을 가리킵니다: ${listingId}`);
    }
    const features = group.map((entry) => comparableFeature(entry.row));
    if (features.some((feature, index) => index > 0 && !compatibleObservedValues(features[0], feature))) {
      throw new Error(`같은 네이티브 거래 ID의 옵션·스탯 정보가 충돌합니다: ${listingId}`);
    }
    const capturedAtLast = (entry) => entry.aggregated === true
      ? entry.row.captured_at_last
      : entry.provenance.captured_at;
    const best = [...group].sort((left, right) =>
      completenessScore(right.row) - completenessScore(left.row) ||
      String(capturedAtLast(right)).localeCompare(String(capturedAtLast(left)))
    )[0];
    const frames = new Map();
    for (const entry of group) {
      const observedFrames = entry.aggregated === true
        ? parseJsonArray(entry.row.sampling_frames_json)
        : [{
            catalog_version: entry.provenance.catalog_version,
            query_id: entry.provenance.query_id,
            search_scope: entry.provenance.search_scope,
            price_min_meso: entry.provenance.price_min_meso,
            price_max_meso: entry.provenance.price_max_meso,
            starforce_min: entry.provenance.starforce_min,
            starforce_max: entry.provenance.starforce_max,
            item_category_filter: entry.provenance.item_category_filter,
            equipment_subcategory_filter: entry.provenance.equipment_subcategory_filter,
            result_category_path_filter: entry.provenance.result_category_path_filter,
            potential_filter: entry.provenance.potential_filter
          }];
      for (const frame of observedFrames) {
        const key = stableStringify(frame);
        frames.set(key, JSON.parse(key));
      }
    }
    const row = { ...best.row };
    row.matched_preset_ids_json = mergeJsonArrayFields(group.map((entry) => entry.row), "matched_preset_ids_json");
    row.selection_channels_json = mergeJsonArrayFields(group.map((entry) => entry.row), "selection_channels_json");
    row.observation_count = group.reduce((sum, entry) =>
      sum + (entry.aggregated === true ? Number(entry.row.observation_count || 1) : 1), 0);
    row.dedupe_confidence = "native_listing_id";
    const capturedDates = group.flatMap((entry) => entry.aggregated === true
      ? [entry.row.captured_at_first, entry.row.captured_at_last]
      : [entry.provenance.captured_at]
    ).filter(Boolean).sort();
    row.captured_at_first = capturedDates[0] || null;
    row.captured_at_last = capturedDates.at(-1) || null;
    row.extension_versions_json = JSON.stringify([...new Set(group.flatMap((entry) =>
      entry.aggregated === true
        ? parseJsonArray(entry.row.extension_versions_json)
        : [entry.provenance.extension_version]
    ))].sort());
    row.catalog_versions_json = JSON.stringify([...new Set(group.flatMap((entry) =>
      entry.aggregated === true
        ? parseJsonArray(entry.row.catalog_versions_json)
        : [entry.provenance.catalog_version]
    ))].sort());
    row.sampling_frames_json = JSON.stringify([...frames.values()]);
    output.push({
      row,
      quality: {
        ...best.quality,
        observed_unknown_potential: group.some((entry) =>
          entry.quality.unknown_potential_lines > 0 || entry.quality.observed_unknown_potential === true),
        observed_starforce_unknown: group.some((entry) =>
          entry.quality.starforce_unknown || entry.quality.observed_starforce_unknown === true),
        observed_stats_missing: group.some((entry) =>
          entry.quality.stats_missing || entry.quality.observed_stats_missing === true),
        observed_stat_component_mismatch: group.some((entry) =>
          entry.quality.stat_component_mismatch || entry.quality.observed_stat_component_mismatch === true)
      }
    });
  }
  return output.sort((left, right) =>
    String(left.row.item_name).localeCompare(String(right.row.item_name), "ko") ||
    String(right.row.sold_at).localeCompare(String(left.row.sold_at)) ||
    Number(left.row.price_meso) - Number(right.row.price_meso) ||
    String(left.row.listing_id).localeCompare(String(right.row.listing_id))
  );
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

function unpackStats(row) {
  const stats = Object.fromEntries(STAT_SOURCES.map((source) => [source, {}]));
  for (const [key, value] of Object.entries(row)) {
    const match = key.match(/^stats_(base|starforce|scroll|flame|other|total)_(.+)$/u);
    if (match) stats[match[1]][match[2]] = value;
  }
  return stats;
}

function publicRecord(entry) {
  const row = entry.row;
  return {
    price_meso: row.price_meso,
    sold_at: row.sold_at,
    sold_at_precision: row.sold_at_precision,
    item: {
      name: row.item_name,
      catalog_id: row.catalog_id,
      category: row.category,
      category_path: parseJsonArray(row.category_path_json),
      required_job: row.required_job,
      set_name: row.set_name,
      base_level: row.base_level,
      required_level: row.required_level,
      required_level_reduction: row.required_level_reduction,
      starforce: {
        value: row.starforce_value,
        applicable: row.starforce_applicable,
        source: row.starforce_source,
        confidence: row.starforce_confidence
      },
      upgrade: {
        applied: row.upgrade_applied,
        remaining: row.upgrade_remaining,
        recoverable: row.upgrade_recoverable,
        scroll_type: row.upgrade_scroll_type
      },
      trade: {
        state: row.trade_state,
        scissors_remaining: row.scissors_remaining,
        scissors_total: row.scissors_total
      },
      stats: unpackStats(row),
      potential: JSON.parse(row.potential_json || "{}"),
      additional_potential: JSON.parse(row.additional_potential_json || "{}")
    },
    classification: {
      matched_preset_ids: parseJsonArray(row.matched_preset_ids_json),
      selection_channels: parseJsonArray(row.selection_channels_json)
    },
    sampling_frames: parseJsonArray(row.sampling_frames_json),
    evidence: {
      observation_count: row.observation_count,
      dedupe_confidence: row.dedupe_confidence,
      captured_at_first: row.captured_at_first,
      captured_at_last: row.captured_at_last,
      extension_versions: parseJsonArray(row.extension_versions_json),
      catalog_versions: parseJsonArray(row.catalog_versions_json)
    },
    quality: entry.quality
  };
}

function quantile(sorted, fraction) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return String(sorted[lower]);
  return String(Math.round(sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower)));
}

function summarizeItem(records) {
  const prices = records.map((record) => Number(record.price_meso)).sort((a, b) => a - b);
  const dates = records.map((record) => record.sold_at).filter(Boolean).sort();
  const starforceValues = [...new Set(records.map((record) => record.item.starforce.value).filter(Number.isInteger))].sort((a, b) => a - b);
  const mainGrades = [...new Set(records.map((record) => record.item.potential.grade).filter(Boolean))].sort();
  const additionalGrades = [...new Set(records.map((record) => record.item.additional_potential.grade).filter(Boolean))].sort();
  const priceFloors = [...new Set(records.flatMap((record) =>
    record.sampling_frames.map((frame) => frame.price_min_meso).filter((value) => value != null)
  ))].sort((a, b) => a - b);
  return {
    records: records.length,
    sold_at_from: dates[0] || null,
    sold_at_through: dates.at(-1) || null,
    observed_comparable_sample_price_meso: {
      min: prices.length ? String(prices[0]) : null,
      q1: quantile(prices, 0.25),
      median: quantile(prices, 0.5),
      q3: quantile(prices, 0.75),
      max: prices.length ? String(prices.at(-1)) : null
    },
    coverage: {
      starforce_values: starforceValues,
      main_potential_grades: mainGrades,
      additional_potential_grades: additionalGrades,
      price_floor_meso: priceFloors,
      includes_unrestricted_price_search: records.some((record) =>
        record.sampling_frames.some((frame) => frame.price_min_meso == null)
      )
    },
    interpretation: "검색 조건에 따라 가격 범위가 달라질 수 있으므로 단순 가격 분포를 시장 전체 적정가로 사용하지 않습니다."
  };
}

function representativeIconAssetKey(counts) {
  return [...(counts || new Map()).entries()]
    .filter(([key]) => ICON_ASSET_KEY_PATTERN.test(key))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] || null;
}

async function atomicWrite(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${randomUUID()}`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, filePath);
}

async function writeReleaseArtifact(filePath, content) {
  try {
    const existing = await readFile(filePath, "utf8");
    if (existing === content) return;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  // A release version is content-addressed from the validated sources and
  // toolchain. Rebuilding a missing or damaged file at that exact version is
  // therefore a repair, not a mutable release update.
  await atomicWrite(filePath, content);
}

export async function writeTrainingArtifact(filePath, rows, format) {
  if (!["jsonl", "csv"].includes(format)) throw new Error(`지원하지 않는 자료 형식: ${format}`);
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${randomUUID()}`;
  const handle = await open(temporary, "wx");
  const digest = createHash("sha256");
  let bytes = 0;
  let batch = [];
  const flush = async () => {
    if (!batch.length) return;
    const buffer = Buffer.from(batch.join(""), "utf8");
    await handle.writeFile(buffer);
    digest.update(buffer);
    bytes += buffer.length;
    batch = [];
  };
  try {
    const csvCell = (value) => value == null ? "" : `"${String(value).replace(/"/gu, '""')}"`;
    const columns = new Set();
    if (format === "csv" && rows.length) {
      for (const row of rows) for (const key of Object.keys(row)) columns.add(key);
    }
    const orderedColumns = [...columns].sort();
    if (format === "csv" && rows.length) batch.push(orderedColumns.map(csvCell).join(",") + "\n");
    for (const row of rows) {
      batch.push(format === "jsonl" ? JSON.stringify(row) + "\n" :
        orderedColumns.map((column) => csvCell(row[column])).join(",") + "\n");
      if (batch.length >= 256) await flush();
    }
    await flush();
    await handle.close();
    await rename(temporary, filePath);
    return { sha256: digest.digest("hex"), bytes };
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function writeRelease({
  uniqueEntries,
  inventory,
  datasetVersion,
  toolchain,
  privateRoot,
  publicRoot
}) {
  const deterministicDates = uniqueEntries
    .map((entry) => entry.row.captured_at_last)
    .filter(Boolean)
    .sort();
  const createdAt = deterministicDates.at(-1);
  const grouped = new Map();
  const iconCountsByItem = new Map();
  for (const entry of uniqueEntries) {
    const name = entry.row.item_name;
    const group = grouped.get(name) || [];
    group.push(entry);
    grouped.set(name, group);
    const iconAssetKey = entry.row.icon_asset_key;
    if (ICON_ASSET_KEY_PATTERN.test(iconAssetKey || "")) {
      const counts = iconCountsByItem.get(name) || new Map();
      counts.set(iconAssetKey, (counts.get(iconAssetKey) || 0) + 1);
      iconCountsByItem.set(name, counts);
    }
  }
  const publicReleaseRoot = path.join(publicRoot, "releases", datasetVersion);
  const privateReleaseRoot = path.join(privateRoot, "releases", datasetVersion);
  const catalogItems = [];
  for (const [name, itemEntries] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right, "ko"))) {
    const records = itemEntries.map(publicRecord);
    records.sort((left, right) =>
      String(right.sold_at).localeCompare(String(left.sold_at)) ||
      Number(left.price_meso) - Number(right.price_meso)
    );
    const fileKey = sha256(name).slice(0, 16);
    const relativeFile = `items/${fileKey}.json`;
    const itemDocument = {
      schema_version: PUBLIC_ITEM_SCHEMA,
      dataset_version: datasetVersion,
      item_name: name,
      summary: summarizeItem(records),
      records
    };
    const text = `${JSON.stringify(itemDocument)}\n`;
    await writeReleaseArtifact(path.join(publicReleaseRoot, relativeFile), text);
    catalogItems.push({
      name,
      catalog_id: records[0]?.item?.catalog_id || null,
      // 모루 매물의 외형 키가 섞일 수 있으므로 장비별 최빈 공용 아이콘만 공개한다.
      // 매물·판매자·계정 식별자는 catalog에 넣지 않는다.
      icon_asset_key: representativeIconAssetKey(iconCountsByItem.get(name)),
      file: relativeFile,
      sha256: sha256(text),
      ...itemDocument.summary
    });
  }

  const soldDates = uniqueEntries.map((entry) => entry.row.sold_at).filter(Boolean).sort();
  const capturedDates = uniqueEntries.map((entry) => entry.row.captured_at_last).filter(Boolean).sort();
  const quality = {
    unknown_potential_lines: uniqueEntries.reduce((sum, entry) => sum + entry.quality.unknown_potential_lines, 0),
    starforce_unknown_records: uniqueEntries.filter((entry) => entry.quality.starforce_unknown).length,
    stats_missing_records: uniqueEntries.filter((entry) => entry.quality.stats_missing).length,
    stat_component_mismatch_records: uniqueEntries.filter((entry) => entry.quality.stat_component_mismatch).length
  };
  const catalogDocument = {
    schema_version: PUBLIC_CATALOG_SCHEMA,
    dataset_version: datasetVersion,
    generated_at: createdAt,
    sold_at_from: soldDates[0] || null,
    sold_at_through: soldDates.at(-1) || null,
    items: catalogItems
  };
  const catalogText = `${JSON.stringify(catalogDocument)}\n`;
  await writeReleaseArtifact(path.join(publicReleaseRoot, "catalog.json"), catalogText);

  const trainingRows = uniqueEntries.map((entry) => entry.row);
  const modelReadyRows = uniqueEntries.filter((entry) =>
    entry.quality.unknown_potential_lines === 0 &&
    entry.quality.starforce_unknown === false &&
    entry.quality.stats_missing === false &&
    entry.quality.stat_component_mismatch === false
  ).map((entry) => entry.row);
  toolchain.training.assertTrainingSafe(trainingRows);
  const privateArtifacts = {};
  for (const [name, rows] of [["auction-sold", trainingRows], ["auction-model-ready", modelReadyRows]]) {
    for (const format of ["jsonl", "csv"]) {
      const filename = `${name}.${format}`;
      privateArtifacts[filename] = await writeTrainingArtifact(path.join(privateReleaseRoot, filename), rows, format);
    }
  }

  const sourceState = inventory.eligible.map((source) => ({
    relative_path: source.relative_path,
    sha256: source.sha256,
    bytes: source.bytes,
    captures: source.capture_count,
    observations: source.observation_count
  }));
  const privateState = {
    schema_version: PRIVATE_STATE_SCHEMA,
    pipeline_version: PIPELINE_VERSION,
    toolchain_fingerprint: toolchain.fingerprint,
    normalizer_version: toolchain.normalizer.NORMALIZER_VERSION,
    minimum_extension_version: MINIMUM_EXTENSION_VERSION,
    minimum_catalog_version: MINIMUM_CATALOG_VERSION,
    dataset_version: datasetVersion,
    generated_at: createdAt,
    artifacts: privateArtifacts,
    sources: sourceState,
    ignored_legacy_files: inventory.ignored_legacy.length,
    observations: inventory.observations,
    unique_sales: uniqueEntries.length,
    duplicate_observations: inventory.observations - uniqueEntries.length,
    completed_chains: inventory.completed_chains,
    pending_chains_excluded: inventory.pending_chains,
    model_ready_sales: modelReadyRows.length,
    quality
  };
  await writeReleaseArtifact(
    path.join(privateReleaseRoot, "state.json"),
    `${JSON.stringify(privateState, null, 2)}\n`
  );

  const publicManifest = {
    schema_version: PUBLIC_MANIFEST_SCHEMA,
    dataset_version: datasetVersion,
    generated_at: createdAt,
    data: {
      sold_at_from: soldDates[0] || null,
      sold_at_through: soldDates.at(-1) || null,
      captured_at_through: capturedDates.at(-1) || null,
      source_files: inventory.eligible.length,
      observations: inventory.observations,
      unique_sales: uniqueEntries.length,
      duplicate_observations: inventory.observations - uniqueEntries.length,
      item_count: catalogItems.length,
      model_ready_sales: modelReadyRows.length
    },
    compatibility: {
      source_schema: "maple-auction.capture.v2",
      minimum_extension_version: MINIMUM_EXTENSION_VERSION,
      minimum_catalog_version: MINIMUM_CATALOG_VERSION,
      normalizer_version: toolchain.normalizer.NORMALIZER_VERSION,
      toolchain_fingerprint: toolchain.fingerprint,
      native_listing_id_required: true
    },
    sampling_notice: "검색 가격 하한·스타포스·잠재 조건에 따라 가격 범위가 달라질 수 있으며 단순 분위수는 시장 전체 적정가가 아닙니다.",
    model: {
      status: "component_estimator_beta",
      promoted: false
    },
    quality,
    catalog: {
      file: `releases/${datasetVersion}/catalog.json`,
      sha256: sha256(catalogText)
    }
  };
  await atomicWrite(path.join(privateRoot, "current.json"), `${JSON.stringify(privateState, null, 2)}\n`);
  // The public pointer is the final commit. Versioned files and the private
  // recovery pointer are durable before browsers can observe this manifest.
  await atomicWrite(path.join(publicRoot, "manifest.json"), `${JSON.stringify(publicManifest, null, 2)}\n`);
  return publicManifest;
}

async function readTextStatus(filePath) {
  try {
    return { exists: true, text: await readFile(filePath, "utf8"), error: null };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, text: null, error: null };
    throw error;
  }
}

async function readJsonStatus(filePath) {
  const status = await readTextStatus(filePath);
  if (!status.exists) return { ...status, value: null };
  try {
    return { ...status, value: JSON.parse(status.text) };
  } catch (error) {
    return { ...status, value: null, error: error.message };
  }
}

function sourceHashesFromTrustedState(state, expectedDatasetVersion = null) {
  if (!plainObject(state) ||
      state.schema_version !== PRIVATE_STATE_SCHEMA ||
      state.pipeline_version !== PIPELINE_VERSION ||
      !DATASET_VERSION_PATTERN.test(state.dataset_version || "") ||
      (expectedDatasetVersion != null && state.dataset_version !== expectedDatasetVersion) ||
      !Array.isArray(state.sources) ||
      state.sources.length === 0) return null;

  const hashes = state.sources.map((source) => source?.sha256);
  if (hashes.some((hash) => !/^[0-9a-f]{64}$/u.test(hash || "")) ||
      new Set(hashes).size !== hashes.length) return null;
  return hashes;
}

function trustedReleaseState(state, expectedDatasetVersion, normalizerVersion) {
  if (!plainObject(state) ||
      state.schema_version !== PRIVATE_STATE_SCHEMA ||
      state.pipeline_version !== PIPELINE_VERSION ||
      state.dataset_version !== expectedDatasetVersion ||
      state.normalizer_version !== normalizerVersion ||
      !sourceHashesFromTrustedState(state, expectedDatasetVersion) ||
      !plainObject(state.artifacts?.["auction-sold.jsonl"]) ||
      !/^[0-9a-f]{64}$/u.test(state.artifacts["auction-sold.jsonl"].sha256 || "") ||
      !Number.isSafeInteger(state.artifacts["auction-sold.jsonl"].bytes) ||
      !Number.isSafeInteger(state.observations) || state.observations < 1 ||
      !Number.isSafeInteger(state.unique_sales) || state.unique_sales < 1) return false;
  if (state.sources.some((source) =>
    !plainObject(source) || typeof source.relative_path !== "string" || !source.relative_path ||
    !/^[0-9a-f]{64}$/u.test(source.sha256 || "") ||
    !Number.isSafeInteger(source.bytes) || source.bytes < 1 ||
    !Number.isSafeInteger(source.captures) || source.captures < 1 ||
    !Number.isSafeInteger(source.observations) || source.observations < 0
  ) || state.sources.reduce((sum, source) => sum + source.observations, 0) !== state.observations) return false;
  return true;
}

async function loadTrustedPreviousRelease({
  privateRoot,
  privateCurrentStatus,
  publicManifestStatus,
  toolchain
}) {
  const publicDatasetVersion = plainObject(publicManifestStatus.value) &&
    publicManifestStatus.value.schema_version === PUBLIC_MANIFEST_SCHEMA &&
    DATASET_VERSION_PATTERN.test(publicManifestStatus.value.dataset_version || "")
    ? publicManifestStatus.value.dataset_version
    : null;
  const candidates = [];
  if (publicDatasetVersion) {
    candidates.push({
      origin: "published_release_state",
      datasetVersion: publicDatasetVersion,
      status: await readJsonStatus(path.join(privateRoot, "releases", publicDatasetVersion, "state.json"))
    });
    if (privateCurrentStatus.value?.dataset_version === publicDatasetVersion) {
      candidates.push({
        origin: "private_current",
        datasetVersion: publicDatasetVersion,
        status: privateCurrentStatus
      });
    }
  } else if (DATASET_VERSION_PATTERN.test(privateCurrentStatus.value?.dataset_version || "")) {
    candidates.push({
      origin: "private_current",
      datasetVersion: privateCurrentStatus.value.dataset_version,
      status: privateCurrentStatus
    });
  }

  for (const candidate of candidates) {
    const state = candidate.status.value;
    if (candidate.status.error || !trustedReleaseState(
      state,
      candidate.datasetVersion,
      toolchain.normalizer.NORMALIZER_VERSION
    )) continue;
    const artifactPath = path.join(
      privateRoot,
      "releases",
      candidate.datasetVersion,
      "auction-sold.jsonl"
    );
    const artifact = await readTextStatus(artifactPath);
    const expectedArtifact = state.artifacts["auction-sold.jsonl"];
    if (!artifact.exists || artifact.error ||
        sha256(artifact.text) !== expectedArtifact.sha256 ||
        Buffer.byteLength(artifact.text, "utf8") !== expectedArtifact.bytes) continue;
    let rows;
    try {
      rows = parseJsonLines(artifact.text, normalizedPath(artifactPath));
      toolchain.training.assertTrainingSafe(rows);
    } catch (_error) {
      continue;
    }
    if (rows.length !== state.unique_sales ||
        new Set(rows.map((row) => row.listing_id)).size !== rows.length ||
        rows.some((row) => !HASH_PATTERN.test(row.listing_id || "") ||
          !Number.isSafeInteger(Number(row.observation_count)) || Number(row.observation_count) < 1) ||
        rows.reduce((sum, row) => sum + Number(row.observation_count), 0) !== state.observations) continue;
    return {
      origin: candidate.origin,
      state,
      rows,
      entries: rows.map((row) => ({
        row,
        aggregated: true,
        quality: qualityForReleasedRow(row)
      }))
    };
  }
  return null;
}

async function resolvePreviousSourceBaseline({
  privateRoot,
  privateCurrentStatus,
  publicManifestStatus,
  nextDatasetVersion
}) {
  const hashes = new Set();
  const origins = [];
  const current = privateCurrentStatus.value;
  const currentHashes = sourceHashesFromTrustedState(current);
  if (currentHashes) {
    currentHashes.forEach((hash) => hashes.add(hash));
    origins.push("private_current");
  }

  if (!publicManifestStatus.exists) {
    return { hashes, origins, unresolved: false };
  }

  const manifest = publicManifestStatus.value;
  const publicDatasetVersion = plainObject(manifest) &&
    manifest.schema_version === PUBLIC_MANIFEST_SCHEMA &&
    DATASET_VERSION_PATTERN.test(manifest.dataset_version || "")
    ? manifest.dataset_version
    : null;
  let publishedBaselineResolved = false;

  if (publicDatasetVersion) {
    const releaseStateStatus = await readJsonStatus(path.join(
      privateRoot,
      "releases",
      publicDatasetVersion,
      "state.json"
    ));
    const releaseHashes = sourceHashesFromTrustedState(
      releaseStateStatus.value,
      publicDatasetVersion
    );
    if (releaseHashes) {
      releaseHashes.forEach((hash) => hashes.add(hash));
      origins.push("published_release_state");
      publishedBaselineResolved = true;
    } else if (currentHashes && current.dataset_version === publicDatasetVersion) {
      publishedBaselineResolved = true;
    } else if (publicDatasetVersion === nextDatasetVersion) {
      // The dataset ID is content-addressed from every validated source and the
      // current toolchain. An exact match proves that the present raw set is not
      // a reduced replacement, so missing private pointers can be rebuilt.
      origins.push("matching_public_dataset_digest");
      publishedBaselineResolved = true;
    }
  } else if (currentHashes) {
    // A valid private pointer is the recovery anchor when the public manifest
    // itself is damaged and cannot name its release state.
    publishedBaselineResolved = true;
  }

  return {
    hashes,
    origins: [...new Set(origins)],
    unresolved: !publishedBaselineResolved
  };
}

function addReleaseIssue(issues, code, file, detail = null) {
  issues.push({ code, file: normalizedPath(file), detail });
}

function verifyPrivateStateFields(state, {
  datasetVersion,
  toolchain,
  inventory,
  uniqueEntries
}) {
  if (!plainObject(state) ||
      state.schema_version !== PRIVATE_STATE_SCHEMA ||
      state.pipeline_version !== PIPELINE_VERSION ||
      state.dataset_version !== datasetVersion ||
      state.toolchain_fingerprint !== toolchain.fingerprint ||
      state.normalizer_version !== toolchain.normalizer.NORMALIZER_VERSION ||
      state.minimum_extension_version !== MINIMUM_EXTENSION_VERSION ||
      state.minimum_catalog_version !== MINIMUM_CATALOG_VERSION ||
      state.observations !== inventory.observations ||
      state.unique_sales !== uniqueEntries.length ||
      state.duplicate_observations !== inventory.observations - uniqueEntries.length ||
      !Array.isArray(state.sources) ||
      !plainObject(state.artifacts)) return false;
  const artifactNames = [
    "auction-model-ready.csv",
    "auction-model-ready.jsonl",
    "auction-sold.csv",
    "auction-sold.jsonl"
  ];
  if (stableStringify(Object.keys(state.artifacts).sort()) !== stableStringify(artifactNames) ||
      artifactNames.some((name) =>
        !plainObject(state.artifacts[name]) ||
        !/^[0-9a-f]{64}$/u.test(state.artifacts[name].sha256 || "") ||
        !Number.isSafeInteger(state.artifacts[name].bytes) ||
        state.artifacts[name].bytes < 0
      )) return false;
  const expectedSources = inventory.eligible.map((source) => source.sha256).sort();
  const observedSources = state.sources.map((source) => source?.sha256).sort();
  return stableStringify(observedSources) === stableStringify(expectedSources);
}

async function verifyCurrentRelease({
  datasetVersion,
  toolchain,
  inventory,
  uniqueEntries,
  privateRoot,
  publicRoot,
  privateCurrentStatus,
  publicManifestStatus
}) {
  const issues = [];
  const manifestPath = path.join(publicRoot, "manifest.json");
  const expectedCatalogFile = `releases/${datasetVersion}/catalog.json`;
  const catalogPath = path.join(publicRoot, expectedCatalogFile);
  const manifest = publicManifestStatus.value;
  const expectedItemNames = [...new Set(uniqueEntries.map((entry) => entry.row.item_name))]
    .sort((left, right) => left.localeCompare(right, "ko"));

  if (!publicManifestStatus.exists) {
    addReleaseIssue(issues, "public_manifest_missing", manifestPath);
  } else if (publicManifestStatus.error || !plainObject(manifest)) {
    addReleaseIssue(issues, "public_manifest_invalid_json", manifestPath);
  } else {
    if (manifest.schema_version !== PUBLIC_MANIFEST_SCHEMA) {
      addReleaseIssue(issues, "public_manifest_schema_mismatch", manifestPath);
    }
    if (manifest.dataset_version !== datasetVersion) {
      addReleaseIssue(issues, "public_manifest_version_mismatch", manifestPath);
    }
    if (!plainObject(manifest.catalog) || manifest.catalog.file !== expectedCatalogFile) {
      addReleaseIssue(issues, "public_manifest_catalog_path_mismatch", manifestPath);
    }
    if (!/^[0-9a-f]{64}$/u.test(manifest.catalog?.sha256 || "")) {
      addReleaseIssue(issues, "public_manifest_catalog_hash_invalid", manifestPath);
    }
    if (!plainObject(manifest.data) ||
        manifest.data.source_files !== inventory.eligible.length ||
        manifest.data.observations !== inventory.observations ||
        manifest.data.unique_sales !== uniqueEntries.length ||
        manifest.data.duplicate_observations !== inventory.observations - uniqueEntries.length ||
        manifest.data.item_count !== expectedItemNames.length) {
      addReleaseIssue(issues, "public_manifest_counts_mismatch", manifestPath);
    }
    if (!plainObject(manifest.compatibility) ||
        manifest.compatibility.source_schema !== "maple-auction.capture.v2" ||
        manifest.compatibility.minimum_extension_version !== MINIMUM_EXTENSION_VERSION ||
        manifest.compatibility.minimum_catalog_version !== MINIMUM_CATALOG_VERSION ||
        manifest.compatibility.normalizer_version !== toolchain.normalizer.NORMALIZER_VERSION ||
        manifest.compatibility.toolchain_fingerprint !== toolchain.fingerprint ||
        manifest.compatibility.native_listing_id_required !== true) {
      addReleaseIssue(issues, "public_manifest_compatibility_mismatch", manifestPath);
    }
  }

  const catalogStatus = await readJsonStatus(catalogPath);
  const catalogDocument = catalogStatus.value;
  if (!catalogStatus.exists) {
    addReleaseIssue(issues, "public_catalog_missing", catalogPath);
  } else {
    if (manifest?.catalog?.sha256 && sha256(catalogStatus.text) !== manifest.catalog.sha256) {
      addReleaseIssue(issues, "public_catalog_hash_mismatch", catalogPath);
    }
    if (catalogStatus.error || !plainObject(catalogDocument)) {
      addReleaseIssue(issues, "public_catalog_invalid_json", catalogPath);
    } else {
      if (catalogDocument.schema_version !== PUBLIC_CATALOG_SCHEMA) {
        addReleaseIssue(issues, "public_catalog_schema_mismatch", catalogPath);
      }
      if (catalogDocument.dataset_version !== datasetVersion) {
        addReleaseIssue(issues, "public_catalog_version_mismatch", catalogPath);
      }
      if (!Array.isArray(catalogDocument.items)) {
        addReleaseIssue(issues, "public_catalog_items_invalid", catalogPath);
      } else {
        const observedNames = catalogDocument.items
          .map((entry) => entry?.name)
          .filter((name) => typeof name === "string")
          .sort((left, right) => left.localeCompare(right, "ko"));
        if (stableStringify(observedNames) !== stableStringify(expectedItemNames)) {
          addReleaseIssue(issues, "public_catalog_item_set_mismatch", catalogPath);
        }
        const seenNames = new Set();
        for (const entry of catalogDocument.items) {
          const name = typeof entry?.name === "string" ? entry.name : "";
          const expectedFile = name ? `items/${sha256(name).slice(0, 16)}.json` : null;
          if (!name || seenNames.has(name) || entry.file !== expectedFile ||
              !/^[0-9a-f]{64}$/u.test(entry.sha256 || "") ||
              (entry.icon_asset_key !== null &&
                entry.icon_asset_key !== undefined &&
                !ICON_ASSET_KEY_PATTERN.test(entry.icon_asset_key))) {
            addReleaseIssue(issues, "public_catalog_item_entry_invalid", catalogPath, name || null);
            continue;
          }
          seenNames.add(name);
          const itemPath = path.join(path.dirname(catalogPath), expectedFile);
          const itemStatus = await readJsonStatus(itemPath);
          if (!itemStatus.exists) {
            addReleaseIssue(issues, "public_item_missing", itemPath, name);
            continue;
          }
          if (sha256(itemStatus.text) !== entry.sha256) {
            addReleaseIssue(issues, "public_item_hash_mismatch", itemPath, name);
          }
          const itemDocument = itemStatus.value;
          if (itemStatus.error || !plainObject(itemDocument) ||
              itemDocument.schema_version !== PUBLIC_ITEM_SCHEMA ||
              itemDocument.dataset_version !== datasetVersion ||
              itemDocument.item_name !== name ||
              !Array.isArray(itemDocument.records)) {
            addReleaseIssue(issues, "public_item_contract_mismatch", itemPath, name);
          }
        }
      }
    }
  }

  const currentPath = path.join(privateRoot, "current.json");
  const current = privateCurrentStatus.value;
  if (!privateCurrentStatus.exists) {
    addReleaseIssue(issues, "private_current_missing", currentPath);
  } else if (privateCurrentStatus.error || !verifyPrivateStateFields(current, {
    datasetVersion,
    toolchain,
    inventory,
    uniqueEntries
  })) {
    addReleaseIssue(issues, "private_current_contract_mismatch", currentPath);
  }

  const privateReleaseRoot = path.join(privateRoot, "releases", datasetVersion);
  const statePath = path.join(privateReleaseRoot, "state.json");
  const stateStatus = await readJsonStatus(statePath);
  if (!stateStatus.exists) {
    addReleaseIssue(issues, "private_state_missing", statePath);
  } else if (stateStatus.error || !verifyPrivateStateFields(stateStatus.value, {
    datasetVersion,
    toolchain,
    inventory,
    uniqueEntries
  }) || (plainObject(current) && stableStringify(stateStatus.value) !== stableStringify(current))) {
    addReleaseIssue(issues, "private_state_contract_mismatch", statePath);
  }

  for (const filename of [
    "auction-sold.jsonl",
    "auction-sold.csv",
    "auction-model-ready.jsonl",
    "auction-model-ready.csv"
  ]) {
    const artifactPath = path.join(privateReleaseRoot, filename);
    const artifactStatus = await readTextStatus(artifactPath);
    if (!artifactStatus.exists) {
      addReleaseIssue(issues, "private_artifact_missing", artifactPath, filename);
    } else {
      const expected = stateStatus.value?.artifacts?.[filename];
      if (!plainObject(expected) || sha256(artifactStatus.text) !== expected.sha256 ||
          Buffer.byteLength(artifactStatus.text, "utf8") !== expected.bytes) {
        addReleaseIssue(issues, "private_artifact_hash_mismatch", artifactPath, filename);
      }
    }
  }

  return { valid: issues.length === 0, issues };
}

export async function refreshItemMarketData(options = {}) {
  const mode = options.mode || "apply";
  if (!["apply", "check", "status"].includes(mode)) throw new Error(`지원하지 않는 모드: ${mode}`);
  const rawRoot = path.resolve(options.rawRoot || DEFAULT_RAW_ROOT);
  const privateRoot = path.resolve(options.privateRoot || DEFAULT_PRIVATE_ROOT);
  const publicRoot = path.resolve(options.publicRoot || DEFAULT_PUBLIC_ROOT);
  const extensionRoot = path.resolve(options.extensionRoot || DEFAULT_EXTENSION_ROOT);
  const toolchain = await loadToolchain(extensionRoot);
  const [privateCurrentStatus, publicManifestStatus] = await Promise.all([
    readJsonStatus(path.join(privateRoot, "current.json")),
    readJsonStatus(path.join(publicRoot, "manifest.json"))
  ]);
  const trustedPrevious = options.replaceExisting === true
    ? null
    : await loadTrustedPreviousRelease({
        privateRoot,
        privateCurrentStatus,
        publicManifestStatus,
        toolchain
      });
  const files = await listJsonlFiles(rawRoot);
  const inventory = {
    scanned_files: files.length,
    validated_new_format: [],
    eligible: [],
    reused_validated: [],
    ignored_legacy: [],
    duplicate_source_files: [],
    pending_chains: [],
    completed_chains: [],
    observations: 0,
    cache_hits: 0,
    cache_misses: 0
  };
  // Array#push(...rows) passes one argument per row and fails for large
  // releases. Copy the array without expanding it into function arguments.
  const entries = trustedPrevious?.entries.slice() || [];
  const scanned = [];
  const seenSourceHashes = new Set();
  const rawPresentSourceHashes = new Set();
  const previousSourceHashes = new Set(trustedPrevious?.state.sources.map((source) => source.sha256) || []);
  const cacheRoot = path.join(privateRoot, "cache");

  if (trustedPrevious) {
    inventory.eligible = trustedPrevious.state.sources.map((source) => ({
      relative_path: source.relative_path,
      sha256: source.sha256,
      bytes: source.bytes,
      capture_count: source.captures,
      observation_count: source.observations
    }));
    inventory.completed_chains = [...(trustedPrevious.state.completed_chains || [])];
    inventory.observations = trustedPrevious.state.observations;
  }

  for (const filePath of files) {
    const relativePath = normalizedPath(path.relative(rawRoot, filePath));
    const buffer = await readFile(filePath);
    const sourceSha = sha256(buffer);
    const documents = parseJsonLines(buffer.toString("utf8"), relativePath);
    const captureV2Count = documents.filter((document) =>
      document?.schema_version === "maple-auction.capture.v2"
    ).length;
    if (captureV2Count > 0 && captureV2Count !== documents.length) {
      throw new Error(`${relativePath}: 신규 capture.v2와 다른 형식이 한 파일에 섞여 있습니다.`);
    }
    if (captureV2Count === 0) {
      inventory.ignored_legacy.push({ relative_path: relativePath, reason: "unsupported_schema" });
      continue;
    }
    if (documents.length !== 1) {
      throw new Error(`${relativePath}: 신규 수집 파일은 페이지 봉투 한 줄만 포함해야 합니다.`);
    }
    rawPresentSourceHashes.add(sourceSha);
    if (seenSourceHashes.has(sourceSha)) {
      inventory.duplicate_source_files.push({ relative_path: relativePath, sha256: sourceSha });
      continue;
    }
    seenSourceHashes.add(sourceSha);
    if (previousSourceHashes.has(sourceSha)) {
      inventory.reused_validated.push({ relative_path: relativePath, sha256: sourceSha });
      continue;
    }
    const extensionVersion = assertVersion(
      documents[0].capture?.extension_version,
      SEMVER_PATTERN,
      "확장 프로그램",
      relativePath
    );
    const catalogVersion = assertVersion(
      documents[0].capture?.catalog?.version,
      CATALOG_VERSION_PATTERN,
      "카탈로그",
      relativePath
    );
    if (!validVersionAtLeast(extensionVersion, MINIMUM_EXTENSION_VERSION) ||
        !validVersionAtLeast(catalogVersion, MINIMUM_CATALOG_VERSION)) {
      inventory.ignored_legacy.push({
        relative_path: relativePath,
        reason: "pre_0.7.7_or_old_catalog",
        extension_version: extensionVersion || null,
        catalog_version: catalogVersion || null
      });
      continue;
    }
    const inspections = documents.map((document) => inspectCaptureDocument(document, relativePath, toolchain));
    const scannedEntry = {
      relative_path: relativePath,
      file_path: filePath,
      inspections,
      inspection: inspections[0],
      sha256: sourceSha,
      bytes: buffer.length
    };
    scanned.push(scannedEntry);
    inventory.validated_new_format.push({
      relative_path: relativePath,
      sha256: sourceSha,
      page: inspections[0].page,
      query_id: inspections[0].query_id,
      sweep_id: inspections[0].sweep_id
    });
  }

  const chainSelection = selectCompleteCaptureChains(scanned, options);
  inventory.pending_chains = chainSelection.pending;
  for (const chain of chainSelection.completedChains) inventory.completed_chains.push(chain);
  for (const source of chainSelection.included) {
    const buffer = await readFile(source.file_path);
    if (sha256(buffer) !== source.sha256) throw new Error(`${source.relative_path}: 검증 후 원본이 변경되었습니다.`);
    const processed = await processEligibleFile({
      relativePath: source.relative_path,
      buffer,
      sourceSha: source.sha256,
      documents: parseJsonLines(buffer.toString("utf8"), source.relative_path),
      inspections: source.inspections,
      toolchain,
      cacheRoot,
      writeCache: mode === "apply"
    });
    inventory.cache_hits += processed.from_cache ? 1 : 0;
    inventory.cache_misses += processed.from_cache ? 0 : 1;
    inventory.observations += processed.entries.length;
    inventory.eligible.push({
      relative_path: source.relative_path,
      sha256: source.sha256,
      bytes: source.bytes,
      capture_count: processed.capture_count,
      observation_count: processed.entries.length
    });
    entries.push(...processed.entries);
  }
  inventory.eligible.sort((left, right) =>
    String(left.sha256).localeCompare(String(right.sha256)) ||
    String(left.relative_path).localeCompare(String(right.relative_path), "ko")
  );

  const sourceDigest = sha256(stableStringify({
    pipeline_version: PIPELINE_VERSION,
    toolchain_fingerprint: toolchain.fingerprint,
    normalizer_version: toolchain.normalizer.NORMALIZER_VERSION,
    minimum_extension_version: MINIMUM_EXTENSION_VERSION,
    minimum_catalog_version: MINIMUM_CATALOG_VERSION,
    sources: inventory.eligible.map((source) => source.sha256).sort()
  }));
  const datasetVersion = sourceDigest.slice(0, 20);
  const previous = privateCurrentStatus.value;
  const publicCurrent = publicManifestStatus.value;
  const baseResult = {
    mode,
    ready: inventory.eligible.length > 0,
    dataset_version: inventory.eligible.length ? datasetVersion : null,
    scanned_files: inventory.scanned_files,
    validated_new_format_files: inventory.validated_new_format.length,
    eligible_new_format_files: inventory.eligible.length,
    reused_validated_files: inventory.reused_validated.length,
    newly_eligible_files: inventory.eligible.length - (trustedPrevious?.state.sources.length || 0),
    reused_dataset_version: trustedPrevious?.state.dataset_version || null,
    reused_dataset_origin: trustedPrevious?.origin || null,
    ignored_legacy_files: inventory.ignored_legacy.length,
    duplicate_source_files: inventory.duplicate_source_files.length,
    completed_chains: inventory.completed_chains.length,
    pending_chains: inventory.pending_chains,
    quarantined_chains: chainSelection.quarantined,
    observations: inventory.observations,
    cache_hits: inventory.cache_hits,
    cache_misses: inventory.cache_misses,
    current_dataset_version: previous?.dataset_version || null,
    public_dataset_version: publicCurrent?.dataset_version || null,
    changed: inventory.eligible.length > 0 && (
      previous?.dataset_version !== datasetVersion || publicCurrent?.dataset_version !== datasetVersion
    )
  };
  if (!inventory.eligible.length) {
    if (mode === "apply") {
      throw new Error(`적용 가능한 ${MINIMUM_EXTENSION_VERSION} 이상 신규 raw 파일이 없습니다. 기존 공개 데이터는 변경하지 않았습니다.`);
    }
    return baseResult;
  }

  const uniqueEntries = deduplicateNativeEntries(entries);
  // Old rows and new per-observation objects are no longer needed after merge.
  entries.length = 0;
  if (trustedPrevious) {
    trustedPrevious.entries.length = 0;
    trustedPrevious.rows.length = 0;
  }
  baseResult.unique_sales = uniqueEntries.length;
  baseResult.duplicate_observations = inventory.observations - uniqueEntries.length;
  if (!uniqueEntries.length) {
    if (mode === "apply") {
      throw new Error("완료된 신규 raw에서 판매 매물을 한 건도 얻지 못했습니다. 기존 공개 데이터는 변경하지 않았습니다.");
    }
    return { ...baseResult, ready: false, changed: false };
  }
  const previousSourceBaseline = await resolvePreviousSourceBaseline({
    privateRoot,
    privateCurrentStatus,
    publicManifestStatus,
    nextDatasetVersion: datasetVersion
  });
  const releaseVerification = await verifyCurrentRelease({
    datasetVersion,
    toolchain,
    inventory,
    uniqueEntries,
    privateRoot,
    publicRoot,
    privateCurrentStatus,
    publicManifestStatus
  });
  baseResult.current_release_valid = releaseVerification.valid;
  baseResult.current_release_issues = releaseVerification.issues;
  baseResult.changed = !releaseVerification.valid;
  baseResult.previous_source_guard = previousSourceBaseline.unresolved
    ? "unresolved"
    : previousSourceBaseline.origins.length > 0
      ? "verified"
      : "not_applicable";
  baseResult.previous_source_guard_origins = previousSourceBaseline.origins;
  baseResult.previous_source_baseline_files = previousSourceBaseline.hashes.size;
  const previousSources = previousSourceBaseline.hashes;
  const missingPreviousSources = [...previousSources].filter((sourceSha) => !rawPresentSourceHashes.has(sourceSha));
  baseResult.missing_previous_sources = missingPreviousSources.length;
  if (mode === "apply" && trustedPrevious && baseResult.newly_eligible_files === 0 &&
      inventory.reused_validated.length === 0 && missingPreviousSources.length > 0 &&
      options.replaceExisting !== true) {
    throw new Error(`적용 가능한 ${MINIMUM_EXTENSION_VERSION} 이상 신규 raw 파일이 없습니다. 기존 공개 데이터는 변경하지 않았습니다.`);
  }
  if (mode === "apply" && previousSourceBaseline.unresolved && options.replaceExisting !== true) {
    throw new Error("기존 공개판의 원본 목록을 복구할 수 없습니다. 축소 적용을 막기 위해 중단했습니다. 의도적인 교체만 --replace를 명시해야 합니다.");
  }
  if (mode === "apply" && missingPreviousSources.length > 0 && options.replaceExisting !== true) {
    throw new Error(`이전 공개판의 신규 raw ${missingPreviousSources.length}개가 현재 폴더에서 사라졌습니다. 삭제 반영은 --replace를 명시해야 합니다.`);
  }
  if (mode !== "apply") return baseResult;
  if (!baseResult.changed) return { ...baseResult, applied: false, reason: "already_current" };
  const manifest = await writeRelease({
    uniqueEntries,
    inventory,
    datasetVersion,
    toolchain,
    privateRoot,
    publicRoot
  });
  const repaired = previous?.dataset_version === datasetVersion ||
    publicCurrent?.dataset_version === datasetVersion;
  return { ...baseResult, applied: true, repaired, manifest };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") options.mode = "check";
    else if (argument === "--status") options.mode = "status";
    else if (argument === "--replace") options.replaceExisting = true;
    else if (argument === "--defer-invalid-chains") options.deferInvalidChains = true;
    else if (["--raw-dir", "--private-dir", "--public-dir", "--extension-root"].includes(argument)) {
      const value = argv[++index];
      if (!value) throw new Error(`${argument} 뒤에 경로가 필요합니다.`);
      if (argument === "--raw-dir") options.rawRoot = value;
      if (argument === "--private-dir") options.privateRoot = value;
      if (argument === "--public-dir") options.publicRoot = value;
      if (argument === "--extension-root") options.extensionRoot = value;
    } else {
      throw new Error(`알 수 없는 인수: ${argument}`);
    }
  }
  return options;
}

if (path.resolve(process.argv[1] || "") === SCRIPT_PATH) {
  try {
    const result = await refreshItemMarketData(parseArguments(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  }
}
