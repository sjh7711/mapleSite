import assert from "node:assert/strict";
import test from "node:test";
import { calculateAbilityOptimalStrategy } from "../src/ability.js";

const options = {
  패: { type: "passive-level", minimum: 1, grade: "legendary" },
  보: { type: "boss-damage", minimum: 20, grade: "legendary" },
  상: { type: "abnormal-damage", minimum: 10, grade: "legendary" },
};
const targets = (order) => [...order].map((key) => ({ ...options[key] }));
const calculate = (order, settings = {}) => calculateAbilityOptimalStrategy({
  useAdvanced: true, targets: targets(order), ...settings,
});
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) <= Math.max(1, Math.abs(expected)) * 1e-9);
const identities = (entries) => entries.map(({ type, grade, minimum }) => `${type}:${grade}:${minimum}`).sort();

test("패보상·보패상·상패보는 동일 목표를 유지한 더 저렴한 배치를 추천한다", () => {
  const fixedBest = calculate("보패상");
  for (const order of ["패보상", "보패상", "상패보"]) {
    const input = targets(order);
    const original = structuredClone(input);
    const result = calculateAbilityOptimalStrategy({ targets: input, useAdvanced: true, comparePlacements: true });
    assert.equal(result.error, null);
    assert.deepEqual(input, original, "추천이 입력한 배치를 자동 변경하면 안 된다");
    close(result.expectedHonor, fixedBest.expectedHonor);
    close(result.expectedMeso, fixedBest.expectedMeso);
    const recommendation = result.placementRecommendation;
    if (order === "보패상") {
      assert.equal(recommendation, undefined);
    } else {
      assert.deepEqual(identities(recommendation.recommendedTargets), identities(input));
      assert.deepEqual(recommendation.recommendedTargets.map(({ type }) => type), targets("보패상").map(({ type }) => type));
      const previous = calculate(order);
      close(recommendation.currentExpectedHonor, previous.expectedHonor);
      close(recommendation.honorSaved, previous.expectedHonor - result.expectedHonor);
      close(recommendation.mesoSaved, previous.expectedMeso - result.expectedMeso);
      const applied = calculateAbilityOptimalStrategy({ useAdvanced: true, targets: recommendation.recommendedTargets });
      assert.deepEqual(result.steps, applied.steps, "표시한 진행 순서는 추천한 배치의 순서여야 한다");
    }
  }
});

test("서큘레이터 허용·재고·반값과 줄 순서 설정을 동일하게 유지한 채 배치를 비교한다", () => {
  const settings = { swapLower: false, halfHonor: true, miracleCount: 3, blackCount: 5, chaosCount: 7, allowBlack: false };
  const permutations = ["패보상", "패상보", "보패상", "보상패", "상패보", "상보패"];
  const fixed = permutations.map((order) => calculate(order, settings));
  const bestHonor = Math.min(...fixed.map((result) => result.expectedHonor));
  const compared = calculate("상패보", { ...settings, comparePlacements: true });
  close(compared.expectedHonor, bestHonor);
  assert.deepEqual(compared.inventory, { miracle: 3, black: 0, chaos: 7 });
  assert.equal(compared.expectedCirculators.black, 0);
  assert.ok(compared.expectedCirculators.miracle <= 3 && compared.expectedCirculators.chaos <= 7);
  const applied = calculateAbilityOptimalStrategy({
    ...settings, useAdvanced: true, targets: compared.placementRecommendation.recommendedTargets,
  });
  close(compared.expectedHonor, applied.expectedHonor);
  close(compared.expectedMeso, applied.expectedMeso);
});

test("유니크 목표를 첫 줄 레전드리로 바꾸지 않고 등급과 사용자 수치를 보존한다", () => {
  const input = [options.패, { ...options.보, minimum: 17 }, { ...options.상, minimum: 8, grade: "unique" }];
  const result = calculateAbilityOptimalStrategy({ useAdvanced: true, comparePlacements: true, targets: input });
  const recommended = result.placementRecommendation?.recommendedTargets ?? input;
  assert.deepEqual(identities(recommended), identities(input));
  assert.equal(recommended[0].grade, "legendary");
  assert.equal(recommended.find(({ type }) => type === "boss-damage").minimum, 17);
  assert.equal(recommended.find(({ type }) => type === "abnormal-damage").grade, "unique");
});

test("아랫줄 순서만 같은 비용으로 바뀌거나 고급 OFF·목표 미완성·잠금 상태이면 불필요한 배치를 추천하지 않는다", () => {
  for (const order of ["보패상", "보상패"]) {
    assert.equal(calculate(order, { comparePlacements: true }).placementRecommendation, undefined);
  }
  const normal = { useAdvanced: false, targets: [{ type: "boss-damage", minimum: 20 }] };
  assert.deepEqual(calculateAbilityOptimalStrategy({ ...normal, comparePlacements: true }), calculateAbilityOptimalStrategy(normal));
  for (const input of [
    [options.패, options.보],
    [{ ...options.패, locked: true }, options.보, options.상],
    [options.패, options.패, options.상],
    [],
  ]) {
    assert.equal(calculateAbilityOptimalStrategy({ useAdvanced: true, comparePlacements: true, targets: input }).placementRecommendation, undefined);
  }
});
