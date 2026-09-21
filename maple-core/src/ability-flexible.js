// Extra candidate family: collect either lower line, then decide the first line.
// Prices do not enter this solver. All policies minimize honor with finite stock.
const zero = () => Array(9).fill(0);
const add = (a, b, scale = 1) => a.map((v, i) => v + scale * b[i]);
const bits = (mask) => [0, 1, 2].filter((i) => mask & (1 << i));
const countBits = (mask) => bits(mask).length;
const subsets = (mask) => {
  const result = [];
  for (let sub = mask; sub; sub = (sub - 1) & mask) result.push(sub);
  return result;
};
const best = (choices) => choices.reduce((a, b) => !a || b.vector[0] < a.vector[0] - 1e-7 ||
  (Math.abs(b.vector[0] - a.vector[0]) <= 1e-7 && b.vector[7] < a.vector[7]) ? b : a, null);
const stateIndex = (states, values) => states.findIndex((s) => s.values.every((v, i) => v === values[i]));

/** Evaluate an actual three-line result after collecting the two lower types. */
export function chooseFlexibleAbilityStart(pair, firstType, values) {
  const entry = pair.firstOptions.find((o) => o.type === firstType);
  if (!entry || !values?.every(Number.isFinite)) return null;
  const firstIndex = entry.values.findIndex(([v]) => v === values[0]);
  const lowerIndex = pair.lowerStates.findIndex((s) => s.values.every((v, i) => v === values[i + 1]));
  if (firstIndex < 0 || lowerIndex < 0) return null;
  const firstMatches = firstType === pair.targets[0].type;
  const mask = pair.lowerStates[lowerIndex].mask |
    (firstMatches && values[0] >= pair.targets[0].minimum ? 1 : 0);
  const choices = [{ mode: "direct", vector: pair.terminal[mask], mask }];
  if (pair.count > 0) {
    if (firstMatches) {
      const index = stateIndex(pair.full.states, values);
      if (index >= 0) choices.push({ mode: "full", vector: pair.full.stateValues[index], mask });
    } else {
      // Keep the old first-line result after failures. Only its identical full
      // result is excluded; the lower lines stay locked during this acquisition.
      const attempts = (1 - entry.weight * entry.values[firstIndex][1]) / pair.firstChance;
      const acquired = add(pair.afterFirst[lowerIndex], pair.firstResetCost, attempts);
      choices.push({ mode: "first-then-full", vector: acquired, mask });
      const model = pair.profiles[entry.profile];
      const index = stateIndex(model.states, [firstIndex, values[1], values[2]]);
      if (index >= 0) choices.push({ mode: "pair", vector: model.stateValues[index], mask });
    }
  }
  return best(choices);
}

function tuples(distributions, match) {
  const states = [];
  function visit(line, values, probability) {
    if (line === 3) {
      states.push({ values, probability, mask: values.reduce((mask, value, i) =>
        match(i, value) ? mask | (1 << i) : mask, 0) });
      return;
    }
    for (const [value, p] of distributions[line]) visit(line + 1, [...values, value], probability * p);
  }
  visit(0, [], 1);
  return states;
}

function buildPair(targets, pairMask, count, api, halfHonor) {
  const lower = bits(pairMask).map((i) => targets[i]);
  const first = targets.find((_, i) => !(pairMask & (1 << i)));
  const ordered = [first, ...lower];
  const plan = api.plan(ordered);
  const keepMasks = [];
  const terminal = Array.from({ length: 8 }, (_, mask) => {
    const chosen = best([0, ...subsets(mask)].map((keep) => ({
      vector: api.vector(plan, keep), keep,
    })));
    keepMasks.push(chosen.keep);
    return chosen.vector;
  });
  const distributions = ordered.map((t) => api.values(t.type, t.grade));
  const states = tuples(distributions, (line, v) => v >= ordered[line].minimum);
  const full = { states, ...api.finite(states, terminal, count, { returnStates: true }) };
  const lowerStates = [];
  for (const [v1, p1] of distributions[1]) for (const [v2, p2] of distributions[2]) {
    lowerStates.push({ values: [v1, v2], probability: p1 * p2,
      mask: (v1 >= lower[0].minimum ? 2 : 0) | (v2 >= lower[1].minimum ? 4 : 0) });
  }
  const afterFirst = lowerStates.map(({ values }) => distributions[0].reduce((sum, [v, p]) =>
    add(sum, full.stateValues[stateIndex(states, [v, ...values])], p), zero()));
  const options = api.options.filter((o) => !lower.some((t) => t.type === o.id) && api.weight(o.id, "legendary") > 0);
  const totalWeight = options.reduce((sum, o) => sum + api.weight(o.id, "legendary"), 0);
  const profiles = {};
  const firstOptions = options.map((o) => {
    const values = api.values(o.id, "legendary");
    const profile = JSON.stringify(values.map(([, p]) => p));
    if (o.id !== first.type && !profiles[profile] && count > 0) {
      const otherStates = tuples([values.map(([, p], i) => [i, p]), ...distributions.slice(1)],
        (line, v) => line > 0 && v >= ordered[line].minimum);
      profiles[profile] = { states: otherStates,
        ...api.finite(otherStates, terminal, count, { stopMask: 6, returnStates: true }) };
    }
    return { type: o.id, label: o.label, values, weight: api.weight(o.id, "legendary") / totalWeight, profile };
  });
  const pair = {
    pairMask, targets: ordered, names: ordered.map(api.shortName), lowerStates, terminal, keepMasks, full, profiles, firstOptions, afterFirst, count,
    firstChance: firstOptions.find((o) => o.type === first.type).weight,
    firstResetCost: [api.honorCost(2, halfHonor), api.mesoCost(2), 0, 1, 0, 0, 0, 0, 0],
    labels: ordered.map((t, i) => api.describe(t, i)),
    continuations: terminal.map((_, mask) => api.guide(ordered, plan, keepMasks[mask])),
  };
  const averages = {};
  const modes = new Set();
  for (const entry of firstOptions) {
    let average = zero();
    for (const [v, p] of entry.values) for (const lowerState of lowerStates) {
      const choice = chooseFlexibleAbilityStart(pair, entry.type, [v, ...lowerState.values]);
      modes.add(choice.mode);
      average = add(average, choice.vector, p * lowerState.probability);
    }
    averages[entry.type] = average;
  }
  return { pair, averages, modes: [...modes] };
}

