import assert from "node:assert/strict";
import test from "node:test";
import {
  EXACT_POTENTIAL_TARGET_PREFIX,
  POTENTIAL_PAGE_TARGETS,
  POTENTIAL_TARGETS,
  calculateCombinedPotentialExpected,
  calculatePotentialRankUpExpected,
  calculatePotentialRankUpReachForChance,
  calculatePotentialExpected,
  calculatePotentialOptionStatEquivalent,
  calculatePotentialOptionsStatEquivalent,
  calculateResetsForChance,
  convertPotentialTargetToEquivalents,
  decodeExactPotentialTargetType,
  encodeExactPotentialTargetType,
  getAvailablePotentialResetMethods,
  getAvailablePotentialTargetTypes,
  getPotentialCubeRevealCost,
  getPotentialRankUpInfo,
  getPotentialResetCost,
  getPotentialResetMethod,
  parsePotentialOption,
} from "maple-core/potential";
import { calculateIgnoreDefenseEquivalent } from "maple-core/stat-efficiency";

const statEquivalence = {
  flatMainStatToPercent: 0.10762100926879505,
  flatSubStatToFlatMainStat: 0.1371610845295056,
  attackToMainStat: 2.949101581809766,
  allStatPercentToMainPercent: 1.1201081359423273,
  subStatPercentToMainPercent: 0.12010813594232728,
  criticalDamageToMainPercent: 3.9053223711194627,
  attackPercentToMainPercent: 5.067878984374007,
  bossDamageToMainPercent: 1.4309305367644254,
  currentIgnoreDefense: 0.984930112,
  oneMainPercentRelative: 0.0009135241081928656,
};

const common = {
  mainStat: "INT",
  subStat: "LUK",
  attackType: "magic",
  characterLevel: 286,
  itemLevel: 200,
  grade: "legendary",
  system: "regular",
  statEquivalence,
  enemyDefense: 380,
};

test("통합 잠재는 윗잠과 에디셔널의 목표 분담 중 비용이 낮은 조합을 고른다", () => {
  const result = calculateCombinedPotentialExpected({
    ...common,
    itemLevel: 250,
    regularTables: [
      [
        { name: "INT +2%", probability: 50 },
        { name: "INT +0%", probability: 50 },
      ],
    ],
    additionalTables: [
      [
        { name: "INT +1%", probability: 50 },
        { name: "INT +0%", probability: 50 },
      ],
    ],
    targets: [{ targetType: "int-percent", target: 3 }],
  });

  assert.equal(result.possible, true);
  assert.equal(result.regular.requirements[0].target, 2);
  assert.equal(result.additional.requirements[0].target, 1);
  assert.equal(result.regular.rawProbability, 0.5);
  assert.equal(result.additional.rawProbability, 0.5);
  assert.equal(result.regular.expectedResets, 1);
  assert.equal(result.additional.expectedResets, 1);
  assert.equal(result.expectedCost, 148_000_000);
});

test("통합 잠재는 실행 중 목표를 바꾸지 않고 고정 분담 전략을 유지한다", () => {
  const result = calculateCombinedPotentialExpected({
    ...common,
    itemLevel: 250,
    regularTables: [[
      { name: "INT +2%", probability: 25 },
      { name: "LUK +2%", probability: 25 },
      { name: "INT +0%", probability: 50 },
    ]],
    additionalTables: [[
      { name: "INT +2%", probability: 25 },
      { name: "LUK +2%", probability: 25 },
      { name: "INT +0%", probability: 50 },
    ]],
    targets: [
      { targetType: "int-percent", target: 2 },
      { targetType: "luk-percent", target: 2 },
    ],
  });

  assert.equal(result.strategyMode, "fixed-allocation");
  assert.equal(result.regular.requirements[0].target, 2);
  assert.equal(result.regular.requirements[1].target, 0);
  assert.equal(result.additional.requirements[0].target, 0);
  assert.equal(result.additional.requirements[1].target, 2);
  assert.equal(result.regular.expectedResets, 2.25);
  assert.equal(result.additional.expectedResets, 2.25);
  assert.equal(result.expectedCost, 333_000_000);
});

test("현재와 같은 잠재 결과를 제외한 다음 결과 확률을 적용한다", () => {
  const result = calculatePotentialExpected({
    ...common,
    tables: [[
      { name: "INT +12%", probability: 50 },
      { name: "기타", probability: 50 },
    ]],
    targetType: "int-percent",
    target: 12,
  });

  assert.equal(result.rawProbability, 0.5);
  assert.equal(result.probability, 1);
  assert.equal(result.expectedResets, 1);
  assert.equal(result.sameResultExcluded, true);
});

test("잠재·에디셔널 등급에 맞는 재설정 수단만 제공한다", () => {
  assert.deepEqual(
    getAvailablePotentialResetMethods("regular", "legendary")
      .map(({ id }) => id),
    ["meso", "black", "gold", "prime"],
  );
  assert.deepEqual(
    getAvailablePotentialResetMethods("regular", "unique")
      .map(({ id }) => id),
    ["meso", "black", "gold", "silver"],
  );
  assert.deepEqual(
    getAvailablePotentialResetMethods("regular", "epic")
      .map(({ id }) => id),
    ["meso", "black", "gold", "silver", "occult"],
  );
  assert.deepEqual(
    getAvailablePotentialResetMethods("additional", "legendary")
      .map(({ id }) => id),
    ["meso", "white", "prime"],
  );
  assert.deepEqual(
    getAvailablePotentialResetMethods("additional", "epic")
      .map(({ id }) => id),
    ["meso", "white", "bronze"],
  );
  assert.equal(getPotentialResetMethod("regular", "gold").tableSource, "regular-gold");
  assert.equal(
    getPotentialResetMethod("additional", "bronze").tableSource,
    "additional-bronze",
  );
});

test("큐브마다 다른 등급 상승 확률·천장·미라클 타임을 적용한다", () => {
  const rankRates = (system, method) =>
    getPotentialResetMethod(system, method).rankUp;
  assert.deepEqual(rankRates("regular", "meso"), {
    rare: 0.150000001275,
    epic: 0.035,
    unique: 0.014,
  });
  assert.deepEqual(rankRates("regular", "black"), rankRates("regular", "meso"));
  assert.deepEqual(rankRates("regular", "gold"), {
    rare: 0.079994,
    epic: 0.016959,
    unique: 0.001996,
  });
  assert.deepEqual(rankRates("regular", "silver"), {
    rare: 0.047619,
    epic: 0.011858,
  });
  assert.deepEqual(rankRates("regular", "occult"), { rare: 0.009901 });
  assert.deepEqual(rankRates("additional", "meso"), {
    rare: 0.02381,
    epic: 0.009804,
    unique: 0.007,
  });
  assert.deepEqual(rankRates("additional", "white"), {
    rare: 0.047619,
    epic: 0.019608,
    unique: 0.007,
  });
  assert.deepEqual(rankRates("additional", "bronze"), { rare: 0.004 });

  assert.deepEqual(
    getPotentialRankUpInfo({
      system: "regular",
      method: "gold",
      grade: "unique",
    }),
    {
      canRankUp: true,
      fromGrade: "unique",
      toGrade: "legendary",
      maxGrade: "legendary",
      probability: 0.001996,
      pity: null,
    },
  );
  assert.equal(
    getPotentialRankUpInfo({
      system: "regular",
      method: "gold",
      grade: "unique",
      miracle: true,
    }).probability,
    0.003992,
  );
  assert.equal(
    getPotentialRankUpInfo({
      system: "additional",
      method: "meso",
      grade: "epic",
    }).pity,
    152,
  );
  assert.equal(
    getPotentialRankUpInfo({
      system: "additional",
      method: "white",
      grade: "epic",
    }).pity,
    76,
  );
  assert.equal(
    getPotentialRankUpInfo({
      system: "regular",
      method: "silver",
      grade: "unique",
    }).canRankUp,
    false,
  );
});

