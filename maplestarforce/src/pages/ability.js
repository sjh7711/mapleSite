import { calculatorStorage, isSharedResult, getSharedResultView, registerResultShare } from "../shared/result-share-state.js";
import {
  ABILITY_GRADES,
  ABILITY_RESET_METHODS,
  calculateAbilityAttemptsForChance,
  calculateAbilityExpected,
  calculateAbilityAbyssAttemptsForChance,
  calculateAbilityAbyssChanceWithin,
  chooseAbilityAbyssResult,
  chooseAbilityEconomicAction,
  chooseFlexibleAbilityStart,
  getAbilityOption,
  getAbilityTargetOptions,
  getAbilityTargetValues,
} from "maple-core/ability";
import {
  ABILITY_JOB_PRESETS,
} from "../data/ability-job-presets.js";
import { getAdvancedAbilityBossTargets } from "../data/ability-advanced-boss-presets.js";
import {
  card,
  cardWithHead,
  chipRow,
  createReachChanceControl,
  element,
  formatAttempts,
  formatMeso,
  formatProbability,
  metric,
  metricGrid,
  note,
  renderWithFocus,
  resetAction,
  resultCard as createResultCard,
  resultLine,
  searchableSelect,
} from "../shared/calculator-ui.js";
import { renderToolNav } from "../shared/shell.js";
import { chip, field, numberInput, toggleChip } from "../shared/ui.js";
import { formatHonorAmount } from "../shared/korean-large-number.js";

import { abilityRouteBreakdownForChance, abilityRouteUsesForChance, abilityRouteFinishCostForChance } from "maple-core/ability-route-reach";
import { abilityPracticalGuide } from "../shared/ability-practical-guide.js";

const STORAGE_KEY = "maplestarforce:ability:v2";
const PRACTICAL_ENABLED = import.meta.env.VITE_ABILITY_PRACTICAL_ENABLED === "true";
let selectedComparison = null, selectedRouteId = "";
let initialSharedRouteId = getSharedResultView().routeId ?? "";
let routeComparisonCard = null;

const TARGET_CHANCE_DEFAULT = 80;
const TARGET_CHANCE_MIN = 0.01;
const TARGET_CHANCE_MAX = 99.99;
const LINE_NAMES = ["첫 번째 줄", "두 번째 줄", "세 번째 줄"];
const JOB_USAGE_BY_ID = new Map(ABILITY_JOB_PRESETS.map((job) => [job.id, job]));
const POPULAR_TYPES_BY_LINE = [
  [
    "boss-damage",
    "cooldown-skip",
    "passive-level",
    "buff-duration",
    "item-drop",
    "meso-drop",
    "abnormal-damage",
    "critical",
    "attack",
    "magic",
    "max-hp-percent",
    "attack-speed",
    "normal-damage",
  ],
  [
    "abnormal-damage",
    "boss-damage",
    "passive-level",
    "buff-duration",
    "critical",
    "cooldown-skip",
    "attack",
    "magic",
    "item-drop",
    "meso-drop",
    "max-hp-percent",
    "attack-speed",
    "normal-damage",
  ],
  [
    "abnormal-damage",
    "boss-damage",
    "passive-level",
    "buff-duration",
    "critical",
    "cooldown-skip",
    "attack",
    "magic",
    "item-drop",
    "meso-drop",
    "max-hp-percent",
    "attack-speed",
    "normal-damage",
  ],
];

const defaults = {
  method: "optimal",
  useAdvanced: false,
  allowMiracle: true,
  allowBlackChaos: true,
  allowAbyss: true,
  miracleCount: 0,
  blackCount: 0,
  chaosCount: 0,
  abyssCount: 0,
  honorPriceMan: 300,
  abyssPriceEok: 2.2,
  swapLower: true,
  halfHonor: false,
  targetChancePercent: TARGET_CHANCE_DEFAULT,
  targetChanceAverage: true,
  routeChancePercent: 80,
  routeChanceAverage: true,
  routeChanceDefaultVersion: 1,
  job: "",
  presetMode: "",
  targets: [
    { type: "", minimum: 0, grade: "legendary", locked: false },
    { type: "", minimum: 0, grade: "unique", locked: false },
    { type: "", minimum: 0, grade: "unique", locked: false },
  ],
};

function safeLoad() {
  try {
    const saved = JSON.parse(calculatorStorage.getItem(STORAGE_KEY));
    // Ordinary visits start in optimal strategy; shared links retain their chosen method.
    return saved && typeof saved === "object"
      ? { ...structuredClone(defaults), ...saved, method: isSharedResult() ? saved.method : defaults.method, useAdvanced: isSharedResult() ? saved.useAdvanced : defaults.useAdvanced,
        allowBlackChaos: typeof saved.allowBlackChaos === "boolean" ? saved.allowBlackChaos
          : saved.allowBlack !== false || saved.allowChaos !== false,
        // Migrate the old automatic 80% default once; retain later user choices.
        routeChanceAverage: saved.routeChanceDefaultVersion === 1 ? saved.routeChanceAverage !== false : true,
        routeChanceDefaultVersion: 1 }
      : structuredClone(defaults);
  } catch {
    return structuredClone(defaults);
  }
}

function safeSave(value) {
  try {
    calculatorStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // 저장이 막힌 환경에서는 현재 탭에서만 유지한다.
  }
}

const state = safeLoad();
state.method = state.method === "chaos"
  ? "black"
  : ABILITY_RESET_METHODS[state.method] ? state.method : defaults.method;
state.useAdvanced = state.useAdvanced === true;
state.swapLower = state.swapLower !== false;
state.halfHonor = Boolean(state.halfHonor);
state.allowMiracle = state.allowMiracle !== false;
state.allowBlackChaos = state.allowBlackChaos !== false;
state.allowAbyss = state.allowAbyss !== false;
state.miracleCount = normalizeInventory(state.miracleCount);
state.blackCount = normalizeInventory(state.blackCount);
state.chaosCount = normalizeInventory(state.chaosCount);
state.abyssCount = normalizeInventory(state.abyssCount);
state.honorPriceMan = Number.isFinite(Number(state.honorPriceMan))
  ? Math.max(0, Number(state.honorPriceMan)) : defaults.honorPriceMan;
state.abyssPriceEok = Number.isFinite(Number(state.abyssPriceEok)) ? Math.max(0, Number(state.abyssPriceEok)) : defaults.abyssPriceEok;
state.job = JOB_USAGE_BY_ID.has(state.job) ? state.job : "";
state.presetMode = ["boss", "boss-legendary", "hunt"].includes(state.presetMode) ? state.presetMode : "";
state.targetChancePercent = normalizeTargetChance(state.targetChancePercent);
state.targetChanceAverage = state.targetChanceAverage !== false;
state.routeChancePercent = normalizeTargetChance(state.routeChancePercent ?? 80);
state.routeChanceAverage = state.routeChanceAverage === true;
for (const key of ["bossHonorPriceMan", "miraclePrice", "blackPrice", "chaosPrice", "allowBlack", "allowChaos"]) {
  delete state[key];
}
state.targets = Array.from({ length: 3 }, (_, line) => {
  const target = Array.isArray(state.targets) ? state.targets[line] : null;
  const grade = line === 0
    ? "legendary"
    : target?.grade === "legendary" ? "legendary" : target?.grade === "epic" ? "epic" : "unique";
  const targetMethod = line > 0 && grade === "legendary" ? "advanced" : state.method;
  const type = targetOptionsFor(line, targetMethod, grade).some(
    (entry) => entry.id === target?.type,
  )
    ? target.type
    : "";
  const values = type ? targetValuesFor(type, line, targetMethod, grade) : [];
  const minimum = values.includes(Number(target?.minimum))
    ? Number(target.minimum)
    : values.at(-1) ?? 0;
  return {
    type,
    minimum,
    grade: inferTargetGrade(type, line, targetMethod, minimum, grade),
    locked: ["honor", "advanced"].includes(state.method) && Boolean(type) && Boolean(target?.locked),
  };
});
safeSave(state);
let pendingPresetPlacement = "";

renderToolNav(document.querySelector("#toolnav"), "ability");
const root = document.querySelector("#tool");
const OPTIMAL_STRATEGY_CACHE_LIMIT = 16;
const optimalStrategyCache = new Map();
let optimalStrategyWorker = null;
let optimalStrategyPendingKey = "";
let optimalStrategyErrorKey = "";
let optimalStrategyErrorMessage = "";
let optimalStrategyRequestId = 0;

function stopOptimalStrategyWorker() {
  optimalStrategyWorker?.terminate();
  optimalStrategyWorker = null;
  optimalStrategyPendingKey = "";
}

function cacheOptimalStrategy(key, result) {
  if (optimalStrategyCache.has(key)) optimalStrategyCache.delete(key);
  optimalStrategyCache.set(key, result);
  if (optimalStrategyCache.size > OPTIMAL_STRATEGY_CACHE_LIMIT) {
    optimalStrategyCache.delete(optimalStrategyCache.keys().next().value);
  }
}

