import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { resolveItemMarketStatPeerGroup } from "../src/shared/item-market-peer-items.js";

function catalog(names, family) {
  return {
    items: names.map((name) => ({
      name,
      catalog_id: `${family}:${name}`,
      file: `${name}.json`,
      sha256: "a".repeat(64),
    })),
  };
}

function item(name, category, requiredJob, family) {
  return {
    name,
    catalog_id: `${family}:${name}`,
    category,
    required_job: requiredJob,
  };
}

const FAMILY_EXPECTATIONS = Object.freeze({
  absolab: {
    itemCount: 30,
    groupCount: 6,
    baseLevel: 160,
    setFamily: "앱솔랩스 세트",
    categories: ["장갑", "어깨장식", "신발", "한벌옷", "망토", "모자"],
  },
  arcane: {
    itemCount: 30,
    groupCount: 6,
    baseLevel: 200,
    setFamily: "아케인셰이드 세트",
    categories: ["장갑", "어깨장식", "신발", "한벌옷", "망토", "모자"],
  },
  eternal: {
    itemCount: 35,
    groupCount: 7,
    baseLevel: 250,
    setFamily: "에테르넬 세트",
    categories: ["장갑", "어깨장식", "신발", "상의", "망토", "하의", "모자"],
  },
  cra: {
    itemCount: 15,
    groupCount: 3,
    baseLevel: 150,
    setFamily: "루타비스 세트",
    categories: ["상의", "하의", "모자"],
  },
});
const STAT_JOB = Object.freeze({ STR: "전사", DEX: "궁수", INT: "마법사", LUK: "도적" });
const JOB_STAT = Object.freeze({ 전사: "STR", 궁수: "DEX", 마법사: "INT", 도적: "LUK" });
const EXPECTED_JOBS = ["전사", "궁수", "마법사", "도적", "해적"];

function setFamily(value) {
  return String(value || "").replace(/\s*\(\s*(?:전사|궁수|마법사|도적|해적)\s*\)\s*$/u, "");
}

function loadCurrentPublicRelease() {
  const manifestPath = fileURLToPath(new URL("../public/item-market/manifest.json", import.meta.url));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const catalogPath = path.resolve(path.dirname(manifestPath), manifest.catalog.file);
  const publicCatalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  return { manifest, catalogPath, publicCatalog };
}

function readConsistentShardItem(catalogPath, entry) {
  const shardPath = path.resolve(path.dirname(catalogPath), entry.file);
  const shard = JSON.parse(readFileSync(shardPath, "utf8"));
  assert.equal(shard.item_name, entry.name, `${entry.name}: shard 장비명`);
  assert.ok(Array.isArray(shard.records) && shard.records.length > 0, `${entry.name}: 매물 표본`);
  const items = shard.records.map((record) => record.item).filter(Boolean);
  assert.equal(items.length, shard.records.length, `${entry.name}: item 메타 누락`);
  for (const key of ["name", "catalog_id", "category", "category_path", "required_job", "set_name", "base_level"]) {
    const distinct = new Set(items.map((candidate) => JSON.stringify(candidate[key])));
    assert.equal(distinct.size, 1, `${entry.name}: ${key} 메타가 shard 내부에서 다름`);
  }
  return items[0];
}

const ABSOLAB_CAPES = [
  "앱솔랩스 나이트케이프",
  "앱솔랩스 아처케이프",
  "앱솔랩스 메이지케이프",
  "앱솔랩스 시프케이프",
  "앱솔랩스 파이렛케이프",
];

