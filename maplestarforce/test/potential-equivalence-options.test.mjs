import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { calculatePotentialExpected } from "maple-core/potential";
import {
  MAX_STAT_EQUIVALENT_COMBINATIONS,
  getStatEquivalentSuccessCombinations,
} from "../src/shared/potential-equivalence-options.js";

const profile = {
  mainStat: "INT",
  subStat: "LUK",
  attackType: "magic",
  characterLevel: 285,
  statEquivalence: {
    flatMainStatToPercent: 0.1,
    flatSubStatToFlatMainStat: 0.25,
    attackToMainStat: 3,
    allStatPercentToMainPercent: 1.2,
    subStatPercentToMainPercent: 0.12,
    criticalDamageToMainPercent: 4,
  },
};

function namesKey(combination) {
  return combination.options.map(({ name }) => name).toSorted().join("|");
}

test("실제 줄이 다른 성공 조합을 만들고 순서 중복만 제거한다", () => {
  const tables = [
    [
      { name: "INT +8%", probability: 50 },
      { name: "캐릭터 기준 9레벨 당 INT +2", probability: 50 },
    ],
    [
      { name: "올스탯 +5%", probability: 50 },
      { name: "INT +6%", probability: 50 },
    ],
    [
      { name: "올스탯 +5%", probability: 50 },
      { name: "INT +6%", probability: 50 },
    ],
  ];

  const result = getStatEquivalentSuccessCombinations({
    tables,
    target: 12,
    profile,
  });
  const keys = result.combinations.map(namesKey);

  assert.equal(result.totalCount, 13);
  assert.equal(result.truncated, false);
  assert.equal(result.hiddenCount, 0);
  assert.ok(keys.includes("INT +8%|올스탯 +5%"));
  assert.ok(keys.includes("INT +6%|INT +8%"));
  assert.ok(keys.includes("INT +6%|캐릭터 기준 9레벨 당 INT +2"));
  assert.ok(keys.includes("올스탯 +5%|캐릭터 기준 9레벨 당 INT +2"));
  assert.ok(keys.includes("INT +6%|INT +6%"));
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(result.combinations.some(({ options }) => options.length === 2));
  assert.ok(result.combinations.some(({ options }) => options.length === 3));
});

test("같은 줄에만 있는 옵션끼리는 조합하지 않는다", () => {
  const result = getStatEquivalentSuccessCombinations({
    tables: [
      [
        { name: "INT +8%", probability: 50 },
        { name: "올스탯 +5%", probability: 50 },
      ],
      [{ name: "마력 +12%", probability: 100 }],
      [{ name: "보스 몬스터 데미지 +40%", probability: 100 }],
    ],
    target: 12,
    profile,
  });
  assert.deepEqual(result, {
    combinations: [],
    totalCount: 0,
    hiddenCount: 0,
    truncated: false,
  });
});

test("더 적은 줄로 이미 성공해도 함께 나올 수 있는 상위 조합을 유지한다", () => {
  const result = getStatEquivalentSuccessCombinations({
    tables: [
      [{ name: "INT +12%", probability: 100 }],
      [{ name: "INT +6%", probability: 100 }],
      [{ name: "INT +6%", probability: 100 }],
    ],
    target: 12,
    profile,
  });
  assert.deepEqual(result.combinations.map(namesKey), [
    "INT +12%",
    "INT +6%|INT +6%",
    "INT +12%|INT +6%",
    "INT +12%|INT +6%|INT +6%",
  ]);
});

test("24%급 내림차순은 세 줄 13%인 39%급 조합을 가장 먼저 표시한다", () => {
  const result = getStatEquivalentSuccessCombinations({
    tables: [
      [{ name: "INT +13%", probability: 100 }],
      [
        { name: "INT +13%", probability: 50 },
        { name: "INT +10%", probability: 50 },
      ],
      [
        { name: "INT +13%", probability: 50 },
        { name: "INT +10%", probability: 50 },
      ],
    ],
    target: 24,
    profile,
    sortDirection: "desc",
  });

  assert.equal(result.combinations[0].score, 39);
  assert.deepEqual(
    result.combinations[0].options.map(({ name }) => name),
    ["INT +13%", "INT +13%", "INT +13%"],
  );
  assert.ok(result.combinations.some(({ score }) => score === 26));
});

