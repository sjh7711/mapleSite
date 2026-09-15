import assert from "node:assert/strict";
import test from "node:test";

import {
  PET_PROBABILITIES,
  calculateCappedRouteExpectation,
  calculateCappedWonderBerryBundleExpectation,
  calculatePetExpectation,
  calculateWonderBerryTargetProcurement,
  calculateWonderBerryBundleExpectation,
  calculateWonderBerryBundleCompletionExpectation,
  calculateWonderBerryPercentileCompletionExpectation,
  bundlesForTargetChance,
  getPetiteRouteProbability,
  getWonderBlackProbability,
  getWonderUpperPetProbability,
  optimizeWonderBerryProcurement,
  probabilityOfTargetWithinBundles,
  probabilityOfTargetWithinWonderBerries,
  probabilityOfTargetWithinRoutes,
  routesForTargetChance,
  wonderBerriesForTargetChance,
} from "../src/pet.js";

function assertClose(actual, expected, message, tolerance = 1e-10) {
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(
    Math.abs(actual - expected) <= tolerance * scale,
    `${message}: ${actual} != ${expected}`,
  );
}

test("공식 원더 블랙 평시·이벤트 확률을 구분한다", () => {
  assert.equal(getWonderBlackProbability(false), 0.0996);
  assert.equal(getWonderBlackProbability(true), 0.11952);
  assert.ok(
    Math.abs(
      getWonderBlackProbability(true) /
        getWonderBlackProbability(false) -
        1.2,
    ) < 1e-12,
  );
  assert.equal(getWonderUpperPetProbability(false), 0.6);
  assert.equal(getWonderUpperPetProbability(true), 0.58008);
  assert.equal(
    getWonderBlackProbability(false) +
      getWonderUpperPetProbability(false) +
      PET_PROBABILITIES.wonderConsumable,
    1,
  );
  assert.equal(
    getWonderBlackProbability(true) +
      getWonderUpperPetProbability(true) +
      PET_PROBABILITIES.wonderConsumable,
    1,
  );
});

test("스윗을 드림 경로에 재사용한 최종 성공률을 계산한다", () => {
  const expected =
    PET_PROBABILITIES.sweetSynthesis.petite +
    PET_PROBABILITIES.sweetSynthesis.sweet *
      PET_PROBABILITIES.dreamSynthesis.petite;
  assert.equal(getPetiteRouteProbability(), expected);
  assert.equal(expected, 0.292656);
});

test("자석펫 1마리 기대 재료량이 수기 계산과 일치한다", () => {
  const result = calculatePetExpectation();
  assert.ok(Math.abs(result.expected.routeAttempts - 3.416981028921327) < 1e-12);
  assert.ok(Math.abs(result.expected.wonderBlacks - 9.78623366683068) < 1e-12);
  assert.ok(Math.abs(result.expected.lunaCrystals - 6.369252637909353) < 1e-12);
  assert.ok(Math.abs(result.expected.wonderBerries - 98.25535810070966) < 1e-12);
  assert.ok(Math.abs(result.expected.lunaDreams - 2.231917336394948) < 1e-12);
  assert.ok(Math.abs(result.expected.lunaKeys - 0.18506369252637905) < 1e-12);
  assert.ok(
    Math.abs(
      result.expected.directPetites + result.expected.dreamRoutePetites - 1,
    ) < 1e-12,
  );
});

test("이벤트는 합성 재료량은 바꾸지 않고 원더베리 횟수만 1/1.2배로 줄인다", () => {
  const normal = calculatePetExpectation({ wonderBlackEvent: false });
  const event = calculatePetExpectation({ wonderBlackEvent: true });
  assert.equal(event.expected.wonderBlacks, normal.expected.wonderBlacks);
  assert.equal(event.expected.lunaCrystals, normal.expected.lunaCrystals);
  assert.ok(Math.abs(event.expected.wonderBerries / normal.expected.wonderBerries - 1 / 1.2) < 1e-12);
});

test("자석펫 1~3마리 목표에 맞춰 평균 재료와 비용을 선형 확장한다", () => {
  const one = calculatePetExpectation({ targetCount: 1 });
  for (const targetCount of [2, 3]) {
    const multiple = calculatePetExpectation({ targetCount });
    assert.equal(multiple.targetCount, targetCount);
    for (const key of [
      "routeAttempts",
      "wonderBlacks",
      "lunaCrystals",
      "wonderBerries",
      "lunaDreams",
      "lunaKeys",
    ]) {
      assert.ok(
        Math.abs(multiple.expected[key] - one.expected[key] * targetCount) < 1e-10,
        `${targetCount}마리 ${key}`,
      );
    }
    assert.ok(
      Math.abs(
        multiple.costs.netMesoEquivalent -
          one.costs.netMesoEquivalent * targetCount,
      ) < 1e-4,
    );
    assert.ok(
      Math.abs(
        multiple.expected.directPetites +
          multiple.expected.dreamRoutePetites -
          targetCount,
      ) < 1e-12,
    );
  }
  for (const targetCount of [0, 1.5]) {
    assert.throws(() => calculatePetExpectation({ targetCount }));
  }
  assert.throws(
    () => calculatePetExpectation({ targetCount: 4 }),
    /1~3마리/,
  );
});

test("11개 묶음 전량 개봉 모델은 남은 블랙과 실제 구매 묶음을 보존한다", () => {
  const continuous = calculatePetExpectation({ targetCount: 3 });
  const bundled = calculateWonderBerryBundleExpectation({ targetCount: 3 });

  assert.ok(
    Math.abs(bundled.expected.purchasedBundles - 27.251461281865176) < 1e-10,
  );
  assert.ok(
    Math.abs(bundled.expected.openedWonderBerries - 299.76607410051696) < 1e-9,
  );
  assert.ok(
    Math.abs(bundled.expected.remainingWonderBlacks - 0.49799997991958594) < 1e-10,
  );
  assert.ok(
    bundled.expected.openedWonderBerries > continuous.expected.wonderBerries,
  );
  assert.ok(
    Math.abs(
      bundled.expected.wonderBlacksPulled -
        bundled.expected.wonderBlacksConsumed -
        bundled.expected.remainingWonderBlacks,
    ) < 1e-10,
  );
  assert.ok(
    Math.abs(
      bundled.expected.wonderBlacksConsumed -
        continuous.expected.wonderBlacks,
    ) < 1e-10,
  );
  assert.ok(
    Math.abs(
      bundled.expected.directPetites +
        bundled.expected.dreamRoutePetites -
        3,
    ) < 1e-10,
  );
  assert.ok(
    Math.abs(
      bundled.remainingWonderBlackDistribution.reduce(
        (sum, entry) => sum + entry.probability,
        0,
      ) - 1,
    ) < 1e-10,
  );
  assert.equal(bundled.policy.openEntireBundle, true);
  assert.equal(bundled.policy.pendingSweetFirst, true);
  assert.equal(bundled.policy.stopAtTarget, true);
});

test("묶음 모델은 1~3마리와 이벤트 ON/OFF에서 자원 보존을 만족한다", () => {
  for (const wonderBlackEvent of [false, true]) {
    for (const targetCount of [1, 2, 3]) {
      const result = calculateWonderBerryBundleExpectation({
        targetCount,
        wonderBlackEvent,
      });
      assert.ok(result.expected.purchasedBundles > 0);
      assert.ok(
        Math.abs(
          result.expected.openedWonderBerries -
            result.expected.purchasedBundles * 11,
        ) < 1e-10,
      );
      assert.ok(
        Math.abs(
          result.expected.wonderBlacksPulled -
            result.expected.wonderBlacksConsumed -
            result.expected.remainingWonderBlacks,
        ) < 1e-10,
      );
      assert.ok(
        Math.abs(
          result.expected.directPetites +
            result.expected.dreamRoutePetites -
            targetCount,
        ) < 1e-10,
      );
      assert.ok(
        Math.abs(
          result.expected.lunaKeys -
            result.expected.sweetKeys -
            result.expected.dreamKeys,
        ) < 1e-10,
      );
    }
  }
});

test("한 원더베리 묶음에서도 자석펫 3마리를 얻을 확률이 존재한다", () => {
  const probability = probabilityOfTargetWithinBundles(1, 3, false, 11);
  assert.ok(Math.abs(probability - 6.295480151505276e-7) < 1e-18);
  assert.ok(probability > 0);
  assert.equal(probabilityOfTargetWithinBundles(0, 3), 0);
  assert.ok(
    probabilityOfTargetWithinBundles(1, 3, true) > probability,
  );
});

test("목표 확률의 최소 묶음 수는 바로 전 묶음과 경계가 맞는다", () => {
  for (const event of [false, true]) {
    for (const targetCount of [1, 2, 3]) {
      const chance = 0.6321;
      const bundles = bundlesForTargetChance(
        targetCount,
        chance,
        event,
      );
      assert.ok(
        probabilityOfTargetWithinBundles(
          bundles,
          targetCount,
          event,
        ) >= chance,
      );
      assert.ok(
        probabilityOfTargetWithinBundles(
          bundles - 1,
          targetCount,
          event,
        ) < chance,
      );
    }
  }
  assert.equal(bundlesForTargetChance(3, 0.6321, false), 29);
  assert.equal(bundlesForTargetChance(3, 0.6321, true), 25);
});

test("묶음 모델은 교불 블랙을 보관하고 교가 블랙만 옥션 판매한다", () => {
  const held = calculateWonderBerryBundleExpectation({
    targetCount: 3,
    wonderBlackMesoPrice: 2_000_000_000,
    auctionFeeRate: 0.05,
  });
  assert.equal(held.selectedProcurement, "maple-point-bundle");
  assert.equal(held.costs.remainingWonderBlackAuctionMesoValue, 0);
  assert.ok(held.expected.remainingUntradeableWonderBlacks > 0);
  assert.equal(held.recovery.remainingBlackMethod, "keep");
  assert.equal(held.recovery.remainingUntradeableBlackMethod, "keep");
  assert.equal(held.costs.remainingBlackPaybackMaplePoints, 0);
  assert.equal(
    held.costs.remainingUntradeableBlackPaybackMaplePoints,
    0,
  );
  assert.equal(
    held.costs.remainingUntradeableBlackPaybackMesoEquivalent,
    0,
  );
  assert.equal(
    held.costs.remainingUntradeableWonderBlackRecoveryMeso,
    0,
  );
  assert.equal(
    held.costs.netMesoEquivalentAfterRemainingBlackSale,
    held.costs.netMesoEquivalent,
  );
  assert.ok(
    Math.abs(
      held.costs.totalPetPaybackMaplePoints -
        (held.costs.wonderPetPaybackMaplePoints +
          held.costs.dreamPaybackMaplePoints +
          held.costs.remainingSweetPaybackMaplePoints),
    ) < 1e-10,
  );
  const excludedInventoryPayback =
    held.expected.remainingUntradeableWonderBlacks *
    540 *
    held.costs.conversionToMeso;
  assert.ok(excludedInventoryPayback > 0);
  assertClose(
    held.costs.netMesoEquivalent - excludedInventoryPayback,
    held.costs.grossMesoEquivalent -
      (held.costs.recoveryMesoEquivalent + excludedInventoryPayback),
    "교불 블랙을 가상 페이백했을 때의 비용 차이",
  );

  const auctionHeld = calculateWonderBerryBundleExpectation({
    targetCount: 3,
    wonderBerryAuctionBundleMesoPrice: 2_000_000_000,
    wonderBerryProcurementMode: "auction-bundle",
    wonderBlackMesoPrice: 2_000_000_000,
    auctionFeeRate: 0.05,
  });
  assert.equal(auctionHeld.recovery.remainingBlackMethod, "auction");
  assert.ok(
    Math.abs(
      auctionHeld.costs.remainingWonderBlackAuctionMesoValue -
        auctionHeld.expected.remainingWonderBlacks *
          2_000_000_000 *
          0.95,
    ) < 1e-5,
  );

  const noPrice = calculateWonderBerryBundleExpectation({ targetCount: 3 });
  assert.equal(noPrice.costs.remainingWonderBlackAuctionMesoValue, 0);
  assert.equal(noPrice.recovery.remainingBlackMethod, "keep");
  assert.equal(noPrice.costs.remainingBlackPaybackMaplePoints, 0);
  assert.equal(
    noPrice.costs.netMesoEquivalentAfterRemainingBlackSale,
    noPrice.costs.netMesoEquivalent,
  );

  assert.equal(
    calculatePetExpectation({ targetCount: 3 }).bundlePurchase.applicable,
    true,
  );
  assert.equal(
    calculatePetExpectation({
      targetCount: 3,
      sourceMode: "auction",
      wonderBlackMesoPrice: 1,
    }).bundlePurchase.applicable,
    false,
  );
  assert.equal(
    calculatePetExpectation({
      targetCount: 3,
      sourceMode: "cheapest",
      wonderBlackMesoPrice: 2_000_000_000,
      lunaDreamAuctionMesoPrice: 1_000_000_000,
      lunaKeyAuctionMesoPrice: 300_000_000,
    }).bundlePurchase.applicable,
    false,
  );
});

test("원더 블랙 자동 준비는 환산 비용이 더 싼 쪽을 고른다", () => {
  assert.equal(calculatePetExpectation().sourceMode, "cheapest");
  const berry = calculatePetExpectation({
    sourceMode: "cheapest",
    wonderBlackMesoPrice: 3_000_000_000,
  });
  assert.equal(berry.selectedSource, "wonderberry");

  const auction = calculatePetExpectation({
    sourceMode: "cheapest",
    wonderBlackMesoPrice: 100_000_000,
  });
  assert.equal(auction.selectedSource, "auction");
  assert.equal(auction.expected.wonderBerries, 0);
  assert.ok(auction.costs.blackMeso > 0);
});

