import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function validateCaptureBytes(bytes, expectedHash) {
  if (!/^[a-f0-9]{64}$/u.test(expectedHash || "") || sha256(bytes) !== expectedHash) throw fail("hash_mismatch");
  const lines = bytes.toString("utf8").trim().split(/\r?\n/u);
  if (!lines.length || lines.length > 100) throw fail("invalid_line_count");
  let items = 0;
  for (const line of lines) {
    let document;
    try { document = JSON.parse(line); } catch { throw fail("invalid_json"); }
    if (document.schema_version !== "maple-auction.capture.v2" ||
        !document.capture || !Array.isArray(document.items) || document.items.length > 1000) throw fail("invalid_capture");
    const { integrity, ...payload } = document;
    if (integrity?.algorithm !== "SHA-256" || sha256(JSON.stringify(payload)) !== integrity.payload_sha256) throw fail("integrity_mismatch");
    items += document.items.length;
  }
  return { pages: lines.length, items };
}

export function createUploadServer({ token, rawRoot }) {
  if (!token || !rawRoot) throw new Error("upload configuration required");
  const expected = Buffer.from(`Bearer ${token}`);
  const server = http.createServer(async (request, response) => {
    const send = (status, body) => {
      response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(body));
    };
    try {
      const actual = Buffer.from(request.headers.authorization || "");
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return send(401, { error: "unauthorized" });
      if (request.method === "GET" && request.url === "/health") return send(200, { ok: true, service: "maple-market-upload" });
      if (request.method !== "POST" || request.url !== "/upload") return send(404, { error: "not_found" });
      if (Number(request.headers["content-length"]) > MAX_UPLOAD_BYTES) return send(413, { error: "too_large" });
      let size = 0;
      const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_UPLOAD_BYTES) throw fail("too_large", 413);
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const hash = request.headers["x-content-sha256"];
      const counts = validateCaptureBytes(bytes, hash);
      const directory = join(rawRoot, "incoming", hash.slice(0, 2));
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const destination = join(directory, `${hash}.jsonl`);
      try {
        await stat(destination);
        return send(200, { ok: true, duplicate: true, sha256: hash, ...counts });
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
      try {
        const file = await open(temporary, "wx", 0o600);
        try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
        await rename(temporary, destination);
        const parent = await open(directory, "r");
        try { await parent.sync(); } finally { await parent.close(); }
      } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
      console.log(JSON.stringify({ event: "capture_saved", sha256: hash, bytes: size, ...counts }));
      send(201, { ok: true, duplicate: false, sha256: hash, ...counts });
    } catch (error) {
      if (!response.headersSent && !response.destroyed) send(error.status || 500, { error: error.status ? error.message : "save_failed" });
    }
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 15000;
  return server;
}
