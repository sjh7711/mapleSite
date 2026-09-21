import { preferImprovedAbilityResults } from './ability-result-preference.js';
import { addPracticalChaosStock } from './ability-mixed-circulators.js';
// Optimize converted honor, reset meso, and the entered value of used Abyss items. Inventory remains a hard upper bound.
const zero = () => Array(9).fill(0);
function add(a, b, p = 1) {
  const result = Array(Math.max(a.length, b.length));
  for (let i = 0; i < result.length; i++) result[i] = (a[i] ?? 0) + p * (b[i] ?? 0);
  return result;
}
const bits = (mask) => [0, 1, 2].filter((i) => mask & (1 << i));
const indexOf = (states, values) => states.findIndex((s) => s.values.every((v, i) => v === values[i]));
export function compareAbilityVectors(a, b, price, abyssPrice = 0) {
  const score = (v) => Math.round((v[0] * price / 5000 + v[1] + v[7] * abyssPrice) * 1000) / 1000;
  const rounded = (v, scale) => Math.round(v * scale) / scale;
  const items = (v) => rounded(v[4] + v[5] + v[6] + v[7], 1e9);
  // Absolute rounded keys keep ordering transitive even near floating-point ties.
  return score(a) - score(b) || rounded(a[0], 1000) - rounded(b[0], 1000) ||
    rounded(a[1], 1000) - rounded(b[1], 1000) || items(a) - items(b);
}
function choose(choices, api) {
  return choices.reduce((a, b) => !a || api.compare(b.vector, a.vector) < 0 ? b : a, null);
}
function bandPush(bands, remaining, key, values) {
  const old = bands.at(-1)?.[key];
  if (!old || values.some((v, i) => v !== old[i])) bands.push({ remaining, [key]: values });
}
function ranksFor(values, api) {
  const order = values.map((_, i) => i).sort((a, b) => api.compare(values[a], values[b]) || a - b);
  const ranks = []; let rank = 0;
  order.forEach((i, n) => { if (n && api.compare(values[i], values[order[n - 1]]) !== 0) rank++; ranks[i] = rank; });
  return { order, ranks };
}
export function economicValueRoll(states, values, api, fixedRanks) {
  const { order, ranks } = fixedRanks
    ? { order: states.map((_, i) => i).sort((a, b) => fixedRanks[a] - fixedRanks[b]), ranks: fixedRanks }
    : ranksFor(values, api);
  const next = [];
  let mass = 0, prefix = zero();
  for (let begin = 0; begin < order.length;) {
    let end = begin + 1;
    while (end < order.length && ranks[order[end]] === ranks[order[begin]]) end++;
    for (let n = begin; n < end; n++) {
      const i = order[n], s = states[i], excluded = api.method === "advanced" ? s.probability : 0;
      const reject = Math.max(0, 1 - mass - excluded);
      // A tuple of three fixed values has no different outcome to propose.
      next[i] = excluded >= 1 ? [...values[i]]
        : add(prefix, values[i], reject).map((v) => v / (1 - excluded));
      next[i][api.itemIndex]++;
    }
    for (let n = begin; n < end; n++) {
      const i = order[n]; mass += states[i].probability;
      prefix = add(prefix, values[i], states[i].probability);
    }
    begin = end;
  }
  return next;
}
function tuples(distributions, match) {
  const states = [];
  function visit(line, values, probability) {
    if (line === 3) { states.push({ values, probability, mask: values.reduce((m, v, i) => match(i, v) ? m | (1 << i) : m, 0) }); return; }
    for (const [v, p] of distributions[line]) visit(line + 1, [...values, v], probability * p);
  }
  visit(0, [], 1); return states;
}
function policyModel(states, count, api, stopping, complete = () => false) {
  if (api.stationary) return stationaryPolicyModel(states, api, stopping, complete);
  const levels = [], policyBands = [], actionBands = [];
  for (let n = 0; n <= count; n++) {
    const stops = states.map((s, i) => stopping(s, i, n));
    const rolled = n ? economicValueRoll(states, levels[n - 1], api) : null;
    const actions = [], values = states.map((s, i) => {
      const stop = !n || complete(s) || api.compare(stops[i].vector, rolled[i]) <= 0;
      actions[i] = stop ? stops[i].action : "roll";
      return stop ? stops[i].vector : rolled[i];
    });
    levels.push(values);
    bandPush(policyBands, n, "ranks", ranksFor(values, api).ranks);
    bandPush(actionBands, n, "actions", actions);
  }
  return { states, stateValues: levels.at(-1), policyBands, actionBands, levels, computedUses: count };
}
// Solve the unlimited policy itself; no arbitrarily large inventory is used.
function stationaryPolicyModel(states, api, stopping, complete) {
  const stops = states.map((s, i) => stopping(s, i, 0));
  let values = stops.map((s) => s.vector), actions = stops.map((s) => s.action), iteration = 0;
  const item = zero(); item[api.itemIndex] = 1;
  for (; iteration < 1000; iteration++) {
    const old = values, { order } = ranksFor(old, api), next = old.map((v) => [...v]);
    let mass = 0, prefix = zero();
    for (const i of order) {
      let best = stops[i].vector, action = stops[i].action;
      if (!complete(states[i]) && mass > 0) {
        const candidate = add(prefix, item, api.method === "advanced" ? 1 - states[i].probability : 1).map((v) => v / mass);
        if (api.compare(candidate, best) < 0) { best = candidate; action = "roll"; }
      }
      next[i] = best; actions[i] = action;
      mass += states[i].probability; prefix = add(prefix, best, states[i].probability);
    }
    values = next;
    const delta = Math.max(...values.flatMap((v, i) => v.map((x, k) => Math.abs(x - old[i][k]) / Math.max(1, Math.abs(x)))));
    if (delta < 1e-12) break;
  }
  const rolled = economicValueRoll(states, values, api);
  const residual = Math.max(...states.flatMap((s, i) => {
    const expected = complete(s) || api.compare(stops[i].vector, rolled[i]) <= 0 ? stops[i].vector : rolled[i];
    return expected.map((x, k) => Math.abs(x - values[i][k]) / Math.max(1, Math.abs(x)));
  }));
  if (iteration === 1000 || residual > 1e-8) throw new Error("무제한 비교 경로의 계산이 수렴하지 않았습니다.");
  const model = { states, stateValues: values, levels: [values], computedUses: 0, residual,
    policyBands: [{ remaining: 0, ranks: ranksFor(values, api).ranks }], actionBands: [{ remaining: 0, actions }] };
  return api.preferImprovedResults ? preferImprovedAbilityResults(model, api, stops, complete) : model;
}
// Diagnostic entries never participate in cost/ranking comparisons:
// 9: planned phase exit, 10: forced exit at cap, 11/12: honor/meso after that exit.
function phaseOutcome(vector, reached, exhausted) {
  return [...vector.slice(0, 9), Number(reached), Number(exhausted), exhausted ? vector[0] : 0, exhausted ? vector[1] : 0];
}
export function evaluateAbilityPolicyAtCap(states, count, api, reference, direct, acquire, retainLevels = true) {
  const ranks = reference.policyBands[0].ranks, actions = reference.actionBands[0].actions;
  const levels = []; let previous, computedUses = 0;
  for (let n = 0; n <= count; n++) {
    const rolled = n ? economicValueRoll(states, previous, api, ranks) : null;
    previous = states.map((s, i) => {
      if (!n || actions[i] === "direct") return phaseOutcome(direct(s), actions[i] === "direct", !n && actions[i] !== "direct");
      return actions[i] === "acquire" ? acquire(s, n) : rolled[i];
    });
    if (retainLevels) levels.push(previous);
    computedUses = n;
    // Very large entered inventories converge to this same stationary policy.
    // Verify all states and the exhaustion contribution before dropping a tail.
    if (n && n % 25 === 0 && reference.stateValues && previous.every((v, i) => v[10] < 1e-13 && v[11] < 1e-6 && v[12] < 1e-6
      && v.slice(0, 9).every((x, k) => Math.abs(x - reference.stateValues[i][k]) <= 1e-11 * Math.max(1, Math.abs(x))))) break;
  }
  return { states, stateValues: previous, ...(retainLevels ? { levels } : {}), computedUses,
    policyBands: [{ remaining: 0, ranks }], actionBands: [{ remaining: 0, actions: states.map(() => "direct") },
      ...(count ? [{ remaining: 1, actions }] : [])] };
}
// A practical policy keeps the better completion mask according to one fixed
// table, keeps the old tuple on ties, and rolls until its goal or stock limit.
function practicalPolicyModel(states, count, api, stopping, complete, ranks) {
  const levels = [], actionBands = [];
  for (let n = 0; n <= count; n++) {
    const rolled = n ? economicValueRoll(states, levels[n - 1], api, ranks) : null;
    const actions = [];
    levels.push(states.map((s, i) => {
      const stop = !n || complete(s);
      actions[i] = stop ? "direct" : "roll";
      const terminal = stop ? stopping(s, i) : null;
      return stop ? api.trackOutcomes ? phaseOutcome(terminal, complete(s), !n && !complete(s)) : terminal : rolled[i];
    }));
    bandPush(actionBands, n, "actions", actions);
  }
  return { states, stateValues: levels.at(-1), levels, actionBands,
    policyBands: [{ remaining: 0, ranks }], computedUses: count };
}
function buildPair(targets, pairMask, count, api) {
  if (api.chaosCount && api.practicalMode) count = api.blackCount;
  const lower = bits(pairMask).map((i) => targets[i]);
  const ordered = [targets.find((_, i) => !(pairMask & (1 << i))), ...lower];
  const plan = api.plan(ordered), keepMasks = [];
  const terminal = Array.from({ length: 8 }, (_, mask) => {
    const choices = [{ keep: 0, vector: api.vector(plan, 0) }];
    for (let k = mask; k; k = (k - 1) & mask) choices.push({ keep: k, vector: api.vector(plan, k) });
    const best = choose(choices, api); keepMasks.push(best.keep); return best.vector;
  });
  const distributions = ordered.map((t) => api.values(t.type, t.grade));
  const states = tuples(distributions, (i, v) => v >= ordered[i].minimum);
  const fullChance = states.filter((s) => s.mask === 7).reduce((sum, s) => sum + s.probability, 0);
  const bound = Math.max(1 / fullChance, ...terminal.flat());
  const reference = api.referenceGuide?.pairs.find((p) => p.pairMask === pairMask);
  const limit = api.stationary ? 0 : reference ? count : fullChance >= 1 ? 0 : Math.min(count, Math.ceil(Math.log(1e-7 / bound) / Math.log1p(-fullChance)));
  const practicalMode = api.practicalMode;
  const focusMask = practicalMode === "lower" ? 6 : 7;
  const maskOrder = (focusMask === 6 ? [0, 2, 4, 6] : [0, 1, 2, 3, 4, 5, 6, 7])
    .sort((a, b) => api.compare(terminal[a], terminal[b]) || b - a);
  const fixedRanks = (list) => list.map((s) => maskOrder.indexOf(s.mask & focusMask));
  const full = reference ? evaluateAbilityPolicyAtCap(states, limit, api, reference.full, (s) => terminal[s.mask]) : practicalMode
    ? practicalPolicyModel(states, limit, api, (s) => terminal[s.mask], (s) => (s.mask & focusMask) === focusMask, fixedRanks(states))
    : policyModel(states, limit, api, (s) => ({ vector: terminal[s.mask], action: "direct" }), (s) => s.mask === 7);
  const lowerStates = [];
  for (const [a, pa] of distributions[1]) for (const [b, pb] of distributions[2]) lowerStates.push({ values: [a, b], probability: pa * pb,
    mask: (a >= lower[0].minimum ? 2 : 0) | (b >= lower[1].minimum ? 4 : 0) });
  const firstAfter = full.levels.map((level) => lowerStates.map((l) => distributions[0].reduce((sum, [v, p]) =>
    add(sum, level[indexOf(states, [v, ...l.values])], p), zero())));
  const available = api.options.filter((o) => !lower.some((t) => t.type === o.id) && api.weight(o.id, "legendary") > 0);
  const totalWeight = available.reduce((sum, o) => sum + api.weight(o.id, "legendary"), 0);
  const firstOptions = available.map((o) => ({ type: o.id, label: o.label, values: api.values(o.id, "legendary"), weight: api.weight(o.id, "legendary") / totalWeight }));
  const firstChance = firstOptions.find((o) => o.type === ordered[0].type).weight;
  const models = {};
  for (const entry of firstOptions) {
    if (entry.type === ordered[0].type || (!count && !api.chaosCount)) continue;
    // The comparison policy also depends on numerical order (some first-line
    // profiles have descending values), even when the probability rows match.
    const profile = JSON.stringify([entry.weight, entry.values.map(([, p]) => p),
      ...(api.preferImprovedResults ? [entry.values.map(([v]) => entry.values.filter(([other]) => other < v).length)] : [])]);
    entry.profile = profile;
    if (models[profile]) continue;
    const otherStates = tuples([entry.values.map(([, p], i) => [i, p]), ...distributions.slice(1)], (i, v) => i > 0 && v >= ordered[i].minimum);
    const acquireFirst = (s, remaining) => {
      const li = lowerStates.findIndex((l) => l.values[0] === s.values[1] && l.values[1] === s.values[2]);
      const attempts = (api.method === "advanced" ? 1 - entry.weight * entry.values[s.values[0]][1] : 1) / firstChance;
      return add(firstAfter[Math.min(remaining, firstAfter.length - 1)][li], api.resetCost(2), attempts);
    };
    const model = reference ? evaluateAbilityPolicyAtCap(otherStates, limit, api, reference.models[profile], (s) => terminal[s.mask], acquireFirst, false) : practicalMode === "lower"
      ? practicalPolicyModel(otherStates, limit, api, (s) => terminal[s.mask], (s) => s.mask === 6, fixedRanks(otherStates))
      : practicalMode === "all" ? (() => {
        // Preserve a separate continuation for each inventory cap. Acquiring
        // the first type consumes no circulator; all n items remain available.
        const levels = Array.from({ length: limit + 1 }, (_, n) => otherStates.map((s) => n ? acquireFirst(s, n)
          : api.trackOutcomes ? phaseOutcome(terminal[s.mask], false, true) : terminal[s.mask]));
        return { states: otherStates, levels, stateValues: levels.at(-1), computedUses: limit,
          actionBands: [{ remaining: 0, actions: otherStates.map(() => "direct") },
            ...(limit ? [{ remaining: 1, actions: otherStates.map(() => "acquire") }] : [])], policyBands: [] };
      })() : policyModel(otherStates, limit, { ...api,
        resultValues: (s) => [entry.values[s.values[0]][0], ...s.values.slice(1)] }, (s, i, remaining) => {
        const acquire = acquireFirst(s, remaining);
        return api.compare(acquire, terminal[s.mask]) < 0 ? { vector: acquire, action: "acquire" } : { vector: terminal[s.mask], action: "direct" };
      });
    if (!api.retainLevels) delete model.levels;
    models[profile] = model;
  }
  if (!api.retainLevels) delete full.levels;
  const pair = { pairMask, targets: ordered, names: ordered.map(api.shortName), labels: ordered.map((t, i) => api.describe(t, i)),
    lowerStates, terminal, keepMasks, full, models, firstOptions, count, computedUses: limit,
    method: api.method, itemMethod: api.itemMethod,
    ...(practicalMode ? { practical: { mode: practicalMode, focusMask, maskOrder } } : {}),
    continuations: terminal.map((v, mask) => api.guide(ordered, plan, keepMasks[mask])) };
  return addPracticalChaosStock(pair, api);
}
export function chooseAbilityEconomicAction(pair, firstType, values, remainingCount = pair.count) {
  if (!Array.isArray(values) || values.length !== 3 || !values.every(Number.isFinite)) return null;
  const entry = pair.firstOptions.find((o) => o.type === firstType); if (!entry) return null;
  const firstIndex = entry.values.findIndex(([v]) => v === values[0]);
  const lowerIndex = pair.lowerStates.findIndex((s) => s.values.every((v, i) => v === values[i + 1]));
  if (firstIndex < 0 || lowerIndex < 0) return null;
  const same = firstType === pair.targets[0].type;
  const mask = pair.lowerStates[lowerIndex].mask | (same && values[0] >= pair.targets[0].minimum ? 1 : 0);
  const model = same ? pair.full : pair.models[entry.profile];
  if (!model) return { action: "direct", mask, keepMask: pair.keepMasks[mask], vector: pair.terminal[mask] };
  const index = indexOf(model.states, same ? values : [firstIndex, ...values.slice(1)]);
  if (pair.mixed) return { action: !same && pair.practical.mode === "all" ? "acquire"
    : model.chaos.actionBands.at(-1).actions[index], mask, keepMask: pair.keepMasks[mask], vector: model.initialValues[index], model, index };
  const remaining = Math.max(0, Math.min(pair.computedUses, Math.floor(Number(remainingCount) || 0)));
  const band = model.actionBands.findLast((b) => b.remaining <= remaining) ?? model.actionBands[0];
  return { action: band.actions[index], mask, keepMask: pair.keepMasks[mask], vector: (model.levels?.[remaining] ?? model.stateValues)[index], model, index };
}

