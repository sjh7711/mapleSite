import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export function characterReferenceKey(characterClass, characterName) {
  const normalizedClass = String(characterClass ?? "").trim().normalize("NFC");
  const normalizedName = String(characterName ?? "").trim().normalize("NFC");
  return normalizedClass && normalizedName
    ? `${normalizedClass}\u001f${normalizedName}`
    : null;
}

function recordsFromJson(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["rows", "records", "references"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [value];
}

/** JSON 배열·보고서 객체·JSONL 원본을 모두 동일한 제외 목록으로 읽는다. */
export async function loadCharacterExclusions(paths) {
  const excluded = new Set();
  for (const inputPath of paths) {
    const text = await readFile(resolve(inputPath), "utf8");
    const trimmed = text.trim();
    if (!trimmed) continue;
    let records;
    try {
      records = recordsFromJson(JSON.parse(trimmed));
    } catch {
      records = trimmed.split(/\r?\n/u).map((line, index) => {
        try {
          return JSON.parse(line);
        } catch {
          throw new Error(`${inputPath}:${index + 1} JSON 형식이 잘못되었습니다.`);
        }
      });
    }
    for (const record of records) {
      const key = characterReferenceKey(
        record?.apiClass ?? record?.characterClass,
        record?.characterName,
      );
      if (key) excluded.add(key);
    }
  }
  return excluded;
}
