import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizedReplayRegisterDate,
  replayForLegacyRecord,
  selectLegacyRecordsForEnrichment,
} from "../scripts/lib/battle-practice-enrichment.mjs";

function legacy(characterClass, characterName, date, weights = [70, 30]) {
  return {
    characterClass,
    characterName,
    result: {
      register_date: date,
      end_type: "1",
      total_play_time: 337_000,
      total_damage: 100,
      skill_statistic: weights.map((damage, index) => ({
        skill_name: `스킬 ${index + 1}`,
        damage,
      })),
    },
  };
}

test("리플레이 등록일은 시간대 표기가 달라도 같은 날짜로 비교한다", () => {
  assert.equal(
    normalizedReplayRegisterDate("2026-03-22T00:00+09:00"),
    "2026-03-22",
  );
  const selected = replayForLegacyRecord([
    { replay_id: "old", period_no: 1, register_date: "2026-03-21" },
    { replay_id: "target", period_no: 3, register_date: "2026-03-22T09:00:00+09:00" },
  ], legacy("캡틴", "테스트", "2026-03-22T00:00+09:00"));
  assert.equal(selected?.replay_id, "target");
});

test("직업별 고유 캐릭터만 선택하고 holdout은 제외한다", () => {
  const records = [
    legacy("캡틴", "A", "2026-01-01"),
    legacy("캡틴", "A", "2026-02-01"),
    legacy("캡틴", "B", "2026-01-01", [69, 31]),
    legacy("캡틴", "C", "2026-01-01", [71, 29]),
  ];
  const result = selectLegacyRecordsForEnrichment(records, {
    samplesPerClass: 2,
    excludedReferenceKeys: new Set(["캡틴\u001fC"]),
  });
  assert.equal(result.selected.length, 2);
  assert.deepEqual(
    new Set(result.selected.map(({ characterName }) => characterName)),
    new Set(["A", "B"]),
  );
  assert.equal(
    result.selected.find(({ characterName }) => characterName === "A")
      ?.result?.register_date,
    "2026-02-01",
  );
});