test("레어부터 레전드리까지 등급 상승 기댓값과 비용을 누적한다", () => {
  const result = calculatePotentialRankUpExpected({
    system: "regular",
    method: "meso",
    fromGrade: "rare",
    toGrade: "legendary",
    itemLevel: 200,
    rankProgress: 9,
  });

  assert.deepEqual(
    result.stages.map(({ fromGrade, toGrade }) => [fromGrade, toGrade]),
    [
      ["rare", "epic"],
      ["epic", "unique"],
      ["unique", "legendary"],
    ],
  );
  assert.ok(Math.abs(result.stages[0].expectedAttempts - 1) < 1e-12);
  assert.equal(result.stages[0].remaining, 1);
  assert.equal(result.stages[1].progress, 0);
  assert.equal(result.maximumAttempts, 1 + 42 + 107);
  assert.equal(
    result.expectedAttempts,
    result.stages.reduce((sum, stage) => sum + stage.expectedAttempts, 0),
  );
  assert.equal(
    result.expectedCost,
    result.stages.reduce((sum, stage) => sum + stage.expectedCost, 0),
  );
  assert.deepEqual(
    result.stages.map(({ resetCost }) => resetCost),
    [4_500_000, 18_000_000, 38_250_000],
  );
});

test("다단계 등업은 각 등급의 현재 천장 진행도를 모두 반영한다", () => {
  const result = calculatePotentialRankUpExpected({
    system: "regular",
    method: "meso",
    fromGrade: "rare",
    toGrade: "legendary",
    itemLevel: 200,
    rankProgressByGrade: {
      rare: 9,
      epic: 41,
      unique: 106,
    },
  });

  assert.deepEqual(
    result.stages.map(({ progress, remaining }) => ({ progress, remaining })),
    [
      { progress: 9, remaining: 1 },
      { progress: 41, remaining: 1 },
      { progress: 106, remaining: 1 },
    ],
  );
  for (const stage of result.stages) {
    assert.ok(Math.abs(stage.expectedAttempts - 1) < 1e-12);
  }
  assert.ok(Math.abs(result.expectedAttempts - 3) < 1e-12);
  assert.equal(result.maximumAttempts, 3);
  assert.ok(
    Math.abs(
      result.expectedCost - (4_500_000 + 18_000_000 + 38_250_000),
    ) < 1e-6,
  );
});

test("아이템 큐브의 다단계 등업은 감정비까지 합산한다", () => {
  const result = calculatePotentialRankUpExpected({
    system: "additional",
    method: "white",
    fromGrade: "rare",
    toGrade: "legendary",
    itemLevel: 250,
    miracle: true,
  });

  assert.equal(result.stages.length, 3);
  assert.equal(result.usesMeso, false);
  assert.deepEqual(
    result.stages.map(({ resetCost }) => resetCost),
    [1_250_000, 1_250_000, 1_250_000],
  );
  assert.equal(
    result.expectedCost,
    result.stages.reduce((sum, stage) => sum + stage.expectedCost, 0),
  );
  assert.equal(result.maximumAttempts, 31 + 76 + 214);
  assert.ok(result.expectedAttempts > 0);
  const reach = calculatePotentialRankUpReachForChance(result, 0.95);
  assert.equal(reach.cost, reach.attempts * 1_250_000);
  assert.throws(
    () => calculatePotentialRankUpExpected({
      system: "additional",
      method: "white",
      fromGrade: "unique",
      toGrade: "epic",
      itemLevel: 250,
    }),
    /목표 등급은 현재 등급보다 높고/,
  );
});

test("다단계 등업의 목표 도달 확률은 천장과 등급별 비용을 함께 반영한다", () => {
  const plan = calculatePotentialRankUpExpected({
    system: "regular",
    method: "meso",
    fromGrade: "rare",
    toGrade: "legendary",
    itemLevel: 200,
    rankProgressByGrade: { rare: 9, epic: 41, unique: 106 },
  });
  const reach = calculatePotentialRankUpReachForChance(plan, 0.9999);

  assert.equal(reach.attempts, 3);
  assert.equal(
    reach.cost,
    plan.stages.reduce((sum, stage) => sum + stage.resetCost, 0),
  );
});

test("천장이 없는 한 단계 등업의 목표 횟수는 독립 시행 공식과 같다", () => {
  const plan = calculatePotentialRankUpExpected({
    system: "regular",
    method: "gold",
    fromGrade: "unique",
    toGrade: "legendary",
    itemLevel: 200,
  });
  const reach = calculatePotentialRankUpReachForChance(plan, 0.95);

  assert.equal(
    reach.attempts,
    calculateResetsForChance(plan.stages[0].probability, 0.95),
  );
  assert.equal(reach.cost, reach.attempts * 800_000);
});

test("여러 천장 단계의 누적 횟수와 비용 분위수를 정확히 합성한다", () => {
  const reach = calculatePotentialRankUpReachForChance({
    stages: [
      { probability: 0.5, remaining: 2, resetCost: 2 },
      { probability: 0.5, remaining: 2, resetCost: 3 },
    ],
  }, 0.75);

  assert.equal(reach.attempts, 3);
  assert.equal(reach.cost, 8);
});

test("큐브 감정비는 장비 레벨 구간별 공식으로 계산한다", () => {
  assert.deepEqual(
    [30, 31, 70, 71, 120, 121, 150, 200, 250].map(
      getPotentialCubeRevealCost,
    ),
    [0, 480, 2_450, 12_602, 36_000, 292_820, 450_000, 800_000, 1_250_000],
  );
  assert.throws(() => getPotentialCubeRevealCost(-1), /장비 레벨/);
  assert.throws(() => getPotentialCubeRevealCost(Number.NaN), /장비 레벨/);
});

test("아이템 큐브는 재설정마다 장비 레벨별 감정비를 만든다", () => {
  assert.equal(getPotentialResetCost(200, "legendary", "regular"), 45_000_000);
  assert.equal(
    getPotentialResetCost(200, "legendary", "regular", "black"),
    800_000,
  );
  assert.equal(
    getPotentialResetCost(200, "legendary", "additional", "white"),
    800_000,
  );
  assert.throws(
    () => getPotentialResetCost(200, "legendary", "regular", "silver"),
    /선택한 등급/,
  );

  const result = calculatePotentialExpected({
    ...common,
    resetMethod: "gold",
    tables: ["INT +12%", "INT +9%", "INT +9%"].map((name) => [
      { name, probability: 100 },
    ]),
    targetType: "int-percent",
    target: 30,
  });
  assert.equal(result.probability, 1);
  assert.equal(result.expectedResets, 1);
  assert.equal(result.resetCost, 800_000);
  assert.equal(result.expectedCost, 800_000);
});

