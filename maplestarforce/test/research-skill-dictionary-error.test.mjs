import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import {
  buildSkillDictionaryErrorReport,
  parseResearchRecords,
  renderSkillDictionaryErrorMarkdown,
} from "../scripts/research-skill-dictionary-error.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(new URL("..", import.meta.url).pathname);

function validationRow(characterClass, characterName, {
  reference300 = 100,
  reference380 = 100,
  baseline300 = 110,
  baseline380 = 110,
  profiled300 = 100,
  profiled380 = 100,
  skillProfileHash = "skill-a",
  profileHash = "raw-a",
} = {}) {
  return {
    characterClass,
    characterName,
    ok: true,
    ied300: reference300,
    ied380: reference380,
    unprofiled300: baseline300,
    unprofiled380: baseline380,
    actual300: profiled300,
    actual380: profiled380,
    skillProfileHash,
    profileHash,
    combatDiagnostics: {
      matchedLocalChannelShare: 0.8,
      generalChannelShare: 0.2,
      unmatchedLocalSkills: ["미등록 스킬"],
    },
  };
}

function fiveRows(characterClass, prefix, overrides) {
  return Array.from({ length: 5 }, (_, index) => validationRow(
    characterClass,
    `${prefix}${index + 1}`,
    overrides,
  ));
}

function candidateReport() {
  return {
    classes: {
      직업A: {
        id: "profile-a",
        sourceSkillProfileHash: "skill-a",
        sourceProfileHash: "raw-a",
        validationArtifactMatched: true,
        runtimeSupported: true,
        deployed: true,
        validation: { passed: true, blendConfidence: 0.8 },
      },
      직업B: {
        validationArtifactMatched: false,
        runtimeSupported: true,
        deployed: false,
        validation: null,
      },
    },
  };
}

test("JSON·JSONL 연구 입력을 같은 레코드 목록으로 읽는다", () => {
  const rows = fiveRows("직업A", "표본");
  assert.deepEqual(parseResearchRecords(JSON.stringify({ rows })), rows);
  assert.deepEqual(
    parseResearchRecords(rows.map((row) => JSON.stringify(row)).join("\n")),
    rows,
  );
});

test("최신 검증 파일을 직업 단위로 우선하고 프로필 신뢰도를 정확히 혼합한다", () => {
  const latestA = fiveRows("직업A", "최신", {
    baseline300: 110,
    baseline380: 110,
    profiled300: 100,
    profiled380: 100,
  });
  const oldA = fiveRows("직업A", "과거", {
    baseline300: 150,
    baseline380: 150,
  });
  const oldB = fiveRows("직업B", "기준", {
    baseline300: 102,
    baseline380: 106,
  });
  const report = buildSkillDictionaryErrorReport({
    validationArtifacts: [
      { path: "latest.json", payload: { rows: latestA } },
      { path: "old.json", payload: { rows: [...oldA, ...oldB] } },
    ],
    profileReport: candidateReport(),
    trainingRecords: [],
    trainingCheckPerformed: true,
    expectedClasses: ["직업A", "직업B"],
    targetMaePercent: 4,
    profilePolicy: "validated",
  });
  const classA = report.classes.find(({ characterClass }) =>
    characterClass === "직업A");
  const classB = report.classes.find(({ characterClass }) =>
    characterClass === "직업B");
  assert.equal(classA.sourcePath, "latest.json");
  assert.equal(classA.profileConfidence, 0.8);
  assert.equal(classA.combinedMaePercent, 2);
  assert.equal(classA.baselineCombinedMaePercent, 10);
  assert.equal(classA.improvementPercent, 80);
  assert.equal(classA.passed, true);
  assert.equal(classB.model, "common");
  assert.equal(classB.mae300Percent, 2);
  assert.equal(classB.mae380Percent, 6);
  assert.equal(classB.combinedMaePercent, 4);
  // 목표는 4% 이하가 아니라 엄격히 4% 미만이다.
  assert.equal(classB.passed, false);
  assert.equal(report.counts.referenceCount, 10);
  assert.equal(report.counts.errorObservationCount, 20);
  assert.equal(report.integrity.completenessPassed, true);
  assert.deepEqual(report.failureReasons, ["class-mae-target-missed"]);
});

