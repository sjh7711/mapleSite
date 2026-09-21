import assert from 'node:assert/strict';
import test from 'node:test';
import { abilityResultApplies, preferImprovedAbilityResults } from '../src/ability-result-preference.js';
import { chooseAbilityAbyssResult } from '../src/ability.js';

const vector = (cost) => [0, cost, 0, 0, 0, 0, 0, 0, 0];
function fixture(newCost = 100050, newValues = [2, 1, 1]) {
  const states = [{ values: [1, 1, 1], probability: .4, mask: 0 },
    { values: newValues, probability: .59, mask: 1 }, { values: [2, 2, 1], probability: .01, mask: 7 }];
  const model = { states, stateValues: [vector(100000), vector(newCost), vector(0)],
    policyBands: [{ remaining: 0, ranks: [1, 2, 0] }], actionBands: [{ remaining: 0, actions: ['roll', 'roll', 'direct'] }] };
  const api = { method: 'advanced', abyssPrice: 1000, itemIndex: 7,
    cost: (v) => v[1] + v[7] * api.abyssPrice, compare: (a, b) => api.cost(a) - api.cost(b) };
  const stops = states.map((s) => ({ action: 'direct', vector: vector(s.mask === 7 ? 0 : 1e9) }));
  return { model, api, stops, revised: preferImprovedAbilityResults(model, api, stops, (s) => s.mask === 7) };
}
test('미미한 비용 차이에서는 모든 수치가 같거나 좋아진 결과를 적용하고 역행하지 않는다', () => {
  const { revised } = fixture();
  assert.equal(abilityResultApplies(revised, 0, 1), true);
  assert.equal(abilityResultApplies(revised, 1, 0), false);
  assert.equal(abilityResultApplies(revised, 0, 2), true);
  assert.equal(abilityResultApplies(revised, 2, 0), false);
  const guide = { ...revised, unlimited: true, keepMasks: [0, 1, 2, 3, 4, 5, 6, 7] };
  assert.equal(chooseAbilityAbyssResult(guide, [1, 1, 1], [2, 1, 1], 0).apply, true);
  assert.equal(chooseAbilityAbyssResult(guide, [2, 1, 1], [1, 1, 1], 0).apply, false);
});
test('변경된 선택 정책의 기댓값은 독립적인 매 회차 확률 합산과 일치한다', () => {
  const { revised: m, stops, api } = fixture();
  let costs = m.states.map(() => 0);
  for (let n = 0; n < 2500; n++) costs = m.states.map((s, i) => {
    if (m.actionBands[0].actions[i] === 'direct') return api.cost(stops[i].vector);
    let value = api.abyssPrice;
    m.states.forEach((proposal, j) => {
      if (i !== j) value += proposal.probability / (1 - s.probability)
        * costs[m.acceptedResults[i].includes(j) ? j : i];
    });
    return value;
  });
  costs.forEach((value, i) => assert.ok(Math.abs(value - api.cost(m.stateValues[i])) < 1e-6));
});
test('1억 이상의 비용 차이나 일부 수치가 떨어지는 교환에는 수치 개선 우선 규칙을 적용하지 않는다', () => {
  for (const f of [fixture(100000 + 100_000_000), fixture(100000 + 100_000_001), fixture(100050, [2, 0, 1])]) {
    assert.equal(f.revised, f.model);
    assert.equal(abilityResultApplies(f.revised, 0, 1), false);
  }
});
test('1억보다 1메소 적으면 총비용 비율과 심서큘 가격에 관계없이 수치 개선을 우선한다', () => {
  const { revised } = fixture(100000 + 99_999_999);
  assert.equal(abilityResultApplies(revised, 0, 1), true);
  assert.equal(revised.valuePreference.maxCostDifference, 100_000_000);
  assert.equal(revised.valuePreference.exclusive, true);
});
test('반복 선택을 반영한 비용 차이가 기준을 넘으면 해당 우선 선택을 철회한다', () => {
  const { model, api, stops } = fixture();
  model.states[0].probability = .1; model.states[1].probability = .89;
  api.abyssPrice = 200_000_000;
  stops[0].vector = vector(100e9); stops[1].vector = vector(100e9);
  const result = preferImprovedAbilityResults(model, api, stops, (s) => s.mask === 7);
  assert.equal(abilityResultApplies(result, 0, 1), false);
  assert.equal(abilityResultApplies(result, 1, 0), true);
  assert.ok(result.residual < 1e-10);
});
test('목표 외 첫 줄은 배열 인덱스가 아닌 실제 수치의 상승을 비교한다', () => {
  const { model, api, stops } = fixture();
  model.states[0].values[0] = 1; model.states[1].values[0] = 0;
  api.resultValues = (s) => [s.values[0] === 0 ? 10 : 5, ...s.values.slice(1)];
  const result = preferImprovedAbilityResults(model, api, stops, (s) => s.mask === 7);
  assert.equal(abilityResultApplies(result, 0, 1), true);
  assert.equal(abilityResultApplies(result, 1, 0), false);
});
test('이전 선택 경로의 출구가 사라지면 명성치 마무리부터 안전하게 재평가한다', () => {
  const { model, api, stops } = fixture();
  model.states = model.states.slice(0, 2).map((s) => ({ ...s, probability: .5 }));
  model.stateValues = model.stateValues.slice(0, 2);
  model.policyBands[0].ranks = [0, 1];
  model.actionBands[0].actions = ['direct', 'roll'];
  const result = preferImprovedAbilityResults(model, api, stops.slice(0, 2), () => false);
  assert.equal(abilityResultApplies(result, 0, 1), true);
  assert.deepEqual(result.actionBands[0].actions, ['direct', 'direct']);
  assert.ok(result.stateValues.flat().every(Number.isFinite));
});
