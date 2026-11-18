import { adminFailure, adminJson } from "../_lib/starforce-admin";
import { readSoulEtherPriceDocument } from "../_lib/soul-ether-prices";

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (!["GET", "HEAD"].includes(request.method)) return adminJson({ ok: false }, 405, { Allow: "GET, HEAD" });
  try {
    const document = await readSoulEtherPriceDocument(env);
    const response = adminJson(document);
    response.headers.set("Cache-Control", "public, max-age=30, must-revalidate");
    response.headers.set("ETag", `"soul-ether-prices-${document.revision}"`);
    return request.method === "HEAD" ? new Response(null, response) : response;
  } catch (error) { return adminFailure(error); }
};
