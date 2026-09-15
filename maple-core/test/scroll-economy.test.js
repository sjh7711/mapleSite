import test from "node:test";
import assert from "node:assert/strict";

import {
  CHAOS_RETURN_EXCHANGE_DEFAULTS,
  calculateChaosReturnEconomy,
  maplePointsToMeso,
  mesoToMaplePoints,
} from "maple-core/scroll-economy";
import { chaosAtLeast } from "maple-core/scroll";

const close = (actual, expected, epsilon = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= epsilon * Math.max(1, Math.abs(expected)),
    `${actual} != ${expected}`,
  );

test("1억 메소=2000 메포를 기본 환산값으로 쓴다", () => {
  assert.equal(
    CHAOS_RETURN_EXCHANGE_DEFAULTS.maplePointsPer100MillionMeso,
    2_000,
  );
  assert.equal(mesoToMaplePoints(100_000_000), 2_000);
  assert.equal(maplePointsToMeso(2_000), 100_000_000);
  assert.equal(mesoToMaplePoints(250_000_000, 2_400), 6_000);
});

test("부분 완성 장비는 현재 상승량을 빼고 남은 작만 계산한다", () => {
  const prices = {
    chaos60Meso: 30_000,
    returnMaplePoints: 6_900,
  };
  const inventory = { chaos100Stock: 1 };
  const partial = calculateChaosReturnEconomy({
    slots: 4,
    averageAttackTarget: 5,
    averageStatTarget: 3,
    statCount: 1,
    progress: { completedSlots: 2, attack: 10, stat: 4 },
    prices,
    inventory,
  });
  const remainingOnly = calculateChaosReturnEconomy({
    slots: 2,
    averageAttackTarget: 5,
    averageStatTarget: 4,
    statCount: 1,
    prices,
    inventory,
  });

  assert.deepEqual(partial.progress, {
    completedSlots: 2,
    remainingSlots: 2,
    current: { attack: 10, stat: 4 },
    needed: { attack: 10, stat: 8 },
  });
  assert.deepEqual(partial.expected, remainingOnly.expected);
  assert.deepEqual(partial.costs, remainingOnly.costs);
  assert.deepEqual(
    partial.strategy.initialAction,
    remainingOnly.strategy.initialAction,
  );
  assert.deepEqual(partial.goals, {
    attack: 20,
    stat: 12,
    averageAttack: 5,
    averageStat: 3,
  });
});

test("현재 누적값이 최종 목표보다 앞서면 남은 작은 리턴 없이 채운다", () => {
  const result = calculateChaosReturnEconomy({
    slots: 4,
    averageAttackTarget: 2,
    averageStatTarget: 0,
    statCount: 0,
    progress: { completedSlots: 2, attack: 12, stat: 0 },
    prices: { chaos60Meso: 30_000, returnMaplePoints: 6_900 },
  });

  assert.deepEqual(result.progress.needed, { attack: 0, stat: 0 });
  close(result.expected.chaosScrolls, 2);
  close(result.expected.purchasedChaos60, 2);
  close(result.expected.unprotectedChaosScrolls, 2);
  close(result.expected.returnScrolls, 0);
  close(result.costs.meso, 60_000);
  close(result.costs.maplePoints, 0);
});

test("진행 상태를 생략하면 명시적인 0작 시작과 같은 결과를 낸다", () => {
  const options = {
    slots: 3,
    averageAttackTarget: 4,
    averageStatTarget: 2,
    statCount: 1,
    prices: { chaos60Meso: 30_000, returnMaplePoints: 6_900 },
  };
  const omitted = calculateChaosReturnEconomy(options);
  const explicit = calculateChaosReturnEconomy({
    ...options,
    progress: { completedSlots: 0, attack: 0, stat: 0 },
  });
  assert.deepEqual(omitted, explicit);
});

