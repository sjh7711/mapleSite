import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  POTENTIAL_PAGE_TARGETS,
  calculatePotentialExpected,
  encodeExactPotentialTargetType,
  getAvailablePotentialTargetTypes,
} from "maple-core/potential";
import {
  ADDITIONAL_TARGET_TYPE_ORDER,
  DEFAULT_TARGET_CHANCE_PERCENT,
  PRIORITY_POTENTIAL_TARGET_TYPES,
  TARGET_CHANCE_DEFAULT_REVISION,
  getPotentialTargetInfo,
  getPotentialTargetTypesForRow,
  isCompletePotentialTarget,
  migratePotentialTargetChanceDefault,
  normalizePotentialTargetChance,
  orderPotentialTargetTypes,
  summarizePotentialTargetEquivalents,
} from "../src/shared/potential-target-ui.js";

const ADDITIONAL_NUMERIC_TARGETS = [
  "str-flat",
  "dex-flat",
  "int-flat",
  "luk-flat",
  "all-stat-flat",
  "str-per-nine",
  "dex-per-nine",
  "int-per-nine",
  "luk-per-nine",
  "attack-power-flat",
  "magic-power-flat",
  "damage",
  "critical-rate",
  "hp-flat",
  "auto-steal",
];

async function additionalHatTables() {
  const base = new URL("../public/potential-tables/", import.meta.url);
  const [index, packed] = await Promise.all([
    readFile(new URL("index.json", base), "utf8").then(JSON.parse),
    readFile(new URL("additional-legendary-6-120.json", base), "utf8")
      .then(JSON.parse),
  ]);
  return packed.map((line) =>
    line.map(([nameIndex, probability]) => ({
      name: index.names[nameIndex],
      probability,
    })),
  );
}

test("평균 비용 기준 63.21%를 기본으로 쓰고 과거 50%만 한 번 옮긴다", () => {
  assert.equal(
    DEFAULT_TARGET_CHANCE_PERCENT,
    Math.round((1 - Math.exp(-1)) * 10_000) / 100,
  );
  const migratedLegacyDefault = migratePotentialTargetChanceDefault({
    targetChancePercent: 50,
  });
  assert.deepEqual(migratedLegacyDefault, {
    targetChancePercent: 63.21,
    targetChanceDefaultRevision: TARGET_CHANCE_DEFAULT_REVISION,
  });
  assert.deepEqual(
    migratePotentialTargetChanceDefault(migratedLegacyDefault),
    migratedLegacyDefault,
  );
  assert.deepEqual(migratePotentialTargetChanceDefault({}), {
    targetChancePercent: 63.21,
    targetChanceDefaultRevision: TARGET_CHANCE_DEFAULT_REVISION,
  });
  assert.deepEqual(
    migratePotentialTargetChanceDefault({ targetChancePercent: 73.45 }),
    {
      targetChancePercent: 73.45,
      targetChanceDefaultRevision: TARGET_CHANCE_DEFAULT_REVISION,
    },
  );
  assert.deepEqual(
    migratePotentialTargetChanceDefault({
      targetChancePercent: 50,
      targetChanceDefaultRevision: TARGET_CHANCE_DEFAULT_REVISION,
    }),
    {
      targetChancePercent: 50,
      targetChanceDefaultRevision: TARGET_CHANCE_DEFAULT_REVISION,
    },
  );
  assert.equal(normalizePotentialTargetChance(undefined), 63.21);
  assert.equal(normalizePotentialTargetChance(120), 99.99);
});

