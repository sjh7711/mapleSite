import assert from "node:assert/strict";
import test from "node:test";
import { STARFORCE_PRICE_CATALOG, compactStarforcePrices, resolveStarforcePrices } from "../src/shared/starforce-price-catalog.js";
import { applyPublishedStarforcePrices, fetchPublishedStarforcePrices, isPublishedPriceDocument } from "../src/shared/starforce-price-defaults.js";

const published = (prices = {}, revision = 1) => ({ version: 1, revision, prices: resolveStarforcePrices(prices) });

test("공통 가격은 알려진 장비에만 적용하고 NPC 고정가는 유지한다", () => {
  const prices = resolveStarforcePrices({ "giant-fear": 60, "eternal-hat": 1.5,
    "eternal-part-top": 2, "astra-secondary": 999, unknown: 10 });
  assert.equal(prices["giant-fear"], 60);
  assert.equal(prices["eternal-part-hat"], 1.5);
  assert.equal(prices["eternal-part-top"], 2);
  assert.equal(prices["astra-secondary"], 10);
  assert.equal(prices.unknown, undefined);
  assert.deepEqual(resolveStarforcePrices(compactStarforcePrices(prices)), prices);
});

test("관리자 기본가 변경은 세 슬롯의 미수정 장비에 적용하고 직접 고친 가격은 보존한다", () => {
  const defaults = resolveStarforcePrices();
  const state = { priceOverrides: { "dreamy-belt": 47 }, slots: [
    [{ presetId: "giant-fear", replacementEok: 52, startStar: 17, targetStar: 22 }],
    [{ presetId: "giant-fear", replacementEok: 52 }, { presetId: "dreamy-belt", replacementEok: 47 }],
    [{ presetId: "giant-fear", replacementEok: 80 }, { presetId: "unknown", replacementEok: 9 }],
  ] };
  assert.equal(applyPublishedStarforcePrices(defaults, state, published({ "giant-fear": 60, "dreamy-belt": 50 })), true);
  assert.deepEqual(state.slots.map((s) => s.map((i) => i.replacementEok)), [[60], [60, 47], [80, 9]]);
  assert.equal(defaults["giant-fear"], 60);
  assert.equal(defaults["dreamy-belt"], 50);
  assert.equal(state.slots[0][0].startStar, 17);
  assert.equal(state.slots[0][0].targetStar, 22);
  assert.equal(state.publishedPriceDefaults.revision, 1);
  assert.equal(applyPublishedStarforcePrices(defaults, state, published({ "giant-fear": 62 }, 2)), true);
  assert.equal(state.slots[0][0].replacementEok, 62);
  assert.equal(state.slots[2][0].replacementEok, 80);
});

test("부위별 사용자 가격과 묶음 사용자 가격을 공통 기본가로 덮어쓰지 않는다", () => {
  const defaults = resolveStarforcePrices();
  const state = { priceOverrides: { "eternal-hat": 4 }, slots: [[
    { presetId: "eternal-part-top", replacementEok: 4 },
    { presetId: "astra-secondary", replacementEok: 999 },
  ]] };
  applyPublishedStarforcePrices(defaults, state, published({ "eternal-hat": 8 }));
  assert.equal(state.slots[0][0].replacementEok, 4);
  assert.equal(state.slots[0][1].replacementEok, 10);
});

test("공유 화면은 최신 기본 가격표만 갱신하고 계산 장비의 가격과 조건은 보존한다", () => {
  const defaults = resolveStarforcePrices();
  const state = { priceOverrides: { "dreamy-belt": 47 }, slots: [
    [{ presetId: "giant-fear", replacementEok: 52, startStar: 17, targetStar: 22 }],
    [{ presetId: "dreamy-belt", replacementEok: 47 }, { presetId: "astra-secondary", replacementEok: 999 }],
    [{ presetId: "unknown", replacementEok: 9 }],
  ] };
  const before = structuredClone({ slots: state.slots, priceOverrides: state.priceOverrides });
  assert.equal(applyPublishedStarforcePrices(defaults, state,
    published({ "giant-fear": 45, "dreamy-belt": 43 }, 6), { preserveItemPrices: true }), true);
  assert.equal(defaults["giant-fear"], 45);
  assert.equal(defaults["dreamy-belt"], 43);
  assert.equal(state.publishedPriceDefaults.revision, 6);
  assert.deepEqual({ slots: state.slots, priceOverrides: state.priceOverrides }, before);
  applyPublishedStarforcePrices(defaults, state,
    published({ "giant-fear": 60, "dreamy-belt": 50 }, 7), { preserveItemPrices: true });
  assert.equal(defaults["giant-fear"], 60);
  assert.equal(defaults["dreamy-belt"], 50);
  assert.deepEqual({ slots: state.slots, priceOverrides: state.priceOverrides }, before);
});

test("가격 문서가 누락되거나 손상되면 마지막 정상 가격을 유지한다", async () => {
  const document = published();
  for (const value of [null, [], { ...document, version: 2 }, { ...document, revision: -1 },
    { ...document, prices: {} }, { ...document, prices: { ...document.prices, "giant-fear": -1 } }]) {
    assert.equal(Boolean(isPublishedPriceDocument(value)), false);
    const defaults = resolveStarforcePrices();
    const original = { ...defaults };
    assert.equal(applyPublishedStarforcePrices(defaults, { slots: [] }, value), false);
    assert.deepEqual(defaults, original);
  }
  await assert.rejects(fetchPublishedStarforcePrices(async () => new Response("{}", { status: 503 })));
  const result = await fetchPublishedStarforcePrices(async (_url, options) => {
    assert.equal(options.credentials, "omit");
    return Response.json(document);
  });
  assert.equal(Object.keys(result.prices).length, STARFORCE_PRICE_CATALOG.length);
});
