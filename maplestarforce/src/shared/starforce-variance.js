import { binomial, hashSeed, negativeBinomialFailures, seededRandom } from "./starforce-random.js";

export const VARIANCE_SAMPLE_COUNTS = [30_000, 100_000];
const VERSION = "starforce-variance-v2";

export function varianceRequestKey({ plans, multiplier = 1 }, sampleCount) {
  return JSON.stringify([VERSION, sampleCount, multiplier, plans.map((plan) => [
    plan.itemLevel, plan.startStar, plan.targetStar, plan.replacementPrice,
    plan.event, plan.mvp, plan.pc, plan.quantity ?? 1,
    [...(plan.strategyStages ?? []), ...plan.stages].map((stage) => [
      stage.star, stage.cost, stage.success, stage.destroy, stage.policy, stage.expectedCost, stage.expectedItems,
    ]),
  ])]);
}

// Recovery replays only LOWER stars. Starting at the highest star, draw the
// failures before all required successes, then the destructions among those
// failures. Each destruction adds required successes to the lower recovery
// path. This is the same process as the chronological sampler, without a turn
// limit or a normal approximation, even for very high targets.
export function compileStarforceDistribution(plan) {
  const { startStar, targetStar, replacementPrice } = plan;
  if (!Number.isInteger(startStar) || !Number.isInteger(targetStar) ||
      startStar < 0 || targetStar > 30 || startStar >= targetStar ||
      !Number.isFinite(replacementPrice) || replacementPrice < 0) throw new RangeError("편차 계산 조건이 올바르지 않습니다.");
  const stages = new Map([...(plan.strategyStages ?? []), ...plan.stages].map((stage) => [stage.star, stage]));
  const compiled = [];
  const means = new Float64Array(31), variances = new Float64Array(31);
  const boomMeans = new Float64Array(31), spareMeans = new Float64Array(31);
  for (let star = Math.min(12, startStar); star < targetStar; star++) {
    const stage = stages.get(star);
    if (!stage || !(stage.success > 0 && stage.success <= 1) ||
        !(stage.destroy >= 0 && stage.success + stage.destroy <= 1 + 1e-12) ||
        !Number.isFinite(stage.cost) || stage.cost < 0) throw new RangeError("강화·복구 전략을 확인할 수 없습니다.");
    let recoveryStar = star, recoveryCost = 0, recoveryItems = 0;
    if (stage.destroy > 0) {
      if (stage.policy === "12성 복구") {
        recoveryStar = 12;
        recoveryCost = replacementPrice;
        recoveryItems = 1;
      } else if (stage.policy === "확정 복구" || stage.policy === "22성 확정 복구") {
        recoveryStar = stage.policy === "22성 확정 복구" ? 22 : star;
        const expectedRecovery = (stage.expectedCost * stage.success - stage.cost) / stage.destroy;
        recoveryCost = Math.max(0, expectedRecovery - (means[star] - means[recoveryStar]));
        // expectedItems already distinguishes NPC single-spare restoration.
        // Remove the lower replay path, whose destructions are sampled separately.
        recoveryItems = Math.round(stage.expectedItems * stage.success / stage.destroy
          - (spareMeans[star] - spareMeans[recoveryStar]));
      } else throw new RangeError("지원하지 않는 복구 전략입니다.");
    }
    if (recoveryStar > star || recoveryStar < 0 || !Number.isFinite(recoveryCost) || !Number.isSafeInteger(recoveryItems) || recoveryItems < 0) throw new RangeError("복구 비용을 확인할 수 없습니다.");
    const r = recoveryCost + means[star] - means[recoveryStar];
    const rv = variances[star] - variances[recoveryStar];
    const { success: p, destroy: d, cost: c } = stage;
    const mean = (c + d * r) / p;
    const variance = (c * c * (1 - p) + 2 * c * d * r + d * (p + d) * r * r) / (p * p) + d * rv / p;
    means[star + 1] = means[star] + mean;
    variances[star + 1] = variances[star] + variance;
    boomMeans[star + 1] = boomMeans[star] + d / p * (1 + boomMeans[star] - boomMeans[recoveryStar]);
    spareMeans[star + 1] = spareMeans[star] + d / p * (recoveryItems + spareMeans[star] - spareMeans[recoveryStar]);
    compiled.push({ star, p, d, c, recoveryStar, recoveryCost, recoveryItems });
  }
  return {
    mean: means[targetStar] - means[startStar],
    variance: Math.max(0, variances[targetStar] - variances[startStar]),
    expectedBooms: boomMeans[targetStar] - boomMeans[startStar],
    expectedSpares: spareMeans[targetStar] - spareMeans[startStar],
    sample(random, quantity = 1, outcome = null) {
      const needed = new Float64Array(30);
      for (let star = startStar; star < targetStar; star++) needed[star] = quantity;
      let cost = 0, destroyed = 0, spares = 0;
      for (let index = compiled.length - 1; index >= 0; index--) {
        const { star, p, d, c, recoveryStar, recoveryCost, recoveryItems } = compiled[index];
        const successes = needed[star];
        if (!successes) continue;
        if (!Number.isSafeInteger(successes)) throw new RangeError("강화 횟수가 정밀하게 계산할 수 있는 범위를 초과했습니다.");
        const failures = negativeBinomialFailures(successes, p, random);
        const booms = d > 0 ? binomial(failures, Math.min(1, d / (1 - p)), random) : 0;
        if (!Number.isSafeInteger(failures + successes)) throw new RangeError("강화 횟수가 정밀하게 계산할 수 있는 범위를 초과했습니다.");
        cost += (successes + failures) * c + booms * recoveryCost;
        destroyed += booms;
        spares += booms * recoveryItems;
        for (let lower = recoveryStar; lower < star; lower++) needed[lower] += booms;
      }
      if (!Number.isFinite(cost)) throw new RangeError("편차 계산 범위를 초과했습니다.");
      if (outcome) { outcome.booms = destroyed; outcome.spares = spares; }
      return cost;
    },
  };
}