function requestOptimalStrategy(options) {
  const key = JSON.stringify(options);
  const cached = optimalStrategyCache.get(key);
  if (cached) {
    cacheOptimalStrategy(key, cached);
    if (optimalStrategyPendingKey !== key) stopOptimalStrategyWorker();
    return { status: "ready", result: cached };
  }
  if (key === optimalStrategyErrorKey) {
    if (optimalStrategyPendingKey !== key) stopOptimalStrategyWorker();
    return { status: "error", message: optimalStrategyErrorMessage };
  }
  if (key === optimalStrategyPendingKey && optimalStrategyWorker) {
    return { status: "loading" };
  }

  stopOptimalStrategyWorker();
  const requestId = ++optimalStrategyRequestId;
  let worker;
  try {
    worker = new Worker(
      new URL("../workers/ability-optimal.worker.js", import.meta.url),
      { type: "module", name: "ability-optimal-strategy" },
    );
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  optimalStrategyWorker = worker;
  optimalStrategyPendingKey = key;
  optimalStrategyErrorKey = "";
  optimalStrategyErrorMessage = "";
  worker.onmessage = ({ data }) => {
    if (
      worker !== optimalStrategyWorker ||
      data?.requestId !== requestId ||
      data?.key !== key
    ) return;
    stopOptimalStrategyWorker();
    if (data.error) {
      optimalStrategyErrorKey = key;
      optimalStrategyErrorMessage = data.error;
    } else {
      cacheOptimalStrategy(key, data.result);
    }
    render();
  };
  worker.onerror = (event) => {
    if (worker !== optimalStrategyWorker) return;
    event.preventDefault();
    stopOptimalStrategyWorker();
    optimalStrategyErrorKey = key;
    optimalStrategyErrorMessage = event.message || "최적 전략을 계산하지 못했습니다.";
    render();
  };
  worker.postMessage({ requestId, key, options });
  return { status: "loading" };
}

function normalizeTargetChance(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return TARGET_CHANCE_DEFAULT;
  return Math.max(TARGET_CHANCE_MIN, Math.min(TARGET_CHANCE_MAX, numeric));
}

function normalizeInventory(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function averageEquivalentTargetChancePercent(probability) {
  if (!Number.isFinite(probability) || probability <= 0) return TARGET_CHANCE_DEFAULT;
  if (probability >= 1) return TARGET_CHANCE_MAX;
  const expectedResets = 1 / probability;
  const chance = 1 - ((1 - probability) ** expectedResets);
  return normalizeTargetChance(Number((chance * 100).toFixed(2)));
}

function update(mutator) {
  mutator();
  safeSave(state);
  render();
}

function resetTargets() {
  state.targets = structuredClone(defaults.targets);
  state.swapLower = true;
  state.presetMode = "";
}

function valueOnlyMethod(method = state.method) {
  return Boolean(ABILITY_RESET_METHODS[method]?.valueOnly);
}

function probabilityMethod(method = state.method) {
  return method === "optimal" ? (state.useAdvanced ? "advanced" : "honor") : method;
}

function lowerLegendaryMethod(method = state.method) {
  return Boolean(ABILITY_RESET_METHODS[probabilityMethod(method)]?.lowerLegendary);
}

function circulatorBlocked(method) {
  if (method === "abyss" && state.method === "optimal" && !state.useAdvanced) return true;
  // These goals require lower legendary lines, on which Black/Chaos cannot be used.
  return ["black", "chaos"].includes(method) && lowerLegendaryMethod() &&
    state.targets.slice(1).some((target) => target.type && target.grade === "legendary");
}

function circulatorAllowed(method) {
  return state[circulatorSettingKey(method)] && !circulatorBlocked(method);
}

function circulatorSettingKey(method) {
  return ["black", "chaos"].includes(method) ? "allowBlackChaos" : `allow${method[0].toUpperCase()}${method.slice(1)}`;
}

function circulatorToggle(method, label) {
  const key = circulatorSettingKey(method);
  const blocked = circulatorBlocked(method);
  const button = toggleChip(label, circulatorAllowed(method), () => update(() => {
    state[key] = !state[key];
  }), blocked);
  button.dataset.key = `ability-allow-${method}`;
  if (blocked) button.title = method === "abyss"
    ? "심서큘은 고급 재설정 전략에서 사용합니다."
    : "두 번째·세 번째 줄에 레전드리 목표가 있으면 사용할 수 없습니다.";
  return button;
}

function targetOptionsFor(line, method = state.method, grade = null) {
  method = probabilityMethod(method);
  if ((!valueOnlyMethod(method) && !lowerLegendaryMethod(method)) || Number(line) === 0) {
    return getAbilityTargetOptions(line, method, grade);
  }
  const byId = new Map();
  for (const currentGrade of lowerLegendaryMethod(method) ? ["legendary", "unique", "epic"] : ["unique", "epic"]) {
    for (const option of getAbilityTargetOptions(line, method, currentGrade)) {
      byId.set(option.id, option);
    }
  }
  return [...byId.values()];
}

function targetValuesFor(type, line, method = state.method, grade = null) {
  method = probabilityMethod(method);
  if ((!valueOnlyMethod(method) && !lowerLegendaryMethod(method)) || Number(line) === 0) {
    return getAbilityTargetValues(type, line, method, grade);
  }
  return [...new Set([
    ...(lowerLegendaryMethod(method) ? getAbilityTargetValues(type, line, method, "legendary") : []),
    ...getAbilityTargetValues(type, line, method, "epic"),
    ...getAbilityTargetValues(type, line, method, "unique"),
  ])].sort((left, right) => left - right);
}

function inferTargetGrade(type, line, method, minimum, fallback = "unique") {
  method = probabilityMethod(method);
  if (Number(line) === 0) return "legendary";
  if (lowerLegendaryMethod(method)) {
    const grades = ["legendary", "unique", "epic"];
    if (grades.includes(fallback) && getAbilityTargetValues(type, line, method, fallback).includes(Number(minimum))) return fallback;
    return grades.find((grade) => getAbilityTargetValues(type, line, method, grade).includes(Number(minimum))) ?? "legendary";
  }
  if (!valueOnlyMethod(method) || !type) return fallback === "epic" ? "epic" : "unique";
  const uniqueValues = getAbilityTargetValues(type, line, method, "unique");
  return uniqueValues.includes(Number(minimum)) ? "unique" : "epic";
}

function targetValueOptions(type, line, values, optionInfo) {
  if (lowerLegendaryMethod() && Number(line) > 0) {
    return ["legendary", "unique", "epic"].flatMap((grade) =>
      [...getAbilityTargetValues(type, line, probabilityMethod(), grade)].sort((a, b) => b - a).map((value) => ({
        value: `${grade}:${value}`, label: `${value}${optionInfo?.unit ?? ""} 이상`,
        group: ABILITY_GRADES[grade].label, groupTone: grade,
      })),
    );
  }
  const gradeOrder = Number(line) === 0 ? ["legendary"] : probabilityMethod() === "advanced" ? ["legendary", "unique", "epic"] : ["unique", "epic"];
  const availableByGrade = new Map(gradeOrder.map((grade) => [
    grade,
    new Set(getAbilityTargetValues(type, line, probabilityMethod() === "advanced" ? "advanced" : "black", grade).map(Number)),
  ]));
  const groups = new Map();

  [...values].sort((left, right) => right - left).forEach((value) => {
    const grades = gradeOrder.filter((grade) => availableByGrade.get(grade)?.has(Number(value)));
    const groupKey = grades.join("-") || "other";
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        label: grades.map((grade) => ABILITY_GRADES[grade]?.label).filter(Boolean).join(" · "),
        tone: grades.length === 1 ? grades[0] : "mixed",
        options: [],
      });
    }
    const valueLabel = optionInfo?.unit === "단계"
      ? `${value}단계 이상`
      : `${value}${optionInfo?.unit ?? ""} 이상`;
    groups.get(groupKey).options.push({ value, label: valueLabel });
  });

  return [...groups.values()].flatMap((group) => group.options.map((option) => ({
    ...option,
    group: group.label,
    groupTone: group.tone,
  })));
}

function sortedTargetOptions(line, grade) {
  const popular = POPULAR_TYPES_BY_LINE[line];
  const priority = new Map(popular.map((type, index) => [type, index]));
  return [...targetOptionsFor(line, state.method, grade)].sort((a, b) => {
    const aRank = priority.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bRank = priority.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;
    return a.label.localeCompare(b.label, "ko-KR");
  });
}

function targetRow(line) {
  const target = state.targets[line];
  const isValueOnly = valueOnlyMethod();
  const selectedElsewhere = new Set(
    state.targets
      .filter((_, index) => index !== line)
      .map((entry) => entry.type)
      .filter(Boolean),
  );
  const typeOptions = [
    { value: "", label: "선택 안 함" },
    ...sortedTargetOptions(line, target.grade).map((entry) => ({
      value: entry.id,
      label: entry.label,
      disabled: selectedElsewhere.has(entry.id),
    })),
  ];
  // An advanced toggle changes available methods, never the user's targets.
  if (target.type && !typeOptions.some((option) => option.value === target.type)) {
    typeOptions.push({ value: target.type, label: getAbilityOption(target.type)?.label ?? target.type, disabled: true });
  }
  const type = searchableSelect(typeOptions, target.type, (next) => {
    update(() => {
      state.presetMode = "";
      const values = next
        ? targetValuesFor(next, line, state.method, target.grade)
        : [];
      const minimum = values.at(-1) ?? 0;
      state.targets[line] = {
        type: next,
        minimum,
        grade: inferTargetGrade(next, line, state.method, minimum, target.grade),
        locked: false,
      };
    });
  }, {
    key: `ability-type-${line}`,
    anchorValue: "",
    ariaLabel: `${LINE_NAMES[line]} 목표 옵션`,
    className: "ability-target-type",
    clearable: true,
  });

  const values = target.type
    ? targetValuesFor(target.type, line, state.method, target.grade)
    : [];
  const optionInfo = getAbilityOption(target.type);
  const valueOptions = targetValueOptions(target.type, line, values, optionInfo);
  const selectedValue = lowerLegendaryMethod() && line > 0 ? `${target.grade}:${target.minimum}` : target.minimum;
  if (target.type && !valueOptions.some((option) => String(option.value) === String(selectedValue))) {
    valueOptions.unshift({ value: selectedValue, label: `${target.minimum}${optionInfo?.unit ?? ""} 이상`,
      group: ABILITY_GRADES[target.grade].label, groupTone: target.grade, disabled: true });
  }
  const minimum = searchableSelect(
    valueOptions,
    selectedValue,
    (next) => update(() => {
      state.presetMode = "";
      const [selectedGrade, selectedValue] = String(next).includes(":") ? String(next).split(":") : [target.grade, next];
      state.targets[line].minimum = Number(selectedValue);
      state.targets[line].grade = inferTargetGrade(
        target.type,
        line,
        state.method,
        Number(selectedValue),
        selectedGrade,
      );
    }),
    {
      key: `ability-minimum-${line}`,
      ariaLabel: `${LINE_NAMES[line]} 목표 수치`,
      disabled: !target.type,
      className: "ability-target-minimum",
    },
  );

  const lock = toggleChip(
    "잠금",
    target.locked,
    () => update(() => {
      state.presetMode = "";
      state.targets[line].locked = !state.targets[line].locked;
    }),
    !["honor", "advanced"].includes(state.method) || !target.type,
  );
  lock.classList.add("ability-lock");
  lock.setAttribute("aria-label", `${LINE_NAMES[line]} 옵션 잠금`);

  const item = element("div", "ability-target-row");
  item.dataset.mode = isValueOnly ? "value" : "full";
  const label = element("strong", "ability-target-row__label", LINE_NAMES[line]);
  if (isValueOnly) {
    item.append(label, type, minimum);
  } else if (state.method === "optimal") {
    item.append(
      label,
      type,
      minimum,
      element("span", "ability-lock-strategy", "자동 잠금"),
    );
  } else {
    item.append(label, type, minimum, lock);
  }

  return item;
}

function applyJobPreset(mode) {
  const job = JOB_USAGE_BY_ID.get(state.job);
  if (!job || !["boss", "boss-legendary", "hunt"].includes(mode)) return;
  state.presetMode = mode;
  state.swapLower = !valueOnlyMethod();
  pendingPresetPlacement = "";
  const advancedBossTargets = mode === "boss-legendary" || (mode === "boss" && state.method === "advanced")
    ? getAdvancedAbilityBossTargets(job.id, "advanced", "boss") : null;
  if (advancedBossTargets) {
    state.targets = advancedBossTargets;
    if (state.method === "optimal" && state.useAdvanced) pendingPresetPlacement = JSON.stringify(state.targets);
    return;
  }
  state.targets = job.presets[mode].map((type, line) => {
    const grade = line === 0 ? "legendary" : "unique";
    const available = targetOptionsFor(line, state.method, grade);
    const selectedType = available.some((entry) => entry.id === type) ? type : "";
    const values = selectedType
      ? getAbilityTargetValues(selectedType, line, "honor", grade)
      : [];
    const minimum = values.at(-1) ?? 0;
    return {
      type: selectedType,
      minimum,
      grade: inferTargetGrade(selectedType, line, state.method, minimum, grade),
      locked: false,
    };
  });
}

function jobPresetPanel() {
  const jobSelect = searchableSelect(
    [
      { value: "", label: "직업 선택" },
      ...ABILITY_JOB_PRESETS.map((job) => ({ value: job.id, label: job.name })),
    ],
    state.job,
    (next) => update(() => {
      state.job = next;
      if (state.presetMode && next) applyJobPreset(state.presetMode);
    }),
    {
      key: "ability-job",
      ariaLabel: "직업 선택",
      className: "ability-job-select",
    },
  );

  const advancedOptimal = state.method === "optimal" && state.useAdvanced;
  const modeButtons = (advancedOptimal
    ? [["boss-legendary", "보스용1 적용", "legendary"], ["boss", "보스용2 적용", "unique"], ["hunt", "사냥용 적용"]]
    : [["boss", "보스용 적용"], ["hunt", "사냥용 적용"]]
  ).map(([mode, label, tone]) => {
    const button = chip(label, state.presetMode === mode, () => update(() => applyJobPreset(mode)), !state.job);
    button.dataset.key = `ability-preset-${mode}`;
    if (tone) {
      button.dataset.presetTone = tone;
      button.title = tone === "legendary" ? "레전드리 · 레전드리 · 레전드리" : "레전드리 · 유니크 · 유니크";
    }
    return button;
  });
  const controls = element("div", "ability-job-preset__controls");
  controls.classList.toggle("ability-job-preset__controls--advanced", advancedOptimal);
  controls.append(jobSelect, ...modeButtons);

  const panel = element("section", "ability-job-preset");
  panel.append(controls);
  return panel;
}

function normalizeMethodTargets(previousMethod) {
  const method = probabilityMethod();
  pendingPresetPlacement = "";
  state.presetMode = "";
  state.targets.forEach((target, line) => {
    if (!["honor", "advanced"].includes(state.method) ||
        (method !== "advanced" && line > 0 && target.grade === "legendary")) target.locked = false;
    target.grade = line === 0 ? "legendary"
      : lowerLegendaryMethod(method) && target.grade === "legendary"
        ? "legendary" : target.grade === "epic" ? "epic" : "unique";
    if (!target.type) return;
    const available = targetOptionsFor(line, method, target.grade);
    const values = available.some((entry) => entry.id === target.type)
      ? targetValuesFor(target.type, line, method, target.grade) : [];
    if (!values.length) {
      Object.assign(target, { type: "", minimum: 0, locked: false });
    } else if (!values.includes(Number(target.minimum))) {
      target.minimum = values.at(-1);
    }
    target.grade = inferTargetGrade(target.type, line, method, target.minimum, target.grade);
  });
}

