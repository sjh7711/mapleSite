import { estimateItemMarketValue } from "../shared/item-market-estimator.js";
import { compareItemMarketStatFamilies } from "../shared/item-market-stat-comparison.js";
import { resolveItemMarketStatPeerGroup } from "../shared/item-market-peer-items.js";
import { filterItemMarketCatalog } from "../shared/item-market-search.js";
import {
  allocateSharedExpectedCostRecovery,
  attachExpectedCostRecovery,
  buildItemMarketExpectationMetadata,
  calculateItemMarketExpectedCosts,
} from "../shared/item-market-expected-cost.js";
import { EQUIPMENT_PRESETS } from "../calc.js";
import { getAvailablePotentialTargetTypes } from "maple-core/potential";
import {
  itemMarketIconUrl,
  loadItemMarketCatalog,
  loadItemMarketComparables,
} from "../shared/item-market-data.js";
import {
  inferItemUpgradeSlotMaximum,
} from "../shared/item-upgrade-slots.js";
import { inferAutomaticScrollUpgradeState } from "../shared/item-market-scroll-cost.js";
import { loadPotentialTables } from "../shared/potential-tables.js";
import { renderToolNav } from "../shared/shell.js";
import { chip, field, numberInput } from "../shared/ui.js";
import {
  card,
  cardWithHead,
  element,
  formatMeso,
  searchableSelect,
  note,
  renderWithFocus,
  resetAction,
  resultCard as createResultCard,
  resultHero,
  resultLine,
  row,
} from "../shared/calculator-ui.js";
import {
  characterProfileCard,
  getActiveProfile,
  getCalculationProfile,
  subscribeCharacterProfile,
} from "../shared/character-profile.js";

renderToolNav(document.querySelector("#toolnav"), "item-market");

const STORAGE_KEY = "maplestarforce:item-market:v2";
const STARFORCE_STORAGE_KEY = "maplestarforce:v4";
const STATS = ["STR", "DEX", "INT", "LUK"];
const MAIN_STAT_OPTIONS = [
  ...STATS,
  { value: "ALL", label: "제논 (STR·DEX·LUK)" },
  { value: "HP", label: "데몬어벤져 (HP)" },
];
const DEFAULT_SUB_STAT = { STR: "DEX", DEX: "STR", INT: "LUK", LUK: "DEX" };
const GRADES = [
  { value: "none", label: "없음" },
  { value: "rare", label: "레어" },
  { value: "epic", label: "에픽" },
  { value: "unique", label: "유니크" },
  { value: "legendary", label: "레전드리" },
];
const TRADE_STATES = [
  { value: "", label: "기준 상태 (미입력)" },
  { value: "untradeable_after_equip", label: "미착용 · 장착 시 교환 불가" },
  { value: "one_trade_left", label: "1회 교환 가능 · 거래 후 교환 불가" },
  { value: "tradable", label: "교환 가능" },
];
const STARFORCE_PRESET_ALIASES = Object.freeze({
  "마이스터링": "meister-ring",
  "데이브레이크 펜던트": "daybreak-pendant",
  "도미네이터 펜던트": "dominator",
  "루즈 컨트롤 머신 마크": "loose-control",
  "마력이 깃든 안대": "magic-eyepatch",
  "고통의 근원": "seniority-ring",
  "가디언 엔젤 링": "gaen-ring",
  "몽환의 벨트": "dreamy-belt",
  "커맨더 포스 이어링": "commanding-force",
  "거대한 공포": "giant-fear",
  "컴플리트 언더컨트롤": "whisper-earring",
  "근원의 속삭임": "origin-whisper",
  "죽음의 맹세": "oath-of-death",
  "황홀한 악몽": "ecstatic-nightmare",
  "굶주리는 핏빛 원혼": "bloody-soul",
  "블랙빈 마크": "level-135",
  "파풀라투스 마크": "level-145",
  "분노한 자쿰의 벨트": "level-150",
});
const OPTION_TYPES = [
  { value: "", label: "없음" },
  { value: "ATTACK:pct", label: "공격력 %", code: "ATTACK", unit: "pct", suffix: "%" },
  { value: "MAGIC_ATTACK:pct", label: "마력 %", code: "MAGIC_ATTACK", unit: "pct", suffix: "%" },
  { value: "IGNORE_DEFENSE:pct", label: "몬스터 방어율 무시 %", code: "IGNORE_DEFENSE", unit: "pct", suffix: "%" },
  { value: "COOLDOWN_REDUCTION:seconds", label: "재사용 대기시간 감소", code: "COOLDOWN_REDUCTION", unit: "seconds", suffix: "초" },
  { value: "CRITICAL_DAMAGE:pct", label: "크리티컬 데미지 %", code: "CRITICAL_DAMAGE", unit: "pct", suffix: "%" },
  { value: "STR:pct", label: "STR %", code: "STR", unit: "pct", suffix: "%" },
  { value: "DEX:pct", label: "DEX %", code: "DEX", unit: "pct", suffix: "%" },
  { value: "INT:pct", label: "INT %", code: "INT", unit: "pct", suffix: "%" },
  { value: "LUK:pct", label: "LUK %", code: "LUK", unit: "pct", suffix: "%" },
  { value: "ALL_STAT:pct", label: "올스탯 %", code: "ALL_STAT", unit: "pct", suffix: "%" },
  { value: "HP:pct", label: "HP %", code: "HP", unit: "pct", suffix: "%" },
  { value: "DAMAGE:pct", label: "데미지 %", code: "DAMAGE", unit: "pct", suffix: "%" },
  { value: "BOSS_DAMAGE:pct", label: "보스 공격 시 데미지 %", code: "BOSS_DAMAGE", unit: "pct", suffix: "%" },
  { value: "CRITICAL_RATE:pct", label: "크리티컬 확률 %", code: "CRITICAL_RATE", unit: "pct", suffix: "%" },
  { value: "ITEM_DROP_RATE:pct", label: "아이템 드롭률 %", code: "ITEM_DROP_RATE", unit: "pct", suffix: "%" },
  { value: "MESO_OBTAINED:pct", label: "메소 획득량 %", code: "MESO_OBTAINED", unit: "pct", suffix: "%" },
  { value: "AUTO_STEAL:pct", label: "공격 시 오토스틸 %", code: "AUTO_STEAL", unit: "pct", suffix: "%" },
  { value: "STR:flat", label: "STR", code: "STR", unit: "flat", suffix: "" },
  { value: "DEX:flat", label: "DEX", code: "DEX", unit: "flat", suffix: "" },
  { value: "INT:flat", label: "INT", code: "INT", unit: "flat", suffix: "" },
  { value: "LUK:flat", label: "LUK", code: "LUK", unit: "flat", suffix: "" },
  { value: "ALL_STAT:flat", label: "올스탯", code: "ALL_STAT", unit: "flat", suffix: "" },
  { value: "HP:flat", label: "HP", code: "HP", unit: "flat", suffix: "" },
  { value: "ATTACK:flat", label: "공격력", code: "ATTACK", unit: "flat", suffix: "" },
  { value: "MAGIC_ATTACK:flat", label: "마력", code: "MAGIC_ATTACK", unit: "flat", suffix: "" },
  ...STATS.map((stat) => ({
    value: `STAT_PER_CHARACTER_LEVEL:${stat}`,
    label: `캐릭터 기준 9레벨 당 ${stat}`,
    code: "STAT_PER_CHARACTER_LEVEL",
    unit: null,
    suffix: "",
    stat,
  })),
];
const OPTION_BY_VALUE = new Map(OPTION_TYPES.map((option) => [option.value, option]));
const POTENTIAL_PART_BY_CATEGORY = Object.freeze({
  "무기": 1,
  "엠블렘": 2,
  "보조무기": 3,
  "포스실드/소울링": 4,
  "포스실드": 4,
  "소울링": 4,
  "방패": 5,
  "모자": 6,
  "상의": 7,
  "한벌옷": 8,
  "하의": 9,
  "신발": 10,
  "장갑": 11,
  "망토": 12,
  "벨트": 13,
  "어깨장식": 14,
  "얼굴장식": 15,
  "눈장식": 16,
  "귀고리": 17,
  "반지": 18,
  "펜던트": 19,
  "기계심장": 20,
  "기계 심장": 20,
});
const POTENTIAL_TARGET_BY_OPTION_VALUE = Object.freeze({
  "STR:pct": "str-percent",
  "DEX:pct": "dex-percent",
  "INT:pct": "int-percent",
  "LUK:pct": "luk-percent",
  "ALL_STAT:pct": "all-stat-percent",
  "HP:pct": "hp-percent",
  "ATTACK:pct": "attack-power-percent",
  "MAGIC_ATTACK:pct": "magic-power-percent",
  "DAMAGE:pct": "damage",
  "BOSS_DAMAGE:pct": "boss-damage",
  "IGNORE_DEFENSE:pct": "ignore-defense",
  "CRITICAL_RATE:pct": "critical-rate",
  "CRITICAL_DAMAGE:pct": "critical-damage",
  "ITEM_DROP_RATE:pct": "drop",
  "MESO_OBTAINED:pct": "meso",
  "COOLDOWN_REDUCTION:seconds": "cooldown",
  "AUTO_STEAL:pct": "auto-steal",
  "STR:flat": "str-flat",
  "DEX:flat": "dex-flat",
  "INT:flat": "int-flat",
  "LUK:flat": "luk-flat",
  "ALL_STAT:flat": "all-stat-flat",
  "HP:flat": "hp-flat",
  "ATTACK:flat": "attack-power-flat",
  "MAGIC_ATTACK:flat": "magic-power-flat",
  "STAT_PER_CHARACTER_LEVEL:STR": "str-per-nine",
  "STAT_PER_CHARACTER_LEVEL:DEX": "dex-per-nine",
  "STAT_PER_CHARACTER_LEVEL:INT": "int-per-nine",
  "STAT_PER_CHARACTER_LEVEL:LUK": "luk-per-nine",
});
const FLAME_INAPPLICABLE_CATEGORIES = new Set([
  "엠블렘", "보조무기", "포스실드/소울링", "포스실드", "소울링", "방패",
  "어깨장식", "반지", "기계심장", "기계 심장", "훈장",
]);
const COMPONENT_LABELS = Object.freeze({
  base: "노작값",
  starforce: "스타포스",
  potential_grade: "윗잠 등업",
  potential_options: "윗잠 옵션",
  additional_grade: "에디 등업",
  additional_options: "에디 옵션",
  scroll: "주문서",
  flame: "추가옵션",
  trade: "거래 상태 보정",
});
const CONFIDENCE_LABELS = Object.freeze({ high: "높음", medium: "보통", low: "낮음" });
const STAT_FIELDS = [
  { key: "str_flat", label: "STR", max: 99999 },
  { key: "dex_flat", label: "DEX", max: 99999 },
  { key: "int_flat", label: "INT", max: 99999 },
  { key: "luk_flat", label: "LUK", max: 99999 },
  { key: "hp_flat", label: "HP", max: 9999999 },
  { key: "all_stat_pct", label: "올스탯 %", max: 1000 },
  { key: "attack_flat", label: "공격력", max: 99999 },
  { key: "magic_attack_flat", label: "마력", max: 99999 },
  { key: "damage_pct", label: "데미지 %", max: 1000 },
  { key: "boss_damage_pct", label: "보스 데미지 %", max: 1000 },
];

