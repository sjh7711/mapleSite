import { formatMeso, formatNumber } from "../calc.js";
import { varianceBudgetPosition, variancePoint, varianceQuantile } from "./starforce-variance.js";
import { varianceMeanMarkers } from "./starforce-variance-comparison.js";
import { bindVariancePointer } from "./starforce-variance-pointer.js";
import { nearbyVarianceMarker, varianceChartFrame } from "./starforce-variance-chart-layout.js";
import { varianceCostDifference, varianceDifferenceAxis, varianceDifferenceCurve, varianceHistogramDifference } from "./starforce-variance-difference.js";

function svgNode(tag, attributes = {}, text) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}
function node(tag, className = "", text) {
  const item = document.createElement(tag); item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}
const sign = (value) => value > 0 ? "+" : value < 0 ? "−" : "";
const money = (value) => `${sign(value)}${Math.abs(value) > 0 && Math.abs(value) < 5e5
  ? `${formatNumber(Math.abs(value), 0)}메소` : formatMeso(Math.abs(value))}`;
const percentagePoints = (value) => `${sign(value)}${formatNumber(Math.abs(value), 2)}%p`;

// Keep the extrema within every pixel column. This bounds the SVG size on
// 100k simulations without clipping a tail or smoothing across a step.
function visibleCurve(points, x, y) {
  const kept = [], groups = new Map();
  points.forEach((point, index) => {
    const column = Math.round(x(point.rank));
    if (!groups.has(column)) groups.set(column, []);
    groups.get(column).push(index);
  });
  for (const indices of groups.values()) {
    let low = indices[0], high = low;
    for (const index of indices) {
      if (points[index].difference < points[low].difference) low = index;
      if (points[index].difference > points[high].difference) high = index;
    }
    for (const index of [...new Set([indices[0], low, high, indices.at(-1)])].sort((a, b) => a - b)) kept.push(points[index]);
  }
  return kept.map((point, index) => `${index ? "L" : "M"}${x(point.rank).toFixed(3)},${y(point.difference).toFixed(3)}`).join(" ");
}

/** Comparison alone uses a zero-centered difference plot. The regular graph
 * remains untouched, and tooltips retain the two original costs/probabilities.
 */
