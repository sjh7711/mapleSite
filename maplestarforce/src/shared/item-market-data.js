export const ITEM_MARKET_MANIFEST_SCHEMA = "maplestarforce.item-market.manifest.v1";
export const ITEM_MARKET_CATALOG_SCHEMA = "maplestarforce.item-market.catalog.v1";
export const ITEM_MARKET_ITEM_SCHEMA = "maplestarforce.item-market.item.v1";

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SAFE_ARTIFACT_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;
const ICON_ASSET_KEY_PATTERN = /^[A-Z0-9]{1,32}$/u;
const ITEM_ICON_ORIGIN = "https://avatar.maplestory.nexon.com";

export function normalizeMarketItemName(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

/**
 * The catalog only exposes a generic Nexon asset key. It never accepts a raw
 * URL from capture data, so a malformed value cannot redirect visitors to an
 * arbitrary third-party host.
 */
export function itemMarketIconUrl(entry) {
  const key = entry?.icon_asset_key;
  if (typeof key !== "string" || !ICON_ASSET_KEY_PATTERN.test(key)) return null;
  return `${ITEM_ICON_ORIGIN}/ItemIcon/${key}.png`;
}

function absoluteUrl(value) {
  return new URL(value, globalThis.location?.origin || "https://local.invalid");
}

function requireDatasetVersion(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} 데이터 버전이 없습니다.`);
  }
  return value;
}

function requireSha256(value, label) {
  if (!SHA256_PATTERN.test(value || "")) {
    throw new Error(`${label} SHA-256 형식이 올바르지 않습니다.`);
  }
  return value;
}

async function sha256Hex(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (subtle && typeof subtle.digest === "function") {
    const digest = await subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (value) =>
      value.toString(16).padStart(2, "0")
    ).join("");
  }

  if (globalThis.process?.versions?.node) {
    const moduleName = "node:crypto";
    const { createHash } = await import(/* @vite-ignore */ moduleName);
    return createHash("sha256").update(bytes).digest("hex");
  }

  throw new Error("SHA-256을 검증할 수 없는 환경입니다.");
}

async function responseBytes(response) {
  if (typeof response?.arrayBuffer === "function") {
    return new Uint8Array(await response.arrayBuffer());
  }
  if (typeof response?.text === "function") {
    return new TextEncoder().encode(await response.text());
  }
  throw new Error("시세 데이터 응답 본문을 읽을 수 없습니다.");
}

function verifyResponseUrl(response, requestedUrl) {
  if (!response?.url) return;
  if (absoluteUrl(response.url).href !== absoluteUrl(requestedUrl).href) {
    throw new Error("시세 데이터 요청 URL과 실제 응답 URL이 다릅니다.");
  }
}

async function fetchJson(fetcher, url, expectedSchema, options = {}) {
  const response = await fetcher(url, { cache: options.cache || "default" });
  if (!response?.ok) throw new Error(`시세 데이터 요청 실패 (${response?.status || "network"})`);
  verifyResponseUrl(response, url);
  const bytes = await responseBytes(response);
  if (options.expectedSha256) {
    const expectedSha256 = requireSha256(options.expectedSha256, options.hashLabel || "시세 데이터");
    const actualSha256 = await sha256Hex(bytes);
    if (actualSha256 !== expectedSha256) {
      throw new Error(`${options.hashLabel || "시세 데이터"} SHA-256이 manifest와 다릅니다.`);
    }
  }

  let payload;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new Error(`시세 데이터 JSON을 읽을 수 없습니다: ${error.message}`);
  }
  if (payload?.schema_version !== expectedSchema) {
    throw new Error(`지원하지 않는 시세 데이터 형식: ${payload?.schema_version || "missing"}`);
  }
  return payload;
}

function resolveArtifactUrl(baseUrl, relativePath, label) {
  if (
    typeof relativePath !== "string" ||
    !SAFE_ARTIFACT_PATH_PATTERN.test(relativePath) ||
    relativePath.startsWith("/") ||
    relativePath.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error(`${label} 경로가 안전한 상대 경로가 아닙니다.`);
  }

  const base = absoluteUrl(baseUrl);
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    throw new Error(`${label} 기준 URL 형식이 올바르지 않습니다.`);
  }
  const directory = new URL(".", base);
  const resolved = new URL(relativePath, directory);
  if (
    resolved.origin !== base.origin ||
    !resolved.pathname.startsWith(directory.pathname) ||
    resolved.search ||
    resolved.hash
  ) {
    throw new Error(`${label} URL이 기준 경로와 일치하지 않습니다.`);
  }
  return resolved.toString();
}

function validateManifest(manifest) {
  if (manifest?.schema_version !== ITEM_MARKET_MANIFEST_SCHEMA) {
    throw new Error(`지원하지 않는 시세 데이터 형식: ${manifest?.schema_version || "missing"}`);
  }
  requireDatasetVersion(manifest.dataset_version, "시세 manifest");
  if (!manifest.catalog || typeof manifest.catalog !== "object") {
    throw new Error("시세 manifest에 catalog 정보가 없습니다.");
  }
  requireSha256(manifest.catalog.sha256, "시세 catalog");
  return manifest;
}

function validateCatalog(catalog, manifest, catalogUrl) {
  requireDatasetVersion(catalog?.dataset_version, "시세 catalog");
  if (catalog.dataset_version !== manifest.dataset_version) {
    throw new Error("시세 manifest와 catalog 버전이 다릅니다.");
  }
  if (!Array.isArray(catalog.items)) {
    throw new Error("시세 catalog의 장비 목록이 없습니다.");
  }

  const names = new Set();
  for (const entry of catalog.items) {
    const name = normalizeMarketItemName(entry?.name);
    if (!name) throw new Error("시세 catalog에 이름 없는 장비가 있습니다.");
    if (names.has(name)) throw new Error(`시세 catalog에 중복 장비명이 있습니다: ${name}`);
    names.add(name);
    if (entry.icon_asset_key != null && !ICON_ASSET_KEY_PATTERN.test(entry.icon_asset_key)) {
      throw new Error(`${name} 장비 아이콘 키 형식이 올바르지 않습니다.`);
    }
    requireSha256(entry.sha256, `${name} item shard`);
    resolveArtifactUrl(catalogUrl, entry.file, `${name} item shard`);
  }
  return catalog;
}

export async function loadItemMarketManifest(options = {}) {
  const fetcher = options.fetcher || globalThis.fetch;
  if (typeof fetcher !== "function") throw new Error("fetch를 사용할 수 없습니다.");
  const manifestUrl = options.manifestUrl || "/item-market/manifest.json";
  const manifest = await fetchJson(fetcher, manifestUrl, ITEM_MARKET_MANIFEST_SCHEMA, {
    cache: "no-cache",
  });
  return validateManifest(manifest);
}

export async function loadItemMarketCatalog(options = {}) {
  const fetcher = options.fetcher || globalThis.fetch;
  const manifestUrl = options.manifestUrl || "/item-market/manifest.json";
  const manifest = options.manifest
    ? validateManifest(options.manifest)
    : await loadItemMarketManifest({ fetcher, manifestUrl });
  const catalogUrl = resolveArtifactUrl(manifestUrl, manifest.catalog.file, "시세 catalog");
  const catalog = await fetchJson(fetcher, catalogUrl, ITEM_MARKET_CATALOG_SCHEMA, {
    cache: "force-cache",
    expectedSha256: manifest.catalog.sha256,
    hashLabel: "시세 catalog",
  });
  validateCatalog(catalog, manifest, catalogUrl);
  return { manifest, catalog, catalogUrl };
}

export function findItemMarketEntry(catalog, itemName) {
  const target = normalizeMarketItemName(itemName);
  return (catalog?.items || []).find((entry) => normalizeMarketItemName(entry.name) === target) || null;
}

export async function loadItemMarketComparables(itemName, options = {}) {
  const fetcher = options.fetcher || globalThis.fetch;
  const loaded = await loadItemMarketCatalog({ ...options, fetcher });
  const entry = findItemMarketEntry(loaded.catalog, itemName);
  if (!entry) return { ...loaded, entry: null, data: null };
  const itemUrl = resolveArtifactUrl(
    loaded.catalogUrl,
    entry.file,
    `${normalizeMarketItemName(entry.name)} item shard`,
  );
  const data = await fetchJson(fetcher, itemUrl, ITEM_MARKET_ITEM_SCHEMA, {
    cache: "force-cache",
    expectedSha256: entry.sha256,
    hashLabel: `${normalizeMarketItemName(entry.name)} item shard`,
  });
  if (data.dataset_version !== loaded.manifest.dataset_version ||
      normalizeMarketItemName(data.item_name) !== normalizeMarketItemName(entry.name)) {
    throw new Error("시세 item shard와 catalog가 일치하지 않습니다.");
  }
  return { ...loaded, entry, data, itemUrl };
}