function setupCard() {
  const parentMethod = state.method === "black" ? "honor" : state.method === "abyss" ? "advanced" : state.method;
  function selectMethod(method) {
    if (state.method === method) return;
    update(() => {
      const previousMethod = probabilityMethod();
      if (method === "optimal" && parentMethod === "advanced") state.useAdvanced = true;
      state.method = method;
      normalizeMethodTargets(previousMethod);
    });
  }
  const methodButtons = Object.values(ABILITY_RESET_METHODS)
    .filter((method) => ["optimal", "honor", "advanced"].includes(method.id))
    .map((method) => {
      const button = chip(method.label, parentMethod === method.id, () => selectMethod(method.id));
      button.dataset.key = `ability-method-${method.id}`;
      return button;
    });
  let circulatorMethods = null;
  if (["honor", "advanced"].includes(parentMethod)) {
    const method = parentMethod === "honor" ? "black" : "abyss";
    const button = chip(ABILITY_RESET_METHODS[method].label, state.method === method,
      () => selectMethod(state.method === method ? parentMethod : method));
    button.dataset.key = `ability-method-${method}`;
    circulatorMethods = element("div", "ability-circulator-methods");
    circulatorMethods.append(chipRow(button));
  }
  const strategyOptions = state.method === "optimal"
    ? element(
      "div",
      "ability-strategy-options",
    )
    : null;
  if (strategyOptions) {
    const stock = element("div", "ability-strategy-stock");
    const valueStock = element("fieldset", "ability-strategy-stock__group");
    valueStock.append(element("legend", "", "블서큘(카서큘) 보유량"));
    const valueInputs = element("div", "ability-strategy-stock__pair");
    valueStock.append(valueInputs);
    for (const [method, label] of [
      ["miracle", "미서큘 보유량"],
      ["black", "블서큘"],
      ["chaos", "카서큘"],
      ["abyss", "심서큘 보유량"],
    ]) {
      const key = `${method}Count`;
      const enabled = circulatorAllowed(method);
      const input = numberInput(
        state[key],
        (next) => update(() => { state[key] = normalizeInventory(next); }),
        {
          min: 0,
          max: 9999,
          inputMode: "numeric",
          className: "ability-strategy-stock__input",
        },
      );
      input.disabled = !enabled;
      input.dataset.key = `ability-${method}-count`;
      if (["black", "chaos"].includes(method)) {
        valueInputs.append(field(label, input, "ability-strategy-stock__field"));
        if (method === "black") stock.append(valueStock);
      } else {
        stock.append(field(label, input, "ability-strategy-stock__field"));
      }
    }
    const total = element("small", "ability-strategy-stock__total",
      `합계 ${(state.blackCount + state.chaosCount).toLocaleString("ko-KR")}개`);
    total.dataset.key = "ability-black-chaos-total";
    valueStock.append(total);
    strategyOptions.append(
      chipRow(toggleChip(
        "고급 재설정 사용",
        state.useAdvanced,
        () => update(() => {
          state.useAdvanced = !state.useAdvanced;
          pendingPresetPlacement = "";
        }),
      )),
      element("p", "ability-field-label", "사용할 수 있는 서큘레이터"),
      chipRow(
        circulatorToggle("miracle", "미서큘 허용"),
        circulatorToggle("black", "블서큘(카서큘) 허용"),
        circulatorToggle("abyss", "심서큘 허용"),
      ),
      stock,
      note("보유량이 0개이면 허용 상태여도 추천 전략에서 사용하지 않습니다."),
    );
    const honorPrice = numberInput(state.honorPriceMan, (next) => update(() => {
      state.honorPriceMan = Number.isFinite(Number(next)) ? Math.max(0, Number(next)) : defaults.honorPriceMan;
    }), { min: 0, step: 1, inputMode: "decimal" });
    honorPrice.dataset.key = "ability-honor-price";
    const priceSection = element("div", "ability-honor-price");
    priceSection.append(field("명성치 5,000당 가격 (만 메소)", honorPrice));
    if (PRACTICAL_ENABLED) {
      const abyssPrice = numberInput(state.abyssPriceEok, (next) => update(() => {
        state.abyssPriceEok = Number.isFinite(Number(next)) ? Math.max(0, Number(next)) : defaults.abyssPriceEok;
      }), { min: 0, step: 0.1, inputMode: "decimal" });
      abyssPrice.dataset.key = "ability-abyss-price";
      priceSection.append(field("심서큘 1개의 가치 (억 메소)", abyssPrice));
      priceSection.classList.add("ability-strategy-prices");
    }
    strategyOptions.append(priceSection);
  }
  const resetStrategy = state.method === "optimal" ? resetAction("초기화", () => update(() => {
    for (const key of ["useAdvanced", "allowMiracle", "allowBlackChaos", "allowAbyss",
      "miracleCount", "blackCount", "chaosCount", "abyssCount", "honorPriceMan", "abyssPriceEok"]) {
      state[key] = defaults[key];
    }
    selectedComparison = null;
    selectedRouteId = "";
    pendingPresetPlacement = "";
  }), { key: "reset-ability-strategy", title: "최적 전략 설정만 기본값으로 되돌립니다. 목표 옵션은 유지합니다." }) : null;
  const section = cardWithHead(
    "재설정 방식",
    resetStrategy,
    chipRow(...methodButtons),
    circulatorMethods,
    strategyOptions,
  );
  section.classList.add("ability-setup-card");
  return section;
}

function targetsCard() {
  const reset = resetAction("목표 초기화", () => update(resetTargets));
  const lowerLocked = state.targets.slice(1).some((target) => target.locked);
  const order = toggleChip(
    "2·3번째 줄 순서 무관",
    state.swapLower,
    () => update(() => { state.swapLower = !state.swapLower; }),
    lowerLocked || valueOnlyMethod(),
  );
  order.classList.add("ability-order");
  const halfHonor = toggleChip(
    "어빌 반값 선데이",
    state.halfHonor,
    () => update(() => { state.halfHonor = !state.halfHonor; }),
    !["honor", "advanced", "optimal"].includes(state.method),
  );
  halfHonor.classList.add("ability-order");
  const controls = element("div", "ability-target-list");
  controls.append(...[0, 1, 2].map(targetRow));
  const section = cardWithHead(
    "목표 옵션",
    reset,
    jobPresetPanel(),
    controls,
    chipRow(order, halfHonor),
  );
  section.classList.add("ability-target-card");
  return section;
}

function formatHonor(value) {
  return formatHonorAmount(value);
}

function formatCirculatorCount(value) {
  if (!Number.isFinite(value)) return "도달 불가";
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}개`;
}

function formatResource(value) {
  if (["honor", "advanced"].includes(state.method)) return `${formatHonor(value)} 명성치`;
  if (!Number.isFinite(value)) return "도달 불가";
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}개`;
}

function formatOdds(probability) {
  if (!Number.isFinite(probability) || probability <= 0) return "1 / ∞ · 0%";
  const odds = (1 / probability).toLocaleString("ko-KR", { maximumFractionDigits: 1 });
  return `1 / ${odds} · ${formatProbability(probability, 8)}`;
}

function abilityBasis() {
  const basis = element("div", "ability-basis");
  const probabilityLink = element("a", "", "공식 어빌리티 확률");
  probabilityLink.href = "https://maplestory.nexon.com/Guide/OtherProbability/ability/reputevalue";
  probabilityLink.target = "_blank";
  probabilityLink.rel = "noreferrer";
  const guideLink = element("a", "", "어빌리티 가이드");
  guideLink.href = "https://maplestory.nexon.com/Guide/N23GameInformation/Articles/392";
  guideLink.target = "_blank";
  guideLink.rel = "noreferrer";
  basis.append(probabilityLink, element("span", "", "·"), guideLink);
  return basis;
}

function placementRecommendationStep(result) {
  const recommendation = result.placementRecommendation;
  const shortNames = {
    "passive-level": "패시브", "boss-damage": "보공", "abnormal-damage": "상태 이상",
    "cooldown-skip": "재사용", "buff-duration": "벞지", critical: "크확",
    attack: "공격력", magic: "마력", "max-hp-percent": "최대 HP",
    "item-drop": "아획", "meso-drop": "메획", "attack-speed": "공속",
    "normal-damage": "일반 몬스터 데미지",
  };
  const describePlacement = (targets) => targets.map((target) => {
    const option = getAbilityOption(target.type);
    return `${shortNames[target.type] ?? option?.label ?? target.type} ${target.minimum}${option?.unit ?? ""}`;
  }).join(" → ");
  const item = element("li", "ability-strategy-step ability-placement-recommendation");
  const head = element("div", "ability-strategy-step__head");
  head.append(element("strong", "", "1. 목표 배치 변경 추천"));
  item.append(
    head,
    element("p", "", `입력 배치: ${describePlacement(recommendation.currentTargets)}`),
    element("p", "ability-placement-recommended", `추천 배치: ${describePlacement(recommendation.recommendedTargets)}`),
    element("p", "", `첫째 → 둘째 → 셋째 줄 순서입니다. 평균 ${formatMeso(recommendation.expectedCostSaved)}를 절약할 수 있습니다.`),
    element("small", "ability-placement-cost", `명성치 ${formatHonor(recommendation.currentExpectedHonor)} → ${formatHonor(result.expectedHonor)}`),
    element("small", "ability-placement-cost", `메소 ${formatMeso(recommendation.currentExpectedMeso)} → ${formatMeso(result.expectedMeso)}${recommendation.mesoSaved < -1 ? " (증가)" : ""}`),
    element("p", "", "계산 결과와 아래 진행 순서는 추천 배치 기준입니다."),
  );
  return item;
}

function appendStrategyInstructions(item, step) {
  if (step.priority?.length) {
    const priority = element(step.lockGuideMode === "conditions" ? "ul" : "ol", "ability-strategy-priority");
    step.priority.forEach((target, index) => {
      const line = element("li", "", target);
      if (step.lockNotes?.[index]) line.append(element("small", "ability-strategy-priority__note", step.lockNotes[index]));
      priority.append(line);
    });
    if (step.fallbackPriority?.length) item.append(element("strong", "ability-strategy-priority__label", "미서큘 성공 시"));
    item.append(priority);
  }
  if (step.fallbackPriority?.length) {
    const fallback = element(step.fallbackLockGuideMode === "conditions" ? "ul" : "ol", "ability-strategy-priority");
    step.fallbackPriority.forEach((target, index) => {
      const line = element("li", "", target);
      if (step.fallbackLockNotes?.[index]) line.append(element("small", "ability-strategy-priority__note", step.fallbackLockNotes[index]));
      fallback.append(line);
    });
    item.append(element("strong", "ability-strategy-priority__label", "미서큘 소진 시"), fallback);
  }
  if (step.after) item.append(element("p", step.lockRules ? "ability-strategy-lock-note" : "", step.after));
}

