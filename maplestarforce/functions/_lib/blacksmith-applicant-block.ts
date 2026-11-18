import { AdminError } from "./starforce-admin";

// Shared by authenticated owner/admin routes. Identity always comes from the
// stored application; callers cannot choose another applicant or IP to block.
export async function blockInboxApplicant(db: D1DatabaseSession, roomId: string, requestId: string, expectedVersion?: number) {
  const now = Date.now();
  const record = await db.prepare(`SELECT applicant_hash,submitter_ip_hash,version
    FROM blacksmith_requests WHERE inbox_id=? AND id=?
    AND EXISTS (SELECT 1 FROM blacksmith_inboxes WHERE id=? AND expires_at>?)`)
    .bind(roomId,requestId,roomId,now).first<{applicant_hash:string|null;submitter_ip_hash:string|null;version:number}>();
  if (!record) throw new AdminError(404,"신청이 없거나 이미 종료된 대장장이입니다. 새로고침해 주세요.");
  if (!record.applicant_hash && !record.submitter_ip_hash) throw new AdminError(409,"이전 신청의 식별 정보가 없어 차단할 수 없습니다.");
  if (expectedVersion !== undefined && record.version !== expectedVersion) throw new AdminError(409,"신청 내용이 변경되었습니다. 새로고침 후 다시 확인해 주세요.");
  const results = await db.batch([
    db.prepare(`INSERT INTO blacksmith_applicant_blocks(inbox_id,request_id,applicant_hash,ip_hash,blocked_at,nickname,items,item_count,created_at,version)
      SELECT inbox_id,id,applicant_hash,submitter_ip_hash,?,nickname,items,item_count,created_at,version FROM blacksmith_requests
      WHERE inbox_id=? AND id=? AND version=?
      AND EXISTS (SELECT 1 FROM blacksmith_inboxes WHERE id=? AND expires_at>?)
      ON CONFLICT(inbox_id,request_id) DO NOTHING`).bind(now,roomId,requestId,record.version,roomId,now),
    db.prepare(`DELETE FROM blacksmith_nickname_claims WHERE inbox_id=? AND request_id=?
      AND EXISTS (SELECT 1 FROM blacksmith_applicant_blocks WHERE inbox_id=? AND request_id=?)`).bind(roomId,requestId,roomId,requestId),
    db.prepare(`DELETE FROM blacksmith_requests WHERE inbox_id=? AND id=? AND version=?
      AND EXISTS (SELECT 1 FROM blacksmith_applicant_blocks WHERE inbox_id=? AND request_id=?)`).bind(roomId,requestId,record.version,roomId,requestId),
  ]);
  if (!results[0].meta.changes) throw new AdminError(409,"신청 내용이 변경되었습니다. 새로고침 후 다시 확인해 주세요.");
}

export async function unblockInboxApplicant(db: D1DatabaseSession, roomId: string, requestId: string, blockedAt: number) {
  const result = await db.prepare(`DELETE FROM blacksmith_applicant_blocks WHERE inbox_id=? AND request_id=? AND blocked_at=?
    AND EXISTS (SELECT 1 FROM blacksmith_inboxes WHERE id=? AND expires_at>?)`)
    .bind(roomId,requestId,blockedAt,roomId,Date.now()).run();
  if (!result.meta.changes) throw new AdminError(409,"차단 기록이 변경되었거나 대장장이가 종료되었습니다. 새로고침해 주세요.");
}
