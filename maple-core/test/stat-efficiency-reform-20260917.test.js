import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateCharacterPotentialConversion,
  calculateConditionalLinkCycleBonuses,
  calculateActiveSkillCycleBonuses,
  equipmentSoulOptionLines,
  selectedBuffDurationPercent,
} from 'maple-core/stat-efficiency';
import { FULL_BOSS_DOPING } from 'maple-core/stat-profile';

function input(overrides = {}) {
  return {
    character: { character_level: 280, character_class: '히어로' },
    mainStat: 'STR', subStat: 'DEX', attackType: 'attack', doping: null,
    presetPolicy: { mode: 'active' },
    statData: { final_stat: Object.entries({ STR: 10000, DEX: 2500, 공격력: 2260,
      데미지: 100, '보스 몬스터 데미지': 300, '크리티컬 데미지': 80,
      '방어율 무시': 96, 'AP 배분 STR': 1000, 'AP 배분 DEX': 4,
    }).map(([stat_name, value]) => ({ stat_name, stat_value: String(value) })) },
    equipmentData: { item_equipment: [] }, setEffectData: {}, symbolData: {},
    hyperStatData: {}, hexaStatData: {}, abilityData: {}, ...overrides,
  };
}
const soul = {
  item_equipment_slot: '무기', soul_active: '1', soul_pad: '20', soul_mad: '0',
  soul_option: '공격력 +3%', soul_potential_grade: '레전드리',
  soul_potential_amplified_grade: 2,
  soul_potential_option_1: '공격력 +4%', soul_potential_option_2: '공격력 +3%',
  soul_potential_option_3: '공격력 +3%',
};

test('공식 API 소울 기본 옵션과 증폭 세 줄을 반영하며 최종 공격력은 중복 가산하지 않는다', () => {
  const result = calculateCharacterPotentialConversion(input({equipmentData:{item_equipment:[soul]}}));
  assert.equal(result.details.attackPercent, 13);
  assert.equal(result.details.rawAttack, 2001); // 최종 스탯의 소수 버림을 고려한 기존 올림 역산
  assert.equal(result.details.currentAttack, 2260);
  assert.deepEqual(equipmentSoulOptionLines({...soul,soul_active:'0'}), []);
  assert.deepEqual(equipmentSoulOptionLines({soul_option:'공격력 +3%'}), ['공격력 +3%']);
});

test('동일한 제로 양손 무기의 소울·증폭 잠재는 한 번만 반영한다', () => {
  const result = calculateCharacterPotentialConversion(input({
    character:{character_level:280,character_class:'제로'},
    equipmentData:{item_equipment:[{...soul,item_equipment_part:'태도'},
      {...soul,item_equipment_slot:'보조무기',item_equipment_part:'대검'}]},
  }));
  assert.equal(result.details.attackPercent,13);
});

test('소울만 다른 장비 프리셋의 공퍼와 상시 공격력 차이를 반영한다', () => {
  const inactive={...soul,soul_active:'0'};
  const result=calculateCharacterPotentialConversion(input({
    presetPolicy:{mode:'auto'},
    equipmentData:{preset_no:1,item_equipment:[inactive],item_equipment_preset_1:[inactive],item_equipment_preset_2:[soul]},
  }));
  assert.equal(result.details.attackPercent,13);
  assert.equal(result.details.rawAttack,2280);
  assert.equal(result.details.currentAttack,2576);
});

test('개편된 무아·전투의 흐름은 중첩 없이 공식 API 수치를 사용한다', () => {
  const links={character_link_skill:[
    {skill_name:'무아',skill_effect:'전투 상태에 돌입 시 데미지 16% 증가, 지속시간 10초'},
    {skill_name:'전투의 흐름',skill_effect:'10초 동안 데미지 15% 증가'},
  ]};
  assert.equal(calculateConditionalLinkCycleBonuses(links).damage,31);
  const result=calculateCharacterPotentialConversion(input({linkSkillData:links,doping:FULL_BOSS_DOPING}));
  assert.equal(result.details.conditionalLinkDamage,31);
  assert.equal(result.details.currentDamage,100);
});

