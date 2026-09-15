/* 주문서 강화(작) 기대값.

   주문서는 "무엇을 바르느냐"보다 "실패했을 때 어떻게 되돌리느냐"가 비용을
   가른다. 그래서 계산도 둘로 나뉜다.

   1) 주문의 흔적·귀지처럼 실패하면 업그레이드 횟수가 깎이는 작
      순백으로 횟수를 되살릴지, 이노센트로 처음부터 다시 할지를 골라야 한다.
      상태를 (성공한 작, 남은 횟수)로 두고 정책 반복과 정확한 선형계 풀이로
      최적 선택을 찾는다.

   2) 리턴 스크롤을 쓰는 놀긍작
      실패해도 횟수가 깎이지 않는 대신 리턴 스크롤 값이 든다. 목표 수치가
      나올 때까지 굴리는 것이므로 기하분포로 바로 풀린다. */

// 주문의 흔적 기본 성공 확률(%)과 피버타임 확률(%).
export const TRACE_RATES = {
  15: { base: 15, fever: 25 },
  30: { base: 30, fever: 45 },
  70: { base: 70, fever: 95 },
  100: { base: 100, fever: 100 },
};

// 손재주 만렙(100레벨)과 길드 스킬은 확률을 더해 준다.
export const DEXTERITY_BONUS = 10;
export const DEXTERITY_MAX_LEVEL = 100;
export const GUILD_BONUS = 4;

/**
 * 주문의 흔적 성공 확률. 0~1 로 돌려준다.
 * 100% 주문서는 보정을 더해도 100%를 넘지 않는다.
 *
 * 손재주는 만렙이면 10%p를 더한다. 레벨을 숫자로 넘기면
 * 5레벨당 0.5%p씩 더한다.
 */
export function traceSuccessRate(
  rate,
  { fever = false, dexterity = false, guild = false } = {},
) {
  const table = TRACE_RATES[rate];
  if (!table) throw new RangeError("지원하지 않는 주문의 흔적 확률입니다.");
  /* 손재주는 5레벨당 0.5%p씩 붙는다. 5레벨 단위로만 올라가므로
     중간 레벨은 아래 5배수로 내려서 셈한다. */
  const dexterityBonus =
    typeof dexterity === "number"
      ? Math.floor(
          Math.min(DEXTERITY_MAX_LEVEL, Math.max(0, dexterity)) / 5,
        ) * 0.5
      : dexterity
        ? DEXTERITY_BONUS
        : 0;
  const percent =
    (fever ? table.fever : table.base) + dexterityBonus + (guild ? GUILD_BONUS : 0);
  return Math.min(100, percent) / 100;
}

/* 놀라운 긍정의 혼돈 주문서가 성공했을 때 오르는 수치의 분포.
   +5 가 없는 것은 실제 표가 그렇기 때문이다. */
export const AMAZING_POSITIVE_CHAOS = [
  { value: 6, chance: 0.059324 },
  { value: 4, chance: 0.049438 },
  { value: 3, chance: 0.138661 },
  { value: 2, chance: 0.238669 },
  { value: 1, chance: 0.330081 },
  { value: 0, chance: 0.183827 },
];

// 놀긍혼은 60%와 100% 두 가지가 돈다.
export const CHAOS_RATES = [60, 100];

/** 한 번 성공했을 때 오르는 평균 수치. */
export function chaosMean(distribution = AMAZING_POSITIVE_CHAOS) {
  return distribution.reduce(
    (total, { value, chance }) => total + value * chance,
    0,
  );
}

/** 목표 이상이 뜰 확률. */
export function chaosAtLeast(target, distribution = AMAZING_POSITIVE_CHAOS) {
  return distribution.reduce(
    (total, { value, chance }) => total + (value >= target ? chance : 0),
    0,
  );
}

/** 스탯 여러 개가 각각 굴러 합계가 목표 이상일 확률. 제논은 세 개를 본다. */
export function chaosSumAtLeast(
  target,
  statCount = 1,
  distribution = AMAZING_POSITIVE_CHAOS,
) {
  if (target <= 0) return 1;
  // 스탯 하나씩 겹쳐 가며 합계 분포를 만든다.
  let sums = new Map([[0, 1]]);
  for (let i = 0; i < statCount; i += 1) {
    const next = new Map();
    for (const [sum, chance] of sums) {
      for (const roll of distribution) {
        const key = sum + roll.value;
        next.set(key, (next.get(key) ?? 0) + chance * roll.chance);
      }
    }
    sums = next;
  }
  let total = 0;
  for (const [sum, chance] of sums) if (sum >= target) total += chance;
  return total;
}

const MAX_CHAOS_STATS = 4;
const CHAOS_EPSILON = 1e-12;

function assertChaosRate(chaosRate) {
  if (!CHAOS_RATES.includes(chaosRate)) {
    throw new RangeError("놀긍혼은 60% 또는 100%만 있습니다.");
  }
}

function assertStatCount(statCount) {
  if (!Number.isInteger(statCount) || statCount < 0 || statCount > MAX_CHAOS_STATS) {
    throw new RangeError("함께 판정할 스탯 개수는 0~4 사이여야 합니다.");
  }
}

function assertNonNegative(value, name, { integer = false } = {}) {
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new RangeError(`${name}은 0 이상${integer ? "의 정수" : ""}여야 합니다.`);
  }
}

/** 선택한 스탯들의 놀긍 상승량 합계 분포. */
export function chaosStatSumDistribution(
  statCount = 1,
  distribution = AMAZING_POSITIVE_CHAOS,
) {
  assertStatCount(statCount);
  let sums = new Map([[0, 1]]);
  for (let i = 0; i < statCount; i += 1) {
    const next = new Map();
    for (const [sum, chance] of sums) {
      for (const roll of distribution) {
        const value = sum + roll.value;
        next.set(value, (next.get(value) ?? 0) + chance * roll.chance);
      }
    }
    sums = next;
  }
  return [...sums.entries()]
    .map(([value, chance]) => ({ value, chance }))
    .sort((a, b) => a.value - b.value);
}

/** 놀긍이 성공했을 때의 공·마와 선택 스탯 합계의 공동 분포. */
export function chaosOutcomeDistribution(
  statCount = 1,
  distribution = AMAZING_POSITIVE_CHAOS,
) {
  const stats = chaosStatSumDistribution(statCount, distribution);
  return distribution.flatMap((attack) =>
    stats.map((stat) => ({
      attack: attack.value,
      stat: stat.value,
      chance: attack.chance * stat.chance,
    })),
  );
}

function targetChaosOutcomes({ attackTarget, statTarget, statCount }) {
  assertNonNegative(attackTarget, "목표 공·마");
  assertNonNegative(statTarget, "목표 스탯 합");
  assertStatCount(statCount);
  const outcomes = chaosOutcomeDistribution(statCount).filter(
    (outcome) => outcome.attack >= attackTarget && outcome.stat >= statTarget,
  );
  const chance = outcomes.reduce((total, outcome) => total + outcome.chance, 0);
  if (!(chance > 0)) throw new RangeError("이 놀긍 목표는 나올 수 없습니다.");
  return { outcomes, chance };
}

const ACTIONS = { scroll: "주문서", clean: "순백", innocent: "이노센트" };

const SLOT_POLICY_EPSILON = 1e-10;
const SLOT_POLICY_MAX_ITERATIONS = 100;

function slotKey(success, remaining) {
  return `${success}:${remaining}`;
}

function slotTransitions({
  action,
  success,
  remaining,
  slots,
  target,
  successRate,
  slotProtectionRate,
}) {
  const transitions = new Map();
  const add = (nextSuccess, nextRemaining, chance) => {
    if (!(chance > 0) || nextSuccess >= target) return;
    const key = slotKey(nextSuccess, nextRemaining);
    transitions.set(key, (transitions.get(key) ?? 0) + chance);
  };

  if (action === ACTIONS.scroll) {
    const failureRate = 1 - successRate;
    add(success + 1, remaining - 1, successRate);
    add(success, remaining - 1, failureRate * (1 - slotProtectionRate));
    add(success, remaining, failureRate * slotProtectionRate);
  } else if (action === ACTIONS.clean) {
    add(success, remaining + 1, 1);
  } else if (action === ACTIONS.innocent) {
    add(0, slots, 1);
  }
  return transitions;
}

/* 같은 정책에서 비용·행동 횟수·재고 사용량을 여러 번 풀기 때문에 행렬을
   한 번 LU 분해한 뒤 우변만 바꿔 재사용한다. 상태 수는 최대 230개다. */
