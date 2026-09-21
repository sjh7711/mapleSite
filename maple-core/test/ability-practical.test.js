import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAbilityEconomicCandidate, economicValueRoll, compareAbilityVectors } from '../src/ability-economy.js';
const zero=()=>Array(9).fill(0),add=(a,b,p=1)=>a.map((v,i)=>v+b[i]*p);
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8*Math.max(1,Math.abs(b)),`${a} != ${b}`);
function reference(states, previous, ranks, method) {
 return states.map((old,i)=>{
  let value=zero();
  states.forEach((next,j)=>{
   if(method==='advanced' && i===j)return;
   const selected=ranks[j]<ranks[i]?j:i;
   value=add(value,previous[selected],next.probability/(method==='advanced'?1-old.probability:1));
  });
  value[method==='advanced'?7:5]++;
  return value;
 });
}
test('실전 유지 규칙은 같은 우선순위에서 기존 세 줄 전체를 유지한다',()=>{
 const states=[{probability:.2},{probability:.3},{probability:.5}], ranks=[1,1,0];
 const values=[[10,2,0,0,0,0,0,0,0],[1,9,0,0,0,0,0,0,0],zero()];
 for(const method of ['honor','advanced']){
  const result=economicValueRoll(states,values,{method,itemIndex:method==='honor'?5:7},ranks);
  const expected=reference(states,values,ranks,method);
  result.forEach((v,i)=>v.forEach((x,k)=>close(x,expected[i][k])));
 }
});
for(const method of ['honor','advanced'])for(const practicalMode of ['all','lower'])for(const count of [0,4]){
 test(`${method}/${practicalMode}/${count}: 고정 순위·종료·재고·첫 줄 확보 비용은 독립 상태 전이와 일치`,()=>{
  const targets=['a','b','c'].map((type,i)=>({type,grade:method==='honor' && i?'unique':'legendary',minimum:2}));
  const reset=[10,2,method==='honor'?1:0,method==='advanced'?1:0,0,0,0,0,0];
  const api={method,practicalMode,count,itemMethod:method==='honor'?'black':'abyss',itemIndex:method==='honor'?5:7,
   compare:(a,b)=>compareAbilityVectors(a,b,3000000),
   options:['a','b','c','d'].map(id=>({id,label:id})),values:()=>[[1,.4],[2,.6]],weight:()=>1,
   shortName:t=>t.type,unit:()=>'',describe:t=>t.type,resetCost:()=>reset,plan:()=>({}),
   vector:(_,mask)=>[ [700,500,320,210,400,250,110,0][mask],0,0,0,0,0,0,0,0],guide:(_,__,mask)=>({mask})};
  const candidate=calculateAbilityEconomicCandidate({targets},api);
  for(const pair of candidate.guide.pairs){
   const focus=pair.practical.focusMask;
   function verify(model, other=false){
    const ranks=model.states.map(s=>pair.practical.maskOrder.indexOf(s.mask&focus));
    let previous;
    for(let n=0;n<=count;n++){
     const roll=n?reference(model.states,previous,ranks,method):null;
     const next=model.states.map((s,i)=>!n || (s.mask&focus)===focus?pair.terminal[s.mask]:roll[i]);
     if(n===count)next.forEach((v,i)=>v.forEach((x,k)=>close(x,model.stateValues[i][k])));
     previous=next;
    }
    const itemIndex=api.itemIndex;
    model.stateValues.forEach((v,i)=>{
     assert.ok(v[itemIndex]>=-1e-9 && v[itemIndex]<=count+1e-9);
     if((model.states[i].mask&focus)===focus)close(v[itemIndex],0);
    });
   }
   verify(pair.full);
   if (!count) continue;
   for(const entry of pair.firstOptions.filter(e=>e.type!==pair.targets[0].type)){
    const model=pair.models[entry.profile];
    if(practicalMode==='lower'){verify(model,true);continue;}
    const first=pair.firstOptions.find(e=>e.type===pair.targets[0].type);
    model.states.forEach((s,i)=>{
     let expected=zero();
     for(const [value,p] of first.values){
      const j=pair.full.states.findIndex(t=>t.values[0]===value&&t.values[1]===s.values[1]&&t.values[2]===s.values[2]);
      expected=add(expected,pair.full.stateValues[j],p);
     }
     const attempts=(method==='advanced'?1-entry.weight*entry.values[s.values[0]][1]:1)/first.weight;
     expected=add(expected,reset,attempts);
     expected.forEach((x,k)=>close(x,model.stateValues[i][k]));
     assert.equal(model.actionBands[0].actions[i],'direct');
     assert.equal(model.actionBands.at(-1).actions[i],'acquire');
    });
   }
  }
 });
}
