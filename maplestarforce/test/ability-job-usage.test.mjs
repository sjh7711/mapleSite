import assert from "node:assert/strict";
import test from "node:test";
import { ABILITY_OPTIONS } from "maple-core/ability";
import {
  ABILITY_GLOBAL_POPULAR,
  ABILITY_JOB_USAGE,
  ABILITY_JOB_USAGE_SOURCE,
} from "../src/data/ability-job-usage.js";
import { ABILITY_JOB_PRESETS } from "../src/data/ability-job-presets.js";

test("직업별 어빌리티 사용률 자료는 48직업의 보스·사냥 프리셋을 제공한다", () => {
  assert.equal(ABILITY_JOB_USAGE_SOURCE.jobCount, 48);
  assert.equal(ABILITY_JOB_USAGE.length, 48);
  assert.equal(ABILITY_JOB_PRESETS.length, 48);
  const validTypes = new Set(ABILITY_OPTIONS.map((option) => option.id));
  for (const job of ABILITY_JOB_USAGE) {
    for (const mode of ["boss", "hunt"]) {
      assert.equal(job.presets[mode].length, 3, `${job.name} ${mode}`);
      assert.equal(new Set(job.presets[mode]).size, 3, `${job.name} ${mode} 중복`);
      job.presets[mode].forEach((type) => assert.ok(validTypes.has(type), type));
    }
  }
  assert.deepEqual(
    ABILITY_JOB_PRESETS,
    ABILITY_JOB_USAGE.map(({ id, name, presets }) => ({ id, name, presets })),
  );
});

test("전체·보스·사냥 인기 정렬은 실제 사용 집계를 분리한다", () => {
  for (const mode of ["all", "boss", "hunt"]) {
    assert.ok(ABILITY_GLOBAL_POPULAR[mode].main.length >= 3);
    assert.ok(ABILITY_GLOBAL_POPULAR[mode].sub.length >= 3);
  }
  assert.equal(ABILITY_GLOBAL_POPULAR.boss.main[0], "boss-damage");
  assert.equal(ABILITY_GLOBAL_POPULAR.hunt.main[0], "item-drop");
  assert.equal(ABILITY_GLOBAL_POPULAR.boss.sub[0], "abnormal-damage");
});
