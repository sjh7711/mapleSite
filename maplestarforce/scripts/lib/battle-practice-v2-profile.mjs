import { createHash } from "node:crypto";
import {
  aggregateRawDamageProfiles,
  defenseDamageMultiplier,
  inferRawDamageShares,
  normalizedProfileSkillName,
} from "./defense-normalized-profile.mjs";
import {
  selectStableBattlePracticeRecords,
} from "./battle-practice-profile.mjs";
import { skillIdentity } from "./skill-dictionary.mjs";

export const BATTLE_PRACTICE_V2_SCHEMA =
  "maplestarforce.battle-practice-record.v2";

const MAX_PLAY_TIME_MILLISECONDS = 400_000;

function finiteNumber(value) {
  const parsed = Number(String(value ?? "").replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedText(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizedReferencePart(value) {
  return normalizedText(value).normalize("NFC");
}

export function battlePracticeReferenceKey(characterClass, characterName) {
  const className = normalizedReferencePart(characterClass);
  const name = normalizedReferencePart(characterName);
  return className && name ? `${className}\u001f${name}` : null;
}

function characterIdentityProvenance(candidate) {
  const provenance = candidate?.identityProvenance ?? candidate?.provenance;
  const directOcid = normalizedText(candidate?.ocid);
  const provenanceOcid = normalizedText(provenance?.ocid);
  const directCurrentName = normalizedText(candidate?.currentCharacterName);
  const provenanceCurrentName = normalizedText(provenance?.currentCharacterName);
  const directReplayName = normalizedText(candidate?.replayCharacterName);
  const provenanceReplayName = normalizedText(provenance?.replayCharacterName);
  const ocid = directOcid || provenanceOcid;
  const currentCharacterName = directCurrentName || provenanceCurrentName;
  const replayCharacterName = directReplayName || provenanceReplayName;
  const fieldsAgree = (
    (!directOcid || !provenanceOcid || directOcid === provenanceOcid) &&
    (
      !directCurrentName || !provenanceCurrentName ||
      directCurrentName === provenanceCurrentName
    ) &&
    (
      !directReplayName || !provenanceReplayName ||
      directReplayName === provenanceReplayName
    )
  );
  const explicitOcidChain =
    provenance?.method === "ocid-replay-id" &&
    fieldsAgree &&
    Boolean(ocid && currentCharacterName && replayCharacterName);
  const legacyEnrichmentChain =
    provenance?.kind === "legacy-result-context-enrichment" &&
    Boolean(normalizedText(candidate?.replayId)) &&
    normalizedText(candidate?.replayMetadata?.registerDate) ===
      normalizedText(candidate?.result?.register_date);
  return {
    ocid: ocid || null,
    currentCharacterName: currentCharacterName || null,
    replayCharacterName: replayCharacterName || null,
    explicitOcidChain,
    legacyEnrichmentChain,
  };
}

function candidateCharacterNames(candidate) {
  const provenance = characterIdentityProvenance(candidate);
  return [...new Set([
    candidate?.characterName,
    provenance.currentCharacterName,
    provenance.replayCharacterName,
    candidate?.characterInfo?.basic_object?.character_name,
  ].map(normalizedText).filter(Boolean))];
}

function baseSkillIdentity(value) {
  return skillIdentity(value)
    .replace(/(?:vi|v|iv|iii|ii)$/iu, "")
    .replace(/(?:강화|마스터리)$/u, "");
}

function rootSkillIdentity(value) {
  return baseSkillIdentity(value)
    .split(/[:：]/u)[0]
    .replace(/(?:vi|v|iv|iii|ii)$/iu, "");
}

function sameSkillFamily(left, right) {
  const leftIdentity = rootSkillIdentity(left);
  const rightIdentity = rootSkillIdentity(right);
  return Boolean(
    leftIdentity && rightIdentity &&
    (leftIdentity === rightIdentity ||
      (Math.min(leftIdentity.length, rightIdentity.length) >= 4 &&
        (leftIdentity.startsWith(rightIdentity) ||
          rightIdentity.startsWith(leftIdentity))))
  );
}

function combinedRatio(base, percentages) {
  return 1 - (percentages ?? []).reduce(
    (remaining, percent) => remaining *
      (1 - Math.max(0, Math.min(100, Number(percent) || 0)) / 100),
    1 - Math.max(0, Math.min(1, Number(base) || 0)),
  );
}

function combinedRemaining(percentages) {
  return (percentages ?? []).reduce(
    (remaining, percent) => remaining *
      (1 - Math.max(0, Math.min(100, Number(percent) || 0)) / 100),
    1,
  );
}

function finalStatRows(characterInfo) {
  const candidates = [
    characterInfo?.stat_object?.basic_stat_object?.final_stat,
    characterInfo?.stat_object?.final_stat,
    characterInfo?.basic_stat_object?.final_stat,
  ];
  return candidates.find(Array.isArray) ?? [];
}

export function extractBattlePracticeIgnoreDefense(characterInfo) {
  const row = finalStatRows(characterInfo).find(({ stat_name: statName }) =>
    normalizedText(statName).replaceAll(" ", "") === "방어율무시"
  );
  const percent = finiteNumber(row?.stat_value);
  if (percent === null || percent < 0 || percent > 100) return null;
  return percent / 100;
}

function characterSkills(characterInfo) {
  const rows = characterInfo?.skill_object?.character_skill;
  return Array.isArray(rows) ? rows : [];
}

function dictionaryClassPayload(dictionary, characterClass) {
  return dictionary?.classes?.[characterClass] ?? null;
}

function actualSkillIndex(characterInfo) {
  const result = new Map();
  for (const skill of characterSkills(characterInfo)) {
    const name = normalizedProfileSkillName(skill?.skill_name);
    const identity = skillIdentity(name);
    const level = Math.max(0, finiteNumber(skill?.skill_level) ?? 0);
    if (!name || !identity) continue;
    const current = result.get(identity);
    if (!current || level >= current.level) {
      result.set(identity, {
        name,
        identity,
        level,
        description: normalizedText(skill?.skill_description),
        effect: normalizedText(skill?.skill_effect),
      });
    }
  }
  return result;
}

function acquiredDictionarySkills(dictionaryClass, actualIndex) {
  return (dictionaryClass?.skills ?? []).map((skill) => {
    // Some skills change their API-visible name with the selected mode or
    // summon.  The static dictionary keeps one reviewed canonical entry and
    // records those exact variants as aliases (for example Pathfinder's
    // `에인션트 템페스트` / `레이븐 템페스트`).  Looking up only the
    // canonical name incorrectly treated a learned alias variant as
    // unlearned and could drop a material share of the replay.
    //
    // Keep this deliberately exact: reviewed aliases are safe acquisition
    // evidence, while fuzzy family matching is only used later to associate
    // an observed damage channel with an already acquired skill.
    const actual = entryNames(skill)
      .map((name) => actualIndex.get(skillIdentity(name)))
      .filter(Boolean)
      .sort((left, right) => right.level - left.level)[0];
    return actual && actual.level > 0 ? { skill, actual } : null;
  }).filter(Boolean);
}

function entryNames(skill) {
  return [
    skill?.name,
    ...(skill?.aliases ?? []),
    skill?.battlePractice?.matchedName,
  ].map(normalizedProfileSkillName).filter(Boolean);
}

const globalNoDefenseSkillIndexCache = new WeakMap();

function hasDefenseMechanicText(value) {
  return /방어율/u.test(`${value?.description ?? ""}\n${value?.effect ?? ""}`);
}

/**
 * Equipment/system attacks and stolen skills can appear in a replay even when
 * the five class snapshots used to build that class dictionary did not contain
 * them.  They are still safe as a general damage channel when an exact skill
 * definition elsewhere in the dictionary proves there is no defense mechanic.
 * Never use a fuzzy/family match here: an unmodelled IED line must stay
 * unresolved instead of silently being treated as ordinary damage.
 */
function globalNoDefenseSkillIndex(dictionary) {
  if (!dictionary || typeof dictionary !== "object") return new Map();
  const cached = globalNoDefenseSkillIndexCache.get(dictionary);
  if (cached) return cached;
  const candidates = new Map();
  const unsafe = new Set();
  for (const payload of Object.values(dictionary?.classes ?? {})) {
    for (const skill of payload?.skills ?? []) {
      const identity = skillIdentity(skill?.name);
      if (!identity) continue;
      const hasParsedDefense = Boolean(
        skill?.semantics?.reviewRequired ||
        skill?.semantics?.ignoreDefense?.length ||
        skill?.semantics?.externalIgnoreDefense?.length ||
        hasDefenseMechanicText(skill),
      );
      if (hasParsedDefense) {
        unsafe.add(identity);
        candidates.delete(identity);
      } else if (!unsafe.has(identity) && !candidates.has(identity)) {
        candidates.set(identity, skill);
      }
    }
  }
  globalNoDefenseSkillIndexCache.set(dictionary, candidates);
  return candidates;
}

function matchingDictionarySkills(
  observedName,
  acquired,
) {
  const observedIdentity = skillIdentity(observedName);
  const exact = acquired.filter(({ skill }) =>
    entryNames(skill).some((name) => skillIdentity(name) === observedIdentity)
  );
  const parent = acquired.filter(({ actual }) =>
    `${actual.description}\n${actual.effect}`.includes(observedName)
  );
  const family = acquired.filter(({ skill }) =>
    entryNames(skill).some((name) => sameSkillFamily(name, observedName))
  );
  const result = [];
  const seen = new Set();
  for (const entry of [...exact, ...parent, ...family]) {
    const identity = skillIdentity(entry.skill?.name);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    result.push(entry);
  }
  return {
    entries: result,
    exactCount: exact.length,
    parentCount: parent.length,
  };
}

function effectEligible(effect, actualLevel) {
  const requiredLevel = finiteNumber(effect?.requiredLevel);
  return requiredLevel === null || requiredLevel <= 0 ||
    actualLevel >= requiredLevel;
}

function directLocalEffect(skill, effect) {
  if (
    effect?.kind !== "ignore-defense" ||
    effect?.bossApplicable === false
  ) return false;
  if (effect.scope === "skill-local") return true;
  // 공식 문구의 `몬스터 방어율 N% 무시`가 공격 스킬 본문에 있으면
  // 일부 스냅샷 파서가 전역 효과로 분류한다. 지속/패시브가 아닌 실제
  // 공격 스킬의 효과는 해당 공격 채널 전용으로 되돌린다.
  return effect.scope === "character-global" &&
    skill?.semantics?.attack === true &&
    !skill?.semantics?.durationSeconds?.length &&
    !["baseline-passive", "timed", "toggle"].includes(effect?.activation);
}

function targetsObservedSkill(targetName, observedName, matchedEntries) {
  if (sameSkillFamily(targetName, observedName)) return true;
  return matchedEntries.some(({ skill }) =>
    entryNames(skill).some((name) => sameSkillFamily(targetName, name))
  );
}

function localEffectTargets(skill, effect) {
  const effectTargets = Array.isArray(effect?.targetSkillNames)
    ? effect.targetSkillNames
    : [];
  const skillTargets = Array.isArray(skill?.semantics?.targetSkillNames)
    ? skill.semantics.targetSkillNames
    : [];
  return (effectTargets.length ? effectTargets : skillTargets)
    .map(normalizedProfileSkillName).filter(Boolean);
}

function localEffectTargetsObserved(
  skill,
  effect,
  observedName,
  matchedEntries,
) {
  const explicitTargets = Array.isArray(effect?.targetSkillNames)
    ? effect.targetSkillNames.map(normalizedProfileSkillName).filter(Boolean)
    : [];
  const targets = explicitTargets.length
    ? explicitTargets
    : localEffectTargets(skill, effect);
  return targets.some((target) =>
    explicitTargets.length
      ? sameSkillFamily(target, observedName)
      : targetsObservedSkill(target, observedName, matchedEntries)
  );
}

function uniqueLocalEffects(rows) {
  const result = [];
  const seen = new Set();
  for (const row of rows) {
    const percent = finiteNumber(row?.effect?.percent);
    if (!(percent > 0)) continue;
    const evidence = normalizedText(row?.effect?.evidence)
      .replace(/\s+/gu, " ");
    const requiredLevel = finiteNumber(row?.effect?.requiredLevel) ?? 0;
    const key = [
      percent,
      requiredLevel,
      row?.effect?.aggregation,
      row?.effect?.maximumStacks,
      evidence,
    ].join("\u001f");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      percent,
      sourceSkill: row.sourceSkill,
      targetSkill: row.targetSkill ?? null,
      requiredLevel: requiredLevel || null,
      evidence,
      aggregation: normalizedText(row?.effect?.aggregation) || "independent",
      perStack: row?.effect?.perStack === true,
      maximumStacks: finiteNumber(row?.effect?.maximumStacks),
      maximumStackIncrease: finiteNumber(row?.effect?.maximumStackIncrease),
      aggregationTarget: normalizedProfileSkillName(
        row?.effect?.aggregationTarget ??
          row?.effect?.aggregation_target ??
          row?.effect?.aggregationTargetSkill ??
          row?.targetSkill,
      ) || null,
    });
  }
  return result;
}

/**
 * 스킬 사전이 선언한 합산 규칙을 실제 방무 source 배열로 컴파일한다.
 * `skill-base`와 `additive-to-skill`은 같은 스킬 버킷에서 퍼센트포인트로
 * 더하고, 명시되지 않은 효과는 독립 곱연산 source로 유지한다.
 */
export function compileIgnoreDefenseSources(effects, observedName) {
  const additive = new Map();
  const independent = [];
  for (const effect of effects ?? []) {
    const stackCount = effect?.perStack
      ? Math.max(1, Number(effect?.maximumStacks) || 1)
      : 1;
    const percent = Math.max(
      0,
      Math.min(100, (Number(effect?.percent) || 0) * stackCount),
    );
    if (!(percent > 0)) continue;
    const aggregation = normalizedText(effect?.aggregation) || "independent";
    if (
      aggregation === "skill-base" ||
      aggregation === "additive" ||
      aggregation.startsWith("additive-to-")
    ) {
      // 결과의 파생 공격명과 부모/강화 스킬명이 달라도 모두 이 피해
      // 채널에 적용되는 스킬 방무다. 결과 행 자체를 합산 버킷으로 삼는다.
      const key = skillIdentity(observedName) || "__observ-skill__";
      additive.set(key, Math.min(100, (additive.get(key) ?? 0) + percent));
      continue;
    }
    independent.push(percent);
  }
  return [
    ...additive.values(),
    ...independent,
  ];
}

export function createBattlePracticeSkillResolver({
  dictionary,
  characterClass,
  characterInfo,
}) {
  const dictionaryClass = dictionaryClassPayload(dictionary, characterClass);
  if (!dictionaryClass) return null;
  const actualIndex = actualSkillIndex(characterInfo);
  const acquired = acquiredDictionarySkills(dictionaryClass, actualIndex);
  const sharedNoDefenseSkills = globalNoDefenseSkillIndex(dictionary);

  const resolve = (observedValue) => {
    const observedName = normalizedProfileSkillName(observedValue);
    const matched = matchingDictionarySkills(observedName, acquired);
    const observedIdentity = skillIdentity(observedName);
    const exactActual = actualIndex.get(observedIdentity);
    const generalChannel = matched.entries.length
      ? null
      : exactActual?.level > 0 && !hasDefenseMechanicText(exactActual)
        ? {
            method: "actual-no-defense-mechanic",
            name: exactActual.name,
          }
        : sharedNoDefenseSkills.has(observedIdentity)
          ? {
              method: "shared-exact-no-defense-mechanic",
              name: sharedNoDefenseSkills.get(observedIdentity).name,
            }
          : null;
    const effects = [];
    for (const { skill, actual } of matched.entries) {
      for (const effect of skill?.semantics?.ignoreDefense ?? []) {
        const targets = localEffectTargets(skill, effect);
        if (
          targets.length &&
          !localEffectTargetsObserved(
            skill,
            effect,
            observedName,
            matched.entries,
          )
        ) continue;
        if (directLocalEffect(skill, effect) &&
          effectEligible(effect, actual.level)) {
          effects.push({
            effect,
            sourceSkill: skill.name,
            targetSkill: observedName,
          });
        }
      }
    }
    for (const { skill, actual } of acquired) {
      for (const effect of skill?.semantics?.ignoreDefense ?? []) {
        const targets = localEffectTargets(skill, effect);
        if (!localEffectTargetsObserved(
          skill,
          effect,
          observedName,
          matched.entries,
        )) continue;
        if (
          effect?.kind === "ignore-defense" &&
          ["skill-local", "target-skill"].includes(effect?.scope) &&
          effect?.bossApplicable !== false &&
          effectEligible(effect, actual.level)
        ) effects.push({
          effect,
          sourceSkill: skill.name,
          targetSkill: targets.find((target) =>
            targetsObservedSkill(target, observedName, matched.entries)
          ) ?? observedName,
        });
      }
    }
    const localEffects = uniqueLocalEffects(effects);
    return {
      observedName,
      resolved: matched.entries.length > 0 || generalChannel !== null,
      matchedSkillNames: matched.entries.length
        ? matched.entries.map(({ skill }) => skill.name)
        : generalChannel
          ? [generalChannel.name]
          : [],
      resolutionMethod: generalChannel?.method ?? (
        matched.exactCount > 0
          ? "class-dictionary-exact"
          : matched.parentCount > 0
            ? "class-dictionary-parent-text"
            : matched.entries.length
              ? "class-dictionary-family"
              : null
      ),
      exactMatch: matched.exactCount > 0,
      inheritedFromDescription: matched.parentCount > 0,
      reviewRequired: matched.entries.some(({ skill }) =>
        skill?.semantics?.reviewRequired
      ),
      localIgnoreDefenseSources: compileIgnoreDefenseSources(
        localEffects,
        observedName,
      ),
      localEffects,
    };
  };

  return {
    dictionaryClass,
    actualIndex,
    acquired,
    resolve,
  };
}

function normalizedTimeline(candidate, playTime) {
  const payload = candidate?.skillTimeline;
  const totalPageNo = finiteNumber(payload?.totalPageNo);
  const rows = Array.isArray(payload?.entries) ? payload.entries : [];
  const normalized = rows.map((row) => ({
    elapsed: finiteNumber(row?.elapse_time),
    name: normalizedProfileSkillName(row?.skill_name),
    sequenceName: normalizedText(row?.sequence_name) || null,
    sequenceKey: normalizedText(row?.sequence_key) || null,
  })).filter(({ elapsed, name }) =>
    elapsed !== null && elapsed >= 0 && elapsed <= playTime + 1_000 && name
  );
  const wasReordered = normalized.some((row, index) =>
    index > 0 && row.elapsed < normalized[index - 1].elapsed
  );
  normalized.sort((left, right) => left.elapsed - right.elapsed ||
    left.name.localeCompare(right.name, "ko"));
  return { rows: normalized, totalPageNo, wasReordered };
}

function dynamicDefenseEffects(resolver, timelineRows, playTime) {
  const result = [];
  for (const { skill, actual } of resolver.acquired) {
    const durationSeconds = Math.max(
      0,
      ...(skill?.semantics?.durationSeconds ?? []).map(Number),
    );
    if (!(durationSeconds > 0)) continue;
    const castNames = new Set(entryNames(skill).map(skillIdentity));
    const casts = timelineRows.filter(({ name }) =>
      castNames.has(skillIdentity(name))
    ).map(({ elapsed }) => elapsed);
    if (!casts.length) continue;
    const effects = [];
    for (const effect of skill?.semantics?.ignoreDefense ?? []) {
      if (
        effect?.bossApplicable === false ||
        !effectEligible(effect, actual.level) ||
        !["character-global", "target"].includes(effect?.scope)
      ) continue;
      const percent = finiteNumber(effect?.percent);
      if (!(percent > 0)) continue;
      effects.push({
        kind: effect.kind,
        scope: effect.scope,
        percent,
      });
    }
    // 자기/파티 효과가 같은 수치로 두 번 적힌 스킬은 캐릭터에게 한 번만
    // 적용한다. 서로 다른 수치나 서로 다른 스킬은 독립 곱연산이다.
    const uniqueEffects = [...new Map(effects.map((effect) => [
      `${effect.kind}\u001f${effect.scope}\u001f${effect.percent}`,
      effect,
    ])).values()];
    for (const effect of uniqueEffects) {
      result.push({
        ...effect,
        sourceSkill: skill.name,
        intervals: casts.map((start) => ({
          start,
          end: Math.min(playTime, start + durationSeconds * 1_000),
        })).filter(({ start, end }) => end > start),
      });
    }
  }
  return result.filter(({ intervals }) => intervals.length);
}

function effectActiveAt(effect, elapsed) {
  return effect.intervals.some(({ start, end }) =>
    elapsed >= start && elapsed < end
  );
}

function defenseMultiplierAt({
  elapsed,
  donorGlobalIgnoreDefense,
  localIgnoreDefenseSources,
  dynamicEffects,
  enemyDefense,
}) {
  const globalSources = dynamicEffects.filter((effect) =>
    effect.scope === "character-global" && effectActiveAt(effect, elapsed)
  ).map(({ percent }) => percent);
  const targetSources = dynamicEffects.filter((effect) =>
    (effect.scope === "target" || effect.kind === "target-defense-reduction") &&
    effectActiveAt(effect, elapsed)
  ).map(({ percent }) => percent);
  return defenseDamageMultiplier({
    globalIgnoreDefense: combinedRatio(
      donorGlobalIgnoreDefense,
      globalSources,
    ),
    localIgnoreDefenseSources,
    targetDefenseRemaining: combinedRemaining(targetSources),
    enemyDefense,
  });
}

function timelineTimesForSkill(observedName, timelineRows) {
  const identity = skillIdentity(observedName);
  return timelineRows.filter(({ name }) => skillIdentity(name) === identity)
    .map(({ elapsed }) => elapsed);
}

function timeWeightedDefenseMultiplier({
  playTime,
  donorGlobalIgnoreDefense,
  localIgnoreDefenseSources,
  dynamicEffects,
  enemyDefense,
}) {
  if (!dynamicEffects.length) {
    return defenseDamageMultiplier({
      globalIgnoreDefense: donorGlobalIgnoreDefense,
      localIgnoreDefenseSources,
      enemyDefense,
    });
  }
  const boundaries = new Set([0, playTime]);
  for (const effect of dynamicEffects) {
    for (const { start, end } of effect.intervals) {
      boundaries.add(Math.max(0, Math.min(playTime, start)));
      boundaries.add(Math.max(0, Math.min(playTime, end)));
    }
  }
  const sorted = [...boundaries].sort((left, right) => left - right);
  let total = 0;
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index];
    const end = sorted[index + 1];
    if (!(end > start)) continue;
    total += (end - start) * defenseMultiplierAt({
      elapsed: (start + end) / 2,
      donorGlobalIgnoreDefense,
      localIgnoreDefenseSources,
      dynamicEffects,
      enemyDefense,
    });
  }
  return playTime > 0 ? total / playTime : 0;
}

