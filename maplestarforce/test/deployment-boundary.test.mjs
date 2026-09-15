import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CORE_ROOT = resolve(PROJECT_ROOT, "../maple-core");

async function filesUnder(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

function isWithin(path, root) {
  const pathFromRoot = relative(root, path);
  return pathFromRoot === "" || (
    pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`)
  );
}

function literalModuleSpecifiers(source) {
  const patterns = [
    /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/gu,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu,
  ];
  return patterns.flatMap((pattern) =>
    [...source.matchAll(pattern)].map((match) => match[1])
  );
}

test("런타임 소스와 HTML 진입점은 연구·수집 디렉터리를 import하지 않는다", async () => {
  const runtimeFiles = [
    ...await filesUnder(resolve(PROJECT_ROOT, "src")),
    ...await filesUnder(resolve(PROJECT_ROOT, "functions")),
  ].filter((path) => /\.(?:[cm]?[jt]s|html)$/u.test(path));
  const rootEntries = await readdir(PROJECT_ROOT, { withFileTypes: true });
  const htmlEntries = [resolve(PROJECT_ROOT, "index.html")];
  for (const entry of rootEntries) {
    if (!entry.isDirectory() || ["dist", "node_modules", "tools"].includes(entry.name)) {
      continue;
    }
    const candidate = resolve(PROJECT_ROOT, entry.name, "index.html");
    try {
      if ((await stat(candidate)).isFile()) htmlEntries.push(candidate);
    } catch {
      // HTML 진입점이 없는 소스 디렉터리다.
    }
  }
  const offenders = [];

  for (const path of [...runtimeFiles, ...htmlEntries]) {
    const source = await readFile(path, "utf8");
    for (const specifier of literalModuleSpecifiers(source)) {
      if (!specifier.startsWith(".")) continue;
      const target = resolve(dirname(path), specifier);
      if (
        isWithin(target, resolve(PROJECT_ROOT, "tools")) ||
        isWithin(target, resolve(PROJECT_ROOT, "scripts"))
      ) {
        offenders.push(`${relative(PROJECT_ROOT, path)} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});

test("public에는 연무장 원본·연구 생성물이 없고 Pages는 dist만 배포한다", async () => {
  const publicFiles = (await filesUnder(resolve(PROJECT_ROOT, "public")))
    .map((path) => relative(resolve(PROJECT_ROOT, "public"), path));
  const forbidden = publicFiles.filter((path) =>
    /(?:^|[/\\])(?:battle-practice-dataset|raw|generated|research)(?:[/\\]|$)/u
      .test(path)
  );
  assert.deepEqual(forbidden, []);

  const wrangler = await readFile(resolve(PROJECT_ROOT, "wrangler.jsonc"), "utf8");
  assert.match(wrangler, /"pages_build_output_dir"\s*:\s*"\.\/dist"/u);
  const ignore = await readFile(resolve(PROJECT_ROOT, ".gitignore"), "utf8");
  assert.match(ignore, /^tools\/battle-practice-dataset\/raw\/$/mu);
  assert.match(ignore, /^tools\/battle-practice-dataset\/generated\/$/mu);
});

test("배포용 직업 프로필은 익명 집계값만 담은 경량 모델이다", async () => {
  const profilePath = resolve(CORE_ROOT, "src/class-damage-profiles.js");
  const profileSource = await readFile(profilePath, "utf8");
  const profileStat = await stat(profilePath);

  assert.ok(
    profileStat.size < 256 * 1024,
    `배포용 직업 프로필이 너무 큽니다: ${profileStat.size} bytes`,
  );
  assert.doesNotMatch(
    profileSource,
    /characterName|replayId|total_play_time|total_damage|skill_statistic/u,
  );
  assert.match(profileSource, /sampleCount/u);
  assert.match(profileSource, /skillShares/u);
});

test("배포용 연무장 프로필은 레테를 포함한 47직업만 계산식으로 제공한다", async () => {
  const profileModule = await import(
    `${pathToFileURL(resolve(CORE_ROOT, "src/class-damage-profiles.js")).href}?runtime-profile-test=${Date.now()}`,
  );
  const profiles = profileModule.CLASS_BATTLE_PRACTICE_DAMAGE_PROFILES;
  const entries = Object.entries(profiles);

  assert.equal(entries.length, 47);
  assert.equal(profiles["레테"]?.sampleCount, 3);
  assert.equal(profiles["데몬어벤져"], undefined);
  assert.deepEqual(
    entries
      .filter(([characterClass]) => characterClass !== "레테")
      .map(([, profile]) => profile.sampleCount)
      .filter((sampleCount) => sampleCount !== 5),
    [],
  );

  const allowedProfileFields = new Set([
    "enemyDefense",
    "id",
    "profileHash",
    "sampleCount",
    "shareBasis",
    "skillProfileHash",
    "skillShares",
  ]);
  const allowedSkillFields = new Set([
    "ignoreDefenseSources",
    "source",
    "weight",
  ]);
  for (const [characterClass, profile] of entries) {
    assert.deepEqual(
      Object.keys(profile).filter((field) => !allowedProfileFields.has(field)),
      [],
      `${characterClass}: 배포 프로필에 연구용 필드가 포함되었습니다`,
    );
    assert.equal(profile.shareBasis, "pre-defense", `${characterClass}: 점유율 기준`);
    assert.ok(profile.skillShares.length > 0, `${characterClass}: 빈 스킬 목록`);
    assert.ok(
      Math.abs(
        profile.skillShares.reduce((sum, skill) => sum + skill.weight, 0) - 1
      ) < 1e-10,
      `${characterClass}: 스킬 점유율 합계`,
    );
    for (const skill of profile.skillShares) {
      assert.deepEqual(
        Object.keys(skill).filter((field) => !allowedSkillFields.has(field)),
        [],
        `${characterClass}/${skill.source}: 배포 스킬에 연구용 필드가 포함되었습니다`,
      );
      assert.ok(skill.source, `${characterClass}: 빈 스킬명`);
      assert.ok(skill.weight > 0, `${characterClass}/${skill.source}: 잘못된 점유율`);
    }
  }
});

test("운영 빌드는 비공개 장비 시세 대용량 데이터를 제거한다", async () => {
  const productionEnv = await readFile(
    resolve(PROJECT_ROOT, ".env.production"),
    "utf8",
  );
  const viteConfig = await readFile(resolve(PROJECT_ROOT, "vite.config.js"), "utf8");

  assert.match(productionEnv, /^VITE_ITEM_MARKET_ENABLED=false$/mu);
  assert.match(viteConfig, /if \(!enabled\)/u);
  assert.match(
    viteConfig,
    /await rm\(releasesRoot, \{ recursive: true, force: true \}\)/u,
  );
});
