import test from "node:test";
import assert from "node:assert/strict";
import { auditSkillDictionary } from "../scripts/audit-character-skill-dictionary.mjs";

function dictionary({ samples = 5, matched = 1, review = false } = {}) {
  return {
    contentHash: "hash",
    source: { grades: ["0", "1"] },
    classes: {
      테스트: {
        sampleCount: samples,
        skillCount: 1,
        gradeSnapshotCoverage: { "0": 1, "1": 1 },
        battlePracticeCoverage: {
          sampleCount: 5,
          observedSkillCount: 1,
          matchedSkillCount: matched >= 0.99 ? 1 : 0,
          matchedDamageShare: matched,
          unmatchedSkills: [],
        },
        skills: [{
          identity: "테스트스킬",
          semantics: {
            ignoreDefense: [],
            reviewRequired: review,
            hasBossExcludedEffect: false,
          },
        }],
      },
    },
  };
}

test("표본·차수·연무장 점유율·검토 큐가 모두 충족돼야 사전을 통과시킨다", () => {
  const passed = auditSkillDictionary(dictionary(), {
    expectedClassCount: 1,
    expectedClassNames: ["테스트"],
    samplesPerClass: 5,
  });
  assert.equal(passed.status, "passed");
  assert.equal(passed.classes[0].battleProfileSampleCount, 5);
  assert.equal(passed.coverage.totalVariantCount, 0);
  assert.equal(passed.coverage.ignoreDefenseEffectCount, 0);

  const failed = auditSkillDictionary(dictionary({
    samples: 4,
    matched: 0.8,
    review: true,
  }), { expectedClassCount: 1, samplesPerClass: 5 });
  assert.equal(failed.status, "failed");
  assert.ok(failed.failures.some((entry) => entry.includes("표본 부족")));
  assert.ok(failed.failures.some((entry) => entry.includes("점유율 매칭")));
  assert.ok(failed.failures.some((entry) => entry.includes("수동 검토")));
});

test("직업 수가 같아도 필수 직업이 다른 사전은 통과시키지 않는다", () => {
  const report = auditSkillDictionary(dictionary(), {
    expectedClassCount: 1,
    expectedClassNames: ["필수직업"],
  });

  assert.equal(report.status, "failed");
  assert.ok(report.failures.some((entry) => entry.includes("필수 직업 누락")));
  assert.ok(report.failures.some((entry) => entry.includes("예상 밖 직업")));
});

test("보스 제외 디버프를 보스 적용으로 분류하면 별도 오류로 막는다", () => {
  const value = dictionary();
  value.classes["테스트"].skills[0].semantics = {
    ignoreDefense: [{ bossApplicable: true }],
    reviewRequired: false,
    hasBossExcludedEffect: true,
  };
  const report = auditSkillDictionary(value, { expectedClassCount: 1 });

  assert.equal(report.coverage.bossExcludedViolationCount, 1);
  assert.ok(report.failures.some((entry) => entry.includes("보스 제외")));
});

test("연무장 관측값이 0/0인 직업을 완전 매칭으로 통과시키지 않는다", () => {
  const value = dictionary();
  value.classes["테스트"].battlePracticeCoverage = {
    observedSkillCount: 0,
    matchedSkillCount: 0,
    matchedDamageShare: 0,
    unmatchedSkills: [],
  };
  const report = auditSkillDictionary(value, { expectedClassCount: 1 });

  assert.equal(report.status, "failed");
  assert.equal(report.coverage.completeClassCount, 0);
  assert.ok(report.failures.some((entry) => entry.includes("프로필 없음")));
});
