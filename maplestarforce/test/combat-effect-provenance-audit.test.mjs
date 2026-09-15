import test from "node:test";
import assert from "node:assert/strict";

import { auditCombatEffectProvenanceSnapshots } from
  "../scripts/audit-combat-effect-provenance.mjs";

function snapshot(effect) {
  return {
    characterClass: "캡틴",
    characterName: "테스트",
    skillData: [{
      character_skill_grade: "6",
      character_skill: [{
        skill_name: "파이렛 플래그 VI",
        skill_level: 30,
        skill_description: "깃발을 세워 적을 공격한다.",
        skill_effect: effect,
      }],
    }],
  };
}

test("유지형 전역 방무는 스킬 고유 방무와 겹친 것으로 판정하지 않는다", () => {
  const report = auditCombatEffectProvenanceSnapshots([
    snapshot(
      "60초 동안 자신의 AP를 직접 투자한 모든 능력치 55% 증가 및 " +
        "몬스터 방어율 무시 25% 증가, 공격력 30 증가\n" +
        "파티원은 몬스터 방어율 무시 25% 증가",
    ),
  ]);

  assert.equal(report.globalIgnoreDefenseEffectCount, 1);
  assert.equal(report.issueCount, 0);
});

test("공격 자체의 방무와 전역 방무가 같은 출처로 동시에 분류되면 보고한다", () => {
  const report = auditCombatEffectProvenanceSnapshots([
    snapshot(
      "60초 동안 자신의 AP를 직접 투자한 모든 능력치 55% 증가 및 " +
        "몬스터 방어율 무시 25% 증가, 공격력 30 증가\n" +
        "해당 공격은 몬스터 방어율을 30% 무시하여 공격",
    ),
  ]);

  assert.equal(report.globalIgnoreDefenseEffectCount, 1);
  assert.equal(report.issueCounts["global-local-scope-overlap"], 1);
});
