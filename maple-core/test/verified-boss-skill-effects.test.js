import assert from "node:assert/strict";
import test from "node:test";
import {
  bossDamageGainPerPoint,
  generalizedBattlePracticeDamageChannelsFromSkills,
} from "../src/combat-model.js";
import {
  calculateActiveSkillCycleBonuses,
  calculateConditionalLinkCycleBonuses,
  calculateGuildNoblesseBonuses,
  reconstructCharacterStats,
} from "../src/stat-efficiency.js";

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
  assert.equal(channels.get("트리니티 VI").localBossDamage, 30);
  assert.equal(channels.get("트리니티 퓨전").localBossDamage, 30);
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

test("스탯 합산은 방무 표기 순서를 허용하고 조건부 데미지는 분리한다", () => {
  const stats = (className, skillData) => reconstructCharacterStats({
    character: { character_class: className, character_level: 290 },
    snapshot: { equipmentData: { item_equipment: [{ item_equipment_slot: "무기" }] }, skillData },
  }).computed;
  const resonance = skill("다크 레조넌스",
    "MP 85 소비, 30초 동안 최종 데미지 8% 증가, 적의 방어율 10% 무시, 보스 몬스터 공격 시 데미지 15% 증가\n[패시브 효과 : 몬스터의 방어율 30% 무시]\n재사용 대기시간 60초");
  const dkSkills = [grade("4", resonance)];
  assert.ok(Math.abs(stats("다크나이트", dkSkills)["방어율 무시"] - 30) < 1e-9);
  assert.deepEqual(calculateActiveSkillCycleBonuses(dkSkills, "attack", 360, {
    characterClass: "다크나이트",
  }).ignoreDefenseSources, [5]);

  const aim = skill("아케인 에임",
    "공격 시 몬스터의 방어율 21% 무시, 소환수의 공격을 제외한 공격 적중 시 100% 확률로 5초 동안 데미지 8% 증가\n데미지 증가 효과는 최대 5번까지 효과 누적 가능");
  const mage = stats("비숍", [grade("4", aim)]);
  assert.ok(Math.abs(mage["방어율 무시"] - 21) < 1e-9);
  assert.equal(mage["데미지"], 0);
  assert.equal(calculateActiveSkillCycleBonuses([grade("4", aim)], "magic", 360).damage, 40);

  const aria = skill("프레이 오브 아리아",
    "[패시브 효과 : 데미지 46% 증가, 공격 시 31%만큼 적의 방어율을 무시, 스탠스 62% 증가]");
  const phantom = stats("팬텀", [grade("4", aria)]);
  assert.ok(Math.abs(phantom["방어율 무시"] - 31) < 1e-9);
  assert.equal(phantom["데미지"], 46);
  const kinesis = stats("키네시스", [grade("3", skill("정신 강화",
    "마력 20, 데미지 16%, 최종 데미지 15%, 몬스터 방어율 무시 15% 증가"))]);
  assert.ok(Math.abs(kinesis["방어율 무시"] - 15) < 1e-9);
  assert.equal(kinesis["데미지"], 16);
  const kaiser = stats("카이저", [grade("4", skill("공격모드 3차 강화",
    "공격력 15, 크리티컬 확률 10%, 보스 몬스터 공격 시 데미지 5% 추가 증가\n파이널 피규레이션 상태에서 보스 몬스터 공격 시 데미지 10% 추가 증가"))]);
  assert.equal(kaiser["보스 몬스터 데미지"], 5);
});

function basicCombatStats(characterClass, skillData) {
  return reconstructCharacterStats({
    character: { character_class: characterClass, character_level: 290 },
    snapshot: { equipmentData: { item_equipment: [{ item_equipment_slot: "무기" }] }, skillData },
  });
}

