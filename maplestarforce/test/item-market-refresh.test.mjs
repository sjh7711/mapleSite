import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { refreshItemMarketData, writeTrainingArtifact } from "../scripts/refresh-item-market-data.mjs";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(TEST_DIR, "..");
const EXTENSION_ROOT = path.resolve(
  PROJECT_ROOT,
  "../chrome extension/maple-auction-diagnostic",
);
const catalog = await import(
  pathToFileURL(path.join(EXTENSION_ROOT, "tools/catalog.mjs")).href
);
const collector = await import(
  pathToFileURL(path.join(EXTENSION_ROOT, "tools/collector-core.mjs")).href
);
const training = await import(pathToFileURL(path.join(EXTENSION_ROOT, "tools/training-lib.mjs")).href);

const queries = catalog.expandCatalogQueries();
const EXACT_ZERO_QUERY = queries.find(
  (query) =>
    (query.catalog_id || query.catalog_ids?.length) &&
    query.starforce_min === 0 &&
    query.starforce_max === 0 &&
    query.potential_filter == null,
);
assert.ok(EXACT_ZERO_QUERY, "현행 카탈로그에 정확히 0성 검색이 필요합니다.");

const BASELINE_QUERY = queries.find(
  (query) =>
    (query.catalog_id === EXACT_ZERO_QUERY.catalog_id ||
      query.catalog_ids?.some((id) => EXACT_ZERO_QUERY.catalog_ids?.includes(id))) &&
    query.price_min_meso === 50_000_000 &&
    query.price_max_meso == null &&
    query.starforce_min == null &&
    query.starforce_max == null &&
    query.potential_filter == null &&
    query.page_sweep?.enabled === true,
);
assert.ok(BASELINE_QUERY, "현행 카탈로그에 5천만 메소 하한 기본 검색이 필요합니다.");

const SINGLE_PAGE_QUERY = queries.find(
  (query) => query.catalog_id && query.page_sweep == null,
);
assert.ok(SINGLE_PAGE_QUERY, "현행 카탈로그에 단일 페이지 정책 검색이 필요합니다.");

const NON_POTENTIAL_QUERY = queries.find(
  (query) => query.catalog_id === "black:창세의 뱃지" && query.potential_filter == null,
);
assert.ok(NON_POTENTIAL_QUERY, "잠재 미적용 장비의 최근 시세 검색이 필요합니다.");

const GLOBAL_ACCESSORY_DROP_QUERY = queries.find(
  (query) => query.search_scope === "catalog_global" &&
    query.potential_filter?.capability_id === "ITEM_DROP_RATE_PCT",
);
assert.ok(GLOBAL_ACCESSORY_DROP_QUERY, "전체 장신구 드롭 잠재 검색이 필요합니다.");

const GLOBAL_ACCESSORY_STR_27_29_QUERY = queries.find(
  (query) => query.group === "global_category_potential" &&
    query.equipment_subcategory_filter === "장신구" &&
    query.potential_filter?.capability_id === "STR_PCT" &&
    query.potential_filter.minimum === 27 &&
    query.potential_filter.maximum === 29,
);
assert.ok(GLOBAL_ACCESSORY_STR_27_29_QUERY, "전체 장신구 STR 27~29% 검색이 필요합니다.");

const GLOBAL_ARMOR_ALL_STAT_QUERY = queries.find(
  (query) => query.group === "global_category_potential" &&
    query.equipment_subcategory_filter === "방어구" &&
    query.potential_filter?.capability_id === "ALL_STAT_PCT" &&
    query.potential_filter.minimum === 21,
);
assert.ok(GLOBAL_ARMOR_ALL_STAT_QUERY, "전체 방어구 올스탯 21% 이상 검색이 필요합니다.");

const GLOBAL_ACCESSORY_ALL_STAT_QUERY = queries.find(
  (query) => query.group === "global_category_potential" &&
    query.equipment_subcategory_filter === "장신구" &&
    query.potential_filter?.capability_id === "ALL_STAT_PCT" &&
    query.potential_filter.minimum === 21,
);
assert.ok(GLOBAL_ACCESSORY_ALL_STAT_QUERY, "전체 장신구 올스탯 21% 이상 검색이 필요합니다.");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hashId(value) {
  return `sha256:${sha256(value)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function laneForQuery(query) {
  if (query.starforce_min != null || query.starforce_max != null) return "starforce";
  if (query.search_scope === "catalog_global" &&
      query.post_classify_profiles?.includes("ACCESSORY_DROP_MESO")) return "accessory";
  if (query.potential_filter?.capability_id === "ALL_STAT_PCT") return "allstat";
  if (query.potential_filter) return "main";
  return "baseline";
}

function publicQueryTask(query, lane = laneForQuery(query)) {
  return {
    task_id: `${query.query_id}#${lane}`,
    query_id: query.query_id,
    catalog_id: query.catalog_id ?? null,
    catalog_ids: [...query.catalog_ids],
    allowed_names: [...query.allowed_names],
    keyword: query.search_keyword ?? query.exact_name ?? "",
    display_name: query.display_name || query.search_keyword || query.exact_name,
    search_scope: query.search_scope || null,
    progress_scope: query.progress_scope || null,
    exact_match: query.exact_match !== false,
    lane,
    priority: query.priority,
    starforce_min: query.starforce_min ?? null,
    starforce_max: query.starforce_max ?? null,
    price_min_meso: query.price_min_meso ?? null,
    price_max_meso: query.price_max_meso ?? null,
    item_category_filter: query.item_category_filter ?? null,
    equipment_subcategory_filter: query.equipment_subcategory_filter ?? null,
    result_category_path_filter: query.result_category_path_filter ?? null,
    potential_filter: query.potential_filter ? clone(query.potential_filter) : null,
    logical_lanes: [...query.logical_lanes],
    selection_channels: [...query.selection_channels],
    post_classify_profiles: [...query.post_classify_profiles],
    page_sweep: query.page_sweep ? clone(query.page_sweep) : null,
  };
}

function captureCatalog(query) {
  const keyword = query.search_keyword ?? query.exact_name ?? "";
  return {
    version: catalog.CATALOG_VERSION,
    catalog_id: query.catalog_id ?? null,
    catalog_ids: [...query.catalog_ids],
    exact_name: query.exact_match === false ? null : keyword,
    search_keyword: keyword,
    allowed_names: [...query.allowed_names],
    base_level: query.level ?? null,
    slot: query.slot ?? null,
  };
}

function emptyPotential() {
  return {
    collected: true,
    grade: "none",
    grade_raw: "없음",
    grade_source: "api_tooltip",
    lines: [],
    raw_heading: "잠재능력 : 없음",
  };
}

function apiPotentialLine({
  lineIndex,
  code,
  value,
  unit,
  params = {},
  raw,
  apiGrade,
  tier,
  isPrime,
}) {
  return {
    line_index: lineIndex,
    code,
    value,
    unit,
    params,
    raw,
    tier,
    is_prime: isPrime,
    evidence: { api_line_grade: apiGrade },
  };
}

function legendaryPotential(lines) {
  return {
    collected: true,
    grade: "legendary",
    grade_raw: "레전드리",
    grade_source: "api_tooltip",
    lines,
    raw_heading: "잠재능력 : 레전드리",
  };
}

function capturedItem({
  query,
  catalogItem,
  batchId,
  rowIndex,
  listingKey,
  priceMeso,
  soldAt,
  starforce,
}) {
  const listingId = hashId(`listing:${listingKey}`);
  return {
    observation_id: `${batchId}:${rowIndex}`,
    row_index: rowIndex,
    result_rank: rowIndex,
    catalog_id: catalogItem.id,
    matched_preset_ids: [`${catalogItem.id}:BASE_ANY`],
    selection_channels: query.group === "global_category_potential"
      ? [...query.selection_channels]
      : [laneForQuery(query)],
    listing: {
      listing_id: listingId,
      listing_id_source: "native",
      listing_id_collision_risk: false,
      listing_fingerprint: hashId(`fingerprint:${listingKey}`),
      listing_fingerprint_collision_risk: true,
      status: "sold",
      price_meso: String(priceMeso),
      quantity: 1,
      sold_at: soldAt,
      sold_at_precision: "datetime",
      expires_at: "2026-09-05T00:00:00.000Z",
      listing_world: null,
      is_cross_world: false,
    },
    item: {
      item_id: hashId(`item:${catalogItem.id}`),
      item_id_source: "native",
      catalog_key: hashId(`catalog:${catalogItem.name}`),
      catalog_id: catalogItem.id,
      name: catalogItem.name,
      icon_asset_key: "KEODIEOH",
      category: catalogItem.slot_label,
      category_path: ["장비", catalogItem.slot_label],
      base_level: catalogItem.level,
      required_level: catalogItem.level,
      required_level_reduction: 0,
      required_job: null,
      set_name: null,
      starforce: {
        value: starforce,
        applicable: catalogItem.starforce_eligible,
        source: catalogItem.starforce_eligible ? "api_response" : "catalog",
        confidence: "confirmed",
      },
      upgrade: {
        collected: true,
        applied: 0,
        remaining: 0,
        recoverable: 0,
        failure: 0,
        max: 0,
        scroll_type: null,
        raw: null,
      },
      trade: {
        collected: true,
        state: "tradable",
        scissors_remaining: 10,
        scissors_total: 10,
        raw: null,
      },
      stats: {
        collected: true,
        normalized: false,
        base: { str_flat: 10 },
        starforce: {},
        scroll: {},
        flame: {},
        other: {},
        total: { str_flat: 10 },
        lines: [
          {
            key: "str_flat",
            code: "str",
            label: "STR",
            unit: "flat",
            total: 10,
            breakdown: [{ value: 10, unit: "flat", source_hint: "base" }],
            component_sum_matches_total: true,
            raw: "STR +10",
          },
        ],
      },
      potential: emptyPotential(),
      additional_potential: emptyPotential(),
    },
    raw_evidence: {
      api_tooltip: {
        item_name: catalogItem.name,
        status: "SOLD",
      },
    },
    quality_warnings: [],
  };
}

function rawFiltersFor(query) {
  const filters = {
    searchTab: "condition",
    isExactMatch: String(query.exact_match !== false),
    itemCategory: "ARMOR",
    "enhancementOption::starforceMin": String(query.starforce_min ?? 0),
  };
  if (query.starforce_max != null) {
    filters["enhancementOption::starforceMax"] = String(query.starforce_max);
  }
  if (query.price_min_meso != null) {
    filters["price::min"] = String(query.price_min_meso);
  }
  if (query.price_max_meso != null) {
    filters["price::max"] = String(query.price_max_meso);
  }
  if (query.potential_filter) {
    filters["enhancementOption::potentialFilters::optionRows"] =
      `${query.potential_filter.auction_code}\u001f${query.potential_filter.minimum}`;
  }
  if (query.equipment_subcategory_filter) {
    filters["form::equipmentSubcategory"] = query.equipment_subcategory_filter;
  }
  return filters;
}

