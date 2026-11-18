import { proxyInboxRequest } from "../../_lib/blacksmith-inbox-vm";
import { AdminError, adminJson, digestHex, isRecord, readAdminJson, requireSameOrigin } from "../../_lib/starforce-admin";
import { inboxItems, inboxLabel, INBOX_STATUSES, INBOX_EDIT_LIMIT, INBOX_ROOM_LIMIT, INBOX_ACTIVE_LIMIT } from "../../../src/shared/blacksmith-inbox-schema.js";
import { INBOX_LIFETIME_MS } from "../../_lib/blacksmith-inbox-expiry";
import { inboxRequestsForView } from "../../../src/shared/blacksmith-inbox-list.js";
import { blockInboxApplicant, unblockInboxApplicant } from "../../_lib/blacksmith-applicant-block";

type Inbox = { id: string; name: string; owner_hash: string; creator_hash: string | null; creator_ip_hash: string | null; accepting: number; revision: number; expires_at: number };
type RoomInfo = Pick<Inbox, "id" | "name" | "accepting" | "revision" | "expires_at">;
type Application = { id: string; nickname: string; items: string; status: string; fingerprint: string; applicant_hash: string | null; submitter_ip_hash: string | null; version: number };
const submissionWindow = 30 * 60 * 1000;
const restrictedIpMessage="신청 불가능한 IP입니다. iCloud 비공개 릴레이를 끈 후 다시 접속해 주세요.";
function ipRestriction(env: Cloudflare.Env) {
  return env.INBOX_RELAY_BLOCKED === "true" ? "private-relay" : env.INBOX_FOREIGN_BLOCKED === "true" ? "foreign" : null;
}
function requireApplicantIp(env: Cloudflare.Env) {
  const restriction = ipRestriction(env);
  if (restriction) fail(403, restriction === "private-relay" ? restrictedIpMessage : "해외 IP에서는 대장장이를 신청할 수 없습니다. 한국 IP로 접속해 주세요.");
}
class SubmissionLimitError extends AdminError {
  constructor(readonly retryAfter: number) { super(429, "같은 IP에서는 30분에 3번까지 신청할 수 있습니다. 잠시 후 다시 신청해 주세요."); }
}
const randomHex = (size: number) => [...crypto.getRandomValues(new Uint8Array(size))].map(n => n.toString(16).padStart(2, "0")).join("");
function fail(status: number, message: string): never { throw new AdminError(status, message); }
function sameHash(left: string, right: string) {
  const encode = new TextEncoder();
  return crypto.subtle.timingSafeEqual(encode.encode(left), encode.encode(right));
}

async function checkTraffic(request: Request, env: Cloudflare.Env) {
  if (!env.INBOX_TRAFFIC) fail(503, "대장장이 보호 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  const client = request.headers.get("X-Inbox-Client");
  // Hash identifiers before crossing the internal binding; never store raw IPs.
  const response = await env.INBOX_TRAFFIC.fetch("https://inbox-traffic.internal/", {
    method: request.method === "GET" ? "GET" : "POST",
    headers: { "X-Traffic-IP": await digestHex(`traffic-ip:${ip}`),
      "X-Traffic-Client": await digestHex(`traffic-client:${client && /^[a-f0-9]{64}$/u.test(client) ? client : ip}`) },
    signal: AbortSignal.timeout(5000),
  });
  if (response.status === 429) fail(429, "요청이 너무 잦습니다. 1분 후 다시 시도해 주세요.");
  if (response.status !== 204) fail(503, "대장장이 보호 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
}
async function creator(request: Request) {
  const token = request.headers.get("X-Inbox-Client");
  if (!token || !/^[a-f0-9]{64}$/u.test(token)) fail(401, "페이지를 새로고침한 뒤 대장장이 예약을 열어 주세요.");
  return { token, hash: await digestHex(`creator:${token}`) };
}
async function creatorIp(request: Request) {
  // Pages or the VM's authenticated proxy supplies this header, never the body.
  const ip = request.headers.get("CF-Connecting-IP")?.trim().toLowerCase();
  return ip ? digestHex(`create-ip:${ip}`) : null;
}
function managementOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("Sec-Fetch-Site") === "cross-site") {
    fail(403, "이 사이트에서 다시 요청해주세요.");
  }
}

async function rateLimit(db: D1DatabaseSession, key: string, limit: number, seconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const result = await db.prepare(`INSERT INTO blacksmith_limits(key_hash,attempts,resets_at) VALUES (?,1,?)
    ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN resets_at<=? THEN 1 ELSE attempts+1 END,
    resets_at=CASE WHEN resets_at<=? THEN excluded.resets_at ELSE resets_at END
    WHERE resets_at<=? OR attempts<? RETURNING attempts`).bind(await digestHex(key), now + seconds, now, now, now, limit).first();
  if (!result) fail(429, "신청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.");
  // Bound cleanup work; no per-request rows containing raw IP addresses.
  await db.prepare("DELETE FROM blacksmith_limits WHERE key_hash IN (SELECT key_hash FROM blacksmith_limits WHERE resets_at<? LIMIT 20)").bind(now - 86400).run();
}

