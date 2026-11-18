import test from "node:test";
import assert from "node:assert/strict";
import { nearbyVarianceMarker } from "../src/shared/starforce-variance-chart-layout.js";

test("all reference types snap to the closest line within three screen pixels", () => {
  const markers = ["median", "mean", "mean-reduced", "blacksmith", "budget"]
    .map((kind, index) => ({ kind, x: 20 + index * 30 }));
  for (const scale of [0.5, 1, 2]) {
    for (const marker of markers) {
      assert.equal(nearbyVarianceMarker(markers, marker.x + 3 / scale, scale), marker);
      assert.equal(nearbyVarianceMarker(markers, marker.x + 3.01 / scale, scale), null);
    }
  }
  assert.equal(nearbyVarianceMarker([{ x: 10 }, { x: 13 }], 12).x, 13);
  assert.equal(nearbyVarianceMarker([], 0), null);
});

test("histogram guides use their monetary-axis position and keep coincident guides stable", () => {
  const mean = { kind: "mean", position: 80 };
  const budget = { kind: "budget", position: 80 };
  const position = (marker) => marker.position;
  assert.equal(nearbyVarianceMarker([mean, budget], 82, 1, position), mean);
  assert.equal(nearbyVarianceMarker([mean, budget], 84, 1, position), null);
  assert.deepEqual(mean, { kind: "mean", position: 80 });
});