function signCapture(document) {
  const unsigned = clone(document);
  delete unsigned.integrity;
  return {
    ...unsigned,
    integrity: {
      algorithm: "SHA-256",
      payload_sha256: sha256(JSON.stringify(unsigned)),
    },
  };
}

function buildCapture({
  query = BASELINE_QUERY,
  sweepId = "sweep-1",
  attemptId = `attempt-${sweepId}`,
  page = 1,
  hasNextPage = false,
  totalResults = 1,
  totalPages = 1,
  itemCount = 1,
  pageRows = itemCount,
  sourceRows = pageRows,
  listingPrefix = `${sweepId}-p${page}`,
  listingKeys = null,
  priceMeso = Math.max(query.price_min_meso || 0, 75_000_000),
  soldAt = "2026-09-02T01:00:00.000Z",
  capturedAt = "2026-09-02T01:01:00.000Z",
  starforce,
  extensionVersion = "0.7.7",
  siteUsage = 7,
  collectionMode = "catalog_sweep",
  collectionTransport = "tooltip_api",
  retryCount = 0,
  resumeRestartReason = null,
  pageLimit = 60,
  catalogItemOverride = null,
} = {}) {
  const batchId = `batch-${sweepId}-p${page}`;
  const catalogItem = catalogItemOverride || catalog.getCatalogItem(query.catalog_id ?? query.catalog_ids[0]);
  assert.ok(catalogItem, `테스트 검색 ${query.query_id}의 카탈로그 장비가 필요합니다.`);
  const resolvedStarforce = starforce === undefined
    ? (catalogItem.starforce_eligible ? query.starforce_min ?? 0 : null)
    : starforce;
  const keys = listingKeys || Array.from(
    { length: pageRows },
    (_, index) => `${listingPrefix}-${index + 1}`,
  );
  assert.equal(keys.length, pageRows);
  const items = keys.map((listingKey, index) => capturedItem({
    query,
    catalogItem,
    batchId,
    rowIndex: index + 1,
    listingKey,
    priceMeso: priceMeso + index,
    soldAt,
    starforce: resolvedStarforce,
  }));
  const boundaries = items.map((item) => `native:${item.listing.listing_id}`);
  const rawFilters = rawFiltersFor(query);
  const potentialFilters = query.potential_filter
    ? [{
        code: query.potential_filter.auction_code,
        minimum: query.potential_filter.minimum,
      }]
    : [];
  const document = {
    schema_version: "maple-auction.capture.v2",
    capture: {
      batch_id: batchId,
      captured_at: capturedAt,
      extension_version: extensionVersion,
      source_site: "https://auction.maplestory.nexon.com",
      source_path: "/price",
      viewer_world: null,
      auction_group: null,
      collection_mode: collectionMode,
      collection_transport: collectionTransport,
      catalog: captureCatalog(query),
      query_task: publicQueryTask(query),
      filter_audit: query.potential_filter
        ? {
            capability_id: query.potential_filter.capability_id,
            auction_code: query.potential_filter.auction_code,
            minimum: query.potential_filter.minimum,
            maximum: query.potential_filter.maximum ?? null,
            evidence_status_before: query.potential_filter.evidence_status,
            passed_count: pageRows,
            failed_count: 0,
            status: pageRows ? "observed_compatible" : "inconclusive_empty",
          }
        : null,
      attempt: {
        attempt_id: attemptId,
        reservation_lane: laneForQuery(query),
        quota_purpose: "normal",
        quota_session_id: "quota:test",
        sweep_id: sweepId,
        page,
        retry_count: retryCount,
        resume_restart_reason: resumeRestartReason,
      },
      daily_quota: {
        day_key: "2026-09-02",
        hard_limit: 100,
      },
      preset: publicQueryTask(query),
      preset_index: null,
      preset_count: null,
      search_context: {
        page_kind: "sold",
        keyword: query.search_keyword ?? query.exact_name ?? "",
        sort: "trade_date_desc",
        page,
        limit: pageLimit,
        only_current_world: false,
        price_search_key_present: true,
        filter_search_applied: true,
          filters: {
            search_tab: "condition",
            exact_match: query.exact_match !== false,
            item_category: "ARMOR",
            equipment_subcategory: query.equipment_subcategory_filter ?? null,
          enhancement: {
            starforce_min: query.starforce_min ?? 0,
            starforce_max: query.starforce_max ?? null,
            potential: potentialFilters,
          },
          price: {
            minimum_meso: query.price_min_meso ?? null,
            maximum_meso: query.price_max_meso ?? null,
          },
          other: {},
        },
        raw_filters: rawFilters,
      },
      result_summary: {
        total_results: totalResults,
        total_pages: totalPages,
        current_page: page,
        has_next_page: hasNextPage,
        page_item_count: sourceRows,
        requested_page_limit: pageLimit,
        displayed_page_limit: sourceRows > 0 ? pageLimit : null,
        site_search_usage: { used: siteUsage, limit: 100 },
        page_signature: collector.createPageSignature(items),
        boundary_keys: boundaries,
      },
      collection_summary: {
        source_page_rows: sourceRows,
        page_rows: pageRows,
        exact_name_rows: pageRows,
        allowed_name_rows: pageRows,
        excluded_name_mismatches: 0,
        collected_items: pageRows,
        locally_excluded_category_rows: 0,
        locally_excluded_range_rows: 0,
        failed_items: 0,
        failures: [],
      },
      quality_warnings: [
        "items_collected_from_structured_tooltip_response",
        ...(sourceRows > pageRows ? [`result_cap_rows_excluded:${sourceRows - pageRows}`] : []),
      ],
    },
    items,
  };
  return signCapture(document);
}

function globalStatPotential({ str = 0, allStat = 0 } = {}) {
  const lines = [];
  let lineIndex = 1;
  if (str > 0) {
    lines.push(apiPotentialLine({
      lineIndex: lineIndex++, code: "STR", value: str, unit: "pct", raw: `STR +${str}%`,
      apiGrade: 4, tier: "legendary", isPrime: true,
    }));
  }
  if (allStat > 0) {
    lines.push(apiPotentialLine({
      lineIndex: lineIndex++, code: "ALL_STAT", value: allStat, unit: "pct", raw: `올스탯 +${allStat}%`,
      apiGrade: 4, tier: "legendary", isPrime: true,
    }));
  }
  return legendaryPotential(lines);
}

function setObservedGlobalItem(capture, {
  name,
  category,
  categoryPath,
  slotLabel,
  requiredLevel,
  potential,
} = {}) {
  const item = capture.items[0];
  item.catalog_id = null;
  item.item.catalog_id = null;
  item.item.name = name;
  item.item.category = slotLabel;
  item.item.category_path = categoryPath || [category, slotLabel];
  item.item.base_level = null;
  item.item.required_level = requiredLevel;
  item.item.required_level_reduction = 0;
  item.item.potential = potential;
  item.item.item_id = hashId(`item:${name}`);
  item.item.catalog_key = hashId(`catalog:${name}`);
  item.raw_evidence.api_tooltip.item_name = name;
  return capture;
}

async function createSandbox(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "item-market-refresh-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const paths = {
    root,
    rawRoot: path.join(root, "raw"),
    privateRoot: path.join(root, "private"),
    publicRoot: path.join(root, "public"),
  };
  await mkdir(paths.rawRoot, { recursive: true });
  return paths;
}

async function writeCapture(rawRoot, filename, document) {
  const filePath = path.join(rawRoot, filename);
  await writeFile(filePath, `${JSON.stringify(document)}\n`, "utf8");
  return filePath;
}

function refresh(paths, options = {}) {
  return refreshItemMarketData({
    rawRoot: paths.rawRoot,
    privateRoot: paths.privateRoot,
    publicRoot: paths.publicRoot,
    extensionRoot: EXTENSION_ROOT,
    ...options,
  });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readPublishedItem(paths) {
  const manifest = await readJson(path.join(paths.publicRoot, "manifest.json"));
  const catalogPath = path.join(paths.publicRoot, manifest.catalog.file);
  const publishedCatalog = await readJson(catalogPath);
  assert.equal(publishedCatalog.items.length, 1);
  const entry = publishedCatalog.items[0];
  const item = await readJson(path.join(path.dirname(catalogPath), entry.file));
  return { manifest, catalog: publishedCatalog, entry, item };
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function snapshotTree(root) {
  const snapshot = {};
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile()) {
        const [contents, metadata] = await Promise.all([readFile(fullPath), stat(fullPath)]);
        snapshot[path.relative(root, fullPath)] = {
          sha256: sha256(contents),
          size: metadata.size,
          mtimeMs: metadata.mtimeMs,
        };
      }
    }
  }
  await visit(root);
  return snapshot;
}

test("분할 저장한 JSONL·CSV는 기존 직렬화 및 SHA-256 결과와 동일하다", async (t) => {
  const paths = await createSandbox(t);
  const rows = Array.from({ length: 700 }, (_, index) => ({
    price_meso: index, item_name: '한글,"장비"\n이름',
    ...(index % 2 ? { later_column: null } : { first_column: '값' })
  }));
  for (const format of ["jsonl", "csv"]) {
    const file = path.join(paths.privateRoot, `stream.${format}`);
    const result = await writeTrainingArtifact(file, rows, format);
    const expected = format === "csv" ? training.toCsv(rows) : rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
    assert.equal(await readFile(file, "utf8"), expected);
    assert.deepEqual(result, { sha256: sha256(expected), bytes: Buffer.byteLength(expected) });
    const empty = await writeTrainingArtifact(file, [], format);
    assert.equal(await readFile(file, "utf8"), "");
    assert.equal(empty.bytes, 0);
  }
});

