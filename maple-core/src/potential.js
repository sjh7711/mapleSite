import { formatApproxMeso } from "./starforce.js";
import { calculateIgnoreDefenseEquivalent } from "./stat-efficiency.js";
import { adjustedNextResultProbability } from "./no-repeat.js";

export const POTENTIAL_GRADES = {
  rare: { id: 1, label: "레어" },
  epic: { id: 2, label: "에픽" },
  unique: { id: 3, label: "유니크" },
  legendary: { id: 4, label: "레전드리" },
};

export const POTENTIAL_SYSTEMS = {
  soul: { label: "소울 잠재능력", officialPage: "https://maplestory.nexon.com/Guide/OtherProbability/cube/Soulpotential" },
  regular: {
    label: "잠재능력",
    cubeItemId: "5062010",
    officialPage:
      "https://maplestory.nexon.com/Guide/OtherProbability/cube/black",
    footerLabel: "잠재능력 재설정/블큐",
  },
  additional: {
    label: "에디셔널 잠재능력",
    cubeItemId: "5062500",
    officialPage:
      "https://maplestory.nexon.com/Guide/OtherProbability/cube/addi",
    footerLabel: "에디셔널 잠재능력 재설정",
  },
};

/** 브라우저용 정적 확률표와 공식 조회가 사용하는 실제 큐브 표. */
export const POTENTIAL_TABLE_SOURCES = {
  regular: {
    system: "regular",
    label: "잠재능력 재설정/블큐",
    cubeItemId: "5062010",
    officialPage:
      "https://maplestory.nexon.com/Guide/OtherProbability/cube/black",
    maxGrade: "legendary",
  },
  "regular-gold": {
    system: "regular",
    label: "골큐",
    cubeItemId: "2711004",
    officialPage:
      "https://maplestory.nexon.com/Guide/OtherProbability/cube/artisan",
    maxGrade: "legendary",
  },
  "regular-silver": {
    system: "regular",
    label: "실큐",
    cubeItemId: "2711003",
    officialPage:
      "https://maplestory.nexon.com/Guide/OtherProbability/cube/master",
    maxGrade: "unique",
  },
  "regular-occult": {
    system: "regular",
    label: "수큐",
    cubeItemId: "2711000",
    officialPage:
      "https://maplestory.nexon.com/Guide/OtherProbability/cube/strange",
    maxGrade: "epic",
  },
  additional: {
    system: "additional",
    label: "에디셔널 잠재능력 재설정/화에큐",
    cubeItemId: "5062500",
    officialPage:
      "https://maplestory.nexon.com/Guide/OtherProbability/cube/addi",
    maxGrade: "legendary",
  },
  "additional-bronze": {
    system: "additional",
    label: "브에큐",
    cubeItemId: "2730002",
    officialPage:
      "https://maplestory.nexon.com/Guide/OtherProbability/cube/strangeAddi",
    maxGrade: "epic",
  },
};

const POTENTIAL_GRADE_ORDER = ["rare", "epic", "unique", "legendary"];

const REGULAR_BLACK_LINE_RATES = {
  rare: [0.2, 0.05],
  epic: [0.2, 0.05],
  unique: [0.2, 0.05],
  legendary: [0.2, 0.05],
};
const REGULAR_GOLD_LINE_RATES = {
  rare: [0.166667, 0.166667],
  epic: [0.079994, 0.079994],
  unique: [0.016959, 0.016959],
  legendary: [0.001996, 0.001996],
};
const REGULAR_SILVER_LINE_RATES = {
  rare: [0.166667, 0.166667],
  epic: [0.047619, 0.047619],
  unique: [0.011858, 0.011858],
};
const REGULAR_OCCULT_LINE_RATES = {
  rare: [0.000999, 0.000999],
  epic: [0.009901, 0.009901],
};
const ADDITIONAL_STANDARD_LINE_RATES = {
  rare: [0.019608, 0.019608],
  epic: [0.047619, 0.047619],
  unique: [0.019608, 0.019608],
  legendary: [0.004975, 0.004975],
};
const ADDITIONAL_BRONZE_LINE_RATES = {
  rare: [0.019608, 0.019608],
  epic: [0.004, 0.004],
};

/**
 * 재설정 수단별 공식 등급 상승·옵션 등급 확률.
 * `lineSameGrade`는 두 번째·세 번째 줄이 장비 잠재 등급과 같은 옵션 등급일
 * 확률이며, `pity`가 없으면 등급 상승 보장 시스템이 없는 큐브다.
 */
export const POTENTIAL_RESET_METHODS = {
  soul: { meso: {
    label: "소울 잠재능력 재설정", shortLabel: "메소", maxGrade: "legendary", usesMeso: true,
    lineSameGrade: ADDITIONAL_STANDARD_LINE_RATES,
    rankUp: { rare: 0.015, epic: 0.005875, unique: 0.003322 },
    pity: { rare: 100, epic: 256, unique: 451 },
  } },
  regular: {
    meso: {
      label: "메소 재설정",
      shortLabel: "메소",
      maxGrade: "legendary",
      tableSource: "regular",
      usesMeso: true,
      lineSameGrade: REGULAR_BLACK_LINE_RATES,
      rankUp: { rare: 0.150000001275, epic: 0.035, unique: 0.014 },
      pity: { rare: 10, epic: 42, unique: 107 },
    },
    black: {
      label: "블큐",
      shortLabel: "블큐",
      maxGrade: "legendary",
      tableSource: "regular",
      usesMeso: false,
      lineSameGrade: REGULAR_BLACK_LINE_RATES,
      rankUp: { rare: 0.150000001275, epic: 0.035, unique: 0.014 },
      pity: { rare: 10, epic: 42, unique: 107 },
    },
    gold: {
      label: "골큐",
      shortLabel: "골큐",
      maxGrade: "legendary",
      tableSource: "regular-gold",
      usesMeso: false,
      lineSameGrade: REGULAR_GOLD_LINE_RATES,
      rankUp: { rare: 0.079994, epic: 0.016959, unique: 0.001996 },
      pity: null,
    },
    prime: {
      label: "프큐", shortLabel: "프큐",
      minGrade: "legendary", maxGrade: "legendary", tableSource: "regular",
      // 250제 125만 메소 실사용 제보와 사용자 승인에 따라 기존 큐브 비용식을 적용한다.
      usesMeso: false, fixedFirstLine: true, revealCostBasis: "standard-cube-assumption", lineSameGrade: REGULAR_BLACK_LINE_RATES,
      rankUp: {}, pity: null,
    },
    silver: {
      label: "실큐",
      shortLabel: "실큐",
      maxGrade: "unique",
      tableSource: "regular-silver",
      usesMeso: false,
      lineSameGrade: REGULAR_SILVER_LINE_RATES,
      rankUp: { rare: 0.047619, epic: 0.011858 },
      pity: null,
    },
    occult: {
      label: "수큐",
      shortLabel: "수큐",
      maxGrade: "epic",
      tableSource: "regular-occult",
      usesMeso: false,
      lineSameGrade: REGULAR_OCCULT_LINE_RATES,
      rankUp: { rare: 0.009901 },
      pity: null,
    },
  },
  additional: {
    meso: {
      label: "메소 재설정",
      shortLabel: "메소",
      maxGrade: "legendary",
      tableSource: "additional",
      usesMeso: true,
      lineSameGrade: ADDITIONAL_STANDARD_LINE_RATES,
      rankUp: { rare: 0.02381, epic: 0.009804, unique: 0.007 },
      pity: { rare: 62, epic: 152, unique: 214 },
    },
    white: {
      label: "화에큐",
      shortLabel: "화에큐",
      maxGrade: "legendary",
      tableSource: "additional",
      usesMeso: false,
      lineSameGrade: ADDITIONAL_STANDARD_LINE_RATES,
      rankUp: { rare: 0.047619, epic: 0.019608, unique: 0.007 },
      pity: { rare: 31, epic: 76, unique: 214 },
    },
    prime: {
      label: "프에큐", shortLabel: "프에큐",
      minGrade: "legendary", maxGrade: "legendary", tableSource: "additional",
      usesMeso: false, fixedFirstLine: true, revealCostBasis: "standard-cube-assumption", lineSameGrade: ADDITIONAL_STANDARD_LINE_RATES,
      rankUp: {}, pity: null,
    },
    bronze: {
      label: "브에큐",
      shortLabel: "브에큐",
      maxGrade: "epic",
      tableSource: "additional-bronze",
      usesMeso: false,
      lineSameGrade: ADDITIONAL_BRONZE_LINE_RATES,
      rankUp: { rare: 0.004 },
      pity: null,
    },
  },
};

function gradeIndex(grade) {
  return POTENTIAL_GRADE_ORDER.indexOf(grade);
}

export function getPotentialResetMethod(system, method = "meso") {
  const config = POTENTIAL_RESET_METHODS[system]?.[method];
  if (!config) {
    throw new RangeError("지원하지 않는 잠재 재설정 수단입니다.");
  }
  return { id: method, ...config };
}

export function getAvailablePotentialResetMethods(system, grade) {
  const currentGradeIndex = gradeIndex(grade);
  const methods = POTENTIAL_RESET_METHODS[system];
  if (!methods || currentGradeIndex === -1) {
    throw new RangeError("지원하지 않는 잠재 종류 또는 등급입니다.");
  }
  return Object.entries(methods)
    .filter(([, method]) => gradeIndex(method.maxGrade) >= currentGradeIndex &&
      currentGradeIndex >= gradeIndex(method.minGrade ?? "rare"))
    .map(([id, method]) => ({ id, ...method }));
}

export function getPotentialRankUpInfo({
  system,
  method = "meso",
  grade,
  miracle = false,
}) {
  const config = getPotentialResetMethod(system, method);
  const currentGradeIndex = gradeIndex(grade);
  const maxGradeIndex = gradeIndex(config.maxGrade);
  if (currentGradeIndex === -1 || currentGradeIndex > maxGradeIndex ||
      currentGradeIndex < gradeIndex(config.minGrade ?? "rare")) {
    throw new RangeError("선택한 등급에는 이 재설정 수단을 사용할 수 없습니다.");
  }
  const nextGrade = POTENTIAL_GRADE_ORDER[currentGradeIndex + 1] ?? null;
  const baseProbability = config.rankUp?.[grade] ?? null;
  const canRankUp = Boolean(
    nextGrade && currentGradeIndex < maxGradeIndex && baseProbability > 0,
  );
  return {
    canRankUp,
    fromGrade: grade,
    toGrade: canRankUp ? nextGrade : null,
    maxGrade: config.maxGrade,
    probability: canRankUp
      ? Math.min(1, baseProbability * (miracle ? 2 : 1))
      : 0,
    pity: canRankUp && Number.isFinite(config.pity?.[grade])
      ? config.pity[grade]
      : null,
  };
}

/**
 * 현재 잠재 등급부터 목표 등급까지 연속으로 상승시키는 기댓값을 계산한다.
 * 등급별 천장은 서로 독립적으로 누적되므로 각 단계의 현재 진행도를
 * 따로 받아 해당 단계의 남은 횟수와 전체 기댓값에 반영한다.
 */
