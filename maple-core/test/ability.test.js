import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateAbilityAttemptsForChance,
  calculateAbilityExpected,
  calculateAbilityOptimalStrategy,
  getAbilityHonorCost,
  getAbilityTargetOptions,
  getAbilityTargetValues,
  getAbilityWeightTotals,
} from "../src/ability.js";

test("공식 옵션 종류 확률은 등급마다 반올림 오차 안에서 100%가 된다", () => {
  for (const method of ["honor", "miracle"]) {
    const totals = getAbilityWeightTotals(method);
    for (const total of Object.values(totals)) {
      assert.ok(Math.abs(total - 1) < 0.00002, `${method}: ${total}`);
    }
  }
});

test("레전드리 첫 줄 보공 20%는 종류 확률과 최대 수치 확률을 곱한다", () => {
  const honor = calculateAbilityExpected({
    method: "honor",
    targets: [{ type: "boss-damage", minimum: 20 }],
  });
  const miracle = calculateAbilityExpected({
    method: "miracle",
    targets: [{ type: "boss-damage", minimum: 20 }],
  });

  const roundedWeightTotal = getAbilityWeightTotals("honor").legendary;
  assert.ok(Math.abs(honor.probability - 0.023127 / roundedWeightTotal * 0.1) < 1e-12);
  assert.ok(Math.abs(miracle.probability - 0.023127 / roundedWeightTotal) < 1e-12);
});

test("명성치 잠금 수에 따라 재설정 비용을 적용한다", () => {
  assert.equal(getAbilityHonorCost(0), 8000);
  assert.equal(getAbilityHonorCost(1), 11000);
  assert.equal(getAbilityHonorCost(2), 16000);
  assert.equal(getAbilityHonorCost(0, true), 4000);
  assert.equal(getAbilityHonorCost(1, true), 5500);
  assert.equal(getAbilityHonorCost(2, true), 8000);

  const result = calculateAbilityExpected({
    method: "honor",
    targets: [
      { type: "boss-damage", minimum: 20, locked: true },
      { type: "cooldown-skip", minimum: 10 },
    ],
  });
  assert.equal(result.lockCount, 1);
  assert.equal(result.resourcePerReset, 11000);
  assert.ok(result.probability > 0);
});

test("어빌 반값 선데이는 확률이 아니라 명성치 소비량만 절반으로 만든다", () => {
  const regular = calculateAbilityExpected({
    method: "honor",
    targets: [{ type: "boss-damage", minimum: 20 }],
  });
  const sunday = calculateAbilityExpected({
    method: "honor",
    targets: [{ type: "boss-damage", minimum: 20 }],
    halfHonor: true,
  });
  assert.equal(sunday.probability, regular.probability);
  assert.equal(sunday.resourcePerReset, regular.resourcePerReset / 2);
  assert.equal(sunday.expectedResource, regular.expectedResource / 2);
});

test("블랙·카오스 서큘레이터는 현재 옵션과 등급을 유지하고 수치만 재설정한다", () => {
  for (const method of ["black", "chaos"]) {
    const result = calculateAbilityExpected({
      method,
      targets: [
        { type: "boss-damage", minimum: 20, grade: "legendary" },
        { type: "buff-duration", minimum: 38, grade: "unique" },
      ],
    });
    assert.ok(Math.abs(result.probability - 0.01) < 1e-12);
    assert.ok(Math.abs(result.expectedResets - 100) < 1e-10);
    assert.equal(result.resourcePerReset, 1);
  }
});

test("두 아랫줄은 순서 무관일 때 어느 줄에 등장해도 성공한다", () => {
  const targets = [
    { type: "boss-damage", minimum: 20, locked: true },
    { type: "cooldown-skip", minimum: 10 },
    { type: "buff-duration", minimum: 38 },
  ];
  const fixed = calculateAbilityExpected({ method: "honor", targets, swapLower: false });
  const swapped = calculateAbilityExpected({ method: "honor", targets, swapLower: true });
  assert.ok(swapped.probability > fixed.probability);
});

