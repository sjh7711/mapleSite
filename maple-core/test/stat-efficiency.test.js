import test from "node:test";
import assert from "node:assert/strict";
import { FULL_BOSS_DOPING } from "maple-core/stat-profile";
import {
  boostCoreIgnoreDefenseChannels,
  calculateDamageChannelIgnoreDefenseGain,
  composeCombatModel,
  createCombatEffect,
  generalizedBattlePracticeDamageChannelsFromSkills,
  skillLocalIgnoreDefenseChannelsFromSkills,
  targetDefenseEffectsFromSkills,
} from "maple-core/combat-model";
import {
  calculateActiveSkillCycleBonuses,
  calculateCombatRingBonuses,
  calculateCharacterPotentialConversion,
  calculateIgnoreDefenseEquivalent,
  resolveClassDamageChannels,
  resolveCharacterExternalBonuses,
  resolveCharacterPresetSnapshot,
} from "maple-core/stat-efficiency";

function statData(values) {
  return {
    final_stat: Object.entries(values).map(([stat_name, stat_value]) => ({
      stat_name,
      stat_value: String(stat_value),
    })),
  };
}

test("세트·캐시·펫·마스터라벨 플러스 구성요소를 모두 해석한다", () => {
  const external = resolveCharacterExternalBonuses({
    attackType: "attack",
    presetMode: "auto",
    cashEquipmentData: {
      cash_item_equipment_base: [{
        cash_item_option: [
          { option_type: "STR", option_value: "30" },
          { option_type: "공격력", option_value: "15" },
        ],
      }],
    },
    petEquipmentData: {
      pet_activate_flag: "1",
      world_share_pet_1_equipment_preset_no: 1,
      world_share_pet_2_equipment_preset_no: 1,
      world_share_pet_3_equipment_preset_no: 1,
      world_share_pet_1_equipment: {
        item_option: [{ option_type: "공격력", option_value: "10" }],
      },
      world_share_pet_2_equipment: { item_option: [] },
      world_share_pet_3_equipment: { item_option: [] },
      world_share_pet_equipment_preset: [
        { preset_no: 1, slot_no: 1, item_option: [{ option_type: "공격력", option_value: "10" }] },
        { preset_no: 2, slot_no: 1, item_option: [{ option_type: "공격력", option_value: "44" }] },
      ],
      petite_luna_pet_skill: [
        { skill_effect: "[패시브 효과 : 공격력 15, 마력 15 증가]" },
        { skill_effect: "공격력 30, 마력 30 증가" },
      ],
    },
    otherStatData: {
      other_stat: [{ stat_info: [
        { stat_name: "올스탯", stat_value: "140" },
        { stat_name: "공격력", stat_value: "60" },
      ] }],
    },
    setEffectData: {
      set_effect: [{ set_effect_info: [{
        set_option: "올스탯 +20, 최대 HP +500, 공격력 +20, 마력 +20, 보스 몬스터 데미지 +15%, 몬스터 방어율 무시 +10%, 크리티컬 데미지 +5%",
      }] }],
    },
  });

  assert.equal(external.cash.flat.STR, 30);
  assert.equal(external.cash.flatAttack, 15);
  assert.equal(external.pet.active.flatAttack, 10);
  assert.equal(external.pet.selected.flatAttack, 44);
  assert.equal(external.pet.selectedPreset, 2);
  assert.equal(external.pet.skills.flatAttack, 45);
  assert.equal(external.otherStat.flat.STR, 140);
  assert.equal(external.otherStat.flatAttack, 60);
  assert.equal(external.setEffect.flat.STR, 20);
  assert.equal(external.setEffect.flatHp, 500);
  assert.equal(external.setEffect.flatAttack, 20);
  assert.equal(external.setEffect.bossDamage, 15);
  assert.equal(external.setEffect.criticalDamage, 5);
  assert.deepEqual(external.setEffect.ignoreDefenseSources, [10]);
});

test("장비 프리셋 변경 시 알려진 세트의 적용 단계를 다시 계산한다", () => {
  const active = [
    { item_equipment_slot: "반지1", item_name: "여명의 가디언 엔젤 링", item_total_option: { str: "10" } },
    { item_equipment_slot: "펜던트", item_name: "데이브레이크 펜던트", item_total_option: { str: "10" } },
  ];
  const farming = [
    { item_equipment_slot: "반지1", item_name: "여명의 가디언 엔젤 링", item_total_option: { str: "1000" } },
  ];
  const resolved = resolveCharacterPresetSnapshot({
    characterClass: "히어로",
    characterLevel: 280,
    mainStat: "STR",
    subStats: ["DEX"],
    attackType: "attack",
    equipmentData: {
      preset_no: 1,
      item_equipment: active,
      item_equipment_preset_1: active,
      item_equipment_preset_2: farming,
    },
    setEffectData: {
      set_effect: [{
        set_name: "여명의 보스 세트",
        total_set_count: 2,
        set_effect_info: [{ set_count: 2, set_option: "올스탯 +10" }],
        set_option_full: [
          { set_count: 2, set_option: "올스탯 +10" },
          { set_count: 3, set_option: "공격력 +10" },
        ],
      }],
    },
    presetPolicy: { mode: "auto" },
  });

  assert.equal(resolved.selection.selected.equipment, 2);
  assert.equal(
    resolved.selectedSnapshot.setEffectData.set_effect[0].total_set_count,
    1,
  );
  assert.deepEqual(
    resolved.selectedSnapshot.setEffectData.set_effect[0].set_effect_info,
    [],
  );
  assert.deepEqual(
    resolved.selectedSnapshot.setEffectResolution.adjustedSets,
    [{ setName: "여명의 보스 세트", activeCount: 2, selectedCount: 1 }],
  );
});

test("API 장비와 최종 스탯에서 풀도핑 개인 효율을 계산한다", () => {
  const result = calculateCharacterPotentialConversion({
    character: { character_level: 270 },
    mainStat: "STR",
    subStat: "DEX",
    attackType: "attack",
    doping: FULL_BOSS_DOPING,
    statData: statData({
      STR: 10_000,
      DEX: 2_500,
      공격력: 2_000,
      "크리티컬 데미지": 80,
      "AP 배분 STR": 1_000,
      "AP 배분 DEX": 4,
    }),
    equipmentData: {
      item_equipment: [
        {
          item_total_option: { str: "1000", dex: "500" },
          potential_option_1: "STR +100%",
          potential_option_2: "DEX +50%",
          additional_potential_option_1: "공격력 +50%",
          additional_potential_option_2: "STR +10",
          additional_potential_option_3: "DEX +5",
        },
      ],
    },
    setEffectData: { set_effect: [] },
  });

  const equivalence = result.statEquivalence;
  assert.ok(
    Math.abs(equivalence.flatMainStatToPercent - 200 / (2160 + 75)) < 1e-12,
  );
  assert.ok(
    Math.abs(
      equivalence.allStatPercentToMainPercent -
        (1 + (509.6 + 75) / (4 * (2160 + 75))),
    ) < 1e-12,
  );
  assert.ok(equivalence.attackToMainStat > 3);
  assert.ok(equivalence.criticalDamageToMainPercent * 3 > 5);
});

test("이중 부스탯을 각각 역산하고 4×LUK + DEX + STR로 환산한다", () => {
  const result = calculateCharacterPotentialConversion({
    character: { character_level: 280, character_class: "섀도어" },
    mainStat: "LUK",
    subStat: "DEX",
    subStats: ["DEX", "STR"],
    attackType: "attack",
    doping: FULL_BOSS_DOPING,
    statData: statData({
      LUK: 10_000,
      DEX: 2_000,
      STR: 1_000,
      공격력: 2_000,
      "크리티컬 데미지": 80,
      "AP 배분 LUK": 1_000,
      "AP 배분 DEX": 4,
      "AP 배분 STR": 4,
    }),
    equipmentData: {
      item_equipment: [
        {
          item_total_option: { luk: "1000", dex: "500", str: "250" },
          potential_option_1: "LUK +100%",
          potential_option_2: "DEX +50%",
          potential_option_3: "STR +20%",
        },
      ],
    },
    setEffectData: { set_effect: [] },
    symbolData: {
      symbol: [{ symbol_luk: "200", symbol_dex: "50", symbol_str: "100" }],
    },
    hyperStatData: {
      use_preset_no: "1",
      hyper_stat_preset_1: [
        { stat_type: "LUK", stat_increase: "운 30 증가" },
        { stat_type: "DEX", stat_increase: "민첩 10 증가" },
        { stat_type: "STR", stat_increase: "힘 20 증가" },
      ],
    },
    hexaStatData: {},
    abilityData: {
      ability_info: [
        { ability_value: "LUK 11 증가, DEX 7 증가, STR 9 증가" },
      ],
    },
  });

  assert.deepEqual(result.details.subStats, ["DEX", "STR"]);
  assert.deepEqual(result.details.unreflectedSubs, { DEX: 67, STR: 129 });
  assert.deepEqual(result.details.baseSubs, { DEX: 1289, STR: 726 });
  assert.deepEqual(result.details.dopedBaseSubs, { DEX: 1364, STR: 801 });
  assert.deepEqual(result.details.dopedSubs, { DEX: 2112, STR: 1090 });

  const equivalence = result.statEquivalence;
  assert.deepEqual(equivalence.flatStatToFlatMainStatByStat, {
    LUK: 1,
    DEX: 0.1875,
    STR: 0.15,
  });
  assert.equal(
    equivalence.flatSubStatToFlatMainStat,
    equivalence.flatStatToFlatMainStatByStat.DEX,
  );
  assert.ok(
    Math.abs(
      equivalence.statPercentToMainPercentByStat.DEX -
        1364 / (4 * 4955),
    ) < 1e-15,
  );
  assert.ok(
    Math.abs(
      equivalence.statPercentToMainPercentByStat.STR -
        801 / (4 * 4955),
    ) < 1e-15,
  );
  assert.ok(
    Math.abs(
      equivalence.allStatPercentToMainPercent -
        (1 + 1364 / (4 * 4955) + 801 / (4 * 4955)),
    ) < 1e-15,
  );
  assert.equal(
    equivalence.subStatPercentToMainPercent,
    equivalence.statPercentToMainPercentByStat.DEX,
  );
  assert.deepEqual(equivalence.unreflectedStatToPercentByStat, {
    LUK: 100 / 4955,
    DEX: 25 / 4955,
    STR: 25 / 4955,
  });
});

