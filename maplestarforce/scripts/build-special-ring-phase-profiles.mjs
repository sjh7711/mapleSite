import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  prepareDefenseNormalizedDonorRecords,
} from "./lib/battle-practice-v2-profile.mjs";
import {
  calculateCharacterPotentialConversion,
} from "../../maple-core/src/stat-efficiency.js";
import {
  FULL_BOSS_DOPING,
  inferPotentialStatProfile,
} from "../../maple-core/src/stat-profile.js";

const SUPPORTED_DURATIONS = Object.freeze([9, 11, 13, 15, 20]);
const RESTRAINT_EFFECTS = Object.freeze({
  1: Object.freeze({ duration: 9, attackPercent: 17 }),
  2: Object.freeze({ duration: 11, attackPercent: 34 }),
  3: Object.freeze({ duration: 13, attackPercent: 51 }),
  4: Object.freeze({ duration: 15, attackPercent: 68 }),
  5: Object.freeze({ duration: 20, attackPercent: 68 }),
  6: Object.freeze({ duration: 20, attackPercent: 85 }),
});
const CONTINUOUS_ATTACK_PERCENT = Object.freeze({
  1: 4,
  2: 6,
  3: 8,
  4: 10,
  5: 12,
  6: 14,
});

function parseArguments(argv) {
  const result = { positional: [] };
  for (const argument of argv) {
    if (!argument.startsWith("--")) {
      result.positional.push(argument);
      continue;
    }
    const [key, ...rest] = argument.slice(2).split("=");
    result[key] = rest.length ? rest.join("=") : true;
  }
  return result;
}

async function readJsonLines(path) {
  const absolute = resolve(path);
  const text = await readFile(absolute, "utf8");
  return text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`${absolute}:${index + 1} JSON 형식이 잘못되었습니다.`);
      }
    });
}

function text(value) {
  return String(value ?? "").trim().normalize("NFC");
}

function skillIdentity(value) {
  return text(value)
    .replace(/\s+/gu, " ")
    .replace(/\s+VI(?=\s*(?:[:：(（]|$))/gu, "")
    .replace(/[：]/gu, ":")
    .trim();
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function compact(value) {
  return Number(Number(value).toPrecision(12));
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function medianAbsoluteDeviation(values) {
  const center = median(values);
  return center === null
    ? null
    : median(values.map((value) => Math.abs(value - center)));
}

function phaseDistance(left, right) {
  return SUPPORTED_DURATIONS.reduce((sum, duration) =>
    sum + Math.abs(left.shares[duration] - right.shares[duration]), 0
  ) / SUPPORTED_DURATIONS.length;
}

function selectStablePhaseSamples(samples, maximumSamples = 5) {
  if (samples.length <= maximumSamples) return samples;
  return samples.map((sample) => ({
    sample,
    medianDistance: median(samples.filter((candidate) => candidate !== sample)
      .map((candidate) => phaseDistance(sample, candidate))),
  })).sort((left, right) =>
    left.medianDistance - right.medianDistance ||
    left.sample.replayId.localeCompare(right.sample.replayId)
  ).slice(0, maximumSamples).map(({ sample }) => sample);
}

function overlapLength(left, right) {
  return Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start));
}

function mergedIntervals(intervals, playTime) {
  const sorted = intervals.map(({ start, end }) => ({
    start: Math.max(0, Math.min(playTime, start)),
    end: Math.max(0, Math.min(playTime, end)),
  })).filter(({ start, end }) => end > start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval.start > previous.end) {
      merged.push({ ...interval });
    } else {
      previous.end = Math.max(previous.end, interval.end);
    }
  }
  return merged;
}

function intervalCoverage(interval, windows) {
  const length = interval.end - interval.start;
  if (!(length > 0)) return 0;
  return windows.reduce(
    (sum, window) => sum + overlapLength(interval, window),
    0,
  ) / length;
}

function itemEquipment(record) {
  return record?.characterInfo?.item_object?.item_equipment_object
    ?.item_equipment ?? [];
}