test("같은 종류의 어빌리티 목표는 중복 지정할 수 없다", () => {
  const result = calculateAbilityExpected({
    targets: [
      { type: "buff-duration", minimum: 50 },
      { type: "buff-duration", minimum: 38 },
    ],
  });
  assert.equal(result.probability, 0);
  assert.match(result.error, /중복/u);
});

test("줄별로 등장 가능한 목표와 수치만 제공한다", () => {
  assert.ok(getAbilityTargetOptions(0).some((entry) => entry.id === "attack-speed"));
  assert.ok(!getAbilityTargetOptions(1).some((entry) => entry.id === "attack-speed"));
  assert.deepEqual(getAbilityTargetValues("boss-damage", 0, "honor"), [15, 16, 17, 18, 19, 20]);
  assert.deepEqual(getAbilityTargetValues("boss-damage", 1, "miracle"), [10]);
  assert.ok(!getAbilityTargetOptions(1, "honor").some((entry) => entry.id === "jump"));
  assert.ok(getAbilityTargetOptions(1, "chaos", "epic").some((entry) => entry.id === "jump"));
  assert.deepEqual(getAbilityTargetValues("jump", 1, "black", "epic"), [10, 12, 14]);
});

test("목표 확률 도달 횟수는 최소 정수 횟수로 올림한다", () => {
  assert.equal(calculateAbilityAttemptsForChance(0.1, 0.8), 16);
  assert.equal(calculateAbilityAttemptsForChance(1, 0.8), 1);
  assert.equal(calculateAbilityAttemptsForChance(0, 0.8), Infinity);
});

test("최적 전략은 허용한 서큘레이터를 단계적으로 사용해 기대 명성치를 줄인다", () => {
  const targets = [
    { type: "boss-damage", minimum: 20, grade: "legendary" },
    { type: "abnormal-damage", minimum: 8, grade: "unique" },
  ];
  const honorOnly = calculateAbilityOptimalStrategy({
    targets,
    allowMiracle: false,
    allowBlack: false,
    allowChaos: false,
  });
  const withBlack = calculateAbilityOptimalStrategy({
    targets,
    allowMiracle: false,
    allowBlack: true,
    allowChaos: false,
    blackCount: 100,
  });
  const withChaos = calculateAbilityOptimalStrategy({
    targets,
    allowMiracle: false,
    allowBlack: false,
    allowChaos: true,
    chaosCount: 100,
  });

  assert.equal(honorOnly.error, null);
  assert.ok(withBlack.expectedHonor < honorOnly.expectedHonor);
  assert.ok(withBlack.expectedCirculators.black > 0);
  assert.equal(withBlack.expectedCirculators.chaos, 0);
  assert.ok(withChaos.expectedHonor < honorOnly.expectedHonor);
  assert.ok(withChaos.expectedCirculators.chaos > 0);
  assert.equal(withChaos.expectedCirculators.black, 0);
});

test("명성치 전략은 우연히 완성된 줄을 잠글지 버릴지 상태별로 다시 고른다", () => {
  const result = calculateAbilityOptimalStrategy({
    targets: [
      { type: "boss-damage", minimum: 20, grade: "legendary" },
      { type: "abnormal-damage", minimum: 8, grade: "unique" },
      { type: "critical", minimum: 20, grade: "unique" },
    ],
    allowMiracle: false,
    allowBlack: false,
    allowChaos: false,
  });

  assert.equal(result.strategyMode, "adaptive-state");
  assert.ok(Math.abs(result.expectedHonor - 76_781_952.54571307) < 1e-6);
  assert.ok(Math.abs(result.expectedHonorResets - 8_652.75871576387) < 1e-9);
});

