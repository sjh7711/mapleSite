import { element } from "./calculator-ui.js";
import { formatPotentialTargetSummary } from "./potential-target-ui.js";

// 잠재능력과 소울의 공통 UI. 계산 규칙과 입력 상태는 각 페이지가 관리한다.
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

export function potentialSuccessCombinationList({
  title,
  setNumber,
  result,
  formatTotal,
  emptyMessage = "현재 확률표에는 모든 목표를 만족하는 옵션 조합이 없습니다.",
}) {
  const { combinations, conditions, totalCount, hiddenCount, truncated } = result;
  const content = element("div", "stat-combinations");
  const head = element("header", "stat-combinations__head");
  head.append(
    element("span", "success-condition__label", `세트 ${setNumber}`),
    element("h4", "stat-combinations__title", title),
  );
  content.append(head);

  if (combinations.length === 0) {
    content.append(element("p", "stat-combinations__empty", emptyMessage));
    return content;
  }

  const list = element("ol", "stat-combinations__list");
  list.tabIndex = 0;
  list.setAttribute("role", "region");
  list.setAttribute("aria-label", title);
  for (const combination of combinations) {
    const item = element("li", "stat-combination");
    const options = element("ul", "stat-combination__options");
    for (const { name } of combination.options) {
      options.append(element("li", "stat-combination__option", name));
    }
    const total = formatTotal
      ? formatTotal(combination)
      : conditions.map(({ targetType }, index) =>
          formatPotentialTargetSummary({
            type: targetType,
            value: combination.scores[index].toLocaleString("ko-KR", { maximumFractionDigits: 4 }),
          }),
        ).join(" · ");
    item.append(options, element("span", "stat-combination__total", `합계 ${total}`));
    list.append(item);
  }
  const countText = truncated
    ? `전체 ${totalCount.toLocaleString("ko-KR")}개 중 ${combinations.length}개 표시 · ${hiddenCount.toLocaleString("ko-KR")}개 더 있음`
    : `전체 ${totalCount.toLocaleString("ko-KR")}개 조합`;
  content.append(list, element("p", "stat-combinations__count", countText));
  return content;
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
