import {
  POTENTIAL_GRADES,
  POTENTIAL_PARTS,
  calculateCombinedPotentialExpected,
  convertPotentialTargetToEquivalents,
  getAvailablePotentialTargetTypes,
  getPotentialResetCost,
} from "maple-core/potential";
import { loadPotentialTables } from "./potential-tables.js";
import {
  getPotentialTargetInfo,
  isCompletePotentialTarget,
  orderPotentialTargetTypes,
  summarizePotentialTargetEquivalents,
} from "./potential-target-ui.js";
import { chip, field, numberInput, toggleChip } from "./ui.js";
import {
  card,
  cardWithHead,
  chipRow,
  element,
  formatAttempts,
  formatMeso,
  formatProbability,
  metric,
  metricGrid,
  note,
  potentialResetCostPanel,
  renderWithFocus,
  resetAction,
  resultCard as createResultCard,
  resultLine,
  row,
  searchableSelect,
} from "./calculator-ui.js";
import {
  characterProfileCard,
  getActiveProfile,
  getCalculationProfile,
  subscribeCharacterProfile,
} from "./character-profile.js";
import { getProfileSubStats } from "./profile-stat-equivalence.js";
import {
  loadSharedPotentialEquipment,
  saveSharedPotentialEquipment,
} from "./potential-equipment-state.js";

const GRADE_NAMES = Object.fromEntries(
  Object.entries(POTENTIAL_GRADES).map(([id, grade]) => [id, grade.label]),
);
const gradeButtonLabel = (grade) =>
  grade === "legendary" ? "레전" : GRADE_NAMES[grade];
const STATS = ["STR", "DEX", "INT", "LUK"];
const DEFAULT_TARGETS = [
  { type: "", value: "" },
  { type: "", value: "" },
  { type: "", value: "" },
];
const MAX_SAVED_TARGET_PRESETS = 20;

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
    // 저장이 막힌 환경에서는 현재 화면에서만 유지한다.
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

function systemPicker(system, onSystemChange) {
  const picker = chipRow(
    chip("윗잠", system === "regular", () => {
      if (system !== "regular") onSystemChange("regular");
    }),
    chip("아랫잠", system === "additional", () => {
      if (system !== "additional") onSystemChange("additional");
    }),
    chip("통합", system === "combined", () => {
      if (system !== "combined") onSystemChange("combined");
    }),
  );
  picker.classList.add("potential-system-switch");
  picker.setAttribute("role", "group");
  picker.setAttribute("aria-label", "잠재능력 종류");
  return picker;
}

