import { EQUIPMENT_PRESETS } from "./starforce-equipment-presets.js";

export const STARFORCE_PRICE_SCHEMA = 1;
export const MAX_STARFORCE_PRICE_EOK = 1_000_000;
export const STARFORCE_PRICE_CATALOG = EQUIPMENT_PRESETS.map((preset) => ({
  id: preset.id,
  name: preset.name,
  level: preset.level,
  icon: preset.icon ?? null,
  groupId: preset.groupId ?? null,
  fixed: preset.npcSpare === true,
  defaultPrice: preset.price,
}));

export function isStarforcePrice(value) {
  return typeof value === "number" && Number.isFinite(value) &&
    value >= 0 && value <= MAX_STARFORCE_PRICE_EOK;
}

/** Known IDs only; fixed NPC prices never come from the remote document. */
export function resolveStarforcePrices(overrides = {}) {
  const safe = overrides && typeof overrides === "object" && !Array.isArray(overrides)
    ? overrides : {};
  return Object.fromEntries(STARFORCE_PRICE_CATALOG.map((item) => {
    const own = Object.hasOwn(safe, item.id) ? safe[item.id] : undefined;
    const group = item.groupId && Object.hasOwn(safe, item.groupId) ? safe[item.groupId] : undefined;
    const price = item.fixed ? item.defaultPrice : isStarforcePrice(own) ? own
      : isStarforcePrice(group) ? group : item.defaultPrice;
    return [item.id, price];
  }));
}

/** Save only differences, preserving inheritance from grouped equipment prices. */
export function compactStarforcePrices(prices) {
  const result = {};
  for (const item of STARFORCE_PRICE_CATALOG) {
    if (item.fixed) continue;
    const inherited = item.groupId ? prices[item.groupId] : item.defaultPrice;
    if (prices[item.id] !== inherited) result[item.id] = prices[item.id];
  }
  return result;
}
