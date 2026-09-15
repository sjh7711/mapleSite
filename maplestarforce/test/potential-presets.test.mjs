import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  calculatePotentialExpected,
  parsePotentialOption,
} from "maple-core/potential";
import {
  getRegularOptimalPreset,
  materializePresetTargetSets,
} from "../src/shared/potential-presets.js";

async function potentialTables(part, band) {
  const base = new URL("../public/potential-tables/", import.meta.url);
  const [index, packed] = await Promise.all([
    readFile(new URL("index.json", base), "utf8").then(JSON.parse),
    readFile(
      new URL(`regular-legendary-${part}-${band}.json`, base),
      "utf8",
    ).then(JSON.parse),
  ]);
  return packed.map((line) => line.map(([nameIndex, probability]) => ({
    name: index.names[nameIndex],
    probability,
  })));
}

const ringTables = (band) => potentialTables(18, band);

function calculatePresetProbability(tables, preset, part, itemLevel = 200) {
  return calculatePotentialExpected({
    tables,
    targetSets: preset.targetSets.map((targets) => targets.map((target) => ({
      targetType: target.type,
      target: target.value,
    }))),
    part,
    itemLevel,
    grade: "legendary",
  }).rawProbability;
}

function optionCategory(option, attackType) {
  const metrics = parsePotentialOption(option.name);
  const attack = attackType === "magic"
    ? metrics.magicPercent
    : metrics.attackPercent;
  if (attack > 0) return "A";
  if (metrics.bossDamage > 0) return "B";
  if (metrics.ignoreDefense > 0) return "I";
  return "X";
}

function outcomeMatchesPreset(options, preset, attackType) {
  const scores = {
    "attack-power-percent": 0,
    "magic-power-percent": 0,
    "boss-damage": 0,
    "ignore-defense": 0,
  };
  let ignoreDefenseRemaining = 1;
  for (const option of options) {
    const metrics = parsePotentialOption(option.name);
    scores["attack-power-percent"] += metrics.attackPercent;
    scores["magic-power-percent"] += metrics.magicPercent;
    scores["boss-damage"] += metrics.bossDamage;
    ignoreDefenseRemaining *= 1 - metrics.ignoreDefense / 100;
  }
  scores["ignore-defense"] = (1 - ignoreDefenseRemaining) * 100;
  const attackTarget = attackType === "magic"
    ? "magic-power-percent"
    : "attack-power-percent";
  return preset.targetSets.some((targets) => targets.every(({ type, value }) => {
    if (type === "attack-power-percent" || type === "magic-power-percent") {
      if (type !== attackTarget) return false;
    }
    return scores[type] >= value - 1e-9;
  }));
}

function assertPresetMatchesPatterns(
  tables,
  preset,
  { attackType = "attack", includeIgnoreDefense, includePpyogong },
) {
  const allowed = new Set(["AAA", "AAB", "ABB", "BBB"]);
  if (includeIgnoreDefense) {
    allowed.add("AAI");
    allowed.add("ABI");
    allowed.add("BBI");
  }
  const mismatches = [];
  for (const first of tables[0]) {
    for (const second of tables[1]) {
      for (const third of tables[2]) {
        const options = [first, second, third];
        const categories = options.map((option) => optionCategory(option, attackType));
        let expected = allowed.has(categories.toSorted().join(""));
        if (
          expected &&
          !includePpyogong &&
          categories[0] === "B" &&
          categories.includes("A")
        ) expected = false;
        const actual = outcomeMatchesPreset(options, preset, attackType);
        if (actual !== expected) {
          mismatches.push({
            options: options.map(({ name }) => name),
            categories,
            expected,
            actual,
          });
        }
      }
    }
  }
  assert.deepEqual(mismatches, []);
}

