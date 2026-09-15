import { calculateDamageChannelIgnoreDefenseGain } from "maple-core/combat-model";

function number(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function relativeError(actual, reference) {
  return Number.isFinite(actual) && reference > 0
    ? (actual / reference - 1) * 100
    : null;
}

function normalizedSkillName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+VI(?=\s*(?:[:：(（]|$))/gu, "")
    .replace(/\s+/gu, "")
    .trim();
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function removeIgnoreDefenseSources(currentIgnoreDefense, sources) {
  let remaining = 1 - number(currentIgnoreDefense);
  for (const source of sources ?? []) {
    const value = number(source);
    if (!(value > 0 && value < 100)) continue;
    remaining /= 1 - value / 100;
  }
  return Math.max(0, Math.min(1, 1 - remaining));
}

export function applyIgnoreDefenseSources(currentIgnoreDefense, sources) {
  let remaining = 1 - number(currentIgnoreDefense);
  for (const source of sources ?? []) {
    const value = number(source);
    if (!(value > 0 && value <= 100)) continue;
    remaining *= 1 - value / 100;
  }
  return Math.max(0, Math.min(1, 1 - remaining));
}

export function deriveOneMainPercentRelative({
  currentIgnoreDefense,
  enemyDefense,
  targetDefenseRemaining = 1,
  unprofiledEquivalent,
}) {
  const parsedCurrentIgnoreDefense = number(currentIgnoreDefense, NaN);
  const parsedEnemyDefense = number(enemyDefense, NaN);
  const parsedTargetDefenseRemaining = number(targetDefenseRemaining, NaN);
  if (
    !Number.isFinite(parsedCurrentIgnoreDefense) ||
    parsedCurrentIgnoreDefense < 0 || parsedCurrentIgnoreDefense > 1 ||
    !(parsedEnemyDefense > 0) ||
    !(parsedTargetDefenseRemaining > 0)
  ) return null;
  const gain = calculateDamageChannelIgnoreDefenseGain({
    currentIgnoreDefense: parsedCurrentIgnoreDefense,
    addedIgnoreDefense: 0.4,
    enemyDefense: parsedEnemyDefense * parsedTargetDefenseRemaining,
    channels: [],
  });
  const equivalent = number(unprofiledEquivalent);
  return gain > 0 && equivalent > 0 ? gain / equivalent : null;
}

export function counterfactualIgnoreDefenseEquivalent({
  currentIgnoreDefense,
  removedIgnoreDefenseSources = [],
  enemyDefense,
  targetDefenseRemaining = 1,
  oneMainPercentRelative,
  channels = [],
}) {
  if (!(oneMainPercentRelative > 0)) return null;
  const parsedCurrentIgnoreDefense = number(currentIgnoreDefense, NaN);
  if (
    !Number.isFinite(parsedCurrentIgnoreDefense) ||
    parsedCurrentIgnoreDefense < 0 || parsedCurrentIgnoreDefense > 1
  ) return null;
  const counterfactualIgnoreDefense = removeIgnoreDefenseSources(
    parsedCurrentIgnoreDefense,
    removedIgnoreDefenseSources,
  );
  const gain = calculateDamageChannelIgnoreDefenseGain({
    currentIgnoreDefense: counterfactualIgnoreDefense,
    addedIgnoreDefense: 0.4,
    enemyDefense: number(enemyDefense) * number(targetDefenseRemaining, 1),
    channels,
  });
  return gain > 0 ? gain / oneMainPercentRelative : null;
}

function referenceEquivalentUptime({
  currentIgnoreDefense,
  effectSources,
  enemyDefense,
  targetDefenseRemaining,
  oneMainPercentRelative,
  channels,
  referenceEquivalent,
}) {
  if (
    !(referenceEquivalent > 0) ||
    !(oneMainPercentRelative > 0) ||
    !effectSources.length
  ) return null;
  const withoutEffect = removeIgnoreDefenseSources(
    currentIgnoreDefense,
    effectSources,
  );
  const equivalentAt = (uptime) => {
    const withScaledEffect = applyIgnoreDefenseSources(
      withoutEffect,
      effectSources.map((source) => source * uptime),
    );
    const gain = calculateDamageChannelIgnoreDefenseGain({
      currentIgnoreDefense: withScaledEffect,
      addedIgnoreDefense: 0.4,
      enemyDefense: number(enemyDefense) * number(targetDefenseRemaining, 1),
      channels,
    });
    return gain / oneMainPercentRelative;
  };
  const atZero = equivalentAt(0);
  const atOne = equivalentAt(1);
  if (
    referenceEquivalent > Math.max(atZero, atOne) ||
    referenceEquivalent < Math.min(atZero, atOne)
  ) return null;
  let low = 0;
  let high = 1;
  for (let index = 0; index < 60; index += 1) {
    const middle = (low + high) / 2;
    // 방무 가동률이 높을수록 추가 방무 40%의 한계 효율은 낮아진다.
    if (equivalentAt(middle) > referenceEquivalent) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function skillObjects(record) {
  return record?.characterInfo?.skill_object?.character_skill ?? [];
}

function skillDurationSeconds(record, source) {
  const key = normalizedSkillName(source);
  const matches = skillObjects(record).filter(
    (skill) => normalizedSkillName(skill?.skill_name) === key,
  );
  const durations = matches.flatMap((skill) => [
    ...String(skill?.skill_effect ?? "").matchAll(/(\d+(?:\.\d+)?)초 동안/gu),
  ]).map((match) => number(match[1])).filter((value) => value > 0);
  return durations.length ? Math.max(...durations) : null;
}

function mergedCoverage(intervals, totalMilliseconds) {
  const clipped = intervals
    .map(([start, end]) => [
      Math.max(0, start),
      Math.min(totalMilliseconds, end),
    ])
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0]);
  if (!clipped.length || !(totalMilliseconds > 0)) return null;
  let covered = 0;
  let [start, end] = clipped[0];
  for (const [nextStart, nextEnd] of clipped.slice(1)) {
    if (nextStart <= end) {
      end = Math.max(end, nextEnd);
    } else {
      covered += end - start;
      [start, end] = [nextStart, nextEnd];
    }
  }
  covered += end - start;
  return covered / totalMilliseconds;
}

export function timelineActivationEvidence(record, source) {
  if (!record) return null;
  const key = normalizedSkillName(source);
  const rawUses = (record?.skillTimeline?.entries ?? [])
    .filter((entry) => normalizedSkillName(entry?.skill_name) === key)
    .map((entry) => number(entry?.elapse_time))
    .filter((value) => value >= 0)
    .sort((left, right) => left - right);
  // 같은 프레임에 중복 기록된 입력은 한 번의 사용으로 본다.
  const uses = rawUses.filter(
    (value, index) => index === 0 || value - rawUses[index - 1] >= 1_000,
  );
  if (!uses.length) return null;
  const totalMilliseconds = number(record?.result?.total_play_time);
  const durationSeconds = skillDurationSeconds(record, source);
  const gaps = uses.slice(1).map((value, index) => value - uses[index]);
  const coverage = durationSeconds && totalMilliseconds > 0
    ? mergedCoverage(
        uses.map((start) => [start, start + durationSeconds * 1_000]),
        totalMilliseconds,
      )
    : null;
  return {
    rawUseCount: rawUses.length,
    useCount: uses.length,
    firstUseMilliseconds: uses[0],
    medianGapMilliseconds: median(gaps),
    durationSeconds,
    coverage,
    recordDurationMilliseconds: totalMilliseconds || null,
  };
}

export function analyzeCombatEffectProvenance(row, record = null) {
  const currentIgnoreDefense = number(
    row?.combatDiagnostics?.currentIgnoreDefense,
    NaN,
  );
  const targetDefenseRemaining = number(
    row?.combatDiagnostics?.targetDefenseRemaining,
    1,
  );
  const channels = row?.combatDiagnostics?.damageChannels ?? [];
  const oneMainPercentRelative = deriveOneMainPercentRelative({
    currentIgnoreDefense,
    enemyDefense: 3.8,
    targetDefenseRemaining,
    unprofiledEquivalent: row?.unprofiled380,
  });
  const appliedEffects = (row?.combatDiagnostics?.effects ?? []).filter(
    (effect) => effect?.applied,
  );
  const candidates = appliedEffects
    .map((effect) => ({
      effect,
      sources: (effect?.averagedModifiers?.ignoreDefenseSources ?? [])
        .map(number)
        .filter((value) => value > 0),
    }))
    .filter(({ sources }) => sources.length)
    .map(({ effect, sources }) => {
      const equivalent300 = counterfactualIgnoreDefenseEquivalent({
        currentIgnoreDefense,
        removedIgnoreDefenseSources: sources,
        enemyDefense: 3,
        targetDefenseRemaining,
        oneMainPercentRelative,
        channels,
      });
      const equivalent380 = counterfactualIgnoreDefenseEquivalent({
        currentIgnoreDefense,
        removedIgnoreDefenseSources: sources,
        enemyDefense: 3.8,
        targetDefenseRemaining,
        oneMainPercentRelative,
        channels,
      });
      const evidence = timelineActivationEvidence(record, effect.source);
      const inferredReferenceUptime = referenceEquivalentUptime({
        currentIgnoreDefense,
        effectSources: sources,
        enemyDefense: 3.8,
        targetDefenseRemaining,
        oneMainPercentRelative,
        channels,
        referenceEquivalent: number(row?.ied380),
      });
      const error300Percent = relativeError(equivalent300, number(row?.ied300));
      const error380Percent = relativeError(equivalent380, number(row?.ied380));
      const currentError380 = relativeError(
        number(row?.actual380, null),
        number(row?.ied380, null),
      );
      const materiallyImprovesReference =
        Number.isFinite(error380Percent) && Number.isFinite(currentError380) &&
        Math.abs(error380Percent) + 0.5 < Math.abs(currentError380);
      const observedMaintained = number(evidence?.coverage, -1) >= 0.9;
      return {
        source: effect.source,
        sourceKey: effect.sourceKey ?? null,
        layer: effect.layer,
        kind: effect.kind,
        removedIgnoreDefenseSources: sources,
        equivalent300,
        equivalent380,
        error300Percent,
        error380Percent,
        timelineEvidence: evidence,
        referenceEquivalentUptime: inferredReferenceUptime,
        activationCoverageGap:
          Number.isFinite(inferredReferenceUptime) &&
            Number.isFinite(evidence?.coverage)
            ? evidence.coverage - inferredReferenceUptime
            : null,
        diagnosis: materiallyImprovesReference && observedMaintained
          ? "reference-preset-divergence"
          : materiallyImprovesReference
            ? "activation-or-baseline-overlap-review"
            : "not-primary-reference-gap",
      };
    })
    .sort((left, right) =>
      Math.abs(number(left.error380Percent, Infinity)) -
      Math.abs(number(right.error380Percent, Infinity))
    );

  return {
    characterName: row?.characterName ?? null,
    characterClass: row?.characterClass ?? null,
    currentIgnoreDefense,
    oneMainPercentRelative,
    reference: {
      ied300: number(row?.ied300, null),
      ied380: number(row?.ied380, null),
    },
    current: {
      equivalent300: number(row?.actual300, null),
      equivalent380: number(row?.actual380, null),
      error300Percent: relativeError(
        number(row?.actual300, null),
        number(row?.ied300, null),
      ),
      error380Percent: relativeError(
        number(row?.actual380, null),
        number(row?.ied380, null),
      ),
    },
    candidates,
  };
}
