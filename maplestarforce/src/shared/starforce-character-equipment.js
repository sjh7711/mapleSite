const STARFORCE_PARTS = new Set([
  "무기",
  "모자",
  "상의",
  "한벌옷",
  "하의",
  "장갑",
  "신발",
  "망토",
  "어깨장식",
  "얼굴장식",
  "눈장식",
  "귀고리",
  "반지",
  "펜던트",
  "벨트",
  "기계심장",
]);

// 대부분의 보조무기는 스타포스 대상이 아니지만, 200제 아스트라 계열은 예외다.
// 부위만 보고 모든 보조무기를 허용하지 않고 실제 강화 가능 장비로 좁힌다.
function isStarforceSpecialEquipment({ name, part, slot, level }) {
  return (
    level === 200 &&
    /^아스트라(?:\s|$)/u.test(name) &&
    [part, slot].map(normalizedPart).includes("보조무기")
  );
}

const EXACT_PRESET_NAMES = Object.freeze({
  "meister-ring": ["마이스터링"],
  "daybreak-pendant": ["데이브레이크 펜던트"],
  dominator: ["도미네이터 펜던트"],
  "loose-control": ["루즈 컨트롤 머신 마크"],
  "magic-eyepatch": ["마력이 깃든 안대"],
  "seniority-ring": ["고통의 근원"],
  "gaen-ring": ["가디언 엔젤 링", "여명의 가디언 엔젤 링"],
  "dreamy-belt": ["몽환의 벨트"],
  "commanding-force": ["커맨더 포스 이어링"],
  "giant-fear": ["거대한 공포"],
  "whisper-earring": ["컴플리트 언더컨트롤"],
  "astra-secondary": ["아스트라"],
  "origin-whisper": ["근원의 속삭임"],
  "oath-of-death": ["죽음의 맹세"],
  "ecstatic-nightmare": ["황홀한 악몽"],
  "bloody-soul": ["굶주리는 핏빛 원혼", "굶주린 핏빛 영혼"],
});

const GROUP_PRESETS = Object.freeze({
  "astra-secondary": {
    namePrefix: "아스트라",
    parts: new Set(["보조무기"]),
  },
  "arcane-shoulder": {
    namePrefix: "아케인셰이드",
    parts: new Set(["어깨장식", "신발", "망토"]),
  },
  "eternal-hat": {
    namePrefix: "에테르넬",
    parts: new Set(["모자", "상의", "하의", "어깨장식"]),
  },
  "eternal-glove": {
    namePrefix: "에테르넬",
    parts: new Set(["장갑", "신발", "망토"]),
  },
});

function normalizedText(value) {
  return typeof value === "string"
    ? value.trim().normalize("NFC").replace(/\s+/gu, " ")
    : "";
}

function normalizedPart(value) {
  return normalizedText(value).replace(/[\s\d]+/gu, "");
}

function integer(value) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && !value.trim())
  ) {
    return null;
  }
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function presetNumber(value) {
  const number = integer(value);
  return number !== null && number >= 1 && number <= 3 ? number : null;
}

/**
 * 공개 API 응답의 최소 장비 모양만 받아 스타포스 기본값에 쓸 수 있는 항목으로
 * 정규화한다. 원본 Open API와 이 사이트의 축약 응답 필드명을 모두 받는다.
 */
export function normalizeStarforceEquipment(equipment) {
  if (!Array.isArray(equipment)) return [];

  return equipment.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const name = normalizedText(raw.name ?? raw.itemName ?? raw.item_name);
    const part = normalizedText(
      raw.part ?? raw.itemPart ?? raw.item_equipment_part,
    );
    const slot = normalizedText(
      raw.slot ?? raw.itemSlot ?? raw.item_equipment_slot,
    );
    const level = integer(
      raw.level ??
        raw.baseEquipmentLevel ??
        raw.item_base_option?.base_equipment_level,
    );
    const starforce = integer(raw.starforce);
    const eligiblePart =
      [part, slot]
        .map(normalizedPart)
        .some((value) => STARFORCE_PARTS.has(value)) ||
      isStarforceSpecialEquipment({ name, part, slot, level });

    if (
      !name ||
      !eligiblePart ||
      level === null ||
      level < 135 ||
      starforce === null ||
      starforce < 0 ||
      // 계산기의 시작 성급은 0~29성이다. 30성 완성 장비는 더 강화할
      // 목표가 없으므로 자동 시작값 후보에서 제외한다.
      starforce > 29
    ) {
      return [];
    }

    return [{
      name,
      part,
      slot,
      level,
      starforce,
      icon: normalizedText(raw.icon) || null,
    }];
  });
}

