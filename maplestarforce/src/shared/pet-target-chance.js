import {
  bundlesForTargetChance,
  calculateWonderBerryPercentileCompletionExpectation,
  probabilityOfTargetWithinBundles,
  probabilityOfTargetWithinRoutes,
  routesForTargetChance,
} from "maple-core/pet";

export const MIN_PET_TARGET_CHANCE_PERCENT = 0.01;
export const MAX_PET_TARGET_CHANCE_PERCENT = 99.99;
// 잠재능력 확률 바와 같은 공통 비교점인 1 - e^-1을 기본값으로 쓴다.
// 2·3마리 목표에서는 평균 경로 수와 직접 대응하는 값은 아니다.
export const DEFAULT_PET_TARGET_CHANCE_PERCENT = 63.21;
const WONDER_BERRY_BUNDLE_SIZE = 11;

export function normalizePetTargetChance(
  value,
  fallback = DEFAULT_PET_TARGET_CHANCE_PERCENT,
) {
  if (value === "" || value === null || value === undefined) return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(
    MAX_PET_TARGET_CHANCE_PERCENT,
    Math.max(
      MIN_PET_TARGET_CHANCE_PERCENT,
      Math.round(numeric * 100) / 100,
    ),
  );
}

/**
 * 목표확률 당첨선에서는 장기 평균에서 고른 원더베리 조달법을 그대로
 * 확대하지 않는다. 메포 단독·경매장 단독·하이브리드의 11개 묶음
 * 전량 개봉 CDF와 T=K 완료 비용을 각각 비교하고 선택 결과를 돌려준다.
 */
export function calculatePetWonderBerryPercentileView(
  options,
  chancePercent,
) {
  const requestedChancePercent = normalizePetTargetChance(chancePercent);
  const percentileResult =
    calculateWonderBerryPercentileCompletionExpectation({
      ...options,
      targetChance: requestedChancePercent / 100,
    });
  const percentileCompletion = percentileResult.completion;
  const completionBundles = Number(
    percentileResult.purchaseBundles ??
      percentileResult.requiredPurchaseBundles ??
      percentileResult.purchaseUnits ??
      (Number(percentileResult.plan?.maplePointBundles ?? 0) +
        Number(percentileResult.plan?.auctionBundles ?? 0)),
  );
  const purchaseBundles = completionBundles;
  const suppliedWonderBerries = Number(
    percentileResult.suppliedWonderBerries ??
      percentileResult.plan?.suppliedWonderBerries ??
      purchaseBundles * WONDER_BERRY_BUNDLE_SIZE,
  );
  const unopenedWonderBerries = Number(
    percentileResult.unopenedWonderBerries ??
      percentileResult.plan?.excessWonderBerries ??
      0,
  );
  const purchaseUnitSize = Number(
    percentileResult.purchaseUnitSize ?? WONDER_BERRY_BUNDLE_SIZE,
  );
  const berryMaplePoints = Number(
    percentileResult.costs?.berryMaplePoints ??
      percentileResult.costs?.berryCash ??
      0,
  );
  const berryProcurementMesoEquivalent = Number(
    percentileResult.costs?.berryProcurementMesoEquivalent ?? 0,
  );

  return {
    percentileCompletion,
    percentileResult,
    projection: {
      mode: "bundles",
      targetCount: percentileResult.targetCount,
      requestedChancePercent,
      bundles: completionBundles,
      purchaseUnits: purchaseBundles,
      completionBundles,
      completionWonderBerries: null,
      completionUnitKind:
        percentileResult.completionUnitKind ?? "bundle",
      purchaseBundles,
      purchaseUnitLabel: percentileResult.purchaseUnitLabel,
      purchaseUnitSize,
      selectedProcurement: percentileResult.selectedProcurement,
      actualChance: percentileResult.actualChance,
      previousChance: percentileResult.previousChance,
      preparation: {
        wonderBerries: suppliedWonderBerries,
        suppliedWonderBerries,
        unopenedWonderBerries,
        purchaseBundles,
        berryMaplePoints,
        berryProcurementMesoEquivalent,
        sourceBreakdown:
          percentileResult.procurement?.sourceBreakdown ?? null,
        // 이전 소비자와 저장된 테스트를 위한 호환 별칭이다.
        berryCash: berryMaplePoints,
        berryMesoEquivalent: berryProcurementMesoEquivalent,
      },
    },
  };
}