test("파이널 컨트랙트의 여러 줄 스탯은 전투 버프에 한 번만 반영한다", () => {
  const skills = [grade("hyperactive", skill("파이널 컨트랙트",
    "MP 150 소비, 30초 동안 지속\n공격력 50, 데미지 10%, 방어율 무시 30%, 보스 몬스터 공격 시 데미지 20%, 크리티컬 확률 30% 증가\n재사용 대기시간 120초", "", 1))];
  const { computed, attack: { 공격력 } } = basicCombatStats("엔젤릭버스터", skills);
  assert.equal(공격력.flat, 0);
  assert.equal(computed["데미지"], 0);
  assert.equal(computed["보스 몬스터 데미지"], 0);
  assert.equal(computed["크리티컬 확률"], 5);
  assert.equal(computed["방어율 무시"], 0);
  const cycle = calculateActiveSkillCycleBonuses(skills, "attack", 360, { characterClass: "엔젤릭버스터" });
  assert.equal(cycle.flatAttack, 12.5);
  assert.equal(cycle.damage, 2.5);
  assert.equal(cycle.bossDamage, 5);
  assert.deepEqual(cycle.ignoreDefenseSources, [7.5]);
});

test("퍼지 에어리어 하이퍼는 같은 상시 출처를 올리고 서포트 프로토콜의 방무는 상시 적용한다", () => {
  const purge = grade("4", skill("퍼지 에어리어",
    "MP 41 소비, 40초 동안 지속, 결계 안의 보스 몬스터를 제외한 적의 이동속도 -60 감소\n[패시브 효과 : 보스 몬스터 공격 시 데미지 20%, 몬스터 방어율 무시 30% 증가]"));
  const enhanced = grade("hyperpassive", hyper("퍼지 에어리어-인핸스",
    "퍼지 에어리어의 몬스터 방어율 무시 수치를 증가시킨다.", "방어율 무시 10% 추가 증가"));
  for (const [expected, skillData] of [[30, [purge]], [40, [purge, enhanced]]]) {
    const { computed } = basicCombatStats("나이트로드", skillData);
    assert.ok(Math.abs(computed["방어율 무시"] - expected) < 1e-9);
    assert.equal(computed["보스 몬스터 데미지"], 20);
    assert.equal(attackChannels(skillData, ["퍼지 에어리어"]).has("퍼지 에어리어"), false);
  }
  const support = [grade("3", skill("서포트 프로토콜",
    "5초마다 HP의 8% 자동 회복, 상태 이상 내성 40, 모든 속성 내성 40%, 몬스터 방어율 무시 10% 증가"))];
  const { computed } = basicCombatStats("메카닉", support);
  assert.ok(Math.abs(computed["방어율 무시"] - 10) < 1e-9);
  assert.deepEqual(calculateActiveSkillCycleBonuses(support, "attack", 360).ignoreDefenseSources, []);
});

test("노블레스는 전투 시작부터 만료 시각까지 적용한다", () => {
  const guildData = { guild_noblesse_skill: [
    skill("방어력은 숫자일 뿐", "4분 동안 몬스터 방어율 무시 4% 증가, 재사용 대기시간 5분"),
    skill("보스 킬링 머신", "30분 동안 보스 몬스터 공격 시 데미지 30% 증가, 재사용 대기시간 5분"),
    skill("길드의 이름으로", "2분 동안 데미지 2% 증가, 재사용 대기시간 5분"),
    skill("크게 한방", "크리티컬 데미지 30% 증가"),
  ] };
  const expectedShort = calculateGuildNoblesseBonuses(guildData, 120);
  assert.deepEqual(expectedShort.ignoreDefenseSources, [4]);
  assert.equal(expectedShort.damage, 2);
  const sixMinutes = calculateGuildNoblesseBonuses(guildData, 360);
  assert.deepEqual(sixMinutes.ignoreDefenseSources, [8 / 3]);
  assert.equal(sixMinutes.damage, 2 / 3);
  assert.equal(sixMinutes.bossDamage, 30);
  assert.equal(sixMinutes.criticalDamage, 30);
  assert.equal(calculateGuildNoblesseBonuses({}).available, false);
});

test("무아지경의 방무가 암살과 분쇄의 멸 공격에만 추가된다", () => {
  const names = ["암살 VI", "암살 : 멸", "분쇄 : 멸", "무아지경"];
  const channels = attackChannels([
    grade("6", attack("암살 VI"), attack("무아지경", "암살 : 멸, 분쇄 : 멸은 몬스터 방어율 20% 추가 무시")),
    grade("hyperpassive", hyper("암살-이그노어 가드", "암살의 방어율 무시를 증가시킨다.", "몬스터 방어율 10% 무시")),
  ], names, core("암살"));
  assert.deepEqual(channels.get("암살 VI").ignoreDefenseSources, [10, 20]);
  assert.deepEqual(channels.get("암살 : 멸").ignoreDefenseSources, [20, 10, 20]);
  assert.deepEqual(channels.get("분쇄 : 멸").ignoreDefenseSources, [20]);
  assert.equal(channels.has("무아지경"), false);
});

