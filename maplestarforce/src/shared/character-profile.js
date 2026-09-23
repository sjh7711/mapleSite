import { calculatorStorage, isSharedResult, registerResultShareProfile } from "./result-share-state.js";
import { STAT_EQUIVALENCE } from "maple-core/potential";
import { FULL_BOSS_DOPING } from "maple-core/stat-profile";
import { calculateIgnoreDefenseEquivalent } from "maple-core/stat-efficiency";
import {
  cardWithHead,
  element,
  note,
  resetAction,
  searchableSelect,
} from "./calculator-ui.js";
import {
  MAX_SAVED_CHARACTER_NAMES,
  SAVED_CHARACTER_NAMES_VERSION,
  addSavedCharacterName,
  hasSavedCharacterName,
  normalizeSavedCharacterNames,
  removeSavedCharacterName,
} from "./character-names.js";
import {
  getFlatStatToFlatMainStat,
  getProfileSubStats,
  getStatPercentToMainPercent,
  isDualSubStatClass,
  withStatEquivalenceMaps,
} from "./profile-stat-equivalence.js";
import { characterEquipmentSummaryBoard } from "./character-equipment-summary.js";

const STORAGE_KEY = "maplestarforce:character-profile:v2";
const LEGACY_STORAGE_KEY = "maplestarforce:character-profile:v1";
const SAVED_NAMES_STORAGE_KEY = "maplestarforce:character-names:v1";
const EQUIPMENT_TOOLTIP_SUMMARY_VERSION = 12;
const HIDDEN_CHARACTER_WARNING_PREFIXES = Object.freeze([
  "샤프 아이즈 계열과 직업 보정을 포함한 보스전 크리티컬 확률이",
  "샤프 아이즈 계열과 보스 대상 보정을 포함한 기본 크리티컬 확률이",
]);
const CHARACTER_ESTIMATE_DISCLAIMER =
  "각 옵션의 가치는 메이플스토리 데미지 계산식, 각 직업의 스킬 수치, 연무장 데이터를 기반으로 추정한 값입니다. 오차가 있을 수 있습니다.";
const PROFILE_MODE = "fullBoss";
const PRESET_MODES = new Set(["auto", "active", "manual"]);
const PRESET_FIELDS = [
  {
    key: "equipment",
    param: "equipmentPreset",
    label: "장비",
    max: 3,
    aliases: ["equipmentPreset", "equipment_preset"],
  },
  {
    key: "hyper",
    param: "hyperPreset",
    label: "하이퍼",
    max: 3,
    aliases: ["hyperPreset", "hyper_preset"],
  },
  {
    key: "union",
    param: "unionPreset",
    label: "유니온",
    max: 10,
    aliases: ["unionPreset", "union_preset"],
  },
  {
    key: "link",
    param: "linkPreset",
    label: "링크",
    max: 3,
    aliases: ["linkPreset", "link_preset"],
  },
  {
    key: "ability",
    param: "abilityPreset",
    label: "어빌리티",
    max: 3,
    aliases: ["abilityPreset", "ability_preset"],
  },
];
const DEFAULT_PRESET_MANUAL = Object.freeze(
  Object.fromEntries(PRESET_FIELDS.map(({ key }) => [key, 1])),
);
const listeners = new Set();

let saved = loadSaved();
registerResultShareProfile(() => saved);
let savedCharacterNames = loadSavedCharacterNames();
let presetRequest = normalizePresetRequest(
  saved?.presetRequest ?? saved?.presetSelection,
);
let pendingPresetRequest = null;
let manualPresetDraft = null;
let pending = false;
let message = "";
let messageTone = "";
const equipmentTooltipRefreshAttempts = new Set();

export function hasCurrentEquipmentTooltipData(summary) {
  return Boolean(
    summary &&
    Number(summary.version) >= EQUIPMENT_TOOLTIP_SUMMARY_VERSION &&
    Array.isArray(summary.items) &&
    summary.items.every((item) =>
      item?.tooltip && typeof item.tooltip === "object"
    ),
  );
}

export function needsEquipmentTooltipRefresh(summary) {
  return Boolean(
    summary &&
    Array.isArray(summary.items) &&
    summary.items.length > 0 &&
    !hasCurrentEquipmentTooltipData(summary),
  );
}

export function needsCashEquipmentDisplayRefresh(profile) {
  const cashEquipment = profile?.details?.externalComponents?.cashEquipment;
  return !cashEquipment || !Array.isArray(cashEquipment.displayItems);
}

export function needsBaselineSkillRefresh(profile) {
  return Boolean(profile && !Array.isArray(profile.details?.baselineSkills));
}

export function shouldShowCharacterProfileWarning(warning) {
  const text = String(warning ?? "");
  return !HIDDEN_CHARACTER_WARNING_PREFIXES.some((prefix) =>
    text.startsWith(prefix)
  );
}

function presetNumber(source, field) {
  if (!source || typeof source !== "object") return null;
  for (const key of [field.key, ...field.aliases]) {
    const value = Number(source[key]);
    if (Number.isInteger(value) && value >= 1 && value <= field.max) {
      return value;
    }
  }
  return null;
}

function normalizePresetMap(source, fallback = DEFAULT_PRESET_MANUAL) {
  return Object.fromEntries(
    PRESET_FIELDS.map((field) => [
      field.key,
      presetNumber(source, field) ?? presetNumber(fallback, field) ?? 1,
    ]),
  );
}

function normalizePresetSelectionMap(source, fallback) {
  return Object.fromEntries(
    PRESET_FIELDS.map((field) => [
      field.key,
      presetNumber(source, field) ?? presetNumber(fallback, field),
    ]),
  );
}

export function normalizePresetRequest(value) {
  const source = value && typeof value === "object" ? value : {};
  const mode = PRESET_MODES.has(source.mode) ? source.mode : "auto";
  const manualSource = source.manual ?? source.selected ?? source.active;
  return {
    mode,
    manual: normalizePresetMap(manualSource),
  };
}

function normalizePresetAvailability(source, field) {
  const raw = source?.[field.key] ?? field.aliases
    .map((alias) => source?.[alias])
    .find((value) => value !== undefined);
  const values = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.values)
      ? raw.values
      : [];
  return [...new Set(values
    .map(Number)
    .filter((value) => Number.isInteger(value) && value >= 1 && value <= field.max))]
    .sort((left, right) => left - right);
}

export function normalizePresetSelection(value) {
  if (!value || typeof value !== "object") return null;
  const mode = PRESET_MODES.has(value.mode) ? value.mode : "auto";
  const active = normalizePresetSelectionMap(value.active);
  const selected = normalizePresetSelectionMap(value.selected, active);
  const available = Object.fromEntries(
    PRESET_FIELDS.map((field) => [
      field.key,
      normalizePresetAvailability(value.available, field),
    ]),
  );
  return {
    ...value,
    mode,
    active,
    selected,
    available,
    approximate: value.approximate === true,
    warnings: Array.isArray(value.warnings) ? value.warnings : [],
  };
}

