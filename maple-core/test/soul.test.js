import assert from "node:assert/strict";
import test from "node:test";
import {
  SOUL_REFORM_2026_09_17,
  assertSoulPotentialOptionTablesReady,
  calculateSoulAmplificationExpected,
  calculateSoulAmplificationPath,
  calculateSoulPotentialRankUpExpected,
  calculateSoulPotentialRankUpStage,
  calculateSoulPotentialExpected,
  getSoulPotentialTables,
  getSoulAmplificationChance,
  getSoulAmplificationGauge,
  getSoulAutomaticEnhancementEligibility,
  getSoulEnhancementEligibility,
  getSoulPotentialResetEligibility,
  getSoulPotentialLineGradeDistribution,
  getSoulPotentialRankUpInfo,
  getSoulReapplicationEligibility,
} from "../src/soul.js";

function assertClose(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );
}

const amplificationBenchmarks = [
  {
    stage: 1,
    guaranteeAfterFailures: 25,
    probabilityBeforeGuarantee: 0.29,
    expectedAttempts: 9.178244212102667,
    expectedMeso: 4_589_122_106.051333,
  },
  {
    stage: 2,
    guaranteeAfterFailures: 33,
    probabilityBeforeGuarantee: 0.222,
    expectedAttempts: 12.62428996618909,
    expectedMeso: 12_624_289_966.18909,
  },
  {
    stage: 3,
    guaranteeAfterFailures: 43,
    probabilityBeforeGuarantee: 0.188,
    expectedAttempts: 16.135231279099578,
    expectedMeso: 28_236_654_738.424263,
  },
  {
    stage: 4,
    guaranteeAfterFailures: 50,
    probabilityBeforeGuarantee: 0.162,
    expectedAttempts: 19.11057046599403,
    expectedMeso: 52_554_068_781.48358,
  },
];

test("소울 증폭은 보장 실패 횟수 다음 시도를 확정 성공으로 처리한다", () => {
  for (const benchmark of amplificationBenchmarks) {
    const { stage, guaranteeAfterFailures, probabilityBeforeGuarantee } =
      benchmark;
    const fresh = calculateSoulAmplificationExpected({
      stage,
      forProduction: false,
    });

    assert.equal(fresh.maximumAttempts, guaranteeAfterFailures + 1);
    assertClose(
      getSoulAmplificationChance(stage, guaranteeAfterFailures - 1),
      probabilityBeforeGuarantee,
      1e-12,
    );
    assert.equal(
      getSoulAmplificationChance(stage, guaranteeAfterFailures),
      1,
    );

    const oneFailureBeforeGuarantee = calculateSoulAmplificationExpected({
      stage,
      currentFailures: guaranteeAfterFailures - 1,
      forProduction: false,
    });
    assert.equal(oneFailureBeforeGuarantee.maximumAttempts, 2);
    assertClose(
      oneFailureBeforeGuarantee.attempts[0].successProbabilityGivenAttempt,
      probabilityBeforeGuarantee,
      1e-12,
    );
    assert.equal(
      oneFailureBeforeGuarantee.attempts[1].successProbabilityGivenAttempt,
      1,
    );

    const guaranteeReady = calculateSoulAmplificationExpected({
      stage,
      currentFailures: guaranteeAfterFailures,
      forProduction: false,
    });
    assert.equal(guaranteeReady.maximumAttempts, 1);
    assert.equal(guaranteeReady.expected.attempts, 1);
    assert.equal(guaranteeReady.attempts[0].successProbabilityGivenAttempt, 1);
    assert.equal(guaranteeReady.completionProbability, 1);
  }
});

test("소울 증폭 단계별 공식 기댓값 벤치마크와 자원 소모를 재현한다", () => {
  for (const benchmark of amplificationBenchmarks) {
    const result = calculateSoulAmplificationExpected({
      stage: benchmark.stage,
      forProduction: false,
    });
    assertClose(result.expected.attempts, benchmark.expectedAttempts, 1e-12);
    assertClose(result.expected.etherUsed, benchmark.expectedAttempts, 1e-12);
    assertClose(result.costs.attemptMeso, benchmark.expectedMeso, 1e-5);
    assert.equal(result.costs.etherMeso, 0);
    assertClose(result.completionProbability, 1, 1e-12);
  }

  const fullPath = calculateSoulAmplificationPath({
    currentStage: 0,
    targetStage: 4,
    forProduction: false,
  });
  assertClose(fullPath.expected.attempts, 57.048335923385366, 1e-12);
  assertClose(fullPath.expected.etherUsed, 57.048335923385366, 1e-12);
  assertClose(fullPath.costs.attemptMeso, 98_004_135_592.14827, 1e-4);
  assert.equal(fullPath.costs.etherMeso, 0);
  assertClose(fullPath.costs.totalMeso, 98_004_135_592.14827, 1e-4);
});

