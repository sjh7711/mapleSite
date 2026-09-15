import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  formatMeso,
  formatMesoPreciseMan,
  renderWithFocus,
} from "../src/shared/calculator-ui.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("음수 시장 보정액도 절댓값 단위로 읽기 좋게 표시한다", () => {
  assert.equal(formatMeso(-100_000_000), "-1.00억 메소");
  assert.equal(formatMeso(-25_000), "-3만 메소");
  assert.equal(formatMeso(100_000_000), "1.00억 메소");
  assert.equal(formatMeso(1_509_858_000_000), "1조 5,098.58억 메소");
  assert.equal(formatMeso(1_000_000_000_000), "1조 메소");
});

test("큐브 사용 메소는 만 단위 소수 둘째 자리까지 보존한다", () => {
  assert.equal(formatMeso(364_500), "36만 메소");
  assert.equal(formatMesoPreciseMan(364_500), "36.45만 메소");
  assert.equal(formatMesoPreciseMan(420_500), "42.05만 메소");
  assert.equal(formatMesoPreciseMan(800_000), "80만 메소");
  assert.equal(formatMesoPreciseMan(2_450), "2,450 메소");
  assert.equal(formatMesoPreciseMan(100_000_000), "1.00억 메소");
});

test("공통 검색형 선택창은 숨김 옵션을 제외하고 한 건 검색을 자동 확정한다", async () => {
  const [component, calculatorUi] = await Promise.all([
    read("../src/shared/searchable-select.js"),
    read("../src/shared/calculator-ui.js"),
  ]);

  assert.match(component, /\.filter\(\(option\) => option\.hidden !== true\)/u);
  assert.match(component, /input\.setAttribute\("role", "combobox"\)/u);
  assert.match(component, /input\.setAttribute\("aria-autocomplete", "list"\)/u);
  assert.match(component, /input\.setAttribute\("aria-controls", list\.id\)/u);
  assert.match(component, /control\.setAttribute\("role", "option"\)/u);
  assert.match(component, /input\.setAttribute\("aria-activedescendant", active\.id\)/u);
  assert.match(component, /input\.focus\(\{ preventScroll: true \}\)/u);
  assert.match(component, /if \(restoringFocusAfterRender\) return;/u);
  assert.match(component, /Object\.defineProperty\(input, "focusAfterRender"/u);
  assert.match(component, /const openFullList = \(\) => \{[\s\S]*input\.value = "";[\s\S]*setOpen\(true\);/u);
  assert.match(component, /input\.addEventListener\("click", \(\) => \{\s*if \(!open\) openFullList\(\);/u);
  assert.match(component, /document\.activeElement === input\) openFullList\(\);/u);
  assert.match(component, /if \(matches\.length === 1\) commit\(matches\[0\]/u);
  assert.match(calculatorUi, /export \{ searchableSelect \}/u);
});

test("검색형 선택창 재렌더링은 목록을 다시 열지 않는 전용 포커스 경로를 쓴다", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const previous = {
    dataset: { key: "potential-target" },
    selectionStart: 0,
    selectionEnd: 0,
  };
  let restoredWith = null;
  let ordinaryFocusCalled = false;
  const next = {
    dataset: { key: "potential-target" },
    setSelectionRange() {},
    focus() {
      ordinaryFocusCalled = true;
    },
    focusAfterRender(options) {
      restoredWith = options;
    },
  };
  let current = [];
  const root = {
    querySelectorAll(selector) {
      if (selector === "[data-key]") return current;
      return [];
    },
    replaceChildren(...nodes) {
      current = nodes;
    },
  };

  globalThis.document = { activeElement: previous };
  globalThis.window = { scrollY: 0, scrollTo() {} };

  try {
    renderWithFocus(root, [next]);
    assert.deepEqual(restoredWith, { preventScroll: true });
    assert.equal(ordinaryFocusCalled, false);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("스타포스 전용 성 선택기도 콤보박스 ARIA와 포커스 복귀를 제공한다", async () => {
  const component = await read("../src/shared/ui.js");
  assert.match(component, /button\.setAttribute\("role", "combobox"\)/u);
  assert.match(component, /button\.setAttribute\("aria-controls", list\.id\)/u);
  assert.match(component, /list\.setAttribute\("role", "listbox"\)/u);
  assert.match(component, /option\.setAttribute\("role", "option"\)/u);
  assert.match(component, /button\.setAttribute\("aria-activedescendant", option\.id\)/u);
  assert.match(component, /button\.focus\(\{ preventScroll: true \}\)/u);
});

test("공통 카드·분할 선택·초기화·결과 카드 도구를 제공한다", async () => {
  const [component, reachControl] = await Promise.all([
    read("../src/shared/calculator-ui.js"),
    read("../src/shared/reach-control.js"),
  ]);
  assert.match(component, /export function card\(/u);
  assert.match(component, /export function segmentedControl\(/u);
  assert.match(component, /export function resetAction\(/u);
  assert.match(component, /export function resultCard\(/u);
  assert.match(component, /export \{ createReachChanceControl \}/u);
  assert.match(reachControl, /export function createReachChanceControl\(/u);
  assert.match(reachControl, /range\.addEventListener\("input"/u);
  assert.match(reachControl, /number\.addEventListener\("change"/u);
  assert.match(reachControl, /reset\.addEventListener\("click"/u);
});

test("윗잠·아랫잠·통합 화면은 같은 재설정 메소 가격 패널을 쓴다", async () => {
  const [component, potentialPage, combinedPage, styles] = await Promise.all([
    read("../src/shared/calculator-ui.js"),
    read("../src/shared/potential-page.js"),
    read("../src/shared/combined-potential-page.js"),
    read("../src/calculator.css"),
  ]);

  assert.match(component, /export function potentialResetCostPanel\(/u);
  assert.match(component, /title = "1회 메소 재설정", formatCost = formatMeso/u);
  assert.match(component, /"potential-reset-cost__label", title/u);
  assert.match(component, /element\("strong", "", formatCost\(cost\)\)/u);
  assert.match(potentialPage, /potentialResetCostPanel\(\[\{/u);
  assert.match(potentialPage, /system === "regular" \? "윗잠" : "아랫잠"/u);
  assert.match(potentialPage, /"1회 큐브 사용 메소"/u);
  assert.match(potentialPage, /"평균 큐브 사용 메소"/u);
  assert.match(potentialPage, /formatCost: \(cost\) => formatPotentialResetMeso\(cost, methodInfo\)/u);
  assert.match(potentialPage, /큐브 자체 가치는 포함하지 않습니다/u);
  assert.match(combinedPage, /potentialResetCostPanel\(\[/u);
  assert.match(styles, /\.potential-reset-cost\[data-count="1"\] \.potential-reset-cost__item/u);
  assert.doesNotMatch(styles, /\.combined-potential-reset-cost/u);
  assert.match(combinedPage, /gradeControl\("아랫잠 등급", "additionalGrade"\)/u);
  assert.doesNotMatch(combinedPage, /gradeControl\("에디셔널 등급"/u);
  assert.match(combinedPage, /maplestarforce:combined-potential:target-presets:v1/u);
  assert.match(combinedPage, /card\("저장된 목표 프리셋"/u);
  assert.match(combinedPage, /저장 당시 기댓값/u);
  assert.match(combinedPage, /results\.append\(resultCard\(\), savedTargetPresetCard\(\)\)/u);
  assert.match(combinedPage, /"%급 ON" : "%급 OFF"/u);
  assert.match(combinedPage, /resultLine\("추천 윗잠 목표"/u);
  assert.match(combinedPage, /resultLine\("추천 아랫잠 목표"/u);
  assert.match(combinedPage, /resultLine\("윗잠 목표 달성 확률"/u);
  assert.match(combinedPage, /resultLine\("아랫잠 목표 달성 확률"/u);
  assert.doesNotMatch(combinedPage, /adaptive-one-switch|추천 시작|전환 기준|첫 잠재 결과 채택 확률/u);
});

test("재렌더링 뒤에도 등급 상승 상세 영역을 열린 상태로 유지한다", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const previous = {
    dataset: { detailsKey: "rank-up" },
    open: true,
  };
  const next = {
    dataset: { detailsKey: "rank-up" },
    open: false,
  };
  let current = [previous];
  let restoredScroll = null;
  const root = {
    querySelectorAll(selector) {
      if (selector === "details[data-details-key]") {
        return current.filter((node) => node.dataset.detailsKey);
      }
      if (selector === "[data-key]") return [];
      return [];
    },
    replaceChildren(...nodes) {
      current = nodes;
    },
  };

  globalThis.document = { activeElement: null };
  globalThis.window = {
    scrollY: 120,
    scrollTo({ top }) {
      restoredScroll = top;
    },
  };

  try {
    renderWithFocus(root, [next]);
    assert.equal(next.open, true);
    assert.equal(restoredScroll, 120);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("직전 화면에 없던 상세 영역의 선언된 펼침 상태는 덮어쓰지 않는다", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const next = {
    dataset: { detailsKey: "success-conditions" },
    open: true,
  };
  let current = [];
  const root = {
    querySelectorAll(selector) {
      if (selector === "details[data-details-key]") {
        return current.filter((node) => node.dataset.detailsKey);
      }
      if (selector === "[data-key]") return [];
      return [];
    },
    replaceChildren(...nodes) {
      current = nodes;
    },
  };

  globalThis.document = { activeElement: null };
  globalThis.window = { scrollY: 0, scrollTo() {} };

  try {
    renderWithFocus(root, [next]);
    assert.equal(next.open, true);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});

test("재렌더링 뒤에도 사용자가 닫은 상세 영역은 닫힌 상태를 유지한다", () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const previous = {
    dataset: { detailsKey: "success-conditions" },
    open: false,
  };
  const next = {
    dataset: { detailsKey: "success-conditions" },
    open: true,
  };
  let current = [previous];
  const root = {
    querySelectorAll(selector) {
      if (selector === "details[data-details-key]") {
        return current.filter((node) => node.dataset.detailsKey);
      }
      if (selector === "[data-key]") return [];
      return [];
    },
    replaceChildren(...nodes) {
      current = nodes;
    },
  };

  globalThis.document = { activeElement: null };
  globalThis.window = { scrollY: 0, scrollTo() {} };

  try {
    renderWithFocus(root, [next]);
    assert.equal(next.open, false);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
});
