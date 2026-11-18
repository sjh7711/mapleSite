import { varianceQuantile } from "./starforce-variance.js";
const curveCache = new WeakMap();

// Compare the same quantile, never an average of neighboring ranks.
export function varianceCostDifference(comparison, rank) {
  const basic = varianceQuantile(comparison.results[0].sorted, rank);
  const reduced = varianceQuantile(comparison.results[1].sorted, rank);
  return { rank, basic, reduced, difference: reduced - basic };
}

// Include every sample knot so a rare tail or a sharp jump cannot be missed
// when sizing the difference axis. Q(reduced) - Q(basic) is piecewise linear.
export function varianceDifferenceCurve(comparison) {
  if (curveCache.has(comparison)) return curveCache.get(comparison);
  const ranks = new Set([0, 1]);
  for (const result of comparison.results) {
    for (let i = 1; i < result.sorted.length - 1; i++) ranks.add(i / (result.sorted.length - 1));
  }
  const points = [...ranks].sort((a, b) => a - b).map((rank) => varianceCostDifference(comparison, rank));
  curveCache.set(comparison, points);
  return points;
}

export function varianceHistogramDifference(comparison, count) {
  const basic = comparison.histogram(comparison.results[0], count).data;
  const reduced = comparison.histogram(comparison.results[1], count).data;
  return { ...basic, bins: basic.bins.map((bin, index) => ({
    ...bin, basic: bin, reduced: reduced.bins[index],
    difference: (reduced.bins[index].probability - bin.probability) * 100,
  })) };
}

// Symmetric around zero: the same amount always has the same distance on
// either side. Optional tail compression leaves the central range linear.
export function varianceDifferenceAxis(values, minimumStep = 1, focus = null) {
  let peak = 0;
  for (const value of values) peak = Math.max(peak, Math.abs(value));
  const raw = Math.max(peak / 3, minimumStep);
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((value) => value >= raw);
  const intervals = Math.max(1, Math.ceil(peak / step));
  const maximum = intervals * step;
  const compressed = focus !== null && focus >= minimumStep && maximum > focus * 3;
  const position = (value) => {
    const absolute = Math.abs(value);
    const distance = !compressed ? absolute / maximum : absolute <= focus ? absolute / focus * 0.7
      : 0.7 + Math.log(absolute / focus) / Math.log(maximum / focus) * 0.3;
    return Math.sign(value) * distance;
  };
  let ticks = Array.from({ length: intervals * 2 + 1 }, (_, i) => (i - intervals) * step);
  if (compressed) {
    const candidates = [0, maximum];
    for (let exponent = Math.floor(Math.log10(Math.max(focus / 4, minimumStep))); exponent <= Math.ceil(Math.log10(maximum)); exponent++) {
      for (const factor of [1, 2, 5]) {
        const value = factor * 10 ** exponent;
        if (value < maximum && value >= minimumStep) candidates.push(value);
      }
    }
    const selected = [0];
    for (const value of candidates.sort((a, b) => a - b)) {
      if (value === 0 || value === maximum) continue;
      if (position(value) - position(selected.at(-1)) >= 0.23 && 1 - position(value) >= 0.23) selected.push(value);
    }
    selected.push(maximum);
    ticks = [...selected.slice(1).reverse().map((value) => -value), ...selected];
  }
  return { maximum, ticks, position, compressed, focus: compressed ? focus : maximum };
}
