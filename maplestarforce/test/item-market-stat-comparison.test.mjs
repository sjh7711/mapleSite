import assert from "node:assert/strict";
import test from "node:test";

import {
  ITEM_MARKET_PEER_IDENTITY_FIELDS,
  ITEM_MARKET_STAT_FAMILIES,
  buildItemMarketStatFamilyCounterfactuals,
  compareItemMarketStatFamilies,
  findDominantItemMarketStatFamily,
  isJobSpecificItemMarketArmor,
  replaceItemMarketPeerIdentity,
  swapItemMarketStatFamilies,
} from "../src/shared/item-market-stat-comparison.js";

function target({ potential = [], additional = [], scroll = {}, flame = {} } = {}) {
  return {
    item: {
      name: "테스트 장비",
      stats: { base: {}, starforce: {}, scroll, flame, other: {}, total: {} },
      potential: { collected: true, grade: "legendary", lines: potential },
      additional_potential: { collected: true, grade: "legendary", lines: additional },
    },
  };
}

function jobArmorTarget({
  name = "앱솔랩스 나이트케이프",
  catalogId = "absolab:knight-cape",
  requiredJob = "전사",
  setName = "앱솔랩스 세트(전사)",
  potential = [{ code: "INT", value: 30, unit: "pct" }],
  additional = [{
    code: "STAT_PER_CHARACTER_LEVEL",
    value: null,
    unit: null,
    params: { levels_per_increment: 9, stat_code: "INT", stat_value: 2 },
  }],
  scroll = { int_flat: 33, attack_flat: 6 },
  flame = { int_flat: 72, all_stat_pct: 6 },
} = {}) {
  const value = target({ potential, additional, scroll, flame });
  Object.assign(value.item, {
    name,
    catalog_id: catalogId,
    category: "망토",
    category_path: ["방어구", "망토"],
    required_job: requiredJob,
    set_name: setName,
    base_level: 160,
    icon_asset_key: "SOURCEICON",
    starforce: { value: 22, applicable: true },
    upgrade: { applied: 7, remaining: 0, recoverable: 0 },
  });
  return value;
}

function armorPeer(family, overrides = {}) {
  const defaults = {
    STR: ["앱솔랩스 나이트케이프", "absolab:knight-cape", "전사", "SOURCEICON"],
    DEX: ["앱솔랩스 아처케이프", "absolab:archer-cape", "궁수", "DEXICON"],
    INT: ["앱솔랩스 메이지케이프", "absolab:mage-cape", "마법사", "INTICON"],
    LUK: ["앱솔랩스 시프케이프", "absolab:thief-cape", "도적", "LUKICON"],
  }[family];
  return {
    item: {
      name: defaults[0],
      catalog_id: defaults[1],
      category: "망토",
      category_path: ["방어구", "망토"],
      required_job: defaults[2],
      set_name: `앱솔랩스 세트(${defaults[2]})`,
      base_level: 160,
      icon_asset_key: defaults[3],
      // identity 교체가 아래 강화 상태를 가져오면 안 되는지 함께 검증한다.
      starforce: { value: 0 },
      stats: { scroll: { str_flat: 9999 }, flame: { str_flat: 9999 } },
      ...overrides,
    },
  };
}

function pirateArmorPeer(overrides = {}) {
  return armorPeer("STR", {
    name: "앱솔랩스 파이렛케이프",
    catalog_id: "absolab:pirate-cape",
    required_job: "해적",
    set_name: "앱솔랩스 세트(해적)",
    icon_asset_key: "PIRATEICON",
    ...overrides,
  });
}