test("메포 원더베리산 블랙 베이스는 교불 결과로 계산한다", () => {
  const result = calculatePetExpectation({
    sourceMode: "wonderberry",
    wonderBlackMesoPrice: 2_000_000_000,
    lunaDreamAuctionMesoPrice: 1_000_000_000,
    lunaKeyAuctionMesoPrice: 300_000_000,
  });
  assert.equal(result.selectedSource, "wonderberry");
  assert.ok(result.expected.wonderBlacksFromBerry > 0);
  assert.equal(result.expected.wonderBlacksFromAuction, 0);
  assert.equal(result.recovery.tradeableResults, false);
  assert.equal(result.recovery.dreamMethod, "payback");
  assert.equal(result.recovery.keyMesoPerItem, 0);
  assert.equal(result.costs.dreamAuctionRecoveryMeso, 0);
  assert.equal(result.costs.keyAuctionRecoveryMeso, 0);
});

test("원더 블랙·루나 스윗 경매장 구매 기준가를 계산한다", () => {
  const result = calculatePetExpectation();
  const cashToMeso = 100_000_000 / 2_000;
  const blackExpected = (
    54_000 / 11 / 0.0996 -
    (0.6 / 0.0996) * 540
  ) * cashToMeso;
  assert.ok(
    Math.abs(result.purchaseThresholds.wonderBlackMeso - blackExpected) < 1e-5,
  );

  const crystal = 3_900 * cashToMeso;
  const dreamPayback = 540 * cashToMeso;
  const sweetExpected =
    0.204 * result.comparison.wonderberryProcurementNetMesoPerTarget -
    blackExpected -
    crystal +
    0.756 * dreamPayback;
  assert.ok(
    Math.abs(result.purchaseThresholds.lunaSweetMeso - sweetExpected) < 1e-5,
  );
});

test("원더 블랙 구매 기준가는 경매장 묶음 선택과 무관하게 54k MP 기준이다", () => {
  const auctionBundleMeso = 2_500_000_000;
  const result = calculatePetExpectation({
    wonderBerryAuctionBundleMesoPrice: auctionBundleMeso,
  });
  const cashToMeso = 100_000_000 / 2_000;
  const expected = (
    54_000 / 11 / 0.0996 -
    (0.6 / 0.0996) * 540
  ) * cashToMeso;

  assert.equal(
    result.bundlePurchase.selectedProcurement,
    "auction-bundle",
  );
  assert.ok(
    Math.abs(result.purchaseThresholds.wonderBlackMeso - expected) < 1e-5,
  );
  assert.equal(
    result.comparison.berryNetMesoPerBlack,
    result.purchaseThresholds.wonderBlackMeso,
  );
  assert.equal(
    result.comparison.maplePointBerryNetMesoPerBlack,
    result.comparison.berryNetMesoPerBlack,
  );
});

test("루나 스윗 구매 기준가는 MP 직접 합성 외 입력에 영향받지 않는다", () => {
  const baseline = calculatePetExpectation({
    sourceMode: "wonderberry",
    maplePointsPer100MillionMeso: 2_000,
  });
  const expected = baseline.purchaseThresholds.lunaSweetMeso;
  const variants = [
    {
      sourceMode: "cheapest",
      wonderBlackMesoPrice: 100_000_000,
    },
    {
      sourceMode: "auction",
      wonderBlackMesoPrice: 2_000_000_000,
    },
    {
      wonderBerryAuctionBundleMesoPrice: 2_000_000_000,
      wonderBerryProcurementMode: "auction-bundle",
    },
    { lunaDreamAuctionMesoPrice: 1_000_000_000 },
    { lunaKeyAuctionMesoPrice: 300_000_000 },
    { lunaSweetAuctionMesoPrice: 800_000_000 },
    {
      wonderBerryAuctionBundleMesoPrice: 2_000_000_000,
      wonderBerryProcurementMode: "auction-bundle",
      wonderBlackMesoPrice: 2_000_000_000,
      lunaDreamAuctionMesoPrice: 1_000_000_000,
      lunaKeyAuctionMesoPrice: 300_000_000,
      lunaSweetAuctionMesoPrice: 800_000_000,
      auctionFeeRate: 0.03,
    },
    {
      costConversionBasis: "won",
      wonPer100MillionMeso: 1_400,
    },
  ];

  for (const options of variants) {
    const result = calculatePetExpectation({
      maplePointsPer100MillionMeso: 2_000,
      ...options,
    });
    assert.equal(
      result.purchaseThresholds.lunaSweetMeso,
      expected,
      JSON.stringify(options),
    );
  }
});

test("경매장 원더베리 묶음의 블랙·스윗 구매 기준가는 장기 평균 장부와 일치한다", () => {
  const options = {
    targetCount: 3,
    wonderBerryAuctionBundleMesoPrice: 3_000_000_000,
    wonderBlackMesoPrice: 2_400_000_000,
    lunaDreamAuctionMesoPrice: 800_000_000,
    lunaSweetAuctionMesoPrice: 1_100_000_000,
    lunaKeyAuctionMesoPrice: 300_000_000,
    auctionFeeRate: 0.05,
    maplePointsPer100MillionMeso: 2_000,
  };
  const result = calculatePetExpectation(options);
  const source =
    result.purchaseThresholds.byWonderBerrySource.auctionBundle;
  const paybackMeso = 540 * (100_000_000 / 2_000);
  const expectedBlacksPerBundle = 11 * 0.0996;
  const expectedPaybackMesoPerBundle = 11 * 0.6 * paybackMeso;
  const expectedBlackMeso =
    (3_000_000_000 - expectedPaybackMesoPerBundle) /
    expectedBlacksPerBundle;
  assert.equal(source.available, true);
  assert.equal(source.role, "tradeable-base");
  assert.equal(source.tradeability, "tradeable");
  assert.equal(source.basis, "long-run-average");
  assert.equal(source.remainingWonderBlackTreatment, "keep-as-inventory");
  assert.equal(source.remainingWonderBlackRecoveryMeso, 0);
  assertClose(source.wonderBlackMeso, expectedBlackMeso, "경매장 묶음 블랙 단가");
  assertClose(
    result.purchaseThresholds
      .auctionWonderBerryBundleWonderBlackMeso,
    expectedBlackMeso,
    "경매장 묶음 블랙 flat 별칭",
  );

  const first = PET_PROBABILITIES.sweetSynthesis;
  const second = PET_PROBABILITIES.dreamSynthesis;
  const routeSuccess = first.petite + first.sweet * second.petite;
  const crystalMeso = 3_900 * (100_000_000 / 2_000);
  const dreamRecovery = Math.max(
    paybackMeso,
    800_000_000 * 0.95,
  );
  const keyRecovery = 300_000_000 * 0.95;
  const routeRecovery =
    first.key * keyRecovery +
    first.sweet * (
      second.dream * dreamRecovery +
      second.key * keyRecovery
    );
  const expectedPetiteTargetMeso =
    (
      (2 + first.sweet) * expectedBlackMeso +
      (1 + first.sweet) * crystalMeso -
      routeRecovery
    ) /
    routeSuccess;
  const expectedSweetThreshold = Math.max(
    0,
    second.petite * expectedPetiteTargetMeso -
      expectedBlackMeso -
      crystalMeso +
      second.dream * paybackMeso,
  );
  assertClose(
    source.petiteTargetNetMeso,
    expectedPetiteTargetMeso,
    "경매장 묶음 최종 쁘띠 장기 평균",
  );
  assertClose(
    source.lunaSweetMeso,
    expectedSweetThreshold,
    "경매장 묶음 스윗 구매 상한",
  );
  assertClose(
    result.purchaseThresholds
      .auctionWonderBerryBundleLunaSweetMeso,
    expectedSweetThreshold,
    "경매장 묶음 스윗 flat 별칭",
  );
  assert.equal(source.lunaSweetSelfAuctionPriceApplied, false);
  assert.equal(
    result.purchaseComparisons.wonderBlack.directAuctionPurchase
      .effectiveMeso,
    options.wonderBlackMesoPrice,
  );
  assert.equal(
    result.purchaseComparisons.wonderBlack.directAuctionPurchase
      .roleLabel,
    "구매 후 교불",
  );
  assert.equal(
    result.purchaseComparisons.lunaSweet.directAuctionPurchase
      .effectiveMeso,
    options.lunaSweetAuctionMesoPrice,
  );
  assert.equal(
    result.purchaseComparisons.lunaSweet.directAuctionPurchase
      .roleLabel,
    "구매 후 교불",
  );

  // 장기 평균 기준은 최종 목표 마릿수에 의존하지 않는다.
  const one = calculatePetExpectation({ ...options, targetCount: 1 });
  assertClose(
    one.purchaseThresholds.auctionWonderBerryBundleWonderBlackMeso,
    source.wonderBlackMeso,
    "목표 마릿수와 독립인 블랙 단가",
  );
  assertClose(
    one.purchaseThresholds.auctionWonderBerryBundleLunaSweetMeso,
    source.lunaSweetMeso,
    "목표 마릿수와 독립인 스윗 구매 상한",
  );
});

test("경매장 원더베리 기준가는 메포보다 싼 경우와 비싼 경우를 구분한다", () => {
  const cheap = calculatePetExpectation({
    wonderBerryAuctionBundleMesoPrice: 2_000_000_000,
  });
  const expensive = calculatePetExpectation({
    wonderBerryAuctionBundleMesoPrice: 4_000_000_000,
  });
  const cheapSources = cheap.purchaseThresholds.byWonderBerrySource;
  const expensiveSources =
    expensive.purchaseThresholds.byWonderBerrySource;

  assert.ok(
    cheapSources.auctionBundle.wonderBlackMeso <
      cheapSources.maplePoint.wonderBlackMeso,
  );
  assert.ok(
    cheapSources.auctionBundle.lunaSweetMeso <
      cheapSources.maplePoint.lunaSweetMeso,
  );
  assert.equal(
    cheap.purchaseComparisons.wonderBlack.recommendedRoute,
    "auctionWonderBerryBundle",
  );

  assert.ok(
    expensiveSources.auctionBundle.wonderBlackMeso >
      expensiveSources.maplePoint.wonderBlackMeso,
  );
  assert.ok(
    expensiveSources.auctionBundle.lunaSweetMeso >
      expensiveSources.maplePoint.lunaSweetMeso,
  );
  assert.equal(
    expensive.purchaseComparisons.wonderBlack.recommendedRoute,
    "maplePointWonderBerry",
  );
});

test("경매장 묶음 기준가는 수수료를 반영하되 자기 스윗 시세를 회수하지 않는다", () => {
  const common = {
    wonderBerryAuctionBundleMesoPrice: 3_000_000_000,
    lunaDreamAuctionMesoPrice: 1_000_000_000,
    lunaKeyAuctionMesoPrice: 300_000_000,
  };
  const fee5 = calculatePetExpectation({
    ...common,
    auctionFeeRate: 0.05,
    lunaSweetAuctionMesoPrice: 100_000_000,
  });
  const fee3 = calculatePetExpectation({
    ...common,
    auctionFeeRate: 0.03,
    lunaSweetAuctionMesoPrice: 100_000_000,
  });
  const highSweetPrice = calculatePetExpectation({
    ...common,
    auctionFeeRate: 0.05,
    lunaSweetAuctionMesoPrice: 9_000_000_000,
  });

  const source5 = fee5.purchaseThresholds.byWonderBerrySource.auctionBundle;
  const source3 = fee3.purchaseThresholds.byWonderBerrySource.auctionBundle;
  assert.equal(source5.wonderBlackMeso, source3.wonderBlackMeso);
  assert.ok(source3.petiteTargetNetMeso < source5.petiteTargetNetMeso);
  assert.ok(source3.lunaSweetMeso < source5.lunaSweetMeso);
  assert.equal(
    highSweetPrice.purchaseThresholds
      .auctionWonderBerryBundleLunaSweetMeso,
    fee5.purchaseThresholds.auctionWonderBerryBundleLunaSweetMeso,
  );
  assert.equal(
    fee5.purchaseComparisons.lunaSweet.directAuctionPurchase
      .effectiveMeso,
    100_000_000,
  );
  assert.equal(
    highSweetPrice.purchaseComparisons.lunaSweet
      .directAuctionPurchase.effectiveMeso,
    9_000_000_000,
  );
  assert.equal(
    fee5.purchaseComparisons.lunaSweet.directPurchaseIsCompetitive,
    true,
  );
  assert.equal(
    fee5.purchaseComparisons.lunaSweet.recommendedRoute,
    "directAuctionPurchase",
  );
  assert.equal(
    highSweetPrice.purchaseComparisons.lunaSweet
      .directPurchaseIsCompetitive,
    false,
  );
  assert.equal(
    highSweetPrice.purchaseComparisons.lunaSweet.recommendedRoute,
    highSweetPrice.purchaseComparisons.lunaSweet
      .bestSelfProductionRoute,
  );
});

test("경매장 묶음 시세가 0 또는 null이면 새 경로를 사용 불가로 반환한다", () => {
  for (const price of [0, null]) {
    const result = calculatePetExpectation({
      wonderBerryAuctionBundleMesoPrice: price,
      wonderBlackMesoPrice: 0,
      lunaSweetAuctionMesoPrice: 0,
    });
    const source =
      result.purchaseThresholds.byWonderBerrySource.auctionBundle;
    assert.equal(source.available, false);
    assert.equal(source.wonderBlackMeso, null);
    assert.equal(source.lunaSweetMeso, null);
    assert.equal(source.petiteTargetNetMeso, null);
    assert.equal(
      result.purchaseThresholds
        .auctionWonderBerryBundleWonderBlackMeso,
      null,
    );
    assert.equal(
      result.purchaseThresholds
        .auctionWonderBerryBundleLunaSweetMeso,
      null,
    );
    assert.equal(
      result.purchaseComparisons.wonderBlack
        .auctionWonderBerryBundle.available,
      false,
    );
    assert.equal(
      result.purchaseComparisons.wonderBlack
        .directAuctionPurchase.available,
      false,
    );
    assert.equal(
      result.purchaseComparisons.lunaSweet
        .directAuctionPurchase.available,
      false,
    );
  }
});

