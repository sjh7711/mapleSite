import { createHash } from "node:crypto";

export const NORMALIZED_SCHEMA_VERSION = "maple-auction.normalized.v2";
export const NORMALIZER_VERSION = "0.7.2";

const GRADE_MAP = new Map([
  ["레전드리", "legendary"],
  ["유니크", "unique"],
  ["에픽", "epic"],
  ["레어", "rare"],
  ["없음", "none"]
]);

const TIER_BY_RGB = new Map([
  ["rgb(204,255,0)", "legendary"],
  ["rgb(255,204,0)", "unique"],
  ["rgb(183,117,249)", "epic"],
  ["rgb(102,255,255)", "rare"]
]);

const POTENTIAL_CODE_MAP = new Map([
  ["STR", "STR"],
  ["DEX", "DEX"],
  ["INT", "INT"],
  ["LUK", "LUK"],
  ["올스탯", "ALL_STAT"],
  ["최대 HP", "HP"],
  ["최대 MP", "MP"],
  ["공격력", "ATTACK"],
  ["마력", "MAGIC_ATTACK"],
  ["방어력", "DEFENSE"],
  ["데미지", "DAMAGE"],
  ["보스 몬스터 공격 시 데미지", "BOSS_DAMAGE"],
  ["보스 공격 시 데미지", "BOSS_DAMAGE"],
  ["몬스터 방어율 무시", "IGNORE_DEFENSE"],
  ["방어율 무시", "IGNORE_DEFENSE"],
  ["크리티컬 확률", "CRITICAL_RATE"],
  ["크리티컬 데미지", "CRITICAL_DAMAGE"],
  ["아이템 드롭률", "ITEM_DROP_RATE"],
  ["메소 획득량", "MESO_OBTAINED"],
  ["이동속도", "SPEED"],
  ["점프력", "JUMP"],
  ["피격 후 무적시간", "INVINCIBILITY_AFTER_HIT"],
  ["HP 회복 아이템 및 회복 스킬 효율", "HP_RECOVERY_EFFICIENCY"],
  ["MP 회복 아이템 및 회복 스킬 효율", "MP_RECOVERY_EFFICIENCY"],
  ["상태 이상에 걸린 시간", "ABNORMAL_STATUS_DURATION"]
]);

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function parseKoreanPrice(rawPrice) {
  if (!rawPrice) {
    return null;
  }
  const jo = parseBigIntGroup(rawPrice.match(/(\d[\d,]*)조/u)?.[1]);
  const eok = parseBigIntGroup(rawPrice.match(/(\d[\d,]*)억/u)?.[1]);
  const man = parseBigIntGroup(rawPrice.match(/(\d[\d,]*)만/u)?.[1]);
  const remainderText = rawPrice
    .replace(/\d[\d,]*조/u, "")
    .replace(/\d[\d,]*억/u, "")
    .replace(/\d[\d,]*만/u, "")
    .replace(/\s*메소\s*$/u, "")
    .trim();
  const remainder = parseBigIntGroup(remainderText);
  return (jo * 1_000_000_000_000n + eok * 100_000_000n + man * 10_000n + remainder).toString();
}

function parseBigIntGroup(value) {
  const digits = String(value || "").replace(/,/g, "").trim();
  return /^\d+$/u.test(digits) ? BigInt(digits) : 0n;
}

function statKey(code, unit) {
  if (unit === "pct") {
    return `${code}_pct`;
  }
  if (unit === "seconds") {
    return `${code}_seconds`;
  }
  return `${code}_flat`;
}

function addStat(bucket, key, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return;
  }
  bucket[key] = (bucket[key] || 0) + value;
}

function statSource(token) {
  const hint = token?.source_hint || token?.component_hint || "";
  const className = token?.color_class || "";
  const rgb = String(token?.color_rgb || "").replace(/\s+/g, "").toLowerCase();
  // API 응답은 색상 DOM을 거치지 않지만 source_hint를 직접 제공한다.
  // 색상 부재를 base로 해석하기 전에 구조화된 출처를 반드시 우선한다.
  if (["base", "starforce", "scroll", "flame", "other"].includes(hint)) return hint;
  if (/yellow-orange/u.test(`${hint} ${className}`)) return "starforce";
  if (/purple-soft/u.test(`${hint} ${className}`)) return "scroll";
  if (/green-mint/u.test(`${hint} ${className}`)) return "flame";
  if (!className && (!rgb || rgb === "rgb(255,255,255)")) return "base";
  return "other";
}

