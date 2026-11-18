import { formatMeso } from "../calc.js";
import { requestRiskReduction, requestVarianceSimulation } from "./starforce-variance-client.js";
import { createCostRange } from "./starforce-cost-range.js";
import "./starforce-variance.css";

function node(tag, className, text) {
  const element = document.createElement(tag); element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
const percentText = (before, after) => {
  const value = before > 0 ? (after / before - 1) * 100 : after === 0 ? 0 : null;
  return value === null ? "—" : `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(2)}%`;
};
const policyKey = (plans) => JSON.stringify(plans.map((p) => (p.strategyStages ?? p.stages)
  .map((s) => [s.star, s.safeguarded, s.policy])));
const contextKey = (plans) => JSON.stringify(plans.map((p) => [p.sourceIndex, p.itemLevel, p.startStar,
  p.targetStar, p.replacementPrice, p.event, p.mvp, p.pc, p.quantity, p.singleSpare]));

export function createRiskRecommendation({ plans, applyStrategy, showGraph, dismiss }) {
  let controller = null, disposed = false, latest = plans;
  const panel = node("section", "variance-reduction variance-reduction--inline");
  panel.setAttribute("aria-label", "강화 전략의 편차");
  const close = node("button", "variance-reduction__close"); close.type = "button";
  close.setAttribute("aria-label", "편차 닫기");
  const closeIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", width: 18, height: 18, "aria-hidden": "true", focusable: "false" })) closeIcon.setAttribute(key, value);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  for (const [key, value] of Object.entries({ d: "M5 5 19 19M19 5 5 19", fill: "none", stroke: "currentColor", "stroke-width": 1.8, "stroke-linecap": "round" })) path.setAttribute(key, value);
  closeIcon.append(path); close.append(closeIcon); close.addEventListener("click", dismiss);
  const graph = node("button", "variance-reduction__graph", "그래프 확인"); graph.type = "button";
  graph.setAttribute("aria-haspopup", "dialog"); graph.addEventListener("click", () => showGraph(graph));
  const range = createCostRange({ action: graph });
  const actions = node("div", "variance-reduction__actions");
  const content = node("div", "variance-reduction__content");
  const status = node("p", "variance-reduction__note"); status.setAttribute("role", "status");
  panel.append(close, content, range.element, status);
  const run = async (next) => {
    latest = next; controller?.abort(); const pending = new AbortController(); controller = pending;
    const alive = () => !disposed && controller === pending && !pending.signal.aborted;
    panel.setAttribute("aria-busy", "true"); status.textContent = "편차를 계산하고 있습니다.";
    panel.querySelectorAll(".variance-reduction__apply").forEach((button) => { button.disabled = true; });
    try {
      const [reduction, simulated] = await Promise.all([
        requestRiskReduction(next, { signal: pending.signal }),
        requestVarianceSimulation(next, 30000, { signal: pending.signal }),
      ]);
      if (!alive()) return;
      content.replaceChildren();
      actions.replaceChildren();
      const applied = policyKey(next) === policyKey(reduction.plans);
      const hasRecommendation = reduction.improves;
      const metrics = node("table", "variance-reduction__comparison");
      metrics.setAttribute("aria-label", "강화 최적화와 현재 전략의 기댓값 및 표준편차");
      const headings = node("thead", ""), headingRow = node("tr", "");
      headingRow.append(node("td", ""));
      for (const title of ["강화 최적화", "현재"]) {
        const heading = node("th", "variance-reduction__metric-label", title);
        heading.scope = "col"; headingRow.append(heading);
      }
      headings.append(headingRow);
      const rows = node("tbody", "");
      metrics.append(headings, rows);
      for (const [label, key] of [["기댓값", "mean"], ["표준편차", "standardDeviation"]]) {
        const row = node("tr", ""), rowHeading = node("th", "", label);
        rowHeading.scope = "row"; row.append(rowHeading);
        const entries = [
          [reduction.minimum[key], null],
          [reduction.current[key], reduction.minimum[key]],
        ];
        for (const [value, before] of entries) {
          const cell = node("td", "");
          const metric = node("span", "variance-reduction__metric");
          metric.append(node("span", "variance-reduction__metric-value", formatMeso(value)));
          if (before !== null) {
            const change = node("span", "variance-reduction__metric-change", `(${percentText(before, value)})`);
            change.title = "강화 최적화 대비 변화";
            metric.append(change);
          }
          cell.append(metric); row.append(cell);
        }
        rows.append(row);
      }
      content.append(metrics, actions);
      if (hasRecommendation) {
        const apply = node("button", "variance-reduction__apply", "편차 감소 추천"); apply.type = "button"; apply.disabled = applied;
        apply.setAttribute("aria-label", applied ? "편차 감소 추천 적용됨" : "편차 감소 추천");
        apply.addEventListener("click", () => {
          try { applyStrategy(reduction.plans); }
          catch (error) { status.textContent = error.message; }
        });
        actions.prepend(apply);
      } else {
        const apply = node("button", "variance-reduction__apply", "편차 감소 추천"); apply.type = "button"; apply.disabled = true;
        const hint = node("span", "variance-reduction__apply-hint"); hint.tabIndex = 0;
        const tooltip = node("span", "variance-reduction__apply-tooltip", "편차 감소 추천값이 없습니다.");
        tooltip.id = `variance-no-recommendation-${crypto.randomUUID()}`; tooltip.setAttribute("role", "tooltip");
        hint.setAttribute("aria-describedby", tooltip.id);
        hint.append(apply, tooltip); actions.append(hint);
        content.append(node("p", "variance-reduction__note", "강화 최적화 대비 기댓값 차이 0.5% 이내에서 표준편차가 작은 추천 전략이 없습니다."));
      }
      panel.dataset.mean = String(reduction.current.mean);
      panel.dataset.standardDeviation = String(reduction.current.standardDeviation);
      panel.dataset.minimumMean = String(reduction.minimum.mean);
      panel.dataset.minimumStandardDeviation = String(reduction.minimum.standardDeviation);
      panel.dataset.recommendedMean = String(reduction.recommended.mean);
      range.update(simulated, contextKey(next));
      status.textContent = "";
    } catch (error) {
      if (!alive()) return;
      status.replaceChildren(document.createTextNode("편차를 계산하지 못했습니다. "));
      const retry = node("button", "variance-reduction__graph", "다시 계산"); retry.type = "button";
      retry.addEventListener("click", () => run(latest)); status.append(retry);
    } finally { if (alive()) panel.removeAttribute("aria-busy"); }
  };
  run(plans);
  return { panel, update: run, cancel() { disposed = true; controller?.abort(); range.destroy(); } };
}
