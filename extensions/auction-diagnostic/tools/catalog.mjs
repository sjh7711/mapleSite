/**
 * Fixed Maple Auction equipment catalogue and pure query/profile helpers.
 *
 * This module deliberately contains no DOM, Chrome extension, clock, storage,
 * or network access.  The collector can therefore test and version its search
 * policy without opening the auction site.
 */

export const CATALOG_VERSION = "2026-09-04.1";

export const CATALOG_EXPECTED_COUNTS = deepFreeze({
  total: 151,
  priority: { P1: 141, P2: 10 },
  group: {
    core: 3,
    eternal: 35,
    arcane: 30,
    absolab: 30,
    cra: 15,
    black: 17,
    brilliant: 6,
    dawn: 4,
    boss: 11
  }
});

export const STAT_CODES = deepFreeze([
  "STR",
  "DEX",
  "INT",
  "LUK",
  "HP",
  "ALL_STAT",
  "ATTACK",
  "MAGIC_ATTACK",
  "IGNORE_DEFENSE",
  "CRITICAL_DAMAGE",
  "ITEM_DROP_RATE",
  "MESO_OBTAINED"
]);

export const POTENTIAL_PROFILE_IDS = deepFreeze([
  "MAIN_STAT",
  "ALL_STAT",
  "MAX_HP",
  "XENON_MIXED",
  "HAT_COOLDOWN",
  "GLOVE_CRITICAL_DAMAGE",
  "ACCESSORY_DROP_MESO",
  "MITRA_OPTIMAL"
]);

export const ACCESSORY_DROP_MESO_TARGETS = deepFreeze([
  { id: "MESO_40", minimum_drop_pct: 0, minimum_meso_pct: 40 },
  { id: "DROP_40", minimum_drop_pct: 40, minimum_meso_pct: 0 },
  { id: "DROP_20_MESO_20", minimum_drop_pct: 20, minimum_meso_pct: 20 },
  { id: "MESO_20", minimum_drop_pct: 0, minimum_meso_pct: 20 },
  { id: "DROP_20", minimum_drop_pct: 20, minimum_meso_pct: 0 }
]);

const ACCESSORY_EQUIPMENT_SLOT_LABELS = deepFreeze([
  "반지",
  "펜던트",
  "벨트",
  "귀고리",
  "눈장식",
  "얼굴장식"
]);

const ARMOR_EQUIPMENT_SLOT_LABELS = deepFreeze([
  "모자",
  "상의",
  "한벌옷",
  "하의",
  "신발",
  "장갑",
  "망토",
  "어깨장식"
]);

/**
 * Official potential line breakpoints used by the local classifier.
 *
 * The level boundary is 201, not 160.  HP follows the same percentage line
 * values as a main stat.  All-stat has its own lower line values.
 */
export const POTENTIAL_THRESHOLDS = deepFreeze({
  LEVEL_200_OR_BELOW: {
    min_level: 0,
    max_level: 200,
    main_stat_pct: { two_line: 21, three_line: 30 },
    hp_pct: { two_line: 21, three_line: 30 },
    all_stat_pct: { two_line: 15, three_line: 21 }
  },
  LEVEL_201_OR_ABOVE: {
    min_level: 201,
    max_level: null,
    main_stat_pct: { two_line: 23, three_line: 33 },
    hp_pct: { two_line: 23, three_line: 33 },
    all_stat_pct: { two_line: 17, three_line: 24 }
  }
});

/**
 * Auction URL potential filter capabilities.
 *
 * `observed` means the key was seen in a filter-search URL created by the
 * current site. `observed_ambiguous` means the key was seen in a search,
 * but the result set showed that the server may fold all-stat into the chosen
 * stat.  `legacy_unverified` means the mapping existed in extension 0.5.0 but
 * has not been proven against the current site.  `local_only` intentionally has
 * no invented URL code and must be classified from captured tooltip lines.
 */
export const POTENTIAL_FILTER_CAPABILITIES = deepFreeze({
  STR_PCT: {
    auction_code: "strPercent",
    evidence_status: "observed_ambiguous",
    server_queryable: true,
    strict_semantics: false,
    note: "Observed on 2026-09-01; an all-stat-only result was included. Reclassify locally."
  },
  DEX_PCT: {
    auction_code: "dexPercent",
    evidence_status: "legacy_unverified",
    server_queryable: true,
    strict_semantics: false,
    note: "Legacy extension mapping; runtime verification is required."
  },
  INT_PCT: {
    auction_code: "intPercent",
    evidence_status: "legacy_unverified",
    server_queryable: true,
    strict_semantics: false,
    note: "Legacy extension mapping; runtime verification is required."
  },
  LUK_PCT: {
    auction_code: "lukPercent",
    evidence_status: "legacy_unverified",
    server_queryable: true,
    strict_semantics: false,
    note: "Legacy extension mapping; runtime verification is required."
  },
  ALL_STAT_PCT: {
    auction_code: "allStatsPercent",
    evidence_status: "observed",
    server_queryable: true,
    strict_semantics: false,
    note: "Observed in a successful Maple Auction filter-search URL on 2026-09-02."
  },
  ATTACK_PCT: {
    auction_code: "physicalAttackPercent",
    evidence_status: "observed",
    server_queryable: true,
    strict_semantics: false,
    note: "Observed in a successful Maple Auction filter-search URL on 2026-09-02."
  },
  MAGIC_ATTACK_PCT: {
    auction_code: "magicAttackPercent",
    evidence_status: "legacy_unverified",
    server_queryable: true,
    strict_semantics: false,
    note: "Legacy extension mapping; runtime verification is required."
  },
  HP_PCT: localOnlyCapability("No verified current auction URL mapping."),
  IGNORE_DEFENSE_PCT: localOnlyCapability("Needed for Mitra classification; no verified URL mapping."),
  COOLDOWN_REDUCTION: localOnlyCapability("Hat profile is classified from tooltip lines."),
  CRITICAL_DAMAGE_PCT: localOnlyCapability("Glove profile is classified from tooltip lines."),
  ITEM_DROP_RATE_PCT: {
    auction_code: "itemDropPercent",
    evidence_status: "legacy_unverified",
    server_queryable: true,
    strict_semantics: false,
    note: "Maple Auction filter code; every result is reclassified from captured potential lines."
  },
  MESO_OBTAINED_PCT: {
    auction_code: "mesosObtainedPercent",
    evidence_status: "legacy_unverified",
    server_queryable: true,
    strict_semantics: false,
    note: "Maple Auction filter code; every result is reclassified from captured potential lines."
  }
});

export const STARFORCE_BANDS = deepFreeze([
  { id: "SF_ANY", min: null, max: null },
  { id: "SF_0", min: 0, max: 0 },
  { id: "SF_1_16", min: 1, max: 16 },
  { id: "SF_17_18", min: 17, max: 18 },
  { id: "SF_19_21", min: 19, max: 21 },
  { id: "SF_22", min: 22, max: 22 },
  { id: "SF_23", min: 23, max: 23 },
  { id: "SF_24", min: 24, max: 24 },
  { id: "SF_25_PLUS", min: 25, max: null }
]);

export const GLOBAL_HIGH_STARFORCE_RANGES = deepFreeze([
  { id: "SF_23", label: "전체 장비 · 23성", min: 23, max: 23 },
  { id: "SF_24", label: "전체 장비 · 24성", min: 24, max: 24 },
  { id: "SF_25_PLUS", label: "전체 장비 · 25성 이상", min: 25, max: null }
]);

export const GLOBAL_ACCESSORY_POTENTIAL_SEARCHES = deepFreeze([
  {
    id: "POT_ACCESSORY_MESO_20_PLUS",
    label: "전체 장신구 · 메소 획득량 증가 20% 이상",
    capability_id: "MESO_OBTAINED_PCT",
    minimum: 20
  },
  {
    id: "POT_ACCESSORY_DROP_20_PLUS",
    label: "전체 장신구 · 아이템 획득 확률 증가 20% 이상",
    capability_id: "ITEM_DROP_RATE_PCT",
    minimum: 20
  }
]);