test("0.7.7 자연 종료 캡처를 공개·비공개 비교매물로 적용하고 가격 하한을 보존한다", async (t) => {
  const paths = await createSandbox(t);
  await writeCapture(paths.rawRoot, "natural.jsonl", buildCapture({ sweepId: "natural" }));

  const result = await refresh(paths);
  assert.equal(result.applied, true);
  assert.equal(result.completed_chains, 1);
  assert.equal(result.unique_sales, 1);

  const published = await readPublishedItem(paths);
  assert.equal(published.manifest.dataset_version, result.dataset_version);
  assert.equal(published.manifest.model.status, "component_estimator_beta");
  assert.equal(published.manifest.model.promoted, false);
  assert.equal(published.item.records.length, 1);
  assert.equal(published.item.records[0].sampling_frames[0].price_min_meso, 50_000_000);
  assert.equal(published.entry.coverage.price_floor_meso[0], 50_000_000);
  assert.equal(published.entry.icon_asset_key, "KEODIEOH");
  assert.equal(Object.hasOwn(published.item.records[0].item, "icon_asset_key"), false);

  const privateRelease = path.join(paths.privateRoot, "releases", result.dataset_version);
  assert.equal(await exists(path.join(privateRelease, "auction-sold.jsonl")), true);
  assert.equal(await exists(path.join(privateRelease, "auction-sold.csv")), true);
  assert.equal(await exists(path.join(privateRelease, "state.json")), true);
  const current = await readJson(path.join(paths.privateRoot, "current.json"));
  assert.equal(current.dataset_version, result.dataset_version);
});

test("정확히 0성 검색은 sampling provenance에서 제한 없음과 구분한다", async (t) => {
  const paths = await createSandbox(t);
  await writeCapture(paths.rawRoot, "zero.jsonl", buildCapture({
    query: EXACT_ZERO_QUERY,
    sweepId: "zero",
    starforce: 0,
  }));

  const result = await refresh(paths);
  assert.equal(result.applied, true);
  const { item } = await readPublishedItem(paths);
  const [frame] = item.records[0].sampling_frames;
  assert.equal(frame.starforce_min, 0);
  assert.equal(frame.starforce_max, 0);
  assert.equal(item.records[0].item.starforce.value, 0);
});

test("API 잠재 원문과 구조화 코드가 일치할 때만 신규 raw를 적용한다", async (t) => {
  const validPaths = await createSandbox(t);
  const valid = buildCapture({ sweepId: "valid-potential" });
  valid.items[0].item.potential = legendaryPotential([
    apiPotentialLine({
      lineIndex: 1,
      code: "STR",
      value: 12,
      unit: "pct",
      raw: "STR +12%",
      apiGrade: 4,
      tier: "legendary",
      isPrime: true,
    }),
    apiPotentialLine({
      lineIndex: 2,
      code: "STAT_PER_CHARACTER_LEVEL",
      value: null,
      unit: null,
      params: { levels_per_increment: 9, stat_code: "STR", stat_value: 2 },
      raw: "캐릭터 기준 9레벨 당 STR +2",
      apiGrade: 3,
      tier: "unique",
      isPrime: false,
    }),
    apiPotentialLine({
      lineIndex: 3,
      code: "HP_RECOVERY_ON_ATTACK",
      value: 95,
      unit: "flat",
      params: { trigger_chance_pct: 15 },
      raw: "공격 시 15% 확률로 HP 95 회복",
      apiGrade: 0,
      tier: null,
      isPrime: null,
    }),
  ]);
  await writeCapture(validPaths.rawRoot, "valid.jsonl", signCapture(valid));
  const applied = await refresh(validPaths);
  assert.equal(applied.applied, true);

  const corruptPaths = await createSandbox(t);
  const corrupt = clone(valid);
  corrupt.capture.batch_id = "batch-corrupt-potential";
  corrupt.capture.attempt.sweep_id = "corrupt-potential";
  corrupt.capture.attempt.attempt_id = "attempt-corrupt-potential";
  corrupt.items[0].observation_id = "batch-corrupt-potential:1";
  corrupt.items[0].item.potential.lines[0].code = "DEX";
  await writeCapture(corruptPaths.rawRoot, "corrupt.jsonl", signCapture(corrupt));
  await assert.rejects(
    refresh(corruptPaths, { mode: "check" }),
    /원문과 구조화 값이 일치하지 않습니다/,
  );
});

test("API가 확정한 잠재 전체 등급보다 낮은 하위 등급 줄은 허용하되 상위 등급 줄은 거부한다", async (t) => {
  const lowerPaths = await createSandbox(t);
  const lower = buildCapture({ sweepId: "lower-potential-tier" });
  lower.items[0].item.potential = {
    collected: true,
    grade: "unique",
    grade_raw: "유니크",
    grade_source: "api_tooltip",
    lines: [
      apiPotentialLine({
        lineIndex: 1, code: "LUK", value: 9, unit: "pct", raw: "LUK +9%",
        apiGrade: 3, tier: "unique", isPrime: true,
      }),
      apiPotentialLine({
        lineIndex: 2, code: "DEFENSE", value: 3, unit: "pct", raw: "방어력 +3%",
        apiGrade: 1, tier: "rare", isPrime: false,
      }),
      apiPotentialLine({
        lineIndex: 3, code: "STR", value: 6, unit: "pct", raw: "STR +6%",
        apiGrade: 2, tier: "epic", isPrime: false,
      }),
    ],
    raw_heading: "잠재능력 : 유니크",
  };
  await writeCapture(lowerPaths.rawRoot, "lower.jsonl", signCapture(lower));
  assert.equal((await refresh(lowerPaths)).applied, true);

  const higherPaths = await createSandbox(t);
  const higher = clone(lower);
  higher.capture.batch_id = "batch-higher-potential-tier";
  higher.capture.attempt.sweep_id = "higher-potential-tier";
  higher.capture.attempt.attempt_id = "attempt-higher-potential-tier";
  higher.items[0].observation_id = "batch-higher-potential-tier:1";
  higher.items[0].item.potential.lines[1] = apiPotentialLine({
    lineIndex: 2, code: "STR", value: 12, unit: "pct", raw: "STR +12%",
    apiGrade: 4, tier: "legendary", isPrime: false,
  });
  await writeCapture(higherPaths.rawRoot, "higher.jsonl", signCapture(higher));
  await assert.rejects(
    refresh(higherPaths, { mode: "check" }),
    /잠재 전체 등급 범위를 벗어납니다/,
  );
});

test("전체 장신구 드롭·메획 검색만 고정 카탈로그 밖 장신구를 엄격한 부위 계약으로 받는다", async (t) => {
  const paths = await createSandbox(t);
  const observedAccessory = {
    id: null,
    name: "하프 이어링",
    level: 75,
    slot_label: "귀고리",
    starforce_eligible: true,
  };
  const capture = buildCapture({
    query: GLOBAL_ACCESSORY_DROP_QUERY,
    sweepId: "global-accessory-drop",
    catalogItemOverride: observedAccessory,
  });
  capture.items[0].item.base_level = null;
  capture.items[0].item.category_path = ["장신구", "귀고리"];
  capture.items[0].item.stats = {
    collected: true,
    normalized: false,
    base: {}, starforce: {}, scroll: {}, flame: {}, other: {}, total: {}, lines: [],
  };
  capture.items[0].item.potential = legendaryPotential([
    apiPotentialLine({
      lineIndex: 1, code: "ITEM_DROP_RATE", value: 20, unit: "pct",
      raw: "아이템 드롭률 +20%", apiGrade: 4, tier: "legendary", isPrime: true,
    }),
    apiPotentialLine({
      lineIndex: 2, code: "LUK", value: 9, unit: "pct",
      raw: "LUK +9%", apiGrade: 3, tier: "unique", isPrime: false,
    }),
    apiPotentialLine({
      lineIndex: 3, code: "DEX", value: 9, unit: "pct",
      raw: "DEX +9%", apiGrade: 3, tier: "unique", isPrime: false,
    }),
  ]);
  await writeCapture(paths.rawRoot, "global-accessory.jsonl", signCapture(capture));

  const excluded = clone(capture);
  excluded.capture.batch_id = "batch-global-accessory-excluded-p1";
  excluded.capture.attempt.sweep_id = "global-accessory-excluded";
  excluded.capture.attempt.attempt_id = "attempt-global-accessory-excluded";
  excluded.items[0].observation_id = "batch-global-accessory-excluded-p1:1";
  excluded.items[0].listing.listing_id = hashId("listing:global-accessory-excluded");
  excluded.items[0].listing.listing_fingerprint = hashId("fingerprint:global-accessory-excluded");
  excluded.items[0].item.item_id = hashId("item:global-accessory-excluded");
  excluded.items[0].item.catalog_key = hashId("catalog:혼테일의 목걸이");
  excluded.items[0].item.name = "혼테일의 목걸이";
  excluded.items[0].item.category = "펜던트";
  excluded.items[0].item.category_path = ["장신구", "펜던트"];
  excluded.items[0].item.required_level = 120;
  excluded.items[0].raw_evidence.api_tooltip.item_name = "혼테일의 목걸이";
  excluded.capture.result_summary.boundary_keys = [
    `native:${excluded.items[0].listing.listing_id}`,
  ];
  excluded.capture.result_summary.page_signature = collector.createPageSignature(excluded.items);
  await writeCapture(paths.rawRoot, "global-accessory-excluded.jsonl", signCapture(excluded));

  const result = await refresh(paths);
  assert.equal(result.applied, true);
  assert.equal(result.eligible_new_format_files, 2);
  assert.equal(result.observations, 1);
  const { item } = await readPublishedItem(paths);
  assert.equal(item.item_name, "하프 이어링");
  assert.match(item.records[0].item.catalog_id, /^observed-accessory:/u);
  assert.equal(item.records[0].quality.stats_missing, true);
  const state = await readJson(path.join(paths.privateRoot, "current.json"));
  assert.equal(state.sources.length, 2);
  assert.equal(state.sources.filter((source) => source.observations === 0).length, 1);

  const unrelatedPaths = await createSandbox(t);
  const unrelated = buildCapture({
    sweepId: "unrelated-observed-accessory",
    catalogItemOverride: observedAccessory,
  });
  unrelated.items[0].item.category_path = ["장신구", "귀고리"];
  await writeCapture(unrelatedPaths.rawRoot, "unrelated.jsonl", signCapture(unrelated));
  await assert.rejects(
    refresh(unrelatedPaths, { mode: "check" }),
    /현재 카탈로그에 없는 장비입니다/,
  );
});

