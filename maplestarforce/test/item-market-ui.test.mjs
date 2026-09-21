import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("장비 시세 페이지가 환경별 진입점과 공용 내비게이션에 연결된다", async () => {
  const [vite, shell, html, entry, features, productionEnv, previewEnv, pkg, source, nav] = await Promise.all([
    read("../vite.config.js"),
    read("../src/shared/shell.js"),
    read("../item-market/index.html"),
    read("../src/pages/item-market-entry.js"),
    read("../src/shared/features.js"),
    read("../.env.production"),
    read("../.env.preview"),
    read("../package.json"),
    read("../src/pages/item-market.js"),
    read("../src/shared/tool-nav.js"),
  ]);

  assert.match(vite, /"item-market": resolve\(__dirname, "item-market\/index\.html"\)/u);
  assert.match(nav, /id: "item-market", name: "장비 시세"/u);
  assert.match(nav, /itemMarketEnabled \|\| tool\.id !== "item-market"/u);
  assert.match(shell, /getTools\(\{ itemMarketEnabled: ITEM_MARKET_ENABLED \}\)/u);
  assert.match(html, /page--item-market/u);
  assert.match(html, /src\/pages\/item-market-entry\.js/u);
  assert.doesNotMatch(html, /src\/pages\/item-market\.js/u);
  assert.match(entry, /if \(ITEM_MARKET_ENABLED\)/u);
  assert.match(entry, /import\("\.\/item-market\.js"\)/u);
  assert.match(entry, /window\.location\.replace\("\.\.\/"\)/u);
  assert.match(features, /VITE_ITEM_MARKET_ENABLED !== "false"/u);
  assert.match(productionEnv, /VITE_ITEM_MARKET_ENABLED=false/u);
  assert.match(previewEnv, /VITE_ITEM_MARKET_ENABLED=true/u);
  assert.match(pkg, /"build:preview": "vite build --mode preview"/u);
  assert.match(pkg, /"build:production": "vite build --mode production"/u);
  assert.match(source, /renderToolNav\(document\.querySelector\("#toolnav"\), "item-market"\)/u);
});

