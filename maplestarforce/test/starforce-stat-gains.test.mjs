import assert from "node:assert/strict";
import test from "node:test";
import {
  formatStarforceStatGain,
  normalizeStarforceGrowthOptions,
  starforceStageStatGains,
  starforceStatGainRows,
  starforceStatGrowthMode,
  starforceStatGrowthModes,
  starforceTotalStatGains,
} from "../src/shared/starforce-stat-gains.js";
import { normalizeStarforceEquipment } from "../src/shared/starforce-character-equipment.js";

const item = (level, startStar, targetStar) => ({ itemLevel: level, startStar, targetStar });
const common = { id: "giant-fear" };
const total = (level, start, end, preset = common, equipped) =>
  starforceStageStatGains(item(level, start, end), preset, equipped).at(-1).cumulative;

test("레벨별 22성 공·마 수치를 실제 비무기 표본과 대조한다", () => {
  for (const [level, stats, attack] of [[140, 103, 78], [145, 103, 78], [150, 117, 85], [160, 131, 92], [200, 145, 106], [250, 159, 120]]) {
    const gain = total(level, 0, 22);
    assert.deepEqual(gain.stats, { str: stats, dex: stats, int: stats, luk: stats });
    assert.equal(gain.attack, attack);
    assert.equal(gain.magic, attack);
  }
  assert.equal(total(130, 0, 20).attack, 45);
  assert.equal(total(135, 0, 20).stats.luk, 75);
});

test("누적은 선택한 시작 성에서 계산하며 23성부터 스탯 증가가 멈춘다", () => {
  assert.deepEqual(total(250, 21, 22).stats, { str: 17, dex: 17, int: 17, luk: 17 });
  const stages = starforceStageStatGains(item(200, 21, 24), common);
  assert.equal(stages[0].gain.attack, 19);
  assert.equal(stages[1].gain.stats.str, 0);
  assert.equal(stages[2].cumulative.stats.str, 15);
  assert.equal(stages[2].cumulative.attack, 63);
  assert.equal(total(250, 0, 30).attack, 345);
});

const options = (baseSTR, scrollSTR, flameSTR = 0) => ({
  item_base_option: { str: String(baseSTR), dex: "55", int: "0", luk: "55", attack_power: "9", magic_power: "9" },
  item_etc_option: { str: String(scrollSTR), dex: "0", int: "0", luk: "80" },
  item_add_option: { str: String(flameSTR) },
});
const thief = (name, baseSTR, scrollSTR, flameSTR = 0) => ({
  name, part: /케이프/u.test(name) ? "망토" : "장갑", level: 250, starforce: 0,
  ...options(baseSTR, scrollSTR, flameSTR),
});

test("시프글러브는 STR 추옵만 있을 때와 STR 작이 있을 때를 구분한다", () => {
  const without = total(250, 0, 22, {}, thief("에테르넬 시프글러브", 0, 0, 72));
  assert.equal(without.stats.str, undefined);
  assert.equal(without.stats.dex, 159);
  const withScroll = total(250, 0, 22, {}, thief("에테르넬 시프글러브", 0, 1));
  assert.equal(withScroll.stats.str, 119);
  assert.equal(withScroll.stats.luk, 159);
  assert.equal(withScroll.attack, 127);
  assert.equal(withScroll.magic, 120);
});

test("기본 STR이 있는 시프케이프는 추옵·작 없이도 16성부터 STR이 증가한다", () => {
  const cape = thief("에테르넬 시프케이프", 50, 0);
  assert.equal(total(250, 0, 15, {}, cape).stats.str, undefined);
  const gain = total(250, 0, 22, {}, cape);
  assert.equal(gain.stats.str, 119);
  assert.equal(gain.stats.dex, 159);
  assert.equal(gain.stats.luk, 159);
});

test("이름으로 직업을 알 수 없어도 실제 SF 성분으로 주·부스탯을 구분한다", () => {
  const equipment = { name: "실제 도적 장비", part: "망토", level: 250, starforce: 22,
    growthOptions: { base: { str: 50, dex: 50, int: 50, luk: 50 }, scroll: {},
      starforce: { str: 119, dex: 159, int: 119, luk: 159 } } };
  const gain = total(250, 0, 22, {}, equipment);
  assert.deepEqual(gain.stats, { dex: 159, luk: 159, str: 119, int: 119 });
});

