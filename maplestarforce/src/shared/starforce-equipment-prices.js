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

const unsafePriceIds = new Set(["__proto__", "constructor", "prototype"]);

function personalPriceSettings(storage) {
  for (const key of ["maplestarforce:v5", "maplestarforce:v4", "maplestarforce:v3"]) {
    let saved;
    try { saved = JSON.parse(storage.getItem(key) ?? "null"); }
    catch { continue; } // A damaged current entry must not hide valid older prices.
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) continue;
    const field = saved.priceOverrides == null && saved.prices != null ? "prices" : "priceOverrides";
    const prices = saved[field] ?? {};
    if (!prices || typeof prices !== "object" || Array.isArray(prices)) continue;
    return { key, saved, field, prices };
  }
  return null;
}

/** 공유 화면에서 버튼을 누른 경우에만 개인 가격을 읽는다. 저장소에는 쓰지 않는다. */
export function readPersonalStarforcePrices(getStorage = () => globalThis.localStorage) {
  try {
    const settings = personalPriceSettings(getStorage());
    if (settings) {
      return Object.fromEntries(Object.entries(settings.prices).filter(([id, value]) =>
        !unsafePriceIds.has(id) &&
        typeof value === "number" && Number.isFinite(value) && value >= 0
      ));
    }
  } catch { /* 저장소 접근이 막혀 있으면 공유 가격을 유지한다. */ }
  return null;
}

/** 공유 화면에서 직접 고친 가격 하나만 개인 저장본에 합친다. 공유 설정은 받지 않는다. */
export function savePersonalStarforcePrice(presetId, value, getStorage = () => globalThis.localStorage) {
  if (typeof presetId !== "string" || !presetId || unsafePriceIds.has(presetId) ||
      typeof value !== "number" || !Number.isFinite(value) || value < 0) return false;
  try {
    const storage = getStorage();
    const { key, saved, field, prices } = personalPriceSettings(storage) ?? {
      key: "maplestarforce:v5", saved: {}, field: "priceOverrides", prices: {},
    };
    // Read again for every edit so other tabs' newer personal values survive.
    // Keep legacy settings in their own format rather than migrating shared data.
    storage.setItem(key, JSON.stringify({ ...saved, [field]: { ...prices, [presetId]: value } }));
    return true;
  } catch { return false; } // 계산은 저장소 사용이 막혀 있어도 계속한다.
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
