import { adminFailure, adminJson, readAdminJson, requireAdmin, requireSameOrigin } from "../../_lib/starforce-admin";
import { readSoulEtherPriceDocument, saveSoulEtherPriceDocument } from "../../_lib/soul-ether-prices";

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireAdmin(request, env);
    if (request.method === "GET") return adminJson(await readSoulEtherPriceDocument(env));
    if (request.method === "PUT") {
      requireSameOrigin(request);
      return adminJson(await saveSoulEtherPriceDocument(env, await readAdminJson(request)));
    }
    return adminJson({ ok: false }, 405, { Allow: "GET, PUT" });
  } catch (error) { return adminFailure(error); }
};
