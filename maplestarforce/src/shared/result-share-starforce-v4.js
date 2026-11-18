import { packShareSnapshot, unpackShareSnapshot } from "./result-share-schema.js";

// Permanent v4 wire dictionary, independent of UI order, prices and defaults.
// Do not reorder or edit entries/defaults: publish a new wire version instead.
const PRESETS = Object.freeze([
  ["meister-ring", 140], ["daybreak-pendant", 140], ["dominator", 140],
  ["loose-control", 160], ["magic-eyepatch", 160], ["seniority-ring", 160], ["gaen-ring", 160],
  ["dreamy-belt", 200], ["commanding-force", 200], ["giant-fear", 200],
  ["whisper-earring", 200], ["astra-secondary", 200], ["arcane-shoulder", 200],
  ["eternal-hat", 250], ["eternal-part-hat", 250], ["eternal-part-top", 250],
  ["eternal-part-bottom", 250], ["eternal-part-shoulder", 250], ["eternal-glove", 250],
  ["eternal-part-glove", 250], ["eternal-part-shoes", 250], ["eternal-part-cape", 250],
  ["origin-whisper", 250], ["oath-of-death", 250], ["ecstatic-nightmare", 250],
  ["bloody-soul", 250], ["destiny-weapon", 250], ["level-130", 130],
  ["level-135", 135], ["level-145", 145], ["level-150", 150],
].map(Object.freeze));
const PRESET_CODES = new Map(PRESETS.map(([id], index) => [id, index]));
const ITEM_DEFAULTS = Object.freeze({ quantity: 1, spare: 0, optimize: true,
  destroyPrevention: Object.freeze([]), restore: Object.freeze([]) });
const SETTING_DEFAULTS = Object.freeze({ event: "shining", mvp: "diamond", pc: false,
  customMultipliers: Object.freeze([]), priceOverrides: Object.freeze({}), foldedOpen: false });
const SETTINGS_KEY = "maplestarforce:v5";
const ITEMS_KEY = "maplestarforce:items:v1";
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const invalid = () => { throw new Error("공유 설정이 손상되었습니다."); };

function sameJSON(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameJSON(a[key], b[key]));
}

function omitDefaults(value, defaults) {
  for (const [key, entry] of Object.entries(defaults)) {
    if (sameJSON(value[key], entry)) delete value[key];
  }
}

function restoreDefaults(value, defaults) {
  for (const [key, entry] of Object.entries(defaults)) {
    if (!Object.hasOwn(value, key)) value[key] = structuredClone(entry);
  }
}

function compactPrice(value) {
  if (!Number.isFinite(value) || Number.isInteger(value)) return value;
  for (let power = 1; power <= 8; power++) {
    const scaled = Math.round(value * 10 ** power);
    if (Number.isSafeInteger(scaled) && scaled / 10 ** power === value) return [-power, scaled];
  }
  return value;
}

function restorePrice(value) {
  if (typeof value === "number") return value;
  if (!Array.isArray(value) || value.length !== 2 || !Number.isInteger(value[0])
    || value[0] < -8 || value[0] > -1 || !Number.isSafeInteger(value[1])) invalid();
  return value[1] / 10 ** -value[0];
}

// The legacy item field mask is frozen: displayIcon is bit 5. Its v3 suffix
// form becomes an unsigned 32-bit number only for exactly eight A–P letters.
function transformIcons(items, unpack = false) {
  if (!Array.isArray(items)) invalid();
  for (const item of items) {
    if (!Array.isArray(item) || !(item[0] instanceof Uint8Array) || item[0].length !== 2) invalid();
    const mask = item[0];
    if (!(mask[0] & 32)) continue;
    let position = 1;
    for (let bit = 0; bit < 5; bit++) if (mask[0] & (1 << bit)) position++;
    if (position >= item.length) invalid();
    const icon = item[position];
    if (unpack && typeof icon === "number") {
      if (!Number.isInteger(icon) || icon < 0 || icon > 0xffffffff) invalid();
      item[position] = icon.toString(16).padStart(8, "0").split("")
        .map((letter) => String.fromCharCode(parseInt(letter, 16) + 65)).join("");
    } else if (!unpack && typeof icon === "string" && /^[A-P]{8}$/.test(icon)) {
      item[position] = parseInt([...icon].map((letter) => (letter.charCodeAt(0) - 65).toString(16)).join(""), 16);
    }
  }
}

