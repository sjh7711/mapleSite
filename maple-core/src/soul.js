import {
  SOUL_REFORM_2026_09_17,
  assertReform20260917Ready,
} from "./reform-2026-09-17.js";

const GRADE_ORDER = SOUL_REFORM_2026_09_17.potential.grades;
const STAGES = new Map(
  SOUL_REFORM_2026_09_17.amplification.stages.map((stage) => [stage.stage, stage]),
);

function assertFiniteNonNegative(value, label, { integer = false } = {}) {
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    (integer && !Number.isInteger(value))
  ) {
    throw new RangeError(`${label}은 0 이상${integer ? "의 정수" : ""}여야 합니다.`);
  }
}

function amplificationStage(stage) {
  const config = STAGES.get(Number(stage));
  if (!config) throw new RangeError("소울 증폭 단계는 1~4단계여야 합니다.");
  return config;
}

/** 실패 횟수는 게이지 반올림값이 아닌 서버 천장 상태의 기준값이다. */
export function getSoulAmplificationChance(stage, failures = 0) {
  const config = amplificationStage(stage);
  const count = Number(failures);
  assertFiniteNonNegative(count, "현재 증폭 실패 횟수", { integer: true });
  if (count > config.guaranteeAfterFailures) {
    throw new RangeError(
      `현재 증폭 실패 횟수는 ${config.guaranteeAfterFailures}회를 넘을 수 없습니다.`,
    );
  }
  if (count >= config.guaranteeAfterFailures) return 1;
  return Math.min(
    1,
    config.baseSuccessProbability +
      config.successProbabilityIncreasePerFailure * count,
  );
}

export function getSoulAmplificationGauge(stage, failures = 0) {
  const config = amplificationStage(stage);
  const count = Number(failures);
  assertFiniteNonNegative(count, "현재 증폭 실패 횟수", { integer: true });
  if (count > config.guaranteeAfterFailures) {
    throw new RangeError(
      `현재 증폭 실패 횟수는 ${config.guaranteeAfterFailures}회를 넘을 수 없습니다.`,
    );
  }
  if (count >= config.guaranteeAfterFailures) return 1;
  return Math.min(1, config.gaugeIncreasePerFailure * count);
}

/**
 * 한 증폭 단계의 성공까지 필요한 시도·메소·에테르 기댓값을 계산한다.
 * 공식 문구가 "게이지 100% 충전 후 다음 시도"라고 명시하므로 N회 실패
 * 이후의 N+1번째 시도를 확정 성공으로 취급한다.
 */
export function calculateSoulAmplificationExpected({
  stage,
  currentFailures = 0,
  ownedEther = 0,
  etherPriceMeso = 0,
  forProduction = true,
  asOfDate = null,
  maintenanceCompleted = false,
} = {}) {
  if (forProduction) {
    assertReform20260917Ready("soulAmplification", {
      asOfDate,
      maintenanceCompleted,
    });
  }
  const config = amplificationStage(stage);
  const failures = Number(currentFailures);
  const stock = Number(ownedEther);
  const etherPrice = Number(etherPriceMeso);
  assertFiniteNonNegative(failures, "현재 증폭 실패 횟수", { integer: true });
  assertFiniteNonNegative(stock, "보유 소울 에테르", { integer: true });
  assertFiniteNonNegative(etherPrice, "소울 에테르 가격");
  if (failures > config.guaranteeAfterFailures) {
    throw new RangeError(
      `현재 증폭 실패 횟수는 ${config.guaranteeAfterFailures}회를 넘을 수 없습니다.`,
    );
  }

  const maximumAttempts = config.guaranteeAfterFailures - failures + 1;
  const attempts = [];
  let survival = 1;
  let expectedAttempts = 0;
  let expectedOwnedEther = 0;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const failuresBeforeAttempt = failures + attempt - 1;
    const successProbabilityGivenAttempt = getSoulAmplificationChance(
      config.stage,
      failuresBeforeAttempt,
    );
    const reachProbability = survival;
    const successProbability = reachProbability * successProbabilityGivenAttempt;
    expectedAttempts += reachProbability;
    if (attempt <= stock) expectedOwnedEther += reachProbability;
    attempts.push({
      attempt,
      failuresBeforeAttempt,
      reachProbability,
      successProbabilityGivenAttempt,
      successProbability,
    });
    survival *= 1 - successProbabilityGivenAttempt;
  }

  const expectedPurchasedEther = Math.max(0, expectedAttempts - expectedOwnedEther);
  const expectedAttemptMeso = expectedAttempts * config.mesoPerAttempt;
  const expectedEtherMeso = expectedPurchasedEther * etherPrice;

  return {
    stage: config.stage,
    currentFailures: failures,
    currentGauge: getSoulAmplificationGauge(config.stage, failures),
    currentSuccessProbability: getSoulAmplificationChance(config.stage, failures),
    maximumAttempts,
    completionProbability: 1 - survival,
    attempts,
    expected: {
      attempts: expectedAttempts,
      failures: expectedAttempts - 1,
      etherUsed: expectedAttempts,
      ownedEtherUsed: expectedOwnedEther,
      purchasedEther: expectedPurchasedEther,
    },
    costs: {
      attemptMeso: expectedAttemptMeso,
      etherMeso: expectedEtherMeso,
      totalMeso: expectedAttemptMeso + expectedEtherMeso,
    },
  };
}

