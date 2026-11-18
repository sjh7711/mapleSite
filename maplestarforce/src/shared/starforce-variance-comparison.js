import { varianceHistogram } from "./starforce-variance-histogram.js";
import { varianceCostPosition, varianceQuantile } from "./starforce-variance.js";

/** Each mean belongs to its own distribution, rather than a shared rank. */
export function varianceMeanMarkers(result, comparison = null) {
  return (comparison?.results ?? [result]).map((entry, index) => ({
    value: entry.mean, rank: varianceCostPosition(entry.sorted, entry.mean),
    series: index === 0 ? "basic" : "reduced",
    kind: index === 0 ? "mean" : "mean-reduced",
    text: comparison ? index === 0 ? "기본 평균" : "편차 감소 평균" : "평균",
  }));
}

/** Both views share money ticks, focus range, bins and histogram percentage axis.
 * Changing strategy must not magnify one curve or one set of bars independently.
 */
export function createVarianceComparison(current, reduced) {
  const results = [current, reduced];
  const sorted = new Float64Array(current.sorted.length + reduced.sorted.length);
  let a = 0, b = 0;
  for (let i = 0; i < sorted.length; i++) {
    sorted[i] = b >= reduced.sorted.length || (a < current.sorted.length && current.sorted[a] <= reduced.sorted[b])
      ? current.sorted[a++] : reduced.sorted[b++];
  }
  const minimum = sorted[0], maximum = sorted.at(-1);
  let limit = Math.max(...results.map((result) => varianceQuantile(result.sorted, 0.99)));
  if (limit <= minimum) limit = maximum;
  const domain = { minimum, maximum, limit };
  const bins = new Map();
  return {
    sorted, results,
    histogram(result, binCount) {
      if (!bins.has(binCount)) {
        const data = results.map((entry) => varianceHistogram(entry, binCount, domain));
        const peak = Math.max(...data.flatMap((entry) => entry.bins.map((bin) => bin.probability))) * 100;
        bins.set(binCount, { data, peak });
      }
      const cached = bins.get(binCount);
      return { data: cached.data[results.indexOf(result)], peak: cached.peak };
    },
  };
}
