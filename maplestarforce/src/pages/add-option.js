import { calculatorStorage, registerResultShare } from "../shared/result-share-state.js";
import {
  ADD_OPTION_TABLES_SNAPSHOT,
  BLACK_FLAME_MESO,
  WEAPON_TIERS,
  calculateArmorAddOption,
  calculateWeaponAddOption,
} from "maple-core/add-option";
import {
  getAddOptionSourceLabel,
  orderAddOptionSources,
} from "../shared/add-option-display.js";
import {
  DEFAULT_ADD_OPTION_DAMAGE_EQUIVALENCE,
  damageEquivalenceToStatEquivalence,
  normalizeAddOptionDamageEquivalence,
  statEquivalenceToDamageEquivalence,
} from "../shared/add-option-equivalence.js";
import { renderToolNav } from "../shared/shell.js";
import { chip, field, numberInput, toggleChip } from "../shared/ui.js";
import {
  MAN,
  card,
  chipRow,
  details,
  element,
  formatAttempts,
  formatMeso,
  formatProbability,
  searchableSelect,
  note,
  renderWithFocus,
  resetAction,
  resultCard as createResultCard,
  resultLine,
  row,
} from "../shared/calculator-ui.js";
import {
  characterProfileCard,
  getActiveProfile,
  getCalculationProfile,
  subscribeCharacterProfile,
} from "../shared/character-profile.js";
import {
  getFlatStatToFlatMainStat,
  getProfileSubStats,
} from "../shared/profile-stat-equivalence.js";

renderToolNav(document.querySelector("#toolnav"), "add-option");

const STATS = ["STR", "DEX", "INT", "LUK"];
const MAIN_STAT_OPTIONS = [
  ...STATS,
  { value: "ALL", label: "제논 (STR·DEX·LUK)" },
  { value: "HP", label: "데몬어벤져 (HP)" },
];
const DEFAULT_SUB = { STR: "DEX", DEX: "STR", INT: "LUK", LUK: "DEX" };
const STORAGE_KEY = "maplestarforce:add-option:v2";
const defaults = {
  weapon: false,
  itemLevel: 200,
  boss: true,
  mainStat: "STR",
  subStat: "DEX",
  attackType: "attack",
  target: 120,
  tier: 2,
  damagePercent: 0,
  ...DEFAULT_ADD_OPTION_DAMAGE_EQUIVALENCE,
  xenonStrToDamagePercent: 0.1375,
  xenonDexToDamagePercent: 0.1375,
  xenonLukToDamagePercent: 0.1375,
  xenonAttackToDamagePercent: 0.75625,
  xenonAllStatToDamagePercent: 2.475,
  demonAvengerHp35ToDamagePercent: 1,
  demonAvengerStrToDamagePercent: 0.25,
  demonAvengerAttackToDamagePercent: 4,
  demonAvengerAllStatToDamagePercent: 0,
  abyssPrice: 0,
  strongPrice: 0,
};

function loadState() {
  try {
    const parsed = JSON.parse(calculatorStorage.getItem(STORAGE_KEY));
    const stored = parsed && typeof parsed === "object" ? parsed : {};
    const next = {
      ...defaults,
      ...stored,
      ...normalizeAddOptionDamageEquivalence(stored),
    };
    delete next.bossDamageToMainPercent;
    return next;
  } catch {
    return { ...defaults };
  }
}

const state = loadState();
const root = document.querySelector("#tool");

function save() {
  try {
    calculatorStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 저장할 수 없어도 현재 계산은 유지한다.
  }
}

function update(mutator) {
  mutator();
  save();
  render();
}

function num(key, options = {}) {
  const input = numberInput(state[key], (value) => update(() => {
    state[key] = value;
  }), options);
  input.dataset.key = key;
  return input;
}

function select(key, options, onAfter, { value = state[key], disabled = false } = {}) {
  const control = searchableSelect(options, value, (next) => update(() => {
    state[key] = next;
    onAfter?.(next);
  }), { key });
  control.disabled = disabled;
  return control;
}