test("부분 완성 시작 상태의 경계와 첫작 초기화 충돌을 검증한다", () => {
  const common = {
    slots: 4,
    averageAttackTarget: 6,
    averageStatTarget: 0,
    statCount: 0,
    prices: { chaos60Meso: 30_000, returnMaplePoints: 6_900 },
  };

  assert.throws(
    () => calculateChaosReturnEconomy({
      ...common,
      progress: { completedSlots: 2, attack: 10, stat: 0 },
    }),
    /남은 2작으로 필요한 공·마 \+14/,
  );
  assert.throws(
    () => calculateChaosReturnEconomy({
      ...common,
      progress: { completedSlots: 5, attack: 0, stat: 0 },
    }),
    /전체 작 수보다 클 수 없습니다/,
  );
  assert.throws(
    () => calculateChaosReturnEconomy({
      ...common,
      averageAttackTarget: 3,
      progress: { completedSlots: 2, attack: 13, stat: 0 },
    }),
    /현재 놀긍 공·마 합은 최대 12/,
  );
  assert.throws(
    () => calculateChaosReturnEconomy({
      ...common,
      averageAttackTarget: 3,
      progress: { completedSlots: 2, attack: 6, stat: 0 },
      firstWork: { chaosRates: [60, 100], attackTarget: 6, statTarget: 0 },
    }),
    /첫작 초기화 전략을 함께 사용할 수 없습니다/,
  );
});

test("모든 작이 끝난 장비는 목표 충족 여부만 판단한다", () => {
  const complete = calculateChaosReturnEconomy({
    slots: 2,
    averageAttackTarget: 6,
    averageStatTarget: 0,
    statCount: 0,
    progress: { completedSlots: 2, attack: 12, stat: 0 },
    prices: { chaos60Meso: 30_000, returnMaplePoints: 6_900 },
  });
  assert.equal(complete.strategy.initialAction.phase, "complete");
  close(complete.expected.chaosScrolls, 0);
  close(complete.expected.returnScrolls, 0);
  close(complete.costs.meso, 0);
  close(complete.costs.maplePoints, 0);

  assert.throws(
    () => calculateChaosReturnEconomy({
      slots: 2,
      averageAttackTarget: 6,
      averageStatTarget: 0,
      statCount: 0,
      progress: { completedSlots: 2, attack: 10, stat: 0 },
    }),
    /남은 0작으로 필요한 공·마 \+2/,
  );
});

test("보유 아크 이노센트는 평균 횟수에서 단순 차감하지 않는다", () => {
  const result = calculateChaosReturnEconomy({
    slots: 1,
    averageAttackTarget: 6,
    averageStatTarget: 0,
    statCount: 0,
    firstWork: { chaosRate: 100, attackTarget: 6, statTarget: 0 },
    prices: {
      chaos100Meso: 1,
      arkInnocent100Meso: 100,
      returnMaplePoints: 6_900,
    },
    inventory: { arkInnocentStock: 2 },
  });
  const success = chaosAtLeast(6);
  const failure = 1 - success;
  const expectedFailures = failure / success;
  const expectedOwned = failure + failure ** 2;
  const expectedPurchased = failure ** 3 / success;

  close(result.expected.arkInnocent100, expectedFailures);
  close(result.expected.ownedArkInnocent100Used, expectedOwned);
  close(result.expected.purchasedArkInnocent100, expectedPurchased);
  close(expectedOwned + expectedPurchased, expectedFailures);
  assert.notEqual(
    result.expected.purchasedArkInnocent100,
    Math.max(0, expectedFailures - 2),
  );
});

test("보유 놀긍 100% 한 장 후 유료 리턴 구간은 60%로 계속한다", () => {
  const result = calculateChaosReturnEconomy({
    slots: 1,
    averageAttackTarget: 6,
    averageStatTarget: 0,
    statCount: 0,
    prices: { chaos60Meso: 30_000, returnMaplePoints: 6_900 },
    inventory: { chaos100Stock: 1 },
  });
  const optionChance = chaosAtLeast(6);
  const paidAttemptsAfterOwnedMiss = (1 - optionChance) / (0.6 * optionChance);

  close(result.expected.ownedChaos100Used, 1);
  close(result.expected.purchasedChaos60, paidAttemptsAfterOwnedMiss);
  close(result.expected.returnScrolls, 1 + paidAttemptsAfterOwnedMiss);
  assert.equal(result.expected.purchasedChaos100, 0);
  assert.equal(result.strategy.returnPaidRate, 60);
});

