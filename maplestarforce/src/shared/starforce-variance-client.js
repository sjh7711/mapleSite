import { varianceRequestKey } from "./starforce-variance.js";

const simulations = new Map(), recommendations = new Map();
function remember(cache, key, value, limit) {
  if (cache.size >= limit) cache.delete(cache.keys().next().value);
  cache.set(key, value);
  return value;
}
function job(data, field, { signal, progress } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("취소됨", "AbortError")); return; }
    const worker = new Worker(new URL("../workers/starforce-variance.worker.js", import.meta.url), { type: "module" });
    const cleanup = () => { worker.terminate(); signal?.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(new DOMException("취소됨", "AbortError")); };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data[field]) { cleanup(); resolve(data[field]); }
      else if (data.error || data.reductionError) { cleanup(); reject(new Error(data.error ?? data.reductionError)); }
      else if (data.progress) progress?.(data.progress);
    };
    worker.onerror = (event) => {
      event.preventDefault(); cleanup(); reject(new Error("편차를 계산하지 못했습니다. 다시 시도해 주세요."));
    };
    try { worker.postMessage(data); }
    catch (error) { cleanup(); reject(error); }
  });
}
export function requestRiskReduction(plans, options = {}) {
  const request = { plans, multiplier: 1 };
  const key = JSON.stringify([varianceRequestKey(request, 0), plans.map((plan) => [plan.sourceIndex, plan.name, plan.singleSpare])]);
  if (options.signal?.aborted) return Promise.reject(new DOMException("취소됨", "AbortError"));
  if (recommendations.has(key)) return Promise.resolve(recommendations.get(key));
  return job({ request, reduction: true, simulate: false }, "reduction", options)
    .then((result) => remember(recommendations, key, result, 20));
}
export function requestVarianceSimulation(plans, sampleCount, options = {}) {
  const request = { plans, multiplier: 1 }, key = varianceRequestKey(request, sampleCount);
  if (options.signal?.aborted) return Promise.reject(new DOMException("취소됨", "AbortError"));
  if (simulations.has(key)) return Promise.resolve(simulations.get(key));
  return job({ request, sampleCount }, "result", options)
    .then((result) => remember(simulations, key, result, 8));
}
