export const maxGrade = 20;
export const maxLevel = 10;
export const minResetGrade = 10;
// 강화 전 메인 레벨을 기준으로 한다. 부가 스탯 만렙 이후에도 메인 상승률은 유지된다고 가정한다.
const mainRates = [0.35, 0.35, 0.35, 0.20, 0.20, 0.20, 0.20, 0.15, 0.10, 0.05, 0];
const fragmentCosts = [10, 10, 10, 20, 20, 20, 20, 30, 30, 50, 50];
const fragmentUnit = 10;
const maxAttemptSpend = maxGrade * Math.max(...fragmentCosts) / fragmentUnit;

function table() {
  return Array.from({ length: maxGrade + 1 }, () => Array(maxLevel + 1).fill(0));
}

export function calculateHexaStat({ target, event = false }) {
  if (!Number.isInteger(target) || target < 1 || target > maxLevel) {
    throw new RangeError("목표 메인 레벨은 1~10이어야 합니다.");
  }
  const rate = mainRates.map((p, level) => p * (event && level >= 5 ? 1.2 : 1));
  const chance = table();
  const fragments = table();
  for (let main = target; main <= maxLevel; main++) chance[maxGrade][main] = 1;

  const nextAverage = (values, grade, main) => {
    const next = values[grade + 1];
    return (1 - rate[main]) * next[main] + rate[main] * next[Math.min(maxLevel, main + 1)];
  };

  for (let grade = maxGrade - 1; grade >= 0; grade--) {
    for (let main = 0; main <= Math.min(grade, maxLevel); main++) {
      chance[grade][main] = nextAverage(chance, grade, main);
      fragments[grade][main] = fragmentCosts[main] + nextAverage(fragments, grade, main);
    }
  }

  function strategy(restart) {
    const total = table();
    const reset = table();
    for (let main = 0; main < target; main++) {
      total[maxGrade][main] = restart;
      reset[maxGrade][main] = true;
    }
    for (let grade = maxGrade - 1; grade >= 0; grade--) {
      for (let main = 0; main <= Math.min(grade, maxLevel); main++) {
        const upgrade = fragmentCosts[main] + nextAverage(total, grade, main);
        reset[grade][main] = grade >= minResetGrade && main < target && restart < upgrade;
        total[grade][main] = reset[grade][main] ? restart : upgrade;
      }
    }
    return { total, reset };
  }

  // Completing every attempt gives an upper bound for the optimal restart cost.
  let lower = 0;
  let upper = fragments[0][0] / chance[0][0];
  // The fresh-core cost must equal the value of the optimal policy from grade 0.
  for (let step = 0; step < 52; step++) {
    const estimate = (lower + upper) / 2;
    if (strategy(estimate).total[0][0] > estimate) lower = estimate;
    else upper = estimate;
  }
  return { chance, fragments, rate, ...strategy((lower + upper) / 2) };
}

function attemptDistribution(result, startGrade, startMain) {
  const spendByMain = () => Array.from({ length: maxLevel + 1 }, () => new Float64Array(maxAttemptSpend + 1));
  let states = spendByMain();
  states[startMain][0] = 1;
  const success = new Float64Array(maxAttemptSpend + 1);
  const failure = new Float64Array(maxAttemptSpend + 1);

  for (let grade = startGrade; grade <= maxGrade; grade++) {
    const next = spendByMain();
    for (let main = startMain; main <= Math.min(grade, maxLevel); main++) {
      for (const [spend, mass] of states[main].entries()) {
        if (mass === 0) continue;
        if (result.reset[grade][main]) {
          failure[spend] += mass;
        } else if (grade === maxGrade) {
          success[spend] += mass;
        } else {
          const paid = spend + fragmentCosts[main] / fragmentUnit;
          const rate = result.rate[main];
          next[main][paid] += mass * (1 - rate);
          if (rate > 0) next[main + 1][paid] += mass * rate;
        }
      }
    }
    states = next;
  }

  let total = 0;
  return {
    success: success.map((mass) => {
      total += mass;
      return total;
    }),
    retry: Array.from(failure.entries()).filter(([, mass]) => mass > 0),
    maxSuccess: success.findLastIndex(mass => mass > 0),
  };
}

export function createHexaStatBudget(result, grade, main) {
  if (!Number.isInteger(grade) || grade < 0 || grade > maxGrade
    || !Number.isInteger(main) || main < 0 || main > Math.min(grade, maxLevel)) {
    throw new RangeError("현재 코어 등급과 메인 레벨을 확인해 주세요.");
  }
  const fresh = attemptDistribution(result, 0, 0);
  const current = grade === 0 ? fresh : attemptDistribution(result, grade, main);
  const freshCdf = [];
  const currentCdf = current === fresh ? freshCdf : [];

  function successByBudget(attempt, spend) {
    let probability = attempt.success[Math.min(spend, maxAttemptSpend)];
    for (const [retrySpend, mass] of attempt.retry) {
      if (retrySpend > spend) break;
      probability += mass * freshCdf[spend - retrySpend];
    }
    return Math.min(probability, 1);
  }

  function appendBudget() {
    const spend = freshCdf.length;
    // A fresh attempt always pays for at least one upgrade before it can reset.
    freshCdf.push(successByBudget(fresh, spend));
    if (current !== fresh) currentCdf.push(successByBudget(current, spend));
  }

  return {
    probabilityAt(fragments) {
      const spend = Math.floor(fragments / fragmentUnit);
      while (currentCdf.length <= spend) appendBudget();
      return currentCdf[spend];
    },
    requiredFragments(probability) {
      if (probability <= 0) return 0;
      if (probability === 1) {
        if (current.retry.length === 0) return current.maxSuccess * fragmentUnit;
        if (fresh.retry.length > 0) return Infinity;
        return Math.max(current.maxSuccess, current.retry.at(-1)[0] + fresh.maxSuccess) * fragmentUnit;
      }
      // Each retry uses the same fresh-core distribution and its remaining budget.
      while ((currentCdf.at(-1) ?? 0) < probability) appendBudget();
      let low = 0;
      let high = currentCdf.length - 1;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (currentCdf[middle] >= probability) high = middle;
        else low = middle + 1;
      }
      return low * fragmentUnit;
    },
  };
}
