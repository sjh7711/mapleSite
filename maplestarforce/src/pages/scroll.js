import { SCROLL_PRICE_DEFAULTS, migrateScrollPrices } from "../shared/scroll-price-defaults.js";
import {
  TRACE_SLOTS,
  calculateMagicalReturnCraftProgress,
  calculateSlotCraft,
  chaosAtLeast,
  chaosSumAtLeast,
  earringSuccessRate,
  specialTraceCost,
  traceCost,
  traceSuccessRate,
} from "maple-core/scroll";
import { renderToolNav } from "../shared/shell.js";
import { chip, field, numberInput, toggleChip } from "../shared/ui.js";
import {
  card,
  details,
  element,
  metric,
  metricGrid,
  note,
  renderWithFocus,
  resetAction,
  resultCard as createResultCard,
  resultHero,
  row,
  segmentedControl as chipRow,
} from "../shared/calculator-ui.js";
import {
  buildCleanRestoreChoices,
  calculateAutomaticFirstChaos,
  expectedSupportScrollQuantities,
  expectedTraceUsage,
  isChaosFirstEnabled,
  migrateLegacySlotState,
  slotCraftState,
  supportScrollPurchaseThresholds,
} from "../shared/scroll-options.js";

renderToolNav(document.querySelector("#toolnav"), "scroll");

const METHODS = {
  trace: { name: "주흔작", kind: "slot", description: "주문의 흔적과 순백·이노센트 재고를 반영한 비용 전략" },
  earring: { name: "귀지작", kind: "slot", description: "10% 귀 장식 주문서 완작" },
  firstChaos: { name: "놀긍첫작", kind: "firstChaos", description: "원하는 놀긍 첫작이 붙을 때까지의 평균 비용" },
  chaosReturn: { name: "놀긍리턴", kind: "return", description: "누적 목표에 맞춰 놀긍 결과를 채택하고 리턴" },
  magical: { name: "매지컬리턴", kind: "magical", description: "첫작은 (아크) 이노센트, 나머지는 리턴으로 매지컬 공·마 +11 완작" },
};

const SLOT_IDS = Object.keys(TRACE_SLOTS);
const TRACE_LEVEL_RANGE = {
  weapon: [100, 200],
  armor: [100, 250],
  glove: [100, 250],
  accessory: [100, 200],
  heart: [100, 130],
};
const STATS = ["STR", "DEX", "INT", "LUK"];
const SCROLL_SETTINGS_VERSION = 7;
const MAX_WORK_COUNT = 12;
const MAGICAL_TARGET = 11;
const MAGICAL_TOTAL_WORKS = 10;
const DEFAULT_RETURN_ATTACK_TARGET = 6;
const DEFAULT_MAGICAL_COMPLETED_COUNT = 0;
let characterProfileModule = null;
let characterProfilePromise = null;
let characterProfileUnsubscribe = () => {};
let rerenderWhenCharacterProfileLoads = false;
let pageDisposed = false;

function loadCharacterProfile({ rerender = false } = {}) {
  rerenderWhenCharacterProfileLoads ||= rerender;
  characterProfilePromise ??= import("../shared/character-profile.js")
    .then((module) => {
      characterProfileModule = module;
      if (!pageDisposed) {
        characterProfileUnsubscribe = module.subscribeCharacterProfile(render);
        if (rerenderWhenCharacterProfileLoads) render();
      }
      return module;
    })
    .catch((error) => {
      characterProfilePromise = null;
      throw error;
    });
  return characterProfilePromise;
}

function characterProfileCardForRender() {
  if (characterProfileModule) return characterProfileModule.characterProfileCard();
  void loadCharacterProfile({ rerender: true }).catch(() => {});
  return card(
    "내 캐릭터 정보 불러오기",
    element("div", "result-empty", "캐릭터 정보를 준비하는 중…"),
  );
}

function normalizeWorkCount(value, fallback = 8) {
  const numeric = Number(value);
  const rounded = Math.round(Number.isFinite(numeric) ? numeric : fallback);
  return Math.min(MAX_WORK_COUNT, Math.max(1, rounded));
}

const state = {
  settingsVersion: SCROLL_SETTINGS_VERSION,
  method: "trace",
  traceRate: 15,
  // 15%가 없는 부위에 다녀와도 고르던 확률을 잊지 않는다.
  preferredRate: 15,
  slot: "armor",
  itemLevel: 200,
  halfPrice: false,

  remaining: 8,
  recoverable: 0,
  workCount: 8,
  magicalCompletedCount: DEFAULT_MAGICAL_COMPLETED_COUNT,
  returnAppliedWorks: 0,
  returnCurrentAttack: 0,
  returnCurrentStat: 0,

  fever: true,
  guild: true,
  guildProtection: 4,
  dexterityLevel: 100,

  chaosFirst: false,
  chaosFirstAttack: 6,
  chaosFirstStat: 0,

  // 놀긍리턴은 첫 작만 이노센트로 띄우고 이후부터 리턴을 쓰는 전략을
  // 별도로 계산한다. 첫 작의 60%/100%는 시세와 보유량으로 자동 선택한다.
  returnFirst: true,
  returnFirstAttack: 6,
  returnFirstStat: 6,
  returnFirstStarforced: false,
  magicalFirstStarforced: false,

  attackTarget: DEFAULT_RETURN_ATTACK_TARGET,
  statTarget: 2,
  stats: { STR: true, DEX: false, INT: false, LUK: false },
  returnPrice: SCROLL_PRICE_DEFAULTS.returnPrice,
  magicalPrice: SCROLL_PRICE_DEFAULTS.magicalPrice,

  // 주문서와 리턴 스크롤 가격은 모두 만 메소 단위로 받는다.
  tracePer1000: 140,
  earringPrice: SCROLL_PRICE_DEFAULTS.earringPrice,
  chaos60Price: SCROLL_PRICE_DEFAULTS.chaos60Price,
  chaos100Price: SCROLL_PRICE_DEFAULTS.chaos100Price,
  chaos100Stock: 0,

  clean10Price: 140,
  clean5Price: 70,
  innocent50Price: 800,
  useInnocent: true,
  useCleanScrolls: true,
  preserveStarforce: false,

  cleanStock: 0,
  innocentStock: 0,
  arkInnocentStock: 0,
  maplePointsPerEok: 2000,
  returnResultUnit: "meso",
};

try {
  const saved = JSON.parse(localStorage.getItem("maplestarforce:scroll:v2")) ?? {};
  const savedVersion = Number(saved.settingsVersion) || 0;
  Object.assign(state, migrateScrollPrices(saved));
  state.workCount = normalizeWorkCount(
    Object.hasOwn(saved, "workCount")
      ? saved.workCount
      : saved.remaining ?? state.workCount,
  );
  state.magicalCompletedCount = Math.min(
    MAGICAL_TOTAL_WORKS,
    Math.max(
      0,
      Math.round(
        Number.isFinite(Number(saved.magicalCompletedCount))
          ? Number(saved.magicalCompletedCount)
          : DEFAULT_MAGICAL_COMPLETED_COUNT,
      ),
    ),
  );
  if (!Object.hasOwn(saved, "recoverable") && Object.hasOwn(saved, "slots")) {
    Object.assign(state, migrateLegacySlotState(saved));
  }
  if (savedVersion < 3) {
    state.preserveStarforce = false;
    state.halfPrice = false;
  }
  if (savedVersion < 5) {
    // 새 놀긍리턴 공·마 목표를 한 번만 기존 저장값에 적용한다.
    state.attackTarget = DEFAULT_RETURN_ATTACK_TARGET;
  }
  if (savedVersion < 6) {
    // 이전 값은 앞으로 작업할 횟수였으므로 의미가 반대인 완료 횟수로
    // 재사용하지 않고 미완료 상태에서 시작한다.
    state.magicalCompletedCount = DEFAULT_MAGICAL_COMPLETED_COUNT;
  }
  // 기존 놀긍떡작 저장값은 같은 위치의 독립 놀긍첫작 계산으로 이어 간다.
  if (saved.method === "spam") state.method = "firstChaos";
  if (!METHODS[state.method]) state.method = "trace";
  state.settingsVersion = SCROLL_SETTINGS_VERSION;
  delete state.slots;
  // 현재 작업량은 인게임에 표시되는 잔여와 복구 가능만으로 계산한다.
  delete state.success;
  // 예전 O/X 토글은 계산 조건을 설명하는 값이었을 뿐 전략값이 아니었다.
  // X로 저장한 사용자도 새 계산이 막히지 않도록 저장 흔적을 제거한다.
  delete state.hasChaosOptions;
  // 첫작 주문서 확률은 이제 계산기가 자동 선택한다.
  delete state.returnFirstRate;
  // 매지컬리턴 목표는 공·마 +11로 고정한다.
  delete state.magicalTarget;
  delete state.magicalWorkCount;
  // 놀긍첫작은 보유 100%를 먼저 쓰고 이후 60%를 사용하므로 확률 선택값이 없다.
  delete state.chaosRate;
  if (typeof state.useCleanScrolls !== "boolean") state.useCleanScrolls = true;
  // 예전 화면의 `원` 선택값은 같은 수치의 실제 결제 단위인 메포로 이전한다.
  if (state.returnResultUnit === "won") state.returnResultUnit = "maplePoints";
  if (!["maplePoints", "meso"].includes(state.returnResultUnit)) {
    state.returnResultUnit = "maplePoints";
  }
} catch {
  // 저장값이 깨졌으면 위 기본값으로 계산한다.
}

const MESO = 100_000_000;
const MAN = 10_000;
const MAX_RETURN_STOCK = 100;
const root = document.querySelector("#tool");
let policyDetailsOpen = false;
let policyDetailsForRender = null;
let returnEconomyWorker = null;
let returnEconomyPendingKey = "";
let returnEconomyRequestId = 0;
let returnEconomyCacheKey = "";
let returnEconomyCacheResult = null;
let returnEconomyErrorKey = "";
let returnEconomyErrorMessage = "";

const eok = (meso) => `${(meso / MESO).toFixed(2)}억`;
const eokMeso = (meso) => `${eok(meso)} 메소`;
const maplePoints = (value) => {
  if (!Number.isFinite(value)) return "계산 불가";
  if (Math.abs(value) >= MAN) {
    return `${(value / MAN).toLocaleString("ko-KR", {
      maximumFractionDigits: 1,
    })}만 메포`;
  }
  return `${Math.round(value).toLocaleString("ko-KR")}메포`;
};
const times = (value) => `${value.toFixed(1)}회`;
const sheets = (value) => `${value.toFixed(1)}장`;
const successPercent = (rate) =>
  `${(rate * 100).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}%`;