test("법사 장갑의 15성 이하 보너스는 마력에만 붙는다", () => {
  const glove = { name: "에테르넬 메이지글러브", part: "장갑", level: 250, starforce: 0 };
  const gain = total(250, 0, 22, {}, glove);
  assert.equal(gain.attack, 120);
  assert.equal(gain.magic, 127);
  assert.equal(total(250, 12, 15, {}, glove).magic, 3);
});

test("무기 저성 공·마는 추옵을 제외한 기본값과 작으로 계산한다", () => {
  const weapon = { name: "아케인셰이드 스태프", part: "무기", level: 200, starforce: 0,
    growthOptions: { base: { int: 70, luk: 70, attack_power: 0, magic_power: 300 }, scroll: { magic_power: 100 } } };
  const gain = total(200, 0, 2, {}, weapon);
  assert.equal(gain.magic, 18);
  assert.equal(gain.attack, 0);
  const high = total(200, 21, 22, {}, weapon);
  assert.equal(high.magic, 17);
  assert.equal(high.attack, 0);
});

test("무기에서 확정할 수 없는 저성 공·마와 지원하지 않는 장비는 수치를 꾸미지 않는다", () => {
  assert.equal(total(200, 12, 15, {}, { name: "아케인셰이드 무기", slot: "무기" }).attackUnknown, true);
  assert.equal(total(250, 25, 26, { id: "destiny-weapon", name: "데스티니" }).unavailable, true);
  assert.equal(total(150, 0, 15, {}, { name: "타일런트 망토" }).unavailable, true);
});

test("무기 정보 없이 추가한 데스티니도 제공된 12→15성 공마와 누적 수치를 표시한다", () => {
  const stages = starforceStageStatGains(item(250, 12, 25), { id: "destiny-weapon", name: "데스티니" });
  assert.deepEqual(stages.slice(0, 3).map(({ gain }) => gain.either), [12, 12, 13]);
  assert.deepEqual(stages.slice(0, 3).map(({ cumulative }) => cumulative.either), [12, 24, 37]);
  assert.ok(stages.every(({ gain, cumulative }) => !gain.attackUnknown && !cumulative.attackUnknown));
  assert.deepEqual(starforceStatGainRows(stages[2].gain, stages[2].cumulative).at(-1), { label: "공·마", step: "+13", cumulative: "+37" });
  assert.deepEqual(starforceStatGainRows(stages.at(-1).gain, stages.at(-1).cumulative).at(-1), { label: "공·마", step: "+38", cumulative: "+271" });
  assert.equal(total(250, 13, 15, { id: "destiny-weapon" }).either, 25);
  assert.equal(total(250, 14, 15, { id: "destiny-weapon" }).either, 13);
});

test("실제 데스티니 정보가 있으면 튜너 기준값 대신 그 무기의 저성 증가량을 쓴다", () => {
  const equipment = { name: "데스티니 튜너", slot: "무기", growthOptions: {
    base: { attack_power: 373, magic_power: 0 }, scroll: { attack_power: 72 },
  } };
  const stages = starforceStageStatGains(item(250, 12, 15), { id: "destiny-weapon" }, equipment);
  assert.deepEqual(stages.map(({ gain }) => gain.attack), [12, 12, 12]);
  assert.equal(stages.at(-1).cumulative.attack, 36);
});

test("묶음 장비는 일반이 기본이며 선택한 규칙은 해당 장비에만 적용된다", () => {
  const eternal = { id: "eternal-glove" }, astra = { id: "astra-secondary" };
  assert.deepEqual(starforceStatGrowthModes(eternal), [["armor", "일반"], ["glove", "장갑"]]);
  assert.deepEqual(starforceStatGrowthModes(astra), [["armor", "일반"], ["weapon", "무기"]]);
  assert.equal(starforceStatGrowthMode({}, eternal), "armor");
  assert.equal(starforceStatGrowthMode({ statGrowthMode: "weapon" }, eternal), "armor");
  assert.equal(total(250, 12, 15, eternal).attackUnknown, false);
  assert.equal(total(250, 12, 15, eternal).either, 0);
  const glove = starforceStageStatGains({ ...item(250, 12, 16), statGrowthMode: "glove" }, eternal).at(-1);
  assert.equal(glove.cumulative.either, 3);
  assert.deepEqual(starforceStatGainRows(glove.gain, glove.cumulative).at(-1), { label: "공·마", step: "+14", cumulative: "+17" });
  assert.equal(total(200, 21, 22, astra).attack, 19);
  const blade = starforceStageStatGains({ ...item(200, 21, 22), statGrowthMode: "weapon" }, astra).at(-1);
  assert.equal(blade.gain.either, 17);
  const ordinary = starforceStageStatGains({ ...item(200, 21, 22), statGrowthMode: "weapon" }, common).at(-1);
  assert.equal(ordinary.gain.attack, 19);
});

