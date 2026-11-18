import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { encode } from "@msgpack/msgpack";
import { packShareSnapshot } from "../src/shared/result-share-schema.js";
import { packStarforceV4, unpackStarforceV4 } from "../src/shared/result-share-starforce-v4.js";
import { encodeResultSnapshot, decodeResultSnapshot } from "../src/shared/result-share-state.js";

const SETTINGS = "maplestarforce:v5";
const ITEMS = "maplestarforce:items:v1";
const PREFIX = "https://open.api.nexon.com/static/maplestory/item/icon/";
const settings = (value) => value.local[SETTINGS];
const items = (value) => value.session[ITEMS].slots[0];
const tokenFor = (wire) => `v4.${Buffer.from(encode(wire)).toString("base64url")}`;
const fixture = () => ({ version: 1, tool: "starforce", local: { [SETTINGS]: {
  event: "shining", mvp: "diamond", pc: false, multiplier: 1, customMultipliers: [],
  priceOverrides: {}, foldedOpen: false, bulk: { startStar: 12, targetStar: 21 },
} }, session: { [ITEMS]: { slots: [[{
  presetId: "loose-control", itemLevel: 160, startStar: 17, targetStar: 21,
  displayIcon: `${PREFIX}KEPDJBND`, quantity: 1, spare: 0, replacementEok: 14.5,
  optimize: true, destroyPrevention: [], restore: [],
}], [], []], slot: 0 } }, view: { routeId: "" } });

test("frozen v4 fixture pins preset codes, levels, icon digits, prices and defaults", async () => {
  const hex = "9293c40208040192c40102159196c4022d01031115cea4f391d392ffcc91";
  const wire = packStarforceV4(fixture());
  assert.equal(Buffer.from(encode(wire)).toString("hex"), hex);
  assert.deepEqual(await decodeResultSnapshot(`v4.${Buffer.from(hex, "hex").toString("base64url")}`, "starforce"), fixture());
  assert.deepEqual(unpackStarforceV4(structuredClone(wire)), fixture());
  const reversed = fixture();
  reversed.local[SETTINGS] = Object.fromEntries(Object.entries(settings(reversed)).reverse());
  reversed.session[ITEMS].slots[0][0] = Object.fromEntries(Object.entries(items(reversed)[0]).reverse());
  assert.equal(Buffer.from(encode(packStarforceV4(reversed))).toString("hex"), hex);
});

test("real v3 ten-equipment link re-shares as v4 with all values intact and fewer characters", async () => {
  const legacy = "v3g.H4sIAAAAAAAACm3Pv07CQBzA8TtMHJTEALrKA5h7BqS0lR4R6iMc7QFN2jtyPQc2F_cGJogDG0Tj_5g4I0MNfRMH4-pkWrwB42-55fP93d0IDIdgvMxVtmdhz2Me685cjwScuYtV5evw9ezjshxdLEZLuJUvDnfTczS5WuY-9259zkOKHM6k4H4yLR3MG4atY62pQ7A6RiCbtyjK9F1Aup6D6ID2iXR6ybSQ8So2MYagrNiDw4OAMNdjXdThwqFJvIYaNux6treTjQruSSgFQSF1OHOJGCTxfuqtqm20dAh2lLvueoRJ1KFEJHG-OG8YLd0yWnUIkCI3rqAkGKA29WUSFzKjYaOFIThS5oVKKhjxUZ8IicIeP_ddKpLv9cY6Nu3085X3cToTVT1vVG0uJQ9-G9vA5onxT_P09yYaqsS0tFMLgpKijxvUIX2qHlSz9GZtLaMIDJcQTn8AGE0cXPEBAAA";
  const value = await decodeResultSnapshot(legacy, "starforce");
  assert.equal(items(value).length, 10);
  const before = JSON.stringify(value);
  const token = await encodeResultSnapshot(value);
  assert.match(token, /^v4g\./);
  assert.ok(token.length <= 211); // Full production URL: 246 characters.
  assert.deepEqual(await decodeResultSnapshot(token, "starforce"), value);
  assert.equal(JSON.stringify(value), before);
  const legacyBytes = encode(packShareSnapshot(value));
  for (const old of [`v2.${Buffer.from(legacyBytes).toString("base64url")}`, `v2g.${gzipSync(legacyBytes).toString("base64url")}`]) {
    assert.deepEqual(await decodeResultSnapshot(old, "starforce"), value);
  }
});

