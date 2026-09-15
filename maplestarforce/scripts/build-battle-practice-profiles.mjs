import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  buildBattlePracticeClassProfile,
  finalizeBattlePracticeProfileIdentity,
  renderBattlePracticeProfilesModule,
} from "./lib/battle-practice-profile.mjs";
import {
  BATTLE_PRACTICE_EXCLUDED_CLASSES,
  BATTLE_PRACTICE_JOB_CLASSES,
} from "./battle-practice-job-classes.mjs";

// 데몬어벤져는 현재 Open API의 HP 상한 때문에 잠재 환산 자체를 제공하지
// 않는다. 제논 전용 환산은 공통 공격 채널을 사용하므로 프로필을 배포한다.
const RUNTIME_UNSUPPORTED_CLASSES = new Set(BATTLE_PRACTICE_EXCLUDED_CLASSES);

function parseArguments(argv) {
  const parsed = { positional: [] };
  for (const argument of argv) {
    if (!argument.startsWith("--")) {
      parsed.positional.push(argument);
      continue;
    }
    const [key, ...rest] = argument.slice(2).split("=");
    parsed[key] = rest.length ? rest.join("=") : true;
  }
  return parsed;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function readJsonLines(path) {
  const text = await readFile(resolve(path), "utf8");
  return text.split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`${path}:${index + 1} JSON 형식이 잘못되었습니다.`);
      }
    });
}

