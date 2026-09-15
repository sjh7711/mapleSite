import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  BATTLE_PRACTICE_EXCLUDED_CLASSES,
  BATTLE_PRACTICE_JOB_CLASSES,
} from "./battle-practice-job-classes.mjs";
import {
  evaluateDefenseProfiles,
} from "./lib/defense-profile-research.mjs";

function parseArguments(argv) {
  return Object.fromEntries(argv.filter((entry) => entry.startsWith("--"))
    .map((entry) => {
      const [key, ...rest] = entry.slice(2).split("=");
      return [key, rest.length ? rest.join("=") : true];
    }));
}

function markdown(report) {
  const lines = [
    "# 방어 정규화 스킬 프로필 오차 연구",
    "",
    `- 평가 직업: **${report.counts.evaluatedClassCount}/${report.counts.expectedClassCount}**`,
    `- 5표본 완비: **${report.counts.completeClassCount}/${report.counts.expectedClassCount}**`,
    `- 직업별 MAE ${report.target.targetMaePercent}% 미만: **${report.counts.passedClassCount}/${report.counts.expectedClassCount}**`,
    `- 전체 LOO MAE: **${report.aggregate.leaveOneCharacterOutMaePercent?.toFixed(2) ?? "—"}%**`,
    "",
    "| 직업 | 표본 | 전역식 MAE | 스킬 사전식 MAE | LOO MAE | 효과 조건 비율 | 상태 |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const row of report.classes) {
    lines.push(
      `| ${row.characterClass} | ${row.referenceCount}/${report.target.samplesPerClass} | ` +
      `${row.baseline.maePercent?.toFixed(2) ?? "—"}% | ` +
      `${row.dictionaryProfile.maePercent?.toFixed(2) ?? "—"}% | ` +
      `${row.leaveOneCharacterOut.maePercent?.toFixed(2) ?? "—"}% | ` +
      `${row.meanEffectiveRemainingRatio?.toFixed(3) ?? "—"} | ` +
      `${row.passed ? "PASS" : "FAIL"} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const profilesPath = resolve(String(options.profiles ??
    "tools/battle-practice-dataset/generated/defense-normalized-profiles.js"));
  const validationPath = resolve(String(options.validation ??
    "tools/battle-practice-dataset/generated/validation-maplescouter-all-jobs-20260909-v1.json"));
  const outputPath = resolve(String(options.output ??
    "tools/battle-practice-dataset/generated/defense-normalized-error-report.json"));
  const markdownPath = resolve(String(options.markdown ??
    outputPath.replace(/\.json$/u, ".md")));
  const module = await import(`${pathToFileURL(profilesPath).href}?v=${Date.now()}`);
  const profiles = module.CLASS_DEFENSE_NORMALIZED_DAMAGE_PROFILES ?? {};
  const validation = JSON.parse(await readFile(validationPath, "utf8"));
  const excluded = new Set(BATTLE_PRACTICE_EXCLUDED_CLASSES);
  const expectedClasses = BATTLE_PRACTICE_JOB_CLASSES
    .map(({ characterClass }) => characterClass)
    .filter((characterClass) => !excluded.has(characterClass));
  const report = {
    schema: "maplestarforce.defense-normalized-error-report.v1",
    generatedAt: new Date().toISOString(),
    inputs: { profilesPath, validationPath },
    ...evaluateDefenseProfiles({
      validationRows: validation?.rows ?? validation,
      profiles,
      expectedClasses,
      samplesPerClass: Number(options.samples ?? 5),
      targetMaePercent: Number(options.target ?? 4),
    }),
  };
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, markdown(report), "utf8");
  process.stdout.write(
    `${report.counts.evaluatedClassCount}/${report.counts.expectedClassCount}직업 평가 · ` +
    `${report.counts.passedClassCount}직업 ${report.target.targetMaePercent}% 미만 · ` +
    `LOO MAE ${report.aggregate.leaveOneCharacterOutMaePercent?.toFixed(2) ?? "—"}%\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

