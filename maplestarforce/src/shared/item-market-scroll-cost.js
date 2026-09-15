import {
  TRACE_SLOTS,
  calculateChaosReturnStrategy,
  calculateMagicalReturnCraft,
  calculateSlotCraft,
  chaosAtLeast,
  chaosSumAtLeast,
  specialTraceCost,
  traceCost,
  traceSuccessRate,
} from "maple-core/scroll";
import { calculateAutomaticFirstChaos } from "./scroll-options.js";
import {
  deriveAppliedUpgradeCount,
  readUpgradeSlotMaximum,
} from "./item-upgrade-slots.js";

const STORAGE_KEY = "maplestarforce:scroll:v2";
const MAN_MESO = 10_000;
const EOK_MESO = 100_000_000;
const MAX_SLOTS = 20;
const CHAOS_VALUES = Object.freeze([0, 1, 2, 3, 4, 6]);
const STAT_KEYS = Object.freeze([
  "str_flat",
  "dex_flat",
  "int_flat",
  "luk_flat",
]);
const CHAOS_UNIT_KEYS = new Set([
  ...STAT_KEYS,
  "attack_flat",
  "magic_attack_flat",
  "defense_flat",
  "speed_flat",
  "jump_flat",
]);
const CHAOS_TEN_KEYS = new Set(["hp_flat", "mp_flat"]);
const ACCESSORY_CATEGORIES = new Set([
  "얼굴장식",
  "눈장식",
  "귀고리",
  "반지",
  "펜던트",
  "벨트",
]);
const ARMOR_CATEGORIES = new Set([
  "모자",
  "상의",
  "한벌옷",
  "하의",
  "신발",
  "망토",
  "어깨장식",
]);

/**
 * 주문서 계산기와 같은 기본 시세를 쓴다. 시세/이벤트 설정만 공유하고,
 * 개인이 이미 가진 주문서는 장비의 보편적인 제작 기댓값에서 제외한다.
 */
export const ITEM_MARKET_SCROLL_DEFAULTS = Object.freeze({
  tracePer1000: 140,
  earringPrice: 8_000,
  chaos60Price: 3,
  chaos100Price: 4_500,
  magicalPrice: 5_000,
  returnPrice: 6_900,
  clean10Price: 140,
  clean5Price: 70,
  innocent50Price: 800,
  maplePointsPerEok: 2_000,
  halfPrice: false,
  fever: true,
  guild: true,
  guildProtection: 4,
  dexterityLevel: 100,
  useInnocent: true,
  preserveStarforce: false,
  magicalFirstStarforced: false,
  // 현재 주문서 계산기에는 이 시세 입력이 없다. 호출자가 명시한 경우만 쓴다.
  premiumAccessoryPrice: 0,
  cleanStock: 0,
  innocentStock: 0,
  arkInnocentStock: 0,
  chaos100Stock: 0,
});

const NUMBER_SETTING_KEYS = Object.freeze([
  "tracePer1000",
  "earringPrice",
  "chaos60Price",
  "chaos100Price",
  "magicalPrice",
  "returnPrice",
  "clean10Price",
  "clean5Price",
  "innocent50Price",
  "maplePointsPerEok",
  "guildProtection",
  "dexterityLevel",
  "premiumAccessoryPrice",
]);
const BOOLEAN_SETTING_KEYS = Object.freeze([
  "halfPrice",
  "fever",
  "guild",
  "useInnocent",
  "preserveStarforce",
  "magicalFirstStarforced",
]);

function normalizeSettings(source = {}) {
  const result = { ...ITEM_MARKET_SCROLL_DEFAULTS };
  for (const key of NUMBER_SETTING_KEYS) {
    const value = Number(source?.[key]);
    if (Number.isFinite(value) && value >= 0) result[key] = value;
  }
  for (const key of BOOLEAN_SETTING_KEYS) {
    if (typeof source?.[key] === "boolean") result[key] = source[key];
  }
  result.guildProtection = Math.min(4, result.guildProtection);
  result.dexterityLevel = Math.min(100, result.dexterityLevel);
  // 저장된 개인 재고는 중고 장비의 보편적인 제작비를 낮추지 않는다.
  result.cleanStock = 0;
  result.innocentStock = 0;
  result.arkInnocentStock = 0;
  result.chaos100Stock = 0;
  return result;
}

/** 주문서 페이지의 저장 시세를 안전하게 읽는다. 테스트에서는 storage를 주입한다. */
export function loadItemMarketScrollSettings({ storage, settings } = {}) {
  let saved = {};
  const sourceStorage = storage ?? globalThis.localStorage;
  try {
    saved = JSON.parse(sourceStorage?.getItem?.(STORAGE_KEY) || "{}") || {};
  } catch {
    saved = {};
  }
  return normalizeSettings({ ...saved, ...(settings || {}) });
}

function itemBody(value) {
  return value?.item && typeof value.item === "object" ? value.item : value || {};
}

function nonNegativeInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function normalizeStats(value) {
  const stats = {};
  const invalid = [];
  for (const [key, raw] of Object.entries(value && typeof value === "object" ? value : {})) {
    const number = Number(raw);
    if (!Number.isFinite(number) || number < 0) {
      invalid.push(key);
    } else if (number > 0) {
      stats[key] = number;
    }
  }
  return { stats, invalid };
}

function hasStats(stats) {
  return Object.keys(stats).length > 0;
}

function unavailable(basis, extra = {}) {
  return {
    status: "unavailable",
    expected_cost_meso: null,
    basis,
    confidence: "low",
    method: "unknown",
    method_label: "주문서 종류 판별 불가",
    evidence: {},
    ...extra,
  };
}

function notApplicable(basis, extra = {}) {
  return {
    status: "not_applicable",
    expected_cost_meso: null,
    basis,
    confidence: "high",
    method: "none",
    method_label: "주문서 강화 없음",
    evidence: {},
    ...extra,
  };
}

function calculated(expectedCostMeso, basis, extra) {
  if (!Number.isFinite(expectedCostMeso) || expectedCostMeso <= 0) {
    return unavailable(`주문서 방식은 판별했지만 ${basis}`, extra);
  }
  return {
    status: "calculated",
    expected_cost_meso: expectedCostMeso,
    basis,
    ...extra,
  };
}

function upgradeContext(item) {
  const upgrade = item?.upgrade || {};
  const maximum = readUpgradeSlotMaximum(item);
  const remaining = nonNegativeInteger(upgrade.remaining);
  const recoverable = nonNegativeInteger(upgrade.recoverable);
  const explicitApplied = nonNegativeInteger(upgrade.applied);
  const derivedApplied = deriveAppliedUpgradeCount({
    maximum,
    remaining,
    recoverable,
  });
  return {
    maximum,
    remaining,
    recoverable,
    explicitApplied,
    applied: derivedApplied ?? explicitApplied,
    appliedSource: derivedApplied === null
      ? "upgrade.applied"
      : upgrade.inference_source === "scroll-stats"
        ? "scroll-stats"
        : "max-remaining-recoverable",
  };
}

function traceSlot(category) {
  const text = String(category || "").trim();
  if (text === "장갑") return "glove";
  if (text === "기계심장" || text === "기계 심장") return "heart";
  if (ACCESSORY_CATEGORIES.has(text)) return "accessory";
  if (ARMOR_CATEGORIES.has(text)) return "armor";
  if (text === "무기" || text.includes("무기")) return "weapon";
  return null;
}

function primaryCandidates(requiredJob, stats, { attackSensitive = false } = {}) {
  const job = String(requiredJob || "").trim();
  if (job.includes("마법사")) return [{ stat: "int_flat", attack: "magic_attack_flat" }];
  if (job.includes("궁수")) return [{ stat: "dex_flat", attack: "attack_flat" }];
  if (job.includes("도적")) return [{ stat: "luk_flat", attack: "attack_flat" }];
  if (job.includes("전사") || job.includes("제로")) {
    return [{ stat: "str_flat", attack: "attack_flat" }];
  }
  if (job.includes("제논")) {
    return [
      { stat: "str_flat", attack: "attack_flat" },
      { stat: "dex_flat", attack: "attack_flat" },
      { stat: "luk_flat", attack: "attack_flat" },
    ];
  }
  if (job.includes("해적")) {
    return [
      { stat: "str_flat", attack: "attack_flat" },
      { stat: "dex_flat", attack: "attack_flat" },
    ];
  }
  const ordered = STAT_KEYS
    .map((stat) => ({ stat, value: Number(stats[stat]) || 0 }))
    .sort((left, right) => right.value - left.value);
  if (attackSensitive) {
    const attack = (Number(stats.magic_attack_flat) || 0) > (Number(stats.attack_flat) || 0)
      ? "magic_attack_flat"
      : "attack_flat";
    if (attack === "magic_attack_flat") {
      return [{ stat: "int_flat", attack }];
    }
    return ordered
      .filter((entry) => entry.stat !== "int_flat")
      .map((entry) => ({ stat: entry.stat, attack }));
  }
  return ordered.map((entry) => ({
    stat: entry.stat,
    attack: entry.stat === "int_flat" ? "magic_attack_flat" : "attack_flat",
  }));
}

function addStat(vector, key, value) {
  if (value) vector[key] = (vector[key] || 0) + value;
  return vector;
}

/*
 * 120레벨 이상 장비의 현재 주문의 흔적 표. 이 페이지가 수집하는 실제
 * 장비군(120~250레벨)의 명확한 벡터만 자동 판별한다. 더 낮은 레벨을
 * 어림짐작하지 않는 것이 잘못된 제작비를 붙이는 것보다 안전하다.
 */
