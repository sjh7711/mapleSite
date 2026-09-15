import assert from "node:assert/strict";
import test from "node:test";
import {
  maplescouterEfficiencyReference,
  primaryStatForClass,
  referenceEfficiencyRow,
} from "../scripts/lib/maplescouter-efficiency.mjs";

test("직업별 기준 스탯은 일반 직업과 특수 직업을 구분한다", () => {
  assert.equal(primaryStatForClass("렌"), "STR");
  assert.equal(primaryStatForClass("제논"), "STR");
  assert.equal(primaryStatForClass("데몬어벤져"), "HP");
});

test("최종뎀 증가율을 같은 캐릭터의 주스탯%급으로 환산한다", () => {
  const reference = maplescouterEfficiencyReference("렌", [
    { label: "보총뎀", amount: "40", finalDamagePercent: "3.484%" },
    { label: "공격력", amount: "30", finalDamagePercent: "0.439%" },
    { label: "공격력%", amount: "12", finalDamagePercent: "3.781%" },
    { label: "크댐", amount: "8", finalDamagePercent: "2.543%" },
    { label: "방무(300)", amount: "40", finalDamagePercent: "0.705%" },
    { label: "방무(380)", amount: "40", finalDamagePercent: "0.898%" },
    { label: "STR%", amount: "12", finalDamagePercent: "0.867%" },
    { label: "올스탯%", amount: "9", finalDamagePercent: "0.747%" },
  ]);
  assert.equal(reference.ok, true);
  assert.equal(reference.mainStat, "STR");
  assert.ok(Math.abs(reference.ignoreDefense380.mainStatPercent - 12.4291) < 0.001);
  assert.ok(Math.abs(reference.ignoreDefense300.mainStatPercent - 9.7578) < 0.001);
  assert.equal(reference.criticalDamage.amount, 8);
});

test("검증기에 전달할 방무 기준 행을 만든다", () => {
  const reference = maplescouterEfficiencyReference("렌", [
    { label: "방무(300)", amount: 40, finalDamagePercent: 0.7 },
    { label: "방무(380)", amount: 40, finalDamagePercent: 0.9 },
    { label: "STR%", amount: 12, finalDamagePercent: 1.2 },
  ]);
  const row = referenceEfficiencyRow({
    characterName: "테스트렌",
    characterClass: "렌",
    rank: 7,
    collectedAt: "2026-09-09T00:00:00.000Z",
    reference,
  });
  assert.ok(Math.abs(row.ied300 - 7) < 1e-9);
  assert.ok(Math.abs(row.ied380 - 9) < 1e-9);
  assert.equal(row.source, "maplescouter-browser");
  assert.equal(row.rank, 7);
});