function blankLines() {
  return Array.from({ length: 3 }, () => ({ type: "", value: "" }));
}

function blankStats() {
  return Object.fromEntries(STAT_FIELDS.map(({ key }) => [key, ""]));
}

function defaultItemFields() {
  return {
    starforce: 0,
    tradeState: "",
    scissorsRemaining: "",
    scissorsTotal: "",
    requiredLevelReduction: "",
    potential: { grade: "none", lines: blankLines() },
    additional: { grade: "none", lines: blankLines() },
    scroll: blankStats(),
    flame: blankStats(),
  };
}

const defaults = {
  itemName: "",
  mainStat: "STR",
  subStat: "DEX",
  subStat2: "none",
  attackType: "attack",
  statModel: "standard",
  characterLevel: 290,
  ...defaultItemFields(),
};

function normalizeLine(line) {
  const type = OPTION_BY_VALUE.has(line?.type) ? line.type : "";
  const raw = line?.value;
  return {
    type,
    value: raw === "" || raw === null || raw === undefined
      ? ""
      : Math.max(0, Number(raw) || 0),
  };
}

function normalizePotential(section) {
  const grade = GRADES.some((entry) => entry.value === section?.grade)
    ? section.grade
    : "none";
  const lines = Array.isArray(section?.lines)
    ? section.lines.slice(0, 3).map(normalizeLine)
    : [];
  while (lines.length < 3) lines.push({ type: "", value: "" });
  return { grade, lines };
}

function normalizeStats(source) {
  return Object.fromEntries(STAT_FIELDS.map(({ key }) => {
    const raw = source?.[key];
    return [key, raw === "" || raw === null || raw === undefined
      ? ""
      : Math.max(0, Number(raw) || 0)];
  }));
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!stored || typeof stored !== "object") return structuredClone(defaults);
    // v2의 가위 최대 입력값은 더 이상 사용자 설정으로 사용하지 않는다.
    // 선택한 장비 자료를 불러온 뒤 장비별 고정값으로 다시 채운다.
    const {
      scissorsTotal: _legacyScissorsTotal,
      basePriceEok: _legacyBasePriceEok,
      upgradeRemaining: _legacyUpgradeRemaining,
      upgradeRecoverable: _legacyUpgradeRecoverable,
      ...migrated
    } = stored;
    return {
      ...structuredClone(defaults),
      ...migrated,
      scissorsTotal: "",
      potential: normalizePotential(stored.potential),
      additional: normalizePotential(stored.additional),
      scroll: normalizeStats(stored.scroll),
      flame: normalizeStats(stored.flame),
    };
  } catch {
    return structuredClone(defaults);
  }
}

const state = loadState();
const root = document.querySelector("#tool");
const itemCache = new Map();
const market = {
  catalogStatus: "loading",
  itemStatus: "idle",
  catalog: null,
  manifest: null,
  data: null,
  tradeDefaults: null,
  error: "",
  statPeerStatus: "idle",
  statPeerGroup: null,
  statPeerData: {},
  statPeerError: "",
  potentialAvailability: {
    potential: { status: "idle", optionValues: [], error: "" },
    additional: { status: "idle", optionValues: [], error: "" },
  },
  potentialTables: { potential: null, additional: null },
};
let requestSequence = 0;
let potentialRequestSequence = 0;

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 저장할 수 없는 브라우저에서도 현재 계산은 유지한다.
  }
}

function update(mutator) {
  mutator();
  save();
  render();
}

function numericControl(key, value, onChange, attributes = {}) {
  const control = numberInput(value, onChange, {
    allowEmpty: true,
    min: "0",
    step: "1",
    ...attributes,
  });
  control.dataset.key = key;
  return control;
}

function resetItemFields() {
  Object.assign(state, defaultItemFields());
}

function resetStatPeerComparison() {
  market.statPeerStatus = "idle";
  market.statPeerGroup = null;
  market.statPeerData = {};
  market.statPeerError = "";
}

function representativeItemFromData(data) {
  return data?.records?.find((record) => record?.item)?.item ?? null;
}

function representativeItem() {
  return representativeItemFromData(market.data);
}

function selectedItemMeta() {
  const item = representativeItem();
  if (!item) {
    return {
      category: null,
      baseLevel: null,
      requiredJob: null,
      setName: null,
      potentialPart: null,
      starforceApplicable: null,
      upgradeApplicable: null,
      upgradeMaximum: null,
      scissorsMaximum: null,
      potentialApplicable: null,
      flameApplicable: null,
    };
  }
  const items = (market.data?.records || []).map((record) => record?.item).filter(Boolean);
  const starforceValues = items
    .map((candidate) => candidate?.starforce?.applicable)
    .filter((value) => typeof value === "boolean");
  const starforceApplicable = starforceValues.includes(true)
    ? true
    : starforceValues.length > 0
      ? false
      : null;
  const upgradeMaximum = inferItemUpgradeSlotMaximum(market.data?.records);
  const scissorsMaximum = inferFixedScissorsMaximum(items.map((candidate) => candidate.trade));
  const upgradeApplicable = upgradeMaximum === null ? null : upgradeMaximum > 0;
  const category = item.category || null;
  const potentialPart = POTENTIAL_PART_BY_CATEGORY[category] ?? null;
  const hasObservedFlame = items.some((candidate) =>
    Number(candidate?.required_level_reduction) > 0 ||
    Object.values(candidate?.stats?.flame || {}).some((value) => Number(value) !== 0));
  return {
    category,
    baseLevel: Number.isFinite(Number(item.base_level)) ? Number(item.base_level) : null,
    requiredJob: item.required_job || null,
    setName: item.set_name || null,
    potentialPart,
    starforceApplicable,
    upgradeApplicable,
    upgradeMaximum,
    scissorsMaximum,
    potentialApplicable: potentialPart !== null,
    // 불멸의 유산처럼 실제 추옵·착감이 관측된 특수 훈장은 범주 기본값보다 우선한다.
    flameApplicable: hasObservedFlame || !FLAME_INAPPLICABLE_CATEGORIES.has(category),
  };
}