const ROLL_CACHE = new Map();
export function lowerRolls(targets, lockedMask, api) {
  const key = JSON.stringify([api.method, targets.map(({ type, grade }) => [type, grade]), lockedMask]);
  if (ROLL_CACHE.has(key)) return ROLL_CACHE.get(key);
  const locked = bits(lockedMask);
  const used = new Set(locked.map((i) => targets[i].type));
  const entries = Object.fromEntries(["legendary", "unique", "epic"].map((grade) => [grade,
    api.options.map((o) => ({ type: o.id, grade, weight: api.weight(o.id, grade),
      moment: api.values(o.id, grade).reduce((sum, [, p]) => sum + p * p, 0),
      target: targets.findIndex((t) => t.type === o.id && t.grade === grade),
    })).filter((e) => e.weight > 0)]));
  const totals = Object.fromEntries(Object.entries(entries).map(([g, list]) => [g, list.reduce((s, e) => s + e.weight, 0)]));
  const weights = Object.fromEntries(Object.entries(entries).map(([g, list]) => [g, new Map(list.map((e) => [e.type, e.weight]))]));
  const events = new Map();
  const grades = api.method === "advanced" ? [["legendary", 0.02], ["unique", 0.15], ["epic", 0.83]] : [["unique", 0.15], ["epic", 0.85]];
  function visit(line, p, moment, mask, firstType) {
    if (line === 3) {
      if (!events.has(mask)) events.set(mask, { mask, probability: 0, collision: 0, first: {} });
      const e = events.get(mask);
      e.probability += p;
      e.collision += moment;
      e.first[firstType] = (e.first[firstType] ?? 0) + p;
      return;
    }
    if (line === 1 && locked.length) { visit(2, p, moment, mask, firstType); return; }
    for (const [grade, gp] of line === 0 ? [["legendary", 1]] : grades) {
      const denominator = totals[grade] - [...used].reduce((sum, type) => sum + (weights[grade].get(type) ?? 0), 0);
      for (const entry of entries[grade]) {
        if (used.has(entry.type)) continue;
        const chance = gp * entry.weight / denominator;
        used.add(entry.type);
        visit(line + 1, p * chance, moment * chance ** 2 * entry.moment,
          line > 0 && entry.target >= 0 ? mask | (1 << entry.target) : mask,
          line === 0 ? entry.type : firstType);
        used.delete(entry.type);
      }
    }
  }
  visit(0, 1, 1, lockedMask, "");
  const result = [...events.values()];
  if (ROLL_CACHE.size > 32) ROLL_CACHE.clear();
  ROLL_CACHE.set(key, result);
  return result;
}
export function expand(event, locked, targets, api) {
  let list = [{ ...event, values: {}, factor: 1, momentFactor: 1 }];
  for (const i of bits(event.mask & ~locked)) {
    const values = api.values(targets[i].type, targets[i].grade);
    const moment = values.reduce((sum, [, p]) => sum + p * p, 0);
    list = list.flatMap((e) => values.map(([v, p]) => ({ ...e, values: { ...e.values, [i]: v },
      factor: e.factor * p, momentFactor: e.momentFactor * p * p / moment })));
  }
  return list.map((e) => ({ ...e, probability: e.probability * e.factor, collision: e.collision * e.momentFactor }));
}
function solve(events, cost, locked, api, fixedDecisions) {
  if (fixedDecisions) {
    const accepted = events.filter((e) => e.choice && fixedDecisions.some((d) => d.found === e.mask && d.keep === e.choice.keep && d.keep !== locked
      && Object.entries(d.values).every(([i, v]) => e.values[i] === v)));
    const mass = accepted.reduce((sum, e) => sum + e.probability, 0);
    if (!mass) return null;
    const future = accepted.reduce((v, e) => add(v, e.choice.vector, e.probability), zero());
    const failMoment = events.reduce((sum, e) => sum + e.collision, 0) - accepted.reduce((sum, e) => sum + e.collision, 0);
    const factor = api.method === "advanced" && mass < 1 - 1e-12 ? 1 - Math.max(0, failMoment) / (1 - mass) : 1;
    return { vector: add(future, cost, factor).map((v) => v / mass), decisions: fixedDecisions };
  }
  const progress = events.filter((e) => e.choice).sort((a, b) => api.compare(a.choice.vector, b.choice.vector));
  let mass = 0, future = zero(), failMoment = api.method === "advanced" ? events.reduce((sum, e) => sum + e.collision, 0) : 0;
  let best = null;
  for (let i = 0; i < progress.length; i++) {
    const e = progress[i]; mass += e.probability; future = add(future, e.choice.vector, e.probability);
    if (api.method === "advanced") failMoment -= e.collision;
    const factor = api.method === "advanced" && mass < 1 - 1e-12 ? 1 - Math.max(0, failMoment) / (1 - mass) : 1;
    const vector = add(future, cost, factor).map((v) => v / mass);
    if (!best || api.compare(vector, best.vector) < 0) best = { vector, accepted: i + 1 };
  }
  if (!best) return null;
  return { vector: best.vector, decisions: progress.map((e, i) => ({ found: e.mask, values: e.values,
    keep: i < best.accepted ? e.choice.keep : locked })) };
}

