import {
  inferExternalEffectiveDefenseRemaining,
  unprofiledIgnoreDefenseGain,
} from "./defense-profile-research.mjs";
import { rawProfileIgnoreDefenseGain } from "./defense-normalized-profile.mjs";
import {
  selectStableBattlePracticeRecords,
} from "./battle-practice-profile.mjs";
import { battlePracticeReferenceKey } from "./battle-practice-v2-profile.mjs";

const DEFENSE_LEVELS = Object.freeze([3, 3.8]);

export const NON_DEFENSE_METRICS = Object.freeze([
  "bossDamage",
  "flatAttack",
  "attackPercent",
  "criticalDamage",
  "allStatPercent",
]);

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mean(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length
    ? valid.reduce((sum, value) => sum + value, 0) / valid.length
    : null;
}

function median(values) {
  const valid = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!valid.length) return null;
  const middle = Math.floor(valid.length / 2);
  return valid.length % 2
    ? valid[middle]
    : (valid[middle - 1] + valid[middle]) / 2;
}

function relativeErrorPercent(estimate, reference) {
  return Number.isFinite(estimate) && reference > 0
    ? (estimate / reference - 1) * 100
    : null;
}

function absoluteErrorPercent(estimate, reference) {
  const value = relativeErrorPercent(estimate, reference);
  return value === null ? null : Math.abs(value);
}

function canonicalSources(value) {
  return [...new Set((value ?? [])
    .map(Number)
    .filter((entry) => Number.isFinite(entry) && entry > 0 && entry <= 100))]
    .sort((left, right) => left - right);
}

function donorRecencyKey(record) {
  return [
    record?.registerDate ?? "",
    record?.collectedAt ?? "",
    record?.replayId ?? "",
  ].map((value) => String(value).normalize("NFKC").trim()).join("\u001f");
}

/**
 * 여러 수집 파일에 같은 캐릭터가 들어 있어도 표본 수를 부풀리지 않는다.
 * OCID나 입력 파일 순서가 아니라 정규화한 최종 직업명+캐릭터명으로 묶고,
 * 같은 캐릭터에서는 가장 최신 정상 기록을 고른다.
 */
export function deduplicateResearchDonors(records) {
  const byCharacter = new Map();
  const missingIdentity = [];
  for (const record of records ?? []) {
    const key = battlePracticeReferenceKey(
      record?.characterClass,
      record?.characterName,
    );
    if (!key) {
      missingIdentity.push(record);
      continue;
    }
    const current = byCharacter.get(key);
    if (!current || donorRecencyKey(record) > donorRecencyKey(current)) {
      byCharacter.set(key, record);
    }
  }
  const unique = [...byCharacter.values()].sort((left, right) =>
    String(left.characterClass).localeCompare(String(right.characterClass), "ko") ||
    String(left.characterName).localeCompare(String(right.characterName), "ko") ||
    donorRecencyKey(right).localeCompare(donorRecencyKey(left))
  );
  return {
    records: unique,
    candidateCount: (records ?? []).length,
    duplicateCount: (records ?? []).length - missingIdentity.length - unique.length,
    missingIdentity,
  };
}

function selectionCandidate(record) {
  return {
    characterClass: record.characterClass,
    characterName: record.characterName,
    result: {
      end_type: "1",
      total_play_time: record.playTimeMilliseconds,
      register_date: record.registerDate,
      skillShares: (record.rawChannels ?? []).map((channel) => ({
        source: channel.source,
        weight: channel.rawWeight,
      })),
    },
  };
}

/**
 * 프로필 빌더와 같은 robust stability selector로 직업별 최대 N명을 고른다.
 * rawUniqueCount와 selectedCount를 분리해 7명을 5명으로 줄인 직업도 표본
 * 정의가 5명 완비로 정확히 유지되도록 한다.
 */
