const STAT_FAMILIES = Object.freeze(["STR", "DEX", "INT", "LUK"]);
const STAT_FAMILY_SET = new Set(STAT_FAMILIES);
const OWN = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const SCORE_EPSILON = 1e-12;

const JOB_SPECIFIC_ARMOR_CATEGORIES = new Set([
  "모자",
  "상의",
  "한벌옷",
  "하의",
  "신발",
  "장갑",
  "망토",
  "어깨장식",
]);
const UNIVERSAL_REQUIRED_JOBS = new Set(["", "공용", "전체", "ALL", "COMMON"]);
const REQUIRED_JOB_FAMILY = Object.freeze({
  전사: "STR",
  궁수: "DEX",
  마법사: "INT",
  도적: "LUK",
});
const PEER_IDENTITY_FIELDS = Object.freeze([
  "name",
  "catalog_id",
  "category",
  "category_path",
  "required_job",
  "set_name",
  "base_level",
  "item_id",
  "item_code",
  "slot",
  "slot_name",
  "equipment_slot",
  "icon",
  "icon_url",
  "icon_asset_key",
  "image",
  "image_url",
]);

export const ITEM_MARKET_STAT_FAMILIES = STAT_FAMILIES;
export const ITEM_MARKET_PEER_IDENTITY_FIELDS = PEER_IDENTITY_FIELDS;

function itemBody(value) {
  if (value?.item && typeof value.item === "object") return value.item;
  return value && typeof value === "object" ? value : {};
}

function positive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizedStat(value) {
  const stat = String(value || "").toUpperCase();
  return STAT_FAMILY_SET.has(stat) ? stat : null;
}