test("미라클 허용 전략은 한 줄을 선행 확보하고 반값은 명성치만 절반으로 만든다", () => {
  const targets = [{ type: "boss-damage", minimum: 20, grade: "legendary" }];
  const regular = calculateAbilityOptimalStrategy({
    targets,
    allowMiracle: false,
    allowBlack: false,
    allowChaos: false,
  });
  const sunday = calculateAbilityOptimalStrategy({
    targets,
    halfHonor: true,
    allowMiracle: false,
    allowBlack: false,
    allowChaos: false,
  });
  const miracle = calculateAbilityOptimalStrategy({
    targets,
    allowMiracle: true,
    allowBlack: false,
    allowChaos: false,
    miracleCount: 1000,
  });
  const direct = calculateAbilityExpected({ method: "honor", targets });

  assert.ok(Math.abs(regular.expectedHonor - direct.expectedResource) < 1);
  assert.ok(Math.abs(sunday.expectedHonor - regular.expectedHonor / 2) < 1e-6);
  assert.equal(sunday.expectedHonorResets, regular.expectedHonorResets);
  assert.ok(miracle.expectedHonor < regular.expectedHonor);
  assert.ok(miracle.expectedCirculators.miracle <= 1000);
  assert.ok(miracle.expectedCirculators.miracle > 0);
  assert.equal(miracle.steps[0].method, "miracle");
});

test("최적 전략은 서큘레이터 보유량을 넘겨 사용하지 않고 명성치 잠금 순서를 제공한다", () => {
  const result = calculateAbilityOptimalStrategy({
    targets: [
      { type: "boss-damage", minimum: 20, grade: "legendary" },
      { type: "abnormal-damage", minimum: 8, grade: "unique" },
      { type: "critical", minimum: 20, grade: "unique" },
    ],
    miracleCount: 3,
    blackCount: 2,
    chaosCount: 1,
  });

  assert.equal(result.error, null);
  assert.ok(result.expectedCirculators.miracle <= 3);
  assert.ok(result.expectedCirculators.black <= 2);
  assert.ok(result.expectedCirculators.chaos <= 1);
  const honorStep = result.steps.find((step) => step.method === "honor");
  assert.ok(honorStep);
  assert.ok(honorStep.priority.length >= 2);
  assert.match(honorStep.priority[0], /번째 줄/u);
});

test("허용 상태여도 보유량이 0이면 서큘레이터를 추천하지 않는다", () => {
  const result = calculateAbilityOptimalStrategy({
    targets: [{ type: "boss-damage", minimum: 20, grade: "legendary" }],
    allowMiracle: true,
    allowBlack: true,
    allowChaos: true,
    miracleCount: 0,
    blackCount: 0,
    chaosCount: 0,
  });

  assert.deepEqual(result.expectedCirculators, { miracle: 0, black: 0, chaos: 0 });
  assert.equal(result.steps.some((step) => step.method !== "honor"), false);
});

test("유니크 크확을 먼저 확보한 뒤 보유 블랙으로 수치를 맞추는 경로를 비교한다", () => {
  const targets = [
    { type: "boss-damage", minimum: 20, grade: "legendary" },
    { type: "abnormal-damage", minimum: 8, grade: "unique" },
    { type: "critical", minimum: 20, grade: "unique" },
  ];
  const honorOnly = calculateAbilityOptimalStrategy({
    targets,
    allowMiracle: false,
    allowBlack: false,
    allowChaos: false,
  });
  const withBlack = calculateAbilityOptimalStrategy({
    targets,
    allowMiracle: false,
    allowBlack: true,
    allowChaos: false,
    blackCount: 40,
  });

  assert.ok(withBlack.expectedHonor < honorOnly.expectedHonor);
  assert.ok(withBlack.expectedCirculators.black > 0);
  const priority = withBlack.steps.find((step) => step.method === "honor")?.priority ?? [];
  assert.match(priority[0], /크리티컬 확률 증가 15% 이상을 명성치로 확보/u);
  assert.match(priority[0], /블랙 최대 40개/u);
  assert.match(priority[0], /20% 이상 완성/u);
  assert.match(priority[0], /완성 후 잠금/u);
});
