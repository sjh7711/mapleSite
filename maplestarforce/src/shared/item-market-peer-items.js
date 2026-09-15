import { normalizeMarketItemName } from "./item-market-data.js";

const STAT_FAMILIES = Object.freeze(["STR", "DEX", "INT", "LUK"]);
const ROLE_BY_STAT = Object.freeze({
  STR: "warrior",
  DEX: "archer",
  INT: "mage",
  LUK: "thief",
});
const STAT_BY_JOB = Object.freeze({
  전사: "STR",
  궁수: "DEX",
  마법사: "INT",
  도적: "LUK",
});
const EXTRA_ROLE_STAT_VARIANTS = Object.freeze([
  Object.freeze({ role: "pirate", job_label: "해적", family: "STR" }),
  Object.freeze({ role: "pirate", job_label: "해적", family: "DEX" }),
]);

function uniformSlots(prefix, roleTokens, slots, overrides = {}) {
  return Object.fromEntries(Object.entries(slots).map(([category, suffix]) => [
    category,
    Object.fromEntries(Object.entries(roleTokens).map(([role, token]) => [
      role,
      overrides[category]?.[role] || `${prefix}${token}${suffix}`,
    ])),
  ]));
}

const FIVE_JOB_TOKENS = Object.freeze({
  warrior: "나이트",
  archer: "아처",
  mage: "메이지",
  thief: "시프",
  pirate: "파이렛",
});

const PEER_DEFINITIONS = Object.freeze([
  Object.freeze({
    key: "absolab",
    slots: uniformSlots("앱솔랩스 ", FIVE_JOB_TOKENS, {
      장갑: "글러브",
      어깨장식: "숄더",
      신발: "슈즈",
      한벌옷: "슈트",
      망토: "케이프",
      모자: "",
    }, {
      모자: {
        warrior: "앱솔랩스 나이트헬름",
        archer: "앱솔랩스 아처후드",
        mage: "앱솔랩스 메이지크라운",
        thief: "앱솔랩스 시프캡",
        pirate: "앱솔랩스 파이렛페도라",
      },
    }),
  }),
  Object.freeze({
    key: "arcane",
    slots: uniformSlots("아케인셰이드 ", FIVE_JOB_TOKENS, {
      장갑: "글러브",
      어깨장식: "숄더",
      신발: "슈즈",
      한벌옷: "슈트",
      망토: "케이프",
      모자: "햇",
    }),
  }),
  Object.freeze({
    key: "eternal",
    slots: uniformSlots("에테르넬 ", FIVE_JOB_TOKENS, {
      장갑: "글러브",
      어깨장식: "숄더",
      신발: "슈즈",
      망토: "케이프",
      하의: "팬츠",
      모자: "",
      상의: "",
    }, {
      모자: {
        warrior: "에테르넬 나이트헬름",
        archer: "에테르넬 아처햇",
        mage: "에테르넬 메이지햇",
        thief: "에테르넬 시프반다나",
        pirate: "에테르넬 파이렛햇",
      },
      상의: {
        warrior: "에테르넬 나이트아머",
        archer: "에테르넬 아처후드",
        mage: "에테르넬 메이지로브",
        thief: "에테르넬 시프셔츠",
        pirate: "에테르넬 파이렛코트",
      },
    }),
  }),
  Object.freeze({
    key: "cra",
    slots: {
      모자: {
        warrior: "하이네스 워리어헬름",
        archer: "하이네스 레인져베레",
        mage: "하이네스 던위치햇",
        thief: "하이네스 어새신보닛",
        pirate: "하이네스 원더러햇",
      },
      상의: {
        warrior: "이글아이 워리어아머",
        archer: "이글아이 레인져후드",
        mage: "이글아이 던위치로브",
        thief: "이글아이 어새신셔츠",
        pirate: "이글아이 원더러코트",
      },
      하의: {
        warrior: "트릭스터 워리어팬츠",
        archer: "트릭스터 레인져팬츠",
        mage: "트릭스터 던위치팬츠",
        thief: "트릭스터 어새신팬츠",
        pirate: "트릭스터 원더러팬츠",
      },
    },
  }),
]);

function itemBody(value) {
  return value?.item && typeof value.item === "object" ? value.item : value || {};
}

function catalogByName(catalog) {
  return new Map((catalog?.items || []).map((entry) => [
    normalizeMarketItemName(entry?.name),
    entry,
  ]));
}

function catalogFamily(entry) {
  const catalogId = String(entry?.catalog_id || "").trim();
  const separator = catalogId.indexOf(":");
  return separator > 0 ? catalogId.slice(0, separator) : null;
}

/**
 * 직업별로 이름이 갈리는 장비는 같은 세트·부위의 STR/DEX/INT/LUK 대표 장비를
 * 반환한다. 공용 장비나 알려지지 않은 계열은 동일 아이템 비교를 유지한다.
 */
export function resolveItemMarketStatPeerGroup({ catalog, item } = {}) {
  const current = itemBody(item);
  const itemName = normalizeMarketItemName(current.name);
  const category = String(current.category || "").trim();
  const entries = catalogByName(catalog);
  if (!itemName || !category || !entries.size) {
    return {
      mode: "same_item",
      status: "unavailable",
      selected_item_family: STAT_BY_JOB[current.required_job] || null,
      peers: {},
      additional_peers: [],
    };
  }

  for (const definition of PEER_DEFINITIONS) {
    const names = definition.slots[category];
    if (!names || !Object.values(names).includes(itemName)) continue;
    const selectedEntry = entries.get(itemName);
    const currentCatalogFamily = catalogFamily(current);
    if (
      catalogFamily(selectedEntry) !== definition.key ||
      (currentCatalogFamily && currentCatalogFamily !== definition.key)
    ) break;
    const peers = Object.fromEntries(STAT_FAMILIES.flatMap((family) => {
      const role = ROLE_BY_STAT[family];
      const peerName = normalizeMarketItemName(names[role]);
      const entry = entries.get(peerName);
      return entry && catalogFamily(entry) === definition.key
        ? [[family, { family, item_name: peerName, entry }]]
        : [];
    }));
    const selectedItemFamily = STAT_FAMILIES.find((family) =>
      normalizeMarketItemName(names[ROLE_BY_STAT[family]]) === itemName
    ) || null;
    const additionalPeers = EXTRA_ROLE_STAT_VARIANTS.flatMap((variant) => {
      const peerName = normalizeMarketItemName(names[variant.role]);
      const entry = entries.get(peerName);
      if (!entry || catalogFamily(entry) !== definition.key) return [];
      return [{
        key: `${variant.role}:${variant.family}`,
        family: variant.family,
        role: variant.role,
        job_label: variant.job_label,
        item_name: peerName,
        entry,
      }];
    });
    // 일부 직업만 다른 장비로 비교하면 스탯 간 가격이 섞인 결과를
    // 완전한 peer 비교로 오인할 수 있다. 네 주스탯 대표 장비가 모두
    // catalog에 있을 때만 직업 전용 peer 모드를 켠다.
    if (Object.keys(peers).length !== STAT_FAMILIES.length) break;
    return {
      mode: "job_specific_peer_items",
      status: "ready",
      group_key: `${definition.key}:${category}`,
      selected_item_family: selectedItemFamily,
      selected_item_name: itemName,
      peers,
      additional_peers: additionalPeers,
    };
  }

  return {
    mode: "same_item",
    status: "ready",
    selected_item_family: STAT_BY_JOB[current.required_job] || null,
    selected_item_name: itemName,
    peers: {},
    additional_peers: [],
  };
}