export function mountCombinedPotentialSystem({ onSystemChange }) {
  const storageKey = "maplestarforce:combined-potential:v1";
  const targetPresetStorageKey =
    "maplestarforce:combined-potential:target-presets:v1";
  const defaults = {
    part: 6,
    itemLevel: 250,
    regularGrade: "legendary",
    additionalGrade: "legendary",
    mainStat: "INT",
    subStat: "LUK",
    attackType: "magic",
    characterLevel: 290,
    enemyDefense: 380,
    showEquivalence: false,
    targets: structuredClone(DEFAULT_TARGETS),
  };
  const state = safeLoad(storageKey, defaults);
  Object.assign(state, loadSharedPotentialEquipment(state));
  state.targets = Array.isArray(state.targets)
    ? state.targets.slice(0, 3).map((target) => ({ ...target }))
    : structuredClone(DEFAULT_TARGETS);
  while (state.targets.length < 3) state.targets.push({ type: "", value: "" });
  if (!getActiveProfile({ capability: "potentialEquivalence" })) {
    state.showEquivalence = false;
  }
  let savedTargetPresets = safeLoadList(targetPresetStorageKey)
    .filter((preset) =>
      preset &&
      typeof preset.id === "string" &&
      typeof preset.name === "string" &&
      Array.isArray(preset.targets)
    )
    .slice(0, MAX_SAVED_TARGET_PRESETS);

  const root = document.querySelector("#tool");
  let regularTables = null;
  let additionalTables = null;
  let availableTargetTypes = [];
  let tableState = "loading";
  let tableMessage = "윗잠과 에디셔널 확률표를 읽는 중입니다…";
  let loadedKey = "";
  let requestId = 0;
  let disposed = false;

  function persist() {
    safeSave(storageKey, state);
    saveSharedPotentialEquipment(state);
  }

  saveSharedPotentialEquipment(state);

  function persistTargetPresets() {
    safeSave(targetPresetStorageKey, savedTargetPresets);
  }

  function update(mutator, { reload = false } = {}) {
    mutator();
    persist();
    render();
    if (reload) ensureTables();
  }

  function numberControl(key, value, onValue, options = {}) {
    const { reload = false, ...inputOptions } = options;
    const input = numberInput(
      value,
      (next) => update(() => onValue(next), { reload }),
      inputOptions,
    );
    input.dataset.key = key;
    return input;
  }

  function tableKey() {
    return [
      state.regularGrade,
      state.additionalGrade,
      state.part,
      Math.round(state.itemLevel),
    ].join(":");
  }

  function allowedTypesForRow(index) {
    const previousTypes = new Set(
      state.targets.slice(0, index).map((target) => target.type).filter(Boolean),
    );
    return availableTargetTypes.filter((type) => !previousTypes.has(type));
  }

  function normalizeTargets() {
    let changed = false;
    state.targets.forEach((target, index) => {
      if (!target.type) {
        if (target.value !== "") {
          target.value = "";
          changed = true;
        }
        return;
      }
      if (!allowedTypesForRow(index).includes(target.type)) {
        target.type = "";
        target.value = "";
        changed = true;
      }
    });
    return changed;
  }

  async function ensureTables() {
    const key = tableKey();
    if (key === loadedKey && (regularTables || tableState === "missing")) return;
    const currentRequest = ++requestId;
    loadedKey = key;
    regularTables = null;
    additionalTables = null;
    availableTargetTypes = [];
    tableState = "loading";
    tableMessage = "윗잠과 에디셔널 확률표를 읽는 중입니다…";
    render();
    try {
      const [regular, additional] = await Promise.all([
        loadPotentialTables({
          system: "regular",
          grade: state.regularGrade,
          part: Number(state.part),
          itemLevel: Math.round(state.itemLevel),
        }),
        loadPotentialTables({
          system: "additional",
          grade: state.additionalGrade,
          part: Number(state.part),
          itemLevel: Math.round(state.itemLevel),
        }),
      ]);
      if (disposed || currentRequest !== requestId) return;
      regularTables = regular;
      additionalTables = additional;
      if (!regular || !additional) {
        tableState = "missing";
        tableMessage = "이 부위·등급·레벨 조합의 윗잠 또는 에디셔널 확률표가 없습니다.";
      } else {
        tableState = "ready";
        const regularTypes = getAvailablePotentialTargetTypes(regular, {
          part: Number(state.part),
          system: "regular",
        });
        const additionalTypes = getAvailablePotentialTargetTypes(additional, {
          part: Number(state.part),
          system: "additional",
        });
        availableTargetTypes = orderPotentialTargetTypes(
          [...new Set([...regularTypes, ...additionalTypes])],
          { system: "additional" },
        );
        if (normalizeTargets()) persist();
        tableMessage = "";
      }
    } catch (error) {
      if (disposed || currentRequest !== requestId) return;
      tableState = "error";
      tableMessage = error?.message || "확률표를 읽지 못했습니다.";
    }
    render();
  }

  function gradeControl(label, key) {
    const group = element("div", "combined-potential-grade");
    group.append(
      element("p", "combined-potential-grade__label", label),
      (() => {
        const picker = chipRow(Object.keys(POTENTIAL_GRADES).map((grade) =>
          chip(gradeButtonLabel(grade), state[key] === grade, () => {
          if (state[key] === grade) return;
          update(() => { state[key] = grade; }, { reload: true });
          })
        ));
        picker.classList.add("potential-grade-picker");
        return picker;
      })(),
    );
    return group;
  }

  function equipmentCard() {
    const partOptions = Object.entries(POTENTIAL_PARTS)
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) =>
        Number(left.label === "한벌옷") - Number(right.label === "한벌옷")
      );
    const part = searchableSelect(partOptions, state.part, (value) => {
      update(() => { state.part = Number(value); }, { reload: true });
    }, { key: "combined-part", ariaLabel: "장비 부위", placeholder: "부위 검색" });
    const level = numberControl("combined-level", state.itemLevel, (value) => {
      state.itemLevel = Math.max(0, Math.min(250, Math.round(value)));
    }, { min: "0", max: "250", reload: true });
    const grades = element("div", "combined-potential-grades");
    grades.append(
      gradeControl("윗잠 등급", "regularGrade"),
      gradeControl("아랫잠 등급", "additionalGrade"),
    );
    let costs = null;
    try {
      costs = [
        getPotentialResetCost(state.itemLevel, state.regularGrade, "regular", "meso"),
        getPotentialResetCost(state.itemLevel, state.additionalGrade, "additional", "meso"),
      ];
    } catch {
      // 숫자를 편집하는 동안에는 비용 표시만 숨긴다.
    }
    const resetCosts = costs
      ? potentialResetCostPanel([
        { label: "윗잠", cost: costs[0] },
        { label: "아랫잠", cost: costs[1] },
      ])
      : null;
    return card(
      "장비/등급",
      row(field("부위", part)),
      row(field("장비 레벨", level)),
      systemPicker("combined", onSystemChange),
      grades,
      resetCosts,
    );
  }

  function targetControl(target, index) {
    const allowedTypes = allowedTypesForRow(index);
    const options = [
      { value: "", label: "없음" },
      ...allowedTypes.map((type) => ({
        value: type,
        label: getPotentialTargetInfo(type)?.label ?? type,
      })),
    ];
    const select = searchableSelect(options, target.type, (value) => {
      update(() => {
        target.type = value;
        target.value = "";
        normalizeTargets();
      });
    }, {
      key: `combined-target-${index}-type`,
      ariaLabel: `통합 목표 ${index + 1}번째 옵션`,
      placeholder: "옵션 검색",
      clearable: true,
    });
    select.disabled = tableState !== "ready" || allowedTypes.length === 0;
    const info = getPotentialTargetInfo(target.type);
    const value = numberControl(
      `combined-target-${index}-value`,
      target.value,
      (next) => { target.value = next; },
      {
        min: "0",
        max: "999",
        step: target.type === "stat-equivalent" ? "any" : "1",
        allowEmpty: true,
        allowDecimalDraft: target.type === "stat-equivalent",
      },
    );
    value.disabled = !target.type;
    value.setAttribute("aria-label", `통합 목표 ${index + 1}번째 최소 수치`);
    const valueControl = element("span", "target-value");
    valueControl.append(value, element("span", "target-value__unit", info?.unit ?? ""));
    const controls = element("div", "target-row");
    controls.append(select, valueControl);
    const item = element("div", "target-item");
    item.append(controls);
    return item;
  }

  function targetCard() {
    const targets = element("div", "target-list");
    targets.append(...state.targets.map(targetControl));
    const reset = resetAction("목표 초기화", () => update(() => {
      state.targets = structuredClone(DEFAULT_TARGETS);
    }), { className: "button--compact", key: "combined-reset-targets" });
    const profile = getActiveProfile({ capability: "potentialEquivalence" });
    const equivalenceToggle = toggleChip(
      profile && state.showEquivalence ? "%급 ON" : "%급 OFF",
      Boolean(profile && state.showEquivalence),
      () => update(() => {
        if (profile) state.showEquivalence = !state.showEquivalence;
      }),
      !profile,
    );
    equivalenceToggle.title = profile
      ? "%급 계산 결과 표시 전환"
      : "내 캐릭터 정보를 불러오면 사용할 수 있습니다.";
    const contents = [targets];
    const equivalence = targetEquivalenceText();
    if (equivalence) {
      contents.push(element("p", "option-set__equivalence", equivalence));
    }
    return cardWithHead(
      "통합 목표 옵션",
      chipRow(reset, equivalenceToggle),
      ...contents,
    );
  }

  function completeTargets() {
    return state.targets.filter(isCompletePotentialTarget);
  }

  function targetSummary(target) {
    const info = getPotentialTargetInfo(target.type);
    if (!info) return String(target.type);
    let label = info.label;
    if (info.unit === "%" && label.endsWith(" %")) label = label.slice(0, -2);
    if (info.unit === "%급" && label.endsWith("%급")) label = label.slice(0, -2);
    return `${label} ${target.value}${info.unit}`;
  }

  function targetEquivalenceText() {
    if (!state.showEquivalence) return "";
    const profile = getActiveProfile({ capability: "potentialEquivalence" });
    const targets = completeTargets();
    if (!profile || targets.length === 0) return "";
    const equivalents = targets.map((target) => {
      const fallback = {
        label: targetSummary(target),
        mainStatPercent: null,
        attackPercent: null,
      };
      try {
        return {
          ...fallback,
          ...convertPotentialTargetToEquivalents({
            targetType: target.type,
            target: Number(target.value),
            statEquivalence: profile.statEquivalence ?? {},
            enemyDefense: Number(state.enemyDefense),
            mainStat: profile.mainStat,
            subStat: profile.subStat,
            subStats: getProfileSubStats(profile),
            attackType: profile.attackType,
            characterLevel: Number(
              profile.character?.level ?? state.characterLevel,
            ),
          }),
        };
      } catch {
        return fallback;
      }
    });
    return summarizePotentialTargetEquivalents(equivalents);
  }

  function manualCharacterSettings() {
    if (getActiveProfile({ capability: "potentialEquivalence" })) return null;
    const settings = row(
      field("주스탯", searchableSelect(STATS, state.mainStat, (value) => update(() => {
        state.mainStat = value;
        state.attackType = value === "INT" ? "magic" : "attack";
      }), { key: "combined-main-stat", ariaLabel: "주스탯" })),
      field("부스탯", searchableSelect(
        [...STATS, { value: "none", label: "없음" }],
        state.subStat,
        (value) => update(() => { state.subStat = value; }),
        { key: "combined-sub-stat", ariaLabel: "부스탯" },
      )),
      field("공/마 선택", searchableSelect(
        [{ value: "attack", label: "공격력" }, { value: "magic", label: "마력" }],
        state.attackType,
        (value) => update(() => { state.attackType = value; }),
        { key: "combined-attack-type", ariaLabel: "공격력 또는 마력" },
      )),
      field("캐릭터 레벨", numberControl(
        "combined-character-level",
        state.characterLevel,
        (value) => {
          state.characterLevel = Math.max(1, Math.min(300, Math.round(value)));
        },
        { min: "1", max: "300" },
      )),
    );
    settings.classList.add("profile-manual-settings");
    return settings;
  }

  function formatRequirement(requirement) {
    const info = getPotentialTargetInfo(requirement.targetType);
    const value = Number(requirement.target);
    if (!(value > Number.EPSILON) || !info) return null;
    const formatted = value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
    return `${info.label} ${formatted}${info.unit} 이상`;
  }

  function formatRequirements(requirements) {
    const labels = requirements.map(formatRequirement).filter(Boolean);
    return labels.length ? labels.join(" + ") : "별도 목표 없음";
  }

  function calculateCurrentResult() {
    const targets = completeTargets().map((target) => ({
      targetType: target.type,
      target: Number(target.value),
    }));
    if (!targets.length || tableState !== "ready" || !regularTables || !additionalTables) {
      return { targets, result: null };
    }
    const profile = getCalculationProfile({
      mainStat: state.mainStat,
      subStat: state.subStat,
      attackType: state.attackType,
      characterLevel: state.characterLevel,
    }, { capability: "potentialEquivalence" });
    const result = calculateCombinedPotentialExpected({
      regularTables,
      additionalTables,
      targets,
      mainStat: profile.mainStat,
      subStat: profile.subStat === "none" ? null : profile.subStat,
      subStats: getProfileSubStats(profile),
      attackType: profile.attackType,
      characterLevel: Math.round(profile.characterLevel),
      itemLevel: Math.round(state.itemLevel),
      regularGrade: state.regularGrade,
      additionalGrade: state.additionalGrade,
      regularResetMethod: "meso",
      additionalResetMethod: "meso",
      statEquivalence: { ...profile.statEquivalence },
      enemyDefense: Number(state.enemyDefense),
    });
    return { targets, result };
  }

  function normalizedPresetTargets(rawTargets) {
    const targets = Array.isArray(rawTargets)
      ? rawTargets.slice(0, 3).map((target) => ({
          type: typeof target?.type === "string" ? target.type : "",
          value: target?.value ?? "",
        }))
      : [];
    while (targets.length < 3) targets.push({ type: "", value: "" });
    return targets;
  }

  function currentExpectationSnapshot() {
    try {
      const { result } = calculateCurrentResult();
      if (!result?.possible || !Number.isFinite(result.expectedCost)) return null;
      return {
        expectedCost: result.expectedCost,
        regularExpectedResets: result.regular.expectedResets,
        additionalExpectedResets: result.additional.expectedResets,
        strategyMode: result.strategyMode,
        savedAt: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  function savedTargetPresetCard() {
    const currentTargets = completeTargets();
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.maxLength = 32;
    nameInput.placeholder = "프리셋 이름 (선택)";
    nameInput.dataset.key = "combined-target-preset-name";
    nameInput.setAttribute("aria-label", "저장할 통합 목표 프리셋 이름");

    const saveButton = element(
      "button",
      "button target-preset-library__save",
      "현재 목표 저장",
    );
    saveButton.type = "button";
    saveButton.disabled =
      currentTargets.length === 0 ||
      tableState !== "ready" ||
      savedTargetPresets.length >= MAX_SAVED_TARGET_PRESETS;
    saveButton.title = currentTargets.length === 0
      ? "수치를 입력한 목표 옵션이 필요합니다."
      : tableState !== "ready"
        ? "확률표를 불러온 뒤 저장할 수 있습니다."
        : savedTargetPresets.length >= MAX_SAVED_TARGET_PRESETS
          ? `목표 프리셋은 최대 ${MAX_SAVED_TARGET_PRESETS}개까지 저장할 수 있습니다.`
          : "현재 장비·등급과 통합 목표 및 기댓값을 브라우저에 저장합니다.";

    const saveCurrent = () => {
      if (saveButton.disabled) return;
      const requestedName = nameInput.value.trim();
      const summary = currentTargets.map(targetSummary).join(" + ");
      savedTargetPresets.unshift({
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: requestedName || `${POTENTIAL_PARTS[state.part]} · ${summary}`,
        part: Number(state.part),
        itemLevel: Math.round(state.itemLevel),
        regularGrade: state.regularGrade,
        additionalGrade: state.additionalGrade,
        mainStat: state.mainStat,
        subStat: state.subStat,
        attackType: state.attackType,
        characterLevel: Math.round(state.characterLevel),
        enemyDefense: Number(state.enemyDefense),
        targets: structuredClone(state.targets),
        expectation: currentExpectationSnapshot(),
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
      list.append(element(
        "p",
        "target-preset-library__empty",
        "저장된 목표 프리셋이 없습니다.",
      ));
    } else {
      savedTargetPresets.forEach((preset) => {
        const targets = normalizedPresetTargets(preset.targets)
          .filter(isCompletePotentialTarget);
        const item = element("article", "target-preset-library__item");
        const copy = element("div", "target-preset-library__copy");
        copy.append(
          element("strong", "target-preset-library__name", preset.name),
          element(
            "span",
            "target-preset-library__meta",
            `${POTENTIAL_PARTS[preset.part] ?? "장비"} · Lv.${preset.itemLevel} · 윗잠 ${GRADE_NAMES[preset.regularGrade] ?? preset.regularGrade} · 아랫잠 ${GRADE_NAMES[preset.additionalGrade] ?? preset.additionalGrade}`,
          ),
          element(
            "span",
            "target-preset-library__targets",
            targets.map(targetSummary).join(" + ") || "목표 옵션 없음",
          ),
          element(
            "span",
            "target-preset-library__expectation",
            Number.isFinite(preset.expectation?.expectedCost)
              ? `저장 당시 기댓값 · ${formatMeso(preset.expectation.expectedCost)}`
              : "저장 당시 기댓값 미저장",
          ),
        );
        const loadButton = element(
          "button",
          "button target-preset-library__load",
          "불러오기",
        );
        loadButton.type = "button";
        loadButton.addEventListener("click", () => update(() => {
          state.part = Number(preset.part);
          state.itemLevel = Math.max(0, Math.min(250, Math.round(preset.itemLevel)));
          state.regularGrade = Object.hasOwn(POTENTIAL_GRADES, preset.regularGrade)
            ? preset.regularGrade
            : "legendary";
          state.additionalGrade = Object.hasOwn(POTENTIAL_GRADES, preset.additionalGrade)
            ? preset.additionalGrade
            : "legendary";
          state.mainStat = preset.mainStat ?? state.mainStat;
          state.subStat = preset.subStat ?? state.subStat;
          state.attackType = preset.attackType ?? state.attackType;
          state.characterLevel = preset.characterLevel ?? state.characterLevel;
          state.enemyDefense = preset.enemyDefense ?? state.enemyDefense;
          state.targets = normalizedPresetTargets(preset.targets);
        }, { reload: true }));
        const removeButton = element(
          "button",
          "icon-button target-preset-library__remove",
          "×",
        );
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

  function resultCard() {
    const section = createResultCard("통합 기댓값");
    const targets = completeTargets().map((target) => ({
      targetType: target.type,
      target: Number(target.value),
    }));
    if (!targets.length) return section;
    if (tableState !== "ready" || !regularTables || !additionalTables) {
      const empty = element("div", "result-empty", tableMessage);
      empty.dataset.tone = tableState === "error" ? "error" : "";
      section.append(empty);
      return section;
    }
    let result;
    try {
      ({ result } = calculateCurrentResult());
    } catch (error) {
      section.append(element("div", "result-empty", error?.message || "계산할 수 없습니다."));
      return section;
    }
    if (!result.possible || !Number.isFinite(result.expectedCost)) {
      section.append(element("div", "result-empty", "현재 등급 조합으로 통합 목표를 만들 수 없습니다."));
      return section;
    }
    section.append(
      metricGrid(
        metric("평균 총비용", formatMeso(result.expectedCost)),
        metric("평균 윗잠 재설정", formatAttempts(result.regular.expectedResets)),
        metric("평균 아랫잠 재설정", formatAttempts(result.additional.expectedResets)),
      ),
      resultLine("추천 윗잠 목표", formatRequirements(result.regular.requirements), true),
      resultLine("추천 아랫잠 목표", formatRequirements(result.additional.requirements), true),
      resultLine("윗잠 목표 달성 확률", formatProbability(result.regular.probability)),
      resultLine("아랫잠 목표 달성 확률", formatProbability(result.additional.probability)),
      resultLine(
        "장비",
        `${POTENTIAL_PARTS[state.part]} · Lv.${state.itemLevel} · 윗잠 ${GRADE_NAMES[state.regularGrade]} · 에디 ${GRADE_NAMES[state.additionalGrade]}`,
      ),
    );
    return section;
  }

  function render() {
    const grid = element("div", "calculator-grid calculator-grid--potential");
    const controls = element("div", "calculator-column");
    const equipment = equipmentCard();
    equipment.classList.add("calculator-equipment");
    const targets = targetCard();
    targets.classList.add("calculator-targets");
    const setup = element("div", "potential-setup-grid");
    setup.append(equipment, targets);
    const profile = characterProfileCard({
      extraContent: manualCharacterSettings(),
      collapseReferenceDetails: true,
      equipmentMetric: "combined",
    });
    profile.classList.add("calculator-profile");
    controls.append(setup, profile);
    const results = element("aside", "calculator-result");
    results.append(resultCard(), savedTargetPresetCard());
    grid.append(controls, results);
    renderWithFocus(root, [grid]);
  }

  const unsubscribe = subscribeCharacterProfile(() => {
    if (disposed) return;
    if (
      state.showEquivalence &&
      !getActiveProfile({ capability: "potentialEquivalence" })
    ) {
      state.showEquivalence = false;
      persist();
    }
    render();
  });
  persist();
  render();
  ensureTables();
  return () => {
    disposed = true;
    requestId += 1;
    unsubscribe();
  };
}
