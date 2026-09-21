import {
  POTENTIAL_GRADES,
  POTENTIAL_PARTS,
  calculatePotentialRankUpExpected,
  calculatePotentialRankUpReachForChance,
  calculatePotentialExpected,
  calculatePrimePotentialExpected,
  calculateResetsForChance,
  convertPotentialTargetToEquivalents,
  getAvailablePotentialResetMethods,
  getAvailablePotentialTargetTypes,
  getPotentialRankUpInfo,
  getPotentialResetCost,
  getPotentialResetMethod,
  getPotentialSuccessCombinations,
} from "maple-core/potential";
import { loadPotentialTables } from "./potential-tables.js";
import {
  potentialCalculatorLayout, potentialOptionSet, potentialSelectorGroup, potentialTargetItem,
} from "./potential-form-ui.js";
import {
  MAX_POTENTIAL_TARGET_SETS,
  getRegularOptimalPreset,
  materializePresetTargetSets,
  supportsRegularOptimalPreset,
} from "./potential-presets.js";
import {
  MAX_STAT_EQUIVALENT_COMBINATIONS,
  getStatEquivalentSuccessCombinations,
} from "./potential-equivalence-options.js";
import {
  DEFAULT_TARGET_CHANCE_PERCENT,
  MAX_TARGET_CHANCE_PERCENT as MAX_TARGET_CHANCE,
  MIN_TARGET_CHANCE_PERCENT as MIN_TARGET_CHANCE,
  getPotentialTargetInfo,
  getPotentialTargetTypesForRow,
  isCompletePotentialTarget,
  migratePrimePotentialTargetSets,
  migratePotentialTargetChanceDefault,
  normalizePotentialTargetChance,
  orderPotentialTargetTypes,
  summarizePotentialTargetEquivalents,
} from "./potential-target-ui.js";
import { renderToolNav } from "./shell.js";
import { chip, field, numberInput, toggleChip } from "./ui.js";
import {
  card,
  cardWithHead,
  chipRow,
  createReachChanceControl,
  element,
  formatAttempts,
  formatMeso,
  formatMesoPreciseMan,
  formatProbability,
  metric,
  metricGrid,
  searchableSelect,
  note,
  potentialResetCostPanel,
  renderWithFocus,
  resetAction,
  resultCard as createResultCard,
  resultLine,
  row,
  details,
} from "./calculator-ui.js";
import {
  characterProfileCard,
  getActiveProfile,
  getCalculationProfile,
  subscribeCharacterProfile,
} from "./character-profile.js";
import { getProfileSubStats } from "./profile-stat-equivalence.js";
import { mountCombinedPotentialSystem } from "./combined-potential-page.js";
import {
  loadSharedPotentialEquipment,
  saveSharedPotentialEquipment,
} from "./potential-equipment-state.js";

const GRADE_NAMES = Object.fromEntries(
  Object.entries(POTENTIAL_GRADES).map(([id, grade]) => [id, grade.label]),
);
const gradeButtonLabel = (grade) =>
  grade === "legendary" ? "레전" : GRADE_NAMES[grade];
const MAX_TARGETS = 3;
const MAX_TARGET_SETS = MAX_POTENTIAL_TARGET_SETS;
const EMPTY_TARGETS_REVISION = 1;
const STATS = ["STR", "DEX", "INT", "LUK"];
const MAX_SAVED_TARGET_PRESETS = 20;

function formatPotentialResetMeso(value, methodInfo) {
  return methodInfo.usesMeso
    ? formatMeso(value)
    : formatMesoPreciseMan(value);
}

function safeLoad(key, fallback) {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key)) };
  } catch {
    return structuredClone(fallback);
  }
}

function safeSave(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 비공개 모드처럼 저장이 막힌 경우 현재 탭에서만 유지한다.
  }
}

