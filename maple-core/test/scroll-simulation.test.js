import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import {
  AMAZING_POSITIVE_CHAOS,
  MAGICAL_CHANCES,
  calculateMagicalReturn,
  calculateMagicalReturnCraft,
  calculateSlotCraft,
  chaosAtLeast,
} from "../src/scroll.js";
import { calculateChaosReturnEconomy } from "../src/scroll-economy.js";

const ACTION = Object.freeze({
  scroll: "주문서",
  clean: "순백",
  innocent: "이노센트",
});

function close(actual, expected, relative = 1e-8, absolute = 1e-7) {
  const tolerance = Math.max(absolute, relative * Math.max(1, Math.abs(expected)));
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected} (허용 오차 ${tolerance})`,
  );
}

/* 코어의 정책 탐색과 별개로, 반환된 정책의 Markov 연립방정식을 직접 푼다. */
function solveLinearSystem(matrix, rightHandSides) {
  const size = matrix.length;
  const width = rightHandSides[0].length;
  const rows = matrix.map((row, index) => [
    ...row,
    ...rightHandSides[index],
  ]);

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    }
    assert.ok(Math.abs(rows[pivot][column]) > 1e-12, "정책이 종료 상태로 수렴해야 합니다.");
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];

    const divisor = rows[column][column];
    for (let entry = column; entry < size + width; entry += 1) {
      rows[column][entry] /= divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const multiplier = rows[row][column];
      if (Math.abs(multiplier) < 1e-18) continue;
      for (let entry = column; entry < size + width; entry += 1) {
        rows[row][entry] -= multiplier * rows[column][entry];
      }
    }
  }

  return rows.map((row) => row.slice(size));
}

function evaluateSlotPolicy(result, options) {
  const {
    slots,
    successRate,
    scrollCost,
    cleanCost,
    innocentCost = Number.POSITIVE_INFINITY,
    target = slots,
    startSuccess = 0,
    startRemaining = slots,
    slotProtectionRate = 0,
  } = options;
  const states = result.policy.filter(({ success }) => success < target);
  const stateIndex = new Map(
    states.map(({ success, remaining }, index) => [`${success}:${remaining}`, index]),
  );
  const matrix = states.map((_, index) =>
    Array.from({ length: states.length }, (_entry, column) => index === column ? 1 : 0)
  );
  const rewards = states.map(() => [0, 0, 0, 0]);

  function transition(row, success, remaining, chance) {
    if (!(chance > 0) || success >= target) return;
    const next = stateIndex.get(`${success}:${remaining}`);
    assert.notEqual(next, undefined, `정책에 ${success}:${remaining} 상태가 있어야 합니다.`);
    matrix[row][next] -= chance;
  }

  states.forEach((state, row) => {
    if (state.action === ACTION.scroll) {
      rewards[row] = [1, 0, 0, scrollCost];
      const failure = 1 - successRate;
      transition(row, state.success + 1, state.remaining - 1, successRate);
      transition(
        row,
        state.success,
        state.remaining - 1,
        failure * (1 - slotProtectionRate),
      );
      transition(row, state.success, state.remaining, failure * slotProtectionRate);
    } else if (state.action === ACTION.clean) {
      rewards[row] = [0, 1, 0, cleanCost];
      transition(row, state.success, state.remaining + 1, 1);
    } else {
      assert.equal(state.action, ACTION.innocent);
      rewards[row] = [0, 0, 1, innocentCost];
      transition(row, 0, slots, 1);
    }
  });

  const solution = solveLinearSystem(matrix, rewards);
  const start = stateIndex.get(`${startSuccess}:${startRemaining}`);
  assert.notEqual(start, undefined);
  const [scrolls, cleans, innocents, cost] = solution[start];
  return {
    scrolls,
    cleans,
    innocents,
    cost,
    costByState: new Map(
      states.map(({ success, remaining }, index) => [
        `${success}:${remaining}`,
        solution[index][3],
      ]),
    ),
  };
}

function assertSlotPolicyIsBellmanOptimal(result, evaluated, options) {
  const target = options.target ?? options.slots;
  const nextCost = (success, remaining) =>
    success >= target ? 0 : evaluated.costByState.get(`${success}:${remaining}`);

  for (const state of result.policy) {
    const alternatives = [];
    if (state.remaining > 0) {
      const failure = 1 - options.successRate;
      alternatives.push(
        options.scrollCost +
          options.successRate * nextCost(state.success + 1, state.remaining - 1) +
          failure * (1 - (options.slotProtectionRate ?? 0)) *
            nextCost(state.success, state.remaining - 1) +
          failure * (options.slotProtectionRate ?? 0) *
            nextCost(state.success, state.remaining),
      );
    }
    if (state.remaining < options.slots - state.success) {
      alternatives.push(
        options.cleanCost + nextCost(state.success, state.remaining + 1),
      );
    }
    if (
      Number.isFinite(options.innocentCost) &&
      (state.success > 0 || state.remaining < options.slots)
    ) {
      alternatives.push(options.innocentCost + nextCost(0, options.slots));
    }
    const value = evaluated.costByState.get(`${state.success}:${state.remaining}`);
    const best = Math.min(...alternatives);
    close(value, best, 2e-8, 1e-6);
  }
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pickInitialInnocentStock(options, random) {
  const distribution = options.innocentStockDistribution;
  if (!distribution) return options.innocentStock ?? 0;
  const picked = random();
  let cumulative = 0;
  for (const entry of distribution) {
    cumulative += entry.chance;
    if (picked < cumulative) return entry.stock;
  }
  return distribution.at(-1).stock;
}

function summarizeSamples(sums, squares, trials) {
  return Object.fromEntries(Object.keys(sums).map((key) => {
    const mean = sums[key] / trials;
    const variance = Math.max(0, squares[key] / trials - mean ** 2);
    return [key, { mean, standardError: Math.sqrt(variance / trials) }];
  }));
}

function simulateSlotPolicy(result, options, {
  trials = 50_000,
  seed = 0x51_07_c4,
} = {}) {
  const random = mulberry32(seed);
  const target = options.target ?? options.slots;
  const policy = new Map(
    result.policy.map((entry) => [`${entry.success}:${entry.remaining}`, entry.action]),
  );
  const names = [
    "scrolls",
    "cleans",
    "innocents",
    "ownedCleans",
    "paidCleans",
    "ownedInnocents",
    "paidInnocents",
    "cost",
  ];
  const sums = Object.fromEntries(names.map((name) => [name, 0]));
  const squares = Object.fromEntries(names.map((name) => [name, 0]));

  for (let trial = 0; trial < trials; trial += 1) {
    let success = options.startSuccess ?? 0;
    let remaining = options.startRemaining ?? options.slots;
    let cleanStock = options.cleanStock ?? 0;
    let innocentStock = pickInitialInnocentStock(options, random);
    const sample = Object.fromEntries(names.map((name) => [name, 0]));
    let steps = 0;

    while (success < target) {
      steps += 1;
      assert.ok(steps < 1_000_000, "표본 경로가 끝나야 합니다.");
      const action = policy.get(`${success}:${remaining}`);
      assert.ok(action, `${success}:${remaining} 상태의 행동이 필요합니다.`);

      if (action === ACTION.scroll) {
        sample.scrolls += 1;
        sample.cost += options.scrollCost;
        if (random() < options.successRate) {
          success += 1;
          remaining -= 1;
        } else if (random() >= (options.slotProtectionRate ?? 0)) {
          remaining -= 1;
        }
      } else if (action === ACTION.clean) {
        sample.cleans += 1;
        remaining += 1;
        if (cleanStock > 0) {
          cleanStock -= 1;
          sample.ownedCleans += 1;
        } else {
          sample.paidCleans += 1;
          sample.cost += options.cleanCost;
        }
      } else {
        assert.equal(action, ACTION.innocent);
        sample.innocents += 1;
        success = 0;
        remaining = options.slots;
        if (innocentStock > 0) {
          innocentStock -= 1;
          sample.ownedInnocents += 1;
        } else {
          sample.paidInnocents += 1;
          sample.cost += options.innocentCost;
        }
      }
    }

    for (const name of names) {
      sums[name] += sample[name];
      squares[name] += sample[name] ** 2;
    }
  }
  return { trials, ...summarizeSamples(sums, squares, trials) };
}

function closeToSimulation(actual, sample, {
  sigma = 7,
  relativeFloor = 0.004,
  absoluteFloor = 0.01,
} = {}) {
  const tolerance = Math.max(
    absoluteFloor,
    relativeFloor * Math.max(1, Math.abs(actual)),
    sigma * sample.standardError,
  );
  assert.ok(
    Math.abs(actual - sample.mean) <= tolerance,
    `${actual} != MC ${sample.mean} ± ${tolerance} (SE ${sample.standardError})`,
  );
}

function sampleChaosAttack(random) {
  const picked = random();
  let cumulative = 0;
  for (const outcome of AMAZING_POSITIVE_CHAOS) {
    cumulative += outcome.chance;
    if (picked < cumulative) return outcome.value;
  }
  return AMAZING_POSITIVE_CHAOS.at(-1).value;
}

function simulateStrictChaosReturn({
  slots,
  chaos100Stock = 0,
  chaos60Meso,
  returnMaplePoints,
  trials = 60_000,
  seed = 0xc4_a0_60,
}) {
  const random = mulberry32(seed);
  const names = [
    "purchasedChaos60",
    "ownedChaos100Used",
    "returnScrolls",
    "meso",
    "maplePoints",
  ];
  const sums = Object.fromEntries(names.map((name) => [name, 0]));
  const squares = Object.fromEntries(names.map((name) => [name, 0]));

  for (let trial = 0; trial < trials; trial += 1) {
    let stock = chaos100Stock;
    const sample = Object.fromEntries(names.map((name) => [name, 0]));
    for (let slot = 0; slot < slots; slot += 1) {
      for (;;) {
        sample.returnScrolls += 1;
        sample.maplePoints += returnMaplePoints;
        let scrollSucceeded;
        if (stock > 0) {
          stock -= 1;
          sample.ownedChaos100Used += 1;
          scrollSucceeded = true;
        } else {
          sample.purchasedChaos60 += 1;
          sample.meso += chaos60Meso;
          scrollSucceeded = random() < 0.6;
        }
        if (scrollSucceeded && sampleChaosAttack(random) >= 6) break;
      }
    }
    for (const name of names) {
      sums[name] += sample[name];
      squares[name] += sample[name] ** 2;
    }
  }
  return { trials, ...summarizeSamples(sums, squares, trials) };
}

function simulateFirstWorkWithArkStock({
  arkInnocentStock,
  chaos60Meso,
  arkInnocent100Meso,
  trials = 80_000,
  seed = 0xf1_25_7a,
}) {
  const random = mulberry32(seed);
  const names = [
    "purchasedChaos60",
    "ownedArkInnocent100Used",
    "purchasedArkInnocent100",
    "meso",
  ];
  const sums = Object.fromEntries(names.map((name) => [name, 0]));
  const squares = Object.fromEntries(names.map((name) => [name, 0]));
  for (let trial = 0; trial < trials; trial += 1) {
    let stock = arkInnocentStock;
    const sample = Object.fromEntries(names.map((name) => [name, 0]));
    for (;;) {
      sample.purchasedChaos60 += 1;
      sample.meso += chaos60Meso;
      if (random() < 0.6) break;
      if (stock > 0) {
        stock -= 1;
        sample.ownedArkInnocent100Used += 1;
      } else {
        sample.purchasedArkInnocent100 += 1;
        sample.meso += arkInnocent100Meso;
      }
    }
    for (const name of names) {
      sums[name] += sample[name];
      squares[name] += sample[name] ** 2;
    }
  }
  return { trials, ...summarizeSamples(sums, squares, trials) };
}

test("주흔작 1~12작·부분 진행 정책은 독립 Markov 해와 일치한다", () => {
  const cases = [
    {
      slots: 1,
      successRate: 0.5,
      scrollCost: 100,
      cleanCost: 1_000,
      slotProtectionRate: 0.04,
    },
    {
      slots: 8,
      successRate: 0.59,
      scrollCost: 1_350,
      cleanCost: 20_000,
      innocentCost: 24_000,
    },
    {
      slots: 8,
      successRate: 0.59,
      scrollCost: 1_350,
      cleanCost: 20_000,
      innocentCost: 24_000,
      startSuccess: 4,
      startRemaining: 3,
    },
    {
      slots: 12,
      successRate: 0.39,
      scrollCost: 4_000,
      cleanCost: 22_000,
      innocentCost: 38_000,
    },
  ];

  for (const options of cases) {
    const result = calculateSlotCraft(options);
    const independent = evaluateSlotPolicy(result, options);
    close(result.baseExpectedCost ?? result.expectedCost, independent.cost);
    close(result.expected.scrolls, independent.scrolls);
    close(result.expected.cleans, independent.cleans);
    close(result.expected.innocents, independent.innocents);
    assertSlotPolicyIsBellmanOptimal(result, independent, options);
  }
});

test("순백 재고 0·유한·충분 경로는 실제 사용 순서대로 차감된다", () => {
  const common = {
    slots: 1,
    successRate: 0.5,
    scrollCost: 100,
    cleanCost: 1_000,
    slotProtectionRate: 0.04,
  };
  const changedFailureRatio =
    ((1 - common.successRate) * (1 - common.slotProtectionRate)) /
    (1 - (1 - common.successRate) * common.slotProtectionRate);
  const totalCleans = changedFailureRatio / (1 - changedFailureRatio);

  for (const cleanStock of [0, 2, 40]) {
    const result = calculateSlotCraft({ ...common, cleanStock });
    const owned = cleanStock === 0
      ? 0
      : changedFailureRatio *
        (1 - changedFailureRatio ** cleanStock) /
        (1 - changedFailureRatio);
    const paid = totalCleans - owned;
    close(result.expected.scrolls, 2);
    close(result.expected.cleans, totalCleans);
    close(result.expected.ownedCleans, owned);
    close(result.expected.paidCleans, paid);
    close(result.expectedCost, 2 * common.scrollCost + paid * common.cleanCost);
  }
});

test("무료 순백이 남아 있을 때만 유료 이노 대신 쓰는 재고별 정책 전환을 반영한다", () => {
  const common = {
    slots: 1,
    successRate: 0.5,
    scrollCost: 100,
    cleanCost: 1_000,
    innocentCost: 100,
  };
  const noStock = calculateSlotCraft(common);
  const noStockDead = noStock.policy.find(
    ({ success, remaining }) => success === 0 && remaining === 0,
  );
  assert.equal(noStockDead.action, ACTION.innocent);
  close(noStock.expected.scrolls, 2);
  close(noStock.expected.innocents, 1);
  close(noStock.expectedCost, 300);

  const oneClean = calculateSlotCraft({ ...common, cleanStock: 1 });
  const stockedDead = oneClean.policy.find(
    ({ success, remaining }) => success === 0 && remaining === 0,
  );
  assert.equal(oneClean.inventory.policy, "stock-aware-exact");
  assert.equal(stockedDead.action, ACTION.clean);
  // 첫 실패(확률 1/2)는 무료 순백으로 복구하고, 그 뒤 실패부터는
  // 더 싼 유료 이노센트를 쓴다. 따라서 둘의 평균 사용량이 각각 1/2이다.
  close(oneClean.expected.scrolls, 2);
  close(oneClean.expected.cleans, 0.5);
  close(oneClean.expected.ownedCleans, 0.5);
  close(oneClean.expected.paidCleans, 0);
  close(oneClean.expected.innocents, 0.5);
  close(oneClean.expected.paidInnocents, 0.5);
  close(oneClean.expectedCost, 250);
});

test("충분한 단일 순백 재고도 정확 재고 상태로 계산한다", () => {
  const result = calculateSlotCraft({
    slots: 1,
    successRate: 0.5,
    scrollCost: 100,
    cleanCost: 1_000,
    innocentCost: 100,
    cleanStock: 40,
  });
  const dead = result.policy.find(
    ({ success, remaining }) => success === 0 && remaining === 0,
  );
  assert.equal(result.inventory.policy, "stock-aware-exact");
  assert.equal(dead.action, ACTION.clean);
  close(result.expected.scrolls, 2);
  close(result.expected.cleans, 1);
  close(result.expected.ownedCleans, 1 - 2 ** -40);
  close(result.expected.paidCleans, 2 ** -40, 1e-6, 1e-12);
  close(result.expected.innocents, 0);
  close(result.expectedCost, 200 + 1_000 * 2 ** -40, 1e-8, 1e-8);
});

test("귀지작의 이노 정책과 유한·분포 재고를 폐형식 및 Monte Carlo로 검증한다", () => {
  const common = {
    slots: 2,
    successRate: 0.1,
    scrollCost: 80_000_000,
    cleanCost: 1_000_000_000,
    innocentCost: 16_000_000,
  };
  const noStock = calculateSlotCraft(common);
  close(noStock.baseExpectedCost ?? noStock.expectedCost, 10_384_000_000, 1e-10, 0.01);
  close(noStock.expected.scrolls, 110);
  close(noStock.expected.innocents, 99);
  close(noStock.expected.cleans, 0);

  const finite = calculateSlotCraft({ ...common, innocentStock: 2 });
  const cycleFailure = 1 - common.successRate ** common.slots;
  const ownedAtTwo = cycleFailure + cycleFailure ** 2;
  close(finite.expected.ownedInnocents, ownedAtTwo);
  close(finite.expected.paidInnocents, 99 - ownedAtTwo);
  close(
    finite.expectedCost,
    110 * common.scrollCost + (99 - ownedAtTwo) * common.innocentCost,
  );

  const distributedOptions = {
    ...common,
    innocentStockDistribution: [
      { stock: 0, chance: 0.25 },
      { stock: 2, chance: 0.75 },
    ],
  };
  const distributed = calculateSlotCraft(distributedOptions);
  close(distributed.expected.ownedInnocents, ownedAtTwo * 0.75);
  close(distributed.expected.paidInnocents, 99 - ownedAtTwo * 0.75);

  const simulation = simulateSlotPolicy(distributed, distributedOptions, {
    trials: 60_000,
    seed: 0xe4_22_10,
  });
  closeToSimulation(distributed.expected.scrolls, simulation.scrolls);
  closeToSimulation(distributed.expected.innocents, simulation.innocents);
  closeToSimulation(distributed.expected.ownedInnocents, simulation.ownedInnocents);
  closeToSimulation(distributed.expected.paidInnocents, simulation.paidInnocents);
  closeToSimulation(distributed.expectedCost, simulation.cost, {
    relativeFloor: 0.003,
    absoluteFloor: 1,
  });
});

test("첫작놀긍 뒤 후속 귀지작은 첫작까지 지우는 이노센트를 선택하지 않는다", () => {
  const followUp = {
    slots: 2,
    successRate: 0.1,
    scrollCost: 80_000_000,
    cleanCost: 1_000_000_000,
  };
  // 첫작 놀긍은 별도 비용을 내고 이미 붙인 상태다. 여기서 이노센트를
  // 허용하면 그 첫작도 함께 사라지므로, 후속 작 엔진에는 사용 불가로 넘긴다.
  const safe = calculateSlotCraft({
    ...followUp,
    innocentCost: Number.POSITIVE_INFINITY,
  });
  close(safe.expected.scrolls, 20);
  close(safe.expected.cleans, 18);
  close(safe.expected.innocents, 0);
  close(safe.expectedCost, 19_600_000_000);
  assert.ok(safe.policy.every(({ action }) => action !== ACTION.innocent));

  // 첫작 비용을 다시 내는 상태 확장 없이 이노센트를 허용한 옛 경로는
  // 첫작이 공짜로 보존된 것처럼 보여 비용을 과소평가한다.
  const unsafe = calculateSlotCraft({
    ...followUp,
    innocentCost: 16_000_000,
  });
  assert.ok(unsafe.expected.innocents > 0);
  assert.ok(unsafe.expectedCost < safe.expectedCost);
});

function sampleMagical(workCount, trials, seed) {
  const random = mulberry32(seed);
  let totalAttempts = 0;
  let totalSquared = 0;
  let acceptedNonEleven = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    let attempts = 0;
    for (let work = 0; work < workCount; work += 1) {
      for (;;) {
        attempts += 1;
        const picked = random();
        let cumulative = 0;
        let value = MAGICAL_CHANCES.at(-1).value;
        for (const outcome of MAGICAL_CHANCES) {
          cumulative += outcome.chance;
          if (picked < cumulative) {
            value = outcome.value;
            break;
          }
        }
        if (value === 11) break;
      }
    }
    totalAttempts += attempts;
    totalSquared += attempts ** 2;
    // 종료 조건이 +11 하나뿐이므로 이 값은 언제나 0이어야 한다.
    acceptedNonEleven += 0;
  }
  const mean = totalAttempts / trials;
  const variance = Math.max(0, totalSquared / trials - mean ** 2);
  return {
    attempts: { mean, standardError: Math.sqrt(variance / trials) },
    acceptedNonEleven,
  };
}

function sampleMagicalCraft({
  workCount,
  resetRate,
  resetStock,
  scrollPrice,
  returnPrice,
  resetCost,
  trials = 50_000,
  seed = 0x11_c4_af,
}) {
  const random = mulberry32(seed);
  const names = [
    "magicalScrolls",
    "returnScrolls",
    "resets",
    "ownedResetsUsed",
    "purchasedResetSuccesses",
    "purchasedResetScrolls",
    "otherMeso",
    "returnMaplePoints",
  ];
  const sums = Object.fromEntries(names.map((name) => [name, 0]));
  const squares = Object.fromEntries(names.map((name) => [name, 0]));

  for (let trial = 0; trial < trials; trial += 1) {
    const sample = Object.fromEntries(names.map((name) => [name, 0]));
    let ownedResets = resetStock;

    for (let work = 0; work < workCount; work += 1) {
      for (;;) {
        sample.magicalScrolls += 1;
        sample.otherMeso += scrollPrice;
        if (work > 0) {
          sample.returnScrolls += 1;
          sample.returnMaplePoints += returnPrice;
        }

        const picked = random();
        let cumulative = 0;
        let value = MAGICAL_CHANCES.at(-1).value;
        for (const outcome of MAGICAL_CHANCES) {
          cumulative += outcome.chance;
          if (picked < cumulative) {
            value = outcome.value;
            break;
          }
        }
        if (value === 11) break;

        if (work === 0) {
          sample.resets += 1;
          if (ownedResets > 0) {
            ownedResets -= 1;
            sample.ownedResetsUsed += 1;
          } else {
            sample.purchasedResetSuccesses += 1;
            do {
              sample.purchasedResetScrolls += 1;
              sample.otherMeso += resetCost;
            } while (random() >= resetRate);
          }
        }
      }
    }

    for (const name of names) {
      sums[name] += sample[name];
      squares[name] += sample[name] ** 2;
    }
  }
  return { trials, ...summarizeSamples(sums, squares, trials) };
}

test("매지컬리턴은 1·6·12작 모두 각 작 +11만 채택한다", () => {
  const scrollPrice = 5_000;
  const returnPrice = 6_900;
  const result = calculateMagicalReturn({
    target: 11,
    scrollPrice,
    returnPrice,
  });
  close(result.chance, 0.1);
  close(result.attempts, 10);
  assert.throws(
    () => calculateMagicalReturn({ target: 10, scrollPrice, returnPrice }),
    /\+11로 고정/,
  );

  for (const workCount of [1, 6, 12]) {
    const sample = sampleMagical(workCount, 40_000, 0x11_00_00 + workCount);
    closeToSimulation(result.attempts * workCount, sample.attempts, {
      relativeFloor: 0.003,
    });
    assert.equal(sample.acceptedNonEleven, 0);
    close(result.scrollCost * workCount, 10 * workCount * scrollPrice);
    close(result.returnCost * workCount, 10 * workCount * returnPrice);
  }
});

test("매지컬 첫작 초기화와 나머지 리턴 기대값은 경로별 시뮬레이션과 일치한다", () => {
  const common = {
    scrollPrice: 5_000,
    returnPrice: 6_900,
    resetCost: 800,
    resetRate: 0.5,
    resetStock: 2,
  };

  for (const workCount of [1, 6, 12]) {
    const result = calculateMagicalReturnCraft({
      slots: workCount,
      ...common,
    });
    const sample = sampleMagicalCraft({
      workCount,
      ...common,
      seed: 0x11_c4_00 + workCount,
    });

    for (const name of [
      "magicalScrolls",
      "returnScrolls",
      "resets",
      "ownedResetsUsed",
      "purchasedResetSuccesses",
      "purchasedResetScrolls",
    ]) {
      closeToSimulation(result.expected[name], sample[name]);
    }
    closeToSimulation(result.costs.otherMeso, sample.otherMeso);
    closeToSimulation(
      result.costs.returnMaplePoints,
      sample.returnMaplePoints,
    );
  }
});

test("놀긍리턴의 무리턴 경로는 실패까지 한 칸으로 확정하고 현금 지출이 없다", () => {
  const chaos60Meso = 30_000;
  const result = calculateChaosReturnEconomy({
    slots: 12,
    averageAttackTarget: 0,
    averageStatTarget: 0,
    statCount: 0,
    prices: { chaos60Meso, returnMaplePoints: 6_900 },
    inventory: { chaos100Stock: 4 },
  });

  close(result.expected.chaosScrolls, 12);
  close(result.expected.ownedChaos100Used, 4);
  close(result.expected.purchasedChaos60, 8);
  close(result.expected.unprotectedChaosScrolls, 12);
  close(result.expected.returnScrolls, 0);
  close(result.costs.meso, 8 * chaos60Meso);
  close(result.costs.maplePoints, 0);
  assert.equal(result.strategy.initialAction.usesReturn, false);
  assert.equal(
    result.strategy.initialAction.failureConsumesSlot,
    result.strategy.initialAction.source === "purchased-chaos-60",
  );
});

test("최대 공·마 목표의 보호 리턴 횟수·현금·메소를 독립 MC로 재현한다", () => {
  const slots = 3;
  const chaos60Meso = 30_000;
  const returnMaplePoints = 6_900;
  const result = calculateChaosReturnEconomy({
    slots,
    averageAttackTarget: 6,
    averageStatTarget: 0,
    statCount: 0,
    prices: { chaos60Meso, returnMaplePoints },
  });
  const attempts = slots / (0.6 * chaosAtLeast(6));
  close(result.expected.purchasedChaos60, attempts);
  close(result.expected.returnScrolls, attempts);
  close(result.expected.unprotectedChaosScrolls, 0);
  close(result.costs.meso, attempts * chaos60Meso);
  close(result.costs.maplePoints, attempts * returnMaplePoints);

  const simulation = simulateStrictChaosReturn({
    slots,
    chaos60Meso,
    returnMaplePoints,
  });
  closeToSimulation(result.expected.purchasedChaos60, simulation.purchasedChaos60, {
    relativeFloor: 0.003,
  });
  closeToSimulation(result.expected.returnScrolls, simulation.returnScrolls, {
    relativeFloor: 0.003,
  });
  closeToSimulation(result.costs.meso, simulation.meso, { absoluteFloor: 1 });
  closeToSimulation(result.costs.maplePoints, simulation.maplePoints, {
    absoluteFloor: 1,
  });
});

test("보유 놀긍 100% 한 장을 쓴 엄격 목표 경로도 실제 소모 순서와 일치한다", () => {
  const chaos60Meso = 30_000;
  const returnMaplePoints = 6_900;
  const result = calculateChaosReturnEconomy({
    slots: 1,
    averageAttackTarget: 6,
    averageStatTarget: 0,
    statCount: 0,
    prices: { chaos60Meso, returnMaplePoints },
    inventory: { chaos100Stock: 1 },
  });
  const simulation = simulateStrictChaosReturn({
    slots: 1,
    chaos100Stock: 1,
    chaos60Meso,
    returnMaplePoints,
    seed: 0x10_0c_01,
  });
  closeToSimulation(result.expected.ownedChaos100Used, simulation.ownedChaos100Used);
  closeToSimulation(result.expected.purchasedChaos60, simulation.purchasedChaos60, {
    relativeFloor: 0.003,
  });
  closeToSimulation(result.expected.returnScrolls, simulation.returnScrolls, {
    relativeFloor: 0.003,
  });
  closeToSimulation(result.costs.meso, simulation.meso, { absoluteFloor: 1 });
  closeToSimulation(result.costs.maplePoints, simulation.maplePoints, {
    absoluteFloor: 1,
  });
});

test("2작 완료 장비의 남은 엄격 목표도 앞으로의 경로만 MC와 일치한다", () => {
  const chaos60Meso = 30_000;
  const returnMaplePoints = 6_900;
  const result = calculateChaosReturnEconomy({
    slots: 4,
    averageAttackTarget: 6,
    averageStatTarget: 0,
    statCount: 0,
    progress: { completedSlots: 2, attack: 12, stat: 0 },
    prices: { chaos60Meso, returnMaplePoints },
    inventory: { chaos100Stock: 1 },
  });
  const simulation = simulateStrictChaosReturn({
    slots: 2,
    chaos100Stock: 1,
    chaos60Meso,
    returnMaplePoints,
    seed: 0x20_0c_02,
  });

  assert.deepEqual(result.progress, {
    completedSlots: 2,
    remainingSlots: 2,
    current: { attack: 12, stat: 0 },
    needed: { attack: 12, stat: 0 },
  });
  closeToSimulation(result.expected.ownedChaos100Used, simulation.ownedChaos100Used);
  closeToSimulation(result.expected.purchasedChaos60, simulation.purchasedChaos60, {
    relativeFloor: 0.003,
  });
  closeToSimulation(result.expected.returnScrolls, simulation.returnScrolls, {
    relativeFloor: 0.003,
  });
  closeToSimulation(result.costs.meso, simulation.meso, { absoluteFloor: 1 });
  closeToSimulation(result.costs.maplePoints, simulation.maplePoints, {
    absoluteFloor: 1,
  });
});

test("첫작 실패의 보유 아크 이노센트 재고도 경로별 MC와 일치한다", () => {
  const chaos60Meso = 30_000;
  const arkInnocent100Meso = 1_000_000;
  const result = calculateChaosReturnEconomy({
    slots: 1,
    averageAttackTarget: 0,
    averageStatTarget: 0,
    statCount: 0,
    firstWork: { chaosRate: 60, attackTarget: 0, statTarget: 0 },
    prices: { chaos60Meso, arkInnocent100Meso, returnMaplePoints: 6_900 },
    inventory: { arkInnocentStock: 2 },
  });
  const simulation = simulateFirstWorkWithArkStock({
    arkInnocentStock: 2,
    chaos60Meso,
    arkInnocent100Meso,
  });
  closeToSimulation(result.expected.purchasedChaos60, simulation.purchasedChaos60);
  closeToSimulation(
    result.expected.ownedArkInnocent100Used,
    simulation.ownedArkInnocent100Used,
  );
  closeToSimulation(
    result.expected.purchasedArkInnocent100,
    simulation.purchasedArkInnocent100,
  );
  closeToSimulation(result.costs.meso, simulation.meso, { absoluteFloor: 1 });
  close(result.expected.returnScrolls, 0);
  close(result.costs.maplePoints, 0);
});

test("여유 목표의 혼합 정책은 주문서·리턴·비용 분해 불변식을 지킨다", () => {
  const prices = {
    chaos60Meso: 30_000,
    chaos100Meso: 45_000_000,
    returnMaplePoints: 6_900,
  };
  const result = calculateChaosReturnEconomy({
    slots: 12,
    averageAttackTarget: 1,
    averageStatTarget: 0,
    statCount: 0,
    prices,
    inventory: { chaos100Stock: 2 },
  });
  assert.ok(result.expected.unprotectedChaosScrolls > 0);
  assert.ok(result.expected.returnScrolls > 0);
  close(
    result.expected.chaosScrolls,
    result.expected.unprotectedChaosScrolls + result.expected.returnScrolls,
  );
  close(
    result.expected.purchasedChaos60,
    result.expected.first.purchasedChaos60 +
      result.expected.remainder.purchasedChaos60,
  );
  close(
    result.costs.breakdown.chaos60Meso,
    result.expected.purchasedChaos60 * prices.chaos60Meso,
  );
  close(
    result.costs.breakdown.returnMaplePoints,
    result.expected.returnScrolls * prices.returnMaplePoints,
  );
  close(
    result.costs.meso,
    result.costs.breakdown.chaos60Meso +
      result.costs.breakdown.chaos100Meso +
      result.costs.breakdown.arkInnocent100Meso,
  );
});

test("12작 계산의 독립 정책 재평가는 테스트 환경에서도 빠르게 끝난다", () => {
  const started = performance.now();
  const options = {
    slots: 12,
    successRate: 0.39,
    scrollCost: 4_000,
    cleanCost: 22_000,
    innocentCost: 38_000,
  };
  const result = calculateSlotCraft(options);
  evaluateSlotPolicy(result, options);
  const elapsed = performance.now() - started;
  // 느린 공유 CI에서도 회귀만 잡는 넉넉한 상한이다.
  assert.ok(elapsed < 5_000, `12작 정책 계산이 ${elapsed.toFixed(1)}ms 걸렸습니다.`);
});
