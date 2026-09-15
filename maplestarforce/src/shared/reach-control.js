/*
 * 목표 도달 확률 조절기의 공통 골격과 입력 동작.
 *
 * 계산기마다 확률로부터 계산하는 값은 다르지만, 평균/확률 모드 표시와
 * 슬라이더·숫자 입력·평균 복귀 동작은 같아야 한다. 각 페이지는 metric과
 * 계산 콜백만 넘기고 이 파일이 나머지 상호작용을 책임진다.
 */

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== "") node.textContent = String(text);
  return node;
}

function finiteNumber(value) {
  if (value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function createReachChanceControl({
  id,
  label = "목표 도달 확률",
  className = "",
  modeClassName = "",
  actionsClassName = "",
  value,
  min,
  max,
  step = 0.01,
  average = false,
  averageValue = value,
  resetTitle = "평균 기댓값으로 돌아갑니다.",
  rangeKey = "",
  numberKey = "",
  metrics = [],
  normalize = (next) => next,
  deriveAverage = ({ requestedAverage }) => requestedAverage,
  onChange = () => {},
  onCommit = () => {},
} = {}) {
  const control = element(
    "section",
    `reach-control${className ? ` ${className}` : ""}`,
  );
  const labelNode = element("label", "reach-control__label", label);
  labelNode.htmlFor = id;
  const modeStatus = element(
    "span",
    `reach-control__mode${modeClassName ? ` ${modeClassName}` : ""}`,
    "평균",
  );
  const reset = element("button", "reach-control__reset", "평균으로 보기");
  reset.type = "button";
  reset.title = resetTitle;
  const actions = element(
    "div",
    `reach-control__actions${actionsClassName ? ` ${actionsClassName}` : ""}`,
  );
  actions.append(modeStatus, reset);
  const head = element("div", "reach-control__head");
  head.append(labelNode, actions);

  const range = document.createElement("input");
  range.id = id;
  range.type = "range";
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.setAttribute("aria-label", "목표 도달 확률 슬라이더");
  if (rangeKey) range.dataset.key = rangeKey;

  const number = document.createElement("input");
  number.type = "number";
  number.min = String(min);
  number.max = String(max);
  number.step = String(step);
  number.inputMode = "decimal";
  number.setAttribute("aria-label", "목표 도달 확률 직접 입력");
  if (numberKey) number.dataset.key = numberKey;

  const numberControl = element("span", "reach-control__number");
  numberControl.append(number, element("span", "reach-control__unit", "%"));
  const inputs = element("div", "reach-control__inputs");
  inputs.append(range, numberControl);

  const metricsNode = element("div", "metric-grid reach-control__metrics");
  metricsNode.append(...metrics.filter(Boolean));

  let currentValue = Number(value);
  let averageMode = Boolean(average);

  const normalizeCandidate = (raw, { live = false } = {}) => {
    const numeric = finiteNumber(raw);
    if (numeric === null) return null;
    if (live && (numeric < min || numeric > max)) return null;
    const normalized = Number(normalize(numeric, currentValue));
    if (!Number.isFinite(normalized)) return null;
    return Math.min(max, Math.max(min, normalized));
  };

  const paintMode = () => {
    control.dataset.mode = averageMode ? "average" : "chance";
    modeStatus.hidden = !averageMode;
    reset.hidden = averageMode;
    reset.disabled = averageMode;
    inputs.dataset.active = String(!averageMode);
  };

  const apply = (next, {
    requestedAverage = false,
    syncNumber = false,
    phase = "input",
    source = "number",
  } = {}) => {
    currentValue = next;
    averageMode = Boolean(deriveAverage({
      value: next,
      requestedAverage,
      source,
      phase,
    }));
    range.value = String(next);
    if (syncNumber) number.value = String(next);
    paintMode();
    onChange(next, {
      average: averageMode,
      phase,
      source,
      control,
      inputs,
      metrics: metricsNode,
      range,
      number,
    });
  };

  const commit = (phase, source) => {
    onCommit(currentValue, {
      average: averageMode,
      phase,
      source,
      control,
      inputs,
      metrics: metricsNode,
      range,
      number,
    });
  };

  range.addEventListener("input", () => {
    const next = normalizeCandidate(range.value, { live: true });
    if (next === null) return;
    apply(next, { syncNumber: true, phase: "input", source: "range" });
  });
  range.addEventListener("change", () => commit("change", "range"));

  number.addEventListener("input", () => {
    const next = normalizeCandidate(number.value, { live: true });
    if (next === null) return;
    apply(next, { phase: "input", source: "number" });
  });
  number.addEventListener("change", () => {
    const next = normalizeCandidate(number.value) ?? currentValue;
    apply(next, { syncNumber: true, phase: "change", source: "number" });
    commit("change", "number");
  });

  reset.addEventListener("click", () => {
    const raw = typeof averageValue === "function" ? averageValue() : averageValue;
    const next = normalizeCandidate(raw) ?? currentValue;
    apply(next, {
      requestedAverage: true,
      syncNumber: true,
      phase: "reset",
      source: "reset",
    });
    commit("reset", "reset");
  });

  control.append(head, inputs, metricsNode);
  const initial = normalizeCandidate(currentValue) ?? min;
  number.value = String(initial);
  apply(initial, {
    requestedAverage: average,
    syncNumber: true,
    phase: "initial",
    source: "initial",
  });
  return control;
}
