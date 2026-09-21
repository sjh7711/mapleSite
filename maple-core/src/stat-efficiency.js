import {
  CLASS_ALWAYS_ON_COMBAT,
  CRITICAL_REINFORCE_CLASSES,
} from "./stat-profile.js";
import {
  calculateDamageChannelIgnoreDefenseGain,
  composeCombatModel,
  createCombatEffect,
  generalizedBattlePracticeDamageChannelsFromSkills,
  isBaselineReflectedSkill,
  skillLocalIgnoreDefenseChannelsFromSkills,
  targetDefenseEffectsFromSkills,
} from "./combat-model.js";
import { classBattlePracticeDamageProfile } from "./class-damage-profiles.js";
import {
  classSpecialRingPhaseProfile,
  specialRingBurstDamageShare,
} from "./special-ring-phase-profiles.js";

const STAT_NAMES = ["STR", "DEX", "INT", "LUK"];
const KOREAN_STAT_NAMES = {
  STR: "STR",
  DEX: "DEX",
  INT: "INT",
  LUK: "LUK",
  힘: "STR",
  민첩: "DEX",
  지력: "INT",
  지능: "INT",
  행운: "LUK",
};

function number(value) {
  const parsed = Number(String(value ?? "0").replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function withoutSixthMasteryMarker(value) {
  return String(value ?? "")
    .replace(/\s+VI(?=\s*(?:[:：(（]|$))/gu, "")
    .trim();
}

function isSixthMasterySkillName(value) {
  const name = String(value ?? "").trim();
  return Boolean(name) && withoutSixthMasteryMarker(name) !== name;
}

function emptyBonuses() {
  return {
    flat: Object.fromEntries(STAT_NAMES.map((stat) => [stat, 0])),
    percent: Object.fromEntries(STAT_NAMES.map((stat) => [stat, 0])),
    flatHp: 0,
    hpPercent: 0,
    flatAttack: 0,
    flatMagic: 0,
    attackPercent: 0,
    magicPercent: 0,
    damage: 0,
    bossDamage: 0,
    criticalRate: 0,
    criticalDamage: 0,
    ignoreDefenseSources: [],
    apPercent: 0,
  };
}

function mergeBonuses(...bonuses) {
  const result = emptyBonuses();
  for (const bonus of bonuses) {
    if (!bonus) continue;
    for (const stat of STAT_NAMES) {
      result.flat[stat] += number(bonus.flat?.[stat]);
      result.percent[stat] += number(bonus.percent?.[stat]);
    }
    result.flatHp += number(bonus.flatHp);
    result.hpPercent += number(bonus.hpPercent);
    result.flatAttack += number(bonus.flatAttack);
    result.flatMagic += number(bonus.flatMagic);
    result.attackPercent += number(bonus.attackPercent);
    result.magicPercent += number(bonus.magicPercent);
    result.damage += number(bonus.damage);
    result.bossDamage += number(bonus.bossDamage);
    result.criticalRate += number(bonus.criticalRate);
    result.criticalDamage += number(bonus.criticalDamage);
    result.ignoreDefenseSources.push(
      ...(Array.isArray(bonus.ignoreDefenseSources)
        ? bonus.ignoreDefenseSources.map(number).filter((value) => value > 0)
        : []),
    );
    result.apPercent = Math.max(result.apPercent, number(bonus.apPercent));
  }
  return result;
}

function finalStats(statData) {
  return Object.fromEntries(
    (statData.final_stat ?? []).map((entry) => [
      entry.stat_name,
      number(entry.stat_value),
    ]),
  );
}

function activeEquipment(equipmentData) {
  // 2026-03-19 개편 이후 이 슬롯은 교체 대기 장비가 아니라 실제 추가
  // 특수 반지 슬롯이다. 기본 옵션도 적용되므로 일반 장착 장비와 함께 센다.
  return equipmentData.item_equipment ?? [];
}

export function equipmentSoulOptionLines(item) {
  // soul_active는 옵션 존재 여부와 별개다. 비활성 소울은 기본 옵션,
  // 상시 공·마 및 증폭 잠재를 모두 제외한다. 구형 응답은 기존처럼 읽는다.
  return (String(item?.soul_active ?? "1") === "1"
    ? [
        item?.soul_option,
        number(item?.soul_pad) > 0 ? `공격력 +${number(item.soul_pad)}` : null,
        number(item?.soul_mad) > 0 ? `마력 +${number(item.soul_mad)}` : null,
        item?.soul_potential_option_1,
        item?.soul_potential_option_2,
        item?.soul_potential_option_3,
      ]
    : []).filter(Boolean);
}

function itemPotentialLines(item) {
  return [
    item?.potential_option_1,
    item?.potential_option_2,
    item?.potential_option_3,
    item?.additional_potential_option_1,
    item?.additional_potential_option_2,
    item?.additional_potential_option_3,
    ...equipmentSoulOptionLines(item),
  ].filter(Boolean);
}

function equipmentOptionLines(equipmentData, characterClass = "") {
  const items = activeEquipment(equipmentData);
  let sharedZeroWeaponSignature = null;
  if (characterClass === "제로") {
    const alphaWeapon = items.find(
      (item) =>
        item?.item_equipment_slot === "무기" &&
        item?.item_equipment_part === "태도",
    );
    const betaWeapon = items.find(
      (item) => item?.item_equipment_part === "대검",
    );
    const alphaSignature = JSON.stringify(itemPotentialLines(alphaWeapon));
    const betaSignature = JSON.stringify(itemPotentialLines(betaWeapon));
    if (alphaSignature !== "[]" && alphaSignature === betaSignature) {
      // 라즐리·라피스는 한 번의 잠재 재설정과 소울 적용 결과를 공유하며
      // API 장비 목록에 같은 줄이 두 무기 각각에 내려온다. 장비 자체의
      // 기본 옵션은 모두 유지하되 공유 잠재/소울만 한 번 센다.
      sharedZeroWeaponSignature = betaSignature;
    }
  }

  return items.flatMap((item) => {
    const lines = itemPotentialLines(item);
    if (
      sharedZeroWeaponSignature &&
      item?.item_equipment_part === "대검" &&
      JSON.stringify(lines) === sharedZeroWeaponSignature
    ) {
      return [];
    }
    return lines;
  });
}

function parseEquipmentOptions(lines, characterLevel) {
  const result = emptyBonuses();

  for (const line of lines) {
    let match = String(line).match(
      /^(STR|DEX|INT|LUK|올스탯)\s*\+(\d+(?:\.\d+)?)%$/,
    );
    if (match) {
      const targets = match[1] === "올스탯" ? STAT_NAMES : [match[1]];
      for (const stat of targets) result.percent[stat] += number(match[2]);
      continue;
    }

    match = String(line).match(
      /^(STR|DEX|INT|LUK|올스탯)\s*\+(\d+(?:\.\d+)?)$/,
    );
    if (match) {
      const targets = match[1] === "올스탯" ? STAT_NAMES : [match[1]];
      for (const stat of targets) result.flat[stat] += number(match[2]);
      continue;
    }

    match = String(line).match(
      /^캐릭터 기준 9레벨 당 (STR|DEX|INT|LUK) \+(\d+(?:\.\d+)?)$/,
    );
    if (match) {
      result.flat[match[1]] +=
        Math.floor(characterLevel / 9) * number(match[2]);
      continue;
    }

    match = String(line).match(/^(공격력|마력)\s*\+(\d+(?:\.\d+)?)%$/);
    if (match) {
      result[match[1] === "마력" ? "magicPercent" : "attackPercent"] +=
        number(match[2]);
    }
  }
  return result;
}

function parseSetEffects(setEffectData) {
  const descriptions = (setEffectData.set_effect ?? []).flatMap((set) =>
    (set.set_effect_info ?? []).map((effect) => effect.set_option ?? ""),
  );
  return parseTextBonuses(descriptions);
}

function parseTextBonuses(texts) {
  const result = emptyBonuses();
  for (const rawText of texts.filter(Boolean)) {
    const text = String(rawText);
    for (const match of text.matchAll(
      /올스탯\s*\+?\s*(\d+(?:\.\d+)?)\s*(%)?/g,
    )) {
      const destination = match[2] ? result.percent : result.flat;
      for (const stat of STAT_NAMES) destination[stat] += number(match[1]);
    }
    let individualText = text;
    for (const match of text.matchAll(
      /((?:STR|DEX|INT|LUK|힘|민첩|지력|지능|행운)(?:\s*,\s*(?:STR|DEX|INT|LUK|힘|민첩|지력|지능|행운))+?)\s*\+?\s*(\d+(?:\.\d+)?)\s*(%)?/g,
    )) {
      const destination = match[3] ? result.percent : result.flat;
      for (const name of match[1].split(/\s*,\s*/)) {
        destination[KOREAN_STAT_NAMES[name] ?? name] += number(match[2]);
      }
      individualText = individualText.replace(match[0], "");
    }
    for (const match of individualText.matchAll(
      /(STR|DEX|INT|LUK|힘|민첩|지력|지능|행운)\s*\+?\s*(\d+(?:\.\d+)?)\s*(%)?/g,
    )) {
      const stat = KOREAN_STAT_NAMES[match[1]];
      const destination = match[3] ? result.percent : result.flat;
      destination[stat] += number(match[2]);
    }
    // 공·마가 하나의 수치를 공유하는 표기는 먼저 소비한다. 쉼표 표기의
    // 마력만 읽거나, 공유 수치와 개별 마력을 중복 합산하지 않는다.
    const attackText = text.replace(
      /공격력\s*(?:과|및|\/|,)\s*마력(?:이)?\s*\+?\s*(\d+(?:\.\d+)?)\s*(%)?/gu,
      (_match, value, percent) => {
        result[percent ? "attackPercent" : "flatAttack"] += number(value);
        result[percent ? "magicPercent" : "flatMagic"] += number(value);
        return "";
      },
    );
    for (const match of attackText.matchAll(
      /(공격력|마력)(?:이)?\s*\+?\s*(\d+(?:\.\d+)?)%/g,
    )) {
      result[match[1] === "마력" ? "magicPercent" : "attackPercent"] +=
        number(match[2]);
    }
    for (const match of attackText.matchAll(
      /(?:^|[,\n]\s*)(공격력|마력)(?:이)?\s*\+?\s*(\d+(?:\.\d+)?)(?![\d.]|\s*%)(?:\s*증가)?/g,
    )) {
      result[match[1] === "마력" ? "flatMagic" : "flatAttack"] +=
        number(match[2]);
    }
    for (const match of text.matchAll(
      /(?:최대\s*)?HP(?:가|이)?\s*\+?\s*(\d+(?:\.\d+)?)(%)?/g,
    )) {
      result[match[2] ? "hpPercent" : "flatHp"] += number(match[1]);
    }
    for (const match of text.matchAll(
      /(?:^|[,\n]\s*)데미지(?:가)?\s*\+?\s*(\d+(?:\.\d+)?)%/g,
    )) {
      result.damage += number(match[1]);
    }
    for (const match of text.matchAll(
      /보스 몬스터(?: 공격 시)? 데미지(?:가)?\s*\+?\s*(\d+(?:\.\d+)?)%/g,
    )) {
      result.bossDamage += number(match[1]);
    }
    for (const match of text.matchAll(
      /크리티컬 확률(?:이)?\s*\+?\s*(\d+(?:\.\d+)?)%/g,
    )) {
      result.criticalRate += number(match[1]);
    }
    for (const match of text.matchAll(
      /크리티컬 데미지(?:가)?\s*\+?\s*(\d+(?:\.\d+)?)%/g,
    )) {
      result.criticalDamage += number(match[1]);
    }
    for (const match of text.matchAll(
      /(?:몬스터 )?방어율 무시(?:가)?\s*\+?\s*(\d+(?:\.\d+)?)%/g,
    )) {
      result.ignoreDefenseSources.push(number(match[1]));
    }
    for (const match of text.matchAll(
      /AP를 직접 투자한 모든 능력치\s*(\d+(?:\.\d+)?)% 증가/g,
    )) {
      result.apPercent = Math.max(result.apPercent, number(match[1]));
    }
  }
  return result;
}

function optionEntryBonuses(items, optionField = "item_option") {
  const result = emptyBonuses();
  for (const item of items ?? []) {
    for (const option of item?.[optionField] ?? []) {
      const name = String(option?.option_type ?? "").trim();
      const value = number(option?.option_value);
      if (!name || !value) continue;
      if (STAT_NAMES.includes(name)) {
        result.flat[name] += value;
      } else if (name === "올스탯") {
        for (const stat of STAT_NAMES) result.flat[stat] += value;
      } else if (/^(?:최대\s*)?HP$/u.test(name)) {
        result.flatHp += value;
      } else if (/^(?:최대\s*)?HP\s*\(%\)$/u.test(name)) {
        result.hpPercent += value;
      } else if (name === "공격력") {
        result.flatAttack += value;
      } else if (name === "마력") {
        result.flatMagic += value;
      } else if (name === "공격력 (%)" || name === "공격력 (+%)") {
        result.attackPercent += value;
      } else if (name === "마력 (%)" || name === "마력 (+%)") {
        result.magicPercent += value;
      } else if (name === "보스 몬스터 데미지") {
        result.bossDamage += value;
      } else if (name === "크리티컬 확률") {
        result.criticalRate += value;
      } else if (name === "크리티컬 데미지") {
        result.criticalDamage += value;
      } else if (name === "몬스터 방어율 무시" || name === "방어율 무시") {
        result.ignoreDefenseSources.push(value);
      }
    }
  }
  return result;
}

function cashEquipmentBonuses(cashEquipmentData) {
  return optionEntryBonuses(
    [
      ...(cashEquipmentData?.cash_item_equipment_base ?? []),
      ...(cashEquipmentData?.additional_cash_item_equipment_base ?? []),
    ],
    "cash_item_option",
  );
}

function petSkillBonuses(petEquipmentData) {
  return parseTextBonuses(
    (petEquipmentData?.petite_luna_pet_skill ?? []).flatMap((skill) => {
      const effect = String(skill?.skill_effect ?? "");
      const passive = [...effect.matchAll(
        /\[패시브 효과\s*:\s*([^\]]+)\]/g,
      )].map((match) => match[1]);
      return passive.length ? passive : [effect];
    }),
  );
}

function activePetEquipmentItems(petEquipmentData) {
  const shared = String(petEquipmentData?.pet_activate_flag ?? "") === "1";
  const prefix = shared ? "world_share_pet_" : "pet_";
  return [1, 2, 3]
    .map((slot) => petEquipmentData?.[`${prefix}${slot}_equipment`])
    .filter(Boolean);
}

function activePetPresetNumber(petEquipmentData) {
  if (String(petEquipmentData?.pet_activate_flag ?? "") !== "1") return null;
  const presets = [1, 2, 3]
    .map((slot) => presetNumber(
      petEquipmentData?.[`world_share_pet_${slot}_equipment_preset_no`],
    ))
    .filter(Boolean);
  return presets.length === 3 && new Set(presets).size === 1
    ? presets[0]
    : null;
}

function petPresetInventory(petEquipmentData) {
  return sortedUniquePresetNumbers(
    (petEquipmentData?.world_share_pet_equipment_preset ?? []).map(
      (item) => item?.preset_no,
    ),
  );
}

function petEquipmentItemsForPreset(petEquipmentData, preset) {
  if (!preset) return activePetEquipmentItems(petEquipmentData);
  return (petEquipmentData?.world_share_pet_equipment_preset ?? []).filter(
    (item) => presetNumber(item?.preset_no) === preset,
  );
}

function relevantFlatAttack(bonuses, attackType) {
  return attackType === "magic"
    ? number(bonuses?.flatMagic)
    : number(bonuses?.flatAttack);
}

function resolvePetEquipmentBonuses(petEquipmentData, attackType, presetMode) {
  const activeItems = activePetEquipmentItems(petEquipmentData);
  const active = optionEntryBonuses(activeItems);
  const available = petPresetInventory(petEquipmentData);
  const activePreset = activePetPresetNumber(petEquipmentData);
  const selectedPreset = presetMode === "auto" && available.length
    ? available.reduce((best, candidate) => {
        const bestBonuses = optionEntryBonuses(
          petEquipmentItemsForPreset(petEquipmentData, best),
        );
        const candidateBonuses = optionEntryBonuses(
          petEquipmentItemsForPreset(petEquipmentData, candidate),
        );
        return relevantFlatAttack(candidateBonuses, attackType) >
          relevantFlatAttack(bestBonuses, attackType)
          ? candidate
          : best;
      }, activePreset && available.includes(activePreset)
        ? activePreset
        : available[0])
    : activePreset;
  const selectedItems = selectedPreset && available.includes(selectedPreset)
    ? petEquipmentItemsForPreset(petEquipmentData, selectedPreset)
    : activeItems;
  return {
    active,
    selected: optionEntryBonuses(selectedItems),
    skills: petSkillBonuses(petEquipmentData),
    activePreset,
    selectedPreset,
    available,
    changed:
      JSON.stringify(activeItems.map((item) => item?.item_option ?? [])) !==
      JSON.stringify(selectedItems.map((item) => item?.item_option ?? [])),
  };
}

/** Parses non-standard equipment sources without depending on browser state. */
export function resolveCharacterExternalBonuses({
  cashEquipmentData = {},
  petEquipmentData = {},
  otherStatData = {},
  setEffectData = {},
  attackType = "attack",
  presetMode = "active",
} = {}) {
  return {
    cash: cashEquipmentBonuses(cashEquipmentData),
    pet: resolvePetEquipmentBonuses(
      petEquipmentData,
      attackType,
      presetMode,
    ),
    otherStat: otherStatBonuses(otherStatData),
    setEffect: parseSetEffects(setEffectData),
  };
}

const MODELED_SPECIAL_RING_PATTERN =
  /(?:리스트레인트 링|컨티뉴어스 링|웨폰퍼프\s*-\s*[SDIL]링)/u;

// 특수 스킬 반지 효과는 장비 API에는 이름과 레벨만 내려오고, 캐릭터
// 스킬 API에는 해당 반지 스킬이 포함되지 않는다. 장착 레벨만으로도
// 현재(2026-03 개편 이후) 효과를 복원할 수 있도록 공식 수치를 보관한다.
const SPECIAL_RING_LEVEL_EFFECTS = Object.freeze({
  restraint: Object.freeze({
    1: Object.freeze({ duration: 9, cooldown: 120, attackPercent: 17, magicPercent: 17 }),
    2: Object.freeze({ duration: 11, cooldown: 120, attackPercent: 34, magicPercent: 34 }),
    3: Object.freeze({ duration: 13, cooldown: 120, attackPercent: 51, magicPercent: 51 }),
    4: Object.freeze({ duration: 15, cooldown: 120, attackPercent: 68, magicPercent: 68 }),
    5: Object.freeze({ duration: 20, cooldown: 120, attackPercent: 68, magicPercent: 68 }),
    6: Object.freeze({ duration: 20, cooldown: 120, attackPercent: 85, magicPercent: 85 }),
  }),
  continuous: Object.freeze({
    1: Object.freeze({ preparation: 120, duration: 30, attackPercent: 4, magicPercent: 4, bossDamage: 9 }),
    2: Object.freeze({ preparation: 120, duration: 30, attackPercent: 6, magicPercent: 6, bossDamage: 18 }),
    3: Object.freeze({ preparation: 120, duration: 30, attackPercent: 8, magicPercent: 8, bossDamage: 27 }),
    4: Object.freeze({ preparation: 120, duration: 30, attackPercent: 10, magicPercent: 10, bossDamage: 36 }),
    5: Object.freeze({ preparation: 120, duration: 30, attackPercent: 12, magicPercent: 12, bossDamage: 45 }),
    6: Object.freeze({ preparation: 120, duration: 30, attackPercent: 14, magicPercent: 14, bossDamage: 54 }),
  }),
  weaponPuff: Object.freeze({
    1: Object.freeze({ duration: 9, cooldown: 120, weaponMultiplier: 65 }),
    2: Object.freeze({ duration: 11, cooldown: 120, weaponMultiplier: 130 }),
    3: Object.freeze({ duration: 13, cooldown: 120, weaponMultiplier: 195 }),
    4: Object.freeze({ duration: 15, cooldown: 120, weaponMultiplier: 260 }),
  }),
});

function specialRingLevelEffect(ringName, level) {
  const normalizedLevel = Math.trunc(number(level));
  if (!(normalizedLevel > 0)) return null;
  if (/리스트레인트 링/u.test(ringName)) {
    return SPECIAL_RING_LEVEL_EFFECTS.restraint[normalizedLevel] ?? null;
  }
  if (/컨티뉴어스 링/u.test(ringName)) {
    return SPECIAL_RING_LEVEL_EFFECTS.continuous[normalizedLevel] ?? null;
  }
  if (/웨폰퍼프/u.test(ringName)) {
    return SPECIAL_RING_LEVEL_EFFECTS.weaponPuff[normalizedLevel] ?? null;
  }
  return null;
}

function normalizedSpecialRingName(value) {
  return String(value ?? "")
    .trim()
    .replace(/^챌린저스\s+/u, "")
    .replace(/\s*-\s*/gu, " - ");
}

function allCharacterSkills(skillData) {
  const skills = (skillData ?? []).flatMap(
    (grade) => grade.character_skill ?? [],
  ).filter((skill) => skill?.skill_level == null || number(skill.skill_level) > 0);
  // 6차 마스터리 스킬은 원본 스킬을 강화하는 동시에 API 응답에는
  // 원본과 VI가 함께 내려온다. 둘을 별도 스킬로 합산하면 액티브와
  // 패시브 효과가 모두 이중 반영되므로 VI가 있으면 원본을 대체한다.
  const viBaseNames = new Set(
    skills
      .map((skill) => String(skill?.skill_name ?? "").trim())
      .filter(isSixthMasterySkillName)
      .map(withoutSixthMasteryMarker),
  );
  return skills.filter((skill) => {
    const name = String(skill?.skill_name ?? "").trim();
    return isSixthMasterySkillName(name) ||
      !viBaseNames.has(withoutSixthMasteryMarker(name));
  });
}

function matrixSkillCoreSummary(vMatrixData, hexaMatrixData) {
  const summarize = (entries, source) => (entries ?? []).map((entry) => ({
    source,
    name: String(
      entry?.hexa_core_name ?? entry?.v_core_name ?? entry?.core_name ?? "",
    ).trim(),
    type: String(
      entry?.hexa_core_type ?? entry?.v_core_type ?? entry?.core_type ?? "",
    ).trim(),
    level: number(
      entry?.hexa_core_level ?? entry?.v_core_level ?? entry?.core_level,
    ) + number(entry?.slot_level),
    linkedSkills: (entry?.linked_skill ?? entry?.linked_skills ?? [])
      .map((skill) => String(
        skill?.hexa_skill_name ?? skill?.v_skill_name ?? skill?.skill_name ?? "",
      ).trim())
      .filter(Boolean),
  })).filter((entry) => entry.name || entry.linkedSkills.length);
  return [
    ...summarize(vMatrixData?.character_v_core_equipment, "v-matrix"),
    ...summarize(hexaMatrixData?.character_hexa_core_equipment, "hexa-matrix"),
  ];
}

/**
 * 직업 공격군에만 붙는 방무를 대표 연무장 사이클의 피해 점유율과 현재
 * 캐릭터의 스킬·V 강화 상태를 결합해 구성한다. 현재 캐릭터에게 연무장
 * 기록이 있는지는 계산 조건이 아니다.
 */
export function resolveClassDamageChannels({
  characterClass,
  skillData,
  vMatrixData,
} = {}) {
  const discovered = skillLocalIgnoreDefenseChannelsFromSkills(skillData);
  const generalized = generalizedBattlePracticeDamageChannelsFromSkills({
    skillData,
    vMatrixData,
    profile: classBattlePracticeDamageProfile(characterClass),
  });
  return generalized.length ? generalized : discovered;
}

function weaponBasePower(equipmentData) {
  const weapon = activeEquipment(equipmentData).find(
    (item) => item?.item_equipment_slot === "무기",
  );
  const option = weapon?.item_base_option ?? {};
  // 웨폰퍼프는 물리/마법 직업 구분이 아니라 주무기의 기본 공격력과
  // 마력 중 높은 값을 사용한다. 일부 마법 무기도 두 필드를 함께
  // 제공하므로 직업 공격 타입만으로 하나를 고르면 실제 증가량과 달라진다.
  return Math.max(
    number(option.attack_power),
    number(option.magic_power),
  );
}

function activeRingUptime(duration, cooldown, combatDuration) {
  if (!(duration > 0) || !(combatDuration > 0)) return 0;
  if (!(cooldown > 0)) return Math.min(1, duration / combatDuration);
  const uses = Math.max(1, Math.ceil(combatDuration / cooldown));
  return Math.min(1, (duration * uses) / combatDuration);
}

const ACTIVE_SKILL_CYCLE_EXCLUSIONS = new Set([
  // 공통 풀도핑 합계 또는 별도 전용 계산에 이미 들어가는 효과다.
  "영웅의 메아리",
  "익스클루시브 스펠",
  "인탠시브 타임",
  "언다잉 엠버",
  "고급 무기 제련",
  "쓸만한 샤프 아이즈",
  "쓸만한 어드밴스드 블레스",
  "크리티컬 리인포스",
]);

const COMMON_COMBAT_SKILLS = new Set([
  "메이플월드 여신의 축복",
  "여제 시그너스의 축복",
  "초월자 시그너스의 축복",
  "이계 여신의 축복",
  "그란디스 여신의 축복",
  "오라 웨폰",
  "얼티밋 다크 사이트",
  "얼티밋 다크 사이트 VI",
  "프리드의 가호",
  "프리드의 가호 VI",
  "레디 투 다이",
  "로디드 다이스",
]);

// 공식 설명에서 캐릭터의 전체 공격에 적용되는 버프로 확인한 스킬만
// 자동 파서에 통과시킨다. 공격기 자체의 추가 크확·방무·최종 데미지를
// 문장 모양만 보고 캐릭터 스탯으로 오인하지 않도록 하는 안전 경계다.
const VERIFIED_TIMED_SELF_BUFF_SKILLS = new Set([
  "초월 : 최초의 유산",
  "에픽 어드벤쳐",
  "글로리 오브 가디언즈",
  "히어로즈 오쓰",
  "윌 오브 리버티",
  "레이스 오브 갓",
  "데모닉 포티튜드",
  "퀸 오브 투모로우",
  "메이플월드 여신의 축복",
  "여제 시그너스의 축복",
  "초월자 시그너스의 축복",
  "이계 여신의 축복",
  "오라 웨폰",
  "얼티밋 다크 사이트",
  "얼티밋 다크 사이트 VI",
  "도미니언",
  "도미니언 VI",
  "다크 레조넌스",
  "다크 서스트",
  "메타모포시스",
  "메타모포시스 VI",
  "데몬 어웨이크닝",
  "포비든 컨트랙트",
  "파이널 컷",
  "발현 : 햇살 가득 안은 터",
  "아름드리 나무",
  "언페이딩 글로리",
  "로 아이아스",
  "소드 오브 소울 라이트",
  "라이트 오브 커리지",
  "스티뮬레이트",
  "라이트닝 폼",
  "프리퍼레이션",
  "애로우 레인",
  "퀴버 풀버스트",
  "프레이",
  "스포트라이트",
  "무아지경",
  "신뇌합일",
  "불스아이",
  "스칼렛 차지드라이브",
  "스칼렛 차지드라이브 VI",
  "어비스 차지드라이브",
  "어비스 차지드라이브 VI",
  "매직 서킷 풀드라이브",
  "매직 서킷 풀드라이브 VI",
  "파이널 컨트랙트",
  "소울 익절트",
  "환혼요호진",
  "귀문진",
  "타임 디스토션",
  "타임 홀딩",
  "초월자 륀느의 기원",
  "트랜센던트",
  "트랜센던트 VI",
  "리미트 브레이크",
  "상인단 특제 비약",
  "인카네이션",
  "타나토스 디센트",
  "싸이킥 오버",
  "홀리 유니티",
  "선기 : 강림 괴력난신",
  "천지만물",
  "발할라",
  "발할라 VI",
  "콤보 인스팅트",
  "마스테리안 그릿",
  "체인 커맨드",
  "프로페셔널 에이전트",
  "프로페셔널 에이전트 VI",
]);

const MAINTAINED_HIGH_POINT_MODIFIERS = Object.freeze({
  "블리딩 톡신": Object.freeze(["flatAttack"]),
  "히든 블레이드": Object.freeze(["damage"]),
  "히든 블레이드 VI": Object.freeze(["damage"]),
  "포틱 메디테이션": Object.freeze(["flatAttack"]),
  "다크 크레센도": Object.freeze(["damage"]),
  "이그니스 로어": Object.freeze(["finalDamage"]),
  "엘비쉬 블레싱": Object.freeze(["flatAttack"]),
  // 재사용 대기시간 없이 200초 동안 유지되는 메르세데스 자가 버프다.
  // 영구 패시브가 아니므로 Nexon 최종 스탯에는 반영되지 않는다.
  "앤시언트 스피릿": Object.freeze(["attackPercent"]),
  "인커리지": Object.freeze(["flatAttack"]),
  "바이퍼지션": Object.freeze(["attackPercent"]),
  "오펜스 폼": Object.freeze(["damage"]),
  "아케인 에임": Object.freeze(["damage"]),
  "스노우 차지": Object.freeze(["damage"]),
  "블레싱 마하": Object.freeze(["flatAttack"]),
  "메디테이션": Object.freeze(["flatAttack"]),
  "교감": Object.freeze(["damage"]),
  "오닉스의 축복": Object.freeze(["flatAttack"]),
  "소울 게이즈": Object.freeze(["criticalDamage"]),
  "어피니티 IV": Object.freeze(["damage"]),
  "하울링": Object.freeze(["attackPercent"]),
  "약화": Object.freeze(["damage"]),
  "인클라인 파워": Object.freeze(["flatAttack"]),
  "인피니트 레조넌스": Object.freeze(["flatAttack"]),
  "위크포인트 컨버징 어택": Object.freeze(["criticalRate", "criticalDamage"]),
  "블레싱 아머": Object.freeze(["flatAttack"]),
  "저지먼트": Object.freeze(["criticalRate"]),
  "엘리멘트 : 플레임 IV": Object.freeze(["flatAttack"]),
  "스피릿 블레이드": Object.freeze(["flatAttack"]),
  "인사이징": Object.freeze(["damage"]),
  "인사이징 VI": Object.freeze(["damage"]),
  "커스 트랜지션": Object.freeze(["criticalDamage"]),
});

function directDamageIncrease(effect) {
  const text = String(effect ?? "");
  for (const match of text.matchAll(
    /데미지(?:가)?\s*(\d+(?:\.\d+)?)%(?=\s*(?:증가|[,·]))/gu,
  )) {
    const prefix = text.slice(Math.max(0, match.index - 24), match.index);
    if (
      /(?:보스 몬스터 공격 시|일반 몬스터 공격 시|크리티컬|최종|받는|스킬의)\s*$/u
        .test(prefix)
    ) {
      continue;
    }
    const suffix = text.slice(
      match.index + match[0].length,
      text.indexOf("\n", match.index) === -1
        ? text.length
        : text.indexOf("\n", match.index),
    );
    // `데미지 15%, 공격력 15% 증가`처럼 마지막의 `증가`를 여러
    // 옵션이 공유하는 공식 설명을 허용하되, 증가 문구가 없는 공격기
    // 퍼뎀은 전신 버프로 읽지 않는다.
    if (!/^\s*증가/u.test(suffix) && !/^[^\n]*증가/u.test(suffix)) {
      continue;
    }
    return number(match[1]);
  }
  return 0;
}

function directAttackIncrease(effect, attackType, percent) {
  const text = String(effect ?? "");
  const attackName = attackType === "magic" ? "마력" : "공격력";
  const suffix = percent ? "%" : "";
  const pattern = new RegExp(
    `${attackName}(?:이)?\\s*(\\d+(?:\\.\\d+)?)${suffix}` +
      `${percent ? "" : "(?!\\s*%)"}\\s*(?:증가|(?=,))`,
    "u",
  );
  const direct = number(text.match(pattern)?.[1]);
  if (direct > 0) return direct;
  const paired = text.match(
    new RegExp(
      `공격력\\s*(?:과|및|\\/|,)\\s*마력(?:이)?\\s*` +
        `(\\d+(?:\\.\\d+)?)${suffix}` +
        `${percent ? "" : "(?!\\s*%)"}\\s*(?:증가|(?=,))`,
      "u",
    ),
  );
  return number(paired?.[1]);
}

function directCycleSkillModifiers(effect, attackType) {
  // 액티브 설명 뒤의 패시브 효과는 API 최종 스탯 역산에서 따로 처리한다.
  const text = String(effect ?? "").split(/\[패시브 효과\s*:/u)[0];
  const bossDamage = percentFromEffect(
    text,
    /보스 몬스터 공격 시 데미지(?:가)?\s*(\d+(?:\.\d+)?)%(?=\s*(?:증가|[,·]))/u,
  );
  const criticalRate = percentFromEffect(
    text,
    /크리티컬 확률(?:이)?\s*(\d+(?:\.\d+)?)%(?=\s*(?:증가|[,·]))/u,
  );
  const criticalDamage = percentFromEffect(
    text,
    /크리티컬 데미지(?:가)?\s*(\d+(?:\.\d+)?)%(?=\s*(?:증가|[,·]))/u,
  );
  const ignoreDefense = percentFromEffect(
    text,
    /(?:몬스터 )?방어율 무시(?:가)?\s*(\d+(?:\.\d+)?)%(?=\s*(?:증가|[,·]))/u,
  );
  const finalDamage = percentFromEffect(
    text,
    // `최종 데미지 15%, 공격력 20% 증가`처럼 여러 효과가 마지막의
    // `증가`를 함께 쓰는 공식 스킬 설명도 한 묶음으로 읽는다.
    /최종 데미지(?:가)?\s*(\d+(?:\.\d+)?)%(?:(?!\n).)*?\s*증가/u,
  );
  return {
    attackPercent: directAttackIncrease(text, attackType, true),
    flatAttack: directAttackIncrease(text, attackType, false),
    damage: directDamageIncrease(text),
    bossDamage,
    criticalRate,
    criticalDamage,
    ignoreDefense,
    finalDamage,
  };
}

function emptyCycleModifiers() {
  return {
    attackPercent: 0,
    flatAttack: 0,
    damage: 0,
    bossDamage: 0,
    criticalRate: 0,
    criticalDamage: 0,
    ignoreDefense: 0,
    finalDamage: 0,
  };
}

function emptyCycleBaseFlat() {
  return Object.fromEntries(STAT_NAMES.map((stat) => [stat, 0]));
}

function addCycleEvent(result, event, combatDuration) {
  const modifiers = {
    ...emptyCycleModifiers(),
    ...(event.modifiers ?? {}),
  };
  const baseFlat = {
    ...emptyCycleBaseFlat(),
    ...(event.baseFlat ?? {}),
  };
  const duration = number(event.duration);
  const cooldown = number(event.cooldown);
  const uptime = event.uptime === undefined
    ? activeRingUptime(duration, cooldown, combatDuration)
    : number(event.uptime);
  for (const stat of STAT_NAMES) {
    result.baseFlat[stat] += number(baseFlat[stat]) * uptime;
  }
  result.flatAttack += modifiers.flatAttack * uptime;
  result.attackPercent += modifiers.attackPercent * uptime;
  result.damage += modifiers.damage * uptime;
  result.bossDamage += modifiers.bossDamage * uptime;
  result.criticalRate += modifiers.criticalRate * uptime;
  result.criticalDamage += modifiers.criticalDamage * uptime;
  if (modifiers.ignoreDefense > 0) {
    result.ignoreDefenseSources.push(modifiers.ignoreDefense * uptime);
  }
  result.applied.push({
    name: event.name,
    phase: event.phase ?? null,
    model: event.model ?? "verified",
    enhancement: event.enhancement ?? null,
    highPoint: Boolean(event.highPoint),
    duration,
    cooldown,
    offset: number(event.offset),
    uptime,
    layer: event.layer ?? (
      COMMON_COMBAT_SKILLS.has(event.name)
        ? "common-skill"
        : "class-skill"
    ),
    ...modifiers,
    baseFlat,
  });
}

function inferredMaintainedHighPointModifiers(effect, attackType) {
  const text = String(effect ?? "");
  const stackMatch = text.match(/최대\s*(\d+(?:\.\d+)?)회 중첩/u);
  if (!stackMatch) return null;
  const stacks = number(stackMatch[1]);
  if (!(stacks > 0)) return null;

  // 적중하며 빠르게 최대 중첩에 도달하고 지속시간이 갱신되는 버프는
  // 이름별 수치표 대신 공식 설명의 1중첩 수치와 최대 중첩을 사용한다.
  const damage = percentFromEffect(
    text,
    /(?:중첩당\s*)?데미지(?:가)?\s*(\d+(?:\.\d+)?)%\s*증가/u,
  );
  const attackPercent = directAttackIncrease(text, attackType, true);
  const flatAttack = directAttackIncrease(text, attackType, false);
  if (!(damage > 0 || attackPercent > 0 || flatAttack > 0)) return null;
  return {
    damage: damage * stacks,
    attackPercent: attackPercent * stacks,
    flatAttack: flatAttack * stacks,
  };
}

function phaseScopedPermanentEvent(
  skill,
  attackType,
  characterClass,
  combatDuration,
) {
  // 제로처럼 한 캐릭터가 두 전투 폼을 번갈아 쓰는 경우 한 폼에만 붙은
  // 영구 패시브는 전 캐릭터 상시 효과가 아니다. 수치를 이름표로 넣지
  // 않고 공식 설명의 폼 범위와 옵션을 읽어 전투 비중으로 환산한다.
  if (characterClass !== "제로") return null;
  const effect = String(skill?.skill_effect ?? "");
  const permanentLines = effect
    .split(/\r?\n/u)
    .filter((line) => /영구적으로/u.test(line));
  if (!permanentLines.length) return null;
  const scopedText = permanentLines.join("\n");
  const scopes = new Set();
  if (/알파/u.test(scopedText)) scopes.add("alpha");
  if (/베타/u.test(scopedText)) scopes.add("beta");
  if (!scopes.size) return null;
  const modifiers = directCycleSkillModifiers(scopedText, attackType);
  if (!Object.values(modifiers).some((value) => value > 0)) return null;
  return {
    name: String(skill?.skill_name ?? "").trim(),
    phase: [...scopes].join("+"),
    model: "dual-form-weighted-permanent",
    duration: combatDuration,
    cooldown: 0,
    uptime: Math.min(1, scopes.size / 2),
    modifiers,
  };
}

const GRANDIS_NOVA_CLASSES = new Set([
  "카이저",
  "카데나",
  "엔젤릭버스터",
  "카인",
]);
const GRANDIS_LEF_CLASSES = new Set(["아델", "아크", "일리움", "칼리"]);
const GRANDIS_ANIMA_CLASSES = new Set(["호영", "라라", "렌"]);

function grandisLefConvertedAttack(equipmentData, attackType) {
  const otherKey = attackType === "magic" ? "attack_power" : "magic_power";
  const usedKey = attackType === "magic" ? "magic_power" : "attack_power";
  const equipment = activeEquipment(equipmentData ?? {});
  const nonWeaponOppositePower = equipment
    .filter((item) => item?.item_equipment_slot !== "무기")
    .reduce(
      (sum, item) => sum + number(item?.item_total_option?.[otherKey]),
      0,
    );
  const weapon = equipment.find(
    (item) => item?.item_equipment_slot === "무기",
  );
  const weaponCap = number(weapon?.item_base_option?.[usedKey]) * 1.5;
  return weaponCap > 0
    ? Math.min(nonWeaponOppositePower, weaponCap)
    : nonWeaponOppositePower;
}

function grandisGoddessEvent({
  name,
  effect,
  characterClass,
  equipmentData,
  attackType,
}) {
  const duration = percentFromEffect(effect, /(\d+(?:\.\d+)?)초 동안 지속/u);
  const cooldown = percentFromEffect(
    effect,
    /재사용 대기시간\s*:?\s*(\d+(?:\.\d+)?)초/u,
  );
  const modifiers = emptyCycleModifiers();
  const race = GRANDIS_NOVA_CLASSES.has(characterClass) ? "노바"
    : GRANDIS_LEF_CLASSES.has(characterClass) ? "레프"
    : GRANDIS_ANIMA_CLASSES.has(characterClass) ? "아니마"
    : null;
  const raceEffect = race
    ? effect.match(new RegExp(`${race}\\s*:[\\s\\S]*?(?=\\n(?:노바|레프|아니마)\\s*:|$)`, "u"))?.[0]
    : null;
  const reformedFinalDamage = percentFromEffect(
    raceEffect,
    /최종 데미지\s*(\d+(?:\.\d+)?)%\s*증가/u,
  );
  if (reformedFinalDamage > 0) {
    // 1.2.419 공식 API는 종족별 최종 데미지를 반환한다. 특정 공격만
    // 강화하는 아니마 부가 효과와 카이저 상시 패시브는 전역 버프에 합산하지 않는다.
    return {
      name,
      model: "grandis-goddess-final-damage",
      duration,
      cooldown,
      modifiers: { finalDamage: reformedFinalDamage },
    };
  }
  if (GRANDIS_NOVA_CLASSES.has(characterClass)) {
    modifiers.damage = percentFromEffect(
      effect,
      /노바\s*:[\s\S]*?데미지\s*(\d+(?:\.\d+)?)%\s*증가/u,
    );
    if (characterClass === "카이저") {
      const perStage = percentFromEffect(
        effect,
        /모프 게이지 단계당 데미지\s*(\d+(?:\.\d+)?)%/u,
      );
      modifiers.damage += perStage * 3;
    }
  } else if (GRANDIS_LEF_CLASSES.has(characterClass)) {
    const fixedAttack = percentFromEffect(
      effect,
      /공격력과 마력\s*(\d+(?:\.\d+)?)\s*증가/u,
    );
    // 1.2.419에서 장비 반대 공·마 전환이 삭제됐다. 전환 문구가 있는
    // 이전 스냅샷에만 적용하여 새 설명에 과거 효과를 되살리지 않는다.
    const hasEquipmentConversion = /착용[\s\S]*?(?:공격력|마력)[\s\S]*?전환/u.test(effect);
    modifiers.flatAttack = fixedAttack + (hasEquipmentConversion
      ? grandisLefConvertedAttack(equipmentData, attackType)
      : 0);
  } else if (GRANDIS_ANIMA_CLASSES.has(characterClass)) {
    modifiers.damage = percentFromEffect(
      effect,
      /아니마\s*:[\s\S]*?데미지\s*(\d+(?:\.\d+)?)%\s*증가/u,
    );
    if (characterClass === "라라") {
      modifiers.finalDamage = percentFromEffect(
        effect,
        /용맥의 메아리 발동 시 최종 데미지 증가량\s*(\d+(?:\.\d+)?)%/u,
      );
    }
  } else {
    return null;
  }
  return {
    name,
    model: "grandis-goddess-high-point",
    highPoint: true,
    duration,
    cooldown,
    modifiers,
  };
}

function specialCycleEvents({
  skill,
  skills,
  characterClass,
  attackType,
  combatDuration,
  apStats,
  equipmentData,
}) {
  const name = String(skill?.skill_name ?? "").trim();
  const effect = String(skill?.skill_effect ?? "");
  const cooldown = percentFromEffect(
    effect,
    /재사용 대기시간\s*:?\s*(\d+(?:\.\d+)?)초/u,
  );

  if (name === "그란디스 여신의 축복") {
    const event = grandisGoddessEvent({
      name,
      effect,
      characterClass,
      equipmentData,
      attackType,
    });
    return event ? [event] : [];
  }

  if (name === "프리드의 가호 VI") {
    const flatAttack = directAttackIncrease(effect, attackType, false);
    const bossDamage = percentFromEffect(
      effect,
      /60초 동안 보스 몬스터 공격 시 데미지\s*(\d+(?:\.\d+)?)%/u,
    );
    return [
      {
        name,
        phase: "공격력·마력",
        model: "freud-vi-high-point",
        highPoint: true,
        duration: 90,
        cooldown,
        modifiers: { flatAttack },
      },
      {
        name,
        phase: "보스 데미지",
        model: "freud-vi-high-point",
        highPoint: true,
        duration: 60,
        cooldown,
        modifiers: { bossDamage },
      },
    ];
  }

  if (name === "프리드의 가호") {
    const allStat = percentFromEffect(effect, /3중첩\s*:\s*올스탯\s*(\d+)/u);
    const flatAttack = percentFromEffect(
      effect,
      /4중첩\s*:\s*공격력\/마력\s*(\d+)/u,
    );
    const bossDamage = percentFromEffect(
      effect,
      /5중첩\s*:\s*보스 몬스터 공격 시 데미지\s*(\d+)%/u,
    );
    return [{
      name,
      model: "freud-six-stack-high-point",
      highPoint: true,
      duration: 30,
      cooldown: percentFromEffect(
        effect,
        /최대 중첩이 되면 재사용 대기시간\s*(\d+(?:\.\d+)?)초/u,
      ) || 240,
      baseFlat: Object.fromEntries(STAT_NAMES.map((stat) => [stat, allStat])),
      modifiers: { flatAttack, bossDamage },
    }];
  }

  if (name === "로디드 다이스") {
    const hasDoubleDice = skills.some(
      (candidate) => candidate?.skill_name === "더블 럭키 다이스",
    );
    return [{
      name,
      model: "loaded-dice-five-high-point",
      highPoint: true,
      duration: combatDuration,
      cooldown: 0,
      modifiers: { damage: hasDoubleDice ? 30 : 20 },
    }];
  }

  if (name === "레디 투 다이") {
    return [{
      name,
      model: "ready-to-die-stage-two",
      highPoint: true,
      duration: 15,
      cooldown,
      modifiers: {
        finalDamage: percentFromEffect(
          effect,
          /2단계\s*:\s*최종 데미지\s*(\d+(?:\.\d+)?)%/u,
        ),
      },
    }];
  }

  if (name === "데몬 어웨이크닝") {
    return [{
      name,
      model: "demon-awakening-self-buff-only",
      duration: percentFromEffect(effect, /(\d+(?:\.\d+)?)초 동안/u),
      cooldown,
      // 강화 데몬 슬래시만 받는 보공·방무는 전신 스탯에서 제외한다.
      modifiers: {
        criticalRate: percentFromEffect(
          effect,
          /지속 중 크리티컬 확률\s*(\d+(?:\.\d+)?)%\s*증가/u,
        ),
      },
    }];
  }

  if (name === "질풍" || name === "태풍" || name === "태풍 VI") {
    const preferredTyphoon = skills.find(
      (candidate) => candidate?.skill_name === "태풍 VI",
    ) ?? skills.find((candidate) => candidate?.skill_name === "태풍");
    if (name === "질풍" && preferredTyphoon) return [];
    const lightning = skills.find(
      (candidate) => candidate?.skill_name === "엘리멘트 : 라이트닝",
    );
    const maxStacks = percentFromEffect(
      lightning?.skill_effect,
      /뇌전 버프는 최대\s*(\d+(?:\.\d+)?)회/u,
    ) || 2;
    const perStack = percentFromEffect(
      effect,
      /사용한 뇌전 버프 1개당 데미지\s*(\d+(?:\.\d+)?)%/u,
    );
    return [{
      name,
      model: "typhoon-max-lightning-stack",
      highPoint: true,
      duration: percentFromEffect(
        effect,
        /데미지\s*\d+(?:\.\d+)?%\s*증가 버프가\s*(\d+(?:\.\d+)?)초/u,
      ),
      cooldown,
      modifiers: { damage: perStack * maxStacks },
    }];
  }

  if (name === "타임 홀딩") {
    return [{
      name,
      model: "time-holding-damage-phase",
      duration: percentFromEffect(
        effect,
        /사용 후\s*(\d+(?:\.\d+)?)초 동안 데미지/u,
      ),
      cooldown,
      modifiers: {
        damage: percentFromEffect(
          effect,
          /사용 후\s*\d+(?:\.\d+)?초 동안 데미지\s*(\d+(?:\.\d+)?)%/u,
        ),
      },
    }];
  }

  if (name === "트랜센던트 VI" || name === "트랜센던트") {
    const life = effect.match(
      /생명의 축복\s*(\d+(?:\.\d+)?)초 동안 지속[\s\S]*?최종 데미지\s*(\d+(?:\.\d+)?)%\s*증가/u,
    );
    return [{
      name,
      model: "transcendent-life-blessing",
      duration: number(life?.[1]),
      cooldown,
      modifiers: { finalDamage: number(life?.[2]) },
    }];
  }

  if (name === "아르카나 오버라이드 VI") {
    const totalDuration = percentFromEffect(
      effect,
      /(\d+(?:\.\d+)?)초 동안 지속/u,
    );
    const first = effect.match(
      /(\d+(?:\.\d+)?)초 동안 최종 데미지\s*(\d+(?:\.\d+)?)%,\s*마력\s*(\d+(?:\.\d+)?)%\s*증가/u,
    );
    const reduced = effect.match(
      /이후.*?최종 데미지\s*(\d+(?:\.\d+)?)%,\s*마력\s*(\d+(?:\.\d+)?)%\s*증가/u,
    );
    const firstDuration = number(first?.[1]);
    return [
      {
        name,
        phase: "최대 개방",
        model: "arcana-override-two-phase",
        highPoint: true,
        duration: firstDuration,
        cooldown,
        modifiers: {
          finalDamage: number(first?.[2]),
          attackPercent: number(first?.[3]),
        },
      },
      {
        name,
        phase: "개방 감소",
        model: "arcana-override-two-phase",
        duration: Math.max(0, totalDuration - firstDuration),
        cooldown,
        offset: firstDuration,
        modifiers: {
          finalDamage: number(reduced?.[1]),
          attackPercent: number(reduced?.[2]),
        },
      },
    ];
  }

  if (name === "아르카나 오버라이드") {
    return [{
      name,
      model: "arcana-override",
      duration: percentFromEffect(effect, /(\d+(?:\.\d+)?)초 동안/u),
      cooldown,
      modifiers: directCycleSkillModifiers(effect, attackType),
    }];
  }

  if (name === "파이렛 플래그 VI" || name === "파이렛 플래그") {
    const apPercent = percentFromEffect(
      effect,
      /(?:자신의|파티원의) AP를 직접 투자한 모든 능력치\s*(\d+(?:\.\d+)?)%/u,
    );
    const baseFlat = Object.fromEntries(
      STAT_NAMES.map((stat) => [stat, number(apStats[stat]) * apPercent / 100]),
    );
    return [{
      name,
      model: "pirate-flag-maintained-high-point",
      highPoint: true,
      duration: combatDuration,
      cooldown: 0,
      baseFlat,
      modifiers: {
        flatAttack: directAttackIncrease(effect, attackType, false),
        criticalDamage: percentFromEffect(
          effect,
          /크리티컬 데미지\s*(\d+(?:\.\d+)?)%/u,
        ),
        ignoreDefense: percentFromEffect(
          effect,
          /몬스터 방어율 무시\s*(\d+(?:\.\d+)?)%/u,
        ),
      },
    }];
  }

  if (name === "로얄 가드 VI" || name === "로얄 가드") {
    const attacks = [...effect.matchAll(/공격력\s*(\d+(?:\.\d+)?)\s*증가/gu)]
      .map((match) => number(match[1]));
    return [{
      name,
      model: "royal-guard-max-stack",
      highPoint: true,
      duration: combatDuration,
      cooldown: 0,
      modifiers: { flatAttack: Math.max(0, ...attacks) },
    }];
  }

  if (name === "프라이멀 퓨리 VI" || name === "프라이멀 퓨리") {
    return [{
      name,
      model: "primal-fury-max-extension",
      highPoint: true,
      duration: 60,
      cooldown,
      modifiers: {
        damage: percentFromEffect(
          effect,
          /초 동안 데미지\s*(\d+(?:\.\d+)?)%\s*증가/u,
        ),
      },
    }];
  }

  if (name === "조커") {
    return [{
      name,
      model: "joker-card-high-point",
      highPoint: true,
      duration: 30,
      cooldown,
      modifiers: {
        finalDamage: percentFromEffect(
          effect,
          /날카로운 검\s*:\s*최종 데미지\s*(\d+(?:\.\d+)?)%/u,
        ),
      },
    }];
  }

  if (name === "샐리맨더 미스칩") {
    const perStack = percentFromEffect(effect, /불씨 1개 마다 마력\s*(\d+)/u);
    const stacks = percentFromEffect(effect, /불씨는 최대\s*(\d+)개/u);
    const fixed = percentFromEffect(effect, /초 동안 마력\s*(\d+)\s*증가/u);
    return [{
      name,
      model: "salamander-max-embers",
      highPoint: true,
      duration: 20,
      cooldown,
      offset: 40,
      modifiers: { flatAttack: fixed + perStack * stacks },
    }];
  }

  return null;
}

function maintainedHighPointModifiers(name, effect, attackType, characterClass) {
  if (name === "저지먼트" && characterClass !== "팬텀") return null;
  const configured = MAINTAINED_HIGH_POINT_MODIFIERS[name];
  if (!configured) return null;
  // 이름표는 전신 버프의 범위만 제한한다. 실제 수치는 최신 API의
  // 현재 스킬 레벨 설명에서 읽으며 삭제된 효과는 이전 값으로 대체하지 않는다.
  const current = directCycleSkillModifiers(effect, attackType);
  const result = Object.fromEntries(
    configured.map((key) => [key, number(current[key])]),
  );
  if (name === "아케인 에임" || name === "다크 크레센도") {
    const stacks = percentFromEffect(effect, /최대\s*(\d+)\s*(?:회|번)(?:까지)?/u);
    result.damage *= Math.max(1, stacks);
  }
  return Object.values(result).some((value) => value > 0) ? result : null;
}

function skillEnhancementOverride(skillName, skills, duration, modifiers) {
  const baseName = withoutSixthMasteryMarker(skillName);
  const enhancement = skills.find(
    (skill) => String(skill?.skill_name ?? "").trim() === `${baseName} 강화`,
  );
  const effect = String(enhancement?.skill_effect ?? "");
  if (!effect) return { duration, modifiers, enhancement: null };

  const enhancedDuration = percentFromEffect(
    effect,
    /지속시간\s*(\d+(?:\.\d+)?)초/u,
  );
  const result = { ...modifiers };
  if (baseName === "체인 커맨드") {
    // 기본 스킬의 15%와 강화 스킬의 20% 모두 오버로드 스킬 전용이다.
    result.finalDamage = 0;
  }
  const finalDamage = percentFromEffect(
    effect,
    /최종 데미지 증가량\s*(\d+(?:\.\d+)?)%/u,
  ) || percentFromEffect(
    effect,
    /홀리 유니티로 증가하는 최종 데미지\s*(\d+(?:\.\d+)?)%/u,
  );
  // 체인 커맨드 강화의 최종 데미지는 모든 공격이 아니라 오버로드
  // 스킬에만 적용된다. 공용 전투 사이클의 전역 최종 데미지로 넣으면
  // 레테의 모든 공격을 30초 동안 강화하는 것으로 과대 계산된다.
  if (finalDamage > 0 && baseName !== "체인 커맨드") {
    result.finalDamage = finalDamage;
  }

  const damage = percentFromEffect(
    effect,
    /(?<!최종 )데미지 증가량\s*(\d+(?:\.\d+)?)%/u,
  );
  if (damage > 0) result.damage = damage;

  const selfFinalDamageBonus = percentFromEffect(
    effect,
    /비숍의 최종 데미지\s*(\d+(?:\.\d+)?)%\s*추가 증가/u,
  );
  if (selfFinalDamageBonus > 0) {
    result.finalDamage += selfFinalDamageBonus;
  }
  return {
    duration: enhancedDuration || duration,
    modifiers: result,
    enhancement: String(enhancement.skill_name),
  };
}

/**
 * API에 공개된 5차·하이퍼 액티브의 직접 스탯 버프를 전투 시간 평균으로
 * 환산한다. 공격 스킬 자체의 퍼뎀이나 특정 스킬만 강화하는 효과는
 * 일반 장비 옵션의 한계 가치에 섞지 않는다.
 */
export function calculateActiveSkillCycleBonuses(
  skillData,
  attackType,
  combatDuration,
  {
    apStats = {},
    mapleWarriorPercent = 0,
    characterClass = "",
    equipmentData = null,
  } = {},
) {
  const result = {
    baseFlat: Object.fromEntries(STAT_NAMES.map((stat) => [stat, 0])),
    flatAttack: 0,
    attackPercent: 0,
    damage: 0,
    bossDamage: 0,
    criticalRate: 0,
    criticalDamage: 0,
    ignoreDefenseSources: [],
    applied: [],
    baselineReflected: [],
  };
  const skills = allCharacterSkills(skillData);
  for (const skill of skills) {
    const name = String(skill?.skill_name ?? "").trim();
    const effect = String(skill?.skill_effect ?? "");
    if (
      !name ||
      ACTIVE_SKILL_CYCLE_EXCLUSIONS.has(name) ||
      MODELED_SPECIAL_RING_PATTERN.test(name)
    ) {
      continue;
    }

    const phaseScopedPermanent = phaseScopedPermanentEvent(
      skill,
      attackType,
      characterClass,
      combatDuration,
    );
    if (phaseScopedPermanent) {
      addCycleEvent(result, phaseScopedPermanent, combatDuration);
      continue;
    }

    if (isBaselineReflectedSkill(skill)) {
      result.baselineReflected.push(name);
      continue;
    }

    const specialEvents = specialCycleEvents({
      skill,
      skills,
      characterClass,
      attackType,
      combatDuration,
      apStats,
      equipmentData,
    });
    if (specialEvents !== null) {
      for (const event of specialEvents) {
        addCycleEvent(result, event, combatDuration);
      }
      continue;
    }

    const maintainedModifiers =
      inferredMaintainedHighPointModifiers(effect, attackType) ??
      maintainedHighPointModifiers(
        name,
        effect,
        attackType,
        characterClass,
      );
    if (maintainedModifiers) {
      addCycleEvent(
        result,
        {
          name,
          model: "maintained-high-point",
          highPoint: true,
          duration: combatDuration,
          cooldown: 0,
          modifiers: maintainedModifiers,
        },
        combatDuration,
      );
      continue;
    }

    if (!VERIFIED_TIMED_SELF_BUFF_SKILLS.has(name)) continue;
    const duration = percentFromEffect(effect, /(\d+(?:\.\d+)?)초 동안/u);
    const cooldown = percentFromEffect(
      effect,
      /재사용 대기시간\s*:?\s*(\d+(?:\.\d+)?)초/u,
    );
    if (!(duration > 0) || !(cooldown > 0)) continue;
    const modifiers = directCycleSkillModifiers(effect, attackType);
    const goddessMultiplier = percentFromEffect(
      effect,
      /메이플 용사로 증가된 모든 능력치의\s*(\d+(?:\.\d+)?)%\s*추가 증가/u,
    );
    if (
      !Object.values(modifiers).some((value) => value > 0) &&
      !(goddessMultiplier > 0)
    ) {
      continue;
    }
    const baseFlat = Object.fromEntries(
      STAT_NAMES.map((stat) => [
        stat,
        goddessMultiplier > 0
          ? number(apStats[stat]) *
            (number(mapleWarriorPercent) / 100) *
            (goddessMultiplier / 100)
          : 0,
      ]),
    );
    const enhanced = skillEnhancementOverride(
      name,
      skills,
      duration,
      modifiers,
    );
    addCycleEvent(
      result,
      {
        name,
        duration: enhanced.duration,
        cooldown,
        modifiers: enhanced.modifiers,
        baseFlat,
        ...(enhanced.enhancement
          ? { model: "verified-with-enhancement", enhancement: enhanced.enhancement }
          : {}),
      },
      combatDuration,
    );
  }
  return result;
}

function ringSourceItems(equipmentData, ringReserveData) {
  const equipmentItems = equipmentData?.item_equipment ?? [];
  const hasReserveSlot = equipmentItems.some(
    (item) => String(item?.item_equipment_slot ?? "") === "예비 특수 반지",
  );
  const items = equipmentItems
    .filter((item) => MODELED_SPECIAL_RING_PATTERN.test(String(item?.item_name ?? "")))
    .map((item) => ({
      name: String(item.item_name),
      level: number(item.special_ring_level),
      slot: String(item.item_equipment_slot ?? "반지"),
    }));
  const reserveName = String(
    ringReserveData?.special_ring_reserve_name ?? "",
  ).trim();
  // 프리셋 장비 응답에 예비 슬롯이 있으면 그 프리셋 값을 우선한다.
  // 별도 API는 구형/축약 응답에 예비 슬롯이 빠졌을 때만 보완 자료로 쓴다.
  if (!hasReserveSlot && MODELED_SPECIAL_RING_PATTERN.test(reserveName)) {
    items.push({
      name: reserveName,
      level: number(ringReserveData?.special_ring_reserve_level),
      slot: "추가 특수 반지",
    });
  }
  const unique = new Map();
  for (const item of items) {
    const name = normalizedSpecialRingName(item.name);
    if (!unique.has(name)) unique.set(name, { ...item, name });
  }
  return [...unique.values()];
}

function percentFromEffect(effect, pattern) {
  return number(String(effect).match(pattern)?.[1]);
}

function weaponPuffEffect(
  effect,
  ringName,
  equipmentData,
  configuredMultiplier = 0,
) {
  const text = String(effect ?? "");
  const statFromName = {
    S: "STR",
    D: "DEX",
    I: "INT",
    L: "LUK",
  }[ringName.match(/웨폰퍼프\s*-\s*([SDIL])링/u)?.[1]];
  const matchedStat = text.match(/(STR|DEX|INT|LUK|힘|민첩|지력|지능|행운)\s*증가/u)?.[1];
  const stat = KOREAN_STAT_NAMES[matchedStat] ?? matchedStat ?? statFromName;
  const multiplier = number(configuredMultiplier) || percentFromEffect(
    text,
    /주무기(?:의)?(?:\s*기본)?\s*(?:공격력|마력)(?:의)?\s*(\d+(?:\.\d+)?)%/u,
  ) || percentFromEffect(text, /(\d+(?:\.\d+)?)%만큼/u);
  const basePower = weaponBasePower(equipmentData);
  return {
    stat,
    multiplier,
    basePower,
    flat: stat && multiplier > 0 && basePower > 0
      ? Math.floor((basePower * multiplier) / 100)
      : 0,
  };
}

/**
 * 장착한 액티브 특수 반지와 추가 슬롯의 패시브 반지를 보스전의
 * 피해 기여도로 환산한다. 컨티뉴어스 링은 보스 입장 시 준비 상태가
 * 초기화되고 재발동 대기시간이 없어 전투 중 상시 패시브로 본다.
 * 액티브 링은 연무장 타임라인에서 측정한 직업별 극딜 구간 피해 비중을
 * 사용하며, 프로필이 없는 경우에만 지속시간 비율로 보수적으로 대체한다.
 */
export function calculateCombatRingBonuses(
  equipmentData,
  ringReserveData,
  skillData,
  attackType,
  combatDuration,
  characterClass = null,
) {
  const result = {
    ...emptyBonuses(),
    applied: [],
    combatDuration,
  };
  const skills = allCharacterSkills(skillData);
  for (const ring of ringSourceItems(equipmentData, ringReserveData)) {
    const skill = skills.find(
      (candidate) =>
        normalizedSpecialRingName(candidate?.skill_name) === ring.name,
    );
    const effect = String(skill?.skill_effect ?? "");
    const level = number(skill?.skill_level) || ring.level || null;
    const configured = specialRingLevelEffect(ring.name, level);
    if (!effect && !configured) continue;

    let uptime = 0;
    let timeUptime = 0;
    let damageCoverage = null;
    let activationMode = "cycle-time-fallback";
    let duration = 0;
    let cooldown = 0;
    let preparation = 0;
    let flatStat = null;
    if (/컨티뉴어스 링/u.test(ring.name)) {
      preparation = number(configured?.preparation) || percentFromEffect(
        effect,
        /(\d+(?:\.\d+)?)초 동안 준비/u,
      );
      duration = number(configured?.duration) || percentFromEffect(
        effect,
        /스킬 사용 시\s*(\d+(?:\.\d+)?)초 동안/u,
      );
      // 보스 입장 시 준비시간이 초기화되고, 재발동 대기시간 없이 공격
      // 스킬로 30초 효과가 계속 갱신된다. 따라서 실제 보스 딜 구간에서는
      // 준비시간 120초를 전투시간에서 다시 차감하지 않는다.
      timeUptime = 1;
      damageCoverage = 1;
      uptime = 1;
      activationMode = "boss-entry-maintained";
    } else {
      duration = number(configured?.duration) || percentFromEffect(
        effect,
        /(\d+(?:\.\d+)?)초 동안/u,
      );
      cooldown = number(configured?.cooldown) || percentFromEffect(
        effect,
        /재사용 대기시간\s*(\d+(?:\.\d+)?)초/u,
      );
      timeUptime = activeRingUptime(duration, cooldown, combatDuration);
      damageCoverage = specialRingBurstDamageShare(
        characterClass,
        duration,
      );
      uptime = damageCoverage ?? timeUptime;
      activationMode = damageCoverage === null
        ? "cycle-time-fallback"
        : "battle-practice-damage-weighted";
    }

    // 실제 API 문구는 "공격력이 68%, 마력이 68% 증가"처럼 앞쪽
    // 수치 뒤에 곧바로 쉼표가 온다. 각 항목 뒤의 '증가'를 강제하면
    // 공격력만 0으로 누락되므로 쉼표로 이어지는 병렬 문장도 허용한다.
    const attackPercent = number(configured?.attackPercent) || percentFromEffect(
      effect,
      /공격력(?:이)?\s*(\d+(?:\.\d+)?)%(?=\s*(?:증가|[,·]))/u,
    );
    const magicPercent = number(configured?.magicPercent) || percentFromEffect(
      effect,
      /마력(?:이)?\s*(\d+(?:\.\d+)?)%(?=\s*(?:증가|[,·]))/u,
    );
    const bossDamage = number(configured?.bossDamage) || percentFromEffect(
      effect,
      /보스 몬스터 공격 시 데미지(?:가)?\s*(\d+(?:\.\d+)?)%\s*증가/u,
    );
    if (/웨폰퍼프/u.test(ring.name)) {
      flatStat = weaponPuffEffect(
        effect,
        ring.name,
        equipmentData,
        configured?.weaponMultiplier,
      );
      if (flatStat.stat && flatStat.flat > 0) {
        result.flat[flatStat.stat] += flatStat.flat * uptime;
      }
    } else {
      result.attackPercent += attackPercent * uptime;
      result.magicPercent += magicPercent * uptime;
      result.bossDamage += bossDamage * uptime;
    }
    result.applied.push({
      name: ring.name,
      level,
      slot: ring.slot,
      uptime,
      timeUptime,
      damageCoverage,
      activationMode,
      duration,
      cooldown,
      preparation,
      attackPercent,
      magicPercent,
      bossDamage,
      averageAttackPercent: attackPercent * uptime,
      averageMagicPercent: magicPercent * uptime,
      averageBossDamage: bossDamage * uptime,
      source: configured ? "current-level-table" : "skill-api",
      phaseProfileId:
        activationMode === "battle-practice-damage-weighted"
          ? classSpecialRingPhaseProfile(characterClass)?.id ?? null
          : null,
      ...(flatStat
        ? {
            weaponPuffStat: flatStat.stat,
            weaponPuffMultiplier: flatStat.multiplier,
            weaponBasePower: flatStat.basePower,
            averageFlatStat: flatStat.flat * uptime,
          }
        : {}),
    });
  }
  return result;
}

function titleBonuses(equipmentData) {
  return parseTextBonuses([equipmentData.title?.title_description]);
}

function otherStatBonuses(otherStatData) {
  const result = emptyBonuses();
  for (const entry of otherStatData?.other_stat ?? []) {
    for (const statInfo of entry.stat_info ?? []) {
      const name = String(statInfo.stat_name ?? "").trim();
      const value = number(statInfo.stat_value);
      const percentMatch = name.match(/^(STR|DEX|INT|LUK)\s*\(\+%\)$/);
      if (percentMatch) {
        result.percent[percentMatch[1]] += value;
      } else if (STAT_NAMES.includes(name)) {
        result.flat[name] += value;
      } else if (name === "올스탯") {
        for (const stat of STAT_NAMES) result.flat[stat] += value;
      } else if (name === "올스탯 (+%)") {
        for (const stat of STAT_NAMES) result.percent[stat] += value;
      } else if (name === "최대 HP" || name === "HP") {
        result.flatHp += value;
      } else if (name === "최대 HP (+%)" || name === "HP (+%)") {
        result.hpPercent += value;
      } else if (name === "공격력") {
        result.flatAttack += value;
      } else if (name === "마력") {
        result.flatMagic += value;
      } else if (name === "공격력 (+%)") {
        result.attackPercent += value;
      } else if (name === "마력 (+%)") {
        result.magicPercent += value;
      } else if (name === "데미지 (+%)") {
        result.damage += value;
      } else if (name === "보스 몬스터 데미지 (+%)") {
        result.bossDamage += value;
      } else if (name === "크리티컬 확률 (+%)") {
        result.criticalRate += value;
      } else if (name === "크리티컬 데미지 (+%)") {
        result.criticalDamage += value;
      } else if (name === "몬스터 방어율 무시 (+%)" || name === "방어율 무시 (+%)") {
        result.ignoreDefenseSources.push(value);
      }
    }
  }
  return result;
}

function passiveSkillTexts(skillData) {
  const texts = [];
  const skills = allCharacterSkills(skillData);
  for (const skill of skills) {
    const effect = String(skill.skill_effect ?? "");
    const description = String(skill.skill_description ?? "");
    const passiveSegments = [
      ...effect.matchAll(/\[패시브 효과\s*:\s*([^\]]+)\]/g),
    ].map((match) => match[1]);
    if (passiveSegments.length) {
      texts.push(...passiveSegments);
      continue;
    }

    const hasTemporaryEffect =
      /\d+(?:\.\d+)?초 동안|재사용 대기시간|MP\s*\d+\s*소비/.test(effect);
    if (/영구/.test(`${description}\n${effect}`) || !hasTemporaryEffect) {
      texts.push(effect);
    }
  }
  return texts;
}

function skillBonuses(skillData) {
  return parseTextBonuses(passiveSkillTexts(skillData));
}

// 공개 API에서 확인한 공용 패시브와 이벤트 스킬의 표시용 내역이다.
// 실제 환산은 final_stat을 기준으로 하므로 이 값을 다시 더하지 않는다.
export function characterBaselineSkillSummary(skillData) {
  const commonPassives = new Set([
    "스파이더 인 미러", "크레스트 오브 더 솔라",
    "에르다 퍼미에이션", "쓸만한 홀리 파운틴",
  ]);
  const eventSkills = new Set(["훈련 일지", "아르고 호의 가호"]);
  return allCharacterSkills(skillData).flatMap((skill) => {
    const name = String(skill?.skill_name ?? "").trim();
    const event = eventSkills.has(name);
    if (!event && !commonPassives.has(name)) return [];
    const effect = String(skill?.skill_effect ?? "");
    const texts = event ? [effect] : [...effect.matchAll(
      /\[패시브 효과\s*:\s*([^\]]+)\]/gu,
    )].map((match) => match[1]);
    if (!texts.length || !texts.some((text) => text.trim())) return [];
    const bonuses = parseTextBonuses(texts);
    return [{
      name,
      level: number(skill.skill_level),
      kind: event ? "event" : "common-passive",
      includedInBaseline: true,
      effects: {
        attack: bonuses.flatAttack,
        magic: bonuses.flatMagic,
        allStat: bonuses.flat.STR,
        damage: bonuses.damage,
        bossDamage: bonuses.bossDamage,
        criticalRate: bonuses.criticalRate,
        criticalDamage: bonuses.criticalDamage,
        ignoreDefenseSources: bonuses.ignoreDefenseSources,
      },
    }];
  });
}

function learnedSkillNames(skillData) {
  return new Set(
    allCharacterSkills(skillData)
      .map((skill) => String(skill?.skill_name ?? "").trim())
      .filter(Boolean),
  );
}

export function resolveClassAlwaysOnCombatAdjustment(characterClass, skillData) {
  const policy = CLASS_ALWAYS_ON_COMBAT[characterClass];
  if (!policy) {
    return {
      adjustment: {},
      defaultMode: null,
      sources: [],
      learnedSkillSources: [],
    };
  }

  const skills = learnedSkillNames(skillData);
  const adjustment = {
    damage: number(policy.damage),
    bossDamage: number(policy.bossDamage),
    criticalDamage: number(policy.criticalDamage),
    attackMagic: number(policy.attackMagic),
    ignoreDefenseSources: [...(policy.ignoreDefenseSources ?? [])],
  };
  const learnedSkillSources = [];
  for (const [skillName, learnedAdjustment] of Object.entries(
    policy.learnedSkillAdjustments ?? {},
  )) {
    if (!skills.has(skillName)) continue;
    learnedSkillSources.push(skillName);
    adjustment.damage += number(learnedAdjustment.damage);
    adjustment.bossDamage += number(learnedAdjustment.bossDamage);
    adjustment.criticalDamage += number(learnedAdjustment.criticalDamage);
    adjustment.attackMagic += number(learnedAdjustment.attackMagic);
    adjustment.ignoreDefenseSources.push(
      ...(learnedAdjustment.ignoreDefenseSources ?? []),
    );
  }
  return {
    adjustment,
    defaultMode: policy.defaultMode ?? null,
    sources: [...(policy.sources ?? [])],
    learnedSkillSources,
  };
}

function sharpEyesHyperCriticalRate(skillData) {
  const skill = (skillData ?? [])
    .flatMap((grade) => grade.character_skill ?? [])
    .find((candidate) => candidate?.skill_name === "샤프 아이즈-크리티컬 레이트");
  const match = String(skill?.skill_effect ?? "").match(
    /크리티컬 확률(?:이)?\s*\+?\s*(\d+(?:\.\d+)?)%/,
  );
  return number(match?.[1]);
}

function learnedSkill(skillData, skillName) {
  return allCharacterSkills(skillData).find(
    (candidate) => String(candidate?.skill_name ?? "").trim() === skillName,
  );
}

function skillAverageUptime(skillData, skillName, fallback = 0) {
  const effect = String(learnedSkill(skillData, skillName)?.skill_effect ?? "");
  if (!effect) return 0;
  const duration = percentFromEffect(effect, /(\d+(?:\.\d+)?)초 동안/u);
  const cooldown = percentFromEffect(
    effect,
    /재사용 대기시간\s*(\d+(?:\.\d+)?)초/u,
  );
  return duration > 0 && cooldown > 0
    ? Math.min(1, duration / cooldown)
    : fallback;
}

function cycleEventActive(event, elapsed) {
  const preparation = number(event?.preparation);
  if (preparation > 0) return elapsed >= preparation;
  const offset = number(event?.offset);
  const shiftedElapsed = elapsed - offset;
  if (shiftedElapsed < 0) return false;
  const duration = number(event?.duration);
  const cooldown = number(event?.cooldown);
  if (!(duration > 0)) return false;
  if (!(cooldown > 0)) return shiftedElapsed < duration;
  return shiftedElapsed % cooldown < duration;
}

function weightedCriticalReinforceUptime({
  skillData,
  activeSkillCycle,
  combatRing,
  combatDuration,
  attackType,
  baseAttackPercent,
  baseFlatAttack,
  baseDamageTotal,
  baseStatTerm,
  mainStat,
  subStats,
  mainPercent,
  subPercents,
}) {
  const skill = learnedSkill(skillData, "크리티컬 리인포스");
  const effect = String(skill?.skill_effect ?? "");
  const duration = percentFromEffect(effect, /(\d+(?:\.\d+)?)초 동안/u);
  const cooldown = percentFromEffect(
    effect,
    /재사용 대기시간\s*:?\s*(\d+(?:\.\d+)?)초/u,
  );
  if (!(duration > 0) || !(cooldown > 0) || !(combatDuration > 0)) return 0;

  let totalWeight = 0;
  let activeWeight = 0;
  const step = Math.min(1, combatDuration);
  for (let elapsed = step / 2; elapsed < combatDuration; elapsed += step) {
    let attackPercentBonus = 0;
    let flatAttackBonus = 0;
    let damageBonus = 0;
    let statTermBonus = 0;
    let finalDamageMultiplier = 1;
    for (const event of activeSkillCycle?.applied ?? []) {
      if (!cycleEventActive(event, elapsed)) continue;
      attackPercentBonus += number(event.attackPercent);
      flatAttackBonus += number(event.flatAttack);
      damageBonus += number(event.damage) + number(event.bossDamage);
      finalDamageMultiplier *= 1 + number(event.finalDamage) / 100;
      statTermBonus +=
        4 * number(event.baseFlat?.[mainStat]) * (1 + mainPercent / 100) +
        subStats.reduce(
          (sum, stat) =>
            sum +
            number(event.baseFlat?.[stat]) *
              (1 + number(subPercents?.[stat]) / 100),
          0,
        );
    }
    for (const event of combatRing?.applied ?? []) {
      if (!cycleEventActive(event, elapsed)) continue;
      attackPercentBonus += attackType === "magic"
        ? number(event.magicPercent)
        : number(event.attackPercent);
      damageBonus += number(event.bossDamage);
      const ringStat = String(event.weaponPuffStat ?? "");
      const ringUptime = number(event.uptime);
      const ringFlat = ringUptime > 0
        ? number(event.averageFlatStat) / ringUptime
        : 0;
      if (ringStat === mainStat) statTermBonus += 4 * ringFlat;
      else if (subStats.includes(ringStat)) statTermBonus += ringFlat;
    }
    const attackWeight = (100 + baseAttackPercent + attackPercentBonus) /
      Math.max(1, 100 + baseAttackPercent);
    const flatAttackWeight = (baseFlatAttack + flatAttackBonus) /
      Math.max(1, baseFlatAttack);
    const damageWeight = (100 + baseDamageTotal + damageBonus) /
      Math.max(1, 100 + baseDamageTotal);
    const statWeight = (baseStatTerm + statTermBonus) /
      Math.max(1, baseStatTerm);
    const weight =
      attackWeight *
      flatAttackWeight *
      damageWeight *
      statWeight *
      finalDamageMultiplier;
    totalWeight += weight;
    if (elapsed % cooldown < duration) activeWeight += weight;
  }
  return totalWeight > 0 ? activeWeight / totalWeight : duration / cooldown;
}

function linkSkillBonuses(linkSkillData) {
  const skills = [
    ...(linkSkillData?.character_link_skill ?? []),
    linkSkillData?.character_owned_link_skill,
  ].filter(Boolean);
  return parseTextBonuses(skills.map((skill) => skill.skill_effect));
}

function linkSkills(linkSkillData) {
  return [
    ...(linkSkillData?.character_link_skill ?? []),
    linkSkillData?.character_owned_link_skill,
  ].filter(Boolean);
}

function conditionalDamageFromLink(linkSkillData) {
  return linkSkills(linkSkillData).reduce((sum, skill) => {
    const match = String(skill?.skill_effect ?? "").match(
      /상태 이상에 걸린 (?:몬스터|대상) 공격 시 데미지\s*(\d+(?:\.\d+)?)%\s*증가/u,
    );
    return sum + number(match?.[1]);
  }, 0);
}

/** 정적 최종 스탯에 남지 않는 링크 스킬을 보스전 평균값으로 환산한다. */
export function calculateConditionalLinkCycleBonuses(linkSkillData) {
  const result = {
    damage: 0,
    bossDamage: 0,
    ignoreDefenseSources: [],
    applied: [],
  };
  for (const skill of linkSkills(linkSkillData)) {
    const name = String(skill?.skill_name ?? "").trim();
    const effect = String(skill?.skill_effect ?? "");
    let damage = 0;
    let bossDamage = 0;
    let ignoreDefense = 0;
    let uptime = 1;

    if (name === "무아") {
      const initial = percentFromEffect(effect, /발동 시 데미지\s*(\d+(?:\.\d+)?)%/u);
      const perStack = percentFromEffect(effect, /중첩당 데미지\s*(\d+(?:\.\d+)?)%/u);
      const stacks = percentFromEffect(effect, /최대\s*(\d+(?:\.\d+)?)회 중첩/u);
      damage = /중첩/u.test(effect)
        ? initial + perStack * stacks
        : percentFromEffect(effect, /데미지\s*(\d+(?:\.\d+)?)%\s*증가/u);
    } else if (name === "전투의 흐름") {
      const perStack = percentFromEffect(effect, /각 중첩당 데미지\s*(\d+(?:\.\d+)?)%/u);
      const stacks = percentFromEffect(effect, /최대\s*(\d+(?:\.\d+)?)회 중첩/u);
      damage = /중첩/u.test(effect)
        ? perStack * stacks
        : percentFromEffect(effect, /데미지\s*(\d+(?:\.\d+)?)%\s*증가/u);
    } else if (name === "임피리컬 널리지") {
      const perStackDamage = percentFromEffect(effect, /중첩 당 데미지\s*(\d+(?:\.\d+)?)%/u);
      const perStackIgnore = percentFromEffect(effect, /방어율 무시\s*(\d+(?:\.\d+)?)%/u);
      const stacks = percentFromEffect(effect, /최대\s*(\d+(?:\.\d+)?)회까지 중첩/u);
      damage = perStackDamage * stacks;
      ignoreDefense = perStackIgnore * stacks;
    } else if (
      name === "소울 컨트랙트" ||
      name === "시프 커닝" ||
      name === "프라이어 프리퍼레이션"
    ) {
      const duration = percentFromEffect(effect, /(\d+(?:\.\d+)?)초 동안/u);
      const cooldown = percentFromEffect(
        effect,
        /재(?:발동|사용) 대기시간\s*(\d+(?:\.\d+)?)초/u,
      );
      uptime = cooldown > 0 ? Math.min(1, duration / cooldown) : 0;
      damage = percentFromEffect(effect, /데미지\s*(\d+(?:\.\d+)?)%\s*증가/u) * uptime;
    } else if (name === "인텐시브 인썰트") {
      // 상태 이상 대상 수치는 Open API의 `상태이상 추가 데미지`에
      // 반영된다. 보스보다 캐릭터 레벨이 높은 일반적인 상황의 별도
      // 조건만 더해 중복을 피한다.
      damage = percentFromEffect(
        effect,
        /캐릭터보다 레벨이 낮은 몬스터 공격 시 데미지\s*(\d+(?:\.\d+)?)%/u,
      );
    }

    if (damage > 0 || bossDamage > 0 || ignoreDefense > 0) {
      result.damage += damage;
      result.bossDamage += bossDamage;
      if (ignoreDefense > 0) result.ignoreDefenseSources.push(ignoreDefense);
      result.applied.push({ name, damage, bossDamage, ignoreDefense, uptime });
    }
  }
  return result;
}

export function calculateGuildNoblesseBonuses(guildData) {
  const skills = guildData?.guild_noblesse_skill;
  const available = Array.isArray(skills);
  const result = {
    available,
    damage: 0,
    bossDamage: 0,
    criticalDamage: 0,
    ignoreDefenseSources: [],
    skills: [],
  };
  if (!available) return result;
  for (const skill of skills) {
    const name = String(skill?.skill_name ?? "").trim();
    const effect = String(skill?.skill_effect ?? "");
    if (!name) continue;
    result.skills.push(name);
    if (name === "보스 킬링 머신") {
      result.bossDamage += percentFromEffect(
        effect,
        /보스 몬스터 공격 시 데미지\s*(\d+(?:\.\d+)?)%/u,
      );
    } else if (name === "길드의 이름으로") {
      result.damage += percentFromEffect(
        effect,
        /데미지\s*(\d+(?:\.\d+)?)%/u,
      );
    } else if (name === "크게 한방") {
      result.criticalDamage += percentFromEffect(
        effect,
        /크리티컬 데미지\s*(\d+(?:\.\d+)?)%/u,
      );
    } else if (name === "방어력은 숫자일 뿐") {
      const ignoreDefense = percentFromEffect(
        effect,
        /방어율 무시\s*(\d+(?:\.\d+)?)%/u,
      );
      if (ignoreDefense > 0) result.ignoreDefenseSources.push(ignoreDefense);
    }
  }
  return result;
}

function sumItemTotal(equipmentData, stat) {
  const key = stat.toLocaleLowerCase("en-US");
  return activeEquipment(equipmentData).reduce(
    (sum, item) => sum + number(item.item_total_option?.[key]),
    0,
  );
}

function sumItemAllStatPercent(equipmentData) {
  return activeEquipment(equipmentData).reduce(
    (sum, item) => sum + number(item.item_total_option?.all_stat),
    0,
  );
}

function sumEquipmentFlatStat(
  equipmentData,
  stat,
  characterLevel,
  characterClass = "",
) {
  return (
    sumItemTotal(equipmentData, stat) +
    parseEquipmentOptions(
      equipmentOptionLines(equipmentData, characterClass),
      characterLevel,
    ).flat[stat]
  );
}

function equipmentCombatTotals(equipmentData, attackType, characterClass = "") {
  const attackKey = attackType === "magic" ? "magic_power" : "attack_power";
  const optionBonuses = combatBonusesFromTexts(
    equipmentOptionLines(equipmentData, characterClass),
    attackType,
  );
  const result = {
    flatAttack: activeEquipment(equipmentData).reduce(
      (sum, item) => sum + number(item.item_total_option?.[attackKey]),
      0,
    ) + optionBonuses.flatAttack,
    criticalRate: optionBonuses.criticalRate,
    criticalDamage: optionBonuses.criticalDamage,
    damage: activeEquipment(equipmentData).reduce(
      (sum, item) => sum + number(item.item_total_option?.damage),
      0,
    ) + optionBonuses.damage,
    bossDamage: activeEquipment(equipmentData).reduce(
      (sum, item) => sum + number(item.item_total_option?.boss_damage),
      0,
    ) + optionBonuses.bossDamage,
    ignoreDefenseSources: [
      ...activeEquipment(equipmentData)
        .map((item) => number(item.item_total_option?.ignore_monster_armor))
        .filter((value) => value > 0),
      ...optionBonuses.ignoreDefenseSources,
    ],
  };
  return result;
}

function titleFlatAttack(equipmentData, attackType) {
  const attackName = attackType === "magic" ? "마력" : "공격력";
  const text = String(equipmentData?.title?.title_description ?? "");
  let total = 0;
  for (const match of text.matchAll(
    new RegExp(`(?:공격력\\/마력|${attackName})\\s*\\+?(\\d+(?:\\.\\d+)?)`, "g"),
  )) {
    total += number(match[1]);
  }
  return total;
}

function equipmentPresetData(equipmentData, presetNumber) {
  if (!presetNumber) return equipmentData;
  // KMS 실응답의 top-level 키와 문서/SDK에서 쓰는 중첩 키를 모두
  // 받아 프리셋을 바꿔도 칭호 스탯이 빠지지 않게 한다.
  const title =
    equipmentData?.[`title_preset${presetNumber}`] ??
    equipmentData?.[`title_preset_${presetNumber}`] ??
    equipmentData?.title?.[`title_preset_${presetNumber}`] ??
    equipmentData?.title?.[`title_preset${presetNumber}`];
  return {
    ...equipmentData,
    item_equipment:
      equipmentData?.[`item_equipment_preset_${presetNumber}`] ?? [],
    title: title?.title_name ? title : null,
  };
}

function farmingOptionCount(equipmentData) {
  return equipmentOptionLines(equipmentData).filter((line) =>
    /아이템 드롭률|메소 획득량/.test(line),
  ).length;
}

function selectBossEquipmentPreset(
  equipmentData,
  mainStat,
  subStats,
  attackType,
  characterLevel,
  characterClass = "",
) {
  const candidates = [
    { presetNumber: null, data: equipmentData },
    ...[1, 2, 3]
      .filter((presetNumber) =>
        nonemptyArray(equipmentData?.[`item_equipment_preset_${presetNumber}`]),
      )
      .map((presetNumber) => ({
        presetNumber,
        data: equipmentPresetData(equipmentData, presetNumber),
      })),
  ];
  for (const candidate of candidates) {
    const options = parseEquipmentOptions(
      equipmentOptionLines(candidate.data, characterClass),
      characterLevel,
    );
    const primaryStats =
      mainStat === "ALL" ? ["STR", "DEX", "LUK"] : [mainStat];
    const mainPercent = primaryStats.reduce(
      (sum, stat) =>
        sum + options.percent[stat] + sumItemAllStatPercent(candidate.data),
      0,
    );
    const flatMain = primaryStats.reduce(
      (sum, stat) =>
        sum + sumEquipmentFlatStat(
          candidate.data,
          stat,
          characterLevel,
          characterClass,
        ),
      0,
    );
    const subPercent = subStats.reduce(
      (sum, stat) =>
        sum + options.percent[stat] + sumItemAllStatPercent(candidate.data),
      0,
    );
    const flatSub = subStats.reduce(
      (sum, stat) =>
        sum + sumEquipmentFlatStat(
          candidate.data,
          stat,
          characterLevel,
          characterClass,
        ),
      0,
    );
    const attackPercent =
      attackType === "magic"
        ? options.magicPercent
        : options.attackPercent;
    const combat = equipmentCombatTotals(
      candidate.data,
      attackType,
      characterClass,
    );
    candidate.score =
      mainPercent * 1_000 +
      flatMain +
      // 이중 부스탯 직업의 보스 프리셋에서 DEX·STR 잠재와
      // 고정 스탯을 완전히 무시하지 않도록 낮은 가중치로 비교한다.
      (subStats.length > 1 ? subPercent * 250 + flatSub * 0.25 : 0) +
      attackPercent * 100 +
      combat.flatAttack * 4 +
      combat.damage * 20 +
      combat.criticalDamage * 100 +
      combat.bossDamage * 10 +
      combat.ignoreDefenseSources.reduce(
        (sum, value) => sum + value * 8,
        0,
      ) -
      farmingOptionCount(candidate.data) * 10_000;
  }
  return candidates.reduce((best, candidate) =>
    candidate.score > best.score ? candidate : best,
  );
}

function symbolStatTotal(symbolData, stat) {
  const key = `symbol_${stat.toLocaleLowerCase("en-US")}`;
  return (symbolData?.symbol ?? []).reduce(
    (sum, symbol) => sum + number(symbol[key]),
    0,
  );
}

function activeHyperStatTotal(hyperStatData, stat) {
  const presetNumber = String(hyperStatData?.use_preset_no ?? "");
  const preset = hyperStatData?.[`hyper_stat_preset_${presetNumber}`];
  if (!Array.isArray(preset)) return 0;
  const entry = preset.find((item) => item.stat_type === stat);
  const match = String(entry?.stat_increase ?? "").match(
    /(\d+(?:\.\d+)?)\s*증가/,
  );
  return match ? number(match[1]) : 0;
}

function hyperStatPresetEntries(hyperStatData, presetNumber) {
  return hyperStatData?.[`hyper_stat_preset_${presetNumber}`] ?? [];
}

function statIncreaseNumber(entries, statType) {
  const entry = entries.find((item) => item.stat_type === statType);
  const match = String(entry?.stat_increase ?? "").match(
    /(\d+(?:\.\d+)?)%?\s*증가/,
  );
  return match ? number(match[1]) : 0;
}

function selectBossHyperStatPreset(hyperStatData, attackType) {
  const activePreset = Number(hyperStatData?.use_preset_no);
  const candidates = [1, 2, 3]
    .map((presetNumber) => ({
      presetNumber,
      entries: hyperStatPresetEntries(hyperStatData, presetNumber),
    }))
    .filter((candidate) => candidate.entries.length);
  if (!candidates.length) {
    return { presetNumber: null, data: hyperStatData };
  }
  for (const candidate of candidates) {
    const combat = combatBonusesFromTexts(
      candidate.entries.map((entry) => entry.stat_increase),
      attackType,
    );
    candidate.score =
      statIncreaseNumber(candidate.entries, "보스 몬스터 공격 시 데미지 증가") *
        100 +
      statIncreaseNumber(candidate.entries, "방어율 무시") * 80 +
      statIncreaseNumber(candidate.entries, "크리티컬 데미지") * 50 +
      statIncreaseNumber(candidate.entries, "데미지") * 20 +
      combat.flatAttack * 4 -
      statIncreaseNumber(candidate.entries, "획득 경험치") * 100 -
      statIncreaseNumber(
        candidate.entries,
        "일반 몬스터 공격 시 데미지 증가",
      ) * 20;
  }
  candidates.sort((left, right) => {
    if (left.presetNumber === activePreset) return -1;
    if (right.presetNumber === activePreset) return 1;
    return left.presetNumber - right.presetNumber;
  });
  const selected = candidates.reduce((best, candidate) =>
    candidate.score > best.score ? candidate : best,
  );
  return {
    presetNumber: selected.presetNumber,
    data: { ...hyperStatData, use_preset_no: String(selected.presetNumber) },
  };
}

function selectBossUnionPreset(unionRaiderData, mainStat) {
  const activePreset = Number(unionRaiderData?.use_preset_no);
  const candidates = (unionRaiderData?.union_state_stat_preset ?? []).filter(
    (candidate) => nonemptyArray(candidate?.union_state_stat),
  );
  if (!candidates.length) {
    return { presetNumber: null, data: unionRaiderData };
  }
  const score = (candidate) => {
    const texts = candidate.union_state_stat ?? [];
    return texts.reduce((total, text) => {
      const value = number(String(text).match(/(\d+(?:\.\d+)?)/)?.[1]);
      if (/보스 몬스터/.test(text)) return total + value * 100;
      if (/방어율 무시/.test(text)) return total + value * 80;
      if (/크리티컬 데미지/.test(text)) return total + value * 50;
      if (
        (mainStat === "ALL" && /^(?:STR|DEX|LUK) /.test(text)) ||
        new RegExp(`^${mainStat} `).test(text)
      ) {
        return total + value * 10;
      }
      if (/획득 경험치|일반 몬스터/.test(text)) return total - value * 100;
      return total;
    }, 0);
  };
  candidates.sort((left, right) => {
    if (Number(left.preset_no) === activePreset) return -1;
    if (Number(right.preset_no) === activePreset) return 1;
    return Number(left.preset_no) - Number(right.preset_no);
  });
  const selected = candidates.reduce((best, candidate) =>
    score(candidate) > score(best) ? candidate : best,
  );
  return {
    presetNumber: selected.preset_no,
    data: {
      ...unionRaiderData,
      union_state_stat: selected.union_state_stat ?? [],
      use_preset_no: selected.preset_no,
    },
  };
}

const PRESET_COMPONENTS = [
  "equipment",
  "hyper",
  "union",
  "link",
  "ability",
];

function presetNumber(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 10
    ? parsed
    : null;
}

function nonemptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function sortedUniquePresetNumbers(values) {
  return [...new Set(values.map(presetNumber).filter(Boolean))].sort(
    (left, right) => left - right,
  );
}

function stableSkillSignature(skills) {
  if (!Array.isArray(skills)) return "";
  return skills
    .map((skill) =>
      [skill?.skill_name, skill?.skill_level, skill?.skill_effect]
        .map((value) => String(value ?? ""))
        .join("\u0001"),
    )
    .sort()
    .join("\u0002");
}

function stableEquipmentSignature(items) {
  if (!Array.isArray(items)) return "";
  return items
    .filter((item) => item?.item_equipment_slot !== "예비 특수 반지")
    .map((item) =>
      [
        item?.item_equipment_slot,
        item?.item_name,
        item?.potential_option_1,
        item?.potential_option_2,
        item?.potential_option_3,
        item?.additional_potential_option_1,
        item?.additional_potential_option_2,
        item?.additional_potential_option_3,
        JSON.stringify(equipmentSoulOptionLines(item)),
        JSON.stringify(item?.item_total_option ?? {}),
      ]
        .map((value) => String(value ?? ""))
        .join("\u0001"),
    )
    .sort()
    .join("\u0002");
}

function stableEquipmentSetSignature(items) {
  if (!Array.isArray(items)) return "";
  return items
    .filter((item) => item?.item_equipment_slot !== "예비 특수 반지")
    .map((item) => `${item?.item_equipment_slot ?? ""}\u0001${item?.item_name ?? ""}`)
    .sort()
    .join("\u0002");
}

function matchingPresetNumber(current, available, valueForPreset, signature) {
  const currentSignature = signature(current);
  if (!currentSignature) return null;
  return (
    available.find(
      (candidate) => signature(valueForPreset(candidate)) === currentSignature,
    ) ?? null
  );
}

function presetInventory({
  equipmentData,
  hyperStatData,
  unionRaiderData,
  linkSkillData,
  abilityData,
}) {
  const equipment = sortedUniquePresetNumbers(
    [1, 2, 3].filter((candidate) =>
      nonemptyArray(equipmentData?.[`item_equipment_preset_${candidate}`]),
    ),
  );
  const hyper = sortedUniquePresetNumbers(
    [1, 2, 3].filter((candidate) =>
      nonemptyArray(hyperStatData?.[`hyper_stat_preset_${candidate}`]),
    ),
  );
  const union = sortedUniquePresetNumbers(
    (unionRaiderData?.union_state_stat_preset ?? [])
      .filter((candidate) => nonemptyArray(candidate?.union_state_stat))
      .map((candidate) => candidate?.preset_no),
  );
  const link = sortedUniquePresetNumbers(
    [1, 2, 3].filter((candidate) =>
      nonemptyArray(linkSkillData?.[`character_link_skill_preset_${candidate}`]),
    ),
  );
  const ability = sortedUniquePresetNumbers(
    [1, 2, 3].filter((candidate) =>
      nonemptyArray(abilityData?.[`ability_preset_${candidate}`]?.ability_info),
    ),
  );
  return { equipment, hyper, union, link, ability };
}

function activePresetInventory(data, available) {
  const directEquipment = presetNumber(data.equipmentData?.preset_no);
  const equipment = available.equipment.includes(directEquipment)
    ? directEquipment
    : matchingPresetNumber(
        data.equipmentData?.item_equipment,
        available.equipment,
        (candidate) =>
          data.equipmentData?.[`item_equipment_preset_${candidate}`],
        stableEquipmentSignature,
      );
  const directHyper = presetNumber(data.hyperStatData?.use_preset_no);
  const hyper = available.hyper.includes(directHyper) ? directHyper : null;
  const directUnion = presetNumber(data.unionRaiderData?.use_preset_no);
  const union = available.union.includes(directUnion)
    ? directUnion
    : matchingPresetNumber(
        data.unionRaiderData?.union_state_stat,
        available.union,
        (candidate) =>
          (data.unionRaiderData?.union_state_stat_preset ?? []).find(
            (item) => presetNumber(item?.preset_no) === candidate,
          )?.union_state_stat,
        (values) =>
          Array.isArray(values)
            ? values.map(String).sort().join("\u0002")
            : "",
      );
  const link = matchingPresetNumber(
    data.linkSkillData?.character_link_skill,
    available.link,
    (candidate) =>
      data.linkSkillData?.[`character_link_skill_preset_${candidate}`],
    stableSkillSignature,
  );
  const directAbility = presetNumber(data.abilityData?.preset_no);
  const ability = available.ability.includes(directAbility)
    ? directAbility
    : null;
  return { equipment, hyper, union, link, ability };
}

function linkPresetData(linkSkillData, selected) {
  if (!selected) return linkSkillData;
  return {
    ...linkSkillData,
    character_link_skill:
      linkSkillData?.[`character_link_skill_preset_${selected}`] ?? [],
    character_owned_link_skill:
      linkSkillData?.[`character_owned_link_skill_preset_${selected}`] ??
      linkSkillData?.character_owned_link_skill ??
      null,
  };
}

function abilityPresetData(abilityData, selected) {
  if (!selected) return abilityData;
  const preset = abilityData?.[`ability_preset_${selected}`];
  return {
    ...abilityData,
    preset_no: selected,
    ability_grade: preset?.ability_preset_grade ?? abilityData?.ability_grade,
    ability_info: preset?.ability_info ?? [],
  };
}

function unionPresetData(unionRaiderData, selected) {
  if (!selected) return unionRaiderData;
  const preset = (unionRaiderData?.union_state_stat_preset ?? []).find(
    (candidate) => presetNumber(candidate?.preset_no) === selected,
  );
  return {
    ...unionRaiderData,
    use_preset_no: selected,
    union_state_stat: preset?.union_state_stat ?? [],
  };
}

const EXPLICIT_ITEM_SET_NAMES = Object.freeze({
  "가디언 엔젤 링": "보스 장신구 세트",
  "골든 클로버 벨트": "보스 장신구 세트",
  "데아 시두스 이어링": "보스 장신구 세트",
  "도미네이터 펜던트": "보스 장신구 세트",
  "매커네이터 펜던트": "보스 장신구 세트",
  "블랙빈 마크": "보스 장신구 세트",
  "응축된 힘의 결정석": "보스 장신구 세트",
  "아쿠아틱 레터 눈장식": "보스 장신구 세트",
  "파풀라투스 마크": "보스 장신구 세트",
  "카오스 혼테일의 목걸이": "보스 장신구 세트",
  "트와일라이트 마크": "여명의 보스 세트",
  "데이브레이크 펜던트": "여명의 보스 세트",
  "에스텔라 이어링": "여명의 보스 세트",
  "여명의 가디언 엔젤 링": "여명의 보스 세트",
  "루즈 컨트롤 머신 마크": "칠흑의 보스 세트",
  "마력이 깃든 안대": "칠흑의 보스 세트",
  "커맨더 포스 이어링": "칠흑의 보스 세트",
  "몽환의 벨트": "칠흑의 보스 세트",
  "거대한 공포": "칠흑의 보스 세트",
  "고통의 근원": "칠흑의 보스 세트",
  "창세의 뱃지": "칠흑의 보스 세트",
  "컴플리트 언더컨트롤": "칠흑의 보스 세트",
  "저주받은 적의 마도서": "칠흑의 보스 세트",
  "저주받은 청의 마도서": "칠흑의 보스 세트",
  "저주받은 녹의 마도서": "칠흑의 보스 세트",
  "저주받은 황의 마도서": "칠흑의 보스 세트",
  "근원의 속삭임": "광휘의 보스 세트",
  "황홀한 악몽": "광휘의 보스 세트",
  "죽음의 맹세": "광휘의 보스 세트",
  "굶주리는 핏빛 원혼": "광휘의 보스 세트",
  "불멸의 유산": "광휘의 보스 세트",
  "오만의 원죄": "광휘의 보스 세트",
  "마이스터링": "마이스터 세트",
  "마이스터 이어링": "마이스터 세트",
  "마이스터 숄더": "마이스터 세트",
});

function classSetNameFromItem(itemName, prefix, setPrefix) {
  if (!itemName.startsWith(prefix)) return null;
  const className = [
    ["나이트", "전사"],
    ["워리어", "전사"],
    ["메이지", "마법사"],
    ["던위치", "마법사"],
    ["아처", "궁수"],
    ["레인져", "궁수"],
    ["시프", "도적"],
    ["어새신", "도적"],
    ["파이렛", "해적"],
    ["원더러", "해적"],
  ].find(([marker]) => itemName.includes(marker))?.[1];
  return className ? `${setPrefix} 세트(${className})` : null;
}

function inferredItemSetName(itemName) {
  const name = String(itemName ?? "").trim();
  if (!name) return null;
  if (/^미트라의 분노\s*:/u.test(name)) return "칠흑의 보스 세트";
  return EXPLICIT_ITEM_SET_NAMES[name] ??
    classSetNameFromItem(name, "에테르넬", "에테르넬") ??
    classSetNameFromItem(name, "아케인셰이드", "아케인셰이드") ??
    classSetNameFromItem(name, "앱솔랩스", "앱솔랩스") ??
    classSetNameFromItem(name, "하이네스", "루타비스") ??
    classSetNameFromItem(name, "이글아이", "루타비스") ??
    classSetNameFromItem(name, "트릭스터", "루타비스") ??
    null;
}

function knownSetCounts(equipmentData) {
  const counts = new Map();
  for (const item of activeEquipment(equipmentData)) {
    const setName = inferredItemSetName(item?.item_name);
    if (setName) counts.set(setName, (counts.get(setName) ?? 0) + 1);
  }
  return counts;
}

function setEffectDataForEquipment(setEffectData, activeData, selectedData) {
  if (stableEquipmentSetSignature(activeEquipment(activeData)) ===
      stableEquipmentSetSignature(activeEquipment(selectedData))) {
    return { data: setEffectData, adjustedSets: [], unresolvedSets: [] };
  }
  const activeCounts = knownSetCounts(activeData);
  const selectedCounts = knownSetCounts(selectedData);
  const adjustedSets = [];
  const unresolvedSets = [];
  const sets = (setEffectData?.set_effect ?? []).map((set) => {
    const setName = String(set?.set_name ?? "").trim();
    const currentCount = number(set?.total_set_count);
    const activeKnown = activeCounts.get(setName) ?? 0;
    const selectedKnown = selectedCounts.get(setName) ?? 0;
    if (activeKnown === 0 && selectedKnown === 0) {
      unresolvedSets.push(setName);
      return set;
    }
    const selectedCount = Math.max(0, currentCount + selectedKnown - activeKnown);
    if (selectedCount === currentCount) return set;
    const full = Array.isArray(set?.set_option_full)
      ? set.set_option_full
      : [];
    if (!full.length) {
      unresolvedSets.push(setName);
      return set;
    }
    adjustedSets.push({
      setName,
      activeCount: currentCount,
      selectedCount,
    });
    return {
      ...set,
      total_set_count: selectedCount,
      set_effect_info: full.filter(
        (effect) => number(effect?.set_count) <= selectedCount,
      ),
    };
  });
  return {
    data: { ...setEffectData, set_effect: sets },
    adjustedSets,
    unresolvedSets: unresolvedSets.filter(Boolean),
  };
}

function applyPresetSelection(data, selected) {
  const equipmentData = equipmentPresetData(
    data.equipmentData,
    selected.equipment,
  );
  const setEffects = setEffectDataForEquipment(
    data.setEffectData,
    data.equipmentData,
    equipmentData,
  );
  return {
    equipmentData,
    setEffectData: setEffects.data,
    hyperStatData: selected.hyper
      ? { ...data.hyperStatData, use_preset_no: String(selected.hyper) }
      : data.hyperStatData,
    unionRaiderData: unionPresetData(data.unionRaiderData, selected.union),
    linkSkillData: linkPresetData(data.linkSkillData, selected.link),
    abilityData: abilityPresetData(data.abilityData, selected.ability),
    setEffectResolution: setEffects,
  };
}

function presetCombatScore(texts, mainStat, subStats, attackType) {
  const bonuses = parseTextBonuses(texts);
  const combat = combatBonusesFromTexts(texts, attackType);
  const primaryStats =
    mainStat === "ALL" ? ["STR", "DEX", "LUK"] : [mainStat];
  const mainFlat = primaryStats.reduce(
    (sum, stat) => sum + number(bonuses.flat[stat]),
    0,
  );
  const subFlat = subStats.reduce(
    (sum, stat) => sum + number(bonuses.flat[stat]),
    0,
  );
  const mainPercent = primaryStats.reduce(
    (sum, stat) => sum + number(bonuses.percent[stat]),
    0,
  );
  const subPercent = subStats.reduce(
    (sum, stat) => sum + number(bonuses.percent[stat]),
    0,
  );
  const attackPercent =
    attackType === "magic" ? bonuses.magicPercent : bonuses.attackPercent;
  const criticalRate = texts.reduce((sum, rawText) => {
    const match = String(rawText).match(
      /크리티컬 확률(?:이)?\s*\+?\s*(\d+(?:\.\d+)?)%/,
    );
    return sum + number(match?.[1]);
  }, 0);
  const farmingPenalty = texts.reduce(
    (sum, rawText) =>
      sum +
      (/메소 획득량|아이템 드롭률|획득 경험치/.test(String(rawText)) ? 1 : 0),
    0,
  );
  return (
    mainPercent * 1_000 +
    mainFlat * 2 +
    subPercent * 100 +
    subFlat * 0.25 +
    attackPercent * 100 +
    combat.flatAttack * 4 +
    combat.bossDamage * 100 +
    combat.damage * 20 +
    combat.criticalDamage * 50 +
    combat.ignoreDefenseSources.reduce((sum, value) => sum + value * 80, 0) +
    criticalRate * 5 -
    farmingPenalty * 100_000
  );
}

function selectScoredPreset(candidates, activePreset, score) {
  if (!candidates.length) return activePreset;
  const ordered = [...candidates].sort((left, right) => {
    if (left === activePreset) return -1;
    if (right === activePreset) return 1;
    return left - right;
  });
  return ordered.reduce((best, candidate) =>
    score(candidate) > score(best) ? candidate : best,
  );
}

function selectBossLinkPreset(
  linkSkillData,
  candidates,
  activePreset,
  mainStat,
  subStats,
  attackType,
) {
  return selectScoredPreset(candidates, activePreset, (candidate) => {
    const preset = linkPresetData(linkSkillData, candidate);
    return presetCombatScore(
      [
        ...(preset.character_link_skill ?? []),
        preset.character_owned_link_skill,
      ]
        .filter(Boolean)
        .map((skill) => skill.skill_effect),
      mainStat,
      subStats,
      attackType,
    );
  });
}

function selectBossAbilityPreset(
  abilityData,
  candidates,
  activePreset,
  mainStat,
  subStats,
  attackType,
) {
  return selectScoredPreset(candidates, activePreset, (candidate) =>
    presetCombatScore(
      (abilityPresetData(abilityData, candidate).ability_info ?? []).map(
        (ability) => ability.ability_value,
      ),
      mainStat,
      subStats,
      attackType,
    ),
  );
}

function orderedPresetCandidates(candidates, activePreset) {
  const values = [...candidates];
  if (!values.includes(activePreset)) values.push(activePreset ?? null);
  return values.sort((left, right) => {
    if (left === activePreset) return -1;
    if (right === activePreset) return 1;
    return number(left) - number(right);
  });
}

function presetDependentVector(
  snapshot,
  mainStat,
  subStats,
  attackType,
  characterLevel,
  characterClass,
) {
  const equipment = snapshot.equipmentData ?? {};
  const options = parseEquipmentOptions(
    equipmentOptionLines(equipment, characterClass),
    characterLevel,
  );
  const sets = parseSetEffects(snapshot.setEffectData ?? {});
  const title = titleBonuses(equipment);
  const hyper = parseTextBonuses(
    hyperStatPresetEntries(
      snapshot.hyperStatData ?? {},
      String(snapshot.hyperStatData?.use_preset_no ?? ""),
    ).map((entry) => entry.stat_increase),
  );
  const union = parseTextBonuses(
    snapshot.unionRaiderData?.union_state_stat ?? [],
  );
  const links = linkSkillBonuses(snapshot.linkSkillData ?? {});
  const ability = parseTextBonuses(
    (snapshot.abilityData?.ability_info ?? []).map(
      (entry) => entry.ability_value,
    ),
  );
  const supplemental = mergeBonuses(title, sets, hyper, union, links, ability);
  const equipmentCombat = equipmentCombatTotals(
    equipment,
    attackType,
    characterClass,
  );
  const combat = mergeBonuses(
    equipmentCombat,
    titleCombatBonuses(equipment, attackType),
    hyperStatCombatBonuses(snapshot.hyperStatData ?? {}, attackType),
    unionStateCombatBonuses(snapshot.unionRaiderData ?? {}, attackType),
    linkSkillCombatBonuses(snapshot.linkSkillData ?? {}, attackType),
    abilityCombatBonuses(snapshot.abilityData ?? {}, attackType),
    sets,
  );
  const relevantStats = mainStat === "ALL"
    ? ["STR", "DEX", "LUK"]
    : [mainStat, ...subStats];
  const allStatPercent = sumItemAllStatPercent(equipment);
  return {
    flatStats: Object.fromEntries(
      relevantStats.map((stat) => [
        stat,
        sumEquipmentFlatStat(
          equipment,
          stat,
          characterLevel,
          characterClass,
        ) + number(supplemental.flat[stat]),
      ]),
    ),
    percentStats: Object.fromEntries(
      relevantStats.map((stat) => [
        stat,
        number(options.percent[stat]) + allStatPercent +
          number(supplemental.percent[stat]),
      ]),
    ),
    flatAttack: number(combat.flatAttack),
    attackPercent:
      (attackType === "magic"
        ? number(options.magicPercent)
        : number(options.attackPercent)) +
      (attackType === "magic"
        ? number(supplemental.magicPercent)
        : number(supplemental.attackPercent)),
    damage: number(combat.damage),
    bossDamage: number(combat.bossDamage),
    criticalRate: number(combat.criticalRate),
    criticalDamage: number(combat.criticalDamage),
    ignoreDefenseSources: combat.ignoreDefenseSources,
    ignoreDefenseRemaining: combat.ignoreDefenseSources.reduce(
      (remaining, source) => remaining * (1 - number(source) / 100),
      1,
    ),
    farmingOptions: farmingOptionCount(equipment),
  };
}

function combinePresetVectors(activeVector, variations) {
  const scalarKeys = [
    "flatAttack",
    "attackPercent",
    "damage",
    "bossDamage",
    "criticalRate",
    "criticalDamage",
    "farmingOptions",
  ];
  const result = {
    ...activeVector,
    flatStats: { ...activeVector.flatStats },
    percentStats: { ...activeVector.percentStats },
  };
  for (const variation of variations) {
    for (const key of scalarKeys) {
      result[key] += number(variation[key]) - number(activeVector[key]);
    }
    for (const stat of Object.keys(result.flatStats)) {
      result.flatStats[stat] +=
        number(variation.flatStats[stat]) - number(activeVector.flatStats[stat]);
      result.percentStats[stat] +=
        number(variation.percentStats[stat]) -
        number(activeVector.percentStats[stat]);
    }
  }
  const activeRemaining = Math.max(
    Number.EPSILON,
    number(activeVector.ignoreDefenseRemaining),
  );
  result.ignoreDefenseRemaining = variations.reduce(
    (remaining, variation) =>
      remaining *
      number(variation.ignoreDefenseRemaining) / activeRemaining,
    activeRemaining,
  );
  return result;
}

function changedFinalStat(
  activeValue,
  activeFlat,
  selectedFlat,
  activePercent,
  selectedPercent,
) {
  const activeMultiplier = Math.max(0.01, 1 + activePercent / 100);
  const selectedMultiplier = Math.max(0.01, 1 + selectedPercent / 100);
  const percentAdjusted = activeValue * selectedMultiplier / activeMultiplier;
  return Math.max(
    1,
    percentAdjusted + (selectedFlat - activeFlat) * selectedMultiplier,
  );
}

function jointBossPresetScore({
  statData,
  activeVector,
  selectedVector,
  mainStat,
  subStats,
  attackType,
}) {
  const stats = finalStats(statData);
  const statValue = (stat) => changedFinalStat(
    number(stats[stat]),
    number(activeVector.flatStats[stat]),
    number(selectedVector.flatStats[stat]),
    number(activeVector.percentStats[stat]),
    number(selectedVector.percentStats[stat]),
  );
  const statTerm = mainStat === "ALL"
    ? statValue("STR") + statValue("DEX") + statValue("LUK")
    : 4 * statValue(mainStat) +
      subStats.reduce((sum, stat) => sum + statValue(stat), 0);
  const currentAttack = Math.max(
    1,
    number(stats[attackType === "magic" ? "마력" : "공격력"]),
  );
  const activeAttackMultiplier = Math.max(
    0.01,
    1 + activeVector.attackPercent / 100,
  );
  const selectedAttackMultiplier = Math.max(
    0.01,
    1 + selectedVector.attackPercent / 100,
  );
  const attack = Math.max(
    1,
    currentAttack * selectedAttackMultiplier / activeAttackMultiplier +
      (selectedVector.flatAttack - activeVector.flatAttack) *
        selectedAttackMultiplier,
  );
  const damageTotal =
    number(stats["데미지"]) + number(stats["보스 몬스터 데미지"]) +
    selectedVector.damage + selectedVector.bossDamage -
    activeVector.damage - activeVector.bossDamage;
  const criticalRate = Math.max(
    0,
    Math.min(
      100,
      number(stats["크리티컬 확률"]) +
        selectedVector.criticalRate - activeVector.criticalRate,
    ),
  );
  const criticalDamage = Math.max(
    0,
    number(stats["크리티컬 데미지"]) +
      selectedVector.criticalDamage - activeVector.criticalDamage,
  );
  const activeRemaining = Math.max(
    Number.EPSILON,
    number(activeVector.ignoreDefenseRemaining),
  );
  const ignoreDefense = Math.max(
    0,
    Math.min(
      1,
      1 - (1 - number(stats["방어율 무시"]) / 100) *
        number(selectedVector.ignoreDefenseRemaining) / activeRemaining,
    ),
  );
  const defenseMultiplier = Math.max(0.0001, 1 - 3.8 * (1 - ignoreDefense));
  const criticalMultiplier =
    1 + criticalRate / 100 * (0.35 + criticalDamage / 100);
  const farmingPenalty = Math.pow(0.98, selectedVector.farmingOptions);
  return statTerm * attack * Math.max(0.01, 1 + damageTotal / 100) *
    criticalMultiplier * defenseMultiplier * farmingPenalty;
}

function selectJointBossPreset({
  data,
  available,
  active,
  statData,
  mainStat,
  subStats,
  attackType,
  characterLevel,
  characterClass,
}) {
  if (!Array.isArray(statData?.final_stat) || !statData.final_stat.length) {
    return null;
  }
  const activeSnapshot = applyPresetSelection(data, active);
  const activeVector = presetDependentVector(
    { ...data, ...activeSnapshot },
    mainStat,
    subStats,
    attackType,
    characterLevel,
    characterClass,
  );
  const choices = Object.fromEntries(
    PRESET_COMPONENTS.map((component) => [
      component,
      orderedPresetCandidates(available[component], active[component]),
    ]),
  );
  const componentVectors = Object.fromEntries(
    PRESET_COMPONENTS.map((component) => [
      component,
      new Map(choices[component].map((candidate) => {
        const selected = { ...active, [component]: candidate };
        const selectedSnapshot = applyPresetSelection(data, selected);
        return [
          candidate,
          presetDependentVector(
            { ...data, ...selectedSnapshot },
            mainStat,
            subStats,
            attackType,
            characterLevel,
            characterClass,
          ),
        ];
      })),
    ]),
  );
  const selected = { ...active };
  // 후보 수의 곱만큼 전수 탐색하지 않고 구성요소별 최적화를 두 번
  // 교대한다. 첫 순회에서 선택한 방무·보공 조합을 두 번째 순회가 다시
  // 평가하므로 상호작용을 보존하면서 엣지 런타임 계산량은 후보 수의 합에
  // 비례한다.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const component of PRESET_COMPONENTS) {
      let best = null;
      for (const candidate of choices[component]) {
        const trial = { ...selected, [component]: candidate };
        const selectedVector = combinePresetVectors(
          activeVector,
          PRESET_COMPONENTS.map((key) =>
            componentVectors[key].get(trial[key])
          ),
        );
        const score = jointBossPresetScore({
          statData,
          activeVector,
          selectedVector,
          mainStat,
          subStats,
          attackType,
        });
        if (!best || score > best.score) best = { candidate, score };
      }
      selected[component] = best?.candidate ?? selected[component];
    }
  }
  return selected;
}