function average(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function relativeErrorPercent(actual, reference) {
  return Number.isFinite(actual) && reference > 0
    ? (actual / reference - 1) * 100
    : null;
}

function blendedValue(row, suffix, confidence) {
  const baseline = Number(row[`unprofiled${suffix}`]);
  const profiled = Number(row[`actual${suffix}`]);
  return baseline + (profiled - baseline) * confidence;
}

function rowErrors(row, confidence) {
  return ["300", "380"].map((suffix) => relativeErrorPercent(
    blendedValue(row, suffix, confidence),
    Number(row[`ied${suffix}`]),
  ));
}

function validationReferenceKey(characterClass, characterName) {
  const normalizedClass = String(characterClass ?? "").trim().normalize("NFC");
  const normalizedName = String(characterName ?? "").trim().normalize("NFC");
  return normalizedClass && normalizedName
    ? `${normalizedClass}\u001f${normalizedName}`
    : null;
}

/**
 * 연무장 점유율은 donor 캐릭터의 방무·코어 상태가 섞인 관측값이다.
 * 0(전역 방무식)~1(관측 점유율식) 사이를 직업 단위로 축소하며, 두 보스
 * 방어율(300/380)을 함께 사용한다.
 */
function fittedBlendConfidence(rows) {
  let best = { confidence: 0, meanAbsoluteErrorPercent: Infinity };
  for (let step = 0; step <= 1_000; step += 1) {
    const confidence = step / 1_000;
    const errors = rows.flatMap((row) => rowErrors(row, confidence))
      .filter(Number.isFinite)
      .map(Math.abs);
    const score = average(errors);
    if (score !== null && score < best.meanAbsoluteErrorPercent) {
      best = { confidence, meanAbsoluteErrorPercent: score };
    }
  }
  return best;
}

function validationByClass(
  payload,
  maximumError,
  requireImprovement,
  minimumSamples,
  allowRobustImprovement,
  minimumImprovementRatio,
  trainingReferenceKeys = new Set(),
) {
  const latestByReference = new Map();
  const excludedTrainingReferenceKeysByClass = new Map();
  for (const row of Array.isArray(payload?.rows) ? payload.rows : []) {
    if (!row?.profileId) continue;
    const declaredClass = String(row?.characterClass ?? "").trim();
    const characterClass = String(
      row?.apiClass ?? row?.characterClass ?? "",
    ).trim();
    const characterName = String(row?.characterName ?? "").trim();
    if (
      !characterClass ||
      (declaredClass && row?.apiClass && declaredClass !== characterClass)
    ) continue;
    const trainingReferenceKey = validationReferenceKey(
      characterClass,
      characterName,
    );
    if (
      trainingReferenceKey && trainingReferenceKeys.has(trainingReferenceKey)
    ) {
      if (!excludedTrainingReferenceKeysByClass.has(characterClass)) {
        excludedTrainingReferenceKeysByClass.set(characterClass, new Set());
      }
      excludedTrainingReferenceKeysByClass.get(characterClass).add(
        trainingReferenceKey,
      );
      continue;
    }
    const referenceKey = trainingReferenceKey ??
      `${characterClass}\u001f__anonymous__`;
    const current = latestByReference.get(referenceKey);
    if (
      current?.profileHash && row?.profileHash &&
      current.profileHash !== row.profileHash
    ) {
      throw new Error(`${characterClass} ${characterName} 검증 프로필 해시가 충돌합니다.`);
    }
    if (
      current?.skillProfileHash && row?.skillProfileHash &&
      current.skillProfileHash !== row.skillProfileHash
    ) {
      throw new Error(
        `${characterClass} ${characterName} 검증 스킬 프로필 해시가 충돌합니다.`,
      );
    }
    latestByReference.set(referenceKey, row);
  }
  const grouped = new Map();
  for (const row of latestByReference.values()) {
    const characterClass = String(
      row?.apiClass ?? row?.characterClass ?? "",
    ).trim();
    const values = [
      row?.actual300,
      row?.actual380,
      row?.unprofiled300,
      row?.unprofiled380,
      row?.ied300,
      row?.ied380,
    ];
    if (
      !characterClass || values.some((value) =>
        value === null || value === undefined || !Number.isFinite(Number(value))
      ) ||
      !(Number(row?.ied300) > 0) || !(Number(row?.ied380) > 0)
    ) continue;
    if (!grouped.has(characterClass)) grouped.set(characterClass, []);
    grouped.get(characterClass).push(row);
  }
  const classes = new Map([...grouped].map(([characterClass, rows]) => {
    const fitted = fittedBlendConfidence(rows);
    const afterErrorsByRow = rows.map((row) =>
      rowErrors(row, fitted.confidence)
    );
    const beforeErrorsByRow = rows.map((row) => [
      Number(row.unprofiledError300Percent),
      Number(row.unprofiledError380Percent),
    ]);
    const afterAbsolute = afterErrorsByRow.flat().map(Math.abs);
    const beforeAbsolute = beforeErrorsByRow.flat().map(Math.abs);
    const after380Absolute = afterErrorsByRow.map((errors) =>
      Math.abs(errors[1])
    );
    const before380Absolute = beforeErrorsByRow.map((errors) =>
      Math.abs(errors[1])
    );
    const meanAbsoluteErrorPercent = average(afterAbsolute);
    const baselineMeanAbsoluteErrorPercent = average(beforeAbsolute);
    const maximumAbsoluteErrorPercent = Math.max(...afterAbsolute);
    const improved = meanAbsoluteErrorPercent < baselineMeanAbsoluteErrorPercent;
    const improvementRatio = baselineMeanAbsoluteErrorPercent > 0
      ? (baselineMeanAbsoluteErrorPercent - meanAbsoluteErrorPercent) /
        baselineMeanAbsoluteErrorPercent
      : 0;

    // 한 캐릭터를 완전히 제외하고 나머지 네 캐릭터로 신뢰도를 다시
    // 정하는 5-fold 검증이다. 같은 다섯 명을 맞춘 값을 검증값으로
    // 재사용하는 누수를 피한다.
    const leaveOneOut = rows.map((row, index) => {
      const training = rows.filter((_, otherIndex) => otherIndex !== index);
      const fold = fittedBlendConfidence(training);
      const errors = rowErrors(row, fold.confidence);
      const baselineErrors = beforeErrorsByRow[index];
      const absoluteErrors = errors.map(Math.abs);
      const baselineAbsoluteErrors = baselineErrors.map(Math.abs);
      return {
        confidence: fold.confidence,
        errors,
        improved: average(absoluteErrors) < average(baselineAbsoluteErrors),
        withinThreshold: absoluteErrors.every((error) => error <= maximumError),
        absolutePointErrors: ["300", "380"].map((suffix) => Math.abs(
          blendedValue(row, suffix, fold.confidence) - Number(row[`ied${suffix}`]),
        )),
      };
    });
    const crossValidatedAbsoluteErrors = leaveOneOut.flatMap(({ errors }) =>
      errors.map(Math.abs)
    );
    const crossValidatedPointErrors = leaveOneOut.flatMap(
      ({ absolutePointErrors }) => absolutePointErrors,
    );
    const crossValidatedMeanAbsoluteErrorPercent = average(
      crossValidatedAbsoluteErrors,
    );
    const crossValidatedBaselineMeanAbsoluteErrorPercent = average(
      beforeAbsolute,
    );
    const crossValidatedImprovementRatio =
      crossValidatedBaselineMeanAbsoluteErrorPercent > 0
        ? (
            crossValidatedBaselineMeanAbsoluteErrorPercent -
            crossValidatedMeanAbsoluteErrorPercent
          ) / crossValidatedBaselineMeanAbsoluteErrorPercent
        : 0;
    const improvedReferenceCount = leaveOneOut.filter(
      ({ improved: rowImproved }) => rowImproved,
    ).length;
    const withinThresholdReferenceCount = leaveOneOut.filter(
      ({ withinThreshold }) => withinThreshold,
    ).length;
    const requiredFourOfFive = Math.ceil(rows.length * 0.8);
    const requiredThreeOfFive = Math.ceil(rows.length * 0.6);
    const crossValidatedMedianAbsoluteErrorPercent = median(
      crossValidatedAbsoluteErrors,
    );
    const crossValidatedMaximumAbsoluteErrorPercent = Math.max(
      ...crossValidatedAbsoluteErrors,
    );
    const crossValidatedMedianAbsolutePointError = median(
      crossValidatedPointErrors,
    );
    const hasMaterialProfile = fitted.confidence >= 0.05;
    const strictPassed = rows.length >= minimumSamples && hasMaterialProfile &&
      improvedReferenceCount >= requiredFourOfFive &&
      withinThresholdReferenceCount >= requiredFourOfFive &&
      crossValidatedMedianAbsoluteErrorPercent <= Math.min(15, maximumError) &&
      crossValidatedMaximumAbsoluteErrorPercent <= 35 &&
      crossValidatedMedianAbsolutePointError <= 1.5 &&
      (!requireImprovement || improved);
    const robustImprovementPassed = allowRobustImprovement &&
      rows.length >= minimumSamples && hasMaterialProfile &&
      improvedReferenceCount >= requiredThreeOfFive &&
      withinThresholdReferenceCount >= requiredThreeOfFive &&
      crossValidatedMedianAbsoluteErrorPercent <= Math.min(15, maximumError) &&
      crossValidatedMaximumAbsoluteErrorPercent <= 45 &&
      crossValidatedMedianAbsolutePointError <= 2.5 &&
      improved && crossValidatedImprovementRatio >= minimumImprovementRatio;
    const directionalImprovementPassed = allowRobustImprovement &&
      rows.length >= minimumSamples && hasMaterialProfile &&
      improvedReferenceCount === rows.length &&
      withinThresholdReferenceCount >= Math.ceil(rows.length * 0.4) &&
      crossValidatedMedianAbsoluteErrorPercent <= 25 &&
      crossValidatedMaximumAbsoluteErrorPercent <= 35 &&
      crossValidatedMedianAbsolutePointError <= 2 &&
      crossValidatedImprovementRatio >= minimumImprovementRatio && improved;
    return [characterClass, {
      referenceCount: rows.length,
      validatedProfileIds: [...new Set(rows.map((row) => row.profileId))],
      validatedProfileHashes: [
        ...new Set(rows.map((row) => row.profileHash).filter(Boolean)),
      ],
      validatedSkillProfileHashes: [
        ...new Set(rows.map((row) => row.skillProfileHash).filter(Boolean)),
      ],
      missingSkillProfileHashCount: rows.filter(
        (row) => !row.skillProfileHash,
      ).length,
      conversionVersions: [
        ...new Set(rows.map((row) => row.conversionVersion).filter(Boolean)),
      ],
      blendConfidence: fitted.confidence,
      meanAbsoluteErrorPercent,
      baselineMeanAbsoluteErrorPercent,
      meanAbsoluteError380Percent: average(after380Absolute),
      baselineMeanAbsoluteError380Percent: average(before380Absolute),
      maximumAbsoluteErrorPercent,
      improved,
      improvementRatio,
      crossValidation: {
        method: "leave-one-character-out",
        improvedReferenceCount,
        withinThresholdReferenceCount,
        medianAbsoluteErrorPercent: crossValidatedMedianAbsoluteErrorPercent,
        maximumAbsoluteErrorPercent: crossValidatedMaximumAbsoluteErrorPercent,
        medianAbsolutePointError: crossValidatedMedianAbsolutePointError,
        meanAbsoluteErrorPercent: crossValidatedMeanAbsoluteErrorPercent,
        baselineMeanAbsoluteErrorPercent:
          crossValidatedBaselineMeanAbsoluteErrorPercent,
        improvementRatio: crossValidatedImprovementRatio,
        foldConfidences: leaveOneOut.map(({ confidence }) => confidence),
      },
      strictPassed,
      robustImprovementPassed,
      directionalImprovementPassed,
      passed: strictPassed || robustImprovementPassed ||
        directionalImprovementPassed,
      grade: strictPassed
        ? "strict"
        : robustImprovementPassed
          ? "cross-validated"
          : directionalImprovementPassed
            ? "directional-improvement"
            : "failed",
    }];
  }));
  return {
    classes,
    excludedTrainingReferencesByClass: new Map(
      [...excludedTrainingReferenceKeysByClass].map(
        ([characterClass, keys]) => [characterClass, keys.size],
      ),
    ),
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const inputPaths = [
    ...options.positional,
    ...String(options.input ?? "").split(",").filter(Boolean),
  ];
  if (!inputPaths.length) {
    throw new Error("원본 JSONL 경로를 하나 이상 입력하세요.");
  }
  const records = (await Promise.all(inputPaths.map(readJsonLines))).flat();
  const trainingReferenceKeys = new Set(
    records.map((record) => validationReferenceKey(
      record?.characterClass,
      record?.characterName,
    )).filter(Boolean),
  );
  const byClass = new Map();
  for (const record of records) {
    const characterClass = String(record?.characterClass ?? "").trim();
    if (!characterClass) continue;
    if (!byClass.has(characterClass)) byClass.set(characterClass, []);
    byClass.get(characterClass).push(record);
  }

  const minimumSamples = positiveNumber(options["minimum-samples"], 3);
  const maximumSamples = positiveNumber(options["maximum-samples"], 7);
  const includeProvisional = Boolean(options["include-provisional"]);
  const maximumValidationError = positiveNumber(
    options["maximum-validation-error"],
    20,
  );
  const requireValidationImprovement = Boolean(
    options["require-validation-improvement"],
  );
  const requireValidation = Boolean(options["require-validation"]);
  const minimumValidationSamples = positiveNumber(
    options["minimum-validation-samples"],
    5,
  );
  const allowRobustValidationImprovement = Boolean(
    options["allow-robust-validation-improvement"],
  );
  const minimumValidationImprovementRatio = positiveNumber(
    options["minimum-validation-improvement-ratio"],
    0.25,
  );
  const validationPaths = String(options.validation ?? "")
    .split(",")
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path) => resolve(path));
  const validationResult = validationPaths.length
    ? validationByClass(
      {
        rows: (await Promise.all(validationPaths.map(async (path) =>
          JSON.parse(await readFile(path, "utf8"))
        ))).flatMap((payload) => payload?.rows ?? []),
      },
      maximumValidationError,
      requireValidationImprovement,
      minimumValidationSamples,
      allowRobustValidationImprovement,
      minimumValidationImprovementRatio,
      trainingReferenceKeys,
    )
    : {
      classes: new Map(),
      excludedTrainingReferencesByClass: new Map(),
    };
  const validation = validationResult.classes;
  const profiles = {};
  const report = {};
  const expectedClasses = new Set(
    BATTLE_PRACTICE_JOB_CLASSES
      .map(({ characterClass }) => characterClass)
      .filter((characterClass) =>
        !RUNTIME_UNSUPPORTED_CLASSES.has(characterClass)
      ),
  );
  const allClasses = new Set([...expectedClasses, ...byClass.keys()]);
  for (const characterClass of [...allClasses].sort((left, right) =>
    left.localeCompare(right, "ko")
  )) {
    if (RUNTIME_UNSUPPORTED_CLASSES.has(characterClass)) continue;
    const result = buildBattlePracticeClassProfile(
      characterClass,
      byClass.get(characterClass) ?? [],
      {
        minSamples: minimumSamples,
        maxSamples: maximumSamples,
        maximumMedianPairDistance: positiveNumber(
          options["maximum-median-distance"],
          0.12,
        ),
      },
    );
    const classValidation = validation.get(characterClass) ?? null;
    const stableEnough = Boolean(
      result.profile && (result.selection.stable || includeProvisional),
    );
    const validatedSkillHashes =
      classValidation?.validatedSkillProfileHashes ?? [];
    const validatedHashes = classValidation?.validatedProfileHashes ?? [];
    const validatedIds = classValidation?.validatedProfileIds ?? [];
    const validationArtifactMode = !classValidation
      ? "missing"
      : validatedSkillHashes.length
        ? "skill-profile-hash"
        : validatedHashes.length
          ? "legacy-profile-hash"
          : "legacy-v1-id";
    const validationArtifactMatched = !classValidation
      ? !requireValidation
      : validatedSkillHashes.length
        ? validatedSkillHashes.length === 1 &&
          classValidation.missingSkillProfileHashCount === 0 &&
          validatedSkillHashes[0] === result.profile?.skillProfileHash
        : validatedHashes.length
          ? validatedHashes.length === 1 &&
            validatedHashes[0] === result.profile?.profileHash
          : validatedIds.length === 1 &&
            validatedIds[0] === `${characterClass}-auto-cycle-v1`;
    const validationPassed = (
      Boolean(classValidation?.passed) && validationArtifactMatched
    ) || (!requireValidation && !classValidation);
    const runtimeSupported = !RUNTIME_UNSUPPORTED_CLASSES.has(characterClass);
    const deployed = stableEnough && validationPassed && runtimeSupported;
    const calibratedProfile = result.profile && classValidation
      ? finalizeBattlePracticeProfileIdentity(characterClass, {
        ...result.profile,
        iedBlendConfidence: classValidation.blendConfidence,
      })
      : result.profile;
    report[characterClass] = {
      stable: result.selection.stable,
      reason: result.selection.reason,
      acceptedSamples: result.selection.accepted.length,
      rejectedSamples: result.selection.rejected.length,
      duplicateSamples: result.selection.duplicateCount ?? 0,
      medianPairDistance: result.selection.medianPairDistance,
      maximumPairDistance: result.selection.maximumPairDistance ?? null,
      recordDateRange: result.profile?.recordDateRange ?? null,
      playTimeMilliseconds: result.profile?.playTimeMilliseconds ?? null,
      topSkillShares: (result.profile?.skillShares ?? []).slice(0, 8),
      sourceSkillProfileHash: result.profile?.skillProfileHash ?? null,
      sourceProfileHash: result.profile?.profileHash ?? null,
      skillProfileHash: calibratedProfile?.skillProfileHash ?? null,
      profileHash: calibratedProfile?.profileHash ?? null,
      validation: classValidation,
      excludedTrainingValidationReferences:
        validationResult.excludedTrainingReferencesByClass.get(
          characterClass,
        ) ?? 0,
      validationArtifactMode,
      validationArtifactMatched,
      runtimeSupported,
      deployed,
      deploymentReason: !stableEnough
        ? result.selection.reason ?? "profile-unavailable"
        : !runtimeSupported
          ? "special-stat-model-unimplemented"
        : !classValidation && requireValidation
          ? "external-validation-missing"
          : !validationArtifactMatched
            ? "external-validation-profile-mismatch"
          : validationPassed
            ? null
            : "external-validation-failed",
    };
    if (deployed) {
      profiles[characterClass] = calibratedProfile;
    }
  }

  const outputPath = resolve(String(
    options.output ??
      "tools/battle-practice-dataset/generated/class-damage-profiles.js",
  ));
  const reportPath = resolve(String(
    options.report ?? `${outputPath}.report.json`,
  ));
  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(outputPath, renderBattlePracticeProfilesModule(profiles), "utf8");
  await writeFile(reportPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    inputFiles: inputPaths.map((path) => resolve(path)),
    minimumSamples,
    maximumSamples,
    includeProvisional,
    validationPaths,
    maximumValidationError,
    requireValidationImprovement,
    requireValidation,
    minimumValidationSamples,
    allowRobustValidationImprovement,
    minimumValidationImprovementRatio,
    excludedTrainingValidationReferenceCount: [
      ...validationResult.excludedTrainingReferencesByClass.values(),
    ].reduce((sum, count) => sum + count, 0),
    profileCount: Object.keys(profiles).length,
    classes: report,
  }, null, 2)}\n`, "utf8");
  process.stdout.write(`계산 프로필 ${Object.keys(profiles).length}개: ${outputPath}\n`);
  process.stdout.write(`품질 보고서: ${reportPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
