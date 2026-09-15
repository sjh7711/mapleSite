/*
 * 놀긍 리턴작의 보유 주문서·현금/메소 비용 계산.
 *
 * scroll.js의 기존 계산은 선택한 확률의 평균 시도 횟수를 구한다. 그 값에서
 * min(보유분, 평균 횟수)를 빼면 유한 보유분의 기댓비용이 되지 않는다. 실제
 * 소모량은 랜덤 변수이므로 E[(N - stock)+]를 상태별로 계산해야 한다.
 *
 * 이 모듈은 다음 정책을 정확한 Bellman DP로 계산한다.
 *
 * - 나머지 리턴작의 유료 주문서는 놀긍 60%로 고정한다.
 * - 보유 놀긍 100%는 첫작과 리턴작 사이에서 함께 배분한다.
 * - 첫작의 유료 주문서는 60/100% 가격과 현재 재고 상태를
 *   비교해 자동으로 고른다. 단일 chaosRate 입력은 하위 호환한다.
 * - 첫작 미달은 보유 아크 이노센트 100%를 먼저 쓰고, 부족분은
 *   주흔 아크 이노센트 가격으로 구매한다.
 * - 리턴 없이 발라도 실패·모든 성공 결과에서 남은 목표를 달성할 수 있으면
 *   그 행동도 비교한다. 60% 실패는 상승량 0인 채 한 칸을 소비한다.
 * - 최적화 순서는 리턴 스크롤(메포/현금) 지출, 그 다음 메소 지출이다.
 * - 1억 메소↔메이플포인트 환산은 표시용이며 최적 정책을 바꾸지 않는다.
 */

import {
  CHAOS_RATES,
  chaosOutcomeDistribution,
} from "./scroll.js";

const ONE_HUNDRED_MILLION = 100_000_000;
const DEFAULT_MAPLE_POINTS_PER_100M = 2_000;
const EPSILON = 1e-10;
const MAX_STATS = 4;

const METRIC_KEYS = [
  "firstPurchasedChaos60",
  "firstPurchasedChaos100",
  "firstOwnedChaos100",
  "returnPurchasedChaos60",
  "returnOwnedChaos100",
  // 위 두 전체 사용량 중 리턴 스크롤 없이 바른 몫이다.
  "returnUnprotectedPurchasedChaos60",
  "returnUnprotectedOwnedChaos100",
  "purchasedArkInnocent100",
  "ownedArkInnocent100",
  "returnScrolls",
  "meso",
  "maplePoints",
];
const METRIC = Object.freeze(Object.fromEntries(
  METRIC_KEYS.map((key, index) => [key, index]),
));

function zeroMetrics() {
  return new Float64Array(METRIC_KEYS.length);
}

function addMetricVector(target, source, weight = 1) {
  for (let index = 0; index < METRIC_KEYS.length; index += 1) {
    target[index] += source[index] * weight;
  }
  return target;
}

function scaledMetrics(source, weight) {
  const result = zeroMetrics();
  for (let index = 0; index < METRIC_KEYS.length; index += 1) {
    result[index] = source[index] * weight;
  }
  return result;
}

function metricsToPlan(metrics, action = null) {
  const plan = { feasible: true, action };
  for (let index = 0; index < METRIC_KEYS.length; index += 1) {
    plan[METRIC_KEYS[index]] = metrics[index];
  }
  return plan;
}

function zeroPlan(action = null) {
  const plan = { feasible: true, action };
  for (const key of METRIC_KEYS) plan[key] = 0;
  return plan;
}

function impossiblePlan() {
  const plan = zeroPlan();
  plan.feasible = false;
  plan.meso = Number.POSITIVE_INFINITY;
  plan.maplePoints = Number.POSITIVE_INFINITY;
  return plan;
}

function compareNumber(left, right) {
  if (left === right) return 0;
  if (!Number.isFinite(left)) return 1;
  if (!Number.isFinite(right)) return -1;
  const tolerance = EPSILON * Math.max(1, Math.abs(left), Math.abs(right));
  if (Math.abs(left - right) <= tolerance) return 0;
  return left < right ? -1 : 1;
}

/*
 * 정책 탐색 단계에서는 실제 반환할 모든 기대 횟수를 누적할
 * 필요가 없다. 비교에 쓰는 리턴 지출·메소·보유분 사용량만 먼저
 * 계산하고, 선택된 정책을 두 번째 패스에서 한 번만 평가한다.
 * 이렇게 하면 각 outcome/prefix마다 12개 metric 벡터를 복사하던
 * 비용을 없앨 수 있다.
 */
function zeroObjective(kind = null) {
  return {
    feasible: true,
    maplePoints: 0,
    meso: 0,
    ownedUsed: 0,
    kind,
  };
}

function impossibleObjective() {
  return {
    feasible: false,
    maplePoints: Number.POSITIVE_INFINITY,
    meso: Number.POSITIVE_INFINITY,
    ownedUsed: Number.POSITIVE_INFINITY,
    kind: null,
  };
}

function compareObjectives(left, right) {
  if (!left.feasible) return right.feasible ? 1 : 0;
  if (!right.feasible) return -1;
  let compared = compareNumber(left.maplePoints, right.maplePoints);
  if (compared) return compared;
  compared = compareNumber(left.meso, right.meso);
  if (compared) return compared;
  return compareNumber(left.ownedUsed, right.ownedUsed);
}

function bestObjective(candidates) {
  return candidates.reduce(
    (best, candidate) =>
      compareObjectives(candidate, best) < 0 ? candidate : best,
    impossibleObjective(),
  );
}

function assertNonNegative(value, label, { integer = false } = {}) {
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    (integer && !Number.isInteger(value))
  ) {
    throw new RangeError(`${label}은 0 이상${integer ? "의 정수" : ""}여야 합니다.`);
  }
}

