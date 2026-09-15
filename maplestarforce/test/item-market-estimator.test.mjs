import assert from "node:assert/strict";
import test from "node:test";

import {
  estimateItemMarketValue,
  extractCanonicalMarketTrainingFeatures,
  extractItemMarketFeatures,
  fitItemMarketModel,
  resolveItemMarketProfile,
} from "../src/shared/item-market-estimator.js";
import {
  deriveAppliedUpgradeCount,
  inferItemUpgradeSlotMaximum,
  readUpgradeSlotMaximum,
} from "../src/shared/item-upgrade-slots.js";

function potential(grade = "none", lines = []) {
  return { collected: true, grade, lines };
}

function item({
  name = "거대한 공포",
  category = "반지",
  starforce = 0,
  mainGrade = "none",
  mainLines = [],
  additionalGrade = "none",
  additionalLines = [],
  scroll = {},
  flame = {},
  applied = 0,
  maximum = null,
  remaining = Math.max(0, 3 - applied),
  recoverable = 0,
  trade = "untradeable_after_equip",
  scissorsRemaining = null,
  requiredLevelReduction = 0,
  requiredJob = "공용",
  basePriceMeso = null,
  baseLevel = 200,
} = {}) {
  return {
    name,
    category,
    required_job: requiredJob,
    base_level: baseLevel,
    base_price_meso: basePriceMeso,
    required_level_reduction: requiredLevelReduction,
    starforce: { value: starforce, applicable: true, confidence: "confirmed" },
    upgrade: { max: maximum, applied, remaining, recoverable },
    trade: { state: trade, scissors_remaining: scissorsRemaining },
    stats: { base: {}, starforce: {}, scroll, flame, other: {}, total: {} },
    potential: potential(mainGrade, mainLines),
    additional_potential: potential(additionalGrade, additionalLines),
  };
}

function sold(options = {}, price = 1_000_000_000, soldAt = "2026-09-01T00:00:00.000Z", floor = null) {
  return {
    price_meso: String(Math.round(price)),
    sold_at: soldAt,
    item: item(options),
    sampling_frames: [{ price_min_meso: floor }],
    quality: { unknown_potential_lines: 0 },
  };
}

const CHARACTER_PROFILE = {
  source: "character",
  character: { name: "테스트", level: 285 },
  mainStat: "STR",
  subStats: ["DEX"],
  attackType: "attack",
  characterLevel: 285,
  statEquivalence: {
    flatMainStatToPercent: 0.1,
    flatSubStatToFlatMainStat: 0.25,
    flatStatToFlatMainStatByStat: { STR: 1, DEX: 0.25, INT: 0, LUK: 0 },
    statPercentToMainPercentByStat: { STR: 1, DEX: 0.12, INT: 0, LUK: 0 },
    subStatPercentToMainPercent: 0.12,
    attackToMainStat: 3,
    allStatPercentToMainPercent: 1.12,
    criticalDamageToMainPercent: 4,
    attackPercentToMainPercent: 5,
    bossDamageToMainPercent: 1.25,
    currentIgnoreDefense: 0.95,
    oneMainPercentRelative: 0.01,
  },
};

test("장비 최대 업그레이드 횟수와 잔여·복구 가능만으로 적용 주문서 수를 복원한다", () => {
  assert.equal(readUpgradeSlotMaximum({ upgrade: {
    max: 6,
    applied: 99,
    remaining: 2,
    recoverable: 1,
  } }), 6);
  assert.equal(readUpgradeSlotMaximum({ item: { upgrade: {
    max: null,
    applied: 3,
    remaining: 2,
    recoverable: 1,
  } } }), 6);
  assert.equal(deriveAppliedUpgradeCount({ maximum: 6, remaining: 2, recoverable: 1 }), 3);
  assert.equal(deriveAppliedUpgradeCount({ maximum: 6, remaining: 5, recoverable: 2 }), null);
  assert.equal(deriveAppliedUpgradeCount({ maximum: 6, remaining: "", recoverable: 0 }), null);

  const records = [
    { item: { upgrade: { applied: 1, remaining: 4, recoverable: 1 } } },
    { item: { upgrade: { applied: 3, remaining: 2, recoverable: 1 } } },
    { item: { upgrade: { applied: 0, remaining: 3, recoverable: 0 } } },
  ];
  assert.equal(inferItemUpgradeSlotMaximum(records), 6);
});

test("시세 특징은 max가 있으면 사용자 적용 수 대신 잔여·복구 가능으로 적용 수를 파생한다", () => {
  const target = item({ applied: 19, remaining: 2, recoverable: 1 });
  target.upgrade.max = 6;
  const features = extractItemMarketFeatures(target, { profile: CHARACTER_PROFILE });

  assert.equal(features.components.scroll_maximum, 6);
  assert.equal(features.components.scroll_applied, 3);
  assert.equal(features.vector.scroll_applied, 3);
});

test("기존 캐릭터 환산 계수로 잠재·주문서·추옵을 같은 주스탯%급 축에 놓는다", () => {
  const features = extractItemMarketFeatures(item({
    mainGrade: "legendary",
    mainLines: [
      { code: "STR", value: 12, unit: "pct" },
      { code: "ALL_STAT", value: 9, unit: "pct" },
      { code: "DEX", value: 9, unit: "pct" },
    ],
    additionalGrade: "epic",
    additionalLines: [{
      code: "STAT_PER_CHARACTER_LEVEL",
      value: null,
      unit: null,
      params: { levels_per_increment: 9, stat_code: "STR", stat_value: 2 },
    }],
    scroll: { str_flat: 30, dex_flat: 20, attack_flat: 5 },
    flame: { str_flat: 60, all_stat_pct: 6 },
  }), { profile: CHARACTER_PROFILE });

  assert.equal(features.profile.source, "character");
  assert.equal(features.profile.confidence, "high");
  assert.ok(Math.abs(features.components.potential_options_main_stat_percent - 23.16) < 1e-9);
  assert.ok(Math.abs(features.components.additional_options_main_stat_percent - 6.2) < 1e-9);
  assert.ok(Math.abs(features.components.scroll_main_stat_percent - 5) < 1e-9);
  assert.ok(Math.abs(features.components.flame_main_stat_percent - 12.72) < 1e-9);
});

test("캐릭터 정보가 없으면 출처와 낮은 신뢰도를 명시한 보수적 기본 환산을 쓴다", () => {
  const profile = resolveItemMarketProfile();
  const features = extractItemMarketFeatures(item({
    mainLines: [{ code: "ATTACK", value: 12, unit: "pct" }],
  }));

  assert.equal(profile.conversionSource, "default_conservative");
  assert.equal(profile.conversionConfidence, "low");
  assert.equal(
    resolveItemMarketProfile({ source: "default", mainStat: "INT" }).conversionConfidence,
    "low",
  );
  assert.equal(features.profile.source, "default_conservative");
  assert.equal(features.components.potential_options_main_stat_percent, 48);
  const ied = extractItemMarketFeatures(item({
    mainLines: [{ code: "IGNORE_DEFENSE", value: 30, unit: "pct" }],
  }));
  assert.equal(ied.vector.potential_combat, 0);
  assert.equal(ied.option_quality.unconverted_combat_lines, 1);
  assert.equal(ied.profile.supports_ignore_defense, false);
});

test("잠재와 에디 등업값은 등급별 누적 구간으로 분리한다", () => {
  const features = extractItemMarketFeatures(item({
    mainGrade: "legendary",
    additionalGrade: "unique",
  }), { profile: CHARACTER_PROFILE });

  assert.deepEqual([
    features.vector.potential_grade_rare,
    features.vector.potential_grade_epic,
    features.vector.potential_grade_unique,
    features.vector.potential_grade_legendary,
  ], [1, 1, 1, 1]);
  assert.deepEqual([
    features.vector.additional_grade_rare,
    features.vector.additional_grade_epic,
    features.vector.additional_grade_unique,
    features.vector.additional_grade_legendary,
  ], [1, 1, 1, 0]);
});

test("방어율 무시는 여러 줄을 곱연산한 뒤 캐릭터 보스 기준으로 환산한다", () => {
  const withoutIed = extractItemMarketFeatures(item(), { profile: CHARACTER_PROFILE });
  const withIed = extractItemMarketFeatures(item({
    mainLines: [
      { code: "IGNORE_DEFENSE", value: 30, unit: "pct" },
      { code: "IGNORE_DEFENSE", value: 30, unit: "pct" },
    ],
  }), { profile: CHARACTER_PROFILE });

  assert.equal(withoutIed.vector.potential_combat, 0);
  assert.ok(withIed.vector.potential_combat > 0);
  assert.equal(withIed.option_quality.unknown_lines, 0);
});

test("제논 프로필은 부스탯 배열이 비어도 스탯별 환산 맵으로 STR·DEX·LUK를 반영한다", () => {
  const xenon = {
    ...CHARACTER_PROFILE,
    mainStat: "ALL",
    statModel: "xenon",
    subStats: [],
    statEquivalence: {
      ...CHARACTER_PROFILE.statEquivalence,
      flatStatToFlatMainStatByStat: { STR: 1, DEX: 0.8, INT: 0, LUK: 0.7 },
      statPercentToMainPercentByStat: { STR: 1, DEX: 0.9, INT: 0, LUK: 0.85 },
    },
  };
  const features = extractItemMarketFeatures(item({
    mainLines: [
      { code: "DEX", value: 12, unit: "pct" },
      { code: "LUK", value: 9, unit: "pct" },
      { code: "INT", value: 12, unit: "pct" },
    ],
    scroll: { all_stat_flat: 10 },
  }), { profile: xenon });

  assert.ok(Math.abs(features.vector.potential_combat - 18.45) < 1e-9);
  assert.ok(Math.abs(features.vector.scroll_equivalent - 2.5) < 1e-9);
});

test("공·마 고정값은 공격력 환산계수를 정확히 한 번만 곱한다", () => {
  const physical = extractItemMarketFeatures(item({ scroll: { attack_flat: 1 } }), {
    profile: CHARACTER_PROFILE,
  });
  const magical = extractItemMarketFeatures(item({ scroll: { magic_attack_flat: 1 } }), {
    profile: { ...CHARACTER_PROFILE, mainStat: "INT", subStats: ["LUK"], attackType: "magic" },
  });

  assert.ok(Math.abs(physical.vector.scroll_equivalent - 0.3) < 1e-12);
  assert.ok(Math.abs(magical.vector.scroll_equivalent - 0.3) < 1e-12);
});

