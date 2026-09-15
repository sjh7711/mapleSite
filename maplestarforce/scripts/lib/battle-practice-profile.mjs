import { createHash } from "node:crypto";

const MAX_REGISTERED_PLAY_TIME_MS = 400_000;
const UNATTRIBUTED_SKILL = "__unattributed__";

function finiteNumber(value) {
  const parsed = Number(String(value ?? "0").replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function normalizedBattlePracticeSkillName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

function skillKey(value) {
  return normalizedBattlePracticeSkillName(value)
    .replace(/\s+/gu, "")
    .toLocaleLowerCase("ko-KR");
}

export function normalizedBattlePracticeRecord(candidate) {
  const result = candidate?.result ?? candidate;
  const playTime = finiteNumber(result?.total_play_time);
  if (
    String(result?.end_type ?? "") !== "1" ||
    !(playTime > 0) ||
    playTime > MAX_REGISTERED_PLAY_TIME_MS
  ) return null;

  const directShares = Array.isArray(result?.skillShares)
    ? result.skillShares.map((entry) => ({
      name: normalizedBattlePracticeSkillName(entry?.source),
      weight: Math.max(0, finiteNumber(entry?.weight)),
    })).filter((entry) => entry.name && entry.weight > 0)
    : [];
  const statistics = Array.isArray(result?.skill_statistic)
    ? result.skill_statistic
    : [];
  const rows = statistics.map((entry) => ({
    name: normalizedBattlePracticeSkillName(entry?.skill_name),
    damage: Math.max(0, finiteNumber(entry?.damage)),
    percent: Math.max(
      0,
      finiteNumber(String(entry?.damage_percent ?? "").replace("%", "")),
    ),
  })).filter((entry) => entry.name);
  if (!rows.length && !directShares.length) return null;

  const damageSum = rows.reduce((sum, entry) => sum + entry.damage, 0);
  const reportedTotal = finiteNumber(result?.total_damage);
  const damageDenominator = reportedTotal > 0 ? reportedTotal : damageSum;
  let weightedRows;
  if (directShares.length) {
    weightedRows = directShares;
  } else if (damageDenominator > 0 && damageSum > 0) {
    weightedRows = rows.map((entry) => ({
      name: entry.name,
      weight: entry.damage / damageDenominator,
    }));
  } else {
    const percentSum = rows.reduce((sum, entry) => sum + entry.percent, 0);
    if (!(percentSum > 0)) return null;
    const divisor = percentSum <= 1.5 ? 1 : 100;
    weightedRows = rows.map((entry) => ({
      name: entry.name,
      weight: entry.percent / divisor,
    }));
  }

  const weights = new Map();
  const labels = new Map();
  for (const row of weightedRows) {
    if (!(row.weight > 0)) continue;
    const key = skillKey(row.name);
    if (!key) continue;
    weights.set(key, (weights.get(key) ?? 0) + row.weight);
    if (!labels.has(key)) labels.set(key, row.name);
  }
  const attributed = [...weights.values()].reduce(
    (sum, weight) => sum + weight,
    0,
  );
  if (!(attributed > 0) || attributed > 1.01) return null;
  weights.set(UNATTRIBUTED_SKILL, Math.max(0, 1 - attributed));

  return {
    characterClass: String(candidate?.characterClass ?? "").trim(),
    characterName: String(candidate?.characterName ?? "").trim(),
    registerDate: String(result?.register_date ?? candidate?.registerDate ?? "") || null,
    totalPlayTimeMilliseconds: playTime,
    weights,
    labels,
  };
}

/**
 * 같은 캐릭터를 여러 수집 회차에서 다시 받아도 독립 표본 수를 부풀리지
 * 않는다. 직업 프로필에는 캐릭터별 가장 최신 정상 기록 하나만 사용한다.
 */
export function uniqueBattlePracticeRecords(candidates) {
  const anonymous = [];
  const byCharacter = new Map();
  for (const candidate of candidates) {
    const record = normalizedBattlePracticeRecord(candidate);
    if (!record) continue;
    const characterName = record.characterName.normalize("NFC");
    if (!characterName) {
      anonymous.push(record);
      continue;
    }
    const key = `${record.characterClass.normalize("NFC")}\u001f${characterName}`;
    const current = byCharacter.get(key);
    if (
      !current ||
      String(record.registerDate ?? "").localeCompare(
        String(current.registerDate ?? ""),
      ) > 0
    ) byCharacter.set(key, record);
  }
  return [...byCharacter.values(), ...anonymous];
}

export function totalVariationDistance(left, right) {
  const keys = new Set([...left.keys(), ...right.keys()]);
  let absoluteDifference = 0;
  for (const key of keys) {
    absoluteDifference += Math.abs(
      (left.get(key) ?? 0) - (right.get(key) ?? 0),
    );
  }
  return absoluteDifference / 2;
}

function medoidIndex(records) {
  if (records.length <= 1) return 0;
  const scores = records.map((record, index) => {
    const distances = records.map((other, otherIndex) =>
      index === otherIndex
        ? 0
        : totalVariationDistance(record.weights, other.weights)
    );
    return distances.reduce((sum, distance) => sum + distance, 0) /
      (records.length - 1);
  });
  return scores.indexOf(Math.min(...scores));
}

function subsetPairDistances(entries) {
  const distances = [];
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      distances.push(totalVariationDistance(
        entries[left].record.weights,
        entries[right].record.weights,
      ));
    }
  }
  return distances;
}

