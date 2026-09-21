import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  calculateActiveSkillCycleBonuses,
  calculateCharacterPotentialConversion,
  characterBaselineSkillSummary,
} from 'maple-core/stat-efficiency';
import {
  isBaselineReflectedSkill, generalizedBattlePracticeDamageChannelsFromSkills,
  composeCombatModel,
} from 'maple-core/combat-model';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/skills-20260919.json', import.meta.url)));
const skill = (name, characterClass) => fixture.skills.find(s =>
  s.skill_name === name && (!characterClass || s.characterClass === characterClass));
const data = (...skills) => [{ character_skill: skills }];
const cycle = (s, characterClass = s.characterClass, attackType = 'attack') =>
  calculateActiveSkillCycleBonuses(data(s), attackType, 360,
    { characterClass, apStats: { STR: 1500 }, mapleWarriorPercent: 15 });

test('개편 여신 버프는 현재 최종 데미지·지속시간을 읽고 삭제된 AP 능력치를 더하지 않는다', () => {
  for (const [name, finalDamage, duration] of [
    ['메이플월드 여신의 축복', 17, 60], ['여제 시그너스의 축복', 17, 45],
    ['초월자 륀느의 기원', 10, 45], ['이계 여신의 축복', 11, 40],
  ]) {
    const result = cycle(skill(name));
    assert.equal(result.applied[0].finalDamage, finalDamage, name);
    assert.equal(result.applied[0].duration, duration, name);
    assert.equal(result.applied[0].cooldown, 120, name);
    assert.equal(result.damage, 0, name);
    assert.equal(result.baseFlat.STR, 0, name);
    assert.equal(result.flatAttack, 0, name);
  }
});

test('그란디스는 패시브가 함께 있어도 종족별 임시 최종 데미지를 유지한다', () => {
  for (const [characterClass, finalDamage] of [['카이저',12],['아델',15],['호영',13]]) {
    const result = cycle(skill('그란디스 여신의 축복'), characterClass);
    assert.equal(result.applied[0].finalDamage, finalDamage);
    assert.equal(result.damage, 0);
  }
});

test('스파이더·크레스트·신규 5차 패시브는 상시 능력치로 분류한다', () => {
  for (const name of ['스파이더 인 미러','크레스트 오브 더 솔라','에르다 퍼미에이션','쓸만한 홀리 파운틴']) {
    const s = skill(name);
    assert.equal(isBaselineReflectedSkill(s), true, name);
    assert.deepEqual(cycle(s).applied, [], name);
  }
  const summary = characterBaselineSkillSummary(data(
    skill('스파이더 인 미러'), skill('크레스트 오브 더 솔라'),
    skill('에르다 퍼미에이션'), skill('쓸만한 홀리 파운틴'),
  ));
  assert.deepEqual(summary.map(s => [s.effects.attack,s.effects.magic,s.effects.allStat]),
    [[30,30,0],[30,30,0],[0,0,10],[0,0,6]]);
});

test('스킬 이름만 같아도 삭제된 인사이징 버프나 변경된 패시브를 다시 가산하지 않는다', () => {
  for (const name of ['인사이징','인사이징 VI','이그니스 로어','위크포인트 컨버징 어택','약화']) {
    assert.deepEqual(cycle(skill(name)).applied, [], name);
  }
});

test('유지형 버프의 수치는 레벨별 API 설명을 따르고 중첩도 설명대로 적용한다', () => {
  assert.equal(cycle(skill('소울 게이즈')).criticalDamage, 17);
  assert.equal(cycle(skill('엘리멘트 : 플레임 IV'), '플레임위자드', 'magic').flatAttack, 41);
  assert.equal(cycle(skill('아케인 에임'), '비숍', 'magic').damage, 40);
  assert.equal(cycle(skill('다크 크레센도')).damage, 40);
  assert.equal(cycle(skill('하울링')).attackPercent, 10);
  assert.equal(cycle(skill('하울링'), '와일드헌터', 'magic').attackPercent, 10);
  assert.equal(cycle(skill('메디테이션'), '비숍', 'magic').flatAttack, 30);
  assert.equal(cycle({...skill('소울 게이즈'), skill_effect: '180초 동안 크리티컬 데미지 19% 증가'}).criticalDamage, 19);
});

