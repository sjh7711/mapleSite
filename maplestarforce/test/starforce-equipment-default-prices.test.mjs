import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { EQUIPMENT_PRESETS } from "../src/calc.js";
import { applyPersonalStarforcePrices, readPersonalStarforcePrices, updateMatchingEquipmentPrices } from "../src/shared/starforce-equipment-prices.js";

const mainSource = await readFile(new URL("../src/main.js", import.meta.url), "utf8");

test("스타포스 장비의 기본 스페어값은 최신 시세를 사용한다", () => {
  const prices = Object.fromEntries(
    EQUIPMENT_PRESETS.map(({ name, price }) => [name, price]),
  );

  assert.deepEqual(
    Object.fromEntries(
      [
        "몽벨",
        "커포",
        "거공",
        "컴플",
        "루컨마",
        "마깃안",
        "고근",
        "마이링",
        "모상하견",
        "장신망",
      ].map((name) => [name, prices[name]]),
    ),
    {
      몽벨: 45,
      커포: 15,
      거공: 52,
      컴플: 230,
      루컨마: 16,
      마깃안: 37,
      고근: 63,
      마이링: 0.5,
      모상하견: 0.2,
      장신망: 17.5,
    },
  );
});

test("동일 강화목록 안의 같은 장비만 스페어값을 함께 수정한다", () => {
  const currentItems = [
    { presetId: "giant-fear", replacementEok: 45 },
    { presetId: "dreamy-belt", replacementEok: 35 },
    { presetId: "giant-fear", replacementEok: 50 },
  ];
  const otherSlot = [{ presetId: "giant-fear", replacementEok: 48 }];

  assert.equal(updateMatchingEquipmentPrices(currentItems, "giant-fear", 52), 2);
  assert.deepEqual(
    currentItems.map(({ presetId, replacementEok }) => [presetId, replacementEok]),
    [
      ["giant-fear", 52],
      ["dreamy-belt", 35],
      ["giant-fear", 52],
    ],
  );
  assert.equal(otherSlot[0].replacementEok, 48);
});

test("좌측과 우측 가격 입력은 모두 공유 가격 갱신 흐름을 사용한다", () => {
  assert.match(
    mainSource,
    /priceOf\(preset\.id\)[\s\S]{0,300}setSharedPrice\(preset\.id, value, input\)/u,
  );
  assert.match(
    mainSource,
    /priceOfItem\(item\)[\s\S]{0,300}setSharedPrice\(item\.presetId, value, priceInput\)/u,
  );
  assert.match(
    mainSource,
    /updateMatchingEquipmentPrices\(state\.items, presetId, nextValue\)/u,
  );
  assert.match(mainSource, /state\.priceOverrides\[presetId\]/u);
  assert.doesNotMatch(
    mainSource,
    /state\.priceOverridesBySlot\[state\.slot\]\?\.\[presetId\]/u,
  );
});

test("공유 스페어값 불러오기는 개인 저장 가격만 읽고 장비 조건은 그대로 둔다", () => {
  const settings = JSON.stringify({ event: "none", priceOverrides: {
    "giant-fear": 81, "dreamy-belt": 0, "npc": 9999, invalid: -3, string: "12",
  } });
  const storage = { getItem: (key) => key === "maplestarforce:v5" ? settings : null };
  const prices = readPersonalStarforcePrices(() => storage);
  assert.deepEqual(prices, { "giant-fear": 81, "dreamy-belt": 0, npc: 9999 });
  const items = [
    { presetId: "giant-fear", replacementEok: 52, itemLevel: 200, startStar: 17, targetStar: 22, quantity: 2 },
    { presetId: "dreamy-belt", replacementEok: 45 },
    { presetId: "default-only", replacementEok: 100 },
    { presetId: "npc", replacementEok: 9999 },
    { presetId: "unknown", replacementEok: 22 },
  ];
  const originalConditions = items.map(({ replacementEok, ...item }) => item);
  applyPersonalStarforcePrices(items, prices, { defaults: { "default-only": 17.5 }, fixed: { npc: 0.01 } });
  assert.deepEqual(items.map((item) => item.replacementEok), [81, 0, 17.5, 0.01, 22]);
  assert.deepEqual(items.map(({ replacementEok, ...item }) => item), originalConditions);
  assert.equal(storage.getItem("maplestarforce:v5"), settings);
  assert.equal(readPersonalStarforcePrices(() => ({ getItem: () => null })), null);
  assert.equal(readPersonalStarforcePrices(() => { throw new Error("blocked"); }), null);
  assert.deepEqual(readPersonalStarforcePrices(() => ({ getItem: () => '{"priceOverrides":{}}' })), {});
});
