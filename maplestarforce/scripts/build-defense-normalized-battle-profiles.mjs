import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  buildDefenseNormalizedClassProfile,
  collectHoldoutReferences,
  prepareDefenseNormalizedDonorRecords,
  renderDefenseNormalizedProfilesModule,
} from "./lib/battle-practice-v2-profile.mjs";

function parseArguments(argv) {
  const result = { positional: [] };
  for (const argument of argv) {
    if (!argument.startsWith("--")) {
      result.positional.push(argument);
      continue;
    }
    const [key, ...rest] = argument.slice(2).split("=");
    result[key] = rest.length ? rest.join("=") : true;
  }
  return result;
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function readJsonOrLines(path) {
  const absolute = resolve(path);
  const text = await readFile(absolute, "utf8");
  if (absolute.endsWith(".jsonl")) {
    return text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch {
          throw new Error(`${absolute}:${index + 1} JSON 형식이 잘못되었습니다.`);
        }
      });
  }
  return JSON.parse(text);
}

function rowsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.records)) return payload.records;
  return [payload];
}

function reasonCounts(rejected) {
  const counts = {};
  for (const row of rejected) {
    for (const reason of row.reasons ?? []) {
      counts[reason] = (counts[reason] ?? 0) + 1;
    }
  }
  return counts;
}

function acceptedWarningCounts(records) {
  const counts = {};
  for (const record of records ?? []) {
    for (const warning of record?.quality?.warningCodes ?? []) {
      counts[warning] = (counts[warning] ?? 0) + 1;
    }
  }
  return counts;
}