const GLOBAL_CATEGORY_MAIN_STAT_BANDS = deepFreeze({
  ACCESSORY: [
    { id: "27_29", minimum: 27, maximum: 29, label: "27~29%" },
    { id: "30_32", minimum: 30, maximum: 32, label: "30~32%" },
    { id: "33_PLUS", minimum: 33, maximum: null, label: "33% 이상" }
  ],
  ARMOR: [
    { id: "27_29", minimum: 27, maximum: 29, label: "27~29%" },
    { id: "30_32", minimum: 30, maximum: 32, label: "30~32%" },
    { id: "33_35", minimum: 33, maximum: 35, label: "33~35%" },
    { id: "36_PLUS", minimum: 36, maximum: null, label: "36% 이상" }
  ]
});

const GLOBAL_CATEGORY_POTENTIAL_CONFIGS = deepFreeze([
  {
    id: "ACCESSORY",
    label: "장신구",
    item_category_filter: "ARMOR",
    equipment_subcategory_filter: "장신구",
    result_category_path_filter: "장신구"
  },
  {
    id: "ARMOR",
    label: "방어구",
    item_category_filter: "ARMOR",
    equipment_subcategory_filter: "방어구",
    result_category_path_filter: "방어구"
  }
]);

/**
 * Broad sold-item searches used to calibrate high-stat potential premiums.
 *
 * The auction filter only supplies a lower bound. `maximum` is a local result
 * bin boundary: the collector submits `minimum`, then keeps tooltip rows whose
 * effective selected-stat value falls inside the requested bin.  For a
 * STR/DEX/INT/LUK search, all-stat percentage contributes to that stat exactly
 * as it does to the in-game main-stat shorthand (for example STR 21% +
 * all-stat 9% belongs to the STR 30~32% band).
 */
export const GLOBAL_CATEGORY_POTENTIAL_SEARCHES = deepFreeze(
  GLOBAL_CATEGORY_POTENTIAL_CONFIGS.flatMap((category) => [
    ...["STR", "DEX", "INT", "LUK"].flatMap((stat) =>
      GLOBAL_CATEGORY_MAIN_STAT_BANDS[category.id].map((band) => ({
        id: `POT_${category.id}_${stat}_${band.id}`,
        label: `전체 ${category.label} · ${stat}% ${band.label}`,
        capability_id: `${stat}_PCT`,
        minimum: band.minimum,
        maximum: band.maximum,
        item_category_filter: category.item_category_filter,
        equipment_subcategory_filter: category.equipment_subcategory_filter,
        result_category_path_filter: category.result_category_path_filter,
        post_classify_profile: "MAIN_STAT"
      }))
    ),
    {
      id: `POT_${category.id}_ALL_STAT_21_PLUS`,
      label: `전체 ${category.label} · 올스탯% 21% 이상`,
      capability_id: "ALL_STAT_PCT",
      minimum: 21,
      maximum: null,
      item_category_filter: category.item_category_filter,
      equipment_subcategory_filter: category.equipment_subcategory_filter,
      result_category_path_filter: category.result_category_path_filter,
      post_classify_profile: "ALL_STAT"
    }
  ])
);

/** Classify an observed star count into the market bands used by training. */
export function starforceBandForValue(value) {
  if (!Number.isInteger(value) || value < 0) return null;
  if (value === 0) return "SF_0";
  if (value <= 16) return "SF_1_16";
  if (value <= 18) return "SF_17_18";
  if (value <= 21) return "SF_19_21";
  if (value === 22) return "SF_22";
  if (value === 23) return "SF_23";
  if (value === 24) return "SF_24";
  return "SF_25_PLUS";
}

const GROUP_LABELS = deepFreeze({
  core: "기타 핵심",
  eternal: "에테르넬",
  arcane: "아케인셰이드",
  absolab: "앱솔랩스",
  cra: "카루타",
  black: "칠흑의 보스",
  brilliant: "광휘의 보스",
  dawn: "여명의 보스",
  boss: "보스 장신구"
});

const SLOT_LABELS = deepFreeze({
  ring: "반지",
  hat: "모자",
  top: "상의",
  overall: "한벌옷",
  bottom: "하의",
  shoulder: "어깨장식",
  shoes: "신발",
  gloves: "장갑",
  cape: "망토",
  emblem_power_source: "엠블렘/파워소스",
  pendant: "펜던트",
  medal: "훈장",
  face: "얼굴장식",
  eye: "눈장식",
  belt: "벨트",
  earring: "귀고리",
  machine_heart: "기계 심장",
  badge: "뱃지",
  pocket: "포켓 아이템"
});

const UNIVERSAL_MAIN_STATS = deepFreeze(["STR", "DEX", "INT", "LUK"]);
const ACCESSORY_DROP_MESO_SLOTS = new Set(["ring", "pendant", "face", "eye", "earring"]);
const NO_STARFORCE_SLOTS = new Set(["emblem_power_source", "medal", "badge", "pocket"]);
const NO_POTENTIAL_SLOTS = new Set(["medal", "badge", "pocket"]);
const FULL_RESULT_SWEEP = deepFreeze({ enabled: true, max_pages: 9, result_cap: 500 });
export const BASELINE_MIN_PRICE_MESO = 50_000_000;

const ETERNAL_FAMILIES = deepFreeze([
  { key: "warrior", token: "나이트", main_stats: ["STR"] },
  { key: "mage", token: "메이지", main_stats: ["INT"] },
  { key: "archer", token: "아처", main_stats: ["DEX"] },
  { key: "thief", token: "시프", main_stats: ["LUK"] },
  { key: "pirate", token: "파이렛", main_stats: ["STR", "DEX"] }
]);

const ETERNAL_PARTS = deepFreeze([
  {
    slot: "hat",
    suffixes: { warrior: "헬름", mage: "햇", archer: "햇", thief: "반다나", pirate: "햇" }
  },
  {
    slot: "top",
    suffixes: { warrior: "아머", mage: "로브", archer: "후드", thief: "셔츠", pirate: "코트" }
  },
  {
    slot: "bottom",
    suffixes: { warrior: "팬츠", mage: "팬츠", archer: "팬츠", thief: "팬츠", pirate: "팬츠" }
  },
  {
    slot: "shoulder",
    suffixes: { warrior: "숄더", mage: "숄더", archer: "숄더", thief: "숄더", pirate: "숄더" }
  },
  {
    slot: "shoes",
    suffixes: { warrior: "슈즈", mage: "슈즈", archer: "슈즈", thief: "슈즈", pirate: "슈즈" }
  },
  {
    slot: "gloves",
    suffixes: { warrior: "글러브", mage: "글러브", archer: "글러브", thief: "글러브", pirate: "글러브" }
  },
  {
    slot: "cape",
    suffixes: { warrior: "케이프", mage: "케이프", archer: "케이프", thief: "케이프", pirate: "케이프" }
  }
]);

const ETERNAL_ITEMS = ETERNAL_PARTS.flatMap((part) => ETERNAL_FAMILIES.map((family) => makeItem({
  priority: "P1",
  group: "eternal",
  slot: part.slot,
  level: 250,
  name: `에테르넬 ${family.token}${part.suffixes[family.key]}`,
  job_family: family.key,
  main_stats: family.main_stats,
  search_group_id: `eternal:${family.key}`,
  search_keyword: `에테르넬 ${family.token}`,
  search_exact_match: false
})));

const ARCANE_PARTS = deepFreeze([
  { slot: "hat", suffix: "햇" },
  { slot: "overall", suffix: "슈트" },
  { slot: "shoulder", suffix: "숄더" },
  { slot: "shoes", suffix: "슈즈" },
  { slot: "gloves", suffix: "글러브" },
  { slot: "cape", suffix: "케이프" }
]);

const ARCANE_ITEMS = ARCANE_PARTS.flatMap((part) => ETERNAL_FAMILIES.map((family) => makeItem({
  priority: "P1",
  group: "arcane",
  slot: part.slot,
  level: 200,
  name: `아케인셰이드 ${family.token}${part.suffix}`,
  job_family: family.key,
  main_stats: family.main_stats,
  search_group_id: `arcane:${family.key}`,
  search_keyword: `아케인셰이드 ${family.token}`,
  search_exact_match: false
})));

const ABSOLAB_PARTS = deepFreeze([
  {
    slot: "hat",
    suffixes: {
      warrior: "나이트헬름",
      mage: "메이지크라운",
      archer: "아처후드",
      thief: "시프캡",
      pirate: "파이렛페도라"
    }
  },
  { slot: "overall", suffixes: familySuffixes("슈트") },
  { slot: "shoulder", suffixes: familySuffixes("숄더") },
  { slot: "shoes", suffixes: familySuffixes("슈즈") },
  { slot: "gloves", suffixes: familySuffixes("글러브") },
  { slot: "cape", suffixes: familySuffixes("케이프") }
]);