function assertChaosRate(rate, label) {
  if (!CHAOS_RATES.includes(rate)) {
    throw new RangeError(`${label}은 60% 또는 100%여야 합니다.`);
  }
}

function normalizedFirstPaidRates(firstWork, prices) {
  let rates;
  if (firstWork.chaosRates !== undefined) {
    if (!Array.isArray(firstWork.chaosRates) || firstWork.chaosRates.length === 0) {
      throw new RangeError("첫작 놀긍 확률 목록은 비어 있지 않은 배열이어야 합니다.");
    }
    rates = [...new Set(firstWork.chaosRates.map(Number))];
    for (const rate of rates) assertChaosRate(rate, "첫작 놀긍 확률");
  } else if (firstWork.chaosRate !== undefined) {
    const rate = Number(firstWork.chaosRate);
    assertChaosRate(rate, "첫작 놀긍 확률");
    // 기존 단일 고정 모드는 0원 가격 호출도 그대로 호환한다.
    return [rate];
  } else {
    rates = [...CHAOS_RATES];
  }

  // 자동 모드에서 0은 무료 무제한 구매가 아니라 가격 미입력이다.
  const available = rates.filter((rate) =>
    (rate === 60 ? prices.chaos60Meso : prices.chaos100Meso) > 0
  );
  if (available.length === 0) {
    throw new RangeError(
      "자동 첫작에 사용할 놀긍 60% 또는 100% 가격을 0보다 크게 입력해야 합니다.",
    );
  }
  return available;
}

function integerGoal(average, slots, label) {
  assertNonNegative(average, label);
  const raw = average * slots;
  const rounded = Math.round(raw);
  return Math.abs(raw - rounded) < 1e-9 ? rounded : Math.ceil(raw);
}

function normalizedPrices(prices = {}) {
  const result = {
    chaos60Meso: Number(prices.chaos60Meso ?? 0),
    chaos100Meso: Number(prices.chaos100Meso ?? 0),
    arkInnocent100Meso: Number(prices.arkInnocent100Meso ?? 0),
    returnMaplePoints: Number(prices.returnMaplePoints ?? 0),
  };
  for (const [key, value] of Object.entries(result)) {
    assertNonNegative(value, key);
  }
  return result;
}

function validateCommon({ slots, averageAttackTarget, averageStatTarget, statCount }) {
  if (!Number.isInteger(slots) || slots < 1 || slots > 20) {
    throw new RangeError("전체 작 횟수는 1~20 사이여야 합니다.");
  }
  if (!Number.isInteger(statCount) || statCount < 0 || statCount > MAX_STATS) {
    throw new RangeError("목표 스탯 개수는 0~4 사이여야 합니다.");
  }
  const attackGoal = integerGoal(averageAttackTarget, slots, "평균 공·마 목표");
  const statGoal = integerGoal(averageStatTarget, slots, "평균 스탯 합 목표");
  if (attackGoal > 6 * slots || statGoal > 6 * statCount * slots) {
    throw new RangeError("최종 평균 놀긍 목표를 달성할 수 없습니다.");
  }
  return { attackGoal, statGoal };
}

function normalizedProgress(progress, { slots, statCount, attackGoal, statGoal }) {
  const completedSlots = Number(progress?.completedSlots ?? 0);
  const attack = Number(progress?.attack ?? 0);
  const stat = Number(progress?.stat ?? 0);
  assertNonNegative(completedSlots, "이미 적용한 작 수", { integer: true });
  assertNonNegative(attack, "현재 놀긍 공·마 합", { integer: true });
  assertNonNegative(stat, "현재 놀긍 목표 스탯 합", { integer: true });
  if (completedSlots > slots) {
    throw new RangeError("이미 적용한 작 수는 전체 작 수보다 클 수 없습니다.");
  }
  if (attack > 6 * completedSlots) {
    throw new RangeError(
      `${completedSlots}작에서 현재 놀긍 공·마 합은 최대 ${6 * completedSlots}입니다.`,
    );
  }
  if (stat > 6 * statCount * completedSlots) {
    throw new RangeError(
      `${completedSlots}작에서 현재 놀긍 목표 스탯 합은 최대 ${6 * statCount * completedSlots}입니다.`,
    );
  }

  const remainingSlots = slots - completedSlots;
  const attackNeeded = Math.max(0, attackGoal - attack);
  const statNeeded = Math.max(0, statGoal - stat);
  if (attackNeeded > 6 * remainingSlots) {
    throw new RangeError(
      `남은 ${remainingSlots}작으로 필요한 공·마 +${attackNeeded}를 채울 수 없습니다.`,
    );
  }
  if (statNeeded > 6 * statCount * remainingSlots) {
    throw new RangeError(
      `남은 ${remainingSlots}작으로 필요한 목표 스탯 +${statNeeded}를 채울 수 없습니다.`,
    );
  }
  return {
    completedSlots,
    remainingSlots,
    current: { attack, stat },
    needed: { attack: attackNeeded, stat: statNeeded },
  };
}

/* 여러 원시 결과가 목표 차감 후 같은 상태로 이어지면 확률을 합친다.
   같은 후속 상태의 결과를 일부만 채택하는 것은 비용 함수가 그 구간에서
   단조이므로 최적이 될 수 없다. 상태 단위로 묶어도 정책은 변하지 않는다. */
function groupOutcomeTransitions(outcomes, attackNeeded, statNeeded) {
  const grouped = new Map();
  for (const outcome of outcomes) {
    const nextAttack = Math.max(0, attackNeeded - outcome.attack);
    const nextStat = Math.max(0, statNeeded - outcome.stat);
    const key = `${nextAttack}:${nextStat}`;
    const current = grouped.get(key);
    if (current) {
      current.chance += outcome.chance;
      current.outcomeCount += 1;
    } else {
      grouped.set(key, {
        attackNeeded: nextAttack,
        statNeeded: nextStat,
        chance: outcome.chance,
        outcomeCount: 1,
      });
    }
  }
  return [...grouped.values()];
}

