import { calculatePetMeanCostChance } from "maple-core/pet";

self.onmessage = ({ data }) => {
  try { self.postMessage({ key: data.key, result: calculatePetMeanCostChance(data.options) }); }
  catch (error) { self.postMessage({ key: data.key, error: error instanceof Error ? error.message : String(error) }); }
};