function factorLinearSystem(matrix) {
  const lu = matrix.map((row) => [...row]);
  const pivots = new Array(lu.length);
  for (let column = 0; column < lu.length; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < lu.length; row += 1) {
      if (Math.abs(lu[row][column]) > Math.abs(lu[pivot][column])) pivot = row;
    }
    if (Math.abs(lu[pivot][column]) < 1e-14) {
      throw new RangeError("주문서 전략의 기대값을 계산할 수 없습니다.");
    }
    pivots[column] = pivot;
    [lu[column], lu[pivot]] = [lu[pivot], lu[column]];
    for (let row = column + 1; row < lu.length; row += 1) {
      lu[row][column] /= lu[column][column];
      for (let next = column + 1; next < lu.length; next += 1) {
        lu[row][next] -= lu[row][column] * lu[column][next];
      }
    }
  }
  return { lu, pivots };
}

function solveFactoredSystem({ lu, pivots }, rightHandSide) {
  const solved = [...rightHandSide];
  for (let column = 0; column < lu.length; column += 1) {
    const pivot = pivots[column];
    [solved[column], solved[pivot]] = [solved[pivot], solved[column]];
  }
  for (let row = 0; row < lu.length; row += 1) {
    for (let column = 0; column < row; column += 1) {
      solved[row] -= lu[row][column] * solved[column];
    }
  }
  for (let row = lu.length - 1; row >= 0; row -= 1) {
    for (let column = row + 1; column < lu.length; column += 1) {
      solved[row] -= lu[row][column] * solved[column];
    }
    solved[row] /= lu[row][row];
  }
  return solved;
}

function normalizeStock(stock, name) {
  const picked = Number(stock ?? 0);
  if (!Number.isInteger(picked) || picked < 0) {
    throw new RangeError(`${name}은 0 이상의 정수여야 합니다.`);
  }
  return picked;
}

function normalizeStockDistribution(distribution, fallbackStock) {
  if (distribution == null) return [{ stock: fallbackStock, chance: 1 }];
  if (!Array.isArray(distribution) || distribution.length === 0) {
    throw new RangeError("이노센트 보유량 분포는 비어 있지 않은 배열이어야 합니다.");
  }
  const combined = new Map();
  let total = 0;
  for (const entry of distribution) {
    const stock = normalizeStock(entry?.stock, "이노센트 보유량");
    const chance = Number(entry?.chance);
    if (!Number.isFinite(chance) || chance < 0) {
      throw new RangeError("이노센트 보유량 확률은 0 이상이어야 합니다.");
    }
    combined.set(stock, (combined.get(stock) ?? 0) + chance);
    total += chance;
  }
  if (!(total > 0) || Math.abs(total - 1) > 1e-9) {
    throw new RangeError("이노센트 보유량 확률의 합은 1이어야 합니다.");
  }
  return [...combined.entries()].map(([stock, chance]) => ({
    stock,
    chance: chance / total,
  }));
}

/**
 * 실패하면 횟수가 깎이는 작의 기대비용.
 *
 * 상태는 (성공한 작 수, 남은 업그레이드 횟수)이고, 각 상태에서 고를 수 있는
 * 것은 셋이다. 주문서를 바르거나, 순백으로 횟수를 되살리거나, 이노센트로
 * 처음부터 다시 하거나. 이노센트가 처음 상태로 돌아가므로 값이 서로를
 * 참조한다. 완작 가능한 정책만 유지하며 정책을 개선하고, 각 정책의 기대값은
 * 선형 연립방정식으로 정확히 푼다. 보유 순백·이노센트 합계가 20장 이하면
 * 재고까지 상태에 넣어 행동 변화와 실제 유료 사용량을 함께 최적화한다.
 */
