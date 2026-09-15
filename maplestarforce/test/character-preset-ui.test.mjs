import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

const originalStorage = globalThis.localStorage;
globalThis.localStorage = memoryStorage();
const {
  buildCharacterConversionUrl,
  isPresetModeLoading,
  normalizePresetRequest,
  normalizePresetSelection,
} = await import("../src/shared/character-profile.js?preset-ui");

test.after(() => {
  if (originalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalStorage;
});

test("캐릭터 조회 URL은 자동·활성 모드와 직접 선택 파라미터를 구분한다", () => {
  const automatic = new URL(
    buildCharacterConversionUrl("후닝", { mode: "auto" }),
    "https://preview.example",
  );
  assert.equal(automatic.searchParams.get("characterName"), "후닝");
  assert.equal(automatic.searchParams.get("presetMode"), "auto");
  assert.equal(automatic.searchParams.has("equipmentPreset"), false);

  const refresh = new URL(
    buildCharacterConversionUrl("후닝", { mode: "auto" }, { refresh: true }),
    "https://preview.example",
  );
  assert.equal(refresh.searchParams.get("refresh"), "1");

  const manual = new URL(
    buildCharacterConversionUrl("후닝", {
      mode: "manual",
      manual: {
        equipment: 2,
        hyper: 3,
        union: 6,
        link: 1,
        ability: 2,
      },
    }),
    "https://preview.example",
  );
  assert.deepEqual(
    Object.fromEntries(manual.searchParams),
    {
      characterName: "후닝",
      presetMode: "manual",
      equipmentPreset: "2",
      hyperPreset: "3",
      unionPreset: "6",
      linkPreset: "1",
      abilityPreset: "2",
    },
  );
});

test("프리셋 전환 중에는 요청한 자동·활성 기준만 로딩 상태가 된다", () => {
  assert.equal(isPresetModeLoading("auto", true, { mode: "auto" }), true);
  assert.equal(isPresetModeLoading("active", true, { mode: "active" }), true);
  assert.equal(isPresetModeLoading("active", true, { mode: "auto" }), false);
  assert.equal(isPresetModeLoading("manual", true, { mode: "manual" }), false);
  assert.equal(isPresetModeLoading("auto", false, { mode: "auto" }), false);
});

test("프리셋 로딩 아이콘은 버튼이 아닌 계산 기준 박스 우측에 둔다", async () => {
  const source = await readFile(
    new URL("../src/shared/character-profile.js", import.meta.url),
    "utf8",
  );
  const css = await readFile(
    new URL("../src/calculator.css", import.meta.url),
    "utf8",
  );

  assert.match(source, /controls\.append\(top, loadingIndicator\)/);
  assert.doesNotMatch(source, /profile-preset-mode__spinner/);
  assert.match(css, /\.profile-preset-controls__loading\[data-visible="true"\]/);
});

test("이전 장비 요약의 정보 갱신 버튼은 캐시를 건너뛰는 재조회 요청을 보낸다", async () => {
  const source = await readFile(
    new URL("../src/shared/character-profile.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /"정보 갱신"/u);
  assert.match(source, /if \(equipmentMetric\) \{/u);
  assert.doesNotMatch(source, /equipmentSummary\?\.version !==/u);
  assert.match(
    source,
    /searchCharacter\(activeName, presetRequest, \{ refresh: true \}\)/u,
  );
  assert.match(source, /cache: refresh \? "no-store" : "default"/u);
});

test("프리셋 응답은 별칭과 실제 유니온 available 번호를 보존한다", () => {
  const selection = normalizePresetSelection({
    mode: "manual",
    active: {
      equipmentPreset: 1,
      hyperPreset: 2,
      unionPreset: 6,
      linkPreset: 3,
      abilityPreset: 1,
    },
    selected: {
      equipment: 2,
      hyper: 3,
      union: 6,
      link: 1,
      ability: 2,
    },
    available: {
      equipment: [1, 2, 3],
      hyper: [1, 2, 3],
      union: [1, 3, 6, 10],
      link: [1, 2, 3],
      ability: [1, 2, 3],
    },
    approximate: true,
  });

  assert.deepEqual(selection.active, {
    equipment: 1,
    hyper: 2,
    union: 6,
    link: 3,
    ability: 1,
  });
  assert.deepEqual(selection.available.union, [1, 3, 6, 10]);
  assert.equal(selection.approximate, true);
  assert.deepEqual(
    normalizePresetRequest(selection),
    { mode: "manual", manual: selection.selected },
  );
});

test("확인하지 못한 프리셋 번호를 임의의 1번으로 바꾸지 않는다", () => {
  const selection = normalizePresetSelection({
    mode: "active",
    active: {
      equipment: null,
      hyper: 2,
      union: null,
      link: null,
      ability: 3,
    },
    selected: {
      equipment: null,
      hyper: 2,
      union: 6,
      link: null,
      ability: 3,
    },
    available: {
      equipment: [],
      hyper: [1, 2, 3],
      union: [1, 3, 6, 10],
      link: [],
      ability: [1, 2, 3],
    },
  });

  assert.deepEqual(selection.active, {
    equipment: null,
    hyper: 2,
    union: null,
    link: null,
    ability: 3,
  });
  assert.deepEqual(selection.selected, {
    equipment: null,
    hyper: 2,
    union: 6,
    link: null,
    ability: 3,
  });
  assert.deepEqual(selection.available.union, [1, 3, 6, 10]);
});
