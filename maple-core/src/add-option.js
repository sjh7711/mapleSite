import { formatApproxMeso } from "./starforce.js";
import { adjustedNextResultProbability } from "./no-repeat.js";

const OFFICIAL_PAGE =
  "https://maplestory.nexon.com/Guide/OtherProbability/game/gameAddOption";
const CACHE_DURATION = 6 * 60 * 60 * 1000;
let tableCache = null;

// 검은 환생의 불꽃 1회 사용 비용. 시세와 무관한 고정값으로 취급한다.
export const BLACK_FLAME_MESO = 3_000_000;

export const MAX_ADD_OPTION_COUNT = 4;
export const ADD_OPTION_STAGE_COUNT = 5;
// 보스 장비는 결정된 단계에서 +2단계로 계산한다.
export const BOSS_STAGE_BONUS = 2;

const NORMAL_WEAPON_ATTACK_MULTIPLIERS = [0, 1, 2.2, 3.63, 5.324, 7.3205];
const BOSS_WEAPON_ATTACK_MULTIPLIERS = [
  0,
  0,
  0,
  3,
  4.4,
  6.05,
  7.986,
  10.2487,
];

/**
 * 공식 "추가 옵션의 단계 설정 확률"과 "옵션의 개수" 표에서 읽어올 획득 방법.
 * stagePattern은 단계 표, countPattern은 개수 표의 구분 열과 대조한다.
 */
export const ADD_OPTION_SOURCES = {
  abyss: {
    label: "심연의 환생의 불꽃",
    stagePattern: /^심연/,
    countPattern: /^환생의\s*불꽃류$/,
  },
  black: {
    label: "검은/영원한 환생의 불꽃",
    stagePattern: /^검은/,
    countPattern: /^환생의\s*불꽃류$/,
  },
  strong: {
    label: "강력한/타오르는 환생의 불꽃",
    stagePattern: /^강력한/,
    countPattern: /^환생의\s*불꽃류$/,
  },
};

// 공식 페이지를 읽지 못했을 때 사용할 스냅샷 (2026-08-09 확인 기준).
export const ADD_OPTION_TABLES_SNAPSHOT_DATE = "2026-08-09";
export const ADD_OPTION_TABLES_SNAPSHOT = {
  official: false,
  stages: {
    abyss: [0, 0, 0.63, 0.34, 0.03],
    black: [0, 0.29, 0.45, 0.25, 0.01],
    strong: [0.2, 0.3, 0.36, 0.14, 0],
  },
  counts: {
    abyss: [0.4, 0.4, 0.16, 0.04],
    black: [0.4, 0.4, 0.16, 0.04],
    strong: [0.4, 0.4, 0.16, 0.04],
  },
};

// 무기 외 장비의 공격력/마력, 올스탯%, 무기의 보스 몬스터 데미지% 부여 제한.
export const ADD_OPTION_MIN_LEVELS = {
  attack: 60,
  allStat: 70,
  bossDamage: 90,
};

const STAT_KEYS = ["STR", "DEX", "INT", "LUK"];
const DUAL_PAIRS = [
  ["STR", "DEX"],
  ["STR", "INT"],
  ["STR", "LUK"],
  ["DEX", "INT"],
  ["DEX", "LUK"],
  ["INT", "LUK"],
];

function decodeHtml(value) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replace(/\s+/g, " ")
    .trim();
}

function parseTableRows(html) {
  return [...String(html).matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)].flatMap(
    (table) =>
      [...table[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
        [...row[1].matchAll(/<(t[dh])[^>]*>([\s\S]*?)<\/\1>/gi)].map((cell) =>
          decodeHtml(cell[2]),
        ),
      ),
  );
}

/**
 * 구분 열이 pattern과 맞고 백분율 합이 100%인 행만 확률로 받아들인다.
 * 같은 이름의 행이 여러 표에 있어도 열 수와 합계로 구분된다.
 */
