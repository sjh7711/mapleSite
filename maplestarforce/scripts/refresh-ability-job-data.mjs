import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = resolve(ROOT, "src/data/ability-job-usage.js");
const PRESET_OUTPUT = resolve(ROOT, "src/data/ability-job-presets.js");
const BASE_URL = "https://chuchu.gg";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36";

async function fetchHtml(url, attempts = 5) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": USER_AGENT,
        },
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 500));
      }
    }
  }
  throw new Error(`${url}: ${lastError?.message ?? "요청 실패"}`);
}

function decodeNextStream(html) {
  const chunks = [];
  const pattern = /<script>self\.__next_f\.push\((\[.*?\])\)<\/script>/gs;
  for (const match of html.matchAll(pattern)) {
    try {
      const value = JSON.parse(match[1]);
      if (typeof value?.[1] === "string") chunks.push(value[1]);
    } catch {
      // 광고 스크립트처럼 RSC 데이터가 아닌 조각은 건너뛴다.
    }
  }
  return chunks.join("");
}

function jsonValueAfter(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  let start = markerIndex + marker.length;
  while (/\s/u.test(source[start] ?? "")) start += 1;
  const opening = source[start];
  const closing = opening === "{" ? "}" : opening === "[" ? "]" : "";
  if (!closing) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === opening) depth += 1;
    else if (character === closing) {
      depth -= 1;
      if (depth === 0) return JSON.parse(source.slice(start, index + 1));
    }
  }
  return null;
}

function abilityType(label) {
  const value = String(label ?? "").replace(/\s+/g, " ").trim();
  const exact = {
    "STR 증가": "str",
    "DEX 증가": "dex",
    "INT 증가": "int",
    "LUK 증가": "luk",
    "공격력 증가": "attack",
    "마력 증가": "magic",
    "크리티컬 확률 증가": "critical",
    "모든 능력치 증가": "all-stat",
    "보스 몬스터 공격 시 데미지 증가": "boss-damage",
    "일반 몬스터 공격 시 데미지 증가": "normal-damage",
    "상태 이상에 걸린 대상 공격 시 데미지 증가": "abnormal-damage",
    "버프 스킬 지속 시간 증가": "buff-duration",
    "아이템 드롭률 증가": "item-drop",
    "메소 획득량 증가": "meso-drop",
    "스킬 사용 시 확률로 재사용 대기시간이 미적용": "cooldown-skip",
    "방어력 %만큼 데미지 고정값 증가": "defense-damage",
    "점프력 증가": "jump",
    "이동속도 증가": "move-speed",
    "방어력 % 증가": "defense-percent",
    "방어력 증가": "defense-flat",
  };
  if (exact[value]) return exact[value];
  if (value.startsWith("최대 HP")) {
    return value.includes("%") ? "max-hp-percent" : "max-hp";
  }
  if (value.startsWith("최대 MP")) {
    return value.includes("%") ? "max-mp-percent" : "max-mp";
  }
  if (value.includes("공격 속도") && value.includes("증가")) return "attack-speed";
  if (value.includes("패시브 스킬 레벨") && value.includes("증가")) return "passive-level";
  if (value.includes("다수 공격 스킬") && value.includes("대상") && value.includes("증가")) {
    return "multi-target";
  }
  const pair = value.match(/^(STR|DEX|INT|LUK) 증가, (STR|DEX|INT|LUK) 증가$/u);
  if (pair) return `${pair[1].toLowerCase()}-${pair[2].toLowerCase()}`;
  const transfer = value.match(/AP를 직접 투자한 (STR|DEX|INT|LUK) 만큼 (STR|DEX|INT|LUK) 증가/u);
  if (transfer) return `ap-${transfer[1].toLowerCase()}-to-${transfer[2].toLowerCase()}`;
  return null;
}

