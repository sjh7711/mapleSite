import {
  calculateCharacterPotentialConversion,
  resolveCharacterPresetSnapshot,
  type PresetPolicy,
  type PresetSelection,
} from "maple-core/stat-efficiency";

export type CharacterPresetPolicy = PresetPolicy;
import {
  FULL_BOSS_DOPING,
  inferPotentialStatProfile,
} from "maple-core/stat-profile";
import {
  calculatePotentialOptionsStatEquivalent,
  parsePotentialOption,
} from "maple-core/potential";
import { calculateDamageChannelIgnoreDefenseGain } from "maple-core/combat-model";

import {
  fetchCharacterPotentialData,
  type CharacterPotentialData,
  type JsonObject,
  type NexonRequestDependencies,
} from "./nexon";
import { NEXON_ATTRIBUTION } from "./http";
import {
  calculateSpecialAddOptionConversion,
  type SpecialAddOptionConversionResult,
} from "./add-option-conversion";

export type StatEquivalenceByStat = Record<string, number>;

export type StatEquivalence = Record<
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

export type AddOptionEquivalence = Omit<
  SpecialAddOptionConversionResult,
  "details"
> & {
  model?: "standard" | "xenon" | "demon-avenger";
  details?: Record<string, unknown>;
};

export type CharacterConversionProfile = {
  mainStat: string;
  subStat: string | null;
  subStats: string[];
  attackType: "attack" | "magic";
  statModel: "standard" | "xenon" | "demon-avenger";
  capabilities: {
    potentialEquivalence: boolean;
    addOptionEquivalence: true;
  };
  statEquivalence?: StatEquivalence;
  addOptionEquivalence: AddOptionEquivalence;
  details?: Record<string, unknown>;
};

export type CharacterConversionSuccess = {
  ok: true;
  character: {
    name: string;
    world: string;
    level: number;
    className: string;
    image: string | null;
  };
  profiles: {
    base: CharacterConversionProfile;
    fullBoss: CharacterConversionProfile;
  };
  presetSelection: PresetSelection;
  equipmentSummary: CharacterEquipmentSummary;
  warnings: string[];
  dataFreshness?: {
    source: "nexon" | "snapshot-cache" | "stale-cache";
    fetchedAt: string;
  };
  attribution: typeof NEXON_ATTRIBUTION;
};

export type CharacterEquipmentSummaryItem = {
  name: string;
  part: string;
  slot: string;
  icon: string | null;
  itemLevel: number | null;
  flameAdvantaged: boolean | null;
  potentialGrade: string | null;
  additionalPotentialGrade: string | null;
  potentialMainStatPercent: number | null;
  additionalMainStatPercent: number | null;
  potentialSummary: CharacterPotentialSummary | null;
  additionalPotentialSummary: CharacterPotentialSummary | null;
  addOptionScore: number | null;
  addOptionUnit: "급" | "점";
  weaponFlameTier: number | null;
  weaponBaseAttack: number | null;
  weaponAddOptionPercent: number | null;
  tooltip: CharacterEquipmentTooltip;
};

export type CharacterEquipmentTooltipOption = {
  key: string;
  label: string;
  unit: "" | "%";
  total: number | null;
  base: number | null;
  add: number | null;
  etc: number | null;
  starforce: number | null;
  exceptional: number | null;
};

export type CharacterEquipmentTooltip = {
  starforce: number | null;
  exceptionalUpgrade: number | null;
  gender: string | null;
  description: string | null;
  equipmentLevelIncrease: number | null;
  growthLevel: number | null;
  specialRingLevel: number | null;
  cuttableCount: number | null;
  options: CharacterEquipmentTooltipOption[];
  potentialLines: string[];
  additionalPotentialLines: string[];
  scroll: {
    upgraded: number | null;
    upgradeable: number | null;
    recoverable: number | null;
    goldenHammerApplied: boolean | null;
  } | null;
  soulName: string | null;
  soulOption: string | null;
};

export type CharacterPotentialSummary = {
  statEquivalentPercent: number | null;
  statEquivalentType: "main-stat" | "xenon-all-stat" | "hp";
  bossDamagePercent: number | null;
  damagePercent: number | null;
  attackMagicPercent: number | null;
  ignoreDefensePercent: number | null;
  cooldownSeconds: number | null;
  criticalDamagePercent: number | null;
};

export type CharacterEquipmentSummary = {
  version: 11;
  presetNo: number | null;
  items: CharacterEquipmentSummaryItem[];
};

export class ConversionUnavailableError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super("Character stat conversion is unavailable.");
    this.name = "ConversionUnavailableError";
    this.reason = reason;
  }
}

