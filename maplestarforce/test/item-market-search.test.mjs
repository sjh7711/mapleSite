import test from "node:test";
import assert from "node:assert/strict";

import {
  filterItemMarketCatalog,
  normalizeItemMarketSearch,
} from "../src/shared/item-market-search.js";

const ITEMS = [
  { name: "거대한 공포" },
  { name: "고통의 근원" },
  { name: "미트라의 분노 : 궁수" },
];

test("장비명 일부를 입력하면 일치하는 드롭다운 항목만 남긴다", () => {
  assert.deepEqual(
    filterItemMarketCatalog(ITEMS, "한공").map((item) => item.name),
    ["거대한 공포"],
  );
});

test("띄어쓰기와 구분 기호를 무시해 장비명을 검색한다", () => {
  assert.equal(normalizeItemMarketSearch(" 미트라의 분노:궁수 "), "미트라의분노궁수");
  assert.deepEqual(
    filterItemMarketCatalog(ITEMS, "분노궁수").map((item) => item.name),
    ["미트라의 분노 : 궁수"],
  );
});
