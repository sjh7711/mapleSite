import type { CharacterPotentialSnapshot, JsonObject } from "./nexon";
import {
  calculateActiveSkillCycleBonuses,
  calculateCombatRingBonuses,
  calculateConditionalLinkCycleBonuses,
  calculateGuildNoblesseBonuses,
  resolveCharacterExternalBonuses,
  resolveClassAlwaysOnCombatAdjustment,
  resolveClassDamageChannels,
} from "maple-core/stat-efficiency";
import {
  composeCombatModel,
  createCombatEffect,
  targetDefenseEffectsFromSkills,
} from "maple-core/combat-model";

const STAT_KEYS = ["STR", "DEX", "INT", "LUK"] as const;
const XENON_STATS = ["STR", "DEX", "LUK"] as const;
const XENON_HEXA_RATIO = 0.48;

export type AddOptionStatKey = (typeof STAT_KEYS)[number] | "HP";
export type SpecialAddOptionStatModel =
  | "xenon"
  | "제논"
  | "demon-avenger"
  | "demonAvenger"
  | "데몬어벤져";

export type SpecialAddOptionConversionInput = {
  character: JsonObject;
  snapshot?: Partial<CharacterPotentialSnapshot>;
  activeSnapshot?: Partial<CharacterPotentialSnapshot>;
  presetSelection?: Record<string, unknown>;
  statModel: SpecialAddOptionStatModel;
  doping?: unknown;
} & Partial<CharacterPotentialSnapshot>;

export type SpecialAddOptionConversionResult = {
  flatStatToDamagePercent: Record<AddOptionStatKey, number>;
  flatAttackToDamagePercent: number;
  allStatPercentToDamagePercent: number;
  bossDamageToDamagePercent: 1;
  targetToDamagePercent: number;
  details: Record<string, unknown>;
};

type StatKey = (typeof STAT_KEYS)[number];
type PercentBonuses = {
  stat: Record<StatKey, number>;
  hp: number;
  attack: number;
};

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function objects(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.map(object).filter((item): item is JsonObject => Boolean(item))
    : [];
}

