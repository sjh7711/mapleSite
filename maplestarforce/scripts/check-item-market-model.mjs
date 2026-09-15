import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  estimateItemMarketValue,
  extractCanonicalMarketTrainingFeatures,
  fitItemMarketModel,
} from "../src/shared/item-market-estimator.js";

const ROOT = resolve(import.meta.dirname, "..");
const MANIFEST_PATH = resolve(ROOT, "public/item-market/manifest.json");
const EPSILON = 1e-9;

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function quantile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function round(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function clone(value) {
  return structuredClone(value);
}

function splitByTime(records) {
  const timed = records
    .map((record) => ({ record, time: Date.parse(record?.sold_at || "") }))
    .filter(({ record, time }) => Number.isFinite(time) && number(record?.price_meso) > 0)
    .sort((left, right) => left.time - right.time || number(left.record.price_meso) - number(right.record.price_meso));
  if (timed.length < 30) return null;
  let split = Math.floor(timed.length * 0.8);
  const minimumTrain = Math.max(20, Math.floor(timed.length * 0.6));
  while (split > minimumTrain && timed[split - 1]?.time === timed[split]?.time) split -= 1;
  if (split < 20 || timed.length - split < 6) return null;
  return {
    training: timed.slice(0, split).map(({ record }) => record),
    holdout: timed.slice(split).map(({ record }) => record),
  };
}

function predictDirect(record, model) {
  const features = extractCanonicalMarketTrainingFeatures(record);
  let predictedLog = model.fitted.intercept;
  for (const [key, coefficient] of Object.entries(model.fitted.coefficients)) {
    predictedLog += (number(features.vector[key]) || 0) * coefficient;
  }
  return Math.exp(predictedLog);
}

function validationMetrics(rows) {
  const ratios = rows.map(({ prediction, actual }) => prediction / actual);
  const absolutePercentErrors = ratios.map((ratio) => Math.abs(ratio - 1));
  return {
    median_prediction_ratio: round(quantile(ratios, 0.5)),
    median_absolute_percent_error: round(quantile(absolutePercentErrors, 0.5)),
    p80_absolute_percent_error: round(quantile(absolutePercentErrors, 0.8)),
    within_25_percent: round(absolutePercentErrors.filter((value) => value <= 0.25).length / rows.length),
    within_factor_2: round(ratios.filter((value) => value >= 0.5 && value <= 2).length / rows.length),
  };
}

// 최종 추정기는 로컬 앵커와 구성요소 하한까지 다시 계산하므로 거래마다
// 비용이 크다. 각 장비의 홀드아웃 시작~끝을 균등하게 다섯 점 확인해
// 시간대 한쪽에 치우치지 않으면서 전체 점검 시간을 제한한다.
function evenlySpacedSample(values, maximum = 5) {
  if (values.length <= maximum) return values;
  return Array.from({ length: maximum }, (_, index) =>
    values[Math.round(index * (values.length - 1) / (maximum - 1))]);
}

const PROFILES = [
  { name: "STR", mainStat: "STR", subStats: ["DEX"], attackType: "attack" },
  { name: "DEX", mainStat: "DEX", subStats: ["STR"], attackType: "attack" },
  { name: "INT", mainStat: "INT", subStats: ["LUK"], attackType: "magic" },
  { name: "LUK", mainStat: "LUK", subStats: ["DEX", "STR"], attackType: "attack" },
  {
    name: "XENON",
    mainStat: "ALL",
    subStats: [],
    attackType: "attack",
    statModel: "xenon",
    statEquivalence: {
      flatStatToFlatMainStatByStat: { STR: 1, DEX: 1, INT: 0, LUK: 1 },
      statPercentToMainPercentByStat: { STR: 1, DEX: 1, INT: 0, LUK: 1 },
      allStatPercentToMainPercent: 2.475,
    },
  },
];

function extremeTarget(record) {
  const target = clone(record);
  const item = target.item;
  item.starforce = { value: 25, applicable: true };
  item.potential = {
    grade: "legendary",
    lines: [
      { code: "ALL_STAT", value: 60, unit: "pct" },
      { code: "BOSS_DAMAGE", value: 100, unit: "pct" },
      { code: "CRITICAL_DAMAGE", value: 50, unit: "pct" },
    ],
  };
  item.additional_potential = {
    grade: "legendary",
    lines: [
      { code: "ALL_STAT", value: 40, unit: "pct" },
      { code: "ATTACK", value: 100, unit: "pct" },
      { code: "BOSS_DAMAGE", value: 100, unit: "pct" },
    ],
  };
  item.upgrade = { applied: 20, remaining: 0, recoverable: 0 };
  item.stats = item.stats || {};
  item.stats.scroll = {
    str_flat: 1000,
    dex_flat: 1000,
    int_flat: 1000,
    luk_flat: 1000,
    attack_flat: 1000,
    magic_attack_flat: 1000,
  };
  item.stats.flame = {
    str_flat: 1000,
    dex_flat: 1000,
    int_flat: 1000,
    luk_flat: 1000,
    all_stat_pct: 100,
    attack_flat: 500,
    magic_attack_flat: 500,
  };
  item.required_level_reduction = 100;
  item.trade = { state: "tradable", scissors_remaining: 10, scissors_total: 10 };
  return target;
}

const manifest = await readJson(MANIFEST_PATH);
const releaseRoot = resolve(ROOT, "public/item-market", `releases/${manifest.dataset_version}`);
const catalog = await readJson(resolve(releaseRoot, "catalog.json"));
const itemReports = [];

for (const catalogItem of catalog.items) {
  const shard = await readJson(resolve(releaseRoot, catalogItem.file.replace(/^items\//u, "items/")));
  const records = shard.records || [];
  const split = splitByTime(records);
  const target = records[Math.floor(records.length / 2)] || null;
  const report = {
    item_name: catalogItem.name,
    records: records.length,
    temporal: null,
    decomposition: null,
    profile_invariance: null,
    extreme: null,
  };

  if (split) {
    const model = fitItemMarketModel({
      itemName: catalogItem.name,
      category: target?.item?.category || null,
      comparables: split.training,
      asOf: split.training.at(-1)?.sold_at,
    });
    const predictions = split.holdout.map((record) => ({
      prediction: predictDirect(record, model),
      actual: number(record.price_meso),
    }));
    const estimatorSample = evenlySpacedSample(split.holdout);
    const estimatorPredictions = estimatorSample.map((record) => ({
      prediction: estimateItemMarketValue({
        target: record,
        fittedModel: model,
        profile: PROFILES[0],
      }).estimate_meso,
      actual: number(record.price_meso),
    }));
    report.temporal = {
      train_count: split.training.length,
      holdout_count: split.holdout.length,
      ...validationMetrics(predictions),
      deployed_estimator: {
        evaluated_count: estimatorPredictions.length,
        ...validationMetrics(estimatorPredictions),
      },
    };
  }

  if (target) {
    const model = fitItemMarketModel({
      itemName: catalogItem.name,
      category: target.item?.category || null,
      comparables: records,
    });
    const estimates = PROFILES.map((profile) => estimateItemMarketValue({
      target,
      fittedModel: model,
      profile,
    }));
    const reference = estimates[0];
    const componentSum = reference.component_order.reduce(
      (sum, key) => sum + reference.components[key].contribution_meso,
      0,
    );
    report.decomposition = {
      estimate_meso: reference.estimate_meso,
      component_sum_meso: componentSum,
      exact_sum: componentSum === reference.estimate_meso,
      unidentified_nonzero_components: reference.component_order.filter((key) =>
        reference.components[key].contribution_meso !== 0 && !reference.components[key].identifiable
      ),
    };
    const profilePrices = Object.fromEntries(estimates.map((estimate, index) => [
      PROFILES[index].name,
      estimate.estimate_meso,
    ]));
    const values = Object.values(profilePrices);
    report.profile_invariance = {
      prices_meso: profilePrices,
      maximum_relative_delta: round((Math.max(...values) - Math.min(...values)) / Math.max(...values), 12),
      invariant: Math.max(...values) - Math.min(...values) <= Math.max(...values) * EPSILON,
    };

    const extreme = estimateItemMarketValue({ target: extremeTarget(target), fittedModel: model });
    report.extreme = {
      estimate_meso: extreme.estimate_meso,
      finite: Number.isSafeInteger(extreme.estimate_meso),
      extrapolated_components: extreme.diagnostics.extrapolated_components,
      has_extrapolation_warning: extreme.warnings.some((warning) => warning.code === "component_extrapolated"),
    };
  }
  itemReports.push(report);
}

const temporalReports = itemReports.filter((report) => report.temporal);
const aggregateHoldoutCount = temporalReports.reduce((sum, report) => sum + report.temporal.holdout_count, 0);
const summary = {
  schema_version: "maplestarforce.item-market.model-check.v1",
  dataset_version: manifest.dataset_version,
  item_count: itemReports.length,
  temporal_item_count: temporalReports.length,
  temporal_holdout_count: aggregateHoldoutCount,
  median_item_mape: round(quantile(
    temporalReports.map((report) => report.temporal.median_absolute_percent_error),
    0.5,
  )),
  median_item_within_25_percent: round(quantile(
    temporalReports.map((report) => report.temporal.within_25_percent),
    0.5,
  )),
  median_estimator_mape: round(quantile(
    temporalReports.map((report) =>
      report.temporal.deployed_estimator.median_absolute_percent_error),
    0.5,
  )),
  median_estimator_within_25_percent: round(quantile(
    temporalReports.map((report) =>
      report.temporal.deployed_estimator.within_25_percent),
    0.5,
  )),
  exact_component_sum_items: itemReports.filter((report) => report.decomposition?.exact_sum).length,
  profile_invariant_items: itemReports.filter((report) => report.profile_invariance?.invariant).length,
  finite_extreme_items: itemReports.filter((report) => report.extreme?.finite).length,
  extrapolation_warned_items: itemReports.filter((report) => report.extreme?.has_extrapolation_warning).length,
};

console.log(JSON.stringify(
  process.argv.includes("--summary") ? { summary } : { summary, items: itemReports },
  null,
  2,
));
