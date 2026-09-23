import { calculatorStorage, registerResultShare } from "../shared/result-share-state.js";
import {
  SOUL_REFORM_2026_09_17, calculateSoulAmplificationPath,
  calculateSoulPotentialRankUpExpected, calculateSoulPotentialExpected,
  getSoulPotentialRankUpInfo,
  calculateSoulAmplificationReachForChance, calculateSoulPotentialRankUpReachForChance,
} from "maple-core/soul";
import { POTENTIAL_PAGE_TARGETS, calculateResetsForChance } from "maple-core/potential";
import { renderToolNav } from "../shared/shell.js";
import { chip, field, numberInput } from "../shared/ui.js";
import {
  card, cardWithHead, chipRow, createReachChanceControl, details, element, formatAttempts, formatMeso,
  formatProbability, metric, metricGrid, note, potentialResetCostPanel, renderWithFocus, resetAction,
  resultCard, resultLine, row, searchableSelect,
} from "../shared/calculator-ui.js";

import {
  potentialCalculatorLayout, potentialOptionSet, potentialSelectorGroup, potentialTargetItem,
} from "../shared/potential-form-ui.js";
import { isCompletePotentialTarget } from "../shared/potential-target-ui.js";

const STORAGE_KEY = "maplestarforce:soul:v1";
const EOK = 100_000_000;
const GRADES = { rare: "레어", epic: "에픽", unique: "유니크", legendary: "레전드리" };
const GRADE_ORDER = Object.keys(GRADES);
const STAGES = SOUL_REFORM_2026_09_17.amplification.stages;
// These domains were verified against the live 1.2.419 notice after maintenance.
const LIVE_RULES = { asOfDate: "2026-09-17", maintenanceCompleted: true };
const defaults = {
  mode: "amplification", currentStage: 0, targetStage: 4, failures: 0,
  etherPrices: [18, 18, 18, 70],
  grade: "legendary", toGrade: "legendary", resetCount: 0, miracle: false,
  potentialStage: 4, chance: 80, chanceAverage: true,
  targets: [{ type: "attack-power-percent", value: 16 }],
};
let state = structuredClone(defaults);
try {
  const saved = JSON.parse(calculatorStorage.getItem(STORAGE_KEY));
  if (saved && typeof saved === "object") {
    state = { ...state, ...saved,
      grade: saved.grade ?? (saved.mode === "rank-up" ? saved.fromGrade : defaults.grade),
    };
  }
} catch { /* Private browsing may disable storage. */ }
if (!["amplification", "rank-up", "potential"].includes(state.mode)) state.mode = defaults.mode;
const clamp = (value, min, max, fallback = min) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : fallback));
state.currentStage = Math.round(clamp(state.currentStage, 0, 3));
state.targetStage = Math.round(clamp(state.targetStage, state.currentStage + 1, 4));
state.failures = Math.round(clamp(state.failures, 0, STAGES[state.currentStage].guaranteeAfterFailures));
state.potentialStage = Math.round(clamp(state.potentialStage, 1, 4));
state.chance = clamp(state.chance, 0.01, 99.99, 80);
state.etherPrices = Array.from({ length: 4 }, (_, i) => {
  const price = state.etherPrices?.[i];
  return price !== null && price !== undefined && Number.isFinite(Number(price))
    ? Math.max(0, Number(price)) : defaults.etherPrices[i];
});
delete state.etherStocks;
state.chanceAverage = state.chanceAverage === true;
if (!GRADE_ORDER.includes(state.grade)) state.grade = defaults.grade;
delete state.fromGrade;
if (state.mode === "rank-up" && state.grade === "legendary") state.mode = "potential";
if (!GRADE_ORDER.includes(state.toGrade) || GRADE_ORDER.indexOf(state.toGrade) <= GRADE_ORDER.indexOf(state.grade)) state.toGrade = "legendary";
state.resetCount = state.grade === "legendary" ? 0
  : Math.round(clamp(state.resetCount, 0, getSoulPotentialRankUpInfo({ grade: state.grade }).guaranteeAtResetCount - 1));