test("소울 증폭은 표시 게이지 반올림과 무관하게 실패 횟수를 천장 기준으로 쓴다", () => {
  const stage2 = calculateSoulAmplificationExpected({
    stage: 2,
    currentFailures: 33,
    forProduction: false,
  });
  const stage3 = calculateSoulAmplificationExpected({
    stage: 3,
    currentFailures: 43,
    forProduction: false,
  });

  // 공지의 표시 증가량만 곱하면 각각 99.99%, 100.19%지만 둘 다 보장 상태다.
  assert.equal(0.0303 * 33, 0.9999);
  assert.ok(0.0233 * 43 > 1);
  assert.equal(stage2.currentGauge, 1);
  assert.equal(stage3.currentGauge, 1);
  assert.equal(stage2.currentSuccessProbability, 1);
  assert.equal(stage3.currentSuccessProbability, 1);
  assert.equal(
    SOUL_REFORM_2026_09_17.amplification.resetsPreviousStageGaugeOnSuccess,
    true,
  );
});

test("소울 잠재 등업은 공식 확률·천장·현재 등급 비용을 적용한다", () => {
  const expected = {
    rare: {
      toGrade: "epic",
      probability: 0.015,
      guaranteeAtResetCount: 100,
      resetCostMeso: 20_000_000,
    },
    epic: {
      toGrade: "unique",
      probability: 0.005875,
      guaranteeAtResetCount: 256,
      resetCostMeso: 40_000_000,
    },
    unique: {
      toGrade: "legendary",
      probability: 0.003322,
      guaranteeAtResetCount: 451,
      resetCostMeso: 65_000_000,
    },
  };

  for (const [grade, official] of Object.entries(expected)) {
    const normal = getSoulPotentialRankUpInfo({ grade });
    const miracle = getSoulPotentialRankUpInfo({ grade, miracle: true });
    assert.equal(normal.toGrade, official.toGrade);
    assert.equal(normal.probability, official.probability);
    assert.equal(normal.guaranteeAtResetCount, official.guaranteeAtResetCount);
    assert.equal(normal.resetCostMeso, official.resetCostMeso);
    assertClose(miracle.probability, official.probability * 2, 1e-15);
    assert.equal(miracle.guaranteeAtResetCount, official.guaranteeAtResetCount);

    const atCeiling = calculateSoulPotentialRankUpStage({
      grade,
      currentResetCount: official.guaranteeAtResetCount - 1,
      forProduction: false,
    });
    assert.equal(atCeiling.maximumAttempts, 1);
    assert.equal(atCeiling.expectedAttempts, 1);
    assert.equal(atCeiling.attempts[0].guaranteed, true);
  }
  assert.throws(
    () => getSoulPotentialRankUpInfo({ grade: "rare", miracle: "false" }),
    /boolean/u,
  );
});

test("소울 잠재 레어부터 레전드리까지 일반·미라클 등업 기댓값을 재현한다", () => {
  const normal = calculateSoulPotentialRankUpExpected({
    fromGrade: "rare",
    toGrade: "legendary",
    forProduction: false,
  });
  [
    51.95940596870752,
    132.55218917941755,
    233.9041420461253,
  ].forEach((expectedAttempts, index) => {
    assertClose(
      normal.stages[index].expectedAttempts,
      expectedAttempts,
      1e-11,
    );
  });
  assertClose(normal.expectedAttempts, 418.4157371942504, 1e-10);
  assertClose(normal.expectedCostMeso, 21_545_044_919.548996, 1e-3);
  assert.equal(normal.maximumAttempts, 807);

  const miracle = calculateSoulPotentialRankUpExpected({
    fromGrade: "rare",
    toGrade: "legendary",
    miracle: true,
    forProduction: false,
  });
  [
    31.74824973581981,
    80.97715534348478,
    143.06632355854126,
  ].forEach((expectedAttempts, index) => {
    assertClose(
      miracle.stages[index].expectedAttempts,
      expectedAttempts,
      1e-11,
    );
  });
  assertClose(miracle.expectedAttempts, 255.79172863784585, 1e-10);
  assertClose(miracle.expectedCostMeso, 13_173_362_239.760967, 1e-3);
  assert.equal(miracle.maximumAttempts, 807);
});