test("아케인 공통 항목에도 일반·장갑 규칙을 동일하게 선택한다", () => {
  const preset = { id: "arcane-shoulder" };
  assert.deepEqual(starforceStatGrowthModes(preset), [["armor", "일반"], ["glove", "장갑"]]);
  assert.equal(starforceStatGrowthMode({}, preset), "armor");
  assert.equal(starforceStatGrowthMode({}, preset, { part: "장갑" }), "glove");
  const normal = total(200, 12, 16, preset);
  const stage = starforceStageStatGains({ ...item(200, 12, 16), statGrowthMode: "glove" }, preset).at(-1);
  assert.equal(normal.either, 0);
  assert.equal(stage.cumulative.either, 3);
  assert.deepEqual(starforceStatGainRows(stage.gain, stage.cumulative).at(-1), { label: "공·마", step: "+12", cumulative: "+15" });
});

test("조회한 장갑·블레이드의 기본 규칙을 판별하고 명시적 선택을 우선한다", () => {
  const eternal = { id: "eternal-glove" }, astra = { id: "astra-secondary" };
  const glove = { part: "장갑" }, blade = { name: "아스트라 블레이드" };
  assert.equal(starforceStatGrowthMode({}, eternal, glove), "glove");
  assert.equal(starforceStatGrowthMode({}, astra, blade), "weapon");
  assert.equal(starforceStatGrowthMode({ statGrowthMode: "armor" }, eternal, glove), "armor");
  assert.equal(starforceStatGrowthMode({ statGrowthMode: "armor" }, astra, blade), "armor");
});

test("데스티니 22→25성은 실제 강화 화면의 +36·37·38을 적용한다", () => {
  for (const preset of [{ id: "destiny-weapon" }, {}]) {
    const stages = starforceStageStatGains(item(250, 22, 25), preset, { name: "데스티니 체인", part: "무기" });
    assert.deepEqual(stages.map(({ gain }) => gain.either), [36, 37, 38]);
    assert.deepEqual(stages.map(({ cumulative }) => cumulative.either), [36, 73, 111]);
    assert.deepEqual(stages.map(({ gain }) => gain.stats), [{ applicable: 0 }, { applicable: 0 }, { applicable: 0 }]);
  }
  const staff = { name: "데스티니 스태프", part: "무기", growthOptions: { base: { attack_power: 0, magic_power: 450 } } };
  assert.equal(total(250, 22, 25, { id: "destiny-weapon" }, staff).magic, 111);
  assert.equal(total(250, 25, 26, { id: "destiny-weapon" }).unavailable, true);
  assert.equal(total(250, 22, 25, common).attack, 75);
});

test("데스티니 튜너 15→22성은 제공된 단계별 강화 화면과 일치한다", () => {
  const tuner = { name: "데스티니 튜너", slot: "무기", growthOptions: {
    base: { str: 190, dex: 190, attack_power: 373, magic_power: 0 }, scroll: { attack_power: 81 },
  } };
  const stages = starforceStageStatGains(item(250, 15, 22), { id: "destiny-weapon" }, tuner);
  assert.deepEqual(stages.map(({ gain }) => gain.attack), [16, 16, 17, 17, 18, 19, 20]);
  assert.deepEqual(stages.map(({ gain }) => gain.stats), Array.from({ length: 7 }, () => ({ str: 17, dex: 17 })));
  assert.equal(stages.at(-1).cumulative.attack, 123);
  assert.deepEqual(stages.at(-1).cumulative.stats, { str: 119, dex: 119 });
});

test("튜너의 기본공 373·주문서공 81 조건은 제공된 12→15성 화면의 +12·12·13과 일치한다", () => {
  // 화면의 관측값은 +12/+12/+13. 기본·주문서 수치는 화면에 없어,
  // 이 조건에서 관측값을 재현하는지 검사하며 모든 데스티니에 고정하지 않는다.
  const tuner = { name: "데스티니 튜너", slot: "무기", growthOptions: {
    base: { str: 190, dex: 190, attack_power: 373, magic_power: 0 }, scroll: { attack_power: 81 },
  } };
  const stages = starforceStageStatGains(item(250, 12, 15), { id: "destiny-weapon" }, tuner);
  assert.deepEqual(stages.map(({ gain }) => gain.attack), [12, 12, 13]);
  assert.deepEqual(stages.map(({ cumulative }) => cumulative.attack), [12, 24, 37]);
  assert.deepEqual(stages.map(({ gain }) => gain.stats), Array.from({ length: 3 }, () => ({ str: 3, dex: 3 })));
});

