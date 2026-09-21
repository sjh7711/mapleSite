import { calculateAbilityEconomicCandidate, calculateAbilityPracticalCandidate, calculateAbilityUnlimitedCandidate, abilityPhaseMetrics, compareAbilityVectors } from "./ability-economy.js";
import { abilityResultApplies } from "./ability-result-preference.js";
export { chooseAbilityEconomicAction } from "./ability-economy.js";
import { calculateFlexibleAbilityCandidate } from "./ability-flexible.js";
export { chooseFlexibleAbilityStart } from "./ability-flexible.js";

const GRADES = ["rare", "epic", "unique", "legendary"];

export const ABILITY_GRADES = Object.freeze({
  epic: Object.freeze({ id: "epic", label: "에픽" }),
  unique: Object.freeze({ id: "unique", label: "유니크" }),
  legendary: Object.freeze({ id: "legendary", label: "레전드리" }),
});

export const ABILITY_RESET_METHODS = Object.freeze({
  optimal: Object.freeze({
    id: "optimal",
    label: "최적 전략",
    resourceLabel: "명성치",
    locks: false,
    strategy: true,
  }),
  honor: Object.freeze({
    id: "honor",
    label: "일반 재설정",
    resourceLabel: "명성치",
    locks: true,
  }),
  advanced: Object.freeze({
    id: "advanced", label: "고급 재설정", resourceLabel: "명성치", locks: true,
    lowerLegendary: true,
    source: "https://maplestory.nexon.com/Guide/OtherProbability/ability/reputevalue",
  }),
  miracle: Object.freeze({
    id: "miracle",
    label: "미서큘",
    resourceLabel: "서큘레이터",
    locks: false,
  }),
  black: Object.freeze({
    id: "black",
    label: "블서큘(카서큘)",
    resourceLabel: "서큘레이터",
    locks: false,
    valueOnly: true,
  }),
  abyss: Object.freeze({
    id: "abyss", label: "심서큘", resourceLabel: "서큘레이터",
    locks: false, valueOnly: true, lowerLegendary: true,
    source: "https://maplestory.nexon.com/Guide/OtherProbability/ability/reputevalue",
  }),
  chaos: Object.freeze({
    id: "chaos",
    label: "카서큘",
    resourceLabel: "서큘레이터",
    locks: false,
    valueOnly: true,
  }),
});

const VALUE_CHANCES = Object.freeze([0.2, 0.2, 0.2, 0.15, 0.15, 0.1]);

const VALUE_GROUPS = Object.freeze({
  stat: {
    rare: [5, 6, 7, 8, 9, 10],
    epic: [15, 16, 17, 18, 19, 20],
    unique: [25, 26, 27, 28, 29, 30],
    legendary: [35, 36, 37, 38, 39, 40],
  },
  hp: {
    rare: [75, 90, 105, 120, 135, 150],
    epic: [225, 240, 255, 270, 285, 300],
    unique: [375, 390, 405, 420, 435, 450],
    legendary: [525, 540, 555, 570, 585, 600],
  },
  attack: {
    rare: [],
    epic: [6, 6, 9, 9, 9, 12],
    unique: [15, 18, 18, 18, 21, 21],
    legendary: [27, 27, 27, 30, 30, 30],
  },
  percentHigh: {
    rare: [],
    epic: [],
    unique: [5, 6, 7, 8, 9, 10],
    legendary: [15, 16, 17, 18, 19, 20],
  },
  damageLow: {
    rare: [2, 2, 2, 2, 3, 3],
    epic: [4, 4, 5, 5, 5, 5],
    unique: [7, 7, 7, 7, 8, 8],
    legendary: [9, 9, 10, 10, 10, 10],
  },
  critical: {
    rare: [],
    epic: [5, 6, 7, 8, 9, 10],
    unique: [15, 16, 17, 18, 19, 20],
    legendary: [25, 26, 27, 28, 29, 30],
  },
  defenseDamage: {
    rare: [],
    epic: [],
    unique: [13, 15, 18, 20, 23, 25],
    legendary: [38, 40, 43, 45, 48, 50],
  },
  buff: {
    rare: [7, 8, 9, 10, 12, 13],
    epic: [19, 20, 22, 23, 24, 25],
    unique: [32, 33, 34, 35, 37, 38],
    legendary: [44, 45, 47, 48, 49, 50],
  },
  acquisition: {
    rare: [3, 3, 4, 4, 5, 5],
    epic: [8, 8, 9, 9, 10, 10],
    unique: [13, 13, 14, 14, 15, 15],
    legendary: [18, 18, 19, 19, 20, 20],
  },
  movement: {
    rare: [4, 4, 6, 6, 6, 8],
    epic: [10, 12, 12, 12, 14, 14],
    unique: [18, 18, 18, 20, 20, 20],
    legendary: [],
  },
  defenseFlat: {
    rare: [50, 60, 70, 80, 90, 100],
    epic: [150, 160, 170, 180, 190, 200],
    unique: [250, 260, 270, 280, 290, 300],
    legendary: [350, 360, 370, 380, 390, 400],
  },
  fixed: {
    rare: [1, 1, 1, 1, 1, 1],
    epic: [1, 1, 1, 1, 1, 1],
    unique: [1, 1, 1, 1, 1, 1],
    legendary: [1, 1, 1, 1, 1, 1],
  },
});

const HONOR_WEIGHT_GROUPS = Object.freeze({
  zero: [0, 0, 0, 0],
  stat: [3.8927, 4.1705, 4.2254, 4.1628],
  hp: [3.7197, 2.7804, 2.3474, 1.8501],
  attack: [0, 1.8536, 1.4085, 2.3127],
  critical: [0, 0.9268, 0.4695, 0.4625],
  allStat: [3.4602, 2.7804, 1.8779, 1.8501],
  legendarySpeed: [0, 0, 0, 0.4625],
  apTransfer: [2.5952, 2.7804, 2.8169, 2.3127],
  legendaryLevel: [0, 0, 0, 2.3127],
  uniquePercent: [0, 0, 1.8779, 1.8501],
  boss: [0, 0, 0.939, 2.3127],
  lowDamage: [3.02768, 2.7804, 1.8779, 1.8501],
  uniqueSpecial: [0, 0, 1.8779, 1.8501],
  legendarySpecial: [0, 0, 0, 0.7401],
  buff: [3.4602, 1.3902, 0.939, 0.9251],
  acquisition: [3.4602, 2.7804, 1.8779, 1.8501],
  pair: [3.8927, 3.8925, 3.7559, 3.2377],
});

const MIRACLE_WEIGHT_OVERRIDES = Object.freeze({
  stat: [3.8927, 4.0577, 4.0724, 4.1628],
  hp: [3.7197, 2.7051, 2.2624, 1.8501],
  attack: [0, 2.7051, 2.2624, 2.3127],
  critical: [0, 1.8034, 0.905, 0.4625],
  allStat: [3.4602, 2.7051, 1.81, 1.8501],
  apTransfer: [2.5952, 2.7051, 2.7149, 2.3127],
  uniquePercent: [0, 0, 1.81, 1.8501],
  boss: [0, 0, 2.2624, 2.3127],
  lowDamage: [3.02768, 2.7051, 1.81, 1.8501],
  uniqueSpecial: [0, 0, 1.81, 1.8501],
  buff: [3.4602, 1.3526, 0.905, 0.9251],
  acquisition: [3.4602, 2.7051, 1.81, 1.8501],
  pair: [3.8927, 3.7872, 3.6199, 3.2377],
});

function option(id, label, weightGroup, valueGroup, unit = "") {
  return Object.freeze({ id, label, weightGroup, valueGroup, unit });
}

const BASE_OPTIONS = [
  option("str", "STR 증가", "stat", "stat"),
  option("dex", "DEX 증가", "stat", "stat"),
  option("int", "INT 증가", "stat", "stat"),
  option("luk", "LUK 증가", "stat", "stat"),
  option("max-hp", "최대 HP 증가", "hp", "hp"),
  option("max-mp", "최대 MP 증가", "hp", "hp"),
  option("attack", "공격력 증가", "attack", "attack"),
  option("magic", "마력 증가", "attack", "attack"),
  option("critical", "크리티컬 확률 증가", "critical", "critical", "%"),
  option("all-stat", "모든 능력치 증가", "allStat", "stat"),
  option("attack-speed", "공격 속도 단계 증가", "legendarySpeed", "fixed", "단계"),
  option("ap-str-to-dex", "투자 STR 비례 DEX 증가", "apTransfer", "damageLow", "%"),
  option("ap-dex-to-str", "투자 DEX 비례 STR 증가", "apTransfer", "damageLow", "%"),
  option("ap-int-to-luk", "투자 INT 비례 LUK 증가", "apTransfer", "damageLow", "%"),
  option("ap-luk-to-dex", "투자 LUK 비례 DEX 증가", "apTransfer", "damageLow", "%"),
  // 이 두 옵션은 작은 레벨 간격일수록 좋은 역방향 수치라 목표 선택에서는 제외한다.
  Object.freeze({
    id: "level-attack",
    label: "일정 레벨마다 공격력 +1",
    weightGroup: "legendaryLevel",
    valueGroup: null,
    unit: "",
  }),
  Object.freeze({
    id: "level-magic",
    label: "일정 레벨마다 마력 +1",
    weightGroup: "legendaryLevel",
    valueGroup: null,
    unit: "",
  }),
  option("max-hp-percent", "최대 HP % 증가", "uniquePercent", "percentHigh", "%"),
  option("max-mp-percent", "최대 MP % 증가", "uniquePercent", "percentHigh", "%"),
  option("boss-damage", "보스 몬스터 공격 시 데미지 증가", "boss", "percentHigh", "%"),
  option("normal-damage", "일반 몬스터 공격 시 데미지 증가", "lowDamage", "damageLow", "%"),
  option("abnormal-damage", "상태 이상 대상 공격 시 데미지 증가", "lowDamage", "damageLow", "%"),
  option("defense-damage", "방어력 비례 데미지 고정값 증가", "uniqueSpecial", "defenseDamage", "%"),
  option("cooldown-skip", "스킬 재사용 대기시간 미적용", "uniqueSpecial", "percentHigh", "%"),
  option("passive-level", "패시브 스킬 레벨 증가", "legendarySpecial", "fixed"),
  option("multi-target", "다수 공격 스킬 대상 증가", "legendarySpecial", "fixed", "명"),
  option("buff-duration", "버프 스킬 지속 시간 증가", "buff", "buff", "%"),
  option("item-drop", "아이템 드롭률 증가", "acquisition", "acquisition", "%"),
  option("meso-drop", "메소 획득량 증가", "acquisition", "acquisition", "%"),
  // 아래 네 종류는 일반 재설정으로 새로 등장하지 않고 카오스·블랙 수치 재설정에서만 사용한다.
  option("jump", "점프력 증가", "zero", "movement"),
  option("move-speed", "이동속도 증가", "zero", "movement"),
  option("defense-percent", "방어력 % 증가", "zero", "percentHigh", "%"),
  option("defense-flat", "방어력 증가", "zero", "defenseFlat"),
];

const PAIR_OPTIONS = [
  ["str-dex", "STR, DEX 증가"],
  ["str-int", "STR, INT 증가"],
  ["str-luk", "STR, LUK 증가"],
  ["dex-int", "DEX, INT 증가"],
  ["dex-luk", "DEX, LUK 증가"],
  ["int-luk", "INT, LUK 증가"],
  ["dex-str", "DEX, STR 증가"],
  ["int-str", "INT, STR 증가"],
  ["luk-str", "LUK, STR 증가"],
  ["int-dex", "INT, DEX 증가"],
  ["luk-dex", "LUK, DEX 증가"],
  ["luk-int", "LUK, INT 증가"],
].map(([id, label]) => option(id, label, "pair", "stat"));

export const ABILITY_OPTIONS = Object.freeze([...BASE_OPTIONS, ...PAIR_OPTIONS]);
const OPTIONS_BY_ID = new Map(ABILITY_OPTIONS.map((entry) => [entry.id, entry]));

function gradeIndex(grade) {
  const index = GRADES.indexOf(grade);
  if (index < 0) throw new RangeError(`지원하지 않는 어빌리티 등급입니다: ${grade}`);
  return index;
}

function methodInfo(method) {
  const info = ABILITY_RESET_METHODS[method];
  if (!info) throw new RangeError(`지원하지 않는 재설정 방식입니다: ${method}`);
  return info;
}

function optionWeight(entry, grade, method) {
  const group = method === "miracle"
    ? MIRACLE_WEIGHT_OVERRIDES[entry.weightGroup] ?? HONOR_WEIGHT_GROUPS[entry.weightGroup]
    : HONOR_WEIGHT_GROUPS[entry.weightGroup];
  return (group?.[gradeIndex(grade)] ?? 0) / 100;
}

function lineGradeDistribution(line, method = "honor") {
  if (line === 0) return [["legendary", 1]];
  return method === "advanced"
    ? [["legendary", 0.02], ["unique", 0.15], ["epic", 0.83]]
    : [["unique", 0.15], ["epic", 0.85]];
}

function rawValues(entry, grade) {
  if (!entry?.valueGroup) return [];
  return VALUE_GROUPS[entry.valueGroup]?.[grade] ?? [];
}

function valueTailProbability(entry, grade, minimum, method) {
  const values = rawValues(entry, grade);
  if (!values.length) return 0;
  if (method === "miracle") {
    return Math.max(...values) >= minimum ? 1 : 0;
  }
  return values.reduce(
    (sum, value, index) => sum + (value >= minimum ? VALUE_CHANCES[index] : 0),
    0,
  );
}

function targetGrades(line, method, currentGrade) {
  const resetMethod = methodInfo(method);
  if (!resetMethod.valueOnly) {
    if (method === "advanced" && GRADES.includes(currentGrade)) return [Number(line) === 0 ? "legendary" : currentGrade];
    return lineGradeDistribution(Number(line), method).map(([grade]) => grade);
  }
  if (Number(line) === 0) return ["legendary"];
  if (resetMethod.lowerLegendary && currentGrade === "legendary") return ["legendary"];
  return [currentGrade === "epic" ? "epic" : "unique"];
}

export function getAbilityTargetOptions(line, method = "honor", currentGrade = null) {
  const resetMethod = methodInfo(method);
  const grades = targetGrades(line, method, currentGrade);
  return ABILITY_OPTIONS.filter(
    (entry) =>
      entry.valueGroup &&
      grades.some(
        (grade) => rawValues(entry, grade).length && (
          resetMethod.valueOnly || optionWeight(entry, grade, method) > 0
        ),
      ),
  );
}

