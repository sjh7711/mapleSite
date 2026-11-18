import { formatMeso, formatNumber } from "../calc.js";
import { varianceCostPosition, varianceQuantile } from "./starforce-variance.js";
import { bindVariancePointer } from "./starforce-variance-pointer.js";

const svgNode = (tag, attributes, text) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
};
export function costRangeValues(result) {
  return Object.fromEntries([1, 10, 50, 90, 99].map((p) => [p, varianceQuantile(result.sorted, p / 100)]));
}

// Retain one monetary scale across policy changes so a narrower range stays
// visibly narrower. Both tails are trimmed to show the central 98% of costs.
export function createCostRange({ action } = {}) {
  const figure = document.createElement("figure"); figure.className = "variance-cost-range";
  figure.setAttribute("aria-label", "현재 전략 비용 범위");
  const legend = document.createElement("p"); legend.className = "variance-cost-range__legend";
  legend.textContent = "가는 선 1~99% · 굵은 선 10~90% · ● 중앙값 · ◆ 평균";
  const header = document.createElement("div"); header.className = "variance-cost-range__header";
  header.append(legend);
  if (action) header.append(action);
  const plot = document.createElement("div"); plot.className = "variance-cost-range__plot";
  const tooltip = document.createElement("div"); tooltip.className = "variance-cost-range__tooltip";
  tooltip.id = `variance-range-${crypto.randomUUID()}`;
  tooltip.setAttribute("role", "tooltip"); tooltip.hidden = true;
  figure.append(header, plot);
  let result = null, maximum = 0, context = null, markers = [], active = 0, frame = null, cursor = null, dot = null;
  const hide = () => {
    tooltip.hidden = true;
    cursor?.setAttribute("visibility", "hidden"); dot?.setAttribute("visibility", "hidden");
  };
  const show = (clientX = null, clientY = null, markerIndex = null) => {
    if (!markers.length || !frame) return;
    // Resolve to the final positions before inspecting a moving range.
    plot.querySelectorAll("animate").forEach((animation) => animation.remove());
    const rect = plot.getBoundingClientRect();
    let point = markers[markerIndex ?? active];
    if (clientX !== null) {
      const position = (clientX - rect.left) * frame.width / rect.width;
      active = markerIndex ?? markers.reduce((nearest, marker, index) => Math.abs(marker.x - position) < Math.abs(markers[nearest].x - position) ? index : nearest, 0);
      if (markerIndex === null) {
        if (position <= markers[0].x) point = markers[0];
        else if (position >= markers.at(-1).x) point = markers.at(-1);
        else {
          const value = (position - frame.left) / (frame.right - frame.left) * frame.end;
          point = { value, rank: varianceCostPosition(result.sorted, value), x: position };
        }
      }
    }
    const percent = document.createElement("dt"), cost = document.createElement("dd"), row = document.createElement("div"), values = document.createElement("dl");
    percent.textContent = `상위 ${formatNumber(point.rank * 100, 2)}%`; cost.textContent = formatMeso(point.value);
    row.append(percent, cost); values.append(row); tooltip.replaceChildren(values);
    tooltip.dataset.cost = String(point.value); tooltip.dataset.percentile = String(point.rank);
    cursor.setAttribute("x1", point.x); cursor.setAttribute("x2", point.x); cursor.removeAttribute("visibility");
    dot.setAttribute("cx", point.x); dot.removeAttribute("visibility");
    tooltip.hidden = false;
    const x = clientX === null ? point.x / frame.width * rect.width : clientX - rect.left;
    const y = clientY === null ? 0 : clientY - rect.top;
    tooltip.style.left = `${Math.max(6, Math.min(rect.width - tooltip.offsetWidth - 6, x + 10))}px`;
    tooltip.style.top = `${Math.max(0, y - tooltip.offsetHeight - 10)}px`;
  };
  const pointer = (event) => {
    const markerIndex = event.target.closest?.("[data-marker-index]")?.dataset.markerIndex;
    show(event.clientX, event.clientY, markerIndex === undefined ? null : Number(markerIndex));
  };
  const pointerCleanup = bindVariancePointer(plot, pointer, hide);
  plot.addEventListener("focusin", () => show());
  plot.addEventListener("focusout", hide);
  plot.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { hide(); return; }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    active = event.key === "Home" ? 0 : event.key === "End" ? markers.length - 1
      : Math.max(0, Math.min(markers.length - 1, active + (event.key === "ArrowLeft" ? -1 : 1)));
    show();
  });
  const draw = (animate = false) => {
    if (!result || !figure.isConnected) return;
    hide();
    const previous = plot.querySelector("svg");
    const q = costRangeValues(result), width = Math.max(180, plot.clientWidth);
    const left = 16, right = width - 16;
    const unit = 10 ** Math.floor(Math.log10(Math.max(1, maximum)));
    const end = Math.max(1, Math.ceil(maximum / unit) * unit);
    const x = (cost) => left + cost / end * (right - left);
    markers = [
      { label: "1%", value: q[1], rank: 0.01 }, { label: "10%", value: q[10], rank: 0.1 },
      { label: "50%", value: q[50], rank: 0.5 }, { label: "평균", value: result.mean, rank: varianceCostPosition(result.sorted, result.mean) },
      { label: "90%", value: q[90], rank: 0.9 }, { label: "99%", value: q[99], rank: 0.99 },
    ].map((marker, index) => ({ ...marker, x: x(marker.value), side: index % 2 === 0 ? "above" : "below" }));
    const measure = document.createElement("canvas").getContext("2d");
    measure.font = `12px ${getComputedStyle(figure).fontFamily}`;
    for (const side of ["above", "below"]) {
      const labels = markers.filter((marker) => marker.side === side).sort((a, b) => a.x - b.x);
      let edge = 2;
      for (const marker of labels) {
        marker.halfWidth = measure.measureText(marker.label).width / 2;
        marker.labelX = Math.max(edge + marker.halfWidth, Math.min(width - marker.halfWidth - 2, marker.x));
        edge = marker.labelX + marker.halfWidth + 10;
      }
      // Move labels, never their cost positions. A backward pass leaves room
      // near the right edge while keeping one row on each side of the range.
      edge = width - 2;
      for (const marker of [...labels].reverse()) {
        marker.labelX = Math.min(marker.labelX, edge - marker.halfWidth);
        marker.guideX = Math.max(marker.labelX - marker.halfWidth, Math.min(marker.labelX + marker.halfWidth, marker.x));
        edge = marker.labelX - marker.halfWidth - 10;
      }
    }
    const y = 35;
    frame = { width, left, right, end };
    const tickY = y + 49, height = tickY + 28;
    for (const marker of markers) marker.labelY = marker.side === "above" ? 14 : y + 23;
    const svg = svgNode("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", tabindex: 0,
      "aria-label": `현재 전략 비용 범위. ${markers.map((marker) => `${marker.label} ${formatMeso(marker.value)}`).join(", ")}. 양 끝 1%씩을 제외한 1~99% 범위입니다. 마우스 또는 터치, 좌우 방향키로 금액을 확인할 수 있습니다.`,
      "aria-describedby": tooltip.id, "data-axis-maximum": end, "data-sample-count": result.sampleCount,
      "data-mean": result.mean });
    for (const [p, value] of Object.entries(q)) svg.dataset[`p${p}`] = String(value);
    const axisUnit = end >= 1e12 ? 1e12 : end >= 1e8 ? 1e8 : end >= 1e4 ? 1e4 : 1;
    const suffix = axisUnit === 1e12 ? "조 메소" : axisUnit === 1e8 ? "억 메소" : axisUnit === 1e4 ? "만 메소" : "메소";
    for (let i = 0; i <= 4; i++) {
      const value = end * i / 4, position = x(value);
      const label = value === 0 ? "0" : formatNumber(value / axisUnit, 4);
      svg.append(svgNode("line", { x1: position, x2: position, y1: y - 10, y2: y + 10, class: "variance-cost-range__grid" }));
      svg.append(svgNode("text", { x: position, y: tickY, "text-anchor": i === 0 ? "start" : i === 4 ? "end" : "middle", class: "variance-cost-range__tick" }, label));
    }
    svg.append(svgNode("line", { x1: x(q[1]), x2: x(q[99]), y1: y, y2: y, class: "variance-cost-range__outer" }));
    for (const p of [1, 99]) svg.append(svgNode("line", { x1: x(q[p]), x2: x(q[p]), y1: y - 5, y2: y + 5, class: "variance-cost-range__outer" }));
    svg.append(svgNode("rect", { x: x(q[10]), y: y - 7, width: Math.max(1, x(q[90]) - x(q[10])), height: 14, class: "variance-cost-range__inner" }));
    for (const [index, marker] of markers.entries()) {
      svg.append(svgNode("line", { x1: marker.guideX, x2: marker.x, y1: marker.side === "above" ? marker.labelY + 4 : marker.labelY - 12, y2: marker.side === "above" ? y - 8 : y + 8, class: "variance-cost-range__guide", "data-marker-index": index }));
      svg.append(svgNode("text", { x: marker.labelX, y: marker.labelY, "text-anchor": "middle", class: "variance-cost-range__marker-label", "data-side": marker.side, "data-marker-index": index }, marker.label));
    }
    svg.append(svgNode("circle", { cx: x(q[50]), cy: y, r: 4.5, class: "variance-cost-range__median", "data-marker-index": 2 }));
    const meanX = x(result.mean);
    svg.append(svgNode("path", { d: `M${meanX} ${y - 5}l5 5-5 5-5-5Z`, class: "variance-cost-range__mean", "data-marker-index": 3 }));
    cursor = svgNode("line", { y1: y - 12, y2: y + 12, visibility: "hidden", class: "variance-cost-range__cursor" });
    dot = svgNode("circle", { cy: y, r: 3, visibility: "hidden", class: "variance-cost-range__cursor" });
    svg.append(cursor, dot);
    svg.append(svgNode("text", { x: right, y: tickY + 22, "text-anchor": "end" }, `완료 비용 (${suffix})`));
    if (animate && previous?.viewBox.baseVal.width === width
      && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const selector = ".variance-cost-range__outer, .variance-cost-range__inner, .variance-cost-range__guide, .variance-cost-range__marker-label, .variance-cost-range__median, .variance-cost-range__mean";
      const before = previous.querySelectorAll(selector);
      svg.querySelectorAll(selector).forEach((element, index) => {
        const old = before[index];
        if (!old || old.tagName !== element.tagName) return;
        for (const attribute of ["x", "x1", "x2", "cx", "width", "d"]) {
          const to = element.getAttribute(attribute);
          const from = old[attribute]?.animVal?.value ?? old.getAttribute(attribute);
          if (to === null || from === null || String(from) === to) continue;
          element.append(svgNode("animate", { attributeName: attribute, from, to,
            dur: "280ms", calcMode: "spline", keyTimes: "0;1", keySplines: "0.2 0 0.2 1" }));
        }
      });
    }
    tooltip.replaceChildren(); plot.replaceChildren(svg, tooltip);
  };
  const resize = new ResizeObserver(() => draw()); resize.observe(plot);
  return {
    element: figure,
    update(next, key) {
      if (context !== key) { maximum = 0; context = key; }
      const changed = result !== null && result !== next;
      result = next; maximum = Math.max(maximum, costRangeValues(next)[99], next.mean); active = 0; draw(changed);
    },
    destroy() { resize.disconnect(); pointerCleanup(); },
  };
}