function channelDefenseMultiplier({
  observedName,
  timelineRows,
  playTime,
  donorGlobalIgnoreDefense,
  localIgnoreDefenseSources,
  dynamicEffects,
  enemyDefense,
}) {
  const times = timelineTimesForSkill(observedName, timelineRows);
  if (!times.length) {
    return {
      multiplier: timeWeightedDefenseMultiplier({
        playTime,
        donorGlobalIgnoreDefense,
        localIgnoreDefenseSources,
        dynamicEffects,
        enemyDefense,
      }),
      context: dynamicEffects.length ? "fight-time-weighted" : "static",
      eventCount: 0,
    };
  }
  const sum = times.reduce((total, elapsed) => total + defenseMultiplierAt({
    elapsed,
    donorGlobalIgnoreDefense,
    localIgnoreDefenseSources,
    dynamicEffects,
    enemyDefense,
  }), 0);
  return {
    multiplier: sum / times.length,
    context: dynamicEffects.length ? "exact-cast-time" : "static",
    eventCount: times.length,
  };
}

function normalizedDamageRows(result) {
  const statistics = Array.isArray(result?.skill_statistic)
    ? result.skill_statistic
    : [];
  const grouped = new Map();
  for (const row of statistics) {
    const source = normalizedProfileSkillName(row?.skill_name);
    const damage = finiteNumber(row?.damage);
    if (!source || damage === null || !(damage > 0)) continue;
    const current = grouped.get(source) ?? {
      source,
      damage: 0,
      useCount: 0,
      attackCount: 0,
    };
    current.damage += damage;
    current.useCount += Math.max(0, finiteNumber(row?.use_count) ?? 0);
    current.attackCount += Math.max(0, finiteNumber(row?.attack_count) ?? 0);
    grouped.set(source, current);
  }
  const damageSum = [...grouped.values()].reduce(
    (sum, row) => sum + row.damage,
    0,
  );
  return {
    rows: [...grouped.values()].sort((left, right) =>
      right.damage - left.damage || left.source.localeCompare(right.source, "ko")
    ),
    damageSum,
  };
}