test('이전 중첩형 링크 스냅샷도 그대로 해석한다', () => {
  assert.equal(calculateConditionalLinkCycleBonuses({character_link_skill:[
    {skill_name:'무아',skill_effect:'발동 시 데미지 1%, 중첩당 데미지 2%, 최대 5회 중첩'},
    {skill_name:'전투의 흐름',skill_effect:'각 중첩당 데미지 4%, 최대 4회 중첩'},
  ]}).damage,27);
});

test('전수 소울 컨트랙트에는 벞지를 적용하고 발동형 시프 커닝은 기본 지속시간을 쓴다', () => {
  const links = { character_link_skill: [
    { skill_name: '소울 컨트랙트', skill_effect: '10초 동안 데미지 60% 증가\n재사용 대기시간 60초' },
    { skill_name: '시프 커닝', skill_effect: '10초 동안 데미지 27% 증가 재발동 대기시간 20초' },
  ] };
  assert.equal(calculateConditionalLinkCycleBonuses(links).damage, 23.5);
  const parameters = input({ linkSkillData: links, doping: FULL_BOSS_DOPING });
  parameters.statData.final_stat.push({ stat_name: '버프 지속시간', stat_value: '100' });
  const result = calculateCharacterPotentialConversion(parameters);
  const [soul, cunning] = result.details.conditionalLinkSources;
  assert.equal(soul.uptime, 1 / 3);
  assert.ok(soul.damageCoverage > soul.uptime);
  assert.equal(soul.damage, 60 * soul.damageCoverage);
  assert.equal(cunning.damage, 13.5);
  assert.equal(result.details.conditionalLinkDamage, soul.damage + cunning.damage);
});

test('렌의 조건부 링크와 장착 일격필살, 만렙 어센틱심볼을 보스 환산에 포함한다', () => {
  const parameters = input({
    character: { character_level: 296, character_class: '렌' },
    symbolData: { symbol: [
      { symbol_name: '어센틱심볼 : 세르니움', symbol_level: 10 },
      { symbol_name: '어센틱심볼 : 오디움', symbol_level: 11 },
      { symbol_name: '그랜드 어센틱심볼 : 기어드락', symbol_level: 11 },
    ] },
    vMatrixData: { character_v_core_equipment: [
      { v_core_name: '일격필살 I', v_core_type: '특수 코어', v_core_level: 1 },
    ] },
    linkSkillData: { character_link_skill: [
      { skill_name: '소울 컨트랙트', skill_effect: '10초 동안 데미지 60% 증가\n재사용 대기시간 60초' },
      { skill_name: '프라이어 프리퍼레이션', skill_effect: '20초 동안 데미지 17% 증가 재발동 대기시간 40초' },
    ] },
  });
  parameters.statData.final_stat.push({ stat_name: '버프 지속시간', stat_value: '76' });
  const convert = (doping) => calculateCharacterPotentialConversion({ ...parameters, doping });
  const full = convert(FULL_BOSS_DOPING).details;
  assert.ok(Math.abs(full.conditionalLinkSources[0].damage - 37.53) < 0.02);
  assert.equal(full.conditionalLinkSources[1].damage, 17 * 0.55579);
  const effects = full.combatModel.effects;
  assert.equal(effects.find(({ kind }) => kind === 'special-core').averagedModifiers.damage, 9.683);
  const symbols = effects.filter(({ kind }) => kind === 'boss-symbol');
  assert.equal(symbols.length, 1);
  assert.equal(symbols[0].source, '어센틱심볼 : 오디움');
  assert.equal(symbols[0].averagedModifiers.bossDamage, 20);
  assert.equal(full.combatModel.totals.bossDamage, 300 + 55 + 20);
  assert.equal(convert(null).details.combatModel.totals.bossDamage, 300);
  for (const [symbol, bonus] of [
    [[{ symbol_name: '어센틱심볼 : 세르니움', symbol_level: 10 },
      { symbol_name: '아케인심볼 : 소멸의 여로', symbol_level: 20 }], 0],
    [[{ symbol_name: '그랜드 어센틱심볼 : 기어드락', symbol_level: 11 }], 20],
  ]) {
    const result = calculateCharacterPotentialConversion({
      ...parameters, symbolData: { symbol }, doping: FULL_BOSS_DOPING,
    });
    assert.equal(result.details.combatModel.totals.bossDamage, 300 + 55 + bonus);
  }
});