export function summarizeVariance(samples, exactMean, exactVariance, outcomes = {}) {
  if (!samples.length) throw new RangeError("계산된 표본이 없습니다.");
  const order = Uint32Array.from(samples, (_, index) => index).sort((a, b) => samples[a] - samples[b]);
  const sorted = Float64Array.from(order, (index) => samples[index]);
  const sortedBooms = Float64Array.from(order, (index) => outcomes.booms?.[index] ?? 0);
  const sortedSpares = Float64Array.from(order, (index) => outcomes.spares?.[index] ?? 0);
  let mean = 0, squares = 0;
  for (let i = 0; i < samples.length; i++) {
    const delta = samples[i] - mean;
    mean += delta / (i + 1);
    squares += delta * (samples[i] - mean);
  }
  const sampleMeanBooms = sortedBooms.reduce((sum, value) => sum + value, 0) / samples.length;
  const sampleMeanSpares = sortedSpares.reduce((sum, value) => sum + value, 0) / samples.length;
  return {
    sampleCount: sorted.length, mean: exactMean, standardDeviation: Math.sqrt(exactVariance),
    sampleMean: mean, sampleStandardDeviation: Math.sqrt(squares / samples.length),
    p10: varianceQuantile(sorted, 0.1), median: varianceQuantile(sorted, 0.5),
    p90: varianceQuantile(sorted, 0.9), p99: varianceQuantile(sorted, 0.99),
    meanBooms: outcomes.expectedBooms ?? sampleMeanBooms,
    meanSpares: outcomes.expectedSpares ?? sampleMeanSpares,
    sampleMeanBooms, sampleMeanSpares,
    sorted, sortedBooms, sortedSpares,
  };
}

export function varianceQuantile(sorted, fraction) {
  const position = Math.max(0, Math.min(1, fraction)) * (sorted.length - 1);
  const index = Math.floor(position), weight = position - index;
  return sorted[index] * (1 - weight) + sorted[Math.min(index + 1, sorted.length - 1)] * weight;
}

// Inverse of the interpolated curve, for monetary marker coordinates only.
// A budget probability remains an empirical CDF (varianceBudgetPosition).
export function varianceCostPosition(sorted, amount) {
  if (!sorted.length) return 0;
  if (sorted.length === 1 || sorted[0] === sorted.at(-1)) return 0.5;
  if (amount < sorted[0]) return 0;
  if (amount > sorted.at(-1)) return 1;
  const upper = lowerCostIndex(sorted, amount);
  if (sorted[upper] === amount) {
    const end = Math.round(varianceBudgetPosition(sorted, amount) * sorted.length);
    return (upper + end - 1) / 2 / (sorted.length - 1);
  }
  const lower = upper - 1;
  return (lower + (amount - sorted[lower]) / (sorted[upper] - sorted[lower])) / (sorted.length - 1);
}

