import { compactStarforcePrices, isStarforcePrice, resolveStarforcePrices,
  STARFORCE_PRICE_CATALOG, STARFORCE_PRICE_SCHEMA } from "../../src/shared/starforce-price-catalog.js";
import { AdminError, isRecord, requireDatabase } from "./starforce-admin";

export async function readPriceDocument(env: Env) {
  const row = await requireDatabase(env).prepare(
    "SELECT revision, prices, updated_at FROM starforce_price_config WHERE id = 1",
  ).first<{ revision: number; prices: string; updated_at: string | null }>();
  if (!row) throw new AdminError(503, "가격 설정을 불러올 수 없습니다.");
  const parsed: unknown = JSON.parse(row.prices);
  if (!isRecord(parsed)) throw new AdminError(503, "가격 설정을 불러올 수 없습니다.");
  return { version: STARFORCE_PRICE_SCHEMA, revision: row.revision,
    updatedAt: row.updated_at, prices: resolveStarforcePrices(parsed) };
}

export async function savePriceDocument(env: Env, body: unknown) {
  if (!isRecord(body) || !Number.isSafeInteger(body.revision) || !isRecord(body.prices)) {
    throw new AdminError(400, "가격과 버전을 확인해주세요.");
  }
  const current = await readPriceDocument(env);
  if (body.revision !== current.revision) throw new AdminError(409, "다른 창에서 가격이 변경되었습니다. 최신 가격을 불러온 뒤 다시 저장해주세요.");
  const prices = { ...current.prices };
  const catalog = new Map(STARFORCE_PRICE_CATALOG.map((item) => [item.id, item]));
  const entries = Object.entries(body.prices);
  if (!entries.length || entries.length > catalog.size) throw new AdminError(400, "수정할 가격을 확인해주세요.");
  for (const [id, price] of entries) {
    const item = catalog.get(id);
    if (!item || !isStarforcePrice(price) || typeof price !== "number" ||
        (item.fixed && price !== item.defaultPrice)) {
      throw new AdminError(400, "올바르지 않은 장비 또는 가격이 있습니다.");
    }
    prices[id] = Math.round(price * 100_000_000) / 100_000_000;
  }
  const updatedAt = new Date().toISOString();
  const result = await requireDatabase(env).prepare(`
    UPDATE starforce_price_config SET prices = ?, revision = revision + 1, updated_at = ?
    WHERE id = 1 AND revision = ?
  `).bind(JSON.stringify(compactStarforcePrices(prices)), updatedAt, current.revision).run();
  if (result.meta.changes !== 1) throw new AdminError(409, "다른 창에서 가격이 변경되었습니다. 최신 가격을 불러온 뒤 다시 저장해주세요.");
  return { version: STARFORCE_PRICE_SCHEMA, revision: current.revision + 1, updatedAt, prices };
}
