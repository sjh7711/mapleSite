import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateSlotCraft } from "maple-core/scroll";
import { calculateChaosReturnEconomy } from "maple-core/scroll-economy";

import {
  buildCleanRestoreChoices,
  calculateAutomaticFirstChaos,
  expectedSupportScrollQuantities,
  expectedTraceUsage,
  isChaosFirstEnabled,
  migrateLegacySlotState,
  slotCraftState,
  supportScrollPurchaseThresholds,
} from "../src/shared/scroll-options.js";

test("주문서는 공통 카드·행·분할 선택·초기화 도구를 사용한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /segmentedControl as chipRow/u);
  assert.match(source, /resetAction/u);
  assert.doesNotMatch(source, /^function (?:card|row|chipRow)\(/mu);
});

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected}`,
  );

test("슬롯 안의 선택형 첫작놀긍은 슬롯 방식에서만 활성화된다", () => {
  assert.equal(isChaosFirstEnabled({ kind: "slot" }, true), true);
  assert.equal(isChaosFirstEnabled({ kind: "slot" }, false), false);
  assert.equal(isChaosFirstEnabled({ kind: "firstChaos" }, true), false);
  assert.equal(isChaosFirstEnabled({ kind: "return" }, true), false);
  assert.equal(isChaosFirstEnabled({ kind: "magical" }, true), false);
});

test("인게임 잔여·복구 가능만 앞으로 처리할 계산 상태로 변환한다", () => {
  assert.deepEqual(
    slotCraftState({ remaining: 8, recoverable: 0 }),
    {
      slots: 8,
      startRemaining: 8,
      startSuccess: 0,
      recoverable: 0,
      unfinished: 8,
    },
  );
  assert.deepEqual(
    slotCraftState({ remaining: 5, recoverable: 1, success: 2 }),
    {
      slots: 6,
      startRemaining: 5,
      startSuccess: 0,
      recoverable: 1,
      unfinished: 6,
    },
  );
});

test("잔여·복구만 입력해도 순백 복구 부분작 기대비용을 보존한다", () => {
  const current = slotCraftState({ remaining: 5, recoverable: 1, success: 2 });
  const common = {
    successRate: 0.59,
    scrollCost: 1_350,
    cleanCost: 20_000,
    innocentCost: Number.POSITIVE_INFINITY,
  };
  const legacy = calculateSlotCraft({
    ...common,
    slots: 8,
    startRemaining: 5,
    startSuccess: 2,
  });
  const migrated = calculateSlotCraft({
    ...common,
    slots: current.slots,
    startRemaining: current.startRemaining,
    startSuccess: current.startSuccess,
  });

  assert.equal(migrated.expectedCost, legacy.expectedCost);
  assert.deepEqual(migrated.expected, legacy.expected);
});

test("평균 주흔은 본 주문서와 보유분을 뺀 지원 주문서를 합산한다", () => {
  assert.equal(
    expectedTraceUsage({
      scrolls: 10,
      tracePerScroll: 910,
      cleans: 3.5,
      tracePerClean: 20_000,
      cleanStock: 1,
      resets: 2,
      tracePerReset: 12_000,
      resetStock: 0.5,
    }),
    77_100,
  );
  assert.equal(
    expectedTraceUsage({ cleans: 1, tracePerClean: 20_000, cleanStock: 3 }),
    0,
  );
  // 엔진이 유한 재고 사용량을 정확히 계산한 경우에는 평균 행동 수에서
  // 정수 재고를 다시 빼지 않고, 실제 유료 사용량을 그대로 쓴다.
  assert.equal(
    expectedTraceUsage({
      scrolls: 10,
      tracePerScroll: 910,
      paidCleans: 2.25,
      tracePerClean: 20_000,
      cleanStock: 999,
      paidResets: 0.75,
      tracePerReset: 12_000,
      resetStock: 999,
    }),
    63_100,
  );
});

test("지원 주문서 구매 상한은 같은 효과의 주흔 100% 기대비용으로 계산한다", () => {
  assert.deepEqual(
    supportScrollPurchaseThresholds({ tracePer1000Price: 140 }),
    { clean10: 280, clean5: 140, innocent50: 840 },
  );
  assert.deepEqual(
    supportScrollPurchaseThresholds({ tracePer1000Price: 140, halfPrice: true }),
    { clean10: 140, clean5: 70, innocent50: 420 },
  );
});

test("순백 5/10%를 끄면 가격과 관계없이 주흔 순백 100%만 복구 후보로 남긴다", () => {
  const enabled = buildCleanRestoreChoices({
    traceCost: 2_800_000,
    traceCount: 20_000,
    clean10Cost: 100_000,
    clean5Cost: 10_000,
  });
  assert.equal(enabled[0].name, "순백 5%");

  const disabled = buildCleanRestoreChoices({
    traceCost: 2_800_000,
    traceCount: 20_000,
    clean10Cost: 100_000,
    clean5Cost: 10_000,
    allowFiveTenPercent: false,
  });
  assert.deepEqual(disabled, [{
    name: "주흔 순백 100%",
    each: 2_800_000,
    rate: 1,
    traceCount: 20_000,
    cost: 2_800_000,
  }]);
});

test("놀긍 첫작은 보유 100%를 먼저 쓰고 소진되면 구매 60%로 전환한다", () => {
  const baseline = calculateAutomaticFirstChaos({
    targetChance: 0.5,
    chaos60Cost: 100,
    resetCost: 40,
  });
  close(baseline.scrolls, 1 / 0.3);
  close(baseline.purchasedChaos60, 1 / 0.3);
  close(baseline.resets, 0.7 / 0.3);
  close(baseline.cost, (100 + 0.7 * 40) / 0.3);

  const mixed = calculateAutomaticFirstChaos({
    targetChance: 0.5,
    chaos60Cost: 100,
    resetCost: 40,
    chaos100Stock: 1,
    resetStock: 1,
  });
  close(mixed.ownedChaos100Used, 1);
  close(mixed.purchasedChaos60, 0.5 / 0.3);
  close(mixed.ownedResetsUsed, 0.5);
  close(mixed.paidResets, 0.5 * (0.7 / 0.3));
  close(mixed.cost, 0.5 * baseline.cost);
  assert.equal(mixed.nextAction, "보유 놀긍 100% 바르기");

  const severalOwned = calculateAutomaticFirstChaos({
    targetChance: 0.2,
    chaos60Cost: 100,
    resetCost: 40,
    chaos100Stock: 3,
    resetStock: 1,
  });
  const reachPurchased60 = 0.8 ** 3;
  const expectedOwned100 = (1 - reachPurchased60) / 0.2;
  const expectedPurchased60 = reachPurchased60 / 0.12;
  const expectedResets =
    0.8 * (1 - reachPurchased60) / 0.2 +
    reachPurchased60 * 0.88 / 0.12;
  close(severalOwned.ownedChaos100Used, expectedOwned100);
  close(severalOwned.purchasedChaos60, expectedPurchased60);
  close(severalOwned.resets, expectedResets);
  close(severalOwned.ownedResetsUsed, 0.8);
  close(severalOwned.paidResets, expectedResets - 0.8);
  close(
    severalOwned.cost,
    expectedPurchased60 * 100 + (expectedResets - 0.8) * 40,
  );

  const guaranteed = calculateAutomaticFirstChaos({
    targetChance: 1,
    chaos60Cost: 100,
    resetCost: Number.POSITIVE_INFINITY,
    chaos100Stock: 1,
  });
  assert.equal(guaranteed.cost, 0);
  assert.equal(guaranteed.scrolls, 1);
  assert.equal(guaranteed.resets, 0);
});

test("복구·초기화 성공 횟수를 실제 주문서 필요 장수로 환산한다", () => {
  assert.deepEqual(
    expectedSupportScrollQuantities({
      ownedCleans: 1.25,
      paidCleans: 2.5,
      cleanRate: 0.1,
      ownedResets: 0.4,
      paidResets: 0.75,
      resetRate: 0.5,
      firstOwnedResets: 0.6,
      firstPaidResets: 0.25,
    }),
    {
      ownedClean100: 1.25,
      purchasedClean: 25,
      ownedReset100: 1,
      purchasedReset: 2,
    },
  );
});

test("구 저장값을 잔여·복구 가능 두 값으로 안전하게 이전한다", () => {
  assert.deepEqual(
    migrateLegacySlotState({ slots: 8, remaining: 5, success: 2 }),
    { remaining: 5, recoverable: 1 },
  );
  assert.deepEqual(
    migrateLegacySlotState({ slots: 8, remaining: 8, success: 2 }),
    { remaining: 6, recoverable: 0 },
  );
});

test("첫작놀긍 선택과 목표 입력은 놀긍 설정 카드 안에 표시한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const renderSource = source.slice(source.indexOf("function render()"));
  const methodCardStart = renderSource.indexOf('"작 방식"');
  const chaosCardStart = renderSource.indexOf('"놀긍 설정"', methodCardStart);
  const equipmentCardStart = renderSource.indexOf('"장비"', chaosCardStart);
  const methodCardSource = renderSource.slice(methodCardStart, chaosCardStart);
  const chaosCardSource = renderSource.slice(chaosCardStart, equipmentCardStart);

  assert.ok(
    methodCardStart >= 0 && chaosCardStart > methodCardStart && equipmentCardStart > chaosCardStart,
  );
  assert.doesNotMatch(methodCardSource, /firstWorkOption\(\)|"목표 공·마"|"목표 스탯 합"/);
  assert.match(chaosCardSource, /method\.kind === "slot" \? firstWorkOption\(\) : null/);
  assert.match(
    chaosCardSource,
    /method\.kind === "return"[\s\S]*returnFirstWorkOption\(hasReturnProgress\)/,
  );
  assert.match(chaosCardSource, /"목표 공·마"/);
  assert.match(chaosCardSource, /"목표 스탯 합"/);
  assert.match(chaosCardSource, /method\.kind === "return"[\s\S]*"첫작 목표 공·마"/);
  assert.match(chaosCardSource, /"첫작 목표 스탯 합"/);
  assert.doesNotMatch(chaosCardSource, /choice\("returnFirstRate"/);
  assert.doesNotMatch(chaosCardSource, /첫작 놀긍 60%|첫작 놀긍 100%/);
  assert.match(chaosCardSource, /isStandaloneFirst \|\| usesChaosFirst/);
  assert.match(
    chaosCardSource,
    /주스탯만 선택하세요\. 선택한 공·마와 스탯은 장비에 이미 붙어 있어야 합니다/,
  );
  assert.doesNotMatch(
    chaosCardSource,
    /보유 놀긍 100%를 먼저 사용|합산할 스탯만 선택하세요/,
  );
  assert.match(chaosCardSource, /"최종 평균 공·마"/);
  assert.match(chaosCardSource, /"최종 스탯 평균"/);
  assert.match(renderSource, /const showsChaosSettings = method\.kind === "slot" \|\| usesChaos/);
  assert.match(source, /toggle\("chaosFirst", "첫작놀긍"\)/);
  assert.match(source, /"놀긍 첫작",[\s\S]*!disabled && state\.returnFirst/);
  assert.match(source, /delete state\.returnFirstRate/);
  assert.doesNotMatch(source, /황금망치/);
  assert.doesNotMatch(source, /card\(\s*"첫 작 놀긍"/);
  assert.match(source, /const first = usesChaosFirst \? chaosFirstCost\(reset\) : null/);
});

test("놀긍리턴 최종 스탯 평균은 소수 입력을 목표 합계까지 보존한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /"최종 스탯 평균",[\s\S]*num\("statTarget", \{[\s\S]*step: "0\.1",[\s\S]*allowDecimalDraft: true/,
  );
  assert.match(source, /averageStatTarget: Number\(state\.statTarget\)/);

  const result = calculateChaosReturnEconomy({
    slots: 2,
    averageAttackTarget: 0,
    averageStatTarget: 2.5,
    statCount: 1,
    prices: { chaos60Meso: 30_000, returnMaplePoints: 6_900 },
  });
  assert.equal(result.goals.stat, 5);
  assert.equal(result.goals.averageStat, 2.5);
});

test("첫 작 평균 놀긍은 총합과 보유·구매 내역을 두 줄로 나눈다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const css = await readFile(
    new URL("../src/calculator.css", import.meta.url),
    "utf8",
  );
  const usageSource = source.slice(
    source.indexOf("function firstChaosUsageLine("),
    source.indexOf("function returnCostHero("),
  );
  const slotResultSource = source.slice(
    source.indexOf("function slotResult()"),
    source.indexOf("function magicalResult()"),
  );

  assert.match(usageSource, /`총 \$\{times\(first\.scrolls\)\}`/);
  assert.match(usageSource, /first\.chaos100Stock > 0/);
  assert.match(usageSource, /`100% \$\{times\(first\.ownedChaos100Used\)\}`/);
  assert.match(usageSource, /`60% \$\{times\(first\.purchasedChaos60\)\}`/);
  assert.doesNotMatch(usageSource, /보유 100%|구매 60%/);
  assert.match(slotResultSource, /firstChaosUsageLine\(first\)/);
  assert.doesNotMatch(slotResultSource, /line\(\s*"첫 작 평균 놀긍"/);
  assert.match(css, /\.scroll-first-usage__values\s*\{[^}]*flex-direction:\s*column/s);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.scroll-first-usage/s);
});

test("첫 작 목표 적중률은 주문서별 확률을 줄마다 구분한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const css = await readFile(
    new URL("../src/calculator.css", import.meta.url),
    "utf8",
  );
  const chanceSource = source.slice(
    source.indexOf("function firstChaosTargetChanceLine("),
    source.indexOf("function returnCostHero("),
  );
  const slotResultSource = source.slice(
    source.indexOf("function slotResult()"),
    source.indexOf("function magicalResult()"),
  );

  assert.match(chanceSource, /"첫 작 목표 적중률"/);
  assert.match(chanceSource, /chance\("보유 놀긍 100%", first\.targetChance100\)/);
  assert.match(chanceSource, /"소진 후 놀긍 60%"/);
  assert.match(chanceSource, /first\.chaos100Stock > 0/);
  assert.match(slotResultSource, /firstChaosTargetChanceLine\(first\)/);
  assert.doesNotMatch(slotResultSource, /이후 놀긍 60%/);
  assert.match(css, /\.scroll-first-hit__values\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.scroll-first-hit/s);
});

test("주문서 페이지만 긴 입력 이름표를 생략하지 않는다", async () => {
  const html = await readFile(
    new URL("../scroll/index.html", import.meta.url),
    "utf8",
  );
  const css = await readFile(
    new URL("../src/calculator.css", import.meta.url),
    "utf8",
  );

  assert.match(html, /class="page--calculator page--scroll"/);
  assert.match(css, /\.page--scroll \.field--inline\s*{[^}]*flex-direction:\s*column/s);
  assert.match(
    css,
    /\.page--scroll \.field--inline > span\s*{[^}]*overflow:\s*visible;[^}]*text-overflow:\s*clip;[^}]*white-space:\s*normal/s,
  );
  assert.match(css, /\.page--scroll \.settings[^}]*minmax\(150px, 1fr\)/s);
});

test("업그레이드 상태 입력은 인게임 용어에 맞춰 표시한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /field\(\s*"잔여",\s*num\("remaining"/);
  assert.match(source, /field\(\s*"복구 가능",\s*num\("recoverable"/);
  assert.doesNotMatch(source, /field\(\s*"성공한 작 수"|num\("success"/);
  assert.match(
    source,
    /method\.kind === "magical" \? "완료한 주문서 횟수" : "전체 작 수"/,
  );
  assert.match(source, /"이미 적용한 작 수"[\s\S]*num\("returnAppliedWorks"/);
  assert.match(source, /"현재 적용된 공·마 합"[\s\S]*num\("returnCurrentAttack"/);
  assert.match(source, /"현재 적용된 목표 스탯 합"[\s\S]*num\("returnCurrentStat"/);
  assert.doesNotMatch(source, /"현재 놀긍 공·마 합"|"현재 놀긍 목표 스탯 합"/);
  assert.doesNotMatch(source, /전체 업그레이드 횟수|현재 남은 횟수/);
  assert.doesNotMatch(source, /현재 성공한 작/);
  assert.match(source, /delete state\.slots/);
  assert.match(source, /delete state\.success/);
  assert.match(source, /첫작놀긍은 복구 가능한 횟수가 없는 장비/);
});

test("기존 놀긍떡작 저장값은 설정을 잃지 않고 독립 놀긍첫작으로 이전한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const migrationSource = source.slice(
    source.indexOf("try {"),
    source.indexOf("} catch"),
  );

  assert.match(source, /const SCROLL_SETTINGS_VERSION = 7/);
  assert.match(
    migrationSource,
    /if \(savedVersion < 3\) \{[\s\S]*state\.preserveStarforce = false;[\s\S]*state\.halfPrice = false;/,
  );
  assert.match(
    migrationSource,
    /if \(savedVersion < 5\) \{[\s\S]*state\.attackTarget = DEFAULT_RETURN_ATTACK_TARGET;/,
  );
  assert.match(
    migrationSource,
    /if \(savedVersion < 6\) \{[\s\S]*state\.magicalCompletedCount = DEFAULT_MAGICAL_COMPLETED_COUNT;/,
  );
  assert.match(
    migrationSource,
    /if \(saved\.method === "spam"\) state\.method = "firstChaos";/,
  );
  assert.match(migrationSource, /delete state\.chaosRate/);
  assert.equal((source.match(/"spam"/g) ?? []).length, 1);
});

test("놀긍떡작 대신 장비 전체와 분리된 놀긍첫작 계산을 제공한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const methodsSource = source.slice(
    source.indexOf("const METHODS ="),
    source.indexOf("const SLOT_IDS"),
  );
  const renderSource = source.slice(source.indexOf("function render()"));
  const firstResultSource = source.slice(
    source.indexOf("function firstChaosResult()"),
    source.indexOf("function slotResult()"),
  );

  assert.match(
    methodsSource,
    /firstChaos: \{ name: "놀긍첫작", kind: "firstChaos", description: "원하는 놀긍 첫작이 붙을 때까지의 평균 비용" \}/,
  );
  assert.doesNotMatch(methodsSource, /놀긍떡작|chaosSlot|spam/);
  assert.match(renderSource, /const isStandaloneFirst = method\.kind === "firstChaos"/);
  assert.match(renderSource, /const usesSlots = method\.kind === "slot"/);
  assert.match(
    renderSource,
    /if \(!isStandaloneFirst\) \{[\s\S]*settingsSection\("장비", "equipment"/,
  );
  assert.match(renderSource, /if \(usesChaos && !isStandaloneFirst\) \{[\s\S]*characterProfileCardForRender\(\)/);
  assert.doesNotMatch(source, /from "\.\.\/shared\/character-profile\.js"/u);
  assert.match(source, /import\("\.\.\/shared\/character-profile\.js"\)/u);
  assert.match(renderSource, /isStandaloneFirst[\s\S]*\? firstChaosResult\(\)[\s\S]*: slotResult\(\)/);
  assert.doesNotMatch(firstResultSource, /workCount|remaining|recoverable|calculateSlotCraft|policy|캐릭터/);
  assert.doesNotMatch(source, /chaosMean|state\.method === "spam"|kind === "chaosSlot"/);
});

test("놀긍첫작은 목표와 첫작 비용·보유량만 입력받는다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const renderSource = source.slice(source.indexOf("function render()"));
  const chaosCardSource = renderSource.slice(
    renderSource.indexOf('"놀긍 설정"'),
    renderSource.indexOf("const equipmentContent ="),
  );
  const costSource = renderSource.slice(
    renderSource.indexOf('if (method.kind !== "magical")'),
    renderSource.indexOf('if (state.method === "trace")'),
  );

  assert.match(chaosCardSource, /usesChaosTarget[\s\S]*"목표 스탯"/);
  assert.match(chaosCardSource, /STATS\.map\(\(name\) =>/);
  assert.match(chaosCardSource, /isStandaloneFirst \|\| usesChaosFirst[\s\S]*"목표 공·마"[\s\S]*"chaosFirstAttack"/);
  assert.match(chaosCardSource, /"목표 스탯 합"[\s\S]*"chaosFirstStat"/);

  assert.match(costSource, /isStandaloneFirst[\s\S]*"주문의 흔적 1,000개 \(만 메소\)"[\s\S]*"tracePer1000"/);
  assert.match(costSource, /state\.preserveStarforce[\s\S]*"이노센트 50% \(만 메소\)"[\s\S]*"innocent50Price"/);
  assert.match(costSource, /isStandaloneFirst[\s\S]*"놀긍 60% \(만 메소\)"[\s\S]*"chaos60Price"/);
  assert.match(costSource, /isStandaloneFirst[\s\S]*"보유 놀긍 100% \(장\)"[\s\S]*"chaos100Stock"/);
  assert.match(costSource, /"보유 아크 이노센트 100% \(장\)"[\s\S]*"arkInnocentStock"/);
  assert.match(costSource, /"보유 이노센트 100% \(장\)"[\s\S]*"innocentStock"/);
  assert.match(costSource, /toggle\(\s*"halfPrice",\s*"주흔 반값 썬데이"/);
  assert.match(costSource, /isStandaloneFirst[\s\S]*resetModeSelector\("preserveStarforce"/);

  assert.doesNotMatch(source, /choice\("chaosRate"|pickChaosRate|scroll-chaos-rates/);
  assert.doesNotMatch(costSource, /isStandaloneFirst[\s\S]*"순백 10%|isStandaloneFirst[\s\S]*"순백 5%/);
});

test("놀긍첫작 결과는 목표 적중까지의 총비용·주문서·초기화를 함께 보여준다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const firstCostSource = source.slice(
    source.indexOf("function chaosFirstCost("),
    source.indexOf("function chaosFirstTargetText()"),
  );
  const resultSource = source.slice(
    source.indexOf("function firstChaosResult()"),
    source.indexOf("function slotResult()"),
  );

  assert.match(firstCostSource, /chaosAtLeast\(state\.chaosFirstAttack\)/);
  assert.match(firstCostSource, /chaosSumAtLeast\(state\.chaosFirstStat, Math\.max\(1, statCount\(\)\)\)/);
  assert.match(firstCostSource, /calculateAutomaticFirstChaos\(\{/);
  assert.match(firstCostSource, /resetCost: reset\?\.cost \?\? Number\.POSITIVE_INFINITY/);
  assert.match(firstCostSource, /chaos100Stock: state\.chaos100Stock/);
  assert.match(firstCostSource, /resetStock: resetStock\(state\.preserveStarforce\)/);

  assert.match(resultSource, /state\.chaosFirstStat > 0 && statCount\(\) === 0/);
  assert.match(resultSource, /const reset = resetChoices\(\)\[0\] \?\? null/);
  assert.match(resultSource, /try \{[\s\S]*first = chaosFirstCost\(reset\)[\s\S]*catch \(error\)/);
  assert.match(resultSource, /!first\.feasible/);
  assert.match(resultSource, /!Number\.isFinite\(first\.cost\)/);
  assert.match(resultSource, /expectedSupportScrollQuantities\(\{/);
  assert.match(resultSource, /firstOwnedResets: first\.ownedResetsUsed/);
  assert.match(resultSource, /firstPaidResets: first\.paidResets/);
  assert.match(resultSource, /resultHero\("평균 비용", eok\(first\.cost\)\)/);
  assert.match(resultSource, /line\("목표", chaosFirstTargetText\(\), true\)/);
  assert.match(resultSource, /firstChaosTargetChanceLine\(first\)/);
  assert.match(resultSource, /firstChaosUsageLine\(first\)/);
  assert.match(resultSource, /supportScrollUsageMetric\(`평균 \$\{resetKind\}`/);
  assert.match(resultSource, /line\("초기화", `\$\{reset\.name\} · 성공 1회 평균 \$\{eok\(reset\.cost\)\}`\)/);
  assert.doesNotMatch(resultSource, /"지금 할 일"|first\.nextAction/);
  assert.match(resultSource, /목표에 미달하거나 주문서가 실패하면/);
});

test("매지컬리턴은 완료 횟수에 따라 첫작 이노와 남은 리턴작을 구분한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const stateSource = source.slice(
    source.indexOf("const state ="),
    source.indexOf("try {"),
  );
  const magicalResultSource = source.slice(
    source.indexOf("function magicalResult()"),
    source.indexOf("function returnResult()"),
  );
  const renderSource = source.slice(source.indexOf("function render()"));

  assert.match(source, /const MAGICAL_TARGET = 11/);
  assert.doesNotMatch(stateSource, /magicalTarget/);
  assert.match(source, /delete state\.magicalTarget/);
  assert.match(stateSource, /magicalFirstStarforced:\s*false/);
  assert.match(magicalResultSource, /calculateMagicalReturnCraftProgress\(\{/);
  assert.match(magicalResultSource, /totalSlots: MAGICAL_TOTAL_WORKS/);
  assert.match(magicalResultSource, /completedSlots,/);
  assert.match(magicalResultSource, /target: MAGICAL_TARGET/);
  assert.match(magicalResultSource, /resetCost: reset\?\.each \?\? 0/);
  assert.match(magicalResultSource, /resetRate: reset\?\.rate \?\? 1/);
  assert.match(magicalResultSource, /resetStock: selectedResetStock/);
  assert.match(magicalResultSource, /returnCostHero\(/);
  assert.match(magicalResultSource, /"예상 필요 메소",[\s\S]*eokMeso\(totalMeso\),[\s\S]*showUnitToggle: false/);
  assert.doesNotMatch(magicalResultSource, /resultInMeso|예상 필요 메포|maplePoints\(result\.costs\.returnMaplePoints\)/);
  assert.match(magicalResultSource, /"리턴 구매에 필요한 예상 메소", eokMeso\(cashAsMeso\)/);
  assert.match(magicalResultSource, /"그 외 예상 메소", eokMeso\(result\.costs\.otherMeso\)/);
  assert.match(magicalResultSource, /"평균 매지컬 사용량"/);
  assert.match(magicalResultSource, /"평균 리턴 스크롤 사용량"/);
  assert.match(magicalResultSource, /supportScrollUsageMetric\(`평균 \$\{resetKind\}`/);
  assert.match(magicalResultSource, /value: result\.expected\.ownedResetsUsed/);
  assert.match(magicalResultSource, /value: result\.expected\.purchasedResetScrolls/);
  assert.match(magicalResultSource, /magicalStrategyFlow\(\{/);
  assert.doesNotMatch(magicalResultSource, /완성 옵션|주스탯 환산/);
  assert.doesNotMatch(magicalResultSource, /"최소 환산"|"1작 매지컬 값"|"1작 리턴 값"/);
  assert.equal((magicalResultSource.match(/한 번에 뜰 확률/g) ?? []).length, 0);
  assert.doesNotMatch(renderSource, /choice\("magicalTarget"/);
  assert.doesNotMatch(renderSource, /\[9, 10, 11\]/);
  assert.match(renderSource, /resetModeSelector\("magicalFirstStarforced"\)/);
  assert.match(source, /첫작은 \(아크\) 이노센트, 나머지는 리턴/);
});

test("매지컬리턴은 10작 고정이며 완료 횟수만 입력받는다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const stateSource = source.slice(
    source.indexOf("const state ="),
    source.indexOf("try {"),
  );
  const migrationSource = source.slice(
    source.indexOf("try {"),
    source.indexOf("} catch"),
  );
  const magicalResultSource = source.slice(
    source.indexOf("function magicalResult()"),
    source.indexOf("function returnResult()"),
  );
  const returnResultSource = source.slice(
    source.indexOf("function returnResult()"),
    source.indexOf("function render()"),
  );
  const renderSource = source.slice(source.indexOf("function render()"));

  assert.match(source, /const DEFAULT_RETURN_ATTACK_TARGET = 6/);
  assert.match(source, /const MAGICAL_TOTAL_WORKS = 10/);
  assert.match(source, /const DEFAULT_MAGICAL_COMPLETED_COUNT = 0/);
  assert.match(stateSource, /workCount:\s*8/);
  assert.match(
    stateSource,
    /magicalCompletedCount:\s*DEFAULT_MAGICAL_COMPLETED_COUNT/,
  );
  assert.match(stateSource, /attackTarget:\s*DEFAULT_RETURN_ATTACK_TARGET/);
  assert.match(
    migrationSource,
    /state\.magicalCompletedCount = Math\.min\([\s\S]*Number\(saved\.magicalCompletedCount\)/,
  );
  assert.match(
    magicalResultSource,
    /selectedMagicalCompletedCount\([\s\S]*state\.magicalCompletedCount/,
  );
  assert.doesNotMatch(magicalResultSource, /selectedWorkCount\(state\.workCount\)/);
  assert.match(returnResultSource, /selectedWorkCount\(state\.workCount\)/);
  assert.doesNotMatch(returnResultSource, /magicalCompletedCount/);
  assert.match(
    renderSource,
    /method\.kind === "magical" \? "완료한 주문서 횟수" : "전체 작 수"/,
  );
  assert.match(renderSource, /\? "magicalCompletedCount"[\s\S]*: "workCount"/);
  assert.match(renderSource, /\{ min: "0", max: String\(MAGICAL_TOTAL_WORKS\) \}/);
  assert.match(magicalResultSource, /invalidMagicalCompletedCountResult\(\)/);
  assert.match(magicalResultSource, /const needsFirstWork = completedSlots === 0/);
  assert.match(magicalResultSource, /remainingSlots = MAGICAL_TOTAL_WORKS - completedSlots/);
  assert.match(source, /delete state\.magicalWorkCount/);
});

test("주흔작 확률 버튼 행은 작 방식 행과 세로 간격을 둔다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const css = await readFile(
    new URL("../src/calculator.css", import.meta.url),
    "utf8",
  );

  assert.match(source, /"scroll-trace-rates"/);
  assert.match(
    css,
    /\.page--scroll \.scroll-trace-rates\s*{[^}]*margin-top:\s*10px;/s,
  );
});

test("비용 설정은 접히지 않고 항상 내용을 표시한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /settingsSection\(\s*"비용 설정",\s*"cost",\s*row\(\.\.\.slotPriceFields/,
  );
  assert.doesNotMatch(source, /시세와 보유 주문서 펼치기/);
  assert.doesNotMatch(source, /scroll-cost-settings|costSettingsOpen/);
});

test("순백 5/10% 허용을 끄면 입력을 유지한 채 계산 후보에서 제외한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const restoreSource = source.slice(
    source.indexOf("function restoreChoices()"),
    source.indexOf("function resetOptions"),
  );
  assert.match(source, /useCleanScrolls: true/);
  assert.match(restoreSource, /allowFiveTenPercent: state\.useCleanScrolls/);
  assert.match(source, /clean10Price[\s\S]*disabled: !state\.useCleanScrolls/);
  assert.match(source, /clean5Price[\s\S]*disabled: !state\.useCleanScrolls/);
  assert.match(
    source,
    /resetModeSelector\("preserveStarforce"[\s\S]*toggle\("useCleanScrolls", "순백 5\/10% 허용"\)[\s\S]*"주흔 반값 썬데이"/,
  );
  assert.match(source, /보유 순백 100%를 먼저 사용하고, 모두 소진되면 주흔 순백 100%로 복구합니다/);
  assert.match(source, /현재 전략에서 사용 안 함/);
});

test("작 방식을 상단에 두고 장비·놀긍과 비용을 하단 두 열에 배치한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const css = await readFile(
    new URL("../src/calculator.css", import.meta.url),
    "utf8",
  );
  const renderSource = source.slice(source.indexOf("function render()"));

  assert.match(renderSource, /const methodCard = settingsSectionWithHead\(\s*"작 방식",\s*"method"/);
  assert.match(renderSource, /equipmentSettingsCard = settingsSection\("장비", "equipment"/);
  assert.match(renderSource, /chaosSettingsCard = settingsSection\(\s*method\.kind === "return" \? "" : "놀긍 설정",\s*"chaos"/);
  assert.match(renderSource, /costSettingsCard = settingsSection\(\s*"비용 설정",\s*"cost"/);
  assert.match(
    renderSource,
    /const arrangedParts = \[\s*scrollSettingsCard\(\s*methodCard,\s*equipmentSettingsCard,\s*chaosSettingsCard,\s*costSettingsCard,\s*\)/s,
  );
  assert.match(
    source,
    /const lowerGrid = element\("div", "scroll-settings-lower"\)/,
  );
  assert.match(
    source,
    /const leftColumn = element\([\s\S]*?"scroll-settings-column scroll-settings-column--left"[\s\S]*?const rightColumn = element\([\s\S]*?"scroll-settings-column scroll-settings-column--right"/s,
  );
  assert.match(source, /leftColumn\.append\(\.\.\.\[equipment, chaos\]\.filter\(Boolean\)\)/);
  assert.match(source, /rightColumn\.append\(\.\.\.\[cost\]\.filter\(Boolean\)\)/);
  assert.match(source, /lowerGrid\.append\(leftColumn, rightColumn\)/);
  assert.match(source, /grid\.append\(method, lowerGrid\)/);
  assert.match(
    css,
    /\.page--scroll \.scroll-settings-lower\s*{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s,
  );
  assert.match(
    css,
    /\.page--scroll \.scroll-settings-lower::before\s*{[^}]*top:\s*0;[^}]*right:\s*20px;[^}]*left:\s*20px;[^}]*height:\s*1px;[^}]*background:\s*rgba\(255, 255, 255, 0\.08\);/s,
  );
  assert.match(
    css,
    /\.page--scroll \.scroll-settings-column--right::before\s*{[^}]*top:\s*20px;[^}]*bottom:\s*20px;[^}]*left:\s*0;[^}]*width:\s*1px;[^}]*background:\s*rgba\(255, 255, 255, 0\.08\);/s,
  );
  assert.match(
    css,
    /\.page--scroll \.scroll-settings-section \+ \.scroll-settings-section::before\s*{[^}]*top:\s*0;[^}]*right:\s*20px;[^}]*left:\s*20px;[^}]*height:\s*1px;[^}]*background:\s*rgba\(255, 255, 255, 0\.08\);/s,
  );
  assert.match(
    css,
    /@media \(max-width: 1040px\)[\s\S]*?\.page--scroll \.scroll-settings-grid\s*{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*}[\s\S]*?\.page--scroll \.scroll-settings-lower,[\s\S]*?\.page--scroll \.scroll-settings-column\s*{[^}]*display:\s*contents;[^}]*}/,
  );
  assert.match(css, /\.scroll-settings-section--method\s*{[^}]*order:\s*1;/s);
  assert.match(css, /\.scroll-settings-section--equipment\s*{[^}]*order:\s*2;/s);
  assert.match(css, /\.scroll-settings-section--chaos\s*{[^}]*order:\s*3;/s);
  assert.match(css, /\.scroll-settings-section--cost\s*{[^}]*order:\s*4;/s);
  assert.match(source, /"scroll-methods"/);
  assert.match(
    css,
    /\.page--scroll \.scroll-methods\s*{[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto;/s,
  );
  assert.match(
    css,
    /\.page--scroll \.scroll-methods \.chip\s*{[^}]*flex:\s*0 0 auto;[^}]*white-space:\s*nowrap;/s,
  );
  const methodChipRule = css.match(
    /\.page--scroll \.scroll-methods \.chip\s*{[^}]*}/s,
  )?.[0] ?? "";
  assert.doesNotMatch(methodChipRule, /font-size|padding(?:-right|-left)?\s*:/);
  assert.match(
    css,
    /@media \(max-width: 620px\)[\s\S]*?\.page--scroll \.scroll-methods\s*{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[^}]*overflow:\s*visible;[^}]*}[\s\S]*?\.page--scroll \.scroll-methods \.chip\s*{[^}]*width:\s*100%;/s,
  );
  assert.doesNotMatch(source, /cardPair|scroll-card-pair/);
  assert.doesNotMatch(css, /grid-template-areas:/);
});

test("놀긍 옵션 존재 여부는 토글로 묻지 않고 필수 전제로 안내한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const css = await readFile(
    new URL("../src/calculator.css", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /대상 옵션이 이미 붙어 있음/);
  assert.doesNotMatch(source, /놀긍으로 붙일 스탯 존재 여부/);
  assert.doesNotMatch(source, /chaosOptionPresenceToggle\(\)|!state\.hasChaosOptions/);
  assert.match(source, /delete state\.hasChaosOptions/);
  assert.match(source, /선택한 공·마와 스탯은 장비에 이미 붙어 있어야 합니다/);
  assert.match(source, /"scroll-chaos-stats"/);
  assert.doesNotMatch(css, /\.scroll-chaos-presence/);
  assert.match(
    css,
    /\.page--scroll \.scroll-chaos-stats\s*{[^}]*margin-top:\s*10px;/s,
  );
});

test("주흔작 결과는 평균 비용에 필요한 주문의 흔적 수를 함께 표시한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /const expectedTraceCount = state\.method === "trace"/);
  assert.match(source, /metric\("평균 주흔"/);
  assert.match(source, /expectedTraceUsage\(\{/);
  assert.match(source, /tracePerScroll: traceCountPerScroll\(\) \?\? 0/);
  assert.match(source, /paidCleans: result\.expected\.paidCleans/);
  assert.match(
    source,
    /paidResets: result\.expected\.paidInnocents \+ firstPaidResets/,
  );
});

test("주흔작 결과에서 중복된 성공률·1작당 흔적·나머지 작 비용을 제거한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const slotResultSource = source.slice(
    source.indexOf("function slotResult()"),
    source.indexOf("function magicalResult()"),
  );

  assert.doesNotMatch(slotResultSource, /line\("성공 확률"/);
  assert.doesNotMatch(slotResultSource, /"1작당 흔적"/);
  assert.doesNotMatch(slotResultSource, /line\(`나머지 \$\{craftSlots\}작`/);
});

test("상태별 행동표는 현재 행동을 결과에 남기고 넓은 독립 카드에 역순으로 표시한다", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("../src/pages/scroll.js", import.meta.url), "utf8"),
    readFile(new URL("../src/calculator.css", import.meta.url), "utf8"),
  ]);

  assert.match(source, /상태별 다음 행동표/);
  assert.match(source, /"복구 가능 \/ 잔여"/);
  assert.match(source, /"현재 입력"/);
  assert.match(source, /"지금 할 일"/);
  assert.match(source, /"전체 행동표 보기"/);
  assert.match(source, /function policyOverview\(/);
  assert.match(
    source,
    /const arrangedParts = \[[\s\S]*policyDetailsForRender,[\s\S]*\.\.\.parts/,
  );
  assert.doesNotMatch(source, /parts\.splice\(/);
  assert.equal(
    source.match(/for \(let remaining = slots; remaining >= 0; remaining -= 1\)/g)?.length,
    2,
  );
  assert.doesNotMatch(source, /"선택한 주문서 바르기"/);
  assert.match(source, /function selectedScrollName\(\)/);
  const selectedScrollSource = source.slice(
    source.indexOf("function selectedScrollName()"),
    source.indexOf("function policyTable("),
  );
  assert.match(selectedScrollSource, /TRACE_SLOTS\[state\.slot\]\.label/);
  assert.match(selectedScrollSource, /state\.traceRate/);
  assert.match(selectedScrollSource, /state\.method === "earring"/);
  assert.match(selectedScrollSource, /10% 귀 장식 주문서/);
  assert.doesNotMatch(selectedScrollSource, /spam|놀라운 긍정의 혼돈 주문서/);
  assert.match(source, /scrollName:\s*selectedScrollName\(\)/);
  assert.match(source, /restoreName:\s*restore\?\.name/);
  assert.match(source, /resetName:\s*reset\?\.name/);
  assert.match(source, /currentState\.restoreName/);
  assert.match(source, /currentState\.resetName/);
  assert.match(source, /policyDetails\.dataset\.detailsKey = "scroll-policy"/);
  assert.match(source, /policyDetails\.open = policyDetailsOpen/);
  assert.match(source, /policyDetailsOpen = renderedPolicyDetails\.open/);
  assert.match(source, /nextPolicyDetails\.open = policyDetailsOpen/);
  assert.match(source, /line\(\s*"복구"/);
  assert.match(source, /line\("초기화"/);
  assert.match(source, /scroll-policy__cell--current/);
  assert.match(css, /\.page--scroll \.scroll-policy__cell--current/);
  assert.match(css, /\.page--scroll details\.compact-details\.scroll-policy-details/);
  assert.match(css, /\.page--scroll \.scroll-policy-overview/);
});

test("첫작놀긍 전에는 실제 장비 상태와 첫작을 안내하고 정책 좌표를 분리한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const slotResultSource = source.slice(
    source.indexOf("function slotResult()"),
    source.indexOf("function magicalResult()"),
  );
  const policySource = source.slice(
    source.indexOf("function policyView("),
    source.indexOf("function emptyCraftResult()"),
  );

  assert.match(policySource, /displayState/);
  assert.match(policySource, /policyState/);
  assert.match(policySource, /firstActionName/);
  assert.doesNotMatch(policySource, /successOffset/);
  assert.match(policySource, /const recoverableFor = \(entry\)/);
  assert.match(policySource, /"현재 입력"/);
  assert.match(slotResultSource, /displayState:\s*\{/);
  assert.doesNotMatch(slotResultSource, /success:\s*current\.startSuccess/);
  assert.match(slotResultSource, /remaining:\s*current\.startRemaining/);
  assert.match(slotResultSource, /recoverable:\s*current\.recoverable/);
  assert.match(slotResultSource, /policyState:\s*\{/);
  assert.match(slotResultSource, /remaining:\s*startRemaining/);
  assert.match(slotResultSource, /recoverable:\s*craftSlots - startRemaining/);
  assert.match(slotResultSource, /firstActionName:/);
  assert.doesNotMatch(slotResultSource, /successOffset:/);
  assert.match(policySource, /첫작 성공 후 행동표/);
  assert.match(slotResultSource, /firstActionName: first\?\.nextAction/);
});

test("놀긍 설정 용어를 간결하게 하고 반값 OFF·일반 이노를 기본으로 둔다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const stateSource = source.slice(
    source.indexOf("const state ="),
    source.indexOf("try {"),
  );

  assert.match(stateSource, /halfPrice:\s*false/);
  assert.match(stateSource, /preserveStarforce:\s*false/);
  assert.match(source, /element\("p", "section-note", "목표 스탯"\)/);
  assert.doesNotMatch(source, /"함께 판정할 스탯"/);
  assert.match(source, /resetModeSelector\("preserveStarforce"/);
  assert.match(
    source,
    /resetModeSelector\("returnFirstStarforced"/,
  );
  assert.doesNotMatch(source, /스타포스 보존\(아크 이노\)|스타포스 적용됨 \(아크 이노\)/);
});

test("놀긍 100%와 아크 이노센트 100% 보유분을 별도로 입력하고 비용에서 차감한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const stateSource = source.slice(
    source.indexOf("const state ="),
    source.indexOf("try {"),
  );
  const returnResultSource = source.slice(
    source.indexOf("function returnResult()"),
    source.indexOf("function render()"),
  );
  const slotResultSource = source.slice(
    source.indexOf("function slotResult()"),
    source.indexOf("function magicalResult()"),
  );

  assert.match(stateSource, /chaos100Stock:\s*0/);
  assert.match(stateSource, /arkInnocentStock:\s*0/);
  assert.match(source, /field\("보유 놀긍 100% \(장\)", num\("chaos100Stock"/);
  assert.match(source, /field\("보유 아크 이노센트 100% \(장\)", num\("arkInnocentStock"/);
  assert.match(source, /new URL\("\.\.\/workers\/scroll-return\.worker\.js", import\.meta\.url\)/);
  assert.match(returnResultSource, /chaos100Stock:\s*Math\.min\(/);
  assert.match(returnResultSource, /arkInnocentStock:\s*hasFirst/);
  assert.match(returnResultSource, /result\.expected\.ownedChaos100Used/);
  assert.match(returnResultSource, /result\.expected\.purchasedArkInnocent100/);
  assert.match(slotResultSource, /resetStock\(state\.preserveStarforce\)/);
  assert.match(source, /state\.arkInnocentStock/);
  assert.match(source, /const traceKind = preserveStarforce \? "arkInnocent" : "innocent"/);
  assert.ok((source.match(/state\.chaos100Stock/g) ?? []).length >= 2);
  assert.match(source, /resetStock\(state\.returnFirstStarforced\)/);
});

test("리턴은 실제 메소 가격을 사용하고 메포 환산 입력을 표시하지 않는다", async () => {
  const source = await readFile(new URL("../src/pages/scroll.js", import.meta.url), "utf8");
  assert.match(source, /returnMeso: state\.returnPrice \* MAN/);
  assert.match(source, /returnCurrency: "meso"/);
  assert.match(source, /리턴 스크롤 1회 \(만 메소\)/);
  assert.doesNotMatch(source, /field\(\s*"1억 메소당 메이플포인트"/);
  assert.match(source, /result\.costs\.breakdown\.returnMeso/);
});

test("놀긍리턴 결과는 단일 첫 행동 대신 조건별 전체 진행 흐름을 설명한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const flowSource = source.slice(
    source.indexOf("function returnStrategyFlow("),
    source.indexOf("function num("),
  );
  const resultSource = source.slice(
    source.indexOf("function returnResult()"),
    source.indexOf("function render()"),
  );

  assert.ok(flowSource.length > 0, "returnStrategyFlow helper가 있어야 합니다.");
  assert.doesNotMatch(source, /현금 최소 첫 행동/);
  assert.match(resultSource, /returnStrategyFlow\(/);
  assert.match(flowSource, /"진행 흐름"/);

  // 첫작 여부와 남은 작 수에 맞춰 설명이 달라진다.
  assert.match(flowSource, /hasFirst/);
  assert.match(flowSource, /remainderSlots/);
  assert.match(flowSource, /unprotectedChaosScrolls/);

  assert.match(flowSource, /"첫작"/);
  assert.match(flowSource, /"목표 미달"/);
  assert.match(flowSource, /"리턴작"/);
  assert.match(flowSource, /"계산 방식"/);
  assert.match(flowSource, /returnFirstActionName\(initialAction\)/);
  assert.match(flowSource, /"첫작 평균 사용량"/);
  assert.match(flowSource, /returnFirstUsageText\(firstExpected\)/);
  assert.match(flowSource, /리턴 스크롤을 사용하고, 보유 놀긍 100%를 우선 사용하며 없으면 놀긍 60%를 바릅니다/);
  assert.match(flowSource, /현재 누적 수치와 남은 횟수마다 달라집니다/);
  assert.match(flowSource, /개별 결과의 채택 여부를 안내하는 값은 아닙니다/);
  assert.doesNotMatch(flowSource, /유리하면 채택/);
  assert.doesNotMatch(flowSource, /예상 비용이 적은 쪽을 계산기가 자동 선택/);
  assert.doesNotMatch(flowSource, /현금 지출이 가장 적고/);
  assert.doesNotMatch(flowSource, /보유 \$\{ownedChaos100Stock\}장/);

  // 흩어져 있던 전략 설명은 하나의 진행 흐름 안으로 통합한다.
  assert.doesNotMatch(
    resultSource,
    /note\("보유 놀긍 100%는 리턴 스크롤 지출이 가장 적어지는 시점/,
  );
  assert.doesNotMatch(
    resultSource,
    /note\("리턴작은 실제로 채택한 공·마와 스탯을 최종 합계에서 차감/,
  );
});

test("첫작놀긍 뒤에는 첫작을 지우는 이노센트를 후속 전략에서 제외한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const slotResultSource = source.slice(
    source.indexOf("function slotResult()"),
    source.indexOf("function magicalResult()"),
  );

  assert.match(
    slotResultSource,
    /innocentCost: first\s*\? Number\.POSITIVE_INFINITY\s*: \(reset\?\.cost \?\? Number\.POSITIVE_INFINITY\)/s,
  );
  assert.doesNotMatch(slotResultSource, /innocentStockDistribution:/);
  assert.match(
    slotResultSource,
    /첫작놀긍 성공 후 이노센트를 사용하면 첫작도 초기화되므로, 남은 작의 실패는 순백으로만 복구합니다/,
  );
  assert.match(
    slotResultSource,
    /paidResets: result\.expected\.paidInnocents \+ firstPaidResets/,
  );
  assert.doesNotMatch(slotResultSource, /selectedResetStock -/);
});

test("보유 100%와 구매 주문서를 순백·이노센트별 한 카드에 나눠 표시한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const css = await readFile(
    new URL("../src/calculator.css", import.meta.url),
    "utf8",
  );
  const slotResultSource = source.slice(
    source.indexOf("function slotResult()"),
    source.indexOf("function magicalResult()"),
  );

  assert.match(
    slotResultSource,
    /expectedSupportScrollQuantities\(\{/,
  );
  assert.match(slotResultSource, /ownedCleans: result\.expected\.ownedCleans/);
  assert.match(slotResultSource, /paidCleans: result\.expected\.paidCleans/);
  assert.match(slotResultSource, /firstOwnedResets: first\?\.ownedResetsUsed/);
  assert.match(slotResultSource, /firstPaidResets/);
  assert.match(slotResultSource, /supportScrollUsageMetric\("평균 순백"/);
  assert.match(slotResultSource, /cleanStock > 0[\s\S]*label: "보유 100%"/);
  assert.match(slotResultSource, /value: supportScrolls\.ownedClean100/);
  assert.match(slotResultSource, /value: supportScrolls\.purchasedClean/);
  assert.match(slotResultSource, /`평균 \$\{state\.preserveStarforce \? "아크 이노센트" : "이노센트"\}`/);
  assert.match(slotResultSource, /value: supportScrolls\.ownedReset100/);
  assert.match(slotResultSource, /value: supportScrolls\.purchasedReset/);
  assert.doesNotMatch(slotResultSource, /평균 필요/);
  assert.doesNotMatch(slotResultSource, /추가 필요/);
  assert.doesNotMatch(slotResultSource, /평균 복구 성공|평균 초기화 성공/);
  assert.doesNotMatch(slotResultSource, /line\("첫 작 전략"/);
  assert.match(
    slotResultSource,
    /\(first\?\.inventorySavings \?\? 0\)/,
  );
  assert.match(slotResultSource, /line\("보유 주문서로 절약되는 예상 비용", eok\(ownedSupportSavings\)\)/);
  assert.match(slotResultSource, /평균 비용에 이미 반영된 금액입니다/);
  assert.match(css, /\.page--scroll \.metric--support/);
  assert.match(css, /\.support-metric__source--owned/);
  assert.match(css, /\.support-metric__source--paid/);
});

test("순백·이노센트 직접 구매 기준을 첫 작 비용 바로 아래에 표시한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const css = await readFile(
    new URL("../src/calculator.css", import.meta.url),
    "utf8",
  );
  const slotResultSource = source.slice(
    source.indexOf("function slotResult()"),
    source.indexOf("function magicalResult()"),
  );
  const firstCost = slotResultSource.indexOf('first ? line("첫 작 비용"');
  const guide = slotResultSource.indexOf(
    'state.method === "trace" ? supportScrollPurchaseGuide() : null',
  );

  assert.ok(firstCost >= 0 && guide > firstCost);
  assert.match(source, /"순백·이노센트 구매 기준"/);
  assert.match(source, /"이 가격 이하면 구매"/);
  assert.match(source, /경매장에서 주문서를 사는 편이 주흔 100%를 쓰는 것보다 저렴하거나 같습니다/);
  assert.match(source, /복구 1회당 평균 비용이 더 낮은 주문서를 자동으로 사용합니다/);
  assert.doesNotMatch(source, /주흔 100% 대비 구매 상한|1장 구매 상한|비싸지 않으며/);
  assert.match(source, /\["순백 10%", thresholds\.clean10\]/);
  assert.match(source, /\["순백 5%", thresholds\.clean5\]/);
  assert.match(source, /\[\s*"이노센트 50%",\s*thresholds\.innocent50,/);
  assert.match(source, /"흔적 시세 입력 필요"/);
  assert.match(source, /아크 이노 사용 중에는 이노센트 50%를 현재 전략에 사용하지 않습니다/);
  assert.match(source, /이노센트 전략이 꺼져 있어 이노센트 50%를 현재 계산에 사용하지 않습니다/);
  assert.match(css, /\.scroll-purchase-threshold/);
});

test("놀긍리턴은 첫작 즉시 초기화와 누적 목표 전략을 함께 계산한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const resultSource = source.slice(
    source.indexOf("function returnResult()"),
    source.indexOf("function render()"),
  );

  assert.match(source, /requestReturnEconomy\(\{/);
  assert.match(resultSource, /averageAttackTarget: state\.attackTarget/);
  assert.match(resultSource, /averageStatTarget: Number\(state\.statTarget\)/);
  assert.match(resultSource, /progress:\s*\{[\s\S]*completedSlots: appliedWorks/);
  assert.match(resultSource, /attack: currentAttack/);
  assert.match(resultSource, /stat: currentStat/);
  assert.match(resultSource, /chaosRates: \[60, 100\]/);
  assert.doesNotMatch(resultSource, /returnFirstRate/);
  assert.match(resultSource, /returnWork: \{ chaosRate: 60 \}/);
  assert.match(resultSource, /arkInnocent100Meso: reset\?\.cost \?\? 0/);
  assert.match(resultSource, /returnMeso: state\.returnPrice \* MAN/);
  assert.match(resultSource, /"평균 초기화 횟수"/);
  assert.match(resultSource, /result\.expected\.ownedArkInnocent100Used/);
  assert.match(
    resultSource,
    /result\.expected\.remainder\.purchasedChaos60 \* chaosMeso\(60\)/,
  );
  assert.match(resultSource, /line\("남은 작 놀긍 메소", eok\(returnChaosMeso\)\)/);
  assert.match(resultSource, /returnFirstResetChoices\(\)/);
  assert.match(resultSource, /returnStrategyFlow\(\{/);
  assert.match(resultSource, /progress: result\.progress/);
  assert.match(resultSource, /resetName: reset\?\.name/);
  assert.match(resultSource, /initialAction: result\.strategy\.initialAction/);
  assert.match(resultSource, /firstExpected: result\.expected\.first/);
  assert.match(resultSource, /result\.expected\.unprotectedChaosScrolls/);
  assert.match(resultSource, /line\("현재 상태", currentStateText\)/);
  assert.match(resultSource, /line\("남은 목표", remainingTargetText\)/);
  assert.match(
    resultSource,
    /metric\("리턴 없이 적용한 놀긍", times\(unprotectedChaosScrolls\)\)/,
  );
  assert.match(resultSource, /targetText/);
  assert.doesNotMatch(resultSource, /cleanPrice/);
});

test("놀긍리턴의 무거운 계산만 module Worker에서 최신 요청으로 실행한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const workerSource = await readFile(
    new URL("../src/workers/scroll-return.worker.js", import.meta.url),
    "utf8",
  );
  const css = await readFile(
    new URL("../src/calculator.css", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(
    source,
    /from ["']maple-core\/scroll-economy["']/,
    "메인 스레드에서는 놀긍리턴 엔진을 직접 불러오지 않아야 합니다.",
  );
  assert.match(
    workerSource,
    /import \{ calculateChaosReturnEconomy \} from "maple-core\/scroll-economy"/,
  );
  assert.match(workerSource, /calculateChaosReturnEconomy\(options\)/);
  assert.match(
    source,
    /new Worker\([\s\S]*scroll-return\.worker\.js[\s\S]*type: "module"/,
  );
  assert.match(source, /const key = JSON\.stringify\(options\)/);
  assert.match(source, /key === returnEconomyCacheKey/);
  assert.match(source, /stopReturnEconomyWorker\(\);[\s\S]*new Worker\(/);
  assert.match(source, /requestId !== returnEconomyRequestId/);
  assert.match(source, /key !== returnEconomyPendingKey/);
  assert.match(source, /returnEconomyWorker\.terminate\(\)/);
  assert.match(source, /returnCalculationCard\("loading"\)/);
  assert.match(source, /returnCalculationCard\("error", calculation\.message\)/);
  assert.match(source, /놀긍리턴 계산 중/);
  assert.match(css, /\.scroll-return-calculation__spinner/);

  // 주흔·귀지와 매지컬 계산은 기존 동기 경로를 유지한다.
  assert.match(source, /calculateSlotCraft\(\{/);
  assert.match(source, /calculateMagicalReturnCraftProgress\(\{/);
});

test("놀긍리턴은 이미 적용된 작과 현재 상승량에서 남은 목표만 계산한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const stateSource = source.slice(
    source.indexOf("const state ="),
    source.indexOf("try {"),
  );
  const resultSource = source.slice(
    source.indexOf("function returnResult()"),
    source.indexOf("function render()"),
  );

  assert.match(stateSource, /returnAppliedWorks:\s*0/);
  assert.match(stateSource, /returnCurrentAttack:\s*0/);
  assert.match(stateSource, /returnCurrentStat:\s*0/);
  assert.match(source, /function usesReturnFirstWork\(\)/);
  assert.match(source, /!hasAppliedReturnWorks\(\) && state\.returnFirst/);
  assert.match(resultSource, /const hasFirst = appliedWorks === 0 && state\.returnFirst/);
  assert.match(resultSource, /firstWork: hasFirst/);
  assert.match(resultSource, /const reset = hasFirst/);
  assert.match(source, /const needsFirstReset = returnUsesFirst/);
  assert.match(resultSource, /completedSlots: appliedWorks/);
  assert.match(resultSource, /attack: currentAttack/);
  assert.match(resultSource, /stat: currentStat/);
  assert.match(resultSource, /이미 적용된 주문서와 비용은 제외하고/);
});

test("놀긍리턴 부분 진행 입력은 카드 행을 유지한 채 필요한 칸만 전환한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const css = await readFile(
    new URL("../src/calculator.css", import.meta.url),
    "utf8",
  );
  const renderSource = source.slice(source.indexOf("function render()"));
  const chaosStart = renderSource.indexOf('"놀긍 설정"');
  const equipmentStart = renderSource.indexOf("const equipmentContent =");
  const equipmentEnd = renderSource.indexOf('if (method.kind === "magical")', equipmentStart);
  const costStart = renderSource.indexOf('if (method.kind !== "magical")');
  const costEnd = renderSource.indexOf('if (state.method === "trace")', costStart);
  const chaosSource = renderSource.slice(chaosStart, equipmentStart);
  const equipmentSource = renderSource.slice(equipmentStart, equipmentEnd);
  const costSource = renderSource.slice(costStart, costEnd);
  const numStart = source.indexOf("function num(");
  const numEnd = source.indexOf("function toggle(", numStart);
  const numSource = source.slice(numStart, numEnd);

  assert.match(chaosSource, /returnFirstWorkOption\(hasReturnProgress\)/);
  assert.match(
    chaosSource,
    /"returnFirstAttack"[\s\S]*disabled: hasReturnProgress \|\| !state\.returnFirst/,
  );
  assert.match(
    chaosSource,
    /"returnFirstStat"[\s\S]*disabled: hasReturnProgress \|\| !state\.returnFirst/,
  );
  assert.doesNotMatch(chaosSource, /!hasReturnProgress[\s\S]*returnFirstWorkOption/);
  assert.match(
    equipmentSource,
    /method\.kind === "return"[\s\S]*"returnCurrentAttack"[\s\S]*disabled: !hasReturnProgress/,
  );
  assert.match(
    equipmentSource,
    /"returnCurrentStat"[\s\S]*disabled: !hasReturnProgress/,
  );
  assert.doesNotMatch(equipmentSource, /hasReturnProgress\s*\?\s*row/);
  assert.match(costSource, /method\.kind === "return"[\s\S]*disabled: !needsFirstReset/);
  assert.match(
    numSource,
    /key === "returnAppliedWorks"[\s\S]*state\.returnCurrentAttack = 0[\s\S]*state\.returnCurrentStat = 0/,
  );
  assert.match(css, /\.page--scroll input:disabled\s*\{[^}]*opacity:\s*0\.5/s);
});

test("주문서 목표 초기화는 시세와 작 방식을 보존하고 장비 버튼은 표시하지 않는다", async () => {
  const source = await readFile(new URL("../src/pages/scroll.js", import.meta.url), "utf8");
  const start = source.indexOf("function resetScrollTargets()");
  const end = source.indexOf("\nfunction ", start + 1);
  assert.ok(start >= 0 && end > start);
  const initialSettings = {
    itemLevel: 200, remaining: 8, returnAppliedWorks: 0, returnCurrentAttack: 0, returnCurrentStat: 0,
    attackTarget: 6, statTarget: 2, stats: { STR: true, DEX: false },
  };
  const state = {
    method: "chaosReturn", itemLevel: 250, remaining: 3, returnAppliedWorks: 2,
    returnCurrentAttack: 12, returnCurrentStat: 7, attackTarget: 5, statTarget: 4,
    returnPrice: 9999, chaos60Price: 555, maplePointsPerEok: 2300, cleanStock: 8,
    stats: { STR: false, DEX: true },
  };
  let renders = 0;
  const reset = new Function("state", "initialSettings", "render", `${source.slice(start, end)}; return resetScrollTargets;`)(state, initialSettings, () => { renders++; });
  reset();
  for (const [key, value] of Object.entries(initialSettings)) assert.deepEqual(state[key], value);
  assert.equal(state.method, "chaosReturn");
  assert.equal(state.returnPrice, 9999);
  assert.equal(state.chaos60Price, 555);
  assert.equal(state.maplePointsPerEok, 2300);
  assert.equal(state.cleanStock, 8);
  assert.equal(renders, 1);
  state.stats.STR = false;
  assert.equal(initialSettings.stats.STR, true);
  assert.doesNotMatch(source, /returnProgressResetButton|reset-return-progress/);
});

test("놀긍리턴 비용 설정은 첫작 확률 선택 없이 60%와 100% 시세를 항상 받는다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const renderSource = source.slice(source.indexOf("function render()"));

  assert.match(
    renderSource,
    /field\("놀긍 60% \(만 메소\)", num\("chaos60Price"/,
  );
  assert.match(
    renderSource,
    /field\("놀긍 100% \(만 메소\)", num\("chaos100Price"/,
  );
  assert.doesNotMatch(renderSource, /state\.returnFirstRate === 100/);
  assert.match(source, /hasFirst && !\(state\.chaos100Price > 0\)/);
  assert.match(source, /놀긍 60%와 100% 시세를 입력해 주세요/);
});

test("슬롯 첫작 계산은 저장된 확률 선택과 무관하게 자동 전략을 사용한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const firstCostSource = source.slice(
    source.indexOf("function chaosFirstCost("),
    source.indexOf("function slotResult()"),
  );

  assert.match(firstCostSource, /calculateAutomaticFirstChaos\(\{/);
  assert.match(firstCostSource, /chaos60Cost: chaosMeso\(60\)/);
  assert.match(firstCostSource, /chaos100Stock: state\.chaos100Stock/);
  assert.doesNotMatch(firstCostSource, /state\.chaosRate/);
});

test("놀긍리턴 상단 요약에서 1회 확률과 공마 최소 환산 박스를 제거한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const resultSource = source.slice(
    source.indexOf("function returnResult()"),
    source.indexOf("function render()"),
  );

  assert.doesNotMatch(resultSource, /metric\("한 번에 뜰 확률"/);
  assert.doesNotMatch(resultSource, /metric\("공·마 최소 환산"/);
});

test("놀긍리턴은 메소 지출을 강조하고 평균 목표와 중복 없는 지출 내역을 표시한다", async () => {
  const source = await readFile(
    new URL("../src/pages/scroll.js", import.meta.url),
    "utf8",
  );
  const resultSource = source.slice(
    source.indexOf("function returnResult()"),
    source.indexOf("function render()"),
  );

  assert.match(resultSource, /"예상 필요 메소"/);
  assert.match(resultSource, /eokMeso\(totalMeso\)/);
  assert.match(resultSource, /metric\("리턴 구매에 필요한 예상 메소", eokMeso\(cashAsMeso\)\)/);
  assert.match(resultSource, /metric\("그 외 예상 메소", eokMeso\(mesoTotal\)\)/);
  assert.match(resultSource, /metric\("평균 놀긍 사용량", sheets\(result\.expected\.chaosScrolls\)\)/);
  assert.doesNotMatch(resultSource, /첫작 예상 놀긍 수|firstChaosCount/);
  assert.doesNotMatch(resultSource, /metric\("예상 놀긍",/);
  assert.match(resultSource, /metric\("평균 리턴 스크롤 사용량", sheets\(result\.expected\.returnScrolls\)\)/);
  assert.match(
    resultSource,
    /result\.expected\.purchasedChaos100 \+ result\.expected\.ownedChaos100Used/,
  );
  assert.match(
    resultSource,
    /metric\("그중 놀긍 100%", sheets\(expectedChaos100\)\)/,
  );
  assert.match(resultSource, /metric\(\s*"평균 초기화 횟수"/);
  assert.match(resultSource, /`스탯 평균 \$\{result\.goals\.averageStat/);
  assert.doesNotMatch(resultSource, /`\$\{picked\} 합 \$\{result\.goals\.averageStat/);
  assert.doesNotMatch(resultSource, /resultHero\("평균 메소 비용"/);
  assert.doesNotMatch(resultSource, /line\("평균 리턴"/);
  assert.doesNotMatch(resultSource, /line\("리턴 값"/);
});