function traceGainVector({ slot, rate, applied, primary, attack, full }) {
  if (!Number.isInteger(applied) || applied < 1) return null;
  const vector = {};
  if (slot === "armor") {
    const gains = {
      100: { stat: 3, hp: 30, defense: 3 },
      70: { stat: 4, hp: 70, defense: 5 },
      30: { stat: 7, hp: 120, defense: 10 },
      15: { stat: 10, hp: 170, defense: 15 },
    }[rate];
    if (!gains) return null;
    addStat(vector, primary, gains.stat * applied);
    addStat(vector, "hp_flat", gains.hp * applied);
    addStat(vector, "defense_flat", gains.defense * applied);
    // 방어구 주흔 완작 툴팁에서 함께 분리되는 공·마 +1을 포함한다.
    if (full) addStat(vector, attack, 1);
    return vector;
  }
  if (slot === "glove") {
    const gain = { 100: 1, 70: 2, 30: 3, 15: 4 }[rate];
    return gain ? addStat(vector, attack, gain * applied) : null;
  }
  if (slot === "accessory") {
    const gain = { 100: 2, 70: 3, 30: 5 }[rate];
    return gain ? addStat(vector, primary, gain * applied) : null;
  }
  if (slot === "weapon") {
    const gains = {
      100: { stat: 1, attack: 3 },
      70: { stat: 2, attack: 5 },
      30: { stat: 3, attack: 7 },
      15: { stat: 4, attack: 9 },
    }[rate];
    if (!gains) return null;
    addStat(vector, primary, gains.stat * applied);
    addStat(vector, attack, gains.attack * applied);
    return vector;
  }
  return null;
}

function exactVectorMatch(observed, expected, { optionalExpected = [] } = {}) {
  const optional = new Set(optionalExpected);
  for (const [key, value] of Object.entries(observed)) {
    if (expected[key] !== value) return false;
  }
  for (const [key, value] of Object.entries(expected)) {
    if (!optional.has(key) && observed[key] !== value) return false;
  }
  return true;
}

function deterministicEvidence(context, stats, extra = {}) {
  return {
    upgrade_maximum: context.maximum,
    applied: context.applied,
    remaining: context.remaining,
    recoverable: context.recoverable,
    applied_source: context.appliedSource,
    matched_scroll_stats: { ...stats },
    inventory_assumption: "보유 주문서 0장",
    ...extra,
  };
}

function traceCandidates(item, context, stats, applied = context.applied) {
  const slot = traceSlot(item.category);
  const level = Number(item.base_level);
  if (!slot || slot === "heart" || !(level >= 120) || !TRACE_SLOTS[slot]) return [];
  const full = context.maximum === context.applied &&
    context.remaining === 0 && context.recoverable === 0;
  const candidates = [];
  for (const primary of primaryCandidates(item.required_job, stats, {
    attackSensitive: slot === "weapon" || slot === "glove",
  })) {
    for (const rate of TRACE_SLOTS[slot].rates) {
      const vector = traceGainVector({
        slot,
        rate,
        applied,
        primary: primary.stat,
        attack: primary.attack,
        full,
      });
      if (!vector) continue;
      // 방어력은 현재 장비 입력 UI에 없으므로 누락만 허용한다.
      const optional = slot === "armor" ? ["defense_flat"] : [];
      if (exactVectorMatch(stats, vector, { optionalExpected: optional })) {
        candidates.push({
          method: "spell_trace",
          methodLabel: `주흔 ${rate}%`,
          slot,
          rate,
          primary: primary.stat,
          attack: primary.attack,
          expectedVector: vector,
          confidence: Object.keys(vector).every((key) => stats[key] === vector[key])
            ? "high"
            : "medium",
        });
      }
    }
  }
  return candidates;
}

function traceMeso(count, settings) {
  return (count / 1_000) * settings.tracePer1000 * MAN_MESO;
}

function restoreChoices(settings) {
  const traceCount = specialTraceCost("clean", { halfPrice: settings.halfPrice });
  return [
    { name: "주흔 순백 100%", each: traceMeso(traceCount, settings), rate: 1 },
    { name: "순백 10%", each: settings.clean10Price * MAN_MESO, rate: 0.1 },
    { name: "순백 5%", each: settings.clean5Price * MAN_MESO, rate: 0.05 },
  ]
    .filter((choice) => choice.each > 0)
    .map((choice) => ({ ...choice, cost: choice.each / choice.rate }))
    .sort((left, right) => left.cost - right.cost);
}

function resetChoices(settings, preserveStarforce = settings.preserveStarforce) {
  const traceKind = preserveStarforce ? "arkInnocent" : "innocent";
  const traceCount = specialTraceCost(traceKind, { halfPrice: settings.halfPrice });
  return [
    {
      name: preserveStarforce ? "주흔 아크 이노센트 100%" : "주흔 이노센트 100%",
      each: traceMeso(traceCount, settings),
      rate: 1,
    },
    preserveStarforce
      ? null
      : { name: "이노센트 50%", each: settings.innocent50Price * MAN_MESO, rate: 0.5 },
  ]
    .filter(Boolean)
    .filter((choice) => choice.each > 0)
    .map((choice) => ({ ...choice, cost: choice.each / choice.rate }))
    .sort((left, right) => left.cost - right.cost);
}