function resetPotentialAvailability() {
  potentialRequestSequence += 1;
  market.potentialAvailability = {
    potential: { status: "idle", optionValues: [], error: "" },
    additional: { status: "idle", optionValues: [], error: "" },
  };
  market.potentialTables = { potential: null, additional: null };
}

function clearPotentialSection(section) {
  const alreadyClear = section.grade === "none" &&
    section.lines.every((line) => line.type === "" && line.value === "");
  section.grade = "none";
  section.lines = blankLines();
  return !alreadyClear;
}

function zeroStats(bucket) {
  let changed = false;
  for (const { key } of STAT_FIELDS) {
    if (state[bucket][key] !== 0) changed = true;
    state[bucket][key] = 0;
  }
  return changed;
}

function normalizeCapabilityState(meta = selectedItemMeta()) {
  let changed = false;
  const automaticScissorsTotal = Number.isInteger(meta.scissorsMaximum)
    ? meta.scissorsMaximum
    : "";
  if (state.scissorsTotal !== automaticScissorsTotal) {
    state.scissorsTotal = automaticScissorsTotal;
    changed = true;
  }
  if (automaticScissorsTotal !== "" && Number(state.scissorsRemaining) > automaticScissorsTotal) {
    state.scissorsRemaining = automaticScissorsTotal;
    changed = true;
  }
  if (meta.starforceApplicable === false && state.starforce !== 0) {
    state.starforce = 0;
    changed = true;
  }
  if (meta.upgradeApplicable === false) {
    changed = zeroStats("scroll") || changed;
  }
  if (meta.flameApplicable === false) {
    changed = zeroStats("flame") || changed;
    if (state.requiredLevelReduction !== 0) changed = true;
    state.requiredLevelReduction = 0;
  }
  if (meta.potentialApplicable === false) {
    changed = clearPotentialSection(state.potential) || changed;
    changed = clearPotentialSection(state.additional) || changed;
  }
  return changed;
}

function allowedPotentialOptions(sectionKey) {
  const availability = market.potentialAvailability[sectionKey];
  const allowed = new Set(availability.status === "ready"
    ? availability.optionValues
    : state[sectionKey].lines.map((line) => line.type).filter(Boolean));
  return OPTION_TYPES.filter((option) => !option.value || allowed.has(option.value));
}

function normalizePotentialSelections(sectionKey) {
  const allowed = new Set(market.potentialAvailability[sectionKey].optionValues);
  let changed = false;
  for (let index = 0; index < state[sectionKey].lines.length; index += 1) {
    const line = state[sectionKey].lines[index];
    if (line.type && !allowed.has(line.type)) {
      state[sectionKey].lines[index] = { type: "", value: "" };
      changed = true;
    }
  }
  return changed;
}

async function refreshPotentialAvailability() {
  const request = ++potentialRequestSequence;
  const itemName = state.itemName;
  const meta = selectedItemMeta();
  const jobs = [];
  let normalized = normalizeCapabilityState(meta);

  for (const sectionKey of ["potential", "additional"]) {
    const grade = state[sectionKey].grade;
    if (market.itemStatus !== "ready" || !itemName) {
      market.potentialTables[sectionKey] = null;
      market.potentialAvailability[sectionKey] = { status: "idle", optionValues: [], error: "" };
    } else if (meta.potentialApplicable === false) {
      market.potentialTables[sectionKey] = null;
      market.potentialAvailability[sectionKey] = { status: "unavailable", optionValues: [], error: "" };
    } else if (grade === "none") {
      market.potentialTables[sectionKey] = null;
      market.potentialAvailability[sectionKey] = { status: "ready", optionValues: [], error: "" };
    } else {
      const system = sectionKey === "potential" ? "regular" : "additional";
      market.potentialAvailability[sectionKey] = { status: "loading", optionValues: [], error: "" };
      jobs.push({
        sectionKey,
        grade,
        system,
        promise: loadPotentialTables({
          system,
          grade,
          part: meta.potentialPart,
          itemLevel: meta.baseLevel,
        }),
      });
    }
  }
  if (normalized) save();
  render();
  if (jobs.length === 0) return;

  const results = await Promise.allSettled(jobs.map((job) => job.promise));
  if (request !== potentialRequestSequence || state.itemName !== itemName) return;
  normalized = false;
  for (let index = 0; index < jobs.length; index += 1) {
    const job = jobs[index];
    if (state[job.sectionKey].grade !== job.grade) return;
    const result = results[index];
    if (result.status === "rejected") {
      market.potentialTables[job.sectionKey] = null;
      market.potentialAvailability[job.sectionKey] = {
        status: "error",
        optionValues: [],
        error: result.reason?.message || "공식 잠재 옵션 목록을 읽지 못했습니다.",
      };
      continue;
    }
    if (!result.value) {
      market.potentialTables[job.sectionKey] = null;
      market.potentialAvailability[job.sectionKey] = {
        status: "missing",
        optionValues: [],
        error: "이 부위·등급·레벨 조합은 공식 확률표에 없습니다.",
      };
      normalized = normalizePotentialSelections(job.sectionKey) || normalized;
      continue;
    }
    const targetTypes = new Set(getAvailablePotentialTargetTypes(result.value, {
      part: meta.potentialPart,
      system: job.system,
    }));
    const optionValues = OPTION_TYPES
      .filter((option) => option.value && targetTypes.has(POTENTIAL_TARGET_BY_OPTION_VALUE[option.value]))
      .map((option) => option.value);
    market.potentialTables[job.sectionKey] = result.value;
    market.potentialAvailability[job.sectionKey] = { status: "ready", optionValues, error: "" };
    normalized = normalizePotentialSelections(job.sectionKey) || normalized;
  }
  if (normalized) save();
  render();
}

function starforcePresetFor(itemName, itemMeta = {}) {
  let presetId = STARFORCE_PRESET_ALIASES[itemName] || null;
  if (!presetId && itemName.startsWith("아케인셰이드 ") &&
      ["어깨장식", "망토", "신발"].includes(itemMeta.category)) {
    presetId = "arcane-shoulder";
  }
  if (!presetId && itemName.startsWith("에테르넬 ")) {
    presetId = ["모자", "상의", "하의", "어깨장식"].includes(itemMeta.category)
      ? "eternal-hat"
      : ["장갑", "신발", "망토"].includes(itemMeta.category)
        ? "eternal-glove"
        : null;
  }
  return EQUIPMENT_PRESETS.find((preset) => preset.id === presetId) || null;
}

function savedStarforceExpectedSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STARFORCE_STORAGE_KEY) || "null") || {};
    return { event: stored.event, mvp: stored.mvp, pc: stored.pc === true };
  } catch {
    return { event: "shining", mvp: "diamond", pc: false };
  }
}

