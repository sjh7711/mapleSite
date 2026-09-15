import { specialTraceCost } from "maple-core/scroll";

export function isChaosFirstEnabled(method, selected) {
  return method?.kind === "slot" && selected === true;
}

/** 입력한 주문의 흔적 시세와 같은 성공 효과를 내는 지원 주문서의
 * 1장 구매 손익분기 시세를 계산한다. 반환 단위는 입력값과 같은 만 메소다. */
export function supportScrollPurchaseThresholds({
  tracePer1000Price = 0,
  halfPrice = false,
} = {}) {
  const tracePrice = Math.max(0, Number(tracePer1000Price) || 0);
  const traceValue = (kind) =>
    (specialTraceCost(kind, { halfPrice }) / 1000) * tracePrice;

  return {
    clean10: traceValue("clean") * 0.1,
    clean5: traceValue("clean") * 0.05,
    innocent50: traceValue("innocent") * 0.5,
  };
}

/** 순백 복구 후보를 성공 1회당 비용순으로 정렬한다.
 * 5%·10%를 제외해도 보유 순백 100%와 함께 쓰는 주흔 순백 100%는 남긴다. */
export function buildCleanRestoreChoices({
  traceCost = 0,
  traceCount = 0,
  clean10Cost = 0,
  clean5Cost = 0,
  allowFiveTenPercent = true,
} = {}) {
  const choices = [
    {
      name: "주흔 순백 100%",
      each: Number(traceCost),
      rate: 1,
      traceCount: Math.max(0, Number(traceCount) || 0),
    },
    ...(allowFiveTenPercent
      ? [
          { name: "순백 10%", each: Number(clean10Cost), rate: 0.1, traceCount: 0 },
          { name: "순백 5%", each: Number(clean5Cost), rate: 0.05, traceCount: 0 },
        ]
      : []),
  ];
  return choices
    .filter((option) => Number.isFinite(option.each) && option.each > 0)
    .map((option) => ({ ...option, cost: option.each / option.rate }))
    .sort((left, right) => left.cost - right.cost);
}

const scaled = (value, chance) => chance === 0 ? 0 : value * chance;

/** 놀긍 첫작은 보유 100%를 먼저 쓰고, 소진되면 구매 60%로 이어 간다.
 * 목표 미달 때마다 초기화하며 보유 초기화 주문서도 먼저 소진한다. */
export function calculateAutomaticFirstChaos({
  targetChance,
  chaos60Cost,
  resetCost,
  chaos100Stock = 0,
  resetStock = 0,
} = {}) {
  const optionChance = Number(targetChance);
  const paidChaosCost = Number(chaos60Cost);
  const paidResetCost = Number(resetCost);
  const ownedChaos = Math.max(0, Math.round(Number(chaos100Stock) || 0));
  const ownedResets = Math.max(0, Math.round(Number(resetStock) || 0));
  if (!(optionChance > 0 && optionChance <= 1)) {
    throw new RangeError("놀긍 목표 확률은 0보다 크고 1 이하여야 합니다.");
  }
  if (!Number.isFinite(paidChaosCost) || paidChaosCost < 0) {
    throw new RangeError("놀긍 60% 가격은 0 이상이어야 합니다.");
  }
  if (!(Number.isFinite(paidResetCost) || paidResetCost === Number.POSITIVE_INFINITY) || paidResetCost < 0) {
    throw new RangeError("초기화 가격은 0 이상이어야 합니다.");
  }

  const chaos60Hit = 0.6 * optionChance;
  const names = [
    "cost",
    "scrolls",
    "purchasedChaos60",
    "ownedChaos100Used",
    "resets",
    "paidResets",
    "ownedResetsUsed",
  ];
  const memo = new Map();
  const solve = (remainingChaos100, remainingResets) => {
    const key = `${remainingChaos100}:${remainingResets}`;
    if (memo.has(key)) return memo.get(key);

    if (remainingChaos100 === 0 && remainingResets === 0) {
      const scrolls = 1 / chaos60Hit;
      const failures = (1 - chaos60Hit) / chaos60Hit;
      const result = {
        cost: scrolls * paidChaosCost + failures * paidResetCost,
        scrolls,
        purchasedChaos60: scrolls,
        ownedChaos100Used: 0,
        resets: failures,
        paidResets: failures,
        ownedResetsUsed: 0,
      };
      memo.set(key, result);
      return result;
    }

    const usesOwnedChaos100 = remainingChaos100 > 0;
    const hit = usesOwnedChaos100 ? optionChance : chaos60Hit;
    const failure = 1 - hit;
    const usesOwnedReset = remainingResets > 0;
    const next = solve(
      usesOwnedChaos100 ? remainingChaos100 - 1 : 0,
      usesOwnedReset ? remainingResets - 1 : 0,
    );
    const immediate = {
      cost:
        (usesOwnedChaos100 ? 0 : paidChaosCost) +
        scaled(usesOwnedReset ? 0 : paidResetCost, failure),
      scrolls: 1,
      purchasedChaos60: usesOwnedChaos100 ? 0 : 1,
      ownedChaos100Used: usesOwnedChaos100 ? 1 : 0,
      resets: failure,
      paidResets: usesOwnedReset ? 0 : failure,
      ownedResetsUsed: usesOwnedReset ? failure : 0,
    };
    const result = Object.fromEntries(
      names.map((name) => [name, immediate[name] + scaled(next[name], failure)]),
    );
    memo.set(key, result);
    return result;
  };

  const baseline = solve(0, 0);
  const result = solve(ownedChaos, ownedResets);
  return {
    ...result,
    targetChance100: optionChance,
    targetChance60: chaos60Hit,
    chaos100Stock: ownedChaos,
    resetStock: ownedResets,
    nextAction: ownedChaos > 0
      ? "보유 놀긍 100% 바르기"
      : "놀라운 긍정의 혼돈 주문서 60% 바르기",
    inventorySavings:
      Number.isFinite(baseline.cost) && Number.isFinite(result.cost)
        ? Math.max(0, baseline.cost - result.cost)
        : 0,
  };
}

