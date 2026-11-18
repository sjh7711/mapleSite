import test from "node:test";
import assert from "node:assert/strict";
import { summarizeVariance, varianceCostPosition, varianceBudgetPosition, varianceQuantile, createVarianceSimulation } from "../src/shared/starforce-variance.js";
import { createVarianceComparison, varianceMeanMarkers } from "../src/shared/starforce-variance-comparison.js";
import { varianceCostAxis } from "../src/shared/starforce-variance-axis.js";
import { calculateStarforceExpected } from "maple-core/starforce";
import { reduceStarforceRisk } from "../src/shared/starforce-risk-reduction.js";

const result = (values) => summarizeVariance(Float64Array.from(values), 0, 0);
test("money markers invert the plotted quantile across gaps and ties without changing budget probabilities", () => {
  for (const values of [[0, 100, 100, 1000], [10, 10, 10], [0], [1e15, 2e15, 9e15]]) {
    const sorted = Float64Array.from(values), from = sorted[0], to = sorted.at(-1);
    for (let i = 0; i <= 100; i++) {
      const cost = from + (to - from) * i / 100, rank = varianceCostPosition(sorted, cost);
      assert.ok(rank >= 0 && rank <= 1);
      assert.ok(Math.abs(varianceQuantile(sorted, rank) - cost) <= Math.max(1e-9, cost * 1e-12));
    }
  }
  const tied = Float64Array.from([0, 100, 100, 1000]);
  assert.equal(varianceCostPosition(tied, 100), 0.5);
  assert.equal(varianceBudgetPosition(tied, 100), 0.75);
});

test("고근 0→21 comparison marks each strategy's own mean instead of reusing the basic mean rank", () => {
  const basic = { ...calculateStarforceExpected({ itemLevel: 160, startStar: 0, targetStar: 21,
    replacementPrice: 55e8, event: "shining", mvp: "diamond", pc: false, optimize: true }),
    sourceIndex: 0, name: "고근", quantity: 1 };
  const recommendation = reduceStarforceRisk([basic]);
  const [current, reduced] = [basic, recommendation.plans[0]].map((plan) => {
    const simulation = createVarianceSimulation({ plans: [plan] }, 30000);
    simulation.step(30000); return simulation.finish();
  });
  assert.ok(Math.abs(reduced.mean / 1e8 - 138.94420805483614) < 1e-8);
  const markers = varianceMeanMarkers(current, createVarianceComparison(current, reduced));
  assert.deepEqual(markers.map((m) => m.text), ["기본 평균", "편차 감소 평균"]);
  assert.ok(Math.abs(markers[0].rank - markers[1].rank) > 0.03);
  for (const [i, marker] of markers.entries()) {
    const entry = [current, reduced][i];
    assert.equal(marker.value, entry.mean);
    assert.ok(Math.abs(varianceQuantile(entry.sorted, marker.rank) - marker.value) < 0.01);
  }
  // This is the previously confusing value, correctly a different rank's
  // completion cost rather than the reduction strategy's expected cost.
  assert.ok(varianceQuantile(reduced.sorted, markers[0].rank) / 1e8 > 170);
});

test("strategy comparison uses a fixed shared money scale and preserves source samples", () => {
  const current = result([10, 20, 30, 40, 50]);
  const reduced = result([15, 18, 20, 22, 40]);
  const comparison = createVarianceComparison(current, reduced);
  assert.deepEqual([...comparison.sorted], [10, 15, 18, 20, 20, 22, 30, 40, 40, 50]);
  assert.deepEqual([...current.sorted], [10, 20, 30, 40, 50]);
  assert.deepEqual([...reduced.sorted], [15, 18, 20, 22, 40]);
  const axis = varianceCostAxis(comparison.sorted);
  for (const cost of [10, 15, 20, 30, 40, 50]) {
    assert.equal(varianceCostAxis(comparison.sorted).position(cost), axis.position(cost));
  }
});

test("both histograms use identical boundaries and percentage limits, conserving every outcome", () => {
  const current = result([1, 10, 10, 10, 30, 100, 500]);
  const reduced = result([5, 12, 13, 15, 18, 20, 100]);
  const comparison = createVarianceComparison(current, reduced);
  for (const binCount of [12, 40, 88]) {
    const before = comparison.histogram(current, binCount), after = comparison.histogram(reduced, binCount);
    assert.deepEqual(before.data.bins.map((b) => [b.lower, b.upper, b.overflow]), after.data.bins.map((b) => [b.lower, b.upper, b.overflow]));
    assert.equal(before.peak, after.peak);
    for (const { data } of [before, after]) {
      assert.equal(data.bins.reduce((sum, b) => sum + b.count, 0), 7);
      assert.equal(data.bins.at(-1).cumulativeProbability, 1);
      assert.ok(Math.abs(data.bins.reduce((sum, b) => sum + b.probability, 0) - 1) < 1e-12);
    }
    assert.equal(before.data.bins.at(-1).count, 1);
    assert.equal(after.data.bins.at(-1).count, 0);
    assert.equal(comparison.histogram(current, binCount).data, before.data);
  }
});

test("shared distribution handles deterministic, zero-cost and unequal-sized samples", () => {
  for (const [a, b] of [[[0, 0], [0, 0, 0]], [[0, 0], [100, 100]], [[7], [7, 7, 9]]]) {
    const current = result(a), reduced = result(b), comparison = createVarianceComparison(current, reduced);
    for (const entry of [current, reduced]) {
      const { data, peak } = comparison.histogram(entry, 40);
      assert.ok(Number.isFinite(peak));
      assert.equal(data.bins.reduce((sum, bin) => sum + bin.count, 0), entry.sorted.length);
      assert.ok(data.bins.every((bin) => Number.isFinite(bin.probability) && bin.probability >= 0));
    }
  }
});
