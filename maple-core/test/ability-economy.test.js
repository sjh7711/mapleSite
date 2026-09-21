import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAbilityOptimalStrategy as calculate, chooseAbilityEconomicAction, chooseAbilityAbyssResult } from '../src/ability.js';
import { compareAbilityVectors, economicValueRoll } from '../src/ability-economy.js';
const close=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<Math.max(1,Math.abs(b))*t,`${a} != ${b}`);
const targets=[{type:'cooldown-skip',minimum:20,grade:'legendary'},{type:'boss-damage',minimum:20,grade:'legendary'},{type:'abnormal-damage',minimum:10,grade:'legendary'}];
const options={targets,useAdvanced:true,comparePlacements:true,swapLower:true,honorPricePer5000:3000000};
const zero=()=>Array(9).fill(0), add=(a,b,p=1)=>a.map((v,i)=>v+b[i]*p);
let advanced;

test('비용은 명성치 환산액과 직접 메소의 합이며 보유 서큘레이터는 무료다',()=>{
  advanced=calculate({...options,abyssCount:40});
  assert.equal(advanced.error,null);
  assert.equal(advanced.objective,'meso');
  assert.equal(advanced.strategyMode,'economic-adaptive');
  close(advanced.expectedHonorMeso,advanced.expectedHonor*600);
  close(advanced.expectedTotalMeso,advanced.expectedHonorMeso+advanced.expectedMeso);
  assert.ok(advanced.expectedCirculators.abyss>0 && advanced.expectedCirculators.abyss<=40);
  close(advanced.expectedTotalMeso,72244546450.48477,1e-6);
  const guide=advanced.steps[0].economicGuide;
  for(const pair of guide.pairs){
    assert.deepEqual(pair.targets.map(t=>`${t.type}:${t.grade}:${t.minimum}`).sort(),targets.map(t=>`${t.type}:${t.grade}:${t.minimum}`).sort());
    pair.keepMasks.forEach((k,m)=>assert.equal(k&~m,0));
  }
  assert.ok(JSON.stringify(advanced).length<1e6);
});

test('0개와 미허용을 지키고 숫자가 높은 아랫줄을 먼저 잠그는 경로를 비교한다',()=>{
  const none=calculate({...options,abyssCount:0});
  const disabled=calculate({...options,abyssCount:40,allowAbyss:false});
  assert.equal(none.expectedCirculators.abyss,0);
  close(disabled.expectedTotalMeso,none.expectedTotalMeso);
  assert.ok(advanced.expectedTotalMeso<none.expectedTotalMeso);
  assert.ok(none.expectedHonor<250000000);
  const rules=none.steps[0].economicGuide.start.decisions;
  assert.equal(rules.find(r=>r.found===1 && r.values[0]===20).keep,1);
  assert.equal(rules.find(r=>r.found===1 && r.values[0]===15).keep,0);
});

test('일반 재설정은 블서큘을 사용하고 심서큘을 배제한다',()=>{
  const normalTargets=[{type:'boss-damage',minimum:20,grade:'legendary'},{type:'abnormal-damage',minimum:8,grade:'unique'},{type:'critical',minimum:20,grade:'unique'}];
  const settings={targets:normalTargets,honorPricePer5000:3000000,blackCount:20,abyssCount:40};
  const r=calculate(settings), none=calculate({...settings,blackCount:0});
  assert.equal(r.error,null);
  assert.equal(r.expectedCirculators.abyss,0);
  assert.ok(r.expectedCirculators.black>0 && r.expectedCirculators.black<=20);
  close(r.expectedTotalMeso,r.expectedHonor*600);
  assert.ok(r.expectedHonor<none.expectedHonor);
  close(r.expectedHonor,30987816.4642,1e-6);
  const half=calculate({...settings,halfHonor:true});
  close(half.expectedHonor,r.expectedHonor/2);
  close(half.expectedCirculators.black,r.expectedCirculators.black);
  const free=calculate({...settings,honorPricePer5000:0});
  assert.equal(free.expectedTotalMeso,0);
});

test('가격 변경은 후보 비교에 적용되고 반값은 명성치 단가 절반과 같은 정책이다',()=>{
  const settings={...options,targets:[{type:'passive-level',minimum:1,grade:'legendary'},...targets.slice(1)],abyssCount:40};
  const low=calculate({...settings,honorPricePer5000:0});
  const high=calculate({...settings,honorPricePer5000:30000000});
  assert.ok(low.expectedMeso<=high.expectedMeso+1);
  assert.ok(high.expectedHonor<=low.expectedHonor+1);
  assert.ok(low.expectedMeso<high.expectedMeso-1);
  assert.ok(high.expectedHonor<low.expectedHonor-1);
  close(low.expectedTotalMeso,low.expectedMeso);
  close(high.expectedTotalMeso,high.expectedHonor*6000+high.expectedMeso);
  const half=calculate({...options,abyssCount:5,halfHonor:true});
  const cheaper=calculate({...options,abyssCount:5,honorPricePer5000:1500000});
  close(half.expectedHonor*2,cheaper.expectedHonor);
  close(half.expectedMeso,cheaper.expectedMeso);
  close(half.expectedTotalMeso,cheaper.expectedTotalMeso);
});