export function calculateSlotCraft({
  slots,
  successRate,
  scrollCost,
  cleanCost,
  innocentCost = Number.POSITIVE_INFINITY,
  target = slots,
  startSuccess = 0,
  startRemaining = slots,
  slotProtectionRate = 0,
  rounds: _legacyRounds = 300,
  cleanStock = 0,
  innocentStock = 0,
  innocentStockDistribution = null,
}) {
  if (!Number.isInteger(slots) || slots < 1 || slots > 20) {
    throw new RangeError("업그레이드 가능 횟수는 1~20 사이여야 합니다.");
  }
  if (!(successRate > 0) || successRate > 1) {
    throw new RangeError("성공 확률은 0보다 크고 1 이하여야 합니다.");
  }
  if (target > slots) {
    throw new RangeError("목표 작 수가 업그레이드 가능 횟수보다 많습니다.");
  }
  if (!(slotProtectionRate >= 0 && slotProtectionRate <= 0.04)) {
    throw new RangeError("업그레이드 횟수 보호 확률은 0~0.04 사이여야 합니다.");
  }

  if (!Number.isInteger(startSuccess) || !Number.isInteger(startRemaining) ||
      startSuccess < 0 || startRemaining < 0 ||
      startSuccess > target || startRemaining > slots - startSuccess) {
    throw new RangeError("현재 성공 수와 잔여 횟수가 장비 상태와 맞지 않습니다.");
  }
  if (![scrollCost, cleanCost].every((cost) => Number.isFinite(cost) && cost >= 0) ||
      !(Number.isFinite(innocentCost) || innocentCost === Number.POSITIVE_INFINITY) ||
      innocentCost < 0) {
    throw new RangeError("주문서 비용은 0 이상이어야 합니다.");
  }

  const pickedCleanStock = normalizeStock(cleanStock, "순백 보유량");
  const pickedInnocentStock = normalizeStock(innocentStock, "이노센트 보유량");
  const pickedInnocentDistribution = normalizeStockDistribution(
    innocentStockDistribution,
    pickedInnocentStock,
  );

  const states = [];
  for (let success = 0; success < target; success += 1) {
    for (let remaining = 0; remaining <= slots - success; remaining += 1) {
      states.push([success, remaining]);
    }
  }
  const stateIndex = new Map(
    states.map(([success, remaining], index) => [slotKey(success, remaining), index]),
  );
  const startIndex = stateIndex.get(slotKey(startSuccess, startRemaining));

  const actionsAt = (success, remaining) => {
    const actions = [];
    if (remaining > 0) actions.push(ACTIONS.scroll);
    if (remaining < slots - success) actions.push(ACTIONS.clean);
    if ((success > 0 || remaining < slots) && Number.isFinite(innocentCost)) {
      actions.push(ACTIONS.innocent);
    }
    return actions;
  };
  const actionCost = (action) =>
    action === ACTIONS.scroll
      ? scrollCost
      : action === ACTIONS.clean
        ? cleanCost
        : innocentCost;
  const transitionsAt = (action, success, remaining) =>
    slotTransitions({
      action,
      success,
      remaining,
      slots,
      target,
      successRate,
      slotProtectionRate,
    });

  const policy = new Map();
  for (const [success, remaining] of states) {
    const actions = actionsAt(success, remaining);
    if (!actions.length) {
      throw new RangeError("완작까지 이어지는 복구 또는 초기화 수단이 필요합니다.");
    }
    /* 주문서→순백만 쓰는 정책은 항상 완작에 도달하므로 정확한 정책 평가를
       시작할 수 있는 안전한 초기값이다. */
    policy.set(
      slotKey(success, remaining),
      actions.includes(ACTIONS.scroll) ? ACTIONS.scroll : actions[0],
    );
  }

  const policySystem = (pickedPolicy) => {
    const matrix = states.map(() => new Array(states.length).fill(0));
    states.forEach(([success, remaining], row) => {
      matrix[row][row] = 1;
      const action = pickedPolicy.get(slotKey(success, remaining));
      for (const [next, chance] of transitionsAt(action, success, remaining)) {
        matrix[row][stateIndex.get(next)] -= chance;
      }
    });
    return factorLinearSystem(matrix);
  };

  const solvePolicyReward = (factor, reward, pickedPolicy = policy) =>
    solveFactoredSystem(
      factor,
      states.map(([success, remaining]) =>
        reward(pickedPolicy.get(slotKey(success, remaining)), success, remaining)),
    );

  const policyIsProper = (pickedPolicy) => {
    const reverse = states.map(() => []);
    const reachesTerminal = [];
    states.forEach(([success, remaining], row) => {
      const transitions = transitionsAt(
        pickedPolicy.get(slotKey(success, remaining)),
        success,
        remaining,
      );
      let nonTerminalChance = 0;
      for (const [next, chance] of transitions) {
        const nextIndex = stateIndex.get(next);
        reverse[nextIndex].push(row);
        nonTerminalChance += chance;
      }
      if (nonTerminalChance < 1 - 1e-14) reachesTerminal.push(row);
    });
    const proper = new Set(reachesTerminal);
    const queue = [...reachesTerminal];
    while (queue.length) {
      const next = queue.pop();
      for (const previous of reverse[next]) {
        if (proper.has(previous)) continue;
        proper.add(previous);
        queue.push(previous);
      }
    }
    return proper.size === states.length;
  };

  let factor;
  let values;
  for (let iteration = 0; iteration < SLOT_POLICY_MAX_ITERATIONS * states.length; iteration += 1) {
    factor = policySystem(policy);
    values = solvePolicyReward(factor, (action) => actionCost(action));
    const possibleChanges = [];
    for (const [success, remaining] of states) {
      const key = slotKey(success, remaining);
      const currentAction = policy.get(key);
      const optionValue = (action) => {
        let value = actionCost(action);
        for (const [next, chance] of transitionsAt(action, success, remaining)) {
          value += chance * values[stateIndex.get(next)];
        }
        return value;
      };
      const currentValue = optionValue(currentAction);
      let bestAction = currentAction;
      let bestValue = currentValue;
      for (const action of actionsAt(success, remaining)) {
        const candidate = optionValue(action);
        const tolerance = SLOT_POLICY_EPSILON * Math.max(1, Math.abs(bestValue), Math.abs(candidate));
        if (candidate < bestValue - tolerance) {
          bestAction = action;
          bestValue = candidate;
        }
      }
      if (bestAction !== currentAction) {
        const gain = currentValue - bestValue;
        possibleChanges.push({ key, action: bestAction, currentAction, gain });
      }
    }
    possibleChanges.sort((left, right) => right.gain - left.gain);
    if (!possibleChanges.length) break;

    /* 보통은 모든 greedy 개선을 한꺼번에 적용하면 Howard 정책 반복처럼
       수렴 횟수가 크게 줄어든다. 드물게 그 조합이 복구↔초기화만 오가는
       비정상 순환을 만들 때만 되돌리고, 가장 큰 proper 개선 하나를 고른다. */
    for (const candidate of possibleChanges) {
      policy.set(candidate.key, candidate.action);
    }
    if (!policyIsProper(policy)) {
      for (const candidate of possibleChanges) {
        policy.set(candidate.key, candidate.currentAction);
      }
      let changed = false;
      for (const candidate of possibleChanges) {
        policy.set(candidate.key, candidate.action);
        if (policyIsProper(policy)) {
          changed = true;
          break;
        }
        policy.set(candidate.key, candidate.currentAction);
      }
      if (!changed) break;
    }
    if (iteration === SLOT_POLICY_MAX_ITERATIONS * states.length - 1) {
      throw new RangeError("최적 주문서 전략이 수렴하지 않았습니다.");
    }
  }
  factor = policySystem(policy);
  values = solvePolicyReward(factor, (action) => actionCost(action));
  const baseExpectedCost = values[startIndex] ?? 0;

  const actionCountValues = new Map(
    Object.values(ACTIONS).map((wanted) => [
      wanted,
      solvePolicyReward(factor, (action) => Number(action === wanted)),
    ]),
  );
  const countAction = (wanted) => actionCountValues.get(wanted)?.[startIndex] ?? 0;
  const totalCleans = countAction(ACTIONS.clean);
  const totalInnocents = countAction(ACTIONS.innocent);

  /* 재고 S장의 정확한 평균 사용량은 min(E[N], S)가 아니라 E[min(N, S)]다.
     P(N>=1)+...+P(N>=S)로 바꿔, 같은 고정 정책에서 각 확률을 정확히 푼다. */
  const ownedActionCurve = (wanted, maximumStock, pickedPolicy = policy) => {
    const curve = new Array(maximumStock + 1).fill(0);
    if (maximumStock === 0 || ![...pickedPolicy.values()].includes(wanted)) return curve;
    const matrix = states.map(() => new Array(states.length).fill(0));
    states.forEach(([success, remaining], row) => {
      matrix[row][row] = 1;
      const action = pickedPolicy.get(slotKey(success, remaining));
      if (action === wanted) return;
      for (const [next, chance] of transitionsAt(action, success, remaining)) {
        matrix[row][stateIndex.get(next)] -= chance;
      }
    });
    const cappedFactor = factorLinearSystem(matrix);
    let previous = new Array(states.length).fill(1);
    let total = 0;
    for (let count = 1; count <= maximumStock; count += 1) {
      const rhs = states.map(([success, remaining]) => {
        const action = pickedPolicy.get(slotKey(success, remaining));
        if (action !== wanted) return 0;
        let chance = 0;
        for (const [next, probability] of transitionsAt(action, success, remaining)) {
          chance += probability * previous[stateIndex.get(next)];
        }
        return chance;
      });
      const current = solveFactoredSystem(cappedFactor, rhs).map((chance) =>
        Math.max(0, Math.min(1, chance)),
      );
      const reached = current[startIndex] ?? 0;
      total += reached;
      curve[count] = total;
      previous = current;
      if (reached < 1e-13) {
        for (let rest = count + 1; rest <= maximumStock; rest += 1) curve[rest] = total;
        break;
      }
    }
    return curve;
  };

  const cleanOwnedCurve = ownedActionCurve(ACTIONS.clean, pickedCleanStock);
  const maximumInnocentStock = Math.max(
    0,
    ...pickedInnocentDistribution.map(({ stock }) => stock),
  );
  const innocentOwnedCurve = ownedActionCurve(ACTIONS.innocent, maximumInnocentStock);
  const fixedOwnedCleans = cleanOwnedCurve[pickedCleanStock] ?? 0;
  const fixedOwnedInnocents = pickedInnocentDistribution.reduce(
    (total, { stock, chance }) => total + chance * (innocentOwnedCurve[stock] ?? 0),
    0,
  );
  let ownedCleans = fixedOwnedCleans;
  let ownedInnocents = fixedOwnedInnocents;
  let expectedCost =
    baseExpectedCost -
    fixedOwnedCleans * cleanCost -
    (fixedOwnedInnocents > 0 ? fixedOwnedInnocents * innocentCost : 0);
  let expected = {
    scrolls: countAction(ACTIONS.scroll),
    cleans: totalCleans,
    innocents: totalInnocents,
    ownedCleans: fixedOwnedCleans,
    paidCleans: Math.max(0, totalCleans - fixedOwnedCleans),
    ownedInnocents: fixedOwnedInnocents,
    paidInnocents: Math.max(0, totalInnocents - fixedOwnedInnocents),
  };
  let inventoryPolicy = "fixed-no-stock-policy";
  let displayedPolicy = policy;
  let displayedValues = values;

  /* 작은 재고는 (성공, 잔여, 순백 재고, 이노 재고)를 모두 상태로 본다.
     재고를 쓴 행동은 한 단계 작은 재고층으로만 이동하므로, 낮은 층부터
     정책 반복을 풀면 거대한 단일 행렬 없이도 재고에 맞춘 최적 정책이 된다. */
  // 재고가 한 종류만 많은 경우까지 합계 20개에서 잘라 근사하는 것은
  // 불필요하게 정확도를 버린다. 실제 계산량을 결정하는 재고 층의 개수로
  // 판단해 100개 단일 재고나 30/30 혼합 재고도 정확하게 푼다.
  const STOCK_AWARE_EXACT_LAYER_BUDGET = 4_096;
  const stockLayerCount =
    (pickedCleanStock + 1) * (maximumInnocentStock + 1);
  if (stockLayerCount <= STOCK_AWARE_EXACT_LAYER_BUDGET &&
      (pickedCleanStock > 0 || maximumInnocentStock > 0)) {
    const metricNames = [
      "cost",
      "scrolls",
      "cleans",
      "innocents",
      "ownedCleans",
      "ownedInnocents",
    ];
    const layers = Array.from(
      { length: pickedCleanStock + 1 },
      () => new Array(maximumInnocentStock + 1),
    );
    layers[0][0] = {
      policy: new Map(policy),
      metrics: {
        cost: values,
        scrolls: actionCountValues.get(ACTIONS.scroll),
        cleans: actionCountValues.get(ACTIONS.clean),
        innocents: actionCountValues.get(ACTIONS.innocent),
        ownedCleans: new Array(states.length).fill(0),
        ownedInnocents: new Array(states.length).fill(0),
      },
    };
    const inventoryFactorCache = new Map();

    const solveInventoryLayer = (cleanRemaining, innocentRemaining) => {
      const initialLayer = cleanRemaining > 0
        ? layers[cleanRemaining - 1][innocentRemaining]
        : layers[cleanRemaining][innocentRemaining - 1];
      const layerPolicy = new Map(initialLayer.policy);

      const actionDetails = (action, success, remaining) => {
        const immediate = Object.fromEntries(metricNames.map((name) => [name, 0]));
        const within = new Map();
        let lower = null;
        if (action === ACTIONS.scroll) {
          immediate.cost = scrollCost;
          immediate.scrolls = 1;
          for (const [next, chance] of transitionsAt(action, success, remaining)) {
            within.set(next, chance);
          }
        } else if (action === ACTIONS.clean) {
          immediate.cleans = 1;
          if (cleanRemaining > 0) {
            immediate.ownedCleans = 1;
            lower = {
              layer: layers[cleanRemaining - 1][innocentRemaining],
              index: stateIndex.get(slotKey(success, remaining + 1)),
            };
          } else {
            immediate.cost = cleanCost;
            within.set(slotKey(success, remaining + 1), 1);
          }
        } else {
          immediate.innocents = 1;
          if (innocentRemaining > 0) {
            immediate.ownedInnocents = 1;
            lower = {
              layer: layers[cleanRemaining][innocentRemaining - 1],
              index: stateIndex.get(slotKey(0, slots)),
            };
          } else {
            immediate.cost = innocentCost;
            within.set(slotKey(0, slots), 1);
          }
        }
        return { immediate, within, lower };
      };

      const layerSystem = (pickedPolicy) => {
        const signature = `${Number(cleanRemaining > 0)}:${Number(innocentRemaining > 0)}:` +
          states.map(([success, remaining]) =>
            pickedPolicy.get(slotKey(success, remaining))).join("|");
        const cached = inventoryFactorCache.get(signature);
        if (cached) return cached;
        const matrix = states.map(() => new Array(states.length).fill(0));
        states.forEach(([success, remaining], row) => {
          matrix[row][row] = 1;
          const details = actionDetails(
            pickedPolicy.get(slotKey(success, remaining)),
            success,
            remaining,
          );
          for (const [next, chance] of details.within) {
            matrix[row][stateIndex.get(next)] -= chance;
          }
        });
        const factored = factorLinearSystem(matrix);
        inventoryFactorCache.set(signature, factored);
        return factored;
      };

      const solveLayerMetric = (pickedPolicy, pickedFactor, metric) =>
        solveFactoredSystem(
          pickedFactor,
          states.map(([success, remaining]) => {
            const details = actionDetails(
              pickedPolicy.get(slotKey(success, remaining)),
              success,
              remaining,
            );
            return details.immediate[metric] +
              (details.lower ? details.lower.layer.metrics[metric][details.lower.index] : 0);
          }),
        );

      const layerPolicyIsProper = (pickedPolicy) => {
        const reverse = states.map(() => []);
        const escapes = [];
        states.forEach(([success, remaining], row) => {
          const details = actionDetails(
            pickedPolicy.get(slotKey(success, remaining)),
            success,
            remaining,
          );
          let withinChance = 0;
          for (const [next, chance] of details.within) {
            reverse[stateIndex.get(next)].push(row);
            withinChance += chance;
          }
          if (details.lower || withinChance < 1 - 1e-14) escapes.push(row);
        });
        const proper = new Set(escapes);
        const queue = [...escapes];
        while (queue.length) {
          const next = queue.pop();
          for (const previous of reverse[next]) {
            if (proper.has(previous)) continue;
            proper.add(previous);
            queue.push(previous);
          }
        }
        return proper.size === states.length;
      };

      let layerFactor;
      let layerCosts;
      for (let iteration = 0; iteration < SLOT_POLICY_MAX_ITERATIONS * states.length; iteration += 1) {
        layerFactor = layerSystem(layerPolicy);
        layerCosts = solveLayerMetric(layerPolicy, layerFactor, "cost");
        const changes = [];
        for (const [success, remaining] of states) {
          const key = slotKey(success, remaining);
          const currentAction = layerPolicy.get(key);
          const optionValue = (action) => {
            const details = actionDetails(action, success, remaining);
            let value = details.immediate.cost +
              (details.lower ? details.lower.layer.metrics.cost[details.lower.index] : 0);
            for (const [next, chance] of details.within) {
              value += chance * layerCosts[stateIndex.get(next)];
            }
            return value;
          };
          const currentValue = optionValue(currentAction);
          let bestAction = currentAction;
          let bestValue = currentValue;
          for (const action of actionsAt(success, remaining)) {
            const candidate = optionValue(action);
            const tolerance = SLOT_POLICY_EPSILON *
              Math.max(1, Math.abs(bestValue), Math.abs(candidate));
            if (candidate < bestValue - tolerance) {
              bestAction = action;
              bestValue = candidate;
            }
          }
          if (bestAction !== currentAction) {
            changes.push({
              key,
              action: bestAction,
              currentAction,
              gain: currentValue - bestValue,
            });
          }
        }
        if (!changes.length) break;
        changes.sort((left, right) => right.gain - left.gain);
        for (const change of changes) layerPolicy.set(change.key, change.action);
        if (!layerPolicyIsProper(layerPolicy)) {
          for (const change of changes) layerPolicy.set(change.key, change.currentAction);
          let changed = false;
          for (const change of changes) {
            layerPolicy.set(change.key, change.action);
            if (layerPolicyIsProper(layerPolicy)) {
              changed = true;
              break;
            }
            layerPolicy.set(change.key, change.currentAction);
          }
          if (!changed) break;
        }
        if (iteration === SLOT_POLICY_MAX_ITERATIONS * states.length - 1) {
          throw new RangeError("재고를 반영한 주문서 전략이 수렴하지 않았습니다.");
        }
      }
      layerFactor = layerSystem(layerPolicy);
      const metrics = Object.fromEntries(
        metricNames.map((metric) => [
          metric,
          solveLayerMetric(layerPolicy, layerFactor, metric),
        ]),
      );
      return { policy: layerPolicy, metrics };
    };

    for (let cleanRemaining = 0; cleanRemaining <= pickedCleanStock; cleanRemaining += 1) {
      for (let innocentRemaining = 0; innocentRemaining <= maximumInnocentStock; innocentRemaining += 1) {
        if (cleanRemaining === 0 && innocentRemaining === 0) continue;
        layers[cleanRemaining][innocentRemaining] = solveInventoryLayer(
          cleanRemaining,
          innocentRemaining,
        );
      }
    }

    const weighted = Object.fromEntries(metricNames.map((metric) => [metric, 0]));
    for (const { stock, chance } of pickedInnocentDistribution) {
      const layer = layers[pickedCleanStock][stock];
      for (const metric of metricNames) {
        weighted[metric] += chance * layer.metrics[metric][startIndex];
      }
    }
    expectedCost = weighted.cost;
    ownedCleans = weighted.ownedCleans;
    ownedInnocents = weighted.ownedInnocents;
    expected = {
      scrolls: weighted.scrolls,
      cleans: weighted.cleans,
      innocents: weighted.innocents,
      ownedCleans,
      paidCleans: Math.max(0, weighted.cleans - ownedCleans),
      ownedInnocents,
      paidInnocents: Math.max(0, weighted.innocents - ownedInnocents),
    };
    const representative = pickedInnocentDistribution.reduce((best, current) =>
      current.chance > best.chance ? current : best,
    );
    displayedPolicy = layers[pickedCleanStock][representative.stock].policy;
    displayedValues = layers[pickedCleanStock][representative.stock].metrics.cost;
    inventoryPolicy = "stock-aware-exact";
  } else if (pickedCleanStock > 0 || maximumInnocentStock > 0) {
    /* 큰 재고는 모든 재고 조합을 상태로 늘리지 않는다. 대신 유료/무료 조합
       네 가지에서 나온 정책을 실제 유한 재고의 capped 사용량으로 정확히
       다시 평가해 가장 싼 것을 고른다. 무재고 정책 하나만 쓰는 것보다 무료
       순백·이노센트 때문에 행동이 달라지는 경우를 안정적으로 포착한다. */
    const optimizeCandidatePolicy = (candidateCleanCost, candidateInnocentCost) => {
      const candidatePolicy = new Map(policy);
      const candidateActionCost = (action) =>
        action === ACTIONS.scroll
          ? scrollCost
          : action === ACTIONS.clean
            ? candidateCleanCost
            : candidateInnocentCost;
      for (let iteration = 0; iteration < SLOT_POLICY_MAX_ITERATIONS * states.length; iteration += 1) {
        const candidateFactor = policySystem(candidatePolicy);
        const candidateValues = solvePolicyReward(
          candidateFactor,
          (action) => candidateActionCost(action),
          candidatePolicy,
        );
        const changes = [];
        for (const [success, remaining] of states) {
          const key = slotKey(success, remaining);
          const currentAction = candidatePolicy.get(key);
          const optionValue = (action) => {
            let value = candidateActionCost(action);
            for (const [next, chance] of transitionsAt(action, success, remaining)) {
              value += chance * candidateValues[stateIndex.get(next)];
            }
            return value;
          };
          const currentValue = optionValue(currentAction);
          let bestAction = currentAction;
          let bestValue = currentValue;
          for (const action of actionsAt(success, remaining)) {
            const candidate = optionValue(action);
            const tolerance = SLOT_POLICY_EPSILON *
              Math.max(1, Math.abs(bestValue), Math.abs(candidate));
            if (candidate < bestValue - tolerance) {
              bestAction = action;
              bestValue = candidate;
            }
          }
          if (bestAction !== currentAction) {
            changes.push({
              key,
              action: bestAction,
              currentAction,
              gain: currentValue - bestValue,
            });
          }
        }
        if (!changes.length) break;
        changes.sort((left, right) => right.gain - left.gain);
        for (const change of changes) candidatePolicy.set(change.key, change.action);
        if (!policyIsProper(candidatePolicy)) {
          for (const change of changes) candidatePolicy.set(change.key, change.currentAction);
          let changed = false;
          for (const change of changes) {
            candidatePolicy.set(change.key, change.action);
            if (policyIsProper(candidatePolicy)) {
              changed = true;
              break;
            }
            candidatePolicy.set(change.key, change.currentAction);
          }
          if (!changed) break;
        }
      }
      return candidatePolicy;
    };

    const evaluateFixedCandidate = (candidatePolicy) => {
      const candidateFactor = policySystem(candidatePolicy);
      const candidateValues = solvePolicyReward(
        candidateFactor,
        (action) => actionCost(action),
        candidatePolicy,
      );
      const candidateCounts = new Map(
        Object.values(ACTIONS).map((wanted) => [
          wanted,
          solvePolicyReward(
            candidateFactor,
            (action) => Number(action === wanted),
            candidatePolicy,
          ),
        ]),
      );
      const candidateCleanCurve = ownedActionCurve(
        ACTIONS.clean,
        pickedCleanStock,
        candidatePolicy,
      );
      const candidateInnocentCurve = ownedActionCurve(
        ACTIONS.innocent,
        maximumInnocentStock,
        candidatePolicy,
      );
      const candidateOwnedCleans = candidateCleanCurve[pickedCleanStock] ?? 0;
      const candidateOwnedInnocents = pickedInnocentDistribution.reduce(
        (total, { stock, chance }) =>
          total + chance * (candidateInnocentCurve[stock] ?? 0),
        0,
      );
      const candidateCleans = candidateCounts.get(ACTIONS.clean)[startIndex] ?? 0;
      const candidateInnocents = candidateCounts.get(ACTIONS.innocent)[startIndex] ?? 0;
      return {
        policy: candidatePolicy,
        values: candidateValues,
        cost:
          candidateValues[startIndex] -
          candidateOwnedCleans * cleanCost -
          (candidateOwnedInnocents > 0 ? candidateOwnedInnocents * innocentCost : 0),
        expected: {
          scrolls: candidateCounts.get(ACTIONS.scroll)[startIndex] ?? 0,
          cleans: candidateCleans,
          innocents: candidateInnocents,
          ownedCleans: candidateOwnedCleans,
          paidCleans: Math.max(0, candidateCleans - candidateOwnedCleans),
          ownedInnocents: candidateOwnedInnocents,
          paidInnocents: Math.max(0, candidateInnocents - candidateOwnedInnocents),
        },
      };
    };

    const candidatePolicies = [
      new Map(policy),
      optimizeCandidatePolicy(0, innocentCost),
      optimizeCandidatePolicy(cleanCost, 0),
      optimizeCandidatePolicy(0, 0),
    ];
    const uniqueCandidates = new Map(
      candidatePolicies.map((candidatePolicy) => [
        states.map(([success, remaining]) =>
          candidatePolicy.get(slotKey(success, remaining))).join("|"),
        candidatePolicy,
      ]),
    );
    const bestCandidate = [...uniqueCandidates.values()]
      .map(evaluateFixedCandidate)
      .reduce((best, candidate) => candidate.cost < best.cost ? candidate : best);
    expectedCost = bestCandidate.cost;
    expected = bestCandidate.expected;
    ownedCleans = expected.ownedCleans;
    ownedInnocents = expected.ownedInnocents;
    displayedPolicy = bestCandidate.policy;
    displayedValues = bestCandidate.values;
    inventoryPolicy = "multi-policy-fixed-inventory";
  }

  const cleanSavings = ownedCleans * cleanCost;
  const innocentSavings = ownedInnocents > 0 ? ownedInnocents * innocentCost : 0;
  const totalSavings = baseExpectedCost - expectedCost;

  // 어느 상태에서 무엇을 고르는지 표로 함께 돌려준다.
  const policyRows = states.map(([success, remaining]) => ({
    success,
    remaining,
    action: displayedPolicy.get(slotKey(success, remaining)) ?? ACTIONS.innocent,
    cost: displayedValues[stateIndex.get(slotKey(success, remaining))] ?? 0,
  }));

  /* 순백만 쓰는 단순한 방식과 견줘 볼 수 있게 함께 낸다.
     목표 작을 채우려면 평균 target/p 번 바르고, 그중 실패한 만큼 순백을 쓴다. */
  const attempts = target / successRate;
  const failures = attempts - target;
  const consumedFailures = failures * (1 - slotProtectionRate);
  return {
    expectedCost,
    baseExpectedCost,
    expected,
    inventory: {
      policy: inventoryPolicy,
      stockAwareExactLayerBudget: STOCK_AWARE_EXACT_LAYER_BUDGET,
      stockLayerCount,
      cleanStock: pickedCleanStock,
      innocentStock: pickedInnocentStock,
      innocentStockDistribution: pickedInnocentDistribution,
      cleanSavings,
      innocentSavings,
      totalSavings,
    },
    policy: policyRows,
    cleanOnly: {
      scrolls: attempts,
      cleans: consumedFailures,
      cost: attempts * scrollCost + consumedFailures * cleanCost,
    },
  };
}