async function verifyBot(request: Request, env: Cloudflare.Env & { INBOX_VERIFY_URL?: string; INBOX_VM_TOKEN?: string }, body: Record<string, unknown>, action: string) {
  if ((!env.TURNSTILE_SECRET && !env.INBOX_VERIFY_URL) || !env.TURNSTILE_SITEKEY) fail(503, "봇 확인 서비스가 준비되지 않았습니다.");
  if (typeof body.token !== "string" || !body.token || body.token.length > 2048) fail(403, "봇 확인을 완료해 주세요.");
  let result;
  try {
    const response = await fetch(env.INBOX_VERIFY_URL ?? "https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", signal: AbortSignal.timeout(10000),
      ...(env.INBOX_VERIFY_URL ? {
        headers: { "Content-Type":"application/json", Authorization:`Bearer ${env.INBOX_VM_TOKEN}` },
        body: JSON.stringify({ token:body.token, action, hostname:new URL(request.url).hostname, remoteip:request.headers.get("CF-Connecting-IP") ?? "" }),
      } : { body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: String(body.token),
        remoteip: request.headers.get("CF-Connecting-IP") ?? "" }) }),
    });
    if (!response.ok) throw new Error("verification unavailable");
    result = await response.json() as { success?: boolean; action?: string; hostname?: string };
  } catch { fail(503, "봇 확인에 연결하지 못했습니다. 다시 시도해 주세요."); }
  // Deployment-specific hostname; tokens cannot cross production/preview hosts.
  if (result?.success !== true || result.action !== action || result.hostname !== new URL(request.url).hostname) fail(403, "봇 확인이 만료되었습니다. 다시 확인해 주세요.");
}

function publicRoom(room: RoomInfo) { return { id: room.id, name: room.name, accepting: Boolean(room.accepting), revision: room.revision, expiresAt: room.expires_at }; }
async function owner(request: Request, room: Inbox) {
  const key = request.headers.get("Authorization")?.match(/^Bearer ([a-f0-9]{64})$/u)?.[1];
  if (key && sameHash(await digestHex(`${room.id}:${key}`), room.owner_hash)) return;
  managementOrigin(request);
  await creator(request);
  const ipHash = await creatorIp(request);
  // Same-IP access is checked on every request and never issues an owner token.
  if (ipHash && room.creator_ip_hash && sameHash(ipHash, room.creator_ip_hash)) return;
  fail(401, "대장장이 예약을 연 브라우저 또는 같은 IP에서만 관리할 수 있습니다.");
}
async function applicant(request: Request, roomId: string) {
  const token = request.headers.get("X-Inbox-Applicant");
  if (!token || !/^[a-f0-9]{64}$/u.test(token)) fail(401, "페이지를 새로고침한 뒤 다시 신청해 주세요.");
  return { hash: await digestHex(`applicant:${roomId}:${token}`), ipHash: await digestHex(`submit-ip:${request.headers.get("CF-Connecting-IP") ?? "local"}`) };
}
async function hasActiveApplication(db: D1DatabaseSession, roomId: string, hash: string, ipHash: string, nickname = "") {
  return db.prepare("SELECT id FROM blacksmith_requests WHERE inbox_id=? AND status IN ('waiting','working') AND (applicant_hash=? OR submitter_ip_hash=? OR lower(nickname)=?) LIMIT 1")
    .bind(roomId, hash, ipHash, nickname.toLowerCase()).first();
}
async function requireAvailableNickname(db: D1DatabaseSession, roomId: string, nicknameKey: string, hash: string) {
  const claimed = await db.prepare("SELECT 1 FROM blacksmith_nickname_claims WHERE inbox_id=? AND nickname_key=? AND (applicant_hash IS NULL OR applicant_hash<>?)")
    .bind(roomId, nicknameKey, hash).first();
  if (claimed) fail(409, "다른 신청자가 이미 사용한 닉네임입니다. 다른 닉네임을 입력해 주세요.");
}
async function isApplicantBlocked(db: D1DatabaseSession, roomId: string, hash: string, ipHash: string) {
  return Boolean(await db.prepare("SELECT 1 FROM blacksmith_applicant_blocks WHERE inbox_id=? AND (applicant_hash=? OR ip_hash=?) LIMIT 1").bind(roomId,hash,ipHash).first());
}
async function requireApplicantAllowed(db: D1DatabaseSession, roomId: string, hash: string, ipHash: string) {
  if(await isApplicantBlocked(db,roomId,hash,ipHash))fail(403,"이번 대장장이에서는 신청이 차단되었습니다.");
}
function claimNickname(db: D1DatabaseSession, roomId: string, nicknameKey: string, hash: string, id: string, fingerprint: string) {
  return db.prepare(`INSERT INTO blacksmith_nickname_claims(inbox_id,nickname_key,applicant_hash,request_id)
    SELECT inbox_id,?,applicant_hash,id FROM blacksmith_requests WHERE inbox_id=? AND id=? AND applicant_hash=? AND fingerprint=?
    ON CONFLICT(inbox_id,nickname_key) DO UPDATE SET request_id=excluded.request_id
    WHERE blacksmith_nickname_claims.applicant_hash=excluded.applicant_hash`).bind(nicknameKey, roomId, id, hash, fingerprint);
}
async function checkSubmissionLimit(db: D1DatabaseSession, ipHash: string, now: number) {
  const usage = await db.prepare("SELECT COUNT(*) AS count,MIN(submitted_at) AS first FROM blacksmith_submissions WHERE ip_hash=? AND submitted_at>?")
    .bind(ipHash, now - submissionWindow).first<{ count: number; first: number | null }>();
  if (usage && usage.count >= 3) throw new SubmissionLimitError(Math.max(1, Math.ceil(((usage.first ?? now) + submissionWindow - now) / 1000)));
}

