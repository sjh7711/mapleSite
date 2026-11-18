import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateSchema } from "./schema-validator.mjs";

await import("../tooltip-response-core.js");

const core = globalThis.MapleAuctionTooltipResponseCore;
const captureSchema = JSON.parse(await readFile(new URL("../schemas/capture-v2.schema.json", import.meta.url), "utf8"));
const SEARCH_KEY = "42b2ed2d-dbcf-43f9-9add-f5b1d2fcda53";
const hashId = async (material) => createHash("sha256").update(material).digest("hex");
const sourceHash = (material) => `sha256:${createHash("sha256").update(material).digest("hex")}`;

function stat(values = {}) {
  return {
    str: 0, dex: 0, int: 0, luk: 0, all: 0, mhp: 0, mmp: 0,
    pad: 0, mad: 0, pdd: 0, speed: 0, jump: 0, dam: 0, bdr: 0, imdr: 0,
    ...values
  };
}

function baseTooltip() {
  return {
    itemName: "에테르넬 메이지글러브",
    starforce: 0,
    starforceMax: 30,
    reqLevel: 245,
    reqJob: "마법사",
    categories: ["장비", "방어구", "장갑"],
    tradeDesc: ["장착 시 교환 불가", "가위 사용 잔여 횟수 : 5 / 10"],
    setEffects: ["fallback 세트"],
    setItemInfo: { setItemName: "에테르넬 세트(마법사)" },
    stat: stat({ int: 77, luk: 55, all: 5, mad: 23, pdd: 300 }),
    baseStat: stat({ int: 55, luk: 55, mad: 12, pdd: 200 }),
    starforceStat: stat({ int: 10, mad: 3, pdd: 100 }),
    upgradeStat: stat({ int: 5, mad: 8 }),
    exOptionStat: stat({ int: 7, all: 5 }),
    timeLimitedStat: stat(),
    upgradeInfo: {
      starForce: { canUpgrade: true },
      scroll: {
        current: 1,
        remaining: 2,
        failure: 3,
        max: 6,
        description: "업그레이드 가능 횟수 2 (복구 가능 횟수 3)"
      },
      potential: {
        grade: 4,
        description: "잠재능력 : 레전드리",
        entries: [
          { grade: 4, text: "INT +12%" },
          { grade: 3, text: "모든 스킬의 재사용 대기시간 -2초" }
        ]
      },
      additionalPotential: {
        grade: 4,
        description: "에디셔널 잠재능력 : 레전드리",
        entries: [{ grade: 3, text: "캐릭터 기준 9레벨 당 INT +1" }]
      }
    }
  };
}

function soldItem(overrides = {}) {
  return {
    source_hashes: {
      listing: sourceHash("private-listing-id-1"),
      item: sourceHash("private-encrypted-item-id-1"),
      trade: sourceHash("private-trade-id-1")
    },
    itemName: "에테르넬 메이지글러브",
    itemIcon: { fallBackUrl: "https://cdn.example.invalid/item/01234567.png" },
    toolTipType: 1,
    quantity: 1,
    price: 1234567890,
    endDate: "2026-09-03T00:00:00.000Z",
    tradeDate: "2026-09-02T01:02:03.000Z",
    status: "SOLD",
    isMyWorld: false,
    toolTip: baseTooltip(),
    ...overrides
  };
}

function soldResponse() {
  const tooltip = baseTooltip();
  tooltip.upgradeInfo.additionalPotential = {
    grade: 0,
    description: "에디셔널 잠재능력 : 없음",
    entries: []
  };
  return {
    items: [
      soldItem(),
      soldItem({
        source_hashes: {
          listing: sourceHash("private-listing-id-2"),
          item: sourceHash("private-encrypted-item-id-2"),
          trade: sourceHash("private-trade-id-2")
        },
        price: "987654321",
        toolTip: tooltip
      })
    ],
    page: 1,
    limit: 2,
    total: 2,
    totalPages: 1,
    hasNext: false,
    searchKey: SEARCH_KEY
  };
}