function issue(code, detail = null) {
  return detail === null ? { code } : { code, detail };
}

function issueCodes(issues) {
  return issues.map(({ code }) => code);
}

export function validateBattlePracticeV2Record(candidate, {
  dictionary,
  enemyDefense = 3.8,
  minimumCharacterLevel = 260,
  minimumDamageCoverage = 0.995,
  maximumDamageCoverage = 1.005,
  minimumTimelineEntries = 3,
  minimumTimelineSpanRatio = 0.5,
  minimumResolvedDamageShare = 0.99,
  maximumReviewRequiredDamageShare = 0.001,
} = {}) {
  const errors = [];
  const warnings = [];
  if (candidate?.schema !== BATTLE_PRACTICE_V2_SCHEMA) {
    errors.push(issue("unsupported-schema", candidate?.schema ?? null));
  }
  const replayId = normalizedText(candidate?.replayId);
  if (!replayId) errors.push(issue("missing-replay-id"));

  const characterClass = normalizedText(candidate?.characterClass);
  const declaredCharacterName = normalizedText(candidate?.characterName);
  const basic = candidate?.characterInfo?.basic_object;
  const infoClass = normalizedText(basic?.character_class);
  const infoName = normalizedText(basic?.character_name);
  const identityProvenance = characterIdentityProvenance(candidate);
  const currentCharacterName =
    identityProvenance.currentCharacterName ?? declaredCharacterName;
  const replayCharacterName =
    identityProvenance.replayCharacterName ?? infoName;
  const provenRename = Boolean(
    infoName &&
    declaredCharacterName &&
    infoName !== declaredCharacterName &&
    (
      (
        identityProvenance.explicitOcidChain &&
        currentCharacterName === declaredCharacterName &&
        replayCharacterName === infoName
      ) ||
      identityProvenance.legacyEnrichmentChain
    )
  );
  const characterName = provenRename ? infoName : declaredCharacterName;
  const characterLevel = finiteNumber(basic?.character_level);
  if (!characterClass || !declaredCharacterName) {
    errors.push(issue("missing-character-reference"));
  }
  if (!basic || !infoClass || !infoName) {
    errors.push(issue("missing-character-info"));
  } else {
    if (characterClass !== infoClass) {
      errors.push(issue("character-class-mismatch", {
        declared: characterClass,
        characterInfo: infoClass,
      }));
    }
    if (declaredCharacterName !== infoName) {
      const detail = {
        declared: declaredCharacterName,
        characterInfo: infoName,
        ocid: identityProvenance.ocid,
      };
      if (provenRename) {
        warnings.push(issue("character-name-changed", detail));
      } else {
        errors.push(issue("character-name-mismatch", detail));
      }
    } else if (
      identityProvenance.explicitOcidChain &&
      currentCharacterName !== replayCharacterName &&
      replayCharacterName === infoName
    ) {
      warnings.push(issue("character-name-changed", {
        declared: currentCharacterName,
        characterInfo: infoName,
        ocid: identityProvenance.ocid,
      }));
    }
  }
  if (characterLevel === null || characterLevel < minimumCharacterLevel) {
    errors.push(issue("character-level-below-minimum", {
      actual: characterLevel,
      minimum: minimumCharacterLevel,
    }));
  }

  const result = candidate?.result;
  const playTime = finiteNumber(result?.total_play_time);
  if (String(result?.end_type ?? "") !== "1") {
    errors.push(issue("not-auto-ended", result?.end_type ?? null));
  }
  if (
    playTime === null || !(playTime > 0) ||
    playTime > MAX_PLAY_TIME_MILLISECONDS
  ) errors.push(issue("invalid-play-time", playTime));
  const totalDamage = finiteNumber(result?.total_damage);
  const damage = normalizedDamageRows(result);
  if (totalDamage === null || !(totalDamage > 0) || !damage.rows.length) {
    errors.push(issue("missing-positive-damage"));
  }
  const damageCoverage = totalDamage && damage.damageSum
    ? damage.damageSum / totalDamage
    : null;
  if (
    damageCoverage === null || damageCoverage < minimumDamageCoverage ||
    damageCoverage > maximumDamageCoverage
  ) errors.push(issue("damage-total-mismatch", {
    coverage: damageCoverage,
    minimum: minimumDamageCoverage,
    maximum: maximumDamageCoverage,
  }));

  const donorGlobalIgnoreDefense = extractBattlePracticeIgnoreDefense(
    candidate?.characterInfo,
  );
  if (donorGlobalIgnoreDefense === null) {
    errors.push(issue("missing-or-invalid-ignore-defense"));
  }
  if (!(Number(enemyDefense) > 0)) {
    errors.push(issue("invalid-enemy-defense", enemyDefense));
  }

  const safePlayTime = playTime && playTime > 0 ? playTime : 1;
  const timeline = normalizedTimeline(candidate, safePlayTime);
  const declaredTimelineRows = Array.isArray(candidate?.skillTimeline?.entries)
    ? candidate.skillTimeline.entries.length
    : 0;
  if (!(timeline.totalPageNo >= 1)) {
    errors.push(issue("missing-timeline-page-count"));
  }
  if (timeline.rows.length < minimumTimelineEntries) {
    errors.push(issue("timeline-too-short", {
      actual: timeline.rows.length,
      minimum: minimumTimelineEntries,
    }));
  }
  if (timeline.rows.length !== declaredTimelineRows) {
    errors.push(issue("invalid-timeline-entry", {
      declared: declaredTimelineRows,
      valid: timeline.rows.length,
    }));
  }
  const maximumTimelineElapsed = timeline.rows.length
    ? timeline.rows.at(-1).elapsed
    : 0;
  const timelineSpanRatio = maximumTimelineElapsed / safePlayTime;
  if (timelineSpanRatio < minimumTimelineSpanRatio) {
    errors.push(issue("timeline-does-not-span-record", {
      actual: timelineSpanRatio,
      minimum: minimumTimelineSpanRatio,
    }));
  }

  const resolver = createBattlePracticeSkillResolver({
    dictionary,
    characterClass,
    characterInfo: candidate?.characterInfo,
  });
  if (!resolver) {
    errors.push(issue("missing-class-skill-dictionary", characterClass));
  }

  let resolvedDamageShare = 0;
  let reviewRequiredDamageShare = 0;
  const resolution = [];
  if (resolver && damage.damageSum > 0) {
    for (const row of damage.rows) {
      const share = row.damage / damage.damageSum;
      const resolved = resolver.resolve(row.source);
      if (resolved.resolved) resolvedDamageShare += share;
      if (resolved.reviewRequired) reviewRequiredDamageShare += share;
      resolution.push({ ...resolved, damageShare: share });
    }
    if (resolvedDamageShare < minimumResolvedDamageShare) {
      errors.push(issue("skill-dictionary-coverage-too-low", {
        actual: resolvedDamageShare,
        minimum: minimumResolvedDamageShare,
      }));
    }
    if (reviewRequiredDamageShare > maximumReviewRequiredDamageShare) {
      errors.push(issue("review-required-skill-share-too-high", {
        actual: reviewRequiredDamageShare,
        maximum: maximumReviewRequiredDamageShare,
      }));
    }
  }

  if (timeline.wasReordered) {
    warnings.push(issue("timeline-order-normalized"));
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    errorCodes: issueCodes(errors),
    characterClass,
    characterName,
    declaredCharacterName,
    currentCharacterName,
    replayCharacterName,
    ocid: identityProvenance.ocid,
    identityKey: identityProvenance.ocid
      ? `ocid:${identityProvenance.ocid}`
      : battlePracticeReferenceKey(characterClass, characterName),
    referenceKeys: candidateCharacterNames(candidate)
      .map((name) => battlePracticeReferenceKey(characterClass, name))
      .filter(Boolean),
    referenceKey: battlePracticeReferenceKey(characterClass, characterName),
    replayId,
    registerDate: normalizedText(
      result?.register_date ?? candidate?.replayMetadata?.registerDate,
    ) || null,
    collectedAt: normalizedText(candidate?.collectedAt) || null,
    characterLevel,
    playTimeMilliseconds: playTime,
    totalDamage,
    damageRows: damage.rows,
    damageCoverage,
    donorGlobalIgnoreDefense,
    timeline: timeline.rows,
    timelineSpanRatio,
    resolvedDamageShare,
    reviewRequiredDamageShare,
    resolution,
    resolver,
  };
}