test("목표 0에서는 리턴 없이 쓰고 보유 100%도 메소가 적은 위치에 배분한다", () => {
  const result = calculateChaosReturnEconomy({
    slots: 2,
    averageAttackTarget: 0,
    averageStatTarget: 0,
    statCount: 0,
    firstWork: { chaosRates: [60, 100], attackTarget: 0, statTarget: 0 },
    prices: {
      chaos60Meso: 30_000,
      chaos100Meso: 100_000_000,
      arkInnocent100Meso: 1_000_000,
      returnMaplePoints: 6_900,
    },
    inventory: { chaos100Stock: 1 },
  });

  close(result.expected.first.purchasedChaos60, 0);
  close(result.expected.first.ownedChaos100Used, 1);
  close(result.expected.remainder.purchasedChaos60, 1);
  close(result.expected.remainder.unprotectedPurchasedChaos60, 1);
  close(result.expected.unprotectedChaosScrolls, 1);
  close(result.expected.returnScrolls, 0);
  assert.equal(result.strategy.initialAction.source, "owned-chaos-100");
  assert.equal(result.strategy.initialAction.usesReturn, false);
});

test("첫작 유료 60/100%는 가격에 따라 자동으로 고른다", () => {
  const hundred = calculateChaosReturnEconomy({
    slots: 1,
    averageAttackTarget: 0,
    averageStatTarget: 0,
    statCount: 0,
    firstWork: { chaosRates: [60, 100], attackTarget: 0, statTarget: 0 },
    prices: {
      chaos60Meso: 100,
      chaos100Meso: 150,
      arkInnocent100Meso: 0,
    },
  });
  assert.equal(hundred.strategy.initialAction.source, "purchased-chaos-100");
  assert.equal(hundred.strategy.initialAction.rate, 100);
  close(hundred.expected.first.purchasedChaos60, 0);
  close(hundred.expected.first.purchasedChaos100, 1);
  assert.equal(hundred.strategy.firstPaidRate, null);
  assert.deepEqual(hundred.strategy.firstPaidRates, [60, 100]);
  assert.equal(hundred.strategy.firstPaidRateMode, "auto");

  const sixty = calculateChaosReturnEconomy({
    slots: 1,
    averageAttackTarget: 0,
    averageStatTarget: 0,
    statCount: 0,
    firstWork: { attackTarget: 0, statTarget: 0 },
    prices: {
      chaos60Meso: 100,
      chaos100Meso: 200,
      arkInnocent100Meso: 0,
    },
  });
  assert.equal(sixty.strategy.initialAction.source, "purchased-chaos-60");
  assert.equal(sixty.strategy.initialAction.rate, 60);
  close(sixty.expected.first.purchasedChaos60, 1 / 0.6);
  close(sixty.expected.first.purchasedChaos100, 0);
});

test("자동 첫작은 아크 이노 재고가 변한 다음 상태에서 주문서를 다시 고른다", () => {
  const result = calculateChaosReturnEconomy({
    slots: 1,
    averageAttackTarget: 0,
    averageStatTarget: 0,
    statCount: 0,
    firstWork: { chaosRates: [60, 100], attackTarget: 0, statTarget: 0 },
    prices: {
      chaos60Meso: 1,
      chaos100Meso: 2,
      arkInnocent100Meso: 100,
    },
    inventory: { arkInnocentStock: 1 },
  });

  // 첫 시도는 60%(비용 1), 실패해 무료 아크 이노를 쓴 뒤에는
  // 아크 이노 구매비를 줄이기 위해 100%(비용 2)로 바꾼다.
  assert.equal(result.strategy.initialAction.source, "purchased-chaos-60");
  close(result.expected.first.purchasedChaos60, 1);
  close(result.expected.first.purchasedChaos100, 0.4);
  close(result.expected.ownedArkInnocent100Used, 0.4);
  close(result.expected.purchasedArkInnocent100, 0);
  close(result.costs.meso, 1.8);
});