test("페이백 기대액보다 싼 경매장 묶음도 구매 기준가를 음수로 만들지 않는다", () => {
  const result = calculatePetExpectation({
    wonderBerryAuctionBundleMesoPrice: 1,
    lunaDreamAuctionMesoPrice: 100_000_000_000,
    lunaKeyAuctionMesoPrice: 100_000_000_000,
  });
  const source =
    result.purchaseThresholds.byWonderBerrySource.auctionBundle;
  assert.equal(source.available, true);
  assert.ok(source.bundleNetMesoBeforeBlackInventory < 0);
  assert.equal(source.wonderBlackMeso, 0);
  assert.equal(source.petiteTargetNetMeso, 0);
  assert.equal(source.lunaSweetMeso, 0);
  assert.equal(
    result.purchaseThresholds
      .auctionWonderBerryBundleWonderBlackMeso,
    0,
  );
  assert.equal(
    result.purchaseThresholds
      .auctionWonderBerryBundleLunaSweetMeso,
    0,
  );
});

test("원더 펫만 540 MP 페이백하고 소비 아이템은 제외한다", () => {
  const result = calculatePetExpectation();
  assert.ok(
    Math.abs(
      result.expected.wonderPetPaybacks -
        result.expected.wonderBerries * 0.6,
    ) < 1e-12,
  );
  assert.ok(
    Math.abs(
      result.expected.wonderConsumables -
        result.expected.wonderBerries * 0.3004,
    ) < 1e-12,
  );
  assert.ok(
    Math.abs(
      result.expected.wonderBlacks +
        result.expected.wonderPetPaybacks +
        result.expected.wonderConsumables -
        result.expected.wonderBerries,
    ) < 1e-12,
  );
  assert.ok(
    Math.abs(
      result.costs.wonderPetPaybackCash -
        result.expected.wonderPetPaybacks * 540,
    ) < 1e-12,
  );
});

test("메포 묶음 산출 드림은 페이백만, 키는 회수 없이 계산한다", () => {
  const baseline = calculatePetExpectation();
  const recovered = calculatePetExpectation({
    lunaDreamAuctionMesoPrice: 1_000_000_000,
    lunaKeyAuctionMesoPrice: 300_000_000,
    auctionFeeRate: 0.05,
  });
  assert.equal(
    recovered.costs.grossMesoEquivalent,
    baseline.costs.grossMesoEquivalent,
  );
  assert.equal(
    recovered.costs.netMesoEquivalent,
    baseline.costs.netMesoEquivalent,
  );
  assert.equal(recovered.recovery.dreamMethod, "payback");
  assert.equal(recovered.recovery.dreamMesoPerPet, 27_000_000);
  assert.equal(recovered.recovery.keyMesoPerItem, 0);
  assert.equal(recovered.costs.dreamAuctionRecoveryMeso, 0);
  assert.equal(recovered.costs.keyAuctionRecoveryMeso, 0);
  assert.equal(
    recovered.costs.totalPetPaybackMaplePoints,
    recovered.costs.wonderPetPaybackMaplePoints +
      recovered.costs.dreamPaybackMaplePoints,
  );

  const lowDream = calculatePetExpectation({
    lunaDreamAuctionMesoPrice: 20_000_000,
  });
  assert.equal(lowDream.recovery.dreamMethod, "payback");
  assert.equal(lowDream.recovery.dreamMesoPerPet, 27_000_000);
});

test("옥션 수수료는 경매장 묶음 산출물에만 적용한다", () => {
  const common = {
    lunaDreamAuctionMesoPrice: 1_000_000_000,
    lunaKeyAuctionMesoPrice: 300_000_000,
  };
  const five = calculatePetExpectation({ ...common, auctionFeeRate: 0.05 });
  const three = calculatePetExpectation({ ...common, auctionFeeRate: 0.03 });
  assert.equal(five.recovery.dreamAuctionNetMeso, 950_000_000);
  assert.equal(five.recovery.keyAuctionNetMeso, 285_000_000);
  assert.equal(three.recovery.dreamAuctionNetMeso, 970_000_000);
  assert.equal(three.recovery.keyAuctionNetMeso, 291_000_000);
  assert.equal(three.costs.netMesoEquivalent, five.costs.netMesoEquivalent);

  const auctionCommon = {
    ...common,
    wonderBerryAuctionBundleMesoPrice: 2_000_000_000,
    wonderBerryProcurementMode: "auction-bundle",
    wonderBlackMesoPrice: 2_000_000_000,
  };
  const auctionFive = calculateWonderBerryBundleExpectation({
    ...auctionCommon,
    auctionFeeRate: 0.05,
  });
  const auctionThree = calculateWonderBerryBundleExpectation({
    ...auctionCommon,
    auctionFeeRate: 0.03,
  });
  assert.equal(auctionFive.recovery.dreamAuctionNetMeso, 950_000_000);
  assert.equal(auctionFive.recovery.keyAuctionNetMeso, 285_000_000);
  assert.equal(auctionThree.recovery.dreamAuctionNetMeso, 970_000_000);
  assert.equal(auctionThree.recovery.keyAuctionNetMeso, 291_000_000);
  assert.ok(
    auctionThree.costs.netMesoEquivalent <
      auctionFive.costs.netMesoEquivalent,
  );
});

test("교가 드림은 540 MP 페이백과 옥션 순수령액의 경계에서 큰 쪽을 쓴다", () => {
  const common = {
    wonderBerryAuctionBundleMesoPrice: 2_000_000_000,
    wonderBerryProcurementMode: "auction-bundle",
    lunaDreamAuctionMesoPrice: 28_000_000,
  };
  const five = calculateWonderBerryBundleExpectation({
    ...common,
    auctionFeeRate: 0.05,
  });
  const three = calculateWonderBerryBundleExpectation({
    ...common,
    auctionFeeRate: 0.03,
  });

  assert.equal(five.recovery.paybackMesoPerPet, 27_000_000);
  assert.equal(five.recovery.dreamAuctionNetMeso, 26_600_000);
  assert.equal(five.recovery.dreamMethod, "payback");
  assert.equal(five.recovery.dreamAuctionSaleApplied, false);
  assert.equal(
    five.recovery.dreamAuctionSaleNonApplicationReason,
    "payback-higher-or-equal",
  );
  assert.ok(
    Math.abs(three.recovery.dreamAuctionNetMeso - 27_160_000) < 1e-8,
  );
  assert.equal(three.recovery.dreamMethod, "auction");
  assert.equal(three.recovery.dreamAuctionSaleApplied, true);
});

test("옥션산 블랙 경로는 드림 페이백만 적용하고 키 판매는 제외한다", () => {
  const result = calculatePetExpectation({
    sourceMode: "auction",
    wonderBlackMesoPrice: 2_000_000_000,
    lunaDreamAuctionMesoPrice: 1_000_000_000,
    lunaKeyAuctionMesoPrice: 300_000_000,
  });
  assert.equal(result.recovery.tradeableResults, false);
  assert.equal(result.recovery.dreamMethod, "payback");
  assert.equal(result.recovery.dreamMesoPerPet, 27_000_000);
  assert.equal(result.recovery.keyMesoPerItem, 0);
  assert.equal(result.costs.keyRecoveryMeso, 0);
  assert.equal(result.costs.wonderPetPaybackCash, 0);
});

test("목표 도달 경로 수는 이항분포와 경계가 맞는다", () => {
  const p = getPetiteRouteProbability();
  assert.equal(probabilityOfTargetWithinRoutes(0, 1, p), 0);
  assert.equal(probabilityOfTargetWithinRoutes(1, 1, p), p);
  const routes = routesForTargetChance(1, 0.95, p);
  assert.ok(probabilityOfTargetWithinRoutes(routes, 1, p) >= 0.95);
  assert.ok(probabilityOfTargetWithinRoutes(routes - 1, 1, p) < 0.95);
  for (const targetCount of [2, 3]) {
    const multipleRoutes = routesForTargetChance(targetCount, 0.95, p);
    assert.ok(
      probabilityOfTargetWithinRoutes(multipleRoutes, targetCount, p) >= 0.95,
    );
    assert.ok(
      probabilityOfTargetWithinRoutes(
        multipleRoutes - 1,
        targetCount,
        p,
      ) < 0.95,
    );
  }
});

test("경매장 모드는 원더 블랙 시세가 비어 있으면 막는다", () => {
  assert.throws(
    () => calculatePetExpectation({ sourceMode: "auction" }),
    /원더 블랙 시세/,
  );
});

test("구매 비용은 환산 기준과 무관하게 메이플포인트 장부로 고정한다", () => {
  const common = {
    sourceMode: "wonderberry",
    wonderBerryBundleMaplePoints: 60_000,
    lunaCrystalMaplePoints: 4_100,
  };
  const maplePoint = calculatePetExpectation({
    ...common,
    costConversionBasis: "maple-point",
    maplePointsPer100MillionMeso: 2_000,
  });
  const won = calculatePetExpectation({
    ...common,
    costConversionBasis: "won",
    maplePointsPer100MillionMeso: 2_000,
    wonPer100MillionMeso: 1_400,
  });

  for (const key of [
    "unitWonderBerryMaplePoints",
    "berryMaplePoints",
    "crystalMaplePoints",
    "grossMaplePoints",
    "wonderPetPaybackMaplePoints",
  ]) {
    assert.equal(won.costs[key], maplePoint.costs[key], key);
  }
  assert.equal(maplePoint.costs.berryCash, maplePoint.costs.berryMaplePoints);
  assert.equal(maplePoint.costs.crystalCash, maplePoint.costs.crystalMaplePoints);
  assert.equal(maplePoint.costs.grossCash, maplePoint.costs.grossMaplePoints);
  assert.equal(
    won.costs.grossMesoEquivalent,
    maplePoint.costs.grossMesoEquivalent,
  );
  assert.equal(
    won.costs.recoveryMesoEquivalent,
    maplePoint.costs.recoveryMesoEquivalent,
  );
  assert.equal(
    won.costs.netMesoEquivalent,
    maplePoint.costs.netMesoEquivalent,
  );

  const canonicalBundle = calculateWonderBerryBundleExpectation({
    targetCount: 1,
    wonderBerryBundleMaplePoints: 60_000,
    lunaCrystalMaplePoints: 4_100,
  });
  const legacyBundle = calculateWonderBerryBundleExpectation({
    targetCount: 1,
    wonderBerryBundlePrice: 60_000,
    lunaCrystalPrice: 4_100,
  });
  assert.equal(
    canonicalBundle.costs.grossMaplePoints,
    legacyBundle.costs.grossCash,
  );
  assert.equal(
    canonicalBundle.costs.wonderPetPaybackMaplePoints,
    legacyBundle.costs.wonderPetPaybackCash,
  );
});

test("원 시세는 구매 기준가와 가장 싼 준비 경로를 바꾸지 않는다", () => {
  const common = {
    sourceMode: "cheapest",
    wonderBlackMesoPrice: 2_700_000_000,
    maplePointsPer100MillionMeso: 2_000,
  };
  const maplePoint = calculatePetExpectation({
    ...common,
    costConversionBasis: "maple-point",
  });
  const won = calculatePetExpectation({
    ...common,
    costConversionBasis: "won",
    wonPer100MillionMeso: 1_400,
  });

  assert.equal(maplePoint.selectedSource, "wonderberry");
  assert.equal(won.selectedSource, maplePoint.selectedSource);
  assert.equal(
    won.purchaseThresholds.wonderBlackMeso,
    maplePoint.purchaseThresholds.wonderBlackMeso,
  );
  assert.equal(won.costs.netMesoEquivalent, maplePoint.costs.netMesoEquivalent);
  assert.equal(
    won.bundlePurchase.selectedProcurement,
    maplePoint.bundlePurchase.selectedProcurement,
  );
});

test("환산 기준과 두 시세를 결과 메타데이터에 명시하고 기존 별칭을 보존한다", () => {
  const result = calculatePetExpectation({
    costConversionBasis: "won",
    maplePointsPer100MillionMeso: 2_000,
    wonPer100MillionMeso: 1_400,
  });

  assert.equal(result.costConversionBasis, "won");
  assert.equal(result.currency.purchaseLedger, "maple-point");
  assert.equal(result.currency.costConversionBasis, "won");
  assert.equal(result.currency.conversionBasis, "maple-point");
  assert.equal(
    result.currency.calculationConversionBasis,
    "maple-point-market",
  );
  assert.equal(result.currency.maplePointsPer100MillionMeso, 2_000);
  assert.equal(result.currency.wonPer100MillionMeso, 1_400);
  assert.equal(result.currency.maplePointToMeso, 50_000);
  assert.equal(result.currency.wonToMeso, 100_000_000 / 1_400);
  assert.equal(result.costs.costConversionBasis, "won");
  assert.equal(
    result.costs.conversionToMeso,
    result.currency.maplePointToMeso,
  );
  assert.equal(result.costs.cashToMeso, result.costs.conversionToMeso);
  assert.equal(
    result.bundlePurchase.currency.costConversionBasis,
    result.currency.costConversionBasis,
  );
  assert.throws(
    () => calculatePetExpectation({ costConversionBasis: "won" }),
    /1억 메소 시세/,
  );
  assert.throws(
    () => calculatePetExpectation({ costConversionBasis: "cash" }),
    /maple-point 또는 won/,
  );
});