test("서로 다른 단위를 직접 더하지 않고 입력 채널별 비중으로 지배 스탯을 찾는다", () => {
  const result = findDominantItemMarketStatFamily(target({
    potential: [
      { code: "STR", value: 12, unit: "pct" },
      { code: "DEX", value: 9, unit: "pct" },
      {
        code: "STAT_PER_CHARACTER_LEVEL",
        value: null,
        unit: null,
        params: { levels_per_increment: 9, stat_code: "STR", stat_value: 2 },
      },
    ],
    additional: [{ code: "STR", value: 6, unit: "pct" }],
    scroll: { str_flat: 30, dex_flat: 10, attack_flat: 6 },
    flame: { str_flat: 60, dex_flat: 20, all_stat_pct: 5 },
  }));

  assert.equal(result.status, "found");
  assert.equal(result.family, "STR");
  assert.deepEqual(result.active_families, ["STR", "DEX"]);
  assert.ok(result.scores.STR > result.scores.DEX);
  assert.equal(result.channels["potential:pct"].STR, 12);
  assert.equal(result.channels["potential:pct"].DEX, 9);
  assert.equal(result.channels["potential:per_level"].STR, 2 / 9);
  assert.equal(result.evidence.length, 8);
});

test("서로 다른 채널이 정확히 맞서거나 계열 입력이 없으면 임의로 고르지 않는다", () => {
  const ambiguous = findDominantItemMarketStatFamily(target({
    potential: [{ code: "STR", value: 12, unit: "pct" }],
    scroll: { dex_flat: 100 },
  }));
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.family, null);
  assert.deepEqual(ambiguous.tied_families, ["STR", "DEX"]);

  const absent = findDominantItemMarketStatFamily(target({
    potential: [{ code: "ALL_STAT", value: 9, unit: "pct" }],
    scroll: { attack_flat: 6 },
    flame: { all_stat_pct: 5 },
  }));
  assert.equal(absent.status, "none");
  assert.equal(absent.family, null);
  assert.deepEqual(absent.active_families, []);
});

test("잠재·에디·레벨당·주문서·추옵의 두 스탯 계열을 수치 손실 없이 맞바꾼다", () => {
  const original = target({
    potential: [
      { line_index: 1, code: "STR", value: 12, unit: "pct" },
      { line_index: 2, code: "DEX", value: 9, unit: "pct" },
      { line_index: 3, code: "INT", value: 6, unit: "pct" },
      { line_index: 4, code: "ALL_STAT", value: 9, unit: "pct" },
      {
        line_index: 5,
        code: "STAT_PER_CHARACTER_LEVEL",
        value: null,
        unit: null,
        params: { levels_per_increment: 9, stat_code: "STR", stat_value: 2 },
      },
      {
        line_index: 6,
        code: "STAT_PER_CHARACTER_LEVEL",
        value: null,
        unit: null,
        params: { levels_per_increment: 9, stat_code: "DEX", stat_value: 1 },
      },
    ],
    additional: [
      { code: "STR", value: 18, unit: "flat" },
      { code: "DEX", value: 14, unit: "flat" },
    ],
    scroll: { str_flat: 30, dex_flat: 10, luk_flat: 5, attack_flat: 6 },
    flame: { str_flat: 60, int_flat: 20, all_stat_pct: 5 },
  });
  const snapshot = structuredClone(original);
  const swapped = swapItemMarketStatFamilies(original, "STR", "DEX");

  assert.deepEqual(original, snapshot, "원본 target은 바뀌면 안 됩니다.");
  assert.notEqual(swapped, original);
  assert.deepEqual(
    swapped.item.potential.lines.map((line) =>
      line.code === "STAT_PER_CHARACTER_LEVEL" ? line.params.stat_code : line.code
    ),
    ["DEX", "STR", "INT", "ALL_STAT", "DEX", "STR"],
  );
  assert.deepEqual(
    swapped.item.additional_potential.lines.map((line) => line.code),
    ["DEX", "STR"],
  );
  assert.deepEqual(swapped.item.stats.scroll, {
    str_flat: 10,
    dex_flat: 30,
    luk_flat: 5,
    attack_flat: 6,
  });
  assert.deepEqual(swapped.item.stats.flame, {
    dex_flat: 60,
    int_flat: 20,
    all_stat_pct: 5,
  });
});

