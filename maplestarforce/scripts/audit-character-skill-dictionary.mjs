import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  BATTLE_PRACTICE_JOB_CLASSES,
} from "./battle-practice-job-classes.mjs";
import { CHARACTER_SKILL_GRADES } from "./lib/skill-dictionary.mjs";

function argumentsMap(argv) {
  return Object.fromEntries(argv.filter((value) => value.startsWith("--")).map(
    (value) => {
      const [key, ...rest] = value.slice(2).split("=");
      return [key, rest.length ? rest.join("=") : true];
    },
  ));
}

function percent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : "—";
}

function markdown(report) {
  const lines = [
    "# 전 직업 스킬 사전 감사",
    "",
    `- 상태: **${report.status.toUpperCase()}**`,
    `- 직업: **${report.coverage.completeClassCount}/${report.target.classCount}**`,
    `- 표본: **직업당 ${report.target.samplesPerClass}명**`,
    `- 직업별 스킬 항목 합계: **${report.coverage.totalSkillCount.toLocaleString("ko-KR")}개**`,
    `- 효과 변형 합계: **${report.coverage.totalVariantCount.toLocaleString("ko-KR")}개**`,
    `- 서로 다른 스킬명: **${report.coverage.uniqueSkillNameCount.toLocaleString("ko-KR")}개**`,
    `- 방무 관련 스킬: **${report.coverage.ignoreDefenseSkillCount}개**`,
    `- 정규화된 방무 효과: **${report.coverage.ignoreDefenseEffectCount.toLocaleString("ko-KR")}개**`,
    `- 자동 파싱 검토 필요: **${report.coverage.reviewRequiredCount}개**`,
    "",
    "> 범위: 공식 정적 카탈로그가 아니라 직업당 5개 캐릭터의 Open API 스킬 스냅샷 합집합입니다. 전체 원문은 보존하지만 구조화된 효과 감사의 현재 범위는 방어율 무시·방어율 감소입니다.",
    "",
    "| 직업 | 스킬 표본 | 스킬 | 연무장 표본 | 연무장 이름 매칭 | 피해 점유율 매칭 | 검토 필요 | 상태 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const row of report.classes) {
    lines.push(
      `| ${row.characterClass} | ${row.sampleCount}/${report.target.samplesPerClass} | ` +
        `${row.skillCount} | ${row.battleProfileSampleCount ?? "—"} | ` +
        `${row.matchedBattleSkillCount}/${row.observedBattleSkillCount} | ` +
        `${percent(row.matchedBattleDamageShare)} | ${row.reviewRequiredCount} | ` +
        `${row.complete ? "PASS" : "FAIL"} |`,
    );
  }
  if (report.failures.length) {
    lines.push("", "## 게이트 실패", "");
    for (const failure of report.failures) lines.push(`- ${failure}`);
  }
  if (report.reviewQueue.length) {
    lines.push("", "## 방무 문구 검토 큐", "");
    for (const entry of report.reviewQueue.slice(0, 200)) {
      lines.push(
        `- ${entry.characterClass} · ${entry.grade} · ${entry.skillName}: ${entry.reason}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function auditSkillDictionary(dictionary, {
  expectedClassCount = 48,
  expectedClassNames = null,
  requiredGrades = null,
  samplesPerClass = 5,
  minimumBattleDamageShare = 0.99,
} = {}) {
  const classes = [];
  const uniqueSkillNames = new Set();
  const reviewQueue = [];
  let totalSkillCount = 0;
  let totalVariantCount = 0;
  let ignoreDefenseSkillCount = 0;
  let ignoreDefenseEffectCount = 0;
  let bossExcludedViolationCount = 0;
  const expectedGrades = Array.isArray(requiredGrades)
    ? requiredGrades
    : Array.isArray(dictionary?.source?.grades)
      ? dictionary.source.grades
      : [];
  for (const [characterClass, entry] of Object.entries(dictionary?.classes ?? {})) {
    const skills = entry?.skills ?? [];
    totalSkillCount += skills.length;
    for (const skill of skills) {
      totalVariantCount += skill.semanticsVariants?.length ?? 0;
      uniqueSkillNames.add(skill.identity);
      const casterEffects = skill.semantics?.ignoreDefense ?? [];
      const externalEffects = skill.semantics?.externalIgnoreDefense ?? [];
      if (casterEffects.length || externalEffects.length) {
        ignoreDefenseSkillCount += 1;
      }
      ignoreDefenseEffectCount += casterEffects.length + externalEffects.length;
      const invalidBossEntry = skill.semantics?.ignoreDefense?.some((effect) =>
        skill.semantics?.hasBossExcludedEffect && effect.bossApplicable !== false
      );
      if (invalidBossEntry) bossExcludedViolationCount += 1;
      if (skill.semantics?.reviewRequired) {
        reviewQueue.push({
          characterClass,
          grade: skill.grades?.join(",") ?? "",
          skillName: skill.name,
          reason: "방어율 문구의 적용 범위 또는 수치를 자동 확정하지 못함",
        });
      }
    }
    const allGradeSnapshotsComplete = expectedGrades.length > 0 &&
      expectedGrades.every((grade) =>
        entry?.gradeSnapshotCoverage?.[grade] === 1
      );
    const battleCoverage = entry?.battlePracticeCoverage ?? {};
    const hasBattleProfile = Number(battleCoverage.observedSkillCount) > 0;
    // 0/0을 완전 매칭으로 보면 실제 연무장 원본이 없는
    // 직업이 사전 게이트를 통과한다. 적어도 하나의 피해 채널이
    // 존재해야 99% 매칭률을 의미 있게 검증할 수 있다.
    const battleDamageComplete = hasBattleProfile &&
      Number(battleCoverage.matchedDamageShare) >= minimumBattleDamageShare;
    const complete = entry.sampleCount >= samplesPerClass &&
      allGradeSnapshotsComplete && battleDamageComplete;
    classes.push({
      characterClass,
      sampleCount: entry.sampleCount,
      skillCount: entry.skillCount,
      allGradeSnapshotsComplete,
      battleProfileSampleCount: Number(battleCoverage.sampleCount) > 0
        ? Number(battleCoverage.sampleCount)
        : null,
      observedBattleSkillCount: battleCoverage.observedSkillCount ?? 0,
      matchedBattleSkillCount: battleCoverage.matchedSkillCount ?? 0,
      matchedBattleDamageShare: battleCoverage.matchedDamageShare ?? null,
      unmatchedBattleSkills: battleCoverage.unmatchedSkills ?? [],
      reviewRequiredCount: skills.filter((skill) =>
        skill.semantics?.reviewRequired
      ).length,
      complete,
    });
  }
  classes.sort((left, right) =>
    left.characterClass.localeCompare(right.characterClass, "ko-KR")
  );
  const completeClassCount = classes.filter((entry) => entry.complete).length;
  const failures = [];
  if (classes.length !== expectedClassCount) {
    failures.push(`직업 수 불일치: ${classes.length}/${expectedClassCount}`);
  }
  const actualClassNames = new Set(classes.map(({ characterClass }) =>
    characterClass
  ));
  const requiredClassNames = Array.isArray(expectedClassNames)
    ? expectedClassNames
    : [];
  const missingClassNames = requiredClassNames.filter((characterClass) =>
    !actualClassNames.has(characterClass)
  );
  const unexpectedClassNames = requiredClassNames.length
    ? [...actualClassNames].filter((characterClass) =>
      !requiredClassNames.includes(characterClass)
    )
    : [];
  if (missingClassNames.length) {
    failures.push(`필수 직업 누락: ${missingClassNames.join(", ")}`);
  }
  if (unexpectedClassNames.length) {
    failures.push(`예상 밖 직업: ${unexpectedClassNames.join(", ")}`);
  }
  for (const entry of classes.filter((row) => row.sampleCount < samplesPerClass)) {
    failures.push(
      `${entry.characterClass} 표본 부족: ${entry.sampleCount}/${samplesPerClass}`,
    );
  }
  for (const entry of classes.filter((row) => !row.allGradeSnapshotsComplete)) {
    failures.push(`${entry.characterClass} 전직 차수 응답 누락`);
  }
  for (const entry of classes.filter((row) =>
    row.observedBattleSkillCount === 0
  )) {
    failures.push(`${entry.characterClass} 연무장 피해 프로필 없음`);
  }
  for (const entry of classes.filter((row) =>
    row.observedBattleSkillCount > 0 &&
    row.matchedBattleDamageShare < minimumBattleDamageShare
  )) {
    failures.push(
      `${entry.characterClass} 연무장 피해 점유율 매칭 부족: ${percent(entry.matchedBattleDamageShare)}`,
    );
  }
  if (bossExcludedViolationCount) {
    failures.push(
      `보스 제외 효과를 보스 적용으로 분류한 항목 ${bossExcludedViolationCount}개`,
    );
  }
  if (reviewQueue.length) {
    failures.push(`방무 문구 수동 검토 ${reviewQueue.length}개 남음`);
  }
  return {
    schema: "maplestarforce.skill-dictionary-audit.v1",
    generatedAt: new Date().toISOString(),
    status: failures.length ? "failed" : "passed",
    dictionaryHash: dictionary?.contentHash ?? null,
    target: {
      classCount: expectedClassCount,
      samplesPerClass,
      minimumBattleDamageShare,
      expectedClassNames: requiredClassNames,
      requiredGrades: expectedGrades,
    },
    coverage: {
      completeClassCount,
      totalSkillCount,
      totalVariantCount,
      uniqueSkillNameCount: uniqueSkillNames.size,
      ignoreDefenseSkillCount,
      ignoreDefenseEffectCount,
      reviewRequiredCount: reviewQueue.length,
      bossExcludedViolationCount,
    },
    failures,
    classes,
    reviewQueue,
  };
}

async function main() {
  const options = argumentsMap(process.argv.slice(2));
  const inputPath = resolve(String(
    options.input ??
      "tools/battle-practice-dataset/generated/skill-dictionary-v1.json",
  ));
  const outputPath = resolve(String(
    options.output ??
      "tools/battle-practice-dataset/generated/skill-dictionary-audit-v1.json",
  ));
  const markdownPath = resolve(String(
    options.markdown ??
      "tools/battle-practice-dataset/generated/skill-dictionary-audit-v1.md",
  ));
  const report = auditSkillDictionary(
    JSON.parse(await readFile(inputPath, "utf8")),
    {
      expectedClassCount: Number(options.classes ?? 48),
      samplesPerClass: Number(options.samples ?? 5),
      minimumBattleDamageShare: Number(options["minimum-damage-share"] ?? 0.99),
      expectedClassNames: options.classes
        ? null
        : BATTLE_PRACTICE_JOB_CLASSES.map(({ characterClass }) =>
          characterClass
        ),
      requiredGrades: CHARACTER_SKILL_GRADES,
    },
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(dirname(markdownPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, markdown(report), "utf8");
  process.stdout.write(
    `${report.coverage.completeClassCount}/${report.target.classCount}직업 사전 게이트 통과 · ` +
      `검토 ${report.coverage.reviewRequiredCount}개 · ${report.status.toUpperCase()}\n`,
  );
  if (report.status !== "passed" && options["allow-fail"] !== true) {
    process.exitCode = 1;
  }
}

if (import.meta.url === new URL(`file://${resolve(process.argv[1] ?? "")}`).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
