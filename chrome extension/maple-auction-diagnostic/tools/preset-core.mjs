export const DEFAULT_PAGE_LIMIT = 60;
export const FALLBACK_PAGE_LIMIT = 40;
export const SOLD_SORT = "TRADE_DATE_DESC";

const WORLD_SCOPE_KEYS = [
  "onlyCurrentWorld",
  "isOnlyCurrentWorld",
  "worldOnly"
];
const POTENTIAL_FILTER_KEY = "enhancementOption::potentialFilters::optionRows";
const PRICE_MIN_FILTER_KEY = "price::min";
const PRICE_MAX_FILTER_KEY = "price::max";
const FORM_PRICE_MIN_FILTER_KEY = "form::priceMinMeso";
const FORM_PRICE_MAX_FILTER_KEY = "form::priceMaxMeso";
const FORM_EQUIPMENT_SUBCATEGORY_KEY = "form::equipmentSubcategory";

export function validatePreset(preset) {
  return validateQuery(normalizeLegacyPreset(preset));
}

export function validateQuery(query) {
  const globalSearch = query?.search_scope === "catalog_global";
  const potentialCode = query?.server_filter?.code ?? query?.potential_code;
  const potentialMinimum = query?.server_filter?.minimum ?? query?.potential_min;
  const potentialMaximum = query?.server_filter?.maximum ?? null;
  if (!query || typeof query.keyword !== "string" || (!query.keyword.trim() && !globalSearch)) {
    throw new Error("장비명이 필요합니다.");
  }
  if (query.search_scope != null && !globalSearch) {
    throw new Error("지원하지 않는 검색 범위입니다.");
  }
  if (query.item_category_filter != null && query.item_category_filter !== "ARMOR") {
    throw new Error("지원하는 상위 장비 분류는 ARMOR뿐입니다.");
  }
  if (
    query.equipment_subcategory_filter != null &&
    !["장신구", "방어구"].includes(query.equipment_subcategory_filter)
  ) {
    throw new Error("장비 하위 분류는 장신구 또는 방어구여야 합니다.");
  }
  if (query.exact_match != null && typeof query.exact_match !== "boolean") {
    throw new Error("정확 일치 여부는 boolean이어야 합니다.");
  }
  for (const [key, value] of [
    ["starforce_min", query.starforce_min],
    ["starforce_max", query.starforce_max],
    ["price_min_meso", query.price_min_meso],
    ["price_max_meso", query.price_max_meso],
    ["potential_min", potentialMinimum],
    ["potential_max", potentialMaximum]
  ]) {
    if (value != null && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error(`${key}는 0 이상의 정수여야 합니다.`);
    }
  }
  if (query.starforce_min != null && query.starforce_max != null && query.starforce_min > query.starforce_max) {
    throw new Error("스타포스 최소값은 최대값보다 클 수 없습니다.");
  }
  if (query.price_min_meso != null && query.price_max_meso != null && query.price_min_meso > query.price_max_meso) {
    throw new Error("최소 가격은 최대 가격보다 클 수 없습니다.");
  }
  if (globalSearch && (
    query.exact_match !== false ||
    (
      query.starforce_min == null &&
      query.starforce_max == null &&
      (potentialCode == null || potentialMinimum == null)
    )
  )) {
    throw new Error("전체 장비 검색은 스타포스 범위 또는 잠재 조건을 지정해야 합니다.");
  }
  if ((potentialCode == null) !== (potentialMinimum == null)) {
    throw new Error("윗잠 옵션과 최소 수치를 함께 지정해야 합니다.");
  }
  if (potentialMaximum != null && potentialMinimum != null && potentialMinimum > potentialMaximum) {
    throw new Error("윗잠 최소값은 로컬 분류 최대값보다 클 수 없습니다.");
  }
  return true;
}

export function withDefaultPageLimit(currentUrl) {
  return withPage(currentUrl, 1, DEFAULT_PAGE_LIMIT);
}

export function withPage(currentUrl, page = 1, limit = DEFAULT_PAGE_LIMIT) {
  if (!Number.isInteger(page) || page < 1) {
    throw new Error("페이지는 1 이상의 정수여야 합니다.");
  }
  if (![DEFAULT_PAGE_LIMIT, FALLBACK_PAGE_LIMIT].includes(limit)) {
    throw new Error("페이지 크기는 60 또는 40이어야 합니다.");
  }
  const url = new URL(currentUrl);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("page", String(page));
  return url;
}