export function normalizeStats(rawStats, repairChanges = [], qualityWarnings = []) {
  const sources = {
    base: {},
    starforce: {},
    scroll: {},
    flame: {},
    other: {}
  };
  const total = {};
  const validation = [];

  for (const line of rawStats?.lines || []) {
    const key = line.key || statKey(line.code, line.unit);
    total[key] = line.total;
    const tokens = line.breakdown || [];
    if (tokens.length === 0) {
      addStat(sources.base, key, line.total);
      repairChanges.push(`stats.${key}.uncolored_total_assigned_to_base`);
    } else {
      for (const token of tokens) {
        addStat(sources[statSource(token)], key, token.value);
      }
    }

    const componentSum = Object.values(sources)
      .reduce((sum, bucket) => sum + (bucket[key] || 0), 0);
    const matches = componentSum === line.total;
    validation.push({ key, component_sum: componentSum, total: line.total, matches });
    if (!matches) {
      qualityWarnings.push(`stat_component_sum_mismatch:${key}`);
    }
  }

  if ((rawStats?.lines || []).length > 0) {
    repairChanges.push("stats.color_evidence_normalized_to_sources");
  }

  return {
    collected: Boolean(rawStats?.collected ?? (rawStats?.lines || []).length),
    normalized: true,
    base: sources.base,
    starforce: sources.starforce,
    scroll: sources.scroll,
    flame: sources.flame,
    other: sources.other,
    total,
    validation: {
      all_component_sums_match: validation.every((entry) => entry.matches),
      lines: validation
    }
  };
}

function normalizeGrade(raw, existing) {
  if (raw && GRADE_MAP.has(raw)) {
    return GRADE_MAP.get(raw);
  }
  return ["legendary", "unique", "epic", "rare", "none"].includes(existing) ? existing : null;
}

function tierFromLine(line) {
  if (["legendary", "unique", "epic", "rare"].includes(line?.tier)) {
    return line.tier;
  }
  const rgb = String(line?.evidence?.color_rgb || line?.color_rgb || "")
    .replace(/\s+/g, "")
    .toLowerCase();
  return TIER_BY_RGB.get(rgb) || null;
}

export function parsePotentialOption(raw) {
  const normalized = String(raw || "").replace(/\s*:\s*/g, " ").trim();
  let match = normalized.match(/^(\d+)%\s*확률로\s*받은 피해의\s*(\d+)%를\s*반사$/u);
  if (match) {
    return option("DAMAGE_REFLECT", null, null, {
      trigger_chance_pct: Number(match[1]),
      reflected_damage_pct: Number(match[2])
    }, raw);
  }
  match = normalized.match(/^피격 시\s*(\d+)%\s*확률로\s*(\d+)초간\s*무적$/u);
  if (match) {
    return option("INVINCIBLE_ON_HIT", null, null, {
      trigger_chance_pct: Number(match[1]),
      duration_seconds: Number(match[2])
    }, raw);
  }
  match = normalized.match(/^피격 시\s*(\d+)%\s*확률로\s*데미지의\s*(\d+)%\s*무시$/u);
  if (match) {
    return option("DAMAGE_IGNORE_ON_HIT", null, null, {
      trigger_chance_pct: Number(match[1]),
      ignored_damage_pct: Number(match[2])
    }, raw);
  }
  match = normalized.match(/^캐릭터 기준\s*(\d+)\s*레벨\s*당\s*(.+?)\s*([+-]\d+)$/u);
  if (match) {
    return option("STAT_PER_CHARACTER_LEVEL", null, null, {
      levels_per_increment: Number(match[1]),
      stat_code: POTENTIAL_CODE_MAP.get(match[2].trim()) || "UNKNOWN",
      stat_value: Number(match[3])
    }, raw);
  }
  match = normalized.match(
    /^(?:모든\s*스킬의?\s*)?(?:스킬\s+)?재사용\s*대기시간\s*(?:-\s*(\d+)\s*초(?:\s*감소)?|(\d+)\s*초\s*감소)$/u
  );
  if (match) {
    return option("COOLDOWN_REDUCTION", Number(match[1] || match[2]), "seconds", {}, raw);
  }
  match = normalized.match(/^공격\s*시\s*(\d+(?:\.\d+)?)%\s*확률로\s*오토스틸$/u);
  if (match) {
    return option("AUTO_STEAL", Number(match[1]), "pct", {}, raw);
  }
  match = normalized.match(/^<(.+?)>\s*스킬 사용 가능$/u);
  if (match) {
    return option("SKILL_AVAILABLE", null, null, { skill_name: match[1].trim() }, raw);
  }
  match = normalized.match(/^(.+?)\s*스킬(?:의)?\s*레벨\s*([+-]\d+)$/u);
  if (match) {
    return option("SKILL_LEVEL", Number(match[2]), "level", { skill_name: match[1].trim() }, raw);
  }
  match = normalized.match(/^피격 시\s*(\d+)%\s*확률로\s*(\d+)%의\s*(HP|MP)\s*회복$/u);
  if (match) {
    return option(`${match[3]}_RECOVERY_ON_HIT`, null, null, {
      trigger_chance_pct: Number(match[1]),
      recovery_pct: Number(match[2])
    }, raw);
  }
  match = normalized.match(/^공격 시\s*(\d+)%\s*확률로\s*(HP|MP)\s*([+-]?\d+)\s*회복$/u);
  if (match) {
    return option(`${match[2]}_RECOVERY_ON_ATTACK`, Number(match[3]), "flat", {
      trigger_chance_pct: Number(match[1])
    }, raw);
  }
  match = normalized.match(/^(.+?)\s*([+-]\d+)\s*(%|초)?$/u);
  if (match) {
    const label = match[1].trim();
    return option(
      POTENTIAL_CODE_MAP.get(label) || "UNKNOWN",
      Number(match[2]),
      match[3] === "%" ? "pct" : match[3] === "초" ? "seconds" : "flat",
      {},
      raw
    );
  }
  return option("UNKNOWN", null, null, {}, raw);
}

