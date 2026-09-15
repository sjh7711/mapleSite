export function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== "") node.textContent = String(text);
  return node;
}

export function card(title, ...children) {
  const section = element("section", "card");
  const heading = element("h2", "", title);
  section.append(heading, ...children.flat().filter(Boolean));
  return section;
}

/** 계산 결과는 어느 계산기에서 만들어도 같은 카드 계약을 사용한다. */
export function resultCard(title, ...children) {
  const section = card(title, ...children);
  section.classList.add("result-card");
  return section;
}

export function cardWithHead(title, action, ...children) {
  const section = element("section", "card");
  const head = element("div", "card__head");
  head.append(element("h2", "", title));
  if (action) head.append(action);
  section.append(head, ...children.flat().filter(Boolean));
  return section;
}

export function row(...children) {
  const node = element("div", "settings settings--row");
  node.append(...children.flat().filter(Boolean));
  return node;
}

export function segmentedControl(children, className = "") {
  const node = element("div", "chips");
  if (className) node.classList.add(className);
  node.append(...[children].flat(2).filter(Boolean));
  return node;
}

export function chipRow(...children) {
  return segmentedControl(children);
}

/** 삭제·초기화처럼 되돌릴 수 있는 위험 동작의 모양과 접근성 이름을 통일한다. */
export function resetAction(label, onClick, {
  className = "",
  disabled = false,
  title = "",
  ariaLabel = label,
  key = "",
} = {}) {
  const button = element(
    "button",
    `button button--quiet button--reset${className ? ` ${className}` : ""}`,
    label,
  );
  button.type = "button";
  button.disabled = Boolean(disabled);
  button.setAttribute("aria-label", ariaLabel);
  if (title) button.title = title;
  if (key) button.dataset.key = key;
  if (typeof onClick === "function") button.addEventListener("click", onClick);
  return button;
}

export { searchableSelect };
export { createReachChanceControl } from "./reach-control.js";

export function textInput(value, onInput, attributes = {}) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value ?? "";
  Object.assign(input, attributes);
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

export function note(text, className = "section-note") {
  return element("p", className, text);
}

export function resultLine(label, value, strong = false) {
  const line = element("p", "result__line");
  line.append(element("span", "", label), element(strong ? "strong" : "span", "", value));
  return line;
}

/** 윗잠·아랫잠·통합 화면에서 1회 재설정에 드는 메소를 같은 모양으로 표시한다. */
export function potentialResetCostPanel(
  items,
  { title = "1회 메소 재설정", formatCost = formatMeso } = {},
) {
  const costs = (Array.isArray(items) ? items : []).filter(
    (item) => item && Number.isFinite(item.cost),
  );
  if (costs.length === 0) return null;

  const panel = element("div", "potential-reset-cost");
  panel.dataset.count = String(costs.length);
  panel.append(element("strong", "potential-reset-cost__label", title));
  for (const { label, cost } of costs) {
    const item = element("div", "potential-reset-cost__item");
    item.append(
      element("span", "", label),
      element("strong", "", formatCost(cost)),
    );
    panel.append(item);
  }
  return panel;
}

export function metric(label, value, hint = "") {
  const box = element("div", "metric");
  box.append(element("span", "", label), element("strong", "", value));
  if (hint) box.append(element("small", "", hint));
  return box;
}

export function metricGrid(...metrics) {
  const box = element("div", "metric-grid");
  box.append(...metrics.flat().filter(Boolean));
  return box;
}

export function resultHero(label, value) {
  const box = element("div", "result-hero");
  box.append(element("span", "result-hero__label", label), element("strong", "", value));
  return box;
}

export function details(summary, ...children) {
  const node = element("details", "compact-details");
  node.append(element("summary", "", summary), ...children.flat().filter(Boolean));
  return node;
}

export function renderWithFocus(root, nodes) {
  const active = document.activeElement;
  const key = active?.dataset?.key;
  const start = active?.selectionStart ?? null;
  const end = active?.selectionEnd ?? null;
  const scrollY = window.scrollY;
  const detailsOpenState = new Map(
    [...root.querySelectorAll("details[data-details-key]")]
      .map((node) => [node.dataset.detailsKey, node.open]),
  );
  root.replaceChildren(...nodes.flat().filter(Boolean));
  for (const next of root.querySelectorAll("details[data-details-key]")) {
    if (detailsOpenState.has(next.dataset.detailsKey)) {
      next.open = detailsOpenState.get(next.dataset.detailsKey);
    }
  }
  if (key) {
    const next = [...root.querySelectorAll("[data-key]")].find(
      (candidate) => candidate.dataset.key === key,
    );
    if (next) {
      if (typeof next.focusAfterRender === "function") {
        next.focusAfterRender({ preventScroll: true });
      } else {
        next.focus({ preventScroll: true });
      }
      if (start !== null && typeof next.setSelectionRange === "function") {
        try {
          next.setSelectionRange(start, end ?? start);
        } catch {
          // number/select 요소는 선택 범위를 지원하지 않을 수 있다.
        }
      }
    }
  }
  window.scrollTo({ top: scrollY });
}

export function finite(value, fallback = "-") {
  return Number.isFinite(value) ? value : fallback;
}

export const MESO = 100_000_000;
export const MAN = 10_000;
export const JO = 1_000_000_000_000;

export function formatMeso(value, digits = 2) {
  if (!Number.isFinite(value)) return "계산 불가";
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  if (absolute >= JO) {
    // 억 단위에서 먼저 반올림해 9,999.995억이 별도의 억 잔액으로 남지
    // 않게 하고, 조 아래 잔액은 사용자가 읽던 억 단위를 그대로 유지한다.
    const roundedEok = Math.round((absolute / MESO) * (10 ** digits)) /
      (10 ** digits);
    const jo = Math.floor(roundedEok / 10_000);
    const restEok = roundedEok - jo * 10_000;
    const joText = `${sign}${jo.toLocaleString("ko-KR")}조`;
    if (restEok === 0) return `${joText} 메소`;
    return `${joText} ${restEok.toLocaleString("ko-KR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })}억 메소`;
  }
  if (absolute >= MESO) return `${sign}${(absolute / MESO).toFixed(digits)}억 메소`;
  if (absolute >= MAN) return `${sign}${Math.round(absolute / MAN).toLocaleString("ko-KR")}만 메소`;
  return `${sign}${Math.round(absolute).toLocaleString("ko-KR")} 메소`;
}

/** 1억 미만의 작은 비용은 만 단위 소수도 보존한다. */
export function formatMesoPreciseMan(value, digits = 2) {
  if (!Number.isFinite(value)) return "계산 불가";
  const absolute = Math.abs(value);
  if (absolute < MAN || absolute >= MESO) return formatMeso(value, digits);
  const sign = value < 0 ? "-" : "";
  return `${sign}${(absolute / MAN).toLocaleString("ko-KR", {
    maximumFractionDigits: digits,
  })}만 메소`;
}

export function formatAttempts(value) {
  if (!Number.isFinite(value)) return "도달 불가";
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}회`;
}

export function formatProbability(value, maximumFractionDigits = 4) {
  if (!Number.isFinite(value)) return "-";
  return `${(value * 100).toLocaleString("ko-KR", { maximumFractionDigits })}%`;
}
import { searchableSelect } from "./searchable-select.js";
