import { VERIFIED_SOUL_DOMAINS } from "./reform-live-verification-2026-09-17.js";
/**
 * 2026-09-17 강화 개편의 공식 규칙 스냅샷.
 *
 * 이 파일은 테스트월드 공지와 공식 확률형 아이템 페이지에서 확인한 값만
 * 담는다. 아직 공개되지 않은 확률은 추정값으로 채우지 않고 `null` 및
 * `pendingOfficialFields`로 남겨, 계산기가 불완전한 표를 실수로 사용하지
 * 못하게 한다.
 */

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const REFORM_2026_09_17_SOURCES = deepFreeze({
  liveUpdate: { title: "클라이언트 1.2.419 업데이트", url: "https://maplestory.nexon.com/news/update/813", publishedDate: "2026-09-17" },
  soulPotentialProbability: { title: "소울 잠재능력 공식 확률", url: "https://maplestory.nexon.com/Guide/OtherProbability/cube/Soulpotential", capturedDate: "2026-09-17" },
  testworldUpdate: {
    title: "클라이언트 1.2.206 릴리즈(이벤트, 컨텐츠, 개선사항 및 오류 수정)",
    url: "https://maplestory.nexon.com/testworld/news/all/199",
    publishedDate: "2026-09-10",
  },
  testworldSkillUpdate: {
    title: "클라이언트 1.2.206 릴리즈(스킬 조정)",
    url: "https://maplestory.nexon.com/testworld/news/all/198",
    publishedDate: "2026-09-10",
  },
  scrollProbability: {
    title: "확률형 아이템 - 주문서/스크롤",
    url: "https://maplestory.nexon.com/Guide/OtherProbability/game/gameOrderSheet",
    capturedDate: "2026-09-11",
  },
  scrollGuide: {
    title: "게임정보 - 주문서 강화",
    url: "https://maplestory.nexon.com/Guide/N23GameInformation/Articles/374",
    capturedDate: "2026-09-11",
  },
  guildGuide: {
    title: "게임정보 - 길드",
    url: "https://maplestory.nexon.com/Guide/N23GameInformation/Articles/389",
    capturedDate: "2026-09-11",
  },
  abilityHonorProbability: {
    title: "확률형 아이템 - 명성치",
    url: "https://maplestory.nexon.com/Guide/OtherProbability/ability/reputevalue",
    capturedDate: "2026-09-11",
  },
  abilityMiracleProbability: {
    title: "확률형 아이템 - 미라클 서큘레이터",
    url: "https://maplestory.nexon.com/Guide/OtherProbability/ability/miraclecirculator",
    capturedDate: "2026-09-11",
  },
  abilityGuide: {
    title: "게임정보 - 어빌리티",
    url: "https://maplestory.nexon.com/Guide/N23GameInformation/Articles/392",
    capturedDate: "2026-09-11",
  },
  soulGuide: {
    title: "게임정보 - 소울웨폰",
    url: "https://maplestory.nexon.com/Guide/N23GameInformation/Articles/416",
    capturedDate: "2026-09-11",
  },
  miracleTimeGuide: {
    title: "이벤트 - 미라클 타임 안내",
    url: "https://maplestory.nexon.com/news/event/closed/942",
    capturedDate: "2026-09-11",
  },
});

const STANDARD_CHAOS_OUTCOMES = [
  { value: 0, probability: 0.183827 },
  { value: 1, probability: 0.330081 },
  { value: 2, probability: 0.238669 },
  { value: 3, probability: 0.138661 },
  { value: 4, probability: 0.049438 },
  { value: 6, probability: 0.059324 },
];

const HP_MP_CHAOS_OUTCOMES = STANDARD_CHAOS_OUTCOMES.map((outcome) => ({
  value: outcome.value * 10,
  probability: outcome.probability,
}));

const result = (probability, stats) => ({ probability, stats });
const mesoCost = (meso) => ({ currency: "meso", amount: meso });