function selectedWorkCount(value) {
  const slots = Math.round(Number(value));
  return Number.isFinite(slots) && slots >= 1 && slots <= MAX_WORK_COUNT
    ? slots
    : null;
}

function selectedMagicalCompletedCount(value) {
  const completed = Number(value);
  return Number.isInteger(completed) &&
      completed >= 0 &&
      completed <= MAGICAL_TOTAL_WORKS
    ? completed
    : null;
}

function hasAppliedReturnWorks() {
  return Number(state.returnAppliedWorks) > 0;
}

function usesReturnFirstWork() {
  return !hasAppliedReturnWorks() && state.returnFirst;
}

function invalidWorkCountResult(label) {
  return createResultCard(
    "계산 결과",
    element(
      "div",
      "result-empty",
      `${label}는 1~${MAX_WORK_COUNT}회로 입력해 주세요.`,
    ),
  );
}

function invalidMagicalCompletedCountResult() {
  return createResultCard(
    "계산 결과",
    element(
      "div",
      "result-empty",
      `완료한 주문서 횟수는 0~${MAGICAL_TOTAL_WORKS}회로 입력해 주세요.`,
    ),
  );
}

function stopReturnEconomyWorker() {
  if (returnEconomyWorker) {
    returnEconomyWorker.onmessage = null;
    returnEconomyWorker.onerror = null;
    returnEconomyWorker.onmessageerror = null;
    returnEconomyWorker.terminate();
  }
  returnEconomyWorker = null;
  returnEconomyPendingKey = "";
}

function settleReturnEconomyWorker(worker, requestId, key, payload) {
  if (
    returnEconomyWorker !== worker ||
    requestId !== returnEconomyRequestId ||
    key !== returnEconomyPendingKey
  ) {
    return;
  }

  stopReturnEconomyWorker();
  if (payload.error) {
    returnEconomyErrorKey = key;
    returnEconomyErrorMessage = payload.error;
  } else {
    returnEconomyCacheKey = key;
    returnEconomyCacheResult = payload.result;
    returnEconomyErrorKey = "";
    returnEconomyErrorMessage = "";
  }
  render();
}

function requestReturnEconomy(options) {
  const key = JSON.stringify(options);
  if (key === returnEconomyCacheKey && returnEconomyCacheResult) {
    if (returnEconomyPendingKey !== key) stopReturnEconomyWorker();
    return { status: "ready", result: returnEconomyCacheResult };
  }
  if (key === returnEconomyErrorKey) {
    if (returnEconomyPendingKey !== key) stopReturnEconomyWorker();
    return { status: "error", message: returnEconomyErrorMessage };
  }
  if (key === returnEconomyPendingKey && returnEconomyWorker) {
    return { status: "loading" };
  }

  // 입력이 바뀌면 오래 걸리는 이전 계산을 즉시 버리고 최신 요청만 남긴다.
  stopReturnEconomyWorker();
  const requestId = ++returnEconomyRequestId;
  let worker;
  try {
    worker = new Worker(
      new URL("../workers/scroll-return.worker.js", import.meta.url),
      { type: "module", name: "scroll-return-economy" },
    );
  } catch (error) {
    returnEconomyErrorKey = key;
    returnEconomyErrorMessage = error instanceof Error ? error.message : String(error);
    return { status: "error", message: returnEconomyErrorMessage };
  }

  returnEconomyWorker = worker;
  returnEconomyPendingKey = key;
  returnEconomyErrorKey = "";
  returnEconomyErrorMessage = "";

  worker.onmessage = (event) => {
    const payload = event.data ?? {};
    settleReturnEconomyWorker(worker, payload.requestId, payload.key, payload);
  };
  worker.onerror = (event) => {
    event.preventDefault();
    settleReturnEconomyWorker(worker, requestId, key, {
      error: event.message || "계산 Worker를 실행하지 못했습니다.",
    });
  };
  worker.onmessageerror = () => {
    settleReturnEconomyWorker(worker, requestId, key, {
      error: "계산 결과를 읽지 못했습니다.",
    });
  };

  try {
    worker.postMessage({ requestId, key, options });
  } catch (error) {
    stopReturnEconomyWorker();
    returnEconomyErrorKey = key;
    returnEconomyErrorMessage = error instanceof Error ? error.message : String(error);
    return { status: "error", message: returnEconomyErrorMessage };
  }
  return { status: "loading" };
}

function returnCalculationCard(status, message = "") {
  const box = element("div", `scroll-return-calculation scroll-return-calculation--${status}`);
  box.setAttribute("role", status === "error" ? "alert" : "status");
  box.setAttribute("aria-live", "polite");
  if (status === "loading") {
    const spinner = element("span", "scroll-return-calculation__spinner");
    spinner.setAttribute("aria-hidden", "true");
    box.append(
      spinner,
      element("strong", "scroll-return-calculation__title", "놀긍리턴 계산 중"),
      element(
        "p",
        "scroll-return-calculation__description",
        "목표가 높거나 작업 횟수가 많으면 잠시 걸릴 수 있습니다. 입력과 다른 계산기는 계속 사용할 수 있습니다.",
      ),
    );
  } else {
    box.append(
      element("strong", "scroll-return-calculation__title", "계산 오류"),
      element(
        "p",
        "scroll-return-calculation__description",
        message || "놀긍리턴 계산을 완료하지 못했습니다. 값을 변경한 뒤 다시 시도해 주세요.",
      ),
    );
  }
  return createResultCard("계산 결과", box);
}

function save() {
  try {
    localStorage.setItem("maplestarforce:scroll:v2", JSON.stringify(state));
  } catch {
    // 저장을 막은 브라우저에서도 현재 탭 계산은 계속한다.
  }
}

function settingsSection(title, area, ...children) {
  const section = element(
    "section",
    `scroll-settings-section scroll-settings-section--${area}`,
  );
  if (title) section.append(element("h2", "", title));
  section.append(...children.filter(Boolean));
  return section;
}

function settingsSectionWithHead(title, area, action, ...children) {
  const section = element(
    "section",
    `scroll-settings-section scroll-settings-section--${area}`,
  );
  const head = element("div", "card__head");
  head.append(element("h2", "", title), action);
  section.append(head, ...children.filter(Boolean));
  return section;
}

function scrollSettingsCard(method, equipment, chaos, cost) {
  const section = element("section", "card scroll-settings-card");
  section.setAttribute("aria-label", "주문서 설정");
  const grid = element("div", "scroll-settings-grid");
  const lowerGrid = element("div", "scroll-settings-lower");
  const leftColumn = element(
    "div",
    "scroll-settings-column scroll-settings-column--left",
  );
  const rightColumn = element(
    "div",
    "scroll-settings-column scroll-settings-column--right",
  );
  leftColumn.append(...[equipment, chaos].filter(Boolean));
  rightColumn.append(...[cost].filter(Boolean));
  lowerGrid.append(leftColumn, rightColumn);
  grid.append(method, lowerGrid);
  section.append(grid);
  return section;
}

function firstWorkOption() {
  const option = element("div", "scroll-chaos-first");
  option.append(
    element("span", "scroll-chaos-first__label", "첫 작 옵션"),
    chipRow([toggle("chaosFirst", "첫작놀긍")]),
  );
  return option;
}

function returnFirstWorkOption(disabled = false) {
  const option = element("div", "scroll-chaos-first");
  option.dataset.disabled = String(disabled);
  option.append(
    chipRow([
      toggleChip(
        "놀긍 첫작",
        !disabled && state.returnFirst === true,
        () => {
          state.returnFirst = !state.returnFirst;
          render();
        },
        disabled,
      ),
    ]),
  );
  return option;
}

function resetReturnProgressInputs() {
  Object.assign(state, {
    returnAppliedWorks: 0,
    returnCurrentAttack: 0,
    returnCurrentStat: 0,
  });
  render();
}

function returnProgressResetButton() {
  return resetAction("입력값 초기화", resetReturnProgressInputs, {
    disabled: ![
    state.returnAppliedWorks,
    state.returnCurrentAttack,
    state.returnCurrentStat,
    ].some((value) => Number(value) !== 0),
    title: "이미 적용한 작 수와 현재 적용된 상승량만 0으로 되돌립니다.",
    ariaLabel: "놀긍리턴 장비 입력값 초기화",
    key: "reset-return-progress",
  });
}

function line(label, value, strong = false) {
  const p = document.createElement("p");
  p.className = "result__line";
  const tag = strong ? "strong" : "span";
  p.innerHTML = `<span>${label}</span><${tag}>${value}</${tag}>`;
  return p;
}

function supportScrollSourceLabel(optionName, scrollName) {
  const tracePrefix = `주흔 ${scrollName} `;
  if (optionName.startsWith(tracePrefix)) {
    return `주흔 ${optionName.slice(tracePrefix.length)}`;
  }
  const purchasePrefix = `${scrollName} `;
  if (optionName.startsWith(purchasePrefix)) {
    return `구매 ${optionName.slice(purchasePrefix.length)}`;
  }
  return optionName;
}

function supportScrollUsageMetric(label, entries) {
  const box = element("div", "metric metric--support");
  const rows = element("div", "support-metric__rows");
  for (const entry of entries.filter(Boolean)) {
    const row = element("div", "support-metric__row");
    row.append(
      element(
        "span",
        `support-metric__source support-metric__source--${entry.kind}`,
        entry.label,
      ),
      element("strong", "support-metric__value", sheets(entry.value)),
    );
    rows.append(row);
  }
  box.append(element("span", "support-metric__title", label), rows);
  return box;
}

function firstChaosUsageLine(first) {
  const row = element("div", "result__line scroll-first-usage");
  const values = element("div", "scroll-first-usage__values");
  const breakdown = [
    first.chaos100Stock > 0
      ? `100% ${times(first.ownedChaos100Used)}`
      : null,
    `60% ${times(first.purchasedChaos60)}`,
  ].filter(Boolean).join(" · ");
  values.append(
    element("strong", "", `총 ${times(first.scrolls)}`),
    element("span", "scroll-first-usage__breakdown", breakdown),
  );
  row.append(
    element("span", "scroll-first-usage__label", "첫 작 평균 놀긍"),
    values,
  );
  return row;
}