test("Lv.200 반지 공식표에서 정옵션 8개 OR 세트를 만든다", async () => {
  const tables = await ringTables(120);
  const preset = getRegularOptimalPreset({
    system: "regular",
    part: 18,
    grade: "legendary",
    tables,
  });

  assert.deepEqual(preset.targetSets, [
    [{ type: "str-percent", value: 30 }],
    [{ type: "dex-percent", value: 30 }],
    [{ type: "int-percent", value: 30 }],
    [{ type: "luk-percent", value: 30 }],
    [{ type: "all-stat-percent", value: 21 }],
    [{ type: "drop", value: 40 }],
    [{ type: "meso", value: 40 }],
    [
      { type: "drop", value: 20 },
      { type: "meso", value: 20 },
    ],
  ]);

  const result = calculatePotentialExpected({
    tables,
    targetSets: preset.targetSets.map((targets) => targets.map((target) => ({
      targetType: target.type,
      target: target.value,
    }))),
    itemLevel: 200,
    grade: "legendary",
  });
  assert.ok(Math.abs(result.rawProbability - 0.015883319581867603) < 1e-15);
  assert.ok(result.probability > result.rawProbability);
  assert.ok(Math.abs(result.expectedResets - 1 / result.probability) < 1e-12);
});

test("Lv.201 이상 반지는 공식 줄 수치에 맞춰 스탯 목표를 높인다", async () => {
  const preset = getRegularOptimalPreset({
    system: "regular",
    part: 18,
    grade: "legendary",
    tables: await ringTables(201),
  });
  assert.deepEqual(preset.values, {
    stat: 33,
    allStat: 24,
    drop: 40,
    meso: 40,
    mixedDrop: 20,
    mixedMeso: 20,
  });
  assert.equal(preset.targetSets[0][0].value, 33);
  assert.equal(preset.targetSets[4][0].value, 24);
});

test("장신구 -3% 포함 프리셋은 레벨별 공식 줄 간격만큼 목표를 낮춘다", async () => {
  const level200 = getRegularOptimalPreset({
    system: "regular",
    part: 18,
    grade: "legendary",
    tables: await ringTables(120),
    includeNearOptimal: true,
  });
  const level250 = getRegularOptimalPreset({
    system: "regular",
    part: 18,
    grade: "legendary",
    tables: await ringTables(201),
    includeNearOptimal: true,
  });

  assert.deepEqual(
    level200.targetSets.slice(0, 5),
    [
      [{ type: "str-percent", value: 27 }],
      [{ type: "dex-percent", value: 27 }],
      [{ type: "int-percent", value: 27 }],
      [{ type: "luk-percent", value: 27 }],
      [{ type: "all-stat-percent", value: 21 }],
    ],
  );
  assert.deepEqual(
    level250.targetSets.slice(0, 5),
    [
      [{ type: "str-percent", value: 30 }],
      [{ type: "dex-percent", value: 30 }],
      [{ type: "int-percent", value: 30 }],
      [{ type: "luk-percent", value: 30 }],
      [{ type: "all-stat-percent", value: 24 }],
    ],
  );
  assert.equal(level200.includesNearOptimal, true);
  assert.equal(level250.includesNearOptimal, true);
  assert.ok(
    calculatePresetProbability(await ringTables(120), level200, 18) >
      calculatePresetProbability(
        await ringTables(120),
        getRegularOptimalPreset({
          system: "regular",
          part: 18,
          grade: "legendary",
          tables: await ringTables(120),
        }),
        18,
      ),
  );
});

test("장신구 드메 OFF는 스탯과 올스탯 다섯 세트만 남긴다", async () => {
  const preset = getRegularOptimalPreset({
    system: "regular",
    part: 18,
    grade: "legendary",
    tables: await ringTables(201),
    includeNearOptimal: true,
    includeDropMeso: false,
  });

  assert.equal(preset.targetSets.length, 5);
  assert.equal(preset.includesDropMeso, false);
  assert.ok(preset.targetSets.flat().every(({ type }) =>
    type !== "drop" && type !== "meso"
  ));
  assert.match(preset.label, /정옵션 -3% 5세트 적용/);
});

test("프리셋은 윗잠 레전드리 지원 부위에서만 만들고 UI용 3행을 독립 복제한다", async () => {
  const tables = await ringTables(120);
  assert.equal(getRegularOptimalPreset({
    system: "additional",
    part: 18,
    grade: "legendary",
    tables,
  }), null);
  assert.equal(getRegularOptimalPreset({
    system: "regular",
    part: 13,
    grade: "legendary",
    tables,
  }), null);
  assert.equal(getRegularOptimalPreset({
    system: "regular",
    part: 18,
    grade: "unique",
    tables,
  }), null);

  const preset = getRegularOptimalPreset({
    system: "regular",
    part: 18,
    grade: "legendary",
    tables,
  });
  const materialized = materializePresetTargetSets(preset);
  assert.equal(materialized.length, 8);
  assert.ok(materialized.every((targetSet) => targetSet.targets.length === 3));
  assert.deepEqual(materialized.at(-1).targets, [
    { type: "drop", value: 20 },
    { type: "meso", value: 20 },
    { type: "", value: "" },
  ]);
  materialized[0].targets[0].value = 999;
  assert.equal(preset.targetSets[0][0].value, 30);
});