function slotCraftCost({ item, context, candidate, settings, targetApplied, allowReset = true }) {
  const maximum = candidate.maximum ?? context.maximum;
  const target = targetApplied ?? context.applied;
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > MAX_SLOTS ||
      !Number.isInteger(target) || target < 1 || target > maximum) {
    return null;
  }
  const restore = restoreChoices(settings)[0];
  const reset = settings.useInnocent && allowReset ? resetChoices(settings)[0] : null;
  if (!restore) return null;
  let successRate;
  let scrollMeso;
  if (candidate.method === "earring_scroll") {
    successRate = 0.1;
    scrollMeso = settings.earringPrice * MAN_MESO;
  } else {
    successRate = traceSuccessRate(candidate.rate, {
      fever: settings.fever,
      guild: settings.guild,
      dexterity: settings.dexterityLevel,
    });
    const traceCount = traceCost(
      candidate.slot,
      Math.round(Number(item.base_level)),
      candidate.rate,
      { halfPrice: settings.halfPrice },
    );
    if (traceCount === null) return null;
    scrollMeso = traceMeso(traceCount, settings);
  }
  if (!(scrollMeso > 0)) return null;
  const result = calculateSlotCraft({
    slots: maximum,
    target,
    startSuccess: 0,
    startRemaining: maximum,
    successRate,
    slotProtectionRate: candidate.method === "spell_trace"
      ? settings.guildProtection / 100
      : 0,
    scrollCost: scrollMeso,
    cleanCost: restore.cost,
    innocentCost: reset?.cost ?? Number.POSITIVE_INFINITY,
    cleanStock: 0,
    innocentStock: 0,
  });
  return {
    expectedCost: result.expectedCost,
    successRate,
    restore: restore.name,
    reset: reset?.name ?? null,
  };
}

function inferEarring(item, context, stats) {
  if (String(item.category) !== "귀고리") return null;
  const applied = context.applied;
  const expected = {
    int_flat: 3 * applied,
    magic_attack_flat: 5 * applied,
  };
  if (!exactVectorMatch(stats, expected)) return null;
  return {
    method: "earring_scroll",
    methodLabel: "귀 장식 지력 주문서 10%",
    confidence: "high",
    expectedVector: expected,
  };
}

function isMagicalCategory(category) {
  const text = String(category || "").trim();
  return text === "기계심장" || text === "기계 심장" ||
    text === "무기" || text.includes("무기");
}

function attainableSum(rolls, target, values = CHAOS_VALUES) {
  if (!Number.isInteger(rolls) || rolls < 0 || !Number.isInteger(target) || target < 0) {
    return false;
  }
  let sums = new Set([0]);
  for (let index = 0; index < rolls; index += 1) {
    const next = new Set();
    for (const sum of sums) {
      for (const value of values) {
        if (sum + value <= target) next.add(sum + value);
      }
    }
    sums = next;
  }
  return sums.has(target);
}

function inferMagical(item, context, stats) {
  if (!isMagicalCategory(item.category)) return null;
  const applied = context.applied;
  if (!Number.isInteger(applied) || applied < 1) return null;
  const attackEntries = ["attack_flat", "magic_attack_flat"]
    .filter((key) => (stats[key] || 0) > 0);
  if (attackEntries.length !== 1) return null;
  const attackKey = attackEntries[0];
  const allowed = new Set([...STAT_KEYS, attackKey]);
  if (Object.keys(stats).some((key) => !allowed.has(key))) return null;
  if (!STAT_KEYS.every((key) => stats[key] === 3 * applied)) return null;
  const attack = stats[attackKey];
  if (!attainableSum(applied, attack, [9, 10, 11])) return null;
  const allPerfect = attack === 11 * applied;
  return {
    method: allPerfect ? "magical_return" : "magical",
    methodLabel: allPerfect ? "매지컬리턴" : "매지컬 주문서",
    confidence: allPerfect ? (applied === 1 ? "low" : "medium") : "high",
    attackKey,
    attack,
    allPerfect,
  };
}

function magicalCost(candidate, context, settings) {
  const scrollPrice = settings.magicalPrice * MAN_MESO;
  if (!(scrollPrice > 0)) return null;
  if (!candidate.allPerfect) return { expectedCost: context.applied * scrollPrice };
  if (context.applied === 1) return null;
  const reset = resetChoices(settings, settings.magicalFirstStarforced)[0];
  if (!reset || !(settings.maplePointsPerEok > 0)) return null;
  const result = calculateMagicalReturnCraft({
    slots: context.applied,
    target: 11,
    scrollPrice,
    returnPrice: settings.returnPrice,
    resetCost: reset.each,
    resetRate: reset.rate,
    resetStock: 0,
  });
  return {
    expectedCost:
      result.costs.otherMeso +
      (result.costs.returnMaplePoints / settings.maplePointsPerEok) * EOK_MESO,
    reset: reset.name,
  };
}

function scaledChaosValue(key, value) {
  if (CHAOS_UNIT_KEYS.has(key)) return value;
  if (CHAOS_TEN_KEYS.has(key) && value % 10 === 0) return value / 10;
  return null;
}