test("첫작 목표를 넘겨도 최종 목표를 잇지 못하는 결과는 초기화한다", () => {
  const result = calculateChaosReturnEconomy({
    slots: 2,
    averageAttackTarget: 6,
    averageStatTarget: 0,
    statCount: 0,
    firstWork: { chaosRate: 100, attackTarget: 4, statTarget: 0 },
    prices: {
      chaos60Meso: 30_000,
      chaos100Meso: 1,
      arkInnocent100Meso: 1,
      returnMaplePoints: 6_900,
    },
  });
  const six = chaosAtLeast(6);

  // 첫작 목표만 보면 공4와 공6이 모두 통과지만, 최종 공12에는 공6만 이어진다.
  close(result.expected.first.purchasedChaos100, 1 / six);
  close(result.expected.arkInnocent100, 1 / six - 1);
  assert.equal(result.strategy.initialAction.requestedOutcomeCount, 2);
  assert.equal(result.strategy.initialAction.finalFeasibleOutcomeCount, 1);
  assert.equal(result.strategy.initialAction.acceptedOutcomeCount, 1);

  const lessStrict = calculateChaosReturnEconomy({
    slots: 2,
    averageAttackTarget: 5,
    averageStatTarget: 0,
    statCount: 0,
    firstWork: { chaosRate: 100, attackTarget: 4, statTarget: 0 },
    prices: {
      chaos60Meso: 30_000,
      chaos100Meso: 1,
      arkInnocent100Meso: 1,
      returnMaplePoints: 6_900,
    },
  });
  assert.equal(lessStrict.strategy.initialAction.requestedOutcomeCount, 2);
  assert.equal(lessStrict.strategy.initialAction.finalFeasibleOutcomeCount, 2);
});

test("첫작 스탯 목표도 최종 합계를 이을 수 있는 결과만 채택한다", () => {
  const result = calculateChaosReturnEconomy({
    slots: 2,
    averageAttackTarget: 0,
    averageStatTarget: 6,
    statCount: 1,
    firstWork: { chaosRate: 100, attackTarget: 0, statTarget: 4 },
    prices: {
      chaos60Meso: 30_000,
      chaos100Meso: 1,
      arkInnocent100Meso: 1,
      returnMaplePoints: 6_900,
    },
  });
  const six = chaosAtLeast(6);

  // 스탯 +4는 첫작 목표에는 맞지만 나머지 한 칸으로 합계 12를
  // 만들 수 없으므로 초기화하고, +6인 결과만 이어 간다.
  close(result.expected.first.purchasedChaos100, 1 / six);
  assert.equal(result.strategy.initialAction.requestedOutcomeCount, 12);
  assert.equal(result.strategy.initialAction.finalFeasibleOutcomeCount, 6);
  assert.equal(result.strategy.initialAction.acceptedOutcomeCount, 6);
});

test("단일 첫작 chaosRate 입력은 하위 호환한다", () => {
  const result = calculateChaosReturnEconomy({
    slots: 2,
    averageAttackTarget: 0,
    averageStatTarget: 0,
    statCount: 0,
    firstWork: { chaosRate: 100, attackTarget: 0, statTarget: 0 },
    prices: {
      chaos60Meso: 30_000,
      chaos100Meso: 45_000_000,
      arkInnocent100Meso: 1_000_000,
      returnMaplePoints: 6_900,
    },
  });

  close(result.expected.first.purchasedChaos100, 1);
  close(result.expected.first.purchasedChaos60, 0);
  close(result.expected.remainder.purchasedChaos60, 1);
  close(result.expected.remainder.unprotectedPurchasedChaos60, 1);
  close(result.expected.returnScrolls, 0);
  assert.equal(result.expected.purchasedChaos100, 1);
  assert.equal(result.strategy.firstPaidRate, 100);
  assert.deepEqual(result.strategy.firstPaidRates, [100]);
  assert.equal(result.strategy.firstPaidRateMode, "fixed");
  assert.equal(result.strategy.returnPaidRate, 60);
});

