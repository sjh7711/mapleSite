import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  calculatePetExpectation,
  calculateWonderBerryPercentileCompletionExpectation,
} from "maple-core/pet";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("자석펫 페이지가 멀티 페이지 빌드와 공용 내비게이션에 등록된다", async () => {
  const [html, vite, shell] = await Promise.all([
    read("../pet/index.html"),
    read("../vite.config.js"),
    read("../src/shared/shell.js"),
  ]);
  assert.match(html, /page--calculator page--pet/);
  assert.match(html, /src\/pages\/pet\.js/);
  assert.match(html, /자석펫 기댓값/);
  assert.match(vite, /pet:\s*resolve\(__dirname, "pet\/index\.html"\)/);
  assert.match(shell, /id: "pet", name: "자석펫", href: "pet\/"/);
  assert.doesNotMatch(shell, /icon:/);
});

test("원더 블랙 이벤트를 저장하고 OFF 9.96%와 ON 11.952%로 전환한다", async () => {
  const source = await read("../src/pages/pet.js");
  assert.match(source, /wonderBlackEvent: false/);
  assert.match(source, /\{ \.\.\.defaults, \.\.\.saved \}/);
  assert.doesNotMatch(source, /\{ \.\.\.defaults, \.\.\.saved, wonderBlackEvent: false \}/);
  assert.match(source, /원더 블랙 이벤트/);
  assert.doesNotMatch(source, /원더 블랙 확률 증가 이벤트/);
  assert.match(source, /ON 11\.952%/);
  assert.match(source, /OFF 9\.96%/);
  assert.doesNotMatch(source, /2026-06-25 10:00 이후 확률/);
  assert.match(source, /chip\("OFF"/);
  assert.match(source, /chip\("ON"/);
  assert.doesNotMatch(source, /공식 2026-06-18~25 적용 확률/);
});

test("뽑기 설정에서 자석펫 1·2·3마리 목표를 선택한다", async () => {
  const [source, css] = await Promise.all([
    read("../src/pages/pet.js"),
    read("../src/calculator.css"),
  ]);
  assert.match(source, /targetCount: 1/);
  assert.match(source, /outputTradeability: "untradeable"/);
  assert.match(source, /wonderBerryCashPurchaseAllowed: false/);
  assert.match(source, /Object\.hasOwn\(saved, "outputTradeability"\)/);
  assert.match(
    source,
    /saved && Number\(saved\.wonderBerryAuctionBundleEokPrice\) > 0[\s\S]*\? "tradeable"/,
  );
  assert.match(source, /"목표 마릿수"/);
  assert.match(source, /\[1, 2, 3\]\.map/);
  assert.match(source, /chip\(`\$\{count\}마리`/);
  assert.match(source, /setChoice\("targetCount", count\)/);
  assert.match(source, /targetCount: Number\(state\.targetCount\)/);
  assert.match(source, /자석펫 \$\{result\.targetCount\}마리/);
  assert.match(source, /pet-draw-settings/);
  const targetCardSource = source.slice(
    source.indexOf("function targetCard()"),
    source.indexOf("function costCard()"),
  );
  assert.doesNotMatch(targetCardSource, /원더 블랙 준비|sourceMode/);
  assert.match(targetCardSource, /"완성 결과"/);
  assert.match(targetCardSource, /chip\(\s*"교불"/);
  assert.match(targetCardSource, /chip\(\s*"교가"/);
  assert.match(targetCardSource, /원더베리 캐시 구매 허용/);
  assert.doesNotMatch(targetCardSource, /ON · 11개/);
  assert.doesNotMatch(targetCardSource, /state\.wonderBerryCashPurchaseAllowed[\s\S]*\? `ON ·/);
  assert.match(targetCardSource, /setChoice\("wonderBerryCashPurchaseAllowed", false\)/);
  assert.match(targetCardSource, /setChoice\("wonderBerryCashPurchaseAllowed", true\)/);
  assert.match(targetCardSource, /settings\.append\([\s\S]*cashPurchase,[\s\S]*outputTradeability/);
  assert.match(
    source,
    /function requiresTradeableOutput\(\)\s*\{\s*return state\.outputTradeability === "tradeable"/,
  );
  assert.match(
    source,
    /wonderBerryProcurementMode: tradeableOutputRequired[\s\S]*\? "cheapest"[\s\S]*: "maple-point-bundle"/,
  );
  assert.match(source, /sourceMode: "cheapest"/);
  assert.doesNotMatch(source, /showExplanations|설명 ON|설명 OFF/);
  assert.doesNotMatch(targetCardSource, /aria-pressed/);
  assert.doesNotMatch(source, /같은 기수나 특정 외형을 구분하지 않고/);
  assert.match(
    css,
    /\.page--pet \.pet-draw-settings\s*\{[\s\S]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    css,
    /@media \(max-width: 620px\)[\s\S]*\.page--pet \.pet-draw-settings,[\s\S]*\.page--pet \.pet-exchange-rates \.settings--row\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\)/,
  );
});

test("공식 확률 바로 아래에 용어 정리를 항상 표시한다", async () => {
  const [source, css, html] = await Promise.all([
    read("../src/pages/pet.js"),
    read("../src/calculator.css"),
    read("../pet/index.html"),
  ]);
  const probabilitySource = source.slice(
    source.indexOf("function termGuide()"),
    source.indexOf("function marketMeso("),
  );

  assert.match(probabilitySource, /function termGuide\(\)/);
  assert.match(
    probabilitySource,
    /return card\([\s\S]*"공식 확률",[\s\S]*makeTable\([\s\S]*termGuide\(\)/,
  );
  for (const term of [
    "경로",
    "하이브리드 경로",
    "교가 베이스·교불 재료",
    "교불·교가",
    "당첨선·목표 도달 확률",
    "회수 반영 비용",
    "보관",
    "구매 기준",
  ]) {
    assert.match(probabilitySource, new RegExp(term));
  }
  assert.match(probabilitySource, /블랙 \+ 블랙 1회/);
  assert.match(probabilitySource, /스윗 \+ 블랙까지 이어서/);
  assert.match(probabilitySource, /현재 비용에서 가치를 차감하지 않습니다/);
  assert.match(probabilitySource, /현재 시세가 더 낮으면 완성 펫 구매가 유리/);
  assert.match(probabilitySource, /메포산은 교불 재료, 캐시·경매장산은 교가 베이스/);
  assert.match(probabilitySource, /교가 계산에는 캐시 구매용 현금 시세 또는 경매장 원더베리 묶음 시세가 필요/);
  assert.match(source, /element\("dl", "pet-term-guide__list"\)/);
  assert.match(source, /element\("dt", "pet-term-guide__term"/);
  assert.match(source, /element\("dd", "pet-term-guide__description"/);
  assert.match(source, /"용어 정리"/);
  assert.doesNotMatch(source, /처음 보는 용어|pet-beginner-guide/);
  assert.doesNotMatch(source, /function explanatoryNote|pet-stage__description/);
  assert.doesNotMatch(html, /단계별 확률과 비용을 계산합니다/);
  assert.match(
    css,
    /\.page--pet \.pet-term-guide__list\s*\{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    css,
    /@media \(max-width: 620px\)[\s\S]*\.page--pet \.pet-term-guide__list\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\)/,
  );
});

test("공식 가격과 경매장 원더베리 11개 묶음 시세를 비교할 수 있다", async () => {
  const [source, css] = await Promise.all([
    read("../src/pages/pet.js"),
    read("../src/calculator.css"),
  ]);
  assert.match(source, /wonderBerryBundleMaplePoints: 54_000/);
  assert.match(source, /const WONDER_BERRY_BUNDLE_SIZE = 11/);
  assert.doesNotMatch(source, /num\("wonderBerryBundleSize"/);
  assert.doesNotMatch(source, /state\.wonderBerryBundleSize/);
  assert.doesNotMatch(source, /묶음 내 원더베리/);
  assert.match(source, /wonderBerryAuctionBundleEokPrice: ""/);
  assert.doesNotMatch(source, /wonderBerryAuctionEokPrice/);
  assert.match(source, /lunaCrystalMaplePoints: 3_900/);
  assert.match(source, /mesoMarketMaplePointsPerEok: 2_000/);
  assert.match(source, /cashWonPerEok: ""/);
  assert.match(source, /원더베리 11개 묶음 캐시샵 가격/);
  assert.match(source, /원더베리 11개 묶음 경매장 시세 \(억 메소\)/);
  assert.match(source, /num\("wonderBerryAuctionBundleEokPrice",[\s\S]*step: "0\.01"/);
  assert.match(source, /루나 크리스탈 1개 \(메이플포인트\)/);
  assert.match(source, /메소마켓 1억 메소 시세 \(메이플포인트\)/);
  assert.match(source, /1억 메소 시세 \(원\)/);
  assert.doesNotMatch(source, /환산 시세/);
  assert.match(
    source,
    /return cardWithHead\([\s\S]*?"비용 설정",\s*resetButton\(\),\s*exchangeRates,\s*recoveryFields,\s*maplePointPrices,\s*auctionPrices,/,
  );
  assert.match(source, /maplestarforce:pet:v3/);
  assert.match(source, /LEGACY_STORAGE_KEY = "maplestarforce:pet:v2"/);
  assert.match(source, /legacy\.maplePointsPerEok/);
  assert.match(source, /costConversionBasis: "maple-point"/);
  assert.doesNotMatch(source, /costConversionBasis: "won"/);
  assert.doesNotMatch(source, /wonPer100MillionMeso: cashWonPerEok/);
  assert.match(source, /const auctionBundleMeso =\s*Number\(state\.wonderBerryAuctionBundleEokPrice\) \* MESO/);
  assert.match(source, /cashBundleWon \/ cashWonPerEok \* MESO/);
  assert.match(source, /wonderBerryAuctionBundleMesoPrice:\s*tradeableBundleMeso/);
  assert.doesNotMatch(source, /경매장 시세는 현재 캐릭터와 같은 월드의 매물 기준/);
  assert.doesNotMatch(source, /경매장 묶음은 넥슨캐시산 상품의 사용 결과 규칙/);
  assert.doesNotMatch(source, /메포 상품의 메소 환산과 자동 구매 판단에는 메소마켓 시세만 사용/);
  assert.doesNotMatch(source, /경매장에서 산 원더베리는 수령 후 교환 불가/);
  assert.doesNotMatch(source, /비블랙 원더 펫 페이백은 보수적으로 0/);
  assert.doesNotMatch(source, /타월드 구매의 추가 메이플포인트 수수료는 포함하지 않습니다/);
  assert.match(
    css,
    /\.page--pet \.pet-cost-grid--auction\s*\{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    css,
    /\.page--pet \.pet-cost-grid--purchase\s*\{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    css,
    /\.page--pet \.pet-cost-grid--recovery\s*\{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    css,
    /@media \(max-width: 620px\)[\s\S]*\.page--pet \.pet-cost-grid--recovery,[\s\S]*grid-template-columns: minmax\(0, 1fr\)/,
  );
});

test("드림·키 경매장 시세와 수수료 및 원더 펫 페이백을 반영한다", async () => {
  const source = await read("../src/pages/pet.js");
  assert.match(source, /루나 드림 경매장 시세/);
  assert.match(source, /루나 크리스탈 키 시세/);
  assert.match(source, /경매장 판매 수수료/);
  assert.doesNotMatch(source, /경매장 판매 수수료 \(교가만\)/);
  assert.match(source, /chip\("5%"/);
  assert.match(source, /chip\("3%"/);
  assert.doesNotMatch(source, /판매 금액과 540메포 페이백 중 큰 값/);
  assert.doesNotMatch(source, /실제로 판매할 때만 적용/);
  assert.doesNotMatch(source, /쿠키와 생명의 물은 제외/);
  assert.match(source, /activeCosts\.wonderPetPaybackMaplePoints/);
  assert.match(source, /activeRecovery\.dreamMethod/);
  assert.match(source, /activeCosts\.dreamPaybackMaplePoints/);
  assert.match(source, /activeCosts\.dreamAuctionRecoveryMeso/);
  assert.match(source, /activeCosts\.keyAuctionRecoveryMeso/);
  assert.match(source, /lunaSweetAuctionMesoPrice:/);
  assert.match(source, /교불 루나 드림 페이백[\s\S]*formatMaplePoints/);
  assert.doesNotMatch(source, /판매 \(수수료/);
});

test("드림·키 시세에 0.8 같은 소수를 입력하는 동안 입력칸을 다시 만들지 않는다", async () => {
  const source = await read("../src/pages/pet.js");
  assert.match(
    source,
    /function refreshResult\(\)[\s\S]*querySelector\("\.calculator-result"\)[\s\S]*renderWithFocus\(result, \[resultCard\(\)\]\)/,
  );
  assert.match(
    source,
    /state\[key\] = value;[\s\S]*save\(\);[\s\S]*refreshResult\(\);/,
  );
  assert.match(source, /num\("lunaDreamEokPrice",[\s\S]*step: "0\.1"/);
  assert.match(source, /num\("lunaKeyEokPrice",[\s\S]*step: "0\.1"/);
});

test("자석펫 결과는 평균으로 시작하고 확률 입력 시 목표 확률 기준으로 전체 갱신한다", async () => {
  const [source, worker, component] = await Promise.all([
    read("../src/pages/pet.js"),
    read("../src/workers/pet-percentile.worker.js"),
    read("../src/shared/reach-control.js"),
  ]);
  const chanceResultSource = source.slice(
    source.indexOf("function resultView("),
    source.indexOf("function render()"),
  );
  assert.match(source, /resultMode: "average"/);
  assert.match(
    source,
    /loaded\.resultMode = loaded\.resultMode === "chance"[\s\S]*\? "chance"[\s\S]*: "average"/,
  );
  assert.match(
    source,
    /loaded\.resultMode === "average"[\s\S]*loaded\.targetChancePercent = DEFAULT_PET_TARGET_CHANCE_PERCENT/u,
  );
  assert.match(source, /targetChancePercent: DEFAULT_PET_TARGET_CHANCE_PERCENT/);
  assert.match(source, /function petReachChanceControl\(/);
  assert.match(source, /createReachChanceControl\(\{/u);
  assert.match(source, /목표 도달 확률 · 자석펫 \$\{result\.targetCount\}마리/);
  assert.match(component, /평균으로 보기/);
  assert.doesNotMatch(source, /저장된 목표 확률/);
  assert.match(source, /costMetric\.hidden = average/);
  assert.match(source, /min: MIN_PET_TARGET_CHANCE_PERCENT/);
  assert.match(source, /max: MAX_PET_TARGET_CHANCE_PERCENT/);
  assert.match(component, /step = 0\.01/);
  assert.match(component, /목표 도달 확률 직접 입력/);
  assert.match(
    source,
    /onChange: \(value, \{ average, phase, control, metrics \}\)[\s\S]*state\.resultMode = average \? "average" : "chance"[\s\S]*scheduleCalculation\(value\)[\s\S]*flushPendingCalculation\(\)/,
  );
  assert.match(
    source,
    /averageValue: DEFAULT_PET_TARGET_CHANCE_PERCENT/,
  );
  assert.match(component, /modeStatus\.hidden = !averageMode/u);
  assert.match(component, /reset\.hidden = averageMode/u);
  assert.match(
    source,
    /function refreshResultContent\(\)[\s\S]*\.pet-result-content[\s\S]*renderWithFocus/,
  );
  assert.match(source, /onViewChange: refreshResultContent/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /const TARGET_CHANCE_DEBOUNCE_MS = 220/);
  assert.match(
    component,
    /range\.addEventListener\("input"[\s\S]*range\.addEventListener\("change"[\s\S]*commit\("change", "range"\)/,
  );
  assert.match(source, /onCommit: \(_value, \{ source \}\)[\s\S]*source === "range"[\s\S]*flushPendingCalculation\(\)/);
  assert.match(
    source,
    /const scheduleCalculation = \(chancePercent\) => \{[\s\S]*paintPending\(chancePercent\)[\s\S]*setTimeout\([\s\S]*!controlNode\?\.isConnected/,
  );
  assert.match(source, /progressValue\.textContent = "계산 중…"/);
  assert.match(source, /const percentileViewCache = new Map\(\)/);
  assert.match(
    source,
    /function requestPercentileView\([\s\S]*percentileViewCache\.get\(key\)[\s\S]*new Worker\(/,
  );
  assert.match(source, /percentileViewCache\.size > PERCENTILE_VIEW_CACHE_LIMIT/u);
  assert.match(worker, /calculatePetWonderBerryPercentileView/u);
  assert.match(source, /원더베리 묶음 당첨선을 계산하는 중/u);
  assert.match(source, /function resultView\(/);
  assert.doesNotMatch(source, /calculateCappedWonderBerryBundleExpectation/);
  assert.doesNotMatch(source, /calculateCappedRouteExpectation/);
  assert.doesNotMatch(source, /calculatePetWonderBerryPercentileView/);
  assert.doesNotMatch(source, /calculateWonderBerryBundleCompletionExpectation/);
  assert.match(
    source,
    /getProjection: \(chancePercent\) =>[\s\S]*calculateChanceView\(context, chancePercent\)\.result\?\.projection/,
  );
  assert.match(
    source,
    /const resultContent = element\("div", "pet-result-content"\)/,
  );
  assert.doesNotMatch(source, /한도 내 평균/);
  assert.doesNotMatch(source, /성공 즉시 중단 시 평균 지출/);
  assert.doesNotMatch(source, /성공 즉시 중단 시[^\n]*평균/);
  assert.match(source, /% 당첨선/);
  assert.match(source, /\$\{completionBundles\.toLocaleString\("ko-KR"\)\}묶음 이내/);
  assert.match(source, /전체의 \$\{formatProbability\(projection\.actualChance\)\}가 이 시점까지 획득/);
  assert.match(source, /\$\{completionBundles\.toLocaleString\("ko-KR"\)\}묶음 구매 준비/);
  assert.doesNotMatch(
    source,
    /확률 바를 움직이면 전체 유저 중 해당 비율이 목표를 얻는 시점을 보여줍니다/,
  );
  assert.match(
    chanceResultSource,
    /view\.projection\.mode === "bundles"[\s\S]*view\.projection\.bundles[\s\S]*view\.projection\.routes/,
  );
  assert.match(chanceResultSource, /view\.projection\.preparation/);
  assert.match(
    chanceResultSource,
    /const chanceRequest = calculateChanceView\([\s\S]*const chanceView = chanceRequest\.result[\s\S]*percentileCompletion: chanceView\.percentileCompletion/,
  );
  assert.match(source, /당첨선 · \$\{recoveryEntered \? "회수 반영 " : ""\}예상 총지출/);
  assert.match(
    source,
    /result-hero__label[\s\S]*예상 총지출[\s\S]*formatResultCost\(heroValue\)[\s\S]*chanceLimitLabel[\s\S]*이내/,
  );
  assert.match(source, /function formatResultCost\(mesoEquivalent\)/);
  assert.match(
    source,
    /mesoEquivalent \/ MESO \* Number\(state\.mesoMarketMaplePointsPerEok\)/,
  );
  assert.match(
    source,
    /mesoEquivalent \/ MESO \* Number\(state\.cashWonPerEok\)/,
  );
  assert.match(
    source,
    /chip\("원"[\s\S]*chip\("메포"[\s\S]*chip\("메소"/,
  );
  assert.doesNotMatch(source, /메포 1메포=1원/);
  assert.doesNotMatch(source, /묶음째에 처음 목표를 획득한 이용자를 조건/);
  assert.doesNotMatch(source, /각 묶음은 11개를 전량 개봉/);
  assert.doesNotMatch(source, /completionWonderBerries[\s\S]*개째 이내/);
  assert.match(
    chanceResultSource,
    /const scale = projection\.scale;[\s\S]*scaleRouteCosts\(baseResult\.costs, scale\)/,
  );
  assert.doesNotMatch(
    chanceResultSource,
    /cappedBundle|cappedRoutes|expectedAttempts/,
  );
  assert.doesNotMatch(source, /result\.checkpoints\.map/);
});

test("평균·목표 확률 묶음 결과와 블랙·스윗 경매장 비교를 함께 제공한다", async () => {
  const source = await read("../src/pages/pet.js");
  assert.match(source, /result\.bundlePurchase\?\.applicable/);
  assert.match(source, /\$\{metricPrefix\} 구매량/);
  assert.match(source, /\$\{metricPrefix\} 개봉 원더베리/);
  assert.match(source, /\$\{metricPrefix\} 뽑은 원더 블랙/);
  assert.match(source, /\$\{metricPrefix\} 사용 원더 블랙/);
  assert.match(source, /\$\{metricPrefix\} 남는 원더 블랙/);
  assert.match(source, /실제 구매 평균 비용/);
  assert.match(source, /남은 교가 원더 블랙 판매/);
  assert.match(source, /남은 교불 원더 블랙 보관/);
  assert.doesNotMatch(source, /남는 교불 원더 블랙은 회수액 없이 보관 수량만 표시/);
  assert.doesNotMatch(source, /남은 교불 원더 블랙 페이백/);
  assert.match(source, /\$\{metricPrefix\} 루나 크리스탈/);
  assert.match(source, /\$\{metricPrefix\} 총 합성/);
  assert.match(source, /lunaSweetEokPrice: ""/);
  assert.match(source, /num\("lunaSweetEokPrice"/);
  assert.match(source, /루나 스윗 1마리 \(억 메소\)/);
  assert.match(source, /블랙·스윗 구매 기준/);
  assert.match(source, /원더 블랙 1마리/);
  assert.match(source, /루나 스윗 1마리/);
  assert.match(source, /메포 원더베리 평균 조달비/);
  assert.match(source, /캐시 원더베리 평균 조달비/);
  assert.match(source, /경매장 원더베리 묶음 평균 조달비/);
  assert.match(source, /메포 원더베리 구매 상한/);
  assert.match(source, /캐시 원더베리 구매 상한/);
  assert.match(source, /경매장 원더베리 묶음 구매 상한/);
  assert.match(source, /현재 블랙 시세/);
  assert.match(source, /현재 스윗 시세/);
  assert.match(source, /묶음 시세 입력 필요/);
  assert.doesNotMatch(source, /badge: "구매 후 교불"/);
  assert.match(source, /comparison\?\.maplePointWonderBerry/);
  assert.match(source, /auctionComparison\?\.auctionWonderBerryBundle/);
  assert.match(source, /cashComparison\?\.auctionWonderBerryBundle/);
  assert.match(source, /comparison\?\.directAuctionPurchase/);
  assert.match(source, /mesoMarketResult\.purchaseComparisons/);
  assert.match(source, /thresholds\.wonderBlackMeso/);
  assert.match(source, /thresholds\.lunaSweetMeso/);
  assert.match(source, /auctionThresholds\.auctionWonderBerryBundleWonderBlackMeso/);
  assert.match(source, /cashThresholds\.auctionWonderBerryBundleWonderBlackMeso/);
  assert.match(source, /auctionThresholds\.auctionWonderBerryBundleLunaSweetMeso/);
  assert.match(source, /cashThresholds\.auctionWonderBerryBundleLunaSweetMeso/);
  assert.match(source, /베이스·재료 추천/);
  assert.match(source, /베이스 추천/);
  assert.match(source, /재료 추천/);
  assert.match(source, /markPurchaseRecommendation/);
  assert.match(source, /outputTradeability === "tradeable"/);
  assert.match(source, /tradeable-base-required/);
  assert.match(source, /if \(kind === "black"\) addRole\(material, "material"\)/);
  assert.match(source, /status\.hidden = true/);
  assert.doesNotMatch(source, /교가 완성용 베이스와 재료 추천 경로/);
  assert.doesNotMatch(source, /메포 원더베리에서 블랙 조달/);
  assert.doesNotMatch(source, /경매장에서 스윗 구매/);
  assert.doesNotMatch(source, /auctionBundleBadge/);
  assert.doesNotMatch(source, /maplePointBadge/);
  assert.match(
    source,
    /resultLine\(\s*"완성 결과",\s*requiresTradeableOutput\(\) \? "교가" : "교불"/,
  );
  assert.doesNotMatch(source, /두 기준 모두 현재 스윗 구매가 유리/);
  assert.doesNotMatch(source, /와 비교하면 스윗 구매 유리/);
  assert.doesNotMatch(source, /전체 추천은/);
  assert.match(source, /현재 스윗 시세를 입력하면 구매 여부를 판단/);
  assert.doesNotMatch(source, /메포 직접 경로 vs 경매장/);
  assert.doesNotMatch(source, /교가 완제품/);
  assert.match(source, /formatMaplePoints\(crystalMaplePoints\)/);
  assert.doesNotMatch(source, /formatWon\(crystalMaplePoints\)/);
  assert.doesNotMatch(source, /\["메포 구매가", "메소마켓", "현금 시세"\]/);
  assert.doesNotMatch(source, /선택 조달/);
  assert.doesNotMatch(source, /산출물·페이백과 구매 단위까지 반영해 목표 달성 순비용이 낮은 구매 방식/);
  assert.doesNotMatch(source, /메포 원더베리 묶음에서 직접 뽑는 것과 같아지는 경매장 가격/);
  assert.doesNotMatch(source, /블랙부터 합성하는 것과 같아지는 경매장 가격/);
  assert.doesNotMatch(source, /원더 블랙·루나 스윗 구매 기준/);
  assert.doesNotMatch(source, /이 가격 이하면 구매/);
});

test("블랙은 3경로 실제 조달비를, 스윗은 구매 상한으로 판정한다", () => {
  const withoutAuctionBundle = calculatePetExpectation({
    wonderBlackMesoPrice: 2_000_000_000,
    lunaSweetAuctionMesoPrice: 800_000_000,
  });
  assert.equal(
    withoutAuctionBundle.purchaseComparisons.wonderBlack
      .auctionWonderBerryBundle.available,
    false,
  );
  assert.equal(
    withoutAuctionBundle.purchaseThresholds
      .auctionWonderBerryBundleWonderBlackMeso,
    null,
  );

  const result = calculatePetExpectation({
    wonderBerryAuctionBundleMesoPrice: 3_000_000_000,
    wonderBlackMesoPrice: 2_000_000_000,
    lunaSweetAuctionMesoPrice: 800_000_000,
    lunaDreamAuctionMesoPrice: 100_000_000,
    lunaKeyAuctionMesoPrice: 100_000_000,
    auctionFeeRate: 0.05,
  });
  const black = result.purchaseComparisons.wonderBlack;
  const sweet = result.purchaseComparisons.lunaSweet;

  assert.equal(black.metric, "effective-acquisition-cost");
  assert.ok(black.auctionWonderBerryBundle.available);
  assert.ok(Number.isFinite(black.recommendedMeso));
  assert.ok([
    "maplePointWonderBerry",
    "auctionWonderBerryBundle",
    "directAuctionPurchase",
  ].includes(black.recommendedRoute));
  assert.equal(
    black.directAuctionPurchase.roleLabel,
    "구매 후 교불",
  );
  assert.equal(sweet.metric, "direct-purchase-upper-bound");
  assert.ok(Number.isFinite(sweet.directPurchaseUpperBoundMeso));
  assert.equal(typeof sweet.directPurchaseIsCompetitive, "boolean");
  assert.ok([
    sweet.bestSelfProductionRoute,
    "directAuctionPurchase",
  ].includes(sweet.recommendedRoute));
});

test("완성 결과 교불·교가 선택은 평균과 당첨선 계산에 동일하게 적용된다", () => {
  const shared = {
    targetCount: 1,
    wonderBerryAuctionBundleMesoPrice: 3_000_000_000,
  };
  const untradeableOptions = {
    ...shared,
    wonderBerryProcurementMode: "maple-point-bundle",
    tradeableOutputRequired: false,
  };
  const tradeableOptions = {
    ...shared,
    wonderBerryProcurementMode: "cheapest",
    tradeableOutputRequired: true,
  };
  const results = [
    [calculatePetExpectation(untradeableOptions), false],
    [calculatePetExpectation(tradeableOptions), true],
    [
      calculateWonderBerryPercentileCompletionExpectation({
        ...untradeableOptions,
        targetChance: 0.8,
      }),
      false,
    ],
    [
      calculateWonderBerryPercentileCompletionExpectation({
        ...tradeableOptions,
        targetChance: 0.8,
      }),
      true,
    ],
  ];
  for (const [result, expectedTradeable] of results) {
    const procurement = result.procurement ?? result.bundlePurchase?.procurement;
    assert.equal(
      procurement.tradeability.synthesisResultTradable,
      expectedTradeable,
    );
  }
});

test("교가 완성 경로를 비교하고 하이브리드의 교가 베이스·교불 재료를 분리한다", async () => {
  const [source, projectionSource, css] = await Promise.all([
    read("../src/pages/pet.js"),
    read("../src/shared/pet-target-chance.js"),
    read("../src/calculator.css"),
  ]);
  const marketPurchaseDecisionSource = source.slice(
    source.indexOf("function purchaseDecision("),
    source.indexOf("function purchaseGuide("),
  );

  assert.doesNotMatch(source, /calculateWonderBerryTargetProcurement/);
  assert.match(
    projectionSource,
    /calculateWonderBerryPercentileCompletionExpectation\(\{[\s\S]*targetChance: requestedChancePercent \/ 100/,
  );
  assert.match(source, /function procurementSourceLabel\(/);
  assert.match(source, /"auction-bundle"/);
  assert.match(source, /"hybrid-bundle"/);
  assert.match(source, /function procurementSummary\(/);
  assert.doesNotMatch(source, /function procurementDecision\(/);
  assert.doesNotMatch(source, /pet-purchase-decision--procurement/);
  assert.doesNotMatch(source, /경매장 원더베리 11개 묶음 시세를 입력하면 메포 구매와 비교/);
  assert.match(
    source,
    /const activeProcurement = percentileBundle[\s\S]*percentileCompletion\?\.procurement[\s\S]*bundlePurchase\?\.procurement/,
  );
  assert.match(
    source,
    /"원더베리 조달비"[\s\S]*activeCosts\.berryProcurementMesoEquivalent/,
  );
  assert.match(source, /activeCosts\.wonderBerryAuctionBundleMeso > 0/);
  assert.match(source, /경매장 원더베리 묶음 구매/);
  assert.doesNotMatch(source, /조달 계획과 매입비는 당첨선 예상 총지출에 그대로 반영됩니다/);
  assert.match(source, /percentileProcurement: chanceView\.percentileResult/);
  assert.match(source, /snapshot\.maplePointBundles/);
  assert.match(source, /snapshot\.auctionBundles/);
  assert.match(source, /snapshot\.totalMesoEquivalent/);
  assert.match(source, /개봉 \$\{snapshot\.openedWonderBerries/);
  assert.match(source, /미개봉 \$\{snapshot\.unopenedWonderBerries/);
  assert.match(source, /교가 완성 경로/);
  assert.match(source, /교불 완성 경로/);
  assert.match(source, /sourceBreakdown/);
  assert.match(source, /sourceBreakdown\.auctionBase/);
  assert.match(source, /sourceBreakdown\.maplePointMaterial/);
  assert.match(source, /경매장 원더베리 묶음/);
  assert.match(source, /메포 원더베리 묶음/);
  assert.match(source, /교가 베이스/);
  assert.match(source, /교불 재료/);
  assert.match(source, /당첨선 조건 평균/);
  assert.match(source, /wonderBlacksConsumedAsBase/);
  assert.match(source, /wonderBlacksConsumedAsMaterial/);
  assert.match(source, /remainingTradeableBlackAuctionRecoveryMeso/);
  assert.match(source, /remainingUntradeableBlackMethod === "keep"/);
  assert.match(source, /남은 교가 원더 블랙 판매/);
  assert.match(source, /남은 교불 원더 블랙 보관/);
  assert.doesNotMatch(source, /남은 교불 원더 블랙 페이백/);
  assert.doesNotMatch(source, /교가 완성 기준으로 경매장 단독 · 경매장 베이스\+메포 재료의 회수 반영 순비용을 비교/);
  assert.doesNotMatch(source, /메포 단독 · 경매장 단독/);
  assert.match(
    source,
    /tradeableOutputRequired,/,
  );
  assert.doesNotMatch(
    source,
    /tradeableOutputRequired:\s*Number\(state\.wonderBerryAuctionBundleEokPrice\) > 0/,
  );
  assert.doesNotMatch(source, /wonderBerryProcurementMode[^\n]*chip/);
  assert.doesNotMatch(source, /선택 조달/);
  assert.doesNotMatch(marketPurchaseDecisionSource, /snapshot\.fixedQuantity/);
  assert.match(source, /synthesisResultTradable/);
  assert.match(source, /bundlePurchase\.purchaseUnitLabel \?\?[\s\S]*policy\?\.purchaseUnitLabel/);
  assert.match(source, /activeExpected\.purchasedUnits/);
  assert.match(projectionSource, /expected\?\.purchasedUnits/);
  assert.match(projectionSource, /policy\?\.purchaseUnitSize/);
  assert.match(projectionSource, /policy\?\.purchaseUnitLabel/);
  assert.match(
    projectionSource,
    /berryProcurementMesoEquivalent:[\s\S]*purchasedBundles \* unitProcurementMeso/,
  );
  assert.match(css, /\.page--pet \.pet-procurement-summary/);
  assert.doesNotMatch(css, /\.page--pet \.pet-purchase-decision--procurement/);
  assert.match(css, /data-source="auction-bundle"/);
  assert.match(css, /data-source="hybrid-bundle"/);
  assert.match(css, /\.page--pet \.pet-procurement-components/);
  assert.match(css, /\.page--pet \.pet-procurement-component/);
  assert.doesNotMatch(css, /data-source="auction-individual"/);
});

test("대표 시세에서는 교가 완성 경로를 골라 드림과 교가 잔여 블랙을 판매한다", () => {
  const result = calculatePetExpectation({
    targetCount: 1,
    sourceMode: "cheapest",
    wonderBerryBundleMaplePoints: 54_000,
    wonderBerryBundleSize: 11,
    wonderBerryAuctionBundleMesoPrice: 3_000_000_000,
    tradeableOutputRequired: true,
    lunaCrystalMaplePoints: 3_900,
    wonderBlackMesoPrice: 2_000_000_000,
    maplePointsPer100MillionMeso: 2_000,
    lunaDreamAuctionMesoPrice: 80_000_000,
    auctionFeeRate: 0.05,
  });
  const active = result.bundlePurchase;

  assert.notEqual(active.selectedProcurement, "maple-point-bundle");
  assert.equal(
    active.procurement.tradeability.synthesisResultTradable,
    true,
  );
  assert.equal(active.recovery.dreamMethod, "auction");
  assert.equal(
    active.recovery.remainingBlackMethod === "source-specific"
      ? active.recovery.remainingTradeableBlackMethod
      : active.recovery.remainingBlackMethod,
    "auction",
  );
});

test("경매장 시세 비교를 비용 설정의 경매장 입력 바로 아래에 배치한다", async () => {
  const [source, css] = await Promise.all([
    read("../src/pages/pet.js"),
    read("../src/calculator.css"),
  ]);
  assert.match(
    source,
    /const purchaseGuideSlot = element\("div", "pet-purchase-guide-slot"\)/,
  );
  assert.match(
    source,
    /"비용 설정",\s*resetButton\(\),\s*exchangeRates,\s*recoveryFields,\s*maplePointPrices,\s*auctionPrices,\s*purchaseGuideSlot/,
  );
  assert.match(
    source,
    /function placePurchaseGuide\(\)[\s\S]*\.calculator-result \.pet-purchase-threshold[\s\S]*slot\.replaceChildren/,
  );
  assert.match(
    source,
    /function refreshResult\(\)[\s\S]*renderWithFocus\(result, \[resultCard\(\)\]\);[\s\S]*placePurchaseGuide\(\)/,
  );
  assert.match(
    css,
    /\.pet-purchase-guide-slot \.pet-purchase-threshold__grid\s*\{[\s\S]*repeat\(auto-fit, minmax\(245px, 1fr\)\)/,
  );
  assert.match(
    css,
    /\.page--pet \.pet-purchase-decision__values\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\)/,
  );
  assert.match(
    css,
    /\.page--pet \.pet-purchase-decision__line\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto/,
  );
  assert.match(css, /\.page--pet \.pet-purchase-decision__badge/);
  assert.doesNotMatch(css, /data-tone="conditional"/);
  assert.match(css, /data-tone="required"/);
});

test("자석펫 결과는 데스크톱 고정 2열과 모바일 1열을 지원한다", async () => {
  const [source, css] = await Promise.all([
    read("../src/pages/pet.js"),
    read("../src/calculator.css"),
  ]);
  assert.match(css, /\.page--pet \.calculator-grid\s*\{[\s\S]*420px/);
  assert.match(css, /\.page--pet \.pet-black-event__copy/);
  assert.match(css, /\.page--pet \.pet-black-event__controls\s*\{[\s\S]*justify-content: flex-start/);
  assert.match(css, /\.page--pet \.pet-purchase-threshold/);
  assert.match(
    source,
    /left\.append\(targetCard\(\), costCard\(\), probabilityCard\(\)\)/,
  );
  assert.doesNotMatch(source, /pet-setup-grid/);
  assert.match(
    css,
    /@media \(max-width: 620px\)[\s\S]*\.page--pet \.pet-draw-settings,[\s\S]*\.page--pet \.pet-exchange-rates \.settings--row\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\)/,
  );
});

test("비용 설정은 부산물 제목과 접기 UI 없이 판매 입력을 항상 표시한다", async () => {
  const [source, css] = await Promise.all([
    read("../src/pages/pet.js"),
    read("../src/calculator.css"),
  ]);
  assert.match(source, /const recoveryFields = row\(/);
  assert.match(
    source,
    /recoveryFields\.classList\.add\("pet-cost-grid", "pet-cost-grid--recovery"\)/,
  );
  assert.match(
    source,
    /exchangeRates,\s*recoveryFields,\s*maplePointPrices/,
  );
  assert.doesNotMatch(source, /"부산물 판매·페이백"/);
  assert.doesNotMatch(source, /\bdetails\s*\(/);
  assert.doesNotMatch(source, /recovery\.open\s*=/);
  assert.match(
    css,
    /\.page--pet \.pet-exchange-rates \+ \.pet-cost-grid--recovery\s*\{[^}]*margin-top:\s*18px;/s,
  );
  assert.match(
    css,
    /\.page--pet \.pet-cost-grid--recovery \+ \.pet-cost-grid--purchase\s*\{[^}]*margin-top:\s*18px;/s,
  );
});
