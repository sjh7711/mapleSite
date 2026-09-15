import { resolveCombatSourceLedger } from "./combat-source-ledger.js";

const COMBAT_NUMERIC_FIELDS = Object.freeze([
  "flatAttack",
  "attackPercent",
  "damage",
  "bossDamage",
  "criticalRate",
  "criticalDamage",
]);

const COMBAT_LAYER_ORDER = Object.freeze([
  "baseline",
  "general",
  "common-skill",
  "class-skill",
  "target",
]);

function number(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function withoutSixthMasteryMarker(value) {
  return String(value ?? "")
    .replace(/\s+VI(?=\s*(?:[:：(（]|$))/gu, "")
    .trim();
}

function isSixthMasterySkillName(value) {
  const name = String(value ?? "").trim();
  return Boolean(name) && withoutSixthMasteryMarker(name) !== name;
}

function normalizedLayer(value) {
  return new Set(COMBAT_LAYER_ORDER).has(value)
    ? value
    : "general";
}

function normalizedModifiers(source = {}) {
  const result = Object.fromEntries(
    COMBAT_NUMERIC_FIELDS.map((field) => [field, number(source[field])]),
  );
  result.ignoreDefenseSources = (
    Array.isArray(source.ignoreDefenseSources)
      ? source.ignoreDefenseSources
      : [source.ignoreDefense]
  )
    .map(number)
    .filter((value) => value > 0 && value <= 100);
  return result;
}

function normalizedIgnoreDefenseSources(source) {
  return (Array.isArray(source) ? source : [source])
    .map(number)
    .filter((value) => value > 0 && value <= 100);
}

/**
 * 특정 공격군에만 붙는 방무를 전역 방무와 분리한다. `weight`는 해당
 * 공격군이 방어율 적용 전 총 데미지에서 차지하는 비율이며, 공식 회전
 * 자료로 확인하지 못한 경우 null로 둬 계산에 임의로 끼워 넣지 않는다.
 */
export function createDamageChannel({
  source,
  weight = null,
  ignoreDefenseSources = [],
  metadata = null,
} = {}) {
  const parsedWeight = Number(weight);
  return {
    source: String(source ?? "").trim() || "기본 공격군",
    weight: weight !== null && weight !== undefined &&
        Number.isFinite(parsedWeight) && parsedWeight >= 0
      ? parsedWeight
      : null,
    ignoreDefenseSources: normalizedIgnoreDefenseSources(ignoreDefenseSources),
    metadata,
  };
}

function normalizedDamageChannels(channels) {
  const normalized = (channels ?? []).map(createDamageChannel);
  const weighted = normalized.filter((channel) => channel.weight !== null);
  const weightTotal = weighted.reduce((sum, channel) => sum + channel.weight, 0);
  if (!(weightTotal > 0)) return normalized;
  return normalized.map((channel) => channel.weight === null
    ? channel
    : { ...channel, weight: channel.weight / weightTotal });
}

function remainingDefenseFromSources(sources) {
  return normalizedIgnoreDefenseSources(sources).reduce(
    (remaining, value) => remaining * (1 - value / 100),
    1,
  );
}

function channelDamageMultiplier({
  channel,
  defense,
  globalRemaining,
  addedRemaining = 1,
}) {
  const localRemaining = remainingDefenseFromSources(
    channel.ignoreDefenseSources,
  );
  return Math.max(
    0,
    1 - defense * globalRemaining * addedRemaining * localRemaining,
  );
}

/**
 * 전역 방무 잠재가 모든 공격군에 추가됐을 때의 실제 데미지 증가율을
 * 계산한다. 가중치가 없는 발견 항목은 진단 자료일 뿐 계산에는 쓰지 않는다.
 */
export function calculateDamageChannelIgnoreDefenseGain({
  currentIgnoreDefense,
  addedIgnoreDefense,
  enemyDefense,
  channels = [],
} = {}) {
  const globalRemaining = Math.max(0, Math.min(1, 1 - number(currentIgnoreDefense)));
  const addedRemaining = Math.max(0, Math.min(1, 1 - number(addedIgnoreDefense)));
  const defense = Math.max(0, number(enemyDefense));
  const weighted = normalizedDamageChannels(channels)
    .filter((channel) => channel.weight !== null && channel.weight > 0);
  const effectiveChannels = weighted.length
    ? weighted
    : [createDamageChannel({ source: "기본 공격군", weight: 1 })];
  const observedDamageWeights = effectiveChannels.every(
    (channel) => channel.metadata?.weightBasis === "observed-damage",
  );
  if (observedDamageWeights) {
    let ratio = 0;
    for (const channel of effectiveChannels) {
      const before = channelDamageMultiplier({
        channel,
        defense,
        globalRemaining,
      });
      if (!(before > 0)) return 0;
      const after = channelDamageMultiplier({
        channel,
        defense,
        globalRemaining,
        addedRemaining,
      });
      ratio += channel.weight * (after / before);
    }
    return ratio - 1;
  }
  const damage = (extraRemaining) => effectiveChannels.reduce(
    (sum, channel) => {
      const multiplier = channelDamageMultiplier({
        channel,
        defense,
        globalRemaining,
        addedRemaining: extraRemaining,
      });
      return sum + channel.weight * multiplier;
    },
    0,
  );
  const before = damage(1);
  if (!(before > 0)) return 0;
  return damage(addedRemaining) / before - 1;
}

/**
 * 전투 옵션 환산에 쓰는 모든 효과를 같은 형태로 정규화한다.
 *
 * `modifiers`는 스킬 툴팁의 원래 수치이고 `uptime`은 0~1 가동률이다.
 * 이미 API 최종 스탯에 포함된 패시브는 `includedInBaseline`로 기록만 하고
 * 다시 합산하지 않는다.
 */
export function createCombatEffect({
  layer,
  source,
  sourceKey = null,
  sourceFamily = null,
  component = null,
  duplicatePolicy = null,
  activation = null,
  kind = "additive",
  uptime = 1,
  includedInBaseline = false,
  modifiers = {},
  targetDefenseReduction = 0,
  metadata = null,
}) {
  return {
    layer: normalizedLayer(layer),
    source: String(source ?? "").trim() || "알 수 없는 효과",
    sourceKey,
    sourceFamily,
    component,
    duplicatePolicy,
    activation,
    kind,
    uptime: Math.max(0, Math.min(1, number(uptime))),
    includedInBaseline: Boolean(includedInBaseline),
    modifiers: normalizedModifiers(modifiers),
    targetDefenseReduction: Math.max(
      0,
      Math.min(100, number(targetDefenseReduction)),
    ),
    metadata,
  };
}

/**
 * Nexon 최종 스탯 스냅샷을 기준 상태로 두고 외부 도핑, 공용 스킬,
 * 직업 스킬, 대상 디버프를 순서대로 합성한다. 직업별 코드는 수치를 직접
 * 더하지 않고 이 효과 목록만 만들기 때문에 중복 여부를 한 곳에서 통제한다.
 */
export function composeCombatModel({
  baseline = {},
  baselineSources = [],
  effects = [],
  damageChannels = [],
  activationPolicy = {},
} = {}) {
  const totals = normalizedModifiers(baseline);
  let ignoreDefenseRemaining = Math.max(
    0,
    Math.min(1, 1 - number(baseline.ignoreDefense)),
  );
  let targetDefenseRemaining = 1;
  const ledger = [];

  const resolvedLedger = resolveCombatSourceLedger({
    effects: effects.map(createCombatEffect),
    baselineSources,
    activationPolicy,
  });

  for (const decision of resolvedLedger) {
    const effect = decision.effect;
    const applied = decision.applied && effect.uptime > 0;
    const averaged = normalizedModifiers();

    if (applied) {
      for (const field of COMBAT_NUMERIC_FIELDS) {
        averaged[field] = effect.modifiers[field] * effect.uptime;
        totals[field] += averaged[field];
      }
      averaged.ignoreDefenseSources = effect.modifiers.ignoreDefenseSources
        .map((value) => value * effect.uptime)
        .filter((value) => value > 0);
      for (const source of averaged.ignoreDefenseSources) {
        ignoreDefenseRemaining *= 1 - source / 100;
      }
      if (effect.targetDefenseReduction > 0) {
        targetDefenseRemaining *=
          1 - effect.targetDefenseReduction * effect.uptime / 100;
      }
    }

    ledger.push({
      ...effect,
      sourceKey: decision.sourceKey,
      activation: decision.activation,
      applied,
      applicationReason: applied
        ? "applied"
        : decision.reason ?? "zero-uptime",
      duplicateOf: decision.duplicateOf,
      averagedModifiers: averaged,
    });
  }

  totals.ignoreDefense = 1 - ignoreDefenseRemaining;
  return {
    version: 2,
    basis: "nexon-final-stat",
    baselineSources: baselineSources.map((source) => ({ ...source })),
    order: [...COMBAT_LAYER_ORDER],
    totals,
    targetDefenseRemaining,
    damageChannels: normalizedDamageChannels(damageChannels),
    effects: ledger,
  };
}

/** 영구 패시브는 Nexon 최종 스탯에 포함되므로 전투 버프로 다시 더하지 않는다. */
export function isBaselineReflectedSkill(skill) {
  const effect = String(skill?.skill_effect ?? "");
  const description = String(skill?.skill_description ?? "");
  const text = `${description}\n${effect}`;
  if (!/영구적으로/u.test(text)) return false;

  // 영구 패시브와 도트·회복 같은 부가 효과가 한 스킬 설명에 함께 있어도
  // `n초 동안`이라는 문구만 보고 전투 버프로 재합산하면 안 된다. 영구
  // 문장을 제거한 나머지에 실제 임시 스탯 증가가 있을 때만 혼합 스킬로
  // 남긴다.
  const withoutPermanentLines = effect
    .split(/\r?\n/u)
    .filter((line) => !/영구적으로/u.test(line))
    .join("\n")
    .replace(/\[패시브 효과\s*:[\s\S]*$/u, "");
  const hasTimedCombatStat = new RegExp(
    String.raw`\d+(?:\.\d+)?초 동안[^\n]*(?:공격력|마력|데미지|크리티컬 확률|크리티컬 데미지|방어율 무시)[^\n]*(?:증가|무시)`,
    "u",
  ).test(withoutPermanentLines);
  return !hasTimedCombatStat;
}

/**
 * 보스에게 계속 유지되는 방어율 감소 디버프를 공식 스킬 설명에서 읽는다.
 * `아머 스플릿`처럼 중첩형이면 한 줄 수치 × 최대 중첩으로 계산한다.
 */
export function targetDefenseEffectsFromSkills(skillData) {
  const result = [];
  const rawSkills = (skillData ?? []).flatMap(
    (grade) => grade?.character_skill ?? [],
  );
  const viBaseNames = new Set(
    rawSkills
      .map((skill) => String(skill?.skill_name ?? "").trim())
      .filter(isSixthMasterySkillName)
      .map(withoutSixthMasteryMarker),
  );
  const skills = rawSkills.filter((skill) => {
    const name = String(skill?.skill_name ?? "").trim();
    return isSixthMasterySkillName(name) ||
      !viBaseNames.has(withoutSixthMasteryMarker(name));
  });
  for (const skill of skills) {
    const name = String(skill?.skill_name ?? "").trim();
    const effect = String(skill?.skill_effect ?? "");
    // 퍼지 에어리어처럼 일반 몬스터에게만 적용되고 보스는 명시적으로
    // 제외되는 방어율 감소를 보스 환산에 넣으면 큰 과대평가가 발생한다.
    // 스킬 전체를 버리지 않고 방어율 감소가 적힌 문장만 판정한다.
    const effectLines = effect.split(/\r?\n|[。]/u);
    const bossApplicableEffect = effectLines
      .filter((line) => /방어율/u.test(line))
      .filter((line) =>
        !/보스\s*몬스터(?:를|는)?\s*제외|일반\s*몬스터(?:에게|에만|만)/u
          .test(line)
      )
      .join("\n");
    // 공식 설명은 같은 효과를 `대상의 방어율 10%만큼 감소`,
    // `적의 방어율 30% 감소`, `공격 당한 적은 ... 방어율 44% 감소`
    // 등으로 표기한다. 대상 명사의 유무에 의존하지 않고 `감소` 효과만
    // 읽어 스킬 자체의 `방어율 무시`와 혼동하지 않는다.
    const reductionMatch = bossApplicableEffect.match(
      /방어율(?:을)?\s*(\d+(?:\.\d+)?)%\s*(?:만큼\s*)?감소/u,
    );
    // `공격력, 방어율 50%, 명중치 50%만큼 감소`처럼 감소 동사가
    // 여러 능력치의 맨 끝에 한 번만 오는 설명도 있다. 방어율 수치 뒤에서
    // `무시`가 먼저 등장하는 공격자 방무 문장은 대상 감소로 읽지 않는다.
    const listedReductionMatch = bossApplicableEffect
      .split(/\r?\n/u)
      .map((line) => {
        const match = line.match(/방어율(?:을)?\s*(\d+(?:\.\d+)?)%/u);
        if (!match) return null;
        const suffix = line.slice((match.index ?? 0) + match[0].length);
        const decreaseIndex = suffix.search(/(?:만큼\s*)?감소/u);
        if (decreaseIndex < 0 || /무시/u.test(suffix.slice(0, decreaseIndex))) {
          return null;
        }
        return match;
      })
      .find(Boolean);
    const defenseDebuffMatch = bossApplicableEffect.match(
      /(\d+(?:\.\d+)?)%의\s*방어율\s*무시\s*디버프/u,
    );
    if (!reductionMatch && !listedReductionMatch && !defenseDebuffMatch) {
      continue;
    }
    const stackMatch = bossApplicableEffect.match(
      /최대\s*(\d+(?:\.\d+)?)번(?:까지)?\s*(?:중첩|누적)/u,
    );
    const durationMatch = bossApplicableEffect.match(/(\d+(?:\.\d+)?)초 동안/u);
    const cooldownMatch = effect.match(/재사용 대기시간\s*(\d+(?:\.\d+)?)초/u);
    const perStack = number(
      reductionMatch?.[1] ?? listedReductionMatch?.[1] ??
        defenseDebuffMatch?.[1],
    );
    const stacks = Math.max(1, number(stackMatch?.[1]));
    const duration = number(durationMatch?.[1]);
    const cooldown = number(cooldownMatch?.[1]);
    const uptime = stackMatch || !(duration > 0 && cooldown > 0)
      ? 1
      : Math.min(1, duration / cooldown);
    result.push(createCombatEffect({
      layer: "target",
      source: name,
      kind: "target-defense-reduction",
      uptime,
      activation: {
        mode: uptime >= 1 ? "maintained" : "cycle-average",
        evidence: "official-skill-description",
      },
      targetDefenseReduction: Math.min(100, perStack * stacks),
      metadata: {
        perStack,
        stacks,
        duration: duration || null,
        cooldown: cooldown || null,
        assumption: stackMatch ? "maintained-max-stack" : "maintained",
      },
    }));
  }
  return result;
}

function isAttackSkillText(value) {
  return /\d+(?:\.\d+)?%\s*(?:의\s*)?데미지로|공격하는 스킬|공격한다|공격은|직접 공격|적을 공격|사용 시 발동/u
    .test(String(value ?? ""));
}

function parsedSkillLocalIgnoreDefenseChannels(skillData) {
  const result = [];
  const rawSkills = (skillData ?? []).flatMap((grade) =>
    (grade?.character_skill ?? []).map((skill) => ({
      skill,
      grade: String(grade?.character_skill_grade ?? "").trim(),
    }))
  );
  for (const { skill, grade } of rawSkills) {
    const name = String(skill?.skill_name ?? "").trim();
    if (!name) continue;
    const effect = String(skill?.skill_effect ?? "");
    const description = String(skill?.skill_description ?? "");
    const text = `${description}\n${effect}`;
    // 6차 오리진/마스터리 스킬 중에는 실제 공격 스킬인데도 설명이
    // `피해를 입힌다`처럼 적혀 기존 공격 문구 정규식에 잡히지 않는 것이
    // 있다. 6차 스킬의 단계별 방무는 연무장 점유율과 결합될 때만 계산에
    // 들어가므로 발견 단계에서는 보존한다.
    const attackLike = isAttackSkillText(text) || grade === "6";
    if (!attackLike) continue;

    const skillLevel = number(skill?.skill_level);
    const intrinsicSources = [];
    const progressionSources = [];
    const timedSkillEffect = /\d+(?:\.\d+)?초 동안/u.test(effect);
    let hasTimedGlobalIgnoreDefense = false;
    for (const line of effect.split(/\r?\n/u)) {
      if (!/방어율/u.test(line) || /영구적으로|영구히/u.test(line)) {
        continue;
      }
      const requiredLevelMatch = line.match(/^\s*(\d+(?:\.\d+)?)레벨\s*:/u);
      // `오라 웨폰`, `파이렛 플래그 VI`, `소드 오브 소울 라이트`,
      // `어비스 버프`처럼 일정 시간 캐릭터 전체 방무를 올리는 문장은
      // 공격 설명과 같은 스킬에 있어도 그 공격만의 고유 방무가 아니다.
      // 이를 지역 공격군에도 넣으면 전역 효과와 이중 적용된다.
      if (
        timedSkillEffect &&
        !requiredLevelMatch &&
        /(?:몬스터|적)?\s*방어율 무시(?:가)?\s*\d+(?:\.\d+)?%\s*증가/u
          .test(line) &&
        !/(?:해당|이|각)\s*(?:공격|스킬)[^\n]*방어율/u.test(line)
      ) {
        hasTimedGlobalIgnoreDefense = true;
        continue;
      }
      if (
        requiredLevelMatch && skillLevel > 0 &&
        skillLevel < number(requiredLevelMatch[1])
      ) continue;

      const directSources = [
        ...line.matchAll(
          /(?:(?:몬스터|적)(?:의)?\s*)?방어율(?:을)?\s*(\d+(?:\.\d+)?)%\s*(?:를\s*)?(?:(?:추가(?:로)?\s*)?무시|무시(?:하여|하고)|추가\s*적용)/gu,
        ),
      ].map((match) => number(match[1]));
      const levelSources = attackLike
        ? [
          ...line.matchAll(
            /몬스터\s*방어율\s*무시\s*(\d+(?:\.\d+)?)%\s*(?:추가\s*)?증가/gu,
          ),
        ].map((match) => number(match[1]))
        : [];

      if (requiredLevelMatch) {
        progressionSources.push(...directSources, ...levelSources);
      } else {
        intrinsicSources.push(...directSources, ...levelSources);
      }
    }

    const hasUnquantifiedLocalIgnoreDefense = attackLike &&
      /방어율[^\n。]*(?:추가(?:로)?\s*)?무시/u.test(text) &&
      !hasTimedGlobalIgnoreDefense &&
      !(intrinsicSources.length || progressionSources.length);
    if (
      !intrinsicSources.length && !progressionSources.length &&
      !hasUnquantifiedLocalIgnoreDefense
    ) continue;
    result.push(createDamageChannel({
      source: name,
      ignoreDefenseSources: [...intrinsicSources, ...progressionSources],
      metadata: {
        status: "unweighted",
        reason: "NEXON Open API가 직업별 공격 점유율을 제공하지 않음",
        intrinsicIgnoreDefenseSources: intrinsicSources,
        progressionIgnoreDefenseSources: progressionSources,
        hasUnquantifiedLocalIgnoreDefense,
        isSixthSkill: isSixthMasterySkillName(name),
        skillGrade: grade || null,
      },
    }));
  }
  return result;
}

function hyperPassiveLocalIgnoreDefenseChannels(skillData) {
  const result = [];
  const rawSkills = (skillData ?? []).flatMap(
    (grade) => grade?.character_skill ?? [],
  );
  for (const skill of rawSkills) {
    const description = String(skill?.skill_description ?? "");
    const effect = String(skill?.skill_effect ?? "");
    const targetsMatch = description.match(
      /^(.+?)의\s*몬스터\s*방어율\s*무시\s*수치를\s*증가/u,
    );
    const valueMatch = effect.match(
      /몬스터\s*방어율\s*무시\s*(\d+(?:\.\d+)?)%\s*(?:추가\s*)?증가/u,
    );
    if (!targetsMatch || !valueMatch) continue;
    const value = number(valueMatch[1]);
    if (!(value > 0)) continue;
    const targets = targetsMatch[1]
      .split(/\s*[,·]\s*|\s+(?:및|그리고)\s+/u)
      .map((name) => name.trim())
      .filter(Boolean);
    for (const target of new Set(targets)) {
      result.push(createDamageChannel({
        source: target,
        ignoreDefenseSources: [value],
        metadata: {
          status: "unweighted",
          reason: "선택한 하이퍼 패시브의 스킬 전용 방무",
          hyperPassive: String(skill?.skill_name ?? "").trim() || null,
        },
      }));
    }
  }
  return result;
}

/**
 * 공식 스킬 설명에서 특정 공격에만 추가 적용되는 방무를 수집한다.
 * 공격 비중은 API가 제공하지 않으므로 여기서는 발견만 하고 weight=null로
 * 남긴다. 이를 전역 방무에 합산하지 않는 것이 핵심 안전 규칙이다.
 */
export function skillLocalIgnoreDefenseChannelsFromSkills(skillData) {
  const grouped = new Map();
  for (const channel of parsedSkillLocalIgnoreDefenseChannels(skillData)) {
    const key = normalizedBattleSkillName(channel.source);
    if (!key) continue;
    const current = grouped.get(key) ?? { legacy: [], sixth: [] };
    current[channel.metadata?.isSixthSkill ? "sixth" : "legacy"].push(channel);
    grouped.set(key, current);
  }

  const selected = [];
  for (const { legacy, sixth } of grouped.values()) {
    const active = sixth.length ? sixth : legacy;
    const activeIntrinsic = active.flatMap(
      (channel) => channel.metadata?.intrinsicIgnoreDefenseSources ?? [],
    );
    // VI 설명에 수치가 생략됐으면 원본 스킬의 고유 방무를 상속한다.
    // VI가 새 수치를 명시한 경우에는 원본 수치와 더하지 않고 대체한다.
    const intrinsic = sixth.length && !activeIntrinsic.length
      ? legacy.flatMap(
        (channel) => channel.metadata?.intrinsicIgnoreDefenseSources ?? [],
      )
      : activeIntrinsic;
    const progression = active.flatMap(
      (channel) => channel.metadata?.progressionIgnoreDefenseSources ?? [],
    );
    const sources = [...intrinsic, ...progression].filter((value) => value > 0);
    if (!sources.length) continue;
    const representative = active.at(-1);
    selected.push(createDamageChannel({
      source: representative.source,
      ignoreDefenseSources: sources,
      metadata: {
        status: "unweighted",
        reason: "스킬 고유 방무와 달성한 6차 강화 효과",
        sources: active.map((channel) => channel.source),
        inheritedFromLegacy: Boolean(
          sixth.length && !activeIntrinsic.length && intrinsic.length,
        ),
      },
    }));
  }

  for (const channel of hyperPassiveLocalIgnoreDefenseChannels(skillData)) {
    const key = normalizedBattleSkillName(channel.source);
    const current = selected.find(
      (candidate) => normalizedBattleSkillName(candidate.source) === key,
    );
    if (!current) {
      selected.push(channel);
      continue;
    }
    // 스킬 고유 방무와 하이퍼 패시브는 서로 다른 방무 출처로 곱연산된다.
    current.ignoreDefenseSources.push(...channel.ignoreDefenseSources);
    current.metadata.hyperPassive = channel.metadata?.hyperPassive ?? null;
  }
  return selected;
}

/** V 강화 코어 40레벨에서 해당 스킬에 붙는 몬스터 방어율 무시 20%. */
export function boostCoreIgnoreDefenseChannels(vMatrixData) {
  const result = [];
  for (const core of vMatrixData?.character_v_core_equipment ?? []) {
    const type = String(core?.v_core_type ?? "").trim();
    const level = number(core?.v_core_level) + number(core?.slot_level);
    if (!/강화 코어/u.test(type) || level < 40) continue;
    const coreName = String(core?.v_core_name ?? "")
      .replace(/\s*강화\s*$/u, "")
      .trim();
    for (const skillName of coreName.split("/").map((name) => name.trim())) {
      if (!skillName) continue;
      result.push(createDamageChannel({
        source: skillName,
        ignoreDefenseSources: [20],
        metadata: {
          status: "unweighted",
          reason: "V 강화 코어 40레벨 효과",
          coreName: String(core?.v_core_name ?? "").trim(),
          coreLevel: level,
        },
      }));
    }
  }
  return result;
}

function normalizedBattleSkillName(value) {
  return withoutSixthMasteryMarker(value)
    .normalize("NFKC")
    .replace(/\s+/gu, "")
    .replace(/[()（）\[\]]/gu, "")
    .trim();
}

function matchingLocalChannel(statisticName, localChannels) {
  const normalizedStatistic = normalizedBattleSkillName(statisticName);
  if (!normalizedStatistic) return null;
  return localChannels
    .map((channel) => ({
      channel,
      normalizedSource: normalizedBattleSkillName(channel.source),
    }))
    .filter(({ normalizedSource }) => normalizedSource && (
      normalizedStatistic === normalizedSource ||
      (normalizedSource.length >= 3 &&
        (normalizedStatistic.startsWith(normalizedSource) ||
          normalizedSource.startsWith(normalizedStatistic)))
    ))
    .sort((left, right) =>
      right.normalizedSource.length - left.normalizedSource.length
    )[0]?.channel ?? null;
}

function mergedLocalIgnoreDefenseChannels(skillData, vMatrixData) {
  const merged = new Map();
  for (const channel of [
    ...skillLocalIgnoreDefenseChannelsFromSkills(skillData),
    ...boostCoreIgnoreDefenseChannels(vMatrixData),
  ]) {
    const key = normalizedBattleSkillName(channel.source);
    if (!key) continue;
    const current = merged.get(key) ?? {
      ...channel,
      ignoreDefenseSources: [],
      metadata: { sources: [] },
    };
    current.source = isSixthMasterySkillName(channel.source)
      ? channel.source
      : current.source;
    // 스킬 고유·6차 강화·하이퍼·V코어 방무는 동일한 숫자여도 서로 다른
    // 출처이므로 각각 곱연산한다.
    current.ignoreDefenseSources.push(...channel.ignoreDefenseSources);
    current.metadata.sources.push({
      source: channel.source,
      ...channel.metadata,
    });
    merged.set(key, current);
  }
  return [...merged.values()];
}

/**
 * 보스에게 표식을 유지하면 모든 공격에 적용되는 스킬 전용 방무를 찾는다.
 *
 * 나이트워커의 어둠의 표식처럼 기본 스킬에 최대 중첩과 중첩당 방무가 있고
 * 상위 패시브가 두 값을 각각 올리는 구조를 공식 설명에서 합성한다. 서로
 * 다른 표식이 둘 이상 발견되면 임의로 합치지 않고 적용하지 않는다.
 */
function maintainedMarkedTargetIgnoreDefenseFromSkills(skillData) {
  const skills = (skillData ?? []).flatMap(
    (grade) => grade?.character_skill ?? [],
  );
  const baseMechanics = [];
  for (const skill of skills) {
    const text = `${String(skill?.skill_description ?? "")}\n${
      String(skill?.skill_effect ?? "")
    }`;
    if (!/표식|낙인/u.test(text) || !/해당 적/u.test(text)) continue;
    const stackMatch = text.match(
      /최대\s*(\d+(?:\.\d+)?)\s*(?:회|개)까지\s*중첩/u,
    );
    const perStackMatch = text.match(
      /중첩당\s*(\d+(?:\.\d+)?)%\s*(?:만큼\s*)?방어율\s*(?:을\s*)?(?:추가\s*)?무시/u,
    );
    if (!stackMatch || !perStackMatch) continue;
    baseMechanics.push({
      source: String(skill?.skill_name ?? "").trim(),
      stacks: number(stackMatch[1]),
      perStack: number(perStackMatch[1]),
    });
  }
  if (baseMechanics.length !== 1) return null;

  const base = baseMechanics[0];
  let additionalStacks = 0;
  let additionalPerStack = 0;
  const enhancements = [];
  for (const skill of skills) {
    const name = String(skill?.skill_name ?? "").trim();
    if (!name || name === base.source) continue;
    const text = `${String(skill?.skill_description ?? "")}\n${
      String(skill?.skill_effect ?? "")
    }`;
    const stackMatch = text.match(
      /최대\s*중첩\s*제한\s*(\d+(?:\.\d+)?)/u,
    );
    const perStackMatch = text.match(
      /중첩당\s*방어율\s*무시\s*(\d+(?:\.\d+)?)%\s*증가/u,
    );
    if (!stackMatch && !perStackMatch) continue;
    additionalStacks += number(stackMatch?.[1]);
    additionalPerStack += number(perStackMatch?.[1]);
    enhancements.push(name);
  }
  const stacks = base.stacks + additionalStacks;
  const perStack = base.perStack + additionalPerStack;
  const ignoreDefense = Math.min(100, stacks * perStack);
  if (!(ignoreDefense > 0)) return null;
  return {
    source: base.source,
    ignoreDefense,
    stacks,
    perStack,
    enhancements,
  };
}

/**
 * 여러 정상 자동 종료 연무장 표본을 합친 직업 프로필을 현재 캐릭터의
 * 스킬·V 강화 코어 상태와 결합한다. 프로필은 피해 점유율만 제공하며,
 * 스킬별 방무 수치는 현재 캐릭터 자료에서 읽는다.
 */
export function generalizedBattlePracticeDamageChannelsFromSkills({
  skillData,
  vMatrixData,
  profile,
} = {}) {
  const profileSkills = Array.isArray(profile?.skillShares)
    ? profile.skillShares
    : [];
  if (!profileSkills.length || !(number(profile?.sampleCount) > 0)) return [];

  const localChannels = mergedLocalIgnoreDefenseChannels(
    skillData,
    vMatrixData,
  );
  const markedTarget = maintainedMarkedTargetIgnoreDefenseFromSkills(skillData);
  const maintainedTargetSources = markedTarget
    ? [markedTarget.ignoreDefense]
    : [];
  const sharedMetadata = {
    model: "battle-practice-class-generalized",
    weightBasis: profile?.shareBasis === "pre-defense"
      ? "pre-defense"
      : "observed-damage",
    profileId: String(profile?.id ?? "") || null,
    sampleCount: number(profile?.sampleCount),
  };
  let profiledWeight = 0;
  let generalWeight = 0;
  const weighted = [];
  const matchedSources = new Set();

  for (const entry of profileSkills) {
    const weight = Math.max(0, number(entry?.weight));
    if (!(weight > 0)) continue;
    profiledWeight += weight;
    const localChannel = matchingLocalChannel(entry?.source, localChannels);
    if (!localChannel?.ignoreDefenseSources?.length) {
      generalWeight += weight;
      continue;
    }
    matchedSources.add(localChannel.source);
    weighted.push(createDamageChannel({
      source: String(entry?.source ?? localChannel.source),
      weight,
      ignoreDefenseSources: [
        ...maintainedTargetSources,
        ...localChannel.ignoreDefenseSources,
      ],
      metadata: {
        ...sharedMetadata,
        matchedSource: localChannel.source,
        ...(markedTarget ? { maintainedMarkedTarget: markedTarget } : {}),
      },
    }));
  }

  generalWeight += Math.max(0, 1 - profiledWeight);
  const result = [
    createDamageChannel({
      source: "직업 공통 연무장 일반 공격군",
      weight: generalWeight,
      ignoreDefenseSources: maintainedTargetSources,
      metadata: {
        ...sharedMetadata,
        ...(markedTarget ? { maintainedMarkedTarget: markedTarget } : {}),
      },
    }),
    ...weighted,
  ];
  const unmatched = localChannels.filter(
    (channel) => !matchedSources.has(channel.source),
  );
  return [...result, ...unmatched];
}