function ranked(entries, samples) {
  const totals = new Map();
  for (const entry of entries ?? []) {
    const type = abilityType(entry.ability_value);
    if (!type) continue;
    totals.set(type, (totals.get(type) ?? 0) + Number(entry.counts ?? 0));
  }
  return [...totals.entries()]
    .map(([type, count]) => ({
      type,
      count,
      rate: samples > 0 ? Number((count / samples * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

function uniquePreset(main, sub) {
  const types = [];
  for (const entry of [...main.slice(0, 1), ...sub]) {
    if (!types.includes(entry.type)) types.push(entry.type);
    if (types.length === 3) break;
  }
  return types;
}

function normalizeCachedJob(job) {
  const samples = Number(job.samples) || 1_000;
  const normalizeEntries = (entries) => (entries ?? []).map((entry) => ({
    type: entry.type,
    count: Number(entry.count) || 0,
    rate: Number(((Number(entry.count) || 0) / samples * 100).toFixed(1)),
  }));
  const rankings = {
    boss: {
      main: normalizeEntries(job.rankings?.boss?.main),
      sub: normalizeEntries(job.rankings?.boss?.sub),
    },
    hunt: {
      main: normalizeEntries(job.rankings?.hunt?.main),
      sub: normalizeEntries(job.rankings?.hunt?.sub),
    },
  };
  return {
    ...job,
    samples,
    presets: {
      boss: uniquePreset(rankings.boss.main, rankings.boss.sub),
      hunt: uniquePreset(rankings.hunt.main, rankings.hunt.sub),
    },
    rankings,
  };
}

function extractJobUsage(name, html) {
  const stream = decodeNextStream(html);
  const abilityData = jsonValueAfter(stream, '"abilityData":');
  const value = Array.isArray(abilityData) ? abilityData[0] : abilityData;
  if (!value?.boss || !value?.hunt) {
    throw new Error(`${name}: abilityData를 찾지 못했습니다.`);
  }
  // 직업 분석 화면은 각 용도별 상위 1,000명을 기준으로 counts를 제공한다.
  // 현재 RSC payload에는 samples가 생략되는 경우가 있어 화면 기준값을 fallback으로 둔다.
  const samples = Number(value.samples ?? 1_000);
  const bossMain = ranked(value.boss.main, samples);
  const bossSub = ranked(value.boss.sub, samples);
  const huntMain = ranked(value.hunt.main, samples);
  const huntSub = ranked(value.hunt.sub, samples);
  return {
    id: name,
    name,
    samples,
    presets: {
      boss: uniquePreset(bossMain, bossSub),
      hunt: uniquePreset(huntMain, huntSub),
    },
    rankings: {
      boss: { main: bossMain, sub: bossSub },
      hunt: { main: huntMain, sub: huntSub },
    },
  };
}

async function mapConcurrent(values, limit, mapper) {
  const output = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return output;
}

function globalRanking(jobs, section, modes = ["boss", "hunt"]) {
  const totals = new Map();
  for (const job of jobs) {
    for (const mode of modes) {
      for (const entry of job.rankings[mode][section]) {
        totals.set(entry.type, (totals.get(entry.type) ?? 0) + entry.count);
      }
    }
  }
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type]) => type);
}

function encodeJobName(name) {
  return encodeURIComponent(name)
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

async function main() {
  let cachedJobs = [];
  try {
    const cached = await import(`${pathToFileURL(OUTPUT).href}?cache=${Date.now()}`);
    cachedJobs = Array.isArray(cached.ABILITY_JOB_USAGE)
      ? cached.ABILITY_JOB_USAGE.map(normalizeCachedJob)
      : [];
  } catch {
    // 최초 생성은 기존 파일 없이 진행한다.
  }
  const cachedByName = new Map(cachedJobs.map((job) => [job.name, job]));
  const fallbackJobs = [];
  const indexHtml = await fetchHtml(`${BASE_URL}/jobs`);
  const jobs = [...indexHtml.matchAll(/href="\/jobs\/([^"?#]+)"/gu)]
    .map((match) => decodeURIComponent(match[1]))
    .filter(Boolean)
    .filter((name, index, values) => values.indexOf(name) === index)
    .sort((a, b) => a.localeCompare(b, "ko-KR"));
  if (jobs.length < 40) {
    throw new Error(`직업 목록이 ${jobs.length}개뿐이라 갱신을 중단합니다.`);
  }
  const usage = await mapConcurrent(jobs, 2, async (name) => {
    try {
      const html = await fetchHtml(`${BASE_URL}/jobs/${encodeJobName(name)}`);
      const job = extractJobUsage(name, html);
      process.stdout.write(`수집 ${name}\n`);
      return job;
    } catch (error) {
      const cached = cachedByName.get(name);
      if (!cached) throw error;
      fallbackJobs.push(name);
      process.stdout.write(`기존 자료 유지 ${name}\n`);
      return cached;
    }
  });
  const payload = {
    source: `${BASE_URL}/jobs`,
    retrievedAt: new Date().toISOString(),
    jobCount: usage.length,
    fallbackJobCount: fallbackJobs.length,
  };
  const global = {
    all: {
      main: globalRanking(usage, "main"),
      sub: globalRanking(usage, "sub"),
    },
    boss: {
      main: globalRanking(usage, "main", ["boss"]),
      sub: globalRanking(usage, "sub", ["boss"]),
    },
    hunt: {
      main: globalRanking(usage, "main", ["hunt"]),
      sub: globalRanking(usage, "sub", ["hunt"]),
    },
  };
  const compactUsage = usage.map((job) => ({
    ...job,
    rankings: {
      boss: {
        main: job.rankings.boss.main.slice(0, 8),
        sub: job.rankings.boss.sub.slice(0, 12),
      },
      hunt: {
        main: job.rankings.hunt.main.slice(0, 8),
        sub: job.rankings.hunt.sub.slice(0, 12),
      },
    },
  }));
  const source = `// 이 파일은 scripts/refresh-ability-job-data.mjs가 생성합니다.\n` +
    `export const ABILITY_JOB_USAGE_SOURCE = Object.freeze(${JSON.stringify(payload, null, 2)});\n\n` +
    `export const ABILITY_GLOBAL_POPULAR = Object.freeze(${JSON.stringify(global, null, 2)});\n\n` +
    `export const ABILITY_JOB_USAGE = Object.freeze(${JSON.stringify(compactUsage, null, 2)});\n`;
  await mkdir(dirname(OUTPUT), { recursive: true });
  const presetSource = `// 이 파일은 scripts/refresh-ability-job-data.mjs가 생성합니다.\n` +
    `export const ABILITY_JOB_PRESETS = Object.freeze(${JSON.stringify(
      usage.map(({ id, name, presets }) => ({ id, name, presets })),
      null,
      2,
    )});\n`;
  await Promise.all([
    writeFile(OUTPUT, source, "utf8"),
    writeFile(PRESET_OUTPUT, presetSource, "utf8"),
  ]);
  process.stdout.write(`완료 ${usage.length}개 직업 → ${OUTPUT}\n`);
}

await main();
