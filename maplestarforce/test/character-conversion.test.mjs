import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const API_KEY = "test-nexon-api-key";
const OCID = "private-test-ocid";
const RAW_MARKER = "private-raw-snapshot-marker";
const ORIGIN = "https://preview.starforce.pages.dev";
const ENDPOINT_PATH = "/api/character-conversion";
const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const EXPECTED_CHARACTER_SKILL_GRADES = Object.freeze([
  "0",
  "1",
  "1.5",
  "2",
  "2.5",
  "3",
  "4",
  "5",
  "6",
  "hyperpassive",
  "hyperactive",
]);
// /id 1회 + 스킬을 제외한 공개 스냅샷 19회 + 전직 차수별 스킬 조회.
const EXPECTED_PUBLIC_SNAPSHOT_CALLS =
  20 + EXPECTED_CHARACTER_SKILL_GRADES.length;

let temporaryDirectory;
let handleCharacterConversion;
let createCacheKey;
let createSnapshotCacheKey;
let parseCharacterConversionQuery;
let characterConversionCacheVersion;
let characterSnapshotCacheVersion;

before(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "maplestarforce-api-test-"));
  const outfile = join(temporaryDirectory, "character-conversion.mjs");
  await build({
    entryPoints: [join(PROJECT_ROOT, "functions/api/character-conversion.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
  });
  ({
    handleCharacterConversion,
    createCacheKey,
    createSnapshotCacheKey,
    parseCharacterConversionQuery,
    CHARACTER_CONVERSION_CACHE_VERSION: characterConversionCacheVersion,
    CHARACTER_SNAPSHOT_CACHE_VERSION: characterSnapshotCacheVersion,
  } = await import(pathToFileURL(outfile).href));
});

