import { adminFailure, adminJson } from "../_lib/starforce-admin";
import { readPriceDocument } from "../_lib/starforce-prices";

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (!["GET", "HEAD"].includes(request.method)) return adminJson({ ok: false }, 405, { Allow: "GET, HEAD" });
  try {
    const document = await readPriceDocument(env);
    const response = adminJson(document);
    response.headers.set("Cache-Control", "public, max-age=30, must-revalidate");
    response.headers.set("ETag", `"starforce-prices-${document.revision}"`);
    return request.method === "HEAD" ? new Response(null, response) : response;
  } catch (error) { return adminFailure(error); }
};