const ABSOLAB_ITEMS = ABSOLAB_PARTS.flatMap((part) => ETERNAL_FAMILIES.map((family) => makeItem({
  priority: "P1",
  group: "absolab",
  slot: part.slot,
  level: 160,
  name: `앱솔랩스 ${part.suffixes[family.key]}`,
  job_family: family.key,
  main_stats: family.main_stats,
  search_group_id: `absolab:${family.key}`,
  search_keyword: `앱솔랩스 ${family.token}`,
  search_exact_match: false
})));

const CRA_FAMILIES = deepFreeze([
  {
    key: "warrior",
    main_stats: ["STR"],
    names: ["하이네스 워리어헬름", "이글아이 워리어아머", "트릭스터 워리어팬츠"]
  },
  {
    key: "mage",
    main_stats: ["INT"],
    names: ["하이네스 던위치햇", "이글아이 던위치로브", "트릭스터 던위치팬츠"]
  },
  {
    key: "archer",
    main_stats: ["DEX"],
    names: ["하이네스 레인져베레", "이글아이 레인져후드", "트릭스터 레인져팬츠"]
  },
  {
    key: "thief",
    main_stats: ["LUK"],
    names: ["하이네스 어새신보닛", "이글아이 어새신셔츠", "트릭스터 어새신팬츠"]
  },
  {
    key: "pirate",
    main_stats: ["STR", "DEX"],
    names: ["하이네스 원더러햇", "이글아이 원더러코트", "트릭스터 원더러팬츠"]
  }
]);

const CRA_PARTS = deepFreeze([
  { slot: "hat", prefix: "하이네스" },
  { slot: "top", prefix: "이글아이" },
  { slot: "bottom", prefix: "트릭스터" }
]);

const CRA_ITEMS = CRA_FAMILIES.flatMap((family) => CRA_PARTS.map((part, index) => makeItem({
  priority: "P1",
  group: "cra",
  slot: part.slot,
  level: 150,
  name: family.names[index],
  job_family: family.key,
  main_stats: family.main_stats,
  search_group_id: `cra:${part.prefix}`,
  search_keyword: part.prefix,
  search_exact_match: false
})));

const MITRA_ITEMS = [
  ["전사", "warrior", ["STR"], "ATTACK"],
  ["마법사", "mage", ["INT"], "MAGIC_ATTACK"],
  ["궁수", "archer", ["DEX"], "ATTACK"],
  ["도적", "thief", ["LUK"], "ATTACK"],
  ["해적", "pirate", ["STR", "DEX"], "ATTACK"]
].map(([variant, jobFamily, mainStats, mitraAttackCode]) => makeItem({
  priority: "P1",
  group: "black",
  subgroup: "mitra",
  slot: "emblem_power_source",
  level: 200,
  name: `미트라의 분노 : ${variant}`,
  job_family: jobFamily,
  main_stats: mainStats,
  mitra_attack_code: mitraAttackCode,
  force_starforce_eligibility: false,
  force_potential_eligibility: true
}));

const NON_ETERNAL_ROWS = [
  ["P1", "core", null, "ring", 140, "마이스터링"],
  ["P1", "core", null, "earring", 140, "마이스터 이어링"],
  ["P1", "core", null, "shoulder", 140, "마이스터 숄더"],

  ["P1", "brilliant", null, "ring", 250, "근원의 속삭임"],
  ["P1", "brilliant", null, "ring", 250, "황홀한 악몽"],
  ["P1", "brilliant", null, "pendant", 250, "죽음의 맹세"],
  ["P1", "brilliant", null, "medal", 250, "불멸의 유산"],
  ["P1", "brilliant", null, "face", 250, "오만의 원죄"],
  ["P1", "brilliant", null, "eye", 250, "굶주리는 핏빛 원혼"],

  ["P1", "black", "enhanced", "face", 160, "루즈 컨트롤 머신 마크"],
  ["P1", "black", "enhanced", "eye", 160, "마력이 깃든 안대"],
  ["P1", "black", "enhanced", "pendant", 160, "고통의 근원"],
  ["P1", "black", "enhanced", "belt", 200, "몽환의 벨트"],
  ["P1", "black", "enhanced", "earring", 200, "커맨더 포스 이어링"],
  ["P1", "black", "enhanced", "ring", 200, "거대한 공포"],
  ["P1", "black", "enhanced", "machine_heart", 200, "컴플리트 언더컨트롤"],

  ["P1", "dawn", null, "face", 140, "트와일라이트 마크"],
  ["P1", "dawn", null, "earring", 160, "에스텔라 이어링"],
  ["P1", "dawn", null, "ring", 160, "여명의 가디언 엔젤 링"],
  ["P1", "dawn", null, "pendant", 140, "데이브레이크 펜던트"],

  ["P1", "boss", null, "ring", 160, "가디언 엔젤 링"],
  ["P1", "boss", null, "pendant", 140, "도미네이터 펜던트"],
  ["P1", "boss", null, "eye", 145, "파풀라투스 마크"],
  ["P1", "boss", null, "eye", 135, "블랙빈 마크"],
  ["P1", "boss", null, "belt", 140, "골든 클로버 벨트"],
  ["P1", "boss", null, "belt", 150, "분노한 자쿰의 벨트"],

  ["P2", "black", "auxiliary", "badge", 200, "창세의 뱃지"],
  ["P2", "black", "auxiliary", "pocket", 160, "저주받은 적의 마도서"],
  ["P2", "black", "auxiliary", "pocket", 160, "저주받은 청의 마도서"],
  ["P2", "black", "auxiliary", "pocket", 160, "저주받은 녹의 마도서"],
  ["P2", "black", "auxiliary", "pocket", 160, "저주받은 황의 마도서"],

  ["P2", "boss", null, "earring", 130, "데아 시두스 이어링"],
  ["P2", "boss", null, "ring", 120, "고귀한 이피아의 반지"],
  ["P2", "boss", null, "pendant", 120, "카오스 혼테일의 목걸이"],
  ["P2", "boss", null, "pendant", 120, "매커네이터 펜던트"],
  ["P2", "boss", null, "pocket", 140, "핑크빛 성배"]
];

const SF_ONE_PLUS_ONLY_NAMES = new Set([
  "데아 시두스 이어링",
  "고귀한 이피아의 반지",
  "카오스 혼테일의 목걸이",
  "매커네이터 펜던트"
]);

const MEISTER_ITEM_COUNT = 3;

const OTHER_ITEMS = NON_ETERNAL_ROWS.map(([priority, group, subgroup, slot, level, name]) => makeItem({
  priority,
  group,
  subgroup,
  slot,
  level,
  name,
  main_stats: UNIVERSAL_MAIN_STATS,
  query_policy: name === "창세의 뱃지"
    ? "recent_baseline_only"
    : SF_ONE_PLUS_ONLY_NAMES.has(name) ? "sf_one_plus_only" : "default",
  search_keyword: name,
  search_exact_match: true
}));

export const CATALOG_ITEMS = deepFreeze([
  ...OTHER_ITEMS.slice(0, MEISTER_ITEM_COUNT),
  ...ETERNAL_ITEMS,
  ...ARCANE_ITEMS,
  ...ABSOLAB_ITEMS,
  ...CRA_ITEMS,
  ...MITRA_ITEMS,
  ...OTHER_ITEMS.slice(MEISTER_ITEM_COUNT)
]);

export const CATALOG_BY_NAME = Object.freeze(Object.fromEntries(
  CATALOG_ITEMS.map((item) => [item.name, item])
));

export const CATALOG_BY_ID = Object.freeze(Object.fromEntries(
  CATALOG_ITEMS.map((item) => [item.id, item])
));

export function getCatalogItem(itemOrIdOrName) {
  if (itemOrIdOrName && typeof itemOrIdOrName === "object") {
    return itemOrIdOrName;
  }
  if (typeof itemOrIdOrName !== "string") {
    return null;
  }
  return CATALOG_BY_ID[itemOrIdOrName] || CATALOG_BY_NAME[itemOrIdOrName] || null;
}

