import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSkillDictionary,
  CHARACTER_SKILL_GRADES,
  slimSkillDictionary,
} from "../scripts/lib/skill-dictionary.mjs";

function snapshot(characterClass, characterName, skills) {
  return {
    characterClass,
    characterName,
    skillData: Object.entries(skills).map(([grade, character_skill]) => ({
      character_class: characterClass,
      character_skill_grade: grade,
      character_skill,
    })),
  };
}

test("공식 전체 전직 차수에는 1.5차와 2.5차를 포함한다", () => {
  assert.deepEqual(CHARACTER_SKILL_GRADES, [
    "0", "1", "1.5", "2", "2.5", "3", "4",
    "hyperpassive", "hyperactive", "5", "6",
  ]);
});

test("여러 캐릭터의 스킬을 직업별 합집합으로 만들고 표본 커버리지를 보존한다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본1", {
      "1": [{
        skill_name: "공통 공격",
        skill_level: 10,
        skill_description: "적을 공격한다.",
        skill_effect: "100%의 데미지로 공격",
      }],
    }),
    snapshot("테스트", "표본2", {
      "1": [{
        skill_name: "공통 공격",
        skill_level: 10,
        skill_description: "적을 공격한다.",
        skill_effect: "100%의 데미지로 공격",
      }, {
        skill_name: "선택 패시브",
        skill_level: 1,
        skill_description: "영구적으로 능력을 증가시킨다.",
        skill_effect: "몬스터 방어율 무시 20% 증가",
      }],
    }),
  ]);

  const entry = dictionary.classes["테스트"];
  assert.equal(entry.sampleCount, 2);
  assert.equal(entry.skillCount, 2);
  assert.equal(
    entry.skills.find((skill) => skill.name === "공통 공격").sampleCoverage,
    1,
  );
  assert.equal(
    entry.skills.find((skill) => skill.name === "선택 패시브").sampleCoverage,
    0.5,
  );
});

test("스킬 전용 방무와 보스 제외 대상 방어율 감소를 구분한다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본", {
      "4": [{
        skill_name: "강한 공격",
        skill_level: 30,
        skill_description: "적을 공격한다.",
        skill_effect: "500%의 데미지로 공격, 몬스터 방어율 40% 무시",
      }, {
        skill_name: "일반 몬스터 약화",
        skill_level: 10,
        skill_description: "영역을 만든다.",
        skill_effect: "보스 몬스터를 제외한 적의 방어율 30% 감소",
      }],
    }),
  ]);
  const skills = dictionary.classes["테스트"].skills;
  const local = skills.find((skill) => skill.name === "강한 공격");
  const excluded = skills.find((skill) => skill.name === "일반 몬스터 약화");

  assert.deepEqual(local.semantics.ignoreDefense.map((entry) => ({
    scope: entry.scope,
    percent: entry.percent,
    bossApplicable: entry.bossApplicable,
  })), [{ scope: "skill-local", percent: 40, bossApplicable: true }]);
  assert.equal(excluded.semantics.ignoreDefense[0].bossApplicable, false);
});

test("배포용 경량 사전은 설명과 아이콘을 제거하고 계산 관련 스킬만 남긴다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본", {
      "4": [{
        skill_name: "방무 공격",
        skill_description: "적을 공격한다.",
        skill_effect: "방어율 20% 무시하여 공격",
        skill_icon: "https://example.test/icon.png",
      }, {
        skill_name: "이동기",
        skill_description: "빠르게 이동한다.",
        skill_effect: "이동속도 증가",
      }],
    }),
  ]);
  const slim = slimSkillDictionary(dictionary);
  const serialized = JSON.stringify(slim);

  assert.equal(slim.classes["테스트"].skills.length, 1);
  assert.equal(serialized.includes("skill_description"), false);
  assert.equal(serialized.includes("example.test"), false);
});

