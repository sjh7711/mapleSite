import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  applyDefenseToRawShares,
} from "../scripts/lib/defense-normalized-profile.mjs";
import {
  buildDefenseNormalizedClassProfile,
  collectHoldoutReferences,
  compileIgnoreDefenseSources,
  createBattlePracticeSkillResolver,
  normalizeDefenseNormalizedDonorRecord,
  prepareDefenseNormalizedDonorRecords,
  renderDefenseNormalizedProfilesModule,
  validateBattlePracticeV2Record,
} from "../scripts/lib/battle-practice-v2-profile.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(await readFile(resolve(
  projectRoot,
  "test/fixtures/battle-practice-v2-synthetic.json",
), "utf8"));

function clone(value) {
  return structuredClone(value);
}

function syntheticRecord(donor, index) {
  const entryIed = donor.ignoreDefensePercent / 100;
  const buffedIed = 1 - (1 - entryIed) * (1 - 0.2);
  const observed = applyDefenseToRawShares({
    rawChannels: fixture.rawChannels,
    globalIgnoreDefense: buffedIed,
    enemyDefense: fixture.enemyDefense,
  });
  const totalDamage = 1_000_000_000;
  const firstDamage = Math.round(observed.channels[0].weight * totalDamage);
  const secondDamage = totalDamage - firstDamage;
  const timeline = [
    [0, "전투 깃발"],
    [10_000, "일반 공격"],
    [20_000, "관통 공격 VI"],
    [30_000, "전투 깃발"],
    [40_000, "일반 공격"],
    [50_000, "관통 공격 VI"],
    [60_000, "전투 깃발"],
    [70_000, "관통 공격 VI"],
    [89_000, "일반 공격"],
  ];
  return {
    schema: "maplestarforce.battle-practice-record.v2",
    characterClass: "테스트직업",
    characterName: donor.characterName,
    collectedAt: `2026-09-0${index + 1}T00:00:00.000Z`,
    replayId: `synthetic-replay-${index + 1}`,
    replayMetadata: { periodNo: index + 1, registerDate: "2026-09-01" },
    result: {
      register_date: "2026-09-01",
      total_play_time: 90_000,
      total_damage: totalDamage,
      end_type: "1",
      skill_statistic: [
        { skill_name: "일반 공격", damage: firstDamage, use_count: 3 },
        { skill_name: "관통 공격 VI", damage: secondDamage, use_count: 3 },
      ],
    },
    characterInfo: {
      basic_object: {
        character_name: donor.characterName,
        character_class: "테스트직업",
        character_level: 290,
        character_class_level: "6",
      },
      stat_object: {
        basic_stat_object: {
          final_stat: [
            {
              stat_name: "방어율 무시",
              stat_value: donor.ignoreDefensePercent.toFixed(2),
            },
          ],
        },
      },
      skill_object: {
        character_skill: [
          { skill_name: "일반 공격", skill_level: 1 },
          {
            skill_name: "관통 공격 VI",
            skill_level: 30,
            skill_effect: "몬스터 방어율 50% 무시",
          },
          { skill_name: "관통 공격 강화", skill_level: 60 },
          { skill_name: "전투 깃발", skill_level: 1 },
        ],
      },
    },
    skillTimeline: {
      totalPageNo: 1,
      // 실제 API는 같은 시퀀스 안에서 근소하게 뒤섞일 수 있으므로
      // 파이프라인이 정렬하는 경로도 함께 검사한다.
      entries: [timeline[0], timeline[2], timeline[1], ...timeline.slice(3)]
        .map(([elapse_time, skill_name]) => ({ elapse_time, skill_name })),
    },
  };
}

const records = fixture.donors.map(syntheticRecord);

test("사전의 스킬 기본·대상 가산·중첩 방무 집계 규칙을 보존한다", () => {
  assert.deepEqual(compileIgnoreDefenseSources([
    { percent: 40, aggregation: "skill-base" },
    { percent: 20, aggregation: "additive-to-target" },
    {
      percent: 15,
      aggregation: "additive-to-target-per-stack",
      perStack: true,
      maximumStacks: 2,
    },
  ], "테스트 공격"), [90]);
});