export function selectStableResearchDonors(records, {
  samplesPerClass = 5,
  maximumMedianPairDistance = 0.12,
} = {}) {
  const grouped = new Map();
  for (const record of records ?? []) {
    const characterClass = String(record?.characterClass ?? "")
      .normalize("NFKC").trim();
    if (!characterClass) continue;
    const rows = grouped.get(characterClass) ?? [];
    rows.push(record);
    grouped.set(characterClass, rows);
  }
  const selected = [];
  const classes = [];
  for (const characterClass of [...grouped.keys()].sort((left, right) =>
    left.localeCompare(right, "ko")
  )) {
    const rows = grouped.get(characterClass).sort((left, right) =>
      String(left.characterName).localeCompare(String(right.characterName), "ko") ||
      donorRecencyKey(right).localeCompare(donorRecencyKey(left))
    );
    const selection = selectStableBattlePracticeRecords(
      rows.map(selectionCandidate),
      {
        minSamples: samplesPerClass,
        maxSamples: samplesPerClass,
        maximumMedianPairDistance,
      },
    );
    const acceptedKeys = new Set(selection.accepted.map((record) =>
      battlePracticeReferenceKey(characterClass, record.characterName)
    ));
    const chosen = rows.filter((record) => acceptedKeys.has(
      battlePracticeReferenceKey(characterClass, record.characterName),
    )).slice(0, samplesPerClass);
    selected.push(...chosen);
    classes.push({
      characterClass,
      rawUniqueCount: rows.length,
      selectedCount: chosen.length,
      droppedCount: rows.length - chosen.length,
      stable: selection.stable,
      reason: selection.reason,
      medianPairDistance: selection.medianPairDistance,
      maximumPairDistance: selection.maximumPairDistance,
      selectedCharacters: chosen.map(({ characterName }) => characterName),
      droppedCharacters: rows.filter((record) => !acceptedKeys.has(
        battlePracticeReferenceKey(characterClass, record.characterName),
      )).map(({ characterName }) => characterName),
    });
  }
  return {
    records: selected,
    rawUniqueCount: (records ?? []).length,
    selectedCount: selected.length,
    droppedCount: (records ?? []).length - selected.length,
    classes,
  };
}

/**
 * 스킬명은 +방무의 한계 효율에 직접 필요하지 않으므로 같은 스킬 방무
 * 조합을 한 채널로 합친다. 이 형태는 원본 리플레이를 런타임에 싣지 않고도
 * 스킬 사전의 계산 의미를 보존한다.
 */
export function collapseDefenseSignature(rawChannels) {
  const grouped = new Map();
  for (const channel of rawChannels ?? []) {
    const weight = finiteNumber(channel?.rawWeight ?? channel?.weight);
    if (!(weight > 0)) continue;
    const sources = canonicalSources(
      channel?.localIgnoreDefenseSources ?? channel?.ignoreDefenseSources,
    );
    const key = JSON.stringify(sources);
    grouped.set(key, (grouped.get(key) ?? 0) + weight);
  }
  const total = [...grouped.values()].reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return [];
  return [...grouped.entries()]
    .map(([key, weight]) => ({
      rawWeight: weight / total,
      localIgnoreDefenseSources: JSON.parse(key),
    }))
    .sort((left, right) => right.rawWeight - left.rawWeight);
}

export function signatureIgnoreDefenseGain({
  signature,
  currentIgnoreDefense,
  enemyDefense,
  addedIgnoreDefense = 0.4,
}) {
  return rawProfileIgnoreDefenseGain({
    rawChannels: signature,
    currentIgnoreDefense,
    addedIgnoreDefense,
    enemyDefense,
  });
}

/**
 * 평균 스킬 점유율 하나를 만드는 대신 독립 donor 각각의 반응을 계산한 뒤
 * 중앙값을 사용한다. 5표본처럼 작은 표본에서 한 명의 비정상 딜사이클이
 * 전체 직업 프로필을 끌고 가는 현상을 줄인다.
 */
export function medianEnsembleIgnoreDefenseGain({
  donorSignatures,
  currentIgnoreDefense,
  enemyDefense,
  addedIgnoreDefense = 0.4,
}) {
  return median((donorSignatures ?? []).map((signature) =>
    signatureIgnoreDefenseGain({
      signature,
      currentIgnoreDefense,
      enemyDefense,
      addedIgnoreDefense,
    })
  ));
}

export function meanDefenseSignatures(signatures) {
  const grouped = new Map();
  const valid = (signatures ?? []).filter((signature) => signature?.length);
  if (!valid.length) return [];
  for (const signature of valid) {
    for (const channel of signature) {
      const sources = canonicalSources(channel?.localIgnoreDefenseSources);
      const key = JSON.stringify(sources);
      grouped.set(
        key,
        (grouped.get(key) ?? 0) + Number(channel?.rawWeight ?? 0) / valid.length,
      );
    }
  }
  return collapseDefenseSignature([...grouped].map(([key, rawWeight]) => ({
    rawWeight,
    localIgnoreDefenseSources: JSON.parse(key),
  })));
}

