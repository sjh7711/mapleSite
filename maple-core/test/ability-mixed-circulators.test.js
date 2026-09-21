import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAbilityOptimalStrategy } from '../src/ability.js';
import { calculateAbilityRouteReach } from '../src/ability-route-reach.js';
import { chaosBeforeBlack } from '../src/ability-mixed-circulators.js';

const zero = () => Array(9).fill(0);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8 * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const options = {
  useAdvanced: false, includePractical: true, swapLower: true, halfHonor: false,
  honorPricePer5000: 3000000, abyssPrice: 200000000,
  blackCount: 7, chaosCount: 6,
  targets: [{ type: 'boss-damage', minimum: 20, grade: 'legendary' },
    { type: 'abnormal-damage', minimum: 8, grade: 'unique' },
    { type: 'attack', minimum: 21, grade: 'unique' }],
};
const calculate = (extra = {}) => calculateAbilityOptimalStrategy({ ...options, ...extra }).practicalStrategy;

test('카서큘은 완성된 줄도 잃을 수 있으며 좋은 기존 상태에서는 사용을 중단한다', () => {
  const states = [{ probability: .8 }, { probability: .2 }];
  const values = [zero(), zero()]; values[0][0] = 100;
  const result = chaosBeforeBlack(states, values, 2, (a, b) => a[0] - b[0], (_, i) => false);
  close(result.stateValues[0][0], 64);
  close(result.stateValues[0][6], 1.8);
  close(result.stateValues[1][0], 0);
  close(result.stateValues[1][6], 0);
  assert.deepEqual(result.actionBands.at(-1).actions, ['chaos', 'black']);
  // A forced redraw has cost 80 even when the old cost was 0. Retaining the
  // better tuple would instead be free and would wrongly consume the item.
});

test('제로 보스용2의 블서큘 7개와 카서큘 6개는 각각의 재고를 사용한다', () => {
  const mixed = calculate(), black = calculate({ chaosCount: 0 });
  close(black.expectedTotalMeso, 12763462273.581068);
  assert.ok(mixed.expectedTotalMeso < black.expectedTotalMeso);
  assert.ok(calculateAbilityOptimalStrategy(options).expectedTotalMeso <= mixed.expectedTotalMeso);
  assert.ok(mixed.expectedCirculators.black > 0 && mixed.expectedCirculators.black <= 7);
  assert.ok(mixed.expectedCirculators.chaos > 0 && mixed.expectedCirculators.chaos <= 6);
  const guide = mixed.steps[0].economicGuide;
  assert.equal(guide.count, 13);
  assert.equal(guide.blackCount, 7);
  assert.equal(guide.chaosCount, 6);
  assert.deepEqual(calculate({ allowChaos: false }).expectedCirculators, black.expectedCirculators);
  close(calculate({ allowChaos: false }).expectedTotalMeso, black.expectedTotalMeso);
  const chaosOnly = calculate({ allowBlack: false });
  assert.equal(chaosOnly.expectedCirculators.black, 0);
  assert.ok(chaosOnly.expectedCirculators.chaos > 0 && chaosOnly.expectedCirculators.chaos <= 6);
  close(chaosOnly.expectedTotalMeso, calculate({ blackCount: 0 }).expectedTotalMeso);
  const none = calculate({ blackCount: 0, chaosCount: 0 });
  assert.equal(none.expectedCirculators.black + none.expectedCirculators.chaos, 0);
  assert.ok(chaosOnly.expectedTotalMeso <= none.expectedTotalMeso);
  assert.ok(mixed.expectedTotalMeso > calculate({ blackCount: 13, chaosCount: 0 }).expectedTotalMeso);
});

test('제로의 카서큘→블서큘 정책은 두 재고의 모든 사용 순서를 비교한 독립 DP와 일치한다', () => {
  for (const [blackCount, chaosCount] of [[0, 6], [7, 1], [7, 6]]) {
    const pair = calculate({ blackCount, chaosCount }).steps[0].economicGuide.pairs[0];
    assert.equal(pair.practical.mode, 'lower');
    for (const model of [pair.full, ...Object.values(pair.models)]) {
      const states = [...new Set(model.states.map((s) => s.mask))].map((mask) => ({ mask,
        probability: model.states.filter((s) => s.mask === mask).reduce((p, s) => p + s.probability, 0) }));
      const costs = states.map((s) => pair.terminal[s.mask][0]);
      const ranks = states.map((s) => pair.practical.maskOrder.indexOf(s.mask & pair.practical.focusMask));
      const table = [];
      for (let black = 0; black <= blackCount; black++) {
        table[black] = [];
        for (let chaos = 0; chaos <= chaosCount; chaos++) {
          const forced = chaos ? states.reduce((v, s, i) => v + s.probability * table[black][chaos - 1][i], 0) : Infinity;
          table[black][chaos] = states.map((s, i) => {
            if ((s.mask & pair.practical.focusMask) === pair.practical.focusMask) return costs[i];
            const choose = black ? states.reduce((v, next, j) => v + next.probability * table[black - 1][chaos][ranks[j] < ranks[i] ? j : i], 0) : costs[i];
            return Math.min(choose, forced);
          });
        }
      }
      for (const [i, s] of states.entries()) {
        const j = model.states.findIndex((t) => t.mask === s.mask);
        close(model.initialValues[j][0], table[blackCount][chaosCount][i]);
      }
    }
  }
});

test('고급 허용의 일반 경로 비교 및 확률 시뮬레이션에도 두 종류를 전달한다', () => {
  const settings = { ...options, useAdvanced: true, comparePlacements: true, includeRouteComparison: true, abyssCount: 50 };
  const result = calculateAbilityOptimalStrategy(settings).practicalStrategy;
  assert.equal(result.advancedUnnecessary, true);
  close(result.expectedTotalMeso, calculate().expectedTotalMeso);
  const reach = calculateAbilityRouteReach(result, settings, { trials: 20000 });
  assert.ok(Math.abs(reach.mean - result.expectedTotalMeso) < 6 * reach.standardError);
  assert.ok(Math.abs(reach.meanBlackUses - result.expectedCirculators.black) < .1);
  assert.ok(Math.abs(reach.meanChaosUses - result.expectedCirculators.chaos) < .1);
  assert.ok(Math.abs(reach.phaseSuccessProbability - result.phaseMetrics.phaseSuccessProbability) < .02);
  assert.ok(Math.abs(reach.exhaustionProbability - result.phaseMetrics.exhaustionProbability) < .02);
  assert.equal(reach.maxBlackUses, 7);
  assert.equal(reach.maxChaosUses, 6);
  assert.equal(reach.maxUses, 13);
  assert.equal(reach.overInventoryProbability, 0);
});
