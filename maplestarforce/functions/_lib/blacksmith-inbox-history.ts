import { AdminError, adminJson } from "./starforce-admin";

const PAGE_SIZE = 20;
const columns = `id,name,created_at AS createdAt,expires_at AS expiresAt,
  ended_at AS endedAt,retain_until AS retainUntil,end_reason AS endReason,
  last_submitted_at AS lastSubmittedAt,last_completed_at AS lastCompletedAt,
  waiting,working,done,request_count AS requestCount,item_count AS itemCount`;
type HistoryRoom = { id:string; name:string; requestCount:number; retainUntil:number };

// Called only after site administrator authentication in the admin API.
export async function readInboxHistory(db: D1DatabaseSession, url: URL, parts: string[], now: number) {
  const pageText = url.searchParams.get("page") ?? "0";
  if (!/^\d{1,6}$/u.test(pageText)) throw new AdminError(400, "페이지를 확인해 주세요.");
  if (parts.length === 2 && /^[a-f0-9]{24}$/u.test(parts[1])) {
    const room = await db.prepare(`SELECT ${columns} FROM blacksmith_inbox_history WHERE id=? AND retain_until>?`)
      .bind(parts[1],now).first<HistoryRoom>();
    if (!room) throw new AdminError(404, "종료 이력이 없거나 3일의 보관 기간이 지났습니다.");
    const pages = Math.max(1,Math.ceil(room.requestCount/PAGE_SIZE)), page = Math.min(Number(pageText),pages-1);
    const row = await db.prepare("SELECT requests FROM blacksmith_inbox_history_pages WHERE inbox_id=? AND page=?").bind(room.id,page).first<{requests:string}>();
    return adminJson({ room,requests:row ? JSON.parse(row.requests) : [],page,pages,total:room.requestCount,pageSize:PAGE_SIZE });
  }
  if (parts.length !== 1) throw new AdminError(404, "종료 이력을 찾을 수 없습니다.");
  const search = (url.searchParams.get("q") ?? "").trim().normalize("NFC");
  const reason = url.searchParams.get("reason") ?? "all", sort = url.searchParams.get("sort") ?? "ended";
  const orders: Record<string,string> = { ended:"ended_at DESC,id DESC",created:"created_at DESC,id DESC",completed:"last_completed_at DESC,ended_at DESC,id DESC" };
  if (search.length>64 || /[\p{Cc}\p{Cf}]/u.test(search) || !["all","owner","admin","expired"].includes(reason) || !Object.hasOwn(orders,sort)) throw new AdminError(400,"검색 조건을 확인해 주세요.");
  let where="retain_until>?"; const params:(string|number)[]=[now];
  if (reason!=="all") { where+=" AND end_reason=?";params.push(reason); }
  if (search) { where+=" AND name LIKE ? ESCAPE '\\'";params.push(`%${search.replace(/[\\%_]/gu,"\\$&")}%`); }
  const [overview,matched] = await db.batch<Record<string,number>>([
    db.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(end_reason='owner'),0) AS owner,
      COALESCE(SUM(end_reason='admin'),0) AS admin,COALESCE(SUM(end_reason='expired'),0) AS expired
      FROM blacksmith_inbox_history WHERE retain_until>?`).bind(now),
    db.prepare(`SELECT COUNT(*) AS total FROM blacksmith_inbox_history WHERE ${where}`).bind(...params),
  ]);
  const total=Number(matched.results[0]?.total ?? 0),pages=Math.max(1,Math.ceil(total/PAGE_SIZE)),page=Math.min(Number(pageText),pages-1);
  const rows=await db.prepare(`SELECT ${columns} FROM blacksmith_inbox_history WHERE ${where} ORDER BY ${orders[sort]} LIMIT ? OFFSET ?`)
    .bind(...params,PAGE_SIZE,page*PAGE_SIZE).all();
  return adminJson({ summary:overview.results[0],inboxes:rows.results,page,pages,total,pageSize:PAGE_SIZE,retentionDays:3 });
}

