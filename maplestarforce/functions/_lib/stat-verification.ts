import {
  calculateActiveSkillCycleBonuses,
  calculateCombatRingBonuses,
  loadedDiceOutcomes,
  reconstructCharacterStats,
  type PresetPolicy,
} from "maple-core/stat-efficiency";
import type { CharacterPotentialData, JsonObject } from "./nexon";

const ATTACK_FIELDS = ["공격력", "마력"] as const;
const DEFAULT_SHARP_EYES = { rate: 20, damage: 15 };

type StatRow = { stat_name: string; stat_value: string };
type StatValues = Record<string, number>;

export function statDataWithValues(statData: JsonObject, values?: StatValues) {
  if (!values || !Array.isArray(statData.final_stat)) return statData;
  return {
    ...statData,
    final_stat: (statData.final_stat as StatRow[]).map((row) => Object.hasOwn(values, row.stat_name)
      ? { ...row, stat_value: String(values[row.stat_name]) } : row),
  };
}

function agrees(name: string, computed: number, observed: number) {
  // NEXON displays fractional combat stats to two decimals, and final
  // attack and attributes as integers. Compare in the API's displayed units.
  const multiplier = ATTACK_FIELDS.some((field) => field === name) ||
    /^(STR|DEX|INT|LUK)$/u.test(name) ? 1 : 100;
  return Math.round((computed + 1e-9) * multiplier) === Math.round(observed * multiplier);
}

const withMultiplier = (total: number, bonus: number) =>
  total + (100 + total) * bonus / 100;

function sharpEyesEffect(text: string) {
  const match = text.match(
    /크리티컬 확률\s*(\d+(?:\.\d+)?)%,\s*크리티컬 데미지\s*(\d+(?:\.\d+)?)%/u,
  );
  return match ? { rate: Number(match[1]), damage: Number(match[2]) } : null;
}

function learnedSkillEffects(snapshot: CharacterPotentialData["snapshot"]) {
  return (snapshot.skillData ?? []).flatMap((grade) =>
    Array.isArray(grade.character_skill) ? grade.character_skill as JsonObject[] : [])
    .filter((skill) => Number(skill.skill_level) > 0);
}

export function reconstructBossPresetStats(
  data: CharacterPotentialData,
  mainStat: string,
  attackType: "attack" | "magic",
  presetMode: PresetPolicy["mode"],
) {
  const { character, snapshot } = data;
  const source = reconstructCharacterStats({
    character, snapshot, mainStat, attackType, presetMode,
    activeSkillNames: ["익스트림 아쳐리 : 활", "익스트림 아쳐리 : 석궁"],
  });
  if (!source) return { source, includedNativeSharpEyesDamage: null };

  // Lete maintains their own summons in a boss fight. An equipped Covenant
  // on another class does not establish that the summon condition is met.
  if (character.character_class === "레테") source.computed["데미지"] += source.summonedLinkDamage;

  const learnedSkills = learnedSkillEffects(snapshot);
  const effect = (name: string) => String(
    learnedSkills.find(({ skill_name }) => skill_name === name)?.skill_effect ?? "",
  );
  const sharpEyes = sharpEyesEffect(effect("샤프 아이즈"));
  if (!sharpEyes) return { source, includedNativeSharpEyesDamage: null };

  // For the selected boss build, use the learned native buff and its Hyper
  // enhancements independently of the current character's buff uptime.
  const hyperRate = Number(effect("샤프 아이즈-크리티컬 레이트")
    .match(/크리티컬 확률\s*(\d+)%/u)?.[1]) || 0;
  const hyperIed = Number(effect("샤프 아이즈-이그노어 가드")
    .match(/방어율 무시 효과\s*(\d+)%/u)?.[1]) || 0;
  source.computed["크리티컬 확률"] += sharpEyes.rate + hyperRate;
  source.computed["크리티컬 데미지"] += sharpEyes.damage;
  source.computed["방어율 무시"] = 100 -
    (100 - source.computed["방어율 무시"]) * (1 - hyperIed / 100);
  return { source, includedNativeSharpEyesDamage: sharpEyes.damage };
}

