import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  characterReferenceKey,
  loadCharacterExclusions,
} from "../scripts/lib/character-exclusions.mjs";

test("JSON 배열과 JSONL 원본을 같은 학습·검증 제외 목록으로 읽는다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "character-exclusions-"));
  try {
    const jsonPath = join(directory, "references.json");
    const jsonlPath = join(directory, "records.jsonl");
    await writeFile(jsonPath, JSON.stringify([
      { characterClass: "렌", characterName: "표본1" },
    ]));
    await writeFile(jsonlPath, [
      JSON.stringify({ characterClass: "레테", characterName: "표본2" }),
      JSON.stringify({ apiClass: "블래스터", characterName: "표본3" }),
      "",
    ].join("\n"));

    const excluded = await loadCharacterExclusions([jsonPath, jsonlPath]);
    assert.equal(excluded.size, 3);
    assert.equal(excluded.has(characterReferenceKey("렌", "표본1")), true);
    assert.equal(excluded.has(characterReferenceKey("레테", "표본2")), true);
    assert.equal(excluded.has(characterReferenceKey("블래스터", "표본3")), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
