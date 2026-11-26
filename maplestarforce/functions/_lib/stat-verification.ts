import {
  bossCriticalEffects,
  covenantLinkDamage,
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
  { boss = false, includeMaintainedSummon = false } = {},
) {
  return reconstructCharacterStats({
    character, snapshot, mainStat, attackType, presetMode,
    activeSkillNames: boss ? ["익스트림 아쳐리 : 활", "익스트림 아쳐리 : 석궁"] : [],
    includeMaintainedSummon,
  });
}

function roundedStat(name: string, value: number) {
  const scale = /^(?:STR|DEX|INT|LUK|HP|공격력|마력)$/u.test(name) ? 1 : 100;
  return Math.round((value + 1e-9) * scale);
}

function conditionalStatMatches(
  snapshot: CharacterPotentialData["snapshot"],
  source: CharacterStatSources | null,
  maintainedSource: CharacterStatSources | null,
  apiByStat: Map<string, number>,
) {
  const matches = new Map<string, string>();
  if (!source) return matches;
  const base = source.computed;
  const recordMatch = (effect: string, values: Record<string, number>) => {
    const entries = Object.entries(values);
    if (!entries.every(([name, value]) => {
      const api = apiByStat.get(name);
      return api !== undefined && roundedStat(name, value) === roundedStat(name, api);
    })) return;
    for (const [name] of entries) matches.set(name, effect);
  };
  if (maintainedSource && maintainedSource.computed["최종 데미지"] !== base["최종 데미지"]) {
    recordMatch("익스트림 아쳐리", {
      "최종 데미지": maintainedSource.computed["최종 데미지"],
      공격력: maintainedSource.computed.공격력,
    });
  }
  const { sharpEyes } = bossCriticalEffects(snapshot.skillData, {});
  if (sharpEyes.name && sharpEyes.criticalRate > 0 && sharpEyes.criticalDamage > 0) {
    const sharpStats = (rate: number, damage: number) => ({
      "크리티컬 확률": base["크리티컬 확률"] + rate,
      "크리티컬 데미지": base["크리티컬 데미지"] + damage,
      ...(sharpEyes.ignoreDefense > 0 && {
        "방어율 무시": 100 - (100 - base["방어율 무시"]) * (1 - sharpEyes.ignoreDefense / 100),
      }),
    });
    const skillLabel = sharpEyes.level ? `${sharpEyes.name} Lv.${sharpEyes.level}` : sharpEyes.name;
    recordMatch(skillLabel, sharpStats(sharpEyes.criticalRate, sharpEyes.criticalDamage));
    // 넥슨 Lv.30·31 툴팁을 각각 확인했다. 현재 스킬 레벨과 이미 걸린 버프의 시전 레벨은 다를 수 있다.
    if (sharpEyes.name === "샤프 아이즈" && sharpEyes.level === 31 &&
        sharpEyes.criticalRate - sharpEyes.hyperRate === 21 && sharpEyes.criticalDamage === 16) {
      recordMatch("샤프 아이즈 Lv.30", sharpStats(20 + sharpEyes.hyperRate, 15));
    }
  }
  const covenant = covenantLinkDamage(snapshot.linkSkillData);
  if (covenant > 0) {
    recordMatch("커버넌트(소환수 유지)", { 데미지: base.데미지 + covenant });
  }
  return matches;
}

export function verifyCharacterStats(
  snapshot: CharacterPotentialData["snapshot"],
  source: CharacterStatSources | null,
  maintainedSource: CharacterStatSources | null,
) {
  const rows = Array.isArray(snapshot.statData.final_stat) ? snapshot.statData.final_stat as StatRow[] : [];
  const activeStats = rows.flatMap(({ stat_name: name, stat_value }) => {
    if (!/^(?:STR|DEX|INT|LUK|HP|공격력|마력|데미지|보스 몬스터 데미지|크리티컬 (?:확률|데미지)|방어율 무시|최종 데미지|버프 지속시간|상태이상 추가 데미지)$/u.test(name)) return [];
    const text = String(stat_value ?? "").trim().replaceAll(",", "");
    const api = Number(text);
    if (!text || !Number.isFinite(api)) return [];
    return [{ name, api }];
  });
  const apiByStat = new Map(activeStats.map(row => [row.name, row.api]));
  const explanations = conditionalStatMatches(snapshot, source, maintainedSource, apiByStat);
  const comparison = activeStats.map(({ name, api }) => {
    const calculated = source?.computed[name] ?? null;
    const matched = calculated !== null && roundedStat(name, calculated) === roundedStat(name, api);
    const conditionalMatch = matched ? undefined : explanations.get(name);
    return {
      name,
      api,
      calculated,
      matched,
      ...(conditionalMatch && { conditionalMatch }),
    };
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
