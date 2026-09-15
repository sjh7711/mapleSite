import { readFile } from "node:fs/promises";

const ROOT = "/home/ubuntu";
const sources = [
  {
    model: "old",
    priority: 1,
    path: `${ROOT}/maplestarforce/tools/battle-practice-dataset/generated/validation-special-ring-before-all-jobs-20260910.json.partial.json`,
  },
  {
    model: "old",
    priority: 2,
    path: `${ROOT}/maplestarforce/tools/battle-practice-dataset/generated/validation-special-ring-before-remaining-production-20260910.json.partial.json`,
  },
  {
    model: "new",
    priority: 3,
    path: `${ROOT}/maplestarforce/tools/battle-practice-dataset/generated/validation-special-ring-after-remaining-local-20260910.json`,
  },
  {
    model: "new",
    priority: 4,
    path: `${ROOT}/maplestarforce/tools/battle-practice-dataset/generated/validation-special-ring-after-xenon-eunwol-local-20260910.json.partial.json`,
  },
];

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length
    ? finite.reduce((sum, value) => sum + value, 0) / finite.length
    : null;
}

function relativeError(actual, expected) {
  return (actual / expected - 1) * 100;
}

function ringAttack(ring) {
  const attack = Number(ring?.attackPercent);
  if (Number.isFinite(attack)) return attack;
  return Number(ring?.magicPercent) || 0;
}

function isContinuous(ring) {
  return String(ring?.name ?? "").includes("컨티뉴어스");
}

function timeUptime(ring, combatDuration) {
  if (isContinuous(ring)) {
    return Math.max(
      0,
      Math.min(1, (combatDuration - (Number(ring?.preparation) || 0)) / combatDuration),
    );
  }
  if (Number.isFinite(Number(ring?.timeUptime))) {
    return Number(ring.timeUptime);
  }
  if (Number.isFinite(Number(ring?.uptime))) return Number(ring.uptime);
  const duration = Number(ring?.duration) || 0;
  const cooldown = Number(ring?.cooldown) || combatDuration;
  return Math.max(0, Math.min(1, duration / cooldown));
}

function newUptime(ring, phaseProfile) {
  if (isContinuous(ring)) return 1;
  const duration = String(Number(ring?.duration));
  return Number(phaseProfile?.damageShareByDuration?.[duration]);
}

function ringTotals(rings, uptimeForRing) {
  return rings.reduce((totals, ring) => {
    const uptime = uptimeForRing(ring);
    if (!Number.isFinite(uptime)) return totals;
    totals.attack += ringAttack(ring) * uptime;
    totals.boss += (Number(ring?.bossDamage) || 0) * uptime;
    return totals;
  }, { attack: 0, boss: 0 });
}

function rowImpact(entry, phaseProfiles) {
  const row = entry.row;
  const details = row.profileDetails;
  const rings = details.combatRings ?? [];
  const combatDuration = Number(details.combatDurationSeconds) || 360;
  const phaseProfile = phaseProfiles[row.characterClass];
  const oldRings = ringTotals(rings, (ring) => timeUptime(ring, combatDuration));
  const newRings = ringTotals(rings, (ring) => newUptime(ring, phaseProfile));

  let oldActualAttack;
  let newActualAttack;
  let oldActualBoss;
  let newActualBoss;

  if (entry.model === "old") {
    const oldDopedAttack = Number(details.dopedAttackPercent);
    const oldDopedDamage = Number(
      details.dopedDamageTotal ?? details.damageTotal,
    );
    const newDopedAttack = oldDopedAttack - oldRings.attack + newRings.attack;
    const newDopedDamage = oldDopedDamage - oldRings.boss + newRings.boss;
    oldActualAttack = Number(row.actuals.attackPercent);
    oldActualBoss = Number(row.actuals.bossDamage);
    newActualAttack = oldActualAttack * (100 + oldDopedAttack) / (100 + newDopedAttack);
    newActualBoss = oldActualBoss * (100 + oldDopedDamage) / (100 + newDopedDamage);
  } else {
    const newDopedAttack = Number(details.dopedAttackPercent);
    const newDopedDamage = Number(
      details.dopedDamageTotal ?? details.damageTotal,
    );
    const oldDopedAttack = newDopedAttack - newRings.attack + oldRings.attack;
    const oldDopedDamage = newDopedDamage - newRings.boss + oldRings.boss;
    newActualAttack = Number(row.actuals.attackPercent);
    newActualBoss = Number(row.actuals.bossDamage);
    oldActualAttack = newActualAttack * (100 + newDopedAttack) / (100 + oldDopedAttack);
    oldActualBoss = newActualBoss * (100 + newDopedDamage) / (100 + oldDopedDamage);
  }

  const oldAttackError = relativeError(oldActualAttack, Number(row.attackPercent));
  const newAttackError = relativeError(newActualAttack, Number(row.attackPercent));
  const oldBossError = relativeError(oldActualBoss, Number(row.bossDamage));
  const newBossError = relativeError(newActualBoss, Number(row.bossDamage));
  return {
    characterName: row.characterName,
    characterClass: row.characterClass,
    oldAttackError,
    newAttackError,
    oldBossError,
    newBossError,
    oldAttackAbsoluteError: Math.abs(oldAttackError),
    newAttackAbsoluteError: Math.abs(newAttackError),
    oldBossAbsoluteError: Math.abs(oldBossError),
    newBossAbsoluteError: Math.abs(newBossError),
    oldRingAttack: oldRings.attack,
    newRingAttack: newRings.attack,
    oldRingBoss: oldRings.boss,
    newRingBoss: newRings.boss,
    sourceModel: entry.model,
  };
}

