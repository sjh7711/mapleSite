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
    label: "명성치",
    resourceLabel: "명성치",
    locks: true,
  }),
  miracle: Object.freeze({
    id: "miracle",
    label: "미라클 서큘레이터",
    resourceLabel: "서큘레이터",
    locks: false,
  }),
  black: Object.freeze({
    id: "black",
    label: "블랙(카오스) 서큘레이터",
    resourceLabel: "서큘레이터",
    locks: false,
    valueOnly: true,
  }),
  chaos: Object.freeze({
    id: "chaos",
    label: "카오스 서큘레이터",
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

function lineGradeDistribution(line) {
  if (line === 0) return [["legendary", 1]];
  return [["unique", 0.15], ["epic", 0.85]];
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
    return lineGradeDistribution(Number(line)).map(([grade]) => grade);
  }
  if (Number(line) === 0) return ["legendary"];
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
      resourcePerReset: method === "honor" ? getAbilityHonorCost(0, halfHonor) : 1,
      expectedResource: Infinity,
      lockCount: 0,
      error: "목표 옵션을 하나 이상 선택해주세요.",
    };
  }
  if (duplicates) {
    return {
      probability: 0,
      expectedResets: Infinity,
      resourcePerReset: method === "honor" ? getAbilityHonorCost(0, halfHonor) : 1,
      expectedResource: Infinity,
      lockCount: normalizedTargets.filter((target) => target.locked).length,
      error: "어빌리티에는 같은 종류의 옵션이 중복해서 등장하지 않습니다.",
    };
  }

  const unlockedTargets = active.filter((target) => !target.locked);
  const lockCount = normalizedTargets.filter((target) => target.locked).length;
  const resourcePerReset = method === "honor"
    ? getAbilityHonorCost(lockCount, halfHonor)
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
    for (const [grade, gradeProbability] of lineGradeDistribution(line)) {
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
  const expectedResets = probability > 0 ? 1 / probability : Infinity;
  return {
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

function normalizeStrategyTargets(targets) {
  return Array.from({ length: 3 }, (_, line) => {
    const target = targets[line] ?? {};
    const type = OPTIONS_BY_ID.has(target.type) ? target.type : "";
    return {
      type,
      minimum: Number(target.minimum) || 0,
      grade: line === 0
        ? "legendary"
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
function honorTransitionDistribution(targets, achievedMask, swapLower) {
  const cacheKey = `${targets.map((target) => (
    `${target.type}:${target.minimum}:${target.grade}`
  )).join("|")}/${achievedMask}/${swapLower ? 1 : 0}`;
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
  const hasUnlockedLowerTarget = targets.slice(1).some(
    (target, index) => target.type && !(achievedMask & (1 << (index + 1))),
  );
  const lastRelevantLine = swapLower && !lowerLocked && hasUnlockedLowerTarget
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
      const probability = valueTailProbability(
        OPTIONS_BY_ID.get(target.type),
        outcomes[line].grade,
        target.minimum,
        "honor",
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
    for (const [grade, gradeProbability] of lineGradeDistribution(line)) {
      let totalWeight = 0;
      for (const entry of ABILITY_OPTIONS) {
        if (!used.has(entry.id)) totalWeight += optionWeight(entry, grade, "honor");
      }
      for (const entry of ABILITY_OPTIONS) {
        if (used.has(entry.id)) continue;
        const weight = optionWeight(entry, grade, "honor");
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
  HONOR_TRANSITION_CACHE.set(cacheKey, distribution);
  return distribution;
}

function calculateHonorCompletionPlan({
  targets,
  initialMask = 0,
  swapLower = true,
  halfHonor = false,
}) {
  const goalMask = targets.reduce(
    (mask, target, line) => target.type ? mask | (1 << line) : mask,
    0,
  );
  const expectedHonor = Array(8).fill(Infinity);
  const expectedResets = Array(8).fill(Infinity);
  const decisionsByMask = Array.from({ length: 8 }, () => new Map());
  expectedHonor[goalMask] = 0;
  expectedResets[goalMask] = 0;

  for (let completed = popcount(goalMask) - 1; completed >= 0; completed -= 1) {
    for (let mask = 0; mask < 8; mask += 1) {
      if ((mask & ~goalMask) || popcount(mask) !== completed) continue;
      const distribution = honorTransitionDistribution(targets, mask, swapLower);
      const progressEvents = [];
      for (let outcomeMask = 0; outcomeMask < distribution.length; outcomeMask += 1) {
        const probability = distribution[outcomeMask];
        if (probability <= 0 || outcomeMask === mask) continue;
        const newBits = outcomeMask & ~mask;
        let bestMask = -1;
        for (let kept = newBits; kept > 0; kept = (kept - 1) & newBits) {
          const candidateMask = mask | kept;
          if (!Number.isFinite(expectedHonor[candidateMask])) continue;
          if (
            bestMask < 0 ||
            expectedHonor[candidateMask] < expectedHonor[bestMask] ||
            (
              expectedHonor[candidateMask] === expectedHonor[bestMask] &&
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
            futureHonor: expectedHonor[bestMask],
          });
        }
      }
      progressEvents.sort((left, right) => left.futureHonor - right.futureHonor);

      // 결과에 목표 줄이 여러 개 포함되어도 모두 잠그는 것이 항상 최선은
      // 아니다. 잠금 비용이 크게 뛰는 경우에는 흔한 줄을 버리고 희귀한 줄만
      // 유지할 수 있으므로, 진행 상태를 채택할 경계까지 함께 최적화한다.
      const resetCost = getAbilityHonorCost(popcount(mask), halfHonor);
      let acceptedProbability = 0;
      let acceptedFutureHonor = 0;
      let stateHonor = Infinity;
      let acceptedCount = 0;
      for (let index = 0; index < progressEvents.length; index += 1) {
        const event = progressEvents[index];
        acceptedProbability += event.probability;
        acceptedFutureHonor += event.probability * event.futureHonor;
        const candidate = (resetCost + acceptedFutureHonor) / acceptedProbability;
        const nextBoundary = progressEvents[index + 1]?.futureHonor ?? Infinity;
        if (candidate <= nextBoundary + 1e-9) {
          stateHonor = candidate;
          acceptedCount = index + 1;
          break;
        }
      }
      if (!Number.isFinite(stateHonor) || acceptedCount <= 0) continue;

      let futureResets = 0;
      let chosenProbability = 0;
      for (let index = 0; index < progressEvents.length; index += 1) {
        const event = progressEvents[index];
        const chosenMask = index < acceptedCount ? event.bestMask : mask;
        decisionsByMask[mask].set(event.outcomeMask, chosenMask);
        if (chosenMask === mask) continue;
        chosenProbability += event.probability;
        futureResets += event.probability * expectedResets[chosenMask];
      }
      expectedHonor[mask] = stateHonor;
      expectedResets[mask] = (1 + futureResets) / chosenProbability;
    }
  }

  return {
    expectedHonor: expectedHonor[initialMask],
    expectedResets: expectedResets[initialMask],
    expectedHonorByMask: expectedHonor,
    expectedResetsByMask: expectedResets,
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

function describeStrategyTarget(target, line) {
  const entry = OPTIONS_BY_ID.get(target.type);
  const value = entry?.unit === "단계"
    ? `${target.minimum}단계 이상`
    : `${target.minimum}${entry?.unit ?? ""} 이상`;
  return `${line + 1}번째 줄 ${entry?.label ?? target.type} ${value}`;
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

function calculateHonorPriorityOrder({
  targets,
  initialMask = 0,
  swapLower = true,
  halfHonor = false,
}) {
  const remaining = targets
    .map((target, line) => ({ target, line }))
    .filter(({ target, line }) => target.type && !(initialMask & (1 << line)))
    .map(({ line }) => line);
  let best = { score: Infinity, lines: remaining };

  for (const order of permutations(remaining)) {
    let mask = initialMask;
    let score = 0;
    let possible = true;
    for (const line of order) {
      const stageTargets = targets.map((target, targetLine) => {
        if (mask & (1 << targetLine)) return { ...target, locked: true };
        if (targetLine === line) return { ...target, locked: false };
        return { type: "", minimum: 0, grade: target.grade, locked: false };
      });
      const result = calculateAbilityExpected({
        method: "honor",
        targets: stageTargets,
        swapLower,
        halfHonor,
      });
      if (result.error || !Number.isFinite(result.expectedResource)) {
        possible = false;
        break;
      }
      score += result.expectedResource;
      mask |= 1 << line;
    }
    if (possible && score < best.score) best = { score, lines: order };
  }
  return best.lines.map((line) => describeStrategyTarget(targets[line], line));
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
  if (blackCount > 0) methodParts.push(`블랙 최대 ${blackCount.toLocaleString("ko-KR")}개`);
  if (chaosCount > 0) methodParts.push(`카오스 최대 ${chaosCount.toLocaleString("ko-KR")}개`);
  const priority = stages.map((stage, index) => {
    if (index === 0 && refinedFirst) {
      return [
        `${describeStrategyTarget(stage.acquisitionTarget, stage.line)}을 명성치로 확보`,
        `${methodParts.join(" · ")}로 ${describeStrategyTarget(targets[stage.line], stage.line)} 완성`,
        `모두 소진해도 실패하면 명성치로 ${describeStrategyTarget(targets[stage.line], stage.line)} 완성`,
        "완성 후 잠금",
      ].join(" → ");
    }
    return `${describeStrategyTarget(targets[stage.line], stage.line)}을 명성치로 완성 → 잠금`;
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
      title: "미라클로 한 줄 먼저 확보",
      description: describeStrategyTarget(
        normalizedTargets[best.miracleLine],
        best.miracleLine,
      ),
      expectedResets: best.expectedCirculators.miracle,
      maximumUses: inventory.miracle,
      successProbability: best.miracleSuccessProbability,
    });
  }
  if (best.expectedHonorResets > 0) {
    const successMask = best.miracleLine >= 0 ? 1 << best.miracleLine : 0;
    steps.push({
      method: "honor",
      title: "명성치 잠금 순서",
      description: best.useRefinement
        ? "표시된 수치는 종류·등급을 확보하기 위한 잠금 기준입니다. 다른 목표가 먼저 나오면 그 줄부터 잠급니다."
        : "아래 우선순위대로 노리되, 다른 목표가 먼저 완성되면 그 줄부터 잠급니다.",
      priority: calculateHonorPriorityOrder({
        targets: best.acquisitionTargets,
        initialMask: successMask,
        swapLower,
        halfHonor,
      }),
      fallbackPriority: best.miracleLine >= 0 && best.miracleSuccessProbability < 1
        ? calculateHonorPriorityOrder({
          targets: best.acquisitionTargets,
          initialMask: 0,
          swapLower,
          halfHonor,
        })
        : [],
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
    fallbackPriority: [],
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
        fallbackPriority: regular.priority,
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
      title: "미라클로 한 줄 먼저 확보",
      description: describeStrategyTarget(
        normalizedTargets[best.miracleLine],
        best.miracleLine,
      ),
      expectedResets: best.expectedCirculators.miracle,
      maximumUses: inventory.miracle,
      successProbability: best.miracleSuccessProbability,
    });
  }
  if (best.expectedHonorResets > 0) {
    steps.push({
      method: "honor",
      priority: best.priority,
      fallbackPriority: best.miracleLine >= 0 ? best.fallbackPriority : [],
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

/**
 * 고정된 완성 순서와, 한 번의 명성치 재설정에서 다른 목표가 우연히 먼저
 * 완성되는 경우까지 상태로 추적하는 적응형 경로를 모두 비교한다. 현재
 * 옵션의 정확한 수치를 입력받지 않는 범위 안에서 선택 가능한 전략군 중
 * 기대 명성치가 가장 낮은 결과를 반환한다.
 */
export function calculateAbilityOptimalStrategy(options = {}) {
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
  return {
    ...best,
    baselineHonor,
    honorSaved: Number.isFinite(baselineHonor)
      ? Math.max(0, baselineHonor - best.expectedHonor)
      : best.honorSaved,
    strategyMode: best === adaptive ? "adaptive-state" : "ordered-refinement",
  };
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