export function calculateAbilityEconomicCandidate(options, api) {
  const targets = options.targets;
  const count = api.count;
  const pairs = api.pairs ?? new Map();
  for (const mask of [3, 5, 6]) {
    if (targets.find((t, i) => !(mask & (1 << i))).grade !== "legendary") continue;
    if (api.method === "honor" && mask !== 6) continue;
    if (!pairs.has(mask)) pairs.set(mask, buildPair(targets, mask, count, api));
  }
  if (!pairs.size) return null;
  const eligible = [...pairs.keys()].reduce((a, b) => a | b, 0), pairCache = new Map();
  function pairVector(event, values) {
    const pair = pairs.get(event.mask); if (!pair) return null;
    const lowerValues = bits(event.mask).map((i) => values[i]);
    const key = JSON.stringify([event.mask, lowerValues, event.first]);
    if (pairCache.has(key)) return pairCache.get(key);
    let average = zero(); const mass = Object.values(event.first).reduce((sum, p) => sum + p, 0);
    for (const [type, p] of Object.entries(event.first)) {
      const entry = pair.firstOptions.find((o) => o.type === type);
      for (const [v, q] of entry.values) {
        const choice = chooseAbilityEconomicAction(pair, type, [v, ...lowerValues], count);
        average = add(average, choice.vector, p / mass * q);
      }
    }
    pairCache.set(key, average); return average;
  }
  const one = new Map();
  for (const i of bits(eligible)) for (const [value] of api.values(targets[i].type, targets[i].grade)) {
    const locked = 1 << i;
    const events = lowerRolls(targets, locked, api).flatMap((e) => expand(e, locked, targets, api)).map((e) => {
      const vector = pairVector(e, { ...e.values, [i]: value });
      return { ...e, choice: vector ? { vector, keep: e.mask } : null };
    });
    const fixed = api.referenceGuide?.one.find((s) => s.targetIndex === i && s.value === value)?.decisions;
    const solved = solve(events, api.resetCost(1), locked, api, fixed);
    if (solved) one.set(`${i}/${value}`, { ...solved, mask: locked, targetIndex: i, value,
      label: `${api.describe(targets[i], -1)} ${value}${api.unit(targets[i].type)}` });
  }
  const events = lowerRolls(targets, 0, api).flatMap((e) => expand(e, 0, targets, api)).map((e) => {
    const choices = bits(e.mask & eligible).map((i) => ({ vector: one.get(`${i}/${e.values[i]}`).vector, keep: 1 << i }));
    const vector = pairVector(e, e.values); if (vector) choices.push({ vector, keep: e.mask });
    const fixed = api.referenceGuide?.start.decisions.find((d) => d.found === e.mask && Object.entries(d.values).every(([i, v]) => e.values[i] === v));
    return { ...e, choice: api.referenceGuide ? choices.find((c) => c.keep === fixed?.keep) : choose(choices, api) };
  });
  const start = solve(events, api.resetCost(0), 0, api, api.referenceGuide?.start.decisions);
  if (!start) return null;
  return { vector: start.vector, guide: { targets, method: api.method, itemMethod: api.itemMethod, count,
    ...(api.chaosCount && api.practicalMode ? { mixed: true, blackCount: api.blackCount, chaosCount: api.chaosCount } : {}),
    ...(api.practicalMode ? { practical: true } : {}),
    ...(api.referenceGuide ? { reference: true } : {}),
    names: targets.map(api.shortName), units: targets.map((t) => api.unit(t.type)),
    values: targets.map((t) => api.values(t.type, t.grade).map(([v]) => v)),
    start: { mask: 0, decisions: start.decisions },
    one: [...one.values()].map(({ vector, ...entry }) => entry),
    pairs: [...pairs.values()].map((pair) => ({ ...pair, label: pair.targets.slice(1).map(api.shortName).join(" + ") })) } };
}

