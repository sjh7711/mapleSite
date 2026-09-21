import {
  ADD_OPTION_TABLES_SNAPSHOT,
  calculateArmorAddOption,
  calculateWeaponAddOption,
  calculateWeaponEquivalentAddOption,
  calculateWeaponScoreAddOption,
} from "maple-core/add-option";
import {
  calculatePotentialExpected,
} from "maple-core/potential";
import { calculateIgnoreDefenseEquivalent } from "maple-core/stat-efficiency";
import { element, formatMeso } from "./calculator-ui.js";
import { loadPotentialTables } from "./potential-tables.js";

// 개편된 인게임 장비창은 왼쪽 두 열에 장신구, 오른쪽 두 열에 방어구를
// 세로로 배치하고 무기·보조무기·엠블렘만 최하단 중앙에 둔다. 캐릭터는
// 가운데 3열의 윗부분을 사용한다.
export const CHARACTER_PROFILE_EQUIPMENT_BOARD_SLOTS = Object.freeze([
  ["반지1", 1, 1],
  ["반지2", 2, 1],
  ["반지3", 3, 1],
  ["반지4", 4, 1],
  ["벨트", 5, 1],
  ["포켓아이템", 6, 1],
  ["얼굴장식", 1, 2],
  ["눈장식", 2, 2],
  ["귀고리", 3, 2],
  ["펜던트", 4, 2],
  ["펜던트2", 5, 2],
  ["무기", 6, 3],
  ["보조무기", 6, 4],
  ["엠블렘", 6, 5],
  ["모자", 1, 6],
  ["상의", 2, 6],
  ["하의", 3, 6],
  ["어깨장식", 4, 6],
  ["안드로이드", 5, 6],
  ["망토", 1, 7],
  ["장갑", 2, 7],
  ["신발", 3, 7],
  ["훈장", 4, 7],
  ["기계심장", 5, 7],
  ["뱃지", 6, 7],
].map((slot) => Object.freeze(slot)));
const BOARD_SLOTS = CHARACTER_PROFILE_EQUIPMENT_BOARD_SLOTS;
const BOARD_SLOT_NAMES = new Set(BOARD_SLOTS.map(([slot]) => slot));
const POTENTIAL_GRADE_KEYS = Object.freeze({
  레어: "rare",
  에픽: "epic",
  유니크: "unique",
  레전드리: "legendary",
});
const POTENTIAL_GRADE_BADGES = Object.freeze({
  레어: "R",
  에픽: "E",
  유니크: "U",
  레전드리: "L",
});
const POTENTIAL_GRADE_LABEL_ORDER = Object.freeze([
  "레어",
  "에픽",
  "유니크",
  "레전드리",
]);
const POTENTIAL_PART_BY_NAME = Object.freeze({
  무기: 1,
  엠블렘: 2,
  보조무기: 3,
  포스실드: 4,
  소울링: 4,
  방패: 5,
  모자: 6,
  상의: 7,
  한벌옷: 8,
  하의: 9,
  신발: 10,
  장갑: 11,
  망토: 12,
  벨트: 13,
  어깨장식: 14,
  얼굴장식: 15,
  눈장식: 16,
  귀고리: 17,
  반지: 18,
  펜던트: 19,
  기계심장: 20,
});
const expectationCache = new WeakMap();
const tooltipLineGradeCache = new WeakMap();

function normalizedSlot(value) {
  return typeof value === "string"
    ? value.normalize("NFC").replace(/\s+/gu, "")
    : "";
}

export function getCharacterEquipmentBoardLayout(equipment) {
  const assigned = new Map();
  const availableRings = ["반지1", "반지2", "반지3", "반지4"];
  const availablePendants = ["펜던트", "펜던트2"];
  let reserveSpecialRing = null;
  for (const item of Array.isArray(equipment) ? equipment : []) {
    let key = normalizedSlot(item?.slot);
    if (key === "예비특수반지") {
      reserveSpecialRing ??= item;
      continue;
    }
    if (key === "한벌옷") key = "상의";
    if (!BOARD_SLOT_NAMES.has(key)) key = normalizedSlot(item?.part);
    if (key === "한벌옷") key = "상의";
    if (key === "반지") key = availableRings.find((slot) => !assigned.has(slot));
    if (key === "펜던트") {
      key = availablePendants.find((slot) => !assigned.has(slot));
    }
    if (key && !assigned.has(key)) assigned.set(key, item);
  }
  const equippedSpecialRingSlot = availableRings.find((slot) => {
    const level = Number(assigned.get(slot)?.tooltip?.specialRingLevel);
    return Number.isInteger(level) && level > 0;
  }) ?? null;
  return {
    bySlot: assigned,
    specialRingPair: reserveSpecialRing && equippedSpecialRingSlot
      ? {
          slot: equippedSpecialRingSlot,
          equipped: assigned.get(equippedSpecialRingSlot),
          reserve: reserveSpecialRing,
        }
      : null,
  };
}

function metricNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function getCharacterEquipmentMetric(item, mode) {
  const regular = metricNumber(item?.potentialMainStatPercent);
  const additional = metricNumber(item?.additionalMainStatPercent);
  if (mode === "regular") {
    return Number.isFinite(regular)
      ? { value: regular, unit: "%급", shortUnit: "급", label: "윗잠" }
      : null;
  }
  if (mode === "additional") {
    return Number.isFinite(additional)
      ? { value: additional, unit: "%급", shortUnit: "급", label: "에디" }
      : null;
  }
  if (mode === "combined") {
    if (!Number.isFinite(regular) && !Number.isFinite(additional)) return null;
    return {
      value: (Number.isFinite(regular) ? regular : 0) +
        (Number.isFinite(additional) ? additional : 0),
      unit: "%급",
      shortUnit: "급",
      label: "통합",
    };
  }
  const addOption = metricNumber(item?.addOptionScore);
  return Number.isFinite(addOption)
    ? {
        value: addOption,
        unit: item?.addOptionUnit === "점" ? "점" : "급",
        shortUnit: item?.addOptionUnit === "점" ? "점" : "급",
        label: "추옵",
      }
    : null;
}

