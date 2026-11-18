import { createVarianceSimulation } from "../shared/starforce-variance.js";
import { reduceStarforceRisk } from "../shared/starforce-risk-reduction.js";

self.onmessage = ({ data }) => {
  const { request, sampleCount, reduction = false, simulate = true } = data;
  try {
    if (reduction) {
      try { self.postMessage({ reduction: reduceStarforceRisk(request.plans) }); }
      catch { self.postMessage({ reductionError: "편차 감소안을 계산하지 못했습니다." }); }
    }
    if (!simulate) return;
    const simulation = createVarianceSimulation(request, sampleCount);
    let lastProgress = 0;
    const run = () => {
      try {
        const deadline = performance.now() + 30;
        let progress;
        do { progress = simulation.step(50); }
        while (progress.completed < sampleCount && performance.now() < deadline);
        if (progress.completed === sampleCount) {
          const result = simulation.finish();
          self.postMessage({ result }, [result.sorted.buffer, result.sortedBooms.buffer, result.sortedSpares.buffer]);
        } else {
          if (performance.now() - lastProgress > 100) {
            self.postMessage({ progress });
            lastProgress = performance.now();
          }
          setTimeout(run, 0);
        }
      } catch (error) { self.postMessage({ error: error.message }); }
    };
    run();
  } catch (error) { self.postMessage({ error: error.message }); }
};