function normalizedPresetPolicy(presetPolicy) {
  const mode = presetPolicy?.mode ?? "auto";
  if (!new Set(["active", "auto", "manual"]).has(mode)) {
    throw new RangeError("프리셋 정책은 active, auto, manual 중 하나여야 합니다.");
  }
  const manualSource = presetPolicy?.manual ?? presetPolicy ?? {};
  const manual = Object.fromEntries(
    PRESET_COMPONENTS.map((component) => [
      component,
      presetNumber(
        manualSource[component] ?? manualSource[`${component}Preset`],
      ),
    ]),
  );
  if (
    mode === "manual" &&
    PRESET_COMPONENTS.some((component) => !manual[component])
  ) {
    throw new RangeError(
      "manual 프리셋은 장비·하이퍼·유니온·링크·어빌리티 번호가 모두 필요합니다.",
    );
  }
  return { mode, manual };
}

/** Resolves equipment, Hyper Stat, Union, Link Skill and Ability together. */
export function resolveCharacterPresetSnapshot({
  equipmentData = {},
  setEffectData = {},
  hyperStatData = {},
  unionRaiderData = {},
  linkSkillData = {},
  abilityData = {},
  mainStat,
  subStats = [],
  attackType,
  characterLevel = 0,
  characterClass = "",
  statData,
  presetPolicy,
}) {
  const data = {
    equipmentData,
    setEffectData,
    hyperStatData,
    unionRaiderData,
    linkSkillData,
    abilityData,
  };
  const policy = normalizedPresetPolicy(presetPolicy);
  const available = presetInventory(data);
  const active = activePresetInventory(data, available);
  const warnings = [];
  let selected;
  let source;

  if (policy.mode === "active") {
    selected = { ...active };
    source = Object.fromEntries(
      PRESET_COMPONENTS.map((component) => [component, "api-active"]),
    );
  } else if (policy.mode === "manual") {
    for (const component of PRESET_COMPONENTS) {
      if (!available[component].includes(policy.manual[component])) {
        throw new RangeError(
          `${component} 프리셋 ${policy.manual[component]}번을 사용할 수 없습니다.`,
        );
      }
    }
    selected = { ...policy.manual };
    source = Object.fromEntries(
      PRESET_COMPONENTS.map((component) => [component, "manual"]),
    );
  } else {
    const equipmentChoice = selectBossEquipmentPreset(
      equipmentData,
      mainStat,
      subStats,
      attackType,
      characterLevel,
      characterClass,
    ).presetNumber;
    const hyperChoice = selectBossHyperStatPreset(
      hyperStatData,
      attackType,
    ).presetNumber;
    const unionChoice = selectBossUnionPreset(unionRaiderData, mainStat).presetNumber;
    const independentSelection = {
      equipment: equipmentChoice ?? active.equipment,
      hyper: hyperChoice ?? active.hyper,
      union: presetNumber(unionChoice) ?? active.union,
      link: selectBossLinkPreset(
        linkSkillData,
        available.link,
        active.link,
        mainStat,
        subStats,
        attackType,
      ),
      ability: selectBossAbilityPreset(
        abilityData,
        available.ability,
        active.ability,
        mainStat,
        subStats,
        attackType,
      ),
    };
    const jointSelection = selectJointBossPreset({
      data,
      available,
      active,
      statData,
      mainStat,
      subStats,
      attackType,
      characterLevel,
      characterClass,
    });
    selected = jointSelection ?? independentSelection;
    source = Object.fromEntries(
      PRESET_COMPONENTS.map((component) => [
        component,
        jointSelection ? "auto-joint-damage" : "auto-score",
      ]),
    );
  }

  for (const component of PRESET_COMPONENTS) {
    if (selected[component] === null && active[component] !== null) {
      selected[component] = active[component];
      source[component] = "api-active-fallback";
    }
  }
  const unresolvedActive = PRESET_COMPONENTS.filter(
    (component) =>
      available[component].length > 0 && active[component] === null,
  );
  if (unresolvedActive.length) {
    warnings.push(
      `현재 프리셋 번호를 확인하지 못한 항목: ${unresolvedActive.join(", ")}`,
    );
  }

  const selectedPresetData = applyPresetSelection(data, selected);
  if (selectedPresetData.setEffectResolution?.unresolvedSets?.length) {
    warnings.push(
      `장비 프리셋 변경 시 분류되지 않은 세트는 현재 적용 단계를 유지합니다: ${
        selectedPresetData.setEffectResolution.unresolvedSets.join(", ")
      }`,
    );
  }
  return {
    activeSnapshot: { ...data },
    selectedSnapshot: {
      ...data,
      ...selectedPresetData,
    },
    selection: {
      mode: policy.mode,
      active,
      selected,
      available,
      source,
      approximate: policy.mode === "auto" || warnings.length > 0,
      warnings,
    },
  };
}