function equippedSpecialRing(record, pattern) {
  return itemEquipment(record).find((item) =>
    pattern.test(text(item?.item_name))
  ) ?? null;
}

function restraintEffect(record) {
  const item = equippedSpecialRing(record, /(?:챌린저스\s+)?리스트레인트 링/u);
  const level = Math.trunc(Number(item?.special_ring_level));
  return RESTRAINT_EFFECTS[level] ?? null;
}

function continuousAttackPercent(record) {
  const item = equippedSpecialRing(record, /(?:챌린저스\s+)?컨티뉴어스 링/u);
  const level = Math.trunc(Number(item?.special_ring_level));
  return CONTINUOUS_ATTACK_PERCENT[level] ?? 0;
}

function durationIndex(dictionary, characterClass) {
  const result = new Map();
  const skills = dictionary?.classes?.[characterClass]?.skills ?? [];
  for (const skill of skills) {
    const identity = skillIdentity(skill?.name);
    if (!identity) continue;
    const duration = Math.max(
      0,
      ...(skill?.semantics?.durationSeconds ?? [])
        .map(Number)
        .filter(Number.isFinite),
    );
    if (duration > (result.get(identity) ?? 0)) result.set(identity, duration);
  }
  return result;
}

function ringActivationTimes(record) {
  const rows = record?.skillTimeline?.entries ?? [];
  const raw = rows.filter(({ skill_name: name }) =>
    /(?:챌린저스\s+)?리스트레인트 링/u.test(text(name))
  ).map(({ elapse_time: elapsed }) => finiteNumber(elapsed))
    .filter((elapsed) => elapsed !== null && elapsed >= 0)
    .sort((left, right) => left - right);
  // 동일 프레임의 중복 행은 한 번의 사용으로 본다.
  return raw.filter((elapsed, index) =>
    index === 0 || elapsed - raw[index - 1] >= 1_000
  );
}

function timelineTimes(record) {
  const bySkill = new Map();
  for (const row of record?.skillTimeline?.entries ?? []) {
    const elapsed = finiteNumber(row?.elapse_time);
    const identity = skillIdentity(row?.skill_name);
    if (!identity || elapsed === null || elapsed < 0) continue;
    const times = bySkill.get(identity) ?? [];
    times.push(elapsed);
    bySkill.set(identity, times);
  }
  return bySkill;
}

function groupedDamageRows(record) {
  const grouped = new Map();
  for (const row of record?.result?.skill_statistic ?? []) {
    const source = text(row?.skill_name);
    const damage = finiteNumber(row?.damage);
    if (!source || damage === null || !(damage > 0)) continue;
    const current = grouped.get(source) ?? { source, damage: 0 };
    current.damage += damage;
    grouped.set(source, current);
  }
  return [...grouped.values()];
}

function skillWindowCoverage({
  source,
  playTime,
  windows,
  timesBySkill,
  durations,
}) {
  const identity = skillIdentity(source);
  const casts = timesBySkill.get(identity) ?? [];
  if (!casts.length) {
    const covered = windows.reduce((sum, { start, end }) => sum + end - start, 0);
    return playTime > 0 ? covered / playTime : 0;
  }
  const durationSeconds = durations.get(identity) ?? 0;
  if (!(durationSeconds > 0)) {
    return casts.filter((elapsed) => windows.some(({ start, end }) =>
      elapsed >= start && elapsed < end
    )).length / casts.length;
  }
  const durationMilliseconds = durationSeconds * 1_000;
  return casts.reduce((sum, start) => {
    const interval = {
      start,
      end: Math.min(playTime, start + durationMilliseconds),
    };
    return sum + intervalCoverage(interval, windows);
  }, 0) / casts.length;
}