test("순수 counterfactual builder는 현재 계열을 포함한 네 개의 독립 target을 반환한다", () => {
  const original = target({
    potential: [{ code: "LUK", value: 30, unit: "pct" }],
    flame: { luk_flat: 70 },
  });
  const result = buildItemMarketStatFamilyCounterfactuals(original);

  assert.equal(result.status, "ready");
  assert.equal(result.current_family, "LUK");
  assert.deepEqual(Object.keys(result.targets), ITEM_MARKET_STAT_FAMILIES);
  assert.notEqual(result.targets.LUK, original);
  assert.equal(result.targets.LUK.item.potential.lines[0].code, "LUK");
  assert.equal(result.targets.STR.item.potential.lines[0].code, "STR");
  assert.deepEqual(result.targets.STR.item.stats.flame, { str_flat: 70 });
});

test("같은 estimator를 네 target에 재사용하고 현재가 대비 차이와 표시 방향을 반환한다", () => {
  const original = target({
    potential: [{ code: "STR", value: 30, unit: "pct" }],
    scroll: { str_flat: 80 },
  });
  const snapshot = structuredClone(original);
  const prices = {
    STR: 100_000_000,
    DEX: 80_000_000,
    INT: 130_000_000,
    LUK: 100_000_000,
  };
  const calls = [];
  const result = compareItemMarketStatFamilies({
    target: original,
    estimator(candidate, context) {
      calls.push(context);
      // 콜백이 받은 값을 바꿔도 원본과 반환 counterfactual은 보존되어야 한다.
      candidate.item.name = "콜백 내부 변경";
      return { status: "estimated", estimate_meso: prices[context.family] };
    },
  });

  assert.deepEqual(original, snapshot);
  assert.equal(result.status, "compared");
  assert.equal(result.current_family, "STR");
  assert.equal(result.current.estimate_meso, 100_000_000);
  assert.equal(result.targets.DEX.item.name, "테스트 장비");
  assert.deepEqual(calls.map((entry) => entry.family), ITEM_MARKET_STAT_FAMILIES);

  const dex = result.comparisons.find((entry) => entry.family === "DEX");
  assert.equal(dex.estimate_meso, 80_000_000);
  assert.equal(dex.delta_meso, -20_000_000);
  assert.equal(dex.delta_percent, -20);
  assert.equal(dex.relation, "cheaper");
  assert.equal(dex.relation_label, "현재보다 저렴");

  const int = result.comparisons.find((entry) => entry.family === "INT");
  assert.equal(int.delta_meso, 30_000_000);
  assert.equal(int.delta_percent, 30);
  assert.equal(int.relation, "more_expensive");
  assert.equal(int.relation_label, "현재보다 비쌈");

  const luk = result.comparisons.find((entry) => entry.family === "LUK");
  assert.equal(luk.delta_meso, 0);
  assert.equal(luk.relation, "same");
  assert.equal(luk.relation_label, "현재와 같음");
});

test("일부 추정이 실패하면 나머지 결과를 유지하고 비교 불가로 표시한다", () => {
  const result = compareItemMarketStatFamilies({
    target: target({ potential: [{ code: "INT", value: 30, unit: "pct" }] }),
    estimator(_candidate, { family }) {
      if (family === "DEX") throw new Error("DEX 자료 없음");
      if (family === "LUK") return { status: "insufficient_data" };
      return 200_000_000;
    },
  });

  assert.equal(result.status, "partial");
  assert.equal(result.current.estimate_meso, 200_000_000);
  const dex = result.comparisons.find((entry) => entry.family === "DEX");
  assert.equal(dex.status, "unavailable");
  assert.equal(dex.error, "DEX 자료 없음");
  assert.equal(dex.relation, "unavailable");
  assert.equal(dex.relation_label, "비교 불가");
  const luk = result.comparisons.find((entry) => entry.family === "LUK");
  assert.equal(luk.error, "estimator_status:insufficient_data");
});

