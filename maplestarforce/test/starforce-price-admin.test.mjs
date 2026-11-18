import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { before, after, beforeEach, test } from "node:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const root = fileURLToPath(new URL("../", import.meta.url));
const base = "https://starforce.test";
const password = "this-is-a-fixture-only-password-12345";
let mf, db;
before(async () => {
  const bundle = await build({ stdin: { resolveDir: root, contents: `
    import { onRequest as prices } from './functions/api/starforce-prices.ts';
    import { onRequest as session } from './functions/api/admin/session.ts';
    import { onRequest as admin } from './functions/api/admin/starforce-prices.ts';
    import { onRequest as soulPrices } from './functions/api/soul-ether-prices.ts';
    import { onRequest as soulAdmin } from './functions/api/admin/soul-ether-prices.ts';
    import { onRequest as page } from './functions/admin/_middleware.ts';
    export default { fetch(request,env,ctx) {
      const path=new URL(request.url).pathname;
      const fn=path==='/api/starforce-prices'?prices:path==='/api/admin/session'?session:
        path==='/api/admin/starforce-prices'?admin:path==='/api/soul-ether-prices'?soulPrices:
        path==='/api/admin/soul-ether-prices'?soulAdmin:page;
      return fn({request,env,waitUntil:p=>ctx.waitUntil(p),next:async()=>new Response('PRIVATE ADMIN PAGE')});
    }};` }, bundle: true, write: false, format: "esm", platform: "browser" });
  mf = new Miniflare(convertV4MiniflareOptions({ name: "admin-tests", modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-08-28", d1Databases: ["STARFORCE_CONFIG"],
    bindings: { STARFORCE_ADMIN_PASSWORD_HASH: createHash("sha256").update(password).digest("hex") } }));
  db = await mf.getD1Database("STARFORCE_CONFIG");
  for (const file of ["0001_initial.sql", "0002_soul_ether_prices.sql"]) {
    const sql = await readFile(new URL(`../migrations/starforce-prices/${file}`, import.meta.url), "utf8");
    await db.batch(sql.split(";").map((q) => q.trim()).filter(Boolean).map((q) => db.prepare(q)));
  }
});
after(async () => { await mf?.dispose(); });
beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM starforce_admin_sessions"), db.prepare("DELETE FROM starforce_admin_attempts"),
    db.prepare("UPDATE starforce_price_config SET revision = 0, prices = '{}', updated_at = NULL"),
    db.prepare("UPDATE soul_ether_price_config SET revision = 0, prices = '[18,18,18,70]', updated_at = NULL"),
  ]);
});
async function call(path, { method = "GET", body, cookie, origin = base, ip = "192.0.2.1", headers = {} } = {}) {
  return mf.dispatchFetch(base + path, { method, redirect: "manual", headers: {
    "Content-Type": "application/json", "CF-Connecting-IP": ip,
    ...(origin === null ? {} : { Origin: origin }), ...(cookie ? { Cookie: cookie } : {}), ...headers,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function login() {
  const response = await call("/api/admin/session", { method: "POST", body: { password } });
  assert.equal(response.status, 200, await response.clone().text());
  return response.headers.get("set-cookie").split(";")[0];
}

test("관리 화면과 수정 API는 로그인 없이 접근할 수 없고 공개 가격은 읽기만 가능하다", async () => {
  const page = await call("/admin/starforce-prices/");
  assert.equal(page.status, 302); assert.equal(page.headers.get("location"), "/admin/login/");
  assert.equal((await call("/api/admin/starforce-prices")).status, 401);
  assert.equal((await call("/api/admin/starforce-prices", { method: "PUT", body: {} })).status, 401);
  assert.equal((await call("/api/starforce-prices", { method: "PUT", body: {} })).status, 405);
  const publicPrices = await (await call("/api/starforce-prices")).json();
  assert.equal(publicPrices.prices["giant-fear"], 52); assert.equal(publicPrices.revision, 0);
  assert.equal(publicPrices.password, undefined); assert.equal(publicPrices.catalog, undefined);
});

test("잘못된 비밀번호는 거부하고 정상 로그인은 보안 쿠키와 서버 세션을 발급한다", async () => {
  assert.equal((await call("/api/admin/session", { method: "POST", body: { password: "wrong" } })).status, 401);
  const response = await call("/api/admin/session", { method: "POST", body: { password } });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  for (const flag of ["__Host-starforce_admin=", "Secure", "HttpOnly", "SameSite=Strict", "Path=/"]) assert.ok(cookie.includes(flag));
  const saved = await db.prepare("SELECT token_hash FROM starforce_admin_sessions").first();
  assert.notEqual(saved.token_hash, cookie.split("=")[1].split(";")[0]);
  assert.equal((await call("/admin/starforce-prices/", { cookie: cookie.split(";")[0] })).status, 200);
});

test("다른 사이트와 Origin 없는 요청으로 로그인하거나 저장할 수 없다", async () => {
  for (const origin of [null, "null", "https://attacker.test"]) {
    assert.equal((await call("/api/admin/session", { method: "POST", origin, body: { password } })).status, 403);
  }
  const cookie = await login();
  for (const origin of [null, "https://attacker.test"]) {
    assert.equal((await call("/api/admin/starforce-prices", { method: "PUT", cookie, origin,
      body: { revision: 0, prices: { "giant-fear": 1 } } })).status, 403);
  }
});

test("로그인 시도 제한과 만료·위조 세션, 로그아웃 처리를 검증한다", async () => {
  for (let i = 0; i < 10; i++) assert.equal((await call("/api/admin/session", { method: "POST", body: { password: "wrong" } })).status, 401);
  assert.equal((await call("/api/admin/session", { method: "POST", body: { password } })).status, 429);
  await db.prepare("DELETE FROM starforce_admin_attempts").run();
  const cookie = await login();
  assert.equal((await call("/api/admin/session", { cookie: "__Host-starforce_admin=" + "0".repeat(64) })).status, 401);
  const logout = await call("/api/admin/session", { method: "DELETE", cookie });
  assert.equal(logout.status, 200); assert.ok(logout.headers.get("set-cookie").includes("Max-Age=0"));
  assert.equal((await call("/api/admin/starforce-prices", { cookie })).status, 401);
  const expired = await login();
  await db.prepare("UPDATE starforce_admin_sessions SET expires_at = 1").run();
  assert.equal((await call("/api/admin/starforce-prices", { cookie: expired })).status, 401);
});

test("관리자가 저장한 가격이 공개 API에도 반영되고 동시 수정은 덮어쓰지 않는다", async () => {
  const cookie = await login();
  const options = { method: "PUT", cookie, body: { revision: 0, prices: { "giant-fear": 61, "eternal-hat": 2,
    "eternal-part-hat": 2, "eternal-part-top": 3, "eternal-part-bottom": 2, "eternal-part-shoulder": 2 } } };
  const results = await Promise.all([call("/api/admin/starforce-prices", options), call("/api/admin/starforce-prices", options)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const publicPrices = await (await call("/api/starforce-prices")).json();
  assert.equal(publicPrices.revision, 1); assert.equal(publicPrices.prices["giant-fear"], 61);
  assert.equal(publicPrices.prices["eternal-part-hat"], 2); assert.equal(publicPrices.prices["eternal-part-top"], 3);
  const dashboard = await (await call("/api/admin/starforce-prices", { cookie })).json();
  assert.equal(dashboard.catalog.find((i) => i.id === "astra-secondary").fixed, true);
});

test("잘못된 장비·가격·고정가 변경과 과도한 요청을 저장하지 않는다", async () => {
  const cookie = await login();
  for (const prices of [{ unknown: 5 }, { "giant-fear": -1 }, { "giant-fear": null }, { "giant-fear": "60" },
    { "giant-fear": 1_000_001 }, { "astra-secondary": 9 }, {}, JSON.parse('{"__proto__":10}')]) {
    const response = await call("/api/admin/starforce-prices", { method: "PUT", cookie, body: { revision: 0, prices } });
    assert.equal(response.status, 400, await response.text());
  }
  const large = await call("/api/admin/starforce-prices", { method: "PUT", cookie,
    body: { revision: 0, prices: { "giant-fear": 60 }, extra: "x".repeat(20000) } });
  assert.equal(large.status, 413);
  assert.equal((await (await call("/api/starforce-prices")).json()).revision, 0);
});

test("소울 에테르 관리 페이지와 쓰기는 인증을 요구하고 공개 API는 조회만 허용한다", async () => {
  assert.equal((await call("/admin/soul-ether-prices/")).status, 302);
  assert.equal((await call("/api/admin/soul-ether-prices")).status, 401);
  assert.equal((await call("/api/admin/soul-ether-prices", { method: "PUT", body: {} })).status, 401);
  assert.equal((await call("/api/soul-ether-prices", { method: "PUT", body: {} })).status, 405);
  const response = await call("/api/soul-ether-prices");
  assert.deepEqual((await response.json()).prices, [18, 18, 18, 70]);
  assert.equal(response.headers.get("cache-control"), "public, max-age=30, must-revalidate");
  const head = await call("/api/soul-ether-prices", { method: "HEAD" });
  assert.equal(head.status, 200); assert.equal(await head.text(), "");
});

test("에테르 가격 변경은 스페어값과 독립적이며 동시 저장 시 한 요청만 성공한다", async () => {
  const cookie = await login();
  const options = { method: "PUT", cookie, body: { revision: 0, prices: [0, 19.25, 21, 75] } };
  const results = await Promise.all([call("/api/admin/soul-ether-prices", options), call("/api/admin/soul-ether-prices", options)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const document = await (await call("/api/soul-ether-prices")).json();
  assert.deepEqual(document.prices, options.body.prices); assert.equal(document.revision, 1);
  assert.ok(Number.isFinite(Date.parse(document.updatedAt)));
  assert.equal((await (await call("/api/starforce-prices")).json()).revision, 0);
  assert.deepEqual((await (await call("/api/admin/soul-ether-prices", { cookie })).json()).prices, document.prices);
});

test("에테르 가격 저장은 출처·형식·범위·요청 크기를 검증한다", async () => {
  const cookie = await login();
  for (const prices of [[], [1, 2, 3], [1, 2, 3, 4, 5], [-1, 2, 3, 4], [1, null, 3, 4], [1, "2", 3, 4], [1, 2, 3, 1_000_001], {}]) {
    assert.equal((await call("/api/admin/soul-ether-prices", { method: "PUT", cookie, body: { revision: 0, prices } })).status, 400);
  }
  for (const origin of [null, "https://attacker.test"]) {
    assert.equal((await call("/api/admin/soul-ether-prices", { method: "PUT", cookie, origin,
      body: { revision: 0, prices: [1, 2, 3, 4] } })).status, 403);
  }
  assert.equal((await call("/api/admin/soul-ether-prices", { method: "PUT", cookie, headers: { "Content-Type": "text/plain" }, body: {} })).status, 415);
  assert.equal((await call("/api/admin/soul-ether-prices", { method: "PUT", cookie,
    body: { revision: 0, prices: [1, 2, 3, 4], extra: "x".repeat(20_000) } })).status, 413);
  assert.equal((await (await call("/api/soul-ether-prices")).json()).revision, 0);
});
