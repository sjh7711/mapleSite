import assert from "node:assert/strict";
import test from "node:test";
import { calculateAbilityOptimalStrategy as calculate, chooseAbilityAbyssResult } from "../src/ability.js";

const lete = [
  { type: "cooldown-skip", minimum: 20, grade: "legendary" },
  { type: "boss-damage", minimum: 20, grade: "legendary" },
  { type: "abnormal-damage", minimum: 10, grade: "legendary" },
];
const bow = [
  { type: "boss-damage", minimum: 20, grade: "legendary" },
  { type: "abnormal-damage", minimum: 8, grade: "unique" },
  { type: "critical", minimum: 20, grade: "unique" },
];
const close = (actual, expected, tolerance = 1e-8) => assert.ok(
  Math.abs(actual - expected) < tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`,
);
let result;
test("Lete 40: useful partial results and retained locks match independently audited expectations", () => {
  result = calculate({ targets: lete, useAdvanced: true, abyssCount: 40 });
  assert.equal(result.strategyMode, "abyss-completion");
  close(result.expectedHonor, 114012725.95235279);
  close(result.expectedMeso, 24524424858.674232);
  close(result.expectedCirculators.abyss, 35.38415833432918);
  close(result.expectedHonorResets, result.expectedNormalResets + result.expectedAdvancedResets);
  const seed = result.abyssComparison.find((candidate) => candidate.abyssSeedLine === 1);
  close(seed.expectedHonor, 174987786.17242938);
  close(seed.expectedCirculators.abyss, 8.765832331030623);
  assert.equal(seed.abyssAcquisitionMethod, "advanced");
  const branches = result.steps.at(-1).branches;
  assert.equal(branches.find((branch) => branch.completedMask === 2).keepMask, 2);
  assert.equal(branches.find((branch) => branch.completedMask === 3).keepMask, 2);
  assert.equal(branches.find((branch) => branch.completedMask === 6).keepMask, 6);
  assert.equal(branches.find((branch) => branch.completedMask === 1).keepMask, 0);
  for (const branch of branches) assert.equal(branch.keepMask & ~branch.completedMask, 0);
});

test("whole-result choice agrees with an independent O(stock × states²) finite-stock reference", () => {
  const guide = result.steps.find((step) => step.abyssGuide).abyssGuide;
  const { states } = guide;
  // Independently audited honor continuation costs; cheap first-line completion
  // alone is deliberately discarded, while a completed rare lower line is kept.
  const terminal = [363017002.3984951, 363017002.3984951, 151125100.3717226, 151125100.3717226,
    363017002.3984951, 363017002.3984951, 20575990.745222528, 0];
  let values = states.map((state) => terminal[state.mask]);
  let acceptsPartial = false;
  for (let remaining = 0; remaining < 40; remaining += 1) {
    for (let old = 0; old < states.length; old += 1) for (let next = 0; next < states.length; next += 1) {
      const choice = chooseAbilityAbyssResult(guide, states[old].values, states[next].values, remaining);
      const chosen = choice.apply ? next : old;
      assert.ok(values[chosen] <= Math.min(values[old], values[next]) + 1e-6);
      if (choice.apply && states[next].mask !== 7 && states[next].mask !== 0) acceptsPartial = true;
      if (remaining === 0) assert.equal(choice.keepMask & ~choice.completedMask, 0);
    }
    values = states.map((state, old) => state.mask === 7 ? 0 : states.reduce((sum, proposed, next) => (
      next === old ? sum : sum + proposed.probability / (1 - state.probability) * Math.min(values[old], values[next])
    ), 0));
  }
  assert.ok(acceptsPartial);
  assert.equal(chooseAbilityAbyssResult(guide, [null, null, null], [20, 20, 10], 0), null);
  const exhausted = chooseAbilityAbyssResult(guide, [20, 15, 9], [15, 20, 9], 0);
  assert.equal(exhausted.apply, true);
  assert.equal(exhausted.keepMask, 2);
});

test("Bowmaster normal: both one-line and full acquisition candidates include finite stock", () => {
  const ordinary = calculate({ targets: bow, abyssCount: 20 });
  close(ordinary.expectedHonor, 30891795.556248758);
  close(ordinary.expectedCirculators.abyss, 19.474150661254335);
  assert.equal(ordinary.expectedMeso, 0);
  const seed = ordinary.abyssComparison.find((candidate) => candidate.abyssSeedLine === 2);
  close(seed.expectedHonor, 33401254.34099552);
  close(seed.expectedCirculators.abyss, 7.838837542688922);
  assert.equal(seed.abyssAcquisitionMethod, "honor");
  const half = calculate({ targets: bow, abyssCount: 20, halfHonor: true });
  close(half.expectedHonor, ordinary.expectedHonor / 2);
  close(half.expectedHonorResets, ordinary.expectedHonorResets);
});

test("small stock can select one-line acquisition, including incomplete goals and fixed lower order", () => {
  for (const swapLower of [true, false]) {
    const targets = [{}, {}, { type: "critical", minimum: 30, grade: "legendary" }];
    const base = calculate({ targets, useAdvanced: true, swapLower });
    const next = calculate({ targets, useAdvanced: true, swapLower, abyssCount: 5 });
    assert.equal(next.strategyMode, "abyss-single-line");
    assert.equal(next.abyssSeedLine, 2);
    assert.ok(next.expectedHonor < base.expectedHonor);
    assert.ok(next.expectedCirculators.abyss <= 5);
    assert.ok(next.steps[1].successLabel.includes("한 줄"));
    assert.ok(next.steps[2].branches.some((branch) => branch.label.includes("미달")));
  }
});

test("unused/disabled stock is unchanged, other inventories are not spent twice, and placement is recomputed", () => {
  const options = { targets: lete, useAdvanced: true };
  const base = calculate(options);
  assert.deepEqual(calculate({ ...options, abyssCount: 0 }), base);
  assert.deepEqual(calculate({ ...options, abyssCount: 40, allowAbyss: false }), base);
  const mixed = calculate({ targets: bow, abyssCount: 20, miracleCount: 3, blackCount: 7, chaosCount: 2 });
  for (const [id, count] of Object.entries({ abyss: 20, miracle: 3, black: 7, chaos: 2 })) {
    assert.ok(mixed.expectedCirculators[id] >= 0 && mixed.expectedCirculators[id] <= count + 1e-8);
  }
  close(mixed.expectedHonorResets, mixed.expectedNormalResets + mixed.expectedAdvancedResets);
  const placement = calculate({ ...options, abyssCount: 40, comparePlacements: true });
  assert.ok(placement.expectedHonor <= result.expectedHonor);
  if (placement.placementRecommendation) {
    close(placement.expectedHonor, calculate({ ...options, abyssCount: 40,
      targets: placement.placementRecommendation.recommendedTargets }).expectedHonor);
  }
});

test("very large stock converges with a bounded numerical tail and bounded result size", () => {
  const targets = [lete[0], lete[1], { type: "critical", minimum: 30, grade: "legendary" }];
  const large = calculate({ targets, useAdvanced: true, abyssCount: 1e9 });
  const guide = large.steps.find((step) => step.abyssGuide).abyssGuide;
  assert.ok(guide.computedUses < 100000);
  assert.ok(large.expectedCirculators.abyss > 0 && large.expectedCirculators.abyss < 1e9);
  assert.ok(Number.isFinite(large.expectedHonor));
  assert.ok(JSON.stringify(large).length < 1e6);
});


test("고급 반값 설정은 심서큘 전후 비용과 각 후보·추천 배치를 절반 명성치로 비교한다", () => {
  const options = { targets: lete, useAdvanced: true, abyssCount: 40, comparePlacements: true };
  const full = calculate(options);
  const half = calculate({ ...options, halfHonor: true });
  close(half.expectedHonor, full.expectedHonor / 2);
  close(half.baselineHonor, full.baselineHonor / 2);
  close(half.expectedMeso, full.expectedMeso);
  close(half.expectedHonorResets, full.expectedHonorResets);
  close(half.expectedCirculators.abyss, full.expectedCirculators.abyss);
  assert.equal(half.strategyMode, full.strategyMode);
  for (const candidate of half.abyssComparison) {
    const original = full.abyssComparison.find((entry) => entry.strategyMode === candidate.strategyMode &&
      entry.abyssSeedLine === candidate.abyssSeedLine && entry.abyssAcquisitionMethod === candidate.abyssAcquisitionMethod);
    assert.ok(original);
    close(candidate.expectedHonor, original.expectedHonor / 2);
    close(candidate.expectedMeso, original.expectedMeso);
  }
});
