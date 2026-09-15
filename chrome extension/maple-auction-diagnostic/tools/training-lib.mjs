const FORBIDDEN_TRAINING_KEYS = /(?:combat_power_change|price_raw|display_name|base_name|icon_url|grade_raw|raw_heading|color_rgb|color_class|privacy|parser_warnings|data_repair|source_evidence|repair_changes|quality_warnings|seller|maker|cookie|authorization|token|session|csrf|otp|html)/iu;

function compactPotential(section) {
  return {
    grade: section?.grade ?? null,
    lines: (section?.lines || []).map((line) => ({
      line_index: line.line_index,
      code: line.code,
      value: line.value,
      unit: line.unit,
      tier: line.tier,
      is_prime: line.is_prime,
      params: line.params || {}
    }))
  };
}

function flattenStats(row, stats) {
  for (const source of ["base", "starforce", "scroll", "flame", "other", "total"]) {
    for (const [key, value] of Object.entries(stats?.[source] || {})) {
      row[`stats_${source}_${key}`] = value;
    }
  }
}

export function toTrainingRow(record) {
  if (record?.listing?.status !== "sold") {
    return null;
  }
  const row = {
    observation_id: record.observation_id,
    matched_preset_ids_json: JSON.stringify(record.matched_preset_ids || []),
    selection_channels_json: JSON.stringify(record.selection_channels || []),
    listing_id: record.listing?.listing_id,
    listing_id_source: record.listing?.listing_id_source,
    listing_fingerprint: record.listing?.listing_fingerprint,
    price_meso: record.listing?.price_meso,
    sold_at: record.listing?.sold_at,
    sold_at_precision: record.listing?.sold_at_precision,
    listing_world: record.listing?.listing_world,
    is_cross_world: record.listing?.is_cross_world,
    item_id: record.item?.item_id,
    item_id_source: record.item?.item_id_source,
    catalog_id: record.item?.catalog_id ?? record.catalog_id ?? null,
    catalog_key: record.item?.catalog_key,
    item_name: record.item?.name,
    icon_asset_key: record.item?.icon_asset_key,
    starforce_preset_id: record.item?.starforce_preset_id,
    category: record.item?.category,
    category_path_json: JSON.stringify(record.item?.category_path || []),
    required_job: record.item?.required_job,
    set_name: record.item?.set_name,
    base_level: record.item?.base_level,
    required_level: record.item?.required_level,
    required_level_reduction: record.item?.required_level_reduction,
    starforce_value: record.item?.starforce?.value,
    starforce_applicable: record.item?.starforce?.applicable ??
      (record.item?.starforce?.value != null ? true : null),
    starforce_source: record.item?.starforce?.source,
    starforce_confidence: record.item?.starforce?.confidence,
    upgrade_applied: record.item?.upgrade?.applied,
    upgrade_remaining: record.item?.upgrade?.remaining,
    upgrade_recoverable: record.item?.upgrade?.recoverable,
    upgrade_scroll_type: record.item?.upgrade?.scroll_type,
    trade_state: record.item?.trade?.state,
    scissors_remaining: record.item?.trade?.scissors_remaining,
    scissors_total: record.item?.trade?.scissors_total,
    potential_json: JSON.stringify(compactPotential(record.item?.potential)),
    additional_potential_json: JSON.stringify(compactPotential(record.item?.additional_potential))
  };
  flattenStats(row, record.item?.stats);
  return row;
}

export function toTrainingRows(records) {
  const entries = records.map((record, index) => ({
    record,
    row: toTrainingRow(record),
    index
  })).filter((entry) => Boolean(entry.row));
  const nativeRows = new Map();
  const outputEntries = [];
  const groupedFallbacks = new Map();
  for (const entry of entries) {
    const { record, row } = entry;
    // A fingerprint is explicitly not a global transaction ID. Only merge when
    // the auction site exposes a native listing ID, or when separate collector
    // attempts captured the same fingerprint/date/price tuple.  The latter
    // keeps the largest within-attempt multiplicity so legitimately identical
    // sales from one result page are not collapsed to one row.
    if (!row.listing_id || row.listing_id_source !== "native") {
      const queryId = record?.capture?.query_task?.query_id;
      const attemptId = record?.capture?.attempt?.attempt_id;
      const fallbackKey = fallbackDedupeKey(row);
      if (!queryId || !attemptId || !fallbackKey) {
        outputEntries.push(entry);
        continue;
      }
      const group = groupedFallbacks.get(fallbackKey) || new Map();
      const attemptRows = group.get(attemptId) || [];
      attemptRows.push(entry);
      group.set(attemptId, attemptRows);
      groupedFallbacks.set(fallbackKey, group);
      continue;
    }
    const existing = nativeRows.get(row.listing_id);
    if (!existing) {
      nativeRows.set(row.listing_id, entry);
      outputEntries.push(entry);
      continue;
    }
    mergeTrainingLabels(existing.row, row);
  }

  for (const attempts of groupedFallbacks.values()) {
    const attemptGroups = [...attempts.values()].sort((left, right) =>
      right.length - left.length || left[0].index - right[0].index
    );
    const retained = attemptGroups[0];
    const allRows = attemptGroups.flat().map((entry) => entry.row);
    for (const entry of retained) {
      for (const row of allRows) mergeTrainingLabels(entry.row, row);
      outputEntries.push(entry);
    }
  }

  return outputEntries.sort((left, right) => left.index - right.index).map((entry) => entry.row);
}

function mergeTrainingLabels(existing, row) {
  existing.matched_preset_ids_json = mergeJsonStringArrays(
      existing.matched_preset_ids_json,
      row.matched_preset_ids_json
    );
  existing.selection_channels_json = mergeJsonStringArrays(
      existing.selection_channels_json,
      row.selection_channels_json
    );
}

function fallbackDedupeKey(row) {
  if (!row.listing_fingerprint || row.price_meso == null || !row.sold_at) return null;
  const catalog = row.catalog_id || row.catalog_key || row.item_name;
  if (!catalog) return null;
  return [
    catalog,
    row.listing_fingerprint,
    row.sold_at,
    row.price_meso,
    row.listing_world ?? ""
  ].join("\u001f");
}

function mergeJsonStringArrays(left, right) {
  return JSON.stringify(Array.from(new Set([
    ...safeJsonArray(left),
    ...safeJsonArray(right)
  ])).sort());
}

function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
  } catch (_error) {
    return [];
  }
}

export function assertTrainingSafe(rows) {
  const violations = [];
  for (const [index, row] of rows.entries()) {
    for (const key of Object.keys(row)) {
      if (FORBIDDEN_TRAINING_KEYS.test(key)) {
        violations.push({ row: index + 1, key });
      }
    }
  }
  if (violations.length > 0) {
    throw new Error(`학습 데이터 금지 필드 발견: ${JSON.stringify(violations)}`);
  }
  return true;
}

function csvCell(value) {
  if (value == null) {
    return "";
  }
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function toCsv(rows) {
  assertTrainingSafe(rows);
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).sort();
  const lines = [columns.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(row[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}
