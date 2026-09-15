import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateChaosAggregateReturn,
  calculateChaosFirstWork,
  calculateChaosReturn,
  calculateChaosReturnStrategy,
  calculateChaosSpam,
  calculateMagicalReturn,
  calculateMagicalReturnCraft,
  calculateSlotCraft,
  chaosAtLeast,
  chaosMean,
  chaosOutcomeDistribution,
  chaosSumAtLeast,
  traceSuccessRate,
} from "../src/scroll.js";

const EXHAUSTIVE_ACTIONS = {
  scroll: "주문서",
  clean: "순백",
  innocent: "이노센트",
};

/* 구현과 독립된 작은 Gaussian elimination. 작은 슬롯의 모든 결정적 정책을
   열거해 엔진의 정책 반복 결과가 전역 최솟값인지 회귀 검증하는 데 쓴다. */
function solveDenseSystem(matrix, rightHandSide) {
  const size = matrix.length;
  const rows = matrix.map((row, index) => [...row, rightHandSide[index]]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    if (Math.abs(rows[pivot][column]) < 1e-12) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    for (let row = column + 1; row < size; row += 1) {
      const ratio = rows[row][column] / rows[column][column];
      for (let next = column; next <= size; next += 1) {
        rows[row][next] -= ratio * rows[column][next];
      }
    }
  }
  const solved = new Array(size).fill(0);
  for (let row = size - 1; row >= 0; row -= 1) {
    let value = rows[row][size];
    for (let column = row + 1; column < size; column += 1) {
      value -= rows[row][column] * solved[column];
    }
    solved[row] = value / rows[row][row];
  }
  return solved;
}

function exhaustiveSlotOptima({
  slots,
  successRate,
  scrollCost,
  cleanCost,
  innocentCost,
  slotProtectionRate = 0,
}) {
  const key = (success, remaining) => `${success}:${remaining}`;
  const states = [];
  for (let success = 0; success < slots; success += 1) {
    for (let remaining = 0; remaining <= slots - success; remaining += 1) {
      states.push([success, remaining]);
    }
  }
  const indices = new Map(states.map((state, index) => [key(...state), index]));
  const choices = states.map(([success, remaining]) => {
    const actions = [];
    if (remaining > 0) actions.push(EXHAUSTIVE_ACTIONS.scroll);
    if (remaining < slots - success) actions.push(EXHAUSTIVE_ACTIONS.clean);
    if ((success > 0 || remaining < slots) && Number.isFinite(innocentCost)) {
      actions.push(EXHAUSTIVE_ACTIONS.innocent);
    }
    return actions;
  });
  const picked = new Array(states.length);
  const minima = new Array(states.length).fill(Number.POSITIVE_INFINITY);
  let properPolicies = 0;

  const addTransition = (matrix, row, success, remaining, chance) => {
    if (!(chance > 0) || success >= slots) return;
    matrix[row][indices.get(key(success, remaining))] -= chance;
  };
  const evaluate = () => {
    const matrix = states.map(() => new Array(states.length).fill(0));
    const costs = new Array(states.length).fill(0);
    states.forEach(([success, remaining], row) => {
      matrix[row][row] = 1;
      const action = picked[row];
      if (action === EXHAUSTIVE_ACTIONS.scroll) {
        const failure = 1 - successRate;
        costs[row] = scrollCost;
        addTransition(matrix, row, success + 1, remaining - 1, successRate);
        addTransition(
          matrix,
          row,
          success,
          remaining - 1,
          failure * (1 - slotProtectionRate),
        );
        addTransition(
          matrix,
          row,
          success,
          remaining,
          failure * slotProtectionRate,
        );
      } else if (action === EXHAUSTIVE_ACTIONS.clean) {
        costs[row] = cleanCost;
        addTransition(matrix, row, success, remaining + 1, 1);
      } else {
        costs[row] = innocentCost;
        addTransition(matrix, row, 0, slots, 1);
      }
    });
    const values = solveDenseSystem(matrix, costs);
    if (!values || values.some((value) => !Number.isFinite(value) || value < -1e-7)) return;
    properPolicies += 1;
    values.forEach((value, index) => {
      minima[index] = Math.min(minima[index], value);
    });
  };
  const visit = (index) => {
    if (index === states.length) return evaluate();
    for (const action of choices[index]) {
      picked[index] = action;
      visit(index + 1);
    }
  };
  visit(0);
  return { states, minima, properPolicies };
}

