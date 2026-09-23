import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CHARACTER_PROFILE_EQUIPMENT_BOARD_SLOTS,
  calculateCharacterEquipmentExpectations,
  getCharacterEquipmentDetailRows,
  getCharacterEquipmentConversionLabel,
  getCharacterEquipmentBoardLayout,
  getCharacterEquipmentDetailValues,
  getEquipmentTooltipPlacement,
  getEquipmentTooltipBreakdown,
  getCharacterEquipmentMetric,
  getCharacterEquipmentQuickValue,
  getCharacterEquipmentTooltipModel,
  fitCharacterEquipmentQuickValue,
  resolveCharacterEquipmentPotentialLineGrades,
} from "../src/shared/character-equipment-summary.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("장착 장비 환산값은 화면 모드에 맞는 값만 표시한다", () => {
  const item = {
    potentialMainStatPercent: 27.4,
    additionalMainStatPercent: 8.6,
    addOptionScore: 112.5,
    addOptionUnit: "급",
  };

  assert.deepEqual(getCharacterEquipmentMetric(item, "regular"), {
    value: 27.4,
    unit: "%급",
    shortUnit: "급",
    label: "윗잠",
  });
  assert.deepEqual(getCharacterEquipmentMetric(item, "additional"), {
    value: 8.6,
    unit: "%급",
    shortUnit: "급",
    label: "에디",
  });
  assert.deepEqual(getCharacterEquipmentMetric(item, "combined"), {
    value: 36,
    unit: "%급",
    shortUnit: "급",
    label: "통합",
  });
  assert.deepEqual(getCharacterEquipmentMetric(item, "flame"), {
    value: 112.5,
    unit: "급",
    shortUnit: "급",
    label: "추옵",
  });
});

test("윗잠과 아랫잠의 유효 옵션을 소수 둘째 자리 형식으로 함께 요약한다", () => {
  assert.deepEqual(
    getCharacterEquipmentDetailValues({
      potentialSummary: {
        statEquivalentPercent: 30.9,
        bossDamagePercent: 40,
        attackMagicPercent: 12,
        cooldownSeconds: 2,
        criticalDamagePercent: 8,
      },
      additionalPotentialSummary: {
        statEquivalentPercent: 9,
        bossDamagePercent: null,
        attackMagicPercent: 3,
        cooldownSeconds: null,
      },
      addOptionScore: 120,
      addOptionUnit: "급",
    }),
    [
      "윗잠 크뎀 +8%",
      "윗잠 재사용 +2초",
      "윗잠 30.90% 급",
      "윗잠 보공 +40%",
      "윗잠 공/마 +12%",
      "아랫잠 9.00% 급",
      "아랫잠 공/마 +3%",
      "추옵 120급",
    ],
  );
  const magicRows = getCharacterEquipmentDetailRows(
    {
      part: "엠블렘",
      potentialSummary: {
        statEquivalentPercent: 4.5,
        attackMagicPercent: 18,
      },
    },
    null,
    { attackType: "magic" },
  );
  assert.equal(magicRows[0].value, "마18% + 4.50% 급");
});

test("장착 장비의 잠재 %급은 메소 재설정 기댓값으로 계산한다", async () => {
  const tables = [
    [{ name: "STR +12%", probability: 1 }],
    [{ name: "STR +9%", probability: 1 }],
    [{ name: "STR +9%", probability: 1 }],
  ];
  const expectations = await calculateCharacterEquipmentExpectations(
    {
      part: "모자",
      itemLevel: 200,
      potentialGrade: "레전드리",
      potentialSummary: { statEquivalentPercent: 30 },
      additionalPotentialSummary: null,
      addOptionScore: null,
    },
    {
      mainStat: "STR",
      subStat: "DEX",
      subStats: ["DEX"],
      attackType: "attack",
      character: { level: 290 },
    },
    { loadTables: async () => tables },
  );

  assert.equal(expectations.upper.status, "calculated");
  assert.ok(expectations.upper.expectedMeso > 0);
  assert.equal(expectations.lower.status, "not_applicable");
  assert.equal(expectations.flame.status, "not_applicable");
});

test("무기 종합 추옵은 기본 공·마를 사용해 검환불 기댓값을 계산한다", async () => {
  const expectations = await calculateCharacterEquipmentExpectations(
    {
      part: "무기",
      itemLevel: 250,
      flameAdvantaged: true,
      weaponFlameTier: 2,
      weaponBaseAttack: 400,
      weaponAddOptionPercent: 18.9,
      addOptionScore: 100,
      potentialSummary: null,
      additionalPotentialSummary: null,
    },
    {
      mainStat: "STR",
      subStat: "DEX",
      attackType: "attack",
      addOptionEquivalence: {
        flatStatToDamagePercent: {
          STR: 0.11,
          DEX: 0.0275,
          INT: 0,
          LUK: 0,
          HP: 0,
        },
        flatAttackToDamagePercent: 0.3212,
        allStatPercentToDamagePercent: 1.12,
        bossDamageToDamagePercent: 0.8,
        targetToDamagePercent: 0.11,
      },
    },
  );

  assert.equal(expectations.flame.status, "calculated");
  assert.ok(expectations.flame.expectedMeso > 0);
  assert.ok(Number.isFinite(expectations.flame.expectedMeso));
});

test("아케인셰이드 무기는 공마 추 등급이 없어도 현재 추옵 점수로 계산한다", async () => {
  const expectations = await calculateCharacterEquipmentExpectations(
    {
      name: "아케인셰이드 튜너",
      part: "무기",
      itemLevel: 200,
      flameAdvantaged: true,
      weaponFlameTier: null,
      weaponBaseAttack: 295,
      addOptionScore: 120,
      potentialSummary: null,
      additionalPotentialSummary: null,
    },
    {
      mainStat: "STR",
      subStat: "DEX",
      attackType: "attack",
      addOptionEquivalence: {
        flatStatToDamagePercent: {
          STR: 0.11,
          DEX: 0.0275,
          INT: 0,
          LUK: 0,
          HP: 0,
        },
        flatAttackToDamagePercent: 0.3212,
        allStatPercentToDamagePercent: 1.12,
        bossDamageToDamagePercent: 0.8,
        targetToDamagePercent: 0.11,
      },
    },
  );

  assert.equal(expectations.flame.status, "calculated");
  assert.ok(Number.isFinite(expectations.flame.expectedMeso));
  assert.ok(expectations.flame.expectedMeso > 0);
});

