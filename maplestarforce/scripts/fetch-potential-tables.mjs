/* 넥슨 공식 잠재능력 확률표를 미리 받아 파일로 저장한다.
   브라우저에서는 공식 페이지를 바로 부를 수 없어(CORS), 빌드 전에 한 번
   받아 두고 사이트는 그 파일만 읽는다. 표가 바뀌면 다시 돌리면 된다. */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import {
  POTENTIAL_GRADES,
  POTENTIAL_PARTS,
  POTENTIAL_TABLE_SOURCES,
  parseOfficialPotentialTables,
} from "maple-core/potential";
import {
  candidateLevelsForBand,
  POTENTIAL_LEVEL_BANDS,
} from "./potential-table-levels.mjs";

const MIN_REQUEST_INTERVAL_MS = 180;
const WORKER_COUNT = 4;
const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 800;
const CHECKPOINT_INTERVAL = 25;
const OFFICIAL_ENDPOINT =
  "https://maplestory.nexon.com/Guide/OtherProbability/cube/GetSearchProbList";
const EMPTY_TABLE_MESSAGE =
  "장비 분류 및 장비 레벨에 해당하는 장비 아이템이 없습니다.";
const OUTPUT = new URL("../src/data/potential-tables.json", import.meta.url);
const CHECKPOINT = new URL(
  "../src/data/potential-tables.partial.json",
  import.meta.url,
);
const OUTPUT_TEMP = new URL(
  "../src/data/potential-tables.json.tmp",
  import.meta.url,
);
const CHECKPOINT_TEMP = new URL(
  "../src/data/potential-tables.partial.json.tmp",
  import.meta.url,
);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class EmptyOfficialTableError extends Error {
  constructor() {
    super(EMPTY_TABLE_MESSAGE);
    this.name = "EmptyOfficialTableError";
  }
}

class OfficialHttpError extends Error {
  constructor(status, retryAfterMs = 0) {
    super(`넥슨 공식 확률표 조회 실패 (HTTP ${status})`);
    this.name = "OfficialHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function requestedSystems(args) {
  const option = args.find((argument) =>
    argument.startsWith("--source=") || argument.startsWith("--system=")
  );
  if (!option) return Object.keys(POTENTIAL_TABLE_SOURCES);

  const systems = [...new Set(option.slice(option.indexOf("=") + 1).split(","))];
  if (
    systems.length === 0 ||
    systems.some((system) => !Object.hasOwn(POTENTIAL_TABLE_SOURCES, system))
  ) {
    throw new RangeError(
      `--source는 ${Object.keys(POTENTIAL_TABLE_SOURCES).join(", ")} 중에서 골라 주세요.`,
    );
  }
  return systems;
}

function validateTables(tables) {
  if (
    !Array.isArray(tables) ||
    tables.length !== 3 ||
    tables.some(
      (line) =>
        !Array.isArray(line) ||
        line.length === 0 ||
        line.some(
          (option) =>
            typeof option?.name !== "string" ||
            option.name.trim() === "" ||
            !Number.isFinite(option.probability) ||
            option.probability <= 0,
        ),
    )
  ) {
    throw new Error("확률표가 완전한 3개 옵션 줄을 포함하지 않습니다.");
  }
  return tables;
}

async function readJson(url) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeSnapshot(url, temporaryUrl, snapshot) {
  await writeFile(temporaryUrl, `${JSON.stringify(snapshot)}\n`, "utf8");
  await rename(temporaryUrl, url);
}

function sameStrings(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function inferBandsBySystem(snapshot, allSystems) {
  return Object.fromEntries(
    allSystems.map((system) => [
      system,
      snapshot?.bandsBySystem?.[system] ?? snapshot?.bands ?? POTENTIAL_LEVEL_BANDS,
    ]),
  );
}

async function loadCheckpoint(systems) {
  const checkpoint = await readJson(CHECKPOINT);
  if (
    !checkpoint ||
    !sameStrings(checkpoint.fetchSystems, systems) ||
    systems.some(
      (system) =>
        !sameStrings(checkpoint.bandsBySystem?.[system], POTENTIAL_LEVEL_BANDS),
    ) ||
    !checkpoint.tables ||
    typeof checkpoint.tables !== "object"
  ) {
    return null;
  }
  for (const tables of Object.values(checkpoint.tables)) validateTables(tables);
  return checkpoint;
}

async function createSnapshot(systems, allSystems) {
  const checkpoint = await loadCheckpoint(systems);
  if (checkpoint) return { checkpoint, snapshot: checkpoint };

  const current = await readJson(OUTPUT);
  const isSelected = (key) => systems.includes(key.split(":", 1)[0]);
  const tables = Object.fromEntries(
    Object.entries(current?.tables ?? {}).filter(([key]) => !isSelected(key)),
  );
  const missing = (current?.missing ?? []).filter((key) => !isSelected(key));
  const bandsBySystem = inferBandsBySystem(current, allSystems);
  for (const system of systems) bandsBySystem[system] = POTENTIAL_LEVEL_BANDS;

  return {
    checkpoint: null,
    snapshot: {
      savedAt: current?.savedAt ?? new Date().toISOString(),
      savedAtBySystem: Object.fromEntries(
        allSystems.map((system) => [
          system,
          current?.savedAtBySystem?.[system] ?? current?.savedAt ?? null,
        ]),
      ),
      // 기존 index 소비자용 fallback. 신규 loader는 bandsBySystem을 우선한다.
      bands: current?.bands ?? POTENTIAL_LEVEL_BANDS,
      bandsBySystem,
      tables,
      checked: {},
      missing,
      fetchSystems: systems,
    },
  };
}

let requestGate = Promise.resolve();
let nextRequestAt = 0;
let globalBackoffUntil = 0;

async function takeRequestSlot() {
  let release;
  const previous = requestGate;
  requestGate = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  const delay = Math.max(0, nextRequestAt - Date.now(), globalBackoffUntil - Date.now());
  if (delay > 0) await wait(delay);
  nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
  release();
}

async function fetchTableHtml({ system, grade, part, itemLevel }) {
  const systemInfo = POTENTIAL_TABLE_SOURCES[system];
  const gradeInfo = POTENTIAL_GRADES[grade];
  const body = new URLSearchParams({
    nCubeItemID: systemInfo.cubeItemId,
    nGrade: String(gradeInfo.id),
    nPartsType: String(part),
    nReqLev: String(itemLevel),
  });

  await takeRequestSlot();
  const response = await fetch(OFFICIAL_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Referer: systemInfo.officialPage,
      "User-Agent": "Maple-Starforce-Potential-Snapshot/1.0",
      "X-Requested-With": "XMLHttpRequest",
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const retryAfterSeconds = Number.parseFloat(response.headers.get("Retry-After"));
    const retryAfterMs = Number.isFinite(retryAfterSeconds)
      ? retryAfterSeconds * 1_000
      : response.status === 429
        ? RETRY_BASE_MS * 4
        : 0;
    if (response.status === 429) {
      globalBackoffUntil = Math.max(globalBackoffUntil, Date.now() + retryAfterMs);
    }
    throw new OfficialHttpError(
      response.status,
      retryAfterMs,
    );
  }
  return response.text();
}

async function fetchSnapshotTables(options) {
  const html = await fetchTableHtml(options);
  if (html.includes(EMPTY_TABLE_MESSAGE)) {
    throw new EmptyOfficialTableError();
  }
  return validateTables(parseOfficialPotentialTables(html));
}

async function fetchWithRetry(options, key) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fetchSnapshotTables(options);
    } catch (error) {
      if (error instanceof EmptyOfficialTableError) throw error;
      lastError = error;
      if (attempt === MAX_ATTEMPTS) break;
      const exponentialDelay = RETRY_BASE_MS * 2 ** (attempt - 1);
      const delay = Math.max(exponentialDelay, error.retryAfterMs ?? 0);
      console.warn(`  ${key} 재시도 ${attempt}/${MAX_ATTEMPTS - 1} · ${error.message}`);
      await wait(delay);
    }
  }
  throw lastError;
}

