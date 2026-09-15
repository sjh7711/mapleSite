import {
  ABILITY_GRADES,
  ABILITY_RESET_METHODS,
  calculateAbilityAttemptsForChance,
  calculateAbilityExpected,
  getAbilityOption,
  getAbilityTargetOptions,
  getAbilityTargetValues,
} from "maple-core/ability";
import {
  ABILITY_JOB_PRESETS,
} from "../data/ability-job-presets.js";
import {
  card,
  cardWithHead,
  chipRow,
  createReachChanceControl,
  element,
  formatAttempts,
  formatProbability,
  metric,
  metricGrid,
  note,
  renderWithFocus,
  resetAction,
  resultCard as createResultCard,
  resultLine,
  searchableSelect,
} from "../shared/calculator-ui.js";
import { renderToolNav } from "../shared/shell.js";
import { chip, field, numberInput, toggleChip } from "../shared/ui.js";
import { formatHonorAmount } from "../shared/korean-large-number.js";

const STORAGE_KEY = "maplestarforce:ability:v2";
const TARGET_CHANCE_DEFAULT = 80;
const TARGET_CHANCE_MIN = 0.01;
const TARGET_CHANCE_MAX = 99.99;
const LINE_NAMES = ["첫 번째 줄", "두 번째 줄", "세 번째 줄"];
const JOB_USAGE_BY_ID = new Map(ABILITY_JOB_PRESETS.map((job) => [job.id, job]));
const POPULAR_TYPES_BY_LINE = [
  [
    "boss-damage",
    "cooldown-skip",
    "passive-level",
    "buff-duration",
    "item-drop",
    "meso-drop",
  ],
  [
    "abnormal-damage",
    "boss-damage",
    "buff-duration",
    "critical",
    "cooldown-skip",
    "attack",
    "magic",
    "item-drop",
    "meso-drop",
  ],
  [
    "abnormal-damage",
    "boss-damage",
    "buff-duration",
    "critical",
    "cooldown-skip",
    "attack",
    "magic",
    "item-drop",
    "meso-drop",
  ],
];

const defaults = {
  method: "honor",
  allowMiracle: true,
  allowBlack: true,
  allowChaos: true,
  miracleCount: 0,
  blackCount: 0,
  chaosCount: 0,
  swapLower: true,
  halfHonor: false,
  targetChancePercent: TARGET_CHANCE_DEFAULT,
  targetChanceAverage: true,
  job: "",
  presetMode: "",
  targets: [
    { type: "", minimum: 0, grade: "legendary", locked: false },
    { type: "", minimum: 0, grade: "unique", locked: false },
    { type: "", minimum: 0, grade: "unique", locked: false },
  ],
};

function safeLoad() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return saved && typeof saved === "object"
      ? { ...structuredClone(defaults), ...saved }
      : structuredClone(defaults);
  } catch {
    return structuredClone(defaults);
  }
}

function safeSave(value) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // 저장이 막힌 환경에서는 현재 탭에서만 유지한다.
  }
}

const state = safeLoad();
state.method = state.method === "chaos"
  ? "black"
  : ABILITY_RESET_METHODS[state.method] ? state.method : "honor";
state.swapLower = state.swapLower !== false;
state.halfHonor = Boolean(state.halfHonor);
state.allowMiracle = state.allowMiracle !== false;
state.allowBlack = state.allowBlack !== false;
state.allowChaos = state.allowChaos !== false;
state.miracleCount = normalizeInventory(state.miracleCount);
state.blackCount = normalizeInventory(state.blackCount);
state.chaosCount = normalizeInventory(state.chaosCount);
state.job = JOB_USAGE_BY_ID.has(state.job) ? state.job : "";
state.presetMode = ["boss", "hunt"].includes(state.presetMode) ? state.presetMode : "";
state.targetChancePercent = normalizeTargetChance(state.targetChancePercent);
state.targetChanceAverage = state.targetChanceAverage !== false;
for (const key of ["bossHonorPriceMan", "miraclePrice", "blackPrice", "chaosPrice"]) {
  delete state[key];
}
state.targets = Array.from({ length: 3 }, (_, line) => {
  const target = Array.isArray(state.targets) ? state.targets[line] : null;
  const grade = line === 0
    ? "legendary"
    : target?.grade === "epic" ? "epic" : "unique";
  const type = targetOptionsFor(line, state.method, grade).some(
    (entry) => entry.id === target?.type,
  )
    ? target.type
    : "";
  const values = type ? targetValuesFor(type, line, state.method, grade) : [];
  const minimum = values.includes(Number(target?.minimum))
    ? Number(target.minimum)
    : values.at(-1) ?? 0;
  return {
    type,
    minimum,
    grade: inferTargetGrade(type, line, state.method, minimum, grade),
    locked: state.method === "honor" && Boolean(type) && Boolean(target?.locked),
  };
});
safeSave(state);