function firstChaosTargetChanceLine(first) {
  const row = element("div", "result__line scroll-first-hit");
  const values = element("div", "scroll-first-hit__values");
  const chance = (label, value) => {
    const item = element("span", "scroll-first-hit__item");
    item.append(
      element("span", "scroll-first-hit__name", label),
      element("strong", "", `${(value * 100).toFixed(3)}%`),
    );
    return item;
  };

  if (first.chaos100Stock > 0) {
    values.append(chance("보유 놀긍 100%", first.targetChance100));
  }
  values.append(
    chance(
      first.chaos100Stock > 0 ? "소진 후 놀긍 60%" : "놀긍 60%",
      first.targetChance60,
    ),
  );
  row.append(
    element("span", "scroll-first-hit__label", "첫 작 목표 적중률"),
    values,
  );
  return row;
}

function returnCostHero(label, value, { showUnitToggle = true } = {}) {
  const box = element(
    "div",
    showUnitToggle ? "result-hero result-hero--switchable" : "result-hero",
  );
  const head = element("div", "result-hero__head");
  head.append(element("span", "result-hero__label", label));
  if (showUnitToggle) {
    head.append(chipRow(
      [
        choice("returnResultUnit", "maplePoints", "메포"),
        choice("returnResultUnit", "meso", "메소"),
      ],
      "result-unit-toggle",
    ));
  }
  box.append(head, element("strong", "", value));
  return box;
}

function returnFlowStep(label, description) {
  const item = document.createElement("li");
  item.append(
    element("strong", "scroll-return-flow__label", label),
    element("span", "scroll-return-flow__description", description),
  );
  return item;
}

function returnFirstActionName(action) {
  if (action?.source === "owned-chaos-100") return "보유 놀긍 100%";
  if (action?.source === "purchased-chaos-100") return "구매 놀긍 100%";
  if (action?.source === "purchased-chaos-60") return "구매 놀긍 60%";
  return "계산된 놀긍";
}

function returnFirstUsageText(expected = {}) {
  return [
    expected.ownedChaos100Used > 1e-9
      ? `보유 100% ${sheets(expected.ownedChaos100Used)}`
      : null,
    expected.purchasedChaos60 > 1e-9
      ? `구매 60% ${sheets(expected.purchasedChaos60)}`
      : null,
    expected.purchasedChaos100 > 1e-9
      ? `구매 100% ${sheets(expected.purchasedChaos100)}`
      : null,
  ].filter(Boolean).join(" · ");
}

function magicalStrategyFlow({ completedSlots, remainingSlots, resetName }) {
  const box = element("section", "scroll-return-flow");
  box.append(element("h3", "scroll-return-flow__title", "진행 흐름"));
  const list = element("ol", "scroll-return-flow__list");
  if (completedSlots === 0) {
    list.append(
      returnFlowStep(
        "첫작",
        `리턴 없이 매지컬을 바릅니다. 공·마 +${MAGICAL_TARGET}이면 채택하고, +9·+10이면 ${resetName}로 초기화해 다시 시도합니다.`,
      ),
    );
  }
  const returnSlots = completedSlots === 0
    ? Math.max(0, remainingSlots - 1)
    : remainingSlots;
  if (returnSlots > 0) {
    list.append(
      returnFlowStep(
        "리턴작",
        `${returnSlots}작은 매번 리턴 스크롤을 사용한 뒤 매지컬을 바릅니다. +${MAGICAL_TARGET}만 적용하고 +9·+10은 되돌립니다.`,
      ),
    );
  }
  if (remainingSlots === 0) {
    list.append(returnFlowStep("완료", "10작이 모두 완료되어 추가 작업이 없습니다."));
  }
  box.append(list);
  return box;
}

function returnStrategyFlow({
  hasFirst,
  progress,
  resetName,
  firstAttack,
  firstStat,
  picked,
  remainderSlots,
  unprotectedChaosScrolls,
  targetText,
  initialAction,
  firstExpected,
}) {
  const box = element("section", "scroll-return-flow");
  box.append(element("h3", "scroll-return-flow__title", "진행 흐름"));
  const list = element("ol", "scroll-return-flow__list");
  const usesUnprotected = unprotectedChaosScrolls > 1e-9;

  if (progress.completedSlots > 0) {
    const currentStatText = progress.current.stat > 0
      ? picked.includes("+")
        ? `${picked} 합 +${progress.current.stat}`
        : `${picked} +${progress.current.stat}`
      : null;
    list.append(
      returnFlowStep(
        "현재 장비",
        [
          `${progress.completedSlots}작 적용`,
          `공·마 +${progress.current.attack}`,
          currentStatText,
          `남은 ${progress.remainingSlots}작`,
        ].filter(Boolean).join(" · "),
      ),
    );
  }

  if (hasFirst) {
    const firstStatText = picked.includes("+")
      ? `${picked} 합 +${firstStat}`
      : `${picked} +${firstStat}`;
    list.append(...[
      returnFlowStep(
        "첫작",
        `첫 시도는 리턴 없이 ${returnFirstActionName(initialAction)}를 바릅니다. 공·마 +${firstAttack} · ${firstStatText} 이상이면 채택합니다.`,
      ),
      returnFirstUsageText(firstExpected)
        ? returnFlowStep(
            "첫작 평균 사용량",
            returnFirstUsageText(firstExpected),
          )
        : null,
      returnFlowStep(
        "목표 미달",
        `주문서 실패 또는 목표 미달이면 ${resetName}로 초기화한 뒤 첫작부터 다시 시도합니다.`,
      ),
    ].filter(Boolean));
  }

  if (remainderSlots > 0) {
    list.append(
      returnFlowStep(
        "리턴작",
        `${hasFirst ? `나머지 ${remainderSlots}작` : `${remainderSlots}작`}은 리턴 스크롤을 사용하고, 보유 놀긍 100%를 우선 사용하며 없으면 놀긍 60%를 바릅니다.`,
      ),
    );
  }

  list.append(
    returnFlowStep(
      "계산 방식",
      remainderSlots > 0
        ? `${usesUnprotected ? "최종 목표를 확정할 수 있는 구간은 리턴을 생략합니다. " : ""}리턴작의 채택 조합은 현재 누적 수치와 남은 횟수마다 달라집니다. 표시 금액은 가능한 결과와 이후 비용을 모두 비교해 ${targetText}을 달성하는 기댓값이며, 개별 결과의 채택 여부를 안내하는 값은 아닙니다.`
        : progress.completedSlots > 0
          ? "입력한 현재 장비가 이미 최종 목표를 충족하며 추가로 작업할 횟수가 없습니다."
          : "첫작 목표를 만족하면 해당 결과를 채택하고 작업을 완료합니다.",
    ),
  );
  box.append(list);
  return box;
}

function num(key, options = {}) {
  const input = numberInput(
    state[key],
    (value) => {
      state[key] = value;
      if (key === "returnAppliedWorks" && !(Number(value) > 0)) {
        state.returnCurrentAttack = 0;
        state.returnCurrentStat = 0;
      }
      render();
    },
    options,
  );
  input.dataset.key = key;
  return input;
}

function toggle(key, label, disabled = false) {
  return toggleChip(
    label,
    !disabled && state[key] === true,
    () => {
      state[key] = !state[key];
      render();
    },
    disabled,
  );
}

function resetModeSelector(key, { allowNone = false, required = false, disabled = false } = {}) {
  const selected = allowNone && !state.useInnocent
    ? "none"
    : state[key] ? "ark" : "innocent";
  const options = [
    ...(allowNone && !required ? [{ value: "none", label: "초기화 안 함", title: "실패한 횟수는 순백으로 복구합니다." }] : []),
    { value: "innocent", label: "일반 이노", title: "스타포스도 초기화합니다." },
    { value: "ark", label: "아크 이노", title: "현재 스타포스를 보존합니다." },
  ];
  const group = chipRow(options.map(({ value, label, title }) => {
    const button = chip(label, selected === value, () => {
      if (allowNone) state.useInnocent = value !== "none";
      state[key] = value === "ark";
      render();
    }, disabled, { key: `scroll-reset-${key}-${value}` });
    button.title = title;
    return button;
  }), "scroll-reset-mode__choices");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "초기화 방식");
  group.dataset.key = "scroll-reset-mode";
  const control = element("div", "field scroll-reset-mode");
  control.append(element("span", "", "초기화 방식"), group);
  return control;
}

function pickSlot(id) {
  return chip(TRACE_SLOTS[id].label, state.slot === id, () => {
    state.slot = id;
    const [minimum, maximum] = TRACE_LEVEL_RANGE[id];
    state.itemLevel = Math.max(minimum, Math.min(maximum, state.itemLevel));
    /* 장신구·기계심장에는 15% 주문서가 없다. 없는 동안만 가장 낮은 확률로
       내려 두고, 다시 있는 부위로 오면 고르던 확률로 돌아간다. */
    const rates = TRACE_SLOTS[id].rates;
    state.traceRate = rates.includes(state.preferredRate)
      ? state.preferredRate
      : Math.min(...rates);
    render();
  });
}

function pickRate(rate) {
  return chip(`${rate}%`, state.traceRate === rate, () => {
    state.traceRate = rate;
    state.preferredRate = rate;
    render();
  });
}

function choice(key, value, label) {
  return chip(label, state[key] === value, () => {
    state[key] = value;
    render();
  });
}

const statCount = () => STATS.filter((name) => state.stats[name]).length;

function successRate() {
  if (state.method === "earring") {
    return earringSuccessRate({
      guild: state.guild,
      dexterity: state.dexterityLevel,
    });
  }
  return traceSuccessRate(state.traceRate, {
    fever: state.fever,
    guild: state.guild,
    dexterity: state.dexterityLevel,
  });
}

function chaosMeso(rate) {
  return (rate === 60 ? state.chaos60Price : state.chaos100Price) * MAN;
}

const traceMeso = (count) => (count / 1000) * state.tracePer1000 * MAN;

/** 이 부위·레벨·확률에서 주문서 한 장에 드는 흔적 개수. */
function traceCountPerScroll() {
  return traceCost(state.slot, Math.round(state.itemLevel), state.traceRate, {
    halfPrice: state.halfPrice,
  });
}

function scrollMeso() {
  if (state.method === "earring") return state.earringPrice * MAN;
  return traceMeso(traceCountPerScroll() ?? 0);
}