function combatBonusesFromTexts(texts, attackType) {
  const attackName = attackType === "magic" ? "마력" : "공격력";
  const result = {
    flatAttack: 0,
    damage: 0,
    bossDamage: 0,
    criticalRate: 0,
    criticalDamage: 0,
    ignoreDefenseSources: [],
  };
  for (const rawText of texts.filter(Boolean)) {
    const text = String(rawText);
    let match = text.match(
      new RegExp(
        `(?:공격력과 마력|공격력\\/마력|${attackName})(?:이)?\\s*\\+?\\s*` +
          `(\\d+(?:\\.\\d+)?)(?!\\s*%)(?:\\s*증가)?(?:$|\\s|,)`,
      ),
    );
    if (match) result.flatAttack += number(match[1]);
    match = text.match(/^데미지\s*\+?\s*(\d+(?:\.\d+)?)%\s*(?:증가)?/);
    if (match) result.damage += number(match[1]);
    match = text.match(
      /^보스 몬스터(?: 공격 시)? 데미지\s*\+?\s*(\d+(?:\.\d+)?)%\s*(?:증가)?/,
    );
    if (match) result.bossDamage += number(match[1]);
    match = text.match(/크리티컬 확률(?:이)?\s*\+?\s*(\d+(?:\.\d+)?)%\s*(?:증가)?/);
    if (match) result.criticalRate += number(match[1]);
    match = text.match(/^크리티컬 데미지\s*\+?\s*(\d+(?:\.\d+)?)%\s*(?:증가)?/);
    if (match) result.criticalDamage += number(match[1]);
    match = text.match(/^(?:몬스터 )?방어율 무시\s*\+?\s*(\d+(?:\.\d+)?)%\s*(?:증가)?/);
    if (match) result.ignoreDefenseSources.push(number(match[1]));
  }
  return result;
}