export function normalizeDefenseNormalizedDonorRecord(candidate, options = {}) {
  const validation = validateBattlePracticeV2Record(candidate, options);
  if (!validation.ok) return { record: null, validation };
  const enemyDefense = Number(options.enemyDefense ?? 3.8);
  const dynamicEffects = dynamicDefenseEffects(
    validation.resolver,
    validation.timeline,
    validation.playTimeMilliseconds,
  );
  const resolutionByName = new Map(validation.resolution.map((row) => [
    row.observedName,
    row,
  ]));
  const observedChannels = validation.damageRows.map((row) => {
    const resolved = resolutionByName.get(row.source);
    const localIgnoreDefenseSources =
      resolved?.localIgnoreDefenseSources ?? [];
    const context = channelDefenseMultiplier({
      observedName: row.source,
      timelineRows: validation.timeline,
      playTime: validation.playTimeMilliseconds,
      donorGlobalIgnoreDefense: validation.donorGlobalIgnoreDefense,
      localIgnoreDefenseSources,
      dynamicEffects,
      enemyDefense,
    });
    return {
      source: row.source,
      weight: row.damage / validation.damageRows.reduce(
        (sum, entry) => sum + entry.damage,
        0,
      ),
      localIgnoreDefenseSources,
      donorDefenseMultiplier: context.multiplier,
      timelineContext: context.context,
      timelineEventCount: context.eventCount,
    };
  });
  let rawChannels;
  try {
    rawChannels = inferRawDamageShares({
      observedChannels,
      donorGlobalIgnoreDefense: validation.donorGlobalIgnoreDefense,
      enemyDefense,
    });
  } catch (error) {
    validation.errors.push(issue(
      "defense-inversion-failed",
      error instanceof Error ? error.message : String(error),
    ));
    validation.errorCodes = issueCodes(validation.errors);
    validation.ok = false;
    return { record: null, validation };
  }
  const contextCounts = observedChannels.reduce((counts, channel) => {
    counts[channel.timelineContext] =
      (counts[channel.timelineContext] ?? 0) + 1;
    return counts;
  }, {});
  return {
    validation,
    record: {
      characterClass: validation.characterClass,
      characterName: validation.characterName,
      referenceKey: validation.referenceKey,
      referenceKeys: validation.referenceKeys,
      identityKey: validation.identityKey,
      ocid: validation.ocid,
      replayId: validation.replayId,
      registerDate: validation.registerDate,
      collectedAt: validation.collectedAt,
      playTimeMilliseconds: validation.playTimeMilliseconds,
      rawChannels,
      quality: {
        damageCoverage: validation.damageCoverage,
        timelineSpanRatio: validation.timelineSpanRatio,
        resolvedDamageShare: validation.resolvedDamageShare,
        reviewRequiredDamageShare: validation.reviewRequiredDamageShare,
        dynamicDefenseEffectCount: dynamicEffects.length,
        timelineContextCounts: contextCounts,
        warningCodes: validation.warnings.map(({ code }) => code),
      },
    },
  };
}