export function calculatePotentialRankUpExpected({
  system,
  method = "meso",
  fromGrade,
  toGrade,
  itemLevel,
  miracle = false,
  rankProgress = 0,
  rankProgressByGrade = null,
}) {
  const resetMethod = getPotentialResetMethod(system, method);
  const fromIndex = gradeIndex(fromGrade);
  const toIndex = gradeIndex(toGrade);
  const maxGradeIndex = gradeIndex(resetMethod.maxGrade);
  if (
    fromIndex === -1 ||
    toIndex === -1 ||
    toIndex <= fromIndex ||
    toIndex > maxGradeIndex
  ) {
    throw new RangeError(
      "목표 등급은 현재 등급보다 높고 재설정 수단의 최고 등급 이하여야 합니다.",
    );
  }

  const stages = [];
  for (let index = fromIndex; index < toIndex; index += 1) {
    const grade = POTENTIAL_GRADE_ORDER[index];
    const info = getPotentialRankUpInfo({
      system,
      method,
      grade,
      miracle,
    });
    if (!info.canRankUp) {
      throw new RangeError("목표 등급까지 올릴 수 없는 재설정 수단입니다.");
    }
    const requestedProgress = Number(
      rankProgressByGrade?.[grade] ??
        (index === fromIndex ? rankProgress : 0),
    );
    const progress = info.pity !== null
      ? Math.max(
          0,
          Math.min(info.pity - 1, Math.round(requestedProgress || 0)),
        )
      : 0;
    const remaining = info.pity === null ? null : info.pity - progress;
    const expectedAttempts = remaining === null
      ? 1 / info.probability
      : (1 - (1 - info.probability) ** remaining) / info.probability;
    const resetCost = getPotentialResetCost(
      itemLevel,
      grade,
      system,
      method,
    );
    stages.push({
      ...info,
      progress,
      remaining,
      expectedAttempts,
      resetCost,
      expectedCost:
        resetCost === null ? null : expectedAttempts * resetCost,
    });
  }

  return {
    fromGrade,
    toGrade,
    miracle: Boolean(miracle),
    usesMeso: resetMethod.usesMeso,
    stages,
    expectedAttempts: stages.reduce(
      (sum, stage) => sum + stage.expectedAttempts,
      0,
    ),
    expectedCost: stages.every((stage) => stage.expectedCost !== null)
      ? stages.reduce((sum, stage) => sum + stage.expectedCost, 0)
      : null,
    maximumAttempts: stages.every((stage) => stage.remaining !== null)
      ? stages.reduce((sum, stage) => sum + stage.remaining, 0)
      : null,
  };
}

function convolveRankUpStage(previous, {
  probability,
  remaining,
  step = 1,
}, maximum) {
  const next = new Float64Array(maximum + 1);
  const success = Number(probability);
  const failure = 1 - success;
  const capped = Number.isInteger(remaining) && remaining > 0;
  const tailMass = capped ? failure ** remaining : 0;

  for (let index = step; index <= maximum; index += 1) {
    let value = failure * next[index - step] + success * previous[index - step];
    if (capped) {
      const guaranteeOffset = remaining * step;
      const tailOffset = (remaining + 1) * step;
      if (index >= guaranteeOffset) {
        value += tailMass * previous[index - guaranteeOffset];
      }
      if (index >= tailOffset) {
        value -= tailMass * previous[index - tailOffset];
      }
    }
    next[index] = Math.abs(value) < 1e-15 ? 0 : Math.max(0, value);
  }
  return next;
}

function rankUpStageAttemptLimit(stage, targetChance, stageCount) {
  if (Number.isInteger(stage.remaining) && stage.remaining > 0) {
    return stage.remaining;
  }
  if (stage.probability >= 1) return 1;
  const failureAllowance = (1 - targetChance) / stageCount;
  return Math.max(
    1,
    Math.ceil(Math.log(failureAllowance) / Math.log1p(-stage.probability)),
  );
}

function distributionQuantile(distribution, targetChance) {
  let cumulative = 0;
  for (let index = 0; index < distribution.length; index += 1) {
    cumulative += distribution[index];
    if (cumulative + 1e-12 >= targetChance) return index;
  }
  return distribution.length - 1;
}