test("고정 원더베리 수량은 메포 묶음과 경매장 묶음 중 싼 출처를 고른다", () => {
  const auction = optimizeWonderBerryProcurement({
    requiredWonderBerries: 13,
    wonderBerryAuctionBundleMesoPrice: 2_500_000_000,
  });
  assert.equal(auction.selectedProcurement, "auction-bundle");
  assert.equal(auction.plan.purchasedBundles, 2);
  assert.equal(auction.plan.maplePointBundles, 0);
  assert.equal(auction.plan.auctionBundles, 2);
  assert.equal(auction.plan.suppliedWonderBerries, 22);
  assert.equal(auction.plan.excessWonderBerries, 9);
  assert.equal(auction.plan.bundleMaplePoints, 0);
  assert.equal(auction.plan.auctionBundleMeso, 5_000_000_000);
  assert.equal(auction.plan.totalMesoEquivalent, 5_000_000_000);
  assert.equal(
    auction.comparison.auctionBundleBreakEvenMeso,
    2_700_000_000,
  );
  assert.equal(
    auction.tradeability.auctionWonderBerryBundleTradableAfterReceipt,
    false,
  );
  assert.equal(auction.tradeability.openedResultsFollowNormalRules, true);

  const maplePoint = optimizeWonderBerryProcurement({
    requiredWonderBerries: 13,
    wonderBerryAuctionBundleMesoPrice: 3_000_000_000,
  });
  assert.equal(maplePoint.selectedProcurement, "maple-point-bundle");
  assert.equal(maplePoint.plan.maplePointBundles, 2);
  assert.equal(maplePoint.plan.auctionBundles, 0);
  assert.equal(maplePoint.plan.bundleMaplePoints, 108_000);
  assert.equal(maplePoint.plan.totalMesoEquivalent, 5_400_000_000);

  const tie = optimizeWonderBerryProcurement({
    requiredWonderBerries: 1,
    wonderBerryAuctionBundleMesoPrice: 2_700_000_000,
  });
  assert.equal(tie.selectedProcurement, "maple-point-bundle");

  const forcedAuction = optimizeWonderBerryProcurement({
    requiredWonderBerries: 13,
    wonderBerryAuctionBundleMesoPrice: 3_000_000_000,
    wonderBerryProcurementMode: "auction-bundle",
  });
  assert.equal(forcedAuction.plan.auctionBundles, 2);
  assert.throws(
    () => optimizeWonderBerryProcurement({
      requiredWonderBerries: 1,
      wonderBerryProcurementMode: "auction-bundle",
    }),
    /경매장 시세/,
  );
  assert.throws(
    () => optimizeWonderBerryProcurement({
      requiredWonderBerries: 1,
      wonderBerryProcurementMode: "individual",
    }),
    /조달 방식/,
  );
});

test("목표확률 준비는 개별 베리 당첨선과 최저가 묶음 구매량을 결합한다", () => {
  for (const targetCount of [1, 2, 3]) {
    const result = calculateWonderBerryTargetProcurement({
      targetCount,
      targetChance: 0.8,
      wonderBerryAuctionBundleMesoPrice: 2_500_000_000,
    });
    assert.equal(
      result.requiredWonderBerries,
      wonderBerriesForTargetChance(targetCount, 0.8),
    );
    assert.equal(
      result.actualChance,
      probabilityOfTargetWithinWonderBerries(
        result.requiredWonderBerries,
        targetCount,
      ),
    );
    assert.equal(
      result.previousChance,
      probabilityOfTargetWithinWonderBerries(
        result.requiredWonderBerries - 1,
        targetCount,
      ),
    );
    assert.ok(result.actualChance >= 0.8);
    assert.ok(result.previousChance < 0.8);
    assert.equal(result.purchaseUnitLabel, "묶음");
    assert.equal(result.purchaseUnitSize, 11);
    assert.equal(
      result.purchaseUnits,
      Math.ceil(result.requiredWonderBerries / 11),
    );
    assert.equal(result.selectedProcurement, "auction-bundle");
    assert.equal(result.plan.maplePointBundles, 0);
    assert.equal(result.plan.auctionBundles, result.purchaseUnits);
    assert.ok(
      result.suppliedWonderBerries >= result.requiredWonderBerries,
    );
    assert.equal(
      result.unopenedWonderBerries,
      result.suppliedWonderBerries - result.requiredWonderBerries,
    );
    assert.equal(
      result.costs.berryProcurementMesoEquivalent,
      result.plan.totalMesoEquivalent,
    );
    assert.equal(result.costScope, "gross-procurement-only");
  }

  assert.throws(
    () => calculateWonderBerryTargetProcurement({ targetChance: 80 }),
    /0보다 크고 1보다 작아야/,
  );
});

test("목표확률 완료비용은 전량 개봉한 N번째 11개 묶음 장부를 사용한다", () => {
  const chance = (
    probabilityOfTargetWithinBundles(1, 1) +
    probabilityOfTargetWithinBundles(2, 1)
  ) / 2;
  const result = calculateWonderBerryPercentileCompletionExpectation({
    wonderBerryAuctionBundleMesoPrice: 2_500_000_000,
    targetChance: chance,
  });

  assert.equal(result.requiredWonderBerries, null);
  assert.equal(result.completionWonderBerry, null);
  assert.equal(result.completionUnitKind, "bundle");
  assert.equal(result.selectedProcurement, "auction-bundle");
  assert.equal(result.purchaseUnits, 2);
  assert.equal(result.requiredPurchaseBundles, 2);
  assert.equal(result.purchaseUnitLabel, "묶음");
  assert.equal(result.purchaseUnitSize, 11);
  assert.equal(
    result.purchaseUnitMeaning,
    "purchased-wonderberry-bundles",
  );
  assert.equal(result.plan.maplePointBundles, 0);
  assert.equal(result.plan.auctionBundles, 2);
  assert.equal(result.plan.suppliedWonderBerries, 22);
  assert.equal(result.plan.excessWonderBerries, 0);
  assert.equal(result.costs.berryMaplePoints, 0);
  assert.equal(result.costs.wonderBerryAuctionBundleMeso, 5_000_000_000);
  assert.equal(
    result.costs.berryProcurementMesoEquivalent,
    5_000_000_000,
  );
  assert.equal(result.expected.purchasedUnits, 2);
  assert.equal(result.expected.openedWonderBerries, 22);
  assert.equal(result.expected.purchasedMaplePointBundles, 0);
  assert.equal(result.expected.purchasedAuctionWonderBerryBundles, 2);
  assert.equal(result.completion, result.candidates.optimized.completion);
  assert.ok(
    result.plan.totalMesoEquivalent <=
      result.candidates.maplePointBundle.plan.totalMesoEquivalent,
  );
  assert.ok(
    result.plan.totalMesoEquivalent <=
      result.candidates.auctionBundle.plan.totalMesoEquivalent,
  );
  assert.ok(result.actualChance >= chance);
  assert.ok(result.previousChance < chance);

  const firstBundle = calculateWonderBerryPercentileCompletionExpectation({
    wonderBerryAuctionBundleMesoPrice: 3_000_000_000,
    targetChance: probabilityOfTargetWithinBundles(1, 1) / 2,
  });
  assert.equal(firstBundle.requiredWonderBerries, null);
  assert.equal(firstBundle.selectedProcurement, "maple-point-bundle");
  assert.equal(firstBundle.plan.maplePointBundles, 1);
  assert.equal(firstBundle.suppliedWonderBerries, 11);
  assert.equal(firstBundle.unopenedWonderBerries, 0);
  assert.equal(firstBundle.expected.openedWonderBerries, 11);
});

test("목표확률 완료 전략은 1~3마리·이벤트 ON/OFF에서 각 단위의 최소 경계를 보존한다", () => {
  for (const targetCount of [1, 2, 3]) {
    for (const wonderBlackEvent of [false, true]) {
      const result =
        calculateWonderBerryPercentileCompletionExpectation({
          targetCount,
          wonderBlackEvent,
          targetChance: 0.8,
          wonderBerryAuctionBundleMesoPrice: 2_500_000_000,
        });
      for (const candidate of Object.values(result.candidates)) {
        assert.ok(candidate);
        assert.ok(Number.isInteger(candidate.purchaseUnits));
        assert.ok(candidate.purchaseUnits >= 1);
        assert.equal(candidate.completionUnitKind, "bundle");
        assert.equal(candidate.requiredWonderBerries, null);
        assert.equal(candidate.completion.completionWonderBerry, null);
        assert.equal(candidate.completion.completionUnitKind, "bundle");
        assert.equal(candidate.unopenedWonderBerries, 0);
        assert.equal(
          candidate.suppliedWonderBerries,
          candidate.purchaseUnits * 11,
        );
        assertClose(
          candidate.completion.expected.openedWonderBerries,
          candidate.purchaseUnits * 11,
          "분위수 전량 개봉",
        );
        assertClose(
          candidate.completion.expected.purchasedMaplePointBundles +
            candidate.completion.expected
              .purchasedAuctionWonderBerryBundles,
          candidate.purchaseUnits,
          "분위수 조달처별 묶음 합",
        );
        assertClose(
          candidate.plan.maplePointBundles,
          candidate.completion.expected.purchasedMaplePointBundles,
          "분위수 메포 묶음 계획",
        );
        assertClose(
          candidate.plan.auctionBundles,
          candidate.completion.expected
            .purchasedAuctionWonderBerryBundles,
          "분위수 경매장 묶음 계획",
        );
        assert.ok(candidate.actualChance >= 0.8);
        assert.ok(candidate.previousChance < 0.8);
        assertClose(
          candidate.completion.completionProbability,
          candidate.actualChance - candidate.previousChance,
          "분위수 묶음 첫 달성 확률",
        );
        assert.equal(
          candidate.actualChance,
          candidate.completion.cumulativeChance,
        );
        assert.equal(
          candidate.netMesoEquivalentAfterRemainingBlackSale,
          candidate.completion.costs
            .netMesoEquivalentAfterRemainingBlackSale,
        );
      }
      const selected = result.candidates.optimized;
      assert.equal(result.purchaseUnits, selected.purchaseUnits);
      assert.equal(result.purchaseUnitLabel, selected.purchaseUnitLabel);
      assert.equal(result.purchaseUnitSize, selected.purchaseUnitSize);
      assert.equal(result.actualChance, selected.actualChance);
      assert.equal(result.completion, selected.completion);
      assert.equal(result.costs, selected.completion.costs);
      assert.ok(
        selected.netMesoEquivalentAfterRemainingBlackSale <=
          result.candidates.maplePointBundle
            .netMesoEquivalentAfterRemainingBlackSale,
      );
      assert.ok(
        selected.netMesoEquivalentAfterRemainingBlackSale <=
          result.candidates.auctionBundle
            .netMesoEquivalentAfterRemainingBlackSale,
      );
      assert.ok(
        selected.netMesoEquivalentAfterRemainingBlackSale <=
          result.candidates.hybridBundle
            .netMesoEquivalentAfterRemainingBlackSale,
      );
      const hybrid = result.candidates.hybridBundle.completion.expected;
      assertClose(
        hybrid.tradeableWonderBlacksConsumedAsBase,
        hybrid.sweetSynthesisAttempts,
        "분위수 하이브리드 교가 베이스",
      );
      assertClose(
        hybrid.untradeableWonderBlacksConsumedAsMaterial,
        hybrid.sweetSynthesisAttempts + hybrid.dreamSynthesisAttempts,
        "분위수 하이브리드 교불 재료",
      );
      assertClose(
        hybrid.tradeableWonderBlacksPulled -
          hybrid.tradeableWonderBlacksConsumedAsBase,
        hybrid.remainingTradeableWonderBlacks,
        "분위수 하이브리드 남은 교가 블랙",
      );
      assertClose(
        hybrid.untradeableWonderBlacksPulled -
          hybrid.untradeableWonderBlacksConsumedAsMaterial,
        hybrid.remainingUntradeableWonderBlacks,
        "분위수 하이브리드 남은 교불 블랙",
      );
    }
  }
});

test("경매장 원더베리 시세가 없으면 목표확률 완료 전략은 메포 묶음을 유지한다", () => {
  const result = calculateWonderBerryPercentileCompletionExpectation({
    targetCount: 3,
    wonderBlackEvent: true,
    targetChance: 0.8,
  });
  assert.equal(result.selectedProcurement, "maple-point-bundle");
  assert.equal(result.purchaseUnitLabel, "묶음");
  assert.equal(result.purchaseUnitSize, 11);
  assert.equal(result.plan.auctionBundles, 0);
  assert.ok(result.plan.maplePointBundles > 0);
  assert.equal(result.candidates.auctionBundle, null);
  assert.equal(
    result.completion.selectedProcurement,
    "maple-point-bundle",
  );
  assert.throws(
    () => calculateWonderBerryPercentileCompletionExpectation({
      targetChance: 80,
    }),
    /0보다 크고 1보다 작아야/,
  );
});

