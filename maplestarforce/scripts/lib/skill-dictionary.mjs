import { createHash } from "node:crypto";

export const CHARACTER_SKILL_GRADES = Object.freeze([
  "0",
  "1",
  "1.5",
  "2",
  "2.5",
  "3",
  "4",
  "hyperpassive",
  "hyperactive",
  "5",
  "6",
]);

const SYSTEM_SKILL_PATTERNS = Object.freeze([
  /(?:리스트레인트|컨티뉴어스|웨폰퍼프|리스크테이커|크라이시스|링 오브 썸|레벨퍼프|듀라빌리티|얼티메이덤) 링/u,
  /(?:소울|혼돈의 서|연합의 의지|여제의 축복|정령의 축복)/u,
  /(?:아티팩트|HEXA 스탯|솔 야누스|스파이더 인 미러|크레스트 오브 더 솔라|창조의 아이온)/iu,
  /(?:이벤트|훈련|결전의 의지|길드의 축복)/u,
]);

function text(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

export function normalizedSkillName(value) {
  return text(value).replace(/\s+/gu, " ");
}

export function skillIdentity(value) {
  return normalizedSkillName(value)
    .replace(/[\s·:：()（）\[\]]+/gu, "")
    .toLocaleLowerCase("ko-KR");
}

function baseSkillIdentity(value) {
  return skillIdentity(value)
    .replace(/(?:vi|v|iv|iii|ii)$/iu, "")
    .replace(/(?:강화|마스터리)$/u, "");
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== ""))];
}

function numbersFrom(value, expression) {
  return [...text(value).matchAll(expression)]
    .map((match) => finiteNumber(match[1]))
    .filter((number) => number > 0);
}

function matchedLines(value, expression) {
  return text(value)
    .split(/\r?\n|[。]/u)
    .map((line) => line.trim())
    .filter((line) => line && expression.test(line));
}