function damageEquivalenceField(
  label,
  key,
  value,
  disabled,
  title,
  { min = 0.000001, unit = "데미지 %", inputAmount = 1 } = {},
) {
  const wrap = element("div", "add-option-equivalence-value");
  const input = numberInput(
    Number((Number(value) * inputAmount).toFixed(6)),
    (next) => update(() => {
      // 계산식과 저장값은 1단위 계수를 유지하고, 화면에서는 이용자가
      // 비교하기 쉬운 입력 수량에 해당하는 데미지 값을 받는다.
      state[key] = next / inputAmount;
    }),
    {
      min: String(min),
      max: "100",
      step: "0.000001",
      disabled,
    },
  );
  input.dataset.key = key;
  wrap.append(
    input,
    element("span", "add-option-equivalence-value__unit", unit),
  );
  const control = field(label, wrap);
  control.title = title;
  return control;
}

function statModel(mainStat) {
  if (mainStat === "ALL") return "xenon";
  if (mainStat === "HP") return "demon-avenger";
  return "standard";
}

function directEquivalence(profile) {
  if (profile?.addOptionEquivalence) return profile.addOptionEquivalence;
  const values = profile
    ? statEquivalenceToDamageEquivalence(profile.statEquivalence)
    : null;
  if (!values) return null;
  const flatStatToDamagePercent = Object.fromEntries(
    STATS.map((stat) => [stat, 0]),
  );
  flatStatToDamagePercent[profile.mainStat] =
    values.flatMainStatToDamagePercent;
  for (const stat of getProfileSubStats(profile)) {
    flatStatToDamagePercent[stat] =
      values.flatMainStatToDamagePercent *
      getFlatStatToFlatMainStat(profile, stat);
  }
  return {
    flatStatToDamagePercent: { ...flatStatToDamagePercent, HP: 0 },
    flatAttackToDamagePercent: values.flatAttackToDamagePercent,
    allStatPercentToDamagePercent: values.allStatPercentToDamagePercent,
    bossDamageToDamagePercent: 1,
    targetToDamagePercent: values.flatMainStatToDamagePercent,
  };
}

function manualAddOptionEquivalence() {
  const model = statModel(state.mainStat);
  if (model === "xenon") {
    const flatStatToDamagePercent = {
      STR: Number(state.xenonStrToDamagePercent),
      DEX: Number(state.xenonDexToDamagePercent),
      INT: 0,
      LUK: Number(state.xenonLukToDamagePercent),
      HP: 0,
    };
    return {
      model,
      flatStatToDamagePercent,
      flatAttackToDamagePercent: Number(state.xenonAttackToDamagePercent),
      allStatPercentToDamagePercent: Number(state.xenonAllStatToDamagePercent),
      bossDamageToDamagePercent: 1,
      targetToDamagePercent:
        (flatStatToDamagePercent.STR +
          flatStatToDamagePercent.DEX +
          flatStatToDamagePercent.LUK) / 3,
    };
  }
  if (model === "demon-avenger") {
    const hp35 = Number(state.demonAvengerHp35ToDamagePercent);
    return {
      model,
      flatStatToDamagePercent: {
        STR: Number(state.demonAvengerStrToDamagePercent),
        DEX: 0,
        INT: 0,
        LUK: 0,
        HP: hp35 / 35,
      },
      flatAttackToDamagePercent: Number(
        state.demonAvengerAttackToDamagePercent,
      ),
      allStatPercentToDamagePercent: Number(
        state.demonAvengerAllStatToDamagePercent,
      ),
      bossDamageToDamagePercent: 1,
      targetToDamagePercent: hp35,
      details: {
        mode: "conventional-manual",
        formula: "HP/35 + STR/4 + 공격력×4",
      },
    };
  }

  const values = normalizeAddOptionDamageEquivalence(state);
  const flatStatToDamagePercent = Object.fromEntries(
    STATS.map((stat) => [stat, 0]),
  );
  flatStatToDamagePercent[state.mainStat] =
    values.flatMainStatToDamagePercent;
  if (state.subStat !== "none") {
    flatStatToDamagePercent[state.subStat] =
      values.flatSubStatToDamagePercent;
  }
  return {
    model,
    flatStatToDamagePercent: { ...flatStatToDamagePercent, HP: 0 },
    flatAttackToDamagePercent: values.flatAttackToDamagePercent,
    allStatPercentToDamagePercent: values.allStatPercentToDamagePercent,
    bossDamageToDamagePercent: 1,
    targetToDamagePercent: values.flatMainStatToDamagePercent,
  };
}

