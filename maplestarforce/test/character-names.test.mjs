import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MAX_SAVED_CHARACTER_NAMES,
  SAVED_CHARACTER_NAMES_VERSION,
  addSavedCharacterName,
  hasSavedCharacterName,
  normalizeSavedCharacterNames,
  removeSavedCharacterName,
} from "../src/shared/character-names.js";

test("저장 닉네임은 정규화·중복 제거 후 최대 4개만 유지한다", () => {
  assert.deepEqual(
    normalizeSavedCharacterNames({
      version: SAVED_CHARACTER_NAMES_VERSION,
      names: ["  라라 ", "Lara", "lara", "", null, "은월", "아델", "메르"],
    }),
    ["라라", "Lara", "은월", "아델"],
  );
  assert.equal(MAX_SAVED_CHARACTER_NAMES, 4);
  assert.deepEqual(normalizeSavedCharacterNames({ names: ["라라"] }), []);
});

test("다섯 번째 닉네임은 덮어쓰지 않고 삭제한 자리만 다시 사용한다", () => {
  const full = ["라라", "은월", "아델", "메르"];
  assert.deepEqual(addSavedCharacterName(full, "제로"), full);
  assert.deepEqual(addSavedCharacterName(full, "라라"), full);
  assert.equal(hasSavedCharacterName(full, " 라라 "), true);

  const removed = removeSavedCharacterName(full, "은월");
  assert.deepEqual(removed, ["라라", "아델", "메르"]);
  assert.deepEqual(
    addSavedCharacterName(removed, "제로"),
    ["라라", "아델", "메르", "제로"],
  );
});

test("목표가 비었을 때 안내 문구를 만들지 않는다", async () => {
  const source = await readFile(
    new URL("../src/shared/potential-page.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /목표 수치를 입력하면 바로 계산됩니다\./);
});
