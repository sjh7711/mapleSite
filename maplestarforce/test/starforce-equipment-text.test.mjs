import assert from "node:assert/strict";
import test from "node:test";
import { EQUIPMENT_PRESETS } from "../src/shared/starforce-equipment-presets.js";
import { formatEquipmentText, parseEquipmentText } from "../src/shared/starforce-equipment-text.js";

test("장비명·시작·목표만 사람이 읽는 텍스트로 복사한다", () => {
  const text = formatEquipmentText([
    { presetId: "dreamy-belt", itemLevel: 200, startStar: 12, targetStar: 21, replacementEok: 999, optimize: false, displayIcon: "https://example.com/item.png" },
    { presetId: "giant-fear", itemLevel: 200, startStar: 12, targetStar: 22 },
  ]);
  assert.equal(text, "몽벨 12-21\n거공 12-22");
  assert.deepEqual(parseEquipmentText(text), [
    { presetId: "dreamy-belt", itemLevel: 200, startStar: 12, targetStar: 21 },
    { presetId: "giant-fear", itemLevel: 200, startStar: 12, targetStar: 22 },
  ]);
  assert.doesNotMatch(text, /999|http|optimize|이벤트|MVP|PC방|대장장이/u);
});

test("모든 기본 장비와 부위별 장비를 구분하여 복원한다", () => {
  const items = EQUIPMENT_PRESETS.map((preset) => ({ presetId: preset.id, itemLevel: preset.level, startStar: 12, targetStar: 17 }));
  assert.deepEqual(parseEquipmentText(formatEquipmentText(items)), items);
  assert.match(formatEquipmentText(items), /모상하견\(상의\) 12-17/u);
});

test("제목 없이 붙여넣고 공백·윈도 줄바꿈·화살표를 허용한다", () => {
  assert.deepEqual(parseEquipmentText("\uFEFF거공   12성-22성\r\n\r\n 몽벨 0성 → 21성  "), [
    { presetId: "giant-fear", itemLevel: 200, startStar: 12, targetStar: 22 },
    { presetId: "dreamy-belt", itemLevel: 200, startStar: 0, targetStar: 21 },
  ]);
});

test("하이픈 주변 공백과 성 단위를 생략해도 같은 장비로 인식한다", () => {
  const expected = [{ presetId: "giant-fear", itemLevel: 200, startStar: 12, targetStar: 22 }];
  for (const text of ["거공 12성 - 22성", "거공 12성-22성", "거공 12-22", "거공 12 - 22", "거공 12→22"]) {
    assert.deepEqual(parseEquipmentText(text), expected, text);
  }
});

test("직접 불러온 장비는 읽을 수 있는 레벨 표기로 계산 레벨을 보존한다", () => {
  const item = { presetId: "equipped-level-150", itemLevel: 150, displayName: "파프니르 무기", startStar: 12, targetStar: 17 };
  const text = formatEquipmentText([item]);
  assert.match(text, /파프니르 무기 \(150제\) 12-17/u);
  assert.deepEqual(parseEquipmentText(text), [item]);
  const differentLevel = { presetId: "arcane-shoulder", itemLevel: 160, startStar: 17, targetStar: 22 };
  assert.deepEqual(parseEquipmentText(formatEquipmentText([differentLevel])), [differentLevel]);
});

test("수량과 중복 장비는 개별 줄로 보존한다", () => {
  const text = formatEquipmentText([{ presetId: "giant-fear", itemLevel: 200, startStar: 12, targetStar: 22, quantity: 3 }]);
  assert.equal(parseEquipmentText(text).length, 3);
});

test("데스티니는 이름·직접 장비명 모두 12성 미만 시작을 거부한다", () => {
  for (const name of ["데스티니", "데스티니 튜너 (250제)"]) {
    for (let star = 0; star < 12; star += 1) {
      assert.throws(() => parseEquipmentText(`${name} ${star}-22`), /시작 성수는 12성 이상/u);
    }
    assert.equal(parseEquipmentText(`${name} 12-22`)[0].startStar, 12);
  }
  assert.equal(parseEquipmentText("몽벨 0-22")[0].startStar, 0);
});

test("일부 오류도 전체 적용을 막으며 해당 줄과 원인을 알려준다", () => {
  for (const [row, error] of [
    ["없는장비 12성 - 22성", /2번째 줄: 알 수 없는 장비/u],
    ["135제 12성 - 21성", /2번째 줄: .*최대 목표는 20성/u],
    ["거공 22성 - 12성", /2번째 줄:/u],
    ["거공 -1성 - 22성", /2번째 줄:/u],
    ["거공 12성 - 31성", /2번째 줄:/u],
    ["이벤트: 샤타", /2번째 줄:/u],
  ]) assert.throws(() => parseEquipmentText(`몽벨 12성 - 21성\n${row}`), error);
  assert.throws(() => parseEquipmentText("[스타포스 장비목록]\n"), /입력해 주세요/u);
  assert.throws(() => formatEquipmentText([]), /먼저 추가/u);
});

test("과도한 입력과 대량 복사는 명확하게 거절한다", () => {
  assert.throws(() => parseEquipmentText("거공 12성 - 22성\n".repeat(101)), /100개/u);
  assert.throws(() => parseEquipmentText("가".repeat(16_001)), /너무 깁니다/u);
  assert.throws(() => formatEquipmentText([{ presetId: "giant-fear", itemLevel: 200, startStar: 12, targetStar: 22, quantity: 101 }]), /100개/u);
});
