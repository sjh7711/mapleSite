function countOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function upgradeBody(value) {
  if (value?.item?.upgrade && typeof value.item.upgrade === "object") {
    return value.item.upgrade;
  }
  if (value?.upgrade && typeof value.upgrade === "object") return value.upgrade;
  return value && typeof value === "object" ? value : {};
}

/**
 * API의 upgrade.max를 우선 사용한다. 구 공개 shard처럼 max가 빠진 자료는
 * `적용 + 잔여 + 복구 가능`의 불변합으로 같은 값을 복원한다.
 */
export function readUpgradeSlotMaximum(value) {
  const upgrade = upgradeBody(value);
  const explicit = countOrNull(upgrade.max ?? upgrade.maximum);
  if (explicit !== null) return explicit;

  const applied = countOrNull(upgrade.applied);
  const remaining = countOrNull(upgrade.remaining);
  const recoverable = countOrNull(upgrade.recoverable);
  return applied === null || remaining === null || recoverable === null
    ? null
    : applied + remaining + recoverable;
}

/** 동일 장비 판매 표본에서 가장 많이 관측된 고정 업그레이드 최대 횟수. */
export function inferItemUpgradeSlotMaximum(records) {
  const frequencies = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const maximum = readUpgradeSlotMaximum(record);
    if (maximum === null) continue;
    frequencies.set(maximum, (frequencies.get(maximum) || 0) + 1);
  }
  if (!frequencies.size) return null;
  return [...frequencies.entries()]
    .sort(([leftMaximum, leftCount], [rightMaximum, rightCount]) =>
      rightCount - leftCount || leftMaximum - rightMaximum
    )[0][0];
}

/**
 * 인게임에 표시되는 잔여·복구 가능과 장비의 고정 최대 횟수만으로
 * 이미 적용된 주문서 수를 계산한다. 모순되거나 불완전한 값이면 null이다.
 */
export function deriveAppliedUpgradeCount({ maximum, remaining, recoverable } = {}) {
  const normalizedMaximum = countOrNull(maximum);
  const normalizedRemaining = countOrNull(remaining);
  const normalizedRecoverable = countOrNull(recoverable);
  if (
    normalizedMaximum === null ||
    normalizedRemaining === null ||
    normalizedRecoverable === null
  ) {
    return null;
  }
  const applied = normalizedMaximum - normalizedRemaining - normalizedRecoverable;
  return applied >= 0 ? applied : null;
}