function integerGcd(left, right) {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));
  while (b > 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

/**
 * 여러 등급 상승 단계를 순서대로 진행할 때 목표 누적 확률을 만족하는
 * 최소 총 재설정 횟수와 최소 메소 예산을 계산한다. 천장이 있는 단계는
 * 마지막 시도에 남은 실패 확률을 합쳐 정확한 확률 분포로 처리한다.
 */
export function calculatePotentialRankUpReachForChance(plan, chance) {
  const targetChance = Number(chance);
  if (!Number.isFinite(targetChance) || targetChance <= 0 || targetChance >= 1) {
    throw new RangeError("목표 누적 확률은 0보다 크고 1보다 작아야 합니다.");
  }
  const stages = Array.isArray(plan?.stages) ? plan.stages : [];
  if (stages.length === 0) {
    throw new RangeError("등급 상승 단계가 필요합니다.");
  }
  for (const stage of stages) {
    if (
      !Number.isFinite(stage?.probability) ||
      stage.probability <= 0 ||
      stage.probability > 1
    ) {
      throw new RangeError("등급 상승 확률은 0보다 크고 1 이하여야 합니다.");
    }
  }

  const limits = stages.map((stage) =>
    rankUpStageAttemptLimit(stage, targetChance, stages.length)
  );
  const maximumAttempts = limits.reduce((sum, limit) => sum + limit, 0);
  let attemptDistribution = new Float64Array(maximumAttempts + 1);
  attemptDistribution[0] = 1;
  stages.forEach((stage) => {
    attemptDistribution = convolveRankUpStage(
      attemptDistribution,
      { probability: stage.probability, remaining: stage.remaining, step: 1 },
      maximumAttempts,
    );
  });
  const attempts = distributionQuantile(attemptDistribution, targetChance);

  const costs = stages.map((stage) => stage.resetCost);
  let cost = null;
  if (costs.every((value) => Number.isSafeInteger(value) && value >= 0)) {
    const positiveCosts = costs.filter((value) => value > 0);
    if (positiveCosts.length === 0) {
      cost = 0;
      return { chance: targetChance, attempts, cost };
    }
    const costUnit = positiveCosts.reduce(integerGcd);
    const costSteps = costs.map((value) => value / costUnit);
    const maximumCostUnits = limits.reduce(
      (sum, limit, index) => sum + limit * costSteps[index],
      0,
    );
    let costDistribution = new Float64Array(maximumCostUnits + 1);
    costDistribution[0] = 1;
    stages.forEach((stage, index) => {
      if (costSteps[index] === 0) return;
      costDistribution = convolveRankUpStage(
        costDistribution,
        {
          probability: stage.probability,
          remaining: stage.remaining,
          step: costSteps[index],
        },
        maximumCostUnits,
      );
    });
    cost = distributionQuantile(costDistribution, targetChance) * costUnit;
  }

  return { chance: targetChance, attempts, cost };
}

export const POTENTIAL_TARGETS = {
  "stat-percent": { label: "주스탯% 합", unit: "%" },
  "stat-equivalent": { label: "주스탯 %급", unit: "%급" },
  "stat-equivalent-no-crit": {
    label: "주스탯 %급 (크뎀 제외)",
    unit: "%급",
  },
  "boss-stat-equivalent": { label: "보스전 주스탯% 환산", unit: "%" },
  "attack-percent": { label: "공격력/마력%", unit: "%" },
  "boss-damage": { label: "보스 데미지", unit: "%" },
  "ignore-defense": { label: "방어율 무시", unit: "%" },
  "critical-damage": { label: "크리티컬 데미지", unit: "%" },
  cooldown: { label: "재사용 대기시간 감소", unit: "초" },
  meso: { label: "메소 획득량", unit: "%" },
  drop: { label: "아이템 드롭률", unit: "%" },
};

// 웹 계산기는 실제 잠재 옵션을 고르는 흐름이라 기존 봇용 목표와 분리한다.
// 같은 계산 코어를 쓰되, 봇의 명령 선택지가 갑자기 바뀌지 않게 하기 위함이다.
export const POTENTIAL_PAGE_TARGETS = {
  "stat-equivalent": { label: "주스탯%급", unit: "%급" },
  "str-percent": { label: "STR %", unit: "%" },
  "dex-percent": { label: "DEX %", unit: "%" },
  "int-percent": { label: "INT %", unit: "%" },
  "luk-percent": { label: "LUK %", unit: "%" },
  "hp-percent": { label: "HP %", unit: "%" },
  "all-stat-percent": { label: "올스탯 %", unit: "%" },
  "str-flat": { label: "STR", unit: "" },
  "dex-flat": { label: "DEX", unit: "" },
  "int-flat": { label: "INT", unit: "" },
  "luk-flat": { label: "LUK", unit: "" },
  "all-stat-flat": { label: "올스탯", unit: "" },
  "str-per-nine": { label: "캐릭터 기준 9레벨 당 STR", unit: "" },
  "dex-per-nine": { label: "캐릭터 기준 9레벨 당 DEX", unit: "" },
  "int-per-nine": { label: "캐릭터 기준 9레벨 당 INT", unit: "" },
  "luk-per-nine": { label: "캐릭터 기준 9레벨 당 LUK", unit: "" },
  "hp-flat": { label: "HP", unit: "" },
  "attack-power-percent": { label: "공격력 %", unit: "%" },
  "magic-power-percent": { label: "마력 %", unit: "%" },
  "attack-power-flat": { label: "공격력", unit: "" },
  "magic-power-flat": { label: "마력", unit: "" },
  damage: { label: "데미지 %", unit: "%" },
  "boss-damage": { label: "보스 공격 시 데미지 %", unit: "%" },
  "ignore-defense": { label: "몬스터 방어율 무시 %", unit: "%" },
  "critical-rate": { label: "크리티컬 확률 %", unit: "%" },
  "critical-damage": { label: "크리티컬 데미지 %", unit: "%" },
  cooldown: { label: "재사용 대기시간 감소", unit: "초" },
  meso: { label: "메소 획득량 %", unit: "%" },
  drop: { label: "아이템 드롭률 %", unit: "%" },
  "auto-steal": { label: "공격 시 오토스틸", unit: "%" },
};

export const POTENTIAL_PARTS = {
  1: "무기",
  2: "엠블렘",
  3: "보조무기",
  4: "포스실드/소울링",
  5: "방패",
  6: "모자",
  7: "상의",
  8: "한벌옷",
  9: "하의",
  10: "신발",
  11: "장갑",
  12: "망토",
  13: "벨트",
  14: "어깨장식",
  15: "얼굴장식",
  16: "눈장식",
  17: "귀고리",
  18: "반지",
  19: "펜던트",
  20: "기계심장",
};

export const MAIN_STATS = ["STR", "DEX", "INT", "LUK"];

export const EXACT_POTENTIAL_TARGET_PREFIX = "exact-option:";

/** 공식 옵션 이름을 충돌 없는 동적 목표 ID로 바꾼다. */
export function encodeExactPotentialTargetType(optionName) {
  if (typeof optionName !== "string" || optionName.trim() === "") {
    throw new RangeError("정확 옵션 목표에는 비어 있지 않은 옵션 이름이 필요합니다.");
  }
  try {
    return `${EXACT_POTENTIAL_TARGET_PREFIX}${encodeURIComponent(optionName)}`;
  } catch {
    throw new RangeError("정확 옵션 목표 이름을 URI 형식으로 인코딩할 수 없습니다.");
  }
}

/** 동적 목표 ID를 공식 옵션 이름으로 되돌린다. 일반 목표 ID에는 null을 반환한다. */
export function decodeExactPotentialTargetType(targetType) {
  if (
    typeof targetType !== "string" ||
    !targetType.startsWith(EXACT_POTENTIAL_TARGET_PREFIX)
  ) {
    return null;
  }

  const encodedName = targetType.slice(EXACT_POTENTIAL_TARGET_PREFIX.length);
  if (encodedName === "") {
    throw new RangeError("정확 옵션 목표 ID에 옵션 이름이 없습니다.");
  }
  let optionName;
  try {
    optionName = decodeURIComponent(encodedName);
  } catch {
    throw new RangeError("정확 옵션 목표 ID의 URI 인코딩이 올바르지 않습니다.");
  }
  if (optionName.trim() === "") {
    throw new RangeError("정확 옵션 목표 ID에 옵션 이름이 없습니다.");
  }
  return optionName;
}

export const STAT_EQUIVALENCE = {
  flatMainStatToPercent: 0.11,
  attackToMainStat: 2.92,
  allStatPercentToMainPercent: 1.12,
  subStatPercentToMainPercent: 0.12,
  flatSubStatToFlatMainStat: 0.25,
  criticalDamageToMainPercent: 12.67 / 3,
};

const DEFAULT_SUB_STATS = {
  STR: "DEX",
  DEX: "STR",
  INT: "LUK",
  LUK: "DEX",
};

const OFFICIAL_ENDPOINT =
  "https://maplestory.nexon.com/Guide/OtherProbability/cube/GetSearchProbList";
const TABLE_CACHE = new Map();
const CACHE_DURATION = 6 * 60 * 60 * 1000;

export function getDefaultSubStat(mainStat) {
  return DEFAULT_SUB_STATS[mainStat] ?? null;
}

function normalizeSubStats(subStat, subStats) {
  const requested = Array.isArray(subStats) ? subStats : [subStat];
  return [...new Set(requested)].filter(
    (stat) => stat !== null && stat !== undefined && stat !== "none",
  );
}

function flatStatToFlatMainCoefficient({
  stat,
  mainStat,
  subStat,
  statEquivalence,
}) {
  if (stat === mainStat) return 1;
  const mapped = Number(
    statEquivalence?.flatStatToFlatMainStatByStat?.[stat],
  );
  if (Number.isFinite(mapped) && mapped > 0) return mapped;
  if (stat === subStat) {
    const legacy = Number(statEquivalence?.flatSubStatToFlatMainStat);
    if (Number.isFinite(legacy) && legacy > 0) return legacy;
  }
  return null;
}

function statPercentToMainPercentCoefficient({
  stat,
  mainStat,
  subStat,
  statEquivalence,
}) {
  if (stat === mainStat) return 1;
  const mapped = Number(
    statEquivalence?.statPercentToMainPercentByStat?.[stat],
  );
  if (Number.isFinite(mapped) && mapped > 0) return mapped;
  if (stat === subStat) {
    const legacy = Number(statEquivalence?.subStatPercentToMainPercent);
    if (Number.isFinite(legacy) && legacy > 0) return legacy;
  }
  return null;
}

export function getDefaultAttackType(mainStat) {
  return mainStat === "INT" ? "magic" : MAIN_STATS.includes(mainStat) ? "attack" : null;
}

function decodeHtml(value) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function parseOfficialPotentialTables(html) {
  const tables = [[], [], []];
  const tablePattern =
    /<table[^>]*class=["'][^"']*cube_data\s+_([123])[^"']*["'][^>]*>([\s\S]*?)<\/table>/gi;

  for (const tableMatch of html.matchAll(tablePattern)) {
    const lineIndex = Number(tableMatch[1]) - 1;
    const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;

    for (const rowMatch of tableMatch[2].matchAll(rowPattern)) {
      const cells = [
        ...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi),
      ].map((match) => decodeHtml(match[1]));

      if (cells.length < 2) {
        continue;
      }

      const probability = Number.parseFloat(cells.at(-1).replace("%", ""));
      if (cells[0] && Number.isFinite(probability) && probability > 0) {
        tables[lineIndex].push({ name: cells[0], probability });
      }
    }
  }

  if (tables.some((table) => table.length === 0)) {
    throw new Error("넥슨 공식 확률표의 형식이 변경되어 잠재 계산을 완료하지 못했습니다.");
  }
  return tables;
}

export async function fetchOfficialPotentialTables({
  system = "regular",
  method = "meso",
  tableSource,
  grade,
  part,
  itemLevel,
  fetchImpl = fetch,
}) {
  const systemInfo = POTENTIAL_SYSTEMS[system];
  const resolvedSource = tableSource ??
    getPotentialResetMethod(system, method).tableSource;
  const sourceInfo = POTENTIAL_TABLE_SOURCES[resolvedSource];
  const gradeInfo = POTENTIAL_GRADES[grade];
  if (
    !systemInfo ||
    !sourceInfo ||
    sourceInfo.system !== system ||
    !gradeInfo ||
    gradeIndex(grade) > gradeIndex(sourceInfo.maxGrade) ||
    !POTENTIAL_PARTS[part]
  ) {
    throw new RangeError("지원하지 않는 잠재 종류, 등급 또는 장비 부위입니다.");
  }
  if (!Number.isInteger(itemLevel) || itemLevel < 0 || itemLevel > 250) {
    throw new RangeError("장비 레벨은 0~250 사이로 입력해 주세요.");
  }

  const cacheKey = `${resolvedSource}:${grade}:${part}:${itemLevel}`;
  const cached = TABLE_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < CACHE_DURATION) {
    return cached.tables;
  }

  const body = new URLSearchParams({
    nCubeItemID: sourceInfo.cubeItemId,
    nGrade: String(gradeInfo.id),
    nPartsType: String(part),
    nReqLev: String(itemLevel),
  });

  let response;
  try {
    response = await fetchImpl(OFFICIAL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Referer: sourceInfo.officialPage,
        "User-Agent": "Maple-Discord-Bot/2.0",
        "X-Requested-With": "XMLHttpRequest",
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error(
      `넥슨 공식 ${sourceInfo.label} 확률표에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.`,
    );
  }

  if (!response.ok) {
    throw new Error(
      `넥슨 공식 ${sourceInfo.label} 확률표 조회에 실패했습니다. (HTTP ${response.status})`,
    );
  }

  const tables = parseOfficialPotentialTables(await response.text());
  TABLE_CACHE.set(cacheKey, { savedAt: Date.now(), tables });
  return tables;
}

function getRestriction(optionName) {
  if (optionName.includes("쓸만한")) {
    return { key: "decent-skill", max: 1 };
  }
  if (optionName.includes("피격 후 무적시간")) {
    return { key: "invincible-after-hit", max: 1 };
  }
  if (/피격 시 .*확률로 데미지의 .*무시/.test(optionName)) {
    return { key: "on-hit-defense", max: 2 };
  }
  if (/피격 시 .*확률로 .*무적/.test(optionName)) {
    return { key: "on-hit-defense", max: 2 };
  }
  return null;
}

function createMetrics() {
  return {
    statPercent: [0, 0, 0, 0],
    flatStat: [0, 0, 0, 0],
    perNineStat: [0, 0, 0, 0],
    allStatPercent: 0,
    maxHpPercent: 0,
    maxMpPercent: 0,
    flatAllStat: 0,
    flatHp: 0,
    flatMp: 0,
    attackPercent: 0,
    magicPercent: 0,
    flatAttack: 0,
    flatMagic: 0,
    bossDamage: 0,
    damage: 0,
    ignoreDefense: 0,
    criticalRate: 0,
    criticalDamage: 0,
    defensePercent: 0,
    flatDefense: 0,
    speed: 0,
    jump: 0,
    healingEfficiency: 0,
    mpCostReduction: 0,
    cooldown: 0,
    meso: 0,
    drop: 0,
    autoSteal: 0,
  };
}

function parseNumberMatch(optionName, pattern) {
  const match = optionName.match(pattern);
  return match ? Number(match.at(-1)) : 0;
}

export function parsePotentialOption(optionName) {
  const metrics = createMetrics();
  const perNineMatch =
    optionName.match(
      /(?:캐릭터 기준 )?9레벨 당 (STR|DEX|INT|LUK) \+(\d+(?:\.\d+)?)/,
    ) ??
    optionName.match(
      /^(STR|DEX|INT|LUK) \+(\d+(?:\.\d+)?) \(캐릭터 기준 9레벨 당\)/,
    );
  if (perNineMatch) {
    metrics.perNineStat[MAIN_STATS.indexOf(perNineMatch[1])] = Number(
      perNineMatch[2],
    );
    return metrics;
  }

  const statPercentMatch = optionName.match(
    /^(STR|DEX|INT|LUK) \+(\d+(?:\.\d+)?)%/,
  );
  if (statPercentMatch) {
    metrics.statPercent[MAIN_STATS.indexOf(statPercentMatch[1])] = Number(
      statPercentMatch[2],
    );
    return metrics;
  }

  const flatStatMatch = optionName.match(
    /^(STR|DEX|INT|LUK) \+(\d+(?:\.\d+)?)(?!%)/,
  );
  if (flatStatMatch) {
    metrics.flatStat[MAIN_STATS.indexOf(flatStatMatch[1])] = Number(
      flatStatMatch[2],
    );
    return metrics;
  }

  metrics.allStatPercent = parseNumberMatch(
    optionName,
    /^올스탯 \+(\d+(?:\.\d+)?)%/,
  );
  if (metrics.allStatPercent) return metrics;

  metrics.maxHpPercent = parseNumberMatch(
    optionName,
    /^최대 HP \+(\d+(?:\.\d+)?)%$/,
  );
  if (metrics.maxHpPercent) return metrics;

  metrics.maxMpPercent = parseNumberMatch(
    optionName,
    /^최대 MP \+(\d+(?:\.\d+)?)%$/,
  );
  if (metrics.maxMpPercent) return metrics;

  metrics.flatAllStat = parseNumberMatch(
    optionName,
    /^올스탯 \+(\d+(?:\.\d+)?)(?!%)/,
  );
  if (metrics.flatAllStat) return metrics;

  metrics.flatHp = parseNumberMatch(
    optionName,
    /^최대 HP \+(\d+(?:\.\d+)?)$/,
  );
  if (metrics.flatHp) return metrics;

  metrics.flatMp = parseNumberMatch(
    optionName,
    /^최대 MP \+(\d+(?:\.\d+)?)$/,
  );
  if (metrics.flatMp) return metrics;

  metrics.attackPercent = parseNumberMatch(
    optionName,
    /^공격력 \+(\d+(?:\.\d+)?)%/,
  );
  if (metrics.attackPercent) return metrics;

  metrics.magicPercent = parseNumberMatch(
    optionName,
    /^마력 \+(\d+(?:\.\d+)?)%/,
  );
  if (metrics.magicPercent) return metrics;

  metrics.flatAttack = parseNumberMatch(
    optionName,
    /^공격력 \+(\d+(?:\.\d+)?)(?!%)/,
  );
  if (metrics.flatAttack) return metrics;

  metrics.flatMagic = parseNumberMatch(
    optionName,
    /^마력 \+(\d+(?:\.\d+)?)(?!%)/,
  );
  if (metrics.flatMagic) return metrics;

  metrics.bossDamage = parseNumberMatch(
    optionName,
    /보스 몬스터(?: 공격 시)? 데미지(?: 증가)? \+(\d+(?:\.\d+)?)%/,
  );
  if (metrics.bossDamage) return metrics;

  metrics.damage = parseNumberMatch(
    optionName,
    /^데미지(?: 증가)? \+(\d+(?:\.\d+)?)%/,
  );
  if (metrics.damage) return metrics;

  metrics.ignoreDefense = parseNumberMatch(
    optionName,
    /몬스터 방어율 무시 \+(\d+(?:\.\d+)?)%/,
  );
  if (metrics.ignoreDefense) return metrics;

  metrics.criticalRate = parseNumberMatch(
    optionName,
    /크리티컬 확률 \+(\d+(?:\.\d+)?)%/,
  );
  if (metrics.criticalRate) return metrics;

  metrics.criticalDamage = parseNumberMatch(
    optionName,
    /크리티컬 데미지 \+(\d+(?:\.\d+)?)%/,
  );
  if (metrics.criticalDamage) return metrics;

  metrics.defensePercent = parseNumberMatch(
    optionName,
    /^방어력 \+(\d+(?:\.\d+)?)%$/,
  );
  if (metrics.defensePercent) return metrics;

  metrics.flatDefense = parseNumberMatch(
    optionName,
    /^방어력 \+(\d+(?:\.\d+)?)$/,
  );
  if (metrics.flatDefense) return metrics;

  metrics.speed = parseNumberMatch(
    optionName,
    /^이동속도 \+(\d+(?:\.\d+)?)$/,
  );
  if (metrics.speed) return metrics;

  metrics.jump = parseNumberMatch(
    optionName,
    /^점프력 \+(\d+(?:\.\d+)?)$/,
  );
  if (metrics.jump) return metrics;

  metrics.healingEfficiency = parseNumberMatch(
    optionName,
    /^HP 회복 아이템 및 회복 스킬 효율 \+(\d+(?:\.\d+)?)%$/,
  );
  if (metrics.healingEfficiency) return metrics;

  metrics.mpCostReduction = parseNumberMatch(
    optionName,
    /^모든 스킬의 MP 소모 -(\d+(?:\.\d+)?)%$/,
  );
  if (metrics.mpCostReduction) return metrics;

  metrics.cooldown = parseNumberMatch(
    optionName,
    /재사용 대기시간 -(\d+(?:\.\d+)?)초/,
  );
  if (metrics.cooldown) return metrics;

  metrics.meso = parseNumberMatch(
    optionName,
    /메소 획득량 \+(\d+(?:\.\d+)?)%/,
  );
  if (metrics.meso) return metrics;

  metrics.drop = parseNumberMatch(
    optionName,
    /아이템 드롭률 \+(\d+(?:\.\d+)?)%/,
  );
  if (metrics.drop) return metrics;

  metrics.autoSteal = parseNumberMatch(
    optionName,
    /^\s*공격\s*시\s*(\d+(?:\.\d+)?)%\s*확률로\s*오토스틸\s*$/,
  );
  return metrics;
}

const STAT_PERCENT_TARGETS = [
  "str-percent",
  "dex-percent",
  "int-percent",
  "luk-percent",
];
const STAT_PERCENT_TARGET_INDEX = Object.fromEntries(
  STAT_PERCENT_TARGETS.map((type, index) => [type, index]),
);
const FLAT_STAT_TARGETS = ["str-flat", "dex-flat", "int-flat", "luk-flat"];
const FLAT_STAT_TARGET_INDEX = Object.fromEntries(
  FLAT_STAT_TARGETS.map((type, index) => [type, index]),
);
const PER_NINE_STAT_TARGETS = [
  "str-per-nine",
  "dex-per-nine",
  "int-per-nine",
  "luk-per-nine",
];
const PER_NINE_STAT_TARGET_INDEX = Object.fromEntries(
  PER_NINE_STAT_TARGETS.map((type, index) => [type, index]),
);
const ADDITIONAL_ONLY_PAGE_TARGETS = new Set([
  ...FLAT_STAT_TARGETS,
  ...PER_NINE_STAT_TARGETS,
  "all-stat-flat",
  "hp-flat",
]);
const HAT_TARGETS = new Set([
  "stat-equivalent",
  ...STAT_PERCENT_TARGETS,
  "hp-percent",
  "all-stat-percent",
  "attack-power-flat",
  "magic-power-flat",
  "damage",
  "critical-rate",
  "cooldown",
]);

function isKnownPotentialTarget(targetType) {
  if (POTENTIAL_PAGE_TARGETS[targetType] ?? POTENTIAL_TARGETS[targetType]) {
    return true;
  }
  return decodeExactPotentialTargetType(targetType) !== null;
}

/** 선택한 공식 확률표와 부위에 실제로 필요한 웹 계산 목표만 돌려준다. */
export function getAvailablePotentialTargetTypes(
  tables,
  { part, system = "regular" } = {},
) {
  if (!Array.isArray(tables)) return [];
  const available = new Set();

  for (const option of tables.flat()) {
    if (!option || typeof option.name !== "string") continue;
    const metrics = parsePotentialOption(option.name);
    const hasAllStatPercent = metrics.allStatPercent > 0;
    const hasStatPercent =
      metrics.statPercent.some((value) => value > 0) || hasAllStatPercent;
    const hasNonCriticalEquivalent =
      hasStatPercent ||
      metrics.flatStat.some((value) => value > 0) ||
      metrics.perNineStat.some((value) => value > 0) ||
      metrics.flatAllStat > 0 ||
      metrics.flatAttack > 0 ||
      metrics.flatMagic > 0;
    const hasCriticalDamage = metrics.criticalDamage > 0;
    if (hasNonCriticalEquivalent || hasCriticalDamage) {
      available.add("stat-equivalent");
    }
    metrics.statPercent.forEach((value, index) => {
      // STR% 목표처럼 말할 때 올스탯%도 해당 스탯에 포함해 세는 관례를 따른다.
      if (value > 0 || hasAllStatPercent) {
        available.add(STAT_PERCENT_TARGETS[index]);
      }
    });
    metrics.flatStat.forEach((value, index) => {
      // 고정 스탯도 개별 스탯 목표에는 올스탯 고정 수치를 함께 합산한다.
      if (value > 0 || metrics.flatAllStat > 0) {
        available.add(FLAT_STAT_TARGETS[index]);
      }
    });
    metrics.perNineStat.forEach((value, index) => {
      if (value > 0) available.add(PER_NINE_STAT_TARGETS[index]);
    });
    if (metrics.maxHpPercent > 0) available.add("hp-percent");
    if (hasAllStatPercent) available.add("all-stat-percent");
    if (metrics.flatAllStat > 0) available.add("all-stat-flat");
    if (metrics.flatHp > 0) available.add("hp-flat");
    if (metrics.attackPercent > 0) available.add("attack-power-percent");
    if (metrics.magicPercent > 0) available.add("magic-power-percent");
    if (metrics.flatAttack > 0) available.add("attack-power-flat");
    if (metrics.flatMagic > 0) available.add("magic-power-flat");
    if (metrics.damage > 0) available.add("damage");
    if (metrics.bossDamage > 0) available.add("boss-damage");
    if (metrics.ignoreDefense > 0) available.add("ignore-defense");
    if (metrics.criticalRate > 0) available.add("critical-rate");
    if (hasCriticalDamage) available.add("critical-damage");
    if (metrics.cooldown > 0) available.add("cooldown");
    if (metrics.meso > 0) available.add("meso");
    if (metrics.drop > 0) available.add("drop");
    if (metrics.autoSteal > 0) available.add("auto-steal");
  }

  const numericTargets = Object.keys(POTENTIAL_PAGE_TARGETS).filter(
    (type) =>
      available.has(type) &&
      (system === "additional" || !ADDITIONAL_ONLY_PAGE_TARGETS.has(type)) &&
      (system === "additional" || Number(part) !== 6 || HAT_TARGETS.has(type)),
  );
  return numericTargets;
}

/** 목표 한 개의 기준값을 동등한 주스탯%와 공·마%로 바꾼다. */
export function convertPotentialTargetToEquivalents({
  targetType,
  target,
  statEquivalence = {},
  enemyDefense = 380,
  mainStat,
  subStat,
  subStats,
  attackType,
  characterLevel,
}) {
  const value = Number(target);
  if (!isKnownPotentialTarget(targetType) || !Number.isFinite(value) || value <= 0) {
    throw new RangeError("올바른 목표 종류와 0보다 큰 목표값을 입력해 주세요.");
  }

  const attackCoefficient = Number(
    statEquivalence.attackPercentToMainPercent,
  );
  let mainStatPercent = null;
  let attackPercent = null;
  const resolvedSubStats = normalizeSubStats(subStat, subStats);
  const flatMainStatCoefficient = Number(
    statEquivalence.flatMainStatToPercent,
  );

  function convertFlatStat(flatValue, targetStat) {
    if (
      !Number.isFinite(flatMainStatCoefficient) ||
      flatMainStatCoefficient <= 0
    ) {
      return null;
    }
    if (mainStat === targetStat) {
      return flatValue * flatMainStatCoefficient;
    }
    if (resolvedSubStats.includes(targetStat)) {
      const coefficient = flatStatToFlatMainCoefficient({
        stat: targetStat,
        mainStat,
        subStat: targetStat,
        statEquivalence,
      });
      if (coefficient !== null) {
        return flatValue * coefficient * flatMainStatCoefficient;
      }
    }
    return null;
  }

  if (
    [
      "stat-percent",
      "stat-equivalent",
      "stat-equivalent-no-crit",
      "boss-stat-equivalent",
    ].includes(targetType)
  ) {
    mainStatPercent = value;
  } else if (targetType in STAT_PERCENT_TARGET_INDEX) {
    const targetStat = MAIN_STATS[STAT_PERCENT_TARGET_INDEX[targetType]];
    if (mainStat === targetStat) {
      mainStatPercent = value;
    } else if (resolvedSubStats.includes(targetStat)) {
      const coefficient = statPercentToMainPercentCoefficient({
        stat: targetStat,
        mainStat,
        subStat: targetStat,
        statEquivalence,
      });
      if (coefficient !== null) {
        mainStatPercent = value * coefficient;
      }
    }
  } else if (targetType === "all-stat-percent") {
    const coefficient = Number(
      statEquivalence.allStatPercentToMainPercent,
    );
    if (Number.isFinite(coefficient) && coefficient > 0) {
      mainStatPercent = value * coefficient;
    }
  } else if (targetType in FLAT_STAT_TARGET_INDEX) {
    mainStatPercent = convertFlatStat(
      value,
      MAIN_STATS[FLAT_STAT_TARGET_INDEX[targetType]],
    );
  } else if (targetType === "all-stat-flat") {
    if (
      MAIN_STATS.includes(mainStat) &&
      Number.isFinite(flatMainStatCoefficient) &&
      flatMainStatCoefficient > 0
    ) {
      const subMultiplier = resolvedSubStats.reduce((sum, stat) => {
        const coefficient = flatStatToFlatMainCoefficient({
          stat,
          mainStat,
          subStat: stat,
          statEquivalence,
        });
        return sum + (coefficient ?? 0);
      }, 0);
      mainStatPercent =
        value * (1 + subMultiplier) * flatMainStatCoefficient;
    }
  } else if (targetType in PER_NINE_STAT_TARGET_INDEX) {
    const level = Number(characterLevel);
    if (Number.isInteger(level) && level >= 1 && level <= 300) {
      mainStatPercent = convertFlatStat(
        value * Math.floor(level / 9),
        MAIN_STATS[PER_NINE_STAT_TARGET_INDEX[targetType]],
      );
    }
  } else if (targetType === "attack-percent") {
    attackPercent = value;
    if (Number.isFinite(attackCoefficient) && attackCoefficient > 0) {
      mainStatPercent = value * attackCoefficient;
    }
  } else if (
    targetType === "attack-power-percent" ||
    targetType === "magic-power-percent"
  ) {
    const targetAttackType =
      targetType === "magic-power-percent" ? "magic" : "attack";
    // 개인 캐릭터의 공격 계열과 반대되는 옵션은 유효한 전투 환산값이 아니다.
    if (attackType === undefined || attackType === targetAttackType) {
      attackPercent = value;
      if (Number.isFinite(attackCoefficient) && attackCoefficient > 0) {
        mainStatPercent = value * attackCoefficient;
      }
    }
  } else if (
    targetType === "attack-power-flat" ||
    targetType === "magic-power-flat"
  ) {
    const targetAttackType =
      targetType === "magic-power-flat" ? "magic" : "attack";
    const flatAttackCoefficient = Number(statEquivalence.attackToMainStat);
    if (
      (attackType === undefined || attackType === targetAttackType) &&
      Number.isFinite(flatAttackCoefficient) &&
      flatAttackCoefficient > 0 &&
      Number.isFinite(flatMainStatCoefficient) &&
      flatMainStatCoefficient > 0
    ) {
      mainStatPercent =
        value * flatAttackCoefficient * flatMainStatCoefficient;
    }
  } else if (targetType === "boss-damage" || targetType === "damage") {
    const coefficient = Number(statEquivalence.bossDamageToMainPercent);
    if (Number.isFinite(coefficient) && coefficient > 0) {
      mainStatPercent = value * coefficient;
    }
  } else if (targetType === "critical-rate") {
    const coefficient = Number(statEquivalence.criticalRateToMainPercent);
    if (Number.isFinite(coefficient) && coefficient > 0) {
      mainStatPercent = value * coefficient;
    }
  } else if (targetType === "critical-damage") {
    const coefficient = Number(statEquivalence.criticalDamageToMainPercent);
    if (Number.isFinite(coefficient) && coefficient > 0) {
      mainStatPercent = value * coefficient;
    }
  } else if (targetType === "ignore-defense") {
    const currentIgnoreDefense = Number(
      statEquivalence.currentIgnoreDefense,
    );
    const oneMainPercentRelative = Number(
      statEquivalence.oneMainPercentRelative,
    );
    if (
      Number.isFinite(currentIgnoreDefense) &&
      currentIgnoreDefense >= 0 &&
      currentIgnoreDefense <= 1 &&
      Number.isFinite(oneMainPercentRelative) &&
      oneMainPercentRelative > 0 &&
      Number.isFinite(Number(enemyDefense)) &&
      Number(enemyDefense) > 0
    ) {
      mainStatPercent = calculateIgnoreDefenseEquivalent({
        currentIgnoreDefense,
        addedIgnoreDefense: value / 100,
        enemyDefense:
          Number(enemyDefense) / 100 *
          Number(statEquivalence.targetDefenseRemaining ?? 1),
        oneMainPercentRelative,
      });
    }
  }

  if (
    attackPercent === null &&
    Number.isFinite(mainStatPercent) &&
    Number.isFinite(attackCoefficient) &&
    attackCoefficient > 0
  ) {
    attackPercent = mainStatPercent / attackCoefficient;
  }

  return {
    mainStatPercent: Number.isFinite(mainStatPercent) ? mainStatPercent : null,
    attackPercent: Number.isFinite(attackPercent) ? attackPercent : null,
  };
}

function enrichTable(table) {
  return table.map((option) => ({
    ...option,
    metrics: parsePotentialOption(option.name),
    restriction: getRestriction(option.name),
  }));
}

/**
 * 아이템 큐브를 사용할 때 장비의 원래 요구 레벨에 따라 드는 감정 비용.
 * 통찰력으로 면제될 수 있는 비용은 사용자 상태에 의존하므로 여기서는
 * 기본 비용만 계산한다.
 */
export function getPotentialCubeRevealCost(itemLevel) {
  const level = Math.floor(Number(itemLevel));
  if (!Number.isFinite(level) || level < 0) {
    throw new RangeError("장비 레벨은 0 이상의 숫자여야 합니다.");
  }
  if (level <= 30) return 0;
  if (level <= 70) return Math.floor(0.5 * level ** 2);
  if (level <= 120) return Math.floor(2.5 * level ** 2);
  return 20 * level ** 2;
}

export function getPotentialResetCost(
  itemLevel,
  grade,
  system = "regular",
  method = "meso",
) {
  const currentGradeIndex = POTENTIAL_GRADE_ORDER.indexOf(grade);
  const resetMethod = getPotentialResetMethod(system, method);
  if (currentGradeIndex === -1 || !POTENTIAL_SYSTEMS[system]) {
    throw new RangeError("지원하지 않는 잠재 종류 또는 등급입니다.");
  }
  if (currentGradeIndex > gradeIndex(resetMethod.maxGrade) ||
      currentGradeIndex < gradeIndex(resetMethod.minGrade ?? "rare")) {
    throw new RangeError("선택한 등급에는 이 재설정 수단을 사용할 수 없습니다.");
  }
  if (resetMethod.revealCostVerified === false) return null;
  if (system === "soul") return [20_000_000, 40_000_000, 65_000_000, 88_000_000][currentGradeIndex];
  if (!resetMethod.usesMeso) return getPotentialCubeRevealCost(itemLevel);

  const costTable =
    system === "additional"
      ? itemLevel <= 159
        ? [9_750_000, 27_300_000, 66_300_000, 78_000_000]
        : itemLevel <= 199
          ? [10_375_000, 29_050_000, 70_550_000, 83_000_000]
          : itemLevel <= 249
            ? [11_000_000, 30_800_000, 74_800_000, 88_000_000]
            : [12_250_000, 34_300_000, 83_300_000, 98_000_000]
      : itemLevel <= 159
        ? [4_000_000, 16_000_000, 34_000_000, 40_000_000]
        : itemLevel <= 199
          ? [4_250_000, 17_000_000, 36_125_000, 42_500_000]
          : itemLevel <= 249
            ? [4_500_000, 18_000_000, 38_250_000, 45_000_000]
            : [5_000_000, 20_000_000, 42_500_000, 50_000_000];
  return costTable[currentGradeIndex];
}

function addMetrics(state, metrics, optionName) {
  const exactOptionCounts = new Map(state.exactOptionCounts);
  if (typeof optionName === "string") {
    exactOptionCounts.set(
      optionName,
      (exactOptionCounts.get(optionName) ?? 0) + 1,
    );
  }
  return {
    statPercent: state.statPercent.map(
      (value, index) => value + metrics.statPercent[index],
    ),
    flatStat: state.flatStat.map(
      (value, index) => value + metrics.flatStat[index],
    ),
    perNineStat: state.perNineStat.map(
      (value, index) => value + metrics.perNineStat[index],
    ),
    allStatPercent: state.allStatPercent + metrics.allStatPercent,
    maxHpPercent: state.maxHpPercent + metrics.maxHpPercent,
    maxMpPercent: state.maxMpPercent + metrics.maxMpPercent,
    flatAllStat: state.flatAllStat + metrics.flatAllStat,
    flatHp: state.flatHp + metrics.flatHp,
    flatMp: state.flatMp + metrics.flatMp,
    attackPercent: state.attackPercent + metrics.attackPercent,
    magicPercent: state.magicPercent + metrics.magicPercent,
    flatAttack: state.flatAttack + metrics.flatAttack,
    flatMagic: state.flatMagic + metrics.flatMagic,
    bossDamage: state.bossDamage + metrics.bossDamage,
    damage: state.damage + metrics.damage,
    ignoreDefenseRemaining:
      state.ignoreDefenseRemaining * (1 - metrics.ignoreDefense / 100),
    criticalRate: state.criticalRate + metrics.criticalRate,
    criticalDamage: state.criticalDamage + metrics.criticalDamage,
    defensePercent: state.defensePercent + metrics.defensePercent,
    flatDefense: state.flatDefense + metrics.flatDefense,
    speed: state.speed + metrics.speed,
    jump: state.jump + metrics.jump,
    healingEfficiency:
      state.healingEfficiency + metrics.healingEfficiency,
    mpCostReduction: state.mpCostReduction + metrics.mpCostReduction,
    cooldown: state.cooldown + metrics.cooldown,
    meso: state.meso + metrics.meso,
    drop: state.drop + metrics.drop,
    autoSteal: state.autoSteal + metrics.autoSteal,
    exactOptionCounts,
  };
}

function createState() {
  return {
    ...createMetrics(),
    ignoreDefenseRemaining: 1,
    exactOptionCounts: new Map(),
  };
}

function getStatEquivalentScore({
  state,
  mainStat,
  subStat,
  subStats,
  attackType,
  characterLevel,
  includeCriticalDamage = true,
  statEquivalence = STAT_EQUIVALENCE,
}) {
  if (mainStat === "ALL") {
    const levelGroups = Math.floor(characterLevel / 9);
    const statPercentCoefficients =
      statEquivalence?.statPercentToMainPercentByStat ?? {};
    const flatStatCoefficients =
      statEquivalence?.flatStatToMainPercentByStat ?? {};
    const xenonStats = ["STR", "DEX", "LUK"];
    const statEquivalent = xenonStats.reduce((total, stat) => {
      const index = MAIN_STATS.indexOf(stat);
      const percentCoefficient = Number(statPercentCoefficients[stat]);
      const flatCoefficient = Number(flatStatCoefficients[stat]);
      const flatValue =
        state.flatStat[index] +
        state.flatAllStat +
        state.perNineStat[index] * levelGroups;
      return total +
        state.statPercent[index] * percentCoefficient +
        flatValue * flatCoefficient;
    }, 0);
    const relevantFlatAttack =
      attackType === "magic" ? state.flatMagic : state.flatAttack;
    return (
      statEquivalent +
      state.allStatPercent * statEquivalence.allStatPercentToMainPercent +
      relevantFlatAttack * statEquivalence.flatAttackToMainPercent +
      (includeCriticalDamage
        ? state.criticalDamage *
          statEquivalence.criticalDamageToMainPercent
        : 0)
    );
  }
  const mainIndex = MAIN_STATS.indexOf(mainStat);
  const resolvedSubStats = normalizeSubStats(subStat, subStats);
  const levelGroups = Math.floor(characterLevel / 9);
  const flatMain =
    state.flatStat[mainIndex] +
    state.flatAllStat +
    state.perNineStat[mainIndex] * levelGroups;
  const flatSubEquivalent = resolvedSubStats.reduce((sum, stat) => {
    const subIndex = MAIN_STATS.indexOf(stat);
    if (subIndex === -1) return sum;
    const coefficient = flatStatToFlatMainCoefficient({
      stat,
      mainStat,
      subStat: stat,
      statEquivalence,
    });
    if (coefficient === null) return sum;
    const flatSub =
      state.flatStat[subIndex] +
      state.flatAllStat +
      state.perNineStat[subIndex] * levelGroups;
    return sum + flatSub * coefficient;
  }, 0);
  const relevantFlatAttack =
    attackType === "magic" ? state.flatMagic : state.flatAttack;
  const flatMainEquivalent =
    flatMain +
    flatSubEquivalent +
    relevantFlatAttack * statEquivalence.attackToMainStat;

  const subStatPercentEquivalent = resolvedSubStats.reduce((sum, stat) => {
    const subIndex = MAIN_STATS.indexOf(stat);
    if (subIndex === -1) return sum;
    const coefficient = statPercentToMainPercentCoefficient({
      stat,
      mainStat,
      subStat: stat,
      statEquivalence,
    });
    return sum + state.statPercent[subIndex] * (coefficient ?? 0);
  }, 0);

  return (
    state.statPercent[mainIndex] +
    subStatPercentEquivalent +
    state.allStatPercent * statEquivalence.allStatPercentToMainPercent +
    flatMainEquivalent * statEquivalence.flatMainStatToPercent +
    (includeCriticalDamage
      ? state.criticalDamage *
        statEquivalence.criticalDamageToMainPercent
      : 0)
  );
}

function getBossStatEquivalentScore({
  state,
  mainStat,
  subStat,
  subStats,
  attackType,
  characterLevel,
  statEquivalence,
  enemyDefense,
}) {
  const relevantAttackPercent =
    attackType === "magic" ? state.magicPercent : state.attackPercent;
  const addedIgnoreDefense = 1 - state.ignoreDefenseRemaining;
  const ignoreDefenseScore = calculateIgnoreDefenseEquivalent({
    currentIgnoreDefense: statEquivalence.currentIgnoreDefense,
    addedIgnoreDefense,
    enemyDefense:
      enemyDefense / 100 *
      Number(statEquivalence.targetDefenseRemaining ?? 1),
    oneMainPercentRelative: statEquivalence.oneMainPercentRelative,
  });
  if (ignoreDefenseScore === null) {
    throw new Error("선택한 적 방어율에서 방어율 무시 환산을 계산하지 못했습니다.");
  }

  return (
    getStatEquivalentScore({
      state,
      mainStat,
      subStat,
      subStats,
      attackType,
      characterLevel,
      includeCriticalDamage: true,
      statEquivalence,
    }) +
    relevantAttackPercent * statEquivalence.attackPercentToMainPercent +
    (state.bossDamage + state.damage) *
      statEquivalence.bossDamageToMainPercent +
    ignoreDefenseScore
  );
}

function getTargetScore({
  state,
  targetType,
  mainStat,
  subStat,
  subStats,
  attackType,
  characterLevel,
  statEquivalence,
  enemyDefense,
}) {
  if (targetType in STAT_PERCENT_TARGET_INDEX) {
    return (
      state.statPercent[STAT_PERCENT_TARGET_INDEX[targetType]] +
      state.allStatPercent
    );
  }
  if (targetType === "hp-percent") return state.maxHpPercent;
  if (targetType === "mp-percent") return state.maxMpPercent;
  if (targetType === "all-stat-percent") return state.allStatPercent;
  if (targetType in FLAT_STAT_TARGET_INDEX) {
    return (
      state.flatStat[FLAT_STAT_TARGET_INDEX[targetType]] +
      state.flatAllStat
    );
  }
  if (targetType === "all-stat-flat") return state.flatAllStat;
  if (targetType in PER_NINE_STAT_TARGET_INDEX) {
    return state.perNineStat[PER_NINE_STAT_TARGET_INDEX[targetType]];
  }
  if (targetType === "hp-flat") return state.flatHp;
  if (targetType === "mp-flat") return state.flatMp;
  if (targetType === "stat-percent") {
    if (mainStat === "ALL") return state.allStatPercent;
    if (mainStat === "ANY") {
      return Math.max(...state.statPercent) + state.allStatPercent;
    }
    return state.statPercent[MAIN_STATS.indexOf(mainStat)] + state.allStatPercent;
  }
  if (
    targetType === "stat-equivalent" ||
    targetType === "stat-equivalent-no-crit"
  ) {
    return getStatEquivalentScore({
      state,
      mainStat,
      subStat,
      subStats,
      attackType,
      characterLevel,
      includeCriticalDamage: targetType === "stat-equivalent",
      statEquivalence,
    });
  }
  if (targetType === "boss-stat-equivalent") {
    return getBossStatEquivalentScore({
      state,
      mainStat,
      subStat,
      subStats,
      attackType,
      characterLevel,
      statEquivalence,
      enemyDefense,
    });
  }
  if (targetType === "attack-percent") {
    return attackType === "magic" ? state.magicPercent : state.attackPercent;
  }
  if (targetType === "attack-power-percent") return state.attackPercent;
  if (targetType === "magic-power-percent") return state.magicPercent;
  if (targetType === "attack-power-flat") return state.flatAttack;
  if (targetType === "magic-power-flat") return state.flatMagic;
  if (targetType === "damage") return state.damage;
  if (targetType === "boss-damage") return state.bossDamage;
  if (targetType === "ignore-defense") {
    return (1 - state.ignoreDefenseRemaining) * 100;
  }
  if (targetType === "critical-rate") return state.criticalRate;
  if (targetType === "critical-damage") return state.criticalDamage;
  if (targetType === "defense-percent") return state.defensePercent;
  if (targetType === "defense-flat") return state.flatDefense;
  if (targetType === "speed") return state.speed;
  if (targetType === "jump") return state.jump;
  if (targetType === "healing-efficiency") return state.healingEfficiency;
  if (targetType === "mp-cost-reduction") return state.mpCostReduction;
  if (targetType === "cooldown") return state.cooldown;
  if (targetType === "meso") return state.meso;
  if (targetType === "drop") return state.drop;
  if (targetType === "auto-steal") return state.autoSteal;
  const exactOptionName = decodeExactPotentialTargetType(targetType);
  if (exactOptionName !== null) {
    return state.exactOptionCounts.get(exactOptionName) ?? 0;
  }
  throw new RangeError("지원하지 않는 잠재 목표입니다.");
}

/**
 * 메이플의 올스탯은 네 개의 개별 스탯에 동시에 더해진다. 목표 조합도 실제
 * 결과와 같은 방식으로 펼쳐야 한다. 예를 들어 `INT 7% + 올스탯 6%`는
 * INT 13%, STR/DEX/LUK 각각 6%를 요구한다.
 */
function expandAllStatTargetConditions(conditions) {
  const expanded = conditions
    .filter(
      ({ targetType }) =>
        targetType !== "all-stat-percent" && targetType !== "all-stat-flat",
    )
    .map((condition) => ({ ...condition }));

  function addStatTargets(targetTypes, target) {
    for (const targetType of targetTypes) {
      const existing = expanded.find(
        (condition) => condition.targetType === targetType,
      );
      if (existing) {
        existing.target = Number(existing.target) + target;
      } else {
        expanded.push({ targetType, target });
      }
    }
  }

  for (const condition of conditions) {
    const target = Number(condition.target);
    if (condition.targetType === "all-stat-percent") {
      addStatTargets(STAT_PERCENT_TARGETS, target);
    } else if (condition.targetType === "all-stat-flat") {
      addStatTargets(FLAT_STAT_TARGETS, target);
    }
  }

  return expanded;
}

function validateCalculationOptions({
  target,
  targetType,
  mainStat,
  subStat,
  subStats,
  attackType,
  characterLevel,
  statEquivalence,
  enemyDefense,
}) {
  if (!Number.isFinite(target) || target <= 0 || !isKnownPotentialTarget(targetType)) {
    throw new RangeError("올바른 목표 종류와 0보다 큰 목표값을 입력해 주세요.");
  }
  if (
    decodeExactPotentialTargetType(targetType) !== null &&
    (!Number.isSafeInteger(target) || target > 3)
  ) {
    throw new RangeError("정확 옵션 목표의 최소 줄 수는 1~3 사이 정수여야 합니다.");
  }
  if (
    targetType === "stat-percent" &&
    ![...MAIN_STATS, "ALL", "ANY"].includes(mainStat)
  ) {
    throw new RangeError("주스탯% 목표는 기준 주스탯을 선택해 주세요.");
  }
  if (
    targetType === "stat-equivalent" ||
    targetType === "stat-equivalent-no-crit" ||
    targetType === "boss-stat-equivalent"
  ) {
    const xenonEquivalent = mainStat === "ALL" &&
      ["STR", "DEX", "LUK"].every((stat) =>
        Number.isFinite(
          statEquivalence?.statPercentToMainPercentByStat?.[stat],
        ) &&
        Number.isFinite(
          statEquivalence?.flatStatToMainPercentByStat?.[stat],
        )
      ) &&
      Number.isFinite(statEquivalence?.flatAttackToMainPercent) &&
      Number.isFinite(statEquivalence?.allStatPercentToMainPercent);
    if (!MAIN_STATS.includes(mainStat) && !xenonEquivalent) {
      throw new RangeError("주스탯 %급은 STR/DEX/INT/LUK 중 하나를 선택해 주세요.");
    }
    if (subStats !== undefined && !Array.isArray(subStats)) {
      throw new RangeError("부스탯 목록은 배열로 전달해 주세요.");
    }
    const resolvedSubStats = normalizeSubStats(subStat, subStats);
    if (
      resolvedSubStats.some(
        (stat) => !MAIN_STATS.includes(stat) || stat === mainStat,
      )
    ) {
      throw new RangeError("부스탯은 STR/DEX/INT/LUK 또는 없음으로 골라 주세요.");
    }
    if (!Number.isInteger(characterLevel) || characterLevel < 1 || characterLevel > 300) {
      throw new RangeError("주스탯 %급 계산에는 1~300 사이의 캐릭터 레벨이 필요합니다.");
    }
  }
  if (targetType === "boss-stat-equivalent") {
    for (const key of [
      "attackPercentToMainPercent",
      "bossDamageToMainPercent",
      "oneMainPercentRelative",
    ]) {
      if (!Number.isFinite(statEquivalence?.[key]) || statEquivalence[key] <= 0) {
        throw new Error("보스 환산에는 API로 계산한 개인 환산값이 필요합니다.");
      }
    }
    if (
      !Number.isFinite(statEquivalence?.currentIgnoreDefense) ||
      statEquivalence.currentIgnoreDefense < 0 ||
      statEquivalence.currentIgnoreDefense > 1
    ) {
      throw new Error("보스 환산에는 현재 방어율 무시 정보가 필요합니다.");
    }
    if (!Number.isFinite(enemyDefense) || enemyDefense <= 0) {
      throw new RangeError("적 방어율은 0보다 큰 백분율로 입력해 주세요.");
    }
    const defenseMultiplier =
      1 - (enemyDefense / 100) * (1 - statEquivalence.currentIgnoreDefense);
    if (defenseMultiplier <= 0) {
      throw new RangeError(
        "현재 방어율 무시로는 선택한 적 방어율을 뚫지 못해 보스 환산을 계산할 수 없습니다.",
      );
    }
  }
  if (
    [
      "stat-equivalent",
      "stat-equivalent-no-crit",
      "boss-stat-equivalent",
      "attack-percent",
    ].includes(targetType) &&
    !["attack", "magic"].includes(attackType)
  ) {
    throw new RangeError("공격력 또는 마력 계열을 선택해 주세요.");
  }
}

/**
 * 잠재 옵션 조합을 현재 캐릭터 기준 주스탯 %급으로 환산한다.
 * 전체 세 줄 판정과 같은 파서·누적·환산식을 사용한다.
 */
export function calculatePotentialOptionsStatEquivalent({
  optionNames,
  mainStat,
  subStat = getDefaultSubStat(mainStat),
  subStats,
  attackType = getDefaultAttackType(mainStat),
  characterLevel,
  statEquivalence = STAT_EQUIVALENCE,
  includeCriticalDamage = true,
}) {
  if (
    !Array.isArray(optionNames) ||
    optionNames.length === 0 ||
    optionNames.some((name) => typeof name !== "string" || name.trim() === "")
  ) {
    throw new RangeError("환산할 잠재 옵션 이름을 하나 이상 입력해 주세요.");
  }
  if (subStat === "none") subStat = null;
  validateCalculationOptions({
    target: 1,
    targetType: includeCriticalDamage
      ? "stat-equivalent"
      : "stat-equivalent-no-crit",
    mainStat,
    subStat,
    subStats,
    attackType,
    characterLevel,
    statEquivalence,
  });
  const state = optionNames.reduce(
    (current, optionName) =>
      addMetrics(current, parsePotentialOption(optionName), optionName),
    createState(),
  );
  const score = getStatEquivalentScore({
    state,
    mainStat,
    subStat,
    subStats,
    attackType,
    characterLevel,
    includeCriticalDamage,
    statEquivalence,
  });
  if (!Number.isFinite(score)) {
    throw new Error("주스탯 %급 환산값을 계산하지 못했습니다.");
  }
  return score;
}

/** 공식 잠재 옵션 한 줄을 현재 캐릭터 기준 주스탯 %급으로 환산한다. */
export function calculatePotentialOptionStatEquivalent(options) {
  return calculatePotentialOptionsStatEquivalent({
    ...options,
    optionNames: [options?.optionName],
  });
}

/**
 * 목표를 만족하는 실제 옵션 조합을 표시용으로 열거한다.
 * 확률 계산과 같은 누적·목표 확장·중복 제한을 사용한다. 목표에 기여하지
 * 않는 줄은 생략하며, 성공한 조합에 유효 옵션이 더 붙는 상위 조합도 남긴다.
 * 프라임의 표시에는 호출자가 고정 첫 줄을 제외한 두 줄 표를 전달한다.
 */
export function getPotentialSuccessCombinations({
  tables,
  targets,
  mainStat,
  subStat = getDefaultSubStat(mainStat),
  subStats,
  attackType = getDefaultAttackType(mainStat),
  characterLevel,
  statEquivalence = STAT_EQUIVALENCE,
  enemyDefense = 380,
  limit = 100,
  sortDirection = "asc",
}) {
  const context = {
    mainStat, subStat: subStat === "none" ? null : subStat, subStats,
    attackType, characterLevel, statEquivalence, enemyDefense,
  };
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new RangeError("하나 이상의 성공 조건이 필요합니다.");
  }
  for (const condition of targets) validateCalculationOptions({ ...context, ...condition });
  const conditions = expandAllStatTargetConditions(targets);
  const scoresFor = (state) => conditions.map(({ targetType }) =>
    getTargetScore({ ...context, state, targetType })
  );
  const compareScores = (left, right) => {
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return left[index] - right[index];
    }
    return 0;
  };
  const compareNames = (left, right) => left.localeCompare(right, "ko");
  const lines = tables.map((line) => {
    const seen = new Set();
    return enrichTable(line.filter((option) => {
      if (!(option.probability > 0) || seen.has(option.name)) return false;
      seen.add(option.name);
      return true;
    })).map((option) => ({
      ...option,
      scores: scoresFor(addMetrics(createState(), option.metrics, option.name)),
    })).filter(({ scores }) => scores.some((score) => score > Number.EPSILON));
  });
  const combinations = new Map();
  function visit(lineIndex, state, restrictions, options) {
    if (lineIndex === lines.length) {
      if (!options.length) return;
      const scores = scoresFor(state);
      if (!conditions.every(({ target }, index) => scores[index] + Number.EPSILON >= target)) return;
      const names = options.map(({ name }) => name).toSorted(compareNames);
      const key = JSON.stringify(names);
      if (combinations.has(key)) return;
      combinations.set(key, {
        options: options.toSorted((left, right) =>
          compareScores(right.scores, left.scores) || compareNames(left.name, right.name)
        ).map(({ name }) => ({ name })),
        scores,
        nameKey: names.join("\u0000"),
      });
      return;
    }
    visit(lineIndex + 1, state, restrictions, options);
    for (const option of lines[lineIndex]) {
      const restriction = option.restriction;
      if (restriction && (restrictions[restriction.key] ?? 0) >= restriction.max) continue;
      visit(
        lineIndex + 1,
        addMetrics(state, option.metrics, option.name),
        restriction
          ? { ...restrictions, [restriction.key]: (restrictions[restriction.key] ?? 0) + 1 }
          : restrictions,
        [...options, option],
      );
    }
  }
  visit(0, createState(), {}, []);
  const direction = sortDirection === "desc" ? -1 : 1;
  const ordered = [...combinations.values()].toSorted((left, right) =>
    direction * compareScores(left.scores, right.scores) ||
    left.options.length - right.options.length ||
    compareNames(left.nameKey, right.nameKey)
  );
  const maximum = Number.isFinite(Number(limit)) ? Math.max(0, Math.floor(Number(limit))) : 100;
  const visible = ordered.slice(0, maximum).map(({ nameKey, ...combination }) => combination);
  return {
    conditions,
    combinations: visible,
    totalCount: ordered.length,
    hiddenCount: ordered.length - visible.length,
    truncated: ordered.length > visible.length,
  };
}

