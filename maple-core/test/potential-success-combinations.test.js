import assert from "node:assert/strict";
import test from "node:test";
import {
  calculatePotentialExpected,
  encodeExactPotentialTargetType,
  getPotentialSuccessCombinations,
} from "../src/potential.js";

const option = (name, probability = 1) => ({ name, probability });
const condition = (targetType, target) => ({ targetType, target });
const key = ({ options }) => options.map(({ name }) => name).toSorted().join("|");

test("공격력 30% 목표는 30·33·36% 조합을 모두 포함하고 정렬한다", () => {
  const tables = [
    [option("공격력 +12%")],
    [option("공격력 +12%"), option("공격력 +9%")],
    [option("공격력 +12%"), option("공격력 +9%")],
  ];
  const targets = [condition("attack-power-percent", 30)];
  const result = getPotentialSuccessCombinations({ tables, targets });
  assert.deepEqual(result.combinations.map(({ scores }) => scores), [[30], [33], [36]]);
  assert.equal(new Set(result.combinations.map(key)).size, 3);
  const desc = getPotentialSuccessCombinations({ tables, targets, sortDirection: "desc", limit: 2 });
  assert.deepEqual(desc.combinations.map(({ scores }) => scores), [[36], [33]]);
  assert.equal(desc.hiddenCount, 1);
  assert.equal(desc.truncated, true);
});

test("프라임 두 줄은 첫 줄 전용 옵션과 세 줄 조합을 포함하지 않는다", () => {
  const tables = [
    [option("공격력 +15%")],
    [option("공격력 +12%"), option("공격력 +9%")],
    [option("공격력 +12%"), option("공격력 +9%")],
  ];
  const result = getPotentialSuccessCombinations({ tables: tables.slice(1), targets: [condition("attack-power-percent", 18)] });
  assert.deepEqual(result.combinations.map(({ scores }) => scores), [[18], [21], [24]]);
  assert.ok(result.combinations.every(({ options }) => options.length === 2));
  assert.ok(result.combinations.every((entry) => !key(entry).includes("15%")));
});

test("INT 30%는 올스탯 1%를 INT 1%로 더하고 개인 환산 계수는 적용하지 않는다", () => {
  const tables = [
    [option("INT +12%")],
    [option("INT +12%"), option("INT +9%")],
    [option("올스탯 +6%"), option("올스탯 +9%")],
  ];
  const result = getPotentialSuccessCombinations({
    tables, targets: [condition("int-percent", 30)],
    statEquivalence: { allStatPercentToMainPercent: 2 },
  });
  assert.ok(result.combinations.some((entry) => key(entry) === "INT +12%|INT +12%|올스탯 +6%"));
  assert.ok(!result.combinations.some((entry) => key(entry) === "INT +12%|INT +9%|올스탯 +6%"));
  assert.deepEqual(result.combinations.map(({ scores }) => scores[0]), [30, 30, 33]);
});

test("한 줄 성공 뒤의 상위 조합을 유지하고 확률 0인 옵션은 제외한다", () => {
  const result = getPotentialSuccessCombinations({
    tables: [
      [option("공격력 +12%"), option("공격력 +99%", 0)],
      [option("공격력 +9%")],
      [option("공격력 +9%")],
    ],
    targets: [condition("attack-power-percent", 12)],
  });
  assert.deepEqual(result.combinations.map(({ scores }) => scores[0]), [12, 18, 21, 30]);
  assert.deepEqual(result.combinations.map(({ options }) => options.length), [1, 2, 2, 3]);
});

test("같은 줄의 선택지는 함께 조합하지 않고 모든 목표를 동시에 만족시킨다", () => {
  const tables = [
    [option("공격력 +12%"), option("보스 몬스터 데미지 +40%")],
    [option("공격력 +9%"), option("보스 몬스터 데미지 +30%")],
    [option("STR +12%")],
  ];
  const success = getPotentialSuccessCombinations({ tables, targets: [condition("attack-power-percent", 9), condition("boss-damage", 30)] });
  assert.deepEqual(success.combinations.map(({ scores }) => scores), [[9, 40], [12, 30]]);
  const impossible = getPotentialSuccessCombinations({ tables, targets: [condition("attack-power-percent", 12), condition("boss-damage", 40)] });
  assert.equal(impossible.totalCount, 0);
});

test("방무는 합산하지 않고 중첩 공식으로 성공 조건과 상위 조합을 판정한다", () => {
  const tables = Array.from({ length: 3 }, () => [option("몬스터 방어율 무시 +40%"), option("몬스터 방어율 무시 +30%")]);
  const result = getPotentialSuccessCombinations({ tables, targets: [condition("ignore-defense", 64)] });
  assert.ok(result.combinations.some(({ options, scores }) => options.length === 2 && scores[0] === 64));
  assert.ok(result.combinations.some(({ scores }) => Math.abs(scores[0] - 78.4) < 1e-10));
  assert.ok(result.combinations.every(({ options }) => options.length === 3 || options.every(({ name }) => name.includes("40%"))));
});

test("올스탯과 개별 스탯의 겹치는 목표를 확률 계산과 같은 방식으로 판정한다", () => {
  const tables = [
    [option("INT +12%"), option("INT +7%")],
    [option("올스탯 +6%")],
    [option("올스탯 +6%"), option("INT +7%")],
  ];
  const targets = [condition("int-percent", 7), condition("all-stat-percent", 6)];
  const result = getPotentialSuccessCombinations({ tables, targets });
  assert.ok(result.combinations.some((entry) => key(entry) === "INT +7%|올스탯 +6%"));
  assert.ok(!result.combinations.some((entry) => key(entry) === "올스탯 +6%|올스탯 +6%"));
  // 각 표시 조합을 단일 결과 표로 만들어 기존 확률 계산의 성공 판정과 대조한다.
  for (const { options } of result.combinations) {
    const calculated = calculatePotentialExpected({
      tables: options.map(({ name }) => [option(name)]), targets,
      itemLevel: 200, grade: "legendary",
    });
    assert.equal(calculated.rawProbability, 1);
  }
});

test("쓸만한 스킬 중복 제한을 지키고 표·목표를 변경하지 않는다", () => {
  const name = "쓸만한 샤프 아이즈 스킬 사용 가능";
  const tables = Array.from({ length: 3 }, () => [option(name), option("STR +12%")]);
  const targets = [condition(encodeExactPotentialTargetType(name), 2)];
  const before = structuredClone({ tables, targets });
  assert.equal(getPotentialSuccessCombinations({ tables, targets }).totalCount, 0);
  assert.deepEqual({ tables, targets }, before);
});
