import { encode, decode } from "@msgpack/msgpack";
import { packShareSnapshot, unpackShareSnapshot } from "./result-share-schema.js";

// Shared links use a tab-local overlay. Never write a shared calculation into
// the visitor's saved calculator settings, including when a link is invalid.
const PREFIX = "maplestarforce:";
const PROFILE_KEY = `${PREFIX}character-profile:v2`;
const KEYS = {
  starforce: [`${PREFIX}v5`],
  potential: [`${PREFIX}potential:v6`, `${PREFIX}additional:v6`, `${PREFIX}combined-potential:v1`, `${PREFIX}potential-equipment:v1`, PROFILE_KEY],
  ability: [`${PREFIX}ability:v2`],
  "add-option": [`${PREFIX}add-option:v2`, PROFILE_KEY],
  scroll: [`${PREFIX}scroll:v2`, PROFILE_KEY],
  pet: [`${PREFIX}pet:v3`],
  soul: [`${PREFIX}soul:v1`],
};
const ITEMS_KEY = `${PREFIX}items:v1`;
const MAX_BYTES = 256 * 1024;
const MAX_TOKEN_LENGTH = 64 * 1024;
const canonicalTool = (tool) => tool === "additional" ? "potential" : tool;
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export function createCalculatorStorage(nativeStorage) {
  let isolated = false;
  const memory = new Map();
  return {
    isolate(values = {}) {
      isolated = true;
      memory.clear();
      for (const [key, value] of Object.entries(values)) memory.set(key, JSON.stringify(value));
    },
    getItem(key) {
      if (!isolated) {
        try { return nativeStorage().getItem(key); } catch { /* blocked storage */ }
      }
      return memory.get(key) ?? null;
    },
    setItem(key, value) {
      memory.set(key, String(value));
      if (!isolated) {
        try { nativeStorage().setItem(key, String(value)); } catch { /* tab-only fallback */ }
      }
    },
    removeItem(key) {
      memory.delete(key);
      if (!isolated) {
        try { nativeStorage().removeItem(key); } catch { /* blocked storage */ }
      }
    },
  };
}

export const calculatorStorage = createCalculatorStorage(() => globalThis.localStorage);
export const calculatorSessionStorage = createCalculatorStorage(() => globalThis.sessionStorage);
let shared = false;
let sharedView = {};
let capture = () => ({});
let captureProfile = null;
let personalPriceSetter = null;
export const isSharedResult = () => shared;
export const getSharedResultView = () => sharedView;
export function registerResultShare(callback, { setPersonalPrices = null } = {}) {
  capture = callback;
  personalPriceSetter = setPersonalPrices;
}
export function setResultSharePersonalPrices(enabled) {
  if (!shared || !personalPriceSetter) return { enabled: false, message: "스페어값을 불러올 수 없습니다." };
  return personalPriceSetter(enabled === true);
}
export function registerResultShareProfile(callback) { captureProfile = callback; }

function readJSON(storage, key) {
  try { return JSON.parse(storage.getItem(key)); } catch { return null; }
}

// Include the conversion profile used by the calculator, not equipment tooltips,
// other characters, saved target libraries, or another calculator's settings.
function calculationProfile(value) {
  if (!value?.character || !value?.profiles?.fullBoss) return null;
  const { name, className, level, world } = value.character;
  return {
    character: { name, className, level, world },
    profiles: { fullBoss: value.profiles.fullBoss },
    mode: "fullBoss",
    presetSelection: value.presetSelection,
    presetRequest: value.presetRequest,
    dataFreshness: value.dataFreshness,
  };
}

export function buildResultSnapshot(tool, current = {}, storage = calculatorStorage, session = calculatorSessionStorage) {
  tool = canonicalTool(tool);
  if (!Object.hasOwn(KEYS, tool)) throw new Error("공유할 수 없는 계산기입니다.");
  const local = {};
  for (const key of KEYS[tool]) {
    if (tool === "potential" && /:(potential|additional):v6$|:combined-potential:v1$/.test(key)
      && current.local && !Object.hasOwn(current.local, key)) continue;
    let value = Object.hasOwn(current.local ?? {}, key) ? current.local[key] : readJSON(storage, key);
    if (key === PROFILE_KEY) value = calculationProfile(value);
    if (isRecord(value)) local[key] = value;
  }
  const sessionValues = {};
  if (tool === "starforce") {
    const items = current.session?.[ITEMS_KEY] ?? readJSON(session, ITEMS_KEY);
    const selected = items?.slots?.[items.slot ?? 0];
    // Only the currently selected equipment list is part of this result.
    sessionValues[ITEMS_KEY] = { slots: [Array.isArray(selected) ? selected : [], [], []], slot: 0 };
  }
  const view = { routeId: String(current.view?.routeId ?? "").slice(0, 100) };
  if (tool === "potential") {
    view.system = Object.hasOwn(local, `${PREFIX}combined-potential:v1`) ? "combined"
      : Object.hasOwn(local, `${PREFIX}additional:v6`) ? "additional" : "regular";
  }
  return { version: 1, tool, local, session: sessionValues, view };
}

