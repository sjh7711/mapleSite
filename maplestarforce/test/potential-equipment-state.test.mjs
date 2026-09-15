import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  POTENTIAL_EQUIPMENT_STORAGE_KEY,
  loadSharedPotentialEquipment,
  saveSharedPotentialEquipment,
} from "../src/shared/potential-equipment-state.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test("윗잠·아랫잠·통합은 부위와 장비 레벨을 공통 저장한다", async () => {
  const storage = memoryStorage();
  assert.deepEqual(
    loadSharedPotentialEquipment({ part: 6, itemLevel: 200 }, storage),
    { part: 6, itemLevel: 200 },
  );

  saveSharedPotentialEquipment({ part: 4, itemLevel: 250 }, storage);
  assert.deepEqual(
    loadSharedPotentialEquipment({ part: 6, itemLevel: 200 }, storage),
    { part: 4, itemLevel: 250 },
  );
  assert.equal(
    storage.getItem(POTENTIAL_EQUIPMENT_STORAGE_KEY),
    JSON.stringify({ part: 4, itemLevel: 250 }),
  );

  const [potentialPage, combinedPage] = await Promise.all([
    readFile(new URL("../src/shared/potential-page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/combined-potential-page.js", import.meta.url), "utf8"),
  ]);
  for (const source of [potentialPage, combinedPage]) {
    assert.match(source, /Object\.assign\(state, loadSharedPotentialEquipment\(state\)\)/u);
    assert.match(source, /function persist\(\) \{[\s\S]*saveSharedPotentialEquipment\(state\)/u);
  }
});

test("공통 장비 값이 손상되면 현재 화면의 값을 유지한다", () => {
  const storage = memoryStorage();
  storage.setItem(POTENTIAL_EQUIPMENT_STORAGE_KEY, "{broken");
  assert.deepEqual(
    loadSharedPotentialEquipment({ part: 8, itemLevel: 160 }, storage),
    { part: 8, itemLevel: 160 },
  );
});
