// Wire schema for v2/v3 links. These positions are independent of UI defaults.
// Never reorder/change these tables: publish a new wire version instead.
// Unknown fields are retained in a final map, so nothing is silently discarded.
// v3 stores Nexon item icon suffixes; a one-element array preserves any other value.
const ITEM_ICON_PREFIX = "https://open.api.nexon.com/static/maplestory/item/icon/";
const ITEM_ICON_CODE = /^[A-Za-z0-9_-]+$/;
const fields = (text) => Object.freeze(text.split(/\s+/).filter(Boolean));
const SCHEMAS = Object.freeze({
  // wheel·pricesLocked 필드는 기존 공유 링크의 위치를 보존하기 위한 예약 자리다.
  starforce: fields(`event mvp pc multiplier customMultipliers priceOverrides wheelEnabled wheelDefaultRevision pricesLocked foldedOpen bulk`),
  bulk: fields(`startStar targetStar`),
  items: fields(`slots slot`),
  item: fields(`presetId itemLevel startStar targetStar displayName displayIcon quantity spare replacementEok optimize destroyPrevention restore`),
  potential: fields(`part itemLevel grade resetMethod primeTargetSets mainStat subStat attackType characterLevel enemyDefense calculationMode rankProgressByGrade rankTargetGrade miracle showEquivalence presetIncludeIgnoreDefense presetIncludePpyogong presetIncludeNearOptimal presetIncludeDropMeso statEquivalentSortDirection successConditionsOpen targetChancePercent targetChanceDefaultRevision emptyTargetsRevision targetSets primeTargetMode`),
  combined: fields(`part itemLevel regularGrade additionalGrade mainStat subStat attackType characterLevel enemyDefense showEquivalence targets targetChancePercent`),
  equipment: fields(`part itemLevel`),
  targetSet: fields(`targets`),
  target: fields(`type value`),
  gradeProgress: fields(`rare epic unique`),
  ability: fields(`method useAdvanced allowMiracle allowBlackChaos allowAbyss miracleCount blackCount chaosCount abyssCount honorPriceMan abyssPriceEok swapLower halfHonor targetChancePercent targetChanceAverage routeChancePercent routeChanceAverage routeChanceDefaultVersion job presetMode targets`),
  abilityTarget: fields(`type minimum grade locked`),
  addOption: fields(`weapon itemLevel boss mainStat subStat attackType target tier damagePercent flatMainStatToDamagePercent flatSubStatToDamagePercent flatAttackToDamagePercent allStatPercentToDamagePercent xenonStrToDamagePercent xenonDexToDamagePercent xenonLukToDamagePercent xenonAttackToDamagePercent xenonAllStatToDamagePercent demonAvengerHp35ToDamagePercent demonAvengerStrToDamagePercent demonAvengerAttackToDamagePercent demonAvengerAllStatToDamagePercent abyssPrice strongPrice`),
  scroll: fields(`settingsVersion method traceRate preferredRate slot itemLevel halfPrice remaining recoverable workCount magicalCompletedCount returnAppliedWorks returnCurrentAttack returnCurrentStat fever guild guildProtection dexterityLevel chaosFirst chaosFirstAttack chaosFirstStat returnFirst returnFirstAttack returnFirstStat returnFirstStarforced magicalFirstStarforced attackTarget statTarget stats returnPrice magicalPrice tracePer1000 earringPrice chaos60Price chaos100Price chaos100Stock clean10Price clean5Price innocent50Price useInnocent useCleanScrolls preserveStarforce cleanStock innocentStock arkInnocentStock maplePointsPerEok returnResultUnit`),
  stats: fields(`STR DEX INT LUK`),
  pet: fields(`targetCount wonderBlackEvent wonderBlackEventIncreasePercent wonderBerryCashPurchaseAllowed outputTradeability wonderBerryBundleMaplePoints wonderBerryAuctionBundleEokPrice lunaCrystalMaplePoints wonderBlackEokPrice lunaSweetEokPrice mesoMarketMaplePointsPerEok cashWonPerEok lunaDreamEokPrice lunaKeyEokPrice auctionFeeRate resultUnit resultMode targetChancePercent`),
  soul: fields(`mode currentStage targetStage failures etherPrices grade toGrade resetCount miracle potentialStage chance chanceAverage targets`),
  profile: fields(`character profiles mode presetSelection presetRequest dataFreshness`),
  character: fields(`name className level world`),
  profiles: fields(`fullBoss`),
  fullBoss: fields(`mainStat subStat subStats attackType statModel capabilities statEquivalence addOptionEquivalence details`),
  view: fields(`routeId system`),
});
const NESTED = Object.freeze({
  "starforce.bulk": "bulk",
  "items.slots": "item[][]",
  "potential.targetSets": "targetSet[]",
  "potential.primeTargetSets": "targetSet[]",
  "potential.rankProgressByGrade": "gradeProgress",
  "targetSet.targets": "target[]",
  "combined.targets": "target[]",
  "ability.targets": "abilityTarget[]",
  "scroll.stats": "stats",
  "soul.targets": "target[]",
  "profile.character": "character",
  "profile.profiles": "profiles",
  "profiles.fullBoss": "fullBoss",
});
const TOOLS = fields(`starforce potential ability add-option scroll pet soul`);
const STORES = Object.freeze([
  ["local", "maplestarforce:v5", "starforce"],
  ["local", "maplestarforce:potential:v6", "potential"],
  ["local", "maplestarforce:additional:v6", "potential"],
  ["local", "maplestarforce:combined-potential:v1", "combined"],
  ["local", "maplestarforce:potential-equipment:v1", "equipment"],
  ["local", "maplestarforce:character-profile:v2", "profile"],
  ["local", "maplestarforce:ability:v2", "ability"],
  ["local", "maplestarforce:add-option:v2", "addOption"],
  ["local", "maplestarforce:scroll:v2", "scroll"],
  ["local", "maplestarforce:pet:v3", "pet"],
  ["local", "maplestarforce:soul:v1", "soul"],
  ["session", "maplestarforce:items:v1", "items"],
].map(Object.freeze));
const record = (value) => value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
const invalid = () => { throw new Error("공유 설정이 손상되었습니다."); };