test("v4 preserves manual conditions, custom equipment, mismatched levels and unknown fields", async () => {
  const value = fixture();
  Object.assign(settings(value), { event: "none", mvp: "gold", pc: true, multiplier: 1.123456789,
    customMultipliers: [1.13], priceOverrides: { "loose-control": 77.3 }, foldedOpen: true,
    bulk: { startStar: 0, targetStar: 30 }, futureSetting: { enabled: false } });
  Object.assign(items(value)[0], { itemLevel: 200, startStar: 0, targetStar: 30,
    quantity: 3, spare: 4, optimize: false, destroyPrevention: [15, 16, 17], restore: [18, 20],
    extra: { text: "수동 조건", zero: 0, empty: [] } });
  items(value).push({ ...items(value)[0], presetId: "equipped-level-300", itemLevel: 300,
    displayName: "이름을 보존할 장비", displayIcon: "https://example.com/icon.png?size=2" });
  value.view = { routeId: "custom-view", extra: "보존" };
  const wire = packStarforceV4(value);
  assert.ok(wire);
  assert.deepEqual(unpackStarforceV4(structuredClone(wire)), value);
  assert.deepEqual(await decodeResultSnapshot(await encodeResultSnapshot(value), "starforce"), value);
});

test("sparse or unusual snapshots fall back without inventing defaults or dropping slots", async () => {
  const changes = [
    (v) => { delete settings(v).event; },
    (v) => { delete items(v)[0].quantity; },
    (v) => { delete items(v)[0].itemLevel; },
    (v) => { delete v.view; },
    (v) => { v.session[ITEMS].slots[1] = [{ extra: "keep other slot" }]; },
    (v) => { v.session[ITEMS].characterSources = [{ name: "keep" }]; },
    (v) => { items(v)[0].replacementEok = null; },
    (v) => { items(v)[0].replacementEok = [-1, 145]; },
    (v) => { items(v)[0].presetId = 3; },
  ];
  for (const change of changes) {
    const value = fixture(); change(value);
    assert.equal(packStarforceV4(value), null);
    const token = await encodeResultSnapshot(value);
    assert.match(token, /^v[23]g?\./);
    assert.deepEqual(await decodeResultSnapshot(token, "starforce"), value);
  }
});

test("v4 decimal encoding never rounds prices, including non-decimal floating point values", async () => {
  for (const price of [0, 0.2, 14.7, 0.1 + 0.2, 1e-9, Number.MIN_VALUE, Number.MAX_VALUE,
    Number.MAX_SAFE_INTEGER, 123456789.12345678, -1.25]) {
    const value = fixture(); items(value)[0].replacementEok = price;
    assert.deepEqual(await decodeResultSnapshot(await encodeResultSnapshot(value), "starforce"), value);
  }
});

test("v4 restores leading zero icon digits, all supported suffixes and custom icon values", async () => {
  for (const icon of [`${PREFIX}AAAAAAAA`, `${PREFIX}PPPPPPPP`, `${PREFIX}KRA-123_x`,
    "KEPDJBND", "./equipments/item.png", `${PREFIX}KEPDJBND?size=2`, "https://example.com/a.png",
    null, "", ["KEPDJBND"], { custom: "KEPDJBND" }]) {
    const value = fixture(); items(value)[0].displayIcon = icon;
    assert.deepEqual(unpackStarforceV4(structuredClone(packStarforceV4(value))), value);
    assert.deepEqual(await decodeResultSnapshot(await encodeResultSnapshot(value), "starforce"), value);
  }
});

test("v4 can use raw MessagePack when browser compression is unavailable", async () => {
  const previous = [globalThis.CompressionStream, globalThis.DecompressionStream];
  try {
    globalThis.CompressionStream = undefined;
    globalThis.DecompressionStream = undefined;
    const value = fixture(); const token = await encodeResultSnapshot(value);
    assert.ok(token.startsWith("v4."));
    assert.deepEqual(await decodeResultSnapshot(token, "starforce"), value);
  } finally {
    [globalThis.CompressionStream, globalThis.DecompressionStream] = previous;
  }
});

test("v4 rejects malformed containers, masks, preset codes, icon integers and price tags", async () => {
  const outer = (item) => [[new Uint8Array([0, 0])], [item]];
  const bad = [[], [null], [null, []], [[new Uint8Array([0, 0])], null], [[], [], [], []], outer(null),
    outer([new Uint8Array([1])]), outer([new Uint8Array([1, 128]), 0])];
  for (const code of [-1, 31, 0.5]) bad.push(outer([new Uint8Array([1, 0]), code]));
  for (const icon of [-1, 0x100000000, 0.5, "../icon"]) bad.push(outer([new Uint8Array([32, 0]), icon]));
  for (const price of [null, [], [-9, 1], [-0.5, 1], [-1, "145"], [-1, Number.MAX_SAFE_INTEGER + 1]]) {
    bad.push(outer([new Uint8Array([0, 1]), price]));
  }
  for (const wire of bad) await assert.rejects(decodeResultSnapshot(tokenFor(wire), "starforce"));
  await assert.rejects(decodeResultSnapshot(await encodeResultSnapshot(fixture()), "potential"));
});
