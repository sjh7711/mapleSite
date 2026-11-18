import test from "node:test";
import assert from "node:assert/strict";
import { calculateItem } from "../src/calc.js";
import { calculateStarforceExpected } from "maple-core/starforce";
import { sampleStarforce } from "./helpers/starforce-reference-sampler.mjs";
import { varianceHistogram } from "../src/shared/starforce-variance-histogram.js";
import { binomial, negativeBinomialFailures, seededRandom } from "../src/shared/starforce-random.js";
import {
  compileStarforceDistribution, createVarianceSimulation, summarizeVariance,
  varianceBudgetPosition, varianceRequestKey, variancePoint, varianceQuantile,
} from "../src/shared/starforce-variance.js";

function plan(options = {}) {
  return calculateStarforceExpected({ itemLevel: 200, startStar: 12, targetStar: 21,
    replacementPrice: 45e8, event: "shining", mvp: "diamond", ...options });
}
function run(plans, multiplier = 1, count = 30000) {
  const simulation = createVarianceSimulation({ plans, multiplier }, count);
  simulation.step(count);
  return simulation.finish();
}
function moments(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { mean, variance };
}
function close(actual, expected, relative = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= Math.max(1e-8, Math.abs(expected) * relative), `${actual} vs ${expected}`);
}

test("count samplers reproduce binomial and negative-binomial means and variances", () => {
  for (const [n, p] of [[5, 0.1], [100, 0.3], [10000, 0.001], [10000, 0.8], [1e10, 0.15]]) {
    const random = seededRandom(5481);
    const values = Array.from({ length: 30000 }, () => binomial(n, p, random));
    const sampled = moments(values), variance = n * p * (1 - p);
    assert.ok(values.every((v) => Number.isSafeInteger(v) && v >= 0 && v <= n));
    assert.ok(Math.abs(sampled.mean - n * p) < 6 * Math.sqrt(variance / values.length));
    close(sampled.variance, variance, 0.08);
  }
  for (const [successes, p] of [[1, 0.315], [8, 0.1], [25, 0.5], [1000, 0.9], [1e10, 0.15]]) {
    const random = seededRandom(8541);
    const values = Array.from({ length: 30000 }, () => negativeBinomialFailures(successes, p, random));
    const sampled = moments(values), mean = successes * (1 - p) / p, variance = mean / p;
    assert.ok(values.every((v) => Number.isSafeInteger(v) && v >= 0));
    assert.ok(Math.abs(sampled.mean - mean) < 6 * Math.sqrt(variance / values.length));
    close(sampled.variance, variance, 0.08);
  }
});

test("one no-destruction stage has the closed-form geometric variance", () => {
  const p = plan({ startStar: 12, targetStar: 13 });
  const stage = p.stages[0], compiled = compileStarforceDistribution(p);
  close(compiled.mean, stage.cost / stage.success);
  close(compiled.variance, stage.cost ** 2 * (1 - stage.success) / stage.success ** 2);
});

test("guaranteed success is deterministic and has zero variance", () => {
  const p = plan({ startStar: 15, targetStar: 16, event: "shining15", optimize: false });
  const out = run([p], 1, 1000);
  assert.equal(out.standardDeviation, 0);
  assert.equal(out.sampleStandardDeviation, 0);
  assert.equal(out.median, out.mean);
  assert.equal(out.p99, out.mean);
  assert.equal(out.sorted.length, 1000);
  assert.equal(out.meanBooms, 0);
  assert.equal(out.meanSpares, 0);
});

test("all levels, events, discounts and restoration policies retain the existing exact mean", () => {
  for (const itemLevel of [130, 135, 140, 145, 150, 160, 200, 250]) {
    for (const event of ["none", "discount30", "destroy30", "shining", "shining15"]) {
      for (const options of [
        { startStar: 0, targetStar: 10 },
        { startStar: 17, targetStar: 20, optimize: false, restore: [] },
        { startStar: 12, targetStar: 20, optimize: false, restore: [15, 17, 18, 19], destroyPrevention: [16] },
        { startStar: 12, targetStar: itemLevel <= 135 ? 20 : 30 },
        ...(itemLevel <= 135 ? [] : [{ startStar: 24, targetStar: 26, optimize: false, restore: [22] }]),
      ]) {
        const p = plan({ itemLevel, event, mvp: "gold", pc: true, ...options });
        const compiled = compileStarforceDistribution(p);
        close(compiled.mean, p.expectedCost, 1e-9);
        close(compiled.expectedBooms, p.expectedBooms, 1e-8);
        close(compiled.expectedSpares, p.expectedItems, 1e-8);
        assert.ok(Number.isFinite(compiled.variance) && compiled.variance >= 0);
      }
    }
  }
});