test("이중 부스탯 잠재도 보스 장비 프리셋 선택에 반영한다", () => {
  const equipmentData = {
    item_equipment: [
      { item_total_option: { luk: "1000", dex: "500", str: "250" } },
    ],
    item_equipment_preset_1: [
      {
        item_total_option: { luk: "1000", dex: "500", str: "250" },
        potential_option_1: "STR +100%",
      },
    ],
  };
  const input = {
    character: { character_level: 280 },
    mainStat: "LUK",
    subStat: "DEX",
    attackType: "attack",
    doping: null,
    statData: statData({
      LUK: 10_000,
      DEX: 2_000,
      STR: 1_000,
      공격력: 2_000,
      "크리티컬 데미지": 80,
      "AP 배분 LUK": 1_000,
      "AP 배분 DEX": 4,
      "AP 배분 STR": 4,
    }),
    equipmentData,
    setEffectData: { set_effect: [] },
  };

  assert.equal(
    calculateCharacterPotentialConversion({
      ...input,
      subStats: ["DEX", "STR"],
    }).details.selectedEquipmentPreset,
    1,
  );
  assert.equal(
    calculateCharacterPotentialConversion(input).details.selectedEquipmentPreset,
    null,
  );
});

test("active·manual 정책으로 장비·하이퍼·유니온·링크·어빌리티를 함께 해석한다", () => {
  const equipment1 = [
    {
      item_equipment_slot: "모자",
      item_name: "1번 모자",
      item_total_option: { str: "100" },
      potential_option_1: "STR +10%",
    },
  ];
  const equipment2 = [
    {
      item_equipment_slot: "모자",
      item_name: "2번 모자",
      item_total_option: { str: "200" },
      potential_option_1: "STR +20%",
    },
  ];
  const input = {
    mainStat: "STR",
    subStats: ["DEX"],
    attackType: "attack",
    characterLevel: 280,
    equipmentData: {
      preset_no: 1,
      item_equipment: equipment1,
      item_equipment_preset_1: equipment1,
      item_equipment_preset_2: equipment2,
      title_preset1: { title_name: "1번 칭호" },
      title_preset2: { title_name: "2번 칭호" },
    },
    hyperStatData: {
      use_preset_no: "1",
      hyper_stat_preset_1: [{ stat_type: "STR", stat_increase: "힘 10 증가" }],
      hyper_stat_preset_2: [{ stat_type: "STR", stat_increase: "힘 20 증가" }],
    },
    unionRaiderData: {
      use_preset_no: 1,
      union_state_stat: ["STR 10 증가"],
      union_state_stat_preset: [
        { preset_no: 1, union_state_stat: ["STR 10 증가"] },
        { preset_no: 2, union_state_stat: ["보스 몬스터 공격 시 데미지 40% 증가"] },
        { preset_no: 7, union_state_stat: [] },
      ],
    },
    linkSkillData: {
      character_link_skill: [{ skill_name: "링크1", skill_level: 1, skill_effect: "STR 10 증가" }],
      character_link_skill_preset_1: [{ skill_name: "링크1", skill_level: 1, skill_effect: "STR 10 증가" }],
      character_link_skill_preset_2: [{ skill_name: "링크2", skill_level: 1, skill_effect: "데미지 10% 증가" }],
    },
    abilityData: {
      preset_no: 1,
      ability_info: [{ ability_value: "STR 10 증가" }],
      ability_preset_1: { ability_info: [{ ability_value: "STR 10 증가" }] },
      ability_preset_2: { ability_info: [{ ability_value: "보스 몬스터 공격 시 데미지 20% 증가" }] },
    },
  };

  const active = resolveCharacterPresetSnapshot({
    ...input,
    presetPolicy: { mode: "active" },
  });
  assert.deepEqual(active.selection.active, {
    equipment: 1,
    hyper: 1,
    union: 1,
    link: 1,
    ability: 1,
  });
  assert.deepEqual(active.selection.selected, active.selection.active);
  assert.deepEqual(active.selection.available.union, [1, 2]);

  const manual = resolveCharacterPresetSnapshot({
    ...input,
    presetPolicy: {
      mode: "manual",
      manual: { equipment: 2, hyper: 2, union: 2, link: 2, ability: 2 },
    },
  });
  assert.deepEqual(manual.selection.selected, {
    equipment: 2,
    hyper: 2,
    union: 2,
    link: 2,
    ability: 2,
  });
  assert.equal(
    manual.selectedSnapshot.equipmentData.item_equipment[0].item_name,
    "2번 모자",
  );
  assert.equal(manual.selectedSnapshot.hyperStatData.use_preset_no, "2");
  assert.deepEqual(manual.selectedSnapshot.unionRaiderData.union_state_stat, [
    "보스 몬스터 공격 시 데미지 40% 증가",
  ]);
  assert.equal(
    manual.selectedSnapshot.linkSkillData.character_link_skill[0].skill_name,
    "링크2",
  );
  assert.equal(
    manual.selectedSnapshot.abilityData.ability_info[0].ability_value,
    "보스 몬스터 공격 시 데미지 20% 증가",
  );
  assert.deepEqual(manual.selection.source, {
    equipment: "manual",
    hyper: "manual",
    union: "manual",
    link: "manual",
    ability: "manual",
  });

  const nestedTitle = resolveCharacterPresetSnapshot({
    ...input,
    equipmentData: {
      ...input.equipmentData,
      title_preset1: undefined,
      title_preset2: undefined,
      title: {
        title_preset_1: { title_name: "중첩 1번 칭호" },
        title_preset_2: { title_name: "중첩 2번 칭호" },
      },
    },
    presetPolicy: {
      mode: "manual",
      manual: { equipment: 2, hyper: 2, union: 2, link: 2, ability: 2 },
    },
  });
  assert.equal(
    nestedTitle.selectedSnapshot.equipmentData.title.title_name,
    "중첩 2번 칭호",
  );
});

test("자동 보스 프리셋은 380 방어율 대상의 전체 피해로 조합을 고른다", () => {
  const neutral = [
    { preset_no: 1, union_state_stat: ["STR 10 증가"] },
    { preset_no: 2, union_state_stat: ["몬스터 방어율 무시 40% 증가"] },
    { preset_no: 3, union_state_stat: ["보스 몬스터 공격 시 데미지 20% 증가"] },
  ];
  const result = resolveCharacterPresetSnapshot({
    mainStat: "STR",
    subStats: ["DEX"],
    attackType: "attack",
    characterLevel: 290,
    statData: statData({
      STR: 50_000,
      DEX: 5_000,
      공격력: 5_000,
      데미지: 100,
      "보스 몬스터 데미지": 500,
      "크리티컬 확률": 100,
      "크리티컬 데미지": 100,
      "방어율 무시": 99.5,
    }),
    unionRaiderData: {
      use_preset_no: 1,
      union_state_stat: neutral[0].union_state_stat,
      union_state_stat_preset: neutral,
    },
    presetPolicy: { mode: "auto" },
  });

  assert.equal(result.selection.selected.union, 3);
  assert.equal(result.selection.source.union, "auto-joint-damage");
});

test("어빌리티 프리셋 변경 시 상태이상 데미지를 active 기준 delta로 바꾼다", () => {
  const equipment = [
    {
      item_equipment_slot: "모자",
      item_total_option: { str: "100", dex: "50", attack_power: "100" },
    },
  ];
  const common = {
    character: { character_level: 280 },
    mainStat: "STR",
    subStat: "DEX",
    attackType: "attack",
    doping: null,
    statData: statData({
      STR: 1_000,
      DEX: 250,
      공격력: 500,
      데미지: 0,
      "보스 몬스터 데미지": 0,
      "상태이상 추가 데미지": 8,
      "방어율 무시": 90,
      "크리티컬 데미지": 50,
      "AP 배분 STR": 500,
      "AP 배분 DEX": 4,
    }),
    equipmentData: {
      preset_no: 1,
      item_equipment: equipment,
      item_equipment_preset_1: equipment,
    },
    setEffectData: { set_effect: [] },
    hyperStatData: {
      use_preset_no: "1",
      hyper_stat_preset_1: [{ stat_type: "STR", stat_increase: "힘 1 증가" }],
    },
    unionRaiderData: {
      use_preset_no: 1,
      union_state_stat: ["STR 1 증가"],
      union_state_stat_preset: [
        { preset_no: 1, union_state_stat: ["STR 1 증가"] },
      ],
    },
    linkSkillData: {
      character_link_skill: [
        { skill_name: "기본 링크", skill_level: 1, skill_effect: "STR 1 증가" },
      ],
      character_link_skill_preset_1: [
        { skill_name: "기본 링크", skill_level: 1, skill_effect: "STR 1 증가" },
      ],
    },
    abilityData: {
      preset_no: 1,
      ability_info: [
        { ability_value: "상태 이상에 걸린 대상 공격 시 데미지 8% 증가" },
      ],
      ability_preset_1: {
        ability_info: [
          { ability_value: "상태 이상에 걸린 대상 공격 시 데미지 8% 증가" },
        ],
      },
      ability_preset_2: {
        ability_info: [{ ability_value: "아이템 드롭률 1% 증가" }],
      },
    },
    presetPolicy: {
      mode: "manual",
      manual: { equipment: 1, hyper: 1, union: 1, link: 1, ability: 2 },
    },
  };

  const removed = calculateCharacterPotentialConversion(common);
  assert.equal(removed.details.selectedAbilityPreset, 2);
  assert.equal(removed.details.currentConditionalDamage, 0);
  assert.equal(removed.details.dopedDamageTotal, 0);

  const active = calculateCharacterPotentialConversion({
    ...common,
    presetPolicy: { mode: "active" },
  });
  assert.equal(active.details.currentConditionalDamage, 8);
  assert.equal(active.details.dopedDamageTotal, 8);
});

test("장비와 칭호 프리셋의 데미지·보스 데미지를 active 기준으로 교체한다", () => {
  const activeItem = {
    item_equipment_slot: "모자",
    item_total_option: {
      str: "100",
      dex: "50",
      attack_power: "100",
      damage: "10",
      boss_damage: "20",
    },
  };
  const selectedItem = {
    ...activeItem,
    item_total_option: {
      ...activeItem.item_total_option,
      damage: "0",
      boss_damage: "0",
    },
  };
  const link = [
    { skill_name: "기본 링크", skill_level: 1, skill_effect: "STR 1 증가" },
  ];
  const result = calculateCharacterPotentialConversion({
    character: { character_level: 280 },
    mainStat: "STR",
    subStat: "DEX",
    attackType: "attack",
    doping: null,
    statData: statData({
      STR: 1_000,
      DEX: 250,
      공격력: 500,
      데미지: 15,
      "보스 몬스터 데미지": 26,
      "상태이상 추가 데미지": 0,
      "방어율 무시": 90,
      "크리티컬 데미지": 50,
      "AP 배분 STR": 500,
      "AP 배분 DEX": 4,
    }),
    equipmentData: {
      preset_no: 1,
      item_equipment: [activeItem],
      item_equipment_preset_1: [activeItem],
      item_equipment_preset_2: [selectedItem],
      title: {
        title_name: "전투 칭호",
        title_description:
          "데미지 +5%\n보스 몬스터 공격 시 데미지 +6%",
      },
      title_preset1: {
        title_name: "전투 칭호",
        title_description:
          "데미지 +5%\n보스 몬스터 공격 시 데미지 +6%",
      },
      title_preset2: { title_name: "효과 없는 칭호", title_description: "" },
    },
    setEffectData: { set_effect: [] },
    otherStatData: { other_stat: [] },
    linkSkillData: {
      character_link_skill: link,
      character_link_skill_preset_1: link,
    },
    skillData: [],
    symbolData: { symbol: [] },
    hyperStatData: {
      use_preset_no: "1",
      hyper_stat_preset_1: [{ stat_type: "STR", stat_increase: "힘 1 증가" }],
    },
    hexaStatData: {},
    abilityData: {
      preset_no: 1,
      ability_info: [{ ability_value: "STR 1 증가" }],
      ability_preset_1: { ability_info: [{ ability_value: "STR 1 증가" }] },
    },
    unionRaiderData: {
      use_preset_no: 1,
      union_state_stat: ["STR 1 증가"],
      union_state_stat_preset: [
        { preset_no: 1, union_state_stat: ["STR 1 증가"] },
      ],
    },
    unionArtifactData: {},
    presetPolicy: {
      mode: "manual",
      manual: { equipment: 2, hyper: 1, union: 1, link: 1, ability: 1 },
    },
  });

  assert.equal(result.details.selectedEquipmentPreset, 2);
  assert.equal(result.details.currentDamage, 0);
  assert.equal(result.details.currentBossDamage, 0);
  assert.equal(result.details.dopedDamageTotal, 0);
});

