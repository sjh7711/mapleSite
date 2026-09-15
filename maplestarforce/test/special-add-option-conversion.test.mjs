import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
let temporaryDirectory;
let calculateSpecialAddOptionConversion;

before(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "special-add-option-test-"));
  const outfile = join(temporaryDirectory, "entry.mjs");
  await build({
    entryPoints: [
      join(PROJECT_ROOT, "functions/_lib/add-option-conversion.ts"),
    ],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent",
  });
  ({ calculateSpecialAddOptionConversion } = await import(
    pathToFileURL(outfile).href
  ));
});

after(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

function emptySnapshot(finalStats) {
  return {
    statData: {
      final_stat: Object.entries(finalStats).map(([stat_name, stat_value]) => ({
        stat_name,
        stat_value: String(stat_value),
      })),
    },
    equipmentData: { item_equipment: [] },
    setEffectData: { set_effect: [] },
    otherStatData: { other_stat: [] },
    linkSkillData: { character_link_skill: [] },
    skillData: [],
    symbolData: { symbol: [] },
    hyperStatData: { use_preset_no: "1", hyper_stat_preset_1: [] },
    hexaStatData: {
      character_hexa_stat_core: [],
      character_hexa_stat_core_2: [],
      character_hexa_stat_core_3: [],
    },
    abilityData: { ability_info: [] },
    unionRaiderData: {
      union_raider_stat: [],
      union_occupied_stat: [],
      union_state_stat: [],
    },
    unionArtifactData: { union_artifact_effect: [] },
  };
}

test("제논은 STR·DEX·LUK를 모두 쓰고 INT·HP·마력은 제외한다", () => {
  const result = calculateSpecialAddOptionConversion({
    character: { character_class: "제논" },
    snapshot: emptySnapshot({
      STR: 1_000,
      DEX: 1_000,
      LUK: 1_000,
      공격력: 1_000,
      데미지: 100,
      "보스 몬스터 데미지": 200,
    }),
    statModel: "xenon",
    doping: null,
  });

  assert.equal(result.details.mode, "character-dynamic");
  assert.ok(result.flatStatToDamagePercent.STR > 0);
  assert.ok(result.flatStatToDamagePercent.DEX > 0);
  assert.ok(result.flatStatToDamagePercent.LUK > 0);
  assert.equal(result.flatStatToDamagePercent.INT, 0);
  assert.equal(result.flatStatToDamagePercent.HP, 0);
  assert.ok(result.allStatPercentToDamagePercent > 0);
  assert.ok(result.flatAttackToDamagePercent > 0);
  assert.ok(Math.abs(
    result.targetToDamagePercent - result.flatStatToDamagePercent.STR
  ) < 1e-12);
});

test("제논도 공통 기준·공용 스킬·직업 스킬·대상 효과 파이프라인을 쓴다", () => {
  const snapshot = emptySnapshot({
    STR: 1_000,
    DEX: 1_000,
    LUK: 1_000,
    공격력: 1_000,
    데미지: 100,
    "보스 몬스터 데미지": 200,
    "방어율 무시": 90,
    "크리티컬 데미지": 50,
  });
  snapshot.skillData = [{
    character_skill: [
      {
        skill_name: "영구 패시브",
        skill_effect: "영구적으로 크리티컬 데미지 50% 증가",
      },
      {
        skill_name: "오라 웨폰",
        skill_effect:
          "130초 동안 몬스터 방어율 무시 16%, 최종 데미지 6% 증가\n" +
          "재사용 대기시간 120초",
      },
      {
        skill_name: "오펜시브 매트릭스",
        skill_effect: "공격 시 적의 방어율 무시 30% 증가",
      },
      {
        skill_name: "방어구 분쇄",
        skill_effect:
          "공격 시 20초 동안 대상의 방어율 10%만큼 감소, 최대 5번 중첩",
      },
    ],
  }];

  const result = calculateSpecialAddOptionConversion({
    character: { character_class: "제논" },
    snapshot,
    statModel: "xenon",
    doping: { totals: { combatDurationSeconds: 360 } },
  });

  assert.equal(result.details.targetDefenseRemaining, 0.5);
  assert.equal(result.details.combatModel.basis, "nexon-final-stat");
  assert.ok(result.details.combatModel.effects.some(
    (effect) => effect.source === "영구 패시브" && !effect.applied,
  ));
  assert.ok(result.details.combatModel.effects.some(
    (effect) => effect.source === "오라 웨폰" && effect.applied,
  ));
  assert.ok(result.details.combatModel.effects.some(
    (effect) => effect.source === "오펜시브 매트릭스" && effect.applied &&
      effect.averagedModifiers.ignoreDefenseSources[0] === 30,
  ));
});

test("제논은 선택한 장비·하이퍼·유니온·링크·어빌리티 delta를 active 스냅샷에서 재구성한다", () => {
  const active = emptySnapshot({
    STR: 10_000,
    DEX: 10_000,
    LUK: 10_000,
    공격력: 2_000,
    데미지: 100,
    "보스 몬스터 데미지": 200,
    "상태이상 추가 데미지": 0,
  });
  active.equipmentData = {
    preset_no: 1,
    item_equipment: [
      {
        item_equipment_slot: "무기",
        item_total_option: {
          str: "100",
          dex: "100",
          luk: "100",
          attack_power: "100",
          damage: "10",
          boss_damage: "0",
        },
        potential_option_1: "STR +10%",
      },
    ],
  };
  active.hyperStatData = {
    use_preset_no: "1",
    hyper_stat_preset_1: [
      { stat_type: "STR", stat_increase: "STR 10 증가" },
    ],
  };
  active.unionRaiderData = {
    use_preset_no: 1,
    union_state_stat: ["STR 10 증가"],
  };
  active.linkSkillData = {
    character_link_skill: [
      { skill_effect: "STR 10 증가" },
    ],
  };
  active.abilityData = {
    preset_no: 1,
    ability_info: [{ ability_value: "STR 10 증가" }],
  };

  const selected = structuredClone(active);
  selected.equipmentData = {
    preset_no: 2,
    item_equipment: [
      {
        item_equipment_slot: "무기",
        item_total_option: {
          str: "200",
          dex: "200",
          luk: "200",
          attack_power: "200",
          damage: "30",
          boss_damage: "30",
        },
        potential_option_1: "STR +20%",
      },
    ],
  };
  selected.hyperStatData = {
    use_preset_no: "2",
    hyper_stat_preset_2: [
      { stat_type: "DEX", stat_increase: "DEX 20 증가" },
      {
        stat_type: "보스 몬스터 공격 시 데미지 증가",
        stat_increase: "보스 몬스터 공격 시 데미지 10% 증가",
      },
    ],
  };
  selected.unionRaiderData = {
    use_preset_no: 2,
    union_state_stat: [
      "LUK 30 증가",
      "보스 몬스터 공격 시 데미지 20% 증가",
    ],
  };
  selected.linkSkillData = {
    character_link_skill: [
      { skill_effect: "STR 20 증가, 데미지 10% 증가" },
    ],
  };
  selected.abilityData = {
    preset_no: 2,
    ability_info: [
      { ability_value: "DEX 20 증가" },
      { ability_value: "보스 몬스터 공격 시 데미지 20% 증가" },
    ],
  };

  const baseline = calculateSpecialAddOptionConversion({
    character: { character_class: "제논", character_level: 280 },
    snapshot: active,
    statModel: "xenon",
    doping: null,
  });
  const result = calculateSpecialAddOptionConversion({
    character: { character_class: "제논", character_level: 280 },
    snapshot: selected,
    activeSnapshot: active,
    presetSelection: {
      mode: "manual",
      selected: { equipment: 2, hyper: 2, union: 2, link: 2, ability: 2 },
    },
    statModel: "xenon",
    doping: null,
  });

  assert.equal(result.details.activeHyperStatPreset, "1");
  assert.equal(result.details.selectedHyperStatPreset, "2");
  assert.equal(result.details.activeUnionPreset, 1);
  assert.equal(result.details.selectedUnionPreset, 2);
  assert.equal(result.details.presetSelection.mode, "manual");
  assert.ok(result.details.current.STR > baseline.details.current.STR);
  assert.ok(result.details.current.DEX > baseline.details.current.DEX);
  assert.ok(result.details.current.LUK > baseline.details.current.LUK);
  assert.ok(result.details.rawAttack > baseline.details.rawAttack);
  assert.ok(result.details.damageTotal > baseline.details.damageTotal);
  assert.equal(
    result.details.damageTotal - baseline.details.damageTotal,
    110,
  );
});

test("데몬어벤져는 API HP 상한과 무관한 하나의 관행 추옵 점수만 쓴다", () => {
  const result = calculateSpecialAddOptionConversion({
    character: { character_class: "데몬어벤져" },
    snapshot: emptySnapshot({
      HP: 500_000,
      STR: 9_999,
      공격력: 4_000,
      "최대 스탯공격력": 99_999_999,
      데미지: 100,
      "보스 몬스터 데미지": 300,
      "최종 데미지": 50,
    }),
    statModel: "demon-avenger",
    doping: { totals: { hp: 99_999, hpPercent: 99 } },
  });

  assert.equal(result.details.mode, "conventional-fallback");
  assert.equal(result.flatStatToDamagePercent.HP * 35, 1);
  assert.equal(result.flatStatToDamagePercent.STR, 0.25);
  assert.equal(result.flatAttackToDamagePercent, 4);
  assert.equal(result.allStatPercentToDamagePercent, 0);
  assert.equal(result.targetToDamagePercent, 1);
});

test("잠재능력 화면은 특수 직업 추옵 프로필을 %급 환산에 쓰지 않는다", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(join(PROJECT_ROOT, "src/shared/potential-page.js"), "utf8"),
  );
  assert.match(
    source,
    /getActiveProfile\(\{ capability: "potentialEquivalence" \}\)/,
  );
  assert.match(
    source,
    /getCalculationProfile\([\s\S]*?\{ capability: "potentialEquivalence" \}\)/,
  );
});