function exhaustiveOneSlotStockCost({
  successRate,
  slotProtectionRate = 0,
  scrollCost,
  cleanCost,
  innocentCost,
  cleanStock,
  innocentStock,
}) {
  const key = (remaining, clean, innocent) => `${remaining}:${clean}:${innocent}`;
  const states = [];
  for (let clean = 0; clean <= cleanStock; clean += 1) {
    for (let innocent = 0; innocent <= innocentStock; innocent += 1) {
      states.push([0, clean, innocent], [1, clean, innocent]);
    }
  }
  const indices = new Map(states.map((state, index) => [key(...state), index]));
  const decisionRows = states
    .map(([remaining], index) => remaining === 0 ? index : -1)
    .filter((index) => index >= 0);
  const picked = new Map();
  let minimum = Number.POSITIVE_INFINITY;

  const evaluate = () => {
    const matrix = states.map(() => new Array(states.length).fill(0));
    const costs = new Array(states.length).fill(0);
    states.forEach(([remaining, clean, innocent], row) => {
      matrix[row][row] = 1;
      if (remaining === 1) {
        costs[row] = scrollCost;
        const failure = 1 - successRate;
        matrix[row][indices.get(key(0, clean, innocent))] -=
          failure * (1 - slotProtectionRate);
        matrix[row][row] -= failure * slotProtectionRate;
        return;
      }
      const action = picked.get(row);
      if (action === EXHAUSTIVE_ACTIONS.clean) {
        costs[row] = clean > 0 ? 0 : cleanCost;
        matrix[row][indices.get(key(1, Math.max(0, clean - 1), innocent))] -= 1;
      } else {
        costs[row] = innocent > 0 ? 0 : innocentCost;
        matrix[row][indices.get(key(1, clean, Math.max(0, innocent - 1)))] -= 1;
      }
    });
    const values = solveDenseSystem(matrix, costs);
    if (values) {
      minimum = Math.min(
        minimum,
        values[indices.get(key(1, cleanStock, innocentStock))],
      );
    }
  };
  const visit = (index) => {
    if (index === decisionRows.length) return evaluate();
    const row = decisionRows[index];
    for (const action of [EXHAUSTIVE_ACTIONS.clean, EXHAUSTIVE_ACTIONS.innocent]) {
      picked.set(row, action);
      visit(index + 1);
    }
  };
  visit(0);
  return minimum;
}

test("주문의 흔적 확률에 피버·손재주·길드 보정을 더한다", () => {
  assert.equal(traceSuccessRate(30), 0.3);
  assert.equal(traceSuccessRate(30, { fever: true }), 0.45);
  assert.equal(
    traceSuccessRate(30, { fever: true, dexterity: true, guild: true }),
    0.59,
  );
  assert.equal(
    traceSuccessRate(15, { fever: true, dexterity: true, guild: true }),
    0.39,
  );
  // 70%는 보정을 다 받으면 100%를 넘어 잘린다.
  assert.equal(
    traceSuccessRate(70, { fever: true, dexterity: true, guild: true }),
    1,
  );
  assert.throws(() => traceSuccessRate(50), RangeError);
});

test("손재주는 5레벨당 0.5%p씩 단계적으로 올라간다", () => {
  assert.equal(traceSuccessRate(30, { dexterity: 4 }), 0.3);
  assert.equal(traceSuccessRate(30, { dexterity: 5 }), 0.305);
  assert.equal(traceSuccessRate(30, { dexterity: 21 }), 0.32);
  assert.equal(traceSuccessRate(30, { dexterity: 24 }), 0.32);
  assert.equal(traceSuccessRate(30, { dexterity: 25 }), 0.325);
  assert.equal(traceSuccessRate(30, { dexterity: 100 }), 0.4);
  assert.equal(traceSuccessRate(30, { dexterity: 150 }), 0.4);
  assert.equal(traceSuccessRate(30, { dexterity: -10 }), 0.3);
});

test("놀긍혼 한 번의 평균 상승은 1.777이다", () => {
  assert.equal(chaosMean().toFixed(3), "1.777");
});

test("목표 이상이 뜰 확률을 누적으로 센다", () => {
  assert.equal(chaosAtLeast(6).toFixed(6), "0.059324");
  // +5가 없으므로 5 이상과 6 이상이 같다.
  assert.equal(chaosAtLeast(5), chaosAtLeast(6));
  assert.equal(chaosAtLeast(0).toFixed(6), "1.000000");
});