test("제논 자동 장비 프리셋은 STR·DEX·LUK를 합산해 비교한다", () => {
  const preset1 = [
    {
      item_equipment_slot: "모자",
      item_name: "STR 전용",
      item_total_option: { str: "100", dex: "100", luk: "100" },
      potential_option_1: "STR +100%",
    },
  ];
  const preset2 = [
    {
      item_equipment_slot: "모자",
      item_name: "제논 합스탯",
      item_total_option: { str: "100", dex: "100", luk: "100" },
      potential_option_1: "STR +50%",
      potential_option_2: "DEX +50%",
      potential_option_3: "LUK +50%",
    },
  ];
  const result = resolveCharacterPresetSnapshot({
    mainStat: "ALL",
    subStats: [],
    attackType: "attack",
    characterLevel: 280,
    equipmentData: {
      preset_no: 1,
      item_equipment: preset1,
      item_equipment_preset_1: preset1,
      item_equipment_preset_2: preset2,
    },
    presetPolicy: { mode: "auto" },
  });

  assert.equal(result.selection.active.equipment, 1);
  assert.equal(result.selection.selected.equipment, 2);
});

test("제논 동시 스탯과 공격력 문구를 자동 링크 프리셋 점수에 반영한다", () => {
  const link1 = [
    { skill_name: "단일 스탯", skill_level: 1, skill_effect: "STR 30 증가" },
  ];
  const combined = resolveCharacterPresetSnapshot({
    mainStat: "ALL",
    subStats: [],
    attackType: "attack",
    linkSkillData: {
      character_link_skill: link1,
      character_link_skill_preset_1: link1,
      character_link_skill_preset_2: [
        {
          skill_name: "합스탯",
          skill_level: 1,
          skill_effect: "STR, DEX, LUK 20 증가",
        },
      ],
    },
    presetPolicy: { mode: "auto" },
  });
  assert.equal(combined.selection.selected.link, 2);

  const attack = resolveCharacterPresetSnapshot({
    mainStat: "STR",
    subStats: ["DEX"],
    attackType: "attack",
    linkSkillData: {
      character_link_skill: link1,
      character_link_skill_preset_1: link1,
      character_link_skill_preset_2: [
        {
          skill_name: "공격 링크",
          skill_level: 1,
          skill_effect: "공격력과 마력 20 증가",
        },
      ],
    },
    presetPolicy: { mode: "auto" },
  });
  assert.equal(attack.selection.selected.link, 2);
});

test("9레벨당 스탯 에디셔널 옵션을 원스탯에 포함한다", () => {
  const result = calculateCharacterPotentialConversion({
    character: { character_level: 286 },
    mainStat: "INT",
    subStat: "LUK",
    attackType: "magic",
    doping: null,
    statData: statData({
      INT: 5_000,
      LUK: 1_000,
      마력: 1_000,
      "크리티컬 데미지": 50,
      "AP 배분 INT": 1_000,
      "AP 배분 LUK": 4,
    }),
    equipmentData: {
      item_equipment: [
        {
          item_total_option: { int: "100", luk: "100" },
          additional_potential_option_1: "캐릭터 기준 9레벨 당 INT +1",
        },
      ],
    },
    setEffectData: { set_effect: [] },
  });

  assert.equal(result.details.baseMain, 1_150 + 100 + 31);
});

test("추옵 올스탯과 칭호·기타 스탯·패시브 스킬을 모두 반영한다", () => {
  const result = calculateCharacterPotentialConversion({
    character: { character_level: 286 },
    mainStat: "INT",
    subStat: "LUK",
    attackType: "magic",
    doping: null,
    statData: statData({
      INT: 10_000,
      LUK: 2_000,
      마력: 2_000,
      데미지: 100,
      "보스 몬스터 데미지": 300,
      "방어율 무시": 96,
      "크리티컬 데미지": 80,
      "AP 배분 INT": 1_000,
      "AP 배분 LUK": 4,
    }),
    equipmentData: {
      title: { title_description: "올스탯 +20\n공격력/마력+10" },
      item_equipment: [
        {
          item_equipment_slot: "모자",
          item_total_option: { int: "100", luk: "50", all_stat: "10" },
          potential_option_1: "INT +20%",
          potential_option_2: "LUK +5%",
        },
        {
          item_equipment_slot: "예비 특수 반지",
          item_total_option: { int: "4", luk: "4" },
        },
      ],
    },
    setEffectData: { set_effect: [] },
    otherStatData: {
      other_stat: [
        {
          stat_info: [
            { stat_name: "INT", stat_value: "75" },
            { stat_name: "LUK", stat_value: "75" },
            { stat_name: "INT (+%)", stat_value: "25" },
          ],
        },
      ],
    },
    linkSkillData: { character_link_skill: [] },
    skillData: [
      {
        character_skill: [
          {
            skill_name: "피지컬 트레이닝",
            skill_description: "영구적으로 지력을 증가시킨다.",
            skill_effect: "지력 60 증가",
          },
          {
            skill_name: "연합의 의지",
            skill_description: "강한 힘을 발휘한다.",
            skill_effect: "영구적으로 힘 5, 민첩 5, 지능 5, 행운 5 증가",
          },
          {
            skill_name: "마스테리아의 용사",
            skill_description: "모든 능력치를 증가시킨다.",
            skill_effect:
              "MP 70 소비\n[패시브 효과 : AP를 직접 투자한 모든 능력치 16% 증가]",
          },
        ],
      },
    ],
  });

  assert.equal(result.details.baseMain, 1_160 + 100 + 20 + 75 + 65 + 4);
  assert.equal(result.details.baseSub, 4.64 + 50 + 20 + 75 + 5 + 4);
  assert.equal(result.details.mainPercent, 20 + 10 + 25);
  assert.equal(result.details.subPercent, 5 + 10);
  assert.equal(result.details.mapleWarriorPercent, 16);
  assert.equal(result.details.equipmentAllStatPercent, 10);
});

test("직업 구간 프로필이 없으면 리스트레인트 링을 시간 가동률로 대체한다", () => {
  const result = calculateCharacterPotentialConversion({
    character: { character_level: 286 },
    mainStat: "INT",
    subStat: "LUK",
    attackType: "magic",
    doping: FULL_BOSS_DOPING,
    statData: statData({
      INT: 10_000,
      LUK: 2_000,
      마력: 2_000,
      데미지: 100,
      "보스 몬스터 데미지": 300,
      "방어율 무시": 96,
      "크리티컬 데미지": 80,
      "AP 배분 INT": 1_000,
      "AP 배분 LUK": 4,
    }),
    equipmentData: {
      item_equipment: [
        {
          item_equipment_slot: "반지4",
          item_name: "리스트레인트 링",
          item_total_option: { int: "4", luk: "4" },
        },
      ],
    },
    setEffectData: { set_effect: [] },
    skillData: [
      {
        character_skill: [
          {
            skill_name: "리스트레인트 링",
            skill_effect:
              "15초 동안 자신의 공격력이 68%, 마력이 68% 증가, 재사용 대기시간 120초",
          },
        ],
      },
    ],
  });

  assert.equal(result.details.combatRingAttackPercent, 8.5);
  assert.equal(
    result.details.dopedAttackPercent,
    FULL_BOSS_DOPING.totals.attackMagicPercent + 8.5,
  );
});

test("리스트레인트 링은 구간 환산하고 컨티뉴어스 링은 상시 적용한다", () => {
  const result = calculateCombatRingBonuses(
    {
      item_equipment: [
        {
          item_equipment_slot: "반지4",
          item_name: "리스트레인트 링",
          special_ring_level: 4,
        },
        {
          item_equipment_slot: "예비 특수 반지",
          item_name: "컨티뉴어스 링",
          special_ring_level: 4,
        },
      ],
    },
    {
      special_ring_reserve_name: "컨티뉴어스 링",
      special_ring_reserve_level: 4,
    },
    [
      {
        character_skill: [
          {
            skill_name: "리스트레인트 링",
            skill_level: 4,
            skill_effect:
              "HP 600 소비, 15초 동안 자신의 공격력이 68%, 마력이 68% 증가, 재사용 대기시간 120초",
          },
          {
            skill_name: "컨티뉴어스 링",
            skill_level: 4,
            skill_effect:
              "컨티뉴어스 링 착용 시 120초 동안 준비, 준비를 마치면 스킬 사용 시 30초 동안 공격력 10%, 마력 10%, 보스 몬스터 공격 시 데미지 36% 증가",
          },
        ],
      },
    ],
    "attack",
    360,
  );

  assert.equal(result.applied.length, 2);
  assert.ok(Math.abs(result.attackPercent - (8.5 + 10)) < 1e-12);
  assert.ok(Math.abs(result.magicPercent - (8.5 + 10)) < 1e-12);
  assert.equal(result.bossDamage, 36);
  assert.equal(result.applied[1].uptime, 1);
  assert.equal(result.applied[1].activationMode, "boss-entry-maintained");
});

test("리스트레인트 링은 직업별 연무장 극딜 피해 비중으로 환산한다", () => {
  const result = calculateCombatRingBonuses(
    {
      item_equipment: [{
        item_equipment_slot: "반지1",
        item_name: "리스트레인트 링",
        special_ring_level: 4,
      }],
    },
    {},
    [],
    "attack",
    360,
    "렌",
  );

  const ring = result.applied[0];
  assert.equal(ring.activationMode, "battle-practice-damage-weighted");
  assert.equal(ring.timeUptime, 0.125);
  assert.ok(ring.damageCoverage > ring.timeUptime);
  assert.ok(ring.phaseProfileId.startsWith("렌-special-ring-"));
  assert.ok(Math.abs(result.attackPercent - 68 * ring.damageCoverage) < 1e-12);
});