function equivalenceDetails(profile) {
  const locked = Boolean(profile);
  const direct = directEquivalence(profile);
  const values = !profile || statModel(profile.mainStat) === "standard"
    ? (profile
        ? statEquivalenceToDamageEquivalence(profile.statEquivalence)
        : null) ?? normalizeAddOptionDamageEquivalence(state)
    : null;
  const mainStat = profile?.mainStat ?? state.mainStat;
  const subStat = profile?.subStat ?? state.subStat;
  const subStats = profile
    ? getProfileSubStats(profile)
    : subStat && subStat !== "none"
      ? [subStat]
      : [];
  const attackType = profile?.attackType ?? state.attackType;
  const model = profile?.statModel ?? statModel(mainStat);
  const conventionalDemonAvenger = model === "demon-avenger" && (
    !profile ||
    String(direct?.details?.mode ?? "").startsWith("conventional")
  );
  const demonAvengerUnit = conventionalDemonAvenger ? "점" : "데미지 %";
  const identity = row(
    field(
      "주스탯",
      select("mainStat", MAIN_STAT_OPTIONS, (next) => {
        state.subStat = DEFAULT_SUB[next] ?? "none";
        state.attackType = next === "INT" ? "magic" : "attack";
      }, { value: mainStat, disabled: locked }),
    ),
    model === "standard"
      ? field(
          "부스탯",
          locked && subStats.length > 1
            ? select(
                "subStat",
                [{
                  value: subStats.join(","),
                  label: subStats.join(" · "),
                }],
                null,
                { value: subStats.join(","), disabled: true },
              )
            : select(
                "subStat",
                [...STATS, { value: "none", label: "없음" }],
                null,
                { value: subStat ?? "none", disabled: locked },
              ),
        )
      : null,
    model === "standard"
      ? field(
          "공격 계열",
          select(
            "attackType",
            [
              { value: "attack", label: "공격력" },
              { value: "magic", label: "마력" },
            ],
            null,
            { value: attackType, disabled: locked },
          ),
        )
      : null,
  );
  let conversionFields;
  if (model === "xenon") {
    conversionFields = [
      damageEquivalenceField(
        "STR +10",
        "xenonStrToDamagePercent",
        direct?.flatStatToDamagePercent?.STR ?? state.xenonStrToDamagePercent,
        locked,
        "STR 10을 데미지 몇 %와 같은 가치로 계산할지 정합니다.",
        { inputAmount: 10 },
      ),
      damageEquivalenceField(
        "DEX +10",
        "xenonDexToDamagePercent",
        direct?.flatStatToDamagePercent?.DEX ?? state.xenonDexToDamagePercent,
        locked,
        "DEX 10을 데미지 몇 %와 같은 가치로 계산할지 정합니다.",
        { inputAmount: 10 },
      ),
      damageEquivalenceField(
        "LUK +10",
        "xenonLukToDamagePercent",
        direct?.flatStatToDamagePercent?.LUK ?? state.xenonLukToDamagePercent,
        locked,
        "LUK 10을 데미지 몇 %와 같은 가치로 계산할지 정합니다.",
        { inputAmount: 10 },
      ),
      damageEquivalenceField(
        "공격력 +10",
        "xenonAttackToDamagePercent",
        direct?.flatAttackToDamagePercent ?? state.xenonAttackToDamagePercent,
        locked,
        "공격력 10을 데미지 몇 %와 같은 가치로 계산할지 정합니다.",
        { inputAmount: 10 },
      ),
      damageEquivalenceField(
        "올스탯 +1%",
        "xenonAllStatToDamagePercent",
        direct?.allStatPercentToDamagePercent ??
          state.xenonAllStatToDamagePercent,
        locked,
        "올스탯 1%가 STR·DEX·LUK를 올리는 가치를 계산합니다.",
      ),
    ];
  } else if (model === "demon-avenger") {
    conversionFields = [
      damageEquivalenceField(
        "HP +35",
        "demonAvengerHp35ToDamagePercent",
        direct
          ? direct.flatStatToDamagePercent.HP * 35
          : state.demonAvengerHp35ToDamagePercent,
        locked,
        conventionalDemonAvenger
          ? "추가옵션 HP 35가 관행 추옵 점수 몇 점인지 정합니다."
          : "추가옵션 HP 35를 데미지 몇 %와 같은 가치로 계산할지 정합니다.",
        { unit: demonAvengerUnit },
      ),
      damageEquivalenceField(
        "STR +10",
        "demonAvengerStrToDamagePercent",
        direct?.flatStatToDamagePercent?.STR ??
          state.demonAvengerStrToDamagePercent,
        locked,
        "데몬어벤져의 보조 능력치 STR 10의 가치를 정합니다.",
        { inputAmount: 10, unit: demonAvengerUnit },
      ),
      damageEquivalenceField(
        "공격력 +10",
        "demonAvengerAttackToDamagePercent",
        direct?.flatAttackToDamagePercent ??
          state.demonAvengerAttackToDamagePercent,
        locked,
        conventionalDemonAvenger
          ? "공격력 10이 관행 추옵 점수 몇 점인지 정합니다."
          : "공격력 10을 데미지 몇 %와 같은 가치로 계산할지 정합니다.",
        { inputAmount: 10, unit: demonAvengerUnit },
      ),
      damageEquivalenceField(
        "올스탯 +1%",
        "demonAvengerAllStatToDamagePercent",
        direct?.allStatPercentToDamagePercent ??
          state.demonAvengerAllStatToDamagePercent,
        locked,
        "데몬어벤져의 올스탯은 HP가 아닌 STR에만 적용됩니다.",
        { min: 0, unit: demonAvengerUnit },
      ),
    ];
  } else {
    const statFields = locked
      ? [
          damageEquivalenceField(
            `${mainStat} +10`,
            `profile-${mainStat.toLowerCase()}-flat`,
            direct?.flatStatToDamagePercent?.[mainStat] ??
              values.flatMainStatToDamagePercent,
            true,
            `${mainStat} 10을 데미지 몇 %와 같은 가치로 계산할지 보여줍니다.`,
            { inputAmount: 10 },
          ),
          ...subStats.map((stat) =>
            damageEquivalenceField(
              `${stat} +10`,
              `profile-${stat.toLowerCase()}-flat`,
              direct?.flatStatToDamagePercent?.[stat] ??
                values.flatMainStatToDamagePercent *
                  getFlatStatToFlatMainStat(profile, stat),
              true,
              `${stat} 10을 데미지 몇 %와 같은 가치로 계산할지 보여줍니다.`,
              { inputAmount: 10 },
            )
          ),
        ]
      : [
          damageEquivalenceField(
            "주스탯 +10",
            "flatMainStatToDamagePercent",
            values.flatMainStatToDamagePercent,
            false,
            "고정 주스탯 수치 10을 데미지 몇 %와 같은 가치로 계산할지 정합니다.",
            { inputAmount: 10 },
          ),
          damageEquivalenceField(
            "부스탯 +10",
            "flatSubStatToDamagePercent",
            values.flatSubStatToDamagePercent,
            false,
            "고정 부스탯 수치 10을 데미지 몇 %와 같은 가치로 계산할지 정합니다.",
            { inputAmount: 10 },
          ),
        ];
    conversionFields = [
      ...statFields,
      damageEquivalenceField(
        attackType === "magic" ? "마력 +10" : "공격력 +10",
        "flatAttackToDamagePercent",
        values.flatAttackToDamagePercent,
        locked,
        `${attackType === "magic" ? "마력" : "공격력"} 수치 10을 데미지 몇 %와 같은 가치로 계산할지 정합니다.`,
        { inputAmount: 10 },
      ),
      damageEquivalenceField(
        "올스탯 +1%",
        "allStatPercentToDamagePercent",
        values.allStatPercentToDamagePercent,
        locked,
        "올스탯 1%를 데미지 몇 %와 같은 가치로 계산할지 정합니다.",
      ),
    ];
  }
  const conversions = row(...conversionFields);
  conversions.classList.add("add-option-equivalence-settings");
  const manual = details(
    "추옵 환산 설정",
    identity,
    conversions,
    note(model === "demon-avenger"
      ? "데몬어벤져는 HP/35 + STR/4 + 공격력×4 관행 점수를 사용하며 올스탯%는 제외합니다."
      : "캐릭터 정보가 있으면 해당 값을 우선 사용합니다. 데미지·보스 데미지 +1%는 1로 고정합니다."),
  );
  manual.classList.add("add-option-equivalence");
  manual.dataset.detailsKey = "add-option-equivalence";
  return manual;
}