test("시장 학습축은 직업별 주스탯과 제논 올스탯·도적 이중 부스탯을 보존한다", () => {
  const marketCombat = (features) => features.vector.potential_combat +
    features.vector.potential_combat_above_21 + features.vector.potential_combat_above_33;
  for (const [requiredJob, code] of [
    ["전사", "STR"],
    ["궁수", "DEX"],
    ["마법사", "INT"],
    ["도적", "LUK"],
  ]) {
    const features = extractCanonicalMarketTrainingFeatures(item({
      requiredJob,
      mainLines: [{ code, value: 30, unit: "pct" }],
    }));
    assert.ok(Math.abs(marketCombat(features) - 30) < 1e-9, `${requiredJob} ${code}`);
  }

  const thief = extractCanonicalMarketTrainingFeatures(item({
    requiredJob: "도적",
    mainLines: [
      { code: "LUK", value: 30, unit: "pct" },
      { code: "STR", value: 9, unit: "pct" },
      { code: "DEX", value: 9, unit: "pct" },
    ],
  }));
  assert.ok(Math.abs(marketCombat(thief) - 32.16) < 1e-9);

  const xenon = extractCanonicalMarketTrainingFeatures(item({
    mainLines: [{ code: "ALL_STAT", value: 10, unit: "pct" }],
  }));
  assert.equal(xenon.training_profile_family, "XENON");
  assert.ok(Math.abs(marketCombat(xenon) - 24.75) < 1e-9);

  const mixed = extractCanonicalMarketTrainingFeatures(item({
    mainLines: [{ code: "INT", value: 30, unit: "pct" }],
    scroll: { str_flat: 300 },
    flame: { luk_flat: 300 },
  }));
  assert.equal(mixed.training_profile_family, "INT");
  assert.equal(mixed.training_profile_by_component.potential_options, "INT");
  assert.equal(mixed.training_profile_by_component.scroll, "STR");
  assert.equal(mixed.training_profile_by_component.flame, "LUK");
  assert.equal(mixed.vector.potential_family_int, 1);
  assert.ok([
    marketCombat(mixed),
    mixed.vector.scroll_equivalent,
    mixed.vector.flame_equivalent,
  ].every((value) => value > 0));

  const polluted = extractCanonicalMarketTrainingFeatures(item({
    mainGrade: "unique",
    mainLines: [{ code: "INT", value: 21, unit: "pct" }],
    additionalGrade: "unique",
    additionalLines: [{ code: "STR", value: 12, unit: "pct" }],
    scroll: { dex_flat: 300 },
    flame: { luk_flat: 300 },
  }));
  assert.equal(polluted.training_profile_by_component.potential_options, "INT");
  assert.equal(polluted.vector.potential_family_int, 1);
  assert.equal(marketCombat(polluted), 21);

  const xenonMix = extractCanonicalMarketTrainingFeatures(item({
    mainGrade: "unique",
    mainLines: [
      { code: "LUK", value: 15, unit: "pct" },
      { code: "STR", value: 6, unit: "pct" },
    ],
  }));
  assert.equal(xenonMix.training_profile_by_component.potential_options, "XENON");
  assert.equal(xenonMix.vector.potential_family_xenon, 1);
});

test("데몬어벤져 캐릭터 환산은 올스탯 가치가 0이어도 완전한 프로필이다", () => {
  const profile = resolveItemMarketProfile({
    source: "character",
    mainStat: "HP",
    subStats: [],
    attackType: "attack",
    statModel: "demon-avenger",
    statEquivalence: {
      ...CHARACTER_PROFILE.statEquivalence,
      flatMainStatToPercent: 1 / 35,
      attackToMainStat: 140,
      allStatPercentToMainPercent: 0,
    },
  });
  assert.equal(profile.conversionConfidence, "high");
});

test("오토스틸은 주스탯 환산과 분리된 잠재 유틸리티 특징이다", () => {
  const features = extractItemMarketFeatures(item({
    mainLines: [{ code: "AUTO_STEAL", value: 7, unit: "pct" }],
    additionalLines: [{ code: "AUTO_STEAL_CHANCE", value: 4, unit: "pct" }],
  }), { profile: CHARACTER_PROFILE });
  assert.equal(features.vector.potential_auto_steal, 7);
  assert.equal(features.vector.additional_auto_steal, 4);
  assert.equal(features.vector.potential_combat, 0);
});

test("동일 장비 판매완료 표본만 사용해 아홉 요소를 합산하고 강화 가치를 분리한다", () => {
  const records = [];
  const grades = ["none", "epic", "unique", "legendary"];
  for (let index = 0; index < 120; index += 1) {
    const starforce = [0, 0, 17, 18, 21, 22][index % 6];
    const grade = grades[index % grades.length];
    const statPercent = [0, 9, 18, 21, 30][index % 5];
    const additionalPercent = [0, 4, 8][Math.floor(index / 4) % 3];
    const scrollStat = [0, 20, 40][Math.floor(index / 5) % 3];
    const flameStat = [0, 40, 80, 120][Math.floor(index / 3) % 4];
    const logPrice = Math.log(800_000_000) +
      starforce * 0.035 +
      (["none", "rare", "epic", "unique", "legendary"].indexOf(grade)) * 0.1 +
      statPercent * 0.018 +
      additionalPercent * 0.022 +
      scrollStat * 0.003 +
      flameStat * 0.002;
    records.push(sold({
      starforce,
      mainGrade: grade,
      mainLines: statPercent ? [{ code: "STR", value: statPercent, unit: "pct" }] : [],
      additionalGrade: additionalPercent ? "epic" : "none",
      additionalLines: additionalPercent ? [{ code: "STR", value: additionalPercent, unit: "pct" }] : [],
      scroll: { str_flat: scrollStat },
      flame: { str_flat: flameStat },
      applied: scrollStat ? 3 : 0,
    }, Math.exp(logPrice), `2026-08-${String(1 + index % 28).padStart(2, "0")}T00:00:00.000Z`));
  }
  // 이름이 다르면 비싸도 절대 학습에 섞지 않는다.
  records.push(sold({ name: "고통의 근원", starforce: 25 }, 99_000_000_000));

  const target = item({
    starforce: 22,
    mainGrade: "legendary",
    mainLines: [{ code: "STR", value: 30, unit: "pct" }],
    additionalGrade: "epic",
    additionalLines: [{ code: "STR", value: 8, unit: "pct" }],
    scroll: { str_flat: 40 },
    flame: { str_flat: 120 },
    applied: 3,
  });
  const result = estimateItemMarketValue({ target, comparables: records, profile: CHARACTER_PROFILE });

  assert.equal(result.status, "estimated");
  assert.equal(result.confidence.sample_count, 120);
  assert.equal(result.confidence.total_same_item_sales, 120);
  assert.equal(result.component_order.length, 9);
  const sum = Object.values(result.components)
    .reduce((total, component) => total + component.contribution_meso, 0);
  assert.equal(sum, result.estimate_meso);
  assert.ok(result.components.base.contribution_meso > 0);
  assert.ok(result.components.starforce.contribution_meso > 0);
  assert.ok(result.components.potential_grade.contribution_meso > 0);
  assert.ok(result.components.potential_options.contribution_meso > 0);
  assert.ok(result.components.additional_options.contribution_meso > 0);
  assert.ok(result.components.scroll.contribution_meso > 0);
  assert.ok(result.components.flame.contribution_meso > 0);
  assert.ok(result.range_meso.low <= result.estimate_meso);
  assert.ok(result.range_meso.high >= result.estimate_meso);

  const changedInput = estimateItemMarketValue({
    target: item({ starforce: 21 }),
    comparables: records,
    profile: CHARACTER_PROFILE,
  });
  assert.equal(result.diagnostics.fitted_model_reused, false);
  assert.equal(changedInput.diagnostics.fitted_model_reused, true);
});

test("동일 장비 전체 학습과 최근 거래 가중치를 유지하며 목표 조건은 로컬 보정에만 쓴다", () => {
  const target = item();
  const records = [
    sold({}, 1_000_000_000, "2026-09-01T00:00:00.000Z"),
    sold({}, 4_000_000_000, "2025-09-01T00:00:00.000Z"),
    sold({}, 4_000_000_000, "2025-09-02T00:00:00.000Z"),
  ];
  const recent = estimateItemMarketValue({
    target,
    comparables: records,
    profile: CHARACTER_PROFILE,
    asOf: "2026-09-02T00:00:00.000Z",
    halfLifeDays: 20,
  });
  const nearlyTimeless = estimateItemMarketValue({
    target,
    comparables: records,
    profile: CHARACTER_PROFILE,
    asOf: "2026-09-02T00:00:00.000Z",
    halfLifeDays: 100_000,
  });

  assert.ok(recent.estimate_meso < nearlyTimeless.estimate_meso);
  assert.match(recent.diagnostics.training_scope, /all valid sold records/u);
  assert.match(recent.diagnostics.training_scope, /target-conditioned hierarchical local calibration/u);
  assert.equal("distance_weighting" in recent.diagnostics, false);
  assert.match(recent.diagnostics.time_weighting, /half-life/u);
});

test("검색 가격 하한 문구는 숨기고 표본 부족·외삽은 알린다", () => {
  const records = [
    sold({}, 60_000_000, "2026-09-01T00:00:00.000Z", 50_000_000),
    sold({}, 70_000_000, "2026-09-01T00:00:00.000Z", 50_000_000),
    sold({}, 80_000_000, "2026-09-01T00:00:00.000Z", 50_000_000),
  ];
  const result = estimateItemMarketValue({
    target: item({ starforce: 25 }),
    comparables: records,
    profile: CHARACTER_PROFILE,
  });

  assert.equal(result.confidence.level, "low");
  assert.ok(!result.warnings.some(({ code }) => code === "search_price_floor_bias"));
  assert.ok(result.warnings.some(({ code }) => code === "small_sample"));
  assert.ok(result.warnings.some(({ code }) => code === "component_unidentified"));
  assert.equal(result.components.starforce.confidence, "low");
});

test("같은 장비의 유효한 거래가 없으면 숫자를 꾸며내지 않는다", () => {
  const result = estimateItemMarketValue({
    target: item(),
    comparables: [sold({ name: "고통의 근원" }, 1_000_000_000)],
    profile: CHARACTER_PROFILE,
  });

  assert.equal(result.status, "no_data");
  assert.equal(result.estimate_meso, null);
  assert.ok(result.warnings.some(({ code }) => code === "no_same_item_sales"));
});

test("경매장 가격은 보는 캐릭터와 무관하고 개인 환산 표시만 달라진다", () => {
  const statCodes = ["STR", "DEX", "INT", "LUK"];
  const records = Array.from({ length: 96 }, (_, index) => {
    const statPercent = [9, 18, 21, 30][index % 4];
    return sold({
      mainGrade: "legendary",
      mainLines: [{ code: statCodes[index % statCodes.length], value: statPercent, unit: "pct" }],
      starforce: [0, 17, 21, 22][Math.floor(index / 4) % 4],
    }, 800_000_000 * Math.exp(statPercent * 0.025),
    new Date(Date.UTC(2026, 4, 1) + index * 3_600_000).toISOString());
  });
  const target = item({
    mainGrade: "legendary",
    mainLines: [{ code: "STR", value: 30, unit: "pct" }],
  });
  const strResult = estimateItemMarketValue({ target, comparables: records, profile: CHARACTER_PROFILE });
  const intResult = estimateItemMarketValue({
    target,
    comparables: records,
    profile: {
      ...CHARACTER_PROFILE,
      mainStat: "INT",
      subStats: ["LUK"],
      attackType: "magic",
      statEquivalence: {
        ...CHARACTER_PROFILE.statEquivalence,
        flatStatToFlatMainStatByStat: { STR: 0, DEX: 0, INT: 1, LUK: 0.25 },
        statPercentToMainPercentByStat: { STR: 0, DEX: 0, INT: 1, LUK: 0.12 },
      },
    },
  });

  assert.equal(strResult.estimate_meso, intResult.estimate_meso);
  assert.deepEqual(strResult.components, intResult.components);
  assert.notEqual(
    strResult.normalization.personal_equivalence.target_components
      .potential_options_main_stat_percent,
    intResult.normalization.personal_equivalence.target_components
      .potential_options_main_stat_percent,
  );
});