test("공격 스킬의 독립 방무 문장은 local, 지속 버프 방무는 global로 구분한다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본", {
      "5": [{
        skill_name: "공격과 버프",
        skill_level: 30,
        skill_description: "적을 공격하고 힘을 강화한다.",
        skill_effect: [
          "최대 10명의 적을 500%의 데미지로 공격",
          "몬스터 방어율 50% 추가 무시",
          "30초 동안 몬스터 방어율 무시 20% 증가",
        ].join("\n"),
      }],
    }),
  ]);
  const effects = dictionary.classes["테스트"].skills[0].semantics.ignoreDefense;

  assert.equal(effects.find((entry) => entry.percent === 50).scope, "skill-local");
  assert.equal(effects.find((entry) => entry.percent === 20).scope, "character-global");
  assert.equal(effects.find((entry) => entry.percent === 20).activation, "timed");
});

test("하이퍼 패시브는 대상 스킬 modifier이며 보스 제외 여부를 원본에서 상속한다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본", {
      "4": [{
        skill_name: "약화 영역",
        skill_level: 30,
        skill_description: "영역 안 적을 약화한다.",
        skill_effect: "보스 몬스터를 제외한 적의 방어율 30% 감소",
      }],
      hyperpassive: [{
        skill_name: "약화 영역-인핸스",
        skill_level: 1,
        skill_description: "약화 영역으로 감소되는 방어율 수치를 증가시킨다.",
        skill_effect: "방어율 10% 추가 감소",
      }],
    }),
  ]);
  const modifier = dictionary.classes["테스트"].skills
    .find((skill) => skill.name === "약화 영역-인핸스")
    .semantics.ignoreDefense[0];

  assert.equal(modifier.kind, "target-defense-reduction-modifier");
  assert.equal(modifier.aggregation, "additive-to-target");
  assert.equal(modifier.bossApplicable, false);
});

test("미선택 하이퍼 패시브는 불명확한 숫자가 없어도 활성 계산 검토를 요구하지 않는다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본", {
      hyperpassive: [{
        skill_name: "공격-이그노어 가드",
        skill_level: 0,
        skill_description: "공격의 방어율 무시 수치를 증가시킨다.",
        skill_effect: "",
      }],
    }),
  ]);
  const skill = dictionary.classes["테스트"].skills[0];

  assert.equal(skill.semantics.active, false);
  assert.equal(skill.semantics.reviewRequired, false);
  assert.equal(skill.activeSampleCoverage, 0);
});

test("공식 문구에서 생략한 파생 스킬 방무는 명시된 원본의 단일 값을 상속한다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본", {
      "1": [{
        skill_name: "원본 공격",
        skill_level: 10,
        skill_description: "적을 공격한다.",
        skill_effect: "해당 공격은 몬스터 방어율 80% 추가 무시",
      }],
      "6": [{
        skill_name: "파생 공격",
        skill_level: 30,
        skill_description: "몬스터의 방어율을 추가로 무시한다.\n필요 스킬 : 원본 공격 10레벨 이상",
        skill_effect: "최대 10명의 적을 공격",
      }],
    }),
  ]);
  const derived = dictionary.classes["테스트"].skills
    .find((skill) => skill.name === "파생 공격");

  assert.equal(derived.semantics.ignoreDefense[0].percent, 80);
  assert.equal(derived.semantics.ignoreDefense[0].inheritedFrom, "원본 공격");
  assert.equal(derived.semantics.reviewRequired, false);
});

