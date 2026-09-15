function finiteNumber(value) {
  const parsed = Number(String(value ?? "").replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizedProfileSkillName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

function combinedIgnoreDefense(sources) {
  return 1 - (sources ?? []).reduce(
    (remaining, source) => remaining * (1 - Math.max(
      0,
      Math.min(100, finiteNumber(source)),
    ) / 100),
    1,
  );
}

/** 메이플 방어식의 한 공격 채널 피해 배율. */
export function defenseDamageMultiplier({
  globalIgnoreDefense,
  localIgnoreDefenseSources = [],
  targetDefenseRemaining = 1,
  enemyDefense = 3.8,
}) {
  const global = Math.max(0, Math.min(1, finiteNumber(globalIgnoreDefense)));
  const local = combinedIgnoreDefense(localIgnoreDefenseSources);
  const remaining = (1 - global) * (1 - local);
  return Math.max(
    0,
    1 - Math.max(0, finiteNumber(enemyDefense)) *
      Math.max(0, Math.min(1, finiteNumber(targetDefenseRemaining))) *
      remaining,
  );
}

function normalizedChannels(channels) {
  const merged = new Map();
  for (const channel of channels ?? []) {
    const source = normalizedProfileSkillName(channel?.source);
    const weight = Math.max(0, finiteNumber(channel?.weight));
    if (!source || !(weight > 0)) continue;
    const current = merged.get(source) ?? {
      source,
      weight: 0,
      localIgnoreDefenseSources: [],
      donorDefenseMultiplierTotal: 0,
      donorDefenseMultiplierWeight: 0,
      donorGlobalIgnoreDefenseTotal: 0,
      donorGlobalIgnoreDefenseWeight: 0,
      donorTargetDefenseRemainingTotal: 0,
      donorTargetDefenseRemainingWeight: 0,
    };
    current.weight += weight;
    current.localIgnoreDefenseSources.push(...(
      channel?.localIgnoreDefenseSources ?? channel?.ignoreDefenseSources ?? []
    ));
    current.localIgnoreDefenseSources = [
      ...new Set(current.localIgnoreDefenseSources.map(finiteNumber)),
    ].filter((value) => value > 0);
    const donorDefenseMultiplier = Number(channel?.donorDefenseMultiplier);
    if (Number.isFinite(donorDefenseMultiplier) && donorDefenseMultiplier > 0) {
      current.donorDefenseMultiplierTotal += donorDefenseMultiplier * weight;
      current.donorDefenseMultiplierWeight += weight;
    }
    const donorGlobalIgnoreDefense = Number(channel?.donorGlobalIgnoreDefense);
    if (Number.isFinite(donorGlobalIgnoreDefense)) {
      current.donorGlobalIgnoreDefenseTotal += donorGlobalIgnoreDefense * weight;
      current.donorGlobalIgnoreDefenseWeight += weight;
    }
    const donorTargetDefenseRemaining = Number(
      channel?.donorTargetDefenseRemaining,
    );
    if (Number.isFinite(donorTargetDefenseRemaining)) {
      current.donorTargetDefenseRemainingTotal +=
        donorTargetDefenseRemaining * weight;
      current.donorTargetDefenseRemainingWeight += weight;
    }
    merged.set(source, current);
  }
  const total = [...merged.values()].reduce(
    (sum, channel) => sum + channel.weight,
    0,
  );
  if (!(total > 0)) return [];
  return [...merged.values()].map((channel) => {
    const normalized = {
      source: channel.source,
      weight: channel.weight / total,
      localIgnoreDefenseSources: channel.localIgnoreDefenseSources,
    };
    if (channel.donorDefenseMultiplierWeight > 0) {
      normalized.donorDefenseMultiplier =
        channel.donorDefenseMultiplierTotal /
        channel.donorDefenseMultiplierWeight;
    }
    if (channel.donorGlobalIgnoreDefenseWeight > 0) {
      normalized.donorGlobalIgnoreDefense =
        channel.donorGlobalIgnoreDefenseTotal /
        channel.donorGlobalIgnoreDefenseWeight;
    }
    if (channel.donorTargetDefenseRemainingWeight > 0) {
      normalized.donorTargetDefenseRemaining =
        channel.donorTargetDefenseRemainingTotal /
        channel.donorTargetDefenseRemainingWeight;
    }
    return normalized;
  });
}

/**
 * 연무장의 사후 피해 점유율에서 기증 캐릭터의 방어 효과를 나눠 방어 적용
 * 전 점유율을 복원한다. 피해 배율 0인 채널은 역산할 수 없으므로 실패한다.
 */
export function inferRawDamageShares({
  observedChannels,
  donorGlobalIgnoreDefense,
  donorTargetDefenseRemaining = 1,
  enemyDefense = 3.8,
}) {
  const channels = normalizedChannels(observedChannels);
  const inferred = [];
  for (const channel of channels) {
    const suppliedMultiplier = Number(channel?.donorDefenseMultiplier);
    const defenseMultiplier = Number.isFinite(suppliedMultiplier) &&
        suppliedMultiplier > 0
      ? suppliedMultiplier
      : defenseDamageMultiplier({
        globalIgnoreDefense: Number.isFinite(
            Number(channel?.donorGlobalIgnoreDefense),
          )
          ? Number(channel.donorGlobalIgnoreDefense)
          : donorGlobalIgnoreDefense,
        localIgnoreDefenseSources: channel.localIgnoreDefenseSources,
        targetDefenseRemaining: Number.isFinite(
            Number(channel?.donorTargetDefenseRemaining),
          )
          ? Number(channel.donorTargetDefenseRemaining)
          : donorTargetDefenseRemaining,
        enemyDefense,
      });
    if (!(defenseMultiplier > 0)) {
      throw new Error(`${channel.source}의 방어 적용 전 점유율을 역산할 수 없습니다.`);
    }
    inferred.push({
      source: channel.source,
      rawWeight: channel.weight / defenseMultiplier,
      localIgnoreDefenseSources: channel.localIgnoreDefenseSources,
      observedWeight: channel.weight,
      donorDefenseMultiplier: defenseMultiplier,
    });
  }
  const total = inferred.reduce((sum, channel) => sum + channel.rawWeight, 0);
  return inferred.map((channel) => ({
    ...channel,
    rawWeight: channel.rawWeight / total,
  }));
}

/** 대상 캐릭터의 방무를 방어 전 점유율에 다시 적용한다. */
export function applyDefenseToRawShares({
  rawChannels,
  globalIgnoreDefense,
  targetDefenseRemaining = 1,
  enemyDefense = 3.8,
}) {
  const applied = (rawChannels ?? []).map((channel) => {
    const multiplier = defenseDamageMultiplier({
      globalIgnoreDefense,
      localIgnoreDefenseSources:
        channel?.localIgnoreDefenseSources ?? channel?.ignoreDefenseSources,
      targetDefenseRemaining,
      enemyDefense,
    });
    return {
      ...channel,
      defenseMultiplier: multiplier,
      defendedWeight: Math.max(0, finiteNumber(channel?.rawWeight)) * multiplier,
    };
  });
  const total = applied.reduce((sum, channel) => sum + channel.defendedWeight, 0);
  return {
    totalDamageFactor: total,
    channels: applied.map((channel) => ({
      ...channel,
      weight: total > 0 ? channel.defendedWeight / total : 0,
    })),
  };
}

/** 추가 방무 전후의 직업 전체 최종 데미지 증가율. */
export function rawProfileIgnoreDefenseGain({
  rawChannels,
  currentIgnoreDefense,
  addedIgnoreDefense,
  targetDefenseRemaining = 1,
  enemyDefense = 3.8,
}) {
  const current = Math.max(0, Math.min(1, finiteNumber(currentIgnoreDefense)));
  const added = Math.max(0, Math.min(1, finiteNumber(addedIgnoreDefense)));
  const after = 1 - (1 - current) * (1 - added);
  const beforeDamage = applyDefenseToRawShares({
    rawChannels,
    globalIgnoreDefense: current,
    targetDefenseRemaining,
    enemyDefense,
  }).totalDamageFactor;
  const afterDamage = applyDefenseToRawShares({
    rawChannels,
    globalIgnoreDefense: after,
    targetDefenseRemaining,
    enemyDefense,
  }).totalDamageFactor;
  return beforeDamage > 0 ? afterDamage / beforeDamage - 1 : null;
}

/** 여러 독립 기증자의 방어 전 프로필을 직업 평균으로 합친다. */
export function aggregateRawDamageProfiles(profiles) {
  const valid = (profiles ?? []).filter((profile) =>
    Array.isArray(profile) && profile.length
  );
  if (!valid.length) return [];
  const merged = new Map();
  for (const profile of valid) {
    for (const channel of profile) {
      const source = normalizedProfileSkillName(channel?.source);
      if (!source) continue;
      const current = merged.get(source) ?? {
        source,
        rawWeight: 0,
        localSourceVotes: new Map(),
      };
      current.rawWeight += Math.max(0, finiteNumber(channel?.rawWeight));
      const sourceKey = JSON.stringify(
        [...(channel?.localIgnoreDefenseSources ?? [])].sort((a, b) => a - b),
      );
      current.localSourceVotes.set(
        sourceKey,
        (current.localSourceVotes.get(sourceKey) ?? 0) + 1,
      );
      merged.set(source, current);
    }
  }
  const rows = [...merged.values()].map((entry) => {
    const selectedSources = [...entry.localSourceVotes.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? "[]";
    return {
      source: entry.source,
      rawWeight: entry.rawWeight / valid.length,
      localIgnoreDefenseSources: JSON.parse(selectedSources),
    };
  });
  const total = rows.reduce((sum, row) => sum + row.rawWeight, 0);
  return rows
    .map((row) => ({ ...row, rawWeight: total > 0 ? row.rawWeight / total : 0 }))
    .sort((left, right) => right.rawWeight - left.rawWeight);
}
