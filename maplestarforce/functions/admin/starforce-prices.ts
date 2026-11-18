import html from "../_generated/starforce-admin-page";
import { adminFailure, adminJson, requireAdmin } from "../_lib/starforce-admin";

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireAdmin(request, env);
    if (!["GET", "HEAD"].includes(request.method)) return adminJson({ ok: false }, 405, { Allow: "GET, HEAD" });
    return new Response(request.method === "HEAD" ? null : html, { headers: {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow, noarchive", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return adminFailure(error); }
};