/** Every catalogue query is submitted through the site's filter form. */
export function requiresFilterSubmission(query = {}) {
  return query.search_scope === "catalog_global" ||
    (typeof query.keyword === "string" && Boolean(query.keyword.trim()));
}

/**
 * Return true only for a filter-search result URL belonging to this exact
 * query.  The opaque priceSearchKey is deliberately used only in memory and is
 * never copied into capture metadata.
 */
export function isReusableFilterSearchUrl(currentUrl, query) {
  try {
    const url = new URL(currentUrl);
    return isSubmittedFilterSearchUrl(url, query) &&
      normalizeSort(url.searchParams.get("sortType")) === SOLD_SORT.toLowerCase();
  } catch (_error) {
    return false;
  }
}

/** A form-submitted result may still need its sort/page-size normalized. */
export function isSubmittedFilterSearchUrl(currentUrl, query) {
  try {
    validateQuery(query);
    const url = new URL(currentUrl);
    if (
      url.origin !== "https://auction.maplestory.nexon.com" ||
      !/^\/price(?:\/|$)/u.test(url.pathname) ||
      !url.searchParams.get("priceSearchKey") ||
      url.searchParams.get("searchTab") !== "condition" ||
      normalizedKeyword(url.searchParams.get("keyword")) !== normalizedKeyword(query.keyword) ||
      !exactMatchParamMatches(url.searchParams.get("isExactMatch"), query)
    ) {
      return false;
    }
    return urlFiltersMatchQuery(url.searchParams, query);
  } catch (_error) {
    return false;
  }
}

/** Build a later page URL without discarding the site's filter-search key. */
export function buildFilterContinuationUrl(currentUrl, query, options = {}) {
  if (!isSubmittedFilterSearchUrl(currentUrl, query)) {
    throw new Error("현재 URL은 이 세부 조건의 필터 검색 결과가 아닙니다.");
  }
  const page = options.page ?? query.page ?? 1;
  const limit = options.limit ?? query.page_limit ?? DEFAULT_PAGE_LIMIT;
  const url = withPage(currentUrl, page, limit);
  url.searchParams.set("sortType", SOLD_SORT);
  return url;
}

/** Legacy compatibility wrapper. The live collector enters values in the UI. */
export function buildPresetUrl(currentUrl, preset) {
  return buildQueryUrl(currentUrl, normalizeLegacyPreset(preset));
}

export function isPriceTabUrl(currentUrl) {
  try {
    const current = new URL(currentUrl);
    return current.origin === "https://auction.maplestory.nexon.com" && /^\/price(?:\/|$)/u.test(current.pathname);
  } catch (_error) {
    return false;
  }
}

export function buildQueryUrl(currentUrl, query, options = {}) {
  validateQuery(query);
  const current = new URL(currentUrl);
  if (current.origin !== "https://auction.maplestory.nexon.com") {
    throw new Error("메이플스토리 경매장 주소에서만 수집할 수 있습니다.");
  }

  // Automatic collection is always sold-only. A clean URL also prevents stale
  // filters and priceSearchKey values from leaking to another query.
  const url = new URL("/price", current.origin);
  for (const key of WORLD_SCOPE_KEYS) {
    const value = current.searchParams.get(key);
    if (value != null) {
      url.searchParams.set(key, value);
    }
  }

  const page = options.page ?? query.page ?? 1;
  const limit = options.limit ?? query.page_limit ?? DEFAULT_PAGE_LIMIT;
  url.searchParams.set("searchTab", "condition");
  if (normalizedKeyword(query.keyword)) {
    url.searchParams.set("keyword", query.keyword.trim());
    url.searchParams.set("isExactMatch", String(expectedExactMatch(query)));
  }
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sortType", SOLD_SORT);

  if (query.item_category_filter) {
    url.searchParams.set("itemCategory", query.item_category_filter);
  }
  setNullableSearchParam(url, "enhancementOption::starforceMin", query.starforce_min);
  setNullableSearchParam(url, "enhancementOption::starforceMax", query.starforce_max);
  setNullableSearchParam(url, PRICE_MIN_FILTER_KEY, query.price_min_meso);
  setNullableSearchParam(url, PRICE_MAX_FILTER_KEY, query.price_max_meso);
  const potentialCode = query.server_filter?.code ?? query.potential_code;
  const potentialMinimum = query.server_filter?.minimum ?? query.potential_min;
  if (potentialCode && potentialMinimum != null) {
    url.searchParams.set(POTENTIAL_FILTER_KEY, `${potentialCode}\u001f${potentialMinimum}`);
  }
  return url;
}

