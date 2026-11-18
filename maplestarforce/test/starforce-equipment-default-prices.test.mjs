import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { EQUIPMENT_PRESETS } from "../src/calc.js";
import { applyPersonalStarforcePrices, readPersonalStarforcePrices, savePersonalStarforcePrice, updateMatchingEquipmentPrices } from "../src/shared/starforce-equipment-prices.js";

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

test("손상되거나 읽지 못하는 최신 가격 항목이 유효한 이전 저장값을 가리지 않는다", () => {
  for (const current of ["{broken", '{"priceOverrides":[]}', '[]', 'null']) {
    const values = new Map([["maplestarforce:v5", current],
      ["maplestarforce:v4", '{"priceOverrides":{"giant-fear":81}}']]);
    const before = [...values];
    assert.deepEqual(readPersonalStarforcePrices(() => ({ getItem: (key) => values.get(key) ?? null })), { "giant-fear": 81 });
    assert.deepEqual([...values], before);
  }
  assert.deepEqual(readPersonalStarforcePrices(() => ({ getItem: (key) => {
    if (key === "maplestarforce:v5") throw new Error("unreadable entry");
    return key === "maplestarforce:v3" ? '{"prices":{"giant-fear":73}}' : null;
  } })), { "giant-fear": 73 });
});

test("유효한 최신 빈 설정은 이전 사용자 가격을 되살리지 않고 현재 기본값을 사용한다", () => {
  const values = new Map([["maplestarforce:v5", '{"priceOverrides":{}}'],
    ["maplestarforce:v4", '{"priceOverrides":{"giant-fear":81}}']]);
  assert.deepEqual(readPersonalStarforcePrices(() => ({ getItem: (key) => values.get(key) ?? null })), {});
});

function memoryStorage(entries = []) {
  const values = new Map(entries);
  const writes = [];
  return { values, writes, storage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); writes.push(key); },
  } };
}

test("공유 화면의 직접 수정은 해당 개인 가격만 합치고 개인 목록과 설정을 보존한다", () => {
  const saved = { event: "none", mvp: "silver", pc: true, multiplier: 1.09,
    bulk: { startStar: 15, targetStar: 22 },
    priceOverrides: { "giant-fear": 81, "dreamy-belt": 39, "eternal-part-top": 2 } };
  const items = JSON.stringify({ slots: [[{ presetId: "giant-fear", replacementEok: 81 }]], slot: 2 });
  const { storage, values, writes } = memoryStorage([
    ["maplestarforce:v5", JSON.stringify(saved)], ["maplestarforce:items:v1", items],
    ["maplestarforce:character-profile:v2", '{"name":"개인캐릭터"}'], ["theme", "light"],
  ]);
  const before = new Map(values);
  assert.equal(savePersonalStarforcePrice("giant-fear", 50, () => storage), true);
  assert.deepEqual(JSON.parse(values.get("maplestarforce:v5")), {
    ...saved, priceOverrides: { ...saved.priceOverrides, "giant-fear": 50 },
  });
  assert.deepEqual(writes, ["maplestarforce:v5"]);
  for (const [key, value] of before) if (key !== "maplestarforce:v5") assert.equal(values.get(key), value);
  assert.equal(readPersonalStarforcePrices(() => storage)["giant-fear"], 50);

  // A later edit must merge the latest native data, not a captured/shared map.
  const latest = JSON.parse(values.get("maplestarforce:v5"));
  latest.priceOverrides.dominator = 12;
  values.set("maplestarforce:v5", JSON.stringify(latest));
  savePersonalStarforcePrice("dreamy-belt", 0, () => storage);
  assert.deepEqual(readPersonalStarforcePrices(() => storage), {
    "giant-fear": 50, "dreamy-belt": 0, "eternal-part-top": 2, dominator: 12,
  });
});

test("개인 저장본이 없으면 직접 입력한 가격만 만들고 공유 조건은 가져오지 않는다", () => {
  const { storage, values, writes } = memoryStorage();
  assert.equal(savePersonalStarforcePrice("giant-fear", 52, () => storage), true);
  assert.deepEqual([...values], [["maplestarforce:v5", '{"priceOverrides":{"giant-fear":52}}']]);
  assert.deepEqual(writes, ["maplestarforce:v5"]);
});

test("이전 형식의 개인 가격을 수정해도 다른 가격과 기존 설정을 보존한다", () => {
  for (const [key, field] of [["maplestarforce:v4", "priceOverrides"], ["maplestarforce:v3", "prices"]]) {
    const saved = { event: "none", [field]: { "giant-fear": 81, "dreamy-belt": 39 } };
    const { storage, values, writes } = memoryStorage([[key, JSON.stringify(saved)]]);
    assert.equal(savePersonalStarforcePrice("giant-fear", 50, () => storage), true);
    assert.deepEqual(writes, [key]);
    assert.deepEqual(JSON.parse(values.get(key)), { ...saved, [field]: { ...saved[field], "giant-fear": 50 } });
    assert.deepEqual(readPersonalStarforcePrices(() => storage), { "giant-fear": 50, "dreamy-belt": 39 });
  }
});

test("손상된 최신 저장본 뒤의 유효한 개인 가격도 직접 수정할 수 있다", () => {
  const { storage, values, writes } = memoryStorage([
    ["maplestarforce:v5", "{broken"], ["maplestarforce:v4", '{"priceOverrides":{"dreamy-belt":39}}'],
  ]);
  assert.equal(savePersonalStarforcePrice("giant-fear", 50, () => storage), true);
  assert.deepEqual(writes, ["maplestarforce:v4"]);
  assert.equal(values.get("maplestarforce:v5"), "{broken");
  assert.deepEqual(readPersonalStarforcePrices(() => storage), { "dreamy-belt": 39, "giant-fear": 50 });
});

test("유효하지 않은 가격이나 저장소 차단은 개인 데이터를 바꾸거나 계산을 중단하지 않는다", () => {
  const { storage, values, writes } = memoryStorage();
  for (const [id, value] of [["giant-fear", NaN], ["giant-fear", Infinity], ["giant-fear", -1],
    ["giant-fear", "50"], ["", 50], ["__proto__", 50], ["constructor", 50], ["prototype", 50]]) {
    assert.equal(savePersonalStarforcePrice(id, value, () => storage), false);
  }
  assert.equal(values.size, 0);
  assert.deepEqual(writes, []);
  assert.equal(savePersonalStarforcePrice("giant-fear", 50, () => { throw new Error("blocked"); }), false);
  assert.equal(savePersonalStarforcePrice("giant-fear", 50, () => ({
    getItem: () => null, setItem: () => { throw new Error("quota"); },
  })), false);
});
