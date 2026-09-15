const EQUIPMENT_STATS = ["STR", "DEX", "INT", "LUK"];

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * 새 프로필의 subStats 배열을 우선하고, 이전 프로필의 subStat도 계속 받는다.
 * 빈 subStats는 제논처럼 부스탯이 없다는 명시적인 값이므로 legacy 값으로
 * 다시 채우지 않는다.
 */
export function getProfileSubStats(profile = {}, { defaultSubStat = null } = {}) {
  const source = Array.isArray(profile?.subStats)
    ? profile.subStats
    : profile?.subStat !== undefined && profile?.subStat !== null
      ? [profile.subStat]
      : defaultSubStat !== undefined && defaultSubStat !== null
        ? [defaultSubStat]
        : [];
  const mainStat = String(profile?.mainStat ?? "").trim();
  return [
    ...new Set(
      source
        .map((stat) => String(stat ?? "").trim())
        .filter((stat) =>
          EQUIPMENT_STATS.includes(stat) && stat !== mainStat
        ),
    ),
  ];
}

export function getLegacySubStat(profile = {}, options) {
  return getProfileSubStats(profile, options)[0] ?? null;
}

/** 고정 스탯 1을 고정 주스탯 몇으로 볼지 반환한다. */
export function getFlatStatToFlatMainStat(profile = {}, stat) {
  const targetStat = String(stat ?? "").trim();
  const equivalence = profile?.statEquivalence ?? {};
  const mapped = finite(
    equivalence.flatStatToFlatMainStatByStat?.[targetStat],
  );
  if (mapped !== null) return mapped;
  if (targetStat === profile?.mainStat) return 1;
  if (getProfileSubStats(profile).includes(targetStat)) {
    return finite(equivalence.flatSubStatToFlatMainStat) ?? 0;
  }
  return 0;
}

/** 특정 스탯 1%를 주스탯 몇 %급으로 볼지 반환한다. */
export function getStatPercentToMainPercent(profile = {}, stat) {
  const targetStat = String(stat ?? "").trim();
  const equivalence = profile?.statEquivalence ?? {};
  const mapped = finite(
    equivalence.statPercentToMainPercentByStat?.[targetStat],
  );
  if (mapped !== null) return mapped;
  if (targetStat === profile?.mainStat) return 1;
  if (getProfileSubStats(profile).includes(targetStat)) {
    return finite(equivalence.subStatPercentToMainPercent) ?? 0;
  }
  return 0;
}

/** 심볼·HEXA처럼 스탯%가 반영되지 않는 스탯 1의 주스탯 %급이다. */
export function getUnreflectedStatToPercent(profile = {}, stat) {
  const targetStat = String(stat ?? "").trim();
  const equivalence = profile?.statEquivalence ?? {};
  const mapped = finite(
    equivalence.unreflectedStatToPercentByStat?.[targetStat],
  );
  if (mapped !== null) return mapped;
  const flatMainStatToPercent = finite(
    equivalence.flatMainStatToPercent,
  );
  return flatMainStatToPercent === null
    ? 0
    : getFlatStatToFlatMainStat(profile, targetStat) * flatMainStatToPercent;
}

/** 올스탯 고정 수치 1이 올리는 주스탯과 모든 부스탯의 합산 가치다. */
export function getAllStatFlatMainStat(profile = {}) {
  const stats = [profile?.mainStat, ...getProfileSubStats(profile)]
    .filter((stat) => EQUIPMENT_STATS.includes(stat));
  return [...new Set(stats)].reduce(
    (total, stat) => total + getFlatStatToFlatMainStat(profile, stat),
    0,
  );
}

/**
 * API가 보내는 새 맵을 보존하면서, 이전 단일 부스탯 프로필에도 같은 계약을
 * 제공한다. 호출부는 이후 항상 맵 기반으로 계산할 수 있다.
 */
export function withStatEquivalenceMaps(profile = {}) {
  const equivalence = profile?.statEquivalence ?? {};
  const next = {
    ...profile,
    subStats: getProfileSubStats(profile),
  };
  next.subStat = next.subStats[0] ?? null;
  next.statEquivalence = {
    ...equivalence,
    flatStatToFlatMainStatByStat: Object.fromEntries(
      EQUIPMENT_STATS.map((stat) => [
        stat,
        finite(equivalence.flatStatToFlatMainStatByStat?.[stat]) ??
          getFlatStatToFlatMainStat(next, stat),
      ]),
    ),
    statPercentToMainPercentByStat: Object.fromEntries(
      EQUIPMENT_STATS.map((stat) => [
        stat,
        finite(equivalence.statPercentToMainPercentByStat?.[stat]) ??
          getStatPercentToMainPercent(next, stat),
      ]),
    ),
    unreflectedStatToPercentByStat: Object.fromEntries(
      EQUIPMENT_STATS.map((stat) => [
        stat,
        finite(equivalence.unreflectedStatToPercentByStat?.[stat]) ??
          getUnreflectedStatToPercent(next, stat),
      ]),
    ),
  };
  return next;
}

export const DUAL_SUB_STAT_CLASSES = Object.freeze([
  "섀도어",
  "듀얼블레이더",
  "듀얼블레이드",
  "카데나",
]);

export function isDualSubStatClass(className) {
  return DUAL_SUB_STAT_CLASSES.includes(String(className ?? "").trim());
}