test("공식 반올림 하위 줄 확률은 계산용 분포에서 합계 1로 정규화한다", () => {
  const expectedGrades = {
    rare: ["rare", "normal"],
    epic: ["epic", "rare"],
    unique: ["unique", "epic"],
    legendary: ["legendary", "unique"],
  };

  for (const [grade, lowerGrades] of Object.entries(expectedGrades)) {
    const distribution = getSoulPotentialLineGradeDistribution(grade);
    assert.deepEqual(Object.keys(distribution.first), [grade]);
    assert.equal(distribution.first[grade], 1);
    assert.deepEqual(Object.keys(distribution.lower), lowerGrades);
    assertClose(
      Object.values(distribution.lower).reduce((sum, value) => sum + value, 0),
      1,
      1e-12,
    );
  }
});

test("소울 증폭·잠재 재설정 공식 사용 조건을 판정한다", () => {
  assert.deepEqual(
    getSoulEnhancementEligibility({
      weaponLevel: 200,
      soulType: "magnificent",
    }),
    { eligible: true, reasons: [] },
  );

  assert.deepEqual(
    getSoulReapplicationEligibility({
      amplificationStage: 1,
      newSoulType: "normal",
    }),
    {
      eligible: false,
      reasons: ["magnificent-soul-required-for-amplified-weapon"],
    },
  );
  assert.deepEqual(
    getSoulReapplicationEligibility({
      amplificationStage: 1,
      newSoulType: "magnificent",
    }),
    { eligible: true, reasons: [] },
  );

  assert.deepEqual(
    getSoulEnhancementEligibility({
      weaponLevel: 199,
      soulType: "normal",
      temporary: true,
      sealedGenesis: true,
    }),
    {
      eligible: false,
      reasons: [
        "weapon-level-below-200",
        "magnificent-soul-required",
        "temporary-weapon",
        "genesis-second-release-quest-required",
      ],
    },
  );

  assert.deepEqual(
    getSoulEnhancementEligibility({
      weaponLevel: 200,
      soulType: "magnificent",
      genesisWeapon: true,
      genesisSecondReleaseQuestCompleted: false,
    }),
    {
      eligible: false,
      reasons: ["genesis-second-release-quest-required"],
    },
  );
  assert.deepEqual(
    getSoulEnhancementEligibility({
      weaponLevel: 200,
      soulType: "magnificent",
      genesisWeapon: true,
      genesisSecondReleaseQuestCompleted: true,
    }),
    { eligible: true, reasons: [] },
  );

  assert.deepEqual(
    getSoulPotentialResetEligibility({
      weaponLevel: 200,
      soulType: "magnificent",
      amplificationStage: 0,
    }),
    { eligible: false, reasons: ["soul-amplification-required"] },
  );
  assert.deepEqual(
    getSoulPotentialResetEligibility({
      weaponLevel: 200,
      soulType: "magnificent",
      amplificationStage: 1,
    }),
    { eligible: true, reasons: [] },
  );
  assert.equal(getSoulAutomaticEnhancementEligibility({
    weaponLevel: 200,
    soulType: "magnificent",
    amplificationStage: 1,
    potentialGrade: "unique",
  }).eligible, false);
  assert.equal(getSoulAutomaticEnhancementEligibility({
    weaponLevel: 200,
    soulType: "magnificent",
    amplificationStage: 1,
    potentialGrade: "legendary",
  }).eligible, true);
});

test("현재 등급의 천장 진행만 이어받고 등업 후 진행은 0에서 시작한다", () => {
  const path = calculateSoulPotentialRankUpExpected({
    fromGrade: "rare",
    toGrade: "legendary",
    currentResetCount: 99,
    forProduction: false,
  });
  assert.deepEqual(
    path.stages.map((stage) => stage.currentResetCount),
    [99, 0, 0],
  );
  assert.equal(path.maximumAttempts, 1 + 256 + 451);
  assert.throws(
    () => calculateSoulPotentialRankUpExpected({
      fromGrade: "rare",
      toGrade: "legendary",
      resetCountByGrade: { epic: 255 },
      forProduction: false,
    }),
    /미래 등급의 천장 진행은 미리 지정할 수 없습니다/u,
  );
});

