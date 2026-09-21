import {
  ABILITY_REFORM_2026_09_17,
  REFORM_2026_09_17_SOURCES,
  assertReform20260917Ready,
} from "./reform-2026-09-17.js";
import { ABILITY_OPTIONS } from "./ability.js";

const OFFICIAL_REFORM_NOTICE = REFORM_2026_09_17_SOURCES.testworldUpdate.url;
const OFFICIAL_CHANGE_NOTICE =
  REFORM_2026_09_17_SOURCES.testworldSkillUpdate.url;
const OFFICIAL_HONOR_PROBABILITY =
  REFORM_2026_09_17_SOURCES.abilityHonorProbability.url;
const OFFICIAL_MIRACLE_PROBABILITY =
  REFORM_2026_09_17_SOURCES.abilityMiracleProbability.url;
const OFFICIAL_ABILITY_GUIDE = REFORM_2026_09_17_SOURCES.abilityGuide.url;

export const ABILITY_REFORM_EFFECTIVE_DATE =
  ABILITY_REFORM_2026_09_17.effectiveDate;

export const ABILITY_REFORM_SOURCES = Object.freeze({
  reformNotice: OFFICIAL_REFORM_NOTICE,
  changeNotice: OFFICIAL_CHANGE_NOTICE,
  honorProbability: OFFICIAL_HONOR_PROBABILITY,
  miracleProbability: OFFICIAL_MIRACLE_PROBABILITY,
  guide: OFFICIAL_ABILITY_GUIDE,
});

const GRADE_ALIASES = new Map([
  ["rare", "rare"],
  ["레어", "rare"],
  ["epic", "epic"],
  ["에픽", "epic"],
  ["unique", "unique"],
  ["유니크", "unique"],
  ["legendary", "legendary"],
  ["legend", "legendary"],
  ["레전드리", "legendary"],
  ["레전", "legendary"],
]);

const GRADE_ORDER = Object.freeze(["rare", "epic", "unique", "legendary"]);

const METHOD_ALIASES = new Map([
  ["honor", "honor"],
  ["명성치", "honor"],
  ["miracle", "miracle"],
  ["미라클", "miracle"],
  ["black", "black"],
  ["블랙", "black"],
  ["chaos", "chaos"],
  ["카오스", "chaos"],
  ["advanced", "advanced"],
  ["advanced-honor", "advanced"],
  ["고급", "advanced"],
  ["고급 재설정", "advanced"],
  ["abyss", "abyss"],
  ["deep", "abyss"],
  ["심연", "abyss"],
  ["심연의 서큘레이터", "abyss"],
  ["change", "change"],
  ["체인지", "change"],
]);

const NON_REROLLABLE_VALUE_TYPES = new Set([
  "attack-speed",
  "passive-level",
  "multi-target",
]);
const OPTION_TYPE_ALIASES = new Map(
  ABILITY_OPTIONS.flatMap(({ id, label }) => [
    [id.toLowerCase(), id],
    [label.toLowerCase(), id],
  ]),
);

const NORMAL_HONOR_COSTS = Object.freeze({
  rare: Object.freeze([100]),
  epic: Object.freeze([200]),
  unique: Object.freeze([1_500, 3_000, 5_500]),
  legendary: Object.freeze([8_000, 11_000, 16_000]),
});

const ADVANCED_CONFIG = ABILITY_REFORM_2026_09_17.methods.advanced;
const ABYSS_CONFIG = ABILITY_REFORM_2026_09_17.methods.abyssCirculator;
const REFORM_RESTRICTIONS = ABILITY_REFORM_2026_09_17.restrictions;
const CHANGE_SUPPORT = ABILITY_REFORM_2026_09_17.changeCirculatorSupport;
const ADVANCED_PENDING_FIELDS = ABILITY_REFORM_2026_09_17.pendingOfficialFields
  .filter((field) => field.startsWith("methods.advanced."));
const ABYSS_PENDING_FIELDS = ABILITY_REFORM_2026_09_17.pendingOfficialFields
  .filter((field) => field.startsWith("methods.abyssCirculator."));