test("얼굴장식부터 펜던트까지 같은 액세서리 정옵션 8세트를 제공한다", async () => {
  const partNames = new Map([
    [15, "얼굴장식"],
    [16, "눈장식"],
    [17, "귀고리"],
    [18, "반지"],
    [19, "펜던트"],
  ]);
  const expected = getRegularOptimalPreset({
    system: "regular",
    part: 18,
    grade: "legendary",
    tables: await potentialTables(18, 120),
  }).targetSets;

  for (const [part, name] of partNames) {
    const preset = getRegularOptimalPreset({
      system: "regular",
      part,
      grade: "legendary",
      tables: await potentialTables(part, 120),
    });
    assert.equal(preset.kind, "accessory");
    assert.equal(preset.name, name);
    assert.equal(preset.targetSets.length, 8);
    assert.deepEqual(preset.targetSets, expected);
  }

  for (const part of [13, 14, 20]) {
    assert.equal(getRegularOptimalPreset({
      system: "regular",
      part,
      grade: "legendary",
      tables: await potentialTables(part, 120),
    }), null);
  }
});

test("무기 기본 정옵은 방무 없이 공공공·보공공·보보공·보보보를 만든다", async () => {
  const tables = await potentialTables(1, 120);
  const preset = getRegularOptimalPreset({
    system: "regular",
    part: 1,
    grade: "legendary",
    tables,
    attackType: "attack",
  });

  assert.deepEqual(preset.targetSets, [
    [{ type: "attack-power-percent", value: 30 }],
    [
      { type: "attack-power-percent", value: 21 },
      { type: "boss-damage", value: 30 },
    ],
    [
      { type: "attack-power-percent", value: 18 },
      { type: "boss-damage", value: 35 },
    ],
    [
      { type: "attack-power-percent", value: 12 },
      { type: "boss-damage", value: 60 },
    ],
    [
      { type: "attack-power-percent", value: 9 },
      { type: "boss-damage", value: 65 },
    ],
    [{ type: "boss-damage", value: 95 }],
  ]);
  assert.equal(preset.includesIgnoreDefense, false);
  assert.ok(preset.targetSets.flat().every(({ type }) => type !== "ignore-defense"));
  assert.ok(Math.abs(
    calculatePresetProbability(tables, preset, 1) - 0.004183400138888464,
  ) < 1e-15);
});

test("방무 1줄 opt-in은 무기·보조에 공공방·보공방·보보방을 더하고 방무 2줄은 만들지 않는다", async () => {
  for (const part of [1, 3, 4, 5]) {
    const tables = await potentialTables(part, 120);
    const preset = getRegularOptimalPreset({
      system: "regular",
      part,
      grade: "legendary",
      tables,
      attackType: "attack",
      includeIgnoreDefense: true,
    });
    assert.equal(preset.targetSets.length, 13);
    assert.deepEqual(preset.targetSets.slice(6), [
      [
        { type: "attack-power-percent", value: 21 },
        { type: "ignore-defense", value: 30 },
      ],
      [
        { type: "attack-power-percent", value: 18 },
        { type: "ignore-defense", value: 35 },
      ],
      [
        { type: "attack-power-percent", value: 12 },
        { type: "boss-damage", value: 30 },
        { type: "ignore-defense", value: 30 },
      ],
      [
        { type: "attack-power-percent", value: 9 },
        { type: "boss-damage", value: 35 },
        { type: "ignore-defense", value: 30 },
      ],
      [
        { type: "attack-power-percent", value: 9 },
        { type: "boss-damage", value: 30 },
        { type: "ignore-defense", value: 35 },
      ],
      [
        { type: "boss-damage", value: 65 },
        { type: "ignore-defense", value: 30 },
      ],
      [
        { type: "boss-damage", value: 60 },
        { type: "ignore-defense", value: 35 },
      ],
    ]);
    assert.ok(preset.targetSets.every((targets) =>
      targets.filter(({ type }) => type === "ignore-defense").length <= 1
    ));
  }

  const primaryTables = await potentialTables(1, 120);
  const primary = getRegularOptimalPreset({
    system: "regular",
    part: 1,
    grade: "legendary",
    tables: primaryTables,
    attackType: "attack",
    includeIgnoreDefense: true,
  });
  assert.ok(Math.abs(
    calculatePresetProbability(primaryTables, primary, 1) - 0.01045848962720605,
  ) < 1e-15);

  const secondaryTables = await potentialTables(3, 120);
  const secondary = getRegularOptimalPreset({
    system: "regular",
    part: 3,
    grade: "legendary",
    tables: secondaryTables,
    attackType: "attack",
    includeIgnoreDefense: true,
  });
  assert.ok(Math.abs(
    calculatePresetProbability(secondaryTables, secondary, 3) - 0.006559406916956331,
  ) < 1e-15);
});

