import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAbilityExpected, calculateAbilityOptimalStrategy,
  calculateAbilityAbyssChanceWithin, calculateAbilityAbyssAttemptsForChance,
  getAbilityTargetValues,
} from "../src/ability.js";

const targets = [
  { type: "passive-level", minimum: 1, grade: "legendary" },
  { type: "boss-damage", minimum: 20, grade: "legendary" },
  { type: "abnormal-damage", minimum: 10, grade: "legendary" },
];
const close = (a, b) => assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)), `${a} != ${b}`);

test("Abyss offers legendary values in all lines while Black keeps its previous grades", () => {
  assert.ok(getAbilityTargetValues("boss-damage", 1, "abyss", "legendary").includes(20));
  assert.deepEqual(getAbilityTargetValues("passive-level", 2, "abyss", "legendary"), [1]);
  assert.ok(!getAbilityTargetValues("boss-damage", 1, "black", "legendary").includes(20));
  assert.ok(calculateAbilityExpected({ method: "abyss", targets: targets.slice(0, 2) }).error);
});

test("Abyss expectation and reach use the official joint value distribution and exclude identical results", () => {
  const result = calculateAbilityExpected({ method: "abyss", targets });
  assert.equal(result.error, null);
  close(result.rawProbability, 0.06);
  const failures = [];
  [0.2, 0.2, 0.2, 0.15, 0.15, 0.1].forEach((boss, index) => {
    [0.4, 0.6].forEach((abnormal, value) => {
      if (index !== 5 || value !== 1) failures.push(boss * abnormal);
    });
  });
  const expected = failures.reduce((sum, p) => sum + (p / 0.94) * (1 - p) / 0.06, 0);
  close(result.expectedResets, expected);
  close(result.expectedResource, 15.117021276595745);
  for (const n of [0, 1, 10, 50, 100]) {
    const cdf = failures.reduce((sum, p) => sum + p / 0.94 * (1 - (1 - 0.06 / (1 - p)) ** n), 0);
    close(calculateAbilityAbyssChanceWithin(result, n), cdf);
  }
  for (const chance of [0.0001, 0.5, 0.8, 0.95, 0.9999]) {
    const count = calculateAbilityAbyssAttemptsForChance(result, chance);
    assert.ok(calculateAbilityAbyssChanceWithin(result, count) >= chance - 1e-12);
    assert.ok(calculateAbilityAbyssChanceWithin(result, count - 1) < chance);
  }
});

test("duplicate numerical rows are combined before excluding the old complete result", () => {
  const twoOutcomes = [targets[0], { type: "attack", minimum: 30, grade: "legendary" },
    { type: "multi-target", minimum: 1, grade: "legendary" }];
  const result = calculateAbilityExpected({ method: "abyss", targets: twoOutcomes });
  close(result.rawProbability, 0.4);
  close(result.expectedResets, 1); // 27 (60%) is excluded, so 30 (40%) is certain.
  assert.equal(calculateAbilityAbyssChanceWithin(result, 0), 0);
  close(calculateAbilityAbyssChanceWithin(result, 1), 1);
  assert.equal(calculateAbilityAbyssAttemptsForChance(result, 0.9999), 1);
  twoOutcomes[1].minimum = 27;
  const complete = calculateAbilityExpected({ method: "abyss", targets: twoOutcomes });
  assert.equal(complete.complete, true);
  assert.equal(complete.expectedResource, 0);
});

test("advanced strategy compares finite Abyss stock and falls back after exhausting it", () => {
  const options = { targets, useAdvanced: true };
  const baseline = calculateAbilityOptimalStrategy(options);
  const result = calculateAbilityOptimalStrategy({ ...options, abyssCount: 100 });
  assert.equal(result.error, null);
  assert.equal(result.strategyMode, "abyss-completion");
  assert.ok(result.expectedHonor < baseline.expectedHonor);
  assert.ok(result.expectedCirculators.abyss > 0 && result.expectedCirculators.abyss <= 100);
  assert.equal(result.steps[0].method, "advanced");
  const abyss = result.steps.find((step) => step.method === "abyss");
  assert.equal(abyss.maximumUses, 100);
  assert.ok(abyss.successProbability > 0 && abyss.successProbability < 1);
  assert.ok(result.steps.some((step) => step.title.startsWith("심서큘 소진 후")));
  close(result.expectedHonorResets, result.expectedNormalResets + result.expectedAdvancedResets);
  assert.deepEqual(calculateAbilityOptimalStrategy({ ...options, abyssCount: 100, allowAbyss: false }), baseline);
  assert.deepEqual(calculateAbilityOptimalStrategy({ ...options, abyssCount: 0 }), baseline);
});

test("ordinary and mixed-grade strategies preserve exact grades when acquiring for Abyss", () => {
  const mixed = [targets[0], targets[1], { ...targets[2], grade: "unique", minimum: 8 }];
  const ordinary = [targets[0], { ...targets[1], grade: "unique", minimum: 10 }, mixed[2]];
  for (const [goal, useAdvanced] of [[mixed, true], [ordinary, false]]) {
    const baseline = calculateAbilityOptimalStrategy({ targets: goal, useAdvanced });
    const result = calculateAbilityOptimalStrategy({ targets: goal, useAdvanced, abyssCount: 100 });
    assert.equal(result.error, null);
    assert.ok(result.expectedHonor <= baseline.expectedHonor);
    assert.ok((result.expectedCirculators.abyss ?? 0) <= 100);
    if (result.strategyMode === "abyss-completion") {
      assert.ok(result.steps[0].priority.some((text) => text.includes("유니크")));
    }
  }
  const rejected = calculateAbilityOptimalStrategy({ targets: mixed, useAdvanced: false });
  assert.match(rejected.error, /고급 재설정/);
  assert.deepEqual(mixed[1], targets[1]);
});
