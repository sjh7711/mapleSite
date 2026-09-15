export const STARFORCE_EVENTS = {
  none: {
    label: "이벤트 없음",
    discount: false,
    destroyReduction: false,
    guaranteed15: false,
    restoreDiscount: false,
  },
  discount30: {
    label: "강화비용 30% 할인",
    discount: true,
    destroyReduction: false,
    guaranteed15: false,
    restoreDiscount: false,
  },
  destroy30: {
    label: "파괴확률 30% 감소",
    discount: false,
    destroyReduction: true,
    guaranteed15: false,
    restoreDiscount: false,
  },
  shining: {
    label: "샤이닝 스타포스",
    discount: true,
    destroyReduction: true,
    guaranteed15: false,
    restoreDiscount: true,
  },
  shining15: {
    label: "샤이닝 + 15→16 확정",
    discount: true,
    destroyReduction: true,
    guaranteed15: true,
    restoreDiscount: true,
  },
};

export const STARFORCE_MVP = {
  none: { label: "MVP 없음", discount: 0 },
  silver: { label: "MVP 실버", discount: 0.03 },
  gold: { label: "MVP 골드", discount: 0.05 },
  diamond: { label: "MVP 다이아", discount: 0.1 },
};

export const DEFAULT_STARFORCE_EVENT = "shining";
export const DEFAULT_STARFORCE_MVP = "diamond";

const BASE_PROBABILITIES = {
  0: [0.95, 0.05, 0],
  1: [0.9, 0.1, 0],
  2: [0.85, 0.15, 0],
  3: [0.85, 0.15, 0],
  4: [0.8, 0.2, 0],
  5: [0.75, 0.25, 0],
  6: [0.7, 0.3, 0],
  7: [0.65, 0.35, 0],
  8: [0.6, 0.4, 0],
  9: [0.55, 0.45, 0],
  10: [0.5, 0.5, 0],
  11: [0.45, 0.55, 0],
  12: [0.4, 0.6, 0],
  13: [0.35, 0.65, 0],
  14: [0.3, 0.7, 0],
  15: [0.3, 0.679, 0.021],
  16: [0.3, 0.679, 0.021],
  17: [0.15, 0.782, 0.068],
  18: [0.15, 0.782, 0.068],
  19: [0.15, 0.765, 0.085],
  20: [0.3, 0.595, 0.105],
  21: [0.15, 0.7225, 0.1275],
  22: [0.15, 0.68, 0.17],
  23: [0.1, 0.72, 0.18],
  24: [0.1, 0.72, 0.18],
  25: [0.1, 0.72, 0.18],
  26: [0.07, 0.744, 0.186],
  27: [0.05, 0.76, 0.19],
  28: [0.03, 0.776, 0.194],
  29: [0.01, 0.792, 0.198],
};

const RESTORE_EQUIPMENT = {
  15: 1,
  16: 1,
  17: 1,
  18: 1,
  19: 2,
  20: 2,
  21: 3,
  22: 4,
};

// 복구 비용은 착용 레벨의 세제곱에 성급별 계수를 곱한 값이다. 140/160/200/250제
// 실제 값이 이 규칙에 0.7% 안쪽으로 들어맞아, 자료가 없는 135·145제는 같은 계수로 채웠다.
// 흔적 복구에 드는 메소. 억 단위 값을 그대로 적고 쓸 때 환산한다.
// 130·135제는 20성 이상 복구를 지원하지 않아 값이 없다.
const RESTORE_COSTS_EOK = {
  130: { 15: 1.19, 16: 2.87, 17: 4.85, 18: 11.03, 19: 18.27 },
  135: { 15: 1.33, 16: 3.21, 17: 5.42, 18: 12.31, 19: 20.43 },
  140: { 15: 1.48, 16: 3.58, 17: 6.05, 18: 13.74, 19: 22.79, 20: 40.15, 21: 50.45, 22: 82.9 },
  145: { 15: 1.65, 16: 3.98, 17: 6.71, 18: 15.28, 19: 25.4, 20: 44.5, 21: 56.05, 22: 92.25 },
  150: { 15: 1.83, 16: 4.41, 17: 7.45, 18: 16.89, 19: 28.03, 20: 49.44, 21: 62.24, 22: 101.79 },
  160: { 15: 2.22, 16: 5.35, 17: 9.03, 18: 20.5, 19: 34.02, 20: 59.93, 21: 75.31, 22: 123.74 },
  200: { 15: 4.33, 16: 10.44, 17: 17.64, 18: 40.05, 19: 66.44, 20: 117.06, 21: 147.09, 22: 241.68 },
  250: { 15: 8.46, 16: 20.39, 17: 34.46, 18: 78.21, 19: 129.77, 20: 228.63, 21: 287.28, 22: 472.04 },
};

