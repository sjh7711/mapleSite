import assert from "node:assert/strict";
import test from "node:test";

import {
  calculatorPresetForEquipment,
  matchStarforcePreset,
  normalizeStarforceEquipment,
  selectDisplayedEquipmentPreset,
  STARFORCE_EQUIPMENT_BOARD_SLOTS,
  startStarForPreset,
} from "../src/shared/starforce-character-equipment.js";

const preset = (id, level) => ({ id, level });
const equipped = ({
  name,
  part = "망토",
  slot = part,
  level = 250,
  starforce = 17,
} = {}) => ({ name, part, slot, level, starforce });

test("250제 에테르넬 망토를 장신망 프리셋의 시작 성급으로 연결한다", () => {
  const result = matchStarforcePreset(preset("eternal-glove", 250), [
    equipped({ name: "에테르넬 메이지케이프" }),
  ]);

  assert.equal(result.status, "matched");
  assert.equal(result.matchType, "group");
  assert.equal(result.starforce, 17);
  assert.deepEqual(result.candidates.map(({ name }) => name), [
    "에테르넬 메이지케이프",
  ]);
});

test("0성 장착 장비를 빈 값으로 취급하지 않고 그대로 보존한다", () => {
  const result = startStarForPreset(
    preset("eternal-glove", 250),
    [equipped({ name: "에테르넬 파이렛슈즈", part: "신발", starforce: "0" })],
    12,
  );

  assert.equal(result.status, "matched");
  assert.equal(result.starforce, 0);
  assert.equal(result.startStar, 0);
});

test("비어 있거나 null인 스타포스를 0성으로 오인하지 않는다", () => {
  const normalized = normalizeStarforceEquipment([
    equipped({ name: "빈 스타포스", starforce: "" }),
    equipped({ name: "null 스타포스", starforce: null }),
    equipped({ name: "정상 0성", starforce: 0 }),
  ]);

  assert.deepEqual(normalized.map(({ name }) => name), ["정상 0성"]);
});

test("135제 미만과 스타포스 비허용 부위를 자동 시작값 후보에서 제외한다", () => {
  const normalized = normalizeStarforceEquipment([
    equipped({ name: "134제 망토", level: 134 }),
    equipped({ name: "140제 엠블렘", level: 140, part: "엠블렘" }),
    equipped({ name: "140제 보조무기", level: 140, part: "보조무기" }),
    equipped({ name: "140제 뱃지", level: 140, part: "뱃지" }),
    equipped({ name: "140제 훈장", level: 140, part: "훈장" }),
    equipped({ name: "140제 포켓", level: 140, part: "포켓 아이템" }),
    equipped({ name: "140제 안드로이드", level: 140, part: "안드로이드" }),
    equipped({ name: "135제 눈장식", level: 135, part: "눈장식", starforce: 0 }),
  ]);

  assert.deepEqual(normalized.map(({ name }) => name), ["135제 눈장식"]);
});

test("스타포스 가능한 아스트라만 보조무기 예외로 허용하고 전용 프리셋에 연결한다", () => {
  const astra = equipped({
    name: "아스트라 여의보주",
    part: "여의보주",
    slot: "보조무기",
    level: 200,
    starforce: 18,
  });
  const normalized = normalizeStarforceEquipment([
    astra,
    equipped({
      name: "일반 보조무기",
      part: "방패",
      slot: "보조무기",
      level: 200,
      starforce: 18,
    }),
  ]);
  const matched = calculatorPresetForEquipment(astra, [
    preset("astra-secondary", 200),
  ]);

  assert.deepEqual(normalized.map(({ name }) => name), ["아스트라 여의보주"]);
  assert.equal(matched?.id, "astra-secondary");
});

test("장비판은 인게임처럼 벨트·에테르넬 방어구·보조무기를 배치한다", () => {
  const positions = Object.fromEntries(
    STARFORCE_EQUIPMENT_BOARD_SLOTS.map(([slot, row, column]) => [
      slot,
      [row, column],
    ]),
  );

  assert.deepEqual(positions.반지1, [1, 1]);
  assert.deepEqual(positions.반지4, [4, 1]);
  assert.deepEqual(positions.벨트, [5, 1]);
  assert.deepEqual(positions.모자, [1, 6]);
  assert.deepEqual(positions.망토, [1, 7]);
  assert.deepEqual(positions.상의, [2, 6]);
  assert.deepEqual(positions.장갑, [2, 7]);
  assert.deepEqual(positions.하의, [3, 6]);
  assert.deepEqual(positions.신발, [3, 7]);
  assert.deepEqual(positions.어깨장식, [4, 6]);
  assert.deepEqual(positions.무기, [5, 3]);
  assert.deepEqual(positions.보조무기, [5, 4]);
});

