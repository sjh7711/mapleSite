// Count distributions let us sample repeated attempts without walking billions
// of individual failures. Gamma: Marsaglia–Tsang; Poisson: Hörmann PTRS.
// Algorithm reference (including the gamma–Poisson negative-binomial identity):
// https://github.com/numpy/numpy/blob/main/numpy/random/src/distributions/distributions.c
// Binomial sampling uses the conditional distribution around a beta order
// statistic; each split halves the number of Bernoulli trials.

export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296 + 0.5 / 4294967296;
  };
}

export function hashSeed(text) {
  let hash = 2166136261;
  for (const character of text) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function gamma(shape, random) {
  if (shape === 1) return -Math.log(random());
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    const normal = Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
    const root = 1 + c * normal;
    if (root <= 0) continue;
    const v = root ** 3, u = random(), logV = 3 * Math.log1p(c * normal);
    const penalty = Math.abs(logV) < 0.001
      ? -(logV ** 2) * (0.5 + logV / 6 + logV ** 2 / 24 + logV ** 3 / 120)
      : logV - Math.expm1(logV);
    if (u < 1 - 0.0331 * normal ** 4 ||
        Math.log(u) < normal ** 2 / 2 + d * penalty) return d * v;
  }
}

function logPoissonMass(k, mean) {
  if (k === 0) return -mean;
  if (k < 10) {
    let factorial = 0;
    for (let i = 2; i <= k; i++) factorial += Math.log(i);
    return -mean + k * Math.log(mean) - factorial;
  }
  const delta = (k - mean) / mean;
  let deviance;
  if (Math.abs(delta) < 0.1) {
    let power = delta * delta, sum = power / 2;
    for (let n = 3; n < 30; n++) {
      power *= -delta;
      const term = power / (n * (n - 1));
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-16) break;
    }
    deviance = mean * sum;
  } else deviance = k * Math.log(k / mean) - (k - mean);
  const correction = 1 / (12 * k) - 1 / (360 * k ** 3) + 1 / (1260 * k ** 5);
  return -deviance - 0.5 * Math.log(2 * Math.PI * k) - correction;
}

function poisson(mean, random) {
  if (mean === 0) return 0;
  if (mean < 10) {
    const limit = Math.exp(-mean);
    let product = 1, count = -1;
    do { count++; product *= random(); } while (product > limit);
    return count;
  }
  const b = 0.931 + 2.53 * Math.sqrt(mean), a = -0.059 + 0.02483 * b;
  const alpha = 1.1239 + 1.1328 / (b - 3.4), squeeze = 0.9277 - 3.6224 / (b - 2);
  for (;;) {
    const u = random() - 0.5, v = random(), distance = 0.5 - Math.abs(u);
    const k = Math.floor((2 * a / distance + b) * u + mean + 0.43);
    if (k < 0) continue;
    if (distance >= 0.07 && v <= squeeze) return k;
    if (distance < 0.013 && v > distance) continue;
    if (Math.log(v * alpha / (a / distance ** 2 + b)) <= logPoissonMass(k, mean)) return k;
  }
}

export function geometricFailures(probability, random) {
  return probability >= 1 ? 0 : Math.floor(Math.log(random()) / Math.log1p(-probability));
}

export function negativeBinomialFailures(successes, probability, random) {
  if (probability >= 1 || successes === 0) return 0;
  if (successes <= 8) {
    let total = 0;
    for (let i = 0; i < successes; i++) total += geometricFailures(probability, random);
    return total;
  }
  const mean = gamma(successes, random) * (1 - probability) / probability;
  if (!Number.isFinite(mean) || mean > Number.MAX_SAFE_INTEGER / 4) {
    throw new RangeError("이 조건의 강화 횟수가 정밀하게 계산할 수 있는 범위를 초과했습니다.");
  }
  return poisson(mean, random);
}

export function binomial(count, probability, random) {
  if (!count || probability <= 0) return 0;
  if (probability >= 1) return count;
  if (probability > 0.5) return count - binomial(count, 1 - probability, random);
  if (count <= 32) {
    let hits = 0;
    for (let i = 0; i < count; i++) if (random() < probability) hits++;
    return hits;
  }
  if (count * probability < 12) {
    let position = 0, hits = 0;
    for (;;) {
      position += 1 + geometricFailures(probability, random);
      if (position > count) return hits;
      hits++;
    }
  }
  const middle = Math.floor(count / 2) + 1;
  const lower = gamma(middle, random), upper = gamma(count - middle + 1, random);
  const split = lower / (lower + upper);
  return split >= probability
    ? binomial(middle - 1, probability / split, random)
    : middle + binomial(count - middle, (probability - split) / (1 - split), random);
}
