import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAbilityEconomicCandidate, calculateAbilityPracticalCandidate, compareAbilityVectors } from '../src/ability-economy.js';
import { calculateAbilityOptimalStrategy as calculate } from '../src/ability.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<=Math.max(1,Math.abs(b))*1e-8,`${a} != ${b}`);
const targets=['a','b','c'].map(type=>({type,grade:'legendary',minimum:2}));
function apiFor(price,count=6){
 return {method:'advanced',itemMethod:'abyss',itemIndex:7,count,abyssPrice:price,
 compare:(a,b)=>compareAbilityVectors(a,b,5000,price),
 options:['a','b','c','d'].map(id=>({id,label:id})),values:()=>[[1,.4],[2,.6]],weight:()=>1,
 shortName:t=>t.type,unit:()=>'',describe:t=>t.type,resetCost:()=>[10,2,0,1,0,0,0,0,0],plan:()=>({}),
 vector:(_,mask)=>[[700,500,320,210,400,250,110,0][mask],0,0,0,0,0,0,0,0],guide:(_,__,mask)=>({mask})};
}
test('심서큘 가치는 사용 개수에 적용하고 비교 순위를 바꾼다',()=>{
 const using=[1,0,0,0,0,0,0,2,0],none=[100,0,0,0,0,0,0,0,0];
 assert.ok(compareAbilityVectors(using,none,5000,0)<0);
 assert.ok(compareAbilityVectors(using,none,5000,100)>0);
});
test('재사용한 DP로 고른 사용 한도는 모든 한도를 별도 계산한 최소값과 일치한다',()=>{
 for(const price of [1,50,50000]){
  const api=apiFor(price), actual=calculateAbilityPracticalCandidate({targets},api);
  const brute=[];
  for(const practicalMode of ['all','lower'])for(let count=0;count<=api.count;count++)brute.push(calculateAbilityEconomicCandidate({targets},{...api,count,practicalMode}));
  brute.sort((a,b)=>api.compare(a.vector,b.vector));
  actual.vector.forEach((v,i)=>close(v,brute[0].vector[i]));
  assert.ok(actual.vector[7]<=actual.guide.count+1e-9);
  assert.ok(actual.guide.count<=api.count);
  assert.equal(actual.guide.availableCount,api.count);
  if(price===50000){assert.equal(actual.guide.count,0);assert.equal(actual.vector[7],0);}
  for(const pair of actual.guide.pairs){assert.equal(pair.count,actual.guide.count);assert.ok(!pair.full.levels);}
 }
});
test('보스용2의 실전 안내도 일반 재설정 후보와 비교한다',()=>{
 const settings={targets:[{type:'boss-damage',minimum:20,grade:'legendary'},{type:'abnormal-damage',minimum:8,grade:'unique'},{type:'critical',minimum:20,grade:'unique'}],
  honorPricePer5000:3000000,abyssPrice:220000000,abyssCount:0,blackCount:20,includePractical:true,comparePlacements:true,swapLower:true};
 const ordinary=calculate({...settings,useAdvanced:false}),allowed=calculate({...settings,useAdvanced:true});
 assert.ok(allowed.practicalStrategy.expectedTotalMeso<=ordinary.practicalStrategy.expectedTotalMeso+1);
 assert.equal(allowed.practicalStrategy.advancedUnnecessary,true);
 assert.equal(allowed.practicalStrategy.steps[0].method,'honor');
 assert.equal(allowed.practicalStrategy.expectedAdvancedResets,0);
 close(allowed.practicalStrategy.expectedTotalMeso,allowed.practicalStrategy.expectedHonorMeso+allowed.practicalStrategy.expectedMeso+allowed.practicalStrategy.expectedAbyssMeso);
 assert.equal(allowed.practicalStrategy.expectedCirculators.abyss,0);
});