function createReturnSolver({
  outcomes,
  statCount,
  prices,
  maximumChaos100Stock,
}) {
  const memo = new Map();
  const evaluationMemo = new Map();
  const transitionMemo = new Map();
  let statesEvaluated = 0;
  const stockStride = maximumChaos100Stock + 1;
  const largestPackedKey = ((20 * 121 + 120) * 481 + 480) *
    stockStride + maximumChaos100Stock;
  const usePackedStateKey = Number.isSafeInteger(largestPackedKey);

  function stateKey(slots, attackNeeded, statNeeded, chaos100Stock) {
    return usePackedStateKey
      ? ((slots * 121 + attackNeeded) * 481 + statNeeded) * stockStride +
        chaos100Stock
      : `${slots}:${attackNeeded}:${statNeeded}:${chaos100Stock}`;
  }

  function transitions(attackNeeded, statNeeded) {
    // 공격력 목표는 최대 120, 스탯 합은 최대 480이다.
    const key = attackNeeded * 481 + statNeeded;
    const cached = transitionMemo.get(key);
    if (cached) return cached;
    const grouped = groupOutcomeTransitions(
      outcomes,
      attackNeeded,
      statNeeded,
    );
    transitionMemo.set(key, grouped);
    return grouped;
  }

  function actionMetadata({
    source,
    rate,
    chance,
    acceptedOutcomeCount,
    usesReturn,
    failureConsumesSlot = false,
  }) {
    return {
      phase: "return",
      source,
      rate,
      chance,
      acceptedOutcomeCount,
      usesReturn,
      protected: usesReturn,
      scrollSuccessRate: rate / 100,
      failureConsumesSlot,
    };
  }

  function actionFor(value) {
    if (value.kind === "complete") return { phase: "complete" };
    const owned = value.kind === "unprotected-owned" ||
      value.kind === "protected-owned";
    const usesReturn = value.kind === "protected-purchased" ||
      value.kind === "protected-owned";
    return actionMetadata({
      source: owned ? "owned-chaos-100" : "purchased-chaos-60",
      rate: owned ? 100 : 60,
      chance: value.chance,
      acceptedOutcomeCount: value.acceptedOutcomeCount,
      usesReturn,
      failureConsumesSlot: value.kind === "unprotected-purchased",
    });
  }

  function solve(slots, attackNeeded, statNeeded, chaos100Stock) {
    if (slots === 0) {
      return attackNeeded === 0 && statNeeded === 0
        ? zeroObjective("complete")
        : impossibleObjective();
    }
    if (
      attackNeeded < 0 ||
      statNeeded < 0 ||
      attackNeeded > 6 * slots ||
      statNeeded > 6 * statCount * slots
    ) {
      return impossibleObjective();
    }
    const key = stateKey(slots, attackNeeded, statNeeded, chaos100Stock);
    const cached = memo.get(key);
    if (cached) return cached;
    statesEvaluated += 1;

    const grouped = transitions(attackNeeded, statNeeded);
    const candidates = [];

    /* 리턴 없이 60%를 바르면 실패도 상승량 0으로 한 칸을 소비한다.
       실패와 모든 성공 결과가 이후에도 목표에 도달 가능한 경우만 후보이다. */
    const unprotectedFailure = solve(
      slots - 1,
      attackNeeded,
      statNeeded,
      chaos100Stock,
    );
    if (unprotectedFailure.feasible) {
      let maplePoints = 0.4 * unprotectedFailure.maplePoints;
      let meso = prices.chaos60Meso + 0.4 * unprotectedFailure.meso;
      let ownedUsed = 0.4 * unprotectedFailure.ownedUsed;
      let possible = true;
      for (const transition of grouped) {
        const next = solve(
          slots - 1,
          transition.attackNeeded,
          transition.statNeeded,
          chaos100Stock,
        );
        if (!next.feasible) {
          possible = false;
          break;
        }
        const weight = 0.6 * transition.chance;
        maplePoints += weight * next.maplePoints;
        meso += weight * next.meso;
        ownedUsed += weight * next.ownedUsed;
      }
      if (possible) {
        candidates.push({
          feasible: true,
          maplePoints,
          meso,
          ownedUsed,
          kind: "unprotected-purchased",
          chance: 1,
          acceptedOutcomeCount: outcomes.length,
        });
      }
    }

    /* 보유 100%도 모든 결과를 그대로 채택할 수 있을 때 리턴 없이 쓴다. */
    if (chaos100Stock > 0) {
      let maplePoints = 0;
      let meso = 0;
      let ownedUsed = 1;
      let possible = true;
      for (const transition of grouped) {
        const next = solve(
          slots - 1,
          transition.attackNeeded,
          transition.statNeeded,
          chaos100Stock - 1,
        );
        if (!next.feasible) {
          possible = false;
          break;
        }
        maplePoints += transition.chance * next.maplePoints;
        meso += transition.chance * next.meso;
        ownedUsed += transition.chance * next.ownedUsed;
      }
      if (possible) {
        candidates.push({
          feasible: true,
          maplePoints,
          meso,
          ownedUsed,
          kind: "unprotected-owned",
          chance: 1,
          acceptedOutcomeCount: outcomes.length,
        });
      }
    }

    /* 리턴 가격이 양수이고 이후에도 리턴이 전혀 필요 없는 후보가 있으면
       리턴을 한 장 이상 쓰는 보호 행동은 1차 목적에서 반드시 진다. */
    if (prices.returnMaplePoints > 0) {
      let bestWithoutReturn = impossibleObjective();
      for (const candidate of candidates) {
        if (
          compareNumber(candidate.maplePoints, 0) === 0 &&
          compareObjectives(candidate, bestWithoutReturn) < 0
        ) {
          bestWithoutReturn = candidate;
        }
      }
      if (bestWithoutReturn.feasible) {
        memo.set(key, bestWithoutReturn);
        return bestWithoutReturn;
      }
    }

    /*
     * 유료 60% 놀긍. 거절하면 같은 상태로 돌아오므로, 채택할 후속
     * 비용이 싼 결과부터 하나씩 넣어 최소 비용 prefix를 고른다.
     */
    const nextCandidates = [];
    for (const transition of grouped) {
      const next = solve(
        slots - 1,
        transition.attackNeeded,
        transition.statNeeded,
        chaos100Stock,
      );
      if (next.feasible) nextCandidates.push({ transition, next });
    }
    nextCandidates.sort((left, right) =>
      compareObjectives(left.next, right.next)
    );

    let acceptedOptionChance = 0;
    let weightedMaplePoints = 0;
    let weightedMeso = 0;
    let weightedOwnedUsed = 0;
    let acceptedOutcomeCount = 0;
    let bestPaidMaplePoints = Number.POSITIVE_INFINITY;
    let bestPaidMeso = Number.POSITIVE_INFINITY;
    let bestPaidOwnedUsed = Number.POSITIVE_INFINITY;
    let bestPaidGroups = 0;
    let bestPaidChance = 0;
    let bestPaidOutcomeCount = 0;
    for (let index = 0; index < nextCandidates.length; index += 1) {
      const entry = nextCandidates[index];
      acceptedOptionChance += entry.transition.chance;
      weightedMaplePoints +=
        entry.transition.chance * entry.next.maplePoints;
      weightedMeso += entry.transition.chance * entry.next.meso;
      weightedOwnedUsed += entry.transition.chance * entry.next.ownedUsed;
      acceptedOutcomeCount += entry.transition.outcomeCount;
      const acceptedChance = 0.6 * acceptedOptionChance;
      const candidateMaplePoints =
        prices.returnMaplePoints / acceptedChance +
        weightedMaplePoints / acceptedOptionChance;
      const candidateMeso =
        prices.chaos60Meso / acceptedChance +
        weightedMeso / acceptedOptionChance;
      const candidateOwnedUsed = weightedOwnedUsed / acceptedOptionChance;
      let compared = compareNumber(candidateMaplePoints, bestPaidMaplePoints);
      if (!compared) compared = compareNumber(candidateMeso, bestPaidMeso);
      if (!compared) {
        compared = compareNumber(candidateOwnedUsed, bestPaidOwnedUsed);
      }
      if (compared < 0) {
        bestPaidMaplePoints = candidateMaplePoints;
        bestPaidMeso = candidateMeso;
        bestPaidOwnedUsed = candidateOwnedUsed;
        bestPaidGroups = index + 1;
        bestPaidChance = acceptedChance;
        bestPaidOutcomeCount = acceptedOutcomeCount;
      }
    }
    if (bestPaidGroups > 0) {
      candidates.push({
        feasible: true,
        maplePoints: bestPaidMaplePoints,
        meso: bestPaidMeso,
        ownedUsed: bestPaidOwnedUsed,
        kind: "protected-purchased",
        chance: bestPaidChance,
        acceptedOutcomeCount: bestPaidOutcomeCount,
        acceptedGroups: bestPaidGroups,
      });
    }

    /*
     * 보유 100% 놀긍 한 장을 지금 쓸지, 나중 상태에 아껴 둘지도 DP가
     * 비교한다. 이 주문서는 이 시도에서 무조건 소모되므로 거절 후속 상태도
     * stock-1이다.
     */
    if (chaos100Stock > 0) {
      const reject = solve(slots, attackNeeded, statNeeded, chaos100Stock - 1);
      let maplePoints = prices.returnMaplePoints;
      let meso = 0;
      let ownedUsed = 1;
      let ownedAcceptedChance = 0;
      let ownedAcceptedCount = 0;
      let possible = true;
      for (const transition of grouped) {
        const accept = solve(
          slots - 1,
          transition.attackNeeded,
          transition.statNeeded,
          chaos100Stock - 1,
        );
        const chosen = accept.feasible &&
            (!reject.feasible || compareObjectives(accept, reject) <= 0)
          ? accept
          : reject;
        if (!chosen.feasible) {
          possible = false;
          break;
        }
        if (chosen === accept) {
          ownedAcceptedChance += transition.chance;
          ownedAcceptedCount += transition.outcomeCount;
        }
        maplePoints += transition.chance * chosen.maplePoints;
        meso += transition.chance * chosen.meso;
        ownedUsed += transition.chance * chosen.ownedUsed;
      }
      if (possible) {
        candidates.push({
          feasible: true,
          maplePoints,
          meso,
          ownedUsed,
          kind: "protected-owned",
          chance: ownedAcceptedChance,
          acceptedOutcomeCount: ownedAcceptedCount,
        });
      }
    }

    const best = bestObjective(candidates);
    memo.set(key, best);
    return best;
  }

  /* 탐색된 정책의 모든 기대 횟수를 두 번째 패스에서 계산한다. */
  function evaluate(slots, attackNeeded, statNeeded, chaos100Stock) {
    if (slots === 0) {
      return zeroMetrics();
    }
    const key = stateKey(slots, attackNeeded, statNeeded, chaos100Stock);
    const cached = evaluationMemo.get(key);
    if (cached) return cached;
    const value = solve(slots, attackNeeded, statNeeded, chaos100Stock);
    if (!value.feasible) {
      throw new RangeError("선택된 놀긍리턴 정책을 평가할 수 없습니다.");
    }

    const grouped = transitions(attackNeeded, statNeeded);
    let metrics;
    if (value.kind === "unprotected-purchased") {
      metrics = scaledMetrics(
        evaluate(slots - 1, attackNeeded, statNeeded, chaos100Stock),
        0.4,
      );
      for (const transition of grouped) {
        addMetricVector(
          metrics,
          evaluate(
            slots - 1,
            transition.attackNeeded,
            transition.statNeeded,
            chaos100Stock,
          ),
          0.6 * transition.chance,
        );
      }
      metrics[METRIC.returnPurchasedChaos60] += 1;
      metrics[METRIC.returnUnprotectedPurchasedChaos60] += 1;
      metrics[METRIC.meso] += prices.chaos60Meso;
    } else if (value.kind === "unprotected-owned") {
      metrics = zeroMetrics();
      for (const transition of grouped) {
        addMetricVector(
          metrics,
          evaluate(
            slots - 1,
            transition.attackNeeded,
            transition.statNeeded,
            chaos100Stock - 1,
          ),
          transition.chance,
        );
      }
      metrics[METRIC.returnOwnedChaos100] += 1;
      metrics[METRIC.returnUnprotectedOwnedChaos100] += 1;
    } else if (value.kind === "protected-purchased") {
      const nextCandidates = [];
      for (const transition of grouped) {
        const next = solve(
          slots - 1,
          transition.attackNeeded,
          transition.statNeeded,
          chaos100Stock,
        );
        if (next.feasible) nextCandidates.push({ transition, next });
      }
      nextCandidates.sort((left, right) =>
        compareObjectives(left.next, right.next)
      );
      const weightedContinuation = zeroMetrics();
      let optionChance = 0;
      for (
        let index = 0;
        index < value.acceptedGroups;
        index += 1
      ) {
        const { transition } = nextCandidates[index];
        optionChance += transition.chance;
        addMetricVector(
          weightedContinuation,
          evaluate(
            slots - 1,
            transition.attackNeeded,
            transition.statNeeded,
            chaos100Stock,
          ),
          transition.chance,
        );
      }
      const acceptedChance = 0.6 * optionChance;
      metrics = scaledMetrics(weightedContinuation, 1 / optionChance);
      metrics[METRIC.returnPurchasedChaos60] += 1 / acceptedChance;
      metrics[METRIC.returnScrolls] += 1 / acceptedChance;
      metrics[METRIC.meso] += prices.chaos60Meso / acceptedChance;
      metrics[METRIC.maplePoints] +=
        prices.returnMaplePoints / acceptedChance;
    } else {
      const rejectValue = solve(
        slots,
        attackNeeded,
        statNeeded,
        chaos100Stock - 1,
      );
      metrics = zeroMetrics();
      let rejectMetrics = null;
      for (const transition of grouped) {
        const acceptValue = solve(
          slots - 1,
          transition.attackNeeded,
          transition.statNeeded,
          chaos100Stock - 1,
        );
        const accept = acceptValue.feasible &&
            (!rejectValue.feasible ||
              compareObjectives(acceptValue, rejectValue) <= 0);
        let nextMetrics;
        if (accept) {
          nextMetrics = evaluate(
              slots - 1,
              transition.attackNeeded,
              transition.statNeeded,
              chaos100Stock - 1,
            );
        } else {
          rejectMetrics ??= evaluate(
              slots,
              attackNeeded,
              statNeeded,
              chaos100Stock - 1,
            );
          nextMetrics = rejectMetrics;
        }
        addMetricVector(metrics, nextMetrics, transition.chance);
      }
      metrics[METRIC.returnOwnedChaos100] += 1;
      metrics[METRIC.returnScrolls] += 1;
      metrics[METRIC.maplePoints] += prices.returnMaplePoints;
    }
    evaluationMemo.set(key, metrics);
    return metrics;
  }

  return {
    solve,
    evaluate,
    actionFor,
    stats() {
      return {
        statesEvaluated,
        memoEntries: memo.size,
        evaluatedPolicyStates: evaluationMemo.size,
        groupedTransitionEntries: [...transitionMemo.values()].reduce(
          (sum, grouped) => sum + grouped.length,
          0,
        ),
        rawTransitionEntries: transitionMemo.size * outcomes.length,
      };
    },
  };
}

