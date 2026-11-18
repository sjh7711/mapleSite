import test from "node:test";
import assert from "node:assert/strict";
import { varianceCostAxis } from "../src/shared/starforce-variance-axis.js";
import { varianceQuantile } from "../src/shared/starforce-variance.js";

const costs = Float64Array.from({ length: 1001 }, (_, i) => 1e8 * (10 + Math.expm1(i / 100)));
const near = (actual, expected, tolerance = 1e-9) => assert.ok(
  Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} vs ${expected}`);

test("central P10–P90 costs have equal spacing for equal money differences", () => {
  const axis = varianceCostAxis(costs);
  near(axis.focusMinimum, varianceQuantile(costs, 0.1));
  near(axis.focusMaximum, varianceQuantile(costs, 0.9));
  const positions = Array.from({ length: 9 }, (_, i) => axis.position(
    axis.focusMinimum + (axis.focusMaximum - axis.focusMinimum) * i / 8));
  for (let i = 2; i < positions.length; i++) near(positions[i] - positions[i - 1], positions[1] - positions[0]);
});

test("tails compress money differences and join the central line without a slope jump", () => {
  const axis = varianceCostAxis(costs);
  const span = axis.focusMaximum - axis.focusMinimum, delta = span * 1e-7;
  for (const boundary of [axis.focusMinimum, axis.focusMaximum]) {
    const left = (axis.position(boundary) - axis.position(boundary - delta)) / delta;
    const right = (axis.position(boundary + delta) - axis.position(boundary)) / delta;
    assert.ok(Math.abs(left / right - 1) < 2e-6);
  }
  const central = axis.position(axis.focusMinimum + span / 2) - axis.position(axis.focusMinimum);
  const upperTail = axis.position(axis.focusMaximum + span / 2) - axis.position(axis.focusMaximum);
  const lowerTail = axis.position(axis.focusMinimum) - axis.position(axis.focusMinimum - span / 2);
  assert.ok(upperTail < central && lowerTail < central);
});

test("axis is monotone, reaches both endpoints and reverses to the original cost", () => {
  for (const sorted of [costs, [0, 1, 10, 100, 1e12], [1, ...Array(100).fill(50), 1e10]]) {
    const axis = varianceCostAxis(sorted);
    near(axis.position(sorted[0]), 0); near(axis.position(sorted.at(-1)), 1);
    let previous = -1;
    for (let i = 0; i <= 1000; i++) {
      const cost = varianceQuantile(sorted, i / 1000), position = axis.position(cost);
      assert.ok(position >= previous);
      near(axis.costAt(position), cost, 1e-7);
      previous = position;
    }
  }
});

test("changing monetary units does not change the graph", () => {
  const axis = varianceCostAxis(costs), eok = varianceCostAxis(costs.map(value => value / 1e8));
  for (const cost of costs) near(axis.position(cost), eok.position(cost / 1e8));
});

test("an extreme outlier cannot crowd distinct central costs into a small strip", () => {
  const sorted = Array.from({ length: 1001 }, (_, i) => i === 1000 ? 1e15 : 1e10 + i);
  const axis = varianceCostAxis(sorted);
  const centralHeight = axis.position(axis.focusMaximum) - axis.position(axis.focusMinimum);
  assert.ok(centralHeight >= 0.6 - 1e-8);
  // The exception still preserves a linear center and exact displayed costs.
  const middle = (axis.focusMinimum + axis.focusMaximum) / 2;
  near(axis.position(middle), (axis.position(axis.focusMinimum) + axis.position(axis.focusMaximum)) / 2);
  for (const cost of sorted) near(axis.costAt(axis.position(cost)), cost, 1e-7);
});

test("zero, tied and empty samples stay finite at the baseline", () => {
  for (const sorted of [[], [0], [0, 0, 0], [3e10, 3e10, 3e10]]) {
    const axis = varianceCostAxis(sorted), cost = sorted[0] ?? 0;
    assert.equal(axis.position(cost), 0);
    for (const position of [0, 0.1, 0.5, 0.9, 1]) assert.equal(axis.costAt(position), cost);
  }
});