test("스킬 API에 반지 스킬이 없어도 장착 레벨로 리레·컨티를 계산한다", () => {
  const result = calculateCombatRingBonuses(
    {
      item_equipment: [
        {
          item_equipment_slot: "반지4",
          item_name: "리스트레인트 링",
          special_ring_level: 6,
        },
        {
          item_equipment_slot: "예비 특수 반지",
          item_name: "컨티뉴어스 링",
          special_ring_level: 5,
        },
      ],
    },
    {},
    [],
    "magic",
    360,
  );

  assert.equal(result.applied.length, 2);
  assert.ok(Math.abs(result.magicPercent - (85 / 6 + 12)) < 1e-12);
  assert.ok(Math.abs(result.attackPercent - (85 / 6 + 12)) < 1e-12);
  assert.equal(result.bossDamage, 45);
  assert.deepEqual(
    result.applied.map((ring) => ring.source),
    ["current-level-table", "current-level-table"],
  );
});

test("웨폰퍼프 링은 주무기 기본 공격력·마력 중 높은 값으로 계산한다", () => {
  const result = calculateCombatRingBonuses(
    {
      item_equipment: [
        {
          item_equipment_slot: "무기",
          item_name: "테스트 무기",
          item_base_option: { attack_power: "280", magic_power: "320" },
        },
        {
          item_equipment_slot: "반지4",
          item_name: "웨폰퍼프 - D링",
          special_ring_level: 4,
        },
      ],
    },
    {},
    [
      {
        character_skill: [
          {
            skill_name: "웨폰퍼프 - D링",
            skill_level: 4,
            skill_effect:
              "HP 600 소비, 15초 동안 장착 중인 주무기 공격력의 260%만큼 DEX 증가, 재사용 대기시간 120초",
          },
        ],
      },
    ],
    "attack",
    360,
  );

  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].weaponBasePower, 320);
  assert.equal(result.applied[0].weaponPuffMultiplier, 260);
  assert.equal(result.applied[0].averageFlatStat, 104);
  assert.equal(result.flat.DEX, 104);
});

test("스킬 API에 반지 스킬이 없어도 웨폰퍼프 장착 레벨을 계산한다", () => {
  const result = calculateCombatRingBonuses(
    {
      item_equipment: [
        {
          item_equipment_slot: "무기",
          item_name: "테스트 무기",
          item_base_option: { attack_power: "320", magic_power: "280" },
        },
        {
          item_equipment_slot: "반지4",
          item_name: "웨폰퍼프 - S링",
          special_ring_level: 3,
        },
      ],
    },
    {},
    [],
    "attack",
    360,
  );

  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].weaponPuffMultiplier, 195);
  assert.equal(result.applied[0].duration, 13);
  assert.equal(result.applied[0].cooldown, 120);
  assert.ok(Math.abs(result.flat.STR - 67.6) < 1e-12);
});

test("레테 체인 커맨드는 강화 수치로 6분 가동률을 계산한다", () => {
  const result = calculateActiveSkillCycleBonuses(
    [
      {
        character_skill: [
          {
            skill_name: "체인 커맨드",
            skill_effect:
              "30초 동안 데미지 10% 증가\n" +
              "모든 오버로드 스킬의 최종 데미지 15% 증가\n" +
              "재사용 대기시간 120초",
          },
          {
            skill_name: "체인 커맨드 강화",
            skill_effect:
              "맹약 실체화 중 데미지 증가량 22%로 증가\n" +
              "오버로드 스킬의 최종 데미지 증가량 20%로 증가",
          },
        ],
      },
    ],
    "magic",
    360,
    { characterClass: "레테" },
  );

  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].name, "체인 커맨드");
  assert.equal(result.applied[0].enhancement, "체인 커맨드 강화");
  assert.equal(result.applied[0].finalDamage, 0);
  assert.equal(result.damage, 5.5);
});

test("아티팩트·챔피언 올스탯은 주스탯% 적용 대상으로 역산한다", () => {
  const result = calculateCharacterPotentialConversion({
    character: { character_level: 280 },
    mainStat: "STR",
    subStat: "DEX",
    attackType: "attack",
    doping: null,
    statData: statData({
      // (일반 기본 100 + 아티팩트·챔피언 250) × (1 + 100%)
      // + 유니온 공격대원 50 = 750
      STR: 750,
      DEX: 100,
      공격력: 500,
      데미지: 10,
      "보스 몬스터 데미지": 20,
      "방어율 무시": 50,
      "크리티컬 데미지": 30,
      "AP 배분 STR": 100,
      "AP 배분 DEX": 4,
    }),
    equipmentData: {
      preset_no: 1,
      item_equipment: [{ potential_option_1: "STR +100%" }],
    },
    setEffectData: { set_effect: [] },
    otherStatData: { other_stat: [] },
    linkSkillData: { character_link_skill: [] },
    skillData: [],
    symbolData: { symbol: [] },
    hyperStatData: { use_preset_no: "1", hyper_stat_preset_1: [] },
    hexaStatData: {},
    abilityData: { preset_no: 1, ability_info: [] },
    unionRaiderData: {
      use_preset_no: 1,
      union_raider_stat: ["STR 50 증가"],
      union_state_stat: [],
    },
    unionArtifactData: {
      union_artifact_effect: [{ name: "올스탯 150 증가" }],
    },
    unionChampionData: {
      champion_badge_total_info: [
        { stat: "올스탯 100, 최대 HP/MP 5000 증가" },
      ],
    },
    presetPolicy: { mode: "active" },
  });

  assert.equal(result.details.baseMain, 350);
  assert.equal(result.details.unionUnreflectedMain, 50);
});

test("5차·하이퍼 액티브의 직접 버프를 6분 가동률로 환산한다", () => {
  const result = calculateActiveSkillCycleBonuses(
    [
      {
        character_skill: [
          {
            skill_name: "메이플월드 여신의 축복",
            skill_effect:
              "60초 동안 메이플 용사로 증가된 모든 능력치의 400% 추가 증가, 데미지 20% 증가\n재사용 대기시간 120초",
          },
          {
            skill_name: "애로우 레인",
            skill_effect:
              "70초 동안 데미지 30% 증가\n재사용 대기시간 120초",
          },
          {
            skill_name: "퀴버 풀버스트",
            skill_effect:
              "40초 동안 최종 데미지 15%, 공격력 20% 증가\n재사용 대기시간 120초",
          },
          {
            skill_name: "에픽 어드벤쳐",
            skill_effect:
              "60초 동안 데미지 10% 증가\n재사용 대기시간 120초",
          },
          {
            skill_name: "프리퍼레이션",
            skill_effect:
              "40초 동안 공격력 50, 보스 몬스터 공격 시 데미지 20% 증가\n재사용 대기시간 120초",
          },
          {
            skill_name: "공격 스킬",
            skill_effect:
              "10명의 적을 500%의 데미지로 공격, 재사용 대기시간 10초",
          },
        ],
      },
    ],
    "attack",
    360,
    {
      apStats: { DEX: 1_468, STR: 4, INT: 4, LUK: 4 },
      mapleWarriorPercent: 16,
    },
  );

  assert.equal(result.applied.length, 5);
  assert.ok(Math.abs(result.baseFlat.DEX - 469.76) < 1e-10);
  assert.ok(Math.abs(result.damage - 32.5) < 1e-10);
  assert.ok(Math.abs(result.bossDamage - 20 / 3) < 1e-10);
  assert.ok(Math.abs(result.attackPercent - 20 / 3) < 1e-10);
  assert.ok(Math.abs(result.flatAttack - 50 / 3) < 1e-10);
  assert.equal(
    result.applied.find((skill) => skill.name === "퀴버 풀버스트")
      ?.finalDamage,
    15,
  );
});

test("전투 효과 모델은 기준 상태·공용 효과·직업 효과·대상 효과를 한 경로로 합성한다", () => {
  const result = composeCombatModel({
    baseline: {
      flatAttack: 1_000,
      attackPercent: 100,
      damage: 100,
      bossDamage: 300,
      criticalDamage: 80,
      ignoreDefense: 0.96,
    },
    effects: [
      createCombatEffect({
        layer: "general",
        source: "공통 도핑",
        modifiers: { flatAttack: 100, damage: 20, ignoreDefense: 20 },
      }),
      createCombatEffect({
        layer: "common-skill",
        source: "공용 스킬",
        uptime: 0.5,
        modifiers: { attackPercent: 20, criticalDamage: 10 },
      }),
      createCombatEffect({
        layer: "class-skill",
        source: "영구 패시브",
        includedInBaseline: true,
        modifiers: { criticalDamage: 50 },
      }),
      createCombatEffect({
        layer: "target",
        source: "방어율 감소",
        targetDefenseReduction: 50,
      }),
    ],
  });

  assert.equal(result.totals.flatAttack, 1_100);
  assert.equal(result.totals.attackPercent, 110);
  assert.equal(result.totals.criticalDamage, 85);
  assert.equal(result.totals.ignoreDefense, 0.968);
  assert.equal(result.targetDefenseRemaining, 0.5);
  assert.equal(result.effects[2].applied, false);
  assert.deepEqual(result.order, [
    "baseline",
    "general",
    "common-skill",
    "class-skill",
    "target",
  ]);
});

test("폼 전용 영구 패시브는 전투 비중으로, 공용 스킬 병렬 방무는 별도 효과로 반영한다", () => {
  const result = calculateActiveSkillCycleBonuses(
    [
      {
        character_skill: [
          {
            skill_name: "디바인 리어",
            skill_effect:
              "영구적으로 알파의 크리티컬 데미지 50% 증가\n" +
              "공격 시 15% 확률로 적에게 1초 간격으로 10초 동안 도트 데미지",
          },
          {
            skill_name: "오라 웨폰",
            skill_effect:
              "130초 동안 몬스터 방어율 무시 16%, 최종 데미지 6% 증가\n재사용 대기시간 120초",
          },
        ],
      },
    ],
    "attack",
    360,
    { characterClass: "제로" },
  );

  assert.deepEqual(result.baselineReflected, []);
  assert.equal(result.criticalDamage, 25);
  assert.deepEqual(result.ignoreDefenseSources, [16]);
  assert.equal(result.applied[0].name, "디바인 리어");
  assert.equal(result.applied[0].model, "dual-form-weighted-permanent");
  assert.equal(result.applied[0].uptime, 0.5);
  assert.equal(result.applied[1].name, "오라 웨폰");
  assert.equal(result.applied[1].layer, "common-skill");
});

test("이름별 고정 수치 없이 공식 설명에서 유지형 최대 중첩을 계산한다", () => {
  const result = calculateActiveSkillCycleBonuses(
    [{
      character_skill: [{
        skill_name: "래피드 타임",
        skill_effect:
          "공격 시 20초 동안 데미지 1% 증가, 최대 5회 중첩",
      }],
    }],
    "attack",
    360,
    { characterClass: "제로" },
  );

  assert.equal(result.damage, 5);
  assert.equal(result.applied[0].highPoint, true);
  assert.equal(result.applied[0].model, "maintained-high-point");
});