test("전체 장신구 주스탯 구간은 올스탯을 합산하고 로컬 분류 제외 산식을 보존한다", async (t) => {
  const paths = await createSandbox(t);
  const observedAccessory = {
    id: null,
    name: "테스트 전역 반지",
    level: 160,
    slot_label: "반지",
    starforce_eligible: true,
  };
  const capture = setObservedGlobalItem(buildCapture({
    query: GLOBAL_ACCESSORY_STR_27_29_QUERY,
    sweepId: "global-accessory-str-27-29",
    totalResults: 3,
    itemCount: 1,
    pageRows: 1,
    sourceRows: 1,
    catalogItemOverride: observedAccessory,
  }), {
    name: observedAccessory.name,
    category: "장신구",
    slotLabel: "반지",
    requiredLevel: 160,
    potential: globalStatPotential({ str: 18, allStat: 9 }),
  });
  Object.assign(capture.capture.result_summary, {
    total_results: 3,
    total_pages: 1,
    page_item_count: 3,
  });
  Object.assign(capture.capture.collection_summary, {
    source_page_rows: 3,
    page_rows: 3,
    exact_name_rows: 3,
    allowed_name_rows: 3,
    collected_items: 1,
    locally_excluded_category_rows: 1,
    locally_excluded_range_rows: 1,
  });
  Object.assign(capture.capture.filter_audit, {
    passed_count: 3,
    failed_count: 0,
    status: "observed_compatible",
  });
  capture.capture.quality_warnings.push(
    "global_potential_category_rows_excluded:1",
    "global_potential_range_rows_excluded:1",
  );
  await writeCapture(paths.rawRoot, "global-category-str.jsonl", signCapture(capture));

  const result = await refresh(paths);
  assert.equal(result.applied, true);
  assert.equal(result.observations, 1);
  const { item } = await readPublishedItem(paths);
  assert.match(item.records[0].item.catalog_id, /^observed-category:/u);
  assert.equal(
    item.records[0].classification.selection_channels.includes(
      GLOBAL_ACCESSORY_STR_27_29_QUERY.selection_channels[0],
    ),
    true,
  );
  const [frame] = item.records[0].sampling_frames;
  assert.equal(frame.item_category_filter, "ARMOR");
  assert.equal(frame.equipment_subcategory_filter, "장신구");
  assert.equal(frame.result_category_path_filter, "장신구");
  assert.equal(frame.potential_filter.minimum, 27);
  assert.equal(frame.potential_filter.maximum, 29);
});

test("전체 방어구 올스탯 검색은 allstat lane과 비카탈로그 방어구를 허용한다", async (t) => {
  const paths = await createSandbox(t);
  const observedArmor = {
    id: null,
    name: "테스트 전역 망토",
    level: 200,
    slot_label: "망토",
    starforce_eligible: true,
  };
  const capture = setObservedGlobalItem(buildCapture({
    query: GLOBAL_ARMOR_ALL_STAT_QUERY,
    sweepId: "global-armor-all-stat",
    catalogItemOverride: observedArmor,
  }), {
    name: observedArmor.name,
    category: "방어구",
    categoryPath: ["장비", "방어구", "망토"],
    slotLabel: "망토",
    requiredLevel: 200,
    potential: globalStatPotential({ allStat: 21 }),
  });
  await writeCapture(paths.rawRoot, "global-armor-all-stat.jsonl", signCapture(capture));

  const result = await refresh(paths);
  assert.equal(result.applied, true);
  const { item } = await readPublishedItem(paths);
  assert.equal(
    item.records[0].classification.selection_channels.includes(
      GLOBAL_ARMOR_ALL_STAT_QUERY.selection_channels[0],
    ),
    true,
  );
  assert.equal(item.records[0].sampling_frames[0].equipment_subcategory_filter, "방어구");
  assert.equal(item.records[0].sampling_frames[0].potential_filter.maximum, null);
});

test("전체 방어구 잠재 검색은 상위 분류가 없는 어깨장식을 방어구로 수용한다", async (t) => {
  const paths = await createSandbox(t);
  const observedShoulder = {
    id: null,
    name: "테스트 전역 어깨장식",
    level: 200,
    slot_label: "어깨장식",
    starforce_eligible: true,
  };
  const capture = setObservedGlobalItem(buildCapture({
    query: GLOBAL_ARMOR_ALL_STAT_QUERY,
    sweepId: "global-armor-slot-only-shoulder",
    catalogItemOverride: observedShoulder,
  }), {
    name: observedShoulder.name,
    category: "방어구",
    categoryPath: ["어깨장식"],
    slotLabel: "어깨장식",
    requiredLevel: 200,
    potential: globalStatPotential({ allStat: 21 }),
  });
  await writeCapture(paths.rawRoot, "global-armor-slot-only-shoulder.jsonl", signCapture(capture));

  const result = await refresh(paths);
  assert.equal(result.applied, true);
  const { item } = await readPublishedItem(paths);
  assert.match(item.records[0].item.catalog_id, /^observed-category:/u);
  assert.deepEqual(item.records[0].item.category_path, ["어깨장식"]);
  assert.equal(
    item.records[0].classification.selection_channels.includes(
      GLOBAL_ARMOR_ALL_STAT_QUERY.selection_channels[0],
    ),
    true,
  );
});

test("전체 장비 잠재 검색은 저장 행의 분류와 로컬 상한 변조를 다시 검증한다", async (t) => {
  const wrongCategoryPaths = await createSandbox(t);
  const observed = {
    id: null,
    name: "테스트 잘못된 분류 반지",
    level: 160,
    slot_label: "반지",
    starforce_eligible: true,
  };
  const wrongCategory = setObservedGlobalItem(buildCapture({
    query: GLOBAL_ACCESSORY_STR_27_29_QUERY,
    sweepId: "wrong-global-category",
    catalogItemOverride: observed,
  }), {
    name: observed.name,
    category: "방어구",
    slotLabel: "망토",
    requiredLevel: 160,
    potential: globalStatPotential({ str: 27 }),
  });
  await writeCapture(wrongCategoryPaths.rawRoot, "wrong-category.jsonl", signCapture(wrongCategory));
  await assert.rejects(
    refresh(wrongCategoryPaths, { mode: "check" }),
    /허용된 장비 분류가 아닙니다|장비명·분류·catalog_id 계약/u,
  );

  const overMaximumPaths = await createSandbox(t);
  const overMaximum = setObservedGlobalItem(buildCapture({
    query: GLOBAL_ACCESSORY_STR_27_29_QUERY,
    sweepId: "over-global-maximum",
    catalogItemOverride: observed,
  }), {
    name: observed.name,
    category: "장신구",
    slotLabel: "반지",
    requiredLevel: 160,
    potential: globalStatPotential({ str: 21, allStat: 9 }),
  });
  await writeCapture(overMaximumPaths.rawRoot, "over-maximum.jsonl", signCapture(overMaximum));
  await assert.rejects(
    refresh(overMaximumPaths, { mode: "check" }),
    /잠재 검색 최대값보다 큽니다/u,
  );
});

test("같은 전역 잠재 거래는 한 번만 남기고 각 검색 구간 provenance를 합친다", async (t) => {
  const paths = await createSandbox(t);
  const observed = {
    id: null,
    name: "테스트 중복 반지",
    level: 160,
    slot_label: "반지",
    starforce_eligible: true,
  };
  const captures = [
    [GLOBAL_ACCESSORY_STR_27_29_QUERY, "dedupe-str"],
    [GLOBAL_ACCESSORY_ALL_STAT_QUERY, "dedupe-all-stat"],
  ].map(([query, sweepId]) => setObservedGlobalItem(buildCapture({
    query,
    sweepId,
    listingKeys: ["same-global-listing"],
    catalogItemOverride: observed,
  }), {
    name: observed.name,
    category: "장신구",
    slotLabel: "반지",
    requiredLevel: 160,
    potential: globalStatPotential({ str: 6, allStat: 21 }),
  }));
  await writeCapture(paths.rawRoot, "dedupe-str.jsonl", signCapture(captures[0]));
  await writeCapture(paths.rawRoot, "dedupe-all-stat.jsonl", signCapture(captures[1]));

  const result = await refresh(paths);
  assert.equal(result.observations, 2);
  assert.equal(result.unique_sales, 1);
  const { item } = await readPublishedItem(paths);
  const channels = item.records[0].classification.selection_channels;
  assert.equal(channels.includes(GLOBAL_ACCESSORY_STR_27_29_QUERY.selection_channels[0]), true);
  assert.equal(channels.includes(GLOBAL_ACCESSORY_ALL_STAT_QUERY.selection_channels[0]), true);
  assert.equal(item.records[0].sampling_frames.length, 2);
});

test("잠재 없음에 옵션 줄이 있거나 스탯 출처 값이 어긋난 raw를 거부한다", async (t) => {
  const nonePaths = await createSandbox(t);
  const impossibleNone = buildCapture({ sweepId: "none-with-lines" });
  impossibleNone.items[0].item.potential.lines.push(apiPotentialLine({
    lineIndex: 1,
    code: "STR",
    value: 12,
    unit: "pct",
    raw: "STR +12%",
    apiGrade: 4,
    tier: "legendary",
    isPrime: false,
  }));
  await writeCapture(nonePaths.rawRoot, "none-with-lines.jsonl", signCapture(impossibleNone));
  await assert.rejects(
    refresh(nonePaths, { mode: "check" }),
    /잠재 없음 등급에 옵션 줄이 있습니다/,
  );

  const statPaths = await createSandbox(t);
  const mismatchedStats = buildCapture({ sweepId: "bad-stat-source" });
  mismatchedStats.items[0].item.stats.base.str_flat = 11;
  await writeCapture(statPaths.rawRoot, "bad-stat.jsonl", signCapture(mismatchedStats));
  await assert.rejects(
    refresh(statPaths, { mode: "check" }),
    /스탯 1줄과 base 원본이 일치하지 않습니다/,
  );

  const unknownKeyPaths = await createSandbox(t);
  const unknownKey = buildCapture({ sweepId: "unknown-stat-key" });
  const stats = unknownKey.items[0].item.stats;
  stats.lines[0].key = "evil_feature_flat";
  stats.base = { evil_feature_flat: 10 };
  stats.total = { evil_feature_flat: 10 };
  await writeCapture(unknownKeyPaths.rawRoot, "unknown-stat.jsonl", signCapture(unknownKey));
  await assert.rejects(
    refresh(unknownKeyPaths, { mode: "check" }),
    /스탯 1줄의 구조가 올바르지 않습니다/,
  );
});

test("API total에서 생략된 구성요소 합 0 스탯만 0으로 정규화한다", async (t) => {
  const paths = await createSandbox(t);
  const capture = buildCapture({ sweepId: "omitted-zero-stat" });
  const stats = capture.items[0].item.stats;
  stats.base.magic_attack_flat = 1;
  stats.scroll.magic_attack_flat = -1;
  stats.lines.push({
    key: "magic_attack_flat",
    code: "magic_attack",
    label: "마력",
    unit: "flat",
    total: null,
    breakdown: [
      { value: 1, unit: "flat", source_hint: "base" },
      { value: -1, unit: "flat", source_hint: "scroll" },
    ],
    component_sum_matches_total: null,
    raw: "마력 ",
  });
  await writeCapture(paths.rawRoot, "omitted-zero.jsonl", signCapture(capture));

  const result = await refresh(paths);
  assert.equal(result.applied, true);
  const { item } = await readPublishedItem(paths);
  assert.equal(item.records[0].item.stats.total.magic_attack_flat, 0);
  assert.equal(item.records[0].quality.stat_component_mismatch, false);

  const invalidPaths = await createSandbox(t);
  const invalid = clone(capture);
  invalid.capture.batch_id = "batch-omitted-nonzero-stat";
  invalid.capture.attempt.sweep_id = "omitted-nonzero-stat";
  invalid.capture.attempt.attempt_id = "attempt-omitted-nonzero-stat";
  invalid.items[0].observation_id = "batch-omitted-nonzero-stat:1";
  invalid.items[0].item.stats.base.magic_attack_flat = 2;
  invalid.items[0].item.stats.lines[1].breakdown[0].value = 2;
  await writeCapture(invalidPaths.rawRoot, "omitted-nonzero.jsonl", signCapture(invalid));
  await assert.rejects(
    refresh(invalidPaths, { mode: "check" }),
    /스탯 2줄의 구조가 올바르지 않습니다/,
  );
});

