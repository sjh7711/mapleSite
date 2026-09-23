import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ITEM_MARKET_ESTIMATOR_VERSION, fitItemMarketModel, extractCanonicalMarketTrainingFeatures,
  estimateItemMarketValue } from "../src/shared/item-market-estimator.js";

export const POLICY_VERSION = "market-recency-policy.v1";
export const DEFAULT_OPTIONS = Object.freeze({ halfLifeDays: 7, periodDays: 7, ridge: 2 });
const LEGACY_OPTIONS = Object.freeze({ halfLifeDays: 30, periodDays: 30, ridge: 2 });
const CANDIDATES = [3, 7, 14].map((halfLifeDays) => ({ ...DEFAULT_OPTIONS, halfLifeDays }));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const q = (values, percentile) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentile))];
};
export function splitMarketValidation(records) {
  const rows = records.filter((row) => Date.parse(row.sold_at) > 0 && Number(row.price_meso) > 0)
    .sort((a, b) => Date.parse(a.sold_at) - Date.parse(b.sold_at));
  if (rows.length < 60) return null;
  let cut = Math.floor(rows.length * 0.8);
  while (cut > 0 && rows[cut - 1].sold_at === rows[cut]?.sold_at) cut -= 1;
  if (cut < 40 || rows.length - cut < 10) return null;
  return { training: rows.slice(0, cut), audit: rows.slice(cut) };
}
function metrics(rows) {
  return { count: rows.length,
    median_absolute_percent_error: q(rows.map((r) => Math.abs(r.ratio - 1)), 0.5),
    p80_absolute_percent_error: q(rows.map((r) => Math.abs(r.ratio - 1)), 0.8),
    median_absolute_log_error: q(rows.map((r) => Math.abs(Math.log(r.ratio))), 0.5),
    within_25_percent: rows.length ? rows.filter((r) => Math.abs(r.ratio - 1) <= 0.25).length / rows.length : null,
  };
}
function predictCore(features, model) {
  return Math.exp(model.fitted.intercept + Object.entries(model.fitted.coefficients)
    .reduce((sum, [key, value]) => sum + value * (features.vector[key] || 0), 0));
}
export function selectRecencyCandidate(candidates) {
  const supported = candidates.filter((c) => c.validation?.available &&
    Number.isFinite(c.validation.median_absolute_log_error));
  supported.sort((a, b) => a.validation.median_absolute_log_error - b.validation.median_absolute_log_error ||
    Math.abs(a.options.halfLifeDays - 7) - Math.abs(b.options.halfLifeDays - 7));
  return supported[0] || candidates.find((c) => c.options.halfLifeDays === 7);
}
async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(value) + "\n");
  await rename(temp, file);
}

/** Inner chronological validation selects parameters; a later slice audits them.
 * Unchanged item histories reuse their exact hash-keyed report, not a new fit.
 */
