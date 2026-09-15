import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BATTLE_PRACTICE_EXCLUDED_CLASSES } from "./battle-practice-job-classes.mjs";
import { renderBattlePracticeProfilesModule } from "./lib/battle-practice-profile.mjs";

const EXCLUDED_CLASSES = new Set(BATTLE_PRACTICE_EXCLUDED_CLASSES);

function parseArguments(argv) {
  const options = {};
  for (const argument of argv) {
    if (!argument.startsWith("--")) continue;
    const [key, ...rest] = argument.slice(2).split("=");
    options[key] = rest.length ? rest.join("=") : true;
  }
  return options;
}

async function loadProfiles(path) {
  const absolutePath = resolve(String(path));
  const module = await import(`${pathToFileURL(absolutePath).href}?v=${Date.now()}`);
  const profiles = module.CLASS_BATTLE_PRACTICE_DAMAGE_PROFILES;
  if (!profiles || typeof profiles !== "object") {
    throw new Error(`계산 프로필 모듈 형식이 아닙니다: ${absolutePath}`);
  }
  return { absolutePath, profiles };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!options.base || !options.validated || !options.output) {
    throw new Error("--base, --validated, --output 경로가 모두 필요합니다.");
  }
  const base = await loadProfiles(options.base);
  const validated = await loadProfiles(options.validated);
  const baseProfiles = Object.fromEntries(
    Object.entries(base.profiles).filter(([characterClass]) =>
      !EXCLUDED_CLASSES.has(characterClass)
    ),
  );
  const validatedProfiles = Object.fromEntries(
    Object.entries(validated.profiles).filter(([characterClass]) =>
      !EXCLUDED_CLASSES.has(characterClass)
    ),
  );
  const validationReport = options["validation-report"]
    ? JSON.parse(await readFile(
      resolve(String(options["validation-report"])),
      "utf8",
    ))
    : null;
  const minimumValidationSamples = Number(options["minimum-validation-samples"] ?? 5);
  if (validationReport) {
    for (const [characterClass, profile] of Object.entries(validatedProfiles)) {
      const expectedSkillHash =
        validationReport?.classes?.[characterClass]?.skillProfileHash;
      const expectedHash = validationReport?.classes?.[characterClass]?.profileHash;
      if (
        !expectedSkillHash ||
        profile?.skillProfileHash !== expectedSkillHash
      ) {
        throw new Error(
          `${characterClass} 검증 보고서와 계산 스킬 프로필의 해시가 일치하지 않습니다.`,
        );
      }
      if (!expectedHash || profile?.profileHash !== expectedHash) {
        throw new Error(
          `${characterClass} 검증 보고서와 계산 프로필의 해시가 일치하지 않습니다.`,
        );
      }
    }
  }
  const revalidatedClasses = new Set(
    Object.entries(validationReport?.classes ?? {})
      .filter(([, result]) =>
        Number(result?.validation?.referenceCount) >= minimumValidationSamples
      )
      .map(([characterClass]) => characterClass),
  );
  const retainedBaseProfiles = Object.fromEntries(
    Object.entries(baseProfiles).filter(([characterClass]) =>
      !revalidatedClasses.has(characterClass)
    ),
  );
  const profiles = {
    ...retainedBaseProfiles,
    ...validatedProfiles,
  };
  const outputPath = resolve(String(options.output));
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, renderBattlePracticeProfilesModule(profiles), "utf8");

  const reportPath = options.report ? resolve(String(options.report)) : null;
  if (reportPath) {
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      basePath: base.absolutePath,
      validatedPath: validated.absolutePath,
      baseProfileCount: Object.keys(baseProfiles).length,
      revalidatedClasses: [...revalidatedClasses].sort((left, right) =>
        left.localeCompare(right, "ko")
      ),
      retainedBaseProfileCount: Object.keys(retainedBaseProfiles).length,
      validatedProfileCount: Object.keys(validatedProfiles).length,
      profileCount: Object.keys(profiles).length,
      validatedClasses: Object.keys(validatedProfiles).sort((left, right) =>
        left.localeCompare(right, "ko")
      ),
    }, null, 2)}\n`, "utf8");
  }
  process.stdout.write(
    `계산 프로필 ${Object.keys(profiles).length}개 병합: ${outputPath}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
