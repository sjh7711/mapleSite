import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { BATTLE_PRACTICE_JOB_CLASSES } from "./battle-practice-job-classes.mjs";
import { CHARACTER_SKILL_GRADES } from "./lib/skill-dictionary.mjs";

const API_BASE = "https://open.api.nexon.com/maplestory/v1";
const REQUEST_INTERVAL_MS = 240;

function argumentsMap(argv) {
  return Object.fromEntries(argv.filter((value) => value.startsWith("--")).map(
    (value) => {
      const [key, ...rest] = value.slice(2).split("=");
      return [key, rest.length ? rest.join("=") : true];
    },
  ));
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function kstYesterday() {
  const value = new Date(Date.now() + 9 * 60 * 60 * 1_000);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

async function jsonFile(path) {
  return JSON.parse(await readFile(resolve(path), "utf8"));
}

async function existingRecords(path) {
  try {
    const value = await readFile(path, "utf8");
    return value.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function snapshotKey(row) {
  return `${String(row?.characterClass ?? "").trim()}\u001f${
    String(row?.characterName ?? "").trim()
  }`;
}

function uniqueLatestSnapshots(rows) {
  const selected = new Map();
  for (const row of rows) {
    const key = snapshotKey(row);
    if (key === "\u001f") continue;
    const current = selected.get(key);
    if (!current || String(row?.collectedAt ?? "").localeCompare(
      String(current?.collectedAt ?? ""),
    ) > 0) selected.set(key, row);
  }
  return [...selected.values()];
}

async function main() {
  const options = argumentsMap(process.argv.slice(2));
  const apiKey = String(process.env.NEXON_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("NEXON_API_KEY 환경 변수가 필요합니다.");
  const references = await jsonFile(String(
    options.references ??
      "tools/battle-practice-dataset/generated/maplescouter-references-all-jobs-20260909-v1.json",
  ));
  if (!Array.isArray(references)) throw new Error("검증 기준은 JSON 배열이어야 합니다.");
  const samplesPerClass = positiveInteger(options.samples, 5);
  const outputPath = resolve(String(
    options.output ??
      "tools/battle-practice-dataset/raw/character-skill-snapshots-v1.jsonl",
  ));
  const selectedClasses = new Set(String(options.classes ?? "")
    .split(/\||;/u).map((value) => value.trim()).filter(Boolean));
  const orderedClasses = BATTLE_PRACTICE_JOB_CLASSES
    .map((entry) => entry.characterClass)
    .filter((characterClass) =>
      !selectedClasses.size || selectedClasses.has(characterClass)
    );
  const jobByClass = new Map(BATTLE_PRACTICE_JOB_CLASSES.map((entry) => [
    entry.characterClass,
    entry,
  ]));
  const candidates = new Map(orderedClasses.map((characterClass) => [
    characterClass,
    references
      .filter((row) => String(row?.characterClass ?? "").trim() === characterClass)
      .map((row) => String(row?.characterName ?? "").trim())
      .filter(Boolean)
      .slice(0, samplesPerClass),
  ]));
  const records = uniqueLatestSnapshots(await existingRecords(outputPath));
  // 전직 차수에 해당 스킬이 없는 직업은 NEXON 응답의
  // character_skill_grade가 null이다. 요청 순서가 11개 모두 보존됐는지로
  // 완전성을 판정하고 null 자체를 누락으로 오인하지 않는다.
  const completed = new Set(records.filter((row) =>
    Array.isArray(row?.skillData) &&
    row.skillData.length === CHARACTER_SKILL_GRADES.length
  ).map(snapshotKey));
  const failures = [];
  let lastRequestAt = 0;
  let requestCount = 0;

  const request = async (path, parameters) => {
    const wait = REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    const url = new URL(`${API_BASE}${path}`);
    for (const [key, value] of Object.entries(parameters)) {
      url.searchParams.set(key, String(value));
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      lastRequestAt = Date.now();
      requestCount += 1;
      const response = await fetch(url, {
        headers: { "x-nxopen-api-key": apiKey },
        redirect: "error",
      });
      if (response.ok) return response.json();
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < 4) {
        await sleep(Math.min(8_000, 750 * 2 ** attempt));
        continue;
      }
      throw new Error(`${path} 요청 실패 (${response.status})`);
    }
    throw new Error(`${path} 요청 재시도 초과`);
  };

  // 외부 효율 기준표에 아직 없는 신규 직업도 스킬 사전에서는 빠뜨리지
  // 않는다. NEXON 종합 랭킹 1페이지에서 필요한 수만 보충한다.
  for (const [characterClass, characterNames] of candidates) {
    if (characterNames.length >= samplesPerClass) continue;
    try {
      const ranking = await request("/ranking/overall", {
        date: String(options.date ?? kstYesterday()),
        world_type: 0,
        class: jobByClass.get(characterClass)?.rankingClass ?? characterClass,
        page: 1,
      });
      for (const row of ranking?.ranking ?? []) {
        const name = String(row?.character_name ?? "").trim();
        if (name && !characterNames.includes(name)) characterNames.push(name);
        if (characterNames.length >= samplesPerClass) break;
      }
    } catch (error) {
      failures.push({
        characterClass,
        stage: "ranking-fallback",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const targetKeys = new Set([...candidates].flatMap(
    ([characterClass, characterNames]) => characterNames.map((characterName) =>
      `${characterClass}\u001f${characterName}`
    ),
  ));
  const completedTargetCount = () => [...targetKeys].filter((key) =>
    completed.has(key)
  ).length;

  await mkdir(dirname(outputPath), { recursive: true });
  let collectedThisRun = 0;
  for (const [characterClass, characterNames] of candidates) {
    for (const characterName of characterNames) {
      if (completed.has(`${characterClass}\u001f${characterName}`)) continue;
      try {
        const id = await request("/id", { character_name: characterName });
        const ocid = String(id?.ocid ?? "").trim();
        if (!ocid) throw new Error("OCID가 없습니다.");
        const skillData = [];
        for (const grade of CHARACTER_SKILL_GRADES) {
          const payload = await request("/character/skill", {
            ocid,
            character_skill_grade: grade,
          });
          skillData.push({
            ...payload,
            requested_skill_grade: grade,
            character_skill_grade:
              payload?.character_skill_grade ?? grade,
          });
        }
        const apiClasses = [...new Set(skillData
          .map((payload) => String(payload?.character_class ?? "").trim())
          .filter(Boolean))];
        if (!apiClasses.includes(characterClass)) {
          throw new Error(
            `직업 불일치: 요청 ${characterClass}, 응답 ${apiClasses.join(", ") || "없음"}`,
          );
        }
        records.push({
          schema: "maplestarforce.character-skill-snapshot.v1",
          characterClass,
          characterName,
          apiClasses,
          collectedAt: new Date().toISOString(),
          skillData,
        });
        completed.add(`${characterClass}\u001f${characterName}`);
        collectedThisRun += 1;
        await writeFile(
          outputPath,
          `${records.map((row) => JSON.stringify(row)).join("\n")}\n`,
          "utf8",
        );
        process.stdout.write(
          `[${characterClass}] ${completedTargetCount()}/${targetKeys.size} 스킬 스냅샷 완료\n`,
        );
      } catch (error) {
        failures.push({
          characterClass,
          characterName,
          message: error instanceof Error ? error.message : String(error),
        });
        process.stderr.write(
          `[${characterClass}] 수집 실패: ${failures.at(-1).message}\n`,
        );
      }
    }
  }
  await writeFile(`${outputPath}.summary.json`, `${JSON.stringify({
    schema: "maplestarforce.character-skill-collection-summary.v1",
    generatedAt: new Date().toISOString(),
    samplesPerClass,
    targetClassCount: candidates.size,
    targetCharacterCount: targetKeys.size,
    completeCharacterCount: completedTargetCount(),
    collectedThisRun,
    requestCount,
    grades: CHARACTER_SKILL_GRADES,
    failures,
  }, null, 2)}\n`, "utf8");
  process.stdout.write(`원본: ${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