test("분위수 완료 캐시는 외부 결과 변경에 오염되지 않고 가격 장부를 다시 계산한다", () => {
  const options = {
    targetCount: 3,
    targetChance: 0.9999,
    wonderBerryAuctionBundleMesoPrice: 3_000_000_000,
    wonderBerryProcurementMode: "hybrid-bundle",
    wonderBlackMesoPrice: 2_000_000_000,
    lunaDreamAuctionMesoPrice: 1_000_000_000,
    lunaSweetAuctionMesoPrice: 1_500_000_000,
    lunaKeyAuctionMesoPrice: 300_000_000,
  };
  const first =
    calculateWonderBerryPercentileCompletionExpectation(options);
  const baselineOpened = first.expected.openedWonderBerries;
  const baselineProbability =
    first.completion.remainingHybridInventoryDistribution[0]
      .probability;
  const baselineActualChance = first.actualChance;
  const baselineGross = first.costs.grossMesoEquivalent;

  // public 결과는 호출자 소유다. 내부 canonical cache와 참조를
  // 공유하지 않아 다음 호출의 확률·보상에 영향을 주지 않아야 한다.
  first.expected.openedWonderBerries = -1;
  first.completion.remainingHybridInventoryDistribution[0]
    .probability = -1;
  const second =
    calculateWonderBerryPercentileCompletionExpectation(options);
  assert.equal(second.expected.openedWonderBerries, baselineOpened);
  assert.equal(
    second.completion.remainingHybridInventoryDistribution[0]
      .probability,
    baselineProbability,
  );
  assert.equal(second.actualChance, baselineActualChance);
  assert.notEqual(second.expected, first.expected);
  assert.notEqual(
    second.completion.remainingHybridInventoryDistribution,
    first.completion.remainingHybridInventoryDistribution,
  );

  // 동역학 cache key에는 가격이 들어가지 않지만, 비용 장부는 매번
  // 현재 입력으로 새로 조립한다.
  const repriced =
    calculateWonderBerryPercentileCompletionExpectation({
      ...options,
      wonderBerryAuctionBundleMesoPrice: 3_100_000_000,
      auctionFeeRate: 0.03,
    });
  assert.equal(repriced.actualChance, baselineActualChance);
  assert.equal(repriced.expected.openedWonderBerries, baselineOpened);
  assert.notEqual(repriced.costs.grossMesoEquivalent, baselineGross);

  const pureOptions = {
    targetCount: 3,
    targetChance: 0.9999,
    wonderBerryProcurementMode: "maple-point-bundle",
  };
  const pureFirst =
    calculateWonderBerryPercentileCompletionExpectation(pureOptions);
  const pureOpened = pureFirst.expected.openedWonderBerries;
  const pureInventoryProbability =
    pureFirst.completion.remainingWonderBlackDistribution[0]
      .probability;
  pureFirst.expected.openedWonderBerries = -1;
  pureFirst.completion.remainingWonderBlackDistribution[0]
    .probability = -1;
  const pureSecond =
    calculateWonderBerryPercentileCompletionExpectation(pureOptions);
  assert.equal(pureSecond.expected.openedWonderBerries, pureOpened);
  assert.equal(
    pureSecond.completion.remainingWonderBlackDistribution[0]
      .probability,
    pureInventoryProbability,
  );
});

test("경매장산 원더베리 묶음도 개봉 산출물 페이백·판매 회수를 반영한다", () => {
  const result = calculateWonderBerryBundleExpectation({
    wonderBerryAuctionBundleMesoPrice: 2_000_000_000,
    wonderBlackMesoPrice: 2_000_000_000,
    lunaDreamAuctionMesoPrice: 1_000_000_000,
    lunaKeyAuctionMesoPrice: 300_000_000,
  });

  assert.equal(result.selectedProcurement, "auction-bundle");
  assert.equal(result.purchaseUnitLabel, "묶음");
  assert.equal(result.purchaseUnitSize, 11);
  assert.equal(result.policy.bundleSize, 11);
  assert.equal(result.wonderBerryProcurement, result.procurement);
  assert.equal(
    result.expected.purchasedAuctionWonderBerryBundles,
    result.expected.purchasedUnits,
  );
  assert.equal(result.expected.purchasedMaplePointBundles, 0);
  assert.ok(
    Math.abs(
      result.expected.openedWonderBerries -
        result.expected.purchasedAuctionWonderBerryBundles * 11,
    ) < 1e-10,
  );
  assert.ok(result.expected.wonderUpperPetsPulled > 0);
  assert.equal(
    result.expected.wonderPetPaybacks,
    result.expected.wonderUpperPetsPulled,
  );
  assert.equal(result.expected.wonderPetPaybacksIneligible, 0);
  assert.equal(result.costs.berryMaplePoints, 0);
  assert.ok(
    Math.abs(
      result.costs.wonderBerryAuctionBundleMeso -
        result.expected.purchasedAuctionWonderBerryBundles * 2_000_000_000,
    ) < 1e-6,
  );
  assert.ok(result.costs.wonderPetPaybackMaplePoints > 0);
  assert.ok(result.costs.remainingWonderBlackAuctionMesoValue >= 0);
  assert.ok(result.costs.dreamPaybackMaplePoints > 0);
  assert.ok(result.costs.dreamAuctionRecoveryMeso > 0);
  assert.ok(result.costs.keyAuctionRecoveryMeso > 0);
  assert.equal(result.recovery.keyMesoPerItem, 285_000_000);
  assert.equal(result.recovery.dreamMethod, "auction");
  assert.equal(result.recovery.dreamAuctionSaleApplicable, true);
  assert.equal(result.recovery.dreamAuctionSaleApplied, true);
  assert.equal(result.recovery.keyAuctionSaleApplied, true);
  assert.ok(
    Math.abs(
      result.costs.recoveryMesoEquivalent -
        (result.costs.totalPetPaybackMaplePoints *
          result.costs.maplePointToMeso +
          result.costs.totalAuctionRecoveryMeso),
    ) < 1e-5,
  );
  assert.equal(
    result.procurement.tradeability
      .auctionWonderBerryBundleTradableAfterReceipt,
    false,
  );
  assert.equal(
    result.procurement.tradeability.openedResultsFollowNormalRules,
    true,
  );
  assert.equal(
    result.procurement.tradeability.wonderBlackTradable,
    true,
  );
  assert.equal(
    result.procurement.tradeability.synthesisResultTradable,
    true,
  );
  assert.equal(
    result.procurement.tradeability.outputTradeability,
    "tradeable-once",
  );
});

test("메포 묶음과 경매장 묶음을 강제하거나 순비용으로 자동 선택한다", () => {
  const common = {
    wonderBerryAuctionBundleMesoPrice: 2_000_000_000,
    wonderBlackMesoPrice: 2_000_000_000,
    lunaDreamAuctionMesoPrice: 1_000_000_000,
    lunaKeyAuctionMesoPrice: 300_000_000,
  };
  const automatic = calculateWonderBerryBundleExpectation(common);
  const forcedBundle = calculateWonderBerryBundleExpectation({
    ...common,
    wonderBerryProcurementMode: "maple-point-bundle",
  });
  const forcedAuctionBundle = calculateWonderBerryBundleExpectation({
    ...common,
    wonderBerryProcurementMode: "auction-bundle",
  });

  assert.equal(automatic.selectedProcurement, "auction-bundle");
  assert.equal(forcedBundle.selectedProcurement, "maple-point-bundle");
  assert.equal(forcedAuctionBundle.selectedProcurement, "auction-bundle");
  assert.ok(forcedBundle.expected.wonderPetPaybacks > 0);
  assert.ok(forcedAuctionBundle.expected.wonderPetPaybacks > 0);
  assert.equal(forcedBundle.purchaseUnitLabel, "묶음");
  assert.equal(forcedAuctionBundle.purchaseUnitLabel, "묶음");
  assert.equal(
    forcedBundle.procurement.tradeability.wonderBlackTradable,
    false,
  );
  assert.equal(
    forcedBundle.procurement.tradeability.synthesisResultTradable,
    false,
  );
  assert.equal(forcedBundle.recovery.dreamMethod, "payback");
  assert.equal(forcedBundle.recovery.keyMesoPerItem, 0);
  assert.equal(forcedBundle.costs.dreamAuctionRecoveryMeso, 0);
  assert.equal(forcedBundle.costs.keyAuctionRecoveryMeso, 0);
  assert.equal(
    forcedBundle.costs.remainingWonderBlackAuctionMesoValue,
    0,
  );
  assert.equal(
    forcedBundle.expected.openedWonderBerries,
    forcedAuctionBundle.expected.openedWonderBerries,
  );
  assert.ok(
    automatic.costs.netMesoEquivalentAfterRemainingBlackSale <=
      forcedBundle.costs.netMesoEquivalentAfterRemainingBlackSale,
  );
  assert.equal(
    automatic.procurement.comparison.maplePointBundle.selectedProcurement,
    "maple-point-bundle",
  );
  assert.equal(
    automatic.procurement.comparison.auctionBundle.selectedProcurement,
    "auction-bundle",
  );

  const expensiveAuction = calculateWonderBerryBundleExpectation({
    ...common,
    wonderBerryAuctionBundleMesoPrice: 5_000_000_000,
  });
  assert.equal(expensiveAuction.selectedProcurement, "maple-point-bundle");
});

test("하이브리드는 교가 블랙을 베이스로, 교불 블랙을 재료로 정확히 보존한다", () => {
  const common = {
    wonderBerryAuctionBundleMesoPrice: 3_000_000_000,
    wonderBerryProcurementMode: "hybrid-bundle",
    wonderBlackMesoPrice: 2_000_000_000,
    lunaDreamAuctionMesoPrice: 1_000_000_000,
    lunaSweetAuctionMesoPrice: 1_500_000_000,
    lunaKeyAuctionMesoPrice: 300_000_000,
  };

  for (const targetCount of [1, 2, 3]) {
    for (const wonderBlackEvent of [false, true]) {
      const result = calculateWonderBerryBundleExpectation({
        ...common,
        targetCount,
        wonderBlackEvent,
      });
      const expected = result.expected;

      assert.equal(result.selectedProcurement, "hybrid-bundle");
      assert.equal(result.policy.auctionBlackRole, "tradeable-base");
      assert.equal(
        result.policy.maplePointBlackRole,
        "untradeable-material",
      );
      assert.equal(
        result.procurement.tradeability.synthesisResultTradable,
        true,
      );
      assertClose(
        expected.purchasedMaplePointBundles +
          expected.purchasedAuctionWonderBerryBundles,
        expected.purchasedBundles,
        "조달처별 묶음 합",
      );
      assertClose(
        expected.openedMaplePointWonderBerries +
          expected.openedAuctionWonderBerries,
        expected.openedWonderBerries,
        "조달처별 개봉 합",
      );
      assertClose(
        expected.tradeableWonderBlacksPulled +
          expected.untradeableWonderBlacksPulled,
        expected.wonderBlacksPulled,
        "조달처별 블랙 합",
      );
      assertClose(
        expected.tradeableWonderBlacksConsumedAsBase,
        expected.sweetSynthesisAttempts,
        "교가 베이스 소비",
      );
      assertClose(
        expected.untradeableWonderBlacksConsumedAsMaterial,
        expected.sweetSynthesisAttempts +
          expected.dreamSynthesisAttempts,
        "교불 재료 소비",
      );
      assertClose(
        expected.wonderBlacksConsumed,
        expected.tradeableWonderBlacksConsumedAsBase +
          expected.untradeableWonderBlacksConsumedAsMaterial,
        "전체 블랙 소비",
      );
      assertClose(
        expected.tradeableWonderBlacksPulled -
          expected.tradeableWonderBlacksConsumedAsBase,
        expected.remainingTradeableWonderBlacks,
        "남은 교가 블랙",
      );
      assertClose(
        expected.untradeableWonderBlacksPulled -
          expected.untradeableWonderBlacksConsumedAsMaterial,
        expected.remainingUntradeableWonderBlacks,
        "남은 교불 블랙",
      );
      assertClose(
        expected.directPetites + expected.dreamRoutePetites,
        targetCount,
        "목표 쁘띠 수",
      );
      assertClose(
        expected.openedWonderBerries,
        expected.purchasedBundles * 11,
        "전량 개봉",
      );
      assertClose(
        result.costs.grossMesoEquivalent,
        expected.purchasedMaplePointBundles *
            result.costs.wonderBerryBundleMaplePoints *
            result.costs.maplePointToMeso +
          expected.purchasedAuctionWonderBerryBundles *
            result.costs.wonderBerryAuctionBundleMesoPrice +
          expected.lunaCrystals *
            result.costs.lunaCrystalMaplePoints *
            result.costs.maplePointToMeso,
        "하이브리드 총지출 장부",
      );
      assertClose(
        result.costs.recoveryMesoEquivalent,
        result.costs.totalPetPaybackMaplePoints *
            result.costs.maplePointToMeso +
          result.costs.totalAuctionRecoveryMeso,
        "하이브리드 회수 장부",
      );
      assertClose(
        result.costs.netMesoEquivalent,
        result.costs.grossMesoEquivalent -
          result.costs.recoveryMesoEquivalent,
        "하이브리드 순비용",
      );
      assert.equal(
        result.procurement.sourceBreakdown.auctionBase
          .purchasedBundles,
        expected.purchasedAuctionWonderBerryBundles,
      );
      assert.equal(
        result.procurement.sourceBreakdown.maplePointMaterial
          .purchasedBundles,
        expected.purchasedMaplePointBundles,
      );
      if (targetCount === 1 && wonderBlackEvent === false) {
        assertClose(
          expected.purchasedAuctionWonderBerryBundles,
          3.600211942701534,
          "평시 1마리 하이브리드 경매장 묶음 기준값",
        );
        assertClose(
          expected.purchasedMaplePointBundles,
          6.278580854061254,
          "평시 1마리 하이브리드 메포 묶음 기준값",
        );
        assertClose(
          expected.sweetSynthesisAttempts,
          1 / 0.292656,
          "평시 1마리 첫 합성 기준값",
        );
        assertClose(
          expected.dreamSynthesisAttempts,
          0.864 / 0.292656,
          "평시 1마리 두 번째 합성 기준값",
        );
      }
    }
  }
});