function titleCombatBonuses(equipmentData, attackType) {
  return combatBonusesFromTexts(
    String(equipmentData?.title?.title_description ?? "")
      .split(/\r?\n|,\s*/)
      .filter(Boolean),
    attackType,
  );
}

function hyperStatCombatBonuses(hyperStatData, attackType) {
  const entries = hyperStatPresetEntries(
    hyperStatData,
    String(hyperStatData?.use_preset_no ?? ""),
  );
  return combatBonusesFromTexts(
    entries.map((entry) => entry.stat_increase),
    attackType,
  );
}

function unionStateCombatBonuses(unionRaiderData, attackType) {
  return combatBonusesFromTexts(
    unionRaiderData?.union_state_stat ?? [],
    attackType,
  );
}

function linkSkillCombatBonuses(linkSkillData, attackType) {
  const skills = [
    ...(linkSkillData?.character_link_skill ?? []),
    linkSkillData?.character_owned_link_skill,
  ].filter(Boolean);
  return combatBonusesFromTexts(
    skills.map((skill) => skill.skill_effect),
    attackType,
  );
}

function abilityCombatBonuses(abilityData, attackType) {
  return combatBonusesFromTexts(
    (abilityData?.ability_info ?? []).map((ability) => ability.ability_value),
    attackType,
  );
}

