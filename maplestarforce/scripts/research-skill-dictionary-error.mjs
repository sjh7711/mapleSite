import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { BATTLE_PRACTICE_EXCLUDED_CLASSES } from "./battle-practice-job-classes.mjs";
import { characterReferenceKey } from "./lib/character-exclusions.mjs";

const DEFAULT_VALIDATION_PATHS = [
  "tools/battle-practice-dataset/generated/validation-maplescouter-final15-holdout-20260909-v59.json",
  "tools/battle-practice-dataset/generated/validation-maplescouter-all-jobs-20260909-v1.json",
];
const DEFAULT_PROFILE_REPORT_PATH =
  "tools/battle-practice-dataset/generated/class-damage-profiles-quality-holdout-v11.report.json";
const DEFAULT_OUTPUT_PATH =
  "tools/battle-practice-dataset/generated/skill-dictionary-error-report.json";

function parseArguments(argv) {
  const options = { positional: [] };
  for (const argument of argv) {
    if (!argument.startsWith("--")) {
      options.positional.push(argument);
      continue;
    }
    const separatorIndex = argument.indexOf("=");
    const key = argument.slice(2, separatorIndex < 0 ? undefined : separatorIndex);
    const value = separatorIndex < 0 ? true : argument.slice(separatorIndex + 1);
    if (options[key] === undefined) options[key] = value;
    else if (Array.isArray(options[key])) options[key].push(value);
    else options[key] = [options[key], value];
  }
  return options;
}

function scalarOption(value, fallback = "") {
  return Array.isArray(value) ? value.at(-1) : value ?? fallback;
}