function subsetMedianPairDistance(entries) {
  const distances = subsetPairDistances(entries);
  return distances.length ? median(distances) : 0;
}

function subsetMaximumPairDistance(entries) {
  let maximum = 0;
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      maximum = Math.max(maximum, totalVariationDistance(
        entries[left].record.weights,
        entries[right].record.weights,
      ));
    }
  }
  return maximum;
}

function combinations(values, size, start = 0, selected = [], result = []) {
  if (selected.length === size) {
    result.push([...selected]);
    return result;
  }
  const remaining = size - selected.length;
  for (let index = start; index <= values.length - remaining; index += 1) {
    selected.push(values[index]);
    combinations(values, size, index + 1, selected, result);
    selected.pop();
  }
  return result;
}

/**
 * 한두 개의 다른 딜사이클 때문에 직업 전체를 버리지 않고, 가능한 가장
 * 많은 인원으로 구성된 일관된 대표군을 고른다. 조합 탐색 대상은 중심과
 * 가까운 12명으로 제한해 여러 수집 회차가 누적돼도 계산량이 폭증하지
 * 않는다.
 */
function largestStableSubset(entries, {
  minSamples,
  maxSamples,
  maximumMedianPairDistance,
}) {
  const candidates = entries.slice(0, Math.max(maxSamples, 12));
  const maximumSize = Math.min(maxSamples, candidates.length);
  for (let size = maximumSize; size >= minSamples; size -= 1) {
    let best = null;
    let bestMedian = Infinity;
    let bestCenterDistance = Infinity;
    for (const subset of combinations(candidates, size)) {
      const pairMedian = subsetMedianPairDistance(subset);
      if (pairMedian > maximumMedianPairDistance) continue;
      const centerDistance = subset.reduce(
        (sum, entry) => sum + entry.distance,
        0,
      );
      if (
        pairMedian < bestMedian ||
        (pairMedian === bestMedian && centerDistance < bestCenterDistance)
      ) {
        best = subset;
        bestMedian = pairMedian;
        bestCenterDistance = centerDistance;
      }
    }
    if (best) return best;
  }
  return entries.slice(0, maximumSize);
}

export function selectStableBattlePracticeRecords(candidates, {
  minSamples = 3,
  maxSamples = 7,
  absoluteOutlierDistance = 0.08,
  maximumOutlierDistance = 0.25,
  maximumMedianPairDistance = 0.12,
} = {}) {
  const normalized = candidates
    .map(normalizedBattlePracticeRecord)
    .filter(Boolean);
  const valid = uniqueBattlePracticeRecords(candidates);
  if (!valid.length) {
    return {
      accepted: [],
      rejected: [],
      stable: false,
      reason: "no-valid-auto-ended-record",
      medianPairDistance: null,
      maximumPairDistance: null,
      validCount: 0,
      duplicateCount: normalized.length,
    };
  }

  const center = valid[medoidIndex(valid)];
  const distances = valid.map((record) =>
    totalVariationDistance(record.weights, center.weights)
  );
  const distanceMedian = median(distances);
  const distanceMad = median(
    distances.map((distance) => Math.abs(distance - distanceMedian)),
  );
  const cutoff = Math.min(
    maximumOutlierDistance,
    Math.max(
      absoluteOutlierDistance,
      distanceMedian + 3 * 1.4826 * distanceMad,
    ),
  );
  const ranked = valid
    .map((record, index) => ({ record, distance: distances[index] }))
    .sort((left, right) => left.distance - right.distance);
  const eligible = ranked.filter((entry) => entry.distance <= cutoff);
  const acceptedEntries = largestStableSubset(eligible, {
    minSamples,
    maxSamples,
    maximumMedianPairDistance,
  });
  const acceptedSet = new Set(acceptedEntries.map((entry) => entry.record));
  const accepted = acceptedEntries.map((entry) => entry.record);
  const rejected = valid.filter((record) => !acceptedSet.has(record));
  const medianPairDistance = subsetMedianPairDistance(acceptedEntries);
  const maximumPairDistance = subsetMaximumPairDistance(acceptedEntries);
  const stable = accepted.length >= minSamples &&
    medianPairDistance <= maximumMedianPairDistance;
  return {
    accepted,
    rejected,
    stable,
    reason: stable
      ? null
      : accepted.length < minSamples
        ? "insufficient-samples"
        : "unstable-skill-distribution",
    cutoff,
    medianPairDistance,
    maximumPairDistance,
    validCount: valid.length,
    duplicateCount: normalized.length - valid.length,
  };
}

