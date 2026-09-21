import assert from "node:assert/strict";
import test from "node:test";

import {
  ABILITY_REFORM_EFFECTIVE_DATE,
  ABILITY_REFORM_METHODS,
  ABILITY_REFORM_SOURCES,
  AbilityProbabilityUnavailableError,
  AbilityReformEligibilityError,
  AbilityStateIncompleteError,
  calculateAbilityReformExpected,
  conditionAbilityProbabilityExcludingCurrent,
  getChangeCirculatorClaimEligibility,
  getChangeCirculatorConversionOptions,
  getChangeCirculatorUseEligibility,
  getAbilityReformCost,
  hasLegendaryLowerLine,
  normalizeAbilityState,
  validateAbilityStateCompleteness,
  validateAbilityReformEligibility,
} from "../src/ability-reform.js";
import {
  ABILITY_REFORM_2026_09_17,
  REFORM_2026_09_17_SOURCES,
} from "../src/reform-2026-09-17.js";

function legendaryState(lines = []) {
  return {
    overallGrade: "legendary",
    lines: Array.from({ length: 3 }, (_, index) => lines[index] ?? {
      type: ["boss-damage", "buff-duration", "cooldown-skip"][index],
      grade: index === 0 ? "legendary" : "unique",
      value: [20, 38, 10][index],
    }),
  };
}

test("현재 어빌리티를 등급 별칭과 숫자를 포함한 정확히 세 줄 상태로 정규화한다", () => {
  const state = normalizeAbilityState({
    grade: "레전드리",
    lines: [
      { type: " boss-damage ", grade: "유니크", value: "20", locked: 1 },
      { type: "buff-duration", grade: "유니크", value: "38" },
      null,
      { type: "ignored", grade: "레전드리", value: 1 },
    ],
  });

  assert.equal(state.overallGrade, "legendary");
  assert.equal(state.lines.length, 3);
  assert.deepEqual(state.lines[0], {
    type: "boss-damage",
    grade: "legendary",
    value: 20,
    locked: true,
  });
  assert.deepEqual(state.lines[1], {
    type: "buff-duration",
    grade: "unique",
    value: 38,
    locked: false,
  });
  assert.deepEqual(state.lines[2], {
    type: null,
    grade: null,
    value: null,
    locked: false,
  });
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.lines));

  const korean = normalizeAbilityState({
    grade: "레전드리",
    lines: [
      { type: "보스 몬스터 공격 시 데미지 증가", value: 20 },
      { type: "버프 스킬 지속 시간 증가", grade: "유니크", value: 38 },
      { type: "알 수 없는 옵션", grade: "유니크", value: 10 },
    ],
  });
  assert.equal(korean.lines[0].type, "boss-damage");
  assert.equal(korean.lines[1].type, "buff-duration");
  assert.equal(korean.lines[2].type, null);
});

test("공식 값과 URL은 개편 매니페스트를 단일 정본으로 사용한다", () => {
  assert.equal(
    ABILITY_REFORM_EFFECTIVE_DATE,
    ABILITY_REFORM_2026_09_17.effectiveDate,
  );
  assert.equal(
    ABILITY_REFORM_SOURCES.reformNotice,
    REFORM_2026_09_17_SOURCES.testworldUpdate.url,
  );
  assert.equal(
    ABILITY_REFORM_METHODS.advanced.label,
    ABILITY_REFORM_2026_09_17.methods.advanced.label,
  );
  assert.equal(
    ABILITY_REFORM_METHODS.abyss.label,
    ABILITY_REFORM_2026_09_17.methods.abyssCirculator.label,
  );
});

test("동일 결과 조건부 확률에 필요한 현재 세 줄의 완전성을 검증한다", () => {
  const incomplete = validateAbilityStateCompleteness({
    overallGrade: "legendary",
    lines: [
      { type: "boss-damage", value: 20 },
      { type: "buff-duration", grade: "unique", value: 0 },
    ],
  });
  assert.equal(incomplete.complete, false);
  assert.deepEqual(incomplete.missingFields, [
    "lines.2.type",
    "lines.2.grade",
    "lines.2.value",
  ]);
  assert.equal(Object.isFrozen(incomplete.missingFields), true);

  const complete = validateAbilityStateCompleteness(legendaryState());
  assert.equal(complete.complete, true);
  assert.deepEqual(complete.missingFields, []);
});

test("현재와 완전히 동일한 결과를 목표 교집합까지 제외해 조건부 확률로 바꾼다", () => {
  assert.equal(conditionAbilityProbabilityExcludingCurrent({
    targetProbability: 0.1,
    identicalResultProbability: 0.02,
    targetAndIdenticalProbability: 0,
  }), 0.1 / 0.98);
  assert.equal(conditionAbilityProbabilityExcludingCurrent({
    targetProbability: 0.1,
    identicalResultProbability: 0.02,
    targetAndIdenticalProbability: 0.02,
  }), 0.08 / 0.98);
  assert.throws(
    () => conditionAbilityProbabilityExcludingCurrent({
      targetProbability: 0.1,
      identicalResultProbability: 0.02,
    }),
    /교집합 확률/u,
  );
});

