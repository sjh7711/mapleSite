// 봇과 같은 계산기를 쓴다. 2026-03-19 개편 기준이며 각 단계마다
// 파괴방지·확정복구·12성복구 중 기대비용이 낮은 쪽을 자동으로 고른다.
import {
  RESTORE_STARS,
  SAFEGUARD_STARS,
  STARFORCE_EVENTS,
  STARFORCE_MVP,
  SUPPORTED_STARFORCE_LEVELS,
  calculateStarforceExpected,
  getMaxStarforceStar,
} from "maple-core/starforce";

export {
  RESTORE_STARS,
  SAFEGUARD_STARS,
  STARFORCE_EVENTS,
  STARFORCE_MVP,
  SUPPORTED_STARFORCE_LEVELS,
};

export const MESO_PER_EOK = 100_000_000;

/**
 * 버튼으로 고르는 장비 목록. 레벨은 계산에 쓰이고 price는 스페어값 기본값이다.
 * 시세는 계속 바뀌므로 이 값은 어디까지나 출발점이고, 실제 값은 이용자가
 * 화면에서 일괄로 고쳐 각자 브라우저에 저장한다.
 */
export const EQUIPMENT_PRESETS = [
  { id: "meister-ring", name: "마이링", level: 140, price: 0.5 },
  { id: "daybreak-pendant", name: "데브펜", level: 140, price: 0.15 },
  { id: "dominator", name: "도미", level: 140, price: 15, folded: true },
  { id: "loose-control", name: "루컨마", level: 160, price: 16 },
  { id: "magic-eyepatch", name: "마깃안", level: 160, price: 37 },
  { id: "seniority-ring", name: "고근", level: 160, price: 63 },
  { id: "gaen-ring", name: "가엔링", level: 160, price: 0.15 },
  // 아케인은 견장·망토·신발 값이 같아 한 칸으로 묶는다.
  { id: "dreamy-belt", name: "몽벨", level: 200, price: 45 },
  { id: "commanding-force", name: "커포", level: 200, price: 15 },
  { id: "giant-fear", name: "거공", level: 200, price: 52 },
  { id: "whisper-earring", name: "컴플", level: 200, price: 230 },
  { id: "astra-secondary", name: "아스트라", level: 200, price: 10, npcSpare: true },
  { id: "arcane-shoulder", name: "아케인", level: 200, price: 0.1 },
  { id: "eternal-hat", name: "모상하견", level: 250, price: 0.2 },
  { id: "eternal-glove", name: "장신망", level: 250, price: 17.5 },
  { id: "origin-whisper", name: "근속", level: 250, price: 600 },
  { id: "oath-of-death", name: "죽맹", level: 250, price: 750 },
  { id: "ecstatic-nightmare", name: "황몽", level: 250, price: 580 },
  { id: "bloody-soul", name: "굶핏", level: 250, price: 800 },
  { id: "destiny-weapon", name: "데스티니", level: 250, price: 100, npcSpare: true },
  // 스타포스를 잘 올리지 않는 구간. 장비를 따로 나열하지 않고 스페어값만 넣어 쓴다.
  { id: "level-135", name: "135제", level: 135, price: 3, folded: true },
  { id: "level-145", name: "145제", level: 145, price: 4.5, folded: true },
  { id: "level-150", name: "150제", level: 150, price: 0.1, folded: true },
].map((preset) => ({
  // 아이콘 파일 이름은 표시되는 장비 이름을 그대로 쓴다. id를 쓰면 이름이 바뀌었을 때
  // 파일명이 실제 장비와 어긋나 무슨 그림인지 알기 어려워진다.
  icon: `./equipments/${encodeURIComponent(preset.name)}.png`,
  ...preset,
}));