function choice(key, value, label, onAfter) {
  return chip(label, state[key] === value, () => update(() => {
    state[key] = value;
    onAfter?.(value);
  }));
}

function toggle(key, label) {
  return toggleChip(label, state[key] === true, () => update(() => {
    state[key] = !state[key];
  }));
}

function setupSection(title, className, ...children) {
  const section = element("section", `add-option-setup-section ${className}`);
  section.append(
    element("h2", "", title),
    ...children.filter(Boolean),
  );
  return section;
}

function equipmentSection() {
  const section = setupSection(
    "장비",
    "add-option-setup-section--equipment",
    chipRow(
      choice("weapon", false, "방어구·장신구"),
      choice("weapon", true, "무기"),
      toggle("boss", "보스 장비"),
    ),
    row(field("장비 레벨", num("itemLevel", { min: "0", max: "250" }))),
    targetSection(),
    note("보스 장비는 일반 장비보다 추가옵션 단계가 2단계 높게 붙습니다."),
  );
  const heading = section.firstElementChild;
  const head = element("div", "card__head");
  heading.replaceWith(head);
  head.append(heading, resetAction("초기화", () => update(() => {
    for (const key of ["weapon", "itemLevel", "boss", "target", "tier", "damagePercent"]) state[key] = defaults[key];
  }), { key: "reset-add-option-targets", title: "목표와 장비 입력값만 기본값으로 되돌립니다. 시세와 캐릭터 정보는 유지합니다." }));
  return section;
}