test('새 전신 버프는 반영하고 혼합 스킬의 패시브 공격력은 액티브에 더하지 않는다', () => {
  const destiny = cycle(skill('초월 : 최초의 유산'));
  assert.equal(destiny.attackPercent, 5);
  const agent = cycle(skill('프로페셔널 에이전트'));
  assert.equal(agent.applied[0].finalDamage, 50);
  assert.equal(cycle(skill('프로페셔널 에이전트 VI')).applied[0].finalDamage, 50);
  const ready = cycle(skill('레디 투 다이'));
  assert.equal(ready.applied[0].finalDamage, 24);
  assert.equal(ready.flatAttack, 0);
});

test('로디드 다이스는 공격력 패시브와 별도로 선택한 주사위 효과를 유지한다', () => {
  const result = calculateActiveSkillCycleBonuses(data(skill('로디드 다이스'),skill('더블 럭키 다이스')),
    'attack',360,{characterClass:'바이퍼'});
  assert.equal(result.damage,30);
  assert.equal(result.flatAttack,0);
  assert.equal(result.applied[0].name,'로디드 다이스');
});

test('겹치는 이벤트 두 개는 현재 스킬 정보를 모두 표시하며 방무 출처를 분리한다', () => {
  const summary = characterBaselineSkillSummary(data(skill('훈련 일지'),skill('아르고 호의 가호')));
  assert.deepEqual(summary.map(s=>s.name), ['훈련 일지','아르고 호의 가호']);
  assert.deepEqual(summary.map(s=>[s.effects.attack,s.effects.magic,s.effects.allStat,s.effects.bossDamage]),
    [[40,40,80,40],[5,5,10,20]]);
  assert.deepEqual(summary.map(s=>s.effects.ignoreDefenseSources), [[40],[10]]);
  assert.ok(summary.every(s=>s.includedInBaseline));
});

test('이벤트·패시브 설명 때문에 API 최종 능력치에 공격력·올스탯을 중복 가산하지 않는다', () => {
  const input = {
    character: { character_level: 280, character_class: '히어로' },
    mainStat: 'STR', subStat: 'DEX', attackType: 'attack', doping: null,
    presetPolicy: { mode: 'active' }, equipmentData: { item_equipment: [] },
    setEffectData: {}, symbolData: {}, hyperStatData: {}, hexaStatData: {}, abilityData: {},
    statData: { final_stat: Object.entries({ STR: 10000, DEX: 2500, 공격력: 2000,
      데미지: 100, '보스 몬스터 데미지': 300, '크리티컬 데미지': 80, '방어율 무시': 96,
      'AP 배분 STR': 1000, 'AP 배분 DEX': 4,
    }).map(([stat_name,value])=>({stat_name,stat_value:String(value)})) },
  };
  const before = calculateCharacterPotentialConversion(input);
  const after = calculateCharacterPotentialConversion({...input,skillData:data(
    skill('스파이더 인 미러'),skill('크레스트 오브 더 솔라'),skill('에르다 퍼미에이션'),
    skill('쓸만한 홀리 파운틴'),skill('훈련 일지'),skill('아르고 호의 가호'),
  )});
  assert.deepEqual(after.statEquivalence, before.statEquivalence);
  for (const key of ['baseMain','rawAttack','currentAttack','currentBossDamage','currentIgnoreDefense']) {
    assert.equal(after.details[key], before.details[key], key);
  }
});

test('습득하지 않은 스킬의 설명은 버프나 패시브 내역으로 반영하지 않는다', () => {
  assert.deepEqual(cycle({...skill('메이플월드 여신의 축복'),skill_level:0}).applied, []);
  assert.deepEqual(characterBaselineSkillSummary(data({...skill('에르다 퍼미에이션'),skill_level:0})), []);
});

test('새 패시브가 확인된 스파이더·크레스트는 보스 공격 점유율에서 제외한다', () => {
  const channels = generalizedBattlePracticeDamageChannelsFromSkills({
    skillData: data(skill('스파이더 인 미러'),skill('크레스트 오브 더 솔라'),
      {skill_name:'주력기',skill_effect:'MP 20 소비, 최대 3명의 적을 100%의 데미지로 4번 공격, 몬스터 방어율 20% 추가 무시'}),
    profile: {sampleCount:1,skillShares:[
      {source:'주력기',weight:0.5}, {source:'스파이더 인 미러',weight:0.25},
      {source:'크레스트 오브 더 솔라',weight:0.25},
    ]},
  });
  const model = composeCombatModel({damageChannels:channels});
  assert.equal(model.damageChannels.find(c=>c.source==='직업 공통 연무장 일반 공격군').weight, 0);
  assert.equal(model.damageChannels.find(c=>c.source==='주력기').weight, 1);
});