export function getAbilityTargetValues(type, line, method = "honor", currentGrade = null) {
  const resetMethod = methodInfo(method);
  const entry = OPTIONS_BY_ID.get(type);
  if (!entry?.valueGroup) return [];
  const grades = targetGrades(line, method, currentGrade);
  const values = grades.flatMap((grade) => {
    if (!resetMethod.valueOnly && optionWeight(entry, grade, method) <= 0) return [];
    const candidates = rawValues(entry, grade);
    if (method === "miracle") return candidates.length ? [Math.max(...candidates)] : [];
    return candidates;
  });
  return [...new Set(values)].sort((a, b) => a - b);
}

export function getAbilityOption(type) {
  return OPTIONS_BY_ID.get(type) ?? null;
}

export function getAbilityHonorCost(lockCount, halfCost = false) {
  const cost = [8000, 11000, 16000][Math.max(0, Math.min(2, Number(lockCount) || 0))];
  return halfCost ? cost / 2 : cost;
}

export function getAbilityResetHonorCost(method, lockCount, halfCost = false) {
  const cost = method === "advanced"
    ? [20_000, 30_000, 40_000][Math.max(0, Math.min(2, lockCount))]
    : getAbilityHonorCost(lockCount);
  return halfCost ? cost / 2 : cost;
}

function abilityResetMesoCost(method, lockCount) {
  return method === "advanced" ? [2_000_000, 6_000_000, 15_000_000][lockCount] ?? 0 : 0;
}

// Σ p(실패 결과)^2. 동일 수치가 여러 가중치 칸에 있으면 먼저 합쳐야 한다.
function abilityFailureCollision(targets, swapLower) {
  const locked = new Set(targets.filter((target) => target.locked).map((target) => target.type));
  const lowerLocked = targets.slice(1).some((target) => target.locked);
  const valuesByOption = new Map();
  for (const grade of ["epic", "unique", "legendary"]) {
    for (const entry of ABILITY_OPTIONS) {
      const values = entry.valueGroup ? rawValues(entry, grade)
        : grade === "legendary" ? [16, 14, 14, 12, 12, 10] : [];
      const distribution = new Map();
      values.forEach((value, index) => distribution.set(value, (distribution.get(value) ?? 0) + VALUE_CHANCES[index]));
      valuesByOption.set(`${entry.id}:${grade}`, [...distribution]);
    }
  }
  const choices = targets.map((target, line) => target.locked ? [null]
    : lineGradeDistribution(line, "advanced").flatMap(([grade, gradeChance]) =>
      ABILITY_OPTIONS.filter((entry) => !locked.has(entry.id)).flatMap((entry) => {
        const weight = optionWeight(entry, grade, "advanced");
        const distribution = valuesByOption.get(`${entry.id}:${grade}`);
        if (!(weight > 0) || !distribution.length) return [];
        const moment = distribution.reduce((sum, [, chance]) => sum + chance ** 2, 0);
        const matches = targets.map((goal) => {
          if (!goal.type) return moment;
          if (entry.id !== goal.type || gradeIndex(grade) < gradeIndex(goal.grade)) return 0;
          return distribution.reduce((sum, [value, chance]) => sum + (value >= goal.minimum ? chance ** 2 : 0), 0);
        });
        return [{ type: entry.id, grade, weight, gradeChance, moment, matches }];
      })));
  let failure = 0;
  const selected = [];
  const used = new Set(locked);
  function visit(line, probability) {
    if (line === 3) {
      const all = selected.reduce((v, entry) => v * (entry?.moment ?? 1), 1);
      const match = (position, goal) => targets[position].locked ? 1 : selected[position].matches[goal];
      let success = match(0, 0);
      if (!swapLower || lowerLocked) success *= match(1, 1) * match(2, 2);
      else {
        const lowerGoals = [1, 2].filter((index) => targets[index].type);
        success *= lowerGoals.length === 2
          ? match(1, 1) * match(2, 2) + match(1, 2) * match(2, 1)
          : lowerGoals.length === 1
            ? match(1, lowerGoals[0]) * selected[2].moment + match(2, lowerGoals[0]) * selected[1].moment
            : selected[1].moment * selected[2].moment;
      }
      failure += probability ** 2 * Math.max(0, all - success);
      return;
    }
    if (targets[line].locked) { selected[line] = null; visit(line + 1, probability); return; }
    const denominators = new Map();
    for (const entry of choices[line]) {
      if (!used.has(entry.type)) denominators.set(entry.grade, (denominators.get(entry.grade) ?? 0) + entry.weight);
    }
    for (const entry of choices[line]) {
      if (used.has(entry.type)) continue;
      selected[line] = entry; used.add(entry.type);
      visit(line + 1, probability * entry.gradeChance * entry.weight / denominators.get(entry.grade));
      used.delete(entry.type);
    }
  }
  visit(0, 1);
  return failure;
}

export function calculateAbilityAttemptsForChance(probability, targetChance) {
  if (!Number.isFinite(probability) || probability <= 0) return Infinity;
  if (probability >= 1) return 1;
  const target = Math.max(0, Math.min(1, Number(targetChance)));
  if (target <= 0) return 0;
  if (target >= 1) return Infinity;
  return Math.ceil(Math.log1p(-target) / Math.log1p(-probability));
}

function lineMatchProbability(outcome, target, method) {
  if (!target?.type) return 1;
  if (target.locked) return 1;
  if (outcome?.type !== target.type) return 0;
  if (method === "advanced" && gradeIndex(outcome.grade) < gradeIndex(target.grade)) return 0;
  const entry = OPTIONS_BY_ID.get(target.type);
  return valueTailProbability(entry, outcome.grade, Number(target.minimum), method);
}

function targetsMatchProbability(outcomes, targets, swapLower, method) {
  const first = lineMatchProbability(outcomes[0], targets[0], method);
  if (!first) return 0;

  const lowerLocked = targets.slice(1).some((target) => target?.locked);
  if (!swapLower || lowerLocked) {
    return first *
      lineMatchProbability(outcomes[1], targets[1], method) *
      lineMatchProbability(outcomes[2], targets[2], method);
  }

  const lowerTargets = targets.slice(1).filter((target) => target?.type);
  if (!lowerTargets.length) return first;
  if (lowerTargets.length === 1) {
    return first * (
      lineMatchProbability(outcomes[1], lowerTargets[0], method) +
      lineMatchProbability(outcomes[2], lowerTargets[0], method)
    );
  }
  return first * (
    lineMatchProbability(outcomes[1], lowerTargets[0], method) *
      lineMatchProbability(outcomes[2], lowerTargets[1], method) +
    lineMatchProbability(outcomes[1], lowerTargets[1], method) *
      lineMatchProbability(outcomes[2], lowerTargets[0], method)
  );
}

/**
 * 레전드리 어빌리티 한 번의 재설정으로 목표 줄을 얻을 확률을 계산한다.
 * 고정된 줄은 이미 목표 수치 이상이라고 보고 확률 1로 유지한다.
 */
// The shared official table, updated 2026-09-17, explicitly covers Abyss.
// All three grades/types stay fixed. Identical full results are excluded.
// Without current values, average over the official failing-value distribution;
// keep that original result until every requested value is reached.
function calculateAbyssExpected(targets) {
  const empty = { probability: 0, expectedResets: Infinity, expectedResource: Infinity,
    resourcePerReset: 1, lockCount: 0, complete: false };
  if (targets.some((target) => !target.type)) return {
    ...empty, error: "심서큘은 세 줄의 옵션과 목표 수치를 모두 선택해주세요.",
  };
  const tables = targets.map((target) => {
    const grouped = new Map();
    rawValues(OPTIONS_BY_ID.get(target.type), target.grade).forEach((value, index) => {
      grouped.set(value, (grouped.get(value) ?? 0) + VALUE_CHANCES[index]);
    });
    return [...grouped];
  });
  let success = 0;
  const failures = [];
  function visit(line, probability, matched) {
    if (line === 3) {
      if (matched) success += probability;
      else failures.push(probability);
      return;
    }
    for (const [value, chance] of tables[line]) {
      visit(line + 1, probability * chance, matched && value >= targets[line].minimum);
    }
  }
  visit(0, 1, true);
  if (!(success > 0)) return { ...empty, error: "선택한 줄 등급에서는 해당 목표 수치를 얻을 수 없습니다." };
  if (!failures.length) return { ...empty, probability: 1, rawProbability: 1,
    expectedResets: 0, expectedResource: 0, resourcePerReset: 0, complete: true, error: null, failureStates: [] };
  const totalFailure = failures.reduce((sum, probability) => sum + probability, 0);
  const failureStates = failures.map((probability) => ({
    weight: probability / totalFailure,
    successProbability: Math.min(1, success / (1 - probability)),
  }));
  const expectedResets = failureStates.reduce((sum, state) => sum + state.weight / state.successProbability, 0);
  return {
    ...empty, probability: failureStates.reduce((sum, state) => sum + state.weight * state.successProbability, 0),
    rawProbability: success, expectedResets, expectedResource: expectedResets,
    sameResultExcluded: true, failureStates, error: null,
  };
}

export function calculateAbilityAbyssChanceWithin(result, attempts) {
  if (result.complete) return 1;
  const count = Math.max(0, Math.floor(Number(attempts) || 0));
  if (count === 0) return 0;
  return (result.failureStates ?? []).reduce((sum, state) =>
    sum + state.weight * -Math.expm1(count * Math.log1p(-state.successProbability)), 0);
}

export function calculateAbilityAbyssAttemptsForChance(result, chance) {
  if (!(chance > 0 && chance < 1)) throw new RangeError("목표 확률은 0보다 크고 1보다 작아야 합니다.");
  if (result.complete) return 0;
  if (!result.failureStates?.length) return Infinity;
  const slowest = Math.min(...result.failureStates.map((state) => state.successProbability));
  let low = 1;
  let high = slowest === 1 ? 1 : Math.ceil(Math.log1p(-chance) / Math.log1p(-slowest));
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (calculateAbilityAbyssChanceWithin(result, middle) + 1e-12 >= chance) high = middle;
    else low = middle + 1;
  }
  return low;
}

export function calculateAbilityExpected({
  method = "honor",
  targets = [],
  swapLower = true,
  halfHonor = false,
} = {}) {
  const resetMethod = methodInfo(method);
  const normalizedTargets = Array.from({ length: 3 }, (_, line) => {
    const target = targets[line] ?? {};
    const type = OPTIONS_BY_ID.has(target.type) ? target.type : "";
    return {
      type,
      minimum: Number(target.minimum) || 0,
      grade: line === 0
        ? "legendary"
        : resetMethod.lowerLegendary && target.grade === "legendary" ? "legendary"
          : target.grade === "epic" ? "epic" : "unique",
      locked: resetMethod.locks && Boolean(type) && Boolean(target.locked),
    };
  });
  const active = normalizedTargets.filter((target) => target.type);
  const duplicates = active.length !== new Set(active.map((target) => target.type)).size;
  if (!active.length) {
    return {
      probability: 0,
      expectedResets: Infinity,
      resourcePerReset: ["honor", "advanced"].includes(method) ? getAbilityResetHonorCost(method, 0, halfHonor) : 1,
      expectedResource: Infinity,
      lockCount: 0,
      error: "목표 옵션을 하나 이상 선택해주세요.",
    };
  }
  if (duplicates) {
    return {
      probability: 0,
      expectedResets: Infinity,
      resourcePerReset: ["honor", "advanced"].includes(method) ? getAbilityResetHonorCost(method, 0, halfHonor) : 1,
      expectedResource: Infinity,
      lockCount: normalizedTargets.filter((target) => target.locked).length,
      error: "어빌리티에는 같은 종류의 옵션이 중복해서 등장하지 않습니다.",
    };
  }

  const unlockedTargets = active.filter((target) => !target.locked);
  const lockCount = normalizedTargets.filter((target) => target.locked).length;
  const resourcePerReset = ["honor", "advanced"].includes(method)
    ? getAbilityResetHonorCost(method, lockCount, halfHonor)
    : 1;
  if (!unlockedTargets.length) {
    return {
      probability: 1,
      expectedResets: 0,
      resourcePerReset: 0,
      expectedResource: 0,
      lockCount,
      complete: true,
      error: null,
    };
  }

  if (resetMethod.valueOnly) {
    if (method === "abyss") return calculateAbyssExpected(normalizedTargets);
    const probability = active.reduce((product, target) => {
      const entry = OPTIONS_BY_ID.get(target.type);
      return product * valueTailProbability(
        entry,
        target.grade,
        target.minimum,
        method,
      );
    }, 1);
    const expectedResets = probability > 0 ? 1 / probability : Infinity;
    return {
      probability,
      expectedResets,
      resourcePerReset,
      expectedResource: expectedResets * resourcePerReset,
      lockCount: 0,
      complete: false,
      error: probability > 0
        ? null
        : "선택한 줄 등급에서는 해당 목표 수치를 얻을 수 없습니다.",
    };
  }

  const used = new Set(
    normalizedTargets.filter((target) => target.locked).map((target) => target.type),
  );
  const outcomes = normalizedTargets.map((target, line) =>
    target.locked ? { type: target.type, grade: line === 0 ? "legendary" : null } : null,
  );
  const hasUnlockedLowerTarget = normalizedTargets
    .slice(1)
    .some((target) => target.type && !target.locked);
  const unlockedLowerTargets = normalizedTargets
    .slice(1)
    .filter((target) => target.type && !target.locked);
  const unlockedLowerTypes = new Set(unlockedLowerTargets.map((target) => target.type));
  const lowerLocked = normalizedTargets
    .slice(1)
    .some((target) => target.locked);
  let probability = 0;

  function visit(line, pathProbability) {
    if (line === 1 && !hasUnlockedLowerTarget) {
      probability += pathProbability * lineMatchProbability(
        outcomes[0],
        normalizedTargets[0],
        method,
      );
      return;
    }
    if (line >= 3) {
      probability += pathProbability * targetsMatchProbability(
        outcomes,
        normalizedTargets,
        swapLower,
        method,
      );
      return;
    }
    if (
      line === 2 && swapLower && !lowerLocked &&
      unlockedLowerTargets.length === 1 &&
      outcomes[1]?.type === unlockedLowerTargets[0].type
    ) {
      probability += pathProbability *
        lineMatchProbability(outcomes[0], normalizedTargets[0], method) *
        lineMatchProbability(outcomes[1], unlockedLowerTargets[0], method);
      return;
    }
    if (normalizedTargets[line].locked) {
      visit(line + 1, pathProbability);
      return;
    }
    for (const [grade, gradeProbability] of lineGradeDistribution(line, method)) {
      const available = ABILITY_OPTIONS
        .filter((entry) => !used.has(entry.id))
        .map((entry) => [entry, optionWeight(entry, grade, method)])
        .filter(([, weight]) => weight > 0);
      const totalWeight = available.reduce((sum, [, weight]) => sum + weight, 0);
      const fixedTarget = line === 0 || !swapLower || lowerLocked
        ? normalizedTargets[line]?.type
        : "";
      let candidates = fixedTarget
        ? available.filter(([entry]) => entry.id === fixedTarget)
        : available;
      // 순서 무관인 아랫줄 두 개를 검사할 때 마지막 줄은 목표 옵션만
      // 성공에 기여한다. 목표가 둘이면 두 번째 줄도 그 둘 중 하나여야 한다.
      // 결과 확률은 그대로 두고 무관한 조합의 전개만 제거한다.
      if (
        !fixedTarget && swapLower && !lowerLocked &&
        (line === 2 || (line === 1 && unlockedLowerTargets.length === 2))
      ) {
        candidates = candidates.filter(([entry]) => unlockedLowerTypes.has(entry.id));
      }
      for (const [entry, weight] of candidates) {
        const nextProbability = pathProbability * gradeProbability * weight / totalWeight;
        if (nextProbability <= 0) continue;
        outcomes[line] = { type: entry.id, grade };
        used.add(entry.id);
        visit(line + 1, nextProbability);
        used.delete(entry.id);
      }
    }
  }

  visit(0, 1);
  probability = Math.max(0, Math.min(1, probability));
  const rawProbability = probability;
  // 동일 결과 제외: 현재 미달 옵션을 공식 분포로 평균한 실패 상태의
  // 방정식을 2차 모멘트로 풀어 평균 재설정 횟수를 계산한다.
  const failureCollision = method === "advanced" && probability > 0 && probability < 1
    ? abilityFailureCollision(normalizedTargets, swapLower) : 0;
  const expectedResets = probability > 0
    ? (1 - failureCollision / (1 - probability || 1)) / probability : Infinity;
  probability = expectedResets > 0 ? Math.min(1, 1 / expectedResets) : rawProbability;
  const mesoPerReset = abilityResetMesoCost(method, lockCount);
  return {
    rawProbability,
    sameResultExcluded: method === "advanced",
    mesoPerReset,
    expectedMeso: expectedResets * mesoPerReset,
    probability,
    expectedResets,
    resourcePerReset,
    expectedResource: expectedResets * resourcePerReset,
    lockCount,
    complete: false,
    error: probability > 0 ? null : "선택한 줄에서는 해당 목표를 얻을 수 없습니다.",
  };
}