export function verifyCharacterStats(
  data: CharacterPotentialData,
  mainStat?: string,
  normalizeBuffs = true,
) {
  const { character, snapshot } = data;
  const original = snapshot.statData;
  const rows = Array.isArray(original.final_stat) ? original.final_stat as StatRow[] : [];
  const observed = Object.fromEntries(rows.flatMap(({ stat_name, stat_value }) => {
    const text = String(stat_value ?? "").trim().replaceAll(",", "");
    const value = Number(text);
    return text && Number.isFinite(value) ? [[stat_name, value]] : [];
  }));
  const input = { character, snapshot, mainStat };
  let source = reconstructCharacterStats(input);
  const learnedSkills = learnedSkillEffects(snapshot);
  const skill = (name: string) =>
    learnedSkills.find(({ skill_name }) => skill_name === name);
  const skillEffect = (name: string) => String(skill(name)?.skill_effect ?? "");
  const extremeArchery = "익스트림 아쳐리 : 활";
  if (source && normalizeBuffs && skill(extremeArchery) &&
    !agrees("최종 데미지", source.computed["최종 데미지"], observed["최종 데미지"])) {
    const candidate = reconstructCharacterStats({ ...input, activeSkillNames: [extremeArchery] });
    if (candidate && agrees("최종 데미지", candidate.computed["최종 데미지"], observed["최종 데미지"])) {
      source = candidate;
    }
  }
  const computed = source?.computed ?? {};
  if (source && source.summonedLinkDamage > 0) {
    const withSummon = computed["데미지"] + source.summonedLinkDamage;
    if (agrees("데미지", withSummon, observed["데미지"])) computed["데미지"] = withSummon;
  }
  const verified: StatValues = {};
  const buffs = new Map<string, string>();
  const knownBuff = (predicted: StatValues) => {
    const fields = Object.keys(predicted);
    return fields.every((field) =>
      Number.isFinite(computed[field]) && agrees(field, predicted[field], observed[field])) &&
      fields.some((field) => !agrees(field, computed[field], observed[field]))
      ? fields : null;
  };
  const applyBuff = (name: string, fields: string[]) => {
    for (const field of fields) {
      verified[field] = computed[field];
      buffs.set(field, name);
    }
  };

  for (const [name, value] of Object.entries(computed)) {
    if (agrees(name, value, observed[name])) verified[name] = value;
  }
  const diceOutcomes = loadedDiceOutcomes(snapshot.skillData);
  let diceState = diceOutcomes ? "unresolved" : null;
  let includedNativeSharpEyesDamage: number | null = null;

  const pet = snapshot.petEquipmentData;
  const petPrefix = String(pet?.pet_activate_flag) === "1" ? "world_share_pet_" : "pet_";
  const registeredPetSkills = [...new Set([1, 2, 3].flatMap((number) => {
    const slot = pet?.[`${petPrefix}${number}_auto_skill`] as JsonObject | undefined;
    return [slot?.skill_1, slot?.skill_2]
      .filter((skill): skill is string => typeof skill === "string" && Boolean(skill.trim()))
      .map((skill) => skill.trim());
  }))];

  if (source && normalizeBuffs) {
    const nativeSharpEyes = sharpEyesEffect(skillEffect("샤프 아이즈"));
    const sharpEyesCandidate = ({ rate, damage }: { rate: number; damage: number }) => ({
      "크리티컬 확률": computed["크리티컬 확률"] + rate,
      "크리티컬 데미지": computed["크리티컬 데미지"] + damage,
    });
    if (nativeSharpEyes) {
      const candidates = [nativeSharpEyes];
      // The API can list the Combat Orders level while the active buff
      // still has the effect of the original level when it was cast.
      if (Number(skill("샤프 아이즈")?.skill_level) === 31 &&
        skill("쓸만한 컴뱃 오더스") &&
        nativeSharpEyes.rate === 21 && nativeSharpEyes.damage === 16) {
        candidates.push(DEFAULT_SHARP_EYES);
      }
      const hyperRate = Number(skillEffect("샤프 아이즈-크리티컬 레이트")
        .match(/크리티컬 확률\s*(\d+)%/u)?.[1]) || 0;
      const match = candidates.find(({ rate, damage }) => knownBuff(
        sharpEyesCandidate({ rate: rate + hyperRate, damage })));
      if (match) {
        const critical = sharpEyesCandidate({ rate: match.rate + hyperRate, damage: match.damage });
        Object.assign(computed, critical);
        Object.assign(verified, critical);
        includedNativeSharpEyesDamage = match.damage;

        const hyperIed = Number(skillEffect("샤프 아이즈-이그노어 가드")
          .match(/방어율 무시 효과\s*(\d+)%/u)?.[1]) || 0;
        const ignoreDefense = 100 - (100 - computed["방어율 무시"]) * (1 - hyperIed / 100);
        if (hyperIed && agrees("방어율 무시", ignoreDefense, observed["방어율 무시"])) {
          computed["방어율 무시"] = ignoreDefense;
          verified["방어율 무시"] = ignoreDefense;
        }
      }
    }
    const sharpEyesName = "쓸만한 샤프 아이즈";
    const sharpEyes = sharpEyesEffect(skillEffect(sharpEyesName));
    if (sharpEyes && includedNativeSharpEyesDamage === null) {
      const fields = knownBuff(sharpEyesCandidate(sharpEyes));
      if (fields) applyBuff(sharpEyesName, fields);
    }

    const aura = skillEffect("오라 웨폰");
    const iedBonus = Number(aura.match(/방어율 무시\s*(\d+(?:\.\d+)?)%/u)?.[1]);
    const finalDamageBonus = Number(aura.match(/최종 데미지\s*(\d+(?:\.\d+)?)%/u)?.[1]);
    if (iedBonus > 0 && finalDamageBonus > 0) {
      const fields = knownBuff({
        "방어율 무시": 100 - (100 - computed["방어율 무시"]) * (1 - iedBonus / 100),
        "최종 데미지": withMultiplier(computed["최종 데미지"], finalDamageBonus),
      });
      if (fields && calculateActiveSkillCycleBonuses(snapshot.skillData, "attack", 360)
        .applied.some(({ name, ignoreDefense, finalDamage }) =>
          name === "오라 웨폰" && ignoreDefense === iedBonus && finalDamage === finalDamageBonus)) {
        applyBuff("오라 웨폰", fields);
      }
    }

    const ring = calculateCombatRingBonuses(
      snapshot.equipmentData, snapshot.ringReserveData, snapshot.skillData,
      "attack", 360, String(character.character_class ?? ""),
    ).applied.find(({ name }) => name === "컨티뉴어스 링" || name === "챌린저스 컨티뉴어스 링");
    if (ring && ring.bossDamage > 0 && ATTACK_FIELDS.every((field) => source.attack[field].flat > 0)) {
      const attackWithRing = (field: typeof ATTACK_FIELDS[number], bonus: number) => {
        const { flat, percent } = source.attack[field];
        return Math.floor(flat * (1 + (percent + bonus) / 100) + 1e-8);
      };
      const fields = knownBuff({
        "보스 몬스터 데미지": computed["보스 몬스터 데미지"] + ring.bossDamage,
        "공격력": attackWithRing("공격력", ring.attackPercent),
        "마력": attackWithRing("마력", ring.magicPercent),
      });
      if (fields) applyBuff(ring.name, fields);
    }

    if (diceOutcomes?.length) {
      const comparable = { ...observed, ...verified };
      const diceFields = ["데미지", "공격력", "크리티컬 확률", "방어율 무시"];
      const controlFields = ["마력", "보스 몬스터 데미지", "크리티컬 데미지"];
      const agreesWith = (prediction: StatValues, names: string[]) =>
        names.every((name) => agrees(name, prediction[name], comparable[name]));
      if (agreesWith(computed, diceFields)) {
        diceState = "base-matched";
      } else if (agreesWith(computed, controlFields)) {
        const rawAttack = source.attack["공격력"];
        const matches = diceOutcomes.flatMap((outcome) => {
          const candidate = {
            데미지: computed["데미지"] + outcome.damage,
            공격력: Math.floor((rawAttack.flat + outcome.flatAttack) *
              (1 + rawAttack.percent / 100) + 1e-8),
            "크리티컬 확률": computed["크리티컬 확률"] + outcome.criticalRate,
            "방어율 무시": 100 - (100 - computed["방어율 무시"]) * (1 - outcome.ignoreDefense / 100),
          };
          return agreesWith(candidate, diceFields) ? [outcome] : [];
        });
        if (matches.length === 1) {
          const { rolls } = matches[0];
          const changed = diceFields.filter((name) => !agrees(name, computed[name], comparable[name]));
          applyBuff(`럭키 다이스 ${rolls.join("·")}`, changed);
          diceState = "included";
        }
      }
    }
  }

  const comparison = Object.entries(observed).filter(([name]) =>
    /^(?:STR|DEX|INT|LUK|HP|공격력|마력|데미지|보스 몬스터 데미지|크리티컬 (?:확률|데미지)|방어율 무시|최종 데미지)$/u.test(name))
    .map(([name, api]) => ({
      name,
      api,
      calculated: computed[name] ?? null,
      buff: buffs.get(name) ?? null,
      matched: Object.hasOwn(verified, name) && !buffs.has(name),
    }));
  const statData = statDataWithValues(original, verified);
  return { stats: statData, comparison, registeredPetSkills, diceState, includedNativeSharpEyesDamage };
}