test("엠블렘은 공마 30%와 공마 21%·방무 30%만 정옵으로 만든다", async () => {
  const tables = await potentialTables(2, 120);
  const base = getRegularOptimalPreset({
    system: "regular",
    part: 2,
    grade: "legendary",
    tables,
    attackType: "magic",
  });
  assert.deepEqual(base.targetSets, [
    [{ type: "magic-power-percent", value: 30 }],
  ]);
  assert.ok(Math.abs(
    calculatePresetProbability(tables, base, 2) - 0.0003024792088782297,
  ) < 1e-15);

  const withIgnoreDefense = getRegularOptimalPreset({
    system: "regular",
    part: 2,
    grade: "legendary",
    tables,
    attackType: "magic",
    includeIgnoreDefense: true,
  });
  assert.deepEqual(withIgnoreDefense.targetSets, [
    [{ type: "magic-power-percent", value: 30 }],
    [
      { type: "magic-power-percent", value: 21 },
      { type: "ignore-defense", value: 30 },
    ],
  ]);
  assert.ok(withIgnoreDefense.targetSets.every((targets) =>
    targets.filter(({ type }) => type === "ignore-defense").length <= 1
  ));
  assert.ok(Math.abs(
    calculatePresetProbability(tables, withIgnoreDefense, 2) -
      0.0010838843557324322,
  ) < 1e-15);
});

test("Lv.201 무기는 공식 줄 수치와 공격·마력 계열을 동적으로 반영한다", async () => {
  const tables = await potentialTables(1, 201);
  const preset = getRegularOptimalPreset({
    system: "regular",
    part: 1,
    grade: "legendary",
    tables,
    attackType: "magic",
  });
  assert.deepEqual(preset.targetSets, [
    [{ type: "magic-power-percent", value: 33 }],
    [
      { type: "magic-power-percent", value: 23 },
      { type: "boss-damage", value: 35 },
    ],
    [
      { type: "magic-power-percent", value: 20 },
      { type: "boss-damage", value: 40 },
    ],
    [
      { type: "magic-power-percent", value: 13 },
      { type: "boss-damage", value: 70 },
    ],
    [
      { type: "magic-power-percent", value: 10 },
      { type: "boss-damage", value: 75 },
    ],
    [{ type: "boss-damage", value: 110 }],
  ]);
  assert.ok(preset.targetSets.flat().every(({ type }) =>
    type !== "attack-power-percent" && type !== "ignore-defense"
  ));
});

test("UI 프리셋 변환은 초과·중복·잘못된 조건을 자르지 않고 전체 거부한다", () => {
  const target = { type: "attack-power-percent", value: 30 };
  assert.equal(materializePresetTargetSets({
    targetSets: Array.from({ length: 16 }, () => [target]),
  }).length, 16);
  assert.deepEqual(materializePresetTargetSets({
    targetSets: Array.from({ length: 17 }, () => [target]),
  }), []);
  assert.deepEqual(materializePresetTargetSets(
    { targetSets: Array.from({ length: 13 }, () => [target]) },
    { maxSets: 12 },
  ), []);
  assert.deepEqual(materializePresetTargetSets({
    targetSets: [[target, { type: "boss-damage", value: 30 }, {
      type: "ignore-defense",
      value: 30,
    }, { type: "damage", value: 10 }]],
  }), []);
  assert.deepEqual(materializePresetTargetSets({
    targetSets: [[target, { ...target, value: 21 }]],
  }), []);
  assert.deepEqual(materializePresetTargetSets({
    targetSets: [[{ type: "unknown", value: 1 }]],
  }), []);
  assert.deepEqual(materializePresetTargetSets({
    targetSets: [[{ ...target, value: 0 }]],
  }), []);
  assert.deepEqual(materializePresetTargetSets(
    { targetSets: [[target]] },
    { availableTypes: ["boss-damage"] },
  ), []);
});

