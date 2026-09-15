import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BATTLE_PRACTICE_EXCLUDED_CLASSES,
  BATTLE_PRACTICE_JOB_CLASSES,
} from "./battle-practice-job-classes.mjs";
import {
  characterReferenceKey,
  loadCharacterExclusions,
} from "./lib/character-exclusions.mjs";

const API_BASE = "https://open.api.nexon.com/maplestory/v1";
const REQUEST_INTERVAL_MS = 240;

function parseArguments(argv) {
  const parsed = {};
  for (const argument of argv) {
    if (!argument.startsWith("--")) continue;
    const [key, ...rest] = argument.slice(2).split("=");
    parsed[key] = rest.length ? rest.join("=") : true;
  }
  return parsed;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function kstYesterday() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1_000);
  now.setUTCDate(now.getUTCDate() - 1);
  return now.toISOString().slice(0, 10);
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/gu, "").replace(/\.\d+Z$/u, "Z");
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function loadSeedNames(path) {
  if (!path) return {};
  const payload = JSON.parse(await readFile(resolve(path), "utf8"));
  return Object.fromEntries(
    Object.entries(payload).map(([characterClass, names]) => [
      characterClass,
      [...new Set((Array.isArray(names) ? names : [])
        .map((name) => String(name).trim())
        .filter(Boolean))],
    ]),
  );
}