function formattedMetric(metric, compact = false) {
  const value = Number(metric.value).toLocaleString("ko-KR", {
    minimumFractionDigits: metric.unit === "%급" ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `${value}${metric.unit === "%급" ? "% " : ""}${
    compact ? metric.shortUnit : metric.unit
  }`;
}

function metricValue(value) {
  const number = metricNumber(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function percent(value) {
  return Number(value).toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

/** 실제 표시 폭에 들어가는 마지막 문자까지 보존하고 말줄임은 두 점만 쓴다. */
export function fitCharacterEquipmentQuickValue(node) {
  const fullValue = node?.dataset?.fullValue ?? "";
  node.textContent = fullValue;
  delete node.dataset.truncated;
  if (!fullValue || node.clientWidth <= 0 || node.scrollWidth <= node.clientWidth) {
    return fullValue;
  }

  const suffix = "..";
  const characters = Array.from(fullValue);
  const prefixAt = (length) => characters
    .slice(0, length)
    .join("")
    .trimEnd()
    .replace(/\.+$/u, "");
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    node.textContent = `${prefixAt(middle)}${suffix}`;
    if (node.scrollWidth <= node.clientWidth) low = middle;
    else high = middle - 1;
  }
  const fitted = `${prefixAt(low)}${suffix}`;
  node.textContent = fitted;
  node.dataset.truncated = "true";
  return fitted;
}

function potentialSummaryOf(item, kind) {
  const summary = kind === "upper"
    ? item?.potentialSummary
    : item?.additionalPotentialSummary;
  const legacy = kind === "upper"
    ? item?.potentialMainStatPercent
    : item?.additionalMainStatPercent;
  return summary && typeof summary === "object"
    ? summary
    : {
        statEquivalentPercent: metricNumber(legacy),
        statEquivalentType: "main-stat",
        bossDamagePercent: null,
        damagePercent: null,
        attackMagicPercent: null,
        ignoreDefensePercent: null,
        cooldownSeconds: null,
        criticalDamagePercent: null,
      };
}

function potentialStatType(summary, profile = null) {
  if (["main-stat", "xenon-all-stat", "hp"].includes(
    summary?.statEquivalentType,
  )) {
    return summary.statEquivalentType;
  }
  if (profile?.statModel === "xenon") return "xenon-all-stat";
  if (profile?.statModel === "demon-avenger") return "hp";
  return "main-stat";
}

function displayedPotentialStat(stat, summary, profile) {
  if (stat === null) return null;
  if (potentialStatType(summary, profile) !== "xenon-all-stat") return stat;
  const allStatToStrPercent = Number(
    profile?.statEquivalence?.allStatPercentToMainPercent,
  );
  return Number.isFinite(allStatToStrPercent) && allStatToStrPercent > 0
    ? stat / allStatToStrPercent
    : stat;
}

function detailedStatEquivalent(stat, summary, profile, label) {
  if (stat === null) return null;
  const statType = potentialStatType(summary, profile);
  if (statType === "hp") {
    return `${label} HP +${percent(stat)}%`;
  }
  if (statType === "xenon-all-stat") {
    return `${label} 올스탯 ${displayedPotentialStat(
      stat,
      summary,
      profile,
    ).toFixed(2)}% 급`;
  }
  return `${label} ${stat.toFixed(2)}% 급`;
}

function potentialDetails(item, kind, profile = null) {
  const label = kind === "upper" ? "윗잠" : "아랫잠";
  const summary = potentialSummaryOf(item, kind);
  const details = [];
  const stat = metricValue(summary?.statEquivalentPercent);
  const boss = metricValue(summary?.bossDamagePercent);
  const damage = metricValue(summary?.damagePercent);
  const attack = metricValue(summary?.attackMagicPercent);
  const ignoreDefense = metricValue(summary?.ignoreDefensePercent);
  const cooldown = metricValue(summary?.cooldownSeconds);
  const criticalDamage = metricValue(summary?.criticalDamagePercent);
  const compactOffensive = isOffensivePotentialItem(item);
  const attackLabel = profile?.attackType === "magic"
    ? "마"
    : profile?.attackType === "attack"
      ? "공"
      : "공/마";
  const statDetail = detailedStatEquivalent(stat, summary, profile, label);
  const offensiveDetails = [
    attack !== null ? `${label} ${attackLabel}${percent(attack)}%` : null,
    boss !== null ? `${label} 보공${percent(boss)}%` : null,
    ignoreDefense !== null
      ? `${label} 방무${percent(ignoreDefense)}%`
      : null,
    damage !== null ? `${label} 뎀${percent(damage)}%` : null,
  ].filter(Boolean);
  const standardDetails = [
    boss !== null ? `${label} 보공 +${percent(boss)}%` : null,
    damage !== null ? `${label} 데미지 +${percent(damage)}%` : null,
    attack !== null ? `${label} 공/마 +${percent(attack)}%` : null,
    ignoreDefense !== null
      ? `${label} 방무 +${percent(ignoreDefense)}%`
      : null,
  ].filter(Boolean);
  const specialDetails = [
    criticalDamage !== null
      ? `${label} 크뎀${compactOffensive ? "" : " +"}${percent(criticalDamage)}%`
      : null,
    cooldown !== null
      ? `${label} 재사용${compactOffensive ? "" : " +"}${percent(cooldown)}초`
      : null,
  ].filter(Boolean);
  if (compactOffensive) {
    details.push(...offensiveDetails);
    details.push(...specialDetails);
    if (statDetail) details.push(statDetail);
  } else {
    details.push(...specialDetails);
    if (statDetail) details.push(statDetail);
    details.push(...standardDetails);
  }
  return details;
}

function isWeaponItem(item) {
  return [item?.part, item?.slot]
    .map(normalizedSlot)
    .includes("무기");
}

function isGloveItem(item) {
  return [item?.part, item?.slot]
    .map((value) => normalizedSlot(value).replace(/[1-4]$/u, ""))
    .includes("장갑");
}

function isOffensivePotentialItem(item) {
  return [item?.part, item?.slot]
    .map((value) => normalizedSlot(value).replace(/[1-4]$/u, ""))
    .some((value) => [
      "무기",
      "보조무기",
      "엠블렘",
      "포스실드",
      "소울링",
      "방패",
    ].includes(value));
}

function weaponAddOptionDetail(item) {
  if (!isWeaponItem(item)) return null;
  const tier = metricNumber(item?.weaponFlameTier);
  const equivalent = metricNumber(item?.weaponAddOptionPercent);
  const formattedEquivalent = Number.isFinite(equivalent)
    ? item?.addOptionUnit === "점"
      ? `${percent(equivalent)}점`
      : `${equivalent.toFixed(2)}% 급`
    : null;
  if (Number.isInteger(tier) && tier >= 1 && tier <= 5) {
    return `${tier}추${formattedEquivalent ? ` ${formattedEquivalent}` : ""}`;
  }
  return formattedEquivalent;
}

export function getCharacterEquipmentQuickValue(item, kind, profile = null) {
  const summary = potentialSummaryOf(item, kind);
  const boss = metricValue(summary?.bossDamagePercent);
  const damage = metricValue(summary?.damagePercent);
  const attack = metricValue(summary?.attackMagicPercent);
  const ignoreDefense = metricValue(summary?.ignoreDefensePercent);
  const stat = displayedPotentialStat(
    metricValue(summary?.statEquivalentPercent),
    summary,
    profile,
  );
  const criticalDamage = metricValue(summary?.criticalDamagePercent);
  const cooldown = metricValue(summary?.cooldownSeconds);
  const attackLabel = profile?.attackType === "magic"
    ? "마"
    : profile?.attackType === "attack"
      ? "공"
      : "공/마";
  if (isOffensivePotentialItem(item)) {
    return [
      attack !== null ? `${attackLabel}${percent(attack)}%` : null,
      boss !== null ? `보공${percent(boss)}%` : null,
      ignoreDefense !== null ? `방무${percent(ignoreDefense)}%` : null,
      damage !== null ? `뎀${percent(damage)}%` : null,
      criticalDamage !== null ? `크뎀${percent(criticalDamage)}%` : null,
      cooldown !== null ? `재사용${percent(cooldown)}초` : null,
      stat !== null
        ? potentialStatType(summary, profile) === "hp"
          ? `HP${percent(stat)}%`
          : `${stat.toFixed(2)}% 급`
        : null,
    ].filter(Boolean).join(" + ") || null;
  } else {
    const statValue = stat !== null
      ? potentialStatType(summary, profile) === "hp"
        ? `HP${percent(stat)}%`
        : `${stat.toFixed(2)}%`
      : null;
    if (criticalDamage !== null) {
      return [`크${percent(criticalDamage)}%`, statValue]
        .filter(Boolean)
        .join(" + ");
    }
    if (cooldown !== null) {
      return [`${percent(cooldown)}초`, statValue]
        .filter(Boolean)
        .join(" + ");
    }
    if (stat !== null) return statValue;
  }
  return null;
}

function potentialPart(item) {
  for (const value of [item?.part, item?.slot]) {
    const normalized = normalizedSlot(value).replace(/[1-4]$/u, "");
    if (POTENTIAL_PART_BY_NAME[normalized]) {
      return POTENTIAL_PART_BY_NAME[normalized];
    }
  }
  return null;
}

function normalizedPotentialLineName(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/\s+/gu, "")
    .replace("보스몬스터공격시데미지", "보스몬스터데미지");
}

function lowerPotentialGradeLabel(gradeLabel) {
  const index = POTENTIAL_GRADE_LABEL_ORDER.indexOf(gradeLabel);
  return index > 0 ? POTENTIAL_GRADE_LABEL_ORDER[index - 1] : gradeLabel;
}

async function resolvePotentialLineGradesForKind(
  item,
  kind,
  loadTables,
) {
  const system = kind === "potential" ? "regular" : "additional";
  const gradeLabel = kind === "potential"
    ? item?.potentialGrade
    : item?.additionalPotentialGrade;
  const lines = tooltipStrings(
    kind === "potential"
      ? item?.tooltip?.potentialLines
      : item?.tooltip?.additionalPotentialLines,
  );
  if (!lines.length || !gradeLabel) return [];
  if (gradeLabel === "레어") return lines.map(() => gradeLabel);

  const grade = POTENTIAL_GRADE_KEYS[gradeLabel];
  const part = potentialPart(item);
  const itemLevel = metricNumber(item?.itemLevel);
  // 현재 표에서 사라진 구형 옵션은 줄 등급을 역추적할 수 없다. 이 경우에는
  // 중립색으로 바꾸기보다 API가 보장하는 장비 잠재 등급색을 유지한다.
  const unresolved = lines.map(() => gradeLabel);
  if (!grade || !part || !Number.isInteger(itemLevel) || itemLevel < 0) {
    return unresolved;
  }

  try {
    const tables = await loadTables({ system, grade, part, itemLevel });
    if (!Array.isArray(tables) || !Array.isArray(tables[0])) return unresolved;
    const sameGradeOptions = new Set(
      tables[0].map(({ name }) => normalizedPotentialLineName(name)),
    );
    const lowerGradeLabel = lowerPotentialGradeLabel(gradeLabel);
    return lines.map((line, index) => {
      if (index === 0) return gradeLabel;
      const normalized = normalizedPotentialLineName(line);
      if (sameGradeOptions.has(normalized)) return gradeLabel;
      const lineOptions = new Set(
        (Array.isArray(tables[index]) ? tables[index] : [])
          .map(({ name }) => normalizedPotentialLineName(name)),
      );
      return lineOptions.has(normalized) ? lowerGradeLabel : gradeLabel;
    });
  } catch {
    return unresolved;
  }
}

/** 공식 확률표의 같은 등급 풀과 대조해 2·3번째 줄의 실제 등급을 구한다. */
export function resolveCharacterEquipmentPotentialLineGrades(
  item,
  { loadTables = loadPotentialTables } = {},
) {
  const useCache = loadTables === loadPotentialTables &&
    item && typeof item === "object";
  if (useCache && tooltipLineGradeCache.has(item)) {
    return tooltipLineGradeCache.get(item);
  }
  const promise = Promise.all([
    resolvePotentialLineGradesForKind(item, "potential", loadTables),
    resolvePotentialLineGradesForKind(item, "additionalPotential", loadTables),
  ]).then(([potential, additionalPotential]) => ({
    potential,
    additionalPotential,
  }));
  if (useCache) tooltipLineGradeCache.set(item, promise);
  return promise;
}

function expectationResult(
  status,
  expectedMeso = null,
  targetEquivalentPercent = null,
) {
  return { status, expectedMeso, targetEquivalentPercent };
}

function potentialEquivalentTarget(summary, profile) {
  const stat = metricValue(summary?.statEquivalentPercent) ?? 0;
  const attack = metricValue(summary?.attackMagicPercent) ?? 0;
  const boss = metricValue(summary?.bossDamagePercent) ?? 0;
  const damage = metricValue(summary?.damagePercent) ?? 0;
  const ignoreDefense = metricValue(summary?.ignoreDefensePercent) ?? 0;
  const criticalDamage = metricValue(summary?.criticalDamagePercent) ?? 0;
  const cooldown = metricValue(summary?.cooldownSeconds) ?? 0;
  if (profile?.statModel === "demon-avenger") {
    const conditions = [
      stat > 0 ? { targetType: "hp-percent", target: stat } : null,
      attack > 0
        ? { targetType: "attack-power-percent", target: attack }
        : null,
      boss > 0 ? { targetType: "boss-damage", target: boss } : null,
      damage > 0 ? { targetType: "damage", target: damage } : null,
      ignoreDefense > 0
        ? { targetType: "ignore-defense", target: ignoreDefense }
        : null,
      criticalDamage > 0
        ? { targetType: "critical-damage", target: criticalDamage }
        : null,
      cooldown > 0 ? { targetType: "cooldown", target: cooldown } : null,
    ].filter(Boolean);
    return conditions.length ? { conditions, equivalent: stat || null } : null;
  }
  const hasBossOption = attack > 0 || boss > 0 || damage > 0 ||
    ignoreDefense > 0;
  const equivalence = profile?.statEquivalence;
  const criticalDamageCoefficient = Number(
    equivalence?.criticalDamageToMainPercent,
  );
  if (
    criticalDamage > 0 &&
    (!Number.isFinite(criticalDamageCoefficient) ||
      criticalDamageCoefficient <= 0)
  ) {
    return { unavailable: true };
  }
  let target = stat + criticalDamage * (criticalDamageCoefficient || 0);
  const conditions = [];
  if (!hasBossOption) {
    if (target > 0) {
      conditions.push({ targetType: "stat-equivalent", target });
    }
    if (cooldown > 0) {
      conditions.push({ targetType: "cooldown", target: cooldown });
    }
    return conditions.length ? { conditions, equivalent: target || null } : null;
  }
  const attackCoefficient = Number(equivalence?.attackPercentToMainPercent);
  const bossCoefficient = Number(equivalence?.bossDamageToMainPercent);
  if (
    !Number.isFinite(attackCoefficient) || attackCoefficient <= 0 ||
    !Number.isFinite(bossCoefficient) || bossCoefficient <= 0
  ) {
    return { unavailable: true };
  }
  target += attack * attackCoefficient + (boss + damage) * bossCoefficient;
  if (ignoreDefense > 0) {
    const ignoreDefenseEquivalent = calculateIgnoreDefenseEquivalent({
      currentIgnoreDefense: Number(equivalence?.currentIgnoreDefense),
      addedIgnoreDefense: ignoreDefense / 100,
      enemyDefense:
        3.8 * Number(equivalence?.targetDefenseRemaining ?? 1),
      oneMainPercentRelative: Number(equivalence?.oneMainPercentRelative),
    });
    if (!Number.isFinite(ignoreDefenseEquivalent)) {
      return { unavailable: true };
    }
    target += ignoreDefenseEquivalent;
  }
  if (target > 0) {
    conditions.push({ targetType: "boss-stat-equivalent", target });
  }
  if (cooldown > 0) {
    conditions.push({ targetType: "cooldown", target: cooldown });
  }
  return conditions.length ? { conditions, equivalent: target || null } : null;
}

async function potentialExpectedCost(item, profile, kind, loadTables) {
  const system = kind === "upper" ? "regular" : "additional";
  const summary = potentialSummaryOf(item, kind);
  const target = potentialEquivalentTarget(summary, profile);
  if (target?.unavailable) return expectationResult("unavailable");
  if (!target) return expectationResult("not_applicable");
  const gradeLabel = kind === "upper"
    ? item?.potentialGrade
    : item?.additionalPotentialGrade;
  const grade = POTENTIAL_GRADE_KEYS[gradeLabel];
  const part = potentialPart(item);
  const itemLevel = metricNumber(item?.itemLevel);
  if (!grade || !part || !Number.isInteger(itemLevel) || itemLevel < 0) {
    return expectationResult("unavailable");
  }
  try {
    const tables = await loadTables({ system, grade, part, itemLevel });
    if (!Array.isArray(tables) || !tables.length) {
      return expectationResult("unavailable");
    }
    const result = calculatePotentialExpected({
      tables,
      system,
      grade,
      resetMethod: "meso",
      itemLevel,
      targetSets: [target.conditions],
      mainStat: profile?.mainStat,
      subStat: profile?.subStat,
      subStats: profile?.subStats,
      attackType: profile?.attackType,
      characterLevel: profile?.character?.level,
      statEquivalence: profile?.statEquivalence,
      enemyDefense: 380,
    });
    return Number.isFinite(result.expectedCost) && result.expectedCost >= 0
      ? expectationResult("calculated", result.expectedCost, target.equivalent)
      : expectationResult("unavailable");
  } catch {
    return expectationResult("unavailable");
  }
}

function flameExpectedCost(item, profile, tables) {
  const itemLevel = metricNumber(item?.itemLevel);
  const target = metricValue(item?.addOptionScore);
  const tier = metricNumber(item?.weaponFlameTier);
  const baseAttack = metricNumber(item?.weaponBaseAttack);
  const boss = item?.flameAdvantaged;
  const weapon = isWeaponItem(item);
  if (target === null && !(weapon && Number.isInteger(tier))) {
    return expectationResult("not_applicable");
  }
  if (!Number.isInteger(itemLevel) || itemLevel < 0 || typeof boss !== "boolean") {
    return expectationResult("unavailable");
  }
  try {
    const common = {
      tables,
      itemLevel,
      boss,
      mainStat: profile?.mainStat,
      subStat: profile?.subStat,
      attackType: profile?.attackType,
      statEquivalence: profile?.statEquivalence,
      addOptionEquivalence: profile?.addOptionEquivalence,
      targetToDamagePercent: profile?.addOptionEquivalence?.targetToDamagePercent,
    };
    const result = weapon
      ? Number.isFinite(baseAttack) && baseAttack > 0 && Number.isInteger(tier)
        ? calculateWeaponEquivalentAddOption({
            ...common,
            tier,
            baseAttack,
            damagePercent: Math.max(0, metricNumber(item?.weaponAddOptionPercent) ?? 0),
          })
        : Number.isInteger(tier)
          ? calculateWeaponAddOption({
              ...common,
              tier,
              damagePercent: Math.max(0, metricNumber(item?.weaponAddOptionPercent) ?? 0),
            })
          : calculateWeaponScoreAddOption({
            ...common,
            target,
          })
      : calculateArmorAddOption({ ...common, target });
    const black = result.sources?.find(({ key }) => key === "black");
    return Number.isFinite(black?.expectedMeso) && black.expectedMeso >= 0
      ? expectationResult("calculated", black.expectedMeso)
      : expectationResult("unavailable");
  } catch {
    return expectationResult("unavailable");
  }
}

export async function calculateCharacterEquipmentExpectations(
  item,
  profile,
  {
    loadTables = loadPotentialTables,
    addOptionTables = ADD_OPTION_TABLES_SNAPSHOT,
  } = {},
) {
  const useCache = loadTables === loadPotentialTables &&
    addOptionTables === ADD_OPTION_TABLES_SNAPSHOT &&
    item && typeof item === "object" && profile && typeof profile === "object";
  if (useCache) {
    let byProfile = expectationCache.get(item);
    if (!byProfile) {
      byProfile = new WeakMap();
      expectationCache.set(item, byProfile);
    }
    if (byProfile.has(profile)) return byProfile.get(profile);
    const pending = calculateCharacterEquipmentExpectations(item, profile, {
      loadTables,
      addOptionTables: { ...addOptionTables },
    });
    byProfile.set(profile, pending);
    return pending;
  }
  const [upper, lower] = await Promise.all([
    potentialExpectedCost(item, profile, "upper", loadTables),
    potentialExpectedCost(item, profile, "lower", loadTables),
  ]);
  return {
    upper,
    lower,
    flame: flameExpectedCost(item, profile, addOptionTables),
  };
}

export function getCharacterEquipmentDetailValues(item, profile = null) {
  const weaponAddOption = weaponAddOptionDetail(item);
  const details = [
    ...potentialDetails(item, "upper", profile),
    ...potentialDetails(item, "lower", profile),
  ];
  const addOption = getCharacterEquipmentMetric(item, "flame");
  if (weaponAddOption) {
    details.push(`추옵 ${weaponAddOption}`);
  } else if (addOption && metricValue(addOption.value) !== null) {
    details.push(`추옵 ${formattedMetric(addOption)}`);
  }
  return details;
}

function expectationText(expectation, label) {
  if (!expectation) return "";
  if (expectation.status === "loading") return `${label} 계산 중…`;
  if (expectation.status === "calculated") {
    return `${label} ${formatMeso(expectation.expectedMeso)}`;
  }
  if (expectation.status === "unavailable") return `${label} 산출 불가`;
  return "";
}

function potentialTotalDetails(item, expectations, profile = null) {
  if (!expectations) return null;
  if (expectations.loading) {
    return {
      spec: "환산값 계산 중…",
      expectation: "메소 재설정 기댓값 계산 중…",
    };
  }
  const applicable = [expectations.upper, expectations.lower]
    .filter((value) => value?.status !== "not_applicable");
  if (!applicable.length) {
    return { spec: "표시할 유효 환산값 없음", expectation: "" };
  }
  const fallbackEquivalent = ["upper", "lower"].reduce((sum, kind) =>
    sum + (metricValue(potentialSummaryOf(item, kind)?.statEquivalentPercent) ?? 0),
  0);
  const calculatedEquivalent = applicable.reduce(
    (sum, value) => sum + Number(value.targetEquivalentPercent ?? 0),
    0,
  );
  const equivalent = calculatedEquivalent > 0
    ? calculatedEquivalent
    : fallbackEquivalent;
  const cooldown = ["upper", "lower"].reduce((sum, kind) =>
    sum + (metricValue(potentialSummaryOf(item, kind)?.cooldownSeconds) ?? 0),
  0);
  const criticalDamage = ["upper", "lower"].reduce((sum, kind) =>
    sum + (
      metricValue(potentialSummaryOf(item, kind)?.criticalDamagePercent) ?? 0
    ),
  0);
  const specParts = [];
  // 장갑의 합계 %급에는 크리티컬 데미지의 환산 가치가 이미 포함된다.
  // 같은 값을 별도 문구로 한 번 더 보여주지 않고 개별 윗잠·아랫잠에서만
  // 실제 크뎀 수치를 확인할 수 있게 한다.
  if (criticalDamage > 0 && !isGloveItem(item)) {
    specParts.push(`크뎀 +${percent(criticalDamage)}%`);
  }
  if (cooldown > 0) specParts.push(`재사용 +${percent(cooldown)}초`);
  if (equivalent > 0) {
    const summary = potentialSummaryOf(item, "upper") ??
      potentialSummaryOf(item, "lower");
    const statType = potentialStatType(summary, profile);
    const displayedEquivalent = displayedPotentialStat(
      equivalent,
      summary,
      profile,
    );
    specParts.push(
      statType === "hp"
        ? `HP +${percent(equivalent)}%`
        : statType === "xenon-all-stat"
          ? `올스탯 ${displayedEquivalent.toFixed(2)}% 급`
          : `${equivalent.toFixed(2)}% 급`,
    );
  }
  const spec = specParts.join(" · ") || "환산값 산출 불가";
  if (applicable.some((value) => value?.status !== "calculated")) {
    return { spec, expectation: "메소 재설정 기댓값 산출 불가" };
  }
  const total = applicable.reduce(
    (sum, value) => sum + Number(value.expectedMeso),
    0,
  );
  return {
    spec,
    expectation: `메소 재설정 기댓값 ${formatMeso(total)}`,
  };
}

export function getCharacterEquipmentDetailRows(
  item,
  expectations = null,
  profile = null,
) {
  const valueWithoutLabel = (value, label) =>
    value.replace(new RegExp(`^${label}\\s*`, "u"), "");
  const upper = potentialDetails(item, "upper", profile)
    .map((value) => valueWithoutLabel(value, "윗잠"));
  const lower = potentialDetails(item, "lower", profile)
    .map((value) => valueWithoutLabel(value, "아랫잠"));
  const weaponAddOption = weaponAddOptionDetail(item);
  const addOption = getCharacterEquipmentMetric(item, "flame");
  const flame = weaponAddOption ?? (
    addOption && metricValue(addOption.value) !== null
      ? formattedMetric(addOption)
      : null
  );
  const separator = isOffensivePotentialItem(item) ? " + " : " · ";
  const upperValue = upper.join(separator) || "표시할 유효 환산값 없음";
  const lowerValue = lower.join(separator) || "표시할 유효 환산값 없음";
  const loading = expectations?.loading
    ? { status: "loading" }
    : null;
  const row = (key, label, spec, expectation = "") => {
    const output = {
      key,
      label,
      value: [spec, expectation].filter(Boolean).join(" · "),
    };
    if (expectations) Object.assign(output, { spec, expectation });
    return output;
  };
  const total = potentialTotalDetails(item, expectations, profile);
  return [
    row(
      "upper",
      "윗잠",
      upperValue,
      expectationText(
        expectations?.upper ?? (upper.length ? loading : null),
        "메소 재설정 기댓값",
      ),
    ),
    row(
      "lower",
      "아랫잠",
      lowerValue,
      expectationText(
        expectations?.lower ?? (lower.length ? loading : null),
        "메소 재설정 기댓값",
      ),
    ),
    ...(total ? [row(
      "potential-total",
      "잠재 합계",
      total.spec,
      total.expectation,
    )] : []),
    row(
      "flame",
      "추옵",
      flame || "표시할 유효 환산값 없음",
      expectationText(
        expectations?.flame ?? (flame ? loading : null),
        "검환불(메소) 기댓값",
      ),
    ),
  ];
}

function equipmentDetailPanel(item, profile) {
  const panel = element("div", "profile-equipment__detail");
  panel.setAttribute("aria-live", "polite");
  let revision = 0;
  const draw = (selected, expectations) => {
    const rows = getCharacterEquipmentDetailRows(
      selected,
      expectations,
      profile,
    );
    const valueList = element("div", "profile-equipment__detail-values");
    valueList.append(
      ...rows.map(({ key, label, spec, expectation }) => {
        const row = element("div", "profile-equipment__detail-row");
        row.dataset.kind = key;
        row.append(
          element("strong", "", label),
          element("span", "profile-equipment__detail-spec", spec),
          element(
            "span",
            "profile-equipment__detail-expectation",
            expectation,
          ),
        );
        return row;
      }),
    );
    panel.replaceChildren(
      element("strong", "", selected?.name ?? "장비를 선택해 주세요"),
      valueList,
    );
  };
  const render = (selected) => {
    const current = ++revision;
    draw(selected, { loading: true });
    calculateCharacterEquipmentExpectations(selected, profile).then(
      (expectations) => {
        if (current === revision) draw(selected, expectations);
      },
      () => {
        if (current === revision) {
          draw(selected, {
            upper: expectationResult("unavailable"),
            lower: expectationResult("unavailable"),
            flame: expectationResult("unavailable"),
          });
        }
      },
    );
  };
  render(item);
  return { panel, render };
}

function tooltipNumber(value) {
  const number = metricNumber(value);
  return Number.isFinite(number) ? number : null;
}

function tooltipInteger(value) {
  const number = tooltipNumber(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function tooltipPositiveInteger(value) {
  const number = tooltipInteger(value);
  return number !== null && number > 0 ? number : null;
}

function tooltipStrings(values) {
  return Array.isArray(values)
    ? values.filter((value) => typeof value === "string" && value.trim())
      .map((value) => value.trim())
      .slice(0, 3)
    : [];
}

const HIDDEN_TOOLTIP_DESCRIPTION_PATTERNS = Object.freeze([
  /일부 상황에서는 보이지 않는 아이템/u,
  /NPC\s*\/\s*채집\s*키/u,
  /플래티넘 카르마/u,
  /현재 장착\s*중인 장비/u,
  /전투력 증가량/u,
]);

function tooltipDescription(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const visible = value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !HIDDEN_TOOLTIP_DESCRIPTION_PATTERNS.some(
      (pattern) => pattern.test(line),
    ));
  return visible.length ? visible.join("\n") : null;
}

const TOOLTIP_OPTION_DISPLAY_ORDER = new Map([
  "str",
  "dex",
  "int",
  "luk",
  "all_stat",
  "max_hp",
  "max_hp_rate",
  "max_mp",
  "max_mp_rate",
  "attack_power",
  "magic_power",
  "damage",
  "armor",
  "speed",
  "jump",
  "boss_damage",
  "ignore_monster_armor",
  "equipment_level_decrease",
].map((key, index) => [key, index]));

const ACCESSORY_PARTS = new Set([
  "반지",
  "펜던트",
  "벨트",
  "얼굴장식",
  "눈장식",
  "귀고리",
  "어깨장식",
  "포켓아이템",
  "뱃지",
]);
const ARMOR_PARTS = new Set([
  "모자",
  "상의",
  "한벌옷",
  "하의",
  "장갑",
  "신발",
  "망토",
]);

function tooltipEquipmentCategory(part) {
  if (ACCESSORY_PARTS.has(part)) return "장신구";
  if (ARMOR_PARTS.has(part)) return "방어구";
  if (["무기", "보조무기", "엠블렘"].includes(part)) return "무기";
  return null;
}

function tooltipOptionRows(values) {
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    if (!value || typeof value !== "object" || typeof value.label !== "string") {
      return [];
    }
    const row = {
      key: typeof value.key === "string" ? value.key : "",
      label: value.label.trim(),
      unit: value.unit === "%" ? "%" : "",
      total: tooltipNumber(value.total),
      base: tooltipNumber(value.base),
      add: tooltipNumber(value.add),
      etc: tooltipNumber(value.etc),
      starforce: tooltipNumber(value.starforce),
      exceptional: tooltipNumber(value.exceptional),
    };
    return row.label && Object.values(row).some((entry) =>
      typeof entry === "number" && entry !== 0
    ) ? [row] : [];
  }).slice(0, 24).sort((left, right) =>
    (TOOLTIP_OPTION_DISPLAY_ORDER.get(left.key) ?? Number.MAX_SAFE_INTEGER) -
    (TOOLTIP_OPTION_DISPLAY_ORDER.get(right.key) ?? Number.MAX_SAFE_INTEGER)
  );
}

function visibleTooltipOptionRows(options) {
  return options.filter((option) =>
    [option.total, option.base, option.add, option.etc, option.starforce]
      .some((value) => Number.isFinite(value) && value !== 0)
  );
}

function groupedExceptionalLines(options) {
  const remaining = new Map(
    options
      .filter((option) => option.exceptional !== null && option.exceptional !== 0)
      .map((option) => [option.key, option]),
  );
  const lines = [];
  const takeEqualGroup = (keys, label) => {
    const group = keys.map((key) => remaining.get(key));
    if (
      group.some((option) => !option) ||
      !group.every((option) =>
        option.exceptional === group[0].exceptional &&
        option.unit === group[0].unit
      )
    ) {
      return;
    }
    lines.push(
      `${label} ${signedTooltipValue(group[0].exceptional, group[0].unit)}`,
    );
    keys.forEach((key) => remaining.delete(key));
  };

  takeEqualGroup(["str", "dex", "int", "luk"], "올스탯");
  takeEqualGroup(["max_hp", "max_mp"], "최대 HP / 최대 MP");
  takeEqualGroup(["max_hp_rate", "max_mp_rate"], "최대 HP / 최대 MP");
  takeEqualGroup(["attack_power", "magic_power"], "공격력 / 마력");
  lines.push(...Array.from(remaining.values(), (option) =>
    `${option.label} ${signedTooltipValue(option.exceptional, option.unit)}`
  ));
  return lines;
}

function tooltipExceptionalModel(raw, options) {
  const source = raw.exceptional && typeof raw.exceptional === "object"
    ? raw.exceptional
    : null;
  const sourceLines = Array.isArray(source?.lines)
    ? source.lines
      .filter((line) => typeof line === "string" && line.trim())
      .map((line) => line.trim())
      .slice(0, 24)
    : [];
  const upgraded = tooltipInteger(
    source?.upgraded ?? raw.exceptionalUpgrade ?? raw.exceptionalUpgradeCount,
  );
  const explicitMaximum = tooltipPositiveInteger(
    source?.maximum ?? source?.max ?? raw.exceptionalUpgradeMaximum,
  );
  const lines = sourceLines.length
    ? sourceLines
    : groupedExceptionalLines(options);
  return {
    upgraded,
    maximum: explicitMaximum,
    lines,
  };
}

/**
 * 서버가 공개한 NEXON 장비 원본 필드만 툴팁 모델로 정규화한다. 구버전
 * 저장본에는 실제 옵션 줄이 없으므로 계산된 환산값으로 추측해 채우지 않는다.
 */
export function getCharacterEquipmentTooltipModel(item, lineGrades = null) {
  const rawAvailable = Boolean(
    item?.tooltip && typeof item.tooltip === "object",
  );
  const raw = rawAvailable ? item.tooltip : {};
  const scrollSource = raw.scroll && typeof raw.scroll === "object"
    ? raw.scroll
    : null;
  const scroll = scrollSource
    ? {
        upgraded: tooltipInteger(scrollSource.upgraded),
        upgradeable: tooltipInteger(scrollSource.upgradeable),
        recoverable: tooltipInteger(scrollSource.recoverable),
        goldenHammerApplied: typeof scrollSource.goldenHammerApplied === "boolean"
          ? scrollSource.goldenHammerApplied
          : null,
      }
    : null;
  const rawUpper = tooltipStrings(raw.potentialLines);
  const rawLower = tooltipStrings(raw.additionalPotentialLines);
  const sourceOptions = tooltipOptionRows(raw.options);
  const options = visibleTooltipOptionRows(sourceOptions);
  const itemLevel = tooltipInteger(item?.itemLevel);
  const part = typeof item?.part === "string" ? item.part.trim() : "";
  const slot = typeof item?.slot === "string" ? item.slot.trim() : "";
  const metadata = [
    part ? { label: "착용 부위", value: part } : null,
    itemLevel !== null ? { label: "요구 레벨", value: `Lv. ${itemLevel}` } : null,
    slot && slot !== part ? { label: "장착 위치", value: slot } : null,
    typeof raw.gender === "string" && raw.gender.trim()
      ? { label: "성별", value: raw.gender.trim() }
      : null,
    tooltipPositiveInteger(raw.specialRingLevel) !== null
      ? {
          label: "반지 레벨",
          value: `Lv. ${tooltipPositiveInteger(raw.specialRingLevel)}`,
        }
      : null,
    tooltipPositiveInteger(raw.growthLevel) !== null
      ? { label: "성장", value: `Lv. ${tooltipPositiveInteger(raw.growthLevel)}` }
      : null,
    tooltipPositiveInteger(raw.equipmentLevelIncrease) !== null
      ? {
          label: "장비 레벨",
          value: `+${tooltipPositiveInteger(raw.equipmentLevelIncrease)}`,
        }
      : null,
  ].filter(Boolean);
  const category = tooltipEquipmentCategory(part);
  const tags = [category, part].filter((value, index, values) =>
    value && values.indexOf(value) === index
  );
  const upgraded = scroll?.upgraded;
  return {
    name: typeof item?.name === "string" && item.name.trim()
      ? `${item.name.trim()}${upgraded ? ` (+${upgraded})` : ""}`
      : "장비",
    icon: typeof item?.icon === "string" ? item.icon : null,
    grade: typeof item?.potentialGrade === "string"
      ? item.potentialGrade
      : null,
    stars: tooltipInteger(raw.starforce),
    description: tooltipDescription(raw.description),
    rawAvailable,
    metadata,
    tags,
    options,
    potential: {
      grade: typeof item?.potentialGrade === "string"
        ? item.potentialGrade
        : null,
      lines: rawUpper,
      lineGrades: Array.isArray(lineGrades?.potential)
        ? lineGrades.potential
        : rawUpper.map(() => item?.potentialGrade),
    },
    additionalPotential: {
      grade: typeof item?.additionalPotentialGrade === "string"
        ? item.additionalPotentialGrade
        : null,
      lines: rawLower,
      lineGrades: Array.isArray(lineGrades?.additionalPotential)
        ? lineGrades.additionalPotential
        : rawLower.map(() => item?.additionalPotentialGrade),
    },
    exceptional: tooltipExceptionalModel(raw, sourceOptions),
    scroll,
    soul: [
      raw.soulName,
      raw.soulActive === false ? "소울 비활성" : null,
      raw.soulOption,
      Number(raw.soulAttack) > 0 ? `공격력 +${raw.soulAttack}` : null,
      Number(raw.soulMagic) > 0 ? `마력 +${raw.soulMagic}` : null,
      Number(raw.soulAmplification) > 0
        ? `소울 증폭 ${raw.soulAmplification}단계${raw.soulPotentialGrade ? ` · ${raw.soulPotentialGrade}` : ""}`
        : null,
      ...(Array.isArray(raw.soulPotentialLines) ? raw.soulPotentialLines : []),
    ]
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => value.trim()),
  };
}

function signedTooltipValue(value, unit = "") {
  const number = Number(value);
  const formatted = Math.abs(number).toLocaleString("ko-KR", {
    maximumFractionDigits: 2,
  });
  return `${number >= 0 ? "+" : "-"}${formatted}${unit}`;
}

function absoluteTooltipValue(value) {
  return Math.abs(Number(value)).toLocaleString("ko-KR", {
    maximumFractionDigits: 2,
  });
}

function tooltipDisplayNumber(option, value) {
  const number = Number(value);
  return option.key === "equipment_level_decrease"
    ? -Math.abs(number)
    : number;
}

export function getEquipmentTooltipBreakdown(option) {
  const enhanced = option.starforce ?? 0;
  const hasAdditionalValue = [option.add, option.etc, enhanced]
    .some((component) => Number.isFinite(component) && component !== 0);
  if (!hasAdditionalValue) return [];
  return [
    ["base", option.base],
    ["enhancement", enhanced],
    ["etc", option.etc],
    ["add", option.add],
  ].filter(([kind, component]) =>
    Number.isFinite(component) && (kind === "base" || component !== 0)
  ).map(([kind, component]) => ({
    kind,
    value: tooltipDisplayNumber(option, component),
    unit: option.unit,
  }));
}

function tooltipOptionRow(option) {
  const row = element("div", "profile-equipment-tooltip__stat");
  const value = element("span", "profile-equipment-tooltip__stat-value");
  value.append(
    element("strong", "", option.label),
    element(
      "b",
      "",
      option.total !== null
        ? signedTooltipValue(
            tooltipDisplayNumber(option, option.total),
            option.unit,
          )
        : "",
    ),
  );
  const components = getEquipmentTooltipBreakdown(option);
  if (components.length) {
    const breakdown = element("span", "profile-equipment-tooltip__breakdown");
    breakdown.append(document.createTextNode(" ("));
    components.forEach(({ kind, value: displayComponent, unit }, index) => {
      if (index) {
        breakdown.append(document.createTextNode(
          displayComponent >= 0 ? " + " : " - ",
        ));
      } else if (displayComponent < 0) {
        breakdown.append(document.createTextNode("-"));
      }
      const piece = element(
        "span",
        "profile-equipment-tooltip__component",
        `${absoluteTooltipValue(displayComponent)}${unit}`,
      );
      piece.dataset.kind = kind;
      breakdown.append(piece);
    });
    breakdown.append(document.createTextNode(")"));
    value.append(breakdown);
  }
  row.append(value);
  return row;
}

function tooltipOptionSection(title, data, kind) {
  if (!data.lines.length) return null;
  const section = element("section", "profile-equipment-tooltip__section");
  section.dataset.kind = kind;
  const heading = element("strong", "profile-equipment-tooltip__section-title");
  if (data.grade) {
    heading.dataset.grade = data.grade;
    const badge = element(
      "span",
      "profile-equipment-tooltip__grade-badge",
      POTENTIAL_GRADE_BADGES[data.grade] ?? data.grade.slice(0, 1),
    );
    badge.dataset.grade = data.grade;
    badge.setAttribute("aria-hidden", "true");
    heading.append(badge);
  }
  heading.append(document.createTextNode(
    `${title}${data.grade ? `: ${data.grade}` : ""}`,
  ));
  const list = element("ul", "profile-equipment-tooltip__lines");
  list.append(...data.lines.map((line, index) => {
    const entry = element("li", "", line);
    const lineGrade = data.lineGrades?.[index];
    if (lineGrade) entry.dataset.grade = lineGrade;
    return entry;
  }));
  section.append(heading, list);
  return section;
}

function tooltipExceptionalSection(data) {
  if (!data?.lines?.length && !(data?.upgraded > 0)) return null;
  const section = element("section", "profile-equipment-tooltip__section");
  section.dataset.kind = "exceptional-upgrade";
  const count = data.upgraded > 0
    ? ` ${data.upgraded}회 강화`
    : " 강화";
  const title = element("strong", "profile-equipment-tooltip__section-title");
  title.append(
    element("span", "profile-equipment-tooltip__exceptional-badge", "EX"),
    document.createTextNode(`익셉셔널${count}`),
  );
  section.append(title);
  if (data.lines.length) {
    const list = element("ul", "profile-equipment-tooltip__lines");
    list.append(...data.lines.map((line) => element("li", "", line)));
    section.append(list);
  }
  return section;
}

function tooltipScrollSection(data) {
  if (!data) return null;
  const details = [
    data.upgradeable !== null ? `잔여 ${data.upgradeable}회` : null,
    data.recoverable !== null ? `복구 가능 ${data.recoverable}회` : null,
  ].filter(Boolean);
  if (data.upgraded === null && !details.length) return null;
  const section = element("section", "profile-equipment-tooltip__section");
  section.dataset.kind = "scroll";
  const line = element("p", "profile-equipment-tooltip__scroll");
  if (data.upgraded !== null) {
    line.append(element(
      "strong",
      "",
      `주문서 강화 ${data.upgraded}회`,
    ));
  }
  if (details.length) {
    if (data.upgraded !== null) line.append(document.createTextNode(" "));
    line.append(document.createTextNode(`(${details.join(", ")})`));
  }
  section.append(line);
  return section;
}

function renderEquipmentTooltip(tooltip, item, lineGrades = null) {
  const model = getCharacterEquipmentTooltipModel(item, lineGrades);
  const header = element("header", "profile-equipment-tooltip__header");
  if (model.stars > 0) {
    const visibleStars = model.stars;
    const starSlotCount = Math.max(25, Math.ceil(visibleStars / 5) * 5);
    const stars = element("div", "profile-equipment-tooltip__stars");
    for (
      let groupIndex = 0;
      groupIndex < starSlotCount / 5;
      groupIndex += 1
    ) {
      const group = element("span", "profile-equipment-tooltip__star-group");
      for (let index = 0; index < 5; index += 1) {
        const starIndex = groupIndex * 5 + index;
        const star = element("span", "profile-equipment-tooltip__star", "★");
        star.dataset.filled = String(starIndex < visibleStars);
        group.append(star);
      }
      stars.append(group);
    }
    stars.setAttribute("aria-label", `${model.stars}성`);
    header.append(stars);
    if (visibleStars >= 23) header.dataset.sparkle = "true";
  }
  const title = element("strong", "profile-equipment-tooltip__name", model.name);
  header.append(title);
  if (model.description) {
    header.append(element(
      "p",
      "profile-equipment-tooltip__description",
      model.description,
    ));
  }

  const overview = element("div", "profile-equipment-tooltip__overview");
  const icon = element("span", "profile-equipment-tooltip__icon");
  if (model.icon) {
    const image = document.createElement("img");
    image.src = model.icon;
    image.alt = "";
    icon.append(image);
  } else {
    icon.append(element("span", "", "장비"));
  }
  const overviewTop = element(
    "div",
    "profile-equipment-tooltip__overview-top",
  );
  overviewTop.append(icon);
  if (model.tags.length) {
    const tags = element("span", "profile-equipment-tooltip__tags");
    tags.append(...model.tags.map((value) =>
      element("span", "profile-equipment-tooltip__tag", value)
    ));
    overviewTop.append(tags);
  }
  const meta = element("div", "profile-equipment-tooltip__meta");
  meta.append(...model.metadata.map(({ label, value }) => {
    const row = element("span", "profile-equipment-tooltip__meta-row");
    row.append(
      element("span", "profile-equipment-tooltip__meta-label", label),
      element("strong", "profile-equipment-tooltip__meta-value", value),
    );
    return row;
  }));
  overview.append(overviewTop, meta);

  const body = element("div", "profile-equipment-tooltip__body");
  if (!model.rawAvailable) {
    body.append(element(
      "p",
      "profile-equipment-tooltip__raw-state",
      "원본 장비 정보를 갱신하는 중입니다. 계속 보이면 정보 갱신을 눌러 주세요.",
    ));
  }
  if (model.options.length) {
    const stats = element("section", "profile-equipment-tooltip__stats");
    stats.append(...model.options.map(tooltipOptionRow));
    body.append(stats);
  }
  const scroll = tooltipScrollSection(model.scroll);
  if (scroll) body.append(scroll);
  const upper = tooltipOptionSection("잠재능력", model.potential, "potential");
  const lower = tooltipOptionSection(
    "에디셔널 잠재능력",
    model.additionalPotential,
    "additional",
  );
  if (upper) body.append(upper);
  if (lower) body.append(lower);
  const exceptional = tooltipExceptionalSection(model.exceptional);
  if (exceptional) body.append(exceptional);
  if (model.soul.length) {
    const section = element("section", "profile-equipment-tooltip__section");
    section.dataset.kind = "soul";
    section.append(
      element("strong", "profile-equipment-tooltip__section-title", "소울"),
      ...model.soul.map((line) => element("p", "", line)),
    );
    body.append(section);
  }
  tooltip.replaceChildren(header, overview, body);
}

let equipmentTooltipSequence = 0;

export function getEquipmentTooltipPlacement({
  anchor,
  equipment,
  tooltipWidth,
  tooltipHeight,
  viewportWidth,
  viewportHeight,
  leftBoundary = 8,
  rightBoundary = viewportWidth - 8,
  protectedTop = equipment.bottom,
  margin = 8,
  gap = 10,
}) {
  const leftSpace = equipment.left - gap - leftBoundary;
  const rightSpace = rightBoundary - equipment.right - gap;
  const canFloatLeft = leftSpace >= tooltipWidth;
  const canFloatRight = rightSpace >= tooltipWidth;
  const canFloatVertically = tooltipHeight <= viewportHeight - margin * 2;
  if (!canFloatVertically) {
    return { placement: "inline" };
  }
  const anchorOnLeft = anchor.left + anchor.width / 2 <
    equipment.left + equipment.width / 2;
  // 인게임 장비창과 같은 방향 감각을 유지한다. 왼쪽 장비의 설명은
  // 장비판 왼쪽, 오른쪽 장비의 설명은 장비판 오른쪽을 우선한다.
  const canFloatPreferredSide = anchorOnLeft ? canFloatLeft : canFloatRight;
  if (canFloatPreferredSide) {
    const left = anchorOnLeft
      ? equipment.left - tooltipWidth - gap
      : equipment.right + gap;
    const top = Math.max(margin, Math.min(
      anchor.top + anchor.height / 2 - tooltipHeight / 2,
      viewportHeight - tooltipHeight - margin,
    ));
    return {
      placement: anchorOnLeft ? "left" : "right",
      left: Math.round(left),
      top: Math.round(top),
    };
  }

  // 좌우 바깥에 카드 전체가 들어갈 공간이 없으면 장비판 위에 띄운다.
  // 이때 방향보다 원본 장비 칸이 계속 보이는 것이 우선이다. 선호 방향에
  // 장비와 겹치지 않게 둘 수 없다면 반대편에 붙이고, 양쪽 모두 불가능할
  // 때만 인라인으로 내린다.
  const overlayBottom = Math.min(
    Number.isFinite(protectedTop) ? protectedTop - gap : viewportHeight - margin,
    viewportHeight - margin,
  );
  const maximumOverlayTop = overlayBottom - tooltipHeight;
  if (maximumOverlayTop < margin) return { placement: "inline" };

  const anchorRight = Number.isFinite(anchor.right)
    ? anchor.right
    : anchor.left + anchor.width;
  const leftOfAnchor = anchor.left - tooltipWidth - gap;
  const rightOfAnchor = anchorRight + gap;
  const fitsOnSide = (side) => side === "left"
    ? leftOfAnchor >= leftBoundary
    : rightOfAnchor + tooltipWidth <= rightBoundary;
  const sideOrder = anchorOnLeft ? ["left", "right"] : ["right", "left"];
  const overlaySide = sideOrder.find(fitsOnSide);
  if (!overlaySide) return { placement: "inline" };
  const left = overlaySide === "left" ? leftOfAnchor : rightOfAnchor;
  const preferredTop = anchor.top + anchor.height / 2 - tooltipHeight / 2;
  const top = Math.max(margin, Math.min(preferredTop, maximumOverlayTop));
  return {
    placement: "overlay",
    left: Math.round(left),
    top: Math.round(top),
  };
}

function createEquipmentTooltipController(grid, board, inlineReference) {
  const tooltip = element("div", "profile-equipment-tooltip");
  tooltip.id = `profile-equipment-tooltip-${++equipmentTooltipSequence}`;
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  let activeSlot = null;
  let pinnedSlot = null;
  let renderRevision = 0;

  const position = () => {
    if (!activeSlot || tooltip.hidden) return;
    if (!activeSlot.isConnected) {
      hide();
      return;
    }
    const anchor = activeSlot.getBoundingClientRect();
    const equipment = grid.getBoundingClientRect();
    const protectedArea = inlineReference.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const margin = 8;
    const gap = 10;
    delete tooltip.dataset.placement;
    tooltip.style.removeProperty("left");
    tooltip.style.removeProperty("top");
    const width = tooltip.offsetWidth;
    const height = tooltip.offsetHeight;
    const placement = getEquipmentTooltipPlacement({
      anchor,
      equipment,
      tooltipWidth: width,
      tooltipHeight: height,
      viewportWidth,
      viewportHeight,
      leftBoundary: margin,
      rightBoundary: viewportWidth - margin,
      protectedTop: Math.min(protectedArea.top, equipment.bottom),
      margin,
      gap,
    });
    tooltip.dataset.placement = placement.placement;
    if (placement.placement === "inline") {
      if (tooltip.parentElement !== board) {
        board.insertBefore(tooltip, inlineReference);
      }
      return;
    }
    // 카드의 stacking context 안에 두면 고정 메뉴가 툴팁을 가릴 수 있다.
    // 바깥 배치일 때는 body 직속 최상위 레이어로 옮겨 메뉴 위에 표시한다.
    if (tooltip.parentElement !== document.body) document.body.append(tooltip);
    tooltip.style.left = `${placement.left}px`;
    tooltip.style.top = `${placement.top}px`;
  };
  const draw = (item, lineGrades = null) => {
    renderEquipmentTooltip(tooltip, item, lineGrades);
    const close = element("button", "profile-equipment-tooltip__close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "장비 상세 닫기");
    close.addEventListener("click", () => hide());
    tooltip.append(close);
  };
  const show = (item, slot, { pin = false } = {}) => {
    // 고정 중에는 다른 장비에 마우스를 올려도 상세 정보가 바뀌지 않는다.
    if (pinnedSlot && !pin) return false;
    if (pin) {
      pinnedSlot = slot;
      document.addEventListener("click", dismissOutside, true);
    }
    // 좁은 화면에서 떠 있는 상세 정보가 장비의 마우스 이벤트를 가로채지 않는다.
    tooltip.style.pointerEvents = pin ? "auto" : "none";
    if (activeSlot === slot && !tooltip.hidden) return true;
    activeSlot = slot;
    const revision = ++renderRevision;
    draw(item);
    tooltip.hidden = false;
    position();
    requestAnimationFrame(position);
    resolveCharacterEquipmentPotentialLineGrades(item).then((lineGrades) => {
      if (
        revision !== renderRevision || activeSlot !== slot || tooltip.hidden
      ) return;
      draw(item, lineGrades);
      position();
      requestAnimationFrame(position);
    });
    return true;
  };
  const hide = (slot) => {
    if (slot && activeSlot !== slot) return;
    document.removeEventListener("click", dismissOutside, true);
    renderRevision += 1;
    tooltip.hidden = true;
    activeSlot = null;
    pinnedSlot = null;
    if (board.isConnected && inlineReference.parentElement === board) {
      board.insertBefore(tooltip, inlineReference);
    } else {
      tooltip.remove();
    }
  };
  const dismissOutside = (event) => {
    if (activeSlot?.contains(event.target) || tooltip.contains(event.target)) {
      return;
    }
    hide();
  };
  const togglePinned = (item, slot) => {
    if (pinnedSlot === slot) {
      hide(slot);
    } else {
      show(item, slot, { pin: true });
    }
  };
  const hideUnlessPinned = (slot) => {
    if (!pinnedSlot) hide(slot);
  };
  tooltip.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  });
  return { tooltip, show, hide, togglePinned, hideUnlessPinned, position };
}

