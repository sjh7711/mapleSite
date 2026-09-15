/* 잠재 확률표를 읽어 온다.

   공식 페이지는 브라우저에서 바로 부를 수 없어(CORS), 미리 받아 쪼개 둔
   파일을 쓴다. 파일은 조합마다 하나씩이고 옵션 이름은 번호로 줄여 두었으므로,
   읽은 뒤 계산기가 아는 모양으로 되돌려 준다. */

/* public/ 에 둔 파일은 사이트 뿌리에 그대로 놓인다. 페이지가 하위 폴더에
   있어도 같은 곳을 보도록 뿌리 기준 경로를 쓴다. */
const BASE = "/potential-tables/";
const CACHE_PREFIX = "maplestarforce:potential-tables:";

let manifestPromise = null;
let indexPromise = null;
let activeVersion = "legacy";

function loadManifest() {
  manifestPromise ??= fetch(`${BASE}manifest.json`, { cache: "no-cache" })
    .then((response) => {
      if (!response.ok) throw new Error(`확률표 버전을 읽지 못했습니다. (${response.status})`);
      return response.json();
    })
    .catch(() => ({ version: "legacy" }));
  return manifestPromise;
}

function cleanupOldCaches(version) {
  if (!("caches" in globalThis)) return;
  const activeCache = `${CACHE_PREFIX}${version}`;
  void caches.keys()
    .then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== activeCache)
        .map((key) => caches.delete(key)),
    ))
    .catch(() => {});
}

async function fetchVersioned(path, version) {
  const url = new URL(
    `${BASE}${path}?v=${encodeURIComponent(version)}`,
    globalThis.location?.origin ?? "http://localhost",
  ).href;
  if (!("caches" in globalThis) || version === "legacy") return fetch(url);
  try {
    const cacheStore = await caches.open(`${CACHE_PREFIX}${version}`);
    const cached = await cacheStore.match(url);
    if (cached) return cached;
    const response = await fetch(url);
    if (response.ok) await cacheStore.put(url, response.clone());
    return response;
  } catch {
    return fetch(url);
  }
}

/** 구간 목록과 이름 사전. 한 번만 받아 두고 계속 쓴다. */
function loadIndex() {
  indexPromise ??= loadManifest()
    .then(async (manifest) => {
      activeVersion = String(manifest?.version || "legacy");
      cleanupOldCaches(activeVersion);
      const response = await fetchVersioned("index.json", activeVersion);
      if (!response.ok) throw new Error(`확률표 안내 파일을 읽지 못했습니다. (${response.status})`);
      return response.json();
    })
    .catch((error) => {
      // 다음에 다시 시도할 수 있게 실패한 약속은 버린다.
      indexPromise = null;
      throw error;
    });
  return indexPromise;
}

/** 장비 레벨이 속한 구간의 시작 레벨. */
export function bandFor(bands, itemLevel) {
  let picked = bands[0];
  for (const band of bands) if (itemLevel >= band) picked = band;
  return picked;
}

/** 증분 갱신된 표는 잠재 종류별로 다른 레벨 구간을 쓸 수 있다. */
export function bandsForSystem(index, system) {
  return index.bandsBySystem?.[system] ?? index.bands;
}

const cache = new Map();

/**
 * 한 조합의 확률표. 표가 없는 조합이면 null.
 * 계산기가 기대하는 `[[{ name, probability }], [...], [...]]` 모양으로 돌려준다.
 */
export async function loadPotentialTables({ system, grade, part, itemLevel }) {
  const index = await loadIndex();
  const band = bandFor(bandsForSystem(index, system), itemLevel);
  const key = `${system}:${grade}:${part}:${band}`;
  if (cache.has(key)) return cache.get(key);

  const file = `${system}-${grade}-${part}-${band}.json`;
  const response = await fetchVersioned(file, index.version ?? activeVersion);
  if (response.status === 404) {
    cache.set(key, null);
    return null;
  }
  if (!response.ok) {
    throw new Error(`확률표를 읽지 못했습니다. (${response.status})`);
  }
  const packed = await response.json();
  // 계산기는 줄 세 개가 담긴 배열을 기대한다.
  const tables = packed.map((line) =>
    line.map(([nameIndex, probability]) => ({
      name: index.names[nameIndex],
      probability,
    })),
  );
  cache.set(key, tables);
  return tables;
}

/** 확률표가 언제 받은 것인지. */
export async function tablesSavedAt(system) {
  const index = await loadIndex();
  return index.savedAtBySystem?.[system] ?? index.savedAt;
}
