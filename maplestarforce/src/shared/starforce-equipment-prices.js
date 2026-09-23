/** 같은 강화목록에 담긴 동일 프리셋 장비의 스페어값을 함께 바꾼다. */
export function updateMatchingEquipmentPrices(items, presetId, value) {
  const nextValue = Math.max(0, Number(value) || 0);
  let updated = 0;

  for (const item of Array.isArray(items) ? items : []) {
    if (!item || item.presetId !== presetId) continue;
    item.replacementEok = nextValue;
    updated += 1;
  }

  return updated;
}

/** 공유 화면에서 버튼을 누른 경우에만 개인 가격을 읽는다. 저장소에는 쓰지 않는다. */
export function readPersonalStarforcePrices(getStorage = () => globalThis.localStorage) {
  try {
    const storage = getStorage();
    for (const key of ["maplestarforce:v5", "maplestarforce:v4", "maplestarforce:v3"]) {
      const saved = JSON.parse(storage.getItem(key) ?? "null");
      if (!saved || typeof saved !== "object" || Array.isArray(saved)) continue;
      const prices = saved.priceOverrides ?? saved.prices ?? {};
      if (!prices || typeof prices !== "object" || Array.isArray(prices)) return null;
      return Object.fromEntries(Object.entries(prices).filter(([id, value]) =>
        !["__proto__", "constructor", "prototype"].includes(id) &&
        typeof value === "number" && Number.isFinite(value) && value >= 0
      ));
    }
  } catch { /* 저장소 접근이 막혀 있으면 공유 가격을 유지한다. */ }
  return null;
}

/** 알려진 장비는 개인 가격·기본 가격 순으로 적용하고 NPC 고정 가격은 지킨다. */
export function applyPersonalStarforcePrices(items, prices, { defaults = {}, fixed = {}, groups = {} } = {}) {
  for (const item of Array.isArray(items) ? items : []) {
    const id = item?.presetId;
    if (!id) continue;
    const price = Object.hasOwn(fixed, id) ? fixed[id]
      : Object.hasOwn(prices, id) ? prices[id]
        : groups[id] && Object.hasOwn(prices, groups[id]) ? prices[groups[id]]
        : Object.hasOwn(defaults, id) ? defaults[id] : null;
    if (typeof price === "number" && Number.isFinite(price) && price >= 0) item.replacementEok = price;
  }
}
