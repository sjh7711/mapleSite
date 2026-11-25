import type { CharacterPotentialData, JsonObject } from "./nexon";

function records(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonObject => !!item && typeof item === "object")
    : [];
}

export async function characterTemporaryBuffs(data: CharacterPotentialData) {
  const { character, snapshot } = data;
  const { statData, petEquipmentData, skillData, ...setup } = snapshot;
  const prefix = String(petEquipmentData?.pet_activate_flag) === "1"
    ? "world_share_pet_" : "pet_";
  const registeredPetSkills = [...new Set([1, 2, 3].flatMap((number) => {
    const slot = petEquipmentData?.[`${prefix}${number}_auto_skill`] as
      JsonObject | undefined;
    return [slot?.skill_1, slot?.skill_2]
      .map((skill) => typeof skill === "string" ? skill.trim() : "")
      .filter(Boolean);
  }))];

  const skill = skillData.flatMap((grade) => records(grade.character_skill))
    .find((item) => item.skill_name === "오라 웨폰" && Number(item.skill_level) > 0);
  const description = String(skill?.skill_effect ?? "");
  const ignoreDefense = Number(description.match(/방어율 무시\s*(\d+(?:\.\d+)?)%/u)?.[1]);
  const finalDamage = Number(description.match(/최종 데미지\s*(\d+(?:\.\d+)?)%/u)?.[1]);
  const stats = records(statData?.final_stat);
  const stat = (name: string) => Number(stats.find((row) => row.stat_name === name)?.stat_value);
  const currentIgnoreDefense = stat("방어율 무시");
  const currentFinalDamage = stat("최종 데미지");
  if (
    !(ignoreDefense > 0 && ignoreDefense < 100 && finalDamage > 0) ||
    !(currentIgnoreDefense >= 0 && currentIgnoreDefense < 100 && currentFinalDamage >= 0)
  ) return { registeredPetSkills, auraWeapon: null };

  // 오라 웨폰의 영향을 받는 항목을 제외한 스냅샷이 일치할 때만 비교한다.
  const stableStats = stats
    .filter(({ stat_name }) =>
      !/^(?:방어율 무시|최종 데미지)$|스탯\s*공격력/u.test(String(stat_name)))
    .map(({ stat_name, stat_value }) => [stat_name, stat_value])
    .sort(([a], [b]) => String(a).localeCompare(String(b)));
  const fingerprint = JSON.stringify({
    character: [character.world_name, character.character_name, character.character_class,
      character.character_level],
    setup, petEquipmentData, skillData, stableStats,
  }, (key, value) => key === "date" ? undefined : value);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprint));
  const basis = [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return {
    registeredPetSkills,
    auraWeapon: {
      basis,
      ignoreDefense: currentIgnoreDefense,
      finalDamage: currentFinalDamage,
      effect: { ignoreDefense, finalDamage },
    },
  };
}
