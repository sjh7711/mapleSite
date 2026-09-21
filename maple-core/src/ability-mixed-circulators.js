const add = (a, b, p = 1) => Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? 0) + (b[i] ?? 0) * p);

// Chaos replaces the entire tuple, including completed lines. Compare another
// Chaos use with switching permanently to the reserved Black stock. This is a
// finite-stock, two-phase practical policy; no Chaos item is treated as Black.
export function chaosBeforeBlack(states, blackValues, count, compare, complete) {
  let values = blackValues;
  const actionBands = [{ remaining: 0, actions: states.map(() => "black") }];
  for (let remaining = 1; remaining <= count; remaining++) {
    const rolled = states.reduce((sum, s, i) => add(sum, values[i], s.probability), Array(9).fill(0));
    rolled[6]++;
    const actions = states.map((s, i) => !complete(s) && compare(rolled, blackValues[i]) < 0 ? "chaos" : "black");
    values = actions.map((action, i) => {
      if (action === "chaos") return rolled;
      const next = [...blackValues[i]];
      // Switching early leaves Chaos stock unused, so a subsequent failed
      // Black phase is not exhaustion of the entire entered inventory.
      if (next.length > 9) next.fill(0, 10, 13);
      return next;
    });
    if (actions.some((action, i) => action !== actionBands.at(-1).actions[i])) actionBands.push({ remaining, actions });
  }
  return { stateValues: values, actionBands, count };
}

export function addPracticalChaosStock(pair, api) {
  const count = api.chaosCount;
  if (!count || !pair.practical || pair.method !== "honor") return pair;
  const focus = pair.practical.focusMask, complete = (s) => (s.mask & focus) === focus;
  const extend = (model) => {
    model.chaos = chaosBeforeBlack(model.states, model.stateValues, count, api.compare, complete);
    model.initialValues = model.chaos.stateValues;
  };
  extend(pair.full);
  for (const [profile, model] of Object.entries(pair.models)) {
    if (pair.practical.mode === "lower") { extend(model); continue; }
    const goal = pair.firstOptions.find((o) => o.type === pair.targets[0].type);
    // Obtain the first type before using either stock in the three-line policy.
    model.initialValues = model.states.map((s) => {
      const future = goal.values.reduce((sum, [value, p]) => {
        const i = pair.full.states.findIndex((t) => t.values[0] === value && t.values[1] === s.values[1] && t.values[2] === s.values[2]);
        return add(sum, pair.full.initialValues[i], p);
      }, Array(9).fill(0));
      return add(future, api.resetCost(2), 1 / goal.weight);
    });
  }
  return { ...pair, mixed: true, blackCount: pair.count, chaosCount: count, count: pair.count + count };
}
