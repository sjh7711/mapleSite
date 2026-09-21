import { createAbilityRouteSimulationApi } from './ability.js';
import { lowerRolls, expand } from './ability-economy.js';
import { abilityResultApplies } from './ability-result-preference.js';

const bits = (m) => [0, 1, 2].filter((i) => m & (1 << i));
function randomGenerator(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function sampler(entries) {
  const mass = entries.reduce((s, [, p]) => s + p, 0);
  if (!(mass > 0)) throw new Error('경로의 전이 확률을 계산할 수 없습니다.');
  let sum = 0;
  const cdf = entries.map(([value, p]) => ({ value, upper: (sum += p / mass) }));
  cdf.at(-1).upper = 1;
  return (random) => {
    const u = random(); let lo = 0, hi = cdf.length - 1;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (u < cdf[mid].upper) hi = mid; else lo = mid + 1; }
    return cdf[lo].value;
  };
}
function geometric(p, random) {
  if (!(p > 0 && p <= 1 + 1e-9)) throw new Error('경로의 진행 확률이 유효하지 않습니다.');
  return p >= 1 ? 1 : Math.floor(Math.log1p(-random()) / Math.log1p(-p)) + 1;
}
function correctedChance(events, accepted, method) {
  const p = accepted.reduce((s, e) => s + e.probability, 0);
  const collision = events.reduce((s, e) => s + e.collision, 0) - accepted.reduce((s, e) => s + e.collision, 0);
  const factor = method === 'advanced' && p < 1 - 1e-12 ? 1 - Math.max(0, collision) / (1 - p) : 1;
  return p / factor;
}
function compile(guide, api) {
  const targets = guide.targets;
  function acquisition(locked, decisions) {
    const events = lowerRolls(targets, locked, api).flatMap((e) => expand(e, locked, targets, api));
    const accepted = [];
    for (const e of events) {
      const d = decisions.find((d) => d.found === e.mask && Object.entries(d.values).every(([k, v]) => e.values[k] === v));
      if (d && d.keep !== locked) accepted.push({ ...e, keep: d.keep, first: sampler(Object.entries(e.first)) });
    }
    return { probability: correctedChance(events, accepted, api.method),
      draw: sampler(accepted.map((e) => [e, e.probability])), locks: bits(locked).length };
  }
  function model(m) {
    const ranks = m.policyBands[0]?.ranks;
    const improvements = m.states.map((s, i) => {
      if (!ranks) return null;
      const better = m.states.map((n, j) => [j, abilityResultApplies(m, i, j) ? n.probability : 0]).filter(([, p]) => p > 0);
      const mass = better.reduce((s, [, p]) => s + p, 0);
      return mass ? { probability: mass / (api.method === 'advanced' ? 1 - s.probability : 1), draw: sampler(better) } : null;
    });
    return { ...m, improvements, draw: sampler(m.states.map((s, i) => [i, s.probability])),
      indices: new Map(m.states.map((s, i) => [s.values.join('/'), i])) };
  }
  return {
    start: acquisition(0, guide.start.decisions),
    one: new Map(guide.one.map((s) => [`${s.targetIndex}/${s.value}`, acquisition(s.mask, s.decisions)])),
    pairs: new Map(guide.pairs.map((pair) => {
      const plan = api.plan(pair.targets);
      const terminal = Array.from({ length: 8 }, (_, mask) => {
        if (mask === 7) return null;
        const { distribution, collisions } = api.transitions(pair.targets, mask);
        const events = [...distribution].map((probability, found) => ({ probability, collision: collisions[found],
          keep: plan.decisionsByMask[mask].get(found) ?? mask }));
        const accepted = events.filter((e) => e.keep !== mask && e.probability > 0);
        return { probability: correctedChance(events, accepted, api.method),
          draw: sampler(accepted.map((e) => [e.keep, e.probability])), locks: bits(mask).length };
      });
      return [pair.pairMask, { ...pair, terminal, full: model(pair.full),
        models: new Map(Object.entries(pair.models).map(([k, m]) => [k, model(m)])),
        entries: new Map(pair.firstOptions.map((e) => [e.type, { ...e, draw: sampler(e.values) }])) }];
    })),
  };
}

/**
 * Cost and circulator-use CDFs for a fixed practical or stationary economic policy. Honor waits
 * are sampled as integers using the expectation model's collision correction.
 * Rejected circulator results are grouped into geometric waiting times: this
 * preserves the full distribution, including unlimited tails, for fixed ranks.
 * No average-cost exponential approximation or independent line maxima.
 */
