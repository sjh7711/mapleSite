import assert from "node:assert/strict";
import test from "node:test";
import {
  FULL_BOSS_DOPING,
  inferPotentialStatProfile,
} from "maple-core/stat-profile";

test("직업에서 주스탯·부스탯·공격 계열을 추론한다", () => {
  assert.deepEqual(inferPotentialStatProfile("레테"), {
    supported: true,
    model: "standard",
    mainStat: "INT",
    subStat: "LUK",
    attackType: "magic",
  });
  assert.deepEqual(inferPotentialStatProfile("렌"), {
    supported: true,
    model: "standard",
    mainStat: "STR",
    subStat: "DEX",
    attackType: "attack",
  });
  assert.deepEqual(inferPotentialStatProfile("제논"), {
    supported: true,
    model: "xenon",
    mainStat: "ALL",
    mainStats: ["STR", "DEX", "LUK"],
    subStat: null,
    attackType: "attack",
  });
  assert.deepEqual(inferPotentialStatProfile("데몬어벤져"), {
    supported: true,
    model: "demon-avenger",
    mainStat: "HP",
    mainStats: ["HP"],
    subStat: "STR",
    attackType: "attack",
  });
  assert.equal(inferPotentialStatProfile("알 수 없는 직업").supported, false);
});

test("이중 부스탯 도적은 DEX와 STR을 모두 추론한다", () => {
  for (const characterClass of [
    "섀도어",
    "듀얼블레이더",
    "듀얼블레이드",
    "카데나",
  ]) {
    assert.deepEqual(inferPotentialStatProfile(characterClass), {
      supported: true,
      model: "standard",
      mainStat: "LUK",
      subStat: "DEX",
      subStats: ["DEX", "STR"],
      attackType: "attack",
    });
  }
});

test("풀보스 도핑 프리셋과 직업 보정을 공용으로 제공한다", () => {
  assert.equal(FULL_BOSS_DOPING.totals.attackMagic, 375);
  assert.equal(FULL_BOSS_DOPING.totals.attackMagicPercent, 50);
  assert.equal(FULL_BOSS_DOPING.totals.mainStat, 75);
  assert.equal(FULL_BOSS_DOPING.totals.subStat, 75);
  assert.equal(FULL_BOSS_DOPING.totals.bossDamage, 95);
  assert.equal(FULL_BOSS_DOPING.totals.damage, 111);
  assert.equal(FULL_BOSS_DOPING.totals.criticalDamage, 43);
  assert.deepEqual(FULL_BOSS_DOPING.totals.ignoreDefenseSources, [15, 24]);
  assert.equal(FULL_BOSS_DOPING.classAdjustments.렌, undefined);
  assert.equal(FULL_BOSS_DOPING.classAdjustments.메르세데스, undefined);
});