function abyssResultGuide(guide) {
  const itemName = guide.itemMethod === "black" ? "블서큘" : "심서큘";
  const details = element("section", "ability-abyss-guide");
  if (guide.compact) details.classList.add("ability-abyss-guide--compact");
  details.append(element("h4", "ability-abyss-guide__title", guide.compact ? "사용 결과 비교" : `${itemName} 결과 선택 도우미`));
  const lineValues = [0, 1, 2].map((line) => [...new Set(guide.states.map((entry) => entry.values[line]))].sort((a, b) => b - a));
  const oldValues = [0, 1, 2].map((line) => {
    const value = guide.initialValues?.[line];
    return Number.isFinite(value) && lineValues[line].includes(value) ? value : lineValues[line].length === 1 ? lineValues[line][0] : null;
  });
  const newValues = lineValues.map((values) => values.length === 1 ? values[0] : null);
  let remaining = guide.unlimited ? 0 : guide.maximumUses - 1;
  const result = element("p", "ability-strategy-lock-note", oldValues.every(Number.isFinite)
    ? "새 결과의 수치를 선택하세요." : "기존 결과와 새 결과의 수치를 선택하세요.");
  const reason = element("div", "ability-abyss-guide__reason");
  const costs = element("dl", "ability-abyss-guide__costs");
  const costLabel = element("dt");
  costLabel.append(element("span", "", "목표 완성까지"), element("span", "", "남은 평균 비용"));
  const costCells = ["기존", "새 결과"].map((label, i) => {
    const cell = element("dd", "", "—");
    cell.dataset.guideCost = i ? "new" : "old";
    cell.setAttribute("aria-label", `${label}의 목표 완성까지 남은 평균 비용`);
    return cell;
  });
  costs.append(costLabel, ...costCells);
  const showCosts = Boolean(guide.unlimited && guide.stateValues);
  const costFor = (values) => {
    const index = guide.states.findIndex((s) => s.values.every((v, i) => v === values[i]));
    const vector = guide.stateValues?.[index];
    return vector ? vector[0] * state.honorPriceMan * 10000 / 5000 + vector[1] + vector[7] * state.abyssPriceEok * 100000000 : NaN;
  };
  const after = element("div", "ability-flexible-action");
  const actions = element("div", "ability-abyss-guide__actions");
  const isValid = (values) => guide.states.some((entry) => entry.values.every((v, i) => v === values[i]));
  const buttons = [];
  if (guide.onContinue || guide.onSelected) {
    for (const [key, label, values] of [["old", "기존 결과 유지", oldValues], ["new", "새 결과 적용", newValues]]) {
      const button = chip(label, false, () => {
        if (!isValid(values)) return;
        if (guide.onContinue) guide.onContinue([...values], remaining);
        else guide.onSelected([...values], remaining, after);
      }, !isValid(values));
      button.removeAttribute("aria-pressed");
      button.dataset.guideChoice = key;
      buttons.push({ button, values });
      actions.append(button);
    }
  }
  result.setAttribute("aria-live", "polite");
  function paint() {
    reason.replaceChildren();
    buttons.forEach(({ button, values }) => { button.disabled = !isValid(values); });
    const oldCost = costFor(oldValues), newCost = costFor(newValues);
    if (showCosts) [oldCost, newCost].forEach((value, i) => { costCells[i].textContent = Number.isFinite(value) ? formatMeso(value) : "—"; });
    if ([...oldValues, ...newValues].some((value) => value === null)) {
      result.textContent = oldValues.every(Number.isFinite) ? "새 결과의 수치를 선택하세요." : "기존 결과와 새 결과의 수치를 선택하세요.";
      delete result.dataset.apply;
      return;
    }
    const choice = chooseAbilityAbyssResult(guide, oldValues, newValues, remaining);
    if (!choice) return;
    let text = choice.apply ? "새 결과를 적용하세요." : "기존 결과를 유지하세요.";
    if (!guide.onSelected && !guide.onContinue && remaining === 0 && choice.completedMask !== 7) {
      const labels = guide.targets.filter((_, i) => choice.keepMask & (1 << i)).map((target) => getAbilityOption(target.type).label);
      text += labels.length ? ` ${labels.join("·")} 옵션을 잠그고 아래 순서로 진행하세요.` : " 잠금 없이 아래 순서로 진행하세요.";
    }
    result.textContent = text;
    result.dataset.apply = String(choice.apply);
    if (showCosts) {
      if (Number.isFinite(oldCost) && Number.isFinite(newCost)) {
        const improved = newValues.every((v, i) => v >= oldValues[i]) && newValues.some((v, i) => v > oldValues[i]);
        const worsened = oldValues.every((v, i) => v >= newValues[i]) && oldValues.some((v, i) => v > newValues[i]);
        if (guide.valuePreference && choice.apply && improved) {
          reason.append(element("p", "", "다른 수치가 떨어지지 않고 옵션이 좋아졌으므로 새 결과를 적용하세요."));
          if (newCost - oldCost >= 1) reason.append(element("small", "", `수치 개선을 우선하면 남은 평균 비용이 ${formatMeso(newCost - oldCost)} 늘어납니다.`));
        } else if (guide.valuePreference && !choice.apply && worsened) {
          reason.append(element("p", "", "현재 수치가 더 좋으므로 기존 결과를 유지하세요."));
        } else if (!choice.apply && Math.abs(oldCost - newCost) < 1) {
          reason.append(element("p", "", "남은 평균 비용이 같아 기존 결과를 유지합니다."));
        }
      }
    }
  }
  const count = numberInput(remaining, (value) => {
    remaining = Math.max(0, Math.min(guide.maximumUses - 1, Math.floor(Number(value) || 0)));
    count.value = remaining;
    paint();
  }, { min: 0, max: guide.maximumUses - 1, inputMode: "numeric" });
  count.dataset.key = "abyss-guide-remaining";
  if (!guide.unlimited) details.append(field(guide.compact ? `사용 후 남은 ${itemName}` : `이번 사용 후 남은 ${itemName}`, count));
  if (guide.compact) {
    const headings = element("div", "ability-abyss-guide__columns");
    ["옵션", "기존", "새 결과"].forEach((label) => headings.append(element("span", "", label)));
    details.append(headings);
  }
  guide.targets.forEach((target, line) => {
    const row = element("div", "ability-abyss-guide__line");
    const label = element("strong", "", guide.shortLabels?.[line] ?? guide.labels[line]);
    label.title = guide.labels[line];
    row.append(label);
    const values = lineValues[line];
    const unit = getAbilityOption(target.type).unit ?? "";
    const fields = element("div", "ability-abyss-guide__values");
    for (const [name, label, selected] of [["old", "기존 결과", oldValues], ["new", "새 결과", newValues]]) {
      const control = searchableSelect(values.map((value) => ({ value: String(value), label: `${value}${unit}` })), selected[line] === null ? "" : String(selected[line]), (value) => {
        selected[line] = Number(value);
        paint();
      }, { key: `abyss-guide-${name}-${line}`, ariaLabel: `${guide.labels[line]} ${label}`, placeholder: guide.compact ? "선택" : "수치 선택" });
      if (guide.compact) row.append(control);
      else fields.append(field(label, control));
    }
    if (!guide.compact) row.append(fields);
    details.append(row);
  });
  if (showCosts) details.append(costs);
  details.append(result, reason, actions, after);
  paint();
  return details;
}

function strategyBranchGuide(branches, index) {
  const section = element("div", "ability-strategy-branches");
  const body = element("div", "ability-strategy-branches__body");
  const select = searchableSelect(branches.map((branch, i) => ({ value: String(i), label: branch.label })), "", (value) => {
    const branch = branches[Number(value)];
    body.replaceChildren();
    if (branch.description) body.append(element("p", "ability-strategy-lock-note", branch.description));
    branch.steps.forEach((step) => {
      if (branch.steps.length > 1 && step.title) body.append(element("strong", "", step.title));
      if (step.description) body.append(element("p", "", step.description));
      appendStrategyInstructions(body, step);
    });
  }, { key: `abyss-fallback-${index}`, ariaLabel: "완성된 목표 수치", placeholder: "완성된 목표 선택" });
  section.append(field("목표 수치에 도달한 옵션", select), body);
  return section;
}

function flexibleAbilityGuide(guide) {
  const section = element("div", "ability-flexible-guide");
  const rulesBody = element("div", "ability-strategy-branches__body");
  const states = [{ label: "잠금 없음", rules: guide.start }, ...guide.one];
  function paintRules(index) {
    const rules = states[index].rules;
    const list = element("ul", "ability-strategy-priority");
    const locked = states[index].mask ?? 0;
    if (rules.length && rules.every((rule) => rule.keep === rule.found)) {
      const names = rules.filter((rule) => {
        const newBits = rule.found & ~locked;
        return newBits && (newBits & (newBits - 1)) === 0;
      }).map((rule) => rule.label.replace(/^아랫줄에 /u, ""));
      list.append(element("li", "", `아랫줄에서 ${names.join(" 또는 ")} 중 먼저 나온 옵션을 잠그세요.`));
    } else {
      for (const rule of rules) {
        const item = element("li", "", rule.label);
        item.append(element("small", "ability-strategy-priority__note", rule.description));
        list.append(item);
      }
    }
    rulesBody.replaceChildren(list);
  }
  section.append(field("현재 잠근 아랫줄", searchableSelect(states.map((s, i) => ({ value: String(i), label: s.label })), "0",
    (value) => paintRules(Number(value)), { key: "flexible-locked", ariaLabel: "현재 잠근 아랫줄" })), rulesBody);
  paintRules(0);

  const pairBody = element("div", "ability-strategy-branches__body");
  function paintPair(pair) {
    pairBody.replaceChildren();
    const values = [null, null, null];
    let firstType = "";
    const firstValue = element("div");
    const actionBody = element("div", "ability-flexible-action");
    actionBody.setAttribute("aria-live", "polite");
    function paintAction() {
      actionBody.replaceChildren();
      const choice = chooseFlexibleAbilityStart(pair, firstType, values);
      if (!choice) return;
      const target = pair.targets[0];
      const name = pair.names[0];
      const showContinuation = (mask) => {
        const continuation = pair.continuations[mask];
        if (continuation.description) actionBody.append(element("p", "", continuation.description));
        appendStrategyInstructions(actionBody, continuation);
      };
      if (choice.mode === "direct") {
        if (choice.mask === 7) actionBody.append(element("p", "", "입력한 수치가 목표를 충족합니다."));
        else {
          actionBody.append(element("strong", "", "심서큘 없이 고급 재설정으로 진행"));
          showContinuation(choice.mask);
        }
        return;
      }
      const pairFirst = choice.mode === "pair";
      const title = pairFirst ? "심서큘로 아래 두 줄 수치 먼저 맞추기"
        : choice.mode === "first-then-full" ? `첫 줄 ${name} 확보 후 심서큘 사용` : "심서큘로 목표 수치 맞추기";
      actionBody.append(element("strong", "", title));
      if (choice.mode === "first-then-full") {
        actionBody.append(element("p", "", `아래 두 줄을 잠그고 고급 재설정으로 첫 줄 ${name} 옵션을 뽑으세요. 수치는 낮아도 됩니다. 실패하면 기존 결과를 유지하세요.`));
      }
      actionBody.append(element("p", "", `심서큘은 최대 ${pair.count.toLocaleString("ko-KR")}개 사용합니다. 세 줄 수치가 함께 바뀌므로 아래 도우미로 기존·새 결과를 비교하세요.`));
      const entry = pair.firstOptions.find((o) => o.type === firstType);
      const model = pairFirst ? pair.profiles[entry.profile] : pair.full;
      const actualTargets = pairFirst ? [{ ...pair.targets[0], type: firstType }, ...pair.targets.slice(1)] : pair.targets;
      const resultGuide = {
        ...model,
        states: pairFirst ? model.states.map((s) => ({ ...s, values: [entry.values[s.values[0]][0], ...s.values.slice(1)] })) : model.states,
        targets: actualTargets, keepMasks: pair.keepMasks, maximumUses: pair.count,
        labels: pairFirst ? [`첫 번째 줄 ${getAbilityOption(firstType).label}`, ...pair.labels.slice(1)] : pair.labels,
      };
      actionBody.append(abyssResultGuide(resultGuide));
      if (pairFirst) actionBody.append(element("p", "", "아래 두 줄이 목표 수치에 도달하면 심서큘을 멈추고, 아래에서 완성한 옵션을 선택하세요. 보유량을 소진한 경우에도 같은 방식으로 이어갑니다."));
      else actionBody.append(element("p", "", "보유량을 소진했다면 목표 수치에 도달한 옵션을 선택하세요."));
      const masks = pairFirst ? [0, 2, 4, 6] : [0, 1, 2, 3, 4, 5, 6];
      actionBody.append(strategyBranchGuide(masks.map((mask) => ({
        label: mask ? pair.targets.filter((_, i) => mask & (1 << i)).map((t) => getAbilityOption(t.type).label).join(" + ") : "목표 수치에 도달한 줄 없음",
        steps: [pair.continuations[mask]],
        description: pair.continuations[mask].description,
      })), `flexible-${pair.pairMask}`));
    }
    const firstOptions = [...pair.firstOptions].sort((a, b) => Number(b.type === pair.targets[0].type) - Number(a.type === pair.targets[0].type));
    pairBody.append(element("p", "", `남은 첫 줄 목표: ${pair.labels[0]}`));
    pairBody.append(field("현재 첫 줄 옵션", searchableSelect(firstOptions.map((o) => ({ value: o.type, label: o.label })), "", (value) => {
      firstType = value;
      values[0] = null;
      const entry = pair.firstOptions.find((o) => o.type === value);
      const unit = getAbilityOption(value).unit ?? "";
      firstValue.replaceChildren(field("현재 첫 줄 수치", searchableSelect(entry.values.map(([v]) => ({ value: String(v), label: `${v}${unit}` })), "", (selected) => {
        values[0] = Number(selected); paintAction();
      }, { key: "flexible-first-value", ariaLabel: "현재 첫 줄 수치", placeholder: "수치 선택" })));
      paintAction();
    }, { key: "flexible-first-type", ariaLabel: "현재 첫 줄 옵션", placeholder: "옵션 선택" })), firstValue);
    pair.targets.slice(1).forEach((target, index) => {
      const available = [...new Set(pair.lowerStates.map((s) => s.values[index]))].sort((a, b) => b - a);
      pairBody.append(field(`${getAbilityOption(target.type).label} 현재 수치`, searchableSelect(available.map((v) => ({ value: String(v), label: String(v) })), "", (value) => {
        values[index + 1] = Number(value); paintAction();
      }, { key: `flexible-lower-${index}`, ariaLabel: `${getAbilityOption(target.type).label} 현재 수치`, placeholder: "수치 선택" })));
    });
    pairBody.append(actionBody);
  }
  section.append(element("h4", "", "두 줄 확보 후"), field("확보한 아랫줄 두 개", searchableSelect(guide.pairs.map((p, i) => ({ value: String(i), label: p.label })), "", (value) => paintPair(guide.pairs[Number(value)]),
    { key: "flexible-pair", ariaLabel: "확보한 아랫줄 두 개", placeholder: "두 줄 선택" })), pairBody);
  return section;
}

