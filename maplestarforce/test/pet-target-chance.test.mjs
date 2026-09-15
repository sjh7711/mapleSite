import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateCappedRouteExpectation,
  calculateCappedWonderBerryBundleExpectation,
  calculatePetExpectation,
  calculateWonderBerryBundleCompletionExpectation,
  probabilityOfTargetWithinBundles,
  probabilityOfTargetWithinRoutes,
} from "maple-core/pet";
import {
  DEFAULT_PET_TARGET_CHANCE_PERCENT,
  calculatePetTargetChanceProjection,
  calculatePetWonderBerryPercentileView,
  normalizePetTargetChance,
} from "../src/shared/pet-target-chance.js";

const close = (actual, expected, tolerance = 1e-9) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected}`,
  );
};

test("자석펫 목표 확률은 0.01~99.99%로 정규화한다", () => {
  assert.equal(DEFAULT_PET_TARGET_CHANCE_PERCENT, 63.21);
  assert.equal(normalizePetTargetChance(""), 63.21);
  assert.equal(normalizePetTargetChance(-10), 0.01);
  assert.equal(normalizePetTargetChance(120), 99.99);
  assert.equal(normalizePetTargetChance(73.456), 73.46);
});

test("원더베리는 선택 확률 이상의 최소 11개 묶음과 최대 결제액을 계산한다", () => {
  const result = calculatePetExpectation();
  const projection = calculatePetTargetChanceProjection(result, 63.21);

  assert.equal(projection.mode, "bundles");
  assert.ok(Number.isInteger(projection.bundles));
  assert.ok(projection.actualChance >= 0.6321);
  assert.ok(
    probabilityOfTargetWithinBundles(
      projection.bundles - 1,
      1,
      false,
      11,
    ) < 0.6321,
  );
  close(
    projection.preparation.berryMaplePoints,
    projection.bundles * 54_000,
  );
  close(
    projection.preparation.berryCash,
    projection.preparation.berryMaplePoints,
  );
  assert.equal(projection.preparation.wonderBerries, projection.bundles * 11);
});

test("99.99% 원더베리 표시는 조기중단 평균이 아닌 최소 정수 묶음과 준비 비용을 쓴다", () => {
  const result = calculatePetExpectation();
  const projection = calculatePetTargetChanceProjection(result, 99.99);
  const capped = calculateCappedWonderBerryBundleExpectation({
    maxBundles: projection.bundles,
  });
  const completion = calculateWonderBerryBundleCompletionExpectation({
    completionBundle: projection.bundles,
  });

  assert.equal(projection.mode, "bundles");
  assert.ok(Number.isInteger(projection.bundles));
  assert.ok(projection.actualChance >= 0.9999);
  assert.ok(
    probabilityOfTargetWithinBundles(projection.bundles - 1, 1, false, 11) <
      0.9999,
  );
  assert.equal(
    projection.preparation.wonderBerries,
    projection.bundles * 11,
  );
  close(
    projection.preparation.berryMaplePoints,
    projection.bundles * 54_000,
  );
  assert.ok(capped.expected.purchasedBundles < projection.bundles);
  assert.notEqual(
    capped.expected.purchasedBundles,
    projection.bundles,
    "99.99% 당첨선의 표시 묶음 수에 조기중단 평균을 쓰면 안 된다",
  );
  assert.equal(completion.expected.purchasedBundles, projection.bundles);
  assert.equal(
    completion.expected.openedWonderBerries,
    projection.preparation.wonderBerries,
  );
  assert.equal(
    completion.costs.berryMaplePoints,
    projection.preparation.berryMaplePoints,
  );
  assert.ok(completion.expected.lunaCrystals > 0);
  assert.ok(
    completion.costs.grossMesoEquivalent >
      projection.preparation.berryMesoEquivalent,
  );
  close(completion.cumulativeChance, projection.actualChance, 1e-12);
});

test("경매장 11개 묶음 조달의 99.99% 표시는 최소 정수 묶음과 실제 매입비를 쓴다", () => {
  const wonderBerryAuctionBundleMesoPrice = 2_000_000_000;
  const result = calculatePetExpectation({
    wonderBerryAuctionBundleMesoPrice,
  });
  const projection = calculatePetTargetChanceProjection(result, 99.99);
  const capped = calculateCappedWonderBerryBundleExpectation({
    maxBundles: projection.purchaseUnits,
    wonderBerryAuctionBundleMesoPrice,
  });
  const completion = calculateWonderBerryBundleCompletionExpectation({
    completionBundle: projection.purchaseUnits,
    wonderBerryAuctionBundleMesoPrice,
  });

  assert.equal(result.bundlePurchase.selectedProcurement, "auction-bundle");
  assert.equal(projection.mode, "bundles");
  assert.equal(projection.purchaseUnitLabel, "묶음");
  assert.equal(projection.purchaseUnitSize, 11);
  assert.equal(projection.bundles, projection.purchaseUnits);
  assert.ok(Number.isInteger(projection.purchaseUnits));
  assert.ok(projection.actualChance >= 0.9999);
  assert.ok(
    probabilityOfTargetWithinBundles(
      projection.purchaseUnits - 1,
      1,
      false,
      11,
    ) < 0.9999,
  );
  assert.equal(
    projection.preparation.wonderBerries,
    projection.purchaseUnits * 11,
  );
  assert.equal(projection.preparation.berryMaplePoints, 0);
  close(
    projection.preparation.berryProcurementMesoEquivalent,
    projection.purchaseUnits * wonderBerryAuctionBundleMesoPrice,
    1e-3,
  );
  assert.ok(capped.expected.purchasedUnits < projection.purchaseUnits);
  assert.notEqual(capped.expected.purchasedUnits, projection.purchaseUnits);
  assert.equal(completion.expected.purchasedUnits, projection.purchaseUnits);
  assert.equal(completion.costs.berryMaplePoints, 0);
  close(
    completion.costs.wonderBerryAuctionBundleMeso,
    projection.preparation.berryProcurementMesoEquivalent,
    1e-3,
  );
  close(completion.cumulativeChance, projection.actualChance, 1e-12);
});

test("80% 당첨선은 경매장 11개 묶음 전량 개봉 CDF를 쓴다", () => {
  const wonderBerryAuctionBundleMesoPrice = 2_600_000_000;
  const average = calculatePetExpectation({
    wonderBerryAuctionBundleMesoPrice,
  });
  const view = calculatePetWonderBerryPercentileView(
    { wonderBerryAuctionBundleMesoPrice },
    80,
  );
  const { percentileCompletion, percentileResult, projection } = view;

  assert.equal(
    average.bundlePurchase.selectedProcurement,
    "auction-bundle",
  );
  assert.equal(percentileResult.selectedProcurement, "auction-bundle");
  assert.equal(percentileCompletion.selectedProcurement, "auction-bundle");
  assert.equal(projection.selectedProcurement, "auction-bundle");
  assert.equal(projection.purchaseUnitLabel, "묶음");
  assert.equal(projection.purchaseUnitSize, 11);
  assert.equal(projection.completionUnitKind, "bundle");
  assert.equal(projection.completionWonderBerries, null);
  assert.equal(percentileResult.completionWonderBerry, null);
  assert.equal(projection.purchaseBundles, 14);
  assert.equal(projection.completionBundles, projection.purchaseBundles);
  assert.equal(projection.bundles, projection.purchaseBundles);
  assert.ok(projection.actualChance >= 0.8);
  assert.ok(projection.previousChance < 0.8);
  close(
    projection.actualChance,
    percentileCompletion.cumulativeChance,
    1e-12,
  );
  assert.equal(
    projection.preparation.wonderBerries,
    projection.purchaseBundles * 11,
  );
  assert.equal(projection.preparation.unopenedWonderBerries, 0);
  close(
    projection.preparation.berryProcurementMesoEquivalent,
    percentileCompletion.costs.berryProcurementMesoEquivalent,
    1e-6,
  );
});

test("목표확률의 전량 개봉 묶음 수·미개봉 0·구매 내역은 같은 값이다", () => {
  const view = calculatePetWonderBerryPercentileView(
    { wonderBerryAuctionBundleMesoPrice: 2_600_000_000 },
    63.21,
  );
  const { percentileCompletion, percentileResult, projection } = view;

  assert.equal(percentileResult.selectedProcurement, "auction-bundle");
  assert.equal(projection.selectedProcurement, "auction-bundle");
  assert.equal(projection.purchaseUnitLabel, "묶음");
  assert.equal(projection.completionUnitKind, "bundle");
  assert.equal(projection.completionWonderBerries, null);
  assert.equal(projection.purchaseBundles, 9);
  assert.deepEqual(percentileResult.plan, {
    maplePointBundles: 0,
    auctionBundles: 9,
    purchasedBundles: 9,
    suppliedWonderBerries: 99,
    excessWonderBerries: 0,
    bundleMaplePoints: 0,
    auctionBundleMeso: 23_400_000_000,
    totalMesoEquivalent: 23_400_000_000,
  });
  assert.deepEqual(
    percentileCompletion.procurement.plan,
    percentileResult.plan,
  );
  assert.equal(
    projection.preparation.berryProcurementMesoEquivalent,
    percentileResult.plan.totalMesoEquivalent,
  );
  assert.equal(
    percentileCompletion.costs.berryProcurementMesoEquivalent,
    percentileResult.plan.totalMesoEquivalent,
  );
  assert.equal(
    projection.preparation.wonderBerries,
    percentileResult.plan.suppliedWonderBerries,
  );
  assert.equal(projection.preparation.suppliedWonderBerries, 99);
  assert.equal(projection.preparation.unopenedWonderBerries, 0);
  assert.ok(projection.actualChance >= 0.6321);
  assert.ok(projection.previousChance < 0.6321);
});

test("하이브리드 당첨선은 경매장 교가 베이스와 메포 교불 재료를 같은 K묶음 안에서 분리한다", () => {
  const view = calculatePetWonderBerryPercentileView(
    {
      wonderBerryAuctionBundleMesoPrice: 2_800_000_000,
      wonderBlackMesoPrice: 2_000_000_000,
      maplePointsPer100MillionMeso: 2_000,
    },
    50,
  );
  const { percentileCompletion, percentileResult, projection } = view;
  const breakdown = percentileResult.procurement.sourceBreakdown;
  const auctionBase = breakdown.auctionBase;
  const maplePointMaterial = breakdown.maplePointMaterial;

  assert.equal(percentileResult.selectedProcurement, "hybrid-bundle");
  assert.equal(percentileCompletion.selectedProcurement, "hybrid-bundle");
  assert.equal(percentileResult.completionUnitKind, "bundle");
  assert.equal(percentileResult.completionWonderBerry, null);
  assert.equal(projection.completionUnitKind, "bundle");
  assert.equal(projection.completionWonderBerries, null);
  assert.equal(projection.completionBundles, projection.purchaseBundles);
  assert.ok(Number.isInteger(projection.completionBundles));
  assert.ok(projection.actualChance >= 0.5);
  assert.ok(projection.previousChance < 0.5);
  assert.equal(projection.preparation.unopenedWonderBerries, 0);
  assert.equal(projection.preparation.sourceBreakdown, breakdown);
  assert.equal(auctionBase.role, "tradeable-base");
  assert.equal(maplePointMaterial.role, "untradeable-material");
  close(
    auctionBase.purchasedBundles + maplePointMaterial.purchasedBundles,
    projection.completionBundles,
    1e-10,
  );
  close(
    auctionBase.openedWonderBerries +
      maplePointMaterial.openedWonderBerries,
    projection.completionBundles * 11,
    1e-9,
  );
  close(
    auctionBase.auctionMeso,
    percentileCompletion.costs.wonderBerryAuctionBundleMeso,
    1e-6,
  );
  close(
    maplePointMaterial.maplePoints,
    percentileCompletion.costs.berryMaplePoints,
    1e-6,
  );
});

test("2·3마리 목표 확률은 원더베리 묶음 안의 재고와 연속 합성을 반영한다", () => {
  for (const targetCount of [2, 3]) {
    const result = calculatePetExpectation({ targetCount });
    const projection = calculatePetTargetChanceProjection(result, 90);
    assert.equal(projection.mode, "bundles");
    assert.ok(projection.bundles >= 1);
    assert.ok(projection.actualChance >= 0.9);
    assert.ok(
      probabilityOfTargetWithinBundles(
        projection.bundles - 1,
        targetCount,
        false,
        11,
      ) < 0.9,
    );
  }
});

test("경매장 준비는 기존 합성 경로 확률과 평균 준비값을 유지한다", () => {
  const result = calculatePetExpectation({
    sourceMode: "auction",
    wonderBlackMesoPrice: 2_000_000_000,
  });
  const projection = calculatePetTargetChanceProjection(result, 63.21);

  assert.equal(projection.mode, "routes");
  assert.equal(projection.routes, 3);
  assert.ok(projection.actualChance >= 0.6321);
  assert.ok(
    probabilityOfTargetWithinRoutes(
      projection.routes - 1,
      1,
      result.probabilities.routeSuccess,
    ) < 0.6321,
  );
  close(projection.scale, 3 / result.expected.routeAttempts);
  close(
    projection.costs.netMesoEquivalent,
    result.costs.netMesoEquivalent * projection.scale,
  );
});

test("99.99% 경매장 표시는 조기중단 평균이 아닌 최소 정수 경로와 준비 비용을 쓴다", () => {
  const result = calculatePetExpectation({
    sourceMode: "auction",
    wonderBlackMesoPrice: 2_000_000_000,
  });
  const projection = calculatePetTargetChanceProjection(result, 99.99);
  const capped = calculateCappedRouteExpectation({
    maxRoutes: projection.routes,
    routeSuccessProbability: result.probabilities.routeSuccess,
  });

  assert.equal(projection.mode, "routes");
  assert.ok(Number.isInteger(projection.routes));
  assert.ok(projection.actualChance >= 0.9999);
  assert.ok(
    probabilityOfTargetWithinRoutes(
      projection.routes - 1,
      1,
      result.probabilities.routeSuccess,
    ) < 0.9999,
  );
  close(
    projection.scale,
    projection.routes / result.expected.routeAttempts,
  );
  close(
    projection.expected.totalSyntheses,
    result.expected.totalSyntheses * projection.scale,
  );
  close(
    projection.costs.netMesoEquivalent,
    result.costs.netMesoEquivalent * projection.scale,
  );
  assert.ok(capped.expectedAttempts < projection.routes);
  assert.notEqual(
    capped.expectedAttempts,
    projection.routes,
    "99.99% 당첨선의 표시 경로 수에 조기중단 평균을 쓰면 안 된다",
  );
});
