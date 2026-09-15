/**
 * 2026-09-17 메소 주문서 개편을 계산기에 연결하는 안전한 조회 계층.
 *
 * 원본 스냅샷은 공식 공지에서 확인한 값과 아직 확인하지 못한 값을 함께
 * 보존한다. 이 모듈은 그중 계산에 사용해도 되는 범위를 구분하고, 미공개
 * 필드가 필요한 계산은 명시적으로 중단한다.
 */

import {
  SCROLL_REFORM_2026_09_17,
  assertReform20260917ProductionActivated,
} from "./reform-2026-09-17.js";

export const SCROLL_REFORM_EFFECTIVE_DATE = "2026-09-17";

const CATALOGS = Object.freeze({
  [SCROLL_REFORM_EFFECTIVE_DATE]: SCROLL_REFORM_2026_09_17,
});

const PERCENT = 100;

function freezeArray(values) {
  return Object.freeze([...values]);
}

function catalogFor(effectiveDate) {
  const catalog = CATALOGS[effectiveDate];
  if (!catalog) {
    throw new RangeError(`지원하지 않는 주문서 개편 기준일입니다: ${effectiveDate}`);
  }
  return catalog;
}

function pendingFieldsUnder(catalog, path) {
  return catalog.pendingOfficialFields.filter(
    (field) =>
      field === path ||
      field.startsWith(`${path}.`) ||
      path.startsWith(`${field}.`),
  );
}

/** 공식 값이 더 필요해 해당 계산을 안전하게 진행할 수 없을 때의 오류. */
export class ScrollReformNotReadyError extends Error {
  constructor({ effectiveDate, scope, pendingOfficialFields }) {
    const fields = freezeArray(pendingOfficialFields);
    super(
      `${effectiveDate} 주문서 개편의 ${scope} 계산에는 아직 공개되지 않은 공식 값이 필요합니다: ${fields.join(", ")}`,
    );
    this.name = "ScrollReformNotReadyError";
    this.code = "SCROLL_REFORM_NOT_READY";
    this.effectiveDate = effectiveDate;
    this.scope = scope;
    this.pendingOfficialFields = fields;
  }
}

function assertReady({ catalog, scope, pendingOfficialFields }) {
  if (pendingOfficialFields.length > 0) {
    throw new ScrollReformNotReadyError({
      effectiveDate: catalog.effectiveDate,
      scope,
      pendingOfficialFields,
    });
  }
}

/**
 * 기준일별 공식 주문서 규칙 원본을 조회한다.
 *
 * 기본 조회는 공개된 부분을 살펴볼 수 있도록 부분 카탈로그를 반환한다.
 * 전체 데이터가 필요한 소비자는 `requireComplete`를 켜야 하며, 이 경우
 * 미공개 필드가 하나라도 남아 있으면 계산을 차단한다.
 */
export function getScrollReformCatalog(
  effectiveDate = SCROLL_REFORM_EFFECTIVE_DATE,
  { requireComplete = false } = {},
) {
  const catalog = catalogFor(effectiveDate);
  if (requireComplete) {
    assertReady({
      catalog,
      scope: "전체 카탈로그",
      pendingOfficialFields: catalog.pendingOfficialFields,
    });
  }
  return catalog;
}

/** 기준일 카탈로그에 포함된 주문서 ID 목록. */
export function listScrollReformRuleIds(
  effectiveDate = SCROLL_REFORM_EFFECTIVE_DATE,
) {
  return Object.freeze(Object.keys(catalogFor(effectiveDate).scrolls));
}

/**
 * 주문서 하나의 규칙을 조회한다.
 *
 * 해당 주문서 아래에 미공개 필드가 있으면 기본적으로 차단한다. 연구용으로
 * 원본을 확인할 때만 `allowPending`을 명시적으로 켤 수 있다.
 */