test("제공된 노작값은 정확히 고정하고 나머지 시장 요소를 더한다", () => {
  const records = Array.from({ length: 48 }, (_, index) => sold({
    starforce: index % 3 ? 17 : 0,
  }, index % 3 ? 2_000_000_000 : 800_000_000,
  new Date(Date.UTC(2026, 5, 1) + index * 3_600_000).toISOString()));
  const basePriceMeso = 12_345_678;
  const result = estimateItemMarketValue({
    target: item({ basePriceMeso, starforce: 17 }),
    comparables: records,
    profile: CHARACTER_PROFILE,
  });

  assert.equal(result.components.base.contribution_meso, basePriceMeso);
  assert.equal(result.diagnostics.base_price_source, "provided_equipment_preset");
  assert.equal(
    Object.values(result.components).reduce((sum, row) => sum + row.contribution_meso, 0),
    result.estimate_meso,
  );
  const raised = estimateItemMarketValue({
    target: item({ basePriceMeso: basePriceMeso + 1_000_000_000, starforce: 17 }),
    comparables: records,
    profile: CHARACTER_PROFILE,
  });
  for (const key of result.component_order.filter((key) => key !== "base")) {
    assert.equal(raised.components[key].contribution_meso, result.components[key].contribution_meso);
  }
  assert.equal(raised.estimate_meso - result.estimate_meso, 1_000_000_000);
  assert.equal(raised.range_meso.low - result.range_meso.low, 1_000_000_000);
  assert.equal(raised.range_meso.high - result.range_meso.high, 1_000_000_000);
  assert.equal(
    raised.range_meso.high - raised.range_meso.low,
    result.range_meso.high - result.range_meso.low,
  );
  assert.match(raised.range_meso.coverage, /^anchored_total_shifted/u);
});

test("같은 장비에서 값이 항상 같은 feature는 intercept와 섞지 않고 계수를 0으로 둔다", () => {
  const records = Array.from({ length: 48 }, (_, index) => sold({
    trade: "one_trade_left",
    scissorsRemaining: 5,
    starforce: index % 2 ? 17 : 0,
  }, index % 2 ? 2_000_000_000 : 1_000_000_000,
  new Date(Date.UTC(2026, 5, 1) + index * 3_600_000).toISOString()));
  const model = fitItemMarketModel({ itemName: "거대한 공포", comparables: records });

  assert.equal(model.fitted.featureVariation.trade_one_left, false);
  assert.equal(model.fitted.featureVariation.trade_scissors_remaining, false);
  assert.equal(model.fitted.coefficients.trade_one_left, 0);
  assert.equal(model.fitted.coefficients.trade_scissors_remaining, 0);
});

test("슬롯 소모·복구 가능은 음수 감가, 레벨 감소와 거래 상태는 별도 요소로 학습한다", () => {
  const records = Array.from({ length: 120 }, (_, index) => {
    const applied = index % 4;
    const recoverable = Math.floor(index / 4) % 3;
    const requiredLevelReduction = Math.floor(index / 12) % 3 * 10;
    const trade = Math.floor(index / 3) % 2 ? "one_trade_left" : "untradeable_after_equip";
    const logPrice = Math.log(2_000_000_000) - applied * 0.035 - recoverable * 0.06 +
      requiredLevelReduction * 0.012 - (trade === "one_trade_left" ? 0.14 : 0);
    return sold({ applied, recoverable, requiredLevelReduction, trade }, Math.exp(logPrice),
      new Date(Date.UTC(2026, 3, 1) + index * 3_600_000).toISOString());
  });
  const untradeable = estimateItemMarketValue({
    target: item({ applied: 2, recoverable: 1, requiredLevelReduction: 20 }),
    comparables: records,
    profile: CHARACTER_PROFILE,
  });
  const oneLeft = estimateItemMarketValue({
    target: item({
      applied: 2,
      recoverable: 1,
      requiredLevelReduction: 20,
      trade: "one_trade_left",
    }),
    comparables: records,
    profile: CHARACTER_PROFILE,
  });

  assert.ok(untradeable.components.scroll.contribution_meso < 0);
  assert.ok(untradeable.components.flame.contribution_meso > 0);
  assert.ok(oneLeft.components.trade.contribution_meso < 0);
  assert.ok(oneLeft.estimate_meso < untradeable.estimate_meso);
  assert.equal(
    Object.values(oneLeft.components).reduce((sum, row) => sum + row.contribution_meso, 0),
    oneLeft.estimate_meso,
  );
});

test("시장 효과가 0인 강화 요소는 0원으로 단정하지 않고 분리 불가로 표시한다", () => {
  const records = Array.from({ length: 60 }, (_, index) => sold({
    flame: { str_flat: [0, 40, 80][index % 3] },
  }, 1_000_000_000,
  new Date(Date.UTC(2026, 2, 1) + index * 3_600_000).toISOString()));
  const result = estimateItemMarketValue({
    target: item({ flame: { str_flat: 80 } }),
    comparables: records,
    profile: CHARACTER_PROFILE,
  });

  assert.equal(result.components.flame.identifiable, false);
  assert.ok(result.components.flame.reason_codes.includes("no_learned_market_effect"));
  assert.ok(result.warnings.some(({ code, component }) =>
    code === "component_unidentified" && component === "flame"));
});

test("시간분할 최신 거래 오차가 크면 신뢰도를 낮추고 범위를 넓힌다", () => {
  const stableRecords = Array.from({ length: 100 }, (_, index) => sold(
    {},
    1_000_000_000,
    new Date(Date.UTC(2026, 0, 1) + index * 3_600_000).toISOString(),
  ));
  const shiftedRecords = stableRecords.map((record, index) => ({
    ...record,
    price_meso: String(index >= 80 ? 4_000_000_000 : 1_000_000_000),
  }));
  const stable = estimateItemMarketValue({
    target: item(), comparables: stableRecords, profile: CHARACTER_PROFILE,
  });
  const shifted = estimateItemMarketValue({
    target: item(), comparables: shiftedRecords, profile: CHARACTER_PROFILE,
  });

  assert.equal(stable.diagnostics.temporal_validation.available, true);
  assert.equal(stable.confidence.level, "high");
  assert.equal(shifted.confidence.level, "low");
  assert.equal(shifted.range_meso.coverage, "time_holdout_conformal_90");
  assert.ok(shifted.range_meso.high / shifted.range_meso.low > 2);
  assert.ok(shifted.warnings.some(({ code }) => code === "temporal_validation_weak"));
});

test("표본을 크게 벗어난 입력은 예측 전용 범위로 제한해 안전한 정수를 반환한다", () => {
  const records = Array.from({ length: 80 }, (_, index) => sold({
    starforce: [0, 17, 22][index % 3],
    mainGrade: "legendary",
    mainLines: [{ code: "STR", value: [9, 21, 30][index % 3], unit: "pct" }],
    additionalGrade: "epic",
    additionalLines: [{ code: "STR", value: [2, 4, 8][index % 3], unit: "pct" }],
    scroll: { str_flat: [0, 40, 80][index % 3] },
    flame: { str_flat: [0, 60, 120][index % 3] },
  }, 1_000_000_000 * Math.exp((index % 3) * 0.4),
  new Date(Date.UTC(2026, 1, 1) + index * 3_600_000).toISOString()));
  const result = estimateItemMarketValue({
    target: item({
      starforce: 25,
      mainGrade: "legendary",
      mainLines: [{ code: "STR", value: 1_000, unit: "pct" }],
      additionalGrade: "legendary",
      additionalLines: [{ code: "STR", value: 1_000, unit: "pct" }],
      scroll: { str_flat: 1_000, attack_flat: 1_000 },
      flame: { str_flat: 1_000, attack_flat: 1_000, all_stat_pct: 100 },
    }),
    comparables: records,
    profile: CHARACTER_PROFILE,
  });

  assert.equal(Number.isSafeInteger(result.estimate_meso), true);
  assert.equal(Number.isSafeInteger(result.range_meso.high), true);
  assert.ok(result.diagnostics.prediction_feature_clamps.length > 0);
  assert.ok(result.warnings.some(({ code }) => code === "prediction_feature_capped"));
  assert.equal(
    Object.values(result.components).reduce((sum, row) => sum + row.contribution_meso, 0),
    result.estimate_meso,
  );
});