export const SCROLL_REFORM_2026_09_17 = deepFreeze({
  id: "scroll-2026-09-17",
  effectiveDate: "2026-09-17",
  evidenceStatus: "official-testworld-and-probability-page",
  calculationReadiness: "catalog-ready-production-verification-pending",
  sources: [
    "testworldUpdate",
    "scrollProbability",
    "scrollGuide",
    "guildGuide",
  ],
  commonRules: {
    mesoTabReceivesTraceFever: false,
    mesoTabReceivesTraceCostDiscount: false,
    earringReceivesDexterityBonus: true,
    earringReceivesGuildBonus: true,
    dexterityBonusStepLevels: 5,
    dexterityBonusPerStepProbabilityPoints: 0.005,
    dexterityBonusMaximumLevel: 100,
    dexteritySuccessBonusMaxProbabilityPoints: 0.1,
    guildSuccessBonusMaxProbabilityPoints: 0.04,
    guildFailureSlotProtectionMaxProbability: 0.04,
    guildFailureSlotProtectionItemExceptions: null,
  },
  returnProtection: {
    effect: {
      protectsExactlyOneScrollAttempt: true,
      consumedAfterAttempt: true,
      successChoices: ["apply-result", "restore-before-attempt"],
      restoreScope: "all-options-except-potential",
      failurePreservesUpgradeSlot: true,
      failureConsumesProtection: true,
    },
    equipment: {
      cost: mesoCost(400_000_000),
      resourceKind: "meso",
    },
    petEquipment: {
      cost: mesoCost(500_000_000),
      resourceKind: "meso",
    },
    karma: {
      resourceKind: "finite-item",
      cost: {
        currency: "item",
        itemId: "karma-return-scroll",
        amount: 1,
      },
      equipmentMustBeUntradeable: true,
      claimLimitScope: "nexon-id-per-month",
      acquisition: {
        currency: "exploration-coin",
        amount: 6_900,
        monthlyLimitPerNexonId: 5,
      },
    },
  },
  scrolls: {
    premiumAccessoryAttack100: {
      successProbability: 1,
      cost: mesoCost(60_000_000),
      outcomes: [
        result(0.85, { attack: 4 }),
        result(0.15, { attack: 5 }),
      ],
    },
    premiumAccessoryMagic100: {
      successProbability: 1,
      cost: mesoCost(60_000_000),
      outcomes: [
        result(0.85, { magic: 4 }),
        result(0.15, { magic: 5 }),
      ],
    },
    earringAttackStr10: {
      baseSuccessProbability: 0.1,
      modifiers: { dexterity: true, guild: true, fever: false },
      cost: mesoCost(100_000_000),
      outcomes: [result(1, { attack: 5, str: 3, maxHp: 150 })],
    },
    earringAttackDex10: {
      baseSuccessProbability: 0.1,
      modifiers: { dexterity: true, guild: true, fever: false },
      cost: mesoCost(100_000_000),
      outcomes: [result(1, { attack: 5, dex: 3 })],
    },
    earringAttackLuk10: {
      baseSuccessProbability: 0.1,
      modifiers: { dexterity: true, guild: true, fever: false },
      cost: mesoCost(100_000_000),
      outcomes: [result(1, { attack: 5, luk: 3 })],
    },
    earringInt10: {
      baseSuccessProbability: 0.1,
      modifiers: { dexterity: true, guild: true, fever: false },
      cost: mesoCost(100_000_000),
      outcomes: [result(1, { magic: 5, int: 3 })],
    },
    magicalOneHandAttack100: {
      successProbability: 1,
      cost: mesoCost(60_000_000),
      outcomes: [
        result(0.5, { attack: 9, allStat: 3 }),
        result(0.4, { attack: 10, allStat: 3 }),
        result(0.1, { attack: 11, allStat: 3 }),
      ],
    },
    magicalOneHandMagic100: {
      successProbability: 1,
      cost: mesoCost(60_000_000),
      outcomes: [
        result(0.5, { magic: 9, allStat: 3 }),
        result(0.4, { magic: 10, allStat: 3 }),
        result(0.1, { magic: 11, allStat: 3 }),
      ],
    },
    magicalTwoHandAttack100: {
      successProbability: 1,
      cost: mesoCost(60_000_000),
      outcomes: [
        result(0.5, { attack: 9, allStat: 3 }),
        result(0.4, { attack: 10, allStat: 3 }),
        result(0.1, { attack: 11, allStat: 3 }),
      ],
    },
    petEquipmentAttack100: {
      successProbability: 1,
      cost: mesoCost(30_000_000),
      outcomes: [
        result(0.7, { attack: 2 }),
        result(0.2, { attack: 3 }),
        result(0.1, { attack: 4 }),
      ],
    },
    petEquipmentMagic100: {
      successProbability: 1,
      cost: mesoCost(30_000_000),
      outcomes: [
        result(0.7, { magic: 2 }),
        result(0.2, { magic: 3 }),
        result(0.1, { magic: 4 }),
      ],
    },
    premiumPetEquipmentAttack100: {
      successProbability: 1,
      cost: mesoCost(60_000_000),
      outcomes: [
        result(0.85, { attack: 4 }),
        result(0.15, { attack: 5 }),
      ],
    },
    premiumPetEquipmentMagic100: {
      successProbability: 1,
      cost: mesoCost(60_000_000),
      outcomes: [
        result(0.85, { magic: 4 }),
        result(0.15, { magic: 5 }),
      ],
    },
    amazingPositiveChaos60: {
      successProbability: 0.6,
      cost: mesoCost(500_000),
      // 테스트월드 공지는 성공률·가격·가능 수치만 공개했다. 현행 공식
      // 확률표의 놀긍 100% 분포를 60%에 임의로 복사하지 않는다.
      outcomesByStatGroup: null,
    },
    amazingPositiveChaos100: {
      successProbability: 1,
      cost: mesoCost(300_000_000),
      outcomesByStatGroup: {
        standard: STANDARD_CHAOS_OUTCOMES,
        hpMp: HP_MP_CHAOS_OUTCOMES,
      },
    },
    petEquipmentInnocent100: {
      successProbability: 1,
      cost: mesoCost(1_000_000_000),
      effect: "reset-pet-equipment-scroll-stats",
    },
    petEquipmentCleanSlate100: {
      successProbability: 1,
      cost: mesoCost(60_000_000),
      effect: "restore-one-pet-equipment-upgrade-slot",
    },
  },
  pendingOfficialFields: [
    "commonRules.guildFailureSlotProtectionItemExceptions",
    "scrolls.amazingPositiveChaos60.outcomesByStatGroup",
    "returnProtection.itemEligibilityByScroll",
    "returnProtection.legacyCashItemHandling",
  ],
});

