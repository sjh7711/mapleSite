import {
  POTENTIAL_PAGE_TARGETS,
  parsePotentialOption,
} from "maple-core/potential";

const REGULAR_PRESET_PARTS = {
  1: { name: "무기", kind: "weapon" },
  2: { name: "엠블렘", kind: "emblem" },
  3: { name: "보조무기", kind: "weapon" },
  4: { name: "포스실드/소울링", kind: "weapon" },
  5: { name: "방패", kind: "weapon" },
  15: { name: "얼굴장식", kind: "accessory" },
  16: { name: "눈장식", kind: "accessory" },
  17: { name: "귀고리", kind: "accessory" },
  18: { name: "반지", kind: "accessory" },
  19: { name: "펜던트", kind: "accessory" },
};
const STAT_TARGET_TYPES = [
  "str-percent",
  "dex-percent",
  "int-percent",
  "luk-percent",
];
export const MAX_POTENTIAL_TARGET_SETS = 16;

function optionMetrics(option) {
  if (!option || typeof option.name !== "string") return null;
  try {
    return parsePotentialOption(option.name);
  } catch {
    return null;
  }
}

function minimumPositiveValue(line, selectValue) {
  if (!Array.isArray(line)) return null;
  const values = line
    .map(optionMetrics)
    .filter(Boolean)
    .map(selectValue)
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? Math.min(...values) : null;
}

function maximumPositiveValue(line, selectValue) {
  if (!Array.isArray(line)) return null;
  const values = line
    .map(optionMetrics)
    .filter(Boolean)
    .map(selectValue)
    .filter((value) => Number.isFinite(value) && value > 0);
  return values.length ? Math.max(...values) : null;
}

function lineMinimumValues(tables, selectValue) {
  if (!Array.isArray(tables) || tables.length < 3) return null;
  const values = tables.slice(0, 3).map((line) =>
    minimumPositiveValue(line, selectValue)
  );
  return values.every(Number.isFinite) ? values : null;
}

function roundTarget(value) {
  return Math.round(value * 1e10) / 1e10;
}

function additiveLineTarget(tables, selectValue, lineCount) {
  const values = lineMinimumValues(tables, selectValue);
  if (!values || lineCount < 1 || lineCount > values.length) return null;
  return roundTarget(
    values.toSorted((left, right) => left - right)
      .slice(0, lineCount)
      .reduce((sum, value) => sum + value, 0),
  );
}

export function supportsRegularOptimalPreset({ system, part, grade }) {
  return system === "regular" &&
    grade === "legendary" &&
    Boolean(REGULAR_PRESET_PARTS[Number(part)]);
}

function oneStepBelowTarget(tables, selectValue, optimalTarget) {
  const lineValues = lineMinimumValues(tables, selectValue);
  if (!lineValues || !Number.isFinite(optimalTarget)) return null;
  const nonPrimeValue = Math.min(...lineValues.slice(1));
  const tierGap = lineValues[0] - nonPrimeValue;
  if (!(tierGap > 0)) return null;
  return roundTarget(optimalTarget - tierGap);
}

function getAccessoryPreset({
  tables,
  partInfo,
  part,
  includeNearOptimal,
  includeDropMeso,
}) {
  const statSelectors = [0, 1, 2, 3].map(
    (index) => (metrics) => metrics.statPercent[index],
  );
  const optimalStatTargets = statSelectors.map((selectValue) =>
    additiveLineTarget(tables, selectValue, 3)
  );
  const optimalAllStatTarget = additiveLineTarget(
    tables,
    (metrics) => metrics.allStatPercent,
    3,
  );
  const statTargets = includeNearOptimal
    ? optimalStatTargets.map((target, index) =>
        oneStepBelowTarget(tables, statSelectors[index], target)
      )
    : optimalStatTargets;
  const allStatTarget = optimalAllStatTarget;
  const dropOne = additiveLineTarget(tables, (metrics) => metrics.drop, 1);
  const dropTwo = additiveLineTarget(tables, (metrics) => metrics.drop, 2);
  const mesoOne = additiveLineTarget(tables, (metrics) => metrics.meso, 1);
  const mesoTwo = additiveLineTarget(tables, (metrics) => metrics.meso, 2);
  if (
    !statTargets.every(Number.isFinite) ||
    ![allStatTarget, dropOne, dropTwo, mesoOne, mesoTwo].every(Number.isFinite)
  ) return null;

  const statTargetSets = [
    ...STAT_TARGET_TYPES.map((type, index) => [
      { type, value: statTargets[index] },
    ]),
    [{ type: "all-stat-percent", value: allStatTarget }],
  ];
  const dropMesoTargetSets = [
    [{ type: "drop", value: dropTwo }],
    [{ type: "meso", value: mesoTwo }],
    [
      { type: "drop", value: dropOne },
      { type: "meso", value: mesoOne },
    ],
  ];
  const targetSets = [
    ...statTargetSets,
    ...(includeDropMeso ? dropMesoTargetSets : []),
  ];
  const statDescription = [
    `STR·DEX·INT·LUK ${statTargets[0]}%`,
    `올스탯 ${allStatTarget}%`,
  ];
  if (includeDropMeso) {
    statDescription.push(
      `드랍 ${dropTwo}%`,
      `메획 ${mesoTwo}%`,
      `드랍 ${dropOne}% + 메획 ${mesoOne}%`,
    );
  }

  return {
    id: [
      `regular-accessory-${part}`,
      includeNearOptimal ? "near-optimal" : "optimal",
      includeDropMeso ? "drop-meso" : "stats-only",
    ].join("-"),
    kind: partInfo.kind,
    name: partInfo.name,
    label: `${partInfo.name} ${
      includeNearOptimal ? "정옵션 -3% " : "정옵션 "
    }${targetSets.length}세트 적용`,
    description: statDescription.join(" · "),
    targetSets,
    values: {
      stat: statTargets[0],
      allStat: allStatTarget,
      drop: dropTwo,
      meso: mesoTwo,
      mixedDrop: dropOne,
      mixedMeso: mesoOne,
    },
    canIncludeIgnoreDefense: false,
    includesIgnoreDefense: false,
    canIncludeNearOptimal: true,
    includesNearOptimal: Boolean(includeNearOptimal),
    canIncludeDropMeso: true,
    includesDropMeso: Boolean(includeDropMeso),
  };
}

