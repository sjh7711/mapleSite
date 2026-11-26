declare module "maple-core/stat-profile" {
  export type SupportedStatProfile = {
    supported: true;
    model: "standard" | "xenon" | "demon-avenger";
    mainStat: string;
    mainStats?: string[];
    subStat: string | null;
    subStats?: string[];
    attackType: "attack" | "magic";
  };

  export type UnsupportedStatProfile = {
    supported: false;
    reason: string;
  };

  export const CHARACTER_CONVERSION_CACHE_VERSION: string;
  export const FULL_BOSS_DOPING: Record<string, unknown>;
  export function inferPotentialStatProfile(
    characterClass: string,
  ): SupportedStatProfile | UnsupportedStatProfile;
}

declare module "maple-core/stat-efficiency" {
  export const CHARACTER_BASELINE_SKILL_SUMMARY_VERSION: number;
  export function hexaUnreflectedMainStat(data: Record<string, unknown>, scale?: number): number;
  export function xenonHexaStatScale(hexaData: Record<string, unknown>, statData: Record<string, unknown>): number;
  export function loadedDiceOutcomes(skillData: Array<Record<string, unknown>>): Array<{
    rolls: number[];
    flatAttack: number;
    criticalRate: number;
    damage: number;
    ignoreDefense: number;
  }> | null;
  export function linkSkillBonuses(data: Record<string, unknown>): Record<string, unknown>;
  export function unionAllocatedStat(data: Record<string, unknown>, stat: string): number;
  export function unionUnreflectedStat(data: Record<string, unknown>, stat: string): number;
  export function bossCriticalEffects(
    skillData: Array<Record<string, unknown>>,
    doping: Record<string, unknown> | null,
  ): {
    sharpEyes: {
      name: string | null;
      level: number;
      criticalRate: number;
      criticalDamage: number;
      ignoreDefense: number;
      hyperRate: number;
    };
    criticalDamage: number;
    sayramRate: number;
    effects: Array<Record<string, unknown>>;
  };
  export function bossDopingTotals(
    doping: Record<string, unknown> | null,
    skillData: Array<Record<string, unknown>>,
    attackType: "attack" | "magic",
    hasSourceSum: boolean,
  ): Record<string, unknown>;
  export type CharacterStatSources = {
    computed: Record<string, number>;
    attack: Record<"공격력" | "마력", { flat: number; percent: number }>;
    attributes: Partial<Record<string, { base: number; percent: number; fixed: number }>>;
    maintainedCovenantDamage: number;
  };
  export function reconstructCharacterStats(data: {
    character: Record<string, unknown>;
    snapshot: Record<string, unknown>;
    mainStat?: string;
    activeSkillNames?: string[];
    presetMode?: PresetPolicy["mode"];
    attackType?: "attack" | "magic";
    includeMaintainedSummon?: boolean;
  }): CharacterStatSources | null;
  export function bossCombatOrderSkills(
    skillData: Array<Record<string, unknown>>,
    characterClass: string,
    abilityData: Record<string, unknown>,
    equipmentData: Record<string, unknown>,
    ordersLevels: number,
  ): Array<Record<string, unknown>>;
  export function equipmentSoulOptionLines(item: Record<string, unknown>): string[];
  export function itemStatValue(item: Record<string, unknown>, key: string): number;
  export function activeCashEquipmentItems(data: Record<string, unknown>): unknown[];
  export function characterBaselineSkillSummary(
    skillData: Array<Record<string, unknown>>,
  ): Array<{
    name: string;
    level: number;
    kind: "event" | "common-passive";
    includedInBaseline: boolean;
    effects: {
      attack: number;
      magic: number;
      allStat: number;
      damage: number;
      bossDamage: number;
      criticalRate: number;
      criticalDamage: number;
      ignoreDefenseSources: number[];
    };
  }>;
  export type StatEquivalenceByStat = Record<string, number>;

  export type StatEquivalenceResult = Record<
    string,
    number | StatEquivalenceByStat
  > & {
    currentIgnoreDefense: number;
    oneMainPercentRelative: number;
    flatMainStatToPercent: number;
    flatSubStatToFlatMainStat: number;
    attackToMainStat: number;
    allStatPercentToMainPercent: number;
    bossDamageToMainPercent: number;
    flatStatToFlatMainStatByStat: StatEquivalenceByStat;
    statPercentToMainPercentByStat: StatEquivalenceByStat;
    unreflectedStatToPercentByStat: StatEquivalenceByStat;
  };

  export type CharacterPotentialConversionResult = {
    statEquivalence: StatEquivalenceResult;
    details: Record<string, unknown>;
  };

  export type ManualPresetSelection = {
    equipment: number;
    hyper: number;
    union: number;
    link: number;
    ability: number;
  };

