import { AdminError, adminFailure, adminJson, isRecord, readAdminJson, requireAdmin, requireSameOrigin } from "../../../_lib/starforce-admin";
import { INBOX_ROOM_LIMIT } from "../../../../src/shared/blacksmith-inbox-schema.js";
import { proxyInboxRequest } from "../../../_lib/blacksmith-inbox-vm";
import { readInboxHistory } from "../../../_lib/blacksmith-inbox-history";
import { readInboxRequests } from "../../../_lib/blacksmith-inbox-requests";
import { blockInboxApplicant, unblockInboxApplicant } from "../../../_lib/blacksmith-applicant-block";

const PAGE_SIZE = 20;
type Counts = { total: number; active: number; accepting: number; paused: number; expired: number };

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  try {
    // A creator/applicant capability never grants site administrator access.
    await requireAdmin(request, env);
    if (env.STARFORCE_INBOX_ENABLED !== "true" || !env.STARFORCE_INBOX_DB) throw new AdminError(404, "대장장이 관리가 활성화되지 않았습니다.");
    if (request.method !== "GET") requireSameOrigin(request);
    const remote = await proxyInboxRequest(request, env, "admin");
    if (remote) return remote;
    return await handleInboxAdmin(request, env.STARFORCE_INBOX_DB.withSession("first-primary"));
  } catch (error) { return adminFailure(error); }
};