/**
 * 리턴 스크롤을 쓰는 놀긍작. 실패해도 횟수가 깎이지 않으므로 목표가 뜰
 * 때까지 굴리는 값만 든다.
 *
 * 공격력·마력과 주스탯은 따로 굴러서, 목표를 함께 만족할 확률은 곱이 된다.
 */
export function calculateChaosReturn({
  chaosRate = 60,
  attackTarget = 6,
  statTarget = 0,
  statCount = 1,
  returnPrice,
  acceptFourSix = false,
}) {
  if (!CHAOS_RATES.includes(chaosRate)) {
    throw new RangeError("놀긍혼은 60% 또는 100%만 있습니다.");
  }
  const rate = chaosRate / 100;
  let hit = chaosAtLeast(attackTarget) * chaosSumAtLeast(statTarget, statCount);
  if (acceptFourSix) {
    /* 공격력 4에 주스탯 6이면 공격력 6짜리와 값이 비슷해 함께 받는다.
       공격력이 정확히 4인 경우만 더해야 겹쳐 세지 않는다. */
    const attackExactlyFour =
      chaosAtLeast(4) - chaosAtLeast(attackTarget > 4 ? attackTarget : 5);
    hit += attackExactlyFour * chaosSumAtLeast(6, statCount);
  }
  const chance = rate * hit;
  if (!(chance > 0)) {
    throw new RangeError("이 목표는 나올 수 없습니다.");
  }
  const attempts = 1 / chance;
  return {
    chance,
    attempts,
    cost: attempts * returnPrice,
  };
}