const ADVANCED_LOCK_COUNTS = ADVANCED_CONFIG.costsByLockedLineCount
  .map(({ lockedLineCount }) => lockedLineCount);
const ADVANCED_MAX_LOCKS = Math.max(...ADVANCED_LOCK_COUNTS);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export const ABILITY_REFORM_METHODS = deepFreeze({
  honor: {
    id: "honor",
    label: "명성치 일반 재설정",
    minimumGrade: "rare",
    locks: true,
    resultPolicy: "force",
    probabilityStatus: "published",
    probabilitySource: OFFICIAL_HONOR_PROBABILITY,
    optionTypesDoNotDuplicate:
      ABILITY_REFORM_2026_09_17.existingHonorRules.optionTypesDoNotDuplicate,
    completelyIdenticalResultIsRerolled:
      ABILITY_REFORM_2026_09_17.existingHonorRules.completelyIdenticalResultIsRerolled,
  },
  miracle: {
    id: "miracle",
    label: "미라클 서큘레이터",
    minimumGrade: "epic",
    locks: false,
    resultPolicy: "force",
    probabilityStatus: "published",
    probabilitySource: OFFICIAL_MIRACLE_PROBABILITY,
    procurementStatus: "cash-sale-ends-2026-09-17",
  },
  black: {
    id: "black",
    label: "블랙 서큘레이터",
    minimumGrade: "unique",
    locks: false,
    resultPolicy: "choose",
    valueOnly: true,
    probabilityStatus: "published-legacy",
    probabilitySource: OFFICIAL_HONOR_PROBABILITY,
  },
  chaos: {
    id: "chaos",
    label: "카오스 서큘레이터",
    minimumGrade: "unique",
    locks: false,
    resultPolicy: "force",
    valueOnly: true,
    probabilityStatus: "published-legacy",
    probabilitySource: OFFICIAL_HONOR_PROBABILITY,
  },
  advanced: {
    id: "advanced",
    label: ADVANCED_CONFIG.label,
    minimumGrade: ADVANCED_CONFIG.requiredAbilityGrade,
    locks: true,
    resultPolicy: "choose",
    lowerLegendaryPossible: ADVANCED_CONFIG.lowerLinesCanBeLegendary,
    probabilityStatus: "pending-official-table",
    probabilityReleaseDate: ABILITY_REFORM_2026_09_17.effectiveDate,
    probabilitySource: OFFICIAL_HONOR_PROBABILITY,
    ruleSource: OFFICIAL_REFORM_NOTICE,
    missingProbabilityFields: ADVANCED_PENDING_FIELDS,
  },
  abyss: {
    id: "abyss",
    label: ABYSS_CONFIG.label,
    minimumGrade: ABYSS_CONFIG.requiredAbilityGrade,
    locks: false,
    resultPolicy: "choose",
    valueOnly: ABYSS_CONFIG.rerollsOnlyValues,
    probabilityStatus: "pending-official-table",
    probabilityReleaseDate: ABILITY_REFORM_2026_09_17.effectiveDate,
    probabilitySource: null,
    probabilityPublicationTarget: OFFICIAL_HONOR_PROBABILITY,
    ruleSource: OFFICIAL_REFORM_NOTICE,
    missingProbabilityFields: ABYSS_PENDING_FIELDS,
  },
  change: {
    id: "change",
    label: "체인지 서큘레이터",
    minimumGrade: "unique",
    locks: false,
    resultPolicy: "deterministic-choice",
    probabilityStatus: "not-random",
    probabilitySource: OFFICIAL_CHANGE_NOTICE,
  },
});

function normalizeGrade(value) {
  if (typeof value !== "string") return null;
  return GRADE_ALIASES.get(value.trim().toLowerCase()) ?? null;
}

function normalizeMethod(value) {
  if (typeof value !== "string") return null;
  return METHOD_ALIASES.get(value.trim().toLowerCase()) ?? null;
}

function normalizeType(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return OPTION_TYPE_ALIASES.get(normalized) ?? null;
}

function normalizeValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * 개편 후 사용 가능 여부와 동일 결과 조건부 확률을 판단할 수 있도록 현재
 * 어빌리티를 항상 정확히 세 줄인 직렬화 가능한 상태로 정규화한다.
 */
export function normalizeAbilityState(input = {}) {
  const overallGrade = normalizeGrade(input.overallGrade ?? input.grade);
  const sourceLines = Array.isArray(input.lines) ? input.lines : [];
  const lines = Array.from({ length: 3 }, (_, line) => {
    const source = sourceLines[line] && typeof sourceLines[line] === "object"
      ? sourceLines[line]
      : {};
    return {
      type: normalizeType(source.type),
      // 첫 줄의 등급은 어빌리티 전체 등급과 항상 같다.
      grade: line === 0 && overallGrade
        ? overallGrade
        : normalizeGrade(source.grade),
      value: normalizeValue(source.value),
      locked: Boolean(source.locked),
    };
  });
  return deepFreeze({ overallGrade, lines });
}

/**
 * 완전히 동일한 결과를 제외하는 조건부 확률의 분모를 만들 수 있도록 현재
 * 결과의 등급·옵션 종류·수치가 세 줄 모두 있는지 검증한다.
 */
export function validateAbilityStateCompleteness(state) {
  const current = normalizeAbilityState(state);
  const missingFields = [];
  if (!current.overallGrade) missingFields.push("overallGrade");
  current.lines.forEach((line, index) => {
    if (!line.type) missingFields.push(`lines.${index}.type`);
    if (!line.grade) missingFields.push(`lines.${index}.grade`);
    if (line.value === null) missingFields.push(`lines.${index}.value`);
  });
  return deepFreeze({
    complete: missingFields.length === 0,
    state: current,
    missingFields,
  });
}

export function hasLegendaryLowerLine(state) {
  const normalized = normalizeAbilityState(state);
  return normalized.lines.slice(1).some((line) => line.grade === "legendary");
}

export function isRerollableAbilityValue(type) {
  const normalized = normalizeType(type);
  return Boolean(normalized) && !NON_REROLLABLE_VALUE_TYPES.has(normalized);
}

function resourceVector(overrides = {}) {
  return deepFreeze({
    honor: Number(overrides.honor) || 0,
    meso: Number(overrides.meso) || 0,
    cash: Number(overrides.cash) || 0,
    credit: Number(overrides.credit) || 0,
    items: { ...(overrides.items ?? {}) },
  });
}

function normalizeLockCount(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    throw new RangeError("잠금 개수는 0 이상의 정수여야 합니다.");
  }
  return numeric;
}

/**
 * 공식 명성치 규칙의 "현재와 완전히 동일한 결과 재추첨"을 조건부 확률로
 * 변환한다. 현재 결과 자체가 목표에 포함될 수 있으므로 교집합도 명시한다.
 */
export function conditionAbilityProbabilityExcludingCurrent({
  targetProbability,
  identicalResultProbability,
  targetAndIdenticalProbability,
} = {}) {
  const target = Number(targetProbability);
  const identical = Number(identicalResultProbability);
  const overlap = Number(targetAndIdenticalProbability);
  for (const [label, value] of [
    ["목표 확률", target],
    ["동일 결과 확률", identical],
    ["목표·동일 결과 교집합 확률", overlap],
  ]) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(`${label}은 0 이상 1 이하여야 합니다.`);
    }
  }
  if (identical >= 1) {
    throw new RangeError("동일 결과 확률이 100%이면 조건부 확률을 계산할 수 없습니다.");
  }
  if (overlap > target || overlap > identical) {
    throw new RangeError("교집합 확률은 목표 확률과 동일 결과 확률보다 클 수 없습니다.");
  }
  return (target - overlap) / (1 - identical);
}

/**
 * 한 번의 재설정이 소비하는 재화를 서로 합산하지 않은 벡터로 반환한다.
 * 현금·크레딧·보유 아이템은 대체 조달 경로이므로 payment로 명시한다.
 */
