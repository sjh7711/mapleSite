import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateCombatReuse,
  combatReusePercent,
  reuseEligibleSkills,
} from "../src/combat-reuse.js";
import {
  calculateActiveSkillCycleBonuses,
  calculateConditionalLinkCycleBonuses,
  resolveCharacterPresetSnapshot,
  resolveClassDamageChannels,
} from "../src/stat-efficiency.js";
import { calculateDamageChannelIgnoreDefenseGain } from "../src/combat-model.js";

const ability = (percent) => ({ ability_info: [
  { ability_value: `스킬 사용 시 ${percent}% 확률로 재사용 대기시간이 미적용` },
] });
const artifact = { union_artifact_effect: [
  { name: "재사용 대기시간 미적용 확률 7.50% 증가" },
] };
const group = (grade, ...skills) => ({ character_skill_grade: grade, character_skill: skills });
const attack = (name, effect = "MP 100 소비\n재사용 대기시간 20초", description = "") => ({
  skill_name: name, skill_level: 30, skill_effect: effect, skill_description: description,
});

test("inherits reuse for eligible mastery attacks while excluding passive, charge and exempt skill cooldowns", () => {
  const skillData = [
    group("4", attack("생츄어리"), attack("플레시 미라주"), attack("미니 캐논볼"),
      attack("데우스", undefined, "재사용 대기시간 초기화 효과를 적용받지 않는다."),
      attack("자동 공격", "[패시브 효과 : MP 10 소비, 재사용 대기시간 3초]")),
    group("5", attack("오라 웨폰")),
    group("6", attack("생츄어리 VI"), attack("미니 캐논볼 VI"), attack("데우스 VI"), attack("오리진")),
    group("hyperactive", attack("에픽 어드벤쳐")),
  ];
  assert.deepEqual([...reuseEligibleSkills(skillData, "팔라딘")], ["생츄어리", "생츄어리 VI"]);
  assert.equal(combatReusePercent(ability(20), artifact), 27.5);
});

test("reuses only Lete's two Edict attacks and discounts procs already represented by replays", () => {
  const skillData = [
    group("4", attack("이딕트 : 램페이지"), attack("이딕트 : 템플러 아츠"),
      attack("어튠먼트", "펠 스톰을 제외한 이딕트 스킬의 재사용 대기시간 초기화 확률 15% 증가")),
    group("5", attack("체인 커맨드",
      "맹약 최종 완성 시 이딕트 스킬의 재사용 대기시간 즉시 초기화 및 30초 동안 이딕트 스킬의 재사용 대기시간 40% 감소, 재사용 대기시간 초기화 확률 12% 증가\n재사용 대기시간 120초")),
    group("6", attack("이딕트 : 램페이지 VI"), attack("이딕트 : 템플러 아츠 VI"), attack("이딕트 : 펠 스톰 VI")),
  ];
  const evaluate = (rate) => calculateCombatReuse({
    characterClass: "레테", skillData, abilityData: ability(rate), unionArtifactData: artifact,
  });
  const full = evaluate(20);
  assert.equal(full.sources.length, 2);
  assert.ok(full.sources.every(({ multiplier }) => multiplier > 1 && multiplier < 1.01));
  const noAbility = evaluate(0);
  assert.ok(noAbility.damageMultiplier < full.damageMultiplier);
  assert.ok(noAbility.sources.every(({ multiplier }) => multiplier > 0.65 && multiplier < 0.8));
  const { referencePercent } = full.sources[0];
  assert.equal(evaluate(referencePercent - 7.5).sources[0].multiplier, 1);
});

test("reweights skill-local IED channels using the selected reuse rate", () => {
  const skillData = [
    group("4", attack("헤드 샷")),
    group("6", attack("헤드 샷 VI", "MP 36 소비, 몬스터 방어율 60% 무시\n재사용 대기시간 5초")),
  ];
  const gain = (rate) => {
    const input = { characterClass: "캡틴", skillData };
    const { weightMultipliers } = calculateCombatReuse({
      ...input, abilityData: ability(rate), unionArtifactData: artifact,
    });
    return calculateDamageChannelIgnoreDefenseGain({
      currentIgnoreDefense: 0.95,
      addedIgnoreDefense: 0.4,
      enemyDefense: 3.8,
      channels: resolveClassDamageChannels({ ...input, weightMultipliers }),
    });
  };
  assert.ok(gain(20) < gain(0));
});

test("auto boss compares the damage from reusable attacks when choosing ability", () => {
  const boss = { ability_info: [{ ability_value: "보스 몬스터 공격 시 데미지 8% 증가" }] };
  const selected = resolveCharacterPresetSnapshot({
    characterClass: "레테",
    mainStat: "INT",
    attackType: "magic",
    abilityData: { ...boss, preset_no: 1, ability_preset_1: boss, ability_preset_2: ability(20) },
    unionArtifactData: artifact,
    skillData: [
      group("4", attack("이딕트 : 램페이지"), attack("이딕트 : 템플러 아츠")),
      group("6", attack("이딕트 : 램페이지 VI"), attack("이딕트 : 템플러 아츠 VI")),
    ],
    statData: { final_stat: Object.entries({
      INT: 10000, 마력: 3000, 데미지: 100, "보스 몬스터 데미지": 400,
      "크리티컬 확률": 100, "크리티컬 데미지": 100, "방어율 무시": 95,
    }).map(([stat_name, stat_value]) => ({ stat_name, stat_value })) },
    presetPolicy: { mode: "auto" },
  }).selection;
  assert.equal(selected.selected.ability, 2);
});

test("reuse extends eligible buff uptime and Soul Contract only casts on scheduled bursts", () => {
  const skillData = [group("4", attack("다크 레조넌스",
    "MP 100 소비, 20초 동안 데미지 20% 증가\n재사용 대기시간 60초"))];
  const initial = calculateActiveSkillCycleBonuses(skillData, "attack", 360);
  const reused = calculateActiveSkillCycleBonuses(skillData, "attack", 360, { reusePercent: 27.5 });
  assert.ok(reused.applied[0].uptime > initial.applied[0].uptime);
  assert.ok(reused.applied[0].uptime <= 1);
  const soul = { character_link_skill: [
    attack("소울 컨트랙트", "10초 동안 데미지 60% 증가\n재사용 대기시간 60초"),
  ] };
  const result = calculateConditionalLinkCycleBonuses(soul, 71, false, "레테", false, 360);
  assert.ok(Math.abs(result.damage - 17.1) < 1e-9);
  const shortened = calculateConditionalLinkCycleBonuses(soul, 71, false, "레테", false, 65);
  assert.ok(Math.abs(shortened.damage - 60 * 22.1 / 65) < 1e-9);
});
