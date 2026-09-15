import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadCharacterExclusions } from "./lib/character-exclusions.mjs";
import {
  buildMapleScouterReferenceSet,
  parseMapleScouterClassList,
  parseMapleScouterReferenceInput,
} from "./lib/maplescouter-reference-set.mjs";

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
  if (Array.isArray(value)) return value.at(-1);
  return value ?? fallback;
}

function commaSeparatedOptions(value) {
  return (Array.isArray(value) ? value : [value])
    .filter((entry) => entry !== undefined && entry !== true)
    .flatMap((entry) => String(entry).split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function booleanOption(value) {
  const scalar = scalarOption(value, false);
  if (scalar === true) return true;
  if (scalar === false || scalar === "" || scalar === "false" || scalar === "0") {
    return false;
  }
  return true;
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(path, value, overwrite) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: overwrite ? "w" : "wx",
  });
}

async function loadInputs(paths) {
  const records = [];
  for (const path of paths) {
    records.push(...parseMapleScouterReferenceInput(
      await readFile(path, "utf8"),
      path,
    ));
  }
  return records;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const inputValues = commaSeparatedOptions(options.input);
  if (!inputValues.length && options.positional[0]) {
    inputValues.push(...String(options.positional[0]).split(",").filter(Boolean));
  }
  if (!inputValues.length) {
    throw new Error("--input=기존.json,신규.jsonl 입력이 필요합니다.");
  }
  const inputPaths = inputValues.map((path) => resolve(path));
  const exclusionPaths = commaSeparatedOptions(options["exclude-input"])
    .map((path) => resolve(path));
  const outputPath = resolve(String(scalarOption(
    options.output,
    options.positional[1] ??
      "tools/battle-practice-dataset/generated/maplescouter-references-merged.json",
  )));
  const reportPath = resolve(String(scalarOption(
    options.report,
    `${outputPath}.report.json`,
  )));
  if (outputPath === reportPath) {
    throw new Error("--output과 --report는 서로 다른 경로여야 합니다.");
  }
  const overwrite = booleanOption(options.overwrite);
  if (!overwrite && await pathExists(reportPath)) {
    throw new Error(`보고서가 이미 있습니다: ${reportPath}`);
  }
  if (!overwrite && await pathExists(outputPath)) {
    throw new Error(`출력 파일이 이미 있습니다: ${outputPath}`);
  }

  const result = buildMapleScouterReferenceSet({
    records: await loadInputs(inputPaths),
    excludedCharacterKeys: await loadCharacterExclusions(exclusionPaths),
    classes: parseMapleScouterClassList(scalarOption(options.classes)),
    samples: scalarOption(options.samples, 5),
    includeDemonAvenger: booleanOption(options["include-demon-avenger"]),
  });

  await writeJson(reportPath, result.report, overwrite);
  if (!result.ok) {
    const missing = result.report.missingClasses.map(
      ({ characterClass, shortfall }) => `${characterClass} ${shortfall}명 부족`,
    ).join(", ");
    throw new Error(
      `기준표 병합 실패: ${missing || result.report.failureReasons.join(", ")}`,
    );
  }
  await writeJson(outputPath, result.references, overwrite);
  process.stdout.write(
    `검증 기준 ${result.references.length}건: ${outputPath}\n병합 보고서: ${reportPath}\n`,
  );
  return result;
}

if (process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
