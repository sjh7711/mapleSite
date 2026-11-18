import test from "node:test";
import assert from "node:assert/strict";
import { calculateStarforceExpected } from "maple-core/starforce";
import { costRangeValues } from "../src/shared/starforce-cost-range.js";
import { createVarianceSimulation } from "../src/shared/starforce-variance.js";
import { reduceStarforceRisk } from "../src/shared/starforce-risk-reduction.js";

function plan(overrides = {}) {
  return { ...calculateStarforceExpected({ itemLevel: 160, startStar: 0, targetStar: 21,
    replacementPrice: 55e8, event: "shining", mvp: "diamond", pc: false,
    optimize: true, ...overrides }), sourceIndex: 0, quantity: 1, name: "고근" };
}
const simulate = (source) => {
  const job = createVarianceSimulation({ plans: [source] }, 30000);
  job.step(30000); return job.finish();
};
const close = (a, b) => assert.ok(Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-10));

test("current range uses the selected strategy's samples, including after recommendation application", () => {
  const current = plan(), reduced = reduceStarforceRisk([current]).plans[0];
  const before = costRangeValues(simulate(current)), after = costRangeValues(simulate(reduced));
  close(before[10] / 1e8, 22.728732172);
  close(before[50] / 1e8, 101.714526235);
  close(before[99] / 1e8, 652.5340173664996);
  close(after[50] / 1e8, 105.420882825);
  close(after[99] / 1e8, 587.8990692750999);
  assert.ok(after[10] > before[10]); // Do not imply every percentile improves.
  assert.ok(after[99] < before[99]);
});

test("manual strategy is compared to the same optimized baseline, not to its own cost", () => {
  const optimized = reduceStarforceRisk([plan()]);
  const manualPlan = plan({ optimize: false, destroyPrevention: [17], restore: [16, 18, 19, 20, 21, 22] });
  const manual = reduceStarforceRisk([manualPlan]);
  close(manual.minimum.mean, optimized.minimum.mean);
  close(manual.minimum.standardDeviation, optimized.minimum.standardDeviation);
  assert.ok(manual.current.mean > manual.minimum.mean);
  assert.ok(manual.current.standardDeviation > manual.minimum.standardDeviation);
  assert.notDeepEqual(costRangeValues(simulate(manualPlan)), costRangeValues(simulate(plan())));
});

test("zero and deterministic completion costs produce finite collapsed ranges", () => {
  for (const value of [0, 1, 1e12]) {
    const sorted = Float64Array.of(value, value, value);
    const range = costRangeValues({ sorted });
    assert.ok(Object.values(range).every((v) => v === value));
    assert.deepEqual([...sorted], [value, value, value]);
  }
});

test("range trims both tails instead of using the simulated maximum", () => {
  const range = costRangeValues({ sorted: Float64Array.of(10, 20, 1000) });
  close(range[1], 10.2);
  close(range[99], 980.4);
  assert.equal(range[100], undefined);
  assert.ok(range[99] < 1000);
});
