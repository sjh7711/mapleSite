import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";
import { BATTLE_PRACTICE_EXCLUDED_CLASSES } from "./battle-practice-job-classes.mjs";

const ENDPOINT = "https://preview.starforce.pages.dev/api/character-conversion";

function parseArguments(argv) {
  const options = { positional: [] };
  for (const argument of argv) {
    if (!argument.startsWith("--")) {
      options.positional.push(argument);
      continue;
    }
    const [key, ...rest] = argument.slice(2).split("=");
    options[key] = rest.length ? rest.join("=") : true;
  }
  return options;
}

function separatedValues(value) {
  const input = String(value ?? "");
  const separator = input.includes("|") ? "|" : input.includes(";") ? ";" : ",";
  return input.split(separator).map((item) => item.trim()).filter(Boolean);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function relativeError(actual, reference) {
  return Number.isFinite(actual) && reference > 0
    ? (actual / reference - 1) * 100
    : null;
}

function unchanneledIgnoreDefenseEquivalent({
  currentIgnoreDefense,
  oneMainPercentRelative,
  targetDefenseRemaining,
  enemyDefense,
}) {
  if (
    !(currentIgnoreDefense >= 0 && currentIgnoreDefense <= 1) ||
    !(oneMainPercentRelative > 0) ||
    !(targetDefenseRemaining > 0)
  ) return null;
  const defense = enemyDefense * targetDefenseRemaining;
  const before = 1 - defense * (1 - currentIgnoreDefense);
  const afterIgnoreDefense = 1 - (1 - currentIgnoreDefense) * 0.6;
  const after = 1 - defense * (1 - afterIgnoreDefense);
  return before > 0 ? (after / before - 1) / oneMainPercentRelative : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function fetchJsonWithRetry(url, init, retries = 3, fetchImpl = fetch) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(url, init);
      const text = await response.text();
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !contentType.includes("application/json")) {
        throw new Error(
          `HTTP ${response.status} · ${contentType || "content-type 없음"}`,
        );
      }
      const payload = JSON.parse(text);
      if (payload?.ok !== true) {
        throw new Error(
          String(payload?.error?.message ?? payload?.error ?? "API 계산 실패"),
        );
      }
      if (!payload?.profiles?.fullBoss?.statEquivalence) {
        throw new Error("API 응답에 풀보스 환산 결과가 없습니다.");
      }
      return { response, payload };
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(attempt * 5_000);
    }
  }
  throw lastError;
}