export function potentialThresholdsForLevel(level) {
  if (!Number.isInteger(level) || level < 0) {
    throw new TypeError("level must be a non-negative integer");
  }
  return level >= 201
    ? POTENTIAL_THRESHOLDS.LEVEL_201_OR_ABOVE
    : POTENTIAL_THRESHOLDS.LEVEL_200_OR_BELOW;
}

export function applicablePotentialProfiles(itemOrIdOrName) {
  const item = requireCatalogItem(itemOrIdOrName);
  return [...item.potential_profiles];
}

export function getPotentialFilterCapability(capabilityId) {
  return POTENTIAL_FILTER_CAPABILITIES[capabilityId] || null;
}

/**
 * Expand fixed catalogue items into physical auction queries.
 *
 * Logical lanes that have no verified server mapping are folded into the
 * baseline query's `logical_lanes` and `post_classify_profiles`.  Identical
 * physical requests are merged so local-only profiles never spend quota twice.
 * Armor families with a shared prefix are then collapsed into one physical
 * query.  Consumers must accept only `allowed_names` and resolve each result
 * to one of `catalog_ids` before applying item-specific classification.
 */
export function expandCatalogQueries(options = {}) {
  const priorities = new Set(options.priorities || ["P1", "P2"]);
  const includeBaseline = options.include_baseline !== false;
  const includeStarforce = options.include_starforce !== false;
  const includePotential = options.include_potential !== false;
  const includeLocalOnly = options.include_local_only !== false;
  const requestedItemIds = options.item_ids ? new Set(options.item_ids) : null;
  const logicalQueries = [];

  for (const item of CATALOG_ITEMS) {
    if (!priorities.has(item.priority) || (requestedItemIds && !requestedItemIds.has(item.id))) {
      continue;
    }

    const itemQueries = new Map();
    const addQuery = (definition, logicalLane, postClassifyProfile = null) => {
      const signature = physicalQuerySignature(definition);
      let query = itemQueries.get(signature);
      if (!query) {
        query = {
          query_id: `${CATALOG_VERSION}:${item.id}:${signature}`,
          catalog_version: CATALOG_VERSION,
          catalog_id: item.id,
          catalog_ids: [item.id],
          exact_name: item.name,
          search_keyword: item.search_keyword,
          search_group_id: item.search_group_id,
          allowed_names: [item.name],
          priority: item.priority,
          group: item.group,
          slot: item.slot,
          slots: [item.slot],
          level: item.level,
          levels: [item.level],
          sold_only: true,
          sort: "TRADE_DATE_DESC",
          exact_match: item.search_exact_match,
          page_limit_preference: [60],
          starforce_min: definition.starforce_min == null ? null : definition.starforce_min,
          starforce_max: definition.starforce_max == null ? null : definition.starforce_max,
          price_min_meso: definition.price_min_meso == null ? null : definition.price_min_meso,
          price_max_meso: definition.price_max_meso == null ? null : definition.price_max_meso,
          potential_filter: definition.potential_filter || null,
          page_sweep: definition.page_sweep || null,
          logical_lanes: [],
          selection_channels: [],
          post_classify_profiles: []
        };
        itemQueries.set(signature, query);
      }
      pushUnique(query.logical_lanes, logicalLane);
      pushUnique(query.selection_channels, logicalLane);
      if (postClassifyProfile) {
        pushUnique(query.post_classify_profiles, postClassifyProfile);
      }
    };

    const localClassificationDefinition = item.query_policy === "sf_one_plus_only"
      ? { starforce_min: 1, starforce_max: null, page_sweep: FULL_RESULT_SWEEP }
      : item.query_policy === "recent_baseline_only"
        ? { page_sweep: null }
        : { price_min_meso: BASELINE_MIN_PRICE_MESO, page_sweep: FULL_RESULT_SWEEP };
    const needsBaseline = includeBaseline || (includePotential && includeLocalOnly);

    if (item.query_policy === "sf_one_plus_only") {
      if (needsBaseline || includeStarforce) {
        addQuery(localClassificationDefinition, "BASE_ANY");
        addQuery(localClassificationDefinition, "SF_1_PLUS");
      }
    } else if (needsBaseline) {
      addQuery(localClassificationDefinition, "BASE_ANY");
    }

    if (
      includeStarforce &&
      item.starforce_eligible &&
      item.query_policy !== "sf_one_plus_only" &&
      item.query_policy !== "recent_baseline_only"
    ) {
      addQuery({
        starforce_min: 0,
        starforce_max: 0,
        page_sweep: FULL_RESULT_SWEEP
      }, "SF_0");
      addQuery({
        starforce_min: 17,
        starforce_max: null,
        page_sweep: FULL_RESULT_SWEEP
      }, "SF_17_PLUS");
    }

    if (includePotential && item.potential_eligible) {
      const thresholds = potentialThresholdsForLevel(item.level);
      for (const stat of item.main_stats) {
        if (!item.potential_profiles.includes("MAIN_STAT")) {
          break;
        }
        addQuery(localClassificationDefinition, `POT_MAIN_${stat}`, "MAIN_STAT");
      }
      if (item.potential_profiles.includes("ALL_STAT")) {
        addQuery(localClassificationDefinition, "POT_ALL_STAT", "ALL_STAT");
      }
      if (item.potential_profiles.includes("MAX_HP")) {
        addPotentialLane(
          addQuery,
          "POT_MAX_HP",
          "HP_PCT",
          thresholds.hp_pct.two_line,
          "MAX_HP",
          includeLocalOnly,
          { local_definition: localClassificationDefinition }
        );
      }
      if (item.potential_profiles.includes("XENON_MIXED") && includeLocalOnly) {
        addQuery(localClassificationDefinition, "POT_XENON_MIXED", "XENON_MIXED");
      }
      if (item.potential_profiles.includes("HAT_COOLDOWN") && includeLocalOnly) {
        addQuery(localClassificationDefinition, "POT_HAT_COOLDOWN", "HAT_COOLDOWN");
      }
      if (item.potential_profiles.includes("GLOVE_CRITICAL_DAMAGE") && includeLocalOnly) {
        addQuery(localClassificationDefinition, "POT_GLOVE_CRITICAL_DAMAGE", "GLOVE_CRITICAL_DAMAGE");
      }
      if (item.potential_profiles.includes("ACCESSORY_DROP_MESO") && includeLocalOnly) {
        addQuery(localClassificationDefinition, "POT_ACCESSORY_DROP_MESO", "ACCESSORY_DROP_MESO");
      }
      if (item.potential_profiles.includes("MITRA_OPTIMAL")) {
        const capabilityId = item.mitra_attack_code === "MAGIC_ATTACK"
          ? "MAGIC_ATTACK_PCT"
          : "ATTACK_PCT";
        addPotentialLane(
          addQuery,
          `POT_MITRA_${item.mitra_attack_code}`,
          capabilityId,
          21,
          "MITRA_OPTIMAL",
          includeLocalOnly,
          { page_sweep: FULL_RESULT_SWEEP }
        );
        if (includeLocalOnly) {
          addQuery(localClassificationDefinition, "POT_MITRA_IGNORE_DEFENSE", "MITRA_OPTIMAL");
        }
      }
    }

    logicalQueries.push(...itemQueries.values());
  }

  const groupedQueries = mergeGroupedCatalogQueries(logicalQueries);
  const globalStarforceQueries = includeStarforce && !requestedItemIds && options.include_global_high_starforce !== false
    ? buildGlobalHighStarforceQueries(priorities)
    : [];
  const globalAccessoryQueries = includePotential && !requestedItemIds &&
    options.include_global_accessory_potential !== false
    ? buildGlobalAccessoryPotentialQueries(priorities)
    : [];
  const globalCategoryPotentialQueries = includePotential && !requestedItemIds &&
    options.include_global_category_potential !== false
    ? buildGlobalCategoryPotentialQueries(priorities)
    : [];
  return deepFreeze([
    ...groupedQueries,
    ...globalStarforceQueries,
    ...globalAccessoryQueries,
    ...globalCategoryPotentialQueries
  ].map((query) => ({
    ...query,
    logical_lanes: [...query.logical_lanes].sort(),
    selection_channels: [...query.selection_channels].sort(),
    post_classify_profiles: [...query.post_classify_profiles].sort()
  })));
}

/**
 * Parse relevant percentage/seconds potential lines without folding Xenon's
 * STR, DEX, LUK, and all-stat values together.  MP lines are intentionally
 * ignored and never become a market profile.
 */