renderToolNav(document.querySelector("#toolnav"), "ability");
const root = document.querySelector("#tool");
const OPTIMAL_STRATEGY_CACHE_LIMIT = 16;
const optimalStrategyCache = new Map();
let optimalStrategyWorker = null;
let optimalStrategyPendingKey = "";
let optimalStrategyErrorKey = "";
let optimalStrategyErrorMessage = "";
let optimalStrategyRequestId = 0;

function stopOptimalStrategyWorker() {
  optimalStrategyWorker?.terminate();
  optimalStrategyWorker = null;
  optimalStrategyPendingKey = "";
}

function cacheOptimalStrategy(key, result) {
  if (optimalStrategyCache.has(key)) optimalStrategyCache.delete(key);
  optimalStrategyCache.set(key, result);
  if (optimalStrategyCache.size > OPTIMAL_STRATEGY_CACHE_LIMIT) {
    optimalStrategyCache.delete(optimalStrategyCache.keys().next().value);
  }
}

function requestOptimalStrategy(options) {
  const key = JSON.stringify(options);
  const cached = optimalStrategyCache.get(key);
  if (cached) {
    cacheOptimalStrategy(key, cached);
    if (optimalStrategyPendingKey !== key) stopOptimalStrategyWorker();
    return { status: "ready", result: cached };
  }
  if (key === optimalStrategyErrorKey) {
    if (optimalStrategyPendingKey !== key) stopOptimalStrategyWorker();
    return { status: "error", message: optimalStrategyErrorMessage };
  }
  if (key === optimalStrategyPendingKey && optimalStrategyWorker) {
    return { status: "loading" };
  }

  stopOptimalStrategyWorker();
  const requestId = ++optimalStrategyRequestId;
  let worker;
  try {
    worker = new Worker(
      new URL("../workers/ability-optimal.worker.js", import.meta.url),
      { type: "module", name: "ability-optimal-strategy" },
    );
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  optimalStrategyWorker = worker;
  optimalStrategyPendingKey = key;
  optimalStrategyErrorKey = "";
  optimalStrategyErrorMessage = "";
  worker.onmessage = ({ data }) => {
    if (
      worker !== optimalStrategyWorker ||
      data?.requestId !== requestId ||
      data?.key !== key
    ) return;
    stopOptimalStrategyWorker();
    if (data.error) {
      optimalStrategyErrorKey = key;
      optimalStrategyErrorMessage = data.error;
    } else {
      cacheOptimalStrategy(key, data.result);
    }
    render();
  };
  worker.onerror = (event) => {
    if (worker !== optimalStrategyWorker) return;
    event.preventDefault();
    stopOptimalStrategyWorker();
    optimalStrategyErrorKey = key;
    optimalStrategyErrorMessage = event.message || "최적 전략을 계산하지 못했습니다.";
    render();
  };
  worker.postMessage({ requestId, key, options });
  return { status: "loading" };
}

function normalizeTargetChance(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return TARGET_CHANCE_DEFAULT;
  return Math.max(TARGET_CHANCE_MIN, Math.min(TARGET_CHANCE_MAX, numeric));
}

function normalizeInventory(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function averageEquivalentTargetChancePercent(probability) {
  if (!Number.isFinite(probability) || probability <= 0) return TARGET_CHANCE_DEFAULT;
  if (probability >= 1) return TARGET_CHANCE_MAX;
  const expectedResets = 1 / probability;
  const chance = 1 - ((1 - probability) ** expectedResets);
  return normalizeTargetChance(Number((chance * 100).toFixed(2)));
}

function update(mutator) {
  mutator();
  safeSave(state);
  render();
}

function resetTargets() {
  state.targets = structuredClone(defaults.targets);
  state.swapLower = true;
  state.presetMode = "";
}

function valueOnlyMethod(method = state.method) {
  return Boolean(ABILITY_RESET_METHODS[method]?.valueOnly);
}

function probabilityMethod(method = state.method) {
  return method === "optimal" ? "honor" : method;
}

function targetOptionsFor(line, method = state.method, grade = null) {
  method = probabilityMethod(method);
  if (!valueOnlyMethod(method) || Number(line) === 0) {
    return getAbilityTargetOptions(line, method, grade);
  }
  const byId = new Map();
  for (const currentGrade of ["unique", "epic"]) {
    for (const option of getAbilityTargetOptions(line, method, currentGrade)) {
      byId.set(option.id, option);
    }
  }
  return [...byId.values()];
}

function targetValuesFor(type, line, method = state.method, grade = null) {
  method = probabilityMethod(method);
  if (!valueOnlyMethod(method) || Number(line) === 0) {
    return getAbilityTargetValues(type, line, method, grade);
  }
  return [...new Set([
    ...getAbilityTargetValues(type, line, method, "epic"),
    ...getAbilityTargetValues(type, line, method, "unique"),
  ])].sort((left, right) => left - right);
}

function inferTargetGrade(type, line, method, minimum, fallback = "unique") {
  method = probabilityMethod(method);
  if (Number(line) === 0) return "legendary";
  if (!valueOnlyMethod(method) || !type) return fallback === "epic" ? "epic" : "unique";
  const uniqueValues = getAbilityTargetValues(type, line, method, "unique");
  return uniqueValues.includes(Number(minimum)) ? "unique" : "epic";
}

function targetValueOptions(type, line, values, optionInfo) {
  const gradeOrder = Number(line) === 0 ? ["legendary"] : ["unique", "epic"];
  const availableByGrade = new Map(gradeOrder.map((grade) => [
    grade,
    new Set(getAbilityTargetValues(type, line, "black", grade).map(Number)),
  ]));
  const groups = new Map();

  [...values].sort((left, right) => right - left).forEach((value) => {
    const grades = gradeOrder.filter((grade) => availableByGrade.get(grade)?.has(Number(value)));
    const groupKey = grades.join("-") || "other";
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        label: grades.map((grade) => ABILITY_GRADES[grade]?.label).filter(Boolean).join(" · "),
        tone: grades.length === 1 ? grades[0] : "mixed",
        options: [],
      });
    }
    const valueLabel = optionInfo?.unit === "단계"
      ? `${value}단계 이상`
      : `${value}${optionInfo?.unit ?? ""} 이상`;
    groups.get(groupKey).options.push({ value, label: valueLabel });
  });

  return [...groups.values()].flatMap((group) => group.options.map((option) => ({
    ...option,
    group: group.label,
    groupTone: group.tone,
  })));
}