function requiredString(
  source: JsonObject,
  field: string,
  koreanLabel: string,
): string {
  const value = typeof source[field] === "string" ? source[field].trim() : "";
  if (!value) {
    throw new ConversionUnavailableError(
      `NEXON API에서 ${koreanLabel} 정보를 확인하지 못했습니다.`,
    );
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().normalize("NFC")
    : null;
}

function objectField(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

type CashEquipmentDisplaySummary = {
  summary: string | null;
  items: string[];
  masterLabelPlus: string | null;
};

const CASH_EQUIPMENT_STAT_ORDER = [
  "STR",
  "DEX",
  "INT",
  "LUK",
  "최대 HP",
  "최대 MP",
  "공격력",
  "마력",
  "방어력",
  "이동속도",
  "점프력",
] as const;

function cashEquipmentOptionValue(value: unknown): number {
  const parsed = Number(String(value ?? "0").replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCashEquipmentNumber(value: number): string {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2 }).format(value);
}

function summarizeCashEquipmentOptions(options: unknown[]): {
  text: string;
  totals: Record<string, number>;
} {
  const totals: Record<string, number> = {};
  for (const value of options) {
    const option = objectField(value);
    const type = optionalString(option?.option_type);
    const amount = cashEquipmentOptionValue(option?.option_value);
    if (!type || !amount) continue;
    totals[type] = (totals[type] ?? 0) + amount;
  }

  const parts: string[] = [];
  const appendCombined = (label: string, keys: string[]) => {
    const values = keys.map((key) => totals[key] ?? 0);
    if (values[0] && values.every((value) => value === values[0])) {
      parts.push(`${label} +${formatCashEquipmentNumber(values[0])}`);
      for (const key of keys) delete totals[key];
    }
  };
  appendCombined("공·마", ["공격력", "마력"]);
  appendCombined("ALL", ["STR", "DEX", "INT", "LUK"]);
  appendCombined("HP/MP", ["최대 HP", "최대 MP"]);

  for (const type of CASH_EQUIPMENT_STAT_ORDER) {
    const amount = totals[type] ?? 0;
    if (!amount) continue;
    parts.push(`${type} +${formatCashEquipmentNumber(amount)}`);
    delete totals[type];
  }
  for (const [type, amount] of Object.entries(totals)) {
    if (!amount) continue;
    parts.push(`${type} +${formatCashEquipmentNumber(amount)}`);
  }
  return { text: parts.join(" · "), totals };
}

function cashEquipmentDisplaySummary(
  cashEquipmentData: JsonObject,
): CashEquipmentDisplaySummary {
  const items = [
    ...(Array.isArray(cashEquipmentData.cash_item_equipment_base)
      ? cashEquipmentData.cash_item_equipment_base
      : []),
    ...(Array.isArray(cashEquipmentData.additional_cash_item_equipment_base)
      ? cashEquipmentData.additional_cash_item_equipment_base
      : []),
  ].map(objectField).filter((item): item is JsonObject => Boolean(item));
  const aggregateOptions = items.flatMap((item) =>
    Array.isArray(item.cash_item_option) ? item.cash_item_option : []
  );
  const aggregate = summarizeCashEquipmentOptions(aggregateOptions);
  const displayItems = items.flatMap((item) => {
    const name = optionalString(item.cash_item_name);
    const options = summarizeCashEquipmentOptions(
      Array.isArray(item.cash_item_option) ? item.cash_item_option : [],
    ).text;
    return name && options ? [`${name} · ${options}`] : [];
  });
  const masterLabelCount = items.filter(
    (item) => optionalString(item.cash_item_label) === "마스터라벨",
  ).length;
  return {
    summary: aggregate.text || null,
    items: displayItems,
    masterLabelPlus: masterLabelCount > 0
      ? `마스터라벨 전투 플러스 ${Math.min(masterLabelCount, 5)}`
      : null,
  };
}

function attachCashEquipmentDisplay(
  profile: CharacterConversionProfile,
  summary: CashEquipmentDisplaySummary,
): void {
  const details = profile.details ?? {};
  const externalComponents = objectField(details.externalComponents) ?? {};
  const cashEquipment = objectField(externalComponents.cashEquipment) ?? {};
  profile.details = {
    ...details,
    externalComponents: {
      ...externalComponents,
      cashEquipment: {
        ...cashEquipment,
        displaySummary: summary.summary,
        displayItems: summary.items,
        masterLabelPlus: summary.masterLabelPlus,
      },
    },
  };
}

function numericField(source: JsonObject | null, key: string): number {
  const value = Number(source?.[key]);
  return Number.isFinite(value) ? value : 0;
}

function optionalNumericField(source: JsonObject | null, key: string): number | null {
  if (!source || source[key] === null || source[key] === undefined || source[key] === "") {
    return null;
  }
  const value = Number(source[key]);
  return Number.isFinite(value) ? value : null;
}

function optionalNonNegativeInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function appliedFlag(value: unknown): boolean | null {
  if (value === true || value === 1 || value === "1" || value === "적용") {
    return true;
  }
  if (
    value === false || value === 0 || value === "0" || value === "미적용"
  ) {
    return false;
  }
  return null;
}

function safeHttpsUrl(value: unknown): string | null {
  const text = optionalString(value);
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function roundedMetric(value: number): number | null {
  return Number.isFinite(value)
    ? Math.round((value + Number.EPSILON) * 100) / 100
    : null;
}

function positiveMetric(value: number): number | null {
  return value > 0 ? roundedMetric(value) : null;
}

function potentialSummary(
  item: JsonObject,
  prefix: "potential_option" | "additional_potential_option",
  profile: CharacterConversionProfile,
  level: number,
): CharacterPotentialSummary | null {
  const optionNames = [1, 2, 3]
    .map((line) => optionalString(item[`${prefix}_${line}`]))
    .filter((value): value is string => Boolean(value));
  if (!optionNames.length) return null;
  const parsed = optionNames.map(parsePotentialOption);
  const sum = (
    key:
      | "bossDamage"
      | "damage"
      | "attackPercent"
      | "magicPercent"
      | "cooldown"
      | "criticalDamage",
  ) =>
    parsed.reduce((total, option) => total + Number(option[key] ?? 0), 0);
  let statEquivalentPercent: number | null = null;
  const criticalDamagePercent = sum("criticalDamage");
  if (profile.statModel === "demon-avenger") {
    statEquivalentPercent = positiveMetric(
      parsed.reduce(
        (total, option) => total + Number(option.maxHpPercent ?? 0),
        0,
      ),
    );
  } else {
    try {
      if (profile.statEquivalence && profile.capabilities.potentialEquivalence) {
        const equivalentWithCriticalDamage =
          calculatePotentialOptionsStatEquivalent({
            optionNames,
            mainStat: profile.mainStat,
            subStat: profile.subStat,
            subStats: profile.subStats,
            attackType: profile.attackType,
            characterLevel: level,
            statEquivalence: profile.statEquivalence,
          });
        const criticalDamageCoefficient = Number(
          profile.statEquivalence.criticalDamageToMainPercent,
        );
        statEquivalentPercent = roundedMetric(Math.max(
          0,
          equivalentWithCriticalDamage -
            criticalDamagePercent * criticalDamageCoefficient,
        ));
      }
    } catch {
      statEquivalentPercent = null;
    }
  }
  return {
    statEquivalentPercent,
    statEquivalentType: profile.statModel === "xenon"
      ? "xenon-all-stat"
      : profile.statModel === "demon-avenger"
        ? "hp"
        : "main-stat",
    bossDamagePercent: positiveMetric(sum("bossDamage")),
    damagePercent: positiveMetric(sum("damage")),
    attackMagicPercent: positiveMetric(
      sum(profile.attackType === "magic" ? "magicPercent" : "attackPercent"),
    ),
    ignoreDefensePercent: positiveMetric(
      (1 - parsed.reduce(
        (remaining, option) =>
          remaining * (1 - Number(option.ignoreDefense ?? 0) / 100),
        1,
      )) * 100,
    ),
    cooldownSeconds: positiveMetric(sum("cooldown")),
    criticalDamagePercent: positiveMetric(criticalDamagePercent),
  };
}

function addOptionMetric(
  item: JsonObject,
  profile: CharacterConversionProfile,
): {
  score: number | null;
  unit: "급" | "점";
  nonAttackDamagePercent: number | null;
} {
  const equivalence = profile.addOptionEquivalence;
  const option = objectField(item.item_add_option);
  const unit = String(equivalence.details?.mode ?? "").startsWith("conventional")
    ? "점"
    : "급";
  const targetUnit = Number(equivalence.targetToDamagePercent);
  if (!option || !(targetUnit > 0)) {
    return { score: null, unit, nonAttackDamagePercent: null };
  }
  const statFields = {
    STR: "str",
    DEX: "dex",
    INT: "int",
    LUK: "luk",
    HP: "max_hp",
  } as const;
  let nonAttackEquivalent = 0;
  for (const stat of Object.keys(statFields) as Array<keyof typeof statFields>) {
    nonAttackEquivalent += numericField(option, statFields[stat]) *
      Number(equivalence.flatStatToDamagePercent?.[stat] ?? 0);
  }
  const attackKey = profile.attackType === "magic" ? "magic_power" : "attack_power";
  const attackEquivalent = numericField(option, attackKey) *
    Number(equivalence.flatAttackToDamagePercent ?? 0);
  nonAttackEquivalent += numericField(option, "all_stat") *
    Number(equivalence.allStatPercentToDamagePercent ?? 0);
  nonAttackEquivalent += (
    numericField(option, "boss_damage") + numericField(option, "damage")
  ) * Number(equivalence.bossDamageToDamagePercent ?? 1);
  return {
    score: roundedMetric((nonAttackEquivalent + attackEquivalent) / targetUnit),
    unit,
    nonAttackDamagePercent: roundedMetric(nonAttackEquivalent),
  };
}

const NORMAL_WEAPON_ATTACK_MULTIPLIERS = [
  0,
  1,
  2.2,
  3.63,
  5.324,
  7.3205,
] as const;
const BOSS_WEAPON_ATTACK_MULTIPLIERS = [
  0,
  0,
  0,
  3,
  4.4,
  6.05,
  7.986,
  10.2487,
] as const;

function isWeaponEquipment(item: JsonObject): boolean {
  return [item.item_equipment_part, item.item_equipment_slot]
    .map((value) => optionalString(value)?.replace(/\s+/gu, ""))
    .includes("무기");
}

function weaponAttackValue(
  item: JsonObject,
  field: "item_base_option" | "item_add_option",
  attackType: "attack" | "magic",
): number {
  const option = objectField(item[field]);
  const key = attackType === "magic" ? "magic_power" : "attack_power";
  return numericField(option, key);
}

/**
 * 무기 공·마 추옵은 기본 공·마에 장비 레벨 구간 계수와 단계 계수를 곱한 뒤
 * 올림한 값이다. 일반 무기(1~5단계)와 보스 추가옵션 무기(3~7단계)를 모두
 * 대조하고 한 가지 추 등급으로 확정될 때만 화면에 표시한다.
 */
type WeaponFlameInfo = { tier: number; boss: boolean; baseAttack: number };

function weaponFlameInfo(
  item: JsonObject,
  attackType: "attack" | "magic",
): WeaponFlameInfo | null {
  if (!isWeaponEquipment(item)) return null;
  const base = weaponAttackValue(item, "item_base_option", attackType);
  const added = weaponAttackValue(item, "item_add_option", attackType);
  const level = numericField(objectField(item.item_base_option), "base_equipment_level");
  if (!(base > 0) || !(added > 0) || !(level >= 0)) return null;
  const levelMultiplier = Math.floor(level / 40) + 1;
  const matchesFound = new Map<string, WeaponFlameInfo>();
  const matches = (multiplier: number) =>
    Math.ceil(base * levelMultiplier * multiplier / 100 - 1e-9) === added;

  for (let stage = 1; stage <= 5; stage += 1) {
    if (matches(NORMAL_WEAPON_ATTACK_MULTIPLIERS[stage])) {
      const value = { tier: 6 - stage, boss: false, baseAttack: base };
      matchesFound.set(`${value.tier}:normal`, value);
    }
  }
  for (let stage = 3; stage <= 7; stage += 1) {
    if (matches(BOSS_WEAPON_ATTACK_MULTIPLIERS[stage])) {
      const value = { tier: 8 - stage, boss: true, baseAttack: base };
      matchesFound.set(`${value.tier}:boss`, value);
    }
  }
  return matchesFound.size === 1 ? [...matchesFound.values()][0] : null;
}

const BOSS_FLAME_NAME_PATTERN =
  /^(?:에테르넬|아케인셰이드|앱솔랩스|하이네스|이글아이|트릭스터|파프니르)|(?:몽환의 벨트|커맨더 포스 이어링|거대한 공포|컴플리트 언더컨트롤|루즈 컨트롤 머신 마크|마력이 깃든 안대|고통의 근원|저주받은 [적청녹황]의 마도서|핑크빛 성배|도미네이터 펜던트|블랙빈 마크|파풀라투스 마크|데이브레이크 펜던트|트와일라이트 마크|에스텔라 이어링|가디언 엔젤 링|골든 클로버 벨트|데아 시두스 이어링|카오스 혼테일의 목걸이|매커네이터 펜던트|죽음의 맹세|굶주리는 핏빛 원혼|근원의 속삭임|황홀한 악몽|불멸의 유산|오만의 원죄)/u;
const NORMAL_FLAME_NAME_PATTERN = /^(?:마이스터|샤이니 레드)/u;

function inferredFlameAdvantage(
  item: JsonObject,
  weapon: WeaponFlameInfo | null,
): boolean | null {
  if (weapon) return weapon.boss;
  const name = optionalString(item.item_name) ?? "";
  if (BOSS_FLAME_NAME_PATTERN.test(name)) return true;
  if (NORMAL_FLAME_NAME_PATTERN.test(name)) return false;
  return null;
}

const EQUIPMENT_TOOLTIP_OPTIONS = Object.freeze([
  ["str", "STR", ""],
  ["dex", "DEX", ""],
  ["int", "INT", ""],
  ["luk", "LUK", ""],
  ["all_stat", "올스탯", "%"],
  ["max_hp", "최대 HP", ""],
  ["max_hp_rate", "최대 HP", "%"],
  ["max_mp", "최대 MP", ""],
  ["max_mp_rate", "최대 MP", "%"],
  ["attack_power", "공격력", ""],
  ["magic_power", "마력", ""],
  ["damage", "데미지", "%"],
  ["armor", "방어력", ""],
  ["speed", "이동속도", ""],
  ["jump", "점프력", ""],
  ["boss_damage", "보스 몬스터 공격 시 데미지", "%"],
  ["ignore_monster_armor", "몬스터 방어율 무시", "%"],
  ["equipment_level_decrease", "착용 레벨 감소", ""],
] as const);

function equipmentTooltipOptions(item: JsonObject): CharacterEquipmentTooltipOption[] {
  const sources = {
    total: objectField(item.item_total_option),
    base: objectField(item.item_base_option),
    add: objectField(item.item_add_option),
    etc: objectField(item.item_etc_option),
    starforce: objectField(item.item_starforce_option),
    exceptional: objectField(item.item_exceptional_option),
  } as const;
  return EQUIPMENT_TOOLTIP_OPTIONS.flatMap(([key, label, unit]) => {
    const values = {
      total: optionalNumericField(sources.total, key),
      base: optionalNumericField(sources.base, key),
      add: optionalNumericField(sources.add, key),
      etc: optionalNumericField(sources.etc, key),
      starforce: optionalNumericField(sources.starforce, key),
      exceptional: optionalNumericField(sources.exceptional, key),
    };
    if (!Object.values(values).some((value) => value !== null && value !== 0)) {
      return [];
    }
    return [{ key, label, unit, ...values }];
  });
}

function equipmentTooltip(item: JsonObject): CharacterEquipmentTooltip {
  const exceptionalOption = objectField(item.item_exceptional_option);
  const potentialLines = [1, 2, 3]
    .map((line) => optionalString(item[`potential_option_${line}`]))
    .filter((value): value is string => Boolean(value));
  const additionalPotentialLines = [1, 2, 3]
    .map((line) => optionalString(item[`additional_potential_option_${line}`]))
    .filter((value): value is string => Boolean(value));
  const upgraded = optionalNonNegativeInteger(item.scroll_upgrade);
  const upgradeable = optionalNonNegativeInteger(item.scroll_upgradeable_count);
  const recoverable = optionalNonNegativeInteger(item.scroll_resilience_count);
  const goldenHammerApplied = appliedFlag(item.golden_hammer_flag);
  const hasScroll = [upgraded, upgradeable, recoverable]
    .some((value) => typeof value === "number" && value > 0) ||
    goldenHammerApplied === true;
  return {
    starforce: optionalNonNegativeInteger(item.starforce),
    exceptionalUpgrade:
      optionalNonNegativeInteger(exceptionalOption?.exceptional_upgrade) ??
      optionalNonNegativeInteger(item.exceptional_upgrade),
    gender: optionalString(item.item_gender),
    description: optionalString(item.item_description),
    equipmentLevelIncrease: optionalNonNegativeInteger(
      item.equipment_level_increase,
    ),
    growthLevel: optionalNonNegativeInteger(item.growth_level),
    specialRingLevel: optionalNonNegativeInteger(item.special_ring_level),
    cuttableCount: optionalNonNegativeInteger(item.cuttable_count),
    options: equipmentTooltipOptions(item),
    potentialLines,
    additionalPotentialLines,
    scroll: hasScroll
      ? { upgraded, upgradeable, recoverable, goldenHammerApplied }
      : null,
    soulName: optionalString(item.soul_name),
    soulOption: optionalString(item.soul_option),
  };
}

export function buildCharacterEquipmentSummary(
  equipmentData: unknown,
  profile: CharacterConversionProfile,
  level: number,
  presetNo: number | null,
): CharacterEquipmentSummary {
  const data = objectField(equipmentData);
  const equipment = Array.isArray(data?.item_equipment)
    ? data.item_equipment
    : [];
  const items = equipment.flatMap((raw): CharacterEquipmentSummaryItem[] => {
    const item = objectField(raw);
    const name = optionalString(item?.item_name);
    const part = optionalString(item?.item_equipment_part);
    const slot = optionalString(item?.item_equipment_slot);
    if (!item || !name || !part || !slot) return [];
    const addOption = addOptionMetric(item, profile);
    const potential = potentialSummary(item, "potential_option", profile, level);
    const additionalPotential = potentialSummary(
      item,
      "additional_potential_option",
      profile,
      level,
    );
    const weapon = weaponFlameInfo(item, profile.attackType);
    const baseOption = objectField(item.item_base_option);
    const rawItemLevel = Number(baseOption?.base_equipment_level);
    const itemLevel = Number.isInteger(rawItemLevel) && rawItemLevel >= 0
      ? rawItemLevel
      : null;
    return [{
      name,
      part,
      slot,
      icon: safeHttpsUrl(item.item_icon),
      itemLevel,
      flameAdvantaged: inferredFlameAdvantage(item, weapon),
      potentialGrade: optionalString(item.potential_option_grade),
      additionalPotentialGrade: optionalString(
        item.additional_potential_option_grade,
      ),
      potentialMainStatPercent: potential?.statEquivalentPercent ?? null,
      additionalMainStatPercent:
        additionalPotential?.statEquivalentPercent ?? null,
      potentialSummary: potential,
      additionalPotentialSummary: additionalPotential,
      addOptionScore: addOption.score,
      addOptionUnit: addOption.unit,
      weaponFlameTier: weapon?.tier ?? null,
      weaponBaseAttack: weapon?.baseAttack ?? null,
      weaponAddOptionPercent: isWeaponEquipment(item)
        ? addOption.nonAttackDamagePercent
        : null,
      tooltip: equipmentTooltip(item),
    }];
  });
  return { version: 11, presetNo, items: items.slice(0, 32) };
}

function characterLevel(character: JsonObject): number {
  const level = Number(character.character_level);
  if (!Number.isInteger(level) || level < 1) {
    throw new ConversionUnavailableError(
      "NEXON API에서 캐릭터 레벨을 확인하지 못했습니다.",
    );
  }
  return level;
}

function assertFiniteNumericTree(value: unknown, path: string): void {
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConversionUnavailableError(
      `스탯 환산 결과(${path})가 올바르지 않습니다.`,
    );
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    throw new ConversionUnavailableError(
      `스탯 환산 결과(${path})가 비어 있습니다.`,
    );
  }
  for (const [key, item] of entries) {
    assertFiniteNumericTree(item, `${path}.${key}`);
  }
}

function assertNonNegativeStatMap(
  value: unknown,
  field: string,
): asserts value is StatEquivalenceByStat {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConversionUnavailableError(
      `스탯 환산 결과(${field})가 올바르지 않습니다.`,
    );
  }
  for (const [stat, item] of Object.entries(value)) {
    if (typeof item !== "number" || !Number.isFinite(item) || item < 0) {
      throw new ConversionUnavailableError(
        `스탯 환산 결과(${field}.${stat})가 올바르지 않습니다.`,
      );
    }
  }
}

function assertStatEquivalence(value: unknown): asserts value is StatEquivalence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConversionUnavailableError("스탯 환산 결과가 올바르지 않습니다.");
  }
  for (const [key, item] of Object.entries(value)) {
    assertFiniteNumericTree(item, key);
  }
  const statEquivalence = value as Partial<StatEquivalence>;
  if (
    typeof statEquivalence.currentIgnoreDefense !== "number" ||
    statEquivalence.currentIgnoreDefense < 0 ||
    statEquivalence.currentIgnoreDefense > 1 ||
    typeof statEquivalence.oneMainPercentRelative !== "number" ||
    statEquivalence.oneMainPercentRelative <= 0
  ) {
    throw new ConversionUnavailableError(
      "방어율 무시 환산 기준을 계산하지 못했습니다.",
    );
  }
  for (const field of [
    "flatStatToFlatMainStatByStat",
    "statPercentToMainPercentByStat",
    "unreflectedStatToPercentByStat",
  ] as const) {
    assertNonNegativeStatMap(statEquivalence[field], field);
  }
}

