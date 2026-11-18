import { formatMeso, formatNumber } from "../calc.js";
import { varianceBudgetPosition, variancePoint, varianceQuantile } from "./starforce-variance.js";
import { histogramChart } from "./starforce-variance-histogram-ui.js";
import { nearbyVarianceMarker, varianceChartFrame } from "./starforce-variance-chart-layout.js";
import { varianceCostAxis } from "./starforce-variance-axis.js";
import { requestVarianceSimulation } from "./starforce-variance-client.js";
import { varianceMeanMarkers } from "./starforce-variance-comparison.js";
import { createVarianceEquipmentSelector } from "./starforce-variance-equipment.js";
import { appendVarianceLegend } from "./starforce-variance-legend.js";
import { positionVarianceTooltip } from "./starforce-variance-tooltip.js";
import { bindVariancePointer } from "./starforce-variance-pointer.js";
import "./starforce-variance.css";

const number = new Intl.NumberFormat("ko-KR");
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function svgElement(tag, attributes) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

// Monotone cubic interpolation keeps a smooth cost curve inside the sampled
// quantiles, including flat stretches and the full expensive tail.
function smoothCostPath(points) {
  const slopes = points.slice(1).map((point, i) => (point.y - points[i].y) / (point.x - points[i].x));
  const tangents = points.map((_, i) => i === 0 ? slopes[0] : i === points.length - 1 ? slopes.at(-1)
    : slopes[i - 1] * slopes[i] <= 0 ? 0 : 2 / (1 / slopes[i - 1] + 1 / slopes[i]));
  const coordinate = (n) => n.toFixed(3);
  let path = `M${coordinate(points[0].x)},${coordinate(points[0].y)}`;
  for (let i = 1; i < points.length; i++) {
    const before = points[i - 1], point = points[i], dx = (point.x - before.x) / 3;
    path += ` C${coordinate(before.x + dx)},${coordinate(before.y + tangents[i - 1] * dx)} ${coordinate(point.x - dx)},${coordinate(point.y - tangents[i] * dx)} ${coordinate(point.x)},${coordinate(point.y)}`;
  }
  return path;
}