function noRingAttackPercent(record, profile) {
  const characterInfo = record?.characterInfo ?? {};
  const itemObject = characterInfo.item_object ?? {};
  const statObject = characterInfo.stat_object ?? {};
  const hexaObject = characterInfo.hexa_matrix_object ?? {};
  const noRingDoping = {
    ...FULL_BOSS_DOPING,
    totals: {
      ...FULL_BOSS_DOPING.totals,
      includeEquippedRing: false,
    },
  };
  // 제논의 본 계산은 합스탯 전용 모델을 사용하지만 공격력% 원장 자체는
  // 일반 직업과 동일하다. 링 증폭분 제거에 필요한 공격력%만 얻을 때는
  // STR·DEX·LUK를 임시 주/부스탯 축으로 전달해 같은 원장을 재사용한다.
  const calculationProfile = profile.model === "xenon"
    ? {
        ...profile,
        mainStat: "STR",
        subStat: "DEX",
        subStats: ["DEX", "LUK"],
      }
    : profile;
  try {
    const result = calculateCharacterPotentialConversion({
      character: characterInfo.basic_object,
      mainStat: calculationProfile.mainStat,
      subStat: calculationProfile.subStat,
      subStats: calculationProfile.subStats,
      attackType: calculationProfile.attackType,
      doping: noRingDoping,
      statData: statObject.basic_stat_object,
      equipmentData: itemObject.item_equipment_object,
      setEffectData: itemObject.set_effect_object,
      cashEquipmentData: characterInfo.cash_item_object,
      petEquipmentData: characterInfo.pet_object,
      otherStatData: statObject.other_stat_object,
      linkSkillData: characterInfo.link_skill_object,
      skillData: [characterInfo.skill_object],
      symbolData: statObject.symbol_stat_object,
      hyperStatData: characterInfo.hyper_stat_object,
      hexaStatData: hexaObject.hexa_matrix_stat_object,
      hexaMatrixData: hexaObject.hexa_core_object,
      vMatrixData: characterInfo.v_matrix_object,
      abilityData: characterInfo.ability_object,
      unionRaiderData: characterInfo.union_raider_object,
      unionArtifactData: characterInfo.union_artifact_object,
      unionChampionData: characterInfo.union_champion_object,
      ringReserveData: characterInfo.ring_reserve_skill_object,
      guildData: characterInfo.guild_object,
    });
    return Number(result?.details?.dopedAttackPercent) +
      continuousAttackPercent(record);
  } catch {
    return null;
  }
}