function targetSection() {
  const targetControls = state.weapon
    ? [
        field(
          "공·마 추옵",
          searchableSelect(
            WEAPON_TIERS.map((tier) => ({ value: tier, label: `${tier}추` })),
            state.tier,
            (value) => update(() => { state.tier = Number(value); }),
            { key: "tier" },
          ),
        ),
        field("추가 보총뎀 목표", num("damagePercent", { min: "0", max: "100" })),
      ]
    : (() => {
        const control = element("div", "add-option-target-value");
        const input = num("target", { min: "1", max: "500" });
        input.placeholder = "예: 120";
        input.setAttribute("aria-label", "목표 추옵");
        control.append(
          input,
          element("span", "add-option-target-value__unit", "급"),
        );
        return [control];
      })();

  const section = element("section", "add-option-target-section");
  section.append(
    element("h3", "", "목표 추옵"),
    row(...targetControls),
  );
  return section;
}

function marketSection() {
  return setupSection(
    "환불 시세",
    "add-option-setup-section--market",
    row(
      field("심환불 1개 (만 메소)", num("abyssPrice", { min: "0", step: "1" })),
      field("강환불 1개 (만 메소)", num("strongPrice", { min: "0", step: "1" })),
    ),
    resultLine("검환불(메소) 1회 비용", formatMeso(BLACK_FLAME_MESO)),
    note("0원으로 둔 환불은 평균 비용을 계산하지 않고 평균 개수만 표시합니다."),
  );
}

