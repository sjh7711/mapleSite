import { calculatorStorage } from "./result-share-state.js";
const STORAGE_KEY = "maplestarforce:potential-equipment:v1";

function normalizedEquipment(value, fallback) {
  const part = Number(value?.part);
  const itemLevel = Number(value?.itemLevel);
  return {
    part: Number.isInteger(part) && part >= 0
      ? part
      : Number(fallback.part),
    itemLevel: Number.isFinite(itemLevel)
      ? Math.max(0, Math.min(250, Math.round(itemLevel)))
      : Number(fallback.itemLevel),
  };
}

export function loadSharedPotentialEquipment(
  fallback,
  storage = calculatorStorage,
) {
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY));
    return normalizedEquipment(saved, fallback);
  } catch {
    return normalizedEquipment(null, fallback);
  }
}

export function saveSharedPotentialEquipment(
  equipment,
  storage = calculatorStorage,
) {
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify(normalizedEquipment(equipment, equipment)),
    );
  } catch {
    // 저장이 막힌 환경에서는 현재 화면의 값만 사용한다.
  }
}

export { STORAGE_KEY as POTENTIAL_EQUIPMENT_STORAGE_KEY };
