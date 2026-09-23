// Estimate market movement in meso, not by multiplying the whole item price.
// Flame / scroll / trade premiums are shared across periods. Only the blank
// item, Starforce and both potentials receive period-specific adjustments.
export const STABLE_MARKET_COMPONENTS = Object.freeze(["flame", "scroll", "trade"]);
const DAY = 86_400_000;
const stable = new Set(STABLE_MARKET_COMPONENTS);
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
};

export function normalizeMarketPeriods(entries, definitions, { periodDays = 30 } = {}) {
  const times = entries.map((entry) => entry.soldTime).filter((time) => time > 0);
  const latest = Math.max(0, ...times);
  const oldest = Math.min(...times);
  const fallback = (reason) => ({
    entries, diagnostics: { applied: false, reason, stable_components: STABLE_MARKET_COMPONENTS },
  });
  if (entries.length < 40 || latest - oldest < periodDays * DAY) return fallback("insufficient_period_data");
  // Bound model size even when years of captures accumulate. Adjacent older
  // windows share the last historical period; missing dates are not guessed.
  const bucket = (entry) => entry.soldTime > 0
    ? Math.min(5, Math.floor((latest - entry.soldTime) / (periodDays * DAY))) : null;
  const counts = new Map();
  for (const entry of entries) {
    const key = bucket(entry);
    if (key !== null) counts.set(key, (counts.get(key) || 0) + 1);
  }
  const periods = [...counts.keys()].filter((key) => counts.get(key) >= 12).sort((a, b) => a - b);
  if (periods[0] !== 0 || periods.length < 2) return fallback("insufficient_sales_per_period");
  const usable = entries.filter((entry) => periods.includes(bucket(entry)));
  const priceScale = median(usable.map((entry) => entry.price));
  if (!(priceScale > 0)) return fallback("invalid_price_scale");
  const varied = definitions.filter(({ key }) => {
    const values = usable.map((entry) => entry.features.vector[key] || 0);
    return Math.max(...values) - Math.min(...values) > 1e-9;
  });
  const columns = [];
  const addColumn = (values, penalty, signed, group, key) => {
    const scale = Math.max(1e-9, Math.sqrt(values.reduce((sum, x) => sum + x * x, 0) / values.length));
    columns.push({ rows: values.flatMap((value, row) => value ? [{ row, value: value / scale }] : []),
      penalty, signed, group, key, scale, coefficient: 0 });
  };
  // Shared slopes make the stable premiums identifiable from all periods.
  for (const definition of varied) {
    addColumn(usable.map((entry) => entry.features.vector[definition.key] || 0),
      1, Boolean(definition.signed), "shared", definition.key);
  }
  // Historical differences are regularized toward the shared latest market.
  for (const period of periods.slice(1)) {
    addColumn(usable.map((entry) => bucket(entry) === period ? 1 : 0), 1, true, period, "base");
    for (const definition of varied.filter((definition) => !stable.has(definition.component))) {
      // Without variation in both periods, a changed mix of sold items cannot
      // establish a changed option price. Leave that slope shared instead.
      const variesIn = (key) => {
        const values = usable.filter((entry) => bucket(entry) === key)
          .map((entry) => entry.features.vector[definition.key] || 0);
        return Math.max(...values) - Math.min(...values) > 1e-9;
      };
      if (!variesIn(0) || !variesIn(period)) continue;
      addColumn(usable.map((entry) => bucket(entry) === period ? entry.features.vector[definition.key] || 0 : 0),
        4, true, period, definition.key);
    }
  }
  const y = usable.map((entry) => entry.price / priceScale);
  const quality = usable.map((entry) => entry.qualityWeight ?? 1);
  let weights = [...quality];
  let intercept = median(y);
  const predictions = y.map(() => intercept);
  for (let round = 0; round < 3; round += 1) {
    const denominators = columns.map((column) => column.penalty + column.rows.reduce(
      (sum, row) => sum + weights[row.row] * row.value ** 2, 0));
    for (let iteration = 0; iteration < 120; iteration += 1) {
      const weightSum = weights.reduce((sum, value) => sum + value, 0);
      const offset = y.reduce((sum, value, row) => sum + weights[row] * (value - predictions[row]), 0) / weightSum;
      intercept += offset;
      for (let row = 0; row < y.length; row += 1) predictions[row] += offset;
      let change = Math.abs(offset);
      columns.forEach((column, index) => {
        const previous = column.coefficient;
        const numerator = column.rows.reduce((sum, row) => sum + weights[row.row] * row.value *
          (y[row.row] - predictions[row.row] + row.value * previous), 0);
        const raw = numerator / denominators[index];
        column.coefficient = column.signed ? raw : Math.max(0, raw);
        const delta = column.coefficient - previous;
        change = Math.max(change, Math.abs(delta));
        for (const row of column.rows) predictions[row.row] += row.value * delta;
      });
      if (change < 1e-6) break;
    }
    const residuals = y.map((value, row) => value - predictions[row]);
    const center = median(residuals);
    const sigma = Math.max(0.05, 1.4826 * median(residuals.map((value) => Math.abs(value - center))));
    weights = quality.map((weight, row) => weight * Math.min(1, 1.5 * sigma / Math.max(1e-9, Math.abs(residuals[row] - center))));
  }
  let adjustedCount = 0;
  let unsupportedCount = 0;
  const normalized = entries.map((entry) => {
    const period = bucket(entry);
    if (period === 0) return entry;
    if (!periods.includes(period)) { unsupportedCount += 1; return entry; }
    const historicDifference = columns.filter((column) => column.group === period).reduce((sum, column) =>
      sum + column.coefficient / column.scale * (column.key === "base" ? 1 : entry.features.vector[column.key] || 0), 0) * priceScale;
    const adjusted = entry.price - historicDifference;
    // Unsupported extrapolation must not fabricate a positive sold price.
    if (!(adjusted > 0) || adjusted / entry.price > 4 || adjusted / entry.price < 0.25) {
      unsupportedCount += 1;
      return entry;
    }
    adjustedCount += 1;
    return { ...entry, originalPrice: entry.price, price: adjusted, marketTimeAdjustment: -historicDifference };
  });
  return {
    entries: normalized,
    diagnostics: {
      applied: true, method: "shared_stable_meso_premiums_with_period_market_differences",
      period_days: periodDays, reference_sale_at: new Date(latest).toISOString(),
      periods: periods.map((period) => ({ age_period: period, sales: counts.get(period) })),
      adjusted_sales: adjustedCount, unsupported_sales: unsupportedCount,
      stable_components: STABLE_MARKET_COMPONENTS,
      moving_components: ["base", "starforce", "potential_grade", "potential_options", "additional_grade", "additional_options"],
    },
  };
}
