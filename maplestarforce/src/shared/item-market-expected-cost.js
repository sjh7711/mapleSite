import {
  calculatePotentialExpected,
  getPotentialRankUpInfo,
  getPotentialResetCost,
} from "maple-core/potential";
import {
  STARFORCE_EVENTS,
  STARFORCE_MVP,
  calculateStarforceExpected,
} from "maple-core/starforce";
import { calculateAutomaticFlameExpectedCost } from "./item-market-flame-cost.js";
import { calculateAutomaticScrollExpectedCost } from "./item-market-scroll-cost.js";
import { extractCanonicalMarketTrainingFeatures } from "./item-market-estimator.js";

const GRADE_ORDER = ["rare", "epic", "unique", "legendary"];
const GRADE_LABELS = Object.freeze({ rare: "레어", epic: "에픽", unique: "유니크", legendary: "레전드리" });
const STATS = new Set(["STR", "DEX", "INT", "LUK"]);
const FAMILY_STATS = Object.freeze({
  STR: new Set(["STR"]),
  DEX: new Set(["DEX"]),
  INT: new Set(["INT"]),
  LUK: new Set(["LUK"]),
  XENON: new Set(["STR", "DEX", "LUK"]),
  HP: new Set(["HP"]),
});
const ALWAYS_USEFUL_CODES = new Set([
  "DAMAGE",
  "BOSS_DAMAGE",
  "IGNORE_DEFENSE",
  "CRITICAL_DAMAGE",
  "ITEM_DROP_RATE",
  "MESO_OBTAINED",
  "COOLDOWN_REDUCTION",
  "AUTO_STEAL",
  "AUTO_STEAL_CHANCE",
]);
const TARGET_TYPES = Object.freeze({
  "STR:pct": "str-percent",
  "DEX:pct": "dex-percent",
  "INT:pct": "int-percent",
  "LUK:pct": "luk-percent",
  "ALL_STAT:pct": "all-stat-percent",
  "HP:pct": "hp-percent",
  "ATTACK:pct": "attack-power-percent",
  "MAGIC_ATTACK:pct": "magic-power-percent",
  "DAMAGE:pct": "damage",
  "BOSS_DAMAGE:pct": "boss-damage",
  "IGNORE_DEFENSE:pct": "ignore-defense",
  "CRITICAL_DAMAGE:pct": "critical-damage",
  "ITEM_DROP_RATE:pct": "drop",
  "MESO_OBTAINED:pct": "meso",
  "COOLDOWN_REDUCTION:seconds": "cooldown",
  "AUTO_STEAL:pct": "auto-steal",
  "AUTO_STEAL_CHANCE:pct": "auto-steal",
  "STR:flat": "str-flat",
  "DEX:flat": "dex-flat",
  "INT:flat": "int-flat",
  "LUK:flat": "luk-flat",
  "ALL_STAT:flat": "all-stat-flat",
  "HP:flat": "hp-flat",
  "ATTACK:flat": "attack-power-flat",
  "MAGIC_ATTACK:flat": "magic-power-flat",
});
const POTENTIAL_EXPECTATION_CACHE = new WeakMap();

