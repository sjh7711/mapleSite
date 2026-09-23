import { timingSafeEqual } from "node:crypto";

/** @param {Request} request @param {string} secret */
function authorized(request, secret) {
  const actual = new TextEncoder().encode(request.headers.get("Authorization") || "");
  const expected = new TextEncoder().encode(`Bearer ${secret}`);
  return Boolean(secret) && actual.length === expected.length && timingSafeEqual(actual, expected);
}

export default {
  /** @param {Request} request @param {Env} env */
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    /** @param {unknown} value @param {number} status */
    const json = (value, status = 200) => Response.json(value, {
      status, headers: { "Cache-Control": "no-store" },
    });
    try {
      if (path === "/register" && request.method === "POST") {
        if (!authorized(request, env.REGISTER_TOKEN)) return json({ error: "unauthorized" }, 401);
        if (Number(request.headers.get("Content-Length")) > 1024) return json({ error: "too_large" }, 413);
        const reader = request.body?.getReader();
        let size = 0;
        const chunks = [];
        if (!reader) return json({ error: "missing_body" }, 400);
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 1024) { await reader.cancel(); return json({ error: "too_large" }, 413); }
          chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        const { origin } = JSON.parse(new TextDecoder().decode(bytes));
        if (typeof origin !== "string" || !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/u.test(origin)) {
          return json({ error: "invalid_origin" }, 400);
        }
        const check = await fetch(`${origin}/health`, {
          headers: { Authorization: `Bearer ${env.UPLOAD_TOKEN}` },
          redirect: "manual", signal: AbortSignal.timeout(10000),
        });
        if (!check.ok) return json({ error: "origin_unavailable" }, 503);
        await check.body?.cancel();
        await env.ROUTE.put("origin", origin);
        return json({ ok: true });
      }
      // Discovery only: this Worker never accepts or proxies capture files.
      if (path !== "/route" || request.method !== "GET") return json({ error: "not_found" }, 404);
      if (!authorized(request, env.UPLOAD_TOKEN)) return json({ error: "unauthorized" }, 401);
      const origin = await env.ROUTE.get("origin");
      if (!origin) return json({ error: "tunnel_not_ready" }, 503);
      return json({ origin });
    } catch {
      return json({ error: "upload_temporarily_unavailable" }, 503);
    }
  },
};