function chart(result, amount, width, { blacksmith = null, comparison = null } = {}) {
  const plot = element("div", "variance-chart__plot variance-chart__plot--overlay");
  const { width: viewWidth, top, bottom, height: viewHeight } = varianceChartFrame(width, { externalControls: true });
  const measure = document.createElement("canvas").getContext("2d");
  const fontFamily = getComputedStyle(document.body).fontFamily;
  const textWidth = (text, size = 13, weight = 400) => {
    measure.font = `${weight} ${size}px ${fontFamily}`;
    return measure.measureText(text).width;
  };
  const axisSorted = comparison?.sorted ?? result.sorted;
  const axis = varianceCostAxis(axisSorted);
  const { minimum, maximum: largest, focusMinimum, focusMaximum } = axis;
  const focused = focusMaximum > focusMinimum;
  const y = (cost) => bottom - axis.position(cost) * (bottom - top - 12);
  const moneyTick = (value) => value >= 1e12 ? `${formatNumber(value / 1e12, 1)}조`
    : value >= 1e8 ? `${formatNumber(value / 1e8, 1)}억` : `${formatNumber(value / 1e4, 1)}만`;
  const ticks = [];
  for (let exponent = Math.floor(Math.log10(Math.max(1, minimum))); exponent <= Math.ceil(Math.log10(Math.max(1, largest))); exponent++) {
    for (const factor of [1, 2, 5]) {
      const value = factor * 10 ** exponent;
      if (value >= minimum && value <= largest) ticks.push(value);
    }
  }
  // Reserve only the space used by axis text. Endpoint labels straddle the
  // ends of the curve, while remaining fully inside the responsive SVG.
  const visibleTicks = [];
  const inView = ticks.filter((value) => value >= minimum && value <= largest
    && y(value) >= top + 6 && y(value) <= bottom - 6);
  // Add one readable monetary tick in the expanded middle range, choosing the
  // largest remaining visual gap instead of adding a fixed percentile band.
  let extraTick = null;
  if (focused) {
    const step = 10 ** Math.floor(Math.log10((focusMaximum - focusMinimum) / 4));
    const middleCandidates = [];
    const first = Math.ceil(focusMinimum / step) * step;
    for (let offset = 0; offset <= 40; offset++) {
      const value = first + offset * step;
      if (value >= focusMaximum) break;
      if (value > focusMinimum) middleCandidates.push(value);
    }
    const closest = (candidates, position) => candidates.reduce((best, value) => best === null
      || Math.abs(y(value) - position) < Math.abs(y(best) - position) ? value : best, null);
    const middleTicks = inView.filter((value) => value >= focusMinimum && value <= focusMaximum);
    const selected = [
      closest(inView.filter((value) => value < focusMinimum), (bottom - 12 + y(focusMinimum)) / 2),
      closest(middleTicks.length ? middleTicks : middleCandidates, (y(focusMinimum) + y(focusMaximum)) / 2),
      closest(inView.filter((value) => value > focusMaximum), (top + 12 + y(focusMaximum)) / 2),
    ];
    visibleTicks.push(...selected.filter((value) => value !== null));
    let bestGap = 18;
    for (const value of middleCandidates) {
      const position = y(value);
      const gap = Math.min(y(focusMinimum) - position, position - y(focusMaximum),
        ...visibleTicks.map((tick) => Math.abs(y(tick) - position)));
      if (gap > bestGap) { extraTick = value; bestGap = gap; }
    }
    if (extraTick !== null) visibleTicks.push(extraTick);
  } else {
    let previousTickY = Infinity;
    visibleTicks.push(...inView.filter((value) => {
      if (previousTickY - y(value) < 22) return false;
      previousTickY = y(value);
      return true;
    }));
  }
  // Start at the cheapest completion, without an artificial gap below it.
  const startingCost = minimum;
  for (let i = visibleTicks.length - 1; i >= 0; i--) {
    if (Math.abs(y(visibleTicks[i]) - y(startingCost)) < 28) visibleTicks.splice(i, 1);
  }
  visibleTicks.push(startingCost);
  // Keep the exact 99th-percentile cost visible on the compressed money axis,
  // replacing nearby rounded ticks so their labels do not overlap.
  const percentile99Cost = varianceQuantile(axisSorted, 0.99);
  if (Math.abs(y(percentile99Cost) - y(startingCost)) >= 28) {
    for (let i = visibleTicks.length - 1; i >= 0; i--) {
      if (visibleTicks[i] !== startingCost && Math.abs(y(visibleTicks[i]) - y(percentile99Cost)) < 28) visibleTicks.splice(i, 1);
    }
    if (!visibleTicks.includes(percentile99Cost)) visibleTicks.push(percentile99Cost);
  }
  // Fixed tick counts leave large holes on a nonlinear axis. Fill the largest
  // screen-space gaps with rounded amounts, keeping enough room for each label.
  const costAtY = (position) => {
    return axis.costAt((bottom - position) / (bottom - top - 12));
  };
  const automaticTicks = new Set();
  while (true) {
    const positions = [top + 6, ...visibleTicks.map(y), bottom - 6].sort((a, b) => a - b);
    // Two 28px label clearances leave room for an intermediate money tick.
    // Include the starting-cost tick so the first interval is filled as well.
    let widest = 56, addition = null;
    for (let i = 1; i < positions.length; i++) {
      const gap = positions[i] - positions[i - 1];
      if (gap <= widest) continue;
      const midpoint = (positions[i] + positions[i - 1]) / 2;
      const from = costAtY(positions[i] - 28), to = costAtY(positions[i - 1] + 28);
      const step = 10 ** Math.floor(Math.log10(to - from));
      if (!Number.isFinite(step) || step <= 0) continue;
      const first = Math.ceil(from / step) * step;
      let closest = null;
      for (let offset = 0; offset <= 40; offset++) {
        const value = first + offset * step, position = y(value);
        if (value > to) break;
        if (position < positions[i - 1] + 28 || position > positions[i] - 28) continue;
        if (closest === null || Math.abs(position - midpoint) < Math.abs(y(closest) - midpoint)) closest = value;
      }
      if (closest !== null) { widest = gap; addition = closest; }
    }
    if (addition === null) break;
    visibleTicks.push(addition); automaticTicks.add(addition);
  }
  const tickLabel = (value) => value === 0 ? "0억" : value === startingCost || value === percentile99Cost ? formatMeso(value)
    : moneyTick(value);
  const endpointSpace = (fraction) => Math.max(textWidth(`상위 ${fraction * 100}%`) / 2,
    ...(comparison?.results ?? [result]).map((entry) => textWidth(formatMeso(varianceQuantile(entry.sorted, fraction)), 12) / 2)) + 4;
  const axisTitleText = "사용 메소";
  // Mirror the same monetary axis on both sides. Reserve the full text width
  // on each side so long prices and endpoint rank labels stay inside the SVG.
  const axisSpace = Math.max(textWidth(axisTitleText, 13, 600) + 20,
    ...visibleTicks.map((value) => textWidth(tickLabel(value), 12) + 12));
  const left = Math.ceil(Math.max(endpointSpace(0), axisSpace));
  const right = viewWidth - Math.ceil(Math.max(endpointSpace(1), axisSpace));
  const x = (fraction) => left + Math.max(0, Math.min(1, fraction)) * (right - left);
  const means = varianceMeanMarkers(result, comparison);
  const annotations = [...means, ...[[result.median, "median", "상위 50%"],
    ...(blacksmith && blacksmith.multiplier !== 1 ? [[blacksmith.cost, "blacksmith", `대장장이 ×${blacksmith.multiplier.toFixed(2)}`]] : []),
    ...(amount === null ? [] : [[amount, "budget", "예산"]])].map(([value, kind, text]) => ({
      value, kind, text, rank: kind === "median" ? 0.5 : varianceBudgetPosition(result.sorted, value),
    }))]
    // Median rank is fixed; each mean inverts its own plotted cost curve.
    // Budget and blacksmith amounts keep their empirical completion ranks.
    .map((marker) => ({ ...marker, labelWidth: textWidth(marker.text, 13, 600) + 12, x: x(marker.rank) }))
    .sort((a, b) => a.x - b.x);
  const rows = [];
  for (const annotation of annotations) {
    annotation.center = Math.max(left + annotation.labelWidth / 2, Math.min(right - annotation.labelWidth / 2, annotation.x));
    annotation.start = annotation.center - annotation.labelWidth / 2;
    annotation.row = rows.findIndex((end) => end + 10 <= annotation.start);
    if (annotation.row < 0) annotation.row = rows.length;
    rows[annotation.row] = annotation.start + annotation.labelWidth;
  }
  const labelRowHeight = 26;
  const axisDescription = "세로축은 완료 비용입니다. 양 끝 구간의 금액 간격은 가운데 구간과 다르게 표시합니다.";
  const svg = svgElement("svg", { viewBox: `0 0 ${viewWidth} ${viewHeight}`, role: "img", tabindex: 0, "data-scale": "hybrid",
    "data-focus-minimum": focusMinimum, "data-focus-maximum": focusMaximum,
    "aria-label": `스타포스 비용 곡선. ${comparison ? "기본과 편차 감소를 같은 축에 겹쳐 표시합니다. 평균선은 각 전략의 평균 위치입니다. 하단 비용과 나머지 기준선은 기본 전략 기준입니다. " : ""}${axisDescription} 가로축은 비용이 적게 든 순위입니다. 가로축 눈금 윗줄은 상위 비율, 아랫줄은 해당 비용입니다. 좌우 방향키로 위치를 이동하면 해당 순위의 완료 비용과 주변 결과의 평균 파괴·평균 스페어를 확인할 수 있습니다.` });
  const axisTitle = svgElement("text", { x: left - 12, y: Math.min(...visibleTicks.map(y)) - 18,
    "text-anchor": "end", class: "variance-chart__axis-title", "data-axis-side": "left" });
  axisTitle.textContent = axisTitleText; svg.append(axisTitle);
  for (const value of visibleTicks.sort((a, b) => a - b)) {
    svg.append(svgElement("line", { x1: left, x2: right, y1: y(value), y2: y(value), class: "variance-chart__grid" }));
    for (const [side, position, anchor] of [["left", left - 12, "end"], ["right", right + 12, "start"]]) {
      const tick = svgElement("text", { x: position, y: y(value) + 5, "text-anchor": anchor, class: "variance-chart__money-tick", "data-axis-side": side, "data-cost": value, "data-start": value === startingCost, "data-extra": value === extraTick, "data-auto": automaticTicks.has(value), "data-percentile": value === percentile99Cost ? 0.99 : "" });
      if (side === "right") tick.setAttribute("aria-hidden", "true");
      else if (value === percentile99Cost) tick.setAttribute("aria-label", `상위 99% 완료 비용 ${formatMeso(value)}`);
      tick.textContent = tickLabel(value); svg.append(tick);
    }
  }
  for (const [index, series] of (comparison?.results ?? [result]).entries()) {
    const kind = index === 0 ? "basic" : "reduced";
    const samples = new Map(Array.from({ length: 321 }, (_, i) => [i / 320, varianceQuantile(series.sorted, i / 320)]));
    // Keep the drawn curve passing through its exact mean even near a sharp
    // jump, instead of smoothing across the marker with coarse rank samples.
    for (const mean of means.filter((marker) => marker.series === kind)) samples.set(mean.rank, varianceQuantile(series.sorted, mean.rank));
    const points = [...samples].sort((a, b) => a[0] - b[0]).map(([rank, cost]) => ({ x: x(rank), y: y(cost) }));
    const path = smoothCostPath(points);
    if (index === 0) svg.append(svgElement("path", { d: `${path} L${right},${bottom} L${left},${bottom} Z`, class: "variance-chart__area" }));
    svg.append(svgElement("path", { d: path, class: `variance-chart__cost-line variance-chart__cost-line--${kind}`,
      "data-series": kind, "data-maximum": series.sorted.at(-1) }));
  }
  for (const annotation of annotations) {
    svg.append(svgElement("line", { x1: annotation.x, x2: annotation.x, y1: top, y2: bottom + 3,
      class: `variance-chart__${annotation.kind}`, "data-cost": annotation.value,
      "data-series": annotation.series ?? "", "data-percentile": annotation.rank, "data-comparison": Boolean(comparison),
      "aria-label": `${annotation.text} ${formatMeso(annotation.value)}` }));
  }
  let previousCostLabelRight = -Infinity;
  const finalCostLabelLeft = x(1) - textWidth(formatMeso(varianceQuantile(result.sorted, 1)), 12) / 2;
  for (const percent of [0, 25, 50, 75, 100]) {
    const fraction = percent / 100, anchor = "middle";
    const group = svgElement("g", { class: `variance-chart__rank-tick${percent === 25 || percent === 75 ? " variance-chart__rank-tick--minor" : ""}`, "data-percentile": fraction });
    group.append(svgElement("line", { x1: x(fraction), x2: x(fraction), y1: bottom, y2: bottom + 6, class: "variance-chart__grid" }));
    const rank = svgElement("text", { x: x(fraction), y: bottom + 19, "text-anchor": anchor });
    rank.textContent = `상위 ${percent}%`;
    const cost = svgElement("text", { x: x(fraction), y: bottom + 39, "text-anchor": anchor, class: "variance-chart__rank-cost", "data-cost": varianceQuantile(result.sorted, fraction) });
    cost.textContent = formatMeso(varianceQuantile(result.sorted, fraction));
    const costWidth = textWidth(cost.textContent, 12);
    if (viewWidth < 560 && percent !== 0 && percent !== 100
      && (percent !== 50 || x(fraction) - costWidth / 2 < previousCostLabelRight + 8
        || x(fraction) + costWidth / 2 + 8 > finalCostLabelLeft)) cost.setAttribute("hidden", "");
    else previousCostLabelRight = x(fraction) + costWidth / 2;
    group.append(rank, cost); svg.append(group);
  }
  const cursor = svgElement("line", { y1: top, y2: bottom + 3, class: "variance-chart__cursor" });
  const dot = svgElement("circle", { r: 5, class: "variance-chart__selected" });
  svg.append(cursor, dot);
  const reducedDot = comparison ? svgElement("circle", { r: 5, class: "variance-chart__selected variance-chart__selected--reduced" }) : null;
  if (reducedDot) svg.append(reducedDot);
  const tooltip = element("div", "variance-chart__tooltip");
  tooltip.id = "variance-chart-tooltip";
  tooltip.setAttribute("role", "tooltip"); tooltip.hidden = true;
  svg.setAttribute("aria-describedby", tooltip.id);
  const heading = element("strong"), completionCost = element("span"), counts = element("span");
  tooltip.append(heading, completionCost, counts);
  const reducedCost = element("span"), reducedCounts = element("span");
  if (comparison) tooltip.append(reducedCost, reducedCounts);
  plot.append(svg, tooltip); appendVarianceLegend(plot, comparison);
  const placedLabels = [];
  for (const annotation of annotations) {
    const height = labelRowHeight - 1;
    const curveTop = Math.min(...(comparison?.results ?? [result]).map((entry) => y(varianceQuantile(entry.sorted, Math.min(1, (annotation.start + annotation.labelWidth - left) / (right - left))))));
    const curveBottom = Math.max(...(comparison?.results ?? [result]).map((entry) => y(varianceQuantile(entry.sorted, Math.max(0, (annotation.start - left) / (right - left))))));
    let labelTop = top + 4 + annotation.row * labelRowHeight;
    // Labels live inside the plot, but must leave the cost curve visible even
    // when a budget marker sits on the expensive tail or joins another marker.
    for (let attempts = 0; attempts <= annotations.length; attempts++) {
      if (labelTop < curveBottom + 6 && labelTop + height > curveTop - 6) labelTop = curveBottom + 6;
      const collision = placedLabels.find((label) => annotation.start < label.start + label.labelWidth + 4
        && annotation.start + annotation.labelWidth + 4 > label.start && labelTop < label.top + height + 2 && labelTop + height + 2 > label.top);
      if (!collision) break;
      labelTop = collision.top + height + 2;
    }
    placedLabels.push({ ...annotation, top: labelTop });
    const group = svgElement("g", { class: `variance-chart__annotation variance-chart__annotation--${annotation.kind}`, "data-series": annotation.series ?? "", "data-comparison": Boolean(comparison) });
    group.append(svgElement("rect", { x: annotation.start, y: labelTop, width: annotation.labelWidth, height, rx: 4 }));
    const text = svgElement("text", { x: annotation.center, y: labelTop + 18, "text-anchor": "middle" });
    text.textContent = annotation.text; group.append(text); svg.append(group);
  }
  let active = null;
  const hide = () => { active = null; tooltip.hidden = true; cursor.dataset.active = "false"; dot.dataset.active = "false"; if (reducedDot) reducedDot.dataset.active = "false"; };
  const show = (fraction, marker = null, pointer = null) => {
    active = Math.max(0, Math.min(1, fraction));
    const point = variancePoint(result, active);
    heading.textContent = `${marker ? `${marker.text} ${formatMeso(marker.value)}${marker.kind === "budget" || marker.kind === "blacksmith" ? " 기준" : ""} · ` : ""}상위 ${formatNumber(active * 100, 1)}%`;
    tooltip.dataset.meanSeries = marker?.kind.startsWith("mean") ? marker.series : "";
    Object.assign(tooltip.dataset, { markerKind: marker?.kind ?? "", markerCost: marker?.value ?? "", markerSeries: marker?.series ?? "" });
    completionCost.textContent = `${comparison ? "기본 · " : ""}완료 비용 ${formatMeso(point.cost)}`;
    counts.textContent = `평균 파괴 ${formatNumber(point.meanBooms)}회 · 평균 스페어 ${formatNumber(point.meanSpares)}개`;
    if (comparison) {
      const reduced = variancePoint(comparison.results[1], active);
      reducedCost.textContent = `편차 감소 · 완료 비용 ${formatMeso(reduced.cost)}`;
      reducedCounts.textContent = `평균 파괴 ${formatNumber(reduced.meanBooms)}회 · 평균 스페어 ${formatNumber(reduced.meanSpares)}개`;
      reducedDot.setAttribute("cx", x(active)); reducedDot.setAttribute("cy", y(reduced.cost)); reducedDot.dataset.active = "true";
      tooltip.dataset.reducedCost = String(reduced.cost);
    }
    Object.assign(tooltip.dataset, { percentile: active, cost: point.cost, booms: point.meanBooms, spares: point.meanSpares, probability: point.probability });
    cursor.setAttribute("x1", x(active)); cursor.setAttribute("x2", x(active)); cursor.dataset.active = "true";
    dot.setAttribute("cx", x(active)); dot.setAttribute("cy", y(point.cost)); dot.dataset.active = "true";
    tooltip.hidden = false;
    const anchors = [{ x: x(active), y: y(point.cost) }];
    if (comparison) anchors.push({ x: x(active), y: Number(reducedDot.getAttribute("cy")) });
    positionVarianceTooltip(plot, svg, tooltip, anchors, pointer);
  };
  const pointer = (event) => {
    const bounds = svg.getBoundingClientRect();
    const scale = bounds.width / viewWidth, inset = (bounds.height - viewHeight * scale) / 2;
    const logicalX = (event.clientX - bounds.left) / scale, logicalY = (event.clientY - bounds.top - inset) / scale;
    if (logicalX < left - 0.01 || logicalX > right + 0.01 || logicalY < top || logicalY > bottom + 3) { hide(); return; }
    const nearby = nearbyVarianceMarker(annotations, logicalX, scale);
    show(nearby?.rank ?? (logicalX - left) / (right - left), nearby, event);
  };
  bindVariancePointer(svg, pointer, hide);
  svg.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { if (active !== null) { event.preventDefault(); event.stopPropagation(); hide(); } return; }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.001 : 0.01;
    const fraction = event.key === "Home" ? 0 : event.key === "End" ? 1 : (active ?? 0.5) + (["ArrowRight", "ArrowUp"].includes(event.key) ? step : -step);
    show(fraction);
  });
  return plot;
}