state.miracle = state.miracle === true;
const TARGET_TYPES = [
  "attack-power-percent", "magic-power-percent", "boss-damage", "ignore-defense",
  "damage", "critical-rate", "str-percent", "dex-percent", "int-percent",
  "luk-percent", "all-stat-percent", "hp-percent", "attack-power-flat", "magic-power-flat",
  "str-flat", "dex-flat", "int-flat", "luk-flat", "hp-flat",
];
const savedTargets = Array.isArray(state.targets) ? state.targets : defaults.targets;
state.targets = Array.from({ length: 3 }, (_, index) => {
  const target = savedTargets[index];
  return {
    type: TARGET_TYPES.includes(target?.type) ? target.type : "",
    value: target?.value === "" || target?.value == null ? "" : Math.max(0, Number(target.value) || 0),
  };
});

const root = document.querySelector("#tool");
renderToolNav(document.querySelector("#toolnav"), "soul");
function save() { try { calculatorStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {} }
function update(fn) { fn(); save(); render(); }
function input(key, extra = {}) {
  const control = numberInput(state[key], (value) => update(() => { state[key] = value; }), extra);
  control.dataset.key = `soul-${key}`;
  return control;
}
function select(key, options, onChange = () => {}) {
  const picker = chipRow(...options.map(({ value, label, disabled = false }) => chip(label, state[key] === value,
    () => update(() => { state[key] = value; onChange(); }), disabled)));
  picker.setAttribute("role", "group");
  picker.dataset.key = `soul-${key}`;
  return picker;
}

function stageOptions(start = 0) {
  return Array.from({ length: 5 - start }, (_, i) => ({ value: start + i, label: `${start + i}단계` }));
}
function sourceLink(label, href) {
  const link = element("a", "", label);
  link.href = href; link.target = "_blank"; link.rel = "noreferrer";
  return link;
}
function settingsCard() {
  const modePicker = chipRow(
    chip("소울 증폭", state.mode === "amplification", () => {
      if (state.mode !== "amplification") update(() => { state.mode = "amplification"; });
    }),
    chip("잠재 능력", state.mode !== "amplification", () => {
      if (state.mode === "amplification") update(() => { state.mode = "potential"; });
    }),
  );
  modePicker.classList.add("potential-system-switch");
  modePicker.setAttribute("role", "group");
  modePicker.setAttribute("aria-label", "소울 계산 종류");
  const section = card("소울 설정", modePicker);
  if (state.mode === "amplification") {
    const picker = select("currentStage", stageOptions(0).slice(0, 4), () => {
      state.targetStage = Math.max(state.currentStage + 1, state.targetStage);
      state.failures = 0;
    });
    picker.classList.add("potential-grade-picker");
    section.append(potentialSelectorGroup("현재 증폭 단계", picker));
  } else {
    const picker = select("grade", GRADE_ORDER.map((value) => ({
      value, label: value === "legendary" ? "레전" : GRADES[value],
    })), () => {
      if (state.grade === "legendary") {
        state.mode = "potential";
      } else if (GRADE_ORDER.indexOf(state.toGrade) <= GRADE_ORDER.indexOf(state.grade)) {
        state.toGrade = GRADE_ORDER[GRADE_ORDER.indexOf(state.grade) + 1];
      }
      state.resetCount = 0;
    });
    picker.classList.add("potential-grade-picker");
    section.append(potentialSelectorGroup("현재 등급", picker));
    const calculationModePicker = chipRow(
      chip("옵션뽑기", state.mode === "potential", () => {
        if (state.mode !== "potential") update(() => { state.mode = "potential"; });
      }),
      chip("등급업", state.mode === "rank-up", () => {
        if (state.mode !== "rank-up" && state.grade !== "legendary") update(() => { state.mode = "rank-up"; });
      }, state.grade === "legendary"),
    );
    if (state.grade === "legendary") calculationModePicker.lastElementChild.title = "레전드리는 최고 등급입니다.";
    calculationModePicker.classList.add("potential-calculation-mode");
    calculationModePicker.setAttribute("role", "group");
    calculationModePicker.setAttribute("aria-label", "소울 잠재능력 계산 종류");
    section.append(potentialSelectorGroup("목표", calculationModePicker, "target"));
    if (state.mode === "potential") {
      const stagePicker = select("potentialStage", stageOptions(1));
      stagePicker.classList.add("potential-grade-picker");
      section.append(potentialSelectorGroup("증폭 단계", stagePicker, "target"));
    }
    section.append(potentialResetCostPanel([{
      label: "소울", cost: SOUL_REFORM_2026_09_17.potential.resetCostsByGrade[state.grade],
    }]));
  }
  return section;
}
function amplificationControls() {
  const currentConfig = STAGES[state.currentStage];
  const target = card("증폭 목표",
    row(field("목표 증폭 단계", select("targetStage", stageOptions(1).map((option) => ({
      ...option, disabled: option.value <= state.currentStage,
    }))))),
    row(field("현재 단계 실패 횟수", input("failures", { min: "0", max: String(currentConfig.guaranteeAfterFailures), step: "1" }))),
  );
  const prices = row(...STAGES.map((config) => {
    const index = config.stage - 1;
    const price = numberInput(state.etherPrices[index], (value) => update(() => { state.etherPrices[index] = value; }), { min: "0", step: "0.01" });
    price.dataset.key = `soul-ether-price-${index}`;
    return field(`${config.stage}단계 에테르 (억 메소)`, price);
  }));
  prices.classList.add("soul-ether-prices");
  const costs = cardWithHead("에테르 비용 설정", resetAction("가격 초기화", () => update(() => {
    state.etherPrices = [...defaults.etherPrices];
  }), { className: "button--compact" }), prices,
  note("에테르 가격이 0이면 증폭에 직접 소비하는 메소만 합산합니다."));
  const column = element("div", "calculator-column");
  column.append(target, costs);
  return column;
}
function rankUpControls() {
  const info = getSoulPotentialRankUpInfo({ grade: state.grade });
  const maxProgress = info.guaranteeAtResetCount - 1;
  const chancePicker = chipRow(
    chip("일반 확률", !state.miracle, () => update(() => { state.miracle = false; })),
    chip("미라클 타임", state.miracle, () => update(() => { state.miracle = true; })),
  );
  chancePicker.setAttribute("role", "group");
  chancePicker.setAttribute("aria-label", "등급 업 확률 적용 방식");
  const progress = row(field(`${GRADES[state.grade]} → ${GRADES[info.toGrade]} 천장 (최대 ${maxProgress})`,
    input("resetCount", { min: "0", max: String(maxProgress), step: "1" })));
  progress.classList.add("potential-rank-progress");
  return cardWithHead("등급업 목표", resetAction("천장 초기화", () => update(() => {
    state.resetCount = 0;
  }), { className: "button--compact", key: "soul-reset-rank-progress" }),
    row(field("확률 적용", chancePicker)),
    row(field("목표 등급", select("toGrade", GRADE_ORDER.slice(1).map((value) => ({
      value, label: value === "legendary" ? "레전" : GRADES[value],
      disabled: GRADE_ORDER.indexOf(value) <= GRADE_ORDER.indexOf(state.grade),
    }))))),
    progress,
  );
}
function potentialControls() {
  const targets = state.targets.map((target, index) => {
    const type = searchableSelect([
      { value: "", label: "없음" },
      ...TARGET_TYPES.map((value) => ({ value, label: POTENTIAL_PAGE_TARGETS[value].label })),
    ], target.type, (value) => update(() => { target.type = value; target.value = ""; }), {
      key: `soul-target-${index}`, ariaLabel: `옵션 세트 1의 ${index + 1}번째 옵션`,
      placeholder: "옵션 검색", clearable: true,
    });
    const value = numberInput(target.value, (next) => update(() => { target.value = next; }), {
      min: "0", step: "1", allowEmpty: true, disabled: !target.type,
    });
    value.dataset.key = `soul-target-value-${index}`;
    value.setAttribute("aria-label", `옵션 세트 1의 ${index + 1}번째 최소 수치`);
    return potentialTargetItem({ select: type, value, unit: POTENTIAL_PAGE_TARGETS[target.type]?.unit ?? "" });
  });
  const set = potentialOptionSet({ label: "옵션 세트 1", targets });
  return cardWithHead("목표 옵션", resetAction("목표 초기화", () => update(() => {
    state.targets = Array.from({ length: 3 }, () => ({ type: "", value: "" }));
  }), { className: "button--compact", key: "soul-reset-targets" }), set);
}
function soulReachControl(result) {
  const attemptsMetric = metric("목표 도달 재설정", "-");
  const costMetric = metric("목표 도달 비용", "-");
  const averageChance = Number((result.probability > 0 && result.probability < 1
    ? (1 - (1 - result.probability) ** result.expectedResets) * 100 : 63.21).toFixed(2));
  return createReachChanceControl({
    id: "soul-target-chance", value: state.chanceAverage ? averageChance : state.chance,
    min: 0.01, max: 99.99, average: state.chanceAverage, averageValue: averageChance,
    rangeKey: "soul-chance-range", numberKey: "soul-chance",
    metrics: [attemptsMetric, costMetric],
    onChange: (value, { average }) => {
      state.chance = value; state.chanceAverage = average;
      const attempts = average ? result.expectedResets : calculateResetsForChance(result.probability, value / 100);
      const label = average ? "평균" : `${Number(value.toFixed(2))}% 도달`;
      attemptsMetric.querySelector("span").textContent = `${label} 재설정`;
      attemptsMetric.querySelector("strong").textContent = formatAttempts(attempts);
      costMetric.querySelector("span").textContent = `${label} 비용`;
      costMetric.querySelector("strong").textContent = formatMeso(attempts * result.resetCost);
    }, onCommit: save,
  });
}

function soulProgressReachControl(result, amplification, onSelectionChange = () => {}) {
  const calculate = amplification ? calculateSoulAmplificationReachForChance : calculateSoulPotentialRankUpReachForChance;
  const initial = calculate(result, state.chance / 100);
  const averageChance = Number(clamp(initial.averageAttemptChance * 100, 0.01, 99.99).toFixed(2));
  const attemptLabel = amplification ? "증폭 시도" : "재설정";
  const attemptsMetric = metric(`목표 도달 ${attemptLabel}`, "-");
  const costMetric = metric("목표 도달 비용", "-");
  return createReachChanceControl({
    id: "soul-target-chance", value: state.chanceAverage ? averageChance : state.chance,
    min: 0.01, max: 99.99, average: state.chanceAverage, averageValue: averageChance,
    rangeKey: "soul-chance-range", numberKey: "soul-chance",
    metrics: [attemptsMetric, costMetric],
    onChange: (value, { average }) => {
      state.chance = value; state.chanceAverage = average;
      const reach = average ? {
        attempts: amplification ? result.expected.attempts : result.expectedAttempts,
        cost: amplification ? result.costs.totalMeso : result.expectedCostMeso,
      } : calculate(result, value / 100);
      const label = average ? "평균" : `${Number(value.toFixed(2))}% 도달`;
      attemptsMetric.querySelector("span").textContent = `${label} ${attemptLabel}`;
      attemptsMetric.querySelector("strong").textContent = formatAttempts(reach.attempts);
      costMetric.querySelector("span").textContent = `${label} 비용`;
      costMetric.querySelector("strong").textContent = formatMeso(reach.cost);
      onSelectionChange({ chance: value / 100, average, label });
    }, onCommit: save,
  });
}

function soulProgressStageDetails(result, amplification) {
  const calculate = amplification ? calculateSoulAmplificationReachForChance : calculateSoulPotentialRankUpReachForChance;
  const attemptLabel = amplification ? "시도" : "재설정";
  const panel = details("단계별 기댓값");
  panel.dataset.detailsKey = amplification ? "soul-amplification" : "soul-rank-up";
  const rows = result.stages.map((stage) => {
    const attempts = resultLine(`평균 ${attemptLabel}`, "-");
    const cost = resultLine("평균 비용", "-");
    if (amplification) {
      panel.append(element("h3", "", `${stage.stage}단계 증폭`),
        resultLine("다음 시도 성공 확률", formatProbability(stage.currentSuccessProbability)),
        attempts,
        resultLine("성공 보장까지 최대 시도", `${stage.maximumAttempts}회`),
        cost);
    } else {
      panel.append(element("h3", "", `${GRADES[stage.fromGrade]} → ${GRADES[stage.toGrade]}`),
        resultLine("등급 업 확률", formatProbability(stage.probability, 4)),
        resultLine("1회 비용", formatMeso(stage.resetCostMeso)),
        attempts, cost);
    }
    const average = {
      attempts: amplification ? stage.expected.attempts : stage.expectedAttempts,
      cost: amplification ? stage.costs.totalMeso : stage.expectedCostMeso,
    };
    // Keep each single-stage plan stable so moving the slider reuses its distribution.
    return { average, plan: { stages: [stage] }, attempts, cost };
  });
  const explanation = note("각 단계에 선택한 확률을 각각 적용합니다. 단계별 비용의 합은 전체 목표 도달 비용과 다를 수 있습니다.");
  panel.append(explanation);
  return {
    panel,
    update({ chance, average, label }) {
      for (const row of rows) {
        const reach = average ? row.average : calculate(row.plan, chance);
        row.attempts.firstElementChild.textContent = `${label} ${attemptLabel}`;
        row.attempts.lastElementChild.textContent = amplification
          ? `${reach.attempts.toFixed(2)}회` : formatAttempts(reach.attempts);
        row.cost.firstElementChild.textContent = `${label} 비용`;
        row.cost.lastElementChild.textContent = formatMeso(reach.cost);
      }
      explanation.hidden = average;
    },
  };
}

function results() {
  const section = resultCard("기댓값");
  try {
    if (state.mode === "amplification") {
      const result = calculateSoulAmplificationPath({ ...LIVE_RULES,
        currentStage: Number(state.currentStage), targetStage: Number(state.targetStage), currentFailures: Number(state.failures),
        etherPriceMesoByStage: Object.fromEntries(state.etherPrices.map((price, i) => [i + 1, Number(price) * EOK])),
      });
      const stages = soulProgressStageDetails(result, true);
      section.append(metricGrid(metric("평균 증폭 시도", formatAttempts(result.expected.attempts)), metric("평균 총비용", formatMeso(result.costs.totalMeso))),
        soulProgressReachControl(result, true, stages.update),
        resultLine("증폭 소비 메소", formatMeso(result.costs.attemptMeso)), resultLine("에테르 구매 비용", formatMeso(result.costs.etherMeso)));
      section.append(stages.panel);
    } else if (state.mode === "rank-up") {
      const result = calculateSoulPotentialRankUpExpected({ ...LIVE_RULES, fromGrade: state.grade, toGrade: state.toGrade,
        currentResetCount: Number(state.resetCount), miracle: state.miracle });
      const stages = soulProgressStageDetails(result, false);
      section.append(metricGrid(metric("평균 재설정", formatAttempts(result.expectedAttempts)), metric("평균 총비용", formatMeso(result.expectedCostMeso))),
        soulProgressReachControl(result, false, stages.update),
        resultLine("목표 등급", `${GRADES[state.grade]} → ${GRADES[state.toGrade]}`, true),
        resultLine("확률 적용", state.miracle ? "미라클 타임" : "일반 확률"),
        resultLine("성공 보장까지 최대 재설정", `${result.maximumAttempts}회`));
      section.append(stages.panel);
    } else {
      const targets = state.targets.filter(isCompletePotentialTarget);
      if (!targets.length) {
        section.append(element("div", "result-empty", "목표 옵션과 수치를 입력해 주세요."));
        return section;
      }
      const result = calculateSoulPotentialExpected({ grade: state.grade, stage: Number(state.potentialStage), mainStat: "STR", characterLevel: 290,
        targets: targets.map((target) => ({ targetType: target.type, target: Number(target.value) })) });
      section.append(metricGrid(metric("평균 재설정", formatAttempts(result.expectedResets)), metric("평균 총비용", formatMeso(result.expectedCost))),
        soulReachControl(result),
        resultLine("1회 성공 확률", formatProbability(result.probability, 8)),
        resultLine("1회 재설정 비용", formatMeso(result.resetCost)));
      section.append(note("현재 옵션은 공식 분포로 평균합니다. 목표 도달 확률별 횟수는 평균을 이용한 근사값입니다."));
      if (result.probability === 0) section.append(note("현재 등급과 증폭 단계의 공식 옵션으로는 해당 목표에 도달할 수 없습니다."));
    }
  } catch (error) { section.append(element("div", "result-empty", error.message)); }
  section.append(sourceLink("공식 소울 잠재능력 확률", "https://maplestory.nexon.com/Guide/OtherProbability/cube/Soulpotential"),
    document.createTextNode(" · "), sourceLink("9월 17일 업데이트", "https://maplestory.nexon.com/news/update/813"));
  return section;
}
function render() {
  const grid = potentialCalculatorLayout({
    equipment: settingsCard(),
    targets: state.mode === "amplification" ? amplificationControls() : state.mode === "rank-up" ? rankUpControls() : potentialControls(),
    results: results(),
  });
  renderWithFocus(root, [grid]);
}
save();
render();

registerResultShare(() => ({ local: { [STORAGE_KEY]: state } }));
