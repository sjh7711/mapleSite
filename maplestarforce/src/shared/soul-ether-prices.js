export const SOUL_ETHER_PRICE_SCHEMA = 1;
export const DEFAULT_SOUL_ETHER_PRICES = Object.freeze([18, 18, 18, 70]);
export const MAX_SOUL_ETHER_PRICE_EOK = 1_000_000;
export const SOUL_ETHER_PRICE_UPDATE_KEY = "maplestarforce:soul-ether-price-update";

export const isSoulEtherPrice = (value) => typeof value === "number" &&
  Number.isFinite(value) && value >= 0 && value <= MAX_SOUL_ETHER_PRICE_EOK;
export const isSoulEtherPrices = (value) => Array.isArray(value) && value.length === 4 &&
  Array.from(value).every(isSoulEtherPrice);
export const isSoulEtherPriceDocument = (value) => value?.version === SOUL_ETHER_PRICE_SCHEMA &&
  Number.isSafeInteger(value.revision) && value.revision >= 0 && isSoulEtherPrices(value.prices);

/** Older saves contain every default price, so infer personal edits only during migration. */
export function initializeSoulEtherPrices(saved = {}, { preservePrices = false } = {}) {
  const publishedEtherPrices = isSoulEtherPrices(saved.publishedEtherPrices)
    ? [...saved.publishedEtherPrices] : [...DEFAULT_SOUL_ETHER_PRICES];
  const etherPrices = publishedEtherPrices.map((fallback, index) => {
    const value = saved.etherPrices?.[index];
    return value !== null && value !== undefined && Number.isFinite(Number(value))
      ? Math.max(0, Number(value)) : fallback;
  });
  const etherPriceOverrides = etherPrices.map((value, index) => preservePrices ||
    (typeof saved.etherPriceOverrides?.[index] === "boolean" ? saved.etherPriceOverrides[index]
      : value !== publishedEtherPrices[index]));
  return { etherPrices, etherPriceOverrides, publishedEtherPrices };
}

export function applyPublishedSoulEtherPrices(state, document, { preservePrices = false } = {}) {
  if (!isSoulEtherPriceDocument(document)) return false;
  state.publishedEtherPrices = [...document.prices];
  if (!preservePrices) state.etherPrices = document.prices.map((value, index) =>
    state.etherPriceOverrides[index] ? state.etherPrices[index] : value);
  return true;
}

export async function fetchPublishedSoulEtherPrices(fetcher = globalThis.fetch) {
  const response = await fetcher("/api/soul-ether-prices", {
    credentials: "omit", cache: "no-cache", headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("소울 에테르 기본 가격을 불러올 수 없습니다.");
  const document = await response.json();
  if (!isSoulEtherPriceDocument(document)) throw new Error("소울 에테르 가격 형식을 확인할 수 없습니다.");
  return document;
}
