import { createCombatEffect } from "./combat-model.js";

// 말랑신쫑의 6기 3위 기록(2026-11-17, 336초). 스킬별 실측 피해를
// 재현 타격에 배분하고, 리레와 겹치는 구간을 포함해 피해 비중을 구했다.
const REN_SOUL_DAMAGE_COVERAGE = [
  [0, 0], [10, 0.38057], [12, 0.45685], [14, 0.51343], [16, 0.54282],
  [17.6, 0.56239], [18.6, 0.58107], [20, 0.60347], [22, 0.63008],
  [25, 0.66263], [30, 0.71573], [35, 0.77723], [40, 0.8513],
  [50, 0.94342], [60, 0.9978],
];
// 같은 캐릭터의 벞지 86% 소울 ON/OFF 보총뎀 +40 비교에서 역산한
// 유효 기여분을 18.6초 구간의 기준으로 삼고, 현재 벞지로 구간을 바꾼다.
const REN_SOUL_REFERENCE_RATIO = 38.77375 / (60 * 0.58107);
const REN_PRIOR_PREPARATION_DAMAGE_COVERAGE = 0.55579;
const REN_FATAL_STRIKE_DAMAGE_COVERAGE = 0.09683;

export function renConditionalLinkDamageCoverage(name, duration, cooldown) {
  if (name === "프라이어 프리퍼레이션" && duration === 20 && cooldown === 40) {
    return REN_PRIOR_PREPARATION_DAMAGE_COVERAGE;
  }
  if (name !== "소울 컨트랙트" || cooldown !== 60 || !(duration > 0)) {
    return null;
  }
  const upperIndex = REN_SOUL_DAMAGE_COVERAGE.findIndex(([seconds]) => seconds >= duration);
  if (upperIndex < 0) return 1;
  const [lowSeconds, lowShare] = REN_SOUL_DAMAGE_COVERAGE[upperIndex - 1];
  const [highSeconds, highShare] = REN_SOUL_DAMAGE_COVERAGE[upperIndex];
  const fraction = (duration - lowSeconds) / (highSeconds - lowSeconds);
  return Math.min(1, (lowShare + (highShare - lowShare) * fraction) * REN_SOUL_REFERENCE_RATIO);
}

export function calculateBossItemCombatEffects({
  symbolData, vMatrixData, characterClass,
} = {}) {
  const effects = [];
  // 보스 효율의 공통 기준에서는 장착한 만렙 어센틱심볼의 효과를 한 번만 반영한다.
  const symbol = symbolData?.symbol?.find((entry) =>
    /^(?:그랜드)?어센틱심볼:/u.test(String(entry?.symbol_name ?? "").replace(/\s+/gu, "")) &&
    Number(entry?.symbol_level) >= 11
  );
  if (symbol) {
    effects.push(createCombatEffect({
      layer: "target",
      source: symbol.symbol_name,
      kind: "boss-symbol",
      activation: { mode: "always", evidence: "equipped-level-11-authentic-symbol" },
      modifiers: { bossDamage: 20 },
      metadata: { level: Number(symbol.symbol_level) },
    }));
  }

  const hasFatalStrike = vMatrixData?.character_v_core_equipment?.some((core) =>
    String(core?.v_core_name ?? "").normalize("NFKC").trim() === "일격필살 I" &&
    Number(core?.v_core_level) > 0
  );
  if (hasFatalStrike) {
    const duration = 4;
    const cooldown = 30;
    const replayWeighted = characterClass === "렌";
    effects.push(createCombatEffect({
      layer: "common-skill",
      source: "일격필살 I",
      kind: "special-core",
      activation: {
        mode: replayWeighted ? "damage-weighted-estimate" : "cycle-average",
        evidence: replayWeighted ? "battle-practice-estimated-hit-timeline" : "equipped-v-core",
      },
      uptime: replayWeighted ? REN_FATAL_STRIKE_DAMAGE_COVERAGE : duration / cooldown,
      modifiers: { damage: 100 },
      metadata: { duration, cooldown },
    }));
  }
  return effects;
}
