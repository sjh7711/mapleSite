import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const base = new URL("../public/potential-tables/", import.meta.url);

async function loadIndex() {
  return readFile(new URL("index.json", base), "utf8").then(JSON.parse);
}

async function loadTables(index, file) {
  const packed = JSON.parse(await readFile(new URL(file, base), "utf8"));
  return packed.map((line) =>
    line.map(([nameIndex, probability]) => ({
      name: index.names[nameIndex],
      probability,
    })),
  );
}

test("큐브별 공식 표는 최고 등급까지만 포함한다", async () => {
  const files = new Set(await readdir(base));

  for (const file of [
    "regular-gold-legendary-2-120.json",
    "regular-silver-unique-1-120.json",
    "regular-occult-epic-6-120.json",
    "additional-bronze-epic-6-120.json",
  ]) assert.equal(files.has(file), true, file);

  assert.equal([...files].some((file) => file.startsWith("regular-silver-legendary-")), false);
  assert.equal([...files].some((file) => file.startsWith("regular-occult-unique-")), false);
  assert.equal([...files].some((file) => file.startsWith("regular-occult-legendary-")), false);
  assert.equal([...files].some((file) => file.startsWith("additional-bronze-unique-")), false);
  assert.equal([...files].some((file) => file.startsWith("additional-bronze-legendary-")), false);
});

test("확률표는 작은 버전 포인터와 버전별 브라우저 캐시를 사용한다", async () => {
  const [manifest, index, loader, headers] = await Promise.all([
    readFile(new URL("manifest.json", base), "utf8").then(JSON.parse),
    loadIndex(),
    readFile(new URL("../src/shared/potential-tables.js", import.meta.url), "utf8"),
    readFile(new URL("../public/_headers", import.meta.url), "utf8"),
  ]);
  assert.match(manifest.version, /^[a-f0-9]{20}$/u);
  assert.equal(index.version, manifest.version);
  assert.equal(Object.hasOwn(index, "combos"), false);
  assert.match(loader, /caches\.open/u);
  assert.match(loader, /manifest\.json`, \{ cache: "no-cache" \}/u);
  assert.match(headers, /\/potential-tables\/manifest\.json[\s\S]*Cache-Control: no-cache/u);
});

test("골드·실버·수상한·브론즈 에디셔널 표를 공식 원문 표본과 일치시킨다", async () => {
  const index = await loadIndex();
  const cases = [
    ["regular-gold-legendary-2-120.json", [
      ["STR +12%", 12.9032],
      ["STR +9%", 14.2572],
      ["STR +9%", 14.2572],
    ]],
    ["regular-silver-unique-1-120.json", [
      ["STR +9%", 13.3333],
      ["STR +6%", 7.6011],
      ["STR +6%", 7.6011],
    ]],
    ["regular-occult-epic-6-120.json", [
      ["STR +6%", 7.4074],
      ["STR +12", 5.5006],
      ["STR +12", 5.5006],
    ]],
    ["additional-bronze-epic-6-120.json", [
      ["STR +14", 6],
      ["STR +10", 6.3574],
      ["STR +10", 6.3574],
    ]],
  ];

  for (const [file, expectedFirstOptions] of cases) {
    const tables = await loadTables(index, file);
    assert.deepEqual(
      tables.map((line) => [line[0].name, line[0].probability]),
      expectedFirstOptions,
      file,
    );
  }
});

test("큐브별 표를 메소 표의 줄 등급 비율만 바꾼 값으로 재사용하지 않는다", async () => {
  const index = await loadIndex();
  const [meso, gold, additional, bronze] = await Promise.all([
    loadTables(index, "regular-legendary-2-120.json"),
    loadTables(index, "regular-gold-legendary-2-120.json"),
    loadTables(index, "additional-epic-6-120.json"),
    loadTables(index, "additional-bronze-epic-6-120.json"),
  ]);

  assert.notDeepEqual(gold, meso);
  assert.notDeepEqual(bronze, additional);
});