test("고급 재설정 비용을 잠금별 명성치·메소 벡터로 분리한다", () => {
  assert.deepEqual(getAbilityReformCost("advanced", { lockCount: 0 }), {
    honor: 20_000,
    meso: 2_000_000,
    cash: 0,
    credit: 0,
    items: {},
  });
  assert.deepEqual(getAbilityReformCost("고급", { lockCount: 1 }), {
    honor: 30_000,
    meso: 6_000_000,
    cash: 0,
    credit: 0,
    items: {},
  });
  assert.deepEqual(getAbilityReformCost("advanced", { lockCount: 2 }), {
    honor: 40_000,
    meso: 15_000_000,
    cash: 0,
    credit: 0,
    items: {},
  });
  assert.throws(
    () => getAbilityReformCost("advanced", { lockCount: 3 }),
    /0, 1, 2/u,
  );
  for (const lockCount of [0, 1, 2]) {
    const full = getAbilityReformCost("advanced", { lockCount });
    assert.deepEqual(getAbilityReformCost("advanced", { lockCount, halfHonor: true }), {
      ...full, honor: full.honor / 2,
    });
  }
});

test("심연의 서큘레이터 캐시·크레딧·보유분 조달을 섞지 않는다", () => {
  const cash = getAbilityReformCost("심연", { payment: "cash" });
  const credit = getAbilityReformCost("abyss", { payment: "credit" });
  const owned = getAbilityReformCost("abyss", { payment: "owned" });

  assert.equal(cash.cash, 4_900);
  assert.equal(cash.credit, 0);
  assert.equal(credit.cash, 0);
  assert.equal(credit.credit, 4_900);
  assert.deepEqual(owned.items, { abyssCirculator: 1 });
});

test("체인지 서큘레이터는 0비용이 아니라 보유 아이템 1개를 소비한다", () => {
  assert.deepEqual(getAbilityReformCost("change"), {
    honor: 0,
    meso: 0,
    cash: 0,
    credit: 0,
    items: { changeCirculator: 1 },
  });
});

test("고급과 심연은 레전드리 어빌리티에서만 사용할 수 있다", () => {
  const unique = legendaryState();
  unique.overallGrade = "unique";

  assert.equal(validateAbilityReformEligibility({
    method: "advanced",
    state: unique,
  }).eligible, false);
  assert.equal(validateAbilityReformEligibility({
    method: "abyss",
    state: unique,
  }).eligible, false);
  assert.equal(validateAbilityReformEligibility({
    method: "advanced",
    state: legendaryState(),
  }).eligible, true);
  assert.equal(validateAbilityReformEligibility({
    method: "abyss",
    state: legendaryState(),
  }).eligible, true);
});

test("수치 재설정이 불가능한 옵션만 있으면 심연을 사용할 수 없다", () => {
  const state = legendaryState([
    { type: "attack-speed", grade: "legendary", value: 1 },
    { type: "passive-level", grade: "legendary", value: 1 },
    { type: "multi-target", grade: "legendary", value: 1 },
  ]);
  const validation = validateAbilityReformEligibility({ method: "abyss", state });

  assert.equal(validation.eligible, false);
  assert.ok(validation.errors.some((error) => error.code === "NO_REROLLABLE_VALUE"));

  const unknownLine = legendaryState();
  unknownLine.lines[2].type = "알 수 없는 옵션";
  const incomplete = validateAbilityReformEligibility({
    method: "abyss",
    state: unknownLine,
  });
  assert.equal(incomplete.eligible, false);
  assert.ok(
    incomplete.errors.some((error) => error.code === "CURRENT_OPTIONS_REQUIRED"),
  );
});

test("레전드리 아랫줄은 일반 잠금과 블랙·카오스를 제한하지만 고급·심연은 막지 않는다", () => {
  const state = legendaryState([
    { type: "boss-damage", grade: "legendary", value: 20 },
    { type: "buff-duration", grade: "legendary", value: 50 },
    { type: "cooldown-skip", grade: "unique", value: 10 },
  ]);
  assert.equal(hasLegendaryLowerLine(state), true);

  for (const method of ["black", "chaos"]) {
    const validation = validateAbilityReformEligibility({ method, state });
    assert.equal(validation.eligible, false);
    assert.ok(validation.errors.some(
      (error) => error.code === "LOWER_LEGENDARY_METHOD_FORBIDDEN",
    ));
  }

  const lockedLower = structuredClone(state);
  lockedLower.lines[1].locked = true;
  const honor = validateAbilityReformEligibility({ method: "honor", state: lockedLower });
  assert.equal(honor.eligible, false);
  assert.ok(honor.errors.some(
    (error) => error.code === "LOWER_LEGENDARY_LOCK_FORBIDDEN" && error.line === 1,
  ));

  assert.equal(validateAbilityReformEligibility({
    method: "honor",
    state,
  }).eligible, true);
  assert.equal(validateAbilityReformEligibility({
    method: "advanced",
    state,
  }).eligible, true);
  assert.equal(validateAbilityReformEligibility({
    method: "abyss",
    state,
  }).eligible, true);
});