const profileSource = await readFile(
  `${ROOT}/maple-core/src/special-ring-phase-profiles.js`,
  "utf8",
);
const profileMatch = profileSource.match(/const profiles = (\{[\s\S]*?\n\});/);
if (!profileMatch) throw new Error("특수 반지 직업 프로필을 읽지 못했습니다.");
const phaseProfiles = JSON.parse(profileMatch[1]);

const selectedByClass = new Map();
for (const source of sources) {
  const report = JSON.parse(await readFile(source.path, "utf8"));
  const validRows = (report.rows ?? []).filter((row) =>
    row?.ok === true &&
    row?.profileDetails &&
    row?.actuals &&
    phaseProfiles[row.characterClass]
  );
  const grouped = Map.groupBy(validRows, (row) => row.characterClass);
  for (const [characterClass, rows] of grouped) {
    const existing = selectedByClass.get(characterClass);
    if (!existing || rows.length > existing.rows.length || (
      rows.length === existing.rows.length && source.priority > existing.priority
    )) {
      selectedByClass.set(characterClass, {
        model: source.model,
        priority: source.priority,
        rows: rows.slice(0, 5),
      });
    }
  }
}

const impacts = [];
for (const [characterClass, selection] of selectedByClass) {
  for (const row of selection.rows) {
    impacts.push(rowImpact({ model: selection.model, row }, phaseProfiles));
  }
}

const byClass = [...selectedByClass.keys()].sort((a, b) => a.localeCompare(b, "ko"))
  .map((characterClass) => {
    const rows = impacts.filter((row) => row.characterClass === characterClass);
    const oldAttack = median(rows.map((row) => row.oldAttackAbsoluteError));
    const newAttack = median(rows.map((row) => row.newAttackAbsoluteError));
    const oldBoss = median(rows.map((row) => row.oldBossAbsoluteError));
    const newBoss = median(rows.map((row) => row.newBossAbsoluteError));
    return {
      characterClass,
      sampleCount: rows.length,
      attackPercent: {
        before: oldAttack,
        after: newAttack,
        change: newAttack - oldAttack,
      },
      bossDamage: {
        before: oldBoss,
        after: newBoss,
        change: newBoss - oldBoss,
      },
    };
  });

const summary = {
  expectedClassCount: Object.keys(phaseProfiles).length,
  measuredClassCount: byClass.length,
  measuredCharacterCount: impacts.length,
  missingClasses: Object.keys(phaseProfiles)
    .filter((characterClass) => !selectedByClass.has(characterClass))
    .sort((a, b) => a.localeCompare(b, "ko")),
  partialClasses: byClass
    .filter((row) => row.sampleCount < 5)
    .map((row) => ({ characterClass: row.characterClass, sampleCount: row.sampleCount })),
  macroAverageOfClassMedians: {
    attackPercent: {
      before: mean(byClass.map((row) => row.attackPercent.before)),
      after: mean(byClass.map((row) => row.attackPercent.after)),
    },
    bossDamage: {
      before: mean(byClass.map((row) => row.bossDamage.before)),
      after: mean(byClass.map((row) => row.bossDamage.after)),
    },
  },
  rowMedian: {
    attackPercent: {
      before: median(impacts.map((row) => row.oldAttackAbsoluteError)),
      after: median(impacts.map((row) => row.newAttackAbsoluteError)),
    },
    bossDamage: {
      before: median(impacts.map((row) => row.oldBossAbsoluteError)),
      after: median(impacts.map((row) => row.newBossAbsoluteError)),
    },
  },
  classOutcomes: {
    attackPercent: {
      improved: byClass.filter((row) => row.attackPercent.change < -1e-9).length,
      unchanged: byClass.filter((row) => Math.abs(row.attackPercent.change) <= 1e-9).length,
      worsened: byClass.filter((row) => row.attackPercent.change > 1e-9).length,
    },
    bossDamage: {
      improved: byClass.filter((row) => row.bossDamage.change < -1e-9).length,
      unchanged: byClass.filter((row) => Math.abs(row.bossDamage.change) <= 1e-9).length,
      worsened: byClass.filter((row) => row.bossDamage.change > 1e-9).length,
    },
  },
  classesWithinFourPercent: {
    attackPercent: {
      before: byClass.filter((row) => row.attackPercent.before < 4).length,
      after: byClass.filter((row) => row.attackPercent.after < 4).length,
    },
    bossDamage: {
      before: byClass.filter((row) => row.bossDamage.before < 4).length,
      after: byClass.filter((row) => row.bossDamage.after < 4).length,
    },
  },
};

for (const metric of ["attackPercent", "bossDamage"]) {
  const value = summary.macroAverageOfClassMedians[metric];
  value.change = value.after - value.before;
  value.reductionRate = (value.before - value.after) / value.before * 100;
  const rowValue = summary.rowMedian[metric];
  rowValue.change = rowValue.after - rowValue.before;
  rowValue.reductionRate = (rowValue.before - rowValue.after) / rowValue.before * 100;
}

if (process.argv.includes("--tsv")) {
  console.log("직업\t공마% 전\t공마% 후\t공마% 증감\t보공뎀 전\t보공뎀 후\t보공뎀 증감");
  for (const row of byClass) {
    const values = [
      row.characterClass,
      row.attackPercent.before,
      row.attackPercent.after,
      row.attackPercent.change,
      row.bossDamage.before,
      row.bossDamage.after,
      row.bossDamage.change,
    ];
    console.log(values.map((value, index) =>
      index === 0 ? value : Number(value).toFixed(2)
    ).join("\t"));
  }
} else {
  console.log(JSON.stringify({ summary, byClass }, null, 2));
}