test('선택 프리셋의 벞지는 어빌리티와 유니온 설정 차이만 더한다', () => {
  const active = {
    abilityData: { ability_info: [{ ability_value: '버프 스킬의 지속 시간 50% 증가' }] },
    unionRaiderData: { union_state_stat: ['버프 지속시간 15% 증가', '소환수 지속시간 20% 증가'] },
  };
  const selected = {
    abilityData: { ability_info: [{ ability_value: '보스 몬스터 공격 시 데미지 20% 증가' }] },
    unionRaiderData: { union_state_stat: ['버프 지속시간 20% 증가'] },
  };
  assert.equal(selectedBuffDurationPercent(100, active, selected), 55);
});

test('주기 평균에서 전투 종료 이후의 버프 지속시간을 제외한다', () => {
  const skills = [{ character_skill: [{
    skill_name: '다크 레조넌스',
    skill_level: 30,
    skill_effect: '31초 동안 보스 몬스터 공격 시 데미지 15% 증가\n재사용 대기시간 70초',
  }] }];
  const result = calculateActiveSkillCycleBonuses(skills, 'attack', 360);
  assert.equal(result.applied[0].uptime, (31 * 5 + 10) / 360);
});

test('어빌리티 아래 두 줄 레전드리의 프리셋 차이를 등급 제한 없이 반영한다', () => {
  const legendary=values=>values.map((ability_value,i)=>({ability_no:String(i+1),ability_grade:'레전드리',ability_value}));
  const lines=legendary(['보스 몬스터 공격 시 데미지 20% 증가','공격력 30 증가','상태 이상에 걸린 대상 공격 시 데미지 10% 증가']);
  const result=calculateCharacterPotentialConversion(input({
    doping:FULL_BOSS_DOPING,presetPolicy:{mode:'auto'},
    abilityData:{preset_no:1,ability_info:[],ability_preset_1:{ability_info:[]},ability_preset_2:{ability_preset_grade:'레전드리',ability_info:lines}},
  }));
  assert.equal(result.details.currentBossDamage,320);
  assert.equal(result.details.currentAttack,2290);
  assert.equal(result.details.currentConditionalDamage,10);
});

// 2026-09-19 넥슨 character/skill 응답. 캐릭터 식별 정보는 포함하지 않는다.
const grandis='HP 100 소비, 40초 동안 지속\n노바 : 스킬 사용 시 최대 6회까지 재사용 대기시간 미적용\n최종 데미지 12% 증가\n레프 : 최종 데미지 15% 증가\n아니마 : 최종 데미지 13% 증가\n호영은 천/지/인 속성 도술의 최종 데미지 15% 증가, 라라는 용맥의 메아리 발동 시 최종 데미지 증가량 11%로 증가, 렌은 매화검 절기, 망혼검 절기, 창룡파천검의 최종 데미지 15% 증가\n재사용 대기시간 120초\n[패시브 효과 : 카이저는 데미지 15% 증가]';
test('개편 그란디스는 종족별 최종 데미지를 읽고 삭제된 레프 장비 공마 전환을 적용하지 않는다', () => {
  for(const [characterClass,finalDamage] of [['카이저',12],['아델',15],['라라',13],['호영',13],['렌',13]]){
    const result=calculateActiveSkillCycleBonuses([{character_skill:[{skill_name:'그란디스 여신의 축복',skill_effect:grandis}]}],'attack',360,
      {characterClass,equipmentData:{item_equipment:[{item_equipment_slot:'모자',item_total_option:{magic_power:'500'}}]}});
    assert.equal(result.flatAttack,0);
    assert.equal(result.damage,0);
    assert.equal(result.applied[0].finalDamage,finalDamage);
  }
});

test('개편 파이렛 플래그 VI의 개인 효과와 크리티컬 데미지를 함께 반영한다', () => {
  const result=calculateActiveSkillCycleBonuses([{character_skill:[{skill_name:'파이렛 플래그 VI',skill_effect:'MP 500 소비, 60초 동안 자신의 AP를 직접 투자한 모든 능력치 55% 증가 및 몬스터 방어율 무시 25% 증가, 공격력 30 증가, 크리티컬 데미지 10% 증가'}]}],'attack',360,{characterClass:'캡틴',apStats:{DEX:1000}});
  assert.equal(result.criticalDamage,10);
  assert.equal(result.flatAttack,30);
  assert.equal(result.baseFlat.DEX,550);
  assert.deepEqual(result.ignoreDefenseSources,[25]);
});