// This view follows the fixed policy evaluated by the core: one table for
// the whole inventory, retain the old tuple on ties, inspect only at milestones.
function practicalAbilityPairGuide(pair, guide, onPhase, initialValues) {
  const body = element("div", "ability-practical-guide");
  const action = element("div", "ability-flexible-action");
  const methodName = guide.method === "advanced" ? "고급 재설정" : "명성치 재설정";
  const itemName = guide.itemMethod === "black" ? "블서큘" : "심서큘";
  const allFirst = pair.practical.mode === "all";
  const goal = (i) => `${pair.names[i]} ${pair.targets[i].minimum}${getAbilityOption(pair.targets[i].type).unit ?? ""}`;
  const names = (mask) => mask === 7 ? "세 목표 모두" : mask === 0 ? "없음"
    : pair.names.filter((_, i) => mask & (1 << i)).join(" + ");
  function button(label, key, fn) {
    const control = chip(label, false, fn);
    control.removeAttribute("aria-pressed"); control.dataset.practicalAction = key;
    return control;
  }
  function heading(title) {
    action.replaceChildren(element("small", "ability-guide-action-label", "지금 할 일"), element("strong", "", title));
  }
  function finish() {
    onPhase(2);
    heading(`${methodName}으로 마무리`);
    action.append(element("p", "", "현재 목표 수치에 도달한 옵션을 한 번만 선택하세요."));
    const continuation = element("div", "ability-practical-finish");
    action.append(field("완성한 목표", searchableSelect(
      Array.from({ length: 8 }, (_, mask) => ({ value: String(mask), label: names(mask) })), "", (value) => {
        const mask = Number(value), keep = pair.keepMasks[mask];
        continuation.replaceChildren();
        if (mask === 7) {
          continuation.append(element("strong", "", "세 목표를 모두 완성했습니다."));
          return;
        }
        continuation.append(element("strong", "", keep ? `${names(keep)} 잠금 유지` : "잠금 없이 진행"));
        appendStrategyInstructions(continuation, pair.continuations[mask]);
      }, { key: "practical-completed", ariaLabel: "완성한 목표", placeholder: "완성한 조합 선택" })), continuation);
    if (pair.count) action.append(button("← 서큘레이터 안내", "back-roll", roll));
  }
  function roll() {
    onPhase(1);
    heading(`${itemName} 최대 ${pair.count.toLocaleString("ko-KR")}개 사용`);
    action.append(element("p", "", allFirst
      ? "세 목표가 완성되거나 보유량을 소진할 때까지 아래 기준을 유지하세요."
      : "아랫줄 두 목표가 완성되거나 보유량을 소진할 때까지 아래 기준을 유지하세요."));
    const table = element("table", "ability-practical-priority");
    const caption = element("caption", "", "유지할 결과 우선순위");
    const head = element("thead"), headRow = element("tr");
    headRow.append(element("th", "", "순위"), element("th", "", "목표 수치에 도달한 옵션"));
    headRow.children[0].scope = "col"; headRow.children[1].scope = "col";
    head.append(headRow);
    const rows = element("tbody");
    const possible = new Set(pair.full.states.map((s) => s.mask & pair.practical.focusMask));
    pair.practical.maskOrder.filter((mask) => possible.has(mask)).forEach((mask, i) => {
      const row = element("tr"); row.dataset.mask = String(mask);
      row.append(element("td", "", String(i + 1)), element("td", "", names(mask)));
      rows.append(row);
    });
    table.append(caption, head, rows);
    action.append(table,
      element("p", "", "기존 결과와 새 결과 중 표에서 더 위에 있는 조합을 선택하세요. 같은 조합이면 기존 결과를 유지하세요."));
    if (!allFirst) action.append(element("small", "", "이 단계에서는 첫 줄의 수치와 관계없이 아랫줄 조합으로만 선택합니다."));
    action.append(button("목표 달성·보유량 소진 후 →", "finish", finish));
  }
  const targets = element("div", "ability-practical-targets");
  pair.targets.forEach((target, i) => targets.append(element("small", "", `${i === 0 ? "첫 줄" : "아랫줄"} · ${goal(i)} (${ABILITY_GRADES[target.grade].label})`)));
  body.append(targets, action);
  if (!pair.count || (!allFirst && pair.targets.slice(1).every((target, i) => initialValues[i + 1] >= target.minimum))) finish();
  else if (allFirst) {
    onPhase(1);
    heading(`첫 줄 ${pair.names[0]} 종류 확보`);
    action.append(element("p", "", `아랫줄 두 옵션을 잠그고 ${methodName}하세요. 첫 줄 ${pair.names[0]}은 낮은 수치도 가능합니다.`));
    if (guide.method === "advanced") action.append(element("small", "", "다른 종류가 나오면 기존 결과를 유지하세요."));
    action.append(button(`${pair.names[0]}이 있으면 다음 →`, "roll", roll));
  } else roll();
  return body;
}