function equipmentSlot(
  item,
  row,
  column,
  onActivate,
  profile,
  tooltipController,
) {
  const slot = element(item ? "button" : "div", "profile-equipment__slot");
  slot.style.setProperty("--equipment-row", String(row));
  slot.style.setProperty("--equipment-column", String(column));
  slot.dataset.layoutColumn = String(column);
  const upperValue = item
    ? getCharacterEquipmentQuickValue(item, "upper", profile)
    : null;
  const lowerValue = item
    ? getCharacterEquipmentQuickValue(item, "lower", profile)
    : null;
  const upper = element(
    "span",
    "profile-equipment__quick-value",
  );
  const lower = element(
    "span",
    "profile-equipment__quick-value",
  );
  upper.append(element(
    "span",
    "profile-equipment__quick-value-text",
    upperValue ?? "",
  ));
  lower.append(element(
    "span",
    "profile-equipment__quick-value-text",
    lowerValue ?? "",
  ));
  const upperText = upper.firstElementChild;
  const lowerText = lower.firstElementChild;
  upperText.dataset.fullValue = upperValue ?? "";
  lowerText.dataset.fullValue = lowerValue ?? "";
  upper.dataset.kind = "upper";
  lower.dataset.kind = "lower";
  if (item && isOffensivePotentialItem(item)) {
    upper.dataset.composite = "true";
    lower.dataset.composite = "true";
  }
  if (!upperValue) upper.dataset.blank = "true";
  if (!lowerValue) lower.dataset.blank = "true";
  if (item?.potentialGrade) upper.dataset.grade = item.potentialGrade;
  if (item?.additionalPotentialGrade) {
    lower.dataset.grade = item.additionalPotentialGrade;
  }
  upper.setAttribute("aria-hidden", "true");
  lower.setAttribute("aria-hidden", "true");
  const icon = element("span", "profile-equipment__icon");
  if (!item) {
    slot.dataset.empty = "true";
    icon.dataset.empty = "true";
    slot.setAttribute("aria-hidden", "true");
    slot.append(upper, icon, lower);
    return slot;
  }
  slot.type = "button";
  if (item.potentialGrade) slot.dataset.grade = item.potentialGrade;
  if (item.icon) {
    const image = document.createElement("img");
    image.src = item.icon;
    image.alt = "";
    image.loading = "lazy";
    icon.append(image);
  } else {
    icon.append(element("span", "profile-equipment__fallback", "장비"));
  }
  slot.append(upper, icon, lower);
  bindEquipmentSlotInteraction(
    slot,
    item,
    onActivate,
    profile,
    tooltipController,
  );
  return slot;
}

