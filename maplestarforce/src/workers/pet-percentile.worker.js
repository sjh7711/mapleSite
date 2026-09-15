import { calculatePetWonderBerryPercentileView } from "../shared/pet-target-chance.js";

self.onmessage = ({ data }) => {
  const { requestId, key, options, chancePercent } = data ?? {};
  try {
    self.postMessage({
      requestId,
      key,
      result: calculatePetWonderBerryPercentileView(options, chancePercent),
    });
  } catch (error) {
    self.postMessage({
      requestId,
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
