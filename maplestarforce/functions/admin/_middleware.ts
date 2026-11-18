import { AdminError, adminFailure, requireAdmin } from "../_lib/starforce-admin";

export const onRequest: PagesFunction<Env> = async (context) => {
  try {
    const path = new URL(context.request.url).pathname;
    if (!/^\/admin\/login(?:\/|\/index\.html)?$/u.test(path)) {
      await requireAdmin(context.request, context.env);
    }
    const response = await context.next();
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Content-Security-Policy", "frame-ancestors 'none'; form-action 'self'; base-uri 'self'");
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    if (error instanceof AdminError && error.status === 401) {
      return new Response(null, { status: 302, headers: {
        Location: "/admin/login/", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive",
      } });
    }
    return adminFailure(error);
  }
};