function solveFirstChaosWork({
  chaosRate,
  acceptedOutcomes,
  optionChance,
  chaosPrice,
  innocentPrice,
}) {
  const rate = chaosRate / 100;
  const chance = rate * optionChance;
  const chaosScrolls = 1 / chance;
  const expected = {
    chaosScrolls,
    cleanScrolls: 0,
    /* 놀긍 자체 실패를 포함한 모든 목표 미달은 즉시 초기화한다. */
    innocentScrolls: chaosScrolls - 1,
  };
  return {
    chance,
    optionChance,
    expected,
    cost:
      expected.chaosScrolls * chaosPrice +
      expected.innocentScrolls * innocentPrice,
    acceptedOutcomes: acceptedOutcomes.map((outcome) => ({
      ...outcome,
      probability: outcome.chance / optionChance,
    })),
  };
}

/**
 * 첫 작을 리턴 스크롤 없이 놀긍+이노센트로 띄운다.
 * 놀긍 자체 실패를 포함해 목표가 아닌 모든 결과를 즉시 초기화하므로
 * 최종 성공 전 모든 시도에 이노센트가 한 번씩 든다.
 */
export function calculateChaosFirstWork({
  slots,
  chaosRate = 60,
  attackTarget = 6,
  statTarget = 0,
  statCount = 1,
  chaosPrice = 0,
  innocentPrice = 0,
}) {
  if (!Number.isInteger(slots) || slots < 1 || slots > 20) {
    throw new RangeError("첫 작에 쓸 업그레이드 횟수는 1~20 사이여야 합니다.");
  }
  assertChaosRate(chaosRate);
  assertNonNegative(chaosPrice, "놀긍 가격");
  assertNonNegative(innocentPrice, "이노센트 초기화 가격");
  const target = targetChaosOutcomes({ attackTarget, statTarget, statCount });
  return solveFirstChaosWork({
    chaosRate,
    acceptedOutcomes: target.outcomes,
    optionChance: target.chance,
    chaosPrice,
    innocentPrice,
  });
}