test("잠재·에디·자석펫 목표 확률 입력은 소수와 % 자리를 함께 확보한다", async () => {
  const [potentialPage, petPage, reachControl, css] = await Promise.all([
    readFile(new URL("../src/shared/potential-page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/pet.js", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/reach-control.js", import.meta.url), "utf8"),
    readFile(new URL("../src/calculator.css", import.meta.url), "utf8"),
  ]);

  for (const source of [potentialPage, petPage]) {
    assert.match(source, /createReachChanceControl\(\{/u);
  }
  assert.match(reachControl, /element\("span", "reach-control__number"\)/);
  assert.match(reachControl, /element\("span", "reach-control__unit", "%"\)/);
  assert.match(
    css,
    /\.page--calculator \.reach-control__inputs\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) clamp\(7\.5rem, 12vw, 8rem\);/s,
  );
  assert.match(
    css,
    /\.page--calculator \.reach-control__number\s*\{[^}]*min-width:\s*7\.5rem;/s,
  );
  assert.match(
    css,
    /\.page--calculator \.reach-control__number input\s*\{[^}]*min-width:\s*7\.5rem;[^}]*padding-right:\s*2rem;[^}]*appearance:\s*textfield;/s,
  );
  assert.match(
    css,
    /\.page--calculator \.reach-control__unit\s*\{[^}]*right:\s*0\.75rem;/s,
  );
});

test("에디셔널 신규 수치 목표를 빠짐없이 표시 순서에 포함한다", () => {
  for (const type of ADDITIONAL_NUMERIC_TARGETS) {
    assert.ok(
      ADDITIONAL_TARGET_TYPE_ORDER.includes(type),
      `${type} 표시 순서가 필요합니다.`,
    );
  }
});

test("에디셔널 목표를 mesu 유효 옵션 순서로 정렬한다", () => {
  const input = [
    "unknown-future-target",
    "critical-rate",
    "attack-power-flat",
    "str-per-nine",
    "str-flat",
    "str-percent",
    "stat-equivalent",
  ];

  assert.deepEqual(
    orderPotentialTargetTypes(input, { system: "additional" }),
    [
      "critical-rate",
      "stat-equivalent",
      "str-percent",
      "str-per-nine",
      "str-flat",
      "attack-power-flat",
      "unknown-future-target",
    ],
  );
  assert.deepEqual(
    orderPotentialTargetTypes(input, { system: "regular" }),
    [
      "critical-rate",
      "unknown-future-target",
      "str-per-nine",
      "str-flat",
      "str-percent",
      "stat-equivalent",
      "attack-power-flat",
    ],
  );
});

test("잠재와 에디셔널의 주요 특수 옵션을 목록 위에 같은 순서로 배치한다", () => {
  const requested = [
    "attack-power-percent",
    "magic-power-percent",
    "boss-damage",
    "ignore-defense",
    "damage",
    "cooldown",
    "critical-damage",
    "critical-rate",
  ];
  const input = [
    "stat-equivalent",
    "critical-rate",
    "critical-damage",
    "str-percent",
    "cooldown",
    "damage",
    "ignore-defense",
    "boss-damage",
    "magic-power-percent",
    "attack-power-percent",
  ];

  assert.deepEqual(PRIORITY_POTENTIAL_TARGET_TYPES, requested);
  assert.deepEqual(
    orderPotentialTargetTypes(input, { system: "regular" }).slice(0, 8),
    requested,
  );
  assert.deepEqual(
    orderPotentialTargetTypes(input, { system: "additional" }).slice(0, 8),
    requested,
  );
});

test("일반 잠재는 데미지·크리티컬 확률과 공격력·마력만 추가로 노출한다", () => {
  const tables = [
    [
      { name: "STR +32", probability: 10 },
      { name: "올스탯 +10", probability: 10 },
      { name: "최대 HP +600", probability: 10 },
      { name: "공격력 +32", probability: 10 },
      { name: "마력 +32", probability: 10 },
    ],
    [
      { name: "데미지 +13%", probability: 50 },
      { name: "크리티컬 확률 +13%", probability: 50 },
    ],
  ];
  const available = getAvailablePotentialTargetTypes(tables, {
    part: 1,
    system: "regular",
  });

  for (const type of [
    "damage",
    "critical-rate",
    "attack-power-flat",
    "magic-power-flat",
  ]) {
    assert.ok(available.includes(type), `${type} 일반 잠재 목표가 누락됐습니다.`);
  }
  for (const type of [
    "str-flat",
    "dex-flat",
    "int-flat",
    "luk-flat",
    "all-stat-flat",
    "hp-flat",
    "str-per-nine",
  ]) {
    assert.ok(!available.includes(type), `${type} 고정 수치가 노출됐습니다.`);
  }

  const ordered = orderPotentialTargetTypes(available, { system: "regular" });
  assert.deepEqual(ordered.slice(-2), [
    "attack-power-flat",
    "magic-power-flat",
  ]);
});

test("잠재와 에디셔널의 장비 부위 목록은 한벌옷을 마지막에 둔다", async () => {
  const source = await readFile(
    new URL("../src/shared/potential-page.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /left\.label === "한벌옷"/u);
  assert.match(source, /right\.label === "한벌옷"/u);
});

test("잠재와 에디셔널 목표 옵션은 각 줄을 바로 선택 해제할 수 있다", async () => {
  const [source, component, css] = await Promise.all([
    readFile(new URL("../src/shared/potential-page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/searchable-select.js", import.meta.url), "utf8"),
    readFile(new URL("../src/style.css", import.meta.url), "utf8"),
  ]);

  assert.match(source, /placeholder: "옵션 검색",\s*clearable: true/u);
  assert.match(source, /\{ value: "", label: "없음" \}/u);
  assert.match(source, /target\.type = value;\s*target\.value = "";/u);
  assert.doesNotMatch(source, /CLEAR_TARGET_VALUE/u);
  assert.match(component, /clear\.addEventListener\("pointerdown"[\s\S]*event\.stopPropagation\(\)/u);
  assert.match(component, /clear\.addEventListener\("click"[\s\S]*setOpen\(false\)[\s\S]*onChange\(""\)/u);
  assert.match(css, /\.search-select__clear\s*\{[^}]*opacity:\s*0\.32;/su);
  assert.match(css, /\.search-select__clear:hover[^{]*\{[^}]*opacity:\s*0\.95;/su);
});

test("잠재와 에디셔널 목표 도달 확률은 평균으로 보기로 되돌린다", async () => {
  const [source, component] = await Promise.all([
    readFile(new URL("../src/shared/potential-page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/reach-control.js", import.meta.url), "utf8"),
  ]);
  const control = source.slice(
    source.indexOf("function reachChanceSection("),
    source.indexOf("function resultCard("),
  );

  assert.match(control, /createReachChanceControl\(\{/u);
  assert.match(control, /DEFAULT_TARGET_CHANCE_PERCENT/u);
  assert.match(control, /averageValue: DEFAULT_TARGET_CHANCE_PERCENT/u);
  assert.match(component, /"평균으로 보기"/u);
  assert.doesNotMatch(component, /"초기화"/u);
  assert.match(component, /modeStatus\.hidden = !averageMode/u);
  assert.match(component, /reset\.hidden = averageMode/u);
});

test("공식 원문 잡옵은 화면 목표로 다시 노출하지 않는다", () => {
  const optionName = "공격 시 3% 확률로 47의 HP 회복";
  const type = encodeExactPotentialTargetType(optionName);

  assert.equal(getPotentialTargetInfo(type), null);
  assert.equal(isCompletePotentialTarget({ type, value: "" }), false);
  assert.equal(isCompletePotentialTarget({ type, value: "1" }), false);
  assert.equal(isCompletePotentialTarget({ type, value: "3" }), false);
  assert.equal(isCompletePotentialTarget({ type, value: "4" }), false);
  assert.equal(isCompletePotentialTarget({ type, value: "1.5" }), false);
});

test("화면 라벨은 고정 표현 없이 % 유무로 수치 옵션을 구분한다", () => {
  assert.deepEqual(
    Object.fromEntries([
      "str-flat",
      "str-percent",
      "all-stat-flat",
      "all-stat-percent",
      "attack-power-flat",
      "attack-power-percent",
    ].map((type) => [type, POTENTIAL_PAGE_TARGETS[type].label])),
    {
      "str-flat": "STR",
      "str-percent": "STR %",
      "all-stat-flat": "올스탯",
      "all-stat-percent": "올스탯 %",
      "attack-power-flat": "공격력",
      "attack-power-percent": "공격력 %",
    },
  );
  assert.ok(
    Object.values(POTENTIAL_PAGE_TARGETS).every(({ label }) =>
      !label.includes("고정") && !/\bMP\b/i.test(label)
    ),
  );
});

test("세트 환산은 가능한 조건만 합산하고 제외한 목표 이름을 표시한다", () => {
  assert.equal(
    summarizePotentialTargetEquivalents([
      { label: "INT 8%", mainStatPercent: 8, attackPercent: 1.5 },
      { label: "크리티컬 확률 10%", mainStatPercent: null, attackPercent: null },
    ]),
    "조건 기준 환산 · 주스탯 8%급 · 공/마 1.5%급 · 환산 제외: 크리티컬 확률 10%",
  );
  assert.equal(
    summarizePotentialTargetEquivalents([
      { label: "방어력 12%", mainStatPercent: null, attackPercent: null },
    ]),
    "조건 기준 환산 · 환산 가능한 조건 없음 · 환산 제외: 방어력 12%",
  );
});

test("캐릭터 정보가 없어도 에디셔널 직접 목표를 고를 수 있다", () => {
  const availableTargetTypes = [
    "stat-equivalent",
    "str-flat",
    "str-per-nine",
    "attack-power-flat",
    "damage",
  ];
  const targets = [
    { type: "", value: "" },
    { type: "", value: "" },
    { type: "", value: "" },
  ];

  assert.deepEqual(
    getPotentialTargetTypesForRow({
      availableTargetTypes,
      targets,
      index: 0,
      hasProfile: false,
    }),
    ["str-flat", "str-per-nine", "attack-power-flat", "damage"],
  );
});

test("주스탯%급은 캐릭터 정보가 있을 때 첫 줄에만 허용한다", () => {
  const availableTargetTypes = ["stat-equivalent", "str-flat", "damage"];
  const targets = [
    { type: "stat-equivalent", value: "12" },
    { type: "", value: "" },
    { type: "", value: "" },
  ];

  assert.deepEqual(
    getPotentialTargetTypesForRow({
      availableTargetTypes,
      targets,
      index: 0,
      hasProfile: true,
    }),
    availableTargetTypes,
  );
  assert.deepEqual(
    getPotentialTargetTypesForRow({
      availableTargetTypes,
      targets,
      index: 1,
      hasProfile: true,
    }),
    [],
  );
});

test("모든 성공 조건은 같은 행에서 오름차순과 내림차순을 선택한다", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("../src/shared/potential-page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/calculator.css", import.meta.url), "utf8"),
  ]);

  assert.match(source, /statEquivalentSortDirection: "asc"/u);
  assert.match(
    source,
    /!\["asc", "desc"\]\.includes\(state\.statEquivalentSortDirection\)[\s\S]*state\.statEquivalentSortDirection = "asc"/u,
  );
  assert.match(source, /sortDirection: state\.statEquivalentSortDirection/u);
  assert.doesNotMatch(source, /if \(!hasStatEquivalentTarget\) return node;/u);
  assert.match(source, /chip\(\s*"오름차순"[\s\S]*chip\(\s*"내림차순"/u);
  assert.match(source, /aria-label", "성공 조건 정렬"/u);
  assert.match(source, /panel\.append\(node, sortControls\)/u);
  assert.match(
    css,
    /\.success-conditions-panel\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/su,
  );
  assert.match(
    css,
    /\.success-condition-sort\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*1;/su,
  );
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.success-condition-sort \.chip/u);
});

test("성공 조건 상세는 확률표 재로딩 뒤에도 펼침 상태를 유지한다", async () => {
  const source = await readFile(
    new URL("../src/shared/potential-page.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /successConditionsOpen: false/u);
  assert.match(
    source,
    /state\.successConditionsOpen = state\.successConditionsOpen === true/u,
  );
  assert.match(source, /node\.open = state\.successConditionsOpen/u);
  assert.match(
    source,
    /node\.addEventListener\("toggle", \(\) => \{\s*state\.successConditionsOpen = node\.open;\s*persist\(\);\s*\}\)/u,
  );
});

test("잠재·에디·통합 결과에서 중복 설명 문구를 표시하지 않는다", async () => {
  const [potentialPage, combinedPage] = await Promise.all([
    readFile(new URL("../src/shared/potential-page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/shared/combined-potential-page.js", import.meta.url), "utf8"),
  ]);
  const source = `${potentialPage}\n${combinedPage}`;

  for (const copy of [
    "아래 옵션을 함께 얻으면 성공하며, 표시되지 않은 나머지 줄은 무관합니다.",
    "현재와 완전히 같은 결과를 제외한 조건부 확률을 적용합니다.",
    "여러 세트를 동시에 만족하는 조합도 한 번만 계산합니다.",
    "방어율 무시는 현재 캐릭터의 방무와 선택한 보스 방어율을 기준으로 환산합니다.",
    "추천한 목표를 윗잠과 아랫잠에서 각각 완성할 때의 합산 기댓값입니다.",
  ]) {
    assert.ok(!source.includes(copy), `제거한 설명이 다시 표시됩니다: ${copy}`);
  }
  assert.ok(!source.includes("tablesSavedAt"));
  assert.ok(!source.includes("formatSnapshotDate"));
});

test("에디셔널 모자는 유효 옵션을 남기고 MP·잡옵 목표를 숨긴다", async () => {
  const tables = await additionalHatTables();
  const available = getAvailablePotentialTargetTypes(tables, {
    part: 6,
    system: "additional",
  });

  for (const type of [
    "str-flat",
    "str-per-nine",
    "hp-flat",
    "attack-power-flat",
    "critical-damage",
    "meso",
    "drop",
  ]) {
    assert.ok(available.includes(type), `${type} 목표가 공식 모자 표에 있습니다.`);
  }
  for (const type of [
    "mp-percent",
    "mp-flat",
    "mp-cost-reduction",
    "defense-percent",
    "defense-flat",
    "speed",
    "jump",
    "healing-efficiency",
  ]) assert.ok(!available.includes(type), `${type} 잡옵이 노출됐습니다.`);
  assert.ok(!available.some((type) => type.startsWith("exact-option:")));
});

test("캐릭터 정보 없이 에디셔널 수치·레벨당 목표 확률을 계산한다", async () => {
  const tables = await additionalHatTables();
  for (const [targetType, target] of [
    ["str-flat", 20],
    ["str-per-nine", 2],
    ["attack-power-flat", 16],
    ["hp-flat", 300],
  ]) {
    const result = calculatePotentialExpected({
      tables,
      targetSets: [[{ targetType, target }]],
      system: "additional",
      grade: "legendary",
      itemLevel: 200,
    });
    assert.ok(result.probability > 0, `${targetType} 성공 확률이 필요합니다.`);
    assert.ok(Number.isFinite(result.expectedResets));
  }
});