test("고급과 심연은 공식 확률표가 들어오기 전 기댓값 실행을 명시적으로 차단한다", () => {
  assert.equal(ABILITY_REFORM_METHODS.abyss.probabilitySource, null);
  assert.equal(
    ABILITY_REFORM_METHODS.abyss.probabilityPublicationTarget,
    ABILITY_REFORM_SOURCES.honorProbability,
  );
  assert.equal(
    ABILITY_REFORM_METHODS.advanced.missingProbabilityFields.some(
      (field) => field.includes("mvpGoldBatch"),
    ),
    false,
  );
  for (const method of ["advanced", "abyss"]) {
    assert.equal(ABILITY_REFORM_METHODS[method].probabilityStatus, "pending-official-table");
    assert.throws(
      () => calculateAbilityReformExpected({
        method,
        state: legendaryState(),
        forProduction: false,
      }),
      (error) => {
        assert.ok(error instanceof AbilityProbabilityUnavailableError);
        assert.equal(error.code, "OFFICIAL_ABILITY_PROBABILITY_PENDING");
        assert.equal(error.method, method);
        assert.ok(error.missingFields.length > 0);
        return true;
      },
    );
  }
});

test("고급·심연 기댓값은 공식표 입력 전에도 불완전한 현재 세 줄을 먼저 거절한다", () => {
  for (const method of ["advanced", "abyss"]) {
    const state = legendaryState();
    state.lines[2].value = null;
    assert.throws(
      () => calculateAbilityReformExpected({
        method,
        state,
        forProduction: false,
      }),
      (error) => {
        assert.ok(error instanceof AbilityStateIncompleteError);
        assert.equal(error.code, "ABILITY_STATE_INCOMPLETE");
        assert.deepEqual(error.missingFields, ["lines.2.value"]);
        return true;
      },
    );
  }
});

test("체인지 서큘레이터의 지급 조건과 확정 변환표를 분리해 판정한다", () => {
  const claim = getChangeCirculatorClaimEligibility({
    job: "미하일",
    createdAt: "2026-09-16T23:59:59+09:00",
    now: "2026-09-17T12:00:00+09:00",
    maintenanceCompleted: true,
  });
  assert.equal(claim.eligible, true);

  const state = legendaryState([
    { type: "cooldown-skip", grade: "legendary", value: 18 },
    { type: "boss-damage", grade: "unique", value: 9 },
    { type: "buff-duration", grade: "unique", value: 38 },
  ]);
  const conversions = getChangeCirculatorConversionOptions(state);
  assert.deepEqual(conversions[0].choices, [
    { type: "boss-damage", value: 18, grade: "legendary" },
  ]);
  assert.deepEqual(conversions[1].choices, [
    { type: "abnormal-damage", value: 8, grade: "unique" },
    { type: "buff-duration", value: 37, grade: "unique" },
    { type: "attack", value: 21, grade: "unique" },
  ]);

  assert.equal(getChangeCirculatorUseEligibility({
    state,
    itemCount: 1,
    now: "2026-10-21T23:59:59+09:00",
    maintenanceCompleted: true,
  }).eligible, true);
  assert.equal(getChangeCirculatorUseEligibility({
    state,
    itemCount: 0,
    now: "2026-10-22T02:00:00+09:00",
    maintenanceCompleted: true,
  }).eligible, false);
  assert.equal(getChangeCirculatorClaimEligibility({
    job: "미하일",
    createdAt: "2026-09-16T23:59:59+09:00",
    now: "2026-10-21T23:59:59+09:00",
    maintenanceCompleted: true,
  }).eligible, true);
  assert.equal(getChangeCirculatorClaimEligibility({
    job: "미하일",
    createdAt: "2026-09-16T23:59:59+09:00",
    now: "2026-10-22T00:00:00+09:00",
    maintenanceCompleted: true,
  }).eligible, false);
  assert.equal(getChangeCirculatorUseEligibility({
    state,
    itemCount: 1,
    now: "2026-09-17T01:00:00+09:00",
    maintenanceCompleted: false,
  }).eligible, false);
});

test("적용 불가능한 상태는 확률 미공개 오류보다 먼저 구체적으로 거절한다", () => {
  assert.throws(
    () => calculateAbilityReformExpected({
      method: "advanced",
      state: { overallGrade: "unique", lines: [] },
    }),
    (error) => {
      assert.ok(error instanceof AbilityReformEligibilityError);
      assert.equal(error.code, "ABILITY_REFORM_INELIGIBLE");
      assert.ok(error.validation.errors.some((entry) => entry.code === "GRADE_TOO_LOW"));
      return true;
    },
  );
});
