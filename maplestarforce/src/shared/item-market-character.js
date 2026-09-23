import { parsePotentialOption } from "maple-core/potential";

const GRADES = { 레어: "rare", 에픽: "epic", 유니크: "unique", 레전드리: "legendary" };
const STATS = {
  str: "str_flat", dex: "dex_flat", int: "int_flat", luk: "luk_flat",
  max_hp: "hp_flat", all_stat: "all_stat_pct", attack_power: "attack_flat",
  magic_power: "magic_attack_flat", damage: "damage_pct", boss_damage: "boss_damage_pct",
};
const METRICS = {
  allStatPercent: "ALL_STAT:pct", flatAllStat: "ALL_STAT:flat",
  maxHpPercent: "HP:pct", flatHp: "HP:flat",
  attackPercent: "ATTACK:pct", magicPercent: "MAGIC_ATTACK:pct",
  flatAttack: "ATTACK:flat", flatMagic: "MAGIC_ATTACK:flat",
  bossDamage: "BOSS_DAMAGE:pct", damage: "DAMAGE:pct", ignoreDefense: "IGNORE_DEFENSE:pct",
  criticalRate: "CRITICAL_RATE:pct", criticalDamage: "CRITICAL_DAMAGE:pct",
  cooldown: "COOLDOWN_REDUCTION:seconds", meso: "MESO_OBTAINED:pct", drop: "ITEM_DROP_RATE:pct",
  autoSteal: "AUTO_STEAL:pct",
};

export function marketPotentialFromCharacter(grade, lines = []) {
  const omitted = [];
  const parsed = lines.slice(0, 3).map((raw) => {
    // The character API uses the same official option wording as the calculator.
    const metrics = parsePotentialOption(String(raw).replace(/\s*:\s*/gu, " "));
    for (const [index, stat] of ["STR", "DEX", "INT", "LUK"].entries()) {
      for (const [key, type] of [["statPercent", `${stat}:pct`], ["flatStat", `${stat}:flat`],
        ["perNineStat", `STAT_PER_CHARACTER_LEVEL:${stat}`]]) {
        if (metrics[key]?.[index]) return { type, value: metrics[key][index] };
      }
    }
    for (const [key, type] of Object.entries(METRICS)) {
      if (metrics[key]) return { type, value: metrics[key] };
    }
    if (raw) omitted.push(raw);
    return { type: "", value: "" };
  });
  while (parsed.length < 3) parsed.push({ type: "", value: "" });
  return { section: { grade: GRADES[grade] || "none", lines: parsed }, omitted };
}

export function marketFieldsFromCharacterEquipment(item) {
  const tooltip = item.tooltip || {};
  // Do not interpret API sentinel/out-of-range values (for example 255 on
  // untradeable weapons) as a marketable item's remaining scissors count.
  const cuttable = Number.isInteger(tooltip.cuttableCount) && tooltip.cuttableCount >= 0 &&
    tooltip.cuttableCount <= 100 ? tooltip.cuttableCount : null;
  const flame = Object.fromEntries(Object.values(STATS).map((key) => [key, 0]));
  const scroll = { ...flame };
  for (const option of tooltip.options || []) {
    const key = STATS[option.key];
    if (!key) continue;
    flame[key] = Math.max(0, Number(option.add) || 0);
    scroll[key] = Math.max(0, Number(option.etc) || 0);
  }
  const potential = marketPotentialFromCharacter(item.potentialGrade, tooltip.potentialLines);
  const additional = marketPotentialFromCharacter(item.additionalPotentialGrade, tooltip.additionalPotentialLines);
  const upgraded = tooltip.scroll;
  const importedUpgrade = upgraded && ["upgraded", "upgradeable", "recoverable"]
    .every((key) => Number.isInteger(upgraded[key]) && upgraded[key] >= 0)
    ? { applied: upgraded.upgraded, remaining: upgraded.upgradeable, recoverable: upgraded.recoverable,
        source: "character_api", status: "confirmed", scroll: { ...scroll } }
    : null;
  return {
    fields: {
      itemName: item.name,
      starforce: Number(tooltip.starforce) || 0,
      potential: potential.section, additional: additional.section, flame, scroll,
      scissorsRemaining: cuttable ?? "",
      // Equipped items with scissors are valued in their sale-ready state.
      tradeState: cuttable > 0 ? "one_trade_left" : "",
      requiredLevelReduction: Number(tooltip.options?.find((option) =>
        option.key === "equipment_level_decrease")?.add) || 0,
      importedUpgrade,
    },
    omitted: [...potential.omitted, ...additional.omitted],
  };
}

export function unchangedImportedUpgrade(input) {
  const imported = input.importedUpgrade;
  if (!imported) return null;
  if (!Object.values(STATS).every((key) =>
    Number(input.scroll?.[key] || 0) === Number(imported.scroll?.[key] || 0))) return null;
  return imported;
}