test("무기 잠재 기댓값은 공마·보공·데미지·방무를 보스전 %급에 포함한다", async () => {
  const expectations = await calculateCharacterEquipmentExpectations(
    {
      part: "무기",
      itemLevel: 200,
      potentialGrade: "레전드리",
      potentialSummary: {
        statEquivalentPercent: 0,
        bossDamagePercent: 40,
        damagePercent: 9,
        attackMagicPercent: 12,
        ignoreDefensePercent: 40,
      },
      additionalPotentialSummary: null,
      addOptionScore: null,
    },
    {
      mainStat: "STR",
      subStat: "DEX",
      subStats: ["DEX"],
      attackType: "attack",
      character: { level: 290 },
      statEquivalence: {
        flatMainStatToPercent: 0.01,
        attackToMainStat: 3,
        allStatPercentToMainPercent: 1.1,
        criticalDamageToMainPercent: 3.2,
        attackPercentToMainPercent: 3,
        bossDamageToMainPercent: 0.25,
        currentIgnoreDefense: 0.96,
        oneMainPercentRelative: 0.01,
      },
    },
    {
      loadTables: async () => [
        [{ name: "공격력 +15%", probability: 1 }],
        [{ name: "보스 몬스터 공격 시 데미지 +40%", probability: 1 }],
        [{ name: "몬스터 방어율 무시 +40%", probability: 1 }],
      ],
    },
  );

  assert.equal(expectations.upper.status, "calculated");
  assert.ok(expectations.upper.targetEquivalentPercent > 50);
  assert.ok(expectations.upper.expectedMeso > 0);
});

test("모자 재사용 감소와 장갑 크뎀을 잠재 기댓값 조건에 포함한다", async () => {
  const profile = {
    mainStat: "INT",
    subStat: "LUK",
    subStats: ["LUK"],
    attackType: "magic",
    character: { level: 290 },
    statEquivalence: {
      flatMainStatToPercent: 0.01,
      attackToMainStat: 3,
      allStatPercentToMainPercent: 1.1,
      criticalDamageToMainPercent: 3.2,
      attackPercentToMainPercent: 3,
      bossDamageToMainPercent: 0.25,
      currentIgnoreDefense: 0.96,
      oneMainPercentRelative: 0.01,
    },
  };
  const hat = await calculateCharacterEquipmentExpectations(
    {
      part: "모자",
      itemLevel: 250,
      potentialGrade: "레전드리",
      potentialSummary: {
        statEquivalentPercent: 14.7,
        cooldownSeconds: 2,
      },
    },
    profile,
    {
      loadTables: async () => [
        [
          { name: "스킬 재사용 대기시간 -2초", probability: 0.1 },
          { name: "DEX +12%", probability: 0.9 },
        ],
        [{ name: "INT +12%", probability: 1 }],
        [{ name: "올스탯 +3%", probability: 1 }],
      ],
    },
  );
  assert.equal(hat.upper.status, "calculated");
  assert.ok(hat.upper.expectedMeso > 0);

  const glove = await calculateCharacterEquipmentExpectations(
    {
      part: "장갑",
      itemLevel: 250,
      potentialGrade: "레전드리",
      potentialSummary: {
        statEquivalentPercent: 0,
        criticalDamagePercent: 8,
      },
    },
    profile,
    {
      loadTables: async () => [
        [
          { name: "크리티컬 데미지 +8%", probability: 0.1 },
          { name: "DEX +12%", probability: 0.9 },
        ],
        [{ name: "DEX +12%", probability: 1 }],
        [{ name: "DEX +12%", probability: 1 }],
      ],
    },
  );
  assert.equal(glove.upper.status, "calculated");
  assert.equal(glove.upper.targetEquivalentPercent, 25.6);
  assert.ok(glove.upper.expectedMeso > 0);
});

test("기댓값 상세 행은 잠재 합계를 추옵보다 먼저 두고 합산 %급도 표시한다", () => {
  const rows = getCharacterEquipmentDetailRows(
    {
      potentialSummary: { statEquivalentPercent: 30 },
      additionalPotentialSummary: { statEquivalentPercent: 9 },
      addOptionScore: 120,
      addOptionUnit: "급",
    },
    {
      upper: {
        status: "calculated",
        expectedMeso: 1_000_000_000,
        targetEquivalentPercent: 30,
      },
      lower: {
        status: "calculated",
        expectedMeso: 500_000_000,
        targetEquivalentPercent: 9,
      },
      flame: { status: "calculated", expectedMeso: 300_000_000 },
    },
  );

  assert.deepEqual(rows.map(({ key }) => key), [
    "upper",
    "lower",
    "potential-total",
    "flame",
  ]);
  assert.equal(rows[2].spec, "39.00% 급");
  assert.match(rows[2].expectation, /15\.00억 메소/);
});

test("잠재 합계는 모자 재사용을 표시하고 장갑 크뎀은 %급에만 합산한다", () => {
  const calculated = (targetEquivalentPercent) => ({
    status: "calculated",
    expectedMeso: 100_000_000,
    targetEquivalentPercent,
  });
  const hat = getCharacterEquipmentDetailRows(
    {
      part: "모자",
      potentialSummary: {
        statEquivalentPercent: 21.27,
        cooldownSeconds: 2,
      },
      additionalPotentialSummary: {
        statEquivalentPercent: 11.91,
        cooldownSeconds: 1,
      },
    },
    {
      upper: calculated(21.27),
      lower: calculated(11.91),
      flame: { status: "not_applicable" },
    },
  );
  const glove = getCharacterEquipmentDetailRows(
    {
      part: "장갑",
      potentialSummary: {
        statEquivalentPercent: 6.76,
        criticalDamagePercent: 16,
      },
      additionalPotentialSummary: {
        statEquivalentPercent: 9,
        criticalDamagePercent: 3,
      },
    },
    {
      upper: calculated(30),
      lower: calculated(15),
      flame: { status: "not_applicable" },
    },
  );

  assert.equal(hat[2].spec, "재사용 +3초 · 33.18% 급");
  assert.equal(glove[2].spec, "45.00% 급");
});

