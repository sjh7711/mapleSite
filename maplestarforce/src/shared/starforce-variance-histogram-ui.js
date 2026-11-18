import { formatMeso, formatNumber } from "../calc.js";
import { varianceHistogram } from "./starforce-variance-histogram.js";
import { nearbyVarianceMarker, varianceChartFrame } from "./starforce-variance-chart-layout.js";
import { appendVarianceLegend } from "./starforce-variance-legend.js";
import { varianceMeanMarkers } from "./starforce-variance-comparison.js";
import { positionVarianceTooltip } from "./starforce-variance-tooltip.js";
import { bindVariancePointer } from "./starforce-variance-pointer.js";

const cache = new WeakMap();
function svgNode(tag, attributes, text) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

export function histogramChart(result, amount, width, { blacksmith = null, comparison = null } = {}) {
  const { width: viewWidth, bottom, height } = varianceChartFrame(width, { externalControls: true });
  const narrow = viewWidth < 560;
  const binCount = 2 * Math.max(12, Math.min(44, Math.floor((viewWidth - 80) / 18)));
  let cached = cache.get(result);
  if (!cached) { cached = new Map(); cache.set(result, cached); }
  if (!cached.has(binCount)) cached.set(binCount, varianceHistogram(result, binCount));
  const shared = comparison?.histogram(result, binCount);
  const reducedBins = comparison?.histogram(comparison.results[1], binCount).data.bins;
  const data = shared?.data ?? cached.get(binCount), { bins, minimum, limit, overflow, regularCount } = data;
  const plot = document.createElement("div"); plot.className = "variance-chart__plot variance-chart__plot--overlay";
  const measure = document.createElement("canvas").getContext("2d");
  const fontFamily = getComputedStyle(document.body).fontFamily;
  const textWidth = (text, size = 12, weight = 400) => {
    measure.font = `${weight} ${size}px ${fontFamily}`;
    return measure.measureText(text).width;
  };
  const finalText = `${formatMeso(limit)}${overflow ? " 이상" : ""}`;
  const axisTitleText = "완료 비중";
  const left = Math.ceil(Math.max(42, textWidth(axisTitleText, 13, 600) + 17, textWidth(formatMeso(minimum)) / 2 + 4));
  const right = viewWidth - Math.ceil(textWidth(finalText) / 2 + 4);
  const step = (right - left) / bins.length;
  const regularRight = overflow ? right - step : right;
  const x = (cost) => limit === minimum ? (left + right) / 2
    : left + Math.max(0, Math.min(1, (cost - minimum) / (limit - minimum))) * (regularRight - left);
  // Keep comparison costs on the same monetary axis as the sampled outcomes.
  const markers = [...varianceMeanMarkers(result, comparison).map((marker) => ({ ...marker, label: marker.text })),
    ...[[result.median, "median", "상위 50%"],
    ...(blacksmith && blacksmith.multiplier !== 1 ? [[blacksmith.cost, "blacksmith", `대장장이 ×${blacksmith.multiplier.toFixed(2)}`]] : []),
    ...(amount === null ? [] : [[amount, "budget", "예산"]])].map(([value, kind, label]) => ({ value, kind, label }))]
    .map((marker) => ({ ...marker,
      label: marker.value < minimum || marker.value > limit ? `${marker.label}(범위 밖)` : marker.label,
      position: x(marker.value),
    })).sort((a, b) => a.position - b.position);
  const ends = [];
  for (const marker of markers) {
    marker.labelWidth = textWidth(marker.label, 13, 600) + 12;
    marker.center = Math.max(left + marker.labelWidth / 2, Math.min(right - marker.labelWidth / 2, marker.position));
    marker.start = marker.center - marker.labelWidth / 2;
    marker.row = ends.findIndex((end) => end + 6 <= marker.start);
    if (marker.row < 0) marker.row = ends.length;
    ends[marker.row] = marker.start + marker.labelWidth;
  }
  const labelRowHeight = 22;
  const header = 8, top = header + Math.max(58, (comparison ? Math.max(4, ends.length) : ends.length) * labelRowHeight + 10);
  const peak = shared?.peak ?? Math.max(...bins.map((bin) => bin.probability)) * 100;
  const tickStep = peak <= 4 ? 1 : peak <= 10 ? 2 : peak <= 25 ? 5 : peak <= 50 ? 10 : 20;
  const ceiling = Math.max(tickStep, Math.ceil(peak / tickStep) * tickStep);
  const y = (probability) => bottom - probability * 100 / ceiling * (bottom - top);
  const svg = svgNode("svg", { viewBox: `0 0 ${viewWidth} ${height}`, role: "img", tabindex: 0,
    "data-chart": "histogram", "data-layout": comparison ? "paired" : "single", "data-sample-count": result.sampleCount,
    "data-cost-minimum": minimum, "data-cost-limit": limit, "data-percent-ceiling": ceiling,
    "aria-label": `스타포스 비용 분포. ${comparison ? "같은 금액 구간 안에 기본과 편차 감소 막대를 나란히 표시합니다. 두 전략은 같은 비중 축을 사용합니다. 평균선은 각 전략 기준이며 나머지 기준선은 기본 전략 기준입니다. " : ""}가로축은 완료 비용, 세로축은 각 금액 구간에서 완료한 비중입니다. 마지막 막대의 이상 표시는 해당 금액 이상의 모든 결과를 포함합니다. 좌우 방향키로 구간별 비용과 완료 비중, 평균 파괴·평균 스페어를 확인할 수 있습니다.` });
  plot.append(svg); appendVarianceLegend(plot, comparison, "histogram");
  svg.append(svgNode("text", { x: left - 9, y: top - 18, "text-anchor": "end", class: "variance-chart__axis-title" }, axisTitleText));
  for (let percent = 0; percent <= ceiling; percent += tickStep) {
    const position = y(percent / 100);
    svg.append(svgNode("line", { x1: left, x2: right, y1: position, y2: position, class: "variance-chart__grid" }));
    svg.append(svgNode("text", { x: left - 9, y: position + 4, "text-anchor": "end", class: "variance-chart__money-tick" }, `${percent}%`));
  }
  const gap = Math.min(2, step * 0.2), innerGap = comparison ? Math.min(1, step * 0.1) : 0;
  const barWidth = (step - gap - innerGap) / (comparison ? 2 : 1);
  const bars = bins.map((bin, index) => {
    const bar = svgNode("rect", { x: left + index * step + gap / 2, y: y(bin.probability),
      width: barWidth, height: Math.max(0, bottom - y(bin.probability)), rx: Math.min(1.5, barWidth / 3),
      class: `variance-chart__bar${comparison ? " variance-chart__bar--basic" : ""}${bin.overflow ? " variance-chart__bar--overflow" : ""}`,
      "data-series": "basic",
      "data-index": index, "data-count": bin.count, "data-lower": bin.lower,
      "data-upper": bin.upper ?? "", "data-probability": bin.probability });
    svg.append(bar); return bar;
  });
  const reducedBars = reducedBins?.map((bin, index) => {
    const bar = svgNode("rect", { x: left + index * step + gap / 2 + barWidth + innerGap, y: y(bin.probability),
      width: barWidth, height: Math.max(0, bottom - y(bin.probability)), rx: Math.min(1.5, barWidth / 3),
      class: "variance-chart__bar variance-chart__bar--reduced", "data-series": "reduced",
      "data-index": index, "data-count": bin.count, "data-lower": bin.lower,
      "data-upper": bin.upper ?? "", "data-probability": bin.probability });
    svg.append(bar); return bar;
  });
  const ticks = minimum === limit ? [{ position: x(minimum), text: formatMeso(minimum) }]
    : [...(narrow ? [0, 0.5] : [0, 1 / 3, 2 / 3]).map((fraction) => ({
      position: x(minimum + (limit - minimum) * fraction), text: formatMeso(minimum + (limit - minimum) * fraction),
    })), { position: overflow ? right - step / 2 : right, text: finalText }];
  // Keep the endpoint amounts visible and omit interior labels that would
  // overlap after allowing room for the vertical axis title on small screens.
  const finalLabelLeft = ticks.at(-1).position - textWidth(ticks.at(-1).text) / 2;
  let previousLabelRight = -Infinity;
  for (const [index, tick] of ticks.entries()) {
    const halfWidth = textWidth(tick.text) / 2;
    if (index > 0 && index < ticks.length - 1
      && (tick.position - halfWidth < previousLabelRight + 12 || tick.position + halfWidth + 12 > finalLabelLeft)) continue;
    svg.append(svgNode("text", { x: tick.position, y: bottom + 25,
      "text-anchor": "middle", class: "variance-chart__money-tick" }, tick.text));
    previousLabelRight = tick.position + halfWidth;
  }

  for (const marker of markers) {
    marker.line = svgNode("line", { x1: marker.position, x2: marker.position, y1: top, y2: bottom,
      class: `variance-chart__${marker.kind}`, "data-cost": marker.value,
      "data-series": marker.series ?? "", "data-comparison": Boolean(comparison),
      "aria-label": `${marker.label} ${formatMeso(marker.value)}` });
    svg.append(marker.line);
    const group = svgNode("g", { class: `variance-chart__annotation variance-chart__annotation--${marker.kind}`,
      "data-series": marker.series ?? "", "data-comparison": Boolean(comparison) });
    group.append(svgNode("rect", { x: marker.start, y: header + 4 + marker.row * labelRowHeight, width: marker.labelWidth, height: 20, rx: 3 }),
      svgNode("text", { x: marker.center, y: header + 19 + marker.row * labelRowHeight, "text-anchor": "middle" }, marker.label));
    svg.append(group);
  }
  const tooltip = document.createElement("div"); tooltip.className = "variance-chart__tooltip";
  tooltip.id = "variance-histogram-tooltip"; tooltip.setAttribute("role", "tooltip"); tooltip.hidden = true;
  svg.setAttribute("aria-describedby", tooltip.id);
  const heading = document.createElement("strong"), range = document.createElement("span"), share = document.createElement("span"), counts = document.createElement("span");
  range.hidden = true;
  tooltip.append(heading, range, share, counts);
  const reducedShare = document.createElement("span"), reducedCounts = document.createElement("span");
  if (comparison) tooltip.append(reducedShare, reducedCounts);
  plot.append(tooltip);
  let active = null;
  const hide = () => {
    if (active !== null) { bars[active].removeAttribute("data-active"); reducedBars?.[active].removeAttribute("data-active"); }
    for (const marker of markers) marker.line.removeAttribute("data-marker-active");
    active = null; tooltip.hidden = true;
  };
  const show = (index, marker = null, pointer = null) => {
    hide(); active = Math.max(0, Math.min(bins.length - 1, index));
    const bin = bins[active]; bars[active].dataset.active = "true";
    const rangeText = bin.overflow ? `${formatMeso(bin.lower)} 이상`
      : bin.lower === bin.upper ? formatMeso(bin.lower) : `${formatMeso(bin.lower)} ~ ${formatMeso(bin.upper)}`;
    heading.textContent = marker ? `${marker.label} ${formatMeso(marker.value)}` : rangeText;
    range.textContent = marker ? `구간 ${rangeText}` : ""; range.hidden = !marker;
    if (marker) marker.line.dataset.markerActive = "true";
    Object.assign(tooltip.dataset, { markerKind: marker?.kind ?? "", markerCost: marker?.value ?? "", markerSeries: marker?.series ?? "" });
    share.textContent = `${comparison ? "기본 · " : ""}구간 완료 ${formatNumber(bin.probability * 100, 2)}% · 상위 ${formatNumber(bin.cumulativeProbability * 100, 2)}%`;
    counts.textContent = bin.count ? `평균 파괴 ${formatNumber(bin.meanBooms)}회 · 평균 스페어 ${formatNumber(bin.meanSpares)}개` : "완료한 결과 없음";
    if (reducedBins) {
      const reduced = reducedBins[active]; reducedBars[active].dataset.active = "true";
      reducedShare.textContent = `편차 감소 · 구간 완료 ${formatNumber(reduced.probability * 100, 2)}% · 상위 ${formatNumber(reduced.cumulativeProbability * 100, 2)}%`;
      reducedCounts.textContent = reduced.count ? `평균 파괴 ${formatNumber(reduced.meanBooms)}회 · 평균 스페어 ${formatNumber(reduced.meanSpares)}개` : "완료한 결과 없음";
      tooltip.dataset.reducedProbability = String(reduced.probability);
    }
    Object.assign(tooltip.dataset, { index: active, count: bin.count, probability: bin.probability,
      cumulative: bin.cumulativeProbability, booms: bin.meanBooms, spares: bin.meanSpares });
    tooltip.hidden = false;
    const anchor = (bar) => ({ x: Number(bar.getAttribute("x")) + Number(bar.getAttribute("width")) / 2,
      y: Number(bar.getAttribute("y")) });
    const anchors = [anchor(bars[active])];
    if (reducedBars) anchors.push(anchor(reducedBars[active]));
    positionVarianceTooltip(plot, svg, tooltip, anchors, pointer);
  };
  const pointer = (event) => {
    const bounds = svg.getBoundingClientRect(), scale = bounds.width / viewWidth;
    const inset = (bounds.height - height * scale) / 2;
    const px = (event.clientX - bounds.left) / scale, py = (event.clientY - bounds.top - inset) / scale;
    if (px < left || px > right || py < top || py > bottom) { hide(); return; }
    const nearby = nearbyVarianceMarker(markers, px, scale, (marker) => marker.position);
    const position = nearby?.position ?? px;
    show(Math.floor((position - left) / step), nearby, event);
  };
  bindVariancePointer(svg, pointer, hide);
  svg.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { if (active !== null) { event.preventDefault(); event.stopPropagation(); hide(); } return; }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === "Home" ? 0 : event.key === "End" ? bins.length - 1 : (active ?? 0) + (event.key === "ArrowRight" ? 1 : -1);
    show(index);
  });
  return plot;
}