test("스탯이 여러 개면 합계 분포로 본다", () => {
  assert.equal(chaosSumAtLeast(0, 3), 1);
  // 스탯 하나일 때는 단순 누적과 같다.
  assert.equal(chaosSumAtLeast(3, 1).toFixed(6), chaosAtLeast(3).toFixed(6));
  // 셋을 더하면 같은 목표가 훨씬 쉬워진다.
  assert.ok(chaosSumAtLeast(6, 3) > chaosSumAtLeast(6, 1));
});

test("놀긍리턴작 기대비용이 알려진 값과 맞는다", () => {
  const 리턴값 = 6_900;
  // 공개된 표와 0.2% 안에서 맞으면 같은 계산으로 본다.
  const cases = [
    [{ attackTarget: 6, statTarget: 1 }, 237_600],
    [{ attackTarget: 6, statTarget: 2 }, 398_950],
    [{ attackTarget: 6, statTarget: 3 }, 783_870],
    [{ attackTarget: 6, statTarget: 4 }, 1_784_080],
    [{ attackTarget: 6, statTarget: 6 }, 3_270_310],
  ];
  for (const [options, expected] of cases) {
    const { cost } = calculateChaosReturn({
      chaosRate: 60,
      returnPrice: 리턴값,
      ...options,
    });
    assert.ok(
      Math.abs(cost - expected) / expected < 0.002,
      `${options.statTarget}작: ${Math.round(cost)} vs ${expected}`,
    );
  }
});

test("놀긍 100%는 60%보다 정확히 0.6배 든다", () => {
  const common = { attackTarget: 6, statTarget: 2, returnPrice: 6_900 };
  const sixty = calculateChaosReturn({ chaosRate: 60, ...common }).cost;
  const hundred = calculateChaosReturn({ chaosRate: 100, ...common }).cost;
  assert.equal((hundred / sixty).toFixed(4), "0.6000");
});

test("제논처럼 스탯이 셋이면 합계 9도 노릴 수 있다", () => {
  const common = { chaosRate: 60, attackTarget: 6, returnPrice: 6_900 };
  // 스탯 하나로는 한 번에 6까지라 합계 9가 아예 나올 수 없다.
  assert.throws(
    () => calculateChaosReturn({ ...common, statTarget: 9, statCount: 1 }),
    RangeError,
  );
  const three = calculateChaosReturn({ ...common, statTarget: 9, statCount: 3 });
  assert.ok(three.cost > 0);
  // 같은 목표라도 스탯이 셋이면 둘일 때보다 쉽다.
  const two = calculateChaosReturn({ ...common, statTarget: 9, statCount: 2 });
  assert.ok(three.cost < two.cost);
});

test("떡작은 남은 횟수에 성공률과 평균 상승을 곱한 만큼 오른다", () => {
  const result = calculateChaosSpam({ slots: 5, chaosRate: 60 });
  assert.equal(result.scrolls, 5);
  assert.equal(result.successes.toFixed(2), "3.00");
  assert.equal(result.attackGain.toFixed(3), (5 * 0.6 * chaosMean()).toFixed(3));
});

test("최적 전략은 순백만 쓰는 방식보다 비싸지 않다", () => {
  const result = calculateSlotCraft({
    slots: 8,
    successRate: 0.59,
    scrollCost: 1_350,
    cleanCost: 20_000,
    innocentCost: 24_000,
  });
  assert.ok(result.expectedCost <= result.cleanOnly.cost + 1e-6);
  assert.ok(result.expectedCost > 0);
});

test("이노센트를 쓸 수 없으면 순백만 쓰는 값과 같아진다", () => {
  const options = {
    slots: 4,
    successRate: 0.5,
    scrollCost: 100,
    cleanCost: 1_000,
  };
  const result = calculateSlotCraft(options);
  // 이노센트가 없으면 실패한 칸은 순백으로만 되살릴 수 있다.
  assert.equal(
    result.expectedCost.toFixed(4),
    result.cleanOnly.cost.toFixed(4),
  );
});