test("30레벨 이하 큐브의 무료 감정비도 목표 도달 비용 0으로 유지한다", () => {
  const plan = calculatePotentialRankUpExpected({
    system: "regular",
    method: "gold",
    fromGrade: "unique",
    toGrade: "legendary",
    itemLevel: 30,
  });
  const reach = calculatePotentialRankUpReachForChance(plan, 0.95);

  assert.equal(plan.usesMeso, false);
  assert.equal(plan.stages[0].resetCost, 0);
  assert.equal(plan.expectedCost, 0);
  assert.equal(reach.cost, 0);
});

test("잠재 옵션 한 줄을 전체 성공 판정과 같은 주스탯 %급으로 환산한다", () => {
  assert.equal(
    calculatePotentialOptionStatEquivalent({
      ...common,
      optionName: "INT +12%",
    }),
    12,
  );
  assert.equal(
    calculatePotentialOptionStatEquivalent({
      ...common,
      optionName: "LUK +12%",
    }),
    12 * statEquivalence.subStatPercentToMainPercent,
  );
  assert.equal(
    calculatePotentialOptionStatEquivalent({
      ...common,
      optionName: "올스탯 +9%",
    }),
    9 * statEquivalence.allStatPercentToMainPercent,
  );
  assert.equal(
    calculatePotentialOptionStatEquivalent({
      ...common,
      optionName: "마력 +12%",
    }),
    0,
  );
  assert.equal(
    calculatePotentialOptionStatEquivalent({
      ...common,
      optionName: "마력 +12",
    }),
    12 * statEquivalence.attackToMainStat * statEquivalence.flatMainStatToPercent,
  );
  assert.equal(
    calculatePotentialOptionStatEquivalent({
      ...common,
      optionName: "캐릭터 기준 9레벨 당 INT +2",
    }),
    2 * Math.floor(common.characterLevel / 9) * statEquivalence.flatMainStatToPercent,
  );
  assert.equal(
    calculatePotentialOptionStatEquivalent({
      ...common,
      optionName: "크리티컬 데미지 +8%",
    }),
    8 * statEquivalence.criticalDamageToMainPercent,
  );
  assert.equal(
    calculatePotentialOptionStatEquivalent({
      ...common,
      optionName: "크리티컬 데미지 +8%",
      includeCriticalDamage: false,
    }),
    0,
  );
  assert.throws(
    () => calculatePotentialOptionStatEquivalent({ ...common, optionName: "" }),
    /옵션 이름/,
  );
});

test("이중 부스탯 잠재는 DEX·STR의 개별 환산 계수를 모두 사용한다", () => {
  const dualEquivalence = {
    flatMainStatToPercent: 0.1,
    flatSubStatToFlatMainStat: 0.2,
    flatStatToFlatMainStatByStat: { LUK: 1, DEX: 0.2, STR: 0.3 },
    attackToMainStat: 3,
    allStatPercentToMainPercent: 1.25,
    subStatPercentToMainPercent: 0.1,
    statPercentToMainPercentByStat: { LUK: 1, DEX: 0.1, STR: 0.15 },
    criticalDamageToMainPercent: 4,
    attackPercentToMainPercent: 6,
    bossDamageToMainPercent: 2,
  };
  const context = {
    mainStat: "LUK",
    subStat: "DEX",
    subStats: ["DEX", "STR"],
    attackType: "attack",
    characterLevel: 280,
    itemLevel: 200,
    grade: "legendary",
    system: "regular",
    statEquivalence: dualEquivalence,
  };
  const optionNames = [
    "LUK +9%",
    "DEX +6%",
    "STR +6%",
    "올스탯 +3%",
    "DEX +20",
    "STR +20",
  ];

  assert.equal(
    calculatePotentialOptionsStatEquivalent({ ...context, optionNames }),
    9 + 6 * 0.1 + 6 * 0.15 + 3 * 1.25 + 20 * 0.2 * 0.1 + 20 * 0.3 * 0.1,
  );
  // subStats를 안 보내는 기존 호출은 subStat 하나만 계산한다.
  assert.equal(
    calculatePotentialOptionsStatEquivalent({
      ...context,
      subStats: undefined,
      optionNames: ["DEX +6%", "STR +6%"],
    }),
    6 * 0.1,
  );

  const fixedTables = ["LUK +9%", "DEX +6%", "STR +6%"].map((name) => [
    { name, probability: 100 },
  ]);
  assert.equal(
    calculatePotentialExpected({
      ...context,
      tables: fixedTables,
      targetType: "stat-equivalent",
      target: 10.5,
    }).probability,
    1,
  );
  assert.equal(
    calculatePotentialExpected({
      ...context,
      subStats: undefined,
      tables: fixedTables,
      targetType: "stat-equivalent",
      target: 10.5,
    }).probability,
    0,
  );

  assert.deepEqual(
    convertPotentialTargetToEquivalents({
      ...context,
      targetType: "str-percent",
      target: 20,
    }),
    { mainStatPercent: 3, attackPercent: 0.5 },
  );
  assert.deepEqual(
    convertPotentialTargetToEquivalents({
      ...context,
      targetType: "str-flat",
      target: 20,
    }),
    {
      mainStatPercent: 20 * 0.3 * 0.1,
      attackPercent: (20 * 0.3 * 0.1) / 6,
    },
  );
  assert.deepEqual(
    convertPotentialTargetToEquivalents({
      ...context,
      targetType: "all-stat-flat",
      target: 20,
    }),
    { mainStatPercent: 3, attackPercent: 0.5 },
  );
});

test("한 줄 환산값 합계는 기존 세 줄 성공 판정의 경계와 일치한다", () => {
  const names = ["INT +9%", "올스탯 +6%", "마력 +12"];
  const tables = names.map((name) => [{ name, probability: 100 }]);
  const score = names.reduce(
    (sum, optionName) => sum + calculatePotentialOptionStatEquivalent({
      ...common,
      optionName,
    }),
    0,
  );
  assert.equal(
    calculatePotentialOptionsStatEquivalent({
      ...common,
      optionNames: names,
    }),
    score,
  );

  assert.equal(
    calculatePotentialExpected({
      ...common,
      tables,
      targetType: "stat-equivalent",
      target: score,
    }).probability,
    1,
  );
  assert.equal(
    calculatePotentialExpected({
      ...common,
      tables,
      targetType: "stat-equivalent",
      target: score + 1e-9,
    }).probability,
    0,
  );
  assert.throws(
    () => calculatePotentialOptionsStatEquivalent({
      ...common,
      optionNames: [],
    }),
    /하나 이상/,
  );
});

