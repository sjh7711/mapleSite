import assert from "node:assert/strict";
import test from "node:test";

import {
  getAllStatFlatMainStat,
  getFlatStatToFlatMainStat,
  getProfileSubStats,
  getStatPercentToMainPercent,
  getUnreflectedStatToPercent,
  isDualSubStatClass,
  withStatEquivalenceMaps,
} from "../src/shared/profile-stat-equivalence.js";

const dualSubProfile = {
  mainStat: "LUK",
  subStat: "DEX",
  subStats: ["DEX", "STR", "DEX", "LUK"],
  statEquivalence: {
    flatMainStatToPercent: 0.1,
    flatSubStatToFlatMainStat: 0.25,
    subStatPercentToMainPercent: 0.12,
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

test("두 부스탯을 중복 없이 유지하고 스탯별 환산 맵을 우선한다", () => {
  assert.deepEqual(getProfileSubStats(dualSubProfile), ["DEX", "STR"]);
  assert.equal(getFlatStatToFlatMainStat(dualSubProfile, "DEX"), 0.28);
  assert.equal(getFlatStatToFlatMainStat(dualSubProfile, "STR"), 0.17);
  assert.equal(getStatPercentToMainPercent(dualSubProfile, "DEX"), 0.14);
  assert.equal(getStatPercentToMainPercent(dualSubProfile, "STR"), 0.09);
  assert.equal(getUnreflectedStatToPercent(dualSubProfile, "DEX"), 0.031);
  assert.equal(getUnreflectedStatToPercent(dualSubProfile, "STR"), 0.019);
});

test("올스탯 고정 수치는 주스탯과 두 부스탯 가치를 모두 더한다", () => {
  assert.equal(getAllStatFlatMainStat(dualSubProfile), 1 + 0.28 + 0.17);
});

test("legacy subStat 프로필도 배열·맵 계약으로 정규화한다", () => {
  const normalized = withStatEquivalenceMaps({
    mainStat: "INT",
    subStat: "LUK",
    statEquivalence: {
      flatMainStatToPercent: 0.1,
      flatSubStatToFlatMainStat: 0.25,
      subStatPercentToMainPercent: 0.12,
    },
  });

  assert.deepEqual(normalized.subStats, ["LUK"]);
  assert.equal(normalized.subStat, "LUK");
  assert.equal(normalized.statEquivalence.flatStatToFlatMainStatByStat.INT, 1);
  assert.equal(normalized.statEquivalence.flatStatToFlatMainStatByStat.LUK, 0.25);
  assert.equal(normalized.statEquivalence.statPercentToMainPercentByStat.LUK, 0.12);
  assert.equal(normalized.statEquivalence.unreflectedStatToPercentByStat.LUK, 0.025);
});

test("명시적인 빈 subStats는 legacy subStat으로 다시 채우지 않는다", () => {
  assert.deepEqual(
    getProfileSubStats({ mainStat: "ALL", subStat: "DEX", subStats: [] }),
    [],
  );
});

test("v1 프로필을 폐기해야 하는 두 부스탯 직업과 별칭을 판별한다", () => {
  for (const className of ["섀도어", "듀얼블레이더", "듀얼블레이드", "카데나"]) {
    assert.equal(isDualSubStatClass(className), true);
  }
  assert.equal(isDualSubStatClass("나이트로드"), false);
});

test("UI 호출부는 subStats와 v2 프로필 캐시를 사용한다", async () => {
  const { readFile } = await import("node:fs/promises");
  const [characterProfile, potentialPage, potentialOptions, addOption] =
    await Promise.all([
      readFile(new URL("../src/shared/character-profile.js", import.meta.url), "utf8"),
      readFile(new URL("../src/shared/potential-page.js", import.meta.url), "utf8"),
      readFile(new URL("../src/shared/potential-equivalence-options.js", import.meta.url), "utf8"),
      readFile(new URL("../src/pages/add-option.js", import.meta.url), "utf8"),
    ]);

  assert.match(characterProfile, /character-profile:v2/);
  assert.match(characterProfile, /character-profile:v1/);
  assert.match(characterProfile, /character-names:v1/);
  assert.match(characterProfile, /subStatCoefficients/);
  assert.match(characterProfile, /subStatPercentCoefficients/);
  assert.match(potentialPage, /subStats: getProfileSubStats\(activeProfile\)/);
  assert.match(potentialPage, /subStats: getProfileSubStats\(profile\)/);
  assert.match(potentialOptions, /subStats: getProfileSubStats\(profile\)/);
  assert.match(addOption, /subStats: getProfileSubStats\(profile\)/);
});