export const onRequest: PagesFunction<Cloudflare.Env> = async ({ request, env }) => {
  if (env.STARFORCE_INBOX_ENABLED !== "true" || !env.STARFORCE_INBOX_DB) return adminJson({ error: "Not found" }, 404);
  try {
    const remote = await proxyInboxRequest(request, env, "public");
    if (remote) return remote;
    // Before parsing bodies, looking up rooms or authenticating: failures and
    // unknown URLs consume the same limits as successful requests, without D1.
    await checkTraffic(request, env);
    const url = new URL(request.url), method = request.method;
    const parts = url.pathname.replace(/^\/api\/blacksmith-inboxes\/?/u, "").split("/").filter(Boolean);
    const db = env.STARFORCE_INBOX_DB.withSession("first-primary");
    if (method !== "GET") requireSameOrigin(request);
    if (parts.length === 1 && parts[0] === "config" && method === "GET") {
      return adminJson({ sitekey: env.TURNSTILE_SITEKEY ?? "", ipRestricted: Boolean(ipRestriction(env)), ipRestriction: ipRestriction(env) });
    }
    if (parts.length === 1 && parts[0] === "managed" && method === "GET") {
      managementOrigin(request);
      await creator(request);
      const ipHash = await creatorIp(request);
      if (!ipHash) fail(503, "접속 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      const found = await db.prepare(`SELECT id,name,accepting,revision,expires_at FROM blacksmith_inboxes
        WHERE creator_ip_hash=? AND expires_at>? ORDER BY created_at DESC,id DESC LIMIT 1`)
        .bind(ipHash, Date.now()).first<RoomInfo>();
      return adminJson({ room: found ? publicRoom(found) : null });
    }
    if (parts.length === 1 && parts[0] === "lookup") {
      if (method !== "POST") fail(405, "봇 확인 후 대장장이를 찾아 주세요.");
      const body = await readAdminJson(request, 4096);
      if (!isRecord(body)) fail(400, "대장장이 이름을 확인해 주세요.");
      const name = inboxLabel(body.name);
      await verifyBot(request, env, body, "inbox_lookup");
      const found = await db.prepare(`SELECT id,name FROM blacksmith_inboxes
        WHERE lower(name)=lower(?) AND name=? COLLATE BINARY AND expires_at>? LIMIT 1`)
        .bind(name, name, Date.now()).first<{ id: string; name: string }>();
      if (!found) fail(404, "입력한 이름의 대장장이를 찾을 수 없습니다. 이름을 정확히 입력해 주세요.");
      return adminJson({ room: found });
    }
    if (!parts.length && method === "POST") {
      const identity = await creator(request);
      const creatorIpHash = await creatorIp(request);
      if (!creatorIpHash) fail(503, "접속 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      const blocked = () => db.prepare("SELECT 1 FROM blacksmith_creator_ip_blocks WHERE ip_hash=?").bind(creatorIpHash).first();
      if (await blocked()) fail(403, "이 IP에서는 대장장이 예약을 열 수 없습니다.");
      await rateLimit(db, `create:${request.headers.get("CF-Connecting-IP") ?? "local"}`, 5, 3600);
      const body = await readAdminJson(request, 8192);
      if (!isRecord(body)) fail(400, "대장장이 정보를 확인해 주세요.");
      const name = inboxLabel(body.name);
      await verifyBot(request, env, body, "inbox_create");
      const id = randomHex(12), now = Date.now();
      const browserToken = await digestHex(`owner:${identity.token}:${id}`);
      const [, inserted] = await db.batch([
        db.prepare("DELETE FROM blacksmith_inboxes WHERE creator_hash=? AND expires_at<=?").bind(identity.hash, now),
        db.prepare(`INSERT INTO blacksmith_inboxes(id,name,owner_hash,created_at,expires_at,creator_hash,creator_ip_hash)
          SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM blacksmith_inboxes WHERE creator_hash=?)
          AND NOT EXISTS (SELECT 1 FROM blacksmith_inboxes WHERE creator_ip_hash=? AND expires_at>?)
          AND NOT EXISTS (SELECT 1 FROM blacksmith_inboxes WHERE lower(name)=lower(?) AND expires_at>?)
          AND NOT EXISTS (SELECT 1 FROM blacksmith_creator_ip_blocks WHERE ip_hash=?)
          AND (SELECT COUNT(*) FROM blacksmith_inboxes WHERE expires_at>?)<?`)
          .bind(id, name, await digestHex(`${id}:${browserToken}`), now, now + INBOX_LIFETIME_MS, identity.hash, creatorIpHash, identity.hash, creatorIpHash, now, name, now, creatorIpHash, now, INBOX_ROOM_LIMIT),
      ]);
      if (inserted.meta.changes) return adminJson({ id, name, browserToken }, 201);
      if (await blocked()) fail(403, "이 IP에서는 대장장이 예약을 열 수 없습니다.");
      const existing = await db.prepare("SELECT * FROM blacksmith_inboxes WHERE creator_hash=? AND expires_at>?").bind(identity.hash, now).first<Inbox>();
      if (existing) {
        // Recover a lost creation response without creating a second inbox or
        // exposing another browser's owner key. Legacy keys remain unchanged.
        const key = await digestHex(`owner:${identity.token}:${existing.id}`);
        if (sameHash(await digestHex(`${existing.id}:${key}`), existing.owner_hash)) return adminJson({ id: existing.id, name: existing.name, browserToken: key });
        fail(409, "이 브라우저에 이미 열린 대장장이 예약이 있습니다.");
      }
      if (await db.prepare("SELECT 1 FROM blacksmith_inboxes WHERE lower(name)=lower(?) AND expires_at>? LIMIT 1").bind(name, now).first()) {
        fail(409, "이미 사용 중인 대장장이 이름입니다. 다른 이름을 입력해 주세요.");
      }
      if (await db.prepare("SELECT 1 FROM blacksmith_inboxes WHERE creator_ip_hash=? AND expires_at>? LIMIT 1").bind(creatorIpHash, now).first()) {
        fail(409, "같은 IP에서 이미 대장장이를 열었습니다. 기존 대장장이가 종료되거나 만료된 후 다시 열어 주세요.");
      }
      fail(503, "현재 열 수 있는 대장장이 수를 초과했습니다. 잠시 후 다시 시도해 주세요.");
    }
    if (!/^[a-f0-9]{24}$/u.test(parts[0] ?? "")) fail(404, "대장장이를 찾을 수 없습니다.");
    let room = await db.prepare("SELECT * FROM blacksmith_inboxes WHERE id=?").bind(parts[0]).first<Inbox>();
    if (!room) fail(404, "이미 종료되었거나 존재하지 않는 대장장이입니다.");
    if (room.expires_at <= Date.now()) {
      // Recheck the deadline in SQL so a concurrent valid submission that
      // extended it is not removed by a stale poll. Cascades remove requests.
      await db.prepare("DELETE FROM blacksmith_inboxes WHERE id=? AND expires_at<=?").bind(room.id, Date.now()).run();
      room = await db.prepare("SELECT * FROM blacksmith_inboxes WHERE id=?").bind(parts[0]).first<Inbox>();
      if (!room) fail(410, "12시간 동안 새 신청이 없어 대장장이가 자동 종료되었습니다.");
    }
    if (parts.length === 2 && parts[1] === "public" && method === "GET") return adminJson(publicRoom(room));

    if (parts.length === 2 && parts[1] === "my-request" && ["GET", "PATCH", "DELETE"].includes(method)) {
      if(method==="PATCH") requireApplicantIp(env);
      const identity = await applicant(request, room.id);
      if (method === "GET") {
        const mine = await db.prepare("SELECT id,nickname,item_count AS itemCount,status,created_at AS createdAt,items,version FROM blacksmith_requests WHERE inbox_id=? AND applicant_hash=? AND status IN ('waiting','working') LIMIT 1")
          .bind(room.id, identity.hash).first<{ id: string; nickname: string; itemCount: number; status: string; createdAt: number; items: string; version: number }>();
        const completed = mine ? null : await db.prepare("SELECT id,completed_at AS completedAt FROM blacksmith_requests WHERE inbox_id=? AND applicant_hash=? AND status='done' AND completed_at>? ORDER BY completed_at DESC LIMIT 1")
          .bind(room.id,identity.hash,Date.now()-300000).first<{id:string;completedAt:number}>();
        return adminJson({ room: publicRoom(room), application: mine ? { ...mine, items: JSON.parse(mine.items) } : null,
          completed: completed ? {...completed,remainingMs:Math.max(0,completed.completedAt+300000-Date.now())} : null,
          banned: await isApplicantBlocked(db,room.id,identity.hash,identity.ipHash), ipRestricted: Boolean(ipRestriction(env)), ipRestriction: ipRestriction(env),
          blocked: Boolean(mine || await hasActiveApplication(db, room.id, identity.hash, identity.ipHash)) });
      }
      await requireApplicantAllowed(db,room.id,identity.hash,identity.ipHash);
      const body = await readAdminJson(request, method === "PATCH" ? 48_000 : 1024);
      if (!isRecord(body) || typeof body.id !== "string" || !/^[a-f0-9-]{36}$/u.test(body.id)) fail(400, "신청 번호를 확인해 주세요.");
      const record = await db.prepare("SELECT * FROM blacksmith_requests WHERE inbox_id=? AND id=? AND applicant_hash=?")
        .bind(room.id, body.id, identity.hash).first<Application>();
      if (!record) fail(404, "신청을 찾을 수 없습니다.");
      if (record.status !== "waiting") fail(409, "대기중인 신청만 수정하거나 철회할 수 있습니다.");
      if (method === "DELETE") {
        // Release only this waiting request's names, including names used before
        // an edit. Both guarded deletions share a transaction: a concurrent start
        // either wins with its reservation intact, or finds the request withdrawn.
        const [, result] = await db.batch([
          db.prepare(`DELETE FROM blacksmith_nickname_claims WHERE inbox_id=? AND request_id=?
            AND EXISTS (SELECT 1 FROM blacksmith_requests WHERE inbox_id=? AND id=? AND applicant_hash=? AND status='waiting')`)
            .bind(room.id, body.id, room.id, body.id, identity.hash),
          db.prepare("DELETE FROM blacksmith_requests WHERE inbox_id=? AND id=? AND applicant_hash=? AND status='waiting'")
            .bind(room.id, body.id, identity.hash),
        ]);
        if (!result.meta.changes) fail(409, "처리 상태가 바뀌어 철회할 수 없습니다. 신청 상태를 다시 확인해 주세요.");
        return adminJson({ withdrawn: true });
      }
      if (!room.accepting) fail(409, "현재 접수가 중지되어 있습니다.");
      const nickname = inboxLabel(body.nickname, 20), items = inboxItems(body.items);
      const nicknameKey = nickname.toLowerCase();
      const itemsJson = JSON.stringify(items), fingerprint = await digestHex(`${nickname}:${itemsJson}`);
      if (record.fingerprint === fingerprint) return adminJson({ id: record.id, updated: true });
      // Only successful applicant edits increment version. Identical retries
      // above do not spend another edit, including a retry of the fifth save.
      if (record.version >= INBOX_EDIT_LIMIT) fail(409, "신청 수정은 접수 건당 최대 5회까지 가능합니다. 수정 기회를 모두 사용했습니다.");
      if (!Number.isInteger(body.version) || body.version !== record.version) fail(409, "신청 내용이 다른 창에서 수정되었습니다. 최신 내용을 다시 확인해 주세요.");
      await requireAvailableNickname(db, room.id, nicknameKey, identity.hash);
      await verifyBot(request, env, body, "inbox_submit");
      const [result] = await db.batch([db.prepare(`UPDATE blacksmith_requests SET nickname=?,items=?,item_count=?,fingerprint=?,version=version+1
        WHERE inbox_id=? AND id=? AND applicant_hash=? AND status='waiting' AND version=? AND version<?
        AND NOT EXISTS (SELECT 1 FROM blacksmith_applicant_blocks WHERE inbox_id=blacksmith_requests.inbox_id AND (applicant_hash=blacksmith_requests.applicant_hash OR ip_hash=blacksmith_requests.submitter_ip_hash))
        AND NOT EXISTS (SELECT 1 FROM blacksmith_nickname_claims WHERE inbox_id=? AND nickname_key=? AND (applicant_hash IS NULL OR applicant_hash<>?))
        AND NOT EXISTS (SELECT 1 FROM blacksmith_requests AS other WHERE other.inbox_id=? AND other.id<>? AND lower(other.nickname)=? AND other.status IN ('waiting','working'))`)
        .bind(nickname, itemsJson, items.reduce((n, item) => n + item.quantity, 0), fingerprint, room.id, body.id, identity.hash, record.version, INBOX_EDIT_LIMIT,
          room.id, nicknameKey, identity.hash, room.id, body.id, nicknameKey),
        claimNickname(db, room.id, nicknameKey, identity.hash, body.id, fingerprint)]);
      if (!result.meta.changes) {
        await requireAvailableNickname(db, room.id, nicknameKey, identity.hash);
        fail(409, "신청 내용이나 처리 상태가 바뀌어 수정하지 못했습니다. 다시 확인해 주세요.");
      }
      return adminJson({ id: record.id, updated: true });
    }

    if (parts.length === 2 && parts[1] === "requests" && method === "POST") {
      requireApplicantIp(env);
      const body = await readAdminJson(request, 48_000);
      if (!isRecord(body)) fail(400, "신청 내용을 확인해 주세요.");
      const identity = await applicant(request, room.id);
      const nickname = inboxLabel(body.nickname, 20), items = inboxItems(body.items);
      await requireApplicantAllowed(db,room.id,identity.hash,identity.ipHash);
      const nicknameKey = nickname.toLowerCase();
      const id = body.id;
      if (typeof id !== "string" || !/^[a-f0-9-]{36}$/u.test(id)) fail(400, "신청 번호가 올바르지 않습니다.");
      const itemsJson = JSON.stringify(items), fingerprint = await digestHex(`${nickname}:${itemsJson}`);
      // Retry after a lost response is idempotent, but a different payload cannot reuse its ID.
      const previous = await db.prepare("SELECT fingerprint,applicant_hash FROM blacksmith_requests WHERE inbox_id=? AND id=?").bind(room.id, id).first<{ fingerprint: string; applicant_hash: string | null }>();
      if (previous) {
        if (previous.fingerprint !== fingerprint || previous.applicant_hash !== identity.hash) fail(409, "신청 번호가 이미 사용되었습니다.");
        return adminJson({ id, submitted: true });
      }
      if (!room.accepting) fail(409, "현재 접수가 중지되어 있습니다.");
      await requireAvailableNickname(db, room.id, nicknameKey, identity.hash);
      if (await hasActiveApplication(db, room.id, identity.hash, identity.ipHash, nickname)) fail(409, "이미 대기중이거나 진행중인 신청이 있습니다. 기존 신청을 확인해 주세요.");
      await checkSubmissionLimit(db, identity.ipHash, Date.now());
      await verifyBot(request, env, body, "inbox_submit");
      const now = Date.now();
      // Admission and quota accounting share one D1 transaction. Withdrawals,
      // rejection and inbox deletion never refund the rolling submission limit.
      const [inserted] = await db.batch([db.prepare(`INSERT INTO blacksmith_requests(id,inbox_id,nickname,items,item_count,fingerprint,created_at,applicant_hash,submitter_ip_hash)
        SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM blacksmith_requests WHERE inbox_id=? AND status IN ('waiting','working'))<?
        AND NOT EXISTS (SELECT 1 FROM blacksmith_applicant_blocks WHERE inbox_id=? AND (applicant_hash=? OR ip_hash=?))
        AND NOT EXISTS (SELECT 1 FROM blacksmith_requests WHERE id=?)
        AND NOT EXISTS (SELECT 1 FROM blacksmith_submissions WHERE request_id=?)
        AND NOT EXISTS (SELECT 1 FROM blacksmith_nickname_claims WHERE inbox_id=? AND nickname_key=? AND (applicant_hash IS NULL OR applicant_hash<>?))
        AND NOT EXISTS (SELECT 1 FROM blacksmith_requests WHERE inbox_id=? AND status IN ('waiting','working') AND (applicant_hash=? OR submitter_ip_hash=? OR lower(nickname)=?))
        AND (SELECT COUNT(*) FROM blacksmith_submissions WHERE ip_hash=? AND submitted_at>?)<3
        AND EXISTS (SELECT 1 FROM blacksmith_inboxes WHERE id=? AND accepting=1 AND expires_at>?)`)
        .bind(id, room.id, nickname, itemsJson, items.reduce((n, item) => n + item.quantity, 0), fingerprint, now, identity.hash, identity.ipHash,
          room.id, INBOX_ACTIVE_LIMIT, room.id,identity.hash,identity.ipHash, id, id, room.id, nicknameKey, identity.hash, room.id, identity.hash, identity.ipHash, nicknameKey, identity.ipHash, now - submissionWindow, room.id, now),
        db.prepare(`INSERT INTO blacksmith_submissions(request_id,ip_hash,submitted_at)
          SELECT id,submitter_ip_hash,created_at FROM blacksmith_requests WHERE id=? AND inbox_id=? AND applicant_hash=? AND fingerprint=?
          ON CONFLICT(request_id) DO NOTHING`).bind(id, room.id, identity.hash, fingerprint),
        claimNickname(db, room.id, nicknameKey, identity.hash, id, fingerprint),
      ]);
      if (!inserted.meta.changes) {
        await requireApplicantAllowed(db,room.id,identity.hash,identity.ipHash);
        const retry = await db.prepare("SELECT fingerprint,applicant_hash FROM blacksmith_requests WHERE inbox_id=? AND id=?")
          .bind(room.id, id).first<{ fingerprint: string; applicant_hash: string | null }>();
        if (retry?.fingerprint === fingerprint && retry.applicant_hash === identity.hash) return adminJson({ id, submitted: true });
        await requireAvailableNickname(db, room.id, nicknameKey, identity.hash);
        if (await hasActiveApplication(db, room.id, identity.hash, identity.ipHash, nickname)) fail(409, "이미 대기중이거나 진행중인 신청이 있습니다. 기존 신청을 확인해 주세요.");
        await checkSubmissionLimit(db, identity.ipHash, Date.now());
        fail(409, "접수가 마감되었거나 대기열이 가득 찼습니다.");
      }
      await db.prepare("DELETE FROM blacksmith_submissions WHERE request_id IN (SELECT request_id FROM blacksmith_submissions WHERE submitted_at<=? LIMIT 20)").bind(now - submissionWindow).run();
      return adminJson({ id, submitted: true }, 201);
    }

    await owner(request, room);
    if(parts.length===4 && parts[1]==="requests" && /^[a-f0-9-]{36}$/u.test(parts[2]) && parts[3]==="block" && method==="POST") {
      const body=await readAdminJson(request,1024);
      if(!isRecord(body)||Object.keys(body).length)fail(400,"차단 요청을 확인해 주세요.");
      await blockInboxApplicant(db,room.id,parts[2]);
      return adminJson({ok:true});
    }
    if(parts.length===4 && parts[1]==="requests" && /^[a-f0-9-]{36}$/u.test(parts[2]) && parts[3]==="block" && method==="DELETE") {
      const body=await readAdminJson(request,1024);
      if(!isRecord(body)||Object.keys(body).some(key=>key!=="blockedAt")||!Number.isSafeInteger(body.blockedAt)||Number(body.blockedAt)<0)fail(400,"차단 해제 요청을 확인해 주세요.");
      await unblockInboxApplicant(db,room.id,parts[2],Number(body.blockedAt));
      return adminJson({ok:true});
    }
    if (!room.creator_hash && request.headers.has("X-Inbox-Client")) {
      const identity = await creator(request);
      // Enrol a pre-existing inbox only after successful owner authentication.
      await db.prepare(`UPDATE blacksmith_inboxes SET creator_hash=? WHERE id=? AND creator_hash IS NULL
        AND NOT EXISTS (SELECT 1 FROM blacksmith_inboxes WHERE creator_hash=?)`).bind(identity.hash, room.id, identity.hash).run();
    }
    if (parts.length === 1 && method === "DELETE") {
      await db.prepare("DELETE FROM blacksmith_inboxes WHERE id=?").bind(room.id).run();
      return adminJson({ ok: true });
    }
    if (parts.length === 1 && method === "GET") {
      if (url.searchParams.get("revision") === String(room.revision)) return adminJson({ unchanged: true, room: publicRoom(room) });
      // Only the owner can request equipment for local cost estimates. Unchanged
      // polls still read just the inbox row and never resend equipment.
      const includeItems = url.searchParams.get("includeItems") === "1";
      // The database bounds active admission and completed history. Read all
      // retained summaries so older inboxes above the new active limit keep
      // every pending application, rather than truncating or deleting them.
      const rows = await db.prepare(`SELECT id,nickname,item_count AS itemCount,status,created_at AS createdAt,version,blocked_at AS blockedAt
        FROM blacksmith_request_records WHERE inbox_id=? ORDER BY created_at ASC,id ASC`)
        .bind(room.id).all<{ id: string; nickname: string; itemCount: number; status: string; createdAt: number; version: number }>();
      const matching = inboxRequestsForView(rows.results, null, (url.searchParams.get("search") ?? "").slice(0, 32));
      const active = matching.filter(item => ["waiting","working"].includes(item.status)), completed = matching.filter(item => ["done","blocked"].includes(item.status));
      const pageCount = Math.max(1, Math.ceil(completed.length / 20));
      const historyPage = Math.min(pageCount - 1, Math.max(0, Math.floor(Number(url.searchParams.get("historyPage")) || 0)));
      const selected = [...active, ...completed.slice(historyPage * 20, (historyPage + 1) * 20)];
      const itemRows = includeItems && selected.length ? await db.prepare(`SELECT id,nickname,item_count AS itemCount,status,created_at AS createdAt,version,blocked_at AS blockedAt,items FROM blacksmith_request_records WHERE inbox_id=? AND id IN (${selected.map(() => "?").join(",")})`)
        .bind(room.id, ...selected.map(item => item.id)).all<{ id: string; nickname: string; itemCount: number; status: string; createdAt: number; version: number; items: string }>() : null;
      const itemsById = new Map(itemRows?.results.map(row => [row.id, row]));
      // A rejection/edit may race with the metadata query. Never fabricate an
      // empty equipment list, and keep each request's version with its payload.
      const requests = selected.filter(summary => !includeItems || itemsById.has(summary.id)).map(summary => {
        const row = itemsById.get(summary.id);
        return row ? { ...row, items: row.items === null ? null : JSON.parse(row.items) } : summary;
      });
      return adminJson({ room: publicRoom(room), requests, history: { page: historyPage, pages: pageCount, total: completed.length },
        counts: { waiting: rows.results.filter(item => item.status === "waiting").length, working: rows.results.filter(item => item.status === "working").length,
          done: rows.results.filter(item => item.status === "done").length, blocked: rows.results.filter(item => item.status === "blocked").length } });
    }
    if (parts.length === 1 && method === "PATCH") {
      const body = await readAdminJson(request, 4096);
      if (!isRecord(body) || typeof body.accepting !== "boolean" || Object.hasOwn(body, "code")) fail(400, "접수 설정을 확인해 주세요.");
      await db.prepare("UPDATE blacksmith_inboxes SET accepting=?,revision=revision+1 WHERE id=?")
        .bind(body.accepting ? 1 : 0, room.id).run();
      return adminJson({ ok: true });
    }
    if (parts.length === 3 && parts[1] === "requests" && /^[a-f0-9-]{36}$/u.test(parts[2])) {
      const record = await db.prepare("SELECT * FROM blacksmith_requests WHERE inbox_id=? AND id=?").bind(room.id, parts[2]).first<Application>();
      if (!record) fail(404, "신청을 찾을 수 없습니다.");
      if (method === "GET") return adminJson({ items: JSON.parse(record.items), version: record.version, status: record.status });
      if (method === "PATCH") {
        const body = await readAdminJson(request, 1024);
        if (!isRecord(body) || typeof body.status !== "string" || !Object.hasOwn(INBOX_STATUSES, body.status)) fail(400, "처리 상태를 확인해 주세요.");
        if (body.version !== undefined && (!Number.isInteger(body.version) || body.version !== record.version)) fail(409, "신청 내용이 수정되었습니다. 최신 내용을 다시 불러와 주세요.");
        const updated = await db.prepare(`UPDATE blacksmith_requests SET status=? WHERE inbox_id=? AND id=? AND version=?
          AND (?='done' OR status IN ('waiting','working') OR ((SELECT COUNT(*) FROM blacksmith_requests WHERE inbox_id=? AND status IN ('waiting','working'))<? AND NOT EXISTS (
            SELECT 1 FROM blacksmith_requests AS other WHERE other.inbox_id=? AND other.id<>? AND other.status IN ('waiting','working')
            AND (other.applicant_hash=? OR other.submitter_ip_hash=? OR lower(other.nickname)=?))
            AND NOT EXISTS (SELECT 1 FROM blacksmith_nickname_claims WHERE inbox_id=? AND nickname_key=?
              AND request_id IS NOT ? AND (applicant_hash IS NULL OR applicant_hash IS NOT ?))))`)
          .bind(body.status, room.id, parts[2], record.version, body.status, room.id, INBOX_ACTIVE_LIMIT, room.id, parts[2], record.applicant_hash, record.submitter_ip_hash, record.nickname.toLowerCase(),
            room.id, record.nickname.toLowerCase(), record.id, record.applicant_hash).run();
        if (!updated.meta.changes) fail(409, "신청 내용이나 처리 상태가 바뀌었습니다. 목록을 다시 확인해 주세요.");
        if (body.status !== "done" && record.applicant_hash) await claimNickname(db, room.id, record.nickname.toLowerCase(), record.applicant_hash, record.id, record.fingerprint).run();
        return adminJson({ ok: true });
      }
      if (method === "DELETE") {
        await db.batch([
          db.prepare("DELETE FROM blacksmith_nickname_claims WHERE inbox_id=? AND request_id=?").bind(room.id, parts[2]),
          db.prepare("DELETE FROM blacksmith_requests WHERE inbox_id=? AND id=?").bind(room.id, parts[2]),
        ]);
        return adminJson({ ok: true });
      }
    }
    return adminJson({ error: "지원하지 않는 요청입니다." }, 405);
  } catch (error) {
    if (error instanceof Error && error.message.includes("blacksmith_active_capacity")) {
      return adminJson({ error: `대기·진행 중 신청은 합계 ${INBOX_ACTIVE_LIMIT}건까지 접수할 수 있습니다.` },409);
    }
    if (error instanceof AdminError) return adminJson({ error: error.message }, error.status, error.status === 429 ? { "Retry-After": String(error instanceof SubmissionLimitError ? error.retryAfter : 60) } : {});
    if (error instanceof Error && !(error.message.startsWith("D1_") || error.message.includes("SQLITE"))) {
      // Validation helpers throw ordinary errors; avoid returning platform details.
      const allowed = /장비|이름|성수|신청할/u.test(error.message);
      if (allowed) return adminJson({ error: error.message }, 400);
    }
    return adminJson({ error: "대장장이 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요." }, 503);
  }
};