  export type PresetPolicy =
    | { mode: "active" | "auto"; manual?: never }
    | { mode: "manual"; manual: ManualPresetSelection };

  export type PresetSelection = {
    mode: "active" | "auto" | "manual";
    active: Record<string, number | null>;
    selected: Record<string, number | null>;
    available: Record<string, number[]>;
    source: Record<string, string>;
    approximate: boolean;
    warnings: string[];
  };

  export function resolveCharacterPresetSnapshot(
    input: Record<string, unknown>,
  ): {
    activeSnapshot: Record<string, unknown>;
    selectedSnapshot: Record<string, unknown>;
    selection: PresetSelection;
  };

  export function calculateCharacterPotentialConversion(
    input: Record<string, unknown>,
  ): CharacterPotentialConversionResult;

  export function resolveCharacterExternalBonuses(
    input?: Record<string, unknown>,
  ): {
    cash: Record<string, unknown>;
    pet: {
      active: Record<string, unknown>;
      selected: Record<string, unknown>;
      skills: Record<string, unknown>;
      activePreset: number | null;
      selectedPreset: number | null;
      available: number[];
      changed: boolean;
    };
    otherStat: Record<string, unknown>;
    setEffect: Record<string, unknown>;
  };

  export function resolveClassAlwaysOnCombatAdjustment(
    characterClass: string,
    skillData: Array<Record<string, unknown>>,
  ): {
    adjustment: Record<string, unknown>;
    defaultMode: string | null;
    sources: string[];
    learnedSkillSources: string[];
  };

  export function calculateCombatRingBonuses(
    equipmentData: Record<string, unknown>,
    ringReserveData: Record<string, unknown>,
    skillData: Array<Record<string, unknown>>,
    attackType: "attack" | "magic",
    combatDuration: number,
    characterClass?: string | null,
  ): {
    flat: Record<string, number>;
    attackPercent: number;
    magicPercent: number;
    bossDamage: number;
    applied: Array<{
      name: string;
      level: number | null;
      slot: string;
      uptime: number;
      timeUptime: number;
      damageCoverage: number | null;
      activationMode: string;
      attackPercent: number;
      magicPercent: number;
      bossDamage: number;
      duration: number;
      cooldown: number;
      preparation: number;
      phaseProfileId: string | null;
      [key: string]: unknown;
    }>;
  };

  export function calculateActiveSkillCycleBonuses(
    skillData: Array<Record<string, unknown>>,
    attackType: "attack" | "magic",
    combatDuration: number,
    options?: Record<string, unknown>,
  ): {
    baseFlat: Record<string, number>;
    flatAttack: number;
    attackPercent: number;
    damage: number;
    bossDamage: number;
    criticalRate: number;
    criticalDamage: number;
    ignoreDefenseSources: number[];
    applied: Array<Record<string, unknown>>;
  };

  export function maintainsBossSummon(
    skillData?: Array<Record<string, unknown>>,
    characterClass?: string,
  ): boolean;

  export function covenantLinkDamage(linkSkillData: Record<string, unknown>): number;

  export function wildHunterUnionEffect(
    unionRaiderData: Record<string, unknown>,
  ): ReturnType<typeof import("maple-core/combat-model").createCombatEffect> | null;

  export function calculateConditionalLinkCycleBonuses(
    linkSkillData: Record<string, unknown>,
    buffDurationPercent?: number,
    targetLevelIsLower?: boolean,
    characterClass?: string,
    maintainsSummon?: boolean,
  ): {
    damage: number;
    bossDamage: number;
    ignoreDefenseSources: number[];
    applied: Array<Record<string, unknown>>;
  };

  export function calculateBossItemCombatEffects(options: {
    symbolData?: Record<string, unknown>;
    vMatrixData?: Record<string, unknown>;
    characterClass?: string;
  }): ReturnType<typeof import("maple-core/combat-model").createCombatEffect>[];

  export function selectedBuffDurationPercent(
    basePercent: number | undefined,
    active: Record<string, unknown>,
    selected: Record<string, unknown>,
  ): number;

  export function calculateGuildNoblesseBonuses(
    guildData: Record<string, unknown>,
  ): {
    available: boolean;
    damage: number;
    bossDamage: number;
    criticalDamage: number;
    ignoreDefenseSources: number[];
    skills: string[];
  };
}

declare module "maple-core/potential" {
  export type ParsedPotentialOption = {
    statPercent: number[];
    flatStat: number[];
    perNineStat: number[];
    allStatPercent: number;
    attackPercent: number;
    magicPercent: number;
    bossDamage: number;
    cooldown: number;
    [key: string]: number | number[];
  };

  export function calculatePotentialOptionsStatEquivalent(
    input: Record<string, unknown>,
  ): number;
  export function parsePotentialOption(optionName: string): ParsedPotentialOption;
}
