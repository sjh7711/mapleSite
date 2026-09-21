/**
 * 루나 쁘띠(통칭 자석펫) 합성 기대값.
 *
 * 확률은 2026-08-31 메이플스토리 공식 확률표를 기준으로 한다.
 * - 원더 블랙 + 원더 블랙: 쁘띠 11.64%, 스윗 86.4%, 키 1.96%
 * - 루나 스윗 + 원더 블랙: 쁘띠 20.4%, 드림 75.6%, 키 4%
 * - 원더베리 원더 블랙: 평시 9.96%, 확률 증가 기간 11.952%
 *
 * 스윗 결과는 바로 2차 합성에 쓰고, 쁘띠가 나오지 않으면 새 경로를
 * 시작한다고 가정한다. 시뮬레이션 없이 닫힌식으로 계산하므로 결과가
 * 빠르고 재현 가능하다.
 */

export const PET_PROBABILITIES = Object.freeze({
  wonderBlack: Object.freeze({
    normal: 0.0996,
    event: 0.11952,
  }),
  wonderUpperPet: Object.freeze({
    normal: 0.6,
    event: 0.58008,
  }),
  wonderConsumable: 0.3004,
  sweetSynthesis: Object.freeze({
    petite: 0.1164,
    sweet: 0.864,
    key: 0.0196,
  }),
  dreamSynthesis: Object.freeze({
    petite: 0.204,
    dream: 0.756,
    key: 0.04,
  }),
});

export const PET_PAYBACK_POINTS = 540;

export const PET_PROBABILITY_SNAPSHOT_DATE = "2026-09-17";

export const PET_SOURCE_URLS = Object.freeze({
  wonderBerry:
    "https://maplestory.nexon.com/Guide/CashShop/Probability/WispsWonderBerry",
  wonderGuide:
    "https://maplestory.nexon.com/Guide/N23GameInformation/Articles/437",
  lunaSweet:
    "https://maplestory.nexon.com/Guide/CashShop/Probability/LunaCrystalSweet",
  lunaDream:
    "https://maplestory.nexon.com/Guide/CashShop/Probability/LunaCrystalDream",
  lunaGuide:
    "https://maplestory.nexon.com/Guide/N23GameInformation/Articles/438",
  auctionGuide:
    "https://maplestory.nexon.com/Guide/N23GameInformation/Articles/394",
});

const MESO_PER_EOK = 100_000_000;
const SOURCE_MODES = new Set(["wonderberry", "auction", "cheapest"]);
const AUCTION_FEE_RATES = new Set([0.03, 0.05]);
const COST_CONVERSION_BASES = new Set(["maple-point", "won"]);
const WONDER_BERRY_PROCUREMENT_MODES = new Set([
  "cheapest",
  "maple-point-bundle",
  "auction-bundle",
  "hybrid-bundle",
]);

function finiteNonNegative(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new RangeError(`${name}은(는) 0 이상의 수여야 합니다.`);
  }
  return number;
}

function finitePositive(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new RangeError(`${name}은(는) 0보다 커야 합니다.`);
  }
  return number;
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new RangeError(`${name}은(는) 1 이상의 정수여야 합니다.`);
  }
  return number;
}

function nonNegativeInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new RangeError(`${name}은(는) 0 이상의 정수여야 합니다.`);
  }
  return number;
}

function resolveCostConversion(options) {
  const costConversionBasis =
    options.costConversionBasis ?? "maple-point";
  if (!COST_CONVERSION_BASES.has(costConversionBasis)) {
    throw new RangeError(
      "비용 환산 기준은 maple-point 또는 won이어야 합니다.",
    );
  }

  const maplePointsPer100MillionMeso = finitePositive(
    options.maplePointsPer100MillionMeso ?? 2_000,
    "1억 메소당 메이플포인트",
  );
  const hasWonRate =
    options.wonPer100MillionMeso !== undefined &&
    options.wonPer100MillionMeso !== null &&
    options.wonPer100MillionMeso !== "";
  const wonPer100MillionMeso = hasWonRate
    ? finitePositive(options.wonPer100MillionMeso, "1억 메소 시세")
    : null;
  if (costConversionBasis === "won" && wonPer100MillionMeso === null) {
    throw new RangeError(
      "원 기준으로 환산하려면 1억 메소 시세를 입력해야 합니다.",
    );
  }

  const maplePointToMeso =
    MESO_PER_EOK / maplePointsPer100MillionMeso;
  const wonToMeso = wonPer100MillionMeso === null
    ? null
    : MESO_PER_EOK / wonPer100MillionMeso;
  // 메이플포인트로 결제하거나 페이백되는 항목은 실제 메소마켓
  // 환율로만 메소 환산한다. 현금 시세는 비교 표시용 메타데이터이며
  // 계산 경로·구매 기준가를 바꾸지 않는다.
  const conversionUnitsPer100MillionMeso =
    maplePointsPer100MillionMeso;
  const conversionToMeso = maplePointToMeso;

  return {
    purchaseLedger: "maple-point",
    costConversionBasis,
    conversionBasis: "maple-point",
    calculationConversionBasis: "maple-point-market",
    maplePointsPer100MillionMeso,
    wonPer100MillionMeso,
    conversionUnitsPer100MillionMeso,
    conversionToMeso,
    maplePointToMeso,
    wonToMeso,
  };
}

function resolveWonderBerryProcurementMode(
  options,
  auctionBundleMesoPrice = 0,
) {
  const mode = options.wonderBerryProcurementMode ?? "cheapest";
  if (!WONDER_BERRY_PROCUREMENT_MODES.has(mode)) {
    throw new RangeError(
      "원더베리 조달 방식은 cheapest, maple-point-bundle, auction-bundle 또는 hybrid-bundle이어야 합니다.",
    );
  }
  if (
    (mode === "auction-bundle" || mode === "hybrid-bundle") &&
    !(auctionBundleMesoPrice > 0)
  ) {
    throw new RangeError(
      "경매장 묶음 조달을 선택했다면 원더베리 11개 묶음 경매장 시세를 입력해야 합니다.",
    );
  }
  return mode;
}

/**
 * 고정 수량의 원더베리를 11개 묶음 단위로 확보할 때 캐시샵 메포
 * 묶음과 경매장 메소 묶음 중 총매입가가 낮은 출처를 선택한다.
 *
 * 개봉 산출물의 페이백과 교환 가능 여부는 조달처별 결과 계산에서
 * 별도로 반영하므로, 이 함수는 고정 수량을 확보하는 순수 조달
 * 비용만 비교한다.
 */
export function optimizeWonderBerryProcurement(options = {}) {
  const requiredWonderBerries = nonNegativeInteger(
    options.requiredWonderBerries ?? 0,
    "필요 원더베리 수",
  );
  const wonderBerryBundleSize = positiveInteger(
    options.wonderBerryBundleSize ?? 11,
    "원더베리 묶음 개수",
  );
  const wonderBerryBundleMaplePoints = finiteNonNegative(
    options.wonderBerryBundleMaplePoints ??
      options.wonderBerryBundlePrice ??
      54_000,
    "원더베리 묶음 가격",
  );
  const wonderBerryAuctionBundleMesoPrice = finiteNonNegative(
    options.wonderBerryAuctionBundleMesoPrice ?? 0,
    "원더베리 11개 묶음 경매장 시세",
  );
  const currency = resolveCostConversion(options);
  const procurementMode = resolveWonderBerryProcurementMode(
    options,
    wonderBerryAuctionBundleMesoPrice,
  );
  if (procurementMode === "hybrid-bundle") {
    throw new RangeError(
      "고정 원더베리 수량 조달에는 hybrid-bundle을 사용할 수 없습니다.",
    );
  }
  const maplePointBundleMesoEquivalent =
    wonderBerryBundleMaplePoints * currency.conversionToMeso;
  const requiredBundles = Math.ceil(
    requiredWonderBerries / wonderBerryBundleSize,
  );
  const auctionBundleAvailable =
    wonderBerryAuctionBundleMesoPrice > 0;
  const selectedProcurement = requiredBundles === 0
    ? "none"
    : procurementMode === "maple-point-bundle"
      ? "maple-point-bundle"
      : procurementMode === "auction-bundle"
        ? "auction-bundle"
        : auctionBundleAvailable &&
            wonderBerryAuctionBundleMesoPrice <
              maplePointBundleMesoEquivalent
          ? "auction-bundle"
          : "maple-point-bundle";
  const maplePointBundles = selectedProcurement === "maple-point-bundle"
    ? requiredBundles
    : 0;
  const auctionBundles = selectedProcurement === "auction-bundle"
    ? requiredBundles
    : 0;
  const suppliedWonderBerries =
    requiredBundles * wonderBerryBundleSize;
  const best = {
    maplePointBundles,
    auctionBundles,
    purchasedBundles: requiredBundles,
    suppliedWonderBerries,
    excessWonderBerries:
      suppliedWonderBerries - requiredWonderBerries,
    bundleMaplePoints:
      maplePointBundles * wonderBerryBundleMaplePoints,
    auctionBundleMeso:
      auctionBundles * wonderBerryAuctionBundleMesoPrice,
    totalMesoEquivalent:
      maplePointBundles * maplePointBundleMesoEquivalent +
      auctionBundles * wonderBerryAuctionBundleMesoPrice,
  };

  return {
    scope: "gross-wonderberry-procurement",
    requiredWonderBerries,
    selectedProcurement,
    purchaseUnitLabel: "묶음",
    purchaseUnitSize: wonderBerryBundleSize,
    wonderBerryBundleSize,
    wonderBerryBundleMaplePoints,
    wonderBerryAuctionBundleMesoPrice,
    currency,
    plan: best,
    comparison: {
      bundleOnlyMesoEquivalent:
        requiredBundles * maplePointBundleMesoEquivalent,
      maplePointBundleOnlyMesoEquivalent:
        requiredBundles * maplePointBundleMesoEquivalent,
      auctionBundleOnlyMesoEquivalent:
        auctionBundleAvailable
          ? requiredBundles * wonderBerryAuctionBundleMesoPrice
          : null,
      maplePointBundleMesoEquivalent,
      auctionBundleBreakEvenMeso:
        maplePointBundleMesoEquivalent,
    },
    tradeability: {
      included: true,
      auctionWonderBerryBundleTradableAfterReceipt: false,
      openedResultsFollowNormalRules: true,
      openedResultsTradeable:
        selectedProcurement === "auction-bundle"
          ? true
          : selectedProcurement === "maple-point-bundle"
            ? false
            : null,
      outputTradeability:
        selectedProcurement === "auction-bundle"
          ? "tradeable-once"
          : selectedProcurement === "maple-point-bundle"
            ? "untradeable"
            : null,
      note:
        "캐시샵 메포 묶음 산출물은 교환 불가, 경매장 묶음 산출물은 1회 교환 가능으로 계산합니다.",
    },
  };
}

/** true는 공식 20% 증가 이벤트, 숫자는 계산 경로에 전달하는 실제 확률이다. */
function resolveWonderBlackEvent(options) {
  if (typeof options.wonderBlackEvent === "number") {
    getWonderBlackProbability(options.wonderBlackEvent);
    return options.wonderBlackEvent;
  }
  if (options.wonderBlackEvent !== true) return false;
  const increase = finiteNonNegative(options.wonderBlackEventIncreasePercent ?? 20, "이벤트 확률 증가");
  const probability = PET_PROBABILITIES.wonderBlack.normal * (1 + increase / 100);
  getWonderBlackProbability(probability);
  return probability;
}

export function getWonderBlackProbability(event = false) {
  if (typeof event === "number") {
    if (!Number.isFinite(event) || event <= 0 || event > 1 - PET_PROBABILITIES.wonderConsumable) {
      throw new RangeError("이벤트 확률 증가값이 허용 범위를 넘었습니다.");
    }
    return event;
  }
  return event ? PET_PROBABILITIES.wonderBlack.event : PET_PROBABILITIES.wonderBlack.normal;
}

export function getWonderUpperPetProbability(event = false) {
  // 공식 이벤트와 동일하게 소모품 비중을 유지하고 원더 펫 비중에서 차감한다.
  return 1 - PET_PROBABILITIES.wonderConsumable - getWonderBlackProbability(event);
}

/** 한 번의 경로(B+B, 스윗이면 S+B)에서 쁘띠를 얻을 확률. */
export function getPetiteRouteProbability() {
  const first = PET_PROBABILITIES.sweetSynthesis;
  const second = PET_PROBABILITIES.dreamSynthesis;
  return first.petite + first.sweet * second.petite;
}

/** n회 독립 경로에서 target마리 이상 얻을 확률. */
export function probabilityOfTargetWithinRoutes(routes, target, probability = getPetiteRouteProbability()) {
  const n = Math.max(0, Math.trunc(Number(routes) || 0));
  const k = positiveInteger(target, "목표 마릿수");
  const p = Number(probability);
  if (!(p > 0 && p <= 1)) {
    throw new RangeError("경로 성공 확률은 0보다 크고 1 이하여야 합니다.");
  }
  if (n < k) return 0;
  if (p === 1) return 1;

  // P(X < k)를 이항분포의 항간 점화식으로 더한다.
  const q = 1 - p;
  let term = q ** n;
  let belowTarget = term;
  for (let successes = 0; successes < k - 1; successes += 1) {
    term *= ((n - successes) / (successes + 1)) * (p / q);
    belowTarget += term;
  }
  return Math.max(0, Math.min(1, 1 - belowTarget));
}

/** 목표 확률에 처음 도달하는 경로 횟수. */
export function routesForTargetChance(target, chance, probability = getPetiteRouteProbability()) {
  const k = positiveInteger(target, "목표 마릿수");
  const wanted = Number(chance);
  if (!(wanted > 0 && wanted < 1)) {
    throw new RangeError("목표 확률은 0보다 크고 1보다 작아야 합니다.");
  }
  for (let routes = k; routes <= 100_000; routes += 1) {
    if (probabilityOfTargetWithinRoutes(routes, k, probability) >= wanted) {
      return routes;
    }
  }
  return Infinity;
}

/**
 * 최대 경로 횟수 안에서 목표를 달성하면 즉시 멈추는 정책의 정확한 기대값.
 * 
 * 각 경로는 독립적인 베르누이 시행이며, 목표 달성 전에만 다음
 * 경로를 시도한다. 경매장·혼합 경로의 한 경로당 재료량에
 * `expectedAttempts`를 곱하면 선택 확률 기준 기대 재료량을 얻을 수 있다.
 */
export function calculateCappedRouteExpectation(options = {}) {
  const targetCount = positiveInteger(
    options.targetCount ?? 1,
    "목표 마릿수",
  );
  const maxRoutes = nonNegativeInteger(
    options.maxRoutes ?? options.maximumRoutes ?? 0,
    "최대 경로 횟수",
  );
  const routeSuccessProbability = Number(
    options.routeSuccessProbability ??
      options.probability ??
      getPetiteRouteProbability(),
  );
  if (!(routeSuccessProbability > 0 && routeSuccessProbability <= 1)) {
    throw new RangeError("경로 성공 확률은 0보다 크고 1 이하여야 합니다.");
  }

  let active = Array(targetCount).fill(0);
  active[0] = 1;
  let actualChance = 0;
  let expectedAttempts = 0;
  let expectedSuccesses = 0;

  for (let route = 0; route < maxRoutes; route += 1) {
    const next = Array(targetCount).fill(0);
    for (let successes = 0; successes < targetCount; successes += 1) {
      const stateProbability = active[successes];
      if (stateProbability === 0) continue;
      expectedAttempts += stateProbability;
      expectedSuccesses += stateProbability * routeSuccessProbability;

      const successProbability =
        stateProbability * routeSuccessProbability;
      if (successes + 1 >= targetCount) {
        actualChance += successProbability;
      } else {
        next[successes + 1] += successProbability;
      }
      next[successes] +=
        stateProbability * (1 - routeSuccessProbability);
    }
    active = next;
  }

  actualChance = Math.max(0, Math.min(1, actualChance));
  const failureProbability = Math.max(0, 1 - actualChance);
  const remainingSuccessDistribution = active
    .map((probability, successes) => ({ successes, probability }))
    .filter((entry) => entry.probability > 0);

  return {
    targetCount,
    maxRoutes,
    maximumRoutes: maxRoutes,
    routeSuccessProbability,
    actualChance,
    successProbability: actualChance,
    failureProbability,
    expectedAttempts,
    expected: {
      routeAttempts: expectedAttempts,
      successfulRoutes: expectedSuccesses,
      failedRoutes: expectedAttempts - expectedSuccesses,
      petites: expectedSuccesses,
    },
    remainingSuccessDistribution,
  };
}

const BUNDLE_REWARD_KEYS = Object.freeze([
  "purchasedBundles",
  "purchasedMaplePointBundles",
  "purchasedAuctionWonderBerryBundles",
  "openedWonderBerries",
  "openedMaplePointWonderBerries",
  "openedAuctionWonderBerries",
  "wonderBlacksPulled",
  "tradeableWonderBlacksPulled",
  "untradeableWonderBlacksPulled",
  "wonderBlacksConsumed",
  "tradeableWonderBlacksConsumedAsBase",
  "untradeableWonderBlacksConsumedAsMaterial",
  "wonderPetPaybacks",
  "wonderConsumables",
  "sweetSynthesisAttempts",
  "dreamSynthesisAttempts",
  "lunaCrystals",
  "lunaSweets",
  "lunaDreams",
  "lunaKeys",
  "sweetKeys",
  "dreamKeys",
  "directPetites",
  "dreamRoutePetites",
]);

function emptyBundleRewards() {
  return Object.fromEntries(BUNDLE_REWARD_KEYS.map((key) => [key, 0]));
}

function addWeightedRewards(target, source, weight) {
  for (const key of BUNDLE_REWARD_KEYS) {
    target[key] += source[key] * weight;
  }
}

function ensureRewardRecord(map, key) {
  let rewards = map.get(key);
  if (!rewards) {
    rewards = emptyBundleRewards();
    map.set(key, rewards);
  }
  return rewards;
}

function outcomeProbability(summary) {
  let probability = 0;
  for (const value of summary.transitions.values()) probability += value;
  for (const value of summary.absorbed.values()) probability += value;
  return probability;
}

/**
 * 한 분기의 확률과 보상을 목적 summary에 합친다.
 *
 * `transitionRewards`와 `absorbedRewards`에는 조건부 평균이 아니라
 * E[reward * I(outcome)] 형태의 결합 보상을 저장한다. 이 값이 있어야
 * N번째 묶음에서 처음 목표를 달성했다는 조건으로 누적 보상을 정확히
 * 다시 나눌 수 있다.
 */
function mergeInventoryBranch(
  target,
  child,
  branchProbability,
  immediateRewards = {},
) {
  const mergeOutcomes = (
    targetProbabilities,
    targetRewards,
    childProbabilities,
    childRewards,
  ) => {
    for (const [outcome, probability] of childProbabilities) {
      targetProbabilities.set(
        outcome,
        (targetProbabilities.get(outcome) ?? 0) +
          branchProbability * probability,
      );
      const destinationRewards = ensureRewardRecord(
        targetRewards,
        outcome,
      );
      const sourceRewards = childRewards.get(outcome);
      for (const reward of BUNDLE_REWARD_KEYS) {
        destinationRewards[reward] +=
          branchProbability *
          ((sourceRewards?.[reward] ?? 0) +
            probability * (immediateRewards[reward] ?? 0));
      }
    }
  };

  mergeOutcomes(
    target.transitions,
    target.transitionRewards,
    child.transitions,
    child.transitionRewards,
  );
  mergeOutcomes(
    target.absorbed,
    target.absorbedRewards,
    child.absorbed,
    child.absorbedRewards,
  );

  addWeightedRewards(target.rewards, child.rewards, branchProbability);
  const childProbability = outcomeProbability(child);
  for (const reward of BUNDLE_REWARD_KEYS) {
    target.rewards[reward] +=
      branchProbability *
      childProbability *
      (immediateRewards[reward] ?? 0);
  }
}

function emptyInventorySummary() {
  return {
    transitions: new Map(),
    absorbed: new Map(),
    transitionRewards: new Map(),
    absorbedRewards: new Map(),
    rewards: emptyBundleRewards(),
  };
}

function inventoryStateKey(petites, wonderBlacks, pendingSweet) {
  return `${petites}:${wonderBlacks}:${pendingSweet ? 1 : 0}`;
}

function createInventoryProcessor(targetCount) {
  const first = PET_PROBABILITIES.sweetSynthesis;
  const second = PET_PROBABILITIES.dreamSynthesis;
  const memo = new Map();

  function process(petites, wonderBlacks, pendingSweet) {
    const key = inventoryStateKey(petites, wonderBlacks, pendingSweet);
    const cached = memo.get(key);
    if (cached) return cached;

    const summary = emptyInventorySummary();

    if (petites >= targetCount) {
      summary.absorbed.set(wonderBlacks, 1);
      summary.absorbedRewards.set(wonderBlacks, emptyBundleRewards());
      memo.set(key, summary);
      return summary;
    }

    if (pendingSweet) {
      if (wonderBlacks < 1) {
        summary.transitions.set(key, 1);
        summary.transitionRewards.set(key, emptyBundleRewards());
        memo.set(key, summary);
        return summary;
      }

      const branches = [
        {
          probability: second.petite,
          child: process(petites + 1, wonderBlacks - 1, false),
          rewards: { dreamRoutePetites: 1 },
        },
        {
          probability: second.dream,
          child: process(petites, wonderBlacks - 1, false),
          rewards: { lunaDreams: 1 },
        },
        {
          probability: second.key,
          child: process(petites, wonderBlacks - 1, false),
          rewards: { dreamKeys: 1, lunaKeys: 1 },
        },
      ];
      for (const branch of branches) {
        mergeInventoryBranch(summary, branch.child, branch.probability, {
          ...branch.rewards,
          wonderBlacksConsumed: 1,
          dreamSynthesisAttempts: 1,
          lunaCrystals: 1,
        });
      }
      memo.set(key, summary);
      return summary;
    }

    if (wonderBlacks < 2) {
      summary.transitions.set(key, 1);
      summary.transitionRewards.set(key, emptyBundleRewards());
      memo.set(key, summary);
      return summary;
    }

    const branches = [
      {
        probability: first.petite,
        child: process(petites + 1, wonderBlacks - 2, false),
        rewards: { directPetites: 1 },
      },
      {
        probability: first.sweet,
        child: process(petites, wonderBlacks - 2, true),
        rewards: { lunaSweets: 1 },
      },
      {
        probability: first.key,
        child: process(petites, wonderBlacks - 2, false),
        rewards: { sweetKeys: 1, lunaKeys: 1 },
      },
    ];
    for (const branch of branches) {
      mergeInventoryBranch(summary, branch.child, branch.probability, {
        ...branch.rewards,
        wonderBlacksConsumed: 2,
        sweetSynthesisAttempts: 1,
        lunaCrystals: 1,
      });
    }
    memo.set(key, summary);
    return summary;
  }

  return process;
}

function binomialDistribution(trials, probability) {
  const distribution = Array(trials + 1).fill(0);
  distribution[0] = (1 - probability) ** trials;
  for (let successes = 0; successes < trials; successes += 1) {
    distribution[successes + 1] =
      distribution[successes] *
      ((trials - successes) / (successes + 1)) *
      (probability / (1 - probability));
  }
  return distribution;
}

function createBundleBoundaryStates(targetCount) {
  const states = [];
  for (let petites = 0; petites < targetCount; petites += 1) {
    states.push({ petites, wonderBlacks: 0, pendingSweet: false });
    states.push({ petites, wonderBlacks: 1, pendingSweet: false });
    states.push({ petites, wonderBlacks: 0, pendingSweet: true });
  }
  return states;
}

