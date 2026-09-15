import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");

test("스타포스 결과는 파괴 횟수 대신 실제 추가 스페어 기댓값을 표시한다", () => {
  assert.doesNotMatch(source, /평균 파괴/u);
  assert.match(source, /<th>평균 스페어<\/th>/u);
  assert.match(
    source,
    /평균 스페어 <strong>\$\{formatNumber\(entry\.totalItems\)\}개<\/strong>/u,
  );
  assert.match(source, /formatNumber\(stage\.expectedItems\)\}개/u);
  assert.match(source, /평균 스페어 \$\{formatNumber\(total\.items\)\}개/u);
});
