import { isStarforcePrice, resolveStarforcePrices, STARFORCE_PRICE_CATALOG,
  STARFORCE_PRICE_SCHEMA } from "./starforce-price-catalog.js";

export function isPublishedPriceDocument(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    value.version === STARFORCE_PRICE_SCHEMA && Number.isSafeInteger(value.revision) && value.revision >= 0 &&
    value.prices && typeof value.prices === "object" && !Array.isArray(value.prices) &&
    STARFORCE_PRICE_CATALOG.every((item) => Object.hasOwn(value.prices, item.id) && isStarforcePrice(value.prices[item.id]));
}

/** Refresh defaults; shared views can keep every captured equipment price intact. */
export function applyPublishedStarforcePrices(defaults, state, document, { preserveItemPrices = false } = {}) {
  if (!isPublishedPriceDocument(document)) return false;
  const next = resolveStarforcePrices(document.prices);
  const catalog = new Map(STARFORCE_PRICE_CATALOG.map((item) => [item.id, item]));
  for (const slot of !preserveItemPrices && Array.isArray(state.slots) ? state.slots : []) {
    for (const item of Array.isArray(slot) ? slot : []) {
      const preset = catalog.get(item?.presetId);
      if (!preset) continue;
      const overrides = state.priceOverrides ?? {};
      const custom = Object.hasOwn(overrides, preset.id) ||
        (preset.groupId && Object.hasOwn(overrides, preset.groupId));
      if (preset.fixed || (!custom &&
          (item.replacementEok === undefined || item.replacementEok === defaults[preset.id]))) {
        item.replacementEok = next[preset.id];
      }
    }
  }
  Object.assign(defaults, next);
  state.publishedPriceDefaults = { version: document.version, revision: document.revision,
    updatedAt: document.updatedAt ?? null, prices: next };
  return true;
}

export async function fetchPublishedStarforcePrices(fetcher = globalThis.fetch) {
  const response = await fetcher("/api/starforce-prices", {
    credentials: "omit", cache: "no-cache", headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("공통 스페어값을 불러올 수 없습니다.");
  const document = await response.json();
  if (!isPublishedPriceDocument(document)) throw new Error("공통 스페어값 형식을 확인할 수 없습니다.");
  return document;
}