function sortedTargetOptions(line, grade) {
  const popular = POPULAR_TYPES_BY_LINE[line];
  const priority = new Map(popular.map((type, index) => [type, index]));
  return [...targetOptionsFor(line, state.method, grade)].sort((a, b) => {
    const aRank = priority.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const bRank = priority.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;
    return a.label.localeCompare(b.label, "ko-KR");
  });
}

function targetRow(line) {
  const target = state.targets[line];
  const isValueOnly = valueOnlyMethod();
  const selectedElsewhere = new Set(
    state.targets
      .filter((_, index) => index !== line)
      .map((entry) => entry.type)
      .filter(Boolean),
  );
  const typeOptions = [
    { value: "", label: "선택 안 함" },
    ...sortedTargetOptions(line, target.grade).map((entry) => ({
      value: entry.id,
      label: entry.label,
      disabled: selectedElsewhere.has(entry.id),
    })),
  ];
  const type = searchableSelect(typeOptions, target.type, (next) => {
    update(() => {
      state.presetMode = "";
      const values = next
        ? targetValuesFor(next, line, state.method, target.grade)
        : [];
      const minimum = values.at(-1) ?? 0;
      state.targets[line] = {
        type: next,
        minimum,
        grade: inferTargetGrade(next, line, state.method, minimum, target.grade),
        locked: false,
      };
    });
  }, {
    key: `ability-type-${line}`,
    ariaLabel: `${LINE_NAMES[line]} 목표 옵션`,
    className: "ability-target-type",
    clearable: true,
  });

  const values = target.type
    ? targetValuesFor(target.type, line, state.method, target.grade)
    : [];
  const optionInfo = getAbilityOption(target.type);
  const minimum = searchableSelect(
    targetValueOptions(target.type, line, values, optionInfo),
    target.minimum,
    (next) => update(() => {
      state.presetMode = "";
      state.targets[line].minimum = Number(next);
      state.targets[line].grade = inferTargetGrade(
        target.type,
        line,
        state.method,
        Number(next),
        target.grade,
      );
    }),
    {
      key: `ability-minimum-${line}`,
      ariaLabel: `${LINE_NAMES[line]} 목표 수치`,
      disabled: !target.type,
      className: "ability-target-minimum",
    },
  );

  const lock = toggleChip(
    "잠금",
    target.locked,
    () => update(() => {
      state.presetMode = "";
      state.targets[line].locked = !state.targets[line].locked;
    }),
    state.method !== "honor" || !target.type,
  );
  lock.classList.add("ability-lock");
  lock.setAttribute("aria-label", `${LINE_NAMES[line]} 옵션 잠금`);

  const item = element("div", "ability-target-row");
  item.dataset.mode = isValueOnly ? "value" : "full";
  const label = element("strong", "ability-target-row__label", LINE_NAMES[line]);
  if (isValueOnly) {
    item.append(label, type, minimum);
  } else if (state.method === "optimal") {
    item.append(
      label,
      type,
      minimum,
      element("span", "ability-lock-strategy", "자동 잠금"),
    );
  } else {
    item.append(label, type, minimum, lock);
  }
  return item;
}