function option(code, value, unit, params, raw) {
  return { code, value, unit, params, raw: raw || null };
}

export function normalizePotential(section, repairChanges = [], options = {}) {
  const grade = normalizeGrade(section?.grade_raw, section?.grade);
  if (grade === "none") {
    if ((section?.lines || []).length > 0) {
      repairChanges.push("additional_potential.none_lines_removed");
    }
    return { collected: true, grade: "none", lines: [] };
  }

  const lines = (section?.lines || []).slice(0, 3).map((line, index) => {
    const parsed = parsePotentialOption(line.raw);
    const structuredCode = typeof line?.code === "string" && line.code.trim()
      ? line.code.trim()
      : null;
    // API tooltip rows already contain the site's structured option code and
    // parameters.  Older DOM/raw inputs may also contain a `code`, but those
    // values were parser output and must still be checked against `raw`.
    const preserveStructured = options.preferStructured === true &&
      section?.grade_source === "api_tooltip" &&
      structuredCode && structuredCode !== "UNKNOWN";
    const tier = tierFromLine(line);
    return {
      line_index: index + 1,
      code: preserveStructured ? structuredCode : parsed.code,
      value: preserveStructured && Object.prototype.hasOwnProperty.call(line, "value")
        ? line.value
        : parsed.value,
      unit: preserveStructured && Object.prototype.hasOwnProperty.call(line, "unit")
        ? line.unit
        : parsed.unit,
      tier,
      is_prime: grade && tier ? grade === tier : null,
      params: preserveStructured && line.params && typeof line.params === "object" && !Array.isArray(line.params)
        ? { ...line.params }
        : parsed.params,
      raw: parsed.raw
    };
  });
  if (lines.some((line) => line.tier)) {
    repairChanges.push("potential.rgb_normalized_to_tier");
  }
  return {
    collected: Boolean(section?.collected),
    grade,
    lines
  };
}

