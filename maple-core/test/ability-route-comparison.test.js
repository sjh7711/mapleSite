import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAbilityEconomicCandidate, calculateAbilityPracticalCandidate, calculateAbilityCappedReferenceCandidate,
  evaluateAbilityPolicyAtCap, compareAbilityVectors, abilityPhaseMetrics } from '../src/ability-economy.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(b)),`${a} != ${b}`);
const zero=()=>Array(13).fill(0);
const add=(a,b,p=1)=>a.map((v,i)=>v+p*(b[i]??0));
const targets=['a','b','c'].map(type=>({type,grade:'legendary',minimum:2}));
function apiFor(count,price=20){
 return {method:'advanced',itemMethod:'abyss',itemIndex:7,count,abyssPrice:price,
 compare:(a,b)=>compareAbilityVectors(a,b,5000,price),
 options:['a','b','c','d'].map(id=>({id,label:id})),values:()=>[[1,.4],[2,.6]],weight:()=>1,
 shortName:t=>t.type,unit:()=>'',describe:t=>t.type,resetCost:()=>[10,2,0,1,0,0,0,0,0],plan:()=>({}),
 vector:(_,mask)=>[[700,500,320,210,400,250,110,0][mask],0,0,0,0,0,0,0,0],guide:(_,__,mask)=>({mask})};
}
test('고정한 무제한 선택 규칙의 유한 평가와 소진 지표는 독립 이중합과 일치한다',()=>{
 const states=[{probability:.2,mask:0},{probability:.3,mask:1},{probability:.5,mask:7}];
 const reference={policyBands:[{ranks:[2,1,0]}],actionBands:[{actions:['roll','roll','direct']}]};
 const terminal=s=>[s.mask===7?0:s.mask===1?40:100,s.mask===7?0:12,0,0,0,0,0,0,0];
 for(const method of ['advanced','honor'])for(const count of [0,1,4]){
  const api={method,itemIndex:method==='advanced'?7:5};
  const actual=evaluateAbilityPolicyAtCap(states,count,api,reference,terminal);
  let previous=states.map(s=>{const v=[...terminal(s),0,0,0,0];if(s.mask===7)v[9]=1;else{v[10]=1;v[11]=v[0];v[12]=v[1];}return v;});
  for(let n=1;n<=count;n++)previous=states.map((old,i)=>{
   if(old.mask===7){const v=zero();v[9]=1;return v;}
   let v=zero();
   states.forEach((next,j)=>{if(method==='advanced'&&i===j)return;const chosen=j>i?j:i;v=add(v,previous[chosen],next.probability/(method==='advanced'?1-old.probability:1));});
   v[api.itemIndex]++;return v;
  });
  actual.stateValues.forEach((v,i)=>v.forEach((x,k)=>close(x,previous[i][k])));
  actual.stateValues.forEach(v=>{close(v[9]+v[10],1);assert.ok(v[api.itemIndex]<=count+1e-9);close(v[0],v[11]);close(v[1],v[12]);});
 }
});
test('무제한 경로를 제한할 때 확보 순서와 수치별 잠금 규칙을 재최적화하지 않는다',()=>{
 const api=apiFor(4), unlimited=calculateAbilityEconomicCandidate({targets},{...api,count:1,stationary:true});
 const bounded=calculateAbilityCappedReferenceCandidate({targets},api);
 assert.deepEqual(bounded.guide.start,unlimited.guide.start);
 assert.deepEqual(bounded.guide.one,unlimited.guide.one);
 bounded.guide.pairs.forEach(p=>{
  const source=unlimited.guide.pairs.find(s=>s.pairMask===p.pairMask);
  assert.deepEqual(p.full.policyBands,source.full.policyBands);
  assert.deepEqual(p.full.actionBands.at(-1).actions,source.full.actionBands[0].actions);
  for(const [profile,m] of Object.entries(p.models)){
   assert.deepEqual(m.policyBands,source.models[profile].policyBands);
   assert.deepEqual(m.actionBands.at(-1).actions,source.models[profile].actionBands[0].actions);
  }
 });
 assert.ok(bounded.vector[7]<=4);
 close(bounded.vector[9]+bounded.vector[10],1);
 assert.ok(api.compare(bounded.vector,unlimited.vector)>=-1e-6);
 const stats=abilityPhaseMetrics(bounded,5000);
 close(stats.exhaustionMesoContribution,bounded.vector[11]+bounded.vector[12]);
 assert.ok(stats.exhaustionMesoContribution<=bounded.vector[0]+bounded.vector[1]+1e-8);
});
test('실전 진단 지표를 계산해도 기존 경로와 총비용은 변하지 않는다',()=>{
 for(const count of [0,4])for(const price of [0,20,50000]){
  const api=apiFor(count,price), old=calculateAbilityPracticalCandidate({targets},api), tracked=calculateAbilityPracticalCandidate({targets},{...api,trackOutcomes:true});
  old.vector.forEach((v,i)=>close(v,tracked.vector[i]));
  assert.equal(old.guide.count,tracked.guide.count);
  assert.deepEqual(old.guide.start,tracked.guide.start);
  const stats=abilityPhaseMetrics(tracked,5000);
  if(!tracked.guide.count){assert.equal(stats.phaseSuccessProbability,null);assert.equal(stats.exhaustionMesoContribution,0);}
  else{close(tracked.vector[9]+tracked.vector[10],1);assert.ok(stats.exhaustionMesoContribution<=tracked.vector[0]+tracked.vector[1]+1e-8);}
 }
});
test('재고가 없으면 무제한 비교 경로를 사용 가능한 경로로 내놓지 않는다',()=>{
 assert.equal(calculateAbilityCappedReferenceCandidate({targets},apiFor(0)),null);
});
test('매우 큰 재고는 모든 상태의 수렴과 잔여 소진 비용을 확인한 뒤 계산을 줄인다',()=>{
 const api=apiFor(4), unlimited=calculateAbilityEconomicCandidate({targets},{...api,count:1,stationary:true});
 const pair=unlimited.guide.pairs[0];
 const evaluated=evaluateAbilityPolicyAtCap(pair.full.states,1e9,api,pair.full,s=>pair.terminal[s.mask]);
 assert.ok(evaluated.computedUses<2000);
 evaluated.stateValues.forEach((v,i)=>{
  v.slice(0,9).forEach((x,k)=>close(x,pair.full.stateValues[i][k]));
  assert.ok(v[10]<1e-13);assert.ok(v[11]<1e-6);assert.ok(v[12]<1e-6);
 });
});