function hexaUnreflectedMainStat(hexaStatData) {
  const cores = [
    ...(hexaStatData?.character_hexa_stat_core ?? []),
    ...(hexaStatData?.character_hexa_stat_core_2 ?? []),
    ...(hexaStatData?.character_hexa_stat_core_3 ?? []),
  ];
  return cores.reduce((sum, core) => {
    // HEXA 스탯의 주력 스탯은 잠재능력 스탯%를 받지 않는다.
    // 메인 옵션에는 기본 1레벨 효과가 있어 (표시 레벨 + 1) * 100,
    // 서브 옵션은 표시 레벨 * 100으로 계산된다.
    const main =
      core.main_stat_name === "주력 스탯 증가"
        ? (number(core.main_stat_level) + 1) * 100
        : 0;
    const sub1 =
      core.sub_stat_name_1 === "주력 스탯 증가"
        ? number(core.sub_stat_level_1) * 100
        : 0;
    const sub2 =
      core.sub_stat_name_2 === "주력 스탯 증가"
        ? number(core.sub_stat_level_2) * 100
        : 0;
    return sum + main + sub1 + sub2;
  }, 0);
}

function abilityUnreflectedStat(abilityData, stat) {
  return (abilityData?.ability_info ?? []).reduce((sum, ability) => {
    let value = 0;
    for (const match of String(ability.ability_value ?? "").matchAll(
      /(STR|DEX|INT|LUK)\s+(\d+(?:\.\d+)?)\s*증가/g,
    )) {
      if (match[1] === stat) value += number(match[2]);
    }
    return sum + value;
  }, 0);
}

