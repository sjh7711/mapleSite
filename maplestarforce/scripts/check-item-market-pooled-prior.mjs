import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  extractCanonicalMarketTrainingFeatures,
  fitItemMarketModel,
} from "../src/shared/item-market-estimator.js";

const ROOT = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(await readFile(resolve(ROOT, "public/item-market/manifest.json"), "utf8"));
const releaseRoot = resolve(ROOT, "public/item-market/releases", manifest.dataset_version);
const catalog = JSON.parse(await readFile(resolve(releaseRoot, "catalog.json"), "utf8"));
const SIGNED_FEATURES = new Set(["scroll_applied", "scroll_recoverable", "trade_one_left"]);

function quantile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function splitByTime(itemName, records) {
  const rows = records
    .map((record) => ({
      itemName,
      record,
      soldTime: Date.parse(record.sold_at || ""),
      price: Number(record.price_meso),
      features: extractCanonicalMarketTrainingFeatures(record),
    }))
    .filter((row) => Number.isFinite(row.soldTime) && row.price > 0)
    .sort((left, right) => left.soldTime - right.soldTime || left.price - right.price);
  let split = Math.floor(rows.length * 0.8);
  const minimumTrain = Math.max(20, Math.floor(rows.length * 0.6));
  while (split > minimumTrain && rows[split - 1]?.soldTime === rows[split]?.soldTime) split -= 1;
  return { training: rows.slice(0, split), holdout: rows.slice(split) };
}

function robustScale(values) {
  const iqr = (quantile(values, 0.75) - quantile(values, 0.25)) / 1.349;
  return Math.max(Number.isFinite(iqr) && iqr > 0 ? iqr : quantile(values.map(Math.abs), 0.5) || 1, 1e-6);
}

function fitPooled(rows, featureKeys, lambda = 30) {
  const itemNames = [...new Set(rows.map((row) => row.itemName))];
  const scales = Object.fromEntries(featureKeys.map((key) => [
    key,
    robustScale(rows.map((row) => Number(row.features.vector[key]) || 0)),
  ]));
  const matrix = rows.map((row) => featureKeys.map((key) => (Number(row.features.vector[key]) || 0) / scales[key]));
  const y = rows.map((row) => Math.log(row.price));
  const coefficients = featureKeys.map(() => 0);
  const intercepts = Object.fromEntries(itemNames.map((itemName) => [
    itemName,
    quantile(rows.filter((row) => row.itemName === itemName).map((row) => Math.log(row.price)), 0.5),
  ]));
  const baseWeights = rows.map(() => 1);
  let weights = [...baseWeights];
  const predictions = rows.map((row) => intercepts[row.itemName]);

  for (let robustRound = 0; robustRound < 4; robustRound += 1) {
    for (let iteration = 0; iteration < 300; iteration += 1) {
      let maximumChange = 0;
      for (const itemName of itemNames) {
        let numerator = 0;
        let denominator = 0;
        for (let row = 0; row < rows.length; row += 1) {
          if (rows[row].itemName !== itemName) continue;
          numerator += weights[row] * (y[row] - predictions[row]);
          denominator += weights[row];
        }
        const delta = denominator > 0 ? numerator / denominator : 0;
        intercepts[itemName] += delta;
        maximumChange = Math.max(maximumChange, Math.abs(delta));
        for (let row = 0; row < rows.length; row += 1) {
          if (rows[row].itemName === itemName) predictions[row] += delta;
        }
      }
      for (let column = 0; column < featureKeys.length; column += 1) {
        const previous = coefficients[column];
        let numerator = 0;
        let denominator = lambda;
        for (let row = 0; row < rows.length; row += 1) {
          const x = matrix[row][column];
          if (x === 0) continue;
          numerator += weights[row] * x * (y[row] - predictions[row] + x * previous);
          denominator += weights[row] * x * x;
        }
        const raw = numerator / Math.max(denominator, 1e-12);
        const next = SIGNED_FEATURES.has(featureKeys[column]) ? raw : Math.max(0, raw);
        const delta = next - previous;
        coefficients[column] = next;
        maximumChange = Math.max(maximumChange, Math.abs(delta));
        for (let row = 0; row < rows.length; row += 1) predictions[row] += matrix[row][column] * delta;
      }
      if (maximumChange < 1e-7) break;
    }
    const residuals = y.map((value, index) => value - predictions[index]);
    const median = quantile(residuals, 0.5) || 0;
    const mad = quantile(residuals.map((value) => Math.abs(value - median)), 0.5) || 0;
    const sigma = Math.max(0.06, mad * 1.4826);
    weights = baseWeights.map((weight, index) => {
      const ratio = Math.abs(residuals[index] - median) / (1.5 * sigma);
      return weight * (ratio <= 1 ? 1 : 1 / ratio);
    });
  }
  return {
    intercepts,
    coefficients: Object.fromEntries(featureKeys.map((key, index) => [key, coefficients[index] / scales[key]])),
  };
}

function predict(features, intercept, coefficients) {
  return Math.exp(Object.entries(coefficients).reduce(
    (sum, [key, coefficient]) => sum + (Number(features.vector[key]) || 0) * coefficient,
    intercept,
  ));
}

