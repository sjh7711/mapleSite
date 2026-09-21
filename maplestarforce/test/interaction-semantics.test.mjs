import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("독립 토글과 선택·실행 버튼을 서로 다른 모양과 의미로 구분한다", async () => {
  const [ui, calculatorUi, css, potential, ability, scroll, addOption, itemMarket] = await Promise.all([
    read("../src/shared/ui.js"),
    read("../src/shared/calculator-ui.js"),
    read("../src/style.css"),
    read("../src/shared/potential-page.js"),
    read("../src/pages/ability.js"),
    read("../src/pages/scroll.js"),
    read("../src/pages/add-option.js"),
    read("../src/pages/item-market.js"),
  ]);

  assert.match(ui, /export function toggleChip[\s\S]*kind: "toggle"/u);
  assert.match(css, /\.chip\[data-kind="toggle"\]::before/u);
  assert.match(css, /\.chip\[data-kind="toggle"\]\[aria-pressed="true"\]::before/u);
  for (const source of [potential, ability, scroll, addOption]) {
    assert.match(source, /toggleChip\(/u);
  }
  assert.match(calculatorUi, /export function resetAction\(/u);
  assert.match(potential, /resetAction\("목표 초기화"/u);
  assert.match(itemMarket, /resetAction\("옵션 초기화"/u);
  assert.match(css, /\.button\.button--reset[\s\S]*color:\s*var\(--muted\)/u);
  assert.match(css, /\.button\.button--reset:hover:not\(:disabled\)[\s\S]*color:\s*#ffaaaa/u);
  assert.match(css, /\.button\.button--remove:hover\s*\{[^}]*border-color:\s*#e26d6d/su);
  assert.match(css, /\.button\.button--remove:focus-visible\s*\{[^}]*outline-color:\s*#e26d6d/su);
  assert.match(css, /:where\([\s\S]*button,[\s\S]*a\[href\][\s\S]*\):focus-visible/u);
});

test("금액과 보유 수량 입력은 의미를 명확히 표시한다", async () => {
  const [scroll, pet] = await Promise.all([
    read("../src/pages/scroll.js"),
    read("../src/pages/pet.js"),
  ]);

  assert.match(scroll, /주문의 흔적 1,000개 \(만 메소\)/u);
  assert.match(scroll, /귀 장식 주문서 1장 \(만 메소\)/u);
  assert.match(scroll, /보유 순백 100% \(장\)/u);
  assert.match(scroll, /실패 시 횟수 보호율 \(%\)/u);
  assert.doesNotMatch(scroll, /\(만\)"/u);
  assert.match(pet, /원더베리 11개 \(캐시\)/u);
  assert.match(pet, /메소마켓 1억 메소 \(메포\)/u);
});

test("모든 목표 도달 확률 조절기는 평균 상태와 평균으로 보기 동작을 구분한다", async () => {
  const [potential, ability, pet, reachControl] = await Promise.all([
    read("../src/shared/potential-page.js"),
    read("../src/pages/ability.js"),
    read("../src/pages/pet.js"),
    read("../src/shared/reach-control.js"),
  ]);

  for (const source of [potential, ability, pet]) {
    assert.match(source, /createReachChanceControl\(\{/u);
  }
  assert.match(reachControl, /"평균으로 보기"/u);
  assert.match(reachControl, /reach-control__mode/u);
  assert.match(reachControl, /modeStatus\.hidden = !averageMode/u);
  assert.match(reachControl, /reset\.hidden = averageMode/u);
  assert.match(ability, /\["honor", "advanced"\]\.includes\(state\.method\) \? "목표 도달 명성치" : "목표 도달 서큘레이터"/u);
  assert.doesNotMatch(ability, /도달 재화/u);
});

test("결과·초기화 도구와 어빌리티 선택창은 공통 구현만 사용한다", async () => {
  const [ui, scroll, profile, abilityCss] = await Promise.all([
    read("../src/shared/calculator-ui.js"),
    read("../src/pages/scroll.js"),
    read("../src/shared/character-profile.js"),
    read("../src/calculator.css"),
  ]);

  assert.doesNotMatch(ui, /title\.includes\("결과"\)/u);
  assert.match(scroll, /resultCard as createResultCard/u);
  assert.doesNotMatch(scroll, /\bcard\(\s*"계산 결과"/u);
  assert.match(profile, /resetAction\("현재 정보 초기화"/u);
  assert.doesNotMatch(abilityCss, /ability-search-select/u);
});
