import test from "node:test";
import assert from "node:assert/strict";

import {
  collapseDefenseSignature,
  deduplicateResearchDonors,
  evaluateNonDefenseMapleScouterMetrics,
  evaluateReplayProtocolLeaveOneOut,
  medianEnsembleIgnoreDefenseGain,
  selectStableResearchDonors,
  signatureIgnoreDefenseGain,
  summarizeMapleScouterAllMetrics,
} from "../scripts/lib/skill-dictionary-protocol-research.mjs";
import {
  parseArguments,
  splitPaths,
} from "../scripts/research-skill-dictionary-protocols.mjs";

function close(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected}`,
  );
}

test("같은 스킬 방무 조합은 이름과 무관하게 하나의 경량 채널로 합친다", () => {
  const signature = collapseDefenseSignature([
    { source: "공격 A", rawWeight: 0.2, localIgnoreDefenseSources: [30] },
    { source: "공격 B", rawWeight: 0.3, localIgnoreDefenseSources: [30] },
    { source: "공격 C", rawWeight: 0.5, localIgnoreDefenseSources: [] },
  ]);
  assert.equal(signature.length, 2);
  close(signature[0].rawWeight, 0.5);
  close(signature[1].rawWeight, 0.5);
  assert.deepEqual(
    signature.map(({ localIgnoreDefenseSources }) => localIgnoreDefenseSources),
    [[30], []],
  );
});

test("donor 반응 중앙값은 한 개의 비정상 딜사이클에 끌려가지 않는다", () => {
  const ordinary = [{ rawWeight: 1, localIgnoreDefenseSources: [] }];
  const outlier = [{ rawWeight: 1, localIgnoreDefenseSources: [100] }];
  const expected = signatureIgnoreDefenseGain({
    signature: ordinary,
    currentIgnoreDefense: 0.97,
    enemyDefense: 3.8,
  });
  const actual = medianEnsembleIgnoreDefenseGain({
    donorSignatures: [ordinary, ordinary, ordinary, ordinary, outlier],
    currentIgnoreDefense: 0.97,
    enemyDefense: 3.8,
  });
  close(actual, expected);
});

test("실제 연무장 평가는 매 fold에서 현재 캐릭터를 학습 donor에서 제외한다", () => {
  const records = [0, 1, 2, 3, 4].map((index) => ({
    characterClass: "테스트직업",
    characterName: `테스트${index}`,
    currentIgnoreDefense: 0.97,
    rawChannels: [{
      rawWeight: 1,
      localIgnoreDefenseSources: index === 4 ? [50] : [],
    }],
  }));
  const report = evaluateReplayProtocolLeaveOneOut({ records });
  assert.equal(report.counts.completeClassCount, 1);
  assert.equal(report.classes[0].folds.length, 5);
  assert.ok(report.classes[0].folds.every(({ trainingSampleCount }) =>
    trainingSampleCount === 4
  ));
  // 마지막 outlier 자신이 training에 섞였다면 이 오차는 0이 된다.
  assert.notEqual(
    report.classes[0].folds[4].results["380"].errorPercent,
    0,
  );
});

test("비방무 규약 보정은 해당 캐릭터를 제외한 값만 사용한다", () => {
  const validationRows = [1, 2, 3, 4, 5].map((value) => ({
    ok: true,
    apiClass: "테스트직업",
    characterName: `테스트${value}`,
    bossDamage: value === 5 ? 500 : 100,
    flatAttack: 100,
    attackPercent: 100,
    criticalDamage: 100,
    allStatPercent: 100,
    actuals: {
      bossDamage: 100,
      flatAttack: 100,
      attackPercent: 100,
      criticalDamage: 100,
      allStatPercent: 100,
    },
  }));
  const report = evaluateNonDefenseMapleScouterMetrics({ validationRows });
  const outlier = report.metrics.bossDamage.folds.find(({ characterName }) =>
    characterName === "테스트5"
  );
  // outlier의 5배 정답을 자기 보정값으로 암기하지 않는다.
  close(outlier.correction, 1);
  close(outlier.adapted, 100);
  close(outlier.adaptedErrorPercent, 80);
});

test("donor CLI는 쉼표 입력과 반복 --donors를 모두 보존한다", () => {
  const options = parseArguments([
    "--donors=first.jsonl,second.jsonl",
    "--donors=third.jsonl",
  ]);
  assert.deepEqual(splitPaths(options.donors), [
    "first.jsonl",
    "second.jsonl",
    "third.jsonl",
  ]);
});

test("donor 중복은 NFKC 직업명+캐릭터명 기준 최신 기록만 남긴다", () => {
  const older = {
    characterClass: "테스트직업",
    characterName: "Ａ",
    registerDate: "2026-09-01",
  };
  const newer = {
    characterClass: "테스트직업",
    characterName: "A",
    registerDate: "2026-09-02",
  };
  const result = deduplicateResearchDonors([older, newer]);
  assert.equal(result.candidateCount, 2);
  assert.equal(result.duplicateCount, 1);
  assert.deepEqual(result.records, [newer]);
});

test("7명 donor는 strict stability 선택으로 결정론적 5명만 평가한다", () => {
  const records = [0, 1, 2, 3, 4, 5, 6].map((index) => ({
    characterClass: "테스트직업",
    characterName: `테스트${index}`,
    registerDate: "2026-09-01",
    playTimeMilliseconds: 360_000,
    currentIgnoreDefense: 0.97,
    rawChannels: [{
      source: index < 5 ? "주력기" : `이상기${index}`,
      rawWeight: 1,
      localIgnoreDefenseSources: [],
    }],
  }));
  const first = selectStableResearchDonors(records);
  const second = selectStableResearchDonors([...records].reverse());
  assert.equal(first.rawUniqueCount, 7);
  assert.equal(first.selectedCount, 5);
  assert.deepEqual(
    first.records.map(({ characterName }) => characterName),
    second.records.map(({ characterName }) => characterName),
  );
  assert.deepEqual(first.records.map(({ characterName }) => characterName), [
    "테스트0", "테스트1", "테스트2", "테스트3", "테스트4",
  ]);
});

test("MapleScouter 전체 요약은 방무 2개와 비방무 지표를 같은 직업에 합친다", () => {
  const report = summarizeMapleScouterAllMetrics({
    defense: {
      folds: [{
        characterClass: "테스트직업",
        characterName: "테스트",
        results: {
          300: { dictionaryErrorPercent: 2, adaptedErrorPercent: 1 },
          380: { dictionaryErrorPercent: 4, adaptedErrorPercent: 3 },
        },
      }],
    },
    nonDefense: {
      metrics: {
        bossDamage: {
          folds: [{
            characterClass: "테스트직업",
            characterName: "테스트",
            baselineErrorPercent: 6,
            adaptedErrorPercent: 5,
          }],
        },
      },
    },
  });
  assert.equal(report.counts.rowCount, 3);
  assert.equal(report.counts.classCount, 1);
  close(report.adapted.meanAbsoluteErrorPercent, 3);
  assert.equal(report.counts.passedClassCount, 1);
});
