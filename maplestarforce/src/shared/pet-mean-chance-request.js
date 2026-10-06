// One worker per active settings snapshot. Obsolete results cannot replace a
// newer calculation or switch a manually selected percentile back to average.
export function createPetMeanChanceRequest(onReady) {
  const cache = new Map();
  let worker = null;
  let pendingKey = "";
  const stop = () => { worker?.terminate(); worker = null; pendingKey = ""; };
  const request = (options) => {
    const key = JSON.stringify(Object.entries(options).sort(([a], [b]) => a.localeCompare(b)));
    if (cache.has(key)) {
      if (pendingKey && pendingKey !== key) stop();
      return cache.get(key);
    }
    if (pendingKey === key) return null;
    stop();
    const finish = (value) => {
      cache.set(key, value);
      if (cache.size > 16) cache.delete(cache.keys().next().value);
      stop();
      onReady();
    };
    try {
      const current = new Worker(new URL("../workers/pet-mean-chance.worker.js", import.meta.url),
        { type: "module", name: "pet-mean-chance" });
      worker = current;
      pendingKey = key;
      current.onmessage = ({ data }) => {
        if (worker !== current || data.key !== key) return;
        finish(data.error ? { error: data.error } : data.result);
      };
      current.onerror = (event) => {
        if (worker !== current) return;
        event.preventDefault();
        finish({ error: event.message || "평균 비용 기준 확률을 계산하지 못했습니다." });
      };
      current.postMessage({ key, options });
    } catch (error) {
      stop();
      const value = { error: String(error) };
      cache.set(key, value);
      return value;
    }
    return null;
  };
  return { request, stop };
}