function bindEquipmentSlotInteraction(
  slot,
  item,
  onActivate,
  profile,
  tooltipController,
  labelPrefix = "",
) {
  const details = getCharacterEquipmentDetailValues(item, profile);
  const description = [
    labelPrefix,
    item.name,
    ...details,
  ].filter(Boolean).join(" · ");
  slot.setAttribute("aria-label", description);
  slot.setAttribute("aria-describedby", tooltipController.tooltip.id);
  let hovered = false;
  const activate = () => onActivate(item, slot);
  slot.addEventListener("pointerenter", (event) => {
    if (event.pointerType === "touch") return;
    hovered = true;
    if (tooltipController.show(item, slot)) activate();
  });
  slot.addEventListener("pointerleave", (event) => {
    if (event.pointerType === "touch") return;
    hovered = false;
    tooltipController.hideUnlessPinned(slot);
  });
  slot.addEventListener("focus", () => {
    if (tooltipController.show(item, slot)) activate();
  });
  slot.addEventListener("blur", () => {
    if (!hovered) tooltipController.hideUnlessPinned(slot);
  });
  slot.addEventListener("keydown", (event) => {
    if (event.key === "Escape") tooltipController.hide();
  });
  slot.addEventListener("click", () => {
    tooltipController.togglePinned(item, slot);
    activate();
  });
}

