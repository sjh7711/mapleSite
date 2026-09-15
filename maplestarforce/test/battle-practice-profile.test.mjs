import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildBattlePracticeClassProfile,
  finalizeBattlePracticeProfileIdentity,
  normalizedBattlePracticeRecord,
  renderBattlePracticeProfilesModule,
  selectStableBattlePracticeRecords,
  uniqueBattlePracticeRecords,
} from "../scripts/lib/battle-practice-profile.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function record({
  characterName,
  duration,
  endType = "1",
  damage,
  date = "2026-09-01T00:00+09:00",
}) {
  const total = Object.values(damage).reduce((sum, value) => sum + value, 0);
  return {
    characterClass: "테스트직업",
    characterName,
    result: {
      register_date: date,
      total_play_time: duration,
      end_type: endType,
      total_damage: total,
      skill_statistic: Object.entries(damage).map(([skill_name, value]) => ({
        skill_name,
        damage: value,
      })),
    },
  };
}

test("정상 자동 종료 여부만으로 판정하고 360초 고정 조건을 두지 않는다", () => {
  assert.ok(normalizedBattlePracticeRecord(record({
    characterName: "빠른사이클",
    duration: 245_000,
    damage: { 주력기: 100 },
  })));
  assert.ok(normalizedBattlePracticeRecord(record({
    characterName: "긴사이클",
    duration: 399_000,
    damage: { 주력기: 100 },
  })));
  assert.equal(normalizedBattlePracticeRecord(record({
    characterName: "수동종료",
    duration: 300_000,
    endType: "2",
    damage: { 주력기: 100 },
  })), null);
  assert.equal(normalizedBattlePracticeRecord(record({
    characterName: "시간초과",
    duration: 400_001,
    damage: { 주력기: 100 },
  })), null);
});

test("직업별 유사한 세 표본은 유지하고 크게 다른 기록은 이상치로 제외한다", () => {
  const candidates = [
    record({ characterName: "표본1", duration: 245_000, damage: { A: 70, B: 20, C: 10 } }),
    record({ characterName: "표본2", duration: 337_000, damage: { A: 68, B: 22, C: 10 } }),
    record({ characterName: "표본3", duration: 399_000, damage: { A: 71, B: 19, C: 10 } }),
    record({ characterName: "이상치", duration: 300_000, damage: { X: 100 } }),
  ];
  const selection = selectStableBattlePracticeRecords(candidates);

  assert.equal(selection.stable, true);
  assert.equal(selection.accepted.length, 3);
  assert.equal(selection.rejected.length, 1);
  assert.ok(selection.medianPairDistance <= 0.020000000001);
});

test("경계 표본 때문에 전체 중앙거리가 기준을 넘으면 가장 큰 안정 대표군을 고른다", () => {
  const candidates = [
    record({ characterName: "대표1", duration: 300_000, damage: { A: 74, B: 16, C: 10 } }),
    record({ characterName: "대표2", duration: 300_000, damage: { A: 70, B: 20, C: 10 } }),
    record({ characterName: "대표3", duration: 300_000, damage: { A: 66, B: 24, C: 10 } }),
    record({ characterName: "대표4", duration: 300_000, damage: { A: 62, B: 28, C: 10 } }),
    record({ characterName: "경계1", duration: 300_000, damage: { A: 42, B: 28, C: 30 } }),
    record({ characterName: "경계2", duration: 300_000, damage: { A: 36, B: 28, C: 36 } }),
  ];
  const selection = selectStableBattlePracticeRecords(candidates, {
    absoluteOutlierDistance: 1,
    maximumOutlierDistance: 1,
    maximumMedianPairDistance: 0.12,
  });

  assert.equal(selection.stable, true);
  assert.ok(selection.accepted.length >= 4);
  assert.ok(selection.medianPairDistance <= 0.12);
  assert.ok(selection.rejected.length >= 1);
});