// Authenticated by the Pages administrator session or the private VM bridge.
export async function handleInboxAdmin(request: Request, db: D1DatabaseSession): Promise<Response> {
  try {
    const url = new URL(request.url), method = request.method;
    const parts = url.pathname.replace(/^\/api\/admin\/blacksmith-inboxes\/?/u, "").split("/").filter(Boolean);
    if (method !== "GET") requireSameOrigin(request);
    const now = Date.now();
    if (parts[0] === "history") {
      if (method !== "GET") return adminJson({error:"종료 이력은 조회만 가능합니다."},405,{Allow:"GET"});
      return await readInboxHistory(db,url,parts,now);
    }
    if (parts.length === 2 && /^[a-f0-9]{24}$/u.test(parts[0]) && parts[1] === "requests") {
      if (method !== "GET") return adminJson({error:"신청 내역은 조회만 가능합니다."},405,{Allow:"GET"});
      return await readInboxRequests(db,url,parts[0]);
    }
    if (parts.length === 4 && /^[a-f0-9]{24}$/u.test(parts[0]) && parts[1] === "requests" && /^[a-f0-9-]{36}$/u.test(parts[2]) && parts[3] === "block") {
      if (!["POST","DELETE"].includes(method)) return adminJson({error:"지원하지 않는 요청입니다."},405,{Allow:"POST, DELETE"});
      const body = await readAdminJson(request,1024);
      if (method === "DELETE") {
        if (!isRecord(body) || Object.keys(body).some(key=>key!=="blockedAt") || !Number.isSafeInteger(body.blockedAt) || Number(body.blockedAt)<0) throw new AdminError(400,"차단 해제 요청을 확인해 주세요.");
        await unblockInboxApplicant(db,parts[0],parts[2],Number(body.blockedAt));
        return adminJson({ok:true});
      }
      if (!isRecord(body) || Object.keys(body).some(key => key !== "version") || !Number.isSafeInteger(body.version) || Number(body.version)<0) throw new AdminError(400,"차단 요청을 확인해 주세요.");
      await blockInboxApplicant(db,parts[0],parts[2],Number(body.version));
      return adminJson({ok:true});
    }
    if (parts[0] === "blocked-ips") {
      if (parts.length === 1 && method === "GET") {
        const pageText = url.searchParams.get("page") ?? "0";
        if (!/^\d{1,6}$/u.test(pageText)) throw new AdminError(400, "페이지를 확인해 주세요.");
        const total = Number((await db.prepare("SELECT COUNT(*) AS total FROM blacksmith_creator_ip_blocks").first<{ total: number }>())?.total ?? 0);
        const pages = Math.max(1,Math.ceil(total/PAGE_SIZE)), page = Math.min(Number(pageText),pages-1);
        const rows = await db.prepare("SELECT id,source_name AS sourceName,blocked_at AS blockedAt FROM blacksmith_creator_ip_blocks ORDER BY blocked_at DESC,id DESC LIMIT ? OFFSET ?")
          .bind(PAGE_SIZE,page*PAGE_SIZE).all();
        return adminJson({ blocks: rows.results, total, page, pages });
      }
      if (parts.length === 2 && /^[a-f0-9-]{36}$/u.test(parts[1]) && method === "DELETE") {
        const body = await readAdminJson(request,1024);
        if (!isRecord(body) || Object.keys(body).length) throw new AdminError(400, "변경 내용을 확인해 주세요.");
        const result = await db.prepare("DELETE FROM blacksmith_creator_ip_blocks WHERE id=?").bind(parts[1]).run();
        if (!result.meta.changes) throw new AdminError(404, "이미 해제되었거나 존재하지 않는 차단 기록입니다.");
        return adminJson({ ok:true });
      }
      throw new AdminError(404, "차단 기록을 찾을 수 없습니다.");
    }
    if (parts.length === 2 && /^[a-f0-9]{24}$/u.test(parts[0]) && parts[1] === "block-creator-ip" && method === "POST") {
      const body = await readAdminJson(request,1024);
      if (!isRecord(body) || Object.keys(body).some(key => key !== "revision") || !Number.isSafeInteger(body.revision) || Number(body.revision)<0) throw new AdminError(400, "변경 내용을 확인해 주세요.");
      const room = await db.prepare("SELECT name,creator_ip_hash,revision FROM blacksmith_inboxes WHERE id=?").bind(parts[0]).first<{ name:string; creator_ip_hash:string|null; revision:number }>();
      if (!room) throw new AdminError(404, "대장장이를 찾을 수 없습니다.");
      if (!room.creator_ip_hash) throw new AdminError(409, "생성 IP 기록이 없어 차단할 수 없습니다.");
      if (room.revision !== body.revision) throw new AdminError(409, "대장장이 정보가 변경되었습니다. 새로고침 후 다시 확인해 주세요.");
      const inserted = await db.prepare(`INSERT INTO blacksmith_creator_ip_blocks(id,ip_hash,source_name,blocked_at)
        SELECT ?,creator_ip_hash,name,? FROM blacksmith_inboxes WHERE id=? AND revision=? AND creator_ip_hash IS NOT NULL
        ON CONFLICT(ip_hash) DO NOTHING`).bind(crypto.randomUUID(),now,parts[0],body.revision).run();
      if (!inserted.meta.changes && !await db.prepare("SELECT 1 FROM blacksmith_creator_ip_blocks WHERE ip_hash=?").bind(room.creator_ip_hash).first()) {
        throw new AdminError(409, "대장장이 정보가 변경되었습니다. 새로고침 후 다시 확인해 주세요.");
      }
      return adminJson({ ok:true });
    }
    if (!parts.length && method === "GET") {
      const filter = url.searchParams.get("status") ?? "all";
      const conditions: Record<string, string> = {
        all: "1=1", accepting: "expires_at>? AND accepting=1", paused: "expires_at>? AND accepting=0", expired: "expires_at<=?",
      };
      const sort = url.searchParams.get("sort") ?? "created";
      const orders: Record<string, string> = {
        created: "created_at DESC,id DESC",
        submitted: "last_submitted_at DESC,created_at DESC,id DESC",
        completed: "last_completed_at DESC,created_at DESC,id DESC",
      };
      const search = (url.searchParams.get("q") ?? "").trim().normalize("NFC");
      const pageText = url.searchParams.get("page") ?? "0";
      if (!Object.hasOwn(conditions, filter) || !Object.hasOwn(orders, sort) || search.length > 64 || /[\p{Cc}\p{Cf}]/u.test(search) || !/^\d{1,6}$/u.test(pageText)) {
        throw new AdminError(400, "검색 조건을 확인해 주세요.");
      }
      const parameters: (number | string)[] = filter === "all" ? [] : [now];
      let where = conditions[filter];
      if (search) {
        // Treat percent/underscore as literal text, not unrestricted wildcards.
        where += " AND name LIKE ? ESCAPE '\\'";
        parameters.push(`%${search.replace(/[\\%_]/gu, "\\$&")}%`);
      }
      const [overview, matched] = await db.batch<{ total: number } & Partial<Counts>>([
        db.prepare(`SELECT COUNT(*) AS total,
          COALESCE(SUM(expires_at>?),0) AS active,
          COALESCE(SUM(expires_at>? AND accepting=1),0) AS accepting,
          COALESCE(SUM(expires_at>? AND accepting=0),0) AS paused,
          COALESCE(SUM(expires_at<=?),0) AS expired FROM blacksmith_inboxes`).bind(now,now,now,now),
        db.prepare(`SELECT COUNT(*) AS total FROM blacksmith_inboxes WHERE ${where}`).bind(...parameters),
      ]);
      const total = Number(matched.results[0]?.total ?? 0), pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const page = Math.min(Number(pageText), pages - 1);
      const rows = await db.prepare(`SELECT id,name,accepting,revision,created_at AS createdAt,expires_at AS expiresAt,
        last_submitted_at AS lastSubmittedAt,last_completed_at AS lastCompletedAt,
        creator_ip_hash IS NOT NULL AS creatorIpKnown,
        (SELECT id FROM blacksmith_creator_ip_blocks WHERE ip_hash=b.creator_ip_hash) AS creatorIpBlockId,
        (SELECT COUNT(*) FROM blacksmith_requests r WHERE r.inbox_id=b.id AND status='waiting') AS waiting,
        (SELECT COUNT(*) FROM blacksmith_requests r WHERE r.inbox_id=b.id AND status='working') AS working,
        (SELECT COUNT(*) FROM blacksmith_requests r WHERE r.inbox_id=b.id AND status='done') AS done
        FROM blacksmith_inboxes b WHERE ${where} ORDER BY ${orders[sort]} LIMIT ? OFFSET ?`)
        .bind(...parameters,PAGE_SIZE,page * PAGE_SIZE).all();
      return adminJson({ summary: { ...(overview.results[0] as Counts), limit: INBOX_ROOM_LIMIT },
        inboxes: rows.results.map(row => ({ ...row, accepting: Boolean(row.accepting), creatorIpKnown: Boolean(row.creatorIpKnown), expired: Number(row.expiresAt)<=now })),
        page, pages, total, pageSize: PAGE_SIZE });
    }
    if (parts.length !== 1 || !/^[a-f0-9]{24}$/u.test(parts[0])) throw new AdminError(404, "대장장이를 찾을 수 없습니다.");
    if (method !== "PATCH" && method !== "DELETE") return adminJson({ error: "지원하지 않는 요청입니다." },405,{ Allow: "PATCH, DELETE" });
    const body = await readAdminJson(request,1024);
    if (!isRecord(body) || !Number.isSafeInteger(body.revision) || Number(body.revision)<0 ||
      Object.keys(body).some(key => !["revision", ...(method === "PATCH" ? ["accepting"] : [])].includes(key)) ||
      (method === "PATCH" && typeof body.accepting !== "boolean")) throw new AdminError(400, "변경 내용을 확인해 주세요.");
    const result = method === "DELETE"
      ? (await db.batch([
        db.prepare("UPDATE blacksmith_inboxes SET termination_reason='admin' WHERE id=? AND revision=?").bind(parts[0],body.revision),
        db.prepare("DELETE FROM blacksmith_inboxes WHERE id=? AND revision=?").bind(parts[0],body.revision),
      ]))[1]
      : await db.prepare("UPDATE blacksmith_inboxes SET accepting=?,revision=revision+1 WHERE id=? AND revision=? AND expires_at>?")
        .bind(Number(body.accepting),parts[0],body.revision,now).run();
    if (!result.meta.changes) {
      const room = await db.prepare("SELECT expires_at FROM blacksmith_inboxes WHERE id=?").bind(parts[0]).first<{ expires_at: number }>();
      if (!room) throw new AdminError(404, "이미 종료되었거나 존재하지 않는 대장장이입니다.");
      if (method === "PATCH" && room.expires_at<=now) throw new AdminError(410, "종료된 대장장이는 접수를 재개할 수 없습니다.");
      // A submission or owner action since the confirmation requires a fresh
      // review, rather than silently deleting newly arrived legitimate requests.
      throw new AdminError(409, "대장장이 정보나 접수 내역이 변경되었습니다. 새로고침 후 다시 확인해 주세요.");
    }
    return adminJson({ ok: true });
  } catch (error) { return adminFailure(error); }
}