test("잠재 미적용 장비의 API 잠재 객체 생략형은 빈 값으로 보존한다", async (t) => {
  const paths = await createSandbox(t);
  const capture = buildCapture({
    query: NON_POTENTIAL_QUERY,
    sweepId: "non-potential-item",
    starforce: null,
  });
  const omitted = {
    collected: false,
    grade: null,
    grade_raw: null,
    grade_source: null,
    lines: [],
    raw_heading: null,
  };
  capture.items[0].item.potential = clone(omitted);
  capture.items[0].item.additional_potential = clone(omitted);
  await writeCapture(paths.rawRoot, "non-potential.jsonl", signCapture(capture));

  const result = await refresh(paths);
  assert.equal(result.applied, true);
  const { item } = await readPublishedItem(paths);
  assert.equal(item.records[0].item.potential.grade, null);
  assert.deepEqual(item.records[0].item.potential.lines, []);
});

test("잠재 미적용 장비의 API 강화 불가 제목을 정상적인 없음 등급으로 허용한다", async (t) => {
  const paths = await createSandbox(t);
  const capture = buildCapture({
    query: NON_POTENTIAL_QUERY,
    sweepId: "non-potential-disabled-heading",
    starforce: null,
  });
  const disabled = {
    collected: true,
    grade: "none",
    grade_raw: "없음",
    grade_source: "api_tooltip",
    lines: [],
    raw_heading: "잠재능력 : 강화 불가",
  };
  capture.items[0].item.potential = clone(disabled);
  capture.items[0].item.additional_potential = {
    ...clone(disabled),
    raw_heading: "에디셔널 잠재능력 : 강화 불가",
  };
  await writeCapture(paths.rawRoot, "non-potential-disabled.jsonl", signCapture(capture));

  const result = await refresh(paths);
  assert.equal(result.applied, true);
  const { item } = await readPublishedItem(paths);
  assert.equal(item.records[0].item.potential.grade, "none");
  assert.deepEqual(item.records[0].item.potential.lines, []);
});

test("같은 native listing ID를 여러 완료 sweep에서 관측하면 한 거래로 병합한다", async (t) => {
  const paths = await createSandbox(t);
  const shared = {
    listingKeys: ["same-native-listing"],
    priceMeso: 88_000_000,
    soldAt: "2026-09-02T02:00:00.000Z",
  };
  await writeCapture(paths.rawRoot, "duplicate-a.jsonl", buildCapture({
    ...shared,
    sweepId: "duplicate-a",
    capturedAt: "2026-09-02T02:01:00.000Z",
  }));
  await writeCapture(paths.rawRoot, "duplicate-b.jsonl", buildCapture({
    ...shared,
    sweepId: "duplicate-b",
    capturedAt: "2026-09-02T02:02:00.000Z",
  }));

  const result = await refresh(paths);
  assert.equal(result.observations, 2);
  assert.equal(result.unique_sales, 1);
  assert.equal(result.duplicate_observations, 1);
  const { item } = await readPublishedItem(paths);
  assert.equal(item.records.length, 1);
  assert.equal(item.records[0].evidence.observation_count, 2);
});

test("검증된 현행 release에 새 완료 raw만 증분 병합한다", async (t) => {
  const paths = await createSandbox(t);
  await writeCapture(paths.rawRoot, "first.jsonl", buildCapture({
    sweepId: "incremental-first",
    listingPrefix: "incremental-first",
  }));
  const first = await refresh(paths);
  assert.equal(first.unique_sales, 1);

  await writeCapture(paths.rawRoot, "second.jsonl", buildCapture({
    sweepId: "incremental-second",
    listingPrefix: "incremental-second",
    capturedAt: "2026-09-02T02:01:00.000Z",
  }));
  const second = await refresh(paths);
  assert.equal(second.applied, true);
  assert.equal(second.reused_validated_files, 1);
  assert.equal(second.newly_eligible_files, 1);
  assert.equal(second.eligible_new_format_files, 2);
  assert.equal(second.observations, 2);
  assert.equal(second.unique_sales, 2);
  assert.equal((await readJson(path.join(paths.privateRoot, "current.json"))).sources.length, 2);
});

test("0.7.7+의 동일 검색 계약은 과거 카탈로그 query_id여도 replace 반영에 누적한다", async (t) => {
  const paths = await createSandbox(t);
  const historical = buildCapture({
    sweepId: "historical-catalog",
    listingPrefix: "historical-catalog",
  });
  const historicalCatalogVersion = "2026-09-02.7";
  historical.capture.catalog.version = historicalCatalogVersion;
  historical.capture.query_task.query_id = historical.capture.query_task.query_id.replace(
    catalog.CATALOG_VERSION,
    historicalCatalogVersion,
  );
  historical.capture.query_task.task_id = `${historical.capture.query_task.query_id}#${historical.capture.query_task.lane}`;
  await writeCapture(paths.rawRoot, "historical.jsonl", signCapture(historical));
  await writeCapture(paths.rawRoot, "current.jsonl", buildCapture({
    sweepId: "current-catalog",
    listingPrefix: "current-catalog",
  }));

  const result = await refresh(paths, { replaceExisting: true });
  assert.equal(result.applied, true);
  assert.equal(result.validated_new_format_files, 2);
  assert.equal(result.eligible_new_format_files, 2);
  assert.equal(result.ignored_legacy_files, 0);
  assert.equal(result.unique_sales, 2);
  const state = await readJson(path.join(paths.privateRoot, "current.json"));
  assert.equal(state.sources.length, 2);
});

test("과거 카탈로그 표기라도 현재 검색 계약과 다른 capture는 거부한다", async (t) => {
  const paths = await createSandbox(t);
  const incompatible = buildCapture({
    sweepId: "incompatible-historical-catalog",
    listingPrefix: "incompatible-historical-catalog",
  });
  const historicalCatalogVersion = "2026-09-02.7";
  incompatible.capture.catalog.version = historicalCatalogVersion;
  incompatible.capture.query_task.query_id = incompatible.capture.query_task.query_id.replace(
    catalog.CATALOG_VERSION,
    historicalCatalogVersion,
  );
  incompatible.capture.query_task.task_id = `${incompatible.capture.query_task.query_id}#${incompatible.capture.query_task.lane}`;
  incompatible.capture.query_task.price_min_meso = 123_456_789;
  await writeCapture(paths.rawRoot, "incompatible.jsonl", signCapture(incompatible));

  await assert.rejects(
    refresh(paths, { mode: "check", replaceExisting: true }),
    /현재 고정 조사 목록과 호환되는 검색 조건이 아닙니다/,
  );
});

test("과거 버전을 가장해도 allowlist에 없는 query_id는 거부한다", async (t) => {
  const paths = await createSandbox(t);
  const forged = buildCapture({
    sweepId: "forged-historical-query-id",
    listingPrefix: "forged-historical-query-id",
  });
  const historicalCatalogVersion = "2026-09-02.7";
  forged.capture.catalog.version = historicalCatalogVersion;
  forged.capture.query_task.query_id = `${historicalCatalogVersion}:not-in-catalog:sf-any-any:pot-none`;
  forged.capture.query_task.task_id = `${forged.capture.query_task.query_id}#${forged.capture.query_task.lane}`;
  await writeCapture(paths.rawRoot, "forged.jsonl", signCapture(forged));

  await assert.rejects(
    refresh(paths, { mode: "check", replaceExisting: true }),
    /현재 고정 조사 목록과 호환되는 검색 조건이 아닙니다/,
  );
});

test("호환 시점 이전 카탈로그는 확장 프로그램 0.7.7 이상이어도 제외한다", async (t) => {
  const paths = await createSandbox(t);
  const oldCatalog = buildCapture({ sweepId: "pre-compatible-catalog" });
  const oldCatalogVersion = "2026-09-02.6";
  oldCatalog.capture.catalog.version = oldCatalogVersion;
  oldCatalog.capture.query_task.query_id = oldCatalog.capture.query_task.query_id.replace(
    catalog.CATALOG_VERSION,
    oldCatalogVersion,
  );
  oldCatalog.capture.query_task.task_id = `${oldCatalog.capture.query_task.query_id}#${oldCatalog.capture.query_task.lane}`;
  await writeCapture(paths.rawRoot, "old-catalog.jsonl", signCapture(oldCatalog));

  const checked = await refresh(paths, { mode: "check", replaceExisting: true });
  assert.equal(checked.ready, false);
  assert.equal(checked.ignored_legacy_files, 1);
});

test("후속 페이지가 없는 p1 sweep은 pending으로 남고 기존 manifest를 바꾸지 않는다", async (t) => {
  const paths = await createSandbox(t);
  await writeCapture(paths.rawRoot, "complete.jsonl", buildCapture({ sweepId: "complete" }));
  const initial = await refresh(paths);
  assert.equal(initial.applied, true);
  const manifestPath = path.join(paths.publicRoot, "manifest.json");
  const before = await readFile(manifestPath, "utf8");

  await writeCapture(paths.rawRoot, "pending-p1.jsonl", buildCapture({
    sweepId: "pending",
    hasNextPage: true,
    totalResults: 61,
    totalPages: 2,
    itemCount: 60,
    listingPrefix: "pending-page-one",
  }));
  const result = await refresh(paths);

  assert.equal(result.applied, false);
  assert.equal(result.reason, "already_current");
  assert.equal(result.pending_chains.length, 1);
  assert.equal(result.pending_chains[0].reason, "next_page_missing");
  assert.equal(await readFile(manifestPath, "utf8"), before);
});

