// KMS 일반 장비. 단계별 능력치 표이며, 강화 비용과 독립적이다.
// https://kiiten.com/data/starforce/stats (2026-09-15)
// https://maplestory.nexon.com/news/update/767
// 슈페리얼·놀장은 이 표를 적용하지 않는다.
const STATS = ["str", "dex", "int", "luk"];
const OPTION_KEYS = [...STATS, "attack_power", "magic_power"];
const GLOVE_STARS = new Set([5, 7, 9, 11, 13, 14, 15]);
const ARMOR_ATTACK = {
  130: [7, 8, 9, 10, 11],
  140: [8, 9, 10, 11, 12, 13, 15, 17, 19, 21, 22, 23, 24, 25, 26],
  150: [9, 10, 11, 12, 13, 14, 16, 18, 20, 22, 23, 24, 25, 26, 27],
  160: [10, 11, 12, 13, 14, 15, 17, 19, 21, 23, 24, 25, 26, 27, 28],
  200: [12, 13, 14, 15, 16, 17, 19, 21, 23, 25, 26, 27, 28, 29, 30],
  250: [14, 15, 16, 17, 18, 19, 21, 23, 25, 27, 28, 29, 30, 31, 32],
};
const WEAPON_ATTACK = {
  130: [6, 6, 7, 7, 8],
  140: [7, 7, 8, 8, 9, 10, 11, 22, 23, 24, 25, 26, 27, 28, 29],
  150: [8, 8, 9, 9, 10, 11, 12, 24, 25, 26, 27, 28, 29, 30, 31],
  160: [9, 9, 10, 10, 11, 12, 13, 26, 27, 28, 29, 30, 31, 32, 33],
  200: [13, 13, 14, 14, 15, 16, 17, 34, 35, 36, 37, 38, 39, 40, 41],
  250: [16, 16, 17, 17, 18, 19, 20, 40, 41, 42],
};
// 데스티니 2차 초월. 16~22성은 제공된 실제 강화 화면과 대조했다.
// 23성부터 일반 250제 무기 표와 다르다.
// 실제 강화 화면: https://www.inven.co.kr/board/maple/5974/6612441
// 22→23성 +36, 23→24성 +37, 24→25성 +38.
const DESTINY_ATTACK = [16, 16, 17, 17, 18, 19, 20, 36, 37, 38];
// 공통 데스티니 항목에 기본·주문서 공마가 없으면 제공된 튜너 실측값을 쓴다.
// 실제 무기 정보가 있으면 아래 weaponLowAttack 계산을 유지한다.
const DESTINY_REFERENCE_LOW_ATTACK = { 13: 12, 14: 12, 15: 13 };
const GLOVE_MODE_PRESETS = new Set(["eternal-glove", "arcane-shoulder"]);
const STAT_STEP = { 130: 7, 140: 9, 150: 11, 160: 13, 200: 15, 250: 17 };
const COMMON_PRESETS = new Set([
  "meister-ring", "daybreak-pendant", "dominator", "loose-control",
  "magic-eyepatch", "seniority-ring", "gaen-ring", "dreamy-belt",
  "commanding-force", "giant-fear", "whisper-earring", "origin-whisper",
  "oath-of-death", "ecstatic-nightmare", "bloody-soul",
]);

/** 묶음 장비의 수치 표 규칙. 불러온 개별 부위는 기본 선택에 반영한다. */
export function starforceStatGrowthModes(preset) {
  if (GLOVE_MODE_PRESETS.has(preset?.id)) return [["armor", "일반"], ["glove", "장갑"]];
  if (preset?.id === "astra-secondary") return [["armor", "일반"], ["weapon", "무기"]];
  return [];
}

export function starforceStatGrowthMode(item, preset, equipment = item.growthEquipment) {
  const modes = starforceStatGrowthModes(preset);
  if (!modes.length) return null;
  if (modes.some(([mode]) => mode === item.statGrowthMode)) return item.statGrowthMode;
  const part = equipment?.part || equipment?.slot;
  if (GLOVE_MODE_PRESETS.has(preset.id) && part === "장갑") return "glove";
  if (preset.id === "astra-secondary" && /블레이드/u.test(equipment?.name ?? "")) return "weapon";
  return modes[0][0];
}

