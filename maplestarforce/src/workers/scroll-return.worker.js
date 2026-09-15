import { calculateChaosReturnEconomy } from "maple-core/scroll-economy";

self.addEventListener("message", (event) => {
  const { requestId, key, options } = event.data ?? {};

  try {
    const result = calculateChaosReturnEconomy(options);
    self.postMessage({ requestId, key, result });
  } catch (error) {
    self.postMessage({
      requestId,
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
