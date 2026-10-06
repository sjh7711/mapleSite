import { calculatePetExpectation, PET_PAYBACK_POINTS, PET_PROBABILITIES } from "./pet.js";

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a; }
function factorial(n) { let value = 1; for (let i = 2; i <= n; i++) value *= i; return value; }

// Exact reward-state DP for MP bundles with positive net transition costs.
// Arbitrary prices with a very fine grid use the bounded-memory simulation below.
function directBundleChance({ target, budget, bundlePrice, bundleSize, crystalPrice, probabilities }) {
  if (![bundlePrice, crystalPrice, bundleSize].every(Number.isSafeInteger) || bundleSize > 11 ||
      bundlePrice <= PET_PAYBACK_POINTS * bundleSize || crystalPrice <= PET_PAYBACK_POINTS) return null;
  const unit = gcd(gcd(bundlePrice, crystalPrice), PET_PAYBACK_POINTS);
  const limit = Math.floor(budget / unit + 1e-9);
  const slots = bundleSize + 2;
  const stride = target * 2 * slots;
  if (limit < 0) return 0;
  if (limit > 60000 || (limit + 1) * stride > 3_000_000) return null;
  const purchases = [];
  for (let blacks = 0; blacks <= bundleSize; blacks++) {
    for (let upper = 0; upper <= bundleSize - blacks; upper++) {
      const other = bundleSize - blacks - upper;
      purchases.push({ blacks, cost: (bundlePrice - upper * PET_PAYBACK_POINTS) / unit,
        probability: factorial(bundleSize) / factorial(blacks) / factorial(upper) / factorial(other) *
          probabilities.wonderBlack ** blacks * probabilities.wonderUpperPet ** upper * probabilities.wonderConsumable ** other });
    }
  }
  const dp = new Float64Array((limit + 1) * stride);
  dp[0] = 1;
  let success = 0;
  function put(cost, petites, pending, blacks, mass) {
    if (cost > limit) return;
    if (petites === target) { success += mass; return; }
    dp[cost * stride + (petites * 2 + pending) * slots + blacks] += mass;
  }
  const crystal = crystalPrice / unit;
  const payback = PET_PAYBACK_POINTS / unit;
  for (let cost = 0; cost <= limit; cost++) for (let petites = 0; petites < target; petites++) {
    for (let pending = 0; pending <= 1; pending++) for (let blacks = 0; blacks < slots; blacks++) {
      const mass = dp[cost * stride + (petites * 2 + pending) * slots + blacks];
      if (!mass) continue;
      if (blacks < (pending ? 1 : 2)) {
        for (const roll of purchases) put(cost + roll.cost, petites, pending, blacks + roll.blacks, mass * roll.probability);
      } else if (pending) {
        put(cost + crystal, petites + 1, 0, blacks - 1, mass * probabilities.dreamPetite);
        put(cost + crystal - payback, petites, 0, blacks - 1, mass * probabilities.dream);
        put(cost + crystal, petites, 0, blacks - 1, mass * probabilities.dreamKey);
      } else {
        put(cost + crystal, petites + 1, 0, blacks - 2, mass * probabilities.sweetPetite);
        put(cost + crystal, petites, 1, blacks - 2, mass * probabilities.sweet);
        put(cost + crystal, petites, 0, blacks - 2, mass * probabilities.sweetKey);
      }
    }
  }
  return Math.min(1, Math.max(0, success));
}

/** P(completed net cost <= analytic mean net cost). No attempt-count proxy.
 * A fixed seed makes the fallback stable across reloads. Runs in a Web Worker.
 * The reported mean itself always comes from the existing analytic engine. */