function safeLoadList(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function hasSavedState(key) {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function displayedResetMethods(system, grade) {
  return getAvailablePotentialResetMethods(system, grade);
}

function mountPotentialSystem({ system, onSystemChange }) {
  const isAdditional = system === "additional";
  const toolId = isAdditional ? "additional" : "potential";
  const getPotentialProfile = () =>
    getActiveProfile({ capability: "potentialEquivalence" });
  const storageKey = `maplestarforce:${toolId}:v6`;
  const targetPresetStorageKey = `maplestarforce:${toolId}:target-presets:v1`;
  const multiSetStorageKey = `maplestarforce:${toolId}:v5`;
  const previousStorageKey = `maplestarforce:${toolId}:v4`;
  const legacyStorageKey = `maplestarforce:${toolId}:v3`;
  const baseDefaults = {
    part: 6,
    itemLevel: 200,
    grade: "legendary",
    resetMethod: "meso",
    primeTargetSets: null,
    mainStat: "STR",
    subStat: "DEX",
    attackType: "attack",
    characterLevel: 290,
    enemyDefense: 380,
    calculationMode: "options",
    rankProgressByGrade: { rare: 0, epic: 0, unique: 0 },
    rankTargetGrade: "",
    miracle: false,
    showEquivalence: false,
    presetIncludeIgnoreDefense: false,
    presetIncludePpyogong: false,
    presetIncludeNearOptimal: false,
    presetIncludeDropMeso: true,
    statEquivalentSortDirection: "asc",
    successConditionsOpen: false,
    targetChancePercent: DEFAULT_TARGET_CHANCE_PERCENT,
  };
  const defaultTargets = [
    { type: "", value: "" },
    { type: "", value: "" },
    { type: "", value: "" },
  ];
  const defaults = {
    ...baseDefaults,
    targetSets: [{ targets: structuredClone(defaultTargets) }],
  };
  const previousDefaults = {
    ...baseDefaults,
    targets: structuredClone(defaultTargets),
    comparisonTargets: null,
  };
  const hasCurrentState = hasSavedState(storageKey);
  const hasMultiSetState = hasSavedState(multiSetStorageKey);
  const hasPreviousState = hasSavedState(previousStorageKey);
  let state;
  if (hasCurrentState) {
    state = safeLoad(storageKey, defaults);
  } else if (hasMultiSetState) {
    state = safeLoad(multiSetStorageKey, defaults);
  } else if (hasPreviousState) {
    const previous = safeLoad(previousStorageKey, previousDefaults);
    const previousSets = [previous.targets, previous.comparisonTargets]
      .filter((targets) => Array.isArray(targets) && targets.length)
      .map((targets) => ({ targets: structuredClone(targets) }));
    state = {
      ...defaults,
      ...previous,
      targetSets: previousSets.length
        ? previousSets
        : structuredClone(defaults.targetSets),
    };
  } else {
    const legacy = safeLoad(legacyStorageKey, previousDefaults);
    const migratedTargets = Array.isArray(legacy.targets) && legacy.targets.length
      ? legacy.targets.map((target) => ({
          type: target.type === "attack-percent"
            ? legacy.attackType === "magic"
              ? "magic-power-percent"
              : "attack-power-percent"
            : target.type,
          value: "",
        }))
      : structuredClone(defaultTargets);
    state = {
      ...defaults,
      ...legacy,
      targetSets: [{ targets: migratedTargets }],
    };
  }
  delete state.fixedFirstOption;
  const gradeProgressDefaults = { rare: 0, epic: 0, unique: 0 };
  const loadedGradeProgress =
    state.rankProgressByGrade && typeof state.rankProgressByGrade === "object"
      ? state.rankProgressByGrade
      : {};
  state.rankProgressByGrade = Object.fromEntries(
    Object.keys(gradeProgressDefaults).map((grade) => [
      grade,
      Math.max(0, Math.round(Number(loadedGradeProgress[grade]) || 0)),
    ]),
  );
  if (
    Object.hasOwn(state, "rankProgress") &&
    Object.hasOwn(state.rankProgressByGrade, state.grade)
  ) {
    state.rankProgressByGrade[state.grade] = Math.max(
      state.rankProgressByGrade[state.grade],
      Math.max(0, Math.round(Number(state.rankProgress) || 0)),
    );
  }
  delete state.rankProgress;
  if (!["options", "rank-up"].includes(state.calculationMode)) {
    state.calculationMode = "options";
  }
  if (!["asc", "desc"].includes(state.statEquivalentSortDirection)) {
    state.statEquivalentSortDirection = "asc";
  }
  state.successConditionsOpen = state.successConditionsOpen === true;
  delete state.targets;
  delete state.comparisonTargets;
  Object.assign(state, migratePotentialTargetChanceDefault(state));
  Object.assign(state, loadSharedPotentialEquipment(state));
  if (state.emptyTargetsRevision !== EMPTY_TARGETS_REVISION) {
    // 장비·등급 설정은 유지하고, 새 빈 기본값은 기존 사용자에게도 한 번 적용한다.
    state.targetSets = structuredClone(defaults.targetSets);
    state.emptyTargetsRevision = EMPTY_TARGETS_REVISION;
  }
  const rawSets = Array.isArray(state.targetSets) && state.targetSets.length
    ? state.targetSets
    : defaults.targetSets;
  state.targetSets = rawSets.slice(0, MAX_TARGET_SETS).map((set) => {
    const rawTargets = Array.isArray(set)
      ? set
      : Array.isArray(set?.targets)
        ? set.targets
        : [];
    const targets = rawTargets.length
      ? rawTargets.slice(0, MAX_TARGETS).map((target) => ({ ...target }))
      : structuredClone(defaultTargets);
    while (targets.length < MAX_TARGETS) {
      targets.push({ type: "", value: "" });
    }
    return { targets };
  });
  const savedPrimeSets = normalizedPresetTargetSets(state.primeTargetSets);
  state.primeTargetSets = savedPrimeSets.length ? savedPrimeSets : [{ targets: [
    { type: "", value: "" },
    ...Array.from({ length: 2 }, (_, index) => ({
      type: typeof state.primeLineTargets?.[index]?.type === "string" ? state.primeLineTargets[index].type : "",
      value: state.primeLineTargets?.[index]?.value ?? "",
    })),
  ] }];
  for (const set of state.primeTargetSets) set.targets[0] = { type: "", value: "" };
  if (state.primeTargetMode !== "sum") {
    state.primeTargetSets = migratePrimePotentialTargetSets(state.primeTargetSets);
    state.primeTargetMode = "sum";
  }
  delete state.primeLineTargets;
  if (!displayedResetMethods(system, state.grade).some(
    (method) => method.id === state.resetMethod,
  )) {
    state.resetMethod = "meso";
  }
  if (
    state.calculationMode === "rank-up" &&
    !getPotentialRankUpInfo({
      system,
      method: state.resetMethod,
      grade: state.grade,
    }).canRankUp
  ) {
    state.calculationMode = "options";
  }
  let savedTargetPresets = safeLoadList(targetPresetStorageKey)
    .filter((preset) =>
      preset &&
      typeof preset.id === "string" &&
      typeof preset.name === "string" &&
      Array.isArray(preset.targetSets)
    )
    .slice(0, MAX_SAVED_TARGET_PRESETS);
  let migratedPrimePreset = false;
  savedTargetPresets = savedTargetPresets.map((preset) => {
    if (preset.resetMethod !== "prime" || preset.primeTargetMode === "sum") return preset;
    migratedPrimePreset = true;
    return {
      ...preset,
      primeTargetMode: "sum",
      targetSets: migratePrimePotentialTargetSets(normalizedPresetTargetSets(preset.targetSets)),
      expectation: null,
    };
  });
  if (migratedPrimePreset) persistTargetPresets();
  if (!getPotentialProfile()) {
    state.showEquivalence = false;
  }
  safeSave(storageKey, state);
  saveSharedPotentialEquipment(state);

  const root = document.querySelector("#tool");
  let tables = null;
  let tableState = "loading";
  let tableMessage = "확률표를 읽는 중입니다…";
  let loadedKey = "";
  let requestId = 0;
  let availableTargetTypes = [];
  let disposed = false;

  const profileUnsubscribe = subscribeCharacterProfile(() => {
    if (disposed) return;
    const profile = getPotentialProfile();
    let changed = normalizeTargetSets();
    if (!profile && state.showEquivalence) {
      state.showEquivalence = false;
      changed = true;
    }
    if (changed) persist();
    render();
  });

  function persist() {
    safeSave(storageKey, state);
    saveSharedPotentialEquipment(state);
  }

  function persistTargetPresets() {
    safeSave(targetPresetStorageKey, savedTargetPresets);
  }

  function targetSetsKey() {
    return state.resetMethod === "prime" ? "primeTargetSets" : "targetSets";
  }

  function activeResetMethod() {
    return getPotentialResetMethod(system, state.resetMethod);
  }

  function rankUpContext() {
    const rankInfo = getPotentialRankUpInfo({
      system,
      method: state.resetMethod,
      grade: state.grade,
      miracle: state.miracle,
    });
    if (!rankInfo.canRankUp) {
      return {
        rankInfo,
        targetGrades: [],
        targetGrade: null,
        plan: null,
      };
    }
    const grades = Object.keys(POTENTIAL_GRADES);
    const targetGrades = grades.slice(
      grades.indexOf(state.grade) + 1,
      grades.indexOf(rankInfo.maxGrade) + 1,
    );
    const targetGrade = targetGrades.includes(state.rankTargetGrade)
      ? state.rankTargetGrade
      : targetGrades[0];
    return {
      rankInfo,
      targetGrades,
      targetGrade,
      plan: calculatePotentialRankUpExpected({
        system,
        method: state.resetMethod,
        fromGrade: state.grade,
        toGrade: targetGrade,
        itemLevel: state.itemLevel,
        miracle: state.miracle,
        rankProgressByGrade: state.rankProgressByGrade,
      }),
    };
  }

  function update(mutator, { reload = false } = {}) {
    mutator();
    persist();
    render();
    if (reload) ensureTables();
  }

  function numberControl(key, value, onValue, options = {}) {
    const { update: updateOptions, ...inputOptions } = options;
    const input = numberInput(
      value,
      (next) => update(() => onValue(next), updateOptions),
      inputOptions,
    );
    input.dataset.key = key;
    return input;
  }

  function tableKey() {
    return `${activeResetMethod().tableSource}:${state.grade}:${state.part}:${Math.round(state.itemLevel)}`;
  }

  function targetTypesForRow(targets, index, { includeProfileTargets = false } = {}) {
    const hasProfile = includeProfileTargets || Boolean(getPotentialProfile());
    if (activeResetMethod().fixedFirstLine) {
      if (index === 0) return [];
      const types = tables ? getAvailablePotentialTargetTypes(tables.slice(1), { part: Number(state.part), system }) : [];
      return getPotentialTargetTypesForRow({
        availableTargetTypes: orderPotentialTargetTypes(types, { system }),
        targets: targets.slice(1), index: index - 1, hasProfile,
      });
    }
    return getPotentialTargetTypesForRow({
      availableTargetTypes,
      targets,
      index,
      hasProfile,
    });
  }

  function normalizeTargetSet(targetSet) {
    let changed = false;
    for (let index = 0; index < targetSet.targets.length; index += 1) {
      const target = targetSet.targets[index];
      if (activeResetMethod().fixedFirstLine && index === 0) continue;
      if (target.type === "") {
        if (target.value !== "") {
          target.value = "";
          changed = true;
        }
        continue;
      }
      const allowedTypes = targetTypesForRow(targetSet.targets, index);
      if (!allowedTypes.includes(target.type)) {
        target.type = "";
        target.value = "";
        changed = true;
      }
    }
    return changed;
  }

  function normalizeTargetSets() {
    if (availableTargetTypes.length === 0) return false;
    return state[targetSetsKey()].reduce(
      (changed, targetSet) => normalizeTargetSet(targetSet) || changed,
      false,
    );
  }

  async function ensureTables() {
    const key = tableKey();
    if (key === loadedKey && (tables || tableState === "missing")) return;
    const thisRequest = ++requestId;
    loadedKey = key;
    tables = null;
    availableTargetTypes = [];
    tableState = "loading";
    tableMessage = "확률표를 읽는 중입니다…";
    render();
    try {
      const tableSource = activeResetMethod().tableSource;
      const next = await loadPotentialTables({
        system: tableSource,
        grade: state.grade,
        part: Number(state.part),
        itemLevel: Math.round(state.itemLevel),
      });
      if (disposed || thisRequest !== requestId) return;
      tables = next;
      tableState = next ? "ready" : "missing";
      availableTargetTypes = next
        ? orderPotentialTargetTypes(
            getAvailablePotentialTargetTypes(next, {
              part: Number(state.part),
              system,
            }),
            { system },
          )
        : [];
      const normalizedTarget = normalizeTargetSets();
      if (normalizedTarget) persist();
      tableMessage = next
        ? ""
        : "이 부위·등급·레벨 조합은 공식 확률표에 없습니다.";
    } catch (error) {
      if (disposed || thisRequest !== requestId) return;
      tables = null;
      tableState = "error";
      tableMessage = error?.message || "확률표를 읽지 못했습니다.";
    }
    render();
  }

  function targetControl(target, index, targetSet, { keyPrefix, groupLabel }) {
    const targets = targetSet.targets;
    const firstLineDisabled = activeResetMethod().fixedFirstLine && index === 0;
    const allowedTypes = targetTypesForRow(targets, index);
    // 캐릭터 환산 목표도 목록에 표시하되, 정보가 없으면 선택할 수 없게 한다.
    const visibleTypes = targetTypesForRow(targets, index, { includeProfileTargets: true });
    const targetOptions = [
      { value: "", label: "없음" },
      ...visibleTypes
        .filter((value) => getPotentialTargetInfo(value))
        .map((value) => ({
          value,
          label: getPotentialTargetInfo(value).label,
          disabled: !allowedTypes.includes(value),
          disabledReason: value === "stat-equivalent" && !allowedTypes.includes(value)
            ? "내 캐릭터 정보를 불러오면 사용할 수 있습니다."
            : "",
        })),
    ];
    const select = searchableSelect(targetOptions, target.type, (value) => {
      if (value && !allowedTypes.includes(value)) return;
      update(() => {
        target.type = value;
        target.value = "";
        normalizeTargetSet(targetSet);
      });
    }, {
      key: `${keyPrefix}target-${index}-type`,
      ariaLabel: `${groupLabel}의 ${index + 1}번째 옵션`,
      placeholder: "옵션 검색",
      clearable: true,
      disabled: firstLineDisabled,
    });
    select.disabled = firstLineDisabled || allowedTypes.length === 0;
    const targetInfo = getPotentialTargetInfo(target.type);
    select.title = targetInfo?.label ?? `${groupLabel}의 ${index + 1}번째 옵션`;
    const value = numberControl(
      `${keyPrefix}target-${index}-value`,
      target.value,
      (next) => {
        target.value = next;
      },
      {
        min: targetInfo?.exact ? "1" : "0",
        max: targetInfo?.exact ? "3" : "999",
        step: target.type === "stat-equivalent" ? "any" : "1",
        allowEmpty: true,
        allowDecimalDraft: target.type === "stat-equivalent",
      },
    );
    value.disabled = firstLineDisabled || !targetTypesForRow(targets, index).includes(target.type);
    value.setAttribute("aria-label", `${groupLabel}의 ${index + 1}번째 최소 수치`);
    return potentialTargetItem({ select, value, unit: targetInfo?.unit ?? "", disabled: firstLineDisabled });
  }

  function optionSetControl(targetSet, setIndex) {
    const targets = targetSet.targets;
    const label = `옵션 세트 ${setIndex + 1}`;
    const keyPrefix = `set-${setIndex}-`;
    const set = potentialOptionSet({
      label,
      targets: targets.map((target, index) => targetControl(
        target, index, targetSet, { keyPrefix, groupLabel: label },
      )),
      onRemove: state[targetSetsKey()].length > 1 ? () => update(() => {
        state[targetSetsKey()].splice(setIndex, 1);
      }) : null,
    });
    const equivalenceText = state.showEquivalence && getPotentialProfile()
      ? targetSetEquivalenceText(targets)
      : "";
    if (equivalenceText) {
      set.append(element("p", "option-set__equivalence", equivalenceText));
    }
    return set;
  }

  function formatGrade(value) {
    return Number(value).toLocaleString("ko-KR", {
      maximumFractionDigits: 2,
    });
  }

  function targetSetEquivalenceText(targets) {
    const completed = completeTargets(targets);
    if (completed.length === 0) return "";
    const activeProfile = getPotentialProfile();
    if (!activeProfile) return "";
    const equivalents = completed.map((target) => {
      const fallback = {
        label: targetSummary(target),
        mainStatPercent: null,
        attackPercent: null,
      };
      try {
        const equivalent = convertPotentialTargetToEquivalents({
          targetType: target.type,
          target: Number(target.value),
          statEquivalence: activeProfile.statEquivalence ?? {},
          enemyDefense: Number(state.enemyDefense),
          mainStat: activeProfile.mainStat,
          subStat: activeProfile.subStat,
          subStats: getProfileSubStats(activeProfile),
          attackType: activeProfile.attackType,
          characterLevel: Number(
            activeProfile.character?.level ?? state.characterLevel,
          ),
        });
        return { ...fallback, ...equivalent };
      } catch {
        return fallback;
      }
    });
    return summarizePotentialTargetEquivalents(equivalents);
  }

  function equipmentCard() {
    const partOptions = Object.entries(POTENTIAL_PARTS)
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) =>
        Number(left.label === "한벌옷") - Number(right.label === "한벌옷")
      );
    const part = searchableSelect(partOptions, state.part, (value) => {
      update(() => {
        state.part = Number(value);
      }, { reload: true });
    }, { key: "part", ariaLabel: "장비 부위", placeholder: "부위 검색" });
    const level = numberControl("item-level", state.itemLevel, (value) => {
      state.itemLevel = Math.max(0, Math.min(250, Math.round(value)));
    }, { min: "0", max: "250", update: { reload: true } });
    const systemPicker = chipRow(
      chip("윗잠", system === "regular", () => {
        if (system !== "regular") onSystemChange("regular");
      }),
      chip("아랫잠", system === "additional", () => {
        if (system !== "additional") onSystemChange("additional");
      }),
      chip("통합", false, () => onSystemChange("combined")),
    );
    systemPicker.classList.add("potential-system-switch");
    systemPicker.setAttribute("role", "group");
    systemPicker.setAttribute("aria-label", "잠재능력 종류");
    const gradeChips = Object.keys(POTENTIAL_GRADES).map((grade) =>
      chip(gradeButtonLabel(grade), state.grade === grade, () => {
        update(() => {
          state.grade = grade;
          state.rankTargetGrade = "";
          if (!displayedResetMethods(system, grade).some(
            (method) => method.id === state.resetMethod,
          )) {
            state.resetMethod = "meso";
          }
          if (!getPotentialRankUpInfo({
            system,
            method: state.resetMethod,
            grade,
          }).canRankUp) {
            state.calculationMode = "options";
          }
        }, { reload: true });
      }),
    );
    const gradePicker = chipRow(gradeChips);
    gradePicker.classList.add("potential-grade-picker");
    const gradePickerGroup = potentialSelectorGroup("현재 등급", gradePicker);
    const availableMethods = displayedResetMethods(system, state.grade);
    const methodChips = availableMethods.map((method) => {
      const control = chip(
        method.shortLabel,
        state.resetMethod === method.id,
        () => {
          if (state.resetMethod === method.id) return;
          update(() => {
            state.resetMethod = method.id;
            state.rankProgressByGrade = { rare: 0, epic: 0, unique: 0 };
            if (!getPotentialRankUpInfo({
              system,
              method: method.id,
              grade: state.grade,
            }).canRankUp) {
              state.calculationMode = "options";
            }
          }, { reload: true });
        },
      );
      control.title = method.id === "meso"
        ? `${method.shortLabel} · 옵션 등장 확률은 같으며 등급 상승과 비용은 메소 재설정 기준`
        : `${method.label} 공식 옵션 등장 확률`;
      return control;
    });
    const methodPicker = element("div", "potential-reset-method");
    methodPicker.append(
      element("p", "potential-reset-method__label", "재설정 방식"),
      chipRow(methodChips),
    );

    const rankInfo = getPotentialRankUpInfo({
      system,
      method: state.resetMethod,
      grade: state.grade,
      miracle: state.miracle,
    });
    const calculationModePicker = chipRow(
      chip("옵션뽑기", state.calculationMode === "options", () => {
        if (state.calculationMode !== "options") {
          update(() => { state.calculationMode = "options"; });
        }
      }),
      chip("등급업", state.calculationMode === "rank-up", () => {
        if (state.calculationMode !== "rank-up" && rankInfo.canRankUp) {
          update(() => { state.calculationMode = "rank-up"; });
        }
      }, !rankInfo.canRankUp),
    );
    calculationModePicker.classList.add("potential-calculation-mode");
    calculationModePicker.setAttribute("role", "group");
    calculationModePicker.setAttribute("aria-label", "잠재능력 계산 종류");
    const calculationModeGroup = potentialSelectorGroup("목표", calculationModePicker, "target");
    if (!rankInfo.canRankUp) {
      calculationModePicker.lastElementChild.title = state.grade === "legendary"
        ? "레전드리는 최고 등급입니다."
        : `${activeResetMethod().label}으로 더 높은 등급에 올릴 수 없습니다.`;
    }

    let resetCost = null;
    try {
      resetCost = getPotentialResetCost(
        state.itemLevel,
        state.grade,
        system,
        state.resetMethod,
      );
    } catch {
      // 입력 중 범위를 벗어난 순간에는 표지만 유지한다.
    }
    const section = card(
      "장비/등급",
      row(field("부위", part)),
      row(field("장비 레벨", level)),
      systemPicker,
      gradePickerGroup,
      methodPicker,
      calculationModeGroup,
    );
    if (resetCost !== null) {
      const methodInfo = activeResetMethod();
      calculationModeGroup.after(potentialResetCostPanel([{
        label: system === "regular" ? "윗잠" : "아랫잠",
        cost: resetCost,
      }], {
        title: methodInfo.usesMeso
          ? "1회 메소 재설정"
          : "1회 큐브 사용 메소",
        formatCost: (cost) => formatPotentialResetMeso(cost, methodInfo),
      }));
    }
    return section;
  }

  function rankUpTargetCard() {
    const { rankInfo, targetGrades, targetGrade, plan } = rankUpContext();
    if (!rankInfo.canRankUp || !plan) {
      return card(
        "등급업 목표",
        note(
          state.grade === "legendary"
            ? "레전드리는 최고 등급입니다."
            : `${activeResetMethod().label}으로 더 높은 등급에 올릴 수 없습니다.`,
        ),
      );
    }

    const resetProgress = resetAction("천장 초기화", () => update(() => {
      state.rankProgressByGrade = { rare: 0, epic: 0, unique: 0 };
    }), {
      className: "button--compact",
      title: "모든 등급의 현재 천장 진행을 0으로 되돌립니다.",
      key: "reset-rank-progress",
    });
    const chancePicker = chipRow(
      chip("일반 확률", !state.miracle, () => update(() => {
        state.miracle = false;
      })),
      chip("미라클 타임", state.miracle, () => update(() => {
        state.miracle = true;
      })),
    );
    chancePicker.setAttribute("role", "group");
    chancePicker.setAttribute("aria-label", "등급 상승 확률 적용 방식");
    const targetGradePicker = chipRow(
      targetGrades.map((grade) =>
        chip(gradeButtonLabel(grade), targetGrade === grade, () => {
          update(() => { state.rankTargetGrade = grade; });
        }),
      ),
    );
    targetGradePicker.setAttribute("role", "group");
    targetGradePicker.setAttribute("aria-label", "등급 상승 목표 등급");
    const progressFields = plan.stages
      .filter((stage) => stage.pity !== null)
      .map((stage) => {
        const maxProgress = stage.pity - 1;
        const control = numberControl(
          `rank-progress-${stage.fromGrade}`,
          stage.progress,
          (value) => {
            state.rankProgressByGrade[stage.fromGrade] = Math.max(
              0,
              Math.min(maxProgress, Math.round(value)),
            );
          },
          { min: "0", max: String(maxProgress) },
        );
        const progressField = field(
          `${GRADE_NAMES[stage.fromGrade]} → ${GRADE_NAMES[stage.toGrade]} 천장 (최대 ${maxProgress})`,
          control,
        );
        progressField.title = `${GRADE_NAMES[stage.fromGrade]}에서 ${GRADE_NAMES[stage.toGrade]}로 상승하는 현재 천장 진행`;
        return progressField;
      });
    const progressRow = progressFields.length ? row(progressFields) : null;
    progressRow?.classList.add("potential-rank-progress");

    return cardWithHead(
      "등급업 목표",
      resetProgress,
      row(field("확률 적용", chancePicker)),
      row(field("목표 등급", targetGradePicker)),
      progressRow,
      plan.maximumAttempts === null
        ? note("이 재설정 방식은 등급 상승 보장 횟수가 없습니다.")
        : null,
    );
  }

  function targetCard() {
    if (state.calculationMode === "rank-up") {
      return rankUpTargetCard();
    }
    const activeTypes = state[targetSetsKey()].flatMap((targetSet) =>
      targetSet.targets.map((target) => target.type),
    );
    const profile = getPotentialProfile();
    const setList = element("div", "option-sets");
    state[targetSetsKey()].forEach((targetSet, setIndex) => {
      if (setIndex > 0) {
        const separator = element("div", "option-set-or", "또는");
        separator.setAttribute("aria-hidden", "true");
        setList.append(separator);
      }
      setList.append(optionSetControl(targetSet, setIndex));
    });
    const addSet = element("button", "button option-set-add", "+ 옵션 세트 추가");
    addSet.type = "button";
    addSet.disabled =
      state[targetSetsKey()].length >= MAX_TARGET_SETS ||
      tableState !== "ready" ||
      availableTargetTypes.length === 0;
    addSet.title = state[targetSetsKey()].length >= MAX_TARGET_SETS
      ? `옵션 세트는 최대 ${MAX_TARGET_SETS}개까지 만들 수 있습니다.`
      : "다른 성공 조건을 추가합니다.";
    addSet.addEventListener("click", () => update(() => {
      if (state[targetSetsKey()].length >= MAX_TARGET_SETS) return;
      const targetSet = { targets: structuredClone(defaultTargets) };
      state[targetSetsKey()].push(targetSet);
      normalizeTargetSet(targetSet);
    }));
    const equivalenceToggle = toggleChip(
      profile && state.showEquivalence ? "%급 ON" : "%급 OFF",
      Boolean(profile && state.showEquivalence),
      () => update(() => {
        if (!profile) return;
        state.showEquivalence = !state.showEquivalence;
      }),
      !profile,
    );
    equivalenceToggle.title = profile
      ? "%급 계산 결과 표시 전환"
      : "내 캐릭터 정보를 불러오면 사용할 수 있습니다.";
    const resetTargets = resetAction("목표 초기화", () => update(() => {
      state[targetSetsKey()] = [{ targets: structuredClone(defaultTargets) }];
    }), {
      className: "button--compact",
      title: "모든 옵션 세트를 지우고 빈 세트 하나로 되돌립니다.",
      key: "reset-targets",
    });
    const targetActions = chipRow(resetTargets, equivalenceToggle);

    let presetAction = null;
    const supportsPreset = !activeResetMethod().fixedFirstLine && supportsRegularOptimalPreset({
      system,
      part: state.part,
      grade: state.grade,
    });
    if (supportsPreset) {
      const presetAttackType = profile?.attackType ?? state.attackType;
      const preset = tableState === "ready"
        ? getRegularOptimalPreset({
            system,
            part: state.part,
            grade: state.grade,
            tables,
            attackType: presetAttackType,
            includeIgnoreDefense: Boolean(state.presetIncludeIgnoreDefense),
            includePpyogong: Boolean(state.presetIncludePpyogong),
            includeNearOptimal: Boolean(state.presetIncludeNearOptimal),
            includeDropMeso: state.presetIncludeDropMeso !== false,
          })
        : null;
      const presetTargetSets = materializePresetTargetSets(preset, {
        maxTargets: MAX_TARGETS,
        maxSets: MAX_TARGET_SETS,
        availableTypes: availableTargetTypes,
      });
      const presetIsValid = Boolean(
        preset && presetTargetSets.length === preset.targetSets.length,
      );
      const isApplied = presetIsValid &&
        targetSetsEqual(state[targetSetsKey()], presetTargetSets);
      const presetName = POTENTIAL_PARTS[state.part];
      const presetAttackLabel = preset?.kind === "accessory"
        ? ""
        : presetAttackType === "magic" ? "마력 " : "공격력 ";
      const compactPresetLabel = preset
        ? `${
            preset.kind === "accessory" && preset.includesNearOptimal
              ? "정옵션 -3% "
              : `${presetAttackLabel}정옵션 `
          }${preset.targetSets.length}세트 ${isApplied ? "적용됨" : "적용"}`
        : `${presetName} 정옵션 적용`;
      const applyPreset = element(
        "button",
        "button option-preset-apply",
        compactPresetLabel,
      );
      applyPreset.type = "button";
      applyPreset.dataset.key = "regular-optimal-preset";
      applyPreset.disabled = !presetIsValid || isApplied;
      applyPreset.title = presetIsValid
        ? preset.description
        : "선택한 공식 확률표에서 정옵션을 만들 수 없습니다.";
      applyPreset.addEventListener("click", () => {
        if (!presetIsValid || isApplied) return;
        const hasConfiguredTargets = state[targetSetsKey()].some(
          (targetSet) => targetSet.targets.some((target) =>
            target.type || target.value !== ""
          ),
        );
        if (
          hasConfiguredTargets &&
          !window.confirm(
            `현재 목표 옵션을 모두 지우고 ${preset.name} ${
              preset.kind === "accessory" && preset.includesNearOptimal
                ? "정옵션 -3%"
                : "정옵션"
            } ${preset.targetSets.length}세트로 바꿀까요?`,
          )
        ) return;
        update(() => {
          state[targetSetsKey()] = structuredClone(presetTargetSets);
          normalizeTargetSets();
        });
      });
      presetAction = element("div", "target-preset-actions");
      presetAction.append(applyPreset);
      if (preset?.kind === "accessory") {
        const presetOptions = element("div", "target-preset-options");
        const includeNearOptimal = toggleChip(
          "-3% 포함",
          Boolean(state.presetIncludeNearOptimal),
          () => update(() => {
            state.presetIncludeNearOptimal = !state.presetIncludeNearOptimal;
          }),
          false,
          { key: "preset-include-near-optimal" },
        );
        includeNearOptimal.title =
          "장신구 STR·DEX·INT·LUK 목표에 정옵션 -3%까지 포함합니다. Lv.250은 30%, Lv.200은 27% 이상입니다.";
        const includeDropMeso = toggleChip(
          "드메 포함",
          state.presetIncludeDropMeso !== false,
          () => update(() => {
            state.presetIncludeDropMeso = state.presetIncludeDropMeso === false;
          }),
          false,
          { key: "preset-include-drop-meso" },
        );
        includeDropMeso.title =
          "아이템 드롭률, 메소 획득량, 드롭·메획 혼합 목표를 정옵션 세트에 포함합니다.";
        presetOptions.append(includeNearOptimal, includeDropMeso);
        presetAction.append(presetOptions);
      } else if (preset?.kind === "weapon" || preset?.kind === "emblem") {
        const canToggleIgnoreDefense = Boolean(preset?.canIncludeIgnoreDefense);
        const includeIgnoreDefense = toggleChip(
          "방무 1줄 포함",
          Boolean(state.presetIncludeIgnoreDefense),
          () => update(() => {
            if (!canToggleIgnoreDefense) return;
            state.presetIncludeIgnoreDefense = !state.presetIncludeIgnoreDefense;
          }),
          !canToggleIgnoreDefense,
          { key: "preset-include-ignore-defense" },
        );
        includeIgnoreDefense.title = canToggleIgnoreDefense
          ? "방무는 최대 한 줄만 정옵션에 포함합니다."
          : "선택한 공식 확률표에서는 방무 옵션을 사용할 수 없습니다.";
        const presetOptions = element("div", "target-preset-options");
        if (preset?.canIncludePpyogong) {
          const includePpyogong = toggleChip(
            "뾰공 포함",
            Boolean(state.presetIncludePpyogong),
            () => update(() => {
              state.presetIncludePpyogong = !state.presetIncludePpyogong;
            }),
            false,
            { key: "preset-include-ppyogong" },
          );
          includePpyogong.title =
            "공/마 18% + 보공 35%, 보공 95%처럼 첫 줄의 낮은 보공 수치가 들어간 세트를 포함합니다.";
          presetOptions.append(includePpyogong);
        }
        presetOptions.append(includeIgnoreDefense);
        presetAction.append(presetOptions);
      }
    }

    const extras = [];
    if (profile && state.showEquivalence && activeTypes.includes("ignore-defense")) {
      extras.push(
        chipRow(
          [380, 300].map((defense) => chip(
            `보스 방어율 ${defense}%`,
            Number(state.enemyDefense) === defense,
            () => update(() => { state.enemyDefense = defense; }),
          )),
        ),
      );
    }
    return cardWithHead(
      "목표 옵션",
      targetActions,
      presetAction,
      setList,
      ...extras,
      addSet,
    );
  }

  function manualCharacterSettings() {
    if (getPotentialProfile()) return null;
    const settings = row(
      field(
        "주스탯",
        searchableSelect(STATS, state.mainStat, (value) => update(() => {
          state.mainStat = value;
          state.attackType = value === "INT" ? "magic" : "attack";
        }), { key: "main-stat", ariaLabel: "주스탯" }),
      ),
      field(
        "부스탯",
        searchableSelect([...STATS, { value: "none", label: "없음" }], state.subStat, (value) =>
          update(() => { state.subStat = value; }), { key: "sub-stat" }),
      ),
      field(
        "공/마 선택",
        searchableSelect(
          [{ value: "attack", label: "공격력" }, { value: "magic", label: "마력" }],
          state.attackType,
          (value) => update(() => { state.attackType = value; }),
          { key: "attack-type", ariaLabel: "공격력 또는 마력" },
        ),
      ),
      field(
        "캐릭터 레벨",
        numberControl("character-level", state.characterLevel, (value) => {
          state.characterLevel = Math.max(1, Math.min(300, Math.round(value)));
        }, { min: "1", max: "300" }),
      ),
    );
    settings.classList.add("profile-manual-settings");
    return settings;
  }

  function completeTargets(targets, prime = activeResetMethod().fixedFirstLine) {
    return targets.flatMap((target, index) =>
      isCompletePotentialTarget(target) && (!prime || index > 0)
        ? [{ type: target.type, value: target.value }] : []);
  }

  function targetSetsEqual(left, right) {
    const signature = (targetSets) => targetSets
      .map((targetSet) => completeTargets(targetSet.targets)
        .map((target) => `${target.type}:${Number(target.value)}`)
        .sort()
        .join("|"))
      .filter(Boolean)
      .sort();
    return JSON.stringify(signature(left)) === JSON.stringify(signature(right));
  }

  function targetSummary(target) {
    const info = getPotentialTargetInfo(target.type);
    if (!info) return String(target.type);
    let label = info.label;
    if (info.unit === "%" && label.endsWith(" %")) {
      label = label.slice(0, -2);
    } else if (info.unit === "%급" && label.endsWith("%급")) {
      label = label.slice(0, -2);
    }
    return `${label} ${target.value}${info.unit}`;
  }

  function targetSetSummary(targets) {
    return targets.map(targetSummary).join(" + ");
  }

  function normalizedPresetTargetSets(rawSets) {
    if (!Array.isArray(rawSets)) return [];
    return rawSets.slice(0, MAX_TARGET_SETS).map((rawSet) => {
      const rawTargets = Array.isArray(rawSet)
        ? rawSet
        : Array.isArray(rawSet?.targets)
          ? rawSet.targets
          : [];
      const targets = rawTargets.slice(0, MAX_TARGETS).map((target) => ({
        type: typeof target?.type === "string" ? target.type : "",
        value: target?.value ?? "",
      }));
      while (targets.length < MAX_TARGETS) {
        targets.push({ type: "", value: "" });
      }
      return { targets };
    });
  }

  function presetTargetSummary(targetSets, prime) {
    return normalizedPresetTargetSets(targetSets)
      .map((targetSet) => completeTargets(targetSet.targets, prime))
      .filter((targets) => targets.length > 0)
      .map(targetSetSummary)
      .join(" 또는 ");
  }

  function currentExpectationSnapshot(targetSets) {
    if (tableState !== "ready" || !tables || targetSets.length === 0) return null;
    const profile = getCalculationProfile({
      mainStat: state.mainStat,
      subStat: state.subStat,
      attackType: state.attackType,
      characterLevel: state.characterLevel,
    }, { capability: "potentialEquivalence" });
    try {
      const result = calculateTargetSets(targetSets, profile);
      if (!Number.isFinite(result?.expectedResets) && !result?.dependsOnFirstLine) return null;
      return {
        expectedResetsRange: result.dependsOnFirstLine ? result.expectedResetsRange : null,
        expectedCostRange: result.dependsOnFirstLine ? result.expectedCostRange : null,
        expectedCost: Number.isFinite(result.expectedCost)
          ? result.expectedCost
          : null,
        expectedResets: result.expectedResets,
        probability: Number.isFinite(result.probability)
          ? result.probability
          : null,
        savedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  function savedExpectationText(expectation, method) {
    if (expectation?.expectedResetsRange) {
      const cost = expectation.expectedCostRange
        ? ` · ${formatRange(expectation.expectedCostRange.map((value) => value ?? Infinity), (value) => formatPotentialResetMeso(value, method))}`
        : "";
      return `저장 당시 평균 큐브 · ${formatRange(expectation.expectedResetsRange.map((value) => value ?? Infinity), formatAttempts)}${cost}`;
    }
    if (Number.isFinite(expectation?.expectedCost)) {
      return `저장 당시 기댓값 · ${formatMeso(expectation.expectedCost)}`;
    }
    if (Number.isFinite(expectation?.expectedResets)) {
      return `저장 당시 평균 ${method.usesMeso ? "재설정" : "큐브"} · ${formatAttempts(expectation.expectedResets)}`;
    }
    return "저장 당시 기댓값 미저장";
  }

  function savedTargetPresetCard() {
    const currentTargetSets = state[targetSetsKey()]
      .map((targetSet) => completeTargets(targetSet.targets))
      .filter((targets) => targets.length > 0);
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.maxLength = 32;
    nameInput.placeholder = "프리셋 이름 (선택)";
    nameInput.dataset.key = "target-preset-name";
    nameInput.setAttribute("aria-label", "저장할 목표 프리셋 이름");

    const saveButton = element("button", "button target-preset-library__save", "현재 목표 저장");
    saveButton.type = "button";
    saveButton.disabled =
      currentTargetSets.length === 0 ||
      tableState !== "ready" ||
      savedTargetPresets.length >= MAX_SAVED_TARGET_PRESETS;
    saveButton.title = currentTargetSets.length === 0
      ? "수치를 입력한 목표 옵션이 필요합니다."
      : tableState !== "ready"
        ? "확률표를 불러온 뒤 저장할 수 있습니다."
        : savedTargetPresets.length >= MAX_SAVED_TARGET_PRESETS
          ? `목표 프리셋은 최대 ${MAX_SAVED_TARGET_PRESETS}개까지 저장할 수 있습니다.`
          : "현재 장비·등급·재설정 방식과 목표 옵션 및 기댓값을 브라우저에 저장합니다.";

    const saveCurrent = () => {
      if (saveButton.disabled) return;
      const summary = currentTargetSets.map(targetSetSummary).join(" 또는 ");
      const requestedName = nameInput.value.trim();
      const expectation = currentExpectationSnapshot(currentTargetSets);
      savedTargetPresets.unshift({
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: requestedName || `${POTENTIAL_PARTS[state.part]} · ${summary}`,
        part: Number(state.part),
        itemLevel: Math.round(state.itemLevel),
        grade: state.grade,
        resetMethod: state.resetMethod,
        ...(activeResetMethod().fixedFirstLine ? { primeTargetMode: "sum" } : {}),
        mainStat: state.mainStat,
        subStat: state.subStat,
        attackType: state.attackType,
        characterLevel: Math.round(state.characterLevel),
        enemyDefense: Number(state.enemyDefense),
        targetSets: structuredClone(state[targetSetsKey()]),
        expectation,
        savedAt: new Date().toISOString(),
      });
      savedTargetPresets = savedTargetPresets.slice(0, MAX_SAVED_TARGET_PRESETS);
      persistTargetPresets();
      render();
    };
    saveButton.addEventListener("click", saveCurrent);
    nameInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      saveCurrent();
    });

    const form = element("div", "target-preset-library__form");
    form.append(nameInput, saveButton);
    const list = element("div", "target-preset-library__list");
    if (savedTargetPresets.length === 0) {
      list.append(
        element(
          "p",
          "target-preset-library__empty",
          "저장된 목표 프리셋이 없습니다.",
        ),
      );
    } else {
      savedTargetPresets.forEach((preset) => {
        const method = (() => {
          try {
            return getPotentialResetMethod(system, preset.resetMethod ?? "meso");
          } catch {
            return getPotentialResetMethod(system, "meso");
          }
        })();
        const summary = presetTargetSummary(preset.targetSets, Boolean(method.fixedFirstLine));
        const item = element("article", "target-preset-library__item");
        const copy = element("div", "target-preset-library__copy");
        copy.append(
          element("strong", "target-preset-library__name", preset.name),
          element(
            "span",
            "target-preset-library__meta",
            `${POTENTIAL_PARTS[preset.part] ?? "장비"} · Lv.${preset.itemLevel} · ${GRADE_NAMES[preset.grade] ?? preset.grade} · ${method.label}`,
          ),
          element(
            "span",
            "target-preset-library__targets",
            summary || "목표 옵션 없음",
          ),
          element(
            "span",
            "target-preset-library__expectation",
            savedExpectationText(preset.expectation, method),
          ),
        );
        const loadButton = element("button", "button target-preset-library__load", "불러오기");
        loadButton.type = "button";
        loadButton.addEventListener("click", () => {
          const targetSets = normalizedPresetTargetSets(preset.targetSets);
          if (targetSets.length === 0) return;
          update(() => {
            state.part = Number(preset.part);
            state.itemLevel = Math.max(0, Math.min(250, Math.round(preset.itemLevel)));
            state.grade = Object.hasOwn(POTENTIAL_GRADES, preset.grade)
              ? preset.grade
              : "legendary";
            const presetMethod = preset.resetMethod ?? "meso";
            state.resetMethod = displayedResetMethods(system, state.grade)
              .some((candidate) => candidate.id === presetMethod)
                ? presetMethod
                : "meso";
            state.mainStat = preset.mainStat ?? state.mainStat;
            state.subStat = preset.subStat ?? state.subStat;
            state.attackType = preset.attackType ?? state.attackType;
            state.characterLevel = preset.characterLevel ?? state.characterLevel;
            state.enemyDefense = preset.enemyDefense ?? state.enemyDefense;
            state.rankProgressByGrade = { rare: 0, epic: 0, unique: 0 };
            state.rankTargetGrade = "";
            state[targetSetsKey()] = targetSets;
          }, { reload: true });
        });
        const removeButton = element("button", "icon-button target-preset-library__remove", "×");
        removeButton.type = "button";
        removeButton.title = `${preset.name} 삭제`;
        removeButton.setAttribute("aria-label", `${preset.name} 삭제`);
        removeButton.addEventListener("click", () => {
          savedTargetPresets = savedTargetPresets.filter(
            (saved) => saved.id !== preset.id,
          );
          persistTargetPresets();
          render();
        });
        const actions = element("div", "target-preset-library__actions");
        actions.append(loadButton, removeButton);
        item.append(copy, actions);
        list.append(item);
      });
    }

    const section = card("저장된 목표 프리셋", form, list);
    section.classList.add("target-preset-library");
    return section;
  }

  function calculateTargetSets(targetSets, profile) {
    const calculate = activeResetMethod().fixedFirstLine ? calculatePrimePotentialExpected : calculatePotentialExpected;
    return calculate({
      tables,
      system,
      grade: state.grade,
      resetMethod: state.resetMethod,
      itemLevel: Math.round(state.itemLevel),
      targetSets: targetSets.map((targets) =>
        targets.map((target) => ({
          targetType: target.type,
          target: Number(target.value),
        })),
      ),
      mainStat: profile.mainStat,
      subStat: profile.subStat === "none" ? null : profile.subStat,
      subStats: getProfileSubStats(profile),
      attackType: profile.attackType,
      characterLevel: Math.round(profile.characterLevel),
      statEquivalence: { ...profile.statEquivalence },
      enemyDefense: Number(state.enemyDefense),
    });
  }

  function formatOptionGrade(value) {
    return Number(value).toLocaleString("ko-KR", {
      maximumFractionDigits: 4,
    });
  }

  function targetSuccessCondition(targets, profile, setNumber) {
    const statEquivalent = targets.length === 1 && targets[0].type === "stat-equivalent";
    const threshold = Number(targets[0].value);
    const title = statEquivalent
      ? `주스탯 ${formatGrade(threshold)}%급 이상 조합`
      : `${targetSetSummary(targets)} 이상 조합`;
    const content = element("div", "stat-combinations");
    const head = element("header", "stat-combinations__head");
    head.append(
      element("span", "success-condition__label", `세트 ${setNumber}`),
      element(
        "h4",
        "stat-combinations__title",
        title,
      ),
    );
    content.append(head);

    const combinationOptions = {
      tables: activeResetMethod().fixedFirstLine ? tables.slice(1) : tables,
      limit: MAX_STAT_EQUIVALENT_COMBINATIONS,
      sortDirection: state.statEquivalentSortDirection,
    };
    const { combinations, conditions, totalCount, hiddenCount, truncated } = statEquivalent
      ? getStatEquivalentSuccessCombinations({
        ...combinationOptions,
        target: threshold,
        profile,
      })
      : getPotentialSuccessCombinations({
        ...combinationOptions,
        ...profile,
        enemyDefense: Number(state.enemyDefense),
        targets: targets.map(({ type, value }) => ({ targetType: type, target: Number(value) })),
      });
    if (combinations.length === 0) {
      content.append(
        element(
          "p",
          "stat-combinations__empty",
          statEquivalent
            ? `현재 확률표에는 ${formatGrade(threshold)}%급 이상이 되는 옵션 조합이 없습니다.`
            : "현재 확률표에는 모든 목표를 만족하는 옵션 조합이 없습니다.",
        ),
      );
      return content;
    }

    const list = element("ol", "stat-combinations__list");
    list.tabIndex = 0;
    list.setAttribute("role", "region");
    list.setAttribute(
      "aria-label",
      title,
    );
    combinations.forEach((combination) => {
      const item = element("li", "stat-combination");
      const optionList = element("ul", "stat-combination__options");
      combination.options.forEach(({ name }) => {
        optionList.append(element("li", "stat-combination__option", name));
      });
      item.append(
        optionList,
        element(
          "span",
          "stat-combination__total",
          statEquivalent
            ? `합계 ${formatOptionGrade(combination.score)}%급`
            : `합계 ${conditions.map(({ targetType }, index) => targetSummary({
              type: targetType,
              value: formatOptionGrade(combination.scores[index]),
            })).join(" · ")}`,
        ),
      );
      list.append(item);
    });
    const countText = truncated
      ? `전체 ${totalCount.toLocaleString("ko-KR")}개 중 ${combinations.length}개 표시 · ${hiddenCount.toLocaleString("ko-KR")}개 더 있음`
      : `전체 ${totalCount.toLocaleString("ko-KR")}개 조합`;
    content.append(
      list,
      element("p", "stat-combinations__count", countText),
    );
    return content;
  }

  function successConditions(targetSets, profile) {
    const list = element("div", "success-conditions");
    targetSets.forEach((targetSet, index) => {
      if (index > 0) list.append(element("span", "success-conditions__or", "또는"));
      const item = element("div", "success-condition");
      item.classList.add("success-condition--stat-equivalent");
      item.append(targetSuccessCondition(targetSet.targets, profile, targetSet.number));
      list.append(item);
    });
    const node = details("성공 조건 보기", list);
    node.dataset.detailsKey = "success-conditions";
    node.open = state.successConditionsOpen;
    node.addEventListener("toggle", () => {
      state.successConditionsOpen = node.open;
      persist();
    });

    const sortControls = chipRow(
      chip(
        "오름차순",
        state.statEquivalentSortDirection === "asc",
        () => update(() => {
          state.statEquivalentSortDirection = "asc";
        }),
        false,
        { key: "stat-equivalent-sort-asc" },
      ),
      chip(
        "내림차순",
        state.statEquivalentSortDirection === "desc",
        () => update(() => {
          state.statEquivalentSortDirection = "desc";
        }),
        false,
        { key: "stat-equivalent-sort-desc" },
      ),
    );
    sortControls.classList.add("success-condition-sort");
    sortControls.setAttribute("role", "group");
    sortControls.setAttribute("aria-label", "성공 조건 정렬");

    const panel = element("div", "success-conditions-panel");
    panel.append(node, sortControls);
    return panel;
  }

  function formatTargetChance(value) {
    return Number(value).toLocaleString("ko-KR", {
      maximumFractionDigits: 2,
    });
  }

  function formatOneResetProbability(probability) {
    if (!Number.isFinite(probability) || probability <= 0) {
      return "1 / ∞ · 0%";
    }
    const odds = (1 / probability).toLocaleString("ko-KR", {
      maximumFractionDigits: 2,
    });
    const percentage = probability * 100 < 0.00000001
      ? "<0.00000001%"
      : formatProbability(probability, 8);
    return `1 / ${odds} · ${percentage}`;
  }

  function formatRange(values, format) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    return min === max ? format(min) : `${format(min)} ~ ${format(max)}`;
  }

  function reachChanceSection(result, methodInfo) {
    const attemptsMetric = metric("목표 도달 재설정", "-");
    const attemptsLabel = attemptsMetric.querySelector("span");
    const attemptsValue = attemptsMetric.querySelector("strong");
    attemptsValue.dataset.targetChanceAttempts = "";
    let costLabel = null;
    let costValue = null;
    const metricItems = [attemptsMetric];
    if (result.resetCost !== null) {
      const costMetric = metric("목표 도달 비용", "-");
      costLabel = costMetric.querySelector("span");
      costValue = costMetric.querySelector("strong");
      costValue.dataset.targetChanceCost = "";
      metricItems.push(costMetric);
    }
    const updateReadout = (chancePercent) => {
      const attempts = calculateResetsForChance(
        result.probability ?? result.probabilityRange?.[0] ?? 0,
        chancePercent / 100,
      );
      const chanceLabel = `${formatTargetChance(chancePercent)}% 도달`;
      attemptsLabel.textContent = `${chanceLabel} ${methodInfo.usesMeso ? "재설정" : "큐브"}`;
      attemptsValue.textContent = result.dependsOnFirstLine
        ? formatRange(result.probabilityRange.map((probability) => calculateResetsForChance(probability, chancePercent / 100)), formatAttempts)
        : formatAttempts(attempts);
      if (costLabel && costValue) {
        costLabel.textContent = `${chanceLabel} ${methodInfo.usesMeso ? "비용" : "큐브 사용 메소"}`;
        const costForAttempts = (count) => Number.isFinite(count)
          ? formatPotentialResetMeso(count * result.resetCost, methodInfo)
          : "도달 불가";
        costValue.textContent = result.dependsOnFirstLine
          ? formatRange(result.probabilityRange.map((probability) => calculateResetsForChance(probability, chancePercent / 100)), costForAttempts)
          : costForAttempts(attempts);
      }
    };

    return createReachChanceControl({
      id: `${toolId}-target-chance-range`,
      label: "목표 도달 확률",
      value: state.targetChancePercent,
      min: MIN_TARGET_CHANCE,
      max: MAX_TARGET_CHANCE,
      average: Math.abs(
        Number(state.targetChancePercent) - DEFAULT_TARGET_CHANCE_PERCENT,
      ) < 0.005,
      averageValue: DEFAULT_TARGET_CHANCE_PERCENT,
      resetTitle: `평균 재설정 횟수에 해당하는 ${DEFAULT_TARGET_CHANCE_PERCENT}%로 봅니다.`,
      rangeKey: "target-chance-range",
      numberKey: "target-chance-number",
      metrics: metricItems,
      normalize: (value, fallback) => normalizePotentialTargetChance(value, fallback),
      deriveAverage: ({ value }) => Math.abs(
        Number(value) - DEFAULT_TARGET_CHANCE_PERCENT,
      ) < 0.005,
      onChange: (value) => {
        state.targetChancePercent = value;
        updateReadout(value);
      },
      onCommit: persist,
    });
  }

  function rankUpReachChanceSection(plan, methodInfo) {
    const attemptsMetric = metric("목표 도달 재설정", "-");
    const attemptsLabel = attemptsMetric.querySelector("span");
    const attemptsValue = attemptsMetric.querySelector("strong");
    const metricItems = [attemptsMetric];
    let costLabel = null;
    let costValue = null;
    if (plan.expectedCost !== null) {
      const costMetric = metric("목표 도달 비용", "-");
      costLabel = costMetric.querySelector("span");
      costValue = costMetric.querySelector("strong");
      metricItems.push(costMetric);
    }
    const updateReadout = (chancePercent) => {
      const reach = calculatePotentialRankUpReachForChance(
        plan,
        chancePercent / 100,
      );
      const chanceLabel = `${formatTargetChance(chancePercent)}% 도달`;
      attemptsLabel.textContent = `${chanceLabel} ${methodInfo.usesMeso ? "재설정" : "큐브"}`;
      attemptsValue.textContent = formatAttempts(reach.attempts);
      if (costLabel && costValue) {
        costLabel.textContent = `${chanceLabel} ${methodInfo.usesMeso ? "비용" : "큐브 사용 메소"}`;
        costValue.textContent = reach.cost === null
          ? "계산 불가"
          : formatPotentialResetMeso(reach.cost, methodInfo);
      }
    };

    return createReachChanceControl({
      id: `${toolId}-rank-up-target-chance-range`,
      label: "목표 도달 확률",
      value: state.targetChancePercent,
      min: MIN_TARGET_CHANCE,
      max: MAX_TARGET_CHANCE,
      average: Math.abs(
        Number(state.targetChancePercent) - DEFAULT_TARGET_CHANCE_PERCENT,
      ) < 0.005,
      averageValue: DEFAULT_TARGET_CHANCE_PERCENT,
      resetTitle: `평균 기댓값에 가까운 ${DEFAULT_TARGET_CHANCE_PERCENT}%로 봅니다.`,
      rangeKey: "rank-up-target-chance-range",
      numberKey: "rank-up-target-chance-number",
      metrics: metricItems,
      normalize: (value, fallback) => normalizePotentialTargetChance(value, fallback),
      deriveAverage: ({ value }) => Math.abs(
        Number(value) - DEFAULT_TARGET_CHANCE_PERCENT,
      ) < 0.005,
      onChange: (value) => {
        state.targetChancePercent = value;
        updateReadout(value);
      },
      onCommit: persist,
    });
  }

  function resultCard() {
    if (state.calculationMode === "rank-up") {
      const section = createResultCard("기댓값");
      const { rankInfo, targetGrade, plan } = rankUpContext();
      if (!rankInfo.canRankUp || !plan) {
        section.append(
          element(
            "div",
            "result-empty",
            state.grade === "legendary"
              ? "레전드리는 최고 등급입니다."
              : "선택한 방식으로 더 높은 등급에 올릴 수 없습니다.",
          ),
        );
        return section;
      }
      const methodInfo = activeResetMethod();
      const averageMetrics = [
        metric(
          methodInfo.usesMeso ? "평균 재설정" : "평균 큐브",
          formatAttempts(plan.expectedAttempts),
        ),
      ];
      if (plan.expectedCost !== null) {
        averageMetrics.push(
          metric(
            methodInfo.usesMeso ? "평균 총비용" : "평균 큐브 사용 메소",
            formatPotentialResetMeso(plan.expectedCost, methodInfo),
          ),
        );
      }
      const stageDetails = details(
        "단계별 기댓값",
        ...plan.stages.map((stage) =>
          resultLine(
            `${GRADE_NAMES[stage.fromGrade]} → ${GRADE_NAMES[stage.toGrade]}`,
            [
              formatAttempts(stage.expectedAttempts),
              formatProbability(stage.probability, 6),
              stage.expectedCost === null
                ? null
                : formatPotentialResetMeso(stage.expectedCost, methodInfo),
            ].filter(Boolean).join(" · "),
          ),
        ),
      );
      stageDetails.dataset.detailsKey = "rank-up";
      section.append(
        metricGrid(...averageMetrics),
        rankUpReachChanceSection(plan, methodInfo),
        resultLine(
          "목표 등급",
          `${GRADE_NAMES[state.grade]} → ${GRADE_NAMES[targetGrade]}`,
          true,
        ),
        resultLine("재설정 방식", methodInfo.label),
        resultLine("확률 적용", state.miracle ? "미라클 타임" : "일반 확률"),
      );
      if (plan.maximumAttempts !== null) {
        section.append(
          resultLine("목표까지 천장 상한", `${plan.maximumAttempts}회`),
        );
      }
      section.append(
        stageDetails,
        note(
          methodInfo.usesMeso
            ? "각 등급의 현재 천장 진행과 등급별 재설정 비용을 따로 반영한 합산 기댓값입니다."
            : "각 등급의 현재 천장 진행과 장비 레벨별 큐브 사용 메소를 반영했습니다. 큐브 자체 가치는 포함하지 않습니다.",
          "fine-print",
        ),
      );
      return section;
    }
    const section = createResultCard("기댓값");
    const activeTargetSets = state[targetSetsKey()]
      .map((targetSet, index) => ({
        number: index + 1,
        targets: completeTargets(targetSet.targets),
      }))
      .filter((targetSet) => targetSet.targets.length > 0);
    const targetSets = activeTargetSets.map((targetSet) => targetSet.targets);
    if (targetSets.length === 0) {
      return section;
    }
    if (tableState !== "ready" || !tables) {
      const empty = element("div", "result-empty", tableMessage);
      empty.dataset.tone = tableState === "error" ? "error" : "";
      section.append(empty);
      return section;
    }

    const profile = getCalculationProfile({
      mainStat: state.mainStat,
      subStat: state.subStat,
      attackType: state.attackType,
      characterLevel: state.characterLevel,
    }, { capability: "potentialEquivalence" });
    const equipment = `${POTENTIAL_PARTS[state.part]} · Lv.${state.itemLevel} · ${GRADE_NAMES[state.grade]}`;
    const usesStatConversion = targetSets.some((targets) =>
      targets.some((target) => target.type === "stat-equivalent"),
    );

    let result;
    try {
      result = calculateTargetSets(targetSets, profile);
    } catch (error) {
      section.append(element("div", "result-empty", error?.message || "계산할 수 없습니다."));
      return section;
    }
    const oneResetProbability = resultLine(
      "1회 재설정 확률",
      result.dependsOnFirstLine
        ? formatRange(result.probabilityRange, (probability) => formatProbability(probability, 8))
        : formatOneResetProbability(result.probability),
      true,
    );
    oneResetProbability.classList.add("result__line--probability");
    const methodInfo = activeResetMethod();
    const averageMetrics = [
      metric(
        methodInfo.usesMeso ? "평균 재설정" : "평균 큐브",
        result.dependsOnFirstLine
          ? formatRange(result.expectedResetsRange, formatAttempts)
          : formatAttempts(result.expectedResets),
      ),
    ];
    if (result.resetCost !== null) {
      averageMetrics.push(metric(
        methodInfo.usesMeso ? "평균 비용" : "평균 큐브 사용 메소",
        result.dependsOnFirstLine
          ? formatRange(result.expectedCostRange, (cost) => formatPotentialResetMeso(cost, methodInfo))
          : formatPotentialResetMeso(result.expectedCost, methodInfo),
      ));
    }
    section.append(
      metricGrid(...averageMetrics),
      reachChanceSection(result, methodInfo),
      oneResetProbability,
      resultLine("재설정 방식", methodInfo.label),
      resultLine("성공 판정", `${targetSets.length}개 세트 중 하나`),
      successConditions(activeTargetSets, profile),
      resultLine("장비", equipment),
    );
    if (usesStatConversion) {
      section.append(
        resultLine("환산 기준", profile.source === "character" ? `${profile.character?.name ?? "내 캐릭터"}` : "기본 환산값"),
      );
    }

    if (methodInfo.fixedFirstLine) {
      if (result.dependsOnFirstLine) section.append(note("첫 줄의 옵션 중복 제한에 따라 결과가 달라져 가능한 범위로 표시합니다.", "fine-print"));
      section.append(note("첫 줄을 제외한 두 줄의 합계로 판정합니다. 현재 두 줄은 공식 분포로 평균하며, 목표 도달 확률별 횟수는 평균 기반 근사값입니다.", "fine-print"));
    }
    if (!methodInfo.usesMeso) {
      section.append(note(
        methodInfo.revealCostBasis === "standard-cube-assumption"
          ? "사용 메소는 기존 큐브와 같은 장비 레벨별 비용식으로 추정했습니다. 큐브 자체 가치는 포함하지 않습니다."
          : "장비 레벨별 큐브 사용 메소를 반영했습니다. 큐브 자체 가치는 포함하지 않습니다.",
        "fine-print",
      ));
    }
    return section;
  }

  function render() {
    const equipment = equipmentCard();
    const targets = targetCard();
    const profile = characterProfileCard({
      extraContent: manualCharacterSettings(),
      collapseReferenceDetails: true,
      equipmentMetric: system,
    });
    profile.classList.add("calculator-profile");
    const results = [resultCard()];
    if (state.calculationMode === "options") results.push(savedTargetPresetCard());
    const grid = potentialCalculatorLayout({
      equipment, targets, extraControls: [profile], results,
    });
    renderWithFocus(root, [grid]);
  }

  render();
  ensureTables();
  return () => {
    disposed = true;
    requestId += 1;
    profileUnsubscribe();
  };
}

export function mountPotentialCalculator({ system: initialSystem = "regular" } = {}) {
  let cleanup = null;
  const switchSystem = (requestedSystem) => {
    const system = ["additional", "combined"].includes(requestedSystem)
      ? requestedSystem
      : "regular";
    cleanup?.();
    const canonical = new URL("../potential/", window.location.href);
    if (system !== "regular") canonical.searchParams.set("system", system);
    window.history.replaceState(window.history.state, "", canonical);
    cleanup = system === "combined"
      ? mountCombinedPotentialSystem({ onSystemChange: switchSystem })
      : mountPotentialSystem({ system, onSystemChange: switchSystem });
  };

  renderToolNav(document.querySelector("#toolnav"), "potential");
  switchSystem(initialSystem);
  window.addEventListener("pagehide", () => cleanup?.(), { once: true });
}
