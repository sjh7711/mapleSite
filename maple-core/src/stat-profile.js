/**
 * 캐릭터 스탯 환산에 사용하는 공용 프리셋과 직업별 스탯 추론.
 * Node, Discord, DOM에 의존하지 않아 브라우저와 Worker에서도 그대로 쓴다.
 */

export const CHARACTER_CONVERSION_CACHE_VERSION = "combat-profile-v99-full-sayram-collector-levels";

// 넥슨 유니온 챔피언 가이드의 전투 능력치 5레벨 기준.
// https://maplestory.nexon.com/Guide/N23GameInformation/Articles/409
const CHAMPION_BLESSING_LEVEL_5 = {
  level: 5,
  attackMagic: 25,
  allStat: 50,
  hp: 2_500,
  bossDamage: 10,
  criticalDamage: 2.5,
  ignoreDefense: 10,
};

// Collector is taken just before entering the reference fight.
const ELIXIR_REFERENCE_SECONDS = 1_200;
const ELIXIR_BURST_INTERVAL_SECONDS = 120;
// Estimated extra damage from bursts, compared with a constant sustained rate.
// Calibrated from the 380-defense Bowmaster elixir comparison, shared by all jobs.
const ELIXIR_BURST_EXTRA_DAMAGE_SHARE = 0.43;

function bossElixirDamageCoverage(durationSeconds) {
  const duration = Math.min(Math.max(0, durationSeconds), ELIXIR_REFERENCE_SECONDS);
  if (duration === 0) return 0;
  const timeShare = duration / ELIXIR_REFERENCE_SECONDS;
  const burstCount = Math.ceil(ELIXIR_REFERENCE_SECONDS / ELIXIR_BURST_INTERVAL_SECONDS);
  // The burst at the 8-minute boundary is assumed to land just before expiry.
  const coveredBursts = Math.min(burstCount, 1 + Math.floor(duration / ELIXIR_BURST_INTERVAL_SECONDS));
  return timeShare * (1 - ELIXIR_BURST_EXTRA_DAMAGE_SHARE) +
    (coveredBursts / burstCount) * ELIXIR_BURST_EXTRA_DAMAGE_SHARE;
}

// https://maplestory.nexon.com/news/update/750
export const SAYRAM_ELIXIR = { duration: 900, attackMagic: 50, attackMagicPercent: 10, bossDamage: 10, hp: 1_750 };
// https://maplestory.nexon.com/news/update/774?page=3
const COLLECTOR_ELIXIR = { duration: 480, attackMagic: 100, allStat: 30, hp: 400, skillLevels: 2 };
// The full boss profile applies Sayram at its listed strength.
const sayramCoverage = 1;
const collectorCoverage = bossElixirDamageCoverage(COLLECTOR_ELIXIR.duration);

