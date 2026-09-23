import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  allocateSharedExpectedCostRecovery,
  attachExpectedCostRecovery,
  buildItemMarketExpectationMetadata,
  buildUsefulPotentialConditions,
  calculateItemMarketExpectedCosts,
  calculatePotentialGradeExpectedCost,
  calculatePotentialOptionsExpectedCost,
  expectedCostRecoveryPercent,
} from "../src/shared/item-market-expected-cost.js";

test("데이브레이크 펜던트 build target 경로가 여명의 보스 세트 정보를 보존한다", () => {
  assert.deepEqual(buildItemMarketExpectationMetadata({
    category: "펜던트",
    baseLevel: 140,
    requiredJob: "공용",
    setName: "여명의 보스 세트",
  }), {
    category: "펜던트",
    base_level: 140,
    required_job: "공용",
    set_name: "여명의 보스 세트",
  });
});

function targetItem({
  requiredJob = "전사",
  category = null,
  level = 250,
  upgrade = null,
  scroll = null,
  potential = null,
  additional = null,
  flame = null,
  setName = null,
} = {}) {
  return {
    item: {
      name: requiredJob === "공용" ? "테스트 반지" : "에테르넬 나이트아머",
      category: category || (requiredJob === "공용" ? "반지" : "상의"),
      required_job: requiredJob,
      set_name: setName,
      base_level: level,
      base_price_meso: 100_000_000,
      starforce: { value: 0, applicable: true },
      upgrade: upgrade || { max: 0, applied: 0, remaining: 0, recoverable: 0 },
      trade: { state: null, scissors_remaining: null, scissors_total: null },
      stats: { base: {}, starforce: {}, scroll: scroll || {}, flame: flame || {}, other: {}, total: {} },
      potential: potential || { grade: "none", lines: [] },
      additional_potential: additional || { grade: "none", lines: [] },
    },
  };
}

test("시장 반영액을 제작 기댓값의 퍼센트로 계산한다", () => {
  assert.equal(expectedCostRecoveryPercent(7_500_000_000, 10_000_000_000), 75);
  assert.equal(expectedCostRecoveryPercent(-50, 100), -50);
  assert.equal(expectedCostRecoveryPercent(100, 0), null);
  assert.equal(expectedCostRecoveryPercent(100, Number.POSITIVE_INFINITY), null);
  assert.equal(expectedCostRecoveryPercent(null, 100), null);
});

test("전사 전용 장비의 INT 잠재는 제작 기댓값에서 제외한다", () => {
  const potential = {
    grade: "legendary",
    lines: [{ code: "INT", value: 36, unit: "pct", params: {} }],
  };
  const result = calculateItemMarketExpectedCosts({ target: targetItem({ potential }) });
  assert.equal(result.family, "STR");
  assert.equal(result.components.potential_options.status, "excluded");
  assert.equal(result.components.potential_options.accepted_lines, 0);
  assert.equal(result.components.potential_options.ignored_lines, 1);
});

test("공용 장신구는 입력 옵션에 맞는 직업 계열을 고른다", () => {
  const potential = {
    grade: "legendary",
    lines: [{ code: "INT", value: 36, unit: "pct", params: {} }],
  };
  const result = calculateItemMarketExpectedCosts({
    target: targetItem({ requiredJob: "공용", potential }),
  });
  assert.equal(result.family, "INT");
  assert.equal(result.components.potential_options.status, "unavailable");
  assert.equal(result.components.potential_options.accepted_lines, 1);
});

test("방무 여러 줄은 단순 합이 아니라 실제 합적용 수치로 묶는다", () => {
  const result = buildUsefulPotentialConditions({
    lines: [
      { code: "IGNORE_DEFENSE", value: 30, unit: "pct" },
      { code: "IGNORE_DEFENSE", value: 30, unit: "pct" },
    ],
  }, "STR");
  assert.equal(result.conditions.length, 1);
  assert.equal(result.conditions[0].targetType, "ignore-defense");
  assert.ok(Math.abs(result.conditions[0].target - 51) < 1e-9);
});

test("직업 계열의 공마와 유틸리티 옵션만 남긴다", () => {
  const result = buildUsefulPotentialConditions({
    lines: [
      { code: "ATTACK", value: 12, unit: "pct" },
      { code: "MAGIC_ATTACK", value: 12, unit: "pct" },
      { code: "ITEM_DROP_RATE", value: 20, unit: "pct" },
    ],
  }, "INT");
  assert.deepEqual(
    result.conditions.map((entry) => entry.targetType).sort(),
    ["drop", "magic-power-percent"],
  );
  assert.equal(result.ignored_lines, 1);
});

