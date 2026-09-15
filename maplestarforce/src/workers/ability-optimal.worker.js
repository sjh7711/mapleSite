import { calculateAbilityOptimalStrategy } from "maple-core/ability";

self.onmessage = ({ data }) => {
  const { requestId, key, options } = data ?? {};
  try {
    self.postMessage({
      requestId,
      key,
      result: calculateAbilityOptimalStrategy(options),
    });
  } catch (error) {
    self.postMessage({
      requestId,
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
