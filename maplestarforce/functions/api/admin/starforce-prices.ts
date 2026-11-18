import { STARFORCE_PRICE_CATALOG } from "../../../src/shared/starforce-price-catalog.js";
import { adminFailure, adminJson, readAdminJson, requireAdmin, requireSameOrigin } from "../../_lib/starforce-admin";
import { readPriceDocument, savePriceDocument } from "../../_lib/starforce-prices";

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  try {
    await requireAdmin(request, env);
    if (request.method === "GET") return adminJson({ ...await readPriceDocument(env), catalog: STARFORCE_PRICE_CATALOG });
    if (request.method === "PUT") {
      requireSameOrigin(request);
      return adminJson(await savePriceDocument(env, await readAdminJson(request)));
    }
    return adminJson({ ok: false }, 405, { Allow: "GET, PUT" });
  } catch (error) { return adminFailure(error); }
};
