import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile, rename, cp, stat, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CONFIG_PATH = process.env.MAPLE_MARKET_SYNC_CONFIG || "/home/ubuntu/.config/maple-market-sync/config.json";
const HASH = /^[a-f0-9]{64}$/u;
const VERSION = /^[a-f0-9]{20}$/u;
const stamp = () => new Date().toISOString();
const log = (event) => console.log(JSON.stringify({ at: stamp(), ...event }));

export async function readJson(file, fallback = null) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return fallback; throw error; }
}
export async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(temporary, file);
}
async function filesBelow(root) {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const result = [];
  for (const entry of entries) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(file));
    else if (entry.isFile()) result.push(file);
  }
  return result;
}

export async function captureInventory(config) {
  const current = await readJson(path.join(config.privateRoot, "current.json"), {});
  const state = await readJson(path.join(config.stateRoot, "status.json"), {});
  const applied = new Set((current.sources || []).map((source) => source.sha256));
  const quarantined = new Set(state.quarantined_source_hashes || []);
  const received = new Set((await filesBelow(path.join(config.rawRoot, "incoming")))
    .filter((file) => file.endsWith(".jsonl"))
    .map((file) => path.basename(file, ".jsonl")).filter((hash) => HASH.test(hash)));
  const unapplied = [...received].filter((hash) => !applied.has(hash));
  const pending = unapplied.filter((hash) => !quarantined.has(hash)).sort();
  return { received_files: received.size, pending_files: pending.length,
    quarantined_files: unapplied.length - pending.length,
    fingerprint: createHash("sha256").update(pending.join("\n")).digest("hex"),
    dataset_version: current.dataset_version || null };
}
export function shouldRefresh({ inventory, state, manual = false, threshold = 500, now = Date.now() }) {
  if (manual) return true;
  if (Number(state.retry_after) > now) return false;
  if (state.pending_publication) return true;
  return inventory.pending_files >= threshold && inventory.fingerprint !== state.last_examined_fingerprint;
}

async function command(config, name, executable, args, cwd, timeoutMs = 45 * 60_000) {
  const logFile = path.join(config.stateRoot, "logs", `${Date.now()}-${name}.log`);
  await mkdir(path.dirname(logFile), { recursive: true });
  const { open } = await import("node:fs/promises");
  const output = await open(logFile, "a", 0o600);
  const child = spawn(executable, args, { cwd, env: { ...process.env, CI: "true" },
    stdio: ["ignore", output.fd, output.fd], detached: true });
  let timedOut = false;
  const terminate = () => { try { process.kill(-child.pid, "SIGKILL"); } catch {} };
  const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
  try {
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => code === 0 ? resolve() :
        reject(new Error(`${name} 실패 (${timedOut ? "시간 초과" : signal || code}). 로그: ${logFile}`)));
    });
  } finally { clearTimeout(timer); await output.close(); }
  return logFile;
}