export function buildBattlePracticeClassProfile(characterClass, candidates, {
  minimumSkillShare = 0.0001,
  ...selectionOptions
} = {}) {
  const selection = selectStableBattlePracticeRecords(
    candidates,
    selectionOptions,
  );
  if (!selection.accepted.length) {
    return { profile: null, selection };
  }

  const allKeys = new Set();
  const labels = new Map();
  for (const record of selection.accepted) {
    for (const key of record.weights.keys()) allKeys.add(key);
    for (const [key, label] of record.labels) {
      if (!labels.has(key)) labels.set(key, label);
    }
  }
  const skillShares = [...allKeys]
    .filter((key) => key !== UNATTRIBUTED_SKILL)
    .map((key) => ({
      source: labels.get(key) ?? key,
      weight: selection.accepted.reduce(
        (sum, record) => sum + (record.weights.get(key) ?? 0),
        0,
      ) / selection.accepted.length,
    }))
    .filter((entry) => entry.weight >= minimumSkillShare)
    .sort((left, right) => right.weight - left.weight ||
      left.source.localeCompare(right.source, "ko"));
  const durations = selection.accepted.map(
    (record) => record.totalPlayTimeMilliseconds,
  );
  const dates = selection.accepted
    .map((record) => record.registerDate)
    .filter(Boolean)
    .sort();
  const profile = {
    aggregation: "mean-normalized-damage-share",
    stable: selection.stable,
    sampleCount: selection.accepted.length,
    candidateCount: candidates.length,
    rejectedCount: selection.rejected.length,
    medianPairDistance: selection.medianPairDistance,
    maximumPairDistance: selection.maximumPairDistance,
    recordDateRange: dates.length
      ? { from: dates[0], to: dates.at(-1) }
      : null,
    playTimeMilliseconds: {
      minimum: Math.min(...durations),
      median: median(durations),
      maximum: Math.max(...durations),
    },
    skillShares,
  };
  return {
    selection,
    profile: finalizeBattlePracticeProfileIdentity(characterClass, profile),
  };
}

export function finalizeBattlePracticeProfileIdentity(characterClass, profile) {
  const className = String(characterClass ?? "").trim();
  const sampleCount = Number(profile?.sampleCount) || 0;
  const skillShares = Array.isArray(profile?.skillShares)
    ? profile.skillShares.map(({ source, weight }) => ({ source, weight }))
    : [];
  const skillProfileHash = createHash("sha256")
    .update(JSON.stringify({ className, sampleCount, skillShares }))
    .digest("hex");
  const content = {
    characterClass: className,
    sampleCount,
    iedBlendConfidence: Number.isFinite(profile?.iedBlendConfidence)
      ? profile.iedBlendConfidence
      : 1,
    skillShares,
  };
  const profileHash = createHash("sha256")
    .update(JSON.stringify(content))
    .digest("hex");
  return {
    ...profile,
    skillProfileHash,
    profileHash,
    id: `${content.characterClass}-auto-cycle-${profileHash.slice(0, 12)}`,
  };
}

export function renderBattlePracticeProfilesModule(profiles) {
  const compactProfiles = Object.fromEntries(
    Object.entries(profiles).map(([characterClass, profile]) => {
      const finalized = finalizeBattlePracticeProfileIdentity(
        characterClass,
        profile,
      );
      return [characterClass, {
        id: finalized.id,
        skillProfileHash: finalized.skillProfileHash,
        profileHash: finalized.profileHash,
        sampleCount: finalized.sampleCount,
        iedBlendConfidence: Number.isFinite(finalized.iedBlendConfidence)
          ? finalized.iedBlendConfidence
          : 1,
        skillShares: finalized.skillShares,
      }];
    }),
  );
  const serialized = JSON.stringify(compactProfiles, null, 2);
  return `/**\n * 이 파일은 scripts/build-battle-practice-profiles.mjs가 생성합니다.\n * 원본 닉네임·리플레이·수집 코드는 웹 배포물에 포함하지 않습니다.\n */\nexport const CLASS_BATTLE_PRACTICE_DAMAGE_PROFILES = Object.freeze(${serialized});\n\nexport function classBattlePracticeDamageProfile(characterClass) {\n  return CLASS_BATTLE_PRACTICE_DAMAGE_PROFILES[\n    String(characterClass ?? \"\").trim()\n  ] ?? null;\n}\n`;
}
