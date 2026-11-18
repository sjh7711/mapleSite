export const INBOX_LIFETIME_MS = 12 * 60 * 60 * 1000;
export const INBOX_HISTORY_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;

// A server-side deadline, independent of browser timers and owner polling.
// Bound each scheduled sweep; the expiry index avoids scanning live inboxes.
export async function purgeExpiredInboxes(database: Pick<D1Database, "prepare">, now: number) {
  return database.prepare(`DELETE FROM blacksmith_inboxes WHERE id IN (
    SELECT id FROM blacksmith_inboxes WHERE expires_at <= ? ORDER BY expires_at LIMIT 100
  )`).bind(now).run();
}

export async function purgeInboxHistory(database: Pick<D1Database,"prepare">, now: number) {
  return database.prepare(`DELETE FROM blacksmith_inbox_history WHERE id IN (
    SELECT id FROM blacksmith_inbox_history WHERE retain_until<=? ORDER BY retain_until LIMIT 100
  )`).bind(now).run();
}