export function presetMatchesSearchContext(searchContext, preset = null, options = {}) {
  return queryMatchesSearchContext(
    searchContext,
    preset ? normalizeLegacyPreset(preset) : null,
    options
  );
}

export function queryMatchesSearchContext(searchContext, query = null, options = {}) {
  const expectedPage = options.page ?? query?.page ?? 1;
  const expectedLimit = options.limit ?? query?.page_limit ?? DEFAULT_PAGE_LIMIT;
  if (
    searchContext?.page_kind !== "sold" ||
    searchContext?.page !== expectedPage ||
    searchContext?.limit !== expectedLimit ||
    searchContext?.sort !== SOLD_SORT.toLowerCase()
  ) {
    return false;
  }
  if (!query) {
    return true;
  }
  const rawFilters = searchContext.raw_filters || {};
  return (
    normalizedKeyword(searchContext.keyword) === normalizedKeyword(query.keyword) &&
    exactMatchParamMatches(rawFilters.isExactMatch, query) &&
    rawFiltersMatchQuery(rawFilters, query) &&
    (!requiresFilterSubmission(query) || (
      searchContext.filter_search_applied === true &&
      searchContext.price_search_key_present === true
    ))
  );
}

function normalizeLegacyPreset(preset = {}) {
  return {
    ...preset,
    server_filter: preset.server_filter || (
      preset.potential_code && preset.potential_min != null
        ? { code: preset.potential_code, minimum: preset.potential_min }
        : null
    )
  };
}

function expectedExactMatch(query = {}) {
  return query.search_scope === "catalog_global" ? false : query.exact_match !== false;
}

function normalizedKeyword(value) {
  return String(value ?? "").trim();
}

function exactMatchParamMatches(value, query = {}) {
  const actual = nullableBoolean(value);
  if (query.search_scope === "catalog_global" && !normalizedKeyword(query.keyword)) {
    return value == null || actual != null;
  }
  const expected = expectedExactMatch(query);
  return actual === expected || (expected === false && value == null);
}

function setNullableSearchParam(url, key, value) {
  if (value == null) {
    url.searchParams.delete(key);
  } else {
    url.searchParams.set(key, String(value));
  }
}

function urlFiltersMatchQuery(searchParams, query) {
  return rawFiltersMatchQuery({
    itemCategory: searchParams.get("itemCategory"),
    "enhancementOption::starforceMin": searchParams.get("enhancementOption::starforceMin"),
    "enhancementOption::starforceMax": searchParams.get("enhancementOption::starforceMax"),
    [POTENTIAL_FILTER_KEY]: searchParams.get(POTENTIAL_FILTER_KEY),
    [PRICE_MIN_FILTER_KEY]: searchParams.get(PRICE_MIN_FILTER_KEY),
    [PRICE_MAX_FILTER_KEY]: searchParams.get(PRICE_MAX_FILTER_KEY)
  }, query, {
    allow_missing_expected_price: true,
    allow_missing_expected_subcategory: true
  });
}

