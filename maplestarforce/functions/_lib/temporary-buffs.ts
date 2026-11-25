import type { CharacterPotentialData, JsonObject } from "./nexon";
import { calculateCombatRingBonuses, calculateConditionalLinkCycleBonuses } from "maple-core/stat-efficiency";

type CriticalStats = { criticalRate: number; criticalDamage: number };
type SharpEyesReading = CriticalStats & { basis: string };
type ContinuousRingStats = { attack: number; magic: number; bossDamage: number };
type ContinuousRingReading = ContinuousRingStats & { basis: string };
type ConditionalLinkReading = { basis: string; damage: number };
const LINK_STAT_BUFFS = new Set(["무아", "전투의 흐름", "시프 커닝", "프라이어 프리퍼레이션"]);
const SHARP_EYES_STATS = {
  criticalRate: "크리티컬 확률",
  criticalDamage: "크리티컬 데미지",
} as const;
const CONTINUOUS_RING_STATS = {
  attack: "공격력",
  magic: "마력",
  bossDamage: "보스 몬스터 데미지",
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
  const sharpEyesName = skillEffect("샤프 아이즈") ? "샤프 아이즈" : "쓸만한 샤프 아이즈";
  const sharpEyesEffect = skillEffect(sharpEyesName).match(
    /크리티컬 확률\s*(\d+(?:\.\d+)?)%,\s*크리티컬 데미지\s*(\d+(?:\.\d+)?)%/u,
  );
  const sharpEyes = sharpEyesEffect && validStat(criticalRate) && validStat(criticalDamage)
    ? {
        basis: await basisFor(Object.values(SHARP_EYES_STATS), sharpEyesName),
        name: sharpEyesName,
        criticalRate,
        criticalDamage,
        effect: { criticalRate: Number(sharpEyesEffect[1]), criticalDamage: Number(sharpEyesEffect[2]) },
      }
    : null;
  const ring = calculateCombatRingBonuses(
    snapshot.equipmentData, snapshot.ringReserveData, skillData, "attack", 360,
    String(character.character_class ?? ""),
  ).applied.find(({ name }) => name === "컨티뉴어스 링" || name === "챌린저스 컨티뉴어스 링");
  const attack = stat(CONTINUOUS_RING_STATS.attack);
  const magic = stat(CONTINUOUS_RING_STATS.magic);
  const bossDamage = stat(CONTINUOUS_RING_STATS.bossDamage);
  const continuousRing = ring && ring.bossDamage > 0 &&
      [attack, magic, bossDamage].every(validStat)
    ? {
        basis: await basisFor(
          [...Object.values(CONTINUOUS_RING_STATS), ...Object.values(SHARP_EYES_STATS)],
          sharpEyes?.name,
        ),
        name: ring.name,
        attack,
        magic,
        bossDamage,
        effect: {
          attackPercent: ring.attackPercent, magicPercent: ring.magicPercent, bossDamage: ring.bossDamage,
        },
      }
    : null;
  const damage = stat("데미지");
  const linkDamageBonuses = calculateConditionalLinkCycleBonuses(setup.linkSkillData)
    .applied.filter(({ name }) => LINK_STAT_BUFFS.has(String(name)))
    .map(({ damage, uptime }) => Number(damage) / Number(uptime));
  const conditionalLinks = validStat(damage) && linkDamageBonuses.length
    ? {
        basis: await basisFor([
          "데미지", "방어율 무시", "최종 데미지",
          ...Object.values(CONTINUOUS_RING_STATS), ...Object.values(SHARP_EYES_STATS),
        ]),
        name: "조건부 링크",
        damage,
        damageBonuses: linkDamageBonuses,
      }
    : null;
  return { registeredPetSkills, auraWeapon, sharpEyes, continuousRing, conditionalLinks };
}

