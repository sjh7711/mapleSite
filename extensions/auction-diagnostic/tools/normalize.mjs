import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeParsedInput, parseInput } from "./normalize-lib.mjs";

export async function normalizeFile(inputPath, outputPath = null) {
  const before = await readFile(inputPath);
  const parsed = parseInput(before.toString("utf8"));
  const records = normalizeParsedInput(parsed);
  const first = records[0];
  const batchId = first?.source?.batch_id || "unknown";
  const capturedAt = first?.capture?.captured_at || new Date(0).toISOString();
  const timestamp = String(capturedAt)
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15);
  const inputDirectory = path.dirname(inputPath);
  const root = path.basename(inputDirectory).toLowerCase() === "raw"
    ? path.dirname(inputDirectory)
    : inputDirectory;
  const targetDirectory = path.join(root, "normalized");
  const target = outputPath || path.join(
    targetDirectory,
    `maple-auction_normalized_${timestamp}_${String(batchId).slice(0, 8)}.jsonl`
  );
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, { flag: "wx" });
  const after = await readFile(inputPath);
  if (!before.equals(after)) {
    throw new Error("원본 파일이 변했습니다. 출력물을 폐기하고 원본을 확인하세요.");
  }
  return { inputPath, outputPath: target, records: records.length };
}

const argv = globalThis.process?.argv || [];
const invokedPath = argv[1] ? path.resolve(argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const inputPath = argv[2];
  if (!inputPath) {
    throw new Error("사용법: node tools/normalize.mjs <raw-v1.jsonl|capture-v2.json> [normalized.jsonl]");
  }
  const result = await normalizeFile(path.resolve(inputPath), argv[3] ? path.resolve(argv[3]) : null);
  console.log(JSON.stringify(result, null, 2));
}
