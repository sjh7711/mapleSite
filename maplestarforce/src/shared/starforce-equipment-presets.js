/**
 * @typedef {{id:string,name:string,level:number,price:number,icon?:string,
 * groupId?:string,equipmentPart?:string,npcSpare?:boolean,folded?:boolean,minStartStar?:number}} EquipmentPreset
 */

const EQUIPMENT_GROUP_PARTS = {
  "eternal-hat": [
    { id: "eternal-part-hat", name: "모자", equipmentPart: "모자", icon: "./equipments/모상하견.png" },
    { id: "eternal-part-top", name: "상의", equipmentPart: "상의", icon: "./equipments/eternal-top.png" },
    { id: "eternal-part-bottom", name: "하의", equipmentPart: "하의", icon: "./equipments/eternal-bottom.png" },
    { id: "eternal-part-shoulder", name: "견장", equipmentPart: "어깨장식", icon: "./equipments/eternal-shoulder.png" },
  ],
  "eternal-glove": [
    { id: "eternal-part-glove", name: "장갑", equipmentPart: "장갑", icon: "./equipments/장신망.png" },
    { id: "eternal-part-shoes", name: "신발", equipmentPart: "신발", icon: "./equipments/eternal-shoes.png" },
    { id: "eternal-part-cape", name: "망토", equipmentPart: "망토", icon: "./equipments/eternal-cape.png" },
  ],
};

export function minimumStarforceStartStar(preset) {
  return /^데스티니/u.test(preset?.name ?? "") ? 12 : preset?.minStartStar ?? 0;
}

/**
 * 버튼으로 고르는 장비 목록. 레벨은 계산에 쓰이고 price는 스페어값 기본값이다.
 * 시세는 계속 바뀌므로 이 값은 어디까지나 출발점이고, 실제 값은 이용자가
 * 화면에서 일괄로 고쳐 각자 브라우저에 저장한다.
 */
/** @type {EquipmentPreset[]} */
export const EQUIPMENT_PRESETS = [
  { id: "meister-ring", name: "마이링", level: 140, price: 0.5 },
  { id: "daybreak-pendant", name: "데브펜", level: 140, price: 0.15 },
  { id: "dominator", name: "140제", icon: "./equipments/도미.png", level: 140, price: 15, folded: true },
  { id: "loose-control", name: "루컨마", level: 160, price: 16 },
  { id: "magic-eyepatch", name: "마깃안", level: 160, price: 37 },
  { id: "seniority-ring", name: "고근", level: 160, price: 63 },
  { id: "gaen-ring", name: "가엔링", level: 160, price: 0.15 },
  // 아케인은 견장·망토·신발 값이 같아 한 칸으로 묶는다.
  { id: "dreamy-belt", name: "몽벨", level: 200, price: 45 },
  { id: "commanding-force", name: "커포", level: 200, price: 15 },
  { id: "giant-fear", name: "거공", level: 200, price: 52 },
  { id: "whisper-earring", name: "컴플", level: 200, price: 230 },
  { id: "astra-secondary", name: "아스트라", level: 200, price: 10, npcSpare: true },
  { id: "arcane-shoulder", name: "아케인", level: 200, price: 0.1 },
  { id: "eternal-hat", name: "모상하견", level: 250, price: 0.2 },
  { id: "eternal-glove", name: "장신망", level: 250, price: 17.5 },
  { id: "origin-whisper", name: "근속", level: 250, price: 600 },
  { id: "oath-of-death", name: "죽맹", level: 250, price: 750 },
  { id: "ecstatic-nightmare", name: "황홀", icon: "./equipments/황몽.png", level: 250, price: 580 },
  { id: "bloody-soul", name: "원혼", icon: "./equipments/굶핏.png", level: 250, price: 800 },
  { id: "destiny-weapon", name: "데스티니", level: 250, price: 100, npcSpare: true, minStartStar: 12 },
  // 스타포스를 잘 올리지 않는 구간. 장비를 따로 나열하지 않고 스페어값만 넣어 쓴다.
  { id: "level-130", name: "130제", icon: "./equipments/130제.webp", level: 130, price: 15, folded: true },
  { id: "level-135", name: "135제", level: 135, price: 3, folded: true },
  { id: "level-145", name: "145제", level: 145, price: 4.5, folded: true },
  { id: "level-150", name: "150제", level: 150, price: 0.1, folded: true },
].flatMap((preset) => {
  // 아이콘 파일 이름은 표시되는 장비 이름을 그대로 쓴다. id를 쓰면 이름이 바뀌었을 때
  // 파일명이 실제 장비와 어긋나 무슨 그림인지 알기 어려워진다.
  const group = { icon: `./equipments/${encodeURIComponent(preset.name)}.png`, ...preset };
  return [group, ...(EQUIPMENT_GROUP_PARTS[preset.id] ?? []).map((part) => ({
    ...group, ...part, groupId: preset.id,
  }))];
});

export function equipmentGroupMembers(groupId) {
  return EQUIPMENT_PRESETS.filter((preset) => preset.groupId === groupId);
}

/** 레벨별로 묶어 고르기 쉽게 만든다. */
export function groupPresetsByLevel() {
  const groups = new Map();
  for (const preset of EQUIPMENT_PRESETS) {
    if (preset.folded || preset.groupId) continue;
    if (!groups.has(preset.level)) groups.set(preset.level, []);
    groups.get(preset.level).push(preset);
  }
  return [...groups.entries()]
    // 요즘 쓰는 장비가 위로 오도록 높은 레벨부터 늘어놓는다.
    .sort(([left], [right]) => right - left)
    .map(([level, presets]) => ({ level, presets }));
}

/** 목록 없이 스페어값만 넣어 쓰는 레벨. 접어서 맨 아래에 둔다. */
export function foldedPresets() {
  return EQUIPMENT_PRESETS.filter((preset) => preset.folded).sort(
    (left, right) => right.level - left.level,
  );
}

export function findPreset(id) {
  return EQUIPMENT_PRESETS.find((preset) => preset.id === id) ?? EQUIPMENT_PRESETS[0];
}
