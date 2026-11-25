import test from "node:test";
import assert from "node:assert/strict";
import {
  CLASS_SPECIAL_RING_PHASE_PROFILES,
  specialRingBurstDamageShare,
} from "../src/special-ring-phase-profiles.js";

test("특수 반지 구간 프로필은 대상 48직업을 모두 포함한다", () => {
  assert.equal(Object.keys(CLASS_SPECIAL_RING_PHASE_PROFILES).length, 48);
  for (const job of ["데몬어벤져", "렌", "레테", "제논"]) {
    const count = CLASS_SPECIAL_RING_PHASE_PROFILES[job].sampleCount;
    assert.ok(Number.isInteger(count) && count >= 2 && count <= 5, job);
  }
});

test("액티브 링 지속시간이 길수록 포함되는 피해 비중이 감소하지 않는다", () => {
  for (const [characterClass, profile] of Object.entries(
    CLASS_SPECIAL_RING_PHASE_PROFILES,
  )) {
    const shares = [9, 11, 13, 15, 20].map((duration) =>
      specialRingBurstDamageShare(characterClass, duration)
    );
    assert.ok(
      shares.every((share) => Number.isFinite(share) && share >= 0 && share <= 1),
      characterClass,
    );
    for (let index = 1; index < shares.length; index += 1) {
      assert.ok(shares[index] >= shares[index - 1], characterClass);
    }
    assert.deepEqual(
      shares,
      [9, 11, 13, 15, 20].map((duration) =>
        profile.damageShareByDuration[String(duration)]
      ),
    );
  }
});