function listOption(value) {
  return (Array.isArray(value) ? value : [value])
    .filter((entry) => entry !== undefined && entry !== true)
    .flatMap((entry) => String(entry).split(/[|;]/u))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function booleanOption(value) {
  const scalar = scalarOption(value, false);
  if (scalar === true) return true;
  return !new Set([false, "", "false", "0", "no"]).has(scalar);
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function mean(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function absoluteRelativeErrorPercent(estimate, reference) {
  return Number.isFinite(estimate) && reference > 0
    ? Math.abs((estimate / reference - 1) * 100)
    : null;
}

function round(value, places = 6) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function recordsFromValue(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["rows", "records", "references"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [value];
}

export function parseResearchRecords(text, source = "입력") {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return [];
  try {
    return recordsFromValue(JSON.parse(trimmed));
  } catch {
    return trimmed.split(/\r?\n/u).filter(Boolean).flatMap((line, index) => {
      try {
        return recordsFromValue(JSON.parse(line));
      } catch {
        throw new Error(`${source}:${index + 1} JSON 형식이 잘못되었습니다.`);
      }
    });
  }
}

function selectedProfile(classReport, profilePolicy) {
  if (!classReport || profilePolicy === "none") return false;
  if (profilePolicy === "deployed") return classReport.deployed === true;
  if (profilePolicy === "passed") {
    return classReport.validation?.passed === true &&
      classReport.runtimeSupported !== false;
  }
  if (profilePolicy === "validated") {
    return Boolean(classReport.validation) &&
      classReport.validationArtifactMatched === true &&
      classReport.runtimeSupported !== false;
  }
  if (profilePolicy === "raw") return true;
  throw new Error(
    "profilePolicy는 validated, deployed, passed, raw, none 중 하나여야 합니다.",
  );
}

function profileConfidence(classReport, profilePolicy) {
  if (!selectedProfile(classReport, profilePolicy)) return 0;
  if (profilePolicy === "raw") return 1;
  const value = Number(
    classReport?.validation?.blendConfidence ??
      classReport?.iedBlendConfidence ?? 1,
  );
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

function classRowsByPriority(validationArtifacts, expectedClasses) {
  const selected = new Map();
  const sources = new Map();
  for (const characterClass of expectedClasses) {
    for (const artifact of validationArtifacts) {
      const rows = recordsFromValue(artifact.payload).filter((row) =>
        String(row?.characterClass ?? row?.apiClass ?? "").trim() ===
          characterClass
      );
      if (!rows.length) continue;
      selected.set(characterClass, rows);
      sources.set(characterClass, artifact.path ?? "memory");
      break;
    }
  }
  return { selected, sources };
}

function observedHashIssue(characterClass, rows, classReport, key, reportKeys) {
  if (!classReport) return null;
  const expected = reportKeys.map((reportKey) => classReport?.[reportKey])
    .find(Boolean);
  const observed = [...new Set(rows.map((row) => row?.[key]).filter(Boolean))];
  if (!expected || !observed.length) return null;
  return observed.every((hash) => hash === expected)
    ? null
    : {
      characterClass,
      kind: key,
      expected,
      observed,
    };
}

/**
 * 새 스킬 사전/직업 프로필 후보를 외부 5표본으로 평가한다.
 *
 * validationArtifacts는 앞쪽 파일이 직업 단위로 우선한다. 예를 들어 최신
 * 15직업 holdout을 첫 번째, 기존 전 직업 파일을 두 번째에 두면 두 데이터가
 * 한 직업 안에서 섞이지 않는다.
 */
export function buildSkillDictionaryErrorReport({
  validationArtifacts,
  profileReport,
  trainingRecords = [],
  trainingInputPaths = [],
  trainingCheckPerformed = true,
  expectedClasses,
  expectedClassCount,
  samplesPerClass = 5,
  targetMaePercent = 4,
  profilePolicy = "validated",
}) {
  if (!Array.isArray(validationArtifacts) || !validationArtifacts.length) {
    throw new Error("validationArtifacts가 필요합니다.");
  }
  // 가장 낮은 우선순위의 전 직업 검증 파일을 roster로 삼는다. 신규 직업이
  // 직업 사전에 먼저 추가돼도 5표본이 생기기 전 기존 연구가 흔들리지 않는다.
  const rosterSource = expectedClasses ?? recordsFromValue(
    validationArtifacts.at(-1)?.payload,
  ).map((row) => row?.characterClass ?? row?.apiClass);
  const expected = [...new Set(rosterSource.map((value) => String(value).trim()))]
    .filter(Boolean)
    .filter((characterClass) =>
      !BATTLE_PRACTICE_EXCLUDED_CLASSES.includes(characterClass)
    );
  if (!expected.length) throw new Error("평가할 직업이 없습니다.");
  const requiredClassCount = expectedClassCount === undefined ||
      expectedClassCount === null
    ? expected.length
    : Math.max(1, Math.floor(Number(expectedClassCount) || 0));
  const samples = Math.max(1, Math.floor(Number(samplesPerClass) || 0));
  const target = Number(targetMaePercent);
  if (!(target > 0)) throw new Error("targetMaePercent는 0보다 커야 합니다.");
  // 잘못된 정책은 프로필이 하나도 없어도 즉시 검출한다.
  selectedProfile({}, profilePolicy);

  const { selected, sources } = classRowsByPriority(
    validationArtifacts,
    expected,
  );
  const expectedSet = new Set(expected);
  const trainingKeys = new Set(trainingRecords.map((record) =>
    characterReferenceKey(
      record?.apiClass ?? record?.characterClass,
      record?.characterName,
    )
  ).filter(Boolean));
  const overlapByKey = new Map();
  const duplicateHoldoutKeys = new Set();
  const invalidRows = [];
  const hashIssues = [];
  const classResults = [];
  const allCurrent300 = [];
  const allCurrent380 = [];
  const allBaseline300 = [];
  const allBaseline380 = [];

  for (const characterClass of expected) {
    const rows = selected.get(characterClass) ?? [];
    const classReport = profileReport?.classes?.[characterClass] ?? null;
    const useProfile = selectedProfile(classReport, profilePolicy);
    const confidence = profileConfidence(classReport, profilePolicy);
    const seenKeys = new Set();
    const errors300 = [];
    const errors380 = [];
    const baselineErrors300 = [];
    const baselineErrors380 = [];
    const matchedShares = [];
    const generalShares = [];
    const unmatchedSkills = new Set();

    for (const [index, row] of rows.entries()) {
      const rowClass = String(row?.characterClass ?? row?.apiClass ?? "").trim();
      const key = characterReferenceKey(rowClass, row?.characterName);
      if (!key || seenKeys.has(key)) {
        if (key) duplicateHoldoutKeys.add(key);
        else invalidRows.push({ characterClass, index, reason: "missing-reference-key" });
      } else {
        seenKeys.add(key);
      }
      if (key && trainingKeys.has(key)) {
        overlapByKey.set(key, {
          characterClass,
          characterName: String(row.characterName),
        });
      }

      const reference300 = finitePositive(row?.ied300);
      const reference380 = finitePositive(row?.ied380);
      const baseline300 = finitePositive(row?.unprofiled300);
      const baseline380 = finitePositive(row?.unprofiled380);
      const profiled300 = useProfile ? finitePositive(row?.actual300) : baseline300;
      const profiled380 = useProfile ? finitePositive(row?.actual380) : baseline380;
      if (
        row?.ok === false || !reference300 || !reference380 ||
        !baseline300 || !baseline380 || !profiled300 || !profiled380
      ) {
        invalidRows.push({
          characterClass,
          characterName: row?.characterName ?? null,
          index,
          reason: "invalid-validation-values",
        });
        continue;
      }
      const current300 = baseline300 + (profiled300 - baseline300) * confidence;
      const current380 = baseline380 + (profiled380 - baseline380) * confidence;
      errors300.push(absoluteRelativeErrorPercent(current300, reference300));
      errors380.push(absoluteRelativeErrorPercent(current380, reference380));
      baselineErrors300.push(
        absoluteRelativeErrorPercent(baseline300, reference300),
      );
      baselineErrors380.push(
        absoluteRelativeErrorPercent(baseline380, reference380),
      );

      const matchedShare = Number(row?.combatDiagnostics?.matchedLocalChannelShare);
      const generalShare = Number(row?.combatDiagnostics?.generalChannelShare);
      if (Number.isFinite(matchedShare)) matchedShares.push(matchedShare);
      if (Number.isFinite(generalShare)) generalShares.push(generalShare);
      for (const skill of row?.combatDiagnostics?.unmatchedLocalSkills ?? []) {
        const normalized = String(skill).trim();
        if (normalized) unmatchedSkills.add(normalized);
      }
    }

    if (useProfile) {
      for (const issue of [
        observedHashIssue(
          characterClass,
          rows,
          classReport,
          "skillProfileHash",
          ["sourceSkillProfileHash", "skillProfileHash"],
        ),
        observedHashIssue(
          characterClass,
          rows,
          classReport,
          "profileHash",
          ["sourceProfileHash"],
        ),
      ]) {
        if (issue) hashIssues.push(issue);
      }
    }

    const combinedErrors = [...errors300, ...errors380];
    const combinedBaselineErrors = [
      ...baselineErrors300,
      ...baselineErrors380,
    ];
    const mae300 = mean(errors300);
    const mae380 = mean(errors380);
    const combinedMae = mean(combinedErrors);
    const baselineCombinedMae = mean(combinedBaselineErrors);
    const improvementPercent = baselineCombinedMae > 0 && combinedMae !== null
      ? (baselineCombinedMae - combinedMae) / baselineCombinedMae * 100
      : null;
    const complete = rows.length === samples &&
      errors300.length === samples && errors380.length === samples &&
      seenKeys.size === samples;
    const passed = complete && combinedMae < target;
    classResults.push({
      characterClass,
      sourcePath: sources.get(characterClass) ?? null,
      referenceCount: rows.length,
      validReferenceCount: errors300.length,
      model: useProfile ? "profile" : "common",
      profilePolicy,
      profileConfidence: round(confidence, 3),
      profileId: useProfile
        ? classReport?.id ?? classReport?.profileId ?? null
        : null,
      mae300Percent: round(mae300),
      mae380Percent: round(mae380),
      combinedMaePercent: round(combinedMae),
      baselineCombinedMaePercent: round(baselineCombinedMae),
      improvementPercent: round(improvementPercent),
      maximumAbsoluteErrorPercent: combinedErrors.length
        ? round(Math.max(...combinedErrors))
        : null,
      targetMaePercent: target,
      passed,
      dictionaryDiagnostics: {
        meanMatchedLocalChannelShare: round(mean(matchedShares)),
        meanGeneralChannelShare: round(mean(generalShares)),
        unmatchedSkillCount: unmatchedSkills.size,
        unmatchedSkills: [...unmatchedSkills].sort((left, right) =>
          left.localeCompare(right, "ko")
        ),
      },
    });
    allCurrent300.push(...errors300);
    allCurrent380.push(...errors380);
    allBaseline300.push(...baselineErrors300);
    allBaseline380.push(...baselineErrors380);
  }

  const presentClasses = new Set();
  for (const artifact of validationArtifacts) {
    for (const row of recordsFromValue(artifact.payload)) {
      const characterClass = String(
        row?.characterClass ?? row?.apiClass ?? "",
      ).trim();
      if (characterClass &&
        !BATTLE_PRACTICE_EXCLUDED_CLASSES.includes(characterClass)) {
        presentClasses.add(characterClass);
      }
    }
  }
  const missingClasses = expected.filter((characterClass) =>
    !selected.has(characterClass)
  );
  const unexpectedClasses = [...presentClasses].filter((characterClass) =>
    !expectedSet.has(characterClass)
  ).sort((left, right) => left.localeCompare(right, "ko"));
  const sampleCountMismatches = classResults.filter(({ referenceCount }) =>
    referenceCount !== samples
  ).map(({ characterClass, referenceCount }) => ({
    characterClass,
    expected: samples,
    actual: referenceCount,
  }));
  const overlap = [...overlapByKey.values()].sort((left, right) =>
    left.characterClass.localeCompare(right.characterClass, "ko") ||
      left.characterName.localeCompare(right.characterName, "ko")
  );
  const calibrationPaths = new Set(
    (profileReport?.validationPaths ?? []).map((path) => resolve(String(path))),
  );
  // blendConfidence를 맞추는 데 쓴 검증 파일을 최종 성능 측정에 다시 쓰면
  // 캐릭터 이름이 달라도 오차가 낙관적으로 보인다. 별도 holdout을 강제한다.
  const calibrationArtifactOverlaps = classResults
    .filter(({ model, sourcePath }) =>
      model === "profile" && sourcePath &&
        calibrationPaths.has(resolve(String(sourcePath)))
    )
    .map(({ characterClass, sourcePath }) => ({
      characterClass,
      sourcePath,
    }));
  const currentCombined = [...allCurrent300, ...allCurrent380];
  const baselineCombined = [...allBaseline300, ...allBaseline380];
  const currentCombinedMae = mean(currentCombined);
  const baselineCombinedMae = mean(baselineCombined);
  const completenessPassed = missingClasses.length === 0 &&
    unexpectedClasses.length === 0 && sampleCountMismatches.length === 0 &&
    duplicateHoldoutKeys.size === 0 && invalidRows.length === 0 &&
    classResults.length === expected.length && expected.length === requiredClassCount;
  const leakagePassed = trainingCheckPerformed && overlap.length === 0 &&
    calibrationArtifactOverlaps.length === 0;
  const targetPassed = classResults.every(({ passed }) => passed);
  const hashIntegrityPassed = hashIssues.length === 0;
  const failureReasons = [];
  if (!completenessPassed) failureReasons.push("incomplete-holdout-set");
  if (!trainingCheckPerformed) failureReasons.push("training-holdout-check-not-performed");
  else if (overlap.length) failureReasons.push("training-holdout-leakage");
  if (calibrationArtifactOverlaps.length) {
    failureReasons.push("profile-calibration-holdout-reuse");
  }
  if (!hashIntegrityPassed) failureReasons.push("profile-artifact-hash-mismatch");
  if (!targetPassed) failureReasons.push("class-mae-target-missed");

  const fingerprintRows = classResults.map((result) => ({
    characterClass: result.characterClass,
    sourcePath: result.sourcePath,
    referenceCount: result.referenceCount,
    profileConfidence: result.profileConfidence,
    mae300Percent: result.mae300Percent,
    mae380Percent: result.mae380Percent,
  }));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: failureReasons.length ? "failed" : "passed",
    target: {
      expectedClassCount: expected.length,
      requiredClassCount,
      samplesPerClass: samples,
      targetMaePercent: target,
      passRule: `combinedMaePercent < ${target}`,
      excludedClasses: [...BATTLE_PRACTICE_EXCLUDED_CLASSES],
    },
    profilePolicy,
    counts: {
      classCount: classResults.length,
      profiledClassCount: classResults.filter(({ model }) =>
        model === "profile").length,
      passedClassCount: classResults.filter(({ passed }) => passed).length,
      failedClassCount: classResults.filter(({ passed }) => !passed).length,
      referenceCount: classResults.reduce(
        (sum, { referenceCount }) => sum + referenceCount,
        0,
      ),
      validReferenceCount: allCurrent300.length,
      errorObservationCount: currentCombined.length,
    },
    aggregate: {
      mae300Percent: round(mean(allCurrent300)),
      mae380Percent: round(mean(allCurrent380)),
      combinedMaePercent: round(currentCombinedMae),
      baselineCombinedMaePercent: round(baselineCombinedMae),
      improvementPercent: baselineCombinedMae > 0
        ? round(
          (baselineCombinedMae - currentCombinedMae) /
            baselineCombinedMae * 100,
        )
        : null,
      maximumAbsoluteErrorPercent: currentCombined.length
        ? round(Math.max(...currentCombined))
        : null,
    },
    integrity: {
      completenessPassed,
      hashIntegrityPassed,
      trainingHoldoutLeakage: {
        checked: trainingCheckPerformed,
        passed: leakagePassed,
        trainingInputPaths,
        trainingReferenceCount: trainingKeys.size,
        overlapCount: overlap.length,
        overlappingReferences: overlap,
        calibrationArtifactOverlapCount: calibrationArtifactOverlaps.length,
        calibrationArtifactOverlaps,
      },
      missingClasses,
      unexpectedClasses,
      sampleCountMismatches,
      rosterCountMismatch: expected.length === requiredClassCount
        ? null
        : { expected: requiredClassCount, actual: expected.length },
      duplicateHoldoutKeys: [...duplicateHoldoutKeys].sort(),
      invalidRows,
      hashIssues,
    },
    failureReasons,
    inputFingerprint: sha256(JSON.stringify(fingerprintRows)),
    classes: classResults,
  };
}

function displayPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)}%` : "—";
}

function escapeCell(value) {
  return String(value ?? "—").replaceAll("|", "\\|");
}

export function renderSkillDictionaryErrorMarkdown(report) {
  const lines = [
    "# 스킬 사전·직업 프로필 방무 오차 보고서",
    "",
    `- 상태: **${report.status.toUpperCase()}**`,
    `- 평가: ${report.counts.classCount}직업 · ${report.counts.referenceCount}명 · ${report.counts.errorObservationCount}개 방무 오차`,
    `- 통합 MAE: **${displayPercent(report.aggregate.combinedMaePercent)}**`,
    `- 목표 통과: **${report.counts.passedClassCount}/${report.counts.classCount}직업** (직업별 통합 MAE < ${report.target.targetMaePercent}%)`,
    `- 훈련/홀드아웃 누수: **${report.integrity.trainingHoldoutLeakage.overlapCount}건**`,
    `- 프로필 보정/최종평가 파일 재사용: **${report.integrity.trainingHoldoutLeakage.calibrationArtifactOverlapCount}직업**`,
    "",
    "| 직업 | 모델 | 300% MAE | 380% MAE | 통합 MAE | 기준 MAE | 개선율 | 최대 오차 | 판정 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const result of report.classes) {
    const model = result.model === "profile"
      ? `프로필 ${result.profileConfidence.toFixed(3)}`
      : "공통";
    lines.push([
      `| ${escapeCell(result.characterClass)}`,
      escapeCell(model),
      displayPercent(result.mae300Percent),
      displayPercent(result.mae380Percent),
      displayPercent(result.combinedMaePercent),
      displayPercent(result.baselineCombinedMaePercent),
      displayPercent(result.improvementPercent),
      displayPercent(result.maximumAbsoluteErrorPercent),
      result.passed ? "PASS" : "FAIL",
      "|",
    ].join(" | "));
  }
  if (report.integrity.trainingHoldoutLeakage.overlapCount) {
    lines.push("", "## 훈련/홀드아웃 중복", "");
    for (const reference of
      report.integrity.trainingHoldoutLeakage.overlappingReferences) {
      lines.push(`- ${reference.characterClass} · ${reference.characterName}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function loadValidationArtifacts(paths) {
  return Promise.all(paths.map(async (path) => {
    const absolutePath = resolve(path);
    return {
      path: absolutePath,
      payload: JSON.parse(await readFile(absolutePath, "utf8")),
    };
  }));
}

async function loadTrainingRecords(paths) {
  const records = [];
  for (const path of paths) {
    records.push(...parseResearchRecords(
      await readFile(path, "utf8"),
      path,
    ));
  }
  return records;
}

async function writeText(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf8");
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const validationPaths = listOption(options.validation);
  if (!validationPaths.length) validationPaths.push(...DEFAULT_VALIDATION_PATHS);
  const profileReportPath = resolve(String(scalarOption(
    options["profile-report"],
    DEFAULT_PROFILE_REPORT_PATH,
  )));
  const outputPath = resolve(String(scalarOption(options.output, DEFAULT_OUTPUT_PATH)));
  const markdownPath = options.markdown
    ? resolve(String(scalarOption(options.markdown)))
    : null;
  const profileReport = JSON.parse(await readFile(profileReportPath, "utf8"));
  const explicitTrainingPaths = listOption(options["training-input"]);
  const skipLeakageCheck = booleanOption(options["skip-leakage-check"]);
  const trainingPaths = (explicitTrainingPaths.length
    ? explicitTrainingPaths
    : profileReport.inputFiles ?? []).map((path) => resolve(path));
  if (!trainingPaths.length && !skipLeakageCheck) {
    throw new Error(
      "훈련/홀드아웃 누수 검사를 위해 --training-input 또는 profile report의 inputFiles가 필요합니다.",
    );
  }
  const classes = listOption(options.classes);
  const validationArtifacts = await loadValidationArtifacts(
    validationPaths.map((path) => resolve(path)),
  );
  const report = buildSkillDictionaryErrorReport({
    validationArtifacts,
    profileReport,
    trainingRecords: skipLeakageCheck ? [] : await loadTrainingRecords(trainingPaths),
    trainingInputPaths: trainingPaths,
    trainingCheckPerformed: !skipLeakageCheck,
    expectedClasses: classes.length ? classes : undefined,
    expectedClassCount: scalarOption(
      options["expected-class-count"],
      classes.length || 47,
    ),
    samplesPerClass: scalarOption(options.samples, 5),
    targetMaePercent: scalarOption(options["target-mae"], 4),
    profilePolicy: String(scalarOption(options["profile-policy"], "validated")),
  });
  await writeText(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  if (markdownPath) {
    await writeText(markdownPath, renderSkillDictionaryErrorMarkdown(report));
  }
  process.stdout.write(
    `${report.counts.passedClassCount}/${report.counts.classCount}직업 통과 · ` +
      `통합 MAE ${displayPercent(report.aggregate.combinedMaePercent)} · ` +
      `누수 ${report.integrity.trainingHoldoutLeakage.overlapCount}건\n` +
      `보고서: ${outputPath}${markdownPath ? `\n표: ${markdownPath}` : ""}\n`,
  );
  if (report.status !== "passed" && !booleanOption(options["allow-fail"])) {
    throw new Error(`연구 검증 실패: ${report.failureReasons.join(", ")}`);
  }
  return report;
}

if (process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