function number(value: unknown): number {
  const parsed = Number(String(value ?? "0").replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function emptyPercentBonuses(): PercentBonuses {
  return {
    stat: { STR: 0, DEX: 0, INT: 0, LUK: 0 },
    hp: 0,
    attack: 0,
  };
}

function mergePercentBonuses(...sources: PercentBonuses[]): PercentBonuses {
  const result = emptyPercentBonuses();
  for (const source of sources) {
    for (const stat of STAT_KEYS) result.stat[stat] += source.stat[stat];
    result.hp += source.hp;
    result.attack += source.attack;
  }
  return result;
}

function parsePercentText(raw: unknown, result = emptyPercentBonuses()): PercentBonuses {
  const source = text(raw);
  for (const match of source.matchAll(
    /(올스탯|STR|DEX|INT|LUK)\s*(?:이)?\s*:?\s*\+?\s*(\d+(?:\.\d+)?)\s*%\s*(?:증가)?/g,
  )) {
    const stats = match[1] === "올스탯" ? STAT_KEYS : [match[1] as StatKey];
    for (const stat of stats) result.stat[stat] += number(match[2]);
  }
  for (const match of source.matchAll(
    /(?:최대\s*)?HP\s*(?:가|이)?\s*:?\s*\+?\s*(\d+(?:\.\d+)?)\s*%\s*(?:증가)?/g,
  )) {
    result.hp += number(match[1]);
  }
  for (const match of source.matchAll(
    /(?:공격력과 마력|공격력\/마력|공격력)\s*(?:이)?\s*:?\s*\+?\s*(\d+(?:\.\d+)?)\s*%\s*(?:증가)?/g,
  )) {
    result.attack += number(match[1]);
  }
  return result;
}

function equipmentItems(equipmentData: JsonObject): JsonObject[] {
  return objects(equipmentData.item_equipment).filter(
    (item) => text(item.item_equipment_slot) !== "예비 특수 반지",
  );
}

function equipmentOptionLines(equipmentData: JsonObject): string[] {
  return equipmentItems(equipmentData).flatMap((item) =>
    [
      item.potential_option_1,
      item.potential_option_2,
      item.potential_option_3,
      item.additional_potential_option_1,
      item.additional_potential_option_2,
      item.additional_potential_option_3,
      item.soul_option,
    ].map(text).filter(Boolean),
  );
}

function titleData(equipmentData: JsonObject): JsonObject | null {
  return object(equipmentData.title);
}

function equipmentPercentBonuses(equipmentData: JsonObject): PercentBonuses {
  const result = emptyPercentBonuses();
  for (const item of equipmentItems(equipmentData)) {
    const total = object(item.item_total_option);
    const allStat = number(total?.all_stat);
    for (const stat of STAT_KEYS) result.stat[stat] += allStat;
    result.hp += number(total?.max_hp_rate);
  }
  for (const line of equipmentOptionLines(equipmentData)) {
    parsePercentText(line, result);
  }
  parsePercentText(titleData(equipmentData)?.title_description, result);
  return result;
}

function flatStatFromTexts(
  texts: string[],
  stat: StatKey,
  characterLevel: number,
): number {
  let total = 0;
  for (const source of texts) {
    for (const match of source.matchAll(
      /(올스탯|STR|DEX|INT|LUK)\s*:?\s*\+\s*(\d+(?:\.\d+)?)(?![\d.]|\s*%)/g,
    )) {
      if (match[1] === "올스탯" || match[1] === stat) total += number(match[2]);
    }
    for (const match of source.matchAll(
      /캐릭터 기준 9레벨 당 (STR|DEX|INT|LUK)\s*\+\s*(\d+(?:\.\d+)?)/g,
    )) {
      if (match[1] === stat) {
        total += Math.floor(characterLevel / 9) * number(match[2]);
      }
    }
    const all = source.match(/^올스탯\s+(\d+(?:\.\d+)?)\s*증가/);
    if (all) total += number(all[1]);
    const direct = source.match(
      /^((?:STR|DEX|INT|LUK)(?:,\s*(?:STR|DEX|INT|LUK))*)\s+(\d+(?:\.\d+)?)\s*증가/,
    );
    if (direct?.[1].split(/,\s*/).includes(stat)) total += number(direct[2]);
  }
  return total;
}

function equipmentFlatStat(
  equipmentData: JsonObject,
  stat: StatKey,
  characterLevel: number,
): number {
  const key = stat.toLocaleLowerCase("en-US");
  const total = equipmentItems(equipmentData).reduce(
    (sum, item) => sum + number(object(item.item_total_option)?.[key]),
    0,
  );
  return total + flatStatFromTexts(
    [
      ...equipmentOptionLines(equipmentData),
      text(titleData(equipmentData)?.title_description),
    ],
    stat,
    characterLevel,
  );
}

function linkFlatStat(
  linkSkillData: JsonObject,
  stat: StatKey,
  characterLevel: number,
): number {
  return flatStatFromTexts(linkSkillTexts(linkSkillData), stat, characterLevel);
}

type CombatTotals = {
  flatAttack: number;
  damage: number;
  bossDamage: number;
};

function combatFromTexts(texts: string[]): CombatTotals {
  const result: CombatTotals = { flatAttack: 0, damage: 0, bossDamage: 0 };
  for (const source of texts) {
    for (const match of source.matchAll(
      /(?:공격력과 마력|공격력\/마력|공격력)\s*(?:이)?\s*:?\s*\+?\s*(\d+(?:\.\d+)?)(?![\d.]|\s*%)(?:\s*증가)?/g,
    )) {
      result.flatAttack += number(match[1]);
    }
    for (const match of source.matchAll(
      /보스 몬스터(?: 공격 시)? 데미지(?:가)?\s*:?\s*\+?\s*(\d+(?:\.\d+)?)\s*%/g,
    )) {
      result.bossDamage += number(match[1]);
    }
    for (const match of source.matchAll(
      /(?:^|[,.\n]\s*)데미지(?:가)?\s*:?\s*\+?\s*(\d+(?:\.\d+)?)\s*%/g,
    )) {
      result.damage += number(match[1]);
    }
  }
  return result;
}

function snapshotCombatTotals(
  snapshot: CharacterPotentialSnapshot,
  hyperEntries: JsonObject[],
  unionTexts: string[],
): CombatTotals {
  const attackItems = equipmentItems(snapshot.equipmentData).reduce(
    (sum, item) =>
      sum + number(object(item.item_total_option)?.attack_power),
    0,
  );
  const itemBoss = equipmentItems(snapshot.equipmentData).reduce(
    (sum, item) => sum + number(object(item.item_total_option)?.boss_damage),
    0,
  );
  const itemDamage = equipmentItems(snapshot.equipmentData).reduce(
    (sum, item) => sum + number(object(item.item_total_option)?.damage),
    0,
  );
  const texts = [
    ...equipmentOptionLines(snapshot.equipmentData),
    text(titleData(snapshot.equipmentData)?.title_description),
    ...hyperEntries.map((entry) => text(entry.stat_increase)),
    ...unionTexts,
    ...linkSkillTexts(snapshot.linkSkillData),
    ...objects(snapshot.abilityData.ability_info).map((entry) =>
      text(entry.ability_value),
    ),
  ];
  const parsed = combatFromTexts(texts);
  return {
    flatAttack: attackItems + parsed.flatAttack,
    damage: itemDamage + parsed.damage,
    bossDamage: itemBoss + parsed.bossDamage,
  };
}

function setEffectTexts(setEffectData: JsonObject): string[] {
  return objects(setEffectData.set_effect).flatMap((set) =>
    objects(set.set_effect_info).map((entry) => text(entry.set_option)),
  );
}

function otherStatPercentBonuses(otherStatData: JsonObject): PercentBonuses {
  const result = emptyPercentBonuses();
  for (const group of objects(otherStatData.other_stat)) {
    for (const entry of objects(group.stat_info)) {
      const name = text(entry.stat_name).trim();
      const value = number(entry.stat_value);
      const stat = name.match(/^(STR|DEX|INT|LUK)\s*\(\+%\)$/)?.[1] as
        | StatKey
        | undefined;
      if (stat) result.stat[stat] += value;
      else if (name === "올스탯 (+%)") {
        for (const key of STAT_KEYS) result.stat[key] += value;
      } else if (name === "최대 HP (+%)" || name === "HP (+%)") {
        result.hp += value;
      } else if (name === "공격력 (+%)") {
        result.attack += value;
      }
    }
  }
  return result;
}

function passiveSkillTexts(skillData: JsonObject[]): string[] {
  const result: string[] = [];
  const rawSkills = skillData.flatMap((grade) => objects(grade.character_skill));
  const viBaseNames = new Set(
    rawSkills
      .map((skill) => text(skill.skill_name).trim())
      .filter((name) => /\s+VI$/.test(name))
      .map((name) => name.replace(/\s+VI$/, "")),
  );
  const skills = rawSkills.filter((skill) => {
    const name = text(skill.skill_name).trim();
    return /\s+VI$/.test(name) || !viBaseNames.has(name);
  });
  for (const skill of skills) {
    const effect = text(skill.skill_effect);
    const description = text(skill.skill_description);
    const passive = [...effect.matchAll(/\[패시브 효과\s*:\s*([^\]]+)\]/g)].map(
      (match) => match[1],
    );
    if (passive.length) {
      result.push(...passive);
      continue;
    }
    const temporary = /\d+(?:\.\d+)?초 동안|재사용 대기시간|MP\s*\d+\s*소비/.test(
      effect,
    );
    if (/영구/.test(`${description}\n${effect}`) || !temporary) result.push(effect);
  }
  return result;
}

function linkSkillTexts(linkSkillData: JsonObject): string[] {
  return [
    ...objects(linkSkillData.character_link_skill),
    object(linkSkillData.character_owned_link_skill),
  ]
    .filter((entry): entry is JsonObject => Boolean(entry))
    .map((entry) => text(entry.skill_effect));
}

function textPercentBonuses(texts: string[]): PercentBonuses {
  const result = emptyPercentBonuses();
  for (const source of texts) parsePercentText(source, result);
  return result;
}

function coreBonusPercentBonuses(value: unknown): PercentBonuses {
  const source = object(value) ?? {};
  const percent = object(source.percent) ?? {};
  return {
    stat: Object.fromEntries(
      STAT_KEYS.map((stat) => [stat, number(percent[stat])]),
    ) as Record<StatKey, number>,
    hp: number(source.hpPercent),
    attack: number(source.attackPercent),
  };
}

function externalSnapshotBonuses(
  snapshot: CharacterPotentialSnapshot,
  presetMode: "active" | "auto",
) {
  return resolveCharacterExternalBonuses({
    cashEquipmentData: snapshot.cashEquipmentData,
    petEquipmentData: snapshot.petEquipmentData,
    otherStatData: snapshot.otherStatData,
    setEffectData: snapshot.setEffectData,
    attackType: "attack",
    presetMode,
  });
}

function coreBonusFlatStat(value: unknown, stat: StatKey): number {
  return number(object(object(value)?.flat)?.[stat]);
}

function coreBonusFlatAttack(value: unknown): number {
  return number(object(value)?.flatAttack);
}

function sharedPercentBonuses(
  snapshot: CharacterPotentialSnapshot,
  equipmentData: JsonObject,
  presetMode: "active" | "auto" = "active",
): PercentBonuses {
  const external = externalSnapshotBonuses(snapshot, presetMode);
  const pet = object(external.pet) ?? {};
  return mergePercentBonuses(
    equipmentPercentBonuses(equipmentData),
    textPercentBonuses(setEffectTexts(snapshot.setEffectData)),
    otherStatPercentBonuses(snapshot.otherStatData),
    coreBonusPercentBonuses(external.cash),
    coreBonusPercentBonuses(pet[presetMode === "auto" ? "selected" : "active"]),
    coreBonusPercentBonuses(pet.skills),
    textPercentBonuses(passiveSkillTexts(snapshot.skillData)),
    textPercentBonuses(linkSkillTexts(snapshot.linkSkillData)),
  );
}

function finalStats(statData: JsonObject): Record<string, number> {
  return Object.fromEntries(
    objects(statData.final_stat).map((entry) => [
      text(entry.stat_name),
      number(entry.stat_value),
    ]),
  );
}

function symbolStatTotal(symbolData: JsonObject, stat: StatKey): number {
  const key = `symbol_${stat.toLocaleLowerCase("en-US")}`;
  return objects(symbolData.symbol).reduce(
    (sum, symbol) => sum + number(symbol[key]),
    0,
  );
}

function hyperPresetEntries(hyperStatData: JsonObject, preset: unknown): JsonObject[] {
  return objects(hyperStatData[`hyper_stat_preset_${String(preset ?? "")}`]);
}

function increaseFromText(raw: unknown): number {
  return number(text(raw).match(/(\d+(?:\.\d+)?)\s*%?\s*증가/)?.[1]);
}

function activeHyperPreset(hyperStatData: JsonObject): {
  entries: JsonObject[];
  preset: string | null;
} {
  const preset = text(hyperStatData.use_preset_no) || null;
  return { preset, entries: hyperPresetEntries(hyperStatData, preset) };
}

function hyperStatTotal(entries: JsonObject[], stat: StatKey): number {
  const entry = entries.find((item) => text(item.stat_type) === stat);
  return increaseFromText(entry?.stat_increase);
}

function hexaNominalMainStat(hexaStatData: JsonObject): number {
  const cores = [
    ...objects(hexaStatData.character_hexa_stat_core),
    ...objects(hexaStatData.character_hexa_stat_core_2),
    ...objects(hexaStatData.character_hexa_stat_core_3),
  ];
  return cores.reduce((sum, core) => {
    const main = core.main_stat_name === "주력 스탯 증가"
      ? (number(core.main_stat_level) + 1) * 100
      : 0;
    const sub1 = core.sub_stat_name_1 === "주력 스탯 증가"
      ? number(core.sub_stat_level_1) * 100
      : 0;
    const sub2 = core.sub_stat_name_2 === "주력 스탯 증가"
      ? number(core.sub_stat_level_2) * 100
      : 0;
    return sum + main + sub1 + sub2;
  }, 0);
}

function abilityStatTotal(abilityData: JsonObject, stat: StatKey): number {
  return objects(abilityData.ability_info).reduce((sum, ability) => {
    let value = 0;
    for (const match of text(ability.ability_value).matchAll(
      /(STR|DEX|INT|LUK)\s+(\d+(?:\.\d+)?)\s*증가/g,
    )) {
      if (match[1] === stat) value += number(match[2]);
    }
    return sum + value;
  }, 0);
}

function statFromTexts(texts: string[], stat: StatKey): number {
  let result = 0;
  for (const source of texts) {
    const all = source.match(/^올스탯\s+(\d+(?:\.\d+)?)\s*증가/);
    if (all) result += number(all[1]);
    const stats = source.match(
      /^((?:STR|DEX|INT|LUK)(?:,\s*(?:STR|DEX|INT|LUK))*)\s+(\d+(?:\.\d+)?)\s*증가/,
    );
    if (stats?.[1].split(/,\s*/).includes(stat)) result += number(stats[2]);
  }
  return result;
}

function unionStatTotal(
  unionRaiderData: JsonObject,
  unionArtifactData: JsonObject,
  unionChampionData: JsonObject,
  stateTexts: string[],
  stat: StatKey,
): number {
  const texts = [
    ...objects(unionRaiderData.union_raider_stat).map((entry) => text(entry)),
    ...objects(unionRaiderData.union_occupied_stat).map((entry) => text(entry)),
    ...stateTexts,
    ...objects(unionRaiderData.union_inner_stat).flatMap((entry) =>
      Object.values(entry).map(text).filter(Boolean),
    ),
    ...objects(unionArtifactData.union_artifact_effect).map((entry) => text(entry.name)),
    ...objects(unionChampionData.champion_badge_total_info).map((entry) =>
      text(entry.stat)
    ),
  ];
  // Some Open API responses expose the first two arrays directly as strings.
  const directTexts = [
    ...(Array.isArray(unionRaiderData.union_raider_stat)
      ? unionRaiderData.union_raider_stat.map(text)
      : []),
    ...(Array.isArray(unionRaiderData.union_occupied_stat)
      ? unionRaiderData.union_occupied_stat.map(text)
      : []),
  ];
  return statFromTexts([...texts, ...directTexts], stat);
}

function activeUnionState(unionRaiderData: JsonObject): {
  texts: string[];
  preset: number | string | null;
} {
  return {
    texts: Array.isArray(unionRaiderData.union_state_stat)
      ? unionRaiderData.union_state_stat.map(text)
      : [],
    preset: (unionRaiderData.use_preset_no as number | string | undefined) ?? null,
  };
}

function unreflectedStat(
  snapshot: CharacterPotentialSnapshot,
  hyperEntries: JsonObject[],
  unionStateTexts: string[],
  stat: StatKey,
  xenon: boolean,
): Record<string, number> {
  const symbol = symbolStatTotal(snapshot.symbolData, stat);
  const hyper = hyperStatTotal(hyperEntries, stat);
  const hexa = xenon ? hexaNominalMainStat(snapshot.hexaStatData) * XENON_HEXA_RATIO : 0;
  const ability = abilityStatTotal(snapshot.abilityData, stat);
  const union = unionStatTotal(
    snapshot.unionRaiderData,
    snapshot.unionArtifactData,
    snapshot.unionChampionData,
    unionStateTexts,
    stat,
  );
  return { total: symbol + hyper + hexa + ability + union, symbol, hyper, hexa, ability, union };
}

function conditionalDamageFromAbility(abilityData: JsonObject): number {
  return objects(abilityData.ability_info).reduce((sum, ability) => {
    const match = text(ability.ability_value).match(
      /상태 이상에 걸린 대상 공격 시 데미지\s+(\d+(?:\.\d+)?)%\s*증가/,
    );
    return sum + number(match?.[1]);
  }, 0);
}

function dopingRecords(input: SpecialAddOptionConversionInput): {
  totals: JsonObject;
  adjustment: JsonObject;
} {
  const doping = object(input.doping);
  const totals = object(doping?.totals) ?? {};
  const adjustments = object(doping?.classAdjustments);
  const className = text(input.character.character_class);
  return { totals, adjustment: object(adjustments?.[className]) ?? {} };
}

function mappedNumber(source: JsonObject, field: string, key: string): number {
  return number(object(source[field])?.[key]);
}

function resolvedSnapshot(input: SpecialAddOptionConversionInput): CharacterPotentialSnapshot {
  const nested = input.snapshot ?? {};
  const value = (key: keyof CharacterPotentialSnapshot): JsonObject | JsonObject[] =>
    (nested[key] ?? input[key] ?? (key === "skillData" ? [] : {})) as
      | JsonObject
      | JsonObject[];
  return {
    statData: value("statData") as JsonObject,
    equipmentData: value("equipmentData") as JsonObject,
    cashEquipmentData: value("cashEquipmentData") as JsonObject,
    petEquipmentData: value("petEquipmentData") as JsonObject,
    setEffectData: value("setEffectData") as JsonObject,
    otherStatData: value("otherStatData") as JsonObject,
    linkSkillData: value("linkSkillData") as JsonObject,
    skillData: value("skillData") as JsonObject[],
    symbolData: value("symbolData") as JsonObject,
    hyperStatData: value("hyperStatData") as JsonObject,
    hexaStatData: value("hexaStatData") as JsonObject,
    hexaMatrixData: value("hexaMatrixData") as JsonObject,
    vMatrixData: value("vMatrixData") as JsonObject,
    abilityData: value("abilityData") as JsonObject,
    unionRaiderData: value("unionRaiderData") as JsonObject,
    unionArtifactData: value("unionArtifactData") as JsonObject,
    unionChampionData: value("unionChampionData") as JsonObject,
    ringReserveData: value("ringReserveData") as JsonObject,
    guildData: value("guildData") as JsonObject,
  };
}

function emptyFlatConversion(): Record<AddOptionStatKey, number> {
  return { STR: 0, DEX: 0, INT: 0, LUK: 0, HP: 0 };
}

function ensureFiniteNonnegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`특수 직업 추옵 환산값(${label})을 계산하지 못했습니다.`);
  }
  return value;
}