function collectReferenceLike(value, target, visited) {
  if (!value || typeof value !== "object" || visited.has(value)) return;
  visited.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) collectReferenceLike(entry, target, visited);
    return;
  }
  const characterClass = value.characterClass ?? value.apiClass;
  for (const characterName of candidateCharacterNames(value)) {
    const key = battlePracticeReferenceKey(characterClass, characterName);
    if (key) target.characterKeys.add(key);
  }
  const replayId = normalizedText(value.replayId ?? value.replay_id);
  if (replayId) target.replayIds.add(replayId);
  const ocid = characterIdentityProvenance(value).ocid ??
    normalizedText(value.ocid);
  if (ocid) target.ocids.add(ocid);
  for (const child of Object.values(value)) {
    collectReferenceLike(child, target, visited);
  }
}

export function collectHoldoutReferences(payloads) {
  const target = {
    characterKeys: new Set(),
    replayIds: new Set(),
    ocids: new Set(),
  };
  for (const payload of payloads ?? []) {
    collectReferenceLike(payload, target, new Set());
  }
  return target;
}

function newestRecord(left, right) {
  const leftKey = `${left.registerDate ?? ""}\u001f${left.collectedAt ?? ""}`;
  const rightKey = `${right.registerDate ?? ""}\u001f${right.collectedAt ?? ""}`;
  return rightKey.localeCompare(leftKey) > 0 ? right : left;
}

