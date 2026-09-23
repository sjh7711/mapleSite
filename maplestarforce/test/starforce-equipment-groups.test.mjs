import assert from "node:assert/strict";
import test from "node:test";
import { EQUIPMENT_PRESETS, equipmentGroupMembers, groupPresetsByLevel } from "../src/calc.js";
import { calculatorPresetForEquipment, startStarForPreset } from "../src/shared/starforce-character-equipment.js";
import { applyPersonalStarforcePrices, updateMatchingEquipmentPrices } from "../src/shared/starforce-equipment-prices.js";
import { buildResultSnapshot, encodeResultSnapshot, decodeResultSnapshot } from "../src/shared/result-share-state.js";

const parts = [...equipmentGroupMembers("eternal-hat"), ...equipmentGroupMembers("eternal-glove")];
const defaults = Object.fromEntries(EQUIPMENT_PRESETS.map((part) => [part.id, part.price]));
const groups = Object.fromEntries(parts.map((part) => [part.id, part.groupId]));

test("두 묶음의 일곱 부위는 개별 가격을 가지며 본 목록에는 묶음만 표시한다", () => {
  assert.deepEqual(parts.map((part) => part.name), ["모자", "상의", "하의", "견장", "장갑", "신발", "망토"]);
  assert.equal(new Set(EQUIPMENT_PRESETS.map((part) => part.id)).size, EQUIPMENT_PRESETS.length);
  assert.ok(parts.every((part) => part.level === 250 && part.icon));
  assert.deepEqual(parts.map((part) => part.price), [0.2, 0.2, 0.2, 0.2, 17.5, 17.5, 17.5]);
  const visibleIds = groupPresetsByLevel().flatMap((group) => group.presets.map((part) => part.id));
  assert.ok(visibleIds.includes("eternal-hat") && visibleIds.includes("eternal-glove"));
  assert.ok(parts.every((part) => !visibleIds.includes(part.id)));
});

test("장착 성급이 서로 달라도 캐릭터의 각 부위를 해당 가격 프리셋으로 연결한다", () => {
  const equipment = parts.map((part, index) => ({
    name: `에테르넬 테스트${part.name}`, part: part.equipmentPart, slot: part.equipmentPart,
    level: 250, starforce: 17 + index,
  }));
  for (const [index, part] of parts.entries()) {
    assert.equal(calculatorPresetForEquipment(equipment[index], EQUIPMENT_PRESETS)?.id, part.id);
    assert.equal(startStarForPreset(part, equipment, 12).startStar, 17 + index);
  }
});

test("한 부위 가격 수정은 다른 부위와 기존 묶음 및 다른 슬롯을 보존한다", () => {
  const items = [
    { presetId: "eternal-part-glove", replacementEok: 17.5 },
    { presetId: "eternal-part-glove", replacementEok: 19 },
    { presetId: "eternal-part-shoes", replacementEok: 17.5 },
    { presetId: "eternal-part-cape", replacementEok: 18 },
    { presetId: "eternal-glove", replacementEok: 22 },
  ];
  const otherSlot = structuredClone(items);
  assert.equal(updateMatchingEquipmentPrices(items, "eternal-part-glove", 28), 2);
  assert.deepEqual(items.map((item) => item.replacementEok), [28, 28, 17.5, 18, 22]);
  assert.equal(otherSlot[0].replacementEok, 17.5);
});

test("개인 가격 적용 시 예전 묶음 가격을 상속하고 개별 0원과 기본값 재설정도 존중한다", () => {
  const items = parts.map((part) => ({ presetId: part.id, replacementEok: 100 }));
  applyPersonalStarforcePrices(items, {
    "eternal-hat": 3, "eternal-glove": 25,
    "eternal-part-hat": 0, "eternal-part-glove": 17.5, "eternal-part-shoes": 29,
  }, { defaults, groups });
  assert.deepEqual(items.map((item) => item.replacementEok), [0, 3, 3, 3, 17.5, 29, 25]);
  applyPersonalStarforcePrices(items, {}, { defaults, groups });
  assert.deepEqual(items.map((item) => item.replacementEok), parts.map((part) => part.price));
});

test("공유 링크는 부위별 가격과 장비를 보존한다", async () => {
  const local = { getItem: (key) => key === "maplestarforce:v5" ? JSON.stringify({ priceOverrides: { "eternal-part-cape": 19 } }) : null };
  const item = { presetId: "eternal-part-cape", itemLevel: 250, replacementEok: 19, startStar: 17, targetStar: 22, quantity: 1 };
  const session = { getItem: (key) => key === "maplestarforce:items:v1" ? JSON.stringify({ slots: [[item], [], []], slot: 0 }) : null };
  const snapshot = buildResultSnapshot("starforce", {}, local, session);
  assert.deepEqual(await decodeResultSnapshot(await encodeResultSnapshot(snapshot), "starforce"), snapshot);
  assert.equal(snapshot.session["maplestarforce:items:v1"].slots[0][0].presetId, "eternal-part-cape");
});