function selectAdaptiveReturnDecision({
  previous,
  statWidth,
  outcomes,
  rate,
  attackNeeded,
  statNeeded,
}) {
  const candidates = [];
  for (let index = 0; index < outcomes.length; index += 1) {
    const outcome = outcomes[index];
    const nextAttack = Math.max(0, attackNeeded - outcome.attack);
    const nextStat = Math.max(0, statNeeded - outcome.stat);
    const continuation = previous[nextAttack * statWidth + nextStat];
    if (Number.isFinite(continuation)) {
      candidates.push({ index, continuation, chance: outcome.chance });
    }
  }
  candidates.sort(
    (a, b) => a.continuation - b.continuation || a.index - b.index,
  );
  let chance = 0;
  let weightedContinuation = 0;
  let bestValue = Number.POSITIVE_INFINITY;
  let bestLength = 0;
  let bestChance = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    chance += candidate.chance;
    weightedContinuation += candidate.chance * candidate.continuation;
    const value = 1 / (rate * chance) + weightedContinuation / chance;
    if (value < bestValue - CHAOS_EPSILON) {
      bestValue = value;
      bestLength = index + 1;
      bestChance = chance;
    }
  }
  if (!bestLength) return null;
  return {
    expectedAttempts: bestValue,
    outcomeChance: bestChance,
    acceptedIndices: candidates.slice(0, bestLength).map((entry) => entry.index),
  };
}

function solveAdaptiveChaosReturn({
  slots,
  chaosRate,
  attackGoal,
  statGoal,
  statCount,
}) {
  const rate = chaosRate / 100;
  const outcomes = chaosOutcomeDistribution(statCount);
  const statWidth = statGoal + 1;
  const layerSize = (attackGoal + 1) * statWidth;
  const layers = [new Float64Array(layerSize).fill(Number.POSITIVE_INFINITY)];
  layers[0][0] = 0;

  for (let remaining = 1; remaining <= slots; remaining += 1) {
    const previous = layers[remaining - 1];
    const current = new Float64Array(layerSize).fill(Number.POSITIVE_INFINITY);
    const maximumAttack = Math.min(attackGoal, 6 * remaining);
    const maximumStat = Math.min(statGoal, 6 * statCount * remaining);
    for (let attackNeeded = 0; attackNeeded <= maximumAttack; attackNeeded += 1) {
      for (let statNeeded = 0; statNeeded <= maximumStat; statNeeded += 1) {
        const decision = selectAdaptiveReturnDecision({
          previous,
          statWidth,
          outcomes,
          rate,
          attackNeeded,
          statNeeded,
        });
        if (decision) {
          current[attackNeeded * statWidth + statNeeded] = decision.expectedAttempts;
        }
      }
    }
    layers.push(current);
  }

  const valueAt = (remainingSlots, attackNeeded, statNeeded) => {
    if (
      !Number.isInteger(remainingSlots) ||
      remainingSlots < 0 ||
      remainingSlots > slots ||
      !Number.isInteger(attackNeeded) ||
      attackNeeded < 0 ||
      attackNeeded > attackGoal ||
      !Number.isInteger(statNeeded) ||
      statNeeded < 0 ||
      statNeeded > statGoal
    ) {
      return Number.POSITIVE_INFINITY;
    }
    return layers[remainingSlots][attackNeeded * statWidth + statNeeded];
  };

  const decisionAt = (remainingSlots, attackNeeded, statNeeded) => {
    if (remainingSlots === 0) {
      return attackNeeded === 0 && statNeeded === 0
        ? { complete: true, expectedAttempts: 0, acceptedOutcomes: [] }
        : null;
    }
    if (!Number.isFinite(valueAt(remainingSlots, attackNeeded, statNeeded))) return null;
    const decision = selectAdaptiveReturnDecision({
      previous: layers[remainingSlots - 1],
      statWidth,
      outcomes,
      rate,
      attackNeeded,
      statNeeded,
    });
    if (!decision) return null;
    return {
      complete: false,
      remainingSlots,
      attackNeeded,
      statNeeded,
      chance: rate * decision.outcomeChance,
      immediateAttempts: 1 / (rate * decision.outcomeChance),
      expectedAttempts: decision.expectedAttempts,
      acceptedOutcomes: decision.acceptedIndices.map((index) => {
        const outcome = outcomes[index];
        return {
          ...outcome,
          probability: outcome.chance / decision.outcomeChance,
        };
      }),
    };
  };

  return { valueAt, decisionAt };
}

function validateAggregateChaosGoals({ slots, attackGoal, statGoal, statCount }) {
  if (!Number.isInteger(slots) || slots < 0 || slots > 20) {
    throw new RangeError("리턴으로 작할 횟수는 0~20 사이여야 합니다.");
  }
  assertStatCount(statCount);
  assertNonNegative(attackGoal, "최종 공·마 목표", { integer: true });
  assertNonNegative(statGoal, "최종 스탯 합 목표", { integer: true });
  if (attackGoal > 6 * slots || statGoal > 6 * statCount * slots) {
    throw new RangeError("남은 작 횟수로 최종 놀긍 목표를 달성할 수 없습니다.");
  }
}

/**
 * 장비 전체의 공·마/스탯 합계 목표를 만족하는 adaptive 놀긍리턴.
 * 채택한 실제 상승량을 다음 작의 남은 목표에서 빼므로 초과 상승도 반영한다.
 */
export function calculateChaosAggregateReturn({
  slots,
  chaosRate = 60,
  attackGoal = 0,
  statGoal = 0,
  statCount = 1,
  chaosPrice = 0,
  returnPrice = 0,
}) {
  assertChaosRate(chaosRate);
  assertNonNegative(chaosPrice, "놀긍 가격");
  assertNonNegative(returnPrice, "리턴 스크롤 가격");
  validateAggregateChaosGoals({ slots, attackGoal, statGoal, statCount });
  const solved = solveAdaptiveChaosReturn({
    slots,
    chaosRate,
    attackGoal,
    statGoal,
    statCount,
  });
  const attempts = solved.valueAt(slots, attackGoal, statGoal);
  if (!Number.isFinite(attempts)) {
    throw new RangeError("이 놀긍 리턴 목표는 달성할 수 없습니다.");
  }
  return {
    goals: { attack: attackGoal, stat: statGoal },
    expected: { chaosScrolls: attempts, returnScrolls: attempts },
    chaosCost: attempts * chaosPrice,
    returnCost: attempts * returnPrice,
    decision: solved.decisionAt(slots, attackGoal, statGoal),
    decisionFor({ remainingSlots, attackNeeded, statNeeded }) {
      return solved.decisionAt(remainingSlots, attackNeeded, statNeeded);
    },
  };
}