test("자동 비교는 순수 메포·순수 경매장·하이브리드 중 순비용 최저를 고른다", () => {
  const common = {
    wonderBerryAuctionBundleMesoPrice: 3_000_000_000,
    wonderBlackMesoPrice: 2_000_000_000,
    lunaDreamAuctionMesoPrice: 1_000_000_000,
    lunaSweetAuctionMesoPrice: 1_500_000_000,
    lunaKeyAuctionMesoPrice: 300_000_000,
  };
  const result = calculateWonderBerryBundleExpectation(common);
  const comparison = result.procurement.comparison;

  assert.equal(result.selectedProcurement, "hybrid-bundle");
  assert.ok(comparison.maplePointBundle);
  assert.ok(comparison.auctionBundle);
  assert.ok(comparison.hybridBundle);
  assert.ok(
    comparison.hybridBundle.netMesoEquivalentAfterRecovery <
      comparison.maplePointBundle.netMesoEquivalentAfterRecovery,
  );
  assert.ok(
    comparison.hybridBundle.netMesoEquivalentAfterRecovery <
      comparison.auctionBundle.netMesoEquivalentAfterRecovery,
  );

  const topLevel = calculatePetExpectation({
    ...common,
    wonderBlackMesoPrice: 3_000_000_000,
    sourceMode: "cheapest",
  });
  assert.equal(topLevel.selectedSource, "wonderberry");
  assert.equal(
    topLevel.selectedWonderBerryProcurement,
    "hybrid-bundle",
  );
  assert.equal(topLevel.recovery.tradeableResults, true);
  assert.equal(
    topLevel.costs.grossMesoEquivalent,
    topLevel.bundlePurchase.costs.grossMesoEquivalent,
  );
  assert.equal(
    topLevel.costs.recoveryMesoEquivalent,
    topLevel.bundlePurchase.costs.recoveryMesoEquivalent,
  );
  assert.equal(
    topLevel.costs.netMesoEquivalent,
    topLevel.bundlePurchase.costs.netMesoEquivalent,
  );
  assert.equal(
    topLevel.expected.purchasedMaplePointBundles,
    topLevel.bundlePurchase.expected.purchasedMaplePointBundles,
  );
  assert.equal(
    topLevel.expected.purchasedAuctionWonderBerryBundles,
    topLevel.bundlePurchase.expected
      .purchasedAuctionWonderBerryBundles,
  );

  assert.throws(
    () => calculateWonderBerryBundleExpectation({
      wonderBerryProcurementMode: "hybrid-bundle",
    }),
    /경매장 시세/,
  );
});

test("교가 결과 필수 모드는 메포 단독 후보를 제외하고 교가 회수를 적용한다", () => {
  const common = {
    wonderBerryAuctionBundleMesoPrice: 3_000_000_000,
    lunaDreamAuctionMesoPrice: 800_000_000,
  };
  const compatible = calculateWonderBerryBundleExpectation(common);
  const tradeable = calculateWonderBerryBundleExpectation({
    ...common,
    tradeableOutputRequired: true,
  });

  // 기존 옵션 false에서는 종전의 최저 순비용 선택을 그대로 보존한다.
  assert.equal(compatible.selectedProcurement, "maple-point-bundle");
  assert.equal(compatible.tradeableOutputRequired, false);

  assert.notEqual(tradeable.selectedProcurement, "maple-point-bundle");
  assert.ok([
    "auction-bundle",
    "hybrid-bundle",
  ].includes(tradeable.selectedProcurement));
  assert.equal(tradeable.tradeableOutputRequired, true);
  assert.equal(
    tradeable.procurement.selectionConstraint,
    "tradeable-output-only",
  );
  assert.equal(
    tradeable.procurement.comparison.maplePointBundle
      .eligibleForSelection,
    false,
  );
  assert.equal(
    tradeable.procurement.tradeability.synthesisResultTradable,
    true,
  );
  assert.equal(tradeable.recovery.dreamMethod, "auction");
  assert.equal(tradeable.recovery.dreamAuctionSaleApplied, true);
  assert.ok(tradeable.costs.dreamAuctionRecoveryMeso > 0);

  const withBlackSale = calculateWonderBerryBundleExpectation({
    ...common,
    tradeableOutputRequired: true,
    wonderBlackMesoPrice: 2_000_000_000,
  });
  assert.equal(
    withBlackSale.recovery.remainingTradeableBlackMethod,
    "auction",
  );
  assert.equal(
    withBlackSale.recovery.remainingTradeableBlackAuctionSaleApplied,
    true,
  );
  assert.ok(
    withBlackSale.costs.remainingTradeableBlackAuctionRecoveryMeso > 0,
  );
  assert.equal(
    withBlackSale.recovery.remainingUntradeableBlackMethod,
    "keep",
  );
  assert.ok(
    withBlackSale.expected.remainingUntradeableWonderBlacks > 0,
  );
  assert.equal(
    withBlackSale.costs.remainingUntradeableBlackPaybackMaplePoints,
    0,
  );
  assert.equal(
    withBlackSale.costs.remainingUntradeableBlackPaybackMesoEquivalent,
    0,
  );
  assert.equal(
    withBlackSale.costs.remainingUntradeableWonderBlackRecoveryMeso,
    0,
  );

  assert.throws(
    () => calculateWonderBerryBundleExpectation({
      tradeableOutputRequired: true,
    }),
    /경매장 시세가 필요/,
  );
  assert.throws(
    () => calculateWonderBerryBundleExpectation({
      ...common,
      tradeableOutputRequired: true,
      wonderBerryProcurementMode: "maple-point-bundle",
    }),
    /메포 원더베리 단독 조달/,
  );
});

test("교가 결과 필수 제약은 분위수·완료·제한·최상위 선택에 동일하게 적용된다", () => {
  const common = {
    targetCount: 1,
    tradeableOutputRequired: true,
    wonderBerryAuctionBundleMesoPrice: 3_000_000_000,
    wonderBlackMesoPrice: 2_000_000_000,
    lunaDreamAuctionMesoPrice: 800_000_000,
  };
  const percentile =
    calculateWonderBerryPercentileCompletionExpectation({
      ...common,
      targetChance: 0.8,
    });
  const completion = calculateWonderBerryBundleCompletionExpectation({
    ...common,
    completionBundle: percentile.purchaseUnits,
  });
  const capped = calculateCappedWonderBerryBundleExpectation({
    ...common,
    maxBundles: percentile.purchaseUnits,
  });

  for (const result of [percentile, completion, capped]) {
    assert.equal(result.tradeableOutputRequired, true);
    assert.notEqual(result.selectedProcurement, "maple-point-bundle");
    assert.equal(
      result.procurement.tradeability.synthesisResultTradable,
      true,
    );
    assert.equal(result.recovery.dreamMethod, "auction");
    assert.equal(result.recovery.dreamAuctionSaleApplied, true);
  }
  assert.equal(
    percentile.candidates.maplePointBundle.eligibleForSelection,
    false,
  );
  assert.equal(
    completion.procurement.comparison.maplePointBundle
      .eligibleForSelection,
    false,
  );
  assert.equal(
    capped.procurement.comparison.maplePointBundle
      .eligibleForSelection,
    false,
  );

  const topLevel = calculatePetExpectation({
    ...common,
    // 교불 직접 블랙 경로를 명시해도 교가 결과 필수가 우선한다.
    sourceMode: "auction",
  });
  assert.equal(topLevel.tradeableOutputRequired, true);
  assert.equal(topLevel.selectedSource, "wonderberry");
  assert.equal(
    topLevel.sourceSelectionConstraint,
    "wonderberry-tradeable-output-only",
  );
  assert.notEqual(
    topLevel.selectedWonderBerryProcurement,
    "maple-point-bundle",
  );
  assert.equal(topLevel.recovery.tradeableResults, true);
  assert.equal(topLevel.recovery.dreamMethod, "auction");
  assert.equal(
    topLevel.costs.netMesoEquivalent,
    topLevel.bundlePurchase.costs.netMesoEquivalent,
  );
});

test("교가 1묶음 완료 계산은 불가능한 하이브리드를 빼고 경매장 묶음을 사용한다", () => {
  const common = {
    targetCount: 1,
    tradeableOutputRequired: true,
    wonderBerryAuctionBundleMesoPrice: 3_000_000_000,
    completionBundle: 1,
  };

  for (const wonderBerryProcurementMode of [
    "cheapest",
    "auction-bundle",
  ]) {
    const result = calculateWonderBerryBundleCompletionExpectation({
      ...common,
      wonderBerryProcurementMode,
    });
    assert.equal(result.selectedProcurement, "auction-bundle");
    assert.equal(result.tradeableOutputRequired, true);
    assert.equal(
      result.procurement.tradeability.synthesisResultTradable,
      true,
    );
    assert.ok(result.completionProbability > 0);
    assert.equal(result.procurement.comparison.hybridBundle, null);
  }
});

test("교가 1묶음 제한 자동 선택은 싼 성공불가 경로보다 성공 가능한 경로를 우선한다", () => {
  const common = {
    targetCount: 1,
    tradeableOutputRequired: true,
    wonderBerryAuctionBundleMesoPrice: 3_000_000_000,
    maxBundles: 1,
  };
  const automatic = calculateCappedWonderBerryBundleExpectation(common);
  const comparison = automatic.procurement.comparison;

  assert.equal(automatic.selectedProcurement, "auction-bundle");
  assert.ok(automatic.actualChance > 0);
  assert.equal(comparison.hybridBundle.actualChance, 0);
  assert.ok(
    comparison.hybridBundle.netMesoEquivalentAfterRecovery <
      comparison.auctionBundle.netMesoEquivalentAfterRecovery,
  );
  assert.equal(
    comparison.selectionBasis,
    "maximum-success-probability-then-net-meso-after-recovery",
  );
  assert.equal(
    automatic.procurement.selectionBasis,
    comparison.selectionBasis,
  );

  const explicitHybrid =
    calculateCappedWonderBerryBundleExpectation({
      ...common,
      wonderBerryProcurementMode: "hybrid-bundle",
    });
  assert.equal(explicitHybrid.selectedProcurement, "hybrid-bundle");
  assert.equal(explicitHybrid.actualChance, 0);
  assert.equal(
    explicitHybrid.procurement.comparison.selectionBasis,
    "explicit-procurement-mode",
  );
});

test("교불 잔여 블랙 보관 정책은 평균·목표확률·명시묶음·제한 장부에 일관되게 적용된다", () => {
  const assertKeptInventory = (result, tradeableRequired) => {
    const remaining =
      result.expected.remainingUntradeableWonderBlacks;
    assert.ok(remaining > 0, `${result.scope}: 보관 수량`);
    assert.equal(
      result.recovery.remainingUntradeableBlackMethod,
      "keep",
      `${result.scope}: 회수 방식`,
    );
    assert.equal(
      result.costs.remainingUntradeableBlackPaybackMaplePoints,
      0,
      `${result.scope}: 페이백 MP`,
    );
    assert.equal(
      result.costs.remainingUntradeableBlackPaybackMesoEquivalent,
      0,
      `${result.scope}: 페이백 메소 환산`,
    );
    assert.equal(
      result.costs.remainingUntradeableWonderBlackRecoveryMeso,
      0,
      `${result.scope}: 교불 블랙 회수액`,
    );
    assertClose(
      result.costs.recoveryMesoEquivalent,
      result.costs.totalPetPaybackMaplePoints *
          result.costs.conversionToMeso +
        result.costs.totalAuctionRecoveryMeso,
      `${result.scope}: 총 회수 장부`,
    );
    assertClose(
      result.costs.netMesoEquivalent,
      result.costs.grossMesoEquivalent -
        result.costs.recoveryMesoEquivalent,
      `${result.scope}: 순비용 장부`,
    );

    // 종전처럼 교불 블랙을 540 MP로 페이백했다고 가정한 비용과의
    // 차이가 제외된 페이백 금액과 정확히 일치해야 한다.
    const excludedPaybackMeso =
      remaining * 540 * result.costs.conversionToMeso;
    const hypotheticalLegacyNetMeso =
      result.costs.grossMesoEquivalent -
      (result.costs.recoveryMesoEquivalent + excludedPaybackMeso);
    assert.ok(excludedPaybackMeso > 0);
    assertClose(
      result.costs.netMesoEquivalent - hypotheticalLegacyNetMeso,
      excludedPaybackMeso,
      `${result.scope}: 보관 전환 비용 차이`,
    );
    assert.equal(result.tradeableOutputRequired, tradeableRequired);
  };

  const pureOptions = {
    targetCount: 3,
    wonderBerryProcurementMode: "maple-point-bundle",
    wonderBlackMesoPrice: 2_000_000_000,
    maplePointsPer100MillionMeso: 2_000,
  };
  const purePercentile =
    calculateWonderBerryPercentileCompletionExpectation({
      ...pureOptions,
      targetChance: 0.8,
    });
  const pureResults = [
    calculateWonderBerryBundleExpectation(pureOptions),
    purePercentile,
    calculateWonderBerryBundleCompletionExpectation({
      ...pureOptions,
      completionBundle: purePercentile.purchaseUnits,
    }),
    calculateCappedWonderBerryBundleExpectation({
      ...pureOptions,
      maxBundles: purePercentile.purchaseUnits,
    }),
  ];
  for (const result of pureResults) {
    assert.equal(result.selectedProcurement, "maple-point-bundle");
    assertKeptInventory(result, false);
  }

  const tradeableOptions = {
    targetCount: 3,
    tradeableOutputRequired: true,
    wonderBerryProcurementMode: "hybrid-bundle",
    wonderBerryAuctionBundleMesoPrice: 3_000_000_000,
    wonderBlackMesoPrice: 2_000_000_000,
    lunaDreamAuctionMesoPrice: 800_000_000,
    maplePointsPer100MillionMeso: 2_000,
  };
  const hybridPercentile =
    calculateWonderBerryPercentileCompletionExpectation({
      ...tradeableOptions,
      targetChance: 0.8,
    });
  const hybridResults = [
    calculateWonderBerryBundleExpectation(tradeableOptions),
    hybridPercentile,
    calculateWonderBerryBundleCompletionExpectation({
      ...tradeableOptions,
      completionBundle: hybridPercentile.purchaseUnits,
    }),
    calculateCappedWonderBerryBundleExpectation({
      ...tradeableOptions,
      maxBundles: hybridPercentile.purchaseUnits,
    }),
  ];
  for (const result of hybridResults) {
    assert.equal(result.selectedProcurement, "hybrid-bundle");
    assertKeptInventory(result, true);
  }
});

