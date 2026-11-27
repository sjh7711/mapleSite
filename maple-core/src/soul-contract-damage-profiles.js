import { SOUL_CONTRACT_DAMAGE_PROFILES } from "./soul-contract-damage-reference.js";

const DURATIONS = [10, 12, 15, 18, 20, 23, 26, 30];

export function soulContractDamageCoverage({
  characterClass, duration, combatDuration, timeUptime, observedReuse,
}) {
  const profile = Object.hasOwn(SOUL_CONTRACT_DAMAGE_PROFILES, characterClass)
    ? SOUL_CONTRACT_DAMAGE_PROFILES[characterClass] : null;
  if (!profile || (profile.requiresReuse && !observedReuse) ||
      !(combatDuration >= 310 && combatDuration <= 370) || !(duration > 0)) return null;

  const lookup = Math.max(DURATIONS[0], Math.min(DURATIONS.at(-1), duration));
  const upper = DURATIONS.findIndex((value) => value >= lookup);
  const lower = Math.max(0, upper - 1);
  const progress = upper === lower ? 0
    : (lookup - DURATIONS[lower]) / (DURATIONS[upper] - DURATIONS[lower]);
  const [lowRate, highRate] = [profile.rates[lower], profile.rates[upper]];
  const rate = lowRate + (highRate - lowRate) * progress;

  // Rate is the ratio of damage per second inside and outside Soul Contract
  // after removing Soul Contract's own amplification from the replay.
  const weightedUptime = timeUptime * rate;
  return {
    damageCoverage: weightedUptime / (1 - timeUptime + weightedUptime),
    damageProfileSamples: profile.sampleCount,
  };
}
