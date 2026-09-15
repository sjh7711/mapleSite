import assert from "node:assert/strict";
import test from "node:test";
import {
  ABILITY_REFORM_2026_09_17,
  REFORM_2026_09_17_PRODUCTION_ACTIVATION,
  REFORM_2026_09_17_SOURCES,
  SCROLL_REFORM_2026_09_17,
  SOUL_REFORM_2026_09_17,
  assertReform20260917Ready,
  evaluateReform20260917ProductionActivation,
  getReform20260917Readiness,
  isReform20260917Effective,
  isReform20260917ScheduledDateReached,
} from "../src/reform-2026-09-17.js";

function sumOutcomes(outcomes) {
  return outcomes.reduce((sum, outcome) => sum + outcome.probability, 0);
}

function assertProbabilitySum(outcomes) {
  assert.ok(Math.abs(sumOutcomes(outcomes) - 1) < 1e-12);
}

test("공식 출처 스냅샷은 메이플스토리 공식 도메인만 사용한다", () => {
  for (const source of Object.values(REFORM_2026_09_17_SOURCES)) {
    assert.equal(new URL(source.url).hostname, "maplestory.nexon.com");
  }
  assert.ok(Object.isFrozen(REFORM_2026_09_17_SOURCES));
});

test("개편 규칙은 정식 서버 적용일 전후를 구분한다", () => {
  assert.equal(isReform20260917ScheduledDateReached("2026-09-16"), false);
  assert.equal(isReform20260917ScheduledDateReached("2026-09-17"), true);
  assert.equal(
    isReform20260917Effective("2026-09-17", {
      domain: "soulAmplification",
      maintenanceCompleted: true,
    }),
    false,
  );
  assert.equal(
    REFORM_2026_09_17_PRODUCTION_ACTIVATION.domains.soulAmplification.liveVerified,
    false,
  );
  assert.throws(
    () => isReform20260917Effective("2026/09/17", { domain: "scroll" }),
    TypeError,
  );
  assert.throws(
    () => isReform20260917Effective("2026-13-17", { domain: "scroll" }),
    RangeError,
  );
});

test("운영 활성화는 영역별 정식 스냅샷·revision·hash를 모두 요구한다", () => {
  const activation = structuredClone(REFORM_2026_09_17_PRODUCTION_ACTIVATION);
  const hash = "a".repeat(64);
  activation.domains.scroll = {
    liveVerified: true,
    verifiedAt: "2026-09-17T12:00:00+09:00",
    revision: "live-2026-09-17-r1",
    catalogDataSha256: hash,
    supportingSources: [],
    expectedLiveSources: [{
      sourceKey: "scrollProbability",
      url: "https://maplestory.nexon.com/Guide/OtherProbability/game/gameOrderSheet",
    }],
    sourceSnapshots: [{
      role: "live-verification",
      environment: "production",
      sourceKey: "scrollProbability",
      url: "https://maplestory.nexon.com/Guide/OtherProbability/game/gameOrderSheet",
      capturedAt: "2026-09-17T11:00:00+09:00",
      rawSha256: hash,
      extractedDataSha256: hash,
      catalogDataSha256: hash,
    }],
  };

  assert.equal(evaluateReform20260917ProductionActivation({
    activation,
    domain: "scroll",
    asOfDate: "2026-09-17",
    maintenanceCompleted: true,
  }), true);
  assert.equal(evaluateReform20260917ProductionActivation({
    activation,
    domain: "ability",
    asOfDate: "2026-09-17",
    maintenanceCompleted: true,
  }), false);

  const invalidMutations = [
    (value) => { value.domains.scroll.sourceSnapshots[0].sourceKey = "wrong"; },
    (value) => { value.domains.scroll.sourceSnapshots[0].catalogDataSha256 = "b".repeat(64); },
    (value) => { value.domains.scroll.sourceSnapshots[0].capturedAt = "2026-09-16T23:59:59+09:00"; },
    (value) => { value.domains.scroll.verifiedAt = "2026-09-17T10:59:59+09:00"; },
    (value) => {
      value.domains.scroll.expectedLiveSources.push({
        sourceKey: "scrollLiveUpdate",
        url: "https://maplestory.nexon.com/news/update/999",
      });
    },
  ];
  for (const mutate of invalidMutations) {
    const invalid = structuredClone(activation);
    mutate(invalid);
    assert.equal(evaluateReform20260917ProductionActivation({
      activation: invalid,
      domain: "scroll",
      asOfDate: "2026-09-17",
      maintenanceCompleted: true,
    }), false);
  }

  activation.domains.scroll.catalogDataSha256 = null;
  assert.equal(evaluateReform20260917ProductionActivation({
    activation,
    domain: "scroll",
    asOfDate: "2026-09-17",
    maintenanceCompleted: true,
  }), false);

  activation.domains.scroll.catalogDataSha256 = hash;
  activation.domains.scroll.sourceSnapshots[0].catalogDataSha256 = hash;
  activation.domains.scroll.sourceSnapshots[0].url =
    "https://maplestory.nexon.com/testworld/news/all/199";
  assert.equal(evaluateReform20260917ProductionActivation({
    activation,
    domain: "scroll",
    asOfDate: "2026-09-17",
    maintenanceCompleted: true,
  }), false);
});