test("부모 스킬의 서로 다른 파생 공격 방무를 해당 피해 채널에만 적용한다", () => {
  const resolver = createBattlePracticeSkillResolver({
    characterClass: "파생직업",
    characterInfo: {
      skill_object: {
        character_skill: [{ skill_name: "부모 공격", skill_level: 30 }],
      },
    },
    dictionary: {
      classes: {
        파생직업: {
          skills: [{
            name: "부모 공격",
            aliases: ["파생 공격 A", "파생 공격 B"],
            semantics: {
              attack: true,
              ignoreDefense: [
                {
                  kind: "ignore-defense",
                  scope: "skill-local",
                  percent: 40,
                  aggregation: "skill-base",
                  targetSkillNames: ["파생 공격 A"],
                },
                {
                  kind: "ignore-defense",
                  scope: "skill-local",
                  percent: 60,
                  aggregation: "skill-base",
                  targetSkillNames: ["파생 공격 B"],
                },
              ],
            },
          }],
        },
      },
    },
  });
  assert.deepEqual(
    resolver.resolve("파생 공격 A").localIgnoreDefenseSources,
    [40],
  );
  assert.deepEqual(
    resolver.resolve("파생 공격 B").localIgnoreDefenseSources,
    [60],
  );
});

test("실제 캐릭터가 사전의 검토된 alias 이름으로 스킬을 배웠어도 획득으로 판정한다", () => {
  const resolver = createBattlePracticeSkillResolver({
    characterClass: "패스파인더",
    characterInfo: {
      skill_object: {
        character_skill: [{
          skill_name: "레이븐 템페스트",
          skill_level: 30,
        }],
      },
    },
    dictionary: {
      classes: {
        패스파인더: {
          skills: [{
            name: "에인션트 템페스트",
            aliases: [
              "이볼브 템페스트",
              "프라이멀 템페스트",
              "레이븐 템페스트",
            ],
            semantics: {
              attack: true,
              ignoreDefense: [],
            },
          }],
        },
      },
    },
  });

  assert.equal(resolver.acquired.length, 1);
  assert.equal(resolver.acquired[0].skill.name, "에인션트 템페스트");
  assert.equal(resolver.acquired[0].actual.name, "레이븐 템페스트");
  assert.equal(resolver.resolve("레이븐 템페스트").resolved, true);
  assert.deepEqual(
    resolver.resolve("레이븐 템페스트").matchedSkillNames,
    ["에인션트 템페스트"],
  );
});

test("장비·도용 공격은 방무 없음이 exact로 증명된 경우에만 일반 채널로 처리한다", () => {
  const dictionary = {
    classes: {
      레테: {
        skills: [{
          name: "창조의 아이온",
          description: "장비가 부여한 공격 스킬이다.",
          effect: "1500%의 데미지로 공격",
          semantics: {
            reviewRequired: false,
            ignoreDefense: [],
            externalIgnoreDefense: [],
          },
        }],
      },
      듀얼블레이더: {
        skills: [{
          name: "파이널 컷",
          description: "강한 공격을 한다.",
          effect: "2040%의 데미지로 공격",
          semantics: {
            reviewRequired: false,
            ignoreDefense: [],
            externalIgnoreDefense: [],
          },
        }],
      },
      테스트: {
        skills: [],
      },
    },
  };
  const resolver = createBattlePracticeSkillResolver({
    dictionary,
    characterClass: "테스트",
    characterInfo: {
      skill_object: {
        character_skill: [{
          skill_name: "창조의 아이온",
          skill_level: 1,
          skill_effect: "1500%의 데미지로 공격",
        }],
      },
    },
  });

  const equipment = resolver.resolve("창조의 아이온");
  assert.equal(equipment.resolved, true);
  assert.equal(equipment.resolutionMethod, "actual-no-defense-mechanic");
  assert.deepEqual(equipment.localIgnoreDefenseSources, []);

  const stolen = resolver.resolve("파이널 컷");
  assert.equal(stolen.resolved, true);
  assert.equal(
    stolen.resolutionMethod,
    "shared-exact-no-defense-mechanic",
  );

  const unsafeDictionary = structuredClone(dictionary);
  unsafeDictionary.classes.듀얼블레이더.skills[0].effect =
    "2040%의 데미지로 공격, 몬스터 방어율 20% 무시";
  const unsafeResolver = createBattlePracticeSkillResolver({
    dictionary: unsafeDictionary,
    characterClass: "테스트",
    characterInfo: { skill_object: { character_skill: [] } },
  });
  assert.equal(unsafeResolver.resolve("파이널 컷").resolved, false);
});