function recoverTrade(record, repairChanges, qualityWarnings) {
  const trade = { ...(record.item?.trade || {}) };
  const evidence = [
    trade.raw,
    record.raw?.tooltip?.trade,
    ...(record.item?.additional_potential?.lines || []).map((line) => line.raw)
  ].find((raw) => /가위 사용 잔여 횟수/u.test(raw || ""));
  const match = evidence?.match(/가위 사용 잔여 횟수\s*:\s*(\d+)\s*\/\s*(\d+)/u);
  if (match) {
    trade.scissors_remaining = Number(match[1]);
    trade.scissors_total = Number(match[2]);
    trade.raw = evidence;
    repairChanges.push("trade.scissors_recovered_from_raw_evidence");
  } else if (trade.scissors_remaining == null || trade.scissors_total == null) {
    trade.scissors_remaining = null;
    trade.scissors_total = null;
    qualityWarnings.push("scissors_count_not_recoverable; null_preserved");
  }
  if (trade.state === "tradeable") {
    trade.state = "tradable";
    repairChanges.push("trade.state_spelling_normalized");
  }
  return trade;
}

function normalizeV1SearchContext(record) {
  const source = record.search_context || {};
  return {
    page_kind: source.page_kind || null,
    keyword: source.keyword || null,
    sort: source.sort || null,
    page: source.page || null,
    limit: source.limit || null,
    only_current_world: null,
    filters: {
      normalized_from_v1: true
    },
    raw_filters: source.filters || {}
  };
}

function baseCaptureFromV1(record) {
  return {
    batch_id: record.capture_batch_id || null,
    captured_at: record.captured_at || null,
    source_schema_version: record.schema_version || null,
    source_extension_version: record.extension_version || null,
    source_site: "https://auction.maplestory.nexon.com",
    source_path: record.search_context?.source_path || null,
    viewer_world: null,
    auction_group: record.auction_group ?? null,
    search_context: normalizeV1SearchContext(record)
  };
}

function catalogIdentity(name, iconAssetKey) {
  return iconAssetKey ? `name_icon_sha256:${sha256(`${name}\n${iconAssetKey}`)}` : null;
}

function nativeSource(source) {
  return typeof source === "string" && /^(?:dom_attribute|url_parameter|native)/u.test(source);
}