/** 레벨별로 묶어 고르기 쉽게 만든다. */
export function groupPresetsByLevel() {
  const groups = new Map();
  for (const preset of EQUIPMENT_PRESETS) {
    if (preset.folded) continue;
    if (!groups.has(preset.level)) groups.set(preset.level, []);
    groups.get(preset.level).push(preset);
  }
  return [...groups.entries()]
    // 요즘 쓰는 장비가 위로 오도록 높은 레벨부터 늘어놓는다.
    .sort(([left], [right]) => right - left)
    .map(([level, presets]) => ({ level, presets }));
}

/** 목록 없이 스페어값만 넣어 쓰는 레벨. 접어서 맨 아래에 둔다. */
export function foldedPresets() {
  return EQUIPMENT_PRESETS.filter((preset) => preset.folded).sort(
    (left, right) => right.level - left.level,
  );
}

export function findPreset(id) {
  return EQUIPMENT_PRESETS.find((preset) => preset.id === id) ?? EQUIPMENT_PRESETS[0];
}
export const DEFAULT_START_STAR = 12;
// 실제로 도는 이벤트만 남긴다. 파괴확률 감소나 15→16 확정 이벤트는 뺐다.
export const SELECTABLE_EVENTS = ["none", "discount30", "destroy30", "shining"];
// 실제 결과가 기댓값보다 나쁠 때를 대비해 자금을 얼마나 더 잡을지 보여준다.
export const SAFETY_MULTIPLIERS = [1, 1.05, 1.08, 1.1];

export function calculateItem(item, settings) {
  // NPC에서만 사는 장비는 확정 복구에 장비를 1개만 넣고 나머지는 메소로 낸다.
  const npcSpare = EQUIPMENT_PRESETS.some(
    (preset) => preset.id === item.presetId && preset.npcSpare,
  );
  const result = calculateStarforceExpected({
    itemLevel: item.itemLevel,
    startStar: item.startStar,
    targetStar: item.targetStar,
    replacementPrice: Math.max(0, item.replacementEok) * MESO_PER_EOK,
    event: settings.event,
    mvp: settings.mvp,
    pc: settings.pc,
    // 전략은 장비마다 따로 정한다.
    optimize: item.optimize ?? true,
    destroyPrevention: item.destroyPrevention ?? [],
    restore: item.restore ?? [],
    singleSpare: npcSpare,
  });
  const replacementPrice = Math.max(0, item.replacementEok) * MESO_PER_EOK;
  // 총비용에는 파괴 때 사 넣은 스페어값이 이미 섞여 있다. 소모 개수 × 스페어값으로
  // 그만큼을 떼어내면 남는 값이 순수 강화비용이 된다.
  const replacementCost = result.expectedEquipment * replacementPrice;
  const enhanceCost = result.expectedCost - replacementCost;
  const quantity = Math.max(1, Math.round(item.quantity || 1));
  const spare = Math.max(0, Math.round(item.spare || 0));

  const totalEquipment = result.expectedEquipment * quantity;
  // 스페어는 배율을 곱한 뒤에 뺀다. 대신 강화해 주는 쪽이 떠안는 위험은
  // 여분을 받아도 그대로이므로 수수료 기준액은 줄지 않아야 하고,
  // 맡기는 쪽은 자기 스페어를 시세 그대로 인정받는다.
  // 스페어는 소모 개수가 아니라 맡기는 쪽이 미리 마련해 둔 메소로 본다.
  // 스페어 소모 기댓값으로 자르면 남는 여분이 조용히 사라져 같은 청구액이
  // 나오므로, 준비한 개수만큼 그대로 인정한다.
  const sparedEquipment = spare;
  const saved = sparedEquipment * Math.max(0, item.replacementEok) * MESO_PER_EOK;

  return {
    ...result,
    quantity,
    spare,
    totalCost: result.expectedCost * quantity,
    totalEnhanceCost: enhanceCost * quantity,
    totalReplacementCost: replacementCost * quantity,
    totalBooms: result.expectedBooms * quantity,
    totalEquipment,
    totalItems: result.expectedItems * quantity,
    sparedEquipment,
    savedCost: saved,
    totalAttempts: result.expectedAttempts * quantity,
  };
}