/* 실패한 횟수를 되살리는 방법이 여럿이라, 한 번 되살리는 데 드는 값을 견줘
   가장 싼 것을 쓴다. 확률이 100%가 아니면 평균 몇 장이 드는지까지 센다. */
function restoreChoices() {
  const traceCount = specialTraceCost("clean", { halfPrice: state.halfPrice });
  return buildCleanRestoreChoices({
    traceCost: traceMeso(traceCount),
    traceCount,
    clean10Cost: state.clean10Price * MAN,
    clean5Cost: state.clean5Price * MAN,
    allowFiveTenPercent: state.useCleanScrolls,
  });
}

function resetOptions(preserveStarforce) {
  const traceKind = preserveStarforce ? "arkInnocent" : "innocent";
  const traceCount = specialTraceCost(traceKind, { halfPrice: state.halfPrice });
  return [
    {
      name: preserveStarforce
        ? "주흔 아크 이노센트 100%"
        : "주흔 이노센트 100%",
      each: traceMeso(traceCount),
      rate: 1,
      traceCount,
    },
    preserveStarforce
      ? null
      : { name: "이노센트 50%", each: state.innocent50Price * MAN, rate: 0.5, traceCount: 0 },
  ]
    .filter(Boolean)
    .filter((option) => option.each > 0)
    .map((option) => ({ ...option, cost: option.each / option.rate }))
    .sort((a, b) => a.cost - b.cost);
}

const resetChoices = () => resetOptions(state.preserveStarforce);
const returnFirstResetChoices = () => resetOptions(state.returnFirstStarforced);
const resetStock = (preserveStarforce) =>
  preserveStarforce ? state.arkInnocentStock : state.innocentStock;

const purchasePrice = (value) =>
  `${value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}만 메소`;

function supportScrollPurchaseGuide() {
  const thresholds = supportScrollPurchaseThresholds({
    tracePer1000Price: state.tracePer1000,
    halfPrice: state.halfPrice,
  });
  const panel = element("section", "scroll-purchase-threshold");
  panel.append(
    element(
      "h3",
      "scroll-purchase-threshold__title",
      "순백·이노센트 구매 기준",
    ),
  );

  const table = element("table", "source-table scroll-purchase-threshold__table");
  const thead = document.createElement("thead");
  const head = document.createElement("tr");
  head.append(
    element("th", "", "주문서"),
    element("th", "", "이 가격 이하면 구매"),
  );
  thead.append(head);
  const tbody = document.createElement("tbody");
  const hasTracePrice = Number(state.tracePer1000) > 0;
  for (const [name, value] of [
    ["순백 10%", thresholds.clean10],
    ["순백 5%", thresholds.clean5],
    [
      "이노센트 50%",
      thresholds.innocent50,
    ],
  ]) {
    const row = document.createElement("tr");
    const disabled = name === "이노센트 50%"
      ? !state.useInnocent || state.preserveStarforce
      : !state.useCleanScrolls;
    const threshold = disabled
      ? "현재 전략에서 사용 안 함"
      : hasTracePrice
      ? purchasePrice(value)
      : "흔적 시세 입력 필요";
    row.append(element("td", "", name), element("td", "", threshold));
    tbody.append(row);
  }
  table.append(thead, tbody);
  panel.append(
    table,
    note(
      state.useCleanScrolls
        ? `현재 주문의 흔적 시세${state.halfPrice ? "와 주흔 반값 썬데이 적용 여부" : ""}로 계산했습니다. ` +
          "표시된 가격 이하라면 경매장에서 주문서를 사는 편이 주흔 100%를 쓰는 것보다 저렴하거나 같습니다. " +
          "순백 5%·10% 중에서는 복구 1회당 평균 비용이 더 낮은 주문서를 자동으로 사용합니다."
        : "보유 순백 100%를 먼저 사용하고, 모두 소진되면 주흔 순백 100%로 복구합니다. 순백 5%·10%는 현재 전략에서 사용하지 않습니다.",
      "scroll-purchase-threshold__note",
    ),
  );
  if (!state.useInnocent) {
    panel.append(
      note(
        "이노센트 전략이 꺼져 있어 이노센트 50%를 현재 계산에 사용하지 않습니다.",
        "scroll-purchase-threshold__note",
      ),
    );
  } else if (state.preserveStarforce) {
    panel.append(
      note(
        "아크 이노 사용 중에는 이노센트 50%를 현재 전략에 사용하지 않습니다.",
        "scroll-purchase-threshold__note",
      ),
    );
  }
  return panel;
}

function selectedScrollName() {
  if (state.method === "trace") {
    return `${TRACE_SLOTS[state.slot].label} 주흔 ${state.traceRate}% 주문서`;
  }
  if (state.method === "earring") return "10% 귀 장식 주문서";
  return "주문서";
}

function policyActions({ scrollName, restoreName, resetName }) {
  return {
    "주문서": {
      key: "scroll",
      label: "주문서",
      instruction: `${scrollName} 바르기`,
      description: `${scrollName}를 바릅니다.`,
    },
    "순백": {
      key: "clean",
      label: "순백",
      instruction: restoreName
        ? `${restoreName}로 1칸 복구될 때까지 바르기`
        : "순백으로 복구하기",
      description: restoreName
        ? `${restoreName}로 복구 가능 횟수 1칸을 되살립니다.`
        : "복구 가능 횟수를 잔여 횟수로 되살립니다.",
    },
    "이노센트": {
      key: "innocent",
      label: "이노센트",
      instruction: resetName
        ? `${resetName}로 초기화될 때까지 바르기`
        : "이노센트로 초기화하기",
      description: resetName
        ? `${resetName}로 현재 작을 지우고 처음부터 다시 시작합니다.`
        : "현재 작을 지우고 처음부터 다시 시작합니다.",
    },
  };
}

function policyView(
  policy,
  slots,
  {
    displayState,
    policyState,
    scrollName,
    restoreName,
    resetName,
    firstActionName = "",
  },
) {
  const currentState = {
    ...displayState,
    scrollName,
    restoreName,
    resetName,
  };
  const actions = policyActions({
    scrollName: currentState.scrollName,
    restoreName: currentState.restoreName,
    resetName: currentState.resetName,
  });
  const recoverableFor = (entry) =>
    slots - entry.success - entry.remaining;
  const current = policy.find((entry) =>
    recoverableFor(entry) === policyState.recoverable &&
    entry.remaining === policyState.remaining
  );
  const currentAction = actions[current?.action];
  return {
    actions,
    currentState,
    currentInstruction:
      firstActionName || currentAction?.instruction || "목표 작 완료",
    firstActionName,
    policyState,
    recoverableFor,
  };
}

function policyCurrentBox(view) {
  const currentBox = element("div", "scroll-policy__current");
  const currentSummary = element("div", "scroll-policy__current-state");
  currentSummary.append(
    element("span", "", "현재 입력"),
    element(
      "strong",
      "",
      `잔여 ${view.currentState.remaining}회 · 복구 가능 ${view.currentState.recoverable}회`,
    ),
  );
  const currentInstruction = element("div", "scroll-policy__current-action");
  currentInstruction.append(
    element("span", "", "지금 할 일"),
    element(
      "strong",
      "",
      view.currentInstruction,
    ),
  );
  currentBox.append(currentSummary, currentInstruction);
  return currentBox;
}

function policyOverview(policy, slots, options) {
  const view = policyView(policy, slots, options);
  const panel = element("section", "scroll-policy-overview");
  const head = element("div", "scroll-policy-overview__head");
  const openButton = element(
    "button",
    "button button--quiet scroll-policy-overview__open",
    policyDetailsOpen ? "행동표로 이동" : "전체 행동표 보기",
  );
  openButton.type = "button";
  openButton.addEventListener("click", () => {
    const policyDetails = root.querySelector(
      'details[data-details-key="scroll-policy"]',
    );
    if (!policyDetails) return;
    policyDetailsOpen = true;
    policyDetails.open = true;
    openButton.textContent = "행동표로 이동";
    const reducedMotion = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    policyDetails.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "start",
    });
  });
  head.append(
    element("h3", "scroll-policy-overview__title", "현재 상태의 다음 행동"),
    openButton,
  );
  panel.append(head, policyCurrentBox(view));
  return panel;
}

function policyTable(policy, slots, options) {
  const view = policyView(policy, slots, options);
  const panel = element("div", "scroll-policy");
  panel.append(
    note(
      view.firstActionName
        ? "첫작 성공 후 행동표입니다. 복구 가능 행과 잔여 열이 만나는 칸을 확인하세요."
        : "복구 가능 행과 잔여 열이 만나는 칸을 확인하세요. 장비 상태가 바뀔 때마다 해당 칸의 행동을 따르면 됩니다.",
      "scroll-policy__help",
    ),
  );

  const scroll = document.createElement("div");
  scroll.className = "table-scroll scroll-policy__table";
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  const corner = element("th", "", "복구 가능 / 잔여");
  corner.scope = "col";
  headRow.append(corner);
  for (let remaining = slots; remaining >= 0; remaining -= 1) {
    const heading = element("th", "", `${remaining}회`);
    heading.scope = "col";
    headRow.append(heading);
  }
  thead.append(headRow);

  const byRecoverable = new Map();
  for (const entry of policy) {
    const recoverable = view.recoverableFor(entry);
    if (!byRecoverable.has(recoverable)) {
      byRecoverable.set(recoverable, new Map());
    }
    byRecoverable.get(recoverable).set(entry.remaining, entry);
  }
  const tbody = document.createElement("tbody");
  for (const [recoverable, byRemaining] of [...byRecoverable.entries()]
    .sort((left, right) => left[0] - right[0])) {
    const tr = document.createElement("tr");
    const rowHeading = element("th", "", `${recoverable}회`);
    rowHeading.scope = "row";
    tr.append(rowHeading);
    for (let remaining = slots; remaining >= 0; remaining -= 1) {
      const entry = byRemaining.get(remaining);
      const action = view.actions[entry?.action];
      const cell = element("td", "scroll-policy__cell", action?.label ?? "–");
      if (action) {
        cell.dataset.action = action.key;
        cell.title = action.description;
      }
      if (
        recoverable === view.policyState.recoverable &&
        remaining === view.policyState.remaining
      ) {
        cell.classList.add("scroll-policy__cell--current");
      }
      tr.append(cell);
    }
    tbody.append(tr);
  }
  table.append(thead, tbody);
  scroll.append(table);
  const legend = element("div", "scroll-policy__legend");
  for (const action of Object.values(view.actions)) {
    const item = element("span", "scroll-policy__legend-item");
    item.dataset.action = action.key;
    item.append(
      element("strong", "", action.label),
      document.createTextNode(` ${action.description}`),
    );
    legend.append(item);
  }
  panel.append(scroll, legend);
  return panel;
}