function popcount(value) {
  let count = 0;
  for (let current = value; current; current &= current - 1) count += 1;
  return count;
}

function normalizeStrategyTargets(targets, method = "honor") {
  return Array.from({ length: 3 }, (_, line) => {
    const target = targets[line] ?? {};
    const type = OPTIONS_BY_ID.has(target.type) ? target.type : "";
    return {
      type,
      minimum: Number(target.minimum) || 0,
      grade: line === 0
        ? "legendary"
        : method === "advanced" && target.grade === "legendary" ? "legendary"
        : target.grade === "epic" ? "epic" : "unique",
      locked: false,
    };
  });
}

function matchingTargetBit(outcome, line, targets, swapLower, lowerLocked) {
  if (!outcome) return -1;
  if (line === 0) return targets[0]?.type === outcome.type ? 0 : -1;
  if (!swapLower || lowerLocked) {
    return targets[line]?.type === outcome.type ? line : -1;
  }
  return targets.findIndex(
    (target, targetLine) => targetLine > 0 && target?.type === outcome.type,
  );
}

const HONOR_TRANSITION_CACHE = new Map();

/**
 * 이미 완성된 줄은 모두 잠근다는 정책에서 한 번의 명성치 재설정 뒤
 * 새로 완성되는 목표 줄 조합의 확률을 계산한다.
 */
function honorTransitionDistribution(targets, achievedMask, swapLower, method = "honor", exactGrades = false) {
  const cacheKey = `${method}/${targets.map((target) => (
    `${target.type}:${target.minimum}:${target.grade}`
  )).join("|")}/${achievedMask}/${swapLower ? 1 : 0}/${exactGrades ? 1 : 0}`;
  const cached = HONOR_TRANSITION_CACHE.get(cacheKey);
  if (cached) return cached;
  const used = new Set();
  const outcomes = [null, null, null];
  for (let line = 0; line < 3; line += 1) {
    if (!(achievedMask & (1 << line))) continue;
    used.add(targets[line].type);
    outcomes[line] = {
      type: targets[line].type,
      grade: line === 0 ? "legendary" : targets[line].grade,
    };
  }
  const lowerLocked = Boolean(achievedMask & 0b110);
  const distribution = new Float64Array(8);
  // 고급 재설정의 동일 결과 제외 보정에는 옵션 수치까지 포함한 Σp²가 필요하다.
  const collisions = new Float64Array(8);
  const valueDistributions = new Map();
  if (method === "advanced") {
    for (const grade of ["legendary", "unique", "epic"]) {
      for (const entry of ABILITY_OPTIONS) {
        const values = entry.valueGroup ? rawValues(entry, grade)
          : grade === "legendary" ? [16, 14, 14, 12, 12, 10] : [];
        const chances = new Map();
        values.forEach((value, index) => chances.set(value, (chances.get(value) ?? 0) + VALUE_CHANCES[index]));
        valueDistributions.set(`${entry.id}:${grade}`, [...chances]);
      }
    }
  }
  const hasUnlockedLowerTarget = targets.slice(1).some(
    (target, index) => target.type && !(achievedMask & (1 << (index + 1))),
  );
  const lastRelevantLine = method === "advanced" || (swapLower && !lowerLocked && hasUnlockedLowerTarget)
    ? 2
    : targets.reduce(
      (last, target, line) => target.type && !(achievedMask & (1 << line))
        ? Math.max(last, line)
        : last,
      0,
    );

  function record(pathProbability) {
    const matches = [];
    for (let line = 0; line < 3; line += 1) {
      if (achievedMask & (1 << line)) continue;
      const targetLine = matchingTargetBit(
        outcomes[line],
        line,
        targets,
        swapLower,
        lowerLocked,
      );
      if (targetLine < 0 || (achievedMask & (1 << targetLine))) continue;
      const target = targets[targetLine];
      if (!target?.type) continue;
      if (exactGrades && outcomes[line].grade !== target.grade) continue;
      if (method === "advanced" && gradeIndex(outcomes[line].grade) < gradeIndex(target.grade)) continue;
      const probability = valueTailProbability(
        OPTIONS_BY_ID.get(target.type),
        outcomes[line].grade,
        target.minimum,
        method,
      );
      if (probability > 0) matches.push([targetLine, probability]);
    }

    function distributeMatch(index, mask, probability) {
      if (index >= matches.length) {
        distribution[mask] += probability;
        return;
      }
      const [targetLine, hitProbability] = matches[index];
      distributeMatch(index + 1, mask, probability * (1 - hitProbability));
      distributeMatch(
        index + 1,
        mask | (1 << targetLine),
        probability * hitProbability,
      );
    }
    distributeMatch(0, achievedMask, pathProbability);
    if (method === "advanced") {
      // 정확히 같은 수치는 먼저 합산한다. 예: 공격력 27의 여러 확률 칸.
      let moments = new Map([[achievedMask, pathProbability ** 2]]);
      for (let line = 0; line < 3; line += 1) {
        if (achievedMask & (1 << line)) continue;
        const outcome = outcomes[line];
        const targetLine = matchingTargetBit(outcome, line, targets, swapLower, lowerLocked);
        const target = targets[targetLine];
        let hit = 0;
        let miss = 0;
        for (const [value, chance] of valueDistributions.get(`${outcome.type}:${outcome.grade}`)) {
          if (target?.type && (!exactGrades || outcome.grade === target.grade) && !(achievedMask & (1 << targetLine)) &&
              gradeIndex(outcome.grade) >= gradeIndex(target.grade) && value >= target.minimum) hit += chance ** 2;
          else miss += chance ** 2;
        }
        const next = new Map();
        for (const [mask, moment] of moments) {
          next.set(mask, (next.get(mask) ?? 0) + moment * miss);
          if (hit > 0) {
            const hitMask = mask | (1 << targetLine);
            next.set(hitMask, (next.get(hitMask) ?? 0) + moment * hit);
          }
        }
        moments = next;
      }
      for (const [mask, moment] of moments) collisions[mask] += moment;
    }
  }

  function visit(line, pathProbability) {
    if (line > lastRelevantLine) {
      record(pathProbability);
      return;
    }
    if (achievedMask & (1 << line)) {
      visit(line + 1, pathProbability);
      return;
    }
    for (const [grade, gradeProbability] of lineGradeDistribution(line, method)) {
      let totalWeight = 0;
      for (const entry of ABILITY_OPTIONS) {
        if (!used.has(entry.id)) totalWeight += optionWeight(entry, grade, method);
      }
      for (const entry of ABILITY_OPTIONS) {
        if (used.has(entry.id)) continue;
        const weight = optionWeight(entry, grade, method);
        if (weight <= 0) continue;
        const nextProbability = pathProbability * gradeProbability * weight / totalWeight;
        if (nextProbability <= 0) continue;
        outcomes[line] = { type: entry.id, grade };
        used.add(entry.id);
        visit(line + 1, nextProbability);
        used.delete(entry.id);
      }
    }
  }

  visit(0, 1);
  if (HONOR_TRANSITION_CACHE.size >= 256) {
    HONOR_TRANSITION_CACHE.delete(HONOR_TRANSITION_CACHE.keys().next().value);
  }
  const result = { distribution, collisions };
  HONOR_TRANSITION_CACHE.set(cacheKey, result);
  return result;
}

function calculateHonorCompletionPlan({
  targets,
  method = "honor",
  initialMask = 0,
  swapLower = true,
  halfHonor = false,
  exactGrades = false,
  honorPricePer5000,
}) {
  const goalMask = targets.reduce(
    (mask, target, line) => target.type ? mask | (1 << line) : mask,
    0,
  );
  const actualHonor = Array(8).fill(Infinity);
  const expectedScore = Array(8).fill(Infinity);
  const expectedResets = Array(8).fill(Infinity);
  const expectedMeso = Array(8).fill(Infinity);
  const decisionsByMask = Array.from({ length: 8 }, () => new Map());
  actualHonor[goalMask] = 0;
  expectedScore[goalMask] = 0;
  expectedResets[goalMask] = 0;
  expectedMeso[goalMask] = 0;

  for (let completed = popcount(goalMask) - 1; completed >= 0; completed -= 1) {
    for (let mask = 0; mask < 8; mask += 1) {
      if ((mask & ~goalMask) || popcount(mask) !== completed) continue;
      const { distribution, collisions } = honorTransitionDistribution(targets, mask, swapLower, method, exactGrades);
      const progressEvents = [];
      for (let outcomeMask = 0; outcomeMask < distribution.length; outcomeMask += 1) {
        const probability = distribution[outcomeMask];
        if (probability <= 0 || outcomeMask === mask) continue;
        const newBits = outcomeMask & ~mask;
        let bestMask = -1;
        for (let kept = newBits; kept > 0; kept = (kept - 1) & newBits) {
          const candidateMask = mask | kept;
          if (!Number.isFinite(expectedScore[candidateMask])) continue;
          if (
            bestMask < 0 ||
            expectedScore[candidateMask] < expectedScore[bestMask] ||
            (
              expectedScore[candidateMask] === expectedScore[bestMask] &&
              expectedResets[candidateMask] < expectedResets[bestMask]
            )
          ) {
            bestMask = candidateMask;
          }
        }
        if (bestMask >= 0) {
          progressEvents.push({
            outcomeMask,
            probability,
            bestMask,
            futureHonor: expectedScore[bestMask],
          });
        }
      }
      progressEvents.sort((left, right) => left.futureHonor - right.futureHonor);

      // 결과에 목표 줄이 여러 개 포함되어도 모두 잠그는 것이 항상 최선은
      // 아니다. 잠금 비용이 크게 뛰는 경우에는 흔한 줄을 버리고 희귀한 줄만
      // 유지할 수 있으므로, 진행 상태를 채택할 경계까지 함께 최적화한다.
      const resetHonor = getAbilityResetHonorCost(method, popcount(mask), halfHonor);
      const resetCost = honorPricePer5000 === undefined ? resetHonor
        : resetHonor * honorPricePer5000 / 5000 + abilityResetMesoCost(method, popcount(mask));
      const resetMeso = abilityResetMesoCost(method, popcount(mask));
      let acceptedProbability = 0;
      let acceptedFutureHonor = 0;
      let stateHonor = Infinity;
      let acceptedSelection = 0;
      let resetFactor = 1;
      for (let index = 0; method !== "advanced" && index < progressEvents.length; index += 1) {
        const event = progressEvents[index];
        acceptedProbability += event.probability;
        acceptedFutureHonor += event.probability * event.futureHonor;
        const candidate = (resetCost + acceptedFutureHonor) / acceptedProbability;
        const nextBoundary = progressEvents[index + 1]?.futureHonor ?? Infinity;
        if (candidate <= nextBoundary + 1e-9) {
          stateHonor = candidate;
          acceptedSelection = (1 << (index + 1)) - 1;
          break;
        }
      }
      if (method === "advanced") {
        // 동일 결과 제외 보정은 채택할 결과 집합에 따라 달라진다.
        // 목표가 세 줄이라 최대 127개 집합만 전부 비교하면 된다.
        const totalCollision = collisions.reduce((sum, value) => sum + value, 0);
        for (let selection = 1; selection < (1 << progressEvents.length); selection += 1) {
          let probability = 0;
          let futureHonor = 0;
          let failureCollision = totalCollision;
          progressEvents.forEach((event, index) => {
            if (!(selection & (1 << index))) return;
            probability += event.probability;
            futureHonor += event.probability * event.futureHonor;
            failureCollision -= collisions[event.outcomeMask];
          });
          const factor = probability < 1 ? 1 - Math.max(0, failureCollision) / (1 - probability) : 1;
          const candidate = (resetCost * factor + futureHonor) / probability;
          if (candidate < stateHonor) {
            stateHonor = candidate;
            acceptedSelection = selection;
            resetFactor = factor;
          }
        }
      }
      if (!Number.isFinite(stateHonor) || !acceptedSelection) continue;

      let futureActualHonor = 0;
      let futureResets = 0;
      let futureMeso = 0;
      let chosenProbability = 0;
      for (let index = 0; index < progressEvents.length; index += 1) {
        const event = progressEvents[index];
        const chosenMask = acceptedSelection & (1 << index) ? event.bestMask : mask;
        decisionsByMask[mask].set(event.outcomeMask, chosenMask);
        if (chosenMask === mask) continue;
        chosenProbability += event.probability;
        futureActualHonor += event.probability * actualHonor[chosenMask];
        futureResets += event.probability * expectedResets[chosenMask];
        futureMeso += event.probability * expectedMeso[chosenMask];
      }
      expectedScore[mask] = stateHonor;
      actualHonor[mask] = (resetHonor * resetFactor + futureActualHonor) / chosenProbability;
      expectedResets[mask] = (resetFactor + futureResets) / chosenProbability;
      expectedMeso[mask] = (resetMeso * resetFactor + futureMeso) / chosenProbability;
    }
  }

  return {
    expectedHonor: actualHonor[initialMask],
    expectedScore: expectedScore[initialMask],
    expectedResets: expectedResets[initialMask],
    expectedMeso: expectedMeso[initialMask],
    expectedHonorByMask: actualHonor,
    expectedScoreByMask: expectedScore,
    expectedResetsByMask: expectedResets,
    expectedMesoByMask: expectedMeso,
    decisionsByMask,
    goalMask,
  };
}