export const FULL_BOSS_DOPING = {
  label: "풀도핑 (고급 무기 제련·이벤트 버프 포함)",
  championBlessingLevel: CHAMPION_BLESSING_LEVEL_5.level,
  sayramCriticalDamage: 16,
  sayramCriticalRate: 20,
  sayramCoverage,
  collectorCoverage,
  collectorSkillLevels: COLLECTOR_ELIXIR.skillLevels,
  items: [
    "익스트림 레드/블루",
    "마슈르의 선물 기상 효과",
    "유니온의 힘",
    "붕어빵 뿌리기",
    "MVP 슈퍼파워",
    "향상된 10단계 주스탯 물약",
    "반짝이는 빨간 별 물약",
    "세이람의 영약 (공·마 +10%)",
    "콜렉터의 영약",
    "영웅의 메아리 계열 (공·마 +4%)",
    "고급 무기 제련",
    "이벤트 버프",
    "쓸만한 샤프 아이즈",
  ],
  totals: {
    // 기존 공·마 325와 보공 75 중 세이람 효과를 분리하고 영약별 피해 비중을 적용한다.
    // 쓸만한 어드밴스드 블레스의 공·마는 기본 합산에 있어 사용 구간에서 교체한다.
    attackMagic: 275 + CHAMPION_BLESSING_LEVEL_5.attackMagic +
      SAYRAM_ELIXIR.attackMagic * sayramCoverage + COLLECTOR_ELIXIR.attackMagic * collectorCoverage,
    attackMagicPercent: 4 + SAYRAM_ELIXIR.attackMagicPercent * sayramCoverage,
    mainStat: 75 + CHAMPION_BLESSING_LEVEL_5.allStat + COLLECTOR_ELIXIR.allStat * collectorCoverage,
    subStat: 75 + CHAMPION_BLESSING_LEVEL_5.allStat + COLLECTOR_ELIXIR.allStat * collectorCoverage,
    hp: CHAMPION_BLESSING_LEVEL_5.hp + SAYRAM_ELIXIR.hp * sayramCoverage +
      COLLECTOR_ELIXIR.hp * collectorCoverage,
    // 같은 프리셋의 무도핑·풀도핑 툴팁 차이. 길드 기준 수치는
    // 아래 guildBaseline을 통해 캐릭터의 실제 노블레스 수치로 교체한다.
    bossDamage: 65 + CHAMPION_BLESSING_LEVEL_5.bossDamage + SAYRAM_ELIXIR.bossDamage * sayramCoverage,
    damage: 31,
    // 노블레스 30%, 무기 제련 5%, 챔피언의 가호. 세이람/샤프는
    // 중첩 제한이 있는 효과로 전투 조건에서 선택한다.
    criticalDamage: 30 + 5 + CHAMPION_BLESSING_LEVEL_5.criticalDamage,
    ignoreDefense: 15,
    ignoreDefenseSources: [15, CHAMPION_BLESSING_LEVEL_5.ignoreDefense],
    // 보스 효율은 짧은 극딜 한 번이 아니라 6분 전투로 비교한다.
    // 패시브 특수 반지는 상시 적용하고, 액티브 특수 반지는 직업별
    // 연무장 타임라인에서 측정한 극딜 구간 피해 비중으로 환산한다.
    combatDurationSeconds: 360,
    includeEquippedRing: true,
  },
  // 기존 공통 합계에 포함해 두었던 45포인트 길드 기준이다. 실제 길드의
  // 노블레스 배분을 조회하면 이 값과의 차이만큼 보정한다.
  guildBaseline: {
    bossDamage: 30,
    damage: 30,
    criticalDamage: 30,
    ignoreDefenseSources: [],
  },
  classAdjustments: {
    // 크리티컬 리인포스의 크확 계산에는 외부 도핑을 제외한다.
    보우마스터: { criticalRate: 10 },
    신궁: { criticalRate: 10 },
    패스파인더: { criticalRate: 10 },
    윈드브레이커: { criticalRate: 10 },
    와일드헌터: { criticalRate: 10 },
    // 메르세데스의 스피릿 인퓨젼처럼 영구 패시브인 크확은 Nexon 최종
    // 스탯에 이미 들어 있으므로 이 호환 보정표에서 다시 더하지 않는다.
    제논: { criticalRate: 40 },
    // 크리티컬 레이지의 보스 대상 효과와 그로기 마스터리의
    // 상태이상 대상 효과는 스탯창의 일반 크확과 분리해 표시한다.
    바이퍼: {
      bossCriticalRate: 20,
      conditionalBossCriticalRate: 60,
      conditionalBossCriticalRateSource: "그로기 마스터리 · 상태이상 대상",
    },
  },
};

/**
 * 외부 도핑과 무관하게 보스전에서 항상 켜는 직업 전투 설정.
 *
 * 최종 스탯 API에는 지속형 온·오프 스킬이 안정적으로 반영되지 않으므로
 * 장비 옵션 효율에 직접 영향을 주는 효과만 명시적으로 더한다. 공격을
 * 발생시키기만 하는 소환·사출기와 최종 데미지는 정적 옵션 환산 비율에
 * 영향을 주지 않아 이 표에 넣지 않는다.
 */