export const ABILITY_REFORM_2026_09_17 = deepFreeze({
  id: "ability-2026-09-17",
  effectiveDate: "2026-09-17",
  evidenceStatus: "official-testworld-partial",
  calculationReadiness: "blocked-on-official-probability-table",
  sources: [
    "testworldUpdate",
    "testworldSkillUpdate",
    "abilityHonorProbability",
    "abilityMiracleProbability",
    "abilityGuide",
  ],
  existingHonorRules: {
    optionTypesDoNotDuplicate: true,
    excludedTypeWeightsAreConditionallyRenormalized: true,
    completelyIdenticalResultIsRerolled: true,
  },
  methods: {
    advanced: {
      label: "고급 재설정",
      requiredAbilityGrade: "legendary",
      selectableOldOrNewResult: true,
      supportsAutomaticReset: true,
      mvpGoldBatchSize: 3,
      costsByLockedLineCount: [
        { lockedLineCount: 0, honor: 20_000, meso: 2_000_000 },
        { lockedLineCount: 1, honor: 30_000, meso: 6_000_000 },
        { lockedLineCount: 2, honor: 40_000, meso: 15_000_000 },
      ],
      lowerLinesCanBeLegendary: true,
      automaticReset: {
        stopWhenAnyTargetMatches: true,
        matchRequiresOptionType: true,
        matchRequiresSelectedGradeOrMinimumValue: true,
        canIgnoreFirstLineForStop: true,
      },
      lowerLineGradeDistribution: null,
      optionTypeWeights: null,
      optionValueDistribution: null,
      identicalResultExcluded: null,
    },
    abyssCirculator: {
      label: "심연의 서큘레이터",
      requiredAbilityGrade: "legendary",
      procurement: [
        {
          currency: "cash",
          amount: 4_900,
          mileageAllowed: false,
          tradeCountAfterPurchase: 1,
          expiresAfterDays: 30,
        },
        {
          currency: "maple-credit",
          amount: 4_900,
          shop: "credit-shop",
          giftAllowed: false,
          tradeCountAfterPurchase: 1,
          expiresAfterDays: 30,
        },
      ],
      fixesOptionGrade: true,
      fixesOptionType: true,
      rerollsOnlyValues: true,
      selectableOldOrNewResult: true,
      individualValuesMayRemainSame: true,
      optionValueDistribution: null,
      identicalResultExcluded: null,
      requiresAtLeastOneRerollableValue: true,
      probabilityPublication: {
        status: "scheduled-after-live-update",
        scheduledDate: "2026-09-17",
        currentHonorProbabilityPageContainsTable: false,
      },
    },
  },
  restrictions: {
    normalResetCannotLockLegendaryLowerLine: true,
    blackCirculatorBlockedByLegendaryLowerLine: true,
    chaosCirculatorBlockedByLegendaryLowerLine: true,
  },
  changeCirculatorSupport: {
    deterministicOneTimeSupport: true,
    eligibleJob: "미하일",
    characterCreatedBefore: "2026-09-17T00:00:00+09:00",
    claimStartsAfterMaintenanceOn: "2026-09-17",
    claimEndExclusive: "2026-10-22T00:00:00+09:00",
    itemExpiresAt: "2026-10-22T02:00:00+09:00",
    claimLimitPerCharacter: 1,
    quantityPerClaim: 1,
    tradePolicy: "untradeable",
    blockedByLegendaryLowerLine: true,
    conversions: [
      {
        fromType: "cooldown-skip",
        fromGrade: "legendary",
        values: [15, 16, 17, 18, 19, 20],
        choicesByValue: {
          15: [{ type: "boss-damage", value: 15 }],
          16: [{ type: "boss-damage", value: 16 }],
          17: [{ type: "boss-damage", value: 17 }],
          18: [{ type: "boss-damage", value: 18 }],
          19: [{ type: "boss-damage", value: 19 }],
          20: [{ type: "boss-damage", value: 20 }],
        },
      },
      ...["cooldown-skip", "boss-damage"].map((fromType) => ({
        fromType,
        fromGrade: "unique",
        values: [5, 6, 7, 8, 9, 10],
        choicesByValue: {
          5: [
            { type: "abnormal-damage", value: 7 },
            { type: "buff-duration", value: 32 },
            { type: "attack", value: 15 },
          ],
          6: [
            { type: "abnormal-damage", value: 7 },
            { type: "buff-duration", value: 33 },
            { type: "attack", value: 18 },
          ],
          7: [
            { type: "abnormal-damage", value: 7 },
            { type: "buff-duration", value: 34 },
            { type: "attack", value: 18 },
          ],
          8: [
            { type: "abnormal-damage", value: 7 },
            { type: "buff-duration", value: 35 },
            { type: "attack", value: 18 },
          ],
          9: [
            { type: "abnormal-damage", value: 8 },
            { type: "buff-duration", value: 37 },
            { type: "attack", value: 21 },
          ],
          10: [
            { type: "abnormal-damage", value: 8 },
            { type: "buff-duration", value: 38 },
            { type: "attack", value: 21 },
          ],
        },
      })),
    ],
  },
  pendingOfficialFields: [
    "methods.advanced.lowerLineGradeDistribution",
    "methods.advanced.optionTypeWeights",
    "methods.advanced.optionValueDistribution",
    "methods.advanced.identicalResultExcluded",
    "methods.abyssCirculator.optionValueDistribution",
    "methods.abyssCirculator.identicalResultExcluded",
  ],
  pendingOperationalFields: [
    "methods.advanced.mvpGoldBatchConsumptionAndStopPolicy",
  ],
});