function refinementPlanTargets(targets) {
  const acquisitionTargets = targets.map((target) => ({ ...target }));
  const refinementTargets = targets.map((target) => ({
    type: "",
    minimum: 0,
    grade: target.grade,
    locked: false,
  }));

  targets.forEach((target, line) => {
    if (!target.type) return;
    const entry = OPTIONS_BY_ID.get(target.type);
    const possibleGrades = line === 0
      ? ["legendary"]
      : ["unique", "epic"].filter((grade) => (
        optionWeight(entry, grade, "honor") > 0 &&
        Math.max(...rawValues(entry, grade), -Infinity) >= target.minimum
      ));
    // 현재 등급을 하나로 확정할 수 있을 때만 수치 전용 서큘레이터로 넘긴다.
    if (possibleGrades.length !== 1) return;
    const [grade] = possibleGrades;
    const values = rawValues(entry, grade);
    if (!values.length) return;
    const acquisitionMinimum = Math.min(...values);
    if (acquisitionMinimum >= target.minimum) return;
    acquisitionTargets[line].minimum = acquisitionMinimum;
    acquisitionTargets[line].grade = grade;
    refinementTargets[line] = {
      ...target,
      grade,
      locked: false,
    };
  });

  return { acquisitionTargets, refinementTargets };
}

const STRATEGY_OPTION_NAMES = Object.freeze({
  "boss-damage": "보공", "abnormal-damage": "상추뎀", "passive-level": "패시브",
  "cooldown-skip": "재사용", critical: "크확", "buff-duration": "벞지",
  attack: "공격력", magic: "마력", "item-drop": "드롭률", "meso-drop": "메획",
  "attack-speed": "공속", "max-hp-percent": "최대 HP", "max-mp-percent": "최대 MP",
});

function strategyTargetName(target) {
  return STRATEGY_OPTION_NAMES[target.type] ?? OPTIONS_BY_ID.get(target.type)?.label ?? target.type;
}

function describeStrategyTarget(target, line, { swapLower = false, includeGrade = false } = {}) {
  const entry = OPTIONS_BY_ID.get(target.type);
  const slot = line === 0 ? "첫 줄" : swapLower ? "아랫줄" : line === 1 ? "둘째 줄" : "셋째 줄";
  const value = target.type === "passive-level" ? `+${target.minimum}`
    : `${target.minimum}${entry?.unit ?? ""} 이상`;
  return `${slot} ${strategyTargetName(target)} ${value}${includeGrade ? ` (${ABILITY_GRADES[target.grade].label})` : ""}`;
}

function normalizeInventory(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function limitedAttemptStats(probability, limit) {
  const count = normalizeInventory(limit);
  if (count <= 0 || !Number.isFinite(probability) || probability <= 0) {
    return { successProbability: 0, failureProbability: 1, expectedUses: 0 };
  }
  if (probability >= 1) {
    return { successProbability: 1, failureProbability: 0, expectedUses: 1 };
  }
  const failureProbability = (1 - probability) ** count;
  return {
    successProbability: 1 - failureProbability,
    failureProbability,
    // 성공하면 즉시 멈추므로 단순히 보유량 전부를 소비한다고 보지 않는다.
    expectedUses: (1 - failureProbability) / probability,
  };
}

function permutations(values) {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) => permutations([
    ...values.slice(0, index),
    ...values.slice(index + 1),
  ]).map((rest) => [value, ...rest]));
}

function emptyStrategyResult(message) {
  return {
    expectedHonor: Infinity,
    expectedHonorResets: Infinity,
    expectedCirculators: { miracle: 0, black: 0, chaos: 0 },
    steps: [],
    error: message,
  };
}

function strategyTargetSet(targets, lockedMask, candidateLine, candidateTarget) {
  return targets.map((target, line) => {
    if (lockedMask & (1 << line)) return { ...target, locked: true };
    if (line === candidateLine) return { ...candidateTarget, locked: false };
    return { type: "", minimum: 0, grade: target.grade, locked: false };
  });
}

const STRATEGY_EXPECTED_CACHE = new Map();

function strategyExpected(cache, {
  method = "honor",
  targets,
  swapLower = true,
  halfHonor = false,
}) {
  const targetKey = targets.map((target) => [
    target.type ?? "",
    Number(target.minimum) || 0,
    target.grade ?? "",
    target.locked ? 1 : 0,
  ].join(":"));
  const key = `${method}/${swapLower ? 1 : 0}/${halfHonor ? 1 : 0}/${targetKey.join("|")}`;
  if (cache?.has(key)) return cache.get(key);
  const result = calculateAbilityExpected({ method, targets, swapLower, halfHonor });
  if (cache) {
    if (cache.size >= 1024) cache.delete(cache.keys().next().value);
    cache.set(key, result);
  }
  return result;
}

function calculateOrderedAbilityPlan({
  targets,
  order,
  initialMask = 0,
  swapLower = true,
  halfHonor = false,
  blackCount = 0,
  chaosCount = 0,
  allowSingleLineRefinement = true,
  probabilityCache,
}) {
  const refinement = refinementPlanTargets(targets);
  const stages = [];
  let lockedMask = initialMask;

  for (const line of order) {
    const fullTargets = strategyTargetSet(
      targets,
      lockedMask,
      line,
      targets[line],
    );
    const full = strategyExpected(probabilityCache, {
      method: "honor",
      targets: fullTargets,
      swapLower,
      halfHonor,
    });
    if (full.error || !Number.isFinite(full.expectedResource)) return null;

    const canRefine = Boolean(refinement.refinementTargets[line]?.type);
    let acquisition = full;
    let valueProbability = 0;
    if (canRefine) {
      acquisition = strategyExpected(probabilityCache, {
        method: "honor",
        targets: strategyTargetSet(
          targets,
          lockedMask,
          line,
          refinement.acquisitionTargets[line],
        ),
        swapLower,
        halfHonor,
      });
      const valueTargets = targets.map((target, targetLine) => (
        targetLine === line
          ? refinement.refinementTargets[line]
          : { type: "", minimum: 0, grade: target.grade, locked: false }
      ));
      valueProbability = strategyExpected(probabilityCache, {
        method: "black",
        targets: valueTargets,
        swapLower: false,
      }).probability;
    }
    stages.push({
      line,
      full,
      acquisition,
      valueProbability,
      acquisitionTarget: refinement.acquisitionTargets[line],
      canRefine,
    });
    lockedMask |= 1 << line;
  }

  let expectedHonor = stages.reduce((sum, stage) => sum + stage.full.expectedResource, 0);
  let expectedHonorResets = stages.reduce((sum, stage) => sum + stage.full.expectedResets, 0);
  let expectedBlack = 0;
  let expectedChaos = 0;
  let refinedFirst = false;

  // 이미 완성된 목표가 없는 첫 단계에서만 수치 서큘레이터를 사용한다.
  // 이렇게 하면 뒤에서 블랙·카오스를 쓸 때 앞서 완성한 줄의 수치가 무너지는
  // 경우를 만들지 않으면서 honor → value-only → honor 경로를 정확히 비교할 수 있다.
  const first = stages[0];
  if (
    allowSingleLineRefinement && initialMask === 0 && first?.canRefine &&
    first.valueProbability > 0 && (blackCount > 0 || chaosCount > 0)
  ) {
    const probabilityFull = first.full.probability;
    const probabilityAcquire = first.acquisition.probability;
    const probabilityPartial = Math.max(0, probabilityAcquire - probabilityFull);
    const partialAfterAcquire = probabilityAcquire > 0
      ? probabilityPartial / probabilityAcquire
      : 0;
    const black = limitedAttemptStats(first.valueProbability, blackCount);
    const chaos = limitedAttemptStats(first.valueProbability, chaosCount);
    const refinementFailure = black.failureProbability * chaos.failureProbability;
    const expectedFirstHonor = (
      first.acquisition.resourcePerReset / probabilityAcquire +
      partialAfterAcquire * refinementFailure *
        first.full.resourcePerReset / probabilityFull
    );
    const expectedFirstResets = (
      1 / probabilityAcquire +
      partialAfterAcquire * refinementFailure / probabilityFull
    );
    if (expectedFirstHonor < first.full.expectedResource) {
      expectedHonor += expectedFirstHonor - first.full.expectedResource;
      expectedHonorResets += expectedFirstResets - first.full.expectedResets;
      expectedBlack = partialAfterAcquire * black.expectedUses;
      expectedChaos = (
        partialAfterAcquire * black.failureProbability * chaos.expectedUses
      );
      refinedFirst = true;
    }
  }

  const methodParts = [];
  if (blackCount > 0) methodParts.push(`블서큘 최대 ${blackCount.toLocaleString("ko-KR")}개`);
  if (chaosCount > 0) methodParts.push(`카서큘 최대 ${chaosCount.toLocaleString("ko-KR")}개`);
  const priority = [];
  const lockNotes = [];
  stages.forEach((stage, index) => {
    const target = describeStrategyTarget(targets[stage.line], stage.line, { swapLower });
    if (index === 0 && refinedFirst) {
      priority.push(
        `${describeStrategyTarget(stage.acquisitionTarget, stage.line, { swapLower, includeGrade: true })} 확보`,
        `${methodParts.join(" → ")}로 ${target} ${stages.length === 1 ? "맞추기" : "맞춘 뒤 잠금"}`,
      );
      lockNotes.push("", "목표 수치 미달일 때만 사용하세요. 소진 후에도 미달이면 명성치로 맞추세요.");
    } else {
      priority.push(`${target} ${index === stages.length - 1 ? "맞추기" : "잠금"}`);
      lockNotes.push("");
    }
  });

  return {
    expectedHonor,
    expectedHonorResets,
    expectedCirculators: {
      miracle: 0,
      black: expectedBlack,
      chaos: expectedChaos,
    },
    priority,
    lockNotes,
    order,
    refinedFirst,
  };
}

function bestOrderedAbilityPlan({ targets, initialMask = 0, ...options }) {
  const remaining = targets
    .map((target, line) => ({ target, line }))
    .filter(({ target, line }) => target.type && !(initialMask & (1 << line)))
    .map(({ line }) => line);
  const plans = permutations(remaining)
    .map((order) => calculateOrderedAbilityPlan({
      targets,
      order,
      initialMask,
      ...options,
    }))
    .filter(Boolean);
  plans.sort((left, right) => (
    left.expectedHonor - right.expectedHonor ||
    (left.expectedCirculators.black + left.expectedCirculators.chaos) -
      (right.expectedCirculators.black + right.expectedCirculators.chaos) ||
    left.expectedHonorResets - right.expectedHonorResets
  ));
  return plans[0] ?? null;
}

/**
 * 레전드리 어빌리티 목표를 만들 때 기대 명성치를 최소화하는 단계 전략을 찾는다.
 *
 * 미라클은 무한 반복으로 세 줄을 한꺼번에 노리는 퇴행적인 0 명성치 해법을 막기
 * 위해 한 줄의 선행 확보에만 사용한다. 블랙·카오스는 옵션 종류와
 * 등급을 명성치로 확보한 뒤 목표 수치를 맞추는 마무리 단계로 사용한다.
 */
