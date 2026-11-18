import { getMaxStarforceStar, SUPPORTED_STARFORCE_LEVELS } from "maple-core/starforce";
import { EQUIPMENT_PRESETS, minimumStarforceStartStar } from "./starforce-equipment-presets.js";
import { starforceStatGrowthMode, starforceStatGrowthModes } from "./starforce-stat-gains.js";

export const INBOX_STATUSES = { waiting: "대기중", working: "진행중", done: "완료" };
export const INBOX_EDIT_LIMIT = 5;
export const INBOX_ROOM_LIMIT = 100;
export const INBOX_ACTIVE_LIMIT = 50;
export const INBOX_HISTORY_LIMIT = 300;
export function inboxLabel(value, max = 32) {
  if (typeof value !== "string") throw new Error("이름을 입력해 주세요.");
  const label = value.trim().normalize("NFC");
  if (!label || label.length > max || /[\p{Cc}\p{Cf}]/u.test(label)) throw new Error(`이름은 ${max}자 이내로 입력해 주세요.`);
  return label;
}

// Explicit allowlist: applicant prices, settings, URLs and arbitrary object keys
// never cross the application boundary.
export function inboxItems(source) {
  if (!Array.isArray(source) || !source.length || source.length > 100) throw new Error("장비를 1~100개 선택해 주세요.");
  let total = 0;
  return source.map((raw) => {
    if (!raw || typeof raw !== "object") throw new Error("장비 정보를 확인해 주세요.");
    const preset = EQUIPMENT_PRESETS.find((entry) => entry.id === raw.presetId);
    const level = raw.itemLevel;
    if (!SUPPORTED_STARFORCE_LEVELS.includes(level) || (preset ? level !== preset.level : raw.presetId !== `equipped-level-${level}`)) {
      throw new Error("지원하지 않는 장비입니다.");
    }
    const start = raw.startStar, target = raw.targetStar, quantity = raw.quantity ?? 1;
    const name = preset?.name ?? inboxLabel(raw.displayName, 80);
    if (!Number.isInteger(start) || !Number.isInteger(target) || start < minimumStarforceStartStar({ ...preset, name }) ||
        start >= target || target > getMaxStarforceStar(level)) throw new Error(`${name}의 시작·목표 성수를 확인해 주세요.`);
    if (!Number.isInteger(quantity) || quantity < 1 || (total += quantity) > 100) throw new Error("장비는 최대 100개까지 신청할 수 있습니다.");
    const item = { presetId: raw.presetId, itemLevel: level, startStar: start, targetStar: target, quantity };
    if (!preset) item.displayName = name;
    if (preset && starforceStatGrowthModes(preset).length) {
      item.statGrowthMode = starforceStatGrowthMode(raw, preset);
    }
    return item;
  });
}