test("장갑 크뎀과 모자 재사용은 일반 %급보다 먼저 표시한다", () => {
  const glove = getCharacterEquipmentDetailRows({
    part: "장갑",
    potentialSummary: {
      statEquivalentPercent: 6.76,
      criticalDamagePercent: 3,
    },
  });
  const hat = getCharacterEquipmentDetailRows({
    part: "모자",
    potentialSummary: {
      statEquivalentPercent: 26,
      cooldownSeconds: 2,
    },
  });

  assert.equal(glove[0].value, "크뎀 +3% · 6.76% 급");
  assert.equal(hat[0].value, "재사용 +2초 · 26.00% 급");
});

test("누락된 잠재·추옵은 0급으로 오인하지 않는다", () => {
  const item = {
    potentialMainStatPercent: null,
    additionalMainStatPercent: undefined,
    addOptionScore: "",
  };

  assert.equal(getCharacterEquipmentMetric(item, "regular"), null);
  assert.equal(getCharacterEquipmentMetric(item, "additional"), null);
  assert.equal(getCharacterEquipmentMetric(item, "combined"), null);
  assert.equal(getCharacterEquipmentMetric(item, "flame"), null);
});

test("무기류 상세는 공격 옵션을 +로 묶고 일반 %급을 마지막에 둔다", () => {
  assert.deepEqual(
    getCharacterEquipmentDetailRows(
      {
        part: "무기",
        potentialSummary: {
          statEquivalentPercent: 30.9,
          bossDamagePercent: 40,
          damagePercent: 9,
          attackMagicPercent: 18,
          cooldownSeconds: null,
          criticalDamagePercent: 8,
        },
        additionalPotentialSummary: {
          statEquivalentPercent: 9,
          bossDamagePercent: null,
          attackMagicPercent: 3,
          cooldownSeconds: null,
        },
        weaponFlameTier: 1,
        weaponAddOptionPercent: 12.345,
      },
      null,
      { attackType: "attack" },
    ),
    [
      {
        key: "upper",
        label: "윗잠",
        value: "공18% + 보공40% + 뎀9% + 크뎀8% + 30.90% 급",
      },
      { key: "lower", label: "아랫잠", value: "공3% + 9.00% 급" },
      { key: "flame", label: "추옵", value: "1추 12.35% 급" },
    ],
  );
});

test("무기류 아이콘 요약은 모든 유효 옵션을 +로 묶는다", () => {
  const item = {
    part: "보조무기",
    potentialSummary: {
      statEquivalentPercent: 5,
      bossDamagePercent: 40,
      damagePercent: 9,
      attackMagicPercent: 18,
    },
  };

  assert.equal(
    getCharacterEquipmentQuickValue(item, "upper", { attackType: "attack" }),
    "공18% + 보공40% + 뎀9% + 5.00% 급",
  );
  assert.equal(
    getCharacterEquipmentQuickValue(item, "upper", { attackType: "magic" }),
    "마18% + 보공40% + 뎀9% + 5.00% 급",
  );
});

test("제논은 올스탯 환산 %급, 데몬어벤져는 HP%로 잠재를 표시한다", () => {
  const xenon = {
    statModel: "xenon",
    attackType: "attack",
    statEquivalence: { allStatPercentToMainPercent: 3 },
  };
  const demonAvenger = {
    statModel: "demon-avenger",
    attackType: "attack",
  };
  const xenonItem = {
    part: "귀고리",
    potentialSummary: {
      statEquivalentPercent: 27,
      statEquivalentType: "xenon-all-stat",
    },
  };
  const demonAvengerItem = {
    part: "펜던트",
    potentialSummary: {
      statEquivalentPercent: 36,
      statEquivalentType: "hp",
    },
    weaponFlameTier: 1,
    weaponAddOptionPercent: 137,
    addOptionUnit: "점",
  };

  assert.equal(
    getCharacterEquipmentQuickValue(xenonItem, "upper", xenon),
    "9.00%",
  );
  assert.equal(
    getCharacterEquipmentDetailRows(xenonItem, null, xenon)[0].value,
    "올스탯 9.00% 급",
  );
  assert.equal(
    getCharacterEquipmentQuickValue(
      demonAvengerItem,
      "upper",
      demonAvenger,
    ),
    "HP36%",
  );
  assert.equal(
    getCharacterEquipmentDetailRows(
      demonAvengerItem,
      null,
      demonAvenger,
    )[0].value,
    "HP +36%",
  );
  assert.equal(
    getCharacterEquipmentDetailRows(
      { ...demonAvengerItem, part: "무기" },
      null,
      demonAvenger,
    ).at(-1).value,
    "1추 137점",
  );
});

test("제논 잠재 합계도 내부 STR%급을 올스탯%급 숫자로 바꿔 표시한다", () => {
  const rows = getCharacterEquipmentDetailRows(
    {
      part: "상의",
      potentialSummary: {
        statEquivalentPercent: 66,
        statEquivalentType: "xenon-all-stat",
      },
      additionalPotentialSummary: {
        statEquivalentPercent: 33,
        statEquivalentType: "xenon-all-stat",
      },
    },
    {
      upper: {
        status: "calculated",
        expectedMeso: 1,
        targetEquivalentPercent: 66,
      },
      lower: {
        status: "calculated",
        expectedMeso: 1,
        targetEquivalentPercent: 33,
      },
      flame: { status: "not_applicable" },
    },
    {
      statModel: "xenon",
      statEquivalence: { allStatPercentToMainPercent: 3.3 },
    },
  );

  assert.equal(rows[0].spec, "올스탯 20.00% 급");
  assert.equal(rows[1].spec, "올스탯 10.00% 급");
  assert.equal(rows[2].spec, "올스탯 30.00% 급");
});

test("장비 툴팁은 장비판에서 장비가 있는 쪽을 우선한다", () => {
  const equipment = { left: 500, right: 900, width: 400 };
  const common = {
    equipment,
    tooltipWidth: 300,
    tooltipHeight: 400,
    viewportWidth: 1400,
    viewportHeight: 900,
  };
  assert.equal(
    getEquipmentTooltipPlacement({
      ...common,
      anchor: { left: 510, width: 60, top: 200, height: 60 },
    }).placement,
    "left",
  );
  assert.equal(
    getEquipmentTooltipPlacement({
      ...common,
      anchor: { left: 820, width: 60, top: 200, height: 60 },
    }).placement,
    "right",
  );
});