function standardAddOptionEquivalence(
  statEquivalence: StatEquivalence,
  mainStat: string,
  subStats: string[],
): AddOptionEquivalence {
  const damageToMain = statEquivalence.bossDamageToMainPercent;
  const flatMain = statEquivalence.flatMainStatToPercent;
  const flatStatToDamagePercent: Record<string, number> = {
    STR: 0,
    DEX: 0,
    INT: 0,
    LUK: 0,
    HP: 0,
  };
  for (const stat of Object.keys(flatStatToDamagePercent)) {
    const mappedRatio = statEquivalence.flatStatToFlatMainStatByStat[stat];
    const legacyRatio =
      stat === mainStat
        ? 1
        : subStats.includes(stat)
          ? Number(statEquivalence.flatSubStatToFlatMainStat)
          : 0;
    const ratio = Number.isFinite(mappedRatio) ? mappedRatio : legacyRatio;
    if (ratio > 0) {
      flatStatToDamagePercent[stat] = (flatMain * ratio) / damageToMain;
    }
  }
  return {
    model: "standard",
    flatStatToDamagePercent,
    flatAttackToDamagePercent:
      (flatMain * statEquivalence.attackToMainStat) / damageToMain,
    allStatPercentToDamagePercent:
      statEquivalence.allStatPercentToMainPercent / damageToMain,
    bossDamageToDamagePercent: 1,
    targetToDamagePercent: flatMain / damageToMain,
  };
}