test("peer identity 교체는 허용된 식별 필드만 복사하고 양쪽 원본을 보존한다", () => {
  const original = jobArmorTarget();
  const peer = armorPeer("INT");
  const originalSnapshot = structuredClone(original);
  const peerSnapshot = structuredClone(peer);
  const replaced = replaceItemMarketPeerIdentity(original, peer);

  assert.ok(ITEM_MARKET_PEER_IDENTITY_FIELDS.includes("name"));
  assert.ok(ITEM_MARKET_PEER_IDENTITY_FIELDS.includes("icon_asset_key"));
  assert.deepEqual(original, originalSnapshot);
  assert.deepEqual(peer, peerSnapshot);
  assert.equal(replaced.item.name, "앱솔랩스 메이지케이프");
  assert.equal(replaced.item.catalog_id, "absolab:mage-cape");
  assert.equal(replaced.item.required_job, "마법사");
  assert.equal(replaced.item.set_name, "앱솔랩스 세트(마법사)");
  assert.equal(replaced.item.icon_asset_key, "INTICON");
  assert.deepEqual(replaced.item.starforce, { value: 22, applicable: true });
  assert.deepEqual(replaced.item.stats.scroll, { int_flat: 33, attack_flat: 6 });
});

test("직업 전용 방어구의 오프스탯은 선택 장비 계열과 분리해 네 peer 정옵 후보를 만든다", () => {
  const original = jobArmorTarget();
  const peers = Object.fromEntries(ITEM_MARKET_STAT_FAMILIES.map((family) => [
    family,
    armorPeer(family),
  ]));
  const snapshot = structuredClone(original);
  const result = buildItemMarketStatFamilyCounterfactuals(original, {
    peerItemsByFamily: peers,
  });

  assert.deepEqual(original, snapshot);
  assert.equal(isJobSpecificItemMarketArmor(original), true);
  assert.equal(result.status, "ready");
  assert.equal(result.comparison_mode, "job_peer_items");
  assert.equal(result.input_stat_family, "INT");
  assert.equal(result.selected_item_family, "STR");
  assert.equal(result.current_metadata.is_on_stat, false);
  assert.equal(result.current_target.item.name, "앱솔랩스 나이트케이프");
  assert.equal(result.current_target.item.potential.lines[0].code, "INT");

  assert.equal(result.targets.STR.item.name, "앱솔랩스 나이트케이프");
  assert.equal(result.targets.STR.item.potential.lines[0].code, "STR");
  assert.equal(result.targets.STR.item.additional_potential.lines[0].params.stat_code, "STR");
  assert.deepEqual(result.targets.STR.item.stats.scroll, { str_flat: 33, attack_flat: 6 });
  assert.deepEqual(result.targets.STR.item.stats.flame, { str_flat: 72, all_stat_pct: 6 });

  assert.equal(result.targets.INT.item.name, "앱솔랩스 메이지케이프");
  assert.equal(result.targets.INT.item.required_job, "마법사");
  assert.equal(result.targets.INT.item.potential.lines[0].code, "INT");
  assert.equal(result.targets.INT.item.icon_asset_key, "INTICON");
  assert.equal(result.targets.INT.item.starforce.value, 22);
  assert.deepEqual(result.targets.INT.item.stats.scroll, { int_flat: 33, attack_flat: 6 });

  assert.equal(result.targets.DEX.item.name, "앱솔랩스 아처케이프");
  assert.equal(result.targets.DEX.item.potential.lines[0].code, "DEX");
  assert.equal(result.targets.LUK.item.name, "앱솔랩스 시프케이프");
  assert.equal(result.targets.LUK.item.potential.lines[0].code, "LUK");
  assert.equal(result.target_metadata.STR.matches_current, false);
  assert.equal(result.target_metadata.INT.matches_current, false);
  assert.deepEqual(result.missing_families, []);
});