test("선호 방향이 좁으면 원본 장비를 가리지 않는 반대편에 붙인다", () => {
  const placement = getEquipmentTooltipPlacement({
    equipment: { left: 62, right: 651, bottom: 980, width: 589 },
    anchor: { left: 66, right: 126, width: 60, top: 650, height: 70 },
    tooltipWidth: 354,
    tooltipHeight: 620,
    viewportWidth: 1024,
    viewportHeight: 1100,
    protectedTop: 980,
  });

  assert.equal(placement.placement, "overlay");
  assert.equal(placement.left, 136);
  assert.ok(placement.left >= 126 + 10);
  assert.ok(placement.top + 620 <= 970);
});

test("툴팁이 장비 양쪽 어느 곳에도 겹치지 않게 들어가지 않으면 인라인으로 내린다", () => {
  assert.deepEqual(
    getEquipmentTooltipPlacement({
      equipment: { left: 100, right: 500, bottom: 780, width: 400 },
      anchor: { left: 270, right: 330, width: 60, top: 200, height: 60 },
      tooltipWidth: 260,
      tooltipHeight: 400,
      viewportWidth: 600,
      viewportHeight: 900,
      protectedTop: 780,
    }),
    { placement: "inline" },
  );
});

test("세로 공간만 부족하면 옆에 띄우고 하단에 부족한 높이만 확보한다", () => {
  assert.deepEqual(
    getEquipmentTooltipPlacement({
      equipment: { left: 40, right: 580, bottom: 600, width: 540 },
      anchor: { left: 50, right: 110, width: 60, top: 300, height: 60 },
      tooltipWidth: 354,
      tooltipHeight: 590,
      viewportWidth: 620,
      viewportHeight: 800,
      protectedTop: 600,
    }),
    { placement: "overlay", left: 120, top: 8, reserveBelow: 8 },
  );
});

test("화면보다 긴 무기 상세도 오른쪽 공간을 사용하고 장비판 아래 겹침만 확보한다", () => {
  const input = {
    equipment: { left: 250, right: 830, top: 190, bottom: 630, width: 580 },
    anchor: { left: 330, right: 468, width: 138, top: 558, height: 72 },
    tooltipWidth: 354,
    tooltipHeight: 1100,
    viewportWidth: 1400,
    viewportHeight: 900,
    protectedTop: 640,
  };
  const placement = getEquipmentTooltipPlacement(input);
  assert.deepEqual(placement, { placement: "overlay", left: 478, top: 190, reserveBelow: 660 });
  assert.equal(placement.top + input.tooltipHeight + 10, input.protectedTop + placement.reserveBelow);
  assert.ok(placement.reserveBelow < input.tooltipHeight);
  assert.equal(getEquipmentTooltipPlacement({ ...input, tooltipHeight: 340 }).reserveBelow, 0);
});

test("장착 장비 환산 제목은 직업별 사용자 표시 기준을 밝힌다", () => {
  assert.equal(
    getCharacterEquipmentConversionLabel({}, "regular"),
    "장착 장비 환산 (주스탯 %)",
  );
  assert.equal(
    getCharacterEquipmentConversionLabel({ statModel: "xenon" }, "combined"),
    "장착 장비 환산 (올스탯 %)",
  );
  assert.equal(
    getCharacterEquipmentConversionLabel(
      { statModel: "demon-avenger" },
      "additional",
    ),
    "장착 장비 환산 (HP %)",
  );
  assert.equal(
    getCharacterEquipmentConversionLabel({ statModel: "xenon" }, "flame"),
    "장착 장비 환산",
  );
});

test("제논 올스탯 환산 잠재는 메소 재설정 기댓값을 계산한다", async () => {
  const statEquivalence = {
    statPercentToMainPercentByStat: { STR: 0.3, DEX: 0.35, LUK: 0.35 },
    flatStatToMainPercentByStat: { STR: 0.01, DEX: 0.01, LUK: 0.01 },
    flatAttackToMainPercent: 0.2,
    allStatPercentToMainPercent: 1,
    criticalDamageToMainPercent: 4,
    attackPercentToMainPercent: 10,
    bossDamageToMainPercent: 3,
    oneMainPercentRelative: 0.001,
    currentIgnoreDefense: 0.96,
  };
  const expectations = await calculateCharacterEquipmentExpectations(
    {
      part: "귀고리",
      itemLevel: 200,
      potentialGrade: "레전드리",
      potentialSummary: {
        statEquivalentPercent: 27,
        statEquivalentType: "xenon-all-stat",
      },
      additionalPotentialSummary: null,
      addOptionScore: null,
    },
    {
      mainStat: "ALL",
      subStat: null,
      subStats: [],
      statModel: "xenon",
      attackType: "attack",
      statEquivalence,
      character: { level: 295 },
    },
    {
      loadTables: async () => [
        [{ name: "올스탯 +9%", probability: 1 }],
        [{ name: "올스탯 +9%", probability: 1 }],
        [{ name: "올스탯 +9%", probability: 1 }],
      ],
    },
  );

  assert.equal(expectations.upper.status, "calculated");
  assert.ok(expectations.upper.expectedMeso > 0);
});