function emptyCraftResult() {
  return {
    expectedCost: 0,
    baseExpectedCost: 0,
    expected: {
      scrolls: 0,
      cleans: 0,
      innocents: 0,
      ownedCleans: 0,
      paidCleans: 0,
      ownedInnocents: 0,
      paidInnocents: 0,
    },
    inventory: { totalSavings: 0 },
    policy: [],
  };
}

/* 첫 작만 놀긍으로 띄우는 몫. 목표가 안 뜨면 되돌리고 다시 바른다. */
function chaosFirstCost(reset) {
  const optionChance =
    chaosAtLeast(state.chaosFirstAttack) *
    chaosSumAtLeast(state.chaosFirstStat, Math.max(1, statCount()));
  if (!(optionChance > 0)) {
    return {
      feasible: false,
    };
  }

  const calculated = calculateAutomaticFirstChaos({
    targetChance: optionChance,
    chaos60Cost: chaosMeso(60),
    resetCost: reset?.cost ?? Number.POSITIVE_INFINITY,
    chaos100Stock: state.chaos100Stock,
    resetStock: resetStock(state.preserveStarforce),
  });
  return {
    feasible: true,
    ...calculated,
  };
}

function chaosFirstTargetText() {
  const attack = Math.max(0, Number(state.chaosFirstAttack) || 0);
  const stat = Math.max(0, Number(state.chaosFirstStat) || 0);
  const picked = STATS.filter((name) => state.stats[name]);
  const target = [
    attack > 0 ? `공·마 +${attack}` : null,
    stat > 0
      ? `${picked.join("+")}${picked.length > 1 ? " 합" : ""} +${stat}`
      : null,
  ].filter(Boolean);
  return target.length ? `${target.join(" · ")} 이상` : "주문서 성공";
}

function firstChaosResult() {
  if (state.chaosFirstStat > 0 && statCount() === 0) {
    return createResultCard(
      "계산 결과",
      element("div", "result-empty", "목표 스탯 합에 포함할 스탯을 하나 이상 선택해 주세요."),
    );
  }

  const reset = resetChoices()[0] ?? null;
  let first;
  try {
    first = chaosFirstCost(reset);
  } catch (error) {
    return createResultCard("계산 결과", line("계산할 수 없음", error.message));
  }
  if (!first.feasible) {
    return createResultCard(
      "계산 결과",
      element("div", "result-empty", "선택한 놀긍첫작 목표는 나올 수 없습니다."),
    );
  }
  if (!Number.isFinite(first.cost)) {
    return createResultCard(
      "계산 결과",
      element(
        "div",
        "result-empty",
        state.preserveStarforce
          ? "비용 설정에서 아크 이노센트에 사용할 주문의 흔적 시세를 입력해 주세요."
          : "비용 설정에서 첫작 초기화에 사용할 주문의 흔적 또는 이노센트 50% 시세를 입력해 주세요.",
      ),
    );
  }

  const resetKind = state.preserveStarforce ? "아크 이노센트" : "이노센트";
  const selectedResetStock = Math.max(
    0,
    Math.round(resetStock(state.preserveStarforce)),
  );
  const supportScrolls = reset
    ? expectedSupportScrollQuantities({
        resetRate: reset.rate,
        firstOwnedResets: first.ownedResetsUsed,
        firstPaidResets: first.paidResets,
      })
    : null;

  return createResultCard(
    "계산 결과",
    resultHero("평균 비용", eok(first.cost)),
    line("목표", chaosFirstTargetText(), true),
    firstChaosTargetChanceLine(first),
    firstChaosUsageLine(first),
    supportScrolls
      ? metricGrid(
          supportScrollUsageMetric(`평균 ${resetKind}`, [
            selectedResetStock > 0
              ? {
                  label: "보유 100%",
                  value: supportScrolls.ownedReset100,
                  kind: "owned",
                }
              : null,
            {
              label: supportScrollSourceLabel(reset.name, resetKind),
              value: supportScrolls.purchasedReset,
              kind: "paid",
            },
          ]),
        )
      : null,
    reset ? line("초기화", `${reset.name} · 성공 1회 평균 ${eok(reset.cost)}`) : null,
    note(
      `목표에 미달하거나 주문서가 실패하면 ${reset?.name ?? resetKind}로 초기화하고 첫작부터 다시 시도합니다.`,
    ),
  );
}

function slotResult() {
  const usesChaosFirst = isChaosFirstEnabled(
    METHODS[state.method],
    state.chaosFirst,
  );
  if (usesChaosFirst && state.chaosFirstStat > 0 && statCount() === 0) {
    return createResultCard(
      "계산 결과",
      element("div", "result-empty", "목표 스탯 합에 포함할 스탯을 하나 이상 선택해 주세요."),
    );
  }
  if (state.method === "trace") {
    const [minimum, maximum] = TRACE_LEVEL_RANGE[state.slot];
    if (state.itemLevel < minimum || state.itemLevel > maximum) {
      return createResultCard(
        "계산 결과",
        element("div", "result-empty", `이 부위는 공식표에서 Lv.${minimum}~${maximum} 구간만 확인됩니다.`),
      );
    }
  }
  const restore = restoreChoices()[0] ?? null;
  if (!restore) {
    return createResultCard(
      "계산 결과",
      element(
        "div",
        "result-empty",
        state.useCleanScrolls
          ? "비용 설정에서 순백 복구에 사용할 주문서 시세를 입력해 주세요."
          : "비용 설정에서 주흔 순백 100%에 사용할 주문의 흔적 시세를 입력해 주세요.",
      ),
    );
  }
  const reset = state.useInnocent ? resetChoices()[0] : null;
  const rate = successRate();
  const current = slotCraftState(state);
  const maximumSlots = 20;
  if (current.slots < 1 || current.slots > maximumSlots) {
    return createResultCard(
      "계산 결과",
      element(
        "div",
        "result-empty",
        `잔여와 복구 가능의 합은 1~${maximumSlots}여야 합니다.`,
      ),
    );
  }
  if (usesChaosFirst && current.recoverable > 0) {
    return createResultCard(
      "계산 결과",
      element("div", "result-empty", "첫작놀긍은 복구 가능한 횟수가 없는 장비에만 적용할 수 있습니다."),
    );
  }
  const slots = current.slots;
  const first = usesChaosFirst ? chaosFirstCost(reset) : null;
  if (first && !first.feasible) {
    return createResultCard(
      "계산 결과",
      element("div", "result-empty", "선택한 첫작놀긍 목표는 나올 수 없습니다."),
    );
  }
  const craftSlots = Math.max(0, slots - (first ? 1 : 0));
  const startRemaining = Math.min(
    current.startRemaining,
    craftSlots,
  );
  const selectedResetStock = Math.max(
    0,
    Math.round(resetStock(state.preserveStarforce)),
  );
  const cleanStock = Math.max(0, Math.round(Number(state.cleanStock) || 0));

  const result = craftSlots === 0
    ? emptyCraftResult()
    : calculateSlotCraft({
        slots: craftSlots,
        successRate: rate,
        // 주흔·귀지 모두 주문서 강화의 장인 효과를 실패 이후에 적용한다.
        // 공식 길드 개편: https://maplestory.nexon.com/News/Update/797
        slotProtectionRate: Math.max(0, Math.min(4, Number(state.guildProtection))) / 100,
        scrollCost: scrollMeso(),
        cleanCost: restore?.cost ?? Number.POSITIVE_INFINITY,
        /* 이노센트는 첫작놀긍까지 지운다. 첫작 비용을 한 번만 낸 채 후속
           이노센트를 허용하면 과소계산이므로, 첫작을 고른 경우 후속 작은
           순백 복구만 사용하는 안전한 전략으로 제한한다. */
        innocentCost: first
          ? Number.POSITIVE_INFINITY
          : (reset?.cost ?? Number.POSITIVE_INFINITY),
        startSuccess: 0,
        startRemaining,
        cleanStock,
        innocentStock: first ? 0 : selectedResetStock,
      });

  const total = result.expectedCost + (first?.cost ?? 0);
  const firstPaidResets = first?.paidResets ?? 0;
  const supportScrolls = expectedSupportScrollQuantities({
    ownedCleans: result.expected.ownedCleans,
    paidCleans: result.expected.paidCleans,
    cleanRate: restore?.rate,
    ownedResets: result.expected.ownedInnocents,
    paidResets: result.expected.paidInnocents,
    resetRate: reset?.rate,
    firstOwnedResets: first?.ownedResetsUsed,
    firstPaidResets,
  });
  const ownedSupportSavings =
    (result.inventory?.totalSavings ?? 0) +
    (first?.inventorySavings ?? 0);

  const expectedTraceCount = state.method === "trace"
    ? expectedTraceUsage({
        scrolls: result.expected.scrolls,
        tracePerScroll: traceCountPerScroll() ?? 0,
        paidCleans: result.expected.paidCleans,
        tracePerClean: restore?.traceCount ?? 0,
        paidResets: result.expected.paidInnocents + firstPaidResets,
        tracePerReset: reset?.traceCount ?? 0,
      })
    : 0;

  const policyOptions = {
    displayState: {
      remaining: current.startRemaining,
      recoverable: current.recoverable,
    },
    policyState: {
      remaining: startRemaining,
      recoverable: craftSlots - startRemaining,
    },
    scrollName: selectedScrollName(),
    restoreName: restore?.name,
    resetName: reset?.name,
    firstActionName: first?.nextAction ?? "",
  };
  const policySummary = result.policy.length
    ? policyOverview(result.policy, craftSlots, policyOptions)
    : null;
  const policyDetails = result.policy.length
    ? details(
        `상태별 다음 행동표 · 잔여 ${current.startRemaining} · 복구 가능 ${current.recoverable}`,
        policyTable(result.policy, craftSlots, policyOptions),
      )
    : null;
  if (policyDetails) {
    policyDetails.classList.add("card", "scroll-policy-details");
    policyDetails.dataset.detailsKey = "scroll-policy";
    policyDetails.open = policyDetailsOpen;
  }
  policyDetailsForRender = policyDetails;

  return createResultCard(
    "계산 결과",
    resultHero("평균 비용", Number.isFinite(total) ? eok(total) : "계산 불가"),
    metricGrid(
      state.method === "trace"
        ? metric("평균 주흔", `${Math.round(expectedTraceCount).toLocaleString("ko-KR")}개`)
        : metric("성공 확률", successPercent(rate)),
      metric("평균 주문서", times(result.expected.scrolls + (first?.scrolls ?? 0))),
      restore
        ? supportScrollUsageMetric("평균 순백", [
            cleanStock > 0
              ? {
                  label: "보유 100%",
                  value: supportScrolls.ownedClean100,
                  kind: "owned",
                }
              : null,
            {
              label: supportScrollSourceLabel(restore.name, "순백"),
              value: supportScrolls.purchasedClean,
              kind: "paid",
            },
          ])
        : null,
      reset
        ? supportScrollUsageMetric(
            `평균 ${state.preserveStarforce ? "아크 이노센트" : "이노센트"}`,
            [
              selectedResetStock > 0
                ? {
                    label: "보유 100%",
                    value: supportScrolls.ownedReset100,
                    kind: "owned",
                  }
                : null,
              {
                label: supportScrollSourceLabel(
                  reset.name,
                  state.preserveStarforce ? "아크 이노센트" : "이노센트",
                ),
                value: supportScrolls.purchasedReset,
                kind: "paid",
              },
            ],
          )
        : null,
    ),
    line(
      "복구",
      restore ? `${restore.name} · 1회 ${eok(restore.cost)}` : "값을 넣어 주세요",
    ),
    reset ? line("초기화", `${reset.name} · 1회 ${eok(reset.cost)}`) : null,
    first ? firstChaosTargetChanceLine(first) : null,
    first ? firstChaosUsageLine(first) : null,
    first ? line("첫 작 비용", Number.isFinite(first.cost) ? eok(first.cost) : "-") : null,
    state.method === "trace" ? supportScrollPurchaseGuide() : null,
    first
      ? note("첫작놀긍 성공 후 이노센트를 사용하면 첫작도 초기화되므로, 남은 작의 실패는 순백으로만 복구합니다.")
      : null,
    ownedSupportSavings > 0
      ? line("보유 주문서로 절약되는 예상 비용", eok(ownedSupportSavings))
      : null,
    ownedSupportSavings > 0
      ? note("보유 순백·이노센트·놀긍 100%를 구매하지 않고 먼저 사용하는 기준이며, 평균 비용에 이미 반영된 금액입니다.")
      : null,
    result.inventory?.policy === "multi-policy-fixed-inventory"
      ? note("보유 주문서 조합이 매우 커서 전체 재고 상태 대신 여러 후보 정책을 비교한 추천값입니다.")
      : null,
    policySummary,
  );
}