export function getAbilityReformCost(method, {
  lockCount = 0,
  overallGrade = "legendary",
  payment = "owned",
  halfHonor = false,
} = {}) {
  const methodId = normalizeMethod(method);
  if (!methodId || !ABILITY_REFORM_METHODS[methodId]) {
    throw new RangeError(`지원하지 않는 어빌리티 재설정 방식입니다: ${method}`);
  }
  const locks = normalizeLockCount(lockCount);

  if (methodId === "advanced") {
    const cost = ADVANCED_CONFIG.costsByLockedLineCount.find(
      ({ lockedLineCount }) => lockedLineCount === locks,
    );
    if (!cost) {
      throw new RangeError(
        `고급 재설정 잠금 개수는 ${ADVANCED_LOCK_COUNTS.join(", ")} 중 하나여야 합니다.`,
      );
    }
    return resourceVector({ honor: cost.honor * (halfHonor ? 0.5 : 1), meso: cost.meso });
  }

  if (methodId === "honor") {
    const grade = normalizeGrade(overallGrade);
    const costs = NORMAL_HONOR_COSTS[grade];
    if (!costs || locks >= costs.length) {
      throw new RangeError(`${overallGrade} 등급에서는 ${locks}개 옵션을 잠글 수 없습니다.`);
    }
    return resourceVector({ honor: costs[locks] * (halfHonor ? 0.5 : 1) });
  }

  if (locks !== 0) {
    throw new RangeError(`${ABILITY_REFORM_METHODS[methodId].label}은 옵션 잠금을 지원하지 않습니다.`);
  }

  if (methodId === "abyss") {
    const procurementCurrency = payment === "credit" ? "maple-credit" : payment;
    const procurement = ABYSS_CONFIG.procurement.find(
      ({ currency }) => currency === procurementCurrency,
    );
    if (procurementCurrency === "cash" && procurement) {
      return resourceVector({ cash: procurement.amount });
    }
    if (procurementCurrency === "maple-credit" && procurement) {
      return resourceVector({ credit: procurement.amount });
    }
    if (payment === "owned") {
      return resourceVector({ items: { abyssCirculator: 1 } });
    }
    throw new RangeError("심연의 서큘레이터 결제 방식은 cash, credit, owned 중 하나여야 합니다.");
  }

  if (methodId === "change") {
    return resourceVector({ items: { changeCirculator: 1 } });
  }
  return resourceVector({ items: { [`${methodId}Circulator`]: 1 } });
}

function eligibilityError(code, message, extra = {}) {
  return deepFreeze({ code, message, ...extra });
}

function gradeAtLeast(actual, minimum) {
  const actualIndex = GRADE_ORDER.indexOf(actual);
  const minimumIndex = GRADE_ORDER.indexOf(minimum);
  return actualIndex >= minimumIndex && minimumIndex >= 0;
}

function maximumLocksForNormalHonor(grade) {
  return Math.max(0, (NORMAL_HONOR_COSTS[grade]?.length ?? 1) - 1);
}