export function summarizePotentialLines(potentialOrLines) {
  const lines = Array.isArray(potentialOrLines)
    ? potentialOrLines
    : Array.isArray(potentialOrLines && potentialOrLines.lines) ? potentialOrLines.lines : [];
  const percent = Object.fromEntries(STAT_CODES.map((code) => [code, 0]));
  const percent_lines = Object.fromEntries(STAT_CODES.map((code) => [code, []]));
  const seconds = { COOLDOWN_REDUCTION: 0 };
  let ignored_line_count = 0;
  let unknown_line_count = 0;

  for (const line of lines) {
    const parsed = normalizePotentialLine(line);
    if (parsed.ignored) {
      ignored_line_count += 1;
      continue;
    }
    if (!parsed.code || parsed.value == null) {
      unknown_line_count += 1;
      continue;
    }
    if (parsed.code === "COOLDOWN_REDUCTION" && parsed.unit === "seconds") {
      seconds.COOLDOWN_REDUCTION += Math.abs(parsed.value);
      continue;
    }
    if (parsed.unit !== "pct" || !hasOwn(percent, parsed.code)) {
      ignored_line_count += 1;
      continue;
    }
    const value = Number(parsed.value);
    if (!Number.isFinite(value)) {
      unknown_line_count += 1;
      continue;
    }
    percent[parsed.code] += value;
    percent_lines[parsed.code].push(value);
  }

  return deepFreeze({
    percent,
    percent_lines,
    seconds,
    ignored_line_count,
    unknown_line_count
  });
}

/**
 * Return why a captured row does not belong to a category-potential query.
 *
 * The auction site only applies the lower bound, so finite upper bounds are
 * enforced locally against the effective percentage stat. All-stat contributes
 * to STR/DEX/INT/LUK, while an all-stat query still checks all-stat itself.
 * `null` means the row belongs in the requested bin; non-category queries are
 * intentionally left untouched.
 */
export function globalCategoryPotentialExclusion(record, query = {}) {
  if (query.group !== "global_category_potential") return null;

  const expectedCategory = String(query.result_category_path_filter || "").trim();
  const observedCategory = equipmentCategoryFromPath(record?.item?.category_path);
  if (!expectedCategory || observedCategory !== expectedCategory) return "category";

  const filter = query.potential_filter;
  const capabilityId = String(filter?.capability_id || "");
  const stat = capabilityId.replace(/_PCT$/u, "");
  const totals = record?.profile_classification?.totals?.percent || {};
  const direct = Number(totals[stat]);
  const allStat = Number(totals.ALL_STAT);
  const value = stat === "ALL_STAT"
    ? direct
    : (Number.isFinite(direct) ? direct : 0) + (Number.isFinite(allStat) ? allStat : 0);
  if (!Number.isFinite(value) || value < Number(filter?.minimum ?? 0)) return "range";
  if (filter?.maximum != null && value > Number(filter.maximum)) return "range";
  return null;
}

/**
 * Normalize API category paths from observed grouped and slot-only shapes.
 * 장신구 is the more specific classification and wins before the broad
 * 방어구 token. The slot allowlists cover responses such as `["어깨장식"]`
 * where the API omits a parent category altogether.
 */
export function equipmentCategoryFromPath(categoryPath) {
  if (!Array.isArray(categoryPath)) return null;
  const values = categoryPath.map((value) => String(value || "").trim()).filter(Boolean);
  if (values.includes("장신구")) return "장신구";
  if (values.includes("방어구")) return "방어구";
  if (values.some((value) => ACCESSORY_EQUIPMENT_SLOT_LABELS.includes(value))) return "장신구";
  if (values.some((value) => ARMOR_EQUIPMENT_SLOT_LABELS.includes(value))) return "방어구";
  return null;
}

export function classifyPotentialProfiles(itemOrIdOrName, potentialOrLines) {
  const item = requireCatalogItem(itemOrIdOrName);
  const totals = summarizePotentialLines(potentialOrLines);
  const thresholds = potentialThresholdsForLevel(item.level);
  const profiles = {};

  if (item.potential_profiles.includes("MAIN_STAT")) {
    profiles.MAIN_STAT = item.main_stats.map((stat) => {
      const direct = totals.percent[stat];
      const allStat = totals.percent.ALL_STAT;
      const effective = direct + allStat;
      return {
        stat,
        direct_pct: direct,
        all_stat_pct: allStat,
        effective_pct: effective,
        grade: thresholdGrade(effective, thresholds.main_stat_pct),
        matched: effective >= thresholds.main_stat_pct.two_line
      };
    });
  }

  if (item.potential_profiles.includes("ALL_STAT")) {
    const value = totals.percent.ALL_STAT;
    profiles.ALL_STAT = {
      value_pct: value,
      grade: thresholdGrade(value, thresholds.all_stat_pct),
      matched: value >= thresholds.all_stat_pct.two_line
    };
  }

  if (item.potential_profiles.includes("MAX_HP")) {
    const value = totals.percent.HP;
    profiles.MAX_HP = {
      value_pct: value,
      grade: thresholdGrade(value, thresholds.hp_pct),
      matched: value >= thresholds.hp_pct.two_line,
      all_stat_is_not_hp: true
    };
  }

  if (item.potential_profiles.includes("XENON_MIXED")) {
    const preserved = {
      STR: totals.percent.STR,
      DEX: totals.percent.DEX,
      LUK: totals.percent.LUK,
      ALL_STAT: totals.percent.ALL_STAT
    };
    profiles.XENON_MIXED = {
      preserved_pct: preserved,
      effective_pct_by_stat: {
        STR: preserved.STR + preserved.ALL_STAT,
        DEX: preserved.DEX + preserved.ALL_STAT,
        LUK: preserved.LUK + preserved.ALL_STAT
      },
      matched: Object.values(preserved).some((value) => value > 0),
      requires_character_equivalence_model: true,
      collapsed_search_value: null
    };
  }

  if (item.potential_profiles.includes("HAT_COOLDOWN")) {
    const value = totals.seconds.COOLDOWN_REDUCTION;
    profiles.HAT_COOLDOWN = {
      value_seconds: value,
      matched: value > 0
    };
  }

  if (item.potential_profiles.includes("GLOVE_CRITICAL_DAMAGE")) {
    const value = totals.percent.CRITICAL_DAMAGE;
    profiles.GLOVE_CRITICAL_DAMAGE = {
      value_pct: value,
      matched: value > 0
    };
  }

  if (item.potential_profiles.includes("ACCESSORY_DROP_MESO")) {
    const drop = totals.percent.ITEM_DROP_RATE;
    const meso = totals.percent.MESO_OBTAINED;
    const mainStatThreeLine = (profiles.MAIN_STAT || []).filter((entry) =>
      entry.effective_pct >= thresholds.main_stat_pct.three_line
    ).map((entry) => entry.stat);
    const allStatThreeLine = totals.percent.ALL_STAT >= thresholds.all_stat_pct.three_line;
    const reasons = [];
    if (mainStatThreeLine.length > 0) reasons.push(`MAIN_STAT_${mainStatThreeLine.join("_")}`);
    if (allStatThreeLine) reasons.push("ALL_STAT");
    const matchedTargets = ACCESSORY_DROP_MESO_TARGETS
      .filter((target) => drop >= target.minimum_drop_pct && meso >= target.minimum_meso_pct)
      .map((target) => target.id);
    reasons.push(...matchedTargets);
    profiles.ACCESSORY_DROP_MESO = {
      drop_pct: drop,
      meso_pct: meso,
      main_stat_three_line: mainStatThreeLine,
      all_stat_three_line: allStatThreeLine,
      matched_targets: matchedTargets,
      matched: reasons.length > 0,
      reasons
    };
  }

  if (item.potential_profiles.includes("MITRA_OPTIMAL")) {
    profiles.MITRA_OPTIMAL = classifyMitra(item, totals);
  }

  return deepFreeze({
    catalog_id: item.id,
    item_name: item.name,
    level_band: item.level >= 201 ? "LEVEL_201_OR_ABOVE" : "LEVEL_200_OR_BELOW",
    totals,
    profiles
  });
}

export function classifyPotentialProfile(profileId, itemOrIdOrName, potentialOrLines) {
  if (!POTENTIAL_PROFILE_IDS.includes(profileId)) {
    throw new RangeError(`Unknown potential profile: ${profileId}`);
  }
  const result = classifyPotentialProfiles(itemOrIdOrName, potentialOrLines).profiles[profileId];
  return result == null ? null : result;
}