export function calculateAbilityRouteReach(result, settings = {}, { trials = 100000, seed = 0x20260920 } = {}) {
  const guide = result.steps?.find((step) => step.economicGuide)?.economicGuide;
  if (!guide || (!guide.practical && !guide.unlimited)) return null;
  if (!Number.isInteger(trials) || trials < 100) throw new Error('시뮬레이션 횟수가 유효하지 않습니다.');
  const api = createAbilityRouteSimulationApi(guide.method, settings), policy = compile(guide, api);
  const random = randomGenerator(seed), costs = new Float64Array(trials);
  const useCounts = new Float64Array(trials);
  const honorCosts = new Float64Array(trials), resetCosts = new Float64Array(trials);
  const finishCosts = new Float64Array(trials);
  const honorPrice = settings.honorPricePer5000 / 5000;
  const itemPrice = guide.itemMethod === 'abyss' ? settings.abyssPrice ?? 0 : 0;
  let totalHonor = 0, totalResetMeso = 0, totalUses = 0, total = 0, totalSquared = 0;
  let totalBlackUses = 0, totalChaosUses = 0, maxBlackUses = 0, maxChaosUses = 0;
  let exhaustedCount = 0, postCapCost = 0, phaseSuccessCount = 0, maxUses = 0, overInventory = 0;
  const inventory = guide.mixed ? guide.blackCount + guide.chaosCount : result.inventory?.[guide.itemMethod] ?? 0;
  for (let trial = 0; trial < trials; trial++) {
    let honor = 0, resetMeso = 0, uses = 0, blackUses = 0, chaosUses = 0, chaosPhase = Boolean(guide.mixed);
    const charge = (stage) => {
      const n = geometric(stage.probability, random), cost = api.resetCost(stage.locks);
      honor += n * cost[0]; resetMeso += n * cost[1];
    };
    charge(policy.start);
    let event = policy.start.draw(random), values = { ...event.values }, mask = event.keep;
    if (bits(mask).length === 1) {
      const i = bits(mask)[0], stage = policy.one.get(`${i}/${values[i]}`);
      charge(stage); event = stage.draw(random); values = { ...values, ...event.values }; mask = event.keep;
    }
    const pair = policy.pairs.get(mask);
    let entry = pair.entries.get(event.first(random));
    let tuple = [entry.draw(random), ...bits(mask).map((i) => values[i])];
    let same = entry.type === pair.targets[0].type;
    let m = same ? pair.full : pair.models.get(entry.profile);
    const indexOf = () => m?.indices.get((same ? tuple : [entry.values.findIndex(([v]) => v === tuple[0]), ...tuple.slice(1)]).join('/'));
    let index = indexOf();
    while (true) {
      const remaining = guide.unlimited ? Infinity : Math.max(0, guide.mixed ? guide.blackCount - blackUses : guide.count - uses);
      const state = m?.states[index] ?? { values: tuple,
        mask: (tuple[1] >= pair.targets[1].minimum ? 2 : 0) | (tuple[2] >= pair.targets[2].minimum ? 4 : 0) };
      let action = m?.actionBands.findLast((b) => b.remaining <= remaining)?.actions[index] ?? 'direct';
      if (chaosPhase) {
        if (!same && pair.practical.mode === 'all') action = 'acquire';
        else {
          const chaosAction = m.chaos.actionBands.findLast((b) => b.remaining <= guide.chaosCount - chaosUses).actions[index];
          if (chaosAction === 'chaos') {
            // Forced replacement: even a worse tuple becomes the current state.
            chaosUses++; uses++; index = m.draw(random); continue;
          }
          chaosPhase = false;
        }
      }
      if (action === 'direct') {
        const focus = pair.practical?.focusMask ?? 7;
        const success = (state.mask & focus) === focus;
        if (success) phaseSuccessCount++;
        const exhausted = !guide.unlimited && guide.count > 0 && remaining === 0 && !success
          && (!guide.mixed || chaosUses === guide.chaosCount);
        const before = honor * honorPrice + resetMeso;
        let kept = pair.keepMasks[state.mask];
        while (kept !== 7) { const stage = pair.terminal[kept]; charge(stage); kept = stage.draw(random); }
        if (exhausted) {
          const finishCost = honor * honorPrice + resetMeso - before;
          finishCosts[exhaustedCount++] = finishCost;
          postCapCost += finishCost;
        }
        break;
      }
      if (action === 'acquire') {
        const old = entry.values[state.values[0]], goal = pair.entries.get(pair.targets[0].type);
        charge({ probability: goal.weight / (api.method === 'advanced' ? 1 - entry.weight * old[1] : 1), locks: 2 });
        tuple = [goal.draw(random), ...state.values.slice(1)]; entry = goal; same = true; m = pair.full; index = indexOf();
        continue;
      }
      const progress = m.improvements[index];
      if (!progress && guide.unlimited) throw new Error('무제한 경로에서 진행 가능한 결과가 없습니다.');
      const wait = progress ? geometric(progress.probability, random) : Infinity;
      const consumed = Math.min(wait, remaining);
      uses += consumed;
      if (guide.mixed) blackUses += consumed;
      if (wait <= remaining) index = progress.draw(random);
    }
    const cost = honor * honorPrice + resetMeso + uses * itemPrice;
    if (!Number.isFinite(cost)) throw new Error('경로 비용을 계산할 수 없습니다.');
    costs[trial] = cost; useCounts[trial] = uses; total += cost; totalSquared += cost ** 2;
    honorCosts[trial] = honor * honorPrice; resetCosts[trial] = resetMeso;
    totalHonor += honor; totalResetMeso += resetMeso; totalUses += uses;
    totalBlackUses += guide.mixed ? blackUses : guide.itemMethod === 'black' ? uses : 0;
    totalChaosUses += chaosUses;
    maxBlackUses = Math.max(maxBlackUses, guide.mixed ? blackUses : guide.itemMethod === 'black' ? uses : 0);
    maxChaosUses = Math.max(maxChaosUses, chaosUses);
    maxUses = Math.max(maxUses, uses); if (uses > inventory) overInventory++;
  }
  // Keep each trial's components together when selecting a total-cost
  // percentile. Independent component percentiles do not add up to that total.
  const costOrder = Uint32Array.from({ length: trials }, (_, i) => i);
  costOrder.sort((a, b) => costs[a] - costs[b] || a - b);
  const quantiles = new Float64Array(10001);
  const costBreakdowns = { honorMeso: new Float64Array(10001), resetMeso: new Float64Array(10001), abyssMeso: new Float64Array(10001) };
  for (let i = 0; i <= 10000; i++) {
    const sample = costOrder[Math.max(0, Math.ceil(i / 10000 * trials) - 1)];
    quantiles[i] = costs[sample];
    costBreakdowns.honorMeso[i] = honorCosts[sample];
    costBreakdowns.resetMeso[i] = resetCosts[sample];
    costBreakdowns.abyssMeso[i] = useCounts[sample] * itemPrice;
  }
  useCounts.sort();
  // Marginal use-count quantiles: the cost-percentile trial does not determine
  // the number of circulators to prepare for the same probability.
  const useQuantiles = Float64Array.from({ length: 10001 }, (_, i) => useCounts[Math.max(0, Math.ceil(i / 10000 * trials) - 1)]);
  // Conditional distribution: successful/non-exhausted trials are not zero-cost
  // finishes. Only post-cap honor/reset spending in exhausted trials belongs here.
  const conditionalFinishCosts = finishCosts.subarray(0, exhaustedCount).sort();
  const conditionalFinishQuantiles = exhaustedCount
    ? Float64Array.from({ length: 10001 }, (_, i) => conditionalFinishCosts[Math.max(0, Math.ceil(i / 10000 * exhaustedCount) - 1)])
    : null;
  const average = result.expectedTotalMeso;
  let lo = 0, hi = costs.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (costs[costOrder[mid]] <= average) lo = mid + 1; else hi = mid; }
  const mean = total / trials;
  return { trials, seed, quantiles, costBreakdowns, useQuantiles, conditionalFinishQuantiles, finishSampleCount: exhaustedCount,
    mean, standardError: Math.sqrt(Math.max(0, totalSquared / trials - mean ** 2) / (trials - 1)),
    averageChance: lo / trials, meanHonor: totalHonor / trials, meanResetMeso: totalResetMeso / trials,
    meanUses: totalUses / trials, maxUses, overInventoryProbability: overInventory / trials,
    meanBlackUses: totalBlackUses / trials, meanChaosUses: totalChaosUses / trials, maxBlackUses, maxChaosUses,
    phaseSuccessProbability: phaseSuccessCount / trials, exhaustionProbability: exhaustedCount / trials,
    conditionalFinishMeso: exhaustedCount ? postCapCost / exhaustedCount : null,
    approximation: 'monte-carlo-mean-collision' };
}