test("catalog에서 장비를 고르고 해당 장비 shard만 불러온다", async () => {
  const source = await read("../src/pages/item-market.js");

  assert.match(source, /loadItemMarketCatalog\(\)/u);
  assert.match(source, /loadItemMarketComparables\(itemName\)/u);
  assert.match(source, /resolveItemMarketStatPeerGroup/u);
  assert.match(source, /refreshStatPeerComparables/u);
  assert.match(source, /Promise\.allSettled\(jobs\)/u);
  assert.match(source, /loadItemMarketComparables\(peer\.item_name/u);
  assert.match(source, /market\.catalog\?\.items/u);
  assert.match(source, /const itemCache = new Map\(\)/u);
  assert.match(source, /requestSequence/u);
});

test("선택한 장비의 공용 아이콘을 표시하고 실패하면 안전하게 대체한다", async () => {
  const [source, css] = await Promise.all([
    read("../src/pages/item-market.js"),
    read("../src/calculator.css"),
  ]);

  assert.match(source, /itemMarketIconUrl/u);
  assert.match(source, /market-item-picker/u);
  assert.match(source, /function equipmentArtwork\(\)/u);
  assert.match(source, /market-equipment-layout/u);
  assert.match(source, /market-item-icon__fallback/u);
  assert.match(source, /image\.referrerPolicy = "no-referrer"/u);
  assert.match(source, /image\.addEventListener\("error"/u);
  assert.match(css, /\.page--item-market \.market-item-icon/u);
  assert.match(css, /grid-row: 1 \/ span 2/u);
  assert.match(css, /width: 76px;[\s\S]*?height: 76px;/u);
  assert.match(css, /image-rendering: pixelated/u);
});

test("장비 입력은 아이콘 옆 두 줄에 배치하고 장비명·거래 상태 폭을 맞춘다", async () => {
  const [source, css] = await Promise.all([
    read("../src/pages/item-market.js"),
    read("../src/calculator.css"),
  ]);

  assert.match(source, /field\("장비명", equipmentPicker\(\), "market-item-field"\)/u);
  assert.match(source, /"market-starforce-field"/u);
  assert.match(source, /"market-trade-field"/u);
  assert.match(source, /"market-equipment-secondary-field"/u);
  assert.match(source, /equipmentLayout\.append\(equipmentArtwork\(\), equipmentSettings\)/u);
  assert.match(css, /\.market-item-field\s*\{[\s\S]*?grid-column: 2;[\s\S]*?grid-row: 1;/u);
  assert.match(css, /\.market-starforce-field\s*\{[\s\S]*?grid-column: 3;[\s\S]*?grid-row: 1;/u);
  assert.match(css, /\.market-trade-field\s*\{[\s\S]*?grid-column: 2;[\s\S]*?grid-row: 2;/u);
  assert.match(css, /\.market-equipment-secondary-field\s*\{[\s\S]*?grid-column: 3;[\s\S]*?grid-row: 2;/u);
  assert.match(
    css,
    /\.page--item-market \.market-item-combobox\s*\{[^}]*display:\s*block;[^}]*width:\s*100%;/su,
  );
  assert.match(
    css,
    /\.page--item-market \.market-item-combobox > \.search-select__input\s*\{[^}]*width:\s*100%;/su,
  );
  assert.match(
    css,
    /\.page--item-market \.market-item-field,\s*\.page--item-market \.market-trade-field,\s*\.page--item-market \.market-trade-field > \.search-select\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/su,
  );
  assert.doesNotMatch(
    css,
    /\.page--item-market \.market-item-combobox\s*\{[^}]*grid-template-columns:/su,
  );
});

test("장비명은 검색 입력과 필터링되는 드롭다운을 함께 지원한다", async () => {
  const [source, search, component, globalCss, css] = await Promise.all([
    read("../src/pages/item-market.js"),
    read("../src/shared/item-market-search.js"),
    read("../src/shared/searchable-select.js"),
    read("../src/style.css"),
    read("../src/calculator.css"),
  ]);

  assert.match(source, /filterItemMarketCatalog/u);
  assert.match(source, /searchableSelect\(/u);
  assert.match(component, /role", "combobox"/u);
  assert.match(component, /aria-autocomplete", "list"/u);
  assert.match(source, /장비명 검색 또는 선택/u);
  assert.match(search, /normalizeItemMarketSearch\(entry\?\.name\)\.includes\(needle\)/u);
  assert.match(globalCss, /\.search-select__options/u);
  assert.match(globalCss, /max-height: min\(380px, 52dvh\)/u);
  assert.match(
    css,
    /\.page--item-market \.calculator-equipment:has\(\.market-item-combobox \.search-select__options:not\(\[hidden\]\)\)\s*\{[\s\S]*?z-index:\s*31/u,
  );
});

test("장비 입력은 스타포스·거래 상태·가위만 두고 주문서 작 수를 스탯에서 계산한다", async () => {
  const source = await read("../src/pages/item-market.js");

  assert.match(source, /스타포스/u);
  assert.doesNotMatch(source, /적용 주문서 수/u);
  assert.doesNotMatch(source, /market-upgrade-remaining/u);
  assert.doesNotMatch(source, /market-upgrade-recoverable/u);
  assert.match(source, /inferItemUpgradeSlotMaximum/u);
  assert.match(source, /inferAutomaticScrollUpgradeState/u);
  assert.match(source, /upgradeMaximum/u);
  assert.match(source, /remaining:/u);
  assert.match(source, /recoverable:/u);
  assert.doesNotMatch(source, /upgradeApplied:/u);
  assert.match(source, /"거래 상태"/u);
  assert.match(source, /"가위 잔여"/u);
  assert.doesNotMatch(source, /field\(\s*"가위 최대"/u);
  assert.doesNotMatch(source, /market-scissors-total/u);
  assert.match(source, /inferFixedScissorsMaximum/u);
  assert.doesNotMatch(source, /가위 최대 \$\{meta\.scissorsMaximum\}회 · 자동 적용/u);
  assert.match(source, /const scissorsTotal = Number\(itemMeta\.scissorsMaximum\)/u);
  assert.match(source, /state: input\.tradeState \|\| null/u);
  assert.match(source, /scissors_remaining:/u);
  assert.match(source, /scissors_total:/u);
  assert.match(source, /inferTradeDefaults\(loaded\.data\)/u);
  assert.doesNotMatch(source, /거래 상태와 가위 수는 처음 선택할 때 동일 장비 판매 표본의 대표값으로 채웁니다/u);
  assert.match(source, /Array\.from\(\{ length: 3 \}/u);
  assert.match(source, /potentialPanel\("potential", "윗잠"\)/u);
  assert.match(source, /potentialPanel\("additional", "에디셔널"\)/u);
  assert.match(source, /for \(let index = 0; index < 3; index \+= 1\)/u);
  assert.doesNotMatch(source, /최대 \$\{meta\.upgradeMaximum\}회 · 잔여/u);
  assert.doesNotMatch(source, /망토 · Lv\./u);
});

test("잠재 입력은 수집 raw와 같은 API 코드와 단위를 사용한다", async () => {
  const source = await read("../src/pages/item-market.js");

  assert.match(
    source,
    /const OPTION_TYPES = \[[\s\S]*?공격력 %[\s\S]*?마력 %[\s\S]*?몬스터 방어율 무시 %[\s\S]*?재사용 대기시간 감소[\s\S]*?크리티컬 데미지 %[\s\S]*?STR %/u,
  );

  for (const code of [
    "STR",
    "DEX",
    "INT",
    "LUK",
    "ALL_STAT",
    "HP",
    "ATTACK",
    "MAGIC_ATTACK",
    "DAMAGE",
    "BOSS_DAMAGE",
    "IGNORE_DEFENSE",
    "CRITICAL_DAMAGE",
    "ITEM_DROP_RATE",
    "MESO_OBTAINED",
    "COOLDOWN_REDUCTION",
    "STAT_PER_CHARACTER_LEVEL",
    "AUTO_STEAL",
  ]) {
    assert.match(source, new RegExp(`code: "${code}"`, "u"), `${code} 입력이 필요하다`);
  }
  assert.match(source, /levels_per_increment: 9/u);
  assert.match(source, /stat_code: spec\.stat/u);
});

test("노작값은 사용자 입력이나 스타포스 프리셋으로 고정하지 않고 시세에서 추정한다", async () => {
  const source = await read("../src/pages/item-market.js");

  assert.doesNotMatch(source, /"노작값 \(억 메소\)"/u);
  assert.doesNotMatch(source, /numericControl\("market-base-price"/u);
  assert.doesNotMatch(source, /노작값은 동일 장비의 판매 완료 시세에서 자동으로 추정/u);
  assert.match(source, /base_price_meso: null/u);
  assert.match(source, /base_price_source: "same_item_market_model"/u);
  assert.match(source, /target: expectationTarget/u);
  assert.match(source, /buildItemMarketExpectationMetadata\(itemMeta\)/u);
});

test("주문서와 추가옵션은 원본 스탯을 source별 map으로 전달한다", async () => {
  const source = await read("../src/pages/item-market.js");

  for (const key of [
    "str_flat",
    "dex_flat",
    "int_flat",
    "luk_flat",
    "hp_flat",
    "all_stat_pct",
    "attack_flat",
    "magic_attack_flat",
  ]) {
    assert.match(source, new RegExp(`key: "${key}"`, "u"), `${key} 입력이 필요하다`);
  }
  assert.match(source, /const scrollStats = itemMeta\.upgradeApplicable === false \? \{\} : compactStats\(input\.scroll\)/u);
  assert.match(source, /scroll: scrollStats/u);
  assert.match(source, /flame: itemMeta\.flameApplicable === false \? \{\} : compactStats\(input\.flame\)/u);
  assert.match(source, /"착용 레벨 감소"/u);
  assert.match(source, /required_level_reduction:/u);
  assert.match(source, /buildItemMarketExpectationMetadata\(itemMeta\)/u);
  assert.match(source, /장비의 최종 수치가 아니라 주문서와 추가옵션으로 각각 오른 수치만 입력/u);
  assert.match(source, /입력한 수치와 장비 정보를 바탕으로 제작법을 판별/u);
  assert.match(source, /statPanel\("scroll", "주문서"\)/u);
  assert.match(source, /statPanel\("flame", "추가옵션"\)/u);
  assert.doesNotMatch(source, /주문서로 오른 수치/u);
  assert.doesNotMatch(source, /추가옵션 수치/u);
  assert.doesNotMatch(source, /등업은 레어부터, 옵션은 이 장비에 유효한 줄만 묶어/u);
  assert.doesNotMatch(source, /"제작 기댓값 \(억 메소\)"/u);
});

test("장비 capability를 raw와 공식 잠재 표에서 읽어 불가능한 입력을 차단한다", async () => {
  const source = await read("../src/pages/item-market.js");

  assert.match(source, /candidate\?\.starforce\?\.applicable/u);
  assert.match(source, /upgradeApplicable/u);
  assert.match(source, /flameApplicable/u);
  assert.match(source, /potentialPart/u);
  assert.match(source, /"엠블렘": 2/u);
  assert.match(source, /"기계 심장": 20/u);
  assert.match(source, /loadPotentialTables\(\{/u);
  assert.match(source, /getAvailablePotentialTargetTypes\(result\.value/u);
  assert.match(source, /allowedPotentialOptions\(sectionKey\)/u);
  assert.match(source, /normalizePotentialSelections\(job\.sectionKey\)/u);
  assert.match(source, /request !== potentialRequestSequence \|\| state\.itemName !== itemName/u);
  assert.match(source, /control\.disabled = meta\.starforceApplicable !== true/u);
  assert.match(source, /bucket === "scroll" \? meta\.upgradeApplicable !== true/u);
  assert.match(source, /state\.requiredLevelReduction = 0/u);
  assert.match(source, /applicable: itemMeta\.starforceApplicable !== false/u);
});

test("일반 레벨 장비의 스타포스 제작 기댓값 프리셋 연결을 유지한다", async () => {
  const source = await read("../src/pages/item-market.js");

  assert.match(source, /"블랙빈 마크": "level-135"/u);
  assert.match(source, /"파풀라투스 마크": "level-145"/u);
  assert.match(source, /"분노한 자쿰의 벨트": "level-150"/u);
});

test("캐릭터 환산을 공유하고 프로필 구독은 페이지 생명주기에서 한 번만 등록한다", async () => {
  const source = await read("../src/pages/item-market.js");

  assert.match(source, /characterProfileCard\(\{ extraContent: manualCharacterSettings\(\) \}\)/u);
  assert.match(source, /getCalculationProfile\(\{/u);
  assert.match(source, /제논 \(STR·DEX·LUK\)/u);
  assert.match(source, /데몬어벤져 \(HP\)/u);
  assert.match(source, /"부스탯 2"/u);
  assert.match(source, /statModel: state\.statModel/u);
  assert.match(source, /manualSpecialEquivalence\(\)/u);
  assert.equal((source.match(/subscribeCharacterProfile\(render\)/gu) || []).length, 1);
  assert.match(source, /window\.addEventListener\("pagehide", unsubscribe/u);
});

test("결과는 시장 반영액과 합계·범위·신뢰도·주의를 표시하고 내부 산출 근거는 공개하지 않는다", async () => {
  const source = await read("../src/pages/item-market.js");

  for (const label of [
    "노작값",
    "스타포스",
    "윗잠 등업",
    "윗잠 옵션",
    "에디 등업",
    "에디 옵션",
    "주문서",
    "추가옵션",
    "거래 상태 보정",
  ]) assert.match(source, new RegExp(label, "u"));

  assert.match(source, /estimateItemMarketValue\(\{/u);
  assert.match(source, /추정 적정가/u);
  assert.match(source, /model\?\.promoted !== true/u);
  assert.match(source, /" \(베타\)"/u);
  assert.match(source, /" · 베타"/u);
  assert.match(source, /가격 추정 신뢰도/u);
  assert.doesNotMatch(source, /market\.manifest\?\.model\?\.note/u);
  assert.match(source, /예상 거래 범위/u);
  assert.match(source, /market-result-range/u);
  assert.doesNotMatch(source, /metric\("기준일"/u);
  assert.doesNotMatch(source, /function formatDate/u);
  assert.doesNotMatch(source, /사용 표본/u);
  assert.doesNotMatch(source, /confidence\.sample_count/u);
  assert.doesNotMatch(source, /confidence\.total_same_item_sales/u);
  assert.doesNotMatch(source, /confidence\.effective_sample_size/u);
  assert.doesNotMatch(source, /market\.data\?\.summary\?\.records/u);
  assert.match(source, /component_estimation_limited/u);
  assert.match(source, /market_estimation_uncertain/u);
  assert.match(source, /계산 범위를 벗어나거나 가격 효과를 따로 분리하기 어려워 보수적으로 반영했습니다/u);
  assert.match(source, /거래가 적거나 시점별 가격 검증이 충분하지 않아 예상 거래 범위를 넓게 봐야 합니다/u);
  assert.match(source, /"default_conversion_profile"/u);
  assert.match(source, /"external_base_price_anchor"/u);
  assert.match(source, /publicWarnings\.slice\(0, 3\)/u);
  assert.match(source, /market-confidence/u);
  assert.match(source, /component\.identifiable !== false/u);
  assert.match(source, /개별 가격 분리 불가/u);
  assert.doesNotMatch(source, /판매 완료 자료|판매완료 자료|판매 표본|표본에서/u);
  assert.match(source, /참고 추정치/u);
  assert.match(source, /구성요소 합계/u);
  assert.match(source, /추정 시 주의/u);
  assert.match(source, /시장 기준 환산/u);
  assert.match(source, /내 캐릭터 기준 환산/u);
  assert.match(source, /personal_equivalence/u);
  assert.doesNotMatch(source, /적정가는 시장 공통 기준으로 계산하며 내 캐릭터 환산은 참고 표시에만 사용/u);
  assert.doesNotMatch(source, /각 구성요소의 시장 반영액을 합산한 참고값/u);
  assert.match(source, /가격 추정 신뢰도/u);
  assert.match(source, /기댓값 대비 비율 = 해당 요소의 시장 반영액 ÷ 제작 기댓값/u);
  assert.match(source, /componentExpectationFooter/u);
  assert.match(source, /allocateSharedExpectedCostRecovery/u);
  assert.match(source, /합산 가격을 제작 기댓값 비중으로 배분/u);
  assert.match(source, /기댓값 대비 약/u);
  assert.match(source, /기댓값 대비/u);
  assert.match(source, /이 장비에 유효한 옵션 없음 · 기댓값 제외/u);
  assert.match(source, /compareItemMarketStatFamilies/u);
  assert.match(source, /타스탯 동급 매물 대비/u);
  assert.match(source, /같은 세트·부위의 직업별 장비/u);
  assert.match(source, /peerItemsByFamily/u);
  assert.match(source, /market\.statPeerData\[context\.peer_key \|\| context\.identity_family\]/u);
  assert.match(source, /additionalPeerVariants/u);
  assert.match(source, /metadata\?\.job_label/u);
  assert.match(source, /entry\.metadata\?\.item_name/u);
  assert.match(source, /현재 장비가.*저렴/u);
  assert.match(source, /현재 장비가.*비쌈/u);
  assert.match(source, /추정가/u);
  assert.match(source, /expectationEvidenceText/u);
  assert.match(source, /expectation\.method_label \|\| expectation\.method/u);
  assert.match(source, /const inference =/u);
  assert.match(source, /근거 \$\{evidence\}/u);
  assert.doesNotMatch(source, /scrollExpectedCostEok/u);
  assert.doesNotMatch(source, /flameExpectedCostEok/u);
});

test("시세 페이지는 데스크톱 고정 결과와 모바일 한 열 배치를 지원한다", async () => {
  const css = await read("../src/calculator.css");

  assert.match(css, /\.page--item-market \.calculator-grid \{[\s\S]*420px/u);
  assert.match(css, /\.page--item-market \.market-potential-grid/u);
  assert.match(css, /\.page--item-market \.market-enhancement-grid/u);
  assert.match(css, /\.page--item-market \.market-components/u);
  assert.match(css, /\.page--item-market \.market-stat-comparison/u);
  assert.match(css, /market-stat-comparison\[data-mode="job_peer_items"\]/u);
  assert.match(css, /market-stat-comparison__row\[data-relation="cheaper"\]/u);
  assert.match(css, /\.page--item-market \.market-component__expectation/u);
  assert.match(css, /grid-column: 1 \/ -1/u);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.page--item-market \.calculator-grid \{[\s\S]*minmax\(0, 1fr\)/u);
  assert.match(css, /@media \(max-width: 430px\)[\s\S]*\.page--item-market \.market-result-heading \{[\s\S]*flex-direction: column/u);
});