/** 제논 잠재를 STR 1%와 같은 효율의 `%급`으로 환산한다. */
export function xenonPotentialStatEquivalence(
  addOption: SpecialAddOptionConversionResult,
): StatEquivalence {
  const details = objectField(addOption.details);
  const dopedBase = objectField(details?.dopedBase);
  const damageTotal = Number(details?.damageTotal);
  const attackPercent = Number(details?.dopedAttackPercent);
  const criticalDamage = Number(details?.dopedCriticalDamage);
  const currentIgnoreDefense = Number(details?.dopedIgnoreDefense);
  const targetDefenseRemaining = Number(
    details?.targetDefenseRemaining ?? 1,
  );
  const combatModel = objectField(details?.combatModel);
  const damageChannels = Array.isArray(combatModel?.damageChannels)
    ? combatModel.damageChannels
    : [];
  const allStatUnit = Number(addOption.allStatPercentToDamagePercent);
  const flatAttackUnit = Number(addOption.flatAttackToDamagePercent);
  const baseSum = ["STR", "DEX", "LUK"].reduce(
    (sum, stat) => sum + numericField(dopedBase, stat),
    0,
  );
  // 제논 환산표의 기준 1%는 올스탯%가 아니라 STR% 1이다. 올스탯%를
  // 기준으로 잡으면 모든 항목이 약 1/3로 축소되고 올스탯% 9%도 9%급으로
  // 고정되는 문제가 생긴다.
  const strBase = numericField(dopedBase, "STR");
  const strPercentUnit = allStatUnit * strBase / baseSum;
  if (
    !(allStatUnit > 0) || !(strPercentUnit > 0) ||
    !(damageTotal > 0) || !(baseSum > 0) || !(strBase > 0) ||
    !(attackPercent >= 0) || !(criticalDamage >= 0) ||
    !(currentIgnoreDefense >= 0 && currentIgnoreDefense <= 1) ||
    !(targetDefenseRemaining >= 0 && targetDefenseRemaining <= 1)
  ) {
    throw new ConversionUnavailableError(
      "제논의 잠재능력 환산 기준을 계산하지 못했습니다.",
    );
  }
  const statPercentToMainPercentByStat = Object.fromEntries(
    ["STR", "DEX", "LUK", "INT"].map((stat) => [
      stat,
      stat === "INT" ? 0 : numericField(dopedBase, stat) / strBase,
    ]),
  );
  const flatStatToMainPercentByStat = Object.fromEntries(
    ["STR", "DEX", "LUK", "INT"].map((stat) => [
      stat,
      Number(addOption.flatStatToDamagePercent[stat] ?? 0) / strPercentUnit,
    ]),
  );
  const unreflectedStatToPercentByStat = Object.fromEntries(
    ["STR", "DEX", "LUK", "INT"].map((stat) => [
      stat,
      stat === "INT" ? 0 : 100 / strBase,
    ]),
  );
  const flatStr = Number(addOption.flatStatToDamagePercent.STR);
  const flatMainStatToPercent = flatStatToMainPercentByStat.STR;
  const flatStatToFlatMainStatByStat = Object.fromEntries(
    ["STR", "DEX", "LUK", "INT"].map((stat) => [
      stat,
      flatStr > 0
        ? Number(addOption.flatStatToDamagePercent[stat] ?? 0) / flatStr
        : 0,
    ]),
  );
  const oneMainPercentRelative = strPercentUnit / damageTotal;
  const ignoreDefenseEquivalent = (enemyDefense: number): number => {
    return calculateDamageChannelIgnoreDefenseGain({
      currentIgnoreDefense,
      addedIgnoreDefense: 0.4,
      enemyDefense: enemyDefense * targetDefenseRemaining,
      channels: damageChannels,
    }) / oneMainPercentRelative;
  };
  return {
    flatMainStatToPercent,
    flatSubStatToFlatMainStat: flatStatToFlatMainStatByStat.DEX,
    flatStatToFlatMainStatByStat,
    flatStatToMainPercentByStat,
    attackToMainStat: flatStr > 0 ? flatAttackUnit / flatStr : 0,
    flatAttackToMainPercent: flatAttackUnit / strPercentUnit,
    allStatPercentToMainPercent: allStatUnit / strPercentUnit,
    subStatPercentToMainPercent: statPercentToMainPercentByStat.DEX,
    statPercentToMainPercentByStat,
    criticalDamageToMainPercent:
      (damageTotal / (135 + criticalDamage)) / strPercentUnit,
    attackPercentToMainPercent:
      (damageTotal / (100 + attackPercent)) / strPercentUnit,
    bossDamageToMainPercent: 1 / strPercentUnit,
    unreflectedMainStatToPercent: unreflectedStatToPercentByStat.STR,
    unreflectedSubStatToPercent: unreflectedStatToPercentByStat.DEX,
    unreflectedStatToPercentByStat,
    currentIgnoreDefense,
    targetDefenseRemaining,
    oneMainPercentRelative,
    ied40Against300ToMainPercent: ignoreDefenseEquivalent(3),
    ied40Against380ToMainPercent: ignoreDefenseEquivalent(3.8),
  };
}