test("제논은 STR·DEX·LUK를 올스탯 1% 기준의 동적 계수로 합산한다", () => {
  const statEquivalence = {
    statPercentToMainPercentByStat: { STR: 0.25, DEX: 0.35, LUK: 0.4 },
    flatStatToMainPercentByStat: { STR: 0.01, DEX: 0.012, LUK: 0.014 },
    flatAttackToMainPercent: 0.2,
    allStatPercentToMainPercent: 1,
    criticalDamageToMainPercent: 4,
  };
  const context = {
    mainStat: "ALL",
    subStat: null,
    subStats: [],
    attackType: "attack",
    characterLevel: 295,
    statEquivalence,
  };
  const optionNames = [
    "올스탯 +9%",
    "LUK +7%",
    "캐릭터 기준 9레벨 당 DEX +1",
  ];
  const expected = 9 + 7 * 0.4 + Math.floor(295 / 9) * 0.012;

  assert.equal(
    calculatePotentialOptionsStatEquivalent({ ...context, optionNames }),
    expected,
  );
  assert.equal(
    calculatePotentialExpected({
      ...context,
      tables: optionNames.map((name) => [{ name, probability: 100 }]),
      targetType: "stat-equivalent",
      target: expected,
      itemLevel: 250,
      grade: "legendary",
      system: "additional",
    }).probability,
    1,
  );
});

test("목표 누적 확률에 도달하는 최소 재설정 횟수를 안정적으로 계산한다", () => {
  assert.equal(calculateResetsForChance(0.1, 0.5), 7);
  assert.equal(calculateResetsForChance(0.1, 0.95), 29);
  assert.equal(calculateResetsForChance(0, 0.5), Infinity);
  assert.equal(calculateResetsForChance(1, 0.9999), 1);
  assert.equal(calculateResetsForChance(1e-12, 0.0001), 100_005_001);
  assert.throws(() => calculateResetsForChance(-0.1, 0.5), RangeError);
  assert.throws(() => calculateResetsForChance(0.1, 1), RangeError);
});

test("기존 주스탯 %급은 공마%·보공·방무를 계속 제외한다", () => {
  const tables = [
    [{ name: "마력 +12%", probability: 100 }],
    [{ name: "보스 몬스터 데미지 +40%", probability: 100 }],
    [{ name: "몬스터 방어율 무시 +40%", probability: 100 }],
  ];

  assert.equal(
    calculatePotentialExpected({
      ...common,
      tables,
      targetType: "stat-equivalent",
      target: 0.0001,
    }).probability,
    0,
  );
});

test("보스전 주스탯% 환산은 공마%와 보공·데미지를 개인 계수로 합산한다", () => {
  assert.deepEqual(POTENTIAL_TARGETS["boss-stat-equivalent"], {
    label: "보스전 주스탯% 환산",
    unit: "%",
  });
  assert.equal(parsePotentialOption("데미지 +10%").damage, 10);

  const tables = [
    [{ name: "마력 +12%", probability: 100 }],
    [{ name: "보스 몬스터 데미지 +40%", probability: 100 }],
    [{ name: "데미지 +10%", probability: 100 }],
  ];
  const score =
    12 * statEquivalence.attackPercentToMainPercent +
    50 * statEquivalence.bossDamageToMainPercent;

  assert.equal(
    calculatePotentialExpected({
      ...common,
      tables,
      targetType: "boss-stat-equivalent",
      target: score - 1e-8,
    }).probability,
    1,
  );
  assert.equal(
    calculatePotentialExpected({
      ...common,
      tables,
      targetType: "boss-stat-equivalent",
      target: score + 1e-8,
    }).probability,
    0,
  );
});

test("웹 목표 목록은 개별 스탯 옵션과 실제 등장 목표만 반환한다", () => {
  const weaponTables = [
    [
      { name: "STR +12%", probability: 25 },
      { name: "올스탯 +9%", probability: 25 },
    ],
    [
      { name: "공격력 +12%", probability: 25 },
      { name: "몬스터 방어율 무시 +40%", probability: 25 },
    ],
    [{ name: "보스 몬스터 데미지 +40%", probability: 50 }],
  ];
  assert.deepEqual(getAvailablePotentialTargetTypes(weaponTables, { part: 1 }), [
    "stat-equivalent",
    "str-percent",
    "dex-percent",
    "int-percent",
    "luk-percent",
    "all-stat-percent",
    "attack-power-percent",
    "boss-damage",
    "ignore-defense",
  ]);
  assert.equal(POTENTIAL_PAGE_TARGETS["attack-percent"], undefined);
  assert.equal(POTENTIAL_PAGE_TARGETS["attack-power-percent"].label, "공격력 %");
  assert.equal(POTENTIAL_PAGE_TARGETS["magic-power-percent"].label, "마력 %");
  assert.deepEqual(POTENTIAL_TARGETS["attack-percent"], {
    label: "공격력/마력%",
    unit: "%",
  });

  const accessoryTables = [
    [{ name: "메소 획득량 +20%", probability: 50 }],
    [{ name: "아이템 드롭률 +20%", probability: 50 }],
    [{ name: "STR +12%", probability: 50 }],
  ];
  assert.deepEqual(getAvailablePotentialTargetTypes(accessoryTables, { part: 18 }), [
    "stat-equivalent",
    "str-percent",
    "meso",
    "drop",
  ]);
});

test("웹 목표는 공격력%와 마력%를 분리하고 마력 24%와 방무 30%를 함께 계산한다", () => {
  const tables = [
    [{ name: "마력 +12%", probability: 100 }],
    [{ name: "마력 +12%", probability: 100 }],
    [{ name: "몬스터 방어율 무시 +30%", probability: 100 }],
  ];

  assert.deepEqual(getAvailablePotentialTargetTypes(tables, { part: 2 }), [
    "magic-power-percent",
    "ignore-defense",
  ]);
  assert.equal(
    calculatePotentialExpected({
      tables,
      targets: [
        { targetType: "magic-power-percent", target: 24 },
        { targetType: "ignore-defense", target: 30 },
      ],
      itemLevel: 200,
      grade: "legendary",
    }).probability,
    1,
  );
  assert.equal(
    calculatePotentialExpected({
      tables,
      targets: [
        { targetType: "magic-power-percent", target: 24.001 },
        { targetType: "ignore-defense", target: 30 },
      ],
      itemLevel: 200,
      grade: "legendary",
    }).probability,
    0,
  );
});

test("공격력 12%와 보스 데미지 30%와 방무 30%를 세 조건으로 함께 계산한다", () => {
  const tables = [
    [{ name: "공격력 +12%", probability: 100 }],
    [{ name: "보스 몬스터 데미지 +30%", probability: 100 }],
    [{ name: "몬스터 방어율 무시 +30%", probability: 100 }],
  ];

  assert.equal(
    calculatePotentialExpected({
      tables,
      targets: [
        { targetType: "attack-power-percent", target: 12 },
        { targetType: "boss-damage", target: 30 },
        { targetType: "ignore-defense", target: 30 },
      ],
      itemLevel: 200,
      grade: "legendary",
    }).probability,
    1,
  );
});

