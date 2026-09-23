import assert from "node:assert/strict";
import test from "node:test";
import { queryMatchesSearchContext, searchContextMismatches } from "../tools/preset-core.mjs";

const query = {
  keyword: "거대한 공포", exact_match: true,
  starforce_min: 0, starforce_max: 0, server_filter: null,
};
const context = {
  page_kind: "sold", keyword: "거대한 공포", sort: "trade_date_desc", page: 1, limit: 60,
  filter_search_applied: true, price_search_key_present: true,
  raw_filters: {
    isExactMatch: "true", itemCategory: "ARMOR",
    "enhancementOption::starforceMin": "0",
    "form::equipmentSubcategory": "방어구",
  },
};
const withFilters = (patch) => ({ ...context, raw_filters: { ...context.raw_filters, ...patch } });

test("정확한 장비명 검색은 요청하지 않은 폼의 분류 표시 때문에 저장을 거절하지 않는다", () => {
  for (const label of ["방어구", "장신구", null]) {
    assert.equal(queryMatchesSearchContext(withFilters({ "form::equipmentSubcategory": label }), query), true);
  }
  assert.deepEqual(searchContextMismatches(context, query), []);
});

test("실제 검색 조건 불일치는 분류 표시 별칭으로 통과시키지 않는다", () => {
  for (const actual of [
    { ...context, keyword: "마이스터링" }, { ...context, page_kind: "active" },
    { ...context, page: 2 }, { ...context, limit: 20 }, { ...context, sort: "price_asc" },
    { ...context, filter_search_applied: false }, { ...context, price_search_key_present: false },
    withFilters({ isExactMatch: "false" }),
    withFilters({ itemCategory: "ETC" }),
    withFilters({ itemCategory: "ARMOR_ACCESSORY" }),
    withFilters({ "enhancementOption::starforceMin": "17" }),
    withFilters({ "enhancementOption::starforceMax": "22" }),
    withFilters({ "enhancementOption::potentialFilters::optionRows": "strPercent\u001f30" }),
    withFilters({ "price::min": "100000000" }),
    withFilters({ "form::priceMinMeso": "invalid" }),
  ]) assert.equal(queryMatchesSearchContext(actual, query), false);
});

test("명시한 분류와 전체 검색은 기존 검증을 유지한다", () => {
  assert.equal(queryMatchesSearchContext(context, { ...query, item_category_filter: "ARMOR" }), false);
  assert.equal(queryMatchesSearchContext(context, { ...query,
    item_category_filter: "ARMOR", equipment_subcategory_filter: "장신구" }), false);
  assert.equal(queryMatchesSearchContext(context, { ...query,
    item_category_filter: "ARMOR", equipment_subcategory_filter: "방어구" }), true);
  assert.equal(queryMatchesSearchContext(withFilters({ isExactMatch: "false" }),
    { ...query, exact_match: false }), true);
  assert.equal(queryMatchesSearchContext({ ...context, keyword: null },
    { ...query, keyword: "", exact_match: false, search_scope: "catalog_global" }), false);
});

test("앱솔랩스 아처 묶음 검색도 요청하지 않은 방어구 표시로 중단하지 않는다", () => {
  const prefix = { ...query, keyword: "앱솔랩스 아처", exact_match: false,
    starforce_min: null, starforce_max: null, price_min_meso: 50_000_000 };
  const actual = { ...context, keyword: prefix.keyword, raw_filters: {
    isExactMatch: "false", itemCategory: "ARMOR", "form::equipmentSubcategory": "방어구",
    "price::min": "50000000",
  } };
  assert.deepEqual(searchContextMismatches(actual, prefix), []);
  for (const patch of [ { isExactMatch: "true" }, { itemCategory: "ARMOR_ACCESSORY" },
    { "price::min": "100000000" }, { "enhancementOption::starforceMin": "17" } ]) {
    assert.equal(queryMatchesSearchContext({ ...actual, raw_filters: { ...actual.raw_filters, ...patch } }, prefix), false);
  }
  assert.equal(queryMatchesSearchContext({ ...actual, keyword: "앱솔랩스 메이지" }, prefix), false);
});

test("실패 진단은 조건별 차이를 반환하고 비공개 키나 원본 URL을 노출하지 않는다", () => {
  const differences = searchContextMismatches({
    ...withFilters({ "enhancementOption::starforceMin": "17", priceSearchKey: "PRIVATE_KEY" }),
    page: 2, url: "https://example.test/?token=PRIVATE_TOKEN",
  }, query);
  assert.deepEqual(differences.map((x) => x.label), ["페이지", "스타포스 최소", "스타포스 최대"]);
  assert.deepEqual(differences[0], { label: "페이지", expected: 1, actual: 2 });
  assert.doesNotMatch(JSON.stringify(differences), /PRIVATE|example\.test/u);
  assert.equal(queryMatchesSearchContext(null, query), false);
});
