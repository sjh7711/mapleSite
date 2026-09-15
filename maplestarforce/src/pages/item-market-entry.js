import { ITEM_MARKET_ENABLED } from "../shared/features.js";

if (ITEM_MARKET_ENABLED) {
  void import("./item-market.js");
} else {
  window.location.replace("../");
}