function assertAddOptionEquivalence(
  value: unknown,
): asserts value is AddOptionEquivalence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConversionUnavailableError("추가옵션 환산 결과가 올바르지 않습니다.");
  }
  const candidate = value as Partial<AddOptionEquivalence>;
  const stats = candidate.flatStatToDamagePercent;
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) {
    throw new ConversionUnavailableError("추가옵션 스탯 환산 결과가 올바르지 않습니다.");
  }
  for (const stat of ["STR", "DEX", "INT", "LUK", "HP"] as const) {
    const item = Number(stats[stat]);
    if (!Number.isFinite(item) || item < 0) {
      throw new ConversionUnavailableError(`${stat} 추옵 환산 결과가 올바르지 않습니다.`);
    }
  }
  for (const item of [
    candidate.flatAttackToDamagePercent,
    candidate.allStatPercentToDamagePercent,
  ]) {
    if (!Number.isFinite(item) || Number(item) < 0) {
      throw new ConversionUnavailableError("추가옵션 환산 결과가 올바르지 않습니다.");
    }
  }
  if (
    !Number.isFinite(candidate.bossDamageToDamagePercent) ||
    Number(candidate.bossDamageToDamagePercent) <= 0 ||
    !Number.isFinite(candidate.targetToDamagePercent) ||
    Number(candidate.targetToDamagePercent) <= 0
  ) {
    throw new ConversionUnavailableError("추가옵션 목표 환산 결과가 올바르지 않습니다.");
  }
}