function rawFiltersMatchQuery(rawFilters, query, options = {}) {
  const potentialCode = query.server_filter?.code ?? query.potential_code;
  const potentialMinimum = query.server_filter?.minimum ?? query.potential_min;
  const expectedPotential = potentialCode && potentialMinimum != null
    ? `${potentialCode}\u001f${potentialMinimum}`
    : null;
  const actualCategory = rawFilters.itemCategory || null;
  const expectedCategory = query.item_category_filter || null;
  const actualSubcategory = rawFilters[FORM_EQUIPMENT_SUBCATEGORY_KEY] || null;
  const expectedSubcategory = query.equipment_subcategory_filter || null;
  const actualStarforceMin = nullableInteger(rawFilters["enhancementOption::starforceMin"]);
  const actualStarforceMax = nullableInteger(rawFilters["enhancementOption::starforceMax"]);
  const expectedStarforceMin = query.starforce_min ?? null;
  const expectedStarforceMax = query.starforce_max ?? null;
  const expectedPriceMin = query.price_min_meso ?? null;
  const expectedPriceMax = query.price_max_meso ?? null;
  const urlPriceMin = priceFilterEvidence(rawFilters[PRICE_MIN_FILTER_KEY]);
  const urlPriceMax = priceFilterEvidence(rawFilters[PRICE_MAX_FILTER_KEY]);
  const formPriceMin = priceFilterEvidence(rawFilters[FORM_PRICE_MIN_FILTER_KEY]);
  const formPriceMax = priceFilterEvidence(rawFilters[FORM_PRICE_MAX_FILTER_KEY]);
  const actualPriceMin = formPriceMin.present ? formPriceMin.value : urlPriceMin.value;
  const actualPriceMax = formPriceMax.present ? formPriceMax.value : urlPriceMax.value;
  const conflictingPriceEvidence =
    (formPriceMin.present && urlPriceMin.present && formPriceMin.value !== urlPriceMin.value) ||
    (formPriceMax.present && urlPriceMax.present && formPriceMax.value !== urlPriceMax.value);
  const validPriceEvidence = [urlPriceMin, urlPriceMax, formPriceMin, formPriceMax]
    .every((evidence) => evidence.valid);
  const noPriceEvidence = !urlPriceMin.present && !urlPriceMax.present &&
    !formPriceMin.present && !formPriceMax.present;
  const priceMatches = validPriceEvidence && !conflictingPriceEvidence && (
    (actualPriceMin === expectedPriceMin && actualPriceMax === expectedPriceMax) ||
    (options.allow_missing_expected_price === true &&
      noPriceEvidence &&
      (expectedPriceMin != null || expectedPriceMax != null))
  );
  // The auction UI canonicalizes an unrestricted equipment search to
  // itemCategory=ARMOR and starforceMin=0 after its own filter button runs.
  // Both values are semantically equivalent to the clean entry URL's blanks.
  // It may also omit an explicit maximum of 0 for an exact 0-star search.
  const zeroStarMaximumAlias = expectedStarforceMin === 0 && expectedStarforceMax === 0 &&
    actualStarforceMin === 0 && actualStarforceMax == null;
  // The form exposes 장신구/방어구 below the broad ARMOR family, while the
  // submitted result URL canonicalizes those choices to ARMOR_ACCESSORY and
  // ARMOR_ARMOR. Keep the form-facing query model and accept only the matching
  // canonical value for the requested subcategory.
  const canonicalCategoryForSubcategory = expectedCategory === "ARMOR"
    ? expectedSubcategory === "장신구"
      ? "ARMOR_ACCESSORY"
      : expectedSubcategory === "방어구"
        ? "ARMOR_ARMOR"
        : null
    : null;
  const subcategoryCategoryAlias = canonicalCategoryForSubcategory != null &&
    actualCategory === canonicalCategoryForSubcategory;
  const canonicalSubcategoryEvidence = expectedSubcategory != null &&
    actualSubcategory === null && subcategoryCategoryAlias;
  return (
    (actualCategory === expectedCategory || subcategoryCategoryAlias ||
      (expectedCategory === null && actualCategory === "ARMOR")) &&
    (
      actualSubcategory === expectedSubcategory ||
      canonicalSubcategoryEvidence ||
      (expectedSubcategory === null && actualSubcategory === null) ||
      (options.allow_missing_expected_subcategory === true && actualSubcategory === null)
    ) &&
    (actualStarforceMin === expectedStarforceMin ||
      (expectedStarforceMin === null && actualStarforceMin === 0)) &&
    (actualStarforceMax === expectedStarforceMax || zeroStarMaximumAlias) &&
    priceMatches &&
    (rawFilters[POTENTIAL_FILTER_KEY] || null) === expectedPotential
  );
}

function normalizeSort(raw) {
  return typeof raw === "string" ? raw.toLowerCase() : null;
}

function nullableInteger(value) {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function priceFilterEvidence(value) {
  if (value == null || String(value).trim() === "") {
    return { present: false, valid: true, value: null };
  }
  const normalized = String(value).replace(/[\s,]/gu, "");
  if (!/^\d+$/u.test(normalized)) {
    return { present: true, valid: false, value: null };
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) {
    return { present: true, valid: false, value: null };
  }
  return { present: true, valid: true, value: parsed === 0 ? null : parsed };
}

function nullableBoolean(value) {
  if (value == null) {
    return null;
  }
  if (/^(?:true|1|yes)$/iu.test(value)) {
    return true;
  }
  if (/^(?:false|0|no)$/iu.test(value)) {
    return false;
  }
  return null;
}