function validateSnapshot(value, tool) {
  if (!isRecord(value) || value.version !== 1 || value.tool !== canonicalTool(tool) || !Object.hasOwn(KEYS, value.tool)) {
    throw new Error("이 계산기에 맞는 공유 링크가 아닙니다.");
  }
  if (Object.keys(value).some((key) => !["version", "tool", "local", "session", "view"].includes(key))) {
    throw new Error("공유 설정이 손상되었습니다.");
  }
  for (const [name, allowed] of [["local", KEYS[value.tool]], ["session", value.tool === "starforce" ? [ITEMS_KEY] : []]]) {
    if (!isRecord(value[name])) throw new Error("공유 설정이 손상되었습니다.");
    for (const [key, entry] of Object.entries(value[name])) {
      if (!allowed.includes(key) || !isRecord(entry)) throw new Error("공유 설정이 손상되었습니다.");
    }
  }
  if (value.view !== undefined && (!isRecord(value.view) || typeof value.view.routeId !== "string" || value.view.routeId.length > 100)) {
    throw new Error("공유 설정이 손상되었습니다.");
  }
  if (value.view?.system !== undefined && !["regular", "additional", "combined"].includes(value.view.system)) {
    throw new Error("공유 설정이 손상되었습니다.");
  }
  return value;
}

// Only JSON data is used by calculators. Reject MessagePack extensions/binary
// values outside schema masks, prototype keys, non-finite numbers and deep trees.
function validateTree(value, allowMasks = false, depth = 0) {
  if (depth > 64) throw new Error("공유 설정이 너무 복잡합니다.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (allowMasks && value instanceof Uint8Array) return;
  if (Array.isArray(value)) {
    if (value.length > 8192) throw new Error("공유 설정이 너무 큽니다.");
    for (const entry of value) validateTree(entry, allowMasks, depth + 1);
    return;
  }
  if (isRecord(value) && Object.getPrototypeOf(value) === Object.prototype) {
    if (Object.keys(value).length > 4096) throw new Error("공유 설정이 너무 큽니다.");
    for (const [key, entry] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("공유 설정이 손상되었습니다.");
      validateTree(entry, allowMasks, depth + 1);
    }
    return;
  }
  throw new Error("공유 설정이 손상되었습니다.");
}

async function limitedBytes(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_BYTES) {
        await reader.cancel();
        throw new Error("공유할 설정이 너무 큽니다. 장비 목록을 줄여 주세요.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function encodeResultSnapshot(snapshot) {
  // Match the previous JSON storage semantics for optional/undefined fields.
  const json = JSON.stringify(snapshot);
  if (new TextEncoder().encode(json).length > MAX_BYTES) throw new Error("공유할 설정이 너무 큽니다. 장비 목록을 줄여 주세요.");
  const clean = JSON.parse(json);
  validateTree(clean);
  validateSnapshot(clean, clean.tool);
  const bytes = encode(packShareSnapshot(clean));
  let packed = bytes;
  let version = "v2";
  // Large character profiles benefit from extra compression, small settings
  // often grow. Always retain the shorter MessagePack representation.
  if (typeof CompressionStream === "function" && typeof DecompressionStream === "function") {
    const compressed = await limitedBytes(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")));
    if (Math.ceil(compressed.length * 4 / 3) + 4 < Math.ceil(bytes.length * 4 / 3) + 3) {
      packed = compressed; version = "v2g";
    }
  }
  let binary = "";
  for (const byte of packed) binary += String.fromCharCode(byte);
  const token = `${version}.${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")}`;
  if (token.length > MAX_TOKEN_LENGTH) throw new Error("공유할 설정이 너무 큽니다. 장비 목록을 줄여 주세요.");
  return token;
}

export async function decodeResultSnapshot(token, tool) {
  if (token.length > MAX_TOKEN_LENGTH || !/^v2g?\.[A-Za-z0-9_-]+$/.test(token)) throw new Error("공유 링크가 올바르지 않습니다.");
  const [version, encoded] = token.split(".");
  const binary = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
  const packed = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const bytes = version === "v2g"
    ? await limitedBytes(new Blob([packed]).stream().pipeThrough(new DecompressionStream("gzip"))) : packed;
  const decoded = decode(bytes, {
    maxStrLength: MAX_BYTES, maxBinLength: MAX_BYTES,
    maxArrayLength: 8192, maxMapLength: 4096, maxExtLength: 0,
    mapKeyConverter: (key) => {
      if (typeof key !== "string" || ["__proto__", "prototype", "constructor"].includes(key)) throw new Error("공유 설정이 손상되었습니다.");
      return key;
    },
  });
  validateTree(decoded, true);
  const snapshot = unpackShareSnapshot(decoded);
  validateTree(snapshot);
  if (new TextEncoder().encode(JSON.stringify(snapshot)).length > MAX_BYTES) throw new Error("공유 설정이 너무 큽니다.");
  return validateSnapshot(snapshot, tool);
}

export async function initializeResultShare(tool, hash = globalThis.location?.hash ?? "") {
  shared = /^#share(?:=|$)/.test(hash);
  if (!shared) return { shared: false };
  calculatorStorage.isolate();
  calculatorSessionStorage.isolate();
  try {
    const snapshot = await decodeResultSnapshot(hash.slice("#share=".length), tool);
    calculatorStorage.isolate(snapshot.local);
    calculatorSessionStorage.isolate(snapshot.session);
    sharedView = snapshot.view ?? {};
    return { shared: true };
  } catch {
    return { shared: true, error: "공유 링크를 읽을 수 없습니다. 링크 전체를 다시 복사해 주세요." };
  }
}

export async function createResultShareURL(tool, href = globalThis.location.href) {
  const current = capture();
  if (captureProfile) current.local = { ...current.local, [PROFILE_KEY]: captureProfile() };
  const snapshot = buildResultSnapshot(tool, current);
  const url = new URL(href);
  const system = snapshot.view.system;
  url.search = "";
  if (canonicalTool(tool) === "potential" && ["additional", "combined"].includes(system)) url.searchParams.set("system", system);
  url.hash = `share=${await encodeResultSnapshot(snapshot)}`;
  return url.href;
}