export function validatePotentialFilterCapabilities(registry = POTENTIAL_FILTER_CAPABILITIES) {
  const statuses = new Set(["observed", "observed_ambiguous", "legacy_unverified", "local_only"]);
  const codes = new Set();
  for (const [id, capability] of Object.entries(registry)) {
    if (!statuses.has(capability.evidence_status)) {
      throw new Error(`${id}: invalid evidence_status`);
    }
    if (capability.server_queryable !== Boolean(capability.auction_code)) {
      throw new Error(`${id}: server_queryable and auction_code disagree`);
    }
    if (capability.auction_code) {
      if (codes.has(capability.auction_code)) {
        throw new Error(`${id}: duplicate auction code ${capability.auction_code}`);
      }
      codes.add(capability.auction_code);
    }
  }
  return deepFreeze({ valid: true, capability_count: Object.keys(registry).length });
}

export function validateCatalog(catalog = CATALOG_ITEMS) {
  if (!Array.isArray(catalog)) {
    throw new TypeError("catalog must be an array");
  }
  if (catalog.length !== CATALOG_EXPECTED_COUNTS.total) {
    throw new Error(`catalog count must be ${CATALOG_EXPECTED_COUNTS.total}, got ${catalog.length}`);
  }

  const names = new Set();
  const ids = new Set();
  const priority = { P1: 0, P2: 0 };
  const group = Object.fromEntries(Object.keys(CATALOG_EXPECTED_COUNTS.group).map((key) => [key, 0]));

  for (const item of catalog) {
    if (!item || typeof item !== "object") throw new Error("catalog item must be an object");
    if (!item.name || names.has(item.name)) throw new Error(`duplicate or empty item name: ${item.name}`);
    if (!item.id || ids.has(item.id)) throw new Error(`duplicate or empty item id: ${item.id}`);
    if (!hasOwn(priority, item.priority)) throw new Error(`${item.name}: invalid priority`);
    if (!hasOwn(group, item.group)) throw new Error(`${item.name}: invalid group`);
    if (!hasOwn(SLOT_LABELS, item.slot)) throw new Error(`${item.name}: invalid slot`);
    if (!Number.isInteger(item.level) || item.level < 0) throw new Error(`${item.name}: invalid level`);
    if (!Array.isArray(item.main_stats) || item.main_stats.some((stat) => !UNIVERSAL_MAIN_STATS.includes(stat))) {
      throw new Error(`${item.name}: invalid main_stats`);
    }
    if (item.potential_profiles.some((profile) => !POTENTIAL_PROFILE_IDS.includes(profile))) {
      throw new Error(`${item.name}: invalid potential profile`);
    }
    if (!item.potential_eligible && item.potential_profiles.length > 0) {
      throw new Error(`${item.name}: ineligible item has potential profiles`);
    }
    if (item.potential_profiles.includes("ACCESSORY_DROP_MESO") && !ACCESSORY_DROP_MESO_SLOTS.has(item.slot)) {
      throw new Error(`${item.name}: drop/meso profile is not valid for ${item.slot}`);
    }
    if (item.potential_profiles.includes("HAT_COOLDOWN") !== (item.potential_eligible && item.slot === "hat")) {
      throw new Error(`${item.name}: hat profile mismatch`);
    }
    if (item.potential_profiles.includes("GLOVE_CRITICAL_DAMAGE") !== (item.potential_eligible && item.slot === "gloves")) {
      throw new Error(`${item.name}: glove profile mismatch`);
    }
    if (item.potential_profiles.includes("MITRA_OPTIMAL") !== (item.subgroup === "mitra")) {
      throw new Error(`${item.name}: Mitra profile mismatch`);
    }
    if (
      !["default", "recent_baseline_only", "sf_one_plus_only"].includes(item.query_policy)
    ) {
      throw new Error(`${item.name}: invalid query policy`);
    }
    if (
      item.search_exact_match === false &&
      (!item.search_group_id || !item.search_keyword)
    ) {
      throw new Error(`${item.name}: grouped search metadata is incomplete`);
    }
    names.add(item.name);
    ids.add(item.id);
    priority[item.priority] += 1;
    group[item.group] += 1;
  }

  assertCountMap("priority", priority, CATALOG_EXPECTED_COUNTS.priority);
  assertCountMap("group", group, CATALOG_EXPECTED_COUNTS.group);

  const exactMitraNames = new Set([
    "미트라의 분노 : 전사",
    "미트라의 분노 : 마법사",
    "미트라의 분노 : 궁수",
    "미트라의 분노 : 도적",
    "미트라의 분노 : 해적"
  ]);
  const actualMitraNames = new Set(catalog.filter((item) => item.subgroup === "mitra").map((item) => item.name));
  if (!sameSet(exactMitraNames, actualMitraNames)) throw new Error("Mitra exact-name set mismatch");
  if (names.has("미트라의 분노 : 제논")) throw new Error("There is no Mitra Xenon variant");

  const eternal = catalog.filter((item) => item.group === "eternal");
  if (eternal.length !== 35) throw new Error("Eternal catalog must contain exactly 35 items");
  for (const part of ETERNAL_PARTS) {
    if (eternal.filter((item) => item.slot === part.slot).length !== 5) {
      throw new Error(`Eternal ${part.slot} must contain exactly five job variants`);
    }
  }

  for (const [group, parts, itemCount] of [
    ["arcane", ARCANE_PARTS, 30],
    ["absolab", ABSOLAB_PARTS, 30],
    ["cra", CRA_PARTS, 15]
  ]) {
    const groupItems = catalog.filter((item) => item.group === group);
    if (groupItems.length !== itemCount) {
      throw new Error(`${group} catalog must contain exactly ${itemCount} items`);
    }
    for (const part of parts) {
      if (groupItems.filter((item) => item.slot === part.slot).length !== 5) {
        throw new Error(`${group} ${part.slot} must contain exactly five job variants`);
      }
    }
  }

  for (const requiredName of [
    "굶주리는 핏빛 원혼",
    "고통의 근원",
    "컴플리트 언더컨트롤",
    "매커네이터 펜던트",
    "가디언 엔젤 링",
    "여명의 가디언 엔젤 링",
    "아케인셰이드 나이트햇",
    "앱솔랩스 메이지크라운",
    "하이네스 어새신보닛",
    "이글아이 레인져후드",
    "트릭스터 원더러팬츠"
  ]) {
    if (!names.has(requiredName)) throw new Error(`required exact name missing: ${requiredName}`);
  }

  return deepFreeze({
    valid: true,
    catalog_version: CATALOG_VERSION,
    total: catalog.length,
    priority,
    group,
    mitra: actualMitraNames.size,
    eternal: eternal.length,
    arcane: group.arcane,
    absolab: group.absolab,
    cra: group.cra
  });
}

export const POTENTIAL_FILTER_VALIDATION = validatePotentialFilterCapabilities();
export const CATALOG_VALIDATION = validateCatalog();

function makeItem(config) {
  const potentialEligible = config.force_potential_eligibility == null
    ? !NO_POTENTIAL_SLOTS.has(config.slot)
    : config.force_potential_eligibility;
  const starforceEligible = config.force_starforce_eligibility == null
    ? !NO_STARFORCE_SLOTS.has(config.slot)
    : config.force_starforce_eligibility;
  const mainStats = [...(config.main_stats || UNIVERSAL_MAIN_STATS)];
  const isMitra = config.subgroup === "mitra";
  const isUniversal = !config.job_family;
  const xenonEligible = potentialEligible && !isMitra && (
    isUniversal || config.job_family === "thief" || config.job_family === "pirate"
  );
  const hpEligible = potentialEligible && !isMitra && (isUniversal || config.job_family === "warrior");
  const profiles = [];
  if (potentialEligible && !isMitra) profiles.push("MAIN_STAT", "ALL_STAT");
  if (hpEligible) profiles.push("MAX_HP");
  if (xenonEligible) profiles.push("XENON_MIXED");
  if (potentialEligible && config.slot === "hat") profiles.push("HAT_COOLDOWN");
  if (potentialEligible && config.slot === "gloves") profiles.push("GLOVE_CRITICAL_DAMAGE");
  if (potentialEligible && ACCESSORY_DROP_MESO_SLOTS.has(config.slot)) profiles.push("ACCESSORY_DROP_MESO");
  if (isMitra) profiles.push("MITRA_OPTIMAL");

  return {
    id: `${config.group}:${config.name}`,
    name: config.name,
    priority: config.priority,
    group: config.group,
    group_label: GROUP_LABELS[config.group],
    subgroup: config.subgroup || null,
    slot: config.slot,
    slot_label: SLOT_LABELS[config.slot],
    level: config.level,
    job_family: config.job_family || null,
    main_stats: mainStats,
    starforce_eligible: starforceEligible,
    potential_eligible: potentialEligible,
    potential_profiles: profiles,
    hp_profile_eligible: profiles.includes("MAX_HP"),
    all_stat_profile_eligible: profiles.includes("ALL_STAT"),
    xenon_profile_eligible: profiles.includes("XENON_MIXED"),
    accessory_profile_eligible: profiles.includes("ACCESSORY_DROP_MESO"),
    hat_profile_eligible: profiles.includes("HAT_COOLDOWN"),
    glove_profile_eligible: profiles.includes("GLOVE_CRITICAL_DAMAGE"),
    mitra_attack_code: config.mitra_attack_code || null,
    query_policy: config.query_policy || "default",
    search_group_id: config.search_group_id || null,
    search_keyword: config.search_keyword || config.name,
    search_exact_match: config.search_exact_match !== false
  };
}