function averageGoal(value, slots, name) {
  assertNonNegative(value, name);
  const raw = value * slots;
  const rounded = Math.round(raw);
  return Math.abs(raw - rounded) < 1e-9 ? rounded : Math.ceil(raw);
}

/** 첫 작 이노센트 + 나머지 adaptive 리턴을 합쳐 최종 평균 목표를 계산한다. */
export function calculateChaosReturnStrategy({
  slots,
  averageAttackTarget = 6,
  averageStatTarget = 0,
  statCount = 1,
  firstWork = null,
  returnWork = {},
}) {
  if (!Number.isInteger(slots) || slots < 1 || slots > 20) {
    throw new RangeError("전체 작 횟수는 1~20 사이여야 합니다.");
  }
  assertStatCount(statCount);
  const attackGoal = averageGoal(averageAttackTarget, slots, "평균 공·마 목표");
  const statGoal = averageGoal(averageStatTarget, slots, "평균 스탯 합 목표");
  if (attackGoal > 6 * slots || statGoal > 6 * statCount * slots) {
    throw new RangeError("최종 평균 놀긍 목표를 달성할 수 없습니다.");
  }

  const returnOptions = {
    chaosRate: returnWork.chaosRate ?? 60,
    chaosPrice: returnWork.chaosPrice ?? 0,
    returnPrice: returnWork.returnPrice ?? 0,
  };
  assertChaosRate(returnOptions.chaosRate);
  assertNonNegative(returnOptions.chaosPrice, "리턴 놀긍 가격");
  assertNonNegative(returnOptions.returnPrice, "리턴 스크롤 가격");

  if (!firstWork) {
    const remainder = calculateChaosAggregateReturn({
      slots,
      attackGoal,
      statGoal,
      statCount,
      ...returnOptions,
    });
    return {
      goals: {
        attack: attackGoal,
        stat: statGoal,
        averageAttack: attackGoal / slots,
        averageStat: statGoal / slots,
      },
      first: null,
      remainder,
      expected: {
        chaosScrolls: remainder.expected.chaosScrolls,
        cleanScrolls: 0,
        innocentScrolls: 0,
        returnScrolls: remainder.expected.returnScrolls,
      },
      costs: {
        first: 0,
        returnChaos: remainder.chaosCost,
        returnScroll: remainder.returnCost,
      },
    };
  }

  const firstOptions = {
    chaosRate: firstWork.chaosRate ?? 60,
    attackTarget: firstWork.attackTarget ?? 6,
    statTarget: firstWork.statTarget ?? 0,
    statCount,
    chaosPrice: firstWork.chaosPrice ?? 0,
    innocentPrice: firstWork.innocentPrice ?? 0,
  };
  assertChaosRate(firstOptions.chaosRate);
  assertNonNegative(firstOptions.chaosPrice, "첫 작 놀긍 가격");
  assertNonNegative(firstOptions.innocentPrice, "첫 작 이노센트 가격");
  const firstTarget = targetChaosOutcomes(firstOptions);
  const remainingSlots = slots - 1;
  for (const outcome of firstTarget.outcomes) {
    if (
      Math.max(0, attackGoal - outcome.attack) > 6 * remainingSlots ||
      Math.max(0, statGoal - outcome.stat) > 6 * statCount * remainingSlots
    ) {
      throw new RangeError("첫 작 목표의 일부 결과로는 최종 평균 목표를 달성할 수 없습니다.");
    }
  }
  const first = solveFirstChaosWork({
    chaosRate: firstOptions.chaosRate,
    acceptedOutcomes: firstTarget.outcomes,
    optionChance: firstTarget.chance,
    chaosPrice: firstOptions.chaosPrice,
    innocentPrice: firstOptions.innocentPrice,
  });

  const solvedRemainder = solveAdaptiveChaosReturn({
    slots: remainingSlots,
    chaosRate: returnOptions.chaosRate,
    attackGoal,
    statGoal,
    statCount,
  });
  let returnAttempts = 0;
  const initialStates = first.acceptedOutcomes.map((outcome) => {
    const attackNeeded = Math.max(0, attackGoal - outcome.attack);
    const statNeeded = Math.max(0, statGoal - outcome.stat);
    const expectedAttempts = solvedRemainder.valueAt(
      remainingSlots,
      attackNeeded,
      statNeeded,
    );
    returnAttempts += outcome.probability * expectedAttempts;
    return {
      firstOutcome: { attack: outcome.attack, stat: outcome.stat },
      probability: outcome.probability,
      attackNeeded,
      statNeeded,
      decision: solvedRemainder.decisionAt(remainingSlots, attackNeeded, statNeeded),
    };
  });
  if (!Number.isFinite(returnAttempts)) {
    throw new RangeError("첫 작 이후 남은 놀긍 목표를 달성할 수 없습니다.");
  }
  const remainder = {
    slots: remainingSlots,
    expected: { chaosScrolls: returnAttempts, returnScrolls: returnAttempts },
    chaosCost: returnAttempts * returnOptions.chaosPrice,
    returnCost: returnAttempts * returnOptions.returnPrice,
    initialStates,
    decisionFor({ remainingSlots: count, attackNeeded, statNeeded }) {
      return solvedRemainder.decisionAt(count, attackNeeded, statNeeded);
    },
  };
  return {
    goals: {
      attack: attackGoal,
      stat: statGoal,
      averageAttack: attackGoal / slots,
      averageStat: statGoal / slots,
    },
    first,
    remainder,
    expected: {
      chaosScrolls: first.expected.chaosScrolls + returnAttempts,
      cleanScrolls: 0,
      innocentScrolls: first.expected.innocentScrolls,
      returnScrolls: returnAttempts,
    },
    costs: {
      first: first.cost,
      returnChaos: remainder.chaosCost,
      returnScroll: remainder.returnCost,
    },
  };
}

/**
 * 리턴 스크롤 없이 남은 횟수만큼 놀긍혼을 바르는 떡작.
 * 실패하면 그 횟수는 그대로 날아간다.
 */
export function calculateChaosSpam({ slots, chaosRate = 60 }) {
  if (!CHAOS_RATES.includes(chaosRate)) {
    throw new RangeError("놀긍혼은 60% 또는 100%만 있습니다.");
  }
  const rate = chaosRate / 100;
  const mean = chaosMean();
  return {
    scrolls: slots,
    successes: slots * rate,
    attackGain: slots * rate * mean,
    statGain: slots * rate * mean,
  };
}

/* 주문서 한 장에 드는 주문의 흔적 개수. 부위와 장비 레벨, 주문서 확률로
   정해져 있다. 레벨은 표에 적힌 구간의 시작값이고, 그 사이 레벨은 아래
   구간을 따른다. 장신구와 기계심장에는 15% 주문서가 없다. */
export const TRACE_SLOTS = {
  weapon: { label: "무기", rates: [100, 70, 30, 15] },
  armor: { label: "방어구", rates: [100, 70, 30, 15] },
  glove: { label: "장갑", rates: [100, 70, 30, 15] },
  accessory: { label: "장신구", rates: [100, 70, 30] },
  heart: { label: "기계심장", rates: [100, 70, 30] },
};

const TRACE_COSTS = {
  weapon: [
    [100, [22, 28, 30, 40]],
    [110, [26, 34, 40, 48]],
    [120, [93, 120, 144, 174]],
    [130, [120, 156, 186, 222]],
    [140, [144, 192, 228, 276]],
    [150, [300, 390, 470, 570]],
    [160, [370, 480, 575, 690]],
    [200, [725, 940, 1125, 1350]],
  ],
  armor: [
    [100, [13, 17, 20, 24]],
    [110, [16, 20, 24, 29]],
    [120, [57, 72, 87, 104]],
    [130, [72, 93, 114, 133]],
    [140, [90, 117, 138, 166]],
    [150, [185, 240, 290, 342]],
    [160, [220, 285, 345, 414]],
    [200, [435, 565, 675, 910]],
    [250, [850, 1100, 1325, 1560]],
  ],
  glove: [
    [100, [17, 23, 27, 32]],
    [110, [20, 27, 33, 38]],
    [120, [75, 96, 117, 139]],
    [130, [96, 123, 150, 178]],
    [140, [120, 156, 186, 221]],
    [150, [245, 320, 380, 456]],
    [160, [295, 385, 460, 550]],
    [200, [580, 750, 900, 1080]],
    [250, [1135, 1475, 1770, 2080]],
  ],
  accessory: [
    [100, [18, 24, 28]],
    [110, [22, 28, 34]],
    [120, [57, 72, 87]],
    [130, [100, 130, 155]],
    [140, [125, 160, 195]],
    [160, [185, 240, 285]],
    [200, [360, 470, 560]],
  ],
  heart: [
    [100, [36, 47, 56]],
    [130, [200, 260, 310]],
  ],
};

