import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
const markup = await readFile(new URL("../index.html", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/style.css", import.meta.url), "utf8");

test("강화 목록 세 슬롯은 캐릭터 이름과 장비 응답을 각각 보관한다", () => {
  assert.match(source, /const SLOT_COUNT = 3;/u);
  assert.match(
    source,
    /const emptyCharacterSource = \(\) => \(\{[\s\S]*name: ""[\s\S]*presets: \[\][\s\S]*equipment: \[\][\s\S]*\}\);/u,
  );
  assert.match(
    source,
    /const blankCharacterSources = \(\) =>[\s\S]*Array\.from\(\{ length: SLOT_COUNT \}, \(\) => emptyCharacterSource\(\)\);/u,
  );
  assert.match(source, /characterSources: blankCharacterSources\(\)/u);
  assert.match(
    source,
    /calculatorSessionStorage\.setItem\([\s\S]*characterSources: state\.characterSources/u,
  );
  assert.doesNotMatch(source, /let characterEquipmentMatches = new Map\(\)/u);
});

test("현재 슬롯만의 캐릭터 장비 매칭과 닉네임을 읽는다", () => {
  assert.match(
    source,
    /characterEquipmentMatchesBySlot\[state\.slot\] \?\? new Map\(\)/u,
  );
  assert.match(source, /state\.characterSources\[state\.slot\]\?\.name \?\? ""/u);
  assert.match(
    source,
    /const equipped = currentCharacterMatches\(\)\.get\(preset\.id\)/u,
  );
});

test("조회 중 슬롯을 바꿔도 응답을 요청을 시작한 슬롯에만 저장한다", () => {
  assert.match(
    source,
    /async function loadCharacterEquipment\(\)[\s\S]*const slot = state\.slot;/u,
  );
  assert.match(
    source,
    /applyCharacterEquipment\(\s*slot,\s*payload\.characterName \?\? characterName,\s*payload,?\s*\)/u,
  );
  assert.match(source, /state\.characterSources\[slot\] = source/u);
  assert.match(source, /characterEquipmentMatchesBySlot\[slot\] = buildCharacterMatches\(source\)/u);
  assert.match(source, /if \(state\.slot === slot\)/u);
});

test("강화 목록 슬롯을 바꾸면 장비 강조와 캐릭터 입력 상태를 함께 다시 그린다", () => {
  assert.match(
    source,
    /const button = chip\(String\(index \+ 1\)[\s\S]*state\.slot = index;[\s\S]*renderPicker\(\);[\s\S]*renderCharacterLookup\(\);[\s\S]*renderItems\(\);/u,
  );
});

test("상단에는 1·2·3, 캐릭터 조회, 기본값과 목록 리셋만 순서대로 둔다", () => {
  assert.match(
    markup,
    /<div id="slots"[\s\S]*<form id="starforce-character"[\s\S]*<div id="bulk"[\s\S]*id="clear-items"/u,
  );
  assert.doesNotMatch(markup, />\s*강화 목록\s*</u);
  assert.match(
    markup,
    /class="starforce-character__field"[\s\S]*id="character-clear"[\s\S]*id="character-load"[\s\S]*class="starforce-character__load-icon"/u,
  );
  assert.match(
    markup,
    /id="character-clear"[\s\S]*aria-label="불러온 캐릭터 정보 초기화"[\s\S]*aria-hidden="true"[\s\S]*disabled/u,
  );
});

test("캐릭터 초기화와 목록 리셋은 현재 슬롯의 조회 정보까지 함께 지운다", () => {
  assert.match(
    source,
    /function clearCharacterEquipment\(slot = state\.slot\) \{[\s\S]*state\.characterSources\[slot\] = emptyCharacterSource\(\);[\s\S]*characterEquipmentMatchesBySlot\[slot\] = new Map\(\);[\s\S]*characterLookupStates\[slot\]\.draft = "";/u,
  );
  assert.match(
    source,
    /characterLookupStates\[slot\]\.requestId \+= 1;/u,
  );
  assert.match(
    source,
    /elements\.clearItems\.addEventListener\("click",[\s\S]*state\.items = \[\];[\s\S]*clearCharacterEquipment\(\);[\s\S]*renderPicker\(\);[\s\S]*renderCharacterLookup\(\);/u,
  );
  assert.match(
    source,
    /elements\.characterClear\.addEventListener\("click",[\s\S]*clearCharacterEquipment\(\);[\s\S]*renderPicker\(\);[\s\S]*renderCharacterLookup\(\);/u,
  );
});

test("초기화한 뒤 늦게 도착한 캐릭터 응답은 다시 적용하지 않는다", () => {
  assert.match(source, /const requestId = \+\+lookup\.requestId;/u);
  assert.match(source, /if \(lookup\.requestId !== requestId\) return;[\s\S]*applyCharacterEquipment/u);
  assert.match(source, /finally \{\s*if \(lookup\.requestId === requestId\)/u);
});

test("캐릭터 조회 중에는 상단 폭을 바꾸지 않고 필요한 영역만 갱신한다", () => {
  assert.match(
    source,
    /const hasCharacter = Boolean\(state\.characterSources\[state\.slot\]\?\.name\);[\s\S]*characterClear\.dataset\.visible = String\(hasCharacter\);/u,
  );
  assert.match(source, /if \(lookup\.loading\) \{\s*setCharacterStatus\("", "loading"\);/u);
  assert.match(
    source,
    /finally \{[\s\S]*renderPicker\(\);[\s\S]*renderCharacterLookup\(\);[\s\S]*renderCharacterEquipment\(\);/u,
  );
  assert.match(
    styles,
    /\.enhance-toolbar \.starforce-character__clear:not\(\[data-visible="true"\]\) \{[\s\S]*?visibility: hidden;[\s\S]*?pointer-events: none;/u,
  );
});

test("좁은 강화 목록은 리셋을 첫 줄에 유지하고 닉네임과 기본값을 아래에 배치한다", () => {
  assert.match(
    styles,
    /@container starforce-enhance \(max-width: 420px\) \{[\s\S]*?grid-template-areas:\s*"slots reset"\s*"character character"\s*"bulk bulk";/u,
  );
  assert.match(
    styles,
    /@container starforce-enhance \(max-width: 420px\) \{[\s\S]*?\.enhance-toolbar__left,[\s\S]*?\.enhance-toolbar__right \{\s*display: contents;/u,
  );
  assert.match(
    styles,
    /@container starforce-enhance \(max-width: 420px\) \{[\s\S]*?\.enhance-toolbar \.starforce-character__field \{[\s\S]*?flex: 1 1 auto;[\s\S]*?max-width: none;/u,
  );
  assert.match(
    styles,
    /@media \(max-width: 380px\) \{[\s\S]*?\.enhance-toolbar #bulk \{[\s\S]*?gap: 4px;[\s\S]*?padding-right: 6px;[\s\S]*?padding-left: 6px;/u,
  );
});

test("조회한 단일 장비 프리셋을 목록 위에 그리고 현재 성급부터 추가한다", () => {
  assert.match(
    markup,
    /id="character-equipment"[\s\S]*id="items"/u,
  );
  assert.match(
    source,
    /function renderCharacterEquipment\(\)[\s\S]*selectedCharacterPreset\(source\)[\s\S]*equipmentByBoardSlot\(selected\.equipment\)/u,
  );
  assert.match(
    source,
    /if \(!CHARACTER_EQUIPMENT_SLOT_NAMES\.has\(key\)\)[\s\S]*normalizeEquipmentSlot\(item\?\.part\)/u,
  );
  assert.match(
    source,
    /const canAdd =[\s\S]*Boolean\(item && preset\)[\s\S]*item\.starforce < maxStar/u,
  );
  assert.match(
    source,
    /function addItem\(presetId, equipped = null,[\s\S]*equipped\?\.starforce[\s\S]*startStar[\s\S]*state\.items\.push/u,
  );
  assert.match(
    source,
    /displayName:\s*preset\.equippedOnly &&[\s\S]*equipped\.name\.trim\(\)[\s\S]*\? equipped\.name\.trim\(\)[\s\S]*: undefined/u,
  );
  assert.match(
    source,
    /const displayName = preset\.equippedOnly\s*\? item\.displayName \|\| preset\.name\s*:\s*preset\.name;/u,
  );
  assert.match(
    source,
    /iconOf\(item\.displayIcon \? \{ icon: item\.displayIcon \} : preset\)/u,
  );
});

test("닉네임 입력은 6글자와 내부 초기화 버튼을 담고 캐릭터 이미지는 확대한다", () => {
  assert.match(
    styles,
    /\.enhance-toolbar \.starforce-character__field \{[\s\S]*?position: relative;[\s\S]*?flex: 0 0 120px;[\s\S]*?width: 120px;[\s\S]*?max-width: 120px;/u,
  );
  assert.match(
    styles,
    /\.enhance-toolbar \.starforce-character__field input \{[\s\S]*?height: 42px;/u,
  );
  assert.match(
    styles,
    /\.enhance-toolbar \.starforce-character__load \{[\s\S]*?width: 42px;[\s\S]*?height: 42px;/u,
  );
  assert.match(
    styles,
    /\.chips--slot \.chip \{[\s\S]*?height: 42px;/u,
  );
  assert.match(
    styles,
    /\.enhance-toolbar \.chips--slot \{[\s\S]*?flex-wrap: nowrap;/u,
  );
  assert.match(
    styles,
    /\.enhance-toolbar \.starforce-character__clear \{[\s\S]*?position: absolute;[\s\S]*?right: 4px;[\s\S]*?opacity: 0\.45;/u,
  );
  assert.match(
    styles,
    /\.enhance-toolbar \.starforce-character__clear:hover:not\(:disabled\) \{[\s\S]*?opacity: 1;/u,
  );
  assert.match(
    styles,
    /\.enhance-toolbar \.bulk \.dropdown__button \{[\s\S]*?height: 42px;[\s\S]*?white-space: nowrap;/u,
  );
  assert.match(
    styles,
    /\.enhance-toolbar \.bulk \.dropdown__button \{[\s\S]*?display: flex;[\s\S]*?justify-content: space-between;/u,
  );
  assert.match(
    styles,
    /@container starforce-enhance \(max-width: 680px\) \{[\s\S]*?grid-template-areas:\s*"lookup reset"\s*"bulk bulk";/u,
  );
  assert.match(
    styles,
    /\.enhance-toolbar \.bulk \.field--inline \+ \.field--inline \{[\s\S]*?margin-left: 4px;/u,
  );
  assert.match(
    styles,
    /\.enhance-toolbar \.bulk__label \{[\s\S]*?font-size: 15px;/u,
  );
  assert.match(
    styles,
    /\.enhance-toolbar \.bulk \.field--inline \{[\s\S]*?font-size: 15px;/u,
  );
  assert.match(
    styles,
    /\.enhance-toolbar__right \{\s*display: contents;/u,
  );
  assert.match(
    styles,
    /\.character-equipment__character img \{[\s\S]*?transform: scale\(2\.6\);/u,
  );
});
