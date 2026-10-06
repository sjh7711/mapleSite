// Node.js 22+ / 외부 패키지 없이 실행할 수 있는 장비별 시세 조회 예제.
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const MANIFEST_URL = "https://starforce-market-data.pages.dev/manifest.json";
const schema = (kind) => `maplestarforce.item-market.${kind}.v1`;
const normalizeName = (name) => String(name).normalize("NFKC").replace(/\s+/gu, " ").trim();

function artifactUrl(parentUrl, file) {
  if (typeof file !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(file)
      || file.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("올바르지 않은 데이터 파일 경로입니다.");
  }
  const directory = new URL(".", parentUrl);
  const url = new URL(file, parentUrl);
  if (url.origin !== directory.origin || !url.pathname.startsWith(directory.pathname)) {
    throw new Error("데이터 파일이 안내된 디렉터리 밖에 있습니다.");
  }
  return url.href;
}

async function readJson(url, kind, { sha256, fresh = false } = {}) {
  if (kind !== "manifest" && !/^[0-9a-f]{64}$/u.test(sha256 ?? "")) {
    throw new Error("검증용 SHA-256 값이 없습니다.");
  }
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    ...(fresh ? { cache: "no-store" } : {}),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha256 && createHash("sha256").update(bytes).digest("hex") !== sha256) {
    throw new Error(`SHA-256 불일치: ${url}`);
  }
  const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (data.schema_version !== schema(kind)) throw new Error(`지원하지 않는 스키마: ${data.schema_version}`);
  if (typeof data.dataset_version !== "string" || !data.dataset_version) {
    throw new Error("데이터 버전이 없습니다.");
  }
  return data;
}

export async function loadMarketCatalog() {
  const manifest = await readJson(MANIFEST_URL, "manifest", { fresh: true });
  const catalogUrl = artifactUrl(MANIFEST_URL, manifest.catalog?.file);
  const catalog = await readJson(catalogUrl, "catalog", { sha256: manifest.catalog?.sha256 });
  if (catalog.dataset_version !== manifest.dataset_version || !Array.isArray(catalog.items)) {
    throw new Error("장비 목록의 버전 또는 구조가 올바르지 않습니다.");
  }
  return { manifest, catalog, catalogUrl };
}

export async function loadEquipment(itemName, { snapshot } = {}) {
  const loaded = snapshot ?? await loadMarketCatalog();
  const name = normalizeName(itemName);
  const entry = loaded.catalog.items.find((item) => normalizeName(item.name) === name);
  if (!entry) throw new Error(`수집된 장비 목록에 없습니다: ${name}`);
  const itemUrl = artifactUrl(loaded.catalogUrl, entry.file);
  const data = await readJson(itemUrl, "item", { sha256: entry.sha256 });
  if (data.dataset_version !== loaded.manifest.dataset_version
      || normalizeName(data.item_name) !== name || !Array.isArray(data.records)
      || data.records.length !== entry.records) {
    throw new Error("장비 데이터의 버전·장비명·거래 건수가 목록과 일치하지 않습니다.");
  }
  return { ...loaded, entry, itemUrl, data };
}

// 큰 메소 값을 Number로 변환하지 않고 억 단위 소수 둘째 자리까지 반올림합니다.
export function formatEok(priceMeso) {
  if (typeof priceMeso !== "string" || !/^[0-9]+$/u.test(priceMeso)) {
    throw new Error("메소 가격은 0 이상의 정수 문자열이어야 합니다.");
  }
  const hundredths = (BigInt(priceMeso) + 500_000n) / 1_000_000n;
  return `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, "0")}`;
}

// 직접 실행하면 요약과 거래 3건만 출력합니다. 함수 호출 시 전체 records를 제공합니다.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { manifest, data } = await loadEquipment(process.argv[2] || "가디언 엔젤 링");
    console.log(JSON.stringify({
      dataset_version: manifest.dataset_version,
      captured_at_through: manifest.data?.captured_at_through,
      item_name: data.item_name,
      records: data.records.length,
      sample: data.records.slice(0, 3).map((row) => ({
        price_meso: row.price_meso,
        price_eok: formatEok(row.price_meso),
        sold_at: row.sold_at,
        starforce: row.item.starforce,
        potential: row.item.potential,
        additional_potential: row.item.additional_potential,
        quality: row.quality,
      })),
    }, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