export function packStarforceV4(snapshot) {
  if (snapshot.tool !== "starforce" || !record(snapshot.local[SETTINGS_KEY]) || !record(snapshot.view)) return null;
  const stored = snapshot.session[ITEMS_KEY];
  if (!record(stored) || Object.keys(stored).length !== 2 || stored.slot !== 0
    || !Array.isArray(stored.slots) || stored.slots.length !== 3
    || !stored.slots.every(Array.isArray) || stored.slots[1].length || stored.slots[2].length) return null;
  if (stored.slots[0].some((item) => !record(item) || typeof item.presetId === "number"
    || (Object.hasOwn(item, "replacementEok") && typeof item.replacementEok !== "number"))) return null;

  const compact = structuredClone(snapshot);
  const settings = compact.local[SETTINGS_KEY];
  omitDefaults(settings, SETTING_DEFAULTS);
  if (settings.bulk?.startStar === 12) delete settings.bulk.startStar;
  const items = compact.session[ITEMS_KEY].slots[0];
  for (const item of items) {
    omitDefaults(item, ITEM_DEFAULTS);
    const code = PRESET_CODES.get(item.presetId);
    if (code !== undefined) {
      if (item.itemLevel === PRESETS[code][1]) delete item.itemLevel;
      item.presetId = code;
    }
    if (Object.hasOwn(item, "replacementEok")) item.replacementEok = compactPrice(item.replacementEok);
  }
  const packed = packShareSnapshot(compact, { compactIcons: true });
  const settingsWire = packed[1].find(([id]) => id === 0)[1];
  const itemsWire = packed[1].find(([id]) => id === 11)[1][1][0];
  transformIcons(itemsWire);
  const wire = [settingsWire, itemsWire];
  if (!sameJSON(compact.view, { routeId: "" })) wire.push(packed[2]);

  // Sparse/older/unusual snapshots retain their original v2/v3 representation.
  // A compact candidate is eligible only when every field restores exactly.
  return sameJSON(unpackStarforceV4(structuredClone(wire)), snapshot) ? wire : null;
}

export function unpackStarforceV4(wire) {
  if (!Array.isArray(wire) || ![2, 3].includes(wire.length)) invalid();
  transformIcons(wire[1], true);
  const legacy = [0, [[0, wire[0]], [11, [new Uint8Array([3]), [wire[1], [], []], 0]]]];
  if (wire.length === 3) legacy.push(wire[2]);
  const snapshot = unpackShareSnapshot(legacy, { compactIcons: true });
  const settings = snapshot.local[SETTINGS_KEY];
  restoreDefaults(settings, SETTING_DEFAULTS);
  if (record(settings.bulk) && !Object.hasOwn(settings.bulk, "startStar")) settings.bulk.startStar = 12;
  for (const item of snapshot.session[ITEMS_KEY].slots[0]) {
    if (typeof item.presetId === "number") {
      if (!Number.isInteger(item.presetId) || item.presetId < 0 || item.presetId >= PRESETS.length) invalid();
      item.presetId = PRESETS[item.presetId][0];
    }
    const code = PRESET_CODES.get(item.presetId);
    if (code !== undefined && !Object.hasOwn(item, "itemLevel")) item.itemLevel = PRESETS[code][1];
    if (Object.hasOwn(item, "replacementEok")) item.replacementEok = restorePrice(item.replacementEok);
    restoreDefaults(item, ITEM_DEFAULTS);
  }
  if (wire.length === 2) snapshot.view = { routeId: "" };
  return snapshot;
}
