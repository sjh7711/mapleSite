import { element } from "./calculator-ui.js";

// 잠재능력과 소울이 함께 쓰는 폼. 계산 규칙과 입력 상태는 각 페이지가 관리한다.
export function potentialSelectorGroup(label, picker, variant = "grade") {
  const group = element("div", `potential-selector-group potential-selector-group--${variant}`);
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", label);
  group.append(element("p", "potential-selector-group__label", label), picker);
  return group;
}

export function potentialTargetItem({ select, value, unit = "", disabled = false }) {
  const valueControl = element("span", "target-value");
  valueControl.append(value, element("span", "target-value__unit", unit));
  const controls = element("div", "target-row");
  controls.append(select, valueControl);
  const item = element("div", "target-item");
  item.dataset.disabled = String(disabled);
  item.append(controls);
  return item;
}

export function potentialOptionSet({ label, targets, onRemove }) {
  const set = element("section", "option-set");
  const head = element("div", "option-set__head");
  const title = element("div", "option-set__title-row");
  title.append(
    element("h3", "option-set__title", label),
    element("span", "option-set__badge", "모두 만족"),
  );
  head.append(title);
  if (onRemove) {
    const remove = element("button", "icon-button option-set__remove", "×");
    remove.type = "button";
    remove.title = `${label} 삭제`;
    remove.setAttribute("aria-label", `${label} 삭제`);
    remove.addEventListener("click", onRemove);
    head.append(remove);
  }
  const list = element("div", "target-list");
  list.append(...targets);
  set.append(head, list);
  return set;
}

export function potentialCalculatorLayout({ equipment, targets, extraControls = [], results }) {
  const grid = element("div", "calculator-grid calculator-grid--potential");
  const controls = element("div", "calculator-column");
  equipment.classList.add("calculator-equipment");
  targets.classList.add("calculator-targets");
  const setup = element("div", "potential-setup-grid");
  setup.append(equipment, targets);
  controls.append(setup, ...extraControls);
  const result = element("aside", "calculator-result");
  result.append(...[results].flat());
  grid.append(controls, result);
  return grid;
}
