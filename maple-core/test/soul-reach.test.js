import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateSoulAmplificationPath, calculateSoulAmplificationReachForChance,
  calculateSoulPotentialRankUpExpected, calculateSoulPotentialRankUpReachForChance,
} from "../src/soul.js";

const chances = [0.0001, 0.05, 0.5, 0.8, 0.95, 0.99, 0.9999];
const amplify = (options = {}) => calculateSoulAmplificationPath({ forProduction: false, ...options });
const rankUp = (options = {}) => calculateSoulPotentialRankUpExpected({
  fromGrade: "rare", toGrade: "legendary", forProduction: false, ...options,
});

// Independent exhaustive convolution oracle, without pair-sum searching or
// the optimized geometric recurrence used by the production rank-up engine.
function distribution(stages, value) {
  let probabilities = new Map([[0, 1]]);
  for (const stage of stages) {
    const next = new Map();
    for (const [previous, probability] of probabilities) {
      for (const outcome of stage.attempts) {
        const total = previous + value(stage, outcome);
        next.set(total, (next.get(total) ?? 0) + probability * outcome.successProbability);
      }
    }
    probabilities = next;
  }
  return [...probabilities].sort((a, b) => a[0] - b[0]);
}
function quantile(outcomes, chance) {
  let cumulative = 0;
  for (const [value, probability] of outcomes) {
    cumulative += probability;
    if (cumulative + 1e-12 >= chance) return value;
  }
  return outcomes.at(-1)[0];
}
function checkAgainstOracle(plan, calculate, cost) {
  const attempts = distribution(plan.stages, (_, outcome) => outcome.attempt);
  const costs = distribution(plan.stages, cost);
  for (const chance of chances) {
    const actual = calculate(plan, chance);
    assert.equal(actual.attempts, quantile(attempts, chance), `attempts at ${chance}`);
    assert.equal(actual.cost, quantile(costs, chance), `cost at ${chance}`);
  }
  const mean = attempts.reduce((sum, [value, p]) => sum + value * p, 0);
  const meanCdf = attempts.reduce((sum, [value, p]) => sum + (value <= mean + 1e-12 ? p : 0), 0);
  assert.ok(Math.abs(calculate(plan, 0.8).averageAttemptChance - meanCdf) < 1e-12);
}

test("four-stage amplification quantiles include rising chances and all guarantees", () => {
  const plan = amplify({ etherPriceMesoByStage: { 1: 100e6, 2: 250e6, 3: 500e6, 4: 750e6 } });
  checkAgainstOracle(plan, calculateSoulAmplificationReachForChance, (_, outcome) => outcome.costMeso);
  assert.equal(calculateSoulAmplificationReachForChance(plan, 0.8).attempts, 72);
});

test("amplification handles remaining failures, decimal ether prices, and price changes", () => {
  const options = { currentStage: 2, targetStage: 4, currentFailures: 42 };
  const free = amplify(options);
  const priced = amplify({ ...options, etherPriceMesoByStage: { 3: 123456789.125, 4: 987654321.25 } });
  checkAgainstOracle(priced, calculateSoulAmplificationReachForChance, (_, outcome) => outcome.costMeso);
  for (const chance of chances) {
    const a = calculateSoulAmplificationReachForChance(free, chance);
    const b = calculateSoulAmplificationReachForChance(priced, chance);
    assert.equal(a.attempts, b.attempts);
    assert.ok(b.cost > a.cost);
  }
});

test("amplification at the guarantee always needs exactly one attempt and one ether", () => {
  const plan = amplify({ currentStage: 3, targetStage: 4, currentFailures: 50, etherPriceMesoByStage: { 4: 1e9 } });
  for (const chance of chances) {
    const result = calculateSoulAmplificationReachForChance(plan, chance);
    assert.equal(result.attempts, 1);
    assert.equal(result.cost, 3.75e9);
    assert.equal(result.averageAttemptChance, 1);
  }
});

test("core callers retaining ether stock get the correct nonlinear cost quantile", () => {
  const plan = amplify({ targetStage: 2, ownedEtherByStage: { 1: 10, 2: 20 }, etherPriceMesoByStage: { 1: 5e9, 2: 3e9 } });
  checkAgainstOracle(plan, calculateSoulAmplificationReachForChance, (_, outcome) => outcome.costMeso);
});

test("normal and miracle rank-up quantiles account for grade-specific costs and guarantees", () => {
  for (const miracle of [false, true]) {
    const plan = rankUp({ miracle, currentResetCount: 99 });
    checkAgainstOracle(plan, calculateSoulPotentialRankUpReachForChance, (stage, outcome) => stage.resetCostMeso * outcome.attempt);
  }
  const normal = calculateSoulPotentialRankUpReachForChance(rankUp(), 0.8);
  const miracle = calculateSoulPotentialRankUpReachForChance(rankUp({ miracle: true }), 0.8);
  assert.ok(miracle.attempts < normal.attempts);
  assert.ok(miracle.cost < normal.cost);
});

test("a single rank-up stage matches the closed-form capped geometric quantile", () => {
  for (const currentResetCount of [0, 250, 450]) {
    const plan = rankUp({ fromGrade: "unique", currentResetCount });
    for (const chance of chances) {
      const result = calculateSoulPotentialRankUpReachForChance(plan, chance);
      const attempts = Math.min(451 - currentResetCount, Math.ceil(Math.log1p(-chance) / Math.log1p(-0.003322)));
      assert.equal(result.attempts, attempts);
      assert.equal(result.cost, attempts * 65e6);
    }
  }
});

test("reach functions reject invalid probabilities", () => {
  for (const [plan, calculate] of [[amplify(), calculateSoulAmplificationReachForChance], [rankUp(), calculateSoulPotentialRankUpReachForChance]]) {
    for (const chance of [0, 1, -1, NaN, Infinity]) assert.throws(() => calculate(plan, chance), RangeError);
  }
});