export function isExcludedStarforceEquipment(raw) {
  const name = String(raw?.name ?? raw?.item_name ?? "");
  const applied = (value) => [true, 1, "1", "Y", "사용", "적용"].includes(value);
  return /타일런트|슈페리얼|놀장/u.test(name) || applied(raw?.starforce_scroll_flag) || applied(raw?.superior_eqp_flag);
}

function number(value) {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 100_000 ? parsed : null;
}

/** 계산에 필요한 숫자만 공개한다. 추옵은 주·부스탯 판정에 사용하지 않는다. */
export function normalizeStarforceGrowthOptions(raw) {
  const source = raw?.growthOptions ?? {
    base: raw?.item_base_option,
    scroll: raw?.item_etc_option,
    starforce: raw?.item_starforce_option,
  };
  const result = {};
  for (const component of ["base", "scroll", "starforce"]) {
    const values = {};
    for (const key of OPTION_KEYS) {
      const value = number(source?.[component]?.[key]);
      if (value !== null) values[key] = value;
    }
    if (Object.keys(values).length) result[component] = values;
  }
  return Object.keys(result).length ? result : null;
}

function levelBand(level) {
  if (level >= 250) return 250;
  if (level >= 200) return 200;
  if (level >= 160) return 160;
  if (level >= 150) return 150;
  return level >= 138 ? 140 : 130;
}

function classStats(name) {
  if (/시프|어새신|체이서/u.test(name)) return ["dex", "luk"];
  if (/메이지|매지션/u.test(name)) return ["int", "luk"];
  if (/워리어|나이트|아처|레인져|레인저|파이렛|스키퍼/u.test(name)) return ["str", "dex"];
  return null;
}

function lowStarTotal(star) {
  return Math.min(star, 5) * 2 + Math.max(0, Math.min(star, 15) - 5) * 3;
}

function profileFor(item, preset, equipment) {
  const name = equipment?.name ?? item.displayName ?? preset?.name ?? "";
  const part = equipment?.part || equipment?.slot || preset?.equipmentPart || "";
  const options = normalizeStarforceGrowthOptions(equipment);
  const band = levelBand(item.itemLevel);
  let primary = classStats(name);
  // 현재 SF 성분으로 1~15성에서 증가한 능력치를 판정한다.
  if (options?.starforce && STATS.every((key) => Object.hasOwn(options.starforce, key)) && equipment.starforce > 0) {
    const low = lowStarTotal(equipment.starforce);
    const high = Math.max(0, Math.min(equipment.starforce, 22) - 15) * STAT_STEP[band];
    const observed = STATS.filter((key) => {
      const value = options.starforce[key];
      return value === low || value === low + high;
    });
    if (observed.length) primary = observed;
  }
  if (!primary && COMMON_PRESETS.has(preset?.id)) primary = STATS;
  if (!primary && options?.base) {
    const present = STATS.filter((key) => options.base[key] > 0);
    if (present.length && present.length < 4) primary = present;
  }
  const extra = options?.base
    ? STATS.filter((key) => (options.base[key] ?? 0) + (options.scroll?.[key] ?? 0) > 0)
    : null;
  const isAstra = preset?.id === "astra-secondary" || /^아스트라/u.test(name);
  const destiny = preset?.id === "destiny-weapon" || /^데스티니/u.test(name);
  const mode = starforceStatGrowthMode(item, preset, equipment);
  const weapon = mode ? mode === "weapon" : destiny || part === "무기" || equipment?.slot === "무기" || (isAstra && /블레이드/u.test(name));
  const glove = mode ? mode === "glove" : part === "장갑" || preset?.id === "eternal-part-glove";
  let mage = /메이지|매지션/u.test(name) ? true : primary && !primary.includes("int") ? false : null;
  if (glove && options?.starforce && equipment.starforce >= 5) {
    const baseHigh = (ARMOR_ATTACK[band] ?? []).slice(0, Math.max(0, equipment.starforce - 15)).reduce((a, b) => a + b, 0);
    if ((options.starforce.magic_power ?? 0) > baseHigh) mage = true;
    else if ((options.starforce.attack_power ?? 0) > baseHigh) mage = false;
  }
  return { name, part, options, band, primary, extra, weapon, glove, mage, destiny,
    excluded: isExcludedStarforceEquipment({ ...equipment, name }) || /^(?:라피스|라즐리|제네시스)/u.test(name),
  };
}