test("실패 시 업횟 보호를 self-loop로 반영한다", () => {
  const result = calculateSlotCraft({
    slots: 1,
    successRate: 0.5,
    scrollCost: 100,
    cleanCost: 1_000,
    slotProtectionRate: 0.04,
  });

  // 평균 2번 시도, 실패 1번 중 96%만 업횟을 소모한다.
  assert.equal(result.expected.scrolls.toFixed(6), "2.000000");
  assert.equal(result.expected.cleans.toFixed(6), "0.960000");
  assert.equal(result.expectedCost.toFixed(6), "1160.000000");
  assert.equal(result.cleanOnly.cleans, 0.96);
  assert.equal(result.cleanOnly.cost, 1_160);
});

test("업횟 보호 기본값 0은 기존 결과를 그대로 보존한다", () => {
  const options = {
    slots: 4,
    successRate: 0.5,
    scrollCost: 100,
    cleanCost: 1_000,
    innocentCost: 5_000,
  };
  const omitted = calculateSlotCraft(options);
  const explicitZero = calculateSlotCraft({ ...options, slotProtectionRate: 0 });
  assert.equal(omitted.expectedCost, explicitZero.expectedCost);
  assert.deepEqual(omitted.expected, explicitZero.expected);
  assert.deepEqual(omitted.cleanOnly, explicitZero.cleanOnly);
});

test("성공 확률이 100%면 주문서 값만 든다", () => {
  const result = calculateSlotCraft({
    slots: 6,
    successRate: 1,
    scrollCost: 500,
    cleanCost: 10_000,
    innocentCost: 20_000,
  });
  assert.equal(result.expectedCost, 3_000);
});

test("확률이 높을수록 싸진다", () => {
  const base = {
    slots: 7,
    scrollCost: 1_000,
    cleanCost: 20_000,
    innocentCost: 24_000,
  };
  const low = calculateSlotCraft({ ...base, successRate: 0.39 });
  const high = calculateSlotCraft({ ...base, successRate: 0.59 });
  assert.ok(high.expectedCost < low.expectedCost);
});

test("이미 작이 붙어 있으면 남은 몫만 계산한다", () => {
  const base = {
    slots: 8,
    successRate: 0.59,
    scrollCost: 1_350,
    cleanCost: 20_000,
    innocentCost: 24_000,
  };
  const fresh = calculateSlotCraft(base);
  const halfway = calculateSlotCraft({
    ...base,
    startSuccess: 4,
    startRemaining: 4,
  });
  assert.ok(halfway.expectedCost < fresh.expectedCost);
});

test("상태마다 무엇을 할지 함께 돌려준다", () => {
  const { policy } = calculateSlotCraft({
    slots: 4,
    successRate: 0.5,
    scrollCost: 100,
    cleanCost: 1_000,
    innocentCost: 5_000,
  });
  const start = policy.find((p) => p.success === 0 && p.remaining === 4);
  assert.equal(start.action, "주문서");
  // 남은 횟수가 없으면 되돌리는 수밖에 없다.
  const dead = policy.find((p) => p.success === 0 && p.remaining === 0);
  assert.ok(["순백", "이노센트"].includes(dead.action));
});

test("초기화가 반복되는 희귀 성공 전략도 유한 반복 오차 없이 정확히 푼다", () => {
  const result = calculateSlotCraft({
    slots: 2,
    successRate: 0.1,
    scrollCost: 80_000_000,
    cleanCost: 1_000_000_000,
    innocentCost: 16_000_000,
  });

  // 두 번 연속 성공할 확률은 1%. 한 사이클 비용은
  // 8천만 + 10%*8천만 + 99%*1천6백만 = 1억384만이다.
  assert.equal(result.expectedCost.toFixed(0), "10384000000");
  assert.equal(result.expected.scrolls.toFixed(6), "110.000000");
  assert.equal(result.expected.innocents.toFixed(6), "99.000000");
});

test("적은 보유 주문서는 재고 상태까지 포함해 최적 행동을 바꾼다", () => {
  const common = {
    slots: 1,
    successRate: 0.5,
    scrollCost: 100,
    cleanCost: 1_000,
    innocentCost: 100,
  };
  const withoutStock = calculateSlotCraft(common);
  const withStock = calculateSlotCraft({ ...common, cleanStock: 1 });

  assert.equal(withoutStock.expectedCost, 300);
  assert.equal(withStock.expectedCost, 250);
  assert.equal(withStock.inventory.policy, "stock-aware-exact");
  assert.equal(withStock.expected.ownedCleans, 0.5);
  assert.equal(withStock.expected.paidCleans, 0);
  assert.equal(
    withoutStock.policy.find(({ success, remaining }) => success === 0 && remaining === 0).action,
    "이노센트",
  );
  assert.equal(
    withStock.policy.find(({ success, remaining }) => success === 0 && remaining === 0).action,
    "순백",
  );
});