function summarizeErrors(errors) {
  const valid = errors.filter(Number.isFinite);
  return {
    count: valid.length,
    meanAbsoluteErrorPercent: mean(valid),
    medianAbsoluteErrorPercent: median(valid),
    maximumAbsoluteErrorPercent: valid.length ? Math.max(...valid) : null,
  };
}

function recordsByClass(records) {
  const grouped = new Map();
  for (const record of records ?? []) {
    const characterClass = String(record?.characterClass ?? "").trim();
    if (!characterClass) continue;
    const currentIgnoreDefense = finiteNumber(record?.currentIgnoreDefense);
    const signature = collapseDefenseSignature(record?.rawChannels);
    if (!(currentIgnoreDefense >= 0 && currentIgnoreDefense <= 1) ||
      !signature.length) continue;
    const rows = grouped.get(characterClass) ?? [];
    rows.push({
      ...record,
      characterClass,
      currentIgnoreDefense,
      signature,
    });
    grouped.set(characterClass, rows);
  }
  return grouped;
}

/** 실제 6분 리플레이를 한 명씩 완전히 제외하는 직업 내 LOO 검증. */
export function evaluateReplayProtocolLeaveOneOut({
  records,
  samplesPerClass = 5,
  targetMaePercent = 4,
  minimumTrainingSamples = 2,
} = {}) {
  const grouped = recordsByClass(records);
  const classes = [];
  const completeErrors = [];
  const allErrors = [];
  const completeMeanProfileErrors = [];
  const allMeanProfileErrors = [];
  for (const characterClass of [...grouped.keys()].sort((left, right) =>
    left.localeCompare(right, "ko")
  )) {
    const rows = grouped.get(characterClass);
    const folds = [];
    for (const [index, holdout] of rows.entries()) {
      const training = rows.filter((_, other) => other !== index);
      if (training.length < minimumTrainingSamples) continue;
      const donorSignatures = training.map(({ signature }) => signature);
      const meanSignature = meanDefenseSignatures(donorSignatures);
      const results = {};
      for (const enemyDefense of DEFENSE_LEVELS) {
        const key = enemyDefense === 3 ? "300" : "380";
        const truth = signatureIgnoreDefenseGain({
          signature: holdout.signature,
          currentIgnoreDefense: holdout.currentIgnoreDefense,
          enemyDefense,
        });
        const estimate = medianEnsembleIgnoreDefenseGain({
          donorSignatures,
          currentIgnoreDefense: holdout.currentIgnoreDefense,
          enemyDefense,
        });
        const meanProfileEstimate = signatureIgnoreDefenseGain({
          signature: meanSignature,
          currentIgnoreDefense: holdout.currentIgnoreDefense,
          enemyDefense,
        });
        results[key] = {
          truth,
          estimate,
          meanProfileEstimate,
          errorPercent: relativeErrorPercent(estimate, truth),
          meanProfileErrorPercent: relativeErrorPercent(
            meanProfileEstimate,
            truth,
          ),
        };
      }
      folds.push({
        characterName: holdout.characterName ?? null,
        trainingSampleCount: training.length,
        results,
      });
    }
    const errors = folds.flatMap(({ results }) =>
      Object.values(results).map(({ errorPercent }) => Math.abs(errorPercent))
    ).filter(Number.isFinite);
    const meanProfileErrors = folds.flatMap(({ results }) =>
      Object.values(results).map(({ meanProfileErrorPercent }) =>
        Math.abs(meanProfileErrorPercent)
      )
    ).filter(Number.isFinite);
    const complete = rows.length === samplesPerClass;
    allErrors.push(...errors);
    allMeanProfileErrors.push(...meanProfileErrors);
    if (complete) {
      completeErrors.push(...errors);
      completeMeanProfileErrors.push(...meanProfileErrors);
    }
    const summary = summarizeErrors(errors);
    classes.push({
      characterClass,
      sampleCount: rows.length,
      complete,
      ...summary,
      passed: complete && summary.meanAbsoluteErrorPercent < targetMaePercent,
      folds,
    });
  }
  const completeClasses = classes.filter(({ complete }) => complete);
  return {
    protocol: "actual-six-minute-replay",
    estimator: "leave-one-character-out-median-donor-response",
    target: { samplesPerClass, targetMaePercent },
    counts: {
      classCount: classes.length,
      completeClassCount: completeClasses.length,
      passedClassCount: classes.filter(({ passed }) => passed).length,
      recordCount: [...grouped.values()].reduce(
        (sum, rows) => sum + rows.length,
        0,
      ),
    },
    completeClasses: summarizeErrors(completeErrors),
    allClasses: summarizeErrors(allErrors),
    comparisonEstimator: {
      estimator: "leave-one-character-out-mean-signature-profile",
      completeClasses: summarizeErrors(completeMeanProfileErrors),
      allClasses: summarizeErrors(allMeanProfileErrors),
    },
    classes,
  };
}

