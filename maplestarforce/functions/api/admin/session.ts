import { adminFailure, adminJson, createAdminSession, requireAdmin,
  requireDatabase, requireSameOrigin, sessionCookie } from "../../_lib/starforce-admin";

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  try {
    if (request.method === "POST") return await createAdminSession(request, env);
    if (request.method === "GET") { await requireAdmin(request, env); return adminJson({ ok: true }); }
    if (request.method === "DELETE") {
      requireSameOrigin(request);
      const hash = await requireAdmin(request, env);
      await requireDatabase(env).prepare("DELETE FROM starforce_admin_sessions WHERE token_hash = ?").bind(hash).run();
      return adminJson({ ok: true }, 200, { "Set-Cookie": sessionCookie() });
    }
    return adminJson({ ok: false }, 405, { Allow: "GET, POST, DELETE" });
  } catch (error) { return adminFailure(error); }
};