test("중첩당 대상 방어율 감소와 물리·마법 분기를 독립 의미로 보존한다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본", {
      "4": [{
        skill_name: "중첩 저주",
        skill_level: 10,
        skill_description: "대상을 약화한다.",
        skill_effect: [
          "최대 5회 중첩가능, 지속시간 20초",
          "방어율 감소는 각 중첩의 수치가 모두 더해짐",
          "1중첩:방어율 4% 감소",
          "2~5중첩:방어율 4% 감소",
        ].join("\n"),
      }, {
        skill_name: "이중 약화",
        skill_level: 10,
        skill_description: "적을 약화한다.",
        skill_effect: "마법 방어율 30%, 물리 방어율 15% 감소",
      }],
    }),
  ]);
  const curse = dictionary.classes["테스트"].skills
    .find((skill) => skill.name === "중첩 저주");
  const split = dictionary.classes["테스트"].skills
    .find((skill) => skill.name === "이중 약화");

  assert.equal(curse.semantics.ignoreDefense.length, 1);
  assert.equal(curse.semantics.ignoreDefense[0].maximumStacks, 5);
  assert.equal(curse.semantics.ignoreDefense[0].aggregation, "additive-per-stack");
  assert.deepEqual(
    split.semantics.ignoreDefense.map((entry) => [entry.percent, entry.defenseType]),
    [[15, "physical"], [30, "magic"]],
  );
});

test("같은 이름이 다른 전직 차수에 있으면 사전 항목과 효과 변형을 합치지 않는다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본", {
      "1": [{
        skill_name: "동명 스킬",
        skill_level: 10,
        skill_description: "능력치를 올린다.",
        skill_effect: "공격력 10 증가",
      }],
      "5": [{
        skill_name: "동명 스킬",
        skill_level: 60,
        skill_description: "적을 공격한다.",
        skill_effect: "몬스터 방어율 20% 무시",
      }],
    }),
  ]);
  const skills = dictionary.classes["테스트"].skills;

  assert.equal(skills.length, 2);
  assert.notEqual(skills[0].dictionaryIdentity, skills[1].dictionaryIdentity);
  assert.deepEqual(skills.map((skill) => skill.grades[0]), ["1", "5"]);
});

test("영구 증가형 하이퍼 방무는 대상 공격이 아니라 캐릭터 global로 처리한다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본", {
      hyperpassive: [{
        skill_name: "특수 공격-리듀스 아머",
        skill_level: 1,
        skill_description: "특수 공격 습득 시 방어율 무시가 영구적으로 증가한다.",
        skill_effect: "방어율 무시 15% 증가",
      }],
    }),
  ]);
  const semantics = dictionary.classes["테스트"].skills[0].semantics;
  const mechanic = semantics.ignoreDefense[0];

  assert.equal(semantics.passive, true);
  assert.equal(mechanic.scope, "character-global");
  assert.equal(mechanic.activation, "baseline-passive");
});

test("기절·무적 지속시간이 같은 문장 뒤에 있어도 공격 자체 방무를 timed global로 오인하지 않는다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본", {
      "4": [{
        skill_name: "마무리 공격",
        skill_level: 30,
        skill_description: "적을 공격한다.",
        skill_effect: "500%의 데미지로 6번 공격, 4초 동안 기절, 추가 크리티컬 확률 25%, 추가 방어율 무시 20%",
      }],
    }),
  ]);
  const mechanic = dictionary.classes["테스트"].skills[0]
    .semantics.ignoreDefense[0];

  assert.equal(mechanic.scope, "skill-local");
  assert.equal(mechanic.activation, "per-hit");
});

test("특정 공격군을 강화하는 시간제 버프의 방무는 대상 스킬 local로 둔다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본", {
      "5": [{
        skill_name: "공격군 강화",
        skill_level: 30,
        skill_description: "25초 동안 공격군을 강화한다.",
        skill_effect: [
          "MP 100 소비, 25초 동안 지속",
          "블로우류 스킬이 300%로 12번 공격하는 형태로 강화, 추가 방어율 무시 50%",
        ].join("\n"),
      }],
    }),
  ]);
  const skill = dictionary.classes["테스트"].skills[0];

  assert.equal(skill.semantics.ignoreDefense[0].scope, "skill-local");
  assert.equal(skill.semantics.ignoreDefense[0].activation, "timed");
  assert.deepEqual(skill.semantics.targetSkillNames, ["블로우류"]);
});