export function getScrollReformRule(
  scrollId,
  {
    effectiveDate = SCROLL_REFORM_EFFECTIVE_DATE,
    allowPending = false,
  } = {},
) {
  const catalog = catalogFor(effectiveDate);
  const rule = catalog.scrolls[scrollId];
  if (!rule) throw new RangeError(`지원하지 않는 개편 주문서입니다: ${scrollId}`);

  if (!allowPending) {
    assertReady({
      catalog,
      scope: scrollId,
      pendingOfficialFields: pendingFieldsUnder(catalog, `scrolls.${scrollId}`),
    });
  }
  return rule;
}

/**
 * 장비/펫장비 리턴 보호 규칙을 조회한다.
 *
 * 비용과 실패 시 동작은 공개됐지만 주문서별 적용 가능 목록은 아직
 * 공개되지 않았다. 따라서 실제 주문서 적용 가능 여부까지 필요한 기본
 * 조회는 차단하고, 비용표만 볼 때 `allowPendingEligibility`를 켠다.
 */
export function getReturnProtectionRule(
  equipmentType,
  {
    effectiveDate = SCROLL_REFORM_EFFECTIVE_DATE,
    allowPendingEligibility = false,
    requireLegacyCashItemHandling = false,
  } = {},
) {
  const catalog = catalogFor(effectiveDate);
  const rule = catalog.returnProtection[equipmentType];
  if (!rule || equipmentType === "effect") {
    throw new RangeError(`지원하지 않는 리턴 보호 장비 종류입니다: ${equipmentType}`);
  }

  const pendingOfficialFields = [];
  if (!allowPendingEligibility) {
    pendingOfficialFields.push(
      ...pendingFieldsUnder(catalog, "returnProtection.itemEligibilityByScroll"),
    );
  }
  if (requireLegacyCashItemHandling) {
    pendingOfficialFields.push(
      ...pendingFieldsUnder(catalog, "returnProtection.legacyCashItemHandling"),
    );
  }
  if (pendingOfficialFields.length) {
    assertReady({
      catalog,
      scope: `리턴 보호/${equipmentType}`,
      pendingOfficialFields,
    });
  }
  return Object.freeze({
    equipmentType,
    ...rule,
    effect: catalog.returnProtection.effect,
  });
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteNumber(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name}은 유한한 숫자여야 합니다.`);
  return value;
}

function probability(value, name) {
  const numeric = finiteNumber(Number(value), name);
  if (numeric < 0 || numeric > 1) {
    throw new RangeError(`${name}은 0 이상 1 이하여야 합니다.`);
  }
  return numeric;
}

/**
 * 길드 스킬의 실패 시 업그레이드 횟수 보호를 포함한 한 번의 상태 전이.
 * 어떤 주문서에 길드 보호가 적용되는지는 정식 예외표 확인 전 호출부가
 * 결정하지 않으며, 이 함수는 명시적으로 전달된 두 확률만 계산한다.
 */
export function calculateScrollAttemptTransitions({
  successProbability,
  failureSlotProtectionProbability = 0,
} = {}) {
  const success = probability(successProbability, "주문서 성공 확률");
  const protection = probability(
    failureSlotProtectionProbability,
    "실패 시 업그레이드 횟수 보호 확률",
  );
  const failure = 1 - success;
  return Object.freeze({
    success,
    failurePreserved: failure * protection,
    failureConsumed: failure * (1 - protection),
  });
}

/** 리턴 보호 1회의 확정 상태 전이를 의사결정 분기와 분리해 반환한다. */
export function getReturnProtectedAttemptTransitions({
  successProbability,
  equipmentType = "equipment",
  effectiveDate = SCROLL_REFORM_EFFECTIVE_DATE,
  allowPendingEligibility = false,
  forProduction = true,
  asOfDate = null,
  maintenanceCompleted = false,
} = {}) {
  if (forProduction) {
    assertReform20260917ProductionActivated("scroll", {
      asOfDate,
      maintenanceCompleted,
    });
  }
  const success = probability(successProbability, "주문서 성공 확률");
  const rule = getReturnProtectionRule(equipmentType, {
    effectiveDate,
    allowPendingEligibility,
  });
  return Object.freeze({
    protectionConsumed: true,
    success: Object.freeze({
      probability: success,
      choices: rule.effect.successChoices,
      restoreScope: rule.effect.restoreScope,
    }),
    failure: Object.freeze({
      probability: 1 - success,
      upgradeSlotPreserved: rule.effect.failurePreservesUpgradeSlot,
    }),
  });
}

/** 손재주 레벨을 주문서 성공 확률 가산치(확률 포인트)로 바꾼다. */
export function dexterityScrollBonusProbability(dexterityLevel = 0) {
  finiteNumber(dexterityLevel, "손재주 레벨");
  const rules = SCROLL_REFORM_2026_09_17.commonRules;
  const level = clamp(
    Math.floor(dexterityLevel),
    0,
    rules.dexterityBonusMaximumLevel,
  );
  // 공식 규칙: 손재주 5레벨마다 0.5%p, 최대 10%p.
  return Math.min(
    rules.dexteritySuccessBonusMaxProbabilityPoints,
    Math.floor(level / rules.dexterityBonusStepLevels) *
      rules.dexterityBonusPerStepProbabilityPoints,
  );
}

function guildScrollBonusProbability(guildSuccessBonusPercent, catalog) {
  finiteNumber(guildSuccessBonusPercent, "길드 주문서 성공률 보너스");
  const maximum =
    catalog.commonRules.guildSuccessBonusMaxProbabilityPoints * PERCENT;
  return clamp(guildSuccessBonusPercent, 0, maximum) / PERCENT;
}

/**
 * 메소 탭 주문서 한 번의 성공률과 비용을 계산한다.
 *
 * `guildSuccessBonusPercent`는 확률 포인트 단위(0~4)다. 피버타임과 주문의
 * 흔적 비용 할인 입력은 호출부 호환을 위해 받되, 공식 규칙대로 메소 탭의
 * 성공률과 가격에는 적용하지 않는다.
 */
export function calculateMesoScrollAttempt(
  scrollId,
  {
    effectiveDate = SCROLL_REFORM_EFFECTIVE_DATE,
    dexterityLevel = 0,
    guildSuccessBonusPercent = 0,
    fever = false,
    traceCostDiscount = false,
    forProduction = true,
    asOfDate = null,
    maintenanceCompleted = false,
  } = {},
) {
  if (forProduction) {
    assertReform20260917ProductionActivated("scroll", {
      asOfDate,
      maintenanceCompleted,
    });
  }
  const catalog = catalogFor(effectiveDate);
  // 성공률과 가격만 사용하므로 놀긍 60%의 미확정 결과 분포와는 독립적이다.
  const rule = getScrollReformRule(scrollId, {
    effectiveDate,
    allowPending: true,
  });
  if (rule.cost?.currency !== "meso") {
    throw new RangeError(`메소 탭 주문서가 아닙니다: ${scrollId}`);
  }

  const modifiers = rule.modifiers ?? {};
  const dexterityBonusProbability = modifiers.dexterity
    ? dexterityScrollBonusProbability(dexterityLevel)
    : 0;
  const guildBonusProbability = modifiers.guild
    ? guildScrollBonusProbability(guildSuccessBonusPercent, catalog)
    : 0;
  const baseSuccessProbability =
    rule.baseSuccessProbability ?? rule.successProbability;
  const successProbability =
    Math.round(
      Math.min(
        1,
        baseSuccessProbability + dexterityBonusProbability + guildBonusProbability,
      ) * 1e12,
    ) / 1e12;

  const feverRequested = Boolean(fever);
  const traceCostDiscountRequested = Boolean(traceCostDiscount);
  return Object.freeze({
    scrollId,
    effectiveDate,
    baseSuccessProbability,
    successProbability,
    successPercent: successProbability * PERCENT,
    cost: rule.cost,
    appliedModifiers: Object.freeze({
      dexterityBonusProbability,
      guildBonusProbability,
    }),
    ignoredModifiers: Object.freeze({
      fever:
        feverRequested && !catalog.commonRules.mesoTabReceivesTraceFever,
      traceCostDiscount:
        traceCostDiscountRequested &&
        !catalog.commonRules.mesoTabReceivesTraceCostDiscount,
    }),
  });
}
