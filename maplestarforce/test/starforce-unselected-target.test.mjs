import assert from "node:assert/strict";
import test from "node:test";

import { readFile } from "node:fs/promises";

import { appliedStrategy, calculateAll, calculateItem } from "../src/calc.js";

const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");

const item = (targetStar) => ({
  presetId: "meister-ring",
  itemLevel: 140,
  startStar: 12,
  targetStar,
  replacementEok: 0.3,
  quantity: 1,
  spare: 0,
  optimize: true,
  destroyPrevention: [],
  restore: [],
});

test("기본 목표 21성은 정상 계산 대상이다", () => {
  const calculated = calculateAll([item(21)], {
    event: "none",
    mvp: "none",
    pc: false,
  });

  assert.equal(calculated.results.length, 1);
  assert.deepEqual(calculated.errors, []);
  assert.ok(calculated.total.cost > 0);
  assert.equal(calculated.total.quantity, 1);
});

test("목표 드롭다운에서 X를 제거하고 기본값을 21성으로 둔다", () => {
  assert.match(source, /const DEFAULT_TARGET_STAR = 21;/u);
  assert.match(source, /const TARGET_DROPDOWN_ANCHOR_STAR = 12;/u);
  assert.equal(
    source.match(/anchorValue: TARGET_DROPDOWN_ANCHOR_STAR/g)?.length,
    2,
  );
  assert.match(source, /bulk: \{ startStar: DEFAULT_START_STAR, targetStar: DEFAULT_TARGET_STAR \}/u);
  assert.match(source, /options: range\(1, 30\)/u);
  assert.doesNotMatch(source, /targetStarLabel/u);
  assert.doesNotMatch(source, /options: \[0, \.\.\.range\(1,/u);
});

test("18성 이상 시작 장비도 파괴 후 복구 구간의 파괴 방지를 표시한다", () => {
  const calculated = calculateItem(
    {
      ...item(22),
      itemLevel: 200,
      startStar: 18,
      replacementEok: 200,
    },
    { event: "none", mvp: "none", pc: false },
  );
  const applied = appliedStrategy(calculated.strategyStages);

  assert.deepEqual(applied.destroyPrevention, [15, 16, 17]);
  assert.ok(calculated.stages.every((stage) => stage.star >= 18));
  assert.match(source, /appliedStrategy\(entry\.strategyStages \?\? entry\.stages\)/u);
});