test("자동 첫작은 0원·미입력 주문서를 무료 구매 후보로 쓰지 않는다", () => {
  const common = {
    slots: 1,
    averageAttackTarget: 0,
    averageStatTarget: 0,
    statCount: 0,
    firstWork: { chaosRates: [60, 100], attackTarget: 0, statTarget: 0 },
  };

  const onlyHundred = calculateChaosReturnEconomy({
    ...common,
    prices: { chaos60Meso: 0, chaos100Meso: 10 },
  });
  assert.deepEqual(onlyHundred.strategy.firstPaidRates, [100]);
  assert.equal(onlyHundred.strategy.initialAction.source, "purchased-chaos-100");

  const onlySixty = calculateChaosReturnEconomy({
    ...common,
    prices: { chaos60Meso: 10 },
  });
  assert.deepEqual(onlySixty.strategy.firstPaidRates, [60]);
  assert.equal(onlySixty.strategy.initialAction.source, "purchased-chaos-60");

  assert.throws(
    () => calculateChaosReturnEconomy(common),
    /\uC790\uB3D9 \uCCAB\uC791.*\uAC00\uACA9/,
  );

  // 예전 단일 chaosRate API는 0원 가격을 사용하던 동작을 유지한다.
  const legacyFixed = calculateChaosReturnEconomy({
    ...common,
    firstWork: { chaosRate: 60, attackTarget: 0, statTarget: 0 },
  });
  assert.equal(legacyFixed.strategy.firstPaidRateMode, "fixed");
  assert.equal(legacyFixed.strategy.initialAction.rate, 60);
  close(legacyFixed.costs.meso, 0);
});

test("환산 표시값은 정책을 바꾸지 않고 두 화폐 합계를 모두 제공한다", () => {
  const common = {
    slots: 1,
    averageAttackTarget: 6,
    averageStatTarget: 0,
    statCount: 0,
    prices: { chaos60Meso: 100_000_000, returnMaplePoints: 2_000 },
  };
  const result = calculateChaosReturnEconomy(common);
  const attempts = 1 / (0.6 * chaosAtLeast(6));

  close(result.expected.returnScrolls, attempts);
  close(result.costs.meso, 100_000_000 * attempts);
  close(result.costs.maplePoints, 2_000 * attempts);
  close(
    result.costs.equivalent.totalMaplePoints,
    result.costs.maplePoints + result.costs.meso / 100_000_000 * 2_000,
  );
  close(
    result.costs.equivalent.totalMeso,
    result.costs.meso + result.costs.maplePoints / 2_000 * 100_000_000,
  );
  assert.equal(result.objective.conversionAffectsStrategy, false);
});

test("목표가 0이면 구매 놀긍 60%를 리턴 없이 한 번만 바른다", () => {
  const result = calculateChaosReturnEconomy({
    slots: 1,
    averageAttackTarget: 0,
    averageStatTarget: 0,
    statCount: 0,
    prices: { chaos60Meso: 30_000, returnMaplePoints: 6_900 },
  });

  close(result.expected.purchasedChaos60, 1);
  close(result.expected.returnScrolls, 0);
  close(result.expected.unprotectedChaosScrolls, 1);
  close(result.expected.remainder.unprotectedChaosScrolls, 1);
  close(result.expected.remainder.unprotectedPurchasedChaos60, 1);
  close(result.expected.remainder.unprotectedOwnedChaos100Used, 0);
  close(result.costs.meso, 30_000);
  close(result.costs.maplePoints, 0);
  assert.deepEqual(
    {
      source: result.strategy.initialAction.source,
      usesReturn: result.strategy.initialAction.usesReturn,
      protected: result.strategy.initialAction.protected,
      chance: result.strategy.initialAction.chance,
      scrollSuccessRate: result.strategy.initialAction.scrollSuccessRate,
      failureConsumesSlot: result.strategy.initialAction.failureConsumesSlot,
    },
    {
      source: "purchased-chaos-60",
      usesReturn: false,
      protected: false,
      chance: 1,
      scrollSuccessRate: 0.6,
      failureConsumesSlot: true,
    },
  );
});