function createWonderBerryBundleKernel({
  targetCount,
  wonderBlackEvent,
  bundleSize,
}) {
  const states = createBundleBoundaryStates(targetCount);
  const stateIndexes = new Map(
    states.map((state, index) => [
      inventoryStateKey(
        state.petites,
        state.wonderBlacks,
        state.pendingSweet,
      ),
      index,
    ]),
  );
  const processInventory = createInventoryProcessor(targetCount);
  const wonderBlackProbability = getWonderBlackProbability(wonderBlackEvent);
  const blackDistribution = binomialDistribution(
    bundleSize,
    wonderBlackProbability,
  );
  const wonderUpperPetProbability = getWonderUpperPetProbability(
    wonderBlackEvent,
  );
  const nonBlackProbability = 1 - wonderBlackProbability;
  const upperPetShareAmongNonBlack =
    wonderUpperPetProbability / nonBlackProbability;
  const consumableShareAmongNonBlack =
    PET_PROBABILITIES.wonderConsumable / nonBlackProbability;

  const kernels = states.map((state) => {
    const kernel = emptyInventorySummary();

    for (
      let pulledBlacks = 0;
      pulledBlacks < blackDistribution.length;
      pulledBlacks += 1
    ) {
      const probability = blackDistribution[pulledBlacks];
      if (probability === 0) continue;
      const processed = processInventory(
        state.petites,
        state.wonderBlacks + pulledBlacks,
        state.pendingSweet,
      );
      const nonBlackCount = bundleSize - pulledBlacks;
      mergeInventoryBranch(kernel, processed, probability, {
        purchasedBundles: 1,
        openedWonderBerries: bundleSize,
        wonderBlacksPulled: pulledBlacks,
        wonderPetPaybacks:
          nonBlackCount * upperPetShareAmongNonBlack,
        wonderConsumables:
          nonBlackCount * consumableShareAmongNonBlack,
      });
    }

    // 이 네 항목의 무조건부 평균은 상태와 무관하다. 닫힌값을 다시
    // 대입해 기존 API가 불필요한 부동소수점 오차를 얻지 않게 한다.
    kernel.rewards.purchasedBundles = 1;
    kernel.rewards.openedWonderBerries = bundleSize;
    kernel.rewards.wonderBlacksPulled =
      bundleSize * wonderBlackProbability;
    kernel.rewards.wonderPetPaybacks =
      bundleSize * wonderUpperPetProbability;
    kernel.rewards.wonderConsumables =
      bundleSize * PET_PROBABILITIES.wonderConsumable;

    const indexedTransitions = new Map();
    const indexedTransitionRewards = new Map();
    for (const [key, probability] of kernel.transitions) {
      const index = stateIndexes.get(key);
      if (index === undefined) {
        throw new Error(`원더베리 묶음 상태를 찾을 수 없습니다: ${key}`);
      }
      indexedTransitions.set(index, probability);
      indexedTransitionRewards.set(
        index,
        kernel.transitionRewards.get(key),
      );
    }
    kernel.transitions = indexedTransitions;
    kernel.transitionRewards = indexedTransitionRewards;
    return kernel;
  });

  return {
    targetCount,
    wonderBlackEvent,
    bundleSize,
    states,
    kernels,
    initialState: stateIndexes.get(inventoryStateKey(0, 0, false)),
  };
}

function hybridInventoryStateKey(
  petites,
  tradeableBlacks,
  untradeableBlacks,
  pendingSweet,
) {
  return `${petites}:${tradeableBlacks}:${untradeableBlacks}:${pendingSweet ? 1 : 0}`;
}

function hybridRemainingInventoryKey(
  tradeableBlacks,
  untradeableBlacks,
) {
  return `${tradeableBlacks}:${untradeableBlacks}`;
}

function parseHybridRemainingInventoryKey(key) {
  const [tradeableBlacks, untradeableBlacks] = key
    .split(":")
    .map(Number);
  return { tradeableBlacks, untradeableBlacks };
}

function createHybridInventoryProcessor(targetCount) {
  const first = PET_PROBABILITIES.sweetSynthesis;
  const second = PET_PROBABILITIES.dreamSynthesis;
  const memo = new Map();

  function process(
    petites,
    tradeableBlacks,
    untradeableBlacks,
    pendingSweet,
  ) {
    const key = hybridInventoryStateKey(
      petites,
      tradeableBlacks,
      untradeableBlacks,
      pendingSweet,
    );
    const cached = memo.get(key);
    if (cached) return cached;

    const summary = emptyInventorySummary();
    if (petites >= targetCount) {
      const remainingKey = hybridRemainingInventoryKey(
        tradeableBlacks,
        untradeableBlacks,
      );
      summary.absorbed.set(remainingKey, 1);
      summary.absorbedRewards.set(
        remainingKey,
        emptyBundleRewards(),
      );
      memo.set(key, summary);
      return summary;
    }

    if (pendingSweet) {
      if (untradeableBlacks < 1) {
        summary.transitions.set(key, 1);
        summary.transitionRewards.set(key, emptyBundleRewards());
        memo.set(key, summary);
        return summary;
      }
      const branches = [
        {
          probability: second.petite,
          child: process(
            petites + 1,
            tradeableBlacks,
            untradeableBlacks - 1,
            false,
          ),
          rewards: { dreamRoutePetites: 1 },
        },
        {
          probability: second.dream,
          child: process(
            petites,
            tradeableBlacks,
            untradeableBlacks - 1,
            false,
          ),
          rewards: { lunaDreams: 1 },
        },
        {
          probability: second.key,
          child: process(
            petites,
            tradeableBlacks,
            untradeableBlacks - 1,
            false,
          ),
          rewards: { dreamKeys: 1, lunaKeys: 1 },
        },
      ];
      for (const branch of branches) {
        mergeInventoryBranch(summary, branch.child, branch.probability, {
          ...branch.rewards,
          wonderBlacksConsumed: 1,
          untradeableWonderBlacksConsumedAsMaterial: 1,
          dreamSynthesisAttempts: 1,
          lunaCrystals: 1,
        });
      }
      memo.set(key, summary);
      return summary;
    }

    if (tradeableBlacks < 1 || untradeableBlacks < 1) {
      summary.transitions.set(key, 1);
      summary.transitionRewards.set(key, emptyBundleRewards());
      memo.set(key, summary);
      return summary;
    }

    const branches = [
      {
        probability: first.petite,
        child: process(
          petites + 1,
          tradeableBlacks - 1,
          untradeableBlacks - 1,
          false,
        ),
        rewards: { directPetites: 1 },
      },
      {
        probability: first.sweet,
        child: process(
          petites,
          tradeableBlacks - 1,
          untradeableBlacks - 1,
          true,
        ),
        rewards: { lunaSweets: 1 },
      },
      {
        probability: first.key,
        child: process(
          petites,
          tradeableBlacks - 1,
          untradeableBlacks - 1,
          false,
        ),
        rewards: { sweetKeys: 1, lunaKeys: 1 },
      },
    ];
    for (const branch of branches) {
      mergeInventoryBranch(summary, branch.child, branch.probability, {
        ...branch.rewards,
        wonderBlacksConsumed: 2,
        tradeableWonderBlacksConsumedAsBase: 1,
        untradeableWonderBlacksConsumedAsMaterial: 1,
        sweetSynthesisAttempts: 1,
        lunaCrystals: 1,
      });
    }
    memo.set(key, summary);
    return summary;
  }

  return process;
}

function createHybridBundleBoundaryStates(targetCount, bundleSize) {
  const states = [];
  for (let petites = 0; petites < targetCount; petites += 1) {
    // 첫 합성 베이스가 없으면 경매장 묶음을 먼저 보충한다.
    for (
      let untradeableBlacks = 0;
      untradeableBlacks <= bundleSize;
      untradeableBlacks += 1
    ) {
      states.push({
        petites,
        tradeableBlacks: 0,
        untradeableBlacks,
        pendingSweet: false,
      });
    }
    // 교가 베이스는 있으나 교불 재료가 없는 상태다.
    for (
      let tradeableBlacks = 1;
      tradeableBlacks <= bundleSize;
      tradeableBlacks += 1
    ) {
      states.push({
        petites,
        tradeableBlacks,
        untradeableBlacks: 0,
        pendingSweet: false,
      });
    }
    // 교가 스윗을 보유하고 두 번째 합성용 교불 블랙이 없는 상태다.
    for (
      let tradeableBlacks = 0;
      tradeableBlacks <= bundleSize;
      tradeableBlacks += 1
    ) {
      states.push({
        petites,
        tradeableBlacks,
        untradeableBlacks: 0,
        pendingSweet: true,
      });
    }
  }
  return states;
}

function createHybridWonderBerryBundleKernel({
  targetCount,
  wonderBlackEvent,
  bundleSize,
}) {
  const states = createHybridBundleBoundaryStates(
    targetCount,
    bundleSize,
  );
  const stateIndexes = new Map(
    states.map((state, index) => [
      hybridInventoryStateKey(
        state.petites,
        state.tradeableBlacks,
        state.untradeableBlacks,
        state.pendingSweet,
      ),
      index,
    ]),
  );
  const processInventory = createHybridInventoryProcessor(targetCount);
  const wonderBlackProbability = getWonderBlackProbability(
    wonderBlackEvent,
  );
  const blackDistribution = binomialDistribution(
    bundleSize,
    wonderBlackProbability,
  );
  const wonderUpperPetProbability = getWonderUpperPetProbability(
    wonderBlackEvent,
  );
  const nonBlackProbability = 1 - wonderBlackProbability;
  const upperPetShareAmongNonBlack =
    wonderUpperPetProbability / nonBlackProbability;
  const consumableShareAmongNonBlack =
    PET_PROBABILITIES.wonderConsumable / nonBlackProbability;

  const kernels = states.map((state) => {
    const kernel = emptyInventorySummary();
    const purchaseSource = state.pendingSweet ||
      state.tradeableBlacks > 0
      ? "maple-point-bundle"
      : "auction-bundle";

    for (
      let pulledBlacks = 0;
      pulledBlacks < blackDistribution.length;
      pulledBlacks += 1
    ) {
      const probability = blackDistribution[pulledBlacks];
      if (probability === 0) continue;
      const processed = processInventory(
        state.petites,
        state.tradeableBlacks +
          (purchaseSource === "auction-bundle" ? pulledBlacks : 0),
        state.untradeableBlacks +
          (purchaseSource === "maple-point-bundle" ? pulledBlacks : 0),
        state.pendingSweet,
      );
      const nonBlackCount = bundleSize - pulledBlacks;
      const sourceRewards = purchaseSource === "maple-point-bundle"
        ? {
          purchasedMaplePointBundles: 1,
          openedMaplePointWonderBerries: bundleSize,
          untradeableWonderBlacksPulled: pulledBlacks,
        }
        : {
          purchasedAuctionWonderBerryBundles: 1,
          openedAuctionWonderBerries: bundleSize,
          tradeableWonderBlacksPulled: pulledBlacks,
        };
      mergeInventoryBranch(kernel, processed, probability, {
        purchasedBundles: 1,
        openedWonderBerries: bundleSize,
        wonderBlacksPulled: pulledBlacks,
        wonderPetPaybacks:
          nonBlackCount * upperPetShareAmongNonBlack,
        wonderConsumables:
          nonBlackCount * consumableShareAmongNonBlack,
        ...sourceRewards,
      });
    }

    kernel.rewards.purchasedBundles = 1;
    kernel.rewards.openedWonderBerries = bundleSize;
    kernel.rewards.wonderBlacksPulled =
      bundleSize * wonderBlackProbability;
    kernel.rewards.wonderPetPaybacks =
      bundleSize * wonderUpperPetProbability;
    kernel.rewards.wonderConsumables =
      bundleSize * PET_PROBABILITIES.wonderConsumable;
    if (purchaseSource === "maple-point-bundle") {
      kernel.rewards.purchasedMaplePointBundles = 1;
      kernel.rewards.openedMaplePointWonderBerries = bundleSize;
      kernel.rewards.untradeableWonderBlacksPulled =
        bundleSize * wonderBlackProbability;
    } else {
      kernel.rewards.purchasedAuctionWonderBerryBundles = 1;
      kernel.rewards.openedAuctionWonderBerries = bundleSize;
      kernel.rewards.tradeableWonderBlacksPulled =
        bundleSize * wonderBlackProbability;
    }

    const indexedTransitions = new Map();
    const indexedTransitionRewards = new Map();
    for (const [key, probability] of kernel.transitions) {
      const index = stateIndexes.get(key);
      if (index === undefined) {
        throw new Error(`하이브리드 묶음 상태를 찾을 수 없습니다: ${key}`);
      }
      indexedTransitions.set(index, probability);
      indexedTransitionRewards.set(
        index,
        kernel.transitionRewards.get(key),
      );
    }
    kernel.transitions = indexedTransitions;
    kernel.transitionRewards = indexedTransitionRewards;
    return kernel;
  });

  return {
    targetCount,
    wonderBlackEvent,
    bundleSize,
    states,
    kernels,
    initialState: stateIndexes.get(
      hybridInventoryStateKey(0, 0, 0, false),
    ),
    procurementPolicy: "tradeable-base-on-demand",
  };
}

const PURE_BUNDLE_KERNEL_CACHE = new Map();
const HYBRID_BUNDLE_KERNEL_CACHE = new Map();
const HYBRID_UNLIMITED_SOLUTION_CACHE = new Map();

function hybridKernelCacheKey(targetCount, wonderBlackEvent, bundleSize) {
  return `${targetCount}:${getWonderBlackProbability(wonderBlackEvent)}:${bundleSize}`;
}

function getWonderBerryBundleKernel({
  targetCount,
  wonderBlackEvent,
  bundleSize,
}) {
  const key = hybridKernelCacheKey(
    targetCount,
    wonderBlackEvent,
    bundleSize,
  );
  let kernel = PURE_BUNDLE_KERNEL_CACHE.get(key);
  if (!kernel) {
    kernel = createWonderBerryBundleKernel({
      targetCount,
      wonderBlackEvent,
      bundleSize,
    });
    PURE_BUNDLE_KERNEL_CACHE.set(key, kernel);
  }
  return kernel;
}

function getHybridWonderBerryBundleKernel({
  targetCount,
  wonderBlackEvent,
  bundleSize,
}) {
  const key = hybridKernelCacheKey(
    targetCount,
    wonderBlackEvent,
    bundleSize,
  );
  let kernel = HYBRID_BUNDLE_KERNEL_CACHE.get(key);
  if (!kernel) {
    kernel = createHybridWonderBerryBundleKernel({
      targetCount,
      wonderBlackEvent,
      bundleSize,
    });
    HYBRID_BUNDLE_KERNEL_CACHE.set(key, kernel);
  }
  return kernel;
}

function finalizeHybridExpected(
  expected,
  remainingTradeableWonderBlacks,
  remainingUntradeableWonderBlacks,
  remainingLunaSweets = 0,
) {
  expected.totalSyntheses =
    expected.sweetSynthesisAttempts + expected.dreamSynthesisAttempts;
  expected.wonderBerryFailures =
    expected.openedWonderBerries - expected.wonderBlacksPulled;
  expected.remainingTradeableWonderBlacks =
    remainingTradeableWonderBlacks;
  expected.remainingUntradeableWonderBlacks =
    remainingUntradeableWonderBlacks;
  expected.remainingWonderBlacks =
    remainingTradeableWonderBlacks +
    remainingUntradeableWonderBlacks;
  expected.remainingLunaSweets = remainingLunaSweets;
  expected.purchasedAuctionBundles =
    expected.purchasedAuctionWonderBerryBundles;
  expected.petites =
    expected.directPetites + expected.dreamRoutePetites;
  return expected;
}

function hybridInventoryDistributionEntries(
  distribution,
  denominator = 1,
) {
  return [...distribution]
    .map(([key, probability]) => ({
      ...parseHybridRemainingInventoryKey(key),
      probability,
      conditionalProbability:
        denominator > 0 ? probability / denominator : 0,
    }))
    .sort(
      (left, right) =>
        left.tradeableBlacks - right.tradeableBlacks ||
        left.untradeableBlacks - right.untradeableBlacks,
    );
}

function solveLinearSystem(matrix, vector) {
  const size = matrix.length;
  const augmented = matrix.map((row, index) => [
    ...row,
    vector[index],
  ]);

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (
        Math.abs(augmented[row][column]) >
        Math.abs(augmented[pivot][column])
      ) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot][column]) < 1e-14) {
      throw new Error("원더베리 묶음 기대값 방정식을 풀 수 없습니다.");
    }
    [augmented[column], augmented[pivot]] = [
      augmented[pivot],
      augmented[column],
    ];

    const divisor = augmented[column][column];
    for (let entry = column; entry <= size; entry += 1) {
      augmented[column][entry] /= divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row][column];
      if (factor === 0) continue;
      for (let entry = column; entry <= size; entry += 1) {
        augmented[row][entry] -= factor * augmented[column][entry];
      }
    }
  }

  return augmented.map((row) => row[size]);
}

function createBundleLinearMatrix(kernel) {
  return kernel.kernels.map((stateKernel, stateIndex) => {
    const row = Array(kernel.states.length).fill(0);
    row[stateIndex] = 1;
    for (const [nextIndex, probability] of stateKernel.transitions) {
      row[nextIndex] -= probability;
    }
    return row;
  });
}

function solveBundleReward(kernel, matrix, rewardForKernel) {
  return solveLinearSystem(
    matrix,
    kernel.kernels.map(rewardForKernel),
  )[kernel.initialState];
}

function validateBundleInputs(target, bundleSize) {
  const targetCount = positiveInteger(target, "목표 마릿수");
  if (targetCount > 3) {
    throw new RangeError("목표 마릿수는 1~3마리여야 합니다.");
  }
  return {
    targetCount,
    bundleSize: positiveInteger(bundleSize, "원더베리 묶음 개수"),
  };
}

function probabilityWithinBundleKernel(kernel, bundles) {
  const count = Math.max(0, Math.trunc(Number(bundles) || 0));
  let active = Array(kernel.states.length).fill(0);
  active[kernel.initialState] = 1;
  let absorbed = 0;

  for (let bundle = 0; bundle < count; bundle += 1) {
    const next = Array(kernel.states.length).fill(0);
    for (let stateIndex = 0; stateIndex < active.length; stateIndex += 1) {
      const stateProbability = active[stateIndex];
      if (stateProbability === 0) continue;
      const stateKernel = kernel.kernels[stateIndex];
      for (const probability of stateKernel.absorbed.values()) {
        absorbed += stateProbability * probability;
      }
      for (const [nextIndex, probability] of stateKernel.transitions) {
        next[nextIndex] += stateProbability * probability;
      }
    }
    active = next;
  }

  return Math.max(0, Math.min(1, absorbed));
}

function evaluateCappedBundleKernel(kernel, maxBundles) {
  let active = Array(kernel.states.length).fill(0);
  active[kernel.initialState] = 1;
  const expected = emptyBundleRewards();
  const successfulRemainingBlacks = new Map();
  const progression = [];
  let actualChance = 0;

  for (let bundle = 0; bundle < maxBundles; bundle += 1) {
    const next = Array(kernel.states.length).fill(0);
    for (let stateIndex = 0; stateIndex < active.length; stateIndex += 1) {
      const stateProbability = active[stateIndex];
      if (stateProbability === 0) continue;
      const stateKernel = kernel.kernels[stateIndex];
      addWeightedRewards(expected, stateKernel.rewards, stateProbability);

      for (const [remainingBlacks, probability] of stateKernel.absorbed) {
        const weightedProbability = stateProbability * probability;
        actualChance += weightedProbability;
        successfulRemainingBlacks.set(
          remainingBlacks,
          (successfulRemainingBlacks.get(remainingBlacks) ?? 0) +
            weightedProbability,
        );
      }
      for (const [nextIndex, probability] of stateKernel.transitions) {
        next[nextIndex] += stateProbability * probability;
      }
    }
    active = next;
    progression.push({
      bundles: bundle + 1,
      actualChance: Math.max(0, Math.min(1, actualChance)),
      activeProbability: active.reduce((sum, value) => sum + value, 0),
    });
  }

  actualChance = Math.max(0, Math.min(1, actualChance));
  const failureProbability = Math.max(0, 1 - actualChance);
  const failedInventoryDistribution = [];
  const failedRemainingBlacks = new Map();
  let remainingWonderBlacks = 0;
  let remainingWonderBlacksOnSuccess = 0;
  let remainingWonderBlacksOnFailure = 0;
  let remainingLunaSweets = 0;

  for (const [count, probability] of successfulRemainingBlacks) {
    remainingWonderBlacks += count * probability;
    remainingWonderBlacksOnSuccess += count * probability;
  }
  for (let stateIndex = 0; stateIndex < active.length; stateIndex += 1) {
    const probability = active[stateIndex];
    if (probability === 0) continue;
    const state = kernel.states[stateIndex];
    failedInventoryDistribution.push({ ...state, probability });
    failedRemainingBlacks.set(
      state.wonderBlacks,
      (failedRemainingBlacks.get(state.wonderBlacks) ?? 0) + probability,
    );
    remainingWonderBlacks += state.wonderBlacks * probability;
    remainingWonderBlacksOnFailure += state.wonderBlacks * probability;
    if (state.pendingSweet) remainingLunaSweets += probability;
  }

  const allRemainingBlacks = new Map(successfulRemainingBlacks);
  for (const [count, probability] of failedRemainingBlacks) {
    allRemainingBlacks.set(
      count,
      (allRemainingBlacks.get(count) ?? 0) + probability,
    );
  }
  const toDistribution = (distribution, denominator = 1) =>
    [...distribution]
      .sort(([left], [right]) => left - right)
      .map(([count, probability]) => ({
        count,
        probability,
        conditionalProbability:
          denominator > 0 ? probability / denominator : 0,
      }));

  expected.totalSyntheses =
    expected.sweetSynthesisAttempts + expected.dreamSynthesisAttempts;
  expected.wonderBerryFailures =
    expected.openedWonderBerries - expected.wonderBlacksPulled;
  expected.remainingWonderBlacks = remainingWonderBlacks;
  expected.remainingWonderBlacksOnSuccess =
    remainingWonderBlacksOnSuccess;
  expected.remainingWonderBlacksOnFailure =
    remainingWonderBlacksOnFailure;
  expected.remainingLunaSweets = remainingLunaSweets;
  expected.petites =
    expected.directPetites + expected.dreamRoutePetites;

  return {
    expected,
    actualChance,
    failureProbability,
    progression,
    remainingWonderBlackDistribution: toDistribution(allRemainingBlacks),
    successfulRemainingWonderBlackDistribution: toDistribution(
      successfulRemainingBlacks,
      actualChance,
    ),
    failedRemainingWonderBlackDistribution: toDistribution(
      failedRemainingBlacks,
      failureProbability,
    ),
    failedInventoryDistribution,
  };
}

/**
 * 목표를 정확히 N번째 묶음에서 처음 달성한 경로만 남겨 누적 보상을
 * 계산한다. activeRewards[state]는 해당 상태에 도달한 경로의
 * E[cumulative reward * I(state)]이므로, 전이 보상과 함께 전파한 뒤
 * P(T=N)으로 나누면 T=N 조건부 기대값이 된다.
 */
function evaluateBundleCompletionKernel(kernel, completionBundle) {
  let active = Array(kernel.states.length).fill(0);
  active[kernel.initialState] = 1;
  let activeRewards = kernel.states.map(() => emptyBundleRewards());
  let cumulativeChance = 0;

  for (let bundle = 1; bundle <= completionBundle; bundle += 1) {
    const next = Array(kernel.states.length).fill(0);
    const nextRewards = kernel.states.map(() => emptyBundleRewards());
    const completionRewards = emptyBundleRewards();
    const remainingBlacks = new Map();
    let completionProbability = 0;

    for (let stateIndex = 0; stateIndex < active.length; stateIndex += 1) {
      const stateProbability = active[stateIndex];
      if (stateProbability === 0) continue;
      const accumulatedRewards = activeRewards[stateIndex];
      const stateKernel = kernel.kernels[stateIndex];

      for (const [count, probability] of stateKernel.absorbed) {
        const jointProbability = stateProbability * probability;
        completionProbability += jointProbability;
        remainingBlacks.set(
          count,
          (remainingBlacks.get(count) ?? 0) + jointProbability,
        );
        const outcomeRewards = stateKernel.absorbedRewards.get(count);
        for (const reward of BUNDLE_REWARD_KEYS) {
          completionRewards[reward] +=
            accumulatedRewards[reward] * probability +
            stateProbability * (outcomeRewards?.[reward] ?? 0);
        }
      }

      for (const [nextIndex, probability] of stateKernel.transitions) {
        next[nextIndex] += stateProbability * probability;
        const outcomeRewards =
          stateKernel.transitionRewards.get(nextIndex);
        for (const reward of BUNDLE_REWARD_KEYS) {
          nextRewards[nextIndex][reward] +=
            accumulatedRewards[reward] * probability +
            stateProbability * (outcomeRewards?.[reward] ?? 0);
        }
      }
    }

    const cumulativeChanceBefore = cumulativeChance;
    cumulativeChance = Math.max(
      0,
      Math.min(1, cumulativeChance + completionProbability),
    );
    if (bundle === completionBundle) {
      if (!(completionProbability > 0)) {
        throw new RangeError(
          "해당 묶음에서 목표를 처음 달성할 확률을 계산할 수 없습니다.",
        );
      }
      const expected = Object.fromEntries(
        BUNDLE_REWARD_KEYS.map((reward) => [
          reward,
          completionRewards[reward] / completionProbability,
        ]),
      );
      const remainingWonderBlackDistribution = [...remainingBlacks]
        .sort(([left], [right]) => left - right)
        .map(([count, jointProbability]) => ({
          count,
          probability: jointProbability / completionProbability,
        }));
      expected.purchasedBundles = completionBundle;
      expected.openedWonderBerries =
        completionBundle * kernel.bundleSize;
      expected.totalSyntheses =
        expected.sweetSynthesisAttempts +
        expected.dreamSynthesisAttempts;
      expected.wonderBerryFailures =
        expected.openedWonderBerries - expected.wonderBlacksPulled;
      expected.remainingWonderBlacks =
        remainingWonderBlackDistribution.reduce(
          (sum, entry) => sum + entry.count * entry.probability,
          0,
        );
      expected.remainingLunaSweets = 0;
      expected.petites =
        expected.directPetites + expected.dreamRoutePetites;

      return {
        completionBundle,
        completionProbability,
        cumulativeChanceBefore,
        cumulativeChance,
        survivalProbabilityBefore: Math.max(
          0,
          1 - cumulativeChanceBefore,
        ),
        expected,
        remainingWonderBlackDistribution,
        completionRemainingWonderBlackDistribution: [...remainingBlacks]
          .sort(([left], [right]) => left - right)
          .map(([count, jointProbability]) => ({
            count,
            probability: jointProbability,
            conditionalProbability:
              jointProbability / completionProbability,
          })),
      };
    }

    active = next;
    activeRewards = nextRewards;
  }

  throw new Error("묶음 완료 조건부 기대값을 계산하지 못했습니다.");
}