function applyJobPreset(mode) {
  const job = JOB_USAGE_BY_ID.get(state.job);
  if (!job || !["boss", "hunt"].includes(mode)) return;
  state.presetMode = mode;
  state.swapLower = !valueOnlyMethod();
  state.targets = job.presets[mode].map((type, line) => {
    const grade = line === 0 ? "legendary" : "unique";
    const available = targetOptionsFor(line, state.method, grade);
    const selectedType = available.some((entry) => entry.id === type) ? type : "";
    const values = selectedType
      ? targetValuesFor(selectedType, line, state.method, grade)
      : [];
    const minimum = values.at(-1) ?? 0;
    return {
      type: selectedType,
      minimum,
      grade: inferTargetGrade(selectedType, line, state.method, minimum, grade),
      locked: false,
    };
  });
}

function jobPresetPanel() {
  const jobSelect = searchableSelect(
    [
      { value: "", label: "직업 선택" },
      ...ABILITY_JOB_PRESETS.map((job) => ({ value: job.id, label: job.name })),
    ],
    state.job,
    (next) => update(() => {
      state.job = next;
      if (state.presetMode && next) applyJobPreset(state.presetMode);
    }),
    {
      key: "ability-job",
      ariaLabel: "직업 선택",
      className: "ability-job-select",
    },
  );

  const modeButtons = [
    ["boss", "보스용 적용"],
    ["hunt", "사냥용 적용"],
  ].map(([mode, label]) => chip(
    label,
    state.presetMode === mode,
    () => update(() => applyJobPreset(mode)),
    !state.job,
  ));
  const controls = element("div", "ability-job-preset__controls");
  controls.append(jobSelect, ...modeButtons);

  const panel = element("section", "ability-job-preset");
  panel.append(controls);
  return panel;
}