test("경매장 원더베리 묶음은 정수 묶음 수와 그 묶음째 완료비용을 사용한다", () => {
  const common = {
    targetCount: 2,
    wonderBerryAuctionBundleMesoPrice: 2_000_000_000,
    wonderBerryProcurementMode: "auction-bundle",
    wonderBlackMesoPrice: 2_000_000_000,
    lunaDreamAuctionMesoPrice: 1_000_000_000,
    lunaKeyAuctionMesoPrice: 300_000_000,
  };
  const average = calculateWonderBerryBundleExpectation(common);
  const completionUnits = bundlesForTargetChance(
    2,
    0.8,
    false,
    average.purchaseUnitSize,
  );
  const completion = calculateWonderBerryBundleCompletionExpectation({
    ...common,
    completionBundle: completionUnits,
  });
  const capped = calculateCappedWonderBerryBundleExpectation({
    ...common,
    maxBundles: completionUnits,
  });

  assert.equal(average.purchaseUnitSize, 11);
  assert.equal(completion.purchaseUnitLabel, "묶음");
  assert.equal(completion.completionPurchaseUnit, completionUnits);
  assert.equal(completion.expected.purchasedUnits, completionUnits);
  assert.equal(
    completion.expected.purchasedAuctionWonderBerryBundles,
    completionUnits,
  );
  assert.equal(
    completion.costs.wonderBerryAuctionBundleMeso,
    completionUnits * 2_000_000_000,
  );
  assert.equal(completion.costs.berryMaplePoints, 0);
  assert.ok(completion.expected.wonderPetPaybacks > 0);
  assert.equal(completion.recovery.keyMesoPerItem, 285_000_000);
  assert.ok(completion.cumulativeChance >= 0.8);
  assert.ok(completion.cumulativeChanceBefore < 0.8);
  assert.equal(capped.purchaseUnitLabel, "묶음");
  assert.equal(capped.maxPurchaseUnits, completionUnits);
  assert.ok(capped.expected.purchasedUnits <= completionUnits);
  assert.ok(
    Math.abs(capped.actualChance - completion.cumulativeChance) < 1e-12,
  );
});

test("하이브리드 완료·제한 계산은 같은 묶음 CDF와 조달처별 장부를 쓴다", () => {
  const common = {
    targetCount: 2,
    wonderBlackEvent: true,
    wonderBerryAuctionBundleMesoPrice: 3_000_000_000,
    wonderBerryProcurementMode: "hybrid-bundle",
    wonderBlackMesoPrice: 2_000_000_000,
    lunaDreamAuctionMesoPrice: 1_000_000_000,
    lunaSweetAuctionMesoPrice: 1_500_000_000,
    lunaKeyAuctionMesoPrice: 300_000_000,
  };
  const percentile =
    calculateWonderBerryPercentileCompletionExpectation({
      ...common,
      targetChance: 0.8,
    });
  const completionBundle = percentile.purchaseUnits;
  const completion = calculateWonderBerryBundleCompletionExpectation({
    ...common,
    completionBundle,
  });
  const capped = calculateCappedWonderBerryBundleExpectation({
    ...common,
    maxBundles: completionBundle,
  });

  assert.equal(percentile.selectedProcurement, "hybrid-bundle");
  assert.equal(completion.selectedProcurement, "hybrid-bundle");
  assert.equal(capped.selectedProcurement, "hybrid-bundle");
  assert.equal(completion.completionWonderBerry, null);
  assert.equal(completion.completionUnitKind, "bundle");
  assert.equal(completion.completion.wonderBerries, null);
  assert.equal(completion.completion.unitKind, "bundle");
  assertClose(
    completion.cumulativeChance,
    percentile.actualChance,
    "하이브리드 완료 누적 확률",
  );
  assertClose(
    completion.cumulativeChanceBefore,
    percentile.previousChance,
    "하이브리드 완료 직전 확률",
  );
  assertClose(
    capped.actualChance,
    completion.cumulativeChance,
    "하이브리드 제한 누적 확률",
  );
  assert.ok(capped.expected.purchasedBundles <= completionBundle);
  assertClose(
    capped.expected.purchasedMaplePointBundles +
      capped.expected.purchasedAuctionWonderBerryBundles,
    capped.expected.purchasedBundles,
    "제한 하이브리드 묶음 합",
  );
  assertClose(
    capped.expected.openedWonderBerries,
    capped.expected.purchasedBundles * 11,
    "제한 하이브리드 전량 개봉",
  );
  assertClose(
    capped.expected.tradeableWonderBlacksPulled -
      capped.expected.tradeableWonderBlacksConsumedAsBase,
    capped.expected.remainingTradeableWonderBlacks,
    "제한 하이브리드 남은 교가 블랙",
  );
  assertClose(
    capped.expected.untradeableWonderBlacksPulled -
      capped.expected.untradeableWonderBlacksConsumedAsMaterial,
    capped.expected.remainingUntradeableWonderBlacks,
    "제한 하이브리드 남은 교불 블랙",
  );
  assertClose(
    capped.expected.lunaSweets - capped.expected.dreamSynthesisAttempts,
    capped.expected.remainingLunaSweets,
    "제한 하이브리드 남은 스윗",
  );
  assertClose(
    capped.actualChance + capped.failureProbability,
    1,
    "제한 하이브리드 성공·실패 확률",
  );
  assert.equal(capped.remainingWonderBlackDistribution, null);
  assert.ok(capped.remainingHybridInventoryDistribution.length > 0);
  assert.equal(
    capped.procurement.sourceBreakdown.auctionBase.role,
    "tradeable-base",
  );
  assert.equal(
    capped.procurement.sourceBreakdown.maplePointMaterial.role,
    "untradeable-material",
  );
});

test("하이브리드 수수료는 자원과 매입비는 바꾸지 않고 교가 회수만 바꾼다", () => {
  const common = {
    targetCount: 2,
    wonderBerryAuctionBundleMesoPrice: 3_000_000_000,
    wonderBerryProcurementMode: "hybrid-bundle",
    wonderBlackMesoPrice: 2_000_000_000,
    lunaDreamAuctionMesoPrice: 1_000_000_000,
    lunaSweetAuctionMesoPrice: 1_500_000_000,
    lunaKeyAuctionMesoPrice: 300_000_000,
  };
  const fee5 = calculateWonderBerryBundleExpectation({
    ...common,
    auctionFeeRate: 0.05,
  });
  const fee3 = calculateWonderBerryBundleExpectation({
    ...common,
    auctionFeeRate: 0.03,
  });

  for (const key of [
    "purchasedBundles",
    "purchasedMaplePointBundles",
    "purchasedAuctionWonderBerryBundles",
    "openedWonderBerries",
    "wonderBlacksPulled",
    "sweetSynthesisAttempts",
    "dreamSynthesisAttempts",
    "lunaCrystals",
    "remainingTradeableWonderBlacks",
    "remainingUntradeableWonderBlacks",
  ]) {
    assert.equal(fee3.expected[key], fee5.expected[key], key);
  }
  assert.equal(
    fee3.costs.grossMesoEquivalent,
    fee5.costs.grossMesoEquivalent,
  );
  assert.equal(
    fee3.costs.totalPetPaybackMaplePoints,
    fee5.costs.totalPetPaybackMaplePoints,
  );
  assert.ok(
    fee3.costs.totalAuctionRecoveryMeso >
      fee5.costs.totalAuctionRecoveryMeso,
  );
  assert.ok(
    fee3.costs.netMesoEquivalent < fee5.costs.netMesoEquivalent,
  );
});

test("가장 싼 블랙 경로 비교도 경매장산 원더베리의 정확한 평균 비용을 사용한다", () => {
  const result = calculatePetExpectation({
    sourceMode: "cheapest",
    wonderBlackMesoPrice: 3_000_000_000,
    wonderBerryAuctionBundleMesoPrice: 2_000_000_000,
  });

  assert.equal(result.selectedSource, "wonderberry");
  assert.equal(result.bundlePurchase.applicable, true);
  assert.equal(
    result.selectedWonderBerryProcurement,
    "auction-bundle",
  );
  assert.equal(
    result.wonderBerryProcurement.selectedProcurement,
    "auction-bundle",
  );
  assert.equal(
    result.comparison.wonderberryProcurementNetMesoPerTarget,
    result.bundlePurchase.costs.netMesoEquivalentAfterRemainingBlackSale,
  );
  assert.equal(result.costs.berryMaplePoints, 0);
  assert.equal(
    result.costs.wonderBerryAuctionBundleMeso,
    result.bundlePurchase.costs.wonderBerryAuctionBundleMeso,
  );
  assert.equal(
    result.costs.netMesoEquivalentAfterRemainingBlackSale,
    result.bundlePurchase.costs.netMesoEquivalentAfterRemainingBlackSale,
  );
  assert.equal(
    result.expected.wonderBerries,
    result.bundlePurchase.expected.openedWonderBerries,
  );
});

test("제한 묶음 기대값의 성공 확률은 기존 정확 확률과 일치한다", () => {
  for (const wonderBlackEvent of [false, true]) {
    for (const targetCount of [1, 2, 3]) {
      for (const maxBundles of [0, 1, 2, 7, 29]) {
        const result = calculateCappedWonderBerryBundleExpectation({
          targetCount,
          wonderBlackEvent,
          maxBundles,
        });
        const probability = probabilityOfTargetWithinBundles(
          maxBundles,
          targetCount,
          wonderBlackEvent,
        );
        assert.ok(
          Math.abs(result.actualChance - probability) < 1e-12,
          `${targetCount}마리 event=${wonderBlackEvent} cap=${maxBundles}`,
        );
        assert.equal(result.successProbability, result.actualChance);
        assert.ok(
          Math.abs(
            result.actualChance + result.failureProbability - 1,
          ) < 1e-12,
        );
      }
    }
  }
});

test("제한 묶음 정책은 목표 달성 후 조기 종료하고 자원을 보존한다", () => {
  for (const wonderBlackEvent of [false, true]) {
    for (const targetCount of [1, 2, 3]) {
      const result = calculateCappedWonderBerryBundleExpectation({
        targetCount,
        wonderBlackEvent,
        maxBundles: 12,
      });
      const expected = result.expected;
      const survivalSum = Array.from(
        { length: 12 },
        (_, bundles) =>
          1 - probabilityOfTargetWithinBundles(
            bundles,
            targetCount,
            wonderBlackEvent,
          ),
      ).reduce((sum, probability) => sum + probability, 0);
      assert.ok(expected.purchasedBundles > 0);
      assert.ok(expected.purchasedBundles < 12);
      assert.ok(
        Math.abs(expected.purchasedBundles - survivalSum) < 1e-10,
      );
      assert.ok(
        Math.abs(
          expected.openedWonderBerries - expected.purchasedBundles * 11,
        ) < 1e-10,
      );
      assert.ok(
        Math.abs(
          expected.wonderBlacksPulled -
            expected.wonderBlacksConsumed -
            expected.remainingWonderBlacks,
        ) < 1e-10,
      );
      assert.ok(
        Math.abs(
          expected.openedWonderBerries -
            expected.wonderBlacksPulled -
            expected.wonderPetPaybacks -
            expected.wonderConsumables,
        ) < 1e-10,
      );
      assert.ok(
        Math.abs(
          expected.lunaSweets -
            expected.dreamSynthesisAttempts -
            expected.remainingLunaSweets,
        ) < 1e-10,
      );
      assert.ok(
        Math.abs(
          expected.lunaKeys - expected.sweetKeys - expected.dreamKeys,
        ) < 1e-10,
      );
      assert.ok(expected.petites <= targetCount + 1e-12);
      assert.ok(
        Math.abs(
          result.remainingWonderBlackDistribution.reduce(
            (sum, entry) => sum + entry.probability,
            0,
          ) - 1,
        ) < 1e-10,
      );
      assert.ok(
        Math.abs(
          result.successfulRemainingWonderBlackDistribution.reduce(
            (sum, entry) => sum + entry.probability,
            0,
          ) - result.actualChance,
        ) < 1e-10,
      );
      assert.ok(
        Math.abs(
          result.failedRemainingWonderBlackDistribution.reduce(
            (sum, entry) => sum + entry.probability,
            0,
          ) - result.failureProbability,
        ) < 1e-10,
      );
    }
  }
});

