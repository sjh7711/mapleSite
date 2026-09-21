import test from "node:test";
import assert from "node:assert/strict";
import { calculatePetExpectation, calculateWonderBerryTargetProcurement, probabilityOfTargetWithinWonderBerries } from "../src/pet.js";
import { calculateAbilityExpected, getAbilityTargetValues } from "../src/ability.js";
import { calculatePotentialExpected, getPotentialRankUpInfo, encodeExactPotentialTargetType } from "../src/potential.js";
import { calculateChaosReturnEconomy } from "../src/scroll-economy.js";
import { calculateMagicalReturnCraftProgress } from "../src/scroll.js";
import { getSoulPotentialTables, calculateSoulPotentialExpected, calculateSoulAmplificationPath } from "../src/soul.js";
const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)), `${actual} != ${expected}`);

test("원더블랙 증가율 0·20·50%를 기대값과 목표 도달 확률에 모두 반영하며 캐시를 분리한다", () => {
  const settings = { sourceMode: "wonderberry", wonderBlackEvent: true, targetCount: 1 };
  const base = calculatePetExpectation({ ...settings, wonderBlackEventIncreasePercent: 0 });
  const event = calculatePetExpectation({ ...settings, wonderBlackEventIncreasePercent: 20 });
  const custom = calculatePetExpectation({ ...settings, wonderBlackEventIncreasePercent: 50 });
  close(base.probabilities.wonderBlack, 0.0996);
  close(event.probabilities.wonderBlack, 0.11952);
  close(custom.probabilities.wonderBlack, 0.1494);
  close(custom.probabilities.wonderBlack + custom.probabilities.wonderUpperPet + custom.probabilities.wonderConsumable, 1);
  assert.ok(custom.expected.wonderBerries < event.expected.wonderBerries);
  assert.ok(event.expected.wonderBerries < base.expected.wonderBerries);
  const goal = calculateWonderBerryTargetProcurement({ ...settings, wonderBlackEventIncreasePercent: 50, targetChance: 0.8 });
  const repeat = calculatePetExpectation({ ...settings, wonderBlackEventIncreasePercent: 20 });
  close(repeat.expected.wonderBerries, event.expected.wonderBerries);
  assert.ok(goal);
  assert.ok(probabilityOfTargetWithinWonderBerries(200, 1, 0.1494) > probabilityOfTargetWithinWonderBerries(200, 1, true));
  close(calculatePetExpectation({ ...settings, wonderBlackEvent: false, wonderBlackEventIncreasePercent: 50 }).probabilities.wonderBlack, 0.0996);
  assert.throws(() => calculatePetExpectation({ ...settings, wonderBlackEventIncreasePercent: -1 }), /0 이상/);
  assert.throws(() => calculatePetExpectation({ ...settings, wonderBlackEventIncreasePercent: 1000 }), /허용 범위/);
});

test("리턴의 메소 가격은 지출과 최적화 비용 모두에 들어간다", () => {
  const result = calculateChaosReturnEconomy({ slots: 1, averageAttackTarget: 6, prices: { chaos60Meso: 500_000, returnMeso: 400_000_000 } });
  const attempts = 1 / (0.6 * 0.059324);
  close(result.expected.returnScrolls, attempts);
  close(result.costs.meso, attempts * 400_500_000);
  close(result.costs.breakdown.returnMeso, attempts * 400_000_000);
  assert.equal(result.costs.maplePoints, 0);
  assert.equal(result.objective.primary, "meso");
  const owned = calculateChaosReturnEconomy({ slots: 1, averageAttackTarget: 6, prices: { chaos60Meso: 500_000, returnMeso: 400_000_000 }, inventory: { chaos100Stock: 1 } });
  close(owned.costs.meso, owned.expected.returnScrolls * 400_000_000 + owned.expected.purchasedChaos60 * 500_000);
});

test("매지컬 완작 진행은 메포 환산 없이 남은 리턴 비용을 합산한다", () => {
  const result = calculateMagicalReturnCraftProgress({ completedSlots: 9, scrollPrice: 60_000_000, returnPrice: 400_000_000, returnCurrency: "meso" });
  assert.equal(result.expected.returnScrolls, 10);
  assert.equal(result.costs.returnMeso, 4_000_000_000);
  assert.equal(result.costs.returnMaplePoints, 0);
  assert.equal(result.costs.otherMeso, 600_000_000);
});