function normalizeDataFreshness(value) {
  if (!value || typeof value !== "object") return null;
  if (!new Set(["nexon", "snapshot-cache", "stale-cache"]).has(value.source)) {
    return null;
  }
  const fetchedAt = String(value.fetchedAt ?? "");
  const timestamp = Date.parse(fetchedAt);
  return Number.isFinite(timestamp)
    ? { source: value.source, fetchedAt: new Date(timestamp).toISOString() }
    : null;
}

export function shouldKeepNewerSavedCharacterData(
  savedValue,
  incomingCharacterName,
  incomingFreshness,
) {
  const savedFreshness = normalizeDataFreshness(savedValue?.dataFreshness);
  const dataFreshness = normalizeDataFreshness(incomingFreshness);
  return Boolean(
    dataFreshness &&
    savedValue?.character?.name === incomingCharacterName &&
    savedFreshness &&
    Date.parse(savedFreshness.fetchedAt) > Date.parse(dataFreshness.fetchedAt),
  );
}

export function buildCharacterConversionUrl(
  characterName,
  request,
  { refresh = false } = {},
) {
  const normalized = normalizePresetRequest(request);
  const params = new URLSearchParams({
    characterName: String(characterName ?? "").trim(),
    presetMode: normalized.mode,
  });
  if (normalized.mode === "manual") {
    for (const field of PRESET_FIELDS) {
      params.set(field.param, String(normalized.manual[field.key]));
    }
  }
  if (refresh) params.set("refresh", "1");
  return `/api/character-conversion?${params.toString()}`;
}

function loadSaved() {
  try {
    const value = JSON.parse(calculatorStorage.getItem(STORAGE_KEY));
    if (value?.character && value?.profiles?.fullBoss) {
      calculatorStorage.removeItem(LEGACY_STORAGE_KEY);
      return value;
    }

    const legacy = JSON.parse(calculatorStorage.getItem(LEGACY_STORAGE_KEY));
    if (!legacy?.character || !legacy?.profiles?.fullBoss) return null;
    // 이 세 직업의 v1 프로필에는 두 번째 부스탯이 없어서 계산값을
    // 복원할 수 없다. 다시 조회하도록 폐기하고, 나머지는 v2로 옮긴다.
    if (isDualSubStatClass(legacy.character.className)) {
      calculatorStorage.removeItem(LEGACY_STORAGE_KEY);
      return null;
    }
    const migrated = {
      ...legacy,
      profiles: Object.fromEntries(
        Object.entries(legacy.profiles).map(([key, profile]) => [
          key,
          profile && typeof profile === "object"
            ? {
                ...profile,
                subStats: getProfileSubStats(profile),
              }
            : profile,
        ]),
      ),
    };
    calculatorStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...migrated, mode: PROFILE_MODE }),
    );
    calculatorStorage.removeItem(LEGACY_STORAGE_KEY);
    return migrated;
  } catch {
    return null;
  }
}

function storeSaved() {
  try {
    if (saved) {
      calculatorStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ ...saved, mode: PROFILE_MODE }),
      );
    }
    else calculatorStorage.removeItem(STORAGE_KEY);
  } catch {
    // 저장 공간을 막은 브라우저에서도 이번 탭 계산은 계속한다.
  }
}

function loadSavedCharacterNames() {
  try {
    return normalizeSavedCharacterNames(
      JSON.parse(calculatorStorage.getItem(SAVED_NAMES_STORAGE_KEY)),
    );
  } catch {
    return [];
  }
}

function storeSavedCharacterNames() {
  try {
    if (savedCharacterNames.length) {
      calculatorStorage.setItem(
        SAVED_NAMES_STORAGE_KEY,
        JSON.stringify({
          version: SAVED_CHARACTER_NAMES_VERSION,
          names: savedCharacterNames,
        }),
      );
    } else {
      calculatorStorage.removeItem(SAVED_NAMES_STORAGE_KEY);
    }
  } catch {
    // 저장 공간이 막혀도 이번 탭의 닉네임 목록은 유지한다.
  }
}

function notifyListeners() {
  for (const listener of listeners) listener(getActiveProfile());
}

function emitProfile() {
  storeSaved();
  notifyListeners();
}

function emitSavedCharacterNames() {
  storeSavedCharacterNames();
  notifyListeners();
}