function isChaosVector(stats, rolls) {
  if (!hasStats(stats)) return false;
  for (const [key, value] of Object.entries(stats)) {
    const scaled = scaledChaosValue(key, value);
    if (scaled === null || !attainableSum(rolls, scaled)) return false;
  }
  return true;
}

function usefulChaosTarget(item, stats) {
  const candidates = primaryCandidates(item.required_job, stats, { attackSensitive: true });
  const primary = candidates.find((entry) => (stats[entry.stat] || 0) > 0) ?? candidates[0];
  if (!primary) return { attack: 0, stat: 0, statCount: 0, primary: null, attackKey: null };
  return {
    attack: Number(stats[primary.attack]) || 0,
    stat: Number(stats[primary.stat]) || 0,
    statCount: (stats[primary.stat] || 0) > 0 ? 1 : 0,
    primary: primary.stat,
    attackKey: primary.attack,
  };
}

function firstChaosCost(item, residual, settings) {
  const target = usefulChaosTarget(item, residual);
  if (!(target.attack > 0 || target.stat > 0)) return null;
  const optionChance =
    chaosAtLeast(target.attack) *
    chaosSumAtLeast(target.stat, Math.max(1, target.statCount));
  if (!(optionChance > 0)) return null;
  const reset = resetChoices(settings)[0];
  if (!reset) return null;
  const result = calculateAutomaticFirstChaos({
    targetChance: optionChance,
    chaos60Cost: settings.chaos60Price * MAN_MESO,
    resetCost: reset.cost,
    chaos100Stock: 0,
    resetStock: 0,
  });
  if (!Number.isFinite(result.cost)) return null;
  return { expectedCost: result.cost, target, reset: reset.name, optionChance };
}

function subtractVector(observed, base) {
  const residual = {};
  for (const [key, value] of Object.entries(observed)) {
    const remainder = value - (base[key] || 0);
    if (remainder < 0) return null;
    if (remainder > 0) residual[key] = remainder;
  }
  // A required deterministic field cannot simply disappear from a complete source vector.
  for (const [key, value] of Object.entries(base)) {
    if (key !== "defense_flat" && value > 0 && observed[key] === undefined) return null;
  }
  return residual;
}

function mixedChaosFirstCandidates(item, context, stats) {
  if (context.applied < 2) return [];
  const slot = traceSlot(item.category);
  const level = Number(item.base_level);
  if (!slot || slot === "heart" || !(level >= 120) || !TRACE_SLOTS[slot]) return [];
  const traceWorks = context.applied - 1;
  const full = context.maximum === context.applied &&
    context.remaining === 0 && context.recoverable === 0;
  const candidates = [];
  for (const primary of primaryCandidates(item.required_job, stats, {
    attackSensitive: slot === "weapon" || slot === "glove",
  })) {
    for (const rate of TRACE_SLOTS[slot].rates) {
      const base = traceGainVector({
        slot,
        rate,
        applied: traceWorks,
        primary: primary.stat,
        attack: primary.attack,
        full,
      });
      if (!base) continue;
      const residual = subtractVector(stats, base);
      if (!residual || !isChaosVector(residual, 1)) continue;
      const useful = usefulChaosTarget(item, residual);
      if (!(useful.attack > 0 || useful.stat > 0)) continue;
      candidates.push({
        method: "chaos_first_trace",
        methodLabel: `놀긍 첫작 + 주흔 ${rate}%`,
        confidence: "medium",
        slot,
        rate,
        primary: primary.stat,
        attack: primary.attack,
        traceWorks,
        expectedVector: base,
        residual,
      });
    }
  }
  return candidates;
}

function mixedChaosFirstCost(item, context, candidate, settings) {
  const first = firstChaosCost(item, candidate.residual, settings);
  if (!first) return null;
  const trace = slotCraftCost({
    item,
    context,
    candidate: {
      ...candidate,
      method: "spell_trace",
      maximum: context.maximum - 1,
    },
    settings,
    targetApplied: candidate.traceWorks,
    // 첫작을 지우는 이노센트는 이후 작 전략에 사용할 수 없다.
    allowReset: false,
  });
  if (!trace) return null;
  return {
    expectedCost: first.expectedCost + trace.expectedCost,
    first,
    trace,
  };
}

function inferPremiumAccessory(item, context, stats) {
  if (!ACCESSORY_CATEGORIES.has(String(item.category))) return null;
  const entries = Object.entries(stats);
  if (entries.length !== 1 || !["attack_flat", "magic_attack_flat"].includes(entries[0][0])) {
    return null;
  }
  const amount = entries[0][1];
  if (amount < 4 * context.applied || amount > 5 * context.applied) return null;
  return {
    method: "premium_accessory",
    methodLabel: "프리미엄 악세서리 공·마 주문서",
    confidence: "medium",
    attackKey: entries[0][0],
    amount,
  };
}

function inferredUpgradeContext(maximum, applied) {
  return {
    maximum,
    remaining: maximum - applied,
    recoverable: 0,
    explicitApplied: null,
    applied,
    appliedSource: "scroll-stats",
  };
}