test("p1과 p2가 연속되고 p2가 자연 종료되면 전체 sweep을 적용한다", async (t) => {
  const paths = await createSandbox(t);
  const common = {
    sweepId: "two-pages",
    attemptId: "attempt-two-pages",
    totalResults: 61,
    totalPages: 2,
    siteUsage: 14,
  };
  await writeCapture(paths.rawRoot, "page-1.jsonl", buildCapture({
    ...common,
    page: 1,
    hasNextPage: true,
    itemCount: 60,
    listingPrefix: "page-one",
  }));
  await writeCapture(paths.rawRoot, "page-2.jsonl", buildCapture({
    ...common,
    page: 2,
    hasNextPage: false,
    itemCount: 1,
    listingPrefix: "page-two",
  }));

  const result = await refresh(paths);
  assert.equal(result.applied, true);
  assert.equal(result.completed_chains, 1);
  assert.equal(result.eligible_new_format_files, 2);
  assert.equal(result.observations, 61);
  assert.equal(result.unique_sales, 61);
  const { item } = await readPublishedItem(paths);
  assert.equal(item.records.length, 61);
});

test("단일 페이지 정책은 hasNext인 p1만 허용하고 p2가 섞이면 거부한다", async (t) => {
  const paths = await createSandbox(t);
  const common = {
    query: SINGLE_PAGE_QUERY,
    sweepId: "single-page-policy",
    attemptId: "attempt-single-page-policy",
    totalResults: 61,
    totalPages: 2,
    siteUsage: 20,
  };
  await writeCapture(paths.rawRoot, "page-1.jsonl", buildCapture({
    ...common,
    page: 1,
    hasNextPage: true,
    itemCount: 60,
    listingPrefix: "single-page-one",
  }));

  const first = await refresh(paths);
  assert.equal(first.applied, true);
  assert.equal(first.completed_chains, 1);
  const currentPath = path.join(paths.privateRoot, "current.json");
  const current = await readJson(currentPath);
  assert.equal(current.completed_chains[0].reason, "single_page_policy");
  assert.equal(current.completed_chains[0].truncated, true);
  const manifestPath = path.join(paths.publicRoot, "manifest.json");
  const manifestBefore = await readFile(manifestPath, "utf8");

  await writeCapture(paths.rawRoot, "page-2.jsonl", buildCapture({
    ...common,
    page: 2,
    hasNextPage: false,
    listingPrefix: "single-page-two",
  }));
  await assert.rejects(
    refresh(paths),
    /단일 페이지 정책 검색에 후속 페이지가 포함되었습니다/,
  );
  assert.equal(await readFile(manifestPath, "utf8"), manifestBefore);
});

test("p2 단독 및 p1+p3처럼 연속되지 않은 sweep을 거부한다", async (t) => {
  const pageTwoOnly = await createSandbox(t);
  await writeCapture(pageTwoOnly.rawRoot, "page-2.jsonl", buildCapture({
    sweepId: "page-two-only",
    page: 2,
    hasNextPage: false,
    totalResults: 61,
    totalPages: 2,
  }));
  await assert.rejects(
    refresh(pageTwoOnly, { mode: "check" }),
    /페이지가 1부터 연속으로 저장되지 않았습니다/,
  );

  const pageGap = await createSandbox(t);
  const common = {
    sweepId: "page-gap",
    attemptId: "attempt-page-gap",
    totalResults: 121,
    totalPages: 3,
  };
  await writeCapture(pageGap.rawRoot, "page-1.jsonl", buildCapture({
    ...common,
    page: 1,
    hasNextPage: true,
    itemCount: 60,
  }));
  await writeCapture(pageGap.rawRoot, "page-3.jsonl", buildCapture({
    ...common,
    page: 3,
    hasNextPage: false,
  }));
  await assert.rejects(
    refresh(pageGap, { mode: "check" }),
    /페이지가 1부터 연속으로 저장되지 않았습니다/,
  );
});

test("같은 attempt의 페이지는 검색 사용량이 같아야 하고 새 attempt resume은 +1을 허용한다", async (t) => {
  const changedWithinAttempt = await createSandbox(t);
  const sameAttempt = {
    sweepId: "same-attempt-usage",
    attemptId: "attempt-same-usage",
    totalResults: 61,
    totalPages: 2,
  };
  await writeCapture(changedWithinAttempt.rawRoot, "page-1.jsonl", buildCapture({
    ...sameAttempt,
    page: 1,
    hasNextPage: true,
    itemCount: 60,
    siteUsage: 31,
  }));
  await writeCapture(changedWithinAttempt.rawRoot, "page-2.jsonl", buildCapture({
    ...sameAttempt,
    page: 2,
    hasNextPage: false,
    siteUsage: 32,
  }));
  await assert.rejects(
    refresh(changedWithinAttempt, { mode: "check" }),
    /같은 attempt의 페이지에서 검색 횟수가 변했습니다/,
  );

  const resumed = await createSandbox(t);
  const resumedCommon = {
    sweepId: "resumed-usage",
  };
  await writeCapture(resumed.rawRoot, "page-1.jsonl", buildCapture({
    ...resumedCommon,
    attemptId: "attempt-before-resume",
    page: 1,
    totalResults: 121,
    totalPages: 3,
    hasNextPage: true,
    itemCount: 60,
    siteUsage: 41,
  }));
  await writeCapture(resumed.rawRoot, "page-2.jsonl", buildCapture({
    ...resumedCommon,
    attemptId: "attempt-after-resume",
    page: 2,
    totalResults: 61,
    totalPages: 2,
    hasNextPage: false,
    siteUsage: 42,
    collectionMode: "catalog_resume",
    retryCount: 1,
  }));
  const result = await refresh(resumed);
  assert.equal(result.applied, true);
  assert.equal(result.completed_chains, 1);
  assert.equal(result.observations, 61);
});

test("500건 상한은 p9 원본 60건 중 20건만 보존하고 다음 페이지가 있어도 완료한다", async (t) => {
  const paths = await createSandbox(t);
  const common = {
    sweepId: "result-cap-500",
    attemptId: "attempt-result-cap-500",
    totalResults: 600,
    totalPages: 10,
    hasNextPage: true,
    siteUsage: 51,
  };
  for (let page = 1; page <= 8; page += 1) {
    await writeCapture(paths.rawRoot, `page-${page}.jsonl`, buildCapture({
      ...common,
      page,
      pageRows: 60,
      sourceRows: 60,
      listingPrefix: `cap-page-${page}`,
    }));
  }
  await writeCapture(paths.rawRoot, "page-9.jsonl", buildCapture({
    ...common,
    page: 9,
    pageRows: 20,
    sourceRows: 60,
    listingPrefix: "cap-page-9",
  }));

  const result = await refresh(paths);
  assert.equal(result.applied, true);
  assert.equal(result.completed_chains, 1);
  assert.equal(result.eligible_new_format_files, 9);
  assert.equal(result.observations, 500);
  assert.equal(result.unique_sales, 500);
  const current = await readJson(path.join(paths.privateRoot, "current.json"));
  assert.deepEqual(current.completed_chains, [{
    query_id: BASELINE_QUERY.query_id,
    sweep_id: "result-cap-500",
    pages: 9,
    reason: "result_cap_reached",
    truncated: true,
  }]);
});

test("0.7.7은 빈 결과도 구조화 API transport와 재계산 가능한 페이지 서명을 필수로 한다", async (t) => {
  const emptyDom = await createSandbox(t);
  await writeCapture(emptyDom.rawRoot, "empty-dom.jsonl", buildCapture({
    sweepId: "empty-dom",
    totalResults: 0,
    totalPages: 1,
    pageRows: 0,
    sourceRows: 0,
    hasNextPage: false,
    collectionTransport: "empty_result_dom",
  }));
  await assert.rejects(
    refresh(emptyDom, { mode: "check" }),
    /0\.7\.7 원본이 구조화 툴팁 API로 수집되지 않았습니다/,
  );

  const badSignature = await createSandbox(t);
  const capture = buildCapture({ sweepId: "bad-page-signature" });
  capture.capture.result_summary.page_signature = "page-v1:forged:1";
  await writeCapture(badSignature.rawRoot, "bad-signature.jsonl", signCapture(capture));
  await assert.rejects(
    refresh(badSignature, { mode: "check" }),
    /페이지 서명이 저장된 매물과 일치하지 않습니다/,
  );
});

test("원본/보존 건수와 500건 cap 절단 근거를 엄격히 검증한다", async (t) => {
  const stringCount = await createSandbox(t);
  const countCapture = buildCapture({ sweepId: "string-count" });
  countCapture.capture.collection_summary.source_page_rows = "1";
  await writeCapture(stringCount.rawRoot, "string-count.jsonl", signCapture(countCapture));
  await assert.rejects(
    refresh(stringCount, { mode: "check" }),
    /source_page_rows가 0 이상의 안전한 정수가 아닙니다/,
  );

  const earlyCap = await createSandbox(t);
  await writeCapture(earlyCap.rawRoot, "early-cap.jsonl", buildCapture({
    sweepId: "early-cap",
    totalResults: 61,
    totalPages: 2,
    page: 1,
    sourceRows: 60,
    pageRows: 20,
    hasNextPage: true,
  }));
  await assert.rejects(
    refresh(earlyCap, { mode: "check" }),
    /원본\/상한 보존 건수가 0\.7\.7 수집 계약과 다릅니다/,
  );

  const missingWarning = await createSandbox(t);
  const warningCapture = buildCapture({
    sweepId: "missing-cap-warning",
    totalResults: 61,
    totalPages: 2,
    page: 1,
    sourceRows: 60,
    pageRows: 20,
    hasNextPage: true,
  });
  warningCapture.capture.quality_warnings = warningCapture.capture.quality_warnings
    .filter((warning) => !warning.startsWith("result_cap_rows_excluded:"));
  await writeCapture(missingWarning.rawRoot, "missing-warning.jsonl", signCapture(warningCapture));
  await assert.rejects(
    refresh(missingWarning, { mode: "check" }),
    /결과 상한으로 제외한 원본 건수 근거가 일치하지 않습니다/,
  );
});

test("각 페이지의 건수 산술은 검증하되 페이지 간 전체 건수·페이지 수 감소는 허용한다", async (t) => {
  const impossiblePage = await createSandbox(t);
  await writeCapture(impossiblePage.rawRoot, "impossible-page.jsonl", buildCapture({
    sweepId: "impossible-page",
    totalResults: 61,
    totalPages: 2,
    page: 1,
    sourceRows: 1,
    pageRows: 1,
    hasNextPage: true,
  }));
  await assert.rejects(
    refresh(impossiblePage, { mode: "check" }),
    /전체 결과 수와 현재 페이지 원본 건수\/다음 페이지 표기가 모순됩니다/,
  );

  const changedSameAttempt = await createSandbox(t);
  const sameAttempt = {
    sweepId: "same-attempt-total-change",
    attemptId: "attempt-total-change",
    siteUsage: 61,
  };
  await writeCapture(changedSameAttempt.rawRoot, "page-1.jsonl", buildCapture({
    ...sameAttempt,
    page: 1,
    totalResults: 121,
    totalPages: 3,
    sourceRows: 60,
    pageRows: 60,
    hasNextPage: true,
  }));
  await writeCapture(changedSameAttempt.rawRoot, "page-2.jsonl", buildCapture({
    ...sameAttempt,
    page: 2,
    totalResults: 61,
    totalPages: 2,
    sourceRows: 1,
    pageRows: 1,
    hasNextPage: false,
  }));
  const changed = await refresh(changedSameAttempt, { mode: "check" });
  assert.equal(changed.ready, true);
  assert.equal(changed.completed_chains, 1);
  assert.equal(changed.unique_sales, 61);
});