test("옵션 세트 내부는 AND, 세트 사이는 중복 없는 OR로 계산한다", () => {
  const tables = [
    [
      { name: "공격력 +12%", probability: 50 },
      { name: "보스 몬스터 데미지 +30%", probability: 50 },
    ],
    [
      { name: "몬스터 방어율 무시 +30%", probability: 50 },
      { name: "공격력 +9%", probability: 50 },
    ],
    [{ name: "기타", probability: 100 }],
  ];
  const attackAndIgnoreDefense = [
    { targetType: "attack-power-percent", target: 12 },
    { targetType: "ignore-defense", target: 30 },
  ];
  const bossDamage = [
    { targetType: "boss-damage", target: 30 },
  ];

  const singleSet = calculatePotentialExpected({
    ...common,
    tables,
    targets: attackAndIgnoreDefense,
  });
  assert.equal(singleSet.rawProbability, 0.25);
  assert.equal(singleSet.probability, 1 / 3);
  const unionSet = calculatePotentialExpected({
    ...common,
    tables,
    targetSets: [attackAndIgnoreDefense, bossDamage],
  });
  assert.equal(unionSet.rawProbability, 0.75);
  assert.equal(unionSet.probability, 1);

  const attack12 = [
    { targetType: "attack-power-percent", target: 12 },
  ];
  const attack21 = [
    { targetType: "attack-power-percent", target: 21 },
  ];
  const subsetUnion = calculatePotentialExpected({
    ...common,
    tables,
    targetSets: [attack12, attack21],
  });
  assert.equal(subsetUnion.rawProbability, 0.5);
  assert.equal(subsetUnion.probability, 2 / 3);
  const duplicateUnion = calculatePotentialExpected({
    ...common,
    tables,
    targetSets: [attack12, attack12],
  });
  assert.equal(duplicateUnion.rawProbability, 0.5);
  assert.equal(duplicateUnion.probability, 2 / 3);
});

test("옵션 세트 합집합은 빈 외부·내부 배열을 거부한다", () => {
  const tables = [
    [{ name: "공격력 +12%", probability: 100 }],
  ];

  assert.throws(
    () => calculatePotentialExpected({
      ...common,
      tables,
      targetSets: [],
    }),
    /하나 이상의 옵션 세트/,
  );
  assert.throws(
    () => calculatePotentialExpected({
      ...common,
      tables,
      targetSets: [[]],
    }),
    /각 옵션 세트에는 하나 이상의 조건/,
  );
});

test("모자는 공식 하위 줄에 다른 옵션이 있어도 요청한 목표만 표시한다", () => {
  const hatTables = [
    [
      { name: "STR +12%", probability: 10 },
      { name: "DEX +12%", probability: 10 },
      { name: "INT +12%", probability: 10 },
      { name: "LUK +12%", probability: 10 },
      { name: "최대 HP +12%", probability: 10 },
      { name: "올스탯 +9%", probability: 10 },
      { name: "스킬 재사용 대기시간 -2초", probability: 10 },
    ],
    [
      { name: "크리티컬 데미지 +1%", probability: 10 },
      { name: "메소 획득량 +5%", probability: 10 },
      { name: "아이템 드롭률 +5%", probability: 10 },
    ],
    [
      { name: "공격력 +12%", probability: 10 },
      { name: "보스 몬스터 데미지 +40%", probability: 10 },
      { name: "몬스터 방어율 무시 +40%", probability: 10 },
    ],
  ];

  assert.deepEqual(getAvailablePotentialTargetTypes(hatTables, { part: 6 }), [
    "stat-equivalent",
    "str-percent",
    "dex-percent",
    "int-percent",
    "luk-percent",
    "hp-percent",
    "all-stat-percent",
    "cooldown",
  ]);
  assert.equal(POTENTIAL_PAGE_TARGETS["hp-percent"].label, "HP %");
  assert.deepEqual(
    Object.fromEntries([
      "str-flat",
      "all-stat-flat",
      "hp-flat",
      "attack-power-flat",
      "magic-power-flat",
    ].map((type) => [type, POTENTIAL_PAGE_TARGETS[type].label])),
    {
      "str-flat": "STR",
      "all-stat-flat": "올스탯",
      "hp-flat": "HP",
      "attack-power-flat": "공격력",
      "magic-power-flat": "마력",
    },
  );
  assert.equal(POTENTIAL_PAGE_TARGETS["mp-percent"], undefined);
  assert.equal(POTENTIAL_PAGE_TARGETS["mp-flat"], undefined);
  assert.equal(POTENTIAL_PAGE_TARGETS["mp-cost-reduction"], undefined);
  assert.ok(
    Object.values(POTENTIAL_PAGE_TARGETS).every(({ label }) =>
      !label.includes("고정")
    ),
  );
});

test("에디셔널 모자는 윗잠 전용 축약 목록을 적용하지 않는다", () => {
  const tables = [
    [
      { name: "STR +20", probability: 20 },
      { name: "캐릭터 기준 9레벨 당 STR +2", probability: 20 },
      { name: "공격력 +16", probability: 20 },
    ],
    [
      { name: "크리티컬 데미지 +1%", probability: 20 },
      { name: "메소 획득량 +5%", probability: 20 },
      { name: "아이템 드롭률 +5%", probability: 20 },
    ],
    [{ name: "최대 MP +14%", probability: 100 }],
  ];

  const regularTargets = getAvailablePotentialTargetTypes(tables, {
    part: 6,
    system: "regular",
  });
  assert.deepEqual(regularTargets, ["stat-equivalent", "attack-power-flat"]);
  // system 생략은 이전 호출과 똑같이 윗잠으로 취급한다.
  assert.deepEqual(
    getAvailablePotentialTargetTypes(tables, { part: 6 }),
    regularTargets,
  );
  const regularNonHatTargets = getAvailablePotentialTargetTypes(tables, {
    part: 7,
    system: "regular",
  });
  for (const type of [
    "str-flat",
    "str-per-nine",
    "mp-percent",
  ]) {
    assert.ok(!regularNonHatTargets.includes(type), `${type}가 윗잠에 노출됨`);
  }
  assert.ok(regularNonHatTargets.includes("attack-power-flat"));

  const additionalTargets = getAvailablePotentialTargetTypes(tables, {
    part: 6,
    system: "additional",
  });
  for (const type of [
    "str-flat",
    "str-per-nine",
    "attack-power-flat",
    "critical-damage",
    "meso",
    "drop",
  ]) {
    assert.ok(additionalTargets.includes(type), `${type} 목표가 누락됨`);
  }
  assert.ok(!additionalTargets.includes("mp-percent"));
});

test("에디셔널의 고정·레벨당·비율 옵션을 각각의 수치로 파싱한다", () => {
  assert.equal(parsePotentialOption("STR +21").flatStat[0], 21);
  assert.equal(parsePotentialOption("DEX +20").flatStat[1], 20);
  assert.equal(parsePotentialOption("INT +19").flatStat[2], 19);
  assert.equal(parsePotentialOption("LUK +18").flatStat[3], 18);
  assert.equal(parsePotentialOption("올스탯 +6").flatAllStat, 6);
  assert.equal(
    parsePotentialOption("캐릭터 기준 9레벨 당 INT +2").perNineStat[2],
    2,
  );
  assert.equal(parsePotentialOption("공격력 +17").flatAttack, 17);
  assert.equal(parsePotentialOption("마력 +16").flatMagic, 16);
  assert.equal(parsePotentialOption("데미지 +12%").damage, 12);
  assert.equal(parsePotentialOption("크리티컬 확률 +12%").criticalRate, 12);
  assert.equal(parsePotentialOption("최대 MP +14%").maxMpPercent, 14);
  assert.equal(parsePotentialOption("최대 HP +375").flatHp, 375);
  assert.equal(parsePotentialOption("최대 MP +375").flatMp, 375);
  assert.equal(
    parsePotentialOption("공격 시 7% 확률로 오토스틸").autoSteal,
    7,
  );
});

