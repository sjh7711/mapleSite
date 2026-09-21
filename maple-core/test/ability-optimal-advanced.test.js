import assert from "node:assert/strict";
import test from "node:test";
import { calculateAbilityExpected, calculateAbilityOptimalStrategy, getAbilityResetHonorCost } from "../src/ability.js";

const close = (actual, expected) => assert.ok(
  Math.abs(actual - expected) <= 1e-10 * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`,
);
const lowerLegendary = [{}, { type: "critical", minimum: 30, grade: "legendary" }];
const mixed = [
  { type: "critical", minimum: 30, grade: "legendary" },
  { type: "abnormal-damage", minimum: 9, grade: "legendary" },
];

test("고급 최적 전략의 한 줄 계산은 순서 옵션·동일 결과 제외·공식 비용을 직접 계산과 일치시킨다", () => {
  for (const swapLower of [false, true]) {
    const direct = calculateAbilityExpected({ method: "advanced", targets: lowerLegendary, swapLower });
    const result = calculateAbilityOptimalStrategy({ useAdvanced: true, targets: lowerLegendary, swapLower });
    assert.equal(result.error, null);
    close(result.expectedHonorResets, direct.expectedResets);
    close(result.expectedHonor, direct.expectedResets * 20_000);
    close(result.expectedMeso, direct.expectedResets * 2_000_000);
    assert.ok(result.expectedHonorResets < 1 / direct.rawProbability);
    assert.equal(result.expectedNormalResets, 0);
  }
});

test("아랫줄 레전드리 목표는 수치가 유니크 범위와 겹쳐도 미라클·블랙·카오스로 달성한 것으로 보지 않는다", () => {
  const targets = [{}, { type: "critical", minimum: 20, grade: "legendary" }];
  const result = calculateAbilityOptimalStrategy({
    useAdvanced: true, targets, miracleCount: 9999, blackCount: 9999, chaosCount: 9999,
  });
  const direct = calculateAbilityExpected({ method: "advanced", targets });
  close(result.expectedHonor, direct.expectedResource);
  assert.deepEqual(result.expectedCirculators, { miracle: 0, black: 0, chaos: 0 });
  assert.deepEqual(result.steps.map((step) => step.method), ["advanced"]);
  const half = calculateAbilityOptimalStrategy({ useAdvanced: true, targets, halfHonor: true });
  close(half.expectedHonor, result.expectedHonor / 2);
  close(half.expectedMeso, result.expectedMeso);
});

test("세 줄 레전드리는 자동 잠금 비용을 누적하며 고정 순서보다 더 비싸지 않다", () => {
  const targets = [
    { type: "passive-level", minimum: 1, grade: "legendary" },
    { type: "boss-damage", minimum: 20, grade: "legendary" },
    { type: "abnormal-damage", minimum: 10, grade: "legendary" },
  ];
  const result = calculateAbilityOptimalStrategy({ useAdvanced: true, targets });
  assert.equal(result.error, null);
  const locked = new Set();
  let fixedHonor = 0;
  let fixedMeso = 0;
  for (const line of [1, 2, 0]) {
    const stage = targets.map((target, index) => locked.has(index)
      ? { ...target, locked: true } : index === line ? target : {});
    const next = calculateAbilityExpected({ method: "advanced", targets: stage });
    fixedHonor += next.expectedResource;
    fixedMeso += next.expectedMeso;
    locked.add(line);
  }
  assert.ok(result.expectedHonor <= fixedHonor);
  assert.ok(result.expectedMeso > 0 && Number.isFinite(fixedMeso));
  assert.ok(result.expectedMeso >= result.expectedAdvancedResets * 2_000_000);
  assert.ok(result.expectedMeso <= result.expectedAdvancedResets * 15_000_000);
  assert.equal(result.steps.at(-1).method, "advanced");
  close(result.expectedHonorResets, result.expectedNormalResets + result.expectedAdvancedResets);
});

test("한 줄 선행 확보에만 보유 서큘레이터를 쓰며 고급 재설정 이후에는 사용하지 않는다", () => {
  const baseline = calculateAbilityOptimalStrategy({ useAdvanced: true, targets: mixed });
  const stocked = calculateAbilityOptimalStrategy({
    useAdvanced: true, targets: mixed, miracleCount: 5, blackCount: 5, chaosCount: 5,
  });
  assert.ok(stocked.expectedHonor < baseline.expectedHonor);
  assert.ok(stocked.expectedNormalResets > 0 && stocked.expectedAdvancedResets > 0);
  for (const count of Object.values(stocked.expectedCirculators)) assert.ok(count > 0 && count <= 5);
  assert.equal(stocked.steps.at(-1).method, "advanced");
  assert.ok(stocked.steps.slice(0, -1).some((step) => step.after?.includes("고급 재설정으로 전환")));
  close(stocked.expectedMeso, baseline.expectedMeso);
  const blocked = calculateAbilityOptimalStrategy({
    useAdvanced: true, targets: mixed, miracleCount: 5, blackCount: 5, chaosCount: 5,
    allowMiracle: false, allowBlack: false, allowChaos: false,
  });
  close(blocked.expectedHonor, baseline.expectedHonor);
  assert.deepEqual(blocked.expectedCirculators, { miracle: 0, black: 0, chaos: 0 });
});

test("반값 설정은 일반 선행 확보와 고급 재설정의 명성치를 모두 절반으로 계산한다", () => {
  const options = { useAdvanced: true, targets: mixed, blackCount: 10 };
  const normal = calculateAbilityOptimalStrategy(options);
  const half = calculateAbilityOptimalStrategy({ ...options, halfHonor: true });
  close(half.expectedAdvancedResets, normal.expectedAdvancedResets);
  close(half.expectedNormalResets, normal.expectedNormalResets);
  close(half.expectedMeso, normal.expectedMeso);
  close(half.expectedHonor, normal.expectedHonor / 2);
  close(half.baselineHonor, normal.baselineHonor / 2);
  close(half.honorSaved, normal.honorSaved / 2);
});

test("고급 사용 OFF는 기존 전략을 유지하고 ON도 기존 방식으로 가능한 목표를 더 비싼 경로로 강제하지 않는다", () => {
  const options = { targets: [{ type: "boss-damage", minimum: 20 }], miracleCount: 3, blackCount: 5 };
  const before = calculateAbilityOptimalStrategy(options);
  const enabled = calculateAbilityOptimalStrategy({ ...options, useAdvanced: true });
  const after = calculateAbilityOptimalStrategy({ ...options, useAdvanced: false });
  assert.deepEqual(after, before);
  assert.ok(enabled.expectedHonor <= before.expectedHonor);
  assert.equal(enabled.expectedMeso, 0);
  assert.equal(enabled.expectedAdvancedResets, 0);
  assert.ok(calculateAbilityOptimalStrategy({ useAdvanced: true }).error);
  assert.ok(calculateAbilityOptimalStrategy({ useAdvanced: true, targets: [...mixed, mixed[0]] }).error);
});


test("반값 단가는 모든 잠금 수에서 절반이며 고급 직접 계산의 메소·횟수는 유지한다", () => {
  for (const method of ["honor", "advanced"]) {
    for (const locks of [0, 1, 2]) close(getAbilityResetHonorCost(method, locks, true), getAbilityResetHonorCost(method, locks) / 2);
  }
  const targets = [
    { type: "boss-damage", minimum: 20, grade: "legendary", locked: true },
    { type: "passive-level", minimum: 1, grade: "legendary", locked: true },
    { type: "abnormal-damage", minimum: 10, grade: "legendary" },
  ];
  const full = calculateAbilityExpected({ method: "advanced", targets });
  const half = calculateAbilityExpected({ method: "advanced", targets, halfHonor: true });
  close(half.resourcePerReset, 20_000);
  close(half.expectedResource, full.expectedResource / 2);
  close(half.expectedResets, full.expectedResets);
  close(half.expectedMeso, full.expectedMeso);
});
