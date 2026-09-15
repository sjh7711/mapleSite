import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("어빌리티 계산기는 별도 페이지와 메뉴 진입점을 제공한다", async () => {
  const [vite, html, shell] = await Promise.all([
    read("../vite.config.js"),
    read("../ability/index.html"),
    read("../src/shared/shell.js"),
  ]);

  assert.match(vite, /ability: resolve\(__dirname, "ability\/index\.html"\)/u);
  assert.match(html, /<h1>어빌리티 기댓값<\/h1>/u);
  assert.match(html, /src="\.\.\/src\/pages\/ability\.js"/u);
  assert.match(shell, /id: "ability", name: "어빌리티", href: "ability\/"/u);
  assert.match(
    shell,
    /id: "scroll", name: "주문서"[\s\S]*id: "ability", name: "어빌리티"[\s\S]*id: "pet", name: "자석펫"/u,
  );
});

test("어빌리티 화면은 통합 블랙·카오스 방식과 잠금·반값·아랫줄 순서 무관을 지원한다", async () => {
  const [source, core] = await Promise.all([
    read("../src/pages/ability.js"),
    read("../../maple-core/src/ability.js"),
  ]);

  assert.match(source, /Object\.values\(ABILITY_RESET_METHODS\)/u);
  assert.match(source, /\.filter\(\(method\) => method\.id !== "chaos"\)/u);
  assert.match(core, /label: "블랙\(카오스\) 서큘레이터"/u);
  assert.doesNotMatch(source, /서큘레이터 1개 \(억 메소\)/u);
  assert.doesNotMatch(source, /대형 보스 명예의 훈장 가격/u);
  assert.match(source, /"잠금"/u);
  assert.match(source, /"2·3번째 줄 순서 무관"/u);
  assert.match(source, /"어빌 반값 선데이"/u);
  assert.doesNotMatch(source, /field\("어빌리티 등급"/u);
  assert.match(source, /calculateAbilityExpected/u);
  assert.match(source, /calculateAbilityAttemptsForChance/u);
  assert.match(source, /목표 도달 확률/u);
});

test("최적 전략은 허용할 서큘레이터를 따로 고르고 추천 순서와 기대 사용량을 보여준다", async () => {
  const [source, worker, core, css] = await Promise.all([
    read("../src/pages/ability.js"),
    read("../src/workers/ability-optimal.worker.js"),
    read("../../maple-core/src/ability.js"),
    read("../src/calculator.css"),
  ]);

  assert.match(core, /label: "최적 전략"/u);
  assert.match(core, /export function calculateAbilityOptimalStrategy/u);
  assert.match(worker, /calculateAbilityOptimalStrategy/u);
  assert.match(source, /new Worker\(/u);
  assert.match(source, /최적 전략을 계산하는 중/u);
  assert.match(core, /6개 이하의 순열/u);
  assert.match(core, /const STRATEGY_EXPECTED_CACHE = new Map/u);
  assert.match(core, /honor → value-only → honor/u);
  assert.match(source, /"미라클 서큘레이터 허용"/u);
  assert.match(source, /"블랙 서큘레이터 허용"/u);
  assert.match(source, /"카오스 서큘레이터 허용"/u);
  assert.match(source, /"미라클 보유량"/u);
  assert.match(source, /"블랙 보유량"/u);
  assert.match(source, /"카오스 보유량"/u);
  assert.match(source, /miracleCount: state\.miracleCount/u);
  assert.match(source, /미라클 성공 시/u);
  assert.match(source, /미라클 소진 시/u);
  assert.match(source, /추천 전략 평균 명성치/u);
  assert.match(source, /추천 진행 순서/u);
  assert.doesNotMatch(source, /"진행 순서"/u);
  assert.match(source, /자동 잠금/u);
  assert.match(css, /\.page--ability \.ability-strategy-options/u);
  assert.match(css, /\.page--ability \.ability-strategy-step/u);
});

test("어빌리티 목표 선택지는 지정한 인기 순서를 적용한다", async () => {
  const [source, data] = await Promise.all([
    read("../src/pages/ability.js"),
    read("../src/data/ability-job-usage.js"),
  ]);
  assert.match(source, /ABILITY_JOB_PRESETS/u);
  assert.match(
    source,
    /"boss-damage",\s*"cooldown-skip",\s*"passive-level",\s*"buff-duration",\s*"item-drop",\s*"meso-drop"/u,
  );
  assert.match(
    source,
    /"abnormal-damage",\s*"boss-damage",\s*"buff-duration",\s*"critical",\s*"cooldown-skip",\s*"attack",\s*"magic",\s*"item-drop",\s*"meso-drop"/u,
  );
  assert.match(source, /"보스용 적용"/u);
  assert.match(source, /"사냥용 적용"/u);
  assert.match(source, /applyJobPreset/u);
  assert.match(source, /sortedTargetOptions/u);
  assert.match(data, /"jobCount": 48/u);
  assert.match(data, /"나이트로드"/u);
  assert.match(data, /"비숍"/u);
});

test("어빌리티의 모든 드롭다운은 검색형이며 목록 높이를 충분히 확보한다", async () => {
  const [source, component, css] = await Promise.all([
    read("../src/pages/ability.js"),
    read("../src/shared/searchable-select.js"),
    read("../src/style.css"),
  ]);
  assert.match(source, /searchableSelect/u);
  assert.doesNotMatch(source, /nativeSelect\(/u);
  assert.match(component, /aria-autocomplete", "list"/u);
  assert.match(component, /if \(matches\.length === 1\)/u);
  assert.match(css, /\.search-select__options\s*\{[^}]*max-height:\s*min\(380px, 52dvh\);/su);
});

test("블랙·카오스 목표는 등급 선택 없이 목표 수치로 등급을 자동 판별한다", async () => {
  const source = await read("../src/pages/ability.js");
  assert.match(source, /function inferTargetGrade/u);
  assert.match(source, /function targetValueOptions/u);
  assert.match(source, /group: group\.label/u);
  assert.match(source, /groupTone: group\.tone/u);
  assert.match(source, /function targetValuesFor/u);
  assert.match(source, /\.sort\(\(left, right\) => right - left\)\.forEach/u);
  assert.match(source, /targetValueOptions\(target\.type, line, values, optionInfo\)/u);
  assert.doesNotMatch(source, /gradeOptions/u);
  assert.doesNotMatch(source, /ability-target-grade/u);
});

test("어빌리티 목표 수치는 드롭다운 안에서 등급별 머리글로 구분한다", async () => {
  const [source, component, css] = await Promise.all([
    read("../src/pages/ability.js"),
    read("../src/shared/searchable-select.js"),
    read("../src/style.css"),
  ]);
  assert.match(component, /search-select__group/u);
  assert.match(component, /heading\.dataset\.tone = option\.groupTone/u);
  assert.match(source, /ABILITY_GRADES\[grade\]\?\.label/u);
  assert.match(css, /search-select__group\[data-tone="legendary"\][^{]*\{[^}]*#62d98b/su);
  assert.match(css, /search-select__group\[data-tone="unique"\][^{]*\{[^}]*#f6cc62/su);
  assert.match(css, /search-select__group\[data-tone="epic"\][^{]*\{[^}]*#c99cff/su);
  assert.match(css, /search-select__option\[data-tone="legendary"\]:hover[^{]*\{[^}]*rgba\(98, 217, 139/su);
  assert.match(css, /search-select__option\[data-tone="unique"\]:hover[^{]*\{[^}]*rgba\(246, 204, 98/su);
  assert.match(css, /search-select__option\[data-tone="epic"\]:hover[^{]*\{[^}]*rgba\(201, 156, 255/su);
});

test("목표 초기화는 세 줄을 모두 선택 안 함으로 되돌린다", async () => {
  const source = await read("../src/pages/ability.js");
  assert.match(source, /targets:\s*\[\s*\{ type: "", minimum: 0, grade: "legendary"/u);
  assert.match(source, /function resetTargets\(\)\s*\{\s*state\.targets = structuredClone\(defaults\.targets\)/u);
});

test("목표 옵션 해제 버튼은 목록을 열지 않고 해당 줄을 선택 안 함으로 바꾼다", async () => {
  const [source, component, css] = await Promise.all([
    read("../src/pages/ability.js"),
    read("../src/shared/searchable-select.js"),
    read("../src/style.css"),
  ]);
  assert.match(source, /clearable: true/u);
  assert.match(component, /clear\.addEventListener\("pointerdown"[\s\S]*event\.stopPropagation\(\)/u);
  assert.match(component, /clear\.addEventListener\("click"[\s\S]*setOpen\(false\)[\s\S]*onChange\(""\)/u);
  assert.match(css, /\.search-select__clear\s*\{[^}]*opacity:\s*0\.32;/su);
  assert.match(css, /\.search-select__clear:hover[^{]*\{[^}]*opacity:\s*0\.95;/su);
  assert.match(css, /input\[type="search"\]::-webkit-search-cancel-button\s*\{[^}]*appearance:\s*none;/su);
});

test("계산 결과에는 입력 영역과 중복되는 줄별 목표 옵션을 다시 표시하지 않는다", async () => {
  const source = await read("../src/pages/ability.js");
  assert.doesNotMatch(source, /function targetLabel/u);
  assert.doesNotMatch(source, /section\.append\(resultLine\(LINE_NAMES\[line\]/u);
});

test("목표 도달 확률의 평균으로 보기는 평균 재설정과 같은 기댓값을 표시한다", async () => {
  const [source, component] = await Promise.all([
    read("../src/pages/ability.js"),
    read("../src/shared/reach-control.js"),
  ]);
  assert.match(source, /createReachChanceControl\(\{/u);
  assert.match(component, /"평균으로 보기"/u);
  assert.match(component, /modeStatus\.hidden = !averageMode/u);
  assert.match(component, /reset\.hidden = averageMode/u);
  assert.match(source, /targetChanceAverage: true/u);
  assert.match(source, /function averageEquivalentTargetChancePercent/u);
  assert.match(source, /const expectedResets = 1 \/ probability/u);
  assert.match(source, /1 - \(\(1 - probability\) \*\* expectedResets\)/u);
  assert.match(source, /averageMode\s*\? result\.expectedResets\s*:\s*calculateAbilityAttemptsForChance/su);
  assert.match(
    source,
    /averageValue: \(\) => averageEquivalentTargetChancePercent\(result\.probability\)/u,
  );
});

test("어빌리티 목표는 모바일에서도 줄 단위로 재배치한다", async () => {
  const css = await read("../src/calculator.css");
  assert.match(css, /\.page--ability \.ability-target-row\s*\{/u);
  assert.match(
    css,
    /\.page--ability \.ability-target-row\s*\{[^}]*grid-template-columns:\s*70px[^;]+;[^}]*gap:\s*6px;/su,
  );
  assert.match(
    css,
    /\.page--ability \.ability-lock\s*\{[^}]*display:\s*inline-flex;[^}]*justify-content:\s*center;[^}]*white-space:\s*nowrap;/su,
  );
  assert.match(
    css,
    /@media \(max-width: 620px\)[\s\S]*?\.page--ability \.ability-target-row\s*\{[^}]*grid-template-columns:/u,
  );
});

test("어빌리티는 목표 행이 넘치기 전에 결과 열을 아래로 전환한다", async () => {
  const css = await read("../src/calculator.css");
  assert.match(
    css,
    /@media \(max-width: 1040px\)[\s\S]*?\.page--ability \.calculator-grid--ability\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/u,
  );
  assert.match(
    css,
    /@media \(max-width: 1040px\)[\s\S]*?\.page--ability \.calculator-grid--ability \.calculator-result\s*\{[^}]*position:\s*static;/u,
  );
});