/** 여러 장비를 한 번에 계산하고 합계까지 낸다. 이게 이 사이트의 핵심이다. */
/**
 * 실제로 어떤 전략이 적용됐는지 단계 목록에서 뽑아낸다.
 * 자동 최적화일 때 이 결과로 버튼을 켜서 바로 알아볼 수 있게 한다.
 */
export function appliedStrategy(stages) {
  return {
    destroyPrevention: stages
      .filter((stage) => stage.safeguarded)
      .map((stage) => stage.star),
    restore: stages
      .filter((stage) => String(stage.policy).includes("확정 복구"))
      .map((stage) => stage.star),
  };
}

export function calculateAll(items, settings) {
  const results = [];
  const errors = [];

  for (const [index, item] of items.entries()) {
    try {
      results.push({ index, item, ...calculateItem(item, settings) });
    } catch (error) {
      errors.push({ index, item, message: error.message });
    }
  }

  const sum = (pick) => results.reduce((total, entry) => total + pick(entry), 0);
  const total = {
    cost: sum((entry) => entry.totalCost),
    enhanceCost: sum((entry) => entry.totalEnhanceCost),
    replacementCost: sum((entry) => entry.totalReplacementCost),
    saved: sum((entry) => entry.savedCost),
    spared: sum((entry) => entry.sparedEquipment),
    booms: sum((entry) => entry.totalBooms),
    equipment: sum((entry) => entry.totalEquipment),
    items: sum((entry) => entry.totalItems),
    attempts: sum((entry) => entry.totalAttempts),
    quantity: sum((entry) => entry.quantity),
  };

  // 단계별 기대비용을 장비 구분 없이 합쳐 어느 구간이 제일 비싼지 보여준다.
  const byStar = new Map();
  for (const entry of results) {
    for (const stage of entry.stages) {
      const previous = byStar.get(stage.star) ?? {
        star: stage.star,
        cost: 0,
        booms: 0,
        attempts: 0,
      };
      previous.cost += stage.expectedCost * entry.quantity;
      previous.booms += stage.expectedBooms * entry.quantity;
      previous.attempts += stage.expectedAttempts * entry.quantity;
      byStar.set(stage.star, previous);
    }
  }

  return {
    results,
    errors,
    total,
    stages: [...byStar.values()].sort((left, right) => left.star - right.star),
  };
}

const EOK_FORMAT = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const JO_FORMAT = new Intl.NumberFormat("ko-KR");
// 조와 함께 쓰는 억은 네 자리라 자릿수 구분 쉼표 없이 붙여 쓴다.
const REST_EOK_FORMAT = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: false,
});

/** 기댓값에 배율을 곱해 실제로 마련해야 할 금액을 낸다. */
export function applyMultiplier(cost, multiplier) {
  return Math.max(0, cost * multiplier);
}

export function formatMeso(value) {
  if (!Number.isFinite(value)) return "계산 범위 초과";
  // 억 단위로 먼저 반올림해야 조와 억으로 나눌 때 9,999.995억 같은 값이
  // 10,000.00억으로 넘치지 않는다.
  const eok = Math.round((value / MESO_PER_EOK) * 100) / 100;
  const sign = eok < 0 ? "-" : "";
  const absolute = Math.abs(eok);
  if (absolute < 10_000) return `${sign}${EOK_FORMAT.format(absolute)}억`;

  // 조 단위는 1.22조처럼 뭉뚱그리지 않고 1조 2200.00억으로 끊어서 보여준다.
  const jo = Math.floor(absolute / 10_000);
  const rest = absolute - jo * 10_000;
  const joText = `${sign}${JO_FORMAT.format(jo)}조`;
  return rest < 0.005 ? joText : `${joText} ${REST_EOK_FORMAT.format(rest)}억`;
}

export function formatNumber(value, digits = 2) {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: digits }).format(value);
}

export { getMaxStarforceStar };