test("배포용 프로필에는 원본 닉네임 없이 정규화 점유율과 품질 지표만 남긴다", () => {
  const candidates = [
    record({ characterName: "표본1", duration: 245_000, damage: { A: 70, B: 20, C: 10 } }),
    record({ characterName: "표본2", duration: 337_000, damage: { A: 68, B: 22, C: 10 } }),
    record({ characterName: "표본3", duration: 399_000, damage: { A: 71, B: 19, C: 10 } }),
  ];
  const { profile, selection } = buildBattlePracticeClassProfile(
    "테스트직업",
    candidates,
  );
  const moduleText = renderBattlePracticeProfilesModule({ 테스트직업: profile });

  assert.equal(selection.stable, true);
  assert.equal(profile.sampleCount, 3);
  assert.match(profile.id, /^테스트직업-auto-cycle-[a-f0-9]{12}$/u);
  assert.match(profile.skillProfileHash, /^[a-f0-9]{64}$/u);
  assert.match(profile.profileHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(profile.playTimeMilliseconds, {
    minimum: 245_000,
    median: 337_000,
    maximum: 399_000,
  });
  assert.ok(Math.abs(profile.skillShares[0].weight - 0.6966666666666667) < 1e-12);
  assert.equal(moduleText.includes("표본1"), false);
  assert.equal(moduleText.includes("replay_id"), false);
  assert.equal(moduleText.includes("skillShares"), true);
  assert.equal(moduleText.includes(profile.skillProfileHash), true);
  assert.equal(moduleText.includes(profile.profileHash), true);
});

test("기본 품질 기준은 직업당 세 표본 미만을 배포 안정 상태로 보지 않는다", () => {
  const selection = selectStableBattlePracticeRecords([
    record({ characterName: "표본1", duration: 250_000, damage: { A: 80, B: 20 } }),
    record({ characterName: "표본2", duration: 300_000, damage: { A: 79, B: 21 } }),
  ]);

  assert.equal(selection.stable, false);
  assert.equal(selection.reason, "insufficient-samples");
});

test("같은 캐릭터를 다시 수집한 기록은 최신 한 건만 표본으로 센다", () => {
  const oldRecord = record({
    characterName: "중복캐릭터",
    duration: 300_000,
    date: "2026-09-01T00:00+09:00",
    damage: { A: 80, B: 20 },
  });
  const newRecord = record({
    characterName: "중복캐릭터",
    duration: 300_000,
    date: "2026-09-08T00:00+09:00",
    damage: { A: 79, B: 21 },
  });
  const unique = uniqueBattlePracticeRecords([oldRecord, newRecord]);

  assert.equal(unique.length, 1);
  assert.equal(unique[0].registerDate, "2026-09-08T00:00+09:00");
  const selected = selectStableBattlePracticeRecords([oldRecord, newRecord]);
  assert.equal(selected.validCount, 1);
  assert.equal(selected.duplicateCount, 1);
});

test("스킬 프로필 해시는 confidence와 분리되고 최종 프로필 해시는 confidence를 포함한다", () => {
  const source = {
    sampleCount: 5,
    iedBlendConfidence: 0.5,
    skillShares: [{ source: "A", weight: 1 }],
  };
  const first = finalizeBattlePracticeProfileIdentity("테스트직업", source);
  const same = finalizeBattlePracticeProfileIdentity("테스트직업", { ...source });
  const changed = finalizeBattlePracticeProfileIdentity("테스트직업", {
    ...source,
    iedBlendConfidence: 0.6,
  });

  assert.equal(first.profileHash, same.profileHash);
  assert.equal(
    first.profileHash,
    "67f1554c407513c75ab19acd7e80c20fd230474b36e0ef6d9b15800a2fab21d4",
  );
  assert.equal(first.skillProfileHash, same.skillProfileHash);
  assert.equal(first.id, same.id);
  assert.equal(first.skillProfileHash, changed.skillProfileHash);
  assert.notEqual(first.profileHash, changed.profileHash);
  assert.notEqual(first.id, changed.id);

  const changedSkills = finalizeBattlePracticeProfileIdentity("테스트직업", {
    ...source,
    skillShares: [{ source: "B", weight: 1 }],
  });
  assert.notEqual(first.skillProfileHash, changedSkills.skillProfileHash);
  assert.notEqual(first.profileHash, changedSkills.profileHash);
});

test("빌드는 학습 캐릭터를 holdout에서 제외하고 merge는 스킬·최종 해시를 모두 검증한다", async () => {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "battle-practice-profile-test-"),
  );
  try {
    const training = Array.from({ length: 5 }, (_, index) => record({
      characterName: `학습${index + 1}`,
      duration: 330_000 + index * 1_000,
      damage: { A: 80, B: 20 },
    }));
    const built = buildBattlePracticeClassProfile("테스트직업", training);
    const validationRow = (characterName) => ({
      characterClass: "테스트직업",
      characterName,
      apiClass: "테스트직업",
      profileId: built.profile.id,
      skillProfileHash: built.profile.skillProfileHash,
      profileHash: built.profile.profileHash,
      conversionVersion: "test-version",
      actual300: 10,
      actual380: 8,
      unprofiled300: 9,
      unprofiled380: 7,
      ied300: 10,
      ied380: 8,
      unprofiledError300Percent: -10,
      unprofiledError380Percent: -12.5,
    });
    const validationRows = [
      ...training.map(({ characterName }) => validationRow(characterName)),
      ...Array.from({ length: 5 }, (_, index) =>
        validationRow(`검증${index + 1}`)),
    ];
    const inputPath = join(temporaryDirectory, "training.jsonl");
    const validationPath = join(temporaryDirectory, "validation.json");
    const outputPath = join(temporaryDirectory, "validated.js");
    const reportPath = join(temporaryDirectory, "report.json");
    await writeFile(
      inputPath,
      `${training.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
      "utf8",
    );
    await writeFile(
      validationPath,
      JSON.stringify({ rows: validationRows }),
      "utf8",
    );
    await execFileAsync(process.execPath, [
      resolve(projectRoot, "scripts/build-battle-practice-profiles.mjs"),
      inputPath,
      `--validation=${validationPath}`,
      `--output=${outputPath}`,
      `--report=${reportPath}`,
      "--require-validation",
      "--require-validation-improvement",
      "--minimum-validation-samples=5",
    ], { cwd: projectRoot });

    const report = JSON.parse(await readFile(reportPath, "utf8"));
    const classReport = report.classes["테스트직업"];
    assert.equal(classReport.validation.referenceCount, 5);
    assert.equal(classReport.excludedTrainingValidationReferences, 5);
    assert.equal(report.excludedTrainingValidationReferenceCount, 5);
    assert.equal(classReport.validationArtifactMode, "skill-profile-hash");
    assert.equal(classReport.validationArtifactMatched, true);
    assert.equal(classReport.skillProfileHash, built.profile.skillProfileHash);

    const basePath = join(temporaryDirectory, "base.js");
    const mergedPath = join(temporaryDirectory, "merged.js");
    const simpleProfile = (characterClass) =>
      finalizeBattlePracticeProfileIdentity(characterClass, {
        sampleCount: 3,
        iedBlendConfidence: 1,
        skillShares: [{ source: "A", weight: 1 }],
      });
    await writeFile(basePath, renderBattlePracticeProfilesModule({
      기존직업: simpleProfile("기존직업"),
      데몬어벤져: simpleProfile("데몬어벤져"),
    }), "utf8");
    await execFileAsync(process.execPath, [
      resolve(projectRoot, "scripts/merge-battle-practice-profiles.mjs"),
      `--base=${basePath}`,
      `--validated=${outputPath}`,
      `--validation-report=${reportPath}`,
      `--output=${mergedPath}`,
    ], { cwd: projectRoot });
    const merged = await import(
      `${pathToFileURL(mergedPath).href}?v=${Date.now()}`
    );
    assert.ok(merged.CLASS_BATTLE_PRACTICE_DAMAGE_PROFILES["테스트직업"]);
    assert.ok(merged.CLASS_BATTLE_PRACTICE_DAMAGE_PROFILES["기존직업"]);
    assert.equal(
      merged.CLASS_BATTLE_PRACTICE_DAMAGE_PROFILES["데몬어벤져"],
      undefined,
    );

    const invalidReportPath = join(temporaryDirectory, "invalid-report.json");
    report.classes["테스트직업"].skillProfileHash = "0".repeat(64);
    await writeFile(invalidReportPath, JSON.stringify(report), "utf8");
    await assert.rejects(
      execFileAsync(process.execPath, [
        resolve(projectRoot, "scripts/merge-battle-practice-profiles.mjs"),
        `--base=${basePath}`,
        `--validated=${outputPath}`,
        `--validation-report=${invalidReportPath}`,
        `--output=${mergedPath}`,
      ], { cwd: projectRoot }),
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