test("여러 공격기만 강화하는 영구 패시브 방무를 전역 방무로 오인하지 않는다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본", {
      "4": [{
        skill_name: "방패 기술 전문화",
        skill_level: 30,
        skill_description: "영구적으로 방패 기술인 실드 차지, 실드 체이싱 스킬의 데미지와 몬스터 방어율 무시를 증가시킨다.",
        skill_effect: "실드 차지, 실드 체이싱의 데미지 20%, 몬스터 방어율 무시 30% 증가",
      }],
    }),
  ]);
  const skill = dictionary.classes["테스트"].skills[0];
  const mechanic = skill.semantics.ignoreDefense[0];

  assert.equal(mechanic.scope, "skill-local");
  assert.equal(mechanic.activation, "passive-modifier");
  assert.equal(mechanic.aggregation, "additive-to-target");
  assert.deepEqual(skill.semantics.targetSkillNames, [
    "실드 차지",
    "실드 체이싱",
  ]);
});

test("소환물을 강화하는 패시브 방어율 감소는 원본 스킬 modifier로 둔다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본", {
      "3": [{
        skill_name: "수정 꽃",
        skill_level: 10,
        skill_description: "적을 느리게 하는 수정 꽃을 소환한다.",
        skill_effect: "60초 동안 수정 꽃 소환",
      }],
      "4": [{
        skill_name: "수정 먼지",
        skill_level: 10,
        skill_description: "수정 꽃을 강화하여 보다 효율적인 전투를 한다.\n필요 스킬 : 수정 꽃 10레벨 이상",
        skill_effect: "주변 몬스터 방어율 11% 감소",
      }],
    }),
  ]);
  const skill = dictionary.classes["테스트"].skills
    .find((entry) => entry.name === "수정 먼지");
  const mechanic = skill.semantics.ignoreDefense[0];

  assert.equal(mechanic.kind, "target-defense-reduction-modifier");
  assert.equal(mechanic.scope, "target-skill");
  assert.equal(mechanic.activation, "passive-modifier");
  assert.deepEqual(skill.semantics.targetSkillNames, ["수정 꽃"]);
});

test("별도 디버프의 지속시간으로 영구 방무를 시간제로 오인하지 않는다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본", {
      "3": [{
        skill_name: "약화",
        skill_level: 20,
        skill_description: "적의 방어율을 일정 부분 무시한다. 추가로 공격에 적중한 적을 약화한다.",
        skill_effect: [
          "몬스터 방어율 무시 20% 증가",
          "적중한 적에게 10% 확률로 30초 동안 약화 디버프",
        ].join("\n"),
      }],
    }),
  ]);
  const semantics = dictionary.classes["테스트"].skills[0].semantics;
  const mechanic = semantics.ignoreDefense[0];

  assert.equal(semantics.passive, true);
  assert.equal(mechanic.scope, "character-global");
  assert.equal(mechanic.activation, "baseline-passive");
});

test("커스텀 커맨드 우클릭 설정을 스킬 온오프로 판정하지 않는다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본", {
      "5": [{
        skill_name: "커맨드 공격",
        skill_level: 30,
        skill_description: "커스텀 커맨드 온오프 : 마우스 우클릭",
        skill_effect: "500%의 데미지로 5번 공격, 몬스터 방어율 30% 무시",
      }],
    }),
  ]);
  const semantics = dictionary.classes["테스트"].skills[0].semantics;

  assert.equal(semantics.toggle, false);
  assert.equal(semantics.ignoreDefense[0].activation, "per-hit");
});