test("공개 API의 데스티니 22·23성 SF 공격력 총합과 계산값을 교차 대조한다", () => {
  // 2026-11-02 NEXON 장비 API를 전달하는 /api/character-equipment 응답.
  // 총합 검증이며, 각 단계의 증가량을 직접 관측한 자료와는 구분한다.
  for (const [name, base, scroll, star, observed] of [
    ["데스티니 튜너", 373, 72, 22, 285],
    ["데스티니 차크람", 349, 81, 23, 316],
  ]) {
    const equipment = { name, slot: "무기", growthOptions: {
      base: { attack_power: base, magic_power: 0 }, scroll: { attack_power: scroll },
    } };
    assert.equal(total(250, 0, star, { id: "destiny-weapon" }, equipment).attack, observed);
  }
});

test("아케인·에테르넬 장갑은 같은 저성 보너스를 해당 공·마 한 줄에 합친다", () => {
  for (const [level, highAttack, name] of [[200, 106, "아케인셰이드 메이지글러브"], [250, 120, "에테르넬 메이지글러브"]]) {
    const equipment = { name, part: "장갑", level, starforce: 0 };
    const gain = total(level, 0, 22, {}, equipment);
    assert.equal(gain.magic, highAttack + 7);
    assert.equal(gain.attack, highAttack);
    assert.equal(total(level, 12, 15, {}, equipment).magic, 3);
    const rows = starforceStatGainRows(gain, gain).filter(({ label }) => label === "공·마");
    assert.deepEqual(rows, [{ label: "공·마", step: `+${highAttack + 7}`, cumulative: `+${highAttack + 7}` }]);
    assert.equal(formatStarforceStatGain(gain).filter((line) => line.startsWith("공·마")).length, 1);
  }
});

test("실제 아스트라 보조무기는 일반형과 블레이드의 증가량을 구분한다", () => {
  const normal = total(200, 21, 22, { id: "astra-secondary" }, { name: "아스트라 여의보주", part: "보조무기", level: 200 });
  assert.equal(normal.attack, 19);
  assert.equal(normal.magic, 19);
  assert.equal(normal.attackUnknown, false);
  const blade = total(200, 21, 22, { id: "astra-secondary" }, { name: "아스트라 블레이드", part: "보조무기", level: 200,
    growthOptions: { base: { str: 20, dex: 20, luk: 20, attack_power: 100, magic_power: 0 } } });
  assert.equal(blade.attack, 17);
  assert.equal(blade.magic, 0);
});

test("API·저장소를 통과해도 숫자 성분만 유지하며 추옵을 적용 조건으로 전달하지 않는다", () => {
  const raw = { name: "에테르넬 시프글러브", part: "장갑", slot: "장갑", level: 250, starforce: 17,
    ...options(0, 1, 72) };
  const [normalized] = normalizeStarforceEquipment([raw]);
  assert.equal(normalized.growthOptions.scroll.str, 1);
  assert.equal(normalized.growthOptions.flame, undefined);
  assert.deepEqual(normalizeStarforceEquipment(JSON.parse(JSON.stringify([normalized]))), [normalized]);
  assert.equal(normalizeStarforceGrowthOptions({ growthOptions: { base: { str: "NaN", dex: -1, int: Infinity } } }), null);
  assert.deepEqual(normalizeStarforceEquipment([{ ...raw, starforce_scroll_flag: "Y" }]), []);
  assert.deepEqual(normalizeStarforceEquipment([{ ...raw, starforce_scroll_flag: "사용" }]), []);
  assert.equal(normalizeStarforceEquipment([{ ...raw, starforce_scroll_flag: "미사용" }]).length, 1);
});

test("셀 표시에서 적용 능력치·다른 증가량을 합쳐 버리지 않는다", () => {
  const gain = total(250, 0, 22, {}, thief("에테르넬 시프케이프", 50, 0));
  assert.deepEqual(formatStarforceStatGain(gain), ["DEX·LUK +159", "STR +119", "공·마 +120"]);
  assert.deepEqual(formatStarforceStatGain(total(200, 22, 23)), ["공·마 +21"]);
  assert.deepEqual(formatStarforceStatGain({ unavailable: true }), ["—"]);
});

test("단계·누적 열은 라벨을 공유하고 증가가 없는 스탯도 같은 줄에 놓는다", () => {
  const stages = starforceStageStatGains(item(200, 21, 23), common);
  const second = stages[1];
  assert.deepEqual(starforceStatGainRows(second.gain, second.cumulative), [
    { label: "올스탯", step: "+0", cumulative: "+15" },
    { label: "공·마", step: "+21", cumulative: "+40" },
  ]);
});