// 특별한 주문서에 드는 흔적 개수. 바뀌지 않는 값이라 고정해 둔다.
export const SPECIAL_TRACE_COUNTS = {
  clean: 20_000,
  innocent: 12_000,
  arkInnocent: 24_000,
};

/**
 * 주문서 한 장에 드는 흔적 개수. 표에 없는 조합이면 null.
 * 썬데이 반값 행사에서는 모든 흔적 사용량이 절반이 된다.
 */
export function traceCost(slot, itemLevel, rate, { halfPrice = false } = {}) {
  const table = TRACE_COSTS[slot];
  const rates = TRACE_SLOTS[slot]?.rates;
  if (!table || !rates) throw new RangeError("지원하지 않는 부위입니다.");
  const column = rates.indexOf(rate);
  if (column === -1) return null;

  let picked = null;
  for (const [level, counts] of table) {
    if (itemLevel >= level) picked = counts;
  }
  if (!picked) picked = table[0][1];
  const count = picked[column];
  return halfPrice ? Math.ceil(count / 2) : count;
}

/** 순백·이노센트처럼 개수가 정해진 주문서의 흔적 사용량. */
export function specialTraceCost(kind, { halfPrice = false } = {}) {
  const count = SPECIAL_TRACE_COUNTS[kind];
  if (!count) throw new RangeError("지원하지 않는 주문서입니다.");
  return halfPrice ? count / 2 : count;
}

/* 매지컬 무기 주문서는 100% 주문서로 올스탯 +3과 공·마 9~11을 준다.
   리턴 스크롤을 함께 써서 11이 뜰 때까지 무르는 것이 매지컬 리턴작이다. */
export const MAGICAL_CHANCES = [
  { value: 11, chance: 0.1 },
  { value: 10, chance: 0.4 },
  { value: 9, chance: 0.5 },
];

export function calculateMagicalReturn({ target = 11, scrollPrice, returnPrice }) {
  if (target !== 11) {
    throw new RangeError("매지컬리턴 목표는 모든 작 공·마 +11로 고정됩니다.");
  }
  assertNonNegative(scrollPrice, "매지컬 주문서 가격");
  assertNonNegative(returnPrice, "리턴 스크롤 가격");
  const chance = MAGICAL_CHANCES.find((roll) => roll.value === 11).chance;
  const attempts = 1 / chance;
  return {
    target: 11,
    chance,
    attempts,
    scrollCost: attempts * scrollPrice,
    // 리턴 스크롤은 결과를 확인하기 전, 매 시도마다 먼저 적용한다.
    returnCost: attempts * returnPrice,
  };
}

/**
 * 매지컬 완작의 첫 칸은 리턴 없이 띄우고, 미달 결과를 이노센트로
 * 초기화한다. 첫 칸이 완성된 뒤에는 이미 붙은 작을 지우지 않도록
 * 매 시도마다 리턴 스크롤을 사용한다.
 *
 * resetCost는 초기화 주문서 한 장의 메소 가격이다. 성공률이 100%가
 * 아닌 초기화 주문서는 resetRate를 함께 넘기며, resetStock은 성공이
 * 보장된 보유 초기화 주문서 수량으로 본다.
 */
export function calculateMagicalReturnCraft({
  slots,
  target = 11,
  scrollPrice,
  returnPrice,
  resetCost,
  resetRate = 1,
  resetStock = 0,
}) {
  if (target !== 11) {
    throw new RangeError("매지컬리턴 목표는 모든 작 공·마 +11로 고정됩니다.");
  }
  if (!Number.isInteger(slots) || slots < 1) {
    throw new RangeError("매지컬리턴 작 수는 1 이상의 정수여야 합니다.");
  }
  assertNonNegative(scrollPrice, "매지컬 주문서 가격");
  assertNonNegative(returnPrice, "리턴 스크롤 가격");
  assertNonNegative(resetCost, "초기화 주문서 가격");
  if (!Number.isFinite(resetRate) || resetRate <= 0 || resetRate > 1) {
    throw new RangeError("초기화 주문서 성공률은 0 초과 1 이하여야 합니다.");
  }
  assertNonNegative(resetStock, "보유 초기화 주문서 수량", { integer: true });

  const chance = MAGICAL_CHANCES.find((roll) => roll.value === target).chance;
  const missChance = 1 - chance;
  const attemptsPerWork = 1 / chance;
  const resets = missChance / chance;

  /* 첫작 실패 횟수 F는 P(F >= n) = missChance^n인 기하분포다.
     따라서 K장의 보유분 사용 기대값은 sum(P(F >= n), n=1..K)이고,
     보유분 소진 뒤 유료 초기화 횟수는 나머지 꼬리합이다. */
  const purchasedResetSuccesses =
    Math.pow(missChance, resetStock + 1) / chance;
  const ownedResetsUsed = resets - purchasedResetSuccesses;
  const purchasedResetScrolls = purchasedResetSuccesses / resetRate;
  const magicalScrolls = attemptsPerWork * slots;
  const returnScrolls = attemptsPerWork * (slots - 1);
  const magicalMeso = magicalScrolls * scrollPrice;
  const resetMeso = purchasedResetScrolls * resetCost;

  return {
    target,
    chance,
    attemptsPerWork,
    expected: {
      magicalScrolls,
      returnScrolls,
      resets,
      ownedResetsUsed,
      purchasedResetSuccesses,
      purchasedResetScrolls,
    },
    costs: {
      magicalMeso,
      resetMeso,
      otherMeso: magicalMeso + resetMeso,
      returnMaplePoints: returnScrolls * returnPrice,
    },
  };
}

/**
 * 이미 완료한 매지컬 주문서 횟수에서 고정 완작 수까지 남은 비용을 계산한다.
 *
 * 완료한 작이 하나도 없을 때만 첫 칸을 이노센트로 반복하고, 이미 한 칸
 * 이상 완성돼 있으면 남은 모든 칸에서 기존 작을 보호하기 위해 매 시도마다
 * 리턴 스크롤을 사용한다.
 */
export function calculateMagicalReturnCraftProgress({
  totalSlots = 10,
  completedSlots = 0,
  target = 11,
  scrollPrice,
  returnPrice,
  resetCost = 0,
  resetRate = 1,
  resetStock = 0,
}) {
  if (!Number.isInteger(totalSlots) || totalSlots < 1) {
    throw new RangeError("매지컬리턴 전체 작 수는 1 이상의 정수여야 합니다.");
  }
  if (
    !Number.isInteger(completedSlots) ||
    completedSlots < 0 ||
    completedSlots > totalSlots
  ) {
    throw new RangeError(
      `완료한 주문서 횟수는 0~${totalSlots}의 정수여야 합니다.`,
    );
  }

  const remainingSlots = totalSlots - completedSlots;
  if (completedSlots === 0) {
    return {
      ...calculateMagicalReturnCraft({
        slots: totalSlots,
        target,
        scrollPrice,
        returnPrice,
        resetCost,
        resetRate,
        resetStock,
      }),
      totalSlots,
      completedSlots,
      remainingSlots,
      firstWorkUsesReset: true,
    };
  }

  const oneWork = calculateMagicalReturn({ target, scrollPrice, returnPrice });
  const magicalScrolls = oneWork.attempts * remainingSlots;
  // 이미 완성된 작이 있으므로 남은 모든 칸은 결과를 보기 전에 리턴을 쓴다.
  const returnScrolls = oneWork.attempts * remainingSlots;
  return {
    target,
    chance: oneWork.chance,
    attemptsPerWork: oneWork.attempts,
    totalSlots,
    completedSlots,
    remainingSlots,
    firstWorkUsesReset: false,
    expected: {
      magicalScrolls,
      returnScrolls,
      resets: 0,
      ownedResetsUsed: 0,
      purchasedResetSuccesses: 0,
      purchasedResetScrolls: 0,
    },
    costs: {
      magicalMeso: magicalScrolls * scrollPrice,
      resetMeso: 0,
      otherMeso: magicalScrolls * scrollPrice,
      returnMaplePoints: returnScrolls * returnPrice,
    },
  };
}

export { ACTIONS as SCROLL_ACTIONS };