test("직업명이 붙은 자체 모험가 링크는 같은 계열 최고 레벨을 한 번 적용한다", () => {
  const ownMagic = skill("임피리컬 널리지(아크메이지 썬, 콜)",
    "파악한 약점은 10초 동안 지속되며 최대 3회까지 중첩\n중첩 당 데미지 3%, 방어율 무시 3% 증가", "", 6);
  const equippedMagic = skill("임피리컬 널리지",
    "파악한 약점은 10초 동안 지속되며 최대 3회까지 중첩\n중첩 당 데미지 4%, 방어율 무시 4% 증가", "", 9);
  const ownThief = skill("시프 커닝(섀도어)",
    "적에게 상태 이상을 적용시키면 10초 동안 데미지 18% 증가\n재발동 대기시간 20초", "", 6);
  const magic = calculateConditionalLinkCycleBonuses({ character_owned_link_skill: ownMagic });
  assert.equal(magic.damage, 9);
  assert.deepEqual(magic.ignoreDefenseSources, [9]);
  const combined = calculateConditionalLinkCycleBonuses({
    character_link_skill: [equippedMagic], character_owned_link_skill: ownMagic,
  });
  assert.equal(combined.damage, 12);
  assert.deepEqual(combined.ignoreDefenseSources, [12]);
  assert.equal(calculateConditionalLinkCycleBonuses({ character_owned_link_skill: ownThief }).damage, 9);
});

test("제논의 상시 능력치와 조건부 배분 AP는 각 범위에서 계산한다", () => {
  const skills = [grade("4",
    skill("오펜시브 매트릭스", "스탠스 확률 50%, 공격 시 적의 방어율 무시 30%, STR 700, DEX 700, LUK 700 증가"),
    skill("멀티래터럴 V", "STR/DEX/LUK 모두 260 이상 시 : 데미지 10% 증가"),
    skill("멀티래터럴 VI", "STR/DEX/LUK 모두 330 이상 시 : 데미지 5% 증가"),
    skill("오파츠 코드", "[서플라이] 에너지 20 소비, 60초 동안 최종 데미지 5%, 보스 몬스터 공격 시 데미지 24% 증가"),
  )];
  const read = (dexAp) => reconstructCharacterStats({
    character: { character_class: "제논", character_level: 290 },
    snapshot: {
      equipmentData: { item_equipment: [{ item_equipment_slot: "무기" }] },
      skillData: skills,
      statData: { final_stat: [
        { stat_name: "AP 배분 STR", stat_value: "330" },
        { stat_name: "AP 배분 DEX", stat_value: String(dexAp) },
        { stat_name: "AP 배분 LUK", stat_value: "870" },
      ] },
    },
    mainStat: "ALL",
  }).computed;
  const stats = read(330);
  assert.equal(stats.STR, 1030);
  assert.equal(stats.DEX, 1030);
  assert.equal(stats.LUK, 1570);
  assert.equal(stats["방어율 무시"], 0);
  assert.equal(stats["데미지"], 15);
  assert.equal(read(329)["데미지"], 10);
  assert.equal(read(259)["데미지"], 0);
  assert.equal(stats["보스 몬스터 데미지"], 0);
  assert.equal(calculateActiveSkillCycleBonuses(skills, "attack", 360, { characterClass: "제논" }).bossDamage, 24);
});