test("도적 장비에서 단계 증가량이 같아도 누적이 다른 STR과 DEX·LUK은 나눠 표시한다", () => {
  const stage = starforceStageStatGains(item(250, 12, 16), {}, thief("에테르넬 시프케이프", 50, 0)).at(-1);
  assert.deepEqual(starforceStatGainRows(stage.gain, stage.cumulative), [
    { label: "DEX·LUK", step: "+17", cumulative: "+26" },
    { label: "STR", step: "+17", cumulative: "+17" },
    { label: "공·마", step: "+14", cumulative: "+14" },
  ]);
});

test("전체 누적은 장비별 시작~목표 상승량을 합산하고 올스탯을 중복 계산하지 않는다", () => {
  const entries = [
    { item: item(160, 12, 21), preset: { id: "magic-eyepatch" } },
    { item: item(250, 12, 21), preset: { id: "eternal-glove" } },
    { item: item(250, 12, 21), preset: { id: "destiny-weapon" } },
  ];
  assert.deepEqual(starforceTotalStatGains(entries), {
    stat: 309, attack: 314, attackUnknown: false, unavailable: false,
  });
  assert.deepEqual(starforceTotalStatGains([
    { item: item(250, 22, 25), preset: { id: "destiny-weapon" } },
  ]), { stat: 0, attack: 111, attackUnknown: false, unavailable: false });
});

test("전체 누적은 수량과 일반·장갑·무기 선택을 반영한다", () => {
  const glove = { ...item(250, 12, 21), quantity: 2 };
  const preset = { id: "eternal-glove" };
  assert.equal(starforceTotalStatGains([{ item: glove, preset }]).attack, 198);
  glove.statGrowthMode = "glove";
  assert.deepEqual(starforceTotalStatGains([{ item: glove, preset }]), {
    stat: 222, attack: 204, attackUnknown: false, unavailable: false,
  });
  assert.equal(starforceTotalStatGains([{ item: glove, preset, quantity: 3 }]).stat, 333);
  const blade = { item: { ...item(200, 21, 22), statGrowthMode: "weapon" }, preset: { id: "astra-secondary" } };
  assert.equal(starforceTotalStatGains([blade]).attack, 17);
  blade.item.statGrowthMode = "armor";
  assert.equal(starforceTotalStatGains([blade]).attack, 19);
});

test("직업별 장갑 보너스와 추가 부스탯은 각 장비에서 판정한 뒤 합산한다", () => {
  const entries = ["에테르넬 시프글러브", "에테르넬 메이지글러브"].map((name) => ({
    item: { ...item(250, 12, 16), growthEquipment: { name, part: "장갑" } },
  }));
  // 한쪽은 공격력 +17, 다른 쪽은 마력 +17. 두 장비의 보너스를 모두 포함한다.
  assert.deepEqual(starforceTotalStatGains(entries), {
    stat: 52, attack: 34, attackUnknown: false, unavailable: false,
  });
  const cape = { ...item(250, 12, 16), growthEquipment: thief("에테르넬 시프케이프", 50, 0) };
  assert.equal(starforceTotalStatGains([{ item: cape }]).stat, 26);
});

test("전체 공마도 실제 불러온 무기 정보를 사용하며 미확정 수치는 확정값으로 표시하지 않는다", () => {
  const preset = { id: "destiny-weapon" };
  const weapon = { ...item(250, 12, 15), growthEquipment: {
    name: "데스티니 튜너", slot: "무기", growthOptions: {
      base: { attack_power: 373, magic_power: 0 }, scroll: { attack_power: 72 },
    },
  } };
  assert.equal(starforceTotalStatGains([{ item: weapon, preset }]).attack, 36);
  const unknown = starforceTotalStatGains([
    { item: { ...item(200, 12, 15), statGrowthMode: "weapon" }, preset: { id: "astra-secondary" } },
    { item: item(160, 12, 21), preset: { id: "magic-eyepatch" } },
  ]);
  assert.equal(unknown.stat, 96);
  assert.equal(unknown.attackUnknown, true);
  assert.equal(unknown.unavailable, false);
  assert.equal(starforceTotalStatGains([{ item: item(250, 25, 26), preset }]).unavailable, true);
  assert.deepEqual(starforceTotalStatGains([]), { stat: 0, attack: 0, attackUnknown: false, unavailable: false });
});
