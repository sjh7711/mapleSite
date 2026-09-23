import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getAvailablePotentialResetMethods,
  getPotentialRankUpInfo,
} from "maple-core/potential";

test("잠재 페이지가 선택한 큐브의 공식 표와 등업 정보를 함께 바꾼다", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("../src/shared/potential-page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/calculator.css", import.meta.url), "utf8"),
  ]);

  assert.match(source, /resetMethod: "meso"/);
  assert.match(source, /activeResetMethod\(\)\.tableSource/);
  assert.match(source, /loadPotentialTables\(\{\s*system: tableSource,/s);
  assert.match(source, /getPotentialRankUpInfo\(\{/);
  assert.match(source, /calculatePotentialRankUpExpected\(\{/);
  assert.match(source, /calculatePotentialRankUpReachForChance\(/);
  assert.match(source, /row\(field\("목표 등급", targetGradePicker\)\)/);
  assert.match(source, /rankProgressByGrade: \{ rare: 0, epic: 0, unique: 0 \}/);
  assert.match(source, /`rank-progress-\$\{stage\.fromGrade\}`/);
  assert.match(source, /천장 \(최대 \$\{maxProgress\}\)/);
  assert.doesNotMatch(source, /현재 천장 진행은 시작 등급에만 적용합니다\./);
  assert.match(source, /평균 총비용/);
  assert.match(source, /rankUpReachChanceSection\(plan, methodInfo\)/);
  assert.match(source, /calculationMode: "options"/);
  assert.match(source, /potentialSelectorGroup\("현재 등급", gradePicker\)/);
  assert.match(source, /potentialSelectorGroup\("목표", calculationModePicker, "target"\)/);
  assert.ok(
    source.indexOf('potentialSelectorGroup("현재 등급"')
      < source.indexOf('potential-reset-method__label", "재설정 방식"'),
    "현재 등급 제목은 재설정 방식보다 위에 있어야 합니다.",
  );
  assert.ok(
    source.indexOf('potential-reset-method__label", "재설정 방식"')
      < source.indexOf('potentialSelectorGroup("목표"'),
    "목표 제목은 재설정 방식보다 아래에 있어야 합니다.",
  );
  assert.ok(
    source.indexOf('chip("옵션뽑기"') < source.indexOf('chip("등급업"'),
    "계산 종류는 옵션뽑기 다음 등급업 순서여야 합니다.",
  );
  assert.match(source, /state\.calculationMode === "rank-up"/);
  assert.match(source, /return rankUpTargetCard\(\)/);
  assert.match(source, /각 등급의 현재 천장 진행과 등급별 재설정 비용/);
  assert.doesNotMatch(
    source,
    /state\.resetMethod = method\.id;\s*state\.rankProgressByGrade = \{ rare: 0, epic: 0, unique: 0 \};\s*state\.rankTargetGrade = "";/s,
    "재설정 방식 변경 시 선택한 목표 등급을 초기화하면 안 됩니다.",
  );
  assert.match(source, /displayedResetMethods\(system, state\.grade\)/);
  assert.match(source, /이 재설정 방식은 등급 상승 보장 횟수가 없습니다\./);
  assert.doesNotMatch(source, /const RANK_UP\s*=/);
  assert.match(
    css,
    /\.potential-system-switch \.chip,[\s\S]*\.potential-grade-picker \.chip,[\s\S]*\.potential-reset-method \.chip,[\s\S]*\.potential-calculation-mode \.chip \{[\s\S]*height: 34px;[\s\S]*white-space: nowrap;/,
  );
});

test("메소 재설정과 블랙·화이트 큐브를 별도 방식으로 표시한다", async () => {
  const source = await readFile(
    new URL("../src/shared/potential-page.js", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /return getAvailablePotentialResetMethods\(system, grade\);/u,
  );
  assert.doesNotMatch(source, /mergedMethod|canonicalResetMethod/u);

  assert.deepEqual(
    getAvailablePotentialResetMethods("regular", "legendary")
      .map(({ id, shortLabel }) => [id, shortLabel]),
    [
      ["meso", "메소"],
      ["black", "블큐"],
      ["gold", "골큐"],
      ["prime", "프큐"],
    ],
  );
  assert.deepEqual(
    getAvailablePotentialResetMethods("additional", "legendary")
      .map(({ id, shortLabel }) => [id, shortLabel]),
    [
      ["meso", "메소"],
      ["white", "화에큐"],
      ["prime", "프에큐"],
    ],
  );
});

test("에디셔널 메소와 화이트 큐브의 등업 확률·천장을 구분한다", () => {
  const meso = getPotentialRankUpInfo({
    system: "additional",
    method: "meso",
    grade: "rare",
  });
  const white = getPotentialRankUpInfo({
    system: "additional",
    method: "white",
    grade: "rare",
  });

  assert.equal(meso.probability, 0.02381);
  assert.equal(meso.pity, 62);
  assert.equal(white.probability, 0.047619);
  assert.equal(white.pity, 31);
});

test("목표 프리셋은 계산 결과 아래에서 저장·불러오기·삭제할 수 있다", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("../src/shared/potential-page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/calculator.css", import.meta.url), "utf8"),
  ]);

  assert.match(source, /target-presets:v1/);
  assert.match(source, /현재 목표 저장/);
  assert.match(source, /저장된 목표 프리셋/);
  assert.match(source, /저장 당시 기댓값/);
  assert.match(source, /state\.targetSets = targetSets/);
  assert.match(source, /savedTargetPresets = savedTargetPresets\.filter/);
  assert.match(source, /const results = \[resultCard\(\)\]/);
  assert.match(source, /state\.calculationMode === "options"[\s\S]*results\.push\(savedTargetPresetCard\(\)\)/);
  assert.match(css, /\.target-preset-library__list\s*\{/);
  assert.match(css, /max-height: 340px/);
  assert.match(css, /overflow-y: auto/);
});

test("윗잠 장신구 정옵션은 -3%와 드메 포함을 독립 전환한다", async () => {
  const source = await readFile(
    new URL("../src/shared/potential-page.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /presetIncludeNearOptimal: false/u);
  assert.match(source, /presetIncludeDropMeso: true/u);
  assert.match(source, /"-3% 포함"/u);
  assert.match(source, /"드메 포함"/u);
  assert.match(source, /정옵션 -3%/u);
  assert.match(source, /정옵션 -3%까지 포함합니다/u);
  assert.match(source, /Lv\.250은 30%, Lv\.200은 27% 이상/u);
});

test("주스탯 %급 목표만 소수점 입력 초안을 유지한다", async () => {
  const [page, combined, ui] = await Promise.all([
    readFile(new URL("../src/shared/potential-page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/combined-potential-page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/ui.js", import.meta.url), "utf8"),
  ]);

  assert.match(page, /allowDecimalDraft: target\.type === "stat-equivalent"/u);
  assert.match(combined, /allowDecimalDraft: target\.type === "stat-equivalent"/u);
  assert.match(ui, /element\.type = allowDecimalDraft \? "text" : "number"/u);
  assert.match(ui, /\^\\d\*\(\?:\\\.\\d\*\)\?\$/u);
});