function recordDurationCoverage(record, dictionary) {
  const playTime = finiteNumber(record?.result?.total_play_time);
  const activeEffect = restraintEffect(record);
  const activations = ringActivationTimes(record);
  const profile = inferPotentialStatProfile(record?.characterClass);
  if (
    !activeEffect || !(playTime > 0) || activations.length < 2 ||
    !profile?.supported
  ) return null;

  const damageRows = groupedDamageRows(record);
  const damageTotal = damageRows.reduce((sum, row) => sum + row.damage, 0);
  if (!(damageTotal > 0)) return null;
  const durations = durationIndex(dictionary, record.characterClass);
  const timesBySkill = timelineTimes(record);
  const actualWindows = mergedIntervals(
    activations.map((start) => ({
      start,
      end: start + activeEffect.duration * 1_000,
    })),
    playTime,
  );
  const attackPercent = noRingAttackPercent(record, profile);
  // 관측 피해에는 이미 리스트레인트 링 증폭분이 들어 있다. 당시의
  // 비링 공격력%를 복원하지 못한 표본을 그대로 쓰면 링 구간 피해
  // 비중이 체계적으로 부풀려지므로 해당 표본은 프로필에서 제외한다.
  if (attackPercent === null) return null;
  const attackDenominator = 100 + attackPercent;
  const restraintMultiplier = attackDenominator > 0
    ? (attackDenominator + activeEffect.attackPercent) / attackDenominator
    : 1;

  const shares = {};
  const observedShares = {};
  for (const duration of SUPPORTED_DURATIONS) {
    const windows = mergedIntervals(
      activations.map((start) => ({
        start,
        end: start + duration * 1_000,
      })),
      playTime,
    );
    let observedWindowDamage = 0;
    let estimatedNoRingWindowDamage = 0;
    let estimatedNoRingDamage = 0;
    for (const row of damageRows) {
      const observedWeight = row.damage / damageTotal;
      const candidateCoverage = skillWindowCoverage({
        source: row.source,
        playTime,
        windows,
        timesBySkill,
        durations,
      });
      const actualCoverage = skillWindowCoverage({
        source: row.source,
        playTime,
        windows: actualWindows,
        timesBySkill,
        durations,
      });
      const overlapCoverage = skillWindowCoverage({
        source: row.source,
        playTime,
        windows: mergedIntervals([
          ...windows.flatMap((candidate) => actualWindows.map((actual) => ({
            start: Math.max(candidate.start, actual.start),
            end: Math.min(candidate.end, actual.end),
          }))),
        ], playTime),
        timesBySkill,
        durations,
      });
      observedWindowDamage += observedWeight * candidateCoverage;
      estimatedNoRingWindowDamage += observedWeight * (
        overlapCoverage / restraintMultiplier +
        Math.max(0, candidateCoverage - overlapCoverage)
      );
      estimatedNoRingDamage += observedWeight * (
        actualCoverage / restraintMultiplier +
        Math.max(0, 1 - actualCoverage)
      );
    }
    observedShares[duration] = observedWindowDamage;
    shares[duration] = estimatedNoRingDamage > 0
      ? estimatedNoRingWindowDamage / estimatedNoRingDamage
      : observedWindowDamage;
  }
  return {
    characterName: record.characterName,
    replayId: record.replayId,
    ringLevel: Object.entries(RESTRAINT_EFFECTS).find(([, effect]) =>
      effect === activeEffect
    )?.[0] ?? null,
    activationCount: activations.length,
    attackPercent,
    shares,
    observedShares,
  };
}

