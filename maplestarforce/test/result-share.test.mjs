import assert from "node:assert/strict";
import test from "node:test";
import { gzipSync, gunzipSync } from "node:zlib";
import { encode, decode, ExtData } from "@msgpack/msgpack";
import { packShareSnapshot } from "../src/shared/result-share-schema.js";
import {
  createCalculatorStorage, buildResultSnapshot, encodeResultSnapshot,
  decodeResultSnapshot, initializeResultShare, calculatorStorage,
  calculatorSessionStorage, isSharedResult,
} from "../src/shared/result-share-state.js";

const key = (suffix) => `maplestarforce:${suffix}`;
function native(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values, getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key),
  };
}
const wireToken = (value) => `v2.${Buffer.from(encode(value)).toString("base64url")}`;
const snapshot = (tool, suffix, state, view) => ({
  version: 1, tool, local: { [key(suffix)]: state }, session: {}, ...(view ? { view } : {}),
});

test("shared writes and removals leave native local/session storage byte-for-byte intact", () => {
  for (const suffix of ["ability:v2", "items:v1"]) {
    const persistent = native({ [key(suffix)]: '{"personal":true}', private: "keep" });
    const before = [...persistent.values];
    const storage = createCalculatorStorage(() => persistent);
    storage.isolate({ [key(suffix)]: { shared: true } });
    assert.equal(storage.getItem("private"), null);
    assert.deepEqual(JSON.parse(storage.getItem(key(suffix))), { shared: true });
    storage.setItem(key(suffix), '{"edited":true}');
    storage.removeItem("private");
    storage.setItem("new-shared-key", "value");
    assert.equal(storage.enablePersistence(), false);
    assert.deepEqual([...persistent.values], before);
  }
});

test("ordinary visits defer writes until calculator interaction; blocked storage keeps an in-memory fallback", () => {
  const persistent = native({ removed: "keep-until-interaction" });
  const storage = createCalculatorStorage(() => persistent);
  storage.setItem("key", "1");
  storage.removeItem("removed");
  assert.equal(persistent.getItem("key"), null);
  assert.equal(persistent.getItem("removed"), "keep-until-interaction");
  assert.equal(storage.getItem("key"), "1");
  assert.equal(storage.getItem("removed"), null);
  assert.equal(storage.enablePersistence(), true);
  assert.equal(persistent.getItem("key"), "1");
  assert.equal(persistent.getItem("removed"), null);
  persistent.setItem("key", "2");
  assert.equal(storage.getItem("key"), "2");
  storage.setItem("key", "3");
  assert.equal(persistent.getItem("key"), "3");
  storage.removeItem("key");
  assert.equal(persistent.getItem("key"), null);
  const blocked = createCalculatorStorage(() => { throw new Error("blocked"); });
  blocked.setItem("key", "3");
  blocked.enablePersistence();
  assert.equal(blocked.getItem("key"), "3");
});

test("Unicode settings and chosen ability route survive MessagePack link round trip", async () => {
  const snapshot = buildResultSnapshot("ability", {
    local: { [key("ability:v2")]: { job: "보우마스터", useAdvanced: true, abyssCount: 100 } },
    view: { routeId: "reference" },
  }, native());
  const token = await encodeResultSnapshot(snapshot);
  assert.match(token, /^v2g?\.[\w-]+$/);
  assert.deepEqual(await decodeResultSnapshot(token, "ability"), snapshot);
  await assert.rejects(decodeResultSnapshot(token, "soul"));
});

test("starforce shares selected equipment prices without personal-view caches, preserving old links", async () => {
  const settings = Object.freeze({ event: "shining", priceOverrides: { "giant-fear": 77 },
    publishedPriceDefaults: { version: 1, revision: 2, prices: { "giant-fear": 52 } } });
  const stored = JSON.stringify(settings);
  const local = native({ [key("v5")]: stored, [key("pet:v3")]: '{"count":999}' });
  const selected = { name: "selected", presetId: "giant-fear", startStar: 17, targetStar: 23, replacementEok: 77 };
  const session = native({ [key("items:v1")]: JSON.stringify({
    slots: [[{ name: "private" }], [selected], [{ name: "other" }]],
    slot: 1, characterSources: [{ name: "not shared" }],
  }) });
  const snapshot = buildResultSnapshot("starforce", {}, local, session);
  assert.deepEqual(Object.keys(snapshot.local), [key("v5")]);
  assert.deepEqual(snapshot.session[key("items:v1")], { slots: [[selected], [], []], slot: 0 });
  assert.deepEqual(snapshot.local[key("v5")], { event: "shining", priceOverrides: { "giant-fear": 77 } });
  assert.equal(local.getItem(key("v5")), stored);
  assert.deepEqual(buildResultSnapshot("starforce", { local: { [key("v5")]: settings } }, local, session), snapshot);
  assert.deepEqual(await decodeResultSnapshot(await encodeResultSnapshot(snapshot), "starforce"), snapshot);
  // Existing v2/v2g links may contain the old cache and must still decode unchanged.
  const legacy = { ...snapshot, local: { [key("v5")]: settings } };
  assert.deepEqual(await decodeResultSnapshot(await encodeResultSnapshot(legacy), "starforce"), legacy);
  assert.ok(!JSON.stringify(snapshot).includes("private"));
});