test("uses trusted source_hashes without rehashing and persists no raw identifiers", async () => {
  assert.ok(core);
  const hashPurposes = [];
  const converted = await core.convertSoldTooltipResponse(soldResponse(), {
    batchId: "tooltip-api-test",
    hashId: async (material, purpose) => {
      hashPurposes.push(purpose);
      return hashId(material);
    },
    expectedPage: 1,
    expectedLimit: 2,
    requestUrl: `https://api.mskr.nexon.com/v1/market/web/items/searches/sold/${SEARCH_KEY}/tool-tip?accountId=46314640&page=1&limit=2&sortType=TRADE_DATE_DESC&characterId=51852377`
  });

  assert.equal(converted.items.length, 2);
  assert.equal(
    converted.sanitized_request_url,
    "/v1/market/web/items/searches/sold/tool-tip?page=1&limit=2&sortType=TRADE_DATE_DESC"
  );
  const serialized = JSON.stringify(converted);
  for (const secret of [
    "46314640", "51852377", SEARCH_KEY,
    "private-listing-id-1", "private-encrypted-item-id-1"
  ]) assert.equal(serialized.includes(secret), false);

  const first = converted.items[0];
  assert.deepEqual(validateSchema(first, captureSchema.properties.items.items), []);
  assert.deepEqual(first.item.starforce, {
    value: 0,
    applicable: true,
    source: "api_response",
    confidence: "confirmed"
  });
  assert.equal(first.listing.listing_id_source, "native");
  assert.equal(first.listing.price_meso, "1234567890");
  assert.equal(first.listing.listing_id, sourceHash("private-listing-id-1"));
  assert.equal(first.item.item_id, sourceHash("private-encrypted-item-id-1"));
  assert.equal(hashPurposes.includes("listing_id"), false);
  assert.equal(hashPurposes.includes("item_id"), false);
  assert.equal(first.item.set_name, "에테르넬 세트(마법사)");
  assert.equal(first.item.stats.base.int_flat, 55);
  assert.equal(first.item.stats.starforce.int_flat, 10);
  assert.equal(first.item.stats.scroll.int_flat, 5);
  assert.equal(first.item.stats.flame.int_flat, 7);

  const nineLevel = first.item.additional_potential.lines[0];
  assert.deepEqual(nineLevel.params, {
    levels_per_increment: 9,
    stat_code: "INT",
    stat_value: 1
  });
  const cooldown = first.item.potential.lines[1];
  assert.equal(cooldown.code, "COOLDOWN_REDUCTION");
  assert.equal(cooldown.value, 2);
  assert.equal(cooldown.unit, "seconds");
  assert.equal(core.parsePotentialLine("스킬 재사용 대기시간 -1초").code, "COOLDOWN_REDUCTION");
  assert.equal(core.parsePotentialLine("재사용 대기시간 -2초").value, 2);
  assert.deepEqual(core.parsePotentialLine("공격 시 7% 확률로 오토스틸"), {
    code: "AUTO_STEAL",
    value: 7,
    unit: "pct",
    params: {},
    raw: "공격 시 7% 확률로 오토스틸"
  });
  assert.deepEqual(core.parsePotentialLine("공격 시 15% 확률로 HP 95 회복"), {
    code: "HP_RECOVERY_ON_ATTACK",
    value: 95,
    unit: "flat",
    params: { trigger_chance_pct: 15 },
    raw: "공격 시 15% 확률로 HP 95 회복"
  });
});

test("still hashes raw identifiers for direct response or CLI conversion", async () => {
  const raw = soldItem({
    source_hashes: undefined,
    _id: "private-listing-id-cli",
    encryptedItemId: "private-encrypted-item-id-cli"
  });
  const purposes = [];
  const converted = await core.convertSoldTooltipItem(raw, {
    hashId: async (material, purpose) => {
      purposes.push(purpose);
      return hashId(material);
    }
  });
  assert.equal(purposes.includes("listing_id"), true);
  assert.equal(purposes.includes("item_id"), true);
  assert.match(converted.listing.listing_id, /^sha256:[0-9a-f]{64}$/u);
  assert.match(converted.item.item_id, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(JSON.stringify(converted).includes("private-listing-id-cli"), false);
  assert.equal(JSON.stringify(converted).includes("private-encrypted-item-id-cli"), false);
});

test("keeps an empty section distinct from an API line with grade zero", async () => {
  const response = soldResponse();
  const raw = structuredClone(response.items[0]);
  raw.toolTip.setItemInfo.setItemName = "setItemInfo 우선 세트";
  raw.toolTip.setEffects = ["fallback 세트"];
  raw.toolTip.upgradeInfo.potential.entries = [{ grade: 0, text: "INT +1" }];
  const converted = await core.convertSoldTooltipItem(raw, { hashId });
  assert.equal(converted.item.set_name, "setItemInfo 우선 세트");
  assert.equal(converted.item.potential.lines[0].tier, null);

  const emptyAdditional = (await core.convertSoldTooltipItem(response.items[1], { hashId })).item.additional_potential;
  assert.equal(emptyAdditional.grade, "none");
  assert.deepEqual(emptyAdditional.lines, []);
});

test("rejects active responses", async () => {
  const active = soldResponse();
  active.items = active.items.map((item) => ({ ...item, status: "ON_SALE", tradeDate: null }));
  await assert.rejects(
    core.convertSoldTooltipResponse(active, { hashId, expectedPage: 1, expectedLimit: 2 }),
    /is not SOLD/u
  );
});