test("여유 있는 양수 목표에서는 무리턴과 보호 리턴을 상태에 따라 섞는다", () => {
  const result = calculateChaosReturnEconomy({
    slots: 2,
    averageAttackTarget: 0.5,
    averageStatTarget: 0,
    statCount: 0,
    prices: { chaos60Meso: 30_000, returnMaplePoints: 6_900 },
  });

  assert.equal(result.strategy.initialAction.usesReturn, false);
  assert.equal(result.strategy.initialAction.failureConsumesSlot, true);
  assert.ok(result.expected.unprotectedChaosScrolls > 1);
  assert.ok(result.expected.returnScrolls > 0);
  close(
    result.expected.chaosScrolls,
    result.expected.returnScrolls + result.expected.unprotectedChaosScrolls,
  );
  close(
    result.expected.unprotectedChaosScrolls,
    result.expected.remainder.unprotectedPurchasedChaos60 +
      result.expected.remainder.unprotectedOwnedChaos100Used,
  );
});

test("최대 공격력 경계 목표는 무리턴이 불가능해 기존 보호 기대값을 유지한다", () => {
  const result = calculateChaosReturnEconomy({
    slots: 2,
    averageAttackTarget: 6,
    averageStatTarget: 0,
    statCount: 0,
    prices: { chaos60Meso: 30_000, returnMaplePoints: 6_900 },
  });
  const expectedAttempts = 2 / (0.6 * chaosAtLeast(6));

  close(result.expected.chaosScrolls, expectedAttempts);
  close(result.expected.returnScrolls, expectedAttempts);
  close(result.expected.unprotectedChaosScrolls, 0);
  assert.equal(result.strategy.initialAction.usesReturn, true);
  assert.equal(result.strategy.initialAction.failureConsumesSlot, false);
});

test("보유 놀긍 100% 무리턴은 필요한 칸만 사용하고 남은 재고를 보존한다", () => {
  const result = calculateChaosReturnEconomy({
    slots: 1,
    averageAttackTarget: 0,
    averageStatTarget: 0,
    statCount: 3,
    prices: { chaos60Meso: 30_000, returnMaplePoints: 6_900 },
    inventory: { chaos100Stock: 100 },
  });

  close(result.expected.ownedChaos100Used, 1);
  close(result.expected.remainder.unprotectedOwnedChaos100Used, 1);
  close(result.expected.purchasedChaos60, 0);
  close(result.expected.returnScrolls, 0);
  assert.equal(result.strategy.initialAction.source, "owned-chaos-100");
  assert.equal(result.strategy.initialAction.usesReturn, false);
});

test("동일 후속 상태 결과를 묶되 원시 결과 개수 메타데이터는 유지한다", () => {
  const result = calculateChaosReturnEconomy({
    slots: 4,
    averageAttackTarget: 1,
    averageStatTarget: 1,
    statCount: 3,
    prices: { chaos60Meso: 30_000, returnMaplePoints: 6_900 },
    inventory: { chaos100Stock: 2 },
  });

  assert.ok(
    result.diagnostics.remainder.groupedTransitionEntries <
      result.diagnostics.remainder.rawTransitionEntries,
  );
  assert.ok(result.strategy.initialAction.acceptedOutcomeCount > 0);
  assert.ok(result.strategy.initialAction.acceptedOutcomeCount <= 108);
});

test("보유분·가격·놀긍 확률 입력을 검증한다", () => {
  assert.throws(
    () => calculateChaosReturnEconomy({
      slots: 1,
      inventory: { chaos100Stock: 0.5 },
    }),
    RangeError,
  );
  assert.throws(
    () => calculateChaosReturnEconomy({
      slots: 1,
      firstWork: { chaosRate: 70 },
    }),
    RangeError,
  );
  assert.throws(
    () => calculateChaosReturnEconomy({
      slots: 1,
      firstWork: { chaosRates: [] },
    }),
    RangeError,
  );
  assert.throws(
    () => calculateChaosReturnEconomy({
      slots: 1,
      firstWork: { chaosRates: [60, 70] },
    }),
    RangeError,
  );
  assert.throws(
    () => calculateChaosReturnEconomy({
      slots: 1,
      returnWork: { chaosRate: 100 },
    }),
    RangeError,
  );
  assert.throws(
    () => calculateChaosReturnEconomy({
      slots: 1,
      prices: { returnMaplePoints: -1 },
    }),
    RangeError,
  );
});
