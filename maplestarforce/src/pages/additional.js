import { mountPotentialCalculator } from "../shared/potential-page.js";
import { getSharedResultView } from "../shared/result-share-state.js";

mountPotentialCalculator({ system: getSharedResultView().system ?? "additional" });