function calculateAbilityOptimalStrategyLegacy({
  targets = [],
  swapLower = true,
  halfHonor = false,
  allowMiracle = true,
  allowBlack = true,
  allowChaos = true,
  miracleCount = 0,
  blackCount = 0,
  chaosCount = 0,
  honorPricePer5000,
} = {}) {
  const normalizedTargets = normalizeStrategyTargets(targets);
  const active = normalizedTargets
    .map((target, line) => ({ target, line }))
    .filter(({ target }) => target.type);
  if (!active.length) {
    return emptyStrategyResult("목표 옵션을 하나 이상 선택해주세요.");
  }
  if (active.length !== new Set(active.map(({ target }) => target.type)).size) {
    return emptyStrategyResult("어빌리티에는 같은 종류의 옵션이 중복해서 등장하지 않습니다.");
  }

  const inventory = {
    miracle: allowMiracle ? normalizeInventory(miracleCount) : 0,
    black: allowBlack ? normalizeInventory(blackCount) : 0,
    chaos: allowChaos ? normalizeInventory(chaosCount) : 0,
  };
  const valueMethods = ["black", "chaos"].filter((method) => inventory[method] > 0);
  const refinement = refinementPlanTargets(normalizedTargets);
  const configurations = [{
    acquisitionTargets: normalizedTargets,
    refinementTargets: normalizedTargets.map((target) => ({
      type: "",
      minimum: 0,
      grade: target.grade,
      locked: false,
    })),
    useRefinement: false,
  }];
  if (valueMethods.length && refinement.refinementTargets.some((target) => target.type)) {
    configurations.push({ ...refinement, useRefinement: true });
  }

  const miracleChoices = [{
    line: -1,
    expectedUses: 0,
    successProbability: 0,
    failureProbability: 1,
  }];
  if (inventory.miracle > 0) {
    for (const { target, line } of active) {
      const miracleTargets = normalizedTargets.map((entry) => ({
        type: "",
        minimum: 0,
        grade: entry.grade,
        locked: false,
      }));
      miracleTargets[line] = target;
      const result = calculateAbilityExpected({
        method: "miracle",
        targets: miracleTargets,
        swapLower,
      });
      if (!result.error && Number.isFinite(result.expectedResets)) {
        miracleChoices.push({
          line,
          ...limitedAttemptStats(result.probability, inventory.miracle),
        });
      }
    }
  }

  const baseline = calculateHonorCompletionPlan({
    targets: normalizedTargets,
    swapLower,
    halfHonor,
  });
  const candidates = [];
  for (const configuration of configurations) {
    const honorTable = configuration.useRefinement
      ? calculateHonorCompletionPlan({
        targets: configuration.acquisitionTargets,
        swapLower,
        halfHonor,
      })
      : baseline;
    for (const miracle of miracleChoices) {
      // Value-only circulators reroll all three values. A Miracle success cannot
      // be treated as a permanently locked value through this refinement phase.
      if (honorPricePer5000 !== undefined && configuration.useRefinement && miracle.line >= 0) continue;
      const expectedCirculators = {
        miracle: miracle.expectedUses,
        black: 0,
        chaos: 0,
      };
      let expectedHonor = 0;
      let expectedHonorResets = 0;
      let refinementSuccessProbability = 0;
      const branches = miracle.line >= 0
        ? [
          { probability: miracle.successProbability, initialMask: 1 << miracle.line },
          { probability: miracle.failureProbability, initialMask: 0 },
        ]
        : [{ probability: 1, initialMask: 0 }];

      for (const branch of branches) {
        if (branch.probability <= 0) continue;
        const acquisitionHonor = honorTable.expectedHonorByMask[branch.initialMask];
        const acquisitionResets = honorTable.expectedResetsByMask[branch.initialMask];
        if (!Number.isFinite(acquisitionHonor)) {
          expectedHonor = Infinity;
          break;
        }

        let finishFailure = 0;
        if (configuration.useRefinement) {
          const finishTargets = configuration.refinementTargets.map((target, line) => (
            branch.initialMask & (1 << line)
              ? { type: "", minimum: 0, grade: target.grade, locked: false }
              : target
          ));
          if (finishTargets.some((target) => target.type)) {
            const finish = calculateAbilityExpected({
              method: "black",
              targets: finishTargets,
              swapLower: false,
            });
            if (finish.error || !Number.isFinite(finish.probability)) {
              expectedHonor = Infinity;
              break;
            }
            let remainingProbability = 1;
            for (const method of valueMethods) {
              const stats = limitedAttemptStats(finish.probability, inventory[method]);
              expectedCirculators[method] += (
                branch.probability * remainingProbability * stats.expectedUses
              );
              remainingProbability *= stats.failureProbability;
            }
            finishFailure = remainingProbability;
            refinementSuccessProbability += branch.probability * (1 - finishFailure);
          } else {
            refinementSuccessProbability += branch.probability;
          }
        }

        // 보유 서큘레이터를 모두 써도 실패하면, 이미 미라클로 완성한 줄만
        // 유지한 채 목표 수치를 명성치로 마무리하는 보수적인 경로를 더한다.
        expectedHonor += branch.probability * (
          acquisitionHonor + finishFailure * baseline.expectedHonorByMask[branch.initialMask]
        );
        expectedHonorResets += branch.probability * (
          acquisitionResets + finishFailure * baseline.expectedResetsByMask[branch.initialMask]
        );
      }
      if (!Number.isFinite(expectedHonor)) continue;

      candidates.push({
        ...configuration,
        miracleLine: miracle.line,
        miracleSuccessProbability: miracle.line >= 0 ? miracle.successProbability : 0,
        refinementSuccessProbability,
        expectedHonor,
        expectedHonorResets,
        expectedCirculators,
        totalCirculators: Object.values(expectedCirculators).reduce(
          (sum, value) => sum + value,
          0,
        ),
      });
    }
  }

  candidates.sort((left, right) => (
    left.expectedHonor - right.expectedHonor ||
    left.totalCirculators - right.totalCirculators ||
    left.expectedHonorResets - right.expectedHonorResets
  ));
  const best = candidates[0];
  if (!best) {
    return emptyStrategyResult("선택한 목표를 완성할 수 있는 전략을 찾지 못했습니다.");
  }

  const steps = [];
  if (best.miracleLine >= 0) {
    steps.push({
      method: "miracle",
      title: "미서큘로 한 줄 먼저 확보",
      description: describeStrategyTarget(
        normalizedTargets[best.miracleLine],
        best.miracleLine,
        { swapLower },
      ),
      expectedResets: best.expectedCirculators.miracle,
      maximumUses: inventory.miracle,
      successProbability: best.miracleSuccessProbability,
    });
  }
  if (best.expectedHonorResets > 0) {
    const successMask = best.miracleLine >= 0 ? 1 << best.miracleLine : 0;
    const plan = calculateHonorCompletionPlan({ targets: best.acquisitionTargets, swapLower, halfHonor });
    const guideOptions = { targets: best.acquisitionTargets, plan, swapLower,
      includeGrades: best.useRefinement, acquiring: best.useRefinement };
    const guide = describeAbilityLockGuide({ ...guideOptions, initialMask: successMask });
    const fallback = best.miracleLine >= 0 && best.miracleSuccessProbability < 1
      ? describeAbilityLockGuide({ ...guideOptions, initialMask: 0 }) : null;
    steps.push({
      method: "honor",
      title: best.useRefinement ? "목표 종류·등급 확보" : "일반 재설정 진행 순서",
      ...guide,
      ...(best.useRefinement ? { description: "수치는 낮아도 됩니다. 목표 종류·등급부터 확보하세요." } : {}),
      fallbackPriority: fallback?.priority ?? [],
      fallbackLockNotes: fallback?.lockNotes ?? [],
      fallbackLockGuideMode: fallback?.lockGuideMode,
      expectedResets: best.expectedHonorResets,
      expectedHonor: best.expectedHonor,
    });
  }

  if (best.useRefinement) {
    for (const method of valueMethods) {
      if (best.expectedCirculators[method] <= 0) continue;
      steps.push({
        method,
        title: "목표 수치 맞추기",
        description: "확보한 옵션 종류와 등급을 유지한 채 목표 수치를 노립니다.",
        expectedResets: best.expectedCirculators[method],
        maximumUses: inventory[method],
      });
    }
  }

  return {
    expectedHonor: best.expectedHonor,
    expectedHonorResets: best.expectedHonorResets,
    expectedCirculators: best.expectedCirculators,
    baselineHonor: baseline.expectedHonor,
    honorSaved: Math.max(0, baseline.expectedHonor - best.expectedHonor),
    inventory,
    steps,
    error: null,
  };
}

/**
 * 보유 서큘레이터 안에서 목표 줄의 완성 순서와 재설정 방식의 전환 시점을 찾는다.
 * 목표가 최대 세 줄뿐이라는 점을 이용해 6개 이하의 순열만 비교하므로, 보유량이
 * 커져도 상태 공간이 늘어나지 않는다.
 */
function calculateAbilityOptimalStrategyOrdered({
  targets = [],
  swapLower = true,
  halfHonor = false,
  allowMiracle = true,
  allowBlack = true,
  allowChaos = true,
  miracleCount = 0,
  blackCount = 0,
  chaosCount = 0,
} = {}) {
  const normalizedTargets = normalizeStrategyTargets(targets);
  const active = normalizedTargets
    .map((target, line) => ({ target, line }))
    .filter(({ target }) => target.type);
  if (!active.length) {
    return emptyStrategyResult("목표 옵션을 하나 이상 선택해주세요.");
  }
  if (active.length !== new Set(active.map(({ target }) => target.type)).size) {
    return emptyStrategyResult("어빌리티에는 같은 종류의 옵션이 중복해서 등장하지 않습니다.");
  }

  const inventory = {
    miracle: allowMiracle ? normalizeInventory(miracleCount) : 0,
    black: allowBlack ? normalizeInventory(blackCount) : 0,
    chaos: allowChaos ? normalizeInventory(chaosCount) : 0,
  };
  // 한 번의 최적화 안에서는 여러 순서가 같은 확률 상태를 반복해서 방문한다.
  // 보유량은 유한시도 폐쇄식으로 처리하고, 목표/잠금 상태별 확률만 공유한다.
  const probabilityCache = STRATEGY_EXPECTED_CACHE;
  const common = {
    targets: normalizedTargets,
    swapLower,
    halfHonor,
    probabilityCache,
  };
  const baseline = bestOrderedAbilityPlan({
    ...common,
    blackCount: 0,
    chaosCount: 0,
    allowSingleLineRefinement: false,
  });
  const regular = bestOrderedAbilityPlan({
    ...common,
    blackCount: inventory.black,
    chaosCount: inventory.chaos,
    allowSingleLineRefinement: true,
  });
  if (!baseline || !regular) {
    return emptyStrategyResult("선택한 목표를 완성할 수 있는 전략을 찾지 못했습니다.");
  }

  const candidates = [{
    expectedHonor: regular.expectedHonor,
    expectedHonorResets: regular.expectedHonorResets,
    expectedCirculators: { ...regular.expectedCirculators },
    totalCirculators: regular.expectedCirculators.black + regular.expectedCirculators.chaos,
    miracleLine: -1,
    miracleSuccessProbability: 0,
    priority: regular.priority,
    lockNotes: regular.lockNotes,
    fallbackPriority: [],
    fallbackLockNotes: [],
  }];

  if (inventory.miracle > 0) {
    for (const { target, line } of active) {
      const miracleTargets = normalizedTargets.map((entry, targetLine) => (
        targetLine === line
          ? target
          : { type: "", minimum: 0, grade: entry.grade, locked: false }
      ));
      const miracleRoll = strategyExpected(probabilityCache, {
        method: "miracle",
        targets: miracleTargets,
        swapLower,
      });
      if (miracleRoll.error || miracleRoll.probability <= 0) continue;
      const miracle = limitedAttemptStats(miracleRoll.probability, inventory.miracle);
      const successPlan = bestOrderedAbilityPlan({
        ...common,
        initialMask: 1 << line,
        blackCount: inventory.black,
        chaosCount: inventory.chaos,
        // 미라클로 완성한 줄을 블랙·카오스가 다시 건드리지 않도록 한다.
        allowSingleLineRefinement: false,
      });
      if (!successPlan) continue;
      const expectedCirculators = {
        miracle: miracle.expectedUses,
        black: miracle.failureProbability * regular.expectedCirculators.black,
        chaos: miracle.failureProbability * regular.expectedCirculators.chaos,
      };
      candidates.push({
        expectedHonor: (
          miracle.successProbability * successPlan.expectedHonor +
          miracle.failureProbability * regular.expectedHonor
        ),
        expectedHonorResets: (
          miracle.successProbability * successPlan.expectedHonorResets +
          miracle.failureProbability * regular.expectedHonorResets
        ),
        expectedCirculators,
        totalCirculators: Object.values(expectedCirculators).reduce(
          (sum, value) => sum + value,
          0,
        ),
        miracleLine: line,
        miracleSuccessProbability: miracle.successProbability,
        priority: successPlan.priority,
        lockNotes: successPlan.lockNotes,
        fallbackPriority: regular.priority,
        fallbackLockNotes: regular.lockNotes,
      });
    }
  }

  candidates.sort((left, right) => (
    left.expectedHonor - right.expectedHonor ||
    left.totalCirculators - right.totalCirculators ||
    left.expectedHonorResets - right.expectedHonorResets
  ));
  const best = candidates[0];
  const steps = [];
  if (best.miracleLine >= 0) {
    steps.push({
      method: "miracle",
      title: "미서큘로 한 줄 먼저 확보",
      description: describeStrategyTarget(
        normalizedTargets[best.miracleLine],
        best.miracleLine,
        { swapLower },
      ),
      expectedResets: best.expectedCirculators.miracle,
      maximumUses: inventory.miracle,
      successProbability: best.miracleSuccessProbability,
    });
  }
  if (best.expectedHonorResets > 0) {
    steps.push({
      method: "honor",
      title: "일반 재설정 진행 순서",
      priority: best.priority,
      lockNotes: best.lockNotes,
      fallbackPriority: best.miracleLine >= 0 ? best.fallbackPriority : [],
      fallbackLockNotes: best.miracleLine >= 0 ? best.fallbackLockNotes : [],
      expectedResets: best.expectedHonorResets,
      expectedHonor: best.expectedHonor,
    });
  }

  return {
    expectedHonor: best.expectedHonor,
    expectedHonorResets: best.expectedHonorResets,
    expectedCirculators: best.expectedCirculators,
    baselineHonor: baseline.expectedHonor,
    honorSaved: Math.max(0, baseline.expectedHonor - best.expectedHonor),
    inventory,
    steps,
    error: null,
  };
}

function strategyCirculatorTotal(result) {
  return Object.values(result?.expectedCirculators ?? {}).reduce(
    (sum, value) => sum + (Number(value) || 0),
    0,
  );
}

