import assert from "node:assert/strict";
import test from "node:test";

const PROFILE_V1 = "maplestarforce:character-profile:v1";
const PROFILE_V2 = "maplestarforce:character-profile:v2";
const SAVED_NAMES = "maplestarforce:character-names:v1";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function legacyProfile(className, subStat = "LUK") {
  return {
    character: {
      name: "테스트캐릭터",
      className,
      level: 285,
    },
    profiles: {
      fullBoss: {
        mainStat: "LUK",
        subStat,
        attackType: "attack",
        statModel: "standard",
        capabilities: { potentialEquivalence: true },
        statEquivalence: {
          flatMainStatToPercent: 0.1,
          flatSubStatToFlatMainStat: 0.25,
          subStatPercentToMainPercent: 0.12,
        },
      },
    },
  };
}

test("프로필 v1은 일반 직업만 v2로 옮기고 저장 닉네임은 보존한다", async () => {
  const originalStorage = globalThis.localStorage;
  const namesValue = JSON.stringify({ version: 1, names: ["테스트캐릭터"] });

  try {
    const ordinaryStorage = memoryStorage({
      [PROFILE_V1]: JSON.stringify(legacyProfile("나이트로드", "DEX")),
      [SAVED_NAMES]: namesValue,
    });
    globalThis.localStorage = ordinaryStorage;
    const ordinaryModule = await import(
      new URL("../src/shared/character-profile.js?ordinary-v1", import.meta.url)
    );

    assert.deepEqual(ordinaryModule.getActiveProfile().subStats, ["DEX"]);
    assert.equal(ordinaryStorage.getItem(PROFILE_V1), null);
    assert.ok(ordinaryStorage.getItem(PROFILE_V2));
    assert.deepEqual(
      JSON.parse(ordinaryStorage.getItem(PROFILE_V2)).profiles.fullBoss.subStats,
      ["DEX"],
    );
    assert.equal(ordinaryStorage.getItem(SAVED_NAMES), namesValue);

    const dualStorage = memoryStorage({
      [PROFILE_V1]: JSON.stringify(legacyProfile("섀도어", "DEX")),
      [SAVED_NAMES]: namesValue,
    });
    globalThis.localStorage = dualStorage;
    const dualModule = await import(
      new URL("../src/shared/character-profile.js?dual-v1", import.meta.url)
    );

    assert.equal(dualModule.getActiveProfile(), null);
    assert.equal(dualStorage.getItem(PROFILE_V1), null);
    assert.equal(dualStorage.getItem(PROFILE_V2), null);
    assert.equal(dualStorage.getItem(SAVED_NAMES), namesValue);

    const current = legacyProfile("나이트로드", "DEX");
    current.character.name = "v2캐릭터";
    const preferredStorage = memoryStorage({
      [PROFILE_V1]: JSON.stringify(legacyProfile("나이트로드", "STR")),
      [PROFILE_V2]: JSON.stringify(current),
      [SAVED_NAMES]: namesValue,
    });
    globalThis.localStorage = preferredStorage;
    const preferredModule = await import(
      new URL("../src/shared/character-profile.js?prefer-v2", import.meta.url)
    );

    assert.equal(preferredModule.getActiveProfile().character.name, "v2캐릭터");
    assert.equal(preferredStorage.getItem(PROFILE_V1), null);
    assert.equal(preferredStorage.getItem(SAVED_NAMES), namesValue);
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  }
});