test("동일 조건의 직접 거래를 우선하는 로컬 보정으로 유효 잠재 총액이 붕괴하지 않는다", () => {
  const name = "블랙빈 마크";
  const category = "눈장식";
  const records = [
    sold({
      name, category, starforce: 0, mainGrade: "unique",
      // 원본은 9+6+6 세 줄이어도 UI의 합산 21 한 줄과 같은 조건이어야 한다.
      mainLines: [
        { code: "STR", value: 9, unit: "pct" },
        { code: "STR", value: 6, unit: "pct" },
        { code: "STR", value: 6, unit: "pct" },
      ],
      additionalGrade: "none", applied: 0, maximum: 6, remaining: 6,
      trade: "one_trade_left", scissorsRemaining: 8,
    }, 1_550_000_000, "2026-09-02T20:00:00.000Z"),
    sold({
      name, category, starforce: 0, mainGrade: "unique",
      // 가치 0인 UNKNOWN 잡옵은 유효 옵션 종류 판정을 오염시키지 않는다.
      mainLines: [
        { code: "STR", value: 21, unit: "pct" },
        { code: "UNKNOWN", value: 95, unit: "flat" },
      ],
      additionalGrade: "none", applied: 0, maximum: 6, remaining: 6,
      trade: "one_trade_left", scissorsRemaining: 8,
    }, 1_658_800_000, "2026-09-02T19:59:00.000Z"),
    sold({
      name, category, starforce: 0, mainGrade: "unique",
      mainLines: [{ code: "DEX", value: 21, unit: "pct" }],
      additionalGrade: "none", applied: 0, maximum: 6, remaining: 6,
      trade: "one_trade_left", scissorsRemaining: 8,
    }, 1_700_000_000, "2026-09-02T19:58:00.000Z"),
    sold({
      name, category, starforce: 0, mainGrade: "unique",
      mainLines: [{ code: "INT", value: 21, unit: "pct" }],
      additionalGrade: "none", applied: 0, maximum: 6, remaining: 6,
      trade: "one_trade_left", scissorsRemaining: 8,
    }, 2_100_000_000, "2026-09-02T19:57:00.000Z"),
    ...Array.from({ length: 3 }, (_, index) => sold({
      name, category, starforce: 0, mainGrade: "unique",
      // 시장 환산값만 21급으로 같은 공%는 주스탯% 직접 거래가 아니다.
      mainLines: [{ code: "ATTACK", value: 5.25, unit: "pct" }],
      additionalGrade: "none", applied: 0, maximum: 6, remaining: 6,
      trade: "one_trade_left", scissorsRemaining: 8,
    }, 350_000_000 + index * 10_000_000,
    new Date(Date.UTC(2026, 8, 2, 19, 50 - index)).toISOString())),
    ...Array.from({ length: 3 }, (_, index) => sold({
      name, category, starforce: 0, mainGrade: "unique",
      // 제논용 혼합 21%도 일반 직업 단일 주스탯 21%와 분리한다.
      mainLines: [
        { code: "LUK", value: 15, unit: "pct" },
        { code: "STR", value: 6, unit: "pct" },
      ],
      additionalGrade: "none", applied: 0, maximum: 6, remaining: 6,
      trade: "one_trade_left", scissorsRemaining: 8,
    }, 700_000_000 + index * 10_000_000,
    new Date(Date.UTC(2026, 8, 2, 19, 45 - index)).toISOString())),
    sold({
      name, category, starforce: 12, mainGrade: "legendary",
      mainLines: [
        { code: "INT", value: 12, unit: "pct" },
        { code: "ITEM_DROP_RATE", value: 20, unit: "pct" },
      ],
      additionalGrade: "rare",
      scroll: { int_flat: 3, magic_attack_flat: 6 },
      flame: { int_flat: 16, all_stat_pct: 6 },
      applied: 6, remaining: 0, trade: "one_trade_left", scissorsRemaining: 5,
    }, 1_444_440_000, "2026-09-02T18:45:07.689Z"),
    sold({
      name, category, starforce: 18, mainGrade: "legendary",
      mainLines: [
        { code: "MESO_OBTAINED", value: 20, unit: "pct" },
        { code: "ITEM_DROP_RATE", value: 20, unit: "pct" },
      ],
      additionalGrade: "rare", scroll: { attack_flat: 14 },
      flame: { all_stat_pct: 5, attack_flat: 4 },
      applied: 6, remaining: 0, trade: "one_trade_left", scissorsRemaining: 5,
    }, 5_400_000_000, "2026-09-02T18:11:48.738Z"),
    sold({
      name, category, starforce: 18, mainGrade: "legendary",
      mainLines: [
        { code: "INT", value: 12, unit: "pct" },
        { code: "MESO_OBTAINED", value: 40, unit: "pct" },
      ],
      additionalGrade: "epic", additionalLines: [{ code: "INT", value: 2, unit: "pct" }],
      scroll: { int_flat: 18, magic_attack_flat: 17 },
      flame: { int_flat: 35, all_stat_pct: 5, magic_attack_flat: 6 },
      applied: 6, remaining: 0, trade: "one_trade_left", scissorsRemaining: 0,
    }, 3_400_000_000, "2026-09-02T16:49:31.317Z"),
    sold({
      name, category, starforce: 15, mainGrade: "legendary",
      mainLines: [
        { code: "MESO_OBTAINED", value: 20, unit: "pct" },
        { code: "ITEM_DROP_RATE", value: 20, unit: "pct" },
      ],
      additionalGrade: "rare", flame: { str_flat: 75, all_stat_pct: 4 },
      applied: 0, remaining: 6, trade: "one_trade_left", scissorsRemaining: 7,
    }, 4_888_888_888, "2026-09-02T16:33:20.296Z"),
    sold({
      name, category, starforce: 18, mainGrade: "legendary",
      mainLines: [{ code: "ITEM_DROP_RATE", value: 40, unit: "pct" }],
      additionalGrade: "epic", scroll: { attack_flat: 14 },
      flame: { str_flat: 59, all_stat_pct: 6 },
      applied: 6, remaining: 0, trade: "one_trade_left", scissorsRemaining: 5,
    }, 7_000_000_000, "2026-09-02T14:21:04.153Z"),
  ];
  const target = item({
    name,
    category,
    basePriceMeso: 300_000_000,
    starforce: 0,
    mainGrade: "unique",
    mainLines: [{ code: "INT", value: 21, unit: "pct" }],
    additionalGrade: "none",
    applied: 0,
    remaining: 6,
    recoverable: 0,
    trade: "one_trade_left",
    scissorsRemaining: 8,
  });
  target.upgrade.max = 6;

  const model = fitItemMarketModel({ itemName: name, category, comparables: records });
  const result = estimateItemMarketValue({ target, fittedModel: model });

  assert.ok(model.lambda > 0, "ridge=null은 기본 정규화 강도를 사용해야 한다");
  assert.ok(result.estimate_meso >= 1_200_000_000, JSON.stringify({
    estimate: result.estimate_meso,
    pooling: result.diagnostics.local_partial_pooling,
    components: result.components,
  }));
  assert.ok(result.estimate_meso <= 3_000_000_000);
  assert.equal(result.diagnostics.local_partial_pooling.applied, true);
  assert.equal(
    result.diagnostics.local_partial_pooling.tier,
    "monotonic_standard_family_fallback",
  );
  assert.equal(result.diagnostics.local_partial_pooling.candidate_tier, "exact_all");
  assert.equal(result.diagnostics.local_partial_pooling.structural_match_count, 4);
  assert.equal(result.components.potential_grade.contribution_meso, 0);
  assert.ok(result.components.potential_options.contribution_meso > 0);
  assert.ok(result.warnings.some(({ code, component }) =>
    code === "component_unidentified" && component === "potential_grade"
  ));
  assert.equal(
    Object.values(result.components).reduce((sum, row) => sum + row.contribution_meso, 0),
    result.estimate_meso,
  );
  assert.equal(result.warnings.some(({ code, component }) =>
    code === "component_extrapolated" &&
      ["starforce", "additional_grade", "flame"].includes(component)), false);

  let previousEstimate = result.estimate_meso;
  for (const percent of [24, 30, 36]) {
    const stronger = structuredClone(target);
    stronger.potential.lines = [{ code: "INT", value: percent, unit: "pct" }];
    const strongerResult = estimateItemMarketValue({ target: stronger, fittedModel: model });
    assert.ok(
      strongerResult.estimate_meso >= previousEstimate,
      `${percent}%가 직전 수치보다 낮아졌습니다: ${strongerResult.estimate_meso} < ${previousEstimate}`,
    );
    assert.equal(
      strongerResult.diagnostics.local_partial_pooling.tier,
      "monotonic_standard_family_fallback",
    );
    previousEstimate = strongerResult.estimate_meso;
  }

  const contradictory = structuredClone(target);
  contradictory.upgrade.remaining = 0;
  const contradictoryResult = estimateItemMarketValue({
    target: contradictory,
    fittedModel: model,
  });
  assert.ok(contradictoryResult.estimate_meso >= target.base_price_meso);
  assert.equal(
    Object.values(contradictoryResult.components)
      .reduce((sum, row) => sum + row.contribution_meso, 0),
    contradictoryResult.estimate_meso,
  );
});

test("최소가 검색으로 잘린 노작 매물을 노작 기준가 앵커로 사용하지 않는다", () => {
  const name = "가디언 엔젤 링";
  const category = "반지";
  const floor = 50_000_000;
  const records = [
    ...Array.from({ length: 8 }, (_, index) => sold({
      name,
      category,
      starforce: 0,
      mainGrade: "none",
      additionalGrade: "none",
      applied: 0,
      maximum: 3,
      remaining: 3,
      trade: "one_trade_left",
      scissorsRemaining: 5,
    }, 1_900_000_000 + index * 30_000_000,
    new Date(Date.UTC(2026, 8, 2, 18, index)).toISOString(), floor)),
    ...Array.from({ length: 4 }, (_, index) => sold({
      name,
      category,
      starforce: 0,
      mainGrade: "unique",
      mainLines: [{ code: ["STR", "DEX", "INT", "LUK"][index], value: 21, unit: "pct" }],
      additionalGrade: "none",
      applied: 0,
      maximum: 3,
      remaining: 3,
      trade: "one_trade_left",
      scissorsRemaining: 5,
    }, 1_300_000_000 + index * 50_000_000,
    new Date(Date.UTC(2026, 8, 2, 19, index)).toISOString(), floor)),
    // 실데이터에는 최소가 없는 다른 옵션 검색에서 합쳐진 강화 매물도 존재한다.
    // 무옵션 목표가 이 표본을 로컬 fallback으로 쓰면 안 된다.
    ...Array.from({ length: 5 }, (_, index) => sold({
      name,
      category,
      starforce: 0,
      mainGrade: "legendary",
      mainLines: [{ code: "INT", value: 30, unit: "pct" }],
      additionalGrade: "epic",
      additionalLines: [{ code: "INT", value: 4, unit: "pct" }],
      applied: 0,
      maximum: 3,
      remaining: 3,
      trade: "one_trade_left",
      scissorsRemaining: 5,
    }, 2_400_000_000 + index * 50_000_000,
    new Date(Date.UTC(2026, 8, 2, 20, index)).toISOString())),
  ];
  const target = item({
    name,
    category,
    basePriceMeso: 15_000_000,
    starforce: 0,
    mainGrade: "unique",
    mainLines: [{ code: "INT", value: 21, unit: "pct" }],
    additionalGrade: "none",
    applied: 0,
    maximum: 3,
    remaining: 3,
    trade: "one_trade_left",
    scissorsRemaining: 5,
  });

  const result = estimateItemMarketValue({ target, comparables: records });

  assert.ok(result.estimate_meso >= 900_000_000, JSON.stringify(result.diagnostics));
  assert.equal(result.diagnostics.observed_blank_base_price_meso, null);
  assert.equal(result.diagnostics.local_partial_pooling.base_anchor_delta_meso, 0);
  assert.ok(!result.warnings.some(({ code }) => code === "search_price_floor_bias"));

  const blankTarget = item({
    name,
    category,
    basePriceMeso: 15_000_000,
    starforce: 0,
    mainGrade: "none",
    additionalGrade: "none",
    applied: 0,
    maximum: 3,
    remaining: 3,
    trade: "one_trade_left",
    scissorsRemaining: 5,
  });
  const blankResult = estimateItemMarketValue({ target: blankTarget, comparables: records });

  assert.equal(blankResult.diagnostics.local_partial_pooling.applied, false);
  assert.equal(blankResult.diagnostics.local_partial_pooling.anchor_meso, null);
  assert.equal(blankResult.estimate_meso, blankTarget.base_price_meso);
});