test("v3 shares Nexon icon codes, restoring exact URLs and preserving legacy v2 links", async () => {
  const prefix = "https://open.api.nexon.com/static/maplestory/item/icon/";
  const value = { ...snapshot("starforce", "v5", { event: "shining", multiplier: 1.07 }),
    session: { [key("items:v1")]: { slots: [Array.from({ length: 10 }, (_, index) => ({
      presetId: `item-${index}`, displayIcon: `${prefix}KEPDJBN${index}`,
      startStar: 17, targetStar: 21, replacementEok: 14.5,
    })), [], []], slot: 0 } } };
  const before = JSON.stringify(value);
  const legacyBytes = encode(packShareSnapshot(value));
  for (const legacy of [wireToken(packShareSnapshot(value)), `v2g.${gzipSync(legacyBytes).toString("base64url")}`]) {
    assert.deepEqual(await decodeResultSnapshot(legacy, "starforce"), value);
  }
  const token = await encodeResultSnapshot(value);
  assert.match(token, /^v3g?\./);
  assert.deepEqual(await decodeResultSnapshot(token, "starforce"), value);
  const [tag, payload] = token.split(".");
  const bytes = Buffer.from(payload, "base64url");
  const wire = decode(tag.endsWith("g") ? gunzipSync(bytes) : bytes);
  assert.ok(!JSON.stringify(wire).includes(prefix));
  assert.ok(JSON.stringify(wire).includes("KEPDJBN0"));
  assert.ok(token.length < `v2g.${gzipSync(legacyBytes).toString("base64url")}`.length);
  const previous = [globalThis.CompressionStream, globalThis.DecompressionStream];
  try {
    globalThis.CompressionStream = undefined;
    globalThis.DecompressionStream = undefined;
    const raw = await encodeResultSnapshot(value);
    assert.ok(raw.startsWith("v3."));
    assert.deepEqual(await decodeResultSnapshot(raw, "starforce"), value);
  } finally {
    [globalThis.CompressionStream, globalThis.DecompressionStream] = previous;
  }
  assert.equal(JSON.stringify(value), before);
});

test("v3 preserves custom, relative and nonstandard icon values without guessing URLs", async () => {
  const prefix = "https://open.api.nexon.com/static/maplestory/item/icon/";
  const icons = ["./equipments/eternal-shoulder.png", "KEPDJBND", "https://example.com/icon/KEPDJBND",
    `${prefix}KEPDJBND?size=2`, `${prefix}KEPDJBND#icon`, `${prefix}../KEPDJBND`,
    `${prefix}한글`, prefix, "", null, ["KEPDJBND"], { custom: "KEPDJBND" }];
  const value = { ...snapshot("starforce", "v5", {}), session: { [key("items:v1")]: {
    slots: [[...Array.from({ length: 10 }, () => ({ displayIcon: `${prefix}KEPDJBND` })),
      ...icons.map((displayIcon) => ({ displayIcon }))], [], []], slot: 0,
  } } };
  const token = await encodeResultSnapshot(value);
  assert.match(token, /^v3g?\./);
  assert.deepEqual(await decodeResultSnapshot(token, "starforce"), value);
});

test("v3 rejects malformed icon codes and wrappers", async () => {
  const fixture = (icon) => [0, [[11, [new Uint8Array([3]),
    [[[new Uint8Array([32, 0]), icon]], [], []], 0]]]];
  for (const icon of ["", "../icon", "https://example.com/icon", [], ["one", "two"], 3, null, {}]) {
    const token = `v3.${Buffer.from(encode(fixture(icon))).toString("base64url")}`;
    await assert.rejects(decodeResultSnapshot(token, "starforce"));
  }
});