export async function prepareDataBundle(config, modelReport, history = []) {
  const manifest = await readJson(path.join(config.publicRoot, "manifest.json"));
  if (modelReport.dataset_version !== manifest.dataset_version) throw new Error("시세와 모델 검증 버전 불일치");
  const policy = { schema_version: modelReport.schema_version, estimator_version: modelReport.estimator_version,
    defaults: { halfLifeDays: 7, periodDays: 7, ridge: 2 },
    items: Object.fromEntries(modelReport.reports.map((item) => [item.item_name, { options: item.options }])) };
  const bundle = path.join(config.stateRoot, "bundles", `${manifest.dataset_version}-${Date.now()}`);
  await mkdir(bundle, { recursive: true, mode: 0o700 });
  const versions = [...new Set([manifest.dataset_version, ...history])].filter((v) => VERSION.test(v)).slice(0, 7);
  for (const version of versions) {
    const source = path.join(config.publicRoot, "releases", version);
    try { await stat(source); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    await cp(source, path.join(bundle, "releases", version), { recursive: true });
  }
  manifest.model = { ...manifest.model, estimator_policy: policy };
  await writeFile(path.join(bundle, "manifest.json"), JSON.stringify(manifest) + "\n");
  await writeFile(path.join(bundle, "_headers"), `/*\n  Access-Control-Allow-Origin: *\n  X-Robots-Tag: noindex, nofollow\n/manifest.json\n  Cache-Control: no-store\n/releases/*\n  Cache-Control: public, max-age=31536000, immutable\n`);
  await writeFile(path.join(bundle, "404.html"), "<!doctype html><title>Not found</title>Not found");
  await writeFile(path.join(bundle, "index.html"), "<!doctype html><meta name=robots content=noindex><title>Market data</title>Market data");
  const files = await filesBelow(bundle);
  if (files.length > 20_000) throw new Error("시세 배포 파일 수 한도 초과");
  for (const file of files) if ((await stat(file)).size > 25 * 1024 * 1024) throw new Error(`시세 파일 크기 한도 초과: ${path.basename(file)}`);
  return { bundle, manifest, versions };
}

async function refreshAndPublish(config, state, persist) {
  state.phase = "normalizing";
  // Durable before modifying local pointers; restart retries an interrupted publication.
  state.pending_publication = true;
  await persist();
  const refreshLog = await command(config, "refresh", process.execPath,
    ["--max-old-space-size=4096", path.join(ROOT, "scripts/refresh-item-market-data.mjs"),
      "--defer-invalid-chains", "--raw-dir", config.rawRoot, "--private-dir", config.privateRoot, "--public-dir", config.publicRoot], ROOT);
  const refreshed = JSON.parse(await readFile(refreshLog, "utf8"));
  state.quarantined_source_hashes = [...new Set((refreshed.quarantined_chains || []).flatMap((chain) => chain.source_hashes))];
  state.validation_log = refreshLog;
  state.refresh = { newly_eligible_files: refreshed.newly_eligible_files,
    reused_validated_files: refreshed.reused_validated_files, unique_sales: refreshed.unique_sales,
    pending_chains: refreshed.pending_chains?.length || 0,
    quarantined_chains: refreshed.quarantined_chains?.length || 0,
    quarantined_files: state.quarantined_source_hashes.length };
  if (state.trigger === "threshold" && refreshed.dataset_version === state.published_dataset_version &&
      refreshed.newly_eligible_files === 0) {
    state.pending_publication = false;
    return;
  }
  state.phase = "model_validation";
  await persist();
  const reportPath = path.join(config.stateRoot, "reports", `${refreshed.dataset_version}-model.json`);
  await command(config, "model", process.execPath,
    ["--max-old-space-size=4096", path.join(ROOT, "scripts/tune-item-market-model.mjs"), reportPath], ROOT);
  const modelReport = await readJson(reportPath);
  const prepared = await prepareDataBundle(config, modelReport, state.published_history || []);
  state.phase = "publishing";
  state.model_report = reportPath;
  await persist();
  const deployLog = await command(config, "deploy", process.execPath,
    [path.join(ROOT, "node_modules/wrangler/bin/wrangler.js"), "pages", "deploy", prepared.bundle,
      "--project-name", config.project, "--branch", "main", "--commit-dirty=true"], prepared.bundle, 15 * 60_000);
  const deployment = (await readFile(deployLog, "utf8")).match(/https:\/\/[a-f0-9]+\.[a-z0-9-]+\.pages\.dev/u)?.[0];
  if (!deployment) throw new Error(`배포 완료 주소 확인 실패. 로그: ${deployLog}`);
  state.published_dataset_version = prepared.manifest.dataset_version;
  state.published_history = prepared.versions;
  state.deployment = deployment;
  state.model_summary = modelReport.summary;
  state.published_at = stamp();
  state.pending_publication = false;
  // Keep the current bundle and last failed build for diagnosis without unbounded disk growth.
  const bundles = (await readdir(path.join(config.stateRoot, "bundles"))).sort().reverse();
  for (const old of bundles.filter((name) => name !== path.basename(prepared.bundle)).slice(1)) {
    await rm(path.join(config.stateRoot, "bundles", old), { recursive: true });
  }
  log({ event: "published", dataset: state.published_dataset_version, ...state.refresh, model: state.model_summary });
}

export async function serviceTick(config, action = refreshAndPublish) {
  const stateFile = path.join(config.stateRoot, "status.json");
  const state = await readJson(stateFile, {});
  const inventory = await captureInventory(config);
  const requests = (await filesBelow(path.join(config.stateRoot, "requests"))).filter((file) => file.endsWith(".request.json"));
  state.inventory = inventory;
  state.checked_at = stamp();
  const persist = () => atomicJson(stateFile, state);
  if (!shouldRefresh({ inventory, state, manual: requests.length > 0, threshold: config.threshold })) {
    if (!state.pending_publication) state.phase = "waiting";
    await persist(); return { ran: false, state };
  }
  state.started_at = stamp();
  state.trigger = requests.length ? "manual" : state.pending_publication ? "retry" : "threshold";
  await persist();
  log({ event: "refresh_started", trigger: state.trigger, pending_files: inventory.pending_files });
  try {
    await action(config, state, persist);
    state.phase = "waiting";
    // Files arriving during this run were not necessarily part of its scan.
    // Leave their changed fingerprint eligible for the next threshold check.
    state.last_examined_fingerprint = inventory.fingerprint;
    state.last_error = null;
    state.failures = 0;
    state.retry_after = 0;
    state.finished_at = stamp();
    await persist();
    for (const request of requests) {
      await atomicJson(request.replace(/\.request\.json$/u, ".result.json"),
        { ok: true, finished_at: state.finished_at, dataset_version: state.published_dataset_version, deployment: state.deployment });
      await rm(request);
    }
    return { ran: true, ok: true, state };
  } catch (error) {
    state.phase = "failed";
    state.last_error = error.message;
    state.failures = (state.failures || 0) + 1;
    state.retry_after = Date.now() + Math.min(15 * 60_000, 60_000 * 2 ** Math.min(state.failures, 4));
    await persist();
    // Consume failed manual triggers; the durable pending publication retries
    // with backoff, while the caller gets a concrete failure instead of hanging.
    for (const request of requests) {
      await atomicJson(request.replace(/\.request\.json$/u, ".result.json"), { ok: false, error: error.message });
      await rm(request);
    }
    log({ event: "refresh_failed", error: error.message, retry_after: new Date(state.retry_after).toISOString() });
    return { ran: true, ok: false, state };
  }
}

async function main() {
  const config = await readJson(CONFIG_PATH);
  if (!config || config.threshold !== 500 || !/^[a-z0-9-]+$/u.test(config.project || "")) {
    throw new Error(`유효한 설정이 필요합니다: ${CONFIG_PATH}`);
  }
  const commandName = process.argv[2] || "status";
  await mkdir(config.stateRoot, { recursive: true, mode: 0o700 });
  if (commandName === "status") {
    console.log(JSON.stringify({ ...(await readJson(path.join(config.stateRoot, "status.json"), {})),
      inventory: await captureInventory(config), threshold: config.threshold }, null, 2));
  } else if (commandName === "refresh") {
    const id = randomUUID();
    const request = path.join(config.stateRoot, "requests", `${id}.request.json`);
    await atomicJson(request, { id, requested_at: stamp() });
    console.log(`수동 갱신 요청: ${id} (파일 수와 무관하게 다음 점검에서 실행)`);
    if (process.argv.includes("--wait")) {
      const until = Date.now() + 3 * 60 * 60_000;
      while (Date.now() < until) {
        const result = await readJson(request.replace(/\.request\.json$/u, ".result.json"));
        if (result) { console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1; return; }
        await delay(2000);
      }
      throw new Error("대기 시간 초과. maple-market status로 진행 상태를 확인하세요.");
    }
  } else if (commandName === "daemon") {
    log({ event: "service_ready", threshold: config.threshold, poll_seconds: config.pollSeconds });
    while (true) { await serviceTick(config); await delay(config.pollSeconds * 1000); }
  } else throw new Error("사용법: maple-market status | refresh [--wait]");
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { log({ event: "fatal", error: error.message }); process.exitCode = 1; });
}