after(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

function statPayload() {
  return {
    final_stat: Object.entries({
      STR: 10_000,
      DEX: 2_500,
      공격력: 2_000,
      데미지: 100,
      "보스 몬스터 데미지": 300,
      "방어율 무시": 96,
      "크리티컬 데미지": 80,
      "AP 배분 STR": 1_000,
      "AP 배분 DEX": 4,
    }).map(([stat_name, stat_value]) => ({
      stat_name,
      stat_value: String(stat_value),
    })),
    raw_marker: RAW_MARKER,
  };
}

function equipmentPayload() {
  return {
    item_equipment: [
      {
        item_name: "테스트 모자",
        item_equipment_slot: "모자",
        item_equipment_part: "모자",
        item_icon: "https://example.com/hat.png",
        item_gender: "공용",
        item_description: "테스트용 모자",
        equipment_level_increase: 0,
        growth_level: 3,
        starforce: "22",
        scroll_upgrade: "8",
        scroll_upgradeable_count: "1",
        scroll_resilience_count: "0",
        golden_hammer_flag: "적용",
        cuttable_count: "5",
        item_total_option: { str: "1000", dex: "500" },
        item_add_option: {
          str: "80",
          dex: "20",
          attack_power: "5",
          all_stat: "5",
        },
        potential_option_grade: "레전드리",
        potential_option_1: "STR +100%",
        potential_option_2: "크리티컬 데미지 +8%",
        potential_option_3: "보스 몬스터 공격 시 데미지 +40%",
        additional_potential_option_grade: "에픽",
        additional_potential_option_1: "공격력 +50%",
        additional_potential_option_2: "STR +10",
        additional_potential_option_3: "스킬 재사용 대기시간 -2초",
      },
      {
        item_name: "테스트 무기",
        item_equipment_slot: "무기",
        item_equipment_part: "무기",
        item_icon: "https://example.com/weapon.png",
        item_base_option: {
          base_equipment_level: "250",
          attack_power: "280",
          magic_power: "0",
        },
        item_total_option: { attack_power: "481" },
        // 공식 장착 장비 API에서는 강화 횟수와 증가 옵션이 모두
        // item_exceptional_option 안에 들어온다. 최상위 값보다 원본
        // 중첩 필드를 우선해야 한다.
        exceptional_upgrade: "9",
        item_exceptional_option: {
          str: "20",
          dex: "20",
          int: "20",
          luk: "20",
          max_hp: "1000",
          max_mp: "1000",
          attack_power: "15",
          magic_power: "15",
          exceptional_upgrade: "1",
        },
        item_add_option: {
          attack_power: "201",
          boss_damage: "10",
        },
        potential_option_grade: "레전드리",
        potential_option_1: "공격력 +12%",
        potential_option_2: "보스 몬스터 공격 시 데미지 +40%",
        potential_option_3: "몬스터 방어율 무시 +40%",
      },
      {
        item_name: "저주받은 적의 마도서",
        item_equipment_slot: "포켓아이템",
        item_equipment_part: "포켓아이템",
        item_icon: "https://example.com/spellbook.png",
        item_base_option: { base_equipment_level: "160" },
        item_total_option: { str: "100", dex: "40" },
        item_add_option: { str: "80", dex: "30", all_stat: "5" },
        // 일부 저장본/호환 응답에서 최상위로 전달된 경우도 잃지 않는다.
        exceptional_upgrade: "2",
      },
      {
        item_name: "핑크빛 성배",
        item_equipment_slot: "포켓아이템",
        item_equipment_part: "포켓아이템",
        item_icon: "https://example.com/cup.png",
        item_base_option: { base_equipment_level: "140" },
        item_total_option: { str: "80", dex: "30" },
        item_add_option: { str: "60", dex: "20", all_stat: "4" },
        exceptional_upgrade: "잘못된 값",
      },
      ...[
        "죽음의 맹세",
        "굶주리는 핏빛 원혼",
        "근원의 속삭임",
        "황홀한 악몽",
        "불멸의 유산",
        "오만의 원죄",
      ].map((item_name) => ({
        item_name,
        item_equipment_slot: "반지",
        item_equipment_part: "반지",
        item_icon: "https://example.com/brilliant-boss.png",
        item_base_option: { base_equipment_level: "250" },
        item_total_option: { str: "100", dex: "40" },
        item_add_option: { str: "84", dex: "28", all_stat: "6" },
      })),
    ],
    raw_marker: RAW_MARKER,
  };
}

function dualSubstatStatPayload() {
  return {
    final_stat: Object.entries({
      STR: 2_200,
      DEX: 2_500,
      LUK: 10_000,
      공격력: 2_000,
      데미지: 100,
      "보스 몬스터 데미지": 300,
      "방어율 무시": 96,
      "크리티컬 데미지": 80,
      "AP 배분 STR": 4,
      "AP 배분 DEX": 4,
      "AP 배분 LUK": 1_000,
    }).map(([stat_name, stat_value]) => ({
      stat_name,
      stat_value: String(stat_value),
    })),
    raw_marker: RAW_MARKER,
  };
}

function dualSubstatEquipmentPayload() {
  return {
    item_equipment: [
      {
        item_equipment_slot: "모자",
        item_total_option: { str: "400", dex: "500", luk: "1000" },
        potential_option_1: "LUK +100%",
        potential_option_2: "DEX +50%",
        potential_option_3: "STR +40%",
        additional_potential_option_1: "공격력 +50%",
        additional_potential_option_2: "STR +10",
        additional_potential_option_3: "DEX +5",
      },
    ],
    raw_marker: RAW_MARKER,
  };
}

function nexonPayload(
  url,
  { className = "히어로", dualSubstats = false } = {},
) {
  const path = url.pathname.replace("/maplestory/v1", "");
  switch (path) {
    case "/id":
      return { ocid: OCID };
    case "/character/basic":
      return {
        character_name: "테스트",
        world_name: "스카니아",
        character_level: 270,
        character_class: className,
        character_image: "https://example.com/character.png",
        raw_marker: RAW_MARKER,
      };
    case "/character/stat":
      return dualSubstats ? dualSubstatStatPayload() : statPayload();
    case "/character/item-equipment":
      return dualSubstats ? dualSubstatEquipmentPayload() : equipmentPayload();
    case "/character/cashitem-equipment":
      return {
        cash_item_equipment_base: [{
          cash_item_name: "테스트 전투복",
          cash_item_label: "마스터라벨",
          cash_item_option: [
            { option_type: "STR", option_value: "30" },
            { option_type: "DEX", option_value: "30" },
            { option_type: "INT", option_value: "30" },
            { option_type: "LUK", option_value: "30" },
            { option_type: "공격력", option_value: "15" },
            { option_type: "마력", option_value: "15" },
            { option_type: "최대 HP", option_value: "1750" },
            { option_type: "최대 MP", option_value: "1750" },
          ],
        }],
        raw_marker: RAW_MARKER,
      };
    case "/character/pet-equipment":
      return {
        pet_activate_flag: "1",
        world_share_pet_1_equipment_preset_no: 1,
        world_share_pet_2_equipment_preset_no: 1,
        world_share_pet_3_equipment_preset_no: 1,
        world_share_pet_1_equipment: {
          item_option: [{ option_type: "공격력", option_value: "10" }],
        },
        world_share_pet_2_equipment: { item_option: [] },
        world_share_pet_3_equipment: { item_option: [] },
        world_share_pet_equipment_preset: [
          { preset_no: 1, slot_no: 1, item_option: [{ option_type: "공격력", option_value: "10" }] },
          { preset_no: 2, slot_no: 1, item_option: [{ option_type: "공격력", option_value: "44" }] },
        ],
        petite_luna_pet_skill: [
          { skill_effect: "공격력 30, 마력 30 증가" },
        ],
        raw_marker: RAW_MARKER,
      };
    case "/character/set-effect":
      return { set_effect: [], raw_marker: RAW_MARKER };
    case "/character/other-stat":
      return {
        other_stat: [{ stat_info: [
          { stat_name: "올스탯", stat_value: "140" },
          { stat_name: "공격력", stat_value: "60" },
        ] }],
        raw_marker: RAW_MARKER,
      };
    case "/character/skill":
      return { character_skill: [], raw_marker: RAW_MARKER };
    default:
      return { raw_marker: RAW_MARKER };
  }
}

function presetNexonPayload(url) {
  const path = url.pathname.replace("/maplestory/v1", "");
  if (path === "/character/item-equipment") {
    const active = equipmentPayload().item_equipment;
    return {
      preset_no: 1,
      item_equipment: active,
      item_equipment_preset_1: active,
      item_equipment_preset_2: [
        {
          ...active[0],
          item_name: "테스트 프리셋 모자",
          item_total_option: { str: "1100", dex: "550" },
          potential_option_1: "STR +120%",
          potential_option_2: "보스 몬스터 공격 시 데미지 +20%",
          potential_option_3: "몬스터 방어율 무시 +30%",
        },
      ],
      title_preset1: null,
      title_preset2: null,
      raw_marker: RAW_MARKER,
    };
  }
  if (path === "/character/hyper-stat") {
    return {
      use_preset_no: "1",
      hyper_stat_preset_1: [
        { stat_type: "보스 몬스터 공격 시 데미지 증가", stat_increase: "보스 몬스터 공격 시 데미지 10% 증가" },
      ],
      hyper_stat_preset_2: [
        { stat_type: "보스 몬스터 공격 시 데미지 증가", stat_increase: "보스 몬스터 공격 시 데미지 20% 증가" },
      ],
      raw_marker: RAW_MARKER,
    };
  }
  if (path === "/user/union-raider") {
    return {
      use_preset_no: 1,
      union_state_stat: ["STR 10 증가"],
      union_state_stat_preset: [
        { preset_no: 1, union_state_stat: ["STR 10 증가"] },
        { preset_no: 2, union_state_stat: ["보스 몬스터 공격 시 데미지 20% 증가"] },
        { preset_no: 7, union_state_stat: [] },
      ],
      raw_marker: RAW_MARKER,
    };
  }
  if (path === "/character/link-skill") {
    const active = [
      { skill_name: "링크1", skill_level: 1, skill_effect: "STR 10 증가" },
    ];
    return {
      character_link_skill: active,
      character_link_skill_preset_1: active,
      character_link_skill_preset_2: [
        { skill_name: "링크2", skill_level: 1, skill_effect: "데미지 10% 증가" },
      ],
      character_owned_link_skill: null,
      character_owned_link_skill_preset_1: null,
      character_owned_link_skill_preset_2: null,
      raw_marker: RAW_MARKER,
    };
  }
  if (path === "/character/ability") {
    return {
      preset_no: 1,
      ability_info: [{ ability_value: "STR 10 증가" }],
      ability_preset_1: { ability_info: [{ ability_value: "STR 10 증가" }] },
      ability_preset_2: {
        ability_info: [
          { ability_value: "보스 몬스터 공격 시 데미지 20% 증가" },
        ],
      },
      raw_marker: RAW_MARKER,
    };
  }
  return nexonPayload(url);
}

function apiRequest({ characterName = "테스트", origin = ORIGIN } = {}) {
  const url = new URL(ENDPOINT_PATH, ORIGIN);
  url.searchParams.set("characterName", characterName);
  return new Request(url, {
    method: "GET",
    headers: origin ? { Origin: origin } : undefined,
  });
}

function createContext(request, waitUntilPromises = []) {
  return {
    request,
    env: { NEXON_API_KEY: API_KEY },
    waitUntil(promise) {
      waitUntilPromises.push(promise);
    },
  };
}

class MemoryCache {
  entries = new Map();

  async match(request) {
    return this.entries.get(request.url)?.clone();
  }

  async put(request, response) {
    this.entries.set(request.url, response.clone());
  }

  delete(request) {
    this.entries.delete(request.url);
  }
}

test("환산 계약 버전으로 이전 단일 부스탯 캐시와 키를 분리한다", () => {
  const request = apiRequest();
  const versionedKey = createCacheKey(request, "테스트");
  const versionedUrl = new URL(versionedKey.url);
  const legacyUrl = new URL(request.url);

  assert.equal(versionedUrl.searchParams.get("characterName"), "테스트");
  assert.equal(
    versionedUrl.searchParams.get("conversionVersion"),
    characterConversionCacheVersion,
  );
  assert.equal(characterConversionCacheVersion, "combat-profile-v109-damage-weighted-soul-contract");
  const freshSnapshotKey = createSnapshotCacheKey(request, "테스트", "fresh");
  const staleSnapshotKey = createSnapshotCacheKey(request, "테스트", "stale");
  assert.equal(characterSnapshotCacheVersion, "character-snapshot-v4");
  assert.equal(freshSnapshotKey.url.includes("presetMode"), false);
  assert.equal(freshSnapshotKey.url.includes(characterConversionCacheVersion), false);
  assert.notEqual(freshSnapshotKey.url, staleSnapshotKey.url);
  assert.notEqual(versionedUrl.toString(), legacyUrl.toString());
});

test("프리셋 쿼리를 검증하고 정책 전체를 캐시 키에서 분리한다", () => {
  const activeRequest = apiRequest();
  const activeUrl = new URL(activeRequest.url);
  activeUrl.searchParams.set("presetMode", "active");
  const activeQuery = parseCharacterConversionQuery(new Request(activeUrl));
  assert.deepEqual(activeQuery.presetPolicy, { mode: "active" });
  assert.equal(activeQuery.refresh, false);

  const refreshUrl = new URL(activeUrl);
  refreshUrl.searchParams.set("refresh", "1");
  assert.equal(
    parseCharacterConversionQuery(new Request(refreshUrl)).refresh,
    true,
  );

  const manualUrl = new URL(activeRequest.url);
  manualUrl.searchParams.set("presetMode", "manual");
  for (const field of [
    "equipmentPreset",
    "hyperPreset",
    "unionPreset",
    "linkPreset",
    "abilityPreset",
  ]) {
    manualUrl.searchParams.set(field, "2");
  }
  const manualQuery = parseCharacterConversionQuery(new Request(manualUrl));
  assert.deepEqual(manualQuery.presetPolicy, {
    mode: "manual",
    manual: { equipment: 2, hyper: 2, union: 2, link: 2, ability: 2 },
  });
  assert.notEqual(
    createCacheKey(activeRequest, "테스트", activeQuery.presetPolicy).url,
    createCacheKey(activeRequest, "테스트", manualQuery.presetPolicy).url,
  );
  assert.throws(() => {
    const invalid = new URL(activeRequest.url);
    invalid.searchParams.set("presetMode", "manual");
    parseCharacterConversionQuery(new Request(invalid));
  }, /manual/);

  const invalidEquipment = new URL(manualUrl);
  invalidEquipment.searchParams.set("equipmentPreset", "10");
  assert.throws(
    () => parseCharacterConversionQuery(new Request(invalidEquipment)),
    /manual/,
  );

  const unionTen = new URL(manualUrl);
  unionTen.searchParams.set("equipmentPreset", "1");
  unionTen.searchParams.set("hyperPreset", "1");
  unionTen.searchParams.set("unionPreset", "10");
  unionTen.searchParams.set("linkPreset", "1");
  unionTen.searchParams.set("abilityPreset", "1");
  assert.equal(
    parseCharacterConversionQuery(new Request(unionTen)).presetPolicy.manual
      .union,
    10,
  );
});

test("활성 API 버프와 별개로 공통 출처를 합산하고 보스 조건을 한 번 적용한다", async () => {
  const active = {
    STR: 1312, DEX: 214, 데미지: 54, 공격력: 2120, 마력: 710,
    "방어율 무시": 77.32, "최종 데미지": 27.2, "보스 몬스터 데미지": 175,
    "크리티컬 확률": 105, "크리티컬 데미지": 114.6,
    "AP 배분 STR": 1000, "AP 배분 DEX": 4,
  };
  const buffsOff = {
    ...active, 데미지: 33, 공격력: 2000, 마력: 650,
    "방어율 무시": 73, "최종 데미지": 20, "보스 몬스터 데미지": 130,
    "크리티컬 확률": 95, "크리티컬 데미지": 106.6,
  };
  const fetchConversion = async (
    stats, className = "렌", covenant = false, sharpEyesLevel = 30, armorPiercingLevel = null,
  ) => {
    const url = new URL(apiRequest().url);
    url.searchParams.set("presetMode", "active");
    const response = await handleCharacterConversion(createContext(new Request(url)), {
      cache: null,
      sleep: async () => {},
      fetchImpl: async (input) => {
        const request = new URL(input);
        const apiPath = request.pathname;
        const payload = nexonPayload(request, { className });
        const isBow = className === "보우마스터";
        const luna = {
          skill_name: "루나 게더링", skill_level: 1,
          skill_effect: "[패시브 효과 : 공격력 15, 마력 15 증가]",
        };
        if (isBow && apiPath.endsWith("/character/basic")) payload.character_guild_name = "테스트길드";
        if (apiPath.endsWith("/guild/id")) return Response.json({ oguild_id: "private-guild-id" });
        if (apiPath.endsWith("/guild/basic")) return Response.json({
          guild_skill: [
            { skill_name: "길드의 노하우Ⅰ", skill_level: 1, skill_effect: "공격력 30, 마력 30 증가" },
            { skill_name: "길드의 노하우Ⅱ", skill_level: 1, skill_effect: "공격력 6, 마력 6 증가" },
            { skill_name: "길드의 노하우Ⅳ", skill_level: 1, skill_effect: "공격력 4, 마력 4 증가" },
            { skill_name: "길드의 노하우Ⅴ", skill_level: 1, skill_effect: "힘 40, 민첩 40, 지능 40, 운 40 증가" },
            { skill_name: "길드의 노하우Ⅵ", skill_level: 1, skill_effect: "공격력 5, 마력 5 증가" },
          ],
          guild_noblesse_skill: [],
        });
        if (apiPath.endsWith("/item-equipment")) {
          return Response.json({ preset_no: 1, item_equipment: [
            {
              item_equipment_slot: "무기", item_name: "무기",
              item_equipment_part: isBow ? "활" : undefined,
              item_total_option: {
                str: "100", dex: "200", luk: "20", all_stat: "5", attack_power: "1000",
                magic_power: "500", boss_damage: "100", ignore_monster_armor: "40",
              },
              potential_option_1: "공격력 +100%",
              potential_option_2: "마력 +30%",
            },
            {
              item_equipment_slot: "예비 특수 반지", item_name: "컨티뉴어스 링",
              special_ring_level: 5, item_total_option: {},
            },
          ] });
        }
        if (apiPath.endsWith("/other-stat") || apiPath.endsWith("/cashitem-equipment")) {
          return Response.json({});
        }
        if (apiPath.endsWith("/pet-equipment")) {
          return Response.json({
            pet_1_auto_skill: { skill_1: "오라 웨폰", skill_2: "쓸만한 샤프 아이즈" },
            petite_luna_pet_skill: isBow ? [luna] : [],
          });
        }
        if (apiPath.endsWith("/propensity")) return Response.json({ charisma_level: 100, sensibility_level: 100 });
        if (apiPath.endsWith("/skill") && covenant && request.searchParams.get("character_skill_grade") === "6") {
          payload.character_skill = [{
            skill_name: "솔 헤카테", skill_level: 1, skill_effect: "HP 100 소비, 솔 헤카테 소환",
          }];
        }
        if (apiPath.endsWith("/skill") && isBow) {
          const grade = request.searchParams.get("character_skill_grade");
          if (grade === "0") payload.character_skill = [luna];
          if (grade === "2") payload.character_skill = [
            { skill_name: "소울 애로우 : 활", skill_level: 10, skill_effect: "공격력 30 증가, 화살 소비 없이 공격 가능" },
          ];
          if (grade === "3") payload.character_skill = [
            { skill_name: "익스트림 아쳐리 : 활", skill_level: 10,
              skill_effect: "방어력 25% 감소, 공격력 30 증가, 최종 데미지 30% 증가" },
          ];
          if (grade === "4") payload.character_skill = [
            { skill_name: "샤프 아이즈", skill_level: sharpEyesLevel,
              skill_effect: sharpEyesLevel === 31
                ? "310초 동안 크리티컬 확률 21%, 크리티컬 데미지 16% 증가"
                : "300초 동안 크리티컬 확률 20%, 크리티컬 데미지 15% 증가" },
          ];
          if (grade === "4" && armorPiercingLevel) {
            payload.character_skill_grade = grade;
            payload.character_skill.push({
              skill_name: "아머 피어싱",
              skill_level: armorPiercingLevel,
              skill_effect: armorPiercingLevel === 11
                ? "방어율 무시 40%, 최종 데미지 16% 증가"
                : "방어율 무시 41%, 최종 데미지 17% 증가",
            });
          }
          if (grade === "hyperpassive") payload.character_skill = [
            { skill_name: "샤프 아이즈-크리티컬 레이트", skill_level: 1,
              skill_effect: "크리티컬 확률 5% 증가" },
            { skill_name: "샤프 아이즈-이그노어 가드", skill_level: 1,
              skill_effect: "방어율 무시 효과 5% 추가" },
          ];
        }
        if (apiPath.endsWith("/skill") && request.searchParams.get("character_skill_grade") === "5") {
          payload.character_skill = [
            {
              skill_name: "기본 패시브", skill_level: 30,
              skill_effect: "영구적으로 데미지 33%, 보스 몬스터 공격 시 데미지 30%, 방어율 무시 50%, 최종 데미지 20%, 크리티컬 확률 90%, 크리티컬 데미지 106.6% 증가",
            },
            {
              skill_name: "메이플 용사", skill_level: 30,
              skill_effect: "AP를 직접 투자한 모든 능력치 15% 증가",
            },
            {
              skill_name: "오라 웨폰", skill_level: 30,
              skill_effect: "130초 동안 몬스터 방어율 무시 16%, 최종 데미지 6% 증가. 재사용 대기시간 120초",
            },
            {
              skill_name: "쓸만한 샤프 아이즈", skill_level: 30,
              skill_effect: "270초 동안 크리티컬 확률 10%, 크리티컬 데미지 8% 증가",
            },
          ];
          if (isBow) payload.character_skill.push({
            skill_name: "쓸만한 어드밴스드 블레스", skill_level: 30,
            skill_effect: "공격력 20, 마력 20, 방어력 425 증가\n[패시브 효과 : 올스탯 6 증가]",
          });
          if (className === "제논" || className === "바이퍼") {
            const faces = "3 : 공격력 15 증가\n4 : 크리티컬 확률 15% 증가\n5 : 데미지 20% 증가";
            payload.character_skill.push(
              { skill_name: "로디드 다이스", skill_level: 30,
                skill_effect: "HP 100 소비, 주사위 1개의 눈을 정할 수 있음\n재사용 대기시간 1초\n[패시브 효과 : 공격력 40 증가]" },
              { skill_name: "럭키 다이스", skill_level: 20, skill_effect: faces },
            );
            if (className === "바이퍼") {
              payload.character_skill.push(
                { skill_name: "더블 럭키 다이스", skill_level: 8, skill_effect:
                  `1을 제외하고 주사위 눈이 같으면 아래 효과의 10 혹은 10%p만큼 강화\n${faces}` },
                { skill_name: "더블 럭키 다이스-엑스트라 넘버", skill_level: 1,
                  skill_effect: "더블 럭키 다이스에 7 추가\n7 : 몬스터 방어율 무시 20% 증가" },
              );
            }
          }
        }
        if (apiPath.endsWith("/link-skill")) {
          payload.character_link_skill = [
            { skill_name: "무아", skill_level: 2, skill_effect: "전투 상태에 돌입 시 데미지 11% 증가" },
            { skill_name: "전투의 흐름", skill_level: 2, skill_effect: "10초 동안 데미지 10% 증가" },
          ];
          if (covenant) {
            const covenantSkill = {
              skill_name: "커버넌트", skill_level: 2, skill_effect: "소환수 소환 시 데미지 8% 증가",
            };
            payload.character_link_skill.push(covenantSkill);
            payload.character_owned_link_skill = covenantSkill;
          }
        }
        if (apiPath.endsWith("/stat")) {
          payload.final_stat = Object.entries(stats).map(([stat_name, value]) => ({
            stat_name, stat_value: String(value),
          }));
        }
        return Response.json(payload);
      },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /public/u);
    return (await response.json()).profiles;
  };

  const off = await fetchConversion(buffsOff);
  const on = await fetchConversion({
    ...active,
    "버프 지속시간": 999,
    "상태이상 추가 데미지": 90,
  });
  assert.deepEqual(on.fullBoss.details.registeredPetSkills, ["오라 웨폰", "쓸만한 샤프 아이즈"]);
  const checks = Object.fromEntries(on.fullBoss.details.statVerification.map((row) => [row.name, row]));
  assert.deepEqual(checks.STR, { name: "STR", calculated: 1312, api: 1312, matched: true });
  assert.deepEqual(checks.데미지, { name: "데미지", calculated: 33, api: 54, matched: false });
  assert.equal(checks["방어율 무시"].matched, false);
  assert.equal(checks["최종 데미지"].matched, false);
  assert.equal(checks["크리티컬 데미지"].matched, false);
  assert.equal(checks["보스 몬스터 데미지"].matched, false);
  assert.equal(checks["버프 지속시간"].calculated, 10);
  assert.equal(checks["상태이상 추가 데미지"].calculated, 0);
  assert.equal(on.base.details.currentBossDamage, 130);
  assert.equal(on.fullBoss.details.currentBossDamage, 130);
  assert.equal(on.fullBoss.details.currentDamage, 33);
  assert.equal(on.fullBoss.details.currentCriticalRate, 95);
  assert.equal(on.fullBoss.details.dopedCriticalRate, 105);
  assert.deepEqual(on.base.statEquivalence, off.base.statEquivalence);
  assert.deepEqual(on.fullBoss.statEquivalence, off.fullBoss.statEquivalence);

  const applied = (profile, name) => profile.details.combatModel.effects
    .filter((effect) => effect.source === name && effect.applied);
  assert.equal(applied(on.base, "오라 웨폰").length, 0);
  assert.equal(applied(on.fullBoss, "오라 웨폰").length, 1);
  assert.deepEqual(applied(on.fullBoss, "오라 웨폰")[0].averagedModifiers.ignoreDefenseSources, [16]);
  assert.equal(applied(on.fullBoss, "컨티뉴어스 링").length, 1);
  assert.equal(applied(on.fullBoss, "쓸만한 샤프 아이즈")[0].averagedModifiers.criticalRate, 10);
  assert.equal(applied(on.fullBoss, "쓸만한 샤프 아이즈")[0].averagedModifiers.criticalDamage, 8);
  assert.equal(applied(on.fullBoss, "세이람의 영약")[0].averagedModifiers.criticalDamage, 8);

  const covenant = await fetchConversion({ ...buffsOff, 데미지: 41 }, "렌", true);
  assert.equal(covenant.fullBoss.details.currentDamage, 41);
  assert.equal(covenant.fullBoss.details.selectedStatTotals.데미지, 41);
  assert.equal(covenant.fullBoss.details.selectedCovenantDamage, 8);
  const covenantSources = (profile) => profile.details.conditionalLinkSources
    .filter(({ name }) => name === "커버넌트");
  assert.equal(covenantSources(covenant.fullBoss).length, 0);
  assert.equal(covenantSources(covenant.base).length, 0);
  assert.ok(Math.abs(covenant.fullBoss.details.dopedDamageTotal - off.fullBoss.details.dopedDamageTotal - 8) < 1e-9);
  const covenantCheck = covenant.fullBoss.details.statVerification.find(({ name }) => name === "데미지");
  assert.equal(covenantCheck.matched, false);
  assert.equal(covenantCheck.conditionalMatch, "커버넌트(소환수 유지)");

  const bow = await fetchConversion({
    ...buffsOff,
    공격력: 2298, 마력: 754, DEX: 262,
    "최종 데미지": 56,
    "방어율 무시": 74.35,
    "크리티컬 확률": 120,
    "크리티컬 데미지": 121.6,
  }, "보우마스터", false, 31);
  assert.equal(bow.fullBoss.details.currentCriticalRate, 95);
  assert.equal(bow.fullBoss.details.dopedCriticalRate, 121);
  assert.equal(bow.fullBoss.details.selectedBossInput.stats["크리티컬 확률"], 121);
  assert.equal(bow.fullBoss.details.selectedBossInput.stats["크리티컬 데미지"], 122.6);
  assert.equal(applied(bow.fullBoss, "샤프 아이즈").length, 1);
  assert.equal(applied(bow.fullBoss, "쓸만한 샤프 아이즈").length, 0);
  const bowChecks = Object.fromEntries(bow.fullBoss.details.statVerification.map((row) => [row.name, row]));
  for (const key of ["방어율 무시", "크리티컬 확률", "크리티컬 데미지"]) {
    assert.equal(bowChecks[key].conditionalMatch, "샤프 아이즈 Lv.30");
  }
  assert.equal(bowChecks["최종 데미지"].conditionalMatch, "익스트림 아쳐리");
  const withoutCollector = await fetchConversion(buffsOff, "보우마스터", false, 31, 11);
  const withCollector = await fetchConversion(active, "보우마스터", false, 31, 12);
  assert.deepEqual(withCollector.fullBoss.statEquivalence, withoutCollector.fullBoss.statEquivalence);
  assert.ok(Math.abs(withCollector.fullBoss.details.fullBossSkillFinalDamage - 81.65108) < 1e-9);
  assert.equal(withCollector.fullBoss.details.effectiveDopingTotals.attackMagic, 374.3);

  const diceEffect = (profile) => profile.details.activeSkillCycles
    .find(({ name }) => name === "로디드 다이스");
  const diceReading = { ...buffsOff, 공격력: 2080, LUK: 383, "AP 배분 LUK": 300 };
  const xenon = await fetchConversion({ ...diceReading, 데미지: 53 }, "제논");
  assert.equal(diceEffect(xenon.fullBoss).damage, 20);
  const xenonBase = await fetchConversion(diceReading, "제논");
  assert.deepEqual(xenon.fullBoss.statEquivalence, xenonBase.fullBoss.statEquivalence);

  const viper = await fetchConversion({ ...diceReading, "방어율 무시": 78.4 }, "바이퍼");
  assert.equal(viper.fullBoss.details.currentIgnoreDefense, 73);
  assert.equal(diceEffect(viper.fullBoss).damage, 30);
  const viperOtherReading = await fetchConversion({ ...diceReading, 데미지: 49 }, "바이퍼");
  assert.equal(viperOtherReading.fullBoss.details.currentDamage, 33);
  assert.deepEqual(viperOtherReading.fullBoss.statEquivalence, viper.fullBoss.statEquivalence);
});

test("manual 정책을 적용하고 선택 장비의 환산 요약만 응답한다", async () => {
  const url = new URL(apiRequest().url);
  url.searchParams.set("presetMode", "manual");
  for (const field of [
    "equipmentPreset",
    "hyperPreset",
    "unionPreset",
    "linkPreset",
    "abilityPreset",
  ]) {
    url.searchParams.set(field, "2");
  }
  const response = await handleCharacterConversion(
    createContext(new Request(url, { headers: { Origin: ORIGIN } })),
    {
      cache: null,
      fetchImpl: async (input) => Response.json(presetNexonPayload(new URL(input))),
      sleep: async () => {},
    },
  );
  const responseText = await response.text();
  const body = JSON.parse(responseText);

  assert.equal(response.status, 200);
  assert.equal(body.presetSelection.mode, "manual");
  assert.deepEqual(body.presetSelection.selected, {
    equipment: 2,
    hyper: 2,
    union: 2,
    link: 2,
    ability: 2,
  });
  assert.deepEqual(body.presetSelection.available.union, [1, 2]);
  assert.deepEqual(body.presetSelection.source, {
    equipment: "manual",
    hyper: "manual",
    union: "manual",
    link: "manual",
    ability: "manual",
  });
  assert.equal(body.profiles.base.details.presetSelection.mode, "active");
  assert.equal(body.profiles.fullBoss.details.presetSelection.mode, "manual");
  // 실제 Open API 문구를 사용한 장비 프리셋 차이가 보공·방무 환산에
  // 반영되어야 한다. 활성 장비의 보공 80%/방무 40% 대신 선택 장비의
  // 보공 20%/방무 30%를 적용하고, 다른 프리셋의 보공 차이도 합산한다.
  assert.equal(body.profiles.fullBoss.details.currentBossDamage, 290);
  assert.ok(
    Math.abs(body.profiles.fullBoss.details.currentIgnoreDefense - 95.3333333333) <
      1e-8,
  );
  // 세트 자료가 비어 있으면 근사 경고를 만들지 않는다. 실제 세트가
  // 있으면 알려진 장비군은 선택 프리셋 기준으로 다시 계산한다.
  assert.deepEqual(body.warnings, []);
  assert.equal(body.equipmentSummary.presetNo, 2);
  assert.equal(body.equipmentSummary.version, 12);
  assert.equal(body.equipmentSummary.items[0].name, "테스트 프리셋 모자");
  assert.equal(body.equipmentSummary.items[0].potentialGrade, "레전드리");
  assert.ok(body.equipmentSummary.items[0].potentialMainStatPercent > 0);
  // 선택한 프리셋 장비의 실제 잠재 줄은 상세 툴팁에만 안전하게 공개한다.
  assert.equal(responseText.includes("STR +120%"), true);
  assert.equal(responseText.includes("item_total_option"), false);
  assert.equal(responseText.includes(RAW_MARKER), false);
  assert.equal(responseText.includes(OCID), false);
});

test("보스 프리셋을 고르면 활성 사냥 스탯의 버프와 별개로 선택 출처를 합산한다", async () => {
  const activeCombatStats = new Set([
    "데미지", "보스 몬스터 데미지", "최종 데미지", "방어율 무시",
    "크리티컬 확률", "크리티컬 데미지", "공격력", "STR", "DEX",
  ]);
  const url = new URL(apiRequest().url);
  url.searchParams.set("presetMode", "manual");
  for (const field of ["equipmentPreset", "hyperPreset", "unionPreset", "linkPreset", "abilityPreset"]) {
    url.searchParams.set(field, "2");
  }
  const getConversion = async (temporaryBonus, mode = "manual", titleLinkDisabled = false) => {
    const endpoint = new URL(url);
    endpoint.searchParams.set("presetMode", mode);
    if (mode === "auto") {
      for (const field of ["equipmentPreset", "hyperPreset", "unionPreset", "linkPreset", "abilityPreset"]) {
        endpoint.searchParams.delete(field);
      }
    }
    const response = await handleCharacterConversion(createContext(new Request(endpoint)), {
      cache: null,
      sleep: async () => {},
      fetchImpl: async (input) => {
        const path = new URL(input);
        const payload = presetNexonPayload(path);
        if (path.pathname.endsWith("/user/union-raider")) {
          payload.union_raider_stat = ["공격 시 20%의 확률로 데미지 20% 증가"];
        }
        if (path.pathname.endsWith("/character/item-equipment")) {
          const title = {
            title_name: "테스트 전투 칭호",
            title_description: "올스탯 +20\n공격력/마력+10\n보스 몬스터 공격 시 데미지+10%",
            disable_flag: "false",
          };
          payload.title = payload.title_preset1 = title;
          payload.title_preset2 = { title_name: null, disable_flag: String(titleLinkDisabled) };
        }
        if (path.pathname.endsWith("/character/skill") && path.searchParams.get("character_skill_grade") === "0") {
          payload.character_skill = [{
            skill_name: "윈터 파워업", skill_level: 1, skill_effect: "보스 몬스터 공격 시 데미지 20% 증가",
          }];
        }
        if (path.pathname.endsWith("/character/link-skill")) {
          payload.character_link_skill_preset_2 = [{
            skill_name: "자연의 벗", skill_level: 2,
            skill_effect: "데미지 5% 증가\n일반 몬스터 20명 처치 시 30초 동안 일반 몬스터 공격 시 데미지 11% 증가",
          }];
        }
        if (path.pathname.endsWith("/character/stat")) {
          payload.final_stat.push(
            { stat_name: "최종 데미지", stat_value: "20" },
            { stat_name: "크리티컬 확률", stat_value: "90" },
          );
          for (const row of payload.final_stat) {
            if (!activeCombatStats.has(row.stat_name)) continue;
            const total = Number(row.stat_value) + temporaryBonus;
            row.stat_value = String(row.stat_name === "방어율 무시" ? Math.min(99, total) : total);
          }
        }
        return Response.json(payload);
      },
    });
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  };
  const clean = await getConversion(0);
  const hunting = await getConversion(30);
  assert.deepEqual(hunting.profiles.fullBoss.statEquivalence, clean.profiles.fullBoss.statEquivalence);
  assert.deepEqual(hunting.profiles.fullBoss.addOptionEquivalence, clean.profiles.fullBoss.addOptionEquivalence);
  assert.deepEqual(hunting.profiles.base.statEquivalence, clean.profiles.base.statEquivalence);
  const { details } = hunting.profiles.fullBoss;
  assert.equal(details.selectedStatTotals.데미지, 5);
  assert.equal(details.currentDamage, 5);
  const wildHunter = details.combatModel.effects.find(({ sourceKey }) => sourceKey === "union:wild-hunter");
  assert.equal(wildHunter.averagedModifiers.damage, 4);
  assert.equal(details.selectedBossInput.stats.데미지, 5);
  assert.equal(details.selectedStatTotals["보스 몬스터 데미지"], 110);
  assert.equal(details.currentBossDamage, 110);
  const unlinked = (await getConversion(0, "manual", true)).profiles.fullBoss.details;
  assert.equal(details.selectedStatTotals.마력 - unlinked.selectedStatTotals.마력, 10);
  assert.equal(details.rawAttack - unlinked.rawAttack, 10);
  assert.equal(unlinked.currentBossDamage, 100);
  assert.equal(details.selectedStatTotals.STR, details.currentMain);
  assert.equal(details.selectedStatTotals.공격력, details.currentAttack);
  assert.equal(details.statVerification.find(({ name }) => name === "보스 몬스터 데미지").api, 330);
  const [autoClean, autoHunting] = await Promise.all([getConversion(0, "auto"), getConversion(30, "auto")]);
  assert.deepEqual(autoHunting.presetSelection.selected, autoClean.presetSelection.selected);
  assert.deepEqual(autoHunting.profiles.fullBoss.statEquivalence, autoClean.profiles.fullBoss.statEquivalence);
  assert.deepEqual(autoHunting.profiles.fullBoss.addOptionEquivalence, autoClean.profiles.fullBoss.addOptionEquivalence);
  assert.deepEqual(autoHunting.profiles.fullBoss.details.selectedStatTotals, autoClean.profiles.fullBoss.details.selectedStatTotals);
  assert.deepEqual(autoHunting.profiles.fullBoss.details.selectedBossInput, autoClean.profiles.fullBoss.details.selectedBossInput);
  assert.deepEqual(autoHunting.profiles.fullBoss.details.combatModel.totals, autoClean.profiles.fullBoss.details.combatModel.totals);
  assert.equal(autoHunting.profiles.fullBoss.details.statVerification.find(({ name }) => name === "최종 데미지").api, 50);
});

test("/id 후 공개 스냅샷을 제한 속도·4개 이하 동시성으로 조회한다", async () => {
  const calls = [];
  let activeRequests = 0;
  let maximumConcurrency = 0;
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    activeRequests += 1;
    maximumConcurrency = Math.max(maximumConcurrency, activeRequests);
    try {
      await new Promise((resolve) => setTimeout(resolve, 2));
      calls.push({
        url,
        apiKey: new Headers(init?.headers).get("x-nxopen-api-key"),
        redirect: init?.redirect,
      });
      return Response.json(nexonPayload(url));
    } finally {
      activeRequests -= 1;
    }
  };

  const cache = new MemoryCache();
  const waitUntilPromises = [];
  const request = apiRequest();
  const response = await handleCharacterConversion(
    createContext(request, waitUntilPromises),
    { cache, fetchImpl, sleep: async () => {}, timeoutMs: 1_000 },
  );
  const responseText = await response.text();
  const body = JSON.parse(responseText);
  await Promise.all(waitUntilPromises);

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.character, {
    name: "테스트",
    world: "스카니아",
    level: 270,
    className: "히어로",
    image: "https://example.com/character.png",
  });
  assert.deepEqual(body.warnings, []);
  assert.equal(body.equipmentSummary.items[0].name, "테스트 모자");
  assert.equal(body.equipmentSummary.items[0].icon, "https://example.com/hat.png");
  assert.deepEqual(body.equipmentSummary.items[0].tooltip, {
    starforce: 22,
    exceptionalUpgrade: null,
      gender: "공용",
      description: "테스트용 모자",
      equipmentLevelIncrease: 0,
      growthLevel: 3,
    specialRingLevel: null,
    cuttableCount: 5,
    options: [
      {
        key: "str",
        label: "STR",
        unit: "",
        total: 1000,
        base: null,
        add: 80,
        etc: null,
        starforce: null,
        exceptional: null,
      },
      {
        key: "dex",
        label: "DEX",
        unit: "",
        total: 500,
        base: null,
        add: 20,
        etc: null,
        starforce: null,
        exceptional: null,
      },
      {
        key: "all_stat",
        label: "올스탯",
        unit: "%",
        total: null,
        base: null,
        add: 5,
        etc: null,
        starforce: null,
        exceptional: null,
      },
      {
        key: "attack_power",
        label: "공격력",
        unit: "",
        total: null,
        base: null,
        add: 5,
        etc: null,
        starforce: null,
        exceptional: null,
      },
    ],
    potentialLines: [
      "STR +100%",
      "크리티컬 데미지 +8%",
      "보스 몬스터 공격 시 데미지 +40%",
    ],
    additionalPotentialLines: [
      "공격력 +50%",
      "STR +10",
      "스킬 재사용 대기시간 -2초",
    ],
    scroll: {
      upgraded: 8,
      upgradeable: 1,
      recoverable: 0,
      goldenHammerApplied: true,
    },
    soulName: null,
    soulOption: null,
    soulActive: null,
    soulAttack: null,
    soulMagic: null,
    soulPotentialGrade: null,
    soulAmplification: null,
    soulPotentialLines: [],
  });
  assert.equal(body.equipmentSummary.items[0].potentialMainStatPercent, 100);
  assert.ok(body.equipmentSummary.items[0].additionalMainStatPercent > 0);
  assert.equal(
    body.equipmentSummary.items[0].potentialSummary.bossDamagePercent,
    40,
  );
  assert.equal(
    body.equipmentSummary.items[0].potentialSummary.criticalDamagePercent,
    8,
  );
  assert.equal(body.equipmentSummary.items[0].itemLevel, null);
  assert.equal(
    body.equipmentSummary.items[0].additionalPotentialSummary.attackMagicPercent,
    50,
  );
  assert.equal(
    body.equipmentSummary.items[0].additionalPotentialSummary.cooldownSeconds,
    2,
  );
  assert.ok(body.equipmentSummary.items[0].addOptionScore > 0);
  const weaponSummary = body.equipmentSummary.items.find(
    ({ name }) => name === "테스트 무기",
  );
  assert.equal(weaponSummary.weaponFlameTier, 1);
  assert.equal(weaponSummary.weaponBaseAttack, 280);
  assert.equal(weaponSummary.itemLevel, 250);
  assert.equal(weaponSummary.flameAdvantaged, true);
  assert.ok(weaponSummary.weaponAddOptionPercent > 0);
  assert.equal(weaponSummary.potentialSummary.attackMagicPercent, 12);
  assert.equal(weaponSummary.potentialSummary.bossDamagePercent, 40);
  assert.equal(weaponSummary.potentialSummary.ignoreDefensePercent, 40);
  assert.equal(weaponSummary.tooltip.exceptionalUpgrade, 1);
  assert.deepEqual(
    weaponSummary.tooltip.options
      .filter((option) => option.exceptional !== null)
      .map(({ key, exceptional }) => [key, exceptional]),
    [
      ["str", 20],
      ["dex", 20],
      ["int", 20],
      ["luk", 20],
      ["max_hp", 1000],
      ["max_mp", 1000],
      ["attack_power", 15],
      ["magic_power", 15],
    ],
  );
  const spellbookSummary = body.equipmentSummary.items.find(
    ({ name }) => name === "저주받은 적의 마도서",
  );
  assert.equal(spellbookSummary.itemLevel, 160);
  assert.equal(spellbookSummary.flameAdvantaged, true);
  assert.ok(spellbookSummary.addOptionScore > 0);
  assert.equal(spellbookSummary.tooltip.exceptionalUpgrade, 2);
  const cupSummary = body.equipmentSummary.items.find(
    ({ name }) => name === "핑크빛 성배",
  );
  assert.equal(cupSummary.itemLevel, 140);
  assert.equal(cupSummary.flameAdvantaged, true);
  assert.ok(cupSummary.addOptionScore > 0);
  assert.equal(cupSummary.tooltip.exceptionalUpgrade, null);
  for (const name of [
    "죽음의 맹세",
    "굶주리는 핏빛 원혼",
    "근원의 속삭임",
    "황홀한 악몽",
    "불멸의 유산",
    "오만의 원죄",
  ]) {
    const summary = body.equipmentSummary.items.find((item) => item.name === name);
    assert.equal(summary.flameAdvantaged, true, `${name}은 보스 추가옵션 장비입니다.`);
    assert.equal(summary.itemLevel, 250);
    assert.ok(summary.addOptionScore > 0);
  }
  assert.equal(body.presetSelection.mode, "auto");
  assert.equal(body.presetSelection.approximate, true);
  assert.deepEqual(body.presetSelection.warnings, body.warnings);
  assert.equal(body.attribution, "Data based on NEXON Open API");
  assert.equal(
    response.headers.get("X-Data-Attribution"),
    "Data based on NEXON Open API",
  );
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=600");
  assert.equal(
    response.headers.get("X-Conversion-Version"),
    characterConversionCacheVersion,
  );
  assert.equal(body.dataFreshness.source, "nexon");
  assert.match(body.dataFreshness.fetchedAt, /^\d{4}-\d{2}-\d{2}T/u);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);

  for (const profileName of ["base", "fullBoss"]) {
    const profile = body.profiles[profileName];
    assert.equal(profile.mainStat, "STR");
    assert.equal(profile.subStat, "DEX");
    assert.deepEqual(profile.subStats, ["DEX"]);
    assert.equal(profile.attackType, "attack");
    assert.ok(profile.statEquivalence.currentIgnoreDefense >= 0);
    assert.ok(profile.statEquivalence.currentIgnoreDefense <= 1);
    assert.ok(profile.statEquivalence.oneMainPercentRelative > 0);
  }
  assert.equal(
    body.profiles.fullBoss.details.externalComponents.cashEquipment.flatMain,
    30,
  );
  assert.equal(
    body.profiles.fullBoss.details.externalComponents.cashEquipment.displaySummary,
    "공·마 +15 · ALL +30 · HP/MP +1,750",
  );
  assert.deepEqual(
    body.profiles.fullBoss.details.externalComponents.cashEquipment.displayItems,
    ["테스트 전투복 · 공·마 +15 · ALL +30 · HP/MP +1,750"],
  );
  assert.equal(
    body.profiles.fullBoss.details.externalComponents.cashEquipment.masterLabelPlus,
    "마스터라벨 전투 플러스 1",
  );
  assert.equal(
    body.profiles.fullBoss.details.externalComponents.petEquipment.activeFlatAttack,
    10,
  );
  assert.equal(
    body.profiles.fullBoss.details.externalComponents.petEquipment.selectedFlatAttack,
    44,
  );
  assert.equal(
    body.profiles.fullBoss.details.externalComponents.petEquipment.passiveFlatAttack,
    30,
  );
  assert.equal(
    body.profiles.fullBoss.details.externalComponents.otherStat.flatMain,
    140,
  );

  assert.equal(calls.length, EXPECTED_PUBLIC_SNAPSHOT_CALLS);
  assert.ok(maximumConcurrency > 1);
  assert.ok(maximumConcurrency <= 4);
  assert.equal(calls[0].url.pathname, "/maplestory/v1/id");
  assert.equal(
    calls[0].url.searchParams.get("character_name"),
    "테스트",
  );
  assert.equal(
    calls.some(({ url }) => url.pathname.includes("/character/list")),
    false,
  );
  assert.deepEqual(
    calls
      .filter(({ url }) => url.pathname.endsWith("/character/skill"))
      .map(({ url }) => url.searchParams.get("character_skill_grade")),
    EXPECTED_CHARACTER_SKILL_GRADES,
  );
  assert.equal(
    calls.some(({ url }) => url.pathname.endsWith("/user/union-champion")),
    true,
  );
  assert.equal(
    calls.some(({ url }) => url.pathname.endsWith("/character/vmatrix")),
    true,
  );
  assert.equal(
    calls.some(({ url }) => url.pathname.endsWith("/character/hexamatrix")),
    true,
  );
  assert.equal(
    calls.some(({ url }) =>
      url.pathname.endsWith("/character/ring-reserve-skill-equipment")
    ),
    true,
  );
  assert.equal(
    calls.some(({ url }) =>
      url.pathname.endsWith("/character/cashitem-equipment")
    ),
    true,
  );
  assert.equal(
    calls.some(({ url }) => url.pathname.endsWith("/character/pet-equipment")),
    true,
  );
  assert.equal(
    calls.some(({ url }) => url.pathname.includes("/battle-practice/")),
    false,
  );
  assert.equal(calls.every(({ apiKey }) => apiKey === API_KEY), true);
  assert.equal(calls.every(({ redirect }) => redirect === "manual"), true);
  assert.equal(responseText.includes(API_KEY), false);
  assert.equal(responseText.includes(OCID), false);
  assert.equal(responseText.includes(RAW_MARKER), false);

  const callsBeforeCacheHit = calls.length;
  const cachedResponse = await handleCharacterConversion(
    createContext(request),
    {
      cache,
      fetchImpl: async () => {
        throw new Error("A cache hit must not call NEXON API.");
      },
    },
  );
  assert.equal(cachedResponse.status, 200);
  assert.equal((await cachedResponse.json()).ok, true);
  assert.equal(calls.length, callsBeforeCacheHit);

  const refreshUrl = new URL(request.url);
  refreshUrl.searchParams.set("refresh", "1");
  let refreshCalls = 0;
  const refreshedResponse = await handleCharacterConversion(
    createContext(new Request(refreshUrl, { headers: request.headers }), waitUntilPromises),
    {
      cache,
      fetchImpl: async (input) => {
        refreshCalls += 1;
        return Response.json(nexonPayload(new URL(input)));
      },
      sleep: async () => {},
      timeoutMs: 1_000,
    },
  );
  assert.equal(refreshedResponse.status, 200);
  assert.equal(refreshCalls, callsBeforeCacheHit);
});