test("aggregated samples match the independent chronological sampler for all recovery paths", () => {
  for (const options of [
    { targetStar: 19, optimize: false },
    { startStar: 17, targetStar: 21, optimize: false, destroyPrevention: [17], restore: [18, 19, 20] },
    { startStar: 22, targetStar: 24 },
    { startStar: 23, targetStar: 25, optimize: false, restore: [22] },
  ]) {
    const p = plan(options), compiled = compileStarforceDistribution(p);
    const random = seededRandom(14871);
    const reference = Array.from({ length: 20000 }, () => sampleStarforce(p, random));
    const slow = moments(reference), fast = run([p], 1, 20000);
    const standardError = Math.sqrt(compiled.variance / reference.length);
    assert.ok(Math.abs(slow.mean - compiled.mean) < 6 * standardError);
    assert.ok(Math.abs(fast.sampleMean - compiled.mean) < 6 * standardError);
    close(slow.variance, compiled.variance, 0.15);
    close(fast.sampleStandardDeviation ** 2, compiled.variance, 0.15);
    for (const fraction of [0.25, 0.5, 0.9]) {
      const amount = fast.sorted[Math.floor(fast.sorted.length * fraction)];
      const referenceCdf = reference.filter((value) => value <= amount).length / reference.length;
      assert.ok(Math.abs(referenceCdf - varianceBudgetPosition(fast.sorted, amount)) < 0.025);
    }
  }
});

test("30-star targets complete without truncating long enhancement histories", () => {
  const p = plan({ startStar: 12, targetStar: 30 });
  const out = run([p], 1, 10000);
  close(out.sampleMean, out.mean, 0.06);
  close(out.sampleStandardDeviation, out.standardDeviation, 0.1);
  assert.ok(out.p99 > out.p90 && out.p90 > out.median);
});

test("total distributions sum independent variances including repeated identical equipment", () => {
  const p = plan(), single = run([p]), combined = run([p, p]);
  close(combined.mean, single.mean * 2);
  close(combined.standardDeviation, single.standardDeviation * Math.sqrt(2));
  close(combined.sampleStandardDeviation, combined.standardDeviation, 0.06);
  assert.notEqual(combined.p90, single.p90 * 2);
});

test("quantity represents independent upgrades, not a multiple of the same sample", () => {
  const p = plan(), single = run([p]), many = run([{ ...p, quantity: 3 }]);
  close(many.mean, single.mean * 3);
  close(many.meanBooms, single.meanBooms * 3);
  close(many.meanSpares, single.meanSpares * 3);
  close(many.standardDeviation, single.standardDeviation * Math.sqrt(3));
  close(many.sampleStandardDeviation, many.standardDeviation, 0.06);
});

test("multipliers scale all distribution metrics and quantiles consistently", () => {
  const p = plan(), raw = run([p]), scaled = run([p], 1.07);
  for (const key of ["mean", "median", "p10", "p90", "p99", "standardDeviation", "sampleMean"]) close(scaled[key], raw[key] * 1.07);
  assert.equal(scaled.meanBooms, raw.meanBooms);
  assert.equal(scaled.meanSpares, raw.meanSpares);
  assert.deepEqual(scaled.sortedBooms, raw.sortedBooms);
  assert.deepEqual(scaled.sortedSpares, raw.sortedSpares);
});

test("NPC single-spare restoration uses the same paid cost as the main calculator", () => {
  const p = calculateItem({ presetId: "astra-secondary", itemLevel: 200, startStar: 17, targetStar: 24, replacementEok: 10 }, { event: "shining", mvp: "diamond", pc: false });
  const out = run([p], 1.09, 10000);
  close(out.mean, p.totalCost * 1.09);
  assert.ok(out.p99 > out.median);
});

