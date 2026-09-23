import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  ITEM_MARKET_CATALOG_SCHEMA,
  ITEM_MARKET_ITEM_SCHEMA,
  ITEM_MARKET_MANIFEST_SCHEMA,
  loadItemMarketCatalog,
  loadItemMarketComparables,
  loadItemMarketManifest,
  itemMarketIconUrl,
} from "../src/shared/item-market-data.js";

const ORIGIN = "https://starforce.pages.dev";
const MANIFEST_URL = `${ORIGIN}/item-market/manifest.json`;
const DATASET_VERSION = "0123456789abcdefabcd";
const CATALOG_PATH = `releases/${DATASET_VERSION}/catalog.json`;
const CATALOG_URL = `${ORIGIN}/item-market/${CATALOG_PATH}`;
const ITEM_PATH = "items/0123456789abcdef.json";
const ITEM_URL = `${ORIGIN}/item-market/releases/${DATASET_VERSION}/${ITEM_PATH}`;

function jsonText(value) {
  return `${JSON.stringify(value)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function makeFixture(options = {}) {
  const item = {
    schema_version: ITEM_MARKET_ITEM_SCHEMA,
    dataset_version: DATASET_VERSION,
    item_name: "거대한 공포",
    summary: { records: 1 },
    records: [{ price_meso: "7500000000", sold_at: "2026-09-02" }],
  };
  options.mutateItem?.(item);
  const itemText = jsonText(item);

  const catalog = {
    schema_version: ITEM_MARKET_CATALOG_SCHEMA,
    dataset_version: DATASET_VERSION,
    generated_at: "2026-09-02T12:00:00.000Z",
    items: [{
      name: "거대한 공포",
      catalog_id: "black:거대한 공포",
      icon_asset_key: "KEODIEOH",
      file: ITEM_PATH,
      sha256: sha256(itemText),
      records: 1,
    }],
  };
  options.mutateCatalog?.(catalog);
  const catalogText = jsonText(catalog);

  const manifest = {
    schema_version: ITEM_MARKET_MANIFEST_SCHEMA,
    dataset_version: DATASET_VERSION,
    generated_at: "2026-09-02T12:00:00.000Z",
    catalog: {
      file: CATALOG_PATH,
      sha256: sha256(catalogText),
    },
  };
  options.mutateManifest?.(manifest);

  return {
    manifest,
    manifestText: jsonText(manifest),
    catalog,
    catalogText,
    item,
    itemText,
  };
}

test("장비별 검증 정책을 해시 검증한 시세 자료에 연결한다", async () => {
  const fixture = makeFixture({ mutateManifest: (manifest) => {
    manifest.model = { estimator_policy: { defaults: { halfLifeDays: 7, periodDays: 7, ridge: 2 },
      items: { "거대한 공포": { options: { halfLifeDays: 3, periodDays: 7, ridge: 2 } } } } };
  } });
  const loaded = await loadItemMarketComparables("거대한 공포", { fetcher: fixtureFetcher(fixture), manifestUrl: MANIFEST_URL });
  assert.deepEqual(loaded.data.model_options, { halfLifeDays: 3, periodDays: 7, ridge: 2 });
});

test("허용 범위를 벗어난 시세 모델 정책을 거부한다", async () => {
  const fixture = makeFixture({ mutateManifest: (manifest) => {
    manifest.model = { estimator_policy: { defaults: { halfLifeDays: -7, periodDays: 7, ridge: 2 } } };
  } });
  await assert.rejects(loadItemMarketComparables("거대한 공포", { fetcher: fixtureFetcher(fixture), manifestUrl: MANIFEST_URL }), /정책 값/u);
});

test("공용 장비 아이콘 키만 Nexon 이미지 URL로 변환한다", () => {
  assert.equal(
    itemMarketIconUrl({ icon_asset_key: "KEODIEOH" }),
    "https://avatar.maplestory.nexon.com/ItemIcon/KEODIEOH.png",
  );
  for (const icon_asset_key of ["", null, "../../account", "ABC.png", "abc123", "A".repeat(33)]) {
    assert.equal(itemMarketIconUrl({ icon_asset_key }), null);
  }
});

test("catalog의 조작된 장비 아이콘 키를 거부한다", async () => {
  const fixture = makeFixture({
    mutateCatalog: (catalog) => { catalog.items[0].icon_asset_key = "https://tracker.invalid/pixel"; },
  });
  await assert.rejects(
    loadItemMarketCatalog({ fetcher: fixtureFetcher(fixture), manifestUrl: MANIFEST_URL }),
    /장비 아이콘 키 형식/u,
  );
});

function response(body, url, status = 200) {
  const bytes = Buffer.from(body, "utf8");
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

function fixtureFetcher(fixture, overrides = {}) {
  const calls = [];
  const bodies = new Map([
    [MANIFEST_URL, fixture.manifestText],
    [CATALOG_URL, fixture.catalogText],
    [ITEM_URL, fixture.itemText],
  ]);
  const fetcher = async (url, init = {}) => {
    const absolute = new URL(url, ORIGIN).toString();
    calls.push({ url: absolute, init });
    const configured = overrides[absolute];
    const body = configured?.body ?? bodies.get(absolute);
    if (body == null) return response("not found", absolute, 404);
    return response(body, configured?.url ?? absolute, configured?.status ?? 200);
  };
  fetcher.calls = calls;
  return fetcher;
}

test("manifest → catalog → item을 해시 검증하고 불변 파일은 캐시한다", async () => {
  const fixture = makeFixture();
  const fetcher = fixtureFetcher(fixture);
  const loaded = await loadItemMarketComparables("  거대한   공포 ", {
    fetcher,
    manifestUrl: MANIFEST_URL,
  });

  assert.equal(loaded.data.item_name, "거대한 공포");
  assert.equal(loaded.data.records[0].price_meso, "7500000000");
  assert.deepEqual(fetcher.calls.map(({ url, init }) => [url, init.cache]), [
    [MANIFEST_URL, "no-cache"],
    [CATALOG_URL, "force-cache"],
    [ITEM_URL, "force-cache"],
  ]);
});

test("없는 장비는 catalog까지만 검증하고 item shard를 요청하지 않는다", async () => {
  const fixture = makeFixture();
  const fetcher = fixtureFetcher(fixture);
  const loaded = await loadItemMarketComparables("없는 장비", {
    fetcher,
    manifestUrl: MANIFEST_URL,
  });

  assert.equal(loaded.entry, null);
  assert.equal(loaded.data, null);
  assert.equal(fetcher.calls.length, 2);
});

test("manifest, catalog, item 스키마 불일치를 각각 거부한다", async (t) => {
  await t.test("manifest", async () => {
    const fixture = makeFixture({
      mutateManifest: (manifest) => { manifest.schema_version = "wrong.manifest"; },
    });
    await assert.rejects(
      loadItemMarketManifest({ fetcher: fixtureFetcher(fixture), manifestUrl: MANIFEST_URL }),
      /지원하지 않는 시세 데이터 형식/u,
    );
  });

  await t.test("catalog", async () => {
    const fixture = makeFixture({
      mutateCatalog: (catalog) => { catalog.schema_version = "wrong.catalog"; },
    });
    await assert.rejects(
      loadItemMarketCatalog({ fetcher: fixtureFetcher(fixture), manifestUrl: MANIFEST_URL }),
      /지원하지 않는 시세 데이터 형식/u,
    );
  });

  await t.test("item", async () => {
    const fixture = makeFixture({
      mutateItem: (item) => { item.schema_version = "wrong.item"; },
    });
    await assert.rejects(
      loadItemMarketComparables("거대한 공포", {
        fetcher: fixtureFetcher(fixture),
        manifestUrl: MANIFEST_URL,
      }),
      /지원하지 않는 시세 데이터 형식/u,
    );
  });
});

test("catalog와 item의 데이터 버전 불일치를 각각 거부한다", async (t) => {
  await t.test("catalog version", async () => {
    const fixture = makeFixture({
      mutateCatalog: (catalog) => { catalog.dataset_version = "different-catalog"; },
    });
    await assert.rejects(
      loadItemMarketCatalog({ fetcher: fixtureFetcher(fixture), manifestUrl: MANIFEST_URL }),
      /manifest와 catalog 버전/u,
    );
  });

  await t.test("item version", async () => {
    const fixture = makeFixture({
      mutateItem: (item) => { item.dataset_version = "different-item"; },
    });
    await assert.rejects(
      loadItemMarketComparables("거대한 공포", {
        fetcher: fixtureFetcher(fixture),
        manifestUrl: MANIFEST_URL,
      }),
      /item shard와 catalog/u,
    );
  });
});

test("catalog와 item 본문이 바뀌면 SHA-256 불일치로 거부한다", async (t) => {
  await t.test("catalog hash", async () => {
    const fixture = makeFixture();
    const fetcher = fixtureFetcher(fixture, {
      [CATALOG_URL]: { body: `${fixture.catalogText} ` },
    });
    await assert.rejects(
      loadItemMarketCatalog({ fetcher, manifestUrl: MANIFEST_URL }),
      /catalog SHA-256이 manifest와 다릅니다/u,
    );
  });

  await t.test("item hash", async () => {
    const fixture = makeFixture();
    const fetcher = fixtureFetcher(fixture, {
      [ITEM_URL]: { body: `${fixture.itemText} ` },
    });
    await assert.rejects(
      loadItemMarketComparables("거대한 공포", { fetcher, manifestUrl: MANIFEST_URL }),
      /item shard SHA-256이 manifest와 다릅니다/u,
    );
  });
});

test("외부·상위 경로와 다른 URL로 끝난 응답을 거부한다", async (t) => {
  await t.test("external catalog URL", async () => {
    const fixture = makeFixture({
      mutateManifest: (manifest) => {
        manifest.catalog.file = "https://example.com/catalog.json";
      },
    });
    await assert.rejects(
      loadItemMarketCatalog({ fetcher: fixtureFetcher(fixture), manifestUrl: MANIFEST_URL }),
      /안전한 상대 경로/u,
    );
  });

  await t.test("parent item path", async () => {
    const fixture = makeFixture({
      mutateCatalog: (catalog) => { catalog.items[0].file = "../escaped.json"; },
    });
    await assert.rejects(
      loadItemMarketCatalog({ fetcher: fixtureFetcher(fixture), manifestUrl: MANIFEST_URL }),
      /안전한 상대 경로/u,
    );
  });

  await t.test("redirected response URL", async () => {
    const fixture = makeFixture();
    const fetcher = fixtureFetcher(fixture, {
      [CATALOG_URL]: { url: "https://example.com/catalog.json" },
    });
    await assert.rejects(
      loadItemMarketCatalog({ fetcher, manifestUrl: MANIFEST_URL }),
      /요청 URL과 실제 응답 URL/u,
    );
  });
});

test("WebCrypto가 없는 Node 환경에서도 SHA-256을 검증한다", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const fixture = makeFixture();
  const fetcher = fixtureFetcher(fixture);

  try {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: undefined,
    });
    const loaded = await loadItemMarketComparables("거대한 공포", {
      fetcher,
      manifestUrl: MANIFEST_URL,
    });
    assert.equal(loaded.data.item_name, "거대한 공포");
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    else delete globalThis.crypto;
  }
});
