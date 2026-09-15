import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  BATTLE_PRACTICE_EXCLUDED_CLASSES,
  BATTLE_PRACTICE_JOB_CLASSES,
} from "./battle-practice-job-classes.mjs";
import {
  characterReferenceKey,
  loadCharacterExclusions,
} from "./lib/character-exclusions.mjs";
import {
  maplescouterEfficiencyReference,
  referenceEfficiencyRow,
} from "./lib/maplescouter-efficiency.mjs";

const MAPLESCOUTER_ORIGIN = "https://maplescouter.com";
const DEFAULT_MINIMUM_INTERVAL_MS = 12_000;
const DEFAULT_MAXIMUM_INTERVAL_MS = 18_000;
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const FAILURE_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const MAPLESCOUTER_JOB_NAMES = Object.freeze({
  듀얼블레이더: "듀얼블레이드",
  캐논마스터: "캐논슈터",
});

function parseArguments(argv) {
  const options = {};
  for (const argument of argv) {
    if (!argument.startsWith("--")) continue;
    const [key, ...rest] = argument.slice(2).split("=");
    options[key] = rest.length ? rest.join("=") : true;
  }
  return options;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function boundedInterval(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 8_000 ? parsed : fallback;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/gu, "").replace(/\.\d+Z$/u, "Z");
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function randomInterval(minimum, maximum) {
  return Math.round(minimum + Math.random() * Math.max(0, maximum - minimum));
}

async function loadJsonLines(path) {
  try {
    return (await readFile(path, "utf8")).split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function loadRecentCache(rawDirectory) {
  const cache = new Map();
  let names = [];
  try {
    names = await readdir(rawDirectory);
  } catch (error) {
    if (error?.code === "ENOENT") return cache;
    throw error;
  }
  for (const name of names.filter((entry) =>
    /^maplescouter-efficiency-.*\.jsonl$/u.test(entry)
  )) {
    for (const record of await loadJsonLines(join(rawDirectory, name))) {
      const collectedAt = Date.parse(record?.collectedAt ?? "");
      const characterName = String(record?.characterName ?? "").trim();
      if (
        characterName &&
        Number.isFinite(collectedAt) &&
        Date.now() - collectedAt <= CACHE_MAX_AGE_MS &&
        record?.reference?.ok
      ) cache.set(characterName.normalize("NFC"), record);
    }
  }
  return cache;
}

async function loadRecentFailureCache(rawDirectory) {
  const cache = new Set();
  let names = [];
  try {
    names = await readdir(rawDirectory);
  } catch (error) {
    if (error?.code === "ENOENT") return cache;
    throw error;
  }
  for (const name of names.filter((entry) =>
    /^maplescouter-efficiency-.*\.summary\.json$/u.test(entry)
  )) {
    const summary = JSON.parse(await readFile(join(rawDirectory, name), "utf8"));
    const generatedAt = Date.parse(summary?.generatedAt ?? "");
    if (
      !Number.isFinite(generatedAt) ||
      Date.now() - generatedAt > FAILURE_CACHE_MAX_AGE_MS
    ) continue;
    for (const failure of summary?.failures ?? []) {
      cache.add(`${failure.characterClass}\u0001${failure.characterName}`);
    }
  }
  return cache;
}

class CdpConnection {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Set();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolvePromise, rejectPromise) => {
      this.socket.onopen = resolvePromise;
      this.socket.onerror = rejectPromise;
    });
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.listeners) listener(message);
    };
  }

  command(method, params = {}) {
    const id = ++this.nextId;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolvePromise, rejectPromise) => {
      this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
    });
  }

  close() {
    this.socket?.close();
  }
}

async function launchBrowser(executable) {
  const userDataDirectory = await mkdtemp(join(tmpdir(), "maplescouter-browser-"));
  const browser = spawn(executable, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--disable-default-apps",
    "--no-first-run",
    "--metrics-recording-only",
    "--lang=ko-KR",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDirectory}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  const debuggerUrl = await new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      rejectPromise(new Error(`Chromium 시작 시간 초과: ${stderr.slice(-500)}`));
    }, 20_000);
    browser.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/u);
      if (!match) return;
      clearTimeout(timeout);
      resolvePromise(match[1]);
    });
    browser.once("exit", (code) => {
      clearTimeout(timeout);
      rejectPromise(new Error(`Chromium이 조기 종료되었습니다 (${code}).`));
    });
  });
  const endpoint = new URL(debuggerUrl);
  const tabs = await (await fetch(
    `http://127.0.0.1:${endpoint.port}/json/list`,
  )).json();
  const page = tabs.find((entry) => entry.type === "page");
  if (!page) throw new Error("Chromium 페이지 대상을 찾지 못했습니다.");
  const connection = new CdpConnection(page.webSocketDebuggerUrl);
  await connection.connect();
  await connection.command("Page.enable");
  await connection.command("Network.enable");
  return {
    connection,
    async close() {
      connection.close();
      browser.kill("SIGTERM");
      await new Promise((resolvePromise) => {
        const timeout = setTimeout(resolvePromise, 2_000);
        browser.once("exit", () => {
          clearTimeout(timeout);
          resolvePromise();
        });
      });
      await rm(userDataDirectory, { recursive: true, force: true });
    },
  };
}