test("훈련/홀드아웃 중복과 프로필 해시 불일치를 별도 무결성 실패로 보고한다", () => {
  const rows = fiveRows("직업A", "표본");
  rows[0].skillProfileHash = "다른-사전";
  const report = buildSkillDictionaryErrorReport({
    validationArtifacts: [{ path: "holdout.json", payload: { rows } }],
    profileReport: candidateReport(),
    trainingRecords: [{ characterClass: "직업A", characterName: "표본1" }],
    trainingInputPaths: ["training.jsonl"],
    trainingCheckPerformed: true,
    expectedClasses: ["직업A"],
  });
  assert.equal(report.status, "failed");
  assert.equal(report.integrity.trainingHoldoutLeakage.overlapCount, 1);
  assert.deepEqual(
    report.integrity.trainingHoldoutLeakage.overlappingReferences,
    [{ characterClass: "직업A", characterName: "표본1" }],
  );
  assert.equal(report.integrity.hashIntegrityPassed, false);
  assert.deepEqual(report.failureReasons, [
    "training-holdout-leakage",
    "profile-artifact-hash-mismatch",
  ]);
});

test("신뢰도 보정에 쓴 검증 파일을 최종 holdout으로 재사용하면 누수로 판정한다", () => {
  const report = buildSkillDictionaryErrorReport({
    validationArtifacts: [{
      path: "holdout.json",
      payload: { rows: fiveRows("직업A", "표본") },
    }],
    profileReport: {
      ...candidateReport(),
      validationPaths: ["holdout.json"],
    },
    trainingRecords: [],
    trainingCheckPerformed: true,
    expectedClasses: ["직업A"],
  });
  assert.equal(
    report.integrity.trainingHoldoutLeakage.calibrationArtifactOverlapCount,
    1,
  );
  assert.deepEqual(
    report.integrity.trainingHoldoutLeakage.calibrationArtifactOverlaps,
    [{ characterClass: "직업A", sourcePath: "holdout.json" }],
  );
  assert.equal(
    report.failureReasons.includes("profile-calibration-holdout-reuse"),
    true,
  );
});

test("직업당 5명이 아니거나 중복·유효하지 않은 행이 있으면 완전성 검사를 통과하지 못한다", () => {
  const rows = fiveRows("직업A", "표본").slice(0, 4);
  rows.push({ ...rows[0] });
  rows[1].ied300 = null;
  const report = buildSkillDictionaryErrorReport({
    validationArtifacts: [{ path: "holdout.json", payload: { rows } }],
    profileReport: candidateReport(),
    trainingRecords: [],
    trainingCheckPerformed: true,
    expectedClasses: ["직업A", "직업B"],
  });
  assert.equal(report.integrity.completenessPassed, false);
  assert.deepEqual(report.integrity.missingClasses, ["직업B"]);
  assert.equal(report.integrity.duplicateHoldoutKeys.length, 1);
  assert.equal(report.integrity.invalidRows.length, 1);
  assert.equal(report.failureReasons.includes("incomplete-holdout-set"), true);
});

test("마크다운 보고서는 300·380·통합·기준·개선율·최대 오차와 판정을 포함한다", () => {
  const report = buildSkillDictionaryErrorReport({
    validationArtifacts: [{
      path: "holdout.json",
      payload: { rows: fiveRows("직업A", "표본") },
    }],
    profileReport: candidateReport(),
    trainingRecords: [],
    trainingCheckPerformed: true,
    expectedClasses: ["직업A"],
  });
  const markdown = renderSkillDictionaryErrorMarkdown(report);
  assert.match(markdown, /300% MAE/u);
  assert.match(markdown, /380% MAE/u);
  assert.match(markdown, /통합 MAE/u);
  assert.match(markdown, /기준 MAE/u);
  assert.match(markdown, /개선율/u);
  assert.match(markdown, /최대 오차/u);
  assert.match(markdown, /PASS/u);
});

test("CLI는 실패 상태도 allow-fail로 JSON과 마크다운 연구 보고서에 남긴다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "skill-dictionary-report-"));
  try {
    const validationPath = join(directory, "validation.json");
    const profilePath = join(directory, "profile.report.json");
    const trainingPath = join(directory, "training.jsonl");
    const outputPath = join(directory, "report.json");
    const markdownPath = join(directory, "report.md");
    await writeFile(validationPath, JSON.stringify({
      rows: fiveRows("직업A", "표본", {
        baseline300: 108,
        baseline380: 108,
        profiled300: 105,
        profiled380: 105,
      }),
    }));
    await writeFile(profilePath, JSON.stringify(candidateReport()));
    await writeFile(trainingPath, "");
    await execFileAsync(process.execPath, [
      "scripts/research-skill-dictionary-error.mjs",
      `--validation=${validationPath}`,
      `--profile-report=${profilePath}`,
      `--training-input=${trainingPath}`,
      "--classes=직업A",
      `--output=${outputPath}`,
      `--markdown=${markdownPath}`,
      "--allow-fail",
    ], { cwd: projectRoot });
    const report = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(report.status, "failed");
    assert.equal(report.counts.classCount, 1);
    assert.match(await readFile(markdownPath, "utf8"), /직업A/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
