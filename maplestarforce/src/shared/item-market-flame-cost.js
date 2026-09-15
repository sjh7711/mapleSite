import {
  ADD_OPTION_TABLES_SNAPSHOT,
  calculateArmorAddOption,
} from "maple-core/add-option";
import { STAT_EQUIVALENCE } from "maple-core/potential";
import { extractCanonicalMarketTrainingFeatures } from "./item-market-estimator.js";

const STORAGE_KEY = "maplestarforce:add-option:v2";
const MAN = 10_000;
const STANDARD_ALL_STAT_GRADE =
  STAT_EQUIVALENCE.allStatPercentToMainPercent /
  STAT_EQUIVALENCE.flatMainStatToPercent;

const BOSS_FLAME_SET_PATTERN =
  /(?:보스|에테르넬|아케인셰이드|앱솔랩스|루타비스)/u;
const BOSS_FLAME_ITEM_PATTERN =
  /^(?:에테르넬|아케인셰이드|앱솔랩스|하이네스|이글아이|트릭스터)/u;

function itemBody(value) {
  return value?.item && typeof value.item === "object" ? value.item : value || {};
}

function nonnegative(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function hasPositiveValue(bucket) {
  return Object.values(bucket && typeof bucket === "object" ? bucket : {})
    .some((value) => nonnegative(value) > 0);
}

function readStoredObject(storage, key) {
  try {
    const value = storage?.getItem?.(key);
    const parsed = value ? JSON.parse(value) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

/** 추가옵션 계산기에서 저장한 환불 시세만 가져온다. */
export function loadItemMarketFlameSettings({ storage = globalThis.localStorage } = {}) {
  const stored = readStoredObject(storage, STORAGE_KEY);
  return {
    abyssPrice: nonnegative(stored.abyssPrice),
    strongPrice: nonnegative(stored.strongPrice),
  };
}

function resolvedSettings(settings, storage) {
  const saved = loadItemMarketFlameSettings({ storage });
  return {
    abyssPrice: nonnegative(settings?.abyssPrice ?? saved.abyssPrice),
    strongPrice: nonnegative(settings?.strongPrice ?? saved.strongPrice),
  };
}

function flameAdvantage(item) {
  for (const value of [
    item.flame_advantaged,
    item.boss_flame,
    item.add_option_boss,
  ]) {
    if (typeof value === "boolean") {
      return { value, evidence: value ? "보스 추가옵션 명시" : "일반 추가옵션 명시" };
    }
  }
  const setName = String(item.set_name || "");
  if (BOSS_FLAME_SET_PATTERN.test(setName)) {
    return { value: true, evidence: `${setName} 장비` };
  }
  const itemName = String(item.name || "");
  if (BOSS_FLAME_ITEM_PATTERN.test(itemName)) {
    return { value: true, evidence: `${itemName} 장비군` };
  }
  if (/^마이스터/u.test(itemName) || /^마이스터/u.test(setName)) {
    return { value: false, evidence: "마이스터 장비" };
  }
  return null;
}

function familyProfile(family) {
  const standard = (mainStat, subStats, attackType) => ({
    mainStat,
    subStats,
    attackType,
    weights: {
      STR: mainStat === "STR" ? 1 : subStats.includes("STR") ? 0.25 : 0,
      DEX: mainStat === "DEX" ? 1 : subStats.includes("DEX") ? 0.25 : 0,
      INT: mainStat === "INT" ? 1 : subStats.includes("INT") ? 0.25 : 0,
      LUK: mainStat === "LUK" ? 1 : subStats.includes("LUK") ? 0.25 : 0,
      HP: 0,
      attack: STAT_EQUIVALENCE.attackToMainStat,
      allStat: STANDARD_ALL_STAT_GRADE,
    },
  });
  if (family === "INT") return standard("INT", ["LUK"], "magic");
  if (family === "DEX") return standard("DEX", ["STR"], "attack");
  if (family === "LUK") return standard("LUK", ["DEX", "STR"], "attack");
  if (family === "XENON") {
    return {
      mainStat: "ALL",
      subStats: [],
      attackType: "attack",
      weights: {
        STR: 1,
        DEX: 1,
        INT: 0,
        LUK: 1,
        HP: 0,
        attack: 5.5,
        allStat: 18,
      },
    };
  }
  if (family === "HP") {
    return {
      mainStat: "HP",
      subStats: ["STR"],
      attackType: "attack",
      weights: {
        STR: 0.25,
        DEX: 0,
        INT: 0,
        LUK: 0,
        HP: 1 / 35,
        attack: 4,
        allStat: 0,
      },
    };
  }
  return standard("STR", ["DEX"], "attack");
}

function sectionHasPercentStat(section, stat) {
  return Array.isArray(section?.lines) && section.lines.some((line) =>
    String(line?.code || "").toUpperCase() === stat &&
    String(line?.unit || "") === "pct" &&
    nonnegative(line?.value) > 0
  );
}

function resolvedFamily(target, item, bucket) {
  const family = extractCanonicalMarketTrainingFeatures(target)
    .training_profile_family || "STR";
  /* 공격력은 데몬어벤져 환산에서 비중이 크지만, HP가 하나도 없는 전사
     장비까지 공격력만으로 HP 장비라고 뒤집으면 STR 추옵을 잡옵 처리한다. */
  if (
    family === "HP" &&
    nonnegative(bucket?.hp_flat) <= 0 &&
    !sectionHasPercentStat(item.potential, "HP") &&
    !sectionHasPercentStat(item.additional_potential, "HP")
  ) {
    return "STR";
  }
  return family;
}

function directEquivalence(profile) {
  return {
    model: profile.mainStat === "ALL"
      ? "xenon"
      : profile.mainStat === "HP"
        ? "demon-avenger"
        : "standard",
    flatStatToDamagePercent: {
      STR: profile.weights.STR,
      DEX: profile.weights.DEX,
      INT: profile.weights.INT,
      LUK: profile.weights.LUK,
      HP: profile.weights.HP,
    },
    flatAttackToDamagePercent: profile.weights.attack,
    allStatPercentToDamagePercent: profile.weights.allStat,
    bossDamageToDamagePercent: 1,
    targetToDamagePercent: 1,
  };
}

function usefulFlameGrade(bucket, profile) {
  const attackKey = profile.attackType === "magic"
    ? "magic_attack_flat"
    : "attack_flat";
  return ["STR", "DEX", "INT", "LUK", "HP"].reduce(
    (sum, stat) => sum +
      nonnegative(bucket?.[`${stat.toLowerCase()}_flat`]) * profile.weights[stat],
    0,
  ) +
    nonnegative(bucket?.all_stat_pct) * profile.weights.allStat +
    nonnegative(bucket?.[attackKey]) * profile.weights.attack;
}

function sourceCost(source, settings) {
  if (Number.isFinite(source?.expectedMeso) && source.expectedMeso > 0) {
    return source.expectedMeso;
  }
  const eachPriceMan = source?.key === "abyss"
    ? settings.abyssPrice
    : source?.key === "strong"
      ? settings.strongPrice
      : 0;
  return eachPriceMan > 0 && Number.isFinite(source?.expectedAttempts)
    ? source.expectedAttempts * eachPriceMan * MAN
    : null;
}

function unavailable(basis, extra = {}) {
  return {
    status: "unavailable",
    expected_cost_meso: null,
    basis,
    ...extra,
  };
}

/**
 * 입력된 추가옵션의 유효 환산급 이상을 다시 뽑는 평균 비용을 계산한다.
 * 무기 추옵은 기본 공격력 표가 없어 공·마 수치만으로 1·2추를 안전하게
 * 역산할 수 없으므로 현재는 명시적으로 산출하지 않는다.
 */
export function calculateAutomaticFlameExpectedCost({
  target,
  settings = null,
  storage = globalThis.localStorage,
  tables = ADD_OPTION_TABLES_SNAPSHOT,
} = {}) {
  const item = itemBody(target);
  const bucket = item.stats?.flame || {};
  const levelReduction = nonnegative(item.required_level_reduction);
  if (!hasPositiveValue(bucket) && levelReduction <= 0) {
    return {
      status: "not_applicable",
      expected_cost_meso: null,
      basis: "추가옵션 없음",
      method: "추가옵션 없음",
      confidence: "high",
      evidence: [],
    };
  }
  if (levelReduction > 0) {
    return unavailable(
      "착용 레벨 감소가 포함된 추옵은 기존 추옵 계산기의 목표 급만으로 동일하게 재현할 수 없음",
      {
        method: "착용 레벨 감소 추옵 · 판별 보류",
        confidence: "low",
        evidence: [`착용 레벨 감소 ${levelReduction}`],
      },
    );
  }

  const category = String(item.category || "");
  if (/무기/u.test(category)) {
    return unavailable(
      "기본 공·마 정보가 없어 무기 1·2추 등급을 안전하게 판별할 수 없음",
      {
        method: "무기 추옵 · 판별 보류",
        confidence: "low",
        evidence: ["무기 추옵은 기본 공·마 대비 증가율로 등급을 판별해야 함"],
      },
    );
  }

  const advantage = flameAdvantage(item);
  if (!advantage) {
    return unavailable("보스 추가옵션 적용 장비인지 확인할 수 없음", {
      method: "추가옵션 · 판별 보류",
      confidence: "low",
      evidence: ["장비군 또는 추가옵션 적용 방식 정보 필요"],
    });
  }

  const family = resolvedFamily(target, item, bucket);
  const profile = familyProfile(family);
  const targetGrade = usefulFlameGrade(bucket, profile);
  if (!(targetGrade > 0)) {
    return unavailable(
      "선택된 직업 계열에 유효한 추가옵션 수치가 없음",
      {
        method: "추가옵션 · 유효 환산 불가",
        confidence: "low",
        evidence: [],
        family,
      },
    );
  }

  const itemLevel = Number(item.base_level);
  if (!Number.isInteger(itemLevel) || itemLevel < 0 || itemLevel > 250) {
    return unavailable("장비 레벨을 확인할 수 없음", {
      method: "추가옵션",
      confidence: "low",
      evidence: [],
      family,
    });
  }

  let result;
  try {
    result = calculateArmorAddOption({
      tables,
      itemLevel,
      boss: advantage.value,
      target: targetGrade,
      mainStat: profile.mainStat,
      subStat: profile.subStats[0] || null,
      attackType: profile.attackType,
      statEquivalence: STAT_EQUIVALENCE,
      addOptionEquivalence: directEquivalence(profile),
      targetToDamagePercent: 1,
    });
  } catch (error) {
    return unavailable(error?.message || "추옵 기댓값 계산 불가", {
      method: "추가옵션",
      confidence: "low",
      evidence: [advantage.evidence],
      family,
    });
  }

  const prices = resolvedSettings(settings, storage);
  const candidates = result.sources
    .map((source) => ({
      key: source.key,
      label: source.label,
      expected_attempts: source.expectedAttempts,
      expected_cost_meso: sourceCost(source, prices),
    }))
    .filter((source) => Number.isFinite(source.expected_cost_meso) && source.expected_cost_meso > 0)
    .sort((left, right) => left.expected_cost_meso - right.expected_cost_meso);
  const selected = candidates[0];
  if (!selected) {
    return unavailable("사용 가능한 환불 시세가 없어 비용을 계산할 수 없음", {
      method: "추가옵션",
      confidence: "medium",
      evidence: [advantage.evidence, `${family} 기준 ${targetGrade.toFixed(1)}급 이상`],
      family,
      target_grade: targetGrade,
    });
  }

  return {
    status: "calculated",
    expected_cost_meso: selected.expected_cost_meso,
    basis: `${selected.label} · ${family} 기준 ${targetGrade.toFixed(1)}급 이상`,
    method: "추가옵션 재설정",
    confidence: "medium",
    evidence: [
      advantage.evidence,
      `입력 수치의 유효 환산 ${targetGrade.toFixed(1)}급`,
      "추가옵션 계산기 확률표 사용",
    ],
    family,
    target_grade: targetGrade,
    source: selected.key,
    expected_attempts: selected.expected_attempts,
    candidates,
  };
}
