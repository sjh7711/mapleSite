import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { createUploadServer } from "./receiver.mjs";

const config = JSON.parse(await readFile(process.env.MAPLE_UPLOAD_CONFIG, "utf8"));
const server = createUploadServer({ token: config.uploadToken, rawRoot: config.rawRoot });
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(config.port, "127.0.0.1", resolve);
});
console.log("VM upload receiver ready");
const tunnel = spawn("/usr/local/bin/cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${config.port}`],
  { stdio: ["ignore", "pipe", "pipe"] });
let registeredOrigin = null;
let stopping = false;
async function register(origin) {
  for (let attempt = 0; !stopping; attempt += 1) {
    try {
      const response = await fetch(`${config.endpoint}/register`, {
        method: "POST", headers: { Authorization: `Bearer ${config.registerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ origin }), signal: AbortSignal.timeout(20000),
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      console.log("Tunnel registered; extension upload address unchanged");
      return;
    } catch (error) {
      console.log(`Tunnel registration retry ${attempt + 1}: ${error.message}`);
      await delay(Math.min(60000, 5000 * (attempt + 1)));
    }
  }
}
for (const stream of [tunnel.stdout, tunnel.stderr]) {
  createInterface({ input: stream }).on("line", (line) => {
    const origin = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/u)?.[0];
    if (origin && origin !== registeredOrigin) {
      registeredOrigin = origin;
      void register(origin).catch(() => process.exit(1));
    }
    if (/ERR|Registered tunnel connection/u.test(line)) console.log(line);
  });
}
tunnel.once("error", (error) => { console.error(error.message); process.exit(1); });
tunnel.once("exit", () => { server.close(); process.exit(stopping ? 0 : 1); });
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => {
  stopping = true;
  server.close();
  tunnel.kill("SIGTERM");
});