function weaponLowAttack(profile, key, star) {
  const initial = profile.options?.base?.[key];
  if (initial === undefined) return null;
  if (initial === 0) return 0;
  let attack = initial + (profile.options?.scroll?.[key] ?? 0);
  for (let current = 1; current < star; current += 1) attack += Math.floor(attack / 50) + 1;
  return Math.floor(attack / 50) + 1;
}

function gainAt(profile, star) {
  if (profile.excluded || (profile.destiny && star > 25)) return { unavailable: true };
  const stat = star <= 5 ? 2 : star <= 15 ? 3 : star <= 22 ? STAT_STEP[profile.band] : 0;
  const stats = {};
  const applicable = star <= 15 ? profile.primary : profile.extra && profile.primary
    ? [...new Set([...profile.primary, ...profile.extra])] : profile.primary;
  for (const key of applicable ?? ["applicable"]) stats[key] = stat;
  let attack = 0, magic = 0, either = 0, attackUnknown = false;
  if (profile.weapon) {
    if (star <= 15) {
      const referenceDelta = profile.destiny ? DESTINY_REFERENCE_LOW_ATTACK[star] : undefined;
      const missingBase = profile.options?.base?.attack_power === undefined &&
        profile.options?.base?.magic_power === undefined;
      if (referenceDelta !== undefined && missingBase) {
        either = referenceDelta;
      } else {
        attack = weaponLowAttack(profile, "attack_power", star);
        magic = weaponLowAttack(profile, "magic_power", star);
        attackUnknown = attack === null || magic === null;
      }
    } else {
      const delta = profile.destiny
        ? DESTINY_ATTACK[star - 16] : WEAPON_ATTACK[profile.band]?.[star - 16];
      if (delta === undefined) return { unavailable: true };
      const base = profile.options?.base;
      if (base && (base.attack_power > 0 || base.magic_power > 0)) {
        attack = base.attack_power > 0 ? delta : 0;
        magic = base.magic_power > 0 ? delta : 0;
      } else either = delta;
    }
  } else if (star >= 16) {
    const delta = ARMOR_ATTACK[profile.band]?.[star - 16];
    if (delta === undefined) return { unavailable: true };
    attack = magic = delta;
  } else if (GLOVE_STARS.has(star)) {
    if (profile.glove) {
      if (profile.mage === true) magic = 1;
      else if (profile.mage === false) attack = 1;
      else either = 1;
    }
  }
  return { stats, attack: attack ?? 0, magic: magic ?? 0, either, attackUnknown };
}

function emptyGain() {
  return { stats: {}, attack: 0, magic: 0, either: 0, attackUnknown: false };
}

function sumGain(left, right) {
  if (left.unavailable || right.unavailable) return { unavailable: true };
  const stats = { ...left.stats };
  for (const [key, value] of Object.entries(right.stats)) stats[key] = (stats[key] ?? 0) + value;
  return { stats, attack: left.attack + right.attack, magic: left.magic + right.magic,
    either: left.either + right.either, attackUnknown: left.attackUnknown || right.attackUnknown };
}

/** 누적은 0성이 아닌 사용자가 선택한 시작 성수부터의 차이이다. */
export function starforceStageStatGains(item, preset = {}, equipment = item.growthEquipment) {
  if (!Number.isInteger(item.startStar) || !Number.isInteger(item.targetStar) || item.startStar < 0 ||
      item.targetStar > 30 || item.targetStar <= item.startStar || !Number.isInteger(item.itemLevel) || item.itemLevel < 128) return [];
  const profile = profileFor(item, preset, equipment);
  let cumulative = emptyGain();
  const stages = [];
  for (let star = item.startStar; star < item.targetStar; star += 1) {
    const gain = gainAt(profile, star + 1);
    cumulative = sumGain(cumulative, gain);
    stages.push({ star, gain, cumulative });
  }
  return stages;
}

