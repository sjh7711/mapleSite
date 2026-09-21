import assert from "node:assert/strict";
import test from "node:test";
import { calculateAbilityOptimalStrategy as calculate, chooseFlexibleAbilityStart, chooseAbilityAbyssResult } from "../src/ability.js";

const targets = [
  { type: "passive-level", minimum: 1, grade: "legendary" },
  { type: "boss-damage", minimum: 20, grade: "legendary" },
  { type: "abnormal-damage", minimum: 10, grade: "legendary" },
];
const options = { targets, useAdvanced: true, comparePlacements: true, flexiblePlacement: true, abyssCount: 40 };
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < Math.max(1, Math.abs(b)) * tolerance, `${a} != ${b}`);
let result;

test("유연한 배치는 동일 목표·보유량을 유지하며 고정 배치보다 적은 명성치를 사용한다", () => {
  const original = structuredClone(targets);
  const fixed = calculate({ ...options, flexiblePlacement: false });
  result = calculate(options);
  assert.equal(result.strategyMode, "flexible-lower-acquisition");
  assert.equal(result.placementRecommendation, undefined);
  assert.ok(result.expectedHonor < fixed.expectedHonor);
  assert.deepEqual(targets, original);
  assert.ok(result.expectedCirculators.abyss > 0 && result.expectedCirculators.abyss <= 40);
  close(result.expectedHonorResets, result.expectedNormalResets + result.expectedAdvancedResets);
  for (const pair of result.steps[0].flexibleGuide.pairs) {
    assert.deepEqual(pair.targets.map((t) => `${t.type}:${t.grade}:${t.minimum}`).sort(),
      targets.map((t) => `${t.type}:${t.grade}:${t.minimum}`).sort());
    for (let mask = 0; mask < 8; mask++) assert.equal(pair.keepMasks[mask] & ~mask, 0);
  }
  assert.ok(JSON.stringify(result).length < 1e6, "공유 수치 분포로 안내 데이터가 과도하게 커지면 안 된다");
});

test("새 후보는 입력 배치 순서에 무관하며 반값은 명성치만 절반으로 만든다", () => {
  const permuted = calculate({ ...options, targets: [targets[2], targets[0], targets[1]] });
  close(permuted.expectedHonor, result.expectedHonor);
  close(permuted.expectedMeso, result.expectedMeso);
  close(permuted.expectedCirculators.abyss, result.expectedCirculators.abyss);
  const half = calculate({ ...options, halfHonor: true });
  close(half.expectedHonor, result.expectedHonor / 2);
  close(half.baselineHonor, result.baselineHonor / 2);
  close(half.expectedMeso, result.expectedMeso);
  close(half.expectedCirculators.abyss, result.expectedCirculators.abyss);
});

test("보유량 증가로 기대 명성치가 나빠지지 않으며 미허용·0개이면 심서큘을 쓰지 않는다", () => {
  let previous = Infinity;
  for (const abyssCount of [0, 1, 5, 40]) {
    const current = calculate({ ...options, abyssCount });
    assert.ok(current.expectedHonor <= previous + 1);
    assert.ok((current.expectedCirculators.abyss ?? 0) <= abyssCount + 1e-9);
    previous = current.expectedHonor;
  }
  const disabled = calculate({ ...options, allowAbyss: false });
  close(disabled.expectedHonor, calculate({ ...options, abyssCount: 0 }).expectedHonor);
  assert.equal(disabled.expectedCirculators.abyss ?? 0, 0);
});

test("이미 잠근 줄·고급 OFF·아랫줄 순서 고정에는 유연한 배치를 적용하지 않는다", () => {
  for (const patch of [
    { targets: [{ ...targets[0], locked: true }, ...targets.slice(1)] },
    { useAdvanced: false }, { swapLower: false }, { comparePlacements: false },
    { targets: targets.slice(0, 2) },
  ]) {
    const current = calculate({ ...options, ...patch });
    assert.notEqual(current.strategyMode, "flexible-lower-acquisition");
    assert.equal(current.flexibleComparison, undefined);
  }
});

test("두 줄 후 심서큘의 전체 결과 선택은 독립적인 이중 합 DP와 일치한다", () => {
  const pair = result.steps[0].flexibleGuide.pairs.find((p) => p.targets[0].type === "abnormal-damage");
  const entry = pair.firstOptions.find((e) => e.type === "attack");
  const model = pair.profiles[entry.profile];
  let values = model.states.map((s) => pair.terminal[s.mask][0]);
  for (let n = 0; n < 40; n++) {
    const translated = { ...model, states: model.states.map((s) => ({ ...s, values: [entry.values[s.values[0]][0], ...s.values.slice(1)] })), maximumUses: 40, keepMasks: pair.keepMasks };
    for (let old = 0; old < values.length; old++) for (let next = 0; next < values.length; next++) {
      const decision = chooseAbilityAbyssResult(translated, translated.states[old].values, translated.states[next].values, n);
      const selected = decision.apply ? next : old;
      assert.ok(values[selected] <= Math.min(values[old], values[next]) + 1e-5);
    }
    values = model.states.map((s, old) => (s.mask & 6) === 6 ? pair.terminal[s.mask][0]
      : model.states.reduce((sum, proposed, next) => old === next ? sum
        : sum + proposed.probability / (1 - s.probability) * Math.min(values[old], values[next]), 0));
  }
  values.forEach((v, i) => close(v, model.stateValues[i][0]));
  let pairFirst = false, firstThenFull = false;
  for (const e of pair.firstOptions) for (const [v] of e.values) for (const lower of pair.lowerStates) {
    const decision = chooseFlexibleAbilityStart(pair, e.type, [v, ...lower.values]);
    pairFirst ||= decision.mode === "pair";
    firstThenFull ||= decision.mode === "first-then-full";
    assert.ok(decision.vector[0] <= pair.terminal[decision.mask][0] + 1e-5);
    assert.ok(decision.vector[7] <= 40 + 1e-9);
  }
  assert.ok(pairFirst && firstThenFull, "실제 상태에 따라 두 경로를 모두 선택할 수 있어야 한다");
  assert.equal(chooseFlexibleAbilityStart(pair, entry.type, [null, 20, 1]), null);
  assert.equal(chooseFlexibleAbilityStart(pair, "unknown", [30, 20, 1]), null);
  // Lower order follows the pair's actual target array.
  const done = chooseFlexibleAbilityStart(pair, "abnormal-damage", pair.targets.map((t) => t.minimum));
  assert.equal(done.mode, "direct");
  assert.equal(done.vector[0], 0);
});