test("뾰공 포함을 끄면 첫 줄 보공 35%만 제외하고 보공 40% 조합을 유지한다", async () => {
  const tables = await potentialTables(1, 120);
  const preset = getRegularOptimalPreset({
    system: "regular",
    part: 1,
    grade: "legendary",
    tables,
    attackType: "attack",
    includeIgnoreDefense: false,
    includePpyogong: false,
  });

  assert.deepEqual(preset.targetSets, [
    [{ type: "attack-power-percent", value: 30 }],
    [
      { type: "attack-power-percent", value: 21 },
      { type: "boss-damage", value: 30 },
    ],
    [
      { type: "attack-power-percent", value: 18 },
      { type: "boss-damage", value: 40 },
    ],
    [
      { type: "attack-power-percent", value: 12 },
      { type: "boss-damage", value: 60 },
    ],
    [
      { type: "attack-power-percent", value: 9 },
      { type: "boss-damage", value: 70 },
    ],
    [{ type: "boss-damage", value: 100 }],
  ]);
  assert.equal(preset.includesPpyogong, false);
  assert.ok(Math.abs(
    calculatePresetProbability(tables, preset, 1) - 0.002739762501306945,
  ) < 1e-15);
});

test("뾰공 OFF와 방무 1줄을 함께 써도 첫 줄 상위 보공 세트를 보존한다", async () => {
  const tables = await potentialTables(1, 120);
  const preset = getRegularOptimalPreset({
    system: "regular",
    part: 1,
    grade: "legendary",
    tables,
    attackType: "attack",
    includeIgnoreDefense: true,
    includePpyogong: false,
  });

  assert.equal(preset.targetSets.length, 13);
  assert.ok(preset.targetSets.some((targets) =>
    targets.some(({ type, value }) => type === "attack-power-percent" && value === 18) &&
    targets.some(({ type, value }) => type === "boss-damage" && value === 40)
  ));
  assert.ok(preset.targetSets.some((targets) =>
    targets.some(({ type, value }) => type === "boss-damage" && value === 70) &&
    targets.some(({ type, value }) => type === "ignore-defense" && value === 30)
  ));
  assert.ok(!preset.targetSets.some((targets) =>
    targets.some(({ type, value }) => type === "boss-damage" && value === 95)
  ));
  assert.ok(preset.targetSets.every((targets) =>
    targets.filter(({ type }) => type === "ignore-defense").length <= 1
  ));
  assert.ok(Math.abs(
    calculatePresetProbability(tables, preset, 1) - 0.007571214352042995,
  ) < 1e-15);
});

test("Lv.201 이상에서도 뾰공 OFF는 첫 줄 상위 보공을 기준으로 삼는다", async () => {
  const preset = getRegularOptimalPreset({
    system: "regular",
    part: 1,
    grade: "legendary",
    tables: await potentialTables(1, 201),
    attackType: "magic",
    includePpyogong: false,
  });

  assert.ok(preset.targetSets.some((targets) =>
    targets.some(({ type, value }) => type === "magic-power-percent" && value === 20) &&
    targets.some(({ type, value }) => type === "boss-damage" && value === 45)
  ));
  assert.ok(preset.targetSets.some((targets) =>
    targets.length === 1 &&
    targets[0].type === "boss-damage" &&
    targets[0].value === 115
  ));
  assert.ok(!preset.targetSets.some((targets) =>
    targets.some(({ type, value }) => type === "boss-damage" && value === 110)
  ));
});

test("무기 공식표의 모든 3줄 결과에서 프리셋과 정옵 패턴 분류가 정확히 일치한다", async () => {
  const tables = await potentialTables(1, 120);
  for (const config of [
    { includeIgnoreDefense: false, includePpyogong: true },
    { includeIgnoreDefense: true, includePpyogong: true },
  ]) {
    const preset = getRegularOptimalPreset({
      system: "regular",
      part: 1,
      grade: "legendary",
      tables,
      attackType: "attack",
      ...config,
    });
    assertPresetMatchesPatterns(tables, preset, {
      attackType: "attack",
      ...config,
    });
  }
});
