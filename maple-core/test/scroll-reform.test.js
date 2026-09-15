import assert from "node:assert/strict";
import test from "node:test";

import {
  SCROLL_REFORM_EFFECTIVE_DATE,
  ScrollReformNotReadyError,
  calculateMesoScrollAttempt,
  calculateScrollAttemptTransitions,
  dexterityScrollBonusProbability,
  getReturnProtectionRule,
  getReturnProtectedAttemptTransitions,
  getScrollReformCatalog,
  getScrollReformRule,
  listScrollReformRuleIds,
} from "../src/scroll-reform.js";

test("2026-09-17 공식 주문서 규칙 카탈로그를 기준일과 ID로 조회한다", () => {
  const catalog = getScrollReformCatalog("2026-09-17");
  assert.equal(catalog.id, "scroll-2026-09-17");
  assert.equal(catalog.effectiveDate, SCROLL_REFORM_EFFECTIVE_DATE);
  assert.equal(catalog.returnProtection.equipment.cost.amount, 400_000_000);
  assert.equal(catalog.returnProtection.petEquipment.cost.amount, 500_000_000);
  assert.equal(
    getScrollReformRule("petEquipmentInnocent100").cost.amount,
    1_000_000_000,
  );
  assert.equal(
    getScrollReformRule("petEquipmentCleanSlate100").cost.amount,
    60_000_000,
  );
  assert.ok(listScrollReformRuleIds().includes("earringAttackDex10"));

  assert.throws(
    () => getScrollReformCatalog("2026-09-16"),
    /지원하지 않는 주문서 개편 기준일/u,
  );
  assert.throws(
    () => getScrollReformRule("unknown-scroll"),
    /지원하지 않는 개편 주문서/u,
  );
});

test("귀 장식 10% 주문서는 손재주와 길드 보정으로 최대 24%가 된다", () => {
  assert.equal(dexterityScrollBonusProbability(4), 0);
  assert.equal(dexterityScrollBonusProbability(5), 0.005);
  assert.equal(dexterityScrollBonusProbability(100), 0.1);
  assert.equal(dexterityScrollBonusProbability(999), 0.1);

  for (const scrollId of [
    "earringAttackStr10",
    "earringAttackDex10",
    "earringAttackLuk10",
    "earringInt10",
  ]) {
    const result = calculateMesoScrollAttempt(scrollId, {
      forProduction: false,
      dexterityLevel: 100,
      guildSuccessBonusPercent: 4,
    });
    assert.equal(result.baseSuccessProbability, 0.1);
    assert.equal(result.appliedModifiers.dexterityBonusProbability, 0.1);
    assert.equal(result.appliedModifiers.guildBonusProbability, 0.04);
    assert.equal(result.successProbability, 0.24);
    assert.equal(result.successPercent, 24);
  }

  const clamped = calculateMesoScrollAttempt("earringAttackDex10", {
    forProduction: false,
    dexterityLevel: 999,
    guildSuccessBonusPercent: 999,
  });
  assert.equal(clamped.successProbability, 0.24);
});

test("손재주 보정은 5레벨 단위이고 적용 대상으로 명시된 주문서에만 붙는다", () => {
  const earring = calculateMesoScrollAttempt("earringAttackDex10", {
    forProduction: false,
    dexterityLevel: 9,
    guildSuccessBonusPercent: 2,
  });
  assert.equal(earring.successProbability, 0.125);

  const fixed = calculateMesoScrollAttempt("premiumAccessoryAttack100", {
    forProduction: false,
    dexterityLevel: 100,
    guildSuccessBonusPercent: 4,
  });
  assert.equal(fixed.baseSuccessProbability, 1);
  assert.equal(fixed.successProbability, 1);
  assert.equal(fixed.appliedModifiers.dexterityBonusProbability, 0);
  assert.equal(fixed.appliedModifiers.guildBonusProbability, 0);
});