async function evaluate(connection, expression) {
  const response = await connection.command("Runtime.evaluate", {
    expression,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text ?? "브라우저 평가 실패");
  }
  return response.result?.value;
}

async function waitFor(connection, expression, timeoutMilliseconds = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMilliseconds) {
    if (await evaluate(connection, expression)) return;
    await sleep(250);
  }
  throw new Error(`페이지 렌더링 시간 초과: ${expression}`);
}

async function navigate(connection, url) {
  let documentStatus = null;
  const listener = (message) => {
    const response = message?.params?.response;
    if (
      message.method === "Network.responseReceived" &&
      message.params?.type === "Document" &&
      response?.url === url
    ) documentStatus = Number(response.status);
  };
  connection.listeners.add(listener);
  try {
    await connection.command("Page.navigate", { url });
    await waitFor(
      connection,
      `location.href === ${JSON.stringify(url)}`,
    );
    await waitFor(connection, "document.readyState === 'complete'");
    if (documentStatus === 403 || documentStatus === 429) {
      const error = new Error(`MapleScouter 접근 중단 (${documentStatus})`);
      error.fatal = true;
      throw error;
    }
    const blocked = await evaluate(connection, `(() => {
      const text = (document.title + ' ' + document.body.innerText).toLowerCase();
      return /captcha|recaptcha|too many requests|access denied|접근이 제한/u.test(text);
    })()`);
    if (blocked) {
      const error = new Error("MapleScouter 차단 또는 CAPTCHA 감지");
      error.fatal = true;
      throw error;
    }
  } finally {
    connection.listeners.delete(listener);
  }
}

async function rankedCharacters(connection, characterClass) {
  const rankingClass = MAPLESCOUTER_JOB_NAMES[characterClass] ?? characterClass;
  const url = new URL("/ko/total-ranking", MAPLESCOUTER_ORIGIN);
  url.searchParams.set("worldType", "전체");
  url.searchParams.set("job", rankingClass);
  await navigate(connection, url.toString());
  try {
    await waitFor(
      connection,
      "document.querySelectorAll('table tbody tr').length > 0",
      45_000,
    );
  } catch (error) {
    const diagnosis = await evaluate(connection, `(() => ({
      title: document.title,
      rowCount: document.querySelectorAll('table tbody tr').length,
      infoLinkCount: document.querySelectorAll('a[href*="/info?name="]').length,
      body: document.body.innerText.replace(/\\s+/gu, ' ').slice(0, 600),
    }))()`);
    error.message += ` · 화면 상태 ${JSON.stringify(diagnosis)}`;
    throw error;
  }
  return evaluate(connection, `(() => {
    const expectedClasses = new Set([
      ${JSON.stringify(characterClass)},
      ${JSON.stringify(rankingClass)},
    ]);
    return [...document.querySelectorAll('table tbody tr')].flatMap((row) => {
      const cells = [...row.querySelectorAll('td')].map((cell) => cell.innerText.trim());
      const link = row.querySelector('a[href*="/info?name="]');
      if (!link || !cells.some((cell) => expectedClasses.has(cell))) return [];
      const href = new URL(link.href);
      const name = href.searchParams.get('name')?.trim();
      const rank = Number(cells.find((value) => /^\\d+$/u.test(value)));
      return name ? [{ name, rank: Number.isFinite(rank) ? rank : null }] : [];
    });
  })()`);
}