test("전체 조합 수를 유지하면서 점수가 낮은 순으로 100개만 반환한다", () => {
  const line = Array.from({ length: 120 }, (_, index) => ({
    name: `INT +${index + 2}%`,
    probability: 1,
  }));
  const result = getStatEquivalentSuccessCombinations({
    tables: [line],
    target: 2,
    profile,
  });

  assert.equal(MAX_STAT_EQUIVALENT_COMBINATIONS, 100);
  assert.equal(result.combinations.length, 100);
  assert.equal(result.totalCount, 120);
  assert.equal(result.hiddenCount, 20);
  assert.equal(result.truncated, true);
  assert.equal(namesKey(result.combinations[0]), "INT +2%");
  assert.equal(namesKey(result.combinations.at(-1)), "INT +101%");
  assert.ok(result.combinations.every(({ options }) => options.length === 1));
});

test("명시한 제한은 기본 최대 개수와 별개로 적용한다", () => {
  const line = Array.from({ length: 120 }, (_, index) => ({
    name: `INT +${index + 2}%`,
    probability: 1,
  }));
  const result = getStatEquivalentSuccessCombinations({
    tables: [line],
    target: 2,
    profile,
    limit: 25,
  });

  assert.equal(result.combinations.length, 25);
  assert.equal(result.totalCount, 120);
  assert.equal(result.hiddenCount, 95);
  assert.equal(result.truncated, true);
  assert.equal(namesKey(result.combinations.at(-1)), "INT +26%");
});

test("오름차순과 내림차순은 전체 점수 정렬 후 제한하고 동점 순서는 결정적이다", () => {
  const tables = [[
    { name: "INT +14%", probability: 1 },
    { name: "INT +120", probability: 1 },
    { name: "INT +12%", probability: 1 },
    { name: "INT +13%", probability: 1 },
  ]];
  const reversedTables = [tables[0].toReversed()];
  const ascending = getStatEquivalentSuccessCombinations({
    tables,
    target: 12,
    profile,
    limit: 3,
    sortDirection: "asc",
  });
  const descending = getStatEquivalentSuccessCombinations({
    tables,
    target: 12,
    profile,
    limit: 2,
    sortDirection: "desc",
  });
  const tiedFromReversedInput = getStatEquivalentSuccessCombinations({
    tables: reversedTables,
    target: 12,
    profile,
    sortDirection: "asc",
  });

  assert.deepEqual(ascending.combinations.map(({ score }) => score), [12, 12, 13]);
  assert.deepEqual(descending.combinations.map(({ score }) => score), [14, 13]);
  assert.deepEqual(
    ascending.combinations.slice(0, 2).map(namesKey),
    tiedFromReversedInput.combinations.slice(0, 2).map(namesKey),
  );
  assert.equal(descending.totalCount, 4);
  assert.equal(descending.hiddenCount, 2);
});

test("캐릭터 레벨과 개인 환산 계수가 바뀌면 조합을 다시 판정한다", () => {
  const tables = [
    [{ name: "캐릭터 기준 9레벨 당 INT +2", probability: 100 }],
    [{ name: "올스탯 +5%", probability: 100 }],
    [{ name: "마력 +12%", probability: 100 }],
  ];
  const atLevel269 = getStatEquivalentSuccessCombinations({
    tables,
    target: 12,
    profile: { ...profile, characterLevel: 269 },
  });
  const atLevel270 = getStatEquivalentSuccessCombinations({
    tables,
    target: 12,
    profile: { ...profile, characterLevel: 270 },
  });
  const lowerAllStatCoefficient = getStatEquivalentSuccessCombinations({
    tables,
    target: 12,
    profile: {
      ...profile,
      characterLevel: 270,
      statEquivalence: {
        ...profile.statEquivalence,
        allStatPercentToMainPercent: 1.19,
      },
    },
  });

  assert.equal(atLevel269.totalCount, 0);
  assert.equal(atLevel270.totalCount, 1);
  assert.equal(lowerAllStatCoefficient.totalCount, 0);
});