function evaluateHybridCappedBundleKernel(kernel, maxBundles) {
  let active = Array(kernel.states.length).fill(0);
  active[kernel.initialState] = 1;
  const expected = emptyBundleRewards();
  const successfulInventories = new Map();
  const progression = [];
  let actualChance = 0;

  for (let bundle = 0; bundle < maxBundles; bundle += 1) {
    const next = Array(kernel.states.length).fill(0);
    for (let stateIndex = 0; stateIndex < active.length; stateIndex += 1) {
      const stateProbability = active[stateIndex];
      if (stateProbability === 0) continue;
      const stateKernel = kernel.kernels[stateIndex];
      addWeightedRewards(expected, stateKernel.rewards, stateProbability);
      for (const [inventoryKey, probability] of stateKernel.absorbed) {
        const weightedProbability = stateProbability * probability;
        actualChance += weightedProbability;
        successfulInventories.set(
          inventoryKey,
          (successfulInventories.get(inventoryKey) ?? 0) +
            weightedProbability,
        );
      }
      for (const [nextIndex, probability] of stateKernel.transitions) {
        next[nextIndex] += stateProbability * probability;
      }
    }
    active = next;
    progression.push({
      bundles: bundle + 1,
      purchaseUnits: bundle + 1,
      actualChance: Math.max(0, Math.min(1, actualChance)),
      activeProbability: active.reduce((sum, value) => sum + value, 0),
    });
  }

  actualChance = Math.max(0, Math.min(1, actualChance));
  const failureProbability = Math.max(0, 1 - actualChance);
  const failedInventories = new Map();
  const failedInventoryDistribution = [];
  let remainingTradeableWonderBlacks = 0;
  let remainingUntradeableWonderBlacks = 0;
  let remainingLunaSweets = 0;

  for (const [key, probability] of successfulInventories) {
    const inventory = parseHybridRemainingInventoryKey(key);
    remainingTradeableWonderBlacks +=
      inventory.tradeableBlacks * probability;
    remainingUntradeableWonderBlacks +=
      inventory.untradeableBlacks * probability;
  }
  for (let stateIndex = 0; stateIndex < active.length; stateIndex += 1) {
    const probability = active[stateIndex];
    if (probability === 0) continue;
    const state = kernel.states[stateIndex];
    const inventoryKey = hybridRemainingInventoryKey(
      state.tradeableBlacks,
      state.untradeableBlacks,
    );
    failedInventories.set(
      inventoryKey,
      (failedInventories.get(inventoryKey) ?? 0) + probability,
    );
    failedInventoryDistribution.push({ ...state, probability });
    remainingTradeableWonderBlacks +=
      state.tradeableBlacks * probability;
    remainingUntradeableWonderBlacks +=
      state.untradeableBlacks * probability;
    if (state.pendingSweet) remainingLunaSweets += probability;
  }
  const allInventories = new Map(successfulInventories);
  for (const [key, probability] of failedInventories) {
    allInventories.set(
      key,
      (allInventories.get(key) ?? 0) + probability,
    );
  }

  finalizeHybridExpected(
    expected,
    remainingTradeableWonderBlacks,
    remainingUntradeableWonderBlacks,
    remainingLunaSweets,
  );

  return {
    expected,
    actualChance,
    failureProbability,
    progression,
    remainingHybridInventoryDistribution:
      hybridInventoryDistributionEntries(allInventories),
    successfulRemainingHybridInventoryDistribution:
      hybridInventoryDistributionEntries(
        successfulInventories,
        actualChance,
      ),
    failedRemainingHybridInventoryDistribution:
      hybridInventoryDistributionEntries(
        failedInventories,
        failureProbability,
      ),
    failedInventoryDistribution,
  };
}

function evaluateHybridBundleCompletionKernel(
  kernel,
  completionBundle,
) {
  let active = Array(kernel.states.length).fill(0);
  active[kernel.initialState] = 1;
  let activeRewards = kernel.states.map(() => emptyBundleRewards());
  let cumulativeChance = 0;

  for (let bundle = 1; bundle <= completionBundle; bundle += 1) {
    const next = Array(kernel.states.length).fill(0);
    const nextRewards = kernel.states.map(() => emptyBundleRewards());
    const completionRewards = emptyBundleRewards();
    const remainingInventories = new Map();
    let completionProbability = 0;

    for (let stateIndex = 0; stateIndex < active.length; stateIndex += 1) {
      const stateProbability = active[stateIndex];
      if (stateProbability === 0) continue;
      const accumulatedRewards = activeRewards[stateIndex];
      const stateKernel = kernel.kernels[stateIndex];

      for (const [inventoryKey, probability] of stateKernel.absorbed) {
        const jointProbability = stateProbability * probability;
        completionProbability += jointProbability;
        remainingInventories.set(
          inventoryKey,
          (remainingInventories.get(inventoryKey) ?? 0) +
            jointProbability,
        );
        const outcomeRewards =
          stateKernel.absorbedRewards.get(inventoryKey);
        for (const reward of BUNDLE_REWARD_KEYS) {
          completionRewards[reward] +=
            accumulatedRewards[reward] * probability +
            stateProbability * (outcomeRewards?.[reward] ?? 0);
        }
      }

      for (const [nextIndex, probability] of stateKernel.transitions) {
        next[nextIndex] += stateProbability * probability;
        const outcomeRewards =
          stateKernel.transitionRewards.get(nextIndex);
        for (const reward of BUNDLE_REWARD_KEYS) {
          nextRewards[nextIndex][reward] +=
            accumulatedRewards[reward] * probability +
            stateProbability * (outcomeRewards?.[reward] ?? 0);
        }
      }
    }

    const cumulativeChanceBefore = cumulativeChance;
    cumulativeChance = Math.max(
      0,
      Math.min(1, cumulativeChance + completionProbability),
    );
    if (bundle === completionBundle) {
      if (!(completionProbability > 0)) {
        throw new RangeError(
          "해당 묶음에서 하이브리드 목표를 처음 달성할 확률을 계산할 수 없습니다.",
        );
      }
      const expected = Object.fromEntries(
        BUNDLE_REWARD_KEYS.map((reward) => [
          reward,
          completionRewards[reward] / completionProbability,
        ]),
      );
      const distribution = hybridInventoryDistributionEntries(
        new Map(
          [...remainingInventories].map(([key, probability]) => [
            key,
            probability / completionProbability,
          ]),
        ),
      );
      const remainingTradeableWonderBlacks = distribution.reduce(
        (sum, entry) =>
          sum + entry.tradeableBlacks * entry.probability,
        0,
      );
      const remainingUntradeableWonderBlacks = distribution.reduce(
        (sum, entry) =>
          sum + entry.untradeableBlacks * entry.probability,
        0,
      );
      finalizeHybridExpected(
        expected,
        remainingTradeableWonderBlacks,
        remainingUntradeableWonderBlacks,
        0,
      );
      return {
        completionBundle,
        completionProbability,
        cumulativeChanceBefore,
        cumulativeChance,
        survivalProbabilityBefore: Math.max(
          0,
          1 - cumulativeChanceBefore,
        ),
        expected,
        remainingHybridInventoryDistribution: distribution,
        completionRemainingHybridInventoryDistribution:
          hybridInventoryDistributionEntries(remainingInventories).map(
            (entry) => ({
              ...entry,
              conditionalProbability:
                entry.probability / completionProbability,
            }),
          ),
      };
    }

    active = next;
    activeRewards = nextRewards;
  }
  throw new Error("하이브리드 묶음 완료 조건부 기대값을 계산하지 못했습니다.");
}

const COMPILED_BUNDLE_KERNEL_CACHE = new WeakMap();
const PURE_COMPLETION_EVALUATION_CACHE = new WeakMap();
const HYBRID_COMPLETION_EVALUATION_CACHE = new WeakMap();
const COMPLETION_CACHE_LIMIT_PER_KERNEL = 64;

function rewardVector(rewards) {
  return Float64Array.from(
    BUNDLE_REWARD_KEYS,
    (reward) => rewards?.[reward] ?? 0,
  );
}

/**
 * 반복 평가에서 Map 조회와 문자열 reward 조회를 없애기 위한 내부 뷰.
 * 커널은 생성 후 불변으로 취급하며, WeakMap 키라 커널이 해제되면 함께
 * 정리된다.
 */
function getCompiledBundleKernel(kernel) {
  let compiled = COMPILED_BUNDLE_KERNEL_CACHE.get(kernel);
  if (compiled) return compiled;

  compiled = kernel.kernels.map((stateKernel) => {
    const transitions = [...stateKernel.transitions].map(
      ([nextIndex, probability]) => ({
        nextIndex,
        probability,
        rewards: rewardVector(
          stateKernel.transitionRewards.get(nextIndex),
        ),
      }),
    );
    const absorbed = [...stateKernel.absorbed].map(
      ([outcome, probability]) => ({
        outcome,
        probability,
        rewards: rewardVector(
          stateKernel.absorbedRewards.get(outcome),
        ),
      }),
    );
    const absorbedRewards = new Float64Array(
      BUNDLE_REWARD_KEYS.length,
    );
    let absorbedProbability = 0;
    for (const outcome of absorbed) {
      absorbedProbability += outcome.probability;
      for (
        let rewardIndex = 0;
        rewardIndex < absorbedRewards.length;
        rewardIndex += 1
      ) {
        absorbedRewards[rewardIndex] += outcome.rewards[rewardIndex];
      }
    }
    return {
      transitions,
      absorbed,
      absorbedProbability,
      absorbedRewards,
    };
  });
  COMPILED_BUNDLE_KERNEL_CACHE.set(kernel, compiled);
  return compiled;
}

/**
 * T=K 결합 보상은 뒤에서 앞으로 계산한다.
 *
 * h_i(n) = state i에서 정확히 n묶음 뒤 처음 성공할 확률,
 * v_i(n) = E[(n묶음 누적 보상) * I(T=n) | state i]
 *
 * Map/object 기반 누적 보상을 매 단계 복제하던 기존 구현과 같은
 * 점화식을 평탄한 Float64Array로 계산한다.
 */
function evaluateBundleCompletionMoments(kernel, completionBundle) {
  const compiled = getCompiledBundleKernel(kernel);
  const stateCount = compiled.length;
  const rewardCount = BUNDLE_REWARD_KEYS.length;
  let exactProbabilityByState = new Float64Array(stateCount);
  let rewardMomentsByState = new Float64Array(
    stateCount * rewardCount,
  );

  for (let stateIndex = 0; stateIndex < stateCount; stateIndex += 1) {
    const state = compiled[stateIndex];
    exactProbabilityByState[stateIndex] = state.absorbedProbability;
    rewardMomentsByState.set(
      state.absorbedRewards,
      stateIndex * rewardCount,
    );
  }

  for (let remaining = 2; remaining <= completionBundle; remaining += 1) {
    const nextProbabilities = new Float64Array(stateCount);
    const nextRewardMoments = new Float64Array(
      stateCount * rewardCount,
    );
    for (
      let stateIndex = 0;
      stateIndex < stateCount;
      stateIndex += 1
    ) {
      const destinationOffset = stateIndex * rewardCount;
      for (const transition of compiled[stateIndex].transitions) {
        const nextStateIndex = transition.nextIndex;
        const futureProbability =
          exactProbabilityByState[nextStateIndex];
        const sourceOffset = nextStateIndex * rewardCount;
        nextProbabilities[stateIndex] +=
          transition.probability * futureProbability;
        for (
          let rewardIndex = 0;
          rewardIndex < rewardCount;
          rewardIndex += 1
        ) {
          nextRewardMoments[destinationOffset + rewardIndex] +=
            transition.rewards[rewardIndex] * futureProbability +
            transition.probability *
              rewardMomentsByState[sourceOffset + rewardIndex];
        }
      }
    }
    exactProbabilityByState = nextProbabilities;
    rewardMomentsByState = nextRewardMoments;
  }

  // K-1묶음 뒤 생존 상태만 전파하면 직전 CDF와 K번째 종료 재고를
  // 보상 벡터와 별개로 저렴하게 얻을 수 있다.
  let active = new Float64Array(stateCount);
  active[kernel.initialState] = 1;
  for (let bundle = 1; bundle < completionBundle; bundle += 1) {
    const next = new Float64Array(stateCount);
    for (
      let stateIndex = 0;
      stateIndex < stateCount;
      stateIndex += 1
    ) {
      const stateProbability = active[stateIndex];
      if (stateProbability === 0) continue;
      for (const transition of compiled[stateIndex].transitions) {
        next[transition.nextIndex] +=
          stateProbability * transition.probability;
      }
    }
    active = next;
  }

  const remainingOutcomes = new Map();
  let completionProbability = 0;
  let survivalProbabilityBefore = 0;
  for (let stateIndex = 0; stateIndex < stateCount; stateIndex += 1) {
    const stateProbability = active[stateIndex];
    survivalProbabilityBefore += stateProbability;
    if (stateProbability === 0) continue;
    for (const outcome of compiled[stateIndex].absorbed) {
      const jointProbability = stateProbability * outcome.probability;
      completionProbability += jointProbability;
      remainingOutcomes.set(
        outcome.outcome,
        (remainingOutcomes.get(outcome.outcome) ?? 0) +
          jointProbability,
      );
    }
  }
  if (!(completionProbability > 0)) {
    throw new RangeError(
      "해당 묶음에서 목표를 처음 달성할 확률을 계산할 수 없습니다.",
    );
  }

  const momentProbability =
    exactProbabilityByState[kernel.initialState];
  const initialOffset = kernel.initialState * rewardCount;
  const expected = Object.fromEntries(
    BUNDLE_REWARD_KEYS.map((reward, rewardIndex) => [
      reward,
      rewardMomentsByState[initialOffset + rewardIndex] /
        momentProbability,
    ]),
  );
  const cumulativeChanceBefore = Math.max(
    0,
    Math.min(1, 1 - survivalProbabilityBefore),
  );
  const cumulativeChance = Math.max(
    0,
    Math.min(1, cumulativeChanceBefore + completionProbability),
  );
  return {
    completionProbability,
    cumulativeChanceBefore,
    cumulativeChance,
    survivalProbabilityBefore,
    expected,
    remainingOutcomes,
  };
}

function cloneCompletionEvaluation(evaluation) {
  const clone = {
    ...evaluation,
    expected: { ...evaluation.expected },
  };
  for (const key of [
    "remainingWonderBlackDistribution",
    "completionRemainingWonderBlackDistribution",
    "remainingHybridInventoryDistribution",
    "completionRemainingHybridInventoryDistribution",
  ]) {
    if (Array.isArray(evaluation[key])) {
      clone[key] = evaluation[key].map((entry) => ({ ...entry }));
    }
  }
  return clone;
}

function cachedCompletionEvaluation(
  cache,
  kernel,
  completionBundle,
  calculate,
) {
  let evaluations = cache.get(kernel);
  if (!evaluations) {
    evaluations = new Map();
    cache.set(kernel, evaluations);
  }
  if (evaluations.has(completionBundle)) {
    const cached = evaluations.get(completionBundle);
    // Map 삽입 순서를 LRU로 사용한다.
    evaluations.delete(completionBundle);
    evaluations.set(completionBundle, cached);
    return cloneCompletionEvaluation(cached);
  }

  const evaluation = calculate();
  evaluations.set(completionBundle, evaluation);
  if (evaluations.size > COMPLETION_CACHE_LIMIT_PER_KERNEL) {
    evaluations.delete(evaluations.keys().next().value);
  }
  return cloneCompletionEvaluation(evaluation);
}

function calculateFastBundleCompletionEvaluation(
  kernel,
  completionBundle,
) {
  const moments = evaluateBundleCompletionMoments(
    kernel,
    completionBundle,
  );
  const remainingWonderBlackDistribution = [
    ...moments.remainingOutcomes,
  ]
    .sort(([left], [right]) => left - right)
    .map(([count, jointProbability]) => ({
      count,
      probability:
        jointProbability / moments.completionProbability,
    }));
  const expected = moments.expected;
  expected.purchasedBundles = completionBundle;
  expected.openedWonderBerries = completionBundle * kernel.bundleSize;
  expected.totalSyntheses =
    expected.sweetSynthesisAttempts + expected.dreamSynthesisAttempts;
  expected.wonderBerryFailures =
    expected.openedWonderBerries - expected.wonderBlacksPulled;
  expected.remainingWonderBlacks =
    remainingWonderBlackDistribution.reduce(
      (sum, entry) => sum + entry.count * entry.probability,
      0,
    );
  expected.remainingLunaSweets = 0;
  expected.petites =
    expected.directPetites + expected.dreamRoutePetites;

  return {
    completionBundle,
    completionProbability: moments.completionProbability,
    cumulativeChanceBefore: moments.cumulativeChanceBefore,
    cumulativeChance: moments.cumulativeChance,
    survivalProbabilityBefore: moments.survivalProbabilityBefore,
    expected,
    remainingWonderBlackDistribution,
    completionRemainingWonderBlackDistribution: [
      ...moments.remainingOutcomes,
    ]
      .sort(([left], [right]) => left - right)
      .map(([count, jointProbability]) => ({
        count,
        probability: jointProbability,
        conditionalProbability:
          jointProbability / moments.completionProbability,
      })),
  };
}

function calculateFastHybridCompletionEvaluation(
  kernel,
  completionBundle,
) {
  const moments = evaluateBundleCompletionMoments(
    kernel,
    completionBundle,
  );
  const conditionalInventory = new Map(
    [...moments.remainingOutcomes].map(([key, probability]) => [
      key,
      probability / moments.completionProbability,
    ]),
  );
  const distribution = hybridInventoryDistributionEntries(
    conditionalInventory,
  );
  const expected = moments.expected;
  finalizeHybridExpected(
    expected,
    distribution.reduce(
      (sum, entry) =>
        sum + entry.tradeableBlacks * entry.probability,
      0,
    ),
    distribution.reduce(
      (sum, entry) =>
        sum + entry.untradeableBlacks * entry.probability,
      0,
    ),
    0,
  );
  return {
    completionBundle,
    completionProbability: moments.completionProbability,
    cumulativeChanceBefore: moments.cumulativeChanceBefore,
    cumulativeChance: moments.cumulativeChance,
    survivalProbabilityBefore: moments.survivalProbabilityBefore,
    expected,
    remainingHybridInventoryDistribution: distribution,
    completionRemainingHybridInventoryDistribution:
      hybridInventoryDistributionEntries(
        moments.remainingOutcomes,
      ).map((entry) => ({
        ...entry,
        conditionalProbability:
          entry.probability / moments.completionProbability,
      })),
  };
}

function evaluateCachedBundleCompletionKernel(
  kernel,
  completionBundle,
) {
  return cachedCompletionEvaluation(
    PURE_COMPLETION_EVALUATION_CACHE,
    kernel,
    completionBundle,
    () => calculateFastBundleCompletionEvaluation(
      kernel,
      completionBundle,
    ),
  );
}

function evaluateCachedHybridBundleCompletionKernel(
  kernel,
  completionBundle,
) {
  return cachedCompletionEvaluation(
    HYBRID_COMPLETION_EVALUATION_CACHE,
    kernel,
    completionBundle,
    () => calculateFastHybridCompletionEvaluation(
      kernel,
      completionBundle,
    ),
  );
}

function bundleCountForTargetChance(kernel, wanted) {
  let active = Array(kernel.states.length).fill(0);
  active[kernel.initialState] = 1;
  let absorbed = 0;

  for (let bundles = 1; bundles <= 100_000; bundles += 1) {
    const next = Array(kernel.states.length).fill(0);
    for (let stateIndex = 0; stateIndex < active.length; stateIndex += 1) {
      const stateProbability = active[stateIndex];
      if (stateProbability === 0) continue;
      const stateKernel = kernel.kernels[stateIndex];
      for (const probability of stateKernel.absorbed.values()) {
        absorbed += stateProbability * probability;
      }
      for (const [nextIndex, probability] of stateKernel.transitions) {
        next[nextIndex] += stateProbability * probability;
      }
    }
    if (absorbed >= wanted) return bundles;
    active = next;
  }
  return Infinity;
}

/** 원더베리 묶음을 n개 전부 개봉했을 때 target마리 이상 얻을 확률. */
export function probabilityOfTargetWithinBundles(
  bundles,
  target,
  event = false,
  bundleSize = 11,
) {
  const validated = validateBundleInputs(target, bundleSize);
  const kernel = getWonderBerryBundleKernel({
    ...validated,
    wonderBlackEvent: event,
  });
  return probabilityWithinBundleKernel(kernel, bundles);
}

/** 목표 확률에 처음 도달하는 원더베리 묶음 구매 수. */
export function bundlesForTargetChance(
  target,
  chance,
  event = false,
  bundleSize = 11,
) {
  const validated = validateBundleInputs(target, bundleSize);
  const wanted = Number(chance);
  if (!(wanted > 0 && wanted < 1)) {
    throw new RangeError("목표 확률은 0보다 크고 1보다 작아야 합니다.");
  }
  const kernel = getWonderBerryBundleKernel({
    ...validated,
    wonderBlackEvent: event,
  });
  return bundleCountForTargetChance(kernel, wanted);
}

/** 개별 원더베리 n개를 순서대로 사용했을 때의 누적 목표 확률. */
export function probabilityOfTargetWithinWonderBerries(
  wonderBerries,
  target,
  event = false,
) {
  return probabilityOfTargetWithinBundles(
    wonderBerries,
    target,
    event,
    1,
  );
}

/** 목표 확률에 처음 도달하는 개별 원더베리 개수. */
export function wonderBerriesForTargetChance(
  target,
  chance,
  event = false,
) {
  return bundlesForTargetChance(target, chance, event, 1);
}

/**
 * 목표 확률 당첨선의 개별 원더베리 수 N과, N개를 확보하는 캐시샵
 * 메포 묶음/경매장 메소 묶음 최저가 계획을 함께 계산한다. N을 넘겨
 * 받은 원더베리는 열지 않고 보존하므로 성공 확률은 N개 사용 기준이다.
 * 합성 부산물 회수와 교환 가능 여부는 포함하지 않는 준비 비용이다.
 */
export function calculateWonderBerryTargetProcurement(options = {}) {
  const targetCount = positiveInteger(
    options.targetCount ?? 1,
    "목표 마릿수",
  );
  if (targetCount > 3) {
    throw new RangeError("목표 마릿수는 1~3마리여야 합니다.");
  }
  const requestedChance = Number(options.targetChance ?? options.chance);
  if (!(requestedChance > 0 && requestedChance < 1)) {
    throw new RangeError("목표 확률은 0보다 크고 1보다 작아야 합니다.");
  }
  const wonderBlackEvent = resolveWonderBlackEvent(options);
  const requiredWonderBerries = wonderBerriesForTargetChance(
    targetCount,
    requestedChance,
    wonderBlackEvent,
  );
  const actualChance = probabilityOfTargetWithinWonderBerries(
    requiredWonderBerries,
    targetCount,
    wonderBlackEvent,
  );
  const previousChance = probabilityOfTargetWithinWonderBerries(
    requiredWonderBerries - 1,
    targetCount,
    wonderBlackEvent,
  );
  const procurement = optimizeWonderBerryProcurement({
    ...options,
    requiredWonderBerries,
  });

  return {
    scope: "wonderberry-target-procurement",
    costScope: "gross-procurement-only",
    targetCount,
    wonderBlackEvent,
    requestedChance,
    actualChance,
    previousChance,
    requiredWonderBerries,
    requiredPurchaseBundles: procurement.plan.purchasedBundles,
    purchaseUnits: procurement.plan.purchasedBundles,
    purchaseUnitLabel: "묶음",
    purchaseUnitSize: procurement.wonderBerryBundleSize,
    suppliedWonderBerries:
      procurement.plan.suppliedWonderBerries,
    unopenedWonderBerries:
      procurement.plan.excessWonderBerries,
    selectedProcurement: procurement.selectedProcurement,
    plan: procurement.plan,
    procurement,
    costs: {
      berryMaplePoints: procurement.plan.bundleMaplePoints,
      wonderBerryAuctionBundleMeso:
        procurement.plan.auctionBundleMeso,
      berryProcurementMesoEquivalent:
        procurement.plan.totalMesoEquivalent,
      conversionToMeso: procurement.currency.conversionToMeso,
      costConversionBasis:
        procurement.currency.costConversionBasis,
    },
    probabilities: {
      requested: requestedChance,
      actual: actualChance,
      previous: previousChance,
    },
  };
}

