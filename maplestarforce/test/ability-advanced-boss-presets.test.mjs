import assert from "node:assert/strict";
import test from "node:test";
import { getAbilityTargetOptions, getAbilityTargetValues } from "maple-core/ability";
import { ABILITY_JOB_PRESETS } from "../src/data/ability-job-presets.js";
import { getAdvancedAbilityBossTargets } from "../src/data/ability-advanced-boss-presets.js";

test("48직업의 고급 보스 추천은 중복 없는 공식 레전드리 최대 수치 세 줄이다", () => {
  for (const job of ABILITY_JOB_PRESETS) {
    const targets = getAdvancedAbilityBossTargets(job.id, "advanced", "boss");
    assert.equal(targets?.length, 3, job.name);
    assert.equal(new Set(targets.map(({ type }) => type)).size, 3, job.name);
    targets.forEach((target, line) => {
      assert.equal(target.grade, "legendary");
      assert.equal(target.locked, false);
      assert.ok(getAbilityTargetOptions(line, "advanced", "legendary")
        .some(({ id }) => id === target.type), `${job.name}/${line}`);
      assert.equal(target.minimum, Math.max(...getAbilityTargetValues(target.type, line, "advanced", "legendary")));
    });
  }
});

test("첨부 표의 패보상·재보피와 직업별 공/마 해석을 적용한다", () => {
  const preset = (job) => getAdvancedAbilityBossTargets(job, "advanced", "boss")
    .map(({ type, minimum }) => [type, minimum]);
  assert.deepEqual(preset("나이트로드"), [["passive-level", 1], ["boss-damage", 20], ["abnormal-damage", 10]]);
  assert.deepEqual(preset("데몬어벤져"), [["cooldown-skip", 20], ["boss-damage", 20], ["max-hp-percent", 20]]);
  assert.deepEqual(preset("비숍"), [["boss-damage", 20], ["abnormal-damage", 10], ["magic", 30]]);
  assert.deepEqual(preset("나이트워커"), [["boss-damage", 20], ["abnormal-damage", 10], ["attack", 30]]);
  // 초기 게시물이 아니라 사용자가 첨부한 최종 표의 조합이어야 한다.
  for (const job of ["레테", "제로"]) {
    assert.deepEqual(preset(job), [["cooldown-skip", 20], ["boss-damage", 20], ["abnormal-damage", 10]]);
  }
  assert.deepEqual(preset("팬텀"), [["passive-level", 1], ["boss-damage", 20], ["cooldown-skip", 20]]);
  assert.deepEqual(preset("소울마스터"), preset("나이트로드"));
});

test("사냥용과 다른 재설정 방식에는 고급 보스 추천을 적용하지 않는다", () => {
  for (const job of ABILITY_JOB_PRESETS) {
    for (const method of ["honor", "optimal", "miracle", "black", "chaos", "advanced"]) {
      assert.equal(getAdvancedAbilityBossTargets(job.id, method, "hunt"), null);
      if (method !== "advanced") assert.equal(getAdvancedAbilityBossTargets(job.id, method, "boss"), null);
    }
  }
  assert.equal(getAdvancedAbilityBossTargets("", "advanced", "boss"), null);
  const first = getAdvancedAbilityBossTargets("나이트로드", "advanced", "boss");
  first[1].minimum = 17;
  assert.equal(getAdvancedAbilityBossTargets("나이트로드", "advanced", "boss")[1].minimum, 20);
});