export async function buildCharacterConversion(
  characterName: string,
  apiKey: string,
  dependencies: NexonRequestDependencies = {},
  presetPolicy: PresetPolicy = { mode: "auto" },
): Promise<CharacterConversionSuccess> {
  const data = await fetchCharacterPotentialData(
    characterName,
    apiKey,
    dependencies,
  );
  return buildCharacterConversionFromData(data, presetPolicy);
}

/**
 * 이미 조회한 공개 NEXON 스냅샷을 프리셋 정책만 바꿔 다시 계산합니다.
 * 원본 조회와 환산을 분리해 auto/active/manual 전환 시 같은 30~32개
 * upstream 응답을 반복해서 받을 필요가 없도록 합니다.
 */
export function buildCharacterConversionFromData(
  data: CharacterPotentialData,
  presetPolicy: PresetPolicy = { mode: "auto" },
): CharacterConversionSuccess {
  const { character, snapshot } = data;
  const className = requiredString(character, "character_class", "직업");
  const inferredProfile = inferPotentialStatProfile(className);
  if (!inferredProfile.supported) {
    throw new ConversionUnavailableError(inferredProfile.reason);
  }

  const subStats = [
    ...new Set(
      (Array.isArray(inferredProfile.subStats)
        ? inferredProfile.subStats
        : inferredProfile.subStat
          ? [inferredProfile.subStat]
          : []
      )
        .map((stat) => String(stat).trim())
        .filter(Boolean),
    ),
  ];
  const calculationInput = {
    character,
    ...snapshot,
    mainStat: inferredProfile.mainStat,
    subStat: inferredProfile.subStat,
    subStats,
    attackType: inferredProfile.attackType,
  };
  let resolvedPresets: ReturnType<typeof resolveCharacterPresetSnapshot>;
  try {
    resolvedPresets = resolveCharacterPresetSnapshot({
      ...snapshot,
      mainStat: inferredProfile.mainStat,
      subStats,
      attackType: inferredProfile.attackType,
      characterLevel: characterLevel(character),
      characterClass: className,
      presetPolicy,
    });
  } catch (error) {
    throw new ConversionUnavailableError(
      error instanceof Error
        ? error.message
        : "요청한 프리셋을 적용하지 못했습니다.",
    );
  }
  const activePresetSnapshot = {
    ...snapshot,
    ...resolvedPresets.activeSnapshot,
  };
  const selectedPresetSnapshot = {
    ...snapshot,
    ...resolvedPresets.selectedSnapshot,
  };
  const basePresetSelection: PresetSelection = {
    ...resolvedPresets.selection,
    mode: "active",
    selected: resolvedPresets.selection.active,
    source: Object.fromEntries(
      Object.keys(resolvedPresets.selection.active).map((component) => [
        component,
        "api-active",
      ]),
    ),
    approximate: false,
    warnings: [],
  };
  const baseResolvedPresets = {
    activeSnapshot: resolvedPresets.activeSnapshot,
    selectedSnapshot: resolvedPresets.activeSnapshot,
    selection: basePresetSelection,
  };
  const model = inferredProfile.model ?? "standard";
  let profiles: CharacterConversionSuccess["profiles"];
  if (model === "standard") {
    let baseResult: ReturnType<typeof calculateCharacterPotentialConversion>;
    let fullBossResult: ReturnType<typeof calculateCharacterPotentialConversion>;
    try {
      baseResult = calculateCharacterPotentialConversion({
        ...calculationInput,
        doping: null,
        presetPolicy: { mode: "active" },
        resolvedPresetSnapshot: baseResolvedPresets,
      });
      fullBossResult = calculateCharacterPotentialConversion({
        ...calculationInput,
        doping: FULL_BOSS_DOPING,
        presetPolicy,
        resolvedPresetSnapshot: resolvedPresets,
      });
    } catch {
      throw new ConversionUnavailableError(
        "캐릭터의 공개 스탯으로 환산값을 계산하지 못했습니다.",
      );
    }
    assertStatEquivalence(baseResult.statEquivalence);
    assertStatEquivalence(fullBossResult.statEquivalence);
    const sharedProfile = {
      mainStat: inferredProfile.mainStat,
      subStat: inferredProfile.subStat,
      subStats,
      attackType: inferredProfile.attackType,
      statModel: "standard" as const,
      capabilities: {
        potentialEquivalence: true,
        addOptionEquivalence: true as const,
      },
    };
    profiles = {
      base: {
        ...sharedProfile,
        statEquivalence: baseResult.statEquivalence,
        addOptionEquivalence: standardAddOptionEquivalence(
          baseResult.statEquivalence,
          inferredProfile.mainStat,
          subStats,
        ),
        details: baseResult.details,
      },
      fullBoss: {
        ...sharedProfile,
        statEquivalence: fullBossResult.statEquivalence,
        addOptionEquivalence: standardAddOptionEquivalence(
          fullBossResult.statEquivalence,
          inferredProfile.mainStat,
          subStats,
        ),
        details: fullBossResult.details,
      },
    };
  } else {
    let baseAddOption: SpecialAddOptionConversionResult;
    let fullBossAddOption: SpecialAddOptionConversionResult;
    try {
      baseAddOption = calculateSpecialAddOptionConversion({
        character,
        snapshot: activePresetSnapshot,
        activeSnapshot: activePresetSnapshot,
        presetSelection: basePresetSelection,
        statModel: model,
        doping: null,
      });
      fullBossAddOption = calculateSpecialAddOptionConversion({
        character,
        snapshot: selectedPresetSnapshot,
        activeSnapshot: activePresetSnapshot,
        presetSelection: resolvedPresets.selection,
        statModel: model,
        doping: FULL_BOSS_DOPING,
      });
    } catch {
      throw new ConversionUnavailableError(
        `${className}의 공개 스탯으로 추가옵션 환산값을 계산하지 못했습니다.`,
      );
    }
    assertAddOptionEquivalence(baseAddOption);
    assertAddOptionEquivalence(fullBossAddOption);
    const xenon = model === "xenon";
    const basePotentialEquivalence = xenon
      ? xenonPotentialStatEquivalence(baseAddOption)
      : undefined;
    const fullBossPotentialEquivalence = xenon
      ? xenonPotentialStatEquivalence(fullBossAddOption)
      : undefined;
    const sharedProfile = {
      mainStat: inferredProfile.mainStat,
      subStat: inferredProfile.subStat,
      subStats,
      attackType: inferredProfile.attackType,
      statModel: model,
      capabilities: {
        potentialEquivalence: xenon,
        addOptionEquivalence: true as const,
      },
    };
    profiles = {
      base: {
        ...sharedProfile,
        ...(basePotentialEquivalence
          ? { statEquivalence: basePotentialEquivalence }
          : {}),
        addOptionEquivalence: { ...baseAddOption, model },
        details: baseAddOption.details,
      },
      fullBoss: {
        ...sharedProfile,
        ...(fullBossPotentialEquivalence
          ? { statEquivalence: fullBossPotentialEquivalence }
          : {}),
        addOptionEquivalence: { ...fullBossAddOption, model },
        details: fullBossAddOption.details,
      },
    };
  }

  const cashEquipmentSummary = cashEquipmentDisplaySummary(
    snapshot.cashEquipmentData,
  );
  attachCashEquipmentDisplay(profiles.base, cashEquipmentSummary);
  attachCashEquipmentDisplay(profiles.fullBoss, cashEquipmentSummary);

  const image =
    typeof character.character_image === "string" &&
    character.character_image.trim()
      ? character.character_image.trim()
      : null;
  const warnings: string[] = [...resolvedPresets.selection.warnings];
  if (
    optionalString(character.character_guild_name) &&
    profiles.fullBoss.details?.guildNoblesseResolved === false
  ) {
    warnings.push(
      "현재 길드의 노블레스 스킬을 확인하지 못해 공통 45포인트 길드 기준을 적용했습니다.",
    );
  }
  const rawEffectiveBossCriticalRate =
    profiles.fullBoss.details?.effectiveBossCriticalRate;
  const effectiveBossCriticalRate =
    typeof rawEffectiveBossCriticalRate === "number"
      ? rawEffectiveBossCriticalRate
      : Number.NaN;
  if (
    Number.isFinite(effectiveBossCriticalRate) &&
    effectiveBossCriticalRate >= 0 &&
    effectiveBossCriticalRate < 100
  ) {
    const displayedCriticalRate = Number.isInteger(effectiveBossCriticalRate)
      ? String(effectiveBossCriticalRate)
      : effectiveBossCriticalRate.toFixed(1);
    const rawConditionalBossCriticalRate =
      profiles.fullBoss.details?.conditionalBossCriticalRate;
    const conditionalBossCriticalRate =
      typeof rawConditionalBossCriticalRate === "number"
        ? rawConditionalBossCriticalRate
        : Number.NaN;
    const conditionalSource =
      profiles.fullBoss.details?.conditionalBossCriticalRateSource;
    if (
      Number.isFinite(conditionalBossCriticalRate) &&
      conditionalBossCriticalRate > effectiveBossCriticalRate &&
      typeof conditionalSource === "string" &&
      conditionalSource
    ) {
      const displayedConditionalRate = Number.isInteger(
        conditionalBossCriticalRate,
      )
        ? String(conditionalBossCriticalRate)
        : conditionalBossCriticalRate.toFixed(1);
      warnings.push(
        `샤프 아이즈 계열과 보스 대상 보정을 포함한 기본 크리티컬 확률이 ${displayedCriticalRate}%로 100% 미만입니다. ${conditionalSource}에서는 ${displayedConditionalRate}%입니다. 크리티컬 데미지 환산은 크리티컬 확률 100%를 가정했습니다.`,
      );
    } else {
      warnings.push(
        `샤프 아이즈 계열과 직업 보정을 포함한 보스전 크리티컬 확률이 ${displayedCriticalRate}%로 100% 미만입니다. 크리티컬 데미지 환산은 크리티컬 확률 100%를 가정했습니다.`,
      );
    }
  }
  if (!image) warnings.push("캐릭터 이미지 정보가 없습니다.");
  const fallbackMode = profiles.fullBoss.addOptionEquivalence.details?.mode;
  if (fallbackMode === "conventional-fallback") {
    warnings.push(
      "데몬어벤져는 Open API에서 풀도핑 HP 원금을 분리할 수 없어 HP/35 + STR/4 + 공격력×4 관행 점수를 적용하며, 이 점수는 선택한 프리셋에 따라 달라지지 않습니다.",
    );
  }
  return {
    ok: true,
    character: {
      name: requiredString(character, "character_name", "캐릭터 이름"),
      world: requiredString(character, "world_name", "월드"),
      level: characterLevel(character),
      className,
      image,
    },
    profiles,
    presetSelection: resolvedPresets.selection,
    equipmentSummary: buildCharacterEquipmentSummary(
      selectedPresetSnapshot.equipmentData,
      profiles.fullBoss,
      characterLevel(character),
      Number.isInteger(resolvedPresets.selection.selected.equipment)
        ? resolvedPresets.selection.selected.equipment
        : null,
    ),
    warnings: [...new Set(warnings)],
    attribution: NEXON_ATTRIBUTION,
  };
}