function donorSignaturesByClass(records) {
  return new Map([...recordsByClass(records)].map(([characterClass, rows]) => [
    characterClass,
    rows.map(({ signature }) => signature),
  ]));
}

function externalRowBase(row, donorSignatures) {
  const effectiveRemaining = inferExternalEffectiveDefenseRemaining({
    against300: row?.unprofiled300,
    against380: row?.unprofiled380,
  });
  const unprofiled380 = finiteNumber(row?.unprofiled380);
  if (effectiveRemaining === null || !(unprofiled380 > 0) ||
    !donorSignatures?.length) return null;
  const currentIgnoreDefense = 1 - effectiveRemaining;
  const baseGain380 = unprofiledIgnoreDefenseGain({
    currentIgnoreDefense,
    enemyDefense: 3.8,
  });
  const oneMainPercentRelative = baseGain380 / unprofiled380;
  if (!(oneMainPercentRelative > 0)) return null;
  const estimates = {};
  for (const enemyDefense of DEFENSE_LEVELS) {
    const key = enemyDefense === 3 ? "300" : "380";
    const gain = medianEnsembleIgnoreDefenseGain({
      donorSignatures,
      currentIgnoreDefense,
      enemyDefense,
    });
    estimates[key] = gain / oneMainPercentRelative;
  }
  return { currentIgnoreDefense, oneMainPercentRelative, estimates };
}

function fixedHierarchicalLogCorrection({
  trainingRows,
  characterClass,
  estimateKey,
  referenceKey,
  priorStrength = 2,
}) {
  const usable = trainingRows.filter((row) =>
    finiteNumber(row?.[estimateKey]) > 0 && finiteNumber(row?.[referenceKey]) > 0
  );
  if (!usable.length) return 1;
  const classRows = usable.filter((row) => row.characterClass === characterClass);
  const globalLog = median(usable.map((row) =>
    Math.log(row[referenceKey] / row[estimateKey])
  )) ?? 0;
  if (!classRows.length) return Math.exp(globalLog);
  const classLog = median(classRows.map((row) =>
    Math.log(row[referenceKey] / row[estimateKey])
  )) ?? globalLog;
  const weight = classRows.length / (classRows.length + priorStrength);
  return Math.exp(weight * classLog + (1 - weight) * globalLog);
}

/**
 * MapleScouter 수치를 실제 6분 리플레이의 정답으로 섞지 않고, 별도 비교
 * 규약으로 평가한다. `adapted`는 각 holdout을 제외한 계층 보정 연구치이며
 * 실제 전투 계산식으로 배포할 값이 아니다.
 */
