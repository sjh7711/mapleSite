import { calculateHexaStat, createHexaStatBudget, maxGrade, maxLevel, minResetGrade } from "maple-core/hexa-stat";
import { createReachChanceControl, element, formatProbability, metric } from "../shared/calculator-ui.js";
import { calculatorStorage, registerResultShare } from "../shared/result-share-state.js";
import { renderToolNav } from "../shared/shell.js";

const storageKey = "maplestarforce:hexa-stat:v1";
const defaults = { main: 6, sub1: 4, sub2: 3, target: 8, event: false, goalProbability: null };
const number = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });
const percentInput = (value) => Math.min(100, Math.max(0, Math.round(value * 100) / 100));
const formatFragments = (value) => Number.isFinite(value) ? `${number.format(value)}개` : "100% 보장 불가";

let saved;
try { saved = JSON.parse(calculatorStorage.getItem(storageKey)); } catch { /* Use defaults. */ }
const state = { ...defaults };
for (const key of ["main", "sub1", "sub2", "target"]) {
  const value = saved?.[key];
  if (Number.isInteger(value) && value >= (key === "target" ? 1 : 0) && value <= maxLevel) state[key] = value;
}
state.event = saved?.event === true;
state.goalProbability = Number.isFinite(saved?.goalProbability) ? percentInput(saved.goalProbability) : null;

const root = document.querySelector("#tool");
const form = root.querySelector("#hexa-settings");
const error = form.querySelector(".hexa-error");
const policy = root.querySelector(".hexa-policy tbody");
const reach = root.querySelector("#hexa-reach");
const outputs = Object.fromEntries([...root.querySelectorAll("[data-hexa-output]")]
  .map((node) => [node.dataset.hexaOutput, node]));

for (const name of ["main", "sub1", "sub2", "target"]) {
  const isTarget = name === "target";
  const select = form.elements.namedItem(name);
  for (let level = isTarget ? 1 : 0; level <= maxLevel; level++) {
    select.add(new Option(`${level}레벨${isTarget ? " 이상" : ""}`, level));
  }
  select.value = state[name];
}
form.elements.namedItem("event").checked = state.event;

function save() {
  if (state.main + state.sub1 + state.sub2 <= maxGrade) {
    calculatorStorage.setItem(storageKey, JSON.stringify(state));
  }
}

function renderPolicy(reset, grade, main) {
  const rows = [];
  function addRow(index, criterion) {
    const row = element("tr");
    const header = element("th", "", `${index}등급`);
    header.scope = "row";
    if (index === grade) {
      row.setAttribute("aria-current", "true");
      header.append(element("span", "hexa-policy__current", `현재 · 메인 ${main}레벨`));
    }
    row.append(header, element("td", "", criterion));
    rows.push(row);
  }

  if (grade < minResetGrade) addRow(grade, `${minResetGrade}등급부터 가능`);
  for (let index = minResetGrade; index <= maxGrade; index++) {
    const levels = reset[index].flatMap((shouldReset, level) => shouldReset ? [level] : []);
    const continuous = levels.length > 0 && levels.every((level, offset) => level === offset);
    const text = continuous ? `${levels.at(-1)}레벨 이하` : levels.map((level) => `${level}레벨`).join(", ");
    addRow(index, text || "계속 강화");
  }
  policy.replaceChildren(...rows);
}

function render() {
  const { main, sub1, sub2, target, event, goalProbability } = state;
  const grade = main + sub1 + sub2;
  const valid = grade <= maxGrade;
  const result = calculateHexaStat({ target, event });
  renderPolicy(result.reset, grade, main);
  outputs.grade.textContent = valid
    ? `현재 ${grade}등급 · 남은 강화 ${maxGrade - grade}회` : `현재 레벨 합계 ${grade}`;
  error.hidden = valid;
  error.textContent = valid ? "" : `세 줄의 레벨 합계는 ${maxGrade} 이하여야 합니다.`;
  reach.hidden = !valid;
  if (!valid) {
    for (const name of ["fragments", "optimal", "chance"]) outputs[name].textContent = "—";
    return;
  }

  const chance = result.chance[grade][main];
  const average = result.total[grade][main];
  outputs.chance.textContent = formatProbability(chance, chance > 0 && chance < 0.00001 ? 7 : 3);
  outputs.fragments.textContent = formatFragments(result.fragments[grade][main]);
  outputs.optimal.textContent = formatFragments(average);

  const budget = createHexaStatBudget(result, grade, main);
  const budgetMetric = metric("필요 솔 에르다 조각", "");
  const budgetValue = budgetMetric.querySelector("strong");
  budgetValue.setAttribute("aria-live", "polite");
  reach.replaceChildren(createReachChanceControl({
    id: "hexa-goal-probability",
    min: 0,
    max: 100,
    value: goalProbability ?? 0,
    average: goalProbability === null,
    averageValue: () => budget.probabilityAt(average) * 100,
    normalize: percentInput,
    metrics: [budgetMetric],
    onChange(value, { average: showAverage }) {
      state.goalProbability = showAverage ? null : value;
      budgetValue.textContent = formatFragments(showAverage ? average : budget.requiredFragments(value / 100));
    },
    onCommit: save,
  }));
}

form.addEventListener("submit", (event) => event.preventDefault());
form.addEventListener("change", ({ target }) => {
  if (target.name === "event") state.event = target.checked;
  else state[target.name] = Number(target.value);
  save();
  render();
});

renderToolNav(document.querySelector("#toolnav"), "hexa-stat");
registerResultShare(() => ({ local: { [storageKey]: state } }));
render();