function emblemAdditionalTables() {
  const read = (file) => JSON.parse(readFileSync(new URL(`../public/potential-tables/${file}`, import.meta.url)));
  const index = read("index.json");
  return read("additional-legendary-2-120.json").map((line) => line.map(([name, probability]) => ({
    name: index.names[name], probability,
  })));
}

test("레테그네의 미트라 에디 마력 21%와 INT 9%를 세 줄 모두 포함한다", () => {
  const magic = (value) => ({ code: "MAGIC_ATTACK", unit: "pct", value });
  const result = calculateItemMarketExpectedCosts({
    target: targetItem({
      requiredJob: "마법사", category: "엠블렘", level: 200,
      potential: { grade: "legendary", lines: [magic(12), magic(9), magic(9)] },
      additional: { grade: "legendary", lines: [magic(12), { code: "INT", unit: "pct", value: 9 }, magic(9)] },
    }),
    additionalTables: emblemAdditionalTables(), storage: null,
  }).components.additional_options;
  assert.equal(result.status, "calculated");
  assert.equal(result.accepted_lines, 3);
  assert.equal(result.ignored_lines, 0);
  assert.deepEqual(result.conditions, [
    { targetType: "magic-power-percent", target: 21 }, { targetType: "int-percent", target: 9 },
  ]);
});

test("보우신쫑의 미트라 에디 크확 9%를 포함해 실제 도달 확률과 비용을 계산한다", () => {
  const attack = (value) => ({ code: "ATTACK", unit: "pct", value });
  const options = { system: "additional", itemLevel: 200, family: "DEX", tables: emblemAdditionalTables() };
  const result = calculatePotentialOptionsExpectedCost({ ...options,
    section: { grade: "legendary", lines: [attack(12), { code: "CRITICAL_RATE", unit: "pct", value: 9 }, attack(9)] },
  });
  const withoutCritical = calculatePotentialOptionsExpectedCost({ ...options,
    section: { grade: "legendary", lines: [attack(12), attack(9)] },
  });
  assert.equal(result.status, "calculated");
  assert.equal(result.accepted_lines, 3);
  assert.equal(result.ignored_lines, 0);
  assert.deepEqual(result.conditions, [
    { targetType: "attack-power-percent", target: 21 }, { targetType: "critical-rate", target: 9 },
  ]);
  assert.ok(result.probability > 0 && result.probability < withoutCritical.probability);
  assert.ok(result.expected_cost_meso > withoutCritical.expected_cost_meso);
});

test("공용 장비는 윗잠과 에디 계열을 각각 골라 다른 계열 주스탯을 잘못 제외하지 않는다", () => {
  const result = calculateItemMarketExpectedCosts({
    target: targetItem({ requiredJob: "공용",
      potential: { grade: "legendary", lines: [{ code: "STR", unit: "pct", value: 36 }] },
      additional: { grade: "legendary", lines: [{ code: "INT", unit: "pct", value: 9 }] },
    }), storage: null,
  });
  assert.equal(result.components.potential_options.family, "STR");
  assert.equal(result.components.additional_options.family, "INT");
  assert.equal(result.components.additional_options.accepted_lines, 1);
  assert.equal(result.components.additional_options.ignored_lines, 0);
});

test("등업 기댓값은 레어 시작 메소 재설정 비용으로 계산한다", () => {
  assert.equal(calculatePotentialGradeExpectedCost({
    system: "regular",
    grade: "rare",
    itemLevel: 200,
  }).status, "not_applicable");
  const legendary = calculatePotentialGradeExpectedCost({
    system: "regular",
    grade: "legendary",
    itemLevel: 200,
  });
  assert.equal(legendary.status, "calculated");
  assert.ok(legendary.expected_cost_meso > 0);
  assert.match(legendary.basis, /레어부터 레전드리까지/u);
});

