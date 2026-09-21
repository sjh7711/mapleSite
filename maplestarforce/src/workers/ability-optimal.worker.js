import { calculateAbilityOptimalStrategy } from "maple-core/ability";
import { calculateAbilityRouteReach } from "maple-core/ability-route-reach";

self.onmessage = ({ data }) => {
  const { requestId, key, options } = data ?? {};
  try {
    const result = calculateAbilityOptimalStrategy(options);
    for (const [index, route] of (result.routeComparison?.routes ?? []).entries()) {
      route.result.reach = calculateAbilityRouteReach(route.result, options, { seed: 0x20260920 + index });
    }
    self.postMessage({
      requestId,
      key,
      result,
    });
  } catch (error) {
    self.postMessage({
      requestId,
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