/** Summarize the actual reachable policy; compress it only when every decision agrees. */
function describeAbilityLockGuide({ targets, plan, initialMask, swapLower, includeGrades = false,
  acquiring = false, completionText = "" }) {
  const goal = plan.goalMask;
  const describe = (mask, namesOnly = false) => targets.flatMap((target, line) => {
    if (!(mask & (1 << line))) return [];
    return [namesOnly ? strategyTargetName(target)
      : describeStrategyTarget(target, line, { swapLower, includeGrade: includeGrades })];
  });
  const visited = new Set();
  const pending = [initialMask];
  const lockRules = [];
  while (pending.length) {
    const lockedMask = pending.shift();
    if (lockedMask === goal || visited.has(lockedMask)) continue;
    visited.add(lockedMask);
    const outcomes = [...plan.decisionsByMask[lockedMask]].map(([completedMask, keepMask]) => ({
      completedMask, keepMask,
    }));
    lockRules.push({ lockedMask, outcomes });
    for (const { keepMask } of outcomes) {
      if (keepMask !== lockedMask) pending.push(keepMask);
    }
  }
  lockRules.sort((a, b) => popcount(a.lockedMask) - popcount(b.lockedMask) || a.lockedMask - b.lockedMask);

  // A prerequisite is another goal always kept whenever this goal is newly kept.
  // Validate their fixed point against all outcomes, including simultaneous results.
  const prerequisites = targets.map((_, line) => goal & ~(1 << line));
  for (const { lockedMask, outcomes } of lockRules) {
    for (const { keepMask } of outcomes) {
      for (let line = 0; line < targets.length; line += 1) {
        if ((keepMask & ~lockedMask) & (1 << line)) prerequisites[line] &= keepMask;
      }
    }
  }
  const matches = lockRules.every(({ lockedMask, outcomes }) => outcomes.every(({ completedMask, keepMask }) => {
    let predicted = completedMask;
    for (let pass = 0; pass < targets.length; pass += 1) {
      for (let line = 0; line < targets.length; line += 1) {
        const bit = 1 << line;
        if ((predicted & ~lockedMask & bit) && (prerequisites[line] & ~predicted)) predicted &= ~bit;
      }
    }
    return predicted === keepMask;
  }));
  const layers = [];
  let accounted = initialMask;
  while (matches && accounted !== goal) {
    let ready = 0;
    for (let line = 0; line < targets.length; line += 1) {
      const bit = 1 << line;
      if ((goal & ~accounted & bit) && !(prerequisites[line] & ~accounted)) ready |= bit;
    }
    if (!ready) break;
    layers.push(ready);
    accounted |= ready;
  }
  // A single ordered list must not impose extra precedence between independent goals.
  let preceding = initialMask;
  const orderedLayers = layers.every((layer) => {
    const valid = targets.every((_, line) => !(layer & (1 << line))
      || (prerequisites[line] & ~initialMask) === (preceding & ~initialMask));
    preceding |= layer;
    return valid;
  });
  if (matches && accounted === goal && orderedLayers) {
    const priority = [];
    const lockNotes = [];
    let prior = initialMask;
    for (const layer of layers) {
      const count = popcount(layer);
      const deferred = goal & ~(prior | layer);
      const lowerOnly = swapLower && !(layer & 1);
      for (let index = 0; index < count; index += 1) {
        const last = !acquiring && !deferred && index === count - 1;
        const action = last ? "맞추기" : "잠금";
        if (count === 1) priority.push(`${describe(layer)[0]} ${action}`);
        else if (index === 0) priority.push(`${describe(layer).join(" 또는 ")} 중 먼저 나온 옵션 잠금`);
        else priority.push(index === count - 1
          ? `남은${lowerOnly ? " 아랫줄" : ""} 목표 ${action}`
          : "남은 목표 중 먼저 나온 옵션 잠금");
        lockNotes.push(index === 0 && deferred
          ? count === 1
            ? `${describe(layer, true)[0]} 목표를 맞추기 전에는 ${describe(deferred, true).join("·")} 옵션을 잠그지 마세요.`
            : `이 ${count === 2 ? "두" : "세"} 목표를 맞추기 전에는 ${describe(deferred, true).join("·")} 옵션을 잠그지 마세요.`
          : "");
      }
      prior |= layer;
    }
    return {
      lockGuideMode: "sequence",
      description: initialMask ? `${describe(initialMask).join(" + ")} 잠금 유지` : "",
      priority, lockNotes, after: completionText, lockRules,
    };
  }

  // A policy with alternative prerequisites cannot be represented by one sequence.
  // Keep its conditions explicit, but avoid repeating the same goal in both clauses.
  const priority = lockRules.flatMap(({ lockedMask, outcomes }) => {
    const remaining = goal & ~lockedMask;
    const prefix = lockedMask ? `${describe(lockedMask, true).join(" + ")} 잠금 후` : "잠금 없이";
    if (popcount(remaining) === 1) return [`${prefix}: ${describe(remaining)[0]} 맞추기`];
    return outcomes.filter(({ completedMask }) => completedMask !== goal).map(({ completedMask, keepMask }) => {
      const appeared = describe(completedMask & ~lockedMask).join(" + ");
      const kept = keepMask & ~lockedMask;
      const action = !kept ? "잠금 보류" : kept === (completedMask & ~lockedMask)
        ? "잠금" : `${describe(kept, true).join(" + ")}만 잠금`;
      return `${prefix}: ${appeared} → ${action}`;
    });
  });
  return {
    lockGuideMode: "conditions",
    description: "현재 잠금 상태와 나온 옵션에 따라 선택하세요.",
    priority, after: completionText, lockRules,
  };
}

/**
 * 고급 재설정의 자동 잠금 경로와, 일반 재설정/보유 서큘레이터로 한 줄을
 * 먼저 완성한 뒤 고급 재설정으로 넘어가는 경로를 비교한다.
 * 선행 단계는 일반 재설정에서 얻을 수 있는 등급만 허용하므로 아랫줄
 * 레전드리를 얻은 뒤 블랙·카오스를 사용하는 불가능한 전략이 생기지 않는다.
 * 현재 옵션을 입력받지 않으므로 동일 결과 제외는 직접 계산과 동일하게
 * 미달 결과의 공식 분포로 평균한다. 가격 입력 시 명성치 환산액과 메소를 합산한다.
 */
function abilityStrategyScore(options, result) {
  return options.honorPricePer5000 === undefined ? result.expectedHonor
    : result.expectedHonor * options.honorPricePer5000 / 5000 + (result.expectedMeso ?? 0)
      + (result.expectedCirculators?.abyss ?? 0) * (options.abyssPrice ?? 0);
}
function abilityVectorScore(options, vector) {
  return options.honorPricePer5000 === undefined ? vector[0]
    : vector[0] * options.honorPricePer5000 / 5000 + vector[1] + vector[7] * (options.abyssPrice ?? 0);
}
function calculateAbilityAdvancedOptimalStrategy(options) {
  const targets = normalizeStrategyTargets(options.targets ?? [], "advanced");
  const active = targets.map((target, line) => ({ target, line })).filter(({ target }) => target.type);
  if (!active.length) return emptyStrategyResult("목표 옵션을 하나 이상 선택해주세요.");
  if (active.length !== new Set(active.map(({ target }) => target.type)).size) {
    return emptyStrategyResult("어빌리티에는 같은 종류의 옵션이 중복해서 등장하지 않습니다.");
  }
  const swapLower = options.swapLower !== false;
  const inventory = Object.fromEntries(["miracle", "black", "chaos"].map((method) => [
    method,
    options[`allow${method[0].toUpperCase()}${method.slice(1)}`] !== false
      ? normalizeInventory(options[`${method}Count`]) : 0,
  ]));
  const completion = calculateHonorCompletionPlan({ targets, method: "advanced", swapLower, halfHonor: options.halfHonor, honorPricePer5000: options.honorPricePer5000 });
  if (!Number.isFinite(completion.expectedHonor)) {
    return emptyStrategyResult("선택한 목표를 완성할 수 있는 전략을 찾지 못했습니다.");
  }
  const candidates = [{
    expectedHonor: completion.expectedHonor,
    expectedMeso: completion.expectedMeso,
    expectedHonorResets: completion.expectedResets,
    expectedAdvancedResets: completion.expectedResets,
    expectedNormalResets: 0,
    expectedCirculators: { miracle: 0, black: 0, chaos: 0 },
    initialMask: 0,
    seed: null,
  }];
  if (!targets.slice(1).some((target) => target.type && target.grade === "legendary")) {
    const ordinary = calculateAbilityOptimalStrategy({ ...options, useAdvanced: false, targets });
    if (!ordinary.error) candidates.push({
      ...ordinary,
      expectedMeso: 0,
      expectedAdvancedResets: 0,
      expectedNormalResets: ordinary.expectedHonorResets,
      initialMask: completion.goalMask,
      seed: ordinary,
    });
  }
  for (const { target, line } of active) {
    if (line > 0 && target.grade === "legendary") continue;
    const seedTargets = targets.map((entry, index) => index === line ? entry : {
      type: "", minimum: 0, grade: index === 0 ? "legendary" : "unique", locked: false,
    });
    const seed = calculateAbilityOptimalStrategy({ ...options, useAdvanced: false, targets: seedTargets });
    if (seed.error || !Number.isFinite(seed.expectedHonor)) continue;
    const initialMask = 1 << line;
    const advancedResets = completion.expectedResetsByMask[initialMask];
    candidates.push({
      expectedHonor: seed.expectedHonor + completion.expectedHonorByMask[initialMask],
      expectedMeso: completion.expectedMesoByMask[initialMask],
      expectedHonorResets: seed.expectedHonorResets + advancedResets,
      expectedAdvancedResets: advancedResets,
      expectedNormalResets: seed.expectedHonorResets,
      expectedCirculators: seed.expectedCirculators,
      initialMask,
      seed,
    });
  }
  candidates.sort((left, right) => (
    abilityStrategyScore(options, left) - abilityStrategyScore(options, right) || left.expectedMeso - right.expectedMeso ||
    strategyCirculatorTotal(left) - strategyCirculatorTotal(right)
  ));
  const best = candidates[0];
  const steps = best.seed ? best.seed.steps.map((step) => ({ ...step })) : [];
  if (best.seed && best.expectedAdvancedResets > 0) {
    const line = Math.log2(best.initialMask);
    const target = describeStrategyTarget(targets[line], line, { swapLower });
    if (steps.length) steps.at(-1).after = `${target} 완성 후 잠그고 고급 재설정으로 전환합니다.`;
  }
  if (best.expectedAdvancedResets > 0) {
    steps.push({
      method: "advanced",
      title: "고급 재설정 진행 순서",
      ...describeAbilityLockGuide({ targets, plan: completion, initialMask: best.initialMask, swapLower }),
      expectedResets: best.expectedAdvancedResets,
      expectedMeso: best.expectedMeso,
    });
  }
  return {
    expectedHonor: best.expectedHonor,
    expectedMeso: best.expectedMeso,
    expectedHonorResets: best.expectedHonorResets,
    expectedAdvancedResets: best.expectedAdvancedResets,
    expectedNormalResets: best.expectedNormalResets,
    expectedCirculators: best.expectedCirculators,
    baselineHonor: completion.expectedHonor,
    honorSaved: Math.max(0, completion.expectedHonor - best.expectedHonor),
    inventory,
    steps,
    resetMethod: "advanced",
    strategyMode: "advanced-adaptive",
    error: null,
  };
}

// A circulator replaces the whole three-line result. It cannot lock individual
// values. Retain/apply decisions therefore compare complete value tuples.
const ABYSS_METRICS = ["expectedHonor", "expectedMeso", "expectedNormalResets", "expectedAdvancedResets"];
function abyssMetricVector(result, method) {
  return [...ABYSS_METRICS.map((key) => result[key] ?? (key === "expectedNormalResets" && method === "honor"
    ? result.expectedHonorResets : 0)), ...["miracle", "black", "chaos"].map((id) => result.expectedCirculators?.[id] ?? 0), 0, 0];
}
function abyssPlanVector(plan, mask, method) {
  return [plan.expectedHonorByMask[mask], plan.expectedMesoByMask[mask],
    method === "honor" ? plan.expectedResetsByMask[mask] : 0,
    method === "advanced" ? plan.expectedResetsByMask[mask] : 0, 0, 0, 0, 0, 0];
}
function abyssResultMetrics(vector) {
  return { ...Object.fromEntries(ABYSS_METRICS.map((key, i) => [key, vector[i]])),
    expectedHonorResets: vector[2] + vector[3],
    expectedCirculators: { miracle: vector[4], black: vector[5], chaos: vector[6], abyss: vector[7] } };
}
function abilityValueDistribution(type, grade) {
  const entry = OPTIONS_BY_ID.get(type);
  const values = entry.valueGroup ? rawValues(entry, grade)
    : grade === "legendary" ? [16, 14, 14, 12, 12, 10] : [];
  const grouped = new Map();
  values.forEach((value, i) => grouped.set(value, (grouped.get(value) ?? 0) + VALUE_CHANCES[i]));
  return [...grouped];
}

const ABYSS_OTHER_VALUES_CACHE = new Map();
// Distribution of the two other values' probability masses, conditional on
// acquiring one exact type/grade. Needed to exclude the *whole* old result.
function abyssOtherValueProducts(target, line, method, swapLower) {
  const key = `${target.type}/${target.grade}/${line}/${method}/${swapLower}`;
  if (ABYSS_OTHER_VALUES_CACHE.has(key)) return ABYSS_OTHER_VALUES_CACHE.get(key);
  const spectra = new Map();
  const choices = [0, 1, 2].map((position) => lineGradeDistribution(position, method).map(([grade, gp]) => ({
    grade, gp, entries: ABILITY_OPTIONS.map((entry) => ({ entry, weight: optionWeight(entry, grade, method) }))
      .filter(({ weight }) => weight > 0),
  })));
  for (const grade of ["legendary", "unique", "epic"]) for (const entry of ABILITY_OPTIONS) {
    const spectrum = new Map();
    for (const [, probability] of abilityValueDistribution(entry.id, grade)) {
      const mass = probability.toFixed(10);
      spectrum.set(mass, (spectrum.get(mass) ?? 0) + probability);
    }
    spectra.set(`${entry.id}/${grade}`, [...spectrum].map(([p, w]) => [Number(p), w]));
  }
  const products = new Map();
  const used = new Set();
  const other = [null, null, null];
  let totalMass = 0;
  for (const targetPosition of line === 0 ? [0] : swapLower ? [1, 2] : [line]) {
    function visit(position, probability) {
      if (position === 3) {
        totalMass += probability;
        const remaining = other.filter(Boolean);
        for (const [a, wa] of remaining[0]) for (const [b, wb] of remaining[1]) {
          const product = (a * b).toFixed(12);
          products.set(product, (products.get(product) ?? 0) + probability * wa * wb);
        }
        return;
      }
      for (const { grade, gp, entries } of choices[position]) {
        const available = entries.filter(({ entry }) => !used.has(entry.id));
        const total = available.reduce((sum, { weight }) => sum + weight, 0);
        for (const { entry, weight } of available) {
          if (position === targetPosition ? entry.id !== target.type || grade !== target.grade : entry.id === target.type) continue;
          other[position] = position === targetPosition ? null : spectra.get(`${entry.id}/${grade}`);
          used.add(entry.id);
          visit(position + 1, probability * gp * weight / total);
          used.delete(entry.id);
        }
      }
    }
    visit(0, 1);
  }
  const result = [...products].map(([p, weight]) => [Number(p), weight / totalMass]);
  if (ABYSS_OTHER_VALUES_CACHE.size > 128) ABYSS_OTHER_VALUES_CACHE.clear();
  ABYSS_OTHER_VALUES_CACHE.set(key, result);
  return result;
}

function abyssSingleLineStats(target, line, method, swapLower, count) {
  const values = abilityValueDistribution(target.type, target.grade);
  const success = values.reduce((sum, [value, p]) => sum + (value >= target.minimum ? p : 0), 0);
  if (!(success > 0 && success < 1 - 1e-12)) return null;
  let failure = 0;
  let uses = 0;
  for (const [otherProduct, weight] of abyssOtherValueProducts(target, line, method, swapLower)) {
    for (const [value, p] of values) {
      if (value >= target.minimum) continue;
      const stats = limitedAttemptStats(Math.min(1, success / (1 - p * otherProduct)), count);
      failure += weight * p * stats.failureProbability;
      uses += weight * p * stats.expectedUses;
    }
  }
  return { failure, uses };
}

