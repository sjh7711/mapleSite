import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getAddOptionSourceLabel,
  orderAddOptionSources,
} from "../src/shared/add-option-display.js";

test("환불 결과는 검환불·심환불·강환불 순서와 약칭을 사용한다", () => {
  const sources = [
    { key: "strong" },
    { key: "abyss" },
    { key: "black" },
  ];
  const ordered = orderAddOptionSources(sources);

  assert.deepEqual(ordered.map(({ key }) => key), ["black", "abyss", "strong"]);
  assert.deepEqual(
    ordered.map(({ key }) => getAddOptionSourceLabel(key)),
    ["검환불", "심환불", "강환불"],
  );
});

test("추가옵션 화면의 시세·결과 문구와 카드 순서를 유지한다", async () => {
  const source = await readFile(
    new URL("../src/pages/add-option.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /"환불 시세"/);
  assert.match(source, /"검환불\(메소\) 1회 비용"/);
  assert.match(source, /\["환불", "확률", "평균 개수", "평균 비용"\]/);
  assert.match(source, /function setupCard\(\)/);
  assert.match(
    source,
    /element\("section", "card add-option-setup-card"\)/,
  );
  assert.match(source, /const setup = element\("div", "add-option-setup-grid"\)/);
  assert.match(source, /setup\.append\(equipmentSection\(\), marketSection\(\)\)/);
  assert.match(source, /row\(field\("장비 레벨"[\s\S]*targetSection\(\)/);
  assert.match(source, /const profile = getActiveProfile\(\)/);
  assert.match(
    source,
    /controls\.append\(\s*setupCard\(\),\s*characterProfileCard\(\{\s*extraContent: equivalenceDetails\(profile\),\s*collapseReferenceDetails: true,\s*equipmentMetric: "flame",\s*\}\),\s*\)/s,
  );
  assert.doesNotMatch(source, /ADD_OPTION_TABLES_SNAPSHOT_DATE/);
  assert.doesNotMatch(source, /추가옵션 공식 공개 확률 저장본/);
  assert.doesNotMatch(source, /검환불\(메소\)은 새 옵션을 보고 기존 옵션 유지 여부를 고를 수 있습니다/);
  assert.doesNotMatch(source, /전체 추첨 후보|옵션 풀|추첨 후보에는/);
  assert.doesNotMatch(source, /metricGrid\(|metric\("(?:환산 기준|목표 추옵|목표|장비)"/);
  assert.doesNotMatch(source, /불꽃 시세|검은 불꽃 메소 재설정|가장 싼/);
});

test("추가옵션 장비·목표와 환불 시세는 한 카드 안에서 반응형 구분선으로 나눈다", async () => {
  const source = await readFile(
    new URL("../src/pages/add-option.js", import.meta.url),
    "utf8",
  );
  const css = await readFile(
    new URL("../src/calculator.css", import.meta.url),
    "utf8",
  );

  assert.match(source, /"calculator-grid calculator-grid--add-option"/);
  assert.match(source, /"card add-option-setup-card"/);
  assert.match(source, /setup\.append\(equipmentSection\(\), marketSection\(\)\)/);
  assert.match(
    css,
    /\.page--calculator \.add-option-setup-grid\s*{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s,
  );
  assert.match(
    css,
    /\.page--calculator \.card\.add-option-setup-card\s*{[^}]*padding:\s*0;[^}]*overflow:\s*hidden;/s,
  );
  assert.match(
    css,
    /\.page--calculator \.add-option-setup-section--market::before\s*{[^}]*top:\s*20px;[^}]*bottom:\s*20px;[^}]*left:\s*0;[^}]*width:\s*1px;[^}]*background:\s*rgba\(255, 255, 255, 0\.08\);/s,
  );
  assert.match(
    css,
    /@media \(max-width: 620px\)[\s\S]*?\.page--calculator \.add-option-setup-grid\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/,
  );
  assert.match(
    css,
    /@media \(max-width: 620px\)[\s\S]*?\.page--calculator \.add-option-setup-section--market::before\s*{[^}]*top:\s*0;[^}]*right:\s*20px;[^}]*left:\s*20px;[^}]*height:\s*1px;/,
  );
});

test("좁은 화면에서는 계산 결과를 캐릭터 정보보다 먼저 배치한다", async () => {
  const css = await readFile(
    new URL("../src/calculator.css", import.meta.url),
    "utf8",
  );
  assert.match(
    css,
    /@media \(max-width: 1040px\) \{[\s\S]*?calculator-grid--add-option \.calculator-column \{\s*display: contents;[\s\S]*?add-option-setup-card \{\s*order: 1;[\s\S]*?calculator-result \{\s*order: 2;[\s\S]*?profile-card \{\s*order: 3;/u,
  );
});

test("추옵 환산 설정은 캐릭터 조회 전후 같은 자리를 유지한다", async () => {
  const source = await readFile(
    new URL("../src/pages/add-option.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /const manual = details\(\s*"추옵 환산 설정"/);
  assert.match(source, /manual\.dataset\.detailsKey = "add-option-equivalence"/);
  assert.match(source, /"주스탯 \+10"/);
  assert.match(source, /"부스탯 \+10"/);
  assert.match(source, /"공격력 \+10"/);
  assert.match(source, /"마력 \+10"/);
  assert.match(source, /"올스탯 \+1%"/);
  assert.match(source, /Number\(value\) \* inputAmount/);
  assert.match(source, /state\[key\] = next \/ inputAmount/);
  assert.ok(
    (source.match(/\{ inputAmount: 10/g) ?? []).length >= 8,
    "고정 스탯·공마 입력은 +10 기준이어야 합니다.",
  );
  assert.match(source, /데미지·보스 데미지 \+1%는 1로 고정합니다\./);
  assert.doesNotMatch(source, /보총 1% 환산|캐릭터를 불러오지 않을 때의 기준/);
  assert.doesNotMatch(source, /const manual = profile\s*\?/);
  assert.match(source, /function targetSection\(\)/);
  assert.match(source, /element\("section", "add-option-target-section"\)/);
  assert.match(source, /element\("h3", "", "목표 추옵"\)/);
  assert.doesNotMatch(source, /"목표 주스탯급"/);
  assert.match(
    source,
    /characterProfileCard\(\{\s*extraContent: equivalenceDetails\(profile\),\s*collapseReferenceDetails: true,\s*equipmentMetric: "flame",\s*\}\)/s,
  );
});

test("저장 닉네임은 중첩 박스 없이 독립된 목록 칩으로 표시한다", async () => {
  const source = await readFile(
    new URL("../src/shared/character-profile.js", import.meta.url),
    "utf8",
  );
  const css = await readFile(
    new URL("../src/calculator.css", import.meta.url),
    "utf8",
  );

  assert.match(source, /element\("ul", "profile-saved-names"\)/);
  assert.match(source, /element\("li", "profile-saved-character"\)/);
  assert.match(source, /item\.dataset\.active = String\(isActive\)/);
  assert.doesNotMatch(source, /"profile-saved-label", "저장"/);
  assert.match(source, /"현재 정보 초기화"/);
  assert.match(css, /\.profile-saved-names\s*{[^}]*list-style: none/s);
  assert.match(css, /\.profile-saved-character\[data-active="true"\]/);
  assert.doesNotMatch(css, /profile-saved-character__remove[^}]*border-left/s);
});
