import assert from 'node:assert/strict';
import test from 'node:test';
import { createAbilityRouteSimulationApi } from '../src/ability.js';
import { calculateAbilityEconomicCandidate, calculateAbilityUnlimitedCandidate, compareAbilityVectors } from '../src/ability-economy.js';
import { calculateAbilityRouteReach, abilityRouteCostForChance, abilityRouteUsesForChance, abilityRouteBreakdownForChance, abilityRouteFinishCostForChance } from '../src/ability-route-reach.js';

const settings = { honorPricePer5000: 3000000, abyssPrice: 220000000, halfHonor: false };
const bow = [['passive-level', 1], ['boss-damage', 20], ['critical', 30]].map(([type, minimum]) => ({ type, minimum, grade: 'legendary' }));
function candidate(targets, method, count, unlimited = false, halfHonor = false) {
  const setup = { ...settings, halfHonor }, base = createAbilityRouteSimulationApi(method, setup);
  const api = { ...base, count, itemMethod: method === 'advanced' ? 'abyss' : 'black', itemIndex: method === 'advanced' ? 7 : 5,
    abyssPrice: setup.abyssPrice,
    cost: (v) => v[0] * setup.honorPricePer5000 / 5000 + v[1] + v[7] * setup.abyssPrice,
    practicalMode: unlimited ? undefined : 'all', compare: (a, b) => compareAbilityVectors(a, b, setup.honorPricePer5000, setup.abyssPrice),
    resetCost: (n) => [...base.resetCost(n), method === 'honor' ? 1 : 0, method === 'advanced' ? 1 : 0, 0, 0, 0, 0, 0],
    vector: (p, m) => [p.expectedHonorByMask[m], p.expectedMesoByMask[m], 0, 0, 0, 0, 0, 0, 0],
    shortName: (t) => t.type, unit: () => '', describe: (t) => t.type, guide: () => ({}) };
  const c = unlimited ? calculateAbilityUnlimitedCandidate({ targets }, api) : calculateAbilityEconomicCandidate({ targets }, api);
  return { result: { expectedTotalMeso: c.vector[0] * 600 + c.vector[1] + c.vector[7] * setup.abyssPrice,
    inventory: { abyss: count, black: count }, steps: [{ economicGuide: c.guide }] }, vector: c.vector, setup };
}
function agrees(result, reach) {
  assert.ok(Math.abs(reach.mean - result.expectedTotalMeso) < 6 * reach.standardError + 1,
    `sample ${reach.mean} != expectation ${result.expectedTotalMeso}`);
  for (let i = 1; i < reach.quantiles.length; i++) assert.ok(reach.quantiles[i] >= reach.quantiles[i - 1]);
  assert.ok(reach.averageChance >= 0 && reach.averageChance <= 1);
  assert.equal(abilityRouteCostForChance(reach, .9), reach.quantiles[9000]);
  assert.equal(reach.useQuantiles.length, 10001);
  for (let i = 0; i < reach.useQuantiles.length; i++) {
    assert.ok(Number.isInteger(reach.useQuantiles[i]) && reach.useQuantiles[i] >= 0);
    if (i) assert.ok(reach.useQuantiles[i] >= reach.useQuantiles[i - 1]);
  }
  assert.equal(abilityRouteUsesForChance(reach, 1), reach.maxUses);
  assert.equal(abilityRouteUsesForChance(reach, .9), reach.useQuantiles[9000]);
  assert.equal(reach.finishSampleCount, Math.round(reach.exhaustionProbability * reach.trials));
  if (reach.finishSampleCount) {
    assert.equal(reach.conditionalFinishQuantiles.length, 10001);
    const q = reach.conditionalFinishQuantiles;
    for (let i = 0; i <= 10000; i++) {
      assert.ok(Number.isFinite(q[i]) && q[i] >= 0);
      if (i) assert.ok(q[i] >= q[i - 1]);
    }
    assert.ok(reach.conditionalFinishMeso >= q[0] && reach.conditionalFinishMeso <= q[10000]);
    assert.equal(abilityRouteFinishCostForChance(reach, .9), q[9000]);
  } else {
    assert.equal(reach.conditionalFinishQuantiles, null);
    assert.equal(abilityRouteFinishCostForChance(reach, .9), null);
  }
  const guide = result.steps[0].economicGuide;
  for (let i = 0; i <= 10000; i++) {
    const breakdown = abilityRouteBreakdownForChance(reach, i / 10000);
    assert.equal(breakdown.totalMeso, reach.quantiles[i]);
    const sum = breakdown.honorMeso + breakdown.resetMeso + breakdown.abyssMeso;
    assert.ok(Math.abs(sum - breakdown.totalMeso) <= Math.max(1e-6, sum * 1e-12));
    assert.ok(Object.values(breakdown).every((value) => value >= 0));
    if (guide.itemMethod === 'abyss') {
      const uses = breakdown.abyssMeso / settings.abyssPrice;
      assert.ok(Number.isInteger(uses));
      if (!guide.unlimited) assert.ok(uses <= guide.count);
    } else assert.equal(breakdown.abyssMeso, 0);
  }
}
test('유한 경로는 실제 보유량에서 멈추고 남은 상태의 명성치 마무리 비용을 포함한다', () => {
  const { result, setup } = candidate(bow, 'advanced', 100);
  const reach = calculateAbilityRouteReach(result, setup, { trials: 20000 });
  agrees(result, reach);
  assert.equal(reach.maxUses, 100);
  assert.equal(reach.overInventoryProbability, 0);
  assert.ok(reach.exhaustionProbability > 0 && reach.conditionalFinishMeso > 0);
  // Successful trials must not dilute this conditional distribution with zeros.
  assert.ok(abilityRouteFinishCostForChance(reach, 0) > 0);
  assert.ok(abilityRouteFinishCostForChance(reach, .9) > abilityRouteFinishCostForChance(reach, .5));
  assert.ok(abilityRouteFinishCostForChance(reach, .99) > abilityRouteFinishCostForChance(reach, .9));
  assert.ok(Math.abs(reach.phaseSuccessProbability + reach.exhaustionProbability - 1) < 1e-10);
  assert.ok(abilityRouteUsesForChance(reach, .5) <= 100);
  assert.equal(abilityRouteUsesForChance(reach, .9999), 100);
  assert.equal(calculateAbilityRouteReach(result, setup, { trials: 1000, seed: 7 }).mean,
    calculateAbilityRouteReach(result, setup, { trials: 1000, seed: 7 }).mean);
});
test('무제한 정책과 비용은 입력 보유량에 의존하지 않고 100개 초과 꼬리를 유지한다', () => {
  const a = candidate(bow, 'advanced', 0, true), b = candidate(bow, 'advanced', 100, true);
  assert.deepEqual(a.vector, b.vector);
  assert.equal(a.result.steps[0].economicGuide.count, null);
  const reach = calculateAbilityRouteReach(b.result, b.setup, { trials: 20000 });
  agrees(b.result, reach);
  assert.ok(reach.maxUses > 100 && reach.overInventoryProbability > .2);
  // More than 20% exceed 100 uses, so the 80th percentile must exceed 100.
  assert.ok(abilityRouteUsesForChance(reach, .8) > 100);
  assert.ok(abilityRouteUsesForChance(reach, .99) > abilityRouteUsesForChance(reach, .9));
  assert.ok(abilityRouteUsesForChance(reach, .9) > reach.meanUses);
  assert.equal(reach.exhaustionProbability, 0);
  assert.equal(reach.conditionalFinishMeso, null);
  assert.equal(abilityRouteFinishCostForChance(reach, .99), null);
  assert.equal(a.result.steps[0].economicGuide.unlimited, true);
  const m = a.result.steps[0].economicGuide.pairs.find((p) => p.pairMask === 3).full;
  const old = m.states.findIndex((s) => s.values.join() === '25,1,15');
  const next = m.states.findIndex((s) => s.values.join() === '29,1,20');
  assert.ok(m.acceptedResults[old].includes(next));
  assert.ok(!m.acceptedResults[next].includes(old));
});
test('0개, 일반 블서큘, 반값 명성치도 별도 확률/비용으로 처리한다', () => {
  const normal = bow.map((t, i) => i ? { ...t, grade: 'unique', minimum: i === 1 ? 10 : 20 } : { type: 'boss-damage', minimum: 20, grade: 'legendary' });
  normal[1] = { type: 'abnormal-damage', minimum: 8, grade: 'unique' };
  for (const [targets, method, count] of [[bow, 'advanced', 0], [normal, 'honor', 4]]) {
    const { result, setup } = candidate(targets, method, count, false, true);
    const reach = calculateAbilityRouteReach(result, setup, { trials: 10000 });
    agrees(result, reach);
    assert.ok(reach.maxUses <= count);
    assert.ok(abilityRouteUsesForChance(reach, .99) <= count);
    if (count === 0) {
      assert.equal(reach.meanUses, 0); assert.equal(reach.conditionalFinishMeso, null);
      assert.ok(reach.useQuantiles.every((count) => count === 0));
      const free = calculateAbilityRouteReach(result, { ...setup, honorPricePer5000: 0, abyssPrice: 0 }, { trials: 1000 });
      for (const chance of [0, .5, .9, 1]) {
        const breakdown = abilityRouteBreakdownForChance(free, chance);
        assert.equal(breakdown.honorMeso, 0); assert.equal(breakdown.abyssMeso, 0);
        assert.equal(breakdown.totalMeso, breakdown.resetMeso);
      }
    }
  }
});