export function subscribeCharacterProfile(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getActiveProfile({ capability } = {}) {
  if (!saved) return null;
  const profile = saved.profiles?.fullBoss;
  if (capability && profile?.capabilities?.[capability] === false) return null;
  if (!profile) return null;
  const active = {
    ...profile,
    character: saved.character,
    mode: PROFILE_MODE,
    presetSelection: saved.presetSelection ?? null,
    equipmentSummary: saved.equipmentSummary ?? null,
  };
  active.subStats = getProfileSubStats(active);
  active.subStat = active.subStats[0] ?? null;
  return profile.statEquivalence
    ? withStatEquivalenceMaps(active)
    : active;
}

export function getCalculationProfile(fallback = {}, { capability } = {}) {
  const active = getActiveProfile({ capability });
  const mainStat = active?.mainStat ?? fallback.mainStat ?? "STR";
  const subStatSource = active ?? fallback;
  const subStats = getProfileSubStats(
    {
      mainStat,
      ...(Array.isArray(subStatSource?.subStats)
        ? { subStats: subStatSource.subStats }
        : { subStat: subStatSource?.subStat }),
    },
    { defaultSubStat: active ? null : fallback.subStat ?? "DEX" },
  );
  const fallbackEquivalence = fallback.statEquivalence ?? {};
  const activeEquivalence = active?.statEquivalence ?? {};
  const statEquivalence = {
    ...STAT_EQUIVALENCE,
    ...fallbackEquivalence,
    ...activeEquivalence,
  };
  for (const key of [
    "flatStatToFlatMainStatByStat",
    "statPercentToMainPercentByStat",
    "unreflectedStatToPercentByStat",
  ]) {
    statEquivalence[key] = {
      ...(STAT_EQUIVALENCE[key] ?? {}),
      ...(fallbackEquivalence[key] ?? {}),
      ...(activeEquivalence[key] ?? {}),
    };
  }
  return withStatEquivalenceMaps({
    mainStat,
    subStat: subStats[0] ?? null,
    subStats,
    attackType: active?.attackType ?? fallback.attackType ?? "attack",
    statModel: active?.statModel ?? fallback.statModel ?? "standard",
    capabilities: active?.capabilities ?? fallback.capabilities ?? {},
    addOptionEquivalence:
      active?.addOptionEquivalence ?? fallback.addOptionEquivalence ?? null,
    characterLevel: active?.character?.level ?? fallback.characterLevel ?? 290,
    statEquivalence,
    character: active?.character ?? null,
    source: active ? "character" : "default",
  });
}

function coefficient(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function fullBossDopingSummary(profile) {
  const totals = {
    ...FULL_BOSS_DOPING.totals,
    ...(profile.details?.effectiveDopingTotals ?? {}),
  };
  const statText = profile.statModel === "xenon"
    ? `STR·DEX·LUK 각각 +${totals.mainStat}`
    : [
        profile.mainStat ? `${profile.mainStat} +${totals.mainStat}` : null,
        ...getProfileSubStats(profile).map(
          (stat) => `${stat} +${totals.subStat}`,
        ),
      ].filter(Boolean).join(" · ");
  return [
    `공·마 +${totals.attackMagic}`,
    `공·마 +${totals.attackMagicPercent}%`,
    statText,
    `보공 +${totals.bossDamage}%`,
    `데미지 +${totals.damage}%`,
    `크뎀 +${totals.criticalDamage}%`,
    `방무 ${totals.ignoreDefenseSources.join("% · ")}% 각각 적용`,
  ].filter(Boolean).join(" · ");
}

export function combatRingSummary(profile) {
  const rings = Array.isArray(profile.details?.combatRings)
    ? profile.details.combatRings
    : [];
  if (!rings.length) return null;
  const format = (value) => Number(value).toFixed(2).replace(/\.00$/u, "");
  return rings.map((ring) => {
    const effects = [];
    const attack = profile.attackType === "magic"
      ? Number(ring.averageMagicPercent)
      : Number(ring.averageAttackPercent);
    if (attack > 0) effects.push(`공·마 평균 +${format(attack)}%`);
    if (Number(ring.averageBossDamage) > 0) {
      effects.push(`보공 평균 +${format(ring.averageBossDamage)}%`);
    }
    if (Number(ring.averageFlatStat) > 0) {
      effects.push(
        `${ring.weaponPuffStat} 평균 +${format(ring.averageFlatStat)}`,
      );
    }
    const minutes = format((Number(profile.details?.combatDurationSeconds) || 360) / 60);
    const coverage = ring.activationMode === "battle-practice-damage-weighted"
      ? `반지 적용 구간 피해 비중 ${(Number(ring.damageCoverage) * 100).toFixed(1)}%`
      : ring.activationMode === "boss-entry-maintained"
        ? "보스전 상시 유지"
        : `${minutes}분 기준 시간 가동률 ${(Number(ring.timeUptime ?? ring.uptime) * 100).toFixed(1)}%`;
    return `${ring.name}${ring.level ? ` Lv.${ring.level}` : ""} · ` +
      coverage +
      (effects.length ? ` · ${effects.join(" · ")}` : "");
  }).join("\n");
}

function dynamicCombatSummary(profile) {
  const details = profile.details ?? {};
  const parts = [];
  const activeSkills = Array.isArray(details.activeSkillCycles)
    ? details.activeSkillCycles
    : [];
  if (activeSkills.length) {
    parts.push(
      activeSkills.map((skill) =>
        `${skill.name} ${(Number(skill.uptime) * 100).toFixed(1)}%`
      ).join(" · "),
    );
  }
  if (Number(details.criticalReinforceAverageCriticalDamage) > 0) {
    parts.push(
      `크리티컬 리인포스 평균 크뎀 +${Number(
        details.criticalReinforceAverageCriticalDamage,
      ).toFixed(2)}%`,
    );
  }
  if (Number(details.conditionalLinkDamage) > 0) {
    parts.push(
      `조건부 링크 평균 데미지 +${Number(
        details.conditionalLinkDamage,
      ).toFixed(2)}%`,
    );
  }
  if (Number(details.combatOrdersSharpEyesBonus) > 0) {
    parts.push("쓸만한 컴뱃 오더스 샤프 아이즈 +1레벨");
  }
  return parts.length ? parts.join(" · ") : null;
}

function classDopingSummary(profile) {
  const adjustment = FULL_BOSS_DOPING.classAdjustments?.[
    profile.character?.className
  ];
  if (!adjustment) return null;
  return [
    Number.isFinite(adjustment.baseMain)
      ? `기본 주스탯 ${adjustment.baseMain >= 0 ? "+" : ""}${adjustment.baseMain}`
      : null,
    Number.isFinite(adjustment.mainStatPercent)
      ? `주스탯 +${adjustment.mainStatPercent}%`
      : null,
    Number.isFinite(adjustment.subStatPercent)
      ? `부스탯 +${adjustment.subStatPercent}%`
      : null,
    Number.isFinite(adjustment.attackMagic)
      ? `공·마 +${adjustment.attackMagic}`
      : null,
    Number.isFinite(adjustment.damage)
      ? `데미지 +${adjustment.damage}%`
      : null,
    Number.isFinite(adjustment.bossDamage)
      ? `보공 +${adjustment.bossDamage}%`
      : null,
    Number.isFinite(adjustment.criticalDamage)
      ? `크뎀 +${adjustment.criticalDamage}%`
      : null,
    Array.isArray(adjustment.ignoreDefenseSources)
      ? `방무 ${adjustment.ignoreDefenseSources.join("% · ")}% 각각 적용`
      : null,
  ].filter(Boolean).join(" · ");
}

function classAlwaysOnCombatSummary(profile) {
  const details = profile.details ?? {};
  if (!details.classAlwaysOnAdjustmentApplied) return null;
  const adjustment = details.classAlwaysOnAdjustment ?? {};
  const defaultMode = String(details.classAlwaysOnDefaultMode ?? "").trim();
  const sources = Array.isArray(details.classAlwaysOnSources)
    ? details.classAlwaysOnSources
    : [];
  const learnedSources = Array.isArray(details.classAlwaysOnLearnedSkillSources)
    ? details.classAlwaysOnLearnedSkillSources
    : [];
  return [
    ...sources.map((source) =>
      source === defaultMode ? `${source} 기본` : source
    ),
    ...learnedSources.map((source) => `${source} 적용`),
    Number(adjustment.damage) > 0
      ? `데미지 +${adjustment.damage}%`
      : null,
    Number(adjustment.bossDamage) > 0
      ? `보공 +${adjustment.bossDamage}%`
      : null,
    Number(adjustment.criticalDamage) > 0
      ? `크뎀 +${adjustment.criticalDamage}%`
      : null,
  ].filter(Boolean).join(" · ");
}

export function baselineSkillSummary(skill) {
  const effects = skill.effects ?? {};
  const parts = [];
  if (Number(effects.attack) > 0 && effects.attack === effects.magic) {
    parts.push(`공·마 +${effects.attack}`);
  } else {
    if (Number(effects.attack) > 0) parts.push(`공격력 +${effects.attack}`);
    if (Number(effects.magic) > 0) parts.push(`마력 +${effects.magic}`);
  }
  if (Number(effects.allStat) > 0) parts.push(`올스탯 +${effects.allStat}`);
  for (const [key, label] of [["bossDamage", "보공"], ["damage", "데미지"],
    ["criticalRate", "크확"], ["criticalDamage", "크뎀"]]) {
    if (Number(effects[key]) > 0) parts.push(`${label} +${effects[key]}%`);
  }
  for (const value of effects.ignoreDefenseSources ?? []) {
    if (Number(value) > 0) parts.push(`방무 ${value}%`);
  }
  return `${skill.name}${parts.length ? ` (${parts.join(", ")})` : ""}`;
}

function fullBossDopingDetails(profile, conventionalAddOption, collapsed = false) {
  if (conventionalAddOption) return null;
  const panel = element(collapsed ? "details" : "section", "profile-doping");
  const content = collapsed
    ? element("div", "profile-doping__content")
    : panel;
  if (collapsed) {
    panel.dataset.detailsKey = "full-boss-doping";
    panel.append(element("summary", "profile-doping__title", FULL_BOSS_DOPING.label));
  } else {
    content.append(element("strong", "profile-doping__title", FULL_BOSS_DOPING.label));
  }
  content.append(element("p", "profile-doping__totals", fullBossDopingSummary(profile)));
  const baselineSkills = Array.isArray(profile.details?.baselineSkills)
    ? profile.details.baselineSkills : [];
  const eventSkills = baselineSkills.filter((skill) => skill.kind === "event");
  if (eventSkills.length) {
    content.append(element("p", "profile-doping__class",
      `현재 이벤트 스킬 · ${eventSkills.map(baselineSkillSummary).join(" · ")} (기본 능력치에 포함)`));
  }
  const alwaysOnSummary = classAlwaysOnCombatSummary(profile);
  if (alwaysOnSummary) {
    content.append(
      element(
        "p",
        "profile-doping__class",
        `${profile.character.className} 기본 전투 설정 · ${alwaysOnSummary}`,
      ),
    );
  }
  const classSummary = classDopingSummary(profile);
  if (classSummary) {
    content.append(
      element(
        "p",
        "profile-doping__class",
        `${profile.character.className} 직업 보정 · ${classSummary}`,
      ),
    );
  }
  const ringSummary = combatRingSummary(profile);
  if (ringSummary) {
    for (const line of ringSummary.split("\n")) {
      content.append(
        element("p", "profile-doping__class", `특수 스킬 반지 · ${line}`),
      );
    }
  }
  const dynamicSummary = dynamicCombatSummary(profile);
  if (dynamicSummary) {
    content.append(
      element("p", "profile-doping__class", `전투 주기 보정 · ${dynamicSummary}`),
    );
  }
  const cashEquipment = profile.details?.externalComponents?.cashEquipment;
  const combatOutfitSummary = String(
    cashEquipment?.displaySummary ?? "",
  ).trim();
  if (combatOutfitSummary) {
    content.append(
      element(
        "p",
        "profile-doping__class",
        `전투복 · ${combatOutfitSummary}`,
      ),
    );
  }
  const guildSkills = Array.isArray(profile.details?.guildNoblesseSkills)
    ? profile.details.guildNoblesseSkills
    : [];
  const combatOutfitItems = Array.isArray(cashEquipment?.displayItems)
    ? cashEquipment.displayItems
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
        .map((item) => `전투복 · ${item}`)
    : [];
  const masterLabelPlus = String(
    cashEquipment?.masterLabelPlus ?? "",
  ).trim();
  const appliedItems = [
    ...FULL_BOSS_DOPING.items,
    ...combatOutfitItems,
    ...(masterLabelPlus
      ? [`마스터라벨 플러스 · ${masterLabelPlus}`]
      : []),
    ...guildSkills.map((name) => `${name} (현재 길드)`),
    ...(Array.isArray(profile.details?.combatRings)
      ? profile.details.combatRings.map((ring) => `${ring.name} Lv.${ring.level}`)
      : []),
  ];
  const applied = element("details", "profile-doping__details");
  applied.dataset.detailsKey = "full-boss-doping-items";
  applied.append(
    element(
      "summary",
      "profile-doping__summary",
      `적용 버프 ${appliedItems.length}개 보기`,
    ),
  );
  const list = element("ul", "profile-doping__items");
  list.append(
    ...appliedItems.map((item) =>
      element("li", "profile-doping__item", item)
    ),
  );
  applied.append(list);
  content.append(applied);
  if (collapsed) panel.append(content);
  return panel;
}

export function toBossDamagePercentEquivalent(
  mainPercentEquivalent,
  bossDamageToMainPercent,
) {
  const value = Number(mainPercentEquivalent);
  const ratio = Number(bossDamageToMainPercent);
  return Number.isFinite(value) && Number.isFinite(ratio) && ratio > 0
    ? value / ratio
    : null;
}

/**
 * 제논의 statEquivalence는 STR 1%를 기준축으로 저장한다. 반면
 * addOptionEquivalence의 allStatPercentToDamagePercent는 올스탯 1%의
 * 실제 데미지 가치이므로, 둘을 바로 곱하면 STR·DEX·LUK%가
 * 올스탯%/STR% 비율만큼 중복 확대된다.
 */
export function xenonMainPercentToDamagePercent(
  mainPercentEquivalent,
  statEquivalence,
  addOptionEquivalence,
) {
  const value = Number(mainPercentEquivalent);
  const allStatDamageUnit = Number(
    addOptionEquivalence?.allStatPercentToDamagePercent,
  );
  const allStatToMainPercent = Number(
    statEquivalence?.allStatPercentToMainPercent,
  );
  return Number.isFinite(value) &&
      Number.isFinite(allStatDamageUnit) &&
      allStatDamageUnit >= 0 &&
      Number.isFinite(allStatToMainPercent) &&
      allStatToMainPercent > 0
    ? value * allStatDamageUnit / allStatToMainPercent
    : null;
}

export function levelTwoStatBonus(characterLevel) {
  const level = Number(characterLevel);
  return Number.isInteger(level) && level > 0 ? Math.floor(level / 9) * 2 : null;
}

function profileCoefficient(
  label,
  value,
  {
    digits = 2,
    basis = "",
    suffix = "%급",
    secondary = null,
    valueForAmount = null,
    title = "",
  } = {},
) {
  if (!Number.isFinite(value)) return null;
  const item = element("div", "profile-coefficient");
  if (title) item.title = title;
  const equivalents = element("div", "profile-coefficient__equivalents");
  const primaryValue = element("strong", "profile-coefficient__value");
  equivalents.append(primaryValue);
  let comparisonValue = null;
  if (Number.isFinite(secondary?.value)) {
    comparisonValue = element("span", "profile-coefficient__comparison");
    equivalents.append(comparisonValue);
  }
  const match = String(label).match(/^(.*?\+)\s*(\d+(?:\.\d+)?)(%?)(.*)$/u);
  const baseAmount = Number(match?.[2]);
  const resolvePrimary = (amount) => typeof valueForAmount === "function"
    ? valueForAmount(amount)
    : value * amount / baseAmount;
  const resolveSecondary = (amount) => typeof secondary?.valueForAmount === "function"
    ? secondary.valueForAmount(amount)
    : secondary?.value * amount / baseAmount;
  const paint = (amount) => {
    const primary = match ? resolvePrimary(amount) : value;
    primaryValue.textContent = `${basis ? `${basis} ` : ""}${coefficient(primary, digits)}${suffix}`;
    if (comparisonValue) {
      const comparison = match ? resolveSecondary(amount) : secondary.value;
      comparisonValue.textContent = `${secondary.basis ? `${secondary.basis} ` : ""}${coefficient(
        comparison,
        secondary.digits ?? digits,
      )}${secondary.suffix ?? suffix}`;
    }
  };
  const labelNode = element("span", "profile-coefficient__label");
  if (match && baseAmount > 0) {
    const amount = document.createElement("input");
    amount.type = "number";
    amount.min = "0";
    amount.step = "1";
    amount.value = "10";
    amount.className = "profile-coefficient__amount";
    amount.setAttribute("aria-label", `${label} 계산 수치`);
    amount.addEventListener("input", () => {
      paint(Math.max(0, Number(amount.value) || 0));
    });
    const optionLabel = match[1].replace(/\+\s*$/u, "").trim();
    labelNode.append(
      element(
        "span",
        "profile-coefficient__label-prefix",
        `${optionLabel}${match[3]}${match[4]}`,
      ),
      amount,
    );
    paint(10);
  } else {
    labelNode.textContent = label;
    paint(baseAmount);
  }
  item.append(labelNode, equivalents);
  return item;
}

async function searchCharacter(
  name,
  request = presetRequest,
  { refresh = false, equipmentTooltipUpgrade = false } = {},
) {
  if (pending) return;
  const characterName = name.trim();
  if (!characterName) {
    message = "캐릭터명을 입력해 주세요.";
    messageTone = "error";
    emitProfile();
    return;
  }
  const normalizedRequest = normalizePresetRequest(request);
  pendingPresetRequest = normalizedRequest;
  pending = true;
  message = equipmentTooltipUpgrade
    ? "NEXON 원본 장비 정보를 갱신하는 중입니다…"
    : "공식 API에서 장비와 스탯을 확인하는 중입니다…";
  messageTone = "";
  emitProfile();
  try {
    const requestOptions = {
      headers: { Accept: "application/json" },
      cache: refresh ? "no-store" : "default",
    };
    // 구형 로컬 저장본을 올릴 때는 브라우저의 예전 HTTP 응답만
    // 재사용하지 않는다. 서버에서는 refresh=1 없이 버전 캐시와
    // 원본 스냅샷 캐시를 그대로 사용할 수 있다.
    if (!refresh && equipmentTooltipUpgrade) requestOptions.cache = "reload";
    const response = await fetch(
      buildCharacterConversionUrl(characterName, normalizedRequest, { refresh }),
      requestOptions,
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error?.message ?? payload?.message ?? `조회 실패 (${response.status})`);
    }
    const dataFreshness = normalizeDataFreshness(payload.dataFreshness);
    const upgradesEquipmentTooltip =
      needsEquipmentTooltipRefresh(saved?.equipmentSummary) &&
      hasCurrentEquipmentTooltipData(payload.equipmentSummary);
    if (equipmentTooltipUpgrade && !hasCurrentEquipmentTooltipData(
      payload.equipmentSummary,
    )) {
      throw new Error(
        "원본 장비 정보를 불러오지 못했습니다. 잠시 후 정보 갱신을 눌러 주세요.",
      );
    }
    if (!upgradesEquipmentTooltip && shouldKeepNewerSavedCharacterData(
      saved,
      payload?.character?.name,
      dataFreshness,
    )) {
      message = "브라우저에 저장된 더 최신 캐릭터 정보를 유지했습니다.";
      messageTone = "";
      return;
    }
    const presetSelection = normalizePresetSelection(payload.presetSelection);
    presetRequest = normalizePresetRequest({
      mode: presetSelection?.mode ?? normalizedRequest.mode,
      manual: presetSelection?.selected ?? normalizedRequest.manual,
    });
    saved = {
      character: payload.character,
      profiles: payload.profiles,
      warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
      attribution: payload.attribution,
      equipmentSummary: payload.equipmentSummary ?? null,
      ...(dataFreshness ? { dataFreshness } : {}),
      presetRequest,
      ...(presetSelection ? { presetSelection } : {}),
    };
    manualPresetDraft = null;
    message = `${payload.character.name}의 풀 보스 도핑 환산값을 적용했습니다.`;
    messageTone = "success";
  } catch (error) {
    message = error?.message || "캐릭터 정보를 가져오지 못했습니다.";
    messageTone = "error";
  } finally {
    pending = false;
    pendingPresetRequest = null;
    emitProfile();
  }
}

function scheduleEquipmentTooltipRefresh(characterName) {
  if (isSharedResult()) return;
  const summary = saved?.equipmentSummary;
  const profile = saved?.profiles?.fullBoss;
  const needsTooltip = needsEquipmentTooltipRefresh(summary);
  const needsCashEquipment = needsCashEquipmentDisplayRefresh(profile);
  const needsSkills = needsBaselineSkillRefresh(profile);
  if (!needsTooltip && !needsCashEquipment && !needsSkills) return;
  const attemptKey = [
    characterName,
    summary?.version ?? "legacy",
    summary?.presetNo ?? "current",
    saved?.dataFreshness?.fetchedAt ?? "unknown",
    needsCashEquipment ? "cash-equipment-display" : "tooltip-only",
    needsSkills ? "baseline-skills" : "current-skills",
  ].join(":");
  if (equipmentTooltipRefreshAttempts.has(attemptKey)) return;
  equipmentTooltipRefreshAttempts.add(attemptKey);
  queueMicrotask(() => {
    if (
      pending ||
      saved?.character?.name !== characterName ||
      (
        !needsEquipmentTooltipRefresh(saved?.equipmentSummary) &&
        !needsCashEquipmentDisplayRefresh(saved?.profiles?.fullBoss) &&
        !needsBaselineSkillRefresh(saved?.profiles?.fullBoss)
      )
    ) {
      return;
    }
    void searchCharacter(characterName, presetRequest, {
      equipmentTooltipUpgrade: true,
    });
  });
}

function saveCharacterName(name) {
  if (hasSavedCharacterName(savedCharacterNames, name)) return;
  if (savedCharacterNames.length >= MAX_SAVED_CHARACTER_NAMES) {
    message = `닉네임은 최대 ${MAX_SAVED_CHARACTER_NAMES}개까지 저장할 수 있습니다.`;
    messageTone = "error";
    emitSavedCharacterNames();
    return;
  }
  const next = addSavedCharacterName(savedCharacterNames, name);
  if (next.length === savedCharacterNames.length) return;
  savedCharacterNames = next;
  message = `${name} 닉네임을 브라우저에 저장했습니다.`;
  messageTone = "success";
  emitSavedCharacterNames();
}

function forgetCharacterName(name) {
  savedCharacterNames = removeSavedCharacterName(savedCharacterNames, name);
  message = `${name} 닉네임을 저장 목록에서 삭제했습니다.`;
  messageTone = "";
  emitSavedCharacterNames();
}

function savedCharacterList(activeName) {
  if (savedCharacterNames.length === 0) return null;
  const list = element("ul", "profile-saved-names");
  list.setAttribute("aria-label", "저장한 닉네임");

  for (const characterName of savedCharacterNames) {
    const item = element("li", "profile-saved-character");
    const isActive = characterName === activeName;
    item.dataset.active = String(isActive);
    const load = element(
      "button",
      "profile-saved-character__load",
      characterName,
    );
    load.type = "button";
    load.disabled = pending;
    load.dataset.active = String(isActive);
    if (isActive) load.setAttribute("aria-current", "true");
    load.setAttribute("aria-label", `${characterName} 캐릭터 정보 불러오기`);
    load.title = `${characterName} 캐릭터 정보 불러오기`;
    load.addEventListener("click", () =>
      searchCharacter(
        characterName,
        characterName === activeName ? presetRequest : { mode: "auto" },
      )
    );

    const remove = element("button", "profile-saved-character__remove", "×");
    remove.type = "button";
    remove.disabled = pending;
    remove.setAttribute("aria-label", `${characterName} 저장 목록에서 삭제`);
    remove.title = `${characterName} 삭제`;
    remove.addEventListener("click", () => forgetCharacterName(characterName));
    item.append(load, remove);
    list.append(item);
  }
  return list;
}

export function isPresetModeLoading(mode, isPending, request) {
  return Boolean(
    isPending &&
    (mode === "auto" || mode === "active") &&
    request?.mode === mode,
  );
}

function presetModeButton(
  label,
  mode,
  currentMode,
  activeName,
  manual,
  manualAvailable,
) {
  const button = element("button", "profile-preset-mode", label);
  button.type = "button";
  button.dataset.active = String(mode === currentMode);
  button.setAttribute("aria-pressed", String(mode === currentMode));
  button.disabled = pending || (mode === "manual" && !manualAvailable);
  if (mode === "manual" && !manualAvailable) {
    button.title = "다섯 종류의 프리셋을 모두 확인할 수 있을 때 직접 선택할 수 있습니다.";
  }
  button.addEventListener("click", () => {
    if (pending || mode === currentMode) return;
    if (mode === "manual") {
      manualPresetDraft = { ...manual };
      notifyListeners();
      return;
    }
    if (manualPresetDraft && mode === presetRequest.mode) {
      manualPresetDraft = null;
      notifyListeners();
      return;
    }
    manualPresetDraft = null;
    searchCharacter(activeName, { mode, manual });
  });
  return button;
}

function presetOptions(selection, field, current) {
  const available = selection.available?.[field.key] ?? [];
  const values = available.length ? [...available] : [current];
  if (!values.includes(current)) values.push(current);
  return [...new Set(values)]
    .sort((left, right) => left - right)
    .map((value) => ({ value, label: String(value) }));
}

function presetSelectionControls(activeName, selection, conventionalAddOption) {
  if (!selection) return null;
  const request = pendingPresetRequest ?? presetRequest;
  const currentMode = manualPresetDraft ? "manual" : request.mode;
  const manualAvailable = PRESET_FIELDS.every(
    (field) => (selection.available?.[field.key] ?? []).length > 0,
  );
  const manual = Object.fromEntries(
    PRESET_FIELDS.map((field) => {
      const available = selection.available?.[field.key] ?? [];
      const requested = presetNumber(
        manualPresetDraft ?? request.manual,
        field,
      );
      const selectedValue = presetNumber(selection.selected, field);
      const activeValue = presetNumber(selection.active, field);
      return [
        field.key,
        [requested, selectedValue, activeValue].find((value) =>
          available.includes(value)
        ) ?? available[0] ?? null,
      ];
    }),
  );
  const selected = currentMode === "manual" ? manual : selection.selected;
  const controls = element("div", "profile-preset-controls");
  if (pending) controls.setAttribute("aria-busy", "true");

  const top = element("div", "profile-preset-controls__top");
  const title = element("span", "profile-preset-controls__title", "계산 기준");
  const modes = element("div", "profile-preset-modes");
  modes.setAttribute("role", "group");
  modes.setAttribute("aria-label", "캐릭터 프리셋 계산 기준");
  modes.append(
    presetModeButton(
      "자동 보스",
      "auto",
      currentMode,
      activeName,
      manual,
      manualAvailable,
    ),
    presetModeButton(
      "현재 활성",
      "active",
      currentMode,
      activeName,
      manual,
      manualAvailable,
    ),
    presetModeButton(
      "직접 선택",
      "manual",
      currentMode,
      activeName,
      manual,
      manualAvailable,
    ),
  );
  const selectedText = PRESET_FIELDS
    .map((field) => `${field.label} ${selected[field.key] ?? "-"}`)
    .join(" · ");
  const summary = element("span", "profile-preset-controls__summary", selectedText);
  summary.title = selectedText;
  const basis = element(
    "span",
    "profile-preset-controls__basis",
    conventionalAddOption ? "관행 추옵 점수" : "풀 보스 도핑",
  );
  const loadingMode = ["auto", "active"].find((mode) =>
    isPresetModeLoading(mode, pending, pendingPresetRequest)
  );
  const loadingLabel = loadingMode === "active" ? "현재 활성" : "자동 보스";
  const loadingIndicator = element("span", "profile-preset-controls__loading");
  loadingIndicator.dataset.visible = String(Boolean(loadingMode));
  loadingIndicator.setAttribute("aria-hidden", String(!loadingMode));
  if (loadingMode) {
    loadingIndicator.setAttribute("role", "status");
    loadingIndicator.setAttribute(
      "aria-label",
      `${loadingLabel} 기준 불러오는 중`,
    );
    loadingIndicator.title = `${loadingLabel} 기준 불러오는 중`;
  }
  top.append(title, modes, summary);
  if (currentMode === "auto" && selection.approximate) {
    const approximate = element("span", "profile-preset-controls__approximate", "자동 추정");
    approximate.title = "보스전 효율을 기준으로 프리셋을 자동 추정했습니다.";
    top.append(approximate);
  }
  top.append(basis);
  controls.append(top, loadingIndicator);

  if (currentMode === "manual") {
    const manualControls = element("div", "profile-preset-manual");
    for (const field of PRESET_FIELDS) {
      const label = element("label", "profile-preset-manual__field");
      const caption = element("span", "profile-preset-manual__label", field.label);
      const select = searchableSelect(
        presetOptions(selection, field, manual[field.key]),
        manual[field.key],
        (next) => {
          manualPresetDraft = { ...manual, [field.key]: Number(next) };
          notifyListeners();
        },
        { key: `character-preset-${field.key}` },
      );
      select.disabled = pending;
      select.setAttribute("aria-label", `${field.label} 프리셋`);
      label.append(caption, select);
      manualControls.append(label);
    }
    const apply = element("button", "profile-preset-manual__apply", "적용");
    apply.type = "button";
    apply.disabled = pending || (
      request.mode === "manual" &&
      PRESET_FIELDS.every(({ key }) => request.manual[key] === manual[key])
    );
    apply.addEventListener("click", () => {
      if (apply.disabled) return;
      searchCharacter(activeName, { mode: "manual", manual });
    });
    manualControls.append(apply);
    controls.append(manualControls);
  }

  return controls;
}

export function characterProfileCard({
  onChange,
  extraContent,
  collapseReferenceDetails = false,
  equipmentMetric = null,
  onEquipmentSelect = null,
} = {}) {
  if (onChange) listeners.add(onChange);
  const active = getActiveProfile();
  const normalizedActive = active?.statEquivalence
    ? withStatEquivalenceMaps(active)
    : active;
  const activeName = active?.character?.name ?? "";
  if (active && equipmentMetric) {
    scheduleEquipmentTooltipRefresh(activeName);
  }
  const savedNames = savedCharacterList(activeName);
  const headActions = element("div", "profile-head-actions");
  if (savedNames) {
    headActions.classList.add("profile-head-actions--with-names");
    headActions.append(savedNames);
  }
  if (active) {
    if (equipmentMetric) {
      const refreshEquipment = element(
        "button",
        "button button--quiet profile-equipment-refresh",
        "정보 갱신",
      );
      refreshEquipment.type = "button";
      refreshEquipment.disabled = pending;
      refreshEquipment.title = "NEXON API에서 현재 캐릭터 정보를 새로 받아옵니다.";
      refreshEquipment.addEventListener("click", () => {
        searchCharacter(activeName, presetRequest, { refresh: true });
      });
      headActions.append(refreshEquipment);
    }
    const reset = resetAction("초기화", () => {
      saved = null;
      presetRequest = normalizePresetRequest({ mode: "auto" });
      pendingPresetRequest = null;
      manualPresetDraft = null;
      message = "기본 환산값으로 돌아갔습니다.";
      messageTone = "";
      emitProfile();
    }, {
      className: "profile-head-reset",
      disabled: pending,
      title: "불러온 현재 캐릭터 정보만 초기화합니다.",
      ariaLabel: "현재 캐릭터 정보 초기화",
    });
    headActions.append(reset);
  }
  const titleAction = headActions.childElementCount ? headActions : null;
  const children = [];

  if (active) {
    const summary = element("div", "profile-summary");
    if (active.character.image && !equipmentMetric) {
      const image = document.createElement("img");
      image.className = "profile-summary__image";
      image.src = active.character.image;
      image.alt = "";
      image.width = 160;
      image.height = 160;
      const portrait = element("div", "profile-summary__portrait");
      portrait.append(image);
      summary.append(portrait);
      summary.classList.add("profile-summary--with-image");
    }
    const body = element("div", "profile-summary__body");
    const name = element("p", "profile-summary__name");
    const nameText = element(
      "span",
      "profile-summary__name-text",
      active.character.name,
    );
    const isNameSaved = hasSavedCharacterName(
      savedCharacterNames,
      active.character.name,
    );
    const saveName = element(
      "button",
      "profile-summary__save",
      isNameSaved ? "저장됨" : "저장",
    );
    saveName.type = "button";
    saveName.dataset.saved = String(isNameSaved);
    saveName.disabled =
      pending || isNameSaved ||
      savedCharacterNames.length >= MAX_SAVED_CHARACTER_NAMES;
    saveName.title = isNameSaved
      ? "이미 저장한 닉네임입니다."
      : savedCharacterNames.length >= MAX_SAVED_CHARACTER_NAMES
        ? `닉네임은 최대 ${MAX_SAVED_CHARACTER_NAMES}개까지 저장할 수 있습니다.`
        : "이 닉네임을 브라우저에 저장합니다.";
    saveName.addEventListener("click", () => {
      saveCharacterName(active.character.name);
    });
    name.append(nameText, saveName);
    const meta = element(
      "p",
      "profile-summary__meta",
      `${active.character.world ?? ""} · Lv.${active.character.level ?? "-"} · ${active.character.className ?? ""}`,
    );
    const conventionalAddOption = String(
      active.addOptionEquivalence?.details?.mode ?? "",
    ).startsWith("conventional");
    const presetSelection = normalizePresetSelection(saved?.presetSelection);
    const basis = element(
      "span",
      "profile-summary__basis",
      conventionalAddOption ? "관행 추옵 점수 기준" : "풀 보스 도핑 기준",
    );
    const eq = normalizedActive.statEquivalence ?? {};
    const subStats = getProfileSubStats(normalizedActive);
    const coefficients = element(
      collapseReferenceDetails ? "details" : "div",
      "profile-coefficients",
    );
    const coefficientContent = collapseReferenceDetails
      ? element("div", "profile-coefficients__body")
      : coefficients;
    if (collapseReferenceDetails) {
      coefficients.dataset.detailsKey = "profile-coefficients";
      coefficients.append(element(
        "summary",
        "profile-coefficients__summary",
        "각 옵션의 가치",
      ));
    }
    const attackLabel = active.attackType === "magic" ? "마력" : "공격력";
    const levelTwoAmount = levelTwoStatBonus(active.character.level);
    const levelTwoCoefficient = (render, stat, perStatValue, options = {}) =>
      levelTwoAmount === null ? null : render(
        active.statModel === "standard" ? "렙당2" : `렙당2 (${stat})`,
        levelTwoAmount * Number(perStatValue),
        {
          ...options,
          title: `Lv.${active.character.level} · 캐릭터 기준 9레벨 당 ${stat} +2 → ${stat} +${levelTwoAmount}`,
        },
      );
    const xenonPotentialCoefficients =
      active.statModel === "xenon" &&
      equipmentMetric !== "flame" &&
      active.capabilities?.potentialEquivalence !== false &&
      active.addOptionEquivalence?.flatStatToDamagePercent;
    if (xenonPotentialCoefficients) {
      const direct = active.addOptionEquivalence;
      const allStatUnit = Number(direct.allStatPercentToDamagePercent);
      const toDamageEquivalent = (mainPercentEquivalent) =>
        xenonMainPercentToDamagePercent(mainPercentEquivalent, eq, direct);
      const ignoreDefenseDamageEquivalent = (amount) => {
        const value = calculateIgnoreDefenseEquivalent({
          currentIgnoreDefense: Number(eq.currentIgnoreDefense),
          addedIgnoreDefense: Math.max(0, Math.min(100, amount)) / 100,
          enemyDefense: 3.8 * Number(eq.targetDefenseRemaining ?? 1),
          oneMainPercentRelative: Number(eq.oneMainPercentRelative),
        });
        return toDamageEquivalent(value);
      };
      const xenonCoefficient = (label, value, options = {}) =>
        profileCoefficient(label, value, {
          ...options,
          basis: "데미지",
          digits: options.digits ?? 3,
          suffix: "%급",
        });
      coefficientContent.append(
        element(
          "p",
          "profile-coefficients__caption",
          "옵션별 제논 전용 데미지% 환산",
        ),
        ...[
          xenonCoefficient(
            "보공 +1%",
            Number(direct.bossDamageToDamagePercent),
          ),
          xenonCoefficient(
            `${attackLabel} +1%`,
            toDamageEquivalent(eq.attackPercentToMainPercent),
          ),
          xenonCoefficient(
            "방무 +40% (380)",
            ignoreDefenseDamageEquivalent(40),
            { valueForAmount: ignoreDefenseDamageEquivalent },
          ),
          xenonCoefficient(
            "크리티컬 데미지 +1%",
            toDamageEquivalent(eq.criticalDamageToMainPercent),
          ),
          xenonCoefficient(
            "올스탯 +1%",
            Number(direct.allStatPercentToDamagePercent),
          ),
          ...["STR", "DEX", "LUK"].map((stat) =>
            xenonCoefficient(
              `${stat} +1%`,
              toDamageEquivalent(eq.statPercentToMainPercentByStat?.[stat]),
            )
          ),
          ...["STR", "DEX", "LUK"].map((stat) =>
            xenonCoefficient(
              `${stat} +1`,
              Number(direct.flatStatToDamagePercent[stat]),
              { digits: 4 },
            )
          ),
          ...["STR", "DEX", "LUK"].map((stat) =>
            levelTwoCoefficient(xenonCoefficient, stat, direct.flatStatToDamagePercent[stat])
          ),
          xenonCoefficient(
            `${attackLabel} +1`,
            Number(direct.flatAttackToDamagePercent),
            { digits: 4 },
          ),
        ].filter(Boolean),
      );
    } else if (
      active.statModel !== "standard" &&
      active.addOptionEquivalence?.flatStatToDamagePercent
    ) {
      const direct = active.addOptionEquivalence;
      const specialBasis = conventionalAddOption ? "관행 추옵" : "데미지";
      const directOptions = active.statModel === "xenon"
        ? [
            ["올스탯 +1%", direct.allStatPercentToDamagePercent, 3],
            ["STR +1", direct.flatStatToDamagePercent.STR, 4],
            ["DEX +1", direct.flatStatToDamagePercent.DEX, 4],
            ["LUK +1", direct.flatStatToDamagePercent.LUK, 4],
            ["공격력 +1", direct.flatAttackToDamagePercent, 4],
          ]
        : [
            ["올스탯 +1% (STR)", direct.allStatPercentToDamagePercent, 4],
            ["HP +35", direct.flatStatToDamagePercent.HP * 35, 4],
            ["STR +1", direct.flatStatToDamagePercent.STR, 4],
            ["공격력 +1", direct.flatAttackToDamagePercent, 4],
          ];
      coefficientContent.append(
        element(
          "p",
          "profile-coefficients__caption",
          conventionalAddOption
            ? "옵션별 데몬어벤져 관행 추옵 점수"
            : "옵션별 제논 전용 데미지% 환산",
        ),
        ...directOptions
          .map(([label, value, digits]) =>
            profileCoefficient(label, value, {
              digits,
              basis: specialBasis,
              suffix: conventionalAddOption ? "점" : "%급",
            }),
          )
          .filter(Boolean),
        ...((active.statModel === "xenon" ? ["STR", "DEX", "LUK"] : ["STR"])
          .map((stat) => levelTwoCoefficient(profileCoefficient, stat, direct.flatStatToDamagePercent[stat], {
            digits: 3,
            basis: specialBasis,
            suffix: conventionalAddOption ? "점" : "%급",
          })).filter(Boolean)),
      );
    } else {
      const flatMain = Number(eq.flatMainStatToPercent);
      const flatAttack = flatMain * Number(eq.attackToMainStat);
      const bossDamageToMainPercent = Number(eq.bossDamageToMainPercent);
      const standardCoefficient = (label, value, options = {}) =>
        profileCoefficient(label, value, {
          ...options,
          basis: "주스탯",
          secondary: {
            basis: "데미지",
            value: toBossDamagePercentEquivalent(
              value,
              bossDamageToMainPercent,
            ),
            valueForAmount: typeof options.valueForAmount === "function"
              ? (amount) => toBossDamagePercentEquivalent(
                  options.valueForAmount(amount),
                  bossDamageToMainPercent,
                )
              : null,
            digits: 2,
            suffix: "% 급",
          },
        });
      const subStatCoefficients = subStats.flatMap((stat) => [
        standardCoefficient(
          `${stat} +1`,
          flatMain * getFlatStatToFlatMainStat(normalizedActive, stat),
          { digits: 3 },
        ),
      ]);
      const subStatPercentCoefficients = subStats.map((stat) =>
        standardCoefficient(
          `${stat} +1%`,
          getStatPercentToMainPercent(normalizedActive, stat),
        )
      );
      coefficientContent.append(
        element(
          "p",
          "profile-coefficients__caption",
          "주스탯%급(윗줄) · 데미지%급(아랫줄)",
        ),
        ...[
          standardCoefficient("보공 +1%", eq.bossDamageToMainPercent),
          standardCoefficient(`${attackLabel} +1%`, eq.attackPercentToMainPercent),
          standardCoefficient("방무 +40% (380)", eq.ied40Against380ToMainPercent, {
            valueForAmount: (amount) => calculateIgnoreDefenseEquivalent({
              currentIgnoreDefense: Number(eq.currentIgnoreDefense),
              addedIgnoreDefense: Math.max(0, Math.min(100, amount)) / 100,
              enemyDefense: 3.8 * Number(eq.targetDefenseRemaining ?? 1),
              oneMainPercentRelative: Number(eq.oneMainPercentRelative),
            }),
          }),
          standardCoefficient("크리티컬 데미지 +1%", eq.criticalDamageToMainPercent),
          standardCoefficient("올스탯 +1%", eq.allStatPercentToMainPercent),
          ...subStatPercentCoefficients,
          standardCoefficient(`주스탯(${active.mainStat}) +1`, flatMain, { digits: 3 }),
          levelTwoCoefficient(standardCoefficient, active.mainStat, flatMain),
          ...subStatCoefficients,
          standardCoefficient(`${attackLabel} +1`, flatAttack, { digits: 3 }),
        ].filter(Boolean),
      );
    }
    if (collapseReferenceDetails) coefficients.append(coefficientContent);
    let equipmentIdentity = null;
    if (equipmentMetric) {
      equipmentIdentity = element("div", "profile-equipment__identity");
      equipmentIdentity.append(name, meta);
    } else {
      body.append(name, meta);
    }
    if (!presetSelection) body.append(basis);
    if (body.childElementCount) summary.append(body);
    const equipmentBoard = equipmentMetric
      ? characterEquipmentSummaryBoard(normalizedActive, equipmentMetric, {
          identity: equipmentIdentity,
          onItemSelect: onEquipmentSelect,
        })
      : null;
    if (equipmentBoard) summary.append(equipmentBoard);
    const presetControls = presetSelectionControls(
      active.character.name,
      presetSelection,
      conventionalAddOption,
    );
    if (presetControls) summary.append(presetControls);
    summary.append(coefficients);
    const dopingDetails = fullBossDopingDetails(
      active,
      conventionalAddOption,
      collapseReferenceDetails,
    );
    if (dopingDetails) summary.append(dopingDetails);
    children.push(summary);
    if (active.capabilities?.potentialEquivalence === false) {
      children.push(
        note(
          active.statModel === "demon-avenger"
            ? "잠재능력은 HP%로 표시하고, 추가옵션은 데몬어벤져 관행 점수로 계산합니다."
            : `${active.character.className} 전용 추가옵션 환산을 적용합니다.`,
          "fine-print",
        ),
      );
    }
    for (const warning of saved.warnings ?? []) {
      if (shouldShowCharacterProfileWarning(warning)) {
        children.push(note(warning, "fine-print"));
      }
    }
    children.push(note(CHARACTER_ESTIMATE_DISCLAIMER, "fine-print"));
  } else {
    const form = element("form", "profile-form");
    const input = document.createElement("input");
    input.type = "search";
    input.name = "characterName";
    input.maxLength = 12;
    input.autocomplete = "off";
    input.placeholder = "캐릭터명";
    input.setAttribute("aria-label", "캐릭터명");
    const button = element("button", "button", pending ? "조회 중…" : "내 스탯 불러오기");
    button.type = "submit";
    button.disabled = pending;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      searchCharacter(input.value, { mode: "auto" });
    });
    form.append(input, button);
    children.push(form);
  }

  if (message) {
    const status = note(message, "status-message");
    status.dataset.tone = messageTone;
    status.setAttribute("role", "status");
    children.push(status);
  }
  children.push(note("Data based on NEXON Open API", "fine-print"));
  if (extraContent) children.push(extraContent);
  const profileCard = cardWithHead(
    "내 캐릭터 정보 불러오기",
    titleAction,
    ...children,
  );
  profileCard.classList.add("profile-card");
  return profileCard;
}