function setupCard() {
  const section = element("section", "card add-option-setup-card");
  section.setAttribute("aria-label", "추가옵션 설정");
  const setup = element("div", "add-option-setup-grid");
  setup.append(equipmentSection(), marketSection());
  section.append(setup);
  return section;
}

function sourceCost(source) {
  if (source.expectedMeso !== null && source.expectedMeso !== undefined) {
    return source.expectedMeso;
  }
  const prices = { abyss: state.abyssPrice, strong: state.strongPrice };
  const each = Number(prices[source.key] ?? 0) * MAN;
  return each > 0 ? source.expectedAttempts * each : null;
}

function resultCard() {
  const section = createResultCard("계산 결과");
  let result;
  try {
    const activeProfile = getActiveProfile();
    const profile = getCalculationProfile({
      mainStat: state.mainStat,
      subStat: state.subStat,
      attackType: state.attackType,
      statEquivalence: activeProfile
        ? {}
        : damageEquivalenceToStatEquivalence(state),
    });
    let addOptionEquivalence =
      directEquivalence(activeProfile) ?? manualAddOptionEquivalence();
    if (
      state.weapon &&
      statModel(profile.mainStat) === "demon-avenger" &&
      String(addOptionEquivalence?.details?.mode ?? "").startsWith("conventional")
    ) {
      // DA's conventional armor flame score has no defensible conversion for
      // boss/damage %. On weapons, keep the additional target as raw 보총뎀.
      addOptionEquivalence = {
        ...addOptionEquivalence,
        flatStatToDamagePercent: {
          STR: 0,
          DEX: 0,
          INT: 0,
          LUK: 0,
          HP: 0,
        },
        flatAttackToDamagePercent: 0,
        allStatPercentToDamagePercent: 0,
      };
    }
    const common = {
      tables: ADD_OPTION_TABLES_SNAPSHOT,
      itemLevel: Math.round(state.itemLevel),
      boss: state.boss,
      mainStat: profile.mainStat,
      subStat: profile.subStat === "none" ? null : profile.subStat,
      subStats: getProfileSubStats(profile),
      attackType: profile.attackType,
      statEquivalence: profile.statEquivalence,
      addOptionEquivalence,
    };
    result = state.weapon
      ? calculateWeaponAddOption({
          ...common,
          tier: Math.round(state.tier),
          damagePercent: Number(state.damagePercent),
        })
      : calculateArmorAddOption({ ...common, target: Number(state.target) });
  } catch (error) {
    section.append(element("div", "result-empty", error?.message || "계산할 수 없습니다."));
    return section;
  }

  const wrap = element("div", "table-scroll add-option-result-table");
  const table = element("table", "source-table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const heading of ["환불", "확률", "평균 개수", "평균 비용"]) {
    headRow.append(element("th", "", heading));
  }
  thead.append(headRow);
  const tbody = document.createElement("tbody");
  for (const source of orderAddOptionSources(result.sources)) {
    const tr = document.createElement("tr");
    const cost = sourceCost(source);
    for (const value of [
      getAddOptionSourceLabel(source.key),
      formatProbability(source.probability, 5),
      formatAttempts(source.expectedAttempts),
      cost === null ? "시세 입력 시 계산" : formatMeso(cost),
    ]) tr.append(element("td", "", value));
    tbody.append(tr);
  }
  table.append(thead, tbody);
  wrap.append(table);
  section.append(wrap);
  return section;
}

function render() {
  const grid = element("div", "calculator-grid calculator-grid--add-option");
  const controls = element("div", "calculator-column");
  const profile = getActiveProfile();
  controls.append(
    setupCard(),
    characterProfileCard({
      extraContent: equivalenceDetails(profile),
      collapseReferenceDetails: true,
      equipmentMetric: "flame",
    }),
  );
  const result = element("aside", "calculator-result");
  result.append(resultCard());
  grid.append(controls, result);
  renderWithFocus(root, [grid]);
}

const unsubscribe = subscribeCharacterProfile(render);
window.addEventListener("pagehide", unsubscribe, { once: true });
render();

registerResultShare(() => ({ local: { [STORAGE_KEY]: state } }));