export function calculatePetMeanCostChance(options = {}, { trials = 200_000, seed = 20261006, exact = true } = {}) {
  if (!Number.isInteger(trials) || trials < 2 || trials > 2_000_000) throw new RangeError("시뮬레이션 횟수가 올바르지 않습니다.");
  const result = calculatePetExpectation(options);
  const bundled = result.bundlePurchase.applicable;
  const costs = bundled ? result.bundlePurchase.costs : result.costs;
  const meanCost = costs.netMesoEquivalentAfterRemainingInventoryRecovery ??
    costs.netMesoEquivalentAfterRemainingBlackSale ?? costs.netMesoEquivalent;
  const rate = result.currency.conversionToMeso;
  const bundleSize = options.wonderBerryBundleSize ?? 11;
  const bundlePrice = options.wonderBerryBundleMaplePoints ?? options.wonderBerryBundlePrice ?? 54000;
  const crystalPrice = options.lunaCrystalMaplePoints ?? options.lunaCrystalPrice ?? 3900;
  const procurement = result.bundlePurchase.selectedProcurement;
  const p = result.probabilities;
  if (exact && bundled && procurement === "maple-point-bundle") {
    const chance = directBundleChance({ target: result.targetCount, budget: meanCost / rate,
      bundlePrice, bundleSize, crystalPrice, probabilities: p });
    if (chance !== null) return { chance, meanCost, method: "exact", trials: 0 };
  }
  const random = randomGenerator(seed);
  const payback = PET_PAYBACK_POINTS * rate;
  const crystal = crystalPrice * rate;
  const auctionBundle = options.wonderBerryAuctionBundleMesoPrice ?? 0;
  const blackPrice = options.wonderBlackMesoPrice ?? 0;
  const fee = options.auctionFeeRate ?? 0.05;
  const tradeable = bundled ? procurement !== "maple-point-bundle" : result.recovery.tradeableResults;
  const dreamRecovery = tradeable ? Math.max(payback, (options.lunaDreamAuctionMesoPrice ?? 0) * (1 - fee)) : payback;
  const keyRecovery = tradeable ? (options.lunaKeyAuctionMesoPrice ?? 0) * (1 - fee) : 0;
  const remainingBlackRecovery = tradeable ? Math.max(payback, blackPrice * (1 - fee)) : 0;
  const hybrid = bundled && procurement === "hybrid-bundle";
  let below = 0, sum = 0, squareSum = 0;
  for (let trial = 0; trial < trials; trial++) {
    let petites = 0, blacks = 0, tradeableBlacks = 0, pending = false, cost = 0;
    let operations = 0;
    while (petites < result.targetCount) {
      if (++operations > 1_000_000) throw new RangeError("시세 조건의 계산 한도를 초과했습니다.");
      if (bundled) {
        const needsPurchase = hybrid
          ? pending ? blacks < 1 : tradeableBlacks < 1 || blacks < 1
          : blacks < (pending ? 1 : 2);
        if (needsPurchase) {
          const buyAuction = hybrid ? !pending && tradeableBlacks < 1 : procurement === "auction-bundle";
          cost += buyAuction ? auctionBundle : bundlePrice * rate;
          for (let i = 0; i < bundleSize; i++) {
            const u = random();
            if (u < p.wonderBlack) {
              if (hybrid && buyAuction) tradeableBlacks++; else blacks++;
            } else if (u < p.wonderBlack + p.wonderUpperPet) cost -= payback;
          }
          continue;
        }
        if (hybrid) { blacks--; if (!pending) tradeableBlacks--; }
        else blacks -= pending ? 1 : 2;
      } else {
        // The non-bundle route model buys individual auction materials. Its
        // mixed route pulls one base black per first synthesis, at unit price.
        if (result.selectedSource === "mixed" && !pending) {
          let obtained = false;
          while (!obtained) {
            if (++operations > 1_000_000) throw new RangeError("시세 조건의 계산 한도를 초과했습니다.");
            cost += bundlePrice / bundleSize * rate;
            const u = random();
            obtained = u < p.wonderBlack;
            if (!obtained && u < p.wonderBlack + p.wonderUpperPet) cost -= payback;
          }
          cost += blackPrice;
        } else cost += (pending ? 1 : 2) * blackPrice;
      }
      cost += crystal;
      const u = random();
      if (pending) {
        pending = false;
        if (u < PET_PROBABILITIES.dreamSynthesis.petite) petites++;
        else if (u < PET_PROBABILITIES.dreamSynthesis.petite + PET_PROBABILITIES.dreamSynthesis.dream) cost -= dreamRecovery;
        else cost -= keyRecovery;
      } else {
        if (u < PET_PROBABILITIES.sweetSynthesis.petite) petites++;
        else if (u < PET_PROBABILITIES.sweetSynthesis.petite + PET_PROBABILITIES.sweetSynthesis.sweet) pending = true;
        else cost -= keyRecovery;
      }
    }
    if (bundled) cost -= (hybrid ? tradeableBlacks : blacks) * remainingBlackRecovery;
    sum += cost; squareSum += cost * cost;
    if (cost <= meanCost + Math.max(1e-6, Math.abs(meanCost) * 1e-12)) below++;
  }
  const sampledMean = sum / trials;
  return { chance: below / trials, meanCost, method: "simulation", trials, sampledMean,
    meanStandardError: Math.sqrt(Math.max(0, squareSum / trials - sampledMean ** 2) / (trials - 1)) };
}
