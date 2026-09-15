import {
  BATTLE_PRACTICE_EXCLUDED_CLASSES,
  BATTLE_PRACTICE_JOB_CLASSES,
} from "../battle-practice-job-classes.mjs";
import { characterReferenceKey } from "./character-exclusions.mjs";
import { referenceEfficiencyRow } from "./maplescouter-efficiency.mjs";

const KNOWN_CLASSES = Object.freeze(BATTLE_PRACTICE_JOB_CLASSES.map(
  ({ characterClass }) => characterClass,
));
const KNOWN_CLASS_SET = new Set(KNOWN_CLASSES);
const DEFAULT_EXCLUDED_CLASS_SET = new Set(BATTLE_PRACTICE_EXCLUDED_CLASSES);

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value) {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function normalizedText(value) {
  return String(value ?? "").trim().normalize("NFC");
}

function normalizedRank(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizedTimestamp(value) {
  const text = normalizedText(value);
  return text && Number.isFinite(Date.parse(text)) ? text : null;
}

function recordsFromJson(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [value];
  for (const key of ["references", "records", "rows"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [value];
}

/** JSON 배열·보고서 객체·JSONL 원본을 같은 행 배열로 읽는다. */
export function parseMapleScouterReferenceInput(text, sourceLabel = "입력") {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return [];
  try {
    return recordsFromJson(JSON.parse(trimmed));
  } catch (documentError) {
    return trimmed.split(/\r?\n/u).filter((line) => line.trim()).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(
          `${sourceLabel}:${index + 1} JSON 형식이 잘못되었습니다.`,
          { cause: documentError },
        );
      }
    });
  }
}

/** 쉼표가 들어간 공식 직업명은 하나의 이름으로 먼저 판정한다. */
export function parseMapleScouterClassList(value) {
  const text = normalizedText(value);
  if (!text) return [];
  if (KNOWN_CLASS_SET.has(text)) return [text];
  const separator = text.includes("|") ? "|" : text.includes(";") ? ";" : ",";
  return [...new Set(text.split(separator).map(normalizedText).filter(Boolean))];
}

function normalizedAmounts(amounts) {
  return {
    bossDamage: positiveNumber(amounts?.bossDamage),
    flatAttack: positiveNumber(amounts?.flatAttack),
    attackPercent: positiveNumber(amounts?.attackPercent),
    criticalDamage: positiveNumber(amounts?.criticalDamage),
    allStatPercent: positiveNumber(amounts?.allStatPercent),
  };
}

/** 수집 원본과 이미 생성된 기준 행을 동일한 기준 행으로 정규화한다. */
export function normalizeMapleScouterReference(candidate) {
  const converted = candidate?.reference
    ? referenceEfficiencyRow(candidate)
    : candidate;
  if (!converted || typeof converted !== "object") {
    return { ok: false, reason: "reference-unavailable" };
  }
  const characterName = normalizedText(converted.characterName);
  const characterClass = normalizedText(
    converted.characterClass ?? converted.apiClass,
  );
  if (!characterName || !characterClass) {
    return { ok: false, reason: "character-identity-missing" };
  }
  if (!KNOWN_CLASS_SET.has(characterClass)) {
    return {
      ok: false,
      reason: "unknown-character-class",
      characterName,
      characterClass,
    };
  }
  const ied300 = positiveNumber(converted.ied300);
  const ied380 = positiveNumber(converted.ied380);
  if (ied300 === null || ied380 === null) {
    return {
      ok: false,
      reason: "ied-reference-missing",
      characterName,
      characterClass,
    };
  }
  const reference = {
    characterName,
    characterClass,
    rank: normalizedRank(converted.rank ?? candidate?.rank),
    ied300,
    ied380,
    bossDamage: positiveNumber(converted.bossDamage),
    flatAttack: positiveNumber(converted.flatAttack),
    attackPercent: positiveNumber(converted.attackPercent),
    criticalDamage: positiveNumber(converted.criticalDamage),
    allStatPercent: positiveNumber(converted.allStatPercent),
    amounts: normalizedAmounts(converted.amounts),
    source: normalizedText(converted.source) || "maplescouter-reference",
    collectedAt: normalizedTimestamp(converted.collectedAt ?? candidate?.collectedAt),
  };
  return { ok: true, reference };
}

function timeValue(reference) {
  return reference.collectedAt ? Date.parse(reference.collectedAt) : -Infinity;
}

function rankValue(reference) {
  return reference.rank ?? Number.MAX_SAFE_INTEGER;
}

function stableReferenceValue(reference) {
  return JSON.stringify(reference);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** 동일 캐릭터의 충돌 시 최신 수집본, 높은 랭킹, 내용 순으로 하나를 고른다. */
function compareDuplicatePriority(left, right) {
  return timeValue(right) - timeValue(left) ||
    rankValue(left) - rankValue(right) ||
    compareText(stableReferenceValue(left), stableReferenceValue(right));
}

/** 서로 다른 캐릭터 중 검증 표본은 높은 랭킹, 최신 수집본, 닉네임 순이다. */
function compareSamplePriority(left, right) {
  return rankValue(left) - rankValue(right) ||
    timeValue(right) - timeValue(left) ||
    compareText(left.characterName, right.characterName) ||
    compareText(stableReferenceValue(left), stableReferenceValue(right));
}

function selectedClasses(classes, includeDemonAvenger) {
  const hasExplicitClasses = Array.isArray(classes) && classes.length;
  const requested = hasExplicitClasses
    ? [...new Set(classes.map(normalizedText).filter(Boolean))]
    : [...KNOWN_CLASSES];
  const unknown = requested.filter((characterClass) =>
    !KNOWN_CLASS_SET.has(characterClass)
  );
  if (unknown.length) {
    throw new Error(`알 수 없는 직업: ${unknown.join(", ")}`);
  }
  const unsupported = requested.filter((characterClass) =>
    DEFAULT_EXCLUDED_CLASS_SET.has(characterClass)
  );
  if (hasExplicitClasses && !includeDemonAvenger && unsupported.length) {
    throw new Error(
      `기본 제외 직업을 포함하려면 --include-demon-avenger가 필요합니다: ${
        unsupported.join(", ")
      }`,
    );
  }
  if (!includeDemonAvenger) {
    return requested.filter((characterClass) =>
      !DEFAULT_EXCLUDED_CLASS_SET.has(characterClass)
    );
  }
  return requested;
}

/**
 * 학습 표본과 겹치지 않는 직업별 검증 기준표를 만든다.
 * 결과의 클래스 및 표본 순서는 입력 파일 순서와 무관하게 고정된다.
 */
export function buildMapleScouterReferenceSet({
  records,
  excludedCharacterKeys = new Set(),
  classes = [],
  samples = 5,
  includeDemonAvenger = false,
} = {}) {
  const sampleCount = Number(samples);
  if (!Number.isInteger(sampleCount) || sampleCount <= 0) {
    throw new Error("samples는 1 이상의 정수여야 합니다.");
  }
  const requestedClasses = selectedClasses(classes, includeDemonAvenger);
  const requestedSet = new Set(requestedClasses);
  const normalizedRecords = [];
  const invalidRecords = [];
  let filteredClassCount = 0;
  let defaultExcludedClassCount = 0;

  for (const [index, candidate] of (Array.isArray(records) ? records : []).entries()) {
    const candidateClass = normalizedText(
      candidate?.characterClass ?? candidate?.apiClass,
    );
    // 선택하지 않은 정상 직업과 기본 제외 직업은 세부 기준값 검증 대상도 아니다.
    if (KNOWN_CLASS_SET.has(candidateClass)) {
      if (!includeDemonAvenger && DEFAULT_EXCLUDED_CLASS_SET.has(candidateClass)) {
        defaultExcludedClassCount += 1;
        continue;
      }
      if (!requestedSet.has(candidateClass)) {
        filteredClassCount += 1;
        continue;
      }
    }
    const normalized = normalizeMapleScouterReference(candidate);
    if (!normalized.ok) {
      invalidRecords.push({
        index,
        reason: normalized.reason,
        characterClass: normalized.characterClass ?? null,
        characterName: normalized.characterName ?? null,
      });
      continue;
    }
    const { reference } = normalized;
    normalizedRecords.push(reference);
  }

  const latestByCharacter = new Map();
  const duplicateCountByClass = new Map();
  for (const reference of normalizedRecords) {
    const key = characterReferenceKey(
      reference.characterClass,
      reference.characterName,
    );
    const previous = latestByCharacter.get(key);
    if (!previous) {
      latestByCharacter.set(key, reference);
      continue;
    }
    duplicateCountByClass.set(
      reference.characterClass,
      (duplicateCountByClass.get(reference.characterClass) ?? 0) + 1,
    );
    if (compareDuplicatePriority(reference, previous) < 0) {
      latestByCharacter.set(key, reference);
    }
  }

  const availableByClass = new Map(requestedClasses.map((characterClass) => [
    characterClass,
    [],
  ]));
  const excludedCountByClass = new Map();
  for (const [key, reference] of latestByCharacter) {
    if (excludedCharacterKeys.has(key)) {
      excludedCountByClass.set(
        reference.characterClass,
        (excludedCountByClass.get(reference.characterClass) ?? 0) + 1,
      );
      continue;
    }
    availableByClass.get(reference.characterClass)?.push(reference);
  }

  const references = [];
  const classReports = [];
  for (const characterClass of requestedClasses) {
    const available = availableByClass.get(characterClass).sort(compareSamplePriority);
    const selected = available.slice(0, sampleCount);
    references.push(...selected);
    classReports.push({
      characterClass,
      inputCount: normalizedRecords.filter((reference) =>
        reference.characterClass === characterClass
      ).length,
      duplicateCount: duplicateCountByClass.get(characterClass) ?? 0,
      excludedCount: excludedCountByClass.get(characterClass) ?? 0,
      availableCount: available.length,
      selectedCount: selected.length,
      shortfall: Math.max(0, sampleCount - selected.length),
      selectedCharacters: selected.map((reference) => ({
        characterName: reference.characterName,
        rank: reference.rank,
        collectedAt: reference.collectedAt,
      })),
    });
  }

  const missingClasses = classReports.filter(({ shortfall }) => shortfall > 0)
    .map(({ characterClass, shortfall }) => ({ characterClass, shortfall }));
  const failureReasons = [];
  if (invalidRecords.length) failureReasons.push("invalid-reference-records");
  if (missingClasses.length) failureReasons.push("insufficient-class-samples");
  const duplicateReferenceCount = [...duplicateCountByClass.values()]
    .reduce((total, count) => total + count, 0);
  const excludedReferenceCount = [...excludedCountByClass.values()]
    .reduce((total, count) => total + count, 0);

  return {
    ok: failureReasons.length === 0,
    references,
    report: {
      schemaVersion: 1,
      status: failureReasons.length ? "failed" : "passed",
      failureReasons,
      policy: {
        samplesPerClass: sampleCount,
        defaultExcludedClasses: includeDemonAvenger
          ? []
          : [...BATTLE_PRACTICE_EXCLUDED_CLASSES],
        duplicateSelection: "collectedAt-desc,rank-asc,stable-content",
        sampleSelection: "rank-asc,collectedAt-desc,characterName-asc",
        trainingOverlap: "excluded-by-characterClass-and-characterName",
      },
      requestedClasses,
      missingClasses,
      counts: {
        inputRecordCount: Array.isArray(records) ? records.length : 0,
        normalizedReferenceCount: normalizedRecords.length,
        invalidReferenceCount: invalidRecords.length,
        filteredClassCount,
        defaultExcludedClassCount,
        duplicateReferenceCount,
        uniqueReferenceCount: latestByCharacter.size,
        excludedReferenceCount,
        availableReferenceCount: [...availableByClass.values()]
          .reduce((total, values) => total + values.length, 0),
        selectedReferenceCount: references.length,
        exclusionKeyCount: excludedCharacterKeys.size,
      },
      invalidRecords,
      classes: classReports,
    },
  };
}