test("대상 방어율 감소는 캐릭터 방무와 분리해 공식 설명에서 계산한다", () => {
  const effects = targetDefenseEffectsFromSkills([
    {
      character_skill: [{
        skill_name: "아머 스플릿",
        skill_effect:
          "공격 시 대상의 방어율 10%만큼 감소, 최대 5번 중첩",
      }],
    },
  ]);
  const result = composeCombatModel({
    baseline: { ignoreDefense: 0.99 },
    effects,
  });

  assert.equal(effects[0].metadata.perStack, 10);
  assert.equal(effects[0].metadata.stacks, 5);
  assert.equal(result.totals.ignoreDefense, 0.99);
  assert.equal(result.targetDefenseRemaining, 0.5);
});

test("대상 방어율 감소의 공식 설명 표기 변형을 모두 인식한다", () => {
  const effects = targetDefenseEffectsFromSkills([
    {
      character_skill: [
        {
          skill_name: "엔젤릭 터치 VI",
          skill_effect:
            "공격 당한 적은 60초 동안 방어율 44% 감소하는 디버프 적용",
        },
        {
          skill_name: "서먼 슬래싱 나이프 VI",
          skill_effect:
            "적중 시 100% 확률로 30초 동안 공포에 빠지게 하여 적의 방어율 30% 감소",
        },
        {
          skill_name: "누적형 디버프",
          skill_effect:
            "공격 시 방어율을 10% 감소, 최대 5번까지 누적",
        },
        {
          skill_name: "템페스트 오브 카드 VI",
          skill_effect:
            "공격 당한 적은 60초 동안 20%의 방어율 무시 디버프 효과",
        },
        {
          skill_name: "노블 디맨드",
          skill_effect:
            "80초 동안 적의 공격력, 방어율 50%, 8초 동안 명중치 50%만큼 감소",
        },
      ],
    },
  ]);

  assert.deepEqual(
    effects.map((effect) => [effect.source, effect.targetDefenseReduction]),
    [
      ["엔젤릭 터치 VI", 44],
      ["서먼 슬래싱 나이프 VI", 30],
      ["누적형 디버프", 50],
      ["템페스트 오브 카드 VI", 20],
      ["노블 디맨드", 50],
    ],
  );
});

test("보스 몬스터를 제외한 방어율 감소는 보스 환산에 적용하지 않는다", () => {
  const effects = targetDefenseEffectsFromSkills([
    {
      character_skill: [{
        skill_name: "퍼지 에어리어",
        skill_effect:
          "40초 동안 보스 몬스터를 제외한 적의 공격력 및 방어율 30% 감소, 재사용 대기시간 60초",
      }],
    },
  ]);

  assert.deepEqual(effects, []);
});

test("특정 공격에만 붙는 방무는 전역 방무와 분리해 점유율로 환산한다", () => {
  const gain = calculateDamageChannelIgnoreDefenseGain({
    currentIgnoreDefense: 0.9,
    addedIgnoreDefense: 0.4,
    enemyDefense: 3,
    channels: [
      { source: "일반 공격", weight: 1 },
      { source: "방무 공격", weight: 1, ignoreDefenseSources: [50] },
    ],
  });
  const globalOnly = calculateDamageChannelIgnoreDefenseGain({
    currentIgnoreDefense: 0.9,
    addedIgnoreDefense: 0.4,
    enemyDefense: 3,
  });

  assert.ok(Math.abs(gain - (0.865 / 0.775 - 1)) < 1e-12);
  assert.ok(gain < globalOnly);
});

test("연무장 실제 피해 점유율은 방어율을 다시 이중 반영하지 않는다", () => {
  const gain = calculateDamageChannelIgnoreDefenseGain({
    currentIgnoreDefense: 0.9,
    addedIgnoreDefense: 0.4,
    enemyDefense: 3,
    channels: [
      {
        source: "일반 공격",
        weight: 0.7,
        metadata: { weightBasis: "observed-damage" },
      },
      {
        source: "방무 공격",
        weight: 0.3,
        ignoreDefenseSources: [50],
        metadata: { weightBasis: "observed-damage" },
      },
    ],
  });

  const expected = 0.7 * (0.82 / 0.7) + 0.3 * (0.91 / 0.85) - 1;
  assert.ok(Math.abs(gain - expected) < 1e-12);
});

test("방어 적용 전 점유율은 현재 캐릭터의 방어 배율을 한 번 적용한다", () => {
  const gain = calculateDamageChannelIgnoreDefenseGain({
    currentIgnoreDefense: 0.9,
    addedIgnoreDefense: 0.4,
    enemyDefense: 3,
    channels: [
      {
        source: "일반 공격",
        weight: 0.7,
        metadata: { weightBasis: "pre-defense" },
      },
      {
        source: "방무 공격",
        weight: 0.3,
        ignoreDefenseSources: [50],
        metadata: { weightBasis: "pre-defense" },
      },
    ],
  });

  const before = 0.7 * 0.7 + 0.3 * 0.85;
  const after = 0.7 * 0.82 + 0.3 * 0.91;
  assert.ok(Math.abs(gain - (after / before - 1)) < 1e-12);
});

test("공식 설명의 스킬 전용 방무는 점유율 미확정 공격군으로만 발견한다", () => {
  const channels = skillLocalIgnoreDefenseChannelsFromSkills([{
    character_skill: [
      {
        skill_name: "공용 버프",
        skill_effect: "130초 동안 몬스터 방어율 무시 16% 증가",
      },
      {
        skill_name: "주력 공격",
        skill_effect: "이 공격은 몬스터 방어율 60% 추가로 무시",
      },
      {
        skill_name: "다른 주력 공격",
        skill_description: "적을 공격하는 스킬",
        skill_effect: "800%의 데미지로 6번 공격\n몬스터 방어율 50%를 추가 무시",
      },
      {
        skill_name: "팬텀 블로우 VI",
        skill_description: "적을 공격하는 스킬",
        skill_effect: "몬스터의 방어율을 40% 무시",
      },
      {
        skill_name: "6차 공격",
        skill_level: 20,
        skill_description: "적을 공격하는 스킬",
        skill_effect:
          "10레벨 : 몬스터 방어율 무시 20% 증가\n30레벨 : 몬스터 방어율 무시 30% 증가",
      },
      {
        skill_name: "아케인 에임",
        skill_effect:
          "공격 시 몬스터의 방어율 20% 무시, 데미지 증가",
      },
    ],
  }]);

  assert.equal(channels.length, 4);
  assert.equal(channels[0].source, "주력 공격");
  assert.equal(channels[0].weight, null);
  assert.deepEqual(channels[0].ignoreDefenseSources, [60]);
  assert.deepEqual(channels[1].ignoreDefenseSources, [50]);
  assert.deepEqual(channels[2].ignoreDefenseSources, [40]);
  assert.deepEqual(channels[3].ignoreDefenseSources, [20]);
});

test("공격 설명과 함께 적힌 유지형 전역 방무는 스킬 전용 방무로 중복 분류하지 않는다", () => {
  const channels = skillLocalIgnoreDefenseChannelsFromSkills([{
    character_skill_grade: "6",
    character_skill: [
      {
        skill_name: "파이렛 플래그 VI",
        skill_description: "깃발을 세워 파티원의 사기를 높인다.",
        skill_effect:
          "60초 동안 자신의 모든 능력치가 증가 및 몬스터 방어율 무시 25% 증가",
      },
      {
        skill_name: "어비스 차지드라이브 VI",
        skill_description: "공격과 동시에 심연의 마력을 분출한다.",
        skill_effect:
          "742%의 데미지로 공격\n어비스 버프 : 60초 동안 데미지 20%, 방어율 무시 20% 증가",
      },
      {
        skill_name: "실제 지역 방무 공격 VI",
        skill_description: "적에게 피해를 입힌다.",
        skill_effect:
          "30초 동안 해당 공격은 몬스터 방어율 40%를 추가 무시",
      },
    ],
  }]);

  assert.deepEqual(
    channels.map(({ source }) => source),
    ["실제 지역 방무 공격 VI"],
  );
  assert.deepEqual(channels[0].ignoreDefenseSources, [40]);
});

test("VI 방무 상속·대체와 하이퍼 패시브를 출처별로 결합한다", () => {
  const channels = skillLocalIgnoreDefenseChannelsFromSkills([
    {
      character_skill_grade: "4",
      character_skill: [
      {
        skill_name: "릴리즈 파일 벙커",
        skill_description: "직접 공격하는 스킬",
        skill_effect: "해당 공격은 몬스터의 방어율을 80% 추가 무시",
      },
      {
        skill_name: "릴리즈 파일 벙커 VI",
        skill_description:
          "파일 벙커를 이용한 직접 공격은 몬스터의 방어율을 추가 무시한다.",
        skill_effect: "",
      },
      {
        skill_name: "팬텀 블로우",
        skill_description: "적을 공격하는 스킬",
        skill_effect: "몬스터의 방어율을 30% 무시",
      },
      {
        skill_name: "팬텀 블로우 VI",
        skill_description: "적을 공격하는 스킬",
        skill_effect: "몬스터의 방어율을 40% 무시",
      },
      {
        skill_name: "벙커 버스터",
        skill_effect:
          "강화된 공격은 485%로 공격하며 적의 방어율을 100% 추가 무시",
      },
      {
        skill_name: "뱅가드 임팩트",
        skill_level: 30,
        skill_description: "적을 공격하는 스킬",
        skill_effect:
          "10레벨 : 몬스터 방어율 무시 10% 증가\n20레벨 : 몬스터 방어율 무시 10% 증가\n30레벨 : 몬스터 방어율 무시 20% 증가\n몬스터 방어율 60% 추가 무시",
      },
      {
        skill_name: "펀치-이그노어 가드",
        skill_description:
          "릴리즈 파일 벙커, 매그넘 펀치의 몬스터 방어율 무시 수치를 증가시킨다.",
        skill_effect: "몬스터 방어율 무시 20% 추가 증가",
      },
      ],
    },
    {
      character_skill_grade: "6",
      character_skill: [{
        skill_name: "오리진 스킬",
        skill_level: 30,
        skill_description: "강대한 힘을 해방한다.",
        skill_effect:
          "10레벨 : 몬스터 방어율 무시 20% 증가\n30레벨 : 몬스터 방어율 무시 30% 증가",
      }],
    },
  ]);

  const byName = new Map(channels.map((channel) => [channel.source, channel]));
  assert.deepEqual(
    byName.get("릴리즈 파일 벙커 VI").ignoreDefenseSources,
    [80, 20],
  );
  assert.equal(
    byName.get("릴리즈 파일 벙커 VI").metadata.inheritedFromLegacy,
    true,
  );
  assert.deepEqual(
    byName.get("팬텀 블로우 VI").ignoreDefenseSources,
    [40],
  );
  assert.deepEqual(byName.get("벙커 버스터").ignoreDefenseSources, [100]);
  assert.deepEqual(
    byName.get("뱅가드 임팩트").ignoreDefenseSources,
    [60, 10, 10, 20],
  );
  assert.deepEqual(byName.get("매그넘 펀치").ignoreDefenseSources, [20]);
  assert.deepEqual(
    byName.get("오리진 스킬").ignoreDefenseSources,
    [20, 30],
  );
});