test("part가 일반값이어도 유효한 slot을 확인하고 반지 번호를 정규화한다", () => {
  const normalized = normalizeStarforceEquipment([
    equipped({
      name: "마이스터링",
      level: 140,
      part: "장신구",
      slot: "반지2",
      starforce: 18,
    }),
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].starforce, 18);
});

test("가디언 엔젤 링과 여명의 가디언 엔젤 링을 같은 정확 프리셋으로 연결한다", () => {
  const result = matchStarforcePreset(preset("gaen-ring", 160), [
    equipped({
      name: "여명의 가디언 엔젤 링",
      level: 160,
      part: "반지",
      starforce: 18,
    }),
  ]);

  assert.equal(result.status, "matched");
  assert.equal(result.matchType, "exact");
  assert.equal(result.starforce, 18);
  assert.deepEqual(result.candidates.map(({ name }) => name), [
    "여명의 가디언 엔젤 링",
  ]);
});

test("묶음 프리셋 후보가 여러 개여도 성급이 같으면 그 성급을 적용한다", () => {
  const result = matchStarforcePreset(preset("eternal-glove", 250), [
    equipped({ name: "에테르넬 나이트글러브", part: "장갑", starforce: 17 }),
    equipped({ name: "에테르넬 메이지슈즈", part: "신발", starforce: 17 }),
    equipped({ name: "에테르넬 메이지케이프", part: "망토", starforce: 17 }),
  ]);

  assert.equal(result.status, "matched");
  assert.equal(result.starforce, 17);
  assert.equal(result.candidates.length, 3);
});

test("묶음 프리셋 후보의 성급이 다르면 ambiguous로 두고 수동 기본값을 쓴다", () => {
  const result = startStarForPreset(
    preset("eternal-glove", 250),
    [
      equipped({ name: "에테르넬 나이트글러브", part: "장갑", starforce: 22 }),
      equipped({ name: "에테르넬 메이지케이프", part: "망토", starforce: 17 }),
    ],
    12,
  );

  assert.equal(result.status, "ambiguous");
  assert.equal(result.starforce, null);
  assert.equal(result.startStar, 12);
  assert.deepEqual(result.candidates.map(({ starforce }) => starforce), [22, 17]);
});

test("일치하는 장착 장비가 없으면 수동 기본 시작 성급으로 돌아간다", () => {
  const result = startStarForPreset(
    preset("eternal-glove", 250),
    [equipped({ name: "아케인셰이드 메이지케이프", level: 200 })],
    15,
  );

  assert.equal(result.status, "unmatched");
  assert.equal(result.starforce, null);
  assert.equal(result.startStar, 15);
});

test("같은 정확 장비가 중복되고 성급이 다르면 API 순서로 임의 선택하지 않는다", () => {
  const result = startStarForPreset(
    preset("meister-ring", 140),
    [
      equipped({ name: "마이스터링", level: 140, part: "반지", slot: "반지1", starforce: 17 }),
      equipped({ name: "마이스터링", level: 140, part: "반지", slot: "반지2", starforce: 22 }),
    ],
    12,
  );

  assert.equal(result.status, "ambiguous");
  assert.equal(result.startStar, 12);
});

test("세 장비 프리셋을 평탄화하며 같은 장비가 반복돼도 같은 성급이면 확정 매칭한다", () => {
  const sharedCape = equipped({
    name: "에테르넬 메이지케이프",
    part: "망토",
    slot: "망토",
    starforce: 17,
  });
  const equipmentPresets = [
    [sharedCape],
    [{ ...sharedCape }],
    [{ ...sharedCape }],
  ];
  const result = matchStarforcePreset(
    preset("eternal-glove", 250),
    equipmentPresets.flat(),
  );

  assert.equal(result.status, "matched");
  assert.equal(result.starforce, 17);
  // 중복 행 수가 아니라 서로 다른 성급 수로 모호성을 판정해야 한다.
  assert.equal(new Set(result.candidates.map(({ starforce }) => starforce)).size, 1);
});