/**
 * 목표확률 q에 처음 도달하는 11개 묶음 수 N을 경로별로 찾고,
 * 정확히 N번째 묶음에서 목표를 얻는 이용자(T=N)의 조건부 누적
 * 보상과 비용을 계산한다. 순수 MP·순수 경매장·하이브리드 모두
 * 같은 전량 개봉 묶음 경계 CDF로 비교한다.
 */
export function calculateWonderBerryPercentileCompletionExpectation(
  options = {},
) {
  const targetCount = positiveInteger(
    options.targetCount ?? 1,
    "목표 마릿수",
  );
  if (targetCount > 3) {
    throw new RangeError("목표 마릿수는 1~3마리여야 합니다.");
  }
  const requestedChance = Number(options.targetChance ?? options.chance);
  if (!(requestedChance > 0 && requestedChance < 1)) {
    throw new RangeError("목표 확률은 0보다 크고 1보다 작아야 합니다.");
  }
  const wonderBlackEvent = resolveWonderBlackEvent(options);
  const bundleSize = positiveInteger(
    options.wonderBerryBundleSize ?? 11,
    "원더베리 묶음 개수",
  );
  const wonderBerryAuctionBundleMesoPrice = finiteNonNegative(
    options.wonderBerryAuctionBundleMesoPrice ?? 0,
    "원더베리 11개 묶음 경매장 시세",
  );
  const tradeableOutputRequired =
    options.tradeableOutputRequired === true;
  if (
    tradeableOutputRequired &&
    !(wonderBerryAuctionBundleMesoPrice > 0)
  ) {
    throw new RangeError(
      "교환 가능한 합성 결과를 계산하려면 원더베리 11개 묶음 경매장 시세가 필요합니다.",
    );
  }
  const procurementMode = resolveWonderBerryProcurementMode(
    options,
    wonderBerryAuctionBundleMesoPrice,
  );
  const template = calculateWonderBerryBundleExpectation({
    ...options,
    targetCount,
    wonderBlackEvent,
    wonderBerryBundleSize: bundleSize,
    wonderBerryProcurementMode: "maple-point-bundle",
    // 아래 template은 가격·환율 기본값만 공유한다. 실제 선택 제약은
    // 세 후보를 만든 뒤 적용하므로 내부 MP reference 생성을 허용한다.
    tradeableOutputRequired: false,
  });
  const kernel = getWonderBerryBundleKernel({
    targetCount,
    wonderBlackEvent,
    bundleSize,
  });
  const pureCompletionBundle = bundleCountForTargetChance(
    kernel,
    requestedChance,
  );
  const evaluation = evaluateCachedBundleCompletionKernel(
    kernel,
    pureCompletionBundle,
  );
  const actualChance = evaluation.cumulativeChance;
  const previousChance = evaluation.cumulativeChanceBefore;
  const wonderBlackMesoPrice = finiteNonNegative(
    options.wonderBlackMesoPrice ?? 0,
    "원더 블랙 시세",
  );
  const lunaDreamAuctionMesoPrice = finiteNonNegative(
    options.lunaDreamAuctionMesoPrice ??
      options.lunaDreamMesoRecovery ??
      0,
    "루나 드림 경매장 시세",
  );
  const lunaSweetAuctionMesoPrice = finiteNonNegative(
    options.lunaSweetAuctionMesoPrice ?? 0,
    "루나 스윗 경매장 시세",
  );
  const lunaKeyAuctionMesoPrice = finiteNonNegative(
    options.lunaKeyAuctionMesoPrice ??
      options.lunaKeyMesoRecovery ??
      0,
    "루나 크리스탈 키 경매장 시세",
  );

  const makeCandidate = (wonderBerryProcurementMode) => {
    const selectedProcurement = wonderBerryProcurementMode;
    const strategy = buildWonderBerryStrategy({
      selectedProcurement,
      targetCount,
      wonderBlackEvent,
      purchaseUnitSize: bundleSize,
      purchaseUnitLabel: "묶음",
      maplePointBundleSize: bundleSize,
      rawExpected: evaluation.expected,
      remainingWonderBlackDistribution:
        evaluation.remainingWonderBlackDistribution,
      wonderBerryBundleMaplePoints:
        template.costs.wonderBerryBundleMaplePoints,
      wonderBerryAuctionBundleMesoPrice,
      lunaCrystalMaplePoints:
        template.costs.lunaCrystalMaplePoints,
      wonderBlackMesoPrice,
      lunaDreamAuctionMesoPrice,
      lunaSweetAuctionMesoPrice,
      lunaKeyAuctionMesoPrice,
      auctionFeeRate: template.recovery.auctionFeeRate,
      currency: template.currency,
    });
    const purchasedBundles = pureCompletionBundle;
    const plan = {
      purchasedBundles,
      maplePointBundles:
        selectedProcurement === "maple-point-bundle"
          ? purchasedBundles
          : 0,
      auctionBundles:
        selectedProcurement === "auction-bundle"
          ? purchasedBundles
          : 0,
      suppliedWonderBerries: purchasedBundles * bundleSize,
      excessWonderBerries: 0,
      bundleMaplePoints: strategy.costs.berryMaplePoints,
      auctionBundleMeso:
        strategy.costs.wonderBerryAuctionBundleMeso,
      totalMesoEquivalent:
        strategy.costs.berryProcurementMesoEquivalent,
    };
    const wonderBerryProcurement = {
      ...strategy.procurement,
      mode: wonderBerryProcurementMode,
      tradeableOutputRequired,
      selectionConstraint: tradeableOutputRequired
        ? "tradeable-output-only"
        : "none",
      plan,
    };
    const completion = {
      ...template,
      scope: "wonderberry-completion-bundle",
      tradeableOutputRequired,
      selectedProcurement: strategy.selectedProcurement,
      completionBundle: purchasedBundles,
      completionPurchaseUnit: purchasedBundles,
      completionWonderBerry: null,
      completionUnitKind: "bundle",
      purchaseUnitLabel: "묶음",
      purchaseUnitSize: bundleSize,
      completionProbability: evaluation.completionProbability,
      cumulativeChanceBefore: evaluation.cumulativeChanceBefore,
      cumulativeChance: evaluation.cumulativeChance,
      survivalProbabilityBefore: evaluation.survivalProbabilityBefore,
      policy: {
        ...strategy.policy,
        condition: "completion-at-bundle",
        openEntireBundle: true,
        openEntirePurchaseUnit: true,
        preserveUnopenedWonderBerries: false,
        completionBundle: purchasedBundles,
        completionPurchaseUnit: purchasedBundles,
        completionWonderBerry: null,
        completionUnitKind: "bundle",
        tradeableOutputRequired,
      },
      probabilities: {
        ...template.probabilities,
        completionAtBundle: evaluation.completionProbability,
        cumulativeBeforeBundle: evaluation.cumulativeChanceBefore,
        cumulativeAtBundle: evaluation.cumulativeChance,
        survivalBeforeBundle: evaluation.survivalProbabilityBefore,
      },
      expected: strategy.expected,
      remainingWonderBlackDistribution:
        evaluation.remainingWonderBlackDistribution,
      completionRemainingWonderBlackDistribution:
        evaluation.completionRemainingWonderBlackDistribution,
      costs: strategy.costs,
      recovery: strategy.recovery,
      procurement: wonderBerryProcurement,
      wonderBerryProcurement,
      completion: {
        bundle: purchasedBundles,
        purchaseUnit: purchasedBundles,
        wonderBerries: null,
        unitKind: "bundle",
        purchaseUnitLabel: "묶음",
        purchaseUnitSize: bundleSize,
        probability: evaluation.completionProbability,
        cumulativeChanceBefore: evaluation.cumulativeChanceBefore,
        cumulativeChance: evaluation.cumulativeChance,
        survivalProbabilityBefore:
          evaluation.survivalProbabilityBefore,
      },
    };
    return {
      selectedProcurement: strategy.selectedProcurement,
      eligibleForSelection:
        !tradeableOutputRequired ||
        strategy.selectedProcurement !== "maple-point-bundle",
      purchaseUnits: purchasedBundles,
      purchaseUnitLabel: "묶음",
      purchaseUnitSize: bundleSize,
      purchaseUnitMeaning: "purchased-wonderberry-bundles",
      completionUnitKind: "bundle",
      requiredWonderBerries: null,
      requiredPurchaseBundles: purchasedBundles,
      suppliedWonderBerries: purchasedBundles * bundleSize,
      unopenedWonderBerries: 0,
      actualChance,
      previousChance,
      netMesoEquivalentAfterRemainingBlackSale:
        completion.costs.netMesoEquivalentAfterRemainingBlackSale,
      plan,
      procurement: wonderBerryProcurement,
      completion,
    };
  };
  const makeHybridCandidate = () => {
    const hybridKernel = getHybridWonderBerryBundleKernel({
      targetCount,
      wonderBlackEvent,
      bundleSize,
    });
    const completionBundle = bundleCountForTargetChance(
      hybridKernel,
      requestedChance,
    );
    const hybridEvaluation = evaluateCachedHybridBundleCompletionKernel(
      hybridKernel,
      completionBundle,
    );
    const strategy = buildHybridWonderBerryStrategy({
      targetCount,
      wonderBlackEvent,
      purchaseUnitSize: bundleSize,
      rawExpected: hybridEvaluation.expected,
      remainingHybridInventoryDistribution:
        hybridEvaluation.remainingHybridInventoryDistribution,
      wonderBerryBundleMaplePoints:
        template.costs.wonderBerryBundleMaplePoints,
      wonderBerryAuctionBundleMesoPrice,
      lunaCrystalMaplePoints:
        template.costs.lunaCrystalMaplePoints,
      wonderBlackMesoPrice,
      lunaDreamAuctionMesoPrice,
      lunaSweetAuctionMesoPrice,
      lunaKeyAuctionMesoPrice,
      auctionFeeRate: template.recovery.auctionFeeRate,
      currency: template.currency,
    });
    const plan = {
      purchasedBundles: completionBundle,
      maplePointBundles:
        strategy.expected.purchasedMaplePointBundles,
      auctionBundles:
        strategy.expected.purchasedAuctionWonderBerryBundles,
      suppliedWonderBerries: completionBundle * bundleSize,
      excessWonderBerries: 0,
      bundleMaplePoints: strategy.costs.berryMaplePoints,
      auctionBundleMeso:
        strategy.costs.wonderBerryAuctionBundleMeso,
      totalMesoEquivalent:
        strategy.costs.berryProcurementMesoEquivalent,
    };
    const wonderBerryProcurement = {
      ...strategy.procurement,
      mode: "hybrid-bundle",
      tradeableOutputRequired,
      selectionConstraint: tradeableOutputRequired
        ? "tradeable-output-only"
        : "none",
      plan,
    };
    const completion = {
      ...template,
      scope: "wonderberry-completion-hybrid-bundle",
      tradeableOutputRequired,
      selectedProcurement: "hybrid-bundle",
      completionBundle,
      completionPurchaseUnit: completionBundle,
      completionWonderBerry: null,
      completionUnitKind: "bundle",
      purchaseUnitLabel: "묶음",
      purchaseUnitSize: bundleSize,
      completionProbability: hybridEvaluation.completionProbability,
      cumulativeChanceBefore: hybridEvaluation.cumulativeChanceBefore,
      cumulativeChance: hybridEvaluation.cumulativeChance,
      survivalProbabilityBefore:
        hybridEvaluation.survivalProbabilityBefore,
      policy: {
        ...strategy.policy,
        condition: "completion-at-hybrid-bundle",
        completionBundle,
        completionPurchaseUnit: completionBundle,
        completionWonderBerry: null,
        completionUnitKind: "bundle",
        tradeableOutputRequired,
      },
      probabilities: {
        ...template.probabilities,
        completionAtBundle: hybridEvaluation.completionProbability,
        cumulativeBeforeBundle:
          hybridEvaluation.cumulativeChanceBefore,
        cumulativeAtBundle: hybridEvaluation.cumulativeChance,
        survivalBeforeBundle:
          hybridEvaluation.survivalProbabilityBefore,
      },
      expected: strategy.expected,
      remainingWonderBlackDistribution: null,
      remainingHybridInventoryDistribution:
        hybridEvaluation.remainingHybridInventoryDistribution,
      completionRemainingHybridInventoryDistribution:
        hybridEvaluation.completionRemainingHybridInventoryDistribution,
      costs: strategy.costs,
      recovery: strategy.recovery,
      procurement: wonderBerryProcurement,
      wonderBerryProcurement,
      completion: {
        bundle: completionBundle,
        purchaseUnit: completionBundle,
        wonderBerries: null,
        unitKind: "bundle",
        purchaseUnitLabel: "묶음",
        purchaseUnitSize: bundleSize,
        probability: hybridEvaluation.completionProbability,
        cumulativeChanceBefore:
          hybridEvaluation.cumulativeChanceBefore,
        cumulativeChance: hybridEvaluation.cumulativeChance,
        survivalProbabilityBefore:
          hybridEvaluation.survivalProbabilityBefore,
      },
    };
    return {
      selectedProcurement: "hybrid-bundle",
      eligibleForSelection: true,
      purchaseUnits: completionBundle,
      purchaseUnitLabel: "묶음",
      purchaseUnitSize: bundleSize,
      purchaseUnitMeaning: "purchased-wonderberry-bundles",
      completionUnitKind: "bundle",
      requiredWonderBerries: null,
      requiredPurchaseBundles: completionBundle,
      suppliedWonderBerries: completionBundle * bundleSize,
      unopenedWonderBerries: 0,
      actualChance: hybridEvaluation.cumulativeChance,
      previousChance: hybridEvaluation.cumulativeChanceBefore,
      netMesoEquivalentAfterRemainingBlackSale:
        strategy.costs.netMesoEquivalentAfterRemainingBlackSale,
      plan,
      procurement: wonderBerryProcurement,
      completion,
    };
  };
  const maplePointBundle = makeCandidate("maple-point-bundle");
  const auctionBundle = wonderBerryAuctionBundleMesoPrice > 0
    ? makeCandidate("auction-bundle")
    : null;
  const hybridBundle = wonderBerryAuctionBundleMesoPrice > 0
    ? makeHybridCandidate()
    : null;
  if (
    tradeableOutputRequired &&
    procurementMode === "maple-point-bundle"
  ) {
    throw new RangeError(
      "교환 가능한 합성 결과에는 메포 원더베리 단독 조달을 선택할 수 없습니다.",
    );
  }
  const selected = procurementMode === "maple-point-bundle"
    ? maplePointBundle
    : procurementMode === "auction-bundle"
      ? auctionBundle
      : procurementMode === "hybrid-bundle"
        ? hybridBundle
        : [
          ...(tradeableOutputRequired ? [] : [maplePointBundle]),
          auctionBundle,
          hybridBundle,
        ]
          .filter(Boolean)
          .reduce((best, candidate) =>
            candidate.netMesoEquivalentAfterRemainingBlackSale <
              best.netMesoEquivalentAfterRemainingBlackSale
              ? candidate
              : best
          );
  // 기존 consumers가 candidates.optimized를 참조하므로 선택 결과의
  // 하위 호환 별칭으로 유지한다. 선택 기준은 이제 총 조달비가 아니라
  // 산출물 회수까지 반영한 해당 분위수의 순비용이다.
  const optimized = selected;

  return {
    scope: "wonderberry-percentile-completion",
    targetCount,
    wonderBlackEvent,
    tradeableOutputRequired,
    requestedChance,
    requiredWonderBerries: optimized.requiredWonderBerries,
    requiredPurchaseBundles: optimized.requiredPurchaseBundles,
    completionWonderBerry: optimized.requiredWonderBerries,
    completionUnitKind: optimized.completionUnitKind,
    selectedProcurement: optimized.selectedProcurement,
    purchaseUnits: optimized.purchaseUnits,
    purchaseUnitLabel: "묶음",
    purchaseUnitSize: bundleSize,
    purchaseUnitMeaning: "purchased-wonderberry-bundles",
    suppliedWonderBerries: optimized.suppliedWonderBerries,
    unopenedWonderBerries: optimized.unopenedWonderBerries,
    actualChance: optimized.actualChance,
    previousChance: optimized.previousChance,
    plan: optimized.plan,
    procurement: optimized.procurement,
    completion: optimized.completion,
    expected: optimized.completion.expected,
    costs: optimized.completion.costs,
    recovery: optimized.completion.recovery,
    candidates: {
      optimized,
      maplePointBundle,
      auctionBundle,
      hybridBundle,
    },
    selectionBasis:
      tradeableOutputRequired
        ? "tradeable-candidate-own-bundle-quantile-t-equals-k-net-meso-after-recovery"
        : "candidate-own-bundle-quantile-t-equals-k-net-meso-after-recovery",
  };
}

function solveUnlimitedBundleKernel(kernel) {
  const matrix = createBundleLinearMatrix(kernel);
  const expected = Object.fromEntries(
    BUNDLE_REWARD_KEYS.map((reward) => [
      reward,
      solveBundleReward(kernel, matrix, (stateKernel) =>
        stateKernel.rewards[reward]),
    ]),
  );
  expected.totalSyntheses =
    expected.sweetSynthesisAttempts + expected.dreamSynthesisAttempts;
  expected.wonderBerryFailures =
    expected.openedWonderBerries - expected.wonderBlacksPulled;

  const maximumRemainingBlack = kernel.bundleSize;
  const remainingWonderBlackDistribution = [];
  let remainingWonderBlacks = 0;
  for (let count = 0; count <= maximumRemainingBlack; count += 1) {
    const probability = solveBundleReward(
      kernel,
      matrix,
      (stateKernel) => stateKernel.absorbed.get(count) ?? 0,
    );
    if (probability > 1e-15) {
      remainingWonderBlackDistribution.push({ count, probability });
      remainingWonderBlacks += count * probability;
    }
  }
  expected.remainingWonderBlacks = remainingWonderBlacks;
  return { expected, remainingWonderBlackDistribution };
}

function solveUnlimitedHybridBundleKernel(kernel) {
  const matrix = createBundleLinearMatrix(kernel);
  const expected = Object.fromEntries(
    BUNDLE_REWARD_KEYS.map((reward) => [
      reward,
      solveBundleReward(kernel, matrix, (stateKernel) =>
        stateKernel.rewards[reward]),
    ]),
  );
  const remainingTradeableWonderBlacks = solveBundleReward(
    kernel,
    matrix,
    (stateKernel) =>
      [...stateKernel.absorbed].reduce(
        (sum, [key, probability]) =>
          sum +
          parseHybridRemainingInventoryKey(key).tradeableBlacks *
            probability,
        0,
      ),
  );
  const remainingUntradeableWonderBlacks = solveBundleReward(
    kernel,
    matrix,
    (stateKernel) =>
      [...stateKernel.absorbed].reduce(
        (sum, [key, probability]) =>
          sum +
          parseHybridRemainingInventoryKey(key).untradeableBlacks *
            probability,
        0,
      ),
  );
  finalizeHybridExpected(
    expected,
    remainingTradeableWonderBlacks,
    remainingUntradeableWonderBlacks,
    0,
  );
  return {
    expected,
    remainingHybridInventoryDistribution: null,
    remainingHybridInventoryDistributionIncluded: false,
  };
}

function getUnlimitedHybridBundleSolution(kernel) {
  const key = hybridKernelCacheKey(
    kernel.targetCount,
    kernel.wonderBlackEvent,
    kernel.bundleSize,
  );
  let solution = HYBRID_UNLIMITED_SOLUTION_CACHE.get(key);
  if (!solution) {
    solution = solveUnlimitedHybridBundleKernel(kernel);
    HYBRID_UNLIMITED_SOLUTION_CACHE.set(key, solution);
  }
  return solution;
}

function decorateExpectedForWonderBerryProcurement(
  rawExpected,
  selectedProcurement,
  procurementPlan = null,
) {
  const kernelPurchaseUnits = rawExpected.purchasedBundles;
  const wonderUpperPetsPulled = rawExpected.wonderPetPaybacks;
  const fixedPlan = procurementPlan !== null;
  const purchaseUnits = fixedPlan
    ? procurementPlan.purchasedBundles
    : kernelPurchaseUnits;
  const maplePointPurchaseUnits = fixedPlan
    ? procurementPlan.maplePointBundles
    : selectedProcurement === "maple-point-bundle"
      ? purchaseUnits
      : 0;
  const auctionPurchaseUnits = fixedPlan
    ? procurementPlan.auctionBundles
    : selectedProcurement === "auction-bundle"
      ? purchaseUnits
      : 0;
  return {
    ...rawExpected,
    // purchasedBundles는 기존 소비자를 위한 구매 단위 수 별칭이다.
    // 새 소비자는 purchasedUnits와 policy.purchaseUnitLabel을 사용한다.
    purchasedUnits: purchaseUnits,
    purchasedBundles: purchaseUnits,
    purchasedMaplePointBundles: maplePointPurchaseUnits,
    purchasedAuctionWonderBerryBundles: auctionPurchaseUnits,
    purchasedAuctionBundles: auctionPurchaseUnits,
    openedMaplePointWonderBerries:
      selectedProcurement === "maple-point-bundle"
        ? rawExpected.openedWonderBerries
        : 0,
    openedAuctionWonderBerries:
      selectedProcurement === "auction-bundle"
        ? rawExpected.openedWonderBerries
        : 0,
    untradeableWonderBlacksPulled:
      selectedProcurement === "maple-point-bundle"
        ? rawExpected.wonderBlacksPulled
        : 0,
    tradeableWonderBlacksPulled:
      selectedProcurement === "auction-bundle"
        ? rawExpected.wonderBlacksPulled
        : 0,
    remainingUntradeableWonderBlacks:
      selectedProcurement === "maple-point-bundle"
        ? rawExpected.remainingWonderBlacks
        : 0,
    remainingTradeableWonderBlacks:
      selectedProcurement === "auction-bundle"
        ? rawExpected.remainingWonderBlacks
        : 0,
    suppliedWonderBerries: fixedPlan
      ? procurementPlan.suppliedWonderBerries
      : rawExpected.openedWonderBerries,
    unopenedWonderBerries: fixedPlan
      ? procurementPlan.excessWonderBerries
      : 0,
    wonderUpperPetsPulled,
    wonderPetPaybacks: wonderUpperPetsPulled,
    wonderPetPaybacksIneligible: 0,
  };
}

