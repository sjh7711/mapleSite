import { calculatorStorage, registerResultShare } from "../shared/result-share-state.js";
import {
  PET_PROBABILITIES,
  calculatePetExpectation,
} from "maple-core/pet";
import { renderToolNav } from "../shared/shell.js";
import { chip, field, numberInput } from "../shared/ui.js";
import {
  card,
  cardWithHead,
  chipRow,
  createReachChanceControl,
  element,
  metric,
  metricGrid,
  renderWithFocus,
  resetAction,
  resultCard as createResultCard,
  resultLine,
  row,
} from "../shared/calculator-ui.js";
import {
  DEFAULT_PET_TARGET_CHANCE_PERCENT,
  MAX_PET_TARGET_CHANCE_PERCENT,
  MIN_PET_TARGET_CHANCE_PERCENT,
  calculatePetTargetChanceProjection,
  normalizePetTargetChance,
} from "../shared/pet-target-chance.js";

renderToolNav(document.querySelector("#toolnav"), "pet");

const STORAGE_KEY = "maplestarforce:pet:v3";
const LEGACY_STORAGE_KEY = "maplestarforce:pet:v2";
const MESO = 100_000_000;
const WONDER_BERRY_BUNDLE_SIZE = 11;
const TARGET_CHANCE_DEBOUNCE_MS = 220;
const PERCENTILE_VIEW_CACHE_LIMIT = 32;
const percentileViewCache = new Map();
let percentileWorker = null;
let percentilePendingKey = "";
let percentileErrorKey = "";
let percentileErrorMessage = "";
let percentileRequestId = 0;
const defaults = {
  targetCount: 1,
  wonderBlackEvent: false,
  wonderBlackEventIncreasePercent: 20,
  wonderBerryCashPurchaseAllowed: false,
  outputTradeability: "untradeable",
  wonderBerryBundleMaplePoints: 54_000,
  wonderBerryAuctionBundleEokPrice: "",
  lunaCrystalMaplePoints: 3_900,
  wonderBlackEokPrice: "",
  lunaSweetEokPrice: "",
  mesoMarketMaplePointsPerEok: 2_000,
  cashWonPerEok: "",
  lunaDreamEokPrice: "",
  lunaKeyEokPrice: "",
  auctionFeeRate: 0.05,
  resultUnit: "won",
  resultMode: "average",
  targetChancePercent: DEFAULT_PET_TARGET_CHANCE_PERCENT,
};

function normalizeTargetCount(value) {
  const numeric = Math.round(Number(value));
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 3
    ? numeric
    : 1;
}

function normalizeOutputTradeability(value) {
  return value === "tradeable" ? "tradeable" : "untradeable";
}

function loadState() {
  try {
    const current = JSON.parse(calculatorStorage.getItem(STORAGE_KEY));
    const legacy = current && typeof current === "object"
      ? null
      : JSON.parse(calculatorStorage.getItem(LEGACY_STORAGE_KEY));
    const saved = current && typeof current === "object"
      ? current
      : legacy && typeof legacy === "object"
        ? {
            ...legacy,
            wonderBerryBundleMaplePoints:
              legacy.wonderBerryBundlePrice ??
              defaults.wonderBerryBundleMaplePoints,
            lunaCrystalMaplePoints:
              legacy.lunaCrystalPrice ?? defaults.lunaCrystalMaplePoints,
            mesoMarketMaplePointsPerEok:
              legacy.maplePointsPerEok ??
              defaults.mesoMarketMaplePointsPerEok,
            cashWonPerEok: "",
            resultUnit:
              legacy.resultUnit === "meso" ? "meso" : "won",
          }
        : null;
    const loaded = saved && typeof saved === "object"
      ? { ...defaults, ...saved }
      : { ...defaults };
    loaded.targetChancePercent = normalizePetTargetChance(
      loaded.targetChancePercent,
    );
    loaded.targetCount = normalizeTargetCount(loaded.targetCount);
    loaded.resultUnit = ["won", "maple-point", "meso"].includes(
        loaded.resultUnit,
      )
      ? loaded.resultUnit
      : defaults.resultUnit;
    loaded.resultMode = loaded.resultMode === "chance"
      ? "chance"
      : "average";
    if (loaded.resultMode === "average") {
      loaded.targetChancePercent = DEFAULT_PET_TARGET_CHANCE_PERCENT;
    }
    loaded.outputTradeability = saved &&
        Object.hasOwn(saved, "outputTradeability")
      ? normalizeOutputTradeability(saved.outputTradeability)
      : saved && Number(saved.wonderBerryAuctionBundleEokPrice) > 0
        ? "tradeable"
        : defaults.outputTradeability;
    return Object.fromEntries(
      Object.keys(defaults).map((key) => [key, loaded[key]]),
    );
  } catch {
    return { ...defaults };
  }
}

const state = loadState();
const root = document.querySelector("#tool");

function save() {
  try {
    calculatorStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 저장을 막은 브라우저에서도 현재 계산은 계속한다.
  }
}

function update(mutator) {
  mutator();
  save();
  render();
}

function refreshResult() {
  const eventDescription = root.querySelector(".pet-black-event__description");
  if (eventDescription) eventDescription.textContent = state.wonderBlackEvent
    ? `ON ${(9.96 * (1 + state.wonderBlackEventIncreasePercent / 100)).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`
    : "OFF 9.96%";

  const result = root.querySelector(".calculator-result");
  if (!result) return;
  renderWithFocus(result, [resultCard()]);
  placePurchaseGuide();
}

function refreshResultContent() {
  const content = root.querySelector(".pet-result-content");
  if (!content) {
    refreshResult();
    return;
  }
  const freshCard = resultCard();
  const freshContent = freshCard.querySelector(".pet-result-content");
  if (!freshContent) {
    refreshResult();
    return;
  }
  renderWithFocus(content, [...freshContent.childNodes]);
  placePurchaseGuide();
}

function placePurchaseGuide() {
  const slot = root.querySelector(".pet-purchase-guide-slot");
  if (!slot) return;
  const guide = root.querySelector(
    ".calculator-result .pet-purchase-threshold",
  );
  slot.replaceChildren(...(guide ? [guide] : []));
}

function num(key, options = {}) {
  const input = numberInput(
    state[key],
    (value) => {
      state[key] = value;
      save();
      // 숫자를 입력할 때 왼쪽 입력칸까지 다시 만들면 `0.` 단계가 `0`으로
      // 정규화되어 0.8 같은 소수를 끝까지 입력할 수 없다. 결과만 갱신해
      // 브라우저가 사용자가 입력 중인 문자열과 커서를 그대로 유지하게 한다.
      refreshResult();
    },
    options,
  );
  input.dataset.key = key;
  return input;
}

function setChoice(key, value) {
  update(() => {
    state[key] = value;
  });
}

function resetButton() {
  return resetAction("초기화", () => update(() => {
    for (const key of [
      "wonderBerryBundleMaplePoints", "wonderBerryAuctionBundleEokPrice",
      "lunaCrystalMaplePoints", "wonderBlackEokPrice", "lunaSweetEokPrice",
      "mesoMarketMaplePointsPerEok", "cashWonPerEok", "lunaDreamEokPrice",
      "lunaKeyEokPrice", "auctionFeeRate",
    ]) state[key] = defaults[key];
  }), { key: "reset-pet-costs", title: "시세와 판매 수수료만 기본값으로 되돌립니다." });
}

function formatCount(value, unit = "회", fractionDigits = null) {
  if (!Number.isFinite(value)) return "계산 불가";
  const digits = fractionDigits ?? (value < 10 ? 2 : 1);
  return `${value.toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}${unit}`;
}