test("최대 HP·MP 옵션은 고정 수치와 퍼센트를 분리하고 회복 효율은 제외한다", () => {
  assert.equal(parsePotentialOption("최대 HP +13%").maxHpPercent, 13);
  assert.equal(parsePotentialOption("최대 HP +375").maxHpPercent, 0);
  assert.equal(parsePotentialOption("최대 HP +13%").flatHp, 0);
  assert.equal(parsePotentialOption("최대 HP +375").flatHp, 375);
  assert.equal(parsePotentialOption("최대 MP +13%").maxMpPercent, 13);
  assert.equal(parsePotentialOption("최대 MP +375").flatMp, 375);
  assert.equal(
    parsePotentialOption("HP 회복 아이템 및 회복 스킬 효율 +30%").maxHpPercent,
    0,
  );
  assert.equal(
    parsePotentialOption("HP 회복 아이템 및 회복 스킬 효율 +30%").flatHp,
    0,
  );
});

test("에디셔널 방어·이동·회복·MP 소모 옵션을 수치로 파싱한다", () => {
  assert.equal(parsePotentialOption("방어력 +7%").defensePercent, 7);
  assert.equal(parsePotentialOption("방어력 +150").flatDefense, 150);
  assert.equal(parsePotentialOption("이동속도 +9").speed, 9);
  assert.equal(parsePotentialOption("점프력 +8").jump, 8);
  assert.equal(
    parsePotentialOption("HP 회복 아이템 및 회복 스킬 효율 +30%")
      .healingEfficiency,
    30,
  );
  assert.equal(
    parsePotentialOption("모든 스킬의 MP 소모 -17%").mpCostReduction,
    17,
  );

  const proc = parsePotentialOption("공격 시 15% 확률로 95의 HP 회복");
  assert.equal(proc.healingEfficiency, 0);
  assert.equal(proc.flatHp, 0);
});

test("정확 옵션 목표 ID는 URI 인코딩으로 왕복하고 잘못된 ID를 거부한다", () => {
  const optionName = "공격 시 15% 확률로 95의 HP 회복";
  const targetType = encodeExactPotentialTargetType(optionName);
  assert.equal(
    targetType,
    `${EXACT_POTENTIAL_TARGET_PREFIX}${encodeURIComponent(optionName)}`,
  );
  assert.equal(decodeExactPotentialTargetType(targetType), optionName);
  assert.equal(decodeExactPotentialTargetType("damage"), null);
  assert.notEqual(
    targetType,
    encodeExactPotentialTargetType("공격 시 15% 확률로 95의 MP 회복"),
  );

  assert.throws(() => encodeExactPotentialTargetType(""), RangeError);
  assert.throws(() => encodeExactPotentialTargetType("\uD800"), /인코딩/);
  assert.throws(
    () => decodeExactPotentialTargetType(EXACT_POTENTIAL_TARGET_PREFIX),
    /옵션 이름/,
  );
  assert.throws(
    () =>
      decodeExactPotentialTargetType(`${EXACT_POTENTIAL_TARGET_PREFIX}%E0%A4%A`),
    /URI 인코딩/,
  );
  assert.throws(
    () => decodeExactPotentialTargetType(`${EXACT_POTENTIAL_TARGET_PREFIX}%20`),
    /옵션 이름/,
  );
});

test("에디셔널 목표 목록은 유효 옵션만 남기고 잡옵 원문을 숨긴다", () => {
  const hpRecovery = "공격 시 15% 확률로 95의 HP 회복";
  const mpRecovery = "공격 시 15% 확률로 95의 MP 회복";
  const decentSkill = "<쓸만한 샤프 아이즈> 스킬 사용 가능";
  const tables = [
    [
      { name: "STR +20", probability: 25 },
      { name: "방어력 +7%", probability: 25 },
      { name: hpRecovery, probability: 25 },
      { name: decentSkill, probability: 25 },
    ],
    [
      { name: "공격력 +16", probability: 25 },
      { name: "이동속도 +9", probability: 25 },
      { name: "점프력 +8", probability: 25 },
      { name: "HP 회복 아이템 및 회복 스킬 효율 +30%", probability: 25 },
    ],
    [
      { name: "최대 MP +14%", probability: 25 },
      { name: "최대 MP +375", probability: 25 },
      { name: "모든 스킬의 MP 소모 -17%", probability: 25 },
      { name: mpRecovery, probability: 25 },
    ],
  ];

  assert.deepEqual(
    getAvailablePotentialTargetTypes(tables, {
      part: 7,
      system: "regular",
    }),
    ["stat-equivalent", "attack-power-flat"],
  );

  const targets = getAvailablePotentialTargetTypes(tables, {
    part: 7,
    system: "additional",
  });
  for (const type of ["stat-equivalent", "str-flat", "attack-power-flat"]) {
    assert.ok(targets.includes(type), `${type} 유효 목표가 누락됨`);
  }
  for (const type of [
    "mp-percent",
    "mp-flat",
    "mp-cost-reduction",
    "defense-percent",
    "defense-flat",
    "speed",
    "jump",
    "healing-efficiency",
  ]) assert.ok(!targets.includes(type), `${type} 잡옵이 노출됨`);
  assert.ok(!targets.some((type) => type.startsWith(EXACT_POTENTIAL_TARGET_PREFIX)));
});

test("에디셔널의 유효 수치 목표를 세 줄 합계로 판정한다", () => {
  function succeeds(optionNames, targetType, target) {
    return calculatePotentialExpected({
      ...common,
      system: "additional",
      tables: optionNames.map((name) => [{ name, probability: 100 }]),
      targetType,
      target,
    }).probability;
  }

  assert.equal(succeeds(["STR +20", "올스탯 +5"], "str-flat", 25), 1);
  assert.equal(succeeds(["DEX +20", "올스탯 +5"], "dex-flat", 25), 1);
  assert.equal(succeeds(["INT +20", "올스탯 +5"], "int-flat", 25), 1);
  assert.equal(succeeds(["LUK +20", "올스탯 +5"], "luk-flat", 25), 1);
  assert.equal(succeeds(["올스탯 +5", "올스탯 +6"], "all-stat-flat", 11), 1);
  assert.equal(
    succeeds(
      ["캐릭터 기준 9레벨 당 INT +2", "캐릭터 기준 9레벨 당 INT +1"],
      "int-per-nine",
      3,
    ),
    1,
  );
  assert.equal(succeeds(["공격력 +17", "공격력 +15"], "attack-power-flat", 32), 1);
  assert.equal(succeeds(["마력 +17", "마력 +15"], "magic-power-flat", 32), 1);
  assert.equal(succeeds(["데미지 +12%", "데미지 +9%"], "damage", 21), 1);
  assert.equal(
    succeeds(["크리티컬 확률 +12%", "크리티컬 확률 +9%"], "critical-rate", 21),
    1,
  );
  assert.equal(succeeds(["최대 HP +375", "최대 HP +300"], "hp-flat", 675), 1);
  assert.equal(
    succeeds(["공격 시 7% 확률로 오토스틸"], "auto-steal", 7),
    1,
  );
  assert.equal(succeeds(["STR +20", "올스탯 +5"], "str-flat", 25.001), 0);
});