export function migrateV1Record(record, index = 0, catalog = null) {
  if (record?.schema_version !== "maple-auction.raw.v1") {
    throw new Error(`지원하지 않는 v1 레코드입니다: ${record?.schema_version || "missing"}`);
  }

  const repairChanges = [];
  const qualityWarnings = [];
  const rowIndex = Number(record.raw?.listing_row?.sequence) || index + 1;
  const batchId = record.capture_batch_id || "unknown-batch";
  const baseName = record.item?.base_name || String(record.item?.name || "").replace(/\s*\(\+?\d+\)\s*$/u, "");
  const iconAssetKey = record.item?.icon_asset_key || null;
  const catalogKey = catalogIdentity(baseName, iconAssetKey);
  const catalogItem = catalogKey && catalog ? catalog[catalogKey] || null : null;
  const requiredLevel = record.item?.level ?? record.item?.required_level ?? null;
  const baseLevel = catalogItem?.base_level ?? null;
  const requiredLevelReduction = baseLevel != null && requiredLevel != null && baseLevel >= requiredLevel
    ? baseLevel - requiredLevel
    : null;
  if (baseLevel == null) {
    qualityWarnings.push("base_level_unavailable; catalog_join_required");
  }
  repairChanges.push("item.level_split_into_base_and_required");

  let starforce;
  const repairedStarforce = record.data_repair?.changes?.includes("item.starforce_null_to_zero");
  if (record.item?.starforce == null) {
    starforce = { value: null, applicable: null, source: "unknown", confidence: "unknown" };
    qualityWarnings.push("starforce_unavailable; null_preserved");
  } else if (repairedStarforce) {
    starforce = {
      value: record.item.starforce,
      applicable: true,
      source: "repaired",
      confidence: "inferred"
    };
    qualityWarnings.push("starforce_was_repaired_by_legacy_process");
  } else {
    starforce = {
      value: record.item.starforce,
      applicable: true,
      source: "dom",
      confidence: "confirmed"
    };
  }

  const originalListingId = record.listing?.listing_id || null;
  const originalListingSource = record.listing?.listing_id_source || null;
  const listingIsNative = nativeSource(originalListingSource);
  const listingFingerprint = originalListingSource === "derived_fingerprint"
    ? originalListingId?.replace(/^derived_sha256:/u, "sha256:") || null
    : `sha256:${sha256(JSON.stringify({
      status: record.listing?.status,
      price_meso: record.listing?.price_meso,
      sold_at: record.listing?.sold_at,
      item_name: baseName,
      stats: record.item?.stats?.lines?.map((line) => line.raw),
      potential: record.item?.potential?.lines?.map((line) => line.raw),
      additional: record.item?.additional_potential?.lines?.map((line) => line.raw)
    }))}`;
  if (!listingIsNative) {
    repairChanges.push("listing.derived_id_moved_to_fingerprint");
    qualityWarnings.push("listing_fingerprint_not_global_deduplication_id");
  }

  const stats = normalizeStats(record.item?.stats, repairChanges, qualityWarnings);
  const potential = normalizePotential(record.item?.potential, repairChanges);
  const additionalPotential = normalizePotential(record.item?.additional_potential, repairChanges);
  const trade = recoverTrade(record, repairChanges, qualityWarnings);

  return {
    schema_version: NORMALIZED_SCHEMA_VERSION,
    normalizer_version: NORMALIZER_VERSION,
    source: {
      schema_version: record.schema_version,
      extension_version: record.extension_version || null,
      batch_id: record.capture_batch_id || null,
      row_index: rowIndex
    },
    capture: baseCaptureFromV1(record),
    observation_id: `${batchId}:${rowIndex}`,
    row_index: rowIndex,
    matched_preset_ids: [],
    selection_channels: [],
    listing: {
      listing_id: listingIsNative ? originalListingId : null,
      listing_id_source: listingIsNative ? "native" : "unavailable",
      listing_id_collision_risk: false,
      listing_fingerprint: listingFingerprint,
      listing_fingerprint_collision_risk: true,
      status: record.listing?.status || "unknown",
      price_meso: record.listing?.price_meso || null,
      quantity: record.listing?.quantity ?? 1,
      sold_at: record.listing?.sold_at || null,
      sold_at_precision: record.listing?.sold_at_precision || null,
      expires_at: record.listing?.expires_at || null,
      listing_world: null,
      is_cross_world: null
    },
    item: {
      item_id: record.item?.item_id || null,
      item_id_source: record.item?.item_id
        ? "native"
        : iconAssetKey ? "icon_asset_key" : "unavailable",
      catalog_key: catalogKey,
      name: baseName || null,
      icon_asset_key: iconAssetKey,
      starforce_preset_id: record.item?.starforce_preset_id || null,
      category: record.item?.category || null,
      category_path: record.item?.category_path || [],
      base_level: baseLevel,
      required_level: requiredLevel,
      required_level_reduction: requiredLevelReduction,
      required_job: record.item?.required_job || null,
      set_name: record.item?.set_name || null,
      starforce,
      upgrade: record.item?.upgrade || null,
      trade,
      stats,
      potential,
      additional_potential: additionalPotential
    },
    repair_changes: Array.from(new Set(repairChanges)).sort(),
    quality_warnings: Array.from(new Set(qualityWarnings)).sort(),
    source_evidence: {
      display_name: record.item?.display_name || record.item?.name || null,
      price_raw: record.listing?.price_raw || record.raw?.listing_row?.price || null,
      icon_url: record.item?.icon_url || null,
      combat_power_change: record.item?.combat_power_change || null,
      potential_grade_raw: record.item?.potential?.grade_raw || null,
      additional_potential_grade_raw: record.item?.additional_potential?.grade_raw || null
    }
  };
}

export function migrateV1Batch(records, catalog = null) {
  return records.map((record, index) => migrateV1Record(record, index, catalog));
}

function normalizeCapturedStarforce(starforce, captureDocument, repairChanges, qualityWarnings) {
  const current = starforce && typeof starforce === "object"
    ? { ...starforce }
    : { value: null, source: "unknown", confidence: "unknown" };
  if (typeof current.applicable !== "boolean") {
    current.applicable = current.value != null ? true : null;
  }
  if (current.value != null || current.applicable === false) {
    return current;
  }

  const searchContext = captureDocument.capture?.search_context;
  const enhancement = searchContext?.filters?.enhancement;
  const queryTask = captureDocument.capture?.query_task;
  const exactZeroFilter = searchContext?.filter_search_applied === true &&
    enhancement?.starforce_min === 0 && enhancement?.starforce_max === 0 &&
    queryTask?.starforce_min === 0 && queryTask?.starforce_max === 0;
  if (!exactZeroFilter) {
    return current;
  }

  repairChanges.push("item.starforce_null_to_zero_from_verified_filter");
  qualityWarnings.push("starforce_zero_inferred_from_exact_filter");
  return {
    value: 0,
    applicable: true,
    source: "query_filter",
    confidence: "inferred"
  };
}

