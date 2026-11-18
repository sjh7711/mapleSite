import test from "node:test";
import assert from "node:assert/strict";
import { summarizeVariance } from "../src/shared/starforce-variance.js";
import { createVarianceComparison } from "../src/shared/starforce-variance-comparison.js";
import { varianceCostDifference, varianceDifferenceCurve, varianceDifferenceAxis, varianceHistogramDifference } from "../src/shared/starforce-variance-difference.js";

const compare = (a, b) => createVarianceComparison(...[a, b].map((values) => summarizeVariance(Float64Array.from(values), 0, 0)));
test("rank difference uses the same exact quantile and includes tails, gaps and unequal sample sizes", () => {
  const comparison = compare([10, 30, 100], [20, 25, 35, 50]);
  assert.deepEqual(varianceCostDifference(comparison, 0.5), { rank: 0.5, basic: 30, reduced: 30, difference: 0 });
  assert.equal(varianceCostDifference(comparison, 0).difference, 10);
  assert.equal(varianceCostDifference(comparison, 1).difference, -50);
  const points = varianceDifferenceCurve(comparison);
  assert.deepEqual(points.map((point) => point.rank), [0, 1 / 3, 0.5, 2 / 3, 1]);
  const reversed = compare([20, 25, 35, 50], [10, 30, 100]);
  for (const point of points) assert.equal(varianceCostDifference(reversed, point.rank).difference, -point.difference || 0);
  assert.equal(varianceDifferenceCurve(comparison), points);
});

test("histogram differences are percentage points, conserve all outcomes and share identical bins", () => {
  const comparison = compare([1, 1, 1, 100], [1, 100, 100, 100]);
  const { bins } = varianceHistogramDifference(comparison, 12);
  assert.equal(bins[0].difference, -50); // 25% - 75%, not -66.67% relative change
  assert.equal(bins.at(-1).difference, 50);
  assert.ok(Math.abs(bins.reduce((sum, bin) => sum + bin.difference, 0)) < 1e-12);
  assert.equal(bins.reduce((sum, bin) => sum + bin.basic.count, 0), 4);
  assert.equal(bins.reduce((sum, bin) => sum + bin.reduced.count, 0), 4);
  assert.ok(bins.every((bin) => bin.basic.lower === bin.reduced.lower && bin.basic.upper === bin.reduced.upper));
});

test("equal constant distributions have no artificial difference; signed axis always includes zero and extrema", () => {
  for (const value of [0, 15, 1e15]) {
    const comparison = compare([value, value], [value, value, value]);
    assert.ok(varianceDifferenceCurve(comparison).every((point) => point.difference === 0));
    assert.ok(varianceHistogramDifference(comparison, 20).bins.every((bin) => bin.difference === 0));
  }
  for (const values of [[0], [-1, 1], [-1e10, 40], [0.03, -0.006], [1e15, -1e15]]) {
    const { maximum, ticks } = varianceDifferenceAxis(values, 0.01);
    assert.ok(maximum > 0 && Number.isFinite(maximum));
    assert.ok(values.every((value) => Math.abs(value) <= maximum));
    assert.ok(ticks.includes(0)); assert.equal(ticks[0], -ticks.at(-1));
    assert.ok(ticks.every((tick) => Number.isFinite(tick)));
  }
});

test("tail compression is symmetric, continuous and linear around zero, retaining every extreme", () => {
  const axis = varianceDifferenceAxis([-400, 2, 8, 30], 0.01, 10);
  assert.equal(axis.compressed, true);
  assert.equal(axis.position(0), 0);
  assert.equal(axis.position(axis.maximum), 1);
  assert.equal(axis.position(-axis.maximum), -1);
  assert.ok(Math.abs(axis.position(5) * 2 - axis.position(10)) < 1e-12);
  assert.ok(Math.abs(axis.position(10 - 1e-8) - axis.position(10 + 1e-8)) < 1e-8);
  for (const value of [1, 10, 50, 100, 400]) assert.equal(axis.position(value), -axis.position(-value));
  assert.equal(axis.ticks[0], -axis.ticks.at(-1));
  assert.equal(varianceDifferenceAxis([0], 1, 0).compressed, false);
});
