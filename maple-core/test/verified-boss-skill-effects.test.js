import assert from "node:assert/strict";
import test from "node:test";
import {
  bossDamageGainPerPoint,
  generalizedBattlePracticeDamageChannelsFromSkills,
} from "../src/combat-model.js";
import { calculateActiveSkillCycleBonuses } from "../src/stat-efficiency.js";

const skill = (skill_name, skill_effect, skill_description = "", skill_level = 30) =>
  ({ skill_name, skill_effect, skill_description, skill_level });
const grade = (character_skill_grade, ...character_skill) =>
  ({ character_skill_grade, character_skill });
const attack = (name, effect = "") =>
  skill(name, `1200%의 데미지로 6번 공격\n${effect}`);
const hyper = (name, description, effect, level = 1) =>
  skill(name, effect, `[마스터 레벨 : 1]\n${description}`, level);
const core = (name) => ({ v_core_name: `${name} 강화`, v_core_type: "강화 코어", v_core_level: 40 });

function attackChannels(skillData, names, ...cores) {
  return new Map(generalizedBattlePracticeDamageChannelsFromSkills({
    skillData,
    vMatrixData: { character_v_core_equipment: cores },
    profile: {
      sampleCount: 3,
      shareBasis: "pre-defense",
      skillShares: names.map((source) => ({ source, weight: 1 / names.length })),
    },
  }).filter((channel) => channel.weight > 0).map((channel) => [channel.source, channel]));
}

test("스트라이커는 습득한 중첩 상한과 천지개벽의 대체 수치를 반영한다", () => {
  const skills = [
    grade("1", skill("엘리멘트 : 라이트닝",
      "뇌전 버프는 최대 2회 누적 가능\n뇌전 버프 1개당 몬스터의 방어율 5% 무시")),
    grade("2", skill("뇌백", "최대 누적 횟수 1회 증가\n뇌전 버프 1개당 데미지 2% 증가")),
    grade("3", skill("뇌제", "최대 누적 횟수 1회 증가\n뇌전 버프 1개당 데미지 4%로 증가")),
    grade("4", skill("뇌신", "최대 누적 횟수 1회 증가\n뇌전 버프 1개당 몬스터 방어율 무시 9%로 증가")),
    grade("hyperactive", skill("천지개벽",
      "30초 동안 지속\n뇌전 버프 1개당 데미지 증가량 4%, 몬스터 방어율 무시 10%로 증가\n재사용 대기시간 120초")),
    grade("6", skill("태풍 VI",
      "사용한 뇌전 버프 1개당 데미지 3% 증가 버프가 95초 동안 지속\n재사용 대기시간 12초",
      "태풍 VI는 버프 지속시간 증가 효과를 받는다.")),
  ];
  const result = calculateActiveSkillCycleBonuses(skills, "attack", 360, {
    characterClass: "스트라이커", buffDurationPercent: 50,
  });
  assert.deepEqual(result.ignoreDefenseSources, [46.25]);
  assert.equal(result.applied.find(({ name }) => name === "뇌전 버프").damage, 20);
  assert.equal(result.applied.find(({ name }) => name === "태풍 VI").duration, 142.5);
  assert.equal(result.damage, 35);
});

test("아크는 스펠의 공격 지속과 캐릭터가 받는 어비스 버프를 구분한다", () => {
  const abyss = attack("어비스 차지드라이브 VI", [
    "재사용 대기시간 9초",
    "어비스 스펠 : 스펠 불릿 사용 시 3초 동안 151%의 데미지로 공격",
    "어비스 버프 : 어비스 스펠 적중 시 60초 동안 데미지 20%, 보스 몬스터 공격 시 데미지 35%, 방어율 무시 20% 증가",
  ].join("\n"));
  const result = calculateActiveSkillCycleBonuses([grade("6", abyss)], "attack", 360, {
    characterClass: "아크",
  });
  assert.equal(result.applied[0].duration, 60);
  assert.equal(result.applied[0].uptime, 1);
  assert.equal(result.damage, 20);
  assert.equal(result.bossDamage, 35);
  assert.deepEqual(result.ignoreDefenseSources, [20]);
});

test("아크 배틀 아츠 하이퍼는 적힌 제외 대상에 적용하지 않는다", () => {
  const names = ["걷잡을 수 없는 혼돈 VI", "다가오는 죽음", "돌아오는 증오 VI", "끝없는 고통 VI", "태고의 어센트"];
  const scope = "스펠 불릿, 다가오는 죽음, 돌아오는 증오, 끝없는 고통 VI을 제외한 1~4차 아크 공격 스킬 및 6차 마스터리 코어 스킬의";
  const channels = attackChannels([
    grade("6", ...names.filter((name) => name !== "다가오는 죽음").map((name) => attack(name))),
    grade("2", attack("다가오는 죽음")),
    grade("hyperpassive",
      hyper("배틀 아츠-이그노어 가드", `${scope} 방어율 무시 수치를 증가시킨다.`, "방어율 무시 20% 증가"),
      hyper("배틀 아츠-보스 킬러", `${scope} 보스 몬스터 공격 시 데미지를 증가시킨다.`, "보스 몬스터 공격 시 데미지 20% 증가")),
  ], names, core("다가오는 죽음"), core("돌아오는 증오"));
  const affected = channels.get(names[0]);
  assert.deepEqual(affected.ignoreDefenseSources, [20]);
  assert.equal(affected.localBossDamage, 20);
  assert.deepEqual(channels.get("다가오는 죽음").ignoreDefenseSources, [20]);
  assert.deepEqual(channels.get("돌아오는 증오 VI").ignoreDefenseSources, [20]);
  assert.equal(channels.get("다가오는 죽음").localBossDamage, undefined);
  assert.equal(channels.has("끝없는 고통 VI"), false);
  assert.equal(channels.has("태고의 어센트"), false);
});

