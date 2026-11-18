import { purgeExpiredInboxes, purgeInboxHistory } from "../../functions/_lib/blacksmith-inbox-expiry";

export default {
  // Only reachable through the matching Pages service binding. No public route.
  async fetch(request, env) {
    const ip = request.headers.get("X-Traffic-IP") ?? "", client = request.headers.get("X-Traffic-Client") ?? "";
    if (!/^[a-f0-9]{64}$/u.test(ip) || !/^[a-f0-9]{64}$/u.test(client)) return new Response(null, { status: 400 });
    const read = request.method === "GET";
    // Check the coarse IP guard first so rotating browser keys cannot avoid it.
    const ipResult = await (read ? env.READ_IP : env.WRITE_IP).limit({ key: ip });
    if (!ipResult.success) return new Response(null, { status: 429 });
    const result = await (read ? env.READ_CLIENT : env.WRITE_CLIENT).limit({ key: client });
    return new Response(null, { status: result.success ? 204 : 429 });
  },
  async scheduled(_controller, env) {
    const now = Date.now();
    await purgeExpiredInboxes(env.STARFORCE_INBOX_DB, now);
    await purgeInboxHistory(env.STARFORCE_INBOX_DB, now);
    await env.STARFORCE_INBOX_DB.prepare("DELETE FROM blacksmith_submissions WHERE request_id IN (SELECT request_id FROM blacksmith_submissions WHERE submitted_at<=? LIMIT 200)")
      .bind(now - 30 * 60 * 1000).run();
  },
} satisfies ExportedHandler<Env>;