function buildWonderBerryStrategy({
  selectedProcurement,
  targetCount,
  wonderBlackEvent,
  purchaseUnitSize,
  maplePointBundleSize,
  rawExpected,
  remainingWonderBlackDistribution,
  wonderBerryBundleMaplePoints,
  wonderBerryAuctionBundleMesoPrice,
  lunaCrystalMaplePoints,
  wonderBlackMesoPrice,
  lunaDreamAuctionMesoPrice,
  lunaSweetAuctionMesoPrice = 0,
  lunaKeyAuctionMesoPrice,
  auctionFeeRate,
  currency,
  procurementPlan = null,
  purchaseUnitLabel: purchaseUnitLabelOverride = null,
}) {
  const expected = decorateExpectedForWonderBerryProcurement(
    rawExpected,
    selectedProcurement,
    procurementPlan,
  );
  const costToMeso = currency.maplePointToMeso;
  const paybackMeso = PET_PAYBACK_POINTS * costToMeso;
  const tradeableOutputs = selectedProcurement === "auction-bundle";
  const netAuctionPrice = (price) => price * (1 - auctionFeeRate);
  const buildPetRecovery = (count, auctionPrice) => {
    const paybackMaplePoints = count * PET_PAYBACK_POINTS;
    const paybackMesoEquivalent = paybackMaplePoints * costToMeso;
    const auctionNetMesoPerPet = netAuctionPrice(auctionPrice);
    const auctionSaleApplicable = tradeableOutputs && auctionPrice > 0;
    const auctionRecoveryMeso = auctionSaleApplicable
      ? count * auctionNetMesoPerPet
      : 0;
    const auctionSaleSelected =
      auctionSaleApplicable && auctionNetMesoPerPet > paybackMeso;
    const method = auctionSaleSelected ? "auction" : "payback";
    const recoveryMeso = auctionSaleSelected
      ? auctionRecoveryMeso
      : paybackMesoEquivalent;
    const auctionSaleApplied = auctionSaleSelected && count > 0;
    const auctionSaleNonApplicationReason = auctionSaleApplied
      ? null
      : count <= 0
        ? "no-expected-output"
        : !tradeableOutputs
          ? "output-untradeable"
          : !(auctionPrice > 0)
            ? "auction-price-not-provided"
            : "payback-higher-or-equal";
    return {
      count,
      paybackMaplePoints,
      paybackMesoEquivalent,
      auctionGrossMesoPerPet: auctionPrice,
      auctionNetMesoPerPet,
      auctionRecoveryMeso,
      auctionSaleApplicable,
      auctionSaleSelected,
      auctionSaleApplied,
      auctionSaleNonApplicationReason,
      method,
      recoveryMesoPerPet: method === "auction"
        ? auctionNetMesoPerPet
        : paybackMeso,
      recoveryMeso,
    };
  };
  const buildKeptPetInventory = (count, auctionPrice = 0) => ({
    count,
    paybackMaplePoints: 0,
    paybackMesoEquivalent: 0,
    auctionGrossMesoPerPet: auctionPrice,
    auctionNetMesoPerPet: netAuctionPrice(auctionPrice),
    auctionRecoveryMeso: 0,
    auctionSaleApplicable: false,
    auctionSaleSelected: false,
    auctionSaleApplied: false,
    auctionSaleNonApplicationReason:
      count > 0 ? "inventory-kept" : "no-expected-output",
    method: "keep",
    recoveryMesoPerPet: 0,
    recoveryMeso: 0,
  });
  const dreamLedger = buildPetRecovery(
    expected.lunaDreams,
    lunaDreamAuctionMesoPrice,
  );
  // 메포 묶음에서 나온 교불 원더 블랙은 다음 합성 재료로 보관한다.
  // 아직 현금화하지 않은 재고이므로 페이백이나 비용 회수로 잡지 않는다.
  const remainingBlackLedger = tradeableOutputs
    ? buildPetRecovery(
      expected.remainingWonderBlacks ?? 0,
      wonderBlackMesoPrice,
    )
    : buildKeptPetInventory(
      expected.remainingWonderBlacks ?? 0,
      wonderBlackMesoPrice,
    );
  // 제한 종료 시 드림 합성을 기다리는 스윗이 남을 수 있다. 스윗도
  // 펫이므로 최소 540 MP 페이백을 적용하고, 경매장 묶음 산출물이면서
  // 시세가 입력된 경우에만 판매 순수령액과 비교한다.
  const remainingSweetLedger = buildPetRecovery(
    expected.remainingLunaSweets ?? 0,
    lunaSweetAuctionMesoPrice,
  );
  const keyAuctionNetMeso = netAuctionPrice(
    lunaKeyAuctionMesoPrice,
  );
  const keyAuctionSaleApplicable =
    tradeableOutputs && lunaKeyAuctionMesoPrice > 0;
  const keyAuctionRecoveryMeso = keyAuctionSaleApplicable
    ? expected.lunaKeys * keyAuctionNetMeso
    : 0;
  const keyAuctionSaleApplied =
    keyAuctionSaleApplicable && expected.lunaKeys > 0;
  const keyAuctionSaleNonApplicationReason = keyAuctionSaleApplied
    ? null
    : expected.lunaKeys <= 0
      ? "no-expected-output"
      : !tradeableOutputs
        ? "output-untradeable"
        : "auction-price-not-provided";
  const dreamRecoveryMesoPerPet = dreamLedger.recoveryMesoPerPet;
  const keyRecoveryMesoPerItem = keyAuctionSaleApplicable
    ? keyAuctionNetMeso
    : 0;
  const berryMaplePoints = procurementPlan
    ? procurementPlan.bundleMaplePoints
    : selectedProcurement === "maple-point-bundle"
      ? expected.purchasedUnits * wonderBerryBundleMaplePoints
      : 0;
  const wonderBerryAuctionBundleMeso = procurementPlan
    ? procurementPlan.auctionBundleMeso
    : selectedProcurement === "auction-bundle"
      ? expected.purchasedUnits * wonderBerryAuctionBundleMesoPrice
      : 0;
  const crystalMaplePoints =
    expected.lunaCrystals * lunaCrystalMaplePoints;
  const grossMaplePoints = berryMaplePoints + crystalMaplePoints;
  const wonderPetPaybackMaplePoints =
    expected.wonderPetPaybacks * PET_PAYBACK_POINTS;
  const dreamPaybackMaplePoints = dreamLedger.paybackMaplePoints;
  const dreamPaybackMesoEquivalent =
    dreamLedger.paybackMesoEquivalent;
  const dreamAuctionRecoveryMeso =
    dreamLedger.auctionRecoveryMeso;
  const dreamRecoveryMeso = dreamLedger.recoveryMeso;
  const keyRecoveryMeso = keyAuctionRecoveryMeso;
  const remainingSweetPaybackMaplePoints =
    remainingSweetLedger.paybackMaplePoints;
  const remainingSweetPaybackMesoEquivalent =
    remainingSweetLedger.paybackMesoEquivalent;
  const remainingSweetAuctionRecoveryMeso =
    remainingSweetLedger.auctionRecoveryMeso;
  const remainingSweetRecoveryMeso =
    remainingSweetLedger.recoveryMeso;
  const berryProcurementMesoEquivalent =
    berryMaplePoints * costToMeso + wonderBerryAuctionBundleMeso;
  const grossMesoEquivalent =
    grossMaplePoints * costToMeso + wonderBerryAuctionBundleMeso;
  const remainingBlackPaybackMaplePoints =
    remainingBlackLedger.paybackMaplePoints;
  const remainingBlackPaybackMesoEquivalent =
    remainingBlackLedger.paybackMesoEquivalent;
  const remainingBlackAuctionRecoveryMeso =
    remainingBlackLedger.auctionRecoveryMeso;
  const remainingWonderBlackRecoveryMeso =
    remainingBlackLedger.recoveryMeso;
  const totalPetPaybackMaplePoints =
    wonderPetPaybackMaplePoints +
    (dreamLedger.method === "payback" ? dreamPaybackMaplePoints : 0) +
    (remainingBlackLedger.method === "payback"
      ? remainingBlackPaybackMaplePoints
      : 0) +
    (remainingSweetLedger.method === "payback"
      ? remainingSweetPaybackMaplePoints
      : 0);
  const totalAuctionRecoveryMeso =
    (dreamLedger.method === "auction" ? dreamAuctionRecoveryMeso : 0) +
    keyAuctionRecoveryMeso +
    (remainingBlackLedger.method === "auction"
      ? remainingBlackAuctionRecoveryMeso
      : 0) +
    (remainingSweetLedger.method === "auction"
      ? remainingSweetAuctionRecoveryMeso
      : 0);
  const recoveryMesoEquivalent =
    totalPetPaybackMaplePoints * costToMeso +
    totalAuctionRecoveryMeso;
  const netMesoEquivalent =
    grossMesoEquivalent - recoveryMesoEquivalent;
  // 기존 필드는 실제로 경매장 판매를 채택한 금액만 뜻한다.
  const remainingWonderBlackAuctionMesoValue =
    remainingBlackLedger.method === "auction"
      ? remainingBlackAuctionRecoveryMeso
      : 0;
  const netMesoEquivalentAfterRemainingBlackSale =
    netMesoEquivalent;
  const purchaseUnitLabel = purchaseUnitLabelOverride ??
    "묶음";
  const tradeability = {
    acquisitionSource: selectedProcurement,
    auctionWonderBerryBundleTradableAfterReceipt:
      expected.purchasedAuctionWonderBerryBundles === 0 ? null : false,
    purchasedBundlePaybackEligible: false,
    openedResultsFollowNormalRules: true,
    wonderPetPaybackEligible: true,
    outputTradeability: tradeableOutputs
      ? "tradeable-once"
      : "untradeable",
    outputTradeabilityBasis: tradeableOutputs
      ? "official-rules-derived-inference"
      : "maple-point-purchase-untradeable",
    openedWonderBlackTradable: tradeableOutputs,
    wonderBlackTradable: tradeableOutputs,
    synthesisBaseTradable: tradeableOutputs,
    synthesisResultTradable: tradeableOutputs,
    lunaDreamTradable: tradeableOutputs,
    lunaKeyTradable: tradeableOutputs,
  };

  const costs = {
    wonderBerryBundleMaplePoints,
    wonderBerryAuctionBundleMesoPrice,
    lunaCrystalMaplePoints,
    lunaSweetAuctionMesoPrice,
    berryMaplePoints,
    wonderBerryAuctionBundleMeso,
    berryProcurementMesoEquivalent,
    crystalMaplePoints,
    grossMaplePoints,
    wonderPetPaybackMaplePoints,
    berryRecoveryMaplePoints: wonderPetPaybackMaplePoints,
    totalPetPaybackMaplePoints,
    dreamPaybackMaplePoints,
    dreamPaybackMesoEquivalent,
    dreamAuctionRecoveryMeso,
    keyAuctionRecoveryMeso,
    totalAuctionRecoveryMeso,
    remainingBlackPaybackMaplePoints,
    remainingBlackPaybackMesoEquivalent,
    remainingBlackAuctionRecoveryMeso,
    remainingTradeableBlackPaybackMaplePoints: tradeableOutputs
      ? remainingBlackPaybackMaplePoints
      : 0,
    remainingTradeableBlackPaybackMesoEquivalent: tradeableOutputs
      ? remainingBlackPaybackMesoEquivalent
      : 0,
    remainingUntradeableBlackPaybackMaplePoints: 0,
    remainingUntradeableBlackPaybackMesoEquivalent: 0,
    remainingUntradeableWonderBlackRecoveryMeso: 0,
    remainingWonderBlackRecoveryMeso,
    remainingSweetPaybackMaplePoints,
    remainingSweetPaybackMesoEquivalent,
    remainingSweetAuctionRecoveryMeso,
    remainingSweetRecoveryMeso,
    // 기존 호출부와의 하위 호환 별칭이다.
    berryCash: berryMaplePoints,
    crystalCash: crystalMaplePoints,
    grossCash: grossMaplePoints,
    wonderPetPaybackCash: wonderPetPaybackMaplePoints,
    dreamRecoveryMeso,
    keyRecoveryMeso,
    recoveryMesoEquivalent,
    totalRecoveryMesoEquivalent: recoveryMesoEquivalent,
    grossMesoEquivalent,
    netMesoEquivalent,
    costConversionBasis: currency.costConversionBasis,
    conversionToMeso: costToMeso,
    maplePointToMeso: currency.maplePointToMeso,
    wonToMeso: currency.wonToMeso,
    cashToMeso: costToMeso,
    remainingWonderBlackAuctionMesoValue,
    netMesoEquivalentAfterRemainingBlackSale,
    netMesoEquivalentAfterRemainingInventoryRecovery:
      netMesoEquivalentAfterRemainingBlackSale,
  };
  const recovery = {
    paybackPointsPerPet: PET_PAYBACK_POINTS,
    paybackMesoPerPet: paybackMeso,
    totalPetPaybackMaplePoints,
    totalAuctionRecoveryMeso,
    recoveryMesoEquivalent,
    dreamMesoPerPet: dreamRecoveryMesoPerPet,
    dreamMethod: dreamLedger.method,
    dreamPaybackMaplePoints,
    dreamPaybackMesoEquivalent,
    dreamAuctionGrossMeso: lunaDreamAuctionMesoPrice,
    dreamAuctionNetMeso: dreamLedger.auctionNetMesoPerPet,
    dreamAuctionRecoveryMeso,
    dreamAuctionSaleApplicable:
      dreamLedger.auctionSaleApplicable,
    dreamAuctionSaleApplied: dreamLedger.auctionSaleApplied,
    dreamAuctionSaleNonApplicationReason:
      dreamLedger.auctionSaleNonApplicationReason,
    keyMesoPerItem: keyRecoveryMesoPerItem,
    keyAuctionGrossMeso: lunaKeyAuctionMesoPrice,
    keyAuctionNetMeso,
    keyAuctionRecoveryMeso,
    keyAuctionSaleApplicable,
    keyAuctionSaleApplied,
    keyAuctionSaleNonApplicationReason,
    remainingBlackMethod: remainingBlackLedger.method,
    remainingTradeableBlackMethod: tradeableOutputs
      ? remainingBlackLedger.method
      : null,
    remainingUntradeableBlackMethod: tradeableOutputs
      ? null
      : "keep",
    remainingBlackPaybackMaplePoints,
    remainingBlackPaybackMesoEquivalent,
    remainingBlackAuctionRecoveryMeso,
    remainingBlackRecoveryMeso:
      remainingWonderBlackRecoveryMeso,
    remainingBlackAuctionSaleApplicable:
      remainingBlackLedger.auctionSaleApplicable,
    remainingBlackAuctionSaleApplied:
      remainingBlackLedger.auctionSaleApplied,
    remainingBlackAuctionSaleNonApplicationReason:
      remainingBlackLedger.auctionSaleNonApplicationReason,
    remainingUntradeableBlackAuctionSaleApplicable: false,
    remainingUntradeableBlackAuctionSaleApplied: false,
    remainingUntradeableBlackAuctionSaleNonApplicationReason:
      tradeableOutputs
        ? "no-expected-output"
        : (expected.remainingUntradeableWonderBlacks ?? 0) > 0
          ? "inventory-kept"
          : "no-expected-output",
    remainingSweetMethod: remainingSweetLedger.method,
    remainingSweetPaybackMaplePoints,
    remainingSweetPaybackMesoEquivalent,
    remainingSweetAuctionRecoveryMeso,
    remainingSweetRecoveryMeso,
    remainingSweetAuctionSaleApplicable:
      remainingSweetLedger.auctionSaleApplicable,
    remainingSweetAuctionSaleApplied:
      remainingSweetLedger.auctionSaleApplied,
    remainingSweetAuctionSaleNonApplicationReason:
      remainingSweetLedger.auctionSaleNonApplicationReason,
    outputTradeability: tradeability.outputTradeability,
    auctionFeeRate,
  };
  const procurement = {
    selectedProcurement,
    purchaseUnitLabel,
    purchaseUnitSize,
    maplePointBundleSize,
    expectedPurchaseUnits: expected.purchasedUnits,
    expectedMaplePointBundles: expected.purchasedMaplePointBundles,
    expectedAuctionBundles:
      expected.purchasedAuctionWonderBerryBundles,
    expectedOpenedWonderBerries: expected.openedWonderBerries,
    suppliedWonderBerries: expected.suppliedWonderBerries,
    unopenedWonderBerries: expected.unopenedWonderBerries,
    plan: procurementPlan,
    selectionBasis: procurementPlan
      ? "minimum-gross-procurement-for-fixed-open-count"
      : "net-meso-after-recovery",
    tradeability,
    costs: {
      bundleMaplePoints: berryMaplePoints,
      auctionBundleMeso: wonderBerryAuctionBundleMeso,
      mesoEquivalent: berryProcurementMesoEquivalent,
      netTotalMesoEquivalent:
        netMesoEquivalentAfterRemainingBlackSale,
    },
  };
  const kernel = getWonderBerryBundleKernel({
    targetCount,
    wonderBlackEvent,
    bundleSize: purchaseUnitSize,
  });
  const checkpoints = [0.5, 0.9, 0.95].map((chance) => {
    const units = bundleCountForTargetChance(kernel, chance);
    return {
      chance,
      bundles: units,
      purchaseUnits: units,
      purchaseUnitLabel,
      actualChance: probabilityWithinBundleKernel(kernel, units),
    };
  });

  return {
    selectedProcurement,
    purchaseUnitLabel,
    purchaseUnitSize,
    expected,
    remainingWonderBlackDistribution,
    costs,
    recovery,
    procurement,
    policy: {
      bundleSize: purchaseUnitSize,
      purchaseUnitSize,
      purchaseUnitLabel,
      maplePointBundleSize,
      selectedProcurement,
      openEntireBundle: true,
      openEntirePurchaseUnit: true,
      pendingSweetFirst: true,
      stopAtTarget: true,
      keepRemainingWonderBlacks: true,
      preserveUnopenedWonderBerries:
        (procurementPlan?.excessWonderBerries ?? 0) > 0,
    },
    checkpoints,
  };
}