export const SOUL_REFORM_2026_09_17 = deepFreeze({
  id: "soul-2026-09-17",
  effectiveDate: "2026-09-17",
  evidenceStatus: "official-live-update-and-probability-page",
  calculationReadiness: "amplification-rank-up-and-fixed-grade-options-ready",
  sources: ["liveUpdate", "soulPotentialProbability", "soulGuide", "miracleTimeGuide"],
  eligibility: {
    minimumWeaponLevel: 200,
    requiredSoulType: "magnificent",
    temporaryWeaponAllowed: false,
    genesisSecondReleaseQuestRequired: true,
    amplifiedWeaponReapplicationSoulType: "magnificent",
  },
  amplification: {
    failureCounterIsCanonical: true,
    gaugeIsDisplayOnly: true,
    consumesOneMatchingEtherPerAttempt: true,
    resetsPreviousStageGaugeOnSuccess: true,
    firstStageCreatesPotential: true,
    higherStagePreservesPotentialGradeAndTypes: true,
    higherStageRaisesValuesOnly: true,
    stages: [
      {
        stage: 1,
        baseSuccessProbability: 0.05,
        successProbabilityIncreasePerFailure: 0.01,
        gaugeIncreasePerFailure: 0.04,
        guaranteeAfterFailures: 25,
        mesoPerAttempt: 500_000_000,
        etherStage: 1,
      },
      {
        stage: 2,
        baseSuccessProbability: 0.03,
        successProbabilityIncreasePerFailure: 0.006,
        gaugeIncreasePerFailure: 0.0303,
        guaranteeAfterFailures: 33,
        mesoPerAttempt: 1_000_000_000,
        etherStage: 2,
      },
      {
        stage: 3,
        baseSuccessProbability: 0.02,
        successProbabilityIncreasePerFailure: 0.004,
        gaugeIncreasePerFailure: 0.0233,
        guaranteeAfterFailures: 43,
        mesoPerAttempt: 1_750_000_000,
        etherStage: 3,
      },
      {
        stage: 4,
        baseSuccessProbability: 0.015,
        successProbabilityIncreasePerFailure: 0.003,
        gaugeIncreasePerFailure: 0.02,
        guaranteeAfterFailures: 50,
        mesoPerAttempt: 2_750_000_000,
        etherStage: 4,
      },
    ],
  },
  potential: {
    grades: ["rare", "epic", "unique", "legendary"],
    resetCostsByGrade: {
      rare: 20_000_000,
      epic: 40_000_000,
      unique: 65_000_000,
      legendary: 88_000_000,
    },
    rankUpByGrade: {
      rare: { toGrade: "epic", probability: 0.015, guaranteeAtResetCount: 100 },
      epic: { toGrade: "unique", probability: 0.005875, guaranteeAtResetCount: 256 },
      unique: {
        toGrade: "legendary",
        probability: 0.003322,
        guaranteeAtResetCount: 451,
      },
    },
    miracleTimeApplies: true,
    miracleTimeRankUpProbabilityMultiplier: 2,
    automaticEnhancementMinimumGrade: "legendary",
    automaticEnhancementStopPolicy: null,
    guaranteeAttemptSemantics: "nth-reset-guaranteed",
    lineGradeDistribution: {
      rare: {
        first: { rare: 1 },
        lower: { rare: 0.019608, normal: 0.9803922 },
      },
      epic: {
        first: { epic: 1 },
        lower: { epic: 0.047619, rare: 0.952381 },
      },
      unique: {
        first: { unique: 1 },
        lower: { unique: 0.019608, epic: 0.9803922 },
      },
      legendary: {
        first: { legendary: 1 },
        lower: { legendary: 0.004975, unique: 0.995025 },
      },
    },
    optionTypeWeights: { snapshot: "data/soul-potential-2026-09-17.json" },
    optionValuesByAmplificationStage: { snapshot: "data/soul-potential-2026-09-17.json", stages: [1, 2, 3, 4] },
    initialGradeAtStageOne: null,
    optionDuplicatePolicy: { cappedOptionTypesInPublishedTables: [] },
    identicalResultPolicy: "exclude-completely-identical-result",
    rankUpResultRollOrder: null,
  },
  persistence: {
    storedPerWeapon: true,
    resetOn: [
      "character-trade",
      "auction-registration",
      "storage",
      "parcel",
      "drop",
    ],
    retainedOnDestruction: true,
    retainedOnDestinyTranscendence: true,
    zeroWeaponGrowthTransfersState: true,
    zeroPreviousWeaponRestoresPreviousState: true,
    collectionRegistration: {
      removesEligibleSoulFromWeapon: true,
      deactivatesAmplificationStageAndPotential: true,
      reapplyingMagnificentSoulReactivatesStoredState: true,
    },
  },
  ether: {
    tradable: true,
    permanent: true,
    itemDropRateApplies: true,
    dropSourcesByStage: {
      1: [
        { boss: "최초의 대적자", difficulties: ["normal", "hard", "extreme"] },
        { boss: "카링", difficulties: ["normal", "hard", "extreme"] },
      ],
      2: [
        { boss: "벨로나", difficulties: ["normal", "hard"] },
        { boss: "찬란한 흉성", difficulties: ["normal", "hard"] },
      ],
      3: [
        { boss: "림보", difficulties: ["normal", "hard"] },
        { boss: "발드릭스", difficulties: ["normal", "hard"] },
      ],
      4: [
        { boss: "유피테르", difficulties: ["normal", "hard"] },
      ],
    },
    dropRates: null,
  },
  pendingOfficialFields: [
    "potential.initialGradeAtStageOne",
    "potential.rankUpResultRollOrder",
    "ether.dropRates",
  ],
  pendingOperationalFields: [
    "potential.automaticEnhancementStopPolicy",
  ],
});