const RESTORE_COSTS = Object.fromEntries(
  Object.entries(RESTORE_COSTS_EOK).map(([level, row]) => [
    Number(level),
    Object.fromEntries(
      Object.entries(row).map(([star, eok]) => [Number(star), eok * 100_000_000]),
    ),
  ]),
);
/** 착용 레벨이 낮으면 올릴 수 있는 성급 자체가 막혀 있다. */
export function getMaxStarforceStar(itemLevel) {
  if (itemLevel < 95) return 5;
  if (itemLevel <= 107) return 10;
  if (itemLevel <= 127) return 15;
  if (itemLevel <= 137) return 20;
  return 30;
}

export const SUPPORTED_STARFORCE_LEVELS = Object.keys(RESTORE_COSTS).map(Number);
// 파괴 방지를 쓸 수 있는 성급과, 해당 성급으로 확정 복구할 수 있는 성급.
export const SAFEGUARD_STARS = [15, 16, 17];
export const RESTORE_STARS = Object.keys(RESTORE_EQUIPMENT).map(Number);

const COST_DENOMINATORS = {
  10: 571,
  11: 314,
  12: 214,
  13: 157,
  14: 107,
  15: 200,
  16: 200,
  17: 150,
  18: 70,
  19: 45,
  20: 200,
  21: 125,
  22: 200,
  23: 200,
  24: 200,
  25: 200,
  26: 200,
  27: 200,
  28: 200,
  29: 200,
};

function roundToHundred(value) {
  return Math.round(value / 100) * 100;
}

export function getStarforceBaseCost(itemLevel, star) {
  if (!SUPPORTED_STARFORCE_LEVELS.includes(itemLevel)) {
    throw new RangeError(
      `장비 레벨은 ${SUPPORTED_STARFORCE_LEVELS.join("/")} 중에서 골라 주세요.`,
    );
  }
  if (!Number.isInteger(star) || star < 0 || star > 29) {
    throw new RangeError("0~29성 강화 비용만 계산할 수 있습니다.");
  }

  // 10성 이상은 100 단위로 반올림한 뒤 기본 1,000메소를 더한다.
  return star <= 9
    ? roundToHundred(1_000 + (itemLevel ** 3 * (star + 1)) / 36)
    : 1_000 +
      roundToHundred(
        (itemLevel ** 3 * (star + 1) ** 2.7) / COST_DENOMINATORS[star],
      );
}

export function getStarforceAttempt({
  itemLevel,
  star,
  event = "none",
  safeguard = false,
  mvp = "none",
  pc = false,
}) {
  const eventRule = STARFORCE_EVENTS[event];
  const mvpRule = STARFORCE_MVP[mvp];
  if (!eventRule) {
    throw new RangeError("지원하지 않는 스타포스 이벤트입니다.");
  }
  if (!mvpRule) {
    throw new RangeError("지원하지 않는 MVP 등급입니다.");
  }

  const baseCost = getStarforceBaseCost(itemLevel, star);
  const personalDiscount =
    star < 17 ? Math.max(0, 1 - mvpRule.discount - (pc ? 0.05 : 0)) : 1;
  const eventDiscount = eventRule.discount ? 0.7 : 1;
  let cost = Math.round(baseCost * personalDiscount * eventDiscount);
  let [success, fail, destroy] = BASE_PROBABILITIES[star];

  // 2026-03-19부터 스타캐치는 삭제되고 1.05배 성공률이 항상 적용된다.
  if (success < 1) {
    const oldRemaining = fail + destroy;
    success *= 1.05;
    const newRemaining = 1 - success;
    fail = (fail / oldRemaining) * newRemaining;
    destroy = (destroy / oldRemaining) * newRemaining;
  }

  if (eventRule.destroyReduction && star <= 21) {
    const prevented = destroy * 0.3;
    destroy -= prevented;
    fail += prevented;
  }

  if (eventRule.guaranteed15 && star === 15) {
    success = 1;
    fail = 0;
    destroy = 0;
  }

  const safeguarded = safeguard && star >= 15 && star <= 17;
  if (safeguarded) {
    cost += baseCost * 2;
    fail += destroy;
    destroy = 0;
  }

  return { star, baseCost, cost, success, fail, destroy, safeguarded };
}