/** 한 셀 안의 줄들. DOM을 반환하지 않아 수치 계산 자체를 독립적으로 검증할 수 있다. */
export function formatStarforceStatGain(gain) {
  if (!gain || gain.unavailable) return ["—"];
  const grouped = new Map();
  for (const [key, value] of Object.entries(gain.stats)) {
    if (value) grouped.set(value, [...(grouped.get(value) ?? []), key]);
  }
  const lines = [...grouped].map(([value, keys]) => {
    const label = keys.includes("applicable") ? "주·부스탯" : keys.length === 4 ? "올스탯" : keys.map((key) => key.toUpperCase()).join("·");
    return `${label} +${value}`;
  });
  if (gain.attackUnknown) lines.push("공·마: 장비별 상이");
  else {
    const attack = applicableAttack(gain);
    if (attack) lines.push(`공·마 +${attack}`);
  }
  return lines.length ? lines : ["—"];
}

// 장갑의 직업별 보너스를 해당 직업에 적용되는 공·마에 합쳐 표시한다.
// 원본의 공격력·마력 성분은 별도로 유지한다.
function applicableAttack(gain) {
  return Math.max(gain.attack, gain.magic) + gain.either;
}

/** 장비별 표의 주·부스탯 기준값과 직업에 적용되는 공·마를 합산한다.
 * 올스탯처럼 여러 능력치에 같은 값이 붙어도 한 장비에서 중복 계산하지 않는다.
 */
export function starforceTotalStatGains(entries) {
  const total = { stat: 0, attack: 0, attackUnknown: false, unavailable: false };
  for (const { item, preset = {}, quantity = item.quantity ?? 1 } of entries) {
    const gain = starforceStageStatGains(item, preset).at(-1)?.cumulative;
    if (!gain || gain.unavailable || !Number.isSafeInteger(quantity) || quantity < 1) {
      total.unavailable = true;
      continue;
    }
    total.stat += Math.max(0, ...Object.values(gain.stats)) * quantity;
    total.attack += applicableAttack(gain) * quantity;
    total.attackUnknown ||= gain.attackUnknown;
  }
  return total;
}

/** 단계·누적의 같은 줄에 같은 능력치를 놓고 이름은 단계 열에 한 번만 쓴다. */
export function starforceStatGainRows(gain, cumulative) {
  if (!gain || !cumulative || gain.unavailable || cumulative.unavailable) {
    return [{ label: "", step: "—", cumulative: "—" }];
  }
  const rows = [];
  const grouped = new Map();
  const keys = new Set([...Object.keys(gain.stats), ...Object.keys(cumulative.stats)]);
  const signed = (value) => `+${value}`;
  for (const key of keys) {
    const step = gain.stats[key] ?? 0, total = cumulative.stats[key] ?? 0;
    if (!step && !total) continue;
    const pair = `${step}/${total}`;
    const group = grouped.get(pair) ?? { keys: [], step, total };
    group.keys.push(key);
    grouped.set(pair, group);
  }
  for (const { keys, step, total } of grouped.values()) {
    const label = keys.includes("applicable") ? "주·부스탯" : keys.length === 4 ? "올스탯" : keys.map((key) => key.toUpperCase()).join("·");
    rows.push({ label, step: signed(step), cumulative: signed(total) });
  }
  if (gain.attackUnknown || cumulative.attackUnknown) {
    rows.push({ label: "공·마",
      step: gain.attackUnknown ? "장비별 상이" : signed(applicableAttack(gain)),
      cumulative: "장비별 상이" });
  } else {
    const step = applicableAttack(gain), total = applicableAttack(cumulative);
    if (step || total) rows.push({ label: "공·마", step: signed(step), cumulative: signed(total) });
  }
  return rows.length ? rows : [{ label: "", step: "—", cumulative: "—" }];
}