function lines(value) {
  return text(value)
    .split(/\r?\n|[。]/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function containsBossExclusion(value) {
  return /보스\s*몬스터(?:를|는)?\s*제외|일반\s*몬스터(?:에게|에만|만)/u
    .test(text(value));
}

function attackLike(value) {
  return /(?:\d+(?:\.\d+)?%\s*(?:의\s*)?데미지(?:로)?|\d+(?:\.\d+)?%로\s*\d+번\s*공격|피해를 입|공격한다|공격하는 스킬|직접 공격|적을 공격|타격|공격 시 발동|파이널\s*어택\s*발동)/u
    .test(text(value));
}

function passiveLike(value) {
  return /(?:영구적으로|패시브 효과|항상 적용|마스터 시)/u.test(text(value));
}

function implicitPermanentEffectLike(value) {
  // 첫 문장의 상시 효과 뒤에 "추가로" 별도 발동 효과를
  // 나열하는 형식이 있다. 뒷문장의 지속시간을 첫 효과에
  // 전파하지 않도록 상시 패시브 근거로 따로 인식한다.
  return /방어율[^.\n]*무시(?:한다|하며|하고|할\s*수)[^.\n]*\.\s*(?:추가로|또한)/u
    .test(text(value));
}

function toggledLike(value) {
  const mechanicalText = text(value)
    // 연출과 조작방식만 바꾸는 우클릭 옵션은 스킬 효과의
    // 활성/비활성과 다르다.
    .replace(/(?:커스텀 커맨드|색상 연출) 온오프[^\n]*/gu, "");
  return /(?:온오프|활성화|비활성화|스킬을 다시 사용|재사용 시 해제)/u
    .test(mechanicalText);
}

function skillTargetNames(skillName, skillGrade, description, effect) {
  const targets = [];
  const hyperNameTarget = skillGrade === "hyperpassive"
    ? skillName.replace(
      /\s*-\s*(?:이그노어\s*가드|리듀스\s*아머|인핸스)$/u,
      "",
    )
    : "";
  if (hyperNameTarget && hyperNameTarget !== skillName) {
    targets.push(hyperNameTarget);
  }

  for (const line of lines(`${description}\n${effect}`)) {
    if (!/방어율/u.test(line)) continue;
    const withoutPrefix = line.replace(/^\[마스터\s*레벨[^\]]*\]\s*/u, "");
    const candidates = [];
    for (const expression of [
      /^(.+?)의\s*(?:몬스터\s*)?방어율\s*무시(?:\s*수치)?(?:를|의)?\s*증가/u,
      /^(.+?)에\s*(?:몬스터\s*)?방어율\s*무시(?:\s*수치|\s*효과)?(?:를)?\s*(?:추가|증가)/u,
      /^(?!\d+(?:\.\d+)?%)(.+?)의\s*데미지[^\n]*?(?:몬스터(?:의)?\s*)?방어율\s*무시/u,
      /(?:^|\d+(?:\.\d+)?초\s*동안\s+)(.+?)의\s*데미지\s*및\s*방어율\s*무시/u,
      /^(.+?\s*스킬)(?:이|가)[^\n]*?강화[^\n]*?방어율/u,
    ]) {
      const match = withoutPrefix.match(expression);
      if (match?.[1]) candidates.push(match[1]);
    }
    for (const candidate of candidates) {
      if (/%|(?:MP|HP|DF)\s*\d|(?:명의\s*)?적(?:을|에게)/u
        .test(candidate)) continue;
      const includedCandidate = candidate.includes("제외한")
        ? candidate.slice(candidate.lastIndexOf("제외한") + "제외한".length)
        : candidate;
      const cleaned = includedCandidate
        .replace(/^.*?(?:기술인|스킬인)\s+/u, "")
        .replace(/^.*?중\s+/u, "")
        .replace(/^.*?\d+(?:\.\d+)?초\s*동안\s+/u, "")
        .replace(/(?:계열|공격)?\s*스킬(?:\s*및\s*6차\s*마스터리\s*코어\s*스킬)?$/u, "")
        .trim();
      targets.push(...cleaned
        .split(/\s*[,·]\s*|\s*\/\s*|\s+(?:및|그리고)\s+|와\s+|과\s+/u)
        .map(normalizedSkillName)
        .filter(Boolean));
    }
  }
  if (skillGrade === "5" && /\s강화$/u.test(skillName) &&
    /(?:20|40)레벨\s*:/u.test(description)) {
    targets.push(...skillName.replace(/\s강화$/u, "")
      .split(/\s*\/\s*/u)
      .map(normalizedSkillName)
      .filter(Boolean));
  }
  return unique(targets);
}

function excludedTargetSkillNames(description) {
  const result = [];
  for (const line of lines(description)) {
    const match = line.match(/^(.+?)(?:을|를)\s*제외한\s+.+?방어율/u);
    if (!match?.[1]) continue;
    result.push(...match[1]
      .split(/\s*[,·]\s*|\s*\/\s*|\s+(?:및|그리고)\s+|와\s+|과\s+/u)
      .map((entry) => normalizedSkillName(entry.replace(/(?:을|를)$/u, "")))
      .filter(Boolean));
  }
  return unique(result);
}

function explicitGlobalIgnoreDefenseLine(line) {
  if (/(?:\[패시브\s*효과|영구적으로|영구히)/u.test(line)) return true;
  if (/(?:자신|파티원)(?:은|의|에게)?[^\n]{0,50}?방어율\s*무시/u
    .test(line)) return true;
  const ignoreIndex = line.search(/방어율/u);
  if (ignoreIndex < 0) return false;
  const prefix = line.slice(0, ignoreIndex);
  const durationIndexes = [...prefix.matchAll(/\d+(?:\.\d+)?초\s*동안/gu)]
    .map((match) => match.index ?? -1);
  if (!durationIndexes.length) return false;
  const attackIndexes = [...prefix.matchAll(
    /(?:\d+(?:\.\d+)?%의\s*데미지로|피해를\s*입히|직접\s*공격|번\s*공격)/gu,
  )].map((match) => match.index ?? -1);
  return Math.max(...attackIndexes, -1) <= Math.max(...durationIndexes);
}

function conditionalEffect(line) {
  const leading = line.match(
    /^(.{1,80}?(?:(?:착용|상태|모드|중첩|게이지)[^,\n]*?\s시|표식이\s*있는\s*적에게))\s*/u,
  );
  if (leading?.[1]) return leading[1];
  const target = line.match(/(해당\s*적을[^,\n]*?공격하면)/u);
  return target?.[1] ?? null;
}

function characterTargetConditional(line) {
  return /(?:해당\s*적을[^,\n]*공격하면|표식이\s*있는\s*적에게\s*방어율|빙결\s*(?:상태|중첩)[^,\n]*적\s*공격\s*시)/u
    .test(line);
}

function explicitSkillLocalIgnoreDefenseLine(line) {
  return /(?:추가\s*크리티컬\s*확률|(?:몬스터(?:의)?\s*)?방어율\s*\d+(?:\.\d+)?%\s*추가\s*무시|추가\s*방어율\s*무시)/u
    .test(line);
}

function defenseType(line) {
  if (/마법\s*방어율/u.test(line)) return "magic";
  if (/물리\s*방어율/u.test(line)) return "physical";
  return null;
}

function defenseTypeForPercent(line, percent) {
  const amount = String(percent).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  if (new RegExp(`마법\\s*방어율[^%]{0,20}${amount}%`, "u").test(line)) {
    return "magic";
  }
  if (new RegExp(`물리\\s*방어율[^%]{0,20}${amount}%`, "u").test(line)) {
    return "physical";
  }
  return defenseType(line);
}

function prerequisiteSkillNames(description) {
  const result = [];
  for (const line of lines(description)) {
    if (!/^필요\s*스킬\s*:/u.test(line)) continue;
    const body = line.replace(/^필요\s*스킬\s*:\s*/u, "");
    for (const match of body.matchAll(/(?:^|,\s*)(.+?)\s+\d+레벨\s*이상/gu)) {
      result.push(normalizedSkillName(match[1]));
    }
  }
  return unique(result);
}

function cleanedEffectTargetName(value) {
  const candidate = normalizedSkillName(value)
    .replace(/^\[[^\]]+\]\s*/u, "")
    .replace(/^.*?(?:한해|한하여)\s+/u, "")
    .replace(/^(?:지속\s*중|발동\s*중|사용\s*중)\s+/u, "")
    .replace(/^(?:추가로|또한)\s+/u, "")
    .trim();
  if (!candidate || candidate.length < 2 || candidate.length > 50) return null;
  if (/^\d|[%]|(?:MP|HP|DF)\s*\d/iu.test(candidate)) return null;
  if (/(?:진입|적중|공격|사용|발동|적용|획득|소비|지속|종료)\s*시$/u
    .test(candidate)) return null;
  if (/^(?:패시브\s*효과|액티브\s*효과|효과|재사용\s*대기시간|지속\s*시간|추가\s*크리티컬\s*확률)$/u
    .test(candidate)) return null;
  return candidate;
}

function effectSectionLabel(effectLines, index) {
  const line = effectLines[index] ?? "";
  const match = line.match(/^([^:：]{2,60})\s*[:：]\s*(.*)$/u);
  if (!match) return null;
  const candidate = cleanedEffectTargetName(match[1]);
  if (!candidate) return null;
  const nearbyAttack = attackLike(match[2]) ||
    attackLike(effectLines[index + 1] ?? "");
  return nearbyAttack ? candidate : null;
}

function directEffectTargetNames(line) {
  const result = [];
  const label = line.match(/^([^:：]{2,60})\s*[:：]/u)?.[1];
  if (label) result.push(cleanedEffectTargetName(label));

  for (const expression of [
    /(?:^|,\s*)([^,:]{2,50}?)\s+적중\s*시.*?(?:몬스터(?:의)?\s*)?방어율/gu,
    /(?:^|,\s*)([^,:]{2,50}?)\s+데미지.*?(?:몬스터(?:의)?\s*)?방어율/gu,
  ]) {
    for (const match of line.matchAll(expression)) {
      result.push(cleanedEffectTargetName(match[1]));
    }
  }
  return unique(result.filter(Boolean));
}

/**
 * 하나의 6차 스킬 설명 안에 서로 다른 파생 타격의 방무가 함께 적히는
 * 경우가 있다. 문장 자체의 명시적 주어를 우선하고, 주어가 생략된 줄은
 * 가장 가까운 공격 섹션 제목을 상속한다. 같은 섹션의 `-현무/-주작` 같은
 * 하위 타격명은 루트 섹션을 바꾸지 않아 뒤따르는 공통 방무가 세 타격에
 * 각각 중복 적용되지 않게 한다.
 */
function effectTargetNamesByLine(effect) {
  const effectLines = lines(effect);
  const result = new Map();
  let sectionTarget = null;
  for (const [index, line] of effectLines.entries()) {
    const label = effectSectionLabel(effectLines, index);
    if (label) {
      const current = skillIdentity(sectionTarget);
      const next = skillIdentity(label);
      const isChild = current && next.startsWith(current) && next !== current;
      if (!isChild) sectionTarget = label;
    }
    if (!/방어율/u.test(line)) continue;
    const directTargets = directEffectTargetNames(line);
    const targets = directTargets.length
      ? directTargets
      : sectionTarget
        ? [sectionTarget]
        : [];
    if (targets.length) result.set(index, targets);
  }
  return { effectLines, targetsByLine: result };
}

function effectRecipient(line) {
  if (/(?:자신을\s*포함한\s*파티원|자신과\s*파티원)/u.test(line)) {
    return "self-and-party";
  }
  if (/^파티원(?:은|에게|의|이|가)/u.test(line)) return "party-member";
  if (/(?:자신의|자신은|자신에게|자신이)/u.test(line)) return "self";
  return null;
}

function exclusiveEffectBranch(line) {
  const equipped = line.match(/^(.{1,30}?)\s*착용\s*시/u)?.[1];
  const branch = cleanedEffectTargetName(equipped);
  return branch
    ? { exclusiveGroup: "equipped-item", exclusiveBranch: branch }
    : null;
}

function collapseEquivalentExclusiveEffects(effects) {
  const result = [];
  const byKey = new Map();
  for (const effect of effects) {
    if (!effect.exclusiveGroup) {
      result.push(effect);
      continue;
    }
    const key = [
      effect.kind,
      effect.scope,
      effect.percent,
      effect.bossApplicable,
      effect.activation,
      effect.aggregation,
      effect.exclusiveGroup,
    ].join("\u001f");
    const current = byKey.get(key);
    if (!current) {
      const entry = {
        ...effect,
        exclusiveBranches: unique([effect.exclusiveBranch]),
        conditionAlternatives: unique([effect.condition]),
        evidenceAlternatives: unique([effect.evidence]),
      };
      byKey.set(key, entry);
      result.push(entry);
      continue;
    }
    current.exclusiveBranches = unique([
      ...current.exclusiveBranches,
      effect.exclusiveBranch,
    ]);
    current.conditionAlternatives = unique([
      ...current.conditionAlternatives,
      effect.condition,
    ]);
    current.evidenceAlternatives = unique([
      ...current.evidenceAlternatives,
      effect.evidence,
    ]);
    current.condition = current.conditionAlternatives.join(" 또는 ");
    current.evidence = current.evidenceAlternatives.join("\n");
  }
  return result;
}

function parseEffectSemantics(skill) {
  const skillName = normalizedSkillName(skill?.skill_name);
  const skillGrade = text(skill?.skill_grade);
  const description = text(skill?.skill_description);
  const effect = text(skill?.skill_effect);
  const combined = `${description}\n${effect}`.trim();
  const levels = (skill?.skill_levels ?? [])
    .map(finiteNumber)
    .filter((level) => level >= 0);
  const active = !levels.length || levels.some((level) => level > 0);
  const durationSeconds = unique(numbersFrom(
    effect,
    /(\d+(?:\.\d+)?)초\s*동안/gu,
  ).concat(numbersFrom(
    effect,
    /지속\s*시간\s*(\d+(?:\.\d+)?)초/gu,
  )));
  const cooldownSeconds = unique(numbersFrom(
    effect,
    /재사용\s*대기시간\s*(\d+(?:\.\d+)?)초/gu,
  ));
  const stackCounts = unique(numbersFrom(
    effect,
    /최대\s*(\d+(?:\.\d+)?)\s*(?:회|개|번)(?:까지)?\s*(?:중첩|누적)/gu,
  ));
  const attack = attackLike(combined);
  const toggle = toggledLike(combined);
  const passive = passiveLike(combined) ||
    implicitPermanentEffectLike(description) ||
    (!attack && !toggle && !durationSeconds.length &&
      !cooldownSeconds.length && !/(?:MP|HP|DF|포스)\s*\d+\s*소비/u.test(effect));
  const ignoreDefense = [];

  const targetSkillNames = skillTargetNames(
    skillName,
    skillGrade,
    description,
    effect,
  );
  const prerequisites = prerequisiteSkillNames(description);
  const { effectLines, targetsByLine } = effectTargetNamesByLine(effect);
  const passiveTargetReductionModifier = passive && !attack &&
    prerequisites.length > 0 &&
    /(?:강화하|위력이?\s*강화|효율적인\s*전투)/u.test(description);

  // V 강화 코어와 HEXA 스킬은 현재 효과가 아니라 설명의 20/40레벨 또는
  // 10/20/30레벨 이정표에 스킬 전용 방무가 적힌다.
  for (const line of lines(description)) {
    const milestone = line.match(/^(\d+(?:\.\d+)?)레벨\s*:/u);
    if (!milestone || !/방어율/u.test(line) || !/[56]/u.test(skillGrade)) {
      continue;
    }
    const values = unique([
      ...numbersFrom(
        line,
        /(?:몬스터(?:의)?\s*)?방어율\s*무시\s*(\d+(?:\.\d+)?)%/gu,
      ),
      ...numbersFrom(
        line,
        /(?:몬스터(?:의)?\s*)?방어율(?:을)?\s*(\d+(?:\.\d+)?)%\s*(?:추가(?:로)?\s*)?무시/gu,
      ),
    ]);
    for (const percent of values) {
      ignoreDefense.push({
        kind: "ignore-defense",
        scope: "skill-local",
        percent,
        bossApplicable: true,
        activation: "level-milestone",
        aggregation: "additive-to-skill",
        requiredLevel: finiteNumber(milestone[1]),
        evidence: line,
      });
    }
  }

  for (const [lineIndex, line] of effectLines.entries()) {
    if (!line || !/방어율/u.test(line)) continue;
    const bossApplicable = !containsBossExclusion(line);
    const recipient = effectRecipient(line) ?? (
      /파티원의[^\n]*방어율\s*무시/u.test(line) &&
        /자신은[^\n]*(?:동일한|같은)\s*효과/u.test(effect)
        ? "self-and-party"
        : null
    );
    const exclusiveBranch = exclusiveEffectBranch(line);
    const targetReductionValues = [
      ...numbersFrom(
        line,
        /방어율(?:을)?\s*(\d+(?:\.\d+)?)%\s*(?:만큼\s*)?감소/gu,
      ),
      ...numbersFrom(
        line,
        /방어율(?:이|은)?[^\n%]{0,30}?(\d+(?:\.\d+)?)%\s*(?:만큼\s*)?감소/gu,
      ),
      ...numbersFrom(
        line,
        /(\d+(?:\.\d+)?)%의\s*방어율\s*무시\s*디버프/gu,
      ),
    ];
    const listedReduction = line.match(
      /방어율(?:을)?\s*(\d+(?:\.\d+)?)%/u,
    );
    if (listedReduction) {
      const suffix = line.slice(
        (listedReduction.index ?? 0) + listedReduction[0].length,
      );
      const decreaseIndex = suffix.search(/(?:만큼\s*)?감소/u);
      if (decreaseIndex >= 0 &&
        !/무시/u.test(suffix.slice(0, decreaseIndex))) {
        targetReductionValues.push(finiteNumber(listedReduction[1]));
      }
    }
    for (const percent of unique(targetReductionValues)) {
      const modifier = skillGrade === "hyperpassive";
      if (passiveTargetReductionModifier) {
        targetSkillNames.push(...prerequisites);
      }
      const targetModifier = modifier || passiveTargetReductionModifier;
      ignoreDefense.push({
        kind: targetModifier
          ? "target-defense-reduction-modifier"
          : "target-defense-reduction",
        scope: targetModifier ? "target-skill" : "target",
        percent,
        bossApplicable: targetModifier ? null : bossApplicable,
        activation: modifier
          ? "selected-passive"
          : passiveTargetReductionModifier
            ? "passive-modifier"
          : /\d+(?:\.\d+)?초\s*동안|지속\s*시간\s*\d+(?:\.\d+)?초/u.test(line) ||
              durationSeconds.length
          ? "timed-debuff"
          : "on-hit-debuff",
        aggregation: targetModifier
          ? "additive-to-target"
          : "target-stat-reduction",
        // A target-defense reduction belongs to the monster, not to the
        // recipient of a different self/party clause on the same API line.
        // Keeping recipient metadata here made e.g. Support Waver's heal and
        // Freezing Breath's self-invulnerability leak into the debuff.
        ...(exclusiveBranch ?? {}),
        defenseType: defenseTypeForPercent(line, percent),
        evidence: line,
      });
    }

    const reductionModifierValues = unique([
      ...numbersFrom(
        line,
        /방어율\s*감소량\s*(\d+(?:\.\d+)?)%\s*(?:추가\s*)?증가/gu,
      ),
    ]);
    for (const percent of reductionModifierValues) {
      ignoreDefense.push({
        kind: "target-defense-reduction-modifier",
        scope: "target-skill",
        percent,
        bossApplicable: null,
        activation: "selected-passive",
        aggregation: "additive-to-target",
        ...(exclusiveBranch ?? {}),
        evidence: line,
      });
    }

    const ignoreValues = unique([
      ...numbersFrom(
        line,
        /(?:몬스터(?:의)?\s*)?방어율(?:을)?\s*(\d+(?:\.\d+)?)%\s*(?:를\s*)?(?:추가(?:로)?\s*)?무시/gu,
      ),
      ...numbersFrom(
        line,
        /몬스터\s*방어율\s*무시\s*(\d+(?:\.\d+)?)%\s*(?:추가\s*)?증가/gu,
      ),
      ...numbersFrom(
        line,
        /방어율\s*무시\s*(\d+(?:\.\d+)?)%(?:\s*(?:추가\s*)?증가)?/gu,
      ),
      ...numbersFrom(
        line,
        /(\d+(?:\.\d+)?)%\s*(?:만큼\s*)?(?:몬스터|적)(?:의)?\s*방어율(?:을)?\s*(?:추가(?:로)?\s*)?무시/gu,
      ),
      ...numbersFrom(
        line,
        /중첩당\s*(\d+(?:\.\d+)?)%\s*(?:만큼\s*)?방어율\s*(?:추가(?:로)?\s*)?무시/gu,
      ),
      ...numbersFrom(
        line,
        /방어율\s*무시\s*효과\s*(\d+(?:\.\d+)?)%\s*추가/gu,
      ),
    ]);
    for (const percent of ignoreValues) {
      const hyperTarget = skillGrade === "hyperpassive" &&
        targetSkillNames.length > 0;
      const globalBuffModifier = /효과에\s*방어율\s*무시\s*효과를\s*추가/u
        .test(description);
      const globalPassiveModifier = /(?:습득\s*시[^\n.]*?)?영구적으로[^\n.]*방어율\s*무시/u
        .test(combined) || /방어율\s*무시[^\n.]*영구적으로/u.test(combined);
      const targetedLocalBuff = targetSkillNames.length > 0 &&
        /(?:의\s*데미지[^\n]*?방어율\s*무시|스킬(?:이|가)[^\n]*?강화)/u
          .test(line);
      const perStack = /(?:중첩\s*당|중첩당|1개당|%\s*증가\s*버프가\s*최대\s*\d+(?:\.\d+)?회(?:까지)?\s*중첩)/u
        .test(line);
      const replacesTarget = /방어율(?:\s*무시)?\s*\d+(?:\.\d+)?%로\s*증가/u
        .test(line);
      const stackModifier = perStack && /증가/u.test(line) && !replacesTarget;
      if (replacesTarget) {
        const target = line.match(/^(.+?(?:버프|표식))\s*1개당/u)?.[1];
        if (target) targetSkillNames.push(normalizedSkillName(target));
      } else if (stackModifier) {
        targetSkillNames.push(...prerequisites);
      }
      // `보스 몬스터 공격 시 데미지`가 같은 문장에 있다는 이유만으로
      // 영구 방무를 공격 스킬 전용으로 분류하면 안 된다. 방무가 적힌
      // 바로 그 문장 자체가 공격 설명일 때만 local이다.
      const boostCore = skillGrade === "5" && /\s강화$/u.test(skillName) &&
        /(?:20|40)레벨\s*:/u.test(description);
      const targetConditional = characterTargetConditional(line);
      const scope = globalBuffModifier ||
          (globalPassiveModifier && !targetedLocalBuff) ||
          targetConditional
        ? "character-global"
        : hyperTarget || boostCore || targetedLocalBuff ||
            explicitSkillLocalIgnoreDefenseLine(line)
          ? "skill-local"
          : explicitGlobalIgnoreDefenseLine(line)
            ? "character-global"
            : attackLike(line) || attack
              ? "skill-local"
              : "character-global";
      const condition = conditionalEffect(line);
      const lineTimed = /\d+(?:\.\d+)?초\s*동안|지속\s*시간\s*\d+(?:\.\d+)?초/u
        .test(line);
      const explicitlyPermanentInDescription =
        scope === "character-global" && !attack && !lineTimed &&
        implicitPermanentEffectLike(description);
      const effectTargetNames = scope === "skill-local" &&
          !targetedLocalBuff
        ? targetsByLine.get(lineIndex) ?? []
        : [];
      ignoreDefense.push({
        kind: "ignore-defense",
        scope,
        percent,
        bossApplicable,
        activation: condition && scope === "character-global"
          ? "conditional"
          : (targetConditional || perStack) &&
            scope === "character-global" && !replacesTarget
          ? "conditional"
          : explicitlyPermanentInDescription ||
            /영구적으로|영구히|패시브 효과/u.test(line) ||
            (passive && !durationSeconds.length && scope === "character-global")
          ? "baseline-passive"
          : hyperTarget || boostCore
            ? "selected-passive"
            : scope === "skill-local" && !targetedLocalBuff
              ? "per-hit"
              : targetedLocalBuff && passive
                ? "passive-modifier"
              : targetedLocalBuff && durationSeconds.length
                ? "timed"
              : /\d+(?:\.\d+)?초\s*동안/u.test(line)
                ? "timed"
                : scope === "character-global" && durationSeconds.length
                  ? "timed"
                : toggle
                  ? "toggle"
                  : scope === "character-global" && !attack
                    ? "baseline-passive"
                  : "unspecified",
        aggregation: replacesTarget
          ? "replace-target-per-stack"
          : stackModifier
            ? "additive-to-target-per-stack"
            : perStack
              ? "additive-per-stack"
          : (hyperTarget && !globalPassiveModifier) || boostCore ||
              globalBuffModifier || targetedLocalBuff
          ? "additive-to-target"
          : condition
            ? "conditional-source"
            : scope === "skill-local"
              ? "skill-base"
              : "multiplicative-source",
        condition,
        perStack,
        maximumStacks: perStack && !replacesTarget
          ? stackCounts.length ? Math.max(...stackCounts) : null
          : null,
        maximumStackIncrease: /최대\s*중첩\s*제한\s*(\d+(?:\.\d+)?)/u
          .test(line)
          ? finiteNumber(line.match(
            /최대\s*중첩\s*제한\s*(\d+(?:\.\d+)?)/u,
          )?.[1])
          : replacesTarget && stackCounts.length
            ? Math.max(...stackCounts)
            : null,
        ...(effectTargetNames.length
          ? { targetSkillNames: effectTargetNames }
          : {}),
        ...(recipient ? {
          recipient,
          appliesToCaster: recipient !== "party-member",
        } : {}),
        ...(exclusiveBranch ?? {}),
        evidence: line,
      });
    }
  }

  if (/방어율\s*감소는\s*각\s*중첩의\s*수치가\s*모두\s*더해짐/u.test(effect)) {
    const firstByKey = new Map();
    for (let index = ignoreDefense.length - 1; index >= 0; index -= 1) {
      const entry = ignoreDefense[index];
      if (entry.kind !== "target-defense-reduction") continue;
      const key = `${entry.percent}\u001f${entry.defenseType ?? ""}`;
      if (firstByKey.has(key)) {
        ignoreDefense.splice(index, 1);
        continue;
      }
      entry.perStack = true;
      entry.maximumStacks = stackCounts.length ? Math.max(...stackCounts) : null;
      entry.aggregation = "additive-per-stack";
      firstByKey.set(key, entry);
    }
  }

  const ambiguousIgnoreDefense = /방어율/u.test(combined) &&
    !ignoreDefense.length;
  const externalIgnoreDefense = ignoreDefense.filter((entry) =>
    entry.appliesToCaster === false
  );
  const casterIgnoreDefense = collapseEquivalentExclusiveEffects(
    ignoreDefense.filter((entry) => entry.appliesToCaster !== false),
  );
  const maximumDuration = Math.max(0, ...durationSeconds);
  const maximumCooldown = Math.max(0, ...cooldownSeconds);
  const estimatedUptime = maximumDuration > 0 && maximumCooldown > 0
    ? Math.min(1, maximumDuration / maximumCooldown)
    : null;

  return {
    attack,
    passive,
    toggle,
    durationSeconds,
    cooldownSeconds,
    stackCounts,
    estimatedUptime,
    ignoreDefense: casterIgnoreDefense,
    externalIgnoreDefense,
    targetSkillNames: unique(targetSkillNames),
    excludedTargetSkillNames: excludedTargetSkillNames(description),
    prerequisiteSkillNames: prerequisites,
    hasBossExcludedEffect: containsBossExclusion(combined),
    active,
    reviewRequired: active && (ambiguousIgnoreDefense || casterIgnoreDefense.some((entry) =>
      entry.scope === "skill-local" && !attack && !targetSkillNames.length
    )) || casterIgnoreDefense.some((entry) =>
      entry.kind.endsWith("modifier") && !targetSkillNames.length
    ),
  };
}

function skillSnapshotRecords(snapshot) {
  const records = [];
  for (const [index, gradePayload] of (
    snapshot?.skillData ?? snapshot?.grades ?? []
  ).entries()) {
    const grade = text(
      gradePayload?.character_skill_grade ??
        gradePayload?.requested_skill_grade ??
        gradePayload?.grade ??
        CHARACTER_SKILL_GRADES[index],
    );
    for (const skill of gradePayload?.character_skill ?? gradePayload?.skills ?? []) {
      const name = normalizedSkillName(skill?.skill_name ?? skill?.name);
      if (!name) continue;
      records.push({
        name,
        grade,
        level: finiteNumber(skill?.skill_level ?? skill?.level),
        description: text(skill?.skill_description ?? skill?.description),
        effect: text(skill?.skill_effect ?? skill?.effect),
        effectNext: text(skill?.skill_effect_next ?? skill?.effectNext),
        icon: text(skill?.skill_icon ?? skill?.icon),
      });
    }
  }
  return records;
}

function observedProfileMap(profiles) {
  const result = new Map();
  for (const [characterClass, profile] of Object.entries(profiles ?? {})) {
    const classMap = new Map();
    for (const row of profile?.skillShares ?? []) {
      const name = normalizedSkillName(row?.source);
      const weight = finiteNumber(row?.weight);
      if (!name || !(weight > 0)) continue;
      classMap.set(skillIdentity(name), { name, weight });
    }
    result.set(characterClass, {
      skills: classMap,
      sampleCount: finiteNumber(profile?.sampleCount) > 0
        ? finiteNumber(profile.sampleCount)
        : null,
      aggregation: text(profile?.aggregation) || null,
    });
  }
  return result;
}

function normalizedAliasOverrides(value) {
  const classes = value?.classes ?? value ?? {};
  return new Map(Object.entries(classes).map(([characterClass, entries]) => [
    text(characterClass),
    new Map(Object.entries(entries ?? {}).map(([observedName, rawRule]) => {
      const rule = typeof rawRule === "string"
        ? { canonical: rawRule, evidence: "manual-reviewed" }
        : rawRule ?? {};
      return [skillIdentity(observedName), {
        observedName: normalizedSkillName(observedName),
        canonical: normalizedSkillName(rule.canonical),
        evidence: text(rule.evidence) || "manual-reviewed",
        note: text(rule.note) || null,
      }];
    })),
  ]));
}

function skillFieldContainingExactName(skill, observedName) {
  const needle = normalizedSkillName(observedName);
  if (!needle) return null;
  for (const field of ["description", "effect", "effectNext"]) {
    if (normalizedSkillName(skill?.[field]).includes(needle)) return field;
  }
  return null;
}

/**
 * 연무장 결과에는 공식 API의 부모 스킬명이 아닌 파생 타격명이 기록되기도
 * 한다. 완전 일치, 검토된 명시적 매핑, 또는 공식 문구 한 곳에만 파생명이
 * 그대로 등장하는 경우만 연결한다. 접두어 유사도는 서로 다른 스킬을 잘못
 * 합칠 수 있어 의도적으로 사용하지 않는다.
 */
function resolveObservedProfileSkill(entry, skills, classOverrides) {
  const identity = skillIdentity(entry?.name);
  const exact = skills.find((skill) => skill.identity === identity);
  if (exact) return { skill: exact, method: "exact", evidence: "skill-name" };

  const override = classOverrides?.get(identity);
  if (override) {
    const canonicalIdentity = skillIdentity(override.canonical);
    const canonical = skills.find((skill) =>
      skill.identity === canonicalIdentity
    );
    if (!canonical) {
      throw new Error(
        `스킬 별칭 부모를 찾을 수 없습니다: ${override.observedName} -> ${override.canonical}`,
      );
    }
    return {
      skill: canonical,
      method: "reviewed-override",
      evidence: override.evidence,
      note: override.note,
    };
  }

  const mentioned = skills
    .map((skill) => ({
      skill,
      field: skillFieldContainingExactName(skill, entry?.name),
    }))
    .filter((candidate) => candidate.field);
  if (mentioned.length === 1) {
    return {
      skill: mentioned[0].skill,
      method: "unique-official-text",
      evidence: mentioned[0].field,
    };
  }
  return null;
}

export function buildSkillDictionary(snapshots, {
  profiles = {},
  aliasOverrides = {},
} = {}) {
  const grouped = new Map();
  const classSampleNames = new Map();
  const classGradeSampleNames = new Map();
  const latestSnapshots = new Map();
  for (const snapshot of snapshots ?? []) {
    const key = `${text(snapshot?.characterClass)}\u001f${text(snapshot?.characterName)}`;
    const current = latestSnapshots.get(key);
    if (!current || text(snapshot?.collectedAt).localeCompare(
      text(current?.collectedAt),
    ) > 0) latestSnapshots.set(key, snapshot);
  }
  for (const snapshot of latestSnapshots.values()) {
    const characterClass = text(
      snapshot?.characterClass ?? snapshot?.character_class,
    );
    if (!characterClass) continue;
    const apiClasses = (snapshot?.apiClasses ?? [])
      .map(text)
      .filter(Boolean);
    // 잘못된 랭킹 필터나 직업 변경으로 다른 직업이 응답된 스냅샷을
    // 기대 직업의 사전에 섞지 않는다. 구형 원본에는 apiClasses가 없으므로
    // 그 경우에만 하위 호환으로 허용한다.
    if (apiClasses.length && !apiClasses.includes(characterClass)) continue;
    const characterName = text(snapshot?.characterName);
    if (!grouped.has(characterClass)) grouped.set(characterClass, new Map());
    if (!classSampleNames.has(characterClass)) {
      classSampleNames.set(characterClass, new Set());
    }
    if (characterName) classSampleNames.get(characterClass).add(characterName);
    if (!classGradeSampleNames.has(characterClass)) {
      classGradeSampleNames.set(
        characterClass,
        new Map(CHARACTER_SKILL_GRADES.map((grade) => [grade, new Set()])),
      );
    }
    for (const [index, gradePayload] of (
      snapshot?.skillData ?? snapshot?.grades ?? []
    ).entries()) {
      const grade = text(
        gradePayload?.character_skill_grade ??
          gradePayload?.requested_skill_grade ??
          gradePayload?.grade ??
          CHARACTER_SKILL_GRADES[index],
      );
      if (characterName && classGradeSampleNames.get(characterClass).has(grade)) {
        classGradeSampleNames.get(characterClass).get(grade).add(characterName);
      }
    }
    const seenInSnapshot = new Set();
    for (const record of skillSnapshotRecords(snapshot)) {
      const identity = skillIdentity(record.name);
      if (!identity) continue;
      const dictionaryIdentity = `${identity}\u001f${record.grade}`;
      const classSkills = grouped.get(characterClass);
      const current = classSkills.get(dictionaryIdentity) ?? {
        name: record.name,
        identity,
        dictionaryIdentity,
        baseIdentity: baseSkillIdentity(record.name),
        grades: new Set(),
        levels: new Set(),
        descriptions: new Set(),
        effects: new Set(),
        effectNext: new Set(),
        icons: new Set(),
        observedSamples: 0,
        activeSamples: 0,
        variants: new Map(),
      };
      if (record.grade) current.grades.add(record.grade);
      current.levels.add(record.level);
      if (record.description) current.descriptions.add(record.description);
      if (record.effect) current.effects.add(record.effect);
      if (record.effectNext) current.effectNext.add(record.effectNext);
      if (record.icon) current.icons.add(record.icon);
      const variantKey = [record.grade, record.level, record.description, record.effect]
        .join("\u001f");
      const variant = current.variants.get(variantKey) ?? {
        ...record,
        observedSamples: 0,
      };
      variant.observedSamples += 1;
      current.variants.set(variantKey, variant);
      if (!seenInSnapshot.has(dictionaryIdentity)) {
        current.observedSamples += 1;
        if (record.level > 0) current.activeSamples += 1;
      }
      seenInSnapshot.add(dictionaryIdentity);
      classSkills.set(dictionaryIdentity, current);
    }
  }

  const classFrequency = new Map();
  for (const classSkills of grouped.values()) {
    for (const identity of new Set(
      [...classSkills.values()].map((skill) => skill.identity),
    )) {
      classFrequency.set(
        identity,
        (classFrequency.get(identity) ?? 0) + 1,
      );
    }
  }
  const profileByClass = observedProfileMap(profiles);
  const aliasOverridesByClass = normalizedAliasOverrides(aliasOverrides);
  const classes = {};
  let totalSkillCount = 0;
  let reviewRequiredCount = 0;
  for (const characterClass of [...grouped.keys()].sort((a, b) =>
    a.localeCompare(b, "ko-KR")
  )) {
    const sampleCount = classSampleNames.get(characterClass)?.size ?? 0;
    const skills = [...grouped.get(characterClass).values()]
      .map((skill) => {
        const variants = [...skill.variants.values()].sort((left, right) =>
          Number(Boolean(right.effect)) - Number(Boolean(left.effect)) ||
          Number(right.level > 0) - Number(left.level > 0) ||
          right.observedSamples - left.observedSamples ||
          right.level - left.level ||
          right.effect.length - left.effect.length ||
          right.description.length - left.description.length
        );
        const canonical = variants[0] ?? {};
        const description = canonical.description ?? "";
        const effect = canonical.effect ?? "";
        const effectNext = canonical.effectNext ?? "";
        const semantics = parseEffectSemantics({
          skill_name: skill.name,
          skill_grade: canonical.grade ?? [...skill.grades].at(-1),
          skill_levels: [...skill.levels],
          skill_description: description,
          skill_effect: effect,
        });
        const appearedInClasses = classFrequency.get(skill.identity) ?? 1;
        const systemPattern = SYSTEM_SKILL_PATTERNS.some((pattern) =>
          pattern.test(skill.name)
        );
        const category = systemPattern
          ? "system"
          : appearedInClasses >= 10
            ? "common"
            : appearedInClasses >= 2
              ? "branch"
              : "class";
        return {
          name: skill.name,
          identity: skill.identity,
          dictionaryIdentity: skill.dictionaryIdentity,
          baseIdentity: skill.baseIdentity,
          grades: [...skill.grades].sort((a, b) =>
            CHARACTER_SKILL_GRADES.indexOf(a) - CHARACTER_SKILL_GRADES.indexOf(b)
          ),
          levels: [...skill.levels].sort((a, b) => a - b),
          sampleCoverage: sampleCount
            ? skill.observedSamples / sampleCount
            : 0,
          activeSampleCoverage: sampleCount
            ? skill.activeSamples / sampleCount
            : 0,
          appearedInClasses,
          category,
          description,
          effect,
          effectNext,
          icon: [...skill.icons].at(-1) ?? null,
          semantics,
          semanticsVariants: variants.map((variant) => ({
            grade: variant.grade,
            level: variant.level,
            sampleCoverage: sampleCount
              ? variant.observedSamples / sampleCount
              : 0,
            effect: variant.effect,
            semantics: parseEffectSemantics({
              skill_name: skill.name,
              skill_grade: variant.grade,
              skill_levels: [variant.level],
              skill_description: variant.description,
              skill_effect: variant.effect,
            }),
          })),
          battlePractice: {
            observed: false,
            matchedName: null,
            meanDamageShare: null,
            matches: [],
          },
        };
      })
      .sort((left, right) => {
        const leftGrade = CHARACTER_SKILL_GRADES.indexOf(left.grades[0]);
        const rightGrade = CHARACTER_SKILL_GRADES.indexOf(right.grades[0]);
        return leftGrade - rightGrade || left.name.localeCompare(right.name, "ko-KR");
      });
    const skillsByBase = new Map();
    for (const skill of skills) {
      const related = skillsByBase.get(skill.baseIdentity) ?? [];
      related.push(skill);
      skillsByBase.set(skill.baseIdentity, related);
    }
    for (const skill of skills) {
      skill.relatedSkills = (skillsByBase.get(skill.baseIdentity) ?? [])
        .map((entry) => entry.name)
        .filter((name) => name !== skill.name);
      skill.aliases = [];
      skill.aliasEvidence = [];
    }

    // 일부 파생 스킬은 공식 문구에 "추가 무시" 또는 기존 버프 적용만
    // 명시하고 수치를 반복하지 않는다. 같은 계열 원본 또는 명시된 필요
    // 스킬에 local 기본값이 정확히 하나 있을 때만 그 값을 상속한다.
    for (const skill of skills) {
      if (!skill.semantics?.reviewRequired || skill.semantics.ignoreDefense.length) {
        continue;
      }
      if (!/(?:방어율[^\n.]*추가(?:로)?\s*무시|방어율\s*무시\s*버프가\s*적용)/u
        .test(`${skill.description}\n${skill.effect}`)) continue;
      const prerequisites = skill.semantics.prerequisiteSkillNames ?? [];
      const candidates = skills.filter((candidate) => {
        if (candidate === skill || candidate.grades.includes("6") ||
          candidate.grades.includes("hyperpassive")) return false;
        const sameBase = /(?:\s|:)VI(?:\s|$)/u.test(skill.name) &&
          candidate.baseIdentity === skill.baseIdentity;
        const prerequisite = prerequisites.some((name) =>
          candidate.identity === skillIdentity(name)
        );
        return sameBase || prerequisite;
      });
      const inherited = candidates.flatMap((candidate) =>
        (candidate.semantics?.ignoreDefense ?? [])
          .filter((entry) =>
            entry.kind === "ignore-defense" &&
            entry.scope === "skill-local" &&
            [
              "skill-base",
              "additive-per-stack",
              "additive-to-target-per-stack",
            ].includes(entry.aggregation)
          )
          .map((entry) => ({ candidate, entry }))
      );
      const values = unique(inherited.map(({ entry }) => entry.percent));
      if (values.length !== 1 || !inherited.length) continue;
      const source = inherited[0];
      skill.semantics.ignoreDefense.push({
        ...source.entry,
        activation: "inherited",
        inheritedFrom: source.candidate.name,
        evidence: `공식 설명의 생략값을 ${source.candidate.name}에서 상속`,
      });
      skill.semantics.inheritedMechanics = [{
        kind: "ignore-defense",
        fromSkill: source.candidate.name,
        reason: "explicit-omitted-value",
      }];
      skill.semantics.reviewRequired = false;
    }

    // 하이퍼 패시브처럼 다른 스킬의 효과를 수정하는 항목은 대상 스킬의
    // 보스 적용 여부를 상속한다. 예: 퍼지 에어리어는 보스 제외이므로
    // 인핸스가 수치를 올려도 보스에게 적용되는 디버프로 바뀌지 않는다.
    for (const skill of skills) {
      for (const mechanic of skill.semantics?.ignoreDefense ?? []) {
        if (mechanic.bossApplicable !== null) continue;
        const targets = skill.semantics?.targetSkillNames ?? [];
        const targetSkills = skills.filter((candidate) => targets.some((target) => {
          const targetBase = baseSkillIdentity(target);
          return candidate.identity === skillIdentity(target) ||
            (targetBase && candidate.baseIdentity === targetBase);
        }));
        const relevant = targetSkills.flatMap((candidate) =>
          candidate.semantics?.ignoreDefense ?? []
        ).filter((entry) =>
          mechanic.kind.startsWith("target-defense-reduction")
            ? entry.kind === "target-defense-reduction"
            : entry.kind === "ignore-defense"
        );
        mechanic.bossApplicable = relevant.length
          ? relevant.some((entry) => entry.bossApplicable !== false)
          : true;
      }
    }
    reviewRequiredCount += skills.filter((skill) =>
      skill.semantics?.reviewRequired
    ).length;
    const classProfileEntry = profileByClass.get(characterClass) ?? {
      skills: new Map(),
      sampleCount: null,
      aggregation: null,
    };
    const classProfile = classProfileEntry.skills;
    const classOverrides = aliasOverridesByClass.get(characterClass) ?? new Map();
    const matchedProfileNames = new Set();
    let matchedDamageShare = 0;
    const matchMethodCounts = {};
    for (const entry of classProfile.values()) {
      const resolved = resolveObservedProfileSkill(
        entry,
        skills,
        classOverrides,
      );
      if (!resolved) continue;
      const match = resolved.skill;
      matchedProfileNames.add(entry.name);
      matchedDamageShare += entry.weight;
      matchMethodCounts[resolved.method] =
        (matchMethodCounts[resolved.method] ?? 0) + 1;
      match.battlePractice.observed = true;
      match.battlePractice.matchedName ??= entry.name;
      match.battlePractice.meanDamageShare =
        (match.battlePractice.meanDamageShare ?? 0) + entry.weight;
      match.battlePractice.matches.push({
        name: entry.name,
        meanDamageShare: entry.weight,
        method: resolved.method,
      });
      if (entry.name !== match.name && !match.aliases.includes(entry.name)) {
        match.aliases.push(entry.name);
        match.aliasEvidence.push({
          alias: entry.name,
          method: resolved.method,
          evidence: resolved.evidence,
          note: resolved.note ?? null,
        });
      }
    }
    totalSkillCount += skills.length;
    classes[characterClass] = {
      sampleCount,
      gradeSnapshotCoverage: Object.fromEntries(
        CHARACTER_SKILL_GRADES.map((grade) => [
          grade,
          sampleCount
            ? (classGradeSampleNames.get(characterClass)?.get(grade)?.size ?? 0) /
              sampleCount
            : 0,
        ]),
      ),
      gradeCoverage: Object.fromEntries(CHARACTER_SKILL_GRADES.map((grade) => [
        grade,
        skills.filter((skill) => skill.grades.includes(grade)).length,
      ])),
      skillCount: skills.length,
      battlePracticeCoverage: {
        sampleCount: classProfileEntry.sampleCount,
        aggregation: classProfileEntry.aggregation,
        observedSkillCount: classProfile.size,
        matchedSkillCount: matchedProfileNames.size,
        matchedDamageShare: Math.min(1, matchedDamageShare),
        matchMethodCounts,
        unmatchedSkills: [...classProfile.values()]
          .filter((entry) => !matchedProfileNames.has(entry.name))
          .map((entry) => ({ name: entry.name, weight: entry.weight }))
          .sort((left, right) => right.weight - left.weight),
      },
      skills,
    };
  }

  const payload = {
    schema: "maplestarforce.skill-dictionary.v1",
    generatedAt: new Date().toISOString(),
    source: {
      provider: "NEXON Open API character/skill",
      grades: CHARACTER_SKILL_GRADES,
      method: "multi-character-union",
      limitation: "character snapshots are not an authoritative static catalog",
    },
    coverage: {
      classCount: Object.keys(classes).length,
      sampleCount: [...classSampleNames.values()].reduce(
        (sum, names) => sum + names.size,
        0,
      ),
      totalSkillCount,
      reviewRequiredCount,
    },
    classes,
  };
  payload.contentHash = createHash("sha256")
    .update(JSON.stringify(payload.classes))
    .digest("hex");
  return payload;
}

export function slimSkillDictionary(dictionary) {
  return {
    schema: "maplestarforce.skill-mechanics.v1",
    generatedAt: dictionary.generatedAt,
    contentHash: dictionary.contentHash,
    classes: Object.fromEntries(Object.entries(dictionary.classes ?? {}).map(
      ([characterClass, entry]) => [characterClass, {
        skillCount: entry.skillCount,
        skills: entry.skills
          .filter((skill) =>
            skill.semantics?.ignoreDefense?.length ||
            skill.semantics?.targetSkillNames?.length ||
            skill.battlePractice?.observed
          )
          .map((skill) => ({
            name: skill.name,
            identity: skill.identity,
            baseIdentity: skill.baseIdentity,
            category: skill.category,
            semantics: skill.semantics,
            aliases: skill.aliases,
            battlePractice: skill.battlePractice,
          })),
      }],
    )),
  };
}