test("같은 수치의 스킬 방무와 V 강화 코어 방무를 각각 적용한다", () => {
  const channels = generalizedBattlePracticeDamageChannelsFromSkills({
    skillData: [{
      character_skill: [{
        skill_name: "주력기 VI",
        skill_description: "적을 공격하는 스킬",
        skill_effect: "몬스터의 방어율을 20% 무시",
      }],
    }],
    vMatrixData: {
      character_v_core_equipment: [{
        v_core_name: "주력기 강화",
        v_core_type: "강화 코어",
        v_core_level: 60,
      }],
    },
    profile: {
      id: "test-profile",
      sampleCount: 3,
      skillShares: [{ source: "주력기 VI", weight: 1 }],
    },
  });
  const channel = channels.find((candidate) => candidate.source === "주력기 VI");
  assert.deepEqual(channel.ignoreDefenseSources, [20, 20]);
});

test("방어 정규화 연무장 프로필은 방어 적용 전 가중치로 전달한다", () => {
  const channels = generalizedBattlePracticeDamageChannelsFromSkills({
    skillData: [{
      character_skill: [{
        skill_name: "주력기",
        skill_description: "적을 공격하는 스킬",
        skill_effect: "몬스터의 방어율을 20% 무시",
      }],
    }],
    vMatrixData: { character_v_core_equipment: [] },
    profile: {
      id: "raw-profile",
      sampleCount: 5,
      shareBasis: "pre-defense",
      skillShares: [{ source: "주력기", weight: 1 }],
    },
  });

  assert.ok(channels.length > 0);
  assert.ok(channels.every(
    (channel) => channel.metadata?.weightBasis === "pre-defense",
  ));
});

test("VI 뒤에 공격 형태가 붙어도 원본 V 강화 코어 방무를 결합한다", () => {
  const channels = generalizedBattlePracticeDamageChannelsFromSkills({
    skillData: [{
      character_skill: [{
        skill_name: "퍼지롭 매스커레이드 VI : 저격",
        skill_description: "적을 공격하는 스킬",
        skill_effect: "몬스터의 방어율을 40% 무시",
      }],
    }],
    vMatrixData: {
      character_v_core_equipment: [{
        v_core_name: "퍼지롭 매스커레이드 : 저격 강화",
        v_core_type: "강화 코어",
        v_core_level: 60,
      }],
    },
    profile: {
      id: "test-profile",
      sampleCount: 3,
      skillShares: [{
        source: "퍼지롭 매스커레이드 VI : 저격",
        weight: 1,
      }],
    },
  });
  const channel = channels.find((candidate) =>
    candidate.source === "퍼지롭 매스커레이드 VI : 저격"
  );
  assert.deepEqual(channel.ignoreDefenseSources, [40, 20]);
});

test("V 강화 코어 40레벨 방무 20%를 코어명에 포함된 각 스킬로 분리한다", () => {
  const channels = boostCoreIgnoreDefenseChannels({
    character_v_core_equipment: [
      {
        v_core_name: "래피드 파이어/캡틴 디그니티 강화",
        v_core_type: "강화 코어",
        v_core_level: 60,
      },
      {
        v_core_name: "헤드 샷/퍼실레이드 강화",
        v_core_type: "강화 코어",
        v_core_level: 39,
      },
    ],
  });

  assert.deepEqual(channels.map((channel) => channel.source), [
    "래피드 파이어",
    "캡틴 디그니티",
  ]);
  assert.deepEqual(channels[0].ignoreDefenseSources, [20]);
  assert.equal(channels[0].metadata.coreLevel, 60);
});

test("개인 기록 없이 대표 연무장 프로필을 현재 V 코어 방무와 결합한다", () => {
  const channels = resolveClassDamageChannels({
    characterClass: "나이트워커",
    vMatrixData: {
      character_v_core_equipment: [{
        v_core_name: "퀸터플 스로우/쉐도우 배트 강화",
        v_core_type: "강화 코어",
        v_core_level: 60,
      }],
    },
  });

  const weighted = channels.filter((channel) => channel.weight !== null);
  const quintupleThrow = weighted.find((channel) =>
    channel.source === "퀸터플 스로우 VI"
  );
  assert.ok(Math.abs(weighted.reduce((sum, channel) => sum + channel.weight, 0) - 1) < 1e-12);
  assert.ok(quintupleThrow.weight > 0.30 && quintupleThrow.weight < 0.32);
  assert.deepEqual(quintupleThrow.ignoreDefenseSources, [20]);
  assert.equal(
    channels[0].metadata.model,
    "battle-practice-class-generalized",
  );
  assert.equal(channels[0].metadata.weightBasis, "pre-defense");
  assert.equal(channels[0].metadata.sampleCount, 5);
});

test("제로의 공유 라즐리·라피스 잠재와 소울은 한 번만 센다", () => {
  const result = calculateCharacterPotentialConversion({
    character: { character_level: 290, character_class: "제로" },
    mainStat: "STR",
    subStat: "DEX",
    attackType: "attack",
    doping: null,
    presetPolicy: { mode: "active" },
    statData: statData({
      STR: 10_000,
      DEX: 2_500,
      공격력: 2_710,
      데미지: 100,
      "보스 몬스터 데미지": 300,
      "방어율 무시": 96,
      "크리티컬 데미지": 80,
      "AP 배분 STR": 1_000,
      "AP 배분 DEX": 4,
    }),
    equipmentData: {
      item_equipment: [
        {
          item_equipment_slot: "무기",
          item_equipment_part: "태도",
          additional_potential_option_1: "공격력 +33%",
          soul_option: "공격력 +3%",
          item_total_option: {},
        },
        {
          item_equipment_slot: "보조무기",
          item_equipment_part: "대검",
          additional_potential_option_1: "공격력 +33%",
          soul_option: "공격력 +3%",
          item_total_option: {},
        },
      ],
    },
    setEffectData: { set_effect: [] },
  });

  assert.equal(result.details.attackPercent, 36);
  assert.ok(Math.abs(result.details.rawAttack - 2_710 / 1.36) < 1e-12);
});

test("VI 스킬이 있으면 원본 스킬을 대체해 한 번만 반영한다", () => {
  const result = calculateActiveSkillCycleBonuses(
    [
      {
        character_skill: [
          {
            skill_name: "메타모포시스",
            skill_effect:
              "180초 동안 데미지 35% 증가, 재사용 대기시간 90초",
          },
          {
            skill_name: "메타모포시스 VI",
            skill_effect:
              "184초 동안 데미지 45% 증가, 재사용 대기시간 92초",
          },
        ],
      },
    ],
    "attack",
    360,
  );

  assert.deepEqual(result.applied.map((skill) => skill.name), [
    "메타모포시스 VI",
  ]);
  assert.equal(result.damage, 45);
});

test("에코 별칭과 공격기 전용 보정은 전신 액티브 버프에서 제외한다", () => {
  const result = calculateActiveSkillCycleBonuses(
    [
      {
        character_skill: [
          {
            skill_name: "익스클루시브 스펠",
            skill_effect:
              "40분 동안 공격력, 마력 4% 증가, 재사용 대기시간 2시간",
          },
          {
            skill_name: "언다잉 엠버",
            skill_effect:
              "2400초 동안 공격력, 마력 4% 증가, 재사용 대기시간 300초",
          },
          {
            skill_name: "트루 스나이핑",
            skill_effect:
              "12초 동안 500% 데미지로 공격, 데미지 100%, 방어율 무시 100% 증가, 재사용 대기시간 60초",
          },
          {
            skill_name: "메탈아머 전탄발사",
            skill_effect:
              "8초 동안 공격하며 해당 스킬의 최종 데미지 67% 증가, 재사용 대기시간 180초",
          },
          {
            skill_name: "피니투라 페투치아",
            skill_effect:
              "적중한 적은 60초 동안 엔젤릭버스터가 아닌 파티원의 데미지 20% 증가, 재사용 대기시간 40초",
          },
          {
            skill_name: "오블리비온",
            skill_effect:
              "30초 동안 보이드/헥스 계열 스킬의 최종 데미지 30% 증가, 재사용 대기시간 120초",
          },
        ],
      },
    ],
    "attack",
    360,
  );

  assert.deepEqual(result.applied, []);
});

test("질풍과 태풍은 중복하지 않고 최대 뇌전 중첩의 태풍만 유지한다", () => {
  const result = calculateActiveSkillCycleBonuses(
    [
      {
        character_skill: [
          {
            skill_name: "엘리멘트 : 라이트닝",
            skill_effect: "뇌전 버프는 최대 2회 누적 가능",
          },
          {
            skill_name: "질풍",
            skill_effect:
              "사용한 뇌전 버프 1개당 데미지 2% 증가 버프가 60초 동안 지속, 재사용 대기시간 20초",
          },
          {
            skill_name: "태풍 VI",
            skill_effect:
              "사용한 뇌전 버프 1개당 데미지 3% 증가 버프가 95초 동안 지속, 재사용 대기시간 12초",
          },
        ],
      },
    ],
    "attack",
    360,
    { characterClass: "스트라이커" },
  );

  assert.deepEqual(result.applied.map((skill) => skill.name), ["태풍 VI"]);
  assert.equal(result.damage, 6);
});

test("유지형 스킬과 로디드 다이스는 실전 고점 상태로 반영한다", () => {
  const result = calculateActiveSkillCycleBonuses(
    [
      {
        character_skill: [
          {
            skill_name: "다크 크레센도",
            skill_effect:
              "공격 적중 시 30초 동안 데미지 8% 증가, 최대 5회 중첩",
          },
          {
            skill_name: "더블 럭키 다이스",
            skill_effect: "같은 눈이면 효과 10%p 강화",
          },
          {
            skill_name: "로디드 다이스",
            skill_effect: "주사위 1개의 눈을 정할 수 있음",
          },
        ],
      },
    ],
    "magic",
    360,
    { characterClass: "루미너스" },
  );

  assert.equal(result.damage, 70);
  assert.equal(
    result.applied.find((skill) => skill.name === "다크 크레센도")
      ?.highPoint,
    true,
  );
  assert.equal(
    result.applied.find((skill) => skill.name === "로디드 다이스")
      ?.damage,
    30,
  );
});