export function calculateStarforceExpected({
  itemLevel,
  startStar,
  targetStar,
  replacementPrice = 0,
  event = DEFAULT_STARFORCE_EVENT,
  mvp = DEFAULT_STARFORCE_MVP,
  pc = false,
  // 기본은 성급마다 기대비용이 가장 낮은 방법을 자동으로 고른다.
  // optimize를 끄면 아래 두 목록에 적은 성급만 그 방법을 쓴다.
  optimize = true,
  destroyPrevention = [],
  restore = [],
  // 아스트라 보조·데스티니 무기처럼 확정 복구에 장비를 1개만 넣고 모자란 몫은
  // 메소로 대신 내는 장비. 지불 총액은 같고 실제 소모 개수만 달라진다.
  singleSpare = false,
}) {
  if (
    !Number.isInteger(startStar) ||
    !Number.isInteger(targetStar) ||
    startStar < 0 ||
    targetStar < 1 ||
    targetStar > 30 ||
    startStar >= targetStar
  ) {
    throw new RangeError("시작은 0~29성, 목표는 시작보다 큰 1~30성으로 입력해 주세요.");
  }
  const maxStar = getMaxStarforceStar(itemLevel);
  if (targetStar > maxStar) {
    throw new RangeError(`${itemLevel}제 장비는 ${maxStar}성까지만 올릴 수 있습니다.`);
  }
  if (!Number.isFinite(replacementPrice) || replacementPrice < 0) {
    throw new RangeError("교체 장비 가격은 0 이상이어야 합니다.");
  }

  let cumulativeCost = 0;
  let cumulativeBooms = 0;
  let cumulativeEquipment = 0;
  // 실제로 넣는 장비 수. 여분을 메소로 내는 장비는 expectedEquipment보다 적다.
  let cumulativeItems = 0;
  let cumulativeAttempts = 0;
  let atStar22 = null;
  let selectedCost = 0;
  let selectedBooms = 0;
  let selectedEquipment = 0;
  let selectedItems = 0;
  let selectedAttempts = 0;
  const stages = [];
  // 현재 시작 성급보다 낮더라도 파괴 후 12성 복구 경로에서 실제로 사용하는
  // 최적 전략은 별도로 보존한다. stages는 기존처럼 직접 강화 구간만 담는다.
  const strategyStages = [];

  for (let star = startStar; star < Math.min(targetStar, 12); star += 1) {
    const attempt = getStarforceAttempt({ itemLevel, star, event, mvp, pc });
    const stage = {
      ...attempt,
      policy: "일반 강화",
      expectedCost: attempt.cost / attempt.success,
      expectedBooms: 0,
      expectedEquipment: 0,
      expectedItems: 0,
      expectedAttempts: 1 / attempt.success,
    };
    selectedCost += stage.expectedCost;
    selectedAttempts += stage.expectedAttempts;
    stages.push(stage);
  }

  for (let star = 12; star < targetStar; star += 1) {
    if (star === 22) {
      atStar22 = {
        cost: cumulativeCost,
        booms: cumulativeBooms,
        equipment: cumulativeEquipment,
        items: cumulativeItems,
        attempts: cumulativeAttempts,
      };
    }

    const normalAttempt = getStarforceAttempt({
      itemLevel,
      star,
      event,
      safeguard: false,
      mvp,
      pc,
    });

    const basicRecovery = {
      policy: "12성 복구",
      cost: replacementPrice + cumulativeCost,
      booms: 1 + cumulativeBooms,
      equipment: 1 + cumulativeEquipment,
      items: 1 + cumulativeItems,
      attempts: cumulativeAttempts,
    };

    let fullRecovery = null;
    if (star >= 15 && star <= 22 && RESTORE_COSTS[itemLevel][star]) {
      const restoreDiscount = STARFORCE_EVENTS[event].restoreDiscount
        ? 0.8
        : 1;
      fullRecovery = {
        policy: "확정 복구",
        cost:
          replacementPrice * RESTORE_EQUIPMENT[star] +
          RESTORE_COSTS[itemLevel][star] * restoreDiscount,
        booms: 1,
        equipment: RESTORE_EQUIPMENT[star],
        items: singleSpare ? 1 : RESTORE_EQUIPMENT[star],
        attempts: 0,
      };
    } else if (star > 22 && atStar22) {
      const restoreDiscount = STARFORCE_EVENTS[event].restoreDiscount
        ? 0.8
        : 1;
      fullRecovery = {
        policy: "22성 확정 복구",
        cost:
          replacementPrice * RESTORE_EQUIPMENT[22] +
          RESTORE_COSTS[itemLevel][22] * restoreDiscount +
          (cumulativeCost - atStar22.cost),
        booms: 1 + (cumulativeBooms - atStar22.booms),
        equipment:
          RESTORE_EQUIPMENT[22] +
          (cumulativeEquipment - atStar22.equipment),
        items:
          (singleSpare ? 1 : RESTORE_EQUIPMENT[22]) +
          (cumulativeItems - atStar22.items),
        attempts: cumulativeAttempts - atStar22.attempts,
      };
    }

    const useFullRecovery = optimize
      ? fullRecovery && fullRecovery.cost < basicRecovery.cost
      : fullRecovery &&
        (restore.includes(star) || (star > 22 && restore.includes(22)));
    const recovery = useFullRecovery ? fullRecovery : basicRecovery;
    const normalStage = {
      ...normalAttempt,
      policy: normalAttempt.destroy > 0 ? recovery.policy : "일반 강화",
      expectedCost:
        (normalAttempt.cost + normalAttempt.destroy * recovery.cost) /
        normalAttempt.success,
      expectedBooms:
        (normalAttempt.destroy * recovery.booms) / normalAttempt.success,
      expectedEquipment:
        (normalAttempt.destroy * recovery.equipment) / normalAttempt.success,
      expectedItems:
        (normalAttempt.destroy * recovery.items) / normalAttempt.success,
      expectedAttempts:
        (1 + normalAttempt.destroy * recovery.attempts) /
        normalAttempt.success,
    };

    let chosen = normalStage;
    if (SAFEGUARD_STARS.includes(star)) {
      const safeAttempt = getStarforceAttempt({
        itemLevel,
        star,
        event,
        safeguard: true,
        mvp,
        pc,
      });
      const safeStage = {
        ...safeAttempt,
        policy: "파괴 방지",
        expectedCost: safeAttempt.cost / safeAttempt.success,
        expectedBooms: 0,
        expectedEquipment: 0,
        expectedItems: 0,
        expectedAttempts: 1 / safeAttempt.success,
      };
      const useSafeguard = optimize
        ? safeStage.expectedCost < normalStage.expectedCost
        : destroyPrevention.includes(star);
      if (useSafeguard) chosen = safeStage;
    }

    cumulativeCost += chosen.expectedCost;
    cumulativeBooms += chosen.expectedBooms;
    cumulativeEquipment += chosen.expectedEquipment;
    cumulativeItems += chosen.expectedItems;
    cumulativeAttempts += chosen.expectedAttempts;
    strategyStages.push(chosen);

    if (star >= startStar) {
      selectedCost += chosen.expectedCost;
      selectedBooms += chosen.expectedBooms;
      selectedEquipment += chosen.expectedEquipment;
      selectedItems += chosen.expectedItems;
      selectedAttempts += chosen.expectedAttempts;
      stages.push(chosen);
    }
  }

  return {
    itemLevel,
    startStar,
    targetStar,
    replacementPrice,
    event,
    mvp,
    pc,
    optimize,
    expectedCost: selectedCost,
    expectedBooms: selectedBooms,
    expectedEquipment: selectedEquipment,
    expectedItems: selectedItems,
    expectedAttempts: selectedAttempts,
    stages,
    strategyStages,
  };
}

export function formatApproxMeso(value) {
  if (!Number.isFinite(value)) {
    return "계산 범위 초과";
  }

  const rounded = Math.round(value);
  const meso = new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 0,
  }).format(rounded);
  const eok = value / 100_000_000;
  const eokText = new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: eok >= 100 ? 1 : 2,
  }).format(eok);
  return `${meso} 메소 (${eokText}억)`;
}