test("길드 노블 조회를 다른 공개 스냅샷과 겹쳐 처리한다", async () => {
  const callPaths = [];
  let activeRequests = 0;
  let maximumConcurrency = 0;
  const response = await handleCharacterConversion(
    createContext(apiRequest()),
    {
      cache: null,
      fetchImpl: async (input) => {
        const url = new URL(input);
        const path = url.pathname.replace("/maplestory/v1", "");
        callPaths.push(path);
        activeRequests += 1;
        maximumConcurrency = Math.max(maximumConcurrency, activeRequests);
        try {
          if (path === "/guild/id") {
            return Response.json({ oguild_id: "private-guild-id" });
          }
          if (path === "/guild/basic") {
            return Response.json({ guild_noblesse_skill: [] });
          }
          if (path !== "/id" && path !== "/character/basic") {
            await new Promise((resolve) => setTimeout(resolve, 3));
          }
          const payload = nexonPayload(url);
          return Response.json(path === "/character/basic"
            ? { ...payload, character_guild_name: "테스트길드" }
            : payload);
        } finally {
          activeRequests -= 1;
        }
      },
      sleep: async () => {},
      timeoutMs: 1_000,
    },
  );

  assert.equal(response.status, 200);
  assert.equal(callPaths.length, EXPECTED_PUBLIC_SNAPSHOT_CALLS + 2);
  assert.equal(callPaths.filter((path) => path === "/guild/id").length, 1);
  assert.equal(callPaths.filter((path) => path === "/guild/basic").length, 1);
  assert.ok(callPaths.indexOf("/guild/id") < callPaths.lastIndexOf("/character/skill"));
  assert.ok(maximumConcurrency > 1);
  assert.ok(maximumConcurrency <= 4);
});