test("직업 전용 방어구의 정옵 후보만 현재와 같은 조합으로 표시해 중복 비교에서 제외한다", () => {
  const original = jobArmorTarget({
    potential: [{ code: "STR", value: 30, unit: "pct" }],
    additional: [],
    scroll: { str_flat: 33 },
    flame: { str_flat: 72 },
  });
  const peers = Object.fromEntries(ITEM_MARKET_STAT_FAMILIES.map((family) => [
    family,
    armorPeer(family),
  ]));
  const calls = [];
  const result = compareItemMarketStatFamilies({
    target: original,
    peerItemsByFamily: peers,
    estimator(candidate, context) {
      calls.push({ name: candidate.item.name, ...context });
      return 100 + calls.length;
    },
  });

  assert.equal(result.status, "compared");
  assert.equal(result.current.metadata.is_on_stat, true);
  assert.equal(result.target_metadata.STR.matches_current, true);
  assert.deepEqual(result.comparisons.map((entry) => entry.family), ["DEX", "INT", "LUK"]);
  assert.equal(calls.length, 4, "현재 조합과 STR peer target은 같은 예측을 재사용합니다.");
  assert.equal(calls[0].is_current, true);
  assert.deepEqual(calls.slice(1).map((entry) => entry.name), [
    "앱솔랩스 아처케이프",
    "앱솔랩스 메이지케이프",
    "앱솔랩스 시프케이프",
  ]);
});

test("직업 전용 방어구 비교에 해적 STR과 DEX를 별도 후보로 포함한다", () => {
  const original = jobArmorTarget({
    potential: [{ code: "STR", value: 30, unit: "pct" }],
    additional: [],
    scroll: { str_flat: 33 },
    flame: { str_flat: 72 },
  });
  const peers = Object.fromEntries(ITEM_MARKET_STAT_FAMILIES.map((family) => [
    family,
    armorPeer(family),
  ]));
  const pirate = pirateArmorPeer();
  const calls = [];
  const result = compareItemMarketStatFamilies({
    target: original,
    peerItemsByFamily: peers,
    additionalPeerVariants: [
      {
        key: "pirate:STR",
        family: "STR",
        role: "pirate",
        job_label: "해적",
        peerTarget: pirate,
      },
      {
        key: "pirate:DEX",
        family: "DEX",
        role: "pirate",
        job_label: "해적",
        peerTarget: pirate,
      },
    ],
    estimator(candidate, context) {
      calls.push({ context, candidate });
      return 100_000_000 + calls.length;
    },
  });

  const pirateRows = result.comparisons.filter((entry) =>
    entry.metadata?.role === "pirate"
  );
  assert.equal(result.status, "compared");
  assert.deepEqual(pirateRows.map((entry) => entry.comparison_key), [
    "pirate:STR",
    "pirate:DEX",
  ]);
  assert.deepEqual(pirateRows.map((entry) => entry.family), ["STR", "DEX"]);
  assert.ok(pirateRows.every((entry) => entry.metadata.job_label === "해적"));
  assert.ok(pirateRows.every((entry) =>
    entry.target.item.name === "앱솔랩스 파이렛케이프"
  ));
  assert.equal(pirateRows[0].target.item.potential.lines[0].code, "STR");
  assert.equal(pirateRows[1].target.item.potential.lines[0].code, "DEX");
  assert.deepEqual(
    calls.filter(({ context }) => context.comparison_kind === "additional_peer_counterfactual")
      .map(({ context }) => context.peer_key),
    ["pirate:STR", "pirate:DEX"],
  );
});

test("해적 장비에서는 현재 스탯 후보만 제외하고 다른 해적 스탯을 비교한다", () => {
  const pirate = jobArmorTarget({
    name: "앱솔랩스 파이렛케이프",
    catalogId: "absolab:pirate-cape",
    requiredJob: "해적",
    setName: "앱솔랩스 세트(해적)",
    potential: [{ code: "STR", value: 30, unit: "pct" }],
    additional: [],
    scroll: { str_flat: 33 },
    flame: { str_flat: 72 },
  });
  const peers = Object.fromEntries(ITEM_MARKET_STAT_FAMILIES.map((family) => [
    family,
    armorPeer(family),
  ]));
  const result = compareItemMarketStatFamilies({
    target: pirate,
    peerItemsByFamily: peers,
    additionalPeerVariants: [
      { key: "pirate:STR", family: "STR", role: "pirate", peerTarget: pirate },
      { key: "pirate:DEX", family: "DEX", role: "pirate", peerTarget: pirate },
    ],
    estimator() {
      return 100_000_000;
    },
  });

  const pirateRows = result.comparisons.filter((entry) =>
    entry.metadata?.role === "pirate"
  );
  assert.deepEqual(pirateRows.map((entry) => entry.comparison_key), ["pirate:DEX"]);
  assert.equal(pirateRows[0].target.item.potential.lines[0].code, "DEX");
});