function targetOutcomes(outcomes, { attackTarget, statTarget }) {
  assertNonNegative(attackTarget, "첫작 목표 공·마");
  assertNonNegative(statTarget, "첫작 목표 스탯 합");
  const accepted = outcomes.filter(
    (outcome) => outcome.attack >= attackTarget && outcome.stat >= statTarget,
  );
  const chance = accepted.reduce((sum, outcome) => sum + outcome.chance, 0);
  if (!(chance > 0)) throw new RangeError("이 첫작 놀긍 목표는 나올 수 없습니다.");
  return { accepted, chance };
}

function createFirstSolver({
  paidRates,
  target,
  attackGoal,
  statGoal,
  slots,
  prices,
  remainder,
}) {
  const memo = new Map();
  const successMemo = new Map();
  const evaluationMemo = new Map();
  const successEvaluationMemo = new Map();
  let statesEvaluated = 0;
  const remainingSlots = slots - 1;
  const targetTransitions = groupOutcomeTransitions(
    target.accepted,
    attackGoal,
    statGoal,
  );

  function firstPurchasedMetrics(rate) {
    const metrics = zeroMetrics();
    metrics[
      rate === 60 ? METRIC.firstPurchasedChaos60 :
        METRIC.firstPurchasedChaos100
    ] = 1;
    metrics[METRIC.meso] = rate === 60
      ? prices.chaos60Meso
      : prices.chaos100Meso;
    return metrics;
  }

  function firstOwnedMetrics() {
    const metrics = zeroMetrics();
    metrics[METRIC.firstOwnedChaos100] = 1;
    return metrics;
  }

  function arkInnocentMetrics(owned) {
    const metrics = zeroMetrics();
    if (owned) {
      metrics[METRIC.ownedArkInnocent100] = 1;
    } else {
      metrics[METRIC.purchasedArkInnocent100] = 1;
      metrics[METRIC.meso] = prices.arkInnocent100Meso;
    }
    return metrics;
  }

  function successfulContinuation(chaos100Stock) {
    const cached = successMemo.get(chaos100Stock);
    if (cached) return cached;
    const weighted = zeroObjective();
    for (const transition of targetTransitions) {
      const next = remainder.solve(
        remainingSlots,
        transition.attackNeeded,
        transition.statNeeded,
        chaos100Stock,
      );
      if (!next.feasible) {
        const impossible = impossibleObjective();
        successMemo.set(chaos100Stock, impossible);
        return impossible;
      }
      const weight = transition.chance / target.chance;
      weighted.maplePoints += weight * next.maplePoints;
      weighted.meso += weight * next.meso;
      weighted.ownedUsed += weight * next.ownedUsed;
    }
    successMemo.set(chaos100Stock, weighted);
    return weighted;
  }

  function solve(chaos100Stock, arkInnocentStock) {
    const key = `${chaos100Stock}:${arkInnocentStock}`;
    const cached = memo.get(key);
    if (cached) return cached;
    statesEvaluated += 1;
    const candidates = [];
    const success = successfulContinuation(chaos100Stock);

    if (success.feasible) {
      /*
       * 자동 모드는 이 상태에서 유료 60/100% 후보를 모두 비교한다.
       * 아크 이노 재고가 줄어들면 solve를 다시 통해 다음 시도의
       * 최적 주문서도 다시 고른다.
       */
      for (const paidRate of paidRates) {
        const rate = paidRate / 100;
        const successChance = rate * target.chance;
        const purchasedMeso = paidRate === 60
          ? prices.chaos60Meso
          : prices.chaos100Meso;
        let candidate;
        if (arkInnocentStock > 0) {
          const failure = solve(chaos100Stock, arkInnocentStock - 1);
          candidate = {
            feasible: failure.feasible,
            maplePoints:
              successChance * success.maplePoints +
              (1 - successChance) * failure.maplePoints,
            meso:
              purchasedMeso + successChance * success.meso +
              (1 - successChance) * failure.meso,
            ownedUsed:
              successChance * success.ownedUsed +
              (1 - successChance) * (1 + failure.ownedUsed),
          };
        } else {
          // 재고가 없는 같은 상태의 반복은 선택한 주문서별
          // 기하분포 폐형식으로 풀고, 두 폐형식 결과를 비교한다.
          candidate = {
            feasible: true,
            maplePoints: success.maplePoints,
            meso:
              purchasedMeso / successChance +
              prices.arkInnocent100Meso *
                (1 - successChance) / successChance +
              success.meso,
            ownedUsed: success.ownedUsed,
          };
        }
        const action = {
          phase: "first",
          source: `purchased-chaos-${paidRate}`,
          rate: paidRate,
          chance: successChance,
          acceptedOutcomeCount: target.accepted.length,
          requestedOutcomeCount:
            target.requestedOutcomeCount ?? target.accepted.length,
          finalFeasibleOutcomeCount: target.accepted.length,
          usesReturn: false,
          protected: false,
          scrollSuccessRate: rate,
          failureConsumesSlot: false,
          resetOnMiss: true,
        };
        candidate.action = action;
        candidate.decision = { kind: "first-purchased", paidRate };
        candidates.push(candidate);
      }
    }

    if (chaos100Stock > 0) {
      const ownedSuccess = successfulContinuation(chaos100Stock - 1);
      if (ownedSuccess.feasible) {
        let failure;
        let failureMeso;
        let failureOwned;
        if (arkInnocentStock > 0) {
          failure = solve(chaos100Stock - 1, arkInnocentStock - 1);
          failureMeso = failure.meso;
          failureOwned = 1 + failure.ownedUsed;
        } else {
          failure = solve(chaos100Stock - 1, 0);
          failureMeso = prices.arkInnocent100Meso + failure.meso;
          failureOwned = failure.ownedUsed;
        }
        const candidate = {
          feasible: failure.feasible,
          maplePoints:
            target.chance * ownedSuccess.maplePoints +
            (1 - target.chance) * failure.maplePoints,
          meso:
            target.chance * ownedSuccess.meso +
            (1 - target.chance) * failureMeso,
          ownedUsed:
            1 + target.chance * ownedSuccess.ownedUsed +
            (1 - target.chance) * failureOwned,
        };
        const action = {
          phase: "first",
          source: "owned-chaos-100",
          rate: 100,
          chance: target.chance,
          acceptedOutcomeCount: target.accepted.length,
          requestedOutcomeCount:
            target.requestedOutcomeCount ?? target.accepted.length,
          finalFeasibleOutcomeCount: target.accepted.length,
          usesReturn: false,
          protected: false,
          scrollSuccessRate: 1,
          failureConsumesSlot: false,
          resetOnMiss: true,
        };
        candidate.action = action;
        candidate.decision = { kind: "first-owned" };
        candidates.push(candidate);
      }
    }

    const best = bestObjective(candidates);
    memo.set(key, best);
    return best;
  }

  function successfulEvaluation(chaos100Stock) {
    const cached = successEvaluationMemo.get(chaos100Stock);
    if (cached) return cached;
    const weighted = zeroMetrics();
    for (const transition of targetTransitions) {
      addMetricVector(
        weighted,
        remainder.evaluate(
          remainingSlots,
          transition.attackNeeded,
          transition.statNeeded,
          chaos100Stock,
        ),
        transition.chance / target.chance,
      );
    }
    successEvaluationMemo.set(chaos100Stock, weighted);
    return weighted;
  }

  function evaluate(chaos100Stock, arkInnocentStock) {
    const key = `${chaos100Stock}:${arkInnocentStock}`;
    const cached = evaluationMemo.get(key);
    if (cached) return cached;
    const value = solve(chaos100Stock, arkInnocentStock);
    if (!value.feasible) {
      throw new RangeError("선택된 첫작 놀긍 정책을 평가할 수 없습니다.");
    }

    let metrics;
    if (value.decision.kind === "first-purchased") {
      const paidRate = value.decision.paidRate;
      const successChance = paidRate / 100 * target.chance;
      const purchasedAttempt = firstPurchasedMetrics(paidRate);
      const success = successfulEvaluation(chaos100Stock);
      if (arkInnocentStock > 0) {
        const failure = arkInnocentMetrics(true);
        addMetricVector(
          failure,
          evaluate(chaos100Stock, arkInnocentStock - 1),
        );
        metrics = purchasedAttempt;
        addMetricVector(metrics, success, successChance);
        addMetricVector(metrics, failure, 1 - successChance);
      } else {
        metrics = scaledMetrics(purchasedAttempt, 1 / successChance);
        addMetricVector(
          metrics,
          arkInnocentMetrics(false),
          (1 - successChance) / successChance,
        );
        addMetricVector(metrics, success);
      }
    } else {
      const success = successfulEvaluation(chaos100Stock - 1);
      const hasOwnedReset = arkInnocentStock > 0;
      const failure = arkInnocentMetrics(hasOwnedReset);
      addMetricVector(
        failure,
        evaluate(
          chaos100Stock - 1,
          hasOwnedReset ? arkInnocentStock - 1 : 0,
        ),
      );
      metrics = firstOwnedMetrics();
      addMetricVector(metrics, success, target.chance);
      addMetricVector(metrics, failure, 1 - target.chance);
    }
    evaluationMemo.set(key, metrics);
    return metrics;
  }

  return {
    solve,
    evaluate,
    stats() {
      return {
        statesEvaluated,
        memoEntries: memo.size,
        evaluatedPolicyStates: evaluationMemo.size,
        groupedTargetEntries: targetTransitions.length,
        rawTargetEntries: target.accepted.length,
      };
    },
  };
}