async function clickDetailTab(connection) {
  await waitFor(connection, `[...document.querySelectorAll('[role="tab"]')]
    .some((element) => element.textContent.trim() === '세부 스펙 효율')`);
  // 서버 렌더링 DOM이 먼저 나타나므로 React가 탭 이벤트를 연결할 때까지
  // 같은 문서 안에서 기다린다. 새로고침이나 추가 페이지 요청은 하지 않는다.
  await waitFor(connection, `(() => {
    const element = [...document.querySelectorAll('[role="tab"]')]
      .find((candidate) => candidate.textContent.trim() === '세부 스펙 효율');
    return element && Object.keys(element)
      .some((key) => key.startsWith('__reactProps$'));
  })()`);
  await evaluate(connection, `(() => {
    const element = [...document.querySelectorAll('[role="tab"]')]
      .find((candidate) => candidate.textContent.trim() === '세부 스펙 효율');
    element.scrollIntoView({ block: 'center' });
    element.click();
    return true;
  })()`);
  await sleep(500);
  const activatedByDom = await evaluate(connection,
    `[...document.querySelectorAll('[role="tab"]')]
      .some((element) => element.textContent.trim() === '세부 스펙 효율' &&
        element.dataset.state === 'active')`,
  );
  if (activatedByDom) return;

  await evaluate(connection, `(() => {
    const element = [...document.querySelectorAll('[role="tab"]')]
      .find((candidate) => candidate.textContent.trim() === '주요 스펙 효율');
    element.focus();
    return document.activeElement === element;
  })()`);
  await connection.command("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "ArrowRight",
    code: "ArrowRight",
    windowsVirtualKeyCode: 39,
    nativeVirtualKeyCode: 39,
  });
  await connection.command("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "ArrowRight",
    code: "ArrowRight",
    windowsVirtualKeyCode: 39,
    nativeVirtualKeyCode: 39,
  });
  await sleep(300);
  const activatedByKeyboard = await evaluate(connection,
    `[...document.querySelectorAll('[role="tab"]')]
      .some((element) => element.textContent.trim() === '세부 스펙 효율' &&
        element.dataset.state === 'active')`,
  );
  if (activatedByKeyboard) return;

  const position = await evaluate(connection, `(() => {
    const element = [...document.querySelectorAll('[role="tab"]')]
      .find((candidate) => candidate.textContent.trim() === '세부 스펙 효율');
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  await connection.command("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: position.x,
    y: position.y,
  });
  await connection.command("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: position.x,
    y: position.y,
    button: "left",
    clickCount: 1,
  });
  await connection.command("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: position.x,
    y: position.y,
    button: "left",
    clickCount: 1,
  });
  try {
    await waitFor(connection, `[...document.querySelectorAll('[role="tab"]')]
      .some((element) => element.textContent.trim() === '세부 스펙 효율' &&
        element.dataset.state === 'active')`, 5_000);
  } catch (error) {
    error.fatal = true;
    throw error;
  }
}

async function efficiencyRows(connection) {
  return evaluate(connection, `(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')]
      .find((element) => element.textContent.trim() === '세부 스펙 효율');
    const panel = document.getElementById(tab.getAttribute('aria-controls'));
    return [...panel.querySelectorAll('tr')].flatMap((row) => {
      const cells = [...row.querySelectorAll('th,td')];
      const label = cells[0]?.innerText.trim();
      const input = row.querySelector('input');
      const percentages = cells.map((cell) => cell.innerText.trim())
        .filter((text) => /^-?[\\d,.]+%$/u.test(text));
      const finalDamagePercent = percentages.at(-1);
      return label && input && finalDamagePercent
        ? [{ label, amount: input.value, finalDamagePercent }]
        : [];
    });
  })()`);
}

async function collectCharacter(connection, characterClass, characterName, rank) {
  const url = new URL("/ko/result", MAPLESCOUTER_ORIGIN);
  url.searchParams.set("name", characterName);
  await navigate(connection, url.toString());
  await clickDetailTab(connection);
  const rows = await efficiencyRows(connection);
  const reference = maplescouterEfficiencyReference(characterClass, rows);
  if (!reference.ok) throw new Error(`세부 효율 해석 실패: ${reference.reason}`);
  return {
    characterName,
    characterClass,
    rank,
    collectedAt: new Date().toISOString(),
    sourceUrl: url.toString(),
    reference,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const classInput = String(options.classes ?? "");
  // 일부 공식 직업명 자체에 쉼표가 있으므로 여러 직업은 | 또는 ;로 구분한다.
  const classSeparator = classInput.includes("|")
    ? "|"
    : classInput.includes(";")
      ? ";"
      : ",";
  const selected = classInput.split(classSeparator)
    .map((value) => value.trim()).filter(Boolean);
  if (!selected.length) {
    throw new Error("과도한 순회를 막기 위해 --classes=직업명 입력이 필요합니다.");
  }
  const knownClasses = new Set(BATTLE_PRACTICE_JOB_CLASSES.map(
    ({ characterClass }) => characterClass,
  ));
  const unknown = selected.filter((characterClass) => !knownClasses.has(characterClass));
  if (unknown.length) throw new Error(`알 수 없는 직업: ${unknown.join(", ")}`);
  const unsupported = selected.filter((characterClass) =>
    BATTLE_PRACTICE_EXCLUDED_CLASSES.includes(characterClass)
  );
  if (unsupported.length) {
    throw new Error(`현재 검증 대상에서 제외한 직업: ${unsupported.join(", ")}`);
  }
  const samples = Math.min(positiveInteger(options.samples, 5), 5);
  const rankStart = positiveInteger(options["rank-start"], 1);
  const candidateLimit = Math.min(
    positiveInteger(options["candidate-limit"], samples + 10),
    20,
  );
  const minimumInterval = boundedInterval(
    options["interval-min-ms"],
    DEFAULT_MINIMUM_INTERVAL_MS,
  );
  const maximumInterval = Math.max(
    minimumInterval,
    boundedInterval(options["interval-max-ms"], DEFAULT_MAXIMUM_INTERVAL_MS),
  );
  const rawDirectory = resolve("tools/battle-practice-dataset/raw");
  const outputPath = resolve(String(options.output ??
    join(rawDirectory, `maplescouter-efficiency-${timestamp()}.jsonl`)));
  const referencePath = resolve(String(options["reference-output"] ??
    `tools/battle-practice-dataset/generated/maplescouter-references-${timestamp()}.json`));
  const cache = await loadRecentCache(rawDirectory);
  const failureCache = await loadRecentFailureCache(rawDirectory);
  const excludedCharacters = await loadCharacterExclusions(
    String(options["exclude-input"] ?? "")
      .split(",")
      .map((path) => path.trim())
      .filter(Boolean),
  );
  const records = [];
  const failures = [];
  let lastNavigationAt = 0;
  const waitBeforeNavigation = async () => {
    if (!lastNavigationAt) return;
    const target = randomInterval(minimumInterval, maximumInterval);
    const remaining = target - (Date.now() - lastNavigationAt);
    if (remaining > 0) await sleep(remaining);
  };
  const browser = await launchBrowser(String(options.chromium ?? "chromium"));
  let fatalError = null;
  try {
    for (const characterClass of selected) {
      await waitBeforeNavigation();
      lastNavigationAt = Date.now();
      const candidates = await rankedCharacters(browser.connection, characterClass);
      process.stdout.write(`[${characterClass}] 랭킹 후보 ${candidates.length}명 확인\n`);
      const rankedCandidates = candidates
        .filter((candidate) => candidate.rank === null || candidate.rank >= rankStart)
        .slice(0, candidateLimit);
      for (const candidate of rankedCandidates) {
        if (records.filter((row) => row.characterClass === characterClass).length >= samples) {
          break;
        }
        if (excludedCharacters.has(
          characterReferenceKey(characterClass, candidate.name),
        )) {
          process.stdout.write(
            `[${characterClass}] ${candidate.name} · 기존 표본 건너뜀\n`,
          );
          continue;
        }
        const cached = cache.get(candidate.name.normalize("NFC"));
        if (cached?.characterClass === characterClass) {
          records.push({ ...cached, cacheHit: true });
          process.stdout.write(`[${characterClass}] ${candidate.name} · 캐시 사용\n`);
          continue;
        }
        if (failureCache.has(`${characterClass}\u0001${candidate.name}`)) {
          process.stdout.write(
            `[${characterClass}] ${candidate.name} · 최근 실패 건너뜀\n`,
          );
          continue;
        }
        await waitBeforeNavigation();
        lastNavigationAt = Date.now();
        try {
          const record = await collectCharacter(
            browser.connection,
            characterClass,
            candidate.name,
            candidate.rank,
          );
          records.push(record);
          process.stdout.write(
            `[${characterClass}] ${candidate.name} · 방무380 ${
              record.reference.ignoreDefense380.mainStatPercent.toFixed(2)
            }%급\n`,
          );
        } catch (error) {
          failures.push({
            characterClass,
            characterName: candidate.name,
            message: error instanceof Error ? error.message : String(error),
          });
          process.stdout.write(
            `[${characterClass}] ${candidate.name} · 수집 실패\n`,
          );
          if (error?.fatal) throw error;
        }
      }
    }
  } catch (error) {
    fatalError = error;
  } finally {
    await browser.close();
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    records.length
      ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n`
      : "",
    { encoding: "utf8", flag: options.overwrite ? "w" : "wx" },
  );
  const references = records.map(referenceEfficiencyRow).filter(Boolean);
  await mkdir(dirname(referencePath), { recursive: true });
  await writeFile(referencePath, `${JSON.stringify(references, null, 2)}\n`, {
    encoding: "utf8",
    flag: options.overwrite ? "w" : "wx",
  });
  await writeFile(`${outputPath}.summary.json`, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    classes: selected,
    samples,
    rankStart,
    candidateLimit,
    minimumInterval,
    maximumInterval,
    recordCount: records.length,
    cacheHits: records.filter(({ cacheHit }) => cacheHit).length,
    excludedCharacterCount: excludedCharacters.size,
    failures,
    outputPath,
    referencePath,
  }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`원본 효율: ${outputPath}\n검증 기준: ${referencePath}\n`);
  if (fatalError) throw fatalError;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