test("고급 재설정은 아랫줄 레전드리 2%와 잠금별 명성치·메소를 적용한다", () => {
  const targets = [
    { type: "boss-damage", grade: "legendary", minimum: 20, locked: true },
    { type: "buff-duration", grade: "legendary", minimum: 50, locked: true },
    { type: "critical", grade: "legendary", minimum: 30 },
  ];
  const result = calculateAbilityExpected({ method: "advanced", targets });
  // 공식 표의 레전드리 가중치 합 99.9993% (표기 반올림), 잠근 보공·벞지 제외.
  close(result.rawProbability, 0.02 * 0.4625 / (99.9993 - 2.3127 - 0.9251) * 0.1, 1e-12);
  assert.equal(result.resourcePerReset, 40_000);
  assert.equal(result.mesoPerReset, 15_000_000);
  close(result.expectedMeso, result.expectedResets * 15_000_000);
  assert.ok(result.expectedResets < 1 / result.rawProbability);
  for (const [locks, honor, meso] of [[0, 20000, 2000000], [1, 30000, 6000000]]) {
    const r = calculateAbilityExpected({ method: "advanced", targets: targets.map((t, i) => ({ ...t, locked: i < locks })) });
    assert.ok(r.rawProbability > 0); assert.equal(r.resourcePerReset, honor); assert.equal(r.mesoPerReset, meso);
  }
  assert.deepEqual(getAbilityTargetValues("boss-damage", 2, "advanced", "legendary"), [15, 16, 17, 18, 19, 20]);
  assert.equal(calculateAbilityExpected({ method: "honor", targets: targets.map((t) => ({ ...t, locked: false })) }).probability, 0);
});

for (const system of ["regular", "additional"]) {
  test(`${system} 프라임은 첫 줄 확률을 곱하지 않고 고정 옵션을 합계에 포함한다`, () => {
    const tables = [
      [{ name: "STR +12%", probability: 0.1 }, { name: "DEX +12%", probability: 0.9 }],
      [{ name: "STR +9%", probability: 0.5 }, { name: "DEX +9%", probability: 0.5 }],
      [{ name: "STR +9%", probability: 0.5 }, { name: "DEX +9%", probability: 0.5 }],
    ];
    const options = { tables, system, resetMethod: "prime", grade: "legendary", itemLevel: 200, mainStat: "STR", target: 30, targetType: "str-percent", fixedFirstOption: "STR +12%" };
    const result = calculatePotentialExpected(options);
    close(result.rawProbability, 0.25); close(result.probability, 1 / 3);
    assert.equal(calculatePotentialExpected({ ...options, fixedFirstOption: "DEX +12%" }).probability, 0);
    assert.throws(() => calculatePotentialExpected({ ...options, fixedFirstOption: null }), /현재 첫 번째/);
    assert.throws(() => calculatePotentialExpected({ ...options, grade: "unique" }), /레전드리/);
    assert.equal(getPotentialRankUpInfo({ system, method: "prime", grade: "legendary" }).canRankUp, false);
    assert.throws(() => getPotentialRankUpInfo({ system, method: "prime", grade: "unique" }), /선택한 등급/);
    const decent = "쓸만한 샤프 아이즈 스킬 사용 가능";
    const capped = calculatePotentialExpected({ ...options, fixedFirstOption: decent,
      targetType: encodeExactPotentialTargetType(decent), target: 2,
      tables: Array.from({ length: 3 }, () => [{ name: decent, probability: 0.5 }, { name: "STR +9%", probability: 0.5 }]),
    });
    assert.equal(capped.rawProbability, 0);
  });
}

test("소울 공식 표 16개는 세 줄을 포함하며 증폭 단계별로 옵션 수치가 달라진다", () => {
  for (const grade of ["rare", "epic", "unique", "legendary"]) {
    for (const stage of [1, 2, 3, 4]) {
      const tables = getSoulPotentialTables({ grade, stage });
      assert.equal(tables.length, 3);
      for (const table of tables) close(table.reduce((sum, v) => sum + v.probability, 0), 1, 0.0001);
    }
  }
  const first = getSoulPotentialTables({ stage: 1 });
  const fourth = getSoulPotentialTables({ stage: 4 });
  assert.notDeepEqual(first[0].map((v) => v.name), fourth[0].map((v) => v.name));
  assert.ok(fourth[0].some((v) => v.name === "공격력 +8%"));
  const goal = { mainStat: "STR", target: 16, targetType: "attack-power-percent" };
  const result = calculateSoulPotentialExpected({ ...goal, stage: 4 });
  assert.equal(result.resetCost, 88_000_000);
  assert.ok(result.probability > calculateSoulPotentialExpected({ ...goal, stage: 1 }).probability);
  assert.equal(calculateSoulPotentialExpected({ ...goal, grade: "epic", stage: 4 }).resetCost, 40_000_000);
  const live = calculateSoulAmplificationPath({ currentStage: 0, targetStage: 1, currentFailures: 25, asOfDate: "2026-09-17", maintenanceCompleted: true });
  assert.equal(live.expected.attempts, 1); assert.equal(live.costs.totalMeso, 500_000_000);
});
