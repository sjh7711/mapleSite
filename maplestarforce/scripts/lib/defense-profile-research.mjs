import {
  rawProfileIgnoreDefenseGain,
} from "./defense-normalized-profile.mjs";

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mean(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length
    ? valid.reduce((sum, value) => sum + value, 0) / valid.length
    : null;
}

function relativeErrorPercent(estimate, reference) {
  return Number.isFinite(estimate) && reference > 0
    ? (estimate / reference - 1) * 100
    : null;
}

export function unprofiledIgnoreDefenseGain({
  currentIgnoreDefense,
  addedIgnoreDefense = 0.4,
  targetDefenseRemaining = 1,
  enemyDefense,
}) {
  const current = Math.max(0, Math.min(1, Number(currentIgnoreDefense)));
  const added = Math.max(0, Math.min(1, Number(addedIgnoreDefense)));
  const defense = Math.max(0, Number(enemyDefense)) * Math.max(
    0,
    Math.min(1, Number(targetDefenseRemaining)),
  );
  const before = 1 - defense * (1 - current);
  const after = 1 - defense * (1 - current) * (1 - added);
  return before > 0 ? after / before - 1 : null;
}

export function inferExternalEffectiveDefenseRemaining({
  against300,
  against380,
}) {
  const low = finiteNumber(against300);
  const high = finiteNumber(against380);
  if (!(low > 0) || !(high > 0)) return null;
  const k = (high / low) * 3 / 3.8;
  const denominator = 3 - 3.8 * k;
  if (Math.abs(denominator) < 1e-12) return 0;
  const result = (1 - k) / denominator;
  return Number.isFinite(result) && result >= 0 && result < 1 / 3.8
    ? result
    : null;
}

function rawChannels(profile) {
  return (profile?.skillShares ?? []).map((channel) => ({
    source: channel?.source,
    rawWeight: Number(channel?.rawWeight ?? channel?.weight),
    localIgnoreDefenseSources:
      channel?.localIgnoreDefenseSources ?? channel?.ignoreDefenseSources ?? [],
  })).filter(({ source, rawWeight }) => source && rawWeight > 0);
}

export function evaluateDefenseProfileRow(row, profile) {
  const diagnosticIgnoreDefense = finiteNumber(
    row?.combatDiagnostics?.currentIgnoreDefense,
  );
  const diagnosticTargetRemaining = finiteNumber(
    row?.combatDiagnostics?.targetDefenseRemaining,
  );
  const inferredCurrentEffectiveRemaining =
    inferExternalEffectiveDefenseRemaining({
      against300: row?.unprofiled300,
      against380: row?.unprofiled380,
    });
  const targetDefenseRemaining = diagnosticTargetRemaining ?? 1;
  const currentIgnoreDefense = diagnosticIgnoreDefense ??
    (inferredCurrentEffectiveRemaining === null
      ? null
      : 1 - inferredCurrentEffectiveRemaining);
  const unprofiled380 = finiteNumber(row?.unprofiled380);
  if (
    currentIgnoreDefense === null ||
    !(unprofiled380 > 0) ||
    !rawChannels(profile).length
  ) return null;
  const baselineGain380 = unprofiledIgnoreDefenseGain({
    currentIgnoreDefense,
    targetDefenseRemaining,
    enemyDefense: 3.8,
  });
  const oneMainPercentRelative = baselineGain380 / unprofiled380;
  if (!(oneMainPercentRelative > 0)) return null;
  const channels = rawChannels(profile);
  const estimate = {};
  for (const [suffix, enemyDefense] of [["300", 3], ["380", 3.8]]) {
    const gain = rawProfileIgnoreDefenseGain({
      rawChannels: channels,
      currentIgnoreDefense,
      addedIgnoreDefense: 0.4,
      targetDefenseRemaining,
      enemyDefense,
    });
    estimate[suffix] = gain / oneMainPercentRelative;
  }
  const externalEffectiveRemaining = inferExternalEffectiveDefenseRemaining({
    against300: row?.ied300,
    against380: row?.ied380,
  });
  const currentEffectiveRemaining = inferredCurrentEffectiveRemaining ??
    targetDefenseRemaining * (1 - currentIgnoreDefense);
  return {
    characterClass: String(row?.apiClass ?? row?.characterClass ?? "").trim(),
    characterName: String(row?.characterName ?? "").trim(),
    reference300: finiteNumber(row?.ied300),
    reference380: finiteNumber(row?.ied380),
    unprofiled300: finiteNumber(row?.unprofiled300),
    unprofiled380,
    profiled300: estimate["300"],
    profiled380: estimate["380"],
    oneMainPercentRelative,
    currentIgnoreDefense,
    targetDefenseRemaining,
    currentEffectiveRemaining,
    externalEffectiveRemaining,
    effectiveRemainingRatio: externalEffectiveRemaining !== null &&
        currentEffectiveRemaining > 0
      ? externalEffectiveRemaining / currentEffectiveRemaining
      : null,
  };
}