function collectAppliedInferenceCandidates(item, maximum, stats) {
  const candidates = [];
  const add = (context, priority, method, methodLabel, confidence = "low") => {
    candidates.push({
      applied: context.applied,
      priority,
      method,
      method_label: methodLabel,
      confidence,
    });
  };

  for (let applied = 1; applied <= maximum; applied += 1) {
    const context = inferredUpgradeContext(maximum, applied);
    const magical = inferMagical(item, context, stats);
    if (magical) {
      add(context, 5, magical.method, magical.methodLabel, magical.confidence);
    }

    const earring = inferEarring(item, context, stats);
    if (earring) {
      add(context, 5, earring.method, earring.methodLabel, earring.confidence);
    }

    for (const trace of traceCandidates(item, context, stats)) {
      add(context, 4, trace.method, trace.methodLabel, trace.confidence);
    }
    for (const mixed of mixedChaosFirstCandidates(item, context, stats)) {
      add(context, 4, mixed.method, mixed.methodLabel, mixed.confidence);
    }

    const premium = inferPremiumAccessory(item, context, stats);
    if (premium) {
      add(context, 3, premium.method, premium.methodLabel, premium.confidence);
    }

    // 놀긍은 여러 번의 결과 합이 같을 수 있어 가장 약한 근거로만 쓴다.
    // 귀지·주흔·매지컬처럼 더 구체적인 벡터가 있으면 그 판정을 우선한다.
    if (isChaosVector(stats, applied)) {
      add(context, 1, "chaos", "놀긍", "low");
    }
  }
  return candidates;
}

/**
 * 장비의 최대 업그레이드 횟수와 주문서 상승 수치만으로 적용된 작 수를 복원한다.
 * 같은 수치를 만들 수 있는 작 수가 둘 이상이면 임의로 하나를 고르지 않는다.
 */
export function inferAutomaticScrollUpgradeState({ target } = {}) {
  const item = itemBody(target);
  const maximum = readUpgradeSlotMaximum(item);
  const normalized = normalizeStats(item?.stats?.scroll);
  const stats = normalized.stats;

  if (normalized.invalid.length) {
    return {
      status: "unavailable",
      applied: null,
      remaining: null,
      recoverable: null,
      source: "scroll-stats",
      candidates: [],
      invalid_stat_keys: normalized.invalid,
    };
  }
  if (!hasStats(stats)) {
    return {
      status: "not_applicable",
      applied: 0,
      remaining: Number.isInteger(maximum) ? maximum : null,
      recoverable: Number.isInteger(maximum) ? 0 : null,
      source: "scroll-stats",
      candidates: [],
    };
  }
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > MAX_SLOTS) {
    return {
      status: "unavailable",
      applied: null,
      remaining: null,
      recoverable: null,
      source: "scroll-stats",
      candidates: [],
    };
  }

  const candidates = collectAppliedInferenceCandidates(item, maximum, stats);
  if (!candidates.length) {
    return {
      status: "unavailable",
      applied: null,
      remaining: null,
      recoverable: null,
      source: "scroll-stats",
      candidates: [],
    };
  }
  const priority = Math.max(...candidates.map((candidate) => candidate.priority));
  const strongest = candidates.filter((candidate) => candidate.priority === priority);
  const appliedValues = [...new Set(strongest.map((candidate) => candidate.applied))];
  if (appliedValues.length !== 1) {
    return {
      status: "ambiguous",
      applied: null,
      remaining: null,
      recoverable: null,
      source: "scroll-stats",
      candidates: strongest,
    };
  }

  const applied = appliedValues[0];
  return {
    status: "inferred",
    applied,
    remaining: maximum - applied,
    recoverable: 0,
    source: "scroll-stats",
    confidence: strongest.every((candidate) => candidate.confidence === "high")
      ? "high"
      : strongest.some((candidate) => candidate.confidence === "low")
        ? "low"
        : "medium",
    candidates: strongest,
  };
}

function chaosReturnCost(item, context, stats, settings) {
  const target = usefulChaosTarget(item, stats);
  if (!(target.attack > 0 || target.stat > 0) || !(settings.maplePointsPerEok > 0)) return null;
  const result = calculateChaosReturnStrategy({
    slots: context.applied,
    averageAttackTarget: target.attack / context.applied,
    averageStatTarget: target.stat / context.applied,
    statCount: Math.max(1, target.statCount),
    firstWork: null,
    returnWork: {
      chaosRate: 60,
      chaosPrice: settings.chaos60Price * MAN_MESO,
      returnPrice: (settings.returnPrice / settings.maplePointsPerEok) * EOK_MESO,
    },
  });
  return {
    expectedCost:
      result.costs.first + result.costs.returnChaos + result.costs.returnScroll,
    target,
  };
}

/**
 * 주문서 상승 벡터에서 명확한 제작 방식을 고르고 주문서 계산기 시세로
 * 제작 기댓값을 계산한다. 최종 수치만으로 리턴 사용 여부가 증명되지 않는
 * 경우에는 억지로 한 방식의 비용을 붙이지 않는다.
 */
