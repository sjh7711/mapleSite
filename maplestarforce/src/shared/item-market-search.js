/** 장비명 검색에서 띄어쓰기와 흔한 구분 기호의 차이를 무시한다. */
export function normalizeItemMarketSearch(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/[\s·:()\[\]{}\-_/]+/gu, "");
}

/** 입력한 글자가 이름 중간에 있어도 일치하는 장비만 반환한다. */
export function filterItemMarketCatalog(items, query) {
  const needle = normalizeItemMarketSearch(query);
  const source = Array.isArray(items) ? items : [];
  if (!needle) return source;
  return source.filter((entry) => normalizeItemMarketSearch(entry?.name).includes(needle));
}
