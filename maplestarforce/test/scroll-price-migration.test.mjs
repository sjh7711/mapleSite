import test from "node:test";
import assert from "node:assert/strict";
import { migrateScrollPrices, SCROLL_PRICE_DEFAULTS } from "../src/shared/scroll-price-defaults.js";

test("새 사용자와 이전 기본값은 정식 패치 가격으로 이전한다", () => {
  const migrated = migrateScrollPrices({ settingsVersion: 6, earringPrice: 8000, magicalPrice: 5000, chaos60Price: 3, chaos100Price: 4500, returnPrice: 6900 });
  for (const [key, value] of Object.entries(SCROLL_PRICE_DEFAULTS)) {
    assert.equal(migrated[key], value); assert.equal(migrateScrollPrices({})[key], value);
  }
});
test("사용자 수정 가격과 0원 입력을 유지하고 기존 리턴 메포만 메소 단위로 이전한다", () => {
  const saved = { settingsVersion: 6, earringPrice: 9000, magicalPrice: 0, chaos60Price: 27, returnPrice: 5000, maplePointsPerEok: 2500 };
  const migrated = migrateScrollPrices(saved);
  assert.equal(migrated.earringPrice, 9000); assert.equal(migrated.magicalPrice, 0);
  assert.equal(migrated.chaos60Price, 27); assert.equal(migrated.returnPrice, 20000);
  assert.equal(migrated.returnResultUnit, "meso");
  assert.deepEqual(migrateScrollPrices(migrated), migrated);
  assert.equal(migrateScrollPrices({ settingsVersion: 7, returnPrice: 6900 }).returnPrice, 6900);
});
