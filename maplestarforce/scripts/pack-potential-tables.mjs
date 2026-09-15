/* 받아 둔 확률표를 브라우저가 쓰기 좋게 다듬는다.

   두 가지를 한다.
   1) 조합마다 파일을 따로 둔다. 한 번에 필요한 건 조합 하나뿐이라
      2.9MB를 통째로 내려받을 이유가 없다.
   2) 옵션 이름을 사전으로 뽑아 번호로 바꾼다. 같은 문구가 6만 번 넘게
      되풀이되고 있어 이것만으로도 절반 아래로 준다. */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { isPotentialTableComboFile } from "./potential-table-files.mjs";

const SOURCE = new URL("../src/data/potential-tables.json", import.meta.url);
/* 페이지 경로(/potential/)와 헷갈리지 않게 데이터는 따로 둔다. */
const OUTPUT_DIR = new URL("../public/potential-tables/", import.meta.url);

const snapshot = JSON.parse(await readFile(SOURCE, "utf8"));

// 이름 사전. 나온 순서대로 번호를 매긴다.
const names = [];
const nameIndex = new Map();
const toIndex = (name) => {
  if (!nameIndex.has(name)) {
    nameIndex.set(name, names.length);
    names.push(name);
  }
  return nameIndex.get(name);
};

await mkdir(OUTPUT_DIR, { recursive: true });

const desiredFiles = new Set();
const contentHash = createHash("sha256");
let written = 0;
for (const [key, tables] of Object.entries(snapshot.tables)) {
  const [system, grade, part, level] = key.split(":");
  // 줄마다 [이름번호, 확률] 짝만 남긴다.
  const packed = Object.keys(tables)
    .sort((a, b) => Number(a) - Number(b))
    .map((line) =>
      tables[line].map((option) => [toIndex(option.name), option.probability]),
    );
  const file = `${system}-${grade}-${part}-${level}.json`;
  const packedJson = JSON.stringify(packed);
  await writeFile(new URL(file, OUTPUT_DIR), packedJson, "utf8");
  desiredFiles.add(file);
  contentHash.update(key).update("\0").update(packedJson).update("\0");
  written += 1;
}

// 구간 경계가 바뀌었거나 공식에서 empty로 확인된 예전 조합만
// 제거한다. index.json과 다른 자산은 정규식에 맞지 않아 절대 지우지 않는다.
const staleFiles = (await readdir(OUTPUT_DIR)).filter(
  (file) => isPotentialTableComboFile(file) && !desiredFiles.has(file),
);
for (const file of staleFiles) await unlink(new URL(file, OUTPUT_DIR));

const indexPayload = {
  savedAt: snapshot.savedAt,
  savedAtBySystem: snapshot.savedAtBySystem,
  bands: snapshot.bands,
  bandsBySystem: snapshot.bandsBySystem,
  names,
};
contentHash.update(JSON.stringify(indexPayload));
const version = contentHash.digest("hex").slice(0, 20);
await writeFile(
  new URL("index.json", OUTPUT_DIR),
  JSON.stringify({ version, ...indexPayload }),
  "utf8",
);
await writeFile(
  new URL("manifest.json", OUTPUT_DIR),
  JSON.stringify({ version, savedAt: snapshot.savedAt }),
  "utf8",
);

const files = await readdir(OUTPUT_DIR);
let total = 0;
for (const file of files) {
  total += (await readFile(new URL(file, OUTPUT_DIR), "utf8")).length;
}
const index = (await readFile(new URL("index.json", OUTPUT_DIR), "utf8")).length;
console.log(
  [
    `조합 파일 ${written}개`,
    `오래된 조합 ${staleFiles.length}개 정리`,
    `이름 사전 ${names.length}개`,
    `캐시 버전 ${version}`,
    `안내 파일 ${(index / 1024).toFixed(0)}KB`,
    `조합 파일 평균 ${((total - index) / written / 1024).toFixed(1)}KB`,
    `전부 합쳐 ${(total / 1024).toFixed(0)}KB`,
  ].join(" · "),
);