function blended(row, suffix, confidence) {
  return row[`unprofiled${suffix}`] +
    (row[`profiled${suffix}`] - row[`unprofiled${suffix}`]) * confidence;
}

export function fitProfileConfidence(rows) {
  let best = { confidence: 0, maePercent: Infinity };
  for (let step = 0; step <= 1_000; step += 1) {
    const confidence = step / 1_000;
    const errors = rows.flatMap((row) => ["300", "380"].map((suffix) =>
      Math.abs(relativeErrorPercent(
        blended(row, suffix, confidence),
        row[`reference${suffix}`],
      ))
    ));
    const score = mean(errors);
    if (score !== null && score < best.maePercent) {
      best = { confidence, maePercent: score };
    }
  }
  return best;
}

function summarizeErrors(rows, estimatePrefix) {
  const errors = rows.flatMap((row) => ["300", "380"].map((suffix) =>
    Math.abs(relativeErrorPercent(
      row[`${estimatePrefix}${suffix}`],
      row[`reference${suffix}`],
    ))
  )).filter(Number.isFinite);
  return {
    count: errors.length,
    maePercent: mean(errors),
    maximumAbsoluteErrorPercent: errors.length ? Math.max(...errors) : null,
  };
}

export function evaluateDefenseProfiles({
  validationRows,
  profiles,
  expectedClasses = [],
  samplesPerClass = 5,
  targetMaePercent = 4,
}) {
  const grouped = new Map();
  for (const row of validationRows ?? []) {
    const characterClass = String(
      row?.apiClass ?? row?.characterClass ?? "",
    ).trim();
    const profile = profiles?.[characterClass];
    if (!characterClass || !profile) continue;
    const evaluated = evaluateDefenseProfileRow(row, profile);
    if (!evaluated) continue;
    const rows = grouped.get(characterClass) ?? [];
    rows.push(evaluated);
    grouped.set(characterClass, rows);
  }
  const roster = expectedClasses.length
    ? [...new Set(expectedClasses)]
    : [...new Set((validationRows ?? []).map((row) =>
      String(row?.apiClass ?? row?.characterClass ?? "").trim()
    ).filter(Boolean))];
  const classes = [];
  const allCrossValidated = [];
  for (const characterClass of roster.sort((left, right) =>
    left.localeCompare(right, "ko")
  )) {
    const rows = grouped.get(characterClass) ?? [];
    const direct = summarizeErrors(rows, "profiled");
    const baseline = summarizeErrors(rows, "unprofiled");
    const fit = rows.length ? fitProfileConfidence(rows) : null;
    const folds = rows.map((holdout, index) => {
      const training = rows.filter((_, other) => other !== index);
      const confidence = training.length
        ? fitProfileConfidence(training).confidence
        : 0;
      const estimates = Object.fromEntries(["300", "380"].map((suffix) => [
        suffix,
        blended(holdout, suffix, confidence),
      ]));
      const errors = Object.fromEntries(["300", "380"].map((suffix) => [
        suffix,
        relativeErrorPercent(
          estimates[suffix],
          holdout[`reference${suffix}`],
        ),
      ]));
      allCrossValidated.push(...Object.values(errors).map(Math.abs));
      return {
        characterName: holdout.characterName,
        confidence,
        estimates,
        errors,
      };
    });
    const crossValidatedErrors = folds.flatMap(({ errors }) =>
      Object.values(errors).map(Math.abs)
    );
    const crossValidatedMaePercent = mean(crossValidatedErrors);
    classes.push({
      characterClass,
      profileAvailable: Boolean(profiles?.[characterClass]),
      referenceCount: rows.length,
      complete: rows.length === samplesPerClass,
      baseline,
      dictionaryProfile: direct,
      fittedConfidence: fit?.confidence ?? null,
      leaveOneCharacterOut: {
        maePercent: crossValidatedMaePercent,
        maximumAbsoluteErrorPercent: crossValidatedErrors.length
          ? Math.max(...crossValidatedErrors)
          : null,
        folds,
      },
      meanEffectiveRemainingRatio: mean(rows.map(
        ({ effectiveRemainingRatio }) => effectiveRemainingRatio,
      )),
      passed: rows.length === samplesPerClass &&
        crossValidatedMaePercent < targetMaePercent,
    });
  }
  const evaluated = classes.filter(({ referenceCount }) => referenceCount > 0);
  return {
    target: { samplesPerClass, targetMaePercent },
    counts: {
      expectedClassCount: roster.length,
      profileClassCount: Object.keys(profiles ?? {}).length,
      evaluatedClassCount: evaluated.length,
      completeClassCount: classes.filter(({ complete }) => complete).length,
      passedClassCount: classes.filter(({ passed }) => passed).length,
    },
    aggregate: {
      leaveOneCharacterOutMaePercent: mean(allCrossValidated),
    },
    classes,
  };
}
