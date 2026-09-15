const PRIMARY_STAT_BY_CLASS = Object.freeze({
  "히어로": "STR",
  "팔라딘": "STR",
  "다크나이트": "STR",
  "아크메이지(불,독)": "INT",
  "아크메이지(썬,콜)": "INT",
  "비숍": "INT",
  "보우마스터": "DEX",
  "신궁": "DEX",
  "패스파인더": "DEX",
  "나이트로드": "LUK",
  "섀도어": "LUK",
  "듀얼블레이더": "LUK",
  "바이퍼": "STR",
  "캡틴": "DEX",
  "캐논마스터": "STR",
  "소울마스터": "STR",
  "플레임위자드": "INT",
  "윈드브레이커": "DEX",
  "나이트워커": "LUK",
  "스트라이커": "STR",
  "미하일": "STR",
  "아란": "STR",
  "에반": "INT",
  "배틀메이지": "INT",
  "와일드헌터": "DEX",
  "메카닉": "DEX",
  "데몬슬레이어": "STR",
  "데몬어벤져": "HP",
  // 환산주스탯의 제논 표는 STR%를 12% 기준축으로 사용한다.
  "제논": "STR",
  "블래스터": "STR",
  "메르세데스": "DEX",
  "팬텀": "LUK",
  "루미너스": "INT",
  "카이저": "STR",
  "엔젤릭버스터": "DEX",
  "제로": "STR",
  "은월": "STR",
  "키네시스": "INT",
  "카데나": "LUK",
  "일리움": "INT",
  "아크": "STR",
  "호영": "LUK",
  "아델": "STR",
  "카인": "DEX",
  "라라": "INT",
  "칼리": "LUK",
  "렌": "STR",
  "레테": "INT",
});

function finiteNumber(value) {
  const parsed = Number(String(value ?? "")
    .replaceAll(",", "")
    .replace("%", "")
    .trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function canonicalLabel(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .replace("크댐", "크뎀")
    .trim();
}

export function primaryStatForClass(characterClass) {
  return PRIMARY_STAT_BY_CLASS[String(characterClass ?? "").trim()] ?? null;
}

export function normalizedMapleScouterEfficiencyRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    label: canonicalLabel(row?.label),
    amount: finiteNumber(row?.amount),
    finalDamagePercent: finiteNumber(row?.finalDamagePercent),
  })).filter(({ label, amount, finalDamagePercent }) =>
    label && amount !== null && finalDamagePercent !== null
  );
}

function rowByLabels(rows, labels) {
  const wanted = new Set(labels.map(canonicalLabel));
  return rows.find(({ label }) => wanted.has(label)) ?? null;
}

/**
 * 같은 캐릭터 상태에서 각 옵션을 독립적으로 더했을 때의 최종뎀 증가율을
 * 주스탯% 증가율과 비교한다. 주스탯%에 따른 스탯 공격력 증가는 이 구간에서
 * 선형이므로 기준 입력량의 비율로 환산할 수 있다.
 */
export function maplescouterEfficiencyReference(characterClass, rawRows) {
  const rows = normalizedMapleScouterEfficiencyRows(rawRows);
  const mainStat = primaryStatForClass(characterClass);
  const mainPercent = rowByLabels(rows, [`${mainStat}%`]);
  if (!mainStat || !mainPercent || !(mainPercent.finalDamagePercent > 0)) {
    return {
      ok: false,
      reason: mainStat ? "main-stat-percent-row-missing" : "unknown-primary-stat",
      mainStat,
      rows,
    };
  }

  const equivalent = (labels) => {
    const row = rowByLabels(rows, labels);
    if (!row) return null;
    return {
      amount: row.amount,
      finalDamagePercent: row.finalDamagePercent,
      mainStatPercent: mainPercent.amount *
        row.finalDamagePercent / mainPercent.finalDamagePercent,
    };
  };
  const attackName = rows.some(({ label }) => label === "마력")
    ? "마력"
    : "공격력";

  return {
    ok: true,
    mainStat,
    mainStatPercent: {
      amount: mainPercent.amount,
      finalDamagePercent: mainPercent.finalDamagePercent,
      mainStatPercent: mainPercent.amount,
    },
    bossDamage: equivalent(["보총뎀", "보뎀"]),
    flatAttack: equivalent([attackName]),
    attackPercent: equivalent([`${attackName}%`]),
    criticalDamage: equivalent(["크뎀"]),
    ignoreDefense300: equivalent(["방무(300)"]),
    ignoreDefense380: equivalent(["방무(380)"]),
    allStatPercent: equivalent(["올스탯%"]),
    rows,
  };
}

export function referenceEfficiencyRow(record) {
  const reference = record?.reference;
  if (!reference?.ok) return null;
  const ied300 = Number(reference.ignoreDefense300?.mainStatPercent);
  const ied380 = Number(reference.ignoreDefense380?.mainStatPercent);
  if (!(ied300 > 0) || !(ied380 > 0)) return null;
  return {
    characterName: String(record.characterName ?? "").trim(),
    characterClass: String(record.characterClass ?? "").trim(),
    rank: Number.isInteger(Number(record.rank)) && Number(record.rank) > 0
      ? Number(record.rank)
      : null,
    ied300,
    ied380,
    bossDamage: Number(reference.bossDamage?.mainStatPercent) || null,
    flatAttack: Number(reference.flatAttack?.mainStatPercent) || null,
    attackPercent: Number(reference.attackPercent?.mainStatPercent) || null,
    criticalDamage: Number(reference.criticalDamage?.mainStatPercent) || null,
    allStatPercent: Number(reference.allStatPercent?.mainStatPercent) || null,
    amounts: {
      bossDamage: Number(reference.bossDamage?.amount) || null,
      flatAttack: Number(reference.flatAttack?.amount) || null,
      attackPercent: Number(reference.attackPercent?.amount) || null,
      criticalDamage: Number(reference.criticalDamage?.amount) || null,
      allStatPercent: Number(reference.allStatPercent?.amount) || null,
    },
    source: "maplescouter-browser",
    collectedAt: record.collectedAt ?? null,
  };
}