test("서비스 키 조회는 길드·429 재시도를 포함해 간격을 유지하고 불필요한 초 단위 대기를 없앤다", async () => {
  const originalDateNow = Date.now;
  let currentTime = 1_000_000;
  const requestStartedAt = [];
  let retriedSkill = false;
  Date.now = () => currentTime;
  try {
    const response = await handleCharacterConversion(
      createContext(apiRequest()),
      {
        cache: null,
        fetchImpl: async (input) => {
          const url = new URL(input);
          requestStartedAt.push(currentTime);
          if (url.pathname.endsWith("/guild/id")) {
            return Response.json({ oguild_id: "private-guild-id" });
          }
          if (url.pathname.endsWith("/guild/basic")) {
            return Response.json({ guild_noblesse_skill: [] });
          }
          if (
            !retriedSkill && url.pathname.endsWith("/character/skill") &&
            url.searchParams.get("character_skill_grade") === "0"
          ) {
            retriedSkill = true;
            return Response.json(
              {},
              { status: 429, headers: { "Retry-After": "0" } },
            );
          }
          const payload = nexonPayload(url);
          return Response.json(url.pathname.endsWith("/character/basic")
            ? { ...payload, character_guild_name: "테스트길드" }
            : payload);
        },
        sleep: async (milliseconds) => {
          currentTime += milliseconds;
        },
      },
    );
    assert.equal(response.status, 200);
  } finally {
    Date.now = originalDateNow;
  }

  assert.equal(retriedSkill, true);
  assert.equal(requestStartedAt.length, EXPECTED_PUBLIC_SNAPSHOT_CALLS + 3);
  for (let index = 1; index < requestStartedAt.length; index += 1) {
    assert.ok(
      requestStartedAt[index] - requestStartedAt[index - 1] >= 20,
      `요청 ${index + 1}의 시작 간격이 20ms보다 짧습니다: ${
        JSON.stringify(requestStartedAt)
      }`,
    );
  }
  assert.ok(
    requestStartedAt.at(-1) - requestStartedAt[0] < 1_000,
    "즉시 응답하는 API에서도 개발 키의 8초 대기 시간이 남아 있습니다.",
  );
});