/** 현재 증폭 단계에서 목표 단계까지 단계별 기댓값을 합산한다. */
export function calculateSoulAmplificationPath({
  currentStage = 0,
  targetStage = 4,
  currentFailures = 0,
  ownedEtherByStage = {},
  etherPriceMesoByStage = {},
  forProduction = true,
  asOfDate = null,
  maintenanceCompleted = false,
} = {}) {
  if (forProduction) {
    assertReform20260917Ready("soulAmplification", {
      asOfDate,
      maintenanceCompleted,
    });
  }
  const start = Number(currentStage);
  const target = Number(targetStage);
  if (!Number.isInteger(start) || start < 0 || start > 4) {
    throw new RangeError("현재 소울 증폭 단계는 0~4단계여야 합니다.");
  }
  if (!Number.isInteger(target) || target <= start || target > 4) {
    throw new RangeError("목표 소울 증폭 단계는 현재보다 높고 4단계 이하여야 합니다.");
  }

  const stages = [];
  for (let stage = start + 1; stage <= target; stage += 1) {
    stages.push(calculateSoulAmplificationExpected({
      stage,
      currentFailures: stage === start + 1 ? currentFailures : 0,
      ownedEther: ownedEtherByStage?.[stage] ?? 0,
      etherPriceMeso: etherPriceMesoByStage?.[stage] ?? 0,
      forProduction: false,
    }));
  }
  return {
    currentStage: start,
    targetStage: target,
    stages,
    expected: {
      attempts: stages.reduce((sum, stage) => sum + stage.expected.attempts, 0),
      etherUsed: stages.reduce((sum, stage) => sum + stage.expected.etherUsed, 0),
      purchasedEther: stages.reduce(
        (sum, stage) => sum + stage.expected.purchasedEther,
        0,
      ),
    },
    costs: {
      attemptMeso: stages.reduce((sum, stage) => sum + stage.costs.attemptMeso, 0),
      etherMeso: stages.reduce((sum, stage) => sum + stage.costs.etherMeso, 0),
      totalMeso: stages.reduce((sum, stage) => sum + stage.costs.totalMeso, 0),
    },
  };
}

function potentialRankUpConfig(grade) {
  const config = SOUL_REFORM_2026_09_17.potential.rankUpByGrade[grade];
  if (!config) throw new RangeError("레전드리에서는 더 이상 등급 상승할 수 없습니다.");
  return config;
}

export function getSoulPotentialRankUpInfo({ grade, miracle = false } = {}) {
  if (typeof miracle !== "boolean") {
    throw new TypeError("미라클 타임 적용 여부는 boolean이어야 합니다.");
  }
  const config = potentialRankUpConfig(grade);
  const miracleMultiplier = miracle
    ? SOUL_REFORM_2026_09_17.potential.miracleTimeRankUpProbabilityMultiplier
    : 1;
  return {
    fromGrade: grade,
    toGrade: config.toGrade,
    probability: Math.min(1, config.probability * miracleMultiplier),
    baseProbability: config.probability,
    guaranteeAtResetCount: config.guaranteeAtResetCount,
    resetCostMeso: SOUL_REFORM_2026_09_17.potential.resetCostsByGrade[grade],
    miracle: Boolean(miracle),
  };
}