function normalizedText(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function itemCategory(item) {
  const category = normalizedText(item?.category || item?.slot || item?.equipment_slot);
  if (category) return category;
  const path = Array.isArray(item?.category_path) ? item.category_path : [];
  return normalizedText(path.at(-1));
}

function setFamilyName(value) {
  return normalizedText(value)
    .replace(/\s*\(\s*(?:전사|궁수|마법사|도적|해적)\s*\)\s*$/u, "")
    .trim();
}

function sameItemIdentity(leftValue, rightValue) {
  const left = itemBody(leftValue);
  const right = itemBody(rightValue);
  const leftCatalogId = normalizedText(left.catalog_id);
  const rightCatalogId = normalizedText(right.catalog_id);
  if (leftCatalogId && rightCatalogId) return leftCatalogId === rightCatalogId;
  const leftName = normalizedText(left.name);
  const rightName = normalizedText(right.name);
  return Boolean(leftName && rightName && leftName === rightName);
}

/** 직업 제한이 있는 방어구만 peer 장비 비교 대상으로 분류한다. */
export function isJobSpecificItemMarketArmor(target) {
  const item = itemBody(target);
  const categoryPath = Array.isArray(item.category_path) ? item.category_path : [];
  const isArmor = normalizedText(categoryPath[0]) === "방어구" ||
    JOB_SPECIFIC_ARMOR_CATEGORIES.has(itemCategory(item));
  const requiredJob = normalizedText(item.required_job).toUpperCase();
  return isArmor && !UNIVERSAL_REQUIRED_JOBS.has(requiredJob);
}

function peerForFamily(peerItemsByFamily, family) {
  if (peerItemsByFamily instanceof Map) return peerItemsByFamily.get(family) ?? null;
  if (!peerItemsByFamily || typeof peerItemsByFamily !== "object") return null;
  return peerItemsByFamily[family] ?? peerItemsByFamily[family.toLowerCase()] ?? null;
}

function validateArmorPeer(sourceValue, peerValue) {
  const source = itemBody(sourceValue);
  const peer = itemBody(peerValue);
  if (!peerValue || typeof peerValue !== "object" || !normalizedText(peer.name)) {
    return { ok: false, code: "peer_missing", message: "peer 장비가 없습니다." };
  }

  const sourceCategory = itemCategory(source);
  const peerCategory = itemCategory(peer);
  if (!sourceCategory || !peerCategory || sourceCategory !== peerCategory) {
    return {
      ok: false,
      code: "slot_mismatch",
      message: "peer 장비의 부위가 현재 장비와 다릅니다.",
      source_category: sourceCategory || null,
      peer_category: peerCategory || null,
    };
  }

  const sourceSet = setFamilyName(source.set_name);
  const peerSet = setFamilyName(peer.set_name);
  if (!sourceSet || !peerSet) {
    return {
      ok: false,
      code: "set_unverifiable",
      message: "현재 장비와 peer 장비의 세트를 확인할 수 없습니다.",
      source_set: normalizedText(source.set_name) || null,
      peer_set: normalizedText(peer.set_name) || null,
    };
  }
  if (sourceSet !== peerSet) {
    return {
      ok: false,
      code: "set_mismatch",
      message: "peer 장비가 현재 장비와 같은 세트가 아닙니다.",
      source_set: normalizedText(source.set_name),
      peer_set: normalizedText(peer.set_name),
    };
  }
  return { ok: true, code: "matched", source_set_family: sourceSet };
}

/**
 * 강화 상태는 그대로 두고 장비를 식별하는 필드만 peer 장비 값으로 교체한다.
 * identityFields를 명시하지 않으면 데이터셋의 안전한 식별 필드만 복사한다.
 */
export function replaceItemMarketPeerIdentity(target, peerTarget, options = {}) {
  if (!target || typeof target !== "object") throw new TypeError("target 객체가 필요합니다.");
  if (!peerTarget || typeof peerTarget !== "object") {
    throw new TypeError("peerTarget 객체가 필요합니다.");
  }
  const fields = options.identityFields ?? PEER_IDENTITY_FIELDS;
  if (!Array.isArray(fields) || fields.some((field) => typeof field !== "string")) {
    throw new TypeError("identityFields는 문자열 배열이어야 합니다.");
  }
  const counterfactual = structuredClone(target);
  const item = itemBody(counterfactual);
  const peer = itemBody(peerTarget);
  for (const field of fields) {
    if (OWN(peer, field)) item[field] = structuredClone(peer[field]);
  }
  return counterfactual;
}

function emptyStatValues() {
  return Object.fromEntries(STAT_FAMILIES.map((stat) => [stat, 0]));
}

function collectExplicitStatEvidence(target) {
  const item = itemBody(target);
  const evidence = [];
  const add = ({ channel, source, path, stat, amount, kind }) => {
    const resolvedStat = normalizedStat(stat);
    const resolvedAmount = positive(amount);
    if (!resolvedStat || resolvedAmount === null) return;
    evidence.push({
      channel,
      source,
      path,
      stat: resolvedStat,
      amount: resolvedAmount,
      kind,
    });
  };

  for (const [sectionKey, source] of [
    ["potential", "potential"],
    ["additional_potential", "additional"],
  ]) {
    const lines = Array.isArray(item?.[sectionKey]?.lines) ? item[sectionKey].lines : [];
    lines.forEach((line, index) => {
      const code = String(line?.code || "").toUpperCase();
      if (STAT_FAMILY_SET.has(code)) {
        const unit = String(line?.unit || "").toLowerCase();
        if (unit !== "pct" && unit !== "flat") return;
        add({
          channel: `${source}:${unit}`,
          source,
          path: `item.${sectionKey}.lines[${index}].code`,
          stat: code,
          amount: line.value,
          kind: unit === "pct" ? "percent" : "flat",
        });
        return;
      }
      if (code !== "STAT_PER_CHARACTER_LEVEL") return;
      const levels = positive(line?.params?.levels_per_increment);
      const amount = positive(line?.params?.stat_value);
      if (levels === null || amount === null) return;
      add({
        channel: `${source}:per_level`,
        source,
        path: `item.${sectionKey}.lines[${index}].params.stat_code`,
        stat: line.params.stat_code,
        // 서로 다른 주기 표현도 같은 단위로 비교하되, 반사실에는 원래 params를
        // 그대로 보존한다.
        amount: amount / levels,
        kind: "per_level",
      });
    });
  }

  for (const bucket of ["scroll", "flame"]) {
    const stats = item?.stats?.[bucket];
    if (!stats || typeof stats !== "object") continue;
    for (const stat of STAT_FAMILIES) {
      add({
        channel: `${bucket}:flat`,
        source: bucket,
        path: `item.stats.${bucket}.${stat.toLowerCase()}_flat`,
        stat,
        amount: stats[`${stat.toLowerCase()}_flat`],
        kind: "flat",
      });
    }
  }

  return evidence;
}

/**
 * 서로 단위가 다른 %·고정 수치·레벨당 옵션을 그대로 더하지 않는다. 각 입력
 * 채널 안에서 차지하는 비중을 낸 뒤 채널별 비중을 합쳐 지배 계열을 찾는다.
 * 서로 다른 채널이 정확히 맞서는 경우에는 임의로 계열을 고르지 않는다.
 */
export function findDominantItemMarketStatFamily(target) {
  const evidence = collectExplicitStatEvidence(target);
  const channels = {};
  for (const entry of evidence) {
    channels[entry.channel] ||= emptyStatValues();
    channels[entry.channel][entry.stat] += entry.amount;
  }

  const scores = emptyStatValues();
  for (const values of Object.values(channels)) {
    const total = STAT_FAMILIES.reduce((sum, stat) => sum + values[stat], 0);
    if (!(total > 0)) continue;
    for (const stat of STAT_FAMILIES) scores[stat] += values[stat] / total;
  }

  const activeFamilies = STAT_FAMILIES.filter((stat) =>
    evidence.some((entry) => entry.stat === stat)
  );
  if (!activeFamilies.length) {
    return {
      status: "none",
      family: null,
      active_families: [],
      scores,
      score_margin: null,
      channels,
      evidence,
    };
  }

  const ranked = [...activeFamilies].sort((left, right) =>
    scores[right] - scores[left] || STAT_FAMILIES.indexOf(left) - STAT_FAMILIES.indexOf(right)
  );
  const bestScore = scores[ranked[0]];
  const tied = ranked.filter((stat) => Math.abs(scores[stat] - bestScore) <= SCORE_EPSILON);
  const secondScore = ranked.length > 1 ? scores[ranked[1]] : 0;
  return {
    status: tied.length === 1 ? "found" : "ambiguous",
    family: tied.length === 1 ? ranked[0] : null,
    active_families: activeFamilies,
    tied_families: tied.length > 1 ? tied : [],
    scores,
    score_margin: tied.length === 1 ? bestScore - secondScore : 0,
    channels,
    evidence,
  };
}

function assertStatFamily(value, label) {
  const stat = normalizedStat(value);
  if (!stat) throw new RangeError(`${label}은 STR, DEX, INT, LUK 중 하나여야 합니다.`);
  return stat;
}

function swappedStat(value, source, destination) {
  const stat = normalizedStat(value);
  if (stat === source) return destination;
  if (stat === destination) return source;
  return null;
}

function swapPotentialSection(section, source, destination) {
  if (!Array.isArray(section?.lines)) return;
  for (const line of section.lines) {
    const replacement = swappedStat(line?.code, source, destination);
    if (replacement) line.code = replacement;
    if (String(line?.code || "").toUpperCase() !== "STAT_PER_CHARACTER_LEVEL") continue;
    const parameterReplacement = swappedStat(line?.params?.stat_code, source, destination);
    if (parameterReplacement) line.params.stat_code = parameterReplacement;
  }
}

function swapStatBucket(bucket, source, destination) {
  if (!bucket || typeof bucket !== "object") return;
  const sourceKey = `${source.toLowerCase()}_flat`;
  const destinationKey = `${destination.toLowerCase()}_flat`;
  const hasSource = OWN(bucket, sourceKey);
  const hasDestination = OWN(bucket, destinationKey);
  const sourceValue = bucket[sourceKey];
  const destinationValue = bucket[destinationKey];

  if (hasDestination) bucket[sourceKey] = destinationValue;
  else delete bucket[sourceKey];
  if (hasSource) bucket[destinationKey] = sourceValue;
  else delete bucket[destinationKey];
}

/**
 * source와 destination의 계열 표기만 서로 바꾼 동급 반사실을 만든다.
 * 수치, 등급, 줄 순서, 공격력/마력, 올스탯과 다른 강화 정보는 보존한다.
 */
export function swapItemMarketStatFamilies(target, sourceFamily, destinationFamily) {
  if (!target || typeof target !== "object") throw new TypeError("target 객체가 필요합니다.");
  const source = assertStatFamily(sourceFamily, "sourceFamily");
  const destination = assertStatFamily(destinationFamily, "destinationFamily");
  const counterfactual = structuredClone(target);
  if (source === destination) return counterfactual;

  const item = itemBody(counterfactual);
  swapPotentialSection(item.potential, source, destination);
  swapPotentialSection(item.additional_potential, source, destination);
  swapStatBucket(item?.stats?.scroll, source, destination);
  swapStatBucket(item?.stats?.flame, source, destination);
  return counterfactual;
}

function hasPeerConfiguration(peerItemsByFamily) {
  if (peerItemsByFamily instanceof Map) return peerItemsByFamily.size > 0;
  return Boolean(peerItemsByFamily && typeof peerItemsByFamily === "object" &&
    Object.keys(peerItemsByFamily).length > 0);
}

function inferSelectedItemFamily(target, peerItemsByFamily, explicitFamily) {
  if (explicitFamily !== null && explicitFamily !== undefined && explicitFamily !== "") {
    return assertStatFamily(explicitFamily, "selectedItemFamily");
  }
  for (const family of STAT_FAMILIES) {
    const peer = peerForFamily(peerItemsByFamily, family);
    if (peer && sameItemIdentity(target, peer)) return family;
  }
  return REQUIRED_JOB_FAMILY[normalizedText(itemBody(target).required_job)] ?? null;
}

function sameItemFamilyTargets(target, inputStatFamily) {
  const targets = {};
  const targetMetadata = {};
  for (const family of STAT_FAMILIES) {
    targets[family] = swapItemMarketStatFamilies(target, inputStatFamily, family);
    targetMetadata[family] = {
      family,
      stat_family: family,
      identity_family: null,
      identity_source: "current_item",
      identity_changed: false,
      stat_changed: family !== inputStatFamily,
      matches_current: family === inputStatFamily,
      item_name: normalizedText(itemBody(target).name) || null,
      required_job: normalizedText(itemBody(target).required_job) || null,
    };
  }
  return { targets, targetMetadata };
}

function jobPeerFamilyTargets(target, inputStatFamily, options) {
  const peerItemsByFamily = options.peerItemsByFamily;
  const selectedItemFamily = inferSelectedItemFamily(
    target,
    peerItemsByFamily,
    options.selectedItemFamily,
  );
  const targets = {};
  const targetMetadata = {};
  const peerResolution = {};

  for (const family of STAT_FAMILIES) {
    const configuredPeer = peerForFamily(peerItemsByFamily, family);
    const peer = family === selectedItemFamily ? target : configuredPeer;
    const validation = family === selectedItemFamily
      ? { ok: true, code: "current_item" }
      : validateArmorPeer(target, peer);
    if (!validation.ok) {
      peerResolution[family] = {
        status: "unavailable",
        ...validation,
      };
      continue;
    }

    let candidate = swapItemMarketStatFamilies(target, inputStatFamily, family);
    const identityChanged = !sameItemIdentity(target, peer);
    if (identityChanged) {
      candidate = replaceItemMarketPeerIdentity(candidate, peer, {
        identityFields: options.identityFields,
      });
    }
    const matchesCurrent = !identityChanged && family === inputStatFamily;
    const peerItem = itemBody(peer);
    targets[family] = candidate;
    targetMetadata[family] = {
      family,
      stat_family: family,
      identity_family: family,
      identity_source: identityChanged ? "peer_item" : "current_item",
      identity_changed: identityChanged,
      stat_changed: family !== inputStatFamily,
      matches_current: matchesCurrent,
      item_name: normalizedText(peerItem.name) || null,
      required_job: normalizedText(peerItem.required_job) || null,
      catalog_id: normalizedText(peerItem.catalog_id) || null,
    };
    peerResolution[family] = {
      status: "resolved",
      code: validation.code,
      identity_source: identityChanged ? "peer_item" : "current_item",
      item_name: normalizedText(peerItem.name) || null,
      required_job: normalizedText(peerItem.required_job) || null,
      catalog_id: normalizedText(peerItem.catalog_id) || null,
    };
  }
  return { targets, targetMetadata, peerResolution, selectedItemFamily };
}

/**
 * UI가 각 스탯 계열을 해당 장비 모델로 추정할 수 있도록 독립 target을
 * 반환한다. 공용 장비는 같은 item의 스탯만 바꾸고, 직업 전용 방어구에
 * peerItemsByFamily를 주면 각 계열의 동세트·동부위 장비 identity도 교체한다.
 *
 * 직업 전용 방어구에서는 입력 스탯 계열과 선택 장비 계열을 별개로 둔다.
 * 예를 들어 나이트 장비에 INT가 입력되면 현재 target은 그대로 보존하면서
 * 나이트+STR, 아처+DEX, 메이지+INT, 시프+LUK 후보를 만들 수 있다.
 */
export function buildItemMarketStatFamilyCounterfactuals(target, options = {}) {
  if (!target || typeof target !== "object") throw new TypeError("target 객체가 필요합니다.");
  const detection = findDominantItemMarketStatFamily(target);
  if (detection.status !== "found") {
    return {
      status: detection.status === "none" ? "no_explicit_stat_family" : "ambiguous_stat_family",
      current_family: null,
      input_stat_family: null,
      selected_item_family: null,
      detection,
      current_target: structuredClone(target),
      targets: {},
      target_metadata: {},
    };
  }

  const inputStatFamily = detection.family;
  const useJobPeers = isJobSpecificItemMarketArmor(target) &&
    hasPeerConfiguration(options.peerItemsByFamily);
  const built = useJobPeers
    ? jobPeerFamilyTargets(target, inputStatFamily, options)
    : sameItemFamilyTargets(target, inputStatFamily);
  const missingFamilies = STAT_FAMILIES.filter((family) => !built.targets[family]);
  return {
    status: missingFamilies.length ? "partial_peer_items" : "ready",
    comparison_mode: useJobPeers ? "job_peer_items" : "same_item_stat_swap",
    current_family: inputStatFamily,
    input_stat_family: inputStatFamily,
    selected_item_family: built.selectedItemFamily ?? null,
    detection,
    current_target: structuredClone(target),
    current_metadata: {
      stat_family: inputStatFamily,
      identity_family: built.selectedItemFamily ?? null,
      is_on_stat: built.selectedItemFamily === null
        ? null
        : built.selectedItemFamily === inputStatFamily,
      item_name: normalizedText(itemBody(target).name) || null,
      required_job: normalizedText(itemBody(target).required_job) || null,
    },
    targets: built.targets,
    target_metadata: built.targetMetadata,
    peer_resolution: built.peerResolution ?? {},
    missing_families: missingFamilies,
  };
}

function normalizedEstimate(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return { status: "estimated", estimate_meso: value, estimator_result: value };
  }
  const estimate = Number(value?.estimate_meso);
  if (value?.status === "estimated" && Number.isFinite(estimate) && estimate >= 0) {
    return { status: "estimated", estimate_meso: estimate, estimator_result: value };
  }
  return {
    status: "unavailable",
    estimate_meso: null,
    estimator_result: value ?? null,
    error: value?.status ? `estimator_status:${value.status}` : "estimate_meso_missing",
  };
}

