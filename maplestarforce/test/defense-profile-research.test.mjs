import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateDefenseProfileRow,
  fitProfileConfidence,
  inferExternalEffectiveDefenseRemaining,
  unprofiledIgnoreDefenseGain,
} from "../scripts/lib/defense-profile-research.mjs";

test("두 방어율 효율에서 원래 유효 방어 잔량을 역산한다", () => {
  const effectiveRemaining = 0.006;
  const oneMain = 0.0008;
  const value = (defense) =>
    (0.4 * defense * effectiveRemaining /
      (1 - defense * effectiveRemaining)) / oneMain;
  assert.ok(Math.abs(inferExternalEffectiveDefenseRemaining({
    against300: value(3),
    against380: value(3.8),
  }) - effectiveRemaining) < 1e-12);
});

test("방어 정규화 프로필 행은 local IED를 채널별로 다시 적용한다", () => {
  const currentIgnoreDefense = 0.98;
  const oneMain = 0.001;
  const unprofiled380 = unprofiledIgnoreDefenseGain({
    currentIgnoreDefense,
    enemyDefense: 3.8,
  }) / oneMain;
  const evaluated = evaluateDefenseProfileRow({
    characterClass: "테스트",
    characterName: "표본",
    ied300: 10,
    ied380: 13,
    unprofiled300: 10,
    unprofiled380,
    combatDiagnostics: { currentIgnoreDefense, targetDefenseRemaining: 1 },
  }, {
    skillShares: [
      { source: "일반", weight: 0.5 },
      { source: "방무기", weight: 0.5, ignoreDefenseSources: [50] },
    ],
  });
  assert.ok(evaluated.profiled380 < evaluated.unprofiled380);
  assert.ok(Math.abs(evaluated.oneMainPercentRelative - oneMain) < 1e-12);
});

test("혼합 신뢰도는 프로필과 전역식 사이의 최저 MAE를 찾는다", () => {
  const rows = [1, 2, 3].map((index) => ({
    reference300: 8,
    reference380: 10,
    unprofiled300: 10,
    unprofiled380: 12,
    profiled300: 6,
    profiled380: 8,
    index,
  }));
  const fit = fitProfileConfidence(rows);
  assert.ok(Math.abs(fit.confidence - 0.5) <= 0.001);
  assert.ok(fit.maePercent < 0.001);
});