test("앱솔랩스 직업 전용 망토는 네 주스탯 장비와 해적 STR·DEX 후보를 찾는다", () => {
  const result = resolveItemMarketStatPeerGroup({
    catalog: catalog(ABSOLAB_CAPES, "absolab"),
    item: item("앱솔랩스 나이트케이프", "망토", "전사", "absolab"),
  });

  assert.equal(result.mode, "job_specific_peer_items");
  assert.equal(result.group_key, "absolab:망토");
  assert.equal(result.selected_item_family, "STR");
  assert.equal(result.peers.STR.item_name, "앱솔랩스 나이트케이프");
  assert.equal(result.peers.DEX.item_name, "앱솔랩스 아처케이프");
  assert.equal(result.peers.INT.item_name, "앱솔랩스 메이지케이프");
  assert.equal(result.peers.LUK.item_name, "앱솔랩스 시프케이프");
  assert.deepEqual(
    result.additional_peers.map(({ key, family, job_label, item_name }) => ({
      key,
      family,
      job_label,
      item_name,
    })),
    [
      {
        key: "pirate:STR",
        family: "STR",
        job_label: "해적",
        item_name: "앱솔랩스 파이렛케이프",
      },
      {
        key: "pirate:DEX",
        family: "DEX",
        job_label: "해적",
        item_name: "앱솔랩스 파이렛케이프",
      },
    ],
  );
});

test("직업별 이름이 모두 다른 에테르넬 상의와 루타비스 모자도 같은 부위로 묶는다", () => {
  const eternal = resolveItemMarketStatPeerGroup({
    catalog: catalog([
      "에테르넬 나이트아머",
      "에테르넬 아처후드",
      "에테르넬 메이지로브",
      "에테르넬 시프셔츠",
      "에테르넬 파이렛코트",
    ], "eternal"),
    item: item("에테르넬 메이지로브", "상의", "마법사", "eternal"),
  });
  assert.equal(eternal.selected_item_family, "INT");
  assert.equal(eternal.peers.DEX.item_name, "에테르넬 아처후드");

  const cra = resolveItemMarketStatPeerGroup({
    catalog: catalog([
      "하이네스 워리어헬름",
      "하이네스 레인져베레",
      "하이네스 던위치햇",
      "하이네스 어새신보닛",
    ], "cra"),
    item: item("하이네스 던위치햇", "모자", "마법사", "cra"),
  });
  assert.equal(cra.group_key, "cra:모자");
  assert.equal(cra.peers.STR.item_name, "하이네스 워리어헬름");
});

test("미트라와 마이스터 심볼은 방어구 peer 비교에 포함하지 않는다", () => {
  const mitra = resolveItemMarketStatPeerGroup({
    catalog: catalog([
      "미트라의 분노 : 전사",
      "미트라의 분노 : 궁수",
      "미트라의 분노 : 마법사",
      "미트라의 분노 : 도적",
      "미트라의 분노 : 해적",
    ], "mitra"),
    item: item("미트라의 분노 : 궁수", "엠블렘", "궁수", "mitra"),
  });
  assert.equal(mitra.mode, "same_item");
  assert.deepEqual(mitra.peers, {});

  const symbol = resolveItemMarketStatPeerGroup({
    catalog: catalog(["레드 워리어 마이스터 심볼"], "observed-accessory"),
    item: item("레드 워리어 마이스터 심볼", "얼굴장식", "전사", "observed-accessory"),
  });
  assert.equal(symbol.mode, "same_item");
  assert.deepEqual(symbol.peers, {});
});

test("공용 장신구와 peer 표본이 부족한 장비는 동일 아이템 비교를 유지한다", () => {
  const common = resolveItemMarketStatPeerGroup({
    catalog: catalog(["거대한 공포"], "black"),
    item: { name: "거대한 공포", category: "반지", required_job: "공용" },
  });
  assert.equal(common.mode, "same_item");
  assert.deepEqual(common.peers, {});

  const incomplete = resolveItemMarketStatPeerGroup({
    catalog: catalog(["앱솔랩스 나이트케이프"], "absolab"),
    item: item("앱솔랩스 나이트케이프", "망토", "전사", "absolab"),
  });
  assert.equal(incomplete.mode, "same_item");
});