function cappedConstantProbabilityStats(probability, remaining) {
  let survival = 1;
  let expectedAttempts = 0;
  const attempts = [];
  for (let attempt = 1; attempt <= remaining; attempt += 1) {
    const isGuaranteed = attempt === remaining;
    const successProbabilityGivenAttempt = isGuaranteed ? 1 : probability;
    const reachProbability = survival;
    const successProbability = reachProbability * successProbabilityGivenAttempt;
    expectedAttempts += reachProbability;
    attempts.push({
      attempt,
      reachProbability,
      successProbabilityGivenAttempt,
      successProbability,
      guaranteed: isGuaranteed,
    });
    survival *= 1 - successProbabilityGivenAttempt;
  }
  return { expectedAttempts, attempts, completionProbability: 1 - survival };
}

/** 한 등급 구간의 소울 잠재 등급 상승 기댓값. */
export function calculateSoulPotentialRankUpStage({
  grade,
  currentResetCount = 0,
  miracle = false,
  forProduction = true,
  asOfDate = null,
  maintenanceCompleted = false,
} = {}) {
  if (forProduction) {
    assertReform20260917Ready("soulPotentialRankUp", {
      asOfDate,
      maintenanceCompleted,
    });
  }
  const info = getSoulPotentialRankUpInfo({ grade, miracle });
  const progress = Number(currentResetCount);
  assertFiniteNonNegative(progress, "현재 등급 상승 보장 진행", { integer: true });
  if (progress >= info.guaranteeAtResetCount) {
    throw new RangeError(
      `현재 진행은 ${info.guaranteeAtResetCount - 1}회를 넘을 수 없습니다.`,
    );
  }
  const remaining = info.guaranteeAtResetCount - progress;
  const stats = cappedConstantProbabilityStats(info.probability, remaining);
  return {
    ...info,
    currentResetCount: progress,
    remaining,
    maximumAttempts: remaining,
    completionProbability: stats.completionProbability,
    attempts: stats.attempts,
    expectedAttempts: stats.expectedAttempts,
    expectedCostMeso: stats.expectedAttempts * info.resetCostMeso,
  };
}

/** 레어/에픽/유니크에서 목표 등급까지의 등급 상승 기댓값. */
export function calculateSoulPotentialRankUpExpected({
  fromGrade,
  toGrade,
  miracle = false,
  currentResetCount = 0,
  resetCountByGrade = undefined,
  forProduction = true,
  asOfDate = null,
  maintenanceCompleted = false,
} = {}) {
  if (resetCountByGrade !== undefined) {
    throw new RangeError(
      "등업 후 미래 등급의 천장 진행은 미리 지정할 수 없습니다. 현재 등급 진행만 입력하세요.",
    );
  }
  if (forProduction) {
    assertReform20260917Ready("soulPotentialRankUp", {
      asOfDate,
      maintenanceCompleted,
    });
  }
  const fromIndex = GRADE_ORDER.indexOf(fromGrade);
  const toIndex = GRADE_ORDER.indexOf(toGrade);
  if (fromIndex < 0 || toIndex <= fromIndex) {
    throw new RangeError("목표 소울 잠재 등급은 현재 등급보다 높아야 합니다.");
  }
  const stages = [];
  for (let index = fromIndex; index < toIndex; index += 1) {
    const grade = GRADE_ORDER[index];
    stages.push(calculateSoulPotentialRankUpStage({
      grade,
      // 한 무기에 저장되는 천장 진행은 현재 등급 하나뿐이다. 등업 후
      // 다음 등급 구간은 반드시 0회부터 시작한다.
      currentResetCount: index === fromIndex ? currentResetCount : 0,
      miracle,
      forProduction: false,
    }));
  }
  return {
    fromGrade,
    toGrade,
    miracle: Boolean(miracle),
    stages,
    expectedAttempts: stages.reduce((sum, stage) => sum + stage.expectedAttempts, 0),
    expectedCostMeso: stages.reduce(
      (sum, stage) => sum + stage.expectedCostMeso,
      0,
    ),
    maximumAttempts: stages.reduce((sum, stage) => sum + stage.maximumAttempts, 0),
  };
}

export function getSoulPotentialLineGradeDistribution(grade) {
  const distribution = SOUL_REFORM_2026_09_17.potential.lineGradeDistribution[grade];
  if (!distribution) throw new RangeError("지원하지 않는 소울 잠재 등급입니다.");
  const normalize = (weights) => {
    const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
    if (!(total > 0)) throw new RangeError("소울 잠재 줄 등급 확률이 비어 있습니다.");
    return Object.fromEntries(
      Object.entries(weights).map(([key, value]) => [key, value / total]),
    );
  };
  // 공식 표의 반올림값은 합이 1에서 수십만분의 일만큼 벗어날 수 있다.
  // 원본 스냅샷은 보존하고 계산 경계에서만 정규화한다.
  return {
    first: normalize(distribution.first),
    lower: normalize(distribution.lower),
  };
}