function formatWon(value) {
  if (!Number.isFinite(value)) return "계산 불가";
  if (Math.abs(value) >= 10_000) {
    return `${(value / 10_000).toLocaleString("ko-KR", {
      maximumFractionDigits: 1,
    })}만 원`;
  }
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function formatMaplePoints(value) {
  if (!Number.isFinite(value)) return "계산 불가";
  if (Math.abs(value) >= 10_000) {
    return `${(value / 10_000).toLocaleString("ko-KR", {
      maximumFractionDigits: 1,
    })}만 메포`;
  }
  return `${Math.round(value).toLocaleString("ko-KR")}메포`;
}

function formatMeso(value) {
  if (!Number.isFinite(value)) return "계산 불가";
  return `${(value / MESO).toLocaleString("ko-KR", {
    maximumFractionDigits: 2,
  })}억 메소`;
}

function hasCashWonRate() {
  const cashWonPerEok = Number(state.cashWonPerEok);
  return (
    String(state.cashWonPerEok ?? "").trim() !== "" &&
    Number.isFinite(cashWonPerEok) &&
    cashWonPerEok > 0
  );
}

function formatResultCost(mesoEquivalent) {
  if (state.resultUnit === "meso") return formatMeso(mesoEquivalent);
  if (state.resultUnit === "maple-point") {
    return formatMaplePoints(
      mesoEquivalent / MESO * Number(state.mesoMarketMaplePointsPerEok),
    );
  }
  if (!hasCashWonRate()) return "원 환산 불가";
  return formatWon(
    mesoEquivalent / MESO * Number(state.cashWonPerEok),
  );
}

function formatProbability(value, digits = 4) {
  return `${(value * 100).toLocaleString("ko-KR", {
    maximumFractionDigits: digits,
  })}%`;
}

function formatTargetChance(value) {
  return Number(value).toLocaleString("ko-KR", {
    maximumFractionDigits: 2,
  });
}

function petReachChanceControl(
  result,
  {
    recoveryEntered,
    getProjection = (chancePercent) =>
      calculatePetTargetChanceProjection(result, chancePercent),
    onViewChange = () => {},
  },
) {
  const progressMetric = metric("목표 확률 도달", "-", "실제 누적 확률 -");
  const costMetric = metric("준비 비용", "-");
  const progressLabel = progressMetric.querySelector("span");
  const progressValue = progressMetric.querySelector("strong");
  const progressHint = progressMetric.querySelector("small");
  const costLabel = costMetric.querySelector("span");
  const costValue = costMetric.querySelector("strong");
  let viewFrame = 0;
  let calculationTimer = 0;
  let controlNode = null;
  const refreshView = () => {
    if (viewFrame) cancelAnimationFrame(viewFrame);
    viewFrame = requestAnimationFrame(() => {
      viewFrame = 0;
      onViewChange();
    });
  };

  const updateReadout = (chancePercent) => {
    if (state.resultMode !== "chance") {
      progressLabel.textContent = "현재 계산 기준";
      progressValue.textContent = "평균 기댓값";
      progressHint.textContent = "목표를 달성할 때까지 계속 진행";
      return null;
    }
    const projection = getProjection(chancePercent);
    const chanceLabel = `${formatTargetChance(chancePercent)}% 당첨선`;
    if (!projection) {
      paintPending(chancePercent);
      return null;
    }
    if (projection.mode === "bundles") {
      const completionBundles =
        projection.completionBundles ??
        projection.purchaseBundles ??
        projection.bundles;
      progressLabel.textContent = chanceLabel;
      progressValue.textContent = `${completionBundles.toLocaleString("ko-KR")}묶음 이내`;
      progressHint.textContent = `전체의 ${formatProbability(projection.actualChance)}가 이 시점까지 획득`;
      costLabel.textContent = `${completionBundles.toLocaleString("ko-KR")}묶음 구매 준비`;
      const preparationMeso =
        projection.preparation.berryProcurementMesoEquivalent ??
        projection.preparation.berryMesoEquivalent;
      costValue.textContent = formatResultCost(preparationMeso);
      return projection;
    }

    const targetMeso = recoveryEntered
      ? projection.costs.netMesoEquivalent
      : projection.costs.grossMesoEquivalent;
    progressLabel.textContent = chanceLabel;
    progressValue.textContent = `${projection.routes.toLocaleString("ko-KR")}경로 이내`;
    progressHint.textContent = `전체의 ${formatProbability(projection.actualChance)}가 이 시점까지 획득`;
    costLabel.textContent = `${projection.routes.toLocaleString("ko-KR")}경로분 예상 준비 비용`;
    costValue.textContent = formatResultCost(targetMeso);
    return projection;
  };

  const paintPending = (chancePercent) => {
    const bundleMode = result.bundlePurchase?.applicable === true;
    const chanceLabel = `${formatTargetChance(chancePercent)}% 당첨선`;
    progressLabel.textContent = chanceLabel;
    progressValue.textContent = "계산 중…";
    progressHint.textContent = bundleMode
      ? "11개 묶음 전량 개봉 CDF 계산"
      : "목표 경로 수 계산";
    costLabel.textContent = "준비 비용";
    costValue.textContent = "계산 중…";
  };

  const flushPendingCalculation = () => {
    if (calculationTimer) {
      clearTimeout(calculationTimer);
      calculationTimer = 0;
    }
    updateReadout(state.targetChancePercent);
    refreshView();
  };

  const scheduleCalculation = (chancePercent) => {
    if (calculationTimer) clearTimeout(calculationTimer);
    paintPending(chancePercent);
    calculationTimer = setTimeout(() => {
      calculationTimer = 0;
      if (!controlNode?.isConnected) return;
      updateReadout(chancePercent);
      refreshView();
    }, TARGET_CHANCE_DEBOUNCE_MS);
  };

  return createReachChanceControl({
    id: "pet-target-chance-range",
    label: `목표 도달 확률 · 자석펫 ${result.targetCount}마리`,
    className: "pet-reach-control",
    modeClassName: "pet-reach-control__mode",
    actionsClassName: "pet-reach-control__actions",
    value: state.targetChancePercent,
    min: MIN_PET_TARGET_CHANCE_PERCENT,
    max: MAX_PET_TARGET_CHANCE_PERCENT,
    average: state.resultMode !== "chance",
    averageValue: DEFAULT_PET_TARGET_CHANCE_PERCENT,
    resetTitle: "장기 평균 기댓값으로 돌아갑니다.",
    metrics: [progressMetric, costMetric],
    normalize: (value, fallback) => normalizePetTargetChance(value, fallback),
    onChange: (value, { average, phase, control, metrics }) => {
      controlNode = control;
      state.targetChancePercent = value;
      state.resultMode = average ? "average" : "chance";
      costMetric.hidden = average;
      metrics.classList.toggle("reach-control__metrics--single", average);
      if (phase === "initial") updateReadout(value);
      else if (phase === "input") scheduleCalculation(value);
      else flushPendingCalculation();
    },
    onCommit: (_value, { source }) => {
      if (source === "range") flushPendingCalculation();
      save();
    },
  });
}

function requiresTradeableOutput() {
  return state.outputTradeability === "tradeable";
}

function procurementSourceLabel(
  source,
  bundleSize = 11,
  cashTradeableBundleSelected = false,
) {
  if (source === "auction-bundle") {
    return cashTradeableBundleSelected
      ? `캐시 ${bundleSize}개 묶음`
      : `경매장 ${bundleSize}개 묶음`;
  }
  if (source === "hybrid-bundle") return "하이브리드";
  if (source === "none") return "원더베리 미사용";
  return `메포 ${bundleSize}개 묶음`;
}

function procurementSnapshot(procurement) {
  if (!procurement) return null;
  const fixedPlan = procurement.plan ?? null;
  const bundleSize = Number(
    procurement.purchaseUnitSize ??
      procurement.maplePointBundleSize ??
      procurement.procurement?.wonderBerryBundleSize ??
      procurement.wonderBerryBundleSize ??
      WONDER_BERRY_BUNDLE_SIZE,
  );
  return {
    source: procurement.selectedProcurement,
    bundleSize,
    maplePointBundles: Number(
      fixedPlan?.maplePointBundles ??
        procurement.expectedMaplePointBundles ??
        0,
    ),
    auctionBundles: Number(
      fixedPlan?.auctionBundles ??
        procurement.expectedAuctionBundles ??
        0,
    ),
    totalBundles: Number(
      fixedPlan?.purchasedBundles ??
        procurement.expectedPurchaseUnits ??
        0,
    ),
    openedWonderBerries: Number(
      procurement.requiredWonderBerries ??
        procurement.expectedOpenedWonderBerries ??
        0,
    ),
    suppliedWonderBerries: Number(
      procurement.suppliedWonderBerries ??
        fixedPlan?.suppliedWonderBerries ??
        procurement.expectedOpenedWonderBerries ??
        0,
    ),
    unopenedWonderBerries: Number(
      procurement.unopenedWonderBerries ??
        fixedPlan?.excessWonderBerries ??
        0,
    ),
    totalMesoEquivalent: Number(
      fixedPlan?.totalMesoEquivalent ??
        procurement.costs?.mesoEquivalent ??
        0,
    ),
    bundleBreakEvenMeso: Number(
      procurement.comparison?.auctionBundleBreakEvenMeso ??
        procurement.procurement?.comparison?.auctionBundleBreakEvenMeso ??
        (procurement.comparison?.auctionBreakEvenMesoPerWonderBerry ??
          procurement.procurement?.comparison
            ?.auctionBreakEvenMesoPerWonderBerry ??
          0) * bundleSize,
    ),
    fixedQuantity: fixedPlan !== null,
    sourceBreakdown:
      procurement.sourceBreakdown ?? procurement.components ?? null,
    synthesisResultTradable:
      procurement.tradeability?.synthesisResultTradable ??
      procurement.procurement?.tradeability?.synthesisResultTradable ??
      null,
  };
}

function hybridProcurementRow(
  component,
  {
    title,
    role,
    usageKey,
    usageLabel,
    quantityLabel,
    cashBundleWon = 0,
  },
) {
  const item = element("article", "pet-procurement-component");
  item.dataset.source = component.source;
  const head = element("div", "pet-procurement-component__head");
  head.append(
    element("span", "", title),
    element("strong", "", role),
  );
  const detail = element("div", "pet-procurement-component__detail");
  detail.append(
    element(
      "span",
      "",
      `${quantityLabel} ${formatCount(Number(component.purchasedBundles), "묶음", 2)} · 개봉 ${formatCount(Number(component.openedWonderBerries), "개", 2)}`,
    ),
    element(
      "strong",
      "",
      component.source === "auction-bundle"
        ? cashBundleWon > 0
          ? formatWon(Number(component.purchasedBundles) * cashBundleWon)
          : formatMeso(Number(component.auctionMeso))
        : formatMaplePoints(Number(component.maplePoints)),
    ),
  );
  const inventory = element(
    "p",
    "pet-procurement-component__inventory",
    `블랙 ${formatCount(Number(component.wonderBlacksPulled), "마리", 2)} · ${usageLabel} ${formatCount(Number(component[usageKey]), "마리", 2)} · 잔여 ${formatCount(Number(component.remainingWonderBlacks), "마리", 2)}`,
  );
  item.append(head, detail, inventory);
  return item;
}

function procurementSummary(
  procurement,
  {
    tradeableOutputRequired = false,
    cashTradeableBundleSelected = false,
    cashBundleWon = 0,
  } = {},
) {
  const snapshot = procurementSnapshot(procurement);
  if (!snapshot) return null;
  const box = element("section", "pet-procurement-summary");
  box.dataset.source = snapshot.source;
  const head = element("div", "pet-procurement-summary__head");
  head.append(
    element(
      "span",
      "",
      tradeableOutputRequired
        ? "교가 완성 경로"
        : "교불 완성 경로",
    ),
    element(
      "strong",
      "",
      `${procurementSourceLabel(
        snapshot.source,
        snapshot.bundleSize,
        cashTradeableBundleSelected,
      )}${
        snapshot.synthesisResultTradable === null
          ? ""
          : snapshot.synthesisResultTradable
            ? " · 교가 결과"
            : " · 교불 결과"
      }`,
    ),
  );
  if (snapshot.source === "hybrid-bundle" && snapshot.sourceBreakdown) {
    const quantityLabel = snapshot.fixedQuantity
      ? "당첨선 조건 평균"
      : "평균";
    const total = element("div", "pet-procurement-summary__detail");
    total.append(
      element(
        "span",
        "",
        `${snapshot.fixedQuantity ? "당첨선" : "평균"} 총 ${snapshot.fixedQuantity
          ? `${snapshot.totalBundles.toLocaleString("ko-KR")}묶음`
          : formatCount(snapshot.totalBundles, "묶음", 2)} · 전량 개봉 ${formatCount(snapshot.openedWonderBerries, "개", 2)}`,
      ),
      element(
        "strong",
        "",
        snapshot.totalMesoEquivalent > 0
          ? formatMeso(snapshot.totalMesoEquivalent)
          : "-",
      ),
    );
    const components = element("div", "pet-procurement-components");
    components.append(
      hybridProcurementRow(snapshot.sourceBreakdown.auctionBase, {
        title: cashTradeableBundleSelected
          ? "캐시 원더베리 묶음"
          : "경매장 원더베리 묶음",
        role: "교가 베이스",
        usageKey: "wonderBlacksConsumedAsBase",
        usageLabel: "베이스 사용",
        quantityLabel,
        cashBundleWon: cashTradeableBundleSelected
          ? cashBundleWon
          : 0,
      }),
      hybridProcurementRow(snapshot.sourceBreakdown.maplePointMaterial, {
        title: "메포 원더베리 묶음",
        role: "교불 재료",
        usageKey: "wonderBlacksConsumedAsMaterial",
        usageLabel: "재료 사용",
        quantityLabel,
      }),
    );
    box.append(head, total, components);
    return box;
  }
  const quantities = [];
  if (snapshot.maplePointBundles > 0) {
    quantities.push(
      `메포 ${snapshot.fixedQuantity
        ? `${snapshot.maplePointBundles.toLocaleString("ko-KR")}묶음`
        : formatCount(snapshot.maplePointBundles, "묶음")}`,
    );
  }
  if (snapshot.auctionBundles > 0) {
    quantities.push(
      `${cashTradeableBundleSelected ? "캐시" : "경매장"} ${snapshot.fixedQuantity
        ? `${snapshot.auctionBundles.toLocaleString("ko-KR")}묶음`
        : formatCount(snapshot.auctionBundles, "묶음")}`,
    );
  }
  const detail = element("div", "pet-procurement-summary__detail");
  detail.append(
    element(
      "span",
      "",
      quantities.join(" · ") || "원더베리 구매 없음",
    ),
    element(
      "strong",
      "",
      snapshot.totalMesoEquivalent > 0
        ? formatMeso(snapshot.totalMesoEquivalent)
        : "-",
    ),
  );
  box.append(head, detail);
  if (snapshot.fixedQuantity) {
    const inventory = element("div", "pet-procurement-summary__detail");
    inventory.append(
      element(
        "span",
        "",
        `개봉 ${snapshot.openedWonderBerries.toLocaleString("ko-KR")}개 · 미개봉 ${snapshot.unopenedWonderBerries.toLocaleString("ko-KR")}개`,
      ),
    );
    box.append(
      inventory,
    );
  }
  return box;
}

function makeTable(headers, rows, className = "source-table") {
  const table = element("table", className);
  const thead = document.createElement("thead");
  const head = document.createElement("tr");
  head.append(...headers.map((label) => element("th", "", label)));
  thead.append(head);
  const tbody = document.createElement("tbody");
  for (const values of rows) {
    const tableRow = document.createElement("tr");
    tableRow.append(...values.map((value) => element("td", "", value)));
    tbody.append(tableRow);
  }
  table.append(thead, tbody);
  return table;
}

function eventControl() {
  const box = element("div", "pet-draw-setting pet-black-event");
  const copy = element("div", "pet-black-event__copy");
  copy.append(
    element("span", "pet-black-event__title", "원더 블랙 이벤트"),
    element(
      "span",
      "pet-black-event__description",
      state.wonderBlackEvent
        ? `ON ${(9.96 * (1 + state.wonderBlackEventIncreasePercent / 100)).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}%`
        : "OFF 9.96%",
    ),
  );
  const controls = element("div", "pet-black-event__controls");
  controls.append(
    chip("OFF", !state.wonderBlackEvent, () => setChoice("wonderBlackEvent", false)),
    chip("ON", state.wonderBlackEvent, () => setChoice("wonderBlackEvent", true)),
  );
  box.append(copy, controls);
  return box;
}

function targetCard() {
  const targetCount = element("div", "pet-draw-setting");
  targetCount.append(
    element("p", "pet-field-label", "목표 마릿수"),
    chipRow(
      ...[1, 2, 3].map((count) =>
        chip(`${count}마리`, state.targetCount === count, () =>
          setChoice("targetCount", count)),
      ),
    ),
  );

  const outputTradeability = element("div", "pet-draw-setting");
  outputTradeability.append(
    element("p", "pet-field-label", "완성 결과"),
    chipRow(
      chip(
        "교불",
        state.outputTradeability === "untradeable",
        () => setChoice("outputTradeability", "untradeable"),
      ),
      chip(
        "교가",
        state.outputTradeability === "tradeable",
        () => setChoice("outputTradeability", "tradeable"),
      ),
    ),
  );

  const cashPurchase = element("div", "pet-draw-setting pet-black-event");
  const cashPurchaseCopy = element("div", "pet-black-event__copy");
  cashPurchaseCopy.append(
    element(
      "span",
      "pet-black-event__title",
      "원더베리 캐시 구매 허용",
    ),
  );
  const cashPurchaseControls = element(
    "div",
    "pet-black-event__controls",
  );
  cashPurchaseControls.append(
    chip(
      "OFF",
      !state.wonderBerryCashPurchaseAllowed,
      () => setChoice("wonderBerryCashPurchaseAllowed", false),
    ),
    chip(
      "ON",
      state.wonderBerryCashPurchaseAllowed,
      () => setChoice("wonderBerryCashPurchaseAllowed", true),
    ),
  );
  cashPurchase.append(cashPurchaseCopy, cashPurchaseControls);

  const settings = element("div", "pet-draw-settings");
  settings.append(
    targetCount,
    eventControl(),
    cashPurchase,
    outputTradeability,
  );

  return cardWithHead("뽑기 설정", resetAction("초기화", () => update(() => {
    for (const key of ["targetCount", "wonderBlackEvent", "wonderBlackEventIncreasePercent",
      "wonderBerryCashPurchaseAllowed", "outputTradeability"]) state[key] = defaults[key];
  }), { key: "reset-pet-draw", title: "목표 마릿수·이벤트·구매 허용·완성 결과를 기본값으로 되돌립니다." }), settings);
}

function costCard() {
  const price = (label, key, extra = {}) => field(label, num(key, {
    min: "0", step: "0.1", allowEmpty: true, placeholder: "경매장 시세", ...extra,
  }));
  const exchangeRates = row(
    field("메소마켓 1억 메소 (메포)", num("mesoMarketMaplePointsPerEok", { min: "1", step: "1" })),
    field("1억 메소 시세 (원)", num("cashWonPerEok", { min: "1", step: "1", allowEmpty: true, placeholder: "현금 시세 입력" })),
    field("판매 수수료", chipRow(
      chip("5%", state.auctionFeeRate === 0.05, () => setChoice("auctionFeeRate", 0.05)),
      chip("3%", state.auctionFeeRate === 0.03, () => setChoice("auctionFeeRate", 0.03)),
    )),
    field("이벤트 확률 증가 (%)", num("wonderBlackEventIncreasePercent", { min: "0", max: "600", step: "1", disabled: !state.wonderBlackEvent })),
  );
  exchangeRates.classList.add("pet-cost-grid", "pet-cost-grid--rates");
  const purchasePrices = row(
    field("원더베리 11개 (캐시)", num("wonderBerryBundleMaplePoints", { min: "0", step: "100" })),
    price("원더베리 11개 경매장 (억 메소)", "wonderBerryAuctionBundleEokPrice", { step: "0.01" }),
    field("루나 크리스탈 1개 (메포)", num("lunaCrystalMaplePoints", { min: "0", step: "100" })),
  );
  purchasePrices.classList.add("pet-cost-grid", "pet-cost-grid--purchase");
  const auctionPrices = row(
    price("원더 블랙 (억 메소)", "wonderBlackEokPrice"),
    price("루나 스윗 (억 메소)", "lunaSweetEokPrice"),
    price("루나 드림 (억 메소)", "lunaDreamEokPrice"),
    price("루크키 (억 메소)", "lunaKeyEokPrice"),
  );
  auctionPrices.classList.add("pet-cost-grid", "pet-cost-grid--auction");
  const purchaseGuideSlot = element("div", "pet-purchase-guide-slot");
  return cardWithHead("비용 설정", resetButton(), exchangeRates, purchasePrices, auctionPrices, purchaseGuideSlot);
}

function termGuide() {
  const entries = [
    [
      "경로",
      "블랙 + 블랙 1회로 시작해, 스윗이 나오면 스윗 + 블랙까지 이어서 결과가 끝나는 한 사이클입니다.",
    ],
    [
      "하이브리드 경로",
      "경매장 원더베리의 교가 블랙을 베이스로, 메포 원더베리의 교불 블랙을 재료로 합성해 결과의 교가 상태를 유지하는 방식입니다.",
    ],
    [
      "교가 베이스·교불 재료",
      "합성 결과는 베이스 펫의 교환 가능 여부를 따릅니다. 팔 수 있는 교가 펫을 베이스 칸에, 팔 수 없는 교불 펫을 재료 칸에 놓는다는 뜻입니다.",
    ],
    [
      "교불·교가",
      "교불은 교환할 수 없는 완성 결과, 교가는 경매장에 다시 판매할 수 있는 완성 결과입니다. 교가 계산에는 캐시 구매용 현금 시세 또는 경매장 원더베리 묶음 시세가 필요합니다.",
    ],
    [
      "당첨선·목표 도달 확률",
      "80% 당첨선이라면 전체의 약 80%가 표시된 구매량과 비용 안에서 목표를 얻는 지점입니다. 장기 평균 기댓값과는 다릅니다.",
    ],
    [
      "회수 반영 비용",
      "드림·키·남은 교가 블랙의 판매금과 원더 펫 페이백처럼 되찾는 금액을 총지출에서 뺀 비용입니다.",
    ],
    [
      "보관",
      "남은 교불 원더 블랙을 다음 합성 재료로 남겨두는 상태입니다. 팔거나 페이백하지 않으므로 현재 비용에서 가치를 차감하지 않습니다.",
    ],
    [
      "구매 기준",
      "표시 기준가는 해당 원더베리 경로로 준비하는 것과 같아지는 완성 블랙·스윗 시세입니다. 현재 시세가 더 낮으면 완성 펫 구매가 유리합니다. 메포산은 교불 재료, 캐시·경매장산은 교가 베이스로 용도가 다릅니다.",
    ],
  ];
  const list = element("dl", "pet-term-guide__list");
  for (const [term, description] of entries) {
    const item = element("div", "pet-term-guide__item");
    item.append(
      element("dt", "pet-term-guide__term", term),
      element("dd", "pet-term-guide__description", description),
    );
    list.append(item);
  }
  const guide = element("section", "pet-term-guide");
  guide.setAttribute("aria-labelledby", "pet-term-guide-title");
  const title = element(
    "h3",
    "pet-term-guide__title",
    "용어 정리",
  );
  title.id = "pet-term-guide-title";
  guide.append(title, list);
  return guide;
}

function probabilityCard() {
  const first = PET_PROBABILITIES.sweetSynthesis;
  const second = PET_PROBABILITIES.dreamSynthesis;
  return card(
    "공식 확률",
    makeTable(
      ["합성", "자석펫", "다음 단계", "종료"],
      [
        [
          "블랙 + 블랙",
          formatProbability(first.petite),
          `스윗 ${formatProbability(first.sweet, 2)}`,
          `키 ${formatProbability(first.key, 2)}`,
        ],
        [
          "스윗 + 블랙",
          formatProbability(second.petite, 1),
          "-",
          `드림 ${formatProbability(second.dream, 1)} · 키 ${formatProbability(second.key, 0)}`,
        ],
      ],
      "source-table pet-probability-table",
    ),
    termGuide(),
  );
}

function marketMeso(value) {
  if (String(value ?? "").trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number * MESO : null;
}

function optionalMeso(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function purchaseRoute(coreRoute, fallbackMeso) {
  const effectiveMeso = optionalMeso(
    coreRoute?.effectiveMeso ?? fallbackMeso,
  );
  return {
    ...coreRoute,
    available: coreRoute?.available ?? effectiveMeso !== null,
    effectiveMeso,
  };
}

function purchaseRouteLine({
  key,
  label,
  route,
  missingText,
}) {
  const line = element("div", "pet-purchase-decision__line");
  line.dataset.route = key;
  line.dataset.available = String(
    route.available && route.effectiveMeso !== null,
  );
  const head = element("span", "pet-purchase-decision__route-name");
  head.append(element("span", "", label));
  line.append(
    head,
    element(
      "strong",
      "",
      route.available && route.effectiveMeso !== null
        ? formatMeso(route.effectiveMeso)
        : missingText,
    ),
  );
  return line;
}

function markPurchaseRecommendation(line, roles) {
  if (!line || !roles?.size) return;
  const label = roles.has("base") && roles.has("material")
    ? "베이스·재료 추천"
    : roles.has("base")
      ? "베이스 추천"
      : "재료 추천";
  line.classList.add("pet-purchase-decision__line--recommended");
  line.querySelector(".pet-purchase-decision__route-name")?.append(
    element("small", "pet-purchase-decision__badge", label),
  );
}

function purchaseDecision({
  title,
  comparison,
  auctionComparison,
  cashComparison,
  maplePointMeso,
  auctionBundleMeso,
  cashBundleMeso,
  cashPurchaseAllowed,
  currentMarketMeso,
  currentMarketLabel,
  currentMarketMissingText,
  kind,
  outputTradeability,
}) {
  const item = element("article", "pet-purchase-decision");
  const routes = [
    {
      key: "maplePointWonderBerry",
      label: kind === "sweet"
        ? "메포 원더베리 구매 상한"
        : "메포 원더베리 평균 조달비",
      route: purchaseRoute(
        comparison?.maplePointWonderBerry,
        maplePointMeso,
      ),
      missingText: "계산 불가",
    },
    ...(cashPurchaseAllowed
      ? [{
          key: "cashWonderBerryBundle",
          label: kind === "sweet"
            ? "캐시 원더베리 구매 상한"
            : "캐시 원더베리 평균 조달비",
          route: purchaseRoute(
            cashComparison?.auctionWonderBerryBundle,
            cashBundleMeso,
          ),
          missingText: "현금 시세 입력 필요",
        }]
      : []),
    {
      key: "auctionWonderBerryBundle",
      label: kind === "sweet"
        ? "경매장 원더베리 묶음 구매 상한"
        : "경매장 원더베리 묶음 평균 조달비",
      route: purchaseRoute(
        auctionComparison?.auctionWonderBerryBundle,
        auctionBundleMeso,
      ),
      missingText: "묶음 시세 입력 필요",
    },
    {
      key: "directAuctionPurchase",
      label: currentMarketLabel,
      route: purchaseRoute(
        comparison?.directAuctionPurchase,
        currentMarketMeso,
      ),
      missingText: currentMarketMissingText,
    },
  ];
  const values = element("div", "pet-purchase-decision__values");
  const lines = routes.map((route) => purchaseRouteLine(route));
  values.append(...lines);
  const status = element("p", "pet-purchase-decision__status");
  status.setAttribute("aria-live", "polite");
  const availableRoutes = routes.filter(
    ({ route }) => route.available && route.effectiveMeso !== null,
  );
  if (availableRoutes.length === 0) {
    item.dataset.recommendation = "missing";
    status.dataset.tone = "missing";
    status.textContent = "비용 설정을 입력하면 세 경로를 비교합니다.";
  } else if (outputTradeability === "tradeable") {
    item.dataset.recommendation = "tradeable-base-required";
    const tradeableRoutes = availableRoutes.filter(
      ({ route }) => route.tradeability === "tradeable",
    );
    const base = tradeableRoutes.length
      ? tradeableRoutes.reduce((best, candidate) =>
        candidate.route.effectiveMeso < best.route.effectiveMeso
          ? candidate
          : best)
      : null;
    const materialRoutes = availableRoutes.filter(
      ({ route }) => route.tradeability !== "tradeable",
    );
    const material = materialRoutes.length
      ? materialRoutes.reduce((best, candidate) =>
        candidate.route.effectiveMeso < best.route.effectiveMeso
          ? candidate
          : best)
      : null;
    const recommendations = new Map();
    const addRole = (route, role) => {
      if (!route) return;
      const roles = recommendations.get(route.key) ?? new Set();
      roles.add(role);
      recommendations.set(route.key, roles);
    };
    addRole(base, "base");
    if (kind === "black") addRole(material, "material");
    recommendations.forEach((roles, key) => {
      markPurchaseRecommendation(lines[routes.findIndex(
        (route) => route.key === key,
      )], roles);
    });
    if (base) {
      status.hidden = true;
    } else {
      status.dataset.tone = "missing";
      status.textContent = "캐시 구매용 현금 시세 또는 경매장 원더베리 묶음 시세를 입력하면 베이스 추천을 표시합니다.";
    }
  } else if (kind === "black") {
    const cheapest = availableRoutes.reduce((best, candidate) =>
      candidate.route.effectiveMeso < best.route.effectiveMeso
        ? candidate
        : best);
    const recommended = cheapest;
    const recommendedIndex = routes.indexOf(recommended);
    item.dataset.recommendation = recommended.key;
    markPurchaseRecommendation(
      lines[recommendedIndex],
      new Set(["base", "material"]),
    );
    status.hidden = true;
  } else {
    const direct = routes.find(
      ({ key }) => key === "directAuctionPurchase",
    );
    const selfProductionRoutes = routes.filter(
      ({ key, route }) =>
        key !== "directAuctionPurchase" &&
        route.available &&
        route.effectiveMeso !== null,
    );
    if (!direct.route.available || direct.route.effectiveMeso === null) {
      item.dataset.recommendation = "missing";
      status.dataset.tone = "missing";
      status.textContent = "현재 스윗 시세를 입력하면 구매 여부를 판단합니다.";
    } else if (selfProductionRoutes.length === 0) {
      item.dataset.recommendation = "missing";
      status.dataset.tone = "missing";
      status.textContent = "원더베리 기준을 계산할 수 없습니다.";
    } else {
      const bestSelfProduction = selfProductionRoutes.reduce(
        (best, candidate) =>
          Number(candidate.route.petiteTargetNetMeso) <
              Number(best.route.petiteTargetNetMeso)
            ? candidate
            : best,
      );
      const recommended = direct.route.effectiveMeso <=
          bestSelfProduction.route.effectiveMeso
        ? direct
        : bestSelfProduction;
      const recommendedIndex = routes.indexOf(recommended);
      item.dataset.recommendation = recommended.key;
      markPurchaseRecommendation(
        lines[recommendedIndex],
        new Set(["base"]),
      );
      status.hidden = true;
    }
  }
  item.append(
    element("h4", "pet-purchase-decision__title", title),
    values,
    status,
  );
  return item;
}

function purchaseGuide({
  mesoMarketResult,
  auctionMarketResult,
  cashMarketResult,
}) {
  const panel = element("section", "pet-purchase-threshold");
  const decisions = element("div", "pet-purchase-threshold__grid");
  const thresholds = mesoMarketResult.purchaseThresholds;
  const comparisons = mesoMarketResult.purchaseComparisons ?? {};
  const auctionThresholds = auctionMarketResult?.purchaseThresholds ?? {};
  const auctionComparisons = auctionMarketResult?.purchaseComparisons ?? {};
  const cashThresholds = cashMarketResult?.purchaseThresholds ?? {};
  const cashComparisons = cashMarketResult?.purchaseComparisons ?? {};
  decisions.append(
    purchaseDecision({
      title: "원더 블랙 1마리",
      comparison: comparisons.wonderBlack,
      auctionComparison: auctionComparisons.wonderBlack,
      cashComparison: cashComparisons.wonderBlack,
      maplePointMeso: thresholds.wonderBlackMeso,
      auctionBundleMeso:
        auctionThresholds.auctionWonderBerryBundleWonderBlackMeso,
      cashBundleMeso:
        cashThresholds.auctionWonderBerryBundleWonderBlackMeso,
      cashPurchaseAllowed: state.wonderBerryCashPurchaseAllowed,
      currentMarketMeso: marketMeso(state.wonderBlackEokPrice),
      currentMarketLabel: "현재 블랙 시세",
      currentMarketMissingText: "블랙 시세 입력 필요",
      kind: "black",
      outputTradeability: state.outputTradeability,
    }),
    purchaseDecision({
      title: "루나 스윗 1마리",
      comparison: comparisons.lunaSweet,
      auctionComparison: auctionComparisons.lunaSweet,
      cashComparison: cashComparisons.lunaSweet,
      maplePointMeso: thresholds.lunaSweetMeso,
      auctionBundleMeso:
        auctionThresholds.auctionWonderBerryBundleLunaSweetMeso,
      cashBundleMeso:
        cashThresholds.auctionWonderBerryBundleLunaSweetMeso,
      cashPurchaseAllowed: state.wonderBerryCashPurchaseAllowed,
      currentMarketMeso: marketMeso(state.lunaSweetEokPrice),
      currentMarketLabel: "현재 스윗 시세",
      currentMarketMissingText: "스윗 시세 입력 필요",
      kind: "sweet",
      outputTradeability: state.outputTradeability,
    }),
  );
  panel.append(
    element(
      "h3",
      "pet-purchase-threshold__title",
      "블랙·스윗 구매 기준",
    ),
    decisions,
  );
  return panel;
}

function stageList(result) {
  const list = element("ol", "pet-stage-list");
  const bundleExpected = result.bundlePurchase?.applicable
    ? result.bundlePurchase.expected
    : null;
  const stages = [
    [
      "원더 블랙 획득",
      formatCount(
        bundleExpected?.wonderBlacksConsumed ?? result.expected.wonderBlacks,
        "마리",
      ),
    ],
    [
      "블랙 + 블랙",
      formatCount(
        bundleExpected?.sweetSynthesisAttempts ??
          result.expected.sweetSynthesisAttempts,
      ),
    ],
    [
      "스윗 + 블랙",
      formatCount(
        bundleExpected?.dreamSynthesisAttempts ??
          result.expected.dreamSynthesisAttempts,
      ),
    ],
  ];
  for (const [title, value] of stages) {
    const item = element("li", "pet-stage");
    item.append(
      element("span", "pet-stage__number", title),
      element("strong", "pet-stage__value", value),
    );
    list.append(item);
  }
  return list;
}

function resultUnitControl() {
  const control = element("div", "pet-result-unit");
  control.append(
    chip("원", state.resultUnit === "won", () =>
      setChoice("resultUnit", "won")),
    chip("메포", state.resultUnit === "maple-point", () =>
      setChoice("resultUnit", "maple-point")),
    chip("메소", state.resultUnit === "meso", () =>
      setChoice("resultUnit", "meso")),
  );
  return control;
}

function calculateResultContext() {
  const cashWonPerEok = Number(state.cashWonPerEok);
  const hasCashRate =
    String(state.cashWonPerEok ?? "").trim() !== "" &&
    Number.isFinite(cashWonPerEok) &&
    cashWonPerEok > 0;
  const tradeableOutputRequired = requiresTradeableOutput();
  const auctionBundleMeso =
    Number(state.wonderBerryAuctionBundleEokPrice) * MESO;
  const cashBundleWon = Number(state.wonderBerryBundleMaplePoints);
  const cashBundleMeso = state.wonderBerryCashPurchaseAllowed &&
      hasCashRate &&
      Number.isFinite(cashBundleWon) &&
      cashBundleWon > 0
    ? cashBundleWon / cashWonPerEok * MESO
    : 0;
  const cashTradeableBundleSelected = cashBundleMeso > 0 &&
    (!(auctionBundleMeso > 0) || cashBundleMeso <= auctionBundleMeso);
  const tradeableBundleMeso = cashTradeableBundleSelected
    ? cashBundleMeso
    : auctionBundleMeso;
  const commonOptions = {
    targetCount: Number(state.targetCount),
    wonderBlackEvent: state.wonderBlackEvent,
    wonderBlackEventIncreasePercent: state.wonderBlackEventIncreasePercent,
    sourceMode: "cheapest",
    wonderBerryBundleMaplePoints: Number(
      state.wonderBerryBundleMaplePoints,
    ),
    wonderBerryBundleSize: WONDER_BERRY_BUNDLE_SIZE,
    wonderBerryAuctionBundleMesoPrice:
      tradeableBundleMeso,
    wonderBerryProcurementMode: tradeableOutputRequired
      ? "cheapest"
      : "maple-point-bundle",
    tradeableOutputRequired,
    lunaCrystalMaplePoints: Number(state.lunaCrystalMaplePoints),
    wonderBlackMesoPrice: Number(state.wonderBlackEokPrice) * MESO,
    maplePointsPer100MillionMeso: Number(
      state.mesoMarketMaplePointsPerEok,
    ),
    lunaDreamAuctionMesoPrice: Number(state.lunaDreamEokPrice) * MESO,
    lunaSweetAuctionMesoPrice: Number(state.lunaSweetEokPrice) * MESO,
    lunaKeyAuctionMesoPrice: Number(state.lunaKeyEokPrice) * MESO,
    auctionFeeRate: Number(state.auctionFeeRate),
  };
  const mesoMarketResult = calculatePetExpectation({
    ...commonOptions,
    costConversionBasis: "maple-point",
  });
  const purchaseComparisonOptions = {
    ...commonOptions,
    tradeableOutputRequired: false,
    wonderBerryProcurementMode: "maple-point-bundle",
  };
  const auctionMarketResult = auctionBundleMeso > 0
    ? calculatePetExpectation({
        ...purchaseComparisonOptions,
        wonderBerryAuctionBundleMesoPrice: auctionBundleMeso,
        costConversionBasis: "maple-point",
      })
    : null;
  const cashMarketResult = cashBundleMeso > 0
    ? calculatePetExpectation({
        ...purchaseComparisonOptions,
        wonderBerryAuctionBundleMesoPrice: cashBundleMeso,
        costConversionBasis: "maple-point",
      })
    : null;
  return {
    auctionBundleMeso,
    auctionMarketResult,
    cashBundleMeso,
    cashBundleWon,
    cashMarketResult,
    cashTradeableBundleSelected,
    cashWonPerEok,
    commonOptions,
    hasCashRate,
    mesoMarketResult,
    result: mesoMarketResult,
  };
}

const ROUTE_CUMULATIVE_COST_KEYS = Object.freeze([
  "berryMaplePoints",
  "crystalMaplePoints",
  "grossMaplePoints",
  "wonderPetPaybackMaplePoints",
  "totalPetPaybackMaplePoints",
  "dreamPaybackMaplePoints",
  "dreamPaybackMesoEquivalent",
  "remainingBlackPaybackMaplePoints",
  "remainingBlackPaybackMesoEquivalent",
  "remainingSweetPaybackMaplePoints",
  "remainingSweetPaybackMesoEquivalent",
  "berryRecoveryMaplePoints",
  "berryCash",
  "crystalCash",
  "blackMeso",
  "grossCash",
  "wonderPetPaybackCash",
  "berryRecoveryCash",
  "dreamRecoveryMeso",
  "dreamAuctionRecoveryMeso",
  "keyRecoveryMeso",
  "keyAuctionRecoveryMeso",
  "totalAuctionRecoveryMeso",
  "remainingBlackAuctionRecoveryMeso",
  "remainingWonderBlackRecoveryMeso",
  "remainingSweetAuctionRecoveryMeso",
  "remainingSweetRecoveryMeso",
  "resultRecoveryMeso",
  "recoveryMesoEquivalent",
  "grossMesoEquivalent",
  "netMesoEquivalent",
]);

function scaleExpectedRecord(expected, scale) {
  return Object.fromEntries(
    Object.entries(expected).map(([key, value]) => [
      key,
      typeof value === "number" ? value * scale : value,
    ]),
  );
}

function scaleRouteCosts(costs, scale) {
  const scaled = { ...costs };
  for (const key of ROUTE_CUMULATIVE_COST_KEYS) {
    if (Number.isFinite(costs[key])) scaled[key] = costs[key] * scale;
  }
  return scaled;
}

function percentileCostOptions(context) {
  return {
    ...context.commonOptions,
    costConversionBasis: "maple-point",
  };
}

function percentileViewCacheKey(options, chancePercent) {
  return JSON.stringify([
    normalizePetTargetChance(chancePercent),
    Object.entries(options).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  ]);
}

function stopPercentileWorker() {
  percentileWorker?.terminate();
  percentileWorker = null;
  percentilePendingKey = "";
}

function cachePercentileView(key, result) {
  if (percentileViewCache.has(key)) percentileViewCache.delete(key);
  percentileViewCache.set(key, result);
  if (percentileViewCache.size > PERCENTILE_VIEW_CACHE_LIMIT) {
    percentileViewCache.delete(percentileViewCache.keys().next().value);
  }
}

function requestPercentileView(options, chancePercent) {
  const key = percentileViewCacheKey(options, chancePercent);
  const cached = percentileViewCache.get(key);
  if (cached) {
    cachePercentileView(key, cached);
    if (percentilePendingKey !== key) stopPercentileWorker();
    return { status: "ready", result: cached };
  }
  if (key === percentileErrorKey) {
    if (percentilePendingKey !== key) stopPercentileWorker();
    return { status: "error", message: percentileErrorMessage };
  }
  if (key === percentilePendingKey && percentileWorker) {
    return { status: "loading" };
  }

  stopPercentileWorker();
  const requestId = ++percentileRequestId;
  let worker;
  try {
    worker = new Worker(
      new URL("../workers/pet-percentile.worker.js", import.meta.url),
      { type: "module", name: "pet-percentile" },
    );
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  percentileWorker = worker;
  percentilePendingKey = key;
  percentileErrorKey = "";
  percentileErrorMessage = "";
  worker.onmessage = ({ data }) => {
    if (
      worker !== percentileWorker ||
      data?.requestId !== requestId ||
      data?.key !== key
    ) return;
    stopPercentileWorker();
    if (data.error) {
      percentileErrorKey = key;
      percentileErrorMessage = data.error;
    } else {
      cachePercentileView(key, data.result);
    }
    refreshResult();
  };
  worker.onerror = (event) => {
    if (worker !== percentileWorker) return;
    event.preventDefault();
    stopPercentileWorker();
    percentileErrorKey = key;
    percentileErrorMessage = event.message || "당첨선을 계산하지 못했습니다.";
    refreshResult();
  };
  worker.postMessage({ requestId, key, options, chancePercent });
  return { status: "loading" };
}

function calculateChanceView(context, chancePercent) {
  const baseProjection = calculatePetTargetChanceProjection(
    context.result,
    chancePercent,
  );
  if (baseProjection.mode !== "bundles") {
    return { status: "ready", result: { projection: baseProjection } };
  }
  return requestPercentileView(
    percentileCostOptions(context),
    chancePercent,
  );
}

function resultView(context) {
  const baseResult = context.result;
  if (state.resultMode !== "chance") {
    stopPercentileWorker();
    return {
      chanceMode: false,
      displayResult: baseResult,
      projection: null,
    };
  }

  const chanceRequest = calculateChanceView(
    context,
    state.targetChancePercent,
  );
  if (chanceRequest.status !== "ready") {
    return {
      chanceMode: true,
      displayResult: baseResult,
      pending: chanceRequest.status === "loading",
      error: chanceRequest.status === "error" ? chanceRequest.message : "",
      projection: null,
    };
  }
  const chanceView = chanceRequest.result;
  const projection = chanceView.projection;
  if (projection.mode === "bundles") {
    return {
      chanceMode: true,
      displayResult: baseResult,
      percentileCompletion: chanceView.percentileCompletion,
      percentileResult: chanceView.percentileResult,
      percentileProcurement: chanceView.percentileResult,
      projection,
    };
  }

  const scale = projection.scale;
  const expected = scaleExpectedRecord(baseResult.expected, scale);
  const costs = scaleRouteCosts(baseResult.costs, scale);
  return {
    chanceMode: true,
    displayResult: {
      ...baseResult,
      bundlePurchase: {
        ...baseResult.bundlePurchase,
        applicable: false,
      },
      costs,
      expected,
    },
    projection,
  };
}

function resultCard() {
  let context;
  try {
    context = calculateResultContext();
  } catch (error) {
    return createResultCard(
      "계산 결과",
      element("div", "result-empty", error.message),
    );
  }
  const {
    auctionMarketResult,
    cashBundleWon,
    cashMarketResult,
    cashTradeableBundleSelected,
    cashWonPerEok,
    hasCashRate,
    mesoMarketResult,
    result: baseResult,
  } = context;
  const view = resultView(context);
  if (view.pending || view.error) {
    const recoveryEntered = baseResult.costs.recoveryMesoEquivalent > 0;
    return createResultCard(
      "계산 결과",
      petReachChanceControl(baseResult, {
        recoveryEntered,
        getProjection: (chancePercent) => {
          const request = calculateChanceView(context, chancePercent);
          return request.status === "ready" ? request.result.projection : null;
        },
        onViewChange: refreshResultContent,
      }),
      element(
        "div",
        "result-empty",
        view.error || "원더베리 묶음 당첨선을 계산하는 중…",
      ),
    );
  }
  const result = view.displayResult;

  const percentileBundle =
    view.chanceMode && view.projection.mode === "bundles";
  const bundlePurchase = !percentileBundle && result.bundlePurchase?.applicable
    ? result.bundlePurchase
    : null;
  const percentileCompletion = percentileBundle
    ? view.percentileCompletion
    : null;
  const activeExpected =
    percentileCompletion?.expected ??
    bundlePurchase?.expected ??
    result.expected;
  const activeCosts =
    percentileCompletion?.costs ?? bundlePurchase?.costs ?? result.costs;
  const activeRecovery =
    percentileCompletion?.recovery ??
    bundlePurchase?.recovery ??
    result.recovery;
  const activeProcurement = percentileBundle
    ? percentileCompletion?.procurement ?? null
    : bundlePurchase?.procurement ?? null;
  const metricPrefix = view.chanceMode
    ? view.projection.mode === "routes"
      ? `${view.projection.routes.toLocaleString("ko-KR")}경로분 예상`
      : "당첨선"
    : "평균";
  const chanceLimitLabel = view.chanceMode
    ? view.projection.mode === "bundles"
      ? `원더베리 ${(view.projection.completionBundles ?? view.projection.bundles).toLocaleString("ko-KR")}묶음`
      : `${view.projection.routes.toLocaleString("ko-KR")}경로`
    : "";
  const percentileFailure = view.chanceMode
    ? Math.max(0, 1 - view.projection.actualChance)
    : 0;
  const recoveryEntered = activeCosts.recoveryMesoEquivalent > 0;
  const berryMaplePoints =
    activeCosts.berryMaplePoints ?? activeCosts.berryCash;
  const crystalMaplePoints =
    activeCosts.crystalMaplePoints ?? activeCosts.crystalCash;
  const wonderPetPaybackMaplePoints =
    activeCosts.wonderPetPaybackMaplePoints ??
    activeCosts.wonderPetPaybackCash;
  const hybridProcurement =
    activeProcurement?.selectedProcurement === "hybrid-bundle";
  const activeCashBundleCount = cashTradeableBundleSelected
    ? Number(
        hybridProcurement
          ? activeProcurement?.sourceBreakdown?.auctionBase
              ?.purchasedBundles ?? 0
          : activeExpected.purchasedAuctionWonderBerryBundles ?? 0,
      )
    : 0;
  const activeCashBundleWon = activeCashBundleCount * cashBundleWon;
  const heroValue = recoveryEntered
    ? percentileCompletion || bundlePurchase
      ? activeCosts.netMesoEquivalentAfterRemainingInventoryRecovery ??
        activeCosts.netMesoEquivalentAfterRemainingBlackSale ??
        activeCosts.netMesoEquivalent
      : activeCosts.netMesoEquivalent
    : activeCosts.grossMesoEquivalent;
  const hero = element("div", "result-hero result-hero--pet");
  const heroHead = element("div", "pet-result-hero__head");
  heroHead.append(
    element(
      "span",
      "result-hero__label",
      view.chanceMode
        ? `${formatTargetChance(state.targetChancePercent)}% 당첨선 · ${recoveryEntered ? "회수 반영 " : ""}예상 총지출`
        : bundlePurchase
          ? recoveryEntered
            ? `자석펫 ${result.targetCount}마리 · 회수 반영 실제 구매 평균 비용`
            : `자석펫 ${result.targetCount}마리 · 실제 구매 평균 비용`
          : recoveryEntered
            ? `자석펫 ${result.targetCount}마리 · 회수 반영 평균 비용`
            : `자석펫 ${result.targetCount}마리 · 평균 환산 비용`,
    ),
    resultUnitControl(),
  );
  hero.append(
    heroHead,
    element(
      "strong",
      "",
      formatResultCost(heroValue),
    ),
    element(
      "span",
      "pet-result-basis",
      view.chanceMode
        ? `${chanceLimitLabel} 이내 · 전체의 ${formatProbability(view.projection.actualChance)}가 이 시점까지 획득 · 이후 미획득 ${formatProbability(percentileFailure)}`
        : state.resultUnit === "won"
          ? hasCashRate
            ? `1억 메소 ${cashWonPerEok.toLocaleString("ko-KR")}원 기준`
            : "1억 메소 시세(원)를 입력하면 원으로 환산합니다."
          : state.resultUnit === "maple-point"
            ? `1억 메소 ${Number(state.mesoMarketMaplePointsPerEok).toLocaleString("ko-KR")}메포 기준`
            : `메포 비용은 메소마켓 1억 ${Number(state.mesoMarketMaplePointsPerEok).toLocaleString("ko-KR")}메포로 환산`,
    ),
  );

  const resultMetrics = percentileBundle
    ? [
        metric(
          `${formatTargetChance(state.targetChancePercent)}% 당첨선`,
          `원더베리 ${(view.projection.completionBundles ?? view.projection.bundles).toLocaleString("ko-KR")}묶음 이내`,
        ),
        metric(
          "구매 원더베리",
          `${view.projection.preparation.suppliedWonderBerries.toLocaleString("ko-KR")}개 · ${view.projection.purchaseBundles.toLocaleString("ko-KR")}묶음`,
        ),
        view.projection.preparation.unopenedWonderBerries > 0
          ? metric(
              "미개봉 원더베리",
              `${view.projection.preparation.unopenedWonderBerries.toLocaleString("ko-KR")}개`,
            )
          : null,
        metric(
          "원더베리 조달비",
          formatResultCost(activeCosts.berryProcurementMesoEquivalent),
        ),
        metric(
          "당첨선 예상 원더 블랙",
          formatCount(activeExpected.wonderBlacksPulled, "마리"),
        ),
        metric(
          "당첨선 예상 사용 블랙",
          formatCount(activeExpected.wonderBlacksConsumed, "마리"),
        ),
        metric(
          "당첨선 예상 잔여 블랙",
          formatCount(activeExpected.remainingWonderBlacks, "마리", 2),
        ),
        metric(
          "당첨선 예상 루나 크리스탈",
          formatCount(activeExpected.lunaCrystals, "개"),
        ),
        metric(
          "당첨선 예상 총 합성",
          formatCount(activeExpected.totalSyntheses),
        ),
        metric(
          "당첨선 예상 루나 드림",
          formatCount(activeExpected.lunaDreams, "마리"),
        ),
        metric(
          "당첨선 예상 크리스탈 키",
          formatCount(activeExpected.lunaKeys, "개"),
        ),
        metric(
          `${(view.projection.completionBundles ?? view.projection.bundles).toLocaleString("ko-KR")}묶음 개봉 후 미획득`,
          formatProbability(percentileFailure),
        ),
      ]
    : bundlePurchase
    ? [
        metric(
          `${metricPrefix} 구매량`,
          formatCount(
            activeExpected.purchasedUnits ?? activeExpected.purchasedBundles,
            bundlePurchase.purchaseUnitLabel ??
              bundlePurchase.policy?.purchaseUnitLabel ??
              "묶음",
            2,
          ),
        ),
        metric(
          `${metricPrefix} 개봉 원더베리`,
          formatCount(activeExpected.openedWonderBerries, "개"),
        ),
        metric(
          `${metricPrefix} 뽑은 원더 블랙`,
          formatCount(activeExpected.wonderBlacksPulled, "마리"),
        ),
        metric(
          `${metricPrefix} 사용 원더 블랙`,
          formatCount(activeExpected.wonderBlacksConsumed, "마리"),
        ),
        metric(
          `${metricPrefix} 남는 원더 블랙`,
          formatCount(activeExpected.remainingWonderBlacks, "마리", 2),
        ),
        metric(
          `${metricPrefix} 루나 크리스탈`,
          formatCount(activeExpected.lunaCrystals, "개"),
        ),
        metric(
          `${metricPrefix} 총 합성`,
          formatCount(activeExpected.totalSyntheses),
        ),
        metric(
          `${metricPrefix} 루나 드림`,
          formatCount(activeExpected.lunaDreams, "마리"),
        ),
        metric(
          `${metricPrefix} 크리스탈 키`,
          formatCount(activeExpected.lunaKeys, "개"),
        ),
      ]
    : [
        view.chanceMode
          ? metric(
              `${formatTargetChance(state.targetChancePercent)}% 당첨선`,
              `${view.projection.routes.toLocaleString("ko-KR")}경로 이내`,
            )
          : null,
        result.expected.wonderBerries > 0
          ? metric(
              `${metricPrefix} 원더베리`,
              formatCount(result.expected.wonderBerries, "개"),
            )
          : metric(
              "적용 원더 블랙 시세",
              formatMeso(result.comparison.auctionMesoPerBlack),
            ),
        result.selectedSource === "mixed"
          ? metric(
              `${metricPrefix} 경매장 블랙`,
              formatCount(result.expected.wonderBlacksFromAuction, "마리"),
            )
          : null,
        metric(
          `${metricPrefix} 원더 블랙`,
          formatCount(result.expected.wonderBlacks, "마리"),
        ),
        metric(
          `${metricPrefix} 루나 크리스탈`,
          formatCount(result.expected.lunaCrystals, "개"),
        ),
        metric(
          `${metricPrefix} 총 합성`,
          formatCount(result.expected.totalSyntheses),
        ),
        metric(
          `${metricPrefix} 루나 드림`,
          formatCount(result.expected.lunaDreams, "마리"),
        ),
        metric(
          `${metricPrefix} 크리스탈 키`,
          formatCount(result.expected.lunaKeys, "개"),
        ),
      ];
  const synthesisResultTradable =
    activeProcurement?.tradeability?.synthesisResultTradable === true;
  const remainingBlackLines = activeRecovery.remainingBlackMethod ===
      "source-specific"
    ? [
        activeRecovery.remainingTradeableBlackMethod === "auction" &&
          activeCosts.remainingTradeableBlackAuctionRecoveryMeso > 0
          ? resultLine(
              "남은 교가 원더 블랙 판매",
              `${formatCount(activeExpected.remainingTradeableWonderBlacks, "마리", 2)} · ${formatMeso(activeCosts.remainingTradeableBlackAuctionRecoveryMeso)}`,
            )
          : activeCosts.remainingTradeableBlackPaybackMaplePoints > 0
            ? resultLine(
                "남은 교가 원더 블랙 페이백",
                `${formatCount(activeExpected.remainingTradeableWonderBlacks, "마리", 2)} · ${formatMaplePoints(activeCosts.remainingTradeableBlackPaybackMaplePoints)}`,
              )
            : null,
        activeRecovery.remainingUntradeableBlackMethod === "keep" &&
          activeExpected.remainingUntradeableWonderBlacks > 0
          ? resultLine(
              "남은 교불 원더 블랙 보관",
              formatCount(
                activeExpected.remainingUntradeableWonderBlacks,
                "마리",
                2,
              ),
            )
          : null,
      ]
    : [
        activeRecovery.remainingBlackMethod === "auction" &&
          activeCosts.remainingBlackAuctionRecoveryMeso > 0
          ? resultLine(
              "남은 교가 원더 블랙 판매",
              `${formatCount(activeExpected.remainingWonderBlacks, "마리", 2)} · ${formatMeso(activeCosts.remainingBlackAuctionRecoveryMeso)}`,
            )
          : activeRecovery.remainingBlackMethod === "keep" &&
              activeExpected.remainingWonderBlacks > 0
            ? resultLine(
                "남은 교불 원더 블랙 보관",
                formatCount(
                  activeExpected.remainingWonderBlacks,
                  "마리",
                  2,
                ),
              )
            : null,
      ];
  const resultContent = element("div", "pet-result-content");
  const resultContentParts = [
    hero,
    metricGrid(...resultMetrics),
    resultLine(
      "완성 결과",
      requiresTradeableOutput() ? "교가" : "교불",
    ),
    procurementSummary(activeProcurement, {
      tradeableOutputRequired: requiresTradeableOutput(),
      cashTradeableBundleSelected,
      cashBundleWon,
    }),
    resultLine("원더 블랙 확률", formatProbability(result.probabilities.wonderBlack)),
    resultLine("한 경로의 자석펫 확률", formatProbability(result.probabilities.routeSuccess)),
    berryMaplePoints > 0
      ? resultLine(
          hybridProcurement
            ? `${metricPrefix} 메포 원더베리 묶음 (교불 재료)`
            : percentileBundle
            ? "당첨선 원더베리 결제"
            : bundlePurchase
            ? `${metricPrefix} 원더베리 실제 결제`
            : `${metricPrefix} 원더베리 비용`,
          formatMaplePoints(berryMaplePoints),
        )
      : null,
    activeCosts.wonderBerryAuctionBundleMeso > 0
      ? resultLine(
          cashTradeableBundleSelected
            ? hybridProcurement
              ? `${metricPrefix} 캐시 원더베리 묶음 (교가 베이스)`
              : `${metricPrefix} 캐시 원더베리 묶음 구매`
            : hybridProcurement
              ? `${metricPrefix} 경매장 원더베리 묶음 (교가 베이스)`
              : `${metricPrefix} 경매장 원더베리 묶음 구매`,
          cashTradeableBundleSelected
            ? formatWon(activeCashBundleWon)
            : formatMeso(activeCosts.wonderBerryAuctionBundleMeso),
        )
      : null,
    resultLine(
      `${metricPrefix} 루나 크리스탈 비용`,
      formatMaplePoints(crystalMaplePoints),
    ),
    result.costs.blackMeso > 0
      ? resultLine(
          `${metricPrefix} 원더 블랙 구매 비용`,
          formatMeso(result.costs.blackMeso),
        )
      : null,
    wonderPetPaybackMaplePoints > 0
      ? resultLine(
          "원더 펫 페이백",
          `${formatCount(activeExpected.wonderPetPaybacks, "마리")} · ${formatMaplePoints(wonderPetPaybackMaplePoints)}`,
        )
      : null,
    activeRecovery.dreamMethod === "auction" &&
      activeCosts.dreamAuctionRecoveryMeso > 0
      ? resultLine(
          "루나 드림 판매",
          `${formatCount(activeExpected.lunaDreams, "마리")} · ${formatMeso(activeCosts.dreamAuctionRecoveryMeso)}`,
        )
      : activeCosts.dreamPaybackMaplePoints > 0
        ? resultLine(
            synthesisResultTradable
              ? "교가 루나 드림 페이백"
              : "교불 루나 드림 페이백",
            `${formatCount(activeExpected.lunaDreams, "마리")} · ${formatMaplePoints(activeCosts.dreamPaybackMaplePoints)}`,
          )
        : null,
    activeCosts.keyAuctionRecoveryMeso > 0
      ? resultLine(
          "크리스탈 키 판매",
          `${formatCount(activeExpected.lunaKeys, "개")} · ${formatMeso(activeCosts.keyAuctionRecoveryMeso)}`,
        )
      : null,
    ...remainingBlackLines,
    activeRecovery.remainingSweetMethod === "auction" &&
      activeCosts.remainingSweetAuctionRecoveryMeso > 0
      ? resultLine(
          "남은 루나 스윗 판매",
          `${formatCount(activeExpected.remainingLunaSweets, "마리", 2)} · ${formatMeso(activeCosts.remainingSweetAuctionRecoveryMeso)}`,
        )
      : activeCosts.remainingSweetPaybackMaplePoints > 0
        ? resultLine(
            "남은 루나 스윗 페이백",
            `${formatCount(activeExpected.remainingLunaSweets, "마리", 2)} · ${formatMaplePoints(activeCosts.remainingSweetPaybackMaplePoints)}`,
          )
        : null,
    activeCosts.recoveryMesoEquivalent > 0
      ? resultLine(
          "부산물 총 회수 (메소 환산)",
          formatMeso(activeCosts.recoveryMesoEquivalent),
        )
      : null,
    percentileBundle
      ? stageList({ ...result, bundlePurchase: percentileCompletion })
      : stageList(result),
    purchaseGuide({
      auctionMarketResult,
      cashMarketResult,
      mesoMarketResult,
    }),
  ];
  resultContent.append(...resultContentParts.filter(Boolean));
  const cardNode = createResultCard(
    "계산 결과",
    petReachChanceControl(baseResult, {
      recoveryEntered,
      getProjection: (chancePercent) =>
        calculateChanceView(context, chancePercent).result?.projection ?? null,
      onViewChange: refreshResultContent,
    }),
    resultContent,
  );
  return cardNode;
}

function render() {
  const grid = element("div", "calculator-grid");
  const left = element("div", "calculator-column");
  left.append(targetCard(), costCard(), probabilityCard());
  const result = element("aside", "calculator-result");
  result.append(resultCard());
  grid.append(left, result);
  renderWithFocus(root, [grid]);
  placePurchaseGuide();
}

render();
window.addEventListener("pagehide", stopPercentileWorker, { once: true });

registerResultShare(() => ({ local: { [STORAGE_KEY]: state } }));