test("potential shares active subsystem and calculation profile, excluding saved names, presets and equipment tooltips", () => {
  const profile = {
    character: { name: "후니", className: "보우마스터", level: 290, ocid: "not-needed" },
    profiles: { fullBoss: { statEquivalence: { allStatPercentToMainPercent: 1.1 } }, ordinary: { unused: true } },
    equipmentSummary: { items: ["tooltip"] },
  };
  const storage = native({
    [key("character-profile:v2")]: JSON.stringify(profile),
    [key("character-names:v1")]: '["private"]',
    [key("potential:target-presets:v1")]: '["private"]',
    [key("potential:v6")]: '{"other":true}',
  });
  const snapshot = buildResultSnapshot("potential", { local: { [key("additional:v6")]: { itemLevel: 250 } } }, storage);
  assert.deepEqual(Object.keys(snapshot.local), [key("additional:v6"), key("character-profile:v2")]);
  assert.equal(snapshot.view.system, "additional");
  assert.deepEqual(snapshot.local[key("character-profile:v2")].profiles.fullBoss, profile.profiles.fullBoss);
  for (const word of ["private", "tooltip", "not-needed", "ordinary"]) assert.ok(!JSON.stringify(snapshot).includes(word));
});

test("round trip all calculators, nested settings, missing fields, null, zero and extra fields", async () => {
  const target = { type: "attack-power-percent", value: 30 };
  const potential = { part: 1, itemLevel: 250, grade: "legendary", resetMethod: "prime", miracle: false,
    primeTargetSets: [{ targets: [{ type: "", value: "" }, target, { type: "", value: null }] }],
    targetSets: [{ targets: [target] }], rankProgressByGrade: { rare: 0, unique: 1.25 } };
  const cases = [
    { ...snapshot("starforce", "v5", { event: "none", pc: false, bulk: { startStar: 0, targetStar: 23 } }),
      session: { [key("items:v1")]: { slots: [[{ presetId: "eternal", startStar: 0, targetStar: 23, quantity: 2, extra: "아이템" }], [], []], slot: 0 } } },
    snapshot("potential", "potential:v6", potential, { routeId: "", system: "regular" }),
    snapshot("potential", "additional:v6", potential, { routeId: "", system: "additional" }),
    snapshot("potential", "combined-potential:v1", { targets: [target] }, { routeId: "", system: "combined" }),
    snapshot("ability", "ability:v2", { method: "optimal", useAdvanced: true, abyssCount: 50, honorPriceMan: 300, abyssPriceEok: 2.2,
      targets: [{ type: "critical", minimum: 30, grade: "legendary", locked: false }] }, { routeId: "inventory" }),
    snapshot("add-option", "add-option:v2", { target: 140, flatMainStatToDamagePercent: 0.000125, damagePercent: null }),
    snapshot("scroll", "scroll:v2", { method: "return", stats: { STR: 0, DEX: 1, INT: null }, tracePrice: 5000 }),
    snapshot("pet", "pet:v3", { wonderBlackEvent: false, wonderBlackEventIncreasePercent: 20, auctionFeeRate: 0.03 }),
    snapshot("soul", "soul:v1", { currentStage: 0, etherPrices: [1.1, 2.2, 3.3, 4.4], chanceAverage: false, chance: 63.21409908800195, targets: [target] }),
  ];
  for (const value of cases) {
    const token = await encodeResultSnapshot(value);
    assert.deepEqual(await decodeResultSnapshot(token, value.tool), value, value.tool);
  }
});

test("frozen v2 wire fixture remains stable regardless of defaults and input key order", async () => {
  // MessagePack [pet=5, [[pet-store=9, [3-byte field mask, targetCount=3]]]].
  const token = `v2.${Buffer.from("920591920992c40301000003", "hex").toString("base64url")}`;
  const value = snapshot("pet", "pet:v3", { targetCount: 3 });
  assert.deepEqual(await decodeResultSnapshot(token, "pet"), value);
  assert.equal(await encodeResultSnapshot(value), token);
  assert.deepEqual(decode(new Uint8Array(Buffer.from(token.slice(3), "base64url"))), [5, [[9, [new Uint8Array([1, 0, 0]), 3]]]]);
  assert.equal(await encodeResultSnapshot(snapshot("pet", "pet:v3", { targetCount: 3, resultUnit: "meso" })),
    await encodeResultSnapshot(snapshot("pet", "pet:v3", { resultUnit: "meso", targetCount: 3 })));
});

