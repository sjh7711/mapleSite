import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateRawDamageProfiles,
  applyDefenseToRawShares,
  inferRawDamageShares,
  rawProfileIgnoreDefenseGain,
} from "../scripts/lib/defense-normalized-profile.mjs";

test("서로 다른 스킬 자체 방무가 섞인 사후 점유율을 원래 비중으로 역산한다", () => {
  const original = [
    { source: "일반", rawWeight: 0.7, localIgnoreDefenseSources: [] },
    { source: "자체 방무", rawWeight: 0.3, localIgnoreDefenseSources: [50] },
  ];
  const observed = applyDefenseToRawShares({
    rawChannels: original,
    globalIgnoreDefense: 0.9,
    enemyDefense: 3.8,
  });
  const inferred = inferRawDamageShares({
    observedChannels: observed.channels,
    donorGlobalIgnoreDefense: 0.9,
    enemyDefense: 3.8,
  });

  assert.ok(Math.abs(inferred[0].rawWeight - 0.7) < 1e-12);
  assert.ok(Math.abs(inferred[1].rawWeight - 0.3) < 1e-12);
});

test("방어 전 프로필을 다른 캐릭터 방무에 재적용하고 추가 방무 효율을 계산한다", () => {
  const rawChannels = [
    { source: "일반", rawWeight: 0.7, localIgnoreDefenseSources: [] },
    { source: "자체 방무", rawWeight: 0.3, localIgnoreDefenseSources: [50] },
  ];
  const gain = rawProfileIgnoreDefenseGain({
    rawChannels,
    currentIgnoreDefense: 0.9,
    addedIgnoreDefense: 0.4,
    enemyDefense: 3.8,
  });
  const before = 0.7 * (1 - 3.8 * 0.1) +
    0.3 * (1 - 3.8 * 0.1 * 0.5);
  const after = 0.7 * (1 - 3.8 * 0.06) +
    0.3 * (1 - 3.8 * 0.06 * 0.5);

  assert.ok(Math.abs(gain - (after / before - 1)) < 1e-12);
});

test("여러 기증자의 방어 전 비중은 없는 스킬을 0으로 포함해 표본 평균한다", () => {
  const aggregated = aggregateRawDamageProfiles([
    [
      { source: "A", rawWeight: 0.8, localIgnoreDefenseSources: [] },
      { source: "B", rawWeight: 0.2, localIgnoreDefenseSources: [20] },
    ],
    [{ source: "A", rawWeight: 1, localIgnoreDefenseSources: [] }],
  ]);

  assert.deepEqual(aggregated.map((entry) => [entry.source, entry.rawWeight]), [
    ["A", 0.9],
    ["B", 0.1],
  ]);
});