test("정확 옵션 목표는 같은 옵션의 최소 줄 수와 서로 다른 옵션의 AND를 판정한다", () => {
  const hpRecovery = "공격 시 15% 확률로 95의 HP 회복";
  const mpRecovery = "공격 시 15% 확률로 95의 MP 회복";
  const hpTargetType = encodeExactPotentialTargetType(hpRecovery);
  const mpTargetType = encodeExactPotentialTargetType(mpRecovery);
  const tables = [
    [{ name: hpRecovery, probability: 100 }],
    [{ name: mpRecovery, probability: 100 }],
    [{ name: hpRecovery, probability: 100 }],
  ];

  assert.equal(
    calculatePotentialExpected({
      ...common,
      system: "additional",
      tables,
      targetType: hpTargetType,
      target: 2,
    }).probability,
    1,
  );
  assert.equal(
    calculatePotentialExpected({
      ...common,
      system: "additional",
      tables,
      targets: [
        { targetType: hpTargetType, target: 2 },
        { targetType: mpTargetType, target: 1 },
      ],
    }).probability,
    1,
  );
  assert.equal(
    calculatePotentialExpected({
      ...common,
      system: "additional",
      tables,
      targetType: hpTargetType,
      target: 3,
    }).probability,
    0,
  );
  assert.throws(
    () =>
      calculatePotentialExpected({
        ...common,
        tables,
        targetType: hpTargetType,
        target: 1.5,
      }),
    /1~3/,
  );
  assert.throws(
    () =>
      calculatePotentialExpected({
        ...common,
        tables,
        targetType: hpTargetType,
        target: 4,
      }),
    /1~3/,
  );
  assert.throws(
    () =>
      calculatePotentialExpected({
        ...common,
        tables,
        targetType: `${EXACT_POTENTIAL_TARGET_PREFIX}%E0%A4%A`,
        target: 1,
      }),
    /URI 인코딩/,
  );
});

test("개별 스탯 목표는 올스탯을 포함하고 HP·올스탯 목표는 따로 센다", () => {
  const tables = [
    [{ name: "STR +9%", probability: 100 }],
    [{ name: "올스탯 +3%", probability: 100 }],
    [{ name: "최대 HP +12%", probability: 100 }],
  ];

  for (const [targetType, target] of [
    ["str-percent", 12],
    ["all-stat-percent", 3],
    ["hp-percent", 12],
  ]) {
    assert.equal(
      calculatePotentialExpected({ ...common, tables, targetType, target })
        .probability,
      1,
    );
    assert.equal(
      calculatePotentialExpected({
        ...common,
        tables,
        targetType,
        target: target + 0.001,
      }).probability,
      0,
    );
  }

  assert.equal(
    calculatePotentialExpected({
      ...common,
      tables,
      targets: [
        { targetType: "str-percent", target: 12 },
        { targetType: "hp-percent", target: 12 },
      ],
    }).probability,
    1,
  );
});

test("개별 스탯과 올스탯 목표를 메수라이브처럼 목표 스탯에 합산한다", () => {
  const targets = [
    { targetType: "cooldown", target: 2 },
    { targetType: "int-percent", target: 7 },
    { targetType: "all-stat-percent", target: 7 },
  ];
  const missingInt = [
    [{ name: "스킬 재사용 대기시간 -2초", probability: 100 }],
    [{ name: "올스탯 +7%", probability: 100 }],
    [{ name: "방어력 +100", probability: 100 }],
  ];
  const complete = [
    [{ name: "스킬 재사용 대기시간 -2초", probability: 100 }],
    [{ name: "올스탯 +7%", probability: 100 }],
    [{ name: "INT +7%", probability: 100 }],
  ];
  const twoAllStatLines = [
    [{ name: "스킬 재사용 대기시간 -2초", probability: 100 }],
    [{ name: "올스탯 +7%", probability: 100 }],
    [{ name: "올스탯 +7%", probability: 100 }],
  ];

  assert.equal(
    calculatePotentialExpected({ ...common, tables: missingInt, targets })
      .probability,
    0,
  );
  assert.equal(
    calculatePotentialExpected({ ...common, tables: complete, targets })
      .probability,
    1,
  );
  // 목표 INT 7% + 올스탯 7%는 INT 합계 14%, 나머지 스탯
  // 합계 7%로 펼쳐지므로 올스탯 7% 두 줄도 성공이다.
  assert.equal(
    calculatePotentialExpected({
      ...common,
      tables: twoAllStatLines,
      targets,
    }).probability,
    1,
  );
  // 개별 스탯만 목표로 삼을 때는 기존처럼 올스탯을 합산한다.
  assert.equal(
    calculatePotentialExpected({
      ...common,
      tables: missingInt,
      targetType: "int-percent",
      target: 7,
    }).probability,
    1,
  );
  // 앞 세트가 올스탯을 별도 조건으로 분리했더라도 다음 OR 세트의 단독
  // INT 목표는 올스탯을 정상적으로 포함해야 한다.
  assert.equal(
    calculatePotentialExpected({
      ...common,
      tables: missingInt,
      targetSets: [
        targets,
        [{ targetType: "int-percent", target: 7 }],
      ],
    }).probability,
    1,
  );
});

test("에디셔널 고정 스탯과 올스탯 목표도 목표 스탯에 합산한다", () => {
  const targets = [
    { targetType: "int-flat", target: 20 },
    { targetType: "all-stat-flat", target: 5 },
  ];
  const missingInt = [
    [{ name: "올스탯 +20", probability: 100 }],
    [{ name: "방어력 +100", probability: 100 }],
    [{ name: "최대 HP +100", probability: 100 }],
  ];
  const intAndAllStat = [
    [{ name: "INT +20", probability: 100 }],
    [{ name: "올스탯 +5", probability: 100 }],
    [{ name: "방어력 +100", probability: 100 }],
  ];
  const twoAllStatLines = [
    [{ name: "올스탯 +15", probability: 100 }],
    [{ name: "올스탯 +10", probability: 100 }],
    [{ name: "방어력 +100", probability: 100 }],
  ];

  assert.equal(
    calculatePotentialExpected({
      ...common,
      system: "additional",
      tables: missingInt,
      targets,
    }).probability,
    0,
  );
  assert.equal(
    calculatePotentialExpected({
      ...common,
      system: "additional",
      tables: intAndAllStat,
      targets,
    }).probability,
    1,
  );
  assert.equal(
    calculatePotentialExpected({
      ...common,
      system: "additional",
      tables: twoAllStatLines,
      targets,
    }).probability,
    1,
  );
});