function specialRingPairSlot(
  pair,
  row,
  column,
  onActivate,
  profile,
  tooltipController,
) {
  const group = element("div", "profile-equipment__special-ring-pair");
  group.style.setProperty("--equipment-row", String(row));
  group.style.setProperty("--equipment-column", String(column));
  group.dataset.layoutColumn = String(column);
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "특수 스킬 반지");
  const half = (item, role, label) => {
    const button = element("button", "profile-equipment__special-ring-half");
    button.type = "button";
    button.dataset.slotRole = role;
    button.dataset.layoutColumn = String(column);
    const icon = element("span", "profile-equipment__special-ring-pair-icon");
    if (item.icon) {
      const image = document.createElement("img");
      image.src = item.icon;
      image.alt = "";
      image.loading = "lazy";
      icon.append(image);
    } else {
      icon.append(element("span", "profile-equipment__fallback", "반지"));
    }
    button.append(icon);
    bindEquipmentSlotInteraction(
      button,
      item,
      onActivate,
      profile,
      tooltipController,
      label,
    );
    return button;
  };
  group.append(
    half(pair.equipped, "equipped", "현재 장착 특수 스킬 반지"),
    half(pair.reserve, "reserve", "예비 특수 스킬 반지"),
  );
  return group;
}

export function getCharacterEquipmentConversionLabel(profile, mode) {
  if (mode === "flame") return "장착 장비 환산";
  if (profile?.statModel === "xenon") {
    return "장착 장비 환산 (올스탯 %)";
  }
  if (profile?.statModel === "demon-avenger") {
    return "장착 장비 환산 (HP %)";
  }
  return "장착 장비 환산 (주스탯 %)";
}

