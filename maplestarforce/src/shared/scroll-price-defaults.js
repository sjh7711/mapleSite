// 넥슨 정식 업데이트 1.2.419 (2026-09-17), /news/update/813.
// 입력 단위는 만 메소이며 사용자가 수정한 가격은 유지한다.
export const SCROLL_PRICE_DEFAULTS = Object.freeze({
  earringPrice: 10000, magicalPrice: 6000, chaos60Price: 50,
  chaos100Price: 30000, returnPrice: 40000,
});
export function migrateScrollPrices(saved = {}) {
  const result = { ...saved };
  if (Number(saved.settingsVersion) >= 7) return result;
  const old = { earringPrice: 8000, magicalPrice: 5000, chaos60Price: 3, chaos100Price: 4500 };
  for (const [key, oldDefault] of Object.entries(old)) {
    if (saved[key] == null || Number(saved[key]) === oldDefault) result[key] = SCROLL_PRICE_DEFAULTS[key];
  }
  if (saved.returnPrice == null || Number(saved.returnPrice) === 6900) {
    result.returnPrice = SCROLL_PRICE_DEFAULTS.returnPrice;
  } else {
    // 과거 직접 입력한 메포 가격은 당시 저장한 환율로 만 메소 환산한다.
    const rate = Number(saved.maplePointsPerEok) > 0 ? Number(saved.maplePointsPerEok) : 2000;
    result.returnPrice = Number(saved.returnPrice) / rate * 10000;
  }
  result.returnResultUnit = "meso";
  result.settingsVersion = 7;
  return result;
}