test("세 장비 프리셋의 동일 슬롯 장비가 서로 다른 성급이면 중복 제거로 숨기지 않는다", () => {
  const equipmentPresets = [
    [equipped({ name: "에테르넬 메이지케이프", slot: "망토", starforce: 17 })],
    [equipped({ name: "에테르넬 메이지케이프", slot: "망토", starforce: 22 })],
    [equipped({ name: "에테르넬 메이지케이프", slot: "망토", starforce: 17 })],
  ];
  const result = startStarForPreset(
    preset("eternal-glove", 250),
    equipmentPresets.flat(),
    12,
  );

  assert.equal(result.status, "ambiguous");
  assert.equal(result.starforce, null);
  assert.equal(result.startStar, 12);
  assert.deepEqual(
    [...new Set(result.candidates.map(({ starforce }) => starforce))].sort(
      (left, right) => left - right,
    ),
    [17, 22],
  );
});

test("세 장비 프리셋의 서로 다른 장신망 부위가 모두 같은 성급이면 함께 확정한다", () => {
  const equipmentPresets = [
    [equipped({ name: "에테르넬 메이지글러브", part: "장갑", starforce: 18 })],
    [equipped({ name: "에테르넬 메이지슈즈", part: "신발", starforce: 18 })],
    [equipped({ name: "에테르넬 메이지케이프", part: "망토", starforce: 18 })],
  ];
  const result = matchStarforcePreset(
    preset("eternal-glove", 250),
    equipmentPresets.flat(),
  );

  assert.equal(result.status, "matched");
  assert.equal(result.starforce, 18);
  assert.deepEqual(
    new Set(result.candidates.map(({ part }) => part)),
    new Set(["장갑", "신발", "망토"]),
  );
});

test("추천 프리셋은 활성·점수보다 먼저 화면 장비로 선택한다", () => {
  const selected = selectDisplayedEquipmentPreset({
    recommendedPresetNo: 1,
    activePresetNo: 2,
    presets: [
      {
        presetNo: 1,
        equipment: [equipped({ name: "추천 망토", starforce: 10 })],
      },
      {
        presetNo: 2,
        equipment: [equipped({ name: "활성 망토", starforce: 17 })],
      },
      {
        presetNo: 3,
        equipment: [equipped({ name: "최고점 망토", starforce: 22 })],
      },
    ],
  });

  assert.equal(selected.presetNo, 1);
  assert.equal(selected.selectionReason, "recommended");
  assert.deepEqual(selected.equipment.map(({ name }) => name), ["추천 망토"]);
});

test("추천 프리셋을 쓸 수 없으면 활성 프리셋 하나만 선택한다", () => {
  const selected = selectDisplayedEquipmentPreset({
    recommendedPresetNo: 3,
    activePresetNo: "2",
    presets: [
      {
        presetNo: 1,
        equipment: [equipped({ name: "비활성 망토", starforce: 22 })],
      },
      {
        presetNo: 2,
        equipment: [equipped({ name: "활성 망토", starforce: 17 })],
      },
      // 추천 3번은 스타포스 불가 부위뿐이라 표시할 수 없다.
      {
        presetNo: 3,
        equipment: [
          equipped({ name: "추천 엠블렘", part: "엠블렘", slot: "엠블렘" }),
        ],
      },
    ],
  });

  assert.equal(selected.presetNo, 2);
  assert.equal(selected.selectionReason, "active");
  assert.deepEqual(selected.equipment.map(({ name }) => name), ["활성 망토"]);
});

test("추천·활성 정보가 없으면 스타포스 합이 유일하게 높은 한 프리셋만 고른다", () => {
  const selected = selectDisplayedEquipmentPreset({
    presets: [
      {
        presetNo: 1,
        equipment: [
          equipped({ name: "1번 망토", starforce: 17 }),
          equipped({ name: "1번 반지", part: "반지", starforce: 18 }),
        ],
      },
      {
        presetNo: 2,
        equipment: [
          equipped({ name: "2번 망토", starforce: 22 }),
          equipped({ name: "2번 반지", part: "반지", starforce: 20 }),
        ],
      },
      {
        presetNo: 3,
        equipment: [
          equipped({ name: "3번 망토", starforce: 18 }),
          // 점수에 포함되면 안 되는 134제 장비다.
          equipped({ name: "3번 저레벨", level: 134, starforce: 29 }),
        ],
      },
    ],
  });

  assert.equal(selected.presetNo, 2);
  assert.equal(selected.selectionReason, "score");
  assert.deepEqual(selected.equipment.map(({ name }) => name), [
    "2번 망토",
    "2번 반지",
  ]);
});