/** 1회 성공 확률로 목표 누적 확률에 도달하는 최소 재설정 횟수를 계산한다. */
export function calculateResetsForChance(probability, chance) {
  const successProbability = Number(probability);
  const targetChance = Number(chance);
  if (
    !Number.isFinite(successProbability) ||
    successProbability < 0 ||
    successProbability > 1
  ) {
    throw new RangeError("1회 성공 확률은 0 이상 1 이하여야 합니다.");
  }
  if (!Number.isFinite(targetChance) || targetChance <= 0 || targetChance >= 1) {
    throw new RangeError("목표 누적 확률은 0보다 크고 1보다 작아야 합니다.");
  }
  if (successProbability <= 0) return Infinity;
  if (successProbability >= 1) return 1;
  return Math.ceil(
    Math.log1p(-targetChance) / Math.log1p(-successProbability),
  );
}

/** 프라임 큐브의 고정 첫 줄도 전체 목표와 중복 제한에 참여한다. */
export function getFixedFirstPotentialTables(tables, fixedFirstOption) {
  const option = tables?.[0]?.find((entry) => entry.name === fixedFirstOption);
  if (!option) throw new RangeError("현재 첫 번째 옵션을 입력해 주세요.");
  return [[{ ...option, probability: 1 }], ...tables.slice(1)];
}

