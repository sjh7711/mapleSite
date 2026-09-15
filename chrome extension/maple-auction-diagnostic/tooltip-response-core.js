/*
 * Browser-safe converter for the auction /tool-tip response.
 *
 * Production API payloads contain hook-provided source_hashes instead of raw
 * listing/item identifiers. Those trusted SHA-256 values are copied directly
 * (never hashed again). Callers converting an unredacted response locally may
 * instead supply hashId(material, purpose), an async SHA-256 callback. Without
 * one, Web Crypto is used. canonicalIdMaterial() is exposed for those local
 * conversion/CLI callers only.
 */
(function tooltipResponseCoreUmd(root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MapleAuctionTooltipResponseCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function tooltipResponseCoreFactory(root) {
  "use strict";

  // Grade 0 means that an option line has no published tier.  It is distinct
  // from a whole potential section being explicitly empty (grade: "none").
  var GRADE_BY_API_VALUE = { 1: "rare", 2: "epic", 3: "unique", 4: "legendary" };
  var GRADE_BY_KOREAN = { "레전드리": "legendary", "유니크": "unique", "에픽": "epic", "레어": "rare", "없음": "none" };
  var KOREAN_GRADE_BY_VALUE = { 0: "없음", 1: "레어", 2: "에픽", 3: "유니크", 4: "레전드리" };
  var STAT_DEFINITIONS = {
    str: ["str", "STR", "flat"], dex: ["dex", "DEX", "flat"], int: ["int", "INT", "flat"], luk: ["luk", "LUK", "flat"],
    all: ["all_stat", "올스탯", "pct"], mhp: ["hp", "최대 HP", "flat"], mmp: ["mp", "최대 MP", "flat"],
    pad: ["attack", "공격력", "flat"], mad: ["magic_attack", "마력", "flat"], pdd: ["defense", "방어력", "flat"],
    speed: ["speed", "이동속도", "flat"], jump: ["jump", "점프력", "flat"], dam: ["damage", "데미지", "pct"],
    bdr: ["boss_damage", "보스 몬스터 공격 시 데미지", "pct"], imdr: ["ignore_defense", "몬스터 방어율 무시", "pct"],
    arc: ["arcane_force", "아케인포스", "flat"], aut: ["authentic_force", "어센틱포스", "flat"],
    hpr: ["hp_recovery", "HP 회복력", "flat"], mpr: ["mp_recovery", "MP 회복력", "flat"],
    addExpr: ["additional_exp", "추가 경험치", "flat"], expRate: ["exp", "경험치 획득량", "pct"],
    srExpRate: ["special_ring_exp", "경험치 획득량", "pct"], srMesoRate: ["special_ring_meso", "메소 획득량", "pct"],
    srDropRate: ["special_ring_drop", "아이템 드롭률", "pct"], pqExpRate: ["party_quest_exp", "파티 퀘스트 경험치", "pct"],
    craft: ["craft", "장비 제작 숙련도", "flat"]
  };
  var POTENTIAL_CODES = {
    "STR": "STR", "DEX": "DEX", "INT": "INT", "LUK": "LUK", "올스탯": "ALL_STAT", "최대 HP": "HP", "최대 MP": "MP",
    "공격력": "ATTACK", "마력": "MAGIC_ATTACK", "방어력": "DEFENSE", "데미지": "DAMAGE",
    "보스 몬스터 공격 시 데미지": "BOSS_DAMAGE", "보스 공격 시 데미지": "BOSS_DAMAGE", "몬스터 방어율 무시": "IGNORE_DEFENSE",
    "방어율 무시": "IGNORE_DEFENSE", "크리티컬 확률": "CRITICAL_RATE", "크리티컬 데미지": "CRITICAL_DAMAGE",
    "아이템 드롭률": "ITEM_DROP_RATE", "메소 획득량": "MESO_OBTAINED", "HP 회복 아이템 및 회복 스킬 효율": "HP_RECOVERY_EFFICIENCY",
    "MP 회복 아이템 및 회복 스킬 효율": "MP_RECOVERY_EFFICIENCY", "상태 이상에 걸린 시간": "ABNORMAL_STATUS_DURATION",
    "이동속도": "SPEED", "점프력": "JUMP", "피격 후 무적시간": "INVINCIBILITY_AFTER_HIT"
  };

  function invariant(condition, message) {
    if (!condition) throw new TypeError("Invalid tooltip response: " + message);
  }

  function integer(value) {
    return Number.isInteger(value) ? value : null;
  }

  function nonNegativeInteger(value) {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }

  function decimalMeso(value) {
    if (typeof value === "string" && /^\d+$/u.test(value)) return value;
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
    return null;
  }

  function cleanText(value) {
    return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
  }

  function canonicalIdMaterial(rawItem) {
    invariant(rawItem && typeof rawItem === "object", "item must be an object");
    return Object.freeze({
      listing: typeof rawItem._id === "string" && rawItem._id ? "auction-tooltip-listing-v1\\n" + rawItem._id : null,
      item: typeof rawItem.encryptedItemId === "string" && rawItem.encryptedItemId
        ? "auction-tooltip-item-v1\\n" + rawItem.encryptedItemId : null,
      catalog: cleanText(rawItem.itemName) && iconAssetKey(rawItem.itemIcon)
        ? "auction-tooltip-catalog-v1\\n" + cleanText(rawItem.itemName) + "\\n" + iconAssetKey(rawItem.itemIcon) : null
    });
  }

  function trustedSourceHash(rawItem, name) {
    var hashes = rawItem && rawItem.source_hashes;
    if (!hashes || typeof hashes !== "object" || !Object.prototype.hasOwnProperty.call(hashes, name)) return null;
    var value = hashes[name];
    invariant(
      typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value),
      "source_hashes." + name + " must be a sha256:<64 lowercase hex> value"
    );
    return value;
  }

  function iconAssetKey(icon) {
    var value = icon && typeof icon === "object" ? icon.fallBackUrl : null;
    if (typeof value !== "string") return null;
    var match = value.match(/\/([^/?#]+)\.[A-Za-z0-9]+(?:[?#]|$)/u);
    return match ? match[1] : null;
  }

  function sanitizeRequestUrl(value) {
    if (!value) return null;
    try {
      var url = new URL(String(value), "https://auction.maplestory.nexon.com");
      var safe = new URLSearchParams();
      ["page", "limit", "sortType"].forEach(function (name) {
        var candidate = url.searchParams.get(name);
        if (candidate != null && candidate !== "") safe.set(name, candidate);
      });
      var safePath = url.pathname.replace(
        /^(\/v1\/market\/web\/items\/searches\/sold)\/[0-9a-f-]+\/(tool-tip)\/?$/iu,
        "$1/$2"
      );
      return safePath + (safe.toString() ? "?" + safe.toString() : "");
    } catch (_error) {
      return null;
    }
  }

  function requestMetadata(requestUrl) {
    if (!requestUrl) return { source_path: "/tool-tip", page: null, limit: null, sort: null, sanitized_request_url: null };
    var sanitized = sanitizeRequestUrl(requestUrl);
    if (!sanitized) throw new TypeError("Invalid tooltip response: request URL is invalid");
    var url = new URL(sanitized, "https://auction.maplestory.nexon.com");
    return {
      source_path: url.pathname,
      page: parsePositiveInteger(url.searchParams.get("page")),
      limit: parsePositiveInteger(url.searchParams.get("limit")),
      sort: normalizeSort(url.searchParams.get("sortType")),
      sanitized_request_url: sanitized
    };
  }

  function parsePositiveInteger(value) {
    if (value == null || !/^\d+$/u.test(value)) return null;
    var result = Number(value);
    return Number.isSafeInteger(result) && result > 0 ? result : null;
  }

  function normalizeSort(value) {
    if (value === "TRADE_DATE_DESC") return "trade_date_desc";
    if (value === "PRICE_PER_ITEM_ASC") return "price_per_item_asc";
    return null;
  }

  function validateSoldTooltipResponse(response, options) {
    options = options || {};
    invariant(response && typeof response === "object", "response must be an object");
    invariant(Array.isArray(response.items), "items must be an array");
    var page = parsePositiveInteger(String(response.page));
    var limit = parsePositiveInteger(String(response.limit));
    invariant(page !== null, "page must be a positive integer");
    invariant(limit !== null, "limit must be a positive integer");
    if (options.expectedPage != null) invariant(page === options.expectedPage, "page does not match expectedPage");
    if (options.expectedLimit != null) invariant(limit === options.expectedLimit, "limit does not match expectedLimit");
    var request = requestMetadata(options.requestUrl);
    if (request.page != null) invariant(request.page === page, "request URL page does not match response page");
    if (request.limit != null) invariant(request.limit === limit, "request URL limit does not match response limit");
    response.items.forEach(function (item, index) {
      invariant(item && typeof item === "object", "items[" + index + "] must be an object");
      invariant(item.status === "SOLD", "items[" + index + "] is not SOLD");
      invariant(decimalMeso(item.price) !== null, "items[" + index + "].price must be a safe non-negative integer or decimal string");
    });
    return Object.freeze({
      page: page,
      limit: limit,
      total: nonNegativeInteger(response.total),
      total_pages: parsePositiveInteger(String(response.totalPages)),
      has_next_page: typeof response.hasNext === "boolean" ? response.hasNext : null,
      page_item_count: response.items.length,
      request: request
    });
  }

  async function defaultHash(material) {
    var subtle = root && root.crypto && root.crypto.subtle;
    if (!subtle || typeof TextEncoder === "undefined") {
      throw new Error("Web Crypto is unavailable; pass options.hashId(material, purpose)");
    }
    var digest = await subtle.digest("SHA-256", new TextEncoder().encode(material));
    return Array.prototype.map.call(new Uint8Array(digest), function (byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");
  }

  async function hashCanonical(material, purpose, hashId) {
    if (material == null) return null;
    var digest = await (hashId ? hashId(material, purpose) : defaultHash(material));
    digest = String(digest || "").replace(/^sha256:/iu, "").toLowerCase();
    invariant(/^[0-9a-f]{64}$/u.test(digest), "hashId must resolve to a 64-character hexadecimal SHA-256 digest");
    return digest;
  }

  function gradeFromInfo(info) {
    if (!info || typeof info !== "object") return { grade: null, grade_raw: null };
    var raw = cleanText(info.description).match(/:\s*(레전드리|유니크|에픽|레어|없음)\s*$/u);
    var gradeRaw = raw ? raw[1] : Object.prototype.hasOwnProperty.call(KOREAN_GRADE_BY_VALUE, info.grade) ? KOREAN_GRADE_BY_VALUE[info.grade] : null;
    return { grade: gradeRaw ? GRADE_BY_KOREAN[gradeRaw] : null, grade_raw: gradeRaw };
  }

  function potentialTier(apiGrade) {
    return Object.prototype.hasOwnProperty.call(GRADE_BY_API_VALUE, apiGrade) ? GRADE_BY_API_VALUE[apiGrade] : null;
  }

  function parsePotentialLine(raw) {
    raw = cleanText(raw);
    var normalized = raw.replace(/\s*:\s*/gu, " ");
    var match;
    match = normalized.match(/^(\d+)%\s*확률로\s*받은 피해의\s*(\d+)%를\s*반사$/u);
    if (match) return potentialResult("DAMAGE_REFLECT", null, null, { trigger_chance_pct: Number(match[1]), reflected_damage_pct: Number(match[2]) }, raw);
    match = normalized.match(/^피격 시\s*(\d+)%\s*확률로\s*(\d+)초간\s*무적$/u);
    if (match) return potentialResult("INVINCIBLE_ON_HIT", null, null, { trigger_chance_pct: Number(match[1]), duration_seconds: Number(match[2]) }, raw);
    match = normalized.match(/^피격 시\s*(\d+)%\s*확률로\s*데미지의\s*(\d+)%\s*무시$/u);
    if (match) return potentialResult("DAMAGE_IGNORE_ON_HIT", null, null, { trigger_chance_pct: Number(match[1]), ignored_damage_pct: Number(match[2]) }, raw);
    match = normalized.match(/^캐릭터 기준\s*(\d+)\s*레벨\s*당\s*(.+?)\s*([+-]\d+)$/u);
    if (match) return potentialResult("STAT_PER_CHARACTER_LEVEL", null, null, { levels_per_increment: Number(match[1]), stat_code: POTENTIAL_CODES[cleanText(match[2])] || "UNKNOWN", stat_value: Number(match[3]) }, raw);
    match = normalized.match(/^(?:(?:모든\s*스킬의?|스킬)\s*)?재사용\s*대기시간\s*(?:-\s*(\d+)\s*초(?:\s*감소)?|(\d+)\s*초\s*감소)$/u);
    if (match) return potentialResult("COOLDOWN_REDUCTION", Number(match[1] || match[2]), "seconds", {}, raw);
    match = normalized.match(/^공격\s*시\s*(\d+(?:\.\d+)?)%\s*확률로\s*오토스틸$/u);
    if (match) return potentialResult("AUTO_STEAL", Number(match[1]), "pct", {}, raw);
    match = normalized.match(/^<(.+?)>\s*스킬 사용 가능$/u);
    if (match) return potentialResult("SKILL_AVAILABLE", null, null, { skill_name: cleanText(match[1]) }, raw);
    match = normalized.match(/^(.+?)\s*스킬(?:의)?\s*레벨\s*([+-]\d+)$/u);
    if (match) return potentialResult("SKILL_LEVEL", Number(match[2]), "level", { skill_name: cleanText(match[1]) }, raw);
    match = normalized.match(/^피격 시\s*(\d+)%\s*확률로\s*(\d+)%의\s*(HP|MP)\s*회복$/u);
    if (match) return potentialResult(match[3] + "_RECOVERY_ON_HIT", null, null, { trigger_chance_pct: Number(match[1]), recovery_pct: Number(match[2]) }, raw);
    match = normalized.match(/^공격 시\s*(\d+)%\s*확률로\s*(HP|MP)\s*([+-]?\d+)\s*회복$/u);
    if (match) return potentialResult(match[2] + "_RECOVERY_ON_ATTACK", Number(match[3]), "flat", { trigger_chance_pct: Number(match[1]) }, raw);
    match = normalized.match(/^(.+?)\s*([+-]\d+)\s*(%|초)?$/u);
    if (!match) return potentialResult("UNKNOWN", null, null, {}, raw);
    return potentialResult(POTENTIAL_CODES[cleanText(match[1])] || "UNKNOWN", Number(match[2]), match[3] === "%" ? "pct" : match[3] === "초" ? "seconds" : "flat", {}, raw);
  }

  function potentialResult(code, value, unit, params, raw) {
    return { code: code, value: value, unit: unit, params: params, raw: raw };
  }

  function convertPotential(info) {
    var gradeInfo = gradeFromInfo(info);
    if (!info || typeof info !== "object") return { collected: false, grade: null, grade_raw: null, grade_source: null, lines: [], raw_heading: null };
    var entries = Array.isArray(info.entries) ? info.entries : [];
    var grade = gradeInfo.grade || (entries.length === 0 && info.grade === 0 ? "none" : null);
    return {
      collected: true,
      grade: grade,
      grade_raw: gradeInfo.grade_raw || (grade === "none" ? "없음" : null),
      grade_source: "api_tooltip",
      lines: entries.slice(0, 3).map(function (entry, index) {
        var tier = potentialTier(entry && entry.grade);
        var parsed = parsePotentialLine(entry && entry.text);
        parsed.line_index = index + 1;
        parsed.tier = tier;
        parsed.is_prime = grade && tier ? grade === tier : null;
        parsed.evidence = { api_line_grade: integer(entry && entry.grade) };
        return parsed;
      }),
      raw_heading: cleanText(info.description) || null
    };
  }

  function statKey(definition) {
    return definition[0] + "_" + definition[2];
  }

  function statObject(source) {
    var output = {};
    Object.keys(STAT_DEFINITIONS).forEach(function (apiKey) {
      var value = source && source[apiKey];
      if (typeof value === "number" && Number.isFinite(value) && value !== 0) output[statKey(STAT_DEFINITIONS[apiKey])] = value;
    });
    return output;
  }

  function sourceEntries(sources, statKeyName) {
    var entries = [];
    Object.keys(sources).forEach(function (sourceName) {
      if (Object.prototype.hasOwnProperty.call(sources[sourceName], statKeyName)) {
        var definition = STAT_DEFINITIONS[Object.keys(STAT_DEFINITIONS).filter(function (key) { return statKey(STAT_DEFINITIONS[key]) === statKeyName; })[0]];
        entries.push({ value: sources[sourceName][statKeyName], unit: definition[2], source_hint: sourceName });
      }
    });
    return entries;
  }

  function convertStats(tooltip) {
    var sources = {
      base: statObject(tooltip && tooltip.baseStat),
      starforce: statObject(tooltip && tooltip.starforceStat),
      scroll: statObject(tooltip && tooltip.upgradeStat),
      flame: statObject(tooltip && tooltip.exOptionStat),
      other: statObject(tooltip && tooltip.timeLimitedStat)
    };
    var total = statObject(tooltip && tooltip.stat);
    var allKeys = {};
    Object.keys(total).forEach(function (key) { allKeys[key] = true; });
    Object.keys(sources).forEach(function (sourceName) { Object.keys(sources[sourceName]).forEach(function (key) { allKeys[key] = true; }); });
    var lines = Object.keys(allKeys).map(function (key) {
      var apiKey = Object.keys(STAT_DEFINITIONS).filter(function (candidate) { return statKey(STAT_DEFINITIONS[candidate]) === key; })[0];
      var definition = STAT_DEFINITIONS[apiKey];
      var breakdown = sourceEntries(sources, key);
      var componentSum = breakdown.reduce(function (sum, entry) { return sum + entry.value; }, 0);
      var value = Object.prototype.hasOwnProperty.call(total, key) ? total[key] : null;
      return {
        code: definition[0], key: key, label: definition[1], total: value, unit: definition[2], breakdown: breakdown,
        component_sum_matches_total: value == null || breakdown.length === 0 ? null : componentSum === value,
        raw: definition[1] + " " + (value == null ? "" : (value >= 0 ? "+" : "") + value)
      };
    });
    return { collected: Boolean(tooltip && tooltip.stat), normalized: false, base: sources.base, starforce: sources.starforce, scroll: sources.scroll, flame: sources.flame, other: sources.other, total: total, lines: lines };
  }

  function convertStarforce(rawItem, tooltip) {
    var value = nonNegativeInteger(tooltip && tooltip.starforce);
    if (value === null) value = nonNegativeInteger(rawItem && rawItem.starforce);
    var info = tooltip && tooltip.upgradeInfo && tooltip.upgradeInfo.starForce;
    var applicable = info && typeof info.canUpgrade === "boolean" ? info.canUpgrade : nonNegativeInteger(tooltip && tooltip.starforceMax) !== null ? tooltip.starforceMax > 0 : null;
    return { value: value, applicable: applicable, source: value === null ? "unknown" : "api_response", confidence: value === null ? "unknown" : "confirmed" };
  }

  function convertUpgrade(tooltip) {
    var scroll = tooltip && tooltip.upgradeInfo && tooltip.upgradeInfo.scroll;
    if (!scroll || typeof scroll !== "object") return { collected: false, applied: null, remaining: null, recoverable: null, failure: null, max: null, scroll_type: null, raw: null };
    return {
      collected: true, applied: nonNegativeInteger(scroll.current), remaining: nonNegativeInteger(scroll.remaining),
      recoverable: nonNegativeInteger(scroll.failure), failure: nonNegativeInteger(scroll.failure), max: nonNegativeInteger(scroll.max),
      scroll_type: null, raw: cleanText(scroll.description) || null
    };
  }

  function convertTrade(tooltip) {
    var lines = Array.isArray(tooltip && tooltip.tradeDesc) ? tooltip.tradeDesc.map(cleanText).filter(Boolean) : [];
    var raw = lines.join(" | ") || null;
    var state = raw && /1회 교환 가능/u.test(raw) ? "one_trade_left" : raw && /장착 시 교환 불가/u.test(raw) ? "untradeable_after_equip" : raw && /교환 불가/u.test(raw) ? "untradeable" : raw && /교환 가능/u.test(raw) ? "tradeable" : null;
    var scissors = raw && raw.match(/가위 사용 잔여 횟수\s*:\s*(\d+)\s*\/\s*(\d+)/u);
    return { collected: Boolean(raw), state: state, scissors_remaining: scissors ? Number(scissors[1]) : null, scissors_total: scissors ? Number(scissors[2]) : null, raw: raw };
  }

  function setNameFromTooltip(tooltip) {
    var setInfo = tooltip && tooltip.setItemInfo;
    return cleanText(setInfo && (setInfo.setItemName || setInfo.name)) ||
      cleanText(tooltip && tooltip.setItemName) ||
      (Array.isArray(tooltip && tooltip.setEffects) ? cleanText(tooltip.setEffects[0]) : "") || null;
  }

  function validIso(value) {
    return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : null;
  }

  async function convertSoldTooltipItem(rawItem, options) {
    options = options || {};
    invariant(rawItem && typeof rawItem === "object", "item must be an object");
    invariant(rawItem.status === "SOLD", "item is not SOLD");
    var priceMeso = decimalMeso(rawItem.price);
    invariant(priceMeso !== null, "item price must be a safe non-negative integer or decimal string");
    var tooltip = rawItem.toolTip && typeof rawItem.toolTip === "object" ? rawItem.toolTip : {};
    var rowIndex = options.rowIndex == null ? 1 : options.rowIndex;
    invariant(Number.isInteger(rowIndex) && rowIndex > 0, "rowIndex must be a positive integer");
    var material = canonicalIdMaterial(rawItem);
    var trustedListingHash = trustedSourceHash(rawItem, "listing");
    var trustedItemHash = trustedSourceHash(rawItem, "item");
    var fingerprintMaterial = "auction-tooltip-fingerprint-v1\\n" + JSON.stringify({ name: cleanText(rawItem.itemName), price_meso: priceMeso, quantity: nonNegativeInteger(rawItem.quantity) || 1, sold_at: validIso(rawItem.tradeDate), starforce: nonNegativeInteger(tooltip.starforce), stats: tooltip.stat || {}, potential: tooltip.upgradeInfo && tooltip.upgradeInfo.potential && tooltip.upgradeInfo.potential.entries || [], additional_potential: tooltip.upgradeInfo && tooltip.upgradeInfo.additionalPotential && tooltip.upgradeInfo.additionalPotential.entries || [] });
    var digests = await Promise.all([
      trustedListingHash ? null : hashCanonical(material.listing, "listing_id", options.hashId),
      trustedItemHash ? null : hashCanonical(material.item, "item_id", options.hashId),
      hashCanonical(material.catalog, "catalog_key", options.hashId), hashCanonical(fingerprintMaterial, "listing_fingerprint", options.hashId)
    ]);
    var listingHash = trustedListingHash || (digests[0] ? "sha256:" + digests[0] : null);
    var itemHash = trustedItemHash || (digests[1] ? "sha256:" + digests[1] : null);
    var starforce = convertStarforce(rawItem, tooltip);
    var warnings = [];
    if (!listingHash) warnings.push("listing_id_unavailable");
    if (!itemHash) warnings.push("item_id_unavailable");
    if (starforce.value === null) warnings.push("starforce_not_confirmed; null_preserved");
    var trade = convertTrade(tooltip);
    if (trade.scissors_remaining === null || trade.scissors_total === null) warnings.push("scissors_count_not_exposed; null_preserved");
    return {
      observation_id: String(options.batchId || "tooltip-api") + ":" + rowIndex,
      row_index: rowIndex, result_rank: rowIndex, matched_preset_ids: [], selection_channels: [],
      listing: {
        listing_id: listingHash, listing_id_source: listingHash ? "native" : "unavailable",
        listing_id_collision_risk: false, listing_fingerprint: "sha256:" + digests[3], listing_fingerprint_collision_risk: true,
        status: "sold", price_meso: priceMeso, quantity: nonNegativeInteger(rawItem.quantity) || 1,
        expires_at: validIso(rawItem.endDate), sold_at: validIso(rawItem.tradeDate), sold_at_precision: validIso(rawItem.tradeDate) ? "datetime" : null,
        listing_world: null, is_cross_world: typeof rawItem.isMyWorld === "boolean" ? !rawItem.isMyWorld : null
      },
      item: {
        item_id: itemHash, item_id_source: itemHash ? "native" : "unavailable",
        catalog_key: digests[2] ? "name_icon_sha256:" + digests[2] : null, name: cleanText(rawItem.itemName) || null,
        catalog_id: null, icon_asset_key: iconAssetKey(rawItem.itemIcon), starforce_preset_id: null,
        category: Array.isArray(tooltip.categories) && tooltip.categories.length ? cleanText(tooltip.categories[tooltip.categories.length - 1]) || null : null,
        category_path: Array.isArray(tooltip.categories) ? tooltip.categories.map(cleanText).filter(Boolean) : [],
        base_level: null, required_level: integer(tooltip.reqLevel), required_level_reduction: nonNegativeInteger(tooltip.stat && tooltip.stat.reduceReq),
        required_job: cleanText(tooltip.reqJob) || null, starforce: starforce, set_name: setNameFromTooltip(tooltip),
        upgrade: convertUpgrade(tooltip), trade: trade, stats: convertStats(tooltip),
        potential: convertPotential(tooltip.upgradeInfo && tooltip.upgradeInfo.potential),
        additional_potential: convertPotential(tooltip.upgradeInfo && tooltip.upgradeInfo.additionalPotential)
      },
      raw_evidence: {
        api_tooltip: {
          item_name: cleanText(rawItem.itemName) || null, tooltip_type: integer(rawItem.toolTipType), icon_asset_key: iconAssetKey(rawItem.itemIcon),
          status: rawItem.status, starforce: nonNegativeInteger(tooltip.starforce), starforce_max: nonNegativeInteger(tooltip.starforceMax),
          stat_sources: ["baseStat", "starforceStat", "upgradeStat", "exOptionStat", "timeLimitedStat"],
          potential_heading: cleanText(tooltip.upgradeInfo && tooltip.upgradeInfo.potential && tooltip.upgradeInfo.potential.description) || null,
          additional_potential_heading: cleanText(tooltip.upgradeInfo && tooltip.upgradeInfo.additionalPotential && tooltip.upgradeInfo.additionalPotential.description) || null
        }
      },
      quality_warnings: warnings
    };
  }

  async function convertSoldTooltipResponse(response, options) {
    options = options || {};
    var summary = validateSoldTooltipResponse(response, options);
    var items = await Promise.all(response.items.map(function (item, index) {
      var itemOptions = {};
      Object.keys(options).forEach(function (key) { itemOptions[key] = options[key]; });
      itemOptions.rowIndex = index + 1;
      return convertSoldTooltipItem(item, itemOptions);
    }));
    return {
      items: items,
      page: summary.page,
      limit: summary.limit,
      result_summary: {
        total_results: summary.total, total_pages: summary.total_pages, current_page: summary.page,
        has_next_page: summary.has_next_page, page_item_count: summary.page_item_count,
        requested_page_limit: summary.limit, displayed_page_limit: summary.limit
      },
      search_context: {
        source_path: summary.request.source_path, page_kind: "sold", keyword: null, sort: summary.request.sort,
        page: summary.page, limit: summary.limit, only_current_world: null, price_search_key_present: false,
        filter_search_applied: false, filters: {}, raw_filters: {}
      },
      sanitized_request_url: summary.request.sanitized_request_url
    };
  }

  return Object.freeze({
    canonicalIdMaterial: canonicalIdMaterial,
    sanitizeRequestUrl: sanitizeRequestUrl,
    validateSoldTooltipResponse: validateSoldTooltipResponse,
    parsePotentialLine: parsePotentialLine,
    convertSoldTooltipItem: convertSoldTooltipItem,
    convertSoldTooltipResponse: convertSoldTooltipResponse
  });
});