/**
 * 원더베리 경로는 실제 11개 묶음 수로, 그 외 경로는 합성 경로 수로
 * 목표 확률과 준비량을 계산한다.
 */
export function calculatePetTargetChanceProjection(result, chancePercent) {
  const targetCount = Number(result?.targetCount);
  const routeProbability = Number(result?.probabilities?.routeSuccess);
  const expectedRoutes = Number(result?.expected?.routeAttempts);
  if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 3) {
    throw new RangeError("자석펫 목표 마릿수가 올바르지 않습니다.");
  }
  if (!(routeProbability > 0 && routeProbability <= 1)) {
    throw new RangeError("자석펫 경로 성공 확률이 올바르지 않습니다.");
  }
  if (!(expectedRoutes > 0)) {
    throw new RangeError("자석펫 평균 경로 수가 올바르지 않습니다.");
  }

  const requestedChancePercent = normalizePetTargetChance(chancePercent);
  const requestedChance = requestedChancePercent / 100;
  const bundlePurchase = result?.bundlePurchase;
  if (bundlePurchase?.applicable) {
    const bundleSize = Number(
      bundlePurchase?.policy?.purchaseUnitSize ??
        bundlePurchase?.policy?.bundleSize,
    );
    const purchaseUnitLabel =
      bundlePurchase?.policy?.purchaseUnitLabel ?? "묶음";
    const wonderBlackEvent = bundlePurchase?.wonderBlackEvent === true;
    const purchasedBundles = bundlesForTargetChance(
      targetCount,
      requestedChance,
      wonderBlackEvent,
      bundleSize,
    );
    const actualChance = probabilityOfTargetWithinBundles(
      purchasedBundles,
      targetCount,
      wonderBlackEvent,
      bundleSize,
    );
    const averagePurchaseUnits = Number(
      bundlePurchase?.expected?.purchasedUnits ??
        bundlePurchase?.expected?.purchasedBundles,
    );
    const averageBerryMaplePoints = Number(
      bundlePurchase?.costs?.berryMaplePoints ??
      bundlePurchase?.costs?.berryCash,
    );
    const currencyToMeso = Number(
      result?.costs?.conversionToMeso ?? result?.costs?.cashToMeso,
    );
    const averageProcurementMeso = Number(
      bundlePurchase?.costs?.berryProcurementMesoEquivalent ??
        averageBerryMaplePoints * currencyToMeso,
    );
    if (
      !(averagePurchaseUnits > 0) ||
      !(averageBerryMaplePoints >= 0) ||
      !(averageProcurementMeso >= 0)
    ) {
      throw new RangeError("원더베리 구매 단위 평균 비용이 올바르지 않습니다.");
    }
    const unitMaplePoints =
      averageBerryMaplePoints / averagePurchaseUnits;
    const unitProcurementMeso =
      averageProcurementMeso / averagePurchaseUnits;

    return {
      mode: "bundles",
      targetCount,
      requestedChancePercent,
      bundles: purchasedBundles,
      purchaseUnits: purchasedBundles,
      purchaseUnitLabel,
      purchaseUnitSize: bundleSize,
      actualChance,
      preparation: {
        wonderBerries: purchasedBundles * bundleSize,
        berryMaplePoints: purchasedBundles * unitMaplePoints,
        berryProcurementMesoEquivalent:
          purchasedBundles * unitProcurementMeso,
        // 이전 소비자와 저장된 테스트를 위한 호환 별칭이다.
        berryCash: purchasedBundles * unitMaplePoints,
        berryMesoEquivalent: purchasedBundles * unitProcurementMeso,
      },
    };
  }

  const routes = routesForTargetChance(
    targetCount,
    requestedChance,
    routeProbability,
  );
  const actualChance = probabilityOfTargetWithinRoutes(
    routes,
    targetCount,
    routeProbability,
  );
  const scale = routes / expectedRoutes;

  return {
    mode: "routes",
    targetCount,
    requestedChancePercent,
    routes,
    actualChance,
    scale,
    expected: {
      wonderBerries: result.expected.wonderBerries * scale,
      wonderBlacks: result.expected.wonderBlacks * scale,
      lunaCrystals: result.expected.lunaCrystals * scale,
      totalSyntheses: result.expected.totalSyntheses * scale,
    },
    costs: {
      grossMesoEquivalent: result.costs.grossMesoEquivalent * scale,
      recoveryMesoEquivalent: result.costs.recoveryMesoEquivalent * scale,
      netMesoEquivalent: result.costs.netMesoEquivalent * scale,
    },
  };
}