function renderModule(profiles) {
  return [
    "// 자동 생성 파일: 원본 캐릭터·리플레이 정보는 포함하지 않습니다.",
    `const profiles = ${JSON.stringify(profiles, null, 2)};`,
    "",
    "export const CLASS_SPECIAL_RING_PHASE_PROFILES = Object.freeze(profiles);",
    "",
    "export function classSpecialRingPhaseProfile(characterClass) {",
    "  return CLASS_SPECIAL_RING_PHASE_PROFILES[String(characterClass ?? \"\").trim()] ?? null;",
    "}",
    "",
    "export function specialRingBurstDamageShare(characterClass, durationSeconds) {",
    "  const profile = classSpecialRingPhaseProfile(characterClass);",
    "  if (!profile) return null;",
    "  const duration = Number(durationSeconds);",
    "  const exact = profile.damageShareByDuration[String(duration)];",
    "  if (Number.isFinite(exact)) return exact;",
    "  const points = Object.entries(profile.damageShareByDuration)",
    "    .map(([key, value]) => [Number(key), Number(value)])",
    "    .filter(([key, value]) => Number.isFinite(key) && Number.isFinite(value))",
    "    .sort((left, right) => left[0] - right[0]);",
    "  if (!points.length || !Number.isFinite(duration)) return null;",
    "  if (duration <= points[0][0]) return points[0][1] * duration / points[0][0];",
    "  if (duration >= points.at(-1)[0]) return points.at(-1)[1];",
    "  const upperIndex = points.findIndex(([seconds]) => seconds >= duration);",
    "  const lower = points[upperIndex - 1];",
    "  const upper = points[upperIndex];",
    "  const ratio = (duration - lower[0]) / (upper[0] - lower[0]);",
    "  return lower[1] + (upper[1] - lower[1]) * ratio;",
    "}",
    "",
  ].join("\n");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const inputPaths = [
    ...options.positional,
    ...text(options.input).split(",").map((path) => path.trim()).filter(Boolean),
  ];
  if (!inputPaths.length) throw new Error("연무장 JSONL 입력 경로가 필요합니다.");
  const dictionaryPath = resolve(text(options.dictionary) ||
    "tools/battle-practice-dataset/generated/skill-mechanics-v1.json");
  const dictionary = JSON.parse(await readFile(dictionaryPath, "utf8"));
  const records = (await Promise.all(inputPaths.map(readJsonLines))).flat();
  const prepared = prepareDefenseNormalizedDonorRecords(records, {
    dictionary,
    enemyDefense: 3.8,
    minimumCharacterLevel: 260,
    minimumDamageCoverage: 0.995,
    maximumDamageCoverage: 1.005,
    minimumTimelineEntries: 3,
    minimumTimelineSpanRatio: 0.5,
    minimumResolvedDamageShare: 0.99,
    maximumReviewRequiredDamageShare: 0.001,
  });
  const originalByReplay = new Map(records.map((record) => [record.replayId, record]));
  const classes = [...new Set(prepared.records.map(({ characterClass }) =>
    characterClass
  ))].sort((left, right) => left.localeCompare(right, "ko"));
  const profiles = {};
  const reportClasses = {};
  for (const characterClass of classes) {
    const candidateSamples = prepared.records.filter((record) =>
      record.characterClass === characterClass
    ).map(({ replayId }) =>
      recordDurationCoverage(originalByReplay.get(replayId), dictionary)
    ).filter(Boolean);
    const samples = selectStablePhaseSamples(candidateSamples, 5);
    if (samples.length < 5) {
      reportClasses[characterClass] = {
        sampleCount: samples.length,
        status: "insufficient-samples",
      };
      continue;
    }
    const damageShareByDuration = Object.fromEntries(SUPPORTED_DURATIONS.map(
      (duration) => [
        duration,
        compact(median(samples.map(({ shares }) => shares[duration]))),
      ],
    ));
    const observedDamageShareByDuration = Object.fromEntries(
      SUPPORTED_DURATIONS.map((duration) => [
        duration,
        compact(median(samples.map(({ observedShares }) =>
          observedShares[duration]
        ))),
      ]),
    );
    const content = {
      schema: "maplestarforce.special-ring-phase-profile.v1",
      characterClass,
      sampleCount: samples.length,
      damageShareByDuration,
    };
    const profileHash = createHash("sha256")
      .update(JSON.stringify(content))
      .digest("hex");
    profiles[characterClass] = {
      id: `${characterClass}-special-ring-${profileHash.slice(0, 12)}`,
      profileHash,
      sampleCount: samples.length,
      basis: "battle-practice-restraint-timeline",
      damageShareByDuration,
    };
    reportClasses[characterClass] = {
      sampleCount: samples.length,
      status: "stable",
      damageShareByDuration,
      observedDamageShareByDuration,
      medianAbsoluteDeviationByDuration: Object.fromEntries(
        SUPPORTED_DURATIONS.map((duration) => [
          duration,
          compact(medianAbsoluteDeviation(samples.map(({ shares }) =>
            shares[duration]
          ))),
        ]),
      ),
      samples,
    };
  }
  const outputPath = resolve(text(options.output) ||
    "../maple-core/src/special-ring-phase-profiles.js");
  const reportPath = resolve(text(options.report) ||
    "tools/battle-practice-dataset/generated/special-ring-phase-profiles.report.json");
  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(outputPath, renderModule(profiles), "utf8");
  await writeFile(reportPath, `${JSON.stringify({
    schema: "maplestarforce.special-ring-phase-build-report.v1",
    generatedAt: new Date().toISOString(),
    inputs: inputPaths.map((path) => resolve(path)),
    dictionary: { path: dictionaryPath, contentHash: dictionary.contentHash },
    profileCount: Object.keys(profiles).length,
    rejectedRecordCount: prepared.rejected.length,
    classes: reportClasses,
  }, null, 2)}\n`, "utf8");
  console.log(`특수 반지 구간 프로필 ${Object.keys(profiles).length}직업 생성`);
  console.log(outputPath);
  console.log(reportPath);
}

await main();
