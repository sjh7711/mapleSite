import test from "node:test";
import assert from "node:assert/strict";
import { calculatePrimePotentialExpected, encodeExactPotentialTargetType, getPotentialResetCost } from "../src/potential.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`);
const str = { targetType: "str-percent", target: 9 };
const dex = { targetType: "dex-percent", target: 9 };
const tables = [
  [{ name: "STR +12%", probability: 1 }],
  [{ name: "STR +9%", probability: 0.8 }, { name: "DEX +9%", probability: 0.2 }],
  [{ name: "STR +9%", probability: 0.25 }, { name: "DEX +9%", probability: 0.75 }],
];
for (const system of ["regular", "additional"]) {
  const options = { tables, system, grade: "legendary", itemLevel: 200, mainStat: "STR" };
  test(`${system}: Prime uses the approved standard-cube cost assumption for each reset`, () => {
    assert.equal(getPotentialResetCost(200, "legendary", system, "prime"), 800_000);
    assert.equal(getPotentialResetCost(250, "legendary", system, "prime"), 1_250_000);
    const args = { ...options, targets: [{ ...str, target: 18 }] };
    const level200 = calculatePrimePotentialExpected(args);
    const level250 = calculatePrimePotentialExpected({ ...args, itemLevel: 250 });
    assert.equal(level200.resetCost, 800_000);
    assert.equal(level250.resetCost, 1_250_000);
    close(level200.expectedCost / 1_000_000, 2.075);
    close(level250.expectedCost / 1_000_000, 3.2421875);
    close(level200.expectedResets, level250.expectedResets);
    assert.deepEqual(level250.expectedCostRange, [level250.expectedCost, level250.expectedCost]);
    assert.throws(() => getPotentialResetCost(250, "unique", system, "prime"), /선택한 등급/);
  });
  test(`${system}: a single total target sums both rerolled lines and excludes the fixed first line`, () => {
    const result = calculatePrimePotentialExpected({ ...options, targets: [{ ...str, target: 18 }] });
    close(result.rawProbability, 0.2);
    // Failure states have weights .6, .05, .15; the identical current result is excluded.
    close(result.expectedResets, (1 - (0.6 ** 2 + 0.05 ** 2 + 0.15 ** 2) / 0.8) / 0.2);
    assert.equal(result.dependsOnFirstLine, false);
    assert.equal(calculatePrimePotentialExpected({ ...options, targets: [{ ...str, target: 30 }] }).expectedResets, Infinity);
  });
  test(`${system}: aggregate conditions allow either line order and OR sets do not double count`, () => {
    close(calculatePrimePotentialExpected({ ...options, targets: [str, dex] }).rawProbability, 0.65);
    close(calculatePrimePotentialExpected({ ...options, targetSets: [[str], [str, dex]] }).rawProbability, 0.85);
    close(calculatePrimePotentialExpected({ ...options, targetSets: [[str], [dex]] }).rawProbability, 1);
  });
  test(`${system}: combined ignore defense uses stacking and does not include the fixed line`, () => {
    const args = { ...options, tables: [
      [{ name: "몬스터 방어율 무시 +40%", probability: 1 }],
      [{ name: "몬스터 방어율 무시 +30%", probability: 1 }],
      [{ name: "몬스터 방어율 무시 +40%", probability: 1 }],
    ], targetType: "ignore-defense" };
    close(calculatePrimePotentialExpected({ ...args, target: 58 }).rawProbability, 1);
    close(calculatePrimePotentialExpected({ ...args, target: 59 }).rawProbability, 0);
  });
  test(`${system}: aggregate targets retain the unknown first-line duplicate limits`, () => {
    const name = "쓸만한 샤프 아이즈 스킬 사용 가능";
    const table = [{ name, probability: 0.5 }, { name: "STR +9%", probability: 0.5 }];
    const result = calculatePrimePotentialExpected({ ...options, tables: [table, table, table],
      targets: [{ targetType: encodeExactPotentialTargetType(name), target: 1 }],
    });
    assert.equal(result.dependsOnFirstLine, true);
    assert.deepEqual(result.rawProbabilityRange, [0, 0.75]);
    assert.equal(result.expectedCost, null);
    assert.deepEqual(result.expectedCostRange, [800_000, Infinity]);
    const free = calculatePrimePotentialExpected({ ...options, itemLevel: 30, tables: [table, table, table],
      targets: [{ targetType: encodeExactPotentialTargetType(name), target: 1 }],
    });
    assert.deepEqual(free.expectedCostRange, [0, Infinity]);
  });
  test(`${system}: Prime targets belong to the second and third lines`, () => {
    const result = calculatePrimePotentialExpected({ ...options, lineTargets: [str, dex] });
    close(result.rawProbability, 0.6);
    assert.equal(result.dependsOnFirstLine, false);
    close(calculatePrimePotentialExpected({ ...options, lineTargets: [dex, str] }).rawProbability, 0.05);
    close(calculatePrimePotentialExpected({ ...options, lineTargets: [null, str] }).rawProbability, 0.25);
    close(calculatePrimePotentialExpected({ ...options, lineTargets: [str, null] }).rawProbability, 0.8);
    assert.equal(calculatePrimePotentialExpected({ ...options, lineTargets: [{ ...str, target: 12 }, null] }).rawProbability, 0);
    assert.throws(() => calculatePrimePotentialExpected({ ...options, lineTargets: [null, null] }), /목표/);
  });
  test(`${system}: Unknown first-line restrictions produce bounds, not an assumed first-line distribution`, () => {
    const name = "쓸만한 샤프 아이즈 스킬 사용 가능";
    const table = [{ name, probability: 0.5 }, { name: "STR +9%", probability: 0.5 }];
    const args = { ...options, tables: [table, table, table], lineTargets: [{ targetType: encodeExactPotentialTargetType(name), target: 1 }, null] };
    const result = calculatePrimePotentialExpected(args);
    assert.equal(result.dependsOnFirstLine, true);
    assert.equal(result.probability, null);
    assert.equal(result.expectedResets, null);
    assert.deepEqual(result.rawProbabilityRange, [0, 0.5]);
    assert.equal(result.expectedResetsRange[1], Infinity);
    const differentWeights = calculatePrimePotentialExpected({ ...args, tables: [[{ ...table[0], probability: 0.99 }, { ...table[1], probability: 0.01 }], table, table] });
    assert.deepEqual(differentWeights.expectedResetsRange, result.expectedResetsRange);
  });
  test(`${system}: Shared option sets use OR without counting overlapping successes twice`, () => {
    const result = calculatePrimePotentialExpected({ ...options, lineTargetSets: [[str, dex], [dex, str]] });
    close(result.rawProbability, 0.65);
    const repeated = calculatePrimePotentialExpected({ ...options, lineTargetSets: [[str, dex], [str, dex]] });
    close(repeated.rawProbability, 0.6);
    const overlapping = calculatePrimePotentialExpected({ ...options, lineTargetSets: [[str, null], [null, str]] });
    close(overlapping.rawProbability, 0.85);
    assert.throws(() => calculatePrimePotentialExpected({ ...options, lineTargetSets: [[null, null]] }), /목표/);
  });
}
