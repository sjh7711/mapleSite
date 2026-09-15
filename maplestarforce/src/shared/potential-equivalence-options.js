import { calculatePotentialOptionsStatEquivalent } from "maple-core/potential";
import { getProfileSubStats } from "./profile-stat-equivalence.js";

const SCORE_TOLERANCE = Number.EPSILON;
export const MAX_STAT_EQUIVALENT_COMBINATIONS = 100;

function succeeds(score, target) {
  return score + SCORE_TOLERANCE >= target;
}

function compareNames(left, right) {
  return left.localeCompare(right, "ko");
}

function canonicalNames(options) {
  return options.map(({ name }) => name).toSorted(compareNames);
}

function combinationKey(options) {
  return JSON.stringify(canonicalNames(options));
}

/**
 * 공식 1·2·3줄에 실제로 배치할 수 있는 성공 조합을 찾는다.
 * 환산값이 없는 줄은 생략하지만, 더 적은 줄만으로 이미 성공하더라도 실제로
 * 함께 나올 수 있는 유효 옵션은 제거하지 않는다.
 */
export function getStatEquivalentSuccessCombinations({
  tables,
  target,
  profile,
  limit = MAX_STAT_EQUIVALENT_COMBINATIONS,
  sortDirection = "asc",
}) {
  const threshold = Number(target);
  const scoreDirection = sortDirection === "desc" ? -1 : 1;
  const maximumItems = Number.isFinite(Number(limit))
    ? Math.max(0, Math.floor(Number(limit)))
    : MAX_STAT_EQUIVALENT_COMBINATIONS;
  const empty = {
    combinations: [],
    totalCount: 0,
    hiddenCount: 0,
    truncated: false,
  };
  if (!Array.isArray(tables) || !Number.isFinite(threshold) || threshold <= 0) {
    return empty;
  }

  const calculationOptions = {
    mainStat: profile.mainStat,
    subStat: profile.subStat,
    subStats: getProfileSubStats(profile),
    attackType: profile.attackType,
    characterLevel: Math.round(profile.characterLevel),
    statEquivalence: { ...profile.statEquivalence },
  };
  const scoreCache = new Map();
  const scoreNames = (names) => {
    const sortedNames = names.toSorted(compareNames);
    const key = JSON.stringify(sortedNames);
    if (!scoreCache.has(key)) {
      scoreCache.set(
        key,
        calculatePotentialOptionsStatEquivalent({
          ...calculationOptions,
          optionNames: sortedNames,
        }),
      );
    }
    return scoreCache.get(key);
  };

  const scoredLines = tables.map((line, lineIndex) => {
    if (!Array.isArray(line)) return [];
    const seen = new Set();
    return line.flatMap((option) => {
      if (
        !option ||
        typeof option.name !== "string" ||
        seen.has(option.name)
      ) return [];
      seen.add(option.name);
      const score = scoreNames([option.name]);
      return Number.isFinite(score) && score > SCORE_TOLERANCE
        ? [{ name: option.name, score, line: lineIndex + 1 }]
        : [];
    });
  });

  const combinations = new Map();
  const addCombination = (options, score) => {
    const key = combinationKey(options);
    if (combinations.has(key)) return;
    combinations.set(key, {
      options: options
        .map(({ name, score: optionScore }) => ({ name, score: optionScore }))
        .toSorted((left, right) =>
          right.score - left.score || compareNames(left.name, right.name)
        ),
      score,
    });
  };

  for (const line of scoredLines) {
    for (const option of line) {
      if (succeeds(option.score, threshold)) {
        addCombination([option], option.score);
      }
    }
  }

  for (let leftLine = 0; leftLine < scoredLines.length; leftLine += 1) {
    for (let rightLine = leftLine + 1; rightLine < scoredLines.length; rightLine += 1) {
      for (const left of scoredLines[leftLine]) {
        for (const right of scoredLines[rightLine]) {
          const options = [left, right];
          const score = scoreNames(options.map(({ name }) => name));
          if (succeeds(score, threshold)) addCombination(options, score);
        }
      }
    }
  }

  for (let firstLine = 0; firstLine < scoredLines.length; firstLine += 1) {
    for (let secondLine = firstLine + 1; secondLine < scoredLines.length; secondLine += 1) {
      for (let thirdLine = secondLine + 1; thirdLine < scoredLines.length; thirdLine += 1) {
        for (const first of scoredLines[firstLine]) {
          for (const second of scoredLines[secondLine]) {
            for (const third of scoredLines[thirdLine]) {
              const options = [first, second, third];
              const score = scoreNames(options.map(({ name }) => name));
              if (succeeds(score, threshold)) addCombination(options, score);
            }
          }
        }
      }
    }
  }

  const allCombinations = [...combinations.values()].toSorted((left, right) =>
    scoreDirection * (left.score - right.score) ||
    left.options.length - right.options.length ||
    canonicalNames(left.options).join("\u0000").localeCompare(
      canonicalNames(right.options).join("\u0000"),
      "ko",
    )
  );
  const visible = allCombinations.slice(0, maximumItems);
  const hiddenCount = allCombinations.length - visible.length;
  return {
    combinations: visible,
    totalCount: allCombinations.length,
    hiddenCount,
    truncated: hiddenCount > 0,
  };
}
