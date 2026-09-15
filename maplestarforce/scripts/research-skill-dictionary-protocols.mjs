import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BATTLE_PRACTICE_EXCLUDED_CLASSES,
  BATTLE_PRACTICE_JOB_CLASSES,
} from "./battle-practice-job-classes.mjs";
import {
  battlePracticeReferenceKey,
  extractBattlePracticeIgnoreDefense,
  normalizeDefenseNormalizedDonorRecord,
} from "./lib/battle-practice-v2-profile.mjs";
import {
  collapseDefenseSignature,
  deduplicateResearchDonors,
  evaluateMapleScouterProtocol,
  evaluateNonDefenseMapleScouterMetrics,
  evaluateReplayProtocolLeaveOneOut,
  selectStableResearchDonors,
  summarizeMapleScouterAllMetrics,
} from "./lib/skill-dictionary-protocol-research.mjs";

const DEFAULT_DONOR_PATH =
  "tools/battle-practice-dataset/raw/battle-practice-skill-research-v2-20260909.jsonl";
const DEFAULT_DICTIONARY_PATH =
  "tools/battle-practice-dataset/generated/skill-mechanics-v1.json";
const DEFAULT_AUDIT_PATH =
  "tools/battle-practice-dataset/generated/skill-dictionary-audit-v1.json";
const DEFAULT_VALIDATION_PATHS = Object.freeze([
  "tools/battle-practice-dataset/generated/validation-maplescouter-final15-holdout-20260909-v59.json",
  "tools/battle-practice-dataset/generated/validation-maplescouter-all-jobs-20260909-v1.json",
]);
const DEFAULT_OUTPUT_PATH =
  "tools/battle-practice-dataset/generated/skill-dictionary-protocol-research-v1.json";

export function parseArguments(argv) {
  const result = {};
  for (const entry of argv.filter((value) => value.startsWith("--"))) {
    const [key, ...rest] = entry.slice(2).split("=");
    const value = rest.length ? rest.join("=") : true;
    if (!(key in result)) result[key] = value;
    else if (Array.isArray(result[key])) result[key].push(value);
    else result[key] = [result[key], value];
  }
  return result;
}

export function splitPaths(value, fallback = []) {
  const values = value === undefined
    ? fallback
    : Array.isArray(value) ? value : [value];
  return values.flatMap((entry) => String(entry)
    .split(/[|,;]/u).map((path) => path.trim()).filter(Boolean));
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function readJsonLines(path) {
  return (await readFile(resolve(path), "utf8"))
    .split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`${path}:${index + 1} JSON 형식이 잘못되었습니다.`);
      }
    });
}

function rowsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.records)) return payload.records;
  return [];
}

