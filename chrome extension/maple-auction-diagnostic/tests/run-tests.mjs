import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  migrateV1Batch,
  normalizeCaptureV2,
  normalizePotential,
  normalizeStats,
  parseInput,
  parseKoreanPrice,
  parsePotentialOption,
  sha256
} from "../tools/normalize-lib.mjs";
import { assertTrainingSafe, toCsv, toTrainingRows } from "../tools/training-lib.mjs";
import {
  ACCESSORY_DROP_MESO_TARGETS,
  BASELINE_MIN_PRICE_MESO,
  CATALOG_EXPECTED_COUNTS,
  CATALOG_ITEMS,
  CATALOG_VALIDATION,
  GLOBAL_CATEGORY_POTENTIAL_SEARCHES,
  POTENTIAL_FILTER_CAPABILITIES,
  STARFORCE_BANDS,
  applicablePotentialProfiles,
  classifyPotentialProfile,
  classifyPotentialProfiles,
  expandCatalogQueries,
  getCatalogItem,
  globalCategoryPotentialExclusion,
  equipmentCategoryFromPath,
  potentialThresholdsForLevel,
  starforceBandForValue,
  summarizePotentialLines
} from "../tools/catalog.mjs";
import {
  HARD_QUERY_LIMIT,
  FILTER_SEARCH_MIN_INTERVAL_MS,
  LANE_PLAN,
  NORMAL_QUERY_LIMIT,
  RESERVE_QUERY_LIMIT,
  advanceAttemptPhase,
  addKstDays,
  applyEmptyBackoff,
  calibratePageLimit,
  canBorrowReserveForNormal,
  clearEmptyBackoff,
  createCollectorState,
  createLaneUsage,
  createPageBoundary,
  createPaginationState,
  createStructuredPageSignature,
  effectivePageLimit,
  emptyBackoffDays,
  evaluateCollectedPage,
  filterSearchDelayRemaining,
  inferNextEligibleReason,
  isCandidateEligible,
  isPhysicalQueryComplete,
  lanePlanTotal,
  quotaRemaining,
  rebaseQuotaSession,
  reconcileObservedQuota,
  recoverInterruptedState,
  releaseUnrequestedReservation,
  resetCollectorProgress,
  reserveQueryQuota,
  rolloverCollectorState,
  selectNextCandidate,
  summarizeEquipmentQueryProgress,
  toKstDateKey
} from "../tools/collector-core.mjs";
import {
  buildFilterContinuationUrl,
  buildPresetUrl,
  buildQueryUrl,
  isPriceTabUrl,
  isReusableFilterSearchUrl,
  isSubmittedFilterSearchUrl,
  presetMatchesSearchContext,
  queryMatchesSearchContext,
  requiresFilterSubmission,
  validatePreset,
  withDefaultPageLimit,
  withPage
} from "../tools/preset-core.mjs";
import {
  FILTER_DIAGNOSTIC_QUERY,
  FILTER_DIAGNOSTIC_STAGE_ORDER,
  buildDiagnosticExport,
  diagnosticFailureMessage,
  diagnosticExportContainsSensitiveData,
  mergeDiagnosticSteps,
  redactDiagnosticText,
  sanitizeDiagnosticEvidence
} from "../tools/diagnostic-core.mjs";
import {
  createResultStabilityState,
  observeResultStability
} from "../tools/result-stability.mjs";
import {
  buildNetworkDiagnosticReport,
  diagnoseNetworkDiagnosticReport,
  formatNetworkDiagnosticEvent,
  networkDiagnosticExportContainsSensitiveData,
  sanitizeNetworkRequestEvent
} from "../tools/network-diagnostic-core.mjs";
import { validateSchema } from "./schema-validator.mjs";
import "../capture-core.js";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const extensionDirectory = path.dirname(testDirectory);
const samplePath = path.join(
  testDirectory,
  "fixtures",
  "sample-raw-v1.jsonl"
);
const expectedSampleHash = "f37a53ba604e587b36414960452f2fece81379fdd6026d4effc13e79b8804a38";
const expectedSampleRecords = 3;

function sensitiveViolations(value, currentPath = "$") {
  const violations = [];
  if (!value || typeof value !== "object") return violations;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = `${currentPath}.${key}`;
    if (/(?:seller|maker|cookie|authorization|otp|csrf|localStorage|sessionStorage|account|full_html|innerhtml|outerhtml)/iu.test(key)) {
      violations.push(nextPath);
    }
    violations.push(...sensitiveViolations(child, nextPath));
  }
  return violations;
}

function sampleCaptureDocument() {
  return {
    schema_version: "maple-auction.capture.v2",
    capture: {
      batch_id: "test-batch",
      captured_at: "2026-09-01T19:48:21+09:00",
      extension_version: "0.5.0",
      source_site: "https://auction.maplestory.nexon.com",
      source_path: "/price",
      viewer_world: null,
      auction_group: null,
      search_context: {
        page_kind: "sold",
        keyword: "에테르넬 나이트아머",
        sort: "trade_date_desc",
        page: 1,
        limit: 40,
        only_current_world: null,
        filters: {},
        raw_filters: {}
      },
      result_summary: {
        total_results: null,
        total_pages: null,
        current_page: 1,
        has_next_page: null,
        page_item_count: 1
      }
    },
    items: [{
      observation_id: "test-batch:1",
      row_index: 1,
      result_rank: 1,
      listing: {
        listing_id: null,
        listing_id_source: "unavailable",
        listing_fingerprint: `sha256:${"a".repeat(64)}`,
        status: "sold",
        price_meso: "20888888800",
        quantity: 1,
        sold_at: "2026-09-01",
        sold_at_precision: "date",
        expires_at: null,
        listing_world: null,
        is_cross_world: null
      },
      item: {
        item_id: null,
        item_id_source: "icon_asset_key",
        catalog_key: "name_icon_sha256:test",
        name: "에테르넬 나이트아머",
        base_level: null,
        required_level: 250,
        required_level_reduction: null,
        starforce: { value: null, source: "unknown", confidence: "unknown" },
        stats: { normalized: false, lines: [] },
        potential: { collected: true, grade: "legendary", lines: [] },
        additional_potential: { collected: true, grade: "none", lines: [] }
      },
      raw_evidence: {},
      quality_warnings: []
    }]
  };
}

function potentialLine(code, value, unit = "pct", raw = null) {
  return {
    code,
    value,
    unit,
    raw: raw || `${code} +${value}${unit === "pct" ? "%" : unit === "seconds" ? "초" : ""}`
  };
}

function soldListing(id, soldAt, price = "100000000") {
  return {
    listing: {
      listing_id: id,
      listing_id_source: "native",
      listing_fingerprint: `sha256:${String(id).padStart(64, "0").slice(-64)}`,
      status: "sold",
      sold_at: soldAt,
      price_meso: price
    },
    item: { name: "테스트 장비" }
  };
}

function buildPhysicalQuerySchedulerTasks(queries) {
  const tasks = new Map();
  const addTask = (query, lane) => {
    const id = `${query.query_id}#${lane}`;
    tasks.set(id, {
      id,
      query_id: query.query_id,
      lane,
      priority: query.priority
    });
  };

  for (const query of queries) {
    const hasStarforce = query.starforce_min != null || query.starforce_max != null;
    const logical = new Set(query.logical_lanes);
    if (hasStarforce) {
      addTask(query, "starforce");
      continue;
    }
    if (query.potential_filter) {
      const lane = [...logical].some((value) => value.startsWith("POT_MITRA"))
        ? "mitra"
        : [...logical].some((value) => value.startsWith("POT_ACCESSORY_"))
          ? "accessory"
        : logical.has("POT_ALL_STAT") ? "allstat" : "main";
      addTask(query, lane);
      continue;
    }

    addTask(query, "baseline");
    if (logical.has("POT_MAX_HP")) addTask(query, "hp");
    if (logical.has("POT_HAT_COOLDOWN")) addTask(query, "hat");
    if (logical.has("POT_GLOVE_CRITICAL_DAMAGE")) addTask(query, "glove");
    if (logical.has("POT_ACCESSORY_DROP_MESO")) addTask(query, "accessory");
    if ([...logical].some((value) => value.startsWith("POT_MITRA"))) addTask(query, "mitra");
    addTask(query, "audit");
  }
  return [...tasks.values()];
}