test("무기류 아이콘 요약은 글자를 축소하지 않고 하단의 가로 여백을 나눠 쓴다", async () => {
  const styles = await read("../src/calculator.css");

  assert.match(
    styles,
    /\.profile-equipment__quick-value\[data-composite="true"\][\s\S]*font-size: 0\.75rem;/u,
  );
  assert.doesNotMatch(
    styles,
    /\.profile-equipment__quick-value\[data-composite="true"\][\s\S]{0,260}font-size: 0\.5rem;/u,
  );
  assert.match(
    styles,
    /\.profile-equipment__offensive-row \{[\s\S]*grid-column: 2 \/ 7;[\s\S]*grid-row: 6;[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/u,
  );
  assert.match(styles, /word-spacing: 0\.16em;/u);
  assert.match(
    styles,
    /\[data-composite="true"\]\[data-kind="upper"\] \{[\s\S]*align-content: center;[\s\S]*padding: 1px 4px 0;/u,
  );
  assert.match(
    styles,
    /\[data-composite="true"\]\[data-kind="lower"\] \{[\s\S]*align-content: center;[\s\S]*padding: 0 4px 1px;/u,
  );
  assert.match(
    styles,
    /--profile-equipment-composite-label-height: var\(--profile-equipment-label-height\);/u,
  );
});

test("아이콘 위아래 위치로 잠재를 구분하므로 윗·아 접두어를 반복하지 않는다", () => {
  const item = {
    part: "망토",
    potentialSummary: { statEquivalentPercent: 30.74 },
    additionalPotentialSummary: { statEquivalentPercent: 7.06 },
  };

  assert.equal(getCharacterEquipmentQuickValue(item, "upper"), "30.74%");
  assert.equal(getCharacterEquipmentQuickValue(item, "lower"), "7.06%");
});

test("웹 경매장형 장비 툴팁은 API 상세값을 보존하고 없는 값은 생략한다", () => {
  const model = getCharacterEquipmentTooltipModel({
    name: "몽환의 벨트",
    part: "벨트",
    slot: "벨트",
    icon: "https://example.com/belt.png",
    itemLevel: 200,
    potentialGrade: "레전드리",
    additionalPotentialGrade: "레전드리",
    potentialSummary: { statEquivalentPercent: 36 },
    additionalPotentialSummary: { statEquivalentPercent: 18 },
    tooltip: {
      starforce: 22,
      gender: "공용",
      description: null,
      equipmentLevelIncrease: 0,
      growthLevel: null,
      specialRingLevel: null,
      cuttableCount: 2,
      options: [{
        key: "str",
        label: "STR",
        unit: "",
        total: 342,
        base: 50,
        add: 145,
        etc: 15,
        starforce: 132,
        exceptional: null,
      }],
      potentialLines: ["STR +12%", "STR +12%", "STR +12%"],
      additionalPotentialLines: ["STR +8%", "STR +6%", "STR +6%"],
      scroll: {
        upgraded: 4,
        upgradeable: 0,
        recoverable: 0,
        goldenHammerApplied: true,
      },
      soulName: null,
      soulOption: null,
    },
  });

  assert.equal(model.name, "몽환의 벨트 (+4)");
  assert.equal(model.stars, 22);
  assert.deepEqual(model.metadata, [
    { label: "착용 부위", value: "벨트" },
    { label: "요구 레벨", value: "Lv. 200" },
    { label: "성별", value: "공용" },
  ]);
  assert.deepEqual(model.tags, ["장신구", "벨트"]);
  assert.deepEqual(model.options[0], {
    key: "str",
    label: "STR",
    unit: "",
    total: 342,
    base: 50,
    add: 145,
    etc: 15,
    starforce: 132,
    exceptional: null,
  });
  assert.deepEqual(model.potential.lines, [
    "STR +12%",
    "STR +12%",
    "STR +12%",
  ]);
  assert.deepEqual(model.potential.lineGrades, [
    "레전드리",
    "레전드리",
    "레전드리",
  ]);
  assert.equal(model.rawAvailable, true);
  assert.equal(model.scroll.goldenHammerApplied, true);
  assert.deepEqual(model.soul, []);
});

test("특수 스킬 반지 툴팁은 특수 반지 레벨임을 자연스럽게 표시한다", () => {
  const model = getCharacterEquipmentTooltipModel({
    name: "리스트레인트 링",
    part: "반지",
    slot: "반지2",
    tooltip: { specialRingLevel: 4 },
  });

  assert.deepEqual(
    model.metadata.find(({ label }) => label === "반지 레벨"),
    { label: "반지 레벨", value: "Lv. 4" },
  );
  assert.equal(
    model.metadata.some(({ label }) => label === "특수 스킬 반지"),
    false,
  );
});

test("장비 툴팁 능력치는 입력 순서와 무관하게 인게임 순서를 따른다", () => {
  const option = (key, label, unit = "") => ({
    key,
    label,
    unit,
    total: 1,
  });
  const model = getCharacterEquipmentTooltipModel({
    name: "능력치 순서 장비",
    tooltip: {
      options: [
        option("ignore_monster_armor", "몬스터 방어율 무시", "%"),
        option("max_hp", "최대 HP"),
        option("boss_damage", "보스 몬스터 공격 시 데미지", "%"),
        option("all_stat", "올스탯", "%"),
        option("armor", "방어력"),
        option("damage", "데미지", "%"),
        option("attack_power", "공격력"),
        option("luk", "LUK"),
        option("str", "STR"),
      ],
    },
  });

  assert.deepEqual(
    model.options.map(({ key }) => key),
    [
      "str",
      "luk",
      "all_stat",
      "max_hp",
      "attack_power",
      "damage",
      "armor",
      "boss_damage",
      "ignore_monster_armor",
    ],
  );
});

test("추가 수치가 있을 때만 괄호를 쓰고 구성 수치에도 단위를 붙인다", () => {
  assert.deepEqual(getEquipmentTooltipBreakdown({
    key: "max_hp",
    unit: "",
    base: 1250,
    add: 0,
    etc: 0,
    starforce: 0,
    exceptional: 0,
  }), []);
  assert.deepEqual(getEquipmentTooltipBreakdown({
    key: "all_stat",
    unit: "%",
    base: 0,
    add: 4,
    etc: 0,
    starforce: 0,
    exceptional: 0,
  }), [
    { kind: "base", value: 0, unit: "%" },
    { kind: "add", value: 4, unit: "%" },
  ]);
  assert.deepEqual(getEquipmentTooltipBreakdown({
    key: "str",
    unit: "",
    base: 50,
    add: 104,
    etc: 1,
    starforce: 85,
    exceptional: 0,
  }), [
    { kind: "base", value: 50, unit: "" },
    { kind: "enhancement", value: 85, unit: "" },
    { kind: "etc", value: 1, unit: "" },
    { kind: "add", value: 104, unit: "" },
  ]);
});

test("모든 능력치명은 인게임처럼 수치 앞에 같은 간격을 둔다", async () => {
  const [component, styles] = await Promise.all([
    read("../src/shared/character-equipment-summary.js"),
    read("../src/calculator.css"),
  ]);

  assert.doesNotMatch(component, /row\.dataset\.statKey = option\.key/u);
  assert.doesNotMatch(styles, /data-stat-key=/u);
  assert.match(
    styles,
    /\.profile-equipment-tooltip__stat-value > strong \{[\s\S]*margin-right: 8px;/u,
  );
});

test("장비 툴팁의 2·3번째 잠재 점은 공식 옵션 풀의 실제 줄 등급을 따른다", async () => {
  const calls = [];
  const item = {
    part: "장갑",
    itemLevel: 250,
    potentialGrade: "레전드리",
    additionalPotentialGrade: "에픽",
    tooltip: {
      potentialLines: [
        "DEX +13%",
        "DEX +13%",
        "DEX +10%",
      ],
      additionalPotentialLines: [
        "공격력 +12",
        "크리티컬 확률 +6%",
        "DEX +3%",
      ],
    },
  };
  const loadTables = async (request) => {
    calls.push(request);
    return request.system === "regular"
      ? [
          [{ name: "DEX +13%" }],
          [
            { name: "DEX +13%" },
            { name: "DEX +10%" },
          ],
          [
            { name: "DEX +13%" },
            { name: "DEX +10%" },
          ],
        ]
      : [
          [
            { name: "공격력 +12" },
            { name: "크리티컬 확률 +6%" },
          ],
          [
            { name: "크리티컬 확률 +6%" },
            { name: "DEX +3%" },
          ],
          [{ name: "DEX +3%" }],
        ];
  };

  assert.deepEqual(
    await resolveCharacterEquipmentPotentialLineGrades(item, { loadTables }),
    {
      potential: ["레전드리", "레전드리", "유니크"],
      additionalPotential: ["에픽", "에픽", "레어"],
    },
  );
  assert.deepEqual(calls, [
    { system: "regular", grade: "legendary", part: 11, itemLevel: 250 },
    { system: "additional", grade: "epic", part: 11, itemLevel: 250 },
  ]);
});

test("구버전 저장 장비는 환산 요약을 원본 잠재 옵션처럼 표시하지 않는다", async () => {
  const model = getCharacterEquipmentTooltipModel({
    name: "고통의 근원",
    part: "펜던트",
    slot: "펜던트",
    itemLevel: 160,
    potentialGrade: "레전드리",
    additionalPotentialGrade: "유니크",
    potentialSummary: { statEquivalentPercent: 30 },
    additionalPotentialSummary: { statEquivalentPercent: 10 },
  }, {
    mainStat: "STR",
  });
  const source = await read("../src/shared/character-equipment-summary.js");

  assert.equal(model.rawAvailable, false);
  assert.deepEqual(model.potential.lines, []);
  assert.deepEqual(model.additionalPotential.lines, []);
  assert.doesNotMatch(source, /환산 요약/u);
  assert.match(source, /원본 장비 정보를 갱신하는 중입니다/u);
});

test("익셉셔널 강화는 중앙 합계에 중복하지 않고 별도 원본 수치로 표시한다", async () => {
  const exceptional = {
    str: 20,
    dex: 20,
    int: 20,
    luk: 20,
    max_hp: 1000,
    max_mp: 1000,
    attack_power: 15,
    magic_power: 15,
  };
  const labels = {
    str: "STR",
    dex: "DEX",
    int: "INT",
    luk: "LUK",
    max_hp: "최대 HP",
    max_mp: "최대 MP",
    attack_power: "공격력",
    magic_power: "마력",
  };
  const model = getCharacterEquipmentTooltipModel({
    name: "익셉셔널 장비",
    tooltip: {
      exceptionalUpgrade: 1,
      options: Object.entries(exceptional).map(([key, value]) => ({
        key,
        label: labels[key],
        unit: "",
        total: 0,
        base: 0,
        add: 0,
        etc: 0,
        starforce: 0,
        exceptional: value,
      })),
    },
  });
  const [source, styles] = await Promise.all([
    read("../src/shared/character-equipment-summary.js"),
    read("../src/calculator.css"),
  ]);

  assert.deepEqual(model.exceptional, {
    upgraded: 1,
    maximum: null,
    lines: [
      "올스탯 +20",
      "최대 HP / 최대 MP +1,000",
      "공격력 / 마력 +15",
    ],
  });
  assert.deepEqual(model.options, []);
  assert.deepEqual(getEquipmentTooltipBreakdown({
    key: "attack_power",
    unit: "",
    total: 250,
    base: 10,
    add: 0,
    etc: 36,
    starforce: 204,
    exceptional: 10,
  }), [
    { kind: "base", value: 10, unit: "" },
    { kind: "enhancement", value: 204, unit: "" },
    { kind: "etc", value: 36, unit: "" },
  ]);
  assert.match(source, /const enhanced = option\.starforce \?\? 0;/u);
  assert.doesNotMatch(
    source,
    /const enhanced = \(option\.starforce \?\? 0\) \+\s*\(option\.exceptional \?\? 0\)/u,
  );
  assert.match(source, /\["enhancement", enhanced\]/u);
  assert.match(source, /익셉셔널\$\{count\}/u);
  assert.doesNotMatch(source, /data\.maximum \? ` \/ \$\{data\.maximum\}회`/u);
  assert.match(styles, /\[data-kind="enhancement"\] \{\s*color: #fac801;/u);
  assert.match(
    styles,
    /\[data-kind="exceptional-upgrade"\][\s\S]*\.profile-equipment-tooltip__lines li::before \{\s*display: none;/u,
  );
});

test("장비 툴팁은 황금망치 적용 여부를 화면 문구로 노출하지 않는다", async () => {
  const source = await read("../src/shared/character-equipment-summary.js");

  assert.doesNotMatch(source, /황금망치/u);
});

test("구버전 장비도 네이티브 title 대신 접근 가능한 맞춤 툴팁을 쓴다", async () => {
  const [component, styles] = await Promise.all([
    read("../src/shared/character-equipment-summary.js"),
    read("../src/calculator.css"),
  ]);

  assert.match(component, /setAttribute\("role", "tooltip"\)/u);
  assert.match(component, /setAttribute\("aria-describedby", tooltipController\.tooltip\.id\)/u);
  assert.match(component, /addEventListener\("focus"/u);
  assert.match(component, /event\.key === "Escape"/u);
  assert.match(component, /const equipment = grid\.getBoundingClientRect\(\)/u);
  assert.match(component, /const canFloatLeft = leftSpace >= tooltipWidth/u);
  assert.match(component, /const canFloatRight = rightSpace >= tooltipWidth/u);
  assert.match(component, /return \{ placement: "inline" \}/u);
  assert.match(component, /document\.body\.append\(tooltip\)/u);
  assert.match(component, /board\.insertBefore\(tooltip, inlineReference\)/u);
  assert.match(component, /anchorOnLeft/u);
  assert.match(component, /"profile-equipment-tooltip__close"/u);
  assert.match(
    component,
    /board\.append\(caption, grid, tooltipController\.tooltip, tooltipController\.spacer, detail\.panel\)/u,
  );
  assert.doesNotMatch(component, /slot\.title\s*=/u);
  assert.doesNotMatch(component, /upperText\.title\s*=/u);
  assert.match(component, /POTENTIAL_GRADE_BADGES/u);
  assert.doesNotMatch(component, /title\.dataset\.grade/u);
  assert.match(
    styles,
    /\.profile-equipment-tooltip \{[\s\S]*max-height: none;[\s\S]*overflow: visible;[\s\S]*pointer-events: auto;/u,
  );
  assert.doesNotMatch(
    styles,
    /\.profile-equipment-tooltip \{[\s\S]{0,450}overflow: auto;/u,
  );
  assert.match(
    styles,
    /\.profile-equipment-tooltip\[data-placement="inline"\] \{[\s\S]*position: relative;[\s\S]*width: min\(354px, 100%\);/u,
  );
  assert.match(
    styles,
    /\.profile-equipment-tooltip__grade-badge \{[\s\S]*width: 14px;[\s\S]*height: 14px;/u,
  );
  assert.match(
    styles,
    /\.profile-equipment-tooltip__name \{[\s\S]*color: #f5f6fa;/u,
  );
  assert.match(
    styles,
    /\.profile-equipment-tooltip__description \{[\s\S]*color: #c1c7d1;/u,
  );
  assert.match(component, /starSlotCount = Math\.max\(25, Math\.ceil\(visibleStars \/ 5\) \* 5\)/u);
  assert.match(component, /groupIndex < starSlotCount \/ 5/u);
  assert.match(component, /star\.dataset\.filled/u);
  assert.match(component, /visibleStars >= 23/u);
  assert.match(styles, /__header\[data-sparkle="true"\]::before/u);
  assert.match(styles, /profile-equipment-tooltip__exceptional-badge/u);
});

test("26성 이상 장비도 실제 수치까지 별을 채우고 다음 5개 단위 슬롯을 만든다", async () => {
  const source = await read("../src/shared/character-equipment-summary.js");
  const model = getCharacterEquipmentTooltipModel({
    name: "26성 장비",
    tooltip: { starforce: 26 },
  });

  assert.equal(model.stars, 26);
  assert.match(source, /const visibleStars = model\.stars/u);
  assert.doesNotMatch(source, /Math\.min\(model\.stars, 25\)/u);
});

test("장비 툴팁은 계산과 무관한 게임 안내와 가위 문구를 숨긴다", () => {
  const model = getCharacterEquipmentTooltipModel({
    name: "안내 문구 장비",
    part: "장갑",
    slot: "장갑",
    itemLevel: 250,
    tooltip: {
      description: [
        "일부 상황에서는 보이지 않는 아이템입니다.",
        "NPC/채집 키를 통해 장비 정보를 확인할 수 있습니다.",
      ].join("\n"),
      cuttableCount: 5,
    },
  });

  assert.equal(model.description, null);
  assert.equal(model.metadata.some(({ value }) => /가위/u.test(value)), false);
});

test("착용 레벨 감소는 API의 양수 감소량을 화면에서 음수로 표시한다", async () => {
  const component = await read("../src/shared/character-equipment-summary.js");

  assert.match(
    component,
    /option\.key === "equipment_level_decrease"[\s\S]*-Math\.abs\(number\)/u,
  );
});

test("모자 재사용과 장갑 크뎀 요약은 일반 환산값도 함께 표시한다", () => {
  assert.equal(
    getCharacterEquipmentQuickValue({
      part: "모자",
      potentialSummary: {
        cooldownSeconds: 2,
        statEquivalentPercent: 26,
      },
    }, "upper"),
    "2초 + 26.00%",
  );
  assert.equal(
    getCharacterEquipmentQuickValue({
      part: "장갑",
      potentialSummary: {
        criticalDamagePercent: 16,
        statEquivalentPercent: 6.76,
      },
    }, "upper"),
    "크16% + 6.76%",
  );
});

test("장비 등급 테두리는 윗잠·아이콘·아랫잠을 포함한 전체 셀을 감싼다", async () => {
  const [component, styles] = await Promise.all([
    read("../src/shared/character-equipment-summary.js"),
    read("../src/calculator.css"),
  ]);

  assert.match(component, /slot\.dataset\.grade = item\.potentialGrade/u);
  assert.match(
    styles,
    /\.profile-equipment__slot \{[\s\S]*overflow: hidden;[\s\S]*border: 1px solid #343b49;[\s\S]*border-radius: 8px;/u,
  );
  assert.match(styles, /\.profile-equipment__slot\[data-grade="레전드리"\]/u);
  assert.match(styles, /\.profile-equipment__icon \{[\s\S]*border: 0;/u);
  assert.match(styles, /--profile-equipment-slot-width: 72px;/u);
});

test("긴 장비 요약은 줄바꿈하지 않고 말줄임표로 축약한다", async () => {
  const [component, styles] = await Promise.all([
    read("../src/shared/character-equipment-summary.js"),
    read("../src/calculator.css"),
  ]);

  assert.match(component, /"profile-equipment__quick-value-text"/u);
  assert.match(
    styles,
    /\.profile-equipment__quick-value-text \{[\s\S]*overflow: hidden;[\s\S]*text-overflow: clip;[\s\S]*white-space: nowrap;/u,
  );
  assert.doesNotMatch(
    styles,
    /\.profile-equipment__quick-value\[data-composite="true"\][\s\S]{0,320}white-space: normal;/u,
  );
});

test("장비 요약 말줄임은 두 점을 쓰며 실제 폭까지 숫자를 보존한다", () => {
  const node = {
    dataset: { fullValue: "크16% + 6.76%" },
    clientWidth: 80,
    textContent: "",
    get scrollWidth() {
      return Array.from(this.textContent).length * 10;
    },
  };

  assert.equal(fitCharacterEquipmentQuickValue(node), "크16% +..");
  assert.equal(node.dataset.truncated, "true");

  node.clientWidth = 200;
  assert.equal(fitCharacterEquipmentQuickValue(node), "크16% + 6.76%");
  assert.equal(node.dataset.truncated, undefined);

  const decimalCut = {
    dataset: { fullValue: "크16% + 33.00%" },
    clientWidth: 120,
    textContent: "",
    get scrollWidth() {
      return Array.from(this.textContent).length * 10;
    },
  };
  assert.equal(fitCharacterEquipmentQuickValue(decimalCut), "크16% + 33..");
  assert.doesNotMatch(decimalCut.textContent, /\.\.\.$/u);
});

test("캐릭터 장비판과 검색 UI는 카드의 실제 가용 폭에 맞춰 줄어든다", async () => {
  const styles = await read("../src/calculator.css");

  assert.match(styles, /\.profile-card \{[\s\S]*container-name: character-profile;[\s\S]*container-type: inline-size;/u);
  assert.match(
    styles,
    /\.profile-equipment__grid \{[\s\S]*grid-template-columns: repeat\(7, minmax\(0, 1fr\)\);/u,
  );
  assert.match(styles, /@container character-profile \(max-width: 560px\)/u);
});

test("캐릭터 이미지 상단 정보는 충분한 높이와 읽을 수 있는 글자 크기를 쓴다", async () => {
  const styles = await read("../src/calculator.css");

  assert.match(
    styles,
    /\.profile-equipment__identity \{[\s\S]*min-height: 54px;[\s\S]*padding: 6px 8px;/u,
  );
  assert.match(
    styles,
    /\.profile-equipment__identity \.profile-summary__name \{[\s\S]*font-size: 0\.86rem;/u,
  );
  assert.match(
    styles,
    /\.profile-equipment__identity \.profile-summary__meta \{[\s\S]*font-size: 0\.74rem;/u,
  );
});

test("캐릭터 환산 장비판은 개편된 인게임 장비창의 열 배치를 따른다", () => {
  const positions = Object.fromEntries(
    CHARACTER_PROFILE_EQUIPMENT_BOARD_SLOTS.map(([slot, row, column]) => [
      slot,
      [row, column],
    ]),
  );

  assert.deepEqual(positions.벨트, [5, 1]);
  assert.deepEqual(positions.펜던트2, [5, 2]);
  assert.deepEqual(positions.포켓아이템, [6, 1]);
  assert.deepEqual(positions.무기, [6, 3]);
  assert.deepEqual(positions.보조무기, [6, 4]);
  assert.deepEqual(positions.엠블렘, [6, 5]);
  assert.deepEqual(positions.상의, [2, 6]);
  assert.deepEqual(positions.어깨장식, [4, 6]);
  assert.deepEqual(positions.안드로이드, [5, 6]);
  assert.deepEqual(positions.훈장, [4, 7]);
  assert.deepEqual(positions.기계심장, [5, 7]);
  assert.deepEqual(positions.뱃지, [6, 7]);
});

test("예비 특수 반지는 일반 반지 네 칸을 선점하지 않고 장착 특수 반지와 짝을 이룬다", () => {
  const reserve = {
    name: "컨티뉴어스 링",
    part: "반지",
    slot: "예비 특수 반지",
    tooltip: { specialRingLevel: 6 },
  };
  const rings = [1, 2, 3, 4].map((number) => ({
    name: number === 2 ? "리스트레인트 링" : `일반 반지 ${number}`,
    part: "반지",
    slot: `반지${number}`,
    tooltip: { specialRingLevel: number === 2 ? 6 : 0 },
  }));
  const layout = getCharacterEquipmentBoardLayout([reserve, ...rings]);

  assert.deepEqual(
    [1, 2, 3, 4].map((number) => layout.bySlot.get(`반지${number}`)?.name),
    ["일반 반지 1", "리스트레인트 링", "일반 반지 3", "일반 반지 4"],
  );
  assert.equal(layout.specialRingPair.slot, "반지2");
  assert.equal(layout.specialRingPair.equipped, rings[1]);
  assert.equal(layout.specialRingPair.reserve, reserve);
});

test("특수 스킬 반지 한 칸은 대각선으로 나뉜 두 독립 버튼을 사용한다", async () => {
  const [component, styles] = await Promise.all([
    read("../src/shared/character-equipment-summary.js"),
    read("../src/calculator.css"),
  ]);

  assert.match(component, /element\("div", "profile-equipment__special-ring-pair"\)/u);
  assert.match(component, /half\(pair\.equipped, "equipped", "현재 장착 특수 스킬 반지"\)/u);
  assert.match(component, /half\(pair\.reserve, "reserve", "예비 특수 스킬 반지"\)/u);
  assert.doesNotMatch(component, /tooltipSide|preferredSide/u);
  assert.match(
    styles,
    /profile-equipment__special-ring-half\[data-slot-role="equipped"\][\s\S]*clip-path: polygon\(0 0, 100% 0, 0 100%\)/u,
  );
  assert.match(
    styles,
    /profile-equipment__special-ring-half\[data-slot-role="reserve"\][\s\S]*clip-path: polygon\(100% 0, 100% 100%, 0 100%\)/u,
  );
  assert.match(
    styles,
    /profile-equipment__special-ring-pair::after[\s\S]*linear-gradient\([\s\S]*to bottom right/u,
  );
});

test('무기 소울 툴팁에 증폭 등급·세 줄·상시 공격력을 표시한다', () => {
  const model = getCharacterEquipmentTooltipModel({
    name: '테스트 무기', tooltip: {
      soulName: '위대한 루시드의 소울 적용', soulOption: '공격력 +3%',
      soulActive: true, soulAttack: 20, soulMagic: 0,
      soulPotentialGrade: '레전드리', soulAmplification: 2,
      soulPotentialLines: ['공격력 +4%', '공격력 +3%', '공격력 +3%'],
    },
  });
  assert.deepEqual(model.soul, ['위대한 루시드의 소울 적용', '공격력 +3%', '공격력 +20',
    '소울 증폭 2단계 · 레전드리', '공격력 +4%', '공격력 +3%', '공격력 +3%']);
});
