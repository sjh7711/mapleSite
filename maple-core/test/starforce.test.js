import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateStarforceExpected,
  getStarforceBaseCost,
  getStarforceAttempt,
} from "../src/starforce.js";

test("0성부터 12성까지의 강화 비용과 시도를 기대값에 포함한다", () => {
  assert.equal(getStarforceBaseCost(200, 0), 223_200);

  const result = calculateStarforceExpected({
    itemLevel: 200,
    startStar: 0,
    targetStar: 13,
  });

  assert.equal(result.stages[0].star, 0);
  assert.equal(result.stages.at(-1).star, 12);
  assert.equal(result.stages.length, 13);
  assert.ok(result.expectedCost > 0);
  assert.ok(result.expectedAttempts > 13);
});

test("스타포스 계산 기본값은 샤이닝 스타포스와 MVP 다이아다", () => {
  const result = calculateStarforceExpected({
    itemLevel: 200,
    startStar: 12,
    targetStar: 13,
  });

  assert.equal(result.event, "shining");
  assert.equal(result.mvp, "diamond");
});

test("2026 개편의 1.05배 성공률을 항상 적용하고 나머지 확률을 보존한다", () => {
  const attempt = getStarforceAttempt({
    itemLevel: 200,
    star: 17,
  });

  assert.equal(attempt.success, 0.1575);
  assert.ok(Math.abs(attempt.success + attempt.fail + attempt.destroy - 1) < 1e-12);
  assert.ok(attempt.destroy < 0.068);
});

test("파괴확률 30% 감소 이벤트는 감소분을 실패 확률로 옮긴다", () => {
  const normal = getStarforceAttempt({
    itemLevel: 200,
    star: 20,
  });
  const event = getStarforceAttempt({
    itemLevel: 200,
    star: 20,
    event: "destroy30",
  });

  assert.equal(event.destroy, normal.destroy * 0.7);
  assert.ok(Math.abs(event.fail - (normal.fail + normal.destroy * 0.3)) < 1e-12);
});

test("15~17성 파괴방지는 파괴를 없애고 기본 비용의 200%를 더한다", () => {
  const normal = getStarforceAttempt({
    itemLevel: 200,
    star: 17,
  });
  const safe = getStarforceAttempt({
    itemLevel: 200,
    star: 17,
    safeguard: true,
  });

  assert.equal(safe.destroy, 0);
  assert.equal(safe.cost, normal.cost + normal.baseCost * 2);
  assert.ok(Math.abs(safe.fail - (normal.fail + normal.destroy)) < 1e-12);
});

test("파괴 장비 가격이 높을수록 스타포스 기대비용이 증가한다", () => {
  const common = {
    itemLevel: 200,
    startStar: 17,
    targetStar: 22,
  };
  const freeReplacement = calculateStarforceExpected(common);
  const expensiveReplacement = calculateStarforceExpected({
    ...common,
    replacementPrice: 5_000_000_000,
  });

  assert.ok(freeReplacement.expectedCost > 0);
  assert.ok(freeReplacement.expectedBooms > 0);
  assert.ok(expensiveReplacement.expectedCost > freeReplacement.expectedCost);
});

test("고가 장비는 성급에 따라 확정 복구나 파괴 방지를 자동 선택한다", () => {
  const result = calculateStarforceExpected({
    itemLevel: 200,
    startStar: 15,
    targetStar: 23,
    replacementPrice: 20_000_000_000,
    event: "none",
    mvp: "none",
  });

  assert.ok(result.stages.some((stage) => stage.policy === "확정 복구"));
  assert.ok(result.stages.some((stage) => stage.policy === "파괴 방지"));
  assert.ok(result.expectedEquipment > result.expectedBooms);
});

test("18성 이상에서 시작해도 파괴 후 복구 경로의 파괴 방지 전략을 제공한다", () => {
  const result = calculateStarforceExpected({
    itemLevel: 200,
    startStar: 18,
    targetStar: 22,
    replacementPrice: 20_000_000_000,
    event: "none",
    mvp: "none",
  });

  assert.equal(result.stages[0].star, 18);
  assert.ok(result.stages.every((stage) => stage.star >= 18));
  assert.deepEqual(
    result.strategyStages
      .filter((stage) => stage.safeguarded)
      .map((stage) => stage.star),
    [15, 16, 17],
  );
});

test("수동 22성 확정복구는 23성 이상에서 파괴되어 생긴 22성 흔적에도 적용한다", () => {
  const result = calculateStarforceExpected({
    itemLevel: 200,
    startStar: 22,
    targetStar: 24,
    replacementPrice: 4_500_000_000,
    event: "shining",
    mvp: "diamond",
    optimize: false,
    restore: [22],
  });

  assert.equal(result.stages[0].policy, "확정 복구");
  assert.equal(result.stages[1].policy, "22성 확정 복구");
  assert.ok(Math.abs(result.expectedEquipment - 18.39371126228269) < 1e-10);
});