function setupCard() {
  const methodButtons = Object.values(ABILITY_RESET_METHODS)
    .filter((method) => method.id !== "chaos")
    .map((method) =>
    chip(method.label, state.method === method.id, () => {
      update(() => {
        state.method = method.id;
        if (!method.locks) {
          state.targets.forEach((target) => { target.locked = false; });
        }
        state.targets.forEach((target, line) => {
          target.grade = line === 0
            ? "legendary"
            : target.grade === "epic" ? "epic" : "unique";
          if (!target.type) return;
          const available = targetOptionsFor(line, method.id, target.grade);
          const values = available.some((entry) => entry.id === target.type)
            ? targetValuesFor(target.type, line, method.id, target.grade)
            : [];
          if (!values.length) {
            state.targets[line] = {
              type: "",
              minimum: 0,
              grade: target.grade,
              locked: false,
            };
          } else if (!values.includes(Number(target.minimum))) {
            target.minimum = values.at(-1);
          }
          target.grade = inferTargetGrade(
            target.type,
            line,
            method.id,
            target.minimum,
            target.grade,
          );
        });
      });
    }));
  const strategyOptions = state.method === "optimal"
    ? element(
      "div",
      "ability-strategy-options",
    )
    : null;
  if (strategyOptions) {
    const stock = element("div", "ability-strategy-stock");
    for (const [method, label] of [
      ["miracle", "미라클 보유량"],
      ["black", "블랙 보유량"],
      ["chaos", "카오스 보유량"],
    ]) {
      const key = `${method}Count`;
      const enabled = state[`allow${method[0].toUpperCase()}${method.slice(1)}`];
      const input = numberInput(
        state[key],
        (next) => update(() => { state[key] = normalizeInventory(next); }),
        {
          min: 0,
          max: 9999,
          inputMode: "numeric",
          className: "ability-strategy-stock__input",
        },
      );
      input.disabled = !enabled;
      input.dataset.key = `ability-${method}-count`;
      stock.append(field(label, input, "ability-strategy-stock__field"));
    }
    strategyOptions.append(
      element("p", "ability-field-label", "사용할 수 있는 서큘레이터"),
      chipRow(
        toggleChip(
          "미라클 서큘레이터 허용",
          state.allowMiracle,
          () => update(() => { state.allowMiracle = !state.allowMiracle; }),
        ),
        toggleChip(
          "블랙 서큘레이터 허용",
          state.allowBlack,
          () => update(() => { state.allowBlack = !state.allowBlack; }),
        ),
        toggleChip(
          "카오스 서큘레이터 허용",
          state.allowChaos,
          () => update(() => { state.allowChaos = !state.allowChaos; }),
        ),
      ),
      stock,
      note("보유량이 0개이면 허용 상태여도 추천 전략에서 사용하지 않습니다."),
    );
  }
  const section = card(
    "재설정 설정",
    element("p", "ability-field-label", "재설정 방식"),
    chipRow(...methodButtons),
    strategyOptions,
  );
  section.classList.add("ability-setup-card");
  return section;
}

function targetsCard() {
  const reset = resetAction("목표 초기화", () => update(resetTargets));
  const lowerLocked = state.targets.slice(1).some((target) => target.locked);
  const order = toggleChip(
    "2·3번째 줄 순서 무관",
    state.swapLower,
    () => update(() => { state.swapLower = !state.swapLower; }),
    lowerLocked || valueOnlyMethod(),
  );
  order.classList.add("ability-order");
  const halfHonor = toggleChip(
    "어빌 반값 선데이",
    state.halfHonor,
    () => update(() => { state.halfHonor = !state.halfHonor; }),
    !["honor", "optimal"].includes(state.method),
  );
  halfHonor.classList.add("ability-order");
  const controls = element("div", "ability-target-list");
  controls.append(...[0, 1, 2].map(targetRow));
  const section = cardWithHead(
    "목표 옵션",
    reset,
    jobPresetPanel(),
    controls,
    chipRow(order, halfHonor),
  );
  section.classList.add("ability-target-card");
  return section;
}

function formatHonor(value) {
  return formatHonorAmount(value);
}

function formatCirculatorCount(value) {
  if (!Number.isFinite(value)) return "도달 불가";
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}개`;
}

function formatResource(value) {
  if (state.method === "honor") return `${formatHonor(value)} 명성치`;
  if (!Number.isFinite(value)) return "도달 불가";
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}개`;
}

function formatOdds(probability) {
  if (!Number.isFinite(probability) || probability <= 0) return "1 / ∞ · 0%";
  const odds = (1 / probability).toLocaleString("ko-KR", { maximumFractionDigits: 1 });
  return `1 / ${odds} · ${formatProbability(probability, 8)}`;
}

function abilityBasis() {
  const basis = element("div", "ability-basis");
  const probabilityLink = element("a", "", "공식 어빌리티 확률");
  probabilityLink.href = "https://maplestory.nexon.com/Guide/OtherProbability/ability/reputevalue";
  probabilityLink.target = "_blank";
  probabilityLink.rel = "noreferrer";
  const guideLink = element("a", "", "어빌리티 가이드");
  guideLink.href = "https://maplestory.nexon.com/Guide/N23GameInformation/Articles/392";
  guideLink.target = "_blank";
  guideLink.rel = "noreferrer";
  basis.append(probabilityLink, element("span", "", "·"), guideLink);
  return basis;
}