function economicAbilityGuide(guide, heading) {
  if (guide.practical || guide.reference) return abilityPracticalGuide(guide, heading, abyssResultGuide);
  const section = element("div", "ability-flexible-guide ability-economic-guide");
  const methodName = guide.method === "advanced" ? "고급 재설정" : "명성치 재설정";
  const itemName = guide.itemMethod === "black" ? "블서큘" : "심서큘";
  const bits = (mask) => [0, 1, 2].filter((i) => mask & (1 << i));
  const name = (i, value) => `${guide.names[i]} ${value}${guide.units[i]} (${ABILITY_GRADES[guide.targets[i].grade].label})`;
  const states = [{ ...guide.start, label: "아직 잠근 줄 없음" }, ...guide.one.map((s) => ({
    ...s, label: `${name(s.targetIndex, s.value)} 잠금`,
  }))];
  const stageField = element("div");
  const rulesBody = element("div", "ability-strategy-branches__body");
  const pairBody = element("div", "ability-strategy-branches__body");
  const pairField = element("div");
  const setupBody = element("div", "ability-guide-setup");
  const progress = element("ol", "ability-guide-progress");
  (guide.practical ? ["아랫줄 확보", "서큘레이터", "마무리"] : ["아랫줄 선택", "첫 줄 확인", "지금 할 일"]).forEach((label, i) => {
    progress.append(element("li", "", `${i + 1}. ${label}`));
  });
  const back = chip("← 아랫줄 선택 안내", false, () => paintRules(states.indexOf(current)));
  back.removeAttribute("aria-pressed");
  back.dataset.guideBack = "";
  const currentDetails = element("details", "ability-guide-current");
  const currentSummary = element("summary", "");
  currentDetails.append(currentSummary, stageField);
  let current = states[0];
  function phase(index) {
    [...progress.children].forEach((step, i) => {
      step.dataset.active = String(i === index);
      if (i === index) step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
    });
  }
  rulesBody.setAttribute("aria-live", "polite");
  function paintRules(index) {
    current = states[index];
    showPair(null);
    currentSummary.textContent = current.mask ? `잠금 상태 변경 · ${name(current.targetIndex, current.value)}` : "이미 잠근 옵션이 있다면 선택";
    currentDetails.open = false;
    stageField.replaceChildren(field("현재 잠근 옵션", searchableSelect(
      states.map((s, i) => ({ value: String(i), label: s.label })), String(index),
      (value) => paintRules(Number(value)), { key: "economic-locked", ariaLabel: "현재 잠근 옵션" })));
    const list = element("ul", "ability-strategy-priority");
    const rejected = [];
    // Group the initial guidance by value; the shared pair picker below checks
    // the exact decision when both lower targets are present.
    for (const i of [0, 1, 2]) {
      const single = current.decisions.filter((d) => (d.found & ~current.mask) === (1 << i));
      const accepted = single.filter((d) => d.keep & (1 << i));
      const skipped = [...new Set(single.filter((d) => !(d.keep & (1 << i))).map((d) => d.values[i]))].sort((a, b) => a - b);
      if (current.mask && skipped.length) rejected.push(`${guide.names[i]} ${skipped.join("·")}${guide.units[i]} (${ABILITY_GRADES[guide.targets[i].grade].label})`);
      if (!accepted.length) continue;
      const values = [...new Set(accepted.map((d) => d.values[i]))].sort((a, b) => a - b);
      const valueLabel = guide.practical && values.length > 2 && values.every((v, n) => !n || v === values[n - 1] + 1)
        ? `${values[0]}~${values.at(-1)}` : values.join("·");
      const label = `${guide.names[i]} ${valueLabel}${guide.units[i]} (${ABILITY_GRADES[guide.targets[i].grade].label})`;
      const row = element("li", "", `${current.mask ? "남은 아랫줄" : "2·3번째 줄"}에 ${label} → ${current.mask ? "추가 " : ""}잠금`);
      const pair = current.mask ? guide.pairs.find((p) => p.pairMask === (current.mask | (1 << i))) : null;
      if (pair) {
        const target = pair.targets[0];
        row.append(element("small", "ability-strategy-priority__note", `이 조합의 첫 줄 목표: ${pair.names[0]} ${target.minimum}${getAbilityOption(target.type).unit ?? ""}`));
      }
      const actions = element("div", "ability-guide-next");
      const advance = (value) => {
          if (!current.mask) {
            const next = states.findIndex((s) => s.targetIndex === i && s.value === value);
            if (next >= 0) paintRules(next);
          } else if (pair) {
            showPair(guide.pairs.indexOf(pair), { [current.targetIndex]: current.value, [i]: value });
            pairField.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }
      };
      if (guide.practical) {
        const button = chip(`${guide.names[i]} 나왔어요 →`, false, () => {
          if (values.length === 1) { advance(values[0]); return; }
          actions.replaceChildren(field("나온 수치", searchableSelect(values.map((v) => ({ value: String(v), label: `${v}${guide.units[i]}` })), "",
            (value) => advance(Number(value)), { key: `practical-lock-value-${i}`, ariaLabel: `${guide.names[i]} 나온 수치`, placeholder: "수치 선택" })));
        });
        button.removeAttribute("aria-pressed"); button.dataset.practicalFound = guide.targets[i].type;
        actions.append(button);
      } else values.forEach((value) => {
        const button = chip(`${guide.names[i]} ${value}${guide.units[i]} 잠근 뒤 →`, false, () => advance(value));
        button.dataset.guideLock = guide.targets[i].type;
        button.dataset.guideValue = String(value);
        button.removeAttribute("aria-pressed");
        actions.append(button);
      });
      row.append(actions);
      list.append(row);
    }
    rulesBody.replaceChildren(
      element("strong", "ability-guide-stage", current.mask ? `${name(current.targetIndex, current.value)} 잠근 뒤` : "잠금 없이 시작"),
      element("p", "", current.mask
        ? `해당 줄의 잠금을 유지하고 ${methodName}을 계속하세요. 남은 아랫줄에서 다음 중 먼저 나온 옵션을 잠그세요.`
        : "두 번째·세 번째 줄에 다음 조건의 옵션이 나오면 해당 줄을 잠그세요."),
      list,
      element("p", "", rejected.length ? `${rejected.join(" / ")}는 잠그지 않고 계속 재설정하세요.`
        : "위 조건에 없는 옵션은 잠그지 않고 계속 재설정하세요."),
    );
  }
  setupBody.append(currentDetails, rulesBody);
  section.append(progress, setupBody, back);
  paintRules(0);

  function showPair(index, knownValues = {}) {
    setupBody.hidden = index !== null;
    back.hidden = index === null;
    phase(0);
    pairField.replaceChildren(field("먼저 나온 아랫줄 목표 두 개", searchableSelect(
      guide.pairs.map((p, i) => ({ value: String(i), label: p.label, hidden: (p.pairMask & current.mask) !== current.mask })), index === null ? "" : String(index),
      (value) => showPair(Number(value)), { key: "economic-pair", ariaLabel: "먼저 나온 아랫줄 목표 두 개", placeholder: "두 옵션 선택" })));
    if (index === null) pairBody.replaceChildren();
    else paintPair(guide.pairs[index], { ...knownValues, ...(current.mask ? { [current.targetIndex]: current.value } : {}) });
  }
  function paintPair(pair, knownValues = {}) {
    pairBody.replaceChildren();
    const values = [null, ...pair.targets.slice(1).map((t) => knownValues[guide.targets.findIndex((goal) => goal.type === t.type)] ?? null)];
    let firstMode = "", firstType = "", remaining = pair.count;
    let remainingInput;
    const firstValue = element("div"), actionBody = element("div", "ability-flexible-action");
    const lockBody = element("div", "ability-flexible-action");
    const nextBody = element("div", "ability-strategy-branches__body");
    const firstButtons = chipRow();
    const firstFields = element("div", "ability-guide-fields");
    const otherDetails = element("details", "ability-guide-current");
    const otherSummary = element("summary", "");
    const otherFields = element("div", "ability-guide-fields");
    otherDetails.append(otherSummary, otherFields);
    const targetEntry = pair.firstOptions.find((entry) => entry.type === pair.targets[0].type);
    const otherEntries = pair.firstOptions.filter((entry) => entry !== targetEntry);
    lockBody.setAttribute("aria-live", "polite");
    actionBody.setAttribute("aria-live", "polite");
    function paintLocks() {
      lockBody.replaceChildren();
      lockBody.hidden = false;
      phase(0);
      // Hide downstream actions until the selected pair is worth retaining.
      nextBody.hidden = true;
      if (values.slice(1).some((value) => value === null)) {
        lockBody.append(element("p", "", "두 옵션의 현재 수치를 선택하세요."));
        return;
      }
      const foundValues = Object.fromEntries(pair.targets.slice(1).map((target, i) => [
        guide.targets.findIndex((goal) => goal.type === target.type), values[i + 1],
      ]));
      const rule = current.decisions.find((d) => d.found === pair.pairMask &&
        Object.entries(d.values).every(([i, value]) => foundValues[i] === value));
      if (!rule) return;
      if (rule.keep === pair.pairMask) {
        lockBody.append(element("p", "ability-strategy-lock-note", pair.practical ? "아랫줄 두 옵션 잠금" : "두 옵션 잠금 → 첫 줄을 확인하세요."));
        nextBody.hidden = false;
        if (pair.practical) nextBody.replaceChildren(practicalAbilityPairGuide(pair, guide, phase, values));
        else paintAction();
        return;
      }
      if (!rule.keep) {
        lockBody.append(element("p", "ability-strategy-lock-note", "두 옵션 모두 잠그지 않고 계속 재설정하세요."));
        return;
      }
      const kept = bits(rule.keep)[0], value = foundValues[kept];
      const skipped = bits(pair.pairMask & ~rule.keep).map((i) => guide.names[i]).join("·");
      lockBody.append(element("p", "ability-strategy-lock-note", `${name(kept, value)}${current.mask ? " 잠금을 유지하세요." : "만 잠그세요."} ${skipped}은 잠그지 않고 계속 재설정하세요.`));
      const button = chip(`${guide.names[kept]} ${value}${guide.units[kept]} 잠근 뒤 →`, false, () => {
        const next = states.findIndex((s) => s.targetIndex === kept && s.value === value);
        if (next >= 0) paintRules(next);
      });
      button.removeAttribute("aria-pressed");
      lockBody.append(button);
    }
    function explain(choice, container) {
      container.replaceChildren();
      container.append(element("small", "ability-guide-action-label", "지금 할 일"));
      if (choice.mask === 7) {
        container.append(element("p", "", "입력한 수치가 목표를 충족합니다."));
      } else if (choice.action === "direct") {
        container.append(element("strong", "", `${methodName}으로 남은 목표 맞추기`));
        const continuation = pair.continuations[choice.mask];
        const kept = pair.names.filter((_, i) => choice.keepMask & (1 << i));
        container.append(element("p", "", kept.length ? `${kept.join("·")} 잠금 유지` : "잠금 없이 진행"));
        const more = element("details", "ability-guide-more");
        more.append(element("summary", "", "잠금·진행 순서 보기"));
        appendStrategyInstructions(more, continuation);
        container.append(more);
      } else if (choice.action === "acquire") {
        container.append(element("strong", "", `${methodName}으로 첫 줄 ${pair.names[0]} 뽑기`),
          element("p", "", `아랫줄 잠금 유지 · ${pair.names[0]}은 낮은 수치도 가능`));
        if (guide.method === "advanced") {
          const more = element("details", "ability-guide-more");
          more.append(element("summary", "", "진행 방법 보기"),
            element("p", "", "다른 종류의 옵션이 나오면 기존 결과를 유지하세요."));
          container.append(more);
        }
        const next = chip(`${pair.names[0]} 나왔어요 →`, false, () => {
          paintFirstMode("target");
          if (targetEntry.values.length > 1) firstValue.querySelector("input")?.focus();
        });
        next.removeAttribute("aria-pressed");
        next.dataset.guideAcquired = "";
        container.append(next);
      } else {
        container.append(element("strong", "", `${itemName} 사용`),
          element("p", "", "사용 후 ‘사용 결과 비교’에서 유지할 결과를 확인하세요."));
      }
    }
    function paintAction() {
      actionBody.replaceChildren();
      lockBody.hidden = Boolean(firstMode);
      phase(1);
      otherDetails.hidden = true;
      if (!firstMode) return;
      if (firstMode === "other") {
        if (!firstType) {
          // Only omit the exact first option when every possible option/value
          // produces the same next action. Never substitute a representative.
          const choices = otherEntries.flatMap((entry) => entry.values.map(([value]) =>
            chooseAbilityEconomicAction(pair, entry.type, [value, ...values.slice(1)], remaining)));
          const first = choices[0];
          const consistent = first && choices.every((choice) => choice &&
            choice.action === first.action && choice.mask === first.mask && choice.keepMask === first.keepMask);
          if (consistent) {
            phase(2);
            explain(first, actionBody);
            if (first.action !== "roll") return;
            otherDetails.hidden = false;
            otherSummary.textContent = `${itemName} 결과 비교 도우미 열기`;
            // This branch cannot show a result helper until the exact first
            // option is known, so replace the generic comparison instruction.
            actionBody.querySelector("p").textContent = "결과 비교는 위 도우미에서 현재 첫 줄을 입력한 뒤 이용하세요.";
            return;
          }
          otherDetails.open = true;
        }
        otherDetails.hidden = false;
        otherSummary.textContent = "현재 첫 줄 입력";
      }
      const choice = chooseAbilityEconomicAction(pair, firstType, values, remaining);
      if (!choice) {
        actionBody.append(element("p", "", firstMode === "other"
          ? "현재 첫 줄에 따라 추천이 달라집니다. 위에서 옵션과 수치를 선택하세요."
          : `현재 ${pair.names[0]} 수치를 선택하세요.`));
        return;
      }
      phase(2);
      explain(choice, actionBody);
      if (choice.action !== "roll") return;
      const entry = pair.firstOptions.find((o) => o.type === firstType);
      const same = firstType === pair.targets[0].type;
      const model = choice.model;
      const helper = {
        ...model, itemMethod: guide.itemMethod,
        compact: true, initialValues: [...values],
        states: same ? model.states : model.states.map((s) => ({ ...s, values: [entry.values[s.values[0]][0], ...s.values.slice(1)] })),
        targets: [{ ...pair.targets[0], type: firstType }, ...pair.targets.slice(1)],
        labels: [`첫 번째 줄 ${entry.label}`, ...pair.labels.slice(1)],
        shortLabels: [same ? pair.names[0] : "첫 줄", ...pair.names.slice(1)],
        keepMasks: pair.keepMasks, maximumUses: remaining,
        onContinue: (selected, left) => {
          values.splice(0, values.length, ...selected);
          remaining = left;
          firstValue.querySelector(".search-select").value = String(values[0]);
          lowerFields.querySelectorAll(".search-select").forEach((control, i) => { control.value = String(values[i + 1]); });
          if (remainingInput) remainingInput.value = remaining;
          paintAction();
          actionBody.scrollIntoView({ block: "nearest", behavior: "smooth" });
        },
      };
      actionBody.append(abyssResultGuide(helper));
    }
    function paintFirstValue(entry) {
      values[0] = entry.values.length === 1 ? entry.values[0][0] : null;
      firstValue.replaceChildren(field(firstMode === "target" ? `현재 ${pair.names[0]} 수치` : "현재 첫 줄 수치", searchableSelect(
        entry.values.map(([v]) => ({ value: String(v), label: `${v}${getAbilityOption(entry.type).unit ?? ""}` })),
        values[0] === null ? "" : String(values[0]), (value) => { values[0] = Number(value); paintAction(); },
        { key: "economic-first-value", ariaLabel: "현재 첫 줄 수치", placeholder: "수치 선택" })));
    }
    function paintFirstMode(mode) {
      firstMode = mode; firstType = mode === "target" ? targetEntry.type : ""; values[0] = null;
      firstFields.replaceChildren(); firstValue.replaceChildren(); otherFields.replaceChildren(); otherDetails.open = false;
      firstButtons.replaceChildren(...[["target", `${pair.names[0]} 있음`], ["other", "아직 안 나옴"]].map(([value, label]) => {
        const button = chip(label, mode === value, () => paintFirstMode(value));
        button.dataset.guideFirst = value;
        return button;
      }));
      if (mode === "target") {
        paintFirstValue(targetEntry);
        firstFields.append(firstValue);
      } else if (mode === "other") {
        otherFields.append(element("p", "", "목표를 추가하는 입력이 아닙니다. 실제 첫 줄에 남아 있는 옵션을 선택하세요."),
          field("현재 남아 있는 첫 줄 옵션", searchableSelect(otherEntries.map((entry) => ({ value: entry.type, label: entry.label })), "", (value) => {
            firstType = value;
            paintFirstValue(otherEntries.find((entry) => entry.type === value));
            paintAction();
          }, { key: "economic-first-type", ariaLabel: "현재 남아 있는 첫 줄 옵션", placeholder: "옵션 선택" })), firstValue);
        firstFields.append(otherDetails);
      }
      paintAction();
    }
    if (!pair.practical) nextBody.append(element("strong", "", `첫 줄 목표: ${pair.names[0]} ${pair.targets[0].minimum}${getAbilityOption(pair.targets[0].type).unit ?? ""} (${ABILITY_GRADES[pair.targets[0].grade].label})`),
      firstButtons, firstFields);
    if (!pair.practical) paintFirstMode("");
    const lowerFields = element("div", "ability-guide-lower-values");
    pair.targets.slice(1).forEach((target, i) => {
      const available = [...new Set(pair.lowerStates.map((s) => s.values[i]))].sort((a, b) => b - a);
      lowerFields.append(field(`${pair.names[i + 1]} ${pair.practical ? "확보한 수치" : "현재 수치"}`, searchableSelect(available.map((v) => ({ value: String(v),
        label: `${v}${getAbilityOption(target.type).unit ?? ""}` })), values[i + 1] === null ? "" : String(values[i + 1]), (value) => { values[i + 1] = Number(value); paintLocks(); },
      { key: `economic-lower-${i}`, ariaLabel: `${getAbilityOption(target.type).label} 현재 수치`, placeholder: "수치 선택",
        disabled: Boolean(current.mask & (1 << guide.targets.findIndex((goal) => goal.type === target.type))) })));
    });
    if (pair.count && !pair.practical) {
      const input = numberInput(remaining, (v) => {
        remaining = Math.max(0, Math.min(pair.count, Math.floor(Number(v) || 0)));
        input.value = remaining; paintAction();
      }, { min: 0, max: pair.count, inputMode: "numeric" });
      remainingInput = input;
      input.dataset.key = "economic-remaining";
      nextBody.append(field(`남은 ${itemName}`, input));
    }
    if (!pair.practical) nextBody.append(actionBody);
    pairBody.append(lowerFields, lockBody, nextBody);
    paintLocks();
  }
  section.append(pairField, pairBody);
  return section;
}