test("프리셋이 달라도 공개 원본 스냅샷을 재사용한다", async () => {
  const cache = new MemoryCache();
  const waitUntilPromises = [];
  let upstreamCalls = 0;
  const initialResponse = await handleCharacterConversion(
    createContext(apiRequest(), waitUntilPromises),
    {
      cache,
      fetchImpl: async (input) => {
        upstreamCalls += 1;
        return Response.json(presetNexonPayload(new URL(input)));
      },
      sleep: async () => {},
    },
  );
  assert.equal(initialResponse.status, 200);
  assert.equal(upstreamCalls, EXPECTED_PUBLIC_SNAPSHOT_CALLS);
  await Promise.all(waitUntilPromises);

  const manualUrl = new URL(apiRequest().url);
  manualUrl.searchParams.set("presetMode", "manual");
  for (const field of [
    "equipmentPreset",
    "hyperPreset",
    "unionPreset",
    "linkPreset",
    "abilityPreset",
  ]) {
    manualUrl.searchParams.set(field, "2");
  }
  const manualResponse = await handleCharacterConversion(
    createContext(new Request(manualUrl, { headers: { Origin: ORIGIN } })),
    {
      cache,
      fetchImpl: async () => {
        throw new Error("A shared snapshot hit must not call NEXON API.");
      },
      sleep: async () => {},
    },
  );
  const manualBody = await manualResponse.json();
  assert.equal(manualResponse.status, 200);
  assert.equal(manualBody.presetSelection.mode, "manual");
  assert.equal(manualBody.equipmentSummary.presetNo, 2);
  assert.equal(upstreamCalls, EXPECTED_PUBLIC_SNAPSHOT_CALLS);
});

