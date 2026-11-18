import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { before, after, beforeEach, test } from "node:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { inboxItems } from "../src/shared/blacksmith-inbox-schema.js";
import { createBlacksmithWorkspace } from "../src/shared/blacksmith-workspace.js";

const base = "https://preview.starforce.test", path = "/api/blacksmith-inboxes";
const equipment = [{ presetId: "giant-fear", itemLevel: 200, startStar: 12, targetStar: 22, quantity: 2 }];
const lifetime = 12 * 60 * 60 * 1000;
let mf, db, migrationSnapshot, trafficEnabled = false;
const trafficCounts = new Map();
before(async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const bundle = await build({ stdin: { resolveDir: root, contents: `
    import {onRequest} from './functions/api/blacksmith-inboxes/[[path]].ts';
    import cleanup from './workers/inbox-cleanup/index.ts';
    export default {async fetch(request,env) {
      if (new URL(request.url).pathname === '/__test/scheduled') {
        await cleanup.scheduled({},env); return Response.json({ok:true});
      }
      return onRequest({request,env: new URL(request.url).searchParams.has('disabled') ? {...env,STARFORCE_INBOX_ENABLED:'false'} : env});
    }};
  ` }, bundle: true, write: false, format: "esm", platform: "browser" });
  const used = new Set();
  mf = new Miniflare(convertV4MiniflareOptions({ name: "inbox-tests", modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: "2026-08-29", d1Databases: ["STARFORCE_INBOX_DB"],
    serviceBindings: { INBOX_TRAFFIC: async request => {
      if (!trafficEnabled) return new Response(null, {status:204});
      const key = request.method + request.headers.get('X-Traffic-Client');
      const used = (trafficCounts.get(key) ?? 0) + 1; trafficCounts.set(key, used);
      return new Response(null, {status: used > (request.method === 'GET' ? 60 : 20) ? 429 : 204});
    } },
    bindings: { STARFORCE_INBOX_ENABLED: "true", TURNSTILE_SITEKEY: "fixture", TURNSTILE_SECRET: "fixture" },
    outboundService: async request => {
      assert.equal(request.url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
      const body = new URLSearchParams(await request.text()), token = body.get("response");
      const action = token?.startsWith("create-") ? "inbox_create" : token?.startsWith("lookup-") ? "inbox_lookup" : "inbox_submit";
      const valid = token?.startsWith("create-") || token?.startsWith("submit-") || token?.startsWith("lookup-");
      const replay = used.has(token); used.add(token);
      return Response.json({ success: Boolean(valid && !replay), action,
        hostname: token?.includes("wrong-host") ? "attacker.test" : "preview.starforce.test" });
    },
  }));
  db = await mf.getD1Database("STARFORCE_INBOX_DB");
  const sql = await readFile(new URL("../migrations/blacksmith-inbox/0001_initial.sql", import.meta.url), "utf8");
  const statements = sql.match(/CREATE TRIGGER[\s\S]*?END;|CREATE (?:TABLE|INDEX)[\s\S]*?;/gu);
  await db.batch(statements.map(statement => db.prepare(statement)));
  const oldCreated = Date.now() - 5 * 3600000, oldSubmitted = oldCreated + 2 * 3600000;
  await db.prepare("INSERT INTO blacksmith_inboxes(id,name,owner_hash,code_hash,created_at) VALUES ('legacy','기존 신청함','hash','old-code',?)").bind(oldCreated).run();
  await db.prepare("INSERT INTO blacksmith_requests(id,inbox_id,nickname,items,item_count,fingerprint,created_at) VALUES ('legacy-request','legacy','기존 신청','[]',1,'hash',?)").bind(oldSubmitted).run();
  await db.prepare("INSERT INTO blacksmith_inboxes(id,name,owner_hash,created_at) VALUES ('empty-legacy','빈 신청함','hash',?)").bind(oldCreated).run();
  const migration = await readFile(new URL("../migrations/blacksmith-inbox/0002_expiry.sql", import.meta.url), "utf8");
  await db.batch(migration.match(/CREATE TRIGGER[\s\S]*?END;|(?:ALTER TABLE|UPDATE|CREATE INDEX|DROP TRIGGER)[\s\S]*?;/gu).map(statement => db.prepare(statement)));
  migrationSnapshot = {
    room: await db.prepare("SELECT * FROM blacksmith_inboxes WHERE id='legacy'").first(),
    empty: await db.prepare("SELECT expires_at FROM blacksmith_inboxes WHERE id='empty-legacy'").first(),
    oldCreated, oldSubmitted,
  };
  const applicantMigration = await readFile(new URL("../migrations/blacksmith-inbox/0003_applicant.sql", import.meta.url), "utf8");
  await db.batch(applicantMigration.match(/(?:ALTER TABLE|CREATE(?: UNIQUE)? INDEX|CREATE TABLE|INSERT INTO)[\s\S]*?;/gu).map(statement => db.prepare(statement)));
  migrationSnapshot.request = await db.prepare("SELECT * FROM blacksmith_requests WHERE id='legacy-request'").first();
  const capacityMigration = await readFile(new URL('../migrations/blacksmith-inbox/0004_capacity.sql', import.meta.url), 'utf8');
  await db.batch(capacityMigration.match(/CREATE TRIGGER[\s\S]*?END;|(?:ALTER TABLE|CREATE(?: UNIQUE)? INDEX|UPDATE)[\s\S]*?;/gu).map(statement => db.prepare(statement)));
  migrationSnapshot.claim = await db.prepare("SELECT * FROM blacksmith_nickname_claims WHERE inbox_id='legacy'").first();
  await db.batch(['name-legacy-a','name-legacy-b'].map(id => db.prepare("INSERT INTO blacksmith_inboxes(id,name,owner_hash,created_at,expires_at) VALUES (?,'기존 중복 이름','hash',?,?)").bind(id,Date.now(),Date.now()+lifetime)));
  const namesMigration = await readFile(new URL('../migrations/blacksmith-inbox/0005_inbox_names.sql', import.meta.url), 'utf8');
  await db.batch(namesMigration.match(/CREATE INDEX[\s\S]*?;/gu).map(statement => db.prepare(statement)));
  migrationSnapshot.duplicateNames = (await db.prepare("SELECT COUNT(*) AS n FROM blacksmith_inboxes WHERE name='기존 중복 이름'").first()).n;
  const activityMigration = await readFile(new URL('../migrations/blacksmith-inbox/0006_inbox_activity.sql', import.meta.url), 'utf8');
  await db.batch(activityMigration.match(/CREATE TRIGGER[\s\S]*?END;|(?:ALTER TABLE|UPDATE|DROP TRIGGER)[\s\S]*?;/gu).map(statement => db.prepare(statement)));
  const blocksMigration = await readFile(new URL('../migrations/blacksmith-inbox/0007_creator_ip_blocks.sql', import.meta.url), 'utf8');
  await db.batch(blocksMigration.match(/(?:ALTER TABLE|CREATE TABLE)[\s\S]*?;/gu).map(statement => db.prepare(statement)));
  const legacyId='9'.repeat(24), legacyNow=Date.now();
  await db.prepare('INSERT INTO blacksmith_inboxes(id,name,owner_hash,created_at,expires_at) VALUES (?,?,?,?,?)').bind(legacyId,'이전 정원','hash',legacyNow,legacyNow+lifetime).run();
  const legacyInsert=db.prepare('INSERT INTO blacksmith_requests(id,inbox_id,nickname,items,item_count,fingerprint,status,created_at) VALUES (?,?,?,?,1,?,?,?)');
  await db.batch(Array.from({length:360},(_,i)=>legacyInsert.bind(`legacy-cap-${i}`,legacyId,`이전${i}`,'[]',`legacy${i}`,i<55?'waiting':'done',legacyNow+i)));
  const capacityLimitMigration=await readFile(new URL('../migrations/blacksmith-inbox/0008_request_capacity.sql',import.meta.url),'utf8');
  await db.batch(capacityLimitMigration.match(/CREATE TRIGGER[\s\S]*?END;|(?:DROP TRIGGER|DELETE FROM)[\s\S]*?;/gu).map(statement=>db.prepare(statement)));
  migrationSnapshot.capacity={
    counts:await db.prepare("SELECT SUM(status<>'done') AS active,SUM(status='done') AS done FROM blacksmith_requests WHERE inbox_id=?").bind(legacyId).first(),
    oldest:await db.prepare("SELECT id FROM blacksmith_requests WHERE inbox_id=? AND status='done' ORDER BY created_at,id LIMIT 1").bind(legacyId).first(),
    newest:await db.prepare("SELECT id FROM blacksmith_requests WHERE inbox_id=? AND status='done' ORDER BY created_at DESC,id DESC LIMIT 1").bind(legacyId).first(),
  };
  const historySql=await readFile(new URL('../migrations/blacksmith-inbox/0009_closed_history.sql',import.meta.url),'utf8');
  await db.batch(historySql.match(/CREATE TRIGGER[\s\S]*?END;|(?:CREATE(?: UNIQUE)? (?:TABLE|INDEX)|ALTER TABLE)[\s\S]*?;/gu).map(statement=>db.prepare(statement)));
  const completionSql=await readFile(new URL('../migrations/blacksmith-inbox/0010_request_completion.sql',import.meta.url),'utf8');
  await db.batch(completionSql.match(/CREATE TRIGGER[\s\S]*?END;|(?:ALTER TABLE|CREATE INDEX)[\s\S]*?;/gu).map(statement=>db.prepare(statement)));
  const applicantBlocksSql=await readFile(new URL('../migrations/blacksmith-inbox/0011_applicant_blocks.sql',import.meta.url),'utf8');
  await db.batch(applicantBlocksSql.match(/CREATE (?:TABLE|INDEX)[\s\S]*?;/gu).map(statement=>db.prepare(statement)));
  const retainedBlocksSql=await readFile(new URL('../migrations/blacksmith-inbox/0012_retained_applicant_blocks.sql',import.meta.url),'utf8');
  await db.batch(retainedBlocksSql.match(/CREATE TRIGGER[\s\S]*?END;|(?:ALTER TABLE|CREATE VIEW|DROP TRIGGER)[\s\S]*?;/gu).map(statement=>db.prepare(statement)));
});
after(async () => { await mf?.dispose(); });
beforeEach(async () => { trafficEnabled = false; trafficCounts.clear(); await db.batch([db.prepare("DELETE FROM blacksmith_requests"),db.prepare("DELETE FROM blacksmith_inboxes"),db.prepare("DELETE FROM blacksmith_inbox_history"),db.prepare("DELETE FROM blacksmith_limits"),db.prepare("DELETE FROM blacksmith_submissions")]); });
const applicantFor = (ip = "192.0.2.1") => createHash("sha256").update(`test-applicant:${ip}`).digest("hex");
async function call(suffix = "", { method = "GET", body, room, applicantToken, client = "c".repeat(64), ip = "192.0.2.1", origin = base, headers = {} } = {}) {
  return mf.dispatchFetch(base + path + suffix, { method, headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip, "X-Inbox-Client": client,
    ...(origin ? { Origin: origin } : {}), ...(room ? { Authorization: `Bearer ${room.browserToken}` } : {}), ...(applicantToken ? { "X-Inbox-Applicant": applicantToken } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
let roomIpSequence = 0;
async function createRoom(options = {}) {
  const n = roomIpSequence++;
  const ip = `198.18.${Math.floor(n / 254)}.${n % 254 + 1}`;
  const response = await call("", { method: "POST", ip, client: createHash("sha256").update(randomUUID()).digest("hex"), body: { name: `대장장이-${randomUUID().slice(0,20)}`, token: `create-${randomUUID()}` }, ...options });
  assert.equal(response.status, 201, await response.clone().text()); return response.json();
}
async function submit(room, extra = {}, options = {}) {
  return call(`/${room.id}/requests`, { method: "POST", applicantToken: applicantFor(options.ip), body: { id: randomUUID(), nickname: "신청자", items: equipment, token: `submit-${randomUUID()}`, ...extra }, ...options });
}
const mine = (room, options = {}) => call(`/${room.id}/my-request`, { applicantToken: applicantFor(options.ip), ...options });
const withdraw = (room, id, options = {}) => mine(room, { method: "DELETE", body: { id }, ...options });
const edit = (room, id, extra = {}, options = {}) => mine(room, { method: "PATCH", body: { id, version: 0, nickname: "신청자", items: equipment, token: `submit-${randomUUID()}`, ...extra }, ...options });
test("대장장이 이름 조회는 정확히 일치하는 활성 예약만 공개하고 비공개 정보를 반환하지 않는다", async () => {
  const name = "말랑 AB장이";
  const room = await createRoom({ body: { name, token: `create-${randomUUID()}` } });
  const lookup = (name) => call("/lookup", { method:"POST", body:{name,token:`lookup-${randomUUID()}`} });
  assert.deepEqual(await (await lookup(name)).json(), { room: { id: room.id, name } });
  assert.deepEqual(await (await lookup(` ${name} `)).json(), { room: { id: room.id, name } });
  for (const value of ["말랑", "말랑 ab장이", "ㅁㄹ AB장이", "%' OR 1=1 --"]) assert.equal((await lookup(value)).status, 404);
  assert.equal((await lookup("")).status, 400);
  assert.equal((await lookup("가".repeat(33))).status, 400);
  await db.prepare("UPDATE blacksmith_inboxes SET accepting=0 WHERE id=?").bind(room.id).run();
  assert.equal((await lookup(name)).status, 200);
  await db.prepare("UPDATE blacksmith_inboxes SET expires_at=? WHERE id=?").bind(Date.now()-1, room.id).run();
  assert.equal((await lookup(name)).status, 404);
});
test("대장장이 찾기는 봇 확인 누락·위조·다른 동작·다른 호스트·재사용과 GET 우회를 거부한다", async () => {
  const name="찾기 검증장이",room=await createRoom({body:{name,token:`create-${randomUUID()}`}});
  const lookup=token=>call("/lookup",{method:"POST",body:{name,token}});
  assert.equal((await call(`/lookup?name=${encodeURIComponent(name)}`)).status,405);
  for(const token of [undefined,"forged",`submit-${randomUUID()}`,`lookup-wrong-host-${randomUUID()}`]) assert.equal((await lookup(token)).status,403);
  const token=`lookup-${randomUUID()}`;
  assert.deepEqual(await(await lookup(token)).json(),{room:{id:room.id,name}});
  assert.equal((await lookup(token)).status,403);
});
test("봇 확인 실패도 찾기 요청 속도 제한을 사용한다", async () => {
  trafficEnabled = true;
  for (let i = 0; i < 20; i++) assert.equal((await call('/lookup',{method:'POST',body:{name:'없는장이'}})).status,403);
  assert.equal((await call('/lookup',{method:'POST',body:{name:'없는장이'}})).status,429);
});
test("진행자 차단은 이번 신청함의 본인 식별값·IP 재접수만 막고 종료 시 해제된다", async () => {
  const room=await createRoom(),other=await createRoom(),id=randomUUID();assert.equal((await submit(room,{id})).status,201);
  const block=options=>call(`/${room.id}/requests/${id}/block`,{method:"POST",body:{},...options});
  assert.equal((await block({})).status,401);
  assert.equal((await block({room,origin:'https://attacker.test'})).status,403);
  assert.equal((await block({room})).status,200);
  assert.equal((await (await mine(room)).json()).banned,true);
  assert.equal((await submit(room,{nickname:"다른 이름"},{ip:'192.0.2.2',applicantToken:applicantFor()})).status,403);
  assert.equal((await submit(room,{nickname:"다른 이름"},{applicantToken:'f'.repeat(64)})).status,403);
  assert.equal((await submit(room,{nickname:"정상 신청자"},{ip:'192.0.2.2'})).status,201);
  assert.equal((await submit(other)).status,201);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_applicant_blocks WHERE inbox_id=?').bind(room.id).first()).n,1);
  assert.equal((await call(`/${room.id}`,{method:'DELETE',room})).status,200);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_applicant_blocks WHERE inbox_id=?').bind(room.id).first()).n,0);
});
test("완료 안내는 본인에게만 서버 완료 시각부터 5분 동안 제공하고 재완료 요청으로 연장하지 않는다", async () => {
  const room=await createRoom(),id=randomUUID(); assert.equal((await submit(room,{id})).status,201);
  const complete=()=>call(`/${room.id}/requests/${id}`,{method:"PATCH",room,body:{status:"done"}});
  assert.equal((await complete()).status,200);
  const first=(await (await mine(room)).json()).completed;
  assert.equal(first.id,id); assert.ok(Math.abs(first.completedAt-Date.now())<5000);
  assert.equal((await (await mine(room,{ip:"192.0.2.2"})).json()).completed,null);
  await db.prepare("UPDATE blacksmith_requests SET completed_at=? WHERE id=?").bind(Date.now()-299000,id).run();
  const old=(await (await mine(room)).json()).completed.completedAt;
  assert.equal((await complete()).status,200);
  assert.equal((await (await mine(room)).json()).completed.completedAt,old);
  await db.prepare("UPDATE blacksmith_requests SET completed_at=? WHERE id=?").bind(Date.now()-300001,id).run();
  assert.equal((await (await mine(room)).json()).completed,null);
  assert.equal((await call(`/${room.id}/requests/${id}`,{method:"PATCH",room,body:{status:"working"}})).status,200);
  assert.equal((await db.prepare("SELECT completed_at FROM blacksmith_requests WHERE id=?").bind(id).first()).completed_at,null);
});
test("신청 장비는 가격·공통 설정·외부 이미지 없이 검증한다", () => {
  assert.deepEqual(inboxItems([{ ...equipment[0], replacementEok: 999, event: "none", displayIcon: "https://attacker.test/x", arbitrary: {} }]), equipment);
  for (const items of [[], [{...equipment[0],quantity:101}], [{...equipment[0],itemLevel:250}], [{...equipment[0],startStar:22}],
    [{presetId:"destiny-weapon",itemLevel:250,startStar:11,targetStar:22}]]) assert.throws(() => inboxItems(items));
  assert.equal(inboxItems([{presetId:"arcane-shoulder",itemLevel:200,startStar:12,targetStar:22,statGrowthMode:"glove"}])[0].statGrowthMode, "glove");
});
test("기존 신청함은 마지막 신청 또는 생성 시각부터 12시간으로 이전하고 접수 코드 저장을 제거한다", () => {
  assert.equal(migrationSnapshot.room.expires_at, migrationSnapshot.oldSubmitted + lifetime);
  assert.equal(migrationSnapshot.empty.expires_at, migrationSnapshot.oldCreated + lifetime);
  assert.equal(migrationSnapshot.room.code_hash, undefined);
  assert.equal(migrationSnapshot.room.owner_hash, "hash");
  assert.equal(migrationSnapshot.request.nickname, "기존 신청");
  assert.equal(migrationSnapshot.request.applicant_hash, null);
  assert.equal(migrationSnapshot.request.submitter_ip_hash, null);
  assert.equal(migrationSnapshot.request.version, 0);
  assert.equal(migrationSnapshot.claim.nickname_key, "기존 신청");
  assert.equal(migrationSnapshot.claim.applicant_hash, null);
  assert.equal(migrationSnapshot.duplicateNames, 2, '새 이름 정책 이전의 신청함을 삭제하거나 변경하지 않음');
});
test("생성 IP가 다른 브라우저에는 신청을 공개하지 않고 내부 인증값은 해시만 보관한다", async () => {
  const room = await createRoom(), other = await createRoom();
  const saved = await db.prepare("SELECT owner_hash FROM blacksmith_inboxes WHERE id=?").bind(room.id).first();
  assert.match(room.browserToken, /^[a-f0-9]{64}$/u); assert.equal(room.ownerKey, undefined);
  assert.equal(saved.owner_hash, createHash("sha256").update(`${room.id}:${room.browserToken}`).digest("hex"));
  const publicData = await (await call(`/${room.id}/public`)).json();
  assert.equal(publicData.name, room.name); assert.equal(publicData.owner_hash, undefined);
  assert.equal(publicData.browserToken, undefined); assert.equal(publicData.codeRequired, undefined);
  assert.ok(Math.abs(publicData.expiresAt - Date.now() - lifetime) < 5000);
  assert.equal((await submit(room)).status, 201);
  assert.equal((await call(`/${room.id}`)).status, 401);
  assert.equal((await call(`/${room.id}`, {room:other})).status, 401);
  const data = await (await call(`/${room.id}`, {room})).json();
  assert.equal(data.requests.length,1); assert.equal(data.requests[0].itemCount,2);
  assert.equal(data.requests[0].items, undefined);
  assert.equal(data.requests[0].applicant_hash, undefined); assert.equal(data.requests[0].submitter_ip_hash, undefined);
  assert.equal((await call(`/${room.id}?includeItems=1`)).status,401);
  assert.equal((await call(`/${room.id}?includeItems=1`,{room:other})).status,401);
  const estimates=await (await call(`/${room.id}?includeItems=1`,{room})).json();
  assert.deepEqual(estimates.requests[0].items,equipment);
  const detail = await (await call(`/${room.id}/requests/${data.requests[0].id}`,{room})).json();
  assert.deepEqual(detail.items,equipment);
  for (const method of ["GET","PATCH","DELETE"]) {
    assert.equal((await call(`/${room.id}/requests/${data.requests[0].id}`,{room:other,method,...(method==="PATCH"?{body:{status:"done"}}:{})})).status,401);
  }
  const unchanged = await (await call(`/${room.id}?revision=${data.room.revision}&includeItems=1`,{room})).json();
  assert.equal(unchanged.unchanged,true); assert.equal(unchanged.requests,undefined);
});
test("봇 확인·액션·호스트·토큰 재사용·교차 출처 우회를 거부한다", async () => {
  assert.equal((await call("",{method:"POST",body:{name:"test"}})).status,403);
  const room = await createRoom();
  for (const token of ["", "invalid", `create-${randomUUID()}`, `submit-wrong-host-${randomUUID()}`]) assert.equal((await submit(room,{token})).status,403);
  await db.prepare("DELETE FROM blacksmith_limits").run();
  const token=`submit-${randomUUID()}`;
  assert.equal((await submit(room,{token})).status,201);
  assert.equal((await submit(room,{token,nickname:"다른신청"},{ip:"192.0.2.2"})).status,403);
  assert.equal((await submit(room,{}, {origin:"https://attacker.test"})).status,403);
  assert.equal((await submit(room,{}, {origin:null})).status,403);
  assert.equal((await call(`/${room.id}/requests`,{method:"POST",body:{padding:"x".repeat(49000)}})).status,413);
  assert.equal((await call("/config?disabled=1")).status,404);
});
test("중복 접수·반복 클릭과 동시 요청을 제한하며 상태 변경·삭제를 다음 조회에 반영한다", async () => {
  const room=await createRoom(), id=randomUUID();
  assert.equal((await submit(room,{id})).status,201);
  assert.equal((await submit(room,{id,token:"already-consumed"})).status,200);
  assert.equal((await submit(room,{id,nickname:"변경"})).status,409);
  assert.equal((await submit(room)).status,409);
  assert.equal((await call(`/${room.id}/requests/${id}`,{method:"PATCH",room,body:{status:"done"}})).status,200);
  const data=await (await call(`/${room.id}`,{room})).json(); assert.equal(data.requests[0].status,"done");
  assert.equal((await call(`/${room.id}/requests/${id}`,{method:"DELETE",room})).status,200);
  const after=await (await call(`/${room.id}`,{room})).json(); assert.equal(after.requests.length,0); assert.ok(after.room.revision>data.room.revision);
  await db.prepare("DELETE FROM blacksmith_limits").run();
  const parallel=await Promise.all(Array.from({length:3},()=>submit(room)));
  assert.equal(parallel.filter(r=>r.status===201).length,1);
});
test("접수 코드를 지원하지 않으며 접수 중지·50건 상한을 서버에서 적용한다", async () => {
  const room=await createRoom();
  const settings=body=>call(`/${room.id}`,{method:"PATCH",room,body});
  assert.equal((await settings({accepting:false})).status,200); assert.equal((await submit(room)).status,409);
  assert.equal((await settings({accepting:true,code:"비밀코드"})).status,400);
  assert.equal((await settings({accepting:true})).status,200);
  assert.equal((await submit(room)).status,201);
  const insert=db.prepare("INSERT INTO blacksmith_requests(id,inbox_id,nickname,items,item_count,fingerprint,created_at) VALUES (?,?,?, ?,1,?,?)");
  await db.batch(Array.from({length:48},(_,i)=>insert.bind(randomUUID(),room.id,`fixture${i}`,JSON.stringify(equipment),`fixture${i}`,Date.now())));
  assert.equal((await submit(room,{nickname:"마지막"},{ip:"192.0.2.8"})).status,201,'50번째까지 접수');
  assert.equal((await submit(room,{nickname:"초과"},{ip:"192.0.2.9"})).status,409);
});
test('정원 축소는 이전 미완료 신청을 보존하고 오래된 완료 기록만 최근 300건으로 정리한다',()=>{
  assert.deepEqual(migrationSnapshot.capacity.counts,{active:55,done:300});
  assert.equal(migrationSnapshot.capacity.oldest.id,'legacy-cap-60');
  assert.equal(migrationSnapshot.capacity.newest.id,'legacy-cap-359');
});
test('대기·진행 합계 49건에서 동시에 들어온 두 신청 중 한 건만 접수하고 실패 건의 할당량은 기록하지 않는다',async()=>{
  const room=await createRoom(), insert=db.prepare('INSERT INTO blacksmith_requests(id,inbox_id,nickname,items,item_count,fingerprint,status,created_at) VALUES (?,?,?,?,1,?,?,?)');
  await db.batch(Array.from({length:49},(_,i)=>insert.bind(randomUUID(),room.id,`정원${i}`,JSON.stringify(equipment),`queue${i}`,i%2?'working':'waiting',Date.now())));
  const responses=await Promise.all([submit(room,{nickname:'마지막A'},{ip:'192.0.2.21'}),submit(room,{nickname:'마지막B'},{ip:'192.0.2.22'})]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM blacksmith_requests WHERE inbox_id=? AND status IN ('waiting','working')").bind(room.id).first()).n,50);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_submissions').first()).n,1);
  const data=await (await call('/'+room.id,{room})).json();assert.equal(data.counts.waiting+data.counts.working,50);assert.equal(data.counts.done,0);
});
test("본인 신청만 조회·철회하고 같은 IP의 다른 브라우저에는 철회 권한을 주지 않는다", async () => {
  const room=await createRoom(), id=randomUUID();
  assert.equal((await submit(room,{id})).status,201);
  const own=await (await mine(room)).json();
  assert.equal(own.application.id,id); assert.deepEqual(own.application.items,equipment); assert.equal(own.blocked,true);
  assert.equal(own.application.applicant_hash,undefined); assert.equal(own.application.submitter_ip_hash,undefined);
  const outsider=await (await mine(room,{applicantToken:"f".repeat(64)})).json();
  assert.equal(outsider.application,null); assert.equal(outsider.blocked,true);
  assert.equal((await call(`/${room.id}/my-request`)).status,401);
  assert.equal((await withdraw(room,id,{applicantToken:"f".repeat(64)})).status,404);
  assert.equal((await withdraw(room,id,{origin:"https://attacker.test"})).status,403);
  const expiry=(await db.prepare("SELECT expires_at FROM blacksmith_inboxes WHERE id=?").bind(room.id).first()).expires_at;
  assert.equal((await withdraw(room,id)).status,200);
  assert.equal((await (await mine(room)).json()).application,null);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM blacksmith_submissions").first()).n,1);
  assert.equal((await db.prepare("SELECT expires_at FROM blacksmith_inboxes WHERE id=?").bind(room.id).first()).expires_at,expiry);
  assert.equal((await submit(room,{id})).status,409,"철회한 신청 ID 재사용으로 횟수를 우회하지 못함");
  assert.equal((await submit(room)).status,201);
});
test("대기·진행 신청이 있으면 IP·브라우저·닉네임을 바꿔도 해당 식별자가 같을 때 추가 접수를 막는다", async () => {
  const room=await createRoom(), id=randomUUID(); assert.equal((await submit(room,{id})).status,201);
  assert.equal((await submit(room,{nickname:"다른닉"})).status,409);
  assert.equal((await submit(room,{nickname:"다른닉"},{applicantToken:"f".repeat(64)})).status,409);
  assert.equal((await submit(room,{nickname:"다른닉"},{ip:"192.0.2.2",applicantToken:applicantFor()})).status,409);
  assert.equal((await submit(room,{}, {ip:"192.0.2.2"})).status,409);
  assert.equal((await call(`/${room.id}/requests/${id}`,{method:"PATCH",room,body:{status:"working"}})).status,200);
  assert.equal((await withdraw(room,id)).status,409);
  assert.equal((await edit(room,id,{nickname:"수정"})).status,409);
  assert.equal((await submit(room)).status,409);
  assert.equal((await call(`/${room.id}/requests/${id}`,{method:"PATCH",room,body:{status:"done"}})).status,200);
  assert.equal((await submit(room,{nickname:"새 신청"})).status,201);
  assert.equal((await call(`/${room.id}/requests/${id}`,{method:"PATCH",room,body:{status:"waiting"}})).status,409);
});
test("대기 신청 수정은 접수 ID·시각·순번·만료·신청 횟수를 유지하고 새 장비와 버전만 반영한다", async () => {
  const room=await createRoom(), id=randomUUID(); assert.equal((await submit(room,{id})).status,201);
  const before=await db.prepare("SELECT * FROM blacksmith_requests WHERE id=?").bind(id).first();
  const expiry=(await db.prepare("SELECT expires_at FROM blacksmith_inboxes WHERE id=?").bind(room.id).first()).expires_at;
  assert.equal((await edit(room,id,{nickname:"남의 수정"},{applicantToken:"f".repeat(64)})).status,404);
  assert.equal((await edit(room,id,{nickname:"수정",token:"invalid"})).status,403);
  const changed=[{...equipment[0],targetStar:24,quantity:1,replacementEok:999}];
  assert.equal((await edit(room,id,{nickname:"수정",items:changed})).status,200);
  const after=await db.prepare("SELECT * FROM blacksmith_requests WHERE id=?").bind(id).first();
  assert.equal(after.created_at,before.created_at); assert.equal(after.id,id); assert.equal(after.status,"waiting"); assert.equal(after.version,1);
  assert.equal(after.nickname,"수정"); assert.equal(JSON.parse(after.items)[0].targetStar,24); assert.equal(JSON.parse(after.items)[0].replacementEok,undefined);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM blacksmith_submissions").first()).n,1);
  assert.equal((await db.prepare("SELECT expires_at FROM blacksmith_inboxes WHERE id=?").bind(room.id).first()).expires_at,expiry);
  assert.equal((await edit(room,id,{nickname:"낡은 버전"})).status,409);
  assert.equal((await edit(room,id,{nickname:"수정",items:changed,token:"already-used"})).status,200,"같은 수정 응답 유실 후 재시도는 멱등 처리");
  assert.equal((await call(`/${room.id}/requests/${id}`,{method:"PATCH",room,body:{status:"working",version:0}})).status,409);
});
test("같은 IP의 최근 30분 접수는 신청함 전체에서 3회로 제한하며 철회·거절로 초기화되지 않는다", async () => {
  const room=await createRoom(), other=await createRoom();
  for(let i=0;i<3;i++) {
    const target=i===1?other:room,id=randomUUID(); assert.equal((await submit(target,{id})).status,201);
    if(i===1) assert.equal((await call(`/${target.id}/requests/${id}`,{method:"DELETE",room:target})).status,200);
    else assert.equal((await withdraw(target,id)).status,200);
  }
  const blocked=await submit(room); assert.equal(blocked.status,429); assert.ok(Number(blocked.headers.get("Retry-After"))>1700);
  await db.prepare("UPDATE blacksmith_submissions SET submitted_at=? WHERE request_id=(SELECT request_id FROM blacksmith_submissions ORDER BY submitted_at LIMIT 1)").bind(Date.now()-30*60000-1).run();
  assert.equal((await submit(room)).status,201);
  assert.equal((await submit(other)).status,429,"세 개가 새로 생기는 고정 구간 방식이 아니라 최근 30분만 계산");
  assert.equal((await submit(other,{nickname:"다른IP"},{ip:"192.0.2.2"})).status,201);
});
test("신청 건당 성공한 수정 5회만 허용하고 재전송·실패·조회는 횟수를 차감하지 않는다", async () => {
  const room=await createRoom(), id=randomUUID(); assert.equal((await submit(room,{id})).status,201);
  assert.equal((await edit(room,id)).status,200,"내용을 바꾸지 않은 저장은 차감하지 않음");
  assert.equal((await edit(room,id,{nickname:"실패",token:"invalid"})).status,403);
  assert.equal((await (await mine(room)).json()).application.version,0);
  let changed;
  for(let version=0;version<5;version++) {
    changed={version,items:[{...equipment[0],quantity:version+3}]};
    assert.equal((await edit(room,id,changed)).status,200);
    assert.equal((await (await mine(room)).json()).application.version,version+1);
  }
  assert.equal((await edit(room,id,{...changed,token:"already-used"})).status,200,"5번째 저장 응답 유실 후 재전송도 추가 차감 없음");
  const sixth=await edit(room,id,{version:5,items:[{...equipment[0],quantity:99}]});
  assert.equal(sixth.status,409); assert.match((await sixth.json()).error,/최대 5회/u);
  const saved=await (await mine(room)).json(); assert.equal(saved.application.version,5); assert.equal(saved.application.items[0].quantity,7);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM blacksmith_submissions").first()).n,1);
  assert.equal((await call(`/${room.id}/requests/${id}`,{method:"PATCH",room,body:{status:"working"}})).status,200);
  assert.equal((await call(`/${room.id}/requests/${id}`,{method:"PATCH",room,body:{status:"waiting"}})).status,200);
  assert.equal((await edit(room,id,{version:5,nickname:"상태 변경 후 우회"})).status,409);
  assert.equal((await withdraw(room,id)).status,200,"수정 소진 후에도 대기 접수 철회 가능");
  const next=randomUUID(); assert.equal((await submit(room,{id:next})).status,201);
  assert.equal((await edit(room,next,{nickname:"새 접수"})).status,200,"새 접수는 별도로 5회 허용");
});
test("남은 수정 기회가 1회일 때 서로 다른 탭의 동시 저장 중 한 건만 반영된다", async () => {
  const room=await createRoom(), id=randomUUID(); assert.equal((await submit(room,{id})).status,201);
  for(let version=0;version<4;version++) assert.equal((await edit(room,id,{version,items:[{...equipment[0],quantity:version+3}]})).status,200);
  const responses=await Promise.all([8,9].map(quantity=>edit(room,id,{version:4,items:[{...equipment[0],quantity}]})));
  assert.equal(responses.filter(r=>r.status===200).length,1); assert.equal(responses.filter(r=>r.status===409).length,1);
  assert.equal((await (await mine(room)).json()).application.version,5);
});
test("서로 다른 신청함에 같은 IP로 동시에 접수해도 최대 3건만 저장한다", async () => {
  const rooms=await Promise.all(Array.from({length:4},()=>createRoom()));
  const results=await Promise.all(rooms.map(room=>submit(room)));
  assert.equal(results.filter(r=>r.status===201).length,3); assert.equal(results.filter(r=>r.status===429).length,1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM blacksmith_requests").first()).n,3);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM blacksmith_submissions").first()).n,3);
});
test("완료된 닉네임은 예약을 유지하고 철회하면 해제하며 이전 완료 건의 거절은 새 예약에 영향을 주지 않는다", async () => {
  const room=await createRoom(), id=randomUUID();
  assert.equal((await submit(room,{id,nickname:"AB"})).status,201);
  assert.equal((await submit(room,{nickname:"ab"},{ip:"192.0.2.2"})).status,409,"영문 대소문자로 우회 불가");
  assert.equal((await call(`/${room.id}/requests/${id}`,{method:"PATCH",room,body:{status:"done"}})).status,200);
  assert.equal((await submit(room,{nickname:"AB"},{ip:"192.0.2.2"})).status,409);
  const second=randomUUID(); assert.equal((await submit(room,{id:second,nickname:"AB"})).status,201,"본인은 완료 후 같은 이름 재사용 가능");
  assert.equal((await withdraw(room,second)).status,200);
  assert.equal((await submit(room,{nickname:"ab"},{ip:"192.0.2.2"})).status,201,"철회한 이름을 다른 신청자가 사용 가능");
  assert.equal((await call(`/${room.id}/requests/${id}`,{method:"DELETE",room})).status,200);
  assert.equal((await submit(room,{nickname:"AB"},{ip:"192.0.2.3"})).status,409,"다른 신청자가 새로 예약한 이름은 유지");
  const other=await createRoom(); assert.equal((await submit(other,{nickname:"AB"},{ip:"192.0.2.2"})).status,201,"신청함별 이름 공간");
  assert.equal((await call(`/${room.id}`,{method:"DELETE",room})).status,200);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM blacksmith_nickname_claims WHERE inbox_id=?").bind(room.id).first()).n,0);
});
test("닉네임 동시 선점은 한 명만 성공하고 신청 수정으로 다른 사람 이름을 가져올 수 없다", async () => {
  const room=await createRoom();
  const results=await Promise.all([submit(room,{nickname:"AB"}),submit(room,{nickname:"ab"},{ip:"192.0.2.2"})]);
  assert.equal(results.filter(r=>r.status===201).length,1); assert.equal(results.filter(r=>r.status===409).length,1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM blacksmith_nickname_claims").first()).n,1);
  const id=randomUUID(); assert.equal((await submit(room,{id,nickname:"CD"},{ip:"192.0.2.3"})).status,201);
  assert.equal((await edit(room,id,{nickname:"AB"},{ip:"192.0.2.3"})).status,409);
  assert.equal((await edit(room,id,{nickname:"EF"},{ip:"192.0.2.3"})).status,200);
  assert.equal((await submit(room,{nickname:"CD"},{ip:"192.0.2.4"})).status,409,"이름 수정 후에도 원래 이름 소유자 유지");
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM blacksmith_submissions").first()).n,2,"거절된 선점과 수정은 접수 횟수에 추가하지 않음");
});
test("진행 시작과 철회가 겹치면 한 동작만 성공한다", async () => {
  const room=await createRoom(),id=randomUUID(); assert.equal((await submit(room,{id})).status,201);
  const responses=await Promise.all([withdraw(room,id),call(`/${room.id}/requests/${id}`,{method:"PATCH",room,body:{status:"working",version:0}})]);
  assert.equal(responses.filter(r=>r.status===200).length,1);
  const saved=await db.prepare("SELECT status FROM blacksmith_requests WHERE id=?").bind(id).first();
  assert.ok(saved===null||saved.status==="working");
  const claim=await db.prepare("SELECT request_id FROM blacksmith_nickname_claims WHERE inbox_id=?").bind(room.id).first();
  assert.equal(claim?.request_id ?? null,saved ? id : null,'진행 시작이 성공한 경우에만 이름 예약 유지');
});
test("진행 시작과 신청 수정이 겹치면 수정 전 내용으로 진행하지 않는다", async () => {
  const room=await createRoom(),id=randomUUID(); assert.equal((await submit(room,{id})).status,201);
  const responses=await Promise.all([edit(room,id,{items:[{...equipment[0],targetStar:24}]}),call(`/${room.id}/requests/${id}`,{method:"PATCH",room,body:{status:"working",version:0}})]);
  assert.equal(responses.filter(r=>r.status===200).length,1);
  const saved=await db.prepare("SELECT status,version FROM blacksmith_requests WHERE id=?").bind(id).first();
  assert.ok(saved.status==="working"&&saved.version===0||saved.status==="waiting"&&saved.version===1);
});
test("생성 IP가 다른 브라우저의 종료를 거부하고 정당한 종료는 모든 신청을 함께 삭제한다", async () => {
  const room=await createRoom(), other=await createRoom();
  assert.equal((await submit(room)).status,201);
  const discard=options=>call(`/${room.id}`,{method:"DELETE",...options});
  assert.equal((await discard({})).status,401);
  assert.equal((await discard({room:other})).status,401);
  assert.equal((await discard({room,origin:"https://attacker.test"})).status,403);
  assert.equal((await discard({room})).status,200);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM blacksmith_requests WHERE inbox_id=?").bind(room.id).first()).n,0);
  assert.equal((await call(`/${room.id}`,{room})).status,404);
  assert.equal((await call(`/${room.id}/public`)).status,404);
  assert.equal((await submit(room)).status,404);
  assert.equal((await call(`/${other.id}`,{room:other})).status,200);
});
test("새 신청만 만료 시각을 연장하고 조회·접수 설정·상태 변경·재전송·개별 삭제는 연장하지 않는다", async () => {
  const room=await createRoom(), id=randomUUID();
  const deadline=async()=> (await db.prepare("SELECT expires_at FROM blacksmith_inboxes WHERE id=?").bind(room.id).first()).expires_at;
  await db.prepare("UPDATE blacksmith_inboxes SET expires_at=? WHERE id=?").bind(Date.now()+60000,room.id).run();
  const initial=await deadline();
  assert.equal((await call(`/${room.id}`,{room})).status,200);
  assert.equal((await call(`/${room.id}/public`)).status,200);
  for (const accepting of [false,true]) assert.equal((await call(`/${room.id}`,{method:"PATCH",room,body:{accepting}})).status,200);
  assert.equal(await deadline(),initial);
  assert.equal((await submit(room,{id})).status,201);
  const renewed=await deadline(); assert.ok(renewed>initial); assert.ok(Math.abs(renewed-Date.now()-lifetime)<5000);
  assert.equal((await submit(room,{id,token:"already-used"})).status,200);
  assert.equal((await call(`/${room.id}/requests/${id}`,{method:"PATCH",room,body:{status:"working"}})).status,200);
  assert.equal((await call(`/${room.id}/requests/${id}`,{room})).status,200);
  assert.equal((await call(`/${room.id}/requests/${id}`,{method:"DELETE",room})).status,200);
  assert.equal(await deadline(),renewed);
});
test("기한이 지난 신청함은 조회 또는 제출 시 즉시 폐기하고 다시 살아나지 않는다", async () => {
  for (const access of ["owner","public","submit"]) {
    const room=await createRoom(); assert.equal((await submit(room)).status,201);
    await db.prepare("UPDATE blacksmith_inboxes SET expires_at=? WHERE id=?").bind(Date.now()-1,room.id).run();
    const response=access==="owner" ? await call(`/${room.id}`,{room}) : access==="public" ? await call(`/${room.id}/public`) : await submit(room);
    assert.equal(response.status,410);
    assert.match((await response.json()).error,/자동 종료/u);
    assert.equal(await db.prepare("SELECT id FROM blacksmith_inboxes WHERE id=?").bind(room.id).first(),null);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM blacksmith_requests WHERE inbox_id=?").bind(room.id).first()).n,0);
    assert.equal((await submit(room)).status,404);
  }
});
test("브라우저가 모두 닫혀 있어도 예약 작업이 만료 신청함과 접수 내용을 삭제한다", async () => {
  const expired=await createRoom(), live=await createRoom();
  assert.equal((await submit(expired)).status,201); assert.equal((await submit(live)).status,201);
  await db.prepare("UPDATE blacksmith_inboxes SET expires_at=? WHERE id=?").bind(Date.now()-1,expired.id).run();
  // Invoke the real scheduled handler in the fixture without reading either inbox.
  assert.equal((await mf.dispatchFetch(base+'/__test/scheduled')).status,200);
  assert.equal(await db.prepare("SELECT id FROM blacksmith_inboxes WHERE id=?").bind(expired.id).first(),null);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM blacksmith_requests WHERE inbox_id=?").bind(expired.id).first()).n,0);
  assert.ok(await db.prepare("SELECT id FROM blacksmith_inboxes WHERE id=?").bind(live.id).first());
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM blacksmith_requests WHERE inbox_id=?").bind(live.id).first()).n,1);
});
test("정기 작업은 자동 종료 내역을 보관하고 3일이 지난 이력과 장비 페이지를 함께 삭제한다",async()=>{
  const expired=await createRoom(),closed=await createRoom(),old=await createRoom();
  for(const room of [expired,closed,old])assert.equal((await submit(room)).status,201);
  const deadline=Date.now()-1000;
  await db.prepare('UPDATE blacksmith_inboxes SET expires_at=? WHERE id=?').bind(deadline,expired.id).run();
  for(const room of [closed,old])assert.equal((await call('/'+room.id,{method:'DELETE',room})).status,200);
  await db.prepare('UPDATE blacksmith_inbox_history SET retain_until=? WHERE id=?').bind(Date.now()-1,old.id).run();
  assert.equal((await mf.dispatchFetch(base+'/__test/scheduled')).status,200);
  const record=await db.prepare('SELECT * FROM blacksmith_inbox_history WHERE id=?').bind(expired.id).first();
  assert.equal(record.end_reason,'expired');assert.equal(record.ended_at,deadline);assert.equal(record.retain_until-deadline,259200000);
  assert.ok(await db.prepare('SELECT id FROM blacksmith_inbox_history WHERE id=?').bind(closed.id).first());
  assert.equal(await db.prepare('SELECT id FROM blacksmith_inbox_history WHERE id=?').bind(old.id).first(),null);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_inbox_history_pages WHERE inbox_id=?').bind(old.id).first()).n,0);
  const veryOld=await createRoom();await db.prepare('UPDATE blacksmith_inboxes SET expires_at=? WHERE id=?').bind(Date.now()-259200000-1,veryOld.id).run();
  assert.equal((await mf.dispatchFetch(base+'/__test/scheduled')).status,200);
  assert.equal(await db.prepare('SELECT id FROM blacksmith_inbox_history WHERE id=?').bind(veryOld.id).first(),null);
});
test("신청 작업을 바꾸거나 새로고침해도 내 세 슬롯과 신청별 수정값을 보존한다", () => {
  const state={slots:[[{name:"내1"}],[{name:"내2"}],[{name:"내3"}]],characterSources:[{name:"캐릭1"},{name:"캐릭2"},{name:"캐릭3"}],slot:2};
  Object.defineProperty(state,"items",{get:()=>state.slots[state.slot],set:items=>{state.slots[state.slot]=items;}});
  const original=structuredClone({slots:state.slots,characterSources:state.characterSources,slot:state.slot}), drafts=new Map();
  const workspace=createBlacksmithWorkspace(state,items=>items.map(item=>({...item,replacementEok:45})),()=>{});
  workspace.open("A",equipment,null,items=>drafts.set("A",items));
  state.items[0].targetStar=24; state.items[0].replacementEok=50;
  assert.deepEqual(workspace.savedSlots(),original);
  workspace.open("B",equipment,null,items=>drafts.set("B",items));
  assert.equal(drafts.get("A")[0].targetStar,24);
  assert.equal(state.items[0].targetStar,22);
  workspace.open("A",equipment,drafts.get("A"),items=>drafts.set("A",items));
  assert.equal(state.items[0].targetStar,24); assert.equal(state.items[0].replacementEok,50);
  workspace.leave(); assert.deepEqual(workspace.savedSlots(),original);
});

test("거절 시 수정 전후 해당 접수가 예약한 이름을 해제한다", async () => {
  const room=await createRoom(), id=randomUUID();
  assert.equal((await submit(room,{id,nickname:'AB'})).status,201);
  assert.equal((await edit(room,id,{nickname:'CD'})).status,200);
  assert.equal((await call(`/${room.id}/requests/${id}`,{method:'DELETE',room})).status,200);
  assert.equal((await submit(room,{nickname:'AB'},{ip:'192.0.2.2'})).status,201);
  assert.equal((await submit(room,{nickname:'CD'},{ip:'192.0.2.3'})).status,201);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_submissions').first()).n,3);
});
test("철회는 수정 전후 이름을 모두 해제하고 다른 완료 접수의 예약과 제출 횟수는 유지한다", async () => {
  const room=await createRoom(), completed=randomUUID(), waiting=randomUUID();
  assert.equal((await submit(room,{id:completed,nickname:'유지'})).status,201);
  assert.equal((await call(`/${room.id}/requests/${completed}`,{method:'PATCH',room,body:{status:'done'}})).status,200);
  assert.equal((await submit(room,{id:waiting,nickname:'AB'})).status,201);
  assert.equal((await edit(room,waiting,{nickname:'CD'})).status,200);
  assert.equal((await withdraw(room,waiting)).status,200);
  const claims=await db.prepare('SELECT nickname_key FROM blacksmith_nickname_claims WHERE inbox_id=?').bind(room.id).all();
  assert.deepEqual(claims.results.map(row=>row.nickname_key),['유지']);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_submissions').first()).n,2,'철회해도 접수 횟수를 환불하지 않음');
  assert.equal((await submit(room,{nickname:'유지'},{ip:'192.0.2.2'})).status,409);
  assert.equal((await submit(room,{nickname:'AB'},{ip:'192.0.2.2'})).status,201);
  assert.equal((await submit(room,{nickname:'CD'},{ip:'192.0.2.3'})).status,201);
});
test("진행중이어서 철회에 실패하면 닉네임 예약도 해제하지 않는다", async () => {
  const room=await createRoom(), id=randomUUID();
  assert.equal((await submit(room,{id,nickname:'AB'})).status,201);
  assert.equal((await call(`/${room.id}/requests/${id}`,{method:'PATCH',room,body:{status:'working',version:0}})).status,200);
  assert.equal((await withdraw(room,id)).status,409);
  assert.equal((await submit(room,{nickname:'ab'},{ip:'192.0.2.2'})).status,409);
  assert.equal((await db.prepare('SELECT request_id FROM blacksmith_nickname_claims WHERE inbox_id=?').bind(room.id).first()).request_id,id);
});
test("이전 완료 건을 거절해도 같은 이름의 새 진행 건은 예약 해제하지 않는다", async () => {
  const room=await createRoom(), first=randomUUID(), next=randomUUID();
  assert.equal((await submit(room,{id:first,nickname:'AB'})).status,201);
  assert.equal((await call(`/${room.id}/requests/${first}`,{method:'PATCH',room,body:{status:'done'}})).status,200);
  assert.equal((await submit(room,{id:next,nickname:'AB'})).status,201);
  assert.equal((await call(`/${room.id}/requests/${first}`,{method:'DELETE',room})).status,200);
  assert.equal((await submit(room,{nickname:'AB'},{ip:'192.0.2.2'})).status,409);
  assert.equal((await call(`/${room.id}/requests/${next}`,{method:'DELETE',room})).status,200);
  assert.equal((await submit(room,{nickname:'AB'},{ip:'192.0.2.2'})).status,201);
});
test("서버가 동시 생성에도 브라우저별 신청함 하나만 만들고 응답 유실 시 같은 권한으로 복구한다", async () => {
  const options={client:'e'.repeat(64)}, body=()=>({name:'동시 생성',token:`create-${randomUUID()}`});
  const responses=await Promise.all([call('',{method:'POST',body:body(),...options}),call('',{method:'POST',body:body(),...options})]);
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);
  const [a,b]=await Promise.all(responses.map(r=>r.json())); assert.equal(a.id,b.id); assert.equal(a.browserToken,b.browserToken);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_inboxes').first()).n,1);
  assert.equal((await call(`/${a.id}`,{room:a,...options})).status,200);
  const other=await createRoom(); assert.notEqual(a.id,other.id);
  assert.equal((await call(`/${a.id}`,{method:'DELETE',room:a,...options})).status,200);
  const again=await createRoom(options); assert.notEqual(again.id,a.id);
});
test("같은 IP는 시크릿 브라우저·접수 중지·동시 요청에서도 활성 대장장이를 하나만 열며 본인 권한만 복구한다", async () => {
  const ip="192.0.2.40", clients=['a'.repeat(64),'b'.repeat(64)];
  const body=i=>({name:`IP 제한 ${i}`,token:`create-${randomUUID()}`});
  const responses=await Promise.all(clients.map((client,i)=>call('',{method:'POST',ip,client,body:body(i)})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
  const winner=responses.findIndex(r=>r.status===201), room=await responses[winner].json(), loser=1-winner;
  const denied=await responses[loser].json();assert.match(denied.error,/같은 IP/);assert.equal(denied.browserToken,undefined);assert.equal(denied.id,undefined);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_inboxes').first()).n,1);
  const recovered=await call('',{method:'POST',ip,client:clients[winner],body:body(2)});assert.equal(recovered.status,200);assert.deepEqual(await recovered.json(),room);
  await db.prepare('UPDATE blacksmith_inboxes SET accepting=0 WHERE id=?').bind(room.id).run();
  assert.equal((await call('',{method:'POST',ip,client:clients[loser],body:body(3)})).status,409,'일시 중지도 활성 IP 자리를 유지');
  const other=await createRoom({ip:'192.0.2.41'});assert.notEqual(other.id,room.id);
});
test("같은 IP라도 종료·만료 후 새 브라우저에서 대장장이를 열 수 있고 종료 이력은 제한에 포함하지 않는다", async () => {
  const ip="192.0.2.42", room=await createRoom({ip});
  assert.equal((await call(`/${room.id}`,{method:'DELETE',room,ip})).status,200);
  const next=await createRoom({ip});assert.notEqual(next.id,room.id);
  await db.prepare('UPDATE blacksmith_inboxes SET expires_at=? WHERE id=?').bind(Date.now()-1,next.id).run();
  const final=await createRoom({ip});assert.notEqual(final.id,next.id);
  assert.ok((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_inbox_history').first()).n>0);
});
test("같은 생성 IP의 새 브라우저는 관리 키 없이 발견·조회·처리·종료하고 다른 IP에는 권한을 넘기지 않는다", async () => {
  const ip = "192.0.2.60", client = "a".repeat(64), room = await createRoom({ ip });
  const application = await (await submit(room)).json();
  const discovered = await call("/managed", { ip, client });
  assert.equal(discovered.status, 200);
  assert.equal(discovered.headers.get("cache-control"), "no-store");
  const data = await discovered.json();
  assert.deepEqual(Object.keys(data.room).sort(), ["id", "name", "accepting", "revision", "expiresAt"].sort());
  assert.equal(data.room.id, room.id);
  assert.ok(!JSON.stringify(data).includes(room.browserToken));
  const queue = await call(`/${room.id}?includeItems=1`, { ip, client });
  assert.equal(queue.status, 200); assert.deepEqual((await queue.json()).requests[0].items, equipment);
  assert.equal((await call(`/${room.id}/requests/${application.id}`, { ip, client, method:"PATCH", body:{status:"working",version:0} })).status, 200);
  assert.equal((await call(`/${room.id}/requests/${application.id}`, { ip, client, method:"PATCH", body:{status:"done"} })).status, 200);
  assert.equal((await call(`/${room.id}`, { ip, client, method:"PATCH", body:{accepting:false} })).status, 200);
  assert.equal((await (await call("/managed", {ip,client})).json()).room.accepting, false);
  const elsewhere = { ip:"192.0.2.61", client };
  assert.deepEqual(await (await call("/managed", elsewhere)).json(), {room:null});
  for (const method of ["GET","PATCH","DELETE"]) {
    assert.equal((await call(`/${room.id}`, { ...elsewhere, method, ...(method === "PATCH" ? {body:{accepting:true}} : {}) })).status, 401);
  }
  assert.equal((await call(`/${room.id}`, {...elsewhere,room})).status, 200, "원래 브라우저 관리 키는 IP가 달라도 유지");
  assert.equal((await call(`/${room.id}/my-request`, {ip,client})).status,401,"진행자의 IP 권한은 신청자 인증을 대체하지 않음");
  assert.equal((await call(`/${room.id}`, {ip,client,method:"DELETE"})).status, 200);
  assert.deepEqual(await (await call("/managed",{ip,client})).json(), {room:null});
});
test("IP 관리 연결은 만료·누락된 IP·잘못된 클라이언트·다른 출처 요청을 허용하지 않는다", async () => {
  const ip="192.0.2.62",room=await createRoom({ip});
  assert.equal((await call("/managed",{ip,client:"invalid"})).status,401);
  assert.equal((await call("/managed",{ip,headers:{"Sec-Fetch-Site":"cross-site"}})).status,403);
  assert.equal((await call(`/${room.id}`,{ip,origin:"https://attacker.test"})).status,403);
  // Miniflare replaces an empty CF header with its own loopback peer address.
  assert.deepEqual(await (await call("/managed",{headers:{"CF-Connecting-IP":""}})).json(),{room:null});
  await db.prepare("UPDATE blacksmith_inboxes SET expires_at=? WHERE id=?").bind(Date.now()-1,room.id).run();
  assert.deepEqual(await (await call("/managed",{ip})).json(),{room:null});
  assert.equal((await call(`/${room.id}`,{ip})).status,410);
});
test("서로 다른 브라우저가 같은 대장장이 이름을 동시에 생성하면 한 신청함만 생성한다", async () => {
  const options=[{client:'d'.repeat(64),ip:'192.0.2.2'},{client:'e'.repeat(64),ip:'192.0.2.3'}];
  const responses=await Promise.all(options.map((option,i)=>call('',{method:'POST',...option,body:{name:i?'  메이플 smith  ':'메이플 Smith',token:`create-${randomUUID()}`}})));
  assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);
  const denied=await responses.find(r=>r.status===409).json();
  assert.match(denied.error,/대장장이 이름/); assert.equal(denied.browserToken,undefined);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_inboxes').first()).n,1);
  const winner=responses.findIndex(r=>r.status===201), created=await responses[winner].json();
  const retry=await call('',{method:'POST',...options[winner],body:{name:'메이플 Smith',token:`create-${randomUUID()}`}});
  assert.equal(retry.status,200); assert.deepEqual(await retry.json(),created,'본인 생성 응답 유실 복구는 이름 중복으로 막지 않음');
});
test("정규화한 대장장이 이름 중복을 막고 폐기·만료 후에는 다른 브라우저에서도 이름을 재사용한다", async () => {
  const body=name=>({name,token:`create-${randomUUID()}`});
  const first=await createRoom({body:body('대장장이 가')});
  const duplicate=await call('',{method:'POST',client:'d'.repeat(64),body:body('대장장이 가'.normalize('NFD'))});
  assert.equal(duplicate.status,409);
  assert.equal((await call(`/${first.id}`,{method:'DELETE',room:first})).status,200);
  const second=await createRoom({client:'e'.repeat(64),body:body('대장장이 가')});
  await db.prepare('UPDATE blacksmith_inboxes SET expires_at=? WHERE id=?').bind(Date.now()-1,second.id).run();
  const third=await createRoom({client:'f'.repeat(64),body:body('대장장이 가')});
  assert.notEqual(third.id,second.id);
  assert.equal((await call(`/${third.id}`,{room:second})).status,401,'이름을 재사용해도 이전 관리 권한은 승계하지 않음');
});
test("만료된 본인 신청함은 재생성하고 전체 활성 100개 한도는 서버에서 차단한다", async () => {
  const options={client:'e'.repeat(64)}, first=await createRoom(options);
  await db.prepare('UPDATE blacksmith_inboxes SET expires_at=? WHERE id=?').bind(Date.now()-1,first.id).run();
  const second=await createRoom(options); assert.notEqual(first.id,second.id);
  const now=Date.now(), insert=db.prepare('INSERT INTO blacksmith_inboxes(id,name,owner_hash,created_at,expires_at) VALUES (?,?,?,?,?)');
  await db.batch(Array.from({length:99},(_,i)=>insert.bind(`fixture-${i}`,'fixture','hash',now,now+lifetime)));
  const denied=await call('',{method:'POST',client:'f'.repeat(64),body:{name:'초과',token:`create-${randomUUID()}`}});
  assert.equal(denied.status,503); assert.match((await denied.json()).error,/대장장이 수/);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_inboxes').first()).n,100);
});
test("완료 내역은 정원 50건과 분리하고 20개씩 정렬·초성 검색하며 장비를 권한 없이 공개하지 않는다", async () => {
  const room=await createRoom(), now=Date.now(), insert=db.prepare("INSERT INTO blacksmith_requests(id,inbox_id,nickname,items,item_count,fingerprint,status,created_at) VALUES (?,?,?,?,1,?,'done',?)");
  await db.batch(Array.from({length:205},(_,i)=>insert.bind(randomUUID(),room.id,`신청자${i}`,JSON.stringify(equipment),`fixture${i}`,now+i)));
  assert.equal((await submit(room,{nickname:'대기'})).status,201,'완료 205건이 있어도 신규 접수 가능');
  const page0=await (await call(`/${room.id}?includeItems=1`,{room})).json();
  assert.equal(page0.requests.length,21); assert.equal(page0.history.total,205); assert.equal(page0.history.pages,11);
  assert.deepEqual(page0.counts,{waiting:1,working:0,done:205,blocked:0});
  assert.equal(page0.requests[1].nickname,'신청자204'); assert.deepEqual(page0.requests[1].items,equipment);
  const page1=await (await call(`/${room.id}?historyPage=1&includeItems=1`,{room})).json(); assert.equal(page1.requests[1].nickname,'신청자184');
  const search=await (await call(`/${room.id}?search=${encodeURIComponent('ㅅㅊㅈ20')}&includeItems=1`,{room})).json();
  assert.equal(search.history.total,6); assert.equal(search.requests.length,6);
  assert.deepEqual(search.counts,{waiting:1,working:0,done:205,blocked:0},'버튼의 건수는 검색·완료 페이지와 관계없이 전체 상태 건수');
  assert.equal((await call(`/${room.id}?historyPage=1&includeItems=1`)).status,401);
  const detail=page0.requests[0].id;
  assert.equal((await call(`/${room.id}/requests/${detail}`)).status,401);
});
test("완료 보관은 최근 300건으로 제한하고 완료 건을 정원 밖에서 재대기로 우회하지 못한다", async () => {
  const room=await createRoom(), now=Date.now()-10000, insert=db.prepare('INSERT INTO blacksmith_requests(id,inbox_id,nickname,items,item_count,fingerprint,status,created_at) VALUES (?,?,?,?,1,?,?,?)');
  const doneIds=Array.from({length:300},()=>randomUUID());
  await db.batch(doneIds.map((id,i)=>insert.bind(id,room.id,`완료${i}`,JSON.stringify(equipment),`done${i}`,'done',now+i)));
  const id=randomUUID(); assert.equal((await submit(room,{id})).status,201);
  assert.equal((await call(`/${room.id}/requests/${id}`,{method:'PATCH',room,body:{status:'done'}})).status,200);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM blacksmith_requests WHERE status='done'").first()).n,300);
  assert.equal(await db.prepare('SELECT id FROM blacksmith_requests WHERE id=?').bind(doneIds[0]).first(),null);
  assert.ok(await db.prepare('SELECT id FROM blacksmith_requests WHERE id=?').bind(id).first());
  const done=await db.prepare("SELECT id FROM blacksmith_requests WHERE status='done' LIMIT 1").first();
  await db.batch(Array.from({length:50},(_,i)=>insert.bind(randomUUID(),room.id,`대기${i}`,JSON.stringify(equipment),`wait${i}`,'waiting',now+i)));
  assert.equal((await call(`/${room.id}/requests/${done.id}`,{method:'PATCH',room,body:{status:'waiting'}})).status,409);
  await assert.rejects(()=>insert.bind(randomUUID(),room.id,'이전 배포','[]','old-deploy','waiting',Date.now()).run(),/blacksmith_active_capacity/,'이전 배포나 직접 INSERT도 DB가 차단');
  await assert.rejects(()=>db.prepare("UPDATE blacksmith_requests SET status='working' WHERE id=?").bind(done.id).run(),/blacksmith_active_capacity/,'이전 배포의 완료→진행 변경도 DB가 차단');
});
test("조회와 인증 실패·없는 주소·잘못된 변경도 D1 조회 전 속도 제한을 적용한다", async () => {
  trafficEnabled=true;
  for(let i=0;i<60;i++) assert.equal((await call('/missing')).status,404);
  const blocked=await call('/config'); assert.equal(blocked.status,429); assert.equal(blocked.headers.get('Retry-After'),'60');
  for(let i=0;i<20;i++) assert.equal((await call('/missing',{method:'POST',body:{}})).status,404);
  assert.equal((await call('',{method:'POST',body:{}})).status,429);
  assert.equal((await call('/config',{client:'e'.repeat(64)})).status,200,'IP 보조 한도 안에서는 다른 브라우저 허용');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_limits').first()).n,0,'차단된 생성은 D1 한도 저장에 도달하지 않음');
});

test('이름 해제 후 다른 신청자의 대소문자 다른 이름이 있으면 옛 완료 건 재개를 차단한다',async()=>{
  const room=await createRoom(), old=randomUUID(), recent=randomUUID();
  assert.equal((await submit(room,{id:old,nickname:'AB'})).status,201);
  assert.equal((await call(`/${room.id}/requests/${old}`,{method:'PATCH',room,body:{status:'done'}})).status,200);
  assert.equal((await submit(room,{id:recent,nickname:'AB'})).status,201);
  assert.equal((await call(`/${room.id}/requests/${recent}`,{method:'DELETE',room})).status,200);
  assert.equal((await submit(room,{nickname:'ab'},{ip:'192.0.2.2'})).status,201);
  assert.equal((await call(`/${room.id}/requests/${old}`,{method:'PATCH',room,body:{status:'waiting'}})).status,409);
});

test('차단한 신청은 장비와 함께 완료 아래에 보존되고 차단 해제로만 목록에서 제거된다',async()=>{
  const room=await createRoom(),id=randomUUID(),done=randomUUID();
  assert.equal((await submit(room,{id})).status,201);
  assert.equal((await submit(room,{id:done,nickname:'완료 신청'},{ip:'192.0.2.2'})).status,201);
  assert.equal((await call(`/${room.id}/requests/${done}`,{method:'PATCH',room,body:{status:'done'}})).status,200);
  const blocked=await call(`/${room.id}/requests/${id}/block`,{method:'POST',room,body:{}});assert.equal(blocked.status,200);
  let data=await(await call(`/${room.id}?includeItems=1`,{room})).json();
  assert.deepEqual(data.requests.map(r=>r.id),[done,id]);assert.deepEqual(data.counts,{waiting:0,working:0,done:1,blocked:1});
  const row=data.requests.at(-1);assert.equal(row.status,'blocked');assert.equal(row.nickname,'신청자');assert.deepEqual(row.items,equipment);assert.ok(row.blockedAt);
  const payload=JSON.stringify(data);for(const privateField of ['applicant_hash','ip_hash','fingerprint'])assert.ok(!payload.includes(privateField));
  const path=`/${room.id}/requests/${id}/block`,body={blockedAt:row.blockedAt};
  assert.equal((await call(path,{method:'DELETE',body})).status,401);
  assert.equal((await call(path,{method:'DELETE',body,room,origin:'https://attacker.test'})).status,403);
  for(const invalid of [{},{blockedAt:-1},{blockedAt:'1'},{...body,ip:'forged'}])assert.equal((await call(path,{method:'DELETE',room,body:invalid})).status,400);
  assert.equal((await call(path,{method:'DELETE',room,body:{blockedAt:row.blockedAt+1}})).status,409);
  assert.equal((await(await mine(room)).json()).banned,true);
  const revision=data.room.revision;
  assert.equal((await call(path,{method:'DELETE',room,body})).status,200);
  data=await(await call(`/${room.id}?includeItems=1&revision=${revision}`,{room})).json();
  assert.ok(!data.unchanged);assert.deepEqual(data.requests.map(r=>r.id),[done]);assert.equal(data.counts.blocked,0);
  assert.equal((await(await mine(room)).json()).banned,false);
  assert.equal((await submit(room,{nickname:'다시 신청'})).status,201);
  assert.equal((await call(path,{method:'DELETE',room,body})).status,409);
});
test('차단 기록은 대기·진행 50칸과 완료 300칸의 정원을 사용하지 않는다',async()=>{
  const room=await createRoom(),id=randomUUID();assert.equal((await submit(room,{id})).status,201);
  assert.equal((await call(`/${room.id}/requests/${id}/block`,{method:'POST',room,body:{}})).status,200);
  const now=Date.now(),insert=db.prepare("INSERT INTO blacksmith_requests(id,inbox_id,nickname,items,item_count,fingerprint,status,created_at) VALUES (?,?,?,'[]',1,?,?,?)");
  await db.batch(Array.from({length:349},(_,i)=>insert.bind(randomUUID(),room.id,`정원${i}`,`fp${i}`,i<49?'waiting':'done',now+i)));
  assert.equal((await submit(room,{nickname:'남은 한 칸'},{ip:'192.0.2.5'})).status,201);
  assert.equal((await submit(room,{nickname:'정원 초과'},{ip:'192.0.2.6'})).status,409);
  const data=await(await call(`/${room.id}?includeItems=1&historyPage=999`,{room})).json();
  assert.deepEqual(data.counts,{waiting:50,working:0,done:300,blocked:1});assert.equal(data.requests.at(-1).id,id);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM blacksmith_applicant_blocks WHERE inbox_id=?').bind(room.id).first()).n,1);
});
test('기존 차단 기록은 식별값을 공개하지 않고 표시하며 다른 대장장이의 차단을 해제할 수 없다',async()=>{
  const room=await createRoom(),other=await createRoom(),id=randomUUID(),now=Date.now();
  await db.prepare('INSERT INTO blacksmith_applicant_blocks(inbox_id,request_id,applicant_hash,ip_hash,blocked_at) VALUES (?,?,?,?,?)').bind(room.id,id,'hidden-applicant','hidden-ip',now).run();
  const response=await call(`/${room.id}?includeItems=1`,{room}),text=await response.clone().text(),data=await response.json();
  assert.equal(data.requests[0].nickname,'이전 차단 신청');assert.equal(data.requests[0].items,null);assert.equal(data.requests[0].status,'blocked');
  assert.ok(!text.includes('hidden-'));
  assert.equal((await call(`/${other.id}/requests/${id}/block`,{method:'DELETE',room:other,body:{blockedAt:now}})).status,409);
  assert.equal((await call(`/${room.id}/requests/${id}/block`,{method:'DELETE',room,body:{blockedAt:now}})).status,200);
});