test("확률적으로 정해지는 이노센트 재고를 분포대로 합산한다", () => {
  const result = calculateSlotCraft({
    slots: 1,
    successRate: 0.5,
    scrollCost: 100,
    cleanCost: 1_000,
    innocentCost: 100,
    innocentStockDistribution: [
      { stock: 1, chance: 0.5 },
      { stock: 0, chance: 0.5 },
    ],
  });

  assert.equal(result.expectedCost, 275);
  assert.equal(result.expected.ownedInnocents, 0.25);
  assert.equal(result.expected.paidInnocents, 0.75);
});

test("단일 주문서 재고 21개도 정확 재고 상태로 계산한다", () => {
  const result = calculateSlotCraft({
    slots: 1,
    successRate: 0.5,
    scrollCost: 100,
    cleanCost: 1_000,
    innocentCost: 100,
    cleanStock: 21,
  });

  assert.equal(result.inventory.policy, "stock-aware-exact");
  assert.ok(result.expectedCost < 201);
  assert.equal(
    result.policy.find(({ success, remaining }) => success === 0 && remaining === 0).action,
    "순백",
  );
});

test("재고 상태층이 안전 예산을 넘을 때만 후보 정책 fallback을 사용한다", () => {
  const result = calculateSlotCraft({
    slots: 1,
    successRate: 0.5,
    scrollCost: 100,
    cleanCost: 1_000,
    innocentCost: 100,
    cleanStock: 64,
    innocentStock: 64,
  });

  assert.equal(result.inventory.policy, "multi-policy-fixed-inventory");
  assert.ok(result.inventory.stockLayerCount > result.inventory.stockAwareExactLayerBudget);
});

test("1~3슬롯의 모든 완작 가능 정책보다 정확 정책 반복이 비싸지 않다", () => {
  const scenarios = [
    {
      successRate: 0.39,
      slotProtectionRate: 0.04,
      scrollCost: 1_274,
      cleanCost: 14_000,
      innocentCost: 16_000,
    },
    {
      successRate: 0.1,
      scrollCost: 80,
      cleanCost: 1_000,
      innocentCost: 16,
    },
    {
      successRate: 0.5,
      scrollCost: 100,
      cleanCost: 50,
      innocentCost: 1_000,
    },
  ];
  for (let slots = 1; slots <= 3; slots += 1) {
    for (const scenario of scenarios) {
      const exhaustive = exhaustiveSlotOptima({ slots, ...scenario });
      const result = calculateSlotCraft({ slots, ...scenario });
      assert.ok(exhaustive.properPolicies > 0);
      for (const row of result.policy) {
        const index = exhaustive.states.findIndex(
          ([success, remaining]) =>
            success === row.success && remaining === row.remaining,
        );
        const expected = exhaustive.minima[index];
        const tolerance = 1e-7 * Math.max(1, Math.abs(expected));
        assert.ok(
          Math.abs(row.cost - expected) <= tolerance,
          `slots=${slots}, p=${scenario.successRate}, state=${row.success}:${row.remaining}: ` +
            `${row.cost} vs exhaustive ${expected}`,
        );
      }
    }
  }
});

test("1슬롯의 작은 순백·이노 재고 최적화는 모든 재고 정책 열거와 같다", () => {
  const common = {
    slots: 1,
    successRate: 0.35,
    slotProtectionRate: 0.04,
    scrollCost: 100,
    cleanCost: 900,
    innocentCost: 160,
  };
  for (const [cleanStock, innocentStock] of [
    [1, 0],
    [0, 1],
    [1, 1],
    [2, 0],
    [0, 2],
  ]) {
    const result = calculateSlotCraft({
      ...common,
      cleanStock,
      innocentStock,
    });
    const exhaustive = exhaustiveOneSlotStockCost({
      ...common,
      cleanStock,
      innocentStock,
    });
    const tolerance = 1e-7 * Math.max(1, Math.abs(exhaustive));
    assert.ok(
      Math.abs(result.expectedCost - exhaustive) <= tolerance,
      `stock=${cleanStock}/${innocentStock}: ${result.expectedCost} vs ${exhaustive}`,
    );
  }
});