export function calculateAbilityPracticalCandidate(options, api) {
  let best = null;
  for (const practicalMode of ["all", "lower"]) {
    const shared = { ...api, trackOutcomes: false, practicalMode, retainLevels: true, pairs: new Map() };
    let candidate = calculateAbilityEconomicCandidate(options, shared);
    if (candidate && (!best || api.compare(candidate.vector, best.vector) < 0)) best = candidate;
    // Charging an item can make a smaller cap cheaper. Compare every cap using
    // already evaluated continuations, rather than repeatedly rebuilding the DP.
    if (api.abyssPrice > 0 && api.itemMethod === "abyss" && api.count) {
      const limit = Math.min(api.count, Math.max(...[...shared.pairs.values()].map((p) => p.computedUses)));
      for (let count = 0; count < limit; count++) {
        candidate = calculateAbilityEconomicCandidate(options, { ...shared, count });
        if (candidate && (!best || api.compare(candidate.vector, best.vector) < 0)) best = candidate;
      }
    }
  }
  if (!best) return null;
  const count = best.guide.count;
  if (api.trackOutcomes) {
    // Only the selected cap needs the extra diagnostics. Keeping diagnostic
    // values out of the cap search also avoids multiplying its memory usage.
    best = calculateAbilityEconomicCandidate(options, { ...api, count, retainLevels: true,
      practicalMode: best.guide.pairs[0].practical.mode, trackOutcomes: true, pairs: new Map() });
  }
  const trim = (model) => {
    const { levels, ...rest } = model;
    const n = Math.min(count, model.computedUses);
    return { ...rest, stateValues: levels?.[n] ?? model.stateValues, computedUses: n,
      actionBands: model.actionBands.filter((b) => b.remaining <= n),
      policyBands: model.policyBands.filter((b) => b.remaining <= n) };
  };
  best.guide = { ...best.guide, availableCount: api.count, pairs: best.guide.pairs.map((pair) => ({
    ...pair, count, availableCount: api.count, computedUses: Math.min(count, pair.computedUses), full: trim(pair.full),
    models: Object.fromEntries(Object.entries(pair.models).map(([key, model]) => [key, trim(model)])),
  })) };
  return best;
}