test("schema v2 정상 자동 종료 기록과 컨텍스트를 엄격히 검증한다", () => {
  const validation = validateBattlePracticeV2Record(records[0], {
    dictionary: fixture.dictionary,
    enemyDefense: fixture.enemyDefense,
  });
  assert.equal(validation.ok, true);
  assert.equal(validation.donorGlobalIgnoreDefense, 0.85);
  assert.equal(validation.resolvedDamageShare, 1);
  assert.ok(validation.timelineSpanRatio > 0.98);
  assert.deepEqual(validation.warnings.map(({ code }) => code), [
    "timeline-order-normalized",
  ]);

  const manual = clone(records[0]);
  manual.result.end_type = "2";
  assert.ok(validateBattlePracticeV2Record(manual, {
    dictionary: fixture.dictionary,
  }).errorCodes.includes("not-auto-ended"));

  const mismatched = clone(records[0]);
  mismatched.characterInfo.basic_object.character_name = "다른캐릭터";
  assert.ok(validateBattlePracticeV2Record(mismatched, {
    dictionary: fixture.dictionary,
  }).errorCodes.includes("character-name-mismatch"));

  const renamed = clone(records[0]);
  renamed.characterName = "현재닉네임";
  renamed.currentCharacterName = "현재닉네임";
  renamed.replayCharacterName =
    renamed.characterInfo.basic_object.character_name;
  renamed.ocid = "synthetic-ocid-rename";
  renamed.identityProvenance = {
    method: "ocid-replay-id",
    ocid: renamed.ocid,
    currentCharacterName: renamed.currentCharacterName,
    replayCharacterName: renamed.replayCharacterName,
  };
  const renamedValidation = validateBattlePracticeV2Record(renamed, {
    dictionary: fixture.dictionary,
  });
  assert.equal(renamedValidation.ok, true);
  assert.equal(renamedValidation.characterName, renamed.replayCharacterName);
  assert.ok(renamedValidation.warnings.some(
    ({ code }) => code === "character-name-changed",
  ));

  const legacyRename = clone(records[0]);
  legacyRename.characterName = "과거조회닉";
  legacyRename.result.register_date = "2026-09-01";
  legacyRename.replayMetadata.registerDate = "2026-09-01";
  legacyRename.provenance = {
    kind: "legacy-result-context-enrichment",
    sourcePath: "/research/raw.jsonl",
  };
  assert.equal(validateBattlePracticeV2Record(legacyRename, {
    dictionary: fixture.dictionary,
  }).ok, true);
  legacyRename.replayMetadata.registerDate = "2026-09-02";
  assert.equal(validateBattlePracticeV2Record(legacyRename, {
    dictionary: fixture.dictionary,
  }).ok, false);
});

test("스킬 기본 방무와 강화 방무를 가산한 뒤 donor 방무를 제거한다", () => {
  const normalized = normalizeDefenseNormalizedDonorRecord(records[0], {
    dictionary: fixture.dictionary,
    enemyDefense: fixture.enemyDefense,
  });
  assert.ok(normalized.record);
  const general = normalized.record.rawChannels.find(
    ({ source }) => source === "일반 공격",
  );
  const penetrating = normalized.record.rawChannels.find(
    ({ source }) => source === "관통 공격 VI",
  );
  assert.ok(Math.abs(general.rawWeight - 0.65) < 1e-8);
  assert.ok(Math.abs(penetrating.rawWeight - 0.35) < 1e-8);
  assert.deepEqual(penetrating.localIgnoreDefenseSources, [70]);
  assert.equal(normalized.record.quality.dynamicDefenseEffectCount, 1);
});

