import { mountPotentialCalculator } from "../shared/potential-page.js";

const requestedSystem = new URLSearchParams(window.location.search).get("system");
const system = ["additional", "combined"].includes(requestedSystem)
  ? requestedSystem
  : "regular";

mountPotentialCalculator({ system });