function envValue(text, name) {
  const line = text.split(/\r?\n/u).find((candidate) =>
    candidate.trimStart().startsWith(`${name}=`)
  );
  if (!line) return "";
  const value = line.slice(line.indexOf("=") + 1).trim();
  return value.replace(/^(['"])(.*)\1$/u, "$2");
}

async function createLocalConversionFetch(envPath, profileOverridePath = null) {
  const apiKey = envValue(await readFile(envPath, "utf8"), "NEXON_API_KEY");
  if (!apiKey) throw new Error(`${envPath}에 NEXON_API_KEY가 없습니다.`);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "maple-validation-"));
  const outfile = join(temporaryDirectory, "character-conversion.mjs");
  await build({
    entryPoints: [resolve("functions/api/character-conversion.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
    plugins: profileOverridePath ? [{
      name: "battle-practice-profile-override",
      setup(buildContext) {
        buildContext.onResolve(
          { filter: /class-damage-profiles\.js$/ },
          () => ({ path: profileOverridePath }),
        );
      },
    }] : [],
  });
  const { handleCharacterConversion } = await import(
    `${pathToFileURL(outfile).href}?t=${Date.now()}`
  );
  return {
    fetchImpl: async (url, init = {}) => handleCharacterConversion({
      request: new Request(url, init),
      env: { NEXON_API_KEY: apiKey },
      waitUntil() {},
    }, { cache: null }),
    close: () => rm(temporaryDirectory, { recursive: true, force: true }),
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const inputPath = resolve(
    options.input ?? options.positional[0] ??
      "tools/battle-practice-dataset/reference-efficiency.json",
  );
  const outputPath = resolve(
    options.output ?? options.positional[1] ??
      "tools/battle-practice-dataset/generated/validation-report.json",
  );
  const selectedClasses = new Set(separatedValues(options.classes));
  const presetMode = String(options["preset-mode"] ?? "auto").trim();
  const endpoint = String(options.endpoint ?? ENDPOINT).trim();
  const profileOverridePath = options.profiles
    ? resolve(String(options.profiles))
    : null;
  if (profileOverridePath && !options.local) {
    throw new Error("--profiles는 --local 검증에서만 사용할 수 있습니다.");
  }
  const profileOverrideHash = profileOverridePath
    ? sha256(await readFile(profileOverridePath, "utf8"))
    : null;
  const localConversion = options.local
    ? await createLocalConversionFetch(resolve(
      String(options["env-file"] ?? "/home/ubuntu/maple/.env"),
    ), profileOverridePath)
    : null;
  const intervalMilliseconds = Math.max(
    0,
    Number(options["interval-ms"] ?? 1_000) || 0,
  );
  const requestedConcurrency = Math.max(
    1,
    Math.floor(Number(options.concurrency ?? 1) || 1),
  );
  // 캐릭터 하나가 최대 30개의 NEXON endpoint를 조회한다. 서로 다른
  // 캐릭터 검증을 겹치면 각 요청 내부의 pacing만으로는 계정 전체의
  // 초당 호출 제한을 지킬 수 없으므로 검증기는 항상 순차 실행한다.
  const concurrency = 1;
  if (requestedConcurrency > 1) {
    process.stderr.write(
      "NEXON API 호출 제한 보호를 위해 --concurrency를 1로 제한합니다.\n",
    );
  }
  if (!new Set(["active", "auto"]).has(presetMode)) {
    throw new Error("--preset-mode는 active 또는 auto여야 합니다.");
  }
  const referenceInput = JSON.parse(await readFile(inputPath, "utf8"));
  const references = referenceInput.filter((reference) =>
    !BATTLE_PRACTICE_EXCLUDED_CLASSES.includes(reference.characterClass) &&
    (!selectedClasses.size || selectedClasses.has(reference.characterClass))
  );
  const referenceHash = sha256(JSON.stringify(references));
  const runFingerprint = sha256(JSON.stringify({
    endpoint,
    presetMode,
    refresh: Boolean(options.refresh),
    referenceHash,
    profileOverrideHash,
  }));
  const partialOutputPath = `${outputPath}.partial.json`;
  const rows = new Array(references.length);
  if (options.resume) {
    try {
      const partial = JSON.parse(await readFile(partialOutputPath, "utf8"));
      if (partial.runFingerprint !== runFingerprint) {
        throw new Error(
          "부분 검증 파일이 현재 endpoint, 프리셋 또는 기준표와 일치하지 않습니다.",
        );
      }
      const successfulRows = new Map(
        (partial.rows ?? [])
          .filter((row) => row?.ok === true)
          .map((row) => [
            `${row.characterClass}\u0000${row.characterName}`,
            row,
          ]),
      );
      for (const [referenceIndex, reference] of references.entries()) {
        rows[referenceIndex] = successfulRows.get(
          `${reference.characterClass}\u0000${reference.characterName}`,
        );
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  let completedCount = rows.filter(Boolean).length;
  let nextReferenceIndex = 0;
  let checkpointQueue = Promise.resolve();
  const saveCheckpoint = () => {
    const completedRows = rows.filter(Boolean);
    checkpointQueue = checkpointQueue.then(async () => {
      await mkdir(dirname(partialOutputPath), { recursive: true });
      await writeFile(partialOutputPath, `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        endpoint,
        presetMode,
        referenceHash,
        profileOverrideHash,
        runFingerprint,
        referenceCount: references.length,
        completedCount: completedRows.length,
        rows: completedRows,
      }, null, 2)}\n`, "utf8");
    });
    return checkpointQueue;
  };
  const validateReference = async (reference, referenceIndex) => {
    const url = new URL(endpoint);
    url.searchParams.set("characterName", reference.characterName);
    // 계산식 배포 때 캐시 버전을 올리므로 기본 검증은 같은 결과를 재사용한다.
    // API 원본을 반드시 다시 받을 때만 --refresh를 명시한다.
    if (options.refresh) url.searchParams.set("refresh", "1");
    url.searchParams.set("presetMode", presetMode);
    try {
      const { response, payload } = await fetchJsonWithRetry(url, {
        headers: { Origin: url.origin },
      }, 3, localConversion?.fetchImpl ?? fetch);
      const profile = payload?.profiles?.fullBoss;
      const actual300 = Number(
        profile?.details?.ignoreDefenseCalibration?.against300
          ?.profiledToMainPercent,
      );
      const actual380 = Number(
        profile?.details?.ignoreDefenseCalibration?.against380
          ?.profiledToMainPercent,
      );
      if (
        (!(actual300 > 0) || !(actual380 > 0)) &&
        !options["allow-missing-ied"]
      ) {
        throw new Error(
          "API 응답에 보정 전 연무장 프로필 방무 환산값이 없습니다.",
        );
      }
      const served300 = Number(
        profile?.statEquivalence?.ied40Against300ToMainPercent,
      );
      const served380 = Number(
        profile?.statEquivalence?.ied40Against380ToMainPercent,
      );
      const actuals = {
        bossDamage:
          Number(profile?.statEquivalence?.bossDamageToMainPercent) *
          Number(reference.amounts?.bossDamage),
        flatAttack:
          Number(profile?.statEquivalence?.attackToMainStat) *
          Number(profile?.statEquivalence?.flatMainStatToPercent) *
          Number(reference.amounts?.flatAttack),
        attackPercent:
          Number(profile?.statEquivalence?.attackPercentToMainPercent) *
          Number(reference.amounts?.attackPercent),
        criticalDamage:
          Number(profile?.statEquivalence?.criticalDamageToMainPercent) *
          Number(reference.amounts?.criticalDamage),
        allStatPercent:
          Number(profile?.statEquivalence?.allStatPercentToMainPercent) *
          Number(reference.amounts?.allStatPercent),
      };
      const metricErrors = Object.fromEntries(
        Object.entries(actuals).map(([metric, actual]) => [
          metric,
          relativeError(actual, Number(reference[metric])),
        ]),
      );
      const currentIgnoreDefense = Number(
        profile?.statEquivalence?.currentIgnoreDefense,
      );
      const oneMainPercentRelative = Number(
        profile?.statEquivalence?.oneMainPercentRelative,
      );
      const targetDefenseRemaining = Number(
        profile?.statEquivalence?.targetDefenseRemaining,
      );
      const damageChannels = Array.isArray(
        profile?.details?.combatModel?.damageChannels,
      )
        ? profile.details.combatModel.damageChannels
        : [];
      const unprofiled300 = unchanneledIgnoreDefenseEquivalent({
        currentIgnoreDefense,
        oneMainPercentRelative,
        targetDefenseRemaining,
        enemyDefense: 3,
      });
      const unprofiled380 = unchanneledIgnoreDefenseEquivalent({
        currentIgnoreDefense,
        oneMainPercentRelative,
        targetDefenseRemaining,
        enemyDefense: 3.8,
      });
      rows[referenceIndex] = {
        ...reference,
        apiClass: payload?.character?.className ?? null,
        conversionVersion:
          response.headers.get("X-Conversion-Version") ?? null,
        profileId: profile?.details?.classDamageProfile ?? null,
        skillProfileHash:
          profile?.details?.classDamageSkillProfileHash ?? null,
        profileHash: profile?.details?.classDamageProfileHash ?? null,
        profileConfidence: Number.isFinite(
          Number(profile?.details?.classDamageProfileConfidence),
        )
          ? Number(profile.details.classDamageProfileConfidence)
          : null,
        combatDiagnostics: {
          currentIgnoreDefense,
          targetDefenseRemaining,
          weightedChannelShare: damageChannels.reduce(
            (sum, channel) => sum + (
              Number.isFinite(Number(channel?.weight))
                ? Number(channel.weight)
                : 0
            ),
            0,
          ),
          matchedLocalChannelShare: damageChannels.reduce(
            (sum, channel) => sum + (
              channel?.metadata?.matchedSource &&
                Number.isFinite(Number(channel?.weight))
                ? Number(channel.weight)
                : 0
            ),
            0,
          ),
          generalChannelShare: damageChannels.reduce(
            (sum, channel) => sum + (
              channel?.source === "직업 공통 연무장 일반 공격군" &&
                Number.isFinite(Number(channel?.weight))
                ? Number(channel.weight)
                : 0
            ),
            0,
          ),
          unmatchedLocalSkills: damageChannels
            .filter((channel) => channel?.weight === null)
            .map((channel) => String(channel?.source ?? "").trim())
            .filter(Boolean),
          ...(options["include-details"] ? {
            baseline: profile?.details?.combatModel?.baselineSources ?? [],
            effects: profile?.details?.combatModel?.effects ?? [],
            damageChannels,
          } : {}),
        },
        ...(options["include-details"]
          ? { profileDetails: profile?.details ?? null }
          : {}),
        actual300: Number.isFinite(actual300) ? actual300 : null,
        actual380: Number.isFinite(actual380) ? actual380 : null,
        served300: Number.isFinite(served300) ? served300 : null,
        served380: Number.isFinite(served380) ? served380 : null,
        actuals,
        metricErrors,
        unprofiled300,
        unprofiled380,
        error300Percent: relativeError(actual300, reference.ied300),
        error380Percent: relativeError(actual380, reference.ied380),
        unprofiledError300Percent: relativeError(
          unprofiled300,
          reference.ied300,
        ),
        unprofiledError380Percent: relativeError(
          unprofiled380,
          reference.ied380,
        ),
        ok: response.ok && payload?.ok === true,
      };
    } catch (error) {
      rows[referenceIndex] = {
        ...reference,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const latest = rows[referenceIndex];
    completedCount += 1;
    process.stdout.write(
      `[${completedCount}/${references.length}] [${reference.characterClass}] ${reference.characterName} · ${
        latest.profileId ?? "프로필 없음"
      } · 380 방무 오차 ${
        Number.isFinite(latest.error380Percent)
          ? `${latest.error380Percent.toFixed(2)}%`
          : "산출 불가"
      }\n`,
    );
    if (completedCount % 5 === 0 || completedCount === references.length) {
      await saveCheckpoint();
    }
  };
  const workers = Array.from(
    { length: Math.min(concurrency, references.length) },
    async () => {
      let workerHasRun = false;
      while (nextReferenceIndex < references.length) {
        while (
          nextReferenceIndex < references.length && rows[nextReferenceIndex]
        ) {
          nextReferenceIndex += 1;
        }
        if (nextReferenceIndex >= references.length) break;
        const referenceIndex = nextReferenceIndex;
        nextReferenceIndex += 1;
        if (workerHasRun && intervalMilliseconds > 0) {
          await sleep(intervalMilliseconds);
        }
        workerHasRun = true;
        await validateReference(references[referenceIndex], referenceIndex);
      }
    },
  );
  await Promise.all(workers);
  await checkpointQueue;
  const successfulRows = rows.filter((row) => row?.ok === true);
  const conversionVersions = new Set(
    successfulRows.map((row) => row.conversionVersion).filter(Boolean),
  );
  if (successfulRows.length && (
    conversionVersions.size !== 1 ||
    successfulRows.some((row) => !row.conversionVersion)
  )) {
    throw new Error(
      "검증 응답의 계산 버전이 없거나 서로 달라 결과를 한 보고서로 묶을 수 없습니다.",
    );
  }
  for (const characterClass of new Set(
    successfulRows.map((row) => row.apiClass ?? row.characterClass),
  )) {
    const classRows = successfulRows.filter((row) =>
      (row.apiClass ?? row.characterClass) === characterClass && row.profileId
    );
    const hashes = new Set(classRows.map((row) => row.profileHash).filter(Boolean));
    const skillHashes = new Set(
      classRows.map((row) => row.skillProfileHash).filter(Boolean),
    );
    if (classRows.length && (
      skillHashes.size !== 1 ||
      classRows.some((row) => !row.skillProfileHash)
    )) {
      throw new Error(
        `${characterClass} 검증 도중 연무장 스킬 프로필 해시가 없거나 바뀌었습니다.`,
      );
    }
    if (classRows.length && (
      hashes.size !== 1 || classRows.some((row) => !row.profileHash)
    )) {
      throw new Error(
        `${characterClass} 검증 도중 연무장 프로필 해시가 바뀌었습니다.`,
      );
    }
  }
  const measured = rows.filter((row) =>
    Number.isFinite(row.error300Percent) && Number.isFinite(row.error380Percent)
  );
  const profiled = measured.filter((row) => row.profileId);
  const summarize = (values) => ({
    count: values.length,
    meanAbsoluteErrorPercent: values.length
      ? values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length
      : null,
    medianAbsoluteErrorPercent: median(values.map(Math.abs)),
    maximumAbsoluteErrorPercent: values.length
      ? Math.max(...values.map(Math.abs))
      : null,
  });
  const metricNames = [
    "bossDamage",
    "flatAttack",
    "attackPercent",
    "criticalDamage",
    "allStatPercent",
  ];
  const byClass = Object.fromEntries(
    [...new Set(measured.map((row) => row.characterClass))]
      .sort((left, right) => left.localeCompare(right, "ko"))
      .map((characterClass) => {
        const classRows = measured.filter(
          (row) => row.characterClass === characterClass,
        );
        return [characterClass, {
          referenceCount: classRows.length,
          ied300: summarize(classRows.map((row) => row.error300Percent)),
          ied380: summarize(classRows.map((row) => row.error380Percent)),
          metrics: Object.fromEntries(metricNames.map((metric) => [
            metric,
            summarize(
              classRows.map((row) => row.metricErrors?.[metric])
                .filter(Number.isFinite),
            ),
          ])),
        }];
      }),
  );
  const report = {
    generatedAt: new Date().toISOString(),
    endpoint,
    conversionVersion: [...conversionVersions][0] ?? null,
    presetMode,
    referenceHash,
    runFingerprint,
    profileOverride: profileOverridePath ? {
      path: profileOverridePath,
      hash: profileOverrideHash,
    } : null,
    excludedClasses: BATTLE_PRACTICE_EXCLUDED_CLASSES,
    referenceCount: references.length,
    measuredCount: measured.length,
    profiledCount: profiled.length,
    profiled300: summarize(profiled.map((row) => row.error300Percent)),
    profiled380: summarize(profiled.map((row) => row.error380Percent)),
    metrics: Object.fromEntries(
      metricNames.map((metric) => {
        const errors = measured
          .map((row) => row.metricErrors?.[metric])
          .filter(Number.isFinite);
        return [metric, summarize(errors)];
      }),
    ),
    byClass,
    rows,
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await localConversion?.close();
  process.stdout.write(`검증 보고서: ${outputPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