function buildHybridWonderBerryStrategy({
  targetCount,
  wonderBlackEvent,
  purchaseUnitSize,
  rawExpected,
  remainingHybridInventoryDistribution,
  wonderBerryBundleMaplePoints,
  wonderBerryAuctionBundleMesoPrice,
  lunaCrystalMaplePoints,
  wonderBlackMesoPrice,
  lunaDreamAuctionMesoPrice,
  lunaSweetAuctionMesoPrice = 0,
  lunaKeyAuctionMesoPrice,
  auctionFeeRate,
  currency,
}) {
  const expected = {
    ...rawExpected,
    purchasedUnits: rawExpected.purchasedBundles,
    purchasedAuctionBundles:
      rawExpected.purchasedAuctionWonderBerryBundles,
    suppliedWonderBerries: rawExpected.openedWonderBerries,
    unopenedWonderBerries: 0,
    wonderUpperPetsPulled: rawExpected.wonderPetPaybacks,
    wonderPetPaybacksIneligible: 0,
  };
  const costToMeso = currency.maplePointToMeso;
  const paybackMeso = PET_PAYBACK_POINTS * costToMeso;
  const netAuctionPrice = (price) => price * (1 - auctionFeeRate);
  const petLedger = (count, auctionPrice, tradeable) => {
    const paybackMaplePoints = count * PET_PAYBACK_POINTS;
    const paybackMesoEquivalent = paybackMaplePoints * costToMeso;
    const auctionNetMesoPerPet = netAuctionPrice(auctionPrice);
    const auctionSaleApplicable = tradeable && auctionPrice > 0;
    const auctionRecoveryMeso = auctionSaleApplicable
      ? count * auctionNetMesoPerPet
      : 0;
    const auctionSaleSelected =
      auctionSaleApplicable && auctionNetMesoPerPet > paybackMeso;
    const method = auctionSaleSelected ? "auction" : "payback";
    const recoveryMeso = auctionSaleSelected
      ? auctionRecoveryMeso
      : paybackMesoEquivalent;
    const auctionSaleApplied = auctionSaleSelected && count > 0;
    return {
      count,
      paybackMaplePoints,
      paybackMesoEquivalent,
      auctionNetMesoPerPet,
      auctionRecoveryMeso,
      auctionSaleApplicable,
      auctionSaleSelected,
      auctionSaleApplied,
      auctionSaleNonApplicationReason: auctionSaleApplied
        ? null
        : count <= 0
          ? "no-expected-output"
          : !tradeable
            ? "output-untradeable"
            : !(auctionPrice > 0)
              ? "auction-price-not-provided"
              : "payback-higher-or-equal",
      method,
      recoveryMesoPerPet: method === "auction"
        ? auctionNetMesoPerPet
        : paybackMeso,
      recoveryMeso,
    };
  };
  const keptPetInventoryLedger = (count) => ({
    count,
    paybackMaplePoints: 0,
    paybackMesoEquivalent: 0,
    auctionNetMesoPerPet: 0,
    auctionRecoveryMeso: 0,
    auctionSaleApplicable: false,
    auctionSaleSelected: false,
    auctionSaleApplied: false,
    auctionSaleNonApplicationReason:
      count > 0 ? "inventory-kept" : "no-expected-output",
    method: "keep",
    recoveryMesoPerPet: 0,
    recoveryMeso: 0,
  });

  const dreamLedger = petLedger(
    expected.lunaDreams,
    lunaDreamAuctionMesoPrice,
    true,
  );
  const tradeableBlackLedger = petLedger(
    expected.remainingTradeableWonderBlacks ?? 0,
    wonderBlackMesoPrice,
    true,
  );
  // 메포 묶음에서 남은 교불 블랙은 다음 합성에 쓰도록 보관한다.
  // 보관 재고는 페이백·판매·비용 회수에 포함하지 않는다.
  const untradeableBlackLedger = keptPetInventoryLedger(
    expected.remainingUntradeableWonderBlacks ?? 0,
  );
  const remainingSweetLedger = petLedger(
    expected.remainingLunaSweets ?? 0,
    lunaSweetAuctionMesoPrice,
    true,
  );
  const keyAuctionNetMeso = netAuctionPrice(lunaKeyAuctionMesoPrice);
  const keyAuctionSaleApplicable = lunaKeyAuctionMesoPrice > 0;
  const keyAuctionRecoveryMeso = keyAuctionSaleApplicable
    ? expected.lunaKeys * keyAuctionNetMeso
    : 0;
  const keyAuctionSaleApplied =
    keyAuctionSaleApplicable && expected.lunaKeys > 0;

  const berryMaplePoints =
    expected.purchasedMaplePointBundles *
    wonderBerryBundleMaplePoints;
  const wonderBerryAuctionBundleMeso =
    expected.purchasedAuctionWonderBerryBundles *
    wonderBerryAuctionBundleMesoPrice;
  const crystalMaplePoints =
    expected.lunaCrystals * lunaCrystalMaplePoints;
  const grossMaplePoints = berryMaplePoints + crystalMaplePoints;
  const grossMesoEquivalent =
    grossMaplePoints * costToMeso + wonderBerryAuctionBundleMeso;
  const berryProcurementMesoEquivalent =
    berryMaplePoints * costToMeso + wonderBerryAuctionBundleMeso;
  const wonderPetPaybackMaplePoints =
    expected.wonderPetPaybacks * PET_PAYBACK_POINTS;
  const remainingBlackPaybackMaplePoints =
    tradeableBlackLedger.paybackMaplePoints;
  const remainingBlackPaybackMesoEquivalent =
    remainingBlackPaybackMaplePoints * costToMeso;
  const remainingBlackAuctionRecoveryMeso =
    tradeableBlackLedger.auctionRecoveryMeso;
  const remainingWonderBlackRecoveryMeso =
    tradeableBlackLedger.recoveryMeso;
  const totalPetPaybackMaplePoints =
    wonderPetPaybackMaplePoints +
    (dreamLedger.method === "payback"
      ? dreamLedger.paybackMaplePoints
      : 0) +
    (tradeableBlackLedger.method === "payback"
      ? tradeableBlackLedger.paybackMaplePoints
      : 0) +
    (remainingSweetLedger.method === "payback"
      ? remainingSweetLedger.paybackMaplePoints
      : 0);
  const totalAuctionRecoveryMeso =
    (dreamLedger.method === "auction"
      ? dreamLedger.auctionRecoveryMeso
      : 0) +
    keyAuctionRecoveryMeso +
    (tradeableBlackLedger.method === "auction"
      ? tradeableBlackLedger.auctionRecoveryMeso
      : 0) +
    (remainingSweetLedger.method === "auction"
      ? remainingSweetLedger.auctionRecoveryMeso
      : 0);
  const recoveryMesoEquivalent =
    totalPetPaybackMaplePoints * costToMeso +
    totalAuctionRecoveryMeso;
  const netMesoEquivalent =
    grossMesoEquivalent - recoveryMesoEquivalent;
  const remainingWonderBlackAuctionMesoValue =
    tradeableBlackLedger.method === "auction"
      ? tradeableBlackLedger.auctionRecoveryMeso
      : 0;

  const sourceBreakdown = {
    auctionBase: {
      source: "auction-bundle",
      role: "tradeable-base",
      purchasedBundles:
        expected.purchasedAuctionWonderBerryBundles,
      openedWonderBerries:
        expected.openedAuctionWonderBerries,
      suppliedWonderBerries:
        expected.openedAuctionWonderBerries,
      unopenedWonderBerries: 0,
      wonderBlacksPulled:
        expected.tradeableWonderBlacksPulled,
      wonderBlacksConsumedAsBase:
        expected.tradeableWonderBlacksConsumedAsBase,
      remainingWonderBlacks:
        expected.remainingTradeableWonderBlacks,
      maplePoints: 0,
      auctionMeso: wonderBerryAuctionBundleMeso,
      mesoEquivalent: wonderBerryAuctionBundleMeso,
    },
    maplePointMaterial: {
      source: "maple-point-bundle",
      role: "untradeable-material",
      purchasedBundles: expected.purchasedMaplePointBundles,
      openedWonderBerries:
        expected.openedMaplePointWonderBerries,
      suppliedWonderBerries:
        expected.openedMaplePointWonderBerries,
      unopenedWonderBerries: 0,
      wonderBlacksPulled:
        expected.untradeableWonderBlacksPulled,
      wonderBlacksConsumedAsMaterial:
        expected.untradeableWonderBlacksConsumedAsMaterial,
      remainingWonderBlacks:
        expected.remainingUntradeableWonderBlacks,
      maplePoints: berryMaplePoints,
      auctionMeso: 0,
      mesoEquivalent: berryMaplePoints * costToMeso,
    },
  };
  const tradeability = {
    acquisitionSource: "hybrid-bundle",
    outputTradeability: "tradeable-once",
    outputTradeabilityBasis: "auction-base-inheritance",
    openedWonderBlackTradable: null,
    auctionBaseWonderBlackTradable: true,
    maplePointMaterialWonderBlackTradable: false,
    synthesisBaseTradable: true,
    synthesisMaterialTradable: false,
    synthesisResultTradable: true,
    lunaDreamTradable: true,
    lunaKeyTradable: true,
    wonderPetPaybackEligible: true,
  };
  const costs = {
    wonderBerryBundleMaplePoints,
    wonderBerryAuctionBundleMesoPrice,
    lunaCrystalMaplePoints,
    lunaSweetAuctionMesoPrice,
    berryMaplePoints,
    wonderBerryAuctionBundleMeso,
    berryProcurementMesoEquivalent,
    crystalMaplePoints,
    grossMaplePoints,
    wonderPetPaybackMaplePoints,
    berryRecoveryMaplePoints: wonderPetPaybackMaplePoints,
    dreamPaybackMaplePoints: dreamLedger.paybackMaplePoints,
    dreamPaybackMesoEquivalent: dreamLedger.paybackMesoEquivalent,
    dreamAuctionRecoveryMeso: dreamLedger.auctionRecoveryMeso,
    dreamRecoveryMeso: dreamLedger.recoveryMeso,
    keyAuctionRecoveryMeso,
    keyRecoveryMeso: keyAuctionRecoveryMeso,
    remainingBlackPaybackMaplePoints,
    remainingBlackPaybackMesoEquivalent,
    remainingBlackAuctionRecoveryMeso,
    remainingTradeableBlackPaybackMaplePoints:
      tradeableBlackLedger.paybackMaplePoints,
    remainingTradeableBlackAuctionRecoveryMeso:
      tradeableBlackLedger.auctionRecoveryMeso,
    remainingTradeableWonderBlackRecoveryMeso:
      tradeableBlackLedger.recoveryMeso,
    remainingUntradeableBlackPaybackMaplePoints:
      0,
    remainingUntradeableBlackPaybackMesoEquivalent: 0,
    remainingUntradeableWonderBlackRecoveryMeso:
      0,
    remainingWonderBlackRecoveryMeso,
    remainingSweetPaybackMaplePoints:
      remainingSweetLedger.paybackMaplePoints,
    remainingSweetPaybackMesoEquivalent:
      remainingSweetLedger.paybackMesoEquivalent,
    remainingSweetAuctionRecoveryMeso:
      remainingSweetLedger.auctionRecoveryMeso,
    remainingSweetRecoveryMeso:
      remainingSweetLedger.recoveryMeso,
    totalPetPaybackMaplePoints,
    totalAuctionRecoveryMeso,
    recoveryMesoEquivalent,
    totalRecoveryMesoEquivalent: recoveryMesoEquivalent,
    grossMesoEquivalent,
    netMesoEquivalent,
    costConversionBasis: currency.costConversionBasis,
    conversionToMeso: costToMeso,
    maplePointToMeso: currency.maplePointToMeso,
    wonToMeso: currency.wonToMeso,
    cashToMeso: costToMeso,
    remainingWonderBlackAuctionMesoValue,
    netMesoEquivalentAfterRemainingBlackSale: netMesoEquivalent,
    netMesoEquivalentAfterRemainingInventoryRecovery:
      netMesoEquivalent,
  };
  const recovery = {
    paybackPointsPerPet: PET_PAYBACK_POINTS,
    paybackMesoPerPet: paybackMeso,
    totalPetPaybackMaplePoints,
    totalAuctionRecoveryMeso,
    recoveryMesoEquivalent,
    dreamMesoPerPet: dreamLedger.recoveryMesoPerPet,
    dreamMethod: dreamLedger.method,
    dreamPaybackMaplePoints: dreamLedger.paybackMaplePoints,
    dreamPaybackMesoEquivalent: dreamLedger.paybackMesoEquivalent,
    dreamAuctionGrossMeso: lunaDreamAuctionMesoPrice,
    dreamAuctionNetMeso: dreamLedger.auctionNetMesoPerPet,
    dreamAuctionRecoveryMeso: dreamLedger.auctionRecoveryMeso,
    dreamAuctionSaleApplicable: dreamLedger.auctionSaleApplicable,
    dreamAuctionSaleApplied: dreamLedger.auctionSaleApplied,
    dreamAuctionSaleNonApplicationReason:
      dreamLedger.auctionSaleNonApplicationReason,
    keyMesoPerItem: keyAuctionSaleApplicable
      ? keyAuctionNetMeso
      : 0,
    keyAuctionGrossMeso: lunaKeyAuctionMesoPrice,
    keyAuctionNetMeso,
    keyAuctionRecoveryMeso,
    keyAuctionSaleApplicable,
    keyAuctionSaleApplied,
    keyAuctionSaleNonApplicationReason: keyAuctionSaleApplied
      ? null
      : expected.lunaKeys <= 0
        ? "no-expected-output"
        : "auction-price-not-provided",
    remainingBlackMethod: "source-specific",
    remainingTradeableBlackMethod: tradeableBlackLedger.method,
    remainingUntradeableBlackMethod: "keep",
    remainingBlackPaybackMaplePoints,
    remainingBlackPaybackMesoEquivalent,
    remainingBlackAuctionRecoveryMeso,
    remainingBlackRecoveryMeso: remainingWonderBlackRecoveryMeso,
    remainingTradeableBlackAuctionSaleApplicable:
      tradeableBlackLedger.auctionSaleApplicable,
    remainingTradeableBlackAuctionSaleApplied:
      tradeableBlackLedger.auctionSaleApplied,
    remainingTradeableBlackAuctionSaleNonApplicationReason:
      tradeableBlackLedger.auctionSaleNonApplicationReason,
    remainingUntradeableBlackAuctionSaleApplicable: false,
    remainingUntradeableBlackAuctionSaleApplied: false,
    remainingUntradeableBlackAuctionSaleNonApplicationReason:
      (expected.remainingUntradeableWonderBlacks ?? 0) > 0
        ? "inventory-kept"
        : "no-expected-output",
    remainingSweetMethod: remainingSweetLedger.method,
    remainingSweetPaybackMaplePoints:
      remainingSweetLedger.paybackMaplePoints,
    remainingSweetPaybackMesoEquivalent:
      remainingSweetLedger.paybackMesoEquivalent,
    remainingSweetAuctionRecoveryMeso:
      remainingSweetLedger.auctionRecoveryMeso,
    remainingSweetRecoveryMeso:
      remainingSweetLedger.recoveryMeso,
    remainingSweetAuctionSaleApplicable:
      remainingSweetLedger.auctionSaleApplicable,
    remainingSweetAuctionSaleApplied:
      remainingSweetLedger.auctionSaleApplied,
    remainingSweetAuctionSaleNonApplicationReason:
      remainingSweetLedger.auctionSaleNonApplicationReason,
    outputTradeability: "tradeable-once",
    auctionFeeRate,
  };
  const procurement = {
    selectedProcurement: "hybrid-bundle",
    purchaseUnitLabel: "묶음",
    purchaseUnitSize,
    expectedPurchaseUnits: expected.purchasedBundles,
    expectedMaplePointBundles: expected.purchasedMaplePointBundles,
    expectedAuctionBundles:
      expected.purchasedAuctionWonderBerryBundles,
    expectedOpenedWonderBerries: expected.openedWonderBerries,
    suppliedWonderBerries: expected.openedWonderBerries,
    unopenedWonderBerries: 0,
    selectionBasis: "net-meso-after-recovery",
    policy: "tradeable-base-on-demand",
    sourceBreakdown,
    components: sourceBreakdown,
    tradeability,
    costs: {
      bundleMaplePoints: berryMaplePoints,
      auctionBundleMeso: wonderBerryAuctionBundleMeso,
      mesoEquivalent: berryProcurementMesoEquivalent,
      netTotalMesoEquivalent: netMesoEquivalent,
    },
  };
  const kernel = getHybridWonderBerryBundleKernel({
    targetCount,
    wonderBlackEvent,
    bundleSize: purchaseUnitSize,
  });
  const checkpoints = [0.5, 0.9, 0.95].map((chance) => {
    const purchaseUnits = bundleCountForTargetChance(kernel, chance);
    return {
      chance,
      bundles: purchaseUnits,
      purchaseUnits,
      purchaseUnitLabel: "묶음",
      actualChance: probabilityWithinBundleKernel(
        kernel,
        purchaseUnits,
      ),
    };
  });

  return {
    selectedProcurement: "hybrid-bundle",
    purchaseUnitLabel: "묶음",
    purchaseUnitSize,
    expected,
    remainingHybridInventoryDistribution,
    costs,
    recovery,
    procurement,
    policy: {
      bundleSize: purchaseUnitSize,
      purchaseUnitSize,
      purchaseUnitLabel: "묶음",
      selectedProcurement: "hybrid-bundle",
      procurementPolicy: "tradeable-base-on-demand",
      auctionBlackRole: "tradeable-base",
      maplePointBlackRole: "untradeable-material",
      pendingSweetFirst: true,
      stopAtTarget: true,
      openEntireBundle: true,
      openEntirePurchaseUnit: true,
      keepRemainingWonderBlacks: true,
      preserveUnopenedWonderBerries: false,
    },
    checkpoints,
  };
}

function summarizeWonderBerryStrategy(strategy) {
  return {
    selectedProcurement: strategy.selectedProcurement,
    purchaseUnitLabel: strategy.purchaseUnitLabel,
    purchaseUnitSize: strategy.purchaseUnitSize,
    expectedPurchaseUnits: strategy.expected.purchasedUnits,
    expectedOpenedWonderBerries:
      strategy.expected.openedWonderBerries,
    berryProcurementMesoEquivalent:
      strategy.costs.berryProcurementMesoEquivalent,
    netMesoEquivalentAfterRecovery:
      strategy.costs.netMesoEquivalentAfterRemainingBlackSale,
    tradeability: strategy.procurement.tradeability,
    sourceBreakdown: strategy.procurement.sourceBreakdown ?? null,
  };
}

function selectWonderBerryEvaluationStrategy({
  procurementMode,
  maplePointBundle,
  auctionBundle,
  hybridBundle = null,
  tradeableOutputRequired = false,
}) {
  if (tradeableOutputRequired) {
    if (procurementMode === "maple-point-bundle") {
      throw new RangeError(
        "교환 가능한 합성 결과에는 메포 원더베리 단독 조달을 선택할 수 없습니다.",
      );
    }
    if (procurementMode === "auction-bundle") {
      if (!auctionBundle) {
        throw new RangeError(
          "교환 가능한 합성 결과를 계산하려면 원더베리 11개 묶음 경매장 시세가 필요합니다.",
        );
      }
      return auctionBundle;
    }
    if (procurementMode === "hybrid-bundle") {
      if (!hybridBundle) {
        throw new RangeError(
          "해당 조건에서는 하이브리드 교가 경로를 계산할 수 없습니다.",
        );
      }
      return hybridBundle;
    }
    const tradeableCandidates = [auctionBundle, hybridBundle]
      .filter(Boolean);
    if (tradeableCandidates.length === 0) {
      throw new RangeError(
        "교환 가능한 합성 결과를 계산하려면 원더베리 11개 묶음 경매장 시세가 필요합니다.",
      );
    }
    return tradeableCandidates.reduce((best, candidate) =>
      candidate.costs.netMesoEquivalentAfterRemainingBlackSale <
          best.costs.netMesoEquivalentAfterRemainingBlackSale
        ? candidate
        : best
    );
  }
  if (procurementMode === "maple-point-bundle") {
    return maplePointBundle;
  }
  if (procurementMode === "auction-bundle") {
    return auctionBundle;
  }
  if (procurementMode === "hybrid-bundle") {
    return hybridBundle;
  }
  return [maplePointBundle, auctionBundle, hybridBundle]
    .filter(Boolean)
    .reduce((best, candidate) =>
      candidate.costs.netMesoEquivalentAfterRemainingBlackSale <
        best.costs.netMesoEquivalentAfterRemainingBlackSale
        ? candidate
        : best
    );
}

function selectCappedWonderBerryEvaluationStrategy({
  procurementMode,
  maplePointBundle,
  auctionBundle,
  hybridBundle,
  directEvaluation,
  hybridEvaluation,
  tradeableOutputRequired,
}) {
  if (procurementMode !== "cheapest") {
    return selectWonderBerryEvaluationStrategy({
      procurementMode,
      maplePointBundle,
      auctionBundle,
      hybridBundle,
      tradeableOutputRequired,
    });
  }

  const directChance = directEvaluation.actualChance;
  const candidates = [];
  if (!tradeableOutputRequired) {
    candidates.push({
      strategy: maplePointBundle,
      actualChance: directChance,
    });
  }
  if (auctionBundle) {
    candidates.push({
      strategy: auctionBundle,
      actualChance: directChance,
    });
  }
  if (hybridBundle && hybridEvaluation) {
    candidates.push({
      strategy: hybridBundle,
      actualChance: hybridEvaluation.actualChance,
    });
  }
  if (candidates.length === 0) {
    return selectWonderBerryEvaluationStrategy({
      procurementMode,
      maplePointBundle,
      auctionBundle,
      hybridBundle,
      tradeableOutputRequired,
    });
  }

  // 같은 구매 상한에서는 목표 달성 가능성이 우선이다. 확률이 사실상
  // 같은 후보끼리만 부산물 회수 후 순비용으로 순위를 정한다.
  const chanceEpsilon = 1e-12;
  return candidates.reduce((best, candidate) => {
    const chanceDifference =
      candidate.actualChance - best.actualChance;
    if (chanceDifference > chanceEpsilon) return candidate;
    if (Math.abs(chanceDifference) > chanceEpsilon) return best;
    return candidate.strategy.costs
      .netMesoEquivalentAfterRemainingBlackSale <
        best.strategy.costs.netMesoEquivalentAfterRemainingBlackSale
      ? candidate
      : best;
  }).strategy;
}

function wonderBerryStrategyComparison(
  maplePointBundle,
  auctionBundle,
  hybridBundle,
  wonderBerryBundleMaplePoints,
  currency,
  tradeableOutputRequired = false,
) {
  const maplePointSummary = summarizeWonderBerryStrategy(
    maplePointBundle,
  );
  const auctionSummary = auctionBundle
    ? summarizeWonderBerryStrategy(auctionBundle)
    : null;
  const hybridSummary = hybridBundle
    ? summarizeWonderBerryStrategy(hybridBundle)
    : null;
  maplePointSummary.eligibleForSelection = !tradeableOutputRequired;
  if (auctionSummary) auctionSummary.eligibleForSelection = true;
  if (hybridSummary) hybridSummary.eligibleForSelection = true;
  return {
    tradeableOutputRequired,
    selectionConstraint: tradeableOutputRequired
      ? "tradeable-output-only"
      : "none",
    maplePointBundle: maplePointSummary,
    auctionBundle: auctionSummary,
    hybridBundle: hybridSummary,
    auctionBundleBreakEvenMeso:
      wonderBerryBundleMaplePoints * currency.maplePointToMeso,
  };
}

/**
 * 캐시샵 메포 묶음, 경매장 메소 묶음, 경매장산 교가 블랙을
 * 베이스로 두고 메포산 교불 블랙을 재료로 쓰는 하이브리드의
 * 11개 전량 개봉 전략을 각각 계산한다. 조달처별 교환 가능 여부와
 * 잔여 산출물 회수까지 포함한 순비용이 가장 싼 후보를 선택한다.
 */
export function calculateWonderBerryBundleExpectation(options = {}) {
  const { targetCount, bundleSize } = validateBundleInputs(
    options.targetCount ?? 1,
    options.wonderBerryBundleSize ?? 11,
  );
  const wonderBlackEvent = resolveWonderBlackEvent(options);
  const wonderBerryBundleMaplePoints = finiteNonNegative(
    options.wonderBerryBundleMaplePoints ??
      options.wonderBerryBundlePrice ??
      54_000,
    "원더베리 묶음 가격",
  );
  const wonderBerryAuctionBundleMesoPrice = finiteNonNegative(
    options.wonderBerryAuctionBundleMesoPrice ?? 0,
    "원더베리 11개 묶음 경매장 시세",
  );
  const tradeableOutputRequired =
    options.tradeableOutputRequired === true;
  if (
    tradeableOutputRequired &&
    !(wonderBerryAuctionBundleMesoPrice > 0)
  ) {
    throw new RangeError(
      "교환 가능한 합성 결과를 계산하려면 원더베리 11개 묶음 경매장 시세가 필요합니다.",
    );
  }
  const procurementMode = resolveWonderBerryProcurementMode(
    options,
    wonderBerryAuctionBundleMesoPrice,
  );
  const lunaCrystalMaplePoints = finiteNonNegative(
    options.lunaCrystalMaplePoints ?? options.lunaCrystalPrice ?? 3_900,
    "루나 크리스탈 가격",
  );
  const wonderBlackMesoPrice = finiteNonNegative(
    options.wonderBlackMesoPrice ?? 0,
    "원더 블랙 시세",
  );
  const currency = resolveCostConversion(options);
  const lunaDreamAuctionMesoPrice = finiteNonNegative(
    options.lunaDreamAuctionMesoPrice ?? options.lunaDreamMesoRecovery ?? 0,
    "루나 드림 경매장 시세",
  );
  const lunaSweetAuctionMesoPrice = finiteNonNegative(
    options.lunaSweetAuctionMesoPrice ?? 0,
    "루나 스윗 경매장 시세",
  );
  const lunaKeyAuctionMesoPrice = finiteNonNegative(
    options.lunaKeyAuctionMesoPrice ?? options.lunaKeyMesoRecovery ?? 0,
    "루나 크리스탈 키 경매장 시세",
  );
  const auctionFeeRate = Number(options.auctionFeeRate ?? 0.05);
  if (!AUCTION_FEE_RATES.has(auctionFeeRate)) {
    throw new RangeError("경매장 판매 수수료는 3% 또는 5%여야 합니다.");
  }
  const common = {
    targetCount,
    wonderBlackEvent,
    maplePointBundleSize: bundleSize,
    wonderBerryBundleMaplePoints,
    wonderBerryAuctionBundleMesoPrice,
    lunaCrystalMaplePoints,
    wonderBlackMesoPrice,
    lunaDreamAuctionMesoPrice,
    lunaSweetAuctionMesoPrice,
    lunaKeyAuctionMesoPrice,
    auctionFeeRate,
    currency,
  };
  const directKernel = getWonderBerryBundleKernel({
    targetCount,
    wonderBlackEvent,
    bundleSize,
  });
  const directSolution = solveUnlimitedBundleKernel(directKernel);
  const direct = buildWonderBerryStrategy({
    ...common,
    selectedProcurement: "maple-point-bundle",
    purchaseUnitSize: bundleSize,
    rawExpected: directSolution.expected,
    remainingWonderBlackDistribution:
      directSolution.remainingWonderBlackDistribution,
  });
  const auctionBundle = wonderBerryAuctionBundleMesoPrice > 0
    ? buildWonderBerryStrategy({
      ...common,
      selectedProcurement: "auction-bundle",
      purchaseUnitSize: bundleSize,
      rawExpected: directSolution.expected,
      remainingWonderBlackDistribution:
        directSolution.remainingWonderBlackDistribution,
    })
    : null;
  const hybridBundle = wonderBerryAuctionBundleMesoPrice > 0
    ? (() => {
      const hybridKernel = getHybridWonderBerryBundleKernel({
        targetCount,
        wonderBlackEvent,
        bundleSize,
      });
      const hybridSolution =
        getUnlimitedHybridBundleSolution(hybridKernel);
      return buildHybridWonderBerryStrategy({
        ...common,
        purchaseUnitSize: bundleSize,
        rawExpected: hybridSolution.expected,
        remainingHybridInventoryDistribution:
          hybridSolution.remainingHybridInventoryDistribution,
      });
    })()
    : null;
  const selected = selectWonderBerryEvaluationStrategy({
    procurementMode,
    maplePointBundle: direct,
    auctionBundle,
    hybridBundle,
    tradeableOutputRequired,
  });
  const comparison = wonderBerryStrategyComparison(
    direct,
    auctionBundle,
    hybridBundle,
    wonderBerryBundleMaplePoints,
    currency,
    tradeableOutputRequired,
  );
  const wonderBerryProcurement = {
    ...selected.procurement,
    mode: procurementMode,
    tradeableOutputRequired,
    selectionConstraint: tradeableOutputRequired
      ? "tradeable-output-only"
      : "none",
    comparison,
  };

  return {
    applicable: true,
    targetCount,
    wonderBlackEvent,
    tradeableOutputRequired,
    scope: selected.selectedProcurement === "auction-bundle"
      ? "wonderberry-auction-bundle"
      : selected.selectedProcurement === "hybrid-bundle"
        ? "wonderberry-hybrid-bundle"
        : "wonderberry-only",
    costConversionBasis: currency.costConversionBasis,
    selectedProcurement: selected.selectedProcurement,
    purchaseUnitLabel: selected.purchaseUnitLabel,
    purchaseUnitSize: selected.purchaseUnitSize,
    policy: {
      ...selected.policy,
      tradeableOutputRequired,
    },
    probabilities: {
      wonderBlack: getWonderBlackProbability(wonderBlackEvent),
      routeSuccess: getPetiteRouteProbability(),
    },
    currency,
    expected: selected.expected,
    remainingWonderBlackDistribution:
      selected.remainingWonderBlackDistribution ?? null,
    remainingHybridInventoryDistribution:
      selected.remainingHybridInventoryDistribution ?? null,
    costs: selected.costs,
    recovery: selected.recovery,
    procurement: wonderBerryProcurement,
    wonderBerryProcurement,
    checkpoints: selected.checkpoints,
  };
}

/**
 * 목표를 정확히 completionBundle번째 묶음에서 처음 달성한 이용자
 * (T=N)의 조건부 누적 재료와 비용을 계산한다.
 *
 * 목표 확률 분위수에서 찾은 정수 묶음 N을 넘기면, "N묶음 이내에
 * 성공하는 사람의 평균"이 아니라 바로 그 당첨선에 걸린 이용자의
 * 기대 지출을 얻는다.
 */
