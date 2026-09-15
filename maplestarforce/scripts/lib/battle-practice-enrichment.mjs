import {
  selectStableBattlePracticeRecords,
} from "./battle-practice-profile.mjs";

function normalizedText(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

export function normalizedReplayRegisterDate(value) {
  const text = normalizedText(value);
  if (!text) return null;
  const matched = text.match(/^(\d{4}-\d{2}-\d{2})/u);
  return matched?.[1] ?? text;
}

export function replayForLegacyRecord(replayList, legacyRecord) {
  const expected = normalizedReplayRegisterDate(
    legacyRecord?.result?.register_date ?? legacyRecord?.registerDate,
  );
  if (!expected) return null;
  const matches = (Array.isArray(replayList) ? replayList : [])
    .filter((replay) => normalizedText(replay?.replay_id))
    .filter((replay) =>
      normalizedReplayRegisterDate(replay?.register_date) === expected
    )
    .sort((left, right) =>
      Number(right?.period_no ?? 0) - Number(left?.period_no ?? 0) ||
      normalizedText(right?.register_date).localeCompare(
        normalizedText(left?.register_date),
      )
    );
  return matches[0] ?? null;
}

function legacyReferenceKey(record) {
  const characterClass = normalizedText(record?.characterClass);
  const characterName = normalizedText(record?.characterName);
  return characterClass && characterName
    ? `${characterClass}\u001f${characterName}`
    : null;
}

function newestLegacyRecord(left, right) {
  const leftDate = normalizedText(
    left?.result?.register_date ?? left?.registerDate,
  );
  const rightDate = normalizedText(
    right?.result?.register_date ?? right?.registerDate,
  );
  return rightDate.localeCompare(leftDate) > 0 ? right : left;
}

/**
 * 이전 schema v1 기록 중 서로 다른 캐릭터의 정상 자동 종료 기록만 남기고,
 * 피해 분포가 가장 일관된 직업별 표본을 고른다. character-info와 timeline을
 * 다시 받기 전에 후보를 줄여 Open API 호출량을 아낀다.
 */
export function selectLegacyRecordsForEnrichment(records, {
  samplesPerClass = 5,
  excludedReferenceKeys = new Set(),
  selectedClasses = new Set(),
} = {}) {
  const latestByCharacter = new Map();
  for (const record of records ?? []) {
    const key = legacyReferenceKey(record);
    if (!key || excludedReferenceKeys.has(key)) continue;
    const characterClass = normalizedText(record?.characterClass);
    if (selectedClasses.size && !selectedClasses.has(characterClass)) continue;
    const result = record?.result;
    const playTime = Number(result?.total_play_time);
    if (
      String(result?.end_type ?? "") !== "1" ||
      !(playTime > 0) || playTime > 400_000 ||
      !Array.isArray(result?.skill_statistic) ||
      !result.skill_statistic.length
    ) continue;
    const current = latestByCharacter.get(key);
    latestByCharacter.set(
      key,
      current ? newestLegacyRecord(current, record) : record,
    );
  }

  const byClass = new Map();
  for (const record of latestByCharacter.values()) {
    const characterClass = normalizedText(record.characterClass);
    const rows = byClass.get(characterClass) ?? [];
    rows.push(record);
    byClass.set(characterClass, rows);
  }

  const selected = [];
  const classReports = {};
  for (const [characterClass, candidates] of [...byClass.entries()].sort(
    ([left], [right]) => left.localeCompare(right, "ko"),
  )) {
    const selection = selectStableBattlePracticeRecords(candidates, {
      minSamples: Math.min(samplesPerClass, candidates.length),
      maxSamples: samplesPerClass,
      maximumMedianPairDistance: 0.12,
    });
    const names = new Set(selection.accepted.map((row) => row.characterName));
    const chosen = candidates
      .filter((record) => names.has(normalizedText(record.characterName)))
      .slice(0, samplesPerClass);
    selected.push(...chosen);
    classReports[characterClass] = {
      candidateCount: candidates.length,
      selectedCount: chosen.length,
      stable: selection.stable,
      medianPairDistance: selection.medianPairDistance,
    };
  }
  return { selected, classReports };
}

