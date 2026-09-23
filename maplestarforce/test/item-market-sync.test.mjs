import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { atomicJson, captureInventory, shouldRefresh, serviceTick, readJson, prepareDataBundle }
  from "../tools/item-market-sync/service.mjs";
import { splitMarketValidation, selectRecencyCandidate } from "../scripts/tune-item-market-model.mjs";

const hash = (n) => n.toString(16).padStart(64, "0");
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "market-sync-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = { rawRoot: path.join(root, "raw"), privateRoot: path.join(root, "private"),
    publicRoot: path.join(root, "public"), stateRoot: path.join(root, "state"), threshold: 500 };
  await mkdir(path.join(config.rawRoot, "incoming/a"), { recursive: true });
  return config;
}
test("자동 실행은 새 파일 500개부터, 중복 폴더·반영한 파일·임시 파일은 제외한다", async (t) => {
  const c = await fixture(t);
  await Promise.all(Array.from({ length: 501 }, (_, i) => writeFile(path.join(c.rawRoot, `incoming/a/${hash(i)}.jsonl`), "{}")));
  await mkdir(path.join(c.rawRoot, "incoming/b"));
  await writeFile(path.join(c.rawRoot, `incoming/b/${hash(1)}.jsonl`), "{}");
  await writeFile(path.join(c.rawRoot, `incoming/a/${hash(600)}.jsonl.tmp`), "{}");
  await atomicJson(path.join(c.privateRoot, "current.json"), { sources: [{ sha256: hash(0) }] });
  let inventory = await captureInventory(c);
  assert.equal(inventory.received_files, 501);
  assert.equal(inventory.pending_files, 500);
  assert.equal(shouldRefresh({ inventory, state: {} }), true);
  await atomicJson(path.join(c.privateRoot, "current.json"), { sources: [{ sha256: hash(0) }, { sha256: hash(1) }] });
  inventory = await captureInventory(c);
  assert.equal(inventory.pending_files, 499);
  assert.equal(shouldRefresh({ inventory, state: {} }), false);
  assert.equal(shouldRefresh({ inventory, state: {}, manual: true }), true);
});
test("동일한 미완료 묶음을 계속 처리하지 않으며 새 파일이 오면 다시 점검한다", () => {
  const inventory = { pending_files: 510, fingerprint: "a" };
  assert.equal(shouldRefresh({ inventory, state: { last_examined_fingerprint: "a" } }), false);
  assert.equal(shouldRefresh({ inventory: { ...inventory, fingerprint: "b" }, state: { last_examined_fingerprint: "a" } }), true);
});
test("이미 격리한 파일은 새 파일 500개 기준에 중복 집계하지 않는다", async (t) => {
  const c = await fixture(t);
  await Promise.all(Array.from({ length: 500 }, (_, i) => writeFile(path.join(c.rawRoot, `incoming/a/${hash(i)}.jsonl`), "{}")));
  await atomicJson(path.join(c.stateRoot, "status.json"), { quarantined_source_hashes: [hash(0), hash(1)] });
  const inventory = await captureInventory(c);
  assert.equal(inventory.pending_files, 498);
  assert.equal(inventory.quarantined_files, 2);
  assert.equal(shouldRefresh({ inventory, state: {} }), false);
  assert.equal(shouldRefresh({ inventory, state: {}, manual: true }), true);
});
test("수동 요청은 0개에서도 실행되며 성공 응답을 남긴다", async (t) => {
  const c = await fixture(t);
  const request = path.join(c.stateRoot, "requests/manual.request.json");
  await atomicJson(request, { id: "manual" });
  const result = await serviceTick(c, async (_config, state) => {
    assert.equal(state.trigger, "manual"); state.published_dataset_version = "test";
  });
  assert.equal(result.ok, true);
  assert.equal((await readJson(request.replace(".request.", ".result."))).dataset_version, "test");
  assert.equal(await readJson(request), null);
});
test("배포 실패·재시작에도 미완료 작업을 보존하고 파일 수와 무관하게 재시도한다", async (t) => {
  const c = await fixture(t);
  await atomicJson(path.join(c.stateRoot, "requests/manual.request.json"), { id: "manual" });
  await serviceTick(c, async (_config, state, save) => {
    state.pending_publication = true; await save(); throw new Error("network failure");
  });
  const saved = await readJson(path.join(c.stateRoot, "status.json"));
  assert.equal(saved.pending_publication, true);
  assert.equal(saved.phase, "failed");
  assert.equal(shouldRefresh({ inventory: { pending_files: 0 }, state: saved }), false);
  assert.equal(shouldRefresh({ inventory: { pending_files: 0 }, state: saved, now: saved.retry_after + 1 }), true);
  saved.retry_after = 0;
  await atomicJson(path.join(c.stateRoot, "status.json"), saved);
  const result = await serviceTick(c, async (_config, state) => {
    state.pending_publication = false; state.published_dataset_version = "retry-success";
  });
  assert.equal(result.ok, true);
  assert.equal(result.state.published_dataset_version, "retry-success");
});
test("갱신 중 도착한 500개 파일을 마지막 점검에 포함시켜 누락하지 않는다", async (t) => {
  const c = await fixture(t);
  await atomicJson(path.join(c.stateRoot, "requests/manual.request.json"), { id: "manual" });
  const first = await captureInventory(c);
  await serviceTick(c, async () => {
    await Promise.all(Array.from({ length: 500 }, (_, i) => writeFile(path.join(c.rawRoot, `incoming/a/${hash(i)}.jsonl`), "{}")));
  });
  const state = await readJson(path.join(c.stateRoot, "status.json"));
  assert.equal(state.last_examined_fingerprint, first.fingerprint);
  assert.equal(shouldRefresh({ inventory: await captureInventory(c), state }), true);
});
test("배포 묶음에는 정규화된 자료와 정책만 넣고 앱 코드·원본은 넣지 않는다", async (t) => {
  const c = await fixture(t); const version = "a".repeat(20);
  await atomicJson(path.join(c.publicRoot, "manifest.json"), { dataset_version: version });
  await atomicJson(path.join(c.publicRoot, "releases", version, "catalog.json"), { items: [] });
  await writeFile(path.join(c.rawRoot, "private-secret.json"), "private");
  const output = await prepareDataBundle(c, { dataset_version: version, reports: [], schema_version: "policy", estimator_version: "test" });
  assert.equal((await readJson(path.join(output.bundle, "manifest.json"))).model.estimator_policy.defaults.halfLifeDays, 7);
  assert.equal(await readJson(path.join(output.bundle, "private-secret.json")), null);
  await assert.rejects(prepareDataBundle(c, { dataset_version: "b" }), /버전 불일치/u);
});
test("동일 거래 시각이 학습과 최종 검증에 섞이지 않는다", () => {
  const records = Array.from({ length: 100 }, (_, i) => ({ price_meso: 100,
    sold_at: new Date(Date.UTC(2026, 0, Math.floor(i / 7) + 1)).toISOString() }));
  const split = splitMarketValidation(records);
  assert.ok(Date.parse(split.training.at(-1).sold_at) < Date.parse(split.audit[0].sold_at));
  assert.equal(split.training.length + split.audit.length, 100);
  assert.equal(splitMarketValidation(records.map((row) => ({ ...row, sold_at: records[0].sold_at }))), null);
});
test("최신 시세 가중치는 내부 시간순 검증에서 고르고 외부 감사값을 보지 않는다", () => {
  const candidates = [3, 7, 14].map((days) => ({ options: { halfLifeDays: days },
    validation: { available: true, median_absolute_log_error: days === 7 ? 0.1 : 0.2 } }));
  assert.equal(selectRecencyCandidate(candidates).options.halfLifeDays, 7);
});
