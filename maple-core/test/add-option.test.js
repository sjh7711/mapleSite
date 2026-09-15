import assert from "node:assert/strict";
import test from "node:test";

import {
  ADD_OPTION_TABLES_SNAPSHOT,
  buildAddOptionPool,
  calculateArmorAddOption,
  calculateWeaponAddOption,
  calculateWeaponEquivalentAddOption,
  calculateWeaponScoreAddOption,
  createAddOptionScorer,
  getAddOptionMaxHpValue,
  getWeaponAddOptionAttack,
} from "maple-core/add-option";

const standardEquivalence = {
  flatMainStatToPercent: 0.11,
  flatSubStatToFlatMainStat: 0.25,
  attackToMainStat: 2.92,
  allStatPercentToMainPercent: 1.12,
  bossDamageToMainPercent: 0.8,
};

function directEquivalence(overrides = {}) {
  return {
    model: "standard",
    flatStatToDamagePercent: {
      STR: 0.11,
      DEX: 0.0275,
      INT: 0,
      LUK: 0,
      HP: 0,
    },
    flatAttackToDamagePercent: 0.3212,
    allStatPercentToDamagePercent: 1.12,
    bossDamageToDamagePercent: 0.8,
    targetToDamagePercent: 0.11,
    ...overrides,
  };
}

function option(pool, key) {
  const result = pool.find((entry) => entry.key === key);
  assert.ok(result, `${key} 옵션이 풀에 있어야 합니다.`);
  return result;
}

test("최대 HP 추옵은 장비 레벨 구간의 1단계 값에 단계를 곱한다", () => {
  assert.equal(getAddOptionMaxHpValue(200, 1), 600);
  assert.equal(getAddOptionMaxHpValue(200, 7), 4_200);
  assert.equal(getAddOptionMaxHpValue(210, 7), 4_340);
  assert.equal(getAddOptionMaxHpValue(249, 7), 4_760);
  assert.equal(getAddOptionMaxHpValue(250, 7), 4_900);
  assert.equal(getAddOptionMaxHpValue(199, 7), 3_990);
  assert.equal(getAddOptionMaxHpValue(159, 7), 3_150);
  assert.equal(getAddOptionMaxHpValue(0, 7), 21);
  assert.throws(() => getAddOptionMaxHpValue(251, 1), /장비 레벨/);
  assert.throws(() => getAddOptionMaxHpValue(200, 8), /단계/);
});

test("제논 직접 계수는 STR·DEX·LUK를 각각 합산하고 무효 스탯은 제외한다", () => {
  const pool = buildAddOptionPool({ weapon: true, itemLevel: 200 });
  const scorer = createAddOptionScorer({
    itemLevel: 200,
    attackType: "attack",
    addOptionEquivalence: directEquivalence({
      model: "xenon",
      flatStatToDamagePercent: {
        STR: 0.1,
        DEX: 0.2,
        INT: 0,
        LUK: 0.3,
        HP: 0,
      },
      flatAttackToDamagePercent: 0.4,
      allStatPercentToDamagePercent: 2,
      bossDamageToDamagePercent: 1,
      targetToDamagePercent: 0.2,
    }),
  });

  assert.equal(scorer(option(pool, "stat:STR"), 7), 7.7);
  assert.equal(scorer(option(pool, "stat:DEX"), 7), 15.4);
  assert.equal(scorer(option(pool, "stat:LUK"), 7), 23.099999999999998);
  assert.equal(scorer(option(pool, "stat:INT"), 7), 0);
  assert.equal(scorer(option(pool, "dual:STR+DEX"), 7), 12.600000000000001);
  assert.equal(scorer(option(pool, "attack"), 5), 2);
  assert.equal(scorer(option(pool, "magic"), 5), 0);
  assert.equal(scorer(option(pool, "allStat"), 5), 10);
  assert.equal(scorer(option(pool, "bossDamage"), 5), 10);
  assert.equal(scorer(option(pool, "damage"), 5), 5);
});