export async function runTests() {
  const results = [];
  const failures = [];
  const test = async (name, callback) => {
    try {
      await callback();
      results.push({ name, status: "passed" });
    } catch (error) {
      const failure = {
        name,
        status: "failed",
        message: error?.message || String(error)
      };
      results.push(failure);
      failures.push(failure);
    }
  };

  const sampleBefore = await readFile(samplePath);
  const records = sampleBefore.toString("utf8").split(/\r?\n/u).filter(Boolean).map(JSON.parse);
  const normalized = migrateV1Batch(records);

  await test("자립형 표본 JSONL 파싱", () => assert.equal(records.length, expectedSampleRecords));
  await test("한글 가격과 price_meso 일치", () => {
    records.forEach((record) => assert.equal(
      parseKoreanPrice(record.listing.price_raw || record.raw.listing_row.price),
      record.listing.price_meso
    ));
  });
  await test("조 단위 화면 가격을 손실 없이 파싱", async () => {
    const cases = [
      ["9999억 9999만 9999 메소", "999999999999"],
      ["1조 메소", "1000000000000"],
      ["1조 1000억 메소", "1100000000000"],
      ["1조 1,000억 메소", "1100000000000"],
      ["1조1000억메소", "1100000000000"],
      ["2조 3456억 7890만 1234 메소", "2345678901234"]
    ];
    for (const [raw, expected] of cases) {
      assert.equal(parseKoreanPrice(raw), expected, raw);
    }

    const contentSource = await readFile(path.join(extensionDirectory, "content.js"), "utf8");
    const start = contentSource.indexOf("function extractRawPrice");
    const end = contentSource.indexOf("function parseSignedNumber", start);
    assert.ok(start >= 0 && end > start);
    const priceParsers = new Function(
      `${contentSource.slice(start, end)}; return { extractRawPrice, rawPriceToMesoString };`
    )();
    for (const [raw, expected] of cases) {
      const extracted = priceParsers.extractRawPrice(`장비명 ${raw} 2026-09-03`);
      assert.equal(priceParsers.rawPriceToMesoString(extracted), expected, raw);
    }
  });
  await test("표본 손실 없이 변환", () => assert.equal(normalized.length, expectedSampleRecords));
  await test("스탯 구성요소 합과 total 일치", () => {
    normalized.forEach((record) => assert.equal(record.item.stats.validation.all_component_sums_match, true));
  });
  await test("첫 매물 색상 원천 정규화", () => {
    const stats = normalized[0].item.stats;
    assert.equal(stats.base.str_flat, 1);
    assert.equal(stats.starforce.str_flat, 2);
    assert.equal(stats.scroll.str_flat, 3);
    assert.equal(stats.flame.str_flat, 4);
    assert.equal(stats.total.str_flat, 10);
  });
  await test("API source_hint는 색상 정보가 없어도 출처별로 보존", () => {
    const repairs = [];
    const warnings = [];
    const stats = normalizeStats({
      collected: true,
      lines: [{
        code: "str",
        key: "str_flat",
        label: "STR",
        total: 10,
        unit: "flat",
        breakdown: [
          { value: 1, unit: "flat", source_hint: "base" },
          { value: 2, unit: "flat", source_hint: "starforce" },
          { value: 3, unit: "flat", source_hint: "scroll" },
          { value: 4, unit: "flat", source_hint: "flame" }
        ]
      }]
    }, repairs, warnings);
    assert.equal(stats.base.str_flat, 1);
    assert.equal(stats.starforce.str_flat, 2);
    assert.equal(stats.scroll.str_flat, 3);
    assert.equal(stats.flame.str_flat, 4);
    assert.equal(stats.validation.all_component_sums_match, true);
    assert.deepEqual(warnings, []);
  });
  await test("잠재 RGB를 tier로 변환", () => {
    const first = normalized[0].item.potential.lines;
    assert.deepEqual(first.map((line) => line.tier), ["legendary", "unique", "unique"]);
    assert.deepEqual(first.map((line) => line.is_prime), [true, false, false]);
  });
  await test("에디 없음을 none으로 변환", () => {
    assert.equal(normalized.filter((record) => record.item.additional_potential.grade === "none").length, 1);
    normalized.filter((record) => record.item.additional_potential.grade === "none")
      .forEach((record) => assert.deepEqual(record.item.additional_potential.lines, []));
  });
  await test("스타포스 null과 0 구분", () => {
    assert.equal(normalized.filter((record) => record.item.starforce.value === null).length, 1);
    assert.equal(normalized.filter((record) => record.item.starforce.value === 0).length, 1);
  });
  await test("판매 툴팁 별 마커에서 0성과 강화 수치를 구분", () => {
    const { starforceObservationFromMarkerCounts } = globalThis.MapleAuctionCaptureCore;
    assert.deepEqual(starforceObservationFromMarkerCounts(0, 30), {
      value: 0,
      applicable: true,
      source: "dom",
      confidence: "confirmed"
    });
    assert.deepEqual(starforceObservationFromMarkerCounts(22, 8), {
      value: 22,
      applicable: true,
      source: "dom",
      confidence: "confirmed"
    });
    assert.equal(starforceObservationFromMarkerCounts(0, 4), null);
  });
  await test("스타포스 DOM·카탈로그·정확 0/23성 검색 근거를 우선순위대로 판정", () => {
    const { resolveStarforceEvidence } = globalThis.MapleAuctionCaptureCore;
    assert.deepEqual(resolveStarforceEvidence({
      row_observation: { value: null, applicable: null, source: "unknown", confidence: "unknown" },
      tooltip_observation: { value: 0, applicable: true, source: "dom", confidence: "confirmed" },
      starforce_eligible: true
    }).observation, {
      value: 0,
      applicable: true,
      source: "dom",
      confidence: "confirmed"
    });
    assert.deepEqual(resolveStarforceEvidence({
      starforce_eligible: false
    }).observation, {
      value: null,
      applicable: false,
      source: "catalog",
      confidence: "confirmed"
    });
    const filtered = resolveStarforceEvidence({
      row_observation: { value: null, applicable: null, source: "unknown", confidence: "unknown" },
      starforce_eligible: true,
      starforce_min: 0,
      starforce_max: 0
    });
    assert.equal(filtered.observation.value, 0);
    assert.equal(filtered.observation.source, "query_filter");
    assert.equal(filtered.observation.confidence, "inferred");
    const filteredTwentyThree = resolveStarforceEvidence({
      row_observation: { value: null, applicable: null, source: "unknown", confidence: "unknown" },
      starforce_eligible: true,
      starforce_min: 23,
      starforce_max: 23
    });
    assert.deepEqual(filteredTwentyThree.observation, {
      value: 23,
      applicable: true,
      source: "query_filter",
      confidence: "inferred"
    });
    assert.deepEqual(filteredTwentyThree.warnings, ["starforce_inferred_from_exact_filter"]);
    assert.deepEqual(resolveStarforceEvidence({
      row_observation: { value: 18, source: "dom", confidence: "confirmed" },
      tooltip_observation: { value: 17, source: "dom", confidence: "confirmed" },
      starforce_eligible: true
    }).warnings, ["starforce_evidence_conflict:row_tooltip_mismatch"]);
  });
  await test("기존 capture.v2의 검증된 0성 검색 결과를 재정규화", () => {
    const capture = sampleCaptureDocument();
    capture.capture.search_context.filter_search_applied = true;
    capture.capture.search_context.filters = {
      enhancement: { starforce_min: 0, starforce_max: 0 }
    };
    capture.capture.query_task = { starforce_min: 0, starforce_max: 0 };
    capture.items[0].item.starforce = {
      value: null,
      source: "unknown",
      confidence: "unknown"
    };
    capture.items[0].quality_warnings = ["starforce_not_confirmed; null_preserved"];
    const [record] = normalizeCaptureV2(capture);
    assert.deepEqual(record.item.starforce, {
      value: 0,
      applicable: true,
      source: "query_filter",
      confidence: "inferred"
    });
    assert.equal(record.repair_changes.includes("item.starforce_null_to_zero_from_verified_filter"), true);
    assert.equal(record.quality_warnings.some((warning) =>
      warning.startsWith("starforce_not_confirmed")
    ), false);
  });
  await test("기본 레벨과 실제 요구 레벨 분리", () => {
    assert.equal(normalized.filter((record) => record.item.base_level === null).length, expectedSampleRecords);
    assert.equal(normalized.filter((record) => record.item.required_level != null).length, expectedSampleRecords);
    assert.equal(normalized.filter((record) => record.item.required_level_reduction === null).length, expectedSampleRecords);
  });
  await test("파생 ID를 listing_id로 사용하지 않음", () => {
    normalized.forEach((record) => {
      assert.equal(record.listing.listing_id, null);
      assert.equal(record.listing.listing_id_source, "unavailable");
      assert.match(record.listing.listing_fingerprint, /^sha256:[0-9a-f]{64}$/u);
      assert.equal(record.listing.listing_fingerprint_collision_risk, true);
    });
  });
  await test("복합 잠재와 UNKNOWN raw 보존", () => {
    const lines = normalized.flatMap((record) => [
      ...record.item.potential.lines,
      ...record.item.additional_potential.lines
    ]);
    assert.equal(lines.filter((line) => line.code === "DAMAGE_REFLECT").length, 1);
    assert.equal(lines.filter((line) => line.code === "DAMAGE_IGNORE_ON_HIT").length, 1);
    assert.equal(lines.filter((line) => line.code === "INVINCIBLE_ON_HIT").length, 1);
    const unknown = parsePotentialOption("아직 모르는 복합 옵션 12와 34");
    assert.equal(unknown.code, "UNKNOWN");
    assert.equal(unknown.raw, "아직 모르는 복합 옵션 12와 34");
  });
  await test("API 잠재 구조화 값은 보존하고 구형 잠재는 원문으로 재파싱", () => {
    const apiCapture = sampleCaptureDocument();
    apiCapture.capture.collection_transport = "tooltip_api";
    apiCapture.items[0].item.potential = {
      collected: true,
      grade: "legendary",
      grade_raw: "레전드리",
      grade_source: "api_tooltip",
      lines: [{
        code: "SKILL_AVAILABLE",
        value: null,
        unit: null,
        tier: "legendary",
        params: { skill_name: "쓸만한 샤프 아이즈" },
        raw: "아직 원문 파서가 모르는 API 표기"
      }]
    };
    const [apiRecord] = normalizeCaptureV2(apiCapture);
    assert.deepEqual(apiRecord.item.potential.lines[0], {
      line_index: 1,
      code: "SKILL_AVAILABLE",
      value: null,
      unit: null,
      tier: "legendary",
      is_prime: true,
      params: { skill_name: "쓸만한 샤프 아이즈" },
      raw: "아직 원문 파서가 모르는 API 표기"
    });

    const legacySection = {
      collected: true,
      grade: "legendary",
      grade_raw: "레전드리",
      grade_source: "tooltip",
      lines: [{
        code: "ATTACK",
        value: 999,
        unit: "flat",
        params: { stale_parser_value: true },
        raw: "STR +13%"
      }]
    };
    const legacyNormalized = normalizePotential(legacySection, [], { preferStructured: true });
    assert.deepEqual(legacyNormalized.lines[0], {
      line_index: 1,
      code: "STR",
      value: 13,
      unit: "pct",
      tier: null,
      is_prime: null,
      params: {},
      raw: "STR +13%"
    });

    const untrustedCapture = sampleCaptureDocument();
    untrustedCapture.items[0].item.potential = {
      ...apiCapture.items[0].item.potential,
      lines: [{
        code: "ATTACK",
        value: 999,
        unit: "flat",
        params: { stale_parser_value: true },
        raw: "INT +9%"
      }]
    };
    const [untrustedRecord] = normalizeCaptureV2(untrustedCapture);
    assert.equal(untrustedRecord.item.potential.lines[0].code, "INT");
    assert.equal(untrustedRecord.item.potential.lines[0].value, 9);
    assert.equal(untrustedRecord.item.potential.lines[0].unit, "pct");
    assert.deepEqual(untrustedRecord.item.potential.lines[0].params, {});

    const legacyV1 = structuredClone(records[0]);
    legacyV1.item.potential.lines = [{
      code: "ATTACK",
      value: 999,
      unit: "flat",
      params: { stale_parser_value: true },
      raw: "LUK +12%"
    }];
    const [migratedV1] = migrateV1Batch([legacyV1]);
    assert.equal(migratedV1.item.potential.lines[0].code, "LUK");
    assert.equal(migratedV1.item.potential.lines[0].value, 12);
    assert.equal(migratedV1.item.potential.lines[0].unit, "pct");
    assert.deepEqual(migratedV1.item.potential.lines[0].params, {});
  });
  await test("특수 잠재 옵션 4종을 손실 없이 정규화", () => {
    const cases = [{
      raw: "캐릭터 기준 9레벨 당 INT +2",
      expected: {
        code: "STAT_PER_CHARACTER_LEVEL",
        value: null,
        unit: null,
        params: { levels_per_increment: 9, stat_code: "INT", stat_value: 2 }
      }
    }, {
      raw: "모든 스킬의 재사용 대기시간 -2초",
      expected: {
        code: "COOLDOWN_REDUCTION",
        value: 2,
        unit: "seconds",
        params: {}
      }
    }, {
      raw: "공격 시 15% 확률로 HP 95 회복",
      expected: {
        code: "HP_RECOVERY_ON_ATTACK",
        value: 95,
        unit: "flat",
        params: { trigger_chance_pct: 15 }
      }
    }, {
      raw: "<쓸만한 샤프 아이즈> 스킬 사용 가능",
      expected: {
        code: "SKILL_AVAILABLE",
        value: null,
        unit: null,
        params: { skill_name: "쓸만한 샤프 아이즈" }
      }
    }];
    for (const { raw, expected } of cases) {
      assert.deepEqual(parsePotentialOption(raw), { ...expected, raw });
    }
    assert.equal(parsePotentialOption("보스 공격 시 데미지 +40%").code, "BOSS_DAMAGE");
    assert.equal(parsePotentialOption("방어율 무시 +30%").code, "IGNORE_DEFENSE");
  });
  await test("9레벨당 스탯 잠재의 공백 변형과 수치를 정규화", () => {
    for (const stat of ["STR", "DEX", "INT", "LUK"]) {
      for (const value of [1, 2]) {
        for (const raw of [
          `캐릭터 기준 9레벨 당 ${stat} +${value}`,
          `캐릭터 기준 9레벨당 ${stat} +${value}`
        ]) {
          const parsed = parsePotentialOption(raw);
          assert.equal(parsed.code, "STAT_PER_CHARACTER_LEVEL");
          assert.equal(parsed.value, null);
          assert.equal(parsed.unit, null);
          assert.deepEqual(parsed.params, {
            levels_per_increment: 9,
            stat_code: stat,
            stat_value: value
          });
          const summary = summarizePotentialLines([parsed]);
          assert.equal(summary.unknown_line_count, 0);
          assert.equal(summary.ignored_line_count, 1);
        }
      }
    }
  });
  await test("모자 재사용 대기시간 감소 표기를 초 단위로 정규화", () => {
    for (const [raw, seconds] of [
      ["스킬 재사용 대기시간 -1초", 1],
      ["스킬 재사용 대기시간 -2초", 2],
      ["재사용 대기시간 1초 감소", 1],
      ["재사용 대기시간 -2초 감소", 2],
      ["모든 스킬의 재사용 대기시간 -2초", 2]
    ]) {
      const parsed = parsePotentialOption(raw);
      assert.equal(parsed.code, "COOLDOWN_REDUCTION");
      assert.equal(parsed.value, seconds);
      assert.equal(parsed.unit, "seconds");
    }
    assert.equal(summarizePotentialLines([
      parsePotentialOption("스킬 재사용 대기시간 -1초"),
      parsePotentialOption("스킬 재사용 대기시간 -2초")
    ]).seconds.COOLDOWN_REDUCTION, 3);
  });
  await test("장갑 오토스틸 잠재를 유효 옵션으로 정규화", () => {
    for (const raw of [
      "공격 시 3% 확률로 오토스틸",
      "공격 시 7% 확률로 오토스틸"
    ]) {
      const parsed = parsePotentialOption(raw);
      assert.equal(parsed.code, "AUTO_STEAL");
      assert.equal(parsed.value, Number(raw.match(/(\d+)%/u)[1]));
      assert.equal(parsed.unit, "pct");
      assert.equal(summarizePotentialLines([parsed]).unknown_line_count, 0);
    }
  });
  await test("구조화 응답 훅과 격리 브리지 로드 순서 고정", async () => {
    const contentSource = await readFile(path.join(extensionDirectory, "content.js"), "utf8");
    const managerSource = await readFile(path.join(extensionDirectory, "manager.js"), "utf8");
    const networkHookSource = await readFile(path.join(extensionDirectory, "tooltip-network-hook.js"), "utf8");
    const manifest = JSON.parse(await readFile(path.join(extensionDirectory, "manifest.json"), "utf8"));
    assert.equal(contentSource.includes("레벨\\s*당"), true);
    assert.equal(contentSource.includes("(?:모든\\s*스킬의?|스킬)\\s*)?재사용 대기시간"), true);
    assert.equal(contentSource.includes("captureCore.resolveStarforceEvidence"), true);
    assert.equal(contentSource.includes("extractTooltipStarforceObservation"), true);
    assert.deepEqual(manifest.content_scripts[0].js, ["tooltip-network-hook.js"]);
    assert.deepEqual(manifest.content_scripts[0].matches, ["https://auction.maplestory.nexon.com/*"]);
    assert.equal(manifest.content_scripts[0].run_at, "document_start");
    assert.equal(manifest.content_scripts[0].world, "MAIN");
    assert.deepEqual(manifest.content_scripts[1].js, ["capture-core.js", "content.js"]);
    assert.deepEqual(manifest.content_scripts[1].matches, ["https://auction.maplestory.nexon.com/*"]);
    assert.equal(managerSource.includes('files: ["capture-core.js", "content.js"]'), true);
    assert.equal(managerSource.includes('files: ["tooltip-network-hook.js"]'), true);
    assert.equal(managerSource.includes('import "./tooltip-response-core.js"'), true);
    assert.equal(managerSource.includes('type: "MAPLE_CAPTURE_COLLECT_ITEM"'), false);
    assert.equal(contentSource.includes('message?.type === "MAPLE_CAPTURE_COLLECT_ITEM"'), false);
    assert.equal(contentSource.includes("openSaleTooltip"), false);
    assert.equal(contentSource.includes("dispatchSyntheticHover"), false);
    assert.equal(contentSource.includes("maple-auction-jsonl-shield"), false);
    assert.equal(managerSource.includes("chrome.tabs.reload(sourceTabId)"), true);
    assert.equal(managerSource.includes("validateTooltipNetworkPageAgainstDom"), true);
    assert.equal(managerSource.includes("assertTooltipNetworkFetchContext"), false);
    assert.equal(managerSource.includes("!networkCapture && (listResponse.items || []).length > 0"), false);
    assert.equal(networkHookSource.includes("currentPrivateSearchKey"), true);
    assert.equal(networkHookSource.includes("session_token"), true);
  });
  await test("민감정보가 normalized와 training에 없음", () => {
    assert.deepEqual(normalized.flatMap((record) => sensitiveViolations(record)), []);
    const rows = toTrainingRows(normalized);
    assert.equal(assertTrainingSafe(rows), true);
    assert.doesNotMatch(toCsv(rows), /(?:seller|maker|cookie|authorization|csrf|otp|combat_power_change|price_raw)/iu);
  });
  await test("native ID가 없는 동일 매물은 서로 다른 query·attempt에서 1회로 합침", () => {
    const first = structuredClone(normalized[0]);
    const second = structuredClone(normalized[0]);
    first.capture.query_task = { query_id: "query:first" };
    first.capture.attempt = { attempt_id: "attempt:first" };
    first.matched_preset_ids = ["preset:first"];
    first.selection_channels = ["BASE_ANY"];
    second.capture.query_task = { query_id: "query:second" };
    second.capture.attempt = { attempt_id: "attempt:second" };
    second.observation_id = "fallback:second";
    second.matched_preset_ids = ["preset:second"];
    second.selection_channels = ["POT_MAIN_STR"];

    const rows = toTrainingRows([first, second]);
    assert.equal(rows.length, 1);
    assert.deepEqual(JSON.parse(rows[0].matched_preset_ids_json), [
      "preset:first",
      "preset:second"
    ]);
    assert.deepEqual(JSON.parse(rows[0].selection_channels_json), [
      "BASE_ANY",
      "POT_MAIN_STR"
    ]);
  });
  await test("native ID가 없는 동일 fingerprint는 한 attempt 내 최대 multiplicity를 보존", () => {
    const makeRecord = (attemptId, observationId, presetId, channel) => {
      const record = structuredClone(normalized[0]);
      record.capture.query_task = { query_id: `query:${attemptId}` };
      record.capture.attempt = { attempt_id: attemptId };
      record.observation_id = observationId;
      record.matched_preset_ids = [presetId];
      record.selection_channels = [channel];
      return record;
    };
    const rows = toTrainingRows([
      makeRecord("attempt:two", "fallback:two:1", "preset:a", "BASE_ANY"),
      makeRecord("attempt:two", "fallback:two:2", "preset:b", "POT_ALL_STAT"),
      makeRecord("attempt:one", "fallback:one:1", "preset:c", "SF_17_PLUS")
    ]);

    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.observation_id), [
      "fallback:two:1",
      "fallback:two:2"
    ]);
    rows.forEach((row) => {
      assert.deepEqual(JSON.parse(row.matched_preset_ids_json), [
        "preset:a",
        "preset:b",
        "preset:c"
      ]);
      assert.deepEqual(JSON.parse(row.selection_channels_json), [
        "BASE_ANY",
        "POT_ALL_STAT",
        "SF_17_PLUS"
      ]);
    });
  });
  await test("fallback 중복 판정 메타데이터가 없는 매물은 보존", () => {
    const first = structuredClone(normalized[0]);
    const second = structuredClone(normalized[0]);
    first.observation_id = "fallback:missing-query";
    second.observation_id = "fallback:missing-attempt";
    first.capture.attempt = { attempt_id: "attempt:present" };
    second.capture.query_task = { query_id: "query:present" };

    const rows = toTrainingRows([first, second]);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.observation_id), [
      "fallback:missing-query",
      "fallback:missing-attempt"
    ]);
  });
  await test("원본 SHA-256 불변", async () => {
    const sampleAfter = await readFile(samplePath);
    assert.equal(sha256(sampleBefore), expectedSampleHash);
    assert.equal(sha256(sampleAfter), expectedSampleHash);
  });

  await test("고정 카탈로그 151종·P1/P2·그룹 수·제외 항목 검증", () => {
    assert.equal(CATALOG_ITEMS.length, 151);
    assert.equal(new Set(CATALOG_ITEMS.map((item) => item.id)).size, 151);
    assert.equal(new Set(CATALOG_ITEMS.map((item) => item.name)).size, 151);
    assert.equal(CATALOG_VALIDATION.valid, true);
    assert.deepEqual(CATALOG_VALIDATION.priority, CATALOG_EXPECTED_COUNTS.priority);
    assert.deepEqual(CATALOG_VALIDATION.group, CATALOG_EXPECTED_COUNTS.group);
    assert.deepEqual(CATALOG_VALIDATION.priority, { P1: 141, P2: 10 });
    assert.deepEqual(CATALOG_VALIDATION.group, {
      core: 3,
      eternal: 35,
      arcane: 30,
      absolab: 30,
      cra: 15,
      black: 17,
      brilliant: 6,
      dawn: 4,
      boss: 11
    });
    [
      "영생의 돌",
      "크리스탈 웬투스 뱃지",
      "로얄 블랙메탈 숄더",
      "혼테일의 목걸이",
      "실버블라썸 링",
      "아쿠아틱 레터 눈장식",
      "응축된 힘의 결정석",
      "지옥의 불꽃"
    ].forEach((name) => assert.equal(getCatalogItem(name), null, name));
  });

  await test("미트라 5종 정확한 이름·공마 분기·제논 제외", () => {
    const mitra = CATALOG_ITEMS.filter((item) => item.subgroup === "mitra");
    assert.deepEqual(mitra.map((item) => item.name).sort(), [
      "미트라의 분노 : 궁수",
      "미트라의 분노 : 도적",
      "미트라의 분노 : 마법사",
      "미트라의 분노 : 전사",
      "미트라의 분노 : 해적"
    ].sort());
    assert.equal(CATALOG_ITEMS.some((item) => item.name === "미트라의 분노 : 제논"), false);
    mitra.forEach((item) => {
      assert.equal(item.level, 200);
      assert.equal(item.starforce_eligible, false);
      assert.equal(item.potential_eligible, true);
      assert.deepEqual(item.potential_profiles, ["MITRA_OPTIMAL"]);
    });
    assert.equal(getCatalogItem("미트라의 분노 : 마법사").mitra_attack_code, "MAGIC_ATTACK");
    mitra.filter((item) => item.name !== "미트라의 분노 : 마법사")
      .forEach((item) => assert.equal(item.mitra_attack_code, "ATTACK"));
  });

  await test("에테르넬 35종·부위별 5직업 구성", () => {
    const eternal = CATALOG_ITEMS.filter((item) => item.group === "eternal");
    assert.equal(eternal.length, 35);
    for (const slot of ["hat", "top", "bottom", "shoulder", "shoes", "gloves", "cape"]) {
      assert.equal(eternal.filter((item) => item.slot === slot).length, 5, slot);
    }
    eternal.forEach((item) => {
      assert.equal(item.priority, "P1");
      assert.equal(item.level, 250);
    });
  });

  await test("아케인셰이드·앱솔랩스 30종과 카루타 15종의 부위·직업군 구성", () => {
    for (const [group, level] of [["arcane", 200], ["absolab", 160]]) {
      const items = CATALOG_ITEMS.filter((item) => item.group === group);
      assert.equal(items.length, 30, group);
      for (const slot of ["hat", "overall", "shoulder", "shoes", "gloves", "cape"]) {
        assert.equal(items.filter((item) => item.slot === slot).length, 5, `${group}:${slot}`);
      }
      for (const family of ["warrior", "mage", "archer", "thief", "pirate"]) {
        assert.equal(items.filter((item) => item.job_family === family).length, 6, `${group}:${family}`);
      }
      items.forEach((item) => assert.equal(item.level, level, item.name));
    }

    const cra = CATALOG_ITEMS.filter((item) => item.group === "cra");
    assert.equal(cra.length, 15);
    for (const slot of ["hat", "top", "bottom"]) {
      assert.equal(cra.filter((item) => item.slot === slot).length, 5, `cra:${slot}`);
    }
    for (const family of ["warrior", "mage", "archer", "thief", "pirate"]) {
      assert.equal(cra.filter((item) => item.job_family === family).length, 3, `cra:${family}`);
    }
    assert.equal(cra.every((item) => item.level === 150), true);
    [
      "하이네스 워리어헬름",
      "하이네스 던위치햇",
      "하이네스 레인져베레",
      "하이네스 어새신보닛",
      "하이네스 원더러햇",
      "이글아이 워리어아머",
      "이글아이 던위치로브",
      "이글아이 레인져후드",
      "이글아이 어새신셔츠",
      "이글아이 원더러코트",
      "트릭스터 워리어팬츠",
      "트릭스터 던위치팬츠",
      "트릭스터 레인져팬츠",
      "트릭스터 어새신팬츠",
      "트릭스터 원더러팬츠"
    ].forEach((name) => assert.ok(getCatalogItem(name), name));
  });

  await test("어깨는 방어구 취급이며 드롭·메획 장신구 대상이 아님", () => {
    const shoulder = getCatalogItem("에테르넬 나이트숄더");
    assert.equal(shoulder.slot, "shoulder");
    assert.equal(shoulder.slot_label, "어깨장식");
    assert.equal(shoulder.accessory_profile_eligible, false);
    assert.equal(applicablePotentialProfiles(shoulder).includes("ACCESSORY_DROP_MESO"), false);
    CATALOG_ITEMS.filter((item) => item.slot === "shoulder")
      .forEach((item) => assert.equal(item.accessory_profile_eligible, false));
    const meisterShoulder = getCatalogItem("마이스터 숄더");
    assert.equal(meisterShoulder.level, 140);
    assert.equal(meisterShoulder.slot, "shoulder");
    assert.equal(meisterShoulder.accessory_profile_eligible, false);
  });

  await test("드롭·메획 프로필은 허용 장신구 5부위에만 적용", () => {
    const allowed = new Set(["ring", "pendant", "face", "eye", "earring"]);
    const eligible = CATALOG_ITEMS.filter((item) => item.accessory_profile_eligible);
    assert.ok(eligible.length > 0);
    eligible.forEach((item) => assert.equal(allowed.has(item.slot), true, item.name));
    assert.equal(getCatalogItem("마이스터링").accessory_profile_eligible, true);
    assert.equal(getCatalogItem("마이스터 이어링").accessory_profile_eligible, true);
    assert.equal(getCatalogItem("마이스터 이어링").level, 140);
    assert.equal(getCatalogItem("고통의 근원").accessory_profile_eligible, true);
    assert.equal(getCatalogItem("몽환의 벨트").accessory_profile_eligible, false);
    assert.equal(getCatalogItem("불멸의 유산").potential_eligible, false);
  });

  await test("드롭·메획 검색 결과를 5개 목표로 로컬 후분류", () => {
    assert.deepEqual(ACCESSORY_DROP_MESO_TARGETS.map((target) => target.id), [
      "MESO_40",
      "DROP_40",
      "DROP_20_MESO_20",
      "MESO_20",
      "DROP_20"
    ]);
    const item = getCatalogItem("마이스터 이어링");
    const classify = (lines) => classifyPotentialProfile("ACCESSORY_DROP_MESO", item, lines);

    assert.deepEqual(classify([potentialLine("MESO_OBTAINED", 40)]).matched_targets, [
      "MESO_40",
      "MESO_20"
    ]);
    assert.deepEqual(classify([potentialLine("ITEM_DROP_RATE", 40)]).matched_targets, [
      "DROP_40",
      "DROP_20"
    ]);
    assert.deepEqual(classify([
      potentialLine("MESO_OBTAINED", 20),
      potentialLine("ITEM_DROP_RATE", 20)
    ]).matched_targets, ["DROP_20_MESO_20", "MESO_20", "DROP_20"]);
    assert.deepEqual(classify([potentialLine("MESO_OBTAINED", 20)]).matched_targets, ["MESO_20"]);
    assert.deepEqual(classify([potentialLine("ITEM_DROP_RATE", 20)]).matched_targets, ["DROP_20"]);
  });

  await test("드롭·메획 5개 후분류 라벨은 학습 식별자까지 개별 보존", async () => {
    const managerSource = await readFile(path.join(extensionDirectory, "manager.js"), "utf8");
    const start = managerSource.indexOf("function enrichSelection");
    const end = managerSource.indexOf("async function prepareCaptureRecord", start);
    const source = managerSource.slice(start, end);
    assert.equal(source.includes("value.matched_targets"), true);
    assert.equal(source.includes("${catalogPrefix}:${profileId}:${targetId}"), true);
    assert.equal(source.includes('global:accessory-potential:matched'), false);
    assert.equal(source.includes('["ACCESSORY_DROP_MESO"]'), true);
  });

  await test("잠재 기준은 레벨 200/201 경계에서만 변경", () => {
    assert.deepEqual(potentialThresholdsForLevel(200), {
      min_level: 0,
      max_level: 200,
      main_stat_pct: { two_line: 21, three_line: 30 },
      hp_pct: { two_line: 21, three_line: 30 },
      all_stat_pct: { two_line: 15, three_line: 21 }
    });
    assert.deepEqual(potentialThresholdsForLevel(201), {
      min_level: 201,
      max_level: null,
      main_stat_pct: { two_line: 23, three_line: 33 },
      hp_pct: { two_line: 23, three_line: 33 },
      all_stat_pct: { two_line: 17, three_line: 24 }
    });
    assert.equal(potentialThresholdsForLevel(160).main_stat_pct.two_line, 21);
    assert.equal(potentialThresholdsForLevel(250).main_stat_pct.two_line, 23);
  });

  await test("주스탯·올스탯은 장비명 전체 검색에서 로컬 분류", () => {
    const meister = getCatalogItem("마이스터링");
    const meisterQueries = expandCatalogQueries({
      item_ids: [meister.id],
      include_starforce: false
    });
    assert.equal(meisterQueries.length, 1);
    assert.equal(meisterQueries[0].potential_filter, null);
    assert.equal(meisterQueries[0].price_min_meso, BASELINE_MIN_PRICE_MESO);
    assert.equal(meisterQueries[0].price_max_meso, null);
    assert.deepEqual(meisterQueries[0].page_sweep, {
      enabled: true,
      max_pages: 9,
      result_cap: 500
    });
    ["STR", "DEX", "INT", "LUK"].forEach((stat) => {
      assert.equal(meisterQueries[0].logical_lanes.includes(`POT_MAIN_${stat}`), true);
    });
    assert.equal(meisterQueries[0].logical_lanes.includes("POT_ALL_STAT"), true);
    assert.equal(meisterQueries[0].post_classify_profiles.includes("MAIN_STAT"), true);
    assert.equal(meisterQueries[0].post_classify_profiles.includes("ALL_STAT"), true);

    const eternal = getCatalogItem("에테르넬 나이트아머");
    const eternalQueries = expandCatalogQueries({
      item_ids: [eternal.id],
      include_starforce: false
    });
    assert.equal(eternalQueries.length, 1);
    assert.equal(eternalQueries[0].logical_lanes.includes("POT_MAIN_STR"), true);
    assert.equal(eternalQueries[0].logical_lanes.includes("POT_ALL_STAT"), true);
    assert.equal(eternalQueries[0].potential_filter, null);
  });

  await test("전체 185회·그룹 54회·전역 35회 검색과 페이지 수집 규칙", () => {
    const queries = expandCatalogQueries();
    const baseline = queries.filter((query) => query.logical_lanes.includes("BASE_ANY"));
    const starforceZero = queries.filter((query) => query.logical_lanes.includes("SF_0"));
    const starforceSeventeenPlus = queries.filter((query) => query.logical_lanes.includes("SF_17_PLUS"));
    const starforceOnePlus = queries.filter((query) => query.logical_lanes.includes("SF_1_PLUS"));
    const potentialFiltered = queries.filter((query) => query.potential_filter);
    const grouped = queries.filter((query) => query.search_group_id);
    const globalHighStarforce = queries.filter((query) => query.group === "global_high_starforce");
    const globalAccessoryPotential = queries.filter((query) => query.group === "global_accessory_potential");
    const globalCategoryPotential = queries.filter((query) => query.group === "global_category_potential");
    const priceFloored = queries.filter((query) => query.price_min_meso != null || query.price_max_meso != null);

    assert.equal(queries.length, 185);
    assert.equal(baseline.length, 59);
    assert.equal(starforceZero.length, 43);
    assert.equal(starforceSeventeenPlus.length, 43);
    assert.equal(starforceOnePlus.length, 4);
    assert.equal(potentialFiltered.length, 37);
    assert.equal(queries.filter((query) => query.page_sweep?.enabled === true).length, 184);
    assert.equal(grouped.length, 54);
    assert.equal(globalHighStarforce.length, 3);
    assert.equal(globalAccessoryPotential.length, 2);
    assert.equal(globalCategoryPotential.length, 30);
    assert.equal(globalAccessoryPotential.every((query) =>
      /:pot-(?:mesosObtainedPercent|itemDropPercent):20$/u.test(query.query_id)
    ), true, "상한 없는 기존 잠재 검색의 안정 ID를 유지");
    assert.equal(priceFloored.length, 54);
    assert.equal(priceFloored.every((query) =>
      query.price_min_meso === BASELINE_MIN_PRICE_MESO &&
      query.price_max_meso == null &&
      query.logical_lanes.includes("BASE_ANY")
    ), true);
    assert.equal(starforceZero.every((query) => query.price_min_meso == null), true);
    assert.equal(starforceSeventeenPlus.every((query) => query.price_min_meso == null), true);
    assert.equal(potentialFiltered.every((query) => query.price_min_meso == null), true);
    assert.equal(globalHighStarforce.every((query) => query.price_min_meso == null), true);
    assert.equal(priceFloored.every((query) => query.query_id.includes(":price-50000000-any:")), true);
    assert.equal(starforceZero.every((query) => !query.query_id.includes(":price-")), true);
    assert.equal(starforceSeventeenPlus.every((query) => !query.query_id.includes(":price-")), true);
    for (const name of ["가디언 엔젤 링", "골든 클로버 벨트"]) {
      const baselineQuery = baseline.find((query) => query.allowed_names.includes(name));
      assert.ok(baselineQuery, name);
      assert.equal(baselineQuery.starforce_min, null, name);
      assert.equal(baselineQuery.starforce_max, null, name);
      assert.equal(baselineQuery.potential_filter, null, name);
      assert.equal(baselineQuery.price_min_meso, 50_000_000, name);
      assert.equal(baselineQuery.price_max_meso, null, name);
    }
    assert.equal(new Set(grouped.map((query) => query.search_group_id)).size, 18);
    assert.equal(starforceZero.every((query) =>
      query.page_sweep?.enabled === true &&
      query.page_sweep.max_pages === 9 &&
      query.page_sweep.result_cap === 500
    ), true);
    assert.equal(starforceSeventeenPlus.every((query) =>
      query.starforce_min === 17 && query.starforce_max == null && query.page_sweep?.enabled === true
    ), true);
    assert.equal(queries.some((query) => query.starforce_min === 1 && query.starforce_max === 16), false);
    const mitraPotential = potentialFiltered.filter((query) => query.group === "black");
    assert.equal(mitraPotential.length, 5);
    assert.equal(mitraPotential.every((query) => query.potential_filter.minimum === 21), true);
    assert.equal(globalAccessoryPotential.every((query) => query.potential_filter.minimum === 20), true);
    assert.deepEqual(
      mitraPotential.map((query) => query.potential_filter.auction_code).sort(),
      ["magicAttackPercent", ...Array(4).fill("physicalAttackPercent")].sort()
    );
    assert.deepEqual(
      globalAccessoryPotential.map((query) => query.potential_filter.auction_code).sort(),
      ["itemDropPercent", "mesosObtainedPercent"]
    );
    assert.equal(potentialFiltered.filter((query) => query.group !== "global_category_potential").some((query) => [
      "strPercent",
      "dexPercent",
      "intPercent",
      "lukPercent",
      "allStatsPercent"
    ].includes(query.potential_filter.auction_code)), false);
  });

  await test("장비명 없는 23성·24성·25성 이상 검색은 스타포스 가능 139종만 후분류", () => {
    const globalQueries = expandCatalogQueries().filter((query) =>
      query.group === "global_high_starforce"
    );
    assert.deepEqual(globalQueries.map((query) => [query.starforce_min, query.starforce_max]), [
      [23, 23],
      [24, 24],
      [25, null]
    ]);
    assert.deepEqual(globalQueries.map((query) => query.display_name), [
      "전체 장비 · 23성",
      "전체 장비 · 24성",
      "전체 장비 · 25성 이상"
    ]);
    for (const query of globalQueries) {
      assert.equal(query.search_keyword, "");
      assert.equal(query.exact_match, false);
      assert.equal(query.progress_scope, "global");
      assert.equal(query.catalog_id, null);
      assert.equal(query.catalog_ids.length, 139);
      assert.equal(query.allowed_names.length, 139);
      assert.equal(query.page_sweep?.result_cap, 500);
      assert.equal(query.allowed_names.includes("창세의 뱃지"), false);
      assert.equal(query.allowed_names.includes("미트라의 분노 : 전사"), false);
      assert.equal(query.allowed_names.includes("핑크빛 성배"), false);
    }
  });

  await test("장비명 없는 드롭·메획 20% 이상 검색 2회는 전역 결과를 후분류", () => {
    const globalQueries = expandCatalogQueries().filter((query) =>
      query.group === "global_accessory_potential"
    );
    assert.equal(globalQueries.length, 2);
    assert.deepEqual(globalQueries.map((query) => query.display_name), [
      "전체 장신구 · 메소 획득량 증가 20% 이상",
      "전체 장신구 · 아이템 획득 확률 증가 20% 이상"
    ]);
    assert.deepEqual(
      globalQueries.map((query) => [
        query.potential_filter.capability_id,
        query.potential_filter.auction_code,
        query.potential_filter.minimum
      ]),
      [
        ["MESO_OBTAINED_PCT", "mesosObtainedPercent", 20],
        ["ITEM_DROP_RATE_PCT", "itemDropPercent", 20]
      ]
    );
    for (const query of globalQueries) {
      assert.equal(query.search_keyword, "");
      assert.equal(query.exact_match, false);
      assert.equal(query.search_scope, "catalog_global");
      assert.equal(query.progress_scope, "global");
      assert.equal(query.catalog_id, null);
      assert.deepEqual(query.catalog_ids, []);
      assert.deepEqual(query.allowed_names, []);
      assert.deepEqual(query.post_classify_profiles, ["ACCESSORY_DROP_MESO"]);
      assert.equal(query.starforce_min, null);
      assert.equal(query.starforce_max, null);
      assert.equal(query.page_sweep?.result_cap, 500);
    }
  });

  await test("장비명 없는 장신구·방어구 고스탯 잠재 검색은 30개 구간을 분리", () => {
    const globalQueries = expandCatalogQueries().filter((query) =>
      query.group === "global_category_potential"
    );
    assert.equal(GLOBAL_CATEGORY_POTENTIAL_SEARCHES.length, 30);
    assert.equal(globalQueries.length, 30);
    assert.equal(new Set(globalQueries.map((query) => query.query_id)).size, 30);

    const expectedBands = {
      장신구: [[27, 29], [30, 32], [33, null]],
      방어구: [[27, 29], [30, 32], [33, 35], [36, null]]
    };
    const capabilityByStat = {
      STR: ["STR_PCT", "strPercent"],
      DEX: ["DEX_PCT", "dexPercent"],
      INT: ["INT_PCT", "intPercent"],
      LUK: ["LUK_PCT", "lukPercent"]
    };

    for (const [subcategory, bands] of Object.entries(expectedBands)) {
      const categoryQueries = globalQueries.filter((query) =>
        query.equipment_subcategory_filter === subcategory
      );
      assert.equal(categoryQueries.length, bands.length * 4 + 1, subcategory);
      for (const query of categoryQueries) {
        assert.equal(query.search_keyword, "", query.display_name);
        assert.equal(query.exact_match, false, query.display_name);
        assert.equal(query.search_scope, "catalog_global", query.display_name);
        assert.equal(query.progress_scope, "global", query.display_name);
        assert.equal(query.item_category_filter, "ARMOR", query.display_name);
        assert.equal(query.result_category_path_filter, subcategory, query.display_name);
        assert.deepEqual(query.catalog_ids, [], query.display_name);
        assert.deepEqual(query.allowed_names, [], query.display_name);
        assert.equal(query.starforce_min, null, query.display_name);
        assert.equal(query.starforce_max, null, query.display_name);
        assert.equal(query.page_sweep?.result_cap, 500, query.display_name);
        assert.equal(query.query_id.includes(":category-ARMOR"), true, query.display_name);
        assert.equal(query.query_id.includes(`:subcategory-${subcategory}`), true, query.display_name);
      }

      for (const [stat, [capabilityId, auctionCode]] of Object.entries(capabilityByStat)) {
        const statQueries = categoryQueries.filter((query) =>
          query.potential_filter.capability_id === capabilityId
        );
        assert.deepEqual(
          statQueries.map((query) => [
            query.potential_filter.minimum,
            query.potential_filter.maximum
          ]),
          bands,
          `${subcategory} ${stat}`
        );
        assert.equal(statQueries.every((query) =>
          query.potential_filter.auction_code === auctionCode &&
          query.post_classify_profiles.includes("MAIN_STAT")
        ), true, `${subcategory} ${stat}`);
      }

      const allStat = categoryQueries.filter((query) =>
        query.potential_filter.capability_id === "ALL_STAT_PCT"
      );
      assert.equal(allStat.length, 1, subcategory);
      assert.deepEqual(
        [allStat[0].potential_filter.minimum, allStat[0].potential_filter.maximum],
        [21, null],
        subcategory
      );
      assert.equal(allStat[0].potential_filter.auction_code, "allStatsPercent", subcategory);
      assert.deepEqual(allStat[0].post_classify_profiles, ["ALL_STAT"], subcategory);
      assert.equal(allStat[0].display_name, `전체 ${subcategory} · 올스탯% 21% 이상`);
    }

    assert.deepEqual(
      globalQueries.filter((query) => query.display_name.startsWith("전체 장신구 · STR%"))
        .map((query) => query.display_name),
      [
        "전체 장신구 · STR% 27~29%",
        "전체 장신구 · STR% 30~32%",
        "전체 장신구 · STR% 33% 이상"
      ]
    );
    assert.deepEqual(
      globalQueries.filter((query) => query.display_name.startsWith("전체 방어구 · STR%"))
        .map((query) => query.display_name),
      [
        "전체 방어구 · STR% 27~29%",
        "전체 방어구 · STR% 30~32%",
        "전체 방어구 · STR% 33~35%",
        "전체 방어구 · STR% 36% 이상"
      ]
    );
  });

  await test("장신구·방어구 잠재 구간은 카테고리와 올스탯 포함 유효 스탯 합계로 후분류", () => {
    const query = expandCatalogQueries().find((candidate) =>
      candidate.group === "global_category_potential" &&
      candidate.equipment_subcategory_filter === "장신구" &&
      candidate.potential_filter.capability_id === "STR_PCT" &&
      candidate.potential_filter.minimum === 27
    );
    const record = (category, percent) => ({
      item: {
        category_path: Array.isArray(category)
          ? category
          : [category, category === "방어구" ? "장갑" : "반지"]
      },
      profile_classification: { totals: { percent } }
    });

    assert.equal(globalCategoryPotentialExclusion(record("장신구", {
      STR: 27,
      ALL_STAT: 0
    }), query), null);
    assert.equal(globalCategoryPotentialExclusion(record("장신구", {
      STR: 20,
      ALL_STAT: 9
    }), query), null, "올스탯은 선택한 주스탯 구간에 합산함");
    assert.equal(globalCategoryPotentialExclusion(record("장신구", {
      STR: 17,
      ALL_STAT: 9
    }), query), "range");
    assert.equal(globalCategoryPotentialExclusion(record("장신구", {
      STR: 21,
      ALL_STAT: 9
    }), query), "range");
    assert.equal(globalCategoryPotentialExclusion(record("방어구", {
      STR: 28,
      ALL_STAT: 0
    }), query), "category");
    assert.equal(globalCategoryPotentialExclusion(record(["장비", "장신구", "반지"], {
      STR: 28,
      ALL_STAT: 0
    }), query), null, "선행 장비 분류가 있어도 장신구를 판정함");
    assert.equal(globalCategoryPotentialExclusion(record(["장비", "방어구", "장갑"], {
      STR: 28,
      ALL_STAT: 0
    }), query), "category");
    assert.equal(globalCategoryPotentialExclusion(record("장신구", {
      ALL_STAT: 28
    }), query), null, "올스탯만 있는 매물도 선택 스탯 28%로 판정함");

    const armorQuery = expandCatalogQueries().find((candidate) =>
      candidate.group === "global_category_potential" &&
      candidate.equipment_subcategory_filter === "방어구" &&
      candidate.potential_filter.capability_id === "STR_PCT" &&
      candidate.potential_filter.minimum === 27
    );
    assert.equal(globalCategoryPotentialExclusion(record(["어깨장식"], {
      STR: 27,
      ALL_STAT: 0
    }), armorQuery), null, "상위 분류가 없는 어깨장식도 방어구로 판정함");
    assert.equal(globalCategoryPotentialExclusion(record(["어깨장식"], {
      STR: 27,
      ALL_STAT: 0
    }), query), "category", "어깨장식을 장신구로 분류하지 않음");

    const allStatQuery = expandCatalogQueries().find((candidate) =>
      candidate.group === "global_category_potential" &&
      candidate.equipment_subcategory_filter === "장신구" &&
      candidate.potential_filter.capability_id === "ALL_STAT_PCT"
    );
    assert.equal(globalCategoryPotentialExclusion(record("장신구", {
      STR: 36,
      ALL_STAT: 21
    }), allStatQuery), null);
    assert.equal(globalCategoryPotentialExclusion(record("장신구", {
      STR: 36,
      ALL_STAT: 20
    }), allStatQuery), "range");
    assert.equal(globalCategoryPotentialExclusion({}, { group: "baseline" }), null);
    assert.equal(equipmentCategoryFromPath(["장비", "방어구", "장신구", "반지"]), "장신구");
    assert.equal(equipmentCategoryFromPath(["장비", "방어구", "반지"]), "방어구");
    assert.equal(equipmentCategoryFromPath(["반지"]), "장신구");
    assert.equal(equipmentCategoryFromPath(["벨트"]), "장신구");
    assert.equal(equipmentCategoryFromPath(["한벌옷"]), "방어구");
    assert.equal(equipmentCategoryFromPath(["어깨장식"]), "방어구");
    assert.equal(equipmentCategoryFromPath(["포켓 아이템"]), null);
  });

  await test("분류별 잠재 원본은 정확한 구간 선택 경로를 보존", async () => {
    const managerSource = await readFile(path.join(extensionDirectory, "manager.js"), "utf8");
    const contentSource = await readFile(path.join(extensionDirectory, "content.js"), "utf8");
    const enrichStart = managerSource.indexOf("function enrichSelection");
    const enrichEnd = managerSource.indexOf("async function prepareCaptureRecord", enrichStart);
    const enrichSource = managerSource.slice(enrichStart, enrichEnd);
    assert.equal(enrichSource.includes('"global:category-potential"'), true);
    assert.equal(enrichSource.includes("task.query.selection_channels || []"), true);
    assert.equal(managerSource.includes("selection_channels: task.query.selection_channels"), true);
    assert.equal(managerSource.includes("logical_lanes: task.query.logical_lanes"), true);
    const auditStart = managerSource.indexOf("function auditServerFilter");
    const auditEnd = managerSource.indexOf("function updateFilterAudits", auditStart);
    const auditSource = managerSource.slice(auditStart, auditEnd);
    assert.equal(auditSource.includes('["STR", "DEX", "INT", "LUK"].includes(stat)'), true);
    assert.equal(auditSource.includes("value += Number(totals.ALL_STAT || 0)"), true);
    assert.equal(auditSource.includes("value != null && value >= filter.minimum"), true);
    assert.equal(auditSource.includes("value <= filter.maximum"), false, "상한은 서버 필터 audit가 아니라 로컬 후분류로 검증");
    const itemCategoryStart = contentSource.indexOf("function readItemCategorySelection");
    const itemCategoryEnd = contentSource.indexOf("async function setItemCategoryFilter", itemCategoryStart);
    const itemCategorySource = contentSource.slice(itemCategoryStart, itemCategoryEnd);
    assert.equal(itemCategorySource.includes('findTopLevelCategoryButton(panel, "방어구")'), true);
    assert.equal(itemCategorySource.includes('findTopLevelCategoryButton(panel, "장신구")'), true);
  });

  await test("경매장 드롭·메획 잠재 필터는 실제 드롭다운 라벨을 사용", async () => {
    const contentSource = await readFile(path.join(extensionDirectory, "content.js"), "utf8");
    const mapStart = contentSource.indexOf("const AUCTION_POTENTIAL_LABEL_BY_CODE = new Map([");
    const mapEnd = contentSource.indexOf("]);", mapStart);
    assert.equal(mapStart >= 0 && mapEnd > mapStart, true);
    const mapSource = contentSource.slice(mapStart, mapEnd);
    const labels = new Map(
      Array.from(mapSource.matchAll(/\["([^"]+)",\s*"([^"]+)"\]/gu), (match) => [match[1], match[2]])
    );
    assert.equal(labels.get("itemDropPercent"), "아이템 획득 확률 증가");
    assert.equal(labels.get("mesosObtainedPercent"), "메소 획득량 증가");
    assert.notEqual(labels.get("itemDropPercent"), "아이템 획득 확률");
    assert.notEqual(labels.get("mesosObtainedPercent"), "메소 획득량");
  });

  await test("직업군·접두사 그룹은 각각 기본·0성·17성+ 3회로 후분류", () => {
    const queries = expandCatalogQueries();
    const expected = {
      eternal: { groups: 5, members: 7 },
      arcane: { groups: 5, members: 6 },
      absolab: { groups: 5, members: 6 },
      cra: { groups: 3, members: 5 }
    };

    for (const [group, config] of Object.entries(expected)) {
      const groupQueries = queries.filter((query) => query.group === group && query.search_group_id);
      const searchGroupIds = [...new Set(groupQueries.map((query) => query.search_group_id))];
      assert.equal(searchGroupIds.length, config.groups, group);
      assert.equal(groupQueries.length, config.groups * 3, group);
      for (const searchGroupId of searchGroupIds) {
        const physical = groupQueries.filter((query) => query.search_group_id === searchGroupId);
        assert.equal(physical.length, 3, searchGroupId);
        assert.equal(physical.every((query) => query.exact_match === false), true, searchGroupId);
        assert.equal(physical.every((query) => query.catalog_id === null), true, searchGroupId);
        assert.equal(physical.every((query) => query.catalog_ids.length === config.members), true, searchGroupId);
        assert.equal(physical.every((query) => query.allowed_names.length === config.members), true, searchGroupId);
        assert.deepEqual(
          physical.map((query) => [query.starforce_min, query.starforce_max]),
          [[null, null], [0, 0], [17, null]],
          searchGroupId
        );
      }
    }
  });

  await test("마이스터 3종은 각각 정확 일치로 기본·0성·17성 이상을 검색", () => {
    const queries = expandCatalogQueries();
    const names = [
      "마이스터링",
      "마이스터 이어링",
      "마이스터 숄더",
    ];
    for (const name of names) {
      const item = getCatalogItem(name);
      const meister = queries.filter((query) =>
        query.progress_scope !== "global" && query.catalog_ids.includes(item.id)
      );
      assert.equal(meister.length, 3, name);
      assert.equal(meister.every((query) => query.search_group_id == null), true, name);
      assert.equal(meister.every((query) => query.search_keyword === name), true, name);
      assert.equal(meister.every((query) => query.exact_match === true), true, name);
      assert.equal(meister.every((query) => query.catalog_id === item.id), true, name);
      assert.equal(meister.every((query) =>
        query.catalog_ids.length === 1 && query.catalog_ids[0] === item.id
      ), true, name);
      assert.equal(meister.every((query) =>
        query.allowed_names.length === 1 && query.allowed_names[0] === name
      ), true, name);
      assert.deepEqual(meister.map((query) => [query.starforce_min, query.starforce_max]), [
        [null, null],
        [0, 0],
        [17, null]
      ], name);
      const baseline = meister.find((query) => query.logical_lanes.includes("BASE_ANY"));
      assert.ok(baseline, name);
      const accessoryEligible = name !== "마이스터 숄더";
      assert.equal(baseline.logical_lanes.includes("POT_ACCESSORY_DROP_MESO"), accessoryEligible, name);
      assert.equal(baseline.post_classify_profiles.includes("ACCESSORY_DROP_MESO"), accessoryEligible, name);
    }
    assert.equal(queries.length, 185);
  });

  await test("창세의 뱃지는 최근 시세 1회, 저가 보스장비 4종은 1성+ 1회만 검색", () => {
    const queries = expandCatalogQueries();
    const genesis = queries.filter((query) => query.allowed_names.includes("창세의 뱃지"));
    assert.equal(genesis.length, 1);
    assert.equal(genesis[0].exact_match, true);
    assert.deepEqual([genesis[0].starforce_min, genesis[0].starforce_max], [null, null]);
    assert.equal(genesis[0].page_sweep, null);
    assert.equal(genesis[0].price_min_meso, null);
    assert.deepEqual(genesis[0].logical_lanes, ["BASE_ANY"]);

    for (const name of [
      "데아 시두스 이어링",
      "고귀한 이피아의 반지",
      "카오스 혼테일의 목걸이",
      "매커네이터 펜던트"
    ]) {
      const physical = queries.filter((query) =>
        query.search_scope !== "catalog_global" && query.allowed_names.includes(name)
      );
      assert.equal(physical.length, 1, name);
      assert.equal(physical[0].exact_match, true, name);
      assert.deepEqual([physical[0].starforce_min, physical[0].starforce_max], [1, null], name);
      assert.equal(physical[0].price_min_meso, null, name);
      assert.equal(physical[0].logical_lanes.includes("SF_1_PLUS"), true, name);
    }
  });

  await test("전 페이지 검색은 첫 페이지만 저장해서 완료되지 않음", () => {
    const sweepQuery = expandCatalogQueries().find((query) =>
      query.logical_lanes.includes("BASE_ANY")
    );
    assert.ok(sweepQuery);
    assert.equal(isPhysicalQueryComplete(sweepQuery, {
      first_page_captured: true,
      observations: 60,
      page_sweep_pages: 1
    }), false);
    assert.equal(isPhysicalQueryComplete(sweepQuery, {
      first_page_captured: true,
      observations: 480,
      page_sweep_pages: 8,
      page_sweep_complete: true
    }), true);
    const zeroStarQuery = expandCatalogQueries().find((query) =>
      query.logical_lanes.includes("SF_0")
    );
    assert.ok(zeroStarQuery);
    assert.equal(isPhysicalQueryComplete(zeroStarQuery, {
      first_page_captured: true,
      observations: 60
    }), false);
    assert.equal(isPhysicalQueryComplete({ page_sweep: null }, {
      first_page_captured: true,
      observations: 12
    }), true);
  });

  await test("HP와 올스탯 필터 능력·환산은 분리", () => {
    assert.equal(POTENTIAL_FILTER_CAPABILITIES.HP_PCT.server_queryable, false);
    assert.equal(POTENTIAL_FILTER_CAPABILITIES.HP_PCT.auction_code, null);
    assert.equal(POTENTIAL_FILTER_CAPABILITIES.HP_PCT.evidence_status, "local_only");
    assert.equal(POTENTIAL_FILTER_CAPABILITIES.ALL_STAT_PCT.server_queryable, true);
    assert.equal(POTENTIAL_FILTER_CAPABILITIES.ALL_STAT_PCT.auction_code, "allStatsPercent");

    const item = getCatalogItem("근원의 속삭임");
    const onlyAllStat = classifyPotentialProfiles(item, [potentialLine("ALL_STAT", 24)]);
    assert.equal(onlyAllStat.profiles.ALL_STAT.matched, true);
    assert.equal(onlyAllStat.profiles.ALL_STAT.grade, "three_line");
    assert.equal(onlyAllStat.profiles.MAX_HP.matched, false);
    assert.equal(onlyAllStat.profiles.MAX_HP.all_stat_is_not_hp, true);
    const hpTwoLine = classifyPotentialProfile("MAX_HP", item, [potentialLine("HP", 23)]);
    const hpThreeLine = classifyPotentialProfile("MAX_HP", item, [potentialLine("HP", 33)]);
    assert.equal(hpTwoLine.grade, "two_line");
    assert.equal(hpTwoLine.matched, true);
    assert.equal(hpThreeLine.grade, "three_line");
    assert.equal(hpThreeLine.matched, true);

    const level200Item = getCatalogItem("몽환의 벨트");
    assert.equal(classifyPotentialProfile("MAX_HP", level200Item, [potentialLine("HP", 21)]).grade, "two_line");
    assert.equal(classifyPotentialProfile("MAX_HP", level200Item, [potentialLine("HP", 30)]).grade, "three_line");
    assert.equal(classifyPotentialProfile("ALL_STAT", level200Item, [potentialLine("ALL_STAT", 15)]).grade, "two_line");
    assert.equal(classifyPotentialProfile("ALL_STAT", level200Item, [potentialLine("ALL_STAT", 21)]).grade, "three_line");
  });

  await test("주스탯 검색 의미는 올스탯을 한 번만 합산", () => {
    const result = classifyPotentialProfile("MAIN_STAT", "에테르넬 나이트아머", [
      potentialLine("STR", 13),
      potentialLine("ALL_STAT", 10)
    ]);
    assert.deepEqual(result, [{
      stat: "STR",
      direct_pct: 13,
      all_stat_pct: 10,
      effective_pct: 23,
      grade: "two_line",
      matched: true
    }]);
  });

  await test("미트라 정옵 통과·탈락 규칙", () => {
    const warrior = "미트라의 분노 : 전사";
    const attack30 = classifyPotentialProfile("MITRA_OPTIMAL", warrior, [
      potentialLine("ATTACK", 12),
      potentialLine("ATTACK", 9),
      potentialLine("ATTACK", 9)
    ]);
    assert.equal(attack30.matched, true);
    assert.equal(attack30.matched_rule, "ATTACK_30");

    const attack21Ied30 = classifyPotentialProfile("MITRA_OPTIMAL", warrior, [
      potentialLine("ATTACK", 12),
      potentialLine("ATTACK", 9),
      potentialLine("IGNORE_DEFENSE", 30)
    ]);
    assert.equal(attack21Ied30.matched, true);
    assert.equal(attack21Ied30.matched_rule, "ATTACK_21_AND_IGNORE_DEFENSE_30");

    const pointedAttack = classifyPotentialProfile("MITRA_OPTIMAL", warrior, [
      potentialLine("ATTACK", 9),
      potentialLine("ATTACK", 9),
      potentialLine("IGNORE_DEFENSE", 35)
    ]);
    assert.equal(pointedAttack.matched, false);
    assert.equal(pointedAttack.known_non_optimal_18_and_35, true);

    const mageWrongStat = classifyPotentialProfile("MITRA_OPTIMAL", "미트라의 분노 : 마법사", [
      potentialLine("ATTACK", 30)
    ]);
    const mageMagic = classifyPotentialProfile("MITRA_OPTIMAL", "미트라의 분노 : 마법사", [
      potentialLine("MAGIC_ATTACK", 30)
    ]);
    assert.equal(mageWrongStat.matched, false);
    assert.equal(mageMagic.matched, true);
    assert.equal(mageMagic.attack_code, "MAGIC_ATTACK");
  });

  await test("제논 STR·DEX·LUK·올스탯 값을 합치지 않고 보존", () => {
    const xenon = classifyPotentialProfile("XENON_MIXED", "마이스터링", [
      potentialLine("STR", 12),
      potentialLine("DEX", 9),
      potentialLine("LUK", 6),
      potentialLine("ALL_STAT", 9)
    ]);
    assert.deepEqual(xenon.preserved_pct, { STR: 12, DEX: 9, LUK: 6, ALL_STAT: 9 });
    assert.deepEqual(xenon.effective_pct_by_stat, { STR: 21, DEX: 18, LUK: 15 });
    assert.equal(xenon.collapsed_search_value, null);
    assert.equal(xenon.requires_character_equivalence_model, true);
  });

  await test("MP 잠재는 시장 프로필에서 무시", () => {
    const summary = summarizePotentialLines([
      potentialLine("MP", 12),
      { code: "UNKNOWN", value: 9, unit: "pct", raw: "최대 MP +9%" },
      potentialLine("INT", 12)
    ]);
    assert.equal(Object.prototype.hasOwnProperty.call(summary.percent, "MP"), false);
    assert.equal(summary.ignored_line_count, 2);
    assert.equal(summary.percent.INT, 12);
  });

  await test("스타포스 9개 고정 구간과 null/0·23/24/25+ 구분", () => {
    assert.deepEqual(STARFORCE_BANDS, [
      { id: "SF_ANY", min: null, max: null },
      { id: "SF_0", min: 0, max: 0 },
      { id: "SF_1_16", min: 1, max: 16 },
      { id: "SF_17_18", min: 17, max: 18 },
      { id: "SF_19_21", min: 19, max: 21 },
      { id: "SF_22", min: 22, max: 22 },
      { id: "SF_23", min: 23, max: 23 },
      { id: "SF_24", min: 24, max: 24 },
      { id: "SF_25_PLUS", min: 25, max: null }
    ]);
    assert.equal(starforceBandForValue(0), "SF_0");
    assert.equal(starforceBandForValue(15), "SF_1_16");
    assert.equal(starforceBandForValue(17), "SF_17_18");
    assert.equal(starforceBandForValue(22), "SF_22");
    assert.equal(starforceBandForValue(23), "SF_23");
    assert.equal(starforceBandForValue(24), "SF_24");
    assert.equal(starforceBandForValue(25), "SF_25_PLUS");
    assert.equal(starforceBandForValue(null), null);
  });

  await test("수집 lane 계획은 지정 수량 합계 98", () => {
    assert.deepEqual(LANE_PLAN, {
      baseline: 33,
      starforce: 28,
      main: 28,
      allstat: 2,
      hp: 0,
      hat: 0,
      glove: 0,
      accessory: 2,
      mitra: 5,
      audit: 0
    });
    assert.equal(lanePlanTotal(), 98);
    assert.equal(NORMAL_QUERY_LIMIT, 98);
    assert.equal(RESERVE_QUERY_LIMIT, 2);
    assert.equal(HARD_QUERY_LIMIT, 100);
  });

  await test("KST 날짜 경계·날짜 더하기·일일 rollover", () => {
    assert.equal(toKstDateKey("2026-09-01T14:59:59.999Z"), "2026-09-01");
    assert.equal(toKstDateKey("2026-09-01T15:00:00.000Z"), "2026-09-02");
    assert.equal(addKstDays("2026-02-27", 2), "2026-03-01");
    let state = createCollectorState("2026-09-01T00:00:00.000Z");
    state = reserveQueryQuota(state, {
      attempt_id: "kst-rollover",
      lane: "baseline",
      now: "2026-09-01T00:00:00.000Z"
    }).state;
    const rolled = rolloverCollectorState(state, "2026-09-01T15:00:00.000Z");
    assert.equal(rolled.day_key, "2026-09-02");
    assert.deepEqual(quotaRemaining(rolled), { normal: 98, reserve: 2, hard: 100 });
    assert.ok(rolled.attempts["kst-rollover"]);
  });

  await test("새 필터 검색은 직전 제출 뒤 최소 10초 간격을 유지", () => {
    const dispatchedAt = 1_000_000;
    assert.equal(FILTER_SEARCH_MIN_INTERVAL_MS, 10_000);
    assert.equal(filterSearchDelayRemaining(null, dispatchedAt), 0);
    assert.equal(filterSearchDelayRemaining(dispatchedAt, dispatchedAt), 10_000);
    assert.equal(filterSearchDelayRemaining(dispatchedAt, dispatchedAt + 9_999), 1);
    assert.equal(filterSearchDelayRemaining(dispatchedAt, dispatchedAt + 10_000), 0);

    const state = {
      ...createCollectorState("2026-09-01T00:00:00.000Z"),
      last_filter_search_dispatch_at: dispatchedAt,
      filter_search_dispatch_pending_at: dispatchedAt + 1
    };
    const rolled = rolloverCollectorState(state, "2026-09-01T15:00:00.000Z");
    const reset = resetCollectorProgress(rolled, "2026-09-01T15:00:01.000Z");
    assert.equal(rolled.last_filter_search_dispatch_at, dispatchedAt);
    assert.equal(rolled.filter_search_dispatch_pending_at, dispatchedAt + 1);
    assert.equal(reset.last_filter_search_dispatch_at, dispatchedAt);
    assert.equal(reset.filter_search_dispatch_pending_at, dispatchedAt + 1);
  });

  await test("일반 98회와 예비 2회 예약·101회 차단", () => {
    const now = "2026-09-01T00:00:00.000Z";
    let state = createCollectorState(now);
    for (const [lane, count] of Object.entries(LANE_PLAN)) {
      for (let index = 0; index < count; index += 1) {
        const reservation = reserveQueryQuota(state, {
          attempt_id: `normal:${lane}:${index}`,
          lane,
          pool: "normal",
          now
        });
        assert.equal(reservation.ok, true, `${lane}:${index}`);
        state = reservation.state;
      }
    }
    assert.equal(state.quota.normal_reserved, 98);
    assert.equal(state.quota.total_reserved, 98);
    assert.equal(reserveQueryQuota(state, {
      attempt_id: "normal:overflow",
      lane: "audit",
      pool: "normal",
      now
    }).ok, false);

    for (let index = 0; index < 2; index += 1) {
      const reservation = reserveQueryQuota(state, {
        attempt_id: `reserve:${index}`,
        lane: "audit",
        pool: "reserve",
        now
      });
      assert.equal(reservation.ok, true, `reserve:${index}`);
      state = reservation.state;
    }
    assert.equal(state.quota.reserve_reserved, 2);
    assert.equal(state.quota.total_reserved, 100);
    const overflow = reserveQueryQuota(state, {
      attempt_id: "reserve:overflow",
      lane: "audit",
      pool: "reserve",
      now
    });
    assert.equal(overflow.ok, false);
    assert.equal(overflow.reason, "hard_limit_reached");
    assert.deepEqual(quotaRemaining(state), { normal: 0, reserve: 0, hard: 0 });
  });

  await test("사이트 검색 횟수 동기화는 조기 복구 사용을 이중 계산하지 않음", () => {
    const earlyReserve = reserveQueryQuota(createCollectorState("2026-09-01T00:00:00.000Z"), {
      attempt_id: "early-retry",
      lane: "baseline",
      pool: "reserve",
      now: "2026-09-01T00:00:00.000Z"
    });
    assert.equal(earlyReserve.ok, true);
    assert.equal(earlyReserve.state.quota.normal_reserved, 0);
    assert.equal(earlyReserve.state.quota.reserve_reserved, 1);
    const current = {
      normal_limit: 98,
      reserve_limit: 2,
      hard_limit: 100,
      normal_reserved: 5,
      reserve_reserved: 1,
      reserve_recovery_reserved: 0,
      reserve_borrowed_for_normal: 0,
      total_reserved: 6
    };
    assert.deepEqual(reconcileObservedQuota(current, 6), current);
    assert.deepEqual(reconcileObservedQuota(current, 7), {
      ...current,
      normal_reserved: 6,
      total_reserved: 7
    });
    assert.deepEqual(reconcileObservedQuota(current, 100), {
      ...current,
      normal_reserved: 98,
      reserve_reserved: 2,
      total_reserved: 100
    });
    assert.deepEqual(reconcileObservedQuota(current, 4), current);
  });

  await test("복구 사용이 0회일 때만 예비 2회를 일반 검색으로 전환", () => {
    const now = "2026-09-01T00:00:00.000Z";
    let state = createCollectorState(now);
    for (const [lane, count] of Object.entries(LANE_PLAN)) {
      for (let index = 0; index < count; index += 1) {
        state = reserveQueryQuota(state, {
          attempt_id: `overflow-base:${lane}:${index}`,
          lane,
          pool: "normal",
          quota_purpose: "normal",
          now
        }).state;
      }
    }
    assert.equal(canBorrowReserveForNormal(state), true);

    const first = reserveQueryQuota(state, {
      attempt_id: "normal-overflow:1",
      lane: "baseline",
      pool: "reserve",
      quota_purpose: "normal_overflow",
      now
    });
    assert.equal(first.ok, true);
    assert.equal(first.reservation.pool, "reserve");
    assert.equal(first.reservation.quota_purpose, "normal_overflow");
    assert.equal(first.reservation.quota_session_id, state.quota_session.id);
    assert.equal(first.state.quota.reserve_reserved, 1);
    assert.equal(first.state.quota.reserve_recovery_reserved, 0);
    assert.equal(first.state.quota.reserve_borrowed_for_normal, 1);
    assert.equal(first.state.quota.total_reserved, 99);
    assert.equal(canBorrowReserveForNormal(first.state), true);

    const second = reserveQueryQuota(first.state, {
      attempt_id: "normal-overflow:2",
      lane: "starforce",
      pool: "reserve",
      quota_purpose: "normal_overflow",
      now
    });
    assert.equal(second.ok, true);
    assert.equal(second.state.quota.reserve_reserved, 2);
    assert.equal(second.state.quota.reserve_recovery_reserved, 0);
    assert.equal(second.state.quota.reserve_borrowed_for_normal, 2);
    assert.equal(second.state.quota.total_reserved, 100);
    assert.equal(canBorrowReserveForNormal(second.state), false);
    const overflow = reserveQueryQuota(second.state, {
      attempt_id: "normal-overflow:3",
      lane: "main",
      pool: "reserve",
      quota_purpose: "normal_overflow",
      now
    });
    assert.equal(overflow.ok, false);
    assert.equal(overflow.reason, "hard_limit_reached");
  });

  await test("복구 1회를 사용했거나 복구가 대기 중이면 남은 예비를 일반 검색으로 전환하지 않음", () => {
    const now = "2026-09-01T00:00:00.000Z";
    let state = createCollectorState(now);
    state = {
      ...state,
      quota: {
        ...state.quota,
        normal_reserved: 98,
        total_reserved: 98
      }
    };
    const recovery = reserveQueryQuota(state, {
      attempt_id: "recovery-used",
      lane: "baseline",
      pool: "reserve",
      quota_purpose: "recovery",
      now
    });
    assert.equal(recovery.ok, true);
    assert.equal(recovery.state.quota.reserve_recovery_reserved, 1);
    assert.equal(recovery.state.quota.reserve_borrowed_for_normal, 0);
    let recoveryUsedState = advanceAttemptPhase(recovery.state, "recovery-used", "requested", now);
    recoveryUsedState = advanceAttemptPhase(recoveryUsedState, "recovery-used", "received", now);
    recoveryUsedState = advanceAttemptPhase(recoveryUsedState, "recovery-used", "committed", now);
    assert.equal(canBorrowReserveForNormal(recoveryUsedState), false);
    const blockedAfterRecovery = reserveQueryQuota(recoveryUsedState, {
      attempt_id: "blocked-after-recovery",
      lane: "baseline",
      pool: "reserve",
      quota_purpose: "normal_overflow",
      now
    });
    assert.equal(blockedAfterRecovery.ok, false);
    assert.equal(blockedAfterRecovery.reason, "normal_overflow_not_allowed");

    const pending = {
      ...state,
      retries: [{ id: "pending-retry", retry: true }]
    };
    assert.equal(canBorrowReserveForNormal(pending), false);
    assert.equal(reserveQueryQuota(pending, {
      attempt_id: "blocked-by-pending",
      lane: "baseline",
      pool: "reserve",
      quota_purpose: "normal_overflow",
      now
    }).reason, "normal_overflow_not_allowed");
  });

  await test("요청 전 일반 전환 예약만 한도와 전환 횟수에서 안전하게 반환", () => {
    const now = "2026-09-01T00:00:00.000Z";
    let state = createCollectorState(now);
    state = {
      ...state,
      quota: { ...state.quota, normal_reserved: 98, total_reserved: 98 }
    };
    state = reserveQueryQuota(state, {
      attempt_id: "overflow-release",
      lane: "baseline",
      pool: "reserve",
      quota_purpose: "normal_overflow",
      now
    }).state;
    const released = releaseUnrequestedReservation(state, "overflow-release", now);
    assert.equal(released.quota.normal_reserved, 98);
    assert.equal(released.quota.reserve_reserved, 0);
    assert.equal(released.quota.reserve_borrowed_for_normal, 0);
    assert.equal(released.quota.total_reserved, 98);
    assert.equal(released.lane_usage.reserve.baseline, 0);
    assert.equal(canBorrowReserveForNormal(released), true);

    const requested = advanceAttemptPhase(state, "overflow-release", "requested", now);
    assert.throws(
      () => releaseUnrequestedReservation(requested, "overflow-release", now),
      /요청이 시작된 예약/u
    );
  });

  await test("구버전 reserve 사용은 복구로 간주하고 관측 동기화가 일반 전환으로 바꾸지 않음", () => {
    const now = "2026-09-01T00:00:00.000Z";
    const legacy = createCollectorState(now);
    legacy.quota = {
      normal_limit: 98,
      reserve_limit: 2,
      hard_limit: 100,
      normal_reserved: 98,
      reserve_reserved: 1,
      total_reserved: 99
    };
    const normalized = rolloverCollectorState(legacy, now);
    assert.equal(normalized.quota.reserve_borrowed_for_normal, 0);
    assert.equal(canBorrowReserveForNormal(normalized), false);
    assert.equal(reserveQueryQuota(normalized, {
      attempt_id: "legacy-overflow-blocked",
      lane: "baseline",
      pool: "reserve",
      quota_purpose: "normal_overflow",
      now
    }).reason, "normal_overflow_not_allowed");

    const reconciled = reconcileObservedQuota({
      ...normalized.quota,
      reserve_borrowed_for_normal: 1
    }, 100);
    assert.equal(reconciled.reserve_reserved, 2);
    assert.equal(reconciled.reserve_borrowed_for_normal, 1);
    assert.equal(canBorrowReserveForNormal({ ...normalized, quota: reconciled }), false);
  });

  await test("계정 검색 횟수 감소는 확인 후 새 quota session으로 재기준화", () => {
    const now = "2026-09-01T00:00:00.000Z";
    let state = createCollectorState(now);
    const observed = rebaseQuotaSession(state, 98, { now });
    assert.equal(observed.ok, true);
    assert.equal(observed.rebased, false);
    assert.equal(observed.state.quota.normal_reserved, 98);
    assert.equal(observed.state.quota_session.last_site_used, 98);

    const unconfirmed = rebaseQuotaSession(observed.state, 0, {
      now: "2026-09-01T00:01:00.000Z"
    });
    assert.equal(unconfirmed.ok, false);
    assert.equal(unconfirmed.reason, "quota_session_rebase_confirmation_required");
    assert.equal(unconfirmed.state.quota.normal_reserved, 98);

    const rebased = rebaseQuotaSession(observed.state, 0, {
      now: "2026-09-01T00:01:00.000Z",
      confirmed: true,
      session_id: "account-session-2",
      switch_reason: "account_switch"
    });
    assert.equal(rebased.ok, true);
    assert.equal(rebased.rebased, true);
    assert.equal(rebased.quota_session.id, "account-session-2");
    assert.equal(rebased.quota_session.ordinal, 2);
    assert.equal(rebased.quota_session.baseline_site_used, 0);
    assert.equal(rebased.quota_session.last_site_used, 0);
    assert.equal(rebased.quota_session.switch_reason, "account_switch");
    assert.equal(rebased.state.quota.normal_reserved, 0);
    assert.equal(rebased.state.quota.reserve_reserved, 0);
    assert.equal(rebased.state.quota.reserve_recovery_reserved, 0);
    assert.equal(rebased.state.quota.reserve_borrowed_for_normal, 0);
    assert.deepEqual(rebased.state.lane_usage.normal, createLaneUsage());
    assert.equal(rebased.state.site_search_usage.used, 0);
  });

  await test("새 계정 기준값 99회는 복구나 일반 전환으로 잘못 분류하지 않음", () => {
    const now = "2026-09-01T00:00:00.000Z";
    const rebased = rebaseQuotaSession(createCollectorState(now), 99, {
      now,
      force: true,
      confirmed: true,
      session_id: "account-session-baseline-99",
      switch_reason: "manual_account_switch"
    });
    assert.equal(rebased.ok, true);
    assert.equal(rebased.rebased, true);
    assert.equal(rebased.state.quota.normal_reserved, 98);
    assert.equal(rebased.state.quota.reserve_reserved, 1);
    assert.equal(rebased.state.quota.reserve_recovery_reserved, 0);
    assert.equal(rebased.state.quota.reserve_borrowed_for_normal, 0);
    assert.equal(rebased.state.quota.total_reserved, 99);
    assert.equal(rebased.state.quota_session.baseline_site_used, 99);
    assert.equal(rebased.state.quota_session.last_site_used, 99);
    assert.equal(canBorrowReserveForNormal(rebased.state), false);
  });

  await test("새 계정의 기존 사용량만 차감하고 수집 진도와 복구 큐는 유지", () => {
    const now = "2026-09-01T00:00:00.000Z";
    let state = rebaseQuotaSession(createCollectorState(now), 98, { now }).state;
    state = {
      ...state,
      query_stats: {
        "task-complete": {
          first_page_captured: true,
          observations: 60,
          next_eligible_date: "2026-09-05"
        }
      },
      retries: [{ id: "retry-next-account", retry: true }],
      totals: { pages: 98, observations: 4_200, failures: 3 },
      lane_usage: {
        normal: createLaneUsage(4),
        reserve: createLaneUsage(1)
      }
    };
    const rebased = rebaseQuotaSession(state, 17, {
      now: "2026-09-01T00:01:00.000Z",
      confirmed: true,
      session_id: "account-session-with-17-used"
    }).state;
    assert.equal(rebased.quota.normal_reserved, 17);
    assert.equal(rebased.quota.reserve_reserved, 0);
    assert.equal(rebased.quota.total_reserved, 17);
    assert.deepEqual(rebased.lane_usage.normal, createLaneUsage());
    assert.equal(rebased.query_stats["task-complete"].first_page_captured, true);
    assert.equal(rebased.query_stats["task-complete"].next_eligible_date, "2026-09-05");
    assert.equal(rebased.retries[0].id, "retry-next-account");
    assert.deepEqual(rebased.totals, { pages: 98, observations: 4_200, failures: 3 });
  });

  await test("quota session 재기준화는 진행 중 시도를 거부하고 이전 session 예약이 새 한도를 줄이지 않음", () => {
    const now = "2026-09-01T00:00:00.000Z";
    let state = createCollectorState(now);
    state = rebaseQuotaSession(state, 10, { now }).state;
    state = reserveQueryQuota(state, {
      attempt_id: "active-before-switch",
      lane: "baseline",
      pool: "normal",
      quota_purpose: "normal",
      now
    }).state;
    const refused = rebaseQuotaSession(state, 0, {
      now: "2026-09-01T00:01:00.000Z",
      confirmed: true
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, "active_attempt_present");

    state = advanceAttemptPhase(state, "active-before-switch", "requested", now);
    state = advanceAttemptPhase(state, "active-before-switch", "received", now);
    state = advanceAttemptPhase(state, "active-before-switch", "committed", now);
    const rebased = rebaseQuotaSession(state, 0, {
      now: "2026-09-01T00:01:00.000Z",
      confirmed: true,
      session_id: "new-session"
    }).state;
    const staleAttempt = {
      attempt_id: "stale-reserved",
      lane: "baseline",
      pool: "normal",
      quota_purpose: "normal",
      quota_session_id: state.quota_session.id,
      day_key: state.day_key,
      phase: "reserved"
    };
    const withStaleAttempt = {
      ...rebased,
      quota: { ...rebased.quota, normal_reserved: 7, total_reserved: 7 },
      attempts: { ...rebased.attempts, [staleAttempt.attempt_id]: staleAttempt }
    };
    const released = releaseUnrequestedReservation(withStaleAttempt, staleAttempt.attempt_id, now);
    assert.equal(released.quota.normal_reserved, 7);
    assert.equal(released.quota.total_reserved, 7);
    assert.equal(released.attempts[staleAttempt.attempt_id], undefined);
  });

  await test("lane 계획 소진 후보는 normal overflow가 허용된 경우에만 선택", () => {
    const now = "2026-09-01T00:00:00.000Z";
    const exhaustedUsage = { ...LANE_PLAN };
    const candidates = [{ id: "overflow-candidate", lane: "baseline", priority: "P1" }];
    assert.equal(selectNextCandidate(candidates, {
      now,
      lane_usage: exhaustedUsage
    }), null);
    assert.equal(selectNextCandidate(candidates, {
      now,
      lane_usage: exhaustedUsage,
      allow_normal_overflow: true
    }).id, "overflow-candidate");
  });

  await test("normal 재배분 전에는 남은 lane 계획 후보를 우선 선택", () => {
    const usage = createLaneUsage();
    usage.baseline = LANE_PLAN.baseline;
    usage.starforce = LANE_PLAN.starforce - 1;
    const selected = selectNextCandidate([
      { id: "exhausted-p1", lane: "baseline", priority: "P1" },
      { id: "planned-p2", lane: "starforce", priority: "P2" }
    ], {
      now: "2026-09-01T00:00:00.000Z",
      lane_usage: usage,
      allow_normal_rebalance: true
    });
    assert.equal(selected.id, "planned-p2");
  });

  await test("lane 계획 후보가 없으면 남은 normal 한도를 소진 lane에 재배분", () => {
    const now = "2026-09-01T00:00:00.000Z";
    const usage = createLaneUsage();
    usage.baseline = LANE_PLAN.baseline;
    const candidates = [{ id: "rebalanced", lane: "baseline", priority: "P1" }];
    assert.equal(selectNextCandidate(candidates, { now, lane_usage: usage }), null);
    assert.equal(selectNextCandidate(candidates, {
      now,
      lane_usage: usage,
      allow_normal_rebalance: true
    }).id, "rebalanced");

    const initial = createCollectorState(now);
    const state = {
      ...initial,
      quota: {
        ...initial.quota,
        normal_reserved: LANE_PLAN.baseline,
        total_reserved: LANE_PLAN.baseline
      },
      lane_usage: {
        ...initial.lane_usage,
        normal: usage
      }
    };
    assert.equal(reserveQueryQuota(state, {
      attempt_id: "rebalance-denied",
      lane: "baseline",
      pool: "normal",
      quota_purpose: "normal",
      now
    }).reason, "lane_plan_exhausted");
    const rebalanced = reserveQueryQuota(state, {
      attempt_id: "rebalance-allowed",
      lane: "baseline",
      pool: "normal",
      quota_purpose: "normal",
      allow_normal_rebalance: true,
      now
    });
    assert.equal(rebalanced.ok, true);
    assert.equal(rebalanced.reservation.pool, "normal");
    assert.equal(rebalanced.reservation.quota_purpose, "normal");
    assert.equal(rebalanced.state.quota.normal_reserved, LANE_PLAN.baseline + 1);
    assert.equal(rebalanced.state.lane_usage.normal.baseline, LANE_PLAN.baseline + 1);
  });

  await test("normal 재배분도 backoff·blocked·completed 후보를 선택하지 않음", () => {
    const now = "2026-09-01T00:00:00.000Z";
    const usage = { ...LANE_PLAN };
    const excluded = [
      { id: "backoff-date", lane: "baseline", next_eligible_date: "2026-09-02" },
      { id: "backoff-time", lane: "baseline", next_eligible_at: "2026-09-02T00:00:00.000Z" },
      { id: "blocked", lane: "baseline", blocked: true },
      { id: "completed", lane: "baseline", completed: true },
      { id: "ineligible", lane: "baseline", eligible: false }
    ];
    const selected = selectNextCandidate([
      ...excluded,
      { id: "ready", lane: "baseline", priority: "P2" }
    ], { now, lane_usage: usage, allow_normal_rebalance: true });
    assert.equal(selected.id, "ready");
    assert.equal(selectNextCandidate(excluded, {
      now,
      lane_usage: usage,
      allow_normal_rebalance: true
    }), null);
  });

  await test("normal 재배분 중에도 retry가 계획 후보보다 우선", () => {
    const usage = createLaneUsage();
    usage.baseline = LANE_PLAN.baseline;
    const selected = selectNextCandidate([
      { id: "planned-p1", lane: "starforce", priority: "P1" },
      { id: "retry-p2", retry: true, lane: "baseline", priority: "P2" }
    ], {
      now: "2026-09-01T00:00:00.000Z",
      lane_usage: usage,
      allow_normal_rebalance: true
    });
    assert.equal(selected.id, "retry-p2");
  });

  await test("normal 98회 소진 뒤에는 재배분 없이 reserve overflow 규칙 적용", () => {
    const now = "2026-09-01T00:00:00.000Z";
    const initial = createCollectorState(now);
    const fullNormal = {
      ...initial,
      quota: {
        ...initial.quota,
        normal_reserved: NORMAL_QUERY_LIMIT,
        total_reserved: NORMAL_QUERY_LIMIT
      },
      lane_usage: {
        ...initial.lane_usage,
        normal: { ...LANE_PLAN }
      }
    };
    const candidates = [{ id: "after-normal", lane: "baseline", priority: "P1" }];
    assert.equal(selectNextCandidate(candidates, {
      now,
      lane_usage: fullNormal.lane_usage.normal,
      allow_normal_rebalance: false
    }), null);
    assert.equal(selectNextCandidate(candidates, {
      now,
      lane_usage: fullNormal.lane_usage.normal,
      allow_normal_overflow: true,
      allow_normal_rebalance: false
    }).id, "after-normal");

    const normal = reserveQueryQuota(fullNormal, {
      attempt_id: "normal-full-rebalance",
      lane: "baseline",
      pool: "normal",
      quota_purpose: "normal",
      allow_normal_rebalance: true,
      now
    });
    assert.equal(normal.ok, false);
    assert.equal(normal.reason, "normal_limit_reached");
    const overflow = reserveQueryQuota(fullNormal, {
      attempt_id: "normal-full-overflow",
      lane: "baseline",
      pool: "reserve",
      quota_purpose: "normal_overflow",
      now
    });
    assert.equal(overflow.ok, true);
    assert.equal(overflow.reservation.pool, "reserve");
    assert.equal(overflow.reservation.quota_purpose, "normal_overflow");
    assert.equal(overflow.state.quota.normal_reserved, NORMAL_QUERY_LIMIT);
    assert.equal(overflow.state.quota.reserve_reserved, 1);
  });

  await test("현재 185개 physical query는 남아 있는 동안 session당 normal 98회 사용", () => {
    const queries = expandCatalogQueries();
    const tasks = buildPhysicalQuerySchedulerTasks(queries);
    const remaining = new Set(queries.map((query) => query.query_id));
    const sessionCounts = [];
    assert.equal(queries.length, 185);

    for (let sessionIndex = 0; remaining.size > 0; sessionIndex += 1) {
      assert.ok(sessionIndex < 20, "scheduler simulation did not converge");
      const now = `2026-09-${String(sessionIndex + 1).padStart(2, "0")}T00:00:00.000Z`;
      let state = createCollectorState(now);
      const startingCount = remaining.size;
      let used = 0;
      while (used < NORMAL_QUERY_LIMIT && remaining.size > 0) {
        const candidate = selectNextCandidate(
          tasks.filter((task) => remaining.has(task.query_id)),
          {
            now,
            lane_usage: state.lane_usage.normal,
            allow_normal_rebalance: state.quota.normal_reserved < NORMAL_QUERY_LIMIT
          }
        );
        assert.ok(candidate, `session ${sessionIndex + 1} stopped at ${used} normal searches`);
        const laneRebalanced = state.lane_usage.normal[candidate.lane] >= LANE_PLAN[candidate.lane];
        const reservation = reserveQueryQuota(state, {
          attempt_id: `session:${sessionIndex + 1}:${used + 1}`,
          task_id: candidate.id,
          lane: candidate.lane,
          pool: "normal",
          quota_purpose: "normal",
          allow_normal_rebalance: laneRebalanced,
          now
        });
        assert.equal(reservation.ok, true, reservation.reason);
        state = reservation.state;
        remaining.delete(candidate.query_id);
        used += 1;
      }
      sessionCounts.push(used);
      assert.equal(used, Math.min(NORMAL_QUERY_LIMIT, startingCount));
    }
    assert.deepEqual(sessionCounts, [98, 87]);
  });

  await test("장비별 조사 진행률은 sibling task를 하나의 physical query로 집계", () => {
    const queries = [
      {
        query_id: "query:item-a:baseline",
        catalog_id: "item-a",
        exact_name: "장비 A",
        priority: "P1",
        group: "core"
      },
      {
        query_id: "query:item-a:starforce",
        catalog_id: "item-a",
        exact_name: "장비 A",
        priority: "P1",
        group: "core"
      },
      {
        query_id: "query:item-b:baseline",
        catalog_id: "item-b",
        exact_name: "장비 B",
        priority: "P2",
        group: "boss"
      }
    ];
    const tasks = [
      { id: "query:item-a:baseline#baseline", query: queries[0] },
      { id: "query:item-a:baseline#audit", query: queries[0] },
      { id: "query:item-a:starforce#starforce", query: queries[1] },
      { id: "query:item-b:baseline#baseline", query: queries[2] },
      { id: "query:item-b:baseline#audit", query: queries[2] }
    ];
    const summary = summarizeEquipmentQueryProgress(queries, tasks, {
      "query:item-a:baseline#baseline": { first_page_captured: true },
      "query:item-a:baseline#audit": { observations: 0 },
      "query:item-a:starforce#starforce": { observations: 12 },
      "query:item-b:baseline#baseline": { observations: 0 },
      "query:item-b:baseline#audit": { first_page_captured: false }
    }, { today: "2026-09-02" });

    assert.deepEqual({
      total_items: summary.total_items,
      completed_items: summary.completed_items,
      incomplete_items: summary.incomplete_items,
      total_queries: summary.total_queries,
      completed_queries: summary.completed_queries,
      deferred_queries: summary.deferred_queries
    }, {
      total_items: 2,
      completed_items: 1,
      incomplete_items: 1,
      total_queries: 3,
      completed_queries: 2,
      deferred_queries: 0
    });
    assert.deepEqual(summary.items.find((item) => item.catalog_id === "item-a"), {
      catalog_id: "item-a",
      name: "장비 A",
      priority: "P1",
      group: "core",
      total: 2,
      completed: 2,
      deferred: 0,
      remaining: 0,
      status: "completed"
    });
    assert.deepEqual(summary.items.find((item) => item.catalog_id === "item-b"), {
      catalog_id: "item-b",
      name: "장비 B",
      priority: "P2",
      group: "boss",
      total: 1,
      completed: 0,
      deferred: 0,
      remaining: 1,
      status: "incomplete"
    });
  });

  await test("그룹 검색 진행률은 모든 catalog_id에 각각 귀속", () => {
    const queries = expandCatalogQueries().filter((query) =>
      query.search_group_id === "eternal:warrior"
    );
    assert.equal(queries.length, 3);
    assert.equal(queries.every((query) => query.catalog_ids.length === 7), true);
    const tasks = queries.map((query) => ({
      id: `${query.query_id}#physical`,
      query
    }));
    const stats = Object.fromEntries(tasks.map(({ id, query }) => [id, query.page_sweep?.enabled
      ? { first_page_captured: true, page_sweep_complete: true }
      : { first_page_captured: true }
    ]));

    const summary = summarizeEquipmentQueryProgress(queries, tasks, stats, {
      catalog_items: CATALOG_ITEMS,
      today: "2026-09-02"
    });
    assert.equal(summary.total_items, 7);
    assert.equal(summary.total_queries, 3);
    assert.equal(summary.completed_queries, 3);
    assert.equal(summary.completed_items, 7);
    assert.equal(summary.items.every((item) =>
      queries[0].catalog_ids.includes(item.catalog_id) &&
      item.total === 3 &&
      item.completed === 3 &&
      item.status === "completed"
    ), true);
  });

  await test("전역 검색 35개는 전체 검색 수에만 포함하고 장비별 분모에서는 제외", () => {
    const queries = expandCatalogQueries();
    const globalQueries = queries.filter((query) => query.progress_scope === "global");
    const meister = getCatalogItem("마이스터링");
    const meisterSpecific = queries.filter((query) =>
      query.progress_scope !== "global" && query.catalog_ids.includes(meister.id)
    );
    const tasks = queries.map((query) => ({ id: `${query.query_id}#physical`, query }));
    const stats = Object.fromEntries(globalQueries.map((query) => [
      `${query.query_id}#physical`,
      { page_sweep_complete: true }
    ]));
    const summary = summarizeEquipmentQueryProgress(queries, tasks, stats, {
      catalog_items: CATALOG_ITEMS,
      today: "2026-09-02"
    });
    const meisterProgress = summary.items.find((item) => item.catalog_id === meister.id);
    assert.equal(summary.total_queries, 185);
    assert.equal(summary.completed_queries, 35);
    assert.equal(globalQueries.length, 35);
    assert.equal(meisterProgress.total, meisterSpecific.length);
    assert.equal(meisterProgress.completed, 0);
  });

  await test("장비별 조사 진행률은 미래 재확인 일자만 deferred로 세고 완료가 우선", () => {
    const queries = [
      {
        query_id: "query:item-a:baseline",
        catalog_id: "item-a",
        exact_name: "장비 A",
        priority: "P1",
        group: "core"
      },
      {
        query_id: "query:item-a:potential",
        catalog_id: "item-a",
        exact_name: "장비 A",
        priority: "P1",
        group: "core"
      }
    ];
    const tasks = [
      { id: "query:item-a:baseline#baseline", query: queries[0] },
      { id: "query:item-a:baseline#audit", query: queries[0] },
      { id: "query:item-a:potential#main", query: queries[1] }
    ];
    const summary = summarizeEquipmentQueryProgress(queries, tasks, {
      "query:item-a:baseline#baseline": {
        first_page_captured: true,
        next_eligible_date: "2026-09-10"
      },
      "query:item-a:baseline#audit": {
        next_eligible_date: "2026-09-10"
      },
      "query:item-a:potential#main": {
        next_eligible_date: "2026-09-03"
      }
    }, { today: "2026-09-02" });

    assert.equal(summary.completed_queries, 1);
    assert.equal(summary.deferred_queries, 1);
    assert.equal(summary.items[0].completed, 1);
    assert.equal(summary.items[0].deferred, 1);
    assert.equal(summary.items[0].remaining, 1);
    assert.equal(summary.items[0].status, "incomplete");
  });

  await test("빈 상태의 실제 고정 카탈로그 진행률은 151종·185개 모두 미완료", () => {
    const queries = expandCatalogQueries();
    const tasks = queries.flatMap((query) => {
      const baseline = {
        id: `${query.query_id}#baseline`,
        query
      };
      return query.logical_lanes.includes("BASE_ANY")
        ? [baseline, { id: `${query.query_id}#audit`, query }]
        : [baseline];
    });
    const summary = summarizeEquipmentQueryProgress(queries, tasks, {}, {
      today: "2026-09-02"
    });

    assert.equal(summary.total_items, CATALOG_EXPECTED_COUNTS.total);
    assert.equal(summary.completed_items, 0);
    assert.equal(summary.incomplete_items, CATALOG_EXPECTED_COUNTS.total);
    assert.equal(summary.total_queries, 185);
    assert.equal(summary.completed_queries, 0);
    assert.equal(summary.deferred_queries, 0);
    assert.equal(summary.items.length, CATALOG_EXPECTED_COUNTS.total);
    assert.equal(summary.items.every((item) =>
      item.status === "incomplete" && item.remaining === item.total
    ), true);
  });

  await test("후보 선택은 복구·eligibility·priority·deficit·oldest·id 순으로 결정", () => {
    const now = "2026-09-01T00:00:00.000Z";
    const emptyUsage = createLaneUsage();
    const retry = selectNextCandidate([
      { id: "blocked-retry", retry: true, lane: "baseline", priority: "P1", eligible: false },
      { id: "regular", lane: "baseline", priority: "P1" },
      { id: "ready-retry", retry: true, lane: "baseline", priority: "P2" }
    ], { now, lane_usage: emptyUsage });
    assert.equal(retry.id, "ready-retry");

    const priority = selectNextCandidate([
      { id: "p2-large-deficit", lane: "baseline", priority: "P2" },
      { id: "p1-small-deficit", lane: "starforce", priority: "P1" }
    ], { now, lane_usage: emptyUsage });
    assert.equal(priority.id, "p1-small-deficit");

    const deficit = selectNextCandidate([
      { id: "starforce", lane: "starforce", priority: "P1" },
      { id: "baseline", lane: "baseline", priority: "P1" }
    ], { now, lane_usage: emptyUsage });
    assert.equal(deficit.id, "baseline");

    const oldest = selectNextCandidate([
      { id: "newer", lane: "starforce", priority: "P1", last_success_at: "2026-08-31T00:00:00Z" },
      { id: "older", lane: "starforce", priority: "P1", last_success_at: "2026-08-01T00:00:00Z" }
    ], { now, lane_usage: emptyUsage });
    assert.equal(oldest.id, "older");

    const byId = selectNextCandidate([
      { id: "b", lane: "starforce", priority: "P1", last_success_at: "2026-08-01T00:00:00Z" },
      { id: "a", lane: "starforce", priority: "P1", last_success_at: "2026-08-01T00:00:00Z" }
    ], { now, lane_usage: emptyUsage });
    assert.equal(byId.id, "a");
  });

  await test("빈 결과 backoff는 1·3·7·14일 후로 증가", () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(emptyBackoffDays), [0, 1, 3, 7, 14, 14]);
    let task = applyEmptyBackoff({}, "2026-09-01T00:00:00Z");
    assert.equal(task.next_eligible_date, "2026-09-02");
    assert.equal(task.next_eligible_reason, "empty_result");
    task = applyEmptyBackoff(task, "2026-09-02T00:00:00Z");
    assert.equal(task.next_eligible_date, "2026-09-05");
    task = applyEmptyBackoff(task, "2026-09-05T00:00:00Z");
    assert.equal(task.next_eligible_date, "2026-09-12");
    task = applyEmptyBackoff(task, "2026-09-12T00:00:00Z");
    assert.equal(task.next_eligible_date, "2026-09-26");
    const cleared = clearEmptyBackoff(task);
    assert.equal(cleared.next_eligible_date, null);
    assert.equal(cleared.next_eligible_reason, null);
    assert.equal(cleared.consecutive_empty_results, 0);
  });

  await test("실패 재확인은 빈 결과 대기를 우회하지 않음", () => {
    const now = "2026-09-03T00:00:00.000Z";
    assert.equal(inferNextEligibleReason({
      next_eligible_date: "2026-09-04",
      failures: 2
    }), "failure");
    assert.equal(inferNextEligibleReason({
      next_eligible_date: "2026-09-04",
      next_eligible_reason: "failure",
      consecutive_empty_results: 3
    }), "failure");
    assert.equal(inferNextEligibleReason({
      next_eligible_date: "2026-09-04",
      consecutive_empty_results: 1,
      failures: 2
    }), "empty_result");
    assert.equal(inferNextEligibleReason({
      retry: true,
      next_eligible_date: "2026-09-04"
    }), "failure");
    assert.equal(inferNextEligibleReason({ next_eligible_date: "2026-09-04" }), null);

    const futureFailure = {
      id: "future-failure",
      lane: "baseline",
      next_eligible_date: "2026-09-04",
      next_eligible_reason: "failure"
    };
    assert.equal(isCandidateEligible(futureFailure, { now, lane_usage: createLaneUsage() }), false);
    assert.equal(isCandidateEligible({
      ...futureFailure,
      failure_recheck: true
    }, { now, lane_usage: createLaneUsage(99) }), true);
    assert.equal(isCandidateEligible({
      ...futureFailure,
      next_eligible_reason: "empty_result",
      failure_recheck: true
    }, { now, lane_usage: createLaneUsage() }), false);
    assert.equal(isCandidateEligible({
      ...futureFailure,
      next_eligible_reason: null,
      failures: 0,
      failure_recheck: true
    }, { now, lane_usage: createLaneUsage(99) }), false);
    assert.equal(isCandidateEligible({
      ...futureFailure,
      failure_recheck: true,
      next_eligible_at: "2026-09-03T01:00:00.000Z"
    }, { now, lane_usage: createLaneUsage() }), false);
    for (const blockedState of [
      { blocked: true },
      { completed: true },
      { eligible: false }
    ]) {
      assert.equal(isCandidateEligible({
        ...futureFailure,
        ...blockedState,
        failure_recheck: true
      }, { now, lane_usage: createLaneUsage() }), false);
    }

    const selected = selectNextCandidate([
      { id: "normal", lane: "baseline", priority: "P1" },
      { ...futureFailure, failure_recheck: true, priority: "P2" }
    ], { now, lane_usage: createLaneUsage() });
    assert.equal(selected.id, "future-failure");
  });

  await test("예약 단계 전이와 중단 복구 행동", () => {
    const now = "2026-09-01T00:00:00.000Z";
    let state = createCollectorState(now);
    state = reserveQueryQuota(state, {
      attempt_id: "phase-test",
      task_id: "task-a",
      lane: "baseline",
      page_number: 3,
      now
    }).state;
    let recovery = recoverInterruptedState(state, "2026-09-01T00:01:00.000Z");
    assert.deepEqual(recovery.actions, [{
      attempt_id: "phase-test",
      action: "resume_reserved",
      requires_new_reservation: false,
      replay_page: 3
    }]);

    state = advanceAttemptPhase(state, "phase-test", "requested", "2026-09-01T00:02:00.000Z");
    recovery = recoverInterruptedState(state, "2026-09-01T00:03:00.000Z");
    assert.equal(recovery.actions[0].action, "replay_request");
    assert.equal(recovery.actions[0].requires_new_reservation, true);
    assert.equal(recovery.actions[0].replay_page, 3);

    state = advanceAttemptPhase(state, "phase-test", "received", "2026-09-01T00:04:00.000Z");
    recovery = recoverInterruptedState(state, "2026-09-01T00:05:00.000Z");
    assert.equal(recovery.actions[0].action, "commit_received");
    state = advanceAttemptPhase(state, "phase-test", "committed", "2026-09-01T00:06:00.000Z");
    assert.deepEqual(recoverInterruptedState(state, "2026-09-01T00:07:00.000Z").actions, []);
    assert.throws(() => advanceAttemptPhase(state, "phase-test", "requested", now));

    let oldReservation = createCollectorState(now);
    oldReservation = reserveQueryQuota(oldReservation, {
      attempt_id: "previous-day-reserved",
      lane: "baseline",
      now
    }).state;
    const nextDay = recoverInterruptedState(oldReservation, "2026-09-01T15:00:00.000Z");
    assert.equal(nextDay.actions[0].requires_new_reservation, true);
  });

  await test("페이지 경계 도달 후 한 페이지 overlap하고 중단", () => {
    const oldBoundary = createPageBoundary([
      soldListing("101", "2026-08-31"),
      soldListing("102", "2026-08-30")
    ]);
    let pagination = createPaginationState({
      stop_boundary: oldBoundary,
      overlap_pages_remaining: 1
    });
    const boundaryPage = evaluateCollectedPage(pagination, {
      page_number: 1,
      items: [
        soldListing("201", "2026-09-01"),
        soldListing("102", "2026-08-30")
      ],
      has_next_page: true,
      effective_page_limit: 40
    });
    assert.equal(boundaryPage.decision.action, "continue");
    assert.equal(boundaryPage.decision.reason, "collect_overlap");
    assert.equal(boundaryPage.decision.boundary_overlap.matched, true);

    pagination = boundaryPage.state;
    const overlapPage = evaluateCollectedPage(pagination, {
      page_number: 2,
      items: [soldListing("301", "2026-08-29")],
      has_next_page: true,
      effective_page_limit: 40
    });
    assert.equal(overlapPage.decision.action, "stop");
    assert.equal(overlapPage.decision.reason, "boundary_overlap_complete");
    assert.equal(overlapPage.decision.commit_page, true);
  });

  await test("서로 다른 페이지의 동일 signature는 허용하고 같은 페이지 replay만 중단", () => {
    const items = [soldListing("401", "2026-09-01")];
    const first = evaluateCollectedPage(createPaginationState(), {
      page_number: 1,
      items,
      has_next_page: true,
      effective_page_limit: 40
    });
    assert.equal(first.decision.action, "continue");
    const second = evaluateCollectedPage(first.state, {
      page_number: 2,
      items,
      has_next_page: true,
      effective_page_limit: 40
    });
    assert.equal(second.decision.action, "continue");
    assert.equal(second.decision.reason, "more_pages");
    assert.equal(second.decision.commit_page, true);

    const repeated = evaluateCollectedPage(second.state, {
      page_number: 2,
      items,
      has_next_page: true,
      effective_page_limit: 40
    });
    assert.equal(repeated.decision.action, "stop");
    assert.equal(repeated.decision.reason, "repeated_page_signature");
    assert.equal(repeated.decision.commit_page, false);
  });

  await test("구조화 응답 페이지 서명은 순서와 거래 핵심값 변경을 감지", () => {
    const first = {
      source_hashes: { listing: `sha256:${"a".repeat(64)}`, item: `sha256:${"b".repeat(64)}` },
      itemName: "거대한 공포",
      price: "1000000000",
      quantity: 1,
      tradeDate: "2026-09-02T00:00:00.000Z"
    };
    const second = {
      source_hashes: { listing: `sha256:${"c".repeat(64)}`, item: `sha256:${"d".repeat(64)}` },
      itemName: "거대한 공포",
      price: "2000000000",
      quantity: 1,
      tradeDate: "2026-09-01T00:00:00.000Z"
    };
    const signature = createStructuredPageSignature([first, second]);
    assert.equal(createStructuredPageSignature([{ ...first }, { ...second }]), signature);
    assert.notEqual(createStructuredPageSignature([second, first]), signature);
    assert.notEqual(createStructuredPageSignature([first, { ...second, price: "2100000000" }]), signature);
    assert.notEqual(createStructuredPageSignature([first]), signature);
    const state = createPaginationState({
      continuation_anchor: { page: 3, signature }
    });
    assert.deepEqual(state.continuation_anchor, { page: 3, signature });
  });

  await test("1페이지 결과와 중간의 마지막 짧은 페이지에서 즉시 검색을 끝냄", () => {
    const onePage = evaluateCollectedPage(createPaginationState(), {
      page_number: 1,
      items: Array.from({ length: 17 }, (_, index) => soldListing(`one-${index}`, "2026-09-01")),
      row_count: 17,
      total_results: 17,
      has_next_page: false,
      effective_page_limit: 60
    });
    assert.equal(onePage.decision.action, "stop");
    assert.equal(onePage.decision.reason, "last_page");
    assert.equal(onePage.decision.commit_page, true);
    assert.equal(onePage.state.committed_rows, 17);

    const first = evaluateCollectedPage(createPaginationState(), {
      page_number: 1,
      items: Array.from({ length: 60 }, (_, index) => soldListing(`first-${index}`, "2026-09-01")),
      row_count: 60,
      total_results: 68,
      has_next_page: true,
      effective_page_limit: 60
    });
    const last = evaluateCollectedPage(first.state, {
      page_number: 2,
      items: Array.from({ length: 8 }, (_, index) => soldListing(`last-${index}`, "2026-08-31")),
      row_count: 8,
      total_results: 68,
      has_next_page: false,
      effective_page_limit: 60
    });
    assert.equal(first.decision.action, "continue");
    assert.equal(last.decision.action, "stop");
    assert.equal(last.decision.reason, "last_page");
    assert.equal(last.state.committed_rows, 68);
  });

  await test("전역 검색은 원본 행이 있으면 카탈로그 일치 0건 페이지도 계속 순회", () => {
    const first = evaluateCollectedPage(createPaginationState(), {
      page_number: 1,
      items: [],
      row_count: 60,
      total_results: 72,
      has_next_page: true,
      effective_page_limit: 60
    });
    assert.equal(first.decision.action, "continue");
    assert.equal(first.decision.reason, "more_pages");
    assert.equal(first.state.committed_rows, 60);

    const last = evaluateCollectedPage(first.state, {
      page_number: 2,
      items: [],
      row_count: 12,
      total_results: 72,
      has_next_page: false,
      effective_page_limit: 60
    });
    assert.equal(last.decision.action, "stop");
    assert.equal(last.decision.reason, "last_page");
    assert.equal(last.state.committed_rows, 72);
  });

  await test("500건 결과는 60개 기준 9페이지까지만 누적", async () => {
    let pagination = createPaginationState();
    for (let page = 1; page <= 9; page += 1) {
      const count = page === 9 ? 20 : 60;
      const result = evaluateCollectedPage(pagination, {
        page_number: page,
        items: Array.from({ length: count }, (_, index) =>
          soldListing(`cap-${page}-${index}`, "2026-09-01")
        ),
        row_count: count,
        total_results: 500,
        has_next_page: page < 9,
        effective_page_limit: 60
      });
      pagination = result.state;
      assert.equal(result.decision.action, page < 9 ? "continue" : "stop");
    }
    assert.equal(pagination.committed_rows, 500);
    assert.equal(pagination.last_committed_page, 9);

    const managerSource = await readFile(path.join(extensionDirectory, "manager.js"), "utf8");
    assert.equal(managerSource.includes("resultCap - committedRows"), true);
    assert.equal(managerSource.includes('stop_reason: "result_cap_reached"'), true);
  });

  await test("페이지 크기 60 확인과 40 fallback 보정", () => {
    const confirmed = calibratePageLimit({
      requested_limit: 60,
      actual_count: 60,
      has_next_page: true
    }, "2026-09-01T00:00:00Z");
    assert.equal(confirmed.status, "confirmed_60");
    assert.equal(effectivePageLimit(confirmed), 60);

    const fallback = calibratePageLimit({
      requested_limit: 60,
      actual_count: 40,
      has_next_page: true
    }, "2026-09-01T00:00:00Z");
    assert.equal(fallback.status, "fallback_40");
    assert.equal(fallback.reason, "40_rows_with_more_results");
    assert.equal(effectivePageLimit(fallback), 40);

    const lastShortPage = calibratePageLimit({
      requested_limit: 60,
      actual_count: 20,
      has_next_page: false
    }, "2026-09-01T00:00:00Z");
    assert.equal(lastShortPage.status, "inconclusive");
    assert.equal(effectivePageLimit(lastShortPage), 60);
  });

  const captureSchema = JSON.parse(await readFile(path.join(extensionDirectory, "schemas", "capture-v2.schema.json"), "utf8"));
  const normalizedSchema = JSON.parse(await readFile(path.join(extensionDirectory, "schemas", "normalized-v2.schema.json"), "utf8"));
  await test("JSON Schema 검증", () => {
    assert.deepEqual(validateSchema(sampleCaptureDocument(), captureSchema), []);
    const restarted = sampleCaptureDocument();
    restarted.capture.collection_mode = "catalog_restart";
    assert.deepEqual(validateSchema(restarted, captureSchema), []);
    normalized.forEach((record) => assert.deepEqual(validateSchema(record, normalizedSchema), []));
  });
  await test("동일 배치 변환 멱등성", () => {
    const second = migrateV1Batch(parseInput(sampleBefore.toString("utf8")).value);
    assert.equal(JSON.stringify(second), JSON.stringify(normalized));
  });
  await test("프리셋 URL은 판매완료·정확한 이름·60개·첫 페이지로 구성", () => {
    const url = buildPresetUrl(
      "https://auction.maplestory.nexon.com/buy?sortType=PRICE_ASC&itemCategory=ETC&priceSearchKey=stale&unrelatedFilter=stale&onlyCurrentWorld=true",
      {
        keyword: "마이스터링",
        starforce_min: 18,
        starforce_max: 22,
        potential_code: "intPercent",
        potential_min: 27
      }
    );
    assert.equal(url.pathname, "/price");
    assert.equal(url.searchParams.get("limit"), "60");
    assert.equal(url.searchParams.get("page"), "1");
    assert.equal(url.searchParams.get("keyword"), "마이스터링");
    assert.equal(url.searchParams.get("isExactMatch"), "true");
    assert.equal(url.searchParams.get("enhancementOption::starforceMin"), "18");
    assert.equal(url.searchParams.get("enhancementOption::starforceMax"), "22");
    assert.equal(url.searchParams.get("enhancementOption::potentialFilters::optionRows"), "intPercent\u001f27");
    assert.equal(url.searchParams.has("priceSearchKey"), false);
    assert.equal(url.searchParams.get("sortType"), "TRADE_DATE_DESC");
    assert.equal(url.searchParams.has("itemCategory"), false);
    assert.equal(url.searchParams.get("onlyCurrentWorld"), "true");
    assert.equal(url.searchParams.has("unrelatedFilter"), false);
  });
  await test("빈 프리셋 필터는 URL에서 제거", () => {
    const url = buildPresetUrl(
      "https://auction.maplestory.nexon.com/price?enhancementOption::starforceMin=18&enhancementOption::starforceMax=22&enhancementOption::potentialFilters::optionRows=intPercent%1F27",
      {
        keyword: "데이브레이크 펜던트",
        starforce_min: null,
        starforce_max: null,
        potential_code: null,
        potential_min: null
      }
    );
    assert.equal(url.searchParams.has("enhancementOption::starforceMin"), false);
    assert.equal(url.searchParams.has("enhancementOption::starforceMax"), false);
    assert.equal(url.searchParams.has("enhancementOption::potentialFilters::optionRows"), false);
    assert.equal(url.pathname, "/price");
    assert.equal(url.searchParams.get("isExactMatch"), "true");
    assert.equal(url.searchParams.has("itemCategory"), false);
    assert.equal(withDefaultPageLimit(url).searchParams.get("limit"), "60");
  });
  await test("프리셋 범위와 윗잠 쌍 검증", () => {
    assert.throws(() => validatePreset({
      keyword: "마이스터링",
      starforce_min: 22,
      starforce_max: 18,
      potential_code: null,
      potential_min: null
    }));
    assert.throws(() => validatePreset({
      keyword: "마이스터링",
      starforce_min: null,
      starforce_max: null,
      potential_code: "strPercent",
      potential_min: null
    }));
    assert.throws(() => validatePreset({
      keyword: "마이스터링",
      price_min_meso: -1
    }));
    assert.throws(() => validatePreset({
      keyword: "마이스터링",
      price_min_meso: 50_000_000.5
    }));
    assert.throws(() => validatePreset({
      keyword: "마이스터링",
      price_min_meso: 100_000_000,
      price_max_meso: 50_000_000
    }));
  });
  await test("기본 시세 최소 5천만은 URL·폼 근거 context에서 엄격히 검증", () => {
    const query = {
      keyword: "거대한 공포",
      page_limit: 60,
      starforce_min: null,
      starforce_max: null,
      price_min_meso: 50_000_000,
      price_max_meso: null,
      server_filter: null
    };
    const entry = buildQueryUrl("https://auction.maplestory.nexon.com/price", query);
    assert.equal(entry.searchParams.get("price::min"), "50000000");
    assert.equal(entry.searchParams.has("price::max"), false);

    const submitted = new URL(entry);
    submitted.searchParams.set("itemCategory", "ARMOR");
    submitted.searchParams.set("enhancementOption::starforceMin", "0");
    submitted.searchParams.set("priceSearchKey", "opaque-price-search");
    assert.equal(isSubmittedFilterSearchUrl(submitted, query), true);
    const opaqueOnly = new URL(submitted);
    opaqueOnly.searchParams.delete("price::min");
    assert.equal(isSubmittedFilterSearchUrl(opaqueOnly, query), true);
    const wrongUrlPrice = new URL(submitted);
    wrongUrlPrice.searchParams.set("price::min", "40000000");
    assert.equal(isSubmittedFilterSearchUrl(wrongUrlPrice, query), false);

    const context = {
      page_kind: "sold",
      keyword: "거대한 공포",
      sort: "trade_date_desc",
      page: 1,
      limit: 60,
      filter_search_applied: true,
      price_search_key_present: true,
      raw_filters: {
        searchTab: "condition",
        isExactMatch: "true",
        itemCategory: "ARMOR",
        "enhancementOption::starforceMin": "0",
        "form::priceMinMeso": "50000000"
      }
    };
    assert.equal(queryMatchesSearchContext(context, query), true);
    assert.equal(queryMatchesSearchContext({
      ...context,
      raw_filters: { ...context.raw_filters, "form::priceMinMeso": "40000000" }
    }, query), false);
    const { ["form::priceMinMeso"]: _removed, ...withoutPrice } = context.raw_filters;
    assert.equal(queryMatchesSearchContext({ ...context, raw_filters: withoutPrice }, query), false);
    assert.equal(queryMatchesSearchContext({
      ...context,
      raw_filters: { ...context.raw_filters, "price::min": "40000000" }
    }, query), false);

    const noPriceQuery = { ...query, price_min_meso: null };
    const noPriceContext = {
      ...context,
      raw_filters: {
        ...withoutPrice,
        "price::min": "0",
        "price::max": "0"
      }
    };
    assert.equal(queryMatchesSearchContext(noPriceContext, noPriceQuery), true);
    assert.equal(queryMatchesSearchContext({
      ...noPriceContext,
      raw_filters: { ...noPriceContext.raw_filters, "price::min": "not-a-number" }
    }, noPriceQuery), false);
  });
  await test("적용된 검색 조건과 프리셋 일치 검증", () => {
    const preset = {
      keyword: "마이스터링",
      starforce_min: 18,
      starforce_max: 22,
      potential_code: "intPercent",
      potential_min: 27
    };
    const context = {
      page_kind: "sold",
      keyword: "마이스터링",
      sort: "trade_date_desc",
      page: 1,
      limit: 60,
      filter_search_applied: true,
      price_search_key_present: true,
      raw_filters: {
        "isExactMatch": "true",
        "enhancementOption::starforceMin": "18",
        "enhancementOption::starforceMax": "22",
        "enhancementOption::potentialFilters::optionRows": "intPercent\u001f27"
      }
    };
    assert.equal(presetMatchesSearchContext(context, preset), true);
    assert.equal(presetMatchesSearchContext({ ...context, limit: 20 }, preset), false);
    assert.equal(presetMatchesSearchContext({ ...context, page_kind: "active" }, preset), false);
    assert.equal(presetMatchesSearchContext({
      ...context,
      raw_filters: { ...context.raw_filters, isExactMatch: "false" }
    }, preset), false);
    assert.equal(presetMatchesSearchContext({
      ...context,
      filter_search_applied: false
    }, preset), false);
    assert.equal(presetMatchesSearchContext({
      ...context,
      price_search_key_present: false
    }, preset), false);
  });

  await test("카탈로그 query URL과 페이지별 search context 일치", () => {
    const query = {
      keyword: "에테르넬 나이트아머",
      page_limit: 60,
      starforce_min: 19,
      starforce_max: 21,
      server_filter: { code: "strPercent", minimum: 23 }
    };
    const url = buildQueryUrl(
      "https://auction.maplestory.nexon.com/search?itemCategory=ARMOR&priceSearchKey=secret&worldOnly=false",
      query,
      { page: 3, limit: 40 }
    );
    assert.equal(url.pathname, "/price");
    assert.equal(url.searchParams.get("sortType"), "TRADE_DATE_DESC");
    assert.equal(url.searchParams.get("isExactMatch"), "true");
    assert.equal(url.searchParams.get("page"), "3");
    assert.equal(url.searchParams.get("limit"), "40");
    assert.equal(url.searchParams.has("itemCategory"), false);
    assert.equal(url.searchParams.has("priceSearchKey"), false);
    assert.equal(url.searchParams.get("worldOnly"), "false");
    assert.equal(url.searchParams.get("enhancementOption::starforceMin"), "19");
    assert.equal(url.searchParams.get("enhancementOption::starforceMax"), "21");
    assert.equal(
      url.searchParams.get("enhancementOption::potentialFilters::optionRows"),
      "strPercent\u001f23"
    );

    const context = {
      page_kind: "sold",
      keyword: "에테르넬 나이트아머",
      sort: "trade_date_desc",
      page: 3,
      limit: 40,
      filter_search_applied: true,
      price_search_key_present: true,
      raw_filters: {
        isExactMatch: "true",
        "enhancementOption::starforceMin": "19",
        "enhancementOption::starforceMax": "21",
        "enhancementOption::potentialFilters::optionRows": "strPercent\u001f23"
      }
    };
    assert.equal(queryMatchesSearchContext(context, query, { page: 3, limit: 40 }), true);
    assert.equal(queryMatchesSearchContext({ ...context, sort: "price_asc" }, query, { page: 3, limit: 40 }), false);
    assert.equal(queryMatchesSearchContext({
      ...context,
      raw_filters: { ...context.raw_filters, itemCategory: "ARMOR" }
    }, query, { page: 3, limit: 40 }), true);
    assert.equal(queryMatchesSearchContext({
      ...context,
      raw_filters: { ...context.raw_filters, itemCategory: "ETC" }
    }, query, { page: 3, limit: 40 }), false);
    assert.equal(withPage(url, 4, 40).searchParams.get("page"), "4");
    assert.throws(() => withPage(url, 1, 20));
  });

  await test("그룹 부분 검색은 exact_match=false URL·context·후속 페이지를 유지", () => {
    const query = {
      keyword: "에테르넬 나이트",
      exact_match: false,
      page_limit: 60,
      starforce_min: 17,
      starforce_max: null,
      server_filter: null
    };
    const entryUrl = buildQueryUrl(
      "https://auction.maplestory.nexon.com/price?priceSearchKey=stale",
      query
    );
    assert.equal(entryUrl.searchParams.get("keyword"), "에테르넬 나이트");
    assert.equal(entryUrl.searchParams.get("isExactMatch"), "false");
    assert.equal(entryUrl.searchParams.has("priceSearchKey"), false);

    const submittedUrl = new URL(entryUrl);
    submittedUrl.searchParams.set("itemCategory", "ARMOR");
    submittedUrl.searchParams.set("priceSearchKey", "opaque-group-search");
    assert.equal(isSubmittedFilterSearchUrl(submittedUrl, query), true);
    assert.equal(isReusableFilterSearchUrl(submittedUrl, query), true);

    const context = {
      page_kind: "sold",
      keyword: "에테르넬 나이트",
      sort: "trade_date_desc",
      page: 1,
      limit: 60,
      filter_search_applied: true,
      price_search_key_present: true,
      raw_filters: {
        isExactMatch: "false",
        itemCategory: "ARMOR",
        "enhancementOption::starforceMin": "17"
      }
    };
    assert.equal(queryMatchesSearchContext(context, query), true);
    assert.equal(queryMatchesSearchContext({
      ...context,
      raw_filters: { ...context.raw_filters, isExactMatch: "true" }
    }, query), false);
    assert.equal(queryMatchesSearchContext({
      ...context,
      raw_filters: { ...context.raw_filters, isExactMatch: "unexpected" }
    }, query), false);

    const continuation = buildFilterContinuationUrl(submittedUrl, query, {
      page: 2,
      limit: 60
    });
    assert.equal(continuation.searchParams.get("page"), "2");
    assert.equal(continuation.searchParams.get("isExactMatch"), "false");
    assert.equal(continuation.searchParams.get("priceSearchKey"), "opaque-group-search");
  });

  await test("장비명 없는 전역 스타포스 검색은 빈 검색어를 유지하고 필터 검색을 제출", () => {
    const query = {
      keyword: "",
      search_scope: "catalog_global",
      exact_match: false,
      page_limit: 60,
      starforce_min: 23,
      starforce_max: 23,
      server_filter: null
    };
    assert.equal(validatePreset(query), true);
    assert.equal(requiresFilterSubmission(query), true);
    assert.throws(() => validatePreset({ ...query, search_scope: null }));
    assert.throws(() => validatePreset({ ...query, exact_match: true }));
    assert.throws(() => validatePreset({ ...query, starforce_min: null, starforce_max: null }));

    const entryUrl = buildQueryUrl("https://auction.maplestory.nexon.com/price?priceSearchKey=stale", query);
    assert.equal(entryUrl.searchParams.has("keyword"), false);
    assert.equal(entryUrl.searchParams.has("isExactMatch"), false);
    assert.equal(entryUrl.searchParams.get("enhancementOption::starforceMin"), "23");
    assert.equal(entryUrl.searchParams.get("enhancementOption::starforceMax"), "23");

    const submittedUrl = new URL(entryUrl);
    submittedUrl.searchParams.set("itemCategory", "ARMOR");
    submittedUrl.searchParams.set("priceSearchKey", "opaque-global-search");
    assert.equal(isSubmittedFilterSearchUrl(submittedUrl, query), true);
    assert.equal(isReusableFilterSearchUrl(submittedUrl, query), true);
    const emptyKeywordAlias = new URL(submittedUrl);
    emptyKeywordAlias.searchParams.set("keyword", "");
    emptyKeywordAlias.searchParams.set("isExactMatch", "true");
    assert.equal(isSubmittedFilterSearchUrl(emptyKeywordAlias, query), true);

    const context = {
      page_kind: "sold",
      keyword: null,
      sort: "trade_date_desc",
      page: 1,
      limit: 60,
      filter_search_applied: true,
      price_search_key_present: true,
      raw_filters: {
        itemCategory: "ARMOR",
        "enhancementOption::starforceMin": "23",
        "enhancementOption::starforceMax": "23"
      }
    };
    assert.equal(queryMatchesSearchContext(context, query), true);
    assert.equal(queryMatchesSearchContext({ ...context, keyword: "마이스터링" }, query), false);
    assert.equal(queryMatchesSearchContext({
      ...context,
      raw_filters: { ...context.raw_filters, isExactMatch: "true" }
    }, query), true);
    assert.equal(queryMatchesSearchContext({
      ...context,
      raw_filters: { ...context.raw_filters, isExactMatch: "unexpected" }
    }, query), false);

    const continuation = buildFilterContinuationUrl(submittedUrl, query, { page: 2, limit: 60 });
    assert.equal(continuation.searchParams.get("page"), "2");
    assert.equal(continuation.searchParams.has("keyword"), false);
    assert.equal(continuation.searchParams.get("priceSearchKey"), "opaque-global-search");
  });

  await test("장비명 없는 전역 드롭·메획 검색은 잠재 조건만으로 제출·검증", () => {
    const query = {
      keyword: "",
      search_scope: "catalog_global",
      exact_match: false,
      page_limit: 60,
      starforce_min: null,
      starforce_max: null,
      server_filter: { code: "mesosObtainedPercent", minimum: 20 }
    };
    assert.equal(validatePreset(query), true);
    assert.equal(requiresFilterSubmission(query), true);

    const entryUrl = buildQueryUrl("https://auction.maplestory.nexon.com/price?priceSearchKey=stale", query);
    assert.equal(entryUrl.searchParams.has("keyword"), false);
    assert.equal(entryUrl.searchParams.has("enhancementOption::starforceMin"), false);
    assert.equal(
      entryUrl.searchParams.get("enhancementOption::potentialFilters::optionRows"),
      "mesosObtainedPercent\u001f20"
    );

    const submittedUrl = new URL(entryUrl);
    submittedUrl.searchParams.set("itemCategory", "ARMOR");
    submittedUrl.searchParams.set("enhancementOption::starforceMin", "0");
    submittedUrl.searchParams.set("priceSearchKey", "opaque-accessory-search");
    assert.equal(isSubmittedFilterSearchUrl(submittedUrl, query), true);
    assert.equal(isReusableFilterSearchUrl(submittedUrl, query), true);

    const context = {
      page_kind: "sold",
      keyword: null,
      sort: "trade_date_desc",
      page: 1,
      limit: 60,
      filter_search_applied: true,
      price_search_key_present: true,
      raw_filters: {
        itemCategory: "ARMOR",
        "enhancementOption::starforceMin": "0",
        "enhancementOption::potentialFilters::optionRows": "mesosObtainedPercent\u001f20"
      }
    };
    assert.equal(queryMatchesSearchContext(context, query), true);
    assert.equal(queryMatchesSearchContext({
      ...context,
      raw_filters: {
        ...context.raw_filters,
        "enhancementOption::potentialFilters::optionRows": "itemDropPercent\u001f20"
      }
    }, query), false);
  });

  await test("분류별 고잠재 검색은 결과 폼의 장신구·방어구 선택까지 검증", () => {
    const query = {
      keyword: "",
      search_scope: "catalog_global",
      exact_match: false,
      page_limit: 60,
      item_category_filter: "ARMOR",
      equipment_subcategory_filter: "장신구",
      starforce_min: null,
      starforce_max: null,
      server_filter: { code: "strPercent", minimum: 27, maximum: 29 }
    };
    assert.equal(validatePreset(query), true);
    const entryUrl = buildQueryUrl("https://auction.maplestory.nexon.com/price", query);
    assert.equal(entryUrl.searchParams.get("itemCategory"), "ARMOR");
    assert.equal(entryUrl.searchParams.has("form::equipmentSubcategory"), false);

    const submittedUrl = new URL(entryUrl);
    submittedUrl.searchParams.set("enhancementOption::starforceMin", "0");
    submittedUrl.searchParams.set("priceSearchKey", "opaque-category-search");
    assert.equal(isSubmittedFilterSearchUrl(submittedUrl, query), true);

    const canonicalAccessoryUrl = new URL(submittedUrl);
    canonicalAccessoryUrl.searchParams.set("itemCategory", "ARMOR_ACCESSORY");
    canonicalAccessoryUrl.searchParams.set("limit", "20");
    assert.equal(
      isSubmittedFilterSearchUrl(canonicalAccessoryUrl, query),
      true,
      "장신구 결과 URL의 ARMOR_ACCESSORY와 제출 직후 20개 보기를 허용함"
    );
    assert.equal(isSubmittedFilterSearchUrl(canonicalAccessoryUrl, {
      ...query,
      equipment_subcategory_filter: "방어구"
    }), false, "ARMOR_ACCESSORY 별칭은 방어구 검색에 적용하지 않음");

    const armorQuery = {
      ...query,
      equipment_subcategory_filter: "방어구",
      server_filter: { code: "strPercent", minimum: 30, maximum: 32 }
    };
    const canonicalArmorUrl = new URL("https://auction.maplestory.nexon.com/price");
    canonicalArmorUrl.searchParams.set("searchTab", "condition");
    canonicalArmorUrl.searchParams.set("isExactMatch", "false");
    canonicalArmorUrl.searchParams.set("page", "1");
    canonicalArmorUrl.searchParams.set("limit", "20");
    canonicalArmorUrl.searchParams.set("sortType", "TRADE_DATE_DESC");
    canonicalArmorUrl.searchParams.set("itemCategory", "ARMOR_ARMOR");
    canonicalArmorUrl.searchParams.set("enhancementOption::starforceMin", "0");
    canonicalArmorUrl.searchParams.set(
      "enhancementOption::potentialFilters::optionRows",
      "strPercent\u001f30"
    );
    canonicalArmorUrl.searchParams.set("priceSearchKey", "opaque-armor-category-search");
    assert.equal(
      isSubmittedFilterSearchUrl(canonicalArmorUrl, armorQuery),
      true,
      "방어구 결과 URL의 ARMOR_ARMOR와 제출 직후 20개 보기를 허용함"
    );
    assert.equal(
      isSubmittedFilterSearchUrl(canonicalArmorUrl, query),
      false,
      "ARMOR_ARMOR 별칭은 장신구 검색에 적용하지 않음"
    );

    const context = {
      page_kind: "sold",
      keyword: null,
      sort: "trade_date_desc",
      page: 1,
      limit: 60,
      filter_search_applied: true,
      price_search_key_present: true,
      raw_filters: {
        itemCategory: "ARMOR",
        "form::equipmentSubcategory": "장신구",
        "enhancementOption::starforceMin": "0",
        "enhancementOption::potentialFilters::optionRows": "strPercent\u001f27"
      }
    };
    assert.equal(queryMatchesSearchContext(context, query), true);
    assert.equal(queryMatchesSearchContext({
      ...context,
      raw_filters: { ...context.raw_filters, "form::equipmentSubcategory": "방어구" }
    }, query), false);
    assert.equal(queryMatchesSearchContext({
      ...context,
      raw_filters: { ...context.raw_filters, "form::equipmentSubcategory": undefined }
    }, query), false);
    const canonicalAccessoryContext = {
      ...context,
      raw_filters: {
        ...context.raw_filters,
        itemCategory: "ARMOR_ACCESSORY",
        "form::equipmentSubcategory": undefined
      }
    };
    assert.equal(
      queryMatchesSearchContext(canonicalAccessoryContext, query),
      true,
      "결과 DOM의 하위 분류가 교체돼도 ARMOR_ACCESSORY를 장신구 근거로 사용함"
    );
    assert.equal(queryMatchesSearchContext(canonicalAccessoryContext, {
      ...query,
      equipment_subcategory_filter: "방어구"
    }), false);
    const canonicalArmorContext = {
      ...context,
      raw_filters: {
        ...context.raw_filters,
        itemCategory: "ARMOR_ARMOR",
        "form::equipmentSubcategory": undefined,
        "enhancementOption::potentialFilters::optionRows": "strPercent\u001f30"
      }
    };
    assert.equal(queryMatchesSearchContext(canonicalArmorContext, armorQuery), true);
    assert.equal(queryMatchesSearchContext(canonicalArmorContext, query), false);
    assert.throws(() => validatePreset({
      ...query,
      equipment_subcategory_filter: "무기"
    }));
    assert.throws(() => validatePreset({
      ...query,
      item_category_filter: "ETC"
    }));
    assert.throws(() => validatePreset({
      ...query,
      server_filter: { code: "strPercent", minimum: 30, maximum: 29 }
    }));
  });

  await test("모든 카탈로그 검색은 화면의 필터 검색 제출이 필요", () => {
    assert.equal(requiresFilterSubmission({
      keyword: "마이스터링",
      starforce_min: null,
      starforce_max: null,
      server_filter: null
    }), true);
    assert.equal(requiresFilterSubmission({
      keyword: "마이스터링",
      starforce_min: 0,
      starforce_max: 0,
      server_filter: null
    }), true);
    assert.equal(requiresFilterSubmission({
      keyword: "마이스터링",
      starforce_min: null,
      starforce_max: null,
      server_filter: { code: "allStatsPercent", minimum: 15 }
    }), true);
    assert.equal(requiresFilterSubmission({
      keyword: "",
      search_scope: "catalog_global",
      exact_match: false,
      starforce_min: 25,
      starforce_max: null
    }), true);
  });

  await test("시세 탭 여부는 URL 조건과 무관하게 경로로만 판단", () => {
    assert.equal(isPriceTabUrl(
      "https://auction.maplestory.nexon.com/price?keyword=거대한+공포&priceSearchKey=old"
    ), true);
    assert.equal(isPriceTabUrl("https://auction.maplestory.nexon.com/buy"), false);
    assert.equal(isPriceTabUrl("https://example.com/price"), false);
  });

  await test("올스탯 필터 검색 결과는 경매장 복수형 코드로 검증", () => {
    const query = {
      keyword: "거대한 공포",
      starforce_min: null,
      starforce_max: null,
      server_filter: { code: "allStatsPercent", minimum: 15 }
    };
    const filteredUrl = buildQueryUrl("https://auction.maplestory.nexon.com/price", query);
    filteredUrl.searchParams.set("itemCategory", "ARMOR");
    filteredUrl.searchParams.set("enhancementOption::starforceMin", "0");
    filteredUrl.searchParams.set("priceSearchKey", "opaque-filter-session");
    assert.equal(
      filteredUrl.searchParams.get("enhancementOption::potentialFilters::optionRows"),
      "allStatsPercent\u001f15"
    );
    assert.equal(isReusableFilterSearchUrl(filteredUrl, query), true);
    filteredUrl.searchParams.set(
      "enhancementOption::potentialFilters::optionRows",
      "allStatPercent\u001f15"
    );
    assert.equal(isReusableFilterSearchUrl(filteredUrl, query), false);
  });

  await test("전체 장신구 올스탯 21% 제출 URL의 실제 카테고리 코드를 허용", () => {
    const query = {
      keyword: "",
      search_scope: "catalog_global",
      exact_match: false,
      page_limit: 60,
      item_category_filter: "ARMOR",
      equipment_subcategory_filter: "장신구",
      starforce_min: null,
      starforce_max: null,
      server_filter: { code: "allStatsPercent", minimum: 21 }
    };
    const submitted = new URL("https://auction.maplestory.nexon.com/price");
    submitted.searchParams.set("searchTab", "condition");
    submitted.searchParams.set("isExactMatch", "false");
    submitted.searchParams.set("page", "1");
    submitted.searchParams.set("limit", "20");
    submitted.searchParams.set("sortType", "TRADE_DATE_DESC");
    submitted.searchParams.set("itemCategory", "ARMOR_ACCESSORY");
    submitted.searchParams.set("enhancementOption::starforceMin", "0");
    submitted.searchParams.set(
      "enhancementOption::potentialFilters::optionRows",
      "allStatsPercent\u001f21"
    );
    submitted.searchParams.set("priceSearchKey", "opaque-accessory-all-stat");
    assert.equal(isSubmittedFilterSearchUrl(submitted, query), true);
  });

  await test("미트라 궁수 공격력 21%는 현 사이트 physicalAttackPercent URL과 일치", () => {
    const item = getCatalogItem("미트라의 분노 : 궁수");
    const attackQueries = expandCatalogQueries({ item_ids: [item.id] })
      .filter((query) => query.potential_filter?.minimum === 21);
    assert.equal(attackQueries.length, 1);
    assert.equal(attackQueries[0].potential_filter.auction_code, "physicalAttackPercent");
    assert.equal(POTENTIAL_FILTER_CAPABILITIES.ATTACK_PCT.evidence_status, "observed");

    const observed = new URL("https://auction.maplestory.nexon.com/price");
    observed.searchParams.set("searchTab", "condition");
    observed.searchParams.set("keyword", "미트라의 분노 : 궁수");
    observed.searchParams.set("isExactMatch", "true");
    observed.searchParams.set("page", "1");
    observed.searchParams.set("limit", "20");
    observed.searchParams.set("sortType", "TRADE_DATE_DESC");
    observed.searchParams.set("itemCategory", "ARMOR");
    observed.searchParams.set("enhancementOption::starforceMin", "0");
    observed.searchParams.set(
      "enhancementOption::potentialFilters::optionRows",
      "physicalAttackPercent\u001f21"
    );
    observed.searchParams.set("priceSearchKey", "opaque-filter-session");
    assert.equal(isSubmittedFilterSearchUrl(observed, {
      keyword: "미트라의 분노 : 궁수",
      page_limit: 60,
      starforce_min: null,
      starforce_max: null,
      server_filter: { code: "physicalAttackPercent", minimum: 21 }
    }), true);
  });

  await test("필터 검색 결과 URL은 priceSearchKey와 요청 조건이 모두 맞을 때만 재사용", () => {
    const query = {
      keyword: "에테르넬 나이트아머",
      starforce_min: 19,
      starforce_max: 21,
      server_filter: { code: "strPercent", minimum: 23 }
    };
    const filteredUrl = new URL("https://auction.maplestory.nexon.com/price");
    filteredUrl.searchParams.set("searchTab", "condition");
    filteredUrl.searchParams.set("keyword", query.keyword);
    filteredUrl.searchParams.set("isExactMatch", "true");
    filteredUrl.searchParams.set("page", "7");
    filteredUrl.searchParams.set("limit", "40");
    filteredUrl.searchParams.set("sortType", "TRADE_DATE_DESC");
    filteredUrl.searchParams.set("enhancementOption::starforceMin", "19");
    filteredUrl.searchParams.set("enhancementOption::starforceMax", "21");
    filteredUrl.searchParams.set(
      "enhancementOption::potentialFilters::optionRows",
      "strPercent\u001f23"
    );
    filteredUrl.searchParams.set("priceSearchKey", "opaque-filter-session");

    assert.equal(isReusableFilterSearchUrl(filteredUrl, query), true);

    const withoutKey = new URL(filteredUrl);
    withoutKey.searchParams.delete("priceSearchKey");
    assert.equal(isReusableFilterSearchUrl(withoutKey, query), false);

    const emptyKey = new URL(filteredUrl);
    emptyKey.searchParams.set("priceSearchKey", "");
    assert.equal(isReusableFilterSearchUrl(emptyKey, query), false);

    const wrongFilter = new URL(filteredUrl);
    wrongFilter.searchParams.set("enhancementOption::starforceMin", "18");
    assert.equal(isReusableFilterSearchUrl(wrongFilter, query), false);

    const approximateName = new URL(filteredUrl);
    approximateName.searchParams.set("isExactMatch", "false");
    assert.equal(isReusableFilterSearchUrl(approximateName, query), false);

    const wrongSort = new URL(filteredUrl);
    wrongSort.searchParams.set("sortType", "PRICE_ASC");
    assert.equal(isReusableFilterSearchUrl(wrongSort, query), false);
    assert.equal(isSubmittedFilterSearchUrl(wrongSort, query), true);
    assert.equal(
      buildFilterContinuationUrl(wrongSort, query, { page: 1, limit: 60 }).searchParams.get("sortType"),
      "TRADE_DATE_DESC"
    );

    const wrongKeyword = new URL(filteredUrl);
    wrongKeyword.searchParams.set("keyword", "에테르넬 메이지로브");
    assert.equal(isReusableFilterSearchUrl(wrongKeyword, query), false);
  });

  await test("정확 0성 검색은 사이트가 최대 0을 URL에서 생략해도 같은 조건", () => {
    const query = {
      keyword: "마이스터링",
      starforce_min: 0,
      starforce_max: 0,
      server_filter: null
    };
    const observed = new URL("https://auction.maplestory.nexon.com/price");
    observed.searchParams.set("searchTab", "condition");
    observed.searchParams.set("keyword", query.keyword);
    observed.searchParams.set("isExactMatch", "true");
    observed.searchParams.set("page", "1");
    observed.searchParams.set("limit", "60");
    observed.searchParams.set("sortType", "TRADE_DATE_DESC");
    observed.searchParams.set("itemCategory", "ARMOR");
    observed.searchParams.set("enhancementOption::starforceMin", "0");
    observed.searchParams.set("priceSearchKey", "opaque-filter-session");
    assert.equal(isSubmittedFilterSearchUrl(observed, query), true);
    assert.equal(isReusableFilterSearchUrl(observed, query), true);
  });

  await test("필터 검색 후속 페이지는 세션 키·조건을 보존하고 page·limit만 변경", () => {
    const query = {
      keyword: "마이스터링",
      starforce_min: 18,
      starforce_max: 22,
      server_filter: { code: "intPercent", minimum: 21 }
    };
    const filteredUrl = new URL("https://auction.maplestory.nexon.com/price");
    filteredUrl.searchParams.set("searchTab", "condition");
    filteredUrl.searchParams.set("keyword", query.keyword);
    filteredUrl.searchParams.set("isExactMatch", "true");
    filteredUrl.searchParams.set("page", "1");
    filteredUrl.searchParams.set("limit", "60");
    filteredUrl.searchParams.set("sortType", "TRADE_DATE_DESC");
    filteredUrl.searchParams.set("onlyCurrentWorld", "true");
    filteredUrl.searchParams.set("enhancementOption::starforceMin", "18");
    filteredUrl.searchParams.set("enhancementOption::starforceMax", "22");
    filteredUrl.searchParams.set(
      "enhancementOption::potentialFilters::optionRows",
      "intPercent\u001f21"
    );
    filteredUrl.searchParams.set("priceSearchKey", "opaque-filter-session");

    const continuation = buildFilterContinuationUrl(filteredUrl, query, {
      page: 4,
      limit: 40
    });
    assert.equal(continuation.origin, "https://auction.maplestory.nexon.com");
    assert.equal(continuation.pathname, "/price");
    assert.equal(continuation.searchParams.get("priceSearchKey"), "opaque-filter-session");
    assert.equal(continuation.searchParams.get("keyword"), "마이스터링");
    assert.equal(continuation.searchParams.get("isExactMatch"), "true");
    assert.equal(continuation.searchParams.get("sortType"), "TRADE_DATE_DESC");
    assert.equal(continuation.searchParams.get("onlyCurrentWorld"), "true");
    assert.equal(continuation.searchParams.get("enhancementOption::starforceMin"), "18");
    assert.equal(continuation.searchParams.get("enhancementOption::starforceMax"), "22");
    assert.equal(
      continuation.searchParams.get("enhancementOption::potentialFilters::optionRows"),
      "intPercent\u001f21"
    );
    assert.equal(continuation.searchParams.get("page"), "4");
    assert.equal(continuation.searchParams.get("limit"), "40");

    const missingSession = new URL(filteredUrl);
    missingSession.searchParams.delete("priceSearchKey");
    assert.throws(() => buildFilterContinuationUrl(missingSession, query, { page: 2, limit: 60 }));

    const staleSession = new URL(filteredUrl);
    staleSession.searchParams.set("enhancementOption::potentialFilters::optionRows", "intPercent\u001f30");
    assert.throws(() => buildFilterContinuationUrl(staleSession, query, { page: 2, limit: 60 }));
  });

  await test("신규 검색은 화면 입력, 후속 페이지는 숫자 버튼을 직접 클릭", async () => {
    const managerSource = await readFile(path.join(extensionDirectory, "manager.js"), "utf8");
    const contentSource = await readFile(path.join(extensionDirectory, "content.js"), "utf8");
    assert.equal(managerSource.includes("buildFilterFormEntryUrl"), false);
    assert.equal(managerSource.includes("buildQueryUrl"), false);
    assert.equal(managerSource.includes("MAPLE_AUCTION_OPEN_PRICE_TAB"), true);
    const formStart = contentSource.indexOf("async function prepareFilterSearchForm");
    const formEnd = contentSource.indexOf("const DIAGNOSTIC_EVIDENCE_KEYS", formStart);
    const formSource = contentSource.slice(formStart, formEnd);
    const resetIndex = formSource.indexOf("resetButton.click()");
    const keywordIndex = formSource.indexOf(
      "setFilterKeyword(panel, expectedQuery.keyword, expectedQuery.exact_match !== false)"
    );
    const priceIndex = formSource.indexOf("await setPriceFormValues(panel, expectedQuery)");
    const starforceIndex = formSource.indexOf("await setStarforceFormValues(panel, expectedQuery)");
    const potentialIndex = formSource.indexOf("await setPotentialFormValues(expectedQuery)");
    assert.equal(resetIndex >= 0, true);
    assert.equal(priceIndex >= 0, true);
    assert.equal(formSource.includes("ensurePageSize("), false);
    assert.equal(resetIndex < keywordIndex, true);
    assert.equal(keywordIndex < priceIndex, true);
    assert.equal(priceIndex < starforceIndex, true);
    assert.equal(starforceIndex < potentialIndex, true);
    const searchStart = managerSource.indexOf("async function openAuctionSearch");
    const searchEnd = managerSource.indexOf("async function ensureAuctionPriceTab", searchStart);
    const searchSource = managerSource.slice(searchStart, searchEnd);
    const prepareIndex = searchSource.indexOf("requestFilterSearchPreparation(attemptId, query)");
    const dayGuardIndex = searchSource.indexOf("toKstDateKey()");
    const durableRequestedIndex = searchSource.indexOf("await markRequested()");
    const submitIndex = searchSource.indexOf("requestFilterSearchClick(attemptId, query, quotaDayKey)");
    const freshKeyIndex = searchSource.indexOf("waitForFreshAppliedFilterSearch(query, submission)");
    const resultPageSizeIndex = searchSource.indexOf("requestResultPageSize(attemptId, priceSearchKey, pageLimit)");
    const finalResultIndex = searchSource.indexOf("waitForAppliedFilterSearch(query, submission");
    assert.equal(prepareIndex >= 0, true);
    assert.equal(dayGuardIndex >= 0, true);
    assert.equal(durableRequestedIndex >= 0, true);
    assert.equal(submitIndex >= 0, true);
    assert.equal(prepareIndex < dayGuardIndex, true);
    assert.equal(dayGuardIndex < durableRequestedIndex, true);
    assert.equal(durableRequestedIndex < submitIndex, true);
    assert.equal(submitIndex < freshKeyIndex, true);
    assert.equal(freshKeyIndex < resultPageSizeIndex, true);
    assert.equal(resultPageSizeIndex < finalResultIndex, true);
    const prepareStart = contentSource.indexOf("async function prepareCollectionFilterSearch");
    const clickStart = contentSource.indexOf("async function scheduleFilterSearchClick", prepareStart);
    const clickEnd = contentSource.indexOf("function assertFilterSearchButtonReady", clickStart);
    const prepareSource = contentSource.slice(prepareStart, clickStart);
    const clickSource = contentSource.slice(clickStart, clickEnd);
    assert.equal(prepareStart >= 0 && clickStart > prepareStart && clickEnd > clickStart, true);
    assert.equal((prepareSource.match(/prepareFilterSearchForm\(/gu) || []).length, 1);
    assert.equal(clickSource.includes("prepareFilterSearchForm("), false);
    assert.equal(clickSource.includes("captureState.preparedFilterSearch"), true);
    assert.equal(clickSource.includes("filterFormMatchesExpected(readFilterFormState(preparedPanel, expectedQuery), expectedQuery)"), true);
    assert.equal(clickSource.includes("dispatchFilterSearchButtonClick("), true);
    assert.equal(contentSource.includes("정확히 일치 태그 해제"), true);
    assert.equal(contentSource.includes("exact_match: query.exact_match !== false"), true);
    assert.equal(contentSource.includes("allowed_names: Array.isArray(query.allowed_names)"), true);
    assert.equal(contentSource.includes('expectedQuery.search_scope === "catalog_global"'), true);
    assert.equal(contentSource.includes("filterKeywordMatchesExpected(actual, expectedQuery)"), true);
    assert.equal(contentSource.includes('input[aria-label="최소 가격"]'), true);
    assert.equal(contentSource.includes('input[aria-label="최대 가격"]'), true);
    assert.equal(contentSource.includes("parseMesoFormInteger"), true);
    assert.equal(contentSource.includes("isValidMesoFormInteger"), true);
    assert.equal(contentSource.includes('rawFilters["form::priceMinMeso"]'), true);
    assert.equal(managerSource.includes('query.search_scope === "catalog_global"'), true);
    assert.equal(managerSource.includes("query.search_keyword ?? query.exact_name ?? \"\""), true);
    assert.equal(managerSource.includes("price_min_meso: query.price_min_meso ?? null"), true);
    assert.equal(managerSource.includes("price_min_meso: task.query.price_min_meso ?? null"), true);
    assert.equal(managerSource.includes("describePriceCondition(query.price_min_meso"), true);
    assert.equal(managerSource.includes("taskDisplayName(job.task)"), true);
    assert.equal(managerSource.includes("sourceRowCount === 0"), true);
    assert.equal(managerSource.includes("continuation-fill"), false);
    assert.equal(managerSource.includes("pageJob.page > 1"), true);
    assert.equal(managerSource.includes("buildFilterContinuationUrl"), false);
    assert.equal(managerSource.includes("applyCollectionPaginationPolicy"), true);
    assert.equal(managerSource.includes("result_cap_reached"), true);
    assert.equal(managerSource.includes("page_sweep_complete"), true);
    const executeStart = managerSource.indexOf("async function executeCandidate");
    const executeEnd = managerSource.indexOf("async function prepareCollectedPage", executeStart);
    const executeSource = managerSource.slice(executeStart, executeEnd);
    const pageLoopSource = executeSource.slice(executeSource.indexOf("while (true)"));
    assert.equal((searchSource.match(/requestFilterSearchClick/gu) || []).length, 1);
    assert.equal(pageLoopSource.includes("reserveQueryQuota("), false);
    assert.equal(pageLoopSource.includes("requestFilterSearchClick("), false);
    assert.equal(pageLoopSource.includes("MAPLE_AUCTION_TOOLTIP_NETWORK_FETCH_PAGE"), false);
    assert.equal(pageLoopSource.includes("fetchTooltipNetworkPage("), false);
    assert.equal(pageLoopSource.includes("buildFilterContinuationUrl("), false);
    assert.equal(pageLoopSource.includes("navigateAuctionUrl("), false);
    assert.equal(pageLoopSource.includes("loadResultPageByNumber("), true);
    assert.equal(managerSource.includes('type: "MAPLE_AUCTION_CLICK_RESULT_PAGE_NUMBER"'), true);
    assert.equal(managerSource.includes("state.retries"), true);
    assert.equal(managerSource.includes("state.continuations"), true);
    assert.equal(managerSource.includes('quotaPurpose = job.retry_id'), true);
    assert.equal(managerSource.includes('? "recovery"'), true);
    assert.equal(managerSource.includes('? "normal_overflow" : "normal"'), true);
    assert.equal(managerSource.includes('pool: quotaPurpose === "normal" ? "normal" : "reserve"'), true);
    assert.equal(managerSource.includes("pendingRetryQueryIds.has(task.query.query_id)"), true);
    assert.equal(contentSource.includes("beginCollectionResultTracking(attemptId)"), true);
    assert.equal(contentSource.includes("MAPLE_AUCTION_PREPARE_FILTER_SEARCH"), true);
    assert.equal(contentSource.includes("message.quotaDayKey"), true);
    assert.equal(contentSource.includes("currentKstDateKey()"), true);
    assert.equal(contentSource.includes("result_generation_changed: resultGenerationChanged"), true);
    assert.equal(contentSource.includes("const rowScopeValid = !requiresExactRows || allRowsExact"), true);
    assert.equal(contentSource.includes("row_scope_valid: rowScopeValid"), true);
    assert.equal(contentSource.includes("result_document_token: resultDocumentToken"), true);
    assert.equal(contentSource.includes("searchContext.page === expected.page"), true);
    assert.equal(managerSource.includes("observeResultStability("), true);
    assert.equal(managerSource.includes("새 검색 결과 DOM이 완전히 바뀌고 안정화"), true);
    const failureStart = managerSource.indexOf("async function handleJobFailure");
    const failureEnd = managerSource.indexOf("function enqueueRetry", failureStart);
    const failureSource = managerSource.slice(failureStart, failureEnd);
    assert.equal(failureSource.includes("entry.id !== job.retry_id"), true);
    const recoveryStart = managerSource.indexOf("async function recoverInterruptedJob");
    const recoveryEnd = managerSource.indexOf("async function chooseOutputDirectory", recoveryStart);
    const recoverySource = managerSource.slice(recoveryStart, recoveryEnd);
    assert.equal(recoverySource.indexOf("const obsoleteReason") < recoverySource.indexOf('attempt?.phase === "received"'), true);
    assert.equal(recoverySource.includes("markCaptureDiscardedByAttempt"), true);
  });

  await test("숫자 페이지 이동은 검증된 페이지네이션 버튼 클릭만 사용", async () => {
    const managerSource = await readFile(path.join(extensionDirectory, "manager.js"), "utf8");
    const contentSource = await readFile(path.join(extensionDirectory, "content.js"), "utf8");

    assert.equal(contentSource.includes('message?.type === "MAPLE_AUCTION_CLICK_RESULT_PAGE_NUMBER"'), true);
    const selectorStart = contentSource.indexOf("function visiblePaginationRoots");
    const selectorEnd = contentSource.indexOf("function resultPageMatchesClickTarget", selectorStart);
    const selectorSource = contentSource.slice(selectorStart, selectorEnd);
    assert.equal(selectorStart >= 0 && selectorEnd > selectorStart, true);
    assert.equal(selectorSource.includes(".pagination-conatiner, .pagination-container"), true);
    assert.equal(selectorSource.includes('/^\\d+$/u.test(cleanText(button.textContent) || "")'), true);
    assert.equal(selectorSource.includes("roots.length !== 1"), true);
    assert.equal(selectorSource.includes("selectedSignals.size !== 1"), true);
    assert.equal(selectorSource.includes("ancestor.contains(heading) && containsResult"), true);
    assert.equal(selectorSource.includes("state.selectedPage !== currentPage"), true);
    assert.equal(selectorSource.includes("targets.length !== 1"), true);
    assert.equal(selectorSource.includes('target.getAttribute("aria-disabled") === "true"'), true);

    const clickStart = contentSource.indexOf("async function clickResultPageNumber");
    const clickEnd = contentSource.indexOf("function findStarforceInputs", clickStart);
    const clickSource = contentSource.slice(clickStart, clickEnd);
    const selectIndex = clickSource.indexOf("requireNumericPaginationButton(currentPage, targetPage)");
    const trackIndex = clickSource.indexOf("beginCollectionResultTracking(options.attemptId)");
    const clickIndex = clickSource.indexOf("targetButton.click()");
    assert.equal(clickStart >= 0 && clickEnd > clickStart, true);
    assert.equal(selectIndex >= 0 && selectIndex < trackIndex && trackIndex < clickIndex, true);
    assert.equal(clickSource.includes("resultSearchContextMatchesExpected"), true);
    assert.equal(clickSource.includes("expectedPriceSearchKey"), true);
    assert.equal(clickSource.includes("summaryBefore.displayed_page_limit !== expectedLimit"), true);
    assert.equal(clickSource.includes("!Number.isInteger(options.expectedSearchUsed)"), true);
    assert.equal(clickSource.includes("!Number.isInteger(expectedSearchLimit)"), true);
    assert.equal(clickSource.includes("!Number.isInteger(usageBefore?.used)"), true);
    assert.equal(clickSource.includes("!Number.isInteger(usageBefore?.limit)"), true);
    assert.equal(clickSource.includes("!Number.isInteger(summaryAfter.site_search_usage?.used)"), true);
    assert.equal(clickSource.includes("!Number.isInteger(summaryAfter.site_search_usage?.limit)"), true);
    assert.equal(clickSource.includes("숫자 페이지 이동 중 경매장 검색 횟수가 변했습니다."), true);
    for (const forbidden of ["fetch(", "XMLHttpRequest", "location.href =", "history.pushState", "history.replaceState"]) {
      assert.equal(clickSource.includes(forbidden), false, forbidden);
    }

    const loadStart = managerSource.indexOf("async function loadResultPageByNumber");
    const loadEnd = managerSource.indexOf("async function requestResultPageClick", loadStart);
    const loadSource = managerSource.slice(loadStart, loadEnd);
    const managerClickIndex = loadSource.indexOf("await requestResultPageClick(");
    const appliedIndex = loadSource.indexOf("await waitForAppliedFilterSearch(");
    const domIndex = loadSource.indexOf("await waitForAuctionItems(");
    const networkIndex = loadSource.indexOf("await waitForTooltipNetworkPage(");
    assert.equal(loadStart >= 0 && loadEnd > loadStart, true);
    assert.equal(
      managerClickIndex >= 0 && managerClickIndex < appliedIndex &&
        appliedIndex < domIndex && domIndex < networkIndex,
      true
    );
    for (const forbidden of [
      "MAPLE_AUCTION_TOOLTIP_NETWORK_FETCH_PAGE",
      "fetchTooltipNetworkPage(",
      "buildFilterContinuationUrl(",
      "navigateAuctionUrl("
    ]) {
      assert.equal(loadSource.includes(forbidden), false, forbidden);
    }
  });

  await test("필터 검색 10초 간격은 일반 수집·진단에만 적용", async () => {
    const managerSource = await readFile(path.join(extensionDirectory, "manager.js"), "utf8");
    const helperStart = managerSource.indexOf("async function waitForFilterSearchDispatchWindow");
    const openStart = managerSource.indexOf("async function openAuctionSearch", helperStart);
    const openEnd = managerSource.indexOf("async function ensureAuctionPriceTab", openStart);
    const helperSource = managerSource.slice(helperStart, openStart);
    const openSource = managerSource.slice(openStart, openEnd);
    assert.equal(helperStart >= 0 && openStart > helperStart && openEnd > openStart, true);
    assert.equal(helperSource.includes("filterSearchDelayRemaining("), true);
    assert.equal(helperSource.includes("FILTER_SEARCH_MIN_INTERVAL_MS"), true);
    assert.equal(helperSource.includes("filter_search_dispatch_pending_at"), true);
    assert.equal(helperSource.includes("last_filter_search_dispatch_at"), true);
    assert.equal(helperSource.includes("await saveCollectorState(collectorState)"), true);
    assert.equal(openSource.includes("dispatchFilterSearchWithInterval({"), true);
    assert.equal(openSource.includes("dispatch: () => requestFilterSearchClick("), true);
    assert.equal(
      openSource.indexOf("await requestFilterSearchPreparation(") <
        openSource.indexOf("dispatchFilterSearchWithInterval({"),
      true
    );

    const diagnosticStart = managerSource.indexOf("async function runFilterDiagnosticOnce");
    const diagnosticEnd = managerSource.indexOf("function addDiagnosticStep", diagnosticStart);
    const diagnosticSource = managerSource.slice(diagnosticStart, diagnosticEnd);
    assert.equal(diagnosticSource.includes("dispatchFilterSearchWithInterval({"), true);

    const pageStart = managerSource.indexOf("async function loadResultPageByNumber");
    const pageEnd = managerSource.indexOf("async function requestResultPageClick", pageStart);
    const pageSource = managerSource.slice(pageStart, pageEnd);
    assert.equal(pageSource.includes("dispatchFilterSearchWithInterval("), false);
    assert.equal(pageSource.includes("FILTER_SEARCH_MIN_INTERVAL_MS"), false);
  });

  await test("모든 구조화 응답 페이지를 같은 페이지의 DOM과 대조", async () => {
    const managerSource = await readFile(path.join(extensionDirectory, "manager.js"), "utf8");
    const executeStart = managerSource.indexOf("async function executeCandidate");
    const executeEnd = managerSource.indexOf("async function waitForTooltipNetworkPage", executeStart);
    const executeSource = managerSource.slice(executeStart, executeEnd);

    const firstBuildStart = executeSource.indexOf("pageResponse = buildTooltipNetworkListResponse(");
    const firstBuildEnd = executeSource.indexOf("appendLog(", firstBuildStart);
    const firstBuildSource = executeSource.slice(firstBuildStart, firstBuildEnd);
    assert.equal(firstBuildStart >= 0 && firstBuildEnd > firstBuildStart, true);
    assert.equal(firstBuildSource.includes("firstPageJob"), true);
    assert.equal(firstBuildSource.includes("domPageResponse"), true);

    const loadStart = managerSource.indexOf("async function loadResultPageByNumber");
    const loadEnd = managerSource.indexOf("async function requestResultPageClick", loadStart);
    const loadSource = managerSource.slice(loadStart, loadEnd);
    const laterBuildStart = loadSource.indexOf("pageResponse: buildTooltipNetworkListResponse(");
    const laterBuildEnd = loadSource.indexOf("),", laterBuildStart);
    const laterBuildSource = loadSource.slice(laterBuildStart, laterBuildEnd);
    assert.equal(laterBuildStart >= 0 && laterBuildEnd > laterBuildStart, true);
    assert.equal(laterBuildSource.includes("pageJob"), true);
    assert.equal(laterBuildSource.includes("domPageResponse"), true);

    const buildStart = managerSource.indexOf("function buildTooltipNetworkListResponse");
    const buildEnd = managerSource.indexOf("function validateTooltipNetworkPageAgainstDom", buildStart);
    const buildSource = managerSource.slice(buildStart, buildEnd);
    assert.equal(buildStart >= 0 && buildEnd > buildStart, true);
    assert.equal(buildSource.includes("if (domResponse)"), true);
    assert.equal(buildSource.includes("validateTooltipNetworkPageAgainstDom(capture, domResponse)"), true);
    assert.equal(buildSource.includes("job.page === 1"), false);

    const compareStart = buildEnd;
    const compareEnd = managerSource.indexOf("async function prepareCollectedPage", compareStart);
    const compareSource = managerSource.slice(compareStart, compareEnd);
    assert.equal(compareSource.includes("domPage !== capture.page"), true);
    assert.equal(compareSource.includes("apiItems.length !== domItems.length"), true);
    assert.equal(compareSource.includes("apiName !== domName"), true);
    assert.equal(compareSource.includes("apiPrice !== domPrice"), true);
    assert.equal(compareSource.includes("첫 페이지"), false);
  });

  await test("중간 페이지 실패와 재시도는 페이지·누적 pagination을 보존", async () => {
    const managerSource = await readFile(path.join(extensionDirectory, "manager.js"), "utf8");

    const executeStart = managerSource.indexOf("async function executeCandidate");
    const executeEnd = managerSource.indexOf("async function loadResultPageByNumber", executeStart);
    const executeSource = managerSource.slice(executeStart, executeEnd);
    const failedJobIndex = executeSource.indexOf("const failedJob = collectorState.active_job?.attempt_id === attemptId");
    const failureCallIndex = executeSource.indexOf(
      "handleJobFailure(collectorState, failedJob, attemptId, error, requestStarted)"
    );
    assert.equal(failedJobIndex >= 0 && failedJobIndex < failureCallIndex, true);

    const enqueueStart = managerSource.indexOf("function enqueueRetry");
    const enqueueEnd = managerSource.indexOf("function deferPhysicalQueryUntilNextDay", enqueueStart);
    const enqueueSource = managerSource.slice(enqueueStart, enqueueEnd);
    assert.equal(enqueueSource.includes("job.page"), true);
    assert.equal(enqueueSource.includes("${page}:${retryCount}"), true);
    assert.equal(enqueueSource.includes("...(job.pagination || {})"), true);
    assert.equal(enqueueSource.includes("current_page: page"), true);
    assert.equal(enqueueSource.includes("page: 1"), false);

    const schedulerStart = managerSource.indexOf("function buildSchedulerCandidates");
    const schedulerEnd = managerSource.indexOf("function candidateToJob", schedulerStart);
    const schedulerSource = managerSource.slice(schedulerStart, schedulerEnd);
    assert.equal(schedulerSource.includes("entry.page >= 1"), true);
    assert.equal(schedulerSource.includes("Number(entry.page) === 1"), false);

    const candidateStart = schedulerEnd;
    const candidateEnd = managerSource.indexOf("function buildFixedTasks", candidateStart);
    const candidateSource = managerSource.slice(candidateStart, candidateEnd);
    assert.equal(candidateSource.includes("candidate.page"), true);
    assert.equal(candidateSource.includes("...(candidate.pagination || {})"), true);
    assert.equal(candidateSource.includes("current_page: page"), true);
    const retryBranchEnd = candidateSource.indexOf("const underlyingTask = candidate");
    assert.equal(candidateSource.slice(0, retryBranchEnd).includes("page: 1"), false);

    const migrationStart = managerSource.indexOf("function discardObsoleteCollectorWork");
    const migrationEnd = managerSource.indexOf("function stableTaskId", migrationStart);
    const migrationSource = managerSource.slice(migrationStart, migrationEnd);
    assert.equal(migrationSource.includes("Number(entry.page) !== 1"), false);
    assert.equal(migrationSource.includes("currentTask.id !== entry.task?.id"), true);
    assert.equal(migrationSource.includes('resume_restart_reason: "catalog_query_updated"'), true);
    assert.equal(migrationSource.includes("pagination: createPaginationState({ current_page: 1 })"), true);
    assert.equal(migrationSource.includes("id: `retry:${sweepId}:1:${retryCount}`"), true);

    const resumeGuardIndex = executeSource.indexOf("if (pageJob.page > 1)");
    const resumeClickIndex = executeSource.indexOf("loadResultPageByNumber({", resumeGuardIndex);
    const resumeCurrentPageIndex = executeSource.indexOf("currentPage: 1", resumeClickIndex);
    assert.equal(
      resumeGuardIndex >= 0 && resumeGuardIndex < resumeClickIndex &&
        resumeClickIndex < resumeCurrentPageIndex,
      true
    );
    assert.equal(executeSource.includes("continuationAnchor?.page === requestedResumePage - 1"), true);
    assert.equal(executeSource.includes("createStructuredPageSignature("), true);
    assert.equal(executeSource.includes("page: continuationAnchor.page"), true);
    assert.equal(executeSource.includes("firstPageSummary.total_results === 0"), true);
    assert.equal(executeSource.includes('resumeRestartReason = "page_range_changed"'), true);
    assert.equal(executeSource.includes('resume_restart_reason: resumeRestartReason || "snapshot_changed"'), true);
    assert.equal(executeSource.includes("currentPage: currentResumePage"), true);

    const recoveryStart = managerSource.indexOf("async function recoverInterruptedJob");
    const recoveryEnd = managerSource.indexOf("async function chooseOutputDirectory", recoveryStart);
    const recoverySource = managerSource.slice(recoveryStart, recoveryEnd);
    assert.equal(recoverySource.includes("deferRetryCheckpointUntilNextDay"), true);
    const deferredStart = managerSource.indexOf("function deferRetryCheckpointUntilNextDay");
    const deferredEnd = managerSource.indexOf("function buildSchedulerCandidates", deferredStart);
    const deferredSource = managerSource.slice(deferredStart, deferredEnd);
    assert.equal(deferredSource.includes("...(job.pagination || entry.pagination || {})"), true);
    assert.equal(deferredSource.includes("resume_restart_reason:"), true);
    assert.equal(candidateSource.includes("resume_restart_reason:"), true);
    assert.equal(schedulerSource.includes("entry.next_eligible_date || null"), true);
  });

  await test("구조화 응답 조회는 캐시 전용이며 직접 API 복구 경로가 없음", async () => {
    const contentSource = await readFile(path.join(extensionDirectory, "content.js"), "utf8");
    const hookSource = await readFile(path.join(extensionDirectory, "tooltip-network-hook.js"), "utf8");
    assert.equal(contentSource.includes("MAPLE_AUCTION_TOOLTIP_NETWORK_FETCH_PAGE"), false);
    assert.equal(contentSource.includes('handleTooltipNetworkRuntimeRequest("fetch_page"'), false);
    assert.equal(hookSource.includes("async function fetchResultPage"), false);
    assert.equal(hookSource.includes("async function recoverObservedPage"), false);
    const getPageStart = hookSource.indexOf('if (action === "get_page")');
    const getPageEnd = hookSource.indexOf('if (action === "clear")', getPageStart);
    const getPageSource = hookSource.slice(getPageStart, getPageEnd);
    assert.equal(getPageStart >= 0 && getPageEnd > getPageStart, true);
    assert.equal(getPageSource.includes("matchingCapture("), true);
    assert.equal(getPageSource.includes("fetch("), false);
    assert.equal(getPageSource.includes("Reflect.apply"), false);
  });

  await test("새 검색 결과 DOM은 세대 변경과 안정 구간을 모두 확인해야 통과", () => {
    const base = {
      attempt_matches: true,
      fresh_price_search_key: true,
      result_context_matches: true,
      result_generation_changed: true,
      result_heading_visible: true,
      result_ready: true,
      result_busy: false,
      requires_exact_rows: true,
      row_scope_valid: true,
      all_rows_exact: true,
      result_signature: "dom-v1:2:aaaa1111",
      document_replaced: false,
      last_result_mutation_age_ms: 800
    };
    let state = createResultStabilityState();

    let observed = observeResultStability(state, {
      ...base,
      result_generation_changed: false
    }, 1_000, 700);
    assert.equal(observed.ready, false, "새 URL만으로 이전 DOM을 승인하면 안 됨");

    observed = observeResultStability(observed.state, base, 1_100, 700);
    state = observed.state;
    assert.equal(observed.ready, false, "첫 DOM 관측만으로 승인하면 안 됨");

    observed = observeResultStability(state, {
      ...base,
      result_signature: "dom-v1:1:bbbb2222"
    }, 1_500, 700);
    state = observed.state;
    assert.equal(observed.ready, false, "부분 렌더링으로 서명이 바뀌면 안정 시간을 다시 재야 함");

    observed = observeResultStability(state, {
      ...base,
      result_signature: "dom-v1:1:bbbb2222"
    }, 2_250, 700);
    assert.equal(observed.ready, true);
    assert.equal(observed.stable_poll_count, 2);
    assert.equal(observed.stable_for_ms, 750);

    observed = observeResultStability(observed.state, {
      ...base,
      result_signature: "dom-v1:1:bbbb2222",
      result_busy: true
    }, 2_500, 700);
    assert.equal(observed.ready, false, "로딩 표시가 다시 나타나면 안정 상태를 폐기해야 함");
  });

  await test("광역·장비군 검색은 완전 일치 행이 아니어도 안정화하고 정확 검색은 불일치를 거부", () => {
    const broadSearch = {
      attempt_matches: true,
      fresh_price_search_key: true,
      result_context_matches: true,
      result_generation_changed: true,
      result_heading_visible: true,
      result_ready: true,
      result_busy: false,
      requires_exact_rows: false,
      row_scope_valid: true,
      all_rows_exact: false,
      result_signature: "dom-v1:60:broad111",
      document_replaced: false,
      last_result_mutation_age_ms: 900
    };
    let broadState = createResultStabilityState();
    let observed = observeResultStability(broadState, broadSearch, 1_000, 700);
    broadState = observed.state;
    assert.equal(observed.ready, false, "광역 검색도 첫 관측만으로 승인하면 안 됨");
    observed = observeResultStability(broadState, broadSearch, 1_750, 700);
    assert.equal(observed.ready, true, "전체 장비와 장비군 검색은 안정된 비정확 행을 허용해야 함");

    const exactMismatch = {
      ...broadSearch,
      requires_exact_rows: true,
      row_scope_valid: false,
      result_signature: "dom-v1:1:wrong222"
    };
    let exactState = createResultStabilityState();
    observed = observeResultStability(exactState, exactMismatch, 2_000, 700);
    exactState = observed.state;
    observed = observeResultStability(exactState, exactMismatch, 2_800, 700);
    assert.equal(observed.ready, false, "정확 장비명 검색의 불일치 행은 계속 거부해야 함");

    const contradictoryExact = {
      ...exactMismatch,
      row_scope_valid: true
    };
    let contradictoryState = createResultStabilityState();
    observed = observeResultStability(contradictoryState, contradictoryExact, 3_000, 700);
    contradictoryState = observed.state;
    observed = observeResultStability(contradictoryState, contradictoryExact, 3_800, 700);
    assert.equal(observed.ready, false, "정확 검색 계약이 상충하면 fail-closed로 거부해야 함");

    const missingScopeMode = { ...broadSearch };
    delete missingScopeMode.requires_exact_rows;
    let missingModeState = createResultStabilityState();
    observed = observeResultStability(missingModeState, missingScopeMode, 4_000, 700);
    missingModeState = observed.state;
    observed = observeResultStability(missingModeState, missingScopeMode, 4_800, 700);
    assert.equal(observed.ready, false, "행 범위 검증 방식이 누락된 결과는 승인하면 안 됨");
  });

  await test("필터 진단 고정 조건은 거대한 공포·제한 없음·올스탯 복수형 15", () => {
    assert.deepEqual(FILTER_DIAGNOSTIC_QUERY, {
      keyword: "거대한 공포",
      page_limit: 60,
      starforce_min: null,
      starforce_max: null,
      server_filter: { code: "allStatsPercent", minimum: 15 }
    });
    assert.equal(JSON.stringify(FILTER_DIAGNOSTIC_QUERY).includes("allStatPercent\""), false);
  });

  await test("필터 진단 단계는 중복 없이 고정 순서로 병합", () => {
    assert.deepEqual(FILTER_DIAGNOSTIC_STAGE_ORDER, [
      "price_tab",
      "panel_discovery",
      "reset",
      "exact_keyword",
      "starforce",
      "potential",
      "final_form_verified",
      "submit",
      "fresh_key",
      "page_size",
      "result_ready"
    ]);
    const steps = mergeDiagnosticSteps([
      { name: "reset", ok: true, elapsed_ms: 20, evidence: { reset_completed: true } },
      { name: "page_size", ok: true, elapsed_ms: 15, evidence: {
        page_size_control_found: true,
        observed_page_limit: 60,
        page_size_changed: true
      } },
      { name: "price_tab", ok: true, elapsed_ms: 10, evidence: { already_open: true } }
    ], [
      { name: "reset", ok: false, elapsed_ms: 30, error_code: "reset_failed" },
      { name: "submit", ok: true, elapsed_ms: 5, evidence: { click_dispatched: true } }
    ]);
    assert.deepEqual(steps.map((step) => step.name), ["price_tab", "reset", "submit", "page_size"]);
    assert.equal(steps.find((step) => step.name === "reset").ok, false);
    assert.equal(steps.find((step) => step.name === "page_size").evidence.observed_page_limit, 60);
    assert.equal(steps.find((step) => step.name === "submit").evidence.click_dispatched, true);
  });

  await test("복사 가능한 진단 결과에는 URL·검색 키·UUID·DOM 정보가 없음", () => {
    const secretKey = "d0f24355-74e6-441a-8b4d-724fb0bd3190";
    const exported = buildDiagnosticExport({
      extension_version: "0.6.14",
      outcome: "failed",
      started_at: "2026-09-02T00:00:00.000Z",
      finished_at: "2026-09-02T00:00:01.000Z",
      search_usage: { before: { used: 54, limit: 100 }, after: { used: 55, limit: 100 } },
      steps: [{
        name: "fresh_key",
        ok: false,
        elapsed_ms: 50,
        evidence: {
          key_was_present: true,
          key_changed: false,
          previous_url: `https://auction.maplestory.nexon.com/price?priceSearchKey=${secretKey}`,
          innerHTML: "<div>secret</div>"
        },
        error_code: "fresh_key_failed"
      }],
      failure: {
        stage: "fresh_key",
        code: "fresh_key_failed",
        message: `https://auction.maplestory.nexon.com/price?priceSearchKey=${secretKey}`
      }
    });
    const text = JSON.stringify(exported);
    assert.equal(diagnosticExportContainsSensitiveData(exported), false);
    assert.equal(text.includes(secretKey), false);
    assert.equal(text.includes("https://auction.maplestory.nexon.com/price?"), false);
    assert.equal(text.includes("previous_url"), false);
    assert.equal(text.includes("innerHTML"), false);
    assert.equal(redactDiagnosticText(`priceSearchKey=${secretKey}`).includes(secretKey), false);
    assert.equal(exported.failure.message, diagnosticFailureMessage("fresh_key_failed"));
    assert.deepEqual(
      sanitizeDiagnosticEvidence({ observed_potential_code: "unknown:<div>DOM text</div>" }),
      { observed_potential_code: "unknown" }
    );
  });

  await test("진단은 준비·제출을 분리하고 수집 저장 경로를 호출하지 않음", async () => {
    const managerSource = await readFile(path.join(extensionDirectory, "manager.js"), "utf8");
    const contentSource = await readFile(path.join(extensionDirectory, "content.js"), "utf8");
    const htmlSource = await readFile(path.join(extensionDirectory, "manager.html"), "utf8");
    const runStart = managerSource.indexOf("async function runFilterDiagnosticOnce");
    const runEnd = managerSource.indexOf("async function startOrResumeCollection", runStart);
    const runSource = managerSource.slice(runStart, runEnd);
    const prepareIndex = runSource.indexOf("MAPLE_AUCTION_DIAGNOSTIC_PREPARE_ONCE");
    const submitIndex = runSource.indexOf("MAPLE_AUCTION_DIAGNOSTIC_SUBMIT_ONCE");
    const freshResultIndex = runSource.indexOf("await waitForFreshAppliedFilterSearch");
    const pageSizeIndex = runSource.indexOf("await requestResultPageSize(");
    const finalAppliedIndex = runSource.indexOf("await waitForAppliedFilterSearch(");
    const resultIndex = runSource.indexOf("MAPLE_AUCTION_DIAGNOSTIC_READ_RESULT");
    const leaseIndex = runSource.indexOf("await acquireLease()");
    const priceTabIndex = runSource.indexOf("await ensureAuctionPriceTab");
    const usageIndex = runSource.indexOf("beforeUsage = await readSiteSearchUsageFromAuction()");
    const abortIndex = runSource.indexOf("await abortAuctionDiagnostic(activeDiagnosticId)");
    const cleanupIndex = runSource.indexOf("await cleanupAuctionPage()", abortIndex);
    const releaseIndex = runSource.indexOf("await releaseOwnedLeaseAndSave(collectorState)", cleanupIndex);
    assert.equal(prepareIndex >= 0, true);
    assert.equal(leaseIndex >= 0 && leaseIndex < prepareIndex, true);
    assert.equal(priceTabIndex >= 0 && priceTabIndex < usageIndex, true);
    assert.equal(prepareIndex < submitIndex, true);
    assert.equal(submitIndex < freshResultIndex, true);
    assert.equal(freshResultIndex < pageSizeIndex, true);
    assert.equal(pageSizeIndex < finalAppliedIndex, true);
    assert.equal(finalAppliedIndex < resultIndex, true);
    assert.equal(abortIndex >= 0 && abortIndex < cleanupIndex && cleanupIndex < releaseIndex, true);
    for (const forbidden of ["reserveQueryQuota(", "collectPage(", "prepareCaptureRecord(", "commitPageAndState(", "flushCaptureRecord("]) {
      assert.equal(runSource.includes(forbidden), false, forbidden);
    }
    assert.equal(contentSource.includes("MAPLE_AUCTION_DIAGNOSTIC_PREPARE_ONCE"), true);
    assert.equal(contentSource.includes("MAPLE_AUCTION_DIAGNOSTIC_SUBMIT_ONCE"), true);
    assert.equal(contentSource.includes("MAPLE_AUCTION_DIAGNOSTIC_ABORT"), true);
    assert.equal(contentSource.includes("click_scheduled: true"), true);
    assert.equal(contentSource.includes("resultMutationObserved"), true);
    assert.equal(contentSource.includes('filter(({ text }) => /^\\d+개씩\\s*보기$/u.test(text))'), true);
    assert.equal(contentSource.includes('normalizeUiLabel(element.textContent) === "잠재능력합산"'), true);
    assert.equal(contentSource.includes("filterFormMatchesExpected(readFilterFormState(panel, expectedQuery), expectedQuery)"), true);
    assert.equal(runSource.includes("buildFilterContinuationUrl(appliedUrl"), false);
    assert.equal(contentSource.includes("MAPLE_AUCTION_ENSURE_RESULT_PAGE_SIZE"), true);
    assert.equal(contentSource.includes("async function ensureResultPageSize"), true);
    const clickStart = contentSource.indexOf("async function dispatchFilterSearchButtonClick");
    const clickEnd = contentSource.indexOf("async function prepareFilterSearchForm", clickStart);
    const clickSource = contentSource.slice(clickStart, clickEnd);
    const finalFormIndex = clickSource.indexOf("filterFormMatchesExpected(readFilterFormState(panel, expectedQuery), expectedQuery)");
    const actualClickIndex = clickSource.indexOf("liveButton.click()");
    assert.equal(clickSource.includes("ensurePageSize("), false);
    assert.equal(finalFormIndex >= 0 && finalFormIndex < actualClickIndex, true);
    assert.equal(clickSource.includes("clickDispatched"), true);
    assert.equal(clickSource.includes("click_dispatched: true"), true);
    assert.equal(contentSource.includes("scheduleFilterSearchButtonClick"), false);
    assert.equal(contentSource.includes("scheduleDiagnosticFilterClick"), false);
    const prepareFormStart = contentSource.indexOf("async function prepareFilterSearchForm");
    const prepareFormEnd = contentSource.indexOf("const DIAGNOSTIC_EVIDENCE_KEYS", prepareFormStart);
    const prepareFormSource = contentSource.slice(prepareFormStart, prepareFormEnd);
    const resetStart = prepareFormSource.indexOf('measuredDiagnosticStep(diagnosticSteps, "reset"');
    const resetEnd = prepareFormSource.indexOf('measuredDiagnosticStep(diagnosticSteps, "exact_keyword"', resetStart);
    const resetSource = prepareFormSource.slice(resetStart, resetEnd);
    assert.equal(resetStart >= 0 && resetEnd > resetStart, true);
    assert.equal(resetSource.includes("findPriceInputs(latestPanel)"), true);
    assert.equal(resetSource.includes("findStarforceInputs(latestPanel)"), true);
    assert.equal(resetSource.includes("findPotentialControls(latestPanel)"), true);
    assert.equal(resetSource.includes("unexpectedFilterSelections(latestPanel).length === 0"), true);
    assert.equal(resetSource.includes("Date.now() - stableSince >= 200"), true);
    assert.equal(resetSource.includes("}, 4_000)"), true);
    assert.equal(resetSource.includes("readPotentialFilterRows("), false);
    assert.equal(resetSource.includes("filterPanelHasNoResidualFilters("), false);
    assert.equal(resetSource.includes("residual.join"), true);
    const defaultChoiceStart = contentSource.indexOf("function isDefaultFilterChoice");
    const defaultChoiceEnd = contentSource.indexOf("function readPotentialFilterRows", defaultChoiceStart);
    const normalizeLabelStart = contentSource.indexOf("function normalizeUiLabel");
    const normalizeLabelEnd = contentSource.indexOf("function parseFormInteger", normalizeLabelStart);
    const defaultChoiceSource = contentSource.slice(defaultChoiceStart, defaultChoiceEnd);
    const normalizeLabelSource = contentSource.slice(normalizeLabelStart, normalizeLabelEnd);
    assert.equal(defaultChoiceStart >= 0 && defaultChoiceEnd > defaultChoiceStart, true);
    assert.equal(normalizeLabelStart >= 0 && normalizeLabelEnd > normalizeLabelStart, true);
    const isDefaultChoice = new Function(
      `${normalizeLabelSource}\n${defaultChoiceSource}\nreturn isDefaultFilterChoice;`
    )();
    for (const value of ["", "전체", "선택 안 함", "선택안함", "없음", "미선택", "제한 없음", "선택\u00a0안 함"]) {
      assert.equal(isDefaultChoice(value), true, value || "빈 문자열");
    }
    for (const value of ["아이템 획득 확률 증가", "메소 획득량 증가", "공격력 %증가"]) {
      assert.equal(isDefaultChoice(value), false, value);
    }
    for (const residualLabel of ["에디셔널 잠재능력", "추가 옵션", "주문서 강화"]) {
      assert.equal(contentSource.includes(residualLabel), true, residualLabel);
    }
    assert.equal(runSource.includes("synchronizeSiteUsage(collectorState, usageToPersist)"), true);
    assert.equal(runSource.includes("result.result_generation_changed === true"), true);
    assert.equal(runSource.includes("result.current_page === 1"), true);
    assert.equal(runSource.includes("result.latest_sale_sort === true"), true);
    assert.equal(runSource.includes("diagnosticExportContainsSensitiveData(exported)"), true);
    assert.equal(runSource.includes("if (lastResult) return lastResult"), false);
    assert.equal(runSource.includes("if (lastResult) error.diagnosticResult = lastResult"), true);
    assert.equal(runSource.includes('const rowsKnown = Number.isInteger(evidence.row_count)'), true);
    assert.equal(managerSource.includes("await mirrorCheckpoint(collectorState).catch(() => {})"), true);
    assert.equal(htmlSource.includes('id="diagnosticButton"'), true);
    assert.equal(htmlSource.includes('id="copyDiagnosticButton"'), true);
  });

  await test("경매장 상단 검색 횟수를 실행 전 동기화", async () => {
    const managerSource = await readFile(path.join(extensionDirectory, "manager.js"), "utf8");
    const contentSource = await readFile(path.join(extensionDirectory, "content.js"), "utf8");
    const htmlSource = await readFile(path.join(extensionDirectory, "manager.html"), "utf8");
    assert.equal(contentSource.includes("MAPLE_AUCTION_READ_SEARCH_USAGE"), true);
    assert.equal(contentSource.includes("검색\\s*횟수"), true);
    assert.equal(managerSource.includes("await refreshSiteSearchUsage()"), true);
    assert.equal(managerSource.includes("검색 횟수가 100 / 100"), true);
    assert.equal(managerSource.includes("confirmStableSiteSearchUsage"), true);
    assert.equal(managerSource.includes("rebaseQuotaSession(collectorState"), true);
    assert.equal(managerSource.includes('quota_purpose: quotaPurpose'), true);
    assert.equal(managerSource.includes("allow_normal_overflow: allowNormalOverflow"), true);
    assert.equal(managerSource.includes("displayedQuota.reserve_recovery_reserved"), true);
    assert.equal(managerSource.includes("(복구 ${recoveryUsed} · 추가 ${borrowedForNormal})"), true);
    assert.equal(htmlSource.includes('id="accountSyncButton"'), true);
  });

  await test("시세 탭 클릭 실패 시 공식 시세 경로로 이동", async () => {
    const managerSource = await readFile(path.join(extensionDirectory, "manager.js"), "utf8");
    const contentSource = await readFile(path.join(extensionDirectory, "content.js"), "utf8");
    const start = managerSource.indexOf("async function ensureAuctionPriceTab");
    const end = managerSource.indexOf("async function requestFilterSearchClick", start);
    const source = managerSource.slice(start, end);
    assert.equal(source.includes("MAPLE_AUCTION_OPEN_PRICE_TAB"), true);
    assert.equal(source.includes('const fallbackUrl = new URL("/price", latestTab.url)'), true);
    assert.equal(source.includes("if (!AUCTION_URL_PATTERN.test(latestTab.url || \"\"))"), true);
    assert.equal(source.includes("await navigateAuctionUrl(fallbackUrl)"), true);
    assert.equal(source.includes("PRICE_TAB_CLICK_TIMEOUT_MS"), true);
    assert.equal(contentSource.includes("'button, [role=\"tab\"], [role=\"link\"]'"), true);
  });

  await test("종료된 관리자 창의 고아 실행 잠금을 자동 복구", async () => {
    const managerSource = await readFile(path.join(extensionDirectory, "manager.js"), "utf8");
    const popupSource = await readFile(path.join(extensionDirectory, "popup.js"), "utf8");
    const initialization = managerSource.slice(
      managerSource.indexOf("async function initialize()"),
      managerSource.indexOf("function renderCatalog()")
    );
    assert.equal(initialization.indexOf("await acquireLease()") < initialization.indexOf("await recoverInterruptedJob(collectorState)"), true);
    assert.equal(initialization.indexOf("await acquireLease()") < initialization.indexOf("await refreshSiteSearchUsage()"), true);
    assert.equal(initialization.includes("await releaseOwnedLeaseAndSave(collectorState)"), true);
    assert.equal(managerSource.includes("collectorState = await recoverOrphanedForeignLease("), true);
    assert.equal(managerSource.includes("manager_window_id: managerWindowId"), true);
    assert.equal(managerSource.includes('chrome.runtime.getContexts({ contextTypes: ["TAB"] })'), true);
    assert.equal(managerSource.includes("leaseIdentityMatches(latestRaw.lease, orphan)"), true);
    assert.equal(managerSource.includes("scheduleForeignLeaseRefresh()"), true);
    assert.equal(managerSource.includes("이전 관리자 창의 실행 잠금이 해제되었습니다."), true);
    assert.equal(managerSource.includes("async function releaseOwnedLeaseAndSave"), true);
    assert.equal(managerSource.includes("ownsActiveLease(latest?.lease, expectedLeaseId)"), true);
    assert.equal(managerSource.includes("if (ownsActiveLease(collectorState?.lease))"), true);
    assert.equal(popupSource.includes("findExistingManagerContext"), true);
    assert.equal(popupSource.includes("await chrome.windows.update(existingManager.windowId"), true);
  });

  await test("수집 상태 저장은 획득별 lease token CAS와 heartbeat로 보호", async () => {
    const managerSource = await readFile(path.join(extensionDirectory, "manager.js"), "utf8");
    const acquireSource = managerSource.slice(
      managerSource.indexOf("async function acquireLease()"),
      managerSource.indexOf("async function recoverOrphanedForeignLease")
    );
    const persistenceSource = managerSource.slice(
      managerSource.indexOf("async function saveCollectorState"),
      managerSource.indexOf("async function mirrorCheckpoint(",
        managerSource.indexOf("async function saveCollectorState"))
    );
    assert.equal(acquireSource.includes("const leaseId = crypto.randomUUID()"), true);
    assert.equal(acquireSource.includes("lease_id: leaseId"), true);
    assert.equal(managerSource.includes("LEASE_HEARTBEAT_INTERVAL_MS"), true);
    assert.equal(managerSource.includes("async function renewOwnedLeaseCas"), true);
    assert.equal(managerSource.includes("scheduleLeaseHeartbeat()"), true);
    assert.equal(persistenceSource.includes("persistOwnedStateCas(state)"), true);
    assert.equal(persistenceSource.includes("ownsActiveLease(latest?.lease, expectedLeaseId)"), true);
    assert.equal(managerSource.includes("persistOwnedStateCas(nextState, { pageRecord })"), true);
    assert.equal(managerSource.includes("pageRecord: { ...pageRecord, file_status: \"received\" }"), true);
  });

  await test("진행도 초기화는 순회 상태만 지우고 원본·일일 한도 근거를 보존", () => {
    const now = "2026-09-02T01:00:00.000Z";
    let state = createCollectorState(now);
    state = reserveQueryQuota(state, {
      attempt_id: "completed-before-reset",
      lane: "baseline",
      pool: "normal",
      now
    }).state;
    state = advanceAttemptPhase(state, "completed-before-reset", "requested", now);
    state = advanceAttemptPhase(state, "completed-before-reset", "received", now);
    state = advanceAttemptPhase(state, "completed-before-reset", "committed", now);
    state = {
      ...state,
      catalog_version: "test-catalog",
      active_job: { attempt_id: "old-active", job: { task: { id: "old-task" } } },
      retries: [{ id: "old-retry", retry: true }],
      query_stats: { "old-task": { completed: true, observations: 60 } },
      watermarks: { "old-task": { page: 2 } },
      run_status: "paused",
      last_error: "old failure",
      done: true,
      stop_reason: "all_tasks_complete",
      filter_audits: { ALL_STAT_PCT: { auction_code: "allStatsPercent" } },
      totals: { pages: 159, observations: 9234, failures: 7 },
      site_search_usage: { used: 76, limit: 100, day_key: "2026-09-02" },
      page_limit_calibration: {
        requested_limit: 60,
        effective_limit: 60,
        status: "confirmed_60",
        reason: "requested_count_observed",
        calibrated_at: now
      },
      lease: {
        lease_id: "lease-token",
        owner: "manager",
        extension_version: "0.7.6",
        expires_at: "2026-09-02T02:00:00.000Z"
      }
    };
    const before = structuredClone(state);
    const reset = resetCollectorProgress(state, now);

    assert.deepEqual(state, before);
    assert.equal(reset.active_job, null);
    assert.deepEqual(reset.retries, []);
    assert.deepEqual(reset.query_stats, {});
    assert.deepEqual(reset.watermarks, {});
    assert.equal(reset.run_status, "idle");
    assert.equal(reset.last_error, null);
    assert.equal(reset.done, false);
    assert.equal(reset.stop_reason, null);
    assert.deepEqual(reset.lane_usage, {
      normal: createLaneUsage(),
      reserve: createLaneUsage()
    });
    assert.deepEqual(reset.totals, { pages: 159, observations: 9234, failures: 0 });
    assert.equal(reset.last_recovery_at, null);
    for (const field of [
      "quota", "quota_session", "attempts", "page_limit_calibration",
      "filter_audits", "site_search_usage", "lease"
    ]) {
      assert.deepEqual(reset[field], before[field], field);
    }
  });

  await test("전체 네트워크 진단은 tool-tip 요청을 식별하되 계정·검색 키를 제거", () => {
    const privateSearchKey = "42b2ed2d-dbcf-43f9-9add-f5b1d2fcda53";
    const accountId = "46314640";
    const characterId = "51852377";
    const event = sanitizeNetworkRequestEvent({
      url: `https://api.mskr.nexon.com/v1/market/web/items/searches/sold/${privateSearchKey}/tool-tip?accountId=${accountId}&page=1&limit=60&sortType=TRADE_DATE_DESC&characterId=${characterId}`,
      method: "GET",
      type: "xmlhttprequest",
      statusCode: 304,
      fromCache: false,
      frameId: 0,
      timeStamp: Date.parse("2026-09-02T01:02:03.000Z")
    }, "completed");
    assert.deepEqual(event, {
      occurred_at: "2026-09-02T01:02:03.000Z",
      phase: "completed",
      method: "GET",
      resource_type: "xmlhttprequest",
      path: "/v1/market/web/items/searches/sold/:search-key/tool-tip",
      endpoint: "sold_tooltip",
      page: 1,
      limit: 60,
      sort: "TRADE_DATE_DESC",
      status_code: 304,
      from_cache: false,
      frame_scope: "top",
      error: null
    });
    assert.equal(sanitizeNetworkRequestEvent({
      url: "https://example.com/v1/market/web/items/searches/sold/key/tool-tip"
    }), null);
    const hiddenGenericPath = sanitizeNetworkRequestEvent({
      url: "https://auction.maplestory.nexon.com/v1/market/web/items/private-listing-token:1/detail?accountId=12345678",
      method: "GET",
      type: "fetch",
      statusCode: 200,
      frameId: 0
    });
    assert.equal(hiddenGenericPath.path, "/v1/:endpoint");
    assert.equal(JSON.stringify(hiddenGenericPath).includes("private-listing-token"), false);
    const hiddenError = sanitizeNetworkRequestEvent({
      url: "https://auction.maplestory.nexon.com/v1/private",
      method: "GET",
      type: "fetch",
      frameId: -1,
      error: "account 12345678 failed"
    }, "error");
    assert.equal(hiddenError.error, "request_failed");
    assert.equal(hiddenError.frame_scope, "unbound");
    assert.equal(JSON.stringify(hiddenError).includes("12345678"), false);

    const report = buildNetworkDiagnosticReport({
      extension_version: "0.7.6",
      session_id: "network-1725240000000-deadbeef",
      started_at: "2026-09-02T01:02:00.000Z",
      finished_at: null,
      expires_at: "2026-09-02T01:07:00.000Z",
      active: true,
      dropped_events: 0,
      events: [event]
    }, {
      installed: true,
      fetch_hook_active: true,
      xhr_hook_active: true,
      performance_recovery_available: true,
      observed_tooltip_request_count: 1,
      cache_size: 1,
      current_session_token: "private-session-token",
      latest_capture: {
        captured_at: "2026-09-02T01:02:04.000Z",
        transport: "fetch",
        page: 1,
        limit: 60,
        sort: "TRADE_DATE_DESC",
        session_token: "private-session-token"
      },
      latest_observed: {
        page: 1,
        limit: 60,
        sort: "TRADE_DATE_DESC",
        current_search: true,
        recovery_attempted: false,
        url: `https://auction.maplestory.nexon.com/private?accountId=${accountId}`
      }
    });
    assert.deepEqual(report.summary, {
      total_requests: 1,
      tooltip_requests: 1,
      failed_requests: 0,
      redirects: 0,
      paths: { "/v1/market/web/items/searches/sold/:search-key/tool-tip": 1 },
      resource_types: { xmlhttprequest: 1 },
      statuses: { "304": 1 }
    });
    assert.equal(report.page_hook.current_session_token, undefined);
    assert.equal(report.page_hook.latest_observed.url, undefined);
    assert.equal(networkDiagnosticExportContainsSensitiveData(report), false);
    assert.equal(diagnoseNetworkDiagnosticReport(report).level, "success");
    const serialized = JSON.stringify(report);
    for (const secret of [privateSearchKey, accountId, characterId, "private-session-token", "https://"]) {
      assert.equal(serialized.includes(secret), false, secret);
    }
    assert.match(formatNetworkDiagnosticEvent(report.events[0]), /304.+xmlhttprequest.+:search-key.+1페이지.+60개/u);

    const aborted = {
      ...event,
      phase: "error",
      status_code: null,
      error: "net::ERR_ABORTED"
    };
    const mixedReport = buildNetworkDiagnosticReport({
      ...report,
      events: [aborted, { ...event, phase: "redirect", status_code: 302 }, event]
    }, report.page_hook);
    assert.equal(mixedReport.summary.total_requests, 2);
    assert.equal(mixedReport.summary.redirects, 1);
    assert.equal(diagnoseNetworkDiagnosticReport(mixedReport).level, "warning");

    const mismatchedCapture = buildNetworkDiagnosticReport(report, {
      ...report.page_hook,
      latest_capture: { ...report.page_hook.latest_capture, page: 2 }
    });
    assert.equal(diagnoseNetworkDiagnosticReport(mismatchedCapture).level, "error");
    assert.match(diagnoseNetworkDiagnosticReport(mismatchedCapture).text, /같은 페이지·개수·정렬/u);
  });

  await test("네트워크 진단 서비스 워커와 진행도 초기화 UI가 확장에 연결됨", async () => {
    const manifest = JSON.parse(await readFile(path.join(extensionDirectory, "manifest.json"), "utf8"));
    const managerSource = await readFile(path.join(extensionDirectory, "manager.js"), "utf8");
    const workerSource = await readFile(path.join(extensionDirectory, "network-diagnostic-worker.js"), "utf8");
    const htmlSource = await readFile(path.join(extensionDirectory, "manager.html"), "utf8");

    assert.equal(manifest.permissions.includes("webRequest"), true);
    assert.equal(manifest.host_permissions.includes("https://api.mskr.nexon.com/*"), true);
    assert.deepEqual(manifest.background, {
      service_worker: "network-diagnostic-worker.js",
      type: "module"
    });
    assert.equal(workerSource.includes("chrome.webRequest.onCompleted.addListener"), true);
    assert.equal(workerSource.includes("chrome.webRequest.onErrorOccurred.addListener"), true);
    assert.equal(workerSource.includes("chrome.webRequest.onBeforeRedirect.addListener"), true);
    assert.equal(workerSource.includes('"https://api.mskr.nexon.com/*"'), true);
    assert.equal(workerSource.includes("chrome.tabs.onRemoved.addListener"), true);
    assert.equal(workerSource.includes("messageTargetsSession(message, session)"), true);
    assert.equal(workerSource.includes("await assertAuctionTab(tabId)"), true);
    assert.equal(workerSource.includes("requestHeaders"), false);
    assert.equal(workerSource.includes("responseHeaders"), false);
    assert.equal(workerSource.includes("requestBody"), false);
    assert.equal(managerSource.includes("MAPLE_NETWORK_DIAGNOSTIC_START"), true);
    assert.equal(managerSource.includes("tab_id: sourceTabId"), true);
    assert.equal(managerSource.includes("buildNetworkDiagnosticReport(report, pageHook)"), true);
    assert.equal(managerSource.includes("networkDiagnosticTransition"), true);
    assert.equal(managerSource.includes("elements.copyNetworkDiagnosticButton.disabled = extensionContextInvalidated || !report"), true);
    assert.equal(managerSource.includes("await recoverInterruptedJob(collectorState)"), true);
    assert.equal(managerSource.includes("const nextState = resetCollectorProgress(collectorState)"), true);
    assert.equal(htmlSource.includes('id="networkDiagnosticButton"'), true);
    assert.equal(htmlSource.includes('id="copyNetworkDiagnosticButton"'), true);
    assert.equal(htmlSource.includes('id="resetCollectionProgressButton"'), true);
    assert.equal(htmlSource.includes('aria-controls="networkDiagnosticDetails" disabled'), true);
    assert.equal(htmlSource.includes('id="networkDiagnosticLog" class="diagnostic-log network-diagnostic-log" aria-live='), false);

    const resetStart = managerSource.indexOf("async function resetCollectionProgressFromButton");
    const resetEnd = managerSource.indexOf("async function writeTextToClipboard", resetStart);
    const resetSource = managerSource.slice(resetStart, resetEnd);
    const recoverIndex = resetSource.indexOf("collectorState = await recoverInterruptedJob(collectorState)");
    const resetIndex = resetSource.indexOf("const nextState = resetCollectorProgress(collectorState)");
    const persistIndex = resetSource.indexOf("const persistedState = await persistOwnedStateCas(nextState)");
    const assignIndex = resetSource.indexOf("collectorState = persistedState");
    assert.equal(recoverIndex >= 0 && recoverIndex < resetIndex, true);
    assert.equal(resetIndex < persistIndex && persistIndex < assignIndex, true);
    for (const forbidden of ["PAGE_STORE", "deleteDatabase", "clear()", "removeEntry", "raw/"]) {
      assert.equal(resetSource.includes(forbidden), false, forbidden);
    }
  });

  await test("다음 수집에서 보류된 실패 작업을 선택적으로 재시도", async () => {
    const managerSource = await readFile(path.join(extensionDirectory, "manager.js"), "utf8");
    const htmlSource = await readFile(path.join(extensionDirectory, "manager.html"), "utf8");
    const cssSource = await readFile(path.join(extensionDirectory, "manager.css"), "utf8");

    assert.equal(htmlSource.includes('id="includeFailedTasksCheckbox"'), true);
    assert.equal(htmlSource.includes('id="deferredFailureCount"'), true);
    assert.match(htmlSource, /실패한 작업 모두 포함/u);
    assert.match(htmlSource, /빈 결과 대기는 유지/u);
    assert.equal(cssSource.includes(".run-option"), true);

    assert.equal(managerSource.includes(
      "const includeDeferredFailures = elements.includeFailedTasksCheckbox.checked"
    ), true);
    assert.equal(managerSource.includes(
      "forcedFailureQueryIdsForRun = includeDeferredFailures"
    ), true);
    assert.equal(managerSource.includes(
      "forced_failure_query_ids: forcedFailureQueryIdsForRun"
    ), true);
    assert.equal(managerSource.includes(
      "forcedFailureQueryIdsForRun.delete(job.task.query.query_id)"
    ), true);
    assert.equal(managerSource.includes("if (candidate.failure_recheck === true)"), false);
    assert.equal(managerSource.includes('next_eligible_reason: "failure"'), true);
    assert.equal(managerSource.includes("inferNextEligibleReason(stats) === \"failure\""), true);
    assert.equal(managerSource.includes("inferNextEligibleReason(entry) === \"failure\""), true);
    assert.equal(managerSource.includes("const eligibilityStats = emptyFirstPage"), true);
    assert.equal(managerSource.includes("? previousStats\n      : clearEmptyBackoff(previousStats)"), true);
    const startSource = managerSource.slice(
      managerSource.indexOf("async function startOrResumeCollection"),
      managerSource.indexOf("async function runCollectorLoop")
    );
    assert.equal(
      startSource.indexOf("const includeDeferredFailures") <
        startSource.indexOf("await ensureDirectoryWritePermission"),
      true
    );
    assert.equal(startSource.includes("forcedFailureQueryIdsForRun = new Set()"), true);
    assert.equal(startSource.includes("elements.includeFailedTasksCheckbox.checked = false"), true);
    assert.equal(managerSource.includes("빈 결과 재확인 대기 ${progress.deferred}"), false);
  });

  return {
    passed: results.length - failures.length,
    failed: failures.length,
    results,
    sample: {
      path: samplePath,
      sha256: expectedSampleHash,
      records: records.length,
      normalized_records: normalized.length
    }
  };
}

const argv = globalThis.process?.argv || [];
if (argv[1] && path.resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runTests();
  console.log(JSON.stringify(report, null, 2));
  if (report.failed > 0) {
    process.exitCode = 1;
  }
}