test("small settings need no compression support; large calculation profiles use shorter gzip MessagePack", async () => {
  const value = snapshot("potential", "potential:v6", { part: 1, itemLevel: 200 });
  value.local[key("character-profile:v2")] = {
    character: { name: "후니", className: "보우마스터", world: "스카니아", level: 290 },
    profiles: { fullBoss: { mainStat: "DEX", statEquivalence: { allStatPercentToMainPercent: 1.12 },
      details: { rows: Array.from({ length: 50 }, (_, index) => ({ label: "계산에 사용하는 수치", value: index * 0.001 })) } } },
  };
  const compressed = await encodeResultSnapshot(value);
  assert.ok(compressed.startsWith("v2g."));
  assert.deepEqual(await decodeResultSnapshot(compressed, "potential"), value);
  const previous = [globalThis.CompressionStream, globalThis.DecompressionStream];
  try {
    globalThis.CompressionStream = undefined;
    globalThis.DecompressionStream = undefined;
    const raw = await encodeResultSnapshot(value);
    assert.ok(raw.startsWith("v2."));
    assert.ok(compressed.length < raw.length);
    assert.deepEqual(await decodeResultSnapshot(raw, "potential"), value);
  } finally {
    [globalThis.CompressionStream, globalThis.DecompressionStream] = previous;
  }
});

test("reject old format, foreign keys, prototype keys, malformed schema and oversized data", async () => {
  const base = snapshot("soul", "soul:v1", {});
  const malformed = [
    [99, []], [6, [[99, []]]], [6, [[10, [new Uint8Array([0, 0])]], [10, [new Uint8Array([0, 0])]]]],
    [6, [[10, [new Uint8Array([0])]]]], // wrong mask size
    [6, [[10, [new Uint8Array([0, 128])]]]], // unknown mask bit
    [6, [[10, [new Uint8Array([1, 0])]]]], // missing field value
    [6, [[10, [new Uint8Array([0, 0]), { mode: "duplicate" }]]]],
    packShareSnapshot({ ...base, local: { [key("ability:v2")]: {} } }),
    packShareSnapshot(snapshot("soul", "soul:v1", { extra: { constructor: "bad" } })),
    packShareSnapshot(snapshot("soul", "soul:v1", { extra: new Uint8Array([1]) })),
    packShareSnapshot(snapshot("soul", "soul:v1", { extra: new ExtData(1, new Uint8Array()) })),
    packShareSnapshot(snapshot("soul", "soul:v1", { extra: Infinity })),
    packShareSnapshot(snapshot("soul", "soul:v1", { extra: Array(8193).fill(0) })),
  ];
  let deep = {};
  for (let i = 0; i < 70; i++) deep = { nested: deep };
  malformed.push(packShareSnapshot(snapshot("soul", "soul:v1", { extra: deep })));
  const bomb = encode(packShareSnapshot(snapshot("soul", "soul:v1", { large: "x".repeat(300000) })));
  for (const token of [
    "v1.bad", `v1.${gzipSync(JSON.stringify(base)).toString("base64url")}`, "v2.bad", "v2." + "a".repeat(66000),
    ...malformed.map(wireToken), `v2g.${gzipSync(bomb).toString("base64url")}`,
  ]) await assert.rejects(decodeResultSnapshot(token, "soul"));
  for (const value of [
    { ...base, version: 99 }, { ...base, unexpected: 1 },
    snapshot("soul", "soul:v1", JSON.parse('{"__proto__":{"polluted":true}}')),
    snapshot("soul", "soul:v1", { large: "x".repeat(300000) }),
  ]) await assert.rejects(encodeResultSnapshot(value));
  assert.equal({}.polluted, undefined);
});

test("even an invalid share link isolates both stores before calculator initialization", async () => {
  const local = native({ [key("soul:v1")]: '{"personal":true}' });
  const session = native({ [key("items:v1")]: '{"personal":true}' });
  const previousLocal = globalThis.localStorage, previousSession = globalThis.sessionStorage;
  globalThis.localStorage = local;
  globalThis.sessionStorage = session;
  try {
    const status = await initializeResultShare("soul", "#share=v1.bad");
    assert.ok(status.error);
    assert.equal(isSharedResult(), true);
    assert.equal(calculatorStorage.getItem(key("soul:v1")), null);
    calculatorStorage.setItem(key("soul:v1"), "changed");
    calculatorSessionStorage.setItem(key("items:v1"), "changed");
    assert.equal(local.getItem(key("soul:v1")), '{"personal":true}');
    assert.equal(session.getItem(key("items:v1")), '{"personal":true}');
  } finally {
    globalThis.localStorage = previousLocal;
    globalThis.sessionStorage = previousSession;
  }
});


test("potential share links preserve explicit mean vs percentile mode at the same displayed probability", async () => {
  for (const targetChanceAverage of [true, false]) {
    const value = snapshot("potential", "additional:v6", {
      targetChancePercent: 53.44, targetChanceAverage, calculationMode: "rank-up",
    });
    const encoded = await encodeResultSnapshot(value);
    const decoded = await decodeResultSnapshot(encoded, "potential");
    assert.equal(decoded.local[key("additional:v6")].targetChanceAverage, targetChanceAverage);
    assert.equal(decoded.local[key("additional:v6")].targetChancePercent, 53.44);
  }
});