test("점수가 같은 서로 다른 프리셋은 섞거나 임의 선택하지 않는다", () => {
  const selected = selectDisplayedEquipmentPreset({
    presets: [
      {
        presetNo: 1,
        equipment: [equipped({ name: "1번 망토", starforce: 17 })],
      },
      {
        presetNo: 2,
        equipment: [equipped({ name: "2번 반지", part: "반지", starforce: 17 })],
      },
    ],
  });

  assert.equal(selected, null);
});

test("완전히 같은 장비 프리셋끼리 점수가 같으면 낮은 번호 하나를 안전하게 고른다", () => {
  const sameEquipment = [
    equipped({ name: "같은 망토", slot: "망토", starforce: 17 }),
  ];
  const selected = selectDisplayedEquipmentPreset({
    presets: [
      { presetNo: 2, equipment: sameEquipment },
      { presetNo: 1, equipment: sameEquipment.map((item) => ({ ...item })) },
    ],
  });

  assert.equal(selected.presetNo, 1);
  assert.equal(selected.selectionReason, "score");
  assert.deepEqual(selected.equipment.map(({ name }) => name), ["같은 망토"]);
});

test("점수 fallback은 같은 장비 API 행의 중복을 한 번만 센다", () => {
  const repeated = equipped({ name: "중복 망토", slot: "망토", starforce: 17 });
  const selected = selectDisplayedEquipmentPreset({
    presets: [
      { presetNo: 1, equipment: [repeated, { ...repeated }] },
      {
        presetNo: 2,
        equipment: [equipped({ name: "실제 최강 망토", starforce: 22 })],
      },
    ],
  });

  assert.equal(selected.presetNo, 2);
});

test("동일 슬롯 장비의 성급이 충돌한 프리셋은 점수 fallback에서 제외한다", () => {
  const selected = selectDisplayedEquipmentPreset({
    presets: [
      {
        presetNo: 1,
        equipment: [
          equipped({ name: "충돌 망토", slot: "망토", starforce: 17 }),
          equipped({ name: "충돌 망토", slot: "망토", starforce: 22 }),
        ],
      },
      {
        presetNo: 2,
        equipment: [equipped({ name: "정상 망토", starforce: 15 })],
      },
    ],
  });

  assert.equal(selected.presetNo, 2);
  assert.equal(selected.selectionReason, "score");
});

test("실제 여명의 가디언 엔젤 링을 정확 별칭으로 가엔링 프리셋에 연결한다", () => {
  const calculatorPresets = [
    preset("level-150", 150),
    preset("gaen-ring", 160),
    preset("eternal-glove", 250),
  ];
  const selected = calculatorPresetForEquipment(
    equipped({
      name: "여명의 가디언 엔젤 링",
      level: 160,
      part: "반지",
      slot: "반지2",
      starforce: 18,
    }),
    calculatorPresets,
  );

  assert.equal(selected, calculatorPresets[1]);
});

test("실제 에테르넬 망토를 유일한 장신망 그룹 프리셋에 연결한다", () => {
  const calculatorPresets = [
    preset("eternal-hat", 250),
    preset("eternal-glove", 250),
  ];
  const selected = calculatorPresetForEquipment(
    equipped({ name: "에테르넬 메이지케이프", part: "망토", starforce: 17 }),
    calculatorPresets,
  );

  assert.equal(selected, calculatorPresets[1]);
});

test("실제 장비의 묶음 매칭이 유일하지 않거나 없으면 추측하지 않는다", () => {
  const duplicateGroups = [
    preset("eternal-glove", 250),
    { ...preset("eternal-glove", 250), name: "중복 장신망" },
  ];
  const cape = equipped({
    name: "에테르넬 메이지케이프",
    part: "망토",
    starforce: 17,
  });

  assert.equal(calculatorPresetForEquipment(cape, duplicateGroups), null);
  assert.equal(
    calculatorPresetForEquipment(
      equipped({ name: "앱솔랩스 메이지케이프", level: 160 }),
      [preset("eternal-glove", 250)],
    ),
    null,
  );
});