function parsedTimestamp(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/** 공식 체인지 서큘레이터 표에서 현재 줄별 선택 가능한 확정 변환을 찾는다. */
export function getChangeCirculatorConversionOptions(state) {
  const current = normalizeAbilityState(state);
  const conversions = [];
  current.lines.forEach((line, index) => {
    const rule = CHANGE_SUPPORT.conversions.find((entry) =>
      entry.fromType === line.type &&
      entry.fromGrade === line.grade &&
      entry.values.includes(line.value));
    const choices = rule?.choicesByValue?.[line.value];
    if (choices?.length) {
      conversions.push({
        line: index,
        from: { type: line.type, grade: line.grade, value: line.value },
        choices: choices.map((choice) => ({ ...choice, grade: line.grade })),
      });
    }
  });
  return deepFreezeCopy(conversions);
}

function deepFreezeCopy(value) {
  return deepFreeze(structuredClone(value));
}

/** 미하일 대상 1회 지급 조건과 실제 아이템 사용 조건을 분리해 판정한다. */
export function getChangeCirculatorClaimEligibility({
  job,
  createdAt,
  now,
  maintenanceCompleted = false,
  alreadyClaimed = false,
} = {}) {
  const errors = [];
  const normalizedJob = typeof job === "string" ? job.trim().toLowerCase() : "";
  if (![CHANGE_SUPPORT.eligibleJob.toLowerCase(), "mihile"].includes(normalizedJob)) {
    errors.push(eligibilityError(
      "CHANGE_MIHAILE_ONLY",
      "체인지 서큘레이터 지원 대상은 미하일 캐릭터입니다.",
    ));
  }
  const creation = parsedTimestamp(createdAt);
  if (creation === null) {
    errors.push(eligibilityError(
      "CHARACTER_CREATION_TIME_REQUIRED",
      "체인지 서큘레이터 대상 확인을 위해 캐릭터 생성 시각이 필요합니다.",
    ));
  } else if (creation >= Date.parse(CHANGE_SUPPORT.characterCreatedBefore)) {
    errors.push(eligibilityError(
      "CHARACTER_CREATED_AFTER_CUTOFF",
      "2026년 9월 17일 오전 0시 이후 생성한 캐릭터는 지원 대상이 아닙니다.",
    ));
  }
  const currentTime = parsedTimestamp(now);
  if (currentTime === null) {
    errors.push(eligibilityError(
      "CURRENT_TIME_REQUIRED",
      "체인지 서큘레이터 수령 기간 확인을 위해 현재 시각이 필요합니다.",
    ));
  } else {
    const scheduledStart = Date.parse(
      `${CHANGE_SUPPORT.claimStartsAfterMaintenanceOn}T00:00:00+09:00`,
    );
    if (currentTime < scheduledStart || !maintenanceCompleted) {
      errors.push(eligibilityError(
        "CLAIM_NOT_STARTED",
        "체인지 서큘레이터는 9월 17일 정식 서버 점검 후 수령할 수 있습니다.",
      ));
    }
    if (currentTime >= Date.parse(CHANGE_SUPPORT.claimEndExclusive)) {
      errors.push(eligibilityError(
        "CLAIM_ENDED",
        "체인지 서큘레이터 수령 기간이 끝났습니다.",
      ));
    }
  }
  if (alreadyClaimed) {
    errors.push(eligibilityError(
      "ALREADY_CLAIMED",
      "체인지 서큘레이터는 캐릭터당 한 번만 받을 수 있습니다.",
    ));
  }
  return deepFreeze({ eligible: errors.length === 0, errors });
}

export function getChangeCirculatorUseEligibility({
  state,
  itemCount = 0,
  now,
  maintenanceCompleted = false,
} = {}) {
  const errors = [];
  const count = Number(itemCount);
  if (!Number.isInteger(count) || count < 1) {
    errors.push(eligibilityError(
      "CHANGE_ITEM_REQUIRED",
      "보유한 체인지 서큘레이터 1개가 필요합니다.",
    ));
  }
  const currentTime = parsedTimestamp(now);
  if (currentTime === null) {
    errors.push(eligibilityError(
      "CURRENT_TIME_REQUIRED",
      "체인지 서큘레이터 유효 기간 확인을 위해 현재 시각이 필요합니다.",
    ));
  } else {
    const scheduledStart = Date.parse(
      `${CHANGE_SUPPORT.claimStartsAfterMaintenanceOn}T00:00:00+09:00`,
    );
    if (currentTime < scheduledStart || !maintenanceCompleted) {
      errors.push(eligibilityError(
        "CHANGE_ITEM_NOT_AVAILABLE",
        "체인지 서큘레이터는 9월 17일 정식 서버 점검 후 사용할 수 있습니다.",
      ));
    }
    if (currentTime >= Date.parse(CHANGE_SUPPORT.itemExpiresAt)) {
      errors.push(eligibilityError(
        "CHANGE_ITEM_EXPIRED",
        "체인지 서큘레이터의 유효 기간이 끝났습니다.",
      ));
    }
  }
  if (CHANGE_SUPPORT.blockedByLegendaryLowerLine && hasLegendaryLowerLine(state)) {
    errors.push(eligibilityError(
      "LOWER_LEGENDARY_METHOD_FORBIDDEN",
      "체인지 서큘레이터는 두 번째·세 번째 옵션이 레전드리 등급이면 사용할 수 없습니다.",
    ));
  }
  const conversions = getChangeCirculatorConversionOptions(state);
  if (conversions.length === 0) {
    errors.push(eligibilityError(
      "NO_CHANGE_CONVERSION_AVAILABLE",
      "현재 어빌리티에는 체인지 서큘레이터로 바꿀 수 있는 옵션이 없습니다.",
    ));
  }
  return deepFreeze({
    eligible: errors.length === 0,
    conversions,
    errors,
  });
}

/**
 * 게임 내 사용 가능 여부만 판정한다. 미공개 확률을 추정하거나 기댓값을
 * 계산하지 않는다.
 */
export function validateAbilityReformEligibility({ method, state, context = {} } = {}) {
  const methodId = normalizeMethod(method);
  if (!methodId || !ABILITY_REFORM_METHODS[methodId]) {
    throw new RangeError(`지원하지 않는 어빌리티 재설정 방식입니다: ${method}`);
  }
  const profile = ABILITY_REFORM_METHODS[methodId];
  const current = normalizeAbilityState(state);
  const errors = [];
  const lockCount = current.lines.filter((line) => line.locked).length;

  if (!current.overallGrade) {
    errors.push(eligibilityError(
      "CURRENT_GRADE_REQUIRED",
      "현재 어빌리티 등급이 필요합니다.",
    ));
  } else if (!gradeAtLeast(current.overallGrade, profile.minimumGrade)) {
    errors.push(eligibilityError(
      "GRADE_TOO_LOW",
      `${profile.label}은 ${profile.minimumGrade} 등급 이상에서만 사용할 수 있습니다.`,
    ));
  }

  if (!profile.locks && lockCount > 0) {
    errors.push(eligibilityError(
      "LOCK_NOT_SUPPORTED",
      `${profile.label}은 옵션 잠금을 지원하지 않습니다.`,
    ));
  }

  if (methodId === "honor" && current.overallGrade) {
    const maxLocks = maximumLocksForNormalHonor(current.overallGrade);
    if (lockCount > maxLocks) {
      errors.push(eligibilityError(
        "TOO_MANY_LOCKS",
        `${current.overallGrade} 등급 일반 재설정은 최대 ${maxLocks}개 옵션만 잠글 수 있습니다.`,
      ));
    }
    current.lines.forEach((line, index) => {
      if (index > 0 && line.locked && line.grade === "legendary") {
        errors.push(eligibilityError(
          "LOWER_LEGENDARY_LOCK_FORBIDDEN",
          "일반 재설정에서는 레전드리 등급인 두 번째·세 번째 옵션을 잠글 수 없습니다.",
          { line: index },
        ));
      }
    });
  }

  if (methodId === "advanced" && lockCount > ADVANCED_MAX_LOCKS) {
    errors.push(eligibilityError(
      "TOO_MANY_LOCKS",
      `고급 재설정은 최대 ${ADVANCED_MAX_LOCKS}개 옵션만 잠글 수 있습니다.`,
    ));
  }

  const blockedByLegendaryLowerLine =
    (methodId === "black" && REFORM_RESTRICTIONS.blackCirculatorBlockedByLegendaryLowerLine) ||
    (methodId === "chaos" && REFORM_RESTRICTIONS.chaosCirculatorBlockedByLegendaryLowerLine);
  if (blockedByLegendaryLowerLine && hasLegendaryLowerLine(current)) {
    errors.push(eligibilityError(
      "LOWER_LEGENDARY_METHOD_FORBIDDEN",
      `${profile.label}은 두 번째·세 번째 옵션이 레전드리 등급이면 사용할 수 없습니다.`,
    ));
  }

  if (["black", "chaos", "abyss"].includes(methodId)) {
    const knownTypes = current.lines.filter((line) => line.type);
    if (knownTypes.length !== current.lines.length) {
      errors.push(eligibilityError(
        "CURRENT_OPTIONS_REQUIRED",
        `${profile.label}의 사용 가능 여부를 확인하려면 현재 세 줄의 옵션 종류가 필요합니다.`,
      ));
    } else if (
      (methodId !== "abyss" || ABYSS_CONFIG.requiresAtLeastOneRerollableValue) &&
      !knownTypes.some((line) => isRerollableAbilityValue(line.type))
    ) {
      errors.push(eligibilityError(
        "NO_REROLLABLE_VALUE",
        "재설정할 수 있는 수치가 있는 옵션이 없어 사용할 수 없습니다.",
      ));
    }
  }

  if (methodId === "change") {
    const use = getChangeCirculatorUseEligibility({
      state: current,
      itemCount: context.itemCount,
      now: context.now,
      maintenanceCompleted: context.maintenanceCompleted,
    });
    errors.push(...use.errors);
  }

  return deepFreeze({
    eligible: errors.length === 0,
    method: methodId,
    state: current,
    lockCount,
    errors,
  });
}

export class AbilityReformEligibilityError extends Error {
  constructor(validation) {
    super(validation.errors.map((error) => error.message).join(" "));
    this.name = "AbilityReformEligibilityError";
    this.code = "ABILITY_REFORM_INELIGIBLE";
    this.validation = validation;
  }
}

export class AbilityProbabilityUnavailableError extends Error {
  constructor(profile) {
    const missing = profile.missingProbabilityFields.join(", ");
    super(`${profile.label} 기댓값은 공식 확률표 확인 전 계산할 수 없습니다: ${missing}`);
    this.name = "AbilityProbabilityUnavailableError";
    this.code = "OFFICIAL_ABILITY_PROBABILITY_PENDING";
    this.method = profile.id;
    this.releaseDate = profile.probabilityReleaseDate;
    this.source = profile.probabilitySource;
    this.missingFields = [...profile.missingProbabilityFields];
  }
}

export class AbilityStateIncompleteError extends Error {
  constructor(completeness, method) {
    super(
      `${method} 기댓값에는 현재 어빌리티 세 줄의 등급·종류·수치가 모두 필요합니다: ${completeness.missingFields.join(", ")}`,
    );
    this.name = "AbilityStateIncompleteError";
    this.code = "ABILITY_STATE_INCOMPLETE";
    this.method = method;
    this.missingFields = [...completeness.missingFields];
  }
}

/**
 * 고급 재설정과 심연의 서큘레이터에 임시 확률을 넣는 일을 막는 경계 함수다.
 * 정식 공식표를 버전 데이터로 추가해 probabilityStatus를 published로 바꾸고
 * 실제 계산기를 연결하기 전까지는 항상 명시적인 오류를 던진다.
 */
export function calculateAbilityReformExpected({
  method,
  state,
  context,
  forProduction = true,
  asOfDate = null,
  maintenanceCompleted = false,
} = {}) {
  const validation = validateAbilityReformEligibility({ method, state, context });
  if (!validation.eligible) throw new AbilityReformEligibilityError(validation);
  if (["advanced", "abyss"].includes(validation.method)) {
    const completeness = validateAbilityStateCompleteness(validation.state);
    if (!completeness.complete) {
      throw new AbilityStateIncompleteError(completeness, validation.method);
    }
  }
  if (forProduction) {
    assertReform20260917Ready("ability", {
      asOfDate,
      maintenanceCompleted,
    });
  }
  const profile = ABILITY_REFORM_METHODS[validation.method];
  if (profile.probabilityStatus !== "published") {
    if (profile.missingProbabilityFields?.length) {
      throw new AbilityProbabilityUnavailableError(profile);
    }
    throw new RangeError(`${profile.label}은 이 개편 기댓값 계산기의 대상이 아닙니다.`);
  }
  throw new RangeError(
    `${profile.label}은 기존 어빌리티 계산기를 사용해야 합니다.`,
  );
}
