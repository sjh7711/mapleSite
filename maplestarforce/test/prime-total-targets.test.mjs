import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { calculatePrimePotentialExpected } from "maple-core/potential";
import { migratePrimePotentialTargetSets } from "../src/shared/potential-target-ui.js";

const empty = { type: "", value: "" };
test("기존 프라임 줄별 목표는 같은 옵션의 합계를 보존하고 원본을 변경하지 않는다", () => {
  const saved = [{ targets: [empty,
    { type: "attack-power-percent", value: "9" },
    { type: "attack-power-percent", value: "9" },
  ] }, { targets: [empty,
    { type: "ignore-defense", value: 40 },
    { type: "ignore-defense", value: 40 },
  ] }, { targets: [empty,
    { type: "boss-damage", value: 40 },
    { type: "attack-power-percent", value: 12 },
  ] }];
  const before = structuredClone(saved);
  const migrated = migratePrimePotentialTargetSets(saved);
  assert.deepEqual(migrated[0].targets, [empty, { type: "attack-power-percent", value: 18 }, empty]);
  assert.deepEqual(migrated[1].targets, [empty, { type: "ignore-defense", value: 64 }, empty]);
  assert.deepEqual(migrated[2], saved[2]);
  assert.deepEqual(saved, before);
  assert.deepEqual(migratePrimePotentialTargetSets(migrated), migrated);
});

for (const system of ["regular", "additional"]) {
  test(`${system}: 200제 레전 무기의 공격력 합계 21%는 9+12와 12+9, 12+12를 모두 포함한다`, async () => {
    const base = new URL("../public/potential-tables/", import.meta.url);
    const index = JSON.parse(await readFile(new URL("index.json", base), "utf8"));
    const packed = JSON.parse(await readFile(new URL(`${system}-legendary-1-120.json`, base), "utf8"));
    const tables = packed.map((line) => line.map(([i, probability]) => ({ name: index.names[i], probability })));
    const probability = (line, value) => {
      const table = tables[line];
      return table.find(({ name }) => name === `공격력 +${value}%`).probability /
        table.reduce((sum, option) => sum + option.probability, 0);
    };
    const args = { tables, system, grade: "legendary", itemLevel: 200, mainStat: "STR" };
    const sum = calculatePrimePotentialExpected({ ...args, targetSets: [[{ targetType: "attack-power-percent", target: 21 }]] });
    const expected = probability(1, 9) * probability(2, 12) + probability(1, 12) * probability(2, 9) + probability(1, 12) * probability(2, 12);
    assert.ok(Math.abs(sum.rawProbability - expected) < 1e-12);
    assert.ok(Number.isFinite(sum.expectedResets));
    const impossible = calculatePrimePotentialExpected({ ...args, target: 30, targetType: "attack-power-percent" });
    assert.equal(impossible.probability, 0);
    assert.equal(impossible.expectedResets, Infinity);
  });
}
