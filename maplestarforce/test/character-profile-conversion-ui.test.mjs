import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

const originalStorage = globalThis.localStorage;
globalThis.localStorage = memoryStorage();
const {
  combatRingSummary,
  baselineSkillSummary,
  needsBaselineSkillRefresh,
  hasCurrentEquipmentTooltipData,
  needsEquipmentTooltipRefresh,
  shouldShowCharacterProfileWarning,
  shouldKeepNewerSavedCharacterData,
  toBossDamagePercentEquivalent,
  xenonMainPercentToDamagePercent,
  levelTwoStatBonus,
} = await import(
  "../src/shared/character-profile.js?conversion-ui"
);

test("반지 피해 비중·시간 가동률·상시 유지를 구별해 표시한다", () => {
  const profile = {
    attackType: "attack",
    details: { combatDurationSeconds: 180, combatRings: [
      { name: "리스트레인트 링", level: 6, activationMode: "battle-practice-damage-weighted", damageCoverage: 0.186534642788, timeUptime: 1 / 6, uptime: 0.186534642788, averageAttackPercent: 15.85544463698 },
      { name: "컨티뉴어스 링", level: 6, activationMode: "boss-entry-maintained", uptime: 1, averageAttackPercent: 14, averageBossDamage: 54 },
      { name: "웨폰퍼프 링", activationMode: "cycle-time-fallback", timeUptime: 0.2, uptime: 0.2 },
    ] },
  };
  const summary = combatRingSummary(profile);
  assert.match(summary, /반지 적용 구간 피해 비중 18\.7% · 공·마 평균 \+15\.86%/u);
  assert.match(summary, /보스전 상시 유지 · 공·마 평균 \+14% · 보공 평균 \+54%/u);
  assert.match(summary, /3분 기준 시간 가동률 20\.0%/u);
  assert.doesNotMatch(summary, /6분 평균 가동/u);
});

