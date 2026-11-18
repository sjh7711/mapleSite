import { AdminError, adminJson } from "./starforce-admin";

const PAGE_SIZE = 20;

// Only the authenticated site administrator route may call this reader.
export async function readInboxRequests(db: D1DatabaseSession, url: URL, id: string) {
  const pageText = url.searchParams.get("page") ?? "0";
  if (!/^\d{1,6}$/u.test(pageText)) throw new AdminError(400, "페이지를 확인해 주세요.");
  const room = await db.prepare("SELECT id,name FROM blacksmith_inboxes WHERE id=?")
    .bind(id).first<{ id: string; name: string }>();
  if (!room) throw new AdminError(404, "이미 종료되었거나 존재하지 않는 대장장이입니다. 목록을 새로고침해 주세요.");
  const total = Number((await db.prepare("SELECT COUNT(*) AS total FROM blacksmith_request_records WHERE inbox_id=?")
    .bind(id).first<{ total: number }>())?.total ?? 0);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE)), page = Math.min(Number(pageText), pages - 1);
  // Keep waiting/working applications together in receipt order; completed
  // applications follow in reverse receipt order, as in the owner's queue.
  // Explicit columns exclude all applicant/owner credentials and IP hashes.
  const rows = await db.prepare(`SELECT id,nickname,items,item_count AS itemCount,status,
    can_block AS canBlock,blocked_at AS blockedAt,
    created_at AS createdAt,version AS editCount,completed_at AS completedAt
    FROM blacksmith_request_records WHERE inbox_id=? ORDER BY CASE status WHEN 'blocked' THEN 2 WHEN 'done' THEN 1 ELSE 0 END ASC,
    CASE WHEN status IN ('waiting','working') THEN created_at END ASC,
    CASE WHEN status IN ('done','blocked') THEN created_at END DESC,id ASC LIMIT ? OFFSET ?`)
    .bind(id, PAGE_SIZE, page * PAGE_SIZE).all<{ id: string; items: string; canBlock: number }>();
  return adminJson({ room, requests: rows.results.map(row => ({ ...row, canBlock: Boolean(row.canBlock), items: row.items === null ? null : JSON.parse(row.items) })),
    page, pages, total, pageSize: PAGE_SIZE });
}