export function calculatePotentialExpected({
  tables,
  fixedFirstOption = null,
  lineTargets = null,
  lineTargetSets = null,
  ignoreFirstLine = false,
  target,
  targetType = "stat-percent",
  targets,
  targetSets,
  mainStat,
  subStat = getDefaultSubStat(mainStat),
  subStats,
  attackType = getDefaultAttackType(mainStat),
  characterLevel,
  itemLevel,
  grade,
  system = "regular",
  resetMethod = "meso",
  statEquivalence = STAT_EQUIVALENCE,
  enemyDefense = 380,
}) {
  if (subStat === "none") subStat = null;
  let rawConditionSets;
  const lineConditionSets = lineTargets !== null ? [lineTargets] : lineTargetSets;
  if (lineConditionSets !== null) {
    if (!Array.isArray(lineConditionSets) || !lineConditionSets.length || lineConditionSets.some((set) =>
      !Array.isArray(set) || set.length !== 2 || !set.some(Boolean))) {
      throw new RangeError("둘째·셋째 줄에 하나 이상의 목표를 입력해 주세요.");
    }
    rawConditionSets = lineConditionSets.map((set) => set.filter(Boolean));
  } else if (targetSets !== undefined) {
    if (!Array.isArray(targetSets) || !targetSets.length) {
      throw new RangeError("하나 이상의 옵션 세트를 입력해 주세요.");
    }
    rawConditionSets = targetSets.map((set) =>
      Array.isArray(set) ? set : set?.targets,
    );
    if (rawConditionSets.some((set) => !Array.isArray(set) || !set.length)) {
      throw new RangeError("각 옵션 세트에는 하나 이상의 조건이 필요합니다.");
    }
  } else {
    rawConditionSets = [
      targets?.length ? targets : [{ target, targetType }],
    ];
  }
  for (const conditions of rawConditionSets) {
    for (const condition of conditions) {
      validateCalculationOptions({
        target: condition.target,
        targetType: condition.targetType,
        mainStat,
        subStat,
        subStats,
        attackType,
        characterLevel,
        statEquivalence,
        enemyDefense,
      });
    }
  }
  const conditionSets = rawConditionSets.map(expandAllStatTargetConditions);

  const methodConfig = getPotentialResetMethod(system, resetMethod);
  if (methodConfig.fixedFirstLine && grade !== "legendary") {
    throw new RangeError("프라임 큐브는 레전드리 등급에만 사용할 수 있습니다.");
  }
  const effectiveTables = methodConfig.fixedFirstLine
    ? getFixedFirstPotentialTables(tables, fixedFirstOption)
    : tables;
  const enriched = effectiveTables.map(enrichTable);
  let successProbability = 0;
  let totalProbability = 0;
  let failureRepeatWeight = 0;
  let failureCollision = 0;

  function visit(lineIndex, probability, state, restrictions, lineMatches = lineConditionSets?.map(() => true)) {
    if (lineIndex === enriched.length) {
      totalProbability += probability;
      const success = lineConditionSets ? lineMatches.some(Boolean) : conditionSets.some((conditions) => {
        const scores = new Map();
        return conditions.every((condition) => {
          if (!scores.has(condition.targetType)) {
            scores.set(
              condition.targetType,
              getTargetScore({
                state,
                targetType: condition.targetType,
                mainStat,
                subStat,
                subStats,
                attackType,
                characterLevel,
                statEquivalence,
                enemyDefense,
              }),
            );
          }
          return scores.get(condition.targetType) + Number.EPSILON >= condition.target;
        });
      });
      if (success) successProbability += probability;
      else if (probability > 0 && probability < 1) {
        failureRepeatWeight += probability / (1 - probability);
        failureCollision += probability ** 2;
      }
      return;
    }

    const available = enriched[lineIndex].filter((option) => {
      if (!option.restriction) return true;
      return (
        (restrictions[option.restriction.key] ?? 0) < option.restriction.max
      );
    });
    const availableWeight = available.reduce(
      (sum, option) => sum + option.probability,
      0,
    );

    for (const option of available) {
      const nextRestrictions = { ...restrictions };
      if (option.restriction) {
        nextRestrictions[option.restriction.key] =
          (nextRestrictions[option.restriction.key] ?? 0) + 1;
      }
      visit(
        lineIndex + 1,
        probability * (option.probability / availableWeight),
        ignoreFirstLine && lineIndex === 0 ? state : addMetrics(state, option.metrics, option.name),
        nextRestrictions,
        lineConditionSets?.map((conditions, index) => {
          const condition = conditions[lineIndex - 1];
          return lineMatches[index] && (!condition || getTargetScore({
            state: addMetrics(createState(), option.metrics, option.name),
            targetType: condition.targetType,
            mainStat, subStat, subStats, attackType, characterLevel, statEquivalence, enemyDefense,
          }) + Number.EPSILON >= condition.target);
        }),
      );
    }
  }

  visit(0, 1, createState(), {});
  const rawProbability =
    totalProbability > 0 ? successProbability / totalProbability : 0;
  let probability = adjustedNextResultProbability({
    successProbability: rawProbability,
    failureRepeatWeight,
  });
  const resetCost = getPotentialResetCost(
    itemLevel,
    grade,
    system,
    resetMethod,
  );
  const averageCurrentResult = methodConfig.fixedFirstLine || system === "soul";
  const expectedResets = averageCurrentResult && rawProbability > 0
    ? (1 - (rawProbability < 1 ? failureCollision / totalProbability ** 2 / (1 - rawProbability) : 0)) / rawProbability
    : probability > 0 ? 1 / probability : Infinity;
  if (averageCurrentResult) probability = expectedResets > 0 ? Math.min(1, 1 / expectedResets) : rawProbability;
  const expectedCost = resetCost === null ? null
    : Number.isFinite(expectedResets) ? expectedResets * resetCost : Infinity;

  return {
    probability,
    rawProbability,
    averageCurrentResult,
    sameResultExcluded: true,
    expectedResets,
    expectedCost,
    resetCost,
    resets50: calculateResetsForChance(probability, 0.5),
    resets95: calculateResetsForChance(probability, 0.95),
  };
}

