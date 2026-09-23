import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveItemMarketProfile } from "../src/shared/item-market-estimator.js";

const PROFILE_V2 = "maplestarforce:character-profile:v2";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
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

test("수동 캐릭터 레벨은 290으로 시작하고 저장 상태를 우선한다", async () => {
  const [potentialPage, itemMarketPage] = await Promise.all([
    readFile(new URL("../src/shared/potential-page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/item-market.js", import.meta.url), "utf8"),
  ]);

  assert.match(
    potentialPage,
    /const baseDefaults = \{[\s\S]*?characterLevel: 290,/u,
  );
  assert.match(
    potentialPage,
    /return \{ \.\.\.fallback, \.\.\.JSON\.parse\(calculatorStorage\.getItem\(key\)\) \};/u,
  );
  assert.match(
    itemMarketPage,
    /const defaults = \{[\s\S]*?characterLevel: 290,/u,
  );
  assert.match(
    itemMarketPage,
    /\.\.\.structuredClone\(defaults\),\s*\.\.\.migrated,/u,
  );
  assert.match(
    itemMarketPage,
    /characterLevel: Number\(state\.characterLevel\) \|\| 290,/u,
  );
});

test("계산 fallback은 290이고 명시값과 불러온 캐릭터 레벨은 유지한다", async () => {
  const originalStorage = globalThis.localStorage;

  try {
    globalThis.localStorage = memoryStorage();
    const emptyProfileModule = await import(
      new URL(
        "../src/shared/character-profile.js?character-level-default",
        import.meta.url,
      )
    );

    assert.equal(emptyProfileModule.getCalculationProfile().characterLevel, 290);
    assert.equal(
      emptyProfileModule.getCalculationProfile({ characterLevel: 275 })
        .characterLevel,
      275,
    );

    globalThis.localStorage = memoryStorage({
      [PROFILE_V2]: JSON.stringify({
        character: {
          name: "저장캐릭터",
          className: "아크메이지(불,독)",
          level: 286,
        },
        profiles: {
          fullBoss: {
            mainStat: "INT",
            subStat: "LUK",
            attackType: "magic",
            statEquivalence: {},
          },
        },
      }),
    });
    const savedProfileModule = await import(
      new URL(
        "../src/shared/character-profile.js?character-level-saved",
        import.meta.url,
      )
    );

    assert.equal(
      savedProfileModule.getCalculationProfile({ characterLevel: 290 })
        .characterLevel,
      286,
    );
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  }

  assert.equal(resolveItemMarketProfile().characterLevel, 290);
  assert.equal(
    resolveItemMarketProfile({ characterLevel: 275 }).characterLevel,
    275,
  );
  assert.equal(
    resolveItemMarketProfile({ character: { level: 284 } }).characterLevel,
    284,
  );
});