test("메소 탭에는 피버타임과 주문의 흔적 비용 할인을 적용하지 않는다", () => {
  const regular = calculateMesoScrollAttempt("earringAttackDex10", {
    forProduction: false,
    dexterityLevel: 100,
    guildSuccessBonusPercent: 4,
  });
  const sunday = calculateMesoScrollAttempt("earringAttackDex10", {
    forProduction: false,
    dexterityLevel: 100,
    guildSuccessBonusPercent: 4,
    fever: true,
    traceCostDiscount: true,
  });

  assert.equal(sunday.successProbability, regular.successProbability);
  assert.deepEqual(sunday.cost, regular.cost);
  assert.equal(sunday.cost.amount, 100_000_000);
  assert.deepEqual(sunday.ignoredModifiers, {
    fever: true,
    traceCostDiscount: true,
  });
});

test("미공개 공식 값이 필요한 계산은 readiness 오류로 차단한다", () => {
  assert.throws(
    () => getScrollReformCatalog("2026-09-17", { requireComplete: true }),
    (error) => {
      assert.ok(error instanceof ScrollReformNotReadyError);
      assert.equal(error.code, "SCROLL_REFORM_NOT_READY");
      assert.ok(
        error.pendingOfficialFields.includes(
          "returnProtection.itemEligibilityByScroll",
        ),
      );
      return true;
    },
  );

  assert.throws(
    () => getScrollReformRule("amazingPositiveChaos60"),
    (error) => {
      assert.ok(error instanceof ScrollReformNotReadyError);
      assert.deepEqual(error.pendingOfficialFields, [
        "scrolls.amazingPositiveChaos60.outcomesByStatGroup",
      ]);
      return true;
    },
  );
  assert.equal(
    getScrollReformRule("amazingPositiveChaos60", { allowPending: true })
      .successProbability,
    0.6,
  );
  assert.equal(
    getScrollReformRule("amazingPositiveChaos60", { allowPending: true })
      .outcomesByStatGroup,
    null,
  );

  assert.throws(
    () => getReturnProtectionRule("equipment"),
    (error) => {
      assert.ok(error instanceof ScrollReformNotReadyError);
      assert.ok(
        error.pendingOfficialFields.includes(
          "returnProtection.itemEligibilityByScroll",
        ),
      );
      return true;
    },
  );
  assert.equal(
    getReturnProtectionRule("equipment", {
      allowPendingEligibility: true,
    }).cost.amount,
    400_000_000,
  );
});

test("길드 실패 보호와 리턴 보호를 서로 다른 상태 전이로 모델링한다", () => {
  assert.deepEqual(calculateScrollAttemptTransitions({
    successProbability: 0.24,
    failureSlotProtectionProbability: 0.04,
  }), {
    success: 0.24,
    failurePreserved: 0.0304,
    failureConsumed: 0.7296,
  });

  const returned = getReturnProtectedAttemptTransitions({
    successProbability: 0.6,
    equipmentType: "equipment",
    allowPendingEligibility: true,
    forProduction: false,
  });
  assert.equal(returned.protectionConsumed, true);
  assert.deepEqual(returned.success.choices, [
    "apply-result",
    "restore-before-attempt",
  ]);
  assert.equal(returned.success.restoreScope, "all-options-except-potential");
  assert.equal(returned.failure.upgradeSlotPreserved, true);
});

test("카르마 리턴은 유한 아이템 비용과 교환 불가 장비 조건을 보존한다", () => {
  const karma = getReturnProtectionRule("karma", {
    allowPendingEligibility: true,
  });
  assert.deepEqual(karma.cost, {
    currency: "item",
    itemId: "karma-return-scroll",
    amount: 1,
  });
  assert.equal(karma.equipmentMustBeUntradeable, true);
  assert.equal(karma.acquisition.amount, 6_900);
  assert.equal(karma.acquisition.monthlyLimitPerNexonId, 5);
  assert.equal(karma.effect.protectsExactlyOneScrollAttempt, true);
});

test("준비 계산은 명시적으로 허용하지만 운영 계산은 라이브 검증 전 차단한다", () => {
  assert.doesNotThrow(() => calculateMesoScrollAttempt(
    "premiumAccessoryAttack100",
    { forProduction: false },
  ));
  assert.throws(
    () => calculateMesoScrollAttempt("premiumAccessoryAttack100"),
    /공식 스냅샷 재검증 전/u,
  );
});