export function calculateWonderBerryBundleCompletionExpectation(
  options = {},
) {
  const completionBundle = positiveInteger(
    options.completionBundle ?? options.bundles,
    "목표 달성 묶음 수",
  );
  if (completionBundle > 100_000) {
    throw new RangeError("목표 달성 묶음 수는 100,000 이하여야 합니다.");
  }
  const templateOptions = Object.fromEntries(
    Object.entries(options).filter(
      ([key]) => key !== "completionBundle" && key !== "bundles",
    ),
  );
  const template = calculateWonderBerryBundleExpectation(templateOptions);
  const kernel = getWonderBerryBundleKernel({
    targetCount: template.targetCount,
    wonderBlackEvent: template.wonderBlackEvent,
    bundleSize: template.policy.bundleSize,
  });
  const evaluation = evaluateCachedBundleCompletionKernel(
    kernel,
    completionBundle,
  );
  const wonderBlackMesoPrice = finiteNonNegative(
    options.wonderBlackMesoPrice ?? 0,
    "원더 블랙 시세",
  );
  const lunaDreamAuctionMesoPrice = finiteNonNegative(
    options.lunaDreamAuctionMesoPrice ??
      options.lunaDreamMesoRecovery ??
      0,
    "루나 드림 경매장 시세",
  );
  const lunaSweetAuctionMesoPrice = finiteNonNegative(
    options.lunaSweetAuctionMesoPrice ?? 0,
    "루나 스윗 경매장 시세",
  );
  const lunaKeyAuctionMesoPrice = finiteNonNegative(
    options.lunaKeyAuctionMesoPrice ??
      options.lunaKeyMesoRecovery ??
      0,
    "루나 크리스탈 키 경매장 시세",
  );
  const common = {
    targetCount: template.targetCount,
    wonderBlackEvent: template.wonderBlackEvent,
    purchaseUnitSize: template.purchaseUnitSize,
    maplePointBundleSize: template.policy.maplePointBundleSize,
    rawExpected: evaluation.expected,
    remainingWonderBlackDistribution:
      evaluation.remainingWonderBlackDistribution,
    wonderBerryBundleMaplePoints:
      template.costs.wonderBerryBundleMaplePoints,
    wonderBerryAuctionBundleMesoPrice:
      template.costs.wonderBerryAuctionBundleMesoPrice,
    lunaCrystalMaplePoints: template.costs.lunaCrystalMaplePoints,
    wonderBlackMesoPrice,
    lunaDreamAuctionMesoPrice,
    lunaSweetAuctionMesoPrice,
    lunaKeyAuctionMesoPrice,
    auctionFeeRate: template.recovery.auctionFeeRate,
    currency: template.currency,
  };
  const maplePointBundle = buildWonderBerryStrategy({
    ...common,
    selectedProcurement: "maple-point-bundle",
  });
  const auctionBundle =
    template.costs.wonderBerryAuctionBundleMesoPrice > 0
      ? buildWonderBerryStrategy({
        ...common,
        selectedProcurement: "auction-bundle",
      })
      : null;
  const hybridKernel =
    template.costs.wonderBerryAuctionBundleMesoPrice > 0
      ? getHybridWonderBerryBundleKernel({
        targetCount: template.targetCount,
        wonderBlackEvent: template.wonderBlackEvent,
        bundleSize: template.purchaseUnitSize,
      })
      : null;
  const hybridCompletionProbability = hybridKernel
    ? probabilityWithinBundleKernel(hybridKernel, completionBundle) -
      probabilityWithinBundleKernel(hybridKernel, completionBundle - 1)
    : 0;
  const hybridEvaluation = hybridCompletionProbability > 1e-15
    ? evaluateCachedHybridBundleCompletionKernel(
      hybridKernel,
      completionBundle,
    )
    : null;
  const hybridBundle = hybridEvaluation
    ? buildHybridWonderBerryStrategy({
      targetCount: template.targetCount,
      wonderBlackEvent: template.wonderBlackEvent,
      purchaseUnitSize: template.purchaseUnitSize,
      rawExpected: hybridEvaluation.expected,
      remainingHybridInventoryDistribution:
        hybridEvaluation.remainingHybridInventoryDistribution,
      wonderBerryBundleMaplePoints:
        template.costs.wonderBerryBundleMaplePoints,
      wonderBerryAuctionBundleMesoPrice:
        template.costs.wonderBerryAuctionBundleMesoPrice,
      lunaCrystalMaplePoints:
        template.costs.lunaCrystalMaplePoints,
      wonderBlackMesoPrice,
      lunaDreamAuctionMesoPrice,
      lunaSweetAuctionMesoPrice,
      lunaKeyAuctionMesoPrice,
      auctionFeeRate: template.recovery.auctionFeeRate,
      currency: template.currency,
    })
    : null;
  if (
    template.wonderBerryProcurement.mode === "hybrid-bundle" &&
    !hybridBundle
  ) {
    throw new RangeError(
      "해당 묶음에서는 하이브리드 목표를 처음 달성할 수 없습니다.",
    );
  }
  const strategy = selectWonderBerryEvaluationStrategy({
    procurementMode: template.wonderBerryProcurement.mode,
    maplePointBundle,
    auctionBundle,
    hybridBundle,
    tradeableOutputRequired: template.tradeableOutputRequired,
  });
  const comparison = wonderBerryStrategyComparison(
    maplePointBundle,
    auctionBundle,
    hybridBundle,
    template.costs.wonderBerryBundleMaplePoints,
    template.currency,
    template.tradeableOutputRequired,
  );
  const selectedEvaluation = strategy.selectedProcurement === "hybrid-bundle"
    ? hybridEvaluation
    : evaluation;
  const wonderBerryProcurement = {
    ...strategy.procurement,
    mode: template.wonderBerryProcurement.mode,
    tradeableOutputRequired: template.tradeableOutputRequired,
    selectionConstraint: template.tradeableOutputRequired
      ? "tradeable-output-only"
      : "none",
    comparison,
  };

  return {
    ...template,
    scope: "wonderberry-completion-bundle",
    selectedProcurement: strategy.selectedProcurement,
    completionBundle,
    completionPurchaseUnit: completionBundle,
    completionWonderBerry: null,
    completionUnitKind: "bundle",
    purchaseUnitLabel: strategy.purchaseUnitLabel,
    purchaseUnitSize: strategy.purchaseUnitSize,
    completionProbability: selectedEvaluation.completionProbability,
    cumulativeChanceBefore: selectedEvaluation.cumulativeChanceBefore,
    cumulativeChance: selectedEvaluation.cumulativeChance,
    survivalProbabilityBefore:
      selectedEvaluation.survivalProbabilityBefore,
    policy: {
      ...strategy.policy,
      condition: "completion-at-bundle",
      completionBundle,
      completionPurchaseUnit: completionBundle,
      completionWonderBerry: null,
      completionUnitKind: "bundle",
    },
    probabilities: {
      ...template.probabilities,
      completionAtBundle: selectedEvaluation.completionProbability,
      completionAtPurchaseUnit: selectedEvaluation.completionProbability,
      cumulativeBeforeBundle: selectedEvaluation.cumulativeChanceBefore,
      cumulativeBeforePurchaseUnit:
        selectedEvaluation.cumulativeChanceBefore,
      cumulativeAtBundle: selectedEvaluation.cumulativeChance,
      cumulativeAtPurchaseUnit: selectedEvaluation.cumulativeChance,
      survivalBeforeBundle:
        selectedEvaluation.survivalProbabilityBefore,
      survivalBeforePurchaseUnit:
        selectedEvaluation.survivalProbabilityBefore,
    },
    expected: strategy.expected,
    remainingWonderBlackDistribution:
      strategy.selectedProcurement === "hybrid-bundle"
        ? null
        : evaluation.remainingWonderBlackDistribution,
    remainingHybridInventoryDistribution:
      strategy.selectedProcurement === "hybrid-bundle"
        ? hybridEvaluation.remainingHybridInventoryDistribution
        : null,
    completionRemainingWonderBlackDistribution:
      strategy.selectedProcurement === "hybrid-bundle"
        ? null
        : evaluation.completionRemainingWonderBlackDistribution,
    completionRemainingHybridInventoryDistribution:
      strategy.selectedProcurement === "hybrid-bundle"
        ? hybridEvaluation.completionRemainingHybridInventoryDistribution
        : null,
    costs: strategy.costs,
    recovery: strategy.recovery,
    procurement: wonderBerryProcurement,
    wonderBerryProcurement,
    completion: {
      bundle: completionBundle,
      purchaseUnit: completionBundle,
      wonderBerries: null,
      unitKind: "bundle",
      purchaseUnitLabel: strategy.purchaseUnitLabel,
      purchaseUnitSize: strategy.purchaseUnitSize,
      probability: selectedEvaluation.completionProbability,
      cumulativeChanceBefore: selectedEvaluation.cumulativeChanceBefore,
      cumulativeChance: selectedEvaluation.cumulativeChance,
      survivalProbabilityBefore:
        selectedEvaluation.survivalProbabilityBefore,
    },
  };
}

/**
 * 원더베리 묶음을 한 묶음씩 구매하며 목표 달성 즉시 멈추고,
 * 달성하지 못하면 maxBundles에서 멈추는 정책의 정확한 기대값.
 * 몬테카를로가 아니라 묶음 경계 마르코프 커널을 유한 횟수만큼
 * 전파한다.
 */
export function calculateCappedWonderBerryBundleExpectation(options = {}) {
  const maxBundles = nonNegativeInteger(
    options.maxBundles ?? options.maximumBundles ?? 0,
    "최대 원더베리 묶음 수",
  );
  const uncappedOptions = Object.fromEntries(
    Object.entries(options).filter(
      ([key]) => key !== "maxBundles" && key !== "maximumBundles",
    ),
  );
  // 입력 검증과 환율·회수 정책을 무제한 묶음 계산과 공유한다.
  const template = calculateWonderBerryBundleExpectation(uncappedOptions);
  const kernel = getWonderBerryBundleKernel({
    targetCount: template.targetCount,
    wonderBlackEvent: template.wonderBlackEvent,
    bundleSize: template.policy.bundleSize,
  });
  const evaluation = evaluateCappedBundleKernel(kernel, maxBundles);
  const wonderBlackMesoPrice = finiteNonNegative(
    options.wonderBlackMesoPrice ?? 0,
    "원더 블랙 시세",
  );
  const lunaDreamAuctionMesoPrice = finiteNonNegative(
    options.lunaDreamAuctionMesoPrice ??
      options.lunaDreamMesoRecovery ??
      0,
    "루나 드림 경매장 시세",
  );
  const lunaSweetAuctionMesoPrice = finiteNonNegative(
    options.lunaSweetAuctionMesoPrice ?? 0,
    "루나 스윗 경매장 시세",
  );
  const lunaKeyAuctionMesoPrice = finiteNonNegative(
    options.lunaKeyAuctionMesoPrice ??
      options.lunaKeyMesoRecovery ??
      0,
    "루나 크리스탈 키 경매장 시세",
  );
  const common = {
    targetCount: template.targetCount,
    wonderBlackEvent: template.wonderBlackEvent,
    purchaseUnitSize: template.purchaseUnitSize,
    maplePointBundleSize: template.policy.maplePointBundleSize,
    rawExpected: evaluation.expected,
    remainingWonderBlackDistribution:
      evaluation.remainingWonderBlackDistribution,
    wonderBerryBundleMaplePoints:
      template.costs.wonderBerryBundleMaplePoints,
    wonderBerryAuctionBundleMesoPrice:
      template.costs.wonderBerryAuctionBundleMesoPrice,
    lunaCrystalMaplePoints: template.costs.lunaCrystalMaplePoints,
    wonderBlackMesoPrice,
    lunaDreamAuctionMesoPrice,
    lunaSweetAuctionMesoPrice,
    lunaKeyAuctionMesoPrice,
    auctionFeeRate: template.recovery.auctionFeeRate,
    currency: template.currency,
  };
  const maplePointBundle = buildWonderBerryStrategy({
    ...common,
    selectedProcurement: "maple-point-bundle",
  });
  const auctionBundle =
    template.costs.wonderBerryAuctionBundleMesoPrice > 0
      ? buildWonderBerryStrategy({
        ...common,
        selectedProcurement: "auction-bundle",
      })
      : null;
  const hybridKernel =
    template.costs.wonderBerryAuctionBundleMesoPrice > 0
      ? getHybridWonderBerryBundleKernel({
        targetCount: template.targetCount,
        wonderBlackEvent: template.wonderBlackEvent,
        bundleSize: template.purchaseUnitSize,
      })
      : null;
  const hybridEvaluation = hybridKernel
    ? evaluateHybridCappedBundleKernel(hybridKernel, maxBundles)
    : null;
  const hybridBundle = hybridEvaluation
    ? buildHybridWonderBerryStrategy({
      targetCount: template.targetCount,
      wonderBlackEvent: template.wonderBlackEvent,
      purchaseUnitSize: template.purchaseUnitSize,
      rawExpected: hybridEvaluation.expected,
      remainingHybridInventoryDistribution:
        hybridEvaluation.remainingHybridInventoryDistribution,
      wonderBerryBundleMaplePoints:
        template.costs.wonderBerryBundleMaplePoints,
      wonderBerryAuctionBundleMesoPrice:
        template.costs.wonderBerryAuctionBundleMesoPrice,
      lunaCrystalMaplePoints:
        template.costs.lunaCrystalMaplePoints,
      wonderBlackMesoPrice,
      lunaDreamAuctionMesoPrice,
      lunaSweetAuctionMesoPrice,
      lunaKeyAuctionMesoPrice,
      auctionFeeRate: template.recovery.auctionFeeRate,
      currency: template.currency,
    })
    : null;
  const strategy = selectCappedWonderBerryEvaluationStrategy({
    procurementMode: template.wonderBerryProcurement.mode,
    maplePointBundle,
    auctionBundle,
    hybridBundle,
    directEvaluation: evaluation,
    hybridEvaluation,
    tradeableOutputRequired: template.tradeableOutputRequired,
  });
  const comparison = wonderBerryStrategyComparison(
    maplePointBundle,
    auctionBundle,
    hybridBundle,
    template.costs.wonderBerryBundleMaplePoints,
    template.currency,
    template.tradeableOutputRequired,
  );
  comparison.selectionBasis =
    template.wonderBerryProcurement.mode === "cheapest"
      ? "maximum-success-probability-then-net-meso-after-recovery"
      : "explicit-procurement-mode";
  comparison.maplePointBundle.actualChance = evaluation.actualChance;
  if (comparison.auctionBundle) {
    comparison.auctionBundle.actualChance = evaluation.actualChance;
  }
  if (comparison.hybridBundle && hybridEvaluation) {
    comparison.hybridBundle.actualChance =
      hybridEvaluation.actualChance;
  }
  const selectedEvaluation = strategy.selectedProcurement === "hybrid-bundle"
    ? hybridEvaluation
    : evaluation;
  const wonderBerryProcurement = {
    ...strategy.procurement,
    mode: template.wonderBerryProcurement.mode,
    selectionBasis: comparison.selectionBasis,
    tradeableOutputRequired: template.tradeableOutputRequired,
    selectionConstraint: template.tradeableOutputRequired
      ? "tradeable-output-only"
      : "none",
    comparison,
  };

  return {
    ...template,
    scope: "wonderberry-capped",
    selectedProcurement: strategy.selectedProcurement,
    maxBundles,
    maximumBundles: maxBundles,
    maxPurchaseUnits: maxBundles,
    maximumPurchaseUnits: maxBundles,
    purchaseUnitLabel: strategy.purchaseUnitLabel,
    purchaseUnitSize: strategy.purchaseUnitSize,
    actualChance: selectedEvaluation.actualChance,
    successProbability: selectedEvaluation.actualChance,
    failureProbability: selectedEvaluation.failureProbability,
    policy: {
      ...strategy.policy,
      capped: true,
      maxBundles,
      maximumBundles: maxBundles,
      maxPurchaseUnits: maxBundles,
      maximumPurchaseUnits: maxBundles,
      stopAtCap: true,
    },
    probabilities: {
      ...template.probabilities,
      actualChance: selectedEvaluation.actualChance,
      success: selectedEvaluation.actualChance,
      failure: selectedEvaluation.failureProbability,
    },
    expected: strategy.expected,
    remainingWonderBlackDistribution:
      strategy.selectedProcurement === "hybrid-bundle"
        ? null
        : evaluation.remainingWonderBlackDistribution,
    remainingHybridInventoryDistribution:
      strategy.selectedProcurement === "hybrid-bundle"
        ? hybridEvaluation.remainingHybridInventoryDistribution
        : null,
    successfulRemainingWonderBlackDistribution:
      strategy.selectedProcurement === "hybrid-bundle"
        ? null
        : evaluation.successfulRemainingWonderBlackDistribution,
    successfulRemainingHybridInventoryDistribution:
      strategy.selectedProcurement === "hybrid-bundle"
        ? hybridEvaluation.successfulRemainingHybridInventoryDistribution
        : null,
    failedRemainingWonderBlackDistribution:
      strategy.selectedProcurement === "hybrid-bundle"
        ? null
        : evaluation.failedRemainingWonderBlackDistribution,
    failedRemainingHybridInventoryDistribution:
      strategy.selectedProcurement === "hybrid-bundle"
        ? hybridEvaluation.failedRemainingHybridInventoryDistribution
        : null,
    failedInventoryDistribution:
      selectedEvaluation.failedInventoryDistribution,
    costs: strategy.costs,
    recovery: strategy.recovery,
    procurement: wonderBerryProcurement,
    wonderBerryProcurement,
    targetChance: {
      maxBundles,
      maxPurchaseUnits: maxBundles,
      purchaseUnitLabel: strategy.purchaseUnitLabel,
      purchaseUnitSize: strategy.purchaseUnitSize,
      actualChance: selectedEvaluation.actualChance,
      successProbability: selectedEvaluation.actualChance,
      failureProbability: selectedEvaluation.failureProbability,
    },
    progression: selectedEvaluation.progression,
  };
}

/**
 * @param {object} options
 * @param {1|2|3} [options.targetCount=1] 목표 루나 쁘띠 마릿수
 * @param {boolean} [options.wonderBlackEvent=false] 원더 블랙 확률 증가 기간
 * @param {'wonderberry'|'auction'|'cheapest'} [options.sourceMode='cheapest']
 * @param {number} [options.wonderBerryBundleMaplePoints=54000] 묶음 가격(메이플포인트)
 * @param {number} [options.wonderBerryBundlePrice] 묶음 가격의 기존 별칭
 * @param {number} [options.wonderBerryBundleSize=11] 묶음 사용 횟수
 * @param {number} [options.wonderBerryAuctionBundleMesoPrice=0] 원더베리 11개 묶음 경매장 매수가(메소)
 * @param {'cheapest'|'maple-point-bundle'|'auction-bundle'|'hybrid-bundle'} [options.wonderBerryProcurementMode='cheapest']
 * @param {boolean} [options.tradeableOutputRequired=false] 교환 가능한 합성 결과만 자동 선택
 * @param {number} [options.lunaCrystalMaplePoints=3900] 크리스탈 1개 가격(메이플포인트)
 * @param {number} [options.lunaCrystalPrice] 크리스탈 가격의 기존 별칭
 * @param {number} [options.wonderBlackMesoPrice=0] 블랙 1마리 경매장가(메소)
 * @param {number} [options.maplePointsPer100MillionMeso=2000] 메소마켓 환율
 * @param {number} [options.wonPer100MillionMeso] 현금 기준 1억 메소 시세
 * @param {'maple-point'|'won'} [options.costConversionBasis='maple-point'] 비용 환산 기준
 * @param {number} [options.lunaDreamAuctionMesoPrice=0] 드림 1마리 옥션 시세
 * @param {number} [options.lunaSweetAuctionMesoPrice=0] 스윗 1마리 옥션 시세
 * @param {number} [options.lunaKeyAuctionMesoPrice=0] 키 1개 옥션 시세
 * @param {0.03|0.05} [options.auctionFeeRate=0.05] 옥션 판매 수수료
 */