export const CLASS_ALWAYS_ON_COMBAT = Object.freeze({
  제논: Object.freeze({
    // 스탯창에 안정적으로 포함되지 않는 "공격 시" 조건부 효과다.
    // 보스 전투 중에는 항상 충족되며, 공식 스킬 보유 여부를 확인한 뒤
    // 별도의 방무 출처로 적용한다.
    defaultMode: "오펜시브 매트릭스",
    sources: Object.freeze(["오펜시브 매트릭스"]),
    learnedSkillAdjustments: Object.freeze({
      "오펜시브 매트릭스": Object.freeze({
        ignoreDefenseSources: Object.freeze([30]),
      }),
    }),
  }),
  보우마스터: Object.freeze({
    // 보스전 공격 속도에서는 30회 적중 조건을 5초 안에 다시 채워
    // 모탈 블로우의 데미지 증가가 사실상 상시 유지된다.
    defaultMode: "모탈 블로우",
    sources: Object.freeze(["모탈 블로우"]),
    damage: 35,
  }),
  신궁: Object.freeze({
    // 모탈 블로우는 보스전 연속 타격에서 발동 상태를 사실상 유지한다.
    // 공식 스킬 설명의 최대 효과를 기준으로 계산한다.
    defaultMode: "모탈 블로우",
    sources: Object.freeze(["모탈 블로우"]),
    damage: 20,
  }),
  배틀메이지: Object.freeze({
    defaultMode: "다크 오라",
    sources: Object.freeze(["배틀 레이지", "다크 오라"]),
    damage: 35,
    criticalDamage: 10,
    learnedSkillAdjustments: Object.freeze({
      "다크 오라-보스 킬러": Object.freeze({
        bossDamage: 5,
      }),
    }),
  }),
});

// 궁수 공용 5차 스킬 크리티컬 리인포스는 크확 100% 초과분도
// 크리티컬 데미지로 바꾼다. 모든 궁수 직업군이 사용할 수 있다.
export const CRITICAL_REINFORCE_CLASSES = new Set([
  "보우마스터",
  "신궁",
  "패스파인더",
  "윈드브레이커",
  "와일드헌터",
  "메르세데스",
  "카인",
]);

const CLASS_MAIN_STATS = {
  STR: new Set([
    "히어로", "팔라딘", "다크나이트", "바이퍼", "캐논마스터",
    "소울마스터", "미하일", "스트라이커", "아란", "은월",
    "블래스터", "데몬슬레이어", "카이저", "아델", "아크", "제로",
    "렌",
  ]),
  DEX: new Set([
    "보우마스터", "신궁", "패스파인더", "캡틴", "윈드브레이커",
    "메르세데스", "와일드헌터", "메카닉", "카인", "엔젤릭버스터",
  ]),
  INT: new Set([
    "아크메이지(불,독)", "아크메이지(썬,콜)", "비숍", "플레임위자드",
    "에반", "루미너스", "배틀메이지", "일리움", "라라", "키네시스", "린", "레테",
  ]),
  LUK: new Set([
    "나이트로드", "섀도어", "듀얼블레이더", "나이트워커", "팬텀",
    "카데나", "칼리", "호영",
  ]),
};

const DEFAULT_SUB_STATS = {
  STR: "DEX",
  DEX: "STR",
  INT: "LUK",
  LUK: "DEX",
};

const DUAL_SUB_STAT_CLASSES = new Set([
  "섀도어",
  "듀얼블레이더",
  "카데나",
]);

export function inferPotentialStatProfile(characterClass) {
  const normalizedClass = String(characterClass ?? "").trim();
  const canonicalClass =
    normalizedClass === "듀얼블레이드"
      ? "듀얼블레이더"
      : normalizedClass;
  if (canonicalClass === "제논") {
    return {
      supported: true,
      model: "xenon",
      mainStat: "ALL",
      mainStats: ["STR", "DEX", "LUK"],
      subStat: null,
      attackType: "attack",
    };
  }
  if (canonicalClass === "데몬어벤져") {
    return {
      supported: true,
      model: "demon-avenger",
      mainStat: "HP",
      mainStats: ["HP"],
      subStat: "STR",
      attackType: "attack",
    };
  }
  const mainStat = Object.entries(CLASS_MAIN_STATS).find(([, classes]) =>
    classes.has(canonicalClass),
  )?.[0];
  if (!mainStat) {
    return { supported: false, reason: "직업의 주스탯을 자동 판별하지 못함" };
  }
  const subStat = DEFAULT_SUB_STATS[mainStat];
  return {
    supported: true,
    model: "standard",
    mainStat,
    // subStat은 기존 호출부 호환을 위해 첫 번째 부스탯으로 유지한다.
    subStat,
    ...(DUAL_SUB_STAT_CLASSES.has(canonicalClass)
      ? { subStats: [subStat, "STR"] }
      : {}),
    attackType: mainStat === "INT" ? "magic" : "attack",
  };
}