/**
 * First-line-free Prime UI: aggregate targets apply to the second and third lines.
 * Explicit lineTargets/lineTargetSets remain available for line-specific callers.
 * Unknown fixed first lines are grouped by their official duplicate restrictions.
 * If those restrictions change the result, return bounds instead of inventing a
 * probability distribution for the user's current first line.
 */
export function calculatePrimePotentialExpected(options) {
  const { tables, lineTargets } = options;
  const representatives = new Map();
  for (const entry of tables?.[0] ?? []) {
    const restriction = getRestriction(entry.name);
    const key = restriction ? `${restriction.key}:${restriction.max}` : "none";
    if (!representatives.has(key)) representatives.set(key, entry.name);
  }
  if (!representatives.size) throw new RangeError("공식 첫 줄 확률표가 없습니다.");
  const variants = [...representatives.values()].map((fixedFirstOption) => calculatePotentialExpected({
    ...options, resetMethod: "prime", fixedFirstOption, ignoreFirstLine: true, lineTargets,
  }));
  const bounds = (key) => [Math.min(...variants.map((value) => value[key])), Math.max(...variants.map((value) => value[key]))];
  const expectedResetsRange = bounds("expectedResets");
  const expectedCostRange = variants[0].resetCost === null ? null : bounds("expectedCost");
  const probabilityRange = bounds("probability");
  const rawProbabilityRange = bounds("rawProbability");
  const [min, max] = expectedResetsRange;
  const dependsOnFirstLine = min !== max && (!Number.isFinite(max) || Math.abs(max - min) > 1e-9 * Math.max(1, max));
  return {
    ...variants[0], dependsOnFirstLine, expectedResetsRange, expectedCostRange, probabilityRange, rawProbabilityRange,
    expectedResets: dependsOnFirstLine ? null : variants[0].expectedResets,
    expectedCost: dependsOnFirstLine ? null : variants[0].expectedCost,
    probability: dependsOnFirstLine ? null : variants[0].probability,
    rawProbability: dependsOnFirstLine ? null : variants[0].rawProbability,
    resets50: dependsOnFirstLine ? null : variants[0].resets50,
    resets95: dependsOnFirstLine ? null : variants[0].resets95,
    variants,
  };
}