function addPotentialLane(
  addQuery,
  logicalLane,
  capabilityId,
  minimum,
  postClassifyProfile,
  includeLocalOnly,
  options = {}
) {
  const capability = POTENTIAL_FILTER_CAPABILITIES[capabilityId];
  if (!capability) throw new Error(`Unknown potential capability: ${capabilityId}`);
  if (capability.server_queryable) {
    addQuery({
      potential_filter: {
        capability_id: capabilityId,
        auction_code: capability.auction_code,
        minimum,
        evidence_status: capability.evidence_status,
        strict_semantics: capability.strict_semantics
      },
      page_sweep: options.page_sweep || null
    }, logicalLane, postClassifyProfile);
  } else if (includeLocalOnly) {
    addQuery(options.local_definition || {}, logicalLane, postClassifyProfile);
  }
}

function familySuffixes(suffix) {
  return Object.fromEntries(ETERNAL_FAMILIES.map((family) => [
    family.key,
    `${family.token}${suffix}`
  ]));
}

function mergeGroupedCatalogQueries(queries) {
  const merged = new Map();
  for (const query of queries) {
    if (!query.search_group_id) {
      merged.set(query.query_id, query);
      continue;
    }

    const signature = physicalQuerySignature(query);
    const mergeKey = `${query.search_group_id}:${signature}`;
    let grouped = merged.get(mergeKey);
    if (!grouped) {
      grouped = {
        ...query,
        query_id: `${CATALOG_VERSION}:group:${query.search_group_id}:${signature}`,
        catalog_id: null,
        catalog_ids: [],
        exact_name: query.search_keyword,
        allowed_names: [],
        slot: null,
        slots: [],
        levels: [],
        logical_lanes: [],
        selection_channels: [],
        post_classify_profiles: []
      };
      merged.set(mergeKey, grouped);
    }
    if (
      grouped.search_keyword !== query.search_keyword ||
      grouped.exact_match !== query.exact_match ||
      grouped.priority !== query.priority ||
      grouped.group !== query.group
    ) {
      throw new Error(`${query.search_group_id}: incompatible grouped auction query`);
    }
    for (const catalogId of query.catalog_ids) pushUnique(grouped.catalog_ids, catalogId);
    for (const name of query.allowed_names) pushUnique(grouped.allowed_names, name);
    for (const slot of query.slots) pushUnique(grouped.slots, slot);
    for (const level of query.levels) pushUnique(grouped.levels, level);
    for (const lane of query.logical_lanes) pushUnique(grouped.logical_lanes, lane);
    for (const channel of query.selection_channels) pushUnique(grouped.selection_channels, channel);
    for (const profile of query.post_classify_profiles) pushUnique(grouped.post_classify_profiles, profile);
  }
  return [...merged.values()].map((query) => {
    if (!query.search_group_id) return query;
    const memberToken = stableTextToken([...query.allowed_names].sort().join("\u001f"));
    return {
      ...query,
      query_id: `${CATALOG_VERSION}:group:${query.search_group_id}:members-${memberToken}:${physicalQuerySignature(query)}`
    };
  });
}

function buildGlobalHighStarforceQueries(priorities) {
  const members = CATALOG_ITEMS.filter((item) =>
    priorities.has(item.priority) && item.starforce_eligible
  );
  if (members.length === 0) return [];
  const catalogIds = members.map((item) => item.id);
  const allowedNames = members.map((item) => item.name);
  const memberToken = stableTextToken([...allowedNames].sort().join("\u001f"));
  const priority = members.some((item) => item.priority === "P1") ? "P1" : "P2";

  return GLOBAL_HIGH_STARFORCE_RANGES.map((range) => ({
    query_id: `${CATALOG_VERSION}:global:members-${memberToken}:${physicalQuerySignature({
      starforce_min: range.min,
      starforce_max: range.max
    })}`,
    catalog_version: CATALOG_VERSION,
    catalog_id: null,
    catalog_ids: [...catalogIds],
    exact_name: null,
    search_keyword: "",
    display_name: range.label,
    search_scope: "catalog_global",
    progress_scope: "global",
    search_group_id: null,
    allowed_names: [...allowedNames],
    priority,
    group: "global_high_starforce",
    slot: null,
    slots: [...new Set(members.map((item) => item.slot))],
    level: null,
    levels: [...new Set(members.map((item) => item.level))],
    sold_only: true,
    sort: "TRADE_DATE_DESC",
    exact_match: false,
    page_limit_preference: [60],
    starforce_min: range.min,
    starforce_max: range.max,
    price_min_meso: null,
    price_max_meso: null,
    potential_filter: null,
    page_sweep: FULL_RESULT_SWEEP,
    logical_lanes: [range.id],
    selection_channels: [range.id],
    post_classify_profiles: []
  }));
}

function buildGlobalAccessoryPotentialQueries(priorities) {
  if (!priorities.has("P1") && !priorities.has("P2")) return [];

  return GLOBAL_ACCESSORY_POTENTIAL_SEARCHES.map((target) => {
    const capability = POTENTIAL_FILTER_CAPABILITIES[target.capability_id];
    if (!capability?.server_queryable || !capability.auction_code) {
      throw new Error(`${target.capability_id}: auction filter is not queryable`);
    }
    const potentialFilter = {
      capability_id: target.capability_id,
      auction_code: capability.auction_code,
      minimum: target.minimum,
      evidence_status: capability.evidence_status,
      strict_semantics: capability.strict_semantics
    };
    return {
      query_id: `${CATALOG_VERSION}:global-accessory:${target.id}:${physicalQuerySignature({
        potential_filter: potentialFilter
      })}`,
      catalog_version: CATALOG_VERSION,
      catalog_id: null,
      catalog_ids: [],
      exact_name: null,
      search_keyword: "",
      display_name: target.label,
      search_scope: "catalog_global",
      progress_scope: "global",
      search_group_id: null,
      allowed_names: [],
      priority: "P1",
      group: "global_accessory_potential",
      slot: null,
      slots: [...ACCESSORY_DROP_MESO_SLOTS],
      level: null,
      levels: [],
      sold_only: true,
      sort: "TRADE_DATE_DESC",
      exact_match: false,
      page_limit_preference: [60],
      starforce_min: null,
      starforce_max: null,
      price_min_meso: null,
      price_max_meso: null,
      potential_filter: potentialFilter,
      page_sweep: FULL_RESULT_SWEEP,
      logical_lanes: [target.id],
      selection_channels: [target.id],
      post_classify_profiles: ["ACCESSORY_DROP_MESO"]
    };
  });
}