/** 옵션별 공식 표가 공개되기 전에는 옵션 뽑기 기댓값 계산을 명시적으로 막는다. */
export function assertSoulPotentialOptionTablesReady({
  forInitialCreation = false,
  forRankUp = false,
} = {}) {
  const required = new Set([
    "potential.optionTypeWeights",
    "potential.optionValuesByAmplificationStage",
    "potential.optionDuplicatePolicy",
    "potential.identicalResultPolicy",
  ]);
  if (forInitialCreation) required.add("potential.initialGradeAtStageOne");
  if (forRankUp) required.add("potential.rankUpResultRollOrder");
  const pending = SOUL_REFORM_2026_09_17.pendingOfficialFields.filter(
    (field) => required.has(field),
  );
  if (pending.length) {
    throw new Error(
      `소울 잠재 옵션 공식 확률표가 아직 공개되지 않았습니다: ${pending.join(", ")}`,
    );
  }
}

export function getSoulEnhancementEligibility({
  weaponLevel,
  soulType,
  temporary = false,
  genesisWeapon = false,
  genesisSecondReleaseQuestCompleted = false,
  sealedGenesis = false,
} = {}) {
  const reasons = [];
  if (!(Number(weaponLevel) >= SOUL_REFORM_2026_09_17.eligibility.minimumWeaponLevel)) {
    reasons.push("weapon-level-below-200");
  }
  if (soulType !== SOUL_REFORM_2026_09_17.eligibility.requiredSoulType) {
    reasons.push("magnificent-soul-required");
  }
  if (temporary) reasons.push("temporary-weapon");
  if (
    sealedGenesis ||
    (genesisWeapon &&
      SOUL_REFORM_2026_09_17.eligibility.genesisSecondReleaseQuestRequired &&
      !genesisSecondReleaseQuestCompleted)
  ) {
    reasons.push("genesis-second-release-quest-required");
  }
  return { eligible: reasons.length === 0, reasons };
}

/** 소울 잠재 재설정은 공통 무기 조건에 더해 증폭 1단계 이상이어야 한다. */
export function getSoulPotentialResetEligibility({
  amplificationStage = 0,
  ...weapon
} = {}) {
  const base = getSoulEnhancementEligibility(weapon);
  const stage = Number(amplificationStage);
  const reasons = [...base.reasons];
  if (!Number.isInteger(stage) || stage < 1 || stage > 4) {
    reasons.push("soul-amplification-required");
  }
  return { eligible: reasons.length === 0, reasons };
}

/** 공식 공지상 소울 잠재 자동 강화는 레전드리 등급부터 사용할 수 있다. */
export function getSoulAutomaticEnhancementEligibility({
  potentialGrade,
  ...weapon
} = {}) {
  const base = getSoulPotentialResetEligibility(weapon);
  const reasons = [...base.reasons];
  const gradeIndex = GRADE_ORDER.indexOf(potentialGrade);
  const minimumIndex = GRADE_ORDER.indexOf(
    SOUL_REFORM_2026_09_17.potential.automaticEnhancementMinimumGrade,
  );
  if (potentialGrade === null || potentialGrade === undefined || potentialGrade === "") {
    reasons.push("soul-potential-grade-required");
  } else if (gradeIndex < 0) {
    reasons.push("invalid-soul-potential-grade");
  } else if (gradeIndex < minimumIndex) {
    reasons.push("legendary-soul-potential-required-for-automatic-enhancement");
  }
  return { eligible: reasons.length === 0, reasons };
}

/** 증폭 단계가 이미 있는 무기에는 위대한 소울만 다시 부여할 수 있다. */
export function getSoulReapplicationEligibility({
  amplificationStage = 0,
  newSoulType,
} = {}) {
  const stage = Number(amplificationStage);
  if (!Number.isInteger(stage) || stage < 0 || stage > 4) {
    throw new RangeError("현재 소울 증폭 단계는 0~4단계여야 합니다.");
  }
  const reasons = [];
  if (
    stage > 0 &&
    newSoulType !==
      SOUL_REFORM_2026_09_17.eligibility.amplifiedWeaponReapplicationSoulType
  ) {
    reasons.push("magnificent-soul-required-for-amplified-weapon");
  }
  return { eligible: reasons.length === 0, reasons };
}

export { SOUL_REFORM_2026_09_17 };