export function calculateAbilityCappedReferenceCandidate(options, api) {
  if (!api.count) return null;
  const unlimited = calculateAbilityEconomicCandidate(options, { ...api, count: 1, stationary: true, trackOutcomes: false, pairs: new Map() });
  if (!unlimited) return null;
  const bounded = calculateAbilityEconomicCandidate(options, { ...api, referenceGuide: unlimited.guide, pairs: new Map() });
  if (!bounded) return null;
  return { ...bounded, unlimitedVector: unlimited.vector };
}

export function calculateAbilityUnlimitedCandidate(options, api) {
  const candidate = calculateAbilityEconomicCandidate(options, { ...api, count: 1, stationary: true,
    preferImprovedResults: api.preferImprovedResults !== false,
    trackOutcomes: false, pairs: new Map() });
  if (!candidate) return null;
  candidate.guide = { ...candidate.guide, reference: true, unlimited: true, count: null,
    pairs: candidate.guide.pairs.map((pair) => ({ ...pair, unlimited: true, count: null })) };
  return candidate;
}

export function abilityPhaseMetrics(candidate, honorPricePer5000) {
  const vector = candidate.vector, count = candidate.guide.count;
  return { maximumUses: count, phaseSuccessProbability: count ? Math.max(0, Math.min(1, vector[9] ?? 0)) : null,
    exhaustionProbability: count ? Math.max(0, Math.min(1, vector[10] ?? 0)) : null,
    exhaustionHonor: count ? vector[11] ?? 0 : 0, exhaustionResetMeso: count ? vector[12] ?? 0 : 0,
    exhaustionMesoContribution: count ? (vector[11] ?? 0) * honorPricePer5000 / 5000 + (vector[12] ?? 0) : 0 };
}
