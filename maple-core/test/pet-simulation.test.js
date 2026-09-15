import assert from "node:assert/strict";
import test from "node:test";

import { calculatePetExpectation } from "../src/pet.js";

// 계산 코드와 독립적으로 공식 확률을 고정한다. 상수나 닫힌식을 공유하면
// 같은 구현 실수를 시뮬레이션이 그대로 답습할 수 있기 때문이다.
const SWEET_PETITE = 0.1164;
const SWEET_RESULT = 0.864;
const DREAM_PETITE = 0.204;
const WONDER_BLACK_NORMAL = 0.0996;
const WONDER_BLACK_EVENT = 0.11952;
const WONDER_UPPER_NORMAL = 0.6;
const WONDER_UPPER_EVENT = 0.58008;
const SWEET_KEY = 0.0196;
const DREAM_RESULT = 0.756;

// 이벤트 OFF·ON 두 경우를 합쳐 50,000 trial이다.
const TRIALS_PER_CASE = 25_000;

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

function createAccumulator() {
  return { sum: 0, squareSum: 0 };
}

function addSample(accumulator, value) {
  accumulator.sum += value;
  accumulator.squareSum += value * value;
}

function summarize(accumulator, sampleCount) {
  const mean = accumulator.sum / sampleCount;
  const variance = Math.max(
    0,
    (accumulator.squareSum -
      (accumulator.sum * accumulator.sum) / sampleCount) /
      (sampleCount - 1),
  );
  return {
    mean,
    standardError: Math.sqrt(variance / sampleCount),
  };
}

function simulate({ wonderBlackEvent, seed, targetCount = 1 }) {
  const random = mulberry32(seed);
  const blackProbability = wonderBlackEvent
    ? WONDER_BLACK_EVENT
    : WONDER_BLACK_NORMAL;
  const upperPetProbability = wonderBlackEvent
    ? WONDER_UPPER_EVENT
    : WONDER_UPPER_NORMAL;
  const accumulators = {
    wonderBlacks: createAccumulator(),
    lunaCrystals: createAccumulator(),
    wonderBerries: createAccumulator(),
    wonderPetPaybacks: createAccumulator(),
    lunaDreams: createAccumulator(),
    lunaKeys: createAccumulator(),
  };

  for (let trial = 0; trial < TRIALS_PER_CASE; trial += 1) {
    let petites = 0;
    let wonderBlacks = 0;
    let lunaCrystals = 0;
    let lunaDreams = 0;
    let lunaKeys = 0;

    while (petites < targetCount) {
      // 원더 블랙 + 원더 블랙
      wonderBlacks += 2;
      lunaCrystals += 1;
      const sweetRoll = random();

      if (sweetRoll < SWEET_PETITE) {
        petites += 1;
      } else if (sweetRoll < SWEET_PETITE + SWEET_RESULT) {
        // 루나 스윗 결과만 원더 블랙 한 마리와 재합성한다.
        wonderBlacks += 1;
        lunaCrystals += 1;
        const dreamRoll = random();
        if (dreamRoll < DREAM_PETITE) {
          petites += 1;
        } else if (dreamRoll < DREAM_PETITE + DREAM_RESULT) {
          lunaDreams += 1;
        } else {
          lunaKeys += 1;
        }
      } else if (sweetRoll < SWEET_PETITE + SWEET_RESULT + SWEET_KEY) {
        lunaKeys += 1;
      }
    }

    // 위 합성에서 실제로 소비한 블랙 수만큼 원더베리를 독립적으로 뽑는다.
    let acquiredBlacks = 0;
    let wonderBerries = 0;
    let wonderPetPaybacks = 0;
    while (acquiredBlacks < wonderBlacks) {
      wonderBerries += 1;
      const berryRoll = random();
      if (berryRoll < blackProbability) {
        acquiredBlacks += 1;
      } else if (berryRoll < blackProbability + upperPetProbability) {
        wonderPetPaybacks += 1;
      }
    }

    addSample(accumulators.wonderBlacks, wonderBlacks);
    addSample(accumulators.lunaCrystals, lunaCrystals);
    addSample(accumulators.wonderBerries, wonderBerries);
    addSample(accumulators.wonderPetPaybacks, wonderPetPaybacks);
    addSample(accumulators.lunaDreams, lunaDreams);
    addSample(accumulators.lunaKeys, lunaKeys);
  }

  return Object.fromEntries(
    Object.entries(accumulators).map(([key, accumulator]) => [
      key,
      summarize(accumulator, TRIALS_PER_CASE),
    ]),
  );
}

