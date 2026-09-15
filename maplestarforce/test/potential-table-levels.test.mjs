import assert from "node:assert/strict";
import test from "node:test";

import {
  candidateLevelsForBand,
  MAX_POTENTIAL_ITEM_LEVEL,
  POTENTIAL_LEVEL_BANDS,
  requestLevelForBand,
} from "../scripts/potential-table-levels.mjs";
import { isPotentialTableComboFile } from "../scripts/potential-table-files.mjs";
import { bandFor, bandsForSystem } from "../src/shared/potential-tables.js";

test("장비 레벨을 정확한 잠재 확률표 구간으로 나눈다", () => {
  const cases = [
    [0, 0],
    [9, 0],
    [10, 10],
    [11, 11],
    [19, 11],
    [20, 20],
    [21, 21],
    [29, 21],
    [30, 30],
    [31, 31],
    [39, 31],
    [70, 70],
    [71, 71],
    [79, 71],
    [80, 80],
    [81, 81],
    [89, 81],
    [90, 90],
    [91, 91],
    [99, 91],
    [100, 100],
    [101, 101],
    [109, 101],
    [110, 110],
    [111, 111],
    [119, 111],
    [120, 120],
    [200, 120],
    [201, 201],
    [MAX_POTENTIAL_ITEM_LEVEL, 201],
  ];

  for (const [itemLevel, expectedBand] of cases) {
    assert.equal(
      bandFor(POTENTIAL_LEVEL_BANDS, itemLevel),
      expectedBand,
      `${itemLevel}레벨`,
    );
  }
});

test("구간의 마지막 레벨로 넥슨 확률표를 조회한다", () => {
  for (let index = 0; index < POTENTIAL_LEVEL_BANDS.length; index += 1) {
    const band = POTENTIAL_LEVEL_BANDS[index];
    const nextBand = POTENTIAL_LEVEL_BANDS[index + 1];
    const expected = nextBand === undefined ? MAX_POTENTIAL_ITEM_LEVEL : nextBand - 1;
    assert.equal(requestLevelForBand(band), expected, `${band}레벨 구간`);
  }

  assert.throws(() => requestLevelForBand(42), RangeError);
});

test("부위에 해당하는 장비를 찾도록 구간 안의 레벨을 모두 시도한다", () => {
  assert.deepEqual(candidateLevelsForBand(81), [89, 88, 87, 86, 85, 84, 83, 82, 81]);
  assert.deepEqual(candidateLevelsForBand(110), [110]);

  const highLevelCandidates = candidateLevelsForBand(120);
  assert.deepEqual(highLevelCandidates.slice(0, 6), [200, 120, 160, 150, 140, 130]);
  assert.equal(highLevelCandidates.length, 81);
  assert.equal(new Set(highLevelCandidates).size, 81);

  const endgameCandidates = candidateLevelsForBand(201);
  assert.deepEqual(endgameCandidates.slice(0, 2), [MAX_POTENTIAL_ITEM_LEVEL, 201]);
  assert.equal(new Set(endgameCandidates).size, 50);
});

test("잠재 종류별 레벨 구간을 우선하고 기존 index도 지원한다", () => {
  const legacyBands = [0, 20, 31, 70, 71, 120, 201];
  const index = {
    bands: legacyBands,
    bandsBySystem: { additional: POTENTIAL_LEVEL_BANDS },
  };

  assert.equal(bandsForSystem(index, "regular"), legacyBands);
  assert.equal(bandsForSystem(index, "additional"), POTENTIAL_LEVEL_BANDS);
  assert.equal(bandFor(bandsForSystem(index, "regular"), 91), 71);
  assert.equal(bandFor(bandsForSystem(index, "additional"), 91), 91);
});

test("정리할 잠재 조합 JSON 파일만 엄격하게 구분한다", () => {
  for (const file of [
    "regular-legendary-1-120.json",
    "regular-gold-legendary-1-120.json",
    "regular-silver-unique-3-201.json",
    "regular-occult-epic-18-71.json",
    "additional-rare-20-201.json",
    "additional-bronze-epic-6-120.json",
  ]) {
    assert.equal(isPotentialTableComboFile(file), true, file);
  }
  for (const file of [
    "index.json",
    "potential.json",
    "additional-rare-21-120.json",
    "additional-mythic-1-120.json",
    "regular-platinum-epic-1-120.json",
    "additional-white-legendary-1-120.json",
    "../additional-rare-1-120.json",
    "additional-rare-1-120.json.bak",
  ]) {
    assert.equal(isPotentialTableComboFile(file), false, file);
  }
});
