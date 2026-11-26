export function skillCooldown(effect) {
  const text = String(effect ?? "");
  // 부가 효과의 대기시간도 같은 문구를 쓸 수 있어 독립된 표기를 우선한다.
  const match = text.match(/^재사용 대기시간\s*:?\s*(\d+(?:\.\d+)?)초/mu) ??
    text.match(/재사용 대기시간\s*:?\s*(\d+(?:\.\d+)?)초/u);
  return Number(match?.[1] ?? 0);
}

export function effectiveSkillCooldown(skill, baseCooldown, reduction) {
  if (!(baseCooldown > 0) || !reduction) return baseCooldown;
  const tooltip = `${skill?.skill_description ?? ""}\n${skill?.skill_effect ?? ""}`;
  const exempt = /재사용 대기시간(?:\s*초기화\s*(?:및|와|,))?\s*감소(?:\s*(?:및|와|,\s*)\s*초기화)?(?:의)?(?:\s*효과)?(?:를|가)?\s*(?:받지\s*않|적용되지\s*않|미적용|적용\s*불가)/u;
  if (exempt.test(tooltip)) return baseCooldown;

  // https://maplestory.nexon.com/Guide/N23GameInformation/Articles/390
  // 초기화 불가는 장비·유니온 쿨감 불가와 별개다.
  const afterPercent = baseCooldown * (1 - reduction.unionPercent / 100);
  const flatSeconds = reduction.equipmentSeconds;
  if (!(flatSeconds > 0) || afterPercent <= 5) return afterPercent;
  const secondsAboveTen = Math.max(0, afterPercent - 10);
  if (flatSeconds <= secondsAboveTen) return afterPercent - flatSeconds;
  const shortCooldown = Math.min(10, afterPercent);
  return Math.max(5, shortCooldown * (1 - (flatSeconds - secondsAboveTen) * 0.05));
}