test("서로 다른 donor 방무의 다섯 표본을 동일한 방어 전 프로필로 집계한다", () => {
  const prepared = prepareDefenseNormalizedDonorRecords(records, {
    dictionary: fixture.dictionary,
    enemyDefense: fixture.enemyDefense,
  });
  assert.equal(prepared.records.length, 5);
  const built = buildDefenseNormalizedClassProfile(
    "테스트직업",
    prepared.records,
    {
      dictionaryContentHash: fixture.dictionary.contentHash,
      enemyDefense: fixture.enemyDefense,
    },
  );
  assert.ok(built.profile);
  assert.equal(built.profile.sampleCount, 5);
  assert.match(built.profile.profileHash, /^[a-f0-9]{64}$/u);
  assert.ok(Math.abs(built.profile.skillShares[0].weight - 0.65) < 1e-8);
  assert.ok(Math.abs(built.profile.skillShares[1].weight - 0.35) < 1e-8);
  assert.deepEqual(built.profile.skillShares[1].ignoreDefenseSources, [70]);

  const moduleText = renderDefenseNormalizedProfilesModule({
    테스트직업: built.profile,
  });
  for (const donor of fixture.donors) {
    assert.equal(moduleText.includes(donor.characterName), false);
  }
  assert.equal(moduleText.includes("replayId"), false);
  assert.equal(moduleText.includes("ocid"), false);
  assert.equal(moduleText.includes("currentCharacterName"), false);
  assert.equal(moduleText.includes("donorGlobalIgnoreDefense"), false);
  assert.equal(moduleText.includes('"shareBasis": "pre-defense"'), true);
});

test("같은 캐릭터 중복은 최신 한 건만 쓰고 replay 신원 충돌은 차단한다", () => {
  const duplicate = clone(records[0]);
  duplicate.replayId = "synthetic-replay-new";
  duplicate.collectedAt = "2026-09-09T00:00:00.000Z";
  const prepared = prepareDefenseNormalizedDonorRecords(
    [...records, duplicate],
    { dictionary: fixture.dictionary },
  );
  assert.equal(prepared.records.length, 5);
  assert.equal(prepared.duplicateCount, 1);
  assert.equal(
    prepared.records.find(({ characterName }) =>
      characterName === records[0].characterName
    ).replayId,
    "synthetic-replay-new",
  );

  const collision = clone(records[0]);
  collision.characterName = "충돌캐릭터";
  collision.characterInfo.basic_object.character_name = "충돌캐릭터";
  assert.throws(() => prepareDefenseNormalizedDonorRecords(
    [...records, collision],
    { dictionary: fixture.dictionary },
  ), (error) => error?.code === "REPLAY_IDENTITY_COLLISION");
});

test("학습 donor와 holdout의 캐릭터 또는 replay 중복을 기본 차단한다", () => {
  const holdout = collectHoldoutReferences([[{
    characterClass: "테스트직업",
    characterName: records[0].characterName,
  }]]);
  assert.throws(() => prepareDefenseNormalizedDonorRecords(records, {
    dictionary: fixture.dictionary,
    holdoutReferences: holdout,
  }), (error) => error?.code === "HOLDOUT_LEAKAGE");

  const allowed = prepareDefenseNormalizedDonorRecords(records, {
    dictionary: fixture.dictionary,
    holdoutReferences: holdout,
    failOnHoldoutLeakage: false,
  });
  assert.equal(allowed.records.length, 4);
  assert.equal(allowed.leakage.length, 1);

  const renamed = clone(records[1]);
  renamed.currentCharacterName = "변경된현재닉";
  renamed.replayCharacterName = renamed.characterName;
  renamed.ocid = "synthetic-ocid-holdout";
  renamed.identityProvenance = {
    method: "ocid-replay-id",
    ocid: renamed.ocid,
    currentCharacterName: renamed.currentCharacterName,
    replayCharacterName: renamed.replayCharacterName,
  };
  const aliasHoldout = collectHoldoutReferences([{
    characterClass: renamed.characterClass,
    characterName: renamed.currentCharacterName,
  }]);
  assert.throws(() => prepareDefenseNormalizedDonorRecords([renamed], {
    dictionary: fixture.dictionary,
    holdoutReferences: aliasHoldout,
  }), (error) => error?.code === "HOLDOUT_LEAKAGE");
});