test("220·240·250레벨의 단일·이중 스탯 구간표를 적용한다", () => {
  const scoring = (itemLevel) => {
    const pool = buildAddOptionPool({ weapon: false, itemLevel });
    const scorer = createAddOptionScorer({
      itemLevel,
      attackType: "attack",
      addOptionEquivalence: directEquivalence({
        flatStatToDamagePercent: {
          STR: 1,
          DEX: 1,
          INT: 0,
          LUK: 0,
          HP: 0,
        },
        flatAttackToDamagePercent: 0,
        allStatPercentToDamagePercent: 0,
        targetToDamagePercent: 1,
      }),
    });
    return {
      single: scorer(option(pool, "stat:STR"), 1),
      dual: scorer(option(pool, "dual:STR+DEX"), 1),
    };
  };

  assert.deepEqual(scoring(220), { single: 11, dual: 12 });
  assert.deepEqual(scoring(240), { single: 12, dual: 12 });
  assert.deepEqual(scoring(250), { single: 12, dual: 14 });
});

test("데몬어벤져 직접 계수는 최대 HP 추옵을 실제 HP 수치로 환산한다", () => {
  const pool = buildAddOptionPool({ weapon: false, itemLevel: 200 });
  const scorer = createAddOptionScorer({
    itemLevel: 200,
    attackType: "attack",
    addOptionEquivalence: directEquivalence({
      model: "demon-avenger",
      flatStatToDamagePercent: {
        STR: 0.02,
        DEX: 0,
        INT: 0,
        LUK: 0,
        HP: 0.001,
      },
      flatAttackToDamagePercent: 0.5,
      allStatPercentToDamagePercent: 0.03,
      bossDamageToDamagePercent: 1,
      targetToDamagePercent: 0.001,
    }),
  });

  assert.equal(option(pool, "maxHp").kind, "maxHp");
  assert.equal(scorer(option(pool, "maxHp"), 7), 4.2);
  assert.equal(scorer(option(pool, "stat:STR"), 7), 1.54);
  assert.equal(scorer(option(pool, "stat:DEX"), 7), 0);
});

test("직접 계수의 일반 직업 어댑터는 기존 방어구 확률을 보존한다", () => {
  const common = {
    tables: ADD_OPTION_TABLES_SNAPSHOT,
    itemLevel: 200,
    boss: true,
    target: 120,
    mainStat: "STR",
    subStat: "DEX",
    attackType: "attack",
  };
  const legacy = calculateArmorAddOption({
    ...common,
    statEquivalence: standardEquivalence,
  });
  const direct = calculateArmorAddOption({
    ...common,
    addOptionEquivalence: directEquivalence(),
  });

  assert.deepEqual(
    direct.sources.map(({ probability }) => probability),
    legacy.sources.map(({ probability }) => probability),
  );
});

test("직접 계수의 일반 직업 어댑터는 기존 무기 확률을 보존한다", () => {
  const common = {
    tables: ADD_OPTION_TABLES_SNAPSHOT,
    itemLevel: 200,
    boss: true,
    tier: 2,
    damagePercent: 10,
    mainStat: "STR",
    subStat: "DEX",
    attackType: "attack",
  };
  const legacy = calculateWeaponAddOption({
    ...common,
    statEquivalence: standardEquivalence,
  });
  const direct = calculateWeaponAddOption({
    ...common,
    addOptionEquivalence: directEquivalence(),
  });

  assert.deepEqual(
    direct.sources.map(({ probability }) => probability),
    legacy.sources.map(({ probability }) => probability),
  );
});