export function prepareDefenseNormalizedDonorRecords(candidates, {
  holdoutReferences = {
    characterKeys: new Set(),
    replayIds: new Set(),
    ocids: new Set(),
  },
  failOnHoldoutLeakage = true,
  ...validationOptions
} = {}) {
  const rejected = [];
  const normalized = [];
  const leakage = [];
  for (const candidate of candidates ?? []) {
    const characterClass = normalizedText(candidate?.characterClass);
    const referenceKeys = candidateCharacterNames(candidate)
      .map((name) => battlePracticeReferenceKey(characterClass, name))
      .filter(Boolean);
    const referenceKey = referenceKeys[0] ?? null;
    const replayId = normalizedText(candidate?.replayId);
    const ocid = characterIdentityProvenance(candidate).ocid;
    const overlapReasons = [];
    if (referenceKeys.some((key) =>
      holdoutReferences.characterKeys?.has(key)
    )) {
      overlapReasons.push("holdout-character-overlap");
    }
    if (replayId && holdoutReferences.replayIds?.has(replayId)) {
      overlapReasons.push("holdout-replay-overlap");
    }
    if (ocid && holdoutReferences.ocids?.has(ocid)) {
      overlapReasons.push("holdout-ocid-overlap");
    }
    if (overlapReasons.length) {
      const row = { referenceKey, replayId, ocid, reasons: overlapReasons };
      leakage.push(row);
      rejected.push(row);
      continue;
    }
    const result = normalizeDefenseNormalizedDonorRecord(
      candidate,
      validationOptions,
    );
    if (!result.record) {
      rejected.push({
        referenceKey,
        replayId,
        ocid,
        reasons: result.validation.errorCodes,
        warnings: result.validation.warnings.map(({ code }) => code),
      });
      continue;
    }
    normalized.push(result.record);
  }
  if (leakage.length && failOnHoldoutLeakage) {
    const error = new Error(
      `학습 표본과 holdout이 ${leakage.length}건 겹칩니다. ` +
      "별도 캐릭터/리플레이로 다시 수집하세요.",
    );
    error.code = "HOLDOUT_LEAKAGE";
    error.leakage = leakage;
    throw error;
  }

  const replayOwners = new Map();
  for (const record of normalized) {
    const owner = replayOwners.get(record.replayId);
    if (owner && owner !== record.identityKey) {
      const error = new Error(
        `리플레이 ${record.replayId}가 서로 다른 캐릭터에 연결되어 있습니다.`,
      );
      error.code = "REPLAY_IDENTITY_COLLISION";
      throw error;
    }
    replayOwners.set(record.replayId, record.identityKey);
  }

  const byCharacter = new Map();
  for (const record of normalized) {
    const current = byCharacter.get(record.identityKey);
    byCharacter.set(
      record.identityKey,
      current ? newestRecord(current, record) : record,
    );
  }
  const unique = [...byCharacter.values()];
  return {
    records: unique,
    rejected,
    leakage,
    duplicateCount: normalized.length - unique.length,
    candidateCount: (candidates ?? []).length,
  };
}