test("자동 갱신은 불일치 묶음 전체를 격리하고 기존 자료와 정상 신규 묶음은 반영한다", async (t) => {
  const paths = await createSandbox(t);
  await writeCapture(paths.rawRoot, "previous.jsonl", buildCapture({ sweepId: "previous", listingPrefix: "previous" }));
  await refresh(paths);
  await writeCapture(paths.rawRoot, "new.jsonl", buildCapture({ sweepId: "new", listingPrefix: "new" }));
  const common = { sweepId: "inconsistent-usage", attemptId: "same-attempt", siteUsage: 61 };
  await writeCapture(paths.rawRoot, "drift-1.jsonl", buildCapture({ ...common, page: 1,
    totalResults: 61, totalPages: 2, sourceRows: 60, pageRows: 60, hasNextPage: true,
    listingPrefix: "quarantined-first" }));
  await writeCapture(paths.rawRoot, "drift-2.jsonl", buildCapture({ ...common, page: 2,
    totalResults: 63, totalPages: 2, sourceRows: 3, pageRows: 3, hasNextPage: false,
    siteUsage: 62, listingPrefix: "quarantined-second" }));

  const result = await refresh(paths, { deferInvalidChains: true });
  assert.equal(result.applied, true);
  assert.equal(result.newly_eligible_files, 1);
  assert.equal(result.reused_validated_files, 1);
  assert.equal(result.unique_sales, 2);
  assert.equal(result.quarantined_chains.length, 1);
  assert.equal(result.quarantined_chains[0].pages, 2);
  assert.match(result.quarantined_chains[0].error, /같은 attempt의 페이지에서 검색 횟수가 변했습니다/);
  assert.equal(result.quarantined_chains[0].source_hashes.length, 2);
  assert.equal((await readPublishedItem(paths)).item.records.length, 2);
  assert.equal(await exists(path.join(paths.rawRoot, "drift-1.jsonl")), true);
  assert.equal(await exists(path.join(paths.rawRoot, "drift-2.jsonl")), true);
  await assert.rejects(refresh(paths, { mode: "check" }), /같은 attempt의 페이지에서 검색 횟수가 변했습니다/);

  // This policy must not swallow integrity failures before chain validation.
  const tampered = buildCapture({ sweepId: "tampered" });
  tampered.integrity.payload_sha256 = "0".repeat(64);
  await writeCapture(paths.rawRoot, "tampered.jsonl", tampered);
  await assert.rejects(refresh(paths, { deferInvalidChains: true }), /무결성 검증에 실패/);
});

test("페이지 순회 중 판매 완료 건수가 1건 변해도 정상 수집한다", async (t) => {
  const paths = await createSandbox(t);
  const common = {
    sweepId: "one-result-live-drift",
    attemptId: "attempt-one-result-live-drift",
    siteUsage: 61,
  };
  await writeCapture(paths.rawRoot, "page-1.jsonl", buildCapture({
    ...common,
    page: 1,
    totalResults: 61,
    totalPages: 2,
    sourceRows: 60,
    pageRows: 60,
    hasNextPage: true,
    listingPrefix: "live-drift-page-one",
  }));
  await writeCapture(paths.rawRoot, "page-2.jsonl", buildCapture({
    ...common,
    page: 2,
    totalResults: 62,
    totalPages: 2,
    sourceRows: 2,
    pageRows: 2,
    hasNextPage: false,
    listingPrefix: "live-drift-page-two",
  }));

  const checked = await refresh(paths, { mode: "check" });
  assert.equal(checked.ready, true);
  assert.equal(checked.completed_chains, 1);
  assert.equal(checked.observations, 62);
  assert.equal(checked.unique_sales, 62);
});

test("전체 건수·페이지 수 증가를 허용하고 경계에서 반복된 거래는 한 번만 반영한다", async (t) => {
  const paths = await createSandbox(t);
  const common = { sweepId: "live-growth", attemptId: "live-growth-attempt", siteUsage: 61 };
  await writeCapture(paths.rawRoot, "page-1.jsonl", buildCapture({ ...common, page: 1,
    totalResults: 119, totalPages: 2, sourceRows: 60, pageRows: 60, hasNextPage: true,
    listingPrefix: "growth-p1" }));
  await writeCapture(paths.rawRoot, "page-2.jsonl", buildCapture({ ...common, page: 2,
    totalResults: 122, totalPages: 3, sourceRows: 60, pageRows: 60, hasNextPage: true,
    listingKeys: Array.from({ length: 60 }, (_, i) => i === 0 ? "growth-p1-1" : `growth-p2-${i + 1}`) }));
  await writeCapture(paths.rawRoot, "page-3.jsonl", buildCapture({ ...common, page: 3,
    totalResults: 122, totalPages: 3, sourceRows: 2, pageRows: 2, hasNextPage: false }));
  const result = await refresh(paths);
  assert.equal(result.applied, true);
  assert.equal(result.quarantined_chains.length, 0);
  assert.equal(result.observations, 122);
  assert.equal(result.unique_sales, 121);
  assert.equal(result.duplicate_observations, 1);
  assert.equal((await readPublishedItem(paths)).item.records.length, 121);
});

test("0.7.7 자동 카탈로그 외 collection_mode를 거부한다", async (t) => {
  const paths = await createSandbox(t);
  await writeCapture(paths.rawRoot, "manual-mode.jsonl", buildCapture({
    sweepId: "manual-mode",
    collectionMode: "current_page",
  }));
  await assert.rejects(
    refresh(paths, { mode: "check" }),
    /0\.7\.7 자동 카탈로그 수집 mode가 아닙니다/,
  );

  const invalidResume = await createSandbox(t);
  await writeCapture(invalidResume.rawRoot, "resume-without-retry.jsonl", buildCapture({
    sweepId: "resume-without-retry",
    collectionMode: "catalog_resume",
  }));
  await assert.rejects(
    refresh(invalidResume, { mode: "check" }),
    /collection_mode와 retry\/restart 근거가 일치하지 않습니다/,
  );

  const invalidRestart = await createSandbox(t);
  await writeCapture(invalidRestart.rawRoot, "restart-without-reason.jsonl", buildCapture({
    sweepId: "restart-without-reason",
    collectionMode: "catalog_restart",
    retryCount: 1,
  }));
  await assert.rejects(
    refresh(invalidRestart, { mode: "check" }),
    /collection_mode와 retry\/restart 근거가 일치하지 않습니다/,
  );

  const validRestart = await createSandbox(t);
  await writeCapture(validRestart.rawRoot, "restart.jsonl", buildCapture({
    sweepId: "restart",
    collectionMode: "catalog_restart",
    retryCount: 1,
    resumeRestartReason: "snapshot_changed",
  }));
  const result = await refresh(validRestart, { mode: "check" });
  assert.equal(result.ready, true);
  assert.equal(result.completed_chains, 1);
});

test("빈 페이지 capture만으로는 새 공개판을 만들 수 없다", async (t) => {
  const paths = await createSandbox(t);
  await writeCapture(paths.rawRoot, "empty-only.jsonl", buildCapture({
    sweepId: "empty-only",
    totalResults: 0,
    totalPages: 1,
    pageRows: 0,
    sourceRows: 0,
    hasNextPage: false,
  }));

  await assert.rejects(
    refresh(paths),
    /적용 가능한 0\.7\.7 이상 신규 raw 파일이 없습니다/,
  );
  assert.equal(await exists(paths.privateRoot), false);
  assert.equal(await exists(paths.publicRoot), false);
});

test("결과 0건이라 60개 선택기가 없는 페이지의 기본 20개 근거만 예외로 허용한다", async (t) => {
  const emptyPaths = await createSandbox(t);
  await writeCapture(emptyPaths.rawRoot, "empty-default-20.jsonl", buildCapture({
    sweepId: "empty-default-20",
    totalResults: 0,
    totalPages: null,
    pageRows: 0,
    sourceRows: 0,
    hasNextPage: false,
    pageLimit: 20,
  }));
  const checked = await refresh(emptyPaths, { mode: "check" });
  assert.equal(checked.ready, false);
  assert.equal(checked.observations, 0);

  const nonemptyPaths = await createSandbox(t);
  await writeCapture(nonemptyPaths.rawRoot, "nonempty-20.jsonl", buildCapture({
    sweepId: "nonempty-20",
    pageLimit: 20,
  }));
  await assert.rejects(
    refresh(nonemptyPaths, { mode: "check" }),
    /신규 원본은 페이지당 60개 설정으로 수집해야 합니다/,
  );
});

test("integrity 이후 원문이 변조된 capture는 거부한다", async (t) => {
  const paths = await createSandbox(t);
  const tampered = buildCapture({ sweepId: "tampered" });
  tampered.items[0].listing.price_meso = "99000000";
  await writeCapture(paths.rawRoot, "tampered.jsonl", tampered);

  await assert.rejects(
    refresh(paths, { mode: "check" }),
    /SHA-256 무결성 검증에 실패/,
  );
  assert.equal(await exists(path.join(paths.publicRoot, "manifest.json")), false);
});

test("0.7.7 미만 capture는 신규 자료에서 제외한다", async (t) => {
  const paths = await createSandbox(t);
  const legacy = buildCapture({ sweepId: "legacy" });
  legacy.capture.extension_version = "0.7.6";
  await writeCapture(paths.rawRoot, "legacy.jsonl", signCapture(legacy));

  const result = await refresh(paths, { mode: "check" });
  assert.equal(result.ready, false);
  assert.equal(result.validated_new_format_files, 0);
  assert.equal(result.eligible_new_format_files, 0);
  assert.equal(result.ignored_legacy_files, 1);
});