const ROLL_CACHE = new Map();
// Type acquisition ignores numeric values until both lower types are obtained.
// Keep joint events and conditional first-type distributions (no independent
// marginal approximation). Collision moments use aggregated actual values.
function lowerRolls(targets, lockedMask, api) {
  const key = JSON.stringify([targets.map(({ type, grade }) => [type, grade]), lockedMask]);
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
  const grades = [["legendary", 0.02], ["unique", 0.15], ["epic", 0.83]];
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

function solveState(events, lockedMask, one, pairs, cost) {
  const progress = [];
  for (const event of events) {
    const choices = [];
    for (const keep of subsets(event.mask)) {
      if ((keep & lockedMask) !== lockedMask || keep === lockedMask) continue;
      if (countBits(keep) === 1 && one.has(keep)) choices.push({ keep, vector: one.get(keep).vector });
      if (countBits(keep) === 2 && pairs.has(keep)) {
        let vector = zero();
        for (const [type, p] of Object.entries(event.first)) vector = add(vector, pairs.get(keep).averages[type], p / event.probability);
        choices.push({ keep, vector });
      }
    }
    const choice = best(choices);
    if (choice) progress.push({ ...event, ...choice });
  }
  if (!progress.length) return null;
  const collision = events.reduce((sum, e) => sum + e.collision, 0);
  let chosen;
  for (let accepted = 1; accepted < (1 << progress.length); accepted++) {
    let probability = 0, failureCollision = collision, future = zero();
    progress.forEach((e, i) => {
      if (!(accepted & (1 << i))) return;
      probability += e.probability;
      failureCollision -= e.collision;
      future = add(future, e.vector, e.probability);
    });
    const factor = probability < 1 - 1e-12 ? 1 - Math.max(0, failureCollision) / (1 - probability) : 1;
    const vector = add(future, cost, factor).map((v) => v / probability);
    const candidate = { vector, accepted };
    chosen = best([...(chosen ? [chosen] : []), candidate]);
  }
  const decisions = events.map((e) => {
    const index = progress.findIndex((p) => p.mask === e.mask);
    return { found: e.mask, keep: index >= 0 && (chosen.accepted & (1 << index)) ? progress[index].keep : lockedMask };
  });
  return { ...chosen, decisions };
}

export function calculateFlexibleAbilityCandidate(options, api) {
  const targets = options.targets;
  const count = options.allowAbyss === false ? 0 : Math.max(0, Math.floor(Number(options.abyssCount) || 0));
  const pairs = new Map();
  for (const mask of [3, 5, 6]) {
    if (targets.find((_, i) => !(mask & (1 << i))).grade !== "legendary") continue;
    pairs.set(mask, buildPair(targets, mask, count, api, options.halfHonor));
  }
  const eligible = [...pairs.keys()].reduce((mask, p) => mask | p, 0);
  const one = new Map();
  const cost = (locks) => [api.honorCost(locks, options.halfHonor), api.mesoCost(locks), 0, 1, 0, 0, 0, 0, 0];
  for (const i of bits(eligible)) {
    const mask = 1 << i;
    const solved = solveState(lowerRolls(targets, mask, api), mask, one, pairs, cost(1));
    if (solved) one.set(mask, solved);
  }
  const start = solveState(lowerRolls(targets, 0, api), 0, one, pairs, cost(0));
  if (!start) return null;
  const name = (mask) => bits(mask).map((i) => api.describe(targets[i], -1, true)).join(" + ");
  const rules = (solved, locked = 0) => solved.decisions.filter(({ found }) => found !== locked).map(({ found, keep }) => ({
    label: `아랫줄에 ${name(found & ~locked)}`,
    description: keep === locked ? "새로 나온 옵션은 잠그지 않고 계속 재설정하세요."
      : `${name(keep & ~locked)} 잠금${countBits(keep) === 2 ? " 후 아래 ‘두 줄 확보 후’를 확인하세요." : " 후 다음 줄을 찾으세요."}`,
    steps: [], found, keep,
  }));
  return {
    vector: start.vector,
    flexibleGuide: {
      targets, count,
      start: rules(start),
      one: [...one].map(([mask, solved]) => ({ label: name(mask), mask, rules: rules(solved, mask) })),
      pairs: [...pairs.values()].map(({ pair }) => ({ ...pair, label: name(pair.pairMask) })),
    },
    pairModes: [...pairs].map(([mask, p]) => ({ mask, modes: p.modes })),
  };
}