test("제한 종료에 남은 스윗도 조달처별 페이백·옥션 판매 원칙을 따른다", () => {
  const maplePoint = calculateCappedWonderBerryBundleExpectation({
    targetCount: 3,
    maxBundles: 1,
    lunaSweetAuctionMesoPrice: 1_000_000_000,
  });
  assert.ok(maplePoint.expected.remainingLunaSweets > 0);
  assert.equal(maplePoint.recovery.remainingSweetMethod, "payback");
  assert.equal(
    maplePoint.costs.remainingSweetAuctionRecoveryMeso,
    0,
  );
  assert.ok(
    Math.abs(
      maplePoint.costs.remainingSweetPaybackMaplePoints -
        maplePoint.expected.remainingLunaSweets * 540,
    ) < 1e-10,
  );

  const auction = calculateCappedWonderBerryBundleExpectation({
    targetCount: 3,
    maxBundles: 1,
    wonderBerryAuctionBundleMesoPrice: 2_000_000_000,
    wonderBerryProcurementMode: "auction-bundle",
    lunaSweetAuctionMesoPrice: 1_000_000_000,
  });
  assert.equal(auction.recovery.remainingSweetMethod, "auction");
  assert.equal(
    auction.recovery.remainingSweetAuctionSaleApplied,
    true,
  );
  assert.ok(auction.costs.remainingSweetAuctionRecoveryMeso > 0);
});

test("제한 묶음 0·1개 경계와 최대 묶음 단조성을 보존한다", () => {
  const zero = calculateCappedWonderBerryBundleExpectation({
    targetCount: 1,
    maxBundles: 0,
  });
  assert.equal(zero.actualChance, 0);
  assert.equal(zero.expected.purchasedBundles, 0);
  assert.equal(zero.expected.openedWonderBerries, 0);
  assert.equal(zero.costs.netMesoEquivalent, 0);
  assert.deepEqual(zero.remainingWonderBlackDistribution, [
    { count: 0, probability: 1, conditionalProbability: 1 },
  ]);

  const one = calculateCappedWonderBerryBundleExpectation({
    targetCount: 1,
    maxBundles: 1,
  });
  assert.equal(one.expected.purchasedBundles, 1);
  assert.equal(one.expected.openedWonderBerries, 11);

  let previousChance = 0;
  let previousBundles = 0;
  for (let maxBundles = 1; maxBundles <= 20; maxBundles += 1) {
    const result = calculateCappedWonderBerryBundleExpectation({
      targetCount: 3,
      maxBundles,
    });
    assert.ok(result.actualChance >= previousChance - 1e-15);
    assert.ok(
      result.expected.purchasedBundles >= previousBundles - 1e-12,
    );
    assert.ok(result.expected.purchasedBundles <= maxBundles);
    previousChance = result.actualChance;
    previousBundles = result.expected.purchasedBundles;
  }
  assert.throws(
    () => calculateCappedWonderBerryBundleExpectation({ maxBundles: -1 }),
    /0 이상의 정수/,
  );
  assert.throws(
    () => calculateCappedWonderBerryBundleExpectation({ maxBundles: 1.5 }),
    /0 이상의 정수/,
  );
});

test("큰 묶음 제한은 무제한 묶음 기대값으로 수렴한다", () => {
  for (const targetCount of [1, 2, 3]) {
    const uncapped = calculateWonderBerryBundleExpectation({ targetCount });
    const capped = calculateCappedWonderBerryBundleExpectation({
      targetCount,
      maxBundles: 400,
    });
    assert.ok(1 - capped.actualChance < 1e-12);
    for (const key of [
      "purchasedBundles",
      "openedWonderBerries",
      "wonderBlacksPulled",
      "wonderBlacksConsumed",
      "lunaCrystals",
      "lunaDreams",
      "lunaKeys",
      "remainingWonderBlacks",
    ]) {
      assert.ok(
        Math.abs(capped.expected[key] - uncapped.expected[key]) < 1e-8,
        `${targetCount}마리 ${key}`,
      );
    }
  }
});

test("제한 묶음 비용은 교불 잔여 블랙을 보관 재고로 제외한다", () => {
  const common = {
    targetCount: 3,
    maxBundles: 29,
    wonderBlackMesoPrice: 2_000_000_000,
    lunaDreamAuctionMesoPrice: 1_000_000_000,
    lunaKeyAuctionMesoPrice: 300_000_000,
    auctionFeeRate: 0.05,
    maplePointsPer100MillionMeso: 2_000,
  };
  const maplePoint = calculateCappedWonderBerryBundleExpectation(common);
  const won = calculateCappedWonderBerryBundleExpectation({
    ...common,
    costConversionBasis: "won",
    wonPer100MillionMeso: 1_400,
  });
  for (const key of [
    "berryMaplePoints",
    "crystalMaplePoints",
    "grossMaplePoints",
    "wonderPetPaybackMaplePoints",
  ]) {
    assert.equal(won.costs[key], maplePoint.costs[key], key);
  }
  assert.equal(
    won.costs.grossMesoEquivalent,
    maplePoint.costs.grossMesoEquivalent,
  );
  assert.equal(
    won.costs.recoveryMesoEquivalent,
    maplePoint.costs.recoveryMesoEquivalent,
  );
  assert.equal(maplePoint.costs.remainingWonderBlackAuctionMesoValue, 0);
  assert.ok(maplePoint.expected.remainingUntradeableWonderBlacks > 0);
  assert.equal(maplePoint.recovery.remainingBlackMethod, "keep");
  assert.equal(maplePoint.costs.remainingBlackPaybackMaplePoints, 0);
  assert.equal(
    maplePoint.costs.remainingUntradeableBlackPaybackMaplePoints,
    0,
  );
  assert.equal(
    maplePoint.costs.remainingUntradeableWonderBlackRecoveryMeso,
    0,
  );
  assert.ok(
    Math.abs(
      maplePoint.costs.remainingSweetPaybackMaplePoints -
        maplePoint.expected.remainingLunaSweets * 540,
    ) < 1e-8,
  );
  assert.equal(
    maplePoint.costs.netMesoEquivalentAfterRemainingBlackSale,
    maplePoint.costs.netMesoEquivalent,
  );
});

test("N번째 묶음 첫 달성 조건부 기대값은 분위수 경계와 자원을 보존한다", () => {
  for (const wonderBlackEvent of [false, true]) {
    for (const targetCount of [1, 2, 3]) {
      const completionBundle = bundlesForTargetChance(
        targetCount,
        0.8,
        wonderBlackEvent,
      );
      const result = calculateWonderBerryBundleCompletionExpectation({
        targetCount,
        wonderBlackEvent,
        completionBundle,
      });
      const cumulativeBefore = probabilityOfTargetWithinBundles(
        completionBundle - 1,
        targetCount,
        wonderBlackEvent,
      );
      const cumulative = probabilityOfTargetWithinBundles(
        completionBundle,
        targetCount,
        wonderBlackEvent,
      );
      const expected = result.expected;

      assert.ok(
        Math.abs(result.cumulativeChanceBefore - cumulativeBefore) <
          1e-12,
      );
      assert.ok(Math.abs(result.cumulativeChance - cumulative) < 1e-12);
      assert.ok(
        Math.abs(
          result.completionProbability -
            (cumulative - cumulativeBefore),
        ) < 1e-12,
      );
      assert.ok(
        Math.abs(
          result.survivalProbabilityBefore + cumulativeBefore - 1,
        ) < 1e-12,
      );
      assert.equal(expected.purchasedBundles, completionBundle);
      assert.equal(expected.openedWonderBerries, completionBundle * 11);
      assert.ok(Math.abs(expected.petites - targetCount) < 1e-10);
      assert.ok(
        Math.abs(
          expected.wonderBlacksPulled -
            expected.wonderBlacksConsumed -
            expected.remainingWonderBlacks,
        ) < 1e-9,
      );
      assert.ok(
        Math.abs(
          expected.openedWonderBerries -
            expected.wonderBlacksPulled -
            expected.wonderPetPaybacks -
            expected.wonderConsumables,
        ) < 1e-9,
      );
      assert.ok(
        Math.abs(
          expected.lunaSweets - expected.dreamSynthesisAttempts,
        ) < 1e-10,
      );
      assert.ok(
        Math.abs(
          expected.lunaKeys - expected.sweetKeys - expected.dreamKeys,
        ) < 1e-10,
      );
      assert.ok(
        Math.abs(
          result.remainingWonderBlackDistribution.reduce(
            (sum, entry) => sum + entry.probability,
            0,
          ) - 1,
        ) < 1e-12,
      );
      assert.ok(
        Math.abs(
          result.completionRemainingWonderBlackDistribution.reduce(
            (sum, entry) => sum + entry.probability,
            0,
          ) - result.completionProbability,
        ) < 1e-12,
      );
    }
  }
});

test("N번째 묶음 첫 달성 비용은 조건부 재료·회수·환산을 적용한다", () => {
  const common = {
    targetCount: 3,
    completionBundle: 38,
    wonderBlackMesoPrice: 2_000_000_000,
    lunaDreamAuctionMesoPrice: 1_000_000_000,
    lunaKeyAuctionMesoPrice: 300_000_000,
    auctionFeeRate: 0.05,
    maplePointsPer100MillionMeso: 2_000,
  };
  const result = calculateWonderBerryBundleCompletionExpectation(common);
  const expected = result.expected;
  const costs = result.costs;

  assert.equal(result.scope, "wonderberry-completion-bundle");
  assert.equal(result.policy.condition, "completion-at-bundle");
  assert.equal(result.completion.bundle, 38);
  assert.equal(costs.berryMaplePoints, 38 * 54_000);
  assert.ok(
    Math.abs(
      costs.crystalMaplePoints - expected.lunaCrystals * 3_900,
    ) < 1e-9,
  );
  assert.ok(
    Math.abs(
      costs.wonderPetPaybackMaplePoints -
        expected.wonderPetPaybacks * 540,
    ) < 1e-9,
  );
  assert.ok(
    Math.abs(
      costs.grossMesoEquivalent -
        costs.grossMaplePoints * costs.conversionToMeso,
    ) < 1e-5,
  );
  assert.ok(
    Math.abs(
      costs.netMesoEquivalent -
        (costs.grossMesoEquivalent - costs.recoveryMesoEquivalent),
    ) < 1e-5,
  );
  assert.ok(expected.remainingUntradeableWonderBlacks > 0);
  assert.equal(result.recovery.remainingBlackMethod, "keep");
  assert.equal(costs.remainingBlackPaybackMaplePoints, 0);
  assert.equal(
    costs.remainingUntradeableBlackPaybackMaplePoints,
    0,
  );
  assert.equal(
    costs.remainingUntradeableBlackPaybackMesoEquivalent,
    0,
  );
  assert.equal(
    costs.remainingUntradeableWonderBlackRecoveryMeso,
    0,
  );
  assert.equal(costs.remainingWonderBlackAuctionMesoValue, 0);

  const won = calculateWonderBerryBundleCompletionExpectation({
    ...common,
    costConversionBasis: "won",
    wonPer100MillionMeso: 1_400,
  });
  assert.equal(won.costs.berryMaplePoints, costs.berryMaplePoints);
  assert.equal(won.costs.crystalMaplePoints, costs.crystalMaplePoints);
  assert.equal(won.costs.grossMesoEquivalent, costs.grossMesoEquivalent);
  assert.equal(
    won.costs.recoveryMesoEquivalent,
    costs.recoveryMesoEquivalent,
  );
});

test("99.99% 당첨선 조건부 비용은 성공 즉시 중단 전체 평균과 구분된다", () => {
  const completionBundle = bundlesForTargetChance(1, 0.9999);
  const completion = calculateWonderBerryBundleCompletionExpectation({
    targetCount: 1,
    completionBundle,
  });
  const capped = calculateCappedWonderBerryBundleExpectation({
    targetCount: 1,
    maxBundles: completionBundle,
  });

  assert.equal(completion.expected.purchasedBundles, completionBundle);
  assert.ok(capped.expected.purchasedBundles < completionBundle);
  assert.equal(
    completion.costs.berryMaplePoints,
    completionBundle * 54_000,
  );
  assert.ok(
    capped.costs.berryMaplePoints < completion.costs.berryMaplePoints,
  );
  assert.ok(completion.cumulativeChance >= 0.9999);
  assert.ok(completion.cumulativeChanceBefore < 0.9999);

  assert.throws(
    () => calculateWonderBerryBundleCompletionExpectation({
      completionBundle: 0,
    }),
    /1 이상의 정수/,
  );
  assert.throws(
    () => calculateWonderBerryBundleCompletionExpectation({
      completionBundle: 1.5,
    }),
    /1 이상의 정수/,
  );
  assert.throws(
    () => calculateWonderBerryBundleCompletionExpectation({
      completionBundle: 100_001,
    }),
    /100,000 이하/,
  );
});

test("제한 경로 기대값은 이항분포 확률·조기 종료와 일치한다", () => {
  const p = getPetiteRouteProbability();
  for (const targetCount of [1, 2, 3]) {
    for (const maxRoutes of [0, 1, 3, 10, 30]) {
      const result = calculateCappedRouteExpectation({
        targetCount,
        maxRoutes,
        routeSuccessProbability: p,
      });
      assert.ok(
        Math.abs(
          result.actualChance -
            probabilityOfTargetWithinRoutes(maxRoutes, targetCount, p),
        ) < 1e-12,
      );
      assert.ok(result.expectedAttempts <= maxRoutes + 1e-12);
      assert.ok(
        Math.abs(
          result.remainingSuccessDistribution.reduce(
            (sum, entry) => sum + entry.probability,
            0,
          ) - result.failureProbability,
        ) < 1e-12,
      );
    }
  }

  const targetOne = calculateCappedRouteExpectation({
    targetCount: 1,
    maxRoutes: 8,
    routeSuccessProbability: p,
  });
  assert.ok(
    Math.abs(
      targetOne.expectedAttempts - (1 - (1 - p) ** 8) / p,
    ) < 1e-12,
  );
  const certain = calculateCappedRouteExpectation({
    targetCount: 3,
    maxRoutes: 10,
    routeSuccessProbability: 1,
  });
  assert.equal(certain.actualChance, 1);
  assert.equal(certain.expectedAttempts, 3);
  assert.equal(certain.expected.successfulRoutes, 3);
});