export function createStarforceVarianceDialog() {
  let active = null;
  let activeCleanup = null;
  let chartMode = "curve";
  function close() { active?.close(); activeCleanup?.(); }
  window.addEventListener("pagehide", close);
  return {
    open(request, opener) {
      close();
      const dialog = element("dialog", "starforce-variance");
      dialog.setAttribute("aria-label", request.title);
      const closeButton = element("button", "variance-close");
      const closeIcon = svgElement("svg", { viewBox: "0 0 24 24", width: 20, height: 20, "aria-hidden": "true", focusable: "false" });
      closeIcon.append(svgElement("path", { d: "M5 5 19 19M19 5 5 19", fill: "none", stroke: "currentColor", "stroke-width": 1.8, "stroke-linecap": "round" }));
      closeButton.append(closeIcon);
      closeButton.type = "button"; closeButton.autofocus = true;
      closeButton.setAttribute("aria-label", "편차 닫기");
      closeButton.addEventListener("click", () => dialog.close());
      const body = element("div", "variance-body");
      const topbar = element("div", "variance-topbar");
      const context = element("p", "variance-context", request.context);
      context.append(element("span", "variance-context__note", "대장장이 배율은 편차 계산에 적용되지 않습니다"));
      topbar.append(context, closeButton);
      body.append(topbar);
      const equipmentSelect = createVarianceEquipmentSelector(request);
      topbar.append(equipmentSelect.element);
      const selectedRequest = () => ({ multiplier: 1, plans: equipmentSelect.value === "all"
        ? request.plans : [request.plans[Number(equipmentSelect.value)]] });

      const controls = element("div", "variance-controls");
      const precisionLabel = element("label", "", "계산 정밀도");
      const precision = element("select", "variance-precision");
      precision.setAttribute("aria-label", "편차 계산 정밀도");
      for (const [value, text] of [[30000, "기본 · 3만 회"], [100000, "정밀 · 10만 회"]]) {
        const option = element("option", "", text); option.value = value; precision.append(option);
      }
      precisionLabel.append(precision); controls.append(precisionLabel); topbar.append(controls);

      const budget = element("label", "variance-budget");
      const inputGroup = element("span", "variance-budget__input");
      const budgetInput = element("input");
      budgetInput.type = "number"; budgetInput.min = "0"; budgetInput.step = "any"; budgetInput.placeholder = "예산";
      budgetInput.setAttribute("aria-label", "예산 (억 메소)");
      inputGroup.append(budgetInput, element("span", "", "억 메소"));
      budget.append(inputGroup, element("span", "variance-budget__suffix", " 내 성공 확률"));

      const loading = element("div", "variance-loading");
      const status = element("p", "variance-status", "편차를 계산하고 있습니다.");
      status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
      const progress = element("progress"); progress.max = 30000; progress.value = 0;
      progress.setAttribute("aria-label", "편차 계산 진행률");
      loading.append(status, progress); body.append(loading);
      const output = element("div", "variance-result"); body.append(output);
      dialog.append(body);

      let controller = null, currentResult = null, blacksmith = null, successValue = null, plot = null, toolbar = null;
      const stop = () => { controller?.abort(); controller = null; };
      const updateBudget = () => {
        if (!currentResult || !successValue || !plot) return;
        const amount = budgetInput.value.trim() ? Number(budgetInput.value) * 1e8 : null;
        const valid = amount !== null && Number.isFinite(amount) && amount >= 0;
        if (valid) {
          const chance = varianceBudgetPosition(currentResult.sorted, amount), percent = chance * 100;
          successValue.textContent = percent > 0 && percent < 0.05 ? "<0.1%"
            : percent > 99.95 && percent < 100 ? ">99.9%" : `${percent.toFixed(1)}%`;
          successValue.dataset.probability = String(chance);
          successValue.title = `시뮬레이션 ${number.format(currentResult.sampleCount)}회 기준 추정값`;
        } else {
          successValue.textContent = "—";
          delete successValue.dataset.probability;
          successValue.title = "예산을 입력하면 해당 금액 안에 목표 성수에 도달할 확률을 표시합니다.";
        }
        output.dataset.chartMode = chartMode;
        const renderer = chartMode === "histogram" ? histogramChart : chart;
        const nextPlot = renderer(currentResult, valid ? amount : null, plot.clientWidth, { blacksmith });
        const focusedControl = toolbar.contains(document.activeElement) ? document.activeElement : null;
        nextPlot.append(toolbar);
        plot.replaceChildren(nextPlot);
        focusedControl?.focus({ preventScroll: true });
      };
      budgetInput.addEventListener("input", updateBudget);
      // Reflow the axes and hit targets when the dialog changes width, without
      // rerunning the simulation or replacing the focused budget field.
      let chartWidth = 0;
      const resize = new ResizeObserver(() => {
        const width = plot?.clientWidth ?? 0;
        if (width > 0 && width !== chartWidth) { chartWidth = width; updateBudget(); }
      });
      resize.observe(body);
      const render = (result) => {
        currentResult = result;
        const blacksmithMultiplier = request.blacksmithMultiplier ?? 1;
        blacksmith = { cost: result.mean * blacksmithMultiplier, multiplier: blacksmithMultiplier };
        output.replaceChildren();
        output.dataset.sampleCount = String(result.sampleCount);
        output.dataset.mean = String(result.mean);
        output.dataset.meanBooms = String(result.meanBooms);
        output.dataset.meanSpares = String(result.meanSpares);
        output.dataset.standardDeviation = String(result.standardDeviation);
        output.dataset.strategy = "current";
        const summary = element("section", "variance-summary");
        summary.setAttribute("aria-label", "기본 전략의 비용과 예산 내 성공 확률");
        const highlights = element("dl", "variance-highlights");
        const average = element("div", "variance-average");
        average.append(element("dt", "", "평균 비용"), element("dd", "", formatMeso(result.mean)));
        const success = element("div", "variance-success");
        const successResult = element("dd", "variance-success__result");
        successValue = element("span", "variance-success__value", "—");
        successValue.setAttribute("aria-live", "polite");
        const successHeading = element("dt", "variance-success__heading");
        successHeading.append(budget);
        successResult.append(successValue);
        success.append(successHeading, successResult);
        highlights.append(average, success);
        const overview = element("div", "variance-overview");
        overview.append(highlights); summary.append(overview);
        const outcomes = element("dl", "variance-outcomes");
        for (const [label, value, unit] of [["평균 파괴", result.meanBooms, "회"], ["평균 스페어", result.meanSpares, "개"]]) {
          const metric = element("div");
          metric.append(element("dt", "", label), element("dd", "", `${formatNumber(value)}${unit}`)); outcomes.append(metric);
        }
        const deviation = element("div");
        deviation.append(element("dt", "", "표준 편차"), element("dd", "", formatMeso(result.standardDeviation)));
        outcomes.append(deviation);
        overview.append(outcomes);
        const percentiles = element("dl", "variance-percentiles");
        const blacksmithPrice = element("div", "variance-blacksmith-price");
        blacksmithPrice.dataset.cost = String(blacksmith.cost);
        blacksmithPrice.title = `평균 비용 × 대장장이 배율 ${blacksmith.multiplier.toFixed(2)}`;
        blacksmithPrice.append(element("dt", "", "대장장이 금액"), element("dd", "", formatMeso(blacksmith.cost)));
        percentiles.append(blacksmithPrice);
        for (const [percent, value] of [[10, result.p10], [50, result.median], [90, result.p90]]) {
          const metric = element("div", "variance-percentile");
          metric.title = `비용이 적게 든 순으로 ${percent}%가 이 금액 이하로 완료 · 시뮬레이션 추정값`;
          metric.append(element("dt", "", `상위 ${percent}%`), element("dd", "", formatMeso(value))); percentiles.append(metric);
        }
        summary.append(percentiles); output.append(summary);
        const graph = element("figure", "variance-chart");
        toolbar = element("div", "variance-chart__toolbar");
        const graphModes = element("div", "variance-chart__modes");
        graphModes.setAttribute("role", "group"); graphModes.setAttribute("aria-label", "편차 그래프 방식");
        for (const [mode, label] of [["curve", "순위 곡선"], ["histogram", "비용 분포"]]) {
          const button = element("button", "", label);
          button.type = "button"; button.dataset.chartMode = mode;
          button.setAttribute("aria-pressed", String(chartMode === mode));
          button.addEventListener("click", () => {
            chartMode = mode;
            for (const control of graphModes.children) control.setAttribute("aria-pressed", String(control.dataset.chartMode === mode));
            updateBudget();
          });
          graphModes.append(button);
        }
        plot = element("div");
        toolbar.append(graphModes);
        graph.append(plot); output.append(graph);
        updateBudget();
      };
      const run = async () => {
        stop(); currentResult = null; successValue = null; plot = null;
        output.replaceChildren();
        delete output.dataset.sampleCount; delete output.dataset.mean;
        delete output.dataset.meanBooms; delete output.dataset.meanSpares; delete output.dataset.standardDeviation;
        const calculation = selectedRequest(), sampleCount = Number(precision.value);
        const pending = new AbortController(); controller = pending;
        const alive = () => controller === pending && !pending.signal.aborted && dialog.open;
        progress.max = sampleCount; progress.value = 0;
        loading.hidden = false; progress.hidden = false;
        status.textContent = "편차를 계산하고 있습니다.";
        const fail = (message) => {
          stop(); progress.hidden = true;
          status.textContent = message;
          const retry = element("button", "button button--quiet", "다시 계산"); retry.type = "button";
          retry.addEventListener("click", run); output.replaceChildren(retry);
        };
        try {
          const result = await requestVarianceSimulation(calculation.plans, sampleCount, {
            signal: pending.signal,
            progress: (value) => {
              if (!alive()) return;
              progress.value = value.completed;
              status.textContent = `편차 계산 중 · ${Math.floor(progress.value / progress.max * 100)}%`;
            },
          });
          if (!alive()) return;
          loading.hidden = true; render(result);
        } catch (error) {
          if (alive()) fail("편차를 계산하지 못했습니다. 다시 시도해 주세요.");
        }
      };
      precision.addEventListener("change", run);
      equipmentSelect.element.addEventListener("change", run);
      const outside = (event) => {
        const bounds = dialog.getBoundingClientRect();
        return event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
      };
      let pressedOutside = false;
      dialog.addEventListener("pointerdown", (event) => { pressedOutside = outside(event); });
      dialog.addEventListener("click", (event) => { if (pressedOutside && outside(event)) dialog.close(); pressedOutside = false; });
      dialog.addEventListener("keydown", (event) => { if (event.key === "Escape") event.stopPropagation(); });
      const previousOverflow = document.documentElement.style.overflow;
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        stop(); resize.disconnect(); equipmentSelect.destroy(); dialog.remove();
        document.documentElement.style.overflow = previousOverflow;
        if (active === dialog) { active = null; activeCleanup = null; }
        if (opener?.isConnected) opener.focus({ preventScroll: true });
      };
      dialog.addEventListener("close", cleanup, { once: true });
      document.body.append(dialog); active = dialog; activeCleanup = cleanup;
      document.documentElement.style.overflow = "hidden";
      dialog.showModal(); run();
    },
    close,
  };
}