test("트루 사이트는 선택 하이퍼를 합치고 오버로드 모드는 방무가 있는 구간만 사용한다", () => {
  const trueSight = [grade("3", skill("트루 사이트",
    "MP 50 소비, 60초 동안 방어율 10% 무시, 최종 데미지 5% 증가")),
  grade("hyperpassive",
    hyper("트루 사이트-이그노어 가드", "", "방어율 10% 추가 무시"),
    hyper("트루 사이트-인핸스", "", "최종 데미지 10% 증가"))];
  const soulMaster = calculateActiveSkillCycleBonuses(trueSight, "attack", 360, {
    characterClass: "소울마스터",
  });
  assert.deepEqual(soulMaster.ignoreDefenseSources, [20]);
  assert.equal(soulMaster.applied[0].finalDamage, 15);
  const overload = [grade("5", skill("오버로드 모드",
    "30초 동안 에너지가 20 초과되어 충전\n20초 동안 데미지 10%, 몬스터 방어율 무시 30% 증가\n재사용 대기시간 : 120초"))];
  const xenon = calculateActiveSkillCycleBonuses(overload, "attack", 360, { characterClass: "제논" });
  assert.deepEqual(xenon.ignoreDefenseSources, [5]);
  assert.ok(Math.abs(xenon.damage - 10 / 6) < 1e-9);
});

test("히어로는 습득한 보스 킬러와 콤보 상한으로 보공을 합산한다", () => {
  const bonuses = calculateActiveSkillCycleBonuses([
    grade("4", skill("어드밴스드 콤보", "최대 콤보 카운터 10개")),
    grade("hyperpassive", hyper("어드밴스드 콤보-보스 킬러", "",
      "콤보 개수 당 보스 몬스터 공격 시 데미지 2% 증가")),
  ], "attack", 360, { characterClass: "히어로" });
  assert.equal(bonuses.bossDamage, 20);
});

test("제로의 폼 방무와 데몬슬레이어의 고유 보공은 해당 공격에만 적용한다", () => {
  const zero = attackChannels([grade("4",
    skill("태도 마스터리", "영구적으로 알파의 공격력 40 증가, 공격 시 대상의 방어율 65% 무시"),
    skill("아머 스플릿", "베타가 공격 시 대상의 방어율 50% 무시"),
  )], ["롤링 커브 VI", "어스 브레이크 VI", "솔 헤카테"], core("롤링 커브"));
  assert.deepEqual(zero.get("롤링 커브 VI").ignoreDefenseSources, [65, 20]);
  assert.deepEqual(zero.get("어스 브레이크 VI").ignoreDefenseSources, [50]);
  assert.equal(zero.has("솔 헤카테"), false);
  const demon = attackChannels([
    grade("5", attack("데몬 어웨이크닝",
      "강화 데몬 슬래시 : 최대 6명의 적을 3번 공격, 몬스터 방어율 50% 추가 무시, 보스 몬스터 공격 시 데미지 50% 증가")),
    grade("4", attack("데몬 임팩트", "보스 몬스터 공격 시 데미지 40% 증가")),
    grade("6", attack("데몬 임팩트 VI", "보스 몬스터 공격 시 데미지 45% 증가")),
  ], ["데몬 어웨이크닝", "데몬 임팩트 VI", "솔 헤카테"]);
  assert.equal(demon.get("데몬 어웨이크닝").localBossDamage, 50);
  assert.equal(demon.get("데몬 임팩트 VI").localBossDamage, 45);
  assert.equal(demon.has("솔 헤카테"), false);
});

test("어센트와 솔 헤카테의 보공은 해금한 단계를 한 번씩 해당 공격에 적용한다", () => {
  const levels = "10레벨 : 몬스터 방어율 무시 10% 증가, 보스 몬스터 공격 시 데미지 10% 증가\n20레벨 : 몬스터 방어율 무시 10% 증가, 보스 몬스터 공격 시 데미지 10% 증가";
  const channels = attackChannels([grade("6",
    skill("유니온 드라이브",
      "1000%의 데미지로 10번 공격\n몬스터 방어율 60% 추가 무시, 보스 몬스터 공격 시 데미지 40% 증가, 크리티컬 확률 100%\n" + levels, levels, 10),
    skill("솔 헤카테", "1000%의 데미지로 10번 공격", levels, 20),
  )], ["유니온 드라이브", "솔 헤카테", "서클 오브 마나 VI"]);
  assert.equal(channels.get("유니온 드라이브").localBossDamage, 50);
  assert.equal(channels.get("솔 헤카테").localBossDamage, 20);
  assert.equal(channels.has("서클 오브 마나 VI"), false);
});