export async function tuneItemMarketModel({ publicRoot, cacheRoot, reportPath, onProgress = () => {} }) {
  const manifest = await readJson(path.join(publicRoot, "manifest.json"));
  const catalogPath = path.join(publicRoot, manifest.catalog.file);
  const catalog = await readJson(catalogPath);
  const reports = [];
  let reused = 0;
  for (const [index, item] of catalog.items.entries()) {
    const shard = await readJson(path.resolve(path.dirname(catalogPath), item.file));
    const sourceDigest = hash(JSON.stringify(shard.records));
    const fingerprint = hash(JSON.stringify([POLICY_VERSION, ITEM_MARKET_ESTIMATOR_VERSION, sourceDigest]));
    const cacheFile = path.join(cacheRoot, `${fingerprint}.json`);
    let cached = null;
    try { cached = await readJson(cacheFile); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (cached) { reports.push(cached); reused += 1; continue; }
    const report = { item_name: item.name, source_digest: sourceDigest, records: shard.records.length,
      options: { ...DEFAULT_OPTIONS }, validation: null, selection: "insufficient_history" };
    const split = splitMarketValidation(shard.records);
    if (split) {
      const fit = (options) => fitItemMarketModel({ itemName: item.name,
        category: split.training[0].item?.category, comparables: split.training, ...options });
      const candidates = CANDIDATES.map((options) => {
        const model = fit(options); return { options, model, validation: model.validation };
      });
      const winner = selectRecencyCandidate(candidates);
      const baseline = fit(LEGACY_OPTIONS);
      const audit = split.audit.map((row) => {
        const features = extractCanonicalMarketTrainingFeatures(row);
        const actual = Number(row.price_meso);
        return { candidate: { ratio: predictCore(features, winner.model) / actual },
          baseline: { ratio: predictCore(features, baseline) / actual } };
      });
      const candidateMetrics = metrics(audit.map((r) => r.candidate));
      const baselineMetrics = metrics(audit.map((r) => r.baseline));
      // A material regression retains the known baseline. Report pre-gate
      // candidate errors as well so the promotion decision cannot hide them.
      const accepted = candidateMetrics.median_absolute_log_error <=
        baselineMetrics.median_absolute_log_error * 1.1 + 0.01 &&
        candidateMetrics.p80_absolute_percent_error <= baselineMetrics.p80_absolute_percent_error * 1.15 + 0.03;
      report.options = { ...(accepted ? winner.options : LEGACY_OPTIONS) };
      report.selection = accepted ? "validated_recent_market" : "baseline_retained_after_audit";
      const selectedModel = accepted ? winner.model : baseline;
      const sample = Array.from(new Set([0, Math.floor(split.audit.length / 2), split.audit.length - 1]))
        .map((i) => split.audit[i]);
      const finalEstimates = sample.map((row) => {
        const result = estimateItemMarketValue({ target: row, fittedModel: selectedModel });
        const sum = Object.values(result.components).reduce((total, c) => total + c.contribution_meso, 0);
        if (!(result.estimate_meso > 0) || !Number.isFinite(result.estimate_meso) || sum !== result.estimate_meso) {
          throw new Error(`추정가·구성요소 합계 검증 실패: ${item.name}`);
        }
        return { ratio: result.estimate_meso / Number(row.price_meso) };
      });
      report.validation = { training_count: split.training.length, audit_count: split.audit.length,
        training_through: split.training.at(-1).sold_at, audit_from: split.audit[0].sold_at,
        candidate: candidateMetrics, baseline: baselineMetrics,
        deployed_estimator_sample: metrics(finalEstimates),
        candidates: candidates.map((c) => ({ options: c.options,
          inner_median_log_error: c.validation.median_absolute_log_error ?? null })) };
    }
    await atomicJson(cacheFile, report);
    reports.push(report);
    onProgress({ phase: "model_validation", item: item.name, completed: index + 1, total: catalog.items.length,
      selection: report.selection, half_life_days: report.options.halfLifeDays });
  }
  const evaluated = reports.filter((r) => r.validation);
  const summary = { items: reports.length, reused_items: reused, evaluated_items: evaluated.length,
    recency_policy_items: reports.filter((r) => r.options.halfLifeDays < 30).length,
    baseline_retained_items: reports.filter((r) => r.options.halfLifeDays === 30).length,
    candidate_macro_median_error: q(evaluated.map((r) => r.validation.candidate.median_absolute_percent_error), 0.5),
    baseline_macro_median_error: q(evaluated.map((r) => r.validation.baseline.median_absolute_percent_error), 0.5),
    deployed_macro_median_error: q(evaluated.map((r) => r.validation[r.options.halfLifeDays < 30 ? "candidate" : "baseline"].median_absolute_percent_error), 0.5) };
  const result = { schema_version: POLICY_VERSION, estimator_version: ITEM_MARKET_ESTIMATOR_VERSION,
    dataset_version: manifest.dataset_version, generated_at: new Date().toISOString(), summary, reports };
  if (reportPath) await atomicJson(reportPath, result);
  return { report: result, policy: { schema_version: POLICY_VERSION,
    estimator_version: ITEM_MARKET_ESTIMATOR_VERSION, defaults: DEFAULT_OPTIONS,
    items: Object.fromEntries(reports.map((r) => [r.item_name, { options: r.options }])) } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = path.resolve(import.meta.dirname, "..");
  const result = await tuneItemMarketModel({ publicRoot: path.join(root, "public/item-market"),
    cacheRoot: path.join(root, "tools/item-market-dataset/market-data/model-cache"),
    reportPath: process.argv[2] || path.join(root, "tools/item-market-dataset/market-data/latest-model-report.json"),
    onProgress: (event) => console.log(JSON.stringify(event)) });
  console.log(JSON.stringify(result.report.summary));
}