test("그란디스 여신의 축복은 직업 분기와 최고 상태를 적용한다", () => {
  const result = calculateActiveSkillCycleBonuses(
    [
      {
        character_skill: [
          {
            skill_name: "그란디스 여신의 축복",
            skill_effect:
              "40초 동안 지속\n노바 : 데미지 35% 증가\n카이저는 모프 게이지 단계당 데미지 11% 추가 증가\n레프 : 공격력과 마력 100 증가\n아니마 : 데미지 40% 증가\n재사용 대기시간 120초",
          },
        ],
      },
    ],
    "attack",
    360,
    { characterClass: "카이저" },
  );

  assert.ok(Math.abs(result.damage - (68 / 3)) < 1e-12);
  assert.equal(result.applied[0].damage, 68);
  assert.equal(result.applied[0].model, "grandis-goddess-high-point");
});

test("프리드 VI와 아르카나 VI의 서로 다른 지속 구간을 분리한다", () => {
  const result = calculateActiveSkillCycleBonuses(
    [
      {
        character_skill: [
          {
            skill_name: "프리드의 가호 VI",
            skill_effect:
              "90초 동안 공격력 37, 마력 37 증가\n60초 동안 보스 몬스터 공격 시 데미지 37% 증가\n재사용 대기시간 360초",
          },
          {
            skill_name: "아르카나 오버라이드 VI",
            skill_effect:
              "70초 동안 지속, 잠재되어 있던 마력을 개방하여 15초 동안 최종 데미지 21%, 마력 9% 증가\n이후 개방된 마력량이 감소하여 최종 데미지 7%, 마력 5% 증가\n재사용 대기시간 120초",
          },
        ],
      },
    ],
    "magic",
    360,
    { characterClass: "루미너스" },
  );

  assert.ok(Math.abs(result.flatAttack - 9.25) < 1e-12);
  assert.ok(Math.abs(result.bossDamage - (37 / 6)) < 1e-12);
  assert.ok(Math.abs(result.attackPercent - (41 / 12)) < 1e-12);
  assert.equal(
    result.applied.find((skill) => skill.phase === "개방 감소")?.offset,
    15,
  );
});

test("별도 강화 스킬이 버프 수치를 바꾸면 강화 후 수치를 사용한다", () => {
  const result = calculateActiveSkillCycleBonuses(
    [
      {
        character_skill: [
          {
            skill_name: "라이트 오브 커리지",
            skill_effect:
              "20초 동안 데미지 25% 증가, 재사용 대기시간 60초",
          },
          {
            skill_name: "라이트 오브 커리지 강화",
            skill_effect:
              "라이트 오브 커리지의 지속시간 25초, 데미지 증가량 40%로 증가",
          },
        ],
      },
    ],
    "attack",
    360,
    { characterClass: "미하일" },
  );

  assert.equal(result.applied[0].duration, 25);
  assert.equal(result.applied[0].damage, 40);
  assert.equal(result.applied[0].enhancement, "라이트 오브 커리지 강화");
  assert.ok(Math.abs(result.damage - (50 / 3)) < 1e-12);
});

test("렌은 캐릭터별 상수를 끼워 넣지 않고 공개 스탯을 기준으로 계산한다", () => {
  const result = calculateCharacterPotentialConversion({
    character: { character_level: 280, character_class: "렌" },
    mainStat: "STR",
    subStat: "DEX",
    attackType: "attack",
    doping: FULL_BOSS_DOPING,
    presetPolicy: { mode: "active" },
    statData: statData({
      STR: 10_000,
      DEX: 2_500,
      공격력: 2_000,
      데미지: 0,
      "보스 몬스터 데미지": 0,
      "방어율 무시": 90,
      "크리티컬 데미지": 80,
      "AP 배분 STR": 1_000,
      "AP 배분 DEX": 4,
    }),
    equipmentData: { item_equipment: [] },
    setEffectData: { set_effect: [] },
    otherStatData: { other_stat: [] },
    linkSkillData: { character_link_skill: [] },
    skillData: [],
    symbolData: { symbol: [] },
    hyperStatData: { use_preset_no: "1", hyper_stat_preset_1: [] },
    hexaStatData: {},
    abilityData: { ability_info: [] },
    unionRaiderData: {},
    unionArtifactData: {},
  });

  assert.equal(result.details.classStatAdjustmentApplied, false);
  assert.equal(result.details.baseMain, 10_000);
  assert.equal(result.details.currentMain, 10_000);
  assert.equal(result.details.currentSub, 2_500);
  assert.equal(result.details.dopedMain, 10_075);
  assert.equal(result.details.dopedSub, 2_575);
});

test("유지되는 표식의 중첩 방무를 모든 연무장 공격군에 적용한다", () => {
  const channels = generalizedBattlePracticeDamageChannelsFromSkills({
    skillData: [
      {
        character_skill: [{
          skill_name: "엘리멘트 : 다크니스",
          skill_effect:
            "표식은 최대 2회까지 중첩, 해당 적을 공격하면 중첩당 4%만큼 방어율 추가 무시",
        }],
      },
      {
        character_skill: [
          {
            skill_name: "다크니스 어뎁팅",
            skill_effect:
              "최대 중첩 제한 1, 중첩당 방어율 무시 1% 증가",
          },
          {
            skill_name: "다크니스 어뎁팅Ⅱ",
            skill_effect:
              "최대 중첩 제한 1, 중첩당 방어율 무시 1% 증가",
          },
          {
            skill_name: "다크니스 어뎁팅Ⅲ",
            skill_effect:
              "최대 중첩 제한 1, 중첩당 방어율 무시 1% 증가",
          },
        ],
      },
    ],
    profile: {
      id: "test-profile",
      sampleCount: 3,
      skillShares: [{ source: "별도 공격", weight: 1 }],
    },
  });

  assert.equal(channels.length, 1);
  assert.deepEqual(channels[0].ignoreDefenseSources, [35]);
  assert.equal(
    channels[0].metadata.maintainedMarkedTarget.ignoreDefense,
    35,
  );
});

function criticalRateConversion(
  characterClass,
  criticalRate,
  skillData,
  doping = FULL_BOSS_DOPING,
) {
  return calculateCharacterPotentialConversion({
    character: { character_level: 280, character_class: characterClass },
    mainStat: "STR",
    subStat: "DEX",
    attackType: "attack",
    doping,
    presetPolicy: { mode: "active" },
    statData: statData({
      STR: 10_000,
      DEX: 2_500,
      공격력: 2_000,
      "크리티컬 확률": criticalRate,
      "크리티컬 데미지": 80,
      "AP 배분 STR": 1_000,
      "AP 배분 DEX": 4,
    }),
    equipmentData: { item_equipment: [] },
    setEffectData: { set_effect: [] },
    skillData,
  });
}

test("풀보스 크확은 공용·보스·조건부 보정을 구분하고 100%를 가정한다", () => {
  const hero = criticalRateConversion("히어로", 80);
  assert.equal(hero.details.apiCurrentCriticalRate, 80);
  assert.equal(hero.details.currentCriticalRate, 80);
  assert.equal(hero.details.dopedCriticalRate, 80);
  assert.equal(hero.details.effectiveBossCriticalRate, 80);
  assert.equal(hero.details.criticalRateBasis, "non-external-doping");
  assert.equal(hero.details.criticalRateAssumedForConversion, 100);

  const externalDopingIgnored = criticalRateConversion(
    "히어로",
    80,
    undefined,
    {
      ...FULL_BOSS_DOPING,
      totals: { ...FULL_BOSS_DOPING.totals, criticalRate: 999 },
    },
  );
  assert.equal(externalDopingIgnored.details.dopedCriticalRate, 80);

  const viper = criticalRateConversion("바이퍼", 70);
  assert.equal(viper.details.dopedCriticalRate, 70);
  assert.equal(viper.details.effectiveBossCriticalRate, 90);
  assert.equal(viper.details.conditionalBossCriticalRateBonus, 60);
  assert.equal(viper.details.conditionalBossCriticalRate, 150);
  assert.equal(
    viper.details.conditionalBossCriticalRateSource,
    "그로기 마스터리 · 상태이상 대상",
  );
  assert.equal(viper.details.criticalRateAssumedForConversion, 100);

  const capped = criticalRateConversion("히어로", 90);
  assert.equal(
    hero.statEquivalence.criticalDamageToMainPercent,
    capped.statEquivalence.criticalDamageToMainPercent,
  );

  const bowmaster = criticalRateConversion("보우마스터", 90, [
    {
      character_skill: [
        {
          skill_name: "샤프 아이즈-크리티컬 레이트",
          skill_effect: "크리티컬 확률 5% 증가",
        },
        {
          skill_name: "크리티컬 리인포스",
          skill_effect:
            "30초 동안 크리티컬 확률의 50%만큼 크리티컬 데미지 증가, 재사용 대기시간 120초",
        },
      ],
    },
  ]);
  assert.equal(bowmaster.details.dopedCriticalRate, 105);
  assert.equal(bowmaster.details.sharpEyesHyperCriticalRateBonus, 5);
  assert.equal(bowmaster.details.criticalReinforceAverageCriticalDamage, 13.125);
  assert.equal(bowmaster.details.dopedCriticalDamage, 143.125);
  assert.equal(hero.statEquivalence.criticalRateToMainPercent, undefined);
  assert.equal(
    bowmaster.statEquivalence.criticalRateToMainPercent,
    bowmaster.statEquivalence.criticalDamageToMainPercent * 0.5 * (30 / 120),
  );
  assert.equal(bowmaster.details.criticalReinforceUptime, 0.25);

  const mercedes = criticalRateConversion("메르세데스", 70);
  assert.equal(mercedes.details.dopedCriticalRate, 70);
  const mercedesWithUsefulSharpEyes = criticalRateConversion(
    "메르세데스",
    70,
    [{
      character_skill: [{
        skill_name: "쓸만한 샤프 아이즈",
        skill_effect: "크리티컬 확률 10%, 크리티컬 데미지 8% 증가",
      }],
    }],
  );
  assert.equal(mercedesWithUsefulSharpEyes.details.dopedCriticalRate, 80);
  assert.equal(
    mercedesWithUsefulSharpEyes.details.usefulSharpEyesCriticalRateBonus,
    10,
  );
  assert.equal(
    mercedesWithUsefulSharpEyes.details.combatModel.totals.criticalRate,
    80,
  );
  const xenonBuff = criticalRateConversion("제논", 50);
  assert.equal(xenonBuff.details.dopedCriticalRate, 90);
});

test("메르세데스 유지 버프와 카인 복합 문장 버프를 전투 주기에 반영한다", () => {
  const mercedes = calculateActiveSkillCycleBonuses(
    [{
      character_skill: [{
        skill_name: "앤시언트 스피릿",
        skill_effect: "MP 80 소비, 200초 동안 공격력 30%, HP 1500 증가",
      }],
    }],
    "attack",
    360,
    { characterClass: "메르세데스" },
  );
  assert.equal(mercedes.attackPercent, 30);
  assert.equal(mercedes.applied[0].model, "maintained-high-point");

  const kain = calculateActiveSkillCycleBonuses(
    [{
      character_skill: [{
        skill_name: "인카네이션",
        skill_effect:
          "35초 동안 데미지 15%, 공격력 15% 증가\n재사용 대기시간 120초",
      }],
    }],
    "attack",
    360,
    { characterClass: "카인" },
  );
  assert.equal(kain.applied[0].damage, 15);
  assert.equal(kain.applied[0].attackPercent, 15);
  assert.equal(kain.damage, 4.375);
  assert.equal(kain.attackPercent, 4.375);
});