function transformIcon(value, unpack) {
  if (unpack) {
    if (typeof value === "string" && ITEM_ICON_CODE.test(value)) return ITEM_ICON_PREFIX + value;
    if (Array.isArray(value) && value.length === 1) return value[0];
    invalid();
  }
  if (typeof value === "string" && value.startsWith(ITEM_ICON_PREFIX)) {
    const code = value.slice(ITEM_ICON_PREFIX.length);
    if (ITEM_ICON_CODE.test(code)) return code;
  }
  return [value];
}

function transformField(schema, name, value, unpack, compactIcons) {
  if (compactIcons && schema === "item" && name === "displayIcon") return transformIcon(value, unpack);
  const shape = NESTED[`${schema}.${name}`];
  return shape ? transform(shape, value, unpack, compactIcons) : value;
}

function transform(shape, value, unpack, compactIcons) {
  if (value === null) return null;
  if (shape.endsWith("[]")) {
    if (!Array.isArray(value)) invalid();
    return value.map((entry) => transform(shape.slice(0, -2), entry, unpack, compactIcons));
  }
  return unpack ? unpackRecord(shape, value, compactIcons) : packRecord(shape, value, compactIcons);
}

function packRecord(schema, value, compactIcons) {
  if (!record(value)) invalid();
  const names = SCHEMAS[schema];
  const mask = new Uint8Array(Math.ceil(names.length / 8));
  const packed = [mask];
  names.forEach((name, index) => {
    if (!Object.hasOwn(value, name)) return;
    mask[index >> 3] |= 1 << (index % 8);
    packed.push(transformField(schema, name, value[name], false, compactIcons));
  });
  const extra = Object.fromEntries(Object.entries(value).filter(([key]) => !names.includes(key)));
  if (Object.keys(extra).length) packed.push(extra);
  return packed;
}

function unpackRecord(schema, packed, compactIcons) {
  if (!Array.isArray(packed)) invalid();
  const names = SCHEMAS[schema];
  const mask = packed[0];
  if (!(mask instanceof Uint8Array) || mask.length !== Math.ceil(names.length / 8)) invalid();
  if (names.length % 8 && mask.at(-1) >> (names.length % 8)) invalid();
  const value = {};
  let position = 1;
  names.forEach((name, index) => {
    if (!(mask[index >> 3] & (1 << (index % 8)))) return;
    if (position >= packed.length) invalid();
    const entry = packed[position++];
    value[name] = transformField(schema, name, entry, true, compactIcons);
  });
  if (position < packed.length) {
    if (packed.length !== position + 1 || !record(packed[position])) invalid();
    for (const [key, entry] of Object.entries(packed[position])) {
      if (names.includes(key) || ["__proto__", "constructor", "prototype"].includes(key)) invalid();
      value[key] = entry;
    }
  }
  return value;
}

export function packShareSnapshot(snapshot, { compactIcons = false } = {}) {
  const tool = TOOLS.indexOf(snapshot.tool);
  if (tool < 0) invalid();
  const entries = [];
  STORES.forEach(([storage, key, schema], id) => {
    if (Object.hasOwn(snapshot[storage], key)) entries.push([id, packRecord(schema, snapshot[storage][key], compactIcons)]);
  });
  const packed = [tool, entries];
  if (snapshot.view !== undefined) packed.push(packRecord("view", snapshot.view, compactIcons));
  return packed;
}

export function unpackShareSnapshot(packed, { compactIcons = false } = {}) {
  if (!Array.isArray(packed) || ![2, 3].includes(packed.length)) invalid();
  const [tool, entries] = packed;
  if (!Number.isInteger(tool) || !TOOLS[tool] || !Array.isArray(entries) || entries.length > STORES.length) invalid();
  const snapshot = { version: 1, tool: TOOLS[tool], local: {}, session: {} };
  const seen = new Set();
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) invalid();
    const [id, value] = entry;
    if (!Number.isInteger(id) || !STORES[id] || seen.has(id)) invalid();
    seen.add(id);
    const [storage, key, schema] = STORES[id];
    snapshot[storage][key] = unpackRecord(schema, value, compactIcons);
  }
  if (packed.length === 3) snapshot.view = unpackRecord("view", packed[2], compactIcons);
  return snapshot;
}