test("무기 종합 환산 기댓값은 다른 추 등급의 동급 이상 조합도 포함한다", () => {
  const common = {
    tables: ADD_OPTION_TABLES_SNAPSHOT,
    itemLevel: 250,
    boss: true,
    tier: 2,
    damagePercent: 18.9,
    baseAttack: 400,
    mainStat: "STR",
    subStat: "DEX",
    attackType: "attack",
    addOptionEquivalence: directEquivalence(),
  };
  const exactTier = calculateWeaponAddOption(common);
  const equivalent = calculateWeaponEquivalentAddOption(common);
  const exactBlack = exactTier.sources.find(({ key }) => key === "black");
  const equivalentBlack = equivalent.sources.find(({ key }) => key === "black");

  assert.equal(getWeaponAddOptionAttack({
    baseAttack: 400,
    itemLevel: 250,
    stage: 6,
    boss: true,
  }), 224);
  assert.equal(equivalent.mode, "weapon-equivalent");
  assert.equal(equivalent.currentAttack, 224);
  assert.ok(equivalentBlack.rawProbability > exactBlack.rawProbability);
  assert.ok(equivalentBlack.expectedMeso < exactBlack.expectedMeso);
});

test("공마 추 등급을 모르는 아케인 무기도 전체 추옵 점수로 계산한다", () => {
  const result = calculateWeaponScoreAddOption({
    tables: ADD_OPTION_TABLES_SNAPSHOT,
    itemLevel: 200,
    boss: true,
    target: 120,
    mainStat: "STR",
    subStat: "DEX",
    attackType: "attack",
    addOptionEquivalence: directEquivalence(),
  });
  const black = result.sources.find(({ key }) => key === "black");

  assert.equal(result.mode, "weapon-score");
  assert.ok(black.rawProbability > 0);
  assert.ok(black.probability >= black.rawProbability);
  assert.ok(Number.isFinite(black.expectedMeso));
  assert.equal(black.sameResultExcluded, true);
});

test("HP가 유효한 데몬어벤져만 HP급 목표에 도달할 수 있다", () => {
  const common = {
    tables: ADD_OPTION_TABLES_SNAPSHOT,
    itemLevel: 200,
    boss: true,
    target: 4_200,
    mainStat: "HP",
    subStat: "STR",
    attackType: "attack",
  };
  const enabled = calculateArmorAddOption({
    ...common,
    addOptionEquivalence: directEquivalence({
      model: "demon-avenger",
      flatStatToDamagePercent: {
        STR: 0,
        DEX: 0,
        INT: 0,
        LUK: 0,
        HP: 0.001,
      },
      flatAttackToDamagePercent: 0,
      allStatPercentToDamagePercent: 0,
      bossDamageToDamagePercent: 1,
      targetToDamagePercent: 0.001,
    }),
  });
  const disabled = calculateArmorAddOption({
    ...common,
    addOptionEquivalence: directEquivalence({
      model: "demon-avenger",
      flatStatToDamagePercent: {
        STR: 0,
        DEX: 0,
        INT: 0,
        LUK: 0,
        HP: 0,
      },
      flatAttackToDamagePercent: 0,
      allStatPercentToDamagePercent: 0,
      bossDamageToDamagePercent: 1,
      targetToDamagePercent: 0.001,
    }),
  });

  assert.ok(enabled.sources.some(({ probability }) => probability > 0));
  assert.ok(disabled.sources.every(({ probability }) => probability === 0));
});

test("직접 계수는 목표 1급 환산과 각 옵션 계수를 검증한다", () => {
  const common = {
    tables: ADD_OPTION_TABLES_SNAPSHOT,
    itemLevel: 200,
    target: 100,
    attackType: "attack",
  };
  assert.throws(
    () => calculateArmorAddOption({
      ...common,
      addOptionEquivalence: directEquivalence({
        targetToDamagePercent: 0,
      }),
    }),
    /목표 1급 환산값/,
  );
  assert.throws(
    () => calculateArmorAddOption({
      ...common,
      addOptionEquivalence: directEquivalence({
        flatStatToDamagePercent: { STR: -1 },
      }),
    }),
    /STR \+1 환산값/,
  );
});
