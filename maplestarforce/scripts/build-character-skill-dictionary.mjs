import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildSkillDictionary,
  slimSkillDictionary,
} from "./lib/skill-dictionary.mjs";
import { uniqueBattlePracticeRecords } from "./lib/battle-practice-profile.mjs";

function argumentsMap(argv) {
  return Object.fromEntries(argv.filter((value) => value.startsWith("--")).map(
    (value) => {
      const [key, ...rest] = value.slice(2).split("=");
      return [key, rest.length ? rest.join("=") : true];
    },
  ));
}

async function recordsFrom(path) {
  const raw = await readFile(resolve(path), "utf8");
  if (String(path).endsWith(".jsonl")) {
    return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  }
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : parsed.records ?? [];
}

async function loadProfiles(path) {
  if (!path) return {};
  const module = await import(`${pathToFileURL(resolve(path)).href}?v=${Date.now()}`);
  return module.CLASS_BATTLE_PRACTICE_DAMAGE_PROFILES ?? {};
}

async function loadAliasOverrides(path) {
  if (!path || path === "false" || path === "none") return {};
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function loadBattleRecordProfiles(pathList) {
  if (!pathList || pathList === "false" || pathList === "none") return {};
  const paths = String(pathList).split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const candidates = (await Promise.all(paths.map(recordsFrom))).flat();
  const grouped = new Map();
  for (const record of uniqueBattlePracticeRecords(candidates)) {
    if (!record.characterClass) continue;
    const entries = grouped.get(record.characterClass) ?? [];
    entries.push(record);
    grouped.set(record.characterClass, entries);
  }
  return Object.fromEntries([...grouped].map(([characterClass, records]) => {
    const weights = new Map();
    const labels = new Map();
    for (const record of records) {
      for (const [identity, weight] of record.weights) {
        if (identity === "__unattributed__" || !(weight > 0)) continue;
        weights.set(
          identity,
          (weights.get(identity) ?? 0) + weight / records.length,
        );
        if (!labels.has(identity)) {
          labels.set(identity, record.labels.get(identity) ?? identity);
        }
      }
    }
    return [characterClass, {
      aggregation: "mean-normalized-damage-share-for-dictionary-audit",
      sampleCount: records.length,
      skillShares: [...weights].map(([identity, weight]) => ({
        source: labels.get(identity),
        weight,
      })).sort((left, right) => right.weight - left.weight ||
        left.source.localeCompare(right.source, "ko-KR")),
    }];
  }));
}

async function main() {
  const options = argumentsMap(process.argv.slice(2));
  const inputPaths = String(
    options.input ??
      "tools/battle-practice-dataset/raw/character-skill-snapshots-v1.jsonl",
  ).split(",").map((value) => value.trim()).filter(Boolean);
  const snapshots = (await Promise.all(inputPaths.map(recordsFrom))).flat();
  const deployedProfiles = await loadProfiles(String(
    options.profiles ??
      "tools/battle-practice-dataset/generated/class-damage-profiles.js",
  ));
  const battleRecordPath = String(
    options["battle-records"] ??
      "tools/battle-practice-dataset/raw/battle-practice-skill-research-v2-20260909.jsonl",
  );
  const recordProfiles = await loadBattleRecordProfiles(battleRecordPath);
  // 사전 이름 매칭 감사는 배포를 승인받은 일부 직업만이 아니라
  // 최신 정상 연무장 원본을 우선한다. 원본이 없는 직업만
  // 기존 배포 프로필로 보완한다.
  const profiles = { ...deployedProfiles, ...recordProfiles };
  const aliasOverrides = await loadAliasOverrides(String(
    options.aliases ??
      "tools/battle-practice-dataset/skill-alias-overrides-v1.json",
  ));
  const dictionary = buildSkillDictionary(snapshots, {
    profiles,
    aliasOverrides,
  });
  const recordProfileSampleCounts = Object.values(recordProfiles).map(
    (profile) => Number(profile?.sampleCount ?? 0),
  ).filter((sampleCount) => sampleCount > 0);
  dictionary.source.battlePracticeAudit = {
    recordPath: battleRecordPath,
    recordProfileClassCount: Object.keys(recordProfiles).length,
    recordProfileSampleCount: Object.values(recordProfiles).reduce(
      (sum, profile) => sum + Number(profile?.sampleCount ?? 0),
      0,
    ),
    recordProfileMinimumSamples: recordProfileSampleCounts.length
      ? Math.min(...recordProfileSampleCounts)
      : null,
    fallbackProfileClassCount: Object.keys(deployedProfiles).filter(
      (characterClass) => !(characterClass in recordProfiles),
    ).length,
    fallbackProfileClasses: Object.keys(deployedProfiles).filter(
      (characterClass) => !(characterClass in recordProfiles),
    ),
  };
  const outputPath = resolve(String(
    options.output ??
      "tools/battle-practice-dataset/generated/skill-dictionary-v1.json",
  ));
  const slimOutputPath = resolve(String(
    options["slim-output"] ??
      "tools/battle-practice-dataset/generated/skill-mechanics-v1.json",
  ));
  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(dirname(slimOutputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(dictionary, null, 2)}\n`, "utf8");
  await writeFile(
    slimOutputPath,
    `${JSON.stringify(slimSkillDictionary(dictionary), null, 2)}\n`,
    "utf8",
  );
  process.stdout.write([
    `직업: ${dictionary.coverage.classCount}`,
    `표본: ${dictionary.coverage.sampleCount}`,
    `직업별 스킬 합계: ${dictionary.coverage.totalSkillCount}`,
    `수동 검토 필요: ${dictionary.coverage.reviewRequiredCount}`,
    `전체 사전: ${outputPath}`,
    `경량 사전: ${slimOutputPath}`,
  ].join("\n") + "\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