function abilityRouteComparison(comparison, selectedId, onSelect) {
  const section = card("경로 비교");
  section.classList.add("ability-route-comparison");
  const list = element("div", "ability-route-comparison__list");
  const entries = [];
  const explanation = element("p", "ability-route-comparison__note");
  for (const route of comparison.routes) {
    const r = route.result, phase = r.phaseMetrics;
    const guide = r.steps[0]?.economicGuide, unlimited = guide?.unlimited === true;
    const item = element("article", "ability-route-option");
    item.dataset.route = route.id; item.dataset.selected = String(route.id === selectedId);
    const button = chip(route.label, route.id === selectedId, () => onSelect(route.id));
    button.dataset.routeSelect = route.id;
    button.setAttribute("aria-label", `${route.label} 진행 안내 보기`);
    const head = element("div", "ability-route-option__head");
    const badge = element("small", "ability-route-option__recommended");
    head.append(button, badge);
    const costLabel = element("small", "ability-route-option__cost-label");
    const cost = element("strong", "ability-route-option__cost");
    item.append(head, costLabel, cost);
    const itemMethod = guide?.mixed ? "blackChaos" : guide?.itemMethod;
    const itemName = itemMethod === "blackChaos" ? "블서큘·카서큘" : itemMethod === "black" ? "블서큘" : "심서큘";
    const fields = element("dl", "ability-route-option__metrics");
    const row = (label, value) => {
      const nodes = [element("dt", "", label), element("dd", "", value)];
      fields.append(...nodes);
      return nodes;
    };
    const costFields = {};
    for (const [label, key] of [["명성치 환산", "honorMeso"], ["재설정 메소", "resetMeso"], ["심서큘 가치", "abyssMeso"]]) {
      const [, amount] = row(label, "");
      amount.dataset.routeCostComponent = key;
      costFields[key] = amount;
    }
    const [, useCell] = row(`${itemName} 최대 / 사용`, "");
    const maximum = element("span", "", unlimited ? "제한 없음" : `${phase?.maximumUses ?? guide?.count ?? 0}개`);
    maximum.dataset.routeMaximum = "";
    const useValue = element("span", "ability-route-option__uses");
    useValue.dataset.routeUses = "";
    useCell.append(maximum, " / ", useValue);
    let finishValue = null;
    if (!unlimited) {
      row(`${itemName} 단계 성공 확률`, phase?.phaseSuccessProbability == null ? "서큘레이터 사용 없음" : formatProbability(phase.phaseSuccessProbability, 2));
      [, finishValue] = row(`${itemName} 소진 후 마무리 비용`, "");
      finishValue.dataset.routeFinishCost = "";
    } else if (r.reach) {
      row(`보유 ${comparison.availableCount}개 초과 사용 확률`, formatProbability(r.reach.overInventoryProbability, 2));
    }
    item.append(fields);
    const details = element("div", "ability-route-option__details");
    let finishExplanation = null;
    if (unlimited) details.append(element("p", "", "입력한 보유량으로 중단하지 않습니다. 실제 사용한 심서큘의 가치를 총비용에 포함합니다."));
    else if (phase?.phaseSuccessProbability != null) {
      const focus = guide.pairs[0]?.practical?.focusMask === 6 ? "아랫줄 두 목표" : "세 줄 목표";
      finishExplanation = element("p");
      details.append(element("p", "", `단계 성공은 사용 한도 안에서 ${focus}의 수치를 완성하는 기준입니다. 서큘레이터 사용 전에 충족한 경우도 포함합니다.`),
        finishExplanation,
        element("p", "", `소진 후 마무리 비용의 전체 평균 기여분: ${formatMeso(phase.exhaustionMesoContribution)}. 실패 확률을 곱한 금액이며 평균 총비용에 이미 포함되어 있습니다.`));
    }
    item.append(details); list.append(item);
    entries.push({ route, cost, costLabel, badge, costFields, useValue, finishValue, finishExplanation, itemMethod });
  }
  const selected = comparison.routes.find((route) => route.id === selectedId) ?? comparison.routes[0];
  const averageChance = () => normalizeTargetChance(Number(((selected.result.reach?.averageChance ?? .8) * 100).toFixed(2)));
  const paint = (percent, average) => {
    const breakdowns = entries.map(({ route: { result } }) => average
      ? { totalMeso: result.expectedTotalMeso, honorMeso: result.expectedHonorMeso, resetMeso: result.expectedMeso, abyssMeso: result.expectedAbyssMeso }
      : abilityRouteBreakdownForChance(result.reach, percent / 100));
    const amounts = breakdowns.map((breakdown) => breakdown?.totalMeso);
    const minimum = Math.min(...amounts.filter(Number.isFinite));
    entries.forEach(({ route, cost, costLabel, badge, costFields, useValue, finishValue, finishExplanation, itemMethod }, i) => {
      cost.textContent = Number.isFinite(amounts[i]) ? formatMeso(amounts[i]) : "확률별 비용 계산 불가";
      costLabel.textContent = average ? "총비용" : `${percent.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}% 도달 총비용 (추정)`;
      for (const [key, node] of Object.entries(costFields)) {
        const value = breakdowns[i]?.[key];
        node.textContent = Number.isFinite(value) ? formatMeso(value) : "확률별 비용 계산 불가";
      }
      const uses = average ? itemMethod === "blackChaos"
        ? (route.result.expectedCirculators.black ?? 0) + (route.result.expectedCirculators.chaos ?? 0)
        : route.result.expectedCirculators[itemMethod] ?? 0 : abilityRouteUsesForChance(route.result.reach, percent / 100);
      useValue.textContent = Number.isFinite(uses)
        ? average ? formatCirculatorCount(uses) : `${uses.toLocaleString("ko-KR")}개 이하`
        : "확률별 사용량 계산 불가";
      if (finishValue) {
        const phase = route.result.phaseMetrics, failure = phase?.exhaustionProbability;
        const finish = average
          ? failure > 0 ? phase.exhaustionMesoContribution / failure : null
          : abilityRouteFinishCostForChance(route.result.reach, percent / 100);
        finishValue.textContent = !(failure > 0) ? "해당 없음"
          : Number.isFinite(finish) ? formatMeso(finish) : "소진 사례 부족";
        if (finishExplanation) finishExplanation.textContent = average
          ? "소진 후 마무리 비용은 단계 목표를 달성하지 못하고 소진한 경우에만, 이후 명성치와 재설정으로 추가 지출하는 금액의 평균입니다. 소진 전 지출은 제외합니다."
          : !(failure > 0) ? "이 경로는 단계 목표를 완성하지 못한 채 소진하는 경우가 없습니다."
          : Number.isFinite(finish)
            ? `심서큘을 모두 쓰고도 단계 목표가 남은 경우 중 ${percent.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%가 표시된 마무리 비용 이내에 목표를 완성합니다. 소진 전 지출은 제외합니다.`
            : "심서큘을 모두 쓰고도 단계 목표가 남은 사례가 부족해 확률별 마무리 비용을 추정할 수 없습니다.";
      }
      badge.hidden = !Number.isFinite(amounts[i]) || amounts[i] > minimum + 1;
      badge.textContent = average ? "평균 최저" : "선택 확률 최저";
    });
    explanation.textContent = average
      ? "각 경로의 평균 비용입니다. 확률 입력값은 선택한 경로의 평균 비용으로 목표를 완성할 확률입니다."
      : `${percent.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}%가 표시된 총비용 이내에 세 줄 목표를 완성합니다. 낮은 확률은 운이 좋은 구간, 높은 확률은 더 넉넉한 예산입니다.`;
  };
  section.append(createReachChanceControl({
    id: "ability-route-chance-range", label: "목표 도달 확률", value: state.routeChanceAverage ? averageChance() : state.routeChancePercent,
    min: TARGET_CHANCE_MIN, max: TARGET_CHANCE_MAX, average: state.routeChanceAverage, averageValue: averageChance,
    rangeKey: "ability-route-chance-range", numberKey: "ability-route-chance-number", normalize: normalizeTargetChance,
    onChange: (value, { average }) => { state.routeChancePercent = value; state.routeChanceAverage = average; paint(value, average); },
    onCommit: () => safeSave(state),
  }), explanation, list,
  element("p", "ability-route-comparison__note", "확률별 세부 비용은 표시된 총비용에 해당하는 시뮬레이션 한 건의 구성입니다. 심서큘 사용량과 소진 후 마무리 비용은 각각의 확률 기준이며, 마무리 비용을 총비용에 다시 더하지 않습니다."),
  element("p", "ability-route-comparison__note", "확률별 비용·사용량은 경로당 10만 회 시뮬레이션 근사치입니다. 명성치 환산·재설정 메소·심서큘 가치를 합산하며, 진행 규칙은 평균 비용 기준으로 유지합니다."));
  if (comparison.unavailableReason) section.append(element("p", "ability-route-comparison__note", comparison.unavailableReason));
  return section;
}

