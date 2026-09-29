import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const PAGES = [
  { path: "../index.html", stylesheet: "./src/calculator-guide.css", id: "starforce", terms: ["스페어 가격", "파괴방지", "준비할 메소"] },
  { path: "../potential/index.html", stylesheet: "../src/calculator-guide.css", id: "potential", terms: ["윗잠·아랫잠", "목표 세트", "1회 성공 확률"] },
  { path: "../ability/index.html", stylesheet: "../src/calculator-guide.css", id: "ability", terms: ["잠금 상태", "서큘레이터", "추천 진행 순서"] },
  { path: "../add-option/index.html", stylesheet: "../src/calculator-guide.css", id: "add-option", terms: ["목표 급", "환생의 불꽃", "평균 개수"] },
  { path: "../scroll/index.html", stylesheet: "../src/calculator-guide.css", id: "scroll", terms: ["잔여·복구 가능 횟수", "리턴", "다음 행동"] },
  { path: "../pet/index.html", stylesheet: "../src/calculator-guide.css", id: "pet", terms: ["목표 마릿수", "당첨선", "회수 반영 비용"] },
  { path: "../soul/index.html", stylesheet: "../src/calculator-guide.css", id: "soul", terms: ["현재 단계의 실패 횟수", "등급 상승", "성공 보장"] },
];

test("광고가 있는 계산기 페이지의 정적 이용 안내는 숨김 상태를 유지한다", async () => {
  for (const page of PAGES) {
    const html = await read(page.path);
    const guideStart = html.indexOf('<article class="calculator-guide"');
    const footerMarker = html.indexOf("<!-- site-footer -->");
    const script = html.indexOf('<script type="module"');
    const tool = page.id === "starforce"
      ? html.indexOf('id="starforce-total"')
      : html.indexOf('id="tool"');

    assert.match(html, new RegExp(`<link rel="stylesheet" href="${page.stylesheet.replaceAll(".", "\\.")}"`), page.path);
    assert.ok(tool >= 0 && guideStart > tool, `${page.path}: 안내는 계산기 뒤에 있어야 합니다.`);
    assert.ok(guideStart < footerMarker && footerMarker < script, `${page.path}: 안내는 푸터 앞의 정적 HTML이어야 합니다.`);
    assert.match(html, new RegExp(`<article class="calculator-guide" aria-labelledby="${page.id}-guide-title" hidden>`), page.path);
    assert.match(html, /<h3>[^<]+<\/h3>[\s\S]*?<h3>[^<]+<\/h3>[\s\S]*?<h3>[^<]+<\/h3>/u, page.path);
    assert.match(html, /href="\/sources\/"/u, page.path);
    assert.match(html, /href="\/about\/#usage"/u, page.path);
    assert.match(html.slice(guideStart, footerMarker), /<article class="calculator-guide"[^>]*\shidden>/u, page.path);
    for (const term of page.terms) assert.ok(html.includes(term), `${page.path}: ${term}`);
  }
});

test("정적 안내 스타일은 본문 흐름과 반응형 한 열 레이아웃을 유지한다", async () => {
  const css = await read("../src/calculator-guide.css");
  assert.match(css, /\.calculator-guide\s*\{[^}]*position:\s*relative;[^}]*width:\s*100%;/su);
  assert.match(css, /\.calculator-guide\[hidden\]\s*\{[^}]*display:\s*none\s*!important;/su);
  assert.doesNotMatch(css, /position:\s*(?:fixed|absolute|sticky)/u);
  assert.match(css, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/u);
  assert.match(css, /@media \(max-width:\s*980px\)[\s\S]*?grid-template-columns:\s*1fr/u);
});
