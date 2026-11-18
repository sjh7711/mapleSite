import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toCsv, toTrainingRows } from "./training-lib.mjs";

export async function buildTrainingCsv(inputPath, outputPath = null) {
  const records = (await readFile(inputPath, "utf8"))
    .split(/\r?\n/u)
    .filter(Boolean)
    .map(JSON.parse);
  const rows = toTrainingRows(records);
  const root = path.dirname(path.dirname(inputPath));
  const target = outputPath || path.join(root, "training", "auction-sold.csv");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, toCsv(rows), "utf8");
  return { inputPath, outputPath: target, records: records.length, soldRows: rows.length };
}

const argv = globalThis.process?.argv || [];
const invokedPath = argv[1] ? path.resolve(argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const inputPath = argv[2];
  if (!inputPath) {
    throw new Error("사용법: node tools/build-training.mjs <normalized.jsonl> [auction-sold.csv]");
  }
  const result = await buildTrainingCsv(path.resolve(inputPath), argv[3] ? path.resolve(argv[3]) : null);
  console.log(JSON.stringify(result, null, 2));
}
