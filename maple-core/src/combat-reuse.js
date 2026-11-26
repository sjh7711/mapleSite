import { classBattlePracticeDamageProfile } from "./class-damage-profiles.js";
import { battlePracticeReuseReferences } from "./battle-practice-reuse-references.js";

const SOUL_CONTRACT = "소울 컨트랙트";
const LETE_EDICT = /^이딕트\s*:\s*(?:템플러 아츠|램페이지)(?: VI)?$/u;
const ADVANCEMENT_GRADE = /^[0-4]$/u;
const ACTIVE_COST = /(?:MP|HP|DF|PP|타임 포스)\s*\d+(?:\.\d+)?%?\s*소비/u;
// These cooldowns govern a proc, charge consumption, or an already
// continuously maintained buff rather than repeated attack casts.
const NON_REPEATABLE = new Set([
  SOUL_CONTRACT, "플레시 미라주", "트라이엄프 페더", "미니 캐논볼",
  "앱솔루트 킬", "샤드",
]);
const DIRECT_CAST_OUTPUTS = {
  "패스파인더": { "에인션트 임팩트": "엣지 오브 레조넌스 VI" },
  "캡틴": { "데스 헤일": "헤드 샷 VI" },
};
const OWN_COOLDOWN = /(?:^|\n|,\s*)재사용 대기시간\s*:?\s*(\d+(?:\.\d+)?)초/u;
const REUSE_EXEMPT = /재사용 대기시간(?:\s*감소\s*(?:및|와|,))?\s*(?:초기화|미적용)(?:\s*(?:및|와|,)\s*(?:감소|초기화|미적용))?(?:의)?(?:\s*효과)?(?:를|가)?\s*(?:적용을?\s*)?(?:받지\s*않|적용되지\s*않|적용\s*불가|불가|적용\s*안\s*됨)|재사용 대기시간을 초기화할 수 없/u;

export function combatReusePercent(abilityData, unionArtifactData) {
  const ability = (abilityData?.ability_info ?? []).reduce((sum, entry) => sum + Number(
    String(entry?.ability_value ?? "").match(/(\d+(?:\.\d+)?)%\s*확률로 재사용 대기시간이 미적용/u)?.[1] ?? 0,
  ), 0);
  const artifact = (unionArtifactData?.union_artifact_effect ?? []).reduce((sum, entry) => sum + Number(
    String(entry?.name ?? "").match(/재사용 대기시간 미적용 확률\s*(\d+(?:\.\d+)?)%\s*증가/u)?.[1] ?? 0,
  ), 0);
  return ability + artifact;
}

function skillTooltip(skill) {
  return `${skill?.skill_description ?? ""}\n${skill?.skill_effect ?? ""}`;
}

