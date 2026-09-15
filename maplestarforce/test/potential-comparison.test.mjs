import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { calculatePotentialExpected } from "maple-core/potential";

async function weaponLegendaryTables() {
  const base = new URL("../public/potential-tables/", import.meta.url);
  const [index, packed] = await Promise.all([
    readFile(new URL("index.json", base), "utf8").then(JSON.parse),
    readFile(new URL("regular-legendary-1-120.json", base), "utf8").then(JSON.parse),
  ]);
  return packed.map((line) =>
    line.map(([nameIndex, probability]) => ({
      name: index.names[nameIndex],
      probability,
    })),
  );
}

async function level250HatLegendaryTables() {
  const base = new URL("../public/potential-tables/", import.meta.url);
  const [index, packed] = await Promise.all([
    readFile(new URL("index.json", base), "utf8").then(JSON.parse),
    readFile(new URL("regular-legendary-6-201.json", base), "utf8").then(JSON.parse),
  ]);
  return packed.map((line) =>
    line.map(([nameIndex, probability]) => ({
      name: index.names[nameIndex],
      probability,
    })),
  );
}

async function level250AdditionalHatLegendaryTables() {
  const base = new URL("../public/potential-tables/", import.meta.url);
  const [index, packed] = await Promise.all([
    readFile(new URL("index.json", base), "utf8").then(JSON.parse),
    readFile(new URL("additional-legendary-6-201.json", base), "utf8").then(JSON.parse),
  ]);
  return packed.map((line) =>
    line.map(([nameIndex, probability]) => ({
      name: index.names[nameIndex],
      probability,
    })),
  );
}

test("같은 무기에서 목표 A와 목표 B의 조건부 확률을 비교한다", async () => {
  const tables = await weaponLegendaryTables();
  const calculate = (targets) => calculatePotentialExpected({
    tables,
    targets,
    itemLevel: 200,
    grade: "legendary",
  });

  const targetA = calculate([
    { targetType: "attack-power-percent", target: 12 },
    { targetType: "boss-damage", target: 30 },
    { targetType: "ignore-defense", target: 30 },
  ]);
  const targetB = calculate([
    { targetType: "attack-power-percent", target: 30 },
  ]);

  assert.ok(Math.abs(targetA.rawProbability - 0.0007845197098508689) < 1e-15);
  assert.ok(Math.abs(targetB.rawProbability - 0.0002197962897557622) < 1e-15);
  assert.ok(Math.abs(targetA.probability - 0.0007848445643340315) < 1e-15);
  assert.ok(Math.abs(targetB.probability - 0.00021988726189934394) < 1e-15);
  assert.equal(targetA.resets50, 883);
  assert.equal(targetA.resets95, 3816);
  assert.equal(targetB.resets50, 3152);
  assert.equal(targetB.resets95, 13623);
});

test("공식 무기 확률표에서 여러 옵션 세트의 합집합 확률을 계산한다", async () => {
  const tables = await weaponLegendaryTables();
  const result = calculatePotentialExpected({
    tables,
    targetSets: [
      [
        { targetType: "attack-power-percent", target: 12 },
        { targetType: "boss-damage", target: 30 },
        { targetType: "ignore-defense", target: 30 },
      ],
      [
        { targetType: "attack-power-percent", target: 30 },
      ],
    ],
    itemLevel: 200,
    grade: "legendary",
  });

  assert.ok(Math.abs(result.rawProbability - 0.0010043159996066307) < 1e-15);
  assert.ok(Math.abs(result.probability - 0.0010047319252044487) < 1e-15);
  assert.ok(Math.abs(result.expectedResets - 995.2903604576059) < 1e-12);
  assert.ok(Math.abs(result.expectedCost - 44_788_066_220.59226) < 1e-5);
  assert.equal(result.resetCost, 45_000_000);
  assert.equal(result.resets50, 690);
  assert.equal(result.resets95, 2981);
});

test("250제 모자의 재사용 -2초·INT 7%·올스탯 7%를 메수라이브 방식으로 합산한다", async () => {
  const tables = await level250HatLegendaryTables();
  const result = calculatePotentialExpected({
    tables,
    itemLevel: 250,
    grade: "legendary",
    system: "regular",
    mainStat: "INT",
    subStat: "LUK",
    attackType: "magic",
    characterLevel: 290,
    targets: [
      { targetType: "cooldown", target: 2 },
      { targetType: "int-percent", target: 7 },
      { targetType: "all-stat-percent", target: 7 },
    ],
  });

  assert.ok(Math.abs(result.rawProbability - 0.0012490742441758234) < 1e-15);
  assert.ok(Math.abs(result.probability - 0.00124966094163494) < 1e-15);
  assert.ok(Math.abs(result.expectedResets - 800.2170562294226) < 1e-9);
});

test("250제 에디셔널 레전드리 INT 7%·올스탯 6%를 메수라이브 방식으로 계산한다", async () => {
  const tables = await level250AdditionalHatLegendaryTables();
  const result = calculatePotentialExpected({
    tables,
    itemLevel: 250,
    grade: "legendary",
    system: "additional",
    mainStat: "INT",
    subStat: "LUK",
    attackType: "magic",
    characterLevel: 290,
    targets: [
      { targetType: "int-percent", target: 7 },
      { targetType: "all-stat-percent", target: 6 },
    ],
  });

  assert.ok(Math.abs(result.rawProbability - 0.01099535045978302) < 1e-15);
  assert.ok(Math.abs(result.probability - 0.010996622042702537) < 1e-15);
  assert.ok(Math.abs(result.expectedResets - 90.93701648713203) < 1e-9);
  assert.ok(Math.abs(result.expectedCost - 8_911_827_615.73894) < 1e-5);
});