function textStatTotal(texts, stat) {
  let total = 0;
  for (const text of texts.filter(Boolean)) {
    const allStatMatch = String(text).match(
      /^올스탯\s+(\d+(?:\.\d+)?)\s*증가/,
    );
    if (allStatMatch) total += number(allStatMatch[1]);
    const statsMatch = String(text).match(
      /^((?:STR|DEX|INT|LUK)(?:,\s*(?:STR|DEX|INT|LUK))*)\s+(\d+(?:\.\d+)?)\s*증가/,
    );
    if (
      statsMatch &&
      statsMatch[1].split(/,\s*/).includes(stat)
    ) {
      total += number(statsMatch[2]);
    }
  }
  return total;
}

function unionUnreflectedStat(
  unionRaiderData,
  stat,
) {
  const unionTexts = [
    ...(unionRaiderData?.union_raider_stat ?? []),
    ...(unionRaiderData?.union_occupied_stat ?? []),
    ...(unionRaiderData?.union_state_stat ?? []),
    ...(unionRaiderData?.union_inner_stat ?? []).flatMap((item) =>
      Object.values(item ?? {}).filter((value) => typeof value === "string"),
    ),
  ];
  // 공격대원·격자의 고정 스탯은 잠재능력 스탯%가 적용되지 않는다.
  // 반면 유니온 아티팩트와 챔피언 배지의 올스탯은 스탯% 적용 대상이고
  // character/stat 최종값에도 이미 포함되므로 여기서 빼면 안 된다.
  return textStatTotal(unionTexts, stat);
}

function conditionalDamageFromAbility(abilityData) {
  return (abilityData?.ability_info ?? []).reduce((sum, ability) => {
    const match = String(ability.ability_value ?? "").match(
      /상태 이상에 걸린 대상 공격 시 데미지\s+(\d+(?:\.\d+)?)%\s*증가/,
    );
    return sum + (match ? number(match[1]) : 0);
  }, 0);
}

function unreflectedStats({
  symbolData,
  hyperStatData,
  hexaStatData,
  abilityData,
  unionRaiderData,
  mainStat,
  subStats,
}) {
  const symbolMain = symbolStatTotal(symbolData, mainStat);
  const hyperMain = activeHyperStatTotal(hyperStatData, mainStat);
  const hexaMain = hexaUnreflectedMainStat(hexaStatData);
  const abilityMain = abilityUnreflectedStat(abilityData, mainStat);
  const unionMain = unionUnreflectedStat(
    unionRaiderData,
    mainStat,
  );
  const bySubStat = Object.fromEntries(
    subStats.map((stat) => {
      const symbol = symbolStatTotal(symbolData, stat);
      const hyper = activeHyperStatTotal(hyperStatData, stat);
      const ability = abilityUnreflectedStat(abilityData, stat);
      const union = unionUnreflectedStat(
        unionRaiderData,
        stat,
      );
      return [
        stat,
        {
          total: symbol + hyper + ability + union,
          symbol,
          hyper,
          ability,
          union,
        },
      ];
    }),
  );
  const primarySub = bySubStat[subStats[0]] ?? {
    total: 0,
    symbol: 0,
    hyper: 0,
    ability: 0,
    union: 0,
  };
  return {
    main: symbolMain + hyperMain + hexaMain + abilityMain + unionMain,
    subs: Object.fromEntries(
      Object.entries(bySubStat).map(([stat, values]) => [stat, values.total]),
    ),
    sub: primarySub.total,
    symbolMain,
    symbolSubs: Object.fromEntries(
      Object.entries(bySubStat).map(([stat, values]) => [stat, values.symbol]),
    ),
    symbolSub: primarySub.symbol,
    hyperMain,
    hyperSubs: Object.fromEntries(
      Object.entries(bySubStat).map(([stat, values]) => [stat, values.hyper]),
    ),
    hyperSub: primarySub.hyper,
    hexaMain,
    abilityMain,
    abilitySubs: Object.fromEntries(
      Object.entries(bySubStat).map(([stat, values]) => [stat, values.ability]),
    ),
    abilitySub: primarySub.ability,
    unionMain,
    unionSubs: Object.fromEntries(
      Object.entries(bySubStat).map(([stat, values]) => [stat, values.union]),
    ),
    unionSub: primarySub.union,
  };
}

function ensurePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`API 데이터에서 ${label}을(를) 계산하지 못했습니다.`);
  }
  return value;
}

/**
 * 현재 총 방무에 새 방무 출처를 복리로 더했을 때의 주스탯 %급을 계산한다.
 * 방무는 0~1, 적 방어율은 300% = 3처럼 소수 배율로 받는다.
 * 현재 방무로 적 방어율을 뚫지 못하거나 입력이 유효하지 않으면 null이다.
 */
export function calculateIgnoreDefenseEquivalent({
  currentIgnoreDefense,
  addedIgnoreDefense,
  enemyDefense,
  oneMainPercentRelative,
}) {
  if (
    !Number.isFinite(currentIgnoreDefense) ||
    !Number.isFinite(addedIgnoreDefense) ||
    !Number.isFinite(enemyDefense) ||
    !Number.isFinite(oneMainPercentRelative) ||
    currentIgnoreDefense < 0 ||
    currentIgnoreDefense > 1 ||
    addedIgnoreDefense < 0 ||
    addedIgnoreDefense > 1 ||
    enemyDefense < 0 ||
    oneMainPercentRelative <= 0
  ) {
    return null;
  }
  const before = 1 - enemyDefense * (1 - currentIgnoreDefense);
  if (before <= 0) return null;
  const afterIgnoreDefense =
    1 - (1 - currentIgnoreDefense) * (1 - addedIgnoreDefense);
  const after = 1 - enemyDefense * (1 - afterIgnoreDefense);
  return (after / before - 1) / oneMainPercentRelative;
}

function changeEquipmentIgnoreDefense(
  currentIgnoreDefense,
  currentSources,
  selectedSources,
) {
  const currentEquipmentRemaining = currentSources.reduce(
    (remaining, source) => remaining * (1 - number(source) / 100),
    1,
  );
  if (currentEquipmentRemaining <= 0) return currentIgnoreDefense;
  const nonEquipmentRemaining =
    (1 - currentIgnoreDefense) / currentEquipmentRemaining;
  const selectedRemaining = selectedSources.reduce(
    (remaining, source) => remaining * (1 - number(source) / 100),
    nonEquipmentRemaining,
  );
  return 1 - selectedRemaining;
}

