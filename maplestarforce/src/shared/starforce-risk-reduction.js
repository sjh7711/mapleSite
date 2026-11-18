import { calculateStarforceExpected, RESTORE_STARS, SAFEGUARD_STARS } from "maple-core/starforce";
import { compileStarforceDistribution } from "./starforce-variance.js";

export const RISK_COST_ALLOWANCE = 0.005;

function strategy(plan) {
  const stages = plan.strategyStages ?? plan.stages;
  return {
    destroyPrevention: stages.filter((stage) => stage.safeguarded).map((stage) => stage.star),
    restore: [...new Set(stages.filter((stage) => stage.policy.includes("확정 복구"))
      .map((stage) => Math.min(22, stage.star)))],
  };
}

function candidate(source, policy) {
  const calculated = calculateStarforceExpected({ ...source, ...policy });
  const plan = { ...source, ...calculated, ...strategy(calculated) };
  const distribution = compileStarforceDistribution(plan);
  const quantity = source.quantity ?? 1;
  return { mean: distribution.mean * quantity, variance: distribution.variance * quantity, plan };
}

function frontier(candidates) {
  candidates.sort((a, b) => a.mean - b.mean || a.variance - b.variance);
  let variance = Infinity;
  return candidates.filter((entry) => {
    if (entry.variance >= variance) return false;
    variance = entry.variance;
    return true;
  });
}

// Enumerate JOINT policies, including the lower stars replayed after a boom.
// Safeguard overrides restoration at the same star, so omit those duplicates.
function policies(source, minimum, availableCost) {
  const choices = RESTORE_STARS.filter((star) => star < source.targetStar);
  const found = [minimum];
  const visit = (index, destroyPrevention, restore) => {
    if (index === choices.length) {
      const entry = candidate(source, { optimize: false, destroyPrevention, restore });
      if (entry.mean <= minimum.mean + availableCost) found.push(entry);
      return;
    }
    const star = choices[index];
    visit(index + 1, destroyPrevention, restore);
    visit(index + 1, destroyPrevention, [...restore, star]);
    if (SAFEGUARD_STARS.includes(star)) visit(index + 1, [...destroyPrevention, star], restore);
  };
  visit(0, [], []);
  return frontier(found);
}

export function starforcePlanMoments(plans) {
  let mean = 0, variance = 0;
  for (const plan of plans) {
    const distribution = compileStarforceDistribution(plan), quantity = plan.quantity ?? 1;
    mean += distribution.mean * quantity;
    variance += distribution.variance * quantity;
  }
  return { mean, standardDeviation: Math.sqrt(variance) };
}

/** Keep the entire selected scope within 0.5% of its minimum expected cost.
 * Independent equipment variances add; standard deviations do not.
 * This is an analytical search. No simulation estimates enter the decision.
 */
export function reduceStarforceRisk(plans) {
  if (!plans.length) throw new RangeError("편차를 줄일 장비가 없습니다.");
  const minima = plans.map((plan) => candidate(plan, { optimize: true }));
  const minimumMean = minima.reduce((sum, entry) => sum + entry.mean, 0);
  const allowance = minimumMean * RISK_COST_ALLOWANCE;
  let combinations = [{ mean: 0, variance: 0, previous: null, choice: null }];
  let boundedSearch = false;
  // Cache identical equipment policies, but retain each item's source identity.
  const policyCache = new Map();
  for (let index = 0; index < plans.length; index++) {
    const plan = plans[index], minimum = minima[index];
    const key = JSON.stringify([plan.itemLevel, plan.startStar, plan.targetStar, plan.replacementPrice,
      plan.event, plan.mvp, plan.pc, plan.singleSpare, plan.quantity ?? 1]);
    let options = policyCache.get(key);
    if (!options) { options = policies(plan, minimum, allowance); policyCache.set(key, options); }
    const next = [];
    for (const combination of combinations) {
      for (const option of options) {
        const mean = combination.mean + Math.max(0, option.mean - minimum.mean);
        if (mean > allowance) continue;
        next.push({ mean, variance: combination.variance + option.variance,
          previous: combination, choice: { ...option.plan, sourceIndex: plan.sourceIndex, name: plan.name } });
      }
    }
    combinations = frontier(next);
    // Bound memory for unusually large portfolios. Keep the lowest-variance
    // state in each cost bucket, checking ACTUAL cost at every later merge.
    // The minimum-cost state is always retained; rounding cannot exceed the cap.
    if (combinations.length > 4096) {
      boundedSearch = true;
      const buckets = new Map();
      for (const entry of combinations) {
        const bucket = allowance > 0 ? Math.ceil(entry.mean / allowance * 4095) : 0;
        const previous = buckets.get(bucket);
        if (!previous || entry.variance < previous.variance) buckets.set(bucket, entry);
      }
      combinations = frontier([...buckets.values()]);
    }
  }
  const best = combinations.reduce((a, b) => b.variance < a.variance ? b : a);
  const recommendedPlans = [];
  for (let cursor = best; cursor.choice; cursor = cursor.previous) recommendedPlans.push(cursor.choice);
  recommendedPlans.reverse();
  const minimum = starforcePlanMoments(minima.map((entry) => entry.plan));
  const current = starforcePlanMoments(plans);
  const recommended = starforcePlanMoments(recommendedPlans);
  // Availability is measured against the minimum-cost strategy. The user's
  // current policy only supplies comparison metrics, never the search baseline.
  const improves = recommended.standardDeviation < minimum.standardDeviation * (1 - 1e-10);
  return { minimum, current, recommended, plans: recommendedPlans, improves, boundedSearch };
}