test("중첩 방무의 기본값·영구 교체·일시 교체를 별도 연산으로 기록한다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본", {
      "1": [{
        skill_name: "원소 버프",
        skill_level: 10,
        skill_description: "[패시브 효과] 공격 시 버프를 얻는다.",
        skill_effect: "버프는 최대 2회 누적 가능\n버프 1개당 몬스터 방어율 5% 무시",
      }],
      "4": [{
        skill_name: "원소 숙련",
        skill_level: 30,
        skill_description: "버프를 강화한다.",
        skill_effect: "최대 1회 누적\n버프 1개당 몬스터 방어율 무시 9%로 증가",
      }],
      hyperactive: [{
        skill_name: "원소 폭주",
        skill_level: 1,
        skill_description: "일시적으로 버프를 강화한다.",
        skill_effect: "30초 동안 지속\n버프 1개당 몬스터 방어율 무시 10%로 증가\n재사용 대기시간 120초",
      }],
    }),
  ]);
  const skills = dictionary.classes["테스트"].skills;
  const base = skills.find((skill) => skill.name === "원소 버프")
    .semantics.ignoreDefense[0];
  const permanent = skills.find((skill) => skill.name === "원소 숙련")
    .semantics.ignoreDefense[0];
  const timed = skills.find((skill) => skill.name === "원소 폭주")
    .semantics.ignoreDefense[0];

  assert.equal(base.aggregation, "additive-per-stack");
  assert.equal(base.maximumStacks, 2);
  assert.equal(permanent.aggregation, "replace-target-per-stack");
  assert.equal(permanent.maximumStackIncrease, 1);
  assert.equal(timed.aggregation, "replace-target-per-stack");
  assert.equal(timed.activation, "timed");
});

test("표식 대상에게만 적용되는 캐릭터 방무는 조건부 global로 기록한다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본", {
      "4": [{
        skill_name: "표식",
        skill_level: 20,
        skill_description: "표식을 새겨 적을 약화시킨다.",
        skill_effect: "죽음의 표식이 있는 적에게 방어율 10% 추가 무시",
      }],
    }),
  ]);
  const mechanic = dictionary.classes["테스트"].skills[0]
    .semantics.ignoreDefense[0];

  assert.equal(mechanic.scope, "character-global");
  assert.equal(mechanic.activation, "conditional");
  assert.match(mechanic.condition, /표식/u);
});

test("상위 스킬의 파생 타격별 방무를 효과 단위 대상으로 분리한다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본", {
      "6": [{
        skill_name: "복합 초식",
        skill_level: 30,
        skill_description: "여러 파생 초식을 강화한다.",
        skill_effect: [
          "첫 초식 : 최대 10명의 적을 공격",
          "첫 초식-현무 : 500%의 데미지로 공격",
          "첫 초식-주작 : 500%의 데미지로 공격",
          "추가 크리티컬 확률 100%, 몬스터의 방어율 44% 무시",
          "마지막 초식 : 사용 가능",
          "최대 11명의 적에게 800%의 데미지로 공격",
          "추가 크리티컬 확률 100%, 몬스터의 방어율 60% 무시",
        ].join("\n"),
      }],
    }),
  ]);
  const mechanics = dictionary.classes["테스트"].skills[0]
    .semantics.ignoreDefense;

  assert.deepEqual(mechanics.map((entry) => ({
    percent: entry.percent,
    targetSkillNames: entry.targetSkillNames,
  })), [{
    percent: 44,
    targetSkillNames: ["첫 초식"],
  }, {
    percent: 60,
    targetSkillNames: ["마지막 초식"],
  }]);
});

test("같은 부모 설명의 명시적 파생 타격 주어를 각 방무에 보존한다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본", {
      "6": [{
        skill_name: "복합 강화",
        skill_level: 30,
        skill_description: "파생 공격을 강화한다.",
        skill_effect: [
          "지속 중 3회에 한해 충격파 적중 시 500%의 데미지로 공격, 몬스터 방어율 20% 추가 무시",
          "징벌 발생 조건 감소, 징벌 데미지 477%로 적용, 몬스터 방어율 20% 추가 무시",
          "대폭발 : 최대 12명의 적을 600%의 데미지로 공격, 몬스터 방어율 20% 추가 무시",
        ].join("\n"),
      }],
    }),
  ]);
  const mechanics = dictionary.classes["테스트"].skills[0]
    .semantics.ignoreDefense;

  assert.deepEqual(mechanics.map((entry) => entry.targetSkillNames), [
    ["충격파"],
    ["징벌"],
    ["대폭발"],
  ]);
});