test("주스탯 계열별 가격 곡선을 고정해 다른 계열의 고가 거래가 덮어쓰지 않는다", () => {
  const name = "계열 분리 장신구";
  const records = [
    ...Array.from({ length: 6 }, (_, index) => sold({
      name,
      category: "반지",
      mainGrade: "none",
      additionalGrade: "none",
      maximum: 3,
      remaining: 3,
      trade: "one_trade_left",
      scissorsRemaining: 5,
    }, 100_000_000 + index * 2_000_000,
    new Date(Date.UTC(2026, 7, 31, 10, index)).toISOString())),
    ...[21, 30].flatMap((percent, knot) =>
      Array.from({ length: 3 }, (_, index) => sold({
        name,
        category: "반지",
        mainGrade: "unique",
        mainLines: [{ code: "DEX", value: percent, unit: "pct" }],
        additionalGrade: "none",
        maximum: 3,
        remaining: 3,
        trade: "one_trade_left",
        scissorsRemaining: 5,
      }, 700_000_000 + knot * 200_000_000 + index * 10_000_000,
      new Date(Date.UTC(2026, 8, 1, 10 + knot, index)).toISOString()))
    ),
    ...[21, 30].flatMap((percent, knot) =>
      Array.from({ length: 3 }, (_, index) => sold({
        name,
        category: "반지",
        mainGrade: "unique",
        mainLines: [{ code: "STR", value: percent, unit: "pct" }],
        additionalGrade: "none",
        maximum: 3,
        remaining: 3,
        trade: "one_trade_left",
        scissorsRemaining: 5,
      }, 2_000_000_000 + knot * 400_000_000 + index * 20_000_000,
      new Date(Date.UTC(2026, 8, 1, 14 + knot, index)).toISOString()))
    ),
  ];
  const model = fitItemMarketModel({ itemName: name, category: "반지", comparables: records });
  const zeroResult = estimateItemMarketValue({
    target: item({
      name,
      category: "반지",
      basePriceMeso: 100_000_000,
      mainGrade: "unique",
      mainLines: [],
      additionalGrade: "none",
      maximum: 3,
      remaining: 3,
      trade: "one_trade_left",
      scissorsRemaining: 5,
    }),
    fittedModel: model,
  });
  const estimates = [12, 15, 18, 21, 24, 27, 30, 33, 36].map((percent) =>
    estimateItemMarketValue({
      target: item({
        name,
        category: "반지",
        basePriceMeso: 100_000_000,
        mainGrade: "unique",
        mainLines: [{ code: "DEX", value: percent, unit: "pct" }],
        additionalGrade: "none",
        maximum: 3,
        remaining: 3,
        trade: "one_trade_left",
        scissorsRemaining: 5,
      }),
      fittedModel: model,
    })
  );

  assert.ok(estimates.every((result) =>
    result.diagnostics.local_partial_pooling.monotonic_scope === "exact_family"
  ));
  assert.ok(zeroResult.estimate_meso <= estimates[0].estimate_meso);
  for (let index = 1; index < estimates.length; index += 1) {
    assert.ok(
      estimates[index].estimate_meso >= estimates[index - 1].estimate_meso,
      `${[12, 15, 18, 21, 24, 27, 30, 33, 36][index]}%에서 가격이 역전됐습니다.`,
    );
  }
  const dex21 = estimates[3];
  assert.ok(dex21.diagnostics.local_partial_pooling.monotonic_envelope_anchor_meso < 800_000_000);
  assert.ok(dex21.estimate_meso < 900_000_000, JSON.stringify(dex21.diagnostics));
});

test("서로 일치하는 동일 계열 거래가 두 건이면 보수적으로 점 추정에 반영한다", () => {
  const name = "희소 계열 장신구";
  const common = {
    name,
    category: "반지",
    additionalGrade: "none",
    maximum: 3,
    remaining: 3,
    trade: "one_trade_left",
    scissorsRemaining: 5,
  };
  const records = [
    ...Array.from({ length: 8 }, (_, index) => sold({
      ...common,
      mainGrade: "none",
    }, 100_000_000 + index * 1_000_000,
    new Date(Date.UTC(2026, 7, 31, 10, index)).toISOString())),
    ...Array.from({ length: 2 }, (_, index) => sold({
      ...common,
      mainGrade: "unique",
      mainLines: [{ code: "DEX", value: 21, unit: "pct" }],
    }, 1_000_000_000 + index * 50_000_000,
    new Date(Date.UTC(2026, 8, 1, 10, index)).toISOString())),
    sold({
      ...common,
      mainGrade: "unique",
      mainLines: [{ code: "DEX", value: 24, unit: "pct" }],
    }, 960_000_000, "2026-09-01T10:10:00.000Z"),
    sold({
      ...common,
      mainGrade: "unique",
      mainLines: [{ code: "DEX", value: 24, unit: "pct" }],
    }, 1_200_000_000, "2026-09-01T10:11:00.000Z"),
    ...Array.from({ length: 4 }, (_, index) => sold({
      ...common,
      mainGrade: "unique",
      mainLines: [{ code: "STR", value: 21, unit: "pct" }],
    }, 2_000_000_000 + index * 20_000_000,
    new Date(Date.UTC(2026, 8, 1, 12, index)).toISOString())),
  ];
  const model = fitItemMarketModel({ itemName: name, category: "반지", comparables: records });
  const makeTarget = (percent) => item({
    ...common,
    basePriceMeso: 100_000_000,
    mainGrade: "unique",
    mainLines: [{ code: "DEX", value: percent, unit: "pct" }],
  });
  const lower = estimateItemMarketValue({ target: makeTarget(18), fittedModel: model });
  const exact = estimateItemMarketValue({ target: makeTarget(21), fittedModel: model });
  const higher = estimateItemMarketValue({ target: makeTarget(24), fittedModel: model });

  const sparseApplied = exact.diagnostics.local_partial_pooling.sparse_family_envelope_applied;
  if (sparseApplied) {
    assert.equal(exact.diagnostics.local_partial_pooling.tier, "sparse_exact_family");
    assert.equal(exact.diagnostics.local_partial_pooling.weight, 0.94);
  } else {
    // 구성요소 모델이 이미 두 거래가 가리키는 하한보다 높으면 별도의 94% 보정을
    // 중복 적용하지 않는다.
    assert.equal(
      exact.diagnostics.local_partial_pooling.tier,
      "component_before_first_supported_knot",
    );
  }
  assert.ok(exact.estimate_meso >= 500_000_000, JSON.stringify(exact.diagnostics));
  assert.ok(exact.estimate_meso <= 1_200_000_000);
  assert.ok(lower.estimate_meso <= exact.estimate_meso);
  assert.ok(exact.estimate_meso <= higher.estimate_meso);
});

test("유니크 무유효옵션 한 건의 이상치를 첫 옵션에 94% 전파하지 않는다", () => {
  const name = "무옵션 이상치 장신구";
  const common = {
    name,
    category: "반지",
    additionalGrade: "none",
    maximum: 3,
    remaining: 3,
    trade: "one_trade_left",
    scissorsRemaining: 5,
  };
  const records = [
    ...Array.from({ length: 30 }, (_, index) => sold({
      ...common,
      mainGrade: "none",
    }, 100_000_000 + index * 100_000,
    new Date(Date.UTC(2026, 7, 30, 10, index % 20)).toISOString())),
    sold({ ...common, mainGrade: "unique" }, 10_000_000_000, "2026-09-01T10:00:00.000Z"),
    ...Array.from({ length: 9 }, (_, index) => sold({
      ...common,
      mainGrade: "unique",
      mainLines: [{ code: "STR", value: 21, unit: "pct" }],
    }, 200_000_000 + index * 2_000_000,
    new Date(Date.UTC(2026, 8, 1, 11, index)).toISOString())),
  ];
  const model = fitItemMarketModel({ itemName: name, category: "반지", comparables: records });
  const target = (lines) => item({
    ...common,
    basePriceMeso: 100_000_000,
    mainGrade: "unique",
    mainLines: lines,
  });
  const zero = estimateItemMarketValue({ target: target([]), fittedModel: model });
  const first = estimateItemMarketValue({
    target: target([{ code: "DEX", value: 1, unit: "pct" }]),
    fittedModel: model,
  });

  assert.ok(first.estimate_meso >= zero.estimate_meso);
  assert.ok(first.estimate_meso <= zero.estimate_meso * 1.1);
  assert.ok(first.diagnostics.local_partial_pooling.weight <= 0.42);
  assert.equal(
    first.diagnostics.local_partial_pooling.zero_option_floor_meso,
    zero.estimate_meso,
    "양수 옵션 내부의 0옵션 하한은 0옵션 자체 추정값과 같아야 합니다.",
  );
});

test("비자격 단건 하위 등급 거래를 상위 등급의 가격 하한으로 전파하지 않는다", () => {
  const name = "비자격 하위등급 방어구";
  const common = {
    name,
    category: "망토",
    requiredJob: "궁수",
    maximum: 8,
    remaining: 8,
    trade: "untradeable_after_equip",
    scissorsRemaining: 10,
    additionalGrade: "none",
  };
  const records = [
    ...Array.from({ length: 12 }, (_, index) => sold({
      ...common,
      mainGrade: "none",
    }, 100_000_000 + index * 1_000_000,
    new Date(Date.UTC(2026, 8, 1, 10, index)).toISOString())),
    sold({
      ...common,
      mainGrade: "unique",
    }, 10_000_000_000, "2026-09-01T10:20:00.000Z"),
    ...Array.from({ length: 4 }, (_, index) => sold({
      ...common,
      mainGrade: "legendary",
    }, 300_000_000 + index * 5_000_000,
    new Date(Date.UTC(2026, 8, 1, 10, 30 + index)).toISOString())),
  ];
  const result = estimateItemMarketValue({
    target: item({
      ...common,
      basePriceMeso: 100_000_000,
      mainGrade: "legendary",
    }),
    comparables: records,
  });

  assert.equal(
    result.diagnostics.local_partial_pooling.grade_monotonic_floor,
    null,
    "비자격 단건 하위 등급 anchor를 상위 등급 하한으로 전파하면 안 됩니다.",
  );
  assert.equal(result.diagnostics.local_partial_pooling.tier, "direct_grade_blank");
  assert.equal(result.diagnostics.local_partial_pooling.qualified, true);
  assert.ok(result.estimate_meso >= 280_000_000);
  assert.ok(result.estimate_meso <= 330_000_000, JSON.stringify(result.diagnostics));
});