export function calculatePetExpectation(options = {}) {
  // 외형과 기수는 구분하지 않고 루나 쁘띠의 총 마릿수만 목표로 한다.
  const targetCount = positiveInteger(options.targetCount ?? 1, "목표 마릿수");
  if (targetCount > 3) {
    throw new RangeError("목표 마릿수는 1~3마리여야 합니다.");
  }
  const sourceMode = options.sourceMode ?? "cheapest";
  if (!SOURCE_MODES.has(sourceMode)) {
    throw new RangeError("원더 블랙 준비 방법이 올바르지 않습니다.");
  }

  const wonderBerryBundleMaplePoints = finiteNonNegative(
    options.wonderBerryBundleMaplePoints ??
      options.wonderBerryBundlePrice ??
      54_000,
    "원더베리 묶음 가격",
  );
  const wonderBerryBundlePrice = wonderBerryBundleMaplePoints;
  const wonderBerryBundleSize = finitePositive(
    options.wonderBerryBundleSize ?? 11,
    "원더베리 묶음 개수",
  );
  const wonderBerryAuctionBundleMesoPrice = finiteNonNegative(
    options.wonderBerryAuctionBundleMesoPrice ?? 0,
    "원더베리 11개 묶음 경매장 시세",
  );
  const tradeableOutputRequired =
    options.tradeableOutputRequired === true;
  const lunaCrystalMaplePoints = finiteNonNegative(
    options.lunaCrystalMaplePoints ?? options.lunaCrystalPrice ?? 3_900,
    "루나 크리스탈 가격",
  );
  const lunaCrystalPrice = lunaCrystalMaplePoints;
  const wonderBlackMesoPrice = finiteNonNegative(
    options.wonderBlackMesoPrice ?? 0,
    "원더 블랙 시세",
  );
  const currency = resolveCostConversion(options);
  const lunaDreamAuctionMesoPrice = finiteNonNegative(
    options.lunaDreamAuctionMesoPrice ?? options.lunaDreamMesoRecovery ?? 0,
    "루나 드림 경매장 시세",
  );
  const lunaSweetAuctionMesoPrice = finiteNonNegative(
    options.lunaSweetAuctionMesoPrice ?? 0,
    "루나 스윗 경매장 시세",
  );
  const lunaKeyAuctionMesoPrice = finiteNonNegative(
    options.lunaKeyAuctionMesoPrice ?? options.lunaKeyMesoRecovery ?? 0,
    "루나 크리스탈 키 경매장 시세",
  );
  const auctionFeeRate = Number(options.auctionFeeRate ?? 0.05);
  if (!AUCTION_FEE_RATES.has(auctionFeeRate)) {
    throw new RangeError("경매장 판매 수수료는 3% 또는 5%여야 합니다.");
  }

  const first = PET_PROBABILITIES.sweetSynthesis;
  const second = PET_PROBABILITIES.dreamSynthesis;
  const routeSuccessProbability = getPetiteRouteProbability();
  const wonderBlackProbability = getWonderBlackProbability(
    resolveWonderBlackEvent(options),
  );
  const wonderUpperPetProbability = getWonderUpperPetProbability(
    resolveWonderBlackEvent(options),
  );

  const routeAttempts = targetCount / routeSuccessProbability;
  const dreamSynthesisAttempts = routeAttempts * first.sweet;
  const sweetSynthesisAttempts = routeAttempts;
  const wonderBlacks = routeAttempts * 2 + dreamSynthesisAttempts;
  const lunaCrystals = routeAttempts + dreamSynthesisAttempts;
  const lunaDreams = dreamSynthesisAttempts * second.dream;
  const lunaKeys =
    sweetSynthesisAttempts * first.key +
    dreamSynthesisAttempts * second.key;
  const directPetites = sweetSynthesisAttempts * first.petite;
  const dreamRoutePetites = dreamSynthesisAttempts * second.petite;

  const unitWonderBerryPrice = wonderBerryBundlePrice / wonderBerryBundleSize;
  const berriesPerBlack = 1 / wonderBlackProbability;
  const berryGrossCashPerBlack = unitWonderBerryPrice * berriesPerBlack;
  const berryPaybackCashPerBlack =
    (wonderUpperPetProbability / wonderBlackProbability) * PET_PAYBACK_POINTS;
  const costToMeso = currency.conversionToMeso;
  // 하위 호환 별칭이다. 새 코드에서는 conversionToMeso를 사용한다.
  const cashToMeso = costToMeso;
  const berryNetMesoPerBlack =
    (berryGrossCashPerBlack - berryPaybackCashPerBlack) * costToMeso;
  const berryGrossMesoPerBlack = berryGrossCashPerBlack * costToMeso;

  if (
    !tradeableOutputRequired &&
    sourceMode === "auction" &&
    !(wonderBlackMesoPrice > 0)
  ) {
    throw new RangeError("경매장 준비를 선택했다면 원더 블랙 시세를 입력해야 합니다.");
  }

  const crystalMesoEquivalent = lunaCrystalPrice * costToMeso;
  const paybackMeso = PET_PAYBACK_POINTS * costToMeso;
  const lunaDreamAuctionNetMeso =
    lunaDreamAuctionMesoPrice * (1 - auctionFeeRate);
  const lunaKeyAuctionNetMeso =
    lunaKeyAuctionMesoPrice * (1 - auctionFeeRate);
  const tradeableDreamRecoveryMeso = Math.max(
    paybackMeso,
    lunaDreamAuctionNetMeso,
  );

  const blackPerRoute = 2 + first.sweet;
  const crystalsPerRoute = 1 + first.sweet;
  const tradeableRecoveryPerRoute =
    first.key * lunaKeyAuctionNetMeso +
    first.sweet * (
      second.dream * tradeableDreamRecoveryMeso +
      second.key * lunaKeyAuctionNetMeso
    );
  const untradeableRecoveryPerRoute =
    first.sweet * second.dream * paybackMeso;

  const bundlePurchase = calculateWonderBerryBundleExpectation({
    targetCount,
    wonderBlackEvent: resolveWonderBlackEvent(options),
    wonderBerryBundlePrice,
    wonderBerryBundleSize,
    wonderBerryAuctionBundleMesoPrice,
    wonderBerryProcurementMode:
      options.wonderBerryProcurementMode,
    tradeableOutputRequired,
    lunaCrystalPrice,
    wonderBlackMesoPrice,
    maplePointsPer100MillionMeso:
      currency.maplePointsPer100MillionMeso,
    wonPer100MillionMeso: currency.wonPer100MillionMeso,
    costConversionBasis: currency.costConversionBasis,
    lunaDreamAuctionMesoPrice,
    lunaSweetAuctionMesoPrice,
    lunaKeyAuctionMesoPrice,
    auctionFeeRate,
  });
  const directBerryResultsTradeable =
    bundlePurchase.procurement.tradeability
      ?.synthesisResultTradable === true;

  function sourceScenario(source) {
    const tradeableResults = source === "auction"
      ? false
      : directBerryResultsTradeable;
    const pulledBlacksPerRoute = source === "wonderberry"
      ? blackPerRoute
      : source === "mixed"
        ? 1
        : 0;
    const auctionBlacksPerRoute = blackPerRoute - pulledBlacksPerRoute;
    const blackMesoPerRoute =
      pulledBlacksPerRoute * berryNetMesoPerBlack +
      auctionBlacksPerRoute * wonderBlackMesoPrice;
    const recoveryPerRoute = tradeableResults
      ? tradeableRecoveryPerRoute
      : untradeableRecoveryPerRoute;
    const netMesoPerRoute =
      blackMesoPerRoute +
      crystalsPerRoute * crystalMesoEquivalent -
      recoveryPerRoute;
    return {
      source,
      tradeableResults,
      pulledBlacksPerRoute,
      auctionBlacksPerRoute,
      blackMesoPerRoute,
      blackMesoPerPet: blackMesoPerRoute / blackPerRoute,
      recoveryPerRoute,
      netMesoPerRoute,
      netMesoPerTarget: netMesoPerRoute / routeSuccessProbability,
    };
  }

  const wonderberryScenario = sourceScenario("wonderberry");
  const auctionScenario = wonderBlackMesoPrice > 0
    ? sourceScenario("auction")
    : null;
  const mixedScenario = wonderBlackMesoPrice > 0
    ? sourceScenario("mixed")
    : null;
  const wonderberryComparisonScenario = {
    ...wonderberryScenario,
    netMesoPerTarget:
      bundlePurchase.costs.netMesoEquivalentAfterRemainingBlackSale /
      targetCount,
  };
  let selectedSource = tradeableOutputRequired
    ? "wonderberry"
    : sourceMode;
  if (!tradeableOutputRequired && sourceMode === "cheapest") {
    const candidates = [
      wonderberryComparisonScenario,
      auctionScenario,
      mixedScenario,
    ]
      .filter(Boolean);
    selectedSource = candidates.reduce((best, candidate) =>
      candidate.netMesoPerTarget < best.netMesoPerTarget ? candidate : best
    ).source;
  }
  const selectedScenario = selectedSource === "auction"
    ? auctionScenario
    : selectedSource === "mixed"
      ? mixedScenario
      : wonderberryComparisonScenario;

  // 경매장 구매 기준가는 선택된 조달처가 아니라 캐시샵 54k MP
  // 직접 뽑기의 메소마켓 환산값과 비교한다. 경매장 묶음 시세나
  // 현금 시세가 바뀌어도 이 기준가는 달라지지 않는다.
  const appliedBerryGrossMesoPerBlack = berryGrossMesoPerBlack;
  const appliedBerryNetMesoPerBlack = berryNetMesoPerBlack;

  // 교환 가능한 블랙 1마리를 베이스로 남겨 둔 상태에서, 추가 재료용
  // 블랙을 직접 뽑는 것과 옥션에서 사는 것이 같아지는 가격이다.
  const wonderBlackPurchaseThreshold = appliedBerryNetMesoPerBlack;
  const materialBlackMeso = appliedBerryNetMesoPerBlack;
  const maplePointDirectNetMesoPerTarget =
    bundlePurchase.procurement.comparison.maplePointBundle
      .netMesoEquivalentAfterRecovery / targetCount;
  // 옥션에서 산 스윗은 교환 불가 베이스가 되므로 실패한 드림은
  // 540 MP 페이백, 키는 회수 불가인 기준으로 구매 상한을 계산한다.
  // 이 기준은 캐시샵 MP 묶음에서 블랙을 직접 뽑아 합성하는 경로와
  // 메소마켓 환율만 사용하므로 옥션 조달·판매 시세와 수수료에
  // 영향을 받지 않는다.
  const purchasedSweetAttemptRecovery = second.dream * paybackMeso;
  const lunaSweetPurchaseThreshold = Math.max(
    0,
    second.petite * maplePointDirectNetMesoPerTarget -
      materialBlackMeso -
      crystalMesoEquivalent +
      purchasedSweetAttemptRecovery,
  );

  // 구매 비교표에서는 목표 마릿수와 묶음 끝의 우연한 잔여량에 따라
  // 기준가가 흔들리지 않도록 장기 평균 단가를 쓴다. 한 묶음에서 나온
  // 모든 블랙을 다음 합성용 재고로 보관한다고 보고, 블랙 자신의
  // 경매장 시세를 회수액으로 넣지 않는다.
  const expectedBlacksPerBundle =
    wonderBerryBundleSize * wonderBlackProbability;
  const expectedPaybackPetsPerBundle =
    wonderBerryBundleSize * wonderUpperPetProbability;
  const expectedPetPaybackMesoPerBundle =
    expectedPaybackPetsPerBundle * paybackMeso;
  const maplePointBundleGrossMeso =
    wonderBerryBundleMaplePoints * costToMeso;
  const maplePointBundleNetMesoBeforeBlackInventory =
    maplePointBundleGrossMeso - expectedPetPaybackMesoPerBundle;
  const maplePointLongRunBlackMeso = Math.max(
    0,
    maplePointBundleNetMesoBeforeBlackInventory /
      expectedBlacksPerBundle,
  );
  const maplePointLongRunPetiteTargetMeso = Math.max(
    0,
    (
      blackPerRoute * maplePointLongRunBlackMeso +
      crystalsPerRoute * crystalMesoEquivalent -
      untradeableRecoveryPerRoute
    ) /
    routeSuccessProbability,
  );
  const maplePointLongRunSweetThreshold = Math.max(
    0,
    second.petite * maplePointLongRunPetiteTargetMeso -
      maplePointLongRunBlackMeso -
      crystalMesoEquivalent +
      purchasedSweetAttemptRecovery,
  );

  const auctionBundleThresholdAvailable =
    wonderBerryAuctionBundleMesoPrice > 0;
  const auctionBundleNetMesoBeforeBlackInventory =
    auctionBundleThresholdAvailable
      ? wonderBerryAuctionBundleMesoPrice -
        expectedPetPaybackMesoPerBundle
      : null;
  const auctionBundleLongRunBlackMeso =
    auctionBundleThresholdAvailable
      ? Math.max(
        0,
        auctionBundleNetMesoBeforeBlackInventory /
          expectedBlacksPerBundle,
      )
      : null;
  // 경매장 묶음에서 직접 나온 블랙을 베이스로 쓰면 합성 산출물은
  // 교가이므로 드림은 페이백/판매 중 큰 값, 키는 판매 순수령액으로
  // 회수한다. 루나 스윗 시세 자체는 이 원가에 넣지 않아 순환 참조를
  // 만들지 않는다.
  const auctionBundleLongRunPetiteTargetMeso =
    auctionBundleThresholdAvailable
      ? Math.max(
        0,
        (
        blackPerRoute * auctionBundleLongRunBlackMeso +
        crystalsPerRoute * crystalMesoEquivalent -
        tradeableRecoveryPerRoute
      ) /
        routeSuccessProbability,
      )
      : null;
  const auctionBundleLongRunSweetThreshold =
    auctionBundleThresholdAvailable
      ? Math.max(
        0,
        second.petite * auctionBundleLongRunPetiteTargetMeso -
          auctionBundleLongRunBlackMeso -
          crystalMesoEquivalent +
          purchasedSweetAttemptRecovery,
      )
      : null;

  const thresholdByWonderBerrySource = {
    maplePoint: {
      available: true,
      source: "maple-point-bundle",
      role: "untradeable-material",
      roleLabel: "교불 재료",
      tradeability: "untradeable",
      wonderBlackMeso: maplePointLongRunBlackMeso,
      lunaSweetMeso: maplePointLongRunSweetThreshold,
      petiteTargetNetMeso: maplePointLongRunPetiteTargetMeso,
      basis: "long-run-average",
      bundleGrossMeso: maplePointBundleGrossMeso,
      petPaybackRecoveryMesoPerBundle:
        expectedPetPaybackMesoPerBundle,
      bundleNetMesoBeforeBlackInventory:
        maplePointBundleNetMesoBeforeBlackInventory,
      expectedWonderBlacksPerBundle: expectedBlacksPerBundle,
      remainingWonderBlackTreatment: "keep-as-inventory",
      remainingWonderBlackRecoveryMeso: 0,
      lunaSweetSelfAuctionPriceApplied: false,
    },
    auctionBundle: {
      available: auctionBundleThresholdAvailable,
      source: "auction-bundle",
      role: "tradeable-base",
      roleLabel: "교가 베이스",
      tradeability: "tradeable",
      wonderBlackMeso: auctionBundleLongRunBlackMeso,
      lunaSweetMeso: auctionBundleLongRunSweetThreshold,
      petiteTargetNetMeso: auctionBundleLongRunPetiteTargetMeso,
      basis: "long-run-average",
      bundleGrossMeso: auctionBundleThresholdAvailable
        ? wonderBerryAuctionBundleMesoPrice
        : null,
      petPaybackRecoveryMesoPerBundle:
        auctionBundleThresholdAvailable
          ? expectedPetPaybackMesoPerBundle
          : null,
      bundleNetMesoBeforeBlackInventory:
        auctionBundleNetMesoBeforeBlackInventory,
      expectedWonderBlacksPerBundle: auctionBundleThresholdAvailable
        ? expectedBlacksPerBundle
        : null,
      remainingWonderBlackTreatment: auctionBundleThresholdAvailable
        ? "keep-as-inventory"
        : null,
      remainingWonderBlackRecoveryMeso: auctionBundleThresholdAvailable
        ? 0
        : null,
      lunaSweetSelfAuctionPriceApplied: false,
    },
  };

  const directBlackAvailable = wonderBlackMesoPrice > 0;
  const directSweetAvailable = lunaSweetAuctionMesoPrice > 0;
  const wonderBlackComparisonRoutes = {
    maplePointWonderBerry: {
      ...thresholdByWonderBerrySource.maplePoint,
      effectiveMeso: maplePointLongRunBlackMeso,
    },
    auctionWonderBerryBundle: {
      ...thresholdByWonderBerrySource.auctionBundle,
      effectiveMeso: auctionBundleLongRunBlackMeso,
    },
    directAuctionPurchase: {
      available: directBlackAvailable,
      source: "auction-pet",
      role: "purchased-material",
      roleLabel: "구매 후 교불",
      tradeability: "untradeable",
      effectiveMeso: directBlackAvailable
        ? wonderBlackMesoPrice
        : null,
    },
  };
  const availableBlackRoutes = Object.entries(
    wonderBlackComparisonRoutes,
  ).filter(([, route]) => route.available);
  const cheapestBlackRoute = availableBlackRoutes.reduce(
    (best, current) =>
      current[1].effectiveMeso < best[1].effectiveMeso
        ? current
        : best,
  );

  const selfSweetRoutes = [
    ["maplePointWonderBerry", thresholdByWonderBerrySource.maplePoint],
    ["auctionWonderBerryBundle", thresholdByWonderBerrySource.auctionBundle],
  ].filter(([, route]) => route.available);
  const bestSweetAlternative = selfSweetRoutes.reduce(
    (best, current) =>
      current[1].petiteTargetNetMeso < best[1].petiteTargetNetMeso
        ? current
        : best,
  );
  const directSweetPurchaseUpperBoundMeso =
    bestSweetAlternative[1].lunaSweetMeso;
  const directSweetPurchaseIsCompetitive =
    directSweetAvailable &&
    lunaSweetAuctionMesoPrice <= directSweetPurchaseUpperBoundMeso;
  const lunaSweetComparisonRoutes = {
    maplePointWonderBerry: {
      ...thresholdByWonderBerrySource.maplePoint,
      effectiveMeso: maplePointLongRunSweetThreshold,
    },
    auctionWonderBerryBundle: {
      ...thresholdByWonderBerrySource.auctionBundle,
      effectiveMeso: auctionBundleLongRunSweetThreshold,
    },
    directAuctionPurchase: {
      available: directSweetAvailable,
      source: "auction-pet",
      role: "purchased-base",
      roleLabel: "구매 후 교불",
      tradeability: "untradeable",
      effectiveMeso: directSweetAvailable
        ? lunaSweetAuctionMesoPrice
        : null,
    },
  };

  const wonderBlacksFromBerry =
    routeAttempts * selectedScenario.pulledBlacksPerRoute;
  const wonderBlacksFromAuction =
    routeAttempts * selectedScenario.auctionBlacksPerRoute;
  const wonderBerries = wonderBlacksFromBerry / wonderBlackProbability;
  const wonderBerryFailures = wonderBerries - wonderBlacksFromBerry;
  const wonderPetPaybacks = wonderBerries > 0
    ? wonderBerries * wonderUpperPetProbability
    : 0;
  const wonderConsumables = wonderBerries > 0
    ? wonderBerries * PET_PROBABILITIES.wonderConsumable
    : 0;
  const berryCash = wonderBerries * unitWonderBerryPrice;
  const crystalCash = lunaCrystals * lunaCrystalPrice;
  const blackMeso = wonderBlacksFromAuction * wonderBlackMesoPrice;
  const wonderPetPaybackCash = wonderPetPaybacks * PET_PAYBACK_POINTS;
  const dreamRecoveryMesoPerPet = selectedScenario.tradeableResults
    ? tradeableDreamRecoveryMeso
    : paybackMeso;
  const dreamAuctionSaleApplicable =
    selectedScenario.tradeableResults && lunaDreamAuctionMesoPrice > 0;
  const dreamAuctionSaleSelected =
    dreamAuctionSaleApplicable && lunaDreamAuctionNetMeso > paybackMeso;
  const keyRecoveryMesoPerItem = selectedScenario.tradeableResults
    ? lunaKeyAuctionNetMeso
    : 0;
  const dreamPaybackMaplePoints = lunaDreams * PET_PAYBACK_POINTS;
  const dreamAuctionRecoveryMeso = dreamAuctionSaleApplicable
    ? lunaDreams * lunaDreamAuctionNetMeso
    : 0;
  const dreamRecoveryMeso = lunaDreams * dreamRecoveryMesoPerPet;
  const keyAuctionRecoveryMeso =
    lunaKeys * keyRecoveryMesoPerItem;
  const keyRecoveryMeso = keyAuctionRecoveryMeso;
  const resultRecoveryMeso = dreamRecoveryMeso + keyRecoveryMeso;
  const totalPetPaybackMaplePoints =
    wonderPetPaybackCash +
    (dreamAuctionSaleSelected ? 0 : dreamPaybackMaplePoints);
  const totalAuctionRecoveryMeso =
    (dreamAuctionSaleSelected ? dreamAuctionRecoveryMeso : 0) +
    keyAuctionRecoveryMeso;
  const grossCash = berryCash + crystalCash;
  const grossMesoEquivalent = grossCash * costToMeso + blackMeso;
  const recoveryMesoEquivalent =
    totalPetPaybackMaplePoints * costToMeso +
    totalAuctionRecoveryMeso;
  const netMesoEquivalent = grossMesoEquivalent - recoveryMesoEquivalent;
  bundlePurchase.applicable = selectedSource === "wonderberry";

  const result = {
    targetCount,
    sourceMode,
    selectedSource,
    tradeableOutputRequired,
    sourceSelectionConstraint: tradeableOutputRequired
      ? "wonderberry-tradeable-output-only"
      : "none",
    costConversionBasis: currency.costConversionBasis,
    probabilities: {
      wonderBlack: wonderBlackProbability,
      wonderUpperPet: wonderUpperPetProbability,
      wonderConsumable: PET_PROBABILITIES.wonderConsumable,
      routeSuccess: routeSuccessProbability,
      sweetPetite: first.petite,
      sweet: first.sweet,
      sweetKey: first.key,
      dreamPetite: second.petite,
      dream: second.dream,
      dreamKey: second.key,
    },
    currency,
    expected: {
      routeAttempts,
      sweetSynthesisAttempts,
      dreamSynthesisAttempts,
      totalSyntheses: sweetSynthesisAttempts + dreamSynthesisAttempts,
      wonderBlacks,
      wonderBlacksFromBerry,
      wonderBlacksFromAuction,
      lunaCrystals,
      wonderBerries,
      wonderBerryFailures,
      wonderPetPaybacks,
      wonderConsumables,
      lunaDreams,
      lunaKeys,
      directPetites,
      dreamRoutePetites,
    },
    costs: {
      wonderBerryBundleMaplePoints,
      lunaCrystalMaplePoints,
      unitWonderBerryMaplePoints: unitWonderBerryPrice,
      berryMaplePoints: berryCash,
      crystalMaplePoints: crystalCash,
      grossMaplePoints: grossCash,
      wonderPetPaybackMaplePoints: wonderPetPaybackCash,
      berryRecoveryMaplePoints: wonderPetPaybackCash,
      dreamPaybackMaplePoints,
      dreamAuctionRecoveryMeso,
      keyAuctionRecoveryMeso,
      totalPetPaybackMaplePoints,
      totalAuctionRecoveryMeso,
      unitWonderBerryPrice,
      berryCash,
      crystalCash,
      blackMeso,
      grossCash,
      wonderPetPaybackCash,
      berryRecoveryCash: wonderPetPaybackCash,
      dreamRecoveryMeso,
      keyRecoveryMeso,
      resultRecoveryMeso,
      recoveryMesoEquivalent,
      grossMesoEquivalent,
      netMesoEquivalent,
      costConversionBasis: currency.costConversionBasis,
      conversionToMeso: costToMeso,
      maplePointToMeso: currency.maplePointToMeso,
      wonToMeso: currency.wonToMeso,
      cashToMeso,
    },
    comparison: {
      berryGrossMaplePointsPerBlack: berryGrossCashPerBlack,
      berryPaybackMaplePointsPerBlack: berryPaybackCashPerBlack,
      berryRecoveryMaplePointsPerBlack: berryPaybackCashPerBlack,
      berryGrossCashPerBlack,
      berryPaybackCashPerBlack,
      berryRecoveryCashPerBlack: berryPaybackCashPerBlack,
      berryNetMesoPerBlack: appliedBerryNetMesoPerBlack,
      maplePointBerryNetMesoPerBlack: berryNetMesoPerBlack,
      auctionMesoPerBlack: wonderBlackMesoPrice,
      // 기존 닫힌식 필드는 호환을 위해 유지하고, 실제 묶음 조달
      // 조달 비교값은 별도 필드로 노출한다.
      wonderberryNetMesoPerTarget: wonderberryScenario.netMesoPerTarget,
      wonderberryProcurementNetMesoPerTarget:
        wonderberryComparisonScenario.netMesoPerTarget,
      auctionNetMesoPerTarget: auctionScenario?.netMesoPerTarget ?? null,
      mixedNetMesoPerTarget: mixedScenario?.netMesoPerTarget ?? null,
    },
    recovery: {
      paybackPointsPerPet: PET_PAYBACK_POINTS,
      paybackMesoPerPet: paybackMeso,
      totalPetPaybackMaplePoints,
      totalAuctionRecoveryMeso,
      recoveryMesoEquivalent,
      auctionFeeRate,
      tradeableResults: selectedScenario.tradeableResults,
      dreamAuctionGrossMeso: lunaDreamAuctionMesoPrice,
      dreamAuctionNetMeso: lunaDreamAuctionNetMeso,
      dreamMesoPerPet: dreamRecoveryMesoPerPet,
      dreamMethod:
        selectedScenario.tradeableResults &&
        lunaDreamAuctionNetMeso > paybackMeso
          ? "auction"
          : "payback",
      dreamPaybackMaplePoints,
      dreamPaybackMesoEquivalent:
        dreamPaybackMaplePoints * costToMeso,
      dreamAuctionRecoveryMeso,
      dreamAuctionSaleApplicable,
      dreamAuctionSaleApplied:
        dreamAuctionSaleSelected && lunaDreams > 0,
      dreamAuctionSaleNonApplicationReason:
        dreamAuctionSaleSelected && lunaDreams > 0
          ? null
          : lunaDreams <= 0
            ? "no-expected-output"
            : !selectedScenario.tradeableResults
              ? "output-untradeable"
              : !(lunaDreamAuctionMesoPrice > 0)
                ? "auction-price-not-provided"
                : "payback-higher-or-equal",
      keyAuctionGrossMeso: lunaKeyAuctionMesoPrice,
      keyAuctionNetMeso: lunaKeyAuctionNetMeso,
      keyMesoPerItem: keyRecoveryMesoPerItem,
      keyAuctionRecoveryMeso,
      keyAuctionSaleApplicable:
        selectedScenario.tradeableResults &&
        lunaKeyAuctionMesoPrice > 0,
      keyAuctionSaleApplied:
        selectedScenario.tradeableResults &&
        lunaKeyAuctionMesoPrice > 0 &&
        lunaKeys > 0,
      keyAuctionSaleNonApplicationReason:
        selectedScenario.tradeableResults &&
        lunaKeyAuctionMesoPrice > 0 &&
        lunaKeys > 0
          ? null
          : lunaKeys <= 0
            ? "no-expected-output"
            : !selectedScenario.tradeableResults
              ? "output-untradeable"
              : "auction-price-not-provided",
    },
    purchaseThresholds: {
      wonderBlackMeso: wonderBlackPurchaseThreshold,
      wonderBlackGrossMeso: appliedBerryGrossMesoPerBlack,
      lunaSweetMeso: lunaSweetPurchaseThreshold,
      // 경매장 원더베리 묶음을 메소로 사서 직접 뽑는 장기 평균
      // 기준가다. 기존 MP 기준 flat 필드는 위에서 그대로 보존한다.
      auctionWonderBerryBundleWonderBlackMeso:
        auctionBundleLongRunBlackMeso,
      auctionWonderBerryBundleLunaSweetMeso:
        auctionBundleLongRunSweetThreshold,
      byWonderBerrySource: thresholdByWonderBerrySource,
      appliedBlackMeso: selectedSource === "wonderberry"
        ? appliedBerryNetMesoPerBlack
        : selectedScenario.blackMesoPerPet,
      crystalMeso: crystalMesoEquivalent,
    },
    purchaseComparisons: {
      wonderBlack: {
        metric: "effective-acquisition-cost",
        routes: wonderBlackComparisonRoutes,
        // routes를 거치지 않는 기존/간단 UI를 위한 별칭이다.
        ...wonderBlackComparisonRoutes,
        recommendedRoute: cheapestBlackRoute[0],
        recommendedMeso: cheapestBlackRoute[1].effectiveMeso,
      },
      lunaSweet: {
        metric: "direct-purchase-upper-bound",
        routes: lunaSweetComparisonRoutes,
        ...lunaSweetComparisonRoutes,
        bestSelfProductionRoute: bestSweetAlternative[0],
        directPurchaseUpperBoundMeso:
          directSweetPurchaseUpperBoundMeso,
        directPurchaseIsCompetitive:
          directSweetPurchaseIsCompetitive,
        recommendedRoute: directSweetPurchaseIsCompetitive
          ? "directAuctionPurchase"
          : bestSweetAlternative[0],
      },
    },
    // 실제 11개 묶음 결제·전량 개봉 모델이다. 경매장/혼합 경로를
    // 선택한 경우에도 순수 원더베리 경로의 참고값은 제공하되,
    // selectedSource 비용에는 섞지 않는다.
    bundlePurchase,
    selectedWonderBerryProcurement:
      bundlePurchase.selectedProcurement,
    wonderBerryProcurement:
      bundlePurchase.wonderBerryProcurement,
    checkpoints: [0.5, 0.9, 0.95].map((chance) => ({
      chance,
      routes: routesForTargetChance(
        targetCount,
        chance,
        routeSuccessProbability,
      ),
    })),
  };

  // 기존 top-level 닫힌식 장부는 호환을 위해 유지하되, 조달처별
  // 교환성을 따로 추적하는 경매장 묶음·하이브리드가 선택된 경우에는
  // 결제 수단과 회수액을 선택된 정확 묶음 모델과 맞춘다.
  if (
    selectedSource === "wonderberry" &&
    (
      bundlePurchase.selectedProcurement === "auction-bundle" ||
      bundlePurchase.selectedProcurement === "hybrid-bundle"
    )
  ) {
    Object.assign(result.expected, bundlePurchase.expected, {
      wonderBlacks: bundlePurchase.expected.wonderBlacksPulled,
      wonderBlacksFromBerry:
        bundlePurchase.expected.wonderBlacksPulled,
      wonderBlacksFromAuction: 0,
      wonderBerries: bundlePurchase.expected.openedWonderBerries,
      wonderBlacksFromMaplePointWonderBerry:
        bundlePurchase.expected.untradeableWonderBlacksPulled ?? 0,
      wonderBlacksFromAuctionWonderBerry:
        bundlePurchase.expected.tradeableWonderBlacksPulled ??
          bundlePurchase.expected.wonderBlacksPulled,
    });
    Object.assign(result.costs, bundlePurchase.costs, {
      blackMeso: 0,
      berryCash: bundlePurchase.costs.berryMaplePoints,
      crystalCash: bundlePurchase.costs.crystalMaplePoints,
      grossCash: bundlePurchase.costs.grossMaplePoints,
      wonderPetPaybackCash:
        bundlePurchase.costs.wonderPetPaybackMaplePoints,
      resultRecoveryMeso:
        bundlePurchase.costs.dreamRecoveryMeso +
        bundlePurchase.costs.keyRecoveryMeso,
      berryRecoveryCash:
        bundlePurchase.costs.wonderPetPaybackMaplePoints,
    });
    Object.assign(result.recovery, bundlePurchase.recovery, {
      tradeableResults: directBerryResultsTradeable,
    });
  }

  return result;
}