test("소울 옵션뽑기는 네 등급과 네 증폭 단계의 공식 표를 고정하여 계산한다", () => {
  const costs = { rare: 20_000_000, epic: 40_000_000, unique: 65_000_000, legendary: 88_000_000 };
  for (const [grade, cost] of Object.entries(costs)) {
    for (const stage of [1, 2, 3, 4]) {
      const tables = getSoulPotentialTables({ grade, stage });
      const lines = tables.map((table) => {
        const total = table.reduce((sum, option) => sum + option.probability, 0);
        return table.map((option) => ({
          attack: Number(option.name.match(/^공격력 \+([\d.]+)%$/)?.[1] ?? 0),
          probability: option.probability / total,
        }));
      });
      let expectedProbability = 0;
      for (const first of lines[0]) for (const second of lines[1]) for (const third of lines[2]) {
        if (first.attack + second.attack + third.attack >= 1.5) {
          expectedProbability += first.probability * second.probability * third.probability;
        }
      }
      const result = calculateSoulPotentialExpected({
        grade, stage, mainStat: "STR", targetType: "attack-power-percent", target: 1.5,
      });
      assertClose(result.rawProbability, expectedProbability, 1e-12);
      assert.equal(result.resetCost, cost);
      assert.ok(Number.isFinite(result.expectedResets) && result.expectedResets > 0);
      assertClose(result.expectedCost / result.expectedResets, cost, 1e-6);
    }
  }
});

test("소울 옵션뽑기는 하위 등급에 없는 목표를 등급 상승으로 달성한 것으로 계산하지 않는다", () => {
  const goal = { stage: 4, mainStat: "STR", targetType: "boss-damage", target: 1 };
  for (const grade of ["rare", "epic"]) {
    const result = calculateSoulPotentialExpected({ ...goal, grade });
    assert.equal(result.probability, 0);
    assert.equal(result.expectedResets, Infinity);
    assert.equal(result.expectedCost, Infinity);
  }
  assert.ok(calculateSoulPotentialExpected({ ...goal, grade: "legendary" }).probability > 0);
  assert.throws(() => calculateSoulPotentialExpected({ ...goal, grade: "normal" }), /등급과 증폭 단계/);
});

test("공식 소울 잠재 옵션표는 공개됐지만 초기 부여 및 등업 직후 통합 모델은 보류한다", () => {
  assert.ok(SOUL_REFORM_2026_09_17.potential.optionTypeWeights.snapshot);
  assert.deepEqual(SOUL_REFORM_2026_09_17.potential.optionValuesByAmplificationStage.stages, [1, 2, 3, 4]);
  assert.doesNotThrow(() => assertSoulPotentialOptionTablesReady());
  assert.throws(() => assertSoulPotentialOptionTablesReady({ forInitialCreation: true }), /initialGradeAtStageOne/);
  assert.throws(() => assertSoulPotentialOptionTablesReady({ forRankUp: true }), /rankUpResultRollOrder/);
});

test("소울 증폭·잠재 천장 진행 입력 범위를 검증한다", () => {
  assert.throws(() => getSoulAmplificationChance(1, 26), /25회를 넘을 수 없습니다/);
  assert.throws(() => getSoulAmplificationGauge(1, 26), /25회를 넘을 수 없습니다/);
  assert.throws(
    () => calculateSoulAmplificationExpected({
      stage: 1,
      currentFailures: 26,
      forProduction: false,
    }),
    /25회를 넘을 수 없습니다/,
  );
  assert.throws(
    () => calculateSoulPotentialRankUpStage({
      grade: "rare",
      currentResetCount: 100,
      forProduction: false,
    }),
    /99회를 넘을 수 없습니다/,
  );
});

test("연구 계산은 명시적으로 허용하지만 운영 계산은 라이브 검증 전 차단한다", () => {
  assert.doesNotThrow(() => calculateSoulAmplificationExpected({
    stage: 1,
    forProduction: false,
  }));
  assert.throws(
    () => calculateSoulAmplificationExpected({ stage: 1 }),
    /공식 스냅샷 재검증 전/u,
  );
  assert.throws(
    () => calculateSoulPotentialRankUpExpected({
      fromGrade: "rare",
      toGrade: "epic",
    }),
    /공식 스냅샷 재검증 전/u,
  );
});
