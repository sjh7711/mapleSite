import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  POTENTIAL_GRADES,
  getAvailablePotentialResetMethods,
  getAvailablePotentialTargetTypes,
  getPotentialSuccessCombinations,
  calculatePotentialExpected,
} from "maple-core/potential";
import { bandFor, bandsForSystem } from "../src/shared/potential-tables.js";

const base = new URL("../public/potential-tables/", import.meta.url);
const index = JSON.parse(await readFile(new URL("index.json", base), "utf8"));
const cache = new Map();
async function loadTables(source, grade, part, itemLevel) {
  const band = bandFor(bandsForSystem(index, source), itemLevel);
  const file = `${source}-${grade}-${part}-${band}.json`;
  if (!cache.has(file)) {
    const packed = JSON.parse(await readFile(new URL(file, base), "utf8"));
    cache.set(file, packed.map((line) => line.map(([id, probability]) => ({ name: index.names[id], probability }))));
  }
  return cache.get(file);
}

for (const system of ["regular", "additional"]) {
  for (const grade of Object.keys(POTENTIAL_GRADES)) {
    for (const method of getAvailablePotentialResetMethods(system, grade)) {
      test(`${system}/${grade}/${method.id}: 공식 표의 모든 일반 목표에 성공·상위 조합 표시`, async () => {
        for (const itemLevel of [200, 250]) {
          for (const part of [1, 6, 11, 18]) {
            const tables = await loadTables(method.tableSource, grade, part, itemLevel);
            const displayTables = method.fixedFirstLine ? tables.slice(1) : tables;
            const types = getAvailablePotentialTargetTypes(displayTables, { part, system })
              .filter((type) => type !== "stat-equivalent");
            for (const targetType of types) {
              const targets = [{ targetType, target: 1 }];
              const result = getPotentialSuccessCombinations({ tables: displayTables, targets, sortDirection: "desc", limit: 5 });
              assert.ok(result.totalCount > 0, `${targetType}: ${part}/${itemLevel}`);
              assert.ok(result.combinations[0].scores.every((score) => score >= 1));
              for (const combination of result.combinations) {
                assert.ok(combination.options.length <= (method.fixedFirstLine ? 2 : 3));
                const actual = calculatePotentialExpected({
                  tables: combination.options.map(({ name }) => [{ name, probability: 1 }]),
                  targets, itemLevel, grade, system,
                });
                assert.equal(actual.rawProbability, 1, `${targetType}: ${JSON.stringify(combination)}`);
              }
              const maximum = result.combinations[0].scores[0];
              if (result.conditions.length === 1 && maximum > 1) {
                const higher = getPotentialSuccessCombinations({ tables: displayTables, targets: [{ targetType, target: maximum }], sortDirection: "desc" });
                assert.ok(higher.totalCount > 0, "상위 목표로 변경해도 해당 조합이 유지되어야 합니다.");
                const unreachable = getPotentialSuccessCombinations({ tables: displayTables, targets: [{ targetType, target: maximum + 1 }] });
                assert.equal(unreachable.totalCount, 0);
              }
            }
          }
        }
      });
    }
  }
}