export const REFORM_2026_09_17_READINESS = deepFreeze({
  scroll: {
    ready: false,
    readyForCatalogAndEngineDevelopment: true,
    pendingOfficialFields: SCROLL_REFORM_2026_09_17.pendingOfficialFields,
  },
  ability: {
    ready: false,
    pendingOfficialFields: ABILITY_REFORM_2026_09_17.pendingOfficialFields,
  },
  abilityAdvancedBatch: {
    ready: false,
    pendingOfficialFields: ABILITY_REFORM_2026_09_17.pendingOperationalFields,
  },
  soulAmplification: {
    ready: true,
    pendingOfficialFields: [],
  },
  soulPotentialRankUp: {
    ready: true,
    pendingOfficialFields: [],
  },
  soulPotentialOptions: {
    ready: true,
    pendingOfficialFields: [],
    scope: "fixed-grade-reroll-at-user-selected-amplification-stage",
  },
  soulPotentialAutomaticEnhancement: {
    ready: false,
    pendingOfficialFields: SOUL_REFORM_2026_09_17.pendingOperationalFields,
  },
});

function pendingProductionDomain(sourceKeys, expectedLiveSources) {
  return {
    liveVerified: false,
    verifiedAt: null,
    revision: null,
    catalogDataSha256: null,
    supportingSources: sourceKeys.map((sourceKey) => ({
      sourceKey,
      url: REFORM_2026_09_17_SOURCES[sourceKey].url,
    })),
    expectedLiveSources,
    // 정식 서버 적용 뒤 production/live-verification 스냅샷만 추가한다.
    sourceSnapshots: [],
  };
}

