import test from "node:test";
import assert from "node:assert/strict";
import { calculateStarforceExpected } from "maple-core/starforce";
import { compileStarforceDistribution } from "../src/shared/starforce-variance.js";
import { reduceStarforceRisk, starforcePlanMoments } from "../src/shared/starforce-risk-reduction.js";

function plan(overrides = {}) {
  return { ...calculateStarforceExpected({ itemLevel: 160, startStar: 12, targetStar: 21,
    replacementPrice: 55e8, event: "shining", mvp: "diamond", pc: false, ...overrides }),
    sourceIndex: 0, name: "고근", quantity: 1, ...overrides };
}
const close = (a, b) => assert.ok(Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-10), `${a} != ${b}`);

test("고근 55억 12→21 jointly adds safeguard 16 and restore 20 within the cost cap", () => {
  const input = plan(), saved = JSON.stringify(input), result = reduceStarforceRisk([input]);
  assert.equal(JSON.stringify(input), saved);
  assert.equal(result.improves, true);
  assert.deepEqual(result.plans[0].destroyPrevention, [15, 16, 17]);
  assert.deepEqual(result.plans[0].restore, [18, 20]);
  close(result.recommended.mean / 1e8, 138.6902179140388);
  close(result.recommended.standardDeviation / 1e8, 131.31280754501174);
  assert.ok(result.recommended.mean <= result.minimum.mean * 1.005);
  assert.ok(result.recommended.standardDeviation < result.minimum.standardDeviation);
  assert.deepEqual(reduceStarforceRisk([input]), result);
});

test("combined budget agrees with an independent exhaustive cross-product oracle", () => {
  const inputs = [plan({ targetStar: 17, replacementPrice: 30e8 }),
    plan({ targetStar: 17, itemLevel: 200, replacementPrice: 70e8, sourceIndex: 3, name: "다른 장비", quantity: 2 })];
  const choices = inputs.map((input) => {
    const options = [];
    for (let flags = 0; flags < 16; flags++) {
      const computed = calculateStarforceExpected({ ...input, optimize: false,
        destroyPrevention: [15, 16].filter((_, index) => flags & (1 << index)),
        restore: [15, 16].filter((_, index) => flags & (1 << (index + 2))) });
      const distribution = compileStarforceDistribution(computed);
      options.push({ mean: distribution.mean * input.quantity, variance: distribution.variance * input.quantity });
    }
    return options;
  });
  const baseline = inputs.reduce((sum, input) => sum + calculateStarforceExpected({ ...input, optimize: true }).expectedCost * input.quantity, 0);
  let best = Infinity;
  for (const a of choices[0]) for (const b of choices[1]) {
    if (a.mean + b.mean <= baseline * 1.005) best = Math.min(best, a.variance + b.variance);
  }
  const result = reduceStarforceRisk(inputs);
  close(result.recommended.standardDeviation ** 2, best);
  assert.ok(result.recommended.mean <= baseline * 1.005);
  assert.deepEqual(result.plans.map((p) => [p.sourceIndex, p.name]), [[0, "고근"], [3, "다른 장비"]]);
});

test("all levels and events, lower replay stages, high targets and NPC spares respect the cap", () => {
  for (const itemLevel of [130, 135, 140, 145, 150, 160, 200, 250]) {
    for (const event of ["none", "discount30", "destroy30", "shining"]) {
      const input = plan({ itemLevel, event, startStar: 18, targetStar: itemLevel < 140 ? 20 : 26,
        replacementPrice: itemLevel % 2 ? 0 : 55e8, singleSpare: itemLevel === 250, quantity: 3 });
      const result = reduceStarforceRisk([input]);
      assert.ok(result.recommended.mean <= result.minimum.mean * 1.005 + 0.001);
      assert.ok(result.recommended.standardDeviation <= result.minimum.standardDeviation * (1 + 1e-10));
      const selected = result.plans[0];
      const replayed = calculateStarforceExpected({ ...selected, optimize: false });
      const distribution = compileStarforceDistribution(replayed);
      close(distribution.mean * input.quantity, result.recommended.mean);
      close(distribution.variance * input.quantity, result.recommended.standardDeviation ** 2);
      assert.ok(selected.restore.every((star) => star <= 22));
    }
  }
});

test("identical equipment keeps its own identity, with independent quantities", () => {
  const inputs = [plan({ sourceIndex: 2, name: "A" }), plan({ sourceIndex: 5, name: "B" })];
  const result = reduceStarforceRisk(inputs);
  assert.deepEqual(result.plans.map((p) => [p.sourceIndex, p.name]), [[2, "A"], [5, "B"]]);
  const single = reduceStarforceRisk([inputs[0]]);
  close(result.recommended.mean, single.recommended.mean * 2);
  close(result.recommended.standardDeviation, single.recommended.standardDeviation * Math.sqrt(2));
});

test("no-destruction, deterministic and manually selected lower-risk strategies", () => {
  const noBoom = reduceStarforceRisk([plan({ startStar: 0, targetStar: 12 })]);
  assert.equal(noBoom.improves, false);
  close(noBoom.recommended.mean, noBoom.minimum.mean);
  const guaranteed = reduceStarforceRisk([plan({ startStar: 15, targetStar: 16, event: "shining15" })]);
  assert.equal(guaranteed.improves, false);
  assert.equal(guaranteed.recommended.standardDeviation, 0);
  const reduced = reduceStarforceRisk([plan()]);
  const repeated = reduceStarforceRisk(reduced.plans);
  assert.equal(repeated.improves, true);
  assert.deepEqual(starforcePlanMoments(reduced.plans), repeated.current);
});

test("recommendation availability uses optimization even when the current policy changes", () => {
  const optimized = reduceStarforceRisk([plan()]);
  const manual = reduceStarforceRisk([plan({ optimize: false, destroyPrevention: [], restore: [15, 20] })]);
  assert.deepEqual(manual.minimum, optimized.minimum);
  assert.deepEqual(manual.recommended, optimized.recommended);
  assert.equal(manual.improves, optimized.improves);
  assert.notDeepEqual(manual.current, optimized.current);

  // Switching away from the optimum must not create a reduction recommendation
  // when the best policy within the allowance is the optimum itself.
  const cape = reduceStarforceRisk([plan({ itemLevel: 200, startStar: 0,
    replacementPrice: 14.7e8, optimize: false, destroyPrevention: [], restore: [15, 20] })]);
  assert.notDeepEqual(cape.current, cape.minimum);
  close(cape.recommended.standardDeviation, cape.minimum.standardDeviation);
  assert.equal(cape.improves, false);
});