function readPercentRow(rows, pattern, length) {
  for (const cells of rows) {
    if (cells.length <= length || !pattern.test(cells[0])) continue;

    const values = cells
      .slice(1, length + 1)
      .map((cell) => Number.parseFloat(cell.replace("%", "")) / 100);
    if (values.some((value) => !Number.isFinite(value) || value < 0)) continue;

    const sum = values.reduce((total, value) => total + value, 0);
    if (Math.abs(sum - 1) > 1e-6) continue;
    return values;
  }
  return null;
}

export function parseOfficialAddOptionTables(html) {
  const rows = parseTableRows(html);
  const stages = {};
  const counts = {};

  for (const [key, source] of Object.entries(ADD_OPTION_SOURCES)) {
    const stage = readPercentRow(
      rows,
      source.stagePattern,
      ADD_OPTION_STAGE_COUNT,
    );
    const count = readPercentRow(
      rows,
      source.countPattern,
      MAX_ADD_OPTION_COUNT,
    );
    if (!stage || !count) {
      throw new Error(
        "넥슨 공식 추가 옵션 확률표의 형식이 변경되어 계산을 완료하지 못했습니다.",
      );
    }
    stages[key] = stage;
    counts[key] = count;
  }

  return { official: true, stages, counts };
}

export async function fetchOfficialAddOptionTables({ fetchImpl = fetch } = {}) {
  if (tableCache && Date.now() - tableCache.savedAt < CACHE_DURATION) {
    return tableCache.tables;
  }

  try {
    const response = await fetchImpl(OFFICIAL_PAGE, {
      headers: { "User-Agent": "Maple-Discord-Bot/2.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const tables = parseOfficialAddOptionTables(await response.text());
    tableCache = { savedAt: Date.now(), tables };
    return tables;
  } catch {
    // 확률표는 거의 바뀌지 않으므로 조회에 실패해도 스냅샷으로 계산을 이어간다.
    return ADD_OPTION_TABLES_SNAPSHOT;
  }
}

/**
 * 공식 "장비분류 별 옵션의 종류" 19종을 장비 레벨 제한까지 반영해 만든다.
 * 부여될 수 없는 옵션은 풀에서 빠지고 나머지 옵션의 확률이 그만큼 올라간다.
 */
export function buildAddOptionPool({ weapon, itemLevel }) {
  const options = [
    ...STAT_KEYS.map((stat) => ({
      key: `stat:${stat}`,
      kind: "single",
      stats: [stat],
    })),
    ...DUAL_PAIRS.map(([first, second]) => ({
      key: `dual:${first}+${second}`,
      kind: "dual",
      stats: [first, second],
    })),
    { key: "maxHp", kind: "maxHp" },
    { key: "maxMp", kind: "none" },
    { key: "levelDecrease", kind: "none" },
    { key: "armor", kind: "none" },
  ];

  if (weapon || itemLevel >= ADD_OPTION_MIN_LEVELS.attack) {
    options.push(
      { key: "attack", kind: "attack", attackType: "attack" },
      { key: "magic", kind: "attack", attackType: "magic" },
    );
  }

  if (weapon) {
    if (itemLevel >= ADD_OPTION_MIN_LEVELS.bossDamage) {
      options.push({ key: "bossDamage", kind: "bossDamage" });
    }
    options.push({ key: "damage", kind: "damage" });
  } else {
    options.push({ key: "speed", kind: "none" }, { key: "jump", kind: "none" });
  }

  if (itemLevel >= ADD_OPTION_MIN_LEVELS.allStat) {
    options.push({ key: "allStat", kind: "allStat" });
  }

  return options;
}

/**
 * 최대 HP 추가옵션의 실제 수치. 200레벨 전에는 10레벨 구간마다 30,
 * 200~249레벨은 10레벨 구간마다 20씩 오르며 결정된 단계를 곱한다.
 * 예: 200제 7단계는 4,200.
 */
export function getAddOptionMaxHpValue(itemLevel, stage) {
  if (!Number.isInteger(itemLevel) || itemLevel < 0 || itemLevel > 250) {
    throw new RangeError("장비 레벨은 0~250 사이로 입력해 주세요.");
  }
  if (!Number.isInteger(stage) || stage < 1 || stage > 7) {
    throw new RangeError("추가옵션 단계는 1~7 사이여야 합니다.");
  }
  const firstStage = itemLevel < 10
    ? 3
    : itemLevel < 200
      ? Math.floor(itemLevel / 10) * 30
      : itemLevel < 250
        ? 600 + Math.floor((itemLevel - 200) / 10) * 20
        : 700;
  return firstStage * stage;
}

function normalizedAddOptionEquivalence(addOptionEquivalence) {
  if (!addOptionEquivalence) return null;
  if (
    typeof addOptionEquivalence !== "object" ||
    Array.isArray(addOptionEquivalence) ||
    typeof addOptionEquivalence.flatStatToDamagePercent !== "object" ||
    addOptionEquivalence.flatStatToDamagePercent === null ||
    Array.isArray(addOptionEquivalence.flatStatToDamagePercent)
  ) {
    throw new Error("추옵 직접 환산값이 올바르지 않습니다.");
  }

  const flatStatToDamagePercent = {};
  for (const stat of [...STAT_KEYS, "HP"]) {
    const value = Number(
      addOptionEquivalence.flatStatToDamagePercent[stat] ?? 0,
    );
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${stat} +1 환산값은 0 이상이어야 합니다.`);
    }
    flatStatToDamagePercent[stat] = value;
  }

  const flatAttackToDamagePercent = Number(
    addOptionEquivalence.flatAttackToDamagePercent,
  );
  const allStatPercentToDamagePercent = Number(
    addOptionEquivalence.allStatPercentToDamagePercent,
  );
  const bossDamageToDamagePercent = Number(
    addOptionEquivalence.bossDamageToDamagePercent ?? 1,
  );
  for (const [label, value] of [
    ["공격력/마력 +1", flatAttackToDamagePercent],
    ["올스탯 +1%", allStatPercentToDamagePercent],
  ]) {
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`${label} 환산값은 0 이상이어야 합니다.`);
    }
  }
  if (!Number.isFinite(bossDamageToDamagePercent) || bossDamageToDamagePercent <= 0) {
    throw new RangeError("데미지·보스 데미지 +1% 환산값은 0보다 커야 합니다.");
  }

  return {
    ...addOptionEquivalence,
    flatStatToDamagePercent,
    flatAttackToDamagePercent,
    allStatPercentToDamagePercent,
    bossDamageToDamagePercent,
  };
}

/**
 * 옵션 하나가 특정 단계로 붙었을 때의 값을 개인 환산 %급으로 바꾼다.
 * 방어구 목표(급)와 무기 목표(보총뎀 %급)는 호출부에서 %급으로 바꿔 넘긴다.
 */
export function createAddOptionScorer({
  itemLevel,
  mainStat,
  subStat,
  attackType,
  statEquivalence,
  addOptionEquivalence,
}) {
  // 200레벨 이후 구간은 단순 floor 공식에서 벗어난다.
  const singleCoefficient = itemLevel < 200
    ? Math.floor(itemLevel / 20) + 1
    : itemLevel < 230
      ? 11
      : 12;
  const dualCoefficient = itemLevel < 200
    ? Math.floor(itemLevel / 40) + 1
    : itemLevel < 250
      ? 6
      : 7;
  const direct = normalizedAddOptionEquivalence(addOptionEquivalence);

  if (!direct && !statEquivalence?.flatMainStatToPercent) {
    throw new Error("추옵 환산값을 찾지 못했습니다.");
  }

  const flatStatScore = (stat, value) => {
    if (direct) {
      return value * direct.flatStatToDamagePercent[stat];
    }
    if (stat === mainStat) {
      return value * statEquivalence.flatMainStatToPercent;
    }
    if (stat === subStat) {
      return (
        value *
        statEquivalence.flatMainStatToPercent *
        statEquivalence.flatSubStatToFlatMainStat
      );
    }
    return 0;
  };

  return (option, stage) => {
    switch (option.kind) {
      case "single":
        return flatStatScore(option.stats[0], singleCoefficient * stage);
      case "dual":
        return option.stats.reduce(
          (sum, stat) => sum + flatStatScore(stat, dualCoefficient * stage),
          0,
        );
      case "maxHp":
        return direct
          ? getAddOptionMaxHpValue(itemLevel, stage) *
              direct.flatStatToDamagePercent.HP
          : 0;
      case "attack":
        if (option.attackType !== attackType) return 0;
        if (direct) return stage * direct.flatAttackToDamagePercent;
        return (
          stage *
          statEquivalence.attackToMainStat *
          statEquivalence.flatMainStatToPercent
        );
      case "allStat":
        return stage * (direct
          ? direct.allStatPercentToDamagePercent
          : statEquivalence.allStatPercentToMainPercent);
      // 보스 데미지%는 단계당 2%, 데미지%는 단계당 1%이며 보스전에서
      // 두 옵션 모두 같은 계수에 합산되므로 같은 환산값을 쓴다.
      case "bossDamage":
        return 2 * stage * (direct
          ? direct.bossDamageToDamagePercent
          : statEquivalence.bossDamageToMainPercent);
      case "damage":
        return stage * (direct
          ? direct.bossDamageToDamagePercent
          : statEquivalence.bossDamageToMainPercent);
      default:
        return 0;
    }
  };
}

function stageEntries(distribution, boss) {
  return distribution
    .map((probability, index) => ({
      stage: index + 1 + (boss ? BOSS_STAGE_BONUS : 0),
      probability,
    }))
    .filter((entry) => entry.probability > 0);
}

function countEntries(distribution, boss) {
  // 보스 장비는 옵션 개수가 4개로 고정된다.
  if (boss) return [{ count: MAX_ADD_OPTION_COUNT, probability: 1 }];
  return distribution
    .map((probability, index) => ({ count: index + 1, probability }))
    .filter((entry) => entry.probability > 0);
}

function combinations(n, k) {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let index = 0; index < k; index += 1) {
    result = (result * (n - index)) / (index + 1);
  }
  return result;
}

/**
 * 목표 점수 이상이 나올 확률. 옵션은 19종에서 비복원 균등 추출되고
 * 각 옵션이 독립적으로 단계를 뽑는다. 점수가 0인 옵션은 조합 수에만
 * 기여하므로 열거에서 빼고 C(0점 옵션 수, 남은 칸)으로 되돌린다.
 */
const REPEAT_WEIGHT_SERIES_TERMS = 8;

function targetDistribution({
  pool,
  scorer,
  stages,
  counts,
  target,
  requiredOption = null,
  requiredStage = null,
}) {
  const maxCount = Math.max(...counts.map((entry) => entry.count));
  const scoring = [];
  let zeroCount = 0;

  for (const option of pool) {
    const scored = stages.map((entry) => ({
      probability: entry.probability,
      score: scorer(option, entry.stage),
      stage: entry.stage,
    }));
    if (scored.some((entry) => entry.score > 0) || option === requiredOption) {
      scoring.push({ option, entries: scored });
    }
    else zeroCount += 1;
  }

  const reachedMoments = Array.from(
    { length: REPEAT_WEIGHT_SERIES_TERMS + 1 },
    () => new Array(maxCount + 1).fill(0),
  );
  const walk = (index, chosen, score, probability, requiredMatched) => {
    if (index === scoring.length) {
      // 캐릭터 장비 요약은 환산값을 소수점 6자리에서 반올림한다. 같은
      // 조합을 다시 계산했을 때 그 반올림 오차 때문에 탈락하지 않게 한다.
      if (score + 1e-6 >= target && requiredMatched) {
        for (let order = 1; order <= REPEAT_WEIGHT_SERIES_TERMS; order += 1) {
          reachedMoments[order][chosen] += probability ** order;
        }
      }
      return;
    }
    const candidate = scoring[index];
    walk(index + 1, chosen, score, probability, requiredMatched);
    if (chosen === maxCount) return;
    for (const entry of candidate.entries) {
      walk(
        index + 1,
        chosen + 1,
        score + entry.score,
        probability * entry.probability,
        requiredMatched || (
          candidate.option === requiredOption && entry.stage === requiredStage
        ),
      );
    }
  };
  walk(0, 0, 0, 1, requiredOption === null);

  const stageMoments = Array.from(
    { length: REPEAT_WEIGHT_SERIES_TERMS + 1 },
    (_, order) => order === 0
      ? 0
      : stages.reduce(
          (sum, entry) => sum + entry.probability ** order,
          0,
        ),
  );
  const successMoments = new Array(REPEAT_WEIGHT_SERIES_TERMS + 1).fill(0);
  const totalMoments = new Array(REPEAT_WEIGHT_SERIES_TERMS + 1).fill(0);
  for (const { count, probability } of counts) {
    const totalWays = combinations(pool.length, count);
    if (!(totalWays > 0)) continue;
    for (let order = 1; order <= REPEAT_WEIGHT_SERIES_TERMS; order += 1) {
      totalMoments[order] +=
        (probability ** order / totalWays ** (order - 1)) *
        stageMoments[order] ** count;
    }
    for (let chosen = 0; chosen <= Math.min(count, maxCount); chosen += 1) {
      const ways = combinations(zeroCount, count - chosen);
      if (!ways) continue;
      for (let order = 1; order <= REPEAT_WEIGHT_SERIES_TERMS; order += 1) {
        if (!reachedMoments[order][chosen]) continue;
        successMoments[order] +=
          (probability / totalWays) ** order *
          ways *
          stageMoments[order] ** (count - chosen) *
          reachedMoments[order][chosen];
      }
    }
  }
  const rawProbability = successMoments[1];
  const failureRepeatWeight = totalMoments.slice(1).reduce(
    (sum, moment, index) =>
      sum + Math.max(0, moment - successMoments[index + 1]),
    0,
  );
  const probability = adjustedNextResultProbability({
    successProbability: rawProbability,
    failureRepeatWeight,
  });
  return {
    probability,
    rawProbability,
    sameResultExcluded: true,
  };
}

export function expectedAttempts(probability) {
  return probability > 0 ? 1 / probability : Number.POSITIVE_INFINITY;
}

function sourceMeso(key, attempts) {
  return key === "black" && Number.isFinite(attempts)
    ? attempts * BLACK_FLAME_MESO
    : null;
}

function validateCommonOptions({
  itemLevel,
  statEquivalence,
  addOptionEquivalence,
  targetToDamagePercent,
  attackType,
}) {
  if (!Number.isInteger(itemLevel) || itemLevel < 0 || itemLevel > 250) {
    throw new RangeError("장비 레벨은 0~250 사이로 입력해 주세요.");
  }
  const direct = normalizedAddOptionEquivalence(addOptionEquivalence);
  if (!direct && !statEquivalence?.flatMainStatToPercent) {
    throw new Error(
      "개인 환산값을 찾지 못했습니다. 먼저 `/환산 캐릭터:본캐`를 실행해 주세요.",
    );
  }
  const directTarget = Number(
    targetToDamagePercent ?? direct?.targetToDamagePercent,
  );
  if (direct && (!Number.isFinite(directTarget) || directTarget <= 0)) {
    throw new RangeError("목표 1급 환산값은 0보다 커야 합니다.");
  }
  if (attackType !== "attack" && attackType !== "magic") {
    throw new RangeError("공격 계열은 공격력 또는 마력이어야 합니다.");
  }
  return { direct, targetToDamagePercent: direct ? directTarget : null };
}

export function calculateArmorAddOption({
  tables,
  itemLevel,
  boss = true,
  target,
  mainStat,
  subStat,
  attackType,
  statEquivalence,
  addOptionEquivalence,
  targetToDamagePercent,
}) {
  const validated = validateCommonOptions({
    itemLevel,
    statEquivalence,
    addOptionEquivalence,
    targetToDamagePercent,
    attackType,
  });
  if (!Number.isFinite(target) || target <= 0) {
    throw new RangeError("목표 급은 0보다 커야 합니다.");
  }

  // 목표는 주스탯 급(단순 수치)이므로 내부 환산 단위인 %급으로 바꾼다.
  const targetScore = target * (validated.direct
    ? validated.targetToDamagePercent
    : statEquivalence.flatMainStatToPercent);
  const pool = buildAddOptionPool({ weapon: false, itemLevel });
  const scorer = createAddOptionScorer({
    itemLevel,
    mainStat,
    subStat,
    attackType,
    statEquivalence,
    addOptionEquivalence: validated.direct,
  });

  const sources = Object.entries(ADD_OPTION_SOURCES).map(([key, source]) => {
    const distribution = targetDistribution({
      pool,
      scorer,
      stages: stageEntries(tables.stages[key], boss),
      counts: countEntries(tables.counts[key], boss),
      target: targetScore,
    });
    const attempts = expectedAttempts(distribution.probability);
    return {
      key,
      label: source.label,
      ...distribution,
      expectedAttempts: attempts,
      expectedMeso: sourceMeso(key, attempts),
    };
  });

  return {
    mode: "armor",
    official: tables.official !== false,
    itemLevel,
    boss,
    target,
    mainStat,
    subStat,
    attackType,
    poolSize: pool.length,
    sources,
  };
}

/**
 * 공·마 추 등급을 한 가지로 확정할 수 없는 무기도 현재 전체 추옵 점수와
 * 같거나 높은 모든 조합을 계산한다. 아케인셰이드처럼 공·마 추옵 없이
 * 주스탯·보공·데미지만 붙은 무기의 기댓값도 이 경로로 구할 수 있다.
 */
export function calculateWeaponScoreAddOption({
  tables,
  itemLevel,
  boss = true,
  target,
  mainStat,
  subStat,
  attackType,
  statEquivalence,
  addOptionEquivalence,
  targetToDamagePercent,
}) {
  const validated = validateCommonOptions({
    itemLevel,
    statEquivalence,
    addOptionEquivalence,
    targetToDamagePercent,
    attackType,
  });
  if (!Number.isFinite(target) || target <= 0) {
    throw new RangeError("목표 급은 0보다 커야 합니다.");
  }
  const targetScore = target * (validated.direct
    ? validated.targetToDamagePercent
    : statEquivalence.flatMainStatToPercent);
  const pool = buildAddOptionPool({ weapon: true, itemLevel });
  const scorer = createAddOptionScorer({
    itemLevel,
    mainStat,
    subStat,
    attackType,
    statEquivalence,
    addOptionEquivalence: validated.direct,
  });
  const sources = Object.entries(ADD_OPTION_SOURCES).map(([key, source]) => {
    const distribution = targetDistribution({
      pool,
      scorer,
      stages: stageEntries(tables.stages[key], boss),
      counts: countEntries(tables.counts[key], boss),
      target: targetScore,
    });
    const attempts = expectedAttempts(distribution.probability);
    return {
      key,
      label: source.label,
      ...distribution,
      expectedAttempts: attempts,
      expectedMeso: sourceMeso(key, attempts),
    };
  });
  return {
    mode: "weapon-score",
    official: tables.official !== false,
    itemLevel,
    boss,
    target,
    mainStat,
    subStat,
    attackType,
    poolSize: pool.length,
    sources,
  };
}

/**
 * 무기의 추 등급은 공격력/마력 추가옵션의 단계로 정해진다.
 * 보스 무기는 3~7단계라 1추 = 7단계, 일반 무기는 1~5단계라 1추 = 5단계다.
 */
export function getWeaponTierStage(tier, boss) {
  return (boss ? ADD_OPTION_STAGE_COUNT + BOSS_STAGE_BONUS : ADD_OPTION_STAGE_COUNT) -
    tier +
    1;
}

export const WEAPON_TIERS = [1, 2];

/**
 * 무기 기본 공·마와 장비 레벨로 특정 단계의 실제 공·마 추옵을 계산한다.
 * 게임과 동일하게 마지막에 올림하며, 부동소수점 경계 오차만 제거한다.
 */
export function getWeaponAddOptionAttack({
  baseAttack,
  itemLevel,
  stage,
  boss = true,
}) {
  if (!Number.isFinite(baseAttack) || baseAttack <= 0) {
    throw new RangeError("무기 기본 공·마는 0보다 커야 합니다.");
  }
  if (!Number.isInteger(itemLevel) || itemLevel < 0 || itemLevel > 250) {
    throw new RangeError("장비 레벨은 0~250 사이로 입력해 주세요.");
  }
  const multipliers = boss
    ? BOSS_WEAPON_ATTACK_MULTIPLIERS
    : NORMAL_WEAPON_ATTACK_MULTIPLIERS;
  const multiplier = multipliers[stage];
  if (!Number.isFinite(multiplier) || multiplier <= 0) {
    throw new RangeError("무기 추옵 단계를 계산할 수 없습니다.");
  }
  const levelMultiplier = Math.floor(itemLevel / 40) + 1;
  return Math.ceil(baseAttack * levelMultiplier * multiplier / 100 - 1e-9);
}

/**
 * 현재 무기의 공·마 추옵과 나머지 추옵을 한 환산축으로 합친 뒤, 그 값 이상인
 * 모든 결과를 성공으로 센다. 특정 N추를 고정하지 않으므로 더 높은 추에 낮은
 * 부가 옵션, 더 낮은 추에 높은 부가 옵션도 동급 이상이면 함께 포함된다.
 */
export function calculateWeaponEquivalentAddOption({
  tables,
  itemLevel,
  boss = true,
  tier,
  damagePercent = 0,
  baseAttack,
  mainStat,
  subStat,
  attackType,
  statEquivalence,
  addOptionEquivalence,
  targetToDamagePercent,
}) {
  const validated = validateCommonOptions({
    itemLevel,
    statEquivalence,
    addOptionEquivalence,
    targetToDamagePercent,
    attackType,
  });
  if (!Number.isInteger(tier) || tier < 1 || tier > ADD_OPTION_STAGE_COUNT) {
    throw new RangeError("무기 추 등급은 1추부터 5추 사이여야 합니다.");
  }
  if (!Number.isFinite(damagePercent) || damagePercent < 0) {
    throw new RangeError("보스총데미지 %급 목표는 0 이상이어야 합니다.");
  }
  if (!validated.direct && !statEquivalence.bossDamageToMainPercent) {
    throw new Error(
      "개인 환산값에 데미지 환산이 없습니다. `/환산 캐릭터:본캐`를 다시 실행해 주세요.",
    );
  }

  const stage = getWeaponTierStage(tier, boss);
  const attackCoefficient = validated.direct
    ? validated.direct.flatAttackToDamagePercent
    : statEquivalence.attackToMainStat * statEquivalence.flatMainStatToPercent;
  const damageCoefficient = validated.direct
    ? validated.direct.bossDamageToDamagePercent
    : statEquivalence.bossDamageToMainPercent;
  const currentAttack = getWeaponAddOptionAttack({
    baseAttack,
    itemLevel,
    stage,
    boss,
  });
  const target = currentAttack * attackCoefficient +
    damagePercent * damageCoefficient;
  const pool = buildAddOptionPool({ weapon: true, itemLevel });
  const baseScorer = createAddOptionScorer({
    itemLevel,
    mainStat,
    subStat,
    attackType,
    statEquivalence,
    addOptionEquivalence: validated.direct,
  });
  const scorer = (option, optionStage) => {
    if (option.kind === "attack" && option.attackType === attackType) {
      return getWeaponAddOptionAttack({
        baseAttack,
        itemLevel,
        stage: optionStage,
        boss,
      }) * attackCoefficient;
    }
    return baseScorer(option, optionStage);
  };

  const sources = Object.entries(ADD_OPTION_SOURCES).map(([key, source]) => {
    const distribution = targetDistribution({
      pool,
      scorer,
      stages: stageEntries(tables.stages[key], boss),
      counts: countEntries(tables.counts[key], boss),
      target,
    });
    const attempts = expectedAttempts(distribution.probability);
    return {
      key,
      label: source.label,
      ...distribution,
      expectedAttempts: attempts,
      expectedMeso: sourceMeso(key, attempts),
    };
  });

  return {
    mode: "weapon-equivalent",
    official: tables.official !== false,
    itemLevel,
    boss,
    tier,
    stage,
    baseAttack,
    currentAttack,
    damagePercent,
    target,
    mainStat,
    subStat,
    attackType,
    poolSize: pool.length,
    sources,
  };
}

/**
 * 무기는 공격력/마력 추가옵션의 단계가 곧 추 등급이다. 커뮤니티 표기와 같이
 * "1추 + 보총뎀 N%급"을 목표로 삼아, 공/마가 고른 추로 뜨면서 나머지 칸이
 * 목표 %급을 함께 채울 확률을 계산한다. 목표가 0이면 순수 N추 확률이 된다.
 */
export function calculateWeaponAddOption({
  tables,
  itemLevel,
  boss = true,
  tier,
  damagePercent = 0,
  mainStat,
  subStat,
  attackType,
  statEquivalence,
  addOptionEquivalence,
  targetToDamagePercent,
}) {
  const validated = validateCommonOptions({
    itemLevel,
    statEquivalence,
    addOptionEquivalence,
    targetToDamagePercent,
    attackType,
  });
  if (!WEAPON_TIERS.includes(tier)) {
    throw new RangeError("무기 추 등급은 1추 또는 2추만 계산할 수 있습니다.");
  }
  if (!Number.isFinite(damagePercent) || damagePercent < 0) {
    throw new RangeError("보스총데미지 %급 목표는 0 이상이어야 합니다.");
  }
  if (!validated.direct && !statEquivalence.bossDamageToMainPercent) {
    throw new Error(
      "개인 환산값에 데미지 환산이 없습니다. `/환산 캐릭터:본캐`를 다시 실행해 주세요.",
    );
  }

  // 보총뎀 %급 목표를 개인 환산 주스탯 %급으로 바꾼다.
  const target = damagePercent * (validated.direct
    ? validated.direct.bossDamageToDamagePercent
    : statEquivalence.bossDamageToMainPercent);
  const pool = buildAddOptionPool({ weapon: true, itemLevel });
  const scorer = createAddOptionScorer({
    itemLevel,
    mainStat,
    subStat,
    attackType,
    statEquivalence,
    addOptionEquivalence: validated.direct,
  });
  const attackOption = pool.find(
    (option) => option.kind === "attack" && option.attackType === attackType,
  );
  const nonAttackScorer = (option, optionStage) =>
    option === attackOption ? 0 : scorer(option, optionStage);
  const stage = getWeaponTierStage(tier, boss);

  const sources = Object.entries(ADD_OPTION_SOURCES).map(([key, source]) => {
    const stages = stageEntries(tables.stages[key], boss);
    const counts = countEntries(tables.counts[key], boss);
    const distribution = attackOption
      ? targetDistribution({
          pool,
          scorer: nonAttackScorer,
          stages,
          counts,
          target,
          requiredOption: attackOption,
          requiredStage: stage,
        })
      : { probability: 0, rawProbability: 0, sameResultExcluded: true };
    const attempts = expectedAttempts(distribution.probability);
    return {
      key,
      label: source.label,
      ...distribution,
      expectedAttempts: attempts,
      expectedMeso: sourceMeso(key, attempts),
    };
  });

  return {
    mode: "weapon",
    official: tables.official !== false,
    itemLevel,
    boss,
    tier,
    stage,
    damagePercent,
    mainStat,
    subStat,
    attackType,
    poolSize: pool.length,
    sources,
  };
}
