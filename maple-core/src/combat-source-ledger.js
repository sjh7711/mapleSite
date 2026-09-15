const LAYER_ORDER = Object.freeze([
  "baseline",
  "general",
  "common-skill",
  "class-skill",
  "target",
]);

function normalizedText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ");
}

function stableTextKey(value) {
  return normalizedText(value)
    .toLocaleLowerCase("ko-KR")
    .replace(/[()（）\[\]{}]/gu, "")
    .replace(/\s+/gu, "-");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function normalizedActivation(value, effect) {
  const supplied = value && typeof value === "object" ? value : {};
  const mode = normalizedText(supplied.mode) || (
    effect?.includedInBaseline
      ? "baseline-reflected"
      : Number(effect?.uptime) >= 1
        ? "maintained"
        : "cycle-average"
  );
  return {
    mode,
    evidence: normalizedText(supplied.evidence) || null,
    observedUseCount: Number.isFinite(Number(supplied.observedUseCount))
      ? Math.max(0, Number(supplied.observedUseCount))
      : null,
  };
}

/**
 * 사람이 읽는 스킬 이름과 계산용 출처 식별자를 분리한다.
 *
 * VI가 원본을 대체하는지, 같은 이름의 두 효과가 서로 다른 단계인지 같은
 * 의미는 호출부만 알 수 있으므로 이름을 임의로 줄이지 않는다. 원본/VI를
 * 같은 계열로 묶을 때는 `sourceFamily`를 명시해야 한다.
 */
export function combatSourceKey(effect = {}) {
  const explicit = normalizedText(effect.sourceKey ?? effect.effectKey);
  if (explicit) return stableTextKey(explicit);
  const family = normalizedText(effect.sourceFamily) || normalizedText(effect.source);
  return [
    stableTextKey(effect.layer || "general"),
    stableTextKey(family || "unknown"),
    stableTextKey(effect.kind || "additive"),
    stableTextKey(effect.component || effect.metadata?.phase || "default"),
  ].join(":");
}

function exactOccurrenceKey(effect, sourceKey) {
  // sourceKey만 같은 두 단계는 함께 적용될 수 있다. 완전히 같은 효과가 두
  // 수집 경로에서 들어온 경우에만 암묵적으로 하나를 제거한다.
  return JSON.stringify(stableValue({
    sourceKey,
    uptime: Number(effect?.uptime ?? 1),
    includedInBaseline: Boolean(effect?.includedInBaseline),
    modifiers: effect?.modifiers ?? {},
    targetDefenseReduction: Number(effect?.targetDefenseReduction ?? 0),
  }));
}

function activationAllowed(activation, policy = {}) {
  const allowedModes = Array.isArray(policy.allowedModes)
    ? new Set(policy.allowedModes.map(normalizedText).filter(Boolean))
    : null;
  if (allowedModes && !allowedModes.has(activation.mode)) {
    return { allowed: false, reason: "activation-mode-excluded" };
  }
  const excludedModes = new Set(
    (policy.excludedModes ?? []).map(normalizedText).filter(Boolean),
  );
  if (excludedModes.has(activation.mode)) {
    return { allowed: false, reason: "activation-mode-excluded" };
  }
  return { allowed: true, reason: null };
}

/**
 * 전투 효과의 적용 여부와 중복 제거 근거를 한 곳에서 결정한다.
 *
 * - `baselineSources[].sourceKey`와 같은 출처는 API 최종 스탯에 이미 포함된
 *   것으로 간주한다.
 * - 서로 완전히 같은 효과는 한 번만 적용한다.
 * - 같은 출처의 서로 다른 단계/성분은 자동으로 합치지 않는다.
 * - 적극적인 원본/VI 대체는 `sourceKey`와 `duplicatePolicy: "replace"`를
 *   명시한 경우에만 수행한다.
 */
export function resolveCombatSourceLedger({
  effects = [],
  baselineSources = [],
  activationPolicy = {},
} = {}) {
  const baselineKeys = new Set(
    baselineSources
      .filter((source) => source?.included !== false)
      // 초기 호출부는 출처 식별자를 `key`로 전달했다. 효과 쪽의
      // `sourceKey`와 같은 의미이므로 둘 다 받아 기존 스냅샷의 출처도
      // 실제 중복 방지에 참여하게 한다.
      .map((source) => normalizedText(source?.sourceKey ?? source?.key))
      .filter(Boolean)
      .map(stableTextKey),
  );
  const layerRank = new Map(LAYER_ORDER.map((layer, index) => [layer, index]));
  const ordered = effects
    .map((effect, index) => ({ effect, index }))
    .sort((left, right) => {
      const leftRank = layerRank.get(left.effect?.layer) ?? 1;
      const rightRank = layerRank.get(right.effect?.layer) ?? 1;
      return leftRank - rightRank || left.index - right.index;
    });
  const exactOccurrences = new Map();
  const replaceableSources = new Map();
  const ledger = [];

  for (const { effect, index } of ordered) {
    const sourceKey = combatSourceKey(effect);
    const activation = normalizedActivation(effect?.activation, effect);
    const occurrenceKey = exactOccurrenceKey(effect, sourceKey);
    const previousOccurrence = exactOccurrences.get(occurrenceKey);
    const previousReplaceable = replaceableSources.get(sourceKey);
    let applied = true;
    let reason = null;

    if (effect?.includedInBaseline || activation.mode === "baseline-reflected") {
      applied = false;
      reason = "included-in-baseline";
    } else if (baselineKeys.has(sourceKey)) {
      applied = false;
      reason = "baseline-source-overlap";
    } else {
      const activationDecision = activationAllowed(activation, activationPolicy);
      if (!activationDecision.allowed) {
        applied = false;
        reason = activationDecision.reason;
      } else if (previousOccurrence !== undefined) {
        applied = false;
        reason = "duplicate-occurrence";
      } else if (
        effect?.duplicatePolicy === "replace" &&
        previousReplaceable !== undefined
      ) {
        const previous = ledger[previousReplaceable];
        previous.applied = false;
        previous.reason = "replaced-by-later-source-version";
      }
    }

    const ledgerIndex = ledger.length;
    ledger.push({
      effect,
      originalIndex: index,
      sourceKey,
      activation,
      applied,
      reason,
      duplicateOf: previousOccurrence ?? previousReplaceable ?? null,
    });
    if (applied) {
      exactOccurrences.set(occurrenceKey, ledgerIndex);
      if (effect?.duplicatePolicy === "replace") {
        replaceableSources.set(sourceKey, ledgerIndex);
      }
    }
  }
  return ledger;
}
