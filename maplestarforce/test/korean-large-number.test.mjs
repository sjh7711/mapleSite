import assert from "node:assert/strict";
import test from "node:test";
import { formatHonorAmount } from "../src/shared/korean-large-number.js";

test("큰 명성치는 조·억·만 단위로 나눠 표시한다", () => {
  assert.equal(formatHonorAmount(2_424_671_000), "24억 2,467.1만");
  assert.equal(formatHonorAmount(1_230_045_600_000), "1조 2,300억 4,560만");
  assert.equal(formatHonorAmount(500_000_000), "5억");
  assert.equal(formatHonorAmount(24_671_000), "2,467.1만");
  assert.equal(formatHonorAmount(9_876), "9,876");
});

test("단위 경계에서 반올림 결과를 다음 단위로 올린다", () => {
  assert.equal(formatHonorAmount(99_999_900), "1억");
  assert.equal(formatHonorAmount(Infinity), "도달 불가");
});
