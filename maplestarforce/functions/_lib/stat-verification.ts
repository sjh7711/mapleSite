import {
  reconstructCharacterStats,
  type CharacterStatSources,
  type PresetPolicy,
} from "maple-core/stat-efficiency";
import type { CharacterPotentialData, JsonObject } from "./nexon";

type StatRow = { stat_name: string; stat_value: string };

export function statDataWithValues(statData: JsonObject, values?: Record<string, number>) {
  if (!values || !Array.isArray(statData.final_stat)) return statData;
  return {
    ...statData,
    final_stat: (statData.final_stat as StatRow[]).map((row) => Object.hasOwn(values, row.stat_name)
      ? { ...row, stat_value: String(values[row.stat_name]) } : row),
  };
}

export function reconstructPresetSources(
  { character, snapshot }: CharacterPotentialData,
  mainStat: string,
  attackType: "attack" | "magic",
  presetMode: PresetPolicy["mode"],
  boss = false,
) {
  const source = reconstructCharacterStats({
    character, snapshot, mainStat, attackType, presetMode,
    activeSkillNames: boss ? ["익스트림 아쳐리 : 활", "익스트림 아쳐리 : 석궁"] : [],
  });

  // Lete maintains their own summons during the boss rotation.
  if (source && boss && character.character_class === "레테") {
    source.computed.데미지 += source.summonedLinkDamage;
  }
  return source;
}

export function verifyCharacterStats(
  snapshot: CharacterPotentialData["snapshot"],
  source: CharacterStatSources | null,
) {
  const rows = Array.isArray(snapshot.statData.final_stat) ? snapshot.statData.final_stat as StatRow[] : [];
  const comparison = rows.flatMap(({ stat_name: name, stat_value }) => {
    if (!/^(?:STR|DEX|INT|LUK|HP|공격력|마력|데미지|보스 몬스터 데미지|크리티컬 (?:확률|데미지)|방어율 무시|최종 데미지|버프 지속시간|상태이상 추가 데미지)$/u.test(name)) return [];
    const text = String(stat_value ?? "").trim().replaceAll(",", "");
    const api = Number(text);
    if (!text || !Number.isFinite(api)) return [];
    const calculated = source?.computed[name] ?? null;
    const scale = /^(?:STR|DEX|INT|LUK|HP|공격력|마력)$/u.test(name) ? 1 : 100;
    return [{
      name,
      api,
      calculated,
      matched: calculated !== null &&
        Math.round((calculated + 1e-9) * scale) === Math.round(api * scale),
    }];
  });

  const pet = snapshot.petEquipmentData;
  const petPrefix = String(pet?.pet_activate_flag) === "1" ? "world_share_pet_" : "pet_";
  const registeredPetSkills = [...new Set([1, 2, 3].flatMap((number) => {
    const slot = pet?.[`${petPrefix}${number}_auto_skill`] as JsonObject | undefined;
    return [slot?.skill_1, slot?.skill_2]
      .filter((skill): skill is string => typeof skill === "string" && Boolean(skill.trim()))
      .map((skill) => skill.trim());
  }))];
  return { comparison, registeredPetSkills };
}
