import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateAutomaticFlameExpectedCost,
  loadItemMarketFlameSettings,
} from "../src/shared/item-market-flame-cost.js";

function target(overrides = {}) {
  return {
    item: {
      name: "데이브레이크 펜던트",
      category: "펜던트",
      required_job: "공용",
      set_name: "여명의 보스 세트",
      base_level: 140,
      required_level_reduction: 0,
      stats: { flame: {}, scroll: {} },
      potential: { grade: "none", lines: [] },
      additional_potential: { grade: "none", lines: [] },
      upgrade: { applied: 0, remaining: 0, recoverable: 0 },
      ...overrides,
    },
  };
}

test("추가옵션이 없으면 적용 대상이 아니다", () => {
  const result = calculateAutomaticFlameExpectedCost({ target: target() });
  assert.equal(result.status, "not_applicable");
});

test("보스 장신구의 입력 추옵을 유효 급으로 바꿔 검환불 기댓값을 계산한다", () => {
  const result = calculateAutomaticFlameExpectedCost({
    target: target({
      required_job: "전사",
      stats: {
        flame: { str_flat: 60, dex_flat: 20, all_stat_pct: 4, attack_flat: 4 },
        scroll: {},
      },
    }),
    storage: null,
  });
  assert.equal(result.status, "calculated");
  assert.equal(result.source, "black");
  assert.ok(result.expected_cost_meso > 0);
  assert.ok(result.target_grade > 60);
  assert.match(result.basis, /검은\/영원한 환생의 불꽃/u);
  assert.match(result.evidence.join(" "), /여명의 보스 세트/u);
});

test("추옵 계산기에 저장된 환불 시세를 읽고 더 싼 계산 경로를 고른다", () => {
  const storage = {
    getItem(key) {
      assert.equal(key, "maplestarforce:add-option:v2");
      return JSON.stringify({ abyssPrice: 1, strongPrice: 2 });
    },
  };
  assert.deepEqual(loadItemMarketFlameSettings({ storage }), {
    abyssPrice: 1,
    strongPrice: 2,
  });
  const result = calculateAutomaticFlameExpectedCost({
    target: target({
      required_job: "마법사",
      stats: { flame: { int_flat: 20, magic_attack_flat: 1 }, scroll: {} },
    }),
    storage,
  });
  assert.equal(result.status, "calculated");
  assert.notEqual(result.source, "black");
});

test("착용 레벨 감소만 있는 추옵은 억지로 비용을 만들지 않는다", () => {
  const result = calculateAutomaticFlameExpectedCost({
    target: target({ required_level_reduction: 20 }),
  });
  assert.equal(result.status, "unavailable");
  assert.match(result.basis, /착용 레벨 감소/u);
});

test("기본 공마가 없는 무기는 추 등급을 단정하지 않는다", () => {
  const result = calculateAutomaticFlameExpectedCost({
    target: target({
      name: "테스트 무기",
      category: "무기",
      stats: { flame: { attack_flat: 100 }, scroll: {} },
    }),
  });
  assert.equal(result.status, "unavailable");
  assert.match(result.basis, /무기 1·2추/u);
});