test("a budget CDF includes ties and handles zero, extremes and deterministic samples", () => {
  const sorted = Float64Array.from([10, 10, 20, 30]);
  assert.equal(varianceBudgetPosition(sorted, 0), 0);
  assert.equal(varianceBudgetPosition(sorted, 10), 0.5);
  assert.equal(varianceBudgetPosition(sorted, 25), 0.75);
  assert.equal(varianceBudgetPosition(sorted, 30), 1);
  assert.equal(varianceBudgetPosition(sorted, Infinity), 1);
});

test("partial work cannot be mistaken for a finished distribution; chunks are reproducible", () => {
  const request = { plans: [plan()] };
  const simulation = createVarianceSimulation(request, 1000);
  simulation.step(1);
  assert.throws(() => simulation.finish(), /완료/);
  while (simulation.step(73).completed < 1000) {}
  const chunked = simulation.finish(), whole = run(request.plans, 1, 1000);
  assert.deepEqual(chunked.sorted, whole.sorted);
});

test("continuous quantiles retain all outcomes and preserve aligned destruction and spare counts", () => {
  const summary = summarizeVariance([1e15, 30, 10, 20], 1e12, 1e25,
    {booms:[100,3,1,2],spares:[400,9,1,4]});
  assert.deepEqual([...summary.sorted],[10,20,30,1e15]);
  assert.deepEqual([...summary.sortedBooms],[1,2,3,100]);
  assert.deepEqual([...summary.sortedSpares],[1,4,9,400]);
  assert.equal(varianceQuantile(summary.sorted,0),10);
  assert.equal(varianceQuantile(summary.sorted,1),1e15);
  assert.equal(varianceQuantile(summary.sorted,0.5),25);
  const points=Array.from({length:1001},(_,i)=>varianceQuantile(summary.sorted,i/1000));
  assert.ok(points.every((value,i)=>!i||value>=points[i-1]));
  assert.equal(summary.deciles,undefined);
  assert.equal(summary.histogram,undefined);
});

test("displayed percentiles use the same interpolated ranks as the horizontal axis, including ties", () => {
  const tied=summarizeVariance([10,10,10,20],12.5,18.75);
  assert.equal(tied.median,10);
  assert.equal(varianceBudgetPosition(tied.sorted,tied.median),0.75);
  const even=summarizeVariance([10,20,30,40],25,125);
  assert.equal(even.median,25);
  for(const [key,fraction] of [['p10',0.1],['median',0.5],['p90',0.9],['p99',0.99]]) {
    assert.equal(even[key],varianceQuantile(even.sorted,fraction));
    assert.equal(tied[key],varianceQuantile(tied.sorted,fraction));
  }
});

test("tooltip costs follow the exact quantile while outcome averages follow nearby ranks continuously", () => {
  const summary=summarizeVariance([0,10,20,30,40],20,200,{booms:[0,1,2,3,4],spares:[0,2,4,6,8]});
  const point=variancePoint(summary,0.5);
  assert.equal(point.cost,20);
  assert.equal(point.probability,0.6);
  close(point.meanBooms,2);close(point.meanSpares,4);
  const before=variancePoint(summary,0.4999),after=variancePoint(summary,0.5001);
  assert.ok(after.cost>before.cost&&after.cost-before.cost<0.02);
  assert.ok(after.meanSpares>before.meanSpares);
  // Near-identical pointer positions across the former 10% boundary stay close.
  assert.ok(Math.abs(variancePoint(summary,0.1-1e-5).meanBooms-variancePoint(summary,0.1+1e-5).meanBooms)<0.01);
  const sparse=summarizeVariance([10,1e12],5e11,1e23,{booms:[0,100],spares:[0,400]});
  const tail=variancePoint(sparse,0.99);
  close(tail.meanBooms,99);close(tail.meanSpares,396);
  assert.equal(variancePoint(sparse,1).meanBooms,100);
  const deterministic=summarizeVariance([1e20,1e20],1e20,0,{booms:[1,3],spares:[2,4]});
  assert.deepEqual(variancePoint(deterministic,0.5),{cost:1e20,probability:1,meanBooms:2,meanSpares:3});
});