function calculateAutomaticScrollExpectedCostUnsafe({
  target,
  settings,
  storage,
} = {}) {
  const item = itemBody(target);
  const resolvedSettings = loadItemMarketScrollSettings({ storage, settings });
  const normalized = normalizeStats(item?.stats?.scroll);
  const stats = normalized.stats;
  let context = upgradeContext(item);
  let appliedInference = null;
  if (hasStats(stats) && (!Number.isInteger(context.applied) || context.applied < 1)) {
    appliedInference = inferAutomaticScrollUpgradeState({ target: item });
    if (Number.isInteger(appliedInference.applied) && appliedInference.applied > 0) {
      context = inferredUpgradeContext(context.maximum, appliedInference.applied);
    }
  }
  const commonEvidence = deterministicEvidence(context, stats);

  if (normalized.invalid.length) {
    return unavailable("주문서 상승 수치에 음수 또는 숫자가 아닌 값이 있음", {
      evidence: { ...commonEvidence, invalid_stat_keys: normalized.invalid },
    });
  }
  if (!hasStats(stats)) {
    return notApplicable("주문서로 오른 수치 없음", { evidence: commonEvidence });
  }
  if (!Number.isInteger(context.applied) || context.applied < 1) {
    return unavailable(
      appliedInference?.status === "ambiguous"
        ? "주문서 수치만으로 적용된 작 수를 하나로 판별할 수 없음"
        : "주문서 수치는 있지만 적용된 작 수를 복원할 수 없음",
      {
        evidence: {
          ...commonEvidence,
          applied_candidates: appliedInference?.candidates || [],
        },
      },
    );
  }
  if (!Number.isInteger(context.maximum) || context.maximum < context.applied ||
      context.maximum > MAX_SLOTS) {
    return unavailable("장비 최대 업그레이드 횟수를 확인할 수 없음", {
      evidence: commonEvidence,
    });
  }

  const magical = inferMagical(item, context, stats);
  if (magical) {
    if (magical.allPerfect && context.applied === 1) {
      return unavailable("1작 공·마 +11은 일반 매지컬과 매지컬리턴을 구분할 수 없음", {
        method: "magical_or_return",
        method_label: "매지컬 · 리턴 여부 판별 불가",
        confidence: "low",
        evidence: { ...commonEvidence, attack_stat: magical.attackKey },
      });
    }
    const cost = magicalCost(magical, context, resolvedSettings);
    if (!cost) {
      return unavailable("매지컬 또는 리턴·초기화 시세 확인 필요", {
        method: magical.method,
        method_label: magical.methodLabel,
        confidence: magical.confidence,
        evidence: { ...commonEvidence, attack_stat: magical.attackKey },
      });
    }
    return calculated(
      cost.expectedCost,
      magical.allPerfect
        ? "모든 작 공·마 +11 · 첫작 초기화 후 나머지 리턴 · 보유 주문서 제외"
        : "매지컬 100% 주문서 사용량 · 보유 주문서 제외",
      {
        method: magical.method,
        method_label: magical.methodLabel,
        confidence: magical.confidence,
        evidence: {
          ...commonEvidence,
          attack_stat: magical.attackKey,
          attack_total: magical.attack,
          reset: cost.reset ?? null,
        },
      },
    );
  }

  const earring = inferEarring(item, context, stats);
  if (earring) {
    const cost = slotCraftCost({ item, context, candidate: earring, settings: resolvedSettings });
    if (!cost) {
      return unavailable("귀 장식 주문서 또는 복구 주문서 시세 확인 필요", {
        method: earring.method,
        method_label: earring.methodLabel,
        confidence: earring.confidence,
        evidence: commonEvidence,
      });
    }
    return calculated(cost.expectedCost, `${context.applied}작 목표 · 귀지 10% · 보유 주문서 제외`, {
      method: earring.method,
      method_label: earring.methodLabel,
      confidence: earring.confidence,
      evidence: { ...commonEvidence, success_rate: cost.successRate },
    });
  }

  const traces = traceCandidates(item, context, stats);
  if (traces.length === 1) {
    const candidate = traces[0];
    const cost = slotCraftCost({ item, context, candidate, settings: resolvedSettings });
    if (!cost) {
      return unavailable("주문의 흔적 또는 복구 주문서 시세 확인 필요", {
        method: candidate.method,
        method_label: candidate.methodLabel,
        confidence: candidate.confidence,
        evidence: commonEvidence,
      });
    }
    return calculated(
      cost.expectedCost,
      `${context.applied}작 목표 · 피버/손재주/길드 설정 · 보유 주문서 제외`,
      {
        method: candidate.method,
        method_label: candidate.methodLabel,
        confidence: candidate.confidence,
        evidence: {
          ...commonEvidence,
          trace_slot: candidate.slot,
          trace_rate: candidate.rate,
          success_rate: cost.successRate,
          expected_vector: candidate.expectedVector,
        },
      },
    );
  }
  if (traces.length > 1) {
    return unavailable("서로 다른 주문의 흔적 방식이 같은 입력 수치와 일치함", {
      method: "spell_trace_ambiguous",
      method_label: "주흔 확률 판별 불가",
      evidence: {
        ...commonEvidence,
        candidates: traces.map((candidate) => candidate.methodLabel),
      },
    });
  }

  const mixed = mixedChaosFirstCandidates(item, context, stats);
  if (mixed.length === 1) {
    const candidate = mixed[0];
    const cost = mixedChaosFirstCost(item, context, candidate, resolvedSettings);
    if (cost) {
      return calculated(
        cost.expectedCost,
        `놀긍 첫작 후 주흔 ${candidate.rate}% ${candidate.traceWorks}작 · 이후 순백만 사용 · 보유 주문서 제외`,
        {
          method: candidate.method,
          method_label: candidate.methodLabel,
          confidence: candidate.confidence,
          evidence: {
            ...commonEvidence,
            first_scroll_stats: candidate.residual,
            trace_rate: candidate.rate,
            first_target: cost.first.target,
          },
        },
      );
    }
  }
  if (mixed.length > 1) {
    return unavailable("놀긍 첫작 뒤의 주문의 흔적 확률을 하나로 정할 수 없음", {
      method: "chaos_first_trace_ambiguous",
      method_label: "놀긍 첫작 + 주흔 판별 불가",
      evidence: {
        ...commonEvidence,
        candidates: mixed.map((candidate) => candidate.methodLabel),
      },
    });
  }

  const premium = inferPremiumAccessory(item, context, stats);
  if (premium) {
    if (resolvedSettings.premiumAccessoryPrice > 0) {
      return calculated(
        context.applied * resolvedSettings.premiumAccessoryPrice * MAN_MESO,
        "프리미엄 악세서리 100% 주문서 장당 시세 · 결과 +4~+5는 재설정하지 않음",
        {
          method: premium.method,
          method_label: premium.methodLabel,
          confidence: premium.confidence,
          evidence: commonEvidence,
        },
      );
    }
    return unavailable("프리미엄 악세서리 공·마 패턴이지만 주문서 계산기에 장당 시세가 없음", {
      method: premium.method,
      method_label: premium.methodLabel,
      confidence: premium.confidence,
      evidence: commonEvidence,
    });
  }

  if (!isChaosVector(stats, context.applied)) {
    return unavailable("지원하는 주문서 결과 벡터와 일치하지 않음", {
      evidence: commonEvidence,
    });
  }

  if (context.applied === 1) {
    const cost = firstChaosCost(item, stats, resolvedSettings);
    if (!cost) {
      return unavailable("놀긍 1작으로 보이지만 유효 공·마/주스탯 목표 또는 초기화 시세가 없음", {
        method: "chaos_first",
        method_label: "놀긍 첫작",
        confidence: "medium",
        evidence: commonEvidence,
      });
    }
    return calculated(cost.expectedCost, "입력 공·마/주스탯 이상 놀긍 첫작 · 미달 시 초기화 · 보유 주문서 제외", {
      method: "chaos_first",
      method_label: "놀긍 첫작",
      confidence: "medium",
      evidence: { ...commonEvidence, target: cost.target, option_chance: cost.optionChance },
    });
  }

  const targetStats = usefulChaosTarget(item, stats);
  const looksIntentional = targetStats.attack >= 4 * context.applied &&
    targetStats.stat >= 2 * context.applied;
  if (!looksIntentional) {
    return unavailable("최종 수치만으로 일반 놀긍작과 리턴 사용 여부를 구분할 수 없음", {
      method: "chaos_or_return",
      method_label: "놀긍 · 리턴 여부 판별 불가",
      confidence: "low",
      evidence: { ...commonEvidence, useful_target: targetStats },
    });
  }
  try {
    const cost = chaosReturnCost(item, context, stats, resolvedSettings);
    if (!cost) throw new RangeError("유효 목표 또는 리턴 환산 시세가 없음");
    return calculated(
      cost.expectedCost,
      "높은 누적 공·마/주스탯을 모든 작 리턴으로 재현한 추정값 · 보유 주문서 제외",
      {
        method: "chaos_return_inferred",
        method_label: "놀긍리턴 추정",
        confidence: "low",
        evidence: { ...commonEvidence, target: cost.target },
      },
    );
  } catch (error) {
    return unavailable(error?.message || "놀긍리턴 기댓값 계산 불가", {
      method: "chaos_return_inferred",
      method_label: "놀긍리턴 추정",
      confidence: "low",
      evidence: { ...commonEvidence, useful_target: targetStats },
    });
  }
}

/** 잘못된 저장값이나 예상하지 못한 장비 조합도 시세 결과 전체를 막지 않는다. */
export function calculateAutomaticScrollExpectedCost(options = {}) {
  try {
    return calculateAutomaticScrollExpectedCostUnsafe(options);
  } catch (error) {
    const item = itemBody(options.target);
    const normalized = normalizeStats(item?.stats?.scroll);
    const context = upgradeContext(item);
    return unavailable(error?.message || "주문서 제작 기댓값 계산 불가", {
      evidence: deterministicEvidence(context, normalized.stats),
    });
  }
}