test("빈 capture만 들어온 적용은 기존 공개판을 교체하지 않는다", async (t) => {
  const paths = await createSandbox(t);
  await writeCapture(paths.rawRoot, "initial.jsonl", buildCapture({ sweepId: "initial" }));
  await refresh(paths);
  const manifestPath = path.join(paths.publicRoot, "manifest.json");
  const currentPath = path.join(paths.privateRoot, "current.json");
  const manifestBefore = await readFile(manifestPath, "utf8");
  const currentBefore = await readFile(currentPath, "utf8");

  const emptyRawRoot = path.join(paths.root, "empty-raw");
  await mkdir(emptyRawRoot);
  await writeCapture(emptyRawRoot, "empty.jsonl", buildCapture({
    sweepId: "empty",
    totalResults: 0,
    totalPages: 1,
    itemCount: 0,
    hasNextPage: false,
  }));

  await assert.rejects(
    refresh({ ...paths, rawRoot: emptyRawRoot }),
    /적용 가능한 0\.7\.7 이상 신규 raw 파일이 없습니다/,
  );
  assert.equal(await readFile(manifestPath, "utf8"), manifestBefore);
  assert.equal(await readFile(currentPath, "utf8"), currentBefore);
});

test("check는 쓰지 않고 동일 자료 재적용은 완전히 idempotent하다", async (t) => {
  const paths = await createSandbox(t);
  await writeCapture(paths.rawRoot, "idempotent.jsonl", buildCapture({ sweepId: "idempotent" }));

  const checked = await refresh(paths, { mode: "check" });
  assert.equal(checked.ready, true);
  assert.equal(checked.unique_sales, 1);
  assert.equal(await exists(paths.privateRoot), false);
  assert.equal(await exists(paths.publicRoot), false);

  const first = await refresh(paths);
  assert.equal(first.applied, true);
  const before = {
    private: await snapshotTree(paths.privateRoot),
    public: await snapshotTree(paths.publicRoot),
  };

  const checkedAfterApply = await refresh(paths, { mode: "check" });
  assert.equal(checkedAfterApply.changed, false);
  assert.deepEqual(await snapshotTree(paths.privateRoot), before.private);
  assert.deepEqual(await snapshotTree(paths.publicRoot), before.public);

  const second = await refresh(paths);
  assert.equal(second.applied, false);
  assert.equal(second.reason, "already_current");
  assert.deepEqual(await snapshotTree(paths.privateRoot), before.private);
  assert.deepEqual(await snapshotTree(paths.publicRoot), before.public);
});

test("private current가 없어도 공개 release state에서 이전 raw 목록을 복구해 축소 적용을 막는다", async (t) => {
  const paths = await createSandbox(t);
  const firstPath = await writeCapture(paths.rawRoot, "first.jsonl", buildCapture({
    sweepId: "source-guard-first",
    listingPrefix: "source-guard-first",
  }));
  const secondPath = await writeCapture(paths.rawRoot, "second.jsonl", buildCapture({
    sweepId: "source-guard-second",
    listingPrefix: "source-guard-second",
  }));
  const initial = await refresh(paths);
  assert.equal(initial.applied, true);
  assert.equal((await readJson(path.join(paths.privateRoot, "current.json"))).sources.length, 2);

  await rm(secondPath);
  await rm(path.join(paths.privateRoot, "current.json"));
  const checked = await refresh(paths, { mode: "check" });
  assert.equal(checked.previous_source_guard, "verified");
  assert.ok(checked.previous_source_guard_origins.includes("published_release_state"));
  assert.equal(checked.previous_source_baseline_files, 2);
  assert.equal(checked.missing_previous_sources, 1);
  await assert.rejects(
    refresh(paths),
    /이전 공개판의 신규 raw 1개가 현재 폴더에서 사라졌습니다/,
  );
  assert.equal(await exists(firstPath), true);
});

test("공개판 원본 목록을 어느 private state에서도 복구하지 못하면 명시적 replace 없이 중단한다", async (t) => {
  const paths = await createSandbox(t);
  await writeCapture(paths.rawRoot, "first.jsonl", buildCapture({
    sweepId: "unresolved-first",
    listingPrefix: "unresolved-first",
  }));
  const secondPath = await writeCapture(paths.rawRoot, "second.jsonl", buildCapture({
    sweepId: "unresolved-second",
    listingPrefix: "unresolved-second",
  }));
  const initial = await refresh(paths);
  const manifestBefore = await readFile(path.join(paths.publicRoot, "manifest.json"), "utf8");

  await rm(secondPath);
  await rm(path.join(paths.privateRoot, "current.json"));
  await rm(path.join(paths.privateRoot, "releases", initial.dataset_version, "state.json"));
  const checked = await refresh(paths, { mode: "check" });
  assert.equal(checked.previous_source_guard, "unresolved");
  assert.equal(checked.previous_source_baseline_files, 0);
  await assert.rejects(
    refresh(paths),
    /기존 공개판의 원본 목록을 복구할 수 없습니다/,
  );
  assert.equal(await readFile(path.join(paths.publicRoot, "manifest.json"), "utf8"), manifestBefore);

  const replaced = await refresh(paths, { replaceExisting: true });
  assert.equal(replaced.applied, true);
  assert.notEqual(replaced.dataset_version, initial.dataset_version);
  assert.equal((await readJson(path.join(paths.privateRoot, "current.json"))).sources.length, 1);
});

test("동일 source digest이면 private 원본 목록이 모두 없어도 손상 포인터를 안전하게 복구한다", async (t) => {
  const paths = await createSandbox(t);
  await writeCapture(paths.rawRoot, "same.jsonl", buildCapture({ sweepId: "same-digest-repair" }));
  const initial = await refresh(paths);
  await rm(path.join(paths.privateRoot, "current.json"));
  await rm(path.join(paths.privateRoot, "releases", initial.dataset_version, "state.json"));

  const checked = await refresh(paths, { mode: "check" });
  assert.equal(checked.previous_source_guard, "verified");
  assert.ok(checked.previous_source_guard_origins.includes("matching_public_dataset_digest"));
  assert.equal(checked.missing_previous_sources, 0);

  const repaired = await refresh(paths);
  assert.equal(repaired.applied, true);
  assert.equal(repaired.repaired, true);
  assert.equal((await refresh(paths, { mode: "check" })).changed, false);
});

test("같은 버전의 공개 item·catalog 손상을 감지하고 결정적 산출물로 복구한다", async (t) => {
  const paths = await createSandbox(t);
  await writeCapture(paths.rawRoot, "repair-public.jsonl", buildCapture({ sweepId: "repair-public" }));
  const initial = await refresh(paths);
  const published = await readPublishedItem(paths);
  const catalogPath = path.join(paths.publicRoot, published.manifest.catalog.file);
  const itemPath = path.join(path.dirname(catalogPath), published.entry.file);

  await writeFile(itemPath, "{\"damaged\":true}\n", "utf8");
  const itemCheck = await refresh(paths, { mode: "check" });
  assert.equal(itemCheck.changed, true);
  assert.equal(itemCheck.current_release_valid, false);
  assert.ok(itemCheck.current_release_issues.some((issue) => issue.code === "public_item_hash_mismatch"));
  assert.equal(await readFile(itemPath, "utf8"), "{\"damaged\":true}\n");

  const itemRepair = await refresh(paths);
  assert.equal(itemRepair.applied, true);
  assert.equal(itemRepair.repaired, true);
  assert.equal((await refresh(paths, { mode: "check" })).changed, false);

  const damagedCatalog = await readJson(catalogPath);
  damagedCatalog.schema_version = "damaged.catalog";
  damagedCatalog.dataset_version = "damaged-version";
  await writeFile(catalogPath, `${JSON.stringify(damagedCatalog)}\n`, "utf8");
  const catalogCheck = await refresh(paths, { mode: "check" });
  const catalogIssueCodes = catalogCheck.current_release_issues.map((issue) => issue.code);
  assert.equal(catalogCheck.changed, true);
  assert.ok(catalogIssueCodes.includes("public_catalog_hash_mismatch"));
  assert.ok(catalogIssueCodes.includes("public_catalog_schema_mismatch"));
  assert.ok(catalogIssueCodes.includes("public_catalog_version_mismatch"));

  const catalogRepair = await refresh(paths);
  assert.equal(catalogRepair.applied, true);
  assert.equal(catalogRepair.repaired, true);
  const repaired = await readPublishedItem(paths);
  assert.equal(repaired.manifest.dataset_version, initial.dataset_version);
  assert.equal(repaired.catalog.dataset_version, initial.dataset_version);
  assert.equal((await refresh(paths, { mode: "check" })).changed, false);
});

test("같은 버전의 manifest·private current·누락 산출물을 복구하고 다시 idempotent해진다", async (t) => {
  const paths = await createSandbox(t);
  await writeCapture(paths.rawRoot, "repair-pointers.jsonl", buildCapture({ sweepId: "repair-pointers" }));
  const initial = await refresh(paths);
  const manifestPath = path.join(paths.publicRoot, "manifest.json");
  const currentPath = path.join(paths.privateRoot, "current.json");
  const privateReleaseRoot = path.join(paths.privateRoot, "releases", initial.dataset_version);
  const missingArtifact = path.join(privateReleaseRoot, "auction-sold.csv");

  await writeFile(manifestPath, "{not-json", "utf8");
  const manifestCheck = await refresh(paths, { mode: "check" });
  assert.equal(manifestCheck.changed, true);
  assert.ok(manifestCheck.current_release_issues.some((issue) =>
    issue.code === "public_manifest_invalid_json"
  ));
  const manifestRepair = await refresh(paths);
  assert.equal(manifestRepair.applied, true);
  assert.equal(manifestRepair.repaired, true);
  assert.equal((await readJson(manifestPath)).dataset_version, initial.dataset_version);

  const damagedCurrent = await readJson(currentPath);
  damagedCurrent.schema_version = "damaged.state";
  await writeFile(currentPath, `${JSON.stringify(damagedCurrent)}\n`, "utf8");
  await rm(missingArtifact);
  const privateCheck = await refresh(paths, { mode: "check" });
  const privateIssueCodes = privateCheck.current_release_issues.map((issue) => issue.code);
  assert.equal(privateCheck.changed, true);
  assert.ok(privateIssueCodes.includes("private_current_contract_mismatch"));
  assert.ok(privateIssueCodes.includes("private_artifact_missing"));

  const privateRepair = await refresh(paths);
  assert.equal(privateRepair.applied, true);
  assert.equal(privateRepair.repaired, true);
  assert.equal(await exists(missingArtifact), true);
  assert.equal((await readJson(currentPath)).schema_version, "maplestarforce.item-market.state.v1");

  const finalCheck = await refresh(paths, { mode: "check" });
  assert.equal(finalCheck.changed, false);
  assert.equal(finalCheck.current_release_valid, true);
  const finalApply = await refresh(paths);
  assert.equal(finalApply.applied, false);
  assert.equal(finalApply.reason, "already_current");
});