function finiteMedian(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function compactWeight(value) {
  return Number(Number(value).toPrecision(13));
}

function finalizeRawProfile(characterClass, profile) {
  const content = {
    schema: "maplestarforce.defense-normalized-damage-profile.v1",
    characterClass,
    enemyDefense: profile.enemyDefense,
    sampleCount: profile.sampleCount,
    dictionaryContentHash: profile.dictionaryContentHash ?? null,
    skillShares: profile.skillShares.map((row) => ({
      source: row.source,
      weight: compactWeight(row.weight),
      ...(row.ignoreDefenseSources?.length
        ? { ignoreDefenseSources: row.ignoreDefenseSources }
        : {}),
    })),
  };
  const profileHash = createHash("sha256")
    .update(JSON.stringify(content))
    .digest("hex");
  return {
    ...profile,
    skillProfileHash: profileHash,
    profileHash,
    id: `${characterClass}-raw-cycle-${profileHash.slice(0, 12)}`,
  };
}

export function buildDefenseNormalizedClassProfile(
  characterClass,
  donorRecords,
  {
    minimumSamples = 5,
    maximumSamples = 5,
    minimumSkillShare = 0.0001,
    maximumMedianPairDistance = 0.12,
    dictionaryContentHash = null,
    enemyDefense = 3.8,
  } = {},
) {
  const classRecords = (donorRecords ?? []).filter((record) =>
    record.characterClass === characterClass
  );
  const pseudoRecords = classRecords.map((record) => ({
    characterClass,
    characterName: record.characterName,
    result: {
      end_type: "1",
      total_play_time: record.playTimeMilliseconds,
      register_date: record.registerDate,
      skillShares: record.rawChannels.map((channel) => ({
        source: channel.source,
        weight: channel.rawWeight,
      })),
    },
  }));
  const selection = selectStableBattlePracticeRecords(pseudoRecords, {
    minSamples: minimumSamples,
    maxSamples: maximumSamples,
    maximumMedianPairDistance,
  });
  const acceptedKeys = new Set(selection.accepted.map((record) =>
    battlePracticeReferenceKey(characterClass, record.characterName)
  ));
  const accepted = classRecords.filter((record) =>
    acceptedKeys.has(record.referenceKey)
  );
  if (!selection.stable || accepted.length < minimumSamples) {
    return { profile: null, selection, accepted };
  }
  const aggregate = aggregateRawDamageProfiles(
    accepted.map(({ rawChannels }) => rawChannels),
  );
  const retained = aggregate.filter(({ rawWeight }) =>
    rawWeight >= minimumSkillShare
  );
  const retainedTotal = retained.reduce((sum, row) => sum + row.rawWeight, 0);
  const skillShares = retained.map((row) => ({
    source: row.source,
    weight: retainedTotal > 0 ? row.rawWeight / retainedTotal : 0,
    ignoreDefenseSources: row.localIgnoreDefenseSources,
  }));
  const dates = accepted.map(({ registerDate }) => registerDate)
    .filter(Boolean).sort();
  const profile = finalizeRawProfile(characterClass, {
    aggregation: "mean-defense-normalized-raw-share",
    shareBasis: "pre-defense",
    enemyDefense,
    dictionaryContentHash,
    stable: true,
    sampleCount: accepted.length,
    candidateCount: classRecords.length,
    rejectedCount: classRecords.length - accepted.length,
    medianPairDistance: selection.medianPairDistance,
    maximumPairDistance: selection.maximumPairDistance,
    droppedDamageShare: Math.max(0, 1 - retainedTotal),
    recordDateRange: dates.length
      ? { from: dates[0], to: dates.at(-1) }
      : null,
    quality: {
      minimumResolvedDamageShare: Math.min(
        ...accepted.map(({ quality }) => quality.resolvedDamageShare),
      ),
      medianResolvedDamageShare: finiteMedian(
        accepted.map(({ quality }) => quality.resolvedDamageShare),
      ),
      medianTimelineSpanRatio: finiteMedian(
        accepted.map(({ quality }) => quality.timelineSpanRatio),
      ),
      maximumReviewRequiredDamageShare: Math.max(
        ...accepted.map(({ quality }) => quality.reviewRequiredDamageShare),
      ),
      medianDynamicDefenseEffectCount: finiteMedian(
        accepted.map(({ quality }) => quality.dynamicDefenseEffectCount),
      ),
      timelineContextCounts: accepted.reduce((counts, record) => {
        for (const [context, count] of Object.entries(
          record.quality?.timelineContextCounts ?? {},
        )) counts[context] = (counts[context] ?? 0) + count;
        return counts;
      }, {}),
    },
    skillShares,
  });
  return { profile, selection, accepted };
}

export function compactDefenseNormalizedProfile(profile) {
  return {
    id: profile.id,
    skillProfileHash: profile.skillProfileHash,
    profileHash: profile.profileHash,
    sampleCount: profile.sampleCount,
    enemyDefense: profile.enemyDefense,
    shareBasis: "pre-defense",
    skillShares: profile.skillShares.map((row) => ({
      source: row.source,
      weight: compactWeight(row.weight),
      ...(row.ignoreDefenseSources?.length
        ? { ignoreDefenseSources: row.ignoreDefenseSources }
        : {}),
    })),
  };
}

export function renderDefenseNormalizedProfilesModule(profiles) {
  const compact = Object.fromEntries(Object.entries(profiles ?? {})
    .sort(([left], [right]) => left.localeCompare(right, "ko"))
    .map(([characterClass, profile]) => [
      characterClass,
      compactDefenseNormalizedProfile(profile),
    ]));
  return [
    "// 자동 생성 파일: 원본 캐릭터/리플레이 정보는 포함하지 않습니다.",
    `const profiles = ${JSON.stringify(compact, null, 2)};`,
    "",
    "export const CLASS_BATTLE_PRACTICE_DAMAGE_PROFILES = Object.freeze(profiles);",
    "export const CLASS_DEFENSE_NORMALIZED_DAMAGE_PROFILES = CLASS_BATTLE_PRACTICE_DAMAGE_PROFILES;",
    "",
    "export function classBattlePracticeDamageProfile(characterClass) {",
    "  return CLASS_BATTLE_PRACTICE_DAMAGE_PROFILES[String(characterClass ?? \"\").trim()] ?? null;",
    "}",
    "",
  ].join("\n");
}