function buildGlobalCategoryPotentialQueries(priorities) {
  if (!priorities.has("P1") && !priorities.has("P2")) return [];

  return GLOBAL_CATEGORY_POTENTIAL_SEARCHES.map((target) => {
    const capability = POTENTIAL_FILTER_CAPABILITIES[target.capability_id];
    if (!capability?.server_queryable || !capability.auction_code) {
      throw new Error(`${target.capability_id}: auction filter is not queryable`);
    }
    const potentialFilter = {
      capability_id: target.capability_id,
      auction_code: capability.auction_code,
      minimum: target.minimum,
      maximum: target.maximum,
      evidence_status: capability.evidence_status,
      strict_semantics: capability.strict_semantics
    };
    const definition = {
      item_category_filter: target.item_category_filter,
      equipment_subcategory_filter: target.equipment_subcategory_filter,
      result_category_path_filter: target.result_category_path_filter,
      potential_filter: potentialFilter
    };
    return {
      query_id: `${CATALOG_VERSION}:global-category:${target.id}:${physicalQuerySignature(definition)}`,
      catalog_version: CATALOG_VERSION,
      catalog_id: null,
      catalog_ids: [],
      exact_name: null,
      search_keyword: "",
      display_name: target.label,
      search_scope: "catalog_global",
      progress_scope: "global",
      search_group_id: null,
      allowed_names: [],
      priority: "P1",
      group: "global_category_potential",
      slot: null,
      slots: [],
      level: null,
      levels: [],
      sold_only: true,
      sort: "TRADE_DATE_DESC",
      exact_match: false,
      page_limit_preference: [60],
      item_category_filter: target.item_category_filter,
      equipment_subcategory_filter: target.equipment_subcategory_filter,
      result_category_path_filter: target.result_category_path_filter,
      starforce_min: null,
      starforce_max: null,
      price_min_meso: null,
      price_max_meso: null,
      potential_filter: potentialFilter,
      page_sweep: FULL_RESULT_SWEEP,
      logical_lanes: [target.id],
      selection_channels: [target.id],
      post_classify_profiles: [target.post_classify_profile]
    };
  });
}

function stableTextToken(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function physicalQuerySignature(definition) {
  const min = definition.starforce_min == null ? "any" : definition.starforce_min;
  const max = definition.starforce_max == null ? "any" : definition.starforce_max;
  const priceMin = definition.price_min_meso == null ? "any" : definition.price_min_meso;
  const priceMax = definition.price_max_meso == null ? "any" : definition.price_max_meso;
  const price = definition.price_min_meso == null && definition.price_max_meso == null
    ? ""
    : `:price-${priceMin}-${priceMax}`;
  const potential = definition.potential_filter
    ? `${definition.potential_filter.auction_code}:${definition.potential_filter.minimum}${
      definition.potential_filter.maximum == null ? "" : `-${definition.potential_filter.maximum}`
    }`
    : "none";
  const category = definition.item_category_filter
    ? `:category-${definition.item_category_filter}`
    : "";
  const subcategory = definition.equipment_subcategory_filter
    ? `:subcategory-${definition.equipment_subcategory_filter}`
    : "";
  const resultCategory = definition.result_category_path_filter
    ? `:result-category-${definition.result_category_path_filter}`
    : "";
  return `sf-${min}-${max}${price}:pot-${potential}${category}${subcategory}${resultCategory}`;
}

function normalizePotentialLine(line) {
  const raw = String((line && line.raw) || "").trim();
  const rawWithoutSpaces = raw.replace(/\s+/gu, " ");
  const sourceCode = String((line && line.code) || "").trim();

  if (sourceCode === "MP" || /(?:최대\s*)?MP\b/iu.test(rawWithoutSpaces)) {
    return { ignored: true };
  }

  const aliases = {
    STR: "STR",
    DEX: "DEX",
    INT: "INT",
    LUK: "LUK",
    HP: "HP",
    ALL_STAT: "ALL_STAT",
    ATTACK: "ATTACK",
    MAGIC_ATTACK: "MAGIC_ATTACK",
    IGNORE_DEFENSE: "IGNORE_DEFENSE",
    CRITICAL_DAMAGE: "CRITICAL_DAMAGE",
    ITEM_DROP_RATE: "ITEM_DROP_RATE",
    MESO_OBTAINED: "MESO_OBTAINED",
    COOLDOWN_REDUCTION: "COOLDOWN_REDUCTION",
    strPercent: "STR",
    dexPercent: "DEX",
    intPercent: "INT",
    lukPercent: "LUK",
    allStatsPercent: "ALL_STAT",
    allStatPercent: "ALL_STAT",
    hpPercent: "HP",
    attackPercent: "ATTACK",
    physicalAttackPercent: "ATTACK",
    magicAttackPercent: "MAGIC_ATTACK"
  };

  let code = aliases[sourceCode] || null;
  if (!code && sourceCode && sourceCode !== "UNKNOWN") {
    // 구조화에는 성공했지만 현재의 퍼센트·쿨감 시장 프로필에는 포함하지 않는
    // 옵션이다. 파싱 실패(UNKNOWN)와 가치 프로필 비대상을 구분한다.
    return { ignored: true };
  }
  if (!code && rawWithoutSpaces) {
    const rawMatchers = [
      [/^STR\b/iu, "STR"],
      [/^DEX\b/iu, "DEX"],
      [/^INT\b/iu, "INT"],
      [/^LUK\b/iu, "LUK"],
      [/^(?:최대\s*)?HP\b/iu, "HP"],
      [/^올스탯(?:\s|$)/u, "ALL_STAT"],
      [/^공격력(?:\s|$)/u, "ATTACK"],
      [/^마력(?:\s|$)/u, "MAGIC_ATTACK"],
      [/^몬스터 방어율 무시(?:\s|$)/u, "IGNORE_DEFENSE"],
      [/^크리티컬 데미지(?:\s|$)/u, "CRITICAL_DAMAGE"],
      [/^아이템 드롭률(?:\s|$)/u, "ITEM_DROP_RATE"],
      [/^메소 획득량(?:\s|$)/u, "MESO_OBTAINED"],
      [/^(?:스킬\s+)?재사용 대기시간(?:\s|$)/u, "COOLDOWN_REDUCTION"]
    ];
    const matched = rawMatchers.find(([pattern]) => pattern.test(rawWithoutSpaces));
    code = matched ? matched[1] : null;
  }

  let unit = (line && line.unit) || null;
  if (!unit && /%/u.test(rawWithoutSpaces)) unit = "pct";
  if (!unit && /초/u.test(rawWithoutSpaces)) unit = "seconds";
  let value = line && line.value;
  if (value == null && rawWithoutSpaces) {
    const match = rawWithoutSpaces.match(/[+-]?\d+(?:\.\d+)?/u);
    value = match ? Number(match[0]) : null;
  }
  return { code, unit, value, ignored: false };
}

function classifyMitra(item, totals) {
  const attackCode = item.mitra_attack_code;
  const attackPct = totals.percent[attackCode] || 0;
  const ignoreDefenseLines = totals.percent_lines.IGNORE_DEFENSE;
  const ignoreDefenseMaxLinePct = ignoreDefenseLines.length > 0 ? Math.max(...ignoreDefenseLines) : 0;
  const thirtyAttack = attackPct >= 30;
  const twentyOneAndIgnoreDefense = attackPct >= 21 && ignoreDefenseMaxLinePct >= 30;
  const rejectedEighteenAndThirtyFive = attackPct === 18 && ignoreDefenseMaxLinePct >= 35;
  return {
    attack_code: attackCode,
    attack_pct: attackPct,
    ignore_defense_max_line_pct: ignoreDefenseMaxLinePct,
    matched: thirtyAttack || twentyOneAndIgnoreDefense,
    matched_rule: thirtyAttack
      ? `${attackCode}_30`
      : twentyOneAndIgnoreDefense ? `${attackCode}_21_AND_IGNORE_DEFENSE_30` : null,
    known_non_optimal_18_and_35: rejectedEighteenAndThirtyFive,
    boss_damage_is_not_a_mitra_line: true
  };
}

function thresholdGrade(value, thresholds) {
  if (value >= thresholds.three_line) return "three_line";
  if (value >= thresholds.two_line) return "two_line";
  return null;
}

function requireCatalogItem(itemOrIdOrName) {
  const item = getCatalogItem(itemOrIdOrName);
  if (!item) throw new RangeError(`Unknown catalog item: ${String(itemOrIdOrName)}`);
  return item;
}

function localOnlyCapability(note) {
  return {
    auction_code: null,
    evidence_status: "local_only",
    server_queryable: false,
    strict_semantics: false,
    note
  };
}

function assertCountMap(label, actual, expected) {
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      throw new Error(`${label}.${key} must be ${value}, got ${actual[key]}`);
    }
  }
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function pushUnique(array, value) {
  if (!array.includes(value)) array.push(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