function abyssValueStates(targets) {
  const states = [];
  function visit(line, probability, mask, values) {
    if (line === 3) { states.push({ probability, mask, values }); return; }
    for (const [value, p] of abilityValueDistribution(targets[line].type, targets[line].grade)) {
      visit(line + 1, probability * p, mask | (value >= targets[line].minimum ? 1 << line : 0), [...values, value]);
    }
  }
  visit(0, 1, 0, []);
  return states;
}

function abyssFinitePolicy(states, terminal, count, { stopMask = 7, returnStates = false, score = (v) => v[0] } = {}) {
  let values = states.map((state) => [...terminal[state.mask]]);
  const policyBands = [];
  let previousRanks = null;
  const fullChance = states.reduce((sum, state) => sum + ((state.mask & stopMask) === stopMask ? state.probability : 0), 0);
  // Full completion has probability >= fullChance on each roll. This bounds the
  // omitted tail in EVERY metric by 1e-7 even for arbitrarily large stock inputs.
  const bound = Math.max(1 / fullChance, ...terminal.flat());
  const limit = Math.min(count, Math.ceil(Math.log(1e-7 / bound) / Math.log1p(-fullChance)));
  for (let remaining = 0; remaining <= limit; remaining += 1) {
    const order = states.map((_, i) => i).sort((a, b) => score(values[a]) - score(values[b]) || a - b);
    const ranks = Array(states.length);
    let rank = 0;
    order.forEach((i, position) => {
      if (position && score(values[i]) !== score(values[order[position - 1]])) rank += 1;
      ranks[i] = rank;
    });
    if (!previousRanks || ranks.some((value, i) => value !== previousRanks[i])) {
      policyBands.push({ remaining, ranks });
      previousRanks = ranks;
    }
    if (remaining === limit) break;
    const next = [];
    const prefix = Array(9).fill(0);
    let mass = 0;
    let position = 0;
    // Sorted prefix sums replace an O(states²) old/new comparison. Equal honor
    // keeps the old result. The denominator excludes only the identical tuple.
    while (position < order.length) {
      let end = position + 1;
      while (end < order.length && ranks[order[end]] === ranks[order[position]]) end += 1;
      for (let k = position; k < end; k += 1) {
        const i = order[k];
        const state = states[i];
        if ((state.mask & stopMask) === stopMask) { next[i] = [...terminal[state.mask]]; continue; }
        const rejectMass = Math.max(0, 1 - mass - state.probability);
        next[i] = prefix.map((sum, metric) => (sum + rejectMass * values[i][metric]) / (1 - state.probability));
        next[i][7] += 1;
      }
      for (let k = position; k < end; k += 1) {
        const i = order[k];
        mass += states[i].probability;
        values[i].forEach((value, metric) => { prefix[metric] += states[i].probability * value; });
      }
      position = end;
    }
    values = next;
  }
  const average = Array(9).fill(0);
  states.forEach((state, i) => values[i].forEach((value, metric) => { average[metric] += state.probability * value; }));
  return { average, policyBands, computedUses: limit, ...(returnStates ? { stateValues: values } : {}) };
}

/** The remaining count is AFTER the roll whose old/new results are compared. */
export function chooseAbilityAbyssResult(guide, oldValues, newValues, remainingCount) {
  if (![oldValues, newValues].every((values) => Array.isArray(values) && values.length === 3 && values.every((value) => value !== null && value !== "" && Number.isFinite(Number(value))))) return null;
  const indexOf = (values) => guide.states.findIndex((state) => state.values.every((value, i) => value === Number(values[i])));
  const oldIndex = indexOf(oldValues);
  const newIndex = indexOf(newValues);
  if (oldIndex < 0 || newIndex < 0) return null;
  const remaining = guide.unlimited ? 0 : Math.min(guide.maximumUses - 1, normalizeInventory(remainingCount));
  const apply = abilityResultApplies(guide, oldIndex, newIndex, remaining);
  const selected = guide.states[apply ? newIndex : oldIndex];
  return { apply, completedMask: selected.mask, keepMask: guide.keepMasks[selected.mask] };
}

function withAbyssCompletionStrategy(options, current) {
  const count = options.allowAbyss === false ? 0 : normalizeInventory(options.abyssCount);
  if (!count) return current;
  const baseline = { ...current, inventory: { ...current.inventory, abyss: count },
    expectedCirculators: { ...current.expectedCirculators, abyss: 0 } };
  if (current.error) return baseline;
  const method = options.useAdvanced ? "advanced" : "honor";
  const targets = normalizeStrategyTargets(options.targets ?? [], method);
  const swapLower = options.swapLower !== false;
  const plan = calculateHonorCompletionPlan({ targets, method, swapLower, halfHonor: options.halfHonor, honorPricePer5000: options.honorPricePer5000 });
  const baseVector = abyssMetricVector(current, method);
  const candidates = [];
  const comparisons = [];
  const guideFor = (mask) => describeAbilityLockGuide({ targets, plan, initialMask: mask, swapLower });
  const methodName = method === "advanced" ? "고급 재설정" : "명성치";
  const scaleSteps = (steps, factor) => steps.map((step) => ({ ...step,
    expectedResets: factor * step.expectedResets,
    ...(Number.isFinite(step.expectedMeso) ? { expectedMeso: factor * step.expectedMeso } : {}),
  }));
  function addCandidate(mode, vector, steps, extra = {}) {
    const metrics = abyssResultMetrics(vector);
    comparisons.push({ strategyMode: mode, ...metrics, ...extra });
    candidates.push({ ...baseline, ...metrics, strategyMode: mode, steps,
      honorSaved: Math.max(0, current.baselineHonor - metrics.expectedHonor), ...extra });
  }

  // This candidate commits to one seed: incidental completion of the other
  // goals and reallocation of leftover Abyss stock are not assumed. Its failure
  // branch still has all non-Abyss inventory; the success branch uses honor.
  for (const [line, target] of targets.entries()) {
    if (!target.type) continue;
    for (const acquisitionMethod of method === "advanced" && !(line > 0 && target.grade === "legendary")
      ? ["honor", "advanced"] : [method]) {
      const stats = abyssSingleLineStats(target, line, acquisitionMethod, swapLower, count);
      if (!stats) continue;
      const acquired = targets.map((entry, i) => i === line
        ? { ...entry, minimum: Math.min(...rawValues(OPTIONS_BY_ID.get(entry.type), entry.grade)) }
        : { ...entry, type: "", minimum: 0 });
      const acquisition = calculateHonorCompletionPlan({ targets: acquired, method: acquisitionMethod,
        exactGrades: true, swapLower, halfHonor: options.halfHonor, honorPricePer5000: options.honorPricePer5000 });
      if (!Number.isFinite(acquisition.expectedHonor)) continue;
      const after = abyssPlanVector(plan, 1 << line, method);
      const vector = abyssPlanVector(acquisition, 0, acquisitionMethod).map((value, i) => (
        value + (1 - stats.failure) * after[i] + stats.failure * baseVector[i]
      ));
      vector[7] = stats.uses;
      const description = describeStrategyTarget(target, line, { swapLower });
      const continuation = guideFor(1 << line);
      const branches = [{ label: `${strategyTargetName(target)} 목표 수치 달성`,
        description: `${description} 잠금`,
        steps: [{ method, title: `${methodName} 진행 순서`, ...continuation }] },
      { label: `${strategyTargetName(target)} 목표 수치 미달`, steps: current.steps }];
      addCandidate("abyss-single-line", vector, [
        { method: acquisitionMethod, title: "한 줄의 종류·등급 먼저 확보",
          priority: [describeStrategyTarget(acquired[line], line, { swapLower, includeGrade: true }) + " 확보"],
          expectedResets: acquisition.expectedResets, expectedMeso: acquisition.expectedMeso },
        { method: "abyss", title: `${strategyTargetName(target)} 목표 수치 맞추기`,
          description: `${description}을 만족한 결과를 적용하세요. 미달이면 기존 결과를 유지하세요.`,
          maximumUses: count, expectedResets: stats.uses, successProbability: 1 - stats.failure,
          successLabel: "이 한 줄을 보유량 안에서 완성할 확률",
          after: `${description} 완성 후 잠그고 ${methodName}로 나머지 목표를 맞추세요.` },
        { method, title: "심서큘 사용 후 나머지 목표 맞추기", branches,
          expectedResets: vector[2] + vector[3] - acquisition.expectedResets,
          expectedMeso: vector[1] - acquisition.expectedMeso },
      ], { abyssSeedLine: line, abyssAcquisitionMethod: acquisitionMethod });
    }
  }

  if (targets.every((target) => target.type)) {
    const states = abyssValueStates(targets);
    const fullChance = states.reduce((sum, state) => sum + (state.mask === 7 ? state.probability : 0), 0);
    if (fullChance > 0 && fullChance < 1 - 1e-12) {
      const acquired = targets.map((target) => ({ ...target,
        minimum: Math.min(...rawValues(OPTIONS_BY_ID.get(target.type), target.grade)) }));
      const acquisition = calculateHonorCompletionPlan({ targets: acquired, method, exactGrades: true,
        swapLower, halfHonor: options.halfHonor, honorPricePer5000: options.honorPricePer5000 });
      if (Number.isFinite(acquisition.expectedHonor)) {
        const keepMasks = [];
        const terminal = Array.from({ length: 8 }, (_, mask) => {
          let best = [...baseVector];
          let keepMask = 0;
          for (let keep = mask; keep; keep = (keep - 1) & mask) {
            const candidate = abyssPlanVector(plan, keep, method);
            if (abilityVectorScore(options, candidate) < abilityVectorScore(options, best)) { best = candidate; keepMask = keep; }
          }
          keepMasks.push(keepMask);
          best[8] = mask === 7 ? 0 : 1;
          return best;
        });
        const policy = abyssFinitePolicy(states, terminal, count, { score: (v) => abilityVectorScore(options, v) });
        const vector = abyssPlanVector(acquisition, 0, method).map((value, i) => value + policy.average[i]);
        const maskLabel = (mask) => targets.filter((_, i) => mask & (1 << i)).map(strategyTargetName).join("·");
        const branches = Array.from({ length: 7 }, (_, mask) => {
          const keep = keepMasks[mask];
          return { completedMask: mask, keepMask: keep,
            label: mask ? `${maskLabel(mask)} 목표 수치 달성` : "목표 수치에 도달한 줄 없음",
            description: keep ? `${maskLabel(keep)} 잠금 후 진행하세요.` : "잠금 없이 아래 순서로 진행하세요.",
            steps: keep ? [{ method, title: `${methodName} 진행 순서`, ...guideFor(keep) }] : current.steps };
        });
        addCandidate("abyss-completion", vector, [
          { method, title: "세 줄의 종류·등급 먼저 확보",
            ...describeAbilityLockGuide({ targets: acquired, plan: acquisition, initialMask: 0, swapLower,
              includeGrades: true, acquiring: true,
              completionText: "세 줄의 종류·등급이 모두 확보되면 심서큘로 목표 수치를 맞춥니다." }),
            description: "수치는 낮아도 됩니다. 세 줄의 목표 종류·등급부터 확보하세요.",
            expectedResets: acquisition.expectedResets, expectedMeso: acquisition.expectedMeso },
          { method: "abyss", title: "심서큘로 목표 수치 맞추기",
            description: "일부만 완성된 결과도 다음 진행에 유리하면 적용하세요. 아래 도우미로 기존 결과와 새 결과를 비교할 수 있습니다.",
            maximumUses: count, expectedResets: vector[7], successProbability: 1 - policy.average[8],
            successLabel: "세 줄을 보유량 안에서 완성할 확률",
            abyssGuide: { targets, states, policyBands: policy.policyBands, keepMasks, maximumUses: count,
              labels: targets.map((target, line) => describeStrategyTarget(target, line, { swapLower, includeGrade: true })),
              computedUses: policy.computedUses },
            after: "심서큘은 세 줄의 수치가 함께 바뀝니다. 기존 결과와 새 결과 중 하나를 선택하세요." },
          { method, title: "심서큘 소진 후 남은 목표 맞추기", branches,
            description: "목표 수치에 도달한 옵션을 선택하면 잠글 줄과 이후 순서를 확인할 수 있습니다.",
            expectedResets: policy.average[2] + policy.average[3], expectedMeso: policy.average[1] },
        ]);
      }
    }
  }
  candidates.sort((a, b) => abilityStrategyScore(options, a) - abilityStrategyScore(options, b) || a.expectedMeso - b.expectedMeso || strategyCirculatorTotal(a) - strategyCirculatorTotal(b));
  const best = candidates[0];
  return { ...(best && abilityStrategyScore(options, best) < abilityStrategyScore(options, current) - Math.max(1, abilityStrategyScore(options, current) * 1e-9) ? best : baseline),
    abyssComparison: comparisons };
}

function recommendAbilityTargetPlacement(options, current) {
  if (current.error || (Array.isArray(options.targets) && options.targets.some((target) => target?.locked))) return current;
  const targets = normalizeStrategyTargets(options.targets ?? [], "advanced");
  // 입력한 옵션·등급·목표 수치를 바꾸지 않고 세 줄의 자리만 비교한다.
  // 첫 줄로 올릴 수 있는 것은 이미 레전드리 목표인 옵션뿐이다.
  if (targets.some((target) => !target.type)) return current;
  const orders = permutations([0, 1, 2]).sort((left, right) => (
    left.filter((line, index) => line !== index).length -
    right.filter((line, index) => line !== index).length
  ));
  const targetKey = (target) => `${target.type}:${target.grade}:${target.minimum}`;
  const placementKey = (entries) => {
    const lower = entries.slice(1).map(targetKey);
    if (options.swapLower !== false) lower.sort();
    return [targetKey(entries[0]), ...lower].join("|");
  };
  const seen = new Set([placementKey(targets)]);
  let best = current;
  let recommendedTargets = null;
  for (const order of orders) {
    const candidateTargets = order.map((line) => ({ ...targets[line] }));
    if (candidateTargets[0].grade !== "legendary") continue;
    const key = placementKey(candidateTargets);
    if (seen.has(key)) continue;
    seen.add(key);
    const candidateOptions = { ...options, targets: candidateTargets };
    const candidate = withAbyssCompletionStrategy(candidateOptions,
      calculateAbilityAdvancedOptimalStrategy({ ...candidateOptions, allowAbyss: false }));
    if (candidate.error || !Number.isFinite(candidate.expectedHonor)) continue;
    // 아랫줄 순서 등의 부동소수점 오차를 배치 개선으로 표시하지 않는다.
    const tolerance = Math.max(1, Math.abs(abilityStrategyScore(options, best)) * 1e-9);
    if (abilityStrategyScore(options, best) - abilityStrategyScore(options, candidate) <= tolerance) continue;
    best = candidate;
    recommendedTargets = candidateTargets;
  }
  if (!recommendedTargets) return current;
  return {
    ...best,
    placementRecommendation: {
      currentTargets: targets,
      recommendedTargets,
      currentExpectedHonor: current.expectedHonor,
      currentExpectedMeso: current.expectedMeso,
      currentExpectedCost: abilityStrategyScore(options, current),
      expectedCostSaved: abilityStrategyScore(options, current) - abilityStrategyScore(options, best),
      honorSaved: current.expectedHonor - best.expectedHonor,
      // 명성치가 줄어도 메소는 늘 수 있으므로 부호를 보존한다.
      mesoSaved: current.expectedMeso - best.expectedMeso,
    },
  };
}

