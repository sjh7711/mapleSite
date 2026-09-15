import {
  POTENTIAL_PAGE_TARGETS,
} from "maple-core/potential";

export const MIN_TARGET_CHANCE_PERCENT = 0.01;
export const MAX_TARGET_CHANCE_PERCENT = 99.99;
// 희박한 독립 시행에서 평균 시도 횟수의 누적 성공 확률인 1 - e^-1.
export const DEFAULT_TARGET_CHANCE_PERCENT = 63.21;
export const TARGET_CHANCE_DEFAULT_REVISION = 1;

// 잠재·에디셔널에서 직업/부위에 따라 자주 직접 찾는 특수 옵션은 항상
// 목록 위에 둔다. 목록에 존재하지 않는 옵션은 정렬 과정에서 자연스럽게 빠진다.
export const PRIORITY_POTENTIAL_TARGET_TYPES = Object.freeze([
  "attack-power-percent",
  "magic-power-percent",
  "boss-damage",
  "ignore-defense",
  "damage",
  "cooldown",
  "critical-damage",
  "critical-rate",
]);

// 일반 잠재의 공격력·마력 고정 수치는 필요한 경우 고를 수 있게 하되,
// 자주 찾는 비율·특수 옵션보다 앞에 섞이지 않도록 목록 맨 아래에 둔다.
const REGULAR_TRAILING_TARGET_TYPES = Object.freeze([
  "attack-power-flat",
  "magic-power-flat",
]);

export const ADDITIONAL_TARGET_TYPE_ORDER = Object.freeze([
  ...PRIORITY_POTENTIAL_TARGET_TYPES,
  "stat-equivalent",
  "str-percent",
  "dex-percent",
  "int-percent",
  "luk-percent",
  "hp-percent",
  "all-stat-percent",
  "drop",
  "meso",
  "str-per-nine",
  "dex-per-nine",
  "int-per-nine",
  "luk-per-nine",
  "str-flat",
  "dex-flat",
  "int-flat",
  "luk-flat",
  "hp-flat",
  "attack-power-flat",
  "magic-power-flat",
  "all-stat-flat",
  "auto-steal",
]);

export function normalizePotentialTargetChance(
  value,
  fallback = DEFAULT_TARGET_CHANCE_PERCENT,
) {
  if (value === "" || value === null || value === undefined) return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(
    MAX_TARGET_CHANCE_PERCENT,
    Math.max(
      MIN_TARGET_CHANCE_PERCENT,
      Math.round(numeric * 100) / 100,
    ),
  );
}

/** 과거 기본값 50%만 한 번 옮기고 사용자가 정한 값은 그대로 둔다. */
export function migratePotentialTargetChanceDefault({
  targetChancePercent,
  targetChanceDefaultRevision,
}) {
  const shouldMigrateLegacyDefault =
    targetChanceDefaultRevision !== TARGET_CHANCE_DEFAULT_REVISION &&
    Number(targetChancePercent) === 50;

  return {
    targetChancePercent: normalizePotentialTargetChance(
      shouldMigrateLegacyDefault
        ? DEFAULT_TARGET_CHANCE_PERCENT
        : targetChancePercent,
    ),
    targetChanceDefaultRevision: TARGET_CHANCE_DEFAULT_REVISION,
  };
}

/** 화면에 노출하는 유효 목표의 라벨과 단위를 돌려준다. */
export function getPotentialTargetInfo(type) {
  const fixed = POTENTIAL_PAGE_TARGETS[type];
  if (fixed) return { ...fixed, exact: false };
  return null;
}

/** 빈 목표는 유지하되, 공식 옵션 원문 목표는 실제 잠재 줄 수(1~3)만 받는다. */
export function isCompletePotentialTarget(target) {
  const info = getPotentialTargetInfo(target?.type);
  const value = Number(target?.value);
  if (!info || !Number.isFinite(value) || value <= 0) return false;
  return !info.exact || (Number.isSafeInteger(value) && value <= 3);
}

/** 환산 가능한 조건만 합산하고, 제외한 조건은 이름을 숨기지 않는다. */
export function summarizePotentialTargetEquivalents(items) {
  const values = Array.isArray(items) ? items : [];
  const converted = values.filter(({ mainStatPercent, attackPercent }) =>
    Number.isFinite(mainStatPercent) && Number.isFinite(attackPercent)
  );
  const excludedLabels = values
    .filter(({ mainStatPercent, attackPercent }) =>
      !Number.isFinite(mainStatPercent) || !Number.isFinite(attackPercent)
    )
    .map(({ label }) => label)
    .filter(Boolean);
  const excluded = excludedLabels.length > 0
    ? ` · 환산 제외: ${excludedLabels.join(", ")}`
    : "";

  if (converted.length === 0) {
    return values.length > 0
      ? `조건 기준 환산 · 환산 가능한 조건 없음${excluded}`
      : "";
  }

  const format = (value) => Number(value).toLocaleString("ko-KR", {
    maximumFractionDigits: 2,
  });
  const main = converted.reduce(
    (sum, equivalent) => sum + equivalent.mainStatPercent,
    0,
  );
  const attack = converted.reduce(
    (sum, equivalent) => sum + equivalent.attackPercent,
    0,
  );
  return `조건 기준 환산 · 주스탯 ${format(main)}%급 · 공/마 ${format(attack)}%급${excluded}`;
}

/** 잠재·에디셔널의 긴 목표 목록에서 주요 특수 옵션을 먼저 표시한다. */
export function orderPotentialTargetTypes(types, { system } = {}) {
  const values = Array.isArray(types) ? [...types] : [];
  const orderedTypes = system === "additional"
    ? ADDITIONAL_TARGET_TYPE_ORDER
    : PRIORITY_POTENTIAL_TARGET_TYPES;
  const priority = new Map(
    orderedTypes.map((type, index) => [type, index]),
  );
  const trailing = system === "regular"
    ? new Map(
        REGULAR_TRAILING_TARGET_TYPES.map((type, index) => [type, index]),
      )
    : new Map();
  const originalOrder = new Map(values.map((type, index) => [type, index]));
  return values.sort((left, right) => {
    const leftPriority = priority.get(left) ?? Number.POSITIVE_INFINITY;
    const rightPriority = priority.get(right) ?? Number.POSITIVE_INFINITY;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;

    const leftTrailing = trailing.has(left);
    const rightTrailing = trailing.has(right);
    if (leftTrailing !== rightTrailing) return leftTrailing ? 1 : -1;
    if (leftTrailing && rightTrailing) {
      return trailing.get(left) - trailing.get(right);
    }
    return (originalOrder.get(left) ?? 0) - (originalOrder.get(right) ?? 0);
  });
}

/** 한 세트에서 중복 목표를 막고, 주스탯%급만 캐릭터 정보가 있을 때 첫 줄에 허용한다. */
export function getPotentialTargetTypesForRow({
  availableTargetTypes,
  targets,
  index,
  hasProfile,
}) {
  if (index > 0 && targets[0]?.type === "stat-equivalent") return [];
  const previousTypes = new Set(
    targets.slice(0, index).map((target) => target.type).filter(Boolean),
  );
  return availableTargetTypes.filter((type) =>
    !previousTypes.has(type) &&
    (type !== "stat-equivalent" || (hasProfile && index === 0))
  );
}