function targetCategory({ id, type, label, tables, selectValue }) {
  const lineValues = lineMinimumValues(tables, selectValue);
  return lineValues
    ? { id, type, label, lineValues }
    : null;
}

function uniquePermutations(values) {
  const permutations = new Map();
  for (let first = 0; first < values.length; first += 1) {
    for (let second = 0; second < values.length; second += 1) {
      if (second === first) continue;
      const third = [0, 1, 2].find((index) => index !== first && index !== second);
      const permutation = [values[first], values[second], values[third]];
      permutations.set(permutation.join("|"), permutation);
    }
  }
  return [...permutations.values()];
}

function patternTargetSets(categories, pattern) {
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const typeOrder = [...new Set(pattern)];
  const targetSets = new Map();
  for (const permutation of uniquePermutations(pattern)) {
    const totals = new Map(typeOrder.map((id) => [id, 0]));
    permutation.forEach((id, lineIndex) => {
      const category = categoryMap.get(id);
      totals.set(id, totals.get(id) + category.lineValues[lineIndex]);
    });
    const targets = typeOrder.map((id) => {
      const category = categoryMap.get(id);
      return {
        type: category.type,
        value: roundTarget(totals.get(id)),
      };
    });
    const signature = targets.map(({ type, value }) => `${type}:${value}`).join("|");
    targetSets.set(signature, targets);
  }
  return [...targetSets.values()];
}

function describeTargetSet(targetSet, categories) {
  const labels = new Map(categories.map(({ type, label }) => [type, label]));
  return targetSet
    .map(({ type, value }) => `${labels.get(type) ?? type} ${value}%`)
    .join(" + ");
}

