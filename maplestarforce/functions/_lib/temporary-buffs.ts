import type { CharacterPotentialData, JsonObject } from "./nexon";

type CriticalStats = { criticalRate: number; criticalDamage: number };
type SharpEyesReading = CriticalStats & { basis: string };
const SHARP_EYES_STATS = {
  criticalRate: "크리티컬 확률",
  criticalDamage: "크리티컬 데미지",
} as const;

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

  const learned = skillData.flatMap((grade) => records(grade.character_skill))
    .filter((item) => Number(item.skill_level) > 0);
  const skillEffect = (name: string) =>
    String(learned.find((item) => item.skill_name === name)?.skill_effect ?? "");
  const description = skillEffect("오라 웨폰");
  const ignoreDefense = Number(description.match(/방어율 무시\s*(\d+(?:\.\d+)?)%/u)?.[1]);
  const finalDamage = Number(description.match(/최종 데미지\s*(\d+(?:\.\d+)?)%/u)?.[1]);
  const stats = records(statData?.final_stat);
  const stat = (name: string) => Number(stats.find((row) => row.stat_name === name)?.stat_value ?? NaN);
  const currentIgnoreDefense = stat("방어율 무시");
  const currentFinalDamage = stat("최종 데미지");
  // 각 버프의 영향을 받는 스탯을 제외한 스냅샷이 일치할 때만 비교한다.
  const petGear = Object.fromEntries(Object.entries(petEquipmentData ?? {})
    .filter(([key]) => !key.endsWith("_auto_skill")));
  const basisFor = async (changedStats: readonly string[], comparedBuff?: string) => {
    const stableStats = stats
      .filter(({ stat_name }) =>
        !changedStats.includes(String(stat_name)) && !/스탯\s*공격력/u.test(String(stat_name)))
      .map(({ stat_name, stat_value }) => [stat_name, stat_value])
      .sort(([a], [b]) => String(a).localeCompare(String(b)));
    const fingerprint = JSON.stringify({
      character: [character.world_name, character.character_name, character.character_class,
        character.character_level],
      setup,
      petEquipmentData: comparedBuff ? petGear : petEquipmentData,
      activePetBuffs: comparedBuff
        ? registeredPetSkills.filter((skill) => skill !== comparedBuff).sort()
        : undefined,
      skillData, stableStats,
    }, (key, value) => key === "date" ? undefined : value);
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprint));
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  let auraWeapon = null;
  if (ignoreDefense > 0 && ignoreDefense < 100 && finalDamage > 0 &&
    currentIgnoreDefense >= 0 && currentIgnoreDefense < 100 && currentFinalDamage >= 0) {
    const columns = ["방어율 무시", "최종 데미지"];
    const [basis, legacyBasis] = await Promise.all([basisFor(columns, "오라 웨폰"), basisFor(columns)]);
    auraWeapon = {
      basis,
      legacyBasis,
      ignoreDefense: currentIgnoreDefense,
      finalDamage: currentFinalDamage,
      effect: { ignoreDefense, finalDamage },
    };
  }
  const criticalRate = stat(SHARP_EYES_STATS.criticalRate);
  const criticalDamage = stat(SHARP_EYES_STATS.criticalDamage);
  // 풀도핑에 이미 반영하는 +10/+8 버전만 보정한다.
  const sharpEyes = /크리티컬 확률\s*10%,\s*크리티컬 데미지\s*8%/u.test(skillEffect("쓸만한 샤프 아이즈")) &&
      validCriticalStat(criticalRate) && validCriticalStat(criticalDamage)
    ? {
        basis: await basisFor(Object.values(SHARP_EYES_STATS), "쓸만한 샤프 아이즈"),
        criticalRate,
        criticalDamage,
      }
    : null;
  return { registeredPetSkills, auraWeapon, sharpEyes };
}

function validCriticalStat(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function parseSharpEyesReference(value: string | null): SharpEyesReading | null {
  if (!value || value.length > 256) return null;
  try {
    const { basis, criticalRate, criticalDamage } = JSON.parse(value);
    if (
      typeof basis === "string" && /^[0-9a-f]{64}$/u.test(basis) &&
      validCriticalStat(criticalRate) && validCriticalStat(criticalDamage)
    ) return { basis, criticalRate, criticalDamage };
  } catch {
    // 저장 기준을 읽을 수 없으면 기존 API 스탯으로 계산한다.
  }
  return null;
}

export function restoreSharpEyesOffStats(
  statData: JsonObject,
  current: SharpEyesReading | null,
  reference: SharpEyesReading | null,
): JsonObject | undefined {
  if (
    !current || !reference || current.basis !== reference.basis ||
    Math.abs(current.criticalRate - reference.criticalRate - 10) > 0.011 ||
    Math.abs(current.criticalDamage - reference.criticalDamage - 8) > 0.011
  ) return undefined;

  const values = {
    [SHARP_EYES_STATS.criticalRate]: reference.criticalRate,
    [SHARP_EYES_STATS.criticalDamage]: reference.criticalDamage,
  };
  return {
    ...statData,
    final_stat: records(statData.final_stat).map((row) => {
      const name = String(row.stat_name);
      return Object.hasOwn(values, name)
        ? { ...row, stat_value: String(values[name as keyof typeof values]) }
        : row;
    }),
  };
}