function validationWarningCounts(records, rejected) {
  const counts = acceptedWarningCounts(records);
  for (const row of rejected ?? []) {
    for (const warning of row?.warnings ?? []) {
      counts[warning] = (counts[warning] ?? 0) + 1;
    }
  }
  return counts;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const inputPaths = [
    ...options.positional,
    ...String(options.input ?? "").split(",").map((path) => path.trim())
      .filter(Boolean),
  ];
  if (!inputPaths.length) {
    throw new Error("연무장 schema v2 JSONL 입력 경로를 하나 이상 지정하세요.");
  }
  const dictionaryPath = resolve(String(
    options.dictionary ??
      "tools/battle-practice-dataset/generated/skill-mechanics-v1.json",
  ));
  const dictionary = JSON.parse(await readFile(dictionaryPath, "utf8"));
  if (!dictionary?.classes || !dictionary?.contentHash) {
    throw new Error("스킬 사전 형식이 잘못되었거나 contentHash가 없습니다.");
  }
  const records = (await Promise.all(inputPaths.map(readJsonOrLines)))
    .flatMap(rowsFrom);
  const holdoutPaths = String(options.holdout ?? "")
    .split(",").map((path) => path.trim()).filter(Boolean);
  const holdoutPayloads = await Promise.all(holdoutPaths.map(readJsonOrLines));
  const holdoutReferences = collectHoldoutReferences(holdoutPayloads);
  const enemyDefense = positiveNumber(options["enemy-defense"], 3.8);
  const minimumSamples = positiveInteger(options["minimum-samples"], 5);
  const maximumSamples = Math.max(
    minimumSamples,
    positiveInteger(options["maximum-samples"], 5),
  );
  const prepared = prepareDefenseNormalizedDonorRecords(records, {
    dictionary,
    enemyDefense,
    minimumCharacterLevel: positiveInteger(
      options["minimum-character-level"],
      260,
    ),
    minimumDamageCoverage: positiveNumber(
      options["minimum-damage-coverage"],
      0.995,
    ),
    maximumDamageCoverage: positiveNumber(
      options["maximum-damage-coverage"],
      1.005,
    ),
    minimumTimelineEntries: positiveInteger(
      options["minimum-timeline-entries"],
      3,
    ),
    minimumTimelineSpanRatio: positiveNumber(
      options["minimum-timeline-span-ratio"],
      0.5,
    ),
    minimumResolvedDamageShare: positiveNumber(
      options["minimum-resolved-damage-share"],
      0.99,
    ),
    maximumReviewRequiredDamageShare: Number.isFinite(Number(
        options["maximum-review-required-damage-share"],
      ))
      ? Number(options["maximum-review-required-damage-share"])
      : 0.001,
    holdoutReferences,
    failOnHoldoutLeakage: !options["allow-holdout-overlap"],
  });

  const selectedClassNames = new Set(String(options.classes ?? "")
    .split("|").map((name) => name.trim()).filter(Boolean));
  const availableClasses = [...new Set(prepared.records.map(
    ({ characterClass }) => characterClass,
  ))].filter((characterClass) =>
    !selectedClassNames.size || selectedClassNames.has(characterClass)
  ).sort((left, right) => left.localeCompare(right, "ko"));
  const profiles = {};
  const classReports = {};
  for (const characterClass of availableClasses) {
    const built = buildDefenseNormalizedClassProfile(
      characterClass,
      prepared.records,
      {
        minimumSamples,
        maximumSamples,
        minimumSkillShare: positiveNumber(
          options["minimum-skill-share"],
          0.0001,
        ),
        maximumMedianPairDistance: positiveNumber(
          options["maximum-median-pair-distance"],
          0.12,
        ),
        dictionaryContentHash: dictionary.contentHash,
        enemyDefense,
      },
    );
    if (built.profile) profiles[characterClass] = built.profile;
    classReports[characterClass] = {
      candidateCount: prepared.records.filter((record) =>
        record.characterClass === characterClass
      ).length,
      acceptedCount: built.accepted.length,
      stable: Boolean(built.profile),
      reason: built.profile ? null : built.selection.reason,
      medianPairDistance: built.selection.medianPairDistance,
      maximumPairDistance: built.selection.maximumPairDistance,
      ...(built.profile ? {
        profileId: built.profile.id,
        profileHash: built.profile.profileHash,
        quality: built.profile.quality,
      } : {}),
    };
  }

  const outputPath = resolve(String(
    options.output ??
      "tools/battle-practice-dataset/generated/defense-normalized-profiles.js",
  ));
  const reportPath = resolve(String(
    options.report ?? `${outputPath}.report.json`,
  ));
  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(
    outputPath,
    renderDefenseNormalizedProfilesModule(profiles),
    "utf8",
  );
  const report = {
    schema: "maplestarforce.defense-normalized-build-report.v1",
    generatedAt: new Date().toISOString(),
    inputs: inputPaths.map((path) => resolve(path)),
    dictionary: {
      path: dictionaryPath,
      contentHash: dictionary.contentHash,
    },
    enemyDefense,
    minimumSamples,
    maximumSamples,
    holdout: {
      paths: holdoutPaths.map((path) => resolve(path)),
      characterCount: holdoutReferences.characterKeys.size,
      replayCount: holdoutReferences.replayIds.size,
      ocidCount: holdoutReferences.ocids.size,
      overlapCount: prepared.leakage.length,
    },
    candidateCount: prepared.candidateCount,
    validUniqueDonorCount: prepared.records.length,
    duplicateCount: prepared.duplicateCount,
    rejectedCount: prepared.rejected.length,
    rejectedReasonCounts: reasonCounts(prepared.rejected),
    acceptedWarningCounts: acceptedWarningCounts(prepared.records),
    validationWarningCounts: validationWarningCounts(
      prepared.records,
      prepared.rejected,
    ),
    outputProfileCount: Object.keys(profiles).length,
    classes: classReports,
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write([
    `v2 후보: ${prepared.candidateCount}`,
    `정상 고유 donor: ${prepared.records.length}`,
    `배포 후보 직업: ${Object.keys(profiles).length}`,
    `경량 프로필: ${outputPath}`,
    `품질 보고서: ${reportPath}`,
  ].join("\n") + "\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