function enumeratePotentialScoreDistribution({
  tables,
  conditions,
  mainStat,
  subStat,
  subStats,
  attackType,
  characterLevel,
  statEquivalence,
  enemyDefense,
}) {
  const enriched = tables.map(enrichTable);
  const scoresByKey = new Map();

  function visit(lineIndex, probability, state, restrictions) {
    if (lineIndex === enriched.length) {
      const scores = conditions.map(({ targetType }) => getTargetScore({
        state,
        targetType,
        mainStat,
        subStat,
        subStats,
        attackType,
        characterLevel,
        statEquivalence,
        enemyDefense,
      }));
      const key = scores.map((score) => Number(score).toFixed(10)).join("|");
      const previous = scoresByKey.get(key);
      const repeatWeight = probability > 0 && probability < 1
        ? probability / (1 - probability)
        : 0;
      if (previous) {
        previous.probability += probability;
        previous.repeatWeight += repeatWeight;
      } else {
        scoresByKey.set(key, { scores, probability, repeatWeight });
      }
      return;
    }

    const available = enriched[lineIndex].filter((option) => {
      if (!option.restriction) return true;
      return (
        (restrictions[option.restriction.key] ?? 0) < option.restriction.max
      );
    });
    const availableWeight = available.reduce(
      (sum, option) => sum + option.probability,
      0,
    );
    if (!(availableWeight > 0)) return;

    for (const option of available) {
      const nextRestrictions = { ...restrictions };
      if (option.restriction) {
        nextRestrictions[option.restriction.key] =
          (nextRestrictions[option.restriction.key] ?? 0) + 1;
      }
      visit(
        lineIndex + 1,
        probability * (option.probability / availableWeight),
        addMetrics(state, option.metrics, option.name),
        nextRestrictions,
      );
    }
  }

  visit(0, 1, createState(), {});
  const outcomes = [...scoresByKey.values()];
  const totalProbability = outcomes.reduce(
    (sum, outcome) => sum + outcome.probability,
    0,
  );
  if (totalProbability > 0) {
    for (const outcome of outcomes) {
      outcome.probability /= totalProbability;
    }
  }
  return outcomes;
}