function withFlexibleAbilityStrategy(options, current) {
  if (!options.flexiblePlacement || !options.comparePlacements || !options.useAdvanced ||
      options.swapLower === false || current.error || options.targets?.some((t) => t?.locked)) return current;
  const targets = normalizeStrategyTargets(options.targets ?? [], "advanced");
  if (targets.some((t) => !t.type || t.locked) || new Set(targets.map((t) => t.type)).size !== 3) return current;
  const settings = { ...options, targets, abyssCount: normalizeInventory(options.abyssCount) };
  const plans = new Map();
  const api = {
    options: ABILITY_OPTIONS,
    values: abilityValueDistribution,
    shortName: strategyTargetName,
    weight: (type, grade) => optionWeight(OPTIONS_BY_ID.get(type), grade, "advanced"),
    honorCost: (locks, half) => getAbilityResetHonorCost("advanced", locks, half),
    mesoCost: (locks) => abilityResetMesoCost("advanced", locks),
    finite: abyssFinitePolicy,
    plan: (ordered) => {
      const key = JSON.stringify(ordered);
      if (!plans.has(key)) plans.set(key, calculateHonorCompletionPlan({ targets: ordered,
        method: "advanced", swapLower: true, halfHonor: options.halfHonor }));
      return plans.get(key);
    },
    vector: (plan, mask) => abyssPlanVector(plan, mask, "advanced"),
    describe: (target, line, acquiring = false) => line < 0
      ? `${strategyTargetName(target)} (${ABILITY_GRADES[target.grade].label})`
      : describeStrategyTarget(target, line, { swapLower: true, includeGrade: true, acquiring }),
    guide: (ordered, plan, mask) => describeAbilityLockGuide({ targets: ordered, plan,
      initialMask: mask, swapLower: true }),
  };
  const candidate = calculateFlexibleAbilityCandidate(settings, api);
  if (!candidate) return current;
  const metrics = abyssResultMetrics(candidate.vector);
  const comparison = { ...metrics, pairModes: candidate.pairModes };
  if (!(metrics.expectedHonor < current.expectedHonor - Math.max(1, current.expectedHonor * 1e-9))) {
    return { ...current, flexibleComparison: comparison };
  }
  const noAbyss = settings.abyssCount && settings.allowAbyss !== false
    ? calculateFlexibleAbilityCandidate({ ...settings, abyssCount: 0 }, api) : candidate;
  const baselineHonor = Math.min(current.baselineHonor, noAbyss.vector[0],
    ...[...plans.values()].map((plan) => plan.expectedHonor));
  const { placementRecommendation, ...baseline } = current;
  return { ...baseline, ...metrics, baselineHonor,
    honorSaved: Math.max(0, baselineHonor - metrics.expectedHonor),
    strategyMode: "flexible-lower-acquisition", flexibleComparison: comparison,
    steps: [{ method: "advanced", title: "먼저 나온 아랫줄에 맞춰 배치 결정",
      description: "아래 두 줄의 종류·등급을 먼저 확보하고, 남은 옵션을 첫 줄에 배치합니다. 수치는 두 줄을 확보한 뒤 확인하세요.",
      flexibleGuide: candidate.flexibleGuide }],
  };
}

/**
 * 고정된 완성 순서와, 한 번의 명성치 재설정에서 다른 목표가 우연히 먼저
 * 완성되는 경우까지 상태로 추적하는 적응형 경로를 모두 비교한다. 현재
 * 옵션의 정확한 수치를 입력받지 않는 범위 안에서 선택 가능한 전략군 중
 * 가격이 있으면 명성치 환산액 + 재설정 메소, 없으면 기대 명성치로 비교한다.
 */
export function calculateAbilityOptimalStrategy(options = {}) {
  if (options.honorPricePer5000 !== undefined) {
    const price = Math.max(0, Number(options.honorPricePer5000));
    const abyssPrice = Number(options.abyssPrice ?? 0);
    options = { ...options, honorPricePer5000: Number.isFinite(price) ? price : 3000000,
      abyssPrice: Number.isFinite(abyssPrice) ? Math.max(0, abyssPrice) : 0 };
    if (!options.useAdvanced) options = { ...options, allowAbyss: false, abyssCount: 0 };
  }
  const result = calculateAbilityOptimalStrategyInternal(options);
  return options.honorPricePer5000 === undefined ? result : withEconomicAbilityStrategy(options, result);
}
function withEconomicAbilityStrategy(options, current) {
  if (current.error) return current;
  const priced = (result) => ({ ...result, objective: "meso", honorPricePer5000: options.honorPricePer5000,
    expectedHonorMeso: result.expectedHonor * options.honorPricePer5000 / 5000,
    expectedAbyssMeso: (result.expectedCirculators?.abyss ?? 0) * options.abyssPrice,
    abyssPrice: options.abyssPrice,
    expectedTotalMeso: abilityStrategyScore(options, result) });
  const method = options.useAdvanced ? "advanced" : "honor";
  const targets = normalizeStrategyTargets(options.targets ?? [], method);
  if (options.swapLower === false || options.targets?.some((t) => t?.locked) ||
      targets.some((t) => !t.type) || new Set(targets.map((t) => t.type)).size !== 3 ||
      (method === "advanced" && options.comparePlacements === false)) return priced(current);
  const itemMethod = method === "advanced" ? "abyss" : "black";
  const count = options[itemMethod === "abyss" ? "allowAbyss" : "allowBlack"] === false ? 0 : normalizeInventory(options[`${itemMethod}Count`]);
  const plans = new Map();
  const api = { method, itemMethod, count, abyssPrice: options.abyssPrice, itemIndex: itemMethod === "abyss" ? 7 : 5,
    cost: (v) => v[0] * options.honorPricePer5000 / 5000 + v[1] + v[7] * options.abyssPrice,
    compare: (a, b) => compareAbilityVectors(a, b, options.honorPricePer5000, options.abyssPrice),
    options: ABILITY_OPTIONS, values: abilityValueDistribution, shortName: strategyTargetName,
    unit: (type) => OPTIONS_BY_ID.get(type)?.unit ?? "",
    weight: (type, grade) => optionWeight(OPTIONS_BY_ID.get(type), grade, method),
    resetCost: (locks) => [getAbilityResetHonorCost(method, locks, options.halfHonor), abilityResetMesoCost(method, locks),
      method === "honor" ? 1 : 0, method === "advanced" ? 1 : 0, 0, 0, 0, 0, 0],
    plan: (ordered) => {
      const key = JSON.stringify(ordered);
      if (!plans.has(key)) plans.set(key, calculateHonorCompletionPlan({ targets: ordered, method, swapLower: true,
        halfHonor: options.halfHonor, honorPricePer5000: options.honorPricePer5000 }));
      return plans.get(key);
    },
    vector: (plan, mask) => abyssPlanVector(plan, mask, method),
    describe: (target, line) => line < 0 ? `${strategyTargetName(target)} (${ABILITY_GRADES[target.grade].label})`
      : describeStrategyTarget(target, line, { swapLower: true, includeGrade: true }),
    guide: (ordered, plan, mask) => describeAbilityLockGuide({ targets: ordered, plan, initialMask: mask, swapLower: true }),
  };
  const candidate = calculateAbilityEconomicCandidate({ ...options, targets }, api);
  if (!candidate) return priced(current);
  const metrics = abyssResultMetrics(candidate.vector);
  const { placementRecommendation, ...base } = current;
  const best = abilityStrategyScore(options, metrics) >= abilityStrategyScore(options, current) - Math.max(1, abilityStrategyScore(options, current) * 1e-10)
    ? priced(current) : priced({ ...base, ...metrics, inventory: { ...current.inventory, [itemMethod]: count },
    strategyMode: "economic-adaptive", honorSaved: Math.max(0, current.baselineHonor - metrics.expectedHonor),
    steps: [{ method, title: "현재 수치에 따라 배치와 진행 순서 선택", economicGuide: candidate.guide }] });
  if (options.includePractical) {
    const chaosCount = method === "honor" && options.allowChaos !== false ? normalizeInventory(options.chaosCount) : 0;
    const practical = calculateAbilityPracticalCandidate({ ...options, targets }, { ...api,
      count: count + chaosCount, blackCount: count, chaosCount, trackOutcomes: Boolean(options.includeRouteComparison) });
    if (practical) best.practicalStrategy = priced({ ...base, ...abyssResultMetrics(practical.vector),
      ...(options.includeRouteComparison ? { phaseMetrics: abilityPhaseMetrics(practical, options.honorPricePer5000) } : {}),
      strategyMode: "practical-fixed", inventory: { ...current.inventory, [itemMethod]: count },
      steps: [{ method, title: "실전 진행 순서", economicGuide: practical.guide }] });
    // Advanced is allowed, not mandatory. L/U/U goals also compare the
    // ordinary practical route, including its available Black inventory.
    if (options.useAdvanced && !targets.slice(1).some((t) => t.grade === "legendary")) {
      const ordinary = calculateAbilityOptimalStrategy({ ...options, useAdvanced: false, allowAbyss: false, abyssCount: 0 });
      const alternative = ordinary.practicalStrategy;
      if (alternative && (!best.practicalStrategy || alternative.expectedTotalMeso < best.practicalStrategy.expectedTotalMeso)) {
        best.practicalStrategy = { ...alternative, inventory: { ...alternative.inventory, abyss: count },
          advancedUnnecessary: true };
      }
    }
    // The mixed-stock practical candidate is also a valid route for the
    // overall comparison; never keep a more expensive Black-only result above it.
    if (best.practicalStrategy?.steps[0]?.economicGuide?.mixed &&
        best.practicalStrategy.expectedTotalMeso < best.expectedTotalMeso) Object.assign(best, best.practicalStrategy);
    if (options.includeRouteComparison && best.practicalStrategy && method === "advanced") {
      const routes = [{ id: "inventory", label: "심서큘 제한 가정", result: best.practicalStrategy }];
      const reference = options.allowAbyss === false ? null : calculateAbilityUnlimitedCandidate({ ...options, targets }, api);
      if (reference) routes.push({ id: "reference", label: "심서큘 무제한 가정", result: priced({ ...base,
        ...abyssResultMetrics(reference.vector),
        phaseMetrics: { maximumUses: null, phaseSuccessProbability: null, exhaustionProbability: null, exhaustionMesoContribution: 0 },
        strategyMode: "unlimited-reference", inventory: { ...current.inventory, [itemMethod]: count },
        steps: [{ method, title: "보유량 제한 없이 진행", economicGuide: reference.guide }] }) });
      const recommended = routes.reduce((a, b) => b.result.expectedTotalMeso < a.result.expectedTotalMeso - 1 ? b : a);
      best.routeComparison = { availableCount: count, recommendedId: recommended.id, routes,
        unavailableReason: options.allowAbyss === false ? "심서큘 허용을 켜면 보유량 제한 없는 전략도 비교합니다." : null };
    }
  }
  return best;
}

// Internal model adapter for stochastic route cost distributions. Honor waits
// use the same mean identical-result correction as the expectation solver.
export function createAbilityRouteSimulationApi(method, settings = {}) {
  const plans = new Map();
  return {
    method, options: ABILITY_OPTIONS, values: abilityValueDistribution,
    weight: (type, grade) => optionWeight(OPTIONS_BY_ID.get(type), grade, method),
    resetCost: (locks) => [getAbilityResetHonorCost(method, locks, settings.halfHonor), abilityResetMesoCost(method, locks)],
    transitions: (targets, mask) => honorTransitionDistribution(targets, mask, true, method),
    plan: (targets) => {
      const key = JSON.stringify(targets);
      if (!plans.has(key)) plans.set(key, calculateHonorCompletionPlan({ targets, method, swapLower: true,
        halfHonor: settings.halfHonor, honorPricePer5000: settings.honorPricePer5000 }));
      return plans.get(key);
    },
  };
}
function calculateAbilityOptimalStrategyInternal(options) {
  if (options.useAdvanced) {
    const current = withAbyssCompletionStrategy(options,
      calculateAbilityAdvancedOptimalStrategy({ ...options, allowAbyss: false }));
    const placed = options.comparePlacements ? recommendAbilityTargetPlacement(options, current) : current;
    return options.honorPricePer5000 === undefined ? withFlexibleAbilityStrategy(options, placed) : placed;
  }
  if (options.targets?.slice(1).some((target) => target?.type && target.grade === "legendary")) {
    return emptyStrategyResult("아랫줄 레전드리 목표는 고급 재설정 사용을 켜주세요.");
  }
  const adaptive = calculateAbilityOptimalStrategyLegacy(options);
  const ordered = calculateAbilityOptimalStrategyOrdered(options);
  const candidates = [adaptive, ordered].filter(
    (result) => !result.error && Number.isFinite(result.expectedHonor),
  );
  if (!candidates.length) return adaptive.error ? ordered : adaptive;
  candidates.sort((left, right) => (
    left.expectedHonor - right.expectedHonor ||
    strategyCirculatorTotal(left) - strategyCirculatorTotal(right) ||
    left.expectedHonorResets - right.expectedHonorResets
  ));
  const best = candidates[0];
  const baselineHonor = Number.isFinite(adaptive.baselineHonor)
    ? adaptive.baselineHonor
    : best.baselineHonor;
  return withAbyssCompletionStrategy(options, {
    ...best,
    baselineHonor,
    honorSaved: Number.isFinite(baselineHonor)
      ? Math.max(0, baselineHonor - best.expectedHonor)
      : best.honorSaved,
    strategyMode: best === adaptive ? "adaptive-state" : "ordered-refinement",
  });
}

export function getAbilityWeightTotals(method = "honor") {
  methodInfo(method);
  return Object.fromEntries(
    GRADES.map((grade) => [
      grade,
      ABILITY_OPTIONS.reduce(
        (sum, entry) => sum + optionWeight(entry, grade, method),
        0,
      ),
    ]),
  );
}