test("직업 전용 방어구의 오프스탯 비교에는 현재값 외에 네 직업 정옵 후보가 모두 포함된다", () => {
  const peers = Object.fromEntries(ITEM_MARKET_STAT_FAMILIES.map((family) => [
    family,
    armorPeer(family),
  ]));
  const calls = [];
  const result = compareItemMarketStatFamilies({
    target: jobArmorTarget(),
    peerItemsByFamily: peers,
    estimator(candidate, context) {
      calls.push({ name: candidate.item.name, ...context });
      return context.is_current ? 90 : { status: "estimated", estimate_meso: 100 };
    },
  });

  assert.equal(result.status, "compared");
  assert.deepEqual(result.comparisons.map((entry) => entry.family), ITEM_MARKET_STAT_FAMILIES);
  assert.equal(calls.length, 5);
  const mageInt = result.comparisons.find((entry) => entry.family === "INT");
  assert.equal(mageInt.target.item.name, "앱솔랩스 메이지케이프");
  assert.equal(mageInt.metadata.identity_family, "INT");
  assert.equal(mageInt.metadata.stat_family, "INT");
  const knightStr = result.comparisons.find((entry) => entry.family === "STR");
  assert.equal(knightStr.target.item.name, "앱솔랩스 나이트케이프");
  assert.equal(knightStr.target.item.potential.lines[0].code, "STR");
});

test("공용 장신구는 peer가 주입돼도 동일 item의 스탯 swap만 사용한다", () => {
  const accessory = target({
    potential: [{ code: "LUK", value: 30, unit: "pct" }],
    scroll: { luk_flat: 20 },
  });
  Object.assign(accessory.item, {
    name: "거대한 공포",
    catalog_id: "accessory:giant-fear",
    category: "반지",
    category_path: ["장신구", "반지"],
    required_job: "공용",
    set_name: "칠흑의 보스 세트",
  });
  const result = buildItemMarketStatFamilyCounterfactuals(accessory, {
    peerItemsByFamily: {
      STR: armorPeer("STR"),
      DEX: armorPeer("DEX"),
      INT: armorPeer("INT"),
      LUK: armorPeer("LUK"),
    },
  });

  assert.equal(isJobSpecificItemMarketArmor(accessory), false);
  assert.equal(result.comparison_mode, "same_item_stat_swap");
  assert.equal(result.selected_item_family, null);
  for (const family of ITEM_MARKET_STAT_FAMILIES) {
    assert.equal(result.targets[family].item.name, "거대한 공포");
    assert.equal(result.targets[family].item.catalog_id, "accessory:giant-fear");
  }
  assert.equal(result.targets.STR.item.potential.lines[0].code, "STR");
});

test("동세트·동부위가 아닌 peer는 조용히 섞지 않고 누락 사유를 반환한다", () => {
  const result = buildItemMarketStatFamilyCounterfactuals(jobArmorTarget(), {
    peerItemsByFamily: {
      DEX: armorPeer("DEX", { category: "장갑", category_path: ["방어구", "장갑"] }),
      INT: armorPeer("INT", { set_name: "에테르넬 세트(마법사)" }),
      LUK: armorPeer("LUK"),
    },
  });

  assert.equal(result.status, "partial_peer_items");
  assert.deepEqual(result.missing_families, ["DEX", "INT"]);
  assert.equal(result.peer_resolution.DEX.code, "slot_mismatch");
  assert.equal(result.peer_resolution.INT.code, "set_mismatch");
  assert.equal(result.peer_resolution.STR.status, "resolved");
  assert.equal(result.peer_resolution.LUK.status, "resolved");
});
