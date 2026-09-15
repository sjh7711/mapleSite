import test from "node:test";
import assert from "node:assert/strict";

import {
  combatSourceKey,
  resolveCombatSourceLedger,
} from "maple-core/combat-source-ledger";
import { composeCombatModel, createCombatEffect } from "maple-core/combat-model";

test("같은 경로에서 완전히 같은 전투 효과가 두 번 들어오면 한 번만 적용한다", () => {
  const effect = createCombatEffect({
    layer: "class-skill",
    source: "테스트 버프",
    modifiers: { damage: 20, ignoreDefenseSources: [25] },
  });
  const result = composeCombatModel({
    baseline: { ignoreDefense: 0.9 },
    effects: [effect, { ...effect }],
  });

  assert.equal(result.totals.damage, 20);
  assert.equal(result.totals.ignoreDefense, 0.925);
  assert.equal(result.effects[0].applicationReason, "applied");
  assert.equal(result.effects[1].applicationReason, "duplicate-occurrence");
});

test("같은 스킬의 서로 다른 단계는 component로 구분해 모두 적용한다", () => {
  const result = composeCombatModel({
    effects: [
      createCombatEffect({
        layer: "common-skill",
        source: "프리드의 가호 VI",
        sourceKey: "skill:freud-vi",
        component: "attack",
        modifiers: { flatAttack: 30 },
      }),
      createCombatEffect({
        layer: "common-skill",
        source: "프리드의 가호 VI",
        sourceKey: "skill:freud-vi:boss",
        component: "boss",
        modifiers: { bossDamage: 30 },
      }),
    ],
  });

  assert.equal(result.totals.flatAttack, 30);
  assert.equal(result.totals.bossDamage, 30);
  assert.deepEqual(result.effects.map(({ applied }) => applied), [true, true]);
});

test("API 기준 상태에 포함됐다고 명시한 출처는 다시 합산하지 않는다", () => {
  const result = composeCombatModel({
    baseline: { ignoreDefense: 0.9 },
    baselineSources: [
      { sourceKey: "skill:pirate-flag", included: true },
    ],
    effects: [createCombatEffect({
      layer: "class-skill",
      source: "파이렛 플래그 VI",
      sourceKey: "skill:pirate-flag",
      activation: {
        mode: "maintained",
        evidence: "battle-practice-timeline",
        observedUseCount: 6,
      },
      modifiers: { ignoreDefenseSources: [25] },
    })],
  });

  assert.equal(result.totals.ignoreDefense, 0.9);
  assert.equal(result.effects[0].applicationReason, "baseline-source-overlap");
  assert.equal(result.effects[0].activation.evidence, "battle-practice-timeline");
});

test("기존 baseline key 형식도 sourceKey와 같은 출처로 판정한다", () => {
  const result = composeCombatModel({
    baseline: { damage: 100 },
    baselineSources: [{ key: "conditional:link-skills", included: true }],
    effects: [createCombatEffect({
      layer: "general",
      source: "조건",
      sourceKey: "conditional:link-skills",
      modifiers: { damage: 10 },
    })],
  });

  assert.equal(result.totals.damage, 100);
  assert.equal(result.effects[0].applicationReason, "baseline-source-overlap");
});

test("활성화 정책은 계산 대상 프리셋에 없는 효과를 근거와 함께 제외한다", () => {
  const ledger = resolveCombatSourceLedger({
    effects: [createCombatEffect({
      layer: "class-skill",
      source: "파이렛 플래그 VI",
      activation: { mode: "maintained" },
      modifiers: { ignoreDefenseSources: [25] },
    })],
    activationPolicy: { excludedModes: ["maintained"] },
  });

  assert.equal(ledger[0].applied, false);
  assert.equal(ledger[0].reason, "activation-mode-excluded");
});

test("VI 접미사는 호출자가 계열을 명시하기 전에는 임의로 합치지 않는다", () => {
  assert.notEqual(
    combatSourceKey({ layer: "class-skill", source: "파이렛 플래그" }),
    combatSourceKey({ layer: "class-skill", source: "파이렛 플래그 VI" }),
  );
});
