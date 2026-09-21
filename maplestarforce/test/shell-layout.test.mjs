import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("모든 계산기 폭과 상단 글꼴은 스타포스 기준을 공유한다", async () => {
  const [baseCss, calculatorCss] = await Promise.all([
    read("../src/style.css"),
    read("../src/calculator.css"),
  ]);

  assert.match(baseCss, /--page-max-width:\s*1320px/);
  assert.match(baseCss, /--page-title-size:\s*1\.5rem/);
  assert.match(
    calculatorCss,
    /\.page--calculator \.page\s*{[^}]*width:\s*100%;[^}]*max-width:\s*var\(--page-max-width\)/s,
  );
  assert.doesNotMatch(calculatorCss, /width:\s*min\(100%,\s*1180px\)/);
  assert.match(
    calculatorCss,
    /\.page--calculator \.page__head h1\s*{[^}]*font-size:\s*var\(--page-title-size\)/s,
  );
  assert.match(
    calculatorCss,
    /\.page--calculator \.calculator-grid\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 420px;/s,
  );
  assert.match(
    calculatorCss,
    /\.page--pet \.calculator-grid\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 420px;/s,
  );
});

test("계산기 탐색은 1280px부터 아이콘 레일, 더 좁으면 제목 옆 서랍을 제공한다", async () => {
  const [shell, css, nav] = await Promise.all([
    read("../src/shared/shell.js"),
    read("../src/style.css"),
    read("../src/shared/tool-nav.js"),
  ]);

  assert.match(shell, /const TOOLNAV_DESKTOP_QUERY = "\(min-width: 1280px\)"/);
  assert.match(shell, /function enhanceToolNav\(container\)/);
  assert.match(shell, /className = "page__title-row"/);
  assert.match(shell, /className = "toolnav-toggle"/);
  assert.match(shell, /aria-controls/);
  assert.match(shell, /aria-expanded/);
  assert.match(shell, /event\.key === "Escape"/);
  assert.match(css, /@media \(min-width: 1280px\)[\s\S]*?\.toolnav\s*{/);
  assert.match(css, /@media \(min-width: 1700px\)[\s\S]*?\.toolnav\s*{/);
  assert.match(shell, /classList\.add\("toolnav__icon"\)/);
  assert.match(nav, /potential:\s*"tool-icons\/black-cube\.png"/);
  assert.match(nav, /additional:\s*"tool-icons\/white-additional-cube\.png"/);
  assert.doesNotMatch(nav, /\{ id: "additional", name: "에디셔널"/u);
  assert.match(nav, /"add-option":\s*"tool-icons\/black-rebirth-flame\.png"/);
  assert.match(nav, /scroll:\s*"tool-icons\/spell-trace\.png"/);
  assert.match(nav, /ability:\s*"tool-icons\/large-boss-medal\.png"/);
  assert.match(nav, /pet:\s*"tool-icons\/wisp-wonderberry\.png"/);
  assert.match(shell, /icon\.src = `\$\{root\}\$\{itemIconPath\}`/);
  assert.match(css, /\.toolnav__icon--starforce\s*{[^}]*fill:\s*#ffd928/s);
  assert.match(css, /\.toolnav__icon--item\s*{[^}]*image-rendering:\s*pixelated/s);
  assert.match(shell, /className: "toolnav__label"/);
  assert.match(css, /\.toolnav__item:is\(:hover, :focus-visible\) \.toolnav__label/u);
  assert.match(css, /body\[data-toolnav-drawer="open"\] \.toolnav-backdrop/);
  assert.match(shell, /textContent: "메뉴"/);
  assert.doesNotMatch(shell, /계산기 메뉴/);
  assert.match(shell, /function prefetchToolPage\(link\)/u);
  assert.match(shell, /link\.rel = "modulepreload"/u);
  assert.match(shell, /link\.addEventListener\("pointerenter", start\)/u);
  assert.match(shell, /link\.addEventListener\("touchstart"/u);
  assert.match(
    css,
    /\.toolnav__item\s*{[^}]*justify-content:\s*center;[^}]*text-align:\s*center;/s,
  );
});

test("모바일 계산기는 즉시 갱신되는 결과 이동 막대를 공통으로 사용한다", async () => {
  const [shell, bar, css] = await Promise.all([
    read("../src/shared/shell.js"),
    read("../src/shared/mobile-result-bar.js"),
    read("../src/calculator.css"),
  ]);

  assert.match(shell, /if \(current !== "starforce"\) installMobileResultBar\(\)/);
  assert.match(bar, /new MutationObserver\(scheduleRefresh\)/);
  assert.match(bar, /requestAnimationFrame\(refresh\)/);
  assert.match(bar, /\.calculator-result/);
  assert.match(bar, /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.match(bar, /평균.*비용\|비용.*평균/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.mobile-result-bar:not\(\[hidden\]\)/);
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
});

test("스타포스 모바일 장비 서랍은 햄버거 대신 장비 텍스트 버튼으로 연다", async () => {
  const [html, css] = await Promise.all([
    read("../index.html"),
    read("../src/style.css"),
  ]);

  assert.match(html, /id="menu"[\s\S]*?>\s*장비\s*<\/button>/u);
  assert.doesNotMatch(html, /<span><\/span><span><\/span><span><\/span>/u);
  assert.match(
    css,
    /\.menu-button\s*\{[^}]*display:\s*inline-flex;[^}]*width:\s*52px;[^}]*height:\s*40px;[^}]*border-radius:\s*10px;/s,
  );
});

test("스타포스 시작·목표 드롭다운은 마우스를 올려도 노란 테두리를 표시한다", async () => {
  const css = await read("../src/style.css");
  assert.match(
    css,
    /\.dropdown__button:hover\s*\{[^}]*border-color:\s*var\(--accent\);/su,
  );
});

test("계산기 페이지 제목 아래의 장식 설명을 표시하지 않는다", async () => {
  const pages = await Promise.all([
    read("../potential/index.html"),
    read("../additional/index.html"),
    read("../add-option/index.html"),
    read("../scroll/index.html"),
    read("../item-market/index.html"),
  ]);
  const removedDescriptions = [
    "원하는 옵션 조합의 확률과 비용을 한 화면에서 비교합니다.",
    "에디셔널 옵션 조합과 개인 환산값을 밀도 있게 계산합니다.",
    "개인 스탯 효율로 환산한 환불별 기댓값을 나란히 비교합니다.",
    "현재 장비 상태와 목표에 맞춰 완작과 놀긍 첫작의 기댓값을 계산합니다.",
    "장비의 구성요소별 시장 반영 가격을 나누어 합산합니다.",
  ];

  for (const [index, html] of pages.entries()) {
    assert.doesNotMatch(html, new RegExp(removedDescriptions[index]));
  }
});

test("통합 잠재 계산기는 장비 등급 위에서 잠재 종류를 바꾸고 목표 카드와 나란히 배치한다", async () => {
  const [source, css, form] = await Promise.all([
    read("../src/shared/potential-page.js"),
    read("../src/calculator.css"),
    read("../src/shared/potential-form-ui.js"),
  ]);

  assert.match(
    source,
    /row\(field\("부위", part\)\),\s*row\(field\("장비 레벨", level\)\)/s,
  );
  assert.match(
    source,
    /row\(field\("장비 레벨", level\)\),\s*systemPicker,\s*gradePicker/s,
  );
  assert.match(source, /chip\("윗잠", system === "regular"/u);
  assert.match(source, /chip\("아랫잠", system === "additional"/u);
  assert.match(source, /potentialCalculatorLayout\(\{/);
  assert.match(form, /const setup = element\("div", "potential-setup-grid"\)/);
  assert.match(form, /setup\.append\(equipment, targets\)/);
  assert.match(
    css,
    /\.page--calculator \.potential-setup-grid\s*{[^}]*grid-template-columns:\s*minmax\(280px, 0\.8fr\) minmax\(360px, 1\.2fr\);/s,
  );
});