test("말이 안 되는 입력은 거부한다", () => {
  assert.throws(() => calculateSlotCraft({ slots: 0, successRate: 0.5 }), RangeError);
  assert.throws(
    () => calculateSlotCraft({ slots: 5, successRate: 0, scrollCost: 1 }),
    RangeError,
  );
  assert.throws(
    () => calculateSlotCraft({ slots: 5, successRate: 0.5, target: 9 }),
    RangeError,
  );
  assert.throws(
    () =>
      calculateSlotCraft({
        slots: 5,
        successRate: 0.5,
        slotProtectionRate: -0.01,
      }),
    RangeError,
  );
  assert.throws(
    () =>
      calculateSlotCraft({
        slots: 5,
        successRate: 0.5,
        slotProtectionRate: 0.041,
      }),
    RangeError,
  );
  assert.throws(
    () => calculateChaosReturn({ chaosRate: 30, returnPrice: 100 }),
    RangeError,
  );
});

test("매지컬 리턴은 모든 작의 목표를 11로 고정한다", async () => {
  const { calculateMagicalReturn } = await import("../src/scroll.js");
  // 11이 10%, 10이 40%, 9가 50%로 뜬다.
  const eleven = calculateMagicalReturn({
    target: 11,
    scrollPrice: 5_000,
    returnPrice: 6_900,
  });
  assert.equal(eleven.chance.toFixed(2), "0.10");
  assert.equal(eleven.attempts.toFixed(2), "10.00");
  assert.equal(eleven.target, 11);
  assert.equal(eleven.scrollCost, 50_000);
  assert.equal(eleven.returnCost.toFixed(0), "69000");

  for (const target of [9, 10, 12]) {
    assert.throws(
      () => calculateMagicalReturn({ target, scrollPrice: 1, returnPrice: 1 }),
      /\+11로 고정/,
    );
  }
  assert.throws(
    () => calculateMagicalReturn({ scrollPrice: -1, returnPrice: 1 }),
    RangeError,
  );
});

test("매지컬 완작은 첫작만 이노센트로 초기화하고 나머지 작에 리턴을 쓴다", () => {
  const scrollPrice = 5_000;
  const returnPrice = 6_900;
  const resetCost = 1_000;
  const result = calculateMagicalReturnCraft({
    slots: 6,
    scrollPrice,
    returnPrice,
    resetCost,
  });

  assert.equal(result.target, 11);
  assert.equal(result.chance, 0.1);
  assert.equal(result.attemptsPerWork, 10);
  assert.equal(result.expected.magicalScrolls, 60);
  assert.equal(result.expected.returnScrolls, 50);
  assert.equal(result.expected.resets, 9);
  assert.equal(result.expected.ownedResetsUsed, 0);
  assert.equal(result.expected.purchasedResetSuccesses, 9);
  assert.equal(result.expected.purchasedResetScrolls, 9);
  assert.equal(result.costs.magicalMeso, 60 * scrollPrice);
  assert.equal(result.costs.resetMeso, 9 * resetCost);
  assert.equal(result.costs.otherMeso, 60 * scrollPrice + 9 * resetCost);
  assert.equal(result.costs.returnMaplePoints, 50 * returnPrice);

  const oneWork = calculateMagicalReturnCraft({
    slots: 1,
    scrollPrice,
    returnPrice,
    resetCost,
  });
  assert.equal(oneWork.expected.magicalScrolls, 10);
  assert.equal(oneWork.expected.returnScrolls, 0);
  assert.equal(oneWork.expected.resets, 9);
  assert.equal(oneWork.costs.returnMaplePoints, 0);
});

