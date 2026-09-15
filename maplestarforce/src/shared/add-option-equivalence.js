import { STAT_EQUIVALENCE } from "maple-core/potential";

export const LEGACY_DAMAGE_TO_MAIN_PERCENT = 0.8;

const KEYS = [
  "flatMainStatToDamagePercent",
  "flatSubStatToDamagePercent",
  "flatAttackToDamagePercent",
  "allStatPercentToDamagePercent",
];

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/** 기존 주스탯 %급 계수를 사용자가 읽기 쉬운 데미지 % 기준으로 바꾼다. */
export function statEquivalenceToDamageEquivalence(statEquivalence) {
  const damageToMain = positive(statEquivalence?.bossDamageToMainPercent);
  const flatMain = positive(statEquivalence?.flatMainStatToPercent);
  const flatSubRatio = positive(statEquivalence?.flatSubStatToFlatMainStat);
  const attackRatio = positive(statEquivalence?.attackToMainStat);
  const allStatToMain = positive(statEquivalence?.allStatPercentToMainPercent);
  if (!damageToMain || !flatMain || !flatSubRatio || !attackRatio || !allStatToMain) {
    return null;
  }
  return {
    flatMainStatToDamagePercent: flatMain / damageToMain,
    flatSubStatToDamagePercent: (flatMain * flatSubRatio) / damageToMain,
    flatAttackToDamagePercent: (flatMain * attackRatio) / damageToMain,
    allStatPercentToDamagePercent: allStatToMain / damageToMain,
  };
}

export const DEFAULT_ADD_OPTION_DAMAGE_EQUIVALENCE = Object.freeze(
  statEquivalenceToDamageEquivalence({
    ...STAT_EQUIVALENCE,
    bossDamageToMainPercent: LEGACY_DAMAGE_TO_MAIN_PERCENT,
  }),
);

/** v2에 저장된 보총 1% 계수도 새 네 입력값으로 손실 없이 옮긴다. */
export function normalizeAddOptionDamageEquivalence(source = {}) {
  const legacyDamageToMain = positive(source?.bossDamageToMainPercent);
  const legacy = legacyDamageToMain
    ? statEquivalenceToDamageEquivalence({
        ...STAT_EQUIVALENCE,
        bossDamageToMainPercent: legacyDamageToMain,
      })
    : DEFAULT_ADD_OPTION_DAMAGE_EQUIVALENCE;
  return Object.fromEntries(
    KEYS.map((key) => [key, positive(source?.[key]) ?? legacy[key]]),
  );
}

/** 새 데미지 % 입력을 코어가 쓰는 기존 주스탯 %급 계수로 되돌린다. */
export function damageEquivalenceToStatEquivalence(source) {
  const values = normalizeAddOptionDamageEquivalence(source);
  const mainDamage = positive(source?.flatMainStatToDamagePercent);
  const subDamage = positive(source?.flatSubStatToDamagePercent);
  const attackDamage = positive(source?.flatAttackToDamagePercent);
  const allStatDamage = positive(source?.allStatPercentToDamagePercent);
  if (!mainDamage || !subDamage || !attackDamage || !allStatDamage) {
    throw new RangeError("추옵 환산값은 모두 0보다 크게 입력해 주세요.");
  }
  const flatMain = STAT_EQUIVALENCE.flatMainStatToPercent;
  return {
    ...STAT_EQUIVALENCE,
    flatMainStatToPercent: flatMain,
    flatSubStatToFlatMainStat:
      values.flatSubStatToDamagePercent / values.flatMainStatToDamagePercent,
    attackToMainStat:
      values.flatAttackToDamagePercent / values.flatMainStatToDamagePercent,
    bossDamageToMainPercent:
      flatMain / values.flatMainStatToDamagePercent,
    allStatPercentToMainPercent:
      values.allStatPercentToDamagePercent *
      flatMain /
      values.flatMainStatToDamagePercent,
  };
}