function optimalResultCard() {
  const request = requestOptimalStrategy({
    targets: state.targets,
    swapLower: state.swapLower,
    halfHonor: state.halfHonor,
    allowMiracle: state.allowMiracle,
    allowBlack: state.allowBlack,
    allowChaos: state.allowChaos,
    miracleCount: state.miracleCount,
    blackCount: state.blackCount,
    chaosCount: state.chaosCount,
  });
  const section = createResultCard("계산 결과");
  section.classList.add("ability-result-card", "ability-strategy-result");
  if (request.status === "loading") {
    section.append(element("div", "result-empty", "최적 전략을 계산하는 중…"));
    return section;
  }
  if (request.status === "error") {
    section.append(element("div", "result-empty", request.message));
    return section;
  }
  const result = request.result;
  if (result.error) {
    section.append(element("div", "result-empty", result.error));
    return section;
  }

  const hero = element("div", "result-hero");
  hero.append(
    element("span", "result-hero__label", "추천 전략 평균 명성치"),
    element("strong", "", `${formatHonor(result.expectedHonor)} 명성치`),
  );
  const metrics = [
    metric("평균 명성치 재설정", formatAttempts(result.expectedHonorResets)),
  ];
  for (const [method, label] of [
    ["miracle", "미라클 서큘레이터"],
    ["black", "블랙 서큘레이터"],
    ["chaos", "카오스 서큘레이터"],
  ]) {
    const amount = result.expectedCirculators[method];
    if (amount > 0) metrics.push(metric(
      `평균 ${label} 사용`,
      formatCirculatorCount(amount),
      `보유 ${result.inventory[method].toLocaleString("ko-KR")}개`,
    ));
  }
  section.append(hero, metricGrid(...metrics));
  if (result.honorSaved > 0.5) {
    section.append(resultLine(
      "명성치만 사용할 때보다",
      `${formatHonor(result.honorSaved)} 명성치 절약`,
      true,
    ));
  }

  const methodLabels = {
    honor: "명성치",
    miracle: "미라클 서큘레이터",
    black: "블랙 서큘레이터",
    chaos: "카오스 서큘레이터",
  };
  const strategy = element("ol", "ability-strategy-steps");
  result.steps.forEach((step, index) => {
    const item = element("li", "ability-strategy-step");
    if (step.method !== "honor") {
      const head = element("div", "ability-strategy-step__head");
      head.append(
        element("strong", "", `${index + 1}. ${step.title}`),
        element("span", "", methodLabels[step.method]),
      );
      let amount = formatCirculatorCount(step.expectedResets);
      if (Number.isFinite(step.maximumUses)) {
        amount += ` · 최대 ${step.maximumUses.toLocaleString("ko-KR")}개`;
      }
      item.append(
        head,
        element("p", "", step.description),
        element("small", "", `평균 ${amount}`),
      );
      if (Number.isFinite(step.successProbability)) {
        item.append(element(
          "small",
          "ability-strategy-step__chance",
          `보유량 안에서 성공할 확률 ${formatProbability(step.successProbability, 2)}`,
        ));
      }
    }
    if (step.priority?.length) {
      const priority = element("ol", "ability-strategy-priority");
      step.priority.forEach((target) => priority.append(element("li", "", target)));
      if (step.fallbackPriority?.length) {
        item.append(element("strong", "ability-strategy-priority__label", "미라클 성공 시"));
      }
      item.append(priority);
    }
    if (step.fallbackPriority?.length) {
      const fallback = element("ol", "ability-strategy-priority");
      step.fallbackPriority.forEach((target) => fallback.append(element("li", "", target)));
      item.append(
        element("strong", "ability-strategy-priority__label", "미라클 소진 시"),
        fallback,
      );
    }
    strategy.append(item);
  });
  section.append(
    element("h3", "ability-strategy-title", "추천 진행 순서"),
    strategy,
    note(
      "입력한 보유량 안에서 고정 순서와 다른 목표가 먼저 완성되는 적응형 경로를 함께 비교합니다. 한 줄의 종류·등급을 확보하고 블랙·카오스로 수치를 맞춘 뒤 잠그는 경로도 포함합니다.",
    ),
    note(
      "서큘레이터 가격은 명성치로 환산하지 않습니다. 허용한 서큘레이터의 평균 필요량도 함께 확인해주세요.",
    ),
    abilityBasis(),
  );
  return section;
}

