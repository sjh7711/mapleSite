import assert from "node:assert/strict";
import test from "node:test";
import { marketFieldsFromCharacterEquipment, marketPotentialFromCharacter, unchangedImportedUpgrade } from "../src/shared/item-market-character.js";

test("character equipment imports independent flame/scroll stats and exact applied upgrades", () => {
  const { fields } = marketFieldsFromCharacterEquipment({ name: "에테르넬 시프반다나", potentialGrade: "레전드리",
    additionalPotentialGrade: "유니크", tooltip: { starforce: 24, cuttableCount: 5,
      options: [{ key: "luk", base: 80, add: 156, etc: 37, starforce: 159 }, { key: "all_stat", add: 4 },
        { key: "attack_power", base: 10, add: 0, etc: 72, starforce: 168 }],
      potentialLines: ["스킬 재사용 대기시간 -2초", "올스탯 +7%", "LUK +10%"],
      additionalPotentialLines: ["캐릭터 기준 9레벨 당 LUK +1", "공격력 +12", "최대 HP +5%"],
      scroll: { upgraded: 12, upgradeable: 0, recoverable: 0 } } });
  assert.equal(fields.flame.luk_flat, 156);
  assert.equal(fields.scroll.luk_flat, 37);
  assert.equal(fields.scroll.attack_flat, 72);
  assert.equal(fields.flame.all_stat_pct, 4);
  assert.equal(fields.starforce, 24);
  assert.equal(fields.scissorsRemaining, 5);
  assert.equal(fields.potential.lines[0].type, "COOLDOWN_REDUCTION:seconds");
  assert.deepEqual(fields.additional.lines[0], { type: "STAT_PER_CHARACTER_LEVEL:LUK", value: 1 });
  assert.equal(unchangedImportedUpgrade(fields).applied, 12);
  fields.scroll.attack_flat = 30;
  assert.equal(unchangedImportedUpgrade(fields), null, "manual edits must invalidate imported upgrade counts");
});
test("drop/meso and unconverted character lines are preserved or explicitly reported", () => {
  const result = marketPotentialFromCharacter("레전드리", ["메소 획득량 +20%", "아이템 드롭률 +20%", "방어력 +12%"]);
  assert.equal(result.section.lines[0].type, "MESO_OBTAINED:pct");
  assert.equal(result.section.lines[1].type, "ITEM_DROP_RATE:pct");
  assert.deepEqual(result.omitted, ["방어력 +12%"]);
});
