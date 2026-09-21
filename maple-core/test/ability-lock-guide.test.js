import assert from "node:assert/strict";
import test from "node:test";
import { calculateAbilityOptimalStrategy } from "../src/ability.js";

const options = {
  보: { type: "boss-damage", minimum: 20, grade: "legendary" },
  패: { type: "passive-level", minimum: 1, grade: "legendary" },
  상: { type: "abnormal-damage", minimum: 10, grade: "legendary" },
};
const calculate = (order, extra = {}) => calculateAbilityOptimalStrategy({
  targets: [...order].map((key) => ({ ...options[key] })),
  useAdvanced: true, allowBlack: false, allowChaos: false, ...extra,
});
const advanced = (result) => result.steps.find((step) => step.method === "advanced");
const decision = (step, locked, completed) => step.lockRules
  .find((rule) => rule.lockedMask === locked)?.outcomes
  .find((outcome) => outcome.completedMask === completed)?.keepMask;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < Math.max(1, expected) * 1e-10);

test("렌 보스용1 안내는 아랫줄 확보 전 보공을 잠그지 않는 실제 계산 정책을 표시한다", () => {
  const result = calculate("보패상");
  const step = advanced(result);
  close(result.expectedHonor, 212564732.9506799);
  close(result.expectedMeso, 42790632989.56268);
  close(result.expectedAdvancedResets, 7386.9998690788825);
  assert.equal(result.expectedNormalResets, 0);
  assert.equal(step.lockGuideMode, "sequence");
  assert.equal(step.priority.length, 3);
  assert.deepEqual(step.priority, [
    "아랫줄 패시브 +1 또는 아랫줄 상추뎀 10% 이상 중 먼저 나온 옵션 잠금",
    "남은 아랫줄 목표 잠금",
    "첫 줄 보공 20% 이상 맞추기",
  ]);
  assert.deepEqual(step.lockNotes, ["이 두 목표를 맞추기 전에는 보공 옵션을 잠그지 마세요.", "", ""]);
  assert.equal(step.after, "");
  assert.equal(decision(step, 0, 1), 0, "보공만 나와도 첫 줄을 잠그지 않는다");
  assert.equal(decision(step, 0, 3), 2, "보공+패시브라면 패시브만 잠근다");
  assert.equal(decision(step, 0, 5), 4, "보공+상추뎀이라면 상추뎀만 잠근다");
  assert.equal(decision(step, 2, 3), 2);
  assert.equal(decision(step, 4, 5), 4);
  assert.equal(decision(step, 0, 6), 6, "아랫줄 동시 완성은 둘 다 잠근다");
  assert.equal(decision(step, 6, 7), 7);
});

test("배치 추천 결과와 적용한 목표는 동일한 잠금 안내를 갖는다", () => {
  const recommendation = calculate("패보상", { comparePlacements: true });
  const applied = calculateAbilityOptimalStrategy({
    targets: recommendation.placementRecommendation.recommendedTargets,
    useAdvanced: true, allowBlack: false, allowChaos: false,
  });
  assert.deepEqual(recommendation.steps, applied.steps);
  assert.deepEqual(advanced(applied).lockRules, advanced(calculate("보패상")).lockRules);
});

test("수동 패보상에서는 상태 이상 목표가 먼저 나와도 잠금을 미루는 별도 조건을 설명한다", () => {
  const step = advanced(calculate("패보상"));
  assert.equal(decision(step, 0, 4), 0, "상추뎀만 먼저 나온 경우 잠금 보류");
  assert.equal(decision(step, 0, 5), 0, "패시브와 상추뎀 동시 완성도 보공 전에는 보류");
  assert.equal(decision(step, 0, 2), 2);
  assert.equal(decision(step, 0, 6), 6, "보공과 함께 완성된 상추뎀은 같이 잠근다");
  assert.equal(step.lockGuideMode, "sequence");
  assert.deepEqual(step.priority, [
    "아랫줄 보공 20% 이상 잠금",
    "아랫줄 상추뎀 10% 이상 잠금",
    "첫 줄 패시브 +1 맞추기",
  ]);
  assert.deepEqual(step.lockNotes, [
    "보공 목표를 맞추기 전에는 패시브·상추뎀 옵션을 잠그지 마세요.",
    "상추뎀 목표를 맞추기 전에는 패시브 옵션을 잠그지 마세요.",
    "",
  ]);
  assert.equal(step.description, "");
});

test("선행 확보 경로의 안내는 이미 잠근 줄에서 시작하고 그 잠금을 풀라고 하지 않는다", () => {
  const result = calculateAbilityOptimalStrategy({ useAdvanced: true,
    targets: [{ type: "critical", minimum: 30, grade: "legendary" },
      { type: "abnormal-damage", minimum: 9, grade: "legendary" }],
    miracleCount: 5, blackCount: 5, chaosCount: 5,
  });
  assert.ok(result.expectedNormalResets > 0);
  const step = advanced(result);
  assert.equal(step.lockRules[0].lockedMask, 1);
  assert.match(step.description, /첫 줄 크확 30% 이상 잠금 유지/u);
  assert.match(step.priority[0], /아랫줄 상추뎀 9% 이상 맞추기/u);
  assert.deepEqual(step.lockNotes, [""]);
  assert.doesNotMatch(step.after, /첫.*잠그지/u);
  for (const rule of step.lockRules) assert.equal(rule.lockedMask & 1, 1);
});

test("아랫줄 한 목표 및 순서 고정도 선택한 조건에 맞는 안내를 반환한다", () => {
  const single = calculateAbilityOptimalStrategy({ useAdvanced: true,
    targets: [{}, { type: "critical", minimum: 30, grade: "legendary" }], swapLower: false,
  });
  assert.match(advanced(single).priority[0], /둘째 줄 크확.*30%.*맞추기/u);
  assert.equal(advanced(single).priority.length, 1);
  const fixed = advanced(calculate("보패상", { swapLower: false }));
  assert.match(fixed.priority[0], /둘째 줄 패시브.*셋째 줄 상추뎀/u);
  assert.match(fixed.lockNotes[0], /보공 옵션을 잠그지 마세요/u);
});

test("심서큘 선행 확보 단계도 실제 잠금 조건을 안내하고 전체 목표 종료로 오인시키지 않는다", () => {
  const result = calculate("보패상", { abyssCount: 100 });
  assert.equal(result.strategyMode, "abyss-completion");
  const acquisition = result.steps[0];
  assert.ok(acquisition.lockRules.length > 0);
  assert.match(acquisition.after, /확보되면 심서큘로 목표 수치를 맞춥니다/u);
  assert.doesNotMatch(acquisition.after, /즉시 종료/u);
  assert.ok(acquisition.priority.some((text) => text.includes("레전드리")));
  assert.ok(result.steps.slice(2).some((step) => step.branches?.some((branch) =>
    branch.steps.some((followup) => followup.lockRules?.length))));
});