export function varianceDifferenceChart(result, amount, width, { blacksmith, comparison, mode }) {
  const histogram = mode === "histogram";
  const frame = varianceChartFrame(width), viewWidth = frame.width, bottom = frame.bottom;
  const showBlacksmith = Boolean(blacksmith && blacksmith.multiplier !== 1);
  // Reserve one more label row for the persistent blacksmith reference,
  // keeping the outer chart size and the first two mean labels stable.
  const top = (viewWidth < 560 ? 216 : 152) + (showBlacksmith ? 22 : 0);
  const points = histogram ? null : varianceDifferenceCurve(comparison);
  const data = histogram ? varianceHistogramDifference(comparison, 2 * Math.max(12, Math.min(44, Math.floor((viewWidth - 80) / 18)))) : null;
  const values = histogram ? data.bins.map((bin) => bin.difference) : points.map((point) => point.difference);
  // Uniform rank samples determine the central focus, regardless of whether
  // the two simulations have equal numbers of samples.
  const absoluteDifferences = histogram ? null : Array.from({ length: 1001 }, (_, i) => Math.abs(varianceCostDifference(comparison, i / 1000).difference)).sort((a, b) => a - b);
  const axis = varianceDifferenceAxis(values, histogram ? 0.01 : 1e6, histogram ? null : Math.max(1e6, absoluteDifferences[900]));
  const label = histogram ? percentagePoints : money;
  const measure = document.createElement("canvas").getContext("2d");
  const font = getComputedStyle(document.body).fontFamily;
  const textWidth = (text, size = 12) => { measure.font = `${size}px ${font}`; return measure.measureText(text).width; };
  const title = histogram ? "비중 차이" : "비용 차이";
  const axisWidth = Math.max(...axis.ticks.map((value) => textWidth(label(value)))) + 12;
  const left = Math.ceil(Math.max(axisWidth, textWidth(title, 13) + 12, textWidth(formatMeso(histogram ? data.minimum : result.sorted[0])) / 2 + 4));
  const lastText = histogram ? `${formatMeso(data.limit)}${data.overflow ? " 이상" : ""}` : formatMeso(result.sorted.at(-1));
  const right = viewWidth - Math.ceil(Math.max(histogram ? 0 : axisWidth, textWidth(lastText) / 2 + 4));
  const y = (difference) => (top + bottom) / 2 - axis.position(difference) * (bottom - top) / 2;
  const zero = y(0), step = histogram ? (right - left) / data.bins.length : 0;
  const regularRight = histogram && data.overflow ? right - step : right;
  const costX = (cost) => data.limit === data.minimum ? (left + right) / 2
    : left + Math.max(0, Math.min(1, (cost - data.minimum) / (data.limit - data.minimum))) * (regularRight - left);
  const x = histogram ? costX : (rank) => left + rank * (right - left);
  const plot = node("div", "variance-chart__plot variance-chart__plot--difference"); plot.dataset.mode = mode;
  const svg = svgNode("svg", {
    viewBox: `0 0 ${viewWidth} ${frame.height}`, role: "img", tabindex: 0,
    "data-chart": histogram ? "histogram" : "curve", "data-layout": "difference", "data-scale": axis.compressed ? "hybrid" : "linear",
    "data-zero": zero, "data-difference-maximum": axis.maximum,
    "data-cost-minimum": histogram ? data.minimum : result.sorted[0],
    "data-cost-limit": histogram ? data.limit : result.sorted.at(-1),
    "aria-label": histogram
      ? "스타포스 비용 분포 차이. 편차 감소 전략의 완료 비중에서 기본 전략의 비중을 뺀 값입니다. 위쪽은 비중 증가, 아래쪽은 비중 감소이며 단위는 퍼센트포인트입니다. 가로축은 두 전략에 공통인 금액 구간입니다. 마지막 막대는 표시 금액 이상의 모든 결과를 포함합니다. 좌우 방향키로 구간을 이동합니다. 두 평균선과 배율이 1.00이 아닌 대장장이 기준선은 항상 표시하고 다른 기준선은 근처를 선택할 때 표시합니다."
      : `스타포스 순위별 비용 차이. 같은 순위의 편차 감소 완료 비용에서 기본 완료 비용을 뺀 값입니다. 0선 아래는 비용 감소, 위는 비용 증가입니다. ${axis.compressed ? "0선 주변은 선형이며 극단적인 차이는 양쪽에 같은 비율로 압축합니다. " : ""}가로축 윗줄은 상위 비율, 아랫줄은 기본 전략의 완료 비용입니다. 좌우 방향키로 이동하면 두 전략의 비용과 차이를 확인할 수 있습니다. 평균선은 각 전략의 평균이 위치한 순위입니다. 두 평균선과 배율이 1.00이 아닌 대장장이 기준선은 항상 표시하고 다른 기준선은 근처를 선택할 때 표시합니다.`,
  });
  plot.append(svg);
  const caption = node("div", "variance-chart__difference-key");
  caption.style.top = viewWidth < 560 ? "88px" : "46px";
  caption.append(node("span", "", `편차 감소 − 기본${axis.compressed ? " · 양 끝 압축" : ""}`));
  const legend = node("span", "variance-chart__difference-signs");
  legend.append(node("span", "is-negative", histogram ? "비중 감소" : "비용 감소"), node("span", "is-positive", histogram ? "비중 증가" : "비용 증가"));
  caption.append(legend); plot.append(caption);
  svg.append(svgNode("text", { x: left - 10, y: top - 18, "text-anchor": "end", class: "variance-chart__axis-title" }, title));
  for (const value of axis.ticks) {
    svg.append(svgNode("line", { x1: left, x2: right, y1: y(value), y2: y(value),
      class: value === 0 ? "variance-chart__zero" : "variance-chart__grid" }));
    for (const [side, position, anchor] of [["left", left - 10, "end"], ...(!histogram ? [["right", right + 10, "start"]] : [])]) {
      svg.append(svgNode("text", { x: position, y: y(value) + 4, "text-anchor": anchor,
        class: "variance-chart__money-tick", "data-axis-side": side, "data-difference": value, "aria-hidden": side === "right" }, label(value)));
    }
  }
  const bars = [];
  if (histogram) {
    const gap = Math.min(2, step * 0.2);
    data.bins.forEach((bin, index) => {
      const bar = svgNode("rect", {
        x: left + index * step + gap / 2, y: Math.min(zero, y(bin.difference)),
        width: step - gap, height: Math.abs(y(bin.difference) - zero), rx: Math.min(1, step / 3),
        class: `variance-chart__difference-bar ${bin.difference < 0 ? "is-negative" : "is-positive"}`,
        "data-index": index, "data-difference": bin.difference, "data-lower": bin.lower, "data-upper": bin.upper ?? "",
        "data-basic-count": bin.basic.count, "data-reduced-count": bin.reduced.count,
        "data-basic-probability": bin.basic.probability, "data-reduced-probability": bin.reduced.probability,
      });
      svg.append(bar); bars.push(bar);
    });
  } else {
    // Clip the same difference path above/below zero; fills never imply that a
    // reduction in dispersion improves every rank's completion cost.
    const defs = svgNode("defs"), id = `difference-${crypto.randomUUID()}`;
    for (const [kind, from, to] of [["positive", top, zero], ["negative", zero, bottom]]) {
      const clip = svgNode("clipPath", { id: `${id}-${kind}` });
      clip.append(svgNode("rect", { x: left, y: from, width: right - left, height: to - from })); defs.append(clip);
    }
    svg.append(defs);
    const path = visibleCurve(points, x, y);
    for (const kind of ["positive", "negative"]) {
      svg.append(svgNode("path", { d: `${path} L${right},${zero} L${left},${zero} Z`, class: `variance-chart__difference-area is-${kind}`, "clip-path": `url(#${id}-${kind})` }));
      svg.append(svgNode("path", { d: path, class: `variance-chart__difference-line is-${kind}`, "clip-path": `url(#${id}-${kind})` }));
    }
  }
  if (histogram) {
    let previous = -Infinity;
    for (const fraction of (viewWidth < 560 ? [0, 0.5, 1] : [0, 1 / 3, 2 / 3, 1])) {
      const cost = data.minimum + fraction * (data.limit - data.minimum);
      const text = fraction === 1 ? lastText : formatMeso(cost), center = x(cost), half = textWidth(text) / 2;
      if (fraction !== 1 && center - half < previous + 8) continue;
      if (fraction !== 1 && center + half > x(data.limit) - textWidth(lastText) / 2 - 8) continue;
      svg.append(svgNode("text", { x: center, y: bottom + 24, "text-anchor": "middle", class: "variance-chart__money-tick" }, text));
      previous = center + half;
    }
  } else {
    for (const rank of [0, 0.25, 0.5, 0.75, 1]) {
      const group = svgNode("g", { class: `variance-chart__rank-tick${rank === 0.25 || rank === 0.75 ? " variance-chart__rank-tick--minor" : ""}` });
      group.append(svgNode("text", { x: x(rank), y: bottom + 19, "text-anchor": "middle" }, `상위 ${rank * 100}%`),
        svgNode("text", { x: x(rank), y: bottom + 39, "text-anchor": "middle", class: "variance-chart__rank-cost" }, formatMeso(varianceQuantile(result.sorted, rank))));
      svg.append(group);
    }
  }
  const markers = [...varianceMeanMarkers(result, comparison),
    ...[[result.median, "median", "상위 50%"],
      ...(showBlacksmith ? [[blacksmith.cost, "blacksmith", `대장장이 ×${blacksmith.multiplier.toFixed(2)}`]] : []),
      ...(amount === null ? [] : [[amount, "budget", "예산"]])].map(([value, kind, text]) => ({
        value, kind, text, rank: kind === "median" ? 0.5 : varianceBudgetPosition(result.sorted, value),
      }))].map((marker) => ({ ...marker, x: x(histogram ? marker.value : marker.rank) }));
  const persistent = markers.filter((marker) => marker.kind.startsWith("mean") || marker.kind === "blacksmith");
  for (const marker of markers) {
    const always = persistent.includes(marker);
    const line = svgNode("line", { x1: marker.x, x2: marker.x, y1: top, y2: bottom,
      class: `variance-chart__${marker.kind}`, "data-cost": marker.value, "data-series": marker.series ?? "",
      "data-percentile": marker.rank, "data-comparison": true,
      "data-conditional": !always, "aria-label": `${marker.text} ${formatMeso(marker.value)}` });
    const group = svgNode("g", { class: `variance-chart__annotation variance-chart__annotation--${marker.kind}`,
      "data-series": marker.series ?? "", "data-comparison": true, "data-conditional": !always });
    const text = histogram && (marker.value < data.minimum || marker.value > data.limit) ? `${marker.text} (범위 밖)` : marker.text;
    const labelWidth = textWidth(text, 13) + 12;
    const center = Math.max(labelWidth / 2 + 4, Math.min(viewWidth - labelWidth / 2 - 4, marker.x));
    const labelY = always ? top - 54 - (persistent.length - 2) * 22 + persistent.indexOf(marker) * 22 : top + 20;
    group.append(svgNode("rect", { x: center - labelWidth / 2, y: labelY - 15, width: labelWidth, height: 22, rx: 4 }),
      svgNode("text", { x: center, y: labelY + 1, "text-anchor": "middle" }, text));
    marker.line = line; marker.label = group; marker.always = always;
    svg.append(line, group);
  }
  const cursor = svgNode("line", { y1: top, y2: bottom, class: "variance-chart__cursor" });
  const dot = svgNode("circle", { r: 5, class: "variance-chart__selected" }); svg.append(cursor, dot);
  const tooltip = node("div", "variance-chart__tooltip"); tooltip.hidden = true;
  tooltip.id = histogram ? "variance-histogram-tooltip" : "variance-chart-tooltip";
  tooltip.setAttribute("role", "tooltip"); svg.setAttribute("aria-describedby", tooltip.id);
  const heading = node("strong"), difference = node("strong"), guide = node("span"), before = node("span"), beforeCounts = node("span"), after = node("span"), afterCounts = node("span");
  tooltip.append(heading, difference, guide, before, beforeCounts, after, afterCounts); plot.append(tooltip);
  const outcome = (point) => `평균 파괴 ${formatNumber(point.meanBooms)}회 · 평균 스페어 ${formatNumber(point.meanSpares)}개`;
  let active = null;
  function markerActive(selected) {
    for (const marker of markers) {
      for (const item of [marker.line, marker.label]) {
        item.dataset.markerActive = String(marker === selected);
        if (!marker.always) item.setAttribute("aria-hidden", String(marker !== selected));
      }
    }
  }
  const hide = () => {
    active = null; tooltip.hidden = true; cursor.dataset.active = "false"; dot.dataset.active = "false";
    bars.forEach((bar) => delete bar.dataset.active); markerActive(null);
  };
  function show(position, clientX, clientY, selected = null) {
    active = histogram ? Math.max(0, Math.min(data.bins.length - 1, Math.floor(position))) : Math.max(0, Math.min(1, position));
    markerActive(selected);
    Object.assign(tooltip.dataset, { markerKind: selected?.kind ?? "", markerCost: selected?.value ?? "", markerSeries: selected?.series ?? "" });
    guide.textContent = selected ? `${selected.text} ${formatMeso(selected.value)}` : ""; guide.hidden = !selected;
    let cursorX;
    if (histogram) {
      const bin = data.bins[active];
      bars.forEach((bar, index) => bar.dataset.active = String(index === active));
      heading.textContent = bin.overflow ? `${formatMeso(bin.lower)} 이상` : `${formatMeso(bin.lower)} ~ ${formatMeso(bin.upper)}`;
      difference.textContent = `완료 비중 차이 ${percentagePoints(bin.difference)}`;
      before.textContent = `기본 · 구간 완료 ${formatNumber(bin.basic.probability * 100)}% · 상위 ${formatNumber(bin.basic.cumulativeProbability * 100)}%`;
      after.textContent = `편차 감소 · 구간 완료 ${formatNumber(bin.reduced.probability * 100)}% · 상위 ${formatNumber(bin.reduced.cumulativeProbability * 100)}%`;
      beforeCounts.textContent = bin.basic.count ? outcome(bin.basic) : "완료한 결과 없음";
      afterCounts.textContent = bin.reduced.count ? outcome(bin.reduced) : "완료한 결과 없음";
      Object.assign(tooltip.dataset, { index: active, difference: bin.difference,
        probability: bin.basic.probability, reducedProbability: bin.reduced.probability });
      cursorX = selected?.x ?? left + (active + 0.5) * step;
    } else {
      const point = varianceCostDifference(comparison, active);
      const basicPoint = variancePoint(result, active), reducedPoint = variancePoint(comparison.results[1], active);
      heading.textContent = `상위 ${formatNumber(active * 100, 1)}%`;
      difference.textContent = `완료 비용 차이 ${money(point.difference)}`;
      before.textContent = `기본 · 완료 비용 ${formatMeso(point.basic)}`; beforeCounts.textContent = outcome(basicPoint);
      after.textContent = `편차 감소 · 완료 비용 ${formatMeso(point.reduced)}`; afterCounts.textContent = outcome(reducedPoint);
      Object.assign(tooltip.dataset, { percentile: active, cost: point.basic, reducedCost: point.reduced, difference: point.difference });
      cursorX = x(active); dot.setAttribute("cx", cursorX); dot.setAttribute("cy", y(point.difference)); dot.dataset.active = "true";
    }
    cursor.setAttribute("x1", cursorX); cursor.setAttribute("x2", cursorX); cursor.dataset.active = "true";
    tooltip.hidden = false;
    const bounds = plot.getBoundingClientRect();
    tooltip.style.left = `${Math.max(6, Math.min(bounds.width - tooltip.offsetWidth - 6, clientX - bounds.left + 12))}px`;
    tooltip.style.top = `${Math.max(6, Math.min(bounds.height - tooltip.offsetHeight - 6, clientY - bounds.top - tooltip.offsetHeight - 12))}px`;
  }
  function pointer(event) {
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
    if (point.x < left || point.x > right || point.y < top || point.y > bottom) { hide(); return; }
    const selected = nearbyVarianceMarker(markers, point.x, Math.abs(svg.getScreenCTM().a));
    const currentX = selected?.x ?? point.x;
    show(histogram ? (currentX - left) / step : selected?.rank ?? (point.x - left) / (right - left), event.clientX, event.clientY, selected);
  }
  bindVariancePointer(svg, pointer, hide);
  svg.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { if (active !== null) { event.preventDefault(); event.stopPropagation(); hide(); } return; }
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const last = histogram ? data.bins.length - 1 : 1, stepSize = histogram ? 1 : event.shiftKey ? 0.001 : 0.01;
    const value = event.key === "Home" ? 0 : event.key === "End" ? last
      : Math.max(0, Math.min(last, (active ?? (histogram ? 0 : 0.5)) + (["ArrowLeft", "ArrowDown"].includes(event.key) ? -stepSize : stepSize)));
    const logicalX = histogram ? left + (value + 0.5) * step : x(value);
    // Keyboard steps must not get stuck repeatedly snapping back to a guide.
    const selected = histogram ? null : markers.find((marker) => Math.abs(marker.rank - value) < 1e-9);
    const screen = new DOMPoint(logicalX, zero).matrixTransform(svg.getScreenCTM());
    show(value, screen.x, screen.y, selected);
  });
  markerActive(null);
  return plot;
}