test("시세에서 자동 추정한 노작값으로 스타포스 파괴 복구 비용을 계산한다", () => {
  const target = targetItem({ level: 200 });
  target.item.base_price_meso = 350_000_000;
  target.item.base_price_source = "same_item_market_model";
  target.item.starforce.value = 17;

  const result = calculateItemMarketExpectedCosts({ target });

  assert.equal(result.components.base.basis, "동일 장비 판매 시세에서 자동 추정");
  assert.equal(result.components.starforce.status, "calculated");
  assert.ok(result.components.starforce.expected_cost_meso > 0);
});

test("시장 반영액에 제작 기댓값과 회수율을 붙인다", () => {
  const attached = attachExpectedCostRecovery({
    starforce: { contribution_meso: 750, identifiable: true },
  }, {
    starforce: { status: "calculated", expected_cost_meso: 1_000, basis: "test" },
  });
  assert.equal(attached.starforce.expectation.recovery_percent, 75);
});

test("분리 불가능한 등업·옵션 가격은 제작 기댓값 비중으로 나누고 총액은 보존한다", () => {
  const result = allocateSharedExpectedCostRecovery({
    status: "estimated",
    estimate_meso: 1_985_685_001,
    components: {
      base: { contribution_meso: 300_000_000, identifiable: true },
      potential_grade: {
        contribution_meso: 1_233_537_692,
        identifiable: false,
        confidence_score: 0.01,
      },
      potential_options: {
        contribution_meso: 411_179_231,
        identifiable: false,
        confidence_score: 0.01,
      },
      trade: { contribution_meso: 40_968_078, identifiable: true },
    },
    diagnostics: {},
  }, {
    potential_grade: { status: "calculated", expected_cost_meso: 376_180_000 },
    potential_options: { status: "calculated", expected_cost_meso: 9_455_630_000 },
  });

  const grade = result.components.potential_grade;
  const options = result.components.potential_options;
  assert.equal(
    Object.values(result.components).reduce((sum, row) => sum + row.contribution_meso, 0),
    result.estimate_meso,
  );
  assert.ok(grade.contribution_meso < options.contribution_meso);
  assert.equal(grade.market_allocation.method, "shared_expected_cost_recovery");
  assert.equal(options.market_allocation.method, "shared_expected_cost_recovery");
  const gradeRecovery = grade.contribution_meso / 376_180_000;
  const optionRecovery = options.contribution_meso / 9_455_630_000;
  assert.ok(Math.abs(gradeRecovery - optionRecovery) < 1e-8);
});

test("입력한 추옵 수치는 보스 장비 메타와 기존 추옵 계산기로 자동 계산한다", () => {
  const result = calculateItemMarketExpectedCosts({
    target: targetItem({
      flame: { str_flat: 60, dex_flat: 20, all_stat_pct: 4, attack_flat: 4 },
      setName: "에테르넬 세트(전사)",
    }),
    storage: null,
  });
  assert.equal(result.components.flame.status, "calculated");
  assert.equal(result.components.flame.method, "추가옵션 재설정");
  assert.ok(result.components.flame.expected_cost_meso > 0);
  assert.ok(result.components.flame.evidence.length > 0);
});

test("입력한 주문서 수치는 저장 시세와 기존 주문서 계산기로 자동 계산한다", () => {
  const result = calculateItemMarketExpectedCosts({
    target: targetItem({
      level: 150,
      upgrade: { max: 8, applied: 8, remaining: 0, recoverable: 0 },
      scroll: {
        str_flat: 80,
        hp_flat: 1_360,
        defense_flat: 120,
        attack_flat: 1,
      },
    }),
    storage: null,
  });
  assert.equal(result.components.scroll.status, "calculated");
  assert.equal(result.components.scroll.method, "spell_trace");
  assert.equal(result.components.scroll.method_label, "주흔 15%");
  assert.ok(result.components.scroll.expected_cost_meso > 0);
});

test("일반 놀긍과 리턴을 가를 수 없는 주문서 수치에는 임의 기댓값을 붙이지 않는다", () => {
  const result = calculateItemMarketExpectedCosts({
    target: targetItem({
      requiredJob: "공용",
      category: "반지",
      level: 160,
      upgrade: { max: 3, applied: 3, remaining: 0, recoverable: 0 },
      scroll: { str_flat: 3, attack_flat: 6 },
    }),
    storage: null,
  });
  assert.equal(result.components.scroll.status, "unavailable");
  assert.equal(result.components.scroll.method, "chaos_or_return");
  assert.equal(result.components.scroll.expected_cost_meso, null);
});