/**
 * 테스트월드 규칙과 정식 서버 규칙이 일치하는지 영역별로 확인한 뒤에만
 * 채운다. 한 영역 검증만으로 다른 영역이 열리지 않으며, 날짜가 지났다는
 * 이유만으로 규칙을 자동 활성화하지 않는다.
 */
export const REFORM_2026_09_17_PRODUCTION_ACTIVATION = deepFreeze({
  scheduledDate: "2026-09-17",
  requiresMaintenanceCompletion: true,
  domains: {
    scroll: pendingProductionDomain(SCROLL_REFORM_2026_09_17.sources, [
      {
        sourceKey: "scrollProbability",
        url: REFORM_2026_09_17_SOURCES.scrollProbability.url,
      },
      { sourceKey: "scrollLiveUpdate", url: null },
    ]),
    ability: pendingProductionDomain(ABILITY_REFORM_2026_09_17.sources, [
      {
        sourceKey: "abilityHonorProbability",
        url: REFORM_2026_09_17_SOURCES.abilityHonorProbability.url,
      },
      { sourceKey: "abilityLiveUpdate", url: null },
    ]),
    abilityAdvancedBatch: pendingProductionDomain(
      ABILITY_REFORM_2026_09_17.sources,
      [{ sourceKey: "abilityLiveUpdate", url: null }],
    ),
    soulAmplification: pendingProductionDomain(SOUL_REFORM_2026_09_17.sources, [
      { sourceKey: "soulLiveUpdate", url: null },
    ]),
    soulPotentialRankUp: pendingProductionDomain(SOUL_REFORM_2026_09_17.sources, [
      { sourceKey: "soulLiveUpdate", url: null },
      { sourceKey: "soulPotentialProbability", url: null },
    ]),
    soulPotentialOptions: pendingProductionDomain(SOUL_REFORM_2026_09_17.sources, [
      { sourceKey: "soulLiveUpdate", url: null },
      { sourceKey: "soulPotentialProbability", url: null },
    ]),
    soulPotentialAutomaticEnhancement: pendingProductionDomain(
      SOUL_REFORM_2026_09_17.sources,
      [
        { sourceKey: "soulLiveUpdate", url: null },
        { sourceKey: "soulPotentialProbability", url: null },
      ],
    ),
    ...VERIFIED_SOUL_DOMAINS,
  },
});

