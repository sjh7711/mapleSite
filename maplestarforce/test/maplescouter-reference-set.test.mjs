import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { characterReferenceKey } from "../scripts/lib/character-exclusions.mjs";
import {
  buildMapleScouterReferenceSet,
  normalizeMapleScouterReference,
  parseMapleScouterClassList,
  parseMapleScouterReferenceInput,
} from "../scripts/lib/maplescouter-reference-set.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(new URL("..", import.meta.url).pathname);

function directReference(characterClass, characterName, rank, overrides = {}) {
  return {
    characterClass,
    characterName,
    rank,
    ied300: 10 + rank,
    ied380: 12 + rank,
    bossDamage: 40,
    flatAttack: 7,
    attackPercent: 50,
    criticalDamage: 32,
    allStatPercent: 10,
    amounts: {
      bossDamage: 40,
      flatAttack: 30,
      attackPercent: 12,
      criticalDamage: 8,
      allStatPercent: 9,
    },
    source: "fixture",
    collectedAt: `2026-09-0${Math.min(rank, 9)}T00:00:00.000Z`,
    ...overrides,
  };
}

function rawReference(characterClass, characterName, rank, collectedAt) {
  return {
    characterClass,
    characterName,
    rank,
    collectedAt,
    reference: {
      ok: true,
      ignoreDefense300: { amount: 40, mainStatPercent: 8.5 },
      ignoreDefense380: { amount: 40, mainStatPercent: 10.5 },
      bossDamage: { amount: 40, mainStatPercent: 45 },
      flatAttack: { amount: 30, mainStatPercent: 7 },
      attackPercent: { amount: 12, mainStatPercent: 48 },
      criticalDamage: { amount: 8, mainStatPercent: 31 },
      allStatPercent: { amount: 9, mainStatPercent: 10 },
    },
  };
}

test("JSON 배열·보고서 객체·JSONL 입력을 같은 행 목록으로 읽는다", () => {
  const row1 = directReference("렌", "표본1", 1);
  const row2 = directReference("렌", "표본2", 2);
  assert.deepEqual(
    parseMapleScouterReferenceInput(JSON.stringify([row1, row2])),
    [row1, row2],
  );
  assert.deepEqual(
    parseMapleScouterReferenceInput(JSON.stringify({ references: [row1] })),
    [row1],
  );
  assert.deepEqual(
    parseMapleScouterReferenceInput(`${JSON.stringify(row1)}\n${JSON.stringify(row2)}\n`),
    [row1, row2],
  );
});

test("쉼표가 들어간 공식 직업명과 다중 직업 필터를 구분한다", () => {
  assert.deepEqual(parseMapleScouterClassList("아크메이지(불,독)"), [
    "아크메이지(불,독)",
  ]);
  assert.deepEqual(parseMapleScouterClassList("렌|레테|렌"), ["렌", "레테"]);
});

test("수집 원본은 기존 referenceEfficiencyRow 경로로 기준 행을 만든다", () => {
  const normalized = normalizeMapleScouterReference(rawReference(
    "렌",
    "원본표본",
    3,
    "2026-09-09T00:00:00.000Z",
  ));
  assert.equal(normalized.ok, true);
  assert.equal(normalized.reference.ied380, 10.5);
  assert.equal(normalized.reference.amounts.criticalDamage, 8);
  assert.equal(normalized.reference.source, "maplescouter-browser");
});

test("중복은 최신 수집본만 남기고 제외 후 직업당 정확히 5명을 고른다", () => {
  const oldDuplicate = directReference("렌", "중복", 1, {
    ied380: 20,
    collectedAt: "2026-09-01T00:00:00.000Z",
  });
  const newDuplicate = directReference("렌", "중복", 1, {
    ied380: 99,
    collectedAt: "2026-09-09T00:00:00.000Z",
  });
  const records = [
    oldDuplicate,
    ...Array.from({ length: 6 }, (_, index) =>
      directReference("렌", `표본${index + 2}`, index + 2)
    ),
    newDuplicate,
  ];
  const result = buildMapleScouterReferenceSet({
    records,
    classes: ["렌"],
    samples: 5,
    excludedCharacterKeys: new Set([characterReferenceKey("렌", "표본2")]),
  });
  assert.equal(result.ok, true);
  assert.equal(result.references.length, 5);
  assert.equal(result.references.find(({ characterName }) =>
    characterName === "중복").ied380, 99);
  assert.deepEqual(result.references.map(({ characterName }) => characterName), [
    "중복",
    "표본3",
    "표본4",
    "표본5",
    "표본6",
  ]);
  assert.equal(result.report.counts.duplicateReferenceCount, 1);
  assert.equal(result.report.counts.excludedReferenceCount, 1);
});