export function calculateCharacterPotentialConversion({
  character,
  statData,
  equipmentData,
  setEffectData,
  otherStatData,
  cashEquipmentData = {},
  petEquipmentData = {},
  linkSkillData,
  skillData,
  symbolData,
  hyperStatData,
  hexaStatData,
  hexaMatrixData,
  vMatrixData,
  abilityData,
  unionRaiderData,
  unionArtifactData,
  unionChampionData,
  ringReserveData,
  guildData,
  mainStat,
  subStat,
  subStats,
  attackType,
  doping,
  presetPolicy,
  resolvedPresetSnapshot = null,
}) {
  const requestedSubStats = Array.isArray(subStats) ? subStats : [subStat];
  const resolvedSubStats = [...new Set(requestedSubStats)].filter(
    (stat) => stat !== null && stat !== undefined && stat !== "none",
  );
  if (
    resolvedSubStats.length === 0 ||
    resolvedSubStats.some(
      (stat) => !STAT_NAMES.includes(stat) || stat === mainStat,
    )
  ) {
    throw new RangeError(
      "부스탯은 주스탯과 다른 STR/DEX/INT/LUK 중 하나 이상이어야 합니다.",
    );
  }
  const primarySubStat = resolvedSubStats[0];
  const stats = finalStats(statData);
  const characterLevel = number(character.character_level);
  const resolvedPresets = resolvedPresetSnapshot ??
    resolveCharacterPresetSnapshot({
      equipmentData,
      setEffectData,
      hyperStatData,
      unionRaiderData,
      linkSkillData,
      abilityData,
      mainStat,
      subStats: resolvedSubStats,
      attackType,
      characterLevel,
      characterClass: character.character_class,
      statData,
      presetPolicy,
    });
  const selectedHyperStatData = resolvedPresets.selectedSnapshot.hyperStatData;
  const selectedUnionRaiderData =
    resolvedPresets.selectedSnapshot.unionRaiderData;
  const selectedLinkSkillData = resolvedPresets.selectedSnapshot.linkSkillData;
  const selectedAbilityData = resolvedPresets.selectedSnapshot.abilityData;
  const classDopingAdjustment =
    doping?.classAdjustments?.[character.character_class] ?? {};
  const classAlwaysOnCombat = resolveClassAlwaysOnCombatAdjustment(
    character.character_class,
    skillData,
  );
  const classAlwaysOnAdjustment = classAlwaysOnCombat.adjustment;
  const activeEquipmentData = equipmentData;
  const selectedEquipmentData = resolvedPresets.selectedSnapshot.equipmentData;
  const activeEquipmentOptions = parseEquipmentOptions(
    equipmentOptionLines(activeEquipmentData, character.character_class),
    characterLevel,
  );
  const equipmentOptions = parseEquipmentOptions(
    equipmentOptionLines(selectedEquipmentData, character.character_class),
    characterLevel,
  );
  const activeSets = parseSetEffects(
    resolvedPresets.activeSnapshot.setEffectData ?? setEffectData,
  );
  const sets = parseSetEffects(
    resolvedPresets.selectedSnapshot.setEffectData ?? setEffectData,
  );
  const activeTitle = titleBonuses(activeEquipmentData);
  const title = titleBonuses(selectedEquipmentData);
  const otherStats = otherStatBonuses(otherStatData);
  const cashEquipment = cashEquipmentBonuses(cashEquipmentData);
  const petEquipment = resolvePetEquipmentBonuses(
    petEquipmentData,
    attackType,
    resolvedPresets.selection.mode,
  );
  const skills = skillBonuses(skillData);
  const activeLinks = linkSkillBonuses(linkSkillData);
  const links = linkSkillBonuses(selectedLinkSkillData);
  const combatDurationSeconds = Math.max(
    1,
    number(doping?.totals?.combatDurationSeconds) || 360,
  );
  const combatRing = calculateCombatRingBonuses(
    selectedEquipmentData,
    ringReserveData,
    skillData,
    attackType,
    combatDurationSeconds,
    character.character_class,
  );
  const conditionalLinks = calculateConditionalLinkCycleBonuses(
    selectedLinkSkillData,
  );
  const guildNoblesse = calculateGuildNoblesseBonuses(guildData);
  const supplemental = mergeBonuses(
    title,
    otherStats,
    cashEquipment,
    petEquipment.selected,
    petEquipment.skills,
    skills,
    links,
  );
  const activeSupplemental = mergeBonuses(
    activeTitle,
    otherStats,
    cashEquipment,
    petEquipment.active,
    petEquipment.skills,
    skills,
    activeLinks,
  );
  const equipmentAllStatPercent = sumItemAllStatPercent(selectedEquipmentData);
  const activeEquipmentAllStatPercent =
    sumItemAllStatPercent(activeEquipmentData);

  // 메이플 용사 계열의 실제 스킬 레벨을 사용한다. 스킬 조회가 불가능한
  // 과거/테스트 데이터에는 기본 마스터 수치인 15%를 적용한다.
  const mapleWarriorPercent = skills.apPercent || 15;
  const mapleWarriorMultiplier = 1 + mapleWarriorPercent / 100;
  const activeSkillCycle = calculateActiveSkillCycleBonuses(
    skillData,
    attackType,
    combatDurationSeconds,
    {
      apStats: Object.fromEntries(
        STAT_NAMES.map((stat) => [stat, stats[`AP 배분 ${stat}`]]),
      ),
      mapleWarriorPercent,
      characterClass: character.character_class,
      equipmentData: selectedEquipmentData,
    },
  );
  const enumeratedBaseMain = ensurePositive(
    stats[`AP 배분 ${mainStat}`] * mapleWarriorMultiplier +
      sumItemTotal(selectedEquipmentData, mainStat) +
      equipmentOptions.flat[mainStat] +
      sets.flat[mainStat] +
      supplemental.flat[mainStat],
    "% 적용 대상 주스탯",
  );
  const enumeratedBaseSubs = Object.fromEntries(
    resolvedSubStats.map((stat) => [
      stat,
      ensurePositive(
        stats[`AP 배분 ${stat}`] * mapleWarriorMultiplier +
          sumItemTotal(selectedEquipmentData, stat) +
          equipmentOptions.flat[stat] +
          sets.flat[stat] +
          supplemental.flat[stat],
        `% 적용 대상 부스탯(${stat})`,
      ),
    ]),
  );
  const enumeratedBaseSub = enumeratedBaseSubs[primarySubStat];

  const mainPercent =
    equipmentOptions.percent[mainStat] +
    equipmentAllStatPercent +
    sets.percent[mainStat] +
    supplemental.percent[mainStat] +
    number(classDopingAdjustment.mainStatPercent);
  const subPercents = Object.fromEntries(
    resolvedSubStats.map((stat) => [
      stat,
      equipmentOptions.percent[stat] +
        equipmentAllStatPercent +
        sets.percent[stat] +
        supplemental.percent[stat] +
        number(
          classDopingAdjustment.subStatPercentByStat?.[stat] ??
            classDopingAdjustment.subStatPercent,
        ),
    ]),
  );
  const subPercent = subPercents[primarySubStat];
  const attackPercent =
    (attackType === "magic"
      ? equipmentOptions.magicPercent
      : equipmentOptions.attackPercent) +
    (attackType === "magic" ? sets.magicPercent : sets.attackPercent) +
    (attackType === "magic"
      ? supplemental.magicPercent
      : supplemental.attackPercent);

  const activeMainPercent =
    activeEquipmentOptions.percent[mainStat] +
    activeEquipmentAllStatPercent +
    activeSets.percent[mainStat] +
    activeSupplemental.percent[mainStat];
  const activeSubPercents = Object.fromEntries(
    resolvedSubStats.map((stat) => [
      stat,
        activeEquipmentOptions.percent[stat] +
        activeEquipmentAllStatPercent +
        activeSets.percent[stat] +
        activeSupplemental.percent[stat],
    ]),
  );
  const activeAttackPercent =
    (attackType === "magic"
      ? activeEquipmentOptions.magicPercent
      : activeEquipmentOptions.attackPercent) +
    (attackType === "magic"
      ? activeSets.magicPercent
      : activeSets.attackPercent) +
    (attackType === "magic"
      ? activeSupplemental.magicPercent
      : activeSupplemental.attackPercent);

  const apiCurrentMain = ensurePositive(stats[mainStat], "최종 주스탯");
  const apiCurrentSubs = Object.fromEntries(
    resolvedSubStats.map((stat) => [
      stat,
      ensurePositive(stats[stat], `최종 부스탯(${stat})`),
    ]),
  );
  const apiCurrentSub = apiCurrentSubs[primarySubStat];
  const apiCurrentAttack = ensurePositive(
    stats[attackType === "magic" ? "마력" : "공격력"],
    attackType === "magic" ? "최종 마력" : "최종 공격력",
  );
  const apiCurrentCriticalDamage = ensurePositive(
    stats["크리티컬 데미지"],
    "크리티컬 데미지",
  );
  const hasApiCurrentCriticalRate = Object.hasOwn(
    stats,
    "크리티컬 확률",
  );
  const apiCurrentCriticalRate = hasApiCurrentCriticalRate
    ? number(stats["크리티컬 확률"])
    : null;

  const hasUnreflectedSnapshot =
    symbolData !== undefined &&
    hyperStatData !== undefined &&
    hexaStatData !== undefined &&
    abilityData !== undefined;
  const activeUnreflected = unreflectedStats({
    symbolData,
    hyperStatData,
    hexaStatData,
    abilityData,
    unionRaiderData,
    mainStat,
    subStats: resolvedSubStats,
  });
  const unreflected = unreflectedStats({
    symbolData,
    hyperStatData: selectedHyperStatData,
    hexaStatData,
    abilityData: selectedAbilityData,
    unionRaiderData: selectedUnionRaiderData,
    mainStat,
    subStats: resolvedSubStats,
  });
  // 최종 스탯은 소수점 아래가 버려진 값이다. 따라서 % 미적용 수치를
  // 제거한 뒤 올림 역산하면 환산 계산기의 '기본수치'와 같은 정수가 된다.
  // 신규 API 자료가 없는 오래된 테스트/저장 자료에는 기존 합산값을 쓴다.
  const activeBaseMain = ensurePositive(
    hasUnreflectedSnapshot
      ? Math.ceil(
          (apiCurrentMain - activeUnreflected.main) /
            (1 + activeMainPercent / 100),
        )
      : enumeratedBaseMain,
    "% 적용 대상 주스탯",
  );
  const activeBaseSubs = Object.fromEntries(
    resolvedSubStats.map((stat) => [
      stat,
      ensurePositive(
        hasUnreflectedSnapshot
          ? Math.ceil(
              (apiCurrentSubs[stat] - activeUnreflected.subs[stat]) /
                (1 + activeSubPercents[stat] / 100),
            )
          : enumeratedBaseSubs[stat],
        `% 적용 대상 부스탯(${stat})`,
      ),
    ]),
  );
  const activeBaseSub = activeBaseSubs[primarySubStat];
  const equipmentPresetChanged =
    resolvedPresets.selection.selected.equipment !== null &&
    resolvedPresets.selection.selected.equipment !==
      resolvedPresets.selection.active.equipment;
  const setEffectChanged =
    JSON.stringify(resolvedPresets.activeSnapshot.setEffectData ?? {}) !==
    JSON.stringify(resolvedPresets.selectedSnapshot.setEffectData ?? {});
  const presetChanged = PRESET_COMPONENTS.some(
    (component) =>
      resolvedPresets.selection.selected[component] !== null &&
      resolvedPresets.selection.selected[component] !==
        resolvedPresets.selection.active[component],
  ) || petEquipment.changed || setEffectChanged;
  const classStatAdjustmentApplied =
    number(classDopingAdjustment.baseMain) !== 0 ||
    number(classDopingAdjustment.mainStatPercent) !== 0 ||
    resolvedSubStats.some(
      (stat) =>
        number(
          classDopingAdjustment.baseSubByStat?.[stat] ??
            classDopingAdjustment.baseSub,
        ) !== 0 ||
        number(
          classDopingAdjustment.subStatPercentByStat?.[stat] ??
            classDopingAdjustment.subStatPercent,
        ) !== 0,
    );
  const baseMain = ensurePositive(
    activeBaseMain +
      (equipmentPresetChanged
        ? sumEquipmentFlatStat(
            selectedEquipmentData,
            mainStat,
            characterLevel,
            character.character_class,
          ) -
          sumEquipmentFlatStat(
            activeEquipmentData,
            mainStat,
            characterLevel,
            character.character_class,
          ) +
          title.flat[mainStat] -
          activeTitle.flat[mainStat] +
          sets.flat[mainStat] -
          activeSets.flat[mainStat]
        : 0) +
      petEquipment.selected.flat[mainStat] -
      petEquipment.active.flat[mainStat] +
      links.flat[mainStat] -
      activeLinks.flat[mainStat] +
      number(classDopingAdjustment.baseMain),
    "% 적용 대상 보스 프리셋 주스탯",
  );
  const baseSubs = Object.fromEntries(
    resolvedSubStats.map((stat) => [
      stat,
      ensurePositive(
        activeBaseSubs[stat] +
          (equipmentPresetChanged
            ? sumEquipmentFlatStat(
              selectedEquipmentData,
              stat,
              characterLevel,
              character.character_class,
            ) -
            sumEquipmentFlatStat(
              activeEquipmentData,
              stat,
              characterLevel,
              character.character_class,
              ) +
              title.flat[stat] -
              activeTitle.flat[stat] +
              sets.flat[stat] -
              activeSets.flat[stat]
            : 0) +
          petEquipment.selected.flat[stat] -
          petEquipment.active.flat[stat] +
          links.flat[stat] -
          activeLinks.flat[stat] +
          number(
            classDopingAdjustment.baseSubByStat?.[stat] ??
              classDopingAdjustment.baseSub,
          ),
        `% 적용 대상 보스 프리셋 부스탯(${stat})`,
      ),
    ]),
  );
  const baseSub = baseSubs[primarySubStat];
  const currentStatChanged = presetChanged || classStatAdjustmentApplied;
  const currentMain = currentStatChanged
    ? Math.floor(baseMain * (1 + mainPercent / 100)) + unreflected.main
    : apiCurrentMain;
  const currentSubs = Object.fromEntries(
    resolvedSubStats.map((stat) => [
      stat,
      currentStatChanged
        ? Math.floor(baseSubs[stat] * (1 + subPercents[stat] / 100)) +
          unreflected.subs[stat]
        : apiCurrentSubs[stat],
    ]),
  );
  const currentSub = currentSubs[primarySubStat];

  const activeCombat = equipmentCombatTotals(
    activeEquipmentData,
    attackType,
    character.character_class,
  );
  const selectedCombat = equipmentCombatTotals(
    selectedEquipmentData,
    attackType,
    character.character_class,
  );
  const activeTitleCombat = titleCombatBonuses(
    activeEquipmentData,
    attackType,
  );
  const selectedTitleCombat = titleCombatBonuses(
    selectedEquipmentData,
    attackType,
  );
  const activeHyperCombat = hyperStatCombatBonuses(
    hyperStatData,
    attackType,
  );
  const selectedHyperCombat = hyperStatCombatBonuses(
    selectedHyperStatData,
    attackType,
  );
  const activeUnionCombat = unionStateCombatBonuses(
    unionRaiderData,
    attackType,
  );
  const selectedUnionCombat = unionStateCombatBonuses(
    selectedUnionRaiderData,
    attackType,
  );
  const activeLinkCombat = linkSkillCombatBonuses(linkSkillData, attackType);
  const selectedLinkCombat = linkSkillCombatBonuses(
    selectedLinkSkillData,
    attackType,
  );
  const activeAbilityCombat = abilityCombatBonuses(abilityData, attackType);
  const selectedAbilityCombat = abilityCombatBonuses(
    selectedAbilityData,
    attackType,
  );
  const activeRawAttack = hasUnreflectedSnapshot
    ? Math.ceil(apiCurrentAttack / (1 + activeAttackPercent / 100))
    : apiCurrentAttack / (1 + activeAttackPercent / 100);
  const rawAttack = presetChanged
    ? activeRawAttack +
      selectedCombat.flatAttack -
        activeCombat.flatAttack +
        titleFlatAttack(selectedEquipmentData, attackType) -
        titleFlatAttack(activeEquipmentData, attackType) +
        selectedHyperCombat.flatAttack -
        activeHyperCombat.flatAttack +
        selectedUnionCombat.flatAttack -
        activeUnionCombat.flatAttack +
        selectedLinkCombat.flatAttack -
        activeLinkCombat.flatAttack +
        selectedAbilityCombat.flatAttack -
        activeAbilityCombat.flatAttack +
        relevantFlatAttack(sets, attackType) -
        relevantFlatAttack(activeSets, attackType) +
        relevantFlatAttack(petEquipment.selected, attackType) -
        relevantFlatAttack(petEquipment.active, attackType)
    : activeRawAttack;
  const currentAttack = presetChanged
    ? Math.floor(rawAttack * (1 + attackPercent / 100))
    : apiCurrentAttack;
  const currentCriticalDamage =
    apiCurrentCriticalDamage +
    selectedCombat.criticalDamage -
    activeCombat.criticalDamage +
    selectedHyperCombat.criticalDamage -
    activeHyperCombat.criticalDamage +
    selectedUnionCombat.criticalDamage -
    activeUnionCombat.criticalDamage +
    selectedLinkCombat.criticalDamage -
    activeLinkCombat.criticalDamage +
    selectedAbilityCombat.criticalDamage -
    activeAbilityCombat.criticalDamage +
      selectedTitleCombat.criticalDamage -
      activeTitleCombat.criticalDamage +
    sets.criticalDamage -
    activeSets.criticalDamage +
    petEquipment.selected.criticalDamage -
    petEquipment.active.criticalDamage;
  const currentCriticalRate = apiCurrentCriticalRate === null
    ? null
    : Math.max(
        0,
        apiCurrentCriticalRate +
          selectedCombat.criticalRate -
          activeCombat.criticalRate +
          selectedHyperCombat.criticalRate -
          activeHyperCombat.criticalRate +
          selectedUnionCombat.criticalRate -
          activeUnionCombat.criticalRate +
          selectedLinkCombat.criticalRate -
          activeLinkCombat.criticalRate +
          selectedAbilityCombat.criticalRate -
          activeAbilityCombat.criticalRate +
          selectedTitleCombat.criticalRate -
          activeTitleCombat.criticalRate +
          sets.criticalRate -
          activeSets.criticalRate +
          petEquipment.selected.criticalRate -
          petEquipment.active.criticalRate,
      );
  const currentDamage =
    number(stats["데미지"]) +
    selectedCombat.damage -
    activeCombat.damage +
    selectedTitleCombat.damage -
    activeTitleCombat.damage +
    selectedHyperCombat.damage -
    activeHyperCombat.damage +
    selectedUnionCombat.damage -
    activeUnionCombat.damage +
    selectedLinkCombat.damage -
    activeLinkCombat.damage +
    selectedAbilityCombat.damage -
    activeAbilityCombat.damage +
    sets.damage -
    activeSets.damage +
    petEquipment.selected.damage -
    petEquipment.active.damage;
  const currentBossDamage =
    number(stats["보스 몬스터 데미지"]) +
    selectedCombat.bossDamage -
    activeCombat.bossDamage +
    selectedTitleCombat.bossDamage -
    activeTitleCombat.bossDamage +
    selectedHyperCombat.bossDamage -
    activeHyperCombat.bossDamage +
    selectedUnionCombat.bossDamage -
    activeUnionCombat.bossDamage +
    selectedLinkCombat.bossDamage -
    activeLinkCombat.bossDamage +
    selectedAbilityCombat.bossDamage -
    activeAbilityCombat.bossDamage +
    sets.bossDamage -
    activeSets.bossDamage +
    petEquipment.selected.bossDamage -
    petEquipment.active.bossDamage;
  const currentIgnoreDefense = changeEquipmentIgnoreDefense(
    number(stats["방어율 무시"]) / 100,
    [
      ...activeCombat.ignoreDefenseSources,
      ...activeHyperCombat.ignoreDefenseSources,
      ...activeUnionCombat.ignoreDefenseSources,
      ...activeLinkCombat.ignoreDefenseSources,
      ...activeAbilityCombat.ignoreDefenseSources,
      ...activeTitleCombat.ignoreDefenseSources,
      ...activeSets.ignoreDefenseSources,
      ...petEquipment.active.ignoreDefenseSources,
    ],
    [
      ...selectedCombat.ignoreDefenseSources,
      ...selectedHyperCombat.ignoreDefenseSources,
      ...selectedUnionCombat.ignoreDefenseSources,
      ...selectedLinkCombat.ignoreDefenseSources,
      ...selectedAbilityCombat.ignoreDefenseSources,
      ...selectedTitleCombat.ignoreDefenseSources,
      ...sets.ignoreDefenseSources,
      ...petEquipment.selected.ignoreDefenseSources,
    ],
  );

  const baseDopingTotals = doping?.totals ?? {};
  const guildBaseline = doping?.guildBaseline ?? {};
  const guildDifference = doping && guildNoblesse.available
    ? {
        damage:
          guildNoblesse.damage - number(guildBaseline.damage),
        bossDamage:
          guildNoblesse.bossDamage - number(guildBaseline.bossDamage),
        criticalDamage:
          guildNoblesse.criticalDamage -
          number(guildBaseline.criticalDamage),
      }
    : { damage: 0, bossDamage: 0, criticalDamage: 0 };
  const dopingTotals = {
    ...baseDopingTotals,
    damage: number(baseDopingTotals.damage) + guildDifference.damage,
    bossDamage:
      number(baseDopingTotals.bossDamage) + guildDifference.bossDamage,
    criticalDamage:
      number(baseDopingTotals.criticalDamage) + guildDifference.criticalDamage,
    ignoreDefenseSources: [
      ...(Array.isArray(baseDopingTotals.ignoreDefenseSources)
        ? baseDopingTotals.ignoreDefenseSources
        : [baseDopingTotals.ignoreDefense].filter(Boolean)),
      ...(doping && guildNoblesse.available
        ? guildNoblesse.ignoreDefenseSources
        : doping
          ? guildBaseline.ignoreDefenseSources ?? []
          : []),
    ],
  };

  const includeEquippedRing = Boolean(dopingTotals.includeEquippedRing);
  const combatRingFlatMain = doping && includeEquippedRing
    ? number(combatRing.flat[mainStat])
    : 0;
  const combatRingFlatSubs = Object.fromEntries(
    resolvedSubStats.map((stat) => [
      stat,
      doping && includeEquippedRing ? number(combatRing.flat[stat]) : 0,
    ]),
  );

  const activeSkillBaseMain = doping
    ? number(activeSkillCycle.baseFlat[mainStat])
    : 0;
  const dopedBaseMain =
    baseMain + number(dopingTotals.mainStat) + activeSkillBaseMain;
  const dopingSubStatByStat = Object.fromEntries(
    resolvedSubStats.map((stat) => [
      stat,
      number(dopingTotals.subStatByStat?.[stat] ?? dopingTotals.subStat),
    ]),
  );
  const dopedBaseSubs = Object.fromEntries(
    resolvedSubStats.map((stat) => [
      stat,
      baseSubs[stat] +
        dopingSubStatByStat[stat] +
        (doping ? number(activeSkillCycle.baseFlat[stat]) : 0),
    ]),
  );
  const dopedBaseSub = dopedBaseSubs[primarySubStat];
  // 고정 올스탯 도핑은 잠재능력 스탯%의 적용을 받는다. API 최종 스탯에
  // 단순히 +75를 더하면 고정 스탯·올스탯% 효율이 모두 어긋난다.
  const dopedMain =
    currentMain +
    Math.floor(
      (number(dopingTotals.mainStat) + activeSkillBaseMain) *
        (1 + mainPercent / 100),
    ) +
    combatRingFlatMain;
  const dopedSubs = Object.fromEntries(
    resolvedSubStats.map((stat) => [
      stat,
      currentSubs[stat] +
        Math.floor(
          (dopingSubStatByStat[stat] +
            (doping ? number(activeSkillCycle.baseFlat[stat]) : 0)) *
            (1 + subPercents[stat] / 100),
        ) +
        combatRingFlatSubs[stat],
    ]),
  );
  const dopedSub = dopedSubs[primarySubStat];
  const statTerm =
    4 * dopedMain +
    Object.values(dopedSubs).reduce((sum, value) => sum + value, 0);

  const combatRingAttackPercent = doping && includeEquippedRing
    ? attackType === "magic"
      ? combatRing.magicPercent
      : combatRing.attackPercent
    : 0;
  const combatRingBossDamage =
    doping && includeEquippedRing ? combatRing.bossDamage : 0;
  const learnedSkills = learnedSkillNames(skillData);
  const combatOrdersSharpEyesBonus =
    doping &&
    learnedSkills.has("쓸만한 컴뱃 오더스") &&
    learnedSkills.has("샤프 아이즈")
      ? 1
      : 0;
  // Nexon 최종 스탯 API는 코어에 장착한 쓸만한 샤프 아이즈가 꺼진
  // 상태의 크확을 반환한다. 외부 소비 도핑과 섞지 않고 실제 스킬을
  // 보유한 캐릭터에만 +10%를 적용한다.
  const usefulSharpEyesCriticalRateBonus =
    doping && learnedSkills.has("쓸만한 샤프 아이즈")
    ? 10
    : 0;
  const criticalDamageBeforeReinforce =
    currentCriticalDamage +
    number(dopingTotals.criticalDamage) +
    number(classDopingAdjustment.criticalDamage) +
    number(classAlwaysOnAdjustment.criticalDamage) +
    (doping ? activeSkillCycle.criticalDamage : 0) +
    combatOrdersSharpEyesBonus;
  const sharpEyesHyperCriticalRateBonus = sharpEyesHyperCriticalRate(skillData);
  // 크리티컬 확률은 세이람의 영약·이벤트 버프 같은 외부 도핑을
  // 의도적으로 배제한다. 선택한 보스 세팅과 직업 스킬 보정만 사용한다.
  // 기존 응답 필드명은 호환성을 위해 dopedCriticalRate로 유지한다.
  const dopedCriticalRate = currentCriticalRate === null
    ? null
    : Math.max(
        0,
        currentCriticalRate +
          number(classDopingAdjustment.criticalRate) +
          usefulSharpEyesCriticalRateBonus +
          sharpEyesHyperCriticalRateBonus +
          (doping ? activeSkillCycle.criticalRate : 0) +
          combatOrdersSharpEyesBonus,
      );
  const baseCycleMain =
    currentMain +
    Math.floor(number(dopingTotals.mainStat) * (1 + mainPercent / 100));
  const baseCycleSubs = Object.fromEntries(
    resolvedSubStats.map((stat) => [
      stat,
      currentSubs[stat] +
        Math.floor(
          dopingSubStatByStat[stat] * (1 + subPercents[stat] / 100),
        ),
    ]),
  );
  const baseCycleStatTerm =
    4 * baseCycleMain +
    Object.values(baseCycleSubs).reduce((sum, value) => sum + value, 0);
  const baseCycleAttackPercent =
    attackPercent + number(dopingTotals.attackMagicPercent);
  const baseCycleFlatAttack =
    rawAttack +
    number(dopingTotals.attackMagic) +
    number(classDopingAdjustment.attackMagic) +
    number(classAlwaysOnAdjustment.attackMagic);
  const baseCycleDamageTotal =
    currentDamage +
    currentBossDamage +
    number(stats["상태이상 추가 데미지"]) +
    number(dopingTotals.damage) +
    number(dopingTotals.bossDamage) +
    number(classDopingAdjustment.damage) +
    number(classDopingAdjustment.bossDamage) +
    number(classAlwaysOnAdjustment.damage) +
    number(classAlwaysOnAdjustment.bossDamage) +
    (doping ? conditionalLinks.damage + conditionalLinks.bossDamage : 0);
  const criticalReinforceUptime =
    doping && CRITICAL_REINFORCE_CLASSES.has(character.character_class)
      ? weightedCriticalReinforceUptime({
          skillData,
          activeSkillCycle,
          combatRing,
          combatDuration: combatDurationSeconds,
          attackType,
          baseAttackPercent: baseCycleAttackPercent,
          baseFlatAttack: baseCycleFlatAttack,
          baseDamageTotal: baseCycleDamageTotal,
          baseStatTerm: baseCycleStatTerm,
          mainStat,
          subStats: resolvedSubStats,
          mainPercent,
          subPercents,
        }) || skillAverageUptime(
          skillData,
          "크리티컬 리인포스",
          30 / 120,
        )
      : 0;
  const criticalReinforceAverageCriticalDamage =
    dopedCriticalRate === null
      ? 0
      : dopedCriticalRate * 0.5 * criticalReinforceUptime;
  const effectiveBossCriticalRate = dopedCriticalRate === null
    ? null
    : dopedCriticalRate + number(classDopingAdjustment.bossCriticalRate);
  const conditionalBossCriticalRateBonus = number(
    classDopingAdjustment.conditionalBossCriticalRate,
  );
  const conditionalBossCriticalRate = effectiveBossCriticalRate === null
    ? null
    : effectiveBossCriticalRate + conditionalBossCriticalRateBonus;
  const apiConditionalDamage = number(stats["상태이상 추가 데미지"]);
  const activeAbilityConditionalDamage = conditionalDamageFromAbility(abilityData);
  const selectedAbilityConditionalDamage = conditionalDamageFromAbility(
    selectedAbilityData,
  );
  const activeLinkConditionalDamage = conditionalDamageFromLink(linkSkillData);
  const selectedLinkConditionalDamage = conditionalDamageFromLink(
    selectedLinkSkillData,
  );
  // 일부 공개 스냅샷은 어빌리티의 상태이상 데미지를 최종 스탯에
  // 포함하고, 오래된/축약 스냅샷은 필드를 생략한다. 포함 여부를 판별해
  // 전자는 selected-active delta, 후자는 선택 프리셋 값을 사용한다.
  const abilityConditionalIsReflected =
    activeAbilityConditionalDamage + activeLinkConditionalDamage === 0 ||
    apiConditionalDamage >=
      activeAbilityConditionalDamage + activeLinkConditionalDamage;
  const currentConditionalDamage = abilityConditionalIsReflected
    ? Math.max(
        0,
          apiConditionalDamage +
          selectedAbilityConditionalDamage -
          activeAbilityConditionalDamage +
          selectedLinkConditionalDamage -
          activeLinkConditionalDamage,
      )
    : Math.max(
        apiConditionalDamage,
        selectedAbilityConditionalDamage + selectedLinkConditionalDamage,
      );
  const combatEffects = [];
  if (doping) {
    combatEffects.push(createCombatEffect({
      layer: "general",
      source: doping.label ?? "공통 보스 전투 기준",
      sourceKey: "preset:full-boss-doping",
      activation: {
        mode: "external-preset",
        evidence: "full-boss-preset",
      },
      modifiers: {
        flatAttack: dopingTotals.attackMagic,
        attackPercent: dopingTotals.attackMagicPercent,
        damage: dopingTotals.damage,
        bossDamage: dopingTotals.bossDamage,
        criticalRate: usefulSharpEyesCriticalRateBonus,
        criticalDamage: dopingTotals.criticalDamage,
        ignoreDefenseSources: dopingTotals.ignoreDefenseSources,
      },
      metadata: {
        guildNoblesseResolved: guildNoblesse.available,
      },
    }));
  }
  if (Object.keys(classDopingAdjustment).length > 0) {
    combatEffects.push(createCombatEffect({
      layer: "class-skill",
      source: `${character.character_class} 공통 전투 설정`,
      sourceKey: `compatibility:${character.character_class}`,
      activation: {
        mode: "maintained",
        evidence: "class-compatibility-policy",
      },
      modifiers: {
        flatAttack: classDopingAdjustment.attackMagic,
        attackPercent: classDopingAdjustment.attackMagicPercent,
        damage: classDopingAdjustment.damage,
        bossDamage: classDopingAdjustment.bossDamage,
        criticalRate: classDopingAdjustment.criticalRate,
        criticalDamage: classDopingAdjustment.criticalDamage,
        ignoreDefenseSources: classDopingAdjustment.ignoreDefenseSources,
      },
      metadata: { compatibilityAdjustment: true },
    }));
  }
  if (Object.keys(classAlwaysOnAdjustment).length > 0) {
    combatEffects.push(createCombatEffect({
      layer: "class-skill",
      source: classAlwaysOnCombat.sources.join(" · ") ||
        `${character.character_class} 유지형 전투 효과`,
      sourceKey: `class-maintained:${character.character_class}`,
      activation: {
        mode: "maintained",
        evidence: "class-always-on-policy",
      },
      modifiers: {
        flatAttack: classAlwaysOnAdjustment.attackMagic,
        damage: classAlwaysOnAdjustment.damage,
        bossDamage: classAlwaysOnAdjustment.bossDamage,
        criticalDamage: classAlwaysOnAdjustment.criticalDamage,
        ignoreDefenseSources: classAlwaysOnAdjustment.ignoreDefenseSources,
      },
      metadata: {
        defaultMode: classAlwaysOnCombat.defaultMode,
        learnedSkillSources: classAlwaysOnCombat.learnedSkillSources,
      },
    }));
  }
  if (doping && includeEquippedRing) {
    for (const ring of combatRing.applied) {
      combatEffects.push(createCombatEffect({
        layer: "general",
        source: ring.name,
        sourceKey: `special-ring:${ring.slot}:${normalizedSpecialRingName(ring.name)}`,
        activation: {
          mode: ring.activationMode,
          evidence: ring.phaseProfileId
            ? "battle-practice-ring-timeline"
            : "equipped-special-ring",
        },
        kind: "special-ring",
        uptime: ring.uptime,
        modifiers: {
          attackPercent: attackType === "magic"
            ? ring.magicPercent
            : ring.attackPercent,
          bossDamage: ring.bossDamage,
        },
        metadata: {
          level: ring.level,
          slot: ring.slot,
          duration: ring.duration,
          cooldown: ring.cooldown,
          preparation: ring.preparation,
          timeUptime: ring.timeUptime,
          damageCoverage: ring.damageCoverage,
          phaseProfileId: ring.phaseProfileId,
        },
      }));
    }
  }
  if (doping) {
    for (const event of activeSkillCycle.applied) {
      combatEffects.push(createCombatEffect({
        layer: event.layer,
        source: event.name,
        sourceFamily: withoutSixthMasteryMarker(event.name),
        component: event.phase ?? null,
        activation: {
          mode: event.highPoint && event.uptime >= 1
            ? "maintained"
            : "cycle-average",
          evidence: "official-skill-description",
        },
        kind: event.model,
        uptime: event.uptime,
        modifiers: {
          flatAttack: event.flatAttack,
          attackPercent: event.attackPercent,
          damage: event.damage,
          bossDamage: event.bossDamage,
          criticalRate: event.criticalRate,
          criticalDamage: event.criticalDamage,
          ignoreDefense: event.ignoreDefense,
        },
        metadata: {
          duration: event.duration,
          cooldown: event.cooldown,
          highPoint: event.highPoint,
          enhancement: event.enhancement,
          phase: event.phase ?? null,
        },
      }));
    }
    combatEffects.push(createCombatEffect({
      layer: "general",
      source: "조건부 링크 스킬",
      sourceKey: "conditional:link-skills",
      activation: {
        mode: "conditional-maintained",
        evidence: "selected-link-preset",
      },
      kind: "conditional-link",
      modifiers: {
        damage: conditionalLinks.damage,
        bossDamage: conditionalLinks.bossDamage,
        ignoreDefenseSources: conditionalLinks.ignoreDefenseSources,
      },
      metadata: { sources: conditionalLinks.applied.map(({ name }) => name) },
    }));
    combatEffects.push(
      ...targetDefenseEffectsFromSkills(skillData),
    );
  }
  combatEffects.push(createCombatEffect({
    layer: "general",
    source: "상태 이상 대상 공격",
    sourceKey: "conditional:abnormal-status-damage",
    activation: {
      mode: "conditional-maintained",
      evidence: "boss-status-assumption",
    },
    kind: "conditional-stat",
    modifiers: { damage: currentConditionalDamage },
  }));
  if (criticalReinforceAverageCriticalDamage > 0) {
    combatEffects.push(createCombatEffect({
      layer: "common-skill",
      source: "크리티컬 리인포스",
      sourceKey: "common-skill:critical-reinforce",
      activation: {
        mode: "cycle-average",
        evidence: "weighted-skill-cycle",
      },
      kind: "derived",
      modifiers: {
        criticalDamage: criticalReinforceAverageCriticalDamage,
      },
      metadata: { uptime: criticalReinforceUptime },
    }));
  }
  for (const source of activeSkillCycle.baselineReflected ?? []) {
    combatEffects.push(createCombatEffect({
      layer: "baseline",
      source,
      sourceFamily: withoutSixthMasteryMarker(source),
      activation: {
        mode: "baseline-reflected",
        evidence: "nexon-final-stat",
      },
      includedInBaseline: true,
      metadata: { reason: "permanent-skill-in-final-stat" },
    }));
  }
  const combatModel = composeCombatModel({
    baseline: {
      flatAttack: rawAttack,
      attackPercent,
      damage: currentDamage,
      bossDamage: currentBossDamage,
      criticalRate: currentCriticalRate,
      criticalDamage: currentCriticalDamage,
      ignoreDefense: currentIgnoreDefense,
    },
    baselineSources: [
      { key: "character", label: "캐릭터 기본 스탯", included: true },
      { key: "equipment", label: "장착 장비·세트 효과", included: true },
      { key: "ability", label: "어빌리티", included: Boolean(abilityData) },
      { key: "link", label: "링크 스킬", included: Boolean(linkSkillData) },
      { key: "union", label: "유니온", included: Boolean(unionRaiderData) },
      { key: "artifact", label: "유니온 아티팩트", included: Boolean(unionArtifactData) },
      { key: "champion", label: "유니온 챔피언", included: Boolean(unionChampionData) },
      { key: "hyper", label: "하이퍼 스탯", included: Boolean(hyperStatData) },
    ],
    effects: combatEffects,
    damageChannels: resolveClassDamageChannels({
      characterClass: character.character_class,
      skillData,
      vMatrixData,
    }),
  });
  const dopedAttackPercent = combatModel.totals.attackPercent;
  const dopedAttack = combatModel.totals.flatAttack *
    (1 + dopedAttackPercent / 100);
  const dopedCriticalDamage = combatModel.totals.criticalDamage;
  const dopedDamageTotal =
    combatModel.totals.damage + combatModel.totals.bossDamage;
  const dopedIgnoreDefense = combatModel.totals.ignoreDefense;
  const targetDefenseRemaining = combatModel.targetDefenseRemaining;

  const oneMainPercentRelative = (4 * (dopedBaseMain / 100)) / statTerm;
  const flatMainToPercent =
    (4 * (1 + mainPercent / 100)) /
    statTerm /
    oneMainPercentRelative;
  const flatSubToPercents = Object.fromEntries(
    resolvedSubStats.map((stat) => [
      stat,
      (1 + subPercents[stat] / 100) / statTerm / oneMainPercentRelative,
    ]),
  );
  const flatSubToPercent = flatSubToPercents[primarySubStat];
  const flatAttackToPercent =
    (1 + dopedAttackPercent / 100) /
    dopedAttack /
    oneMainPercentRelative;
  const subStatPercentToMainPercentByStat = Object.fromEntries(
    resolvedSubStats.map((stat) => [
      stat,
      (dopedBaseSubs[stat] / 100 / statTerm) / oneMainPercentRelative,
    ]),
  );
  const allStatToPercent =
    1 +
    Object.values(subStatPercentToMainPercentByStat).reduce(
      (sum, value) => sum + value,
      0,
    );
  const criticalDamageToPercent =
    (1 / (135 + dopedCriticalDamage)) / oneMainPercentRelative;
  // 크리티컬 리인포스: 기존 크확이 만드는 평균 크뎀을 위의 기준
  // 크뎀에 먼저 넣고, 새 크확 1%의 한계 가치도 같은 가동률로 계산한다.
  // 크확이 100% 미만이어도 장비 환산은 100%를 전제로 하고 별도 경고한다.
  const criticalRateToPercent = criticalReinforceUptime > 0
    ? criticalDamageToPercent * 0.5 * criticalReinforceUptime
    : null;
  const attackPercentToPercent =
    (1 / (100 + dopedAttackPercent)) / oneMainPercentRelative;
  const bossDamageToPercent =
    (1 / (100 + dopedDamageTotal)) / oneMainPercentRelative;

  // 스탯별 계수 맵은 이중 부스탯 직업의 DEX와 STR을 서로
  // 다른 잠재 %에 맞춰 환산하기 위해 제공한다.
  const flatStatToFlatMainStatByStat = {
    [mainStat]: 1,
    ...Object.fromEntries(
      resolvedSubStats.map((stat) => [
        stat,
        flatSubToPercents[stat] / flatMainToPercent,
      ]),
    ),
  };
  const statPercentToMainPercentByStat = {
    [mainStat]: 1,
    ...subStatPercentToMainPercentByStat,
  };
  const unreflectedStatToPercentByStat = {
    [mainStat]: 100 / dopedBaseMain,
    ...Object.fromEntries(
      resolvedSubStats.map((stat) => [stat, 25 / dopedBaseMain]),
    ),
  };
  const statEquivalence = {
    flatMainStatToPercent: flatMainToPercent,
    flatSubStatToFlatMainStat: flatSubToPercent / flatMainToPercent,
    flatStatToFlatMainStatByStat,
    attackToMainStat: flatAttackToPercent / flatMainToPercent,
    allStatPercentToMainPercent: allStatToPercent,
    subStatPercentToMainPercent:
      subStatPercentToMainPercentByStat[primarySubStat],
    statPercentToMainPercentByStat,
    criticalDamageToMainPercent: criticalDamageToPercent,
    ...(criticalRateToPercent === null
      ? {}
      : { criticalRateToMainPercent: criticalRateToPercent }),
    attackPercentToMainPercent: attackPercentToPercent,
    bossDamageToMainPercent: bossDamageToPercent,
    unreflectedMainStatToPercent: 100 / dopedBaseMain,
    unreflectedSubStatToPercent: 25 / dopedBaseMain,
    unreflectedStatToPercentByStat,
    // 비선형 방무 환산에 필요한 현재 보스 기준값이다. 방무는 0~1이다.
    currentIgnoreDefense: dopedIgnoreDefense,
    // 아머 스플릿처럼 적에게 거는 방어율 감소는 캐릭터 방무와 별도의
    // 곱연산 축이다. 잠재/장비 요약에서도 같은 보스 방어율을 쓰도록 보존한다.
    targetDefenseRemaining,
    oneMainPercentRelative,
  };
  const classDamageProfile = classBattlePracticeDamageProfile(
    character.character_class,
  );
  // 피해 점유율은 다른 캐릭터의 방무·코어 상태가 반영된 관측값이다.
  // 외부 5표본 교차 검증에서 정한 직업 단위 신뢰도로, 프로필 계산과
  // 전역 방무 계산을 앙상블해 donor 상태를 그대로 복제하는 편향을 줄인다.
  const classDamageProfileConfidence = classDamageProfile
    ? Math.max(0, Math.min(
      1,
      number(classDamageProfile.iedBlendConfidence ?? 1),
    ))
    : 0;
  const ignoreDefenseGainComponents = (enemyDefense) => {
    const unprofiled = calculateDamageChannelIgnoreDefenseGain({
      currentIgnoreDefense: dopedIgnoreDefense,
      addedIgnoreDefense: 0.4,
      enemyDefense,
      channels: [],
    });
    const profiled = calculateDamageChannelIgnoreDefenseGain({
      currentIgnoreDefense: dopedIgnoreDefense,
      addedIgnoreDefense: 0.4,
      enemyDefense,
      channels: combatModel.damageChannels,
    });
    return {
      unprofiled,
      profiled,
      blended: unprofiled +
        (profiled - unprofiled) * classDamageProfileConfidence,
    };
  };
  const ied40Against300Components = ignoreDefenseGainComponents(
    3 * targetDefenseRemaining,
  );
  const ied40Against380Components = ignoreDefenseGainComponents(
    3.8 * targetDefenseRemaining,
  );
  const ied40Against300 = ied40Against300Components.blended /
    oneMainPercentRelative;
  const ied40Against380 = ied40Against380Components.blended /
    oneMainPercentRelative;
  if (ied40Against300 > 0) {
    statEquivalence.ied40Against300ToMainPercent = ied40Against300;
  }
  if (ied40Against380 > 0) {
    statEquivalence.ied40Against380ToMainPercent = ied40Against380;
  }

  for (const [key, value] of Object.entries(statEquivalence)) {
    if (value && typeof value === "object") {
      for (const [stat, coefficient] of Object.entries(value)) {
        ensurePositive(coefficient, `${key}.${stat}`);
      }
      continue;
    }
    if (key === "currentIgnoreDefense") {
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error("API 데이터에서 현재 방어율 무시를 계산하지 못했습니다.");
      }
    } else {
      ensurePositive(value, key);
    }
  }

  return {
    statEquivalence,
    details: {
      subStats: resolvedSubStats,
      baseMain,
      baseSub,
      baseSubs,
      activeBaseSubs,
      dopedBaseMain,
      dopedBaseSub,
      dopedBaseSubs,
      enumeratedBaseMain,
      enumeratedBaseSub,
      enumeratedBaseSubs,
      unreflectedMain: unreflected.main,
      unreflectedSub: unreflected.sub,
      unreflectedSubs: unreflected.subs,
      symbolUnreflectedMain: unreflected.symbolMain,
      symbolUnreflectedSub: unreflected.symbolSub,
      symbolUnreflectedSubs: unreflected.symbolSubs,
      hyperUnreflectedMain: unreflected.hyperMain,
      hyperUnreflectedSub: unreflected.hyperSub,
      hyperUnreflectedSubs: unreflected.hyperSubs,
      hexaUnreflectedMain: unreflected.hexaMain,
      skillCoreLevels: matrixSkillCoreSummary(vMatrixData, hexaMatrixData),
      abilityUnreflectedMain: unreflected.abilityMain,
      abilityUnreflectedSub: unreflected.abilitySub,
      abilityUnreflectedSubs: unreflected.abilitySubs,
      unionUnreflectedMain: unreflected.unionMain,
      unionUnreflectedSub: unreflected.unionSub,
      unionUnreflectedSubs: unreflected.unionSubs,
      selectedEquipmentPreset: resolvedPresets.selection.selected.equipment,
      selectedHyperStatPreset: resolvedPresets.selection.selected.hyper,
      selectedUnionPreset: resolvedPresets.selection.selected.union,
      selectedLinkPreset: resolvedPresets.selection.selected.link,
      selectedAbilityPreset: resolvedPresets.selection.selected.ability,
      presetSelection: resolvedPresets.selection,
      classDopingAdjustmentApplied:
        Object.keys(classDopingAdjustment).length > 0,
      classAlwaysOnAdjustmentApplied:
        Object.keys(classAlwaysOnAdjustment).length > 0,
      classAlwaysOnAdjustment,
      classAlwaysOnDefaultMode: classAlwaysOnCombat.defaultMode,
      classAlwaysOnSources: classAlwaysOnCombat.sources,
      classAlwaysOnLearnedSkillSources:
        classAlwaysOnCombat.learnedSkillSources,
      classStatAdjustmentApplied,
      baseCalculation: hasUnreflectedSnapshot ? "inverse" : "enumerated",
      mainPercent,
      subPercent,
      subPercents,
      attackPercent,
      combatRingAttackPercent,
      combatRingBossDamage,
      combatRingFlatMain,
      combatRingFlatSubs,
      combatRings: doping && includeEquippedRing ? combatRing.applied : [],
      activeSkillCycles: doping ? activeSkillCycle.applied : [],
      activeSkillCycleAverage: doping
        ? {
            baseFlat: activeSkillCycle.baseFlat,
            flatAttack: activeSkillCycle.flatAttack,
            attackPercent: activeSkillCycle.attackPercent,
            damage: activeSkillCycle.damage,
            bossDamage: activeSkillCycle.bossDamage,
            criticalRate: activeSkillCycle.criticalRate,
            criticalDamage: activeSkillCycle.criticalDamage,
            ignoreDefenseSources: activeSkillCycle.ignoreDefenseSources,
            baselineReflected: activeSkillCycle.baselineReflected,
          }
        : null,
      combatModel,
      classDamageProfile:
        classDamageProfile?.id ?? null,
      classDamageSkillProfileHash:
        classDamageProfile?.skillProfileHash ?? null,
      classDamageProfileHash: classDamageProfile?.profileHash ?? null,
      classDamageProfileConfidence,
      ignoreDefenseCalibration: {
        against300: Object.fromEntries(
          Object.entries(ied40Against300Components).map(([key, value]) => [
            `${key}ToMainPercent`,
            value / oneMainPercentRelative,
          ]),
        ),
        against380: Object.fromEntries(
          Object.entries(ied40Against380Components).map(([key, value]) => [
            `${key}ToMainPercent`,
            value / oneMainPercentRelative,
          ]),
        ),
      },
      targetDefenseRemaining,
      combatDurationSeconds,
      mapleWarriorPercent,
      equipmentAllStatPercent,
      titleFlatMain: title.flat[mainStat],
      titleFlatSub: title.flat[primarySubStat],
      titleFlatSubs: Object.fromEntries(
        resolvedSubStats.map((stat) => [stat, title.flat[stat]]),
      ),
      titleMainPercent: title.percent[mainStat],
      titleSubPercent: title.percent[primarySubStat],
      titleSubPercents: Object.fromEntries(
        resolvedSubStats.map((stat) => [stat, title.percent[stat]]),
      ),
      otherFlatMain: otherStats.flat[mainStat],
      otherFlatSub: otherStats.flat[primarySubStat],
      otherFlatSubs: Object.fromEntries(
        resolvedSubStats.map((stat) => [stat, otherStats.flat[stat]]),
      ),
      otherMainPercent: otherStats.percent[mainStat],
      otherSubPercent: otherStats.percent[primarySubStat],
      otherSubPercents: Object.fromEntries(
        resolvedSubStats.map((stat) => [stat, otherStats.percent[stat]]),
      ),
      externalComponents: {
        cashEquipment: {
          flatMain: cashEquipment.flat[mainStat],
          flatSubs: Object.fromEntries(
            resolvedSubStats.map((stat) => [stat, cashEquipment.flat[stat]]),
          ),
          flatHp: cashEquipment.flatHp,
          flatAttack: relevantFlatAttack(cashEquipment, attackType),
        },
        petEquipment: {
          activePreset: petEquipment.activePreset,
          selectedPreset: petEquipment.selectedPreset,
          availablePresets: petEquipment.available,
          changed: petEquipment.changed,
          activeFlatAttack: relevantFlatAttack(petEquipment.active, attackType),
          selectedFlatAttack: relevantFlatAttack(
            petEquipment.selected,
            attackType,
          ),
          passiveFlatAttack: relevantFlatAttack(
            petEquipment.skills,
            attackType,
          ),
        },
        setEffect: {
          adjustedSets:
            resolvedPresets.selectedSnapshot.setEffectResolution
              ?.adjustedSets ?? [],
          unresolvedSets:
            resolvedPresets.selectedSnapshot.setEffectResolution
              ?.unresolvedSets ?? [],
          flatMain: sets.flat[mainStat],
          flatAttack: relevantFlatAttack(sets, attackType),
          flatHp: sets.flatHp,
          hpPercent: sets.hpPercent,
          bossDamage: sets.bossDamage,
          criticalDamage: sets.criticalDamage,
          ignoreDefenseSources: sets.ignoreDefenseSources,
        },
        otherStat: {
          flatMain: otherStats.flat[mainStat],
          flatAttack: relevantFlatAttack(otherStats, attackType),
          flatHp: otherStats.flatHp,
          hpPercent: otherStats.hpPercent,
        },
      },
      skillFlatMain: skills.flat[mainStat],
      skillFlatSub: skills.flat[primarySubStat],
      skillFlatSubs: Object.fromEntries(
        resolvedSubStats.map((stat) => [stat, skills.flat[stat]]),
      ),
      skillMainPercent: skills.percent[mainStat],
      skillSubPercent: skills.percent[primarySubStat],
      skillSubPercents: Object.fromEntries(
        resolvedSubStats.map((stat) => [stat, skills.percent[stat]]),
      ),
      linkFlatMain: links.flat[mainStat],
      linkFlatSub: links.flat[primarySubStat],
      linkFlatSubs: Object.fromEntries(
        resolvedSubStats.map((stat) => [stat, links.flat[stat]]),
      ),
      linkMainPercent: links.percent[mainStat],
      linkSubPercent: links.percent[primarySubStat],
      linkSubPercents: Object.fromEntries(
        resolvedSubStats.map((stat) => [stat, links.percent[stat]]),
      ),
      currentMain,
      currentSub,
      currentSubs,
      currentAttack,
      apiCurrentMain,
      apiCurrentSub,
      apiCurrentSubs,
      apiCurrentAttack,
      rawAttack,
      apiCurrentCriticalRate,
      currentCriticalRate,
      currentCriticalDamage,
      currentDamage,
      currentBossDamage,
      currentIgnoreDefense: currentIgnoreDefense * 100,
      dopedMain,
      dopedSub,
      dopedSubs,
      dopedAttack,
      dopedAttackPercent,
      dopedCriticalDamage,
      criticalDamageBeforeReinforce,
      criticalReinforceAverageCriticalDamage,
      combatOrdersSharpEyesBonus,
      dopedCriticalRate,
      criticalRateBasis: "non-external-doping",
      sharpEyesHyperCriticalRateBonus,
      usefulSharpEyesCriticalRateBonus,
      effectiveBossCriticalRate,
      conditionalBossCriticalRateBonus,
      conditionalBossCriticalRate,
      conditionalBossCriticalRateSource:
        classDopingAdjustment.conditionalBossCriticalRateSource ?? null,
      criticalRateAssumedForConversion:
        100,
      criticalReinforceUptime:
        criticalRateToPercent === null ? null : criticalReinforceUptime,
      currentConditionalDamage,
      conditionalLinkDamage: doping ? conditionalLinks.damage : 0,
      conditionalLinkBossDamage: doping ? conditionalLinks.bossDamage : 0,
      conditionalLinkIgnoreDefenseSources:
        doping ? conditionalLinks.ignoreDefenseSources : [],
      conditionalLinkSources: doping ? conditionalLinks.applied : [],
      guildNoblesseResolved: guildNoblesse.available,
      guildNoblesseSkills: guildNoblesse.available
        ? guildNoblesse.skills
        : [],
      guildNoblesseAdjustment: guildDifference,
      effectiveDopingTotals: doping ? dopingTotals : {},
      dopedDamageTotal,
      dopedIgnoreDefense: dopedIgnoreDefense * 100,
    },
  };
}