test("CLI는 원본과 보고서를 분리하고 경량 runtime artifact만 생성한다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "battle-v2-profile-"));
  try {
    const inputPath = join(directory, "records.jsonl");
    const dictionaryPath = join(directory, "dictionary.json");
    const outputPath = join(directory, "profiles.js");
    const reportPath = join(directory, "report.json");
    await writeFile(
      inputPath,
      `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
      "utf8",
    );
    await writeFile(
      dictionaryPath,
      JSON.stringify(fixture.dictionary),
      "utf8",
    );
    try {
      await execFileAsync(process.execPath, [
        resolve(projectRoot, "scripts/build-defense-normalized-battle-profiles.mjs"),
        inputPath,
        `--dictionary=${dictionaryPath}`,
        `--output=${outputPath}`,
        `--report=${reportPath}`,
      ], { cwd: projectRoot });
    } catch (error) {
      throw new Error([
        error?.message,
        `stdout: ${error?.stdout ?? ""}`,
        `stderr: ${error?.stderr ?? ""}`,
      ].join("\n"));
    }
    const output = await readFile(outputPath, "utf8");
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.validUniqueDonorCount, 5);
    assert.equal(report.outputProfileCount, 1);
    assert.equal(report.classes["테스트직업"].stable, true);
    assert.equal(output.includes("학습표본1"), false);
    assert.equal(output.includes("skillShares"), true);

    const emptyReferencePath = join(directory, "empty-reference.json");
    const environmentPath = join(directory, ".env");
    const validationPath = join(directory, "validation.json");
    await writeFile(emptyReferencePath, "[]\n", "utf8");
    await writeFile(environmentPath, "NEXON_API_KEY=synthetic-no-network\n", "utf8");
    await execFileAsync(process.execPath, [
      resolve(projectRoot, "scripts/validate-battle-practice-profiles.mjs"),
      "--local",
      `--env-file=${environmentPath}`,
      `--profiles=${outputPath}`,
      `--input=${emptyReferencePath}`,
      `--output=${validationPath}`,
    ], { cwd: projectRoot });
    const validation = JSON.parse(await readFile(validationPath, "utf8"));
    assert.equal(validation.referenceCount, 0);
    assert.equal(validation.profileOverride.path, outputPath);
    assert.match(validation.profileOverride.hash, /^[a-f0-9]{64}$/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("collector 재개는 완성된 다섯 체크포인트를 API 재호출 없이 사용한다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "battle-v2-resume-"));
  try {
    const outputPath = join(directory, "checkpoint.jsonl");
    const existingInputPath = join(directory, "existing.jsonl");
    const checkpoints = Array.from({ length: 5 }, (_, index) => ({
      schema: "maplestarforce.battle-practice-record.v2",
      characterClass: "캡틴",
      characterName: `체크포인트${index + 1}`,
      replayId: `resume-${index + 1}`,
      result: {
        end_type: "1",
        total_play_time: 1_000,
        skill_statistic: [],
      },
      characterInfo: {
        basic_object: {
          character_class: "캡틴",
          character_name: `체크포인트${index + 1}`,
        },
      },
      skillTimeline: {
        totalPageNo: 1,
        entries: [{ elapse_time: 0, skill_name: "테스트" }],
      },
    }));
    await writeFile(
      outputPath,
      `${checkpoints.slice(0, 4).map((row) => JSON.stringify(row)).join("\n")}\n`,
      "utf8",
    );
    await writeFile(
      existingInputPath,
      `${JSON.stringify(checkpoints[4])}\n`,
      "utf8",
    );
    await execFileAsync(process.execPath, [
      resolve(projectRoot, "scripts/collect-battle-practice-records.mjs"),
      `--output=${outputPath}`,
      `--existing-input=${existingInputPath}`,
      "--resume",
      "--samples=5",
      "--classes=캡틴",
    ], {
      cwd: projectRoot,
      env: { ...process.env, NEXON_API_KEY: "synthetic-no-network" },
    });
    const summary = JSON.parse(await readFile(
      `${outputPath}.summary.json`,
      "utf8",
    ));
    assert.equal(summary.requestCount, 0);
    assert.equal(summary.recordCount, 5);
    assert.equal(summary.resumedRecordCount, 4);
    assert.equal(summary.importedRecordCount, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
