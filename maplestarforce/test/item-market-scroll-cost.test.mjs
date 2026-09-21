import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateAutomaticScrollExpectedCost,
  inferAutomaticScrollUpgradeState,
  loadItemMarketScrollSettings,
} from "../src/shared/item-market-scroll-cost.js";

function target({
  category = "상의",
  requiredJob = "전사",
  level = 150,
  maximum = 8,
  applied = maximum,
  remaining = maximum - applied,
  recoverable = 0,
  scroll = {},
} = {}) {
  return {
    item: {
      category,
      required_job: requiredJob,
      base_level: level,
      upgrade: { max: maximum, applied, remaining, recoverable },
      stats: { scroll },
    },
  };
}

test("주문서 계산기 저장 시세는 읽되 개인 보유 주문서는 제작비에서 제외한다", () => {
  const storage = {
    getItem(key) {
      assert.equal(key, "maplestarforce:scroll:v2");
      return JSON.stringify({
        tracePer1000: 321,
        halfPrice: true,
        chaos100Stock: 12,
        cleanStock: 7,
        innocentStock: 4,
        arkInnocentStock: 3,
      });
    },
  };
  const settings = loadItemMarketScrollSettings({ storage });
  assert.equal(settings.tracePer1000, 321);
  assert.equal(settings.halfPrice, true);
  assert.deepEqual(
    [settings.chaos100Stock, settings.cleanStock, settings.innocentStock, settings.arkInnocentStock],
    [0, 0, 0, 0],
  );
});

test("주문서 상승 수치가 없으면 제작 기댓값 대상이 아니다", () => {
  const result = calculateAutomaticScrollExpectedCost({ target: target({ scroll: {} }) });
  assert.equal(result.status, "not_applicable");
  assert.equal(result.method, "none");
  assert.equal(result.expected_cost_meso, null);
});

test("잔여·복구 입력 없이 방어구 주흔 수치에서 적용 작 수를 복원한다", () => {
  const inferred = inferAutomaticScrollUpgradeState({
    target: target({
      applied: 0,
      remaining: 8,
      scroll: {
        str_flat: 80,
        hp_flat: 1_360,
        attack_flat: 1,
      },
    }),
  });
  assert.equal(inferred.status, "inferred");
  assert.equal(inferred.applied, 8);
  assert.equal(inferred.remaining, 0);
  assert.equal(inferred.recoverable, 0);

  const result = calculateAutomaticScrollExpectedCost({
    target: target({
      applied: 0,
      remaining: 8,
      scroll: {
        str_flat: 80,
        hp_flat: 1_360,
        attack_flat: 1,
      },
    }),
  });
  assert.equal(result.status, "calculated");
  assert.equal(result.method_label, "주흔 15%");
  assert.equal(result.evidence.applied, 8);
  assert.equal(result.evidence.applied_source, "scroll-stats");
});

test("부분 주흔과 귀지·매지컬도 입력 수치에서 작 수를 복원한다", () => {
  const partialTrace = inferAutomaticScrollUpgradeState({
    target: target({
      applied: 0,
      remaining: 8,
      scroll: { str_flat: 70, hp_flat: 1_190 },
    }),
  });
  assert.deepEqual(
    [partialTrace.status, partialTrace.applied, partialTrace.remaining],
    ["inferred", 7, 1],
  );

  const earring = inferAutomaticScrollUpgradeState({
    target: target({
      category: "귀고리",
      requiredJob: "마법사",
      level: 140,
      maximum: 7,
      applied: 0,
      remaining: 7,
      scroll: { int_flat: 21, magic_attack_flat: 35 },
    }),
  });
  assert.deepEqual([earring.status, earring.applied], ["inferred", 7]);

  const magical = inferAutomaticScrollUpgradeState({
    target: target({
      category: "기계 심장",
      requiredJob: "공용",
      level: 200,
      maximum: 10,
      applied: 0,
      remaining: 10,
      scroll: {
        str_flat: 30,
        dex_flat: 30,
        int_flat: 30,
        luk_flat: 30,
        attack_flat: 110,
      },
    }),
  });
  assert.deepEqual([magical.status, magical.applied], ["inferred", 10]);
});

test("같은 주문서 수치로 여러 작 수가 가능하면 임의로 고르지 않는다", () => {
  const inferred = inferAutomaticScrollUpgradeState({
    target: target({
      category: "장갑",
      requiredJob: "궁수",
      maximum: 8,
      applied: 0,
      remaining: 8,
      scroll: { attack_flat: 8 },
    }),
  });
  assert.equal(inferred.status, "ambiguous");
  assert.equal(inferred.applied, null);
  assert.deepEqual(
    [...new Set(inferred.candidates.map((candidate) => candidate.applied))]
      .filter((value) => [2, 4, 8].includes(value)),
    [2, 4, 8],
  );
});