// 2025년 개편 장비창에서 스타포스 대상 장비가 놓이는 위치다. 캐릭터가
// 3~5열의 1~4행을 차지하고, 나머지 장비는 실제 장비창 순서로 둘러싼다.
export const STARFORCE_EQUIPMENT_BOARD_SLOTS = Object.freeze(
  [
    ["반지1", 1, 1],
    ["반지2", 2, 1],
    ["반지3", 3, 1],
    ["반지4", 4, 1],
    ["얼굴장식", 1, 2],
    ["눈장식", 2, 2],
    ["귀고리", 3, 2],
    ["펜던트", 4, 2],
    ["모자", 1, 6],
    ["망토", 1, 7],
    ["상의", 2, 6],
    ["장갑", 2, 7],
    ["하의", 3, 6],
    ["신발", 3, 7],
    ["어깨장식", 4, 6],
    ["벨트", 5, 1],
    ["펜던트2", 5, 2],
    ["무기", 5, 3],
    ["보조무기", 5, 4],
    ["기계심장", 5, 7],
  ].map((slot) => Object.freeze(slot)),
);

function partOf(equipment) {
  const part = normalizedPart(equipment.part);
  return STARFORCE_PARTS.has(part) ? part : normalizedPart(equipment.slot);
}

function exactCandidates(preset, equipment) {
  const aliases = EXACT_PRESET_NAMES[preset.id];
  if (!aliases) return [];
  const names = new Set(aliases.map(normalizedText));
  return equipment.filter(
    (item) => item.level === preset.level && names.has(item.name),
  );
}

function groupedCandidates(preset, equipment) {
  const group = GROUP_PRESETS[preset.id];
  if (group) {
    return equipment.filter(
      (item) =>
        item.level === preset.level &&
        item.name.startsWith(group.namePrefix) &&
        group.parts.has(partOf(item)),
    );
  }

  const levelMatch = /^level-(135|145|150)$/u.exec(String(preset.id ?? ""));
  if (!levelMatch || Number(levelMatch[1]) !== Number(preset.level)) return [];
  return equipment.filter((item) => item.level === preset.level);
}

function normalizedEquipmentPreset(rawPreset) {
  if (!rawPreset || typeof rawPreset !== "object" || Array.isArray(rawPreset)) {
    return null;
  }
  const presetNo = presetNumber(rawPreset.presetNo ?? rawPreset.preset_no);
  if (presetNo === null) return null;
  const equipment = normalizeStarforceEquipment(rawPreset.equipment);
  if (!equipment.length) return null;
  return { presetNo, equipment };
}

function equipmentIdentity(item) {
  return [
    normalizedText(item.name),
    normalizedText(item.part),
    normalizedText(item.slot),
    item.level,
  ].join("\u001f");
}

/**
 * 점수 fallback에서 같은 API 행이 중복돼 한 프리셋이 더 강해 보이는 것을 막는다.
 * 같은 장비·슬롯이 서로 다른 성급으로 중복됐다면 어느 값이 맞는지 알 수 없으므로
 * 그 프리셋은 안전한 점수 비교에서 제외한다.
 */
function scoredEquipmentPreset(preset) {
  const unique = new Map();
  for (const item of preset.equipment) {
    const key = equipmentIdentity(item);
    const previous = unique.get(key);
    if (previous && previous.starforce !== item.starforce) return null;
    if (!previous) unique.set(key, item);
  }
  const equipment = [...unique.values()];
  return {
    ...preset,
    equipment,
    score: equipment.reduce((sum, item) => sum + item.starforce, 0),
  };
}

function equipmentPresetFingerprint(preset) {
  return preset.equipment
    .map((item) => `${equipmentIdentity(item)}\u001f${item.starforce}`)
    .sort()
    .join("\u001e");
}