/** 같은 구간 안에서 해당 부위의 실제 장비가 있는 레벨을 찾는다. */
async function discoverTables({ system, grade, part, band, key }) {
  for (const itemLevel of candidateLevelsForBand(band)) {
    try {
      const tables = await fetchSnapshotTables({ system, grade, part, itemLevel });
      return { itemLevel, tables };
    } catch (error) {
      if (error instanceof EmptyOfficialTableError) continue;
      try {
        const tables = await fetchWithRetry(
          { system, grade, part, itemLevel },
          key,
        );
        return { itemLevel, tables };
      } catch (retryError) {
        if (retryError instanceof EmptyOfficialTableError) continue;
        throw retryError;
      }
    }
  }
  return null;
}

async function main() {
  const allSystems = Object.keys(POTENTIAL_TABLE_SOURCES);
  const systems = requestedSystems(process.argv.slice(2));
  const grades = Object.keys(POTENTIAL_GRADES);
  const gradesBySystem = Object.fromEntries(
    systems.map((system) => {
      const maxGradeIndex = grades.indexOf(
        POTENTIAL_TABLE_SOURCES[system].maxGrade,
      );
      return [system, grades.slice(0, maxGradeIndex + 1)];
    }),
  );
  const parts = Object.keys(POTENTIAL_PARTS).map(Number);
  const total = systems.reduce(
    (sum, system) =>
      sum + gradesBySystem[system].length * parts.length * POTENTIAL_LEVEL_BANDS.length,
    0,
  );
  const { checkpoint, snapshot } = await createSnapshot(systems, allSystems);
  const missing = new Set(snapshot.missing);
  const representativePromises = new Map();
  const discoveredTables = new Map();

  if (checkpoint) {
    const complete = Object.keys(snapshot.tables).filter((key) =>
      systems.includes(key.split(":", 1)[0]),
    ).length;
    console.log(`중간 저장본에서 ${complete}개 조합을 이어서 받습니다.`);
  } else {
    console.log(`${systems.join(", ")} 확률표 ${total}개 조합을 확인합니다.`);
  }

  let checkpointPromise = Promise.resolve();
  let changesSinceCheckpoint = 0;
  const markChanged = () => {
    changesSinceCheckpoint += 1;
    if (changesSinceCheckpoint < CHECKPOINT_INTERVAL) return;
    changesSinceCheckpoint = 0;
    checkpointPromise = checkpointPromise.then(async () => {
      await mkdir(new URL(".", CHECKPOINT), { recursive: true });
      await writeSnapshot(CHECKPOINT, CHECKPOINT_TEMP, snapshot);
    });
  };

  const hasChecked = (key) => Object.hasOwn(snapshot.checked, key);
  const ensureRepresentative = ({ part, band }) => {
    const representativeKey = `${part}:${band}`;
    if (hasChecked(representativeKey)) {
      return Promise.resolve(snapshot.checked[representativeKey]);
    }
    if (representativePromises.has(representativeKey)) {
      return representativePromises.get(representativeKey);
    }

    const system = systems[0];
    const grade = "rare";
    const tableKey = `${system}:${grade}:${part}:${band}`;
    const promise = discoverTables({ system, grade, part, band, key: tableKey })
      .then((discovered) => {
        if (discovered === null) {
          snapshot.checked[representativeKey] = null;
          console.log(`  ${representativeKey} · 해당 레벨 구간의 장비 없음`);
        } else {
          snapshot.checked[representativeKey] = discovered.itemLevel;
          discoveredTables.set(tableKey, discovered.tables);
        }
        markChanged();
        return snapshot.checked[representativeKey];
      })
      .catch((error) => {
        representativePromises.delete(representativeKey);
        throw error;
      });
    representativePromises.set(representativeKey, promise);
    return promise;
  };

  const tasks = systems.flatMap((system) =>
    gradesBySystem[system].flatMap((grade) =>
      parts.flatMap((part) =>
        POTENTIAL_LEVEL_BANDS.map((band) => ({
          system,
          grade,
          part,
          band,
          key: `${system}:${grade}:${part}:${band}`,
        })),
      ),
    ),
  );
  const pending = tasks.filter(
    ({ key }) => !Object.hasOwn(snapshot.tables, key) && !missing.has(key),
  );
  let nextTaskIndex = 0;
  let processed = total - pending.length;
  let fetched = 0;
  const failures = [];

  const worker = async () => {
    while (true) {
      const taskIndex = nextTaskIndex;
      nextTaskIndex += 1;
      if (taskIndex >= pending.length) return;
      const task = pending[taskIndex];

      try {
        const itemLevel = await ensureRepresentative(task);
        if (itemLevel === null) {
          missing.add(task.key);
          snapshot.missing = [...missing];
        } else if (discoveredTables.has(task.key)) {
          snapshot.tables[task.key] = discoveredTables.get(task.key);
          discoveredTables.delete(task.key);
          fetched += 1;
        } else {
          try {
            snapshot.tables[task.key] = await fetchWithRetry(
              {
                system: task.system,
                grade: task.grade,
                part: task.part,
                itemLevel,
              },
              task.key,
            );
            fetched += 1;
          } catch (error) {
            if (!(error instanceof EmptyOfficialTableError)) throw error;
            missing.add(task.key);
            snapshot.missing = [...missing];
          }
        }
        markChanged();
      } catch (error) {
        failures.push({ key: task.key, error });
        console.error(`  ${task.key} 실패: ${error.message}`);
      }

      processed += 1;
      if (processed % 100 === 0 || processed === total) {
        console.log(`  ${processed}/${total} · 실패 ${failures.length}`);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(WORKER_COUNT, pending.length) }, () => worker()),
  );
  await checkpointPromise;
  await mkdir(new URL(".", CHECKPOINT), { recursive: true });
  await writeSnapshot(CHECKPOINT, CHECKPOINT_TEMP, snapshot);

  const selectedTableCount = Object.keys(snapshot.tables).filter((key) =>
    systems.includes(key.split(":", 1)[0]),
  ).length;
  const selectedMissingCount = [...missing].filter((key) =>
    systems.includes(key.split(":", 1)[0]),
  ).length;
  if (
    failures.length > 0 ||
    selectedTableCount + selectedMissingCount !== total
  ) {
    throw new Error(
      `확률표 ${total}개 중 완료 ${selectedTableCount}개·정상 empty ${selectedMissingCount}개입니다. ` +
        `기존 완성본을 덮어쓰지 않았습니다. 다시 실행하면 중간 저장본에서 이어서 받습니다.`,
    );
  }

  const completedAt = new Date().toISOString();
  snapshot.savedAt = completedAt;
  for (const system of systems) snapshot.savedAtBySystem[system] = completedAt;
  delete snapshot.fetchSystems;
  await writeSnapshot(OUTPUT, OUTPUT_TEMP, snapshot);
  await unlink(CHECKPOINT).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  const size = JSON.stringify(snapshot).length;
  console.log(
    `저장 완료 · 조합 ${selectedTableCount}개 · 장비 없음 ${selectedMissingCount}개 · ` +
      `실패 0개 · 신규 조회 ${fetched}개 · ${(size / 1024).toFixed(0)}KB`,
  );
}

await main();