function validStat(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseBuffReference<T extends string>(
  value: string | null,
  fields: readonly T[],
): ({ basis: string } & Record<T, number>) | null {
  if (!value || value.length > 256) return null;
  try {
    const reference = JSON.parse(value);
    if (typeof reference?.basis === "string" && /^[0-9a-f]{64}$/u.test(reference.basis) &&
      fields.every((field) => validStat(reference[field]))) {
      return { basis: reference.basis, ...Object.fromEntries(fields.map((field) => [field, reference[field]])) } as
        { basis: string } & Record<T, number>;
    }
  } catch {
    // 저장 기준을 읽을 수 없으면 기존 API 스탯으로 계산한다.
  }
  return null;
}

export function parseSharpEyesReference(value: string | null): SharpEyesReading | null {
  return parseBuffReference(value, ["criticalRate", "criticalDamage"]);
}

export function parseContinuousRingReference(value: string | null): ContinuousRingReading | null {
  return parseBuffReference(value, ["attack", "magic", "bossDamage"]);
}

export function parseConditionalLinkReference(value: string | null): ConditionalLinkReading | null {
  return parseBuffReference(value, ["damage"]);
}

function restoreStats(statData: JsonObject, values: Record<string, number>): JsonObject {
  return {
    ...statData,
    final_stat: records(statData.final_stat).map((row) => {
      const name = String(row.stat_name);
      return Object.hasOwn(values, name)
        ? { ...row, stat_value: String(values[name]) }
        : row;
    }),
  };
}

export function restoreConditionalLinkOffStats(
  statData: JsonObject,
  current: (ConditionalLinkReading & { damageBonuses: number[] }) | null,
  reference: ConditionalLinkReading | null,
): JsonObject | undefined {
  if (!current || !reference || current.basis !== reference.basis ||
    current.damage <= reference.damage) return undefined;

  // 사진과 API에서 확인한 캐릭터 스탯창 버프만 비교한다. 대상에게
  // 붙는 임피리컬 널리지 등의 효과는 스탯창 데미지에서 제거하지 않는다.
  const gains = current.damageBonuses.reduce(
    (totals, bonus) => [...totals, ...totals.map((total) => total + bonus)], [0],
  );
  const observedGain = current.damage - reference.damage;
  return gains.some((gain) => gain > 0 && Math.abs(gain - observedGain) <= 0.011)
    ? restoreStats(statData, { 데미지: reference.damage })
    : undefined;
}

export function restoreSharpEyesOffStats(
  statData: JsonObject,
  current: (SharpEyesReading & { effect: CriticalStats }) | null,
  reference: SharpEyesReading | null,
): JsonObject | undefined {
  if (
    !current || !reference || current.basis !== reference.basis ||
    Math.abs(current.criticalRate - reference.criticalRate - current.effect.criticalRate) > 0.011 ||
    Math.abs(current.criticalDamage - reference.criticalDamage - current.effect.criticalDamage) > 0.011
  ) return undefined;

  return restoreStats(statData, {
    [SHARP_EYES_STATS.criticalRate]: reference.criticalRate,
    [SHARP_EYES_STATS.criticalDamage]: reference.criticalDamage,
  });
}

export function restoreContinuousRingOffStats(
  statData: JsonObject,
  current: (ContinuousRingReading & {
    effect: { bossDamage: number; attackPercent: number; magicPercent: number };
  }) | null,
  reference: ContinuousRingReading | null,
): JsonObject | undefined {
  if (!current || !reference || current.basis !== reference.basis ||
    Math.abs(current.bossDamage - reference.bossDamage - current.effect.bossDamage) > 0.011) {
    return undefined;
  }
  // 공·마 %는 기본 공·마에 붙는다. 다른 공·마 %가 포함된 최종값
  // 기준으로는 상승폭이 반지 표기 %를 넘지 않는다.
  const plausibleGain = (gain: number, off: number, percent: number) =>
    gain >= 0 && gain <= off * percent / 100 + 1;
  const attackGain = current.attack - reference.attack;
  const magicGain = current.magic - reference.magic;
  if (!(attackGain > 0 || magicGain > 0) ||
    !plausibleGain(attackGain, reference.attack, current.effect.attackPercent) ||
    !plausibleGain(magicGain, reference.magic, current.effect.magicPercent)) return undefined;
  return restoreStats(statData, {
    [CONTINUOUS_RING_STATS.attack]: reference.attack,
    [CONTINUOUS_RING_STATS.magic]: reference.magic,
    [CONTINUOUS_RING_STATS.bossDamage]: reference.bossDamage,
  });
}