test("자기 효과와 파티원 전용 효과를 동일 캐릭터에게 중복 적용하지 않는다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본", {
      "6": [{
        skill_name: "파이렛 플래그 VI",
        skill_level: 30,
        skill_description: "자신과 파티원을 강화한다.",
        skill_effect: [
          "60초 동안 자신의 모든 능력치 증가 및 몬스터 방어율 무시 25% 증가",
          "파티원은 모든 능력치 증가 및 몬스터 방어율 무시 25% 증가",
        ].join("\n"),
      }],
    }),
  ]);
  const semantics = dictionary.classes["테스트"].skills[0].semantics;

  assert.equal(semantics.ignoreDefense.length, 1);
  assert.equal(semantics.ignoreDefense[0].recipient, "self");
  assert.equal(semantics.ignoreDefense[0].appliesToCaster, true);
  assert.equal(semantics.externalIgnoreDefense.length, 1);
  assert.equal(semantics.externalIgnoreDefense[0].recipient, "party-member");
  assert.equal(semantics.externalIgnoreDefense[0].appliesToCaster, false);
});

test("기존 파이렛 플래그의 다음 줄 자기 동일 효과를 self-and-party로 보존한다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본", {
      "5": [{
        skill_name: "파이렛 플래그",
        skill_level: 30,
        skill_description: "자신을 비롯한 파티원의 사기를 높인다.",
        skill_effect: [
          "30초 동안 해적 깃발 소환",
          "해적 깃발 주변에 있는 파티원의 몬스터 방어율 무시 25% 증가",
          "자신은 영역 밖에 있어도 동일한 효과 획득",
        ].join("\n"),
      }],
    }),
  ]);
  const semantics = dictionary.classes["테스트"].skills[0].semantics;

  assert.equal(semantics.ignoreDefense.length, 1);
  assert.equal(semantics.ignoreDefense[0].recipient, "self-and-party");
  assert.equal(semantics.ignoreDefense[0].appliesToCaster, true);
});

test("같은 수치의 장비 조건 분기는 하나의 배타 효과로 정규화한다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본", {
      "4": [{
        skill_name: "팔라딘 엑스퍼트",
        skill_level: 30,
        skill_description: "착용 무기에 따라 방어율 무시가 증가한다.",
        skill_effect: [
          "방어율 무시 31% 증가",
          "한손둔기 착용 시 방어율 무시 10% 증가",
          "두손둔기 착용 시 방어율 무시 10% 증가",
        ].join("\n"),
      }],
    }),
  ]);
  const mechanics = dictionary.classes["테스트"].skills[0]
    .semantics.ignoreDefense;
  const weaponBranch = mechanics.find((entry) => entry.percent === 10);

  assert.equal(mechanics.length, 2);
  assert.equal(weaponBranch.exclusiveGroup, "equipped-item");
  assert.deepEqual(weaponBranch.exclusiveBranches, ["한손둔기", "두손둔기"]);
  assert.equal(weaponBranch.conditionAlternatives.length, 2);
  assert.equal(weaponBranch.activation, "conditional");
});