test("윗잠 로컬 시세 기준이 있어도 빈 에디 등급을 올릴 때 총액이 내려가지 않는다", () => {
  const name = "에디 등급 경계 장갑";
  const common = {
    name,
    category: "장갑",
    requiredJob: "마법사",
    starforce: 0,
    maximum: 8,
    remaining: 8,
    trade: "untradeable_after_equip",
    scissorsRemaining: 10,
  };
  const mainLines = [{ code: "CRITICAL_DAMAGE", value: 16, unit: "pct" }];
  const records = [
    ...Array.from({ length: 24 }, (_, index) => sold({
      ...common,
      mainGrade: "none",
      mainLines: [],
      additionalGrade: "none",
      flame: { int_flat: (index % 3) * 10 },
    }, 1_000_000_000 + index * 10_000_000,
    new Date(Date.UTC(2026, 7, 30, 10, index)).toISOString())),
    ...[
      ["rare", 1_250_000_000],
      ["epic", 1_500_000_000],
      ["unique", 1_850_000_000],
      ["legendary", 2_400_000_000],
    ].flatMap(([additionalGrade, center], gradeIndex) =>
      Array.from({ length: 3 }, (_, index) => sold({
        ...common,
        mainGrade: "none",
        mainLines: [],
        additionalGrade,
        additionalLines: [],
        flame: { int_flat: index * 10 },
      }, center + index * 10_000_000,
      new Date(Date.UTC(2026, 7, 31, 10 + gradeIndex, index)).toISOString()))),
    ...[14_500_000_000, 15_000_000_000].map((price, index) => sold({
      ...common,
      mainGrade: "legendary",
      mainLines,
      additionalGrade: "none",
    }, price, new Date(Date.UTC(2026, 8, 1, 10, index)).toISOString())),
  ];
  const model = fitItemMarketModel({ itemName: name, category: "장갑", comparables: records });
  const grades = ["none", "rare", "epic", "unique", "legendary"].map((grade) =>
    estimateItemMarketValue({
      target: item({
        ...common,
        mainGrade: "legendary",
        mainLines,
        additionalGrade: grade,
        additionalLines: [],
      }),
      fittedModel: model,
    })
  );

  assert.equal(grades[0].diagnostics.local_partial_pooling.tier, "sparse_exact_family");
  assert.equal(grades[0].diagnostics.local_partial_pooling.qualified, true);
  for (let index = 1; index < grades.length; index += 1) {
    assert.ok(
      grades[index].estimate_meso > grades[index - 1].estimate_meso,
      `${index - 1}→${index} 에디 등급에서 총액이 역전됐습니다: ` +
        `${grades[index - 1].estimate_meso} → ${grades[index].estimate_meso}`,
    );
    assert.ok(
      grades[index].components.additional_grade.contribution_meso >
        grades[index - 1].components.additional_grade.contribution_meso,
      grades.map((entry) => ({
        estimate: entry.estimate_meso,
        grade: entry.components.additional_grade.contribution_meso,
        floor: entry.diagnostics.local_partial_pooling.grade_monotonic_floor,
        gradeOnlyApplied: entry.diagnostics.local_partial_pooling.grade_only_floor_applied,
        gradeOnlyEstimate: entry.diagnostics.local_partial_pooling.grade_only_floor_meso,
        tier: entry.diagnostics.local_partial_pooling.tier,
      })).map(JSON.stringify).join("\n"),
    );
    assert.equal(
      Object.values(grades[index].components)
        .reduce((sum, row) => sum + row.contribution_meso, 0),
      grades[index].estimate_meso,
    );
  }
});

test("에디 레전드리 단건 이상치 대신 보수적 공통 등급 기준을 적용한다", () => {
  const name = "에디 단건 이상치 장갑";
  const common = {
    name,
    category: "장갑",
    requiredJob: "마법사",
    starforce: 0,
    maximum: 8,
    remaining: 8,
    trade: "untradeable_after_equip",
    scissorsRemaining: 10,
  };
  const mainLines = [{ code: "CRITICAL_DAMAGE", value: 16, unit: "pct" }];
  const records = [
    ...Array.from({ length: 24 }, (_, index) => sold({
      ...common,
      mainGrade: "none",
      additionalGrade: "none",
      flame: { int_flat: (index % 3) * 10 },
    }, 1_000_000_000 + index * 10_000_000,
    new Date(Date.UTC(2026, 7, 30, 10, index)).toISOString())),
    ...[14_500_000_000, 15_000_000_000].map((price, index) => sold({
      ...common,
      mainGrade: "legendary",
      mainLines,
      additionalGrade: "none",
    }, price, new Date(Date.UTC(2026, 8, 1, 10, index)).toISOString())),
    sold({
      ...common,
      mainGrade: "none",
      additionalGrade: "legendary",
      additionalLines: [{ code: "INT", value: 7, unit: "pct" }],
    }, 100_000_000_000, "2026-09-01T11:00:00.000Z"),
  ];
  const model = fitItemMarketModel({ itemName: name, category: "장갑", comparables: records });
  const grades = ["none", "rare", "epic", "unique", "legendary"].map((grade) =>
    estimateItemMarketValue({
      target: item({
        ...common,
        mainGrade: "legendary",
        mainLines,
        additionalGrade: grade,
      }),
      fittedModel: model,
    })
  );

  const maximumStepPremiums = [200_000_000, 126_000_000, 184_000_000, 250_000_000];
  for (let index = 1; index < grades.length; index += 1) {
    const stepPremium = grades[index].estimate_meso - grades[index - 1].estimate_meso;
    assert.ok(stepPremium > 0);
    assert.ok(stepPremium <= maximumStepPremiums[index - 1]);
    assert.equal(
      grades[index].diagnostics.local_partial_pooling
        .grade_monotonic_floor.grade_step_evidence.qualified,
      false,
    );
    assert.equal(
      grades[index].diagnostics.local_partial_pooling
        .grade_monotonic_floor.grade_step_source,
      "pooled_grade_prior",
    );
    for (const component of Object.keys(grades[0].components)
      .filter((component) => component !== "additional_grade")) {
      assert.equal(
        grades[index].components[component].contribution_meso,
        grades[0].components[component].contribution_meso,
      );
    }
    assert.equal(
      grades[index].components.additional_grade.contribution_meso,
      grades[index].estimate_meso - grades[0].estimate_meso,
    );
    assert.equal(
      Object.values(grades[index].components)
        .reduce((sum, component) => sum + component.contribution_meso, 0),
      grades[index].estimate_meso,
    );
  }
  assert.ok(grades.at(-1).estimate_meso < 20_000_000_000);
});

test("장비 레벨이 없는 자료도 에디 등급별 보수적 가격 차이를 유지한다", () => {
  const name = "레벨 누락 에디 장갑";
  const common = {
    name,
    category: "장갑",
    requiredJob: "마법사",
    maximum: 8,
    remaining: 8,
    trade: "untradeable_after_equip",
    scissorsRemaining: 10,
  };
  const records = Array.from({ length: 24 }, (_, index) => sold({
    ...common,
    baseLevel: null,
    mainGrade: "none",
    additionalGrade: "none",
    flame: { int_flat: (index % 3) * 10 },
  }, 1_000_000_000 + index * 10_000_000,
  new Date(Date.UTC(2026, 7, 30, 10, index)).toISOString()));
  const model = fitItemMarketModel({ itemName: name, category: "장갑", comparables: records });
  const grades = ["none", "rare", "epic", "unique", "legendary"].map((grade) =>
    estimateItemMarketValue({
      target: item({
        ...common,
        baseLevel: null,
        additionalGrade: grade,
      }),
      fittedModel: model,
    })
  );

  for (let index = 1; index < grades.length; index += 1) {
    assert.ok(
      grades[index].estimate_meso > grades[index - 1].estimate_meso,
      `${index - 1}→${index} 에디 등급이 같은 가격입니다: ` +
        `${grades[index - 1].estimate_meso} → ${grades[index].estimate_meso}`,
    );
    assert.equal(
      grades[index].diagnostics.local_partial_pooling
        .grade_monotonic_floor.grade_step_source,
      "pooled_grade_prior",
    );
  }
});

test("같은 에디 옵션을 둔 상태에서도 등급별 가격이 엄격히 증가한다", () => {
  const name = "에디 옵션 등급 경계 장갑";
  const common = {
    name,
    category: "장갑",
    requiredJob: "마법사",
    maximum: 8,
    remaining: 8,
    trade: "untradeable_after_equip",
    scissorsRemaining: 10,
  };
  const mainLines = [{ code: "CRITICAL_DAMAGE", value: 16, unit: "pct" }];
  const additionalLines = [{ code: "INT", value: 3, unit: "pct" }];
  const records = [
    ...Array.from({ length: 24 }, (_, index) => sold({
      ...common,
      mainGrade: "none",
      additionalGrade: "none",
      flame: { int_flat: (index % 3) * 10 },
    }, 1_000_000_000 + index * 10_000_000,
    new Date(Date.UTC(2026, 7, 30, 10, index)).toISOString())),
    ...[14_500_000_000, 15_000_000_000].map((price, index) => sold({
      ...common,
      mainGrade: "legendary",
      mainLines,
      additionalGrade: "none",
    }, price, new Date(Date.UTC(2026, 8, 1, 10, index)).toISOString())),
  ];
  const model = fitItemMarketModel({ itemName: name, category: "장갑", comparables: records });
  const grades = ["none", "rare", "epic", "unique", "legendary"].map((grade) =>
    estimateItemMarketValue({
      target: item({
        ...common,
        mainGrade: "legendary",
        mainLines,
        additionalGrade: grade,
        additionalLines: grade === "none" ? [] : additionalLines,
      }),
      fittedModel: model,
    })
  );

  for (let index = 1; index < grades.length; index += 1) {
    assert.ok(
      grades[index].estimate_meso > grades[index - 1].estimate_meso,
      `${index - 1}→${index} 에디 옵션 포함 등급이 역전됐습니다: ` +
        `${grades[index - 1].estimate_meso} → ${grades[index].estimate_meso}`,
    );
    assert.equal(
      Object.values(grades[index].components)
        .reduce((sum, component) => sum + component.contribution_meso, 0),
      grades[index].estimate_meso,
    );
  }
});

