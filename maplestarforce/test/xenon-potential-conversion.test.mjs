import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
let temporaryDirectory;
let xenonPotentialStatEquivalence;

before(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "xenon-potential-test-"));
  const outfile = join(temporaryDirectory, "entry.mjs");
  await build({
    entryPoints: [join(PROJECT_ROOT, "functions/_lib/conversion.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent",
  });
  ({ xenonPotentialStatEquivalence } = await import(pathToFileURL(outfile).href));
});

after(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("제논 잠재 환산은 올스탯%가 아니라 STR% 1을 기준 단위로 쓴다", () => {
  const result = xenonPotentialStatEquivalence({
    flatStatToDamagePercent: {
      STR: 0.1,
      DEX: 0.1,
      LUK: 0.1,
      INT: 0,
      HP: 0,
    },
    flatAttackToDamagePercent: 0.2,
    allStatPercentToDamagePercent: 1,
    bossDamageToDamagePercent: 1,
    targetToDamagePercent: 0.1,
    details: {
      dopedBase: { STR: 1_000, DEX: 1_100, LUK: 1_200 },
      damageTotal: 1_000,
      dopedAttackPercent: 200,
      dopedCriticalDamage: 100,
      dopedIgnoreDefense: 0.95,
      targetDefenseRemaining: 1,
    },
  });

  assert.ok(Math.abs(result.allStatPercentToMainPercent - 3.3) < 1e-12);
  assert.equal(result.statPercentToMainPercentByStat.STR, 1);
  assert.equal(result.statPercentToMainPercentByStat.DEX, 1.1);
  assert.equal(result.statPercentToMainPercentByStat.LUK, 1.2);
  assert.ok(Math.abs(result.unreflectedMainStatToPercent - 0.1) < 1e-12);
});