function optimalResultCard() {
  const request = requestOptimalStrategy({
    useAdvanced: state.useAdvanced,
    comparePlacements: state.useAdvanced,
    flexiblePlacement: state.useAdvanced,
    includePractical: PRACTICAL_ENABLED,
    includeRouteComparison: PRACTICAL_ENABLED,
    targets: state.targets,
    swapLower: state.swapLower,
    halfHonor: state.halfHonor,
    honorPricePer5000: state.honorPriceMan * 10000,
    ...(PRACTICAL_ENABLED ? { abyssPrice: state.abyssPriceEok * 100000000 } : {}),
    allowMiracle: state.allowMiracle,
    allowBlack: circulatorAllowed("black"),
    allowChaos: circulatorAllowed("chaos"),
    allowAbyss: circulatorAllowed("abyss"),
    miracleCount: state.miracleCount,
    blackCount: state.blackCount,
    chaosCount: state.chaosCount,
    abyssCount: state.abyssCount,
  });
  const section = createResultCard("계산 결과");
  section.classList.add("ability-result-card", "ability-strategy-result");
  if (request.status === "loading") {
    section.append(element("div", "result-empty", "최적 전략을 계산하는 중…"));
    return section;
  }
  if (request.status === "error") {
    section.append(element("div", "result-empty", request.message));
    return section;
  }
  const detailedResult = request.result;
  const practical = PRACTICAL_ENABLED ? detailedResult.practicalStrategy : null;
  const comparison = PRACTICAL_ENABLED ? detailedResult.routeComparison : null;
  if (selectedComparison !== comparison) {
    selectedComparison = comparison;
    selectedRouteId = comparison?.routes.some((route) => route.id === initialSharedRouteId)
      ? initialSharedRouteId : comparison?.recommendedId ?? "";
    if (comparison) initialSharedRouteId = "";
  }
  const selectedRoute = comparison?.routes.find((route) => route.id === selectedRouteId);
  const result = selectedRoute?.result ?? practical ?? detailedResult;
  if (pendingPresetPlacement && state.useAdvanced && state.presetMode === "boss-legendary" &&
      pendingPresetPlacement === JSON.stringify(state.targets)) {
    pendingPresetPlacement = "";
    if (result.placementRecommendation) {
      state.targets = result.placementRecommendation.recommendedTargets.map((target) => ({ ...target, locked: false }));
      safeSave(state);
      queueMicrotask(render);
      section.append(element("div", "result-empty", "추천 배치를 적용하는 중…"));
      return section;
    }
  }
  if (result.error) {
    section.append(element("div", "result-empty", result.error));
    return section;
  }

  if (result.advancedUnnecessary) section.append(note("이 목표는 일반 명성치 재설정 경로의 총비용이 더 낮습니다."));
  const hero = element("div", "result-hero");
  hero.append(
    element("span", "result-hero__label", selectedRoute && selectedRoute.id !== comparison.recommendedId ? "선택 경로 평균 비용"
      : result.placementRecommendation ? "추천 배치 평균 비용" : "추천 전략 평균 비용"),
    element("strong", "", formatMeso(result.expectedTotalMeso)),
  );
  const metrics = [
    metric("평균 명성치", `${formatHonor(result.expectedHonor)} 명성치`),
    metric("명성치 환산 비용", formatMeso(result.expectedHonorMeso)),
    metric("평균 명성치 재설정", formatAttempts(result.expectedNormalResets ?? result.expectedHonorResets)),
  ];
  if (result.expectedAbyssMeso > 0) metrics.push(metric("심서큘 가치 합계", formatMeso(result.expectedAbyssMeso)));
  if (state.useAdvanced) metrics.push(
    metric("평균 고급 재설정", formatAttempts(result.expectedAdvancedResets)),
    metric("재설정 메소", formatMeso(result.expectedMeso)),
  );
  for (const [method, label] of [
    ["miracle", "미서큘"],
    ["black", "블서큘"],
    ["chaos", "카서큘"],
    ["abyss", "심서큘"],
  ]) {
    const amount = result.expectedCirculators[method];
    if (amount > 0) metrics.push(metric(
      `평균 ${label} 사용`,
      formatCirculatorCount(amount),
      result.strategyMode === "unlimited-reference" && method === "abyss" ? "사용 제한 없음" : `보유 ${result.inventory[method].toLocaleString("ko-KR")}개`,
    ));
  }
  section.append(hero, metricGrid(...metrics));
  if (comparison) routeComparisonCard = abilityRouteComparison(comparison, selectedRouteId, (id) => { selectedRouteId = id; render(); });
  if (result.objective !== "meso" && result.honorSaved > 0.5) {
    section.append(resultLine(
      state.useAdvanced
        ? result.placementRecommendation ? "추천 배치에서 고급 재설정만 사용할 때보다" : "고급 재설정만 사용할 때보다"
        : "명성치만 사용할 때보다",
      `${formatHonor(result.honorSaved)} 명성치 절약`,
      true,
    ));
  }

  const methodLabels = {
    honor: "명성치",
    advanced: "고급 재설정",
    miracle: "미서큘",
    black: "블서큘",
    chaos: "카서큘",
    abyss: "심서큘",
  };
  const strategy = element("ol", "ability-strategy-steps");
  if (result.placementRecommendation) strategy.append(placementRecommendationStep(result));
  result.steps.forEach((step, index) => {
    const item = element("li", "ability-strategy-step");
    const head = element("div", "ability-strategy-step__head");
    head.append(
      element("strong", "", step.economicGuide?.practical || step.economicGuide?.reference ? "단계별 진행 안내" : step.economicGuide ? "현재 상태에 맞춘 진행 안내"
        : `${index + 1 + (result.placementRecommendation ? 1 : 0)}. ${step.title ?? "명성치로 먼저 확보"}`),
      element("span", "", methodLabels[step.method]),
    );
    let amount = ["honor", "advanced"].includes(step.method)
      ? formatAttempts(step.expectedResets) : formatCirculatorCount(step.expectedResets);
    if (Number.isFinite(step.maximumUses)) {
      amount += ` · 최대 ${step.maximumUses.toLocaleString("ko-KR")}개`;
    }
    if (!step.economicGuide?.practical && !step.economicGuide?.reference) item.append(head);
    if (step.description) item.append(element("p", "", step.description));
    if (Number.isFinite(step.expectedResets)) item.append(element("small", "", `평균 ${amount}`));
    if (Number.isFinite(step.successProbability)) {
      item.append(element(
        "small",
        "ability-strategy-step__chance",
        `${step.successLabel ?? "보유량 안에서 성공할 확률"} ${formatProbability(step.successProbability, 2)}`,
      ));
    }
    appendStrategyInstructions(item, step);
    if (step.abyssGuide) item.append(abyssResultGuide(step.abyssGuide));
    if (step.branches) item.append(strategyBranchGuide(step.branches, index));
    if (step.flexibleGuide) item.append(flexibleAbilityGuide(step.flexibleGuide));
    if (step.economicGuide) item.append(economicAbilityGuide(step.economicGuide, head));
    strategy.append(item);
  });
  section.append(
    element("h3", "ability-strategy-title", "추천 진행 순서"),
    strategy,
    note(
      result.strategyMode === "unlimited-reference"
        ? "심서큘 보유량 제한 없이 진행하며, 현재 수치에 따라 재설정으로 전환할 시점을 판단합니다."
        : result.strategyMode === "practical-fixed"
        ? "실전 평균 비용은 표시된 잠금 조건과 결과 선택 기준을 따라 진행할 때의 값입니다."
        : result.strategyMode === "economic-adaptive"
        ? "목표 종류·등급·수치는 유지하며, 나온 옵션의 수치와 남은 서큘레이터에 따라 배치와 진행 순서를 결정합니다."
        : result.strategyMode === "flexible-lower-acquisition"
        ? "입력한 목표 종류·등급·수치는 유지하며, 확보한 아랫줄에 따라 첫 줄의 배치와 심서큘 사용 시점을 결정합니다."
        : state.useAdvanced
        ? "고급 재설정과 일반 명성치·서큘레이터로 한 줄을 먼저 완성하는 경로를 비교합니다. 아랫줄 레전드리 목표를 선택하면 블서큘·카서큘을 제외합니다."
        : "입력한 보유량 안에서 고정 순서와 다른 목표가 먼저 완성되는 적응형 경로를 함께 비교합니다. 한 줄의 종류·등급을 확보하고 블서큘·카서큘로 수치를 맞춘 뒤 잠그는 경로도 포함합니다.",
    ),
    note(
      PRACTICAL_ENABLED
        ? "명성치 환산 비용·재설정 메소·평균 사용한 심서큘의 가치를 합산합니다."
        : "명성치 환산 비용과 재설정 메소를 합산해 비교합니다. 보유 서큘레이터는 추가 비용 0원으로 계산합니다.",
    ),
    abilityBasis(),
  );
  if (result.expectedCirculators.abyss > 0 && !["economic-adaptive", "practical-fixed", "unlimited-reference"].includes(result.strategyMode)) section.append(note(
    result.flexibleComparison
      ? "심서큘은 한 줄·두 줄·세 줄 확보 후 사용하는 경로를 비교합니다. 소진 후에도 완성된 줄을 활용하며, 평균 계산에서 현재 수치는 공식 분포를 따릅니다."
      : "심서큘은 한 줄부터 쓰는 경로와 세 줄의 종류·등급을 확보한 뒤 쓰는 경로를 비교합니다. 세 줄 경로에서는 일부만 완성된 결과의 활용과 소진 후 잠금 선택도 반영합니다. 현재 수치는 공식 분포로 평균합니다.",
  ));
  return section;
}

function abilityReachChanceControl(result) {
  const averageChance = () => state.method === "abyss"
    ? normalizeTargetChance(Number((calculateAbilityAbyssChanceWithin(result, result.expectedResets) * 100).toFixed(2)))
    : averageEquivalentTargetChancePercent(result.probability);
  const initialChancePercent = state.targetChanceAverage
    ? averageChance()
    : state.targetChancePercent;

  const attemptsMetric = metric("목표 도달 재설정", "-");
  const resourceMetric = metric(
    ["honor", "advanced"].includes(state.method) ? "목표 도달 명성치" : "목표 도달 서큘레이터",
    "-",
  );
  const paint = (chancePercent, averageMode) => {
    const chance = chancePercent / 100;
    const attempts = result.complete
      ? 0
      : averageMode
        ? result.expectedResets
        : state.method === "abyss" ? calculateAbilityAbyssAttemptsForChance(result, chance)
          : calculateAbilityAttemptsForChance(result.probability, chance);
    const resource = attempts * result.resourcePerReset;
    attemptsMetric.querySelector("span").textContent = `${chancePercent.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}% 도달 재설정`;
    attemptsMetric.querySelector("strong").textContent = formatAttempts(attempts);
    resourceMetric.querySelector("span").textContent = `${chancePercent.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}% 도달 ${["honor", "advanced"].includes(state.method) ? "명성치" : "서큘레이터"}`;
    resourceMetric.querySelector("strong").textContent = formatResource(resource);
  };

  return createReachChanceControl({
    id: "ability-target-chance-range",
    label: "목표 도달 확률",
    className: "ability-reach-control",
    value: initialChancePercent,
    min: TARGET_CHANCE_MIN,
    max: TARGET_CHANCE_MAX,
    average: state.targetChanceAverage,
    averageValue: averageChance,
    resetTitle: "평균 재설정 횟수 기준으로 봅니다.",
    metrics: [attemptsMetric, resourceMetric],
    normalize: normalizeTargetChance,
    onChange: (value, { average }) => {
      state.targetChancePercent = value;
      state.targetChanceAverage = average;
      paint(value, average);
    },
    onCommit: () => safeSave(state),
  });
}

function resultCard() {
  if (state.method === "optimal") return optimalResultCard();
  const result = calculateAbilityExpected({
    method: state.method,
    targets: state.targets,
    swapLower: !valueOnlyMethod() && state.swapLower,
    halfHonor: state.halfHonor,
  });
  const section = createResultCard("계산 결과");
  section.classList.add("ability-result-card");
  if (result.error) {
    section.append(element("div", "result-empty", result.error));
    return section;
  }

  const hero = element("div", "result-hero");
  hero.append(
    element(
      "span",
      "result-hero__label",
      result.complete
        ? "현재 상태"
        : ["honor", "advanced"].includes(state.method) ? "평균 명성치" : "평균 서큘레이터",
    ),
    element(
      "strong",
      "",
      result.complete ? "목표 달성" : formatResource(result.expectedResource),
    ),
  );
  const metrics = [
    metric("평균 재설정", result.complete ? "0회" : formatAttempts(result.expectedResets)),
    metric(
      "1회 재화",
      result.complete ? "0" : formatResource(result.resourcePerReset),
      ["honor", "advanced"].includes(state.method)
        ? `${result.lockCount}줄 잠금${["honor", "advanced"].includes(state.method) && state.halfHonor ? " · 반값" : ""}`
        : state.method === "miracle" ? "최대 수치 확정" : "옵션·등급 유지",
    ),
  ];
  if (state.method === "advanced") metrics.push(
    metric("평균 필요 메소", formatMeso(result.expectedMeso ?? 0)),
    metric("1회 필요 메소", formatMeso(result.mesoPerReset ?? 0)),
  );
  section.append(
    hero,
    metricGrid(...metrics),
    abilityReachChanceControl(result),
    resultLine("1회 성공 확률", result.complete ? "이미 달성" : formatOdds(result.probability), true),
    resultLine("재설정 방식", ABILITY_RESET_METHODS[state.method].label),
  );
  section.append(
    note(
      valueOnlyMethod()
        ? state.method === "black"
          ? "현재 옵션 종류와 등급은 유지하고 수치만 재설정합니다. 블서큘은 재설정 전후 결과를 선택할 수 있습니다."
          : "현재 옵션 종류와 등급은 유지하고 수치만 재설정합니다."
        : state.swapLower && !state.targets.slice(1).some((target) => target.locked)
        ? "두 번째와 세 번째 목표는 어느 아랫줄에 등장해도 성공으로 계산합니다."
        : "각 목표는 지정한 줄에 등장해야 성공으로 계산합니다.",
    ),
  );
  if (state.method === "advanced") section.append(note(
    "잠근 줄은 확보한 것으로 계산합니다. 나머지 현재 옵션은 공식 분포로 평균하며 동일 결과 재추첨을 반영합니다. 목표 도달 확률별 횟수는 이 평균을 이용한 근사값입니다.",
  ));
  if (state.method === "abyss") section.append(note(
    "현재 수치는 목표 미달 상태의 공식 분포로 평균합니다. 동일 결과 재추첨을 반영하며, 세 줄이 모두 목표에 도달할 때만 새 결과를 적용하는 기준입니다.",
  ));
  section.append(abilityBasis());
  return section;
}

function render() {
  if (state.method !== "optimal") stopOptimalStrategyWorker();
  routeComparisonCard = null;
  const grid = element("div", "calculator-grid calculator-grid--ability");
  const controls = element("div", "calculator-column");
  controls.append(setupCard(), targetsCard());
  const result = element("div", "calculator-result");
  result.append(resultCard());
  if (routeComparisonCard) controls.append(routeComparisonCard);
  grid.append(controls, result);
  renderWithFocus(root, [grid]);
}

render();
window.addEventListener("pagehide", stopOptimalStrategyWorker, { once: true });

registerResultShare(() => ({ local: { [STORAGE_KEY]: state }, view: { routeId: selectedRouteId } }));