export function characterEquipmentSummaryBoard(profile, mode, { identity } = {}) {
  const summary = profile?.equipmentSummary;
  if (!summary || !Array.isArray(summary.items) || !summary.items.length) {
    return null;
  }
  const board = element("section", "profile-equipment");
  const caption = element("div", "profile-equipment__caption");
  caption.append(
    element("strong", "", getCharacterEquipmentConversionLabel(profile, mode)),
    element(
      "span",
      "",
      summary.presetNo ? `장비 프리셋 ${summary.presetNo}` : "현재 장비",
    ),
  );
  const grid = element("div", "profile-equipment__grid");
  const character = element("div", "profile-equipment__character");
  if (identity) character.append(identity);
  if (profile.character?.image) {
    const image = document.createElement("img");
    image.src = profile.character.image;
    image.alt = `${profile.character.name} 캐릭터`;
    character.append(image);
  } else {
    character.append(
      element("span", "", String(profile.character?.name ?? "캐").slice(0, 1)),
    );
  }
  const layout = getCharacterEquipmentBoardLayout(summary.items);
  const bySlot = layout.bySlot;
  const initialItem = BOARD_SLOTS
    .map(([slot]) => bySlot.get(slot))
    .find((item) => getCharacterEquipmentDetailValues(item, profile).length) ??
      summary.items[0];
  const detail = equipmentDetailPanel(initialItem, profile);
  const tooltipController = createEquipmentTooltipController(
    grid,
    board,
    detail.panel,
  );
  let activeSlot = null;
  const activate = (item, slot) => {
    if (activeSlot) activeSlot.dataset.active = "false";
    activeSlot = slot;
    activeSlot.dataset.active = "true";
    detail.render(item);
  };
  const offensiveSlots = new Set(["무기", "보조무기", "엠블렘"]);
  const renderedSlots = BOARD_SLOTS.map(([name, row, column]) => {
    const item = bySlot.get(name);
    const pair = layout.specialRingPair?.slot === name
      ? layout.specialRingPair
      : null;
    return {
      name,
      item,
      node: pair
        ? specialRingPairSlot(
            pair,
            row,
            column,
            activate,
            profile,
            tooltipController,
          )
        : equipmentSlot(
            item,
            row,
            column,
            activate,
            profile,
            tooltipController,
          ),
    };
  });
  const offensiveRow = element("div", "profile-equipment__offensive-row");
  offensiveRow.append(
    ...renderedSlots
      .filter(({ name }) => offensiveSlots.has(name))
      .map(({ node }) => node),
  );
  grid.append(
    character,
    ...renderedSlots
      .filter(({ name }) => !offensiveSlots.has(name))
      .map(({ node }) => node),
    offensiveRow,
  );
  const initialNode = renderedSlots.find(({ item }) => item === initialItem)?.node;
  const initialSlot = initialNode instanceof HTMLButtonElement
    ? initialNode
    : initialNode?.querySelector?.(
        '.profile-equipment__special-ring-half[data-slot-role="equipped"]',
      );
  if (initialSlot instanceof HTMLButtonElement) {
    activeSlot = initialSlot;
    activeSlot.dataset.active = "true";
  }
  board.dataset.metricMode = mode;
  board.append(caption, grid, tooltipController.tooltip, detail.panel);
  const fitQuickValues = () => {
    for (const value of board.querySelectorAll(
      ".profile-equipment__quick-value-text",
    )) {
      fitCharacterEquipmentQuickValue(value);
    }
  };
  let fitFrame = 0;
  const scheduleQuickValueFit = () => {
    if (fitFrame) cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(() => {
      fitFrame = 0;
      fitQuickValues();
    });
  };
  scheduleQuickValueFit();
  if (typeof ResizeObserver === "function") {
    const resizeObserver = new ResizeObserver(() => {
      scheduleQuickValueFit();
      tooltipController.position();
    });
    resizeObserver.observe(grid);
    board.quickValueResizeObserver = resizeObserver;
  }
  document.fonts?.ready?.then(scheduleQuickValueFit);
  return board;
}