/**
 * 캐릭터의 세 장비 프리셋 중 화면에 보여 줄 한 프리셋만 고른다.
 * 서버가 고른 추천 프리셋, 현재 활성 프리셋 순으로 신뢰한다. 둘 다 사용할 수
 * 없을 때만 정제된 장비의 스타포스 합이 유일하게 높은 프리셋을 고른다.
 * 점수가 같은 서로 다른 프리셋은 임의로 섞거나 하나를 추측하지 않는다.
 */
export function selectDisplayedEquipmentPreset(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const presets = Array.isArray(source.presets)
    ? source.presets.map(normalizedEquipmentPreset).filter(Boolean)
    : [];
  if (!presets.length) return null;

  const selectedByNumber = (value, selectionReason) => {
    const number = presetNumber(value);
    if (number === null) return null;
    const selected = presets.find((preset) => preset.presetNo === number);
    return selected ? { ...selected, selectionReason } : null;
  };

  const recommended = selectedByNumber(
    source.recommendedPresetNo ?? source.recommended_preset_no,
    "recommended",
  );
  if (recommended) return recommended;

  const active = selectedByNumber(
    source.activePresetNo ?? source.active_preset_no ?? source.preset_no,
    "active",
  );
  if (active) return active;

  const scored = presets.map(scoredEquipmentPreset).filter(Boolean);
  if (!scored.length) return null;
  const highestScore = Math.max(...scored.map((preset) => preset.score));
  const strongest = scored.filter((preset) => preset.score === highestScore);
  if (strongest.length === 1) {
    const [{ score: _score, ...selected }] = strongest;
    return { ...selected, selectionReason: "score" };
  }

  // 완전히 같은 장비 목록끼리의 동점은 어느 쪽을 골라도 화면 결과가 같다.
  const fingerprints = new Set(strongest.map(equipmentPresetFingerprint));
  if (fingerprints.size === 1) {
    const [{ score: _score, ...selected }] = strongest.sort(
      (left, right) => left.presetNo - right.presetNo,
    );
    return { ...selected, selectionReason: "score" };
  }
  return null;
}

/**
 * 실제 장착 장비 한 개를 계산기의 장비 프리셋 하나에 연결한다. 이름 별칭이
 * 맞으면 묶음 규칙보다 우선하며, 묶음 규칙이 둘 이상 맞으면 추측하지 않는다.
 */
export function calculatorPresetForEquipment(rawEquipment, presets) {
  const [equipment] = normalizeStarforceEquipment([rawEquipment]);
  if (!equipment || !Array.isArray(presets)) return null;
  const available = presets.filter(
    (preset) => preset && typeof preset === "object" && !Array.isArray(preset),
  );
  const exact = available.filter(
    (preset) => exactCandidates(preset, [equipment]).length > 0,
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  const grouped = available.filter(
    (preset) => groupedCandidates(preset, [equipment]).length > 0,
  );
  return grouped.length === 1 ? grouped[0] : null;
}

/**
 * 장비 프리셋과 현재 장착 장비를 연결한다. 묶음 프리셋의 후보가 여러 개여도
 * 전부 같은 성급이면 안전하게 쓸 수 있다. 성급이 다르면 API 배열 순서나
 * 최댓값으로 임의 선택하지 않고 ambiguous를 반환한다.
 */
export function matchStarforcePreset(preset, rawEquipment) {
  if (!preset || typeof preset !== "object") {
    return { status: "unmatched", starforce: null, matchType: null, candidates: [] };
  }
  const equipment = normalizeStarforceEquipment(rawEquipment);
  const exact = exactCandidates(preset, equipment);
  const candidates = exact.length ? exact : groupedCandidates(preset, equipment);
  const matchType = exact.length ? "exact" : candidates.length ? "group" : null;

  if (!candidates.length) {
    return { status: "unmatched", starforce: null, matchType, candidates };
  }

  const stars = [...new Set(candidates.map((item) => item.starforce))];
  if (stars.length !== 1) {
    return { status: "ambiguous", starforce: null, matchType, candidates };
  }

  return {
    status: "matched",
    starforce: stars[0],
    matchType,
    candidates,
  };
}

/** 매칭이 확실할 때만 장착 성급을 쓰고 나머지는 화면의 수동 기본값을 쓴다. */
export function startStarForPreset(preset, equipment, fallbackStar) {
  const match = matchStarforcePreset(preset, equipment);
  return {
    ...match,
    startStar: match.status === "matched" ? match.starforce : fallbackStar,
  };
}