function mostFrequent(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

function inferFixedScissorsMaximum(trades) {
  const values = trades
    .map((trade) => trade?.scissors_total)
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map(Number)
    .filter((value) => Number.isInteger(value) && value > 0 && value <= 100);
  if (values.length === 0) return null;
  const representative = mostFrequent(values);
  const support = values.filter((value) => value === representative).length;
  const distinct = new Set(values).size;
  // 정상 자료는 장비마다 한 값으로 일치한다. 일부 잘못 읽힌 값이 섞여도
  // 80% 이상이 같은 값이고 관측이 2건 이상일 때만 고정값으로 채택한다.
  return distinct === 1 || (support >= 2 && support / values.length >= 0.8)
    ? representative
    : null;
}

function inferTradeDefaults(data, requestedState = null) {
  const allTrades = (data?.records || [])
    .map((record) => record?.item?.trade)
    .filter(Boolean);
  const trades = allTrades
    .filter((trade) => trade && TRADE_STATES.some(({ value }) => value && value === trade.state));
  const state = requestedState || mostFrequent(trades.map((trade) => trade.state));
  const matching = trades.filter((trade) => trade.state === state);
  const remaining = mostFrequent(matching
    .map((trade) => trade.scissors_remaining)
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map(Number)
    .filter((value) => Number.isInteger(value) && value >= 0));
  const total = inferFixedScissorsMaximum(allTrades);
  return { state, remaining, total };
}

function applyTradeDefaults(defaultsValue = market.tradeDefaults) {
  state.scissorsTotal = defaultsValue?.total ?? selectedItemMeta().scissorsMaximum ?? "";
  if (!defaultsValue?.state) return;
  state.tradeState = defaultsValue.state;
  state.scissorsRemaining = defaultsValue.remaining ?? "";
  if (Number.isInteger(state.scissorsTotal) && Number(state.scissorsRemaining) > state.scissorsTotal) {
    state.scissorsRemaining = state.scissorsTotal;
  }
}

async function loadSelectedItem(itemName) {
  const sequence = ++requestSequence;
  resetPotentialAvailability();
  resetStatPeerComparison();
  market.error = "";
  market.data = null;
  market.tradeDefaults = null;
  if (!itemName) {
    market.itemStatus = "idle";
    render();
    return;
  }
  market.itemStatus = "loading";
  render();
  try {
    let loaded = itemCache.get(itemName);
    if (!loaded) {
      loaded = await loadItemMarketComparables(itemName);
      itemCache.set(itemName, loaded);
    }
    if (sequence !== requestSequence || state.itemName !== itemName) return;
    market.manifest = loaded.manifest;
    market.catalog = loaded.catalog;
    market.data = loaded.data;
    market.itemStatus = loaded.data ? "ready" : "empty";
    market.tradeDefaults = inferTradeDefaults(loaded.data);
    market.statPeerGroup = resolveItemMarketStatPeerGroup({
      catalog: loaded.catalog,
      item: representativeItemFromData(loaded.data),
    });
    market.statPeerStatus = market.statPeerGroup.mode === "job_specific_peer_items"
      ? "loading"
      : "ready";
    if (!state.tradeState) {
      applyTradeDefaults();
    }
    normalizeCapabilityState(selectedItemMeta());
    save();
  } catch (error) {
    if (sequence !== requestSequence || state.itemName !== itemName) return;
    market.error = error?.message || "장비 시세 자료를 읽지 못했습니다.";
    market.itemStatus = "error";
  }
  render();
  if (sequence === requestSequence && market.itemStatus === "ready") {
    refreshPotentialAvailability();
    refreshStatPeerComparables(sequence, itemName, itemCache.get(itemName));
  }
}

async function refreshStatPeerComparables(sequence, itemName, currentLoaded) {
  const group = market.statPeerGroup;
  if (group?.mode !== "job_specific_peer_items") return;
  const peerEntries = [
    ...Object.entries(group.peers || {}).map(([key, peer]) => ({ key, peer })),
    ...(group.additional_peers || []).map((peer) => ({ key: peer.key, peer })),
  ];
  const pendingByItemName = new Map();
  const loadPeer = (peer) => {
    if (peer.item_name === itemName && currentLoaded?.data) {
      return Promise.resolve(currentLoaded);
    }
    const cached = itemCache.get(peer.item_name);
    if (cached?.data) return Promise.resolve(cached);
    if (!pendingByItemName.has(peer.item_name)) {
      pendingByItemName.set(peer.item_name, loadItemMarketComparables(peer.item_name, {
        manifest: currentLoaded?.manifest || market.manifest,
      }).then((loaded) => {
        if (loaded?.data) itemCache.set(peer.item_name, loaded);
        return loaded;
      }));
    }
    return pendingByItemName.get(peer.item_name);
  };
  const jobs = peerEntries.map(async ({ key, peer }) => {
    const loaded = await loadPeer(peer);
    return { key, loaded };
  });

  const results = await Promise.allSettled(jobs);
  if (
    sequence !== requestSequence ||
    state.itemName !== itemName ||
    market.statPeerGroup !== group
  ) return;

  const peerData = {};
  const errors = [];
  for (const outcome of results) {
    if (outcome.status === "fulfilled" && outcome.value.loaded?.data) {
      peerData[outcome.value.key] = outcome.value.loaded.data;
    } else if (outcome.status === "rejected") {
      errors.push(outcome.reason?.message || String(outcome.reason));
    }
  }
  market.statPeerData = peerData;
  market.statPeerStatus = Object.keys(peerData).length === peerEntries.length ? "ready" : "partial";
  market.statPeerError = errors[0] || "";
  render();
}

async function loadCatalog() {
  market.catalogStatus = "loading";
  market.error = "";
  render();
  try {
    const loaded = await loadItemMarketCatalog();
    market.catalog = loaded.catalog;
    market.manifest = loaded.manifest;
    market.catalogStatus = "ready";
    const exists = loaded.catalog.items.some((entry) => entry.name === state.itemName);
    if (state.itemName && !exists) {
      state.itemName = "";
      resetItemFields();
      save();
    }
    if (state.itemName) {
      await loadSelectedItem(state.itemName);
      return;
    }
  } catch (error) {
    market.catalogStatus = "error";
    market.error = error?.message || "장비 목록을 읽지 못했습니다.";
  }
  render();
}

function selectItem(itemName) {
  resetPotentialAvailability();
  state.itemName = itemName;
  resetItemFields();
  save();
  loadSelectedItem(itemName);
}

function selectedCatalogEntry() {
  return (market.catalog?.items || []).find((entry) => entry.name === state.itemName) || null;
}

function equipmentArtwork() {
  const artwork = element("span", "market-item-icon");
  const fallback = element("span", "market-item-icon__fallback", "?");
  fallback.setAttribute("aria-hidden", "true");
  const entry = selectedCatalogEntry();
  if (entry) {
    const iconUrl = itemMarketIconUrl(entry);
    if (iconUrl) {
      const image = document.createElement("img");
      image.src = iconUrl;
      image.alt = "";
      image.width = 48;
      image.height = 48;
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => {
        artwork.dataset.fallback = "true";
        image.remove();
      }, { once: true });
      artwork.append(image);
    } else {
      artwork.dataset.fallback = "true";
    }
    artwork.title = `${entry.name} 장비 아이콘`;
  } else {
    artwork.dataset.fallback = "true";
    artwork.title = "선택한 장비 아이콘";
  }
  artwork.append(fallback);
  return artwork;
}

function equipmentPicker() {
  const picker = element("div", "market-item-picker");
  const entries = market.catalog?.items || [];
  const options = entries.map((entry) => ({ value: entry.name, label: entry.name }));
  const combobox = searchableSelect(
    options,
    state.itemName,
    selectItem,
    {
      key: "market-item-name",
      ariaLabel: "시세를 추정할 장비 검색",
      disabled: market.catalogStatus !== "ready",
      className: "market-item-combobox",
      placeholder: market.catalogStatus === "loading"
        ? "장비 목록 불러오는 중…"
        : "장비명 검색 또는 선택",
      emptyText: "일치하는 장비가 없습니다.",
      filterOptions: (source, query) => {
        const names = new Set(filterItemMarketCatalog(entries, query).map((entry) => entry.name));
        return source.filter((option) => names.has(option.value));
      },
    },
  );
  picker.append(combobox);
  return picker;
}

function equipmentCard() {
  const reset = resetAction("옵션 초기화", () => update(() => {
    resetItemFields();
    applyTradeDefaults();
    normalizeCapabilityState(selectedItemMeta());
  }), {
    className: "button--compact",
    disabled: !state.itemName,
    title: "장비명은 유지하고 입력한 강화 옵션만 초기화합니다.",
  });
  const meta = selectedItemMeta();
  const equipmentSettings = row(
    field("장비명", equipmentPicker(), "market-item-field"),
    field(
      "스타포스",
      (() => {
        const control = numericControl("market-starforce", state.starforce, (value) => update(() => {
          state.starforce = value === "" ? "" : Math.min(25, Math.round(value));
        }), { max: "25" });
        control.disabled = meta.starforceApplicable !== true;
        return control;
      })(),
      "market-starforce-field",
    ),
    field(
      "거래 상태",
      searchableSelect(TRADE_STATES, state.tradeState, (value) => update(() => {
        const defaultsValue = inferTradeDefaults(market.data, value || null);
        if (value && !defaultsValue.state) state.tradeState = value;
        else applyTradeDefaults(defaultsValue);
      }), { key: "market-trade-state" }),
      "market-trade-field",
    ),
    field(
      "가위 잔여",
      (() => {
        const maximum = Number(state.scissorsTotal) > 0 ? Number(state.scissorsTotal) : 100;
        const control = numericControl(
          "market-scissors-remaining",
          state.scissorsRemaining,
          (value) => update(() => {
            state.scissorsRemaining = value === "" ? "" : Math.min(maximum, Math.round(value));
          }),
          { max: String(maximum) },
        );
        control.disabled = !state.tradeState;
        return control;
      })(),
      "market-equipment-secondary-field",
    ),
  );
  equipmentSettings.classList.add("market-equipment-settings");
  const equipmentLayout = element("div", "market-equipment-layout");
  equipmentLayout.append(equipmentArtwork(), equipmentSettings);
  const section = cardWithHead(
    "장비",
    reset,
    equipmentLayout,
  );
  if (market.catalogStatus === "error") {
    const retry = element("button", "button market-retry", "다시 불러오기");
    retry.type = "button";
    retry.addEventListener("click", loadCatalog);
    const message = element("div", "market-load-error");
    message.append(element("span", "", market.error), retry);
    section.append(message);
  } else if (state.itemName && market.itemStatus === "loading") {
    section.append(note("선택한 장비의 시세 계산을 준비하는 중입니다.", "status-message"));
  } else if (state.itemName && market.itemStatus === "error") {
    const retry = element("button", "button market-retry", "다시 불러오기");
    retry.type = "button";
    retry.addEventListener("click", () => loadSelectedItem(state.itemName));
    const message = element("div", "market-load-error");
    message.append(element("span", "", market.error), retry);
    section.append(message);
  }
  return section;
}