test("방어구 15% 주흔 완작 벡터와 비용을 자동 판별한다", () => {
  const result = calculateAutomaticScrollExpectedCost({
    target: target({
      scroll: {
        str_flat: 80,
        hp_flat: 1_360,
        defense_flat: 120,
        attack_flat: 1,
      },
    }),
  });
  assert.equal(result.status, "calculated");
  assert.equal(result.method, "spell_trace");
  assert.equal(result.method_label, "주흔 15%");
  assert.equal(result.confidence, "high");
  assert.equal(result.evidence.trace_rate, 15);
  assert.ok(result.expected_cost_meso > 0);
});

test("자동 제작비도 주문서 페이지에 저장된 브라우저 시세를 사용한다", () => {
  const pickedTarget = target({
    scroll: {
      str_flat: 80,
      hp_flat: 1_360,
      defense_flat: 120,
      attack_flat: 1,
    },
  });
  const baseline = calculateAutomaticScrollExpectedCost({ target: pickedTarget });
  const expensive = calculateAutomaticScrollExpectedCost({
    target: pickedTarget,
    storage: {
      getItem(key) {
        assert.equal(key, "maplestarforce:scroll:v2");
        return JSON.stringify({
          tracePer1000: 1_400,
          clean10Price: 1_400,
          clean5Price: 700,
          innocent50Price: 8_000,
        });
      },
    },
  });
  assert.equal(expensive.status, "calculated");
  assert.ok(expensive.expected_cost_meso > baseline.expected_cost_meso);
});

test("귀 장식 INT +3·마력 +5 벡터는 귀지 10%로 계산한다", () => {
  const result = calculateAutomaticScrollExpectedCost({
    target: target({
      category: "귀고리",
      requiredJob: "마법사",
      level: 140,
      maximum: 7,
      scroll: { int_flat: 21, magic_attack_flat: 35 },
    }),
  });
  assert.equal(result.status, "calculated");
  assert.equal(result.method, "earring_scroll");
  assert.equal(result.confidence, "high");
  assert.equal(result.evidence.success_rate, 0.24);
  assert.ok(result.expected_cost_meso > 0);
});

test("귀지 제작비는 손재주·길드 설정에 따라 달라지고 피버에는 변하지 않는다", () => {
  const item = target({
    category: "귀고리",
    requiredJob: "마법사",
    level: 140,
    maximum: 7,
    scroll: { int_flat: 21, magic_attack_flat: 35 },
  });
  const estimate = (settings) => calculateAutomaticScrollExpectedCost({
    target: item,
    settings,
  });
  const plain = estimate({ dexterityLevel: 0, guild: false, fever: false });
  const halfStep = estimate({ dexterityLevel: 5, guild: false, fever: false });
  const full = estimate({ dexterityLevel: 100, guild: true, fever: false });
  const fever = estimate({ dexterityLevel: 100, guild: true, fever: true });
  assert.equal(plain.evidence.success_rate, 0.1);
  assert.equal(halfStep.evidence.success_rate, 0.105);
  assert.equal(full.evidence.success_rate, 0.24);
  assert.ok(full.expected_cost_meso < halfStep.expected_cost_meso);
  assert.ok(halfStep.expected_cost_meso < plain.expected_cost_meso);
  assert.deepEqual(full, fever);
});

test("귀지 실패 보호는 성공률을 유지하고 소모된 슬롯의 복구 비용만 줄인다", () => {
  const item = target({
    category: "귀고리",
    requiredJob: "마법사",
    level: 140,
    maximum: 1,
    scroll: { int_flat: 3, magic_attack_flat: 5 },
  });
  for (const [dexterityLevel, guild, success] of [[0, false, 0.1], [100, true, 0.24]]) {
    const estimate = (guildProtection) => calculateAutomaticScrollExpectedCost({
      target: item,
      settings: {
        dexterityLevel,
        guild,
        guildProtection,
        earringPrice: 8_000,
        tracePer1000: 140,
        clean10Price: 1_000,
        clean5Price: 1_000,
        useInnocent: false,
        halfPrice: false,
      },
    });
    const withoutProtection = estimate(0);
    const protectedResult = estimate(4);
    assert.equal(protectedResult.evidence.success_rate, success);
    assert.equal(withoutProtection.evidence.success_rate, success);
    assert.equal(protectedResult.evidence.slot_protection_rate, 0.04);
    assert.equal(withoutProtection.evidence.slot_protection_rate, 0);
    // 성공 1회당 주문서 1/p장, 순백은 (1-p) * (1-보호율) / p회.
    const expectedCost = (80_000_000 + (1 - success) * 0.96 * 28_000_000) / success;
    assert.ok(Math.abs(protectedResult.expected_cost_meso - expectedCost) < 0.001);
    const savedRestorationCost = (1 - success) * 0.04 * 28_000_000 / success;
    assert.ok(Math.abs(
      withoutProtection.expected_cost_meso - protectedResult.expected_cost_meso - savedRestorationCost,
    ) < 0.001);
  }
});