test("주문서 공식 결과 분포와 가격이 보존된다", () => {
  const scrolls = SCROLL_REFORM_2026_09_17.scrolls;
  assertProbabilitySum(scrolls.premiumAccessoryAttack100.outcomes);
  assertProbabilitySum(scrolls.magicalOneHandAttack100.outcomes);
  assertProbabilitySum(scrolls.petEquipmentAttack100.outcomes);
  assertProbabilitySum(
    scrolls.amazingPositiveChaos100.outcomesByStatGroup.standard,
  );
  assert.equal(scrolls.earringAttackStr10.cost.amount, 100_000_000);
  assert.equal(scrolls.amazingPositiveChaos60.cost.amount, 500_000);
  assert.equal(scrolls.amazingPositiveChaos60.outcomesByStatGroup, null);
  assert.equal(scrolls.amazingPositiveChaos100.cost.amount, 300_000_000);
});

test("고급 재설정은 명성치와 메소를 별도 비용으로 유지한다", () => {
  assert.deepEqual(
    ABILITY_REFORM_2026_09_17.methods.advanced.costsByLockedLineCount,
    [
      { lockedLineCount: 0, honor: 20_000, meso: 2_000_000 },
      { lockedLineCount: 1, honor: 30_000, meso: 6_000_000 },
      { lockedLineCount: 2, honor: 40_000, meso: 15_000_000 },
    ],
  );
  assert.deepEqual(
    ABILITY_REFORM_2026_09_17.methods.abyssCirculator.procurement.map(
      ({ currency, amount }) => ({ currency, amount }),
    ),
    [
      { currency: "cash", amount: 4_900 },
      { currency: "maple-credit", amount: 4_900 },
    ],
  );
});

test("증폭과 등업은 준비됐지만 미공개 옵션 기댓값은 차단한다", () => {
  assert.equal(getReform20260917Readiness("soulAmplification").ready, true);
  assert.equal(getReform20260917Readiness("soulPotentialRankUp").ready, true);
  assert.equal(getReform20260917Readiness("soulPotentialOptions").ready, false);
  assert.equal(
    getReform20260917Readiness("soulPotentialAutomaticEnhancement").ready,
    false,
  );
  assert.equal(
    getReform20260917Readiness("soulPotentialOptions").pendingOfficialFields
      .includes("ether.dropRates"),
    false,
  );
  assert.equal(
    getReform20260917Readiness("soulPotentialOptions").pendingOfficialFields
      .includes("potential.automaticEnhancementStopPolicy"),
    false,
  );
  assert.throws(
    () => assertReform20260917Ready("soulPotentialOptions"),
    /아직 운영 계산에 사용할 수 없습니다/,
  );
  assert.doesNotThrow(() =>
    assertReform20260917Ready("soulAmplification", {
      forProduction: false,
    }));
  assert.throws(
    () => assertReform20260917Ready("soulAmplification"),
    /점검 완료 및 해당 영역 공식 스냅샷 재검증 전/,
  );
  assert.equal(SOUL_REFORM_2026_09_17.amplification.stages.length, 4);
  assert.deepEqual(
    SOUL_REFORM_2026_09_17.ether.dropSourcesByStage[4],
    [{ boss: "유피테르", difficulties: ["normal", "hard"] }],
  );
  assert.equal(
    SOUL_REFORM_2026_09_17.amplification.firstStageCreatesPotential,
    true,
  );
  assert.equal(
    SOUL_REFORM_2026_09_17.amplification.higherStageRaisesValuesOnly,
    true,
  );
});

test("정식 서버 예외 확인 전 주문서 운영 전환을 차단한다", () => {
  const readiness = getReform20260917Readiness("scroll");
  assert.equal(readiness.ready, false);
  assert.equal(readiness.readyForCatalogAndEngineDevelopment, true);
  assert.ok(readiness.pendingOfficialFields.length > 0);
  assert.throws(() => assertReform20260917Ready("scroll"));
});
