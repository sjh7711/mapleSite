import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { analyzeCombatEffectProvenance } from "./lib/combat-effect-provenance.mjs";

function parseArguments(argv) {
  return Object.fromEntries(argv.filter((value) => value.startsWith("--")).map(
    (value) => {
      const [key, ...rest] = value.slice(2).split("=");
      return [key, rest.length ? rest.join("=") : true];
    },
  ));
}

async function jsonLines(path) {
  if (!path) return [];
  return (await readFile(resolve(path), "utf8"))
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function percent(value) {
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)}%` : "-";
}

function reportMarkdown(analyses) {
  const lines = [
    "# 전투 효과 출처·활성화 진단",
    "",
    "이 보고서는 효과를 제거하라는 자동 결론이 아니라, 기준 프리셋과 실제 전투 활성화가 다른 지점을 찾는 반사실 진단입니다.",
    "",
  ];
  for (const analysis of analyses) {
    lines.push(
      `## ${analysis.characterClass} · ${analysis.characterName}`,
      "",
      `현재 380 방무 환산 오차: ${percent(analysis.current.error380Percent)}`,
      "",
      "| 제거 가정 | 제거 방무 | 380 오차 | 기준값 역산 가동률 | 연무장 가동률 | 판정 |",
      "| --- | ---: | ---: | ---: | ---: | --- |",
    );
    for (const candidate of analysis.candidates) {
      lines.push(
        `| ${candidate.source} | ${candidate.removedIgnoreDefenseSources.join("% · ")}% | ${percent(candidate.error380Percent)} | ${percent((candidate.referenceEquivalentUptime ?? NaN) * 100)} | ${percent((candidate.timelineEvidence?.coverage ?? NaN) * 100)} | ${candidate.diagnosis} |`,
      );
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

const options = parseArguments(process.argv.slice(2));
const input = resolve(String(options.input ?? "/tmp/validation-captain-details.json"));
const output = resolve(String(
  options.output ??
    "tools/battle-practice-dataset/generated/combat-effect-provenance.json",
));
const validation = JSON.parse(await readFile(input, "utf8"));
const records = await jsonLines(options.records);
const recordsByName = new Map(records.map((record) => [record.characterName, record]));
const analyses = (validation.rows ?? [])
  .filter((row) => Array.isArray(row?.combatDiagnostics?.effects))
  .map((row) => analyzeCombatEffectProvenance(
    row,
    recordsByName.get(row.characterName) ?? null,
  ));
const payload = {
  generatedAt: new Date().toISOString(),
  sourceValidation: input,
  analysisCount: analyses.length,
  analyses,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
await writeFile(output.replace(/\.json$/u, ".md"), reportMarkdown(analyses), "utf8");
process.stdout.write(`${output}\n`);