function baseSkillName(name) {
  return name.replace(/ VI(?=\s*(?:[:：(（]|$))/u, "");
}

export function reuseEligibleSkills(skillData, characterClass) {
  const skills = (skillData ?? []).flatMap((group) =>
    (group?.character_skill ?? []).filter((skill) =>
      skill?.skill_level == null || Number(skill.skill_level) > 0,
    ).map((skill) => [String(group.character_skill_grade ?? ""), skill]),
  );
  const canReset = (skill) => {
    const name = String(skill?.skill_name ?? "").trim();
    const effect = String(skill?.skill_effect ?? "");
    return name && !NON_REPEATABLE.has(baseSkillName(name)) && OWN_COOLDOWN.test(effect) &&
      !REUSE_EXEMPT.test(skillTooltip(skill)) &&
      !/^\[패시브 효과\s*:/u.test(effect) &&
      ACTIVE_COST.test(effect);
  };
  const eligible = new Set(skills.filter(([grade, skill]) =>
    ADVANCEMENT_GRADE.test(grade) && canReset(skill),
  ).map(([, skill]) => skill.skill_name.trim()));
  for (const [grade, skill] of skills) {
    const name = String(skill?.skill_name ?? "").trim();
    if (grade === "6" && canReset(skill) &&
        (eligible.has(baseSkillName(name)) ||
          (characterClass === "레테" && LETE_EDICT.test(name)))) {
      eligible.add(name);
    }
  }
  return eligible;
}

// A successful proc allows another cast, which can independently proc again.
function expectedCasts(percent) {
  return 1 / (1 - Math.min(0.99, Math.max(0, percent / 100)));
}

function leteEdictCycle(skillData) {
  const skills = (skillData ?? []).flatMap((group) => group?.character_skill ?? []);
  const attunement = skills.find((skill) => skill.skill_name === "어튠먼트" && Number(skill.skill_level) > 0);
  const pact = skills.find((skill) => skill.skill_name === "체인 커맨드" && Number(skill.skill_level) > 0);
  const innate = Number(String(attunement?.skill_effect ?? "").match(/초기화 확률\s*(\d+(?:\.\d+)?)% 증가/u)?.[1] ?? 0);
  const effect = String(pact?.skill_effect ?? "");
  const phase = effect.match(/(\d+)초 동안 이딕트 스킬의 재사용 대기시간 (\d+)% 감소, 재사용 대기시간 초기화 확률 (\d+)% 증가/u);
  const cooldown = Number(effect.match(OWN_COOLDOWN)?.[1] ?? 0);
  if (!phase || !cooldown) return (rate) => expectedCasts(rate + innate);
  const timeShare = Math.min(1, Number(phase[1]) / cooldown);
  const phaseCooldown = 1 - Number(phase[2]) / 100;
  const phaseRate = Number(phase[3]);
  return (rate) => (1 - timeShare) * expectedCasts(rate + innate) +
    timeShare * expectedCasts(rate + innate + phaseRate) / phaseCooldown;
}

/**
 * Adjust the existing class damage mix to the selected preset. The practice
 * replays already include reuse, so each attack is rebased from its sampled
 * probability before applying the current character's expected cast count.
 */
export function calculateCombatReuse({ characterClass, skillData, abilityData, unionArtifactData } = {}) {
  const percent = combatReusePercent(abilityData, unionArtifactData);
  const eligible = reuseEligibleSkills(skillData, characterClass);
  const profile = classBattlePracticeDamageProfile(characterClass);
  const reference = battlePracticeReuseReferences[characterClass];
  const matchedReference = reference?.id === profile?.id ? reference : null;
  const edictCasts = characterClass === "레테" ? leteEdictCycle(skillData) : null;
  const weightMultipliers = new Map();
  const sources = [];
  let damageMultiplier = 1;
  for (const { source, weight } of profile?.skillShares ?? []) {
    // The profile may include historical non-VI names of the same attack.
    const modern = `${source} VI`;
    const cast = DIRECT_CAST_OUTPUTS[characterClass]?.[source] ?? source;
    const skill = eligible.has(modern) ? modern : eligible.has(cast) ? cast : null;
    const referencePercent = matchedReference?.rates[source];
    if (!skill || referencePercent == null) continue;
    const casts = edictCasts && LETE_EDICT.test(skill) ? edictCasts : expectedCasts;
    const multiplier = Math.abs(percent - referencePercent) < 0.00005
      ? 1
      : casts(percent) / casts(referencePercent);
    weightMultipliers.set(source, multiplier);
    damageMultiplier += weight * (multiplier - 1);
    sources.push({ source, skill, referencePercent, multiplier });
  }
  return {
    percent,
    weightMultipliers,
    damageMultiplier,
    sources,
  };
}

export function expectedReusableBuffCooldown(duration, cooldown, percent) {
  if (!(duration > 0 && cooldown > duration && percent > 0)) return cooldown;
  // Recast after the current buff expires when reuse procs.
  const chance = Math.min(1, percent / 100);
  return cooldown - chance * (cooldown - duration);
}