function simulateBundlePolicy({ wonderBlackEvent, seed, targetCount }) {
  const random = mulberry32(seed);
  const blackProbability = wonderBlackEvent
    ? WONDER_BLACK_EVENT
    : WONDER_BLACK_NORMAL;
  const upperPetProbability = wonderBlackEvent
    ? WONDER_UPPER_EVENT
    : WONDER_UPPER_NORMAL;
  const accumulators = {
    purchasedBundles: createAccumulator(),
    openedWonderBerries: createAccumulator(),
    wonderBlacksPulled: createAccumulator(),
    wonderBlacksConsumed: createAccumulator(),
    remainingWonderBlacks: createAccumulator(),
    wonderPetPaybacks: createAccumulator(),
    wonderConsumables: createAccumulator(),
    sweetSynthesisAttempts: createAccumulator(),
    dreamSynthesisAttempts: createAccumulator(),
    lunaDreams: createAccumulator(),
    lunaKeys: createAccumulator(),
  };

  for (let trial = 0; trial < TRIALS_PER_CASE; trial += 1) {
    let petites = 0;
    let wonderBlacks = 0;
    let wonderBlacksPulled = 0;
    let wonderBlacksConsumed = 0;
    let pendingSweet = false;
    let purchasedBundles = 0;
    let wonderPetPaybacks = 0;
    let wonderConsumables = 0;
    let sweetSynthesisAttempts = 0;
    let dreamSynthesisAttempts = 0;
    let lunaDreams = 0;
    let lunaKeys = 0;

    while (petites < targetCount) {
      const requiredBlacks = pendingSweet ? 1 : 2;
      if (wonderBlacks < requiredBlacks) {
        purchasedBundles += 1;
        // 실제 정책처럼 11개 묶음을 산 즉시 전부 개봉한다.
        for (let berry = 0; berry < 11; berry += 1) {
          const roll = random();
          if (roll < blackProbability) {
            wonderBlacks += 1;
            wonderBlacksPulled += 1;
          } else if (roll < blackProbability + upperPetProbability) {
            wonderPetPaybacks += 1;
          } else {
            wonderConsumables += 1;
          }
        }
        continue;
      }

      if (pendingSweet) {
        wonderBlacks -= 1;
        wonderBlacksConsumed += 1;
        dreamSynthesisAttempts += 1;
        pendingSweet = false;
        const roll = random();
        if (roll < DREAM_PETITE) {
          petites += 1;
        } else if (roll < DREAM_PETITE + DREAM_RESULT) {
          lunaDreams += 1;
        } else {
          lunaKeys += 1;
        }
        continue;
      }

      wonderBlacks -= 2;
      wonderBlacksConsumed += 2;
      sweetSynthesisAttempts += 1;
      const roll = random();
      if (roll < SWEET_PETITE) {
        petites += 1;
      } else if (roll < SWEET_PETITE + SWEET_RESULT) {
        pendingSweet = true;
      } else {
        lunaKeys += 1;
      }
    }

    const samples = {
      purchasedBundles,
      openedWonderBerries: purchasedBundles * 11,
      wonderBlacksPulled,
      wonderBlacksConsumed,
      remainingWonderBlacks: wonderBlacks,
      wonderPetPaybacks,
      wonderConsumables,
      sweetSynthesisAttempts,
      dreamSynthesisAttempts,
      lunaDreams,
      lunaKeys,
    };
    for (const [key, value] of Object.entries(samples)) {
      addSample(accumulators[key], value);
    }
  }

  return Object.fromEntries(
    Object.entries(accumulators).map(([key, accumulator]) => [
      key,
      summarize(accumulator, TRIALS_PER_CASE),
    ]),
  );
}

function assertWithinSamplingError(actual, expected, label) {
  // 고정 시드에서도 지나치게 빡빡한 우연 실패가 없도록 표본 표준오차의
  // 6배를 사용하고, 반올림 오차를 위한 0.05% 하한만 둔다.
  const tolerance = Math.max(actual.standardError * 6, Math.abs(expected) * 0.0005);
  const difference = Math.abs(actual.mean - expected);
  assert.ok(
    difference <= tolerance,
    `${label}: 시뮬레이션 ${actual.mean}, 계산 ${expected}, ` +
      `차이 ${difference}, 허용 ${tolerance}`,
  );
}

for (const scenario of [
  { wonderBlackEvent: false, seed: 0x1a2b3c4d },
  { wonderBlackEvent: true, seed: 0x2b3c4d5e },
]) {
  const eventLabel = scenario.wonderBlackEvent ? "이벤트 ON" : "이벤트 OFF";

  test(`자석펫 1마리 · ${eventLabel} 몬테카를로 검증`, () => {
    const expected = calculatePetExpectation({
      wonderBlackEvent: scenario.wonderBlackEvent,
      sourceMode: "wonderberry",
    });
    const simulated = simulate(scenario);

    for (const key of [
      "wonderBlacks",
      "lunaCrystals",
      "wonderBerries",
      "wonderPetPaybacks",
      "lunaDreams",
      "lunaKeys",
    ]) {
      assertWithinSamplingError(
        simulated[key],
        expected.expected[key],
        `1마리 ${eventLabel} ${key}`,
      );
    }
  });
}

test("자석펫 3마리 목표 몬테카를로 검증", () => {
  const scenario = {
    wonderBlackEvent: false,
    seed: 0x3c4d5e6f,
    targetCount: 3,
  };
  const expected = calculatePetExpectation({
    wonderBlackEvent: false,
    sourceMode: "wonderberry",
    targetCount: 3,
  });
  const simulated = simulate(scenario);

  for (const key of [
    "wonderBlacks",
    "lunaCrystals",
    "wonderBerries",
    "wonderPetPaybacks",
    "lunaDreams",
    "lunaKeys",
  ]) {
    assertWithinSamplingError(
      simulated[key],
      expected.expected[key],
      `3마리 ${key}`,
    );
  }
});

for (const scenario of [
  { wonderBlackEvent: false, seed: 0x4d5e6f70, targetCount: 3 },
  { wonderBlackEvent: true, seed: 0x5e6f7081, targetCount: 3 },
]) {
  const eventLabel = scenario.wonderBlackEvent ? "이벤트 ON" : "이벤트 OFF";
  test(`자석펫 3마리 · ${eventLabel} 11개 묶음 정책 몬테카를로 검증`, () => {
    const expected = calculatePetExpectation({
      wonderBlackEvent: scenario.wonderBlackEvent,
      sourceMode: "wonderberry",
      targetCount: scenario.targetCount,
    }).bundlePurchase.expected;
    const simulated = simulateBundlePolicy(scenario);

    for (const key of Object.keys(simulated)) {
      assertWithinSamplingError(
        simulated[key],
        expected[key],
        `3마리 묶음 ${eventLabel} ${key}`,
      );
    }
  });
}
