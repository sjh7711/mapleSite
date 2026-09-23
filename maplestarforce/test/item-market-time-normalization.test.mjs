import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMarketPeriods } from "../src/shared/item-market-time-normalization.js";

const definitions = [
  { key: "sf", component: "starforce" }, { key: "pot", component: "potential_options" },
  { key: "flame", component: "flame" }, { key: "scroll", component: "scroll" },
  { key: "scissors", component: "trade" },
];
function data() {
  const rows = [];
  for (let period = 0; period < 2; period += 1) {
    for (let bits = 0; bits < 32; bits += 1) {
      const [sf, pot, flame, scroll, scissors] = Array.from({ length: 5 }, (_, bit) => (bits >> bit) & 1);
      for (let repeat = 0; repeat < 3; repeat += 1) rows.push({
        soldTime: Date.parse(period ? "2026-07-15" : "2026-09-01"),
        // Only blank base, Starforce and potential values changed over time.
        price: ((period ? 100 : 160) + sf * (period ? 50 : 90) + pot * (period ? 80 : 30) + flame * 20 + scroll * 15 + scissors * 8) * 1e8,
        features: { vector: { sf, pot, flame, scroll, scissors } }, weight: period ? 0.1 : 1, qualityWeight: 1,
      });
    }
  }
  return rows;
}
test("time correction changes market components without scaling old flame/scroll/scissors premiums", () => {
  const rows = data();
  const result = normalizeMarketPeriods(rows, definitions);
  assert.equal(result.diagnostics.applied, true);
  const historic = result.entries.slice(96);
  assert.ok(Math.abs(historic[0].price / 1e8 - 160) < 5);
  // Each stable premium stays exactly additive even when base price rose 60%.
  for (const [bits, premium] of [[4, 20], [8, 15], [16, 8]]) {
    assert.ok(Math.abs((historic[bits * 3].price - historic[0].price) / 1e8 - premium) < 1e-8);
    assert.equal(historic[bits * 3].weight, 0.1, "recency affects market calibration confidence, not the stable meso premium");
  }
  assert.ok(Math.abs((historic[3].price - historic[0].price) / 1e8 - 90) < 5);
  assert.ok(Math.abs((historic[6].price - historic[0].price) / 1e8 - 30) < 5);
  assert.equal(rows[96].price, 100e8, "never mutate original trade history");
});
test("one period and too few historical observations do not invent a market trend", () => {
  const rows = data().slice(0, 100);
  const result = normalizeMarketPeriods(rows, definitions);
  assert.equal(result.diagnostics.applied, false);
  assert.equal(result.entries, rows);
});
