import { isSoulEtherPrices, SOUL_ETHER_PRICE_SCHEMA } from "../../src/shared/soul-ether-prices.js";
import { AdminError, isRecord, requireDatabase } from "./starforce-admin";

export async function readSoulEtherPriceDocument(env: Env) {
  const row = await requireDatabase(env).prepare(
    "SELECT revision, prices, updated_at FROM soul_ether_price_config WHERE id = 1",
  ).first<{ revision: number; prices: string; updated_at: string | null }>();
  if (!row) throw new AdminError(503, "소울 에테르 가격을 불러올 수 없습니다.");
  const prices: unknown = JSON.parse(row.prices);
  if (!isSoulEtherPrices(prices)) throw new AdminError(503, "소울 에테르 가격을 불러올 수 없습니다.");
  return { version: SOUL_ETHER_PRICE_SCHEMA, revision: row.revision, updatedAt: row.updated_at, prices: prices as number[] };
}

export async function saveSoulEtherPriceDocument(env: Env, body: unknown) {
  if (!isRecord(body) || !Number.isSafeInteger(body.revision) || Number(body.revision) < 0 || !isSoulEtherPrices(body.prices)) {
    throw new AdminError(400, "1~4단계 에테르 가격과 버전을 확인해주세요.");
  }
  const prices = (body.prices as number[]).map((value) => Math.round(value * 100_000_000) / 100_000_000);
  const updatedAt = new Date().toISOString();
  const result = await requireDatabase(env).prepare(`
    UPDATE soul_ether_price_config SET prices = ?1, revision = revision + 1, updated_at = ?2
    WHERE id = 1 AND revision = ?3
  `).bind(JSON.stringify(prices), updatedAt, body.revision).run();
  if (result.meta.changes !== 1) throw new AdminError(409, "다른 창에서 가격이 변경되었습니다. 최신 가격을 불러온 뒤 다시 저장해주세요.");
  return { version: SOUL_ETHER_PRICE_SCHEMA, revision: Number(body.revision) + 1, updatedAt, prices };
}