function abilityReachChanceControl(result) {
  const initialChancePercent = state.targetChanceAverage
    ? averageEquivalentTargetChancePercent(result.probability)
    : state.targetChancePercent;

  const attemptsMetric = metric("목표 도달 재설정", "-");
  const resourceMetric = metric(
    state.method === "honor" ? "목표 도달 명성치" : "목표 도달 서큘레이터",
    "-",
  );
  const paint = (chancePercent, averageMode) => {
    const chance = chancePercent / 100;
    const attempts = result.complete
      ? 0
      : averageMode
        ? result.expectedResets
        : calculateAbilityAttemptsForChance(result.probability, chance);
    const resource = attempts * result.resourcePerReset;
    attemptsMetric.querySelector("span").textContent = `${chancePercent.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}% 도달 재설정`;
    attemptsMetric.querySelector("strong").textContent = formatAttempts(attempts);
    resourceMetric.querySelector("span").textContent = `${chancePercent.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}% 도달 ${state.method === "honor" ? "명성치" : "서큘레이터"}`;
    resourceMetric.querySelector("strong").textContent = formatResource(resource);
  };

  return createReachChanceControl({
    id: "ability-target-chance-range",
    label: "목표 도달 확률",
    className: "ability-reach-control",
    value: initialChancePercent,
    min: TARGET_CHANCE_MIN,
    max: TARGET_CHANCE_MAX,
    average: state.targetChanceAverage,
    averageValue: () => averageEquivalentTargetChancePercent(result.probability),
    resetTitle: "평균 재설정 횟수 기준으로 봅니다.",
    metrics: [attemptsMetric, resourceMetric],
    normalize: normalizeTargetChance,
    onChange: (value, { average }) => {
      state.targetChancePercent = value;
      state.targetChanceAverage = average;
      paint(value, average);
    },
    onCommit: () => safeSave(state),
  });
}

function resultCard() {
  if (state.method === "optimal") return optimalResultCard();
  const result = calculateAbilityExpected({
    method: state.method,
    targets: state.targets,
    swapLower: !valueOnlyMethod() && state.swapLower,
    halfHonor: state.halfHonor,
  });
  const section = createResultCard("계산 결과");
  section.classList.add("ability-result-card");
  if (result.error) {
    section.append(element("div", "result-empty", result.error));
    return section;
  }

  const hero = element("div", "result-hero");
  hero.append(
    element(
      "span",
      "result-hero__label",
      result.complete
        ? "현재 상태"
        : state.method === "honor" ? "평균 명성치" : "평균 서큘레이터",
    ),
    element(
      "strong",
      "",
      result.complete ? "목표 달성" : formatResource(result.expectedResource),
    ),
  );
  const metrics = [
    metric("평균 재설정", result.complete ? "0회" : formatAttempts(result.expectedResets)),
    metric(
      "1회 재화",
      result.complete ? "0" : formatResource(result.resourcePerReset),
      state.method === "honor"
        ? `${result.lockCount}줄 잠금${state.halfHonor ? " · 반값" : ""}`
        : state.method === "miracle" ? "최대 수치 확정" : "옵션·등급 유지",
    ),
  ];
  section.append(
    hero,
    metricGrid(...metrics),
    abilityReachChanceControl(result),
    resultLine("1회 성공 확률", result.complete ? "이미 달성" : formatOdds(result.probability), true),
    resultLine("재설정 방식", ABILITY_RESET_METHODS[state.method].label),
  );
  section.append(
    note(
      valueOnlyMethod()
        ? state.method === "black"
          ? "현재 옵션 종류와 등급은 유지하고 수치만 재설정합니다. 블랙은 재설정 전후 결과를 선택할 수 있습니다."
          : "현재 옵션 종류와 등급은 유지하고 수치만 재설정합니다."
        : state.swapLower && !state.targets.slice(1).some((target) => target.locked)
        ? "두 번째와 세 번째 목표는 어느 아랫줄에 등장해도 성공으로 계산합니다."
        : "각 목표는 지정한 줄에 등장해야 성공으로 계산합니다.",
    ),
  );
  section.append(abilityBasis());
  return section;
}

function render() {
  if (state.method !== "optimal") stopOptimalStrategyWorker();
  const grid = element("div", "calculator-grid calculator-grid--ability");
  const controls = element("div", "calculator-column");
  controls.append(setupCard(), targetsCard());
  const result = element("div", "calculator-result");
  result.append(resultCard());
  grid.append(controls, result);
  renderWithFocus(root, [grid]);
}

render();
window.addEventListener("pagehide", stopOptimalStrategyWorker, { once: true });
