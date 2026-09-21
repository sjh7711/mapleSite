import { calculatePotentialRankUpReachForChance } from "./potential.js";

const planCache = new WeakMap();

function validateChance(chance) {
  const value = Number(chance);
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new RangeError("목표 누적 확률은 0보다 크고 1보다 작아야 합니다.");
  }
  return value;
}

// A plan is an immutable calculation result. Reuse its distributions as the
// slider moves; the page creates a new plan whenever any setting changes.
function distributionsFor(plan) {
  if (planCache.has(plan)) return planCache.get(plan);
  if (!plan?.stages?.length) throw new RangeError("소울 강화 단계가 필요합니다.");
  let attempts = [1];
  for (const stage of plan.stages) {
    const next = new Float64Array(attempts.length + stage.maximumAttempts);
    for (let previous = 0; previous < attempts.length; previous += 1) {
      for (const outcome of stage.attempts) {
        next[previous + outcome.attempt] += attempts[previous] * outcome.successProbability;
      }
    }
    attempts = next;
  }
  let expectedAttempts = 0;
  for (let index = 0; index < attempts.length; index += 1) {
    expectedAttempts += index * attempts[index];
  }
  const averageAttemptChance = attempts.reduce(
    (sum, probability, index) => sum + (index <= expectedAttempts + 1e-12 ? probability : 0), 0,
  );
  const result = { attempts, averageAttemptChance };
  planCache.set(plan, result);
  return result;
}

function attemptQuantile(distribution, chance) {
  let cumulative = 0;
  for (let index = 0; index < distribution.length; index += 1) {
    cumulative += distribution[index];
    if (cumulative + 1e-12 >= chance) return index;
  }
  return distribution.length - 1;
}

function costOutcomes(stages) {
  let outcomes = [{ cost: 0, probability: 1 }];
  for (const stage of stages) {
    const next = [];
    for (const previous of outcomes) {
      for (const outcome of stage.attempts) {
        if (!Number.isFinite(outcome.costMeso) || outcome.costMeso < 0) {
          throw new RangeError("소울 증폭 비용은 유한한 0 이상의 값이어야 합니다.");
        }
        next.push({
          cost: previous.cost + outcome.costMeso,
          probability: previous.probability * outcome.successProbability,
        });
      }
    }
    outcomes = next;
  }
  return outcomes.sort((a, b) => a.cost - b.cost);
}

// Four stages have up to two million cost combinations. Splitting into two
// pairs keeps only 884 + 2244 outcomes, even for arbitrary ether prices.
// For a budget, scan the sorted pairs to get its CDF and adjacent actual costs.
// Quantile search snaps both bounds to those actual outcomes, without rounding
// prices to a grid or substituting an average price per attempt.
function costQuantile(left, right, chance) {
  const rightCdf = [];
  let cumulative = 0;
  for (const outcome of right) rightCdf.push(cumulative += outcome.probability);
  let low = left[0].cost + right[0].cost;
  let high = left.at(-1).cost + right.at(-1).cost;
  while (low < high) {
    const budget = low + (high - low) / 2;
    if (budget === high) return high; // Adjacent floating point values.
    let probability = 0;
    let included = -Infinity;
    let excluded = Infinity;
    let index = right.length - 1;
    for (const outcome of left) {
      while (index >= 0 && outcome.cost + right[index].cost > budget) index -= 1;
      if (index >= 0) {
        probability += outcome.probability * rightCdf[index];
        included = Math.max(included, outcome.cost + right[index].cost);
      }
      if (index + 1 < right.length) {
        excluded = Math.min(excluded, outcome.cost + right[index + 1].cost);
      }
    }
    if (probability + 1e-12 >= chance) high = included;
    else low = excluded;
  }
  return low;
}

/** Minimum total attempts and budget, each independently meeting the chance. */
export function calculateSoulAmplificationReachForChance(plan, chance) {
  const targetChance = validateChance(chance);
  const distribution = distributionsFor(plan);
  if (!distribution.costPairs) {
    const split = Math.ceil(plan.stages.length / 2);
    distribution.costPairs = [
      costOutcomes(plan.stages.slice(0, split)),
      costOutcomes(plan.stages.slice(split)),
    ];
  }
  return {
    chance: targetChance,
    attempts: attemptQuantile(distribution.attempts, targetChance),
    cost: costQuantile(...distribution.costPairs, targetChance),
    averageAttemptChance: distribution.averageAttemptChance,
  };
}

export function calculateSoulPotentialRankUpReachForChance(plan, chance) {
  const targetChance = validateChance(chance);
  const result = calculatePotentialRankUpReachForChance({
    stages: plan.stages.map((stage) => ({ ...stage, resetCost: stage.resetCostMeso })),
  }, targetChance);
  return { ...result, averageAttemptChance: distributionsFor(plan).averageAttemptChance };
}