function battleMageConversion(doping, skillData = []) {
  return calculateCharacterPotentialConversion({
    character: {
      character_level: 286,
      character_class: "배틀메이지",
    },
    mainStat: "INT",
    subStat: "LUK",
    attackType: "magic",
    doping,
    presetPolicy: { mode: "active" },
    statData: statData({
      INT: 10_000,
      LUK: 2_000,
      마력: 2_000,
      데미지: 100,
      "보스 몬스터 데미지": 300,
      "방어율 무시": 96,
      "크리티컬 데미지": 80,
      "AP 배분 INT": 1_000,
      "AP 배분 LUK": 4,
    }),
    equipmentData: { item_equipment: [] },
    setEffectData: { set_effect: [] },
    skillData,
  });
}

test("배틀메이지는 배틀 레이지와 다크 오라를 기본 전투 상태로 환산한다", () => {
  const base = battleMageConversion(null);
  assert.equal(base.details.classAlwaysOnAdjustmentApplied, true);
  assert.equal(base.details.classAlwaysOnDefaultMode, "다크 오라");
  assert.deepEqual(base.details.classAlwaysOnSources, [
    "배틀 레이지",
    "다크 오라",
  ]);
  assert.deepEqual(base.details.classAlwaysOnLearnedSkillSources, []);
  assert.equal(base.details.dopedCriticalDamage, 90);
  assert.equal(base.details.dopedDamageTotal, 435);

  const withHyper = battleMageConversion(null, [
    {
      character_skill: [
        {
          skill_name: "다크 오라-보스 킬러",
          skill_effect: "보스 몬스터 공격 시 데미지 5% 증가",
        },
      ],
    },
  ]);
  assert.deepEqual(withHyper.details.classAlwaysOnLearnedSkillSources, [
    "다크 오라-보스 킬러",
  ]);
  assert.equal(withHyper.details.dopedDamageTotal, 440);
  assert.equal(withHyper.details.classAlwaysOnAdjustment.bossDamage, 5);

  const fullBoss = battleMageConversion(FULL_BOSS_DOPING, [
    {
      character_skill: [
        { skill_name: "다크 오라-보스 킬러", skill_effect: "" },
      ],
    },
  ]);
  assert.equal(fullBoss.details.dopedCriticalDamage, 133);
  assert.equal(fullBoss.details.dopedDamageTotal, 646);
});

test("심볼·하이퍼·HEXA를 제외한 기본 스탯을 최종 스탯에서 역산한다", () => {
  const result = calculateCharacterPotentialConversion({
    character: { character_level: 286 },
    mainStat: "INT",
    subStat: "LUK",
    attackType: "magic",
    doping: null,
    statData: statData({
      INT: 60_868,
      LUK: 9_490,
      마력: 5_102,
      "크리티컬 데미지": 102.3,
      "AP 배분 INT": 1_000,
      "AP 배분 LUK": 4,
    }),
    equipmentData: {
      item_equipment: [
        {
          potential_option_1: "INT +527%",
          potential_option_2: "LUK +244%",
          additional_potential_option_1: "마력 +66%",
          item_total_option: {},
        },
      ],
    },
    setEffectData: { set_effect: [] },
    otherStatData: { other_stat: [] },
    linkSkillData: { character_link_skill: [] },
    skillData: [],
    symbolData: {
      symbol: [
        { symbol_int: "13200", symbol_luk: "0" },
        { symbol_int: "9200", symbol_luk: "0" },
      ],
    },
    hyperStatData: {
      use_preset_no: "1",
      hyper_stat_preset_1: [
        { stat_type: "INT", stat_increase: "지력 210 증가" },
        { stat_type: "LUK", stat_increase: "운 120 증가" },
      ],
    },
    hexaStatData: {
      character_hexa_stat_core: [
        {
          main_stat_name: "크리티컬 데미지 증가",
          main_stat_level: 6,
          sub_stat_name_1: "주력 스탯 증가",
          sub_stat_level_1: 8,
          sub_stat_name_2: "마력 증가",
          sub_stat_level_2: 6,
        },
      ],
      character_hexa_stat_core_2: [
        {
          main_stat_name: "주력 스탯 증가",
          main_stat_level: 5,
          sub_stat_name_1: "크리티컬 데미지 증가",
          sub_stat_level_1: 6,
          sub_stat_name_2: "마력 증가",
          sub_stat_level_2: 9,
        },
      ],
      character_hexa_stat_core_3: [
        {
          main_stat_name: "마력 증가",
          main_stat_level: 8,
          sub_stat_name_1: "크리티컬 데미지 증가",
          sub_stat_level_1: 4,
          sub_stat_name_2: "주력 스탯 증가",
          sub_stat_level_2: 8,
        },
      ],
    },
    abilityData: { ability_info: [] },
  });

  assert.equal(result.details.unreflectedMain, 24_810);
  assert.equal(result.details.unreflectedSub, 120);
  assert.equal(result.details.baseMain, 5_751);
  assert.equal(result.details.baseSub, 2_724);
  assert.equal(result.details.baseCalculation, "inverse");
  assert.equal(result.details.currentAttack, 5_102);
});

test("레테 기준 환산 풀도핑 표와 같은 효율 범위를 계산한다", () => {
  const result = calculateCharacterPotentialConversion({
    character: { character_level: 286 },
    mainStat: "INT",
    subStat: "LUK",
    attackType: "magic",
    doping: FULL_BOSS_DOPING,
    statData: statData({
      INT: 60_868,
      LUK: 9_490,
      마력: 5_102,
      데미지: 60,
      "보스 몬스터 데미지": 391,
      "방어율 무시": 97.6672,
      "크리티컬 데미지": 102.3,
      "AP 배분 INT": 1_000,
      "AP 배분 LUK": 4,
    }),
    equipmentData: {
      item_equipment: [
        {
          potential_option_1: "INT +527%",
          potential_option_2: "LUK +244%",
          additional_potential_option_1: "마력 +66%",
          item_total_option: {},
        },
      ],
    },
    setEffectData: { set_effect: [] },
    otherStatData: { other_stat: [] },
    linkSkillData: { character_link_skill: [] },
    skillData: [],
    symbolData: {
      symbol: [
        { symbol_int: "13200", symbol_luk: "0" },
        { symbol_int: "9200", symbol_luk: "0" },
      ],
    },
    hyperStatData: {
      use_preset_no: "1",
      hyper_stat_preset_1: [
        { stat_type: "INT", stat_increase: "지력 210 증가" },
        { stat_type: "LUK", stat_increase: "운 120 증가" },
      ],
    },
    hexaStatData: {
      character_hexa_stat_core: [
        {
          main_stat_name: "크리티컬 데미지 증가",
          main_stat_level: 6,
          sub_stat_name_1: "주력 스탯 증가",
          sub_stat_level_1: 8,
        },
      ],
      character_hexa_stat_core_2: [
        { main_stat_name: "주력 스탯 증가", main_stat_level: 5 },
      ],
      character_hexa_stat_core_3: [
        { sub_stat_name_2: "주력 스탯 증가", sub_stat_level_2: 8 },
      ],
    },
    abilityData: {
      ability_info: [
        {
          ability_value: "상태 이상에 걸린 대상 공격 시 데미지 8% 증가",
        },
      ],
    },
  });
  const efficiency = result.statEquivalence;
  const values = {
    boss40: efficiency.bossDamageToMainPercent * 40,
    magic30:
      efficiency.flatMainStatToPercent * efficiency.attackToMainStat * 30,
    magicPercent12: efficiency.attackPercentToMainPercent * 12,
    criticalDamage3: efficiency.criticalDamageToMainPercent * 3,
    main30: efficiency.flatMainStatToPercent * 30,
    unreflectedMain200: efficiency.unreflectedMainStatToPercent * 200,
    sub30:
      efficiency.flatMainStatToPercent *
      efficiency.flatSubStatToFlatMainStat *
      30,
    subPercent12: efficiency.subStatPercentToMainPercent * 12,
    unreflectedSub200: efficiency.unreflectedSubStatToPercent * 200,
    allStat9: efficiency.allStatPercentToMainPercent * 9,
  };

  assert.ok(Math.abs(values.boss40 - 57.27) < 0.05);
  assert.ok(Math.abs(values.magic30 - 9.52) < 0.01);
  assert.ok(Math.abs(values.magicPercent12 - 60.78) < 0.05);
  assert.ok(Math.abs(values.criticalDamage3 - 11.72) < 0.01);
  assert.ok(Math.abs(values.main30 - 3.23) < 0.01);
  assert.ok(Math.abs(values.unreflectedMain200 - 3.43) < 0.01);
  assert.ok(Math.abs(values.sub30 - 0.44) < 0.01);
  assert.ok(Math.abs(values.subPercent12 - 1.44) < 0.01);
  assert.ok(Math.abs(values.unreflectedSub200 - 0.86) < 0.01);
  assert.ok(Math.abs(values.allStat9 - 10.08) < 0.01);
  assert.equal(
    efficiency.currentIgnoreDefense,
    result.details.dopedIgnoreDefense / 100,
  );
  assert.ok(
    Math.abs(
      efficiency.oneMainPercentRelative -
        (4 * (result.details.dopedBaseMain / 100)) /
          (4 * result.details.dopedMain + result.details.dopedSub),
    ) < 1e-15,
  );
  assert.ok(
    Math.abs(efficiency.ied40Against300ToMainPercent - 20.7330522928) <
      1e-9,
  );
  assert.ok(
    Math.abs(efficiency.ied40Against380ToMainPercent - 26.5977091831) <
      1e-9,
  );
});

test("여러 방무 줄을 합성한 뒤 적 방어율에 맞춰 비선형 환산한다", () => {
  const currentIgnoreDefense = 0.984930112;
  const oneMainPercentRelative = 0.0009135241081928656;
  // 방무 40%와 30%는 70% 합연산이 아니라 1 - 0.6 * 0.7 = 58%다.
  const result = calculateIgnoreDefenseEquivalent({
    currentIgnoreDefense,
    addedIgnoreDefense: 0.58,
    enemyDefense: 3.8,
    oneMainPercentRelative,
  });

  assert.ok(Math.abs(result - 38.56667831545601) < 1e-12);
  assert.equal(
    calculateIgnoreDefenseEquivalent({
      currentIgnoreDefense: 0.5,
      addedIgnoreDefense: 0.4,
      enemyDefense: 3.8,
      oneMainPercentRelative,
    }),
    null,
  );
});