test("24-to-26-star regression: ten-percent tooltip matches 15.74 eok and excludes expensive outcomes", () => {
  const p=calculateItem({presetId:'arcane-shoulder',itemLevel:200,startStar:24,targetStar:26,replacementEok:0.1},
    {event:'shining',mvp:'diamond',pc:false});
  const result=run([p]);
  close(result.p10/1e8,15.7356115);
  for (const [rank,key] of [[0.1,'p10'],[0.5,'median'],[0.9,'p90']]) {
    const point=variancePoint(result,rank);
    assert.equal(point.cost,result[key]);
    assert.equal(point.mean,undefined);
  }
  assert.equal(variancePoint(result,0.1).meanBooms,0);
  assert.equal(variancePoint(result,0.1).meanSpares,0);
  // Moving the expensive tail must not change averages for cheap completions.
  const changed=summarizeVariance(result.sorted.map((cost,i)=>i>result.sampleCount/2?cost*100:cost),0,0,
    {booms:result.sortedBooms,spares:result.sortedSpares});
  assert.deepEqual(variancePoint(changed,0.1),variancePoint(result,0.1));
});

test("outcome averages include all equal-cost results regardless of their input order", () => {
  const first=summarizeVariance([10,10,10,1000],0,0,{booms:[0,3,6,100],spares:[0,6,12,400]});
  const reordered=summarizeVariance([1000,10,10,10],0,0,{booms:[100,6,0,3],spares:[400,12,0,6]});
  for (const rank of [0,0.1,0.5,0.8,1]) assert.deepEqual(variancePoint(first,rank),variancePoint(reordered,rank));
  assert.equal(variancePoint(first,0.1).meanBooms,3);
  assert.equal(variancePoint(first,0.1).meanSpares,6);
});

test("cost histogram retains all samples and aligned destruction/spare counts, including the expensive tail", () => {
  const samples=Array.from({length:101},(_,i)=>i===100?10000:i);
  const result=summarizeVariance(samples,0,0,{booms:samples.map((_,i)=>i),spares:samples.map((_,i)=>i*4)});
  const histogram=varianceHistogram(result,3);
  assert.equal(histogram.minimum,0);assert.equal(histogram.limit,99);
  assert.equal(histogram.overflow,true);
  assert.deepEqual(histogram.bins.map(b=>b.count),[33,33,33,2]);
  assert.deepEqual(histogram.bins.map(b=>[b.lower,b.upper]),[[0,33],[33,66],[66,99],[99,null]]);
  assert.equal(histogram.bins.at(-1).meanBooms,99.5);
  assert.equal(histogram.bins.at(-1).meanSpares,398);
  assert.equal(histogram.bins.at(-1).cumulativeProbability,1);
  close(histogram.bins.reduce((sum,b)=>sum+b.probability,0),1);
  close(histogram.bins.reduce((sum,b)=>sum+b.meanBooms*b.count,0)/samples.length,result.sampleMeanBooms);
  close(histogram.bins.reduce((sum,b)=>sum+b.meanSpares*b.count,0)/samples.length,result.sampleMeanSpares);
});

test("cost histogram handles deterministic, tied and empty bins without dropping or inventing outcomes", () => {
  const constant=summarizeVariance([10,10,10],10,0,{booms:[1,2,3],spares:[4,8,12]});
  const one=varianceHistogram(constant);
  assert.equal(one.bins.length,1);assert.equal(one.overflow,false);
  assert.deepEqual(one.bins[0],{lower:10,upper:10,overflow:false,count:3,probability:1,cumulativeProbability:1,meanBooms:2,meanSpares:8});
  const tied=summarizeVariance([...Array(999).fill(0),10000],0,0);
  const histogram=varianceHistogram(tied,20);
  assert.equal(histogram.overflow,false);
  assert.equal(histogram.bins[0].count,999);
  assert.equal(histogram.bins.at(-1).count,1);
  assert.ok(histogram.bins.slice(1,-1).every(b=>b.count===0&&b.meanBooms===0&&b.meanSpares===0));
  assert.throws(()=>varianceHistogram(constant,0),RangeError);
  assert.throws(()=>varianceHistogram({sorted:[]}),RangeError);
});