test("교차 스타포스 윗잠 패키지 하한을 에디 등급 반사실에도 전달한다", () => {
  const name = "교차 스타포스 에디 경계 숄더";
  const mainLines = [
    { code: "DEX", value: 13, unit: "pct" },
    { code: "DEX", value: 10, unit: "pct" },
    { code: "STR", value: 10, unit: "pct" },
  ];
  const common = {
    name,
    category: "어깨장식",
    requiredJob: "궁수",
    maximum: 2,
    remaining: 2,
    trade: "untradeable_after_equip",
    scissorsRemaining: null,
  };
  const cases = [
    { price: 1 },
    { price: 36, mainGrade: "legendary" },
    {
      price: 3.3,
      mainGrade: "unique",
      mainLines: [{ code: "DEX", value: 17, unit: "pct" }],
    },
    { price: 51, mainGrade: "legendary", mainLines },
    {
      price: 162,
      starforce: 17,
      mainGrade: "legendary",
      mainLines,
      additionalGrade: "unique",
      additionalLines: [{ code: "DEX", value: 8, unit: "pct" }],
      applied: 1,
      remaining: 1,
      trade: "one_trade_left",
      scroll: { dex_flat: 10, attack_flat: 3 },
    },
    { price: 62, starforce: 18, mainGrade: "legendary", mainLines },
    {
      price: 10,
      starforce: 17,
      mainGrade: "legendary",
      mainLines: [{ code: "DEX", value: 30, unit: "pct" }],
      additionalGrade: "unique",
      additionalLines: [{ code: "DEX", value: 5, unit: "pct" }],
      applied: 2,
      remaining: 0,
      trade: "one_trade_left",
      scroll: { dex_flat: 15, attack_flat: 4 },
    },
    {
      price: 14,
      starforce: 18,
      mainGrade: "unique",
      mainLines: [{ code: "DEX", value: 17, unit: "pct" }],
      additionalGrade: "epic",
      additionalLines: [{ code: "DEX", value: 6, unit: "pct" }],
      applied: 2,
      remaining: 0,
      trade: "one_trade_left",
      scroll: { dex_flat: 16, attack_flat: 4 },
    },
    {
      price: 18,
      starforce: 18,
      mainGrade: "legendary",
      mainLines: [{ code: "DEX", value: 30, unit: "pct" }],
      additionalGrade: "epic",
      additionalLines: [{ code: "DEX", value: 7, unit: "pct" }],
      applied: 2,
      remaining: 0,
      trade: "one_trade_left",
      scroll: { dex_flat: 17, attack_flat: 4 },
    },
  ];
  const records = cases.map(({ price, ...options }, index) => sold(
    { ...common, ...options },
    price * 100_000_000,
    new Date(Date.UTC(2026, 8, 1, 10, index + 1)).toISOString(),
  ));
  const model = fitItemMarketModel({
    itemName: name,
    category: "어깨장식",
    comparables: records,
  });
  const estimate = (additionalGrade) => estimateItemMarketValue({
    target: item({
      ...common,
      mainGrade: "legendary",
      mainLines,
      additionalGrade,
      additionalLines: [],
    }),
    fittedModel: model,
  });

  const none = estimate("none");
  const rare = estimate("rare");
  const nonePool = none.diagnostics.local_partial_pooling;
  const rarePool = rare.diagnostics.local_partial_pooling;

  assert.equal(nonePool.tier, "cross_star_potential_options_package_floor");
  assert.equal(nonePool.option_package_floor.applied, true);
  assert.equal(nonePool.option_package_floor.evidence_count, 3);
  assert.ok(rare.estimate_meso > none.estimate_meso);
  assert.ok(rare.estimate_meso - none.estimate_meso <= 200_000_000);
  assert.equal(rarePool.qualified, true);
  for (const component of Object.keys(none.components)
    .filter((component) => component !== "additional_grade")) {
    assert.ok(
      Math.abs(
        rare.components[component].contribution_meso -
          none.components[component].contribution_meso,
      ) <= 2,
      `${component} 귀속이 등급 하한 적용 과정에서 바뀌었습니다.`,
    );
  }
  assert.ok(
    Math.abs(
      rare.components.additional_grade.contribution_meso -
        (rare.estimate_meso - none.estimate_meso),
    ) <= 2,
  );
  assert.equal(
    Object.values(rare.components)
      .reduce((sum, component) => sum + component.contribution_meso, 0),
    rare.estimate_meso,
  );
});

test("제논 혼합 잠재는 실제 스탯 코드를 보존하고 등업값을 옵션과 독립해 표시한다", () => {
  const name = "제논 혼합 장신구";
  const common = {
    name,
    category: "얼굴장식",
    mainGrade: "legendary",
    additionalGrade: "none",
    maximum: 6,
    remaining: 6,
    trade: "untradeable_after_equip",
    scissorsRemaining: 5,
  };
  const records = [
    ...Array.from({ length: 12 }, (_, index) => sold({
      ...common,
      mainGrade: "none",
    }, 1_450_000_000 + index * 10_000_000,
    new Date(Date.UTC(2026, 7, 31, 10, index)).toISOString())),
    ...Array.from({ length: 2 }, (_, index) => sold({
      ...common,
      mainLines: [
        { code: "ALL_STAT", value: 9, unit: "pct" },
        { code: "ALL_STAT", value: 9, unit: "pct" },
        { code: "LUK", value: 9, unit: "pct" },
      ],
    }, 4_800_000_000 + index * 300_000_000,
    new Date(Date.UTC(2026, 8, 1, 10, index)).toISOString())),
    ...Array.from({ length: 4 }, (_, index) => sold({
      ...common,
      mainLines: [
        { code: "ALL_STAT", value: 9, unit: "pct" },
        { code: "STR", value: 12, unit: "pct" },
        { code: "STR", value: 9, unit: "pct" },
      ],
    }, 7_000_000_000 + index * 200_000_000,
    new Date(Date.UTC(2026, 8, 1, 12, index)).toISOString())),
  ];
  const target = item({
    ...common,
    basePriceMeso: 1_200_000_000,
    mainLines: [
      { code: "ALL_STAT", value: 9, unit: "pct" },
      { code: "ALL_STAT", value: 9, unit: "pct" },
      { code: "LUK", value: 9, unit: "pct" },
    ],
  });
  const model = fitItemMarketModel({ itemName: name, category: "얼굴장식", comparables: records });
  const features = extractCanonicalMarketTrainingFeatures(target);
  const result = estimateItemMarketValue({ target, fittedModel: model });
  const strTarget = structuredClone(target);
  strTarget.potential.lines = [
    { code: "ALL_STAT", value: 9, unit: "pct" },
    { code: "STR", value: 12, unit: "pct" },
    { code: "STR", value: 9, unit: "pct" },
  ];
  const strResult = estimateItemMarketValue({ target: strTarget, fittedModel: model });
  const gradeOnlyTarget = structuredClone(target);
  gradeOnlyTarget.potential.lines = [];
  const gradeOnlyResult = estimateItemMarketValue({ target: gradeOnlyTarget, fittedModel: model });

  assert.equal(features.training_profile_by_component.potential_options, "XENON");
  assert.deepEqual(features.option_stat_codes.potential, {
    "ALL_STAT:pct": 1,
    "LUK:pct": 1,
  });
  assert.ok([
    "sparse_exact_family",
    "component_before_first_supported_knot",
  ].includes(result.diagnostics.local_partial_pooling.tier));
  assert.ok(result.estimate_meso >= 4_200_000_000, JSON.stringify(result.diagnostics));
  assert.ok(result.estimate_meso <= 6_000_000_000, JSON.stringify(result.diagnostics));
  assert.ok(Math.abs(
    result.components.potential_grade.contribution_meso -
      result.diagnostics.grade_option_attribution.potential_grade.attributed_grade_meso
  ) <= 2);
  assert.equal(
    result.components.potential_grade.contribution_meso,
    strResult.components.potential_grade.contribution_meso,
    "같은 등급·장비 상태에서는 옵션 종류가 달라도 등업값이 바뀌면 안 됩니다.",
  );
  assert.ok(
    Math.abs(
      result.components.potential_grade.contribution_meso -
        gradeOnlyResult.components.potential_grade.contribution_meso
    ) <= 2,
    "옵션을 모두 비운 경우에도 같은 등급의 등업값은 바뀌면 안 됩니다.",
  );
  assert.equal(
    result.diagnostics.grade_option_attribution.potential_grade.method,
    "grade_from_no_options_shapley_then_option_residual",
  );
  assert.equal(
    Object.values(result.components).reduce((sum, row) => sum + row.contribution_meso, 0),
    result.estimate_meso,
  );
});

test("레전드리 잡옵 거래가 비어 있으면 최저 옵션군과 하위 등급으로 등업값을 복원한다", () => {
  const name = "검열 등급 방어구";
  const common = {
    name,
    category: "망토",
    requiredJob: "궁수",
    maximum: 8,
    remaining: 8,
    trade: "untradeable_after_equip",
    scissorsRemaining: 10,
    additionalGrade: "none",
  };
  const records = [
    ...Array.from({ length: 12 }, (_, index) => sold({
      ...common,
      mainGrade: "none",
    }, 100_000_000 + index * 1_000_000,
    new Date(Date.UTC(2026, 7, 30, 10, index)).toISOString())),
    sold({ ...common, mainGrade: "unique" }, 480_000_000, "2026-09-01T10:00:00.000Z"),
    sold({ ...common, mainGrade: "unique" }, 490_000_000, "2026-09-01T10:01:00.000Z"),
    sold({
      ...common,
      mainGrade: "unique",
      mainLines: [{ code: "DEX", value: 9, unit: "pct" }],
    }, 500_000_000, "2026-09-01T10:02:00.000Z"),
    sold({
      ...common,
      mainGrade: "unique",
      mainLines: [{ code: "DEX", value: 12, unit: "pct" }],
    }, 520_000_000, "2026-09-01T10:03:00.000Z"),
    sold({
      ...common,
      mainGrade: "legendary",
      mainLines: [{ code: "DEX", value: 9, unit: "pct" }],
    }, 2_050_000_000, "2026-09-01T10:04:00.000Z"),
    sold({
      ...common,
      mainGrade: "legendary",
      mainLines: [{ code: "DEX", value: 12, unit: "pct" }],
    }, 2_000_000_000, "2026-09-01T10:05:00.000Z"),
    ...Array.from({ length: 4 }, (_, index) => sold({
      ...common,
      mainGrade: "legendary",
      mainLines: [{ code: "DEX", value: 21, unit: "pct" }],
    }, 3_000_000_000 + index * 40_000_000,
    new Date(Date.UTC(2026, 8, 1, 11, index)).toISOString())),
  ];
  const model = fitItemMarketModel({ itemName: name, category: "망토", comparables: records });
  const target = (grade, lines = []) => item({
    ...common,
    basePriceMeso: 100_000_000,
    mainGrade: grade,
    mainLines: lines,
  });
  const grades = ["none", "rare", "epic", "unique", "legendary"]
    .map((grade) => estimateItemMarketValue({ target: target(grade), fittedModel: model }));
  const legendaryBlank = grades.at(-1);
  const legendary21 = estimateItemMarketValue({
    target: target("legendary", [{ code: "DEX", value: 21, unit: "pct" }]),
    fittedModel: model,
  });

  assert.ok(
    legendaryBlank.estimate_meso >= 1_700_000_000 &&
      legendaryBlank.estimate_meso <= 2_100_000_000,
    JSON.stringify(legendaryBlank.diagnostics),
  );
  assert.equal(
    legendaryBlank.diagnostics.local_partial_pooling.tier,
    "censored_grade_frontier",
  );
  assert.equal(
    legendaryBlank.diagnostics.local_partial_pooling.censored_grade_anchor.target_grade_rank,
    4,
  );
  assert.ok(
    grades[3].estimate_meso >= 440_000_000 && grades[3].estimate_meso <= 530_000_000,
    "직접 관측한 유니크 잡옵 두 건이 generic 로컬 pool에서 유실되면 안 됩니다.",
  );
  assert.equal(
    grades[3].diagnostics.local_partial_pooling.grade_only_anchor.evidence_kind,
    "direct",
  );
  for (let index = 1; index < grades.length; index += 1) {
    assert.ok(
      grades[index].estimate_meso >= grades[index - 1].estimate_meso,
      `${index - 1}→${index} 등급 가격이 역전됐습니다.`,
    );
  }
  assert.ok(legendary21.estimate_meso >= legendaryBlank.estimate_meso);
  assert.equal(
    legendary21.components.potential_grade.contribution_meso,
    legendaryBlank.components.potential_grade.contribution_meso,
  );
  assert.equal(
    Object.values(legendaryBlank.components)
      .reduce((sum, row) => sum + row.contribution_meso, 0),
    legendaryBlank.estimate_meso,
  );
});