test("조건 기준값을 개인 주스탯%와 공마%로 환산한다", () => {
  const personal = {
    attackPercentToMainPercent: 7,
    bossDamageToMainPercent: 2,
    criticalDamageToMainPercent: 4,
    currentIgnoreDefense: 0.96,
    oneMainPercentRelative: 0.001,
  };
  assert.deepEqual(
    convertPotentialTargetToEquivalents({
      targetType: "stat-percent",
      target: 21,
      statEquivalence: personal,
    }),
    { mainStatPercent: 21, attackPercent: 3 },
  );
  assert.deepEqual(
    convertPotentialTargetToEquivalents({
      targetType: "str-percent",
      target: 21,
      statEquivalence: personal,
      mainStat: "STR",
      subStat: "DEX",
    }),
    { mainStatPercent: 21, attackPercent: 3 },
  );
  assert.deepEqual(
    convertPotentialTargetToEquivalents({
      targetType: "dex-percent",
      target: 21,
      statEquivalence: { ...personal, subStatPercentToMainPercent: 0.12 },
      mainStat: "STR",
      subStat: "DEX",
    }),
    { mainStatPercent: 2.52, attackPercent: 0.36 },
  );
  assert.deepEqual(
    convertPotentialTargetToEquivalents({
      targetType: "all-stat-percent",
      target: 9,
      statEquivalence: { ...personal, allStatPercentToMainPercent: 1.2 },
    }),
    { mainStatPercent: 10.799999999999999, attackPercent: 1.5428571428571427 },
  );
  assert.deepEqual(
    convertPotentialTargetToEquivalents({
      targetType: "hp-percent",
      target: 12,
      statEquivalence: personal,
    }),
    { mainStatPercent: null, attackPercent: null },
  );
  assert.deepEqual(
    convertPotentialTargetToEquivalents({
      targetType: "attack-percent",
      target: 9,
      statEquivalence: personal,
    }),
    { mainStatPercent: 63, attackPercent: 9 },
  );
  assert.deepEqual(
    convertPotentialTargetToEquivalents({
      targetType: "magic-power-percent",
      target: 24,
      statEquivalence: personal,
      attackType: "magic",
    }),
    { mainStatPercent: 168, attackPercent: 24 },
  );
  assert.deepEqual(
    convertPotentialTargetToEquivalents({
      targetType: "magic-power-percent",
      target: 24,
      statEquivalence: personal,
      attackType: "attack",
    }),
    { mainStatPercent: null, attackPercent: null },
  );
  assert.deepEqual(
    convertPotentialTargetToEquivalents({
      targetType: "boss-damage",
      target: 40,
      statEquivalence: personal,
    }),
    { mainStatPercent: 80, attackPercent: 80 / 7 },
  );

  const ignoreDefenseMain = calculateIgnoreDefenseEquivalent({
    currentIgnoreDefense: 0.96,
    addedIgnoreDefense: 0.4,
    enemyDefense: 3.8,
    oneMainPercentRelative: 0.001,
  });
  assert.deepEqual(
    convertPotentialTargetToEquivalents({
      targetType: "ignore-defense",
      target: 40,
      statEquivalence: personal,
      enemyDefense: 380,
    }),
    {
      mainStatPercent: ignoreDefenseMain,
      attackPercent: ignoreDefenseMain / 7,
    },
  );
  assert.deepEqual(
    convertPotentialTargetToEquivalents({
      targetType: "meso",
      target: 20,
      statEquivalence: personal,
    }),
    { mainStatPercent: null, attackPercent: null },
  );
});

test("에디셔널 고정·레벨당 목표를 개인 주스탯%와 공마%로 환산한다", () => {
  const personal = {
    flatMainStatToPercent: 0.1,
    flatSubStatToFlatMainStat: 0.25,
    attackToMainStat: 3,
    attackPercentToMainPercent: 6,
    bossDamageToMainPercent: 2,
    criticalRateToMainPercent: 0.5,
  };
  const context = {
    statEquivalence: personal,
    mainStat: "INT",
    subStat: "LUK",
    attackType: "magic",
    characterLevel: 286,
  };

  assert.deepEqual(
    convertPotentialTargetToEquivalents({
      ...context,
      targetType: "int-flat",
      target: 20,
    }),
    { mainStatPercent: 2, attackPercent: 1 / 3 },
  );
  assert.deepEqual(
    convertPotentialTargetToEquivalents({
      ...context,
      targetType: "luk-flat",
      target: 20,
    }),
    { mainStatPercent: 0.5, attackPercent: 1 / 12 },
  );
  assert.deepEqual(
    convertPotentialTargetToEquivalents({
      ...context,
      targetType: "str-flat",
      target: 20,
    }),
    { mainStatPercent: null, attackPercent: null },
  );
  assert.deepEqual(
    convertPotentialTargetToEquivalents({
      ...context,
      targetType: "all-stat-flat",
      target: 20,
    }),
    { mainStatPercent: 2.5, attackPercent: 2.5 / 6 },
  );
  assert.deepEqual(
    convertPotentialTargetToEquivalents({
      ...context,
      targetType: "int-per-nine",
      target: 2,
    }),
    { mainStatPercent: 6.2, attackPercent: 6.2 / 6 },
  );
  assert.deepEqual(
    convertPotentialTargetToEquivalents({
      ...context,
      targetType: "int-per-nine",
      target: 2,
      characterLevel: undefined,
    }),
    { mainStatPercent: null, attackPercent: null },
  );
  assert.deepEqual(
    convertPotentialTargetToEquivalents({
      ...context,
      targetType: "magic-power-flat",
      target: 16,
    }),
    { mainStatPercent: 4.800000000000001, attackPercent: 0.8000000000000002 },
  );
  assert.deepEqual(
    convertPotentialTargetToEquivalents({
      ...context,
      targetType: "attack-power-flat",
      target: 16,
    }),
    { mainStatPercent: null, attackPercent: null },
  );
  assert.deepEqual(
    convertPotentialTargetToEquivalents({
      ...context,
      targetType: "damage",
      target: 12,
    }),
    { mainStatPercent: 24, attackPercent: 4 },
  );
  assert.deepEqual(
    convertPotentialTargetToEquivalents({
      ...context,
      targetType: "critical-rate",
      target: 12,
    }),
    { mainStatPercent: 6, attackPercent: 1 },
  );
  assert.deepEqual(
    convertPotentialTargetToEquivalents({
      ...context,
      targetType: "hp-flat",
      target: 375,
    }),
    { mainStatPercent: null, attackPercent: null },
  );
});

test("보스전 주스탯% 환산은 여러 방무 줄을 복리 합성해 한 번만 환산한다", () => {
  const tables = [
    [{ name: "몬스터 방어율 무시 +40%", probability: 100 }],
    [{ name: "몬스터 방어율 무시 +30%", probability: 100 }],
    [{ name: "기타", probability: 100 }],
  ];
  const score = 38.56667831545601;

  assert.equal(
    calculatePotentialExpected({
      ...common,
      tables,
      targetType: "boss-stat-equivalent",
      target: score - 1e-8,
    }).probability,
    1,
  );
  assert.equal(
    calculatePotentialExpected({
      ...common,
      tables,
      targetType: "boss-stat-equivalent",
      target: score + 1e-8,
    }).probability,
    0,
  );
});

test("보스 환산은 개인 방무 컨텍스트와 유효한 적 방어율을 요구한다", () => {
  const tables = [
    [{ name: "INT +12%", probability: 100 }],
    [{ name: "기타", probability: 100 }],
    [{ name: "기타", probability: 100 }],
  ];
  assert.throws(
    () =>
      calculatePotentialExpected({
        ...common,
        tables,
        targetType: "boss-stat-equivalent",
        target: 1,
        statEquivalence: {
          ...statEquivalence,
          currentIgnoreDefense: undefined,
        },
      }),
    /현재 방어율 무시/,
  );
  assert.throws(
    () =>
      calculatePotentialExpected({
        ...common,
        tables,
        targetType: "boss-stat-equivalent",
        target: 1,
        enemyDefense: 0,
      }),
    /적 방어율/,
  );
});
