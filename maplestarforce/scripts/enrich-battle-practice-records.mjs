import {
  appendFile,
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  BATTLE_PRACTICE_EXCLUDED_CLASSES,
} from "./battle-practice-job-classes.mjs";
import {
  characterReferenceKey,
  loadCharacterExclusions,
} from "./lib/character-exclusions.mjs";
import {
  replayForLegacyRecord,
  selectLegacyRecordsForEnrichment,
} from "./lib/battle-practice-enrichment.mjs";

const API_BASE = "https://open.api.nexon.com/maplestory/v1";
const REQUEST_INTERVAL_MS = 240;

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

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function separatedValues(value) {
  return String(value ?? "").split(/[|;,]/u)
    .map((entry) => entry.trim()).filter(Boolean);
}

async function readJsonLines(path) {
  const absolute = resolve(path);
  const text = await readFile(absolute, "utf8");
  return text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
    .map((line, index) => {
      try {
        return { ...JSON.parse(line), sourcePath: absolute };
      } catch {
        throw new Error(`${absolute}:${index + 1} JSON 형식이 잘못되었습니다.`);
      }
    });
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function outputRecordKey(record) {
  const characterClass = String(record?.characterClass ?? "").trim();
  const characterName = String(record?.characterName ?? "").trim();
  return characterClass && characterName
    ? `${characterClass}\u001f${characterName}`
    : null;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const inputPaths = [
    ...options.positional,
    ...separatedValues(options.input),
  ];
  if (!inputPaths.length) {
    throw new Error("보강할 schema v1 JSONL 입력 경로가 필요합니다.");
  }
  const apiKey = String(process.env.NEXON_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("NEXON_API_KEY 환경 변수가 필요합니다.");
  const outputPath = resolve(String(
    options.output ??
      "tools/battle-practice-dataset/raw/battle-practice-enriched-v2.jsonl",
  ));
  const summaryPath = `${outputPath}.summary.json`;
  const resume = Boolean(options.resume);
  if (await fileExists(outputPath) && !resume) {
    throw new Error("출력 파일이 이미 있습니다. 이어받으려면 --resume을 사용하세요.");
  }
  await mkdir(dirname(outputPath), { recursive: true });
  if (!(await fileExists(outputPath))) await writeFile(outputPath, "", "utf8");

  const existingRows = resume
    ? await readJsonLines(outputPath)
    : [];
  const completedKeys = new Set(existingRows.map(outputRecordKey).filter(Boolean));
  const legacyRows = (await Promise.all(inputPaths.map(readJsonLines))).flat();
  const excludedClasses = new Set(BATTLE_PRACTICE_EXCLUDED_CLASSES);
  const selectedClasses = new Set(separatedValues(options.classes));
  const excludedReferences = await loadCharacterExclusions(
    separatedValues(options["exclude-input"]),
  );
  const excludedReferenceKeys = new Set(excludedReferences);
  for (const record of legacyRows) {
    if (excludedClasses.has(String(record?.characterClass ?? "").trim())) {
      const key = characterReferenceKey(record.characterClass, record.characterName);
      if (key) excludedReferenceKeys.add(key);
    }
  }
  const targetSamples = positiveInteger(options.samples, 5);
  const { selected, classReports } = selectLegacyRecordsForEnrichment(
    legacyRows,
    { samplesPerClass: targetSamples, excludedReferenceKeys, selectedClasses },
  );
  const requestLog = [];
  const failures = [];
  let lastRequestAt = 0;
  const request = async (path, parameters) => {
    const elapsed = Date.now() - lastRequestAt;
    if (elapsed < REQUEST_INTERVAL_MS) {
      await sleep(REQUEST_INTERVAL_MS - elapsed);
    }
    const url = new URL(`${API_BASE}${path}`);
    for (const [key, value] of Object.entries(parameters)) {
      if (value !== null && value !== undefined && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
    for (let attempt = 0; attempt < 4; attempt += 1) {
      lastRequestAt = Date.now();
      const response = await fetch(url, {
        headers: { "x-nxopen-api-key": apiKey },
        redirect: "error",
      });
      requestLog.push({ path, status: response.status });
      if (response.ok) return response.json();
      if (response.status === 429 && attempt < 3) {
        await sleep(1_000 * 2 ** attempt);
        continue;
      }
      throw new Error(`${path} 요청 실패 (${response.status})`);
    }
    throw new Error(`${path} 요청 재시도 초과`);
  };

  const saveSummary = async () => writeFile(summaryPath, `${JSON.stringify({
    schema: "maplestarforce.battle-practice-enrichment-summary.v1",
    updatedAt: new Date().toISOString(),
    inputs: inputPaths.map((path) => resolve(path)),
    outputPath,
    targetSamples,
    selectedCount: selected.length,
    completedCount: completedKeys.size,
    requestCount: requestLog.length,
    excludedCharacterCount: excludedReferenceKeys.size,
    classReports,
    failures,
  }, null, 2)}\n`, "utf8");

  for (const legacy of selected) {
    const key = outputRecordKey(legacy);
    if (!key || completedKeys.has(key)) continue;
    try {
      const characterName = String(legacy.characterName).trim();
      const id = await request("/id", { character_name: characterName });
      const ocid = String(id?.ocid ?? "").trim();
      if (!ocid) throw new Error("OCID가 없습니다.");
      const replayPayload = await request("/battle-practice/replay-id", { ocid });
      const replay = replayForLegacyRecord(replayPayload?.replay_list, legacy);
      if (!replay) {
        throw new Error(
          `기존 기록일 ${legacy?.result?.register_date ?? "미상"}의 리플레이를 찾지 못했습니다.`,
        );
      }
      const replayId = String(replay.replay_id).trim();
      const characterInfo = await request("/battle-practice/character-info", {
        replay_id: replayId,
      });
      const replayCharacterName = String(
        characterInfo?.basic_object?.character_name ?? characterName,
      ).trim() || characterName;
      const timelineRows = [];
      let totalPages = 1;
      for (let page = 1; page <= totalPages; page += 1) {
        const payload = await request("/battle-practice/skill-timeline", {
          replay_id: replayId,
          page_no: page,
        });
        totalPages = Math.max(page, Number(payload?.total_page_no ?? page));
        timelineRows.push(...(
          Array.isArray(payload?.skill_timeline) ? payload.skill_timeline : []
        ));
      }
      const record = {
        schema: "maplestarforce.battle-practice-record.v2",
        characterClass: String(legacy.characterClass).trim(),
        characterName: replayCharacterName,
        currentCharacterName: characterName,
        replayCharacterName,
        ocid,
        collectedAt: new Date().toISOString(),
        replayId,
        replayMetadata: {
          periodNo: Number(replay?.period_no ?? 0) || null,
          registerDate: replay?.register_date ??
            legacy?.result?.register_date ?? null,
        },
        result: legacy.result,
        characterInfo,
        skillTimeline: { totalPageNo: totalPages, entries: timelineRows },
        provenance: {
          kind: "legacy-result-context-enrichment",
          sourcePath: legacy.sourcePath,
          ocid,
          currentCharacterName: characterName,
          replayCharacterName,
        },
      };
      await appendFile(outputPath, `${JSON.stringify(record)}\n`, "utf8");
      completedKeys.add(key);
      await saveSummary();
      process.stdout.write(
        `[${record.characterClass}] ${record.characterName} 보강 ` +
        `${completedKeys.size}/${selected.length}\n`,
      );
    } catch (error) {
      failures.push({
        characterClass: legacy.characterClass,
        characterName: legacy.characterName,
        message: error instanceof Error ? error.message : String(error),
      });
      await saveSummary();
    }
  }
  await saveSummary();
  process.stdout.write(`보강 원본: ${outputPath}\n요약: ${summaryPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