test("매지컬 완료 횟수는 10작 고정 완작의 남은 전략으로 계산한다", async () => {
  const { calculateMagicalReturnCraftProgress } = await import("../src/scroll.js");
  const common = {
    totalSlots: 10,
    scrollPrice: 5_000,
    returnPrice: 6_900,
    resetCost: 1_000,
  };

  const fresh = calculateMagicalReturnCraftProgress({
    ...common,
    completedSlots: 0,
  });
  assert.equal(fresh.firstWorkUsesReset, true);
  assert.equal(fresh.remainingSlots, 10);
  assert.equal(fresh.expected.magicalScrolls, 100);
  assert.equal(fresh.expected.returnScrolls, 90);
  assert.equal(fresh.expected.resets, 9);

  const oneDone = calculateMagicalReturnCraftProgress({
    ...common,
    completedSlots: 1,
  });
  assert.equal(oneDone.firstWorkUsesReset, false);
  assert.equal(oneDone.remainingSlots, 9);
  assert.equal(oneDone.expected.magicalScrolls, 90);
  assert.equal(oneDone.expected.returnScrolls, 90);
  assert.equal(oneDone.expected.resets, 0);

  const twoDone = calculateMagicalReturnCraftProgress({
    ...common,
    completedSlots: 2,
  });
  assert.equal(twoDone.remainingSlots, 8);
  assert.equal(twoDone.expected.magicalScrolls, 80);
  assert.equal(twoDone.expected.returnScrolls, 80);

  const complete = calculateMagicalReturnCraftProgress({
    ...common,
    completedSlots: 10,
  });
  assert.equal(complete.remainingSlots, 0);
  assert.equal(complete.expected.magicalScrolls, 0);
  assert.equal(complete.expected.returnScrolls, 0);
  assert.equal(complete.costs.otherMeso, 0);
  assert.equal(complete.costs.returnMaplePoints, 0);

  for (const completedSlots of [-1, 11, 1.5]) {
    assert.throws(
      () => calculateMagicalReturnCraftProgress({ ...common, completedSlots }),
      /완료한 주문서 횟수/,
    );
  }
});

test("매지컬 첫작은 보유 초기화 주문서와 유료 50% 초기화를 경로별로 센다", () => {
  const result = calculateMagicalReturnCraft({
    slots: 12,
    scrollPrice: 5_000,
    returnPrice: 6_900,
    resetCost: 800,
    resetRate: 0.5,
    resetStock: 2,
  });

  // 첫작 실패 F에 대해 E[min(F, 2)] = 0.9 + 0.9^2 = 1.71이다.
  assert.equal(result.expected.ownedResetsUsed.toFixed(10), "1.7100000000");
  assert.equal(result.expected.purchasedResetSuccesses.toFixed(10), "7.2900000000");
  assert.equal(result.expected.purchasedResetScrolls.toFixed(10), "14.5800000000");
  assert.equal(result.expected.resets, 9);
  assert.equal(result.costs.resetMeso.toFixed(0), "11664");
});

test("매지컬 완작 입력값을 검증하고 기존 1작 API는 유지한다", () => {
  const common = { scrollPrice: 1, returnPrice: 1, resetCost: 1 };
  for (const slots of [0, -1, 1.5]) {
    assert.throws(() => calculateMagicalReturnCraft({ ...common, slots }), /작 수/);
  }
  for (const target of [9, 10, 12]) {
    assert.throws(
      () => calculateMagicalReturnCraft({ ...common, slots: 1, target }),
      /\+11로 고정/,
    );
  }
  for (const resetRate of [0, -0.1, 1.1, Number.NaN]) {
    assert.throws(
      () => calculateMagicalReturnCraft({ ...common, slots: 1, resetRate }),
      /성공률/,
    );
  }
  assert.throws(
    () => calculateMagicalReturnCraft({ ...common, slots: 1, resetStock: 0.5 }),
    /정수/,
  );
  assert.throws(
    () => calculateMagicalReturnCraft({ ...common, slots: 1, resetCost: -1 }),
    /초기화 주문서 가격/,
  );

  const legacy = calculateMagicalReturn({
    target: 11,
    scrollPrice: 5_000,
    returnPrice: 6_900,
  });
  assert.deepEqual(legacy, {
    target: 11,
    chance: 0.1,
    attempts: 10,
    scrollCost: 50_000,
    returnCost: 69_000,
  });
});

test("first chaos resets every non-target result without Clean Slate", () => {
  const result = calculateChaosFirstWork({
    slots: 8,
    chaosRate: 60,
    attackTarget: 6,
    statTarget: 0,
    statCount: 0,
    chaosPrice: 30_000,
    innocentPrice: 1_000_000,
  });
  const expectedChaos = 1 / (0.6 * chaosAtLeast(6));
  assert.equal(result.expected.chaosScrolls.toFixed(10), expectedChaos.toFixed(10));
  assert.equal(
    result.expected.innocentScrolls.toFixed(10),
    (expectedChaos - 1).toFixed(10),
  );
  assert.equal(result.expected.cleanScrolls, 0);
  // This is larger than counting only successful-but-bad option rolls: 40% scroll failures reset too.
  assert.ok(result.expected.innocentScrolls > (1 - chaosAtLeast(6)) / chaosAtLeast(6));
  assert.equal(
    result.cost,
    result.expected.chaosScrolls * 30_000 +
      result.expected.innocentScrolls * 1_000_000,
  );
});