test("현재 174종 catalog의 앱솔랩스·아케인셰이드·에테르넬·카루타 peer 매핑을 shard 메타와 전수 대조한다", () => {
  const { manifest, catalogPath, publicCatalog } = loadCurrentPublicRelease();
  assert.equal(publicCatalog.items.length, manifest.data.item_count);

  const shardItems = new Map();
  const itemFor = (entry) => {
    if (!shardItems.has(entry.name)) {
      shardItems.set(entry.name, readConsistentShardItem(catalogPath, entry));
    }
    return shardItems.get(entry.name);
  };
  const groups = new Map();

  for (const [family, expected] of Object.entries(FAMILY_EXPECTATIONS)) {
    const entries = publicCatalog.items.filter((entry) =>
      String(entry.catalog_id || "").startsWith(`${family}:`)
    );
    assert.equal(entries.length, expected.itemCount, `${family}: catalog 장비 수`);

    const observedCategories = new Set();
    const familyGroups = new Set();
    for (const entry of entries) {
      const current = itemFor(entry);
      observedCategories.add(current.category);
      assert.equal(current.catalog_id, entry.catalog_id, `${entry.name}: catalog_id`);
      assert.equal(current.base_level, expected.baseLevel, `${entry.name}: 기본 레벨`);
      assert.equal(setFamily(current.set_name), expected.setFamily, `${entry.name}: 세트`);
      assert.ok(Array.isArray(current.category_path) && current.category_path.length > 0, `${entry.name}: 부위 경로`);
      assert.equal(current.category_path.at(-1), current.category, `${entry.name}: 부위 경로의 마지막 값`);

      const resolved = resolveItemMarketStatPeerGroup({ catalog: publicCatalog, item: current });
      assert.equal(resolved.mode, "job_specific_peer_items", `${entry.name}: peer 모드`);
      assert.equal(resolved.status, "ready", `${entry.name}: peer 상태`);
      assert.equal(resolved.group_key, `${family}:${current.category}`, `${entry.name}: peer 그룹`);
      assert.equal(resolved.selected_item_family, JOB_STAT[current.required_job] || null);
      assert.deepEqual(Object.keys(resolved.peers).sort(), ["DEX", "INT", "LUK", "STR"]);
      assert.deepEqual(
        resolved.additional_peers.map((peer) => [peer.key, peer.family, peer.item_name]),
        [
          ["pirate:STR", "STR", resolved.additional_peers[0].item_name],
          ["pirate:DEX", "DEX", resolved.additional_peers[0].item_name],
        ],
      );
      assert.match(resolved.additional_peers[0].item_name, /(?:파이렛|원더러)/u);

      familyGroups.add(resolved.group_key);
      const members = groups.get(resolved.group_key) || [];
      members.push(current);
      groups.set(resolved.group_key, members);

      for (const [stat, peer] of Object.entries(resolved.peers)) {
        const peerItem = itemFor(peer.entry);
        assert.equal(peerItem.required_job, STAT_JOB[stat], `${entry.name}: ${stat} peer 직업`);
        assert.equal(peerItem.category, current.category, `${entry.name}: ${stat} peer 부위`);
        assert.equal(peerItem.base_level, current.base_level, `${entry.name}: ${stat} peer 레벨`);
        assert.equal(setFamily(peerItem.set_name), setFamily(current.set_name), `${entry.name}: ${stat} peer 세트`);
      }
    }

    assert.equal(familyGroups.size, expected.groupCount, `${family}: peer 그룹 수`);
    assert.deepEqual([...observedCategories].sort(), [...expected.categories].sort(), `${family}: 부위 목록`);
  }

  assert.equal(groups.size, 22);
  for (const [groupKey, members] of groups) {
    assert.equal(members.length, 5, `${groupKey}: 5직업 장비`);
    assert.deepEqual(
      [...new Set(members.map((member) => member.required_job))].sort(),
      [...EXPECTED_JOBS].sort(),
      `${groupKey}: 직업 구성`,
    );
  }
});