export function getReform20260917Readiness(domain) {
  const readiness = REFORM_2026_09_17_READINESS[domain];
  if (!readiness) throw new RangeError(`지원하지 않는 개편 영역입니다: ${domain}`);
  return readiness;
}

function validateCalendarDate(asOfDate) {
  if (typeof asOfDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    throw new TypeError("기준일은 YYYY-MM-DD 형식이어야 합니다.");
  }
  const [year, month, day] = asOfDate.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  const validDate =
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
  if (!validDate) throw new RangeError("유효한 기준일이어야 합니다.");
  return asOfDate;
}

/** 공지된 달력 날짜가 도달했는지만 판정하며 운영 활성화 여부와는 다르다. */
export function isReform20260917ScheduledDateReached(asOfDate) {
  return validateCalendarDate(asOfDate) >=
    REFORM_2026_09_17_PRODUCTION_ACTIVATION.scheduledDate;
}

const SHA256_HEX = /^[a-f0-9]{64}$/u;

function validVerifiedAt(value) {
  return typeof value === "string" &&
    /(Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    Number.isFinite(Date.parse(value));
}

function validOfficialSourceUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const hostname = new URL(value).hostname;
    return hostname === "maplestory.nexon.com" ||
      hostname.endsWith(".maplestory.nexon.com");
  } catch {
    return false;
  }
}

function validProductionSourceUrl(value) {
  if (!validOfficialSourceUrl(value)) return false;
  return !new URL(value).pathname.toLowerCase().startsWith("/testworld/");
}

/**
 * 운영 활성화 판정을 부작용 없이 수행한다. 테스트에서는 별도 fixture를
 * 넣을 수 있지만 실제 운영 wrapper는 고정된 공식 스냅샷만 전달한다.
 */