export function abilityRouteCostForChance(reach, chance) {
  if (!reach?.quantiles || !Number.isFinite(chance)) return null;
  const index = Math.round(Math.min(1, Math.max(0, chance)) * 10000);
  return reach.quantiles[index];
}

/** Composition of the same trial as the total-cost percentile, not marginal budgets. */
export function abilityRouteBreakdownForChance(reach, chance) {
  if (!reach?.quantiles || !reach.costBreakdowns || !Number.isFinite(chance)) return null;
  const index = Math.round(Math.min(1, Math.max(0, chance)) * 10000);
  const result = { totalMeso: reach.quantiles[index], honorMeso: reach.costBreakdowns.honorMeso?.[index],
    resetMeso: reach.costBreakdowns.resetMeso?.[index], abyssMeso: reach.costBreakdowns.abyssMeso?.[index] };
  return Object.values(result).every(Number.isFinite) ? result : null;
}

/** Circulators used within the requested percentile, including honor finishes. */
export function abilityRouteUsesForChance(reach, chance) {
  if (!reach?.useQuantiles || !Number.isFinite(chance)) return null;
  const index = Math.round(Math.min(1, Math.max(0, chance)) * 10000);
  return reach.useQuantiles[index];
}

/** Additional cost percentile conditional on exhausting the cap before phase success. */
export function abilityRouteFinishCostForChance(reach, chance) {
  if (!reach?.conditionalFinishQuantiles || !Number.isFinite(chance)) return null;
  const index = Math.round(Math.min(1, Math.max(0, chance)) * 10000);
  const cost = reach.conditionalFinishQuantiles[index];
  return Number.isFinite(cost) ? cost : null;
}