export function evaluateMapleScouterProtocol({
  validationRows,
  donorRecords,
  targetMaePercent = 4,
  priorStrength = 2,
} = {}) {
  const signatures = donorSignaturesByClass(donorRecords);
  const baseRows = [];
  for (const row of validationRows ?? []) {
    if (row?.ok === false) continue;
    const characterClass = String(
      row?.apiClass ?? row?.characterClass ?? "",
    ).trim();
    const base = externalRowBase(row, signatures.get(characterClass));
    if (!characterClass || !base) continue;
    baseRows.push({
      characterClass,
      characterName: String(row?.characterName ?? "").trim(),
      baseline300: finiteNumber(row?.unprofiled300),
      baseline380: finiteNumber(row?.unprofiled380),
      dictionary300: base.estimates["300"],
      dictionary380: base.estimates["380"],
      reference300: finiteNumber(row?.ied300),
      reference380: finiteNumber(row?.ied380),
    });
  }
  const baselineErrors = [];
  const dictionaryErrors = [];
  const adaptedErrors = [];
  const folds = [];
  for (const [index, holdout] of baseRows.entries()) {
    const training = baseRows.filter((_, other) => other !== index);
    const results = {};
    for (const suffix of ["300", "380"]) {
      const correction = fixedHierarchicalLogCorrection({
        trainingRows: training,
        characterClass: holdout.characterClass,
        estimateKey: `dictionary${suffix}`,
        referenceKey: `reference${suffix}`,
        priorStrength,
      });
      const adapted = holdout[`dictionary${suffix}`] * correction;
      const baselineError = absoluteErrorPercent(
        holdout[`baseline${suffix}`],
        holdout[`reference${suffix}`],
      );
      const dictionaryError = absoluteErrorPercent(
        holdout[`dictionary${suffix}`],
        holdout[`reference${suffix}`],
      );
      const adaptedError = absoluteErrorPercent(
        adapted,
        holdout[`reference${suffix}`],
      );
      baselineErrors.push(baselineError);
      dictionaryErrors.push(dictionaryError);
      adaptedErrors.push(adaptedError);
      results[suffix] = {
        reference: holdout[`reference${suffix}`],
        baseline: holdout[`baseline${suffix}`],
        dictionary: holdout[`dictionary${suffix}`],
        adapted,
        correction,
        baselineErrorPercent: baselineError,
        dictionaryErrorPercent: dictionaryError,
        adaptedErrorPercent: adaptedError,
      };
    }
    folds.push({
      characterClass: holdout.characterClass,
      characterName: holdout.characterName,
      results,
    });
  }
  const adapted = summarizeErrors(adaptedErrors);
  const classes = [...new Set(folds.map(({ characterClass }) => characterClass))]
    .sort((left, right) => left.localeCompare(right, "ko"))
    .map((characterClass) => {
      const classFolds = folds.filter((fold) =>
        fold.characterClass === characterClass
      );
      const errorsFor = (key) => classFolds.flatMap(({ results }) =>
        Object.values(results).map((result) => result[key])
      );
      const dictionary = summarizeErrors(errorsFor("dictionaryErrorPercent"));
      const classAdapted = summarizeErrors(errorsFor("adaptedErrorPercent"));
      return {
        characterClass,
        sampleCount: classFolds.length,
        dictionary,
        adapted: classAdapted,
        passed: classAdapted.meanAbsoluteErrorPercent < targetMaePercent,
      };
    });
  return {
    protocol: "maplescouter-comparison",
    estimator: "holdout-disjoint-donor-median",
    calibration: {
      kind: "research-only-leave-one-character-out-hierarchical-log",
      priorStrength,
    },
    targetMaePercent,
    counts: {
      validationRecordCount: baseRows.length,
      donorClassCount: signatures.size,
      classCount: classes.length,
      passedClassCount: classes.filter(({ passed }) => passed).length,
    },
    baseline: summarizeErrors(baselineErrors),
    dictionary: summarizeErrors(dictionaryErrors),
    adapted,
    passed: adapted.meanAbsoluteErrorPercent < targetMaePercent,
    classes,
    folds,
  };
}