const count = (value) => Math.max(0, Math.round(Number(value) || 0));

/** 인게임의 잔여·복구 가능 횟수를 앞으로 처리할 작업 상태로 바꾼다. */
export function slotCraftState({ remaining, recoverable }) {
  const startRemaining = count(remaining);
  const recoverableSlots = count(recoverable);
  return {
    slots: startRemaining + recoverableSlots,
    startRemaining,
    startSuccess: 0,
    recoverable: recoverableSlots,
    unfinished: startRemaining + recoverableSlots,
  };
}

/** 구 UI의 전체·현재 남은·성공 입력에서 앞으로 처리할 두 값만 이전한다. */
export function migrateLegacySlotState({ slots, remaining, success }) {
  const total = count(slots);
  const migratedSuccess = Math.min(count(success), total);
  const migratedRemaining = Math.min(
    count(remaining),
    total - migratedSuccess,
  );
  return {
    remaining: migratedRemaining,
    recoverable: total - migratedSuccess - migratedRemaining,
  };
}

/** 평균 비용에 실제로 새로 필요한 주문의 흔적 수를 센다. 엔진이 계산한
 * 유료 사용량이 있으면 그대로 쓰고, 구 호출은 평균 횟수에서 재고를 뺀다. */
export function expectedTraceUsage({
  scrolls = 0,
  tracePerScroll = 0,
  paidCleans,
  cleans = 0,
  tracePerClean = 0,
  cleanStock = 0,
  paidResets,
  resets = 0,
  tracePerReset = 0,
  resetStock = 0,
} = {}) {
  const requiredCleans = paidCleans == null
    ? Math.max(0, (Number(cleans) || 0) - (Number(cleanStock) || 0))
    : Math.max(0, Number(paidCleans) || 0);
  const requiredResets = paidResets == null
    ? Math.max(0, (Number(resets) || 0) - (Number(resetStock) || 0))
    : Math.max(0, Number(paidResets) || 0);
  return (
    Math.max(0, Number(scrolls) || 0) * Math.max(0, Number(tracePerScroll) || 0) +
    requiredCleans * Math.max(0, Number(tracePerClean) || 0) +
    requiredResets * Math.max(0, Number(tracePerReset) || 0)
  );
}

const nonNegative = (value) => Math.max(0, Number(value) || 0);
const physicalScrolls = (successfulUses, successRate) => {
  const rate = Number(successRate);
  return rate > 0 ? nonNegative(successfulUses) / rate : 0;
};

/** 엔진의 복구·초기화 성공 횟수를 실제로 필요한 주문서 장수로 바꾼다.
 * 보유 100% 주문서는 한 장이 한 번 성공하므로 성공률로 나누지 않는다. */
export function expectedSupportScrollQuantities({
  ownedCleans = 0,
  paidCleans = 0,
  cleanRate = 0,
  ownedResets = 0,
  paidResets = 0,
  resetRate = 0,
  firstOwnedResets = 0,
  firstPaidResets = 0,
} = {}) {
  return {
    ownedClean100: nonNegative(ownedCleans),
    purchasedClean: physicalScrolls(paidCleans, cleanRate),
    ownedReset100:
      nonNegative(ownedResets) + nonNegative(firstOwnedResets),
    purchasedReset: physicalScrolls(
      nonNegative(paidResets) + nonNegative(firstPaidResets),
      resetRate,
    ),
  };
}