/** 메소를 메이플포인트 가치로 환산한다. */
export function mesoToMaplePoints(
  meso,
  maplePointsPer100MillionMeso = DEFAULT_MAPLE_POINTS_PER_100M,
) {
  assertNonNegative(meso, "메소");
  if (!(Number.isFinite(maplePointsPer100MillionMeso) && maplePointsPer100MillionMeso > 0)) {
    throw new RangeError("1억 메소당 메이플포인트는 0보다 커야 합니다.");
  }
  return (meso / ONE_HUNDRED_MILLION) * maplePointsPer100MillionMeso;
}

/** 메이플포인트를 메소 가치로 환산한다. */
export function maplePointsToMeso(
  maplePoints,
  maplePointsPer100MillionMeso = DEFAULT_MAPLE_POINTS_PER_100M,
) {
  assertNonNegative(maplePoints, "메이플포인트");
  if (!(Number.isFinite(maplePointsPer100MillionMeso) && maplePointsPer100MillionMeso > 0)) {
    throw new RangeError("1억 메소당 메이플포인트는 0보다 커야 합니다.");
  }
  return (maplePoints / maplePointsPer100MillionMeso) * ONE_HUNDRED_MILLION;
}

/**
 * 보유 놀긍 100%와 보유 아크 이노센트 100%를 함께 배분하는 놀긍리턴
 * 경제 계산. 환산 표시 스위치는 반환된 equivalent 중 어느 값을 보여 줄지만
 * 결정하며, 정책은 항상 리턴 메포 → 메소 순으로 최소화한다.
 */