export function evaluateNonDefenseMapleScouterMetrics({
  validationRows,
  targetMaePercent = 4,
  priorStrength = 2,
} = {}) {
  const rows = (validationRows ?? []).filter((row) => row?.ok !== false);
  const metrics = {};
  const allBaselineErrors = [];
  const allAdaptedErrors = [];
  for (const metric of NON_DEFENSE_METRICS) {
    const metricRows = rows.map((row) => ({
      characterClass: String(row?.apiClass ?? row?.characterClass ?? "").trim(),
      characterName: String(row?.characterName ?? "").trim(),
      estimate: finiteNumber(row?.actuals?.[metric]),
      reference: finiteNumber(row?.[metric]),
    })).filter(({ characterClass, estimate, reference }) =>
      characterClass && estimate > 0 && reference > 0
    );
    const baselineErrors = [];
    const adaptedErrors = [];
    const folds = [];
    for (const [index, holdout] of metricRows.entries()) {
      const training = metricRows.filter((_, other) => other !== index);
      const correction = fixedHierarchicalLogCorrection({
        trainingRows: training,
        characterClass: holdout.characterClass,
        estimateKey: "estimate",
        referenceKey: "reference",
        priorStrength,
      });
      const adapted = holdout.estimate * correction;
      const baselineError = absoluteErrorPercent(
        holdout.estimate,
        holdout.reference,
      );
      const adaptedError = absoluteErrorPercent(adapted, holdout.reference);
      baselineErrors.push(baselineError);
      adaptedErrors.push(adaptedError);
      folds.push({
        characterClass: holdout.characterClass,
        characterName: holdout.characterName,
        estimate: holdout.estimate,
        reference: holdout.reference,
        correction,
        adapted,
        baselineErrorPercent: baselineError,
        adaptedErrorPercent: adaptedError,
      });
    }
    allBaselineErrors.push(...baselineErrors);
    allAdaptedErrors.push(...adaptedErrors);
    const adapted = summarizeErrors(adaptedErrors);
    metrics[metric] = {
      baseline: summarizeErrors(baselineErrors),
      adapted,
      passed: adapted.meanAbsoluteErrorPercent < targetMaePercent,
      folds,
    };
  }
  const adapted = summarizeErrors(allAdaptedErrors);
  const classNames = [...new Set(Object.values(metrics).flatMap(({ folds }) =>
    folds.map(({ characterClass }) => characterClass)
  ))].sort((left, right) => left.localeCompare(right, "ko"));
  const classes = classNames.map((characterClass) => {
    const classFolds = Object.values(metrics).flatMap(({ folds }) =>
      folds.filter((fold) => fold.characterClass === characterClass)
    );
    const baseline = summarizeErrors(classFolds.map(
      ({ baselineErrorPercent }) => baselineErrorPercent,
    ));
    const classAdapted = summarizeErrors(classFolds.map(
      ({ adaptedErrorPercent }) => adaptedErrorPercent,
    ));
    return {
      characterClass,
      sampleCount: classFolds.length,
      baseline,
      adapted: classAdapted,
      passed: classAdapted.meanAbsoluteErrorPercent < targetMaePercent,
    };
  });
  return {
    protocol: "maplescouter-comparison-non-defense",
    calibration: {
      kind: "research-only-leave-one-character-out-hierarchical-log",
      priorStrength,
    },
    targetMaePercent,
    counts: {
      metricCount: NON_DEFENSE_METRICS.length,
      classCount: classes.length,
      passedClassCount: classes.filter(({ passed }) => passed).length,
    },
    baseline: summarizeErrors(allBaselineErrors),
    adapted,
    passed: adapted.meanAbsoluteErrorPercent < targetMaePercent &&
      Object.values(metrics).every((metric) => metric.passed),
    metrics,
    classes,
  };
}

/** MapleScouter가 제공한 방무 2개+비방무 5개를 한 묶음으로 요약한다. */
export function summarizeMapleScouterAllMetrics({
  defense,
  nonDefense,
  targetMaePercent = 4,
} = {}) {
  const rows = [];
  for (const fold of defense?.folds ?? []) {
    for (const [metric, result] of Object.entries(fold.results ?? {})) {
      rows.push({
        characterClass: fold.characterClass,
        characterName: fold.characterName,
        metric: `ignoreDefense${metric}`,
        baselineErrorPercent: result.dictionaryErrorPercent,
        adaptedErrorPercent: result.adaptedErrorPercent,
      });
    }
  }
  for (const [metric, report] of Object.entries(nonDefense?.metrics ?? {})) {
    for (const fold of report.folds ?? []) {
      rows.push({
        characterClass: fold.characterClass,
        characterName: fold.characterName,
        metric,
        baselineErrorPercent: fold.baselineErrorPercent,
        adaptedErrorPercent: fold.adaptedErrorPercent,
      });
    }
  }
  const classes = [...new Set(rows.map(({ characterClass }) => characterClass))]
    .sort((left, right) => left.localeCompare(right, "ko"))
    .map((characterClass) => {
      const classRows = rows.filter((row) =>
        row.characterClass === characterClass
      );
      const baseline = summarizeErrors(classRows.map(
        ({ baselineErrorPercent }) => baselineErrorPercent,
      ));
      const adapted = summarizeErrors(classRows.map(
        ({ adaptedErrorPercent }) => adaptedErrorPercent,
      ));
      return {
        characterClass,
        count: classRows.length,
        baseline,
        adapted,
        passed: adapted.meanAbsoluteErrorPercent < targetMaePercent,
      };
    });
  const baseline = summarizeErrors(rows.map(
    ({ baselineErrorPercent }) => baselineErrorPercent,
  ));
  const adapted = summarizeErrors(rows.map(
    ({ adaptedErrorPercent }) => adaptedErrorPercent,
  ));
  return {
    protocol: "maplescouter-comparison-all-seven-metrics",
    targetMaePercent,
    counts: {
      metricCount: 2 + NON_DEFENSE_METRICS.length,
      rowCount: rows.length,
      classCount: classes.length,
      passedClassCount: classes.filter(({ passed }) => passed).length,
    },
    baseline,
    adapted,
    passed: adapted.meanAbsoluteErrorPercent < targetMaePercent,
    classes,
  };
}
