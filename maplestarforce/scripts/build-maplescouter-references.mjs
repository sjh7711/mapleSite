import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { referenceEfficiencyRow } from "./lib/maplescouter-efficiency.mjs";

function parseArguments(argv) {
  const options = { positional: [] };
  for (const argument of argv) {
    if (!argument.startsWith("--")) {
      options.positional.push(argument);
      continue;
    }
    const [key, ...rest] = argument.slice(2).split("=");
    options[key] = rest.join("=");
  }
  return options;
}

async function jsonLines(path) {
  return (await readFile(path, "utf8")).split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const inputPaths = String(options.input ?? options.positional[0] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => resolve(value));
  if (!inputPaths.length) throw new Error("--input=원본.jsonl 입력이 필요합니다.");
  const outputPath = resolve(
    options.output ?? options.positional[1] ??
      "tools/battle-practice-dataset/generated/maplescouter-references.json",
  );
  const selectedClasses = new Set(String(options.classes ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean));
  const latestByCharacter = new Map();
  for (const inputPath of inputPaths) {
    for (const record of await jsonLines(inputPath)) {
      if (selectedClasses.size && !selectedClasses.has(record.characterClass)) {
        continue;
      }
      const key = `${record.characterClass}\u0001${record.characterName}`;
      const previous = latestByCharacter.get(key);
      if (!previous || String(record.collectedAt) > String(previous.collectedAt)) {
        latestByCharacter.set(key, record);
      }
    }
  }
  const references = [...latestByCharacter.values()]
    .map(referenceEfficiencyRow)
    .filter(Boolean)
    .sort((left, right) =>
      left.characterClass.localeCompare(right.characterClass, "ko") ||
      left.characterName.localeCompare(right.characterName, "ko")
    );
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(references, null, 2)}\n`, "utf8");
  process.stdout.write(`검증 기준 ${references.length}건: ${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