function magicalResult() {
  const completedSlots = selectedMagicalCompletedCount(
    state.magicalCompletedCount,
  );
  if (completedSlots === null) return invalidMagicalCompletedCountResult();
  const remainingSlots = MAGICAL_TOTAL_WORKS - completedSlots;
  const needsFirstWork = completedSlots === 0;
  const reset = needsFirstWork
    ? resetOptions(state.magicalFirstStarforced)[0]
    : null;
  if (needsFirstWork && !reset) {
    return createResultCard(
      "계산 결과",
      element("div", "result-empty", "비용 설정에서 첫작 초기화에 사용할 이노센트 시세를 입력해 주세요."),
    );
  }
  const selectedResetStock = needsFirstWork
    ? Math.min(
        MAX_RETURN_STOCK,
        Math.max(0, Math.round(resetStock(state.magicalFirstStarforced))),
      )
    : 0;
  let result;
  try {
    result = calculateMagicalReturnCraftProgress({
      totalSlots: MAGICAL_TOTAL_WORKS,
      completedSlots,
      target: MAGICAL_TARGET,
      scrollPrice: state.magicalPrice * MAN,
      returnPrice: state.returnPrice * MAN,
      returnCurrency: "meso",
      resetCost: reset?.each ?? 0,
      resetRate: reset?.rate ?? 1,
      resetStock: selectedResetStock,
    });
  } catch (error) {
    return createResultCard("계산 결과", line("계산할 수 없음", error.message));
  }
  const cashAsMeso = remainingSlots === 0
    ? 0
    : result.costs.returnMeso;
  const totalMeso = result.costs.otherMeso + cashAsMeso;
  const resetKind = state.magicalFirstStarforced
    ? "아크 이노센트"
    : "이노센트";
  return createResultCard(
    "계산 결과",
    returnCostHero(
      "예상 필요 메소",
      eokMeso(totalMeso),
      { showUnitToggle: false },
    ),
    metricGrid(
      metric("리턴 구매에 필요한 예상 메소", eokMeso(cashAsMeso)),
      metric("그 외 예상 메소", eokMeso(result.costs.otherMeso)),
      metric("평균 매지컬 사용량", sheets(result.expected.magicalScrolls)),
      metric("평균 리턴 스크롤 사용량", sheets(result.expected.returnScrolls)),
      needsFirstWork
        ? metric("평균 초기화 횟수", times(result.expected.resets), resetKind)
        : null,
      needsFirstWork
        ? supportScrollUsageMetric(`평균 ${resetKind}`, [
            result.expected.ownedResetsUsed > 1e-9
              ? {
                  label: "보유 100%",
                  value: result.expected.ownedResetsUsed,
                  kind: "owned",
                }
              : null,
            {
              label: supportScrollSourceLabel(reset.name, resetKind),
              value: result.expected.purchasedResetScrolls,
              kind: "paid",
            },
          ])
        : null,
    ),
    magicalStrategyFlow({
      completedSlots,
      remainingSlots,
      resetName: reset?.name ?? resetKind,
    }),
    line(
      "현재 진행",
      `${completedSlots}/${MAGICAL_TOTAL_WORKS}작 완료 · 남은 ${remainingSlots}작`,
    ),
    note(
      `공·마 +${MAGICAL_TARGET} 확률은 ${(result.chance * 100).toFixed(0)}%로, 한 작당 평균 ${result.attemptsPerWork.toFixed(0)}회 시도합니다. 리턴 스크롤은 입력한 메소 가격으로 계산합니다.`,
    ),
  );
}