test("두 부스탯의 STR·DEX%와 올스탯%를 각 개인 계수로 조합한다", () => {
  const dualSubProfile = {
    mainStat: "LUK",
    subStat: "DEX",
    subStats: ["DEX", "STR"],
    attackType: "attack",
    characterLevel: 285,
    statEquivalence: {
      flatMainStatToPercent: 0.1,
      flatSubStatToFlatMainStat: 0.25,
      attackToMainStat: 3,
      allStatPercentToMainPercent: 1.3,
      subStatPercentToMainPercent: 0.14,
      criticalDamageToMainPercent: 4,
      flatStatToFlatMainStatByStat: {
        LUK: 1,
        DEX: 0.28,
        STR: 0.17,
      },
      statPercentToMainPercentByStat: {
        LUK: 1,
        DEX: 0.14,
        STR: 0.09,
      },
      unreflectedStatToPercentByStat: {
        LUK: 0.1,
        DEX: 0.031,
        STR: 0.019,
      },
    },
  };
  const result = getStatEquivalentSuccessCombinations({
    tables: [
      [
        { name: "STR +8%", probability: 50 },
        { name: "DEX +8%", probability: 50 },
      ],
      [{ name: "올스탯 +5%", probability: 100 }],
      [{ name: "공격력 +12%", probability: 100 }],
    ],
    target: 7.2,
    profile: dualSubProfile,
  });

  assert.deepEqual(result.combinations.map(namesKey), [
    "STR +8%|올스탯 +5%",
    "DEX +8%|올스탯 +5%",
  ]);
  assert.deepEqual(
    result.combinations.map(({ score }) => score),
    [7.22, 7.62],
  );
});

async function potentialTables(fileName) {
  const base = new URL("../public/potential-tables/", import.meta.url);
  const [index, packed] = await Promise.all([
    readFile(new URL("index.json", base), "utf8").then(JSON.parse),
    readFile(new URL(fileName, base), "utf8").then(JSON.parse),
  ]);
  return packed.map((line) => line.map(([nameIndex, probability]) => ({
    name: index.names[nameIndex],
    probability,
  })));
}

test("실제 에디셔널 레전드리 모자 표에서도 높은 조합까지 표시하고 확률은 유지한다", async () => {
  const tables = await potentialTables("additional-legendary-6-120.json");
  const personalProfile = {
    mainStat: "INT",
    subStat: "LUK",
    attackType: "magic",
    characterLevel: 286,
    statEquivalence: {
      flatMainStatToPercent: 0.10762100926879505,
      flatSubStatToFlatMainStat: 0.1371610845295056,
      attackToMainStat: 2.949101581809766,
      allStatPercentToMainPercent: 1.1201081359423273,
      subStatPercentToMainPercent: 0.12010813594232728,
      criticalDamageToMainPercent: 3.9053223711194627,
    },
  };
  const calculationOptions = {
    tables,
    targetType: "stat-equivalent",
    target: 12,
    mainStat: personalProfile.mainStat,
    subStat: personalProfile.subStat,
    attackType: personalProfile.attackType,
    characterLevel: personalProfile.characterLevel,
    statEquivalence: personalProfile.statEquivalence,
    itemLevel: 200,
    grade: "legendary",
    system: "additional",
  };
  const beforeResult = calculatePotentialExpected(calculationOptions);
  const beforeTables = structuredClone(tables);
  const beforeProfile = structuredClone(personalProfile);
  const result = getStatEquivalentSuccessCombinations({
    tables,
    target: 12,
    profile: personalProfile,
    sortDirection: "desc",
  });

  assert.equal(result.combinations.length, 100);
  assert.equal(result.totalCount, 332);
  assert.equal(result.hiddenCount, result.totalCount - 100);
  assert.equal(result.combinations[0].score, 24);
  assert.equal(
    namesKey(result.combinations[0]),
    "INT +8%|INT +8%|INT +8%",
  );

  const afterResult = calculatePotentialExpected(calculationOptions);
  assert.equal(beforeResult.rawProbability, 0.02351418035613952);
  assert.equal(beforeResult.probability, 0.0235169140951632);
  assert.equal(afterResult.probability, beforeResult.probability);
  assert.deepEqual(tables, beforeTables);
  assert.deepEqual(personalProfile, beforeProfile);
});

test("잘못된 표나 기준은 빈 결과로 처리한다", () => {
  const empty = {
    combinations: [],
    totalCount: 0,
    hiddenCount: 0,
    truncated: false,
  };
  assert.deepEqual(
    getStatEquivalentSuccessCombinations({ tables: null, target: 12, profile }),
    empty,
  );
  assert.deepEqual(
    getStatEquivalentSuccessCombinations({ tables: [], target: "", profile }),
    empty,
  );
});