function calculateXenon(
  input: SpecialAddOptionConversionInput,
  snapshot: CharacterPotentialSnapshot,
): SpecialAddOptionConversionResult {
  const stats = finalStats(snapshot.statData);
  const activeSnapshot = input.activeSnapshot
    ? resolvedSnapshot({ ...input, snapshot: input.activeSnapshot })
    : snapshot;
  const characterLevel = number(input.character.character_level);
  const selectedPresetMode = input.presetSelection?.mode === "auto"
    ? "auto"
    : "active";
  const activeExternal = externalSnapshotBonuses(activeSnapshot, "active");
  const selectedExternal = externalSnapshotBonuses(
    snapshot,
    selectedPresetMode,
  );
  const activePet = object(activeExternal.pet) ?? {};
  const selectedPet = object(selectedExternal.pet) ?? {};
  const activeHyper = activeHyperPreset(activeSnapshot.hyperStatData);
  const activeUnion = activeUnionState(activeSnapshot.unionRaiderData);
  const hyper = activeHyperPreset(snapshot.hyperStatData);
  const union = activeUnionState(snapshot.unionRaiderData);
  const activePercent = mergePercentBonuses(
    sharedPercentBonuses(activeSnapshot, activeSnapshot.equipmentData, "active"),
    textPercentBonuses(activeHyper.entries.map((entry) => text(entry.stat_increase))),
  );
  const percent = mergePercentBonuses(
    sharedPercentBonuses(
      snapshot,
      snapshot.equipmentData,
      input.presetSelection && input.presetSelection.mode === "auto"
        ? "auto"
        : "active",
    ),
    textPercentBonuses(hyper.entries.map((entry) => text(entry.stat_increase))),
  );
  const unreflected = Object.fromEntries(
    XENON_STATS.map((stat) => [
      stat,
      unreflectedStat(snapshot, hyper.entries, union.texts, stat, true),
    ]),
  ) as Record<(typeof XENON_STATS)[number], Record<string, number>>;
  const activeUnreflected = Object.fromEntries(
    XENON_STATS.map((stat) => [
      stat,
      unreflectedStat(
        activeSnapshot,
        activeHyper.entries,
        activeUnion.texts,
        stat,
        true,
      ),
    ]),
  ) as Record<(typeof XENON_STATS)[number], Record<string, number>>;
  const { totals, adjustment } = dopingRecords(input);
  const classAlwaysOnCombat = resolveClassAlwaysOnCombatAdjustment(
    text(input.character.character_class),
    snapshot.skillData,
  );
  const classAlwaysOnAdjustment = object(classAlwaysOnCombat.adjustment) ?? {};
  const combatDuration = Math.max(
    1,
    number(totals.combatDurationSeconds) || 360,
  );
  const includeEquippedRing = Boolean(totals.includeEquippedRing) && Boolean(input.doping);
  const combatRing = calculateCombatRingBonuses(
    snapshot.equipmentData,
    snapshot.ringReserveData,
    snapshot.skillData,
    "attack",
    combatDuration,
    text(input.character.character_class),
  );
  const activeSkillCycle = calculateActiveSkillCycleBonuses(
    snapshot.skillData,
    "attack",
    combatDuration,
    {
      apStats: Object.fromEntries(
        STAT_KEYS.map((stat) => [stat, stats[`AP 배분 ${stat}`]]),
      ),
      mapleWarriorPercent: 15,
      characterClass: text(input.character.character_class),
      equipmentData: snapshot.equipmentData,
    },
  );
  const conditionalLinks = calculateConditionalLinkCycleBonuses(
    snapshot.linkSkillData,
  );
  const guildNoblesse = calculateGuildNoblesseBonuses(snapshot.guildData);
  const doping = object(input.doping);
  const guildBaseline = object(doping?.guildBaseline) ?? {};
  const guildDifference = input.doping && guildNoblesse.available
    ? {
        damage:
          number(guildNoblesse.damage) - number(guildBaseline.damage),
        bossDamage:
          number(guildNoblesse.bossDamage) - number(guildBaseline.bossDamage),
        criticalDamage:
          number(guildNoblesse.criticalDamage) -
          number(guildBaseline.criticalDamage),
      }
    : { damage: 0, bossDamage: 0, criticalDamage: 0 };
  const genericAllStat = number(totals.mainStat);
  const flatStats = object(totals.flatStats);
  const adjustmentFlatStats = object(adjustment.flatStats);
  const adjustmentStatPercent = object(adjustment.statPercent);

  const base: Record<(typeof XENON_STATS)[number], number> = {
    STR: 0,
    DEX: 0,
    LUK: 0,
  };
  const current: typeof base = { STR: 0, DEX: 0, LUK: 0 };
  const dopedBase: typeof base = { STR: 0, DEX: 0, LUK: 0 };
  const doped: typeof base = { STR: 0, DEX: 0, LUK: 0 };
  const dopedPercent: typeof base = { STR: 0, DEX: 0, LUK: 0 };
  for (const stat of XENON_STATS) {
    const final = stats[stat];
    const activeStatPercent = activePercent.stat[stat];
    const unreflectedValue = unreflected[stat].total;
    const activeUnreflectedValue = activeUnreflected[stat].total;
    if (!(final > activeUnreflectedValue)) {
      throw new Error(`NEXON API에서 제논의 ${stat} 환산 기준을 계산하지 못했습니다.`);
    }
    const activeBase = Math.ceil(
      (final - activeUnreflectedValue) / (1 + activeStatPercent / 100),
    );
    base[stat] =
      activeBase +
      equipmentFlatStat(snapshot.equipmentData, stat, characterLevel) -
      equipmentFlatStat(activeSnapshot.equipmentData, stat, characterLevel) +
      coreBonusFlatStat(selectedExternal.setEffect, stat) -
      coreBonusFlatStat(activeExternal.setEffect, stat) +
      coreBonusFlatStat(selectedPet.selected, stat) -
      coreBonusFlatStat(activePet.active, stat) +
      linkFlatStat(snapshot.linkSkillData, stat, characterLevel) -
      linkFlatStat(activeSnapshot.linkSkillData, stat, characterLevel);
    current[stat] =
      Math.floor(base[stat] * (1 + percent.stat[stat] / 100)) +
      unreflectedValue;
    const extraFlat =
      number(flatStats?.[stat]) +
      number(adjustmentFlatStats?.[stat]) +
      genericAllStat +
      number(adjustment.baseAllStat) +
      (input.doping ? number(activeSkillCycle.baseFlat[stat]) : 0);
    const extraPercent =
      number(adjustmentStatPercent?.[stat]) +
      number(adjustment.allStatPercent);
    dopedPercent[stat] = percent.stat[stat] + extraPercent;
    dopedBase[stat] = base[stat] + extraFlat;
    doped[stat] =
      Math.floor(dopedBase[stat] * (1 + dopedPercent[stat] / 100)) +
      unreflectedValue +
      (includeEquippedRing ? number(combatRing.flat[stat]) : 0);
  }

  const statTerm = XENON_STATS.reduce((sum, stat) => sum + doped[stat], 0);
  if (!(statTerm > 0)) throw new Error("제논의 합스탯 환산 기준을 계산하지 못했습니다.");

  const apiAttack = stats["공격력"];
  if (!(apiAttack > 0)) throw new Error("NEXON API에서 제논의 공격력을 확인하지 못했습니다.");
  const activeRawAttack = Math.ceil(apiAttack / (1 + activePercent.attack / 100));
  const activeCombat = snapshotCombatTotals(
    activeSnapshot,
    activeHyper.entries,
    activeUnion.texts,
  );
  const selectedCombat = snapshotCombatTotals(snapshot, hyper.entries, union.texts);
  const rawAttack =
    activeRawAttack +
    selectedCombat.flatAttack -
    activeCombat.flatAttack +
    coreBonusFlatAttack(selectedExternal.setEffect) -
    coreBonusFlatAttack(activeExternal.setEffect) +
    coreBonusFlatAttack(selectedPet.selected) -
    coreBonusFlatAttack(activePet.active);

  const conditionalDamage = Math.max(
    0,
    number(stats["상태이상 추가 데미지"]) +
      conditionalDamageFromAbility(snapshot.abilityData) -
      conditionalDamageFromAbility(activeSnapshot.abilityData),
  );
  const currentDamage =
    stats["데미지"] + selectedCombat.damage - activeCombat.damage;
  const currentBossDamage =
    stats["보스 몬스터 데미지"] +
    selectedCombat.bossDamage -
    activeCombat.bossDamage;
  const currentIgnoreDefense = Math.min(
    1,
    Math.max(0, number(stats["방어율 무시"]) / 100),
  );
  const combatEffects = [];
  if (input.doping) {
    combatEffects.push(createCombatEffect({
      layer: "general",
      source: text(object(input.doping)?.label) || "공통 보스 전투 기준",
      modifiers: {
        flatAttack: number(totals.attackMagic),
        attackPercent: number(totals.attackMagicPercent),
        damage: number(totals.damage),
        bossDamage: number(totals.bossDamage),
        criticalDamage: number(totals.criticalDamage),
        ignoreDefenseSources: Array.isArray(totals.ignoreDefenseSources)
          ? totals.ignoreDefenseSources
          : [totals.ignoreDefense],
      },
    }));
    combatEffects.push(createCombatEffect({
      layer: "general",
      source: "길드 노블레스 실제 스킬 보정",
      modifiers: {
        damage: guildDifference.damage,
        bossDamage: guildDifference.bossDamage,
        criticalDamage: guildDifference.criticalDamage,
        ignoreDefenseSources: guildNoblesse.available
          ? guildNoblesse.ignoreDefenseSources
          : [],
      },
    }));
  }
  if (Object.keys(adjustment).length > 0) {
    combatEffects.push(createCombatEffect({
      layer: "class-skill",
      source: `${text(input.character.character_class)} 전투 설정`,
      modifiers: {
        flatAttack: number(adjustment.attackMagic),
        attackPercent: number(adjustment.attackMagicPercent),
        damage: number(adjustment.damage),
        bossDamage: number(adjustment.bossDamage),
        criticalDamage: number(adjustment.criticalDamage),
        ignoreDefenseSources: Array.isArray(adjustment.ignoreDefenseSources)
          ? adjustment.ignoreDefenseSources
          : [adjustment.ignoreDefense],
      },
      metadata: { compatibilityAdjustment: true },
    }));
  }
  if (Object.keys(classAlwaysOnAdjustment).length > 0) {
    combatEffects.push(createCombatEffect({
      layer: "class-skill",
      source: classAlwaysOnCombat.sources.join(" · ") ||
        `${text(input.character.character_class)} 유지형 전투 효과`,
      modifiers: {
        flatAttack: number(classAlwaysOnAdjustment.attackMagic),
        damage: number(classAlwaysOnAdjustment.damage),
        bossDamage: number(classAlwaysOnAdjustment.bossDamage),
        criticalDamage: number(classAlwaysOnAdjustment.criticalDamage),
        ignoreDefenseSources: Array.isArray(
            classAlwaysOnAdjustment.ignoreDefenseSources
          )
          ? classAlwaysOnAdjustment.ignoreDefenseSources
          : [],
      },
      metadata: {
        defaultMode: classAlwaysOnCombat.defaultMode,
        learnedSkillSources: classAlwaysOnCombat.learnedSkillSources,
      },
    }));
  }
  if (includeEquippedRing) {
    for (const ring of combatRing.applied) {
      combatEffects.push(createCombatEffect({
        layer: "general",
        source: ring.name,
        kind: "special-ring",
        uptime: ring.uptime,
        activation: {
          mode: ring.activationMode,
          evidence: ring.phaseProfileId
            ? "battle-practice-ring-timeline"
            : "equipped-special-ring",
        },
        modifiers: {
          attackPercent: ring.attackPercent,
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
  if (input.doping) {
    for (const event of activeSkillCycle.applied) {
      combatEffects.push(createCombatEffect({
        layer: event.layer,
        source: event.name,
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
        },
      }));
    }
    combatEffects.push(createCombatEffect({
      layer: "general",
      source: "조건부 링크 스킬",
      kind: "conditional-link",
      modifiers: {
        damage: conditionalLinks.damage,
        bossDamage: conditionalLinks.bossDamage,
        ignoreDefenseSources: conditionalLinks.ignoreDefenseSources,
      },
      metadata: { sources: conditionalLinks.applied.map(({ name }) => name) },
    }));
    combatEffects.push(...targetDefenseEffectsFromSkills(snapshot.skillData));
  }
  combatEffects.push(createCombatEffect({
    layer: "general",
    source: "상태 이상 대상 공격",
    kind: "conditional-stat",
    modifiers: { damage: conditionalDamage },
  }));
  for (const source of activeSkillCycle.baselineReflected ?? []) {
    combatEffects.push(createCombatEffect({
      layer: "baseline",
      source,
      includedInBaseline: true,
      metadata: { reason: "permanent-skill-in-final-stat" },
    }));
  }
  const combatModel = composeCombatModel({
    baseline: {
      flatAttack: rawAttack,
      attackPercent: percent.attack,
      damage: currentDamage,
      bossDamage: currentBossDamage,
      criticalRate: stats["크리티컬 확률"],
      criticalDamage: stats["크리티컬 데미지"],
      ignoreDefense: currentIgnoreDefense,
    },
    baselineSources: [
      { key: "character", label: "캐릭터 기본 스탯", included: true },
      { key: "equipment", label: "장착 장비·세트 효과", included: true },
      { key: "ability", label: "어빌리티", included: true },
      { key: "link", label: "링크 스킬", included: true },
      { key: "union", label: "유니온", included: true },
      { key: "artifact", label: "유니온 아티팩트", included: true },
      { key: "champion", label: "유니온 챔피언", included: true },
      { key: "hyper", label: "하이퍼 스탯", included: true },
    ],
    effects: combatEffects,
    damageChannels: resolveClassDamageChannels({
      characterClass: text(input.character.character_class),
      skillData: snapshot.skillData,
      vMatrixData: snapshot.vMatrixData,
    }),
  });
  const attackPercent = combatModel.totals.attackPercent;
  const dopedAttack = combatModel.totals.flatAttack *
    (1 + attackPercent / 100);
  if (!(dopedAttack > 0)) throw new Error("제논의 보스 도핑 공격력을 계산하지 못했습니다.");
  const damageTotal =
    100 + combatModel.totals.damage + combatModel.totals.bossDamage;
  if (!(damageTotal > 0)) throw new Error("제논의 데미지 환산 기준을 계산하지 못했습니다.");

  const dopedCriticalDamage = combatModel.totals.criticalDamage;
  const dopedIgnoreDefense = combatModel.totals.ignoreDefense;
  const classDamageProfile = combatModel.damageChannels
    .map((channel) => object(channel.metadata)?.profileId)
    .find((profileId) => typeof profileId === "string" && profileId) ?? null;

  const flatStatToDamagePercent = emptyFlatConversion();
  for (const stat of XENON_STATS) {
    // 4 * 0.875 is common to both sides of the relative comparison and cancels.
    flatStatToDamagePercent[stat] =
      ((1 + dopedPercent[stat] / 100) / statTerm) * damageTotal;
  }
  const allStatPercentToDamagePercent =
    (XENON_STATS.reduce((sum, stat) => sum + dopedBase[stat], 0) /
      100 /
      statTerm) *
    damageTotal;
  const flatAttackToDamagePercent =
    ((1 + attackPercent / 100) / dopedAttack) * damageTotal;
  const targetToDamagePercent =
    XENON_STATS.reduce(
      (sum, stat) => sum + flatStatToDamagePercent[stat],
      0,
    ) / XENON_STATS.length;

  for (const [label, value] of Object.entries({
    ...flatStatToDamagePercent,
    flatAttackToDamagePercent,
    allStatPercentToDamagePercent,
    targetToDamagePercent,
  })) {
    ensureFiniteNonnegative(value, label);
  }
  if (!(targetToDamagePercent > 0)) {
    throw new Error("제논의 합스탯 1급 환산 기준을 계산하지 못했습니다.");
  }

  return {
    flatStatToDamagePercent,
    flatAttackToDamagePercent,
    allStatPercentToDamagePercent,
    bossDamageToDamagePercent: 1,
    targetToDamagePercent,
    details: {
      statModel: "xenon",
      mode: "character-dynamic",
      targetUnit: "STR·DEX·LUK 평균 1",
      formula: "4×0.875×(STR+DEX+LUK); common constants cancelled",
      base,
      current,
      dopedBase,
      doped,
      statPercent: dopedPercent,
      unreflected,
      statTerm,
      activeAttack: apiAttack,
      activeAttackPercent: activePercent.attack,
      selectedAttackPercent: percent.attack,
      rawAttack,
      dopedAttack,
      dopedAttackPercent: attackPercent,
      damageTotal,
      dopedCriticalDamage,
      dopedIgnoreDefense,
      targetDefenseRemaining: combatModel.targetDefenseRemaining,
      combatModel,
      classDamageProfile,
      combatRings: includeEquippedRing ? combatRing.applied : [],
      activeSkillCycles: input.doping ? activeSkillCycle.applied : [],
      conditionalLinkSources: input.doping ? conditionalLinks.applied : [],
      guildNoblesseSkills: guildNoblesse.available
        ? guildNoblesse.skills
        : [],
      guildNoblesseAdjustment: guildDifference,
      activeHyperStatPreset: activeHyper.preset,
      activeUnionPreset: activeUnion.preset,
      selectedHyperStatPreset: hyper.preset,
      selectedUnionPreset: union.preset,
      externalComponents: {
        selectedPetPreset: selectedPet.selectedPreset ?? null,
        activePetPreset: activePet.activePreset ?? null,
        selectedPetFlatAttack: coreBonusFlatAttack(selectedPet.selected),
        activePetFlatAttack: coreBonusFlatAttack(activePet.active),
      },
      presetSelection: input.presetSelection ?? null,
      presetPolicy: "active snapshot plus selected preset deltas and explicit doping",
      xenonHexaRatio: XENON_HEXA_RATIO,
    },
  };
}

function conventionalDemonAvenger(
  reason: string,
): SpecialAddOptionConversionResult {
  // Widely used fallback score: HP/35 + STR/4 + ATT*4. This is deliberately
  // marked as a score rather than pretending that the values are damage %.
  return {
    flatStatToDamagePercent: {
      STR: 1 / 4,
      DEX: 0,
      INT: 0,
      LUK: 0,
      HP: 1 / 35,
    },
    flatAttackToDamagePercent: 4,
    allStatPercentToDamagePercent: 0,
    bossDamageToDamagePercent: 1,
    targetToDamagePercent: 1,
    details: {
      statModel: "demon-avenger",
      mode: "conventional-fallback",
      targetUnit: "관행 추옵 점수 1",
      formula: "HP/35 + STR/4 + 공격력×4",
      reason,
      warning: "올스탯%는 HP를 올리지 않으므로 안전한 정적 환산에서 제외했습니다.",
    },
  };
}

function calculateDemonAvenger(): SpecialAddOptionConversionResult {
  // The Open API caps the displayed HP and does not expose the HP buckets
  // needed to apply full-boss HP% buffs. Mixing a partial dynamic coefficient
  // with a conventional flame score would produce a plausible-looking but
  // dimensionally invalid result, so DA intentionally stays on one score unit.
  return conventionalDemonAvenger(
    "Open API 한 번의 스냅샷만으로 풀도핑 HP%가 적용될 HP 원금을 분리할 수 없습니다.",
  );
}

/**
 * Builds add-option weights for classes that cannot be represented by the
 * ordinary one-main/one-sub-stat formula. Xenon uses character-specific damage
 * equivalence. Demon Avenger deliberately uses one conventional flame-score
 * unit because a single Open API snapshot cannot reconstruct full-buff HP.
 */
export function calculateSpecialAddOptionConversion(
  input: SpecialAddOptionConversionInput,
): SpecialAddOptionConversionResult {
  const snapshot = resolvedSnapshot(input);
  if (input.statModel === "xenon" || input.statModel === "제논") {
    return calculateXenon(input, snapshot);
  }
  if (
    input.statModel === "demon-avenger" ||
    input.statModel === "demonAvenger" ||
    input.statModel === "데몬어벤져"
  ) {
    return calculateDemonAvenger();
  }
  throw new RangeError(`지원하지 않는 특수 스탯 모델입니다: ${String(input.statModel)}`);
}