test("손상된 원본 캐시는 사용하지 않고 NEXON에서 다시 조회한다", async () => {
  const cache = new MemoryCache();
  const request = apiRequest();
  await cache.put(
    createSnapshotCacheKey(request, "테스트", "fresh"),
    Response.json({
      version: characterSnapshotCacheVersion,
      fetchedAt: Date.now(),
      data: { character: {}, snapshot: { skillData: [] } },
    }),
  );
  let calls = 0;
  const response = await handleCharacterConversion(
    createContext(request),
    {
      cache,
      fetchImpl: async (input) => {
        calls += 1;
        return Response.json(nexonPayload(new URL(input)));
      },
      sleep: async () => {},
    },
  );
  assert.equal(response.status, 200);
  assert.equal(calls, EXPECTED_PUBLIC_SNAPSHOT_CALLS);
  assert.equal((await response.json()).dataFreshness.source, "nexon");
});

test("스킬 등급 하나가 빠진 원본 캐시는 사용하지 않는다", async () => {
  const cache = new MemoryCache();
  const waitUntilPromises = [];
  const request = apiRequest();
  const initial = await handleCharacterConversion(
    createContext(request, waitUntilPromises),
    {
      cache,
      fetchImpl: async (input) => Response.json(nexonPayload(new URL(input))),
      sleep: async () => {},
      now: () => 1_000_000,
    },
  );
  assert.equal(initial.status, 200);
  await Promise.all(waitUntilPromises);

  const freshKey = createSnapshotCacheKey(request, "테스트", "fresh");
  const staleKey = createSnapshotCacheKey(request, "테스트", "stale");
  const cachedSnapshot = await (await cache.match(freshKey)).json();
  cachedSnapshot.data.snapshot.skillData.pop();
  await cache.put(freshKey, Response.json(cachedSnapshot));
  cache.delete(staleKey);
  cache.delete(createCacheKey(request, "테스트", { mode: "auto" }));

  let calls = 0;
  const response = await handleCharacterConversion(
    createContext(request),
    {
      cache,
      fetchImpl: async (input) => {
        calls += 1;
        return Response.json(nexonPayload(new URL(input)));
      },
      sleep: async () => {},
      now: () => 1_000_001,
    },
  );
  assert.equal(response.status, 200);
  assert.equal(calls, EXPECTED_PUBLIC_SNAPSHOT_CALLS);
  assert.equal((await response.json()).dataFreshness.source, "nexon");
});

