import { varianceQuantile } from "./starforce-variance.js";

/** Equal-width cost bins. The separate final bin retains every outcome above
 * the 99th-percentile display limit, so rare extremes do not flatten the plot.
 */
export function varianceHistogram(result, binCount = 40, domain = null) {
  if (!Number.isInteger(binCount) || binCount < 1 || binCount > 240 || !result.sorted.length) {
    throw new RangeError("비용 분포 구간이 올바르지 않습니다.");
  }
  const minimum = domain?.minimum ?? result.sorted[0], maximum = domain?.maximum ?? result.sorted.at(-1);
  let limit = domain?.limit ?? varianceQuantile(result.sorted, 0.99);
  if (limit <= minimum) limit = maximum;
  const overflow = maximum > limit;
  const regularCount = maximum === minimum ? 1 : binCount;
  const width = (limit - minimum) / regularCount;
  const bins = Array.from({ length: regularCount + Number(overflow) }, (_, i) => ({
    lower: i === regularCount ? limit : minimum + i * width,
    upper: i === regularCount ? null : i === regularCount - 1 ? limit : minimum + (i + 1) * width,
    overflow: i === regularCount, count: 0, probability: 0, cumulativeProbability: 0,
    meanBooms: 0, meanSpares: 0,
  }));
  for (let i = 0; i < result.sorted.length; i++) {
    const value = result.sorted[i];
    const index = overflow && value >= limit ? regularCount
      : width ? Math.min(regularCount - 1, Math.floor((value - minimum) / width)) : 0;
    const bin = bins[index];
    bin.count++;
    bin.meanBooms += result.sortedBooms[i]; bin.meanSpares += result.sortedSpares[i];
  }
  let completed = 0;
  for (const bin of bins) {
    completed += bin.count;
    bin.probability = bin.count / result.sorted.length;
    bin.cumulativeProbability = completed / result.sorted.length;
    if (bin.count) { bin.meanBooms /= bin.count; bin.meanSpares /= bin.count; }
  }
  return { bins, minimum, maximum, limit, overflow, regularCount };
}
