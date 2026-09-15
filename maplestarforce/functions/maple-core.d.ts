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

  export const FULL_BOSS_DOPING: Record<string, unknown>;
  export function inferPotentialStatProfile(
    characterClass: string,
  ): SupportedStatProfile | UnsupportedStatProfile;
}

declare module "maple-core/stat-efficiency" {
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

  export function calculateConditionalLinkCycleBonuses(
    linkSkillData: Record<string, unknown>,
  ): {
    damage: number;
    bossDamage: number;
    ignoreDefenseSources: number[];
    applied: Array<Record<string, unknown>>;
  };

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
