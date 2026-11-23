import assert from "node:assert/strict";
import test from "node:test";
import { calculateHexaStat, createHexaStatBudget } from "../src/hexa-stat.js";

test("18등급 메인 8레벨은 메인이 두 번 연속 올라야 10레벨로 완성된다", () => {
  const normal = calculateHexaStat({ target: 10 });
  const sunday = calculateHexaStat({ target: 10, event: true });
  assert.ok(Math.abs(normal.chance[18][8] - 0.1 * 0.05) < 1e-12);
  assert.ok(Math.abs(sunday.chance[18][8] - 0.12 * 0.06) < 1e-12);
  assert.equal(normal.fragments[18][8], 62);
  assert.equal(normal.chance[19][8], 0);
  assert.equal(normal.reset[19][8], true);
});

test("즉시 초기화할 코어의 기댓값과 예산별 확률은 새 코어에서 시작하는 값과 같다", () => {
  const result = calculateHexaStat({ target: 10, event: true });
  assert.equal(result.reset[9][1], false);
  assert.ok(Math.abs(result.total[19][8] - result.total[0][0]) < 1e-8);
  const current = createHexaStatBudget(result, 19, 8);
  const fresh = createHexaStatBudget(result, 0, 0);
  assert.equal(current.requiredFragments(0.9), fresh.requiredFragments(0.9));
  assert.equal(current.requiredFragments(1), Infinity);
});

test("목표 확률을 처음 넘는 강화 예산과 유한한 완료 상한을 구한다", () => {
  const result = calculateHexaStat({ target: 9 });
  const budget = createHexaStatBudget(result, 0, 0);
  const required = budget.requiredFragments(0.9);
  assert.ok(budget.probabilityAt(required - 1) < 0.9);
  assert.ok(budget.probabilityAt(required) >= 0.9);
  const oneStep = createHexaStatBudget(result, 19, 10);
  assert.equal(oneStep.requiredFragments(1), 50);
  const completed = createHexaStatBudget(result, 20, 10);
  assert.equal(completed.requiredFragments(1), 0);
});
