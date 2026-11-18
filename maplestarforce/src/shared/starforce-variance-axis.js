import { varianceQuantile } from "./starforce-variance.js";

// Keep the central 80% of completion costs linear. Logarithms of the distance
// beyond each boundary compress the tails, with slope 1 at both joins. Using
// 10% of the central cost span as the shoulder keeps long tails from taking
// over the chart without moving any percentile or changing its cost.
export function varianceCostAxis(sorted) {
  const minimum = sorted[0] ?? 0, maximum = sorted.at(-1) ?? minimum;
  const focusMinimum = sorted.length ? varianceQuantile(sorted, 0.1) : minimum;
  const focusMaximum = sorted.length ? varianceQuantile(sorted, 0.9) : maximum;
  const span = maximum - minimum;
  if (!(span > 0)) {
    return { minimum, maximum, focusMinimum, focusMaximum,
      position: () => 0, costAt: () => minimum };
  }
  // A tied central range still needs a finite shoulder for outlying results.
  const focusSpan = focusMaximum - focusMinimum;
  let shoulder = (focusSpan > 0 ? focusSpan : span) * 0.1;
  if (focusSpan > 0) {
    const tailSize = (value) => value * (Math.log1p((focusMinimum - minimum) / value)
      + Math.log1p((maximum - focusMaximum) / value));
    // Exceptionally distant outliers can still dominate even a log axis.
    // Preserve at least 60% of the vertical range for distinct central costs
    // by strengthening only tail compression, keeping both joins smooth.
    const tailBudget = focusSpan * (1 / 0.6 - 1);
    if (tailSize(shoulder) > tailBudget) {
      let low = 0, high = shoulder;
      for (let i = 0; i < 40; i++) {
        const middle = (low + high) / 2;
        if (tailSize(middle) > tailBudget) high = middle;
        else low = middle;
      }
      shoulder = (low + high) / 2;
    }
  }
  const transform = (cost) => cost < focusMinimum
    ? focusMinimum - shoulder * Math.log1p((focusMinimum - cost) / shoulder)
    : cost > focusMaximum
      ? focusMaximum + shoulder * Math.log1p((cost - focusMaximum) / shoulder) : cost;
  const low = transform(minimum), high = transform(maximum);
  return {
    minimum, maximum, focusMinimum, focusMaximum,
    position(cost) { return (transform(cost) - low) / (high - low); },
    costAt(position) {
      const value = low + Math.max(0, Math.min(1, position)) * (high - low);
      return value < focusMinimum
        ? focusMinimum - shoulder * Math.expm1((focusMinimum - value) / shoulder)
        : value > focusMaximum
          ? focusMaximum + shoulder * Math.expm1((value - focusMaximum) / shoulder) : value;
    },
  };
}
