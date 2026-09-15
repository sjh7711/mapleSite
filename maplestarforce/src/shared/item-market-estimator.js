import {
  STAT_EQUIVALENCE,
  convertPotentialTargetToEquivalents,
  getPotentialRankUpInfo,
  getPotentialResetCost,
} from "maple-core/potential";
import {
  getAllStatFlatMainStat,
  getFlatStatToFlatMainStat,
  getProfileSubStats,
  getStatPercentToMainPercent,
  withStatEquivalenceMaps,
} from "./profile-stat-equivalence.js";
import { normalizeMarketItemName } from "./item-market-data.js";
import {
  deriveAppliedUpgradeCount,
  readUpgradeSlotMaximum,
} from "./item-upgrade-slots.js";

export const ITEM_MARKET_ESTIMATOR_VERSION = "item-market-component-ridge.v14";

const DAY_MS = 86_400_000;
const EPSILON = 1e-12;
const MAX_SAFE_MESO = Number.MAX_SAFE_INTEGER;
const MAX_SAFE_LOG_MESO = Math.log(MAX_SAFE_MESO);
const MAX_UNQUALIFIED_GRADE_FLOOR_RATIO = 1.05;
// 최신 거래에 더 빠르게 반응하되 일시적인 하루 변동에만 끌리지 않도록 한다.
// 아래 30일/정규화 2 조합은 126개 장비·7,418건 시간순 홀드아웃에서 검증했다.
const DEFAULT_HALF_LIFE_DAYS = 30;
// 표본 수에 따라 강하게 커지던 정규화는 고가 옵션 효과를 과도하게 누를 수 있다.
// 고정 2와 30일 가중치 조합이 중앙 오차와 장비별 균형 지표를 함께 개선했다.
const DEFAULT_RIDGE = 2;
const DEFAULT_MAX_RECORDS = 2_000;
const FITTED_MODEL_CACHE = new WeakMap();
const COMPONENT_MAGNITUDE_CACHE = new WeakMap();
const GRADE_RANK = Object.freeze({ none: 0, rare: 1, epic: 2, unique: 3, legendary: 4 });
// 같은 장비의 인접 등급 근거가 부족할 때만 쓰는 보수적 시장 prior다.
// 2026-09-04 판매완료 56,486건에서 검증된 장비별 인접 단계 증가율의
// 10% 분위수를 내려 쓰고, 고가 장비의 전체 가격에 비례해 과대해지지 않게
// 메소 재설정 등업 기댓값의 낮은 회수율로 증분을 제한한다.
const ADDITIONAL_GRADE_STEP_PRIOR = Object.freeze({
  1: { ratio: 0.04, absolute_cap_meso: 200_000_000 },
  2: { ratio: 0.03, expected_cost_cap_ratio: 0.35, from_grade: "rare" },
  3: { ratio: 0.03, expected_cost_cap_ratio: 0.075, from_grade: "epic" },
  4: { ratio: 0.06, expected_cost_cap_ratio: 0.03, from_grade: "unique" },
});

const COMPONENTS = Object.freeze([
  ["base", "노작"],
  ["starforce", "스타포스"],
  ["potential_grade", "윗잠 등업"],
  ["potential_options", "윗잠 옵션"],
  ["additional_grade", "에디셔널 등업"],
  ["additional_options", "에디셔널 옵션"],
  ["scroll", "주문서"],
  ["flame", "추가옵션"],
  ["trade", "거래 상태 보정"],
]);

const FEATURE_DEFINITIONS = Object.freeze([
  { key: "sf_level", component: "starforce", scale: 17 },
  { key: "sf_above_15", component: "starforce", scale: 4 },
  { key: "sf_above_21", component: "starforce", scale: 2 },
  { key: "potential_grade_rare", component: "potential_grade", scale: 1 },
  { key: "potential_grade_epic", component: "potential_grade", scale: 1 },
  { key: "potential_grade_unique", component: "potential_grade", scale: 1 },
  { key: "potential_grade_legendary", component: "potential_grade", scale: 1 },
  { key: "potential_combat", component: "potential_options", scale: 21 },
  { key: "potential_combat_above_21", component: "potential_options", scale: 12 },
  { key: "potential_combat_above_33", component: "potential_options", scale: 12 },
  // 공용 장신구에서 순수 주스탯과 제논용 혼합 스탯을 같은 21%로 보지 않는다.
  // STR을 기준 계열로 두고 나머지 계열의 시장 프리미엄/할인을 별도로 학습한다.
  { key: "potential_family_dex", component: "potential_options", scale: 1, signed: true, magnitude: false },
  { key: "potential_family_int", component: "potential_options", scale: 1, signed: true, magnitude: false },
  { key: "potential_family_luk", component: "potential_options", scale: 1, signed: true, magnitude: false },
  { key: "potential_family_xenon", component: "potential_options", scale: 1, signed: true, magnitude: false },
  { key: "potential_family_hp", component: "potential_options", scale: 1, signed: true, magnitude: false },
  // 등급별 상호작용은 회귀 보정용이며 실제 옵션량을 한 번 더 더한 값은 아니다.
  { key: "potential_unique_combat", component: "potential_options", scale: 21, magnitude: false },
  { key: "potential_legendary_combat", component: "potential_options", scale: 33, magnitude: false },
  { key: "potential_drop", component: "potential_options", scale: 2 },
  { key: "potential_meso", component: "potential_options", scale: 2 },
  { key: "potential_cooldown", component: "potential_options", scale: 2 },
  { key: "potential_auto_steal", component: "potential_options", scale: 3 },
  { key: "potential_hp", component: "potential_options", scale: 12 },
  { key: "additional_grade_rare", component: "additional_grade", scale: 1 },
  { key: "additional_grade_epic", component: "additional_grade", scale: 1 },
  { key: "additional_grade_unique", component: "additional_grade", scale: 1 },
  { key: "additional_grade_legendary", component: "additional_grade", scale: 1 },
  { key: "additional_combat", component: "additional_options", scale: 8 },
  { key: "additional_combat_above_8", component: "additional_options", scale: 8 },
  { key: "additional_combat_above_16", component: "additional_options", scale: 8 },
  { key: "additional_family_dex", component: "additional_options", scale: 1, signed: true, magnitude: false },
  { key: "additional_family_int", component: "additional_options", scale: 1, signed: true, magnitude: false },
  { key: "additional_family_luk", component: "additional_options", scale: 1, signed: true, magnitude: false },
  { key: "additional_family_xenon", component: "additional_options", scale: 1, signed: true, magnitude: false },
  { key: "additional_family_hp", component: "additional_options", scale: 1, signed: true, magnitude: false },
  { key: "additional_unique_combat", component: "additional_options", scale: 8, magnitude: false },
  { key: "additional_legendary_combat", component: "additional_options", scale: 16, magnitude: false },
  { key: "additional_drop", component: "additional_options", scale: 1 },
  { key: "additional_meso", component: "additional_options", scale: 1 },
  { key: "additional_cooldown", component: "additional_options", scale: 1 },
  { key: "additional_auto_steal", component: "additional_options", scale: 3 },
  { key: "additional_hp", component: "additional_options", scale: 8 },
  { key: "scroll_equivalent", component: "scroll", scale: 5 },
  { key: "scroll_applied", component: "scroll", scale: 4, signed: true },
  { key: "scroll_recoverable", component: "scroll", scale: 2, signed: true },
  { key: "flame_equivalent", component: "flame", scale: 8 },
  { key: "flame_level_reduction", component: "flame", scale: 20 },
  // untradeable_after_equip을 기준 상태로 둬 intercept와 one-hot 합의 완전 공선성을 피한다.
  { key: "trade_one_left", component: "trade", scale: 1, signed: true },
  { key: "trade_fully_tradable", component: "trade", scale: 1 },
  { key: "trade_scissors_remaining", component: "trade", scale: 5 },
]);
const MAGNITUDE_DEFINITIONS_BY_COMPONENT = Object.freeze(Object.fromEntries(
  COMPONENTS.slice(1).map(([component]) => [
    component,
    Object.freeze(FEATURE_DEFINITIONS.filter((definition) =>
      definition.component === component && definition.magnitude !== false
    )),
  ]),
));

const LINE_TARGETS = Object.freeze({
  STR: { pct: "str-percent", flat: "str-flat" },
  DEX: { pct: "dex-percent", flat: "dex-flat" },
  INT: { pct: "int-percent", flat: "int-flat" },
  LUK: { pct: "luk-percent", flat: "luk-flat" },
  ALL_STAT: { pct: "all-stat-percent", flat: "all-stat-flat" },
  ATTACK: { pct: "attack-power-percent", flat: "attack-power-flat" },
  MAGIC_ATTACK: { pct: "magic-power-percent", flat: "magic-power-flat" },
  DAMAGE: { pct: "damage" },
  BOSS_DAMAGE: { pct: "boss-damage" },
  IGNORE_DEFENSE: { pct: "ignore-defense" },
  CRITICAL_RATE: { pct: "critical-rate" },
  CRITICAL_DAMAGE: { pct: "critical-damage" },
});