export function variancePoint(result, fraction) {
  const rank = Math.max(0, Math.min(1, fraction));
  const cost = varianceQuantile(result.sorted, rank);
  if (result.sorted[0] === result.sorted.at(-1)) {
    return { cost, probability: 1, meanBooms: result.sampleMeanBooms, meanSpares: result.sampleMeanSpares };
  }
  // The displayed cost is the exact quantile used by the curve and summary.
  // Only outcome counts are smoothed, within +/-0.25 percentage points of the
  // selected rank. Expensive tails cannot widen this window into other ranks.
  const position = rank * (result.sampleCount - 1);
  const radius = Math.max(1, (result.sampleCount - 1) * 0.0025);
  const start = Math.max(0, Math.ceil(position - radius));
  const end = Math.min(result.sampleCount - 1, Math.floor(position + radius));
  let weight = 0, booms = 0, spares = 0;
  for (let i = start; i <= end;) {
    const groupStart = lowerCostIndex(result.sorted, result.sorted[i]);
    const groupEnd = Math.round(varianceBudgetPosition(result.sorted, result.sorted[i]) * result.sampleCount);
    let groupBooms = 0, groupSpares = 0, groupWeight = 0;
    // Equal-cost outcomes have no meaningful internal ordering. Average the
    // whole tie group so the result does not depend on the simulation's order.
    for (let j = groupStart; j < groupEnd; j++) {
      groupBooms += result.sortedBooms[j]; groupSpares += result.sortedSpares[j];
    }
    for (; i < groupEnd && i <= end; i++) groupWeight += Math.max(0, 1 - Math.abs(i - position) / radius);
    weight += groupWeight;
    booms += groupWeight * groupBooms / (groupEnd - groupStart);
    spares += groupWeight * groupSpares / (groupEnd - groupStart);
  }
  return { cost, probability: varianceBudgetPosition(result.sorted, cost), meanBooms: booms / weight, meanSpares: spares / weight };
}

function lowerCostIndex(sorted, amount) {
  let low = 0, high = sorted.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sorted[middle] < amount) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function varianceBudgetPosition(sorted, amount) {
  let low = 0, high = sorted.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sorted[middle] <= amount) low = middle + 1;
    else high = middle;
  }
  return sorted.length ? low / sorted.length : 0;
}

export function createVarianceSimulation(request, sampleCount = 30_000) {
  if (!Number.isInteger(sampleCount) || sampleCount < 100 || sampleCount > 100_000) throw new RangeError("시뮬레이션 횟수가 올바르지 않습니다.");
  const { plans, multiplier = 1 } = request;
  if (!Array.isArray(plans) || !plans.length || !Number.isFinite(multiplier) || multiplier <= 0) throw new RangeError("편차를 확인할 장비가 없습니다.");
  const compiled = plans.map((plan) => {
    const quantity = plan.quantity ?? 1;
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw new RangeError("장비 개수가 올바르지 않습니다.");
    return { ...compileStarforceDistribution(plan), quantity };
  });
  // Each line has its own independent stream, including identical equipment.
  const randoms = plans.map((plan, index) => seededRandom(hashSeed(varianceRequestKey({ plans: [plan] }, 0) + ":" + index)));
  const mean = compiled.reduce((sum, plan) => sum + plan.mean * plan.quantity, 0) * multiplier;
  const variance = compiled.reduce((sum, plan) => sum + plan.variance * plan.quantity, 0) * multiplier ** 2;
  const expectedBooms = compiled.reduce((sum, plan) => sum + plan.expectedBooms * plan.quantity, 0);
  const expectedSpares = compiled.reduce((sum, plan) => sum + plan.expectedSpares * plan.quantity, 0);
  if (!Number.isFinite(mean) || !Number.isFinite(variance)) throw new RangeError("편차 계산 범위를 초과했습니다.");
  const samples = new Float64Array(sampleCount);
  const booms = new Float64Array(sampleCount), spares = new Float64Array(sampleCount), outcome = {};
  let completed = 0;
  return {
    step(batchSize = 100) {
      const until = Math.min(sampleCount, completed + batchSize);
      while (completed < until) {
        let cost = 0, destroyed = 0, used = 0;
        for (let index = 0; index < compiled.length; index++) {
          cost += compiled[index].sample(randoms[index], compiled[index].quantity, outcome);
          destroyed += outcome.booms; used += outcome.spares;
        }
        booms[completed] = destroyed; spares[completed] = used;
        samples[completed++] = cost * multiplier;
      }
      return { completed, sampleCount };
    },
    finish() {
      if (completed !== sampleCount) throw new Error("시뮬레이션이 아직 완료되지 않았습니다.");
      return summarizeVariance(samples, mean, variance, { booms, spares, expectedBooms, expectedSpares });
    },
  };
}