test('총비용 구성은 같은 확률 위치의 지출을 조회하고 불완전한 자료를 거부한다', () => {
  const reach = { quantiles: Float64Array.from({ length: 10001 }, (_, i) => i + 30), costBreakdowns: {
    honorMeso: Float64Array.from({ length: 10001 }, (_, i) => i),
    resetMeso: new Float64Array(10001).fill(10), abyssMeso: new Float64Array(10001).fill(20) } };
  assert.deepEqual(abilityRouteBreakdownForChance(reach, .9), { totalMeso: 9030, honorMeso: 9000, resetMeso: 10, abyssMeso: 20 });
  assert.equal(abilityRouteBreakdownForChance(reach, -.1).totalMeso, 30);
  assert.equal(abilityRouteBreakdownForChance(reach, 1.1).totalMeso, 10030);
  assert.equal(abilityRouteBreakdownForChance(null, .9), null);
  assert.equal(abilityRouteBreakdownForChance(reach, NaN), null);
  assert.equal(abilityRouteBreakdownForChance(reach, Infinity), null);
  assert.equal(abilityRouteBreakdownForChance({ quantiles: reach.quantiles }, .9), null);
  assert.equal(abilityRouteBreakdownForChance({ ...reach, costBreakdowns: { honorMeso: reach.costBreakdowns.honorMeso } }, .9), null);
});

