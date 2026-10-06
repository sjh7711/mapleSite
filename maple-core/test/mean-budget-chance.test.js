import assert from "node:assert/strict";
import test from "node:test";
import { calculatePotentialRankUpExpected, calculatePotentialRankUpChanceWithinBudget,
  calculateGeometricMeanChance } from "../src/potential.js";
import { calculatePetExpectation, calculatePetMeanCostChance } from "../src/pet.js";

test("160 additional rare-to-legendary mean budget uses grade costs and pity, not 63.21%", () => {
  const plan = calculatePotentialRankUpExpected({ system: "additional", method: "meso", itemLevel: 160,
    fromGrade: "rare", toGrade: "legendary" });
  assert.ok(Math.abs(plan.expectedCost - 10475321433.342987) < .01);
  assert.ok(Math.abs(calculatePotentialRankUpChanceWithinBudget(plan, plan.expectedCost) - .5343971030082674) < 1e-10);
  assert.notEqual(calculatePotentialRankUpChanceWithinBudget(plan, plan.expectedCost),
    calculatePotentialRankUpChanceWithinBudget(plan, plan.expectedAttempts, { attempts: true }));
});

test("rank-up budget CDF matches exhaustive outcomes, including free stages and guarantees", () => {
  const stages = [{ probability: .3, remaining: 3, resetCost: 2 },
    { probability: .5, remaining: 2, resetCost: 7 }, { probability: .1, remaining: 4, resetCost: 0 }];
  let outcomes = [{ cost: 0, p: 1 }];
  for (const stage of stages) outcomes = outcomes.flatMap((previous) =>
    Array.from({ length: stage.remaining }, (_, i) => ({ cost: previous.cost + (i + 1) * stage.resetCost,
      p: previous.p * (1 - stage.probability) ** i * (i + 1 === stage.remaining ? 1 : stage.probability) })));
  for (let budget = 0; budget < 22; budget += .5) {
    const expected = outcomes.reduce((sum, row) => sum + (row.cost <= budget ? row.p : 0), 0);
    assert.ok(Math.abs(calculatePotentialRankUpChanceWithinBudget({ stages }, budget) - expected) < 1e-12);
  }
  assert.equal(calculatePotentialRankUpChanceWithinBudget({ stages: [stages[2]] }, 0), 1);
});

test("geometric mean CDF counts whole attempts and permits guaranteed 100%", () => {
  assert.equal(calculateGeometricMeanChance(1), 1);
  assert.ok(Math.abs(calculateGeometricMeanChance(.3) - (1 - .7 ** 3)) < 1e-12);
  assert.equal(calculateGeometricMeanChance(0), null);
});

test("pet default mean net-cost CDF changes with 1/2/3 targets, including paybacks", () => {
  for (const [targetCount, expected] of [[1, .6363084157526252], [2, .5970129176803542], [3, .5785476548405305]]) {
    const actual = calculatePetMeanCostChance({ targetCount });
    assert.equal(actual.method, "exact");
    assert.ok(Math.abs(actual.chance - expected) < 1e-10);
    const simulation = calculatePetMeanCostChance({ targetCount }, { exact: false, trials: 50000 });
    assert.ok(Math.abs(simulation.chance - actual.chance) < .013);
    assert.ok(Math.abs(simulation.sampledMean - actual.meanCost) < 6 * simulation.meanStandardError);
  }
});

test("pet cost simulation follows auction, hybrid, event and mixed procurement ledgers", () => {
  const cases = [
    { targetCount: 2, wonderBlackMesoPrice: 1e8 },
    { wonderBerryAuctionBundleMesoPrice: 20e8, wonderBlackMesoPrice: 10e8, lunaDreamAuctionMesoPrice: 30e8 },
    { targetCount: 3, wonderBlackEvent: true, wonderBlackEventIncreasePercent: 40 },
    { tradeableOutputRequired: true, wonderBerryAuctionBundleMesoPrice: 29e8 },
    { tradeableOutputRequired: true, wonderBerryAuctionBundleMesoPrice: 80e8,
      lunaDreamAuctionMesoPrice: 2e8, lunaKeyAuctionMesoPrice: 19e8, wonderBlackMesoPrice: 20e8 },
    { targetCount: 2, wonderBerryBundleMaplePoints: 6000, lunaCrystalMaplePoints: 400,
      wonderBerryAuctionBundleMesoPrice: 8e8, wonderBlackMesoPrice: 3e8, auctionFeeRate: .03 },
  ];
  const seen = new Set();
  for (const options of cases) {
    const plan = calculatePetExpectation(options);
    seen.add(plan.selectedSource === "wonderberry" ? plan.bundlePurchase.selectedProcurement : plan.selectedSource);
    const actual = calculatePetMeanCostChance(options, { exact: false, trials: 50000 });
    assert.ok(actual.chance >= 0 && actual.chance <= 1);
    assert.ok(Math.abs(actual.sampledMean - actual.meanCost) < 6 * actual.meanStandardError,
      JSON.stringify({ options, actual }));
  }
  assert.ok(seen.has("auction"));
  assert.ok(seen.has("mixed"));
  assert.ok(seen.has("hybrid-bundle"));
});
