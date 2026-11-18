import { getMaxStarforceStar, SUPPORTED_STARFORCE_LEVELS } from "maple-core/starforce";
import { EQUIPMENT_PRESETS, minimumStarforceStartStar } from "./starforce-equipment-presets.js";

export const EQUIPMENT_TEXT_HEADER = "[스타포스 장비목록]";
export const MAX_TEXT_EQUIPMENT = 100;
const MAX_TEXT_LENGTH = 16_000;

function presetName(preset) {
  const group = EQUIPMENT_PRESETS.find((entry) => entry.id === preset.groupId);
  return group ? `${group.name}(${preset.name})` : preset.name;
}

function resolveEquipment(name) {
  const levelMatch = name.match(/^(.+?)\s*\((\d+)제\)$/u);
  const label = (levelMatch?.[1] ?? name).trim();
  const preset = EQUIPMENT_PRESETS.find((entry) => presetName(entry) === label || entry.name === label);
  const itemLevel = levelMatch ? Number(levelMatch[2]) : preset?.level;
  if (!SUPPORTED_STARFORCE_LEVELS.includes(itemLevel)) {
    throw new Error(`알 수 없는 장비입니다: ${name}`);
  }
  return {
    presetId: preset?.id ?? `equipped-level-${itemLevel}`,
    itemLevel,
    ...(preset ? {} : { displayName: label }),
  };
}

/** 장비명과 시작·목표만 옮긴다. 가격, 할인, 배율, 수동 전략은 포함하지 않는다. */
export function formatEquipmentText(items) {
  const lines = [];
  for (const item of items) {
    const preset = EQUIPMENT_PRESETS.find((entry) => entry.id === item.presetId);
    let name = preset ? presetName(preset) : item.displayName || "장비";
    if (!preset || item.itemLevel !== preset.level) name += ` (${item.itemLevel}제)`;
    if (/[\r\n]/u.test(name) || name.length > 160) throw new Error("장비 이름을 확인해 주세요.");
    const quantity = Math.max(1, Math.round(item.quantity || 1));
    if (lines.length + quantity > MAX_TEXT_EQUIPMENT) throw new Error("장비는 한 번에 100개까지 복사할 수 있습니다.");
    for (let count = 0; count < quantity; count += 1) {
      lines.push(`${name} ${item.startStar}-${item.targetStar}`);
    }
  }
  if (!lines.length) throw new Error("복사할 장비를 먼저 추가해 주세요.");
  const text = lines.join("\n");
  // 생성한 텍스트도 같은 규칙으로 검사하여 복사 후 복원할 수 없는 입력을 막는다.
  parseEquipmentText(text);
  return text;
}

/** 전부 검증한 뒤 반환한다. 한 줄이라도 잘못되면 일부 장비도 적용하지 않는다. */
export function parseEquipmentText(text) {
  if (typeof text !== "string" || text.length > MAX_TEXT_LENGTH) {
    throw new Error("장비목록이 너무 깁니다. 100개 이하로 나눠 붙여넣어 주세요.");
  }
  const items = [];
  for (const [index, source] of text.replace(/^\uFEFF/u, "").split(/\r?\n/u).entries()) {
    const line = source.trim();
    if (!line || (index === 0 && line === EQUIPMENT_TEXT_HEADER)) continue;
    try {
      const match = line.match(/^(.+?)\s+(\d{1,2})(?:성)?\s*[-→–]\s*(\d{1,2})(?:성)?$/u);
      if (!match || match[1].length > 160) throw new Error("‘거공 12-22’ 형식으로 입력해 주세요.");
      const item = resolveEquipment(match[1].trim());
      const startStar = Number(match[2]);
      const targetStar = Number(match[3]);
      const maxStar = getMaxStarforceStar(item.itemLevel);
      const preset = EQUIPMENT_PRESETS.find((entry) => entry.id === item.presetId) ?? { name: item.displayName };
      const minStartStar = minimumStarforceStartStar(preset);
      if (startStar < minStartStar) {
        throw new Error(`${preset.name}의 시작 성수는 ${minStartStar}성 이상으로 입력해 주세요.`);
      }
      if (startStar >= targetStar || targetStar > maxStar) {
        throw new Error(`시작 성수보다 높은 목표를 입력해 주세요. ${item.itemLevel}제의 최대 목표는 ${maxStar}성입니다.`);
      }
      items.push({ ...item, startStar, targetStar });
    } catch (error) {
      throw new Error(`${index + 1}번째 줄: ${error.message}`);
    }
    if (items.length > MAX_TEXT_EQUIPMENT) throw new Error("장비는 한 번에 100개까지 붙여넣을 수 있습니다.");
  }
  if (!items.length) throw new Error("‘거공 12-22’ 형식의 장비목록을 입력해 주세요.");
  return items;
}
