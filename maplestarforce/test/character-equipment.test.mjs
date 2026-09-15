import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const API_KEY = "private-test-api-key";
const OCID = "private-test-ocid";
const RAW_MARKER = "private-raw-equipment-marker";
const BASIC_RAW_MARKER = "private-basic-marker";
const PRIVATE_JOB = "비숍";
const CHARACTER_IMAGE = "https://open.api.nexon.com/character/look.png";
const ORIGIN = "https://preview.starforce.pages.dev";
const ENDPOINT_PATH = "/api/character-equipment";
const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

let temporaryDirectory;
let handleCharacterEquipment;
let parseCharacterEquipmentName;
let sanitizeStarforceEquipment;
let sanitizeStarforceEquipmentPresets;

before(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "character-equipment-test-"));
  const outfile = join(temporaryDirectory, "character-equipment.mjs");
  await build({
    entryPoints: [join(PROJECT_ROOT, "functions/api/character-equipment.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    logLevel: "silent",
  });
  ({
    handleCharacterEquipment,
    parseCharacterEquipmentName,
    sanitizeStarforceEquipment,
    sanitizeStarforceEquipmentPresets,
  } = await import(pathToFileURL(outfile).href));
});

after(async () => {
  if (temporaryDirectory) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

function equipment({
  name,
  part = "망토",
  slot = "망토",
  level = 200,
  starforce = "17",
  icon = "https://open.api.nexon.com/item.png",
  ...privateFields
}) {
  return {
    item_name: name,
    item_equipment_part: part,
    item_equipment_slot: slot,
    item_base_option: { base_equipment_level: level },
    starforce,
    item_icon: icon,
    ...privateFields,
  };
}

function apiRequest({ characterName = "레테신쫑", origin = ORIGIN } = {}) {
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

test("현재 item_equipment의 135제 이상 스타포스 가능 장비만 공개한다", () => {
  const result = sanitizeStarforceEquipment({
    item_equipment: [
      equipment({
        name: "0성 무기",
        part: "무기",
        slot: "무기",
        level: 135,
        starforce: "0",
        icon: "http://unsafe.example/item.png",
        potential_option_1: RAW_MARKER,
      }),
      // part가 비어 있지 않더라도 미지원 값이면 유효한 slot을 확인해야 한다.
      equipment({
        name: "에테르넬 메이지케이프",
        part: "방어구",
        slot: "망토",
        level: 250,
        starforce: "17",
      }),
      // 슬롯 번호는 부위 판정에서 제거한다.
      equipment({
        name: "거대한 공포",
        part: "",
        slot: "반지4",
        level: 200,
        starforce: 22,
      }),
      equipment({
        name: "아스트라 여의보주",
        part: "여의보주",
        slot: "보조무기",
        level: 200,
        starforce: 18,
      }),
      equipment({
        name: "일반 보조무기",
        part: "방패",
        slot: "보조무기",
        level: 200,
        starforce: 18,
      }),
      equipment({ name: "134제 장비", level: 134 }),
      equipment({ name: "엠블렘", part: "엠블렘", slot: "엠블렘" }),
      equipment({ name: "30성 완성 장비", starforce: "30" }),
      equipment({ name: "누락된 스타포스", starforce: null }),
      equipment({ name: "빈 스타포스", starforce: " " }),
    ],
    item_equipment_preset_1: [
      equipment({ name: "다른 프리셋 장비", starforce: "29" }),
    ],
    ocid: OCID,
    raw_marker: RAW_MARKER,
  });

  assert.deepEqual(result, [
    {
      name: "0성 무기",
      part: "무기",
      slot: "무기",
      level: 135,
      starforce: 0,
      icon: null,
    },
    {
      name: "에테르넬 메이지케이프",
      part: "방어구",
      slot: "망토",
      level: 250,
      starforce: 17,
      icon: "https://open.api.nexon.com/item.png",
    },
    {
      name: "거대한 공포",
      part: "",
      slot: "반지4",
      level: 200,
      starforce: 22,
      icon: "https://open.api.nexon.com/item.png",
    },
    {
      name: "아스트라 여의보주",
      part: "여의보주",
      slot: "보조무기",
      level: 200,
      starforce: 18,
      icon: "https://open.api.nexon.com/item.png",
    },
  ]);
  assert.equal(JSON.stringify(result).includes(RAW_MARKER), false);
  assert.equal(JSON.stringify(result).includes("다른 프리셋 장비"), false);
});

test("세 장비 프리셋을 번호와 함께 정제하고 현재 프리셋 누락 배열을 보완한다", () => {
  const result = sanitizeStarforceEquipmentPresets({
    preset_no: "2",
    item_equipment: [
      equipment({ name: "현재 2번 망토", level: 250, starforce: "17" }),
    ],
    item_equipment_preset_1: [
      equipment({ name: "1번 망토", level: 250, starforce: "15" }),
    ],
    // preset 2 배열이 빠졌으므로 현재 item_equipment로만 보완해야 한다.
    item_equipment_preset_3: [
      equipment({ name: "3번 망토", level: 250, starforce: "22" }),
    ],
    raw_marker: RAW_MARKER,
  });

  assert.equal(result.activePresetNo, 2);
  assert.deepEqual(
    result.presets.map(({ presetNo, equipment: items }) => ({
      presetNo,
      names: items.map(({ name }) => name),
    })),
    [
      { presetNo: 1, names: ["1번 망토"] },
      { presetNo: 2, names: ["현재 2번 망토"] },
      { presetNo: 3, names: ["3번 망토"] },
    ],
  );
  assert.deepEqual(
    result.equipment.map(({ name, presetNo }) => ({ name, presetNo })),
    [
      { name: "1번 망토", presetNo: 1 },
      { name: "현재 2번 망토", presetNo: 2 },
      { name: "3번 망토", presetNo: 3 },
    ],
  );
  assert.equal(JSON.stringify(result).includes(RAW_MARKER), false);
});

test("프리셋 번호가 없는 부분 응답은 현재 장비 번호를 추측하지 않는다", () => {
  const result = sanitizeStarforceEquipmentPresets({
    item_equipment: [
      equipment({ name: "현재 0성 반지", part: "반지", level: 140, starforce: "0" }),
    ],
  });

  assert.equal(result.activePresetNo, null);
  assert.deepEqual(result.presets, [
    { presetNo: 1, equipment: [] },
    { presetNo: 2, equipment: [] },
    { presetNo: 3, equipment: [] },
  ]);
  assert.deepEqual(
    result.equipment.map(({ name, starforce, presetNo }) => ({
      name,
      starforce,
      presetNo,
    })),
    [{ name: "현재 0성 반지", starforce: 0, presetNo: null }],
  );
});

test("닉네임으로 기본 정보와 세 장비 프리셋을 조회해 보스 프리셋과 정제된 이미지만 응답한다", async () => {
  const calls = [];
  const waitUntilPromises = [];
  let observedCacheKey = null;
  const response = await handleCharacterEquipment(
    createContext(apiRequest(), waitUntilPromises),
    {
      cache: {
        async match(key) {
          observedCacheKey = key;
          return undefined;
        },
        async put() {},
      },
      fetchImpl: async (input, init) => {
        const url = new URL(input);
        calls.push({
          url,
          apiKey: new Headers(init?.headers).get("x-nxopen-api-key"),
          redirect: init?.redirect,
        });
        if (url.pathname.endsWith("/id")) {
          return Response.json({ ocid: OCID, raw_marker: RAW_MARKER });
        }
        if (url.pathname.endsWith("/character/basic")) {
          assert.equal(url.searchParams.get("ocid"), OCID);
          return Response.json({
            character_name: "API 원본 이름",
            character_class: PRIVATE_JOB,
            character_level: 290,
            character_image: CHARACTER_IMAGE,
            private_value: BASIC_RAW_MARKER,
          });
        }
        if (url.pathname.endsWith("/character/item-equipment")) {
          assert.equal(url.searchParams.get("ocid"), OCID);
          return Response.json({
            preset_no: 2,
            item_equipment: [
              equipment({
                name: "에테르넬 메이지케이프",
                part: "망토",
                level: 250,
                starforce: "17",
                potential_option_1: "INT +12%",
                private_value: RAW_MARKER,
              }),
            ],
            item_equipment_preset_1: [
              equipment({
                name: "에테르넬 나이트글러브",
                part: "장갑",
                slot: "장갑",
                level: 250,
                starforce: "15",
                potential_option_1: "INT +9%",
              }),
            ],
            // 활성 2번 배열은 의도적으로 생략해 item_equipment fallback을 검증한다.
            item_equipment_preset_3: [
              equipment({
                name: "에테르넬 메이지슈즈",
                part: "신발",
                slot: "신발",
                level: 250,
                starforce: "22",
                potential_option_1: "INT +33%",
              }),
            ],
            ocid: OCID,
            raw_marker: RAW_MARKER,
          });
        }
        throw new Error(`Unexpected endpoint: ${url.pathname}`);
      },
      sleep: async () => {},
    },
  );
  await Promise.all(waitUntilPromises);
  const responseText = await response.text();
  const body = JSON.parse(responseText);

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.characterName, "레테신쫑");
  assert.equal(body.characterImage, CHARACTER_IMAGE);
  assert.equal(body.activePresetNo, 2);
  assert.equal(body.recommendedPresetNo, 3);
  assert.deepEqual(
    body.presets.map(({ presetNo, equipment: items }) => ({
      presetNo,
      names: items.map(({ name }) => name),
    })),
    [
      { presetNo: 1, names: ["에테르넬 나이트글러브"] },
      { presetNo: 2, names: ["에테르넬 메이지케이프"] },
      { presetNo: 3, names: ["에테르넬 메이지슈즈"] },
    ],
  );
  assert.deepEqual(body.equipment, [
    {
      name: "에테르넬 나이트글러브",
      part: "장갑",
      slot: "장갑",
      level: 250,
      starforce: 15,
      icon: "https://open.api.nexon.com/item.png",
      presetNo: 1,
    },
    {
      name: "에테르넬 메이지케이프",
      part: "망토",
      slot: "망토",
      level: 250,
      starforce: 17,
      icon: "https://open.api.nexon.com/item.png",
      presetNo: 2,
    },
    {
      name: "에테르넬 메이지슈즈",
      part: "신발",
      slot: "신발",
      level: 250,
      starforce: 22,
      icon: "https://open.api.nexon.com/item.png",
      presetNo: 3,
    },
  ]);
  assert.equal(body.attribution, "Data based on NEXON Open API");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=600");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), ORIGIN);
  assert.equal(
    new URL(observedCacheKey.url).searchParams.get("version"),
    "starforce-equipment-v5",
  );
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url.pathname, "/maplestory/v1/id");
  assert.equal(calls[0].url.searchParams.get("character_name"), "레테신쫑");
  assert.equal(
    calls[1].url.pathname,
    "/maplestory/v1/character/basic",
  );
  assert.equal(
    calls[2].url.pathname,
    "/maplestory/v1/character/item-equipment",
  );
  assert.equal(calls.every(({ apiKey }) => apiKey === API_KEY), true);
  assert.equal(calls.every(({ redirect }) => redirect === "manual"), true);
  assert.equal(responseText.includes(API_KEY), false);
  assert.equal(responseText.includes(OCID), false);
  assert.equal(responseText.includes(RAW_MARKER), false);
  assert.equal(responseText.includes(BASIC_RAW_MARKER), false);
  assert.equal(responseText.includes(PRIVATE_JOB), false);
});

test("이미지는 HTTPS만 공개하고 자동 판정 불가 시 활성 또는 첫 장비 프리셋으로 복구한다", async () => {
  const responses = [
    {
      basic: {
        character_class: "지원하지 않는 비공개 직업",
        character_level: 290,
        character_image: "http://unsafe.example/character.png",
      },
      equipment: {
        preset_no: "2",
        item_equipment: [equipment({ name: "현재 망토" })],
        item_equipment_preset_2: [equipment({ name: "2번 망토" })],
      },
      expectedPresetNo: 2,
    },
    {
      basic: {
        character_class: "지원하지 않는 비공개 직업",
        character_level: 290,
        character_image: "not-a-url",
      },
      equipment: {
        preset_no: "99",
        item_equipment_preset_2: [equipment({ name: "첫 유효 프리셋 망토" })],
      },
      expectedPresetNo: 2,
    },
  ];

  for (const scenario of responses) {
    const response = await handleCharacterEquipment(
      createContext(apiRequest()),
      {
        cache: null,
        fetchImpl: async (input) => {
          const url = new URL(input);
          if (url.pathname.endsWith("/id")) return Response.json({ ocid: OCID });
          if (url.pathname.endsWith("/character/basic")) {
            return Response.json(scenario.basic);
          }
          if (url.pathname.endsWith("/character/item-equipment")) {
            return Response.json(scenario.equipment);
          }
          throw new Error(`Unexpected endpoint: ${url.pathname}`);
        },
        sleep: async () => {},
      },
    );
    const responseText = await response.text();
    const body = JSON.parse(responseText);

    assert.equal(response.status, 200);
    assert.equal(body.characterImage, null);
    assert.equal(body.recommendedPresetNo, scenario.expectedPresetNo);
    assert.equal(responseText.includes("지원하지 않는 비공개 직업"), false);
    assert.equal(responseText.includes(OCID), false);
  }
});

test("기본 정보 조회만 실패해도 장비와 활성 프리셋은 계속 응답한다", async () => {
  const response = await handleCharacterEquipment(
    createContext(apiRequest()),
    {
      cache: null,
      fetchImpl: async (input) => {
        const url = new URL(input);
        if (url.pathname.endsWith("/id")) return Response.json({ ocid: OCID });
        if (url.pathname.endsWith("/character/basic")) {
          return Response.json({ error: "temporary" }, { status: 500 });
        }
        if (url.pathname.endsWith("/character/item-equipment")) {
          return Response.json({
            preset_no: 2,
            item_equipment_preset_2: [
              equipment({ name: "복구된 망토", starforce: "18" }),
            ],
          });
        }
        throw new Error(`Unexpected endpoint: ${url.pathname}`);
      },
      sleep: async () => {},
    },
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.characterImage, null);
  assert.equal(body.recommendedPresetNo, 2);
  assert.deepEqual(
    body.presets[1].equipment.map(({ name, starforce }) => ({ name, starforce })),
    [{ name: "복구된 망토", starforce: 18 }],
  );
});

test("장비 배열이 없는 upstream 응답은 원문 없이 502로 정리한다", async () => {
  const response = await handleCharacterEquipment(createContext(apiRequest()), {
    cache: null,
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/id")) return Response.json({ ocid: OCID });
      if (url.pathname.endsWith("/character/basic")) {
        return Response.json({
          character_class: PRIVATE_JOB,
          character_level: 290,
          character_image: CHARACTER_IMAGE,
        });
      }
      return Response.json({ raw_marker: RAW_MARKER, ocid: OCID });
    },
    sleep: async () => {},
  });
  const responseText = await response.text();
  const body = JSON.parse(responseText);

  assert.equal(response.status, 502);
  assert.equal(body.error.code, "NEXON_UPSTREAM_ERROR");
  assert.equal(responseText.includes(OCID), false);
  assert.equal(responseText.includes(RAW_MARKER), false);
});

test("잘못된 닉네임과 cross-origin 요청은 NEXON 호출 전에 차단한다", async () => {
  let calls = 0;
  const dependencies = {
    cache: null,
    fetchImpl: async () => {
      calls += 1;
      return Response.json({});
    },
  };

  assert.throws(
    () => parseCharacterEquipmentName(apiRequest({ characterName: "!" })),
    /캐릭터 이름/u,
  );
  const invalid = await handleCharacterEquipment(
    createContext(apiRequest({ characterName: "!" })),
    dependencies,
  );
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, "INVALID_CHARACTER_NAME");

  const crossOrigin = await handleCharacterEquipment(
    createContext(apiRequest({ origin: "https://example.net" })),
    dependencies,
  );
  assert.equal(crossOrigin.status, 403);
  assert.equal((await crossOrigin.json()).error.code, "CROSS_ORIGIN_FORBIDDEN");
  assert.equal(crossOrigin.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(calls, 0);
});