export function calculateChaosReturnEconomy({
  slots,
  averageAttackTarget = 6,
  averageStatTarget = 0,
  statCount = 1,
  progress: rawProgress = {},
  firstWork = null,
  returnWork = {},
  prices: rawPrices = {},
  inventory = {},
  maplePointsPer100MillionMeso = DEFAULT_MAPLE_POINTS_PER_100M,
}) {
  const { attackGoal, statGoal } = validateCommon({
    slots,
    averageAttackTarget,
    averageStatTarget,
    statCount,
  });
  const progress = normalizedProgress(rawProgress, {
    slots,
    statCount,
    attackGoal,
    statGoal,
  });
  if (progress.completedSlots > 0 && firstWork) {
    throw new RangeError(
      "이미 적용된 작이 있는 장비에는 첫작 초기화 전략을 함께 사용할 수 없습니다.",
    );
  }
  const prices = normalizedPrices(rawPrices);
  const returnPaidRate = Number(returnWork.chaosRate ?? 60);
  if (returnPaidRate !== 60) {
    throw new RangeError("리턴 구간의 유료 기본 주문서는 놀긍 60%만 사용합니다.");
  }
  const chaos100Stock = Number(inventory.chaos100Stock ?? 0);
  const arkInnocentStock = Number(inventory.arkInnocentStock ?? 0);
  assertNonNegative(chaos100Stock, "보유 놀긍 100% 수량", { integer: true });
  assertNonNegative(arkInnocentStock, "보유 아크 이노센트 100% 수량", {
    integer: true,
  });
  // 환산값은 정책을 바꾸지 않지만 반환값을 위해 미리 검증한다.
  mesoToMaplePoints(0, maplePointsPer100MillionMeso);

  const outcomes = chaosOutcomeDistribution(statCount);
  const remainder = createReturnSolver({
    outcomes,
    statCount,
    prices,
    maximumChaos100Stock: chaos100Stock,
  });
  let result;
  let firstStats = { statesEvaluated: 0, memoEntries: 0 };
  let firstPaidRates = [];
  let firstPaidRateMode = null;
  let legacyFirstPaidRate = null;
  if (firstWork) {
    firstPaidRates = normalizedFirstPaidRates(firstWork, prices);
    firstPaidRateMode = firstWork.chaosRates !== undefined ||
        firstWork.chaosRate === undefined
      ? "auto"
      : "fixed";
    legacyFirstPaidRate = firstPaidRateMode === "fixed"
      ? Number(firstWork.chaosRate)
      : null;
    const firstOptions = {
      chaosRates: firstPaidRates,
      attackTarget: Number(firstWork.attackTarget ?? 6),
      statTarget: Number(firstWork.statTarget ?? 0),
    };
    const requestedTarget = targetOutcomes(outcomes, firstOptions);
    const remainingSlots = slots - 1;
    /* 첫작 자체 목표를 넘더라도 그 결과로 최종 평균 목표를 이어 갈 수
       없다면 채택하지 않고 초기화한다. 가능한 결과만 다시 정규화한다. */
    const accepted = requestedTarget.accepted.filter((outcome) =>
      Math.max(0, attackGoal - outcome.attack) <= 6 * remainingSlots &&
      Math.max(0, statGoal - outcome.stat) <=
        6 * statCount * remainingSlots
    );
    if (accepted.length === 0) {
      throw new RangeError(
        "첫작 목표와 최종 평균 목표를 함께 달성할 수 없습니다.",
      );
    }
    const target = {
      accepted,
      chance: accepted.reduce((sum, outcome) => sum + outcome.chance, 0),
      requestedChance: requestedTarget.chance,
      requestedOutcomeCount: requestedTarget.accepted.length,
    };
    const first = createFirstSolver({
      paidRates: firstOptions.chaosRates,
      target,
      attackGoal,
      statGoal,
      slots,
      prices,
      remainder,
    });
    const firstValue = first.solve(chaos100Stock, arkInnocentStock);
    result = firstValue.feasible
      ? metricsToPlan(
        first.evaluate(chaos100Stock, arkInnocentStock),
        firstValue.action,
      )
      : impossiblePlan();
    firstStats = first.stats();
  } else {
    const remainderValue = remainder.solve(
      progress.remainingSlots,
      progress.needed.attack,
      progress.needed.stat,
      chaos100Stock,
    );
    result = remainderValue.feasible
      ? metricsToPlan(
        remainder.evaluate(
          progress.remainingSlots,
          progress.needed.attack,
          progress.needed.stat,
          chaos100Stock,
        ),
        remainder.actionFor(remainderValue),
      )
      : impossiblePlan();
  }
  if (!result.feasible) {
    throw new RangeError("이 놀긍리턴 목표는 달성할 수 없습니다.");
  }

  const expected = {
    chaosScrolls:
      result.firstPurchasedChaos60 +
      result.firstPurchasedChaos100 +
      result.firstOwnedChaos100 +
      result.returnPurchasedChaos60 +
      result.returnOwnedChaos100,
    purchasedChaos60:
      result.firstPurchasedChaos60 + result.returnPurchasedChaos60,
    purchasedChaos100: result.firstPurchasedChaos100,
    ownedChaos100Used:
      result.firstOwnedChaos100 + result.returnOwnedChaos100,
    unprotectedChaosScrolls:
      result.returnUnprotectedPurchasedChaos60 +
      result.returnUnprotectedOwnedChaos100,
    first: {
      purchasedChaos60: result.firstPurchasedChaos60,
      purchasedChaos100: result.firstPurchasedChaos100,
      ownedChaos100Used: result.firstOwnedChaos100,
    },
    remainder: {
      purchasedChaos60: result.returnPurchasedChaos60,
      ownedChaos100Used: result.returnOwnedChaos100,
      returnScrolls: result.returnScrolls,
      unprotectedChaosScrolls:
        result.returnUnprotectedPurchasedChaos60 +
        result.returnUnprotectedOwnedChaos100,
      unprotectedPurchasedChaos60:
        result.returnUnprotectedPurchasedChaos60,
      unprotectedOwnedChaos100Used:
        result.returnUnprotectedOwnedChaos100,
    },
    arkInnocent100:
      result.purchasedArkInnocent100 + result.ownedArkInnocent100,
    purchasedArkInnocent100: result.purchasedArkInnocent100,
    ownedArkInnocent100Used: result.ownedArkInnocent100,
    returnScrolls: result.returnScrolls,
  };
  const mesoAsMaplePoints = mesoToMaplePoints(
    result.meso,
    maplePointsPer100MillionMeso,
  );
  const cashAsMeso = maplePointsToMeso(
    result.maplePoints,
    maplePointsPer100MillionMeso,
  );
  const costs = {
    meso: result.meso,
    maplePoints: result.maplePoints,
    breakdown: {
      chaos60Meso: expected.purchasedChaos60 * prices.chaos60Meso,
      chaos100Meso: expected.purchasedChaos100 * prices.chaos100Meso,
      arkInnocent100Meso:
        expected.purchasedArkInnocent100 * prices.arkInnocent100Meso,
      returnMaplePoints: expected.returnScrolls * prices.returnMaplePoints,
    },
    equivalent: {
      maplePointsPer100MillionMeso,
      mesoAsMaplePoints,
      cashAsMeso,
      totalMaplePoints: result.maplePoints + mesoAsMaplePoints,
      totalMeso: result.meso + cashAsMeso,
    },
  };

  return {
    goals: {
      attack: attackGoal,
      stat: statGoal,
      averageAttack: attackGoal / slots,
      averageStat: statGoal / slots,
    },
    objective: {
      primary: "return-maple-points",
      secondary: "meso",
      conversionAffectsStrategy: false,
    },
    progress,
    inventory: { chaos100Stock, arkInnocentStock },
    expected,
    costs,
    strategy: {
      initialAction: result.action,
      returnPaidRate,
      // 단일 chaosRate 호출자에게는 기존 필드를 그대로 제공한다.
      // 자동 모드의 실제 첫 행동은 initialAction.rate를 본다.
      firstPaidRate: legacyFirstPaidRate,
      firstPaidRates,
      firstPaidRateMode,
    },
    diagnostics: {
      first: firstStats,
      remainder: remainder.stats(),
    },
  };
}

export const CHAOS_RETURN_EXCHANGE_DEFAULTS = Object.freeze({
  maplePointsPer100MillionMeso: DEFAULT_MAPLE_POINTS_PER_100M,
});