function returnResult() {
  const slots = selectedWorkCount(state.workCount);
  if (slots === null) {
    stopReturnEconomyWorker();
    return invalidWorkCountResult("전체 작 수");
  }
  const appliedWorks = Number(state.returnAppliedWorks);
  if (!Number.isInteger(appliedWorks) || appliedWorks < 0 || appliedWorks > slots) {
    stopReturnEconomyWorker();
    return createResultCard(
      "계산 결과",
      element("div", "result-empty", `이미 적용한 작 수는 0~${slots}회로 입력해 주세요.`),
    );
  }
  const currentAttack = appliedWorks > 0 ? Number(state.returnCurrentAttack) : 0;
  const currentStat = appliedWorks > 0 ? Number(state.returnCurrentStat) : 0;
  const hasFirst = appliedWorks === 0 && state.returnFirst;
  const selectedStats = statCount();
  if (
    (state.statTarget > 0 || currentStat > 0 || (hasFirst && state.returnFirstStat > 0)) &&
    selectedStats === 0
  ) {
    stopReturnEconomyWorker();
    return createResultCard(
      "계산 결과",
      element("div", "result-empty", "목표 스탯 합에 포함할 스탯을 하나 이상 선택해 주세요."),
    );
  }
  if (!(state.chaos60Price > 0) || (hasFirst && !(state.chaos100Price > 0))) {
    stopReturnEconomyWorker();
    return createResultCard(
      "계산 결과",
      element(
        "div",
        "result-empty",
        hasFirst
          ? "비용 설정에서 놀긍 60%와 100% 시세를 입력해 주세요."
          : "비용 설정에서 놀긍 60% 시세를 입력해 주세요.",
      ),
    );
  }
  const reset = hasFirst ? returnFirstResetChoices()[0] : null;
  if (hasFirst && !reset) {
    stopReturnEconomyWorker();
    return createResultCard(
      "계산 결과",
      element(
        "div",
        "result-empty",
        "첫작 초기화에 사용할 이노센트 시세를 입력해 주세요.",
      ),
    );
  }
  const calculation = requestReturnEconomy({
    slots,
    averageAttackTarget: state.attackTarget,
    averageStatTarget: Number(state.statTarget),
    statCount: selectedStats,
    progress: {
      completedSlots: appliedWorks,
      attack: currentAttack,
      stat: currentStat,
    },
    firstWork: hasFirst
      ? {
          chaosRates: [60, 100],
          attackTarget: state.returnFirstAttack,
          statTarget: state.returnFirstStat,
        }
      : null,
    returnWork: { chaosRate: 60 },
    prices: {
      chaos60Meso: chaosMeso(60),
      chaos100Meso: chaosMeso(100),
      arkInnocent100Meso: reset?.cost ?? 0,
      returnMaplePoints: 0,
      returnMeso: state.returnPrice * MAN,
    },
    inventory: {
      chaos100Stock: Math.min(
        MAX_RETURN_STOCK,
        Math.max(0, Math.round(state.chaos100Stock)),
      ),
      arkInnocentStock: hasFirst
        ? Math.min(
            MAX_RETURN_STOCK,
            Math.max(0, Math.round(resetStock(state.returnFirstStarforced))),
          )
        : 0,
    },
    maplePointsPer100MillionMeso: state.maplePointsPerEok,
  });
  if (calculation.status === "loading") return returnCalculationCard("loading");
  if (calculation.status === "error") {
    return returnCalculationCard("error", calculation.message);
  }
  const result = calculation.result;
  const picked = STATS.filter((name) => state.stats[name]).join("+") || "선택 스탯";
  const expectedChaos100 =
    result.expected.purchasedChaos100 + result.expected.ownedChaos100Used;
  const firstTraceCount = hasFirst
    ? result.expected.purchasedArkInnocent100 * (reset.traceCount ?? 0)
    : 0;
  const firstMesoSpent = hasFirst
    ? result.expected.first.purchasedChaos60 * chaosMeso(60) +
      result.expected.first.purchasedChaos100 * chaosMeso(100) +
      result.costs.breakdown.arkInnocent100Meso
    : 0;
  const returnChaosMeso =
    result.expected.remainder.purchasedChaos60 * chaosMeso(60);
  const mesoTotal = result.costs.meso - result.costs.breakdown.returnMeso;
  const cashAsMeso = result.costs.breakdown.returnMeso;
  const totalMeso = result.costs.equivalent.totalMeso;
  const unprotectedChaosScrolls = result.expected.unprotectedChaosScrolls ?? 0;
  const averageTargetText = [
    `공·마 평균 ${result.goals.averageAttack.toFixed(2).replace(/\.00$/, "")}`,
    result.goals.stat > 0
      ? `스탯 평균 ${result.goals.averageStat.toFixed(2).replace(/\.00$/, "")} (${picked})`
      : null,
  ].filter(Boolean).join(" · ");
  const targetText = `${slots}작 기준 · ${averageTargetText}`;
  const remainderSlots = Math.max(
    0,
    result.progress.remainingSlots - (hasFirst ? 1 : 0),
  );
  const currentStatText = result.goals.stat > 0
    ? picked.includes("+")
      ? `${picked} 합 +${result.progress.current.stat}`
      : `${picked} +${result.progress.current.stat}`
    : null;
  const currentStateText = [
    `${result.progress.completedSlots}작 적용`,
    `공·마 +${result.progress.current.attack}`,
    currentStatText,
    `남은 ${result.progress.remainingSlots}작`,
  ].filter(Boolean).join(" · ");
  const remainingStatText = result.goals.stat > 0
    ? picked.includes("+")
      ? `${picked} 합 +${result.progress.needed.stat}`
      : `${picked} +${result.progress.needed.stat}`
    : null;
  const remainingTargetText = [
    `${result.progress.remainingSlots}작에서`,
    `공·마 +${result.progress.needed.attack}`,
    remainingStatText,
  ].filter(Boolean).join(" · ");
  return createResultCard(
    "계산 결과",
    returnCostHero(
      "예상 필요 메소",
      eokMeso(totalMeso),
      { showUnitToggle: false },
    ),
    metricGrid(
      metric("리턴 구매에 필요한 예상 메소", eokMeso(cashAsMeso)),
      metric("그 외 예상 메소", eokMeso(mesoTotal)),
      metric("평균 놀긍 사용량", sheets(result.expected.chaosScrolls)),
      metric("평균 리턴 스크롤 사용량", sheets(result.expected.returnScrolls)),
      unprotectedChaosScrolls > 1e-9
        ? metric("리턴 없이 적용한 놀긍", times(unprotectedChaosScrolls))
        : null,
      expectedChaos100 > 0
        ? metric("그중 놀긍 100%", sheets(expectedChaos100))
        : null,
      hasFirst
        ? metric(
            "평균 초기화 횟수",
            times(result.expected.arkInnocent100),
            state.returnFirstStarforced ? "아크 이노센트" : "이노센트",
          )
        : null,
      hasFirst && result.expected.ownedArkInnocent100Used > 0
        ? metric(
            state.returnFirstStarforced
              ? "그중 보유 아크 이노 100%"
              : "그중 보유 이노 100%",
            sheets(result.expected.ownedArkInnocent100Used),
          )
        : null,
    ),
    returnStrategyFlow({
      hasFirst,
      progress: result.progress,
      resetName: reset?.name ?? "이노센트",
      firstAttack: state.returnFirstAttack,
      firstStat: state.returnFirstStat,
      picked,
      remainderSlots,
      unprotectedChaosScrolls,
      targetText: averageTargetText,
      initialAction: result.strategy.initialAction,
      firstExpected: result.expected.first,
    }),
    appliedWorks > 0
      ? line("현재 상태", currentStateText)
      : null,
    appliedWorks > 0
      ? line("남은 목표", remainingTargetText)
      : null,
    line("최종 목표", targetText),
    hasFirst
      ? line(
          "첫작 목표",
          `리턴 미사용 · 공·마 ${state.returnFirstAttack} · 목표 스탯 ${state.returnFirstStat} (${picked})`,
        )
      : null,
    hasFirst
      ? line(
          "첫작 초기화",
          reset.name,
        )
      : null,
    firstTraceCount > 0
      ? line("초기화 평균 주흔", `${Math.round(firstTraceCount).toLocaleString("ko-KR")}개`)
      : null,
    hasFirst
      ? line("첫작 메소 지출", eok(firstMesoSpent))
      : null,
    line("남은 작 놀긍 메소", eok(returnChaosMeso)),
    appliedWorks > 0
      ? note(
          "이미 적용된 주문서와 비용은 제외하고, 현재 장비에서 앞으로 필요한 값만 계산합니다.",
        )
      : null,
    note("리턴 스크롤을 포함한 총 메소 비용이 가장 낮은 전략을 계산합니다."),
  );
}