const USEFUL_OPTION_CODES = new Set([
  "ITEM_DROP_RATE",
  "MESO_OBTAINED",
  "COOLDOWN_REDUCTION",
]);

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonnegative(value) {
  return Math.max(0, finite(value));
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundMeso(value) {
  return Math.min(MAX_SAFE_MESO, Math.max(0, Math.round(finite(value))));
}

function roundSignedMeso(value) {
  return Math.min(MAX_SAFE_MESO, Math.max(-MAX_SAFE_MESO, Math.round(finite(value))));
}

function mesoFromLog(value) {
  if (value === Number.POSITIVE_INFINITY || value >= MAX_SAFE_LOG_MESO) return MAX_SAFE_MESO;
  if (value === Number.NEGATIVE_INFINITY) return 0;
  if (!Number.isFinite(value)) return 0;
  return Math.exp(value);
}

function itemBody(value) {
  if (value?.item && typeof value.item === "object") return value.item;
  return value && typeof value === "object" ? value : {};
}

function starforceValue(item) {
  const raw = typeof item?.starforce === "object" ? item.starforce.value : item?.starforce;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function gradeValue(section) {
  return GRADE_RANK[String(section?.grade || "none").toLowerCase()] ?? 0;
}

function statModel(profile) {
  return String(profile?.statModel || "standard");
}

/**
 * 사이트의 캐릭터 환산 프로필을 시장 추정기가 쓸 수 있는 형태로 보강한다.
 * getCalculationProfile()의 반환값을 그대로 넘기는 것이 가장 정확하다.
 */
export function resolveItemMarketProfile(profile = null) {
  const supplied = profile && typeof profile === "object";
  const mainStat = String(profile?.mainStat || "STR").toUpperCase();
  const fallbackSubStat = mainStat === "INT" ? "LUK" : mainStat === "DEX" ? "STR" : "DEX";
  const source = profile?.conversionSource || (
    profile?.source === "character" || profile?.character
      ? "character"
      : profile?.source === "default" || !supplied
        ? "default_conservative"
        : "manual_or_default"
  );
  const statEquivalence = {
    ...STAT_EQUIVALENCE,
    // 캐릭터 정보가 없을 때만 쓰는 낮은 쪽의 보수적인 전투 환산값이다.
    attackPercentToMainPercent: 4,
    bossDamageToMainPercent: 1,
    criticalRateToMainPercent: 0,
    ...(profile?.statEquivalence || {}),
  };
  const resolved = withStatEquivalenceMaps({
    mainStat,
    subStats: Array.isArray(profile?.subStats)
      ? profile.subStats
      : profile?.subStat
        ? [profile.subStat]
        : [fallbackSubStat],
    attackType: profile?.attackType || (mainStat === "INT" ? "magic" : "attack"),
    characterLevel: Number.isInteger(Number(profile?.characterLevel))
      ? Number(profile.characterLevel)
      : Number.isInteger(Number(profile?.character?.level))
        ? Number(profile.character.level)
        : 290,
    statModel: statModel(profile),
    statEquivalence,
    addOptionEquivalence: profile?.addOptionEquivalence || null,
    source,
    character: profile?.character || null,
  });
  const required = [
    resolved.statEquivalence.flatMainStatToPercent,
    resolved.statEquivalence.attackToMainStat,
    mainStat === "HP"
      ? 1
      : getStatPercentToMainPercent(resolved, mainStat),
  ];
  const complete = required.every((value) => Number.isFinite(Number(value)) && Number(value) > 0);
  return {
    ...resolved,
    conversionSource: source,
    conversionConfidence: source === "market_canonical" && complete
      ? "high"
      : source === "character" && complete
      ? "high"
      : source === "manual_or_default" && complete
        ? "medium"
        : "low",
    conversionLabel: source === "market_canonical"
      ? "시장 공통 환산"
      : source === "character"
      ? "불러온 캐릭터 · 풀 보스 도핑 환산"
      : source === "manual_or_default"
        ? "사용자/사이트 기본 환산"
        : "캐릭터 정보 없음 · 보수적 기본 환산",
  };
}

function convertKnownPotentialLine(line, profile, enemyDefense) {
  const targetType = LINE_TARGETS[line?.code]?.[line?.unit];
  const value = Number(line?.value);
  if (!targetType || !Number.isFinite(value) || value <= 0) return null;
  if (["STR", "DEX", "INT", "LUK"].includes(line.code)) {
    if (line.unit === "pct") {
      return value * nonnegative(getStatPercentToMainPercent(profile, line.code));
    }
    if (line.unit === "flat") {
      return value * nonnegative(getFlatStatToFlatMainStat(profile, line.code)) *
        nonnegative(profile.statEquivalence.flatMainStatToPercent);
    }
  }
  if (line.code === "ALL_STAT") {
    if (line.unit === "pct") {
      return value * nonnegative(profile.statEquivalence.allStatPercentToMainPercent);
    }
    if (line.unit === "flat") {
      const coefficient = ["STR", "DEX", "INT", "LUK"].reduce(
        (sum, stat) => sum + nonnegative(getFlatStatToFlatMainStat(profile, stat)),
        0,
      );
      return value * coefficient * nonnegative(profile.statEquivalence.flatMainStatToPercent);
    }
  }
  try {
    const converted = convertPotentialTargetToEquivalents({
      targetType,
      target: value,
      statEquivalence: profile.statEquivalence,
      enemyDefense,
      mainStat: profile.mainStat,
      subStat: profile.subStat,
      subStats: getProfileSubStats(profile),
      attackType: profile.attackType,
      characterLevel: profile.characterLevel,
    });
    return Number.isFinite(converted.mainStatPercent)
      ? converted.mainStatPercent
      : null;
  } catch {
    return null;
  }
}

function convertHpLine(line, profile) {
  if (line?.code !== "HP" || profile.mainStat !== "HP") return null;
  const value = nonnegative(line.value);
  if (line.unit === "pct") return value;
  if (line.unit !== "flat") return null;
  const direct = Number(profile?.addOptionEquivalence?.flatStatToDamagePercent?.HP);
  const damageToMain = Number(profile?.statEquivalence?.bossDamageToMainPercent);
  if (Number.isFinite(direct) && direct > 0 && Number.isFinite(damageToMain) && damageToMain > 0) {
    return value * direct / damageToMain;
  }
  const flat = Number(profile?.statEquivalence?.flatMainStatToPercent);
  return Number.isFinite(flat) && flat > 0 ? value * flat : null;
}

function convertPerLevelLine(line, profile) {
  if (line?.code !== "STAT_PER_CHARACTER_LEVEL") return null;
  const every = Number(line?.params?.levels_per_increment);
  const amount = Number(line?.params?.stat_value);
  const stat = String(line?.params?.stat_code || "").toUpperCase();
  if (!Number.isFinite(every) || every <= 0 || !Number.isFinite(amount)) return null;
  const flat = Math.floor(profile.characterLevel / every) * amount;
  const coefficient = getFlatStatToFlatMainStat(profile, stat);
  const flatMain = Number(profile.statEquivalence.flatMainStatToPercent);
  return Number.isFinite(coefficient) && Number.isFinite(flatMain)
    ? Math.max(0, flat * coefficient * flatMain)
    : null;
}

function potentialLineKind(line) {
  const code = String(line?.code || "UNKNOWN").toUpperCase();
  const unit = String(line?.unit || "").toLowerCase();
  if (["STR", "DEX", "INT", "LUK"].includes(code)) {
    return unit === "pct" ? "stat_percent" : unit === "flat" ? "stat_flat" : null;
  }
  if (code === "ALL_STAT") {
    return unit === "pct" ? "all_stat_percent" : unit === "flat" ? "all_stat_flat" : null;
  }
  if (code === "HP") return unit === "pct" ? "hp_percent" : unit === "flat" ? "hp_flat" : null;
  if (code === "ATTACK") return unit === "pct" ? "attack_percent" : "attack_flat";
  if (code === "MAGIC_ATTACK") return unit === "pct" ? "magic_attack_percent" : "magic_attack_flat";
  return {
    DAMAGE: "damage_percent",
    BOSS_DAMAGE: "boss_damage_percent",
    IGNORE_DEFENSE: "ignore_defense_percent",
    CRITICAL_DAMAGE: "critical_damage_percent",
    CRITICAL_RATE: "critical_rate_percent",
    STAT_PER_CHARACTER_LEVEL: "stat_per_level",
    ITEM_DROP_RATE: "item_drop_rate",
    MESO_OBTAINED: "meso_obtained",
    COOLDOWN_REDUCTION: "cooldown_reduction",
    AUTO_STEAL: "auto_steal",
    AUTO_STEAL_CHANCE: "auto_steal",
  }[code] || null;
}

function potentialKindShape(section) {
  const kinds = {};
  for (const line of Array.isArray(section?.lines) ? section.lines : []) {
    const kind = potentialLineKind(line);
    // UI에서는 같은 종류 세 줄을 합산한 목표값으로 입력할 수 있으므로 줄 수가
    // 아니라 옵션 종류의 존재 여부를 보존한다.
    if (kind) kinds[kind] = 1;
  }
  return Object.fromEntries(Object.entries(kinds).sort(([left], [right]) =>
    left.localeCompare(right)
  ));
}

function potentialStatCodeShape(section) {
  const codes = {};
  for (const line of Array.isArray(section?.lines) ? section.lines : []) {
    const code = String(line?.code || "").toUpperCase();
    const unit = String(line?.unit || "").toLowerCase();
    if (["STR", "DEX", "INT", "LUK", "ALL_STAT"].includes(code) &&
        ["pct", "flat"].includes(unit)) {
      // 같은 옵션을 여러 줄 넣은 합산 목표와 실제 세 줄 매물이 매칭되어야 하므로
      // 줄 수가 아니라 실제 스탯 코드의 존재 여부만 보존한다.
      codes[`${code}:${unit}`] = 1;
      continue;
    }
    if (code === "STAT_PER_CHARACTER_LEVEL") {
      const stat = String(line?.params?.stat_code || "").toUpperCase();
      if (["STR", "DEX", "INT", "LUK"].includes(stat)) {
        codes[`LEVEL:${stat}`] = 1;
      }
    }
  }
  return Object.fromEntries(Object.entries(codes).sort(([left], [right]) =>
    left.localeCompare(right)
  ));
}

function potentialMetrics(section, profile, enemyDefense) {
  const output = {
    combat: 0,
    drop: 0,
    meso: 0,
    cooldown: 0,
    autoSteal: 0,
    hp: 0,
    unknown: 0,
    unconverted: 0,
    recognized: 0,
    kindShape: potentialKindShape(section),
    statCodeShape: potentialStatCodeShape(section),
  };
  const ignoreDefense = [];
  for (const line of Array.isArray(section?.lines) ? section.lines : []) {
    const code = String(line?.code || "UNKNOWN");
    const value = nonnegative(line?.value);
    if (code === "UNKNOWN") {
      output.unknown += 1;
      continue;
    }
    if (code === "ITEM_DROP_RATE" && line.unit === "pct") {
      output.drop += value / 20;
      output.recognized += 1;
      continue;
    }
    if (code === "MESO_OBTAINED" && line.unit === "pct") {
      output.meso += value / 20;
      output.recognized += 1;
      continue;
    }
    if (code === "COOLDOWN_REDUCTION" && line.unit === "seconds") {
      output.cooldown += value;
      output.recognized += 1;
      continue;
    }
    if ((code === "AUTO_STEAL" || code === "AUTO_STEAL_CHANCE") && line.unit === "pct") {
      output.autoSteal += value;
      output.recognized += 1;
      continue;
    }
    if (code === "IGNORE_DEFENSE" && line.unit === "pct") {
      ignoreDefense.push(value);
      output.recognized += 1;
      continue;
    }
    const hp = convertHpLine(line, profile);
    if (Number.isFinite(hp)) {
      output.hp += hp;
      output.recognized += 1;
      continue;
    }
    const perLevel = convertPerLevelLine(line, profile);
    if (Number.isFinite(perLevel)) {
      output.combat += perLevel;
      output.recognized += 1;
      continue;
    }
    const converted = convertKnownPotentialLine(line, profile, enemyDefense);
    if (Number.isFinite(converted)) {
      output.combat += Math.max(0, converted);
      output.recognized += 1;
    } else if (!USEFUL_OPTION_CODES.has(code)) {
      // 알려진 잡옵도 가격 특징에서는 0이지만 UNKNOWN과는 구분한다.
      output.recognized += 1;
    }
  }
  if (ignoreDefense.length) {
    const combined = 100 * (1 - ignoreDefense.reduce(
      (remaining, value) => remaining * (1 - clamp(value, 0, 100) / 100),
      1,
    ));
    const converted = convertKnownPotentialLine(
      { code: "IGNORE_DEFENSE", unit: "pct", value: combined },
      profile,
      enemyDefense,
    );
    if (Number.isFinite(converted)) output.combat += Math.max(0, converted);
    else output.unconverted += ignoreDefense.length;
  }
  return output;
}

function bucketEquivalent(bucket, profile) {
  const source = bucket && typeof bucket === "object" ? bucket : {};
  const eq = profile.statEquivalence;
  let total = 0;
  for (const stat of ["STR", "DEX", "INT", "LUK"]) {
    total += nonnegative(source[`${stat.toLowerCase()}_flat`]) *
      nonnegative(getFlatStatToFlatMainStat(profile, stat)) *
      nonnegative(eq.flatMainStatToPercent);
  }
  const allFlatCoefficient = Math.max(
    nonnegative(getAllStatFlatMainStat(profile)),
    ["STR", "DEX", "INT", "LUK"].reduce(
      (sum, stat) => sum + nonnegative(getFlatStatToFlatMainStat(profile, stat)),
      0,
    ),
  );
  total += nonnegative(source.all_stat_flat) *
    allFlatCoefficient *
    nonnegative(eq.flatMainStatToPercent);
  total += nonnegative(source.all_stat_pct) * nonnegative(eq.allStatPercentToMainPercent);

  if (profile.mainStat === "HP") {
    const hpLine = convertHpLine({ code: "HP", unit: "flat", value: source.hp_flat }, profile);
    if (Number.isFinite(hpLine)) total += hpLine;
  }
  const attackKey = profile.attackType === "magic" ? "magic_attack_flat" : "attack_flat";
  total += nonnegative(source[attackKey]) *
    nonnegative(eq.attackToMainStat) *
    nonnegative(eq.flatMainStatToPercent);
  total += nonnegative(source.damage_pct) * nonnegative(eq.bossDamageToMainPercent);
  total += nonnegative(source.boss_damage_pct) * nonnegative(eq.bossDamageToMainPercent);
  return total;
}

function starforceFeatures(value) {
  const level = nonnegative(value);
  return {
    sf_level: Math.min(level, 15),
    sf_above_15: Math.max(0, Math.min(level, 21) - 15),
    sf_above_21: Math.max(0, level - 21),
  };
}

function gradeFeatures(prefix, rank) {
  return {
    [`${prefix}_grade_rare`]: rank >= 1 ? 1 : 0,
    [`${prefix}_grade_epic`]: rank >= 2 ? 1 : 0,
    [`${prefix}_grade_unique`]: rank >= 3 ? 1 : 0,
    [`${prefix}_grade_legendary`]: rank >= 4 ? 1 : 0,
  };
}

function canonicalFamilyFromProfile(profile) {
  if (profile?.statModel === "xenon" || profile?.mainStat === "ALL") return "XENON";
  return String(profile?.mainStat || "STR").toUpperCase();
}

function familyFeatures(prefix, family, active) {
  const selected = active ? String(family || "STR").toLowerCase() : "";
  return Object.fromEntries(
    ["dex", "int", "luk", "xenon", "hp"].map((candidate) => [
      `${prefix}_family_${candidate}`,
      selected === candidate ? 1 : 0,
    ]),
  );
}

function diminishingCombatFeatures(prefix, value, firstCut, secondCut) {
  const amount = nonnegative(value);
  return {
    [`${prefix}_combat`]: Math.min(amount, firstCut),
    [`${prefix}_combat_above_${firstCut}`]: Math.max(0, Math.min(amount, secondCut) - firstCut),
    [`${prefix}_combat_above_${secondCut}`]: Math.max(0, amount - secondCut),
  };
}

function tradeFeatures(trade) {
  const state = String(trade?.state || "");
  return {
    trade_one_left: state === "one_trade_left" ? 1 : 0,
    trade_fully_tradable: state === "tradable" ? 1 : 0,
    trade_scissors_remaining: nonnegative(trade?.scissors_remaining),
  };
}

/** 공개 item shard의 매물 또는 사용자가 만든 item을 동일한 설명변수로 바꾼다. */
export function extractItemMarketFeatures(value, options = {}) {
  const item = itemBody(value);
  const profile = resolveItemMarketProfile(options.profile);
  const enemyDefense = Number(options.enemyDefense) > 0 ? Number(options.enemyDefense) : 380;
  const potential = potentialMetrics(item.potential, profile, enemyDefense);
  const additional = potentialMetrics(item.additional_potential, profile, enemyDefense);
  const potentialGrade = gradeValue(item.potential);
  const additionalGrade = gradeValue(item.additional_potential);
  const profileFamily = canonicalFamilyFromProfile(profile);
  const sf = starforceValue(item);
  const stats = item.stats && typeof item.stats === "object" ? item.stats : {};
  const upgradeMaximum = readUpgradeSlotMaximum(item);
  const upgradeAppliedInput = Number(item?.upgrade?.applied);
  const upgradeRemaining = Number(item?.upgrade?.remaining);
  const upgradeRecoverable = Number(item?.upgrade?.recoverable);
  const derivedUpgradeApplied = deriveAppliedUpgradeCount({
    maximum: upgradeMaximum,
    remaining: upgradeRemaining,
    recoverable: upgradeRecoverable,
  });
  const upgradeApplied = derivedUpgradeApplied ?? upgradeAppliedInput;
  const scrollEquivalent = bucketEquivalent(stats.scroll, profile);
  const flameEquivalent = bucketEquivalent(stats.flame, profile);
  const vectors = {
    ...starforceFeatures(sf ?? 0),
    ...gradeFeatures("potential", potentialGrade),
    ...diminishingCombatFeatures("potential", potential.combat, 21, 33),
    ...familyFeatures("potential", profileFamily, potential.combat + potential.hp > 0),
    potential_unique_combat: potentialGrade === GRADE_RANK.unique ? potential.combat : 0,
    potential_legendary_combat: potentialGrade === GRADE_RANK.legendary ? potential.combat : 0,
    potential_drop: potential.drop,
    potential_meso: potential.meso,
    potential_cooldown: potential.cooldown,
    potential_auto_steal: potential.autoSteal,
    potential_hp: potential.hp,
    ...gradeFeatures("additional", additionalGrade),
    ...diminishingCombatFeatures("additional", additional.combat, 8, 16),
    ...familyFeatures("additional", profileFamily, additional.combat + additional.hp > 0),
    additional_unique_combat: additionalGrade === GRADE_RANK.unique ? additional.combat : 0,
    additional_legendary_combat: additionalGrade === GRADE_RANK.legendary
      ? additional.combat
      : 0,
    additional_drop: additional.drop,
    additional_meso: additional.meso,
    additional_cooldown: additional.cooldown,
    additional_auto_steal: additional.autoSteal,
    additional_hp: additional.hp,
    scroll_equivalent: scrollEquivalent,
    scroll_applied: Number.isFinite(upgradeApplied) ? Math.max(0, upgradeApplied) : 0,
    scroll_remaining: Number.isFinite(upgradeRemaining) ? Math.max(0, upgradeRemaining) : 0,
    scroll_recoverable: Number.isFinite(upgradeRecoverable) ? Math.max(0, upgradeRecoverable) : 0,
    flame_equivalent: flameEquivalent,
    flame_level_reduction: nonnegative(item.required_level_reduction),
    ...tradeFeatures(item.trade),
  };
  return {
    item_name: normalizeMarketItemName(item.name || value?.item_name),
    category: String(item.category || "").trim() || null,
    base_level: item.base_level != null && Number.isFinite(Number(item.base_level))
      ? Number(item.base_level)
      : null,
    starforce: sf,
    vector: Object.fromEntries(
      FEATURE_DEFINITIONS.map(({ key }) => [key, nonnegative(vectors[key])]),
    ),
    components: {
      base_price_meso: Number.isSafeInteger(Number(item.base_price_meso ?? value?.base_price_meso)) &&
        Number(item.base_price_meso ?? value?.base_price_meso) > 0
        ? Number(item.base_price_meso ?? value?.base_price_meso)
        : null,
      starforce: sf,
      potential_grade: potentialGrade,
      potential_options_main_stat_percent: potential.combat + potential.hp,
      potential_auto_steal_percent: potential.autoSteal,
      additional_grade: additionalGrade,
      additional_options_main_stat_percent: additional.combat + additional.hp,
      additional_auto_steal_percent: additional.autoSteal,
      scroll_main_stat_percent: vectors.scroll_equivalent,
      scroll_maximum: upgradeMaximum,
      scroll_applied: vectors.scroll_applied,
      scroll_remaining: vectors.scroll_remaining,
      scroll_recoverable: vectors.scroll_recoverable,
      flame_main_stat_percent: vectors.flame_equivalent,
      required_level_reduction: vectors.flame_level_reduction,
      trade_state: String(item?.trade?.state || "") || null,
      scissors_remaining: item?.trade?.scissors_remaining != null &&
        Number.isFinite(Number(item.trade.scissors_remaining))
        ? Number(item.trade.scissors_remaining)
        : null,
    },
    option_quality: {
      unknown_lines: potential.unknown + additional.unknown,
      unconverted_combat_lines: potential.unconverted + additional.unconverted,
      recognized_lines: potential.recognized + additional.recognized,
    },
    option_kinds: {
      potential: potential.kindShape,
      additional: additional.kindShape,
    },
    option_stat_codes: {
      potential: potential.statCodeShape,
      additional: additional.statCodeShape,
    },
    profile: {
      source: profile.conversionSource,
      confidence: profile.conversionConfidence,
      label: profile.conversionLabel,
      main_stat: profile.mainStat,
      sub_stats: getProfileSubStats(profile),
      attack_type: profile.attackType,
      character_level: profile.characterLevel,
      supports_ignore_defense: Number.isFinite(Number(profile.statEquivalence.currentIgnoreDefense)) &&
        Number.isFinite(Number(profile.statEquivalence.oneMainPercentRelative)),
    },
  };
}

let canonicalTrainingProfiles = null;

function standardCanonicalProfile(mainStat, subStat, attackType) {
  const subStats = Array.isArray(subStat) ? subStat : [subStat];
  return resolveItemMarketProfile({
    conversionSource: "market_canonical",
    mainStat,
    subStats,
    attackType,
    characterLevel: 285,
    statEquivalence: {
      ...STAT_EQUIVALENCE,
      attackPercentToMainPercent: 4,
      bossDamageToMainPercent: 1,
      criticalRateToMainPercent: 0,
      currentIgnoreDefense: 0.95,
      oneMainPercentRelative: 0.01,
      flatStatToFlatMainStatByStat: {
        STR: mainStat === "STR" ? 1 : subStats.includes("STR") ? 0.25 : 0,
        DEX: mainStat === "DEX" ? 1 : subStats.includes("DEX") ? 0.25 : 0,
        INT: mainStat === "INT" ? 1 : subStats.includes("INT") ? 0.25 : 0,
        LUK: mainStat === "LUK" ? 1 : subStats.includes("LUK") ? 0.25 : 0,
      },
      statPercentToMainPercentByStat: {
        STR: mainStat === "STR" ? 1 : subStats.includes("STR") ? 0.12 : 0,
        DEX: mainStat === "DEX" ? 1 : subStats.includes("DEX") ? 0.12 : 0,
        INT: mainStat === "INT" ? 1 : subStats.includes("INT") ? 0.12 : 0,
        LUK: mainStat === "LUK" ? 1 : subStats.includes("LUK") ? 0.12 : 0,
      },
    },
  });
}

function getCanonicalTrainingProfiles() {
  if (canonicalTrainingProfiles) return canonicalTrainingProfiles;
  const standard = [
    ["STR", "DEX", "attack"],
    ["DEX", "STR", "attack"],
    ["INT", "LUK", "magic"],
    ["LUK", ["DEX", "STR"], "attack"],
  ].map(([mainStat, subStat, attackType]) => ({
    family: mainStat,
    profile: standardCanonicalProfile(mainStat, subStat, attackType),
  }));
  const xenon = resolveItemMarketProfile({
    conversionSource: "market_canonical",
    mainStat: "ALL",
    subStats: [],
    attackType: "attack",
    characterLevel: 285,
    statModel: "xenon",
    statEquivalence: {
      ...STAT_EQUIVALENCE,
      allStatPercentToMainPercent: 2.475,
      attackPercentToMainPercent: 4,
      bossDamageToMainPercent: 1,
      criticalRateToMainPercent: 0,
      currentIgnoreDefense: 0.95,
      oneMainPercentRelative: 0.01,
      flatStatToFlatMainStatByStat: { STR: 1, DEX: 1, INT: 0, LUK: 1 },
      statPercentToMainPercentByStat: { STR: 1, DEX: 1, INT: 0, LUK: 1 },
    },
  });
  const hp = resolveItemMarketProfile({
    conversionSource: "market_canonical",
    mainStat: "HP",
    subStats: [],
    attackType: "attack",
    characterLevel: 285,
    statModel: "demon-avenger",
    statEquivalence: {
      ...STAT_EQUIVALENCE,
      flatMainStatToPercent: 1 / 35,
      attackToMainStat: 140,
      allStatPercentToMainPercent: 0,
      attackPercentToMainPercent: 4,
      bossDamageToMainPercent: 1,
      criticalRateToMainPercent: 0,
      currentIgnoreDefense: 0.95,
      oneMainPercentRelative: 0.01,
      flatStatToFlatMainStatByStat: { STR: 0.25, DEX: 0, INT: 0, LUK: 0 },
      statPercentToMainPercentByStat: { STR: 0.05, DEX: 0, INT: 0, LUK: 0 },
    },
  });
  canonicalTrainingProfiles = [
    ...standard,
    { family: "XENON", profile: xenon },
    { family: "HP", profile: hp },
  ];
  return canonicalTrainingProfiles;
}

function combatFeatureStrength(features) {
  // 한 장비의 직업 계열은 하나만 고른다. 시장에서 계열을 가장 강하게 드러내는
  // 윗잠/에디를 우선하고, 주문서·추옵은 과도한 단일 수치가 계열을 뒤집지 않게 완만히 반영한다.
  return Math.min(3, componentMagnitude(features, "potential_options")) * 3 +
    Math.min(3, componentMagnitude(features, "additional_options")) * 2.5 +
    Math.min(4, componentMagnitude(features, "scroll")) +
    Math.min(4, componentMagnitude(features, "flame"));
}

const PROFILED_COMPONENTS = Object.freeze([
  "potential_options",
  "additional_options",
  "scroll",
  "flame",
]);

function selectBestComponentProfile(evaluated, component) {
  return evaluated.reduce((best, candidate) => {
    const strength = componentMagnitude(candidate.features, component);
    return !best || strength > best.strength + EPSILON
      ? { ...candidate, strength }
      : best;
  }, null);
}

function componentFields(component) {
  return {
    potential_options: [
      "potential_options_main_stat_percent",
      "potential_auto_steal_percent",
    ],
    additional_options: [
      "additional_options_main_stat_percent",
      "additional_auto_steal_percent",
    ],
    scroll: [
      "scroll_main_stat_percent",
      "scroll_maximum",
      "scroll_applied",
      "scroll_remaining",
      "scroll_recoverable",
    ],
    flame: ["flame_main_stat_percent", "required_level_reduction"],
  }[component] || [];
}

/**
 * 학습 매물은 사용자의 직업이 아니라 각 구성요소 자체에 가장 유효한 계열로
 * 표준화한다. 잠재와 무관한 추옵/에디가 잠재의 직업 계열을 뒤집지 않게 한다.
 */
export function extractCanonicalMarketTrainingFeatures(value, options = {}) {
  const requiredJob = String(itemBody(value)?.required_job || "공용").trim();
  const allowedFamilies = {
    전사: new Set(["STR", "HP"]),
    궁수: new Set(["DEX"]),
    마법사: new Set(["INT"]),
    도적: new Set(["LUK"]),
    해적: new Set(["STR", "DEX", "XENON"]),
  }[requiredJob] || null;
  const evaluated = [];
  for (const candidate of getCanonicalTrainingProfiles()) {
    if (allowedFamilies && !allowedFamilies.has(candidate.family)) continue;
    const features = extractItemMarketFeatures(value, {
      profile: candidate.profile,
      enemyDefense: options.enemyDefense,
    });
    const strength = combatFeatureStrength(features);
    evaluated.push({ ...candidate, features, strength });
  }
  const selectedByComponent = Object.fromEntries(PROFILED_COMPONENTS.map((component) => [
    component,
    selectBestComponentProfile(evaluated, component),
  ]));
  const selected = PROFILED_COMPONENTS
    .map((component) => selectedByComponent[component])
    .find((candidate) => candidate?.strength > EPSILON) || evaluated[0];
  const vector = { ...selected.features.vector };
  const components = { ...selected.features.components };
  for (const component of PROFILED_COMPONENTS) {
    const candidate = selectedByComponent[component];
    for (const definition of FEATURE_DEFINITIONS.filter(
      (entry) => entry.component === component,
    )) {
      vector[definition.key] = candidate.features.vector[definition.key];
    }
    for (const key of componentFields(component)) {
      components[key] = candidate.features.components[key];
    }
  }
  const familyByComponent = Object.fromEntries(PROFILED_COMPONENTS.map((component) => [
    component,
    selectedByComponent[component].family,
  ]));
  return {
    ...selected.features,
    vector,
    components,
    training_profile_family: selected.family,
    training_profile_by_component: familyByComponent,
    required_job: requiredJob || null,
    profile: {
      ...selected.features.profile,
      source: "market_canonical_component_stat_family",
      label: "구성요소별 최유효 정옵 계열 표준화",
    },
  };
}

function quantile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * clamp(fraction, 0, 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function weightedQuantile(entries, fraction, valueKey = "value", weightKey = "weight") {
  if (!entries.length) return null;
  const sorted = [...entries].sort((left, right) => left[valueKey] - right[valueKey]);
  const total = sorted.reduce((sum, entry) => sum + entry[weightKey], 0);
  if (!(total > 0)) return quantile(sorted.map((entry) => entry[valueKey]), fraction);
  const target = clamp(fraction, 0, 1) * total;
  let accumulated = 0;
  for (const entry of sorted) {
    accumulated += entry[weightKey];
    if (accumulated >= target) return entry[valueKey];
  }
  return sorted.at(-1)[valueKey];
}

function robustScale(values, fallback) {
  if (values.length < 2) return fallback;
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const deviation = (q3 - q1) / 1.349;
  const min = Math.max(fallback * 0.25, 1e-6);
  return Math.max(min, Number.isFinite(deviation) && deviation > 0 ? deviation : fallback);
}

function recordFloor(record) {
  const frames = Array.isArray(record?.sampling_frames) ? record.sampling_frames : [];
  if (frames.some((frame) => frame?.price_min_meso == null)) return null;
  const floors = frames
    .map((frame) => Number(frame?.price_min_meso))
    .filter((value) => Number.isFinite(value) && value > 0);
  return floors.length ? Math.min(...floors) : null;
}

function parseTime(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : null;
}

function sameTargetItem(target, record) {
  const item = itemBody(record);
  if (normalizeMarketItemName(item.name) !== target.item_name) return false;
  if (target.category && item.category && String(item.category) !== target.category) return false;
  return true;
}

function priceValue(record) {
  const value = Number(record?.price_meso);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function usableComparable(record) {
  const item = itemBody(record);
  if (record?.quality?.starforce_unknown === true ||
      record?.quality?.stats_missing === true ||
      record?.quality?.stat_component_mismatch === true) return false;
  return item?.starforce?.applicable === false || starforceValue(item) !== null;
}

function effectiveSampleSize(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  const squares = entries.reduce((sum, entry) => sum + entry.weight * entry.weight, 0);
  return squares > 0 ? total * total / squares : 0;
}

function comparableRecords(comparables) {
  return Array.isArray(comparables?.records)
    ? comparables.records
    : Array.isArray(comparables)
      ? comparables
      : [];
}

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableValue(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function fitNonnegativeRidge(entries, featureDefinitions, lambda) {
  const featureVariation = Object.fromEntries(featureDefinitions.map((definition) => {
    const values = entries.map((entry) => entry.features.vector[definition.key]);
    return [definition.key, Math.max(...values) - Math.min(...values) > EPSILON];
  }));
  const scales = Object.fromEntries(featureDefinitions.map((definition) => {
    const values = entries.map((entry) => entry.features.vector[definition.key]);
    return [definition.key, robustScale(values, definition.scale)];
  }));
  const matrix = entries.map((entry) => featureDefinitions.map(
    (definition) => featureVariation[definition.key]
      ? entry.features.vector[definition.key] / scales[definition.key]
      : 0,
  ));
  const columns = featureDefinitions.map((definition, column) =>
    featureVariation[definition.key]
      ? matrix.flatMap((row, index) => row[column] === 0
          ? []
          : [{ row: index, value: row[column] }])
      : []
  );
  const y = entries.map((entry) => Math.log(entry.price));
  const baseWeights = entries.map((entry) => entry.weight);
  let weights = [...baseWeights];
  let coefficients = featureDefinitions.map(() => 0);
  let intercept = weightedQuantile(
    y.map((value, index) => ({ value, weight: weights[index] })),
    0.5,
  ) ?? 0;
  const predictions = matrix.map(() => intercept);

  for (let robustRound = 0; robustRound < 3; robustRound += 1) {
    const denominators = columns.map((column) => lambda + column.reduce(
      (sum, entry) => sum + weights[entry.row] * entry.value * entry.value,
      0,
    ));
    for (let iteration = 0; iteration < 160; iteration += 1) {
      let maximumChange = 0;
      let residualWeightedSum = 0;
      let weightSum = 0;
      for (let row = 0; row < entries.length; row += 1) {
        residualWeightedSum += weights[row] * (y[row] - predictions[row]);
        weightSum += weights[row];
      }
      const interceptDelta = weightSum > 0 ? residualWeightedSum / weightSum : 0;
      maximumChange = Math.max(maximumChange, Math.abs(interceptDelta));
      intercept += interceptDelta;
      for (let row = 0; row < entries.length; row += 1) predictions[row] += interceptDelta;

      for (let column = 0; column < featureDefinitions.length; column += 1) {
        if (!featureVariation[featureDefinitions[column].key]) continue;
        let numerator = 0;
        const previous = coefficients[column];
        for (const entry of columns[column]) {
          const predictionWithout = predictions[entry.row] - entry.value * previous;
          numerator += weights[entry.row] * entry.value * (y[entry.row] - predictionWithout);
        }
        const unconstrained = numerator / Math.max(denominators[column], EPSILON);
        const next = featureDefinitions[column].signed ? unconstrained : Math.max(0, unconstrained);
        const delta = next - previous;
        maximumChange = Math.max(maximumChange, Math.abs(delta));
        coefficients[column] = next;
        if (delta !== 0) {
          for (const entry of columns[column]) {
            predictions[entry.row] += entry.value * delta;
          }
        }
      }
      if (maximumChange < 1e-7) break;
    }

    const residuals = y.map((value, row) => value - predictions[row]);
    const median = quantile(residuals, 0.5) ?? 0;
    const mad = quantile(residuals.map((value) => Math.abs(value - median)), 0.5) ?? 0;
    const robustSigma = Math.max(0.06, mad * 1.4826);
    weights = baseWeights.map((weight, index) => {
      const ratio = Math.abs(residuals[index] - median) / (1.5 * robustSigma);
      return weight * (ratio <= 1 ? 1 : 1 / ratio);
    });
  }

  return {
    intercept,
    coefficients: Object.fromEntries(featureDefinitions.map((definition, index) => [
      definition.key,
      featureVariation[definition.key] ? coefficients[index] / scales[definition.key] : 0,
    ])),
    featureVariation,
    robustWeights: weights,
  };
}

function predictLog(features, fitted) {
  return fitted.intercept + FEATURE_DEFINITIONS.reduce(
    (sum, definition) => sum +
      nonnegative(features.vector[definition.key]) *
      finite(fitted.coefficients[definition.key]),
    0,
  );
}

const LOCAL_DISTANCE_COMPONENT_WEIGHTS = Object.freeze({
  starforce: 1.2,
  potential_grade: 1.3,
  potential_options: 1.5,
  additional_grade: 0.9,
  additional_options: 0.9,
  scroll: 0.75,
  flame: 0.75,
  trade: 0.45,
});

function comparableFamilyGroup(family) {
  const value = String(family || "").toUpperCase();
  return ["STR", "DEX", "INT", "LUK"].includes(value) ? "STANDARD" : value;
}

function componentFamilyPenalty(target, comparable, component) {
  if (!PROFILED_COMPONENTS.includes(component)) return 0;
  if (componentMagnitude(target, component) <= EPSILON ||
      componentMagnitude(comparable, component) <= EPSILON) return 0;
  const targetFamily = target.training_profile_by_component?.[component] ||
    target.training_profile_family;
  const comparableFamily = comparable.training_profile_by_component?.[component] ||
    comparable.training_profile_family;
  if (!targetFamily || !comparableFamily || targetFamily === comparableFamily) return 0;
  return comparableFamilyGroup(targetFamily) === comparableFamilyGroup(comparableFamily)
    ? 0
    : 0.75;
}

function localComparableDistance(target, comparable, trainingSupports, excludedComponents = null) {
  let weightedSquares = 0;
  let totalWeight = 0;
  for (const [component, componentWeight] of Object.entries(LOCAL_DISTANCE_COMPONENT_WEIGHTS)) {
    if (excludedComponents?.has(component)) continue;
    const definitions = FEATURE_DEFINITIONS.filter(
      (definition) => definition.component === component,
    );
    if (!definitions.length) continue;
    let componentSquares = 0;
    for (const definition of definitions) {
      const range = trainingSupports?.[component]?.ranges?.[definition.key];
      const observedSpan = range ? nonnegative(range.maximum - range.minimum) : 0;
      const scale = Math.max(definition.scale, observedSpan / 2, EPSILON);
      componentSquares += (
        (target.vector[definition.key] - comparable.vector[definition.key]) / scale
      ) ** 2;
    }
    const familyPenalty = componentFamilyPenalty(target, comparable, component);
    weightedSquares += componentWeight * (
      componentSquares / definitions.length + familyPenalty ** 2
    );
    totalWeight += componentWeight;
  }
  return Math.sqrt(weightedSquares / Math.max(EPSILON, totalWeight));
}

function sameObservedNumber(left, right) {
  const leftMissing = left === null || left === undefined || left === "";
  const rightMissing = right === null || right === undefined || right === "";
  if (leftMissing || rightMissing) return leftMissing && rightMissing;
  return Number.isFinite(Number(left)) && Number.isFinite(Number(right)) &&
    Math.abs(Number(left) - Number(right)) <= EPSILON;
}

function starforceBand(value) {
  const starforce = nonnegative(value);
  if (starforce === 0) return "0";
  if (starforce <= 15) return "1-15";
  if (starforce <= 17) return "16-17";
  if (starforce <= 20) return "18-20";
  if (starforce <= 22) return "21-22";
  return "23+";
}

function optionShape(features, prefix) {
  return {
    combat: [
      `${prefix}_combat`,
      `${prefix}_combat_above_${prefix === "potential" ? 21 : 8}`,
      `${prefix}_combat_above_${prefix === "potential" ? 33 : 16}`,
    ].reduce((sum, key) => sum + nonnegative(features.vector[key]), 0),
    drop: nonnegative(features.vector[`${prefix}_drop`]),
    meso: nonnegative(features.vector[`${prefix}_meso`]),
    cooldown: nonnegative(features.vector[`${prefix}_cooldown`]),
    autoSteal: nonnegative(features.vector[`${prefix}_auto_steal`]),
    hp: nonnegative(features.vector[`${prefix}_hp`]),
  };
}

function optionKindShapeMatches(target, comparable, prefix) {
  const left = target.option_kinds?.[prefix] || {};
  const right = comparable.option_kinds?.[prefix] || {};
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  if (![...keys].every((key) => nonnegative(left[key]) === nonnegative(right[key]))) {
    return false;
  }
  const component = prefix === "potential" ? "potential_options" : "additional_options";
  const targetFamily = target.training_profile_by_component?.[component] ||
    target.training_profile_family;
  const comparableFamily = comparable.training_profile_by_component?.[component] ||
    comparable.training_profile_family;
  if (targetFamily !== "XENON" || comparableFamily !== "XENON") return true;
  // 제논 환산에서는 STR·DEX·LUK가 모두 유효해 기존의 generic `stat_percent`
  // 종류만으로는 올스탯+LUK와 올스탯+STR 매물이 한 곡선에 섞였다. XENON
  // 로컬 비교에서만 실제 스탯 코드 조합을 추가로 고정한다.
  const leftStats = target.option_stat_codes?.[prefix] || {};
  const rightStats = comparable.option_stat_codes?.[prefix] || {};
  const statKeys = new Set([...Object.keys(leftStats), ...Object.keys(rightStats)]);
  return [...statKeys].every((key) =>
    nonnegative(leftStats[key]) === nonnegative(rightStats[key])
  );
}

function optionShapeMatches(target, comparable, prefix, magnitudeMode, allowZeroComparable = false) {
  const comparableShape = optionShape(comparable, prefix);
  const comparableIsZero = Object.values(comparableShape)
    .every((value) => value <= EPSILON);
  // 같은 옵션 곡선의 0 지점(유효 옵션 없음)은 semantic kind 자체가 없으므로,
  // 양수 구간과 종류가 다르다는 이유로 제외하지 않는다.
  if (allowZeroComparable && comparableIsZero) return true;
  const preserveKinds = magnitudeMode === "exact" || magnitudeMode === "kind";
  if (preserveKinds && !optionKindShapeMatches(target, comparable, prefix)) {
    return false;
  }
  const targetShape = optionShape(target, prefix);
  for (const key of Object.keys(targetShape)) {
    const targetActive = targetShape[key] > EPSILON;
    const comparableActive = comparableShape[key] > EPSILON;
    if (targetActive !== comparableActive) return false;
    if (!targetActive || !magnitudeMode || magnitudeMode === "kind") continue;
    const tolerance = magnitudeMode === "exact"
      ? 0.01
      : key === "combat" || key === "hp"
        ? Math.max(1, targetShape[key] * 0.08)
        : key === "autoSteal"
          ? Math.max(1, targetShape[key] * 0.25)
          : 0.5;
    if (Math.abs(targetShape[key] - comparableShape[key]) > tolerance) return false;
  }
  return true;
}

function supportedLowerOptionGroups(target, entries, minimum = 3) {
  const targetShapes = {
    potential: optionShape(target, "potential"),
    additional: optionShape(target, "additional"),
  };
  const groups = new Map();
  for (const entry of entries) {
    const shapes = {
      potential: optionShape(entry.features, "potential"),
      additional: optionShape(entry.features, "additional"),
    };
    const isLowerOrEqual = Object.keys(targetShapes).every((prefix) =>
      Object.keys(targetShapes[prefix]).every((key) =>
        shapes[prefix][key] <= targetShapes[prefix][key] + 0.01
      )
    );
    if (!isLowerOrEqual) continue;
    const key = stableValue(shapes);
    const group = groups.get(key) || { entries: [], shapes };
    group.entries.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()]
    .filter((group) => group.entries.length >= minimum &&
      effectiveSampleSize(group.entries) >= 2.5)
    .map((group) => ({
      ...group,
      gap: Object.keys(targetShapes).reduce((outer, prefix) =>
        outer + Object.keys(targetShapes[prefix]).reduce((inner, key) =>
          inner + (targetShapes[prefix][key] - group.shapes[prefix][key]) /
            Math.max(1, targetShapes[prefix][key]), 0), 0),
    }))
    .sort((left, right) => left.gap - right.gap || right.entries.length - left.entries.length);
}

function hasSupportedOptionShapeGroup(entries, minimum = 3) {
  const groups = new Map();
  for (const entry of entries) {
    const key = stableValue({
      potential: optionShape(entry.features, "potential"),
      additional: optionShape(entry.features, "additional"),
    });
    const group = groups.get(key) || [];
    group.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()].some((group) =>
    group.length >= minimum && effectiveSampleSize(group) >= 2.5 &&
    group.some((entry) =>
      componentMagnitude(entry.features, "potential_options") > EPSILON ||
      componentMagnitude(entry.features, "additional_options") > EPSILON
    )
  );
}

function groupedOptionShapes(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const shapes = {
      potential: optionShape(entry.features, "potential"),
      additional: optionShape(entry.features, "additional"),
    };
    const key = stableValue(shapes);
    const group = groups.get(key) || { entries: [], shapes };
    group.entries.push(entry);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function isConsistentSparseOptionGroup(group, fitted) {
  if (group.entries.length !== 2 || effectiveSampleSize(group.entries) < 1.8) return false;
  const normalizedPrices = group.entries.map((entry) =>
    entry.price / Math.max(EPSILON, mesoFromLog(predictLog(entry.features, fitted)))
  );
  const low = Math.min(...normalizedPrices);
  const high = Math.max(...normalizedPrices);
  return low > 0 && high / low <= 1.25;
}

function consistentSparseLowerOptionGroups(target, entries, fitted) {
  const targetShapes = {
    potential: optionShape(target, "potential"),
    additional: optionShape(target, "additional"),
  };
  return groupedOptionShapes(entries).filter((group) =>
    isConsistentSparseOptionGroup(group, fitted) &&
    Object.keys(targetShapes).every((prefix) =>
      Object.keys(targetShapes[prefix]).every((key) =>
        group.shapes[prefix][key] <= targetShapes[prefix][key] + 0.01
      )
    )
  );
}

function hasConsistentSparseOptionShapeGroup(entries, fitted) {
  return groupedOptionShapes(entries).some((group) =>
    isConsistentSparseOptionGroup(group, fitted) &&
    group.entries.some((entry) =>
      componentMagnitude(entry.features, "potential_options") > EPSILON ||
      componentMagnitude(entry.features, "additional_options") > EPSILON
    )
  );
}

function componentFamilyMatches(target, comparable, component, mode = "group") {
  if (componentMagnitude(target, component) <= EPSILON ||
      componentMagnitude(comparable, component) <= EPSILON) return true;
  const left = target.training_profile_by_component?.[component] ||
    target.training_profile_family;
  const right = comparable.training_profile_by_component?.[component] ||
    comparable.training_profile_family;
  return mode === "exact"
    ? left === right
    : comparableFamilyGroup(left) === comparableFamilyGroup(right);
}

function sameUpgradeState(target, comparable) {
  return ["scroll_maximum", "scroll_applied", "scroll_remaining", "scroll_recoverable"]
    .every((key) => sameObservedNumber(target.components[key], comparable.components[key]));
}

function profiledComponentMatches(target, comparable, component, magnitudeMode, familyMode) {
  const targetMagnitude = componentMagnitude(target, component);
  const comparableMagnitude = componentMagnitude(comparable, component);
  const targetActive = targetMagnitude > EPSILON;
  const comparableActive = comparableMagnitude > EPSILON;
  if (targetActive !== comparableActive) return false;
  if (!targetActive) return true;
  if (!componentFamilyMatches(target, comparable, component, familyMode)) return false;
  if (!magnitudeMode) return true;
  if (magnitudeMode === "exact") {
    return FEATURE_DEFINITIONS
      .filter((definition) => definition.component === component && definition.magnitude !== false)
      .every((definition) => Math.abs(
        nonnegative(target.vector[definition.key]) -
        nonnegative(comparable.vector[definition.key])
      ) <= 0.01);
  }
  const tolerance = Math.max(0.25, targetMagnitude * 0.08);
  return Math.abs(targetMagnitude - comparableMagnitude) <= tolerance;
}

function structuralComparable(target, comparable, options = {}) {
  const exactStarforce = sameObservedNumber(
    target.components.starforce,
    comparable.components.starforce,
  );
  if (options.starforce === "exact" && !exactStarforce) return false;
  if (options.starforce === "band" && starforceBand(target.components.starforce) !==
      starforceBand(comparable.components.starforce)) return false;
  if (!sameObservedNumber(
    target.components.potential_grade,
    comparable.components.potential_grade,
  )) return false;
  if (!sameObservedNumber(
    target.components.additional_grade,
    comparable.components.additional_grade,
  )) return false;
  if (options.upgrade && !sameUpgradeState(target, comparable)) return false;
  const familyMode = options.family === "exact" ? "exact" : "group";
  if (!componentFamilyMatches(target, comparable, "potential_options", familyMode) ||
      !componentFamilyMatches(target, comparable, "additional_options", familyMode)) return false;
  if (!optionShapeMatches(
    target,
    comparable,
    "potential",
    options.magnitude,
    options.allowZeroOption,
  ) || !optionShapeMatches(
    target,
    comparable,
    "additional",
    options.magnitude,
    options.allowZeroOption,
  )) return false;
  if (options.profiledComponents === false) return true;
  const profiledMagnitude = options.profiledMagnitude ?? options.magnitude;
  return profiledComponentMatches(target, comparable, "scroll", profiledMagnitude, familyMode) &&
    profiledComponentMatches(target, comparable, "flame", profiledMagnitude, familyMode);
}

function localComparablePool(target, entries) {
  const selectExactPool = (matches, tier) => matches.length
    ? { tier, entries: matches, qualified: matches.length >= 3 }
    : null;
  const exactAllFamily = entries.filter((entry) => structuralComparable(target, entry.features, {
    starforce: "exact",
    upgrade: true,
    magnitude: "exact",
    family: "exact",
  }));
  if (exactAllFamily.length >= 3) {
    return selectExactPool(exactAllFamily, "exact_all_family");
  }
  let narrowFallback = exactAllFamily.length
    ? selectExactPool(exactAllFamily, "exact_all_family")
    : null;
  const exactAll = entries.filter((entry) => structuralComparable(target, entry.features, {
    starforce: "exact",
    upgrade: true,
    magnitude: "exact",
  }));
  if (exactAll.length >= 3) return selectExactPool(exactAll, "exact_all");
  if (!narrowFallback && exactAll.length) {
    narrowFallback = selectExactPool(exactAll, "exact_all");
  }

  const hasTargetOption = ["potential_options", "additional_options"]
    .some((component) => componentMagnitude(target, component) > EPSILON);
  if (hasTargetOption) {
    const exactOptionFamily = entries.filter((entry) => structuralComparable(
      target,
      entry.features,
      {
        starforce: "exact",
        upgrade: true,
        magnitude: "exact",
        family: "exact",
        profiledComponents: false,
      },
    ));
    if (exactOptionFamily.length >= 3) {
      return selectExactPool(exactOptionFamily, "exact_family");
    }
    if (!narrowFallback && exactOptionFamily.length) {
      narrowFallback = selectExactPool(exactOptionFamily, "exact_family");
    }
    const exactOption = entries.filter((entry) => structuralComparable(
      target,
      entry.features,
      {
        starforce: "exact",
        upgrade: true,
        magnitude: "exact",
        profiledComponents: false,
      },
    ));
    if (exactOption.length >= 3) return selectExactPool(exactOption, "exact");
    if (!narrowFallback && exactOption.length) {
      narrowFallback = selectExactPool(exactOption, "exact");
    }

    // 정확히 같은 수치의 거래가 없는 지점에서도 같은 옵션 종류의 인접 수치를
    // 이어 준다. 이 단계가 없으면 21%에는 직접 거래 보정이 강하게 적용되다가
    // 24%부터 전체 표본 fallback으로 급변해 더 좋은 옵션이 싸지는 역전이 생긴다.
    const kindTiers = [
      {
        tier: "same_kind_all_family",
        minimum: 3,
        options: {
          starforce: "exact",
          upgrade: true,
          magnitude: "kind",
          profiledMagnitude: "exact",
          family: "exact",
        },
      },
      {
        tier: "same_kind_all",
        minimum: 3,
        options: {
          starforce: "exact",
          upgrade: true,
          magnitude: "kind",
          profiledMagnitude: "exact",
        },
      },
      {
        tier: "same_kind_state_family",
        minimum: 3,
        options: {
          starforce: "exact",
          upgrade: true,
          magnitude: "kind",
          family: "exact",
          profiledComponents: false,
        },
      },
      {
        tier: "same_kind_state",
        minimum: 3,
        options: {
          starforce: "exact",
          upgrade: true,
          magnitude: "kind",
          profiledComponents: false,
        },
      },
      {
        tier: "same_kind_grade_family",
        minimum: 4,
        options: {
          starforce: "exact",
          magnitude: "kind",
          family: "exact",
          profiledComponents: false,
        },
      },
      {
        tier: "same_kind_grade",
        minimum: 5,
        options: {
          starforce: "exact",
          magnitude: "kind",
          profiledComponents: false,
        },
      },
    ];
    let qualifiedKindFallback = null;
    for (const { tier, minimum, options } of kindTiers) {
      const matches = entries.filter((entry) => structuralComparable(
        target,
        entry.features,
        options,
      ));
      const lowerGroups = supportedLowerOptionGroups(target, matches);
      if (lowerGroups.length) {
        return {
          tier: `lower_envelope_${tier}`,
          entries: lowerGroups.flatMap((group) => group.entries),
          lower_groups: lowerGroups.map((group) => group.entries),
          qualified: true,
        };
      }
      if (!narrowFallback && matches.length) {
        narrowFallback = { tier, entries: matches, qualified: false };
      }
      if (!qualifiedKindFallback && matches.length >= minimum) {
        qualifiedKindFallback = { tier, entries: matches, qualified: true };
      }
    }
    if (qualifiedKindFallback) return qualifiedKindFallback;
  }
  const tiers = [
    {
      tier: "same_state",
      minimum: 5,
      filter: (entry) => structuralComparable(target, entry.features, {
        starforce: "exact",
        upgrade: true,
      }),
    },
    {
      tier: "same_grade",
      minimum: 6,
      filter: (entry) => structuralComparable(target, entry.features, {
        starforce: "exact",
      }),
    },
    {
      tier: "same_band",
      minimum: 8,
      filter: (entry) => structuralComparable(target, entry.features, {
        starforce: "band",
      }),
    },
  ];
  let nearestNonempty = narrowFallback;
  for (const tier of tiers) {
    const matches = entries.filter(tier.filter);
    if (!nearestNonempty && matches.length) {
      nearestNonempty = { tier: tier.tier, entries: matches, qualified: false };
    }
    if (matches.length >= tier.minimum) {
      return { tier: tier.tier, entries: matches, qualified: true };
    }
  }
  return nearestNonempty || { tier: "fallback", entries, qualified: false };
}

/**
 * 구성요소 회귀가 희소 표본에서 intercept를 노작값으로 오인하는 경우를 막는
 * 동일 장비 로컬 보정값이다. 가격 자체를 복사하지 않고, 회귀가 설명할 수 있는
 * 목표/거래 간 차이를 먼저 제거한 잔차 가격의 가중 중앙값을 사용한다.
 */
function localComparableAnchor(target, entries, fitted, trainingSupports) {
  if (!entries.length) return null;
  const targetLog = predictLog(target, fitted);
  const pool = localComparablePool(target, entries);
  const summarize = (sourceEntries, stableOptionWeights = false) => {
    const excludedComponents = stableOptionWeights
      ? new Set(["potential_options", "additional_options"])
      : null;
    const candidates = sourceEntries.map((entry) => {
      const distance = localComparableDistance(
        target,
        entry.features,
        trainingSupports,
        excludedComponents,
      );
      const adjustment = clamp(
        targetLog - predictLog(entry.features, fitted),
        -Math.log(3),
        Math.log(3),
      );
      return {
        value: clamp(entry.price * Math.exp(adjustment), 1, MAX_SAFE_MESO),
        weight: entry.weight / (0.35 + distance) ** 2,
        distance,
      };
    }).sort((left, right) => left.distance - right.distance || left.value - right.value);
    const neighborLimit = Math.min(
      candidates.length,
      stableOptionWeights
        ? candidates.length
        : pool.lower_groups
          ? 12
        : pool.tier === "exact"
          ? 12
          : Math.max(5, Math.min(18, Math.round(Math.sqrt(candidates.length) * 2))),
    );
    const neighbors = candidates.slice(0, neighborLimit);
    const estimate = weightedQuantile(neighbors, 0.5);
    if (!(estimate > 0)) return null;
    return {
      estimate,
      low: weightedQuantile(neighbors, 0.15) ?? estimate,
      high: weightedQuantile(neighbors, 0.85) ?? estimate,
      minimum: Math.min(...neighbors.map(({ value }) => value)),
      maximum: Math.max(...neighbors.map(({ value }) => value)),
      neighbor_count: neighbors.length,
      effective_neighbor_count: effectiveSampleSize(neighbors),
      nearest_distance: neighbors[0]?.distance ?? null,
    };
  };
  // 더 높은 수치의 거래군이 우연히 싸더라도 그 직전 유효 거래군의 가치보다
  // 내려가지 않도록, 목표 이하의 모든 충분한 옵션 수치군을 보정한 뒤 최대값을 쓴다.
  const summaries = (pool.lower_groups || [pool.entries])
    .map(summarize)
    .filter(Boolean);
  const selected = summaries.sort((left, right) => right.estimate - left.estimate)[0];
  if (!selected) return null;
  const hasTargetOption = ["potential_options", "additional_options"]
    .some((component) => componentMagnitude(target, component) > EPSILON);
  let monotonicEnvelope = null;
  let monotonicKnotCount = 0;
  let monotonicScope = null;
  let sparseFamilyEnvelope = null;
  let sparseFamilyEnvelopes = [];
  let sparseFamilyKnotCount = 0;
  if (hasTargetOption) {
    // 같은 스타포스·등급·슬롯 상태·옵션 종류에서 목표 이하인 모든 수치군을
    // 동시에 본다. 특정 exact/family tier가 먼저 선택되어 더 비싼 낮은 수치군을
    // 가리는 것을 막고, 수치가 커질수록 후보 집합이 확장되는 단조 하한을 만든다.
    const broadMonotonicMatches = entries.filter((entry) => structuralComparable(
      target,
      entry.features,
      {
        starforce: "exact",
        upgrade: true,
        magnitude: "kind",
        allowZeroOption: true,
        profiledComponents: false,
      },
    ));
    const familyMonotonicMatches = entries.filter((entry) => structuralComparable(
      target,
      entry.features,
      {
        starforce: "exact",
        upgrade: true,
        magnitude: "kind",
        family: "exact",
        allowZeroOption: true,
        profiledComponents: false,
      },
    ));
    // STR/DEX/INT/LUK는 환산 수치가 같아도 실제 수요와 가격이 다르다. 목표보다
    // 낮은 지점의 표본 수에 따라 중간에서 STANDARD 혼합 곡선으로 갈아타면 다시
    // 가격 역전이 생기므로, 전체 곡선에 유효 knot가 하나라도 있는지는 목표값과
    // 무관하게 결정하고 그 계열을 전 구간에서 고정한다.
    const useExactFamilyEnvelope = hasSupportedOptionShapeGroup(familyMonotonicMatches) ||
      hasConsistentSparseOptionShapeGroup(familyMonotonicMatches, fitted);
    const monotonicMatches = useExactFamilyEnvelope
      ? familyMonotonicMatches
      : broadMonotonicMatches;
    monotonicScope = useExactFamilyEnvelope
      ? "exact_family"
      : "standard_family_fallback";
    // 유효 옵션이 없는 0 지점은 아래의 독립적인 zero-option floor에서 한 번만
    // 처리한다. active 곡선의 94% envelope에도 다시 넣으면 1%처럼 첫 양수
    // 입력이 0옵션 거래가로 급격히 끌려가며 경계에서 왜곡될 수 있다.
    const positiveOptionGroup = (group) => ["potential", "additional"].some((prefix) =>
      Object.values(group.shapes?.[prefix] || {}).some((value) => value > EPSILON)
    );
    const monotonicGroups = supportedLowerOptionGroups(target, monotonicMatches)
      .filter(positiveOptionGroup);
    monotonicKnotCount = monotonicGroups.length;
    monotonicEnvelope = monotonicGroups
      .map((group) => summarize(group.entries, true))
      .filter(Boolean)
      .sort((left, right) => right.estimate - left.estimate)[0] || null;
    // 동일 계열·동일 조건 두 거래가 서로 25% 안에서 일치할 때만 희소 knot로
    // 인정한다. 한 건짜리 매물이나 서로 크게 어긋난 두 건은 점 추정에 쓰지 않는다.
    const sparseFamilyGroups = consistentSparseLowerOptionGroups(
      target,
      familyMonotonicMatches,
      fitted,
    ).filter(positiveOptionGroup);
    sparseFamilyKnotCount = sparseFamilyGroups.length;
    sparseFamilyEnvelopes = sparseFamilyGroups
      .map((group) => summarize(group.entries, true))
      .filter(Boolean);
    sparseFamilyEnvelope = sparseFamilyEnvelopes
      .sort((left, right) => right.estimate - left.estimate)[0] || null;
  }
  return {
    ...selected,
    tier: pool.tier,
    structural_match_count: pool.entries.length,
    lower_knot_count: pool.lower_groups?.length || 0,
    monotonic_knot_count: monotonicKnotCount,
    monotonic_envelope: monotonicEnvelope,
    sparse_family_knot_count: sparseFamilyKnotCount,
    sparse_family_envelope: sparseFamilyEnvelope,
    sparse_family_envelopes: sparseFamilyEnvelopes,
    // 첫 관측 knot보다 낮아 아직 envelope가 비어 있어도 curve scope는 유지한다.
    // 그래야 그 구간에서 임의 로컬 pool로 되돌아가며 생기는 경계 역전을 막는다.
    monotonic_scope: monotonicScope,
    qualified: pool.qualified && selected.effective_neighbor_count >= 2.5,
  };
}

function gradeComponentSpec(component) {
  if (component === "potential_grade") {
    return { prefix: "potential", optionComponent: "potential_options" };
  }
  if (component === "additional_grade") {
    return { prefix: "additional", optionComponent: "additional_options" };
  }
  return null;
}

function withComponentGradeRank(features, component, rank) {
  const spec = gradeComponentSpec(component);
  if (!spec) return features;
  const boundedRank = clamp(Math.round(nonnegative(rank)), 0, GRADE_RANK.legendary);
  const vector = { ...features.vector };
  Object.assign(vector, gradeFeatures(spec.prefix, boundedRank));
  // 등급과 옵션의 상호작용 feature도 함께 바꿔야 동일 옵션을 둔 채 등급만
  // 낮춘 반사실이 된다. one-hot만 바꾸면 유니크/레전드리 옵션 효과가 이전
  // 등급에서 그대로 남아 등급별 총액을 같게 만들거나 역전시킬 수 있다.
  const combat = spec.prefix === "potential"
    ? nonnegative(vector.potential_combat) +
      nonnegative(vector.potential_combat_above_21) +
      nonnegative(vector.potential_combat_above_33)
    : nonnegative(vector.additional_combat) +
      nonnegative(vector.additional_combat_above_8) +
      nonnegative(vector.additional_combat_above_16);
  vector[`${spec.prefix}_unique_combat`] = boundedRank === GRADE_RANK.unique
    ? combat
    : 0;
  vector[`${spec.prefix}_legendary_combat`] = boundedRank === GRADE_RANK.legendary
    ? combat
    : 0;
  return {
    ...features,
    vector,
    components: {
      ...features.components,
      [component]: boundedRank,
    },
  };
}

function expectedAttemptsWithPity(probability, pity) {
  const chance = Number(probability);
  if (!(chance > 0) || chance > 1) return Number.POSITIVE_INFINITY;
  if (!Number.isInteger(Number(pity)) || Number(pity) <= 0) return 1 / chance;
  return -Math.expm1(Number(pity) * Math.log1p(-chance)) / chance;
}

function pooledAdditionalGradeStepPremium(target, lowerEstimate, currentRank) {
  const prior = ADDITIONAL_GRADE_STEP_PRIOR[Math.round(nonnegative(currentRank))];
  if (!prior || !(lowerEstimate > 0)) return null;
  let cap = Number(prior.absolute_cap_meso);
  if (!(cap > 0) && prior.from_grade) {
    // 구형/합성 자료에 base_level이 없더라도 공통 등급 기준 자체를 버리면
    // 레어 이후 모든 등급이 같은 가격이 된다. 이때는 큐브 비용의 최저
    // 레벨 구간을 사용해 가장 보수적인 양의 등급 프리미엄만 남긴다.
    const observedLevel = Number(target.base_level);
    const itemLevel = observedLevel > 0 ? observedLevel : 1;
    const rankUp = getPotentialRankUpInfo({
      system: "additional",
      method: "meso",
      grade: prior.from_grade,
      miracle: false,
    });
    const resetCost = getPotentialResetCost(
      itemLevel,
      prior.from_grade,
      "additional",
      "meso",
    );
    const expectedCost = expectedAttemptsWithPity(rankUp?.probability, rankUp?.pity) *
      Number(resetCost);
    cap = expectedCost * Number(prior.expected_cost_cap_ratio);
  }
  if (!(cap > 0) || !Number.isFinite(cap)) return null;
  const premium = Math.min(lowerEstimate * prior.ratio, cap);
  if (!(premium > 0)) return null;
  return {
    source: "pooled_grade_prior",
    premium,
    ratio: prior.ratio,
    cap_meso: cap,
    log_effect: Math.log1p(premium / lowerEstimate),
  };
}

function gradeStepPremiumEvidence({
  target,
  lowerTarget,
  entries,
  fitted,
  validation,
  gradeComponent,
}) {
  const currentRank = Math.round(nonnegative(target.components[gradeComponent]));
  const lowerRank = Math.round(nonnegative(lowerTarget.components[gradeComponent]));
  const exactRankEntries = (rank) => entries.filter((entry) =>
    Math.round(nonnegative(entry.features.components[gradeComponent])) === rank
  );
  const lowerEntries = exactRankEntries(lowerRank);
  const currentEntries = exactRankEntries(currentRank);
  const lowerEffective = effectiveSampleSize(lowerEntries);
  const currentEffective = effectiveSampleSize(currentEntries);
  const supported = lowerEntries.length >= 2 && currentEntries.length >= 2 &&
    lowerEffective >= 1.8 && currentEffective >= 1.8;
  const stronglySupported = lowerEntries.length >= 3 && currentEntries.length >= 3 &&
    lowerEffective >= 2.5 && currentEffective >= 2.5;
  const stepEffect = (model) => FEATURE_DEFINITIONS
    .filter((definition) => definition.component === gradeComponent)
    .reduce((sum, definition) => sum + (
      nonnegative(target.vector[definition.key]) -
      nonnegative(lowerTarget.vector[definition.key])
    ) * finite(model?.coefficients?.[definition.key]), 0);
  const learnedLogEffect = Math.max(0, stepEffect(fitted));
  const stepKeys = FEATURE_DEFINITIONS
    .filter((definition) => definition.component === gradeComponent &&
      Math.abs(
        nonnegative(target.vector[definition.key]) -
          nonnegative(lowerTarget.vector[definition.key]),
      ) > EPSILON)
    .map((definition) => definition.key);
  // 시간 분리 학습군에 해당 등급 단계가 하나도 없으면 계수 0은
  // '프리미엄 없음'이 아니라 '검증 불가'다. 이 경우 전체 표본의 양쪽
  // 유효 표본이 각각 2.5건 이상인지로 대신 판정한다.
  const validationCanJudgeStep = Boolean(
    validation?.available && validation.fitted && stepKeys.length &&
      stepKeys.every((key) => validation.fitted.featureVariation?.[key] === true),
  );
  const validationLogEffect = validationCanJudgeStep
    ? Math.max(0, stepEffect(validation.fitted))
    : null;
  const effectRatio = validationLogEffect !== null && learnedLogEffect > EPSILON
    ? validationLogEffect / learnedLogEffect
    : null;
  const temporalStable = validationLogEffect === null
    ? stronglySupported
    : validationLogEffect >= 0.003 && effectRatio >= 0.2 && effectRatio <= 5;
  const qualified = supported && learnedLogEffect >= 0.003 && temporalStable;
  return {
    qualified,
    learned_log_effect: learnedLogEffect,
    validation_log_effect: validationLogEffect,
    validation_effect_ratio: effectRatio,
    lower_grade_rank: lowerRank,
    current_grade_rank: currentRank,
    lower_grade_records: lowerEntries.length,
    current_grade_records: currentEntries.length,
    lower_grade_effective_records: lowerEffective,
    current_grade_effective_records: currentEffective,
    validation_can_judge_step: validationCanJudgeStep,
    temporal_stable: temporalStable,
  };
}

function sameTradeState(target, comparable) {
  const targetState = String(target.components.trade_state || "");
  const comparableState = String(comparable.components.trade_state || "");
  return targetState === comparableState && sameObservedNumber(
    target.components.scissors_remaining,
    comparable.components.scissors_remaining,
  );
}

function censoredGradeStateMatches(target, comparable, gradeComponent) {
  const spec = gradeComponentSpec(gradeComponent);
  if (!spec) return false;
  const otherPrefix = spec.prefix === "potential" ? "additional" : "potential";
  const otherOptionComponent = spec.optionComponent === "potential_options"
    ? "additional_options"
    : "potential_options";
  return sameObservedNumber(target.components.starforce, comparable.components.starforce) &&
    sameObservedNumber(
      target.components.potential_grade,
      comparable.components.potential_grade,
    ) &&
    sameObservedNumber(
      target.components.additional_grade,
      comparable.components.additional_grade,
    ) &&
    sameUpgradeState(target, comparable) &&
    sameTradeState(target, comparable) &&
    componentFamilyMatches(target, comparable, otherOptionComponent, "exact") &&
    optionShapeMatches(target, comparable, otherPrefix, "exact");
}

function adjustedComparableCandidate(
  target,
  entry,
  fitted,
  trainingSupports,
  excludedComponents,
  optionPrefix = null,
  independentlyCappedComponents = null,
) {
  const componentAdjustments = new Map();
  const rawAdjustment = FEATURE_DEFINITIONS.reduce((sum, definition) => {
    if (excludedComponents.has(definition.component)) return sum;
    const value = (
      target.vector[definition.key] - entry.features.vector[definition.key]
    ) * finite(fitted.coefficients[definition.key]);
    componentAdjustments.set(
      definition.component,
      (componentAdjustments.get(definition.component) || 0) + value,
    );
    return sum + value;
  }, 0);
  let adjustment;
  if (independentlyCappedComponents?.size) {
    const independentAdjustment = [...independentlyCappedComponents]
      .reduce((sum, component) => sum + clamp(
        componentAdjustments.get(component) || 0,
        -Math.log(3),
        Math.log(3),
      ), 0);
    const independentRaw = [...independentlyCappedComponents]
      .reduce((sum, component) => sum + (componentAdjustments.get(component) || 0), 0);
    const remainingAdjustment = clamp(
      rawAdjustment - independentRaw,
      -Math.log(3),
      Math.log(3),
    );
    adjustment = clamp(
      independentAdjustment + remainingAdjustment,
      -Math.log(9),
      Math.log(9),
    );
  } else {
    adjustment = clamp(rawAdjustment, -Math.log(3), Math.log(3));
  }
  const distance = localComparableDistance(
    target,
    entry.features,
    trainingSupports,
    excludedComponents,
  );
  return {
    value: clamp(entry.price * Math.exp(adjustment), 1, MAX_SAFE_MESO),
    weight: entry.weight / (0.35 + distance) ** 2,
    // 거래 두 건이 실제로 존재하는지는 시간·품질 가중치로 판정한다. 목표와의
    // 거리 가중치는 가격 중앙값에만 쓰며, 이를 표본 수 판정에도 쓰면 동일 상태의
    // 두 거래 중 작은 거리 차이만으로 한 건이 사실상 사라질 수 있다.
    support_weight: entry.weight,
    distance,
    magnitude: 0,
    option_signature: optionPrefix
      ? gradeFrontierOptionSignature(entry.features, optionPrefix)
      : null,
    support_eligible: distance <= 1.5 && Math.abs(rawAdjustment) <= Math.log(2),
  };
}

function gradeFrontierOptionSignature(features, prefix) {
  const kinds = features.option_kinds?.[prefix] || {};
  // 저옵션 기준점에서는 같은 유효 축을 비교한다. 예를 들어 DEX 12%에 HP
  // 잡옵이 한 줄 더 붙어도 DEX 9%와 같은 주스탯% 축이다. 반대로 드롭·메획·
  // 쿨감은 같은 정규화 magnitude라도 서로 다른 시장 가치이므로 섞지 않는다.
  const families = [
    ["stat_percent", ["stat_percent", "all_stat_percent"]],
    ["attack_percent", ["attack_percent"]],
    ["magic_attack_percent", ["magic_attack_percent"]],
    ["critical_damage_percent", ["critical_damage_percent"]],
    ["damage_percent", ["damage_percent"]],
    ["ignore_defense_percent", ["ignore_defense_percent"]],
    ["item_drop_rate", ["item_drop_rate"]],
    ["meso_obtained", ["meso_obtained"]],
    ["cooldown_reduction", ["cooldown_reduction"]],
    ["auto_steal", ["auto_steal"]],
    ["stat_flat", ["stat_flat", "all_stat_flat", "stat_per_level"]],
    ["attack_flat", ["attack_flat"]],
    ["magic_attack_flat", ["magic_attack_flat"]],
    ["hp_percent", ["hp_percent"]],
    ["hp_flat", ["hp_flat"]],
  ];
  const matched = families.find(([, keys]) => keys.some((key) => nonnegative(kinds[key]) > 0));
  return matched?.[0] || stableValue(kinds);
}

function stableLowPriceCluster(candidates, maximumRatio = 1.25) {
  const eligible = candidates.filter((candidate) => candidate.support_eligible !== false);
  if (eligible.length < 2) return null;
  const supportEffectiveSize = (entries) => effectiveSampleSize(entries.map((entry) => ({
    weight: entry.support_weight ?? entry.weight,
  })));
  const sorted = [...eligible].sort((left, right) => left.value - right.value);
  const clusters = sorted.map((candidate) => sorted.filter((entry) =>
    entry.value + 1 >= candidate.value && entry.value <= candidate.value * maximumRatio + 1
  )).filter((cluster) => cluster.length >= 2 && supportEffectiveSize(cluster) >= 1.8);
  const summarized = clusters.map((cluster) => ({
    entries: cluster,
    estimate: weightedQuantile(cluster, 0.5),
    low: weightedQuantile(cluster, 0.15),
    high: weightedQuantile(cluster, 0.85),
    minimum: Math.min(...cluster.map((entry) => entry.value)),
    maximum: Math.max(...cluster.map((entry) => entry.value)),
    neighbor_count: cluster.length,
    effective_neighbor_count: supportEffectiveSize(cluster),
    magnitude_minimum: Math.min(...cluster.map((entry) => entry.magnitude)),
    magnitude_maximum: Math.max(...cluster.map((entry) => entry.magnitude)),
  })).filter((summary) => summary.estimate > 0);
  return summarized.sort((left, right) =>
    left.estimate - right.estimate || right.neighbor_count - left.neighbor_count
  )[0] || null;
}

function supportedOptionFrontiers(candidates) {
  const bySignature = new Map();
  for (const candidate of candidates) {
    if (candidate.magnitude <= EPSILON) continue;
    const signature = candidate.option_signature || "{}";
    if (!bySignature.has(signature)) bySignature.set(signature, []);
    bySignature.get(signature).push(candidate);
  }
  const frontiers = [];
  for (const [signature, entries] of bySignature) {
    const active = [...entries].sort((left, right) =>
      left.magnitude - right.magnitude || left.value - right.value
    );
    const seeds = [...new Set(active.map((candidate) => candidate.magnitude))];
    for (const seed of seeds) {
      // componentMagnitude는 정의별 scale로 정규화된 값이다. 3을 더하면 9%와
      // 21%가 사실상 한 구간이 되므로, 첫 저옵션 주변의 좁은 구간만 묶는다.
      const maximum = seed + Math.max(0.25, seed * 0.35);
      const cluster = stableLowPriceCluster(active.filter((candidate) =>
        candidate.magnitude + EPSILON >= seed && candidate.magnitude <= maximum + EPSILON
      ));
      if (cluster) {
        frontiers.push({ ...cluster, option_signature: signature });
        break;
      }
    }
  }
  return frontiers.sort((left, right) =>
    left.estimate - right.estimate || right.effective_neighbor_count - left.effective_neighbor_count
  );
}

/**
 * UI에서 등급만 고르고 옵션을 비운 상태는 실제 0줄 잠재가 아니라 그 등급의
 * 잡옵 상태다. 같은 등급의 직접 잡옵 거래가 없으면 가장 낮은 유효 옵션 거래
 * 구간에서, 바로 아래 등급에서 관측한 저옵션 프리미엄만 제거해 검열된
 * (censored) 잡옵 기준가를 복원한다. 세 군 모두 일치하는 거래가 두 건 이상이고
 * 서로 25% 안에 있을 때만 사용해 한 건짜리 이상치를 가격 하한으로 만들지 않는다.
 */
function censoredGradeOnlyAnchor(target, entries, fitted, trainingSupports, gradeComponent) {
  const spec = gradeComponentSpec(gradeComponent);
  const targetRank = nonnegative(target.components[gradeComponent]);
  if (!spec || targetRank <= 1 ||
      componentMagnitude(target, spec.optionComponent) > EPSILON) return null;
  const excluded = new Set([spec.optionComponent]);
  const candidateCache = new Map();
  const candidatesFor = (state, active) => {
    const key = `${nonnegative(state.components[gradeComponent])}:${active ? 1 : 0}`;
    if (candidateCache.has(key)) return candidateCache.get(key);
    const candidates = entries.filter((entry) =>
      censoredGradeStateMatches(state, entry.features, gradeComponent) &&
      (componentMagnitude(entry.features, spec.optionComponent) > EPSILON) === active
    ).map((entry) => {
    const candidate = adjustedComparableCandidate(
      state,
      entry,
      fitted,
      trainingSupports,
      excluded,
      spec.prefix,
    );
    candidate.magnitude = componentMagnitude(entry.features, spec.optionComponent);
    return candidate;
    });
    candidateCache.set(key, candidates);
    return candidates;
  };

  // 직접 잡옵 거래가 둘 이상 안정적으로 관측되면 generic 로컬 pool보다 이
  // 조건부 거래를 우선한다. generic pool은 추옵 모양까지 exact로 요구해 정작
  // 잡옵 거래 두 건을 한 건만 남길 수 있기 때문이다.
  const directBlank = stableLowPriceCluster(candidatesFor(target, false));
  if (directBlank) {
    return {
      ...directBlank,
      nearest_distance: directBlank.entries[0]?.distance ?? null,
      tier: "direct_grade_blank",
      qualified: true,
      evidence_kind: "direct",
      grade_component: gradeComponent,
      target_grade_rank: targetRank,
      lower_grade_rank: null,
      target_frontier_magnitude: null,
      lower_grade_option_premium_ratio: null,
    };
  }
  const targetFrontiers = supportedOptionFrontiers(candidatesFor(target, true));
  if (!targetFrontiers.length) return null;

  const recovered = [];
  for (const targetFrontier of targetFrontiers) {
    for (let rank = targetRank - 1; rank >= 1; rank -= 1) {
      const lowerTarget = withComponentGradeRank(target, gradeComponent, rank);
      const lowerBlank = stableLowPriceCluster(candidatesFor(lowerTarget, false));
      if (!lowerBlank) continue;
      const toleranceLow = Math.max(
        EPSILON,
        targetFrontier.magnitude_minimum * 0.9,
      );
      const toleranceHigh = Math.max(
        toleranceLow,
        targetFrontier.magnitude_maximum * 1.1,
      );
      const lowerActive = stableLowPriceCluster(candidatesFor(lowerTarget, true).filter(
        (candidate) => candidate.option_signature === targetFrontier.option_signature &&
          candidate.magnitude + EPSILON >= toleranceLow &&
          candidate.magnitude <= toleranceHigh + EPSILON,
      ));
      if (!lowerActive) continue;
      const rawRatio = lowerActive.estimate / Math.max(EPSILON, lowerBlank.estimate);
      if (!(rawRatio >= 0.8 && rawRatio <= 1.5)) continue;
      const ratio = clamp(rawRatio, 1, 1.35);
      const estimate = targetFrontier.estimate / ratio;
      if (!(estimate > 0)) continue;
      recovered.push({
        estimate,
        low: targetFrontier.low / ratio,
        high: targetFrontier.high / ratio,
        minimum: targetFrontier.minimum / ratio,
        maximum: targetFrontier.maximum / ratio,
        neighbor_count: targetFrontier.neighbor_count,
        effective_neighbor_count: Math.min(
          targetFrontier.effective_neighbor_count,
          lowerBlank.effective_neighbor_count,
          lowerActive.effective_neighbor_count,
        ),
        nearest_distance: targetFrontier.entries[0]?.distance ?? null,
        tier: "censored_grade_frontier",
        qualified: true,
        evidence_kind: "censored",
        grade_component: gradeComponent,
        target_grade_rank: targetRank,
        lower_grade_rank: rank,
        target_frontier_magnitude: {
          minimum: targetFrontier.magnitude_minimum,
          maximum: targetFrontier.magnitude_maximum,
        },
        option_signature: targetFrontier.option_signature,
        lower_grade_option_premium_ratio: ratio,
      });
      break;
    }
  }
  return recovered.sort((left, right) =>
    left.estimate - right.estimate || right.effective_neighbor_count - left.effective_neighbor_count
  )[0] || null;
}

function localPoolingWeight({
  target,
  supports,
  effective,
  confidenceScore,
  componentEstimate,
  localAnchor,
}) {
  if (!localAnchor) return 0;
  if (localAnchor.qualified) {
    const neighborSupport = clamp(localAnchor.effective_neighbor_count / 6, 0, 1);
    const tierWeight = {
      exact_all_family: [0.86, 0.94],
      exact_all: [0.82, 0.92],
      exact_family: [0.8, 0.92],
      exact: [0.76, 0.9],
      same_kind_all_family: [0.8, 0.92],
      same_kind_all: [0.76, 0.9],
      same_kind_state_family: [0.7, 0.84],
      same_kind_state: [0.64, 0.8],
      same_kind_grade_family: [0.58, 0.75],
      same_kind_grade: [0.52, 0.7],
      lower_envelope_same_kind_all_family: [0.86, 0.94],
      lower_envelope_same_kind_all: [0.86, 0.94],
      lower_envelope_same_kind_state_family: [0.86, 0.94],
      lower_envelope_same_kind_state: [0.86, 0.94],
      lower_envelope_same_kind_grade_family: [0.86, 0.94],
      lower_envelope_same_kind_grade: [0.86, 0.94],
      same_state: [0.62, 0.8],
      same_grade: [0.48, 0.7],
      same_band: [0.36, 0.58],
    }[localAnchor.tier];
    if (tierWeight) {
      return tierWeight[0] + (tierWeight[1] - tierWeight[0]) * neighborSupport;
    }
  }
  if ([
    "exact_all_family",
    "exact_all",
    "exact_family",
    "exact",
    "same_kind_all_family",
    "same_kind_all",
    "same_kind_state_family",
    "same_kind_state",
    "same_kind_grade_family",
    "same_kind_grade",
    "lower_envelope_same_kind_all_family",
    "lower_envelope_same_kind_all",
    "lower_envelope_same_kind_state_family",
    "lower_envelope_same_kind_state",
    "lower_envelope_same_kind_grade_family",
    "lower_envelope_same_kind_grade",
  ].includes(localAnchor.tier)) {
    const neighbors = localAnchor.effective_neighbor_count;
    if (neighbors >= 2) {
      if (["exact_all_family", "exact_family"].includes(localAnchor.tier)) return 0.72;
      if (["exact_all", "exact"].includes(localAnchor.tier)) return 0.68;
      return localAnchor.tier.startsWith("lower_envelope") ? 0.58 : 0.48;
    }
    return localAnchor.tier.includes("same_kind") ? 0.3 : 0.42;
  }
  const active = COMPONENTS.slice(1)
    .map(([key]) => key)
    .filter((component) => FEATURE_DEFINITIONS.some(
      (definition) => definition.component === component &&
        target.vector[definition.key] > EPSILON,
    ));
  const unsupported = active.filter((component) =>
    !supports[component]?.identifiable || supports[component]?.extrapolated
  ).length;
  const unsupportedRatio = active.length ? unsupported / active.length : 0;
  const sparse = clamp((18 - effective) / 18, 0, 1);
  const collapsed = componentEstimate < localAnchor.estimate * 0.35 ? 1 : 0;
  if (sparse === 0 && unsupportedRatio === 0 && collapsed === 0) return 0;
  const fallbackWeight = clamp(
    0.08 + sparse * 0.32 + unsupportedRatio * 0.2 +
      (1 - confidenceScore) * 0.13 + collapsed * 0.16,
    0,
    0.78,
  );
  return localAnchor.qualified ? fallbackWeight : Math.min(0.35, fallbackWeight);
}

function sparsePairCalibration(componentEstimate, anchor, anchorDelta = 0) {
  if (!anchor || anchor.neighbor_count !== 2) return null;
  const lower = anchor.minimum + anchorDelta;
  const upper = anchor.maximum + anchorDelta;
  const robustAnchor = clamp(
    quantile([componentEstimate, lower, upper], 0.5) ?? componentEstimate,
    componentEstimate,
    componentEstimate * 4,
  );
  return {
    anchor_meso: robustAnchor,
    estimate_meso: Math.max(
      componentEstimate,
      componentEstimate * 0.06 + robustAnchor * 0.94,
    ),
  };
}

function bestSparsePairCalibration(componentEstimate, anchors, anchorDelta = 0) {
  return (anchors || [])
    .map((anchor) => {
      const calibration = sparsePairCalibration(componentEstimate, anchor, anchorDelta);
      return calibration ? { ...calibration, source_anchor: anchor } : null;
    })
    .filter(Boolean)
    .sort((left, right) => right.estimate_meso - left.estimate_meso)[0] || null;
}

function distributePoolingAdjustment(decomposition, adjustment, target, supports) {
  if (Math.abs(adjustment) <= EPSILON) return;
  const active = COMPONENTS.slice(1)
    .map(([key]) => key)
    .filter((component) => FEATURE_DEFINITIONS.some(
      (definition) => definition.component === component &&
        target.vector[definition.key] > EPSILON,
    ));
  const uncertain = active.filter((component) =>
    component !== "trade" &&
    (!supports[component]?.identifiable || supports[component]?.extrapolated)
  );
  const nonTrade = active.filter((component) => component !== "trade");
  const candidates = uncertain.length
    ? uncertain
    : nonTrade.length
      ? nonTrade
      : active.length
        ? active
        : ["potential_options"];
  if (adjustment < 0) {
    const preferred = new Set(candidates);
    const positive = COMPONENTS.slice(1)
      .map(([key]) => key)
      .filter((component) => decomposition[component] > EPSILON)
      .sort((left, right) =>
        Number(preferred.has(right)) - Number(preferred.has(left)) ||
        decomposition[right] - decomposition[left]
      );
    const positiveTotal = positive.reduce(
      (sum, component) => sum + decomposition[component],
      0,
    );
    let remaining = -adjustment;
    for (let index = 0; index < positive.length; index += 1) {
      const component = positive[index];
      const reduction = index === positive.length - 1
        ? Math.min(decomposition[component], remaining)
        : Math.min(
            decomposition[component],
            -adjustment * decomposition[component] / Math.max(EPSILON, positiveTotal),
          );
      decomposition[component] -= reduction;
      remaining -= reduction;
    }
    if (remaining > EPSILON) decomposition.trade -= remaining;
    return;
  }
  const weights = candidates.map((component) => ({
    component,
    weight: Math.max(0.25, componentMagnitude(target, component)),
  }));
  const totalWeight = weights.reduce((sum, entry) => sum + entry.weight, 0);
  let assigned = 0;
  for (let index = 0; index < weights.length; index += 1) {
    const { component, weight } = weights[index];
    const share = index === weights.length - 1
      ? adjustment - assigned
      : adjustment * weight / totalWeight;
    decomposition[component] += share;
    assigned += share;
  }
}

function normalizedWeightEntries(entries) {
  const copies = entries.map((entry) => ({ ...entry }));
  const scale = copies.length / Math.max(
    EPSILON,
    copies.reduce((sum, entry) => sum + entry.weight, 0),
  );
  for (const entry of copies) entry.weight *= scale;
  return copies;
}

/**
 * 시간순 최신 20%를 한 번도 학습에 보여주지 않고 평가한다. 같은 날짜 경계는
 * 통째로 검증 쪽에 두어 사실상 같은 거래 묶음이 양쪽에 섞이는 것을 피한다.
 */
function temporalHoldoutValidation(entries, lambda) {
  const timed = entries
    .filter((entry) => Number.isFinite(entry.soldTime) && entry.soldTime > 0)
    .sort((left, right) => left.soldTime - right.soldTime || left.price - right.price);
  const uniqueTimes = new Set(timed.map((entry) => entry.soldTime));
  if (timed.length < 30 || uniqueTimes.size < 4) {
    return {
      available: false,
      reason: timed.length < 30 ? "too_few_timed_sales" : "too_few_distinct_sale_times",
      train_count: 0,
      holdout_count: 0,
      accuracy_score: null,
      fitted: null,
    };
  }

  let split = Math.floor(timed.length * 0.8);
  const minimumTrain = Math.max(20, Math.floor(timed.length * 0.6));
  while (split > minimumTrain && timed[split - 1]?.soldTime === timed[split]?.soldTime) split -= 1;
  const training = normalizedWeightEntries(timed.slice(0, split));
  const holdout = timed.slice(split);
  if (training.length < 20 || holdout.length < 6) {
    return {
      available: false,
      reason: "holdout_too_small",
      train_count: training.length,
      holdout_count: holdout.length,
      accuracy_score: null,
      fitted: null,
    };
  }

  const fitted = fitNonnegativeRidge(training, FEATURE_DEFINITIONS, lambda);
  const observations = holdout.map((entry) => {
    const predictedLog = predictLog(entry.features, fitted);
    const actualLog = Math.log(entry.price);
    const logError = predictedLog - actualLog;
    return {
      residual: actualLog - predictedLog,
      absolute_log_error: Math.abs(logError),
      absolute_percent_error: Math.abs(Math.exp(logError) - 1),
      predicted_to_actual_ratio: Math.exp(logError),
    };
  });
  const medianAbsoluteLogError = quantile(observations.map((row) => row.absolute_log_error), 0.5) ?? 1;
  const medianAbsolutePercentError = quantile(
    observations.map((row) => row.absolute_percent_error),
    0.5,
  ) ?? 1;
  const medianRatio = quantile(observations.map((row) => row.predicted_to_actual_ratio), 0.5) ?? 1;
  const within25 = observations.filter((row) => row.absolute_percent_error <= 0.25).length /
    observations.length;
  const errorScore = Math.exp(-medianAbsoluteLogError / 0.28);
  const coverageScore = clamp(within25 / 0.75, 0, 1);
  const biasScore = Math.exp(-Math.abs(Math.log(Math.max(EPSILON, medianRatio))) / 0.3);
  const accuracyScore = clamp(errorScore * 0.5 + coverageScore * 0.3 + biasScore * 0.2, 0, 1);
  const residuals = observations.map((row) => row.residual);
  const absoluteLogErrors = observations
    .map((row) => row.absolute_log_error)
    .sort((left, right) => left - right);
  // 유한 표본 conformal 분위수. 단순 보간 분위수보다 표본이 적을 때 범위를
  // 좁게 잡지 않으며, 시간순 검증에서 관측한 절대 로그 오차의 90%를 덮는다.
  const conformalIndex = Math.min(
    absoluteLogErrors.length - 1,
    Math.max(0, Math.ceil((absoluteLogErrors.length + 1) * 0.9) - 1),
  );
  return {
    available: true,
    reason: null,
    train_count: training.length,
    holdout_count: holdout.length,
    accuracy_score: accuracyScore,
    median_absolute_log_error: medianAbsoluteLogError,
    median_absolute_percent_error: medianAbsolutePercentError,
    median_predicted_to_actual_ratio: medianRatio,
    within_25_percent: within25,
    residual_low: quantile(residuals, 0.1) ?? 0,
    residual_high: quantile(residuals, 0.9) ?? 0,
    conformal_log_radius_90: absoluteLogErrors[conformalIndex] ?? 0,
    fitted,
  };
}

function componentLogEffects(target, model) {
  const effects = Object.fromEntries(COMPONENTS.slice(1).map(([key]) => [key, 0]));
  for (const definition of FEATURE_DEFINITIONS) {
    effects[definition.component] +=
      target.vector[definition.key] * finite(model.coefficients[definition.key]);
  }
  // 계열 더미는 STR 대비 시장 차이를 나타내므로 음수일 수 있지만, 유효 옵션
  // 전체가 같은 등급의 잡옵 상태보다 장비값을 깎는 것으로 해석되면 안 된다.
  effects.potential_options = Math.max(0, effects.potential_options);
  effects.additional_options = Math.max(0, effects.additional_options);
  return effects;
}

function withoutOptionComponent(features, component) {
  const prefix = component === "potential_options" ? "potential" : "additional";
  const vector = { ...features.vector };
  for (const definition of FEATURE_DEFINITIONS) {
    if (definition.component === component) vector[definition.key] = 0;
  }
  const components = { ...features.components };
  for (const key of componentFields(component)) components[key] = 0;
  return {
    ...features,
    vector,
    components,
    option_kinds: {
      ...features.option_kinds,
      [prefix]: {},
    },
    option_stat_codes: {
      ...features.option_stat_codes,
      [prefix]: {},
    },
  };
}

function withoutStarforceComponent(features) {
  const vector = { ...features.vector };
  for (const definition of FEATURE_DEFINITIONS) {
    if (definition.component === "starforce") vector[definition.key] = 0;
  }
  return {
    ...features,
    vector,
    components: {
      ...features.components,
      starforce: 0,
    },
  };
}

function exactOptionEvidenceShapeMatches(target, comparable, prefix) {
  return stableValue(target.option_kinds?.[prefix] || {}) ===
      stableValue(comparable.option_kinds?.[prefix] || {}) &&
    stableValue(target.option_stat_codes?.[prefix] || {}) ===
      stableValue(comparable.option_stat_codes?.[prefix] || {});
}

/**
 * 같은 스타포스 구간에 목표 옵션 거래가 없을 때도, 더 높은 스타포스 장비에
 * 남아 있는 동일 잠재 패키지의 시장가를 완전히 잃지 않게 한다.
 *
 * 거래가 전체에서 잠재가 차지하는 비율은 회귀의 `옵션 있음 ↔ 옵션 없음`
 * 반사실 비율로 나누되, 먼저 판매 완료가를 목표 스타포스 상태로 보정한다. 같은 등급·
 * 같은 옵션 종류·같은 원시 스탯 코드인 거래만 허용하므로 전사 장비의 INT 같은
 * 무효 스탯은 STR 하한에 들어오지 않는다. 목표 이하의 각 옵션 수치 knot에서
 * 보수적인 15% 분위수를 구한 뒤 그 최댓값을 쓰므로 목표 수치가 커져도 하한이
 * 내려가지 않는다.
 */
function crossStarOptionPackageFloor(
  target,
  entries,
  fitted,
  trainingSupports,
  component,
  zeroStateEstimate,
) {
  const spec = component === "potential_options"
    ? { prefix: "potential", grade: "potential_grade" }
    : component === "additional_options"
      ? { prefix: "additional", grade: "additional_grade" }
      : null;
  const targetMagnitude = componentMagnitude(target, component);
  const targetStarforce = nonnegative(target.components.starforce);
  if (!spec || targetMagnitude <= EPSILON ||
      nonnegative(target.components[spec.grade]) <= EPSILON) return null;

  const zeroStarTarget = withoutStarforceComponent(target);
  const groups = new Map();
  for (const entry of entries) {
    const comparable = entry.features;
    const magnitude = componentMagnitude(comparable, component);
    if (magnitude <= EPSILON || magnitude > targetMagnitude + 0.01 ||
        nonnegative(comparable.components.starforce) + EPSILON < targetStarforce ||
        !sameObservedNumber(
          target.components[spec.grade],
          comparable.components[spec.grade],
        ) ||
        !componentFamilyMatches(target, comparable, component, "exact") ||
        !exactOptionEvidenceShapeMatches(target, comparable, spec.prefix)) {
      continue;
    }
    const normalized = adjustedComparableCandidate(
      target,
      entry,
      fitted,
      trainingSupports,
      new Set([component]),
      null,
      new Set(["starforce"]),
    );
    const logEffect = Math.max(0, componentTargetLogEffect(
      comparable,
      fitted,
      component,
    ) ?? 0);
    const modelAllocatedPremium = normalized.value * (1 - Math.exp(-logEffect));
    // 고스타포스 완제품의 원가격을 잠재 프리미엄으로 그대로 가져오면 0성과
    // 고성 장비에 같은 가격 하한이 붙는다. 목표 상태로 보정한 거래가에서 계산한
    // 두 상한 중 작은 값만 사용해 스타포스·작·에디 가격이 잠재로 새는 것을 막는다.
    const stateNormalizedPremium = Math.max(
      0,
      normalized.value - nonnegative(zeroStateEstimate),
    );
    const premium = logEffect > EPSILON
      ? Math.min(modelAllocatedPremium, stateNormalizedPremium)
      : stateNormalizedPremium;
    if (!(premium > 0)) continue;
    const zeroStarNormalized = targetStarforce <= EPSILON
      ? normalized
      : adjustedComparableCandidate(
          zeroStarTarget,
          entry,
          fitted,
          trainingSupports,
          new Set([component]),
          null,
          new Set(["starforce"]),
        );
    const canonicalOptionPremium = Math.min(
      premium,
      logEffect > EPSILON
        ? zeroStarNormalized.value * (1 - Math.exp(-logEffect))
        : zeroStarNormalized.value,
    );
    const shape = optionShape(comparable, spec.prefix);
    const key = stableValue({
      shape,
      stat_codes: comparable.option_stat_codes?.[spec.prefix] || {},
    });
    const group = groups.get(key) || { entries: [], shape, magnitude };
    group.entries.push({
      value: premium,
      option_value: canonicalOptionPremium,
      weight: entry.weight,
      starforce: nonnegative(comparable.components.starforce),
    });
    groups.set(key, group);
  }

  const supported = [...groups.values()].flatMap((group) => {
    if (group.entries.length < 3 || effectiveSampleSize(group.entries) < 2.5) return [];
    const premium = weightedQuantile(group.entries, 0.15);
    if (!(premium > 0)) return [];
    const optionPremium = Math.min(
      premium,
      weightedQuantile(group.entries.map((entry) => ({
        value: entry.option_value,
        weight: entry.weight,
      })), 0.15) ?? premium,
    );
    return [{
      component,
      prefix: spec.prefix,
      premium,
      option_premium: optionPremium,
      starforce_interaction_premium: Math.max(0, premium - optionPremium),
      low: weightedQuantile(group.entries, 0.1) ?? premium,
      high: weightedQuantile(group.entries, 0.85) ?? premium,
      minimum: Math.min(...group.entries.map(({ value }) => value)),
      maximum: Math.max(...group.entries.map(({ value }) => value)),
      evidence_count: group.entries.length,
      effective_evidence_count: effectiveSampleSize(group.entries),
      evidence_magnitude: group.magnitude,
      starforce_minimum: Math.min(...group.entries.map(({ starforce }) => starforce)),
      starforce_maximum: Math.max(...group.entries.map(({ starforce }) => starforce)),
      target_family: target.training_profile_by_component?.[component] ||
        target.training_profile_family || null,
      option_kinds: target.option_kinds?.[spec.prefix] || {},
      option_stat_codes: target.option_stat_codes?.[spec.prefix] || {},
    }];
  });
  return supported.sort((left, right) =>
    right.premium - left.premium ||
      right.effective_evidence_count - left.effective_evidence_count
  )[0] || null;
}

function factorial(value) {
  let output = 1;
  for (let index = 2; index <= value; index += 1) output *= index;
  return output;
}

function additiveShapley(intercept, effects) {
  const keys = Object.keys(effects);
  const count = keys.length;
  const baseline = mesoFromLog(intercept);
  const output = Object.fromEntries(keys.map((key) => [key, 0]));
  const factorialCount = factorial(count);
  for (let target = 0; target < count; target += 1) {
    for (let mask = 0; mask < 2 ** count; mask += 1) {
      if (mask & (1 << target)) continue;
      let size = 0;
      let included = 0;
      for (let index = 0; index < count; index += 1) {
        if (mask & (1 << index)) {
          size += 1;
          included += effects[keys[index]];
        }
      }
      const weight = factorial(size) * factorial(count - size - 1) / factorialCount;
      output[keys[target]] += weight * (
        mesoFromLog(intercept + included + effects[keys[target]]) -
        mesoFromLog(intercept + included)
      );
    }
  }
  return { base: baseline, ...output };
}

function confidenceLevel(score) {
  return score >= 0.72 ? "high" : score >= 0.42 ? "medium" : "low";
}

function vectorSignature(features, definitions) {
  return definitions
    .map(({ key }) => Math.round(features.vector[key] * 1000) / 1000)
    .join("|");
}

function componentMagnitude(features, component) {
  if (!features || typeof features !== "object") return 0;
  let cached = COMPONENT_MAGNITUDE_CACHE.get(features);
  if (!cached) {
    cached = new Map();
    COMPONENT_MAGNITUDE_CACHE.set(features, cached);
  }
  if (cached.has(component)) return cached.get(component);
  const magnitude = (MAGNITUDE_DEFINITIONS_BY_COMPONENT[component] || [])
    .reduce((sum, definition) => sum +
      nonnegative(features.vector[definition.key]) / Math.max(EPSILON, definition.scale), 0);
  cached.set(component, magnitude);
  return magnitude;
}

function pearsonCorrelation(left, right) {
  if (left.length !== right.length || left.length < 3) return 0;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftSquares += leftDelta * leftDelta;
    rightSquares += rightDelta * rightDelta;
  }
  const denominator = Math.sqrt(leftSquares * rightSquares);
  return denominator > EPSILON ? numerator / denominator : 0;
}

function hasWithinGroupVariation(entries, component) {
  const pairs = {
    potential_options: "potential_grade",
    potential_grade: "potential_options",
    additional_options: "additional_grade",
    additional_grade: "additional_options",
  };
  const counterpart = pairs[component];
  if (!counterpart) return true;
  const definitions = FEATURE_DEFINITIONS.filter((entry) => entry.component === component);
  const counterpartDefinitions = FEATURE_DEFINITIONS.filter(
    (entry) => entry.component === counterpart,
  );
  const groups = new Map();
  for (const entry of entries) {
    // 옵션 수치는 연속값이므로 등업을 볼 때만 좁은 구간으로 묶는다.
    const groupKey = counterpart.endsWith("options")
      ? String(Math.round(componentMagnitude(entry.features, counterpart) * 4) / 4)
      : vectorSignature(entry.features, counterpartDefinitions);
    if (!groups.has(groupKey)) groups.set(groupKey, { count: 0, values: new Set() });
    const group = groups.get(groupKey);
    group.count += 1;
    group.values.add(vectorSignature(entry.features, definitions));
  }
  return [...groups.values()].some((group) => group.count >= 3 && group.values.size >= 2);
}

function componentTargetLogEffect(target, fitted, component) {
  if (!fitted) return null;
  return FEATURE_DEFINITIONS
    .filter((definition) => definition.component === component)
    .reduce((sum, definition) => sum +
      nonnegative(target.vector[definition.key]) *
      finite(fitted.coefficients[definition.key]), 0);
}

function componentTrainingSupport(entries, component) {
  const definitions = FEATURE_DEFINITIONS.filter((entry) => entry.component === component);
  if (!definitions.length) return { distinct: 1, ranges: {}, identifiable: true };
  const signatures = new Set(entries.map((entry) => vectorSignature(entry.features, definitions)));
  const ranges = Object.fromEntries(definitions.map(({ key }) => {
    const values = entries.map((entry) => entry.features.vector[key]);
    return [key, { minimum: Math.min(...values), maximum: Math.max(...values) }];
  }));
  const componentValues = entries.map((entry) => componentMagnitude(entry.features, component));
  let maxCorrelation = 0;
  let correlatedWith = null;
  for (const [other] of COMPONENTS) {
    if (other === "base" || other === component) continue;
    const correlation = Math.abs(pearsonCorrelation(
      componentValues,
      entries.map((entry) => componentMagnitude(entry.features, other)),
    ));
    if (correlation > maxCorrelation) {
      maxCorrelation = correlation;
      correlatedWith = other;
    }
  }
  const independentVariation = hasWithinGroupVariation(entries, component);
  const confounded = maxCorrelation >= 0.995 ||
    (maxCorrelation >= 0.97 && !independentVariation);
  return {
    distinct: signatures.size,
    ranges,
    independent_variation: independentVariation,
    max_correlation: maxCorrelation,
    correlated_with: correlatedWith,
    confounded,
  };
}

function componentSupport(entries, target, component, fitted, validation, trainingSupport = null) {
  const definitions = FEATURE_DEFINITIONS.filter((entry) => entry.component === component);
  if (!definitions.length) return { distinct: 1, extrapolated: false, identifiable: true };
  const learnedSupport = trainingSupport || componentTrainingSupport(entries, component);
  const extrapolated = definitions.some(({ key }) => {
    const range = learnedSupport.ranges[key];
    const targetValue = target.vector[key];
    return targetValue < range.minimum - EPSILON || targetValue > range.maximum + EPSILON;
  });
  const targetHasValue = definitions.some(({ key }) => target.vector[key] > EPSILON);
  const learnedLogEffect = componentTargetLogEffect(target, fitted, component) ?? 0;
  const validationLogEffect = validation?.available
    ? componentTargetLogEffect(target, validation.fitted, component)
    : null;
  const minimumDetectedEffect = 0.003;
  const effectDetected = !targetHasValue || Math.abs(learnedLogEffect) >= minimumDetectedEffect;
  const effectRatio = validationLogEffect !== null && Math.abs(learnedLogEffect) > EPSILON
    ? validationLogEffect / learnedLogEffect
    : null;
  const temporallyStable = !targetHasValue || !validation?.available || (
    Math.abs(validationLogEffect) >= minimumDetectedEffect && effectRatio >= 0.2 && effectRatio <= 5
  );
  const identifiable = learnedSupport.distinct >= 2 && effectDetected &&
    !learnedSupport.confounded && temporallyStable;
  const reasons = [];
  if (learnedSupport.distinct < 2) reasons.push("no_variation");
  if (!effectDetected) reasons.push("no_learned_market_effect");
  if (learnedSupport.confounded) reasons.push("confounded");
  if (!temporallyStable) reasons.push("unstable_over_time");
  return {
    distinct: learnedSupport.distinct,
    extrapolated,
    target_has_value: targetHasValue,
    learned_log_effect: learnedLogEffect,
    validation_log_effect: validationLogEffect,
    effect_ratio: effectRatio,
    effect_detected: effectDetected,
    temporally_stable: temporallyStable,
    independent_variation: learnedSupport.independent_variation,
    max_correlation: learnedSupport.max_correlation,
    correlated_with: learnedSupport.correlated_with,
    confounded: learnedSupport.confounded,
    identifiable,
    reason_codes: reasons,
  };
}

function baseComponentSupport(entries, anchored = false, learnedBlankSamples = null) {
  const blankSamples = Number.isInteger(learnedBlankSamples)
    ? learnedBlankSamples
    : entries.filter((entry) => FEATURE_DEFINITIONS
      .filter(({ component }) => component !== "trade")
      .every(({ key }) => entry.features.vector[key] <= EPSILON)).length;
  return {
    distinct: anchored ? Math.max(1, blankSamples) : blankSamples,
    blank_samples: blankSamples,
    anchored,
    extrapolated: !anchored && blankSamples === 0,
    identifiable: anchored || blankSamples > 0,
    reason_codes: anchored || blankSamples > 0 ? [] : ["no_blank_sample"],
  };
}

function isBlankEnhancement(features) {
  return FEATURE_DEFINITIONS
    .filter(({ component }) => component !== "trade")
    .every(({ key }) => nonnegative(features.vector[key]) <= EPSILON);
}

function blankMarketAnchor(entries, maximumUnbiasedFloor = null) {
  const floorCeiling = Number(maximumUnbiasedFloor);
  const restrictFloor = Number.isFinite(floorCeiling) && floorCeiling > 0;
  const blank = entries
    .filter((entry) => isBlankEnhancement(entry.features) && (
      !restrictFloor || entry.floor === null || entry.floor <= floorCeiling
    ))
    .map((entry) => ({ value: entry.price, weight: entry.weight }));
  return blank.length ? weightedQuantile(blank, 0.5) : null;
}

function modalValue(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))[0]?.[0] ?? null;
}

function inferTradeDefaults(entries) {
  const rows = entries.map((entry) => itemBody(entry.record)?.trade || {});
  const states = rows.map((trade) => String(trade.state || "")).filter(Boolean);
  const state = modalValue(states);
  const remainingByState = {};
  for (const knownState of new Set(states)) {
    const values = rows
      .filter((trade) => String(trade.state || "") === knownState)
      .map((trade) => Number(trade.scissors_remaining))
      .filter((value) => Number.isFinite(value) && value >= 0);
    remainingByState[knownState] = values.length ? quantile(values, 0.5) : 0;
  }
  return {
    state,
    scissors_remaining: state ? nonnegative(remainingByState[state]) : 0,
    scissors_remaining_by_state: remainingByState,
  };
}

function applyTargetTradeDefaults(target, defaults) {
  const providedState = String(target.components.trade_state || "");
  const state = providedState || String(defaults?.state || "");
  const providedRemaining = target.components.scissors_remaining;
  const hasProvidedRemaining = providedRemaining != null && Number.isFinite(Number(providedRemaining));
  const fallbackRemaining = defaults?.scissors_remaining_by_state?.[state] ??
    defaults?.scissors_remaining ?? 0;
  const scissorsRemaining = hasProvidedRemaining
    ? nonnegative(providedRemaining)
    : nonnegative(fallbackRemaining);
  if (!state && hasProvidedRemaining) return target;
  const imputedState = !providedState && Boolean(state);
  const imputedScissors = !hasProvidedRemaining;
  if (!imputedState && !imputedScissors) return target;
  const replacement = tradeFeatures({ state, scissors_remaining: scissorsRemaining });
  return {
    ...target,
    vector: { ...target.vector, ...replacement },
    components: {
      ...target.components,
      trade_state: state || null,
      scissors_remaining: scissorsRemaining,
    },
    trade_imputation: {
      state: imputedState,
      scissors_remaining: imputedScissors,
      source: "same_item_sales_mode_and_median",
    },
  };
}

function clampTargetToTrainingEnvelope(target, trainingSupports) {
  const vector = { ...target.vector };
  const clamped = [];
  for (const definition of FEATURE_DEFINITIONS) {
    const range = trainingSupports?.[definition.component]?.ranges?.[definition.key];
    if (!range) continue;
    const minimum = Math.max(0, range.minimum - definition.scale);
    const maximum = range.maximum + definition.scale;
    const original = nonnegative(vector[definition.key]);
    const adjusted = clamp(original, minimum, maximum);
    if (Math.abs(adjusted - original) > EPSILON) {
      clamped.push({
        feature: definition.key,
        component: definition.component,
        input: original,
        used: adjusted,
        observed_minimum: range.minimum,
        observed_maximum: range.maximum,
      });
      vector[definition.key] = adjusted;
    }
  }
  return {
    ...target,
    vector,
    prediction_clamps: clamped,
  };
}

function componentRange(value, score) {
  const uncertainty = 0.18 + (1 - score) * 0.82;
  const radius = Math.abs(value) * uncertainty;
  return {
    low: roundSignedMeso(value - radius),
    high: roundSignedMeso(value + radius),
  };
}

function buildWarnings({
  target,
  entries,
  supports,
  profile,
  validation,
  baseAnchor = null,
  localAnchor = null,
}) {
  const warnings = [];
  if (profile.conversionConfidence !== "high") {
    warnings.push({
      code: "default_conversion_profile",
      severity: "medium",
      message: "개인 주스탯%급 표시에 캐릭터 정보가 없어 보수적 기본 환산을 사용했습니다. 경매장 가격 모델 자체는 시장 공통 축을 사용합니다.",
    });
  }
  if (target.option_quality.unknown_lines > 0) {
    warnings.push({
      code: "target_unknown_potential",
      severity: "high",
      message: `입력 옵션 중 ${target.option_quality.unknown_lines}줄은 환산하지 못해 가격 기여도에서 제외했습니다.`,
    });
  }
  if (target.option_quality.unconverted_combat_lines > 0) {
    warnings.push({
      code: "target_unconverted_combat_options",
      severity: "high",
      message: `입력 옵션 중 ${target.option_quality.unconverted_combat_lines}줄은 현재 캐릭터 기준값이 없어 전투 환산에서 제외했습니다. 방어율 무시는 캐릭터 정보를 불러와야 정확히 반영됩니다.`,
    });
  }
  if (!supports.base?.anchored && supports.base?.blank_samples === 0) {
    warnings.push({
      code: "base_component_unidentified",
      component: "base",
      severity: "high",
      message: "노작값과 강화 요소의 가격을 완전히 분리하기 어렵습니다.",
    });
  }
  for (const [component, support] of Object.entries(supports)) {
    if (component === "base") continue;
    const componentHasTargetValue = FEATURE_DEFINITIONS.some(
      (definition) => definition.component === component && target.vector[definition.key] > 0,
    );
    if (!support.identifiable && componentHasTargetValue) {
      const confounded = support.reason_codes?.includes("confounded");
      const unstable = support.reason_codes?.includes("unstable_over_time");
      const noEffect = support.reason_codes?.includes("no_learned_market_effect");
      warnings.push({
        code: noEffect
          ? "component_unidentified"
          : confounded
            ? "component_confounded"
            : unstable
              ? "component_temporally_unstable"
              : "component_unidentified",
        component,
        severity: "high",
        message: noEffect
          ? `${COMPONENTS.find(([key]) => key === component)?.[1] || component}의 독립적인 가격 효과를 분리하지 못했습니다. 0원이라는 뜻이 아닙니다.`
          : confounded
            ? `${COMPONENTS.find(([key]) => key === component)?.[1] || component}이 다른 강화 요소와 함께 움직여 시장가를 따로 분리하지 못했습니다.`
            : unstable
              ? `${COMPONENTS.find(([key]) => key === component)?.[1] || component}의 가격 효과가 시점에 따라 안정적으로 재현되지 않았습니다.`
              : `${COMPONENTS.find(([key]) => key === component)?.[1] || component}의 시장가를 따로 분리하지 못했습니다.`,
      });
    } else if (support.extrapolated && componentHasTargetValue) {
      warnings.push({
        code: "component_extrapolated",
        component,
        severity: "medium",
        message: `${COMPONENTS.find(([key]) => key === component)?.[1] || component} 입력값이 계산 가능 범위를 벗어났습니다.`,
      });
    }
  }
  if (entries.length < 12) {
    warnings.push({
      code: "small_sample",
      severity: "high",
      message: "예상 거래 범위를 넓게 봐야 합니다.",
    });
  }
  if (localAnchor && (!localAnchor.qualified || localAnchor.effective_neighbor_count < 4)) {
    warnings.push({
      code: "target_condition_sparse",
      severity: localAnchor.qualified ? "medium" : "high",
      message: "같은 강화 상태와 옵션 구간의 거래가 충분하지 않아 예상 범위를 넓게 봐야 합니다.",
    });
  }
  if (!validation?.available) {
    warnings.push({
      code: "temporal_validation_unavailable",
      severity: "medium",
      message: "시점별 검증이 충분하지 않아 신뢰도를 높음으로 표시하지 않습니다.",
    });
  } else if (validation.accuracy_score < 0.65) {
    warnings.push({
      code: "temporal_validation_weak",
      severity: validation.accuracy_score < 0.45 ? "high" : "medium",
      message: "가격 변동성이 커 추정 범위와 신뢰도를 보수적으로 조정했습니다.",
    });
  }
  if (target.trade_imputation?.state || target.trade_imputation?.scissors_remaining) {
    warnings.push({
      code: "trade_state_imputed",
      severity: "medium",
      message: "거래 상태를 입력하지 않으면 기본 거래 상태와 가위 잔여값을 사용합니다.",
    });
  }
  if (target.prediction_clamps?.length) {
    warnings.push({
      code: "prediction_feature_capped",
      severity: "high",
      message: `입력값 ${target.prediction_clamps.length}개가 계산 가능 범위를 크게 벗어나 가격 반영치를 제한했습니다. 입력 원값은 환산 표시에 유지됩니다.`,
    });
  }
  if (baseAnchor?.applied) {
    warnings.push({
      code: "external_base_price_anchor",
      severity: baseAnchor.relative_gap > 0.5 ? "medium" : "low",
      message: "노작값은 스타포스 장비 프리셋 가격으로 고정했습니다. 검증 점수에는 입력한 노작값 자체의 정확도가 포함되지 않습니다.",
    });
  }
  return warnings;
}

function emptyEstimate(target, profile, rejectedCount) {
  return {
    status: "no_data",
    estimator_version: ITEM_MARKET_ESTIMATOR_VERSION,
    item_name: target.item_name,
    estimate_meso: null,
    range_meso: { low: null, high: null },
    components: Object.fromEntries(COMPONENTS.map(([key, label]) => [key, {
      key,
      label,
      contribution_meso: null,
      range_meso: { low: null, high: null },
      confidence: "low",
      confidence_score: 0,
      identifiable: false,
      support_values: 0,
      extrapolated: false,
    }])),
    component_order: COMPONENTS.map(([key]) => key),
    confidence: { level: "low", score: 0, sample_count: 0, effective_sample_size: 0 },
    normalization: { ...target.profile, axis: "main_stat_percent_equivalent" },
    diagnostics: { accepted_records: 0, rejected_records: rejectedCount },
    warnings: [{
      code: "no_same_item_sales",
      severity: "high",
      message: "현재 이 장비의 시세를 계산할 수 없습니다.",
    }],
  };
}

/** 동일 장비 판매완료 전체로 목표와 무관한 구성요소 시장계수를 한 번 학습한다. */
export function fitItemMarketModel({
  itemName,
  category = null,
  comparables,
  enemyDefense = 380,
  asOf = null,
  halfLifeDays = DEFAULT_HALF_LIFE_DAYS,
  maxRecords = DEFAULT_MAX_RECORDS,
  ridge = null,
} = {}) {
  const normalizedName = normalizeMarketItemName(itemName);
  if (!normalizedName) throw new RangeError("장비명이 필요합니다.");
  const records = comparableRecords(comparables);
  const identity = { item_name: normalizedName, category: category || null };
  const accepted = records.filter((record) =>
    sameTargetItem(identity, record) && priceValue(record) && usableComparable(record)
  );
  if (!accepted.length) {
    return {
      kind: "item_market_fitted_model",
      status: "no_data",
      estimator_version: ITEM_MARKET_ESTIMATOR_VERSION,
      item_name: normalizedName,
      category: category || null,
      training_normalization: "market_canonical_component_stat_family",
      records: [],
      total_input_records: records.length,
    };
  }

  const extracted = accepted.map((record) => ({
    record,
    price: priceValue(record),
    features: extractCanonicalMarketTrainingFeatures(record, { enemyDefense }),
    soldTime: parseTime(record.sold_at),
    floor: recordFloor(record),
  }));
  const newest = Math.max(...extracted.map((entry) => entry.soldTime || 0));
  const requestedReference = parseTime(asOf);
  const referenceTime = requestedReference || newest || Date.now();
  const safeHalfLife = Number(halfLifeDays) > 0 ? Number(halfLifeDays) : DEFAULT_HALF_LIFE_DAYS;
  for (const entry of extracted) {
    const ageDays = entry.soldTime
      ? Math.max(0, (referenceTime - entry.soldTime) / DAY_MS)
      : safeHalfLife;
    const timeWeight = 2 ** (-ageDays / safeHalfLife);
    const floorWeight = entry.floor === null ? 1 : 0.88;
    // 현재 raw의 UNKNOWN은 전수 확인상 MP·회복·상태이상 등 알려진 잡옵이다.
    // 이를 저품질 매물로 감점하면 잡잠재 거래를 과소표집해 옵션값이 부풀 수 있다.
    const qualityWeight = entry.features.option_quality.unconverted_combat_lines > 0 ? 0.75 : 1;
    entry.weight = timeWeight * floorWeight * qualityWeight;
  }
  // 목표 옵션과 가까운 매물만 고르는 방식이 아니다. 동일 장비 판매완료 자료를
  // 전부 사용하고, 비정상적으로 큰 자료에서만 최신 거래 순으로 성능 상한을 둔다.
  extracted.sort((left, right) =>
    (right.soldTime || 0) - (left.soldTime || 0) || right.price - left.price
  );
  const limit = Math.max(1, Math.floor(nonnegative(maxRecords) || DEFAULT_MAX_RECORDS));
  const bounded = extracted.slice(0, limit);
  const weightScale = bounded.length / Math.max(
    EPSILON,
    bounded.reduce((sum, entry) => sum + entry.weight, 0),
  );
  for (const entry of bounded) entry.weight *= weightScale;

  const effective = effectiveSampleSize(bounded);
  const hasExplicitRidge = ridge !== null && ridge !== undefined && Number(ridge) >= 0;
  const lambda = hasExplicitRidge
    ? Number(ridge)
    : DEFAULT_RIDGE;
  const validation = temporalHoldoutValidation(bounded, lambda);
  const fitted = fitNonnegativeRidge(bounded, FEATURE_DEFINITIONS, lambda);
  const trainingSupports = Object.fromEntries(COMPONENTS.slice(1).map(([component]) => [
    component,
    componentTrainingSupport(bounded, component),
  ]));
  const baseBlankSamples = baseComponentSupport(bounded).blank_samples;
  const baseBlankAnchor = blankMarketAnchor(bounded);
  const residuals = bounded.map((entry, index) => {
    const logPrediction = predictLog(entry.features, fitted);
    return {
      value: Math.log(entry.price) - logPrediction,
      weight: fitted.robustWeights[index] || entry.weight,
    };
  });
  return {
    kind: "item_market_fitted_model",
    status: "fitted",
    estimator_version: ITEM_MARKET_ESTIMATOR_VERSION,
    item_name: normalizedName,
    category: category || null,
    training_normalization: "market_canonical_component_stat_family",
    training_profile_families: Object.fromEntries(
      [...new Set(bounded.map((entry) => entry.features.training_profile_family))]
        .sort()
        .map((family) => [
          family,
          bounded.filter((entry) => entry.features.training_profile_family === family).length,
        ]),
    ),
    records: bounded,
    accepted_record_count: extracted.length,
    total_input_records: records.length,
    newest,
    safeHalfLife,
    effective,
    lambda,
    fitted,
    validation,
    trade_defaults: inferTradeDefaults(bounded),
    training_supports: trainingSupports,
    base_blank_samples: baseBlankSamples,
    base_blank_anchor_meso: baseBlankAnchor,
    residualLow: weightedQuantile(residuals, 0.1) ?? 0,
    residualHigh: weightedQuantile(residuals, 0.9) ?? 0,
  };
}

export const fitItemMarketComponentModel = fitItemMarketModel;

function cachedItemMarketModel(argumentsValue, records, targetFeatures) {
  let models = FITTED_MODEL_CACHE.get(records);
  if (!models) {
    models = new Map();
    FITTED_MODEL_CACHE.set(records, models);
  }
  const key = stableValue({
    itemName: targetFeatures.item_name,
    category: targetFeatures.category,
    enemyDefense: argumentsValue.enemyDefense,
    asOf: argumentsValue.asOf,
    halfLifeDays: argumentsValue.halfLifeDays,
    maxRecords: argumentsValue.maxRecords,
    ridge: argumentsValue.ridge,
  });
  const cached = models.get(key);
  if (cached) return { model: cached, cacheHit: true };
  const model = fitItemMarketModel({
    itemName: targetFeatures.item_name,
    category: targetFeatures.category,
    comparables: records,
    enemyDefense: argumentsValue.enemyDefense,
    asOf: argumentsValue.asOf,
    halfLifeDays: argumentsValue.halfLifeDays,
    maxRecords: argumentsValue.maxRecords,
    ridge: argumentsValue.ridge,
  });
  models.set(key, model);
  return { model, cacheHit: false };
}

/**
 * 판매완료 매물로 장비의 아홉 가치 요소를 분리해 합산한다.
 * comparables에는 공개 item shard의 records를, profile에는 개인 환산 표시용
 * getCalculationProfile() 반환값을 넘길 수 있다. 시장 가격은 profile과 무관한
 * 공통 축으로 학습하며 같은 records 배열과 fit 옵션은 모델을 재사용한다.
 */
export function estimateItemMarketValue(argumentsValue = {}) {
  const {
    target,
    comparables,
    profile = null,
    enemyDefense = 380,
    fittedModel = null,
    model = fittedModel,
  } = argumentsValue;
  const resolvedProfile = resolveItemMarketProfile(profile);
  const personalTargetFeatures = extractItemMarketFeatures(target, {
    profile: resolvedProfile,
    enemyDefense,
  });
  const rawMarketTargetFeatures = extractCanonicalMarketTrainingFeatures(target, { enemyDefense });
  let targetFeatures = rawMarketTargetFeatures;
  if (!targetFeatures.item_name) throw new RangeError("추정할 장비명이 필요합니다.");
  const records = comparableRecords(comparables);
  const prepared = model
    ? { model, cacheHit: false }
    : cachedItemMarketModel({
        enemyDefense,
        asOf: argumentsValue.asOf ?? null,
        halfLifeDays: argumentsValue.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS,
        maxRecords: argumentsValue.maxRecords ?? DEFAULT_MAX_RECORDS,
        ridge: argumentsValue.ridge ?? null,
      }, records, targetFeatures);
  const trained = prepared.model;
  if (trained?.kind !== "item_market_fitted_model") {
    throw new TypeError("지원하지 않는 시세 구성요소 모델입니다.");
  }
  if (trained.item_name !== targetFeatures.item_name ||
      (trained.category && targetFeatures.category && trained.category !== targetFeatures.category)) {
    throw new RangeError("계산 모델과 입력 장비가 다릅니다.");
  }
  if (trained.status !== "fitted") {
    const empty = emptyEstimate(targetFeatures, resolvedProfile, trained.total_input_records || records.length);
    empty.normalization.personal_equivalence = {
      ...personalTargetFeatures.profile,
      target_components: personalTargetFeatures.components,
    };
    return empty;
  }

  const bounded = trained.records;
  const fitted = trained.fitted;
  const effective = trained.effective;
  targetFeatures = applyTargetTradeDefaults(targetFeatures, trained.trade_defaults);
  const predictionFeatures = clampTargetToTrainingEnvelope(
    targetFeatures,
    trained.training_supports,
  );
  targetFeatures = {
    ...targetFeatures,
    prediction_clamps: predictionFeatures.prediction_clamps,
  };
  const effects = componentLogEffects(predictionFeatures, fitted);
  const suppliedBasePrice = Number(targetFeatures.components.base_price_meso);
  const baseAnchored = Number.isSafeInteger(suppliedBasePrice) && suppliedBasePrice > 0;
  const decomposition = additiveShapley(fitted.intercept, effects);
  const learnedBasePrice = decomposition.base;
  const learnedEstimate = Object.values(decomposition).reduce((sum, value) => sum + value, 0);
  if (baseAnchored) decomposition.base = suppliedBasePrice;
  // 외부 기준가가 명시된 라이브러리 호출만 호환용 anchor를 사용한다. 웹 페이지는
  // 이를 전달하지 않으며 동일 장비 판매 시세로 학습한 baseline을 그대로 사용한다.
  const componentModelRawEstimate = Object.values(decomposition).reduce(
    (sum, value) => sum + value,
    0,
  );
  const baseAnchorRelativeGap = baseAnchored
    ? Math.abs(suppliedBasePrice - learnedBasePrice) / Math.max(learnedBasePrice, EPSILON)
    : 0;
  const componentAnchorDelta = baseAnchored ? suppliedBasePrice - learnedBasePrice : 0;
  const unbiasedBlankBaseAnchor = blankMarketAnchor(
    bounded,
    baseAnchored ? suppliedBasePrice : null,
  );
  const blankBaseAnchor = Number(unbiasedBlankBaseAnchor);
  const hasBlankBaseAnchor = Number.isFinite(blankBaseAnchor) && blankBaseAnchor > 0;
  // 로컬 거래가는 이미 노작값을 포함한다. 실제 무강화 거래 기준가가 있으면 그 값만
  // 교체하고, 없으면 외부 노작값을 억지로 한 번 더 빼지 않는다.
  const localAnchorDelta = baseAnchored && hasBlankBaseAnchor
    ? suppliedBasePrice - blankBaseAnchor
    : 0;
  const supports = Object.fromEntries(COMPONENTS.map(([key]) => [
    key,
    key === "base"
      ? baseComponentSupport(bounded, baseAnchored, trained.base_blank_samples)
      : componentSupport(
          bounded,
          targetFeatures,
          key,
          fitted,
          trained.validation,
          trained.training_supports?.[key],
        ),
  ]));
  const extrapolatedCount = Object.values(supports).filter((support) => support.extrapolated).length;
  const sampleScore = 1 - Math.exp(-effective / 22);
  const supportScore = clamp(1 - extrapolatedCount / 10, 0.35, 1);
  const floorScore = bounded.some((entry) => entry.floor === null) ? 1 : 0.82;
  const targetComponents = COMPONENTS.slice(1).filter(([key]) =>
    FEATURE_DEFINITIONS.some(
      (definition) => definition.component === key && targetFeatures.vector[definition.key] > EPSILON,
    )
  );
  const identifiableTargetCount = targetComponents.filter(([key]) => supports[key].identifiable).length;
  const identificationScore = targetComponents.length
    ? 0.55 + 0.45 * identifiableTargetCount / targetComponents.length
    : 1;
  // `0성·잠재 없음·최소가 5천만`처럼 가격 하한을 둔 검색에서는 하한보다 싼
  // 실제 노작 매물이 애초에 표본에 들어오지 않는다. 그런 잘린 거래를 무옵션
  // 목표의 로컬 시세로 쓰면, 고통의 근원처럼 노작값이 작은 장비가 수십 배로
  // 부풀려진다. 외부 노작값이 있는 무강화 목표에는 그 노작값 이하까지 관측할
  // 수 있었던 검색 프레임만 허용한다.
  // 목표에서 유효 옵션이 없는 잠재/에디 구성요소는 같은 구성요소가 비어 있는
  // 거래만 비교한다. 유니크 잡옵 목표가 유니크 21% 매물을 fallback으로 받아
  // 오히려 첫 유효 옵션보다 비싸지는 현상을 막는다.
  const optionStateComparableEntries = bounded.filter((entry) =>
    ["potential_options", "additional_options"].every((component) =>
      componentMagnitude(predictionFeatures, component) > EPSILON ||
      componentMagnitude(entry.features, component) <= EPSILON
    )
  );
  const localComparableEntries = baseAnchored && isBlankEnhancement(predictionFeatures)
    ? optionStateComparableEntries.filter((entry) =>
        isBlankEnhancement(entry.features) &&
        (entry.floor === null || entry.floor <= suppliedBasePrice)
      )
    : optionStateComparableEntries;
  const rawLocalAnchor = localComparableAnchor(
    predictionFeatures,
    localComparableEntries,
    fitted,
    trained.training_supports,
  );
  const localAnchor = rawLocalAnchor;
  const localAnchorTierScore = (anchor) => ({
    exact_all_family: 1,
    exact_all: 1,
    exact_family: 1,
    exact: 1,
    same_kind_all_family: 0.96,
    same_kind_all: 0.94,
    same_kind_state_family: 0.92,
    same_kind_state: 0.88,
    same_kind_grade_family: 0.8,
    same_kind_grade: 0.74,
    lower_envelope_same_kind_all_family: 0.96,
    lower_envelope_same_kind_all: 0.94,
    lower_envelope_same_kind_state_family: 0.9,
    lower_envelope_same_kind_state: 0.86,
    lower_envelope_same_kind_grade_family: 0.78,
    lower_envelope_same_kind_grade: 0.72,
    same_state: 0.85,
    same_grade: 0.65,
    same_band: 0.5,
    fallback: 0.3,
  }[anchor?.tier] ?? 0);
  const conditionSupportFor = (anchor) => anchor
    ? clamp(
        localAnchorTierScore(anchor) *
          (anchor.qualified ? 1 : 0.55) *
          Math.min(1, anchor.effective_neighbor_count / 8),
        0,
        1,
      )
    : 0;
  const conditionSupportScore = conditionSupportFor(localAnchor);
  // SF 0·잠재 없음·미작도 명시적인 목표 조건이다. 활성 feature가 없더라도
  // 같은 상태 거래가 희소하면 신뢰도를 낮춰 무옵션 고가 추정을 막는다.
  const conditionConfidenceFactor = 0.6 + 0.4 * conditionSupportScore;
  const rawConfidenceScore = clamp(
    sampleScore * supportScore * floorScore * identificationScore * conditionConfidenceFactor,
    0,
    1,
  );
  const validation = trained.validation;
  let validatedConfidenceScore = validation?.available
    ? Math.min(
        rawConfidenceScore * (0.5 + validation.accuracy_score * 0.5),
        validation.accuracy_score,
      )
    : Math.min(rawConfidenceScore * 0.75, 0.69);
  // 최신 구간이 몇 건뿐이거나 실제 ±25% 적중률이 낮으면 전체 표본 수가
  // 많더라도 높은 신뢰도를 허용하지 않는다.
  if (validation?.available) {
    if (
      validation.holdout_count < 20 ||
      validation.within_25_percent < 0.65 ||
      validation.median_absolute_percent_error > 0.25
    ) {
      validatedConfidenceScore = Math.min(validatedConfidenceScore, 0.69);
    }
    if (
      validation.within_25_percent < 0.5 ||
      validation.median_absolute_percent_error > 0.4
    ) {
      validatedConfidenceScore = Math.min(validatedConfidenceScore, 0.41);
    }
  }
  const hasConditionedOptionTarget = ["potential_options", "additional_options"]
    .some((component) => componentMagnitude(predictionFeatures, component) > EPSILON);
  const localOptionKnotCount = (localAnchor?.monotonic_knot_count || 0) +
    (localAnchor?.sparse_family_knot_count || 0) +
    (localAnchor?.lower_knot_count || 0);
  const targetConditionSupportAbsent = hasConditionedOptionTarget &&
    conditionSupportScore < 0.25 && localOptionKnotCount === 0;
  // 전체 장비 표본이 많아도 목표 스타포스·옵션 구간의 knot가 하나도 없다면
  // 점 추정의 신뢰도를 보통 이상으로 보이지 않는다. 뒤에서 교차 스타포스
  // 패키지 하한을 적용하더라도 이는 붕괴 방지용이지 직접 조건 표본은 아니다.
  const confidenceScore = targetConditionSupportAbsent
    ? Math.min(validatedConfidenceScore, 0.41)
    : validatedConfidenceScore;
  const residualLow = validation?.available ? validation.residual_low : trained.residualLow;
  const residualHigh = validation?.available ? validation.residual_high : trained.residualHigh;
  const validationWidth = validation?.available
    ? Math.max(0.08, validation.median_absolute_log_error * 1.25)
    : 0.28;
  const minimumLogWidth = Math.max(
    validationWidth,
    0.1 + (1 - confidenceScore) * 0.45,
  );
  const learnedPredictionLog = Math.log(Math.max(EPSILON, learnedEstimate));
  const learnedLow = mesoFromLog(
    learnedPredictionLog + Math.min(residualLow, -minimumLogWidth),
  );
  const learnedHigh = mesoFromLog(
    learnedPredictionLog + Math.max(residualHigh, minimumLogWidth),
  );
  const componentModelLow = clamp(learnedLow + componentAnchorDelta, 0, MAX_SAFE_MESO);
  const componentModelHigh = clamp(learnedHigh + componentAnchorDelta, 0, MAX_SAFE_MESO);
  const poolingWeight = localPoolingWeight({
    target: targetFeatures,
    supports,
    effective,
    confidenceScore,
    componentEstimate: learnedEstimate,
    localAnchor,
  });
  const safeLearnedEstimate = Math.max(1, learnedEstimate);
  const componentModelEstimate = learnedEstimate + componentAnchorDelta;
  const adjustedLocalEstimate = localAnchor
    ? localAnchor.estimate + localAnchorDelta
    : null;
  const pooledEstimate = poolingWeight > 0
    ? componentModelEstimate * (1 - poolingWeight) + adjustedLocalEstimate * poolingWeight
    : componentModelEstimate;
  const adjustedMonotonicAnchor = localAnchor?.monotonic_envelope
    ? localAnchor.monotonic_envelope.estimate + localAnchorDelta
    : null;
  const monotonicEnvelopeEstimate = adjustedMonotonicAnchor !== null
    ? Math.max(
        componentModelEstimate,
        componentModelEstimate * 0.06 + adjustedMonotonicAnchor * 0.94,
      )
    : null;
  // 옵션 수치 곡선에는 목표와 무관하게 선택한 동일 계열 running-max envelope를
  // 유일한 로컬 보정으로 쓴다. 임의의 exact pool을 다시 max에 섞으면 낮은 수치의
  // 일시적 고가 거래 때문에 다음 수치가 더 싸지는 역전이 재발할 수 있다.
  const robustCalibratedEstimate = localAnchor?.monotonic_scope
    ? monotonicEnvelopeEstimate ?? componentModelEstimate
    : pooledEstimate;
  const sparseFamilyCalibration = bestSparsePairCalibration(
    componentModelEstimate,
    localAnchor?.sparse_family_envelopes,
    localAnchorDelta,
  );
  const adjustedSparseFamilyAnchor = sparseFamilyCalibration?.anchor_meso ?? null;
  const sparseFamilyEnvelopeEstimate = sparseFamilyCalibration?.estimate_meso ?? null;
  // 일치하는 두 거래만 있는 knot는 서로 25% 이내일 때만 쓴다. model과 두 거래의
  // 중앙값을 취하면 한 건짜리 이상치는 자동으로 무시되고, 두 거래가 함께 가리키는
  // 상승분만 94% 반영된다. anchor는 model의 4배로 제한한다.
  const sparseFamilyBlendApplied = sparseFamilyEnvelopeEstimate !== null &&
    sparseFamilyEnvelopeEstimate > robustCalibratedEstimate + 1;
  const optionCalibratedEstimate = sparseFamilyBlendApplied
    ? sparseFamilyEnvelopeEstimate
    : robustCalibratedEstimate;
  // 옵션을 제거한 상태의 가격은 그 상태 자체를 추정했을 때와 반드시 같아야 한다.
  // 이전 구현은 양수 옵션 target의 support/confidence를 재사용해 0옵션 target을
  // 별도로 계산한 값과 달라졌고, 그 결과 `옵션 없음 → 첫 유효 옵션`에서 가격이
  // 내려가는 경우가 생겼다. 아래 계산기는 각 상태의 support·confidence·local
  // anchor를 독립적으로 다시 구하며, 두 옵션 구성요소가 모두 켜진 경우에도
  // 하나씩 제거하는 재귀가 같은 0옵션 하한을 공유한다.
  const standaloneCalibrationCache = new Map();
  const buildOptionPackageFloor = (features, component, zeroState) => {
    const evidence = crossStarOptionPackageFloor(
      features,
      bounded,
      fitted,
      trained.training_supports,
      component,
      zeroState.estimate,
    );
    if (!evidence) return null;
    const estimate = Math.min(
      MAX_SAFE_MESO,
      Math.max(1, zeroState.estimate + evidence.premium),
    );
    const anchorEstimate = estimate - localAnchorDelta;
    return {
      kind: "option_package",
      component,
      estimate,
      anchor: {
        estimate: anchorEstimate,
        low: Math.max(1, zeroState.estimate + evidence.low - localAnchorDelta),
        high: Math.max(1, zeroState.estimate + evidence.high - localAnchorDelta),
        minimum: Math.max(1, zeroState.estimate + evidence.minimum - localAnchorDelta),
        maximum: Math.max(1, zeroState.estimate + evidence.maximum - localAnchorDelta),
        neighbor_count: evidence.evidence_count,
        effective_neighbor_count: evidence.effective_evidence_count,
        nearest_distance: 0,
        qualified: true,
      },
      weight: 0.9,
      tier: `cross_star_${component}_package_floor`,
      zero_state_decomposition: zeroState.decomposition,
      evidence,
    };
  };
  const standaloneOptionStateCalibration = (features) => {
    const cacheKey = stableValue({
      vector: features.vector,
      components: {
        potential_grade: features.components.potential_grade,
        additional_grade: features.components.additional_grade,
        starforce: features.components.starforce,
        scroll_maximum: features.components.scroll_maximum,
        scroll_applied: features.components.scroll_applied,
        scroll_remaining: features.components.scroll_remaining,
        scroll_recoverable: features.components.scroll_recoverable,
        trade_state: features.components.trade_state,
        scissors_remaining: features.components.scissors_remaining,
      },
      option_kinds: features.option_kinds,
      option_stat_codes: features.option_stat_codes,
    });
    if (standaloneCalibrationCache.has(cacheKey)) {
      return standaloneCalibrationCache.get(cacheKey);
    }

    const stateEffects = componentLogEffects(features, fitted);
    const stateDecomposition = additiveShapley(fitted.intercept, stateEffects);
    const stateLearnedEstimate = Object.values(stateDecomposition)
      .reduce((sum, value) => sum + value, 0);
    const stateComponentEstimate = stateLearnedEstimate + componentAnchorDelta;
    const stateSupports = Object.fromEntries(COMPONENTS.map(([key]) => [
      key,
      key === "base"
        ? baseComponentSupport(bounded, baseAnchored, trained.base_blank_samples)
        : componentSupport(
            bounded,
            features,
            key,
            fitted,
            trained.validation,
            trained.training_supports?.[key],
          ),
    ]));
    const stateExtrapolatedCount = Object.values(stateSupports)
      .filter((support) => support.extrapolated).length;
    const stateSupportScore = clamp(1 - stateExtrapolatedCount / 10, 0.35, 1);
    const stateTargetComponents = COMPONENTS.slice(1).filter(([key]) =>
      FEATURE_DEFINITIONS.some(
        (definition) => definition.component === key &&
          features.vector[definition.key] > EPSILON,
      )
    );
    const stateIdentifiableCount = stateTargetComponents
      .filter(([key]) => stateSupports[key].identifiable).length;
    const stateIdentificationScore = stateTargetComponents.length
      ? 0.55 + 0.45 * stateIdentifiableCount / stateTargetComponents.length
      : 1;
    const zeroRequiredOptionComponents = ["potential_options", "additional_options"]
      .filter((component) => componentMagnitude(features, component) <= EPSILON);
    const stateOptionEntries = zeroRequiredOptionComponents.length
      ? bounded.filter((entry) => zeroRequiredOptionComponents.every((component) =>
          componentMagnitude(entry.features, component) <= EPSILON
        ))
      : bounded;
    const stateEntries = baseAnchored && isBlankEnhancement(features)
      ? stateOptionEntries.filter((entry) =>
          isBlankEnhancement(entry.features) &&
          (entry.floor === null || entry.floor <= suppliedBasePrice)
        )
      : stateOptionEntries;
    const stateAnchor = localComparableAnchor(
      features,
      stateEntries,
      fitted,
      trained.training_supports,
    );
    const stateConditionSupport = conditionSupportFor(stateAnchor);
    const stateRawConfidence = clamp(
      sampleScore * stateSupportScore * floorScore * stateIdentificationScore *
        (0.6 + 0.4 * stateConditionSupport),
      0,
      1,
    );
    const stateConfidence = validation?.available
      ? Math.min(
          stateRawConfidence * (0.5 + validation.accuracy_score * 0.5),
          validation.accuracy_score,
        )
      : Math.min(stateRawConfidence * 0.75, 0.69);
    const statePoolingWeight = localPoolingWeight({
      target: features,
      supports: stateSupports,
      effective,
      confidenceScore: stateConfidence,
      componentEstimate: stateLearnedEstimate,
      localAnchor: stateAnchor,
    });
    const stateAdjustedLocal = stateAnchor
      ? stateAnchor.estimate + localAnchorDelta
      : null;
    const statePooledEstimate = statePoolingWeight > 0
      ? stateComponentEstimate * (1 - statePoolingWeight) +
        stateAdjustedLocal * statePoolingWeight
      : stateComponentEstimate;
    const stateAdjustedMonotonic = stateAnchor?.monotonic_envelope
      ? stateAnchor.monotonic_envelope.estimate + localAnchorDelta
      : null;
    const stateMonotonicEstimate = stateAdjustedMonotonic !== null
      ? Math.max(
          stateComponentEstimate,
          stateComponentEstimate * 0.06 + stateAdjustedMonotonic * 0.94,
        )
      : null;
    const stateMonotonicBlendApplied = Boolean(
      stateAnchor?.monotonic_scope && stateAnchor.monotonic_envelope &&
      stateMonotonicEstimate !== null &&
      stateAdjustedMonotonic > stateComponentEstimate + 1,
    );
    const stateRobustEstimate = stateAnchor?.monotonic_scope
      ? stateMonotonicEstimate ?? stateComponentEstimate
      : statePooledEstimate;
    const stateSparse = bestSparsePairCalibration(
      stateComponentEstimate,
      stateAnchor?.sparse_family_envelopes,
      localAnchorDelta,
    );
    const stateSparseApplied = stateSparse &&
      stateSparse.estimate_meso > stateRobustEstimate + 1;
    let stateEstimate = stateSparseApplied
      ? stateSparse.estimate_meso
      : stateRobustEstimate;
    let effectiveAnchor = stateSparseApplied
      ? {
          ...stateSparse.source_anchor,
          estimate: stateSparse.anchor_meso - localAnchorDelta,
        }
      : stateAnchor?.monotonic_scope
        ? stateAnchor.monotonic_envelope
        : stateAnchor;
    let effectiveWeight = stateSparseApplied
      ? 0.94
      : stateAnchor?.monotonic_scope
        ? stateMonotonicBlendApplied ? 0.94 : 0
        : statePoolingWeight;
    let effectiveTier = stateSparseApplied
      ? "sparse_exact_family"
      : stateAnchor?.monotonic_scope
        ? stateAnchor.monotonic_envelope
          ? `monotonic_${stateAnchor.monotonic_scope}`
          : "component_before_first_supported_knot"
        : stateAnchor?.tier ?? null;
    // 일반적인 로컬 anchor는 3건(유효 표본 2.5) 이상일 때만 다음 상태의
    // 가격 하한으로 전달한다. 다만 sparse_exact_family는 정확히 같은 옵션의
    // 거래 2건이 서로 25% 안에서 일치하는지를 별도로 검증한 기준점이다.
    // 이 신뢰 여부를 anchor.qualified와 분리해 보존해야 에디 없음에서 레어로
    // 올릴 때 안정적인 윗잠 시세 기준까지 갑자기 사라지지 않는다.
    let monotonicFloorEligible = !effectiveAnchor ||
      effectiveAnchor.qualified === true || effectiveWeight <= EPSILON ||
      stateSparseApplied || stateMonotonicBlendApplied;

    // 등급만 선택한 입력은 '잠재 0줄'이 아니라 해당 등급의 잡옵 상태다.
    // 직접 잡옵 거래를 우선하고, 없을 때만 같은 종류의 최저 유효옵션
    // frontier와 하위 등급의 잡옵↔저옵 가격차를 잇는 검열 근거를 사용한다.
    const gradeOnlyAnchorCandidates = ["potential_grade", "additional_grade"]
      .map((gradeComponent) => {
        const anchor = censoredGradeOnlyAnchor(
          features,
          bounded,
          fitted,
          trained.training_supports,
          gradeComponent,
        );
        if (!anchor) return null;
        const adjustedAnchor = anchor.estimate + localAnchorDelta;
        return {
          anchor,
          adjustedAnchor,
          estimate: stateEstimate * 0.06 + adjustedAnchor * 0.94,
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.estimate - left.estimate);
    const gradeOnlyAnchorCandidate = gradeOnlyAnchorCandidates[0] || null;
    let appliedGradeOnlyAnchor = null;
    if (gradeOnlyAnchorCandidate && gradeOnlyAnchorCandidate.estimate > stateEstimate + 1) {
      stateEstimate = gradeOnlyAnchorCandidate.estimate;
      effectiveAnchor = gradeOnlyAnchorCandidate.anchor;
      effectiveWeight = 0.94;
      effectiveTier = gradeOnlyAnchorCandidate.anchor.tier;
      appliedGradeOnlyAnchor = gradeOnlyAnchorCandidate.anchor;
      monotonicFloorEligible = gradeOnlyAnchorCandidate.anchor.qualified === true;
    }
    const provisional = {
      estimate: Math.min(
        MAX_SAFE_MESO,
        Math.max(baseAnchored ? suppliedBasePrice : 1, stateEstimate),
      ),
      anchor: effectiveAnchor,
      weight: effectiveWeight,
      tier: effectiveTier,
      grade_only_anchor: appliedGradeOnlyAnchor,
      censored_grade: appliedGradeOnlyAnchor?.evidence_kind === "censored"
        ? appliedGradeOnlyAnchor
        : null,
      monotonic_floor_eligible: monotonicFloorEligible,
      decomposition_source_features: features,
    };
    // 재귀 도중 같은 상태가 다시 요청되지는 않지만 먼저 저장해 두면 두 갈래가
    // 모두 완전한 0옵션 상태로 수렴할 때 중복 계산을 피할 수 있다.
    standaloneCalibrationCache.set(cacheKey, provisional);
    const lowerOptionStates = [];
    for (const component of ["potential_options", "additional_options"]) {
      if (componentMagnitude(features, component) <= EPSILON) continue;
      const lowerState = standaloneOptionStateCalibration(
        withoutOptionComponent(features, component),
      );
      lowerOptionStates.push({ component, state: lowerState });
      // 하위 상태가 단 한 건처럼 부족한 실거래 anchor에 끌린 경우 그 가격을
      // 상위 상태의 절대 하한으로 다시 전파하지 않는다. 회귀-only 상태와
      // 충분한 표본으로 qualified된 anchor의 단조 하한은 그대로 유지한다.
      const lowerStateEligible = lowerState.monotonic_floor_eligible === true;
      if (lowerStateEligible && lowerState.estimate > stateEstimate + 1) {
        stateEstimate = lowerState.estimate;
        effectiveAnchor = lowerState.anchor;
        effectiveWeight = lowerState.weight;
        effectiveTier = `zero_option_${lowerState.tier || "component_floor"}`;
        appliedGradeOnlyAnchor = lowerState.grade_only_anchor;
        monotonicFloorEligible = true;
      }
    }
    // 교차 스타포스 옵션 하한도 독립 상태 계산에 포함한다. 이 값이 최상위
    // 계산에서만 적용되면, 에디 없음 상태는 하한을 받지만 레어 상태가 비교하는
    // 하위 등급 반사실에는 하한이 없어져 총액이 다시 내려갈 수 있다.
    const stateOptionPackageFloor = lowerOptionStates
      .map(({ component, state }) => buildOptionPackageFloor(features, component, state))
      .filter(Boolean)
      .sort((left, right) => right.estimate - left.estimate)[0] || null;
    const stateOptionPackageFloorApplied = Boolean(
      stateOptionPackageFloor && stateOptionPackageFloor.estimate > stateEstimate + 1,
    );
    if (stateOptionPackageFloorApplied) {
      stateEstimate = stateOptionPackageFloor.estimate;
      effectiveAnchor = stateOptionPackageFloor.anchor;
      effectiveWeight = stateOptionPackageFloor.weight;
      effectiveTier = stateOptionPackageFloor.tier;
      appliedGradeOnlyAnchor = null;
      monotonicFloorEligible = true;
    }
    // 로컬 보정 유무가 등급마다 달라도 상위 등급의 잡옵 가격이 하위 등급보다
    // 내려가지는 않게 한다. 등급을 한 단계씩 낮춘 동일 상태를 재사용하므로
    // potential/additional이 함께 있어도 유한하게 0등급으로 수렴한다.
    let gradeMonotonicFloor = null;
    let gradeFloorSource = null;
    const unsupportedGradeStepRejected = new Set();
    for (const gradeComponent of ["potential_grade", "additional_grade"]) {
      const spec = gradeComponentSpec(gradeComponent);
      const rank = nonnegative(features.components[gradeComponent]);
      if (!spec || rank <= 0 ||
          (gradeComponent === "potential_grade" &&
            componentMagnitude(features, spec.optionComponent) > EPSILON)) continue;
      const lowerFeatures = withComponentGradeRank(features, gradeComponent, rank - 1);
      const lowerState = standaloneOptionStateCalibration(lowerFeatures);
      for (const component of lowerState.unsupported_grade_step_rejected || []) {
        unsupportedGradeStepRejected.add(component);
      }
      const lowerStateReliable = lowerState.monotonic_floor_eligible === true;
      // 로컬 시세 하한을 그대로 복사하기만 하면 현재 등급의 회귀 프리미엄까지
      // 사라져 `없음·레어·에픽·유니크·레전드리`가 모두 같은 가격이 된다.
      // 동일 장비 전체 거래에서 학습한 해당 한 단계의 양수 로그 프리미엄을
      // 하위 상태의 검증된 시장가 위에 적용해, 가격 역전을 막으면서 등업 가치도
      // 보존한다. 등급 feature는 누적 one-hot이므로 두 상태의 차이가 정확히
      // 이번 한 단계에 해당한다.
      const gradeStepEvidence = gradeStepPremiumEvidence({
        target: features,
        lowerTarget: lowerFeatures,
        entries: bounded,
        fitted,
        validation,
        gradeComponent,
      });
      const pooledGradePriorCandidate = gradeComponent === "additional_grade" &&
          !gradeStepEvidence.qualified
        ? pooledAdditionalGradeStepPremium(features, lowerState.estimate, rank)
        : null;
      // 한두 건짜리 anchor를 무조건 전파하면 단일 고가 이상치가 이후 모든 등급의
      // 하한이 된다. 반대로 등급별 비교군 차이로 생긴 5% 이내의 작은 역전은
      // 시장 잡음으로 보고 평탄화해, 등급을 올렸는데 가격이 내려가는 UI를 막는다.
      const lowerStateWithinNoise = lowerState.estimate <=
        Math.max(1, stateEstimate) * MAX_UNQUALIFIED_GRADE_FLOOR_RATIO + 1;
      const lowerStateEligible = lowerStateReliable || lowerStateWithinNoise;
      const directCurrentBlankRecordCount = bounded.filter((entry) =>
        censoredGradeStateMatches(features, entry.features, gradeComponent) &&
          componentMagnitude(entry.features, spec.optionComponent) <= EPSILON
      ).length;
      const qualifiedGradeOnlyContext = Boolean(
        gradeOnlyAnchorCandidate?.anchor?.qualified &&
          gradeOnlyAnchorCandidate.anchor.grade_component === gradeComponent,
      );
      // 옵션이 입력된 상태에서도 동일 조건의 충분한 실거래 근거가 있으면 그
      // 가격을 보수 prior로 덮어쓰지 않는다. prior는 이 경우 오직 하위 등급보다
      // 낮아지는 것을 막는 floor로만 작동한다.
      const qualifiedCurrentStateContext = qualifiedGradeOnlyContext ||
        stateSparseApplied || stateMonotonicBlendApplied || Boolean(
          effectiveAnchor?.qualified && effectiveWeight > EPSILON,
        );
      const pooledGradePrior = pooledGradePriorCandidate;
      const gradeStepLogEffect = gradeComponent === "additional_grade" &&
          gradeStepEvidence.qualified
        ? gradeStepEvidence.learned_log_effect
        : pooledGradePrior?.log_effect || 0;
      const lowerStateMarketFloor = Math.min(
        MAX_SAFE_MESO,
        lowerState.estimate * Math.exp(gradeStepLogEffect),
      );
      const rejectUnsupportedStepPremium = lowerStateReliable &&
        !gradeStepEvidence.qualified && !pooledGradePrior &&
        directCurrentBlankRecordCount === 0 &&
        !qualifiedGradeOnlyContext;
      // 총액이 이미 같은 하한에 닿아 있더라도 하위 상태의 구성요소 귀속을
      // 이어받는다. 그렇지 않으면 교차 스타포스 옵션 하한이 만든 동일 총액을
      // 현재 등급의 등업값으로 잘못 재배분할 수 있다.
      const pooledGradePriorAuthoritative = Boolean(
        pooledGradePrior && !qualifiedCurrentStateContext,
      );
      const pooledGradePriorFloorApplied = Boolean(
        pooledGradePrior && qualifiedCurrentStateContext &&
          lowerStateMarketFloor > stateEstimate + 1,
      );
      const pooledGradePriorApplied = pooledGradePriorAuthoritative ||
        pooledGradePriorFloorApplied;
      const qualifiedAdditionalGradeFloor = gradeComponent === "additional_grade" &&
        gradeStepEvidence.qualified;
      if (pooledGradePriorApplied || rejectUnsupportedStepPremium ||
          ((qualifiedAdditionalGradeFloor || lowerStateEligible) &&
            lowerStateMarketFloor > stateEstimate + 1)) {
        stateEstimate = pooledGradePriorAuthoritative
          ? Math.min(MAX_SAFE_MESO, lowerState.estimate + pooledGradePrior.premium)
          : pooledGradePriorFloorApplied
            ? lowerStateMarketFloor
          : rejectUnsupportedStepPremium
            ? lowerState.estimate
            : lowerStateMarketFloor;
        effectiveAnchor = lowerState.anchor;
        effectiveWeight = lowerState.weight;
        effectiveTier = `grade_floor_${lowerState.tier || "component_floor"}`;
        appliedGradeOnlyAnchor = lowerState.grade_only_anchor;
        monotonicFloorEligible = pooledGradePriorApplied || lowerStateReliable;
        gradeMonotonicFloor = {
          component: gradeComponent,
          lower_grade_rank: rank - 1,
          estimate: stateEstimate,
          lower_state_estimate: lowerState.estimate,
          learned_step_log_effect: gradeStepLogEffect,
          grade_step_evidence: gradeStepEvidence,
          grade_step_source: pooledGradePriorApplied
            ? "pooled_grade_prior"
            : gradeStepEvidence.qualified
              ? "same_item_market"
              : "none",
          pooled_grade_prior: pooledGradePrior,
          evidence: pooledGradePriorApplied
            ? "pooled_grade_prior"
            : lowerStateReliable ? "qualified" : "bounded_market_noise",
        };
        gradeFloorSource = {
          component: gradeComponent,
          decomposition: lowerState.decomposition,
          features: lowerState.decomposition_source_features || lowerFeatures,
        };
        if (pooledGradePriorApplied || rejectUnsupportedStepPremium) {
          unsupportedGradeStepRejected.add(gradeComponent);
        }
      }
    }
    const resultEstimate = Math.min(
        MAX_SAFE_MESO,
        Math.max(baseAnchored ? suppliedBasePrice : 1, stateEstimate),
      );
    const stateDisplayDecomposition = gradeFloorSource?.decomposition
      ? { ...gradeFloorSource.decomposition }
      : { ...stateDecomposition };
    if (baseAnchored) stateDisplayDecomposition.base = suppliedBasePrice;
    const stateRawEstimate = Object.values(stateDisplayDecomposition)
      .reduce((sum, value) => sum + value, 0);
    if (gradeFloorSource) {
      // 하위 등급 총액을 그대로 하한으로 채택했다면 기존 구성요소 귀속도
      // 보존한다. 새 등급에 임의의 보정액을 배분해 윗잠 가치가 줄어든 것처럼
      // 보이게 하지 않는다. 이론상 차이는 0이며 부동소수 오차만 흡수한다.
      stateDisplayDecomposition[gradeFloorSource.component] +=
        resultEstimate - stateRawEstimate;
    } else if (stateOptionPackageFloorApplied &&
        stateOptionPackageFloor.zero_state_decomposition) {
      for (const [key] of COMPONENTS) {
        stateDisplayDecomposition[key] = finite(
          stateOptionPackageFloor.zero_state_decomposition[key],
        );
      }
      const zeroStateSum = Object.values(stateDisplayDecomposition)
        .reduce((sum, value) => sum + value, 0);
      const floorIncrease = Math.max(0, resultEstimate - zeroStateSum);
      const optionIncrease = Math.min(
        floorIncrease,
        nonnegative(stateOptionPackageFloor.evidence?.option_premium),
      );
      stateDisplayDecomposition[stateOptionPackageFloor.component] += optionIncrease;
      stateDisplayDecomposition.starforce += floorIncrease - optionIncrease;
    } else {
      distributePoolingAdjustment(
        stateDisplayDecomposition,
        resultEstimate - stateRawEstimate,
        features,
        stateSupports,
      );
    }
    // 윗잠·에디 등급이 동시에 켜졌을 때 한쪽 등급에서 온 floor를 두 등급에
    // 임의로 나누지 않는다. 각 등급을 제거한 반사실 상태 대비 실제 한계가로
    // 현재 등급 기여 합계를 재분배해, 가격을 올리지 않은 등급은 0에 가깝게 둔다.
    const activeBlankGrades = ["potential_grade", "additional_grade"].filter(
      (gradeComponent) => {
        const spec = gradeComponentSpec(gradeComponent);
        return spec && nonnegative(features.components[gradeComponent]) > EPSILON &&
          componentMagnitude(features, spec.optionComponent) <= EPSILON;
      },
    );
    if (!gradeFloorSource && activeBlankGrades.length > 1) {
      const gradePool = activeBlankGrades.reduce(
        (sum, gradeComponent) => sum + nonnegative(stateDisplayDecomposition[gradeComponent]),
        0,
      );
      const marginals = activeBlankGrades.map((gradeComponent) => {
        const withoutGrade = standaloneOptionStateCalibration(
          withComponentGradeRank(features, gradeComponent, 0),
        );
        return {
          gradeComponent,
          value: Math.max(0, resultEstimate - withoutGrade.estimate),
        };
      });
      const marginalTotal = marginals.reduce((sum, entry) => sum + entry.value, 0);
      if (gradePool > EPSILON && marginalTotal > EPSILON) {
        for (const { gradeComponent, value } of marginals) {
          stateDisplayDecomposition[gradeComponent] = gradePool * value / marginalTotal;
        }
      }
    }
    const result = {
      estimate: resultEstimate,
      anchor: effectiveAnchor,
      weight: effectiveWeight,
      tier: effectiveTier,
      decomposition: stateDisplayDecomposition,
      grade_only_anchor: appliedGradeOnlyAnchor,
      censored_grade: appliedGradeOnlyAnchor?.evidence_kind === "censored"
        ? appliedGradeOnlyAnchor
        : null,
      grade_monotonic_floor: gradeMonotonicFloor,
      grade_decomposition_component: gradeFloorSource?.component || null,
      unsupported_grade_step_rejected: [...unsupportedGradeStepRejected],
      monotonic_floor_eligible: monotonicFloorEligible,
      option_package_floor: stateOptionPackageFloor,
      decomposition_source_features: gradeFloorSource?.features || features,
    };
    standaloneCalibrationCache.set(cacheKey, result);
    return result;
  };
  const zeroOptionFloors = ["potential_options", "additional_options"]
    .filter((component) => componentMagnitude(predictionFeatures, component) > EPSILON)
    .map((component) => {
      const state = standaloneOptionStateCalibration(
        withoutOptionComponent(predictionFeatures, component),
      );
      return {
        component,
        estimate: state.estimate,
        anchor: state.anchor,
        weight: state.weight,
        tier: `zero_option_${state.tier || "component_floor"}`,
        decomposition: state.decomposition,
        decomposition_source_features: state.decomposition_source_features,
        grade_only_anchor: state.grade_only_anchor,
        censored_grade: state.censored_grade,
        grade_monotonic_floor: state.grade_monotonic_floor,
        grade_decomposition_component: state.grade_decomposition_component,
        unsupported_grade_step_rejected: state.unsupported_grade_step_rejected,
      };
    });
  const optionPackageFloors = zeroOptionFloors
    .map((zeroState) => buildOptionPackageFloor(
      predictionFeatures,
      zeroState.component,
      zeroState,
    ))
    .filter(Boolean);
  const bestOptionPackageFloor = [...optionPackageFloors]
    .sort((left, right) => right.estimate - left.estimate)[0] || null;
  const zeroOptionFloor = zeroOptionFloors
    .sort((left, right) => right.estimate - left.estimate)[0] || null;
  // 에디 등급은 옵션이 함께 입력돼도 별도의 등급 상태 보정이 필요하다.
  // 윗잠은 기존처럼 옵션을 비운 등급-only 상태에만 적용한다.
  const hasGradeOnlyState = [
    ["potential_grade", "potential_options"],
    ["additional_grade", "additional_options"],
  ].some(([gradeComponent, optionComponent]) =>
    nonnegative(predictionFeatures.components[gradeComponent]) > EPSILON &&
      (gradeComponent === "additional_grade" ||
        componentMagnitude(predictionFeatures, optionComponent) <= EPSILON)
  );
  const gradeOnlyState = hasGradeOnlyState
    ? standaloneOptionStateCalibration(predictionFeatures)
    : null;
  const gradeOnlyFloor = gradeOnlyState
    ? {
        component: "grade_only",
        estimate: gradeOnlyState.estimate,
        anchor: gradeOnlyState.anchor,
        weight: gradeOnlyState.weight,
        tier: gradeOnlyState.tier,
        grade_only_anchor: gradeOnlyState.grade_only_anchor,
        censored_grade: gradeOnlyState.censored_grade,
        grade_monotonic_floor: gradeOnlyState.grade_monotonic_floor,
        grade_decomposition_component: gradeOnlyState.grade_decomposition_component,
        unsupported_grade_step_rejected: gradeOnlyState.unsupported_grade_step_rejected,
        decomposition: gradeOnlyState.decomposition,
        decomposition_source_features: gradeOnlyState.decomposition_source_features,
      }
    : null;
  const gradeOnlyStateOverrideApplied = Boolean(
    gradeOnlyState?.unsupported_grade_step_rejected?.length,
  );
  const rankedCalibrationFloor = [...zeroOptionFloors.map((floor) => ({
    ...floor,
    kind: "zero_option",
  })), gradeOnlyFloor && { ...gradeOnlyFloor, kind: "grade_only" }, ...optionPackageFloors]
    .filter(Boolean)
    .sort((left, right) => right.estimate - left.estimate)[0] || null;
  // 등급 근거가 없는 회귀 프리미엄을 standalone에서 제거했다면 그 결과는
  // 단순한 하한이 아니라 해당 등급 상태의 권위 있는 보정값이다. 상위
  // 경로의 비자격 단건 anchor가 더 크다는 이유로 다시 살아나지 않게 한다.
  const calibrationFloor = gradeOnlyStateOverrideApplied
    ? { ...gradeOnlyFloor, kind: "grade_only" }
    : rankedCalibrationFloor;
  const calibrationFloorApplied = Boolean(
    calibrationFloor && (gradeOnlyStateOverrideApplied ||
      calibrationFloor.estimate > optionCalibratedEstimate + 1),
  );
  const zeroOptionFloorApplied = calibrationFloorApplied &&
    calibrationFloor.kind === "zero_option";
  const gradeOnlyFloorApplied = calibrationFloorApplied &&
    calibrationFloor.kind === "grade_only";
  const optionPackageFloorApplied = calibrationFloorApplied &&
    calibrationFloor.kind === "option_package";
  const calibratedEstimate = calibrationFloorApplied
    ? calibrationFloor.estimate
    : optionCalibratedEstimate;
  const monotonicScopeActive = Boolean(localAnchor?.monotonic_scope);
  const monotonicEnvelopeAvailable = adjustedMonotonicAnchor !== null;
  const monotonicBlendApplied = monotonicEnvelopeAvailable &&
    adjustedMonotonicAnchor > componentModelEstimate + 1;
  const sparseFamilyEffectiveAnchor = sparseFamilyCalibration?.source_anchor &&
      adjustedSparseFamilyAnchor !== null
    ? {
        ...sparseFamilyCalibration.source_anchor,
        estimate: adjustedSparseFamilyAnchor - localAnchorDelta,
      }
    : null;
  const effectiveLocalAnchor = calibrationFloorApplied
    ? calibrationFloor.anchor
    : sparseFamilyBlendApplied
    ? sparseFamilyEffectiveAnchor
    : monotonicScopeActive
      ? monotonicEnvelopeAvailable
        ? localAnchor.monotonic_envelope
        : null
      : localAnchor;
  const effectivePoolingWeight = calibrationFloorApplied
    ? calibrationFloor.weight
    : sparseFamilyBlendApplied
    ? 0.94
    : monotonicScopeActive
      ? monotonicBlendApplied
        ? 0.94
        : 0
      : poolingWeight;
  const effectiveCalibrationTier = calibrationFloorApplied
    ? calibrationFloor.tier
    : sparseFamilyBlendApplied
    ? "sparse_exact_family"
    : monotonicScopeActive
      ? monotonicEnvelopeAvailable
        ? `monotonic_${localAnchor.monotonic_scope}`
        : "component_before_first_supported_knot"
      : localAnchor?.tier ?? null;
  const estimate = Math.min(
    MAX_SAFE_MESO,
    Math.max(baseAnchored ? suppliedBasePrice : 1, calibratedEstimate),
  );
  const gradeDecompositionSource = !optionPackageFloorApplied &&
      calibrationFloorApplied && calibrationFloor?.grade_decomposition_component &&
      calibrationFloor?.decomposition
    ? calibrationFloor
    : !optionPackageFloorApplied && gradeOnlyState?.grade_decomposition_component &&
        gradeOnlyState?.decomposition && Math.abs(gradeOnlyState.estimate - estimate) <= 1
      ? gradeOnlyState
      : null;
  const gradeMonotonicDecompositionApplied = Boolean(gradeDecompositionSource);
  if (optionPackageFloorApplied && calibrationFloor.zero_state_decomposition) {
    for (const [key] of COMPONENTS) {
      decomposition[key] = finite(
        calibrationFloor.zero_state_decomposition[key],
      );
    }
    const zeroStateSum = Object.values(decomposition)
      .reduce((sum, value) => sum + value, 0);
    const floorIncrease = Math.max(0, estimate - zeroStateSum);
    const optionIncrease = Math.min(
      floorIncrease,
      nonnegative(calibrationFloor.evidence?.option_premium),
    );
    decomposition[calibrationFloor.component] += optionIncrease;
    decomposition.starforce += floorIncrease - optionIncrease;
  } else if (gradeMonotonicDecompositionApplied) {
    for (const [key] of COMPONENTS) {
      decomposition[key] = finite(gradeDecompositionSource.decomposition[key]);
    }
    const inheritedSum = Object.values(decomposition)
      .reduce((sum, value) => sum + value, 0);
    decomposition[gradeDecompositionSource.grade_decomposition_component] +=
      estimate - inheritedSum;
  } else {
    distributePoolingAdjustment(
      decomposition,
      estimate - componentModelRawEstimate,
      targetFeatures,
      supports,
    );
  }
  if (gradeOnlyState && !gradeMonotonicDecompositionApplied) {
    const blankGradeComponents = ["potential_grade", "additional_grade"].filter(
      (gradeComponent) => {
        const spec = gradeComponentSpec(gradeComponent);
        return spec && nonnegative(predictionFeatures.components[gradeComponent]) > EPSILON &&
          componentMagnitude(predictionFeatures, spec.optionComponent) <= EPSILON;
      },
    );
    if (blankGradeComponents.length > 1) {
      const displayedPool = blankGradeComponents.reduce(
        (sum, gradeComponent) => sum + nonnegative(decomposition[gradeComponent]),
        0,
      );
      const standalonePool = blankGradeComponents.reduce(
        (sum, gradeComponent) =>
          sum + nonnegative(gradeOnlyState.decomposition?.[gradeComponent]),
        0,
      );
      if (displayedPool > EPSILON && standalonePool > EPSILON) {
        for (const gradeComponent of blankGradeComponents) {
          decomposition[gradeComponent] = displayedPool *
            nonnegative(gradeOnlyState.decomposition[gradeComponent]) / standalonePool;
        }
      }
    }
  }
  // 등급은 옵션을 얻기 위한 선행 상태이고, 로컬 옵션 시세 보정은 그 뒤의 옵션
  // 가치다. 지수 모델의 Shapley 상호작용과 로컬 보정액을 둘 사이에 다시 나누면
  // 좋은 옵션일수록 같은 레전드리 등업값이 커져 보인다. 표시용 귀속에서는 해당
  // 옵션을 비운 상태의 Shapley 등급 기여분을 등업값으로 고정하고, 기존
  // 등급+옵션 합계의 나머지를 옵션값으로 둬 총 추정가는 그대로 보존한다.
  // 이 방식은 옵션이 아예 없는 장비에 표시되는 등업값과도 정확히 일치한다.
  const gradeOptionAttribution = {};
  const gradeAttributionFeatures = gradeMonotonicDecompositionApplied
    ? gradeDecompositionSource.decomposition_source_features || predictionFeatures
    : predictionFeatures;
  for (const [gradeComponent, optionComponent] of [
    ["potential_grade", "potential_options"],
    ["additional_grade", "additional_options"],
  ]) {
    if (nonnegative(gradeAttributionFeatures.components[gradeComponent]) <= EPSILON ||
        componentMagnitude(gradeAttributionFeatures, optionComponent) <= EPSILON) {
      continue;
    }
    const noOptions = withoutOptionComponent(gradeAttributionFeatures, optionComponent);
    // 특정 옵션 거래의 로컬 보정은 옵션 잔여값으로만 남기고, 등업값은
    // 옵션이 없는 동일 장비 상태를 구성요소 모델에 넣었을 때의 귀속값으로 둔다.
    const noOptionState = standaloneOptionStateCalibration(noOptions);
    const counterfactualGrade = Math.max(
      0,
      nonnegative(noOptionState.decomposition?.[gradeComponent]),
    );
    const pairTotal = decomposition[gradeComponent] + decomposition[optionComponent];
    if (pairTotal < 0) continue;
    const attributedGrade = clamp(counterfactualGrade, 0, pairTotal);
    decomposition[gradeComponent] = attributedGrade;
    decomposition[optionComponent] = pairTotal - attributedGrade;
    gradeOptionAttribution[gradeComponent] = {
      method: "grade_from_no_options_shapley_then_option_residual",
      no_options_shapley_grade_meso: roundMeso(counterfactualGrade),
      attributed_grade_meso: roundMeso(attributedGrade),
      attributed_option_meso: roundMeso(pairTotal - attributedGrade),
      clamped_to_pair_total: counterfactualGrade > pairTotal,
    };
  }

  let low = componentModelLow;
  let high = componentModelHigh;
  if (effectivePoolingWeight > 0 && effectiveLocalAnchor) {
    const modelRadius = Math.min(1.8, Math.max(
      minimumLogWidth,
      learnedLow > 0
        ? Math.log(safeLearnedEstimate / Math.min(safeLearnedEstimate, learnedLow))
        : 1.8,
      learnedHigh > 0
        ? Math.log(Math.max(safeLearnedEstimate, learnedHigh) / safeLearnedEstimate)
        : 1.8,
    ));
    const localRadius = Math.max(
      0.3 + (1 - confidenceScore) * 0.35,
      effectiveLocalAnchor.low > 0
        ? Math.log(effectiveLocalAnchor.estimate / effectiveLocalAnchor.low)
        : 0,
      effectiveLocalAnchor.high > 0
        ? Math.log(effectiveLocalAnchor.high / effectiveLocalAnchor.estimate)
        : 0,
    );
    const localLow = Math.min(
      effectiveLocalAnchor.low,
      effectiveLocalAnchor.estimate * Math.exp(-localRadius),
    ) + localAnchorDelta;
    const localHigh = Math.max(
      effectiveLocalAnchor.high,
      effectiveLocalAnchor.estimate * Math.exp(localRadius),
    ) + localAnchorDelta;
    low = Math.max(
      0,
      componentModelLow * (1 - effectivePoolingWeight) + localLow * effectivePoolingWeight,
    );
    high = Math.min(
      MAX_SAFE_MESO,
      componentModelHigh * (1 - effectivePoolingWeight) + localHigh * effectivePoolingWeight,
    );
  }
  if (validation?.available && validation.conformal_log_radius_90 > 0) {
    low = Math.min(
      low,
      estimate * Math.exp(-validation.conformal_log_radius_90),
    );
    high = Math.max(
      high,
      estimate * Math.exp(validation.conformal_log_radius_90),
    );
  }

  const roundedEstimate = roundMeso(estimate);
  const componentRows = {};
  let roundedSum = 0;
  for (const [key, label] of COMPONENTS) {
    const support = supports[key];
    const variationScore = key === "base" ? sampleScore : clamp((support.distinct - 1) / 5, 0, 1);
    const componentScore = clamp(
      confidenceScore * (0.45 + variationScore * 0.55) *
        (support.extrapolated ? 0.65 : 1) * (support.identifiable ? 1 : 0.35),
      0,
      1,
    );
    const contribution = roundSignedMeso(decomposition[key]);
    roundedSum += contribution;
    componentRows[key] = {
      key,
      label,
      contribution_meso: contribution,
      range_meso: componentRange(contribution, componentScore),
      confidence: confidenceLevel(componentScore),
      confidence_score: Number(componentScore.toFixed(3)),
      identifiable: support.identifiable,
      support_values: support.distinct,
      extrapolated: support.extrapolated,
      reason_codes: support.reason_codes || [],
      max_correlation: Number.isFinite(support.max_correlation)
        ? Number(support.max_correlation.toFixed(3))
        : null,
      learned_log_effect: Number.isFinite(support.learned_log_effect)
        ? Number(support.learned_log_effect.toFixed(5))
        : null,
      validation_log_effect: Number.isFinite(support.validation_log_effect)
        ? Number(support.validation_log_effect.toFixed(5))
        : null,
    };
  }
  if (baseAnchored) {
    componentRows.base.range_meso = { low: suppliedBasePrice, high: suppliedBasePrice };
    componentRows.base.confidence = "high";
    componentRows.base.confidence_score = 1;
    componentRows.base.identifiable = true;
  }
  // 구성요소 합과 총액의 반올림 오차를 없앤다.
  const roundingDifference = roundedEstimate - roundedSum;
  if (roundingDifference !== 0) {
    const correctionKey = COMPONENTS.slice(1)
      .map(([key]) => key)
      .sort((left, right) =>
        Math.abs(componentRows[right].contribution_meso) -
        Math.abs(componentRows[left].contribution_meso)
      )[0];
    componentRows[correctionKey].contribution_meso += roundingDifference;
    componentRows[correctionKey].range_meso = componentRange(
      componentRows[correctionKey].contribution_meso,
      componentRows[correctionKey].confidence_score,
    );
  }

  const warnings = buildWarnings({
    target: targetFeatures,
    entries: bounded,
    supports,
    profile: resolvedProfile,
    validation,
    baseAnchor: {
      applied: baseAnchored,
      relative_gap: baseAnchorRelativeGap,
    },
    localAnchor,
  });
  return {
    status: "estimated",
    estimator_version: ITEM_MARKET_ESTIMATOR_VERSION,
    item_name: targetFeatures.item_name,
    estimate_meso: roundedEstimate,
    range_meso: {
      low: Math.min(roundMeso(low), roundedEstimate),
      high: Math.max(roundMeso(high), roundedEstimate),
      coverage: baseAnchored
        ? validation?.available
          ? "anchored_total_shifted_from_time_holdout_conformal_90"
          : "anchored_total_shifted_from_training_residual_10_90"
        : validation?.available
          ? "time_holdout_conformal_90"
          : "training_residual_10_90",
    },
    components: componentRows,
    component_order: COMPONENTS.map(([key]) => key),
    confidence: {
      level: confidenceLevel(confidenceScore),
      score: Number(confidenceScore.toFixed(3)),
      sample_count: bounded.length,
      total_same_item_sales: trained.accepted_record_count,
      effective_sample_size: Number(effective.toFixed(1)),
    },
    normalization: {
      ...targetFeatures.profile,
      axis: "main_stat_percent_equivalent",
      target_components: targetFeatures.components,
      personal_equivalence: {
        ...personalTargetFeatures.profile,
        target_components: personalTargetFeatures.components,
      },
    },
    diagnostics: {
      accepted_records: trained.accepted_record_count,
      rejected_records: trained.total_input_records - trained.accepted_record_count,
      used_records: bounded.length,
      latest_sale_at: trained.newest ? new Date(trained.newest).toISOString() : null,
      time_half_life_days: trained.safeHalfLife,
      time_weighting: "exponential half-life",
      training_scope: "all valid sold records of the exact same item; target-conditioned hierarchical local calibration",
      method: "component-family and semantic-option canonicalization; same-item market-derived baseline; time-weighted robust mixed-sign component ridge on log sold price; temporal holdout calibration; stat-family monotonic envelopes with consistent sparse-pair shrinkage; cross-star exact-option package floors; qualified direct or censored grade-only anchors and monotonic grade floors; Shapley total with grade-first counterfactual attribution",
      ridge: Number(trained.lambda.toFixed(4)),
      base_price_source: baseAnchored ? "provided_equipment_preset" : "same_item_market_model",
      learned_base_price_meso: roundMeso(learnedBasePrice),
      observed_blank_base_price_meso: hasBlankBaseAnchor ? roundMeso(blankBaseAnchor) : null,
      supplied_base_price_meso: baseAnchored ? suppliedBasePrice : null,
      base_anchor_relative_gap: Number(baseAnchorRelativeGap.toFixed(3)),
      prediction_feature_clamps: predictionFeatures.prediction_clamps,
      grade_option_attribution: gradeOptionAttribution,
      local_partial_pooling: localAnchor
        ? {
            applied: effectivePoolingWeight > 0,
            weight: Number(effectivePoolingWeight.toFixed(3)),
            anchor_meso: effectiveLocalAnchor
              ? roundMeso(effectiveLocalAnchor.estimate + localAnchorDelta)
              : null,
            neighbor_count: effectiveLocalAnchor?.neighbor_count ?? 0,
            effective_neighbor_count: Number(
              (effectiveLocalAnchor?.effective_neighbor_count ?? 0).toFixed(1),
            ),
            nearest_distance: effectiveLocalAnchor
              ? Number(effectiveLocalAnchor.nearest_distance.toFixed(3))
              : null,
            tier: effectiveCalibrationTier,
            candidate_tier: localAnchor.tier,
            structural_match_count: localAnchor.structural_match_count,
            qualified: Boolean(calibrationFloor?.grade_only_anchor) ||
              calibrationFloor?.grade_monotonic_floor?.evidence === "qualified" ||
              sparseFamilyBlendApplied || (effectiveLocalAnchor
              ? effectiveLocalAnchor.effective_neighbor_count >= 2.5
              : false),
            condition_support_score: Number(conditionSupportScore.toFixed(3)),
            base_anchor_delta_meso: roundSignedMeso(localAnchorDelta),
            monotonic_knot_count: localAnchor.monotonic_knot_count,
            monotonic_scope: localAnchor.monotonic_scope,
            monotonic_envelope_applied: monotonicEnvelopeAvailable,
            monotonic_envelope_adjusted_estimate: monotonicBlendApplied,
            monotonic_envelope_anchor_meso: adjustedMonotonicAnchor === null
              ? null
              : roundMeso(adjustedMonotonicAnchor),
            sparse_family_knot_count: localAnchor.sparse_family_knot_count,
            sparse_family_envelope_applied: sparseFamilyBlendApplied,
            sparse_family_envelope_anchor_meso: adjustedSparseFamilyAnchor === null
              ? null
              : roundMeso(adjustedSparseFamilyAnchor),
            zero_option_floor_applied: Boolean(zeroOptionFloorApplied),
            zero_option_floor_component: zeroOptionFloorApplied
              ? zeroOptionFloor.component
              : null,
            zero_option_floor_meso: zeroOptionFloor
              ? roundMeso(zeroOptionFloor.estimate)
              : null,
            grade_only_floor_applied: Boolean(gradeOnlyFloorApplied),
            grade_only_state_override_applied: gradeOnlyStateOverrideApplied,
            grade_only_floor_meso: gradeOnlyFloor
              ? roundMeso(gradeOnlyFloor.estimate)
              : null,
            grade_only_anchor: calibrationFloor?.grade_only_anchor
              ? {
                  evidence_kind: calibrationFloor.grade_only_anchor.evidence_kind,
                  component: calibrationFloor.grade_only_anchor.grade_component,
                  target_grade_rank: calibrationFloor.grade_only_anchor.target_grade_rank,
                  anchor_meso: roundMeso(
                    calibrationFloor.grade_only_anchor.estimate + localAnchorDelta,
                  ),
                  neighbor_count: calibrationFloor.grade_only_anchor.neighbor_count,
                  effective_neighbor_count: Number(
                    calibrationFloor.grade_only_anchor.effective_neighbor_count.toFixed(1),
                  ),
                }
              : null,
            censored_grade_anchor: calibrationFloor?.censored_grade
              ? {
                  component: calibrationFloor.censored_grade.grade_component,
                  target_grade_rank: calibrationFloor.censored_grade.target_grade_rank,
                  lower_grade_rank: calibrationFloor.censored_grade.lower_grade_rank,
                  anchor_meso: roundMeso(
                    calibrationFloor.censored_grade.estimate + localAnchorDelta,
                  ),
                  option_premium_ratio: Number(
                    calibrationFloor.censored_grade.lower_grade_option_premium_ratio.toFixed(3),
                  ),
                  target_frontier_magnitude:
                    calibrationFloor.censored_grade.target_frontier_magnitude,
                }
              : null,
            grade_monotonic_floor: calibrationFloor?.grade_monotonic_floor || null,
            option_package_floor: bestOptionPackageFloor
              ? {
                  applied: Boolean(optionPackageFloorApplied),
                  component: bestOptionPackageFloor.component,
                  floor_meso: roundMeso(bestOptionPackageFloor.estimate),
                  premium_meso: roundMeso(bestOptionPackageFloor.evidence.premium),
                  option_premium_meso: roundMeso(
                    bestOptionPackageFloor.evidence.option_premium,
                  ),
                  starforce_interaction_premium_meso: roundMeso(
                    bestOptionPackageFloor.evidence.starforce_interaction_premium,
                  ),
                  target_family: bestOptionPackageFloor.evidence.target_family,
                  evidence_count: bestOptionPackageFloor.evidence.evidence_count,
                  effective_evidence_count: Number(
                    bestOptionPackageFloor.evidence.effective_evidence_count.toFixed(1),
                  ),
                  evidence_magnitude: Number(
                    bestOptionPackageFloor.evidence.evidence_magnitude.toFixed(3),
                  ),
                  evidence_starforce: {
                    minimum: bestOptionPackageFloor.evidence.starforce_minimum,
                    maximum: bestOptionPackageFloor.evidence.starforce_maximum,
                  },
                  option_kinds: bestOptionPackageFloor.evidence.option_kinds,
                  option_stat_codes: bestOptionPackageFloor.evidence.option_stat_codes,
                }
              : null,
            target_condition_support_absent: targetConditionSupportAbsent,
          }
        : {
            applied: false,
            weight: 0,
            anchor_meso: null,
            neighbor_count: 0,
            effective_neighbor_count: 0,
            nearest_distance: null,
            tier: null,
            candidate_tier: null,
            structural_match_count: 0,
            qualified: false,
            condition_support_score: 0,
            base_anchor_delta_meso: 0,
            monotonic_knot_count: 0,
            monotonic_scope: null,
            monotonic_envelope_applied: false,
            monotonic_envelope_adjusted_estimate: false,
            monotonic_envelope_anchor_meso: null,
            sparse_family_knot_count: 0,
            sparse_family_envelope_applied: false,
            sparse_family_envelope_anchor_meso: null,
            zero_option_floor_applied: false,
            zero_option_floor_component: null,
            zero_option_floor_meso: null,
            grade_only_floor_applied: false,
            grade_only_state_override_applied: false,
            grade_only_floor_meso: null,
            grade_only_anchor: null,
            censored_grade_anchor: null,
            grade_monotonic_floor: null,
            option_package_floor: null,
            target_condition_support_absent: targetConditionSupportAbsent,
          },
      validation_scope: baseAnchored
        ? "enhancement model validated with learned baseline; external base anchor not directly validated"
        : "complete component model with learned baseline",
      trade_defaults: trained.trade_defaults,
      temporal_validation: validation?.available
        ? {
            available: true,
            train_count: validation.train_count,
            holdout_count: validation.holdout_count,
            accuracy_score: Number(validation.accuracy_score.toFixed(3)),
            median_absolute_percent_error: Number(validation.median_absolute_percent_error.toFixed(3)),
            median_predicted_to_actual_ratio: Number(
              validation.median_predicted_to_actual_ratio.toFixed(3),
            ),
            within_25_percent: Number(validation.within_25_percent.toFixed(3)),
            conformal_log_radius_90: Number(
              validation.conformal_log_radius_90.toFixed(5),
            ),
          }
        : {
            available: false,
            reason: validation?.reason || "not_computed",
            train_count: validation?.train_count || 0,
            holdout_count: validation?.holdout_count || 0,
          },
      fitted_model_reused: Boolean(model || prepared.cacheHit),
      extrapolated_components: Object.entries(supports)
        .filter(([, support]) => support.extrapolated)
        .map(([key]) => key),
    },
    warnings,
  };
}

export function estimateItemMarketPrice(target, records, options = {}) {
  return estimateItemMarketValue({ target, comparables: records, ...options });
}