test("adaptive aggregate Return subtracts accepted overshoot from later deficits", () => {
  const result = calculateChaosAggregateReturn({
    slots: 7,
    chaosRate: 60,
    attackGoal: 42,
    statGoal: 18,
    statCount: 1,
    chaosPrice: 30_000,
    returnPrice: 6_900,
  });
  assert.equal(result.expected.chaosScrolls.toFixed(9), "393.677179012");
  assert.equal(result.expected.returnScrolls, result.expected.chaosScrolls);
  assert.deepEqual(
    [...new Set(result.decision.acceptedOutcomes.map((outcome) => outcome.attack))],
    [6],
  );
  assert.deepEqual(
    result.decision.acceptedOutcomes.map((outcome) => outcome.stat).sort((a, b) => a - b),
    [2, 3, 4, 6],
  );
  const afterTwo = result.decisionFor({
    remainingSlots: 6,
    attackNeeded: 36,
    statNeeded: 16,
  });
  const afterSix = result.decisionFor({
    remainingSlots: 6,
    attackNeeded: 36,
    statNeeded: 12,
  });
  assert.ok(afterSix.expectedAttempts < afterTwo.expectedAttempts);
});

test("6/3 average strategy uses first 6/6 without a Return Scroll", () => {
  const result = calculateChaosReturnStrategy({
    slots: 8,
    averageAttackTarget: 6,
    averageStatTarget: 3,
    statCount: 1,
    firstWork: {
      chaosRate: 60,
      attackTarget: 6,
      statTarget: 6,
      chaosPrice: 30_000,
      innocentPrice: 1_000_000,
    },
    returnWork: { chaosRate: 60, chaosPrice: 30_000, returnPrice: 6_900 },
  });
  assert.deepEqual(result.goals, {
    attack: 48,
    stat: 24,
    averageAttack: 6,
    averageStat: 3,
  });
  assert.equal(result.first.expected.cleanScrolls, 0);
  assert.equal(result.remainder.slots, 7);
  assert.equal(result.remainder.initialStates.length, 1);
  assert.deepEqual(result.remainder.initialStates[0].firstOutcome, { attack: 6, stat: 6 });
  assert.equal(result.remainder.initialStates[0].attackNeeded, 42);
  assert.equal(result.remainder.initialStates[0].statNeeded, 18);
  assert.equal(result.expected.returnScrolls.toFixed(9), "393.677179012");
  assert.equal(result.costs.returnScroll, result.expected.returnScrolls * 6_900);
});

test("one-slot and zero-selected-stat strategies are supported", () => {
  const one = calculateChaosReturnStrategy({
    slots: 1,
    averageAttackTarget: 6,
    averageStatTarget: 3,
    statCount: 1,
    firstWork: { chaosRate: 100, attackTarget: 6, statTarget: 3 },
    returnWork: { chaosRate: 60 },
  });
  assert.equal(one.remainder.slots, 0);
  assert.equal(one.expected.returnScrolls, 0);

  const noStat = calculateChaosAggregateReturn({
    slots: 2,
    chaosRate: 60,
    attackGoal: 12,
    statGoal: 0,
    statCount: 0,
  });
  assert.ok(noStat.expected.returnScrolls > 0);
  assert.ok(noStat.decision.acceptedOutcomes.every((outcome) => outcome.stat === 0));
  assert.equal(
    chaosOutcomeDistribution(0).reduce((sum, outcome) => sum + outcome.chance, 0).toFixed(12),
    "1.000000000000",
  );
});

test("aggregate chaos rejects impossible goals", () => {
  assert.throws(
    () => calculateChaosAggregateReturn({ slots: 1, attackGoal: 7, statGoal: 0 }),
    RangeError,
  );
  assert.throws(
    () => calculateChaosAggregateReturn({ slots: 2, attackGoal: 0, statGoal: 1, statCount: 0 }),
    RangeError,
  );
  assert.throws(
    () =>
      calculateChaosReturnStrategy({
        slots: 1,
        averageAttackTarget: 6,
        averageStatTarget: 3,
        statCount: 1,
        firstWork: { attackTarget: 6, statTarget: 2 },
      }),
    RangeError,
  );
});