function render() {
  const renderedPolicyDetails = root.querySelector(
    'details[data-details-key="scroll-policy"]',
  );
  if (renderedPolicyDetails) {
    policyDetailsOpen = renderedPolicyDetails.open;
  }
  const method = METHODS[state.method];
  if (method.kind !== "return") stopReturnEconomyWorker();
  const isStandaloneFirst = method.kind === "firstChaos";
  const usesSlots = method.kind === "slot";
  const usesChaosFirst = isChaosFirstEnabled(method, state.chaosFirst);
  // 첫작을 반복하는 전략에는 초기화가 필수다. 이전 저장값도 같은 조건으로 맞춘다.
  if (usesChaosFirst) state.useInnocent = true;
  const usesChaos = isStandaloneFirst || method.kind === "return" || usesChaosFirst;
  const usesChaosTarget = isStandaloneFirst || method.kind === "return" || usesChaosFirst;
  const showsChaosSettings = method.kind === "slot" || usesChaos;
  const hasReturnProgress = method.kind === "return" && hasAppliedReturnWorks();
  const returnUsesFirst = method.kind === "return" && usesReturnFirstWork();
  const methodCard = settingsSection(
    "작 방식",
    "method",
    chipRow(
      Object.entries(METHODS).map(([id, entry]) =>
        chip(entry.name, state.method === id, () => {
          state.method = id;
          if (id === "trace") {
            const rates = TRACE_SLOTS[state.slot].rates;
            state.traceRate = rates.includes(state.preferredRate)
              ? state.preferredRate
              : Math.min(...rates);
          }
          render();
        }),
      ),
      "scroll-methods",
    ),
    state.method === "trace"
      ? chipRow(
          [...TRACE_SLOTS[state.slot].rates].sort((a, b) => a - b).map(pickRate),
          "scroll-trace-rates",
        )
      : null,
    note(method.description),
  );
  let chaosSettingsCard = null;
  let equipmentSettingsCard = null;
  let costSettingsCard = null;
  const parts = [];

  if (showsChaosSettings) {
    chaosSettingsCard = settingsSection(
        method.kind === "return" ? "" : "놀긍 설정",
        "chaos",
        method.kind === "slot" ? firstWorkOption() : null,
        method.kind === "return"
          ? returnFirstWorkOption(hasReturnProgress)
          : null,
        usesChaosFirst
          ? note("주스탯만 선택하세요. 선택한 공·마와 스탯은 장비에 이미 붙어 있어야 합니다.")
          : null,
        usesChaosTarget
          ? element("p", "section-note", "목표 스탯")
          : null,
        usesChaosTarget
          ? chipRow(
              STATS.map((name) =>
                toggleChip(name, state.stats[name] === true, () => {
                  state.stats[name] = !state.stats[name];
                  render();
                }),
              ),
              "scroll-chaos-stats",
            )
          : null,
        isStandaloneFirst || usesChaosFirst
          ? row(
              field("목표 공·마", num("chaosFirstAttack", { min: "0", max: "6" }), "field--inline"),
              field("목표 스탯 합", num("chaosFirstStat", { min: "0", max: "24" }), "field--inline"),
            )
          : null,
        method.kind === "return"
          ? row(
              field(
                "첫작 목표 공·마",
                num("returnFirstAttack", {
                  min: "0",
                  max: "6",
                  disabled: hasReturnProgress || !state.returnFirst,
                }),
                "field--inline",
              ),
              field(
                "첫작 목표 스탯 합",
                num("returnFirstStat", {
                  min: "0",
                  max: "24",
                  disabled: hasReturnProgress || !state.returnFirst,
                }),
                "field--inline",
              ),
            )
          : null,
        method.kind === "return"
          ? row(
              field("최종 평균 공·마", num("attackTarget", { min: "0", max: "6" }), "field--inline"),
              field(
                "최종 스탯 평균",
                num("statTarget", {
                  min: "0",
                  max: "24",
                  step: "0.1",
                  allowDecimalDraft: true,
                }),
                "field--inline",
              ),
            )
          : null,
      );
  }

  const equipmentContent = [
      state.method === "trace" ? chipRow(SLOT_IDS.map(pickSlot)) : null,
      row(
        state.method === "trace"
          ? field(
              "레벨",
              num("itemLevel", {
                min: String(TRACE_LEVEL_RANGE[state.slot][0]),
                max: String(TRACE_LEVEL_RANGE[state.slot][1]),
              }),
              "field--inline",
            )
          : null,
        usesSlots
          ? field(
              "잔여",
              num("remaining", { min: "0", max: "20" }),
              "field--inline",
            )
          : null,
        usesSlots
          ? field(
              "복구 가능",
              num("recoverable", { min: "0", max: "20" }),
              "field--inline",
            )
          : field(
              method.kind === "magical" ? "완료한 주문서 횟수" : "전체 작 수",
              num(
                method.kind === "magical"
                  ? "magicalCompletedCount"
                  : "workCount",
                method.kind === "magical"
                  ? { min: "0", max: String(MAGICAL_TOTAL_WORKS) }
                  : { min: "1", max: String(MAX_WORK_COUNT) },
              ),
              "field--inline",
            ),
        method.kind === "return"
          ? field(
              "이미 적용한 작 수",
              num("returnAppliedWorks", {
                min: "0",
                max: String(selectedWorkCount(state.workCount) ?? MAX_WORK_COUNT),
              }),
              "field--inline",
            )
          : null,
      ),
      method.kind === "return"
        ? row(
            field(
              "현재 적용된 공·마 합",
              num("returnCurrentAttack", {
                min: "0",
                max: String(6 * Math.min(MAX_WORK_COUNT, Number(state.returnAppliedWorks) || 0)),
                disabled: !hasReturnProgress,
              }),
              "field--inline",
            ),
            field(
              "현재 적용된 목표 스탯 합",
              num("returnCurrentStat", {
                min: "0",
                max: String(
                  6 * statCount() * Math.min(MAX_WORK_COUNT, Number(state.returnAppliedWorks) || 0),
                ),
                disabled: !hasReturnProgress,
              }),
              "field--inline",
            ),
          )
        : null,
      method.kind === "magical"
        ? note("10작 완작 기준입니다. 이미 공·마 +11로 완료한 주문서 횟수를 입력하세요.")
        : null,
  ];
  if (!isStandaloneFirst) {
    equipmentSettingsCard = method.kind === "return"
      ? settingsSectionWithHead(
          "장비",
          "equipment",
          returnProgressResetButton(),
          ...equipmentContent,
        )
      : settingsSection("장비", "equipment", ...equipmentContent);
  }

  if (method.kind === "magical") {
    const needsMagicalFirstWork =
      selectedMagicalCompletedCount(state.magicalCompletedCount) === 0;
    costSettingsCard = settingsSection(
        "비용 설정",
        "cost",
        row(
          field("매지컬 1장 (만 메소)", num("magicalPrice", { min: "0", step: "1" }), "field--inline"),
          field("리턴 스크롤 1회 (만 메소)", num("returnPrice", { min: "0", max: "100000" }), "field--inline"),
        ),
        needsMagicalFirstWork
          ? row(
              field("주문의 흔적 1,000개 (만 메소)", num("tracePer1000", { min: "0", step: "1" }), "field--inline"),
              state.magicalFirstStarforced
                ? null
                : field("이노센트 50% (만 메소)", num("innocent50Price", { min: "0", step: "1" }), "field--inline"),
              state.magicalFirstStarforced
                ? field("보유 아크 이노센트 100% (장)", num("arkInnocentStock", { min: "0", max: "100" }), "field--inline")
                : field("보유 이노센트 100% (장)", num("innocentStock", { min: "0", max: "100" }), "field--inline"),
            )
          : null,
        needsMagicalFirstWork
          ? resetModeSelector("magicalFirstStarforced")
          : null,
        needsMagicalFirstWork
          ? chipRow([
              toggle("halfPrice", "주흔 반값 썬데이"),
            ])
          : null,
      );
  }

  if (method.kind !== "magical") {
    const needsFirstReset = returnUsesFirst;
    const slotPriceFields = usesSlots
      ? [
          field("주문의 흔적 1,000개 (만 메소)", num("tracePer1000", { min: "0", step: "1" }), "field--inline"),
          state.method === "earring"
            ? field("귀 장식 주문서 1장 (만 메소)", num("earringPrice", { min: "0", step: "1" }), "field--inline")
            : null,
          field(
            "순백 10% (만 메소)",
            num("clean10Price", { min: "0", step: "1", disabled: !state.useCleanScrolls }),
            "field--inline",
          ),
          field(
            "순백 5% (만 메소)",
            num("clean5Price", { min: "0", step: "1", disabled: !state.useCleanScrolls }),
            "field--inline",
          ),
          state.preserveStarforce
            ? null
            : field("이노센트 50% (만 메소)", num("innocent50Price", { min: "0", step: "1", disabled: !state.useInnocent }), "field--inline"),
        ]
      : isStandaloneFirst
        ? [
            field("주문의 흔적 1,000개 (만 메소)", num("tracePer1000", { min: "0", step: "1" }), "field--inline"),
            state.preserveStarforce
              ? null
              : field("이노센트 50% (만 메소)", num("innocent50Price", { min: "0", step: "1" }), "field--inline"),
          ]
        : method.kind === "return"
        ? [
            field(
              "주문의 흔적 1,000개 (만 메소)",
              num("tracePer1000", {
                min: "0",
                step: "1",
                disabled: !needsFirstReset,
              }),
              "field--inline",
            ),
            state.returnFirstStarforced
              ? null
              : field(
                  "이노센트 50% (만 메소)",
                  num("innocent50Price", {
                    min: "0",
                    step: "1",
                    disabled: !needsFirstReset,
                  }),
                  "field--inline",
                ),
          ]
        : [];
    const chaosPriceFields = usesChaos
      ? method.kind === "return"
        ? [
            field("놀긍 60% (만 메소)", num("chaos60Price", { min: "0", step: "1" }), "field--inline"),
            field("놀긍 100% (만 메소)", num("chaos100Price", { min: "0", step: "1" }), "field--inline"),
            field("리턴 스크롤 1회 (만 메소)", num("returnPrice", { min: "0", step: "1" }), "field--inline"),
          ]
        : isStandaloneFirst
          ? [
              field("놀긍 60% (만 메소)", num("chaos60Price", { min: "0", step: "1" }), "field--inline"),
            ]
          : [
              field("놀긍 60% (만 메소)", num("chaos60Price", { min: "0", step: "1" }), "field--inline"),
            ]
      : [];
    costSettingsCard = settingsSection(
        "비용 설정",
        "cost",
        row(...slotPriceFields, ...chaosPriceFields),
        usesSlots
          ? row(
              field("보유 순백 100% (장)", num("cleanStock", { min: "0", max: "999" }), "field--inline"),
              state.preserveStarforce
                ? field("보유 아크 이노센트 100% (장)", num("arkInnocentStock", { min: "0", max: "100", disabled: !state.useInnocent }), "field--inline")
                : field("보유 이노센트 100% (장)", num("innocentStock", { min: "0", max: "999", disabled: !state.useInnocent }), "field--inline"),
              usesChaosFirst
                ? field("보유 놀긍 100% (장)", num("chaos100Stock", { min: "0", max: "100" }), "field--inline")
                : null,
            )
          : isStandaloneFirst
            ? row(
                field("보유 놀긍 100% (장)", num("chaos100Stock", { min: "0", max: "100" }), "field--inline"),
                state.preserveStarforce
                  ? field("보유 아크 이노센트 100% (장)", num("arkInnocentStock", { min: "0", max: "100" }), "field--inline")
                  : field("보유 이노센트 100% (장)", num("innocentStock", { min: "0", max: "999" }), "field--inline"),
              )
            : method.kind === "return"
            ? row(
                field("보유 놀긍 100% (장)", num("chaos100Stock", { min: "0", max: "100" }), "field--inline"),
                state.returnFirstStarforced
                  ? field(
                      "보유 아크 이노센트 100% (장)",
                      num("arkInnocentStock", {
                        min: "0",
                        max: "100",
                        disabled: !needsFirstReset,
                      }),
                      "field--inline",
                    )
                  : field(
                      "보유 이노센트 100% (장)",
                      num("innocentStock", {
                        min: "0",
                        max: "100",
                        disabled: !needsFirstReset,
                      }),
                      "field--inline",
                    ),
              )
            : null,
        usesSlots || isStandaloneFirst
          ? resetModeSelector("preserveStarforce", { allowNone: usesSlots, required: usesChaosFirst })
          : method.kind === "return"
            ? resetModeSelector("returnFirstStarforced", { disabled: !needsFirstReset })
            : null,
        usesSlots || isStandaloneFirst || method.kind === "return"
          ? chipRow([
              usesSlots ? toggle("useCleanScrolls", "순백 5/10% 허용") : null,
              toggle(
                "halfPrice",
                "주흔 반값 썬데이",
                method.kind === "return" && !needsFirstReset,
              ),
            ])
          : null,
      );
  }

  if (state.method === "trace" || state.method === "earring") {
    parts.push(
      card(
        "성공 확률 보정",
        chipRow([
          state.method === "trace" ? toggle("fever", "피버타임") : null,
          toggle("guild", "길드 성공률 +4%p"),
          toggleChip("손재주 만렙", state.dexterityLevel >= 100, () => {
            state.dexterityLevel = state.dexterityLevel >= 100 ? 0 : 100;
            render();
          }),
        ]),
        row(
          field("손재주 레벨", num("dexterityLevel", { min: "0", max: "100" }), "field--inline"),
          field(
            "실패 시 횟수 보호율 (%)",
            num("guildProtection", { min: "0", max: "4", step: "1" }),
            "field--inline",
          ),
        ),
        line("지금 성공 확률", successPercent(successRate())),
        note(state.method === "trace"
          ? "피버타임은 금~일 적용. 손재주 5레벨마다 +0.5%p, 길드 성공률 +4%p를 더합니다."
          : "기본 10%에 손재주 5레벨마다 +0.5%p, 길드 성공률 +4%p를 더해 최대 24%입니다. 피버타임은 적용되지 않습니다."),
        note("실패 시 횟수 보호는 길드 스킬 ‘주문서 강화의 장인’ 효과입니다. 미적용은 0%, 적용은 4%이며 성공 확률과 별도로 계산합니다."),
      ),
    );
  }

  if (usesChaos && !isStandaloneFirst) {
    parts.push(characterProfileCardForRender());
  }

  policyDetailsForRender = null;
  const result = method.kind === "return"
    ? returnResult()
    : method.kind === "magical"
      ? magicalResult()
      : isStandaloneFirst
        ? firstChaosResult()
        : slotResult();
  const arrangedParts = [
    scrollSettingsCard(
      methodCard,
      equipmentSettingsCard,
      chaosSettingsCard,
      costSettingsCard,
    ),
    policyDetailsForRender,
    ...parts,
  ].filter(Boolean);

  save();
  const grid = element("div", "calculator-grid calculator-grid--scroll");
  const controls = element("div", "calculator-column");
  controls.append(...arrangedParts);
  const output = element("aside", "calculator-result");
  output.append(result);
  grid.append(controls, output);
  renderWithFocus(root, [grid]);
  const nextPolicyDetails = root.querySelector(
    'details[data-details-key="scroll-policy"]',
  );
  if (nextPolicyDetails) {
    nextPolicyDetails.open = policyDetailsOpen;
  }
}

window.addEventListener(
  "pagehide",
  () => {
    pageDisposed = true;
    stopReturnEconomyWorker();
    characterProfileUnsubscribe();
  },
  { once: true },
);
render();

const scheduleIdle = globalThis.requestIdleCallback ??
  ((callback) => globalThis.setTimeout(callback, 1_200));
scheduleIdle(() => {
  if (!pageDisposed) void loadCharacterProfile().catch(() => {});
});
