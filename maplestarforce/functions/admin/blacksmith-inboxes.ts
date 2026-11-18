import html from "../_generated/starforce-inbox-admin-page";
import { AdminError, adminFailure, adminJson, requireAdmin } from "../_lib/starforce-admin";

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireAdmin(request, env);
    if (env.STARFORCE_INBOX_ENABLED !== "true" || !env.STARFORCE_INBOX_DB) throw new AdminError(404, "대장장이 관리가 활성화되지 않았습니다.");
    if (!["GET", "HEAD"].includes(request.method)) return adminJson({ ok: false },405,{ Allow: "GET, HEAD" });
    return new Response(request.method === "HEAD" ? null : html,{ headers: {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return adminFailure(error); }
};