function runEstimate(estimator, target, context) {
  try {
    const value = estimator(structuredClone(target), context);
    if (value && typeof value.then === "function") {
      throw new TypeError("비동기 estimator는 지원하지 않습니다.");
    }
    return normalizedEstimate(value);
  } catch (error) {
    return {
      status: "unavailable",
      estimate_meso: null,
      estimator_result: null,
      error: error?.message || String(error),
    };
  }
}

function buildAdditionalPeerCandidates(target, inputStatFamily, variants, identityFields) {
  if (!Array.isArray(variants)) return [];
  const seen = new Set();
  return variants.flatMap((variant, index) => {
    const family = normalizedStat(variant?.family);
    const peer = variant?.peerTarget ?? variant?.peer ?? variant?.target;
    if (!family || !peer || typeof peer !== "object") return [];
    const key = normalizedText(variant?.key) || `additional-peer:${index}:${family}`;
    if (seen.has(key)) return [];
    seen.add(key);

    const validation = validateArmorPeer(target, peer);
    if (!validation.ok) return [];
    const identityChanged = !sameItemIdentity(target, peer);
    if (!identityChanged && family === inputStatFamily) return [];

    let candidate = swapItemMarketStatFamilies(target, inputStatFamily, family);
    if (identityChanged) {
      candidate = replaceItemMarketPeerIdentity(candidate, peer, { identityFields });
    }
    const peerItem = itemBody(peer);
    return [{
      key,
      family,
      target: candidate,
      metadata: {
        family,
        stat_family: family,
        identity_family: family,
        identity_source: identityChanged ? "peer_item" : "current_item",
        identity_changed: identityChanged,
        stat_changed: family !== inputStatFamily,
        matches_current: false,
        peer_key: key,
        role: normalizedText(variant?.role) || null,
        job_label: normalizedText(variant?.job_label) ||
          normalizedText(peerItem.required_job) || null,
        item_name: normalizedText(peerItem.name) || null,
        required_job: normalizedText(peerItem.required_job) || null,
        catalog_id: normalizedText(peerItem.catalog_id) || null,
      },
    }];
  });
}

