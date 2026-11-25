import {
  calculateActiveSkillCycleBonuses,
  calculateCombatRingBonuses,
  loadedDiceOutcomes,
  reconstructCharacterStats,
} from "maple-core/stat-efficiency";
import type { CharacterPotentialData, JsonObject } from "./nexon";

const ATTACK_FIELDS = ["공격력", "마력"] as const;

type StatRow = { stat_name: string; stat_value: string };
type StatValues = Record<string, number>;

function agrees(name: string, computed: number, observed: number) {
  // NEXON displays fractional combat stats to two decimals, and final
  // attack and attributes as integers. Compare in the API's displayed units.
  const multiplier = ATTACK_FIELDS.some((field) => field === name) ||
    /^(STR|DEX|INT|LUK)$/u.test(name) ? 1 : 100;
  return Math.round((computed + 1e-9) * multiplier) === Math.round(observed * multiplier);
}

const withMultiplier = (total: number, bonus: number) =>
  total + (100 + total) * bonus / 100;

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
  const source = reconstructCharacterStats({ character, snapshot, mainStat });
  const computed = source?.computed ?? {};
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

  const pet = snapshot.petEquipmentData;
  const petPrefix = String(pet?.pet_activate_flag) === "1" ? "world_share_pet_" : "pet_";
  const registeredPetSkills = [...new Set([1, 2, 3].flatMap((number) => {
    const slot = pet?.[`${petPrefix}${number}_auto_skill`] as JsonObject | undefined;
    return [slot?.skill_1, slot?.skill_2]
      .filter((skill): skill is string => typeof skill === "string" && Boolean(skill.trim()))
      .map((skill) => skill.trim());
  }))];

  if (source && normalizeBuffs) {
    const learnedSkills = (snapshot.skillData ?? []).flatMap((grade) =>
      Array.isArray(grade.character_skill) ? grade.character_skill as JsonObject[] : [])
      .filter((skill) => Number(skill.skill_level) > 0);
    const skillEffect = (name: string) =>
      String(learnedSkills.find((skill) => skill.skill_name === name)?.skill_effect ?? "");
    const sharpEyesName = "쓸만한 샤프 아이즈";
    const sharpEyes = skillEffect(sharpEyesName).match(
      /크리티컬 확률\s*(\d+(?:\.\d+)?)%,\s*크리티컬 데미지\s*(\d+(?:\.\d+)?)%/u,
    );
    // The full-doping formula adds the core version. Native Sharp Eyes has
    // other conditional modifiers and needs its own modeled contribution.
    if (sharpEyes) {
      const fields = knownBuff({
        "크리티컬 확률": computed["크리티컬 확률"] + Number(sharpEyes[1]),
        "크리티컬 데미지": computed["크리티컬 데미지"] + Number(sharpEyes[2]),
      });
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
  const statData = {
    ...original,
    final_stat: rows.map((row) => Object.hasOwn(verified, row.stat_name)
      ? { ...row, stat_value: String(verified[row.stat_name]) } : row),
  };
  return { stats: statData, comparison, registeredPetSkills, diceState };
}
