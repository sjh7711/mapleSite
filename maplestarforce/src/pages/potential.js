import { mountPotentialCalculator } from "../shared/potential-page.js";
import { getSharedResultView } from "../shared/result-share-state.js";

const requestedSystem = getSharedResultView().system ?? new URLSearchParams(window.location.search).get("system");
const system = ["additional", "combined"].includes(requestedSystem)
  ? requestedSystem
  : "regular";

mountPotentialCalculator({ system });