test("일시적 upstream 오류만 오래된 원본으로 복구하고 강제 갱신은 실패를 알린다", async () => {
  const cache = new MemoryCache();
  const waitUntilPromises = [];
  const request = apiRequest();
  const initialResponse = await handleCharacterConversion(
    createContext(request, waitUntilPromises),
    {
      cache,
      fetchImpl: async (input) => Response.json(nexonPayload(new URL(input))),
      sleep: async () => {},
      now: () => 1_000_000,
    },
  );
  assert.equal(initialResponse.status, 200);
  await Promise.all(waitUntilPromises);

  cache.delete(createCacheKey(request, "테스트", { mode: "auto" }));
  cache.delete(createSnapshotCacheKey(request, "테스트", "fresh"));
  let attempts = 0;
  const unavailableFetch = async () => {
    attempts += 1;
    return Response.json({}, { status: 429, headers: { "Retry-After": "0" } });
  };
  const fallbackResponse = await handleCharacterConversion(
    createContext(request),
    {
      cache,
      fetchImpl: unavailableFetch,
      sleep: async () => {},
      now: () => 1_600_000,
    },
  );
  const fallbackBody = await fallbackResponse.json();
  assert.equal(fallbackResponse.status, 200);
  assert.equal(fallbackResponse.headers.get("Cache-Control"), "private, no-store");
  assert.equal(fallbackBody.dataFreshness.source, "stale-cache");
  assert.equal(
    fallbackBody.dataFreshness.fetchedAt,
    new Date(1_000_000).toISOString(),
  );
  assert.ok(fallbackBody.warnings.some((warning) =>
    warning.includes("기준 캐릭터 정보")
  ));
  assert.equal(
    await cache.match(createCacheKey(request, "테스트", { mode: "auto" })),
    undefined,
  );

  const refreshUrl = new URL(request.url);
  refreshUrl.searchParams.set("refresh", "1");
  const refreshResponse = await handleCharacterConversion(
    createContext(new Request(refreshUrl, { headers: request.headers })),
    {
      cache,
      fetchImpl: unavailableFetch,
      sleep: async () => {},
      now: () => 1_600_000,
    },
  );
  assert.equal(refreshResponse.status, 503);
  assert.equal(attempts, 6);
});

test("NEXON 4xx 계약 오류는 오래된 스냅샷으로 숨기지 않는다", async () => {
  const cache = new MemoryCache();
  const waitUntilPromises = [];
  const request = apiRequest();
  const initial = await handleCharacterConversion(
    createContext(request, waitUntilPromises),
    {
      cache,
      fetchImpl: async (input) => Response.json(nexonPayload(new URL(input))),
      sleep: async () => {},
    },
  );
  assert.equal(initial.status, 200);
  await Promise.all(waitUntilPromises);
  cache.delete(createCacheKey(request, "테스트", { mode: "auto" }));
  cache.delete(createSnapshotCacheKey(request, "테스트", "fresh"));

  const response = await handleCharacterConversion(
    createContext(request),
    {
      cache,
      fetchImpl: async (input) => {
        const url = new URL(input);
        return url.pathname.endsWith("/id")
          ? Response.json({ ocid: OCID })
          : Response.json({}, { status: 400 });
      },
      sleep: async () => {},
    },
  );
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, "NEXON_UPSTREAM_ERROR");
});

test("캐시 구현이 TTL을 무시해도 6시간이 지난 원본은 사용하지 않는다", async () => {
  const cache = new MemoryCache();
  const waitUntilPromises = [];
  const request = apiRequest();
  const fetchedAt = 1_000_000;
  const initial = await handleCharacterConversion(
    createContext(request, waitUntilPromises),
    {
      cache,
      fetchImpl: async (input) => Response.json(nexonPayload(new URL(input))),
      sleep: async () => {},
      now: () => fetchedAt,
    },
  );
  assert.equal(initial.status, 200);
  await Promise.all(waitUntilPromises);
  cache.delete(createCacheKey(request, "테스트", { mode: "auto" }));

  const response = await handleCharacterConversion(
    createContext(request),
    {
      cache,
      fetchImpl: async () => Response.json(
        {},
        { status: 429, headers: { "Retry-After": "0" } },
      ),
      sleep: async () => {},
      now: () => fetchedAt + 6 * 60 * 60 * 1_000 + 1,
    },
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "NEXON_RATE_LIMITED");
});

test("개인 연무장 조회 없이 직업 공통 연무장 프로필을 적용한다", async () => {
  const calls = [];
  const response = await handleCharacterConversion(
    createContext(apiRequest()),
    {
      cache: null,
      fetchImpl: async (input) => {
        const url = new URL(input);
        calls.push(url);
        const payload = nexonPayload(url, { className: "블래스터" });
        if (
          url.pathname.endsWith("/character/skill") &&
          url.searchParams.get("character_skill_grade") === "6"
        ) {
          return Response.json({
            character_skill: [
              {
                skill_name: "벙커 버스터",
                skill_description: "적을 공격하는 스킬",
                skill_effect: "몬스터 방어율 60%를 추가 무시",
              },
              {
                skill_name: "릴리즈 파일 벙커 VI",
                skill_description: "적을 공격하는 스킬",
                skill_effect: "몬스터 방어율 60%를 추가 무시",
              },
            ],
          });
        }
        return Response.json(payload);
      },
      sleep: async () => {},
    },
  );
  const responseText = await response.text();
  const body = JSON.parse(responseText);

  assert.equal(response.status, 200, responseText);
  const channels = body.profiles.fullBoss.details.combatModel.damageChannels;
  const weighted = channels.filter((channel) => channel.weight !== null);
  assert.ok(Math.abs(
    weighted.reduce((sum, channel) => sum + channel.weight, 0) - 1,
  ) < 1e-12);
  assert.ok(weighted.some((channel) => channel.source === "벙커 버스터"));
  assert.ok(weighted.some((channel) => channel.source === "릴리즈 파일 벙커 VI"));
  assert.equal(
    channels[0].metadata.model,
    "battle-practice-class-generalized",
  );
  assert.match(
    body.profiles.fullBoss.details.classDamageProfile,
    /^블래스터-sustained-cycle-[a-f0-9]{12}$/u,
  );
  assert.match(
    body.profiles.fullBoss.details.classDamageProfileHash,
    /^[a-f0-9]{64}$/u,
  );
  assert.match(
    body.profiles.fullBoss.details.classDamageSkillProfileHash,
    /^[a-f0-9]{64}$/u,
  );
  const calibration =
    body.profiles.fullBoss.details.ignoreDefenseCalibration.against380;
  const confidence =
    body.profiles.fullBoss.details.classDamageProfileConfidence;
  assert.ok(confidence >= 0 && confidence <= 1);
  assert.ok(Math.abs(
    calibration.blendedToMainPercent - (
      calibration.unprofiledToMainPercent +
      (calibration.profiledToMainPercent - calibration.unprofiledToMainPercent) *
        confidence
    )
  ) < 1e-12);
  assert.ok(Math.abs(
    body.profiles.fullBoss.statEquivalence.ied40Against380ToMainPercent -
      calibration.blendedToMainPercent
  ) < 1e-12);
  assert.equal(calls.length, EXPECTED_PUBLIC_SNAPSHOT_CALLS);
  assert.equal(
    calls.some((url) => url.pathname.includes("/battle-practice/")),
    false,
  );
});