test("같은 문장의 회복·무적 수혜자를 몬스터 방어율 감소 수혜자로 오인하지 않는다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본", {
      "4": [{
        skill_name: "지원 장치",
        skill_level: 1,
        skill_description: "지원 장치를 설치한다.",
        skill_effect: [
          "80초 동안 몬스터 방어율 10% 감소, 자신을 포함한 파티원의 HP 회복",
        ].join("\n"),
      }],
    }),
  ]);
  const mechanic = dictionary.classes["테스트"].skills[0]
    .semantics.ignoreDefense[0];

  assert.equal(mechanic.kind, "target-defense-reduction");
  assert.equal(mechanic.scope, "target");
  assert.equal(mechanic.recipient, undefined);
  assert.equal(mechanic.appliesToCaster, undefined);
});

test("연무장 파생 타격명은 느슨한 접두어가 아니라 검토된 부모에만 연결한다", () => {
  const samples = [snapshot("테스트", "표본", {
    "6": [{
      skill_name: "폭풍의 시 VI",
      skill_description: "화살을 빠르게 발사한다.",
      skill_effect: "500%의 데미지로 공격",
    }],
  })];
  const profiles = {
    테스트: {
      skillShares: [{ source: "폭풍의 시 VI : 난사 모드", weight: 1 }],
    },
  };

  const withoutOverride = buildSkillDictionary(samples, { profiles });
  assert.equal(
    withoutOverride.classes["테스트"].battlePracticeCoverage.matchedDamageShare,
    0,
  );

  const withOverride = buildSkillDictionary(samples, {
    profiles,
    aliasOverrides: {
      classes: {
        테스트: {
          "폭풍의 시 VI : 난사 모드": {
            canonical: "폭풍의 시 VI",
            evidence: "manual-reviewed-mode-pair",
          },
        },
      },
    },
  });
  const entry = withOverride.classes["테스트"];
  const parent = entry.skills.find((skill) => skill.name === "폭풍의 시 VI");

  assert.equal(entry.battlePracticeCoverage.matchedDamageShare, 1);
  assert.deepEqual(entry.battlePracticeCoverage.matchMethodCounts, {
    "reviewed-override": 1,
  });
  assert.deepEqual(parent.aliases, ["폭풍의 시 VI : 난사 모드"]);
  assert.equal(parent.aliasEvidence[0].evidence, "manual-reviewed-mode-pair");
  assert.deepEqual(
    slimSkillDictionary(withOverride).classes["테스트"].skills[0].aliases,
    ["폭풍의 시 VI : 난사 모드"],
  );
});

test("공식 문구 한 곳에만 파생명이 완전히 명시되면 자동 연결한다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본", {
      "5": [{
        skill_name: "부모 스킬",
        skill_description: "재사용하면 파생 일격이 발동된다.",
        skill_effect: "파생 일격 : 500%의 데미지로 공격",
      }, {
        skill_name: "관계없는 스킬",
        skill_description: "다른 공격이다.",
        skill_effect: "300%의 데미지로 공격",
      }],
    }),
  ], {
    profiles: {
      테스트: { skillShares: [{ source: "파생 일격", weight: 1 }] },
    },
  });
  const entry = dictionary.classes["테스트"];
  const parent = entry.skills.find((skill) => skill.name === "부모 스킬");

  assert.equal(entry.battlePracticeCoverage.matchedDamageShare, 1);
  assert.equal(parent.aliasEvidence[0].method, "unique-official-text");
  assert.equal(parent.aliasEvidence[0].evidence, "description");
});

test("둘 이상의 공식 스킬이 같은 파생명을 언급하면 자동 추정하지 않는다", () => {
  const dictionary = buildSkillDictionary([
    snapshot("테스트", "표본", {
      "5": ["첫 부모", "둘째 부모"].map((skill_name) => ({
        skill_name,
        skill_description: "파생 일격을 강화한다.",
        skill_effect: "최종 데미지 증가",
      })),
    }),
  ], {
    profiles: {
      테스트: { skillShares: [{ source: "파생 일격", weight: 1 }] },
    },
  });

  assert.equal(
    dictionary.classes["테스트"].battlePracticeCoverage.matchedDamageShare,
    0,
  );
});