/** 시세 입력 화면에서 제작 기댓값 계산에 필요한 장비 메타만 보존한다. */
export function buildItemMarketExpectationMetadata(itemMeta = {}) {
  return {
    category: itemMeta.category || null,
    base_level: itemMeta.baseLevel ?? null,
    required_job: itemMeta.requiredJob || null,
    set_name: itemMeta.setName || null,
  };
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positive(value) {
  const number = finite(value);
  return number !== null && number > 0 ? number : null;
}

function itemBody(value) {
  return value?.item && typeof value.item === "object" ? value.item : value || {};
}

function starforceValue(item) {
  const raw = typeof item?.starforce === "object" ? item.starforce.value : item?.starforce;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function expectedAttemptsWithPity(probability, pity) {
  const chance = Number(probability);
  if (!(chance > 0) || chance > 1) return Number.POSITIVE_INFINITY;
  if (!Number.isInteger(Number(pity)) || Number(pity) <= 0) return 1 / chance;
  const limit = Number(pity);
  return -Math.expm1(limit * Math.log1p(-chance)) / chance;
}

function calculated(expectedCostMeso, basis, extra = {}) {
  const cost = positive(expectedCostMeso);
  if (cost === null) return { status: "unavailable", expected_cost_meso: null, basis, ...extra };
  return { status: "calculated", expected_cost_meso: cost, basis, ...extra };
}

function notApplicable(basis, extra = {}) {
  return { status: "not_applicable", expected_cost_meso: null, basis, ...extra };
}

/** 시장 반영액이 제작 기댓값의 몇 %인지 계산한다. */
export function expectedCostRecoveryPercent(contributionMeso, expectedCostMeso) {
  const contribution = finite(contributionMeso);
  const expected = positive(expectedCostMeso);
  if (contribution === null || expected === null) return null;
  return contribution / expected * 100;
}

const SHARED_RECOVERY_GROUPS = Object.freeze([
  Object.freeze({
    key: "potential",
    components: Object.freeze(["potential_grade", "potential_options"]),
  }),
  Object.freeze({
    key: "additional",
    components: Object.freeze(["additional_grade", "additional_options"]),
  }),
]);

/**
 * 등업값과 옵션값을 거래 자료만으로 따로 분리하지 못한 경우에도 둘 중 한쪽에
 * 프리미엄이 몰리지 않게 한다. 모델이 계산한 두 요소의 합은 그대로 보존하고,
 * 각 제작 기댓값 비중으로 나눠 같은 시장 회수율을 적용한다.
 */
export function allocateSharedExpectedCostRecovery(result, expectations) {
  if (result?.status !== "estimated" || !result.components) return result;
  const components = Object.fromEntries(Object.entries(result.components).map(
    ([key, component]) => [key, { ...component }],
  ));
  const allocations = [];

  for (const group of SHARED_RECOVERY_GROUPS) {
    const rows = group.components.map((key) => ({
      key,
      component: components[key],
      expectation: expectations?.[key],
    }));
    if (rows.some(({ component, expectation }) =>
      !component ||
      component.identifiable !== false ||
      expectation?.status !== "calculated" ||
      !(Number(expectation.expected_cost_meso) > 0)
    )) continue;

    const contributionPool = rows.reduce(
      (sum, { component }) => sum + (Number(component.contribution_meso) || 0),
      0,
    );
    const expectedCostPool = rows.reduce(
      (sum, { expectation }) => sum + Number(expectation.expected_cost_meso),
      0,
    );
    if (!(contributionPool > 0) || !(expectedCostPool > 0)) continue;

    let assigned = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const { key, component, expectation } = rows[index];
      const contribution = index === rows.length - 1
        ? Math.round(contributionPool - assigned)
        : Math.round(
            contributionPool * Number(expectation.expected_cost_meso) / expectedCostPool,
          );
      assigned += contribution;
      const score = Math.max(0, Math.min(1, Number(component.confidence_score) || 0));
      const uncertainty = 0.5 + (1 - score) * 0.5;
      components[key] = {
        ...component,
        contribution_meso: contribution,
        range_meso: {
          low: Math.round(Math.max(0, contribution * (1 - uncertainty))),
          high: Math.round(contribution * (1 + uncertainty)),
        },
        market_allocation: {
          method: "shared_expected_cost_recovery",
          group: group.key,
          recovery_percent: contributionPool / expectedCostPool * 100,
        },
      };
    }
    allocations.push({
      group: group.key,
      components: [...group.components],
      contribution_meso: Math.round(contributionPool),
      expected_cost_meso: Math.round(expectedCostPool),
      recovery_percent: contributionPool / expectedCostPool * 100,
    });
  }

  if (!allocations.length) return result;
  return {
    ...result,
    components,
    diagnostics: {
      ...result.diagnostics,
      shared_expected_cost_allocations: allocations,
    },
  };
}

function lineAmount(line) {
  if (line?.code === "STAT_PER_CHARACTER_LEVEL") {
    return positive(line?.params?.stat_value);
  }
  return positive(line?.value);
}

function familyAttackCode(family) {
  return family === "INT" ? "MAGIC_ATTACK" : "ATTACK";
}

/**
 * 장비가 실제로 쓰일 직업 계열에 유효한 잠재만 목표 조건으로 만든다.
 * 공용 장신구의 계열은 전체 옵션 중 가치가 가장 큰 한 계열을 시장 모델이 고른다.
 */
export function buildUsefulPotentialConditions(section, family) {
  const usefulStats = FAMILY_STATS[family] || new Set();
  const attackCode = familyAttackCode(family);
  const totals = new Map();
  const ignored = [];
  const accepted = [];
  const ignoreDefense = [];

  for (const line of Array.isArray(section?.lines) ? section.lines : []) {
    const code = String(line?.code || "UNKNOWN").toUpperCase();
    const unit = line?.unit == null ? null : String(line.unit);
    const amount = lineAmount(line);
    if (amount === null) continue;

    let useful = false;
    let targetType = null;
    if (code === "STAT_PER_CHARACTER_LEVEL") {
      const stat = String(line?.params?.stat_code || "").toUpperCase();
      useful = usefulStats.has(stat);
      targetType = useful ? `${stat.toLowerCase()}-per-nine` : null;
    } else if (STATS.has(code)) {
      useful = usefulStats.has(code);
      targetType = useful ? TARGET_TYPES[`${code}:${unit}`] : null;
    } else if (code === "ALL_STAT") {
      useful = family !== "HP";
      targetType = useful ? TARGET_TYPES[`${code}:${unit}`] : null;
    } else if (code === "HP") {
      useful = family === "HP";
      targetType = useful ? TARGET_TYPES[`${code}:${unit}`] : null;
    } else if (code === "ATTACK" || code === "MAGIC_ATTACK") {
      useful = code === attackCode;
      targetType = useful ? TARGET_TYPES[`${code}:${unit}`] : null;
    } else if (ALWAYS_USEFUL_CODES.has(code)) {
      useful = true;
      targetType = TARGET_TYPES[`${code}:${unit}`] || null;
    }

    if (!useful || !targetType) {
      ignored.push(line);
      continue;
    }
    accepted.push(line);
    if (targetType === "ignore-defense") {
      ignoreDefense.push(Math.min(100, amount));
    } else {
      totals.set(targetType, (totals.get(targetType) || 0) + amount);
    }
  }

  if (ignoreDefense.length) {
    const combined = 100 * (1 - ignoreDefense.reduce(
      (remaining, value) => remaining * (1 - value / 100),
      1,
    ));
    totals.set("ignore-defense", combined);
  }

  return {
    conditions: [...totals.entries()].map(([targetType, target]) => ({ targetType, target })),
    accepted_lines: accepted.length,
    ignored_lines: ignored.length,
  };
}

export function calculatePotentialGradeExpectedCost({
  system,
  grade,
  itemLevel,
  miracle = false,
}) {
  const targetIndex = GRADE_ORDER.indexOf(String(grade));
  if (targetIndex <= 0) {
    return targetIndex === 0
      ? notApplicable("레어는 등업 비용을 별도로 계산하지 않음")
      : notApplicable("잠재능력 없음");
  }
  if (!Number.isFinite(Number(itemLevel)) || Number(itemLevel) <= 0) {
    return { status: "unavailable", expected_cost_meso: null, basis: "장비 레벨 확인 필요" };
  }
  let total = 0;
  for (let index = 0; index < targetIndex; index += 1) {
    const fromGrade = GRADE_ORDER[index];
    const info = getPotentialRankUpInfo({
      system,
      method: "meso",
      grade: fromGrade,
      miracle,
    });
    const resetCost = getPotentialResetCost(itemLevel, fromGrade, system, "meso");
    const attempts = expectedAttemptsWithPity(info.probability, info.pity);
    if (!Number.isFinite(attempts) || !Number.isFinite(resetCost)) {
      return { status: "unavailable", expected_cost_meso: null, basis: "등업 기댓값 계산 불가" };
    }
    total += attempts * resetCost;
  }
  return calculated(
    total,
    `레어부터 ${GRADE_LABELS[grade] || String(grade)}까지 · 메소 재설정${miracle ? " · 미라클 타임" : ""}`,
  );
}

function potentialProfile(family) {
  if (family === "INT") return { mainStat: "INT", subStats: ["LUK"], attackType: "magic" };
  if (family === "DEX") return { mainStat: "DEX", subStats: ["STR"], attackType: "attack" };
  if (family === "LUK") return { mainStat: "LUK", subStats: ["DEX", "STR"], attackType: "attack" };
  if (family === "XENON") return { mainStat: "ALL", subStats: [], attackType: "attack" };
  if (family === "HP") return { mainStat: "HP", subStats: ["STR"], attackType: "attack" };
  return { mainStat: "STR", subStats: ["DEX"], attackType: "attack" };
}

export function calculatePotentialOptionsExpectedCost({
  system,
  section,
  tables,
  itemLevel,
  family,
  characterLevel = 285,
}) {
  if (!section || section.grade === "none") return notApplicable("잠재능력 없음");
  const target = buildUsefulPotentialConditions(section, family);
  if (!target.accepted_lines) {
    return {
      status: target.ignored_lines ? "excluded" : "not_applicable",
      expected_cost_meso: null,
      basis: target.ignored_lines ? "이 장비에 유효한 입력 옵션 없음" : "입력한 옵션 없음",
      ...target,
    };
  }
  if (!Array.isArray(tables) || !tables.length) {
    return {
      status: "unavailable",
      expected_cost_meso: null,
      basis: "공식 옵션 확률표를 불러오지 못함",
      ...target,
    };
  }
  if (!Number.isFinite(Number(itemLevel)) || Number(itemLevel) <= 0) {
    return {
      status: "unavailable",
      expected_cost_meso: null,
      basis: "장비 레벨 확인 필요",
      ...target,
    };
  }
  const cacheKey = JSON.stringify({
    system,
    grade: section.grade,
    itemLevel: Number(itemLevel),
    family,
    characterLevel: Number(characterLevel),
    conditions: target.conditions,
  });
  let tableCache = POTENTIAL_EXPECTATION_CACHE.get(tables);
  if (!tableCache) {
    tableCache = new Map();
    POTENTIAL_EXPECTATION_CACHE.set(tables, tableCache);
  }
  if (tableCache.has(cacheKey)) return tableCache.get(cacheKey);
  const profile = potentialProfile(family);
  try {
    const result = calculatePotentialExpected({
      tables,
      system,
      grade: section.grade,
      resetMethod: "meso",
      itemLevel,
      targetSets: [target.conditions],
      mainStat: profile.mainStat,
      subStats: profile.subStats,
      attackType: profile.attackType,
      characterLevel,
      enemyDefense: 380,
    });
    if (!Number.isFinite(result.expectedCost)) {
      const unavailable = {
        status: "unavailable",
        expected_cost_meso: null,
        basis: "입력한 유효 옵션에 도달할 수 없음",
        probability: result.probability,
        ...target,
      };
      tableCache.set(cacheKey, unavailable);
      return unavailable;
    }
    // 목표 등급으로 올라간 그 큐브 결과에 이미 첫 옵션 3줄이 붙는다.
    // 등업값과 옵션값을 따로 더할 때 같은 첫 결과를 한 번 더 사는 것으로 세지 않는다.
    const additionalOptionCost = Math.max(0, (result.expectedResets - 1) * result.resetCost);
    const output = calculated(
      additionalOptionCost,
      `유효 옵션 ${target.accepted_lines}줄 동시 달성 · 등업 때 받은 첫 결과 제외`,
      { probability: result.probability, ...target },
    );
    tableCache.set(cacheKey, output);
    return output;
  } catch (error) {
    const unavailable = {
      status: "unavailable",
      expected_cost_meso: null,
      basis: error?.message || "옵션 기댓값 계산 불가",
      ...target,
    };
    tableCache.set(cacheKey, unavailable);
    return unavailable;
  }
}

function starforceExpectedCost({ item, settings = {}, singleSpare = false }) {
  const targetStar = starforceValue(item);
  if (targetStar <= 0 || item?.starforce?.applicable === false) {
    return notApplicable("스타포스 없음");
  }
  const itemLevel = Number(item?.base_level);
  const basePrice = positive(item?.base_price_meso);
  if (!Number.isInteger(itemLevel) || itemLevel <= 0) {
    return { status: "unavailable", expected_cost_meso: null, basis: "장비 레벨 확인 필요" };
  }
  if (targetStar >= 15 && basePrice === null) {
    return { status: "unavailable", expected_cost_meso: null, basis: "파괴 복구용 노작값 입력 필요" };
  }
  const event = Object.hasOwn(STARFORCE_EVENTS, settings.event) ? settings.event : "shining";
  const mvp = Object.hasOwn(STARFORCE_MVP, settings.mvp) ? settings.mvp : "diamond";
  try {
    const result = calculateStarforceExpected({
      itemLevel,
      startStar: 0,
      targetStar,
      replacementPrice: basePrice || 0,
      event,
      mvp,
      pc: settings.pc === true,
      optimize: true,
      destroyPrevention: [],
      restore: [],
      singleSpare,
    });
    return calculated(
      result.expectedCost,
      `0→${targetStar}성 · ${STARFORCE_EVENTS[event].label} · ${STARFORCE_MVP[mvp].label}`,
    );
  } catch (error) {
    return { status: "unavailable", expected_cost_meso: null, basis: error?.message || "스타포스 기댓값 계산 불가" };
  }
}

/** 장비 입력을 구성요소별 제작 기댓값으로 변환한다. */
export function calculateItemMarketExpectedCosts({
  target,
  potentialTables = null,
  additionalTables = null,
  starforceSettings = {},
  scrollSettings = null,
  flameSettings = null,
  storage = globalThis.localStorage,
  singleSpare = false,
}) {
  const item = itemBody(target);
  const canonical = extractCanonicalMarketTrainingFeatures(target);
  const family = canonical.training_profile_family || "STR";
  const itemLevel = Number(item.base_level);
  const basePrice = positive(item.base_price_meso);
  const baseBasis = item.base_price_source === "same_item_market_model"
    ? "동일 장비 판매 시세에서 자동 추정"
    : basePrice === null
      ? "노작값 확인 필요"
      : "노작값은 제작비 비교의 기준 가격";
  const potentialGrade = calculatePotentialGradeExpectedCost({
    system: "regular",
    grade: item.potential?.grade || "none",
    itemLevel,
  });
  const additionalGrade = calculatePotentialGradeExpectedCost({
    system: "additional",
    grade: item.additional_potential?.grade || "none",
    itemLevel,
  });
  return {
    family,
    components: {
      base: notApplicable(baseBasis),
      starforce: starforceExpectedCost({ item, settings: starforceSettings, singleSpare }),
      potential_grade: potentialGrade,
      potential_options: calculatePotentialOptionsExpectedCost({
        system: "regular",
        section: item.potential,
        tables: potentialTables,
        itemLevel,
        family,
      }),
      additional_grade: additionalGrade,
      additional_options: calculatePotentialOptionsExpectedCost({
        system: "additional",
        section: item.additional_potential,
        tables: additionalTables,
        itemLevel,
        family,
      }),
      scroll: calculateAutomaticScrollExpectedCost({
        target,
        settings: scrollSettings,
        storage,
      }),
      flame: calculateAutomaticFlameExpectedCost({
        target,
        settings: flameSettings,
        storage,
      }),
      trade: notApplicable("제작비 비교 대상 아님"),
    },
  };
}

export function attachExpectedCostRecovery(components, expectations) {
  return Object.fromEntries(Object.entries(components || {}).map(([key, component]) => {
    const expectation = expectations?.[key] || notApplicable("기댓값 없음");
    return [key, {
      ...component,
      expectation: {
        ...expectation,
        recovery_percent: expectedCostRecoveryPercent(
          component?.contribution_meso,
          expectation.expected_cost_meso,
        ),
      },
    }];
  }));
}