async function loadCheckpoint(path) {
  try {
    const text = await readFile(path, "utf8");
    return text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
      .map((line, index) => {
        try {
          return JSON.parse(line);
        } catch {
          throw new Error(`${path}:${index + 1} 체크포인트 JSON 형식이 잘못되었습니다.`);
        }
      });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

function completedReferenceKey(record) {
  const characterClass = String(record?.characterClass ?? "").trim();
  const characterName = String(
    record?.currentCharacterName ?? record?.characterName ?? "",
  ).trim();
  const ocid = String(
    record?.ocid ??
      record?.identityProvenance?.ocid ??
      record?.provenance?.ocid ??
      "",
  ).trim();
  const basic = record?.characterInfo?.basic_object;
  const result = record?.result;
  const timelineEntries = record?.skillTimeline?.entries;
  return characterClass && characterName &&
      record?.schema === "maplestarforce.battle-practice-record.v2" &&
      String(record?.replayId ?? "").trim() &&
      String(basic?.character_class ?? "").trim() === characterClass &&
      String(basic?.character_name ?? "").trim() &&
      String(result?.end_type ?? "") === "1" &&
      Number(result?.total_play_time ?? 0) > 0 &&
      Number(result?.total_play_time ?? 0) <= 400_000 &&
      Array.isArray(result?.skill_statistic) &&
      Array.isArray(timelineEntries) && timelineEntries.length > 0
    ? `${characterClass}\u001f${ocid ? `ocid:${ocid}` : characterName}`
    : null;
}

function completedCandidateReferenceKeys(record) {
  const primary = completedReferenceKey(record);
  if (!primary) return [];
  const characterClass = String(record?.characterClass ?? "").trim();
  return [...new Set([
    record?.characterName,
    record?.currentCharacterName,
    record?.replayCharacterName,
    record?.characterInfo?.basic_object?.character_name,
  ].map((name) => String(name ?? "").trim()).filter(Boolean))]
    .map((name) => `${characterClass}\u001f${name}`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const apiKey = String(process.env.NEXON_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("NEXON_API_KEY 환경 변수가 필요합니다. 키를 파일이나 인자에 넣지 마세요.");
  }
  const rankingDate = String(options.date ?? kstYesterday());
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(rankingDate)) {
    throw new Error("--date는 YYYY-MM-DD 형식이어야 합니다.");
  }
  const targetSamples = positiveInteger(options.samples, 5);
  const rankingPages = positiveInteger(options["ranking-pages"], 5);
  const includeReplayContext = options["include-context"] !== "false";
  const maximumTimelinePages = positiveInteger(
    options["max-timeline-pages"],
    500,
  );
  const classInput = String(options.classes ?? "");
  const classSeparator = classInput.includes("|")
    ? "|"
    : classInput.includes(";")
      ? ";"
      : ",";
  const selectedNames = classInput
    .split(classSeparator)
    .map((name) => name.trim())
    .filter(Boolean);
  const selectedSet = new Set(selectedNames);
  const jobs = BATTLE_PRACTICE_JOB_CLASSES.filter(({ characterClass }) =>
    !BATTLE_PRACTICE_EXCLUDED_CLASSES.includes(characterClass) &&
    (!selectedSet.size || selectedSet.has(characterClass))
  );
  if (!jobs.length) throw new Error("수집할 직업이 없습니다.");
  const seeds = await loadSeedNames(options["seed-file"]);
  const excludedCharacters = await loadCharacterExclusions(
    String(options["exclude-input"] ?? "")
      .split(",")
      .map((path) => path.trim())
      .filter(Boolean),
  );
  const outputPath = resolve(String(
    options.output ??
      `tools/battle-practice-dataset/raw/battle-practice-${timestamp()}.jsonl`,
  ));
  const existingInputPaths = String(options["existing-input"] ?? "")
    .split(",").map((path) => path.trim()).filter(Boolean)
    .map((path) => resolve(path));
  const resume = Boolean(options.resume);
  if (resume && options.overwrite) {
    throw new Error("--resume와 --overwrite는 함께 사용할 수 없습니다.");
  }
  if (resume && !options.output) {
    throw new Error("--resume에는 재개할 고정 --output 경로가 필요합니다.");
  }
  await mkdir(dirname(outputPath), { recursive: true });
  const checkpointRecords = resume ? await loadCheckpoint(outputPath) : [];
  const resumedRecordCount = checkpointRecords.length;
  if (!resume) {
    await writeFile(outputPath, "", {
      encoding: "utf8",
      flag: options.overwrite ? "w" : "wx",
    });
  } else if (!checkpointRecords.length) {
    await writeFile(outputPath, "", { encoding: "utf8", flag: "a" });
  }
  const importedRecords = (await Promise.all(
    existingInputPaths.map((path) => loadCheckpoint(path)),
  )).flat();
  const selectedClasses = new Set(jobs.map(({ characterClass }) =>
    characterClass
  ));
  const existingReplayIds = new Set(checkpointRecords.map((record) =>
    String(record?.replayId ?? "").trim()
  ).filter(Boolean));
  let importedAcceptedCount = 0;
  for (const record of importedRecords) {
    const characterClass = String(record?.characterClass ?? "").trim();
    const replayId = String(record?.replayId ?? "").trim();
    const recordNames = [
      record?.characterName,
      record?.currentCharacterName,
      record?.replayCharacterName,
      record?.characterInfo?.basic_object?.character_name,
    ].map((name) => String(name ?? "").trim()).filter(Boolean);
    if (
      !selectedClasses.has(characterClass) ||
      !completedReferenceKey(record) ||
      recordNames.some((name) => excludedCharacters.has(
        characterReferenceKey(characterClass, name),
      )) ||
      (replayId && existingReplayIds.has(replayId))
    ) continue;
    checkpointRecords.push(record);
    if (replayId) existingReplayIds.add(replayId);
    await appendFile(outputPath, `${JSON.stringify(record)}\n`, "utf8");
    importedAcceptedCount += 1;
  }
  const completedReferences = new Set(
    checkpointRecords.map(completedReferenceKey).filter(Boolean),
  );
  const completedCandidateReferences = new Set(
    checkpointRecords.flatMap(completedCandidateReferenceKeys),
  );
  const requestLog = [];
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

  const collected = [...checkpointRecords];
  const failures = [];
  for (const job of jobs) {
    let classSamples = [...completedReferences].filter((key) =>
      key.startsWith(`${job.characterClass}\u001f`)
    ).length;
    if (classSamples >= targetSamples) {
      process.stdout.write(
        `[${job.characterClass}] 체크포인트 ${classSamples}/${targetSamples}\n`,
      );
      continue;
    }
    const candidateNames = [...(seeds[job.characterClass] ?? [])];
    for (let page = 1; page <= rankingPages; page += 1) {
      if (candidateNames.length >= targetSamples * 5) break;
      try {
        const payload = await request("/ranking/overall", {
          date: rankingDate,
          world_type: 0,
          class: job.rankingClass,
          page,
        });
        for (const row of payload.ranking ?? []) {
          const name = String(row?.character_name ?? "").trim();
          if (name && !candidateNames.includes(name)) candidateNames.push(name);
        }
      } catch (error) {
        failures.push({
          characterClass: job.characterClass,
          stage: "ranking",
          message: error instanceof Error ? error.message : String(error),
        });
        break;
      }
    }
    for (const characterName of candidateNames) {
      if (classSamples >= targetSamples) break;
      if (completedCandidateReferences.has(
        `${job.characterClass}\u001f${characterName}`,
      )) continue;
      if (excludedCharacters.has(
        characterReferenceKey(job.characterClass, characterName),
      )) continue;
      try {
        const id = await request("/id", { character_name: characterName });
        const ocid = String(id?.ocid ?? "").trim();
        if (!ocid) continue;
        const replayPayload = await request("/battle-practice/replay-id", { ocid });
        const replayList = (Array.isArray(replayPayload?.replay_list)
          ? replayPayload.replay_list
          : [])
          .filter((entry) => String(entry?.replay_id ?? "").trim())
          .sort((left, right) => {
            const period = Number(right?.period_no ?? 0) - Number(left?.period_no ?? 0);
            return period || String(right?.register_date ?? "").localeCompare(
              String(left?.register_date ?? ""),
            );
          });
        let acceptedResult = null;
        let acceptedReplay = null;
        for (const replay of replayList.slice(0, 3)) {
          const result = await request("/battle-practice/result", {
            replay_id: String(replay.replay_id).trim(),
          });
          if (
            String(result?.end_type ?? "") === "1" &&
            Number(result?.total_play_time ?? 0) > 0 &&
            Number(result?.total_play_time ?? 0) <= 400_000 &&
            Array.isArray(result?.skill_statistic)
          ) {
            acceptedResult = {
              ...result,
              register_date: result.register_date ?? replay.register_date ?? null,
            };
            acceptedReplay = replay;
            break;
          }
        }
        if (!acceptedResult || !acceptedReplay) continue;
        const replayId = String(acceptedReplay.replay_id).trim();
        let characterInfo = null;
        let skillTimeline = null;
        if (includeReplayContext) {
          characterInfo = await request("/battle-practice/character-info", {
            replay_id: replayId,
          });
          const timelineRows = [];
          let totalPages = 1;
          for (let page = 1; page <= totalPages; page += 1) {
            if (page > maximumTimelinePages) {
              throw new Error(
                `스킬 타임라인 ${totalPages}페이지가 안전 상한 ${maximumTimelinePages}를 초과했습니다.`,
              );
            }
            const timelinePage = await request(
              "/battle-practice/skill-timeline",
              { replay_id: replayId, page_no: page },
            );
            totalPages = Math.max(
              page,
              Number(timelinePage?.total_page_no ?? page),
            );
            timelineRows.push(...(
              Array.isArray(timelinePage?.skill_timeline)
                ? timelinePage.skill_timeline
                : []
            ));
          }
          skillTimeline = {
            totalPageNo: totalPages,
            entries: timelineRows,
          };
        }
        const replayCharacterName = String(
          characterInfo?.basic_object?.character_name ?? characterName,
        ).trim() || characterName;
        const collectedRecord = {
          schema: "maplestarforce.battle-practice-record.v2",
          characterClass: job.characterClass,
          // characterName은 피해·스탯 스냅샷과 같은 시점의 이름을 쓴다.
          // 현재 랭킹 이름과 다르면 OCID provenance로 안전하게 연결한다.
          characterName: replayCharacterName,
          currentCharacterName: characterName,
          replayCharacterName,
          ocid,
          identityProvenance: {
            method: "ocid-replay-id",
            ocid,
            currentCharacterName: characterName,
            replayCharacterName,
          },
          rankingDate,
          collectedAt: new Date().toISOString(),
          replayId,
          replayMetadata: {
            periodNo: Number(acceptedReplay?.period_no ?? 0) || null,
            registerDate: acceptedReplay?.register_date ??
              acceptedResult?.register_date ?? null,
          },
          result: acceptedResult,
          characterInfo,
          skillTimeline,
        };
        collected.push(collectedRecord);
        await appendFile(
          outputPath,
          `${JSON.stringify(collectedRecord)}\n`,
          "utf8",
        );
        completedReferences.add(
          `${job.characterClass}\u001f${characterName}`,
        );
        for (const key of completedCandidateReferenceKeys(collectedRecord)) {
          completedCandidateReferences.add(key);
        }
        classSamples += 1;
        process.stdout.write(
          `[${job.characterClass}] 정상 자동 종료 ${classSamples}/${targetSamples}\n`,
        );
      } catch (error) {
        failures.push({
          characterClass: job.characterClass,
          characterName,
          stage: "record",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (classSamples < targetSamples) {
      process.stdout.write(
        `[${job.characterClass}] 표본 부족 ${classSamples}/${targetSamples}\n`,
      );
    }
  }
  const summaryPath = `${outputPath}.summary.json`;
  await writeFile(summaryPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    rankingDate,
    targetSamples,
    includeReplayContext,
    maximumTimelinePages,
    classCount: jobs.length,
    recordCount: collected.length,
    resumedRecordCount,
    importedCandidateCount: importedRecords.length,
    importedRecordCount: importedAcceptedCount,
    importedInputPaths: existingInputPaths,
    requestCount: requestLog.length,
    excludedCharacterCount: excludedCharacters.size,
    failures,
  }, null, 2)}\n`, { encoding: "utf8", flag: "w" });
  process.stdout.write(`원본 기록: ${outputPath}\n요약: ${summaryPath}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