test("놀긍 첫작 뒤의 명확한 주흔 벡터를 분리해 합산한다", () => {
  const result = calculateAutomaticScrollExpectedCost({
    target: target({
      // 첫 놀긍 공6/STR6 + 방어구 15% 7작 + 완작 공1
      scroll: {
        str_flat: 76,
        hp_flat: 1_190,
        defense_flat: 105,
        attack_flat: 7,
      },
    }),
  });
  assert.equal(result.status, "calculated");
  assert.equal(result.method, "chaos_first_trace");
  assert.equal(result.method_label, "놀긍 첫작 + 주흔 15%");
  assert.deepEqual(result.evidence.first_scroll_stats, {
    str_flat: 6,
    attack_flat: 6,
  });
  assert.ok(result.expected_cost_meso > 0);
});

test("1작 놀긍의 유효 공·마/주스탯 목표 비용을 계산한다", () => {
  const result = calculateAutomaticScrollExpectedCost({
    target: target({
      category: "펜던트",
      level: 140,
      maximum: 6,
      applied: 1,
      remaining: 5,
      scroll: { str_flat: 6, attack_flat: 6 },
    }),
  });
  assert.equal(result.status, "calculated");
  assert.equal(result.method, "chaos_first");
  assert.equal(result.confidence, "medium");
  assert.ok(result.expected_cost_meso > 0);
});

test("높은 누적 놀긍 벡터만 리턴작 추정 비용을 붙인다", () => {
  const result = calculateAutomaticScrollExpectedCost({
    target: target({
      category: "반지",
      level: 160,
      maximum: 3,
      scroll: { str_flat: 9, attack_flat: 18 },
    }),
  });
  assert.equal(result.status, "calculated");
  assert.equal(result.method, "chaos_return_inferred");
  assert.equal(result.confidence, "low");
  assert.ok(result.expected_cost_meso > 0);
});

test("일반 놀긍과 리턴을 구분할 수 없는 벡터는 임의 비용을 붙이지 않는다", () => {
  const result = calculateAutomaticScrollExpectedCost({
    target: target({
      category: "반지",
      level: 160,
      maximum: 3,
      scroll: { str_flat: 3, attack_flat: 6 },
    }),
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.method, "chaos_or_return");
  assert.equal(result.expected_cost_meso, null);
  assert.match(result.basis, /구분할 수 없음/u);
});

test("프리미엄 악세서리와 놀긍이 겹치는 순수 공·마 벡터는 시세 없이는 계산하지 않는다", () => {
  const result = calculateAutomaticScrollExpectedCost({
    target: target({
      category: "반지",
      level: 160,
      maximum: 3,
      scroll: { attack_flat: 12 },
    }),
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.method, "premium_accessory");
  assert.equal(result.expected_cost_meso, null);
  assert.match(result.basis, /장당 시세가 없음/u);
});

test("매지컬 일반 결과와 전 부위 +11 리턴작을 구분해 계산한다", () => {
  const common = {
    category: "기계 심장",
    requiredJob: "공용",
    level: 200,
    maximum: 10,
    scroll: { str_flat: 30, dex_flat: 30, int_flat: 30, luk_flat: 30 },
  };
  const ordinary = calculateAutomaticScrollExpectedCost({
    target: target({ ...common, scroll: { ...common.scroll, attack_flat: 95 } }),
  });
  const returned = calculateAutomaticScrollExpectedCost({
    target: target({ ...common, scroll: { ...common.scroll, attack_flat: 110 } }),
  });
  assert.equal(ordinary.method, "magical");
  assert.equal(ordinary.status, "calculated");
  assert.equal(ordinary.confidence, "high");
  assert.equal(returned.method, "magical_return");
  assert.equal(returned.status, "calculated");
  assert.equal(returned.confidence, "medium");
  assert.ok(returned.expected_cost_meso > ordinary.expected_cost_meso);
});

test("매지컬 1작 +11은 리턴 사용 여부가 보이지 않아 보수적으로 보류한다", () => {
  const result = calculateAutomaticScrollExpectedCost({
    target: target({
      category: "기계심장",
      requiredJob: "공용",
      level: 200,
      maximum: 10,
      applied: 1,
      remaining: 9,
      scroll: {
        str_flat: 3,
        dex_flat: 3,
        int_flat: 3,
        luk_flat: 3,
        magic_attack_flat: 11,
      },
    }),
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.method, "magical_or_return");
  assert.match(result.basis, /구분할 수 없음/u);
});

test("비정상 장비 메타가 들어와도 시세 계산 전체를 깨뜨리지 않는다", () => {
  const result = calculateAutomaticScrollExpectedCost({
    target: target({
      level: 150,
      maximum: 99,
      applied: 1,
      remaining: 98,
      scroll: { str_flat: 3 },
    }),
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.expected_cost_meso, null);
});