export function evaluateReform20260917ProductionActivation({
  domain,
  asOfDate,
  maintenanceCompleted = false,
  activation = REFORM_2026_09_17_PRODUCTION_ACTIVATION,
} = {}) {
  const record = activation?.domains?.[domain];
  if (!REFORM_2026_09_17_READINESS[domain] || !record) {
    throw new RangeError(`지원하지 않는 개편 영역입니다: ${domain}`);
  }
  const scheduled = validateCalendarDate(asOfDate) >= activation.scheduledDate;
  const snapshots = Array.isArray(record.sourceSnapshots)
    ? record.sourceSnapshots
    : [];
  const expectedSources = Array.isArray(record.expectedLiveSources)
    ? record.expectedLiveSources
    : [];
  const liveStart = Date.parse(`${activation.scheduledDate}T00:00:00+09:00`);
  const expectedSourcesReady = expectedSources.length > 0 &&
    expectedSources.every((source) =>
      typeof source?.sourceKey === "string" &&
      validProductionSourceUrl(source?.url));
  const snapshotsVerified = expectedSourcesReady &&
    snapshots.length >= expectedSources.length &&
    snapshots.every((snapshot) => {
      const expected = expectedSources.find(
        (source) => source.sourceKey === snapshot?.sourceKey,
      );
      return Boolean(
        expected &&
        snapshot?.role === "live-verification" &&
        snapshot?.environment === "production" &&
        snapshot.url === expected.url &&
        validVerifiedAt(snapshot?.capturedAt) &&
        Date.parse(snapshot.capturedAt) >= liveStart &&
        SHA256_HEX.test(snapshot?.rawSha256 ?? "") &&
        SHA256_HEX.test(snapshot?.extractedDataSha256 ?? "") &&
        snapshot?.catalogDataSha256 === record.catalogDataSha256
      );
    }) && expectedSources.every((expected) =>
      snapshots.some((snapshot) => snapshot.sourceKey === expected.sourceKey));
  const latestCapturedAt = snapshots.reduce(
    (latest, snapshot) => Math.max(latest, Date.parse(snapshot?.capturedAt) || 0),
    0,
  );
  return Boolean(
    scheduled &&
    (!activation.requiresMaintenanceCompletion || maintenanceCompleted) &&
    record.liveVerified === true &&
    validVerifiedAt(record.verifiedAt) &&
    Date.parse(record.verifiedAt) >= liveStart &&
    Date.parse(record.verifiedAt) >= latestCapturedAt &&
    typeof record.revision === "string" &&
    record.revision.trim() &&
    SHA256_HEX.test(record.catalogDataSha256 ?? "") &&
    snapshotsVerified,
  );
}

/** 부분 카탈로그 계산에서도 정식 서버 검증 자체는 우회하지 못하게 한다. */
export function assertReform20260917ProductionActivated(
  domain,
  { asOfDate = null, maintenanceCompleted = false } = {},
) {
  const effective = asOfDate
    ? isReform20260917Effective(asOfDate, { domain, maintenanceCompleted })
    : false;
  if (!effective) {
    throw new Error(
      `${domain} 개편 규칙은 정식 서버 점검 완료 및 해당 영역 공식 스냅샷 재검증 전에는 활성화할 수 없습니다.`,
    );
  }
  return REFORM_2026_09_17_PRODUCTION_ACTIVATION.domains[domain];
}

/** 정식 점검 완료와 해당 영역의 공식 스냅샷 검증 후에만 활성화한다. */
export function isReform20260917Effective(
  asOfDate,
  { domain, maintenanceCompleted = false } = {},
) {
  return evaluateReform20260917ProductionActivation({
    domain,
    asOfDate,
    maintenanceCompleted,
  });
}

/** 불완전한 공식 표가 기댓값 엔진으로 유입되는 것을 막는 공통 가드. */
export function assertReform20260917Ready(
  domain,
  {
    forProduction = true,
    asOfDate = null,
    maintenanceCompleted = false,
  } = {},
) {
  const readiness = getReform20260917Readiness(domain);
  if (!readiness.ready) {
    throw new Error(
      `${domain} 개편 규칙은 아직 운영 계산에 사용할 수 없습니다: ${readiness.pendingOfficialFields.join(", ")}`,
    );
  }
  if (forProduction) {
    assertReform20260917ProductionActivated(domain, {
      asOfDate,
      maintenanceCompleted,
    });
  }
  return readiness;
}