function prioritizedValidationRows(payloads, expectedClasses) {
  const result = [];
  for (const characterClass of expectedClasses) {
    const source = payloads.find((payload) => rowsFrom(payload).some((row) =>
      String(row?.apiClass ?? row?.characterClass ?? "").trim() ===
        characterClass
    ));
    result.push(...rowsFrom(source).filter((row) =>
      String(row?.apiClass ?? row?.characterClass ?? "").trim() ===
        characterClass
    ));
  }
  return result;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function rounded(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

function markdown(report) {
  const replay = report.protocols.actualSixMinuteReplay;
  const comparison = report.protocols.mapleScouterComparison;
  const metrics = report.protocols.mapleScouterNonDefense;
  const allMetrics = report.protocols.mapleScouterAllMetrics;
  const lines = [
    "# 전 직업 스킬 사전 기반 오차 연구",
    "",
    "## 결론",
    "",
    `- 실제 6분 연무장 규약: 평균 프로필 LOO MAE **${rounded(replay.comparisonEstimator.completeClasses.meanAbsoluteErrorPercent)}%** → ` +
      `donor 반응 중앙값 MAE **${rounded(replay.completeClasses.meanAbsoluteErrorPercent)}%** ` +
      `· 직업별 4% 미만 **${replay.counts.passedClassCount}/${replay.counts.completeClassCount}직업** ` +
      `· 최대 오차 **${rounded(replay.completeClasses.maximumAbsoluteErrorPercent)}%** ` +
      `(${replay.completeClasses.meanAbsoluteErrorPercent < report.targetMaePercent ? "전체 MAE 목표 달성" : "전체 MAE 목표 미달"})`,
    `- MapleScouter 방무 비교 규약: 독립 donor 모델 MAE **${rounded(comparison.dictionary.meanAbsoluteErrorPercent)}%**, ` +
      `최대 **${rounded(comparison.dictionary.maximumAbsoluteErrorPercent)}%** · ` +
      `연구용 LOO 규약 보정 후 MAE **${rounded(comparison.adapted.meanAbsoluteErrorPercent)}%**, ` +
      `직업별 4% 미만 **${comparison.counts.passedClassCount}/${comparison.counts.classCount}직업**, ` +
      `최대 **${rounded(comparison.adapted.maximumAbsoluteErrorPercent)}%** ` +
      `(${comparison.passed ? "목표 달성" : "목표 미달"})`,
    `- MapleScouter 비방무 5지표: 연구용 LOO 계층 보정 후 합산 MAE **${rounded(metrics.adapted.meanAbsoluteErrorPercent)}%** ` +
      `· 직업별 4% 미만 **${metrics.counts.passedClassCount}/${metrics.counts.classCount}직업** ` +
      `· 최대 **${rounded(metrics.adapted.maximumAbsoluteErrorPercent)}%** ` +
      `(${metrics.passed ? "모든 지표 목표 달성" : "일부 지표 목표 미달"})`,
    `- MapleScouter 전체 7지표: 연구용 LOO 규약 보정 합산 MAE **${rounded(allMetrics.adapted.meanAbsoluteErrorPercent)}%** ` +
      `· 직업별 4% 미만 **${allMetrics.counts.passedClassCount}/${allMetrics.counts.classCount}직업** ` +
      `· 최대 **${rounded(allMetrics.adapted.maximumAbsoluteErrorPercent)}%** ` +
      `(${allMetrics.passed ? "목표 달성" : "목표 미달"})`,
    "- 실제 연무장 계산 규약과 MapleScouter 표시 규약은 서로 섞지 않았습니다. 연구용 보정은 런타임에 반영하지 않았습니다.",
    "",
    "## 데이터와 누수 검사",
    "",
    `- 스킬 사전: ${report.dictionary.classCount}직업 · ${report.dictionary.sampleCount} 스냅샷 · ${report.dictionary.skillCount.toLocaleString("ko-KR")} 스킬`,
    `- 연무장 donor: 입력 ${report.inputs.rawDonorCount}건 → canonical 직업+이름 중복 제거 ${report.inputs.rawUniqueDonorCount}명 → 안정성 선택 ${report.inputs.selectedDonorCount}명`,
    `- 안정성 선택: strict 통과 ${report.donorSelection.stableClassCount}/${report.inputs.expectedClassCount}직업 · 5표본 완비 ${replay.counts.completeClassCount}/${report.inputs.expectedClassCount}직업`,
    `- 외부 비교: ${comparison.counts.validationRecordCount}건`,
    `- donor/외부 검증 캐릭터 중복: ${report.leakage.overlapCount}건`,
    "- 안정성 선택은 정답 수치 없이 스킬 피해 분포만 사용하는 사전 품질 선택입니다. 이후 실제 규약은 매 fold마다 해당 캐릭터를 estimator donor에서 제외했고, 비교 규약 보정도 해당 캐릭터의 정답을 제외했습니다.",
    "",
    "## 실제 6분 연무장 규약",
    "",
    "| 직업 | 표본 | LOO MAE | 최대 오차 | 상태 |",
    "|---|---:|---:|---:|---:|",
  ];
  for (const row of replay.classes) {
    lines.push(
      `| ${row.characterClass} | ${row.sampleCount}/${replay.target.samplesPerClass} | ` +
      `${rounded(row.meanAbsoluteErrorPercent)}% | ${rounded(row.maximumAbsoluteErrorPercent)}% | ` +
      `${row.passed ? "PASS" : row.complete ? "FAIL" : "표본 부족"} |`,
    );
  }
  lines.push(
    "",
    "이 LOO 값은 보지 않은 캐릭터의 방어 전 스킬 점유율과 +방무 반응을 얼마나 잘 재현하는지 측정합니다. 실제로 같은 캐릭터에 +방무 40%를 장착한 A/B 로그를 얻은 것은 아니므로 절대 정확도와 구분해야 합니다.",
    "",
    "## MapleScouter 방무 비교 규약",
    "",
    `- 직업별 4% 미만: ${comparison.counts.passedClassCount}/${comparison.counts.classCount}직업`,
    "",
    "| 오차 상위 직업 | 독립 사전식 MAE | 연구용 LOO 규약 보정 MAE |",
    "|---|---:|---:|",
  );
  for (const row of [...comparison.classes]
    .sort((left, right) =>
      right.adapted.meanAbsoluteErrorPercent -
      left.adapted.meanAbsoluteErrorPercent
    ).slice(0, 12)) {
    lines.push(
      `| ${row.characterClass} | ${rounded(row.dictionary.meanAbsoluteErrorPercent)}% | ` +
      `${rounded(row.adapted.meanAbsoluteErrorPercent)}% |`,
    );
  }
  lines.push(
    "",
    "## MapleScouter 비방무 지표",
    "",
    "| 지표 | 기존 MAE | LOO 계층 보정 MAE | 상태 |",
    "|---|---:|---:|---:|",
  );
  const labels = {
    bossDamage: "보총뎀",
    flatAttack: "공격력/마력 고정",
    attackPercent: "공격력/마력%",
    criticalDamage: "크리티컬 데미지",
    allStatPercent: "올스탯%",
  };
  for (const [key, value] of Object.entries(metrics.metrics)) {
    lines.push(
      `| ${labels[key] ?? key} | ${rounded(value.baseline.meanAbsoluteErrorPercent)}% | ` +
      `${rounded(value.adapted.meanAbsoluteErrorPercent)}% | ${value.passed ? "PASS" : "FAIL"} |`,
    );
  }
  lines.push(
    "",
    "## 해석",
    "",
    "실제 6분 기록에서는 스킬별 방무와 실제 피해 점유율을 사전으로 해석한 뒤, donor별 반응의 중앙값을 사용하면 전체 MAE가 4% 아래로 내려갑니다. 다만 5표본만으로는 일부 직업의 서로 다른 딜사이클을 안정적으로 대표하지 못해 직업별 최대 오차는 여전히 큽니다.",
    "",
    "MapleScouter 비교에서는 같은 모델이 4% 목표에 도달하지 못했습니다. 대표적으로 파이렛 플래그 VI처럼 실제 6분 기록에서는 거의 상시 유지되지만 외부 표시값은 1회 사용에 가까운 가동률을 암시하는 효과가 있어, 외부 표시 규약을 실제 연무장 진실값으로 학습하면 두 규약이 오염됩니다. 따라서 이 결과만으로 계산식을 배포하지 않습니다.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const donorPaths = splitPaths(options.donors, [DEFAULT_DONOR_PATH])
    .map((path) => resolve(path));
  const dictionaryPath = resolve(String(
    options.dictionary ?? DEFAULT_DICTIONARY_PATH,
  ));
  const auditPath = resolve(String(options.audit ?? DEFAULT_AUDIT_PATH));
  const validationPaths = splitPaths(options.validation, DEFAULT_VALIDATION_PATHS)
    .map((path) => resolve(path));
  const outputPath = resolve(String(options.output ?? DEFAULT_OUTPUT_PATH));
  const markdownPath = resolve(String(
    options.markdown ?? outputPath.replace(/\.json$/u, ".md"),
  ));
  const modelPath = resolve(String(
    options.model ?? outputPath.replace(/\.json$/u, ".model.json"),
  ));
  const targetMaePercent = Number(options.target ?? 4);

  const [rawDonorPayloads, dictionary, audit, ...validationPayloads] = await Promise.all([
    Promise.all(donorPaths.map(readJsonLines)),
    readJson(dictionaryPath),
    readJson(auditPath),
    ...validationPaths.map(readJson),
  ]);
  const rawDonors = rawDonorPayloads.flat();
  const donorSourceCounts = donorPaths.map((path, index) => ({
    path,
    recordCount: rawDonorPayloads[index].length,
  }));
  if (audit?.status !== "passed" || audit?.failures?.length) {
    throw new Error("통과한 스킬 사전 감사 자료가 필요합니다.");
  }
  const excluded = new Set(BATTLE_PRACTICE_EXCLUDED_CLASSES);
  const expectedClasses = BATTLE_PRACTICE_JOB_CLASSES
    .map(({ characterClass }) => characterClass)
    .filter((characterClass) => !excluded.has(characterClass));
  const validationRows = prioritizedValidationRows(
    validationPayloads,
    expectedClasses,
  );
  const validationKeys = new Set(validationRows.map((row) =>
    battlePracticeReferenceKey(
      row?.apiClass ?? row?.characterClass,
      row?.characterName,
    )
  ).filter(Boolean));

  const validCandidates = [];
  const rejected = [];
  for (const candidate of rawDonors) {
    if (excluded.has(String(candidate?.characterClass ?? "").trim())) continue;
    const normalized = normalizeDefenseNormalizedDonorRecord(candidate, {
      dictionary,
      enemyDefense: 3.8,
      minimumResolvedDamageShare: 0.99,
    });
    if (!normalized.record) {
      rejected.push({
        characterClass: candidate?.characterClass ?? null,
        characterName: candidate?.characterName ?? null,
        reasons: normalized.validation.errorCodes,
      });
      continue;
    }
    validCandidates.push({
      ...normalized.record,
      currentIgnoreDefense: extractBattlePracticeIgnoreDefense(
        candidate.characterInfo,
      ),
    });
  }
  const deduplicated = deduplicateResearchDonors(validCandidates);
  const overlap = deduplicated.records.filter((record) =>
    (record.referenceKeys ?? [record.referenceKey]).some((key) =>
      validationKeys.has(key)
    )
  ).map((record) => ({
    characterClass: record.characterClass,
    characterName: record.characterName,
  }));
  if (overlap.length) {
    throw new Error(`donor/외부 검증 캐릭터가 ${overlap.length}건 겹칩니다.`);
  }
  const selection = selectStableResearchDonors(deduplicated.records, {
    samplesPerClass: 5,
    maximumMedianPairDistance: 0.12,
  });
  const donors = selection.records;

  const actualSixMinuteReplay = evaluateReplayProtocolLeaveOneOut({
    records: donors,
    samplesPerClass: 5,
    targetMaePercent,
  });
  const mapleScouterComparison = evaluateMapleScouterProtocol({
    validationRows,
    donorRecords: donors,
    targetMaePercent,
    priorStrength: 2,
  });
  const mapleScouterNonDefense = evaluateNonDefenseMapleScouterMetrics({
    validationRows,
    targetMaePercent,
    priorStrength: 2,
  });
  const mapleScouterAllMetrics = summarizeMapleScouterAllMetrics({
    defense: mapleScouterComparison,
    nonDefense: mapleScouterNonDefense,
    targetMaePercent,
  });

  const compactClasses = {};
  for (const characterClass of expectedClasses) {
    const classDonors = donors.filter((row) => row.characterClass === characterClass);
    if (!classDonors.length) continue;
    compactClasses[characterClass] = {
      sampleCount: classDonors.length,
      signatures: classDonors.map((row) =>
        collapseDefenseSignature(row.rawChannels)
      ),
    };
  }
  const modelContent = {
    schema: "maplestarforce.defense-signature-ensemble.research.v2",
    protocol: "actual-six-minute-replay",
    aggregation: "median-donor-response",
    dictionaryContentHash: dictionary.contentHash,
    classes: compactClasses,
  };
  const model = {
    ...modelContent,
    contentHash: sha256(JSON.stringify(modelContent)),
  };
  const report = {
    schema: "maplestarforce.skill-dictionary-protocol-research.v2",
    generatedAt: new Date().toISOString(),
    targetMaePercent,
    inputs: {
      donorPaths,
      donorSourceCounts,
      dictionaryPath,
      auditPath,
      validationPaths,
      expectedClassCount: expectedClasses.length,
      rawDonorCount: rawDonors.length,
      validCandidateCount: validCandidates.length,
      duplicateDonorCount: deduplicated.duplicateCount,
      rawUniqueDonorCount: deduplicated.records.length,
      selectedDonorCount: donors.length,
      validDonorCount: donors.length,
      rejectedDonorCount: rejected.length,
      validationRowCount: validationRows.length,
    },
    donorSelection: {
      method: "stable-skill-distribution-max-5",
      maximumSamplesPerClass: 5,
      maximumMedianPairDistance: 0.12,
      rawUniqueCount: selection.rawUniqueCount,
      selectedCount: selection.selectedCount,
      droppedCount: selection.droppedCount,
      stableClassCount: selection.classes.filter(({ stable }) => stable).length,
      classes: selection.classes,
    },
    dictionary: {
      contentHash: dictionary.contentHash,
      auditHash: audit.dictionaryHash,
      classCount: audit.coverage.completeClassCount,
      sampleCount: audit.coverage.completeClassCount * audit.target.samplesPerClass,
      skillCount: audit.coverage.totalSkillCount,
      reviewRequiredCount: audit.coverage.reviewRequiredCount,
    },
    leakage: { overlapCount: overlap.length },
    rejectedDonors: rejected,
    researchModel: {
      path: modelPath,
      contentHash: model.contentHash,
      runtimeApplied: false,
    },
    protocols: {
      actualSixMinuteReplay,
      mapleScouterComparison,
      mapleScouterNonDefense,
      mapleScouterAllMetrics,
    },
  };
  await Promise.all([
    mkdir(dirname(outputPath), { recursive: true }),
    mkdir(dirname(markdownPath), { recursive: true }),
    mkdir(dirname(modelPath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    writeFile(markdownPath, markdown(report), "utf8"),
    writeFile(modelPath, `${JSON.stringify(model, null, 2)}\n`, "utf8"),
  ]);
  process.stdout.write([
    `실제 6분 LOO MAE: ${rounded(actualSixMinuteReplay.completeClasses.meanAbsoluteErrorPercent)}%`,
    `MapleScouter 방무 비교 MAE: ${rounded(mapleScouterComparison.dictionary.meanAbsoluteErrorPercent)}%`,
    `MapleScouter 연구용 LOO 보정 MAE: ${rounded(mapleScouterComparison.adapted.meanAbsoluteErrorPercent)}%`,
    `비방무 연구용 LOO 보정 MAE: ${rounded(mapleScouterNonDefense.adapted.meanAbsoluteErrorPercent)}%`,
    `보고서: ${markdownPath}`,
  ].join("\n") + "\n");
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
}