function combinedResidualTarget(targetType, target, firstContribution) {
  if (targetType !== "ignore-defense") {
    return Math.max(0, target - firstContribution);
  }
  if (firstContribution + Number.EPSILON >= target) return 0;
  const targetRemaining = 1 - target / 100;
  const firstRemaining = 1 - firstContribution / 100;
  if (!(firstRemaining > 0)) return 0;
  return Math.max(0, 100 * (1 - targetRemaining / firstRemaining));
}

function probabilityMeeting(outcomes, requirements) {
  if (requirements.every((value) => value <= Number.EPSILON)) return 1;
  return outcomes.reduce((sum, outcome) => {
    const succeeds = requirements.every(
      (required, index) => outcome.scores[index] + Number.EPSILON >= required,
    );
    return succeeds ? sum + outcome.probability : sum;
  }, 0);
}

function adjustedProbabilityMeeting(outcomes, requirements) {
  const matches = (outcome) => requirements.every(
    (required, index) => outcome.scores[index] + Number.EPSILON >= required,
  );
  const rawProbability = outcomes.reduce(
    (sum, outcome) => matches(outcome) ? sum + outcome.probability : sum,
    0,
  );
  const failureRepeatWeight = outcomes.reduce(
    (sum, outcome) => matches(outcome) ? sum : sum + outcome.repeatWeight,
    0,
  );
  return {
    rawProbability,
    probability: adjustedNextResultProbability({
      successProbability: rawProbability,
      failureRepeatWeight,
    }),
  };
}

/**
 * 윗잠과 에디셔널의 세 줄을 합친 목표를 가장 싼 고정 분담으로 나눈다.
 * 한쪽에서 정한 기여도를 먼저 완성한 뒤 다른 쪽에서 나머지를 완성하는,
 * 게임 안에서 그대로 실행할 수 있는 전략만 비교한다.
 */
export function calculateCombinedPotentialExpected({
  regularTables,
  additionalTables,
  targets,
  mainStat,
  subStat = getDefaultSubStat(mainStat),
  subStats,
  attackType = getDefaultAttackType(mainStat),
  characterLevel,
  itemLevel,
  regularGrade = "legendary",
  additionalGrade = "legendary",
  regularResetMethod = "meso",
  additionalResetMethod = "meso",
  statEquivalence = STAT_EQUIVALENCE,
  enemyDefense = 380,
}) {
  if (!Array.isArray(regularTables) || !Array.isArray(additionalTables)) {
    throw new TypeError("윗잠과 에디셔널 확률표가 모두 필요합니다.");
  }
  if (!Array.isArray(targets) || !targets.length) {
    throw new RangeError("하나 이상의 통합 목표를 입력해 주세요.");
  }
  if (subStat === "none") subStat = null;
  for (const condition of targets) {
    validateCalculationOptions({
      target: condition.target,
      targetType: condition.targetType,
      mainStat,
      subStat,
      subStats,
      attackType,
      characterLevel,
      statEquivalence,
      enemyDefense,
    });
    if (condition.targetType === "boss-stat-equivalent") {
      throw new RangeError("통합 계산은 보스전 주스탯% 환산 목표를 지원하지 않습니다.");
    }
  }

  const conditions = expandAllStatTargetConditions(targets);
  const distributionOptions = {
    conditions,
    mainStat,
    subStat,
    subStats,
    attackType,
    characterLevel,
    statEquivalence,
    enemyDefense,
  };
  const regularOutcomes = enumeratePotentialScoreDistribution({
    ...distributionOptions,
    tables: regularTables,
  });
  const additionalOutcomes = enumeratePotentialScoreDistribution({
    ...distributionOptions,
    tables: additionalTables,
  });
  const targetValues = conditions.map(({ target }) => Number(target));
  const allocationByKey = new Map();
  const addAllocation = (values) => {
    const allocation = values.map((value, index) =>
      Math.max(0, Math.min(targetValues[index], value)),
    );
    const key = allocation.map((value) => Number(value).toFixed(10)).join("|");
    if (!allocationByKey.has(key)) allocationByKey.set(key, allocation);
  };
  addAllocation(targetValues.map(() => 0));
  addAllocation(targetValues);
  for (const outcome of regularOutcomes) addAllocation(outcome.scores);

  const regularResetCost = getPotentialResetCost(
    itemLevel,
    regularGrade,
    "regular",
    regularResetMethod,
  );
  const additionalResetCost = getPotentialResetCost(
    itemLevel,
    additionalGrade,
    "additional",
    additionalResetMethod,
  );
  let best = null;

  for (const regularRequirements of allocationByKey.values()) {
    const additionalRequirements = conditions.map((condition, index) =>
      combinedResidualTarget(
        condition.targetType,
        targetValues[index],
        regularRequirements[index],
      ),
    );
    const regularNeeded = regularRequirements.some(
      (value) => value > Number.EPSILON,
    );
    const additionalNeeded = additionalRequirements.some(
      (value) => value > Number.EPSILON,
    );
    const regularProbabilityResult = regularNeeded
      ? adjustedProbabilityMeeting(regularOutcomes, regularRequirements)
      : { probability: 1, rawProbability: 1 };
    const additionalProbabilityResult = additionalNeeded
      ? adjustedProbabilityMeeting(additionalOutcomes, additionalRequirements)
      : { probability: 1, rawProbability: 1 };
    const regularProbability = regularProbabilityResult.probability;
    const additionalProbability = additionalProbabilityResult.probability;
    if (!(regularProbability > 0) || !(additionalProbability > 0)) continue;

    const regularExpectedResets = regularNeeded ? 1 / regularProbability : 0;
    const additionalExpectedResets = additionalNeeded
      ? 1 / additionalProbability
      : 0;
    const expectedCost = regularResetCost === null || additionalResetCost === null
      ? null
      : regularExpectedResets * regularResetCost +
        additionalExpectedResets * additionalResetCost;
    const comparisonValue = expectedCost ??
      regularExpectedResets + additionalExpectedResets;
    if (best && comparisonValue >= best.comparisonValue) continue;
    best = {
      comparisonValue,
      expectedCost,
      regularRequirements,
      additionalRequirements,
      regularProbability,
      regularRawProbability: regularProbabilityResult.rawProbability,
      additionalProbability,
      additionalRawProbability: additionalProbabilityResult.rawProbability,
      regularExpectedResets,
      additionalExpectedResets,
    };
  }

  if (!best) {
    return {
      possible: false,
      expectedCost: Infinity,
      conditions,
    };
  }
  return {
    possible: true,
    expectedCost: best.expectedCost,
    conditions,
    strategyMode: "fixed-allocation",
    regular: {
      probability: best.regularProbability,
      rawProbability: best.regularRawProbability,
      sameResultExcluded: true,
      expectedResets: best.regularExpectedResets,
      resetCost: regularResetCost,
      requirements: conditions.map((condition, index) => ({
        targetType: condition.targetType,
        target: best.regularRequirements[index],
      })),
    },
    additional: {
      probability: best.additionalProbability,
      rawProbability: best.additionalRawProbability,
      sameResultExcluded: true,
      expectedResets: best.additionalExpectedResets,
      resetCost: additionalResetCost,
      requirements: conditions.map((condition, index) => ({
        targetType: condition.targetType,
        target: best.additionalRequirements[index],
      })),
    },
  };
}
