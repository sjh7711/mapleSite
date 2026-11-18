const gap = 14;

// Try both sides of the selected point before moving into a graph corner.
// Clamping alone can push a tooltip back over the point near an edge.
export function varianceTooltipPosition(bounds, size, points, avoid = [], avoidRects = []) {
  const { width, height } = size, anchor = points[0];
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const candidates = [
    [anchor.x + gap, anchor.y - height - gap],
    [anchor.x - width - gap, anchor.y - height - gap],
    [anchor.x + gap, anchor.y + gap],
    [anchor.x - width - gap, anchor.y + gap],
    [anchor.x - width / 2, anchor.y - height - gap],
    [anchor.x - width / 2, anchor.y + gap],
    [bounds.left, bounds.top], [bounds.right - width, bounds.top],
    [bounds.left, bounds.bottom - height], [bounds.right - width, bounds.bottom - height],
    ...avoidRects.flatMap((rect) => [[bounds.left, rect.top - height - gap],
      [bounds.right - width, rect.top - height - gap]]),
  ];
  let best = null, bestScore = Infinity;
  for (const [x, y] of candidates) {
    const left = clamp(x, bounds.left, bounds.right - width);
    const top = clamp(y, bounds.top, bounds.bottom - height);
    const contains = (point) => point.x > left - gap && point.x < left + width + gap
      && point.y > top - gap && point.y < top + height + gap;
    const overlapsControl = avoidRects.some((rect) => left < rect.right + 6 && left + width > rect.left - 6
      && top < rect.bottom + 6 && top + height > rect.top - 6);
    const score = points.filter(contains).length * 1e6 + avoid.filter(contains).length * 1e4 + Number(overlapsControl) * 1e3
      + Math.abs(left - x) + Math.abs(top - y);
    if (score < bestScore) { best = { left, top }; bestScore = score; }
  }
  return best;
}

export function positionVarianceTooltip(plot, svg, tooltip, anchors, pointer = null) {
  const matrix = svg.getScreenCTM();
  if (!matrix) return;
  const points = anchors.map(({ x, y }) => new DOMPoint(x, y).matrixTransform(matrix));
  const plotBounds = plot.getBoundingClientRect(), chartBounds = svg.getBoundingClientRect();
  const dialogBounds = plot.closest("dialog")?.getBoundingClientRect();
  const left = Math.max(chartBounds.left + 6, 6), right = Math.min(chartBounds.right - 6, innerWidth - 6);
  // Prefer the chart itself; the visible dialog provides room above the chart
  // when a small viewport cannot fit the tooltip on either side of the point.
  const visibleTop = Math.max((dialogBounds?.top ?? 0) + 8, 8);
  const bottom = Math.min(chartBounds.bottom - 6, (dialogBounds?.bottom ?? innerHeight) - 8, innerHeight - 8);
  tooltip.style.maxWidth = `${Math.max(0, right - left)}px`;
  const size = tooltip.getBoundingClientRect();
  const avoid = pointer ? [{ x: pointer.clientX, y: pointer.clientY }] : [];
  const controls = plot.querySelector(".variance-chart__toolbar");
  const avoidRects = controls ? [controls.getBoundingClientRect()] : [];
  let bounds = { left, right, top: Math.max(chartBounds.top + 6, visibleTop), bottom };
  let position = varianceTooltipPosition(bounds, size, points, avoid, avoidRects);
  const coversPoint = points.some((point) => point.x > position.left - gap && point.x < position.left + size.width + gap
    && point.y > position.top - gap && point.y < position.top + size.height + gap);
  if (coversPoint || size.height > bounds.bottom - bounds.top) {
    bounds = { ...bounds, top: visibleTop };
    position = varianceTooltipPosition(bounds, size, points, avoid, avoidRects);
  }
  tooltip.style.left = `${position.left - plotBounds.left}px`;
  tooltip.style.top = `${position.top - plotBounds.top}px`;
}