export function normalizeCaptureV2(captureDocument, catalog = null) {
  if (captureDocument?.schema_version !== "maple-auction.capture.v2") {
    throw new Error(`지원하지 않는 캡처 문서입니다: ${captureDocument?.schema_version || "missing"}`);
  }
  return (captureDocument.items || []).map((entry, index) => {
    const repairChanges = [];
    let qualityWarnings = [...(captureDocument.capture?.quality_warnings || []), ...(entry.quality_warnings || [])];
    const catalogItem = entry.item?.catalog_key && catalog ? catalog[entry.item.catalog_key] || null : null;
    const baseLevel = entry.item?.base_level ?? catalogItem?.base_level ?? null;
    const requiredLevel = entry.item?.required_level ?? null;
    const reduction = baseLevel != null && requiredLevel != null && baseLevel >= requiredLevel
      ? baseLevel - requiredLevel
      : null;
    if (baseLevel == null) {
      qualityWarnings.push("base_level_unavailable; catalog_join_required");
    }
    const starforce = normalizeCapturedStarforce(
      entry.item?.starforce,
      captureDocument,
      repairChanges,
      qualityWarnings
    );
    if (starforce.value != null || starforce.applicable === false) {
      qualityWarnings = qualityWarnings.filter((warning) =>
        !String(warning).startsWith("starforce_not_confirmed")
      );
    }
    return {
      schema_version: NORMALIZED_SCHEMA_VERSION,
      normalizer_version: NORMALIZER_VERSION,
      source: {
        schema_version: captureDocument.schema_version,
        extension_version: captureDocument.capture?.extension_version || null,
        batch_id: captureDocument.capture?.batch_id || null,
        row_index: entry.row_index || index + 1
      },
      capture: { ...captureDocument.capture },
      observation_id: entry.observation_id,
      row_index: entry.row_index || index + 1,
      matched_preset_ids: Array.from(new Set(entry.matched_preset_ids || [])).sort(),
      selection_channels: Array.from(new Set(entry.selection_channels || [])).sort(),
      listing: { ...entry.listing },
      item: {
        ...entry.item,
        base_level: baseLevel,
        required_level: requiredLevel,
        required_level_reduction: reduction,
        starforce,
        stats: normalizeStats(entry.item?.stats, repairChanges, qualityWarnings),
        potential: normalizePotential(entry.item?.potential, repairChanges, {
          preferStructured: captureDocument.capture?.collection_transport === "tooltip_api"
        }),
        additional_potential: normalizePotential(entry.item?.additional_potential, repairChanges, {
          preferStructured: captureDocument.capture?.collection_transport === "tooltip_api"
        })
      },
      repair_changes: Array.from(new Set(repairChanges)).sort(),
      quality_warnings: Array.from(new Set(qualityWarnings)).sort()
    };
  });
}

export function parseInput(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("입력 파일이 비어 있습니다.");
  }
  if (trimmed.startsWith("{")) {
    try {
      const document = JSON.parse(trimmed);
      if (document.schema_version === "maple-auction.capture.v2") {
        return { kind: "capture.v2", value: document };
      }
    } catch (_error) {
      // 단일 JSON 파싱 실패 시 JSONL로 다시 시도합니다.
    }
  }
  const records = trimmed.split(/\r?\n/u).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${index + 1}행 JSON 오류: ${error.message}`);
    }
  });
  if (records.every((record) => record.schema_version === "maple-auction.raw.v1")) {
    return { kind: "raw.v1", value: records };
  }
  if (records.every((record) => record.schema_version === "maple-auction.capture.v2")) {
    return { kind: "capture.v2.jsonl", value: records };
  }
  throw new Error("지원하는 maple-auction.raw.v1 또는 maple-auction.capture.v2 파일이 아닙니다.");
}

export function normalizeParsedInput(parsed, catalog = null) {
  if (parsed.kind === "raw.v1") {
    return migrateV1Batch(parsed.value, catalog);
  }
  if (parsed.kind === "capture.v2.jsonl") {
    return parsed.value.flatMap((document) => normalizeCaptureV2(document, catalog));
  }
  return normalizeCaptureV2(parsed.value, catalog);
}