function getOffensePreset({
  tables,
  partInfo,
  attackType,
  includeIgnoreDefense,
  includePpyogong,
}) {
  if (!["attack", "magic"].includes(attackType)) return null;
  const attackTargetType = attackType === "magic"
    ? "magic-power-percent"
    : "attack-power-percent";
  const attackLabel = attackType === "magic" ? "마력" : "공격력";
  const selectAttack = attackType === "magic"
    ? (metrics) => metrics.magicPercent
    : (metrics) => metrics.attackPercent;
  const attack = targetCategory({
    id: "attack",
    type: attackTargetType,
    label: attackLabel,
    tables,
    selectValue: selectAttack,
  });
  const boss = partInfo.kind === "weapon"
    ? targetCategory({
        id: "boss",
        type: "boss-damage",
        label: "보공",
        tables,
        selectValue: (metrics) => metrics.bossDamage,
      })
    : null;
  if (boss && !includePpyogong) {
    const firstLineBoss = maximumPositiveValue(
      tables[0],
      (metrics) => metrics.bossDamage,
    );
    if (Number.isFinite(firstLineBoss)) {
      // 첫 줄 보공 35%(201+는 40%)인 뾰공만 제외하고,
      // 상위 보공 40%(201+는 45%) 조합은 정옵 세트에 유지한다.
      boss.lineValues[0] = firstLineBoss;
    }
  }
  const ignoreDefense = targetCategory({
    id: "ignore-defense",
    type: "ignore-defense",
    label: "방무",
    tables,
    selectValue: (metrics) => metrics.ignoreDefense,
  });
  if (!attack || (partInfo.kind === "weapon" && !boss)) return null;

  const categories = [attack, boss, ignoreDefense].filter(Boolean);
  const patterns = [["attack", "attack", "attack"]];
  if (partInfo.kind === "weapon") {
    patterns.push(
      ["attack", "attack", "boss"],
      ["attack", "boss", "boss"],
      ["boss", "boss", "boss"],
    );
  }
  if (includeIgnoreDefense && ignoreDefense) {
    patterns.push(["attack", "attack", "ignore-defense"]);
    if (partInfo.kind === "weapon") {
      patterns.push(
        ["attack", "boss", "ignore-defense"],
        ["boss", "boss", "ignore-defense"],
      );
    }
  }
  let targetSets = patterns.flatMap((pattern) =>
    patternTargetSets(categories, pattern)
  );
  if (partInfo.kind === "emblem") {
    const attackOnly = targetSets.filter((targets) =>
      targets.length === 1 && targets[0].type === attackTargetType
    );
    const attackAndIgnoreDefense = targetSets
      .filter((targets) =>
        targets.some(({ type }) => type === attackTargetType) &&
        targets.some(({ type }) => type === "ignore-defense")
      )
      .toSorted((left, right) => {
        const attackValue = (targets) =>
          targets.find(({ type }) => type === attackTargetType)?.value ?? 0;
        return attackValue(right) - attackValue(left);
      });
    targetSets = [attackOnly[0], attackAndIgnoreDefense[0]].filter(Boolean);
  }
  const descriptions = targetSets.map((targetSet) =>
    describeTargetSet(targetSet, categories)
  );

  return {
    id: [
      `regular-${partInfo.kind}-${attackType}-optimal`,
      includeIgnoreDefense ? "ied1" : "no-ied",
      includePpyogong ? "ppyogong" : "no-ppyogong",
    ].join("-"),
    kind: partInfo.kind,
    name: partInfo.name,
    label: `${partInfo.name} ${attackLabel} 정옵션 ${targetSets.length}세트 적용`,
    description: descriptions.join(" · "),
    targetSets,
    values: {
      attackLines: attack.lineValues,
      bossLines: boss?.lineValues ?? null,
      ignoreDefenseLines: ignoreDefense?.lineValues ?? null,
      ignoreDefenseOne: ignoreDefense
        ? Math.min(...ignoreDefense.lineValues)
        : null,
    },
    canIncludeIgnoreDefense: Boolean(ignoreDefense),
    includesIgnoreDefense: Boolean(includeIgnoreDefense && ignoreDefense),
    canIncludePpyogong: partInfo.kind === "weapon",
    includesPpyogong: Boolean(partInfo.kind === "weapon" && includePpyogong),
  };
}

export function getRegularOptimalPreset({
  system,
  part,
  grade,
  tables,
  attackType = "attack",
  includeIgnoreDefense = false,
  includePpyogong = true,
  includeNearOptimal = false,
  includeDropMeso = true,
}) {
  if (!supportsRegularOptimalPreset({ system, part, grade })) return null;
  const partInfo = REGULAR_PRESET_PARTS[Number(part)];
  return partInfo.kind === "accessory"
    ? getAccessoryPreset({
        tables,
        partInfo,
        part: Number(part),
        includeNearOptimal,
        includeDropMeso,
      })
    : getOffensePreset({
        tables,
        partInfo,
        attackType,
        includeIgnoreDefense,
        includePpyogong,
      });
}

export function materializePresetTargetSets(preset, options = {}) {
  const {
    maxTargets = 3,
    maxSets = MAX_POTENTIAL_TARGET_SETS,
    availableTypes = null,
  } = typeof options === "number" ? { maxTargets: options } : options;
  if (
    !preset ||
    !Array.isArray(preset.targetSets) ||
    preset.targetSets.length < 1 ||
    preset.targetSets.length > maxSets
  ) return [];
  const allowedTypes = availableTypes ? new Set(availableTypes) : null;
  for (const targets of preset.targetSets) {
    if (!Array.isArray(targets) || targets.length < 1 || targets.length > maxTargets) {
      return [];
    }
    const seen = new Set();
    for (const target of targets) {
      if (
        !target ||
        !POTENTIAL_PAGE_TARGETS[target.type] ||
        (allowedTypes && !allowedTypes.has(target.type)) ||
        seen.has(target.type) ||
        !Number.isFinite(Number(target.value)) ||
        Number(target.value) <= 0
      ) return [];
      seen.add(target.type);
    }
  }
  return preset.targetSets.map((targets) => {
    const materialized = targets.map((target) => ({
      type: target.type,
      value: target.value,
    }));
    while (materialized.length < maxTargets) {
      materialized.push({ type: "", value: "" });
    }
    return { targets: materialized };
  });
}