function potentialLineControl(sectionKey, index, disabled) {
  const line = state[sectionKey].lines[index];
  const spec = OPTION_BY_VALUE.get(line.type) || OPTION_TYPES[0];
  const lineLabel = `${sectionKey === "potential" ? "윗잠" : "에디"} ${index + 1}번째 옵션`;
  const select = searchableSelect(allowedPotentialOptions(sectionKey), line.type, (type) => update(() => {
    state[sectionKey].lines[index] = { type, value: "" };
  }), {
    key: `market-${sectionKey}-type-${index}`,
    ariaLabel: lineLabel,
    placeholder: "옵션 검색",
  });
  select.disabled = disabled;

  const valueWrap = element("div", "market-option-value");
  const value = numericControl(
    `market-${sectionKey}-value-${index}`,
    line.value,
    (next) => update(() => { state[sectionKey].lines[index].value = next; }),
    {
      max: spec.unit === "pct" ? "1000" : spec.unit === "seconds" ? "10" : "99999",
      placeholder: spec.value ? "" : "수치",
    },
  );
  value.disabled = disabled || !spec.value;
  value.setAttribute("aria-label", `${lineLabel} 수치`);
  valueWrap.append(value);
  if (spec.suffix) valueWrap.append(element("span", "market-option-value__unit", spec.suffix));

  const lineRow = element("div", "market-option-line");
  lineRow.append(select, valueWrap);
  return lineRow;
}

function potentialPanel(sectionKey, title) {
  const section = state[sectionKey];
  const meta = selectedItemMeta();
  const availability = market.potentialAvailability[sectionKey];
  const panel = element("section", "market-option-panel");
  panel.append(element("h3", "market-option-panel__title", title));
  const grade = searchableSelect(GRADES, section.grade, (value) => {
    section.grade = value;
    if (value === "none") section.lines = blankLines();
    save();
    refreshPotentialAvailability();
  }, { key: `market-${sectionKey}-grade` });
  grade.disabled = market.itemStatus !== "ready" || meta.potentialApplicable !== true;
  panel.append(field("등급", grade));
  const lines = element("div", "market-option-lines");
  const linesDisabled = section.grade === "none" || availability.status !== "ready";
  for (let index = 0; index < 3; index += 1) {
    lines.append(potentialLineControl(sectionKey, index, linesDisabled));
  }
  panel.append(lines);
  if (availability.status === "loading") {
    panel.append(note("공식 옵션 목록을 불러오는 중입니다.", "market-option-status"));
  } else if (["error", "missing"].includes(availability.status)) {
    const retry = element("button", "button market-retry", "다시 불러오기");
    retry.type = "button";
    retry.addEventListener("click", refreshPotentialAvailability);
    const message = element("div", "market-load-error");
    message.append(element("span", "", availability.error), retry);
    panel.append(message);
  } else if (availability.status === "unavailable") {
    panel.append(note("이 장비에는 잠재능력을 적용할 수 없습니다.", "market-option-status"));
  }
  return panel;
}

function potentialCard() {
  const grid = element("div", "market-potential-grid");
  grid.append(
    potentialPanel("potential", "윗잠"),
    potentialPanel("additional", "에디셔널"),
  );
  return card(
    "잠재능력 / 에디셔널",
    grid,
  );
}

function statPanel(bucket, title) {
  const meta = selectedItemMeta();
  const disabled = market.itemStatus !== "ready" ||
    (bucket === "scroll" ? meta.upgradeApplicable !== true : meta.flameApplicable !== true);
  const panel = element("section", "market-stat-panel");
  panel.append(element("h3", "market-stat-panel__title", title));
  const fields = element("div", "market-stat-fields");
  for (const definition of STAT_FIELDS) {
    const control = numericControl(
      `market-${bucket}-${definition.key}`,
      state[bucket][definition.key],
      (value) => update(() => { state[bucket][definition.key] = value; }),
      { max: String(definition.max), placeholder: "0" },
    );
    control.disabled = disabled;
    fields.append(field(
      definition.label,
      control,
    ));
  }
  if (bucket === "flame") {
    const reduction = numericControl(
      "market-required-level-reduction",
      state.requiredLevelReduction,
      (value) => update(() => {
        state.requiredLevelReduction = value === "" ? "" : Math.min(300, Math.round(value));
      }),
      { max: "300", placeholder: "0" },
    );
    reduction.disabled = disabled;
    fields.append(field(
      "착용 레벨 감소",
      reduction,
    ));
  }
  panel.append(fields);
  return panel;
}

function enhancementCard() {
  const grid = element("div", "market-enhancement-grid");
  grid.append(
    statPanel("scroll", "주문서"),
    statPanel("flame", "추가옵션"),
  );
  return card(
    "주문서 / 추가옵션",
    grid,
    note("장비의 최종 수치가 아니라 주문서와 추가옵션으로 각각 오른 수치만 입력하세요."),
    note("입력한 수치와 장비 정보를 바탕으로 제작법을 판별할 수 있을 때만 기댓값을 자동 계산합니다.", "market-expected-cost-note"),
  );
}

function manualCharacterSettings() {
  if (getActiveProfile()) return null;
  const special = state.statModel !== "standard";
  const settings = row(
    field(
      "주스탯",
      searchableSelect(MAIN_STAT_OPTIONS, state.mainStat, (value) => update(() => {
        state.mainStat = value;
        state.statModel = value === "ALL"
          ? "xenon"
          : value === "HP"
            ? "demon-avenger"
            : "standard";
        state.subStat = value === "HP" ? "STR" : DEFAULT_SUB_STAT[value] || "none";
        state.subStat2 = "none";
        state.attackType = value === "INT" ? "magic" : "attack";
      }), { key: "market-main-stat" }),
    ),
    field(
      "부스탯 1",
      (() => {
        const control = searchableSelect(
          [...STATS, { value: "none", label: "없음" }],
          state.subStat,
          (value) => update(() => { state.subStat = value; }),
          { key: "market-sub-stat" },
        );
        control.disabled = special;
        return control;
      })(),
    ),
    field(
      "부스탯 2",
      (() => {
        const control = searchableSelect(
          [...STATS, { value: "none", label: "없음" }],
          state.subStat2,
          (value) => update(() => { state.subStat2 = value; }),
          { key: "market-sub-stat-2" },
        );
        control.disabled = special;
        return control;
      })(),
    ),
    field(
      "공/마 선택",
      searchableSelect(
        [{ value: "attack", label: "공격력" }, { value: "magic", label: "마력" }],
        state.attackType,
        (value) => update(() => { state.attackType = value; }),
        { key: "market-attack-type" },
      ),
    ),
    field(
      "캐릭터 레벨",
      numericControl("market-character-level", state.characterLevel, (value) => update(() => {
        state.characterLevel = value === "" ? "" : Math.max(1, Math.min(300, Math.round(value)));
      }), { min: "1", max: "300" }),
    ),
  );
  settings.classList.add("profile-manual-settings");
  return settings;
}