function referenceRoll(states,values,method,price){
  return states.map((old,i)=>{
    let total=zero();
    states.forEach((proposed,j)=>{
      if(method==='advanced' && i===j)return;
      const picked=compareAbilityVectors(values[j],values[i],price)<0?j:i;
      const p=proposed.probability/(method==='advanced'?1-old.probability:1);
      total=add(total,values[picked],p);
    });
    total[method==='advanced'?7:5]++;
    return total;
  });
}
test('전체 결과 유지/교체의 누적 합 계산은 독립 이중 합과 일치한다',()=>{
  const states=[{probability:.1},{probability:.25},{probability:.65}];
  const values=[[2000,900000,0,1,0,0,0,0,0],[3000,100,1,0,0,0,0,0,0],[0,0,0,0,0,0,0,0,0]];
  for(const method of ['honor','advanced'])for(const price of [0,3000000,100000000]){
    const api={method,itemIndex:method==='honor'?5:7,compare:(a,b)=>compareAbilityVectors(a,b,price)};
    const actual=economicValueRoll(states,values,api), expected=referenceRoll(states,values,method,price);
    actual.forEach((v,i)=>v.forEach((n,j)=>close(n,expected[i][j])));
  }
  const fixed=economicValueRoll([{probability:1}],[values[0]],{method:'advanced',itemIndex:7,compare:(a,b)=>compareAbilityVectors(a,b,3000000)})[0];
  close(fixed[0],values[0][0]);close(fixed[1],values[0][1]);assert.equal(fixed[7],1);
});

test('첫 줄 확보 후에도 잔여 재고를 이어 쓰는 정책을 독립 유한 DP로 검증한다',()=>{
  const r=calculate({...options,abyssCount:5});
  const pair=r.steps[0].economicGuide.pairs[0], price=3000000;
  const same=pair.firstOptions.find(e=>e.type===pair.targets[0].type);
  const other=pair.firstOptions.find(e=>e.type==='attack');
  const model=pair.models[other.profile];
  const compare=(a,b)=>compareAbilityVectors(a,b,price);
  let previousFull, previousOther;
  for(let n=0;n<=5;n++){
    const fullRoll=n?referenceRoll(pair.full.states,previousFull,'advanced',price):null;
    const full=pair.full.states.map((s,i)=> !n || compare(pair.terminal[s.mask],fullRoll[i])<=0 ? pair.terminal[s.mask] : fullRoll[i]);
    const otherRoll=n?referenceRoll(model.states,previousOther,'advanced',price):null;
    const actualOther=model.states.map((s,i)=>{
      let acquire=zero();
      for(const [v,p] of same.values){
        const index=pair.full.states.findIndex(f=>f.values[0]===v&&f.values[1]===s.values[1]&&f.values[2]===s.values[2]);
        acquire=add(acquire,full[index],p);
      }
      const attempts=(1-other.weight*other.values[s.values[0]][1])/same.weight;
      acquire=add(acquire,[40000,15000000,0,1,0,0,0,0,0],attempts);
      let best=compare(acquire,pair.terminal[s.mask])<0?acquire:pair.terminal[s.mask];
      let action=best===acquire?'acquire':'direct';
      if(n && compare(otherRoll[i],best)<0){best=otherRoll[i];action='roll';}
      const actual=chooseAbilityEconomicAction(pair,other.type,[other.values[s.values[0]][0],...s.values.slice(1)],n);
      assert.equal(actual.action,action);
      return best;
    });
    if(n===5){
      full.forEach((v,i)=>v.forEach((x,j)=>close(x,pair.full.stateValues[i][j])));
      actualOther.forEach((v,i)=>v.forEach((x,j)=>close(x,model.stateValues[i][j])));
    }
    previousFull=full;previousOther=actualOther;
  }
  assert.equal(chooseAbilityEconomicAction(pair,'unknown',[1,1,1]),null);
  assert.equal(chooseAbilityEconomicAction(pair,other.type,[null,1,1]),null);
  const done=chooseAbilityEconomicAction(pair,same.type,pair.targets.map(t=>t.minimum),5);
  assert.equal(done.action,'direct');assert.equal(done.mask,7);
  const helper={...pair.full,maximumUses:5,keepMasks:pair.keepMasks};
  const best=pair.targets.map(t=>t.minimum), worst=pair.full.states.find(s=>s.mask===0)?.values;
  if(worst)assert.equal(chooseAbilityAbyssResult(helper,worst,best,0).apply,true);
});