test.after(() => {
  if (originalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalStorage;
});

test("주스탯%급을 데미지%급으로 같은 기준에서 환산한다", () => {
  assert.equal(toBossDamagePercentEquivalent(1.19, 1.19), 1);
  assert.ok(
    Math.abs(toBossDamagePercentEquivalent(0.301, 1.19) - 0.2529411765) < 1e-9,
  );
  assert.equal(toBossDamagePercentEquivalent(10, 0), null);
  assert.equal(toBossDamagePercentEquivalent(Number.NaN, 1), null);
});

test("렙당2는 캐릭터 레벨의 9레벨 경계를 적용하고 정보가 없으면 환산하지 않는다", () => {
  assert.equal(levelTwoStatBonus(287), 62);
  assert.equal(levelTwoStatBonus(288), 64);
  assert.equal(levelTwoStatBonus(290), 64);
  assert.equal(levelTwoStatBonus(300), 66);
  assert.equal(levelTwoStatBonus("290"), 64);
  for (const level of [undefined, null, "", 0, -1, 290.5, NaN]) {
    assert.equal(levelTwoStatBonus(level), null);
  }
});

test("제논 개별 스탯%는 STR% 기준 단위를 써서 합계가 올스탯%와 일치한다", () => {
  const statEquivalence = {
    allStatPercentToMainPercent: 3.3,
    statPercentToMainPercentByStat: { STR: 1, DEX: 1.1, LUK: 1.2 },
  };
  const addOptionEquivalence = {
    allStatPercentToDamagePercent: 1,
  };
  const individual = ["STR", "DEX", "LUK"].map((stat) =>
    xenonMainPercentToDamagePercent(
      statEquivalence.statPercentToMainPercentByStat[stat],
      statEquivalence,
      addOptionEquivalence,
    )
  );

  assert.ok(individual.every((value) => value < 1));
  assert.ok(Math.abs(individual.reduce((sum, value) => sum + value, 0) - 1) < 1e-12);
  assert.equal(
    xenonMainPercentToDamagePercent(1, {}, addOptionEquivalence),
    null,
  );
});

test("캐릭터 카드에서는 일반 크리티컬 확률 경고만 숨기고 추정 안내를 표시한다", async () => {
  assert.equal(
    shouldShowCharacterProfileWarning(
      "샤프 아이즈 계열과 직업 보정을 포함한 보스전 크리티컬 확률이 95%로 100% 미만입니다. 크리티컬 데미지 환산은 크리티컬 확률 100%를 가정했습니다.",
    ),
    false,
  );
  assert.equal(
    shouldShowCharacterProfileWarning(
      "샤프 아이즈 계열과 보스 대상 보정을 포함한 기본 크리티컬 확률이 40%로 100% 미만입니다. 그로기 마스터리에서는 100%입니다.",
    ),
    false,
  );
  assert.equal(
    shouldShowCharacterProfileWarning("캐릭터 이미지 정보가 없습니다."),
    true,
  );

  const source = await readFile(
    new URL("../src/shared/character-profile.js", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /각 옵션의 가치는 메이플스토리 데미지 계산식, 각 직업의 스킬 수치, 연무장 데이터를 기반으로 추정한 값입니다\. 오차가 있을 수 있습니다\./u,
  );
  assert.match(
    source,
    /if \(shouldShowCharacterProfileWarning\(warning\)\)/u,
  );
  assert.ok(!source.includes(
    "캐릭터명은 Cloudflare 서버로 보내며, 서버가 사이트의 NEXON API 키로 조회합니다. API 키는 브라우저에 보내지 않고, 툴팁에 필요한 공개 장비 필드만 전달합니다.",
  ));
});

test("출처와 무관하게 같은 캐릭터의 더 오래된 응답은 저장값을 덮지 않는다", () => {
  const saved = {
    character: { name: "테스트캐릭터" },
    dataFreshness: {
      source: "nexon",
      fetchedAt: "2026-09-09T06:00:00.000Z",
    },
  };
  assert.equal(shouldKeepNewerSavedCharacterData(
    saved,
    "테스트캐릭터",
    { source: "snapshot-cache", fetchedAt: "2026-09-09T05:59:59.000Z" },
  ), true);
  assert.equal(shouldKeepNewerSavedCharacterData(
    saved,
    "테스트캐릭터",
    { source: "stale-cache", fetchedAt: "2026-09-09T06:00:01.000Z" },
  ), false);
  assert.equal(shouldKeepNewerSavedCharacterData(
    saved,
    "다른캐릭터",
    { source: "stale-cache", fetchedAt: "2026-09-09T05:00:00.000Z" },
  ), false);
});

test("원본 툴팁이 없는 구형 장비 저장본만 자동 갱신 대상으로 고른다", async () => {
  const legacy = {
    version: 9,
    items: [{ name: "고통의 근원", potentialMainStatPercent: 30 }],
  };
  const current = {
    version: 12,
    items: [{ name: "고통의 근원", tooltip: { potentialLines: [] } }],
  };
  const malformedCurrent = {
    version: 12,
    items: [{ name: "고통의 근원" }],
  };

  assert.equal(hasCurrentEquipmentTooltipData(legacy), false);
  assert.equal(needsEquipmentTooltipRefresh(legacy), true);
  assert.equal(hasCurrentEquipmentTooltipData(current), true);
  assert.equal(needsEquipmentTooltipRefresh(current), false);
  assert.equal(needsEquipmentTooltipRefresh(malformedCurrent), true);
  assert.equal(hasCurrentEquipmentTooltipData({ version: 12, items: [] }), true);

  const source = await readFile(
    new URL("../src/shared/character-profile.js", import.meta.url),
    "utf8",
  );
  const migration = source.slice(
    source.indexOf("function scheduleEquipmentTooltipRefresh"),
    source.indexOf("function saveCharacterName"),
  );
  assert.match(source, /scheduleEquipmentTooltipRefresh\(activeName\)/u);
  assert.match(migration, /equipmentTooltipRefreshAttempts\.has\(attemptKey\)/u);
  assert.match(migration, /equipmentTooltipRefreshAttempts\.add\(attemptKey\)/u);
  assert.match(migration, /equipmentTooltipUpgrade: true/u);
  assert.doesNotMatch(migration, /refresh:\s*true/u);
  assert.match(
    source,
    /if \(!refresh && equipmentTooltipUpgrade\) requestOptions\.cache = "reload"/u,
  );
});

test("일반 직업 환산 카드는 옵션 단위와 380% 방무 기준을 직접 적는다", async () => {
  const source = await readFile(
    new URL("../src/shared/character-profile.js", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /"주스탯%급\(윗줄\) · 데미지%급\(아랫줄\)"/,
  );
  assert.match(source, /"각 옵션의 가치"/);
  assert.match(source, /profile-coefficient__amount/);
  assert.match(source, /amount\.value = "10"/);
  assert.match(source, /basis: "주스탯"/);
  assert.match(source, /basis: "데미지"/);
  assert.match(source, /digits: 2,/);
  assert.match(source, /suffix: "% 급"/);
  assert.match(source, /profile-coefficient__comparison/);
  assert.doesNotMatch(source, /풀도핑 방어율 무시/);
  assert.match(source, /`전투복 · \$\{combatOutfitSummary\}`/);
  assert.match(source, /`전투복 · \$\{item\}`/);
  assert.match(source, /`마스터라벨 플러스 · \$\{masterLabelPlus\}`/);
  assert.match(source, /needsCashEquipmentDisplayRefresh/);
  assert.doesNotMatch(source, /방어율 300%/);
  assert.match(source, /방무 \+40% \(380\)/);
  assert.match(source, /optionLabel.*match\[3\].*match\[4\]/s);
  assert.match(source, /match\[1\]\.replace\(\/\\\+\\s\*\$\/u, ""\)/);

  const orderedLabels = [
    'standardCoefficient("보공 +1%"',
    'standardCoefficient(`${attackLabel} +1%`',
    'standardCoefficient("방무 +40% (380)"',
    'standardCoefficient("크리티컬 데미지 +1%"',
    'standardCoefficient("올스탯 +1%"',
    "...subStatPercentCoefficients",
    'standardCoefficient(`주스탯(${active.mainStat}) +1`',
    "...subStatCoefficients",
    'standardCoefficient(`${attackLabel} +1`',
  ];
  orderedLabels.reduce((previous, label) => {
    const index = source.indexOf(label, previous + 1);
    assert.ok(index > previous, `${label} 순서를 지켜야 합니다.`);
    return index;
  }, -1);

  assert.ok(
    source.indexOf("summary.append(coefficients)") <
      source.indexOf("if (dopingDetails) summary.append(dopingDetails)"),
    "각 옵션의 가치는 풀도핑보다 먼저 표시해야 합니다.",
  );
});

test("제논과 데몬어벤져의 전용 환산 단위도 값마다 명시한다", async () => {
  const source = await readFile(
    new URL("../src/shared/character-profile.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /conventionalAddOption \? "관행 추옵" : "데미지"/);
  assert.match(source, /"옵션별 데몬어벤져 관행 추옵 점수"/);
  assert.match(source, /"옵션별 제논 전용 데미지% 환산"/);
  assert.match(
    source,
    /active\.statModel === "xenon" &&\s*equipmentMetric !== "flame"/,
  );
  for (const label of [
    '"보공 +1%"',
    '"방무 +40% (380)"',
    '"크리티컬 데미지 +1%"',
    '"올스탯 +1%"',
    '`${stat} +1%`',
    '`${stat} +1`',
  ]) {
    assert.ok(source.includes(label), `${label} 항목을 표시해야 합니다.`);
  }
  assert.match(source, /basis: "데미지"/);
  assert.doesNotMatch(source, /% 데미지급/);
});

test("풀 보스 도핑의 합산 수치와 적용 버프를 캐릭터 카드에서 확인한다", async () => {
  const [source, css] = await Promise.all([
    readFile(
      new URL("../src/shared/character-profile.js", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/calculator.css", import.meta.url), "utf8"),
  ]);

  assert.match(source, /FULL_BOSS_DOPING/);
  assert.match(source, /STR·DEX·LUK 각각/);
  assert.match(source, /방무.*각각 적용/);
  assert.match(source, /`적용 버프 \$\{appliedItems\.length\}개 보기`/);
  assert.match(source, /\.\.\.FULL_BOSS_DOPING\.items/);
  assert.match(source, /combatRingSummary/);
  assert.match(source, /guildNoblesseSkills/);
  assert.match(source, /classDopingSummary/);
  assert.match(source, /classAlwaysOnCombatSummary/);
  assert.match(source, /기본 전투 설정/);
  assert.match(source, /collapsed \? "details" : "section"/);
  assert.match(source, /collapseReferenceDetails \? "details" : "div"/);
  assert.match(css, /\.profile-doping__items\s*{[^}]*grid-template-columns:\s*repeat\(2/s);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.profile-doping__items\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("잠재·에디셔널·추가옵션은 환산 상세 정보를 기본 접힘으로 요청한다", async () => {
  const [potential, addOption] = await Promise.all([
    readFile(new URL("../src/shared/potential-page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/pages/add-option.js", import.meta.url), "utf8"),
  ]);

  assert.match(potential, /collapseReferenceDetails: true/);
  assert.match(addOption, /collapseReferenceDetails: true/);
});

test("두 환산값은 작은 카드 안에서 주값과 비교값으로 구분한다", async () => {
  const css = await readFile(
    new URL("../src/calculator.css", import.meta.url),
    "utf8",
  );

  assert.match(css, /\.profile-coefficients__caption\s*{[^}]*grid-column:\s*1 \/ -1/s);
  assert.match(css, /\.profile-coefficient__equivalents\s*{/);
  assert.match(css, /\.profile-coefficient__comparison\s*{[^}]*font-size:\s*0\.68rem/s);
});


test("현재 이벤트 스킬은 실제 보너스를 표시하고 빈 내역도 갱신 완료로 취급한다", () => {
  assert.equal(baselineSkillSummary({name:"훈련 일지",effects:{attack:40,magic:40,allStat:80,bossDamage:40,ignoreDefenseSources:[40]}}),
    "훈련 일지 (공·마 +40, 올스탯 +80, 보공 +40%, 방무 40%)");
  assert.equal(needsBaselineSkillRefresh({details:{}}),true);
  assert.equal(needsBaselineSkillRefresh({details:{baselineSkills:[]}}),false);
  assert.equal(needsBaselineSkillRefresh(null),false);
});
