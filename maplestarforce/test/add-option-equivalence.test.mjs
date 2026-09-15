import assert from "node:assert/strict";
import test from "node:test";

import {
  ADD_OPTION_TABLES_SNAPSHOT,
  calculateArmorAddOption,
  calculateWeaponAddOption,
} from "maple-core/add-option";
import { STAT_EQUIVALENCE } from "maple-core/potential";
import {
  DEFAULT_ADD_OPTION_DAMAGE_EQUIVALENCE,
  damageEquivalenceToStatEquivalence,
  normalizeAddOptionDamageEquivalence,
  statEquivalenceToDamageEquivalence,
} from "../src/shared/add-option-equivalence.js";

const oldEquivalence = {
  ...STAT_EQUIVALENCE,
  bossDamageToMainPercent: 0.8,
};

function close(actual, expected, epsilon = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

test("기존 보총 계수를 데미지 기준 네 값으로 정확히 뒤집는다", () => {
  close(DEFAULT_ADD_OPTION_DAMAGE_EQUIVALENCE.flatMainStatToDamagePercent, 0.1375);
  close(DEFAULT_ADD_OPTION_DAMAGE_EQUIVALENCE.flatSubStatToDamagePercent, 0.034375);
  close(DEFAULT_ADD_OPTION_DAMAGE_EQUIVALENCE.flatAttackToDamagePercent, 0.4015);
  close(DEFAULT_ADD_OPTION_DAMAGE_EQUIVALENCE.allStatPercentToDamagePercent, 1.4);

  const rebuilt = damageEquivalenceToStatEquivalence(
    DEFAULT_ADD_OPTION_DAMAGE_EQUIVALENCE,
  );
  for (const key of [
    "flatMainStatToPercent",
    "flatSubStatToFlatMainStat",
    "attackToMainStat",
    "bossDamageToMainPercent",
    "allStatPercentToMainPercent",
  ]) close(rebuilt[key], oldEquivalence[key]);
});

test("기존 저장값과 캐릭터 계수를 데미지 기준으로 변환한다", () => {
  const migrated = normalizeAddOptionDamageEquivalence({
    bossDamageToMainPercent: 1.6,
  });
  close(migrated.flatMainStatToDamagePercent, 0.06875);
  close(migrated.flatSubStatToDamagePercent, 0.0171875);
  close(migrated.flatAttackToDamagePercent, 0.20075);
  close(migrated.allStatPercentToDamagePercent, 0.7);

  assert.deepEqual(
    statEquivalenceToDamageEquivalence({
      flatMainStatToPercent: 0.114,
      flatSubStatToFlatMainStat: 0.13,
      attackToMainStat: 2.96,
      allStatPercentToMainPercent: 1.12,
      bossDamageToMainPercent: 1.62,
    }),
    {
      flatMainStatToDamagePercent: 0.114 / 1.62,
      flatSubStatToDamagePercent: (0.114 * 0.13) / 1.62,
      flatAttackToDamagePercent: (0.114 * 2.96) / 1.62,
      allStatPercentToDamagePercent: 1.12 / 1.62,
    },
  );
});

test("새 입력으로 바꿔도 방어구와 무기 확률을 보존한다", () => {
  const rebuilt = damageEquivalenceToStatEquivalence(
    DEFAULT_ADD_OPTION_DAMAGE_EQUIVALENCE,
  );
  const common = {
    tables: ADD_OPTION_TABLES_SNAPSHOT,
    itemLevel: 200,
    boss: true,
    mainStat: "INT",
    subStat: "LUK",
    attackType: "magic",
  };
  const oldArmor = calculateArmorAddOption({
    ...common,
    target: 120,
    statEquivalence: oldEquivalence,
  });
  const newArmor = calculateArmorAddOption({
    ...common,
    target: 120,
    statEquivalence: rebuilt,
  });
  const oldWeapon = calculateWeaponAddOption({
    ...common,
    tier: 2,
    damagePercent: 10,
    statEquivalence: oldEquivalence,
  });
  const newWeapon = calculateWeaponAddOption({
    ...common,
    tier: 2,
    damagePercent: 10,
    statEquivalence: rebuilt,
  });

  oldArmor.sources.forEach((source, index) =>
    close(newArmor.sources[index].probability, source.probability),
  );
  oldWeapon.sources.forEach((source, index) =>
    close(newWeapon.sources[index].probability, source.probability),
  );
});

test("0 이하의 직접 입력은 계산에 사용하지 않는다", () => {
  assert.throws(
    () => damageEquivalenceToStatEquivalence({
      ...DEFAULT_ADD_OPTION_DAMAGE_EQUIVALENCE,
      flatMainStatToDamagePercent: 0,
    }),
    /모두 0보다 크게/,
  );
});
