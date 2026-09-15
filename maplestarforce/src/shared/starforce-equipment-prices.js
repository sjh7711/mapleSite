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
