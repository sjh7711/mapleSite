import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUploadServer } from "../tools/item-market-upload/receiver.mjs";
import worker from "../tools/item-market-upload/worker.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");
test("VM receiver acknowledges only validated durable files and deduplicates retries", async () => {
  const rawRoot = await mkdtemp(join(tmpdir(), "maple-upload-test-"));
  const server = createUploadServer({ rawRoot, token: "test-token" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/upload`;
    const document = { schema_version: "maple-auction.capture.v2", capture: { captured_at: "2026-09-22" }, items: [] };
    document.integrity = { algorithm: "SHA-256", payload_sha256: hash(JSON.stringify(document)) };
    const body = JSON.stringify(document) + "\n";
    const digest = hash(body);
    const headers = { Authorization: "Bearer test-token", "X-Content-SHA256": digest };
    assert.equal((await fetch(url, { method: "POST", body })).status, 401);
    const first = await fetch(url, { method: "POST", headers, body });
    assert.equal(first.status, 201);
    assert.equal((await first.json()).sha256, digest);
    assert.equal(await readFile(join(rawRoot, "incoming", digest.slice(0, 2), digest + ".jsonl"), "utf8"), body);
    const duplicate = await fetch(url, { method: "POST", headers, body });
    assert.equal((await duplicate.json()).duplicate, true);
    assert.equal((await fetch(url, { method: "POST", headers, body: body + "x" })).status, 400);
    document.items.push({ invalid: true });
    const changed = JSON.stringify(document);
    const invalid = await fetch(url, { method: "POST", headers: { ...headers, "X-Content-SHA256": hash(changed) }, body: changed });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error, "integrity_mismatch");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(rawRoot, { recursive: true, force: true });
  }
});
test("discovery Worker has no upload endpoint and only returns an authenticated tunnel address", async () => {
  const env = { UPLOAD_TOKEN: "test-token", ROUTE: { get: async () => "https://example.trycloudflare.com" } };
  assert.equal((await worker.fetch(new Request("https://worker/upload", { method: "POST", body: "capture" }), env)).status, 404);
  assert.equal((await worker.fetch(new Request("https://worker/route"), env)).status, 401);
  const route = await worker.fetch(new Request("https://worker/route", { headers: { Authorization: "Bearer test-token" } }), env);
  assert.deepEqual(await route.json(), { origin: "https://example.trycloudflare.com" });
});