function metrics(rows) {
  const errors = rows.map((row) => Math.abs(row.prediction / row.actual - 1));
  return {
    count: rows.length,
    median_absolute_percent_error: Number(quantile(errors, 0.5).toFixed(3)),
    p80_absolute_percent_error: Number(quantile(errors, 0.8).toFixed(3)),
    within_25_percent: Number((errors.filter((value) => value <= 0.25).length / errors.length).toFixed(3)),
  };
}

const splits = [];
for (const entry of catalog.items) {
  const shard = JSON.parse(await readFile(resolve(releaseRoot, entry.file), "utf8"));
  splits.push({ itemName: entry.name, ...splitByTime(entry.name, shard.records || []) });
}
const training = splits.flatMap((entry) => entry.training);
const holdout = splits.flatMap((entry) => entry.holdout);
const featureKeys = Object.keys(training[0].features.vector);
const pooled = fitPooled(training, featureKeys);
const localModels = Object.fromEntries(splits.map((entry) => [
  entry.itemName,
  fitItemMarketModel({
    itemName: entry.itemName,
    comparables: entry.training.map((row) => row.record),
  }),
]));

const BLENDS = [0.01, 0.025, 0.05, 0.1];
const predictions = {
  local: [],
  pooled: [],
  zero_fallback: [],
  ...Object.fromEntries(BLENDS.map((ratio) => [`blend_${ratio}`, []])),
};
const perItem = [];
for (const split of splits) {
  const local = localModels[split.itemName];
  if (local.status !== "fitted") {
    perItem.push({
      item_name: split.itemName,
      skipped: true,
      reason: local.status,
      training_count: split.training.length,
      holdout_count: split.holdout.length,
    });
    continue;
  }
  const fallbackCoefficients = Object.fromEntries(featureKeys.map((key) => [
    key,
    Math.abs(local.fitted.coefficients[key] || 0) < 1e-10
      ? pooled.coefficients[key]
      : local.fitted.coefficients[key],
  ]));
  const blended = Object.fromEntries(BLENDS.map((ratio) => {
    const coefficients = Object.fromEntries(featureKeys.map((key) => [
      key,
      (1 - ratio) * (local.fitted.coefficients[key] || 0) + ratio * (pooled.coefficients[key] || 0),
    ]));
    const centeredLogs = split.training.map((row) => {
      const featureEffect = Object.entries(coefficients).reduce(
        (sum, [key, coefficient]) => sum + (Number(row.features.vector[key]) || 0) * coefficient,
        0,
      );
      return Math.log(row.price) - featureEffect;
    });
    return [ratio, { coefficients, intercept: quantile(centeredLogs, 0.5) }];
  }));
  const itemRows = {
    local: [],
    pooled: [],
    zero_fallback: [],
    ...Object.fromEntries(BLENDS.map((ratio) => [`blend_${ratio}`, []])),
  };
  for (const row of split.holdout) {
    const actual = row.price;
    const localPrediction = predict(row.features, local.fitted.intercept, local.fitted.coefficients);
    const pooledPrediction = predict(row.features, pooled.intercepts[split.itemName], pooled.coefficients);
    const fallbackPrediction = predict(row.features, local.fitted.intercept, fallbackCoefficients);
    const choices = [
      ["local", localPrediction],
      ["pooled", pooledPrediction],
      ["zero_fallback", fallbackPrediction],
      ...BLENDS.map((ratio) => [
        `blend_${ratio}`,
        predict(row.features, blended[ratio].intercept, blended[ratio].coefficients),
      ]),
    ];
    for (const [key, prediction] of choices) {
      const result = { itemName: split.itemName, actual, prediction };
      predictions[key].push(result);
      itemRows[key].push(result);
    }
  }
  const zeroLocalFeatures = featureKeys.filter((key) => Math.abs(local.fitted.coefficients[key] || 0) < 1e-10);
  perItem.push({
    item_name: split.itemName,
    local: metrics(itemRows.local),
    pooled: metrics(itemRows.pooled),
    zero_fallback: metrics(itemRows.zero_fallback),
    blends: Object.fromEntries(BLENDS.map((ratio) => [
      ratio,
      metrics(itemRows[`blend_${ratio}`]),
    ])),
    zero_local_features: zeroLocalFeatures,
  });
}

console.log(JSON.stringify({
  schema_version: "maplestarforce.item-market.pooled-prior-check.v1",
  dataset_version: manifest.dataset_version,
  aggregate: Object.fromEntries(Object.entries(predictions).map(([key, rows]) => [key, metrics(rows)])),
  pooled_coefficients: pooled.coefficients,
  items_improved_by_pooled: perItem.filter((row) =>
    !row.skipped &&
    row.pooled.median_absolute_percent_error < row.local.median_absolute_percent_error
  ).length,
  items_improved_by_zero_fallback: perItem.filter((row) =>
    !row.skipped &&
    row.zero_fallback.median_absolute_percent_error < row.local.median_absolute_percent_error
  ).length,
  items: perItem,
}, null, 2));