function comparisonDelta(estimate, currentEstimate) {
  if (!Number.isFinite(estimate) || !Number.isFinite(currentEstimate)) {
    return {
      delta_meso: null,
      delta_percent: null,
      relation: "unavailable",
      relation_label: "비교 불가",
    };
  }
  const delta = estimate - currentEstimate;
  const relation = delta < 0 ? "cheaper" : delta > 0 ? "more_expensive" : "same";
  return {
    delta_meso: delta,
    delta_percent: currentEstimate > 0 ? delta / currentEstimate * 100 : null,
    relation,
    relation_label: relation === "cheaper"
      ? "현재보다 저렴"
      : relation === "more_expensive"
        ? "현재보다 비쌈"
        : "현재와 같음",
  };
}

/**
 * estimator(target, context) 콜백으로 현재 입력과 계열별 동급 target을 평가한다.
 * 현재와 완전히 같은 후보는 현재 결과를 재사용한다. 오프스탯 직업 방어구는
 * 현재 입력 1회와 네 직업 정옵 후보를 별도로 평가할 수 있다.
 */
export function compareItemMarketStatFamilies({
  target,
  estimator,
  peerItemsByFamily,
  additionalPeerVariants,
  selectedItemFamily,
  identityFields,
} = {}) {
  if (typeof estimator !== "function") throw new TypeError("estimator 콜백이 필요합니다.");
  const counterfactuals = buildItemMarketStatFamilyCounterfactuals(target, {
    peerItemsByFamily,
    selectedItemFamily,
    identityFields,
  });
  if (!["ready", "partial_peer_items"].includes(counterfactuals.status)) {
    return {
      ...counterfactuals,
      current: null,
      comparisons: [],
    };
  }

  const currentOutcome = runEstimate(estimator, counterfactuals.current_target, {
    family: counterfactuals.input_stat_family,
    stat_family: counterfactuals.input_stat_family,
    identity_family: counterfactuals.selected_item_family,
    current_family: counterfactuals.current_family,
    input_stat_family: counterfactuals.input_stat_family,
    is_current: true,
    comparison_kind: "current_input",
    metadata: counterfactuals.current_metadata,
  });
  const outcomes = {};
  for (const family of STAT_FAMILIES) {
    const candidate = counterfactuals.targets[family];
    if (!candidate) continue;
    const metadata = counterfactuals.target_metadata[family];
    outcomes[family] = metadata.matches_current
      ? currentOutcome
      : runEstimate(estimator, candidate, {
          family,
          stat_family: family,
          identity_family: metadata.identity_family,
          current_family: counterfactuals.current_family,
          input_stat_family: counterfactuals.input_stat_family,
          is_current: false,
          comparison_kind: "family_counterfactual",
          metadata,
        });
  }
  const currentEstimate = currentOutcome.estimate_meso;
  const comparisons = STAT_FAMILIES
    .filter((family) => counterfactuals.targets[family] &&
      !counterfactuals.target_metadata[family].matches_current)
    .map((family) => ({
      family,
      target: counterfactuals.targets[family],
      metadata: counterfactuals.target_metadata[family],
      ...outcomes[family],
      ...comparisonDelta(outcomes[family].estimate_meso, currentEstimate),
    }));

  const additionalCandidates = buildAdditionalPeerCandidates(
    target,
    counterfactuals.input_stat_family,
    additionalPeerVariants,
    identityFields,
  );
  for (const candidate of additionalCandidates) {
    const outcome = runEstimate(estimator, candidate.target, {
      family: candidate.family,
      stat_family: candidate.family,
      identity_family: candidate.family,
      peer_key: candidate.key,
      current_family: counterfactuals.current_family,
      input_stat_family: counterfactuals.input_stat_family,
      is_current: false,
      comparison_kind: "additional_peer_counterfactual",
      metadata: candidate.metadata,
    });
    comparisons.push({
      comparison_key: candidate.key,
      family: candidate.family,
      target: candidate.target,
      metadata: candidate.metadata,
      ...outcome,
      ...comparisonDelta(outcome.estimate_meso, currentEstimate),
    });
  }

  return {
    status: counterfactuals.status === "ready" &&
      currentOutcome.status === "estimated" &&
      comparisons.every((entry) => entry.status === "estimated")
      ? "compared"
      : "partial",
    comparison_mode: counterfactuals.comparison_mode,
    current_family: counterfactuals.current_family,
    input_stat_family: counterfactuals.input_stat_family,
    selected_item_family: counterfactuals.selected_item_family,
    detection: counterfactuals.detection,
    targets: counterfactuals.targets,
    target_metadata: counterfactuals.target_metadata,
    peer_resolution: counterfactuals.peer_resolution,
    missing_families: counterfactuals.missing_families,
    current: {
      family: counterfactuals.current_family,
      target: counterfactuals.current_target,
      metadata: counterfactuals.current_metadata,
      ...currentOutcome,
    },
    comparisons,
  };
}