test("splitting cost bins into thirds preserves original probabilities, outcomes and the expensive tail", () => {
  const samples=Array.from({length:3000},(_,i)=>17+i*i*1117.37);
  const result=summarizeVariance(samples,0,0,{booms:samples.map((_,i)=>i%19),spares:samples.map((_,i)=>i%23)});
  for (const count of [12,27,44]) {
    const original=varianceHistogram(result,count),refined=varianceHistogram(result,count*3);
    assert.equal(refined.regularCount,original.regularCount*3);
    assert.deepEqual(refined.bins.at(-1),original.bins.at(-1));
    for (let i=0;i<count;i++) {
      const before=original.bins[i],parts=refined.bins.slice(i*3,i*3+3);
      assert.equal(parts.reduce((sum,b)=>sum+b.count,0),before.count);
      close(parts.reduce((sum,b)=>sum+b.probability,0),before.probability);
      close(parts.reduce((sum,b)=>sum+b.meanBooms*b.count,0),before.meanBooms*before.count);
      close(parts.reduce((sum,b)=>sum+b.meanSpares*b.count,0),before.meanSpares*before.count);
      close(parts[0].upper-parts[0].lower,(before.upper-before.lower)/3);
    }
    assert.equal(refined.bins.at(-1).cumulativeProbability,1);
  }
});

test("sampled destructions and consumed spares match exact means for all restoration paths", () => {
  for(const p of [plan({optimize:false}),plan({startStar:22,targetStar:23,restore:[22],optimize:false}),
    plan({startStar:23,targetStar:25,restore:[22],optimize:false}),
    calculateItem({presetId:'astra-secondary',itemLevel:200,startStar:22,targetStar:24,replacementEok:10,optimize:false,restore:[22]}, {event:'shining',mvp:'diamond',pc:false})]) {
    const out=run([p]);
    close(out.meanBooms,p.expectedBooms);close(out.meanSpares,p.expectedItems);
    close(out.sampleMeanBooms,out.meanBooms,0.06);close(out.sampleMeanSpares,out.meanSpares,0.06);
    assert.ok(out.sortedBooms.every(v=>Number.isSafeInteger(v)&&v>=0));
    assert.ok(out.sortedSpares.every(v=>Number.isSafeInteger(v)&&v>=0));
  }
  const p=plan({startStar:22,targetStar:23,optimize:false,restore:[22]}),out=run([p]);
  assert.ok(out.sortedBooms.every((v,i)=>out.sortedSpares[i]===v*4));
  const npc=calculateItem({presetId:'astra-secondary',itemLevel:200,startStar:22,targetStar:23,replacementEok:10,optimize:false,restore:[22]}, {event:'shining',mvp:'diamond',pc:false});
  const single=run([npc]);
  assert.ok(single.sortedBooms.every((v,i)=>single.sortedSpares[i]===v));
});

test("cache keys change with strategy, price, event, quantity and multiplier", () => {
  const p = plan(), key = varianceRequestKey({ plans: [p], multiplier: 1 }, 30000);
  for (const request of [
    { plans: [p], multiplier: 1.07 },
    { plans: [{ ...p, quantity: 2 }] },
    { plans: [plan({ replacementPrice: 52e8 })] },
    { plans: [plan({ event: "none" })] },
    { plans: [plan({ optimize: false })] },
    { plans: [{...p, stages:p.stages.map(s=>({...s,expectedItems:s.expectedItems+1}))}] },
  ]) assert.notEqual(varianceRequestKey(request, 30000), key);
  assert.notEqual(varianceRequestKey({ plans: [p] }, 100000), key);
});

test("invalid or incomplete plans fail explicitly instead of returning a partial cost", () => {
  assert.throws(() => createVarianceSimulation({ plans: [] }));
  assert.throws(() => compileStarforceDistribution({ ...plan(), strategyStages: [], stages: [] }));
  assert.throws(() => createVarianceSimulation({ plans: [{ ...plan(), quantity: 0 }] }));
  assert.throws(() => createVarianceSimulation({ plans: [plan()], multiplier: NaN }));
});
