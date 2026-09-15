import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeCombatEffectProvenance,
  counterfactualIgnoreDefenseEquivalent,
  deriveOneMainPercentRelative,
  removeIgnoreDefenseSources,
  timelineActivationEvidence,
} from "../scripts/lib/combat-effect-provenance.mjs";

test("누락된 방무 진단값을 0% 방무로 오인하지 않는다", () => {
  assert.equal(deriveOneMainPercentRelative({
    currentIgnoreDefense: null,
    enemyDefense: 3.8,
    targetDefenseRemaining: 1,
    unprofiledEquivalent: 10,
  }), null);

  const result = analyzeCombatEffectProvenance({
    characterName: "누락 테스트",
    characterClass: "히어로",
    ied300: null,
    ied380: null,
    actual300: null,
    actual380: null,
    combatDiagnostics: {
      currentIgnoreDefense: null,
      targetDefenseRemaining: 1,
      effects: [{
        applied: true,
        source: "오라 웨폰",
        averagedModifiers: { ignoreDefenseSources: [16] },
      }],
    },
  });

  assert.equal(result.oneMainPercentRelative, null);
  assert.equal(result.reference.ied380, null);
  assert.equal(result.current.equivalent380, null);
  assert.equal(result.current.error380Percent, null);
  assert.equal(result.candidates[0].equivalent380, null);
});

test("현재 방무에서 특정 곱연산 출처만 역산해 제거한다", () => {
  const withSource = 1 - (1 - 0.98) * 0.75;
  assert.ok(Math.abs(removeIgnoreDefenseSources(withSource, [25]) - 0.98) < 1e-12);
});

test("캡틴 김우빈의 파이렛 플래그 반사실 오차를 같은 계약으로 재현한다", () => {
  const equivalent = counterfactualIgnoreDefenseEquivalent({
    currentIgnoreDefense: 0.9954940531,
    removedIgnoreDefenseSources: [25],
    enemyDefense: 3.8,
    targetDefenseRemaining: 1,
    oneMainPercentRelative: 0.0007447741323655224,
    channels: [],
  });
  const reference = 12.054176072234762;

  assert.ok(Math.abs(equivalent - 12.547977831295508) < 1e-10);
  assert.ok(Math.abs((equivalent / reference - 1) * 100 - 4.096520210934651) < 1e-10);
});

test("동일 프레임 중복 입력을 제거하고 유지형 스킬 가동률을 계산한다", () => {
  const record = {
    result: { total_play_time: 120_000 },
    characterInfo: { skill_object: { character_skill: [{
      skill_name: "파이렛 플래그 VI",
      skill_effect: "60초 동안 효과 적용",
    }] } },
    skillTimeline: { entries: [
      { elapse_time: 100, skill_name: "파이렛 플래그 VI" },
      { elapse_time: 300, skill_name: "파이렛 플래그 VI" },
      { elapse_time: 59_000, skill_name: "파이렛 플래그 VI" },
    ] },
  };
  const evidence = timelineActivationEvidence(record, "파이렛 플래그 VI");
  assert.equal(evidence.rawUseCount, 3);
  assert.equal(evidence.useCount, 2);
  assert.ok(evidence.coverage > 0.99);
});

test("실측 유지형 스킬 제거가 외부 기준만 개선하면 프리셋 불일치로 분류한다", () => {
  const currentIgnoreDefense = 0.995;
  const enemyDefense = 3.8;
  const before = 1 - enemyDefense * (1 - currentIgnoreDefense);
  const after = 1 - enemyDefense * (1 - currentIgnoreDefense) * 0.6;
  const relativeGain = after / before - 1;
  const oneMain = 0.001;
  const currentEquivalent = relativeGain / oneMain;
  const withoutFlag = removeIgnoreDefenseSources(currentIgnoreDefense, [25]);
  const beforeWithout = 1 - enemyDefense * (1 - withoutFlag);
  const afterWithout = 1 - enemyDefense * (1 - withoutFlag) * 0.6;
  const reference = (afterWithout / beforeWithout - 1) / oneMain;
  const row = {
    characterName: "테스트",
    characterClass: "캡틴",
    ied300: reference,
    ied380: reference,
    actual300: currentEquivalent,
    actual380: currentEquivalent,
    unprofiled380: currentEquivalent,
    combatDiagnostics: {
      currentIgnoreDefense,
      targetDefenseRemaining: 1,
      damageChannels: [],
      effects: [{
        applied: true,
        source: "파이렛 플래그 VI",
        layer: "class-skill",
        kind: "maintained",
        averagedModifiers: { ignoreDefenseSources: [25] },
      }],
    },
  };
  const record = {
    result: { total_play_time: 120_000 },
    characterInfo: { skill_object: { character_skill: [{
      skill_name: "파이렛 플래그 VI",
      skill_effect: "60초 동안 효과 적용",
    }] } },
    skillTimeline: { entries: [
      { elapse_time: 0, skill_name: "파이렛 플래그 VI" },
      { elapse_time: 59_000, skill_name: "파이렛 플래그 VI" },
    ] },
  };
  const result = analyzeCombatEffectProvenance(row, record);
  assert.equal(result.candidates[0].diagnosis, "reference-preset-divergence");
  assert.ok(result.candidates[0].referenceEquivalentUptime < 0.001);
  assert.ok(result.candidates[0].activationCoverageGap > 0.99);
});