test("정확한 공격을 우선 연결하고 하이퍼와 V 코어 방무를 모두 결합한다", () => {
  const names = ["트리니티 VI", "트리니티 퓨전", "환영 분신부 VI", "선기 : 극대 분신난무", "퍼지롭 매스커레이드 VI : 저격"];
  const channels = attackChannels([
    grade("6", attack("트리니티 VI", "트리니티 VI와 트리니티 퓨전의 데미지 및 방어율 무시 15% 증가 버프가 최대 2회 중첩"),
      attack("환영 분신부 VI"), attack(names[4], "몬스터의 방어율을 40% 무시")),
    grade("5", attack("트리니티 퓨전"), attack("선기 : 극대 분신난무")),
    grade("hyperpassive",
      hyper("환영 분신부-이그노어 가드", "환영 분신부와 선기 : 극대 분신난무의 방어율 무시 수치를 증가시킨다.", "방어율 무시 25% 증가"),
      hyper("퍼지롭 매스커레이드-이그노어 가드", "퍼지롭 매스커레이드의 방어무시 비율을 증가시킨다.", "방어무시 비율 10% 증가")),
  ], names, core("트리니티"), core("환영 분신부"), core("퍼지롭 매스커레이드"));

  assert.deepEqual(channels.get("트리니티 VI").ignoreDefenseSources, [30, 20]);
  assert.deepEqual(channels.get("트리니티 퓨전").ignoreDefenseSources, [30]);
  assert.deepEqual(channels.get("환영 분신부 VI").ignoreDefenseSources, [25, 20]);
  assert.deepEqual(channels.get("선기 : 극대 분신난무").ignoreDefenseSources, [25]);
  assert.deepEqual(channels.get(names[4]).ignoreDefenseSources, [40, 10, 20]);
});

test("레테 이딕트 하이퍼와 어센트 보공은 해당 공격만 증가시킨다", () => {
  const names = ["이딕트 : 램페이지 VI", "오버로드 : 램페이지", "앱솔루트 레인"];
  const channels = attackChannels([
    grade("6", attack(names[0]), attack(names[1]), skill(names[2],
      "1200%의 데미지로 6번 공격\n몬스터 방어율 60% 추가 무시, 보스 몬스터 공격 시 데미지 40% 증가",
      "10레벨 : 보스 몬스터 공격 시 데미지 10% 증가\n20레벨 : 보스 몬스터 공격 시 데미지 10% 증가", 20)),
    grade("hyperpassive",
      hyper("이딕트-이그노어 가드", "이딕트 스킬의 방어율 무시 수치를 증가시킨다.", "방어율 무시 20% 증가"),
      hyper("이딕트-보스 킬러", "이딕트 스킬의 보스 몬스터 공격 시 데미지를 증가시킨다.", "보스 몬스터 공격 시 데미지 20% 증가"),
      hyper("미습득-보스 킬러", "이딕트 스킬의 보스 몬스터 공격 시 데미지를 증가시킨다.", "보스 몬스터 공격 시 데미지 10% 증가", 0)),
  ], names);
  assert.equal(channels.get(names[0]).localBossDamage, 20);
  assert.equal(channels.get(names[2]).localBossDamage, 60);
  assert.deepEqual(channels.get(names[0]).ignoreDefenseSources, [20]);
  assert.equal(channels.has(names[1]), false);
  assert.ok(Math.abs(bossDamageGainPerPoint({
    damageBracket: 800, currentIgnoreDefense: 1, enemyDefense: 3.8, channels: [...channels.values()],
  }) - (1 / 820 + 1 / 800 + 1 / 860) / 3) < 1e-12);
});

test("화신과 포커스 온의 방무는 풀도핑 전투의 유지형 스탯으로 반영한다", () => {
  const spirits = [grade("4", skill("스피릿 오브 플레임",
    "MP 115 소비, 화신 소환\n화신 소환 중 MP 소비량 105%로 증가, 방어율 무시 31% 증가"))];
  const sniper = [grade("4", skill("어드밴스드 인핸스 애로우",
    "포커스 온 : 인핸스 스킬 적중 시 30초 동안 최종 데미지 4% 증가, 몬스터 방어율 무시 13% 증가\n[패시브 효과 : 몬스터 방어율 20% 무시]",
    "포커스 온을 획득하고 영구히 방어율 무시가 증가한다."))];
  assert.deepEqual(calculateActiveSkillCycleBonuses(spirits, "magic", 360, {
    characterClass: "플레임위자드",
  }).ignoreDefenseSources, [31]);
  const bonus = calculateActiveSkillCycleBonuses(sniper, "attack", 360, { characterClass: "신궁" });
  assert.deepEqual(bonus.ignoreDefenseSources, [13]);
  assert.equal(bonus.applied[0].name, "포커스 온");
});

test("스나이핑 VI에 명시된 두 강화 공격에도 고유 방무가 적용된다", () => {
  const names = ["스나이핑 VI", "인핸스 스나이핑 VI", "얼티밋 스나이핑"];
  const channels = attackChannels([
    grade("6", attack(names[0],
      "스나이핑, 인핸스 스나이핑, 얼티밋 스나이핑은 몬스터 방어율 40% 무시, 추가 크리티컬 확률 100%")),
  ], names, core("인핸스 스나이핑"));
  assert.deepEqual(names.map((name) => channels.get(name).ignoreDefenseSources),
    [[40], [40, 20], [40]]);
});