function manualSpecialEquivalence() {
  if (state.statModel === "xenon") {
    return {
      statEquivalence: {
        flatMainStatToPercent: 0.1375,
        attackToMainStat: 5.5,
        allStatPercentToMainPercent: 2.475,
        flatStatToFlatMainStatByStat: { STR: 1, DEX: 1, INT: 0, LUK: 1 },
        statPercentToMainPercentByStat: { STR: 1, DEX: 1, INT: 0, LUK: 1 },
      },
      addOptionEquivalence: {
        flatStatToDamagePercent: { STR: 0.1375, DEX: 0.1375, INT: 0, LUK: 0.1375, HP: 0 },
        flatAttackToDamagePercent: 0.75625,
        allStatPercentToDamagePercent: 2.475,
        bossDamageToDamagePercent: 1,
      },
    };
  }
  if (state.statModel === "demon-avenger") {
    return {
      statEquivalence: {
        flatMainStatToPercent: 1 / 35,
        attackToMainStat: 140,
        allStatPercentToMainPercent: 0,
        flatStatToFlatMainStatByStat: { STR: 0.25, DEX: 0, INT: 0, LUK: 0 },
        statPercentToMainPercentByStat: { STR: 0, DEX: 0, INT: 0, LUK: 0 },
      },
      addOptionEquivalence: {
        flatStatToDamagePercent: { STR: 0.25, DEX: 0, INT: 0, LUK: 0, HP: 1 / 35 },
        flatAttackToDamagePercent: 4,
        allStatPercentToDamagePercent: 0,
        bossDamageToDamagePercent: 1,
      },
    };
  }
  return {};
}

function structuredPotential(section) {
  if (section.grade === "none") {
    return { collected: true, grade: "none", lines: [] };
  }
  const lines = section.lines.flatMap((line, index) => {
    const spec = OPTION_BY_VALUE.get(line.type);
    const value = Number(line.value);
    if (!spec?.value || !Number.isFinite(value) || value <= 0) return [];
    if (spec.code === "STAT_PER_CHARACTER_LEVEL") {
      return [{
        line_index: index + 1,
        code: spec.code,
        value: null,
        unit: null,
        params: {
          levels_per_increment: 9,
          stat_code: spec.stat,
          stat_value: value,
        },
      }];
    }
    return [{
      line_index: index + 1,
      code: spec.code,
      value,
      unit: spec.unit,
      params: {},
    }];
  });
  return { collected: true, grade: section.grade, lines };
}

function compactStats(source) {
  return Object.fromEntries(Object.entries(source)
    .map(([key, value]) => [key, Number(value)])
    .filter(([, value]) => Number.isFinite(value) && value > 0));
}

export function buildItemMarketTarget(input, itemMeta = {}) {
  const starforce = Number(input.starforce);
  const upgradeMaximum = itemMeta.upgradeMaximum !== null &&
    itemMeta.upgradeMaximum !== undefined &&
    itemMeta.upgradeMaximum !== "" &&
    Number.isInteger(Number(itemMeta.upgradeMaximum))
    ? Number(itemMeta.upgradeMaximum)
    : null;
  const scissorsRemaining = Number(input.scissorsRemaining);
  const scissorsTotal = Number(itemMeta.scissorsMaximum);
  const requiredLevelReduction = Number(input.requiredLevelReduction);
  const expectationMetadata = buildItemMarketExpectationMetadata(itemMeta);
  const scrollStats = itemMeta.upgradeApplicable === false ? {} : compactStats(input.scroll);
  const inferredUpgrade = itemMeta.upgradeApplicable === false
    ? { status: "not_applicable", applied: 0, remaining: 0, recoverable: 0, source: "scroll-stats" }
    : inferAutomaticScrollUpgradeState({
        target: {
          item: {
            ...expectationMetadata,
            upgrade: {
              max: Number.isInteger(upgradeMaximum) && upgradeMaximum >= 0
                ? upgradeMaximum
                : null,
            },
            stats: { scroll: scrollStats },
          },
        },
      });
  return {
    item: {
      name: input.itemName,
      ...expectationMetadata,
      base_price_meso: null,
      required_level_reduction: itemMeta.flameApplicable === false
        ? 0
        : Number.isInteger(requiredLevelReduction) && requiredLevelReduction >= 0
          ? requiredLevelReduction
          : 0,
      starforce: {
        value: itemMeta.starforceApplicable === false
          ? 0
          : Number.isInteger(starforce) && starforce >= 0 ? starforce : 0,
        applicable: itemMeta.starforceApplicable !== false,
      },
      upgrade: {
        max: itemMeta.upgradeApplicable === false
          ? 0
          : Number.isInteger(upgradeMaximum) && upgradeMaximum >= 0 ? upgradeMaximum : null,
        applied: itemMeta.upgradeApplicable === false
          ? 0
          : Number.isInteger(inferredUpgrade.applied) && inferredUpgrade.applied >= 0
            ? inferredUpgrade.applied
            : null,
        remaining: itemMeta.upgradeApplicable === false
          ? 0
          : Number.isInteger(inferredUpgrade.remaining) && inferredUpgrade.remaining >= 0
            ? inferredUpgrade.remaining
            : null,
        recoverable: itemMeta.upgradeApplicable === false
          ? 0
          : Number.isInteger(inferredUpgrade.recoverable) && inferredUpgrade.recoverable >= 0
            ? inferredUpgrade.recoverable
            : null,
        inference_source: inferredUpgrade.source,
        inference_status: inferredUpgrade.status,
      },
      trade: {
        state: input.tradeState || null,
        scissors_remaining: input.scissorsRemaining !== "" && Number.isInteger(scissorsRemaining)
          ? Math.max(0, scissorsRemaining)
          : null,
        scissors_total: Number.isInteger(scissorsTotal) && scissorsTotal > 0
          ? Math.max(0, scissorsTotal)
          : null,
      },
      stats: {
        base: {},
        starforce: {},
        scroll: scrollStats,
        flame: itemMeta.flameApplicable === false ? {} : compactStats(input.flame),
        other: {},
        total: {},
      },
      potential: itemMeta.potentialApplicable === false
        ? structuredPotential({ grade: "none", lines: [] })
        : structuredPotential(input.potential),
      additional_potential: itemMeta.potentialApplicable === false
        ? structuredPotential({ grade: "none", lines: [] })
        : structuredPotential(input.additional),
    },
  };
}

function withEstimatedMarketBase(target, result) {
  const estimatedBase = Number(result?.components?.base?.contribution_meso);
  if (!Number.isSafeInteger(estimatedBase) || estimatedBase <= 0) return target;
  return {
    ...target,
    item: {
      ...target.item,
      base_price_meso: estimatedBase,
      base_price_source: "same_item_market_model",
    },
  };
}

function confidenceBadge(level, score) {
  const badge = element(
    "span",
    "market-confidence",
    `가격 추정 신뢰도 ${Math.round((Number(score) || 0) * 100)}/100 · ${CONFIDENCE_LABELS[level] || "낮음"}`,
  );
  badge.dataset.level = level || "low";
  badge.title = "최신 거래를 따로 떼어 검증한 정확도와 계산 범위·가격요소 분리 가능성을 함께 반영한 점수입니다.";
  return badge;
}

function formatRecoveryPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${number.toLocaleString("ko-KR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: Math.abs(number) < 10 ? 2 : 1,
  })}%`;
}

const EXPECTATION_STAT_LABELS = Object.freeze({
  str_flat: "STR",
  dex_flat: "DEX",
  int_flat: "INT",
  luk_flat: "LUK",
  hp_flat: "HP",
  mp_flat: "MP",
  attack_flat: "공격력",
  magic_attack_flat: "마력",
  defense_flat: "방어력",
  speed_flat: "이동속도",
  jump_flat: "점프력",
});

function expectationEvidenceText(expectation) {
  if (Array.isArray(expectation?.evidence)) {
    return expectation.evidence.filter(Boolean).join(" · ");
  }
  const evidence = expectation?.evidence;
  if (!evidence || typeof evidence !== "object") return "";
  const parts = [];
  if (Number.isInteger(Number(evidence.applied))) {
    parts.push(`적용 ${Number(evidence.applied)}작`);
  }
  const stats = evidence.matched_scroll_stats;
  if (stats && typeof stats === "object") {
    const summary = Object.entries(stats)
      .filter(([, value]) => Number.isFinite(Number(value)) && Number(value) > 0)
      .map(([key, value]) => `${EXPECTATION_STAT_LABELS[key] || key} +${Number(value)}`)
      .join(" / ");
    if (summary) parts.push(summary);
  }
  return parts.join(" · ");
}

function componentExpectationFooter(component) {
  const expectation = component?.expectation || {};
  const footer = element("div", "market-component__expectation");
  footer.dataset.expectationStatus = expectation.status || "unavailable";
  footer.title = expectation.basis || "";
  const cost = Number(expectation.expected_cost_meso);
  const recovery = Number(expectation.recovery_percent);
  const method = expectation.method_label || expectation.method || "";
  const evidence = expectationEvidenceText(expectation);
  const inference =
    (method ? ` · 판별 ${method}` : "") +
    (evidence ? ` · 근거 ${evidence}` : "");
  let label;
  let value = "—";

  if (expectation.status === "calculated" && Number.isFinite(cost) && cost > 0) {
    label = `제작 기댓값 ${formatMeso(cost)}` +
      (Number(expectation.ignored_lines) > 0 ? ` · 무효 ${expectation.ignored_lines}줄 제외` : "") +
      inference;
    value = component.market_allocation?.method === "shared_expected_cost_recovery"
      ? `기댓값 대비 약 ${formatRecoveryPercent(recovery)}`
      : component.identifiable === false
        ? "시장 반영액 분리 불가"
        : `기댓값 대비 ${formatRecoveryPercent(recovery)}`;
  } else if (expectation.status === "excluded") {
    label = "이 장비에 유효한 옵션 없음 · 기댓값 제외";
  } else if (expectation.status === "not_applicable") {
    label = expectation.basis || "적용된 강화 없음";
  } else {
    label = `제작 기댓값 산출 불가${expectation.basis ? ` · ${expectation.basis}` : ""}` +
      inference;
  }

  footer.append(
    element("span", "market-component__expected-cost", label),
    element("strong", "market-component__recovery", value),
  );
  return footer;
}

function componentBreakdown(result) {
  const list = element("div", "market-components");
  for (const key of result.component_order || Object.keys(COMPONENT_LABELS)) {
    const component = result.components?.[key];
    if (!component) continue;
    const item = element("div", "market-component");
    item.dataset.confidence = component.confidence || "low";
    item.dataset.identifiable = String(component.identifiable !== false);
    const identifiable = component.identifiable !== false;
    const sharedAllocation = component.market_allocation?.method ===
      "shared_expected_cost_recovery";
    const copy = element("div", "market-component__copy");
    copy.append(
      element("strong", "market-component__label", COMPONENT_LABELS[key] || component.label || key),
      element(
        "span",
        "market-component__range",
        sharedAllocation
          ? "합산 가격을 제작 기댓값 비중으로 배분"
          : !identifiable
          ? "개별 가격 분리 불가"
          : component.range_meso?.low === null
          ? "분리 추정 불가"
          : `${formatMeso(component.range_meso.low)} ~ ${formatMeso(component.range_meso.high)}`,
      ),
    );
    const value = element(
      "strong",
      "market-component__value",
      sharedAllocation
        ? `배분 추정치 ${formatMeso(component.contribution_meso)}`
        : !identifiable
        ? `참고 추정치 ${formatMeso(component.contribution_meso)}`
        : component.contribution_meso === null
          ? "-"
          : formatMeso(component.contribution_meso),
    );
    item.append(copy, value, componentExpectationFooter(component));
    list.append(item);
  }
  return list;
}

function warningList(warnings) {
  if (!warnings?.length) return null;
  const hiddenCodes = new Set([
    "default_conversion_profile",
    "external_base_price_anchor",
  ]);
  const componentCodes = new Set([
    "base_component_unidentified",
    "component_unidentified",
    "component_confounded",
    "component_temporally_unstable",
    "component_extrapolated",
    "prediction_feature_capped",
  ]);
  const reliabilityCodes = new Set([
    "small_sample",
    "temporal_validation_unavailable",
    "temporal_validation_weak",
  ]);
  const severityRank = { low: 0, medium: 1, high: 2 };
  const highestSeverity = (items) => items.reduce(
    (picked, item) => (severityRank[item.severity] || 0) > (severityRank[picked] || 0)
      ? item.severity
      : picked,
    "medium",
  );
  const componentNames = (items) => {
    const names = [...new Set(items
      .map((warning) => COMPONENT_LABELS[warning.component])
      .filter(Boolean))];
    if (names.length <= 4) return names.join("·");
    return `${names.slice(0, 4).join("·")} 외 ${names.length - 4}개`;
  };
  const visible = warnings.filter((warning) => !hiddenCodes.has(warning.code));
  const componentWarnings = visible.filter((warning) => componentCodes.has(warning.code));
  const reliabilityWarnings = visible.filter((warning) => reliabilityCodes.has(warning.code));
  // 옵션 판독 누락과 검색 가격 하한처럼 사용자가 바로 확인해야 하는 경고는
  // 원문을 유지한다. 나머지 모델 진단은 같은 원인의 문장을 반복하지 않는다.
  const publicWarnings = visible
    .filter((warning) => !componentCodes.has(warning.code) && !reliabilityCodes.has(warning.code));
  if (componentWarnings.length) {
    const names = componentNames(componentWarnings);
    publicWarnings.push({
      code: "component_estimation_limited",
      severity: highestSeverity(componentWarnings),
      message: `${names ? `${names} 등 일부 요소는` : "일부 강화 요소는"} 계산 범위를 벗어나거나 가격 효과를 따로 분리하기 어려워 보수적으로 반영했습니다.`,
    });
  }
  if (reliabilityWarnings.length) {
    publicWarnings.push({
      code: "market_estimation_uncertain",
      severity: highestSeverity(reliabilityWarnings),
      message: "거래가 적거나 시점별 가격 검증이 충분하지 않아 예상 거래 범위를 넓게 봐야 합니다.",
    });
  }
  if (!publicWarnings.length) return null;
  const list = element("ul", "market-warnings");
  for (const warning of publicWarnings.slice(0, 3)) {
    const item = element(
      "li",
      "market-warning",
      warning.message || String(warning),
    );
    item.dataset.severity = warning.severity || "medium";
    list.append(item);
  }
  return list;
}

function isBetaMarketModel() {
  return market.manifest?.model?.promoted !== true;
}

function marketResultTitle() {
  return `경매장 적정가 추정${isBetaMarketModel() ? " · 베타" : ""}`;
}

function formatEquivalent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return `${number.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%급`;
}

function equivalenceBlock(title, caption, components, kind) {
  if (!components) return null;
  const block = element("section", "market-equivalence");
  block.dataset.kind = kind;
  block.append(
    element("strong", "market-equivalence__title", title),
    element("span", "market-equivalence__caption", caption),
  );
  const values = element("div", "market-equivalence__values");
  for (const [label, key] of [
    ["윗잠", "potential_options_main_stat_percent"],
    ["에디", "additional_options_main_stat_percent"],
    ["주문서", "scroll_main_stat_percent"],
    ["추옵", "flame_main_stat_percent"],
  ]) {
    const value = element("span", "market-equivalence__value");
    value.append(
      element("small", "", label),
      element("b", "", formatEquivalent(components[key])),
    );
    values.append(value);
  }
  block.append(values);
  return block;
}

function equivalenceComparison(result) {
  const normalization = result.normalization || {};
  const marketComponents = normalization.market_equivalence?.target_components ||
    normalization.market_target_components || normalization.target_components;
  const personal = normalization.personal_equivalence || null;
  const active = getActiveProfile();
  const comparison = element("div", "market-equivalence-grid");
  const blocks = [
    equivalenceBlock(
      "시장 기준 환산",
      "적정가 계산에 사용하는 공통 정옵 기준",
      marketComponents,
      "market",
    ),
    equivalenceBlock(
      "내 캐릭터 기준 환산",
      active?.character?.name
        ? `${active.character.name} · 풀 보스 도핑 기준`
        : `${state.mainStat} 수동 설정 기준`,
      personal?.target_components,
      "personal",
    ),
  ].filter(Boolean);
  comparison.append(...blocks);
  return comparison.childElementCount ? comparison : null;
}

function statFamilyComparison(comparison) {
  if (!comparison?.current || !Number.isFinite(Number(comparison.current.estimate_meso))) {
    return null;
  }
  const rows = (comparison.comparisons || []).filter((entry) =>
    entry?.status === "estimated" && Number.isFinite(Number(entry.estimate_meso))
  );
  if (!rows.length) return null;

  const block = element("section", "market-stat-comparison");
  const heading = element("div", "market-stat-comparison__heading");
  const usesPeerItems = comparison.comparison_mode === "job_peer_items";
  block.dataset.mode = comparison.comparison_mode || "same_item_stat_swap";
  heading.append(
    element("strong", "", "타스탯 동급 매물 대비"),
    element(
      "span",
      "",
      usesPeerItems
        ? "같은 세트·부위의 직업별 장비"
        : `현재 ${comparison.current_family} 계열 기준`,
    ),
  );
  const list = element("div", "market-stat-comparison__list");
  const currentEstimate = Number(comparison.current.estimate_meso);
  for (const entry of rows) {
    const otherEstimate = Number(entry.estimate_meso);
    const currentDelta = currentEstimate - otherEstimate;
    const relation = currentDelta < 0
      ? "cheaper"
      : currentDelta > 0
        ? "more-expensive"
        : "same";
    const copy = relation === "same"
      ? "현재 장비와 가격 차이 없음"
      : `현재 장비가 ${formatMeso(Math.abs(currentDelta))} ${relation === "cheaper" ? "저렴" : "비쌈"}`;
    const rowElement = element("div", "market-stat-comparison__row");
    rowElement.dataset.relation = relation;
    const identity = element("span", "market-stat-comparison__identity");
    const peerItemName = entry.metadata?.item_name;
    const peerJob = entry.metadata?.job_label || entry.metadata?.required_job;
    identity.append(
      element(
        "strong",
        "",
        usesPeerItems && peerItemName
          ? `${peerJob ? `${peerJob} ` : ""}${entry.family} · ${peerItemName}`
          : `${entry.family} 동급`,
      ),
      element("small", "", `추정가 ${formatMeso(otherEstimate)}`),
    );
    rowElement.append(identity, element("b", "market-stat-comparison__delta", copy));
    list.append(rowElement);
  }
  block.append(heading, list);
  return block;
}

function resultPlaceholder(message, tone = "") {
  const section = createResultCard(marketResultTitle());
  const empty = element("div", "result-empty", message);
  if (tone) empty.dataset.tone = tone;
  section.append(empty);
  return section;
}

function resultCard() {
  if (!state.itemName) return resultPlaceholder("장비를 선택하면 옵션별 시장 반영액을 계산합니다.");
  if (market.itemStatus === "loading") return resultPlaceholder("시세 계산을 준비하는 중입니다.");
  if (market.itemStatus === "error") return resultPlaceholder(market.error, "error");
  if (!market.data) return resultPlaceholder("현재 이 장비의 시세를 계산할 수 없습니다.", "error");
  for (const sectionKey of ["potential", "additional"]) {
    if (state[sectionKey].grade === "none") continue;
    const availability = market.potentialAvailability[sectionKey];
    if (availability.status === "loading" || availability.status === "idle") {
      return resultPlaceholder("공식 잠재 옵션 목록을 불러오는 중입니다.");
    }
    if (availability.status !== "ready") {
      return resultPlaceholder(
        availability.error || "공식 잠재 옵션 목록을 확인할 수 없습니다.",
        "error",
      );
    }
  }

  const profile = getCalculationProfile({
    mainStat: state.mainStat,
    subStat: state.subStat,
    subStats: [state.subStat, state.subStat2].filter((stat) => stat && stat !== "none"),
    attackType: state.attackType,
    statModel: state.statModel,
    characterLevel: Number(state.characterLevel) || 290,
    ...manualSpecialEquivalence(),
  });
  const target = buildItemMarketTarget(state, selectedItemMeta());
  let result;
  try {
    result = estimateItemMarketValue({
      target,
      comparables: market.data,
      profile,
    });
  } catch (error) {
    return resultPlaceholder(error?.message || "현재 입력으로 시세를 추정할 수 없습니다.", "error");
  }
  if (result.status !== "estimated") {
    const firstWarning = result.warnings?.[0]?.message;
    return resultPlaceholder(firstWarning || "현재 이 장비의 시세를 계산할 수 없습니다.", "error");
  }

  let statComparison = null;
  try {
    const currentMarketResult = result;
    const usesPeerItems = market.statPeerGroup?.mode === "job_specific_peer_items";
    const peerItemsByFamily = Object.fromEntries(
      Object.keys(market.statPeerGroup?.peers || {}).flatMap((family) => {
        const data = market.statPeerData?.[family];
        const item = representativeItemFromData(data);
        return item ? [[family, item]] : [];
      }),
    );
    const additionalPeerVariants = (market.statPeerGroup?.additional_peers || []).flatMap(
      (peer) => {
        const item = representativeItemFromData(market.statPeerData?.[peer.key]);
        return item ? [{ ...peer, peerTarget: item }] : [];
      },
    );
    if (!usesPeerItems || Object.keys(peerItemsByFamily).length > 0) {
      statComparison = compareItemMarketStatFamilies({
        target,
        peerItemsByFamily: usesPeerItems ? peerItemsByFamily : undefined,
        additionalPeerVariants: usesPeerItems ? additionalPeerVariants : undefined,
        selectedItemFamily: usesPeerItems
          ? market.statPeerGroup.selected_item_family
          : undefined,
        estimator(counterfactualTarget, context) {
          if (context.is_current) return currentMarketResult;
          const comparables = usesPeerItems
            ? market.statPeerData[context.peer_key || context.identity_family]
            : market.data;
          if (!comparables) return { status: "insufficient_data" };
          return estimateItemMarketValue({
            target: counterfactualTarget,
            comparables,
            profile,
          });
        },
      });
    }
  } catch {
    // 명시적인 STR·DEX·INT·LUK 계열이 없거나 비교가 불가능해도 본 계산은 유지한다.
  }

  try {
    const preset = starforcePresetFor(state.itemName, selectedItemMeta());
    const expectationTarget = withEstimatedMarketBase(target, result);
    const expectations = calculateItemMarketExpectedCosts({
      target: expectationTarget,
      potentialTables: market.potentialTables.potential,
      additionalTables: market.potentialTables.additional,
      starforceSettings: savedStarforceExpectedSettings(),
      singleSpare: preset?.npcSpare === true,
    });
    result = allocateSharedExpectedCostRecovery(result, expectations.components);
    result = {
      ...result,
      components: attachExpectedCostRecovery(result.components, expectations.components),
      crafting_expectation: expectations,
    };
  } catch {
    // 제작 기댓값 보조 계산이 실패해도 경매장 적정가 자체는 계속 보여 준다.
  }

  const section = createResultCard(marketResultTitle());
  section.classList.add("market-result-card");
  const confidence = result.confidence || {};
  const rangeText = `${formatMeso(result.range_meso.low)} ~ ${formatMeso(result.range_meso.high)}`;
  const hero = resultHero(
    `추정 적정가${isBetaMarketModel() ? " (베타)" : ""}`,
    formatMeso(result.estimate_meso),
  );
  hero.classList.add("market-result-hero");
  const range = element("p", "market-result-range");
  range.append(
    element("span", "", "예상 거래 범위"),
    element("strong", "", rangeText),
  );
  const summary = element("div", "market-result-summary");
  summary.append(hero, range);
  const heading = element("div", "market-result-heading");
  heading.append(summary, confidenceBadge(confidence.level, confidence.score));
  const componentSum = (result.component_order || Object.keys(COMPONENT_LABELS))
    .reduce((sum, key) => sum + (Number(result.components?.[key]?.contribution_meso) || 0), 0);
  const sumMatches = componentSum === Number(result.estimate_meso);
  const sumLine = resultLine(
    sumMatches ? "구성요소 합계" : "구성요소 합계 확인 필요",
    formatMeso(componentSum),
    true,
  );
  sumLine.classList.add("market-component-sum");
  sumLine.dataset.matches = String(sumMatches);
  section.append(...[
    heading,
    statFamilyComparison(statComparison),
    equivalenceComparison(result),
    element("h3", "market-result-subtitle", "구성요소별 시장 반영액"),
    note("기댓값 대비 비율 = 해당 요소의 시장 반영액 ÷ 제작 기댓값", "market-recovery-formula"),
    componentBreakdown(result),
    sumLine,
  ].filter(Boolean));
  const warnings = warningList(result.warnings);
  if (warnings) {
    section.append(element("h3", "market-result-subtitle", "추정 시 주의"), warnings);
  }
  return section;
}

function render() {
  const grid = element("div", "calculator-grid calculator-grid--item-market");
  const controls = element("div", "calculator-column");
  const equipment = equipmentCard();
  equipment.classList.add("calculator-equipment");
  const potentials = potentialCard();
  potentials.classList.add("calculator-market-options");
  const enhancements = enhancementCard();
  enhancements.classList.add("calculator-market-enhancement");
  const profile = characterProfileCard({ extraContent: manualCharacterSettings() });
  profile.classList.add("calculator-profile");
  controls.append(
    equipment,
    potentials,
    enhancements,
    profile,
  );
  const result = element("aside", "calculator-result");
  result.append(resultCard());
  grid.append(controls, result);
  renderWithFocus(root, [grid]);
}

const unsubscribe = subscribeCharacterProfile(render);
window.addEventListener("pagehide", unsubscribe, { once: true });
render();
loadCatalog();
