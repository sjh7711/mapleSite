// A small economic advantage should not make the practical guide discard an
// otherwise better tuple. Only Pareto improvements qualify: no value decreases.
// This strict meso limit is a user-selected preference, not a game probability.
const MAX_COST_DIFFERENCE = 100_000_000;

export function abilityResultApplies(model, oldIndex, newIndex, remaining = 0) {
  if (model.acceptedResults) return model.acceptedResults[oldIndex].includes(newIndex);
  const band = model.policyBands.findLast((b) => b.remaining <= remaining) ?? model.policyBands[0];
  return band.ranks[newIndex] < band.ranks[oldIndex];
}

// Evaluate the complete stationary policy, including revisits. Displayed route
// means and simulations must use the same result choices as the on-screen guide.
function evaluate(states, accepted, actions, stops, api) {
  const size = states.length, metrics = stops[0].vector.length;
  const rows = states.map((state, i) => {
    const row = new Float64Array(size + metrics);
    if (actions[i] !== 'roll') {
      row[i] = 1;
      stops[i].vector.forEach((v, k) => { row[size + k] = v; });
    } else {
      for (const j of accepted[i]) {
        row[i] += states[j].probability;
        row[j] -= states[j].probability;
      }
      row[size + api.itemIndex] = api.method === 'advanced' ? 1 - state.probability : 1;
    }
    return row;
  });
  for (let k = 0; k < size; k++) {
    let pivot = k;
    for (let i = k + 1; i < size; i++) if (Math.abs(rows[i][k]) > Math.abs(rows[pivot][k])) pivot = i;
    if (Math.abs(rows[pivot][k]) < 1e-14) throw new Error('수치 개선 경로의 기대비용을 계산할 수 없습니다.');
    [rows[k], rows[pivot]] = [rows[pivot], rows[k]];
    const divisor = rows[k][k];
    for (let j = k; j < size + metrics; j++) rows[k][j] /= divisor;
    for (let i = k + 1; i < size; i++) {
      const factor = rows[i][k];
      if (!factor) continue;
      rows[i][k] = 0;
      for (let j = k + 1; j < size + metrics; j++) rows[i][j] -= factor * rows[k][j];
    }
  }
  const values = Array(size);
  for (let i = size - 1; i >= 0; i--) {
    values[i] = Array.from(rows[i].slice(size));
    for (let j = i + 1; j < size; j++) {
      if (!rows[i][j]) continue;
      for (let k = 0; k < metrics; k++) values[i][k] -= rows[i][j] * values[j][k];
    }
    values[i] = values[i].map((v) => Math.max(0, v));
  }
  return values;
}

export function preferImprovedAbilityResults(model, api, stops, complete) {
  const { states } = model, ranks = model.policyBands[0].ranks;
  const score = api.cost ?? ((v) => api.compare(v, Array(v.length).fill(0)));
  const closeCosts = (a, b) => Math.abs(a - b) < MAX_COST_DIFFERENCE;
  const resultValues = states.map((s) => api.resultValues?.(s) ?? s.values);
  const costs = model.stateValues.map(score);
  const accepted = states.map((_, i) => states.map((__, j) => ranks[j] < ranks[i]));
  let changed = false;
  for (let i = 0; i < states.length; i++) for (let j = i + 1; j < states.length; j++) {
    // A completed target always wins, regardless of cost ties or free items.
    if (complete(states[i]) || complete(states[j])) continue;
    const up = resultValues[j].every((v, k) => v >= resultValues[i][k]);
    const down = resultValues[i].every((v, k) => v >= resultValues[j][k]);
    if (up === down) continue;
    if (!closeCosts(costs[i], costs[j])) continue;
    if (accepted[i][j] !== up || accepted[j][i] !== down) changed = true;
    accepted[i][j] = up;
    accepted[j][i] = down;
  }
  if (!changed) return model;
  let acceptedResults = accepted.map((row) => row.flatMap((yes, j) => yes ? [j] : []));
  // The revised acceptance graph may remove a state's former exit. Starting
  // with the available stopping actions keeps every policy evaluation proper.
  let actions = stops.map((s) => s.action), values;
  // Reconsider honor completion after changing result selection. Result choices
  // stay fixed during each policy evaluation. A preference that becomes costly
  // under repeated use is removed permanently before reevaluating the policy.
  for (let iteration = 0; iteration < 100; iteration++) {
    values = evaluate(states, acceptedResults, actions, stops, api);
    const rolling = [];
    const next = states.map((s, i) => {
      if (complete(s) || !acceptedResults[i].length) return stops[i].action;
      const mass = acceptedResults[i].reduce((p, j) => p + states[j].probability, 0);
      const rolled = Array(values[i].length).fill(0);
      rolled[api.itemIndex] = api.method === 'advanced' ? 1 - s.probability : 1;
      for (const j of acceptedResults[i]) values[j].forEach((v, k) => { rolled[k] += states[j].probability * v; });
      rolling[i] = rolled.map((v) => v / mass);
      return api.compare(rolling[i], stops[i].vector) < 0 ? 'roll' : stops[i].action;
    });
    if (next.every((a, i) => a === actions[i])) {
      const updatedCosts = values.map(score);
      let pruned = false;
      for (let i = 0; i < states.length; i++) for (let j = i + 1; j < states.length; j++) {
        if (accepted[i][j] === (ranks[j] < ranks[i]) && accepted[j][i] === (ranks[i] < ranks[j])) continue;
        if (closeCosts(updatedCosts[i], updatedCosts[j])) continue;
        accepted[i][j] = ranks[j] < ranks[i]; accepted[j][i] = ranks[i] < ranks[j]; pruned = true;
      }
      if (pruned) {
        acceptedResults = accepted.map((row) => row.flatMap((yes, j) => yes ? [j] : []));
        continue;
      }
      const residual = Math.max(...values.flatMap((v, i) => {
        const expected = actions[i] === 'roll' ? rolling[i] : stops[i].vector;
        return v.map((x, k) => Math.abs(x - expected[k]) / Math.max(1, Math.abs(x)));
      }));
      return { ...model, stateValues: values, levels: [values], residual,
        acceptedResults, actionBands: [{ remaining: 0, actions }],
        valuePreference: { maxCostDifference: MAX_COST_DIFFERENCE, exclusive: true } };
    }
    actions = next;
  }
  throw new Error('수치 개선 경로의 계산이 수렴하지 않았습니다.');
}