test("레전드리 최저 옵션 거래가 한 건뿐이면 검열 등급 기준가를 만들지 않는다", () => {
  const name = "검열 표본 부족 방어구";
  const common = {
    name,
    category: "망토",
    requiredJob: "궁수",
    maximum: 8,
    remaining: 8,
    trade: "untradeable_after_equip",
    scissorsRemaining: 10,
    additionalGrade: "none",
  };
  const records = [
    ...Array.from({ length: 12 }, (_, index) => sold({
      ...common,
      mainGrade: "none",
    }, 100_000_000 + index * 1_000_000)),
    sold({ ...common, mainGrade: "unique" }, 480_000_000),
    sold({ ...common, mainGrade: "unique" }, 490_000_000),
    sold({
      ...common,
      mainGrade: "unique",
      mainLines: [{ code: "DEX", value: 9, unit: "pct" }],
    }, 500_000_000),
    sold({
      ...common,
      mainGrade: "unique",
      mainLines: [{ code: "DEX", value: 12, unit: "pct" }],
    }, 520_000_000),
    sold({
      ...common,
      mainGrade: "legendary",
      mainLines: [{ code: "DEX", value: 9, unit: "pct" }],
    }, 2_000_000_000),
  ];
  const result = estimateItemMarketValue({
    target: item({
      ...common,
      basePriceMeso: 100_000_000,
      mainGrade: "legendary",
    }),
    comparables: records,
  });

  assert.equal(result.diagnostics.local_partial_pooling.censored_grade_anchor, null);
});

test("0성에 직접 거래가 없어도 동일 유효 스탯의 교차 스타포스 잠재 패키지 하한을 보존한다", () => {
  const name = "교차 스타포스 전사 망토";
  const common = {
    name,
    category: "망토",
    requiredJob: "전사",
    maximum: 8,
    remaining: 8,
    trade: "untradeable_after_equip",
    scissorsRemaining: 10,
    additionalGrade: "none",
  };
  const records = [
    ...Array.from({ length: 24 }, (_, index) => sold({
      ...common,
      starforce: index % 2 ? 0 : 17,
      mainGrade: "none",
    }, (20_000_000 + index * 500_000) * (index % 2 ? 1 : 12),
    new Date(Date.UTC(2026, 7, 28, 10 + Math.floor(index / 12), index % 12)).toISOString())),
    ...Array.from({ length: 8 }, (_, index) => sold({
      ...common,
      starforce: index % 2 ? 18 : 22,
      mainGrade: "legendary",
      mainLines: [{ code: "STR", value: 21, unit: "pct" }],
      scroll: { str_flat: 56 + (index % 2) * 24 },
      flame: { str_flat: 60 + index * 3, all_stat_pct: 5 },
      applied: 8,
      remaining: 0,
    }, 2_000_000_000 + index * 120_000_000,
    new Date(Date.UTC(2026, 8, 1, 10, index)).toISOString())),
    ...[4_700_000_000, 13_000_000_000, 15_000_000_000, 19_000_000_000]
      .map((price, index) => sold({
        ...common,
        starforce: index === 0 ? 18 : 22,
        mainGrade: "legendary",
        mainLines: [{ code: "STR", value: 30, unit: "pct" }],
        additionalGrade: ["epic", "epic", "unique", "legendary"][index],
        additionalLines: index > 1
          ? [{ code: "STR", value: index === 2 ? 6 : 8, unit: "pct" }]
          : [],
        scroll: { str_flat: index === 0 ? 56 : 80 },
        flame: { str_flat: 70 + index * 5, all_stat_pct: 5 },
        applied: 8,
        remaining: 0,
      }, price, new Date(Date.UTC(2026, 8, 2, 10, index)).toISOString())),
    // 전사 망토의 INT는 비싸게 거래됐더라도 STR 패키지의 근거가 아니다.
    ...Array.from({ length: 4 }, (_, index) => sold({
      ...common,
      starforce: 22,
      mainGrade: "legendary",
      mainLines: [{ code: "INT", value: 30, unit: "pct" }],
      scroll: { str_flat: 80 },
      flame: { str_flat: 80, all_stat_pct: 6 },
      applied: 8,
      remaining: 0,
    }, 80_000_000_000 + index * 5_000_000_000,
    new Date(Date.UTC(2026, 8, 2, 11, index)).toISOString())),
  ];
  const makeTarget = (code, percent, starforce = 0) => item({
    ...common,
    starforce,
    mainGrade: "legendary",
    mainLines: [{ code, value: percent, unit: "pct" }],
  });
  const model = fitItemMarketModel({ itemName: name, category: "망토", comparables: records });
  const str21 = estimateItemMarketValue({ target: makeTarget("STR", 21), fittedModel: model });
  const str30 = estimateItemMarketValue({ target: makeTarget("STR", 30), fittedModel: model });
  const str30RareTarget = makeTarget("STR", 30);
  str30RareTarget.additional_potential = potential("rare");
  const str30Rare = estimateItemMarketValue({
    target: str30RareTarget,
    fittedModel: model,
  });
  const str30At21Stars = estimateItemMarketValue({
    target: makeTarget("STR", 30, 21),
    fittedModel: model,
  });
  const invalidInt30 = estimateItemMarketValue({
    target: makeTarget("INT", 30),
    fittedModel: model,
  });

  assert.ok(str30.estimate_meso >= 200_000_000, JSON.stringify(str30.diagnostics));
  assert.ok(str30.estimate_meso >= str21.estimate_meso, "옵션 수치가 커질 때 하한이 내려갔습니다.");
  assert.ok(
    str30Rare.estimate_meso >= str30.estimate_meso,
    "교차 스타포스 옵션 하한이 있는 장비도 에디 레어 선택으로 총액이 내려가면 안 됩니다.",
  );
  assert.ok(
    str30At21Stars.estimate_meso >= str30.estimate_meso * 1.5,
    "고스타포스 완제품 가격을 0성 잠재값으로 옮겨 0성과 21성 총액이 붙었습니다.",
  );
  assert.equal(str30.confidence.level, "low");
  assert.equal(str30.diagnostics.local_partial_pooling.target_condition_support_absent, true);
  assert.equal(
    str30.diagnostics.local_partial_pooling.option_package_floor.component,
    "potential_options",
  );
  assert.equal(
    str30.diagnostics.local_partial_pooling.option_package_floor.target_family,
    "STR",
  );
  assert.ok(str30.diagnostics.local_partial_pooling.option_package_floor.evidence_count >= 3);
  assert.equal(
    invalidInt30.diagnostics.local_partial_pooling.option_package_floor,
    null,
    "직업에 무효인 INT 거래가 STR 잠재 패키지 하한에 섞이면 안 됩니다.",
  );
  assert.ok(invalidInt30.estimate_meso < str30.estimate_meso / 2);
  assert.equal(
    Object.values(str30.components).reduce((sum, row) => sum + row.contribution_meso, 0),
    str30.estimate_meso,
  );
});

test("에디셔널 등급만 선택한 상태에도 같은 검열 기준가 안전장치를 적용한다", () => {
  const name = "검열 에디셔널 방어구";
  const common = {
    name,
    category: "망토",
    requiredJob: "궁수",
    maximum: 8,
    remaining: 8,
    trade: "untradeable_after_equip",
    scissorsRemaining: 10,
    mainGrade: "none",
  };
  const records = [
    ...Array.from({ length: 12 }, (_, index) => sold({
      ...common,
      additionalGrade: "none",
    }, 100_000_000 + index * 1_000_000)),
    sold({ ...common, additionalGrade: "unique" }, 300_000_000),
    sold({ ...common, additionalGrade: "unique" }, 310_000_000),
    sold({
      ...common,
      additionalGrade: "unique",
      additionalLines: [{ code: "DEX", value: 6, unit: "pct" }],
    }, 320_000_000),
    sold({
      ...common,
      additionalGrade: "unique",
      additionalLines: [{ code: "DEX", value: 8, unit: "pct" }],
    }, 330_000_000),
    sold({
      ...common,
      additionalGrade: "legendary",
      additionalLines: [{ code: "DEX", value: 6, unit: "pct" }],
    }, 1_500_000_000),
    sold({
      ...common,
      additionalGrade: "legendary",
      additionalLines: [{ code: "DEX", value: 8, unit: "pct" }],
    }, 1_550_000_000),
  ];
  const result = estimateItemMarketValue({
    target: item({
      ...common,
      basePriceMeso: 100_000_000,
      additionalGrade: "legendary",
    }),
    comparables: records,
  });

  assert.ok(result.estimate_meso >= 1_250_000_000 && result.estimate_meso <= 1_600_000_000);
  assert.equal(
    result.diagnostics.local_partial_pooling.censored_grade_anchor.component,
    "additional_grade",
  );
  assert.equal(
    Object.values(result.components).reduce((sum, row) => sum + row.contribution_meso, 0),
    result.estimate_meso,
  );
});

test("1500건 모델은 한 번만 학습하고 이후 입력 변경은 학습 없이 예측한다", (t) => {
  const records = Array.from({ length: 1_500 }, (_, index) => {
    const starforce = [0, 12, 17, 18, 21, 22, 23][index % 7];
    const mainPercent = [0, 9, 18, 21, 27, 30, 33][Math.floor(index / 7) % 7];
    const additionalPercent = [0, 4, 6, 8, 11][Math.floor(index / 11) % 5];
    const scrollStat = [0, 20, 40, 60][Math.floor(index / 13) % 4];
    const flameStat = [0, 40, 80, 120, 160][Math.floor(index / 17) % 5];
    const price = 500_000_000 * Math.exp(
      starforce * 0.03 + mainPercent * 0.015 + additionalPercent * 0.02 +
      scrollStat * 0.002 + flameStat * 0.0015,
    );
    return sold({
      starforce,
      mainGrade: mainPercent ? "legendary" : "none",
      mainLines: mainPercent ? [{ code: "STR", value: mainPercent, unit: "pct" }] : [],
      additionalGrade: additionalPercent ? "epic" : "none",
      additionalLines: additionalPercent ? [{ code: "STR", value: additionalPercent, unit: "pct" }] : [],
      scroll: { str_flat: scrollStat },
      flame: { str_flat: flameStat },
      applied: scrollStat ? 3 : 0,
    }, price, `2026-08-${String(1 + index % 28).padStart(2, "0")}T00:00:00.000Z`);
  });
  const beforeFit = performance.now();
  const model = fitItemMarketModel({
    itemName: "거대한 공포",
    category: "반지",
    comparables: records,
    profile: CHARACTER_PROFILE,
    maxRecords: 1_500,
  });
  const fitMilliseconds = performance.now() - beforeFit;
  const beforePrediction = performance.now();
  const result = estimateItemMarketValue({
    target: item({
      starforce: 22,
      mainGrade: "legendary",
      mainLines: [{ code: "STR", value: 30, unit: "pct" }],
    }),
    fittedModel: model,
  });
  const predictionMilliseconds = performance.now() - beforePrediction;

  t.diagnostic(`1500건 fit ${fitMilliseconds.toFixed(1)}ms · 재사용 예측 ${predictionMilliseconds.toFixed(1)}ms`);
  assert.equal(model.records.length, 1_500);
  assert.equal(result.diagnostics.fitted_model_reused, true);
  assert.ok(fitMilliseconds < 2_000, `1500건 fit이 너무 느립니다: ${fitMilliseconds}ms`);
  assert.ok(predictionMilliseconds < 150, `재사용 예측이 너무 느립니다: ${predictionMilliseconds}ms`);
});