test('심서큘 사용량 확률은 비용 분포와 독립적으로 조회하고 경곗값을 처리한다', () => {
  const reach = { quantiles: Float64Array.from({ length: 10001 }, (_, i) => i * 1000000),
    useQuantiles: Float64Array.from({ length: 10001 }, (_, i) => i < 9000 ? 0 : 50) };
  assert.equal(abilityRouteUsesForChance(reach, .8999), 0);
  assert.equal(abilityRouteUsesForChance(reach, .9), 50);
  assert.equal(abilityRouteUsesForChance(reach, -.1), 0);
  assert.equal(abilityRouteUsesForChance(reach, 1.1), 50);
  assert.equal(abilityRouteUsesForChance(reach, NaN), null);
  assert.equal(abilityRouteUsesForChance(reach, Infinity), null);
  assert.equal(abilityRouteUsesForChance(null, .9), null);
  assert.equal(abilityRouteUsesForChance({ quantiles: reach.quantiles }, .9), null);
});

test('소진 후 비용은 소진 사례의 분포만 조회하고 0원과 사례 없음을 구분한다', () => {
  const reach = { quantiles: new Float64Array(10001).fill(123),
    conditionalFinishQuantiles: Float64Array.from({ length: 10001 }, (_, i) => i * 5000) };
  assert.equal(abilityRouteFinishCostForChance(reach, .9), 45000000);
  assert.equal(abilityRouteFinishCostForChance(reach, -.1), 0);
  assert.equal(abilityRouteFinishCostForChance(reach, 1.1), 50000000);
  assert.equal(abilityRouteFinishCostForChance({ conditionalFinishQuantiles: new Float64Array(10001) }, .9), 0);
  assert.equal(abilityRouteFinishCostForChance({ ...reach, conditionalFinishQuantiles: null }, .9), null);
  assert.equal(abilityRouteFinishCostForChance({ ...reach, conditionalFinishQuantiles: [] }, .9), null);
  assert.equal(abilityRouteFinishCostForChance(reach, NaN), null);
  assert.equal(abilityRouteFinishCostForChance(reach, Infinity), null);
  assert.equal(abilityRouteFinishCostForChance(null, .9), null);
});
