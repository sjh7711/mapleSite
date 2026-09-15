import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  skillLocalIgnoreDefenseChannelsFromSkills,
  targetDefenseEffectsFromSkills,
} from "maple-core/combat-model";
import { calculateActiveSkillCycleBonuses } from "maple-core/stat-efficiency";

function parseArguments(argv) {
  return Object.fromEntries(argv.filter((value) => value.startsWith("--")).map(
    (value) => {
      const [key, ...rest] = value.slice(2).split("=");
      return [key, rest.length ? rest.join("=") : true];
    },
  ));
}

function normalizedSkillName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+VI(?=\s*(?:[:：(（]|$))/gu, "")
    .replace(/\s+/gu, "")
    .trim();
}

function eventSignature(event) {
  return JSON.stringify({
    name: normalizedSkillName(event?.name),
    phase: event?.phase ?? null,
    uptime: event?.uptime ?? null,
    flatAttack: event?.flatAttack ?? 0,
    attackPercent: event?.attackPercent ?? 0,
    damage: event?.damage ?? 0,
    bossDamage: event?.bossDamage ?? 0,
    criticalRate: event?.criticalRate ?? 0,
    criticalDamage: event?.criticalDamage ?? 0,
    ignoreDefense: event?.ignoreDefense ?? 0,
    finalDamage: event?.finalDamage ?? 0,
  });
}

export function auditCombatEffectProvenanceSnapshots(rows) {
  const issues = [];
  const globalIgnoreDefenseEffects = [];
  const classes = new Set();

  for (const row of rows ?? []) {
    const characterClass = String(row?.characterClass ?? "").trim();
    const characterName = String(row?.characterName ?? "").trim();
    if (characterClass) classes.add(characterClass);
    const skillData = row?.skillData ?? [];
    const active = calculateActiveSkillCycleBonuses(
      skillData,
      "attack",
      360,
      { characterClass },
    );
    const localChannels = skillLocalIgnoreDefenseChannelsFromSkills(skillData);
    const targets = targetDefenseEffectsFromSkills(skillData);
    const localByName = new Map(localChannels.map((channel) => [
      normalizedSkillName(channel.source),
      channel,
    ]));
    const seenEvents = new Map();

    for (const event of active.applied ?? []) {
      const signature = eventSignature(event);
      if (seenEvents.has(signature)) {
        issues.push({
          type: "duplicate-active-occurrence",
          characterClass,
          characterName,
          source: event.name,
        });
      } else {
        seenEvents.set(signature, event);
      }

      if (!(Number(event?.ignoreDefense) > 0)) continue;
      globalIgnoreDefenseEffects.push({
        characterClass,
        characterName,
        source: event.name,
        ignoreDefense: event.ignoreDefense,
        uptime: event.uptime,
      });
      const local = localByName.get(normalizedSkillName(event.name));
      if (local) {
        issues.push({
          type: "global-local-scope-overlap",
          characterClass,
          characterName,
          source: event.name,
          globalIgnoreDefense: event.ignoreDefense,
          localIgnoreDefenseSources: local.ignoreDefenseSources,
        });
      }
    }

    for (const target of targets) {
      const local = localByName.get(normalizedSkillName(target.source));
      if (!local) continue;
      issues.push({
        type: "target-local-scope-overlap",
        characterClass,
        characterName,
        source: target.source,
        targetDefenseReduction: target.targetDefenseReduction,
        localIgnoreDefenseSources: local.ignoreDefenseSources,
      });
    }

    const activeNames = new Set(
      (active.applied ?? []).map((event) => normalizedSkillName(event.name)),
    );
    for (const source of active.baselineReflected ?? []) {
      if (!activeNames.has(normalizedSkillName(source))) continue;
      issues.push({
        type: "baseline-active-overlap",
        characterClass,
        characterName,
        source,
      });
    }
  }

  return {
    snapshotCount: rows?.length ?? 0,
    classCount: classes.size,
    issueCount: issues.length,
    issueCounts: Object.fromEntries(
      [...new Set(issues.map(({ type }) => type))]
        .sort()
        .map((type) => [type, issues.filter((issue) => issue.type === type).length]),
    ),
    issues,
    globalIgnoreDefenseEffectCount: globalIgnoreDefenseEffects.length,
    globalIgnoreDefenseEffects,
  };
}

const isDirectRun = process.argv[1] &&
  resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isDirectRun) {
  const options = parseArguments(process.argv.slice(2));
  const input = resolve(String(
    options.input ??
      "tools/battle-practice-dataset/raw/character-skill-snapshots-v1.jsonl",
  ));
  const output = options.output ? resolve(String(options.output)) : null;
  const rows = (await readFile(input, "utf8"))
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const report = auditCombatEffectProvenanceSnapshots(rows);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (output) await writeFile(output, serialized, "utf8");
  process.stdout.write(serialized);
}