async function conversionWithCriticalRate(className, criticalRate) {
  const response = await handleCharacterConversion(
    createContext(apiRequest()),
    {
      cache: null,
      fetchImpl: async (input) => {
        const url = new URL(input);
        const payload = nexonPayload(url, { className });
        if (url.pathname.endsWith("/character/stat")) {
          payload.final_stat.push({
            stat_name: "크리티컬 확률",
            stat_value: String(criticalRate),
          });
        }
        return Response.json(payload);
      },
      sleep: async () => {},
    },
  );
  return response.json();
}

test("크확 100% 미만은 100% 환산 경고를 내고 바이퍼 조건부 보정을 구분한다", async () => {
  const hero = await conversionWithCriticalRate("히어로", 85);
  assert.equal(hero.profiles.fullBoss.details.championBlessingLevel, 5);
  assert.equal(hero.profiles.base.details.championBlessingLevel, undefined);
  assert.equal(hero.profiles.fullBoss.details.dopedCriticalRate, 85);
  assert.equal(hero.profiles.fullBoss.details.effectiveBossCriticalRate, 85);
  assert.equal(hero.profiles.fullBoss.details.criticalRateAssumedForConversion, 100);
  assert.ok(hero.warnings.some((warning) =>
    warning.includes("보스전 크리티컬 확률이 85%로 100% 미만") &&
    warning.includes("크리티컬 확률 100%를 가정")
  ));

  const viper = await conversionWithCriticalRate("바이퍼", 20);
  assert.equal(viper.profiles.fullBoss.details.dopedCriticalRate, 20);
  assert.equal(viper.profiles.fullBoss.details.effectiveBossCriticalRate, 40);
  assert.equal(viper.profiles.fullBoss.details.conditionalBossCriticalRate, 100);
  assert.ok(viper.warnings.some((warning) =>
    warning.includes("기본 크리티컬 확률이 40%로 100% 미만") &&
    warning.includes("그로기 마스터리 · 상태이상 대상에서는 100%") &&
    warning.includes("크리티컬 확률 100%를 가정")
  ));
});

test("섀도어·카데나·듀얼블레이더는 DEX와 STR을 함께 환산한다", async (t) => {
  for (const className of ["섀도어", "카데나", "듀얼블레이더"]) {
    await t.test(className, async () => {
      const response = await handleCharacterConversion(
        createContext(apiRequest({ characterName: className })),
        {
          cache: null,
          fetchImpl: async (input) =>
            Response.json(
              nexonPayload(new URL(input), {
                className,
                dualSubstats: true,
              }),
            ),
          sleep: async () => {},
        },
      );
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.character.className, className);
      for (const profileName of ["base", "fullBoss"]) {
        const profile = body.profiles[profileName];
        assert.equal(profile.mainStat, "LUK");
        assert.equal(profile.subStat, "DEX");
        assert.deepEqual(profile.subStats, ["DEX", "STR"]);
        assert.equal(profile.statModel, "standard");
        assert.equal(
          profile.statEquivalence.flatStatToFlatMainStatByStat.LUK,
          1,
        );
        assert.ok(
          profile.statEquivalence.flatStatToFlatMainStatByStat.DEX > 0,
        );
        assert.ok(
          profile.statEquivalence.flatStatToFlatMainStatByStat.STR > 0,
        );
        assert.ok(
          profile.statEquivalence.statPercentToMainPercentByStat.DEX > 0,
        );
        assert.ok(
          profile.statEquivalence.statPercentToMainPercentByStat.STR > 0,
        );
        assert.ok(profile.addOptionEquivalence.flatStatToDamagePercent.DEX > 0);
        assert.ok(profile.addOptionEquivalence.flatStatToDamagePercent.STR > 0);
      }
    });
  }
});

test("429는 세 번까지 재시도하고 키와 upstream body를 노출하지 않는다", async () => {
  let attempts = 0;
  const delays = [];
  const response = await handleCharacterConversion(createContext(apiRequest()), {
    cache: null,
    // 요청 시작 간격은 별도 테스트에서 검증하고 여기서는 429 대기만 확인한다.
    beforeRequest: async () => {},
    fetchImpl: async (input, init) => {
      attempts += 1;
      assert.equal(new URL(input).pathname, "/maplestory/v1/id");
      assert.equal(
        new Headers(init?.headers).get("x-nxopen-api-key"),
        API_KEY,
      );
      return Response.json(
        { raw_marker: RAW_MARKER },
        { status: 429, headers: { "Retry-After": "0" } },
      );
    },
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    },
  });
  const responseText = await response.text();
  const body = JSON.parse(responseText);

  assert.equal(attempts, 3);
  assert.deepEqual(delays, [100, 100]);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "2");
  assert.equal(body.ok, false);
  assert.equal(body.error.code, "NEXON_RATE_LIMITED");
  assert.equal(body.attribution, "Data based on NEXON Open API");
  assert.equal(responseText.includes(API_KEY), false);
  assert.equal(responseText.includes(RAW_MARKER), false);
});

test("잘못된 캐릭터명과 cross-origin 요청은 NEXON 호출 전에 거절한다", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return Response.json({ raw_marker: RAW_MARKER });
  };

  const invalidResponse = await handleCharacterConversion(
    createContext(apiRequest({ characterName: "!" })),
    { cache: null, fetchImpl },
  );
  const invalidBody = await invalidResponse.json();
  assert.equal(invalidResponse.status, 400);
  assert.equal(invalidBody.error.code, "INVALID_CHARACTER_NAME");
  assert.equal(invalidResponse.headers.get("Access-Control-Allow-Origin"), ORIGIN);

  const crossOriginResponse = await handleCharacterConversion(
    createContext(apiRequest({ origin: "https://example.net" })),
    { cache: null, fetchImpl },
  );
  const crossOriginBody = await crossOriginResponse.json();
  assert.equal(crossOriginResponse.status, 403);
  assert.equal(crossOriginBody.error.code, "CROSS_ORIGIN_FORBIDDEN");
  assert.equal(
    crossOriginResponse.headers.get("Access-Control-Allow-Origin"),
    null,
  );
  assert.equal(calls, 0);
});

test('공식 API의 새 소울 필드를 장비 툴팁에 전달한다', async () => {
  const response=await handleCharacterConversion(createContext(apiRequest()),{
    cache:null,sleep:async()=>{},fetchImpl:async input=>{
      const url=new URL(input),payload=nexonPayload(url);
      if(url.pathname.endsWith('/character/item-equipment')) Object.assign(payload.item_equipment.find(item=>item.item_equipment_slot==='무기'),{
        soul_name:'위대한 루시드의 소울 적용',soul_option:'공격력 +3%',soul_active:'1',
        soul_pad:'20',soul_mad:'0',soul_potential_grade:'레전드리',soul_potential_amplified_grade:2,
        soul_potential_option_1:'공격력 +4%',soul_potential_option_2:'공격력 +3%',soul_potential_option_3:'공격력 +3%',
      });
      return Response.json(payload);
    },
  });
  assert.equal(response.status,200);
  const body=await response.json(),tooltip=body.equipmentSummary.items.find(item=>item.slot==='무기').tooltip;
  assert.equal(tooltip.soulActive,true);
  assert.equal(tooltip.soulAttack,20);
  assert.equal(tooltip.soulAmplification,2);
  assert.equal(tooltip.soulPotentialGrade,'레전드리');
  assert.deepEqual(tooltip.soulPotentialLines,['공격력 +4%','공격력 +3%','공격력 +3%']);
  assert.equal(body.profiles.fullBoss.details.attackPercent,50+12+13);
});


test("윈터 파워업과 중첩 이벤트를 표시하고 기본 보공을 중복 합산하지 않는다", async () => {
  const fixture = JSON.parse(await readFile(
    new URL("../../maple-core/test/fixtures/skills-20260919.json", import.meta.url),
    "utf8",
  ));
  const expectedEvents = { "훈련 일지": 40, "아르고 호의 가호": 20, "윈터 파워업": 20 };
  const commonPassives = ["스파이더 인 미러", "크레스트 오브 더 솔라", "쓸만한 홀리 파운틴"];
  const skills = fixture.skills.filter(({ skill_name }) =>
    Object.hasOwn(expectedEvents, skill_name) || commonPassives.includes(skill_name)
  );
  skills.push({
    grade: "0",
    skill_name: "윈터 파워업",
    skill_level: 1,
    skill_effect: "보스 몬스터 공격 시 데미지 20% 증가\r\n몬스터파크 클리어 경험치 25% 증가",
  });
  const response = await handleCharacterConversion(createContext(apiRequest()), {
    cache: null,
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/character/skill")) {
        const grade = url.searchParams.get("character_skill_grade");
        return Response.json({ character_skill: skills.filter((skill) => skill.grade === grade) });
      }
      return Response.json(nexonPayload(url));
    },
    sleep: async () => {},
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  for (const { details } of [body.profiles.base, body.profiles.fullBoss]) {
    assert.equal(details.baselineSkillSummaryVersion, 2);
    const entries = details.baselineSkills;
    const events = entries.filter(({ kind }) => kind === "event");
    assert.equal(events.length, Object.keys(expectedEvents).length);
    assert.deepEqual(Object.fromEntries(events.map(({ name, effects }) =>
      [name, effects.bossDamage]
    )), expectedEvents);
    assert.deepEqual(entries.filter(({ kind }) => kind === "common-passive").map(({ name }) => name).sort(),
      [...commonPassives].sort());
    assert.ok(entries.every(({ includedInBaseline }) => includedInBaseline));
  }
  // 출처로 제공된 장비 보공 80과 이벤트 보공 80을 한 번씩 합산한다.
  assert.equal(body.profiles.base.details.currentBossDamage, 160);
  assert.equal(body.profiles.fullBoss.details.currentBossDamage, 160);
});