test("입력 순서를 바꿔도 기준표와 보고서의 선택 결과가 같다", () => {
  const records = Array.from({ length: 7 }, (_, index) =>
    directReference("레테", `표본${index + 1}`, index + 1)
  );
  const forward = buildMapleScouterReferenceSet({
    records,
    classes: ["레테"],
  });
  const backward = buildMapleScouterReferenceSet({
    records: [...records].reverse(),
    classes: ["레테"],
  });
  assert.deepEqual(forward.references, backward.references);
  assert.deepEqual(
    forward.report.classes[0].selectedCharacters,
    backward.report.classes[0].selectedCharacters,
  );
});

test("데몬어벤져는 기본 제외하고 명시적으로 허용했을 때만 포함한다", () => {
  const records = [
    ...Array.from({ length: 5 }, (_, index) =>
      directReference("렌", `렌${index + 1}`, index + 1)
    ),
    ...Array.from({ length: 5 }, (_, index) =>
      directReference("데몬어벤져", `데벤${index + 1}`, index + 1)
    ),
    { characterClass: "레테", characterName: "선택밖오류" },
  ];
  const defaultResult = buildMapleScouterReferenceSet({
    records,
    classes: ["렌"],
  });
  assert.equal(defaultResult.ok, true);
  assert.equal(defaultResult.report.counts.defaultExcludedClassCount, 5);
  assert.equal(defaultResult.references.some(({ characterClass }) =>
    characterClass === "데몬어벤져"), false);

  const includedResult = buildMapleScouterReferenceSet({
    records,
    classes: ["데몬어벤져"],
    includeDemonAvenger: true,
  });
  assert.equal(includedResult.ok, true);
  assert.equal(includedResult.references.length, 5);
  assert.throws(() => buildMapleScouterReferenceSet({
    records,
    classes: ["데몬어벤져"],
  }), /include-demon-avenger/u);
});

test("제외·중복 제거 뒤 5명이 안 되거나 잘못된 기준 행이 있으면 실패한다", () => {
  const result = buildMapleScouterReferenceSet({
    records: [
      ...Array.from({ length: 5 }, (_, index) =>
        directReference("렌", `표본${index + 1}`, index + 1)
      ),
      { characterClass: "렌", characterName: "오류", ied300: 1 },
    ],
    classes: ["렌"],
    excludedCharacterKeys: new Set([characterReferenceKey("렌", "표본1")]),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.report.failureReasons, [
    "invalid-reference-records",
    "insufficient-class-samples",
  ]);
  assert.deepEqual(result.report.missingClasses, [
    { characterClass: "렌", shortfall: 1 },
  ]);
});

test("CLI는 JSON과 JSONL을 합치고 exclude-input과 실패 보고서를 적용한다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "maplescouter-reference-set-"));
  try {
    const jsonPath = join(directory, "existing.json");
    const jsonlPath = join(directory, "new.jsonl");
    const exclusionPath = join(directory, "training.jsonl");
    const outputPath = join(directory, "merged.json");
    const reportPath = join(directory, "merged.report.json");
    await writeFile(jsonPath, JSON.stringify([
      directReference("렌", "표본1", 1),
      directReference("렌", "표본2", 2),
      directReference("렌", "표본3", 3),
    ]));
    await writeFile(jsonlPath, [
      JSON.stringify(directReference("렌", "표본4", 4)),
      JSON.stringify(directReference("렌", "표본5", 5)),
      JSON.stringify(directReference("렌", "표본6", 6)),
      "",
    ].join("\n"));
    await writeFile(exclusionPath, `${JSON.stringify({
      apiClass: "렌",
      characterName: "표본1",
    })}\n`);

    await execFileAsync(process.execPath, [
      "scripts/merge-maplescouter-references.mjs",
      `--input=${jsonPath},${jsonlPath}`,
      `--exclude-input=${exclusionPath}`,
      "--classes=렌",
      `--output=${outputPath}`,
      `--report=${reportPath}`,
    ], { cwd: projectRoot });
    const output = JSON.parse(await readFile(outputPath, "utf8"));
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(output.length, 5);
    assert.equal(report.status, "passed");
    assert.equal(report.counts.excludedReferenceCount, 1);

    const failedOutputPath = join(directory, "failed.json");
    const failedReportPath = join(directory, "failed.report.json");
    const stricterExclusionPath = join(directory, "training-more.json");
    await writeFile(stricterExclusionPath, JSON.stringify([
      { characterClass: "렌", characterName: "표본1" },
      { characterClass: "렌", characterName: "표본2" },
    ]));
    await assert.rejects(execFileAsync(process.execPath, [
      "scripts/merge-maplescouter-references.mjs",
      `--input=${jsonPath},${jsonlPath}`,
      `--exclude-input=${stricterExclusionPath}`,
      "--classes=렌",
      `--output=${failedOutputPath}`,
      `--report=${failedReportPath}`,
    ], { cwd: projectRoot }));
    await assert.rejects(readFile(failedOutputPath, "utf8"), { code: "ENOENT" });
    const failedReport = JSON.parse(await readFile(failedReportPath, "utf8"));
    assert.equal(failedReport.status, "failed");
    assert.deepEqual(failedReport.missingClasses, [
      { characterClass: "렌", shortfall: 1 },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
