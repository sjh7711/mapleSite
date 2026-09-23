import { calculatorStorage, calculatorSessionStorage, registerResultShare } from "./shared/result-share-state.js";
import {
  DEFAULT_START_STAR,
  EQUIPMENT_PRESETS,
  RESTORE_STARS,
  SAFEGUARD_STARS,
  SELECTABLE_EVENTS,
  SUPPORTED_STARFORCE_LEVELS,
  appliedStrategy,
  applyMultiplier,
  foldedPresets,
  equipmentGroupMembers,
  groupPresetsByLevel,
  SAFETY_MULTIPLIERS,
  STARFORCE_EVENTS,
  STARFORCE_MVP,
  calculateAll,
  formatMeso,
  formatNumber,
  getMaxStarforceStar,
} from "./calc.js";
import { renderToolNav } from "./shared/shell.js";
import {
  calculatorPresetForEquipment,
  normalizeStarforceEquipment,
  selectDisplayedEquipmentPreset,
  STARFORCE_EQUIPMENT_BOARD_SLOTS,
  startStarForPreset,
} from "./shared/starforce-character-equipment.js";
import {
  chip,
  dropdown,
  field,
  numberInput,
  range,
} from "./shared/ui.js";
import { createDeleteTargetAnchor } from "./shared/delete-target-anchor.js";
import { applyPersonalStarforcePrices, readPersonalStarforcePrices, updateMatchingEquipmentPrices } from "./shared/starforce-equipment-prices.js";

// 기본 스페어값이 바뀌면 값을 올린다. 예전에 저장된 가격이 새 기본값을
// 덮어써 0원처럼 보이는 일을 막는다.
// 저장 형식이 바뀔 때만 올린다. 스페어값은 "직접 고친 값"만 따로 담으므로
// 기본가가 바뀌어도 이 값을 올릴 필요가 없고, 저장한 값이 지워지지 않는다.
const STORAGE_KEY = "maplestarforce:v5";
const PREVIOUS_STORAGE_KEY = "maplestarforce:v4";
// 장비 목록만 탭별로 따로 둔다. 창을 두 개 띄웠을 때 서로의 목록을 덮어쓰지
// 않게 하기 위한 것이다. 좌측 스페어값은 공통으로 두고, 담긴 장비값만 슬롯별로 둔다.
const ITEMS_KEY = "maplestarforce:items:v1";

const elements = {
  event: document.querySelector("#event"),
  mvp: document.querySelector("#mvp"),
  pc: document.querySelector("#pc"),
  picker: document.querySelector("#picker"),
  items: document.querySelector("#items"),
  bulk: document.querySelector("#bulk"),
  slots: document.querySelector("#slots"),
  resetPrices: document.querySelector("#reset-prices"),
  pricesLock: document.querySelector("#prices-lock"),
  clearItems: document.querySelector("#clear-items"),
  totalCost: document.querySelector("#total-cost"),
  totalScaled: document.querySelector("#total-scaled"),
  totalMeta: document.querySelector("#total-meta"),
  contactMail: document.querySelector("#contact-mail"),
  contactCopy: document.querySelector("#contact-copy"),
  menu: document.querySelector("#menu"),
  backdrop: document.querySelector("#drawer-backdrop"),
  pickerClose: document.querySelector("#picker-close"),
  characterForm: document.querySelector("#starforce-character"),
  characterName: document.querySelector("#character-name"),
  characterLoad: document.querySelector("#character-load"),
  characterClear: document.querySelector("#character-clear"),
  characterStatus: document.querySelector("#character-status"),
  characterEquipment: document.querySelector("#character-equipment"),
  // 좁은 화면에서 서랍이 되는 것은 장비창 카드다.
  side: document.querySelector(".card--picker"),
  totalStorage: document.querySelector("#total-storage"),
  multipliers: document.querySelector("#multipliers"),
};

// 페이지 아래에서 장비를 지워도 다음 장비의 삭제 버튼이 마우스 아래로
// 올라오게 목록 높이를 유지한다. 사용자가 페이지 최상단으로 돌아오면 해제한다.
const itemDeleteAnchor = createDeleteTargetAnchor(elements.items);

function releaseItemDeleteAnchor() {
  itemDeleteAnchor.release();
}

function releaseItemDeleteAnchorAtTop() {
  const scrollTop = document.scrollingElement?.scrollTop ?? window.scrollY;
  if (itemDeleteAnchor.active && scrollTop <= 0) {
    releaseItemDeleteAnchor();
  }
}

// 목록을 몇 벌 둘지. state 보다 먼저 선언해야 load() 안에서 쓸 수 있다.
const SLOT_COUNT = 3;
const DEFAULT_TARGET_STAR = 21;

const emptyCharacterSource = () => ({
  name: "",
  characterImage: null,
  activePresetNo: null,
  recommendedPresetNo: null,
  presets: [],
  equipment: [],
});

const blankCharacterSources = () =>
  Array.from({ length: SLOT_COUNT }, () => emptyCharacterSource());

function safeStoredImage(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function safeStoredEquipment(value) {
  return normalizeStarforceEquipment(value).map((item) => ({
    ...item,
    icon: safeStoredImage(item.icon),
  }));
}

function characterSourceFrom(name, source) {
  const presets = Array.isArray(source?.presets)
    ? source.presets.flatMap((preset) => {
        const presetNo = Number(preset?.presetNo ?? preset?.preset_no);
        if (!Number.isInteger(presetNo) || presetNo < 1 || presetNo > 3) return [];
        return [{
          presetNo,
          equipment: safeStoredEquipment(preset?.equipment),
        }];
      })
    : [];
  const normalizedPresetNo = (value) => {
    const number = Number(value);
    return Number.isInteger(number) && number >= 1 && number <= 3
      ? number
      : null;
  };
  return {
    name: typeof name === "string" ? name.trim().normalize("NFC") : "",
    characterImage: safeStoredImage(source?.characterImage),
    activePresetNo: normalizedPresetNo(source?.activePresetNo),
    recommendedPresetNo: normalizedPresetNo(source?.recommendedPresetNo),
    presets,
    equipment: safeStoredEquipment(source?.equipment),
  };
}

function characterSourcesFrom(saved) {
  const sources = blankCharacterSources();
  if (!Array.isArray(saved?.characterSources)) return sources;
  saved.characterSources.slice(0, SLOT_COUNT).forEach((source, index) => {
    if (!source || typeof source !== "object") return;
    sources[index] = characterSourceFrom(source.name, source);
  });
  return sources;
}

const defaultPrices = Object.fromEntries(
  EQUIPMENT_PRESETS.map((preset) => [preset.id, preset.price]),
);
const groupForPreset = Object.fromEntries(
  EQUIPMENT_PRESETS.filter((preset) => preset.groupId).map((preset) => [preset.id, preset.groupId]),
);

const state = {
  event: "shining",
  mvp: "diamond",
  pc: false,
  multiplier: 1,
  customMultipliers: [],
  priceOverrides: {},
  // 값을 다 맞춰 두면 목록 전체를 잠가 실수로 건드리지 않게 한다.
  pricesLocked: false,
  // 다시 그려도 그 외 레벨 서랍이 접히지 않도록 상태를 들고 있는다.
  foldedOpen: false,
  // 장비를 담을 때 쓰는 기본 구간이자, 목록 전체를 한 번에 맞추는 값.
  bulk: { startStar: DEFAULT_START_STAR, targetStar: DEFAULT_TARGET_STAR },
  slots: Array.from({ length: SLOT_COUNT }, () => []),
  characterSources: blankCharacterSources(),
  slot: 0,
  ...load(),
};
// 예전 설정과 공유 링크의 휠 허용 값은 더 이상 사용하거나 저장하지 않는다.
delete state.wheelEnabled;
delete state.wheelDefaultRevision;

// 코드 곳곳이 state.items 를 쓰고 있어 그 이름을 그대로 두고,
// 지금 고른 자리를 가리키도록 연결한다.
Object.defineProperty(state, "items", {
  enumerable: true,
  get: () => state.slots[state.slot],
  set: (value) => {
    state.slots[state.slot] = value;
  },
});
state.bulk = {
  startStar: DEFAULT_START_STAR,
  targetStar: DEFAULT_TARGET_STAR,
  ...state.bulk,
};
// 직전 버전의 목표 미선택값(X)은 21성으로 한 번만 자연스럽게 이관한다.
if (
  !Number.isInteger(state.bulk.targetStar) ||
  state.bulk.targetStar < 1 ||
  state.bulk.targetStar > 30
) {
  state.bulk.targetStar = DEFAULT_TARGET_STAR;
}
// 직전 프리뷰/운영 버전의 슬롯별 좌측값은 마지막으로 열어 둔 슬롯의 값을
// 공통 좌측값으로 이관한다. 이후 1·2·3을 오가도 이 값은 바뀌지 않는다.
const migratedSlotPrices = Array.isArray(state.priceOverridesBySlot)
  ? state.priceOverridesBySlot[state.slot]
  : null;
state.priceOverrides = {
  ...(state.priceOverrides && typeof state.priceOverrides === "object"
    ? state.priceOverrides
    : {}),
  ...(migratedSlotPrices && typeof migratedSlotPrices === "object"
    ? migratedSlotPrices
    : {}),
};
delete state.priceOverridesBySlot;

// NPC 고정가 장비. 사용자가 값을 고칠 수 없으므로 저장한 값도 무시한다.
const fixedPrices = Object.fromEntries(
  EQUIPMENT_PRESETS.filter((preset) => preset.npcSpare).map((preset) => [
    preset.id,
    preset.price,
  ]),
);

function selectedCharacterPreset(source) {
  const selected = selectDisplayedEquipmentPreset(source);
  if (selected) return selected;
  const hasPresetEquipment = source?.presets?.some(
    (preset) => Array.isArray(preset?.equipment) && preset.equipment.length,
  );
  // 일부 구형 Open API 응답은 현재 장비만 주고 프리셋 번호를 생략한다.
  // 이때만 평탄 목록을 하나의 현재 장비 프리셋처럼 안전하게 표시한다.
  return !hasPresetEquipment && source?.equipment?.length
    ? {
        presetNo: null,
        equipment: source.equipment,
        selectionReason: "current",
      }
    : null;
}

function selectedCharacterEquipment(source) {
  const selected = selectedCharacterPreset(source);
  return selected?.equipment ?? [];
}

function buildCharacterMatches(source) {
  const equipment = selectedCharacterEquipment(source);
  return new Map(
    EQUIPMENT_PRESETS.map((preset) => [
      preset.id,
      startStarForPreset(preset, equipment, state.bulk.startStar),
    ]),
  );
}

// 강화 목록 1·2·3은 서로 다른 캐릭터를 조회할 수 있다. 조회된 공개 장비 정보는
// 해당 슬롯의 sessionStorage에만 두고, 각 슬롯의 장비 테두리와 시작 성에 사용한다.
const characterEquipmentMatchesBySlot = state.characterSources.map((source) =>
  buildCharacterMatches(source),
);
const characterLookupStates = Array.from({ length: SLOT_COUNT }, (_, index) => ({
  draft: state.characterSources[index]?.name ?? "",
  loading: false,
  error: "",
  requestId: 0,
}));

function currentCharacterMatches() {
  const sourceName = state.characterSources[state.slot]?.name ?? "";
  const draftName = characterLookupStates[state.slot]?.draft
    ?.trim()
    .normalize("NFC");
  if (!sourceName || draftName !== sourceName) return new Map();
  return characterEquipmentMatchesBySlot[state.slot] ?? new Map();
}

function currentCharacterSource() {
  const source = state.characterSources[state.slot];
  const draftName = characterLookupStates[state.slot]?.draft
    ?.trim()
    .normalize("NFC");
  return source?.name && source.name === draftName ? source : null;
}

function currentCharacterName() {
  return state.characterSources[state.slot]?.name ?? "";
}

function defaultStartStarForPreset(preset) {
  const matched = currentCharacterMatches().get(preset.id);
  if (!matched || matched.status !== "matched") return state.bulk.startStar;
  const maxStar = getMaxStarforceStar(preset.level);
  return Math.min(maxStar - 1, Math.max(0, matched.starforce));
}

/** 스페어값 눈금. 값이 커질수록 성큼성큼 움직인다. */
function spareStep(value) {
  // 0.3을 0.01 눈금에 넣으면 0.30 → 0.31 → 0.35처럼 어중간한 값을 거친다.
  // 0.3부터는 0.05 눈금을 타게 해서 오르내림이 매끄럽게 이어지도록 한다.
  if (value < 0.3) return 0.01;
  if (value < 1) return 0.05;
  if (value < 50) return 0.5;
  return 1;
}

/** 담아 둔 장비는 공유 가격의 사본을 들고 다닌다. 예전 저장분도 그대로 읽는다. */
function priceOfItem(item) {
  return item.replacementEok ?? priceOf(item.presetId);
}

/** 직접 고친 값이 있으면 그것을, 없으면 기본가를 쓴다. */
function priceOf(presetId) {
  const groupId = groupForPreset[presetId];
  return (
    fixedPrices[presetId] ??
    state.priceOverrides[presetId] ??
    (groupId ? state.priceOverrides[groupId] : undefined) ??
    defaultPrices[presetId] ??
    0
  );
}

function setPrice(presetId, value) {
  const groupId = groupForPreset[presetId];
  const inheritedPrice = (groupId ? state.priceOverrides[groupId] : undefined) ?? defaultPrices[presetId];
  if (value === inheritedPrice) delete state.priceOverrides[presetId];
  else state.priceOverrides[presetId] = value;
}

/** 지정한 영역의 동일 장비 가격을 맞추되 입력 중 포커스는 유지한다. */
function syncPriceInputs(presetId, value, sourceInput, scope = document) {
  for (const input of scope.querySelectorAll("input[data-price-preset-id]")) {
    if (input === sourceInput || input.dataset.pricePresetId !== presetId) continue;
    input.value = String(value);
  }
}

/** 잠금 중에는 현재 강화목록만 수정하고 좌측에 저장한 가격은 보존한다. */
function setSharedPrice(presetId, value, sourceInput) {
  const nextValue = Math.max(0, Number(value) || 0);
  updateMatchingEquipmentPrices(state.items, presetId, nextValue);
  if (state.pricesLocked) {
    syncPriceInputs(presetId, nextValue, sourceInput, elements.items);
    return;
  }
  // 예전 묶음 장비를 수정해도 새 부위별 가격은 함께 변하지 않게 한다.
  for (const part of equipmentGroupMembers(presetId)) {
    if (!Object.hasOwn(state.priceOverrides, part.id)) {
      state.priceOverrides[part.id] = priceOf(part.id);
    }
  }
  setPrice(presetId, nextValue);
  syncPriceInputs(presetId, nextValue, sourceInput);
}

/**
 * 이 탭만의 장비 목록. 목록을 세 벌 두고 버튼으로 갈아 끼운다.
 * 예전 저장분(목록 하나짜리)은 1번 자리로 옮겨 담는다.
 */
function loadSlots(shared) {
  const blank = () => Array.from({ length: SLOT_COUNT }, () => []);
  try {
    const own = JSON.parse(calculatorSessionStorage.getItem(ITEMS_KEY) ?? "null");
    if (Array.isArray(own?.slots)) {
      const slots = blank();
      own.slots.slice(0, SLOT_COUNT).forEach((list, index) => {
        if (Array.isArray(list)) slots[index] = list;
      });
      return {
        slots,
        characterSources: characterSourcesFrom(own),
        slot: Math.min(SLOT_COUNT - 1, Math.max(0, own.slot ?? 0)),
      };
    }
    if (Array.isArray(own)) {
      const slots = blank();
      slots[0] = own;
      return { slots, characterSources: blankCharacterSources(), slot: 0 };
    }
  } catch {
    // 못 읽으면 물려받기로 넘어간다.
  }
  const slots = blank();
  if (Array.isArray(shared?.items)) slots[0] = shared.items;
  return { slots, characterSources: blankCharacterSources(), slot: 0 };
}

function load() {
  try {
    const saved = JSON.parse(calculatorStorage.getItem(STORAGE_KEY) ?? "null");
    if (saved) return { ...saved, ...loadSlots(saved) };

    // 이전 저장 형식도 목록과 설정을 그대로 물려받는다. 목표 X(0)는 state를
    // 만든 직후 현재 기본값인 21성으로 정규화한다.
    const previous = JSON.parse(
      calculatorStorage.getItem(PREVIOUS_STORAGE_KEY) ?? "null",
    );
    if (previous) {
      return {
        ...previous,
        ...loadSlots(previous),
        bulk: {
          startStar: previous.bulk?.startStar ?? DEFAULT_START_STAR,
          targetStar:
            previous.bulk?.targetStar === 0
              ? DEFAULT_TARGET_STAR
              : (previous.bulk?.targetStar ?? DEFAULT_TARGET_STAR),
        },
      };
    }

    // v3까지는 전체 가격표를 저장했다. 기본가와 다른 값만 공유 가격 형식으로
    // 넘겨받은 뒤 초기화 과정에서 세 강화목록별 가격으로 이관한다.
    const legacy = JSON.parse(calculatorStorage.getItem("maplestarforce:v3") ?? "null");
    if (!legacy?.prices) return loadSlots(null);
    return {
      ...legacy,
      ...loadSlots(legacy),
      prices: undefined,
      priceOverrides: Object.fromEntries(
        Object.entries(legacy.prices).filter(
          ([id, price]) => defaultPrices[id] !== undefined && price !== defaultPrices[id],
        ),
      ),
    };
  } catch {
    return loadSlots(null);
  }
}

function save() {
  try {
    // 목록은 빼고 저장해야 다른 탭이 자기 목록을 그대로 지킬 수 있다.
    calculatorStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...state,
        items: undefined,
        slots: undefined,
        characterSources: undefined,
        slot: undefined,
      }),
    );
    calculatorSessionStorage.setItem(
      ITEMS_KEY,
      JSON.stringify({
        slots: state.slots,
        characterSources: state.characterSources,
        slot: state.slot,
      }),
    );
  } catch {
    // 저장이 막혀 있어도 계산은 되어야 한다.
  }
}

const EQUIPPED_FALLBACK_PRICE_BY_LEVEL = new Map([
  [135, 3],
  [140, 0.1],
  [145, 4.5],
  [150, 0.1],
  [160, 0.1],
  [200, 0.1],
  [250, 0.15],
]);

function fallbackPresetForEquipment(equipment) {
  if (
    !equipment ||
    !SUPPORTED_STARFORCE_LEVELS.includes(equipment.level) ||
    /^(?:제네시스|데스티니)/u.test(equipment.name)
  ) {
    return null;
  }
  return {
    id: `equipped-level-${equipment.level}`,
    name: equipment.name,
    level: equipment.level,
    price: EQUIPPED_FALLBACK_PRICE_BY_LEVEL.get(equipment.level) ?? 0.1,
    icon: equipment.icon,
    equippedOnly: true,
  };
}

function presetForStoredItem(item) {
  return (
    EQUIPMENT_PRESETS.find((preset) => preset.id === item.presetId) ?? {
      id: item.presetId,
      name: item.displayName || `${item.itemLevel}제 장비`,
      level: item.itemLevel,
      price: item.replacementEok ?? 0,
      icon: item.displayIcon ?? null,
      equippedOnly: true,
    }
  );
}

function addItem(presetId, equipped = null, presetOverride = null, keepBoard = false) {
  const preset =
    presetOverride ??
    EQUIPMENT_PRESETS.find((candidate) => candidate.id === presetId) ??
    fallbackPresetForEquipment(equipped);
  if (!preset) return false;
  const itemLevel = Number.isInteger(equipped?.level)
    ? equipped.level
    : preset.level;
  const maxStar = getMaxStarforceStar(itemLevel);
  const equippedStar = Number(equipped?.starforce);
  const startStar = Number.isInteger(equippedStar)
    ? Math.max(0, equippedStar)
    : defaultStartStarForPreset(preset);
  // 이미 해당 레벨의 최대 성급인 장비에는 다음 목표가 없다.
  if (startStar >= maxStar) return false;
  const targetStar = Math.min(
    maxStar,
    Math.max(startStar + 1, state.bulk.targetStar),
  );
  state.items.push({
    presetId: preset.id,
    itemLevel,
    startStar,
    targetStar,
    displayName:
      preset.equippedOnly &&
      typeof equipped?.name === "string" &&
      equipped.name.trim()
        ? equipped.name.trim()
        : undefined,
    displayIcon:
      typeof equipped?.icon === "string" && equipped.icon.startsWith("https://")
        ? equipped.icon
        : undefined,
    quantity: 1,
    spare: 0,
    // 담는 순간의 공유값을 새긴다. 이후 좌·우 어느 가격 칸을 고쳐도 함께 바뀐다.
    replacementEok: preset.equippedOnly ? preset.price : priceOf(preset.id),
    optimize: true,
    destroyPrevention: [],
    restore: [],
  });
  renderItems(!keepBoard);
  update();
  return true;
}

/** 계산기에 넘길 형태. 스페어값은 장비별 설정값을 그때그때 붙인다. */
function toCalcItems() {
  return state.items.map((item) => ({
    ...item,
    replacementEok: priceOfItem(item),
  }));
}

function iconOf(preset) {
  if (!preset.icon) {
    const fallback = document.createElement("span");
    fallback.className = "picker__fallback";
    fallback.textContent = "장비";
    return fallback;
  }
  const image = document.createElement("img");
  image.src = preset.icon;
  image.alt = "";
  image.loading = "lazy";
  return image;
}


// 좁은 화면에서는 장비 목록을 서랍으로 접고, 굴려서 바꾸는 조작 대신 드롭다운을 쓴다.
const MOBILE = window.matchMedia("(max-width: 760px)");
const isMobile = () => MOBILE.matches;

function setDrawer(open) {
  document.body.dataset.drawer = open ? "open" : "closed";
  elements.menu.setAttribute("aria-expanded", String(open));
  elements.menu.setAttribute("aria-label", open ? "장비 목록 닫기" : "장비 목록 열기");
}

// 서랍을 미는 손짓으로 인정할 조건.
// 각도는 수평에서 몇 도까지 벌어져도 가로로 볼지를 뜻한다. 45도면 대각선까지
// 잡아채고, 작을수록 곧게 옆으로 밀어야 반응한다.
const DRAWER_DRAG_ANGLE = 20;
const DRAWER_DRAG_SLOPE = Math.tan((DRAWER_DRAG_ANGLE * Math.PI) / 180);
// 방향을 판정하기 전에 지켜보는 거리.
const DRAWER_DRAG_START = 8;

/**
 * 서랍을 오른쪽으로 밀어 닫는다. 세로로 먼저 움직이거나 각도가 벗어나면
 * 목록 스크롤에 양보하고, 가로로 움직인 뒤에는 그 손짓이 버튼 누름으로
 * 이어지지 않게 막는다.
 */
function enableDrawerDrag() {
  const side = elements.side;
  let startX = 0;
  let startY = 0;
  let shift = 0;
  let axis = null;
  let tracking = false;
  let suppressClick = false;

  const finish = () => {
    if (!tracking) return;
    tracking = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    delete side.dataset.dragging;
    side.style.transform = "";
    if (axis !== "x") return;
    if (shift > Math.min(90, side.offsetWidth * 0.3)) setDrawer(false);
    if (shift > 6) {
      suppressClick = true;
      setTimeout(() => {
        suppressClick = false;
      }, 0);
    }
  };

  function onMove(event) {
    if (!tracking) return;
    const moveX = event.clientX - startX;
    const moveY = event.clientY - startY;
    if (!axis) {
      if (Math.abs(moveX) < DRAWER_DRAG_START && Math.abs(moveY) < DRAWER_DRAG_START) {
        return;
      }
      // 오른쪽으로, 그리고 정해진 각도 안쪽으로 움직였을 때만 서랍이 따라온다.
      const withinAngle =
        moveX > 0 && Math.abs(moveY) <= Math.abs(moveX) * DRAWER_DRAG_SLOPE;
      axis = withinAngle ? "x" : "y";
      if (axis === "y") {
        finish();
        return;
      }
      side.dataset.dragging = "true";
    }
    shift = Math.max(0, moveX);
    side.style.transform = `translateX(${shift}px)`;
    event.preventDefault();
  }

  side.addEventListener("pointerdown", (event) => {
    if (!isMobile() || document.body.dataset.drawer !== "open") return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    startX = event.clientX;
    startY = event.clientY;
    shift = 0;
    axis = null;
    tracking = true;
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  });

  side.addEventListener(
    "click",
    (event) => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
}









function toggleStar(list, star) {
  const index = list.indexOf(star);
  if (index >= 0) list.splice(index, 1);
  else list.push(star);
}

const starLabel = (star) => `${star}성`;
// 성급 목록은 여섯 칸씩 끊는다. 시작은 0~29라 다섯 줄, 목표는 13~30이라 세 줄로
// 딱 떨어져서 줄이 어중간하게 남지 않는다.
const STAR_COLUMNS = 6;
// 목표 목록을 열면 가장 많이 비교하는 12~23성이 첫 두 줄에 보인다.
// 시작 드롭다운의 열림 위치와 선택 가능한 전체 범위는 그대로 둔다.
const TARGET_DROPDOWN_ANCHOR_STAR = 12;
// 스페어는 뜻을 아는 사람만 쓰는 값이라 화면에서 감춰 뒀다. 계산은 그대로 살아
// 있으니 이 값만 true로 돌리면 입력칸과 안내가 다시 나온다.
const SHOW_SPARE = false;
// 개수도 같은 이유로 감춰 뒀다. 값은 1로 계산된다.
const SHOW_QUANTITY = false;

/** 앞으로 담을 장비에 쓸 기본 구간. 이미 담긴 장비는 건드리지 않는다. */
function renderBulk() {
  const setDefault = (key) => (value) => {
    state.bulk[key] = value;
    // 한쪽이 다른 쪽에 닿으면 반대쪽을 한 칸 밀어 준다.
    let pushed = false;
    if (
      key === "startStar" &&
      state.bulk.targetStar <= value
    ) {
      state.bulk.targetStar = Math.min(30, value + 1);
      pushed = true;
    }
    if (
      key === "targetStar" &&
      state.bulk.startStar >= value
    ) {
      state.bulk.startStar = Math.max(0, value - 1);
      pushed = true;
    }
    save();
    if (pushed) renderBulk();
  };

  const caption = document.createElement("span");
  caption.className = "bulk__label";
  caption.textContent = "기본값";

  elements.bulk.replaceChildren(
    caption,
    field(
      "시작",
      dropdown({
        options: range(0, 29),
        value: state.bulk.startStar,
        anchorValue: DEFAULT_START_STAR,
        format: starLabel,
        columns: STAR_COLUMNS,
        onChange: setDefault("startStar"),
      }),
      "field--inline",
    ),
    field(
      "목표",
      dropdown({
        options: range(1, 30),
        value: state.bulk.targetStar,
        anchorValue: TARGET_DROPDOWN_ANCHOR_STAR,
        format: starLabel,
        columns: STAR_COLUMNS,
        dimUpTo: () => state.bulk.startStar,
        onChange: setDefault("targetStar"),
      }),
      "field--inline",
    ),
  );
}

function setCharacterStatus(message = "", stateName = "") {
  elements.characterStatus.textContent = message;
  elements.characterForm.dataset.state = stateName;
  elements.characterStatus.title = message;
}

function renderCharacterLookup() {
  const lookup = characterLookupStates[state.slot];
  const hasCharacter = Boolean(state.characterSources[state.slot]?.name);
  elements.characterName.value = lookup.draft;
  elements.characterLoad.disabled = lookup.loading;
  elements.characterClear.disabled = lookup.loading || !hasCharacter;
  elements.characterClear.dataset.visible = String(hasCharacter);
  elements.characterClear.setAttribute("aria-hidden", String(!hasCharacter));
  elements.characterClear.tabIndex = hasCharacter ? 0 : -1;
  if (lookup.loading) {
    setCharacterStatus("", "loading");
  } else if (lookup.error) {
    setCharacterStatus(lookup.error, "error");
  } else {
    // 조회 성공은 문장으로 반복하지 않는다. 조사된 장비 버튼의 테두리가 결과다.
    setCharacterStatus("", currentCharacterName() ? "success" : "");
  }
}

function clearCharacterEquipment(slot = state.slot) {
  state.characterSources[slot] = emptyCharacterSource();
  characterEquipmentMatchesBySlot[slot] = new Map();
  characterLookupStates[slot].draft = "";
  characterLookupStates[slot].loading = false;
  characterLookupStates[slot].error = "";
  characterLookupStates[slot].requestId += 1;
}

function applyCharacterEquipment(slot, characterName, payload) {
  const source = characterSourceFrom(characterName, payload);
  state.characterSources[slot] = source;
  characterEquipmentMatchesBySlot[slot] = buildCharacterMatches(source);
  characterLookupStates[slot].draft = characterName;
  characterLookupStates[slot].error = "";
  save();
}

async function loadCharacterEquipment() {
  const slot = state.slot;
  const lookup = characterLookupStates[slot];
  const characterName = elements.characterName.value.trim().normalize("NFC");
  if (!characterName) {
    lookup.error = "닉네임을 입력해 주세요.";
    renderCharacterLookup();
    elements.characterName.focus();
    return;
  }

  lookup.draft = characterName;
  lookup.loading = true;
  lookup.error = "";
  const requestId = ++lookup.requestId;
  save();
  renderCharacterLookup();
  renderPicker();
  renderCharacterEquipment();

  try {
    const params = new URLSearchParams({ characterName });
    const response = await fetch(`/api/character-equipment?${params}`, {
      headers: { Accept: "application/json" },
      // 프리셋 3종 응답 계약이 갱신돼도 브라우저의 이전 공개 응답을 재사용하지
      // 않는다. 서버 쪽 10분 캐시는 그대로 사용한다.
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (
      !response.ok ||
      !payload?.ok ||
      !Array.isArray(payload.equipment) ||
      !Array.isArray(payload.presets)
    ) {
      throw new Error(
        payload?.error?.message ?? "장착 장비를 불러오지 못했습니다.",
      );
    }

    if (lookup.requestId !== requestId) return;

    applyCharacterEquipment(
      slot,
      payload.characterName ?? characterName,
      payload,
    );
  } catch (error) {
    if (lookup.requestId === requestId) {
      lookup.error =
        error instanceof Error
          ? error.message
          : "장착 장비를 불러오지 못했습니다.";
      save();
    }
  } finally {
    if (lookup.requestId === requestId) {
      lookup.loading = false;
      if (state.slot === slot) {
        renderPicker();
        renderCharacterLookup();
        renderCharacterEquipment();
      }
    }
  }
}

let equipmentGroupDialog = null;

function openEquipmentGroup(groupId, opener) {
  equipmentGroupDialog?.close();
  const group = EQUIPMENT_PRESETS.find((preset) => preset.id === groupId);
  const parts = equipmentGroupMembers(groupId);
  if (!group || !parts.length) return;

  const dialog = document.createElement("dialog");
  dialog.className = "equipment-group-dialog";
  dialog.setAttribute("aria-labelledby", "equipment-group-title");
  const header = document.createElement("div");
  header.className = "equipment-group-dialog__header";
  const title = document.createElement("h2");
  title.id = "equipment-group-title";
  title.textContent = group.name;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "equipment-group-dialog__close";
  close.textContent = "×";
  close.setAttribute("aria-label", "장비 선택 닫기");
  close.autofocus = true;
  close.addEventListener("click", () => dialog.close());
  header.append(title, close);
  const list = document.createElement("div");
  list.className = "equipment-group-dialog__list";
  list.append(...parts.map((part) => pickerRow(part, { inOverlay: true })));
  dialog.append(header, list);
  document.body.append(dialog);
  equipmentGroupDialog = dialog;
  opener.setAttribute("aria-expanded", "true");
  const position = () => {
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    dialog.style.maxHeight = `${Math.max(120, height - 24)}px`;
    dialog.style.maxWidth = `${Math.max(0, width - 24)}px`;
    const anchor = opener.getBoundingClientRect();
    const bounds = dialog.getBoundingClientRect();
    const preferredTop = anchor.bottom + 8 + bounds.height <= top + height - 12
      ? anchor.bottom + 8 : anchor.top - bounds.height - 8;
    dialog.style.left = `${Math.max(left + 12, Math.min(anchor.right - bounds.width, left + width - bounds.width - 12))}px`;
    dialog.style.top = `${Math.max(top + 12, Math.min(preferredTop, top + height - bounds.height - 12))}px`;
  };
  const outside = (event) => {
    const bounds = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
  };
  let pressedOutside = false;
  dialog.addEventListener("pointerdown", (event) => { pressedOutside = outside(event); });
  dialog.addEventListener("click", (event) => {
    if (pressedOutside && outside(event)) dialog.close();
    pressedOutside = false;
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") event.stopPropagation();
  });
  dialog.addEventListener("close", () => {
    window.removeEventListener("resize", position);
    window.removeEventListener("scroll", position, true);
    window.visualViewport?.removeEventListener("resize", position);
    window.visualViewport?.removeEventListener("scroll", position);
    if (equipmentGroupDialog === dialog) equipmentGroupDialog = null;
    opener.setAttribute("aria-expanded", "false");
    dialog.remove();
    if (!equipmentGroupDialog && opener.isConnected) opener.focus({ preventScroll: true });
  }, { once: true });
  dialog.showModal();
  position();
  window.addEventListener("resize", position);
  window.addEventListener("scroll", position, true);
  window.visualViewport?.addEventListener("resize", position);
  window.visualViewport?.addEventListener("scroll", position);
}

function pickerRow(preset, { inOverlay = false } = {}) {
  const row = document.createElement("div");
  row.className = "picker__row";
  const isGroup = !inOverlay && equipmentGroupMembers(preset.id).length > 0;

  const pick = document.createElement("button");
  pick.type = "button";
  pick.className = "picker__pick";
  const equipped = currentCharacterMatches().get(preset.id);
  const investigated = (equipped?.candidates?.length ?? 0) > 0;
  if (equipped?.status === "matched") {
    pick.title = `${preset.name} 추가 · ${currentCharacterName()} 장착 기준 ${equipped.starforce}성`;
    pick.dataset.equippedStar = String(equipped.starforce);
  } else if (investigated) {
    pick.title = `${preset.name} 추가 · 프리셋별 성급이 달라 기본 시작 성을 사용합니다.`;
  } else {
    pick.title = `${preset.name} 추가`;
  }
  if (investigated) pick.dataset.characterMatch = "true";
  const name = document.createElement("span");
  name.className = "picker__name";
  name.textContent = preset.name;
  // 눌러서 담는 자리라는 걸 아이콘 앞의 + 배지로 알린다.
  const plus = document.createElement("span");
  plus.className = "picker__plus";
  plus.setAttribute("aria-hidden", "true");
  pick.append(plus, iconOf(preset), name);
  let pickControl = pick;
  if (isGroup) {
    // 두 버튼은 같은 장비 영역 안에 배치하되 HTML 버튼을 중첩하지 않는다.
    pickControl = document.createElement("span");
    pickControl.className = "picker__part-control";
    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "picker__group-menu";
    menu.dataset.equipmentGroup = preset.id;
    menu.setAttribute("aria-label", `${preset.name} 부위 선택 및 가격 설정`);
    menu.setAttribute("aria-haspopup", "dialog");
    menu.setAttribute("aria-expanded", "false");
    menu.innerHTML = '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
    menu.addEventListener("click", () => openEquipmentGroup(preset.id, menu));
    pickControl.append(pick, menu);
  }
  pick.addEventListener("click", () => {
    if (addItem(preset.id) && inOverlay) equipmentGroupDialog?.close();
  });

  // 상점 고정가이거나 목록을 잠가 둔 경우에는 같은 모양을 두되 고쳐지지만 않게 한다.
  const locked = preset.npcSpare || state.pricesLocked;
  const input = numberInput(
    priceOf(preset.id),
    (value) => {
      setSharedPrice(preset.id, value, input);
      update();
    },
    locked
      ? {
          readOnly: true,
          className: "input--locked",
          title: preset.npcSpare
            ? "상점에서 정해진 값이라 바꿀 수 없습니다."
            : "목록이 잠겨 있습니다. 스페어값 잠금 버튼으로 풀 수 있습니다.",
        }
      : { stepFor: spareStep },
  );
  input.dataset.pricePresetId = preset.id;
  input.setAttribute("aria-label", `${preset.name} 스페어값 (억 메소)`);
  const unit = document.createElement("span");
  unit.className = "picker__unit";
  unit.textContent = "억";

  // 장비 박스와 같은 껍데기를 씌워 ↕ 표시 규칙을 그대로 물려받는다.
  const inputBox = document.createElement("span");
  inputBox.className = "spare-input spare-input--fill";
  inputBox.append(input, unit);

  row.append(pickControl, inputBox);
  return row;
}

/** 목록을 세 벌 두고 갈아 끼우는 슬롯. 지운 것이 아니라 옆에 치워 두는 것이다. */
function renderSlots() {
  elements.clearItems.title = `${state.slot + 1}번 슬롯에 추가한 장비를 모두 제거합니다.`;
  elements.slots.replaceChildren(
    ...state.slots.map((list, index) => {
      const button = chip(String(index + 1), state.slot === index, () => {
        state.slot = index;
        renderPicker();
        renderCharacterLookup();
        renderItems();
        update();
      });
      button.title = list.length
        ? `${index + 1}번 슬롯 · 장비 ${list.length}개`
        : `${index + 1}번 슬롯 · 비어 있음`;
      if (list.length) button.dataset.filled = "true";
      return button;
    }),
  );
}

/* 장비창에 레벨을 늘어놓는 순서. 그룹마다 한 줄을 통째로 쓰고 안쪽 장비를
   두 열로 깐다. 여기 없는 레벨은 뒤에 높은 순으로 붙는다. */
const PICKER_ORDER = [200, 160, 140, 250];

function orderPickerGroups(groups) {
  const rank = (level) => {
    const index = PICKER_ORDER.indexOf(level);
    return index >= 0 ? index : PICKER_ORDER.length + (999 - level) / 1000;
  };
  return [...groups].sort((left, right) => rank(left.level) - rank(right.level));
}

function pickerGroup(group) {
  const box = document.createElement("div");
  box.className = "picker__group";

  const heading = document.createElement("p");
  heading.className = "picker__level";
  const levelName = document.createElement("span");
  levelName.textContent = `${group.level}제`;
  heading.append(levelName);

  const body = document.createElement("div");
  body.className = "picker__group-body";
  body.append(...group.presets.map(pickerRow));

  box.append(heading, body);
  return box;
}

function renderPicker() {
  equipmentGroupDialog?.close();
  const folded = document.createElement("details");
  folded.className = "picker__folded";
  folded.open = state.foldedOpen === true;
  folded.addEventListener("toggle", () => {
    state.foldedOpen = folded.open;
    save();
  });
  const summary = document.createElement("summary");
  summary.textContent = "기타";
  const foldedBody = document.createElement("div");
  foldedBody.className = "picker__folded-body";
  foldedBody.append(...foldedPresets().map(pickerRow));
  folded.append(summary, foldedBody);

  elements.picker.replaceChildren(
    ...orderPickerGroups(groupPresetsByLevel()).map(pickerGroup),
    folded,
  );
}

// 인게임 장비창처럼 캐릭터를 가운데 두고, 스타포스 대상 슬롯을 둘레에 배치한다.
const CHARACTER_EQUIPMENT_SLOTS = STARFORCE_EQUIPMENT_BOARD_SLOTS;
const CHARACTER_EQUIPMENT_SLOT_NAMES = new Set(
  CHARACTER_EQUIPMENT_SLOTS.map(([slot]) => slot),
);

const normalizeEquipmentSlot = (value) =>
  typeof value === "string"
    ? value.normalize("NFC").replace(/\s+/gu, "")
    : "";

function equipmentByBoardSlot(equipment) {
  const assigned = new Map();
  const availableRings = ["반지1", "반지2", "반지3", "반지4"];
  const availablePendants = ["펜던트", "펜던트2"];
  for (const item of equipment) {
    let key = normalizeEquipmentSlot(item?.slot);
    if (key === "한벌옷") key = "상의";
    // 일부 응답의 slot은 단순히 '방어구'로 오기도 한다. 실제 보드 부위가
    // 아니면 유효한 part를 한 번 더 확인해 장비가 사라지지 않게 한다.
    if (!CHARACTER_EQUIPMENT_SLOT_NAMES.has(key)) {
      key = normalizeEquipmentSlot(item?.part);
    }
    if (key === "한벌옷") key = "상의";
    if (key === "반지") key = availableRings.find((slot) => !assigned.has(slot));
    if (key === "펜던트") {
      key = availablePendants.find((slot) => !assigned.has(slot));
    }
    if (key && !assigned.has(key)) assigned.set(key, item);
  }
  return assigned;
}

function characterEquipmentSlot(item, row, column) {
  const preset = item
    ? calculatorPresetForEquipment(item, EQUIPMENT_PRESETS) ??
      fallbackPresetForEquipment(item)
    : null;
  let maxStar = null;
  try {
    maxStar = item ? getMaxStarforceStar(item.level) : null;
  } catch {
    maxStar = null;
  }
  const canAdd =
    Boolean(item && preset) &&
    Number.isInteger(item.starforce) &&
    Number.isInteger(maxStar) &&
    item.starforce < maxStar;
  const slot = document.createElement(canAdd ? "button" : "div");
  slot.className = "character-equipment__slot";
  slot.style.setProperty("--equipment-row", String(row));
  slot.style.setProperty("--equipment-column", String(column));

  if (!item) {
    slot.dataset.empty = "true";
    slot.setAttribute("aria-hidden", "true");
    return slot;
  }

  const image = item.icon
    ? iconOf({ icon: item.icon })
    : iconOf({ icon: null });
  const star = document.createElement("span");
  star.className = "character-equipment__star";
  star.textContent = `${item.starforce}성`;
  slot.append(image, star);
  slot.title = canAdd
    ? `${item.name} · ${item.starforce}성부터 강화 목록에 추가`
    : preset
      ? `${item.name} · 현재 성급에서 더 강화할 수 없는 장비`
      : `${item.name} · 현재 장비 목록과 연결되지 않는 장비`;

  if (canAdd) {
    slot.type = "button";
    slot.setAttribute("aria-label", slot.title);
    // 장비판 자체를 다시 만들지 않아 같은 장비를 연속으로 추가할 때도
    // 키보드 포커스가 사라지지 않는다.
    slot.addEventListener("click", () => addItem(preset.id, item, preset, true));
  } else {
    slot.dataset.disabled = "true";
    slot.setAttribute("role", "img");
    slot.setAttribute("aria-label", slot.title);
  }
  return slot;
}

function renderCharacterEquipment() {
  const source = currentCharacterSource();
  const selected = source && selectedCharacterPreset(source);
  if (!source || !selected?.equipment?.length) {
    elements.characterEquipment.hidden = true;
    elements.characterEquipment.replaceChildren();
    return;
  }

  const caption = document.createElement("div");
  caption.className = "character-equipment__caption";
  const characterName = document.createElement("strong");
  characterName.textContent = source.name;
  const presetName = document.createElement("span");
  presetName.textContent = selected.presetNo
    ? `장비 프리셋 ${selected.presetNo}`
    : "현재 장비";
  caption.append(characterName, presetName);

  const grid = document.createElement("div");
  grid.className = "character-equipment__grid";
  const character = document.createElement("div");
  character.className = "character-equipment__character";
  if (source.characterImage) {
    const image = document.createElement("img");
    image.src = source.characterImage;
    image.alt = `${source.name} 캐릭터`;
    character.append(image);
  } else {
    const fallback = document.createElement("span");
    fallback.textContent = source.name.slice(0, 1);
    character.append(fallback);
  }

  const bySlot = equipmentByBoardSlot(selected.equipment);
  grid.append(
    character,
    ...CHARACTER_EQUIPMENT_SLOTS.map(([slot, row, column]) =>
      characterEquipmentSlot(bySlot.get(slot), row, column),
    ),
  );
  elements.characterEquipment.replaceChildren(caption, grid);
  elements.characterEquipment.hidden = false;
}

/** 목록 전체를 잠그는 자물쇠. 첫 장비 분류 위 스페어값 리셋 옆에 둔다. */
function renderLock() {
  const on = state.pricesLocked === true;
  elements.pricesLock.textContent = "스페어값 잠금";
  elements.pricesLock.setAttribute("aria-pressed", String(on));
  elements.pricesLock.title = on
    ? "잠금 상태에서는 오른쪽 영역의 스페어값을 수정해도 왼쪽 장비 목록의 가격은 바뀌지 않습니다.\n클릭하면 잠금을 해제합니다."
    : "왼쪽 장비 목록의 가격을 잠급니다.\n잠금 상태에서는 오른쪽 영역의 스페어값을 수정해도 왼쪽 장비 목록의 가격은 바뀌지 않습니다.";
}

function renderItems(
  includeCharacterEquipment = true,
  preserveDeleteAnchor = false,
) {
  if (!preserveDeleteAnchor) releaseItemDeleteAnchor();
  renderBulk();
  renderSlots();
  if (includeCharacterEquipment) renderCharacterEquipment();
  if (!state.items.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "아이템을 추가해주세요.";
    elements.items.replaceChildren(empty);
    return;
  }

  elements.items.replaceChildren(
    ...state.items.map((item, index) => {
      const preset = presetForStoredItem(item);
      const row = document.createElement("div");
      row.className = "item";

      const name = document.createElement("div");
      name.className = "item__name";
      const text = document.createElement("span");
      const displayName = preset.equippedOnly
        ? item.displayName || preset.name
        : preset.name;
      const level = document.createElement("small");
      level.textContent = `${item.itemLevel}제`;
      text.append(document.createTextNode(displayName), level);

      // 같은 장비를 여러 개 담았을 때 몇 번째인지 이름 옆에 붙여 준다.
      const itemIdentity = (candidate) =>
        `${candidate.presetId}\u0000${
          presetForStoredItem(candidate).equippedOnly
            ? candidate.displayName || ""
            : ""
        }`;
      const sameTotal = state.items.filter(
        (other) => itemIdentity(other) === itemIdentity(item),
      ).length;
      if (sameTotal > 1) {
        const ordinal = state.items
          .slice(0, index + 1)
          .filter((other) => itemIdentity(other) === itemIdentity(item)).length;
        const badge = document.createElement("span");
        badge.className = "item__count";
        badge.textContent = String(ordinal);
        badge.title = `같은 장비 ${sameTotal}개 중 ${ordinal}번째`;
        text.querySelector("small")?.before(badge);
      }

      name.append(
        iconOf(item.displayIcon ? { icon: item.displayIcon } : preset),
        text,
      );

      const spareControl = document.createElement("span");
      spareControl.className = "spare-input";
      const spareUnit = document.createElement("span");
      spareUnit.className = "picker__unit";
      spareUnit.textContent = "억";
      const priceInput = numberInput(
        priceOfItem(item),
        (value) => {
          setSharedPrice(item.presetId, value, priceInput);
          update();
        },
        preset.npcSpare
          ? {
              readOnly: true,
              className: "input--locked",
              title: "상점에서 정해진 값이라 바꿀 수 없습니다.",
            }
          : { stepFor: spareStep },
      );
      priceInput.dataset.pricePresetId = item.presetId;
      priceInput.setAttribute("aria-label", `${preset.name} 스페어값 (억 메소)`);
      spareControl.append(priceInput, spareUnit);
      const spareValue = field(
        "스페어값",
        spareControl,
        "field--inline field--spare",
      );

      // 착용 레벨에 따라 올릴 수 있는 성급이 정해져 있다(135제는 20성까지).
      const maxStar = getMaxStarforceStar(item.itemLevel);
      if (item.targetStar > maxStar) item.targetStar = maxStar;
      if (item.startStar >= maxStar) item.startStar = maxStar - 1;
      if (item.targetStar < 1 || item.targetStar <= item.startStar) {
        item.targetStar = Math.min(
          maxStar,
          Math.max(DEFAULT_TARGET_STAR, item.startStar + 1),
        );
      }

      const start = field(
        "시작",
        dropdown({
          options: range(0, maxStar - 1),
          value: item.startStar,
          anchorValue: DEFAULT_START_STAR,
          format: starLabel,
          columns: STAR_COLUMNS,
          onChange: (value) => {
            item.startStar = value;
            // 목표에 닿으면 목표를 한 칸 밀어 올린다.
            const pushed = item.targetStar <= value;
            if (pushed) item.targetStar = Math.min(maxStar, value + 1);
            if (pushed) renderItems();
            update();
          },
        }),
        "field--inline",
      );

      const target = field(
        "목표",
        dropdown({
          options: range(1, maxStar),
          value: item.targetStar,
          anchorValue: TARGET_DROPDOWN_ANCHOR_STAR,
          format: starLabel,
          columns: STAR_COLUMNS,
          dimUpTo: () => item.startStar,
          onChange: (value) => {
            item.targetStar = value;
            // 시작에 닿으면 시작을 한 칸 밀어 내린다.
            const pushed = item.startStar >= value;
            if (pushed) item.startStar = Math.max(0, value - 1);
            if (pushed) renderItems();
            update();
          },
        }),
        "field--inline",
      );

      const quantity = field(
        "개수",
        isMobile()
          ? dropdown({
              options: range(1, 9),
              value: Math.min(9, Math.max(1, item.quantity ?? 1)),
              anchorValue: 1,
              format: String,
              onChange: (value) => {
                item.quantity = value;
                update();
              },
            })
          : numberInput(
              item.quantity ?? 1,
              (value) => {
                item.quantity = Math.min(9, Math.max(1, value));
                update();
              },
              { min: "1", max: "9", className: "input--narrow" },
            ),
        "field--inline",
      );

      const spare = field(
        "스페어 사용",
        numberInput(
          item.spare ?? 0,
          (value) => {
            item.spare = Math.min(9, Math.max(0, value));
            update();
          },
          { min: "0", max: "9", className: "input--narrow" },
        ),
        "field--inline",
      );

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "button button--remove";
      remove.textContent = "✕";
      remove.title = "이 장비 빼기";
      remove.addEventListener("click", () => {
        const anchor = itemDeleteAnchor.retain(remove);
        state.items.splice(index, 1);
        renderItems(true, true);
        update();
        requestAnimationFrame(() => {
          const successor = elements.items.querySelectorAll(".item")[index]
            ?.querySelector(".button--remove");
          if (successor) itemDeleteAnchor.align(anchor, successor);
          releaseItemDeleteAnchorAtTop();
        });
      });

      // 시작과 목표는 한 덩어리로 묶어 서로 떨어지지 않게 한다.
      // 이름을 range로 두면 선택지를 만드는 range() 함수를 가려 버린다.
      const rangeBox = document.createElement("div");
      rangeBox.className = "item__range";
      rangeBox.append(start, target);

      const head = document.createElement("div");
      head.className = "item__head";
      head.append(name, spareValue, rangeBox);
      if (SHOW_QUANTITY) head.append(quantity);
      if (SHOW_SPARE) head.append(spare);
      head.append(remove);

      const strategy = document.createElement("div");
      strategy.className = "item__strategy";

      const optimizeOn = item.optimize !== false;
      const optimize = document.createElement("button");
      optimize.type = "button";
      optimize.className = "chip chip--optimize";
      optimize.setAttribute("aria-pressed", String(optimizeOn));
      optimize.innerHTML =
        `강화 최적화 <strong>${optimizeOn ? "O" : "X"}</strong>`;
      optimize.addEventListener("click", () => {
        // 끌 때 확정복구는 지금 적용 중인 선택을 그대로 물려받는다.
        // 파괴방지는 값이 크게 뛰는 선택이라 직접 다시 고르게 비워 둔다.
        if (optimizeOn) {
          item.restore = [...(appliedStrategies.get(index)?.restore ?? [])];
          item.destroyPrevention = [];
        }
        item.optimize = !optimizeOn;
        renderItems();
        update();
      });

      const locked = item.optimize !== false;
      for (const [label, kind, stars, list] of [
        ["파괴방지", "destroyPrevention", SAFEGUARD_STARS, item.destroyPrevention],
        ["확정복구", "restore", RESTORE_STARS, item.restore],
      ]) {
        const group = document.createElement("div");
        group.className = "strategy__row";
        const caption = document.createElement("span");
        caption.className = "strategy__label";
        caption.textContent = label;
        const chips = document.createElement("div");
        chips.className = "chips";
        chips.append(
          ...stars.map((star) =>
            chip(
              `${star}`,
              !locked && list.includes(star),
              () => {
                toggleStar(list, star);
                renderItems();
                update();
              },
              locked,
              { kind, star: String(star) },
            ),
          ),
        );
        group.append(caption, chips);
        // 최적화 스위치는 파괴방지 줄 오른쪽 끝에 함께 둔다.
        if (kind === "destroyPrevention") group.append(optimize);
        strategy.append(group);
      }

      const details = document.createElement("details");
      details.className = "item__details";
      /* 장비를 담을 때마다 목록을 다시 그리므로, 펼쳐 둔 표는 그대로 두려면
         상태를 장비에 새겨 두어야 한다. */
      details.open = item.detailsOpen === true;
      details.addEventListener("toggle", () => {
        item.detailsOpen = details.open;
        save();
      });
      const summary = document.createElement("summary");
      const toggleLabel = document.createElement("span");
      toggleLabel.className = "item__toggle";
      toggleLabel.textContent = "단계별 기댓값";
      const stats = document.createElement("span");
      stats.className = "item__stats";
      summary.append(toggleLabel, stats);
      const scroll = document.createElement("div");
      scroll.className = "table-scroll";
      const table = document.createElement("table");
      table.className = "item__stages";
      table.innerHTML =
        "<thead><tr><th>강화 단계</th><th>기댓값</th><th>누적 기댓값</th><th>평균 스페어</th><th>평균 시도</th></tr></thead><tbody></tbody>";
      scroll.append(table);
      details.append(summary, scroll);

      row.append(head, strategy, details);
      return row;
    }),
  );
}

// 대장장이에게 얹어 주는 배율. 직접 넣을 수 있는 범위를 벗어나면 무시한다.
const MIN_MULTIPLIER = 0.8;
const MAX_MULTIPLIER = 1.2;
let lastTotals = { cost: 0, saved: 0 };

function allMultipliers() {
  return [...new Set([...SAFETY_MULTIPLIERS, ...state.customMultipliers])].sort(
    (left, right) => left - right,
  );
}

function addCustomMultiplier(value) {
  const rounded = Math.round(value * 100) / 100;
  if (
    !Number.isFinite(rounded) ||
    rounded < MIN_MULTIPLIER ||
    rounded > MAX_MULTIPLIER ||
    allMultipliers().includes(rounded)
  ) {
    return false;
  }
  state.customMultipliers.push(rounded);
  state.multiplier = rounded;
  return true;
}

function customMultiplierChip(multiplier, cost) {
  const group = document.createElement("div");
  group.className = "chip chip--custom";

  const label = document.createElement("button");
  label.type = "button";
  label.className = "chip__label";
  label.textContent = `×${multiplier.toFixed(2)}`;
  label.addEventListener("click", () => {
    state.multiplier = multiplier;
    renderMultipliers(cost);
    update();
  });

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "chip__remove";
  remove.textContent = "✕";
  remove.title = "이 배율 빼기";
  remove.addEventListener("click", () => {
    state.customMultipliers = state.customMultipliers.filter(
      (value) => value !== multiplier,
    );
    if (state.multiplier === multiplier) state.multiplier = 1;
    renderMultipliers(cost);
    update();
  });

  group.append(label, remove);
  if (state.multiplier === multiplier) group.dataset.selected = "true";
  return group;
}

function multiplierAdder(cost) {
  const add = chip("+ 추가", false, () => {
    const input = numberInput("", () => {}, {
      className: "chip chip--input",
      step: "0.01",
      min: String(MIN_MULTIPLIER),
      max: String(MAX_MULTIPLIER),
      placeholder: "1.20",
    });

    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      if (commit) addCustomMultiplier(Number(input.value));
      renderMultipliers(cost);
      update();
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") finish(true);
      if (event.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));

    add.replaceWith(input);
    input.focus();
  });
  add.title = `배율 직접 넣기 (${MIN_MULTIPLIER}~${MAX_MULTIPLIER})`;
  return add;
}

function renderMultipliers(cost) {
  elements.multipliers.replaceChildren(
    ...allMultipliers().map((multiplier) =>
      state.customMultipliers.includes(multiplier)
        ? customMultiplierChip(multiplier, cost)
        : chip(`×${multiplier.toFixed(2)}`, state.multiplier === multiplier, () => {
            state.multiplier = multiplier;
            renderMultipliers(cost);
            update();
          }),
    ),
    multiplierAdder(cost),
  );

  // 배율을 쓰면 "기댓값 × 배율 =" 을 앞에 두어 큰 숫자가 답이 되게 한다.
  elements.totalCost.textContent = formatMeso(
    applyMultiplier(cost, state.multiplier),
  );
  elements.totalScaled.textContent =
    state.multiplier === 1
      ? ""
      : `${formatMeso(cost)} × ${state.multiplier.toFixed(2)} =`;
}

function renderTable(body, rows, emptyText) {
  if (!rows.length) {
    const cell = document.createElement("td");
    cell.className = "empty";
    cell.colSpan =
      body.closest("table")?.querySelectorAll("thead th").length || 6;
    cell.textContent = emptyText;
    const row = document.createElement("tr");
    row.append(cell);
    body.replaceChildren(row);
    return;
  }
  // 좁은 화면에서 표를 카드로 펼칠 때 쓸 이름표.
  const labels = [...(body.closest("table")?.querySelectorAll("thead th") ?? [])].map(
    (th) => th.textContent.trim(),
  );
  body.replaceChildren(
    ...rows.map((cells) => {
      const row = document.createElement("tr");
      row.append(
        ...cells.map((value, index) => {
          const cell = document.createElement("td");
          if (labels[index]) {
            cell.dataset.label = labels[index];
            // 카드로 펼칠 때는 괄호 설명을 떼어 이름표를 짧게 쓴다.
            cell.dataset.short = labels[index].replace(/\s*\(.*\)\s*/, "");
          }
          if (value instanceof Node) cell.append(value);
          else cell.textContent = value;
          return cell;
        }),
      );
      return row;
    }),
  );
}

// 최적화가 켜져 있는 동안 계산이 고른 전략. 끌 때 물려주려고 들고 있는다.
const appliedStrategies = new Map();

function update() {
  const { results, errors, total } = calculateAll(toCalcItems(), state);

  for (const [index, row] of [...elements.items.children].entries()) {
    if (!row.classList.contains("item")) continue;
    const error = errors.find((entry) => entry.index === index);
    row.dataset.invalid = error ? "true" : "false";
    row.querySelector(".item__error")?.remove();
    if (error) {
      const message = document.createElement("p");
      message.className = "item__error";
      message.textContent = error.message;
      row.append(message);
    }

    // 자동 최적화일 때는 계산이 고른 전략을 그대로 버튼에 켜 준다.
    const item = state.items[index];
    const entry = results.find((result) => result.index === index);
    const applied = entry
      ? appliedStrategy(entry.strategyStages ?? entry.stages)
      : { destroyPrevention: [], restore: [] };
    if (item?.optimize !== false) {
      appliedStrategies.set(index, applied);
      for (const button of row.querySelectorAll(".chip[data-kind]")) {
        const star = Number(button.dataset.star);
        button.setAttribute(
          "aria-pressed",
          String(applied[button.dataset.kind].includes(star)),
        );
      }
    }

    // 접어 둔 채로도 이 장비가 얼마인지 보이도록 요약을 적는다.
    const stats = row.querySelector(".item__stats");
    if (stats) {
      if (!entry) {
        stats.textContent = "";
      } else {
        const scaled = entry.totalCost * state.multiplier;
        const price =
          state.multiplier === 1
            ? formatMeso(entry.totalCost)
            : `${formatMeso(entry.totalCost)} × ${state.multiplier.toFixed(2)} = ${formatMeso(scaled)}`;
        // 좁은 화면에서 줄이 바뀌더라도 "기댓값 307.95억" 이 통째로 넘어가도록
        // 각 항목을 한 덩어리로 묶는다.
        stats.innerHTML =
          `<span class="item__stat">기댓값 <strong>${price}</strong></span>` +
          ` · ` +
          `<span class="item__stat">평균 스페어 <strong>${formatNumber(entry.totalItems)}개</strong></span>`;
      }
    }

    const stageBody = row.querySelector(".item__stages tbody");
    if (stageBody) {
      // 시작 성부터 그 단계까지 드는 돈을 쌓아 간다. 어디서 돈이 뛰는지 보인다.
      let running = 0;
      renderTable(
        stageBody,
        (entry?.stages ?? []).map((stage) => {
          running += stage.expectedCost;
          return [
            `${stage.star} → ${stage.star + 1}성`,
            formatMeso(stage.expectedCost),
            formatMeso(running),
            `${formatNumber(stage.expectedItems)}개`,
            `${formatNumber(stage.expectedAttempts, 1)}회`,
          ];
        }),
        "계산 결과가 없습니다.",
      );
    }
  }

  elements.totalMeta.textContent = results.length
    ? [
        `장비 ${total.quantity}개`,
        `평균 시도 ${formatNumber(total.attempts, 1)}회`,
        `평균 스페어 ${formatNumber(total.items)}개`,
        SHOW_SPARE && total.spared > 0
          ? `스페어 ${formatNumber(total.spared)}개`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "-";
  elements.totalStorage.textContent =
    SHOW_SPARE && total.saved > 0 ? `창고에 넣을 돈 ${formatMeso(total.saved)}` : "";
  lastTotals = { cost: total.cost, saved: total.saved };
  renderMultipliers(total.cost);

  save();
}

// 항목 이름이 옆에 있으므로 버튼에는 짧은 이름만 적는다.
const EVENT_LABELS = {
  none: "없음",
  discount30: "30%",
  destroy30: "파감",
  shining: "샤타",
};

/* 줄임말만 적혀 있어 무슨 이벤트인지 알 수 없으므로 효과를 그대로 적어 둔다.
   "없음"은 글자 그대로라 덧붙일 말이 없어 비워 둔다. */
const EVENT_TITLES = {
  discount30: "강화비용 30% 할인",
  destroy30: "21성 이하 파괴확률 30% 감소",
  shining: "강화비용 30% 할인, 21성 이하 파괴확률 30% 감소, 복구비용 20% 할인",
};

function renderEvents() {
  elements.event.replaceChildren(
    ...SELECTABLE_EVENTS.map((value) => {
      const button = chip(EVENT_LABELS[value], state.event === value, () => {
        state.event = value;
        renderEvents();
        update();
      });
      if (EVENT_TITLES[value]) button.title = EVENT_TITLES[value];
      return button;
    }),
  );
}

function renderMvp() {
  elements.mvp.replaceChildren(
    ...Object.entries(STARFORCE_MVP).map(([value, mvp]) => {
      const button = chip(
        mvp.label.replace(/^MVP\s*/, ""),
        state.mvp === value,
        () => {
          state.mvp = value;
          renderMvp();
          update();
        },
      );
      // 등급 할인은 1~17성 강화까지만 붙는다. PC방 할인과 합쳐서 뺀다.
      if (mvp.discount) {
        button.title = `1~17성 강화비용 ${Math.round(mvp.discount * 100)}% 할인`;
      }
      return button;
    }),
  );
}

function renderPc() {
  elements.pc.replaceChildren(
    ...[
      [false, "미적용"],
      [true, "적용"],
    ].map(([value, label]) =>
      chip(label, state.pc === value, () => {
        state.pc = value;
        renderPc();
        update();
      }),
    ),
  );
}

// 예전에 저장된 값이 목록에서 빠졌을 수 있으니 되돌려 놓는다.
if (!SELECTABLE_EVENTS.includes(state.event)) state.event = "shining";

elements.pricesLock.addEventListener("click", () => {
  state.pricesLocked = state.pricesLocked !== true;
  renderLock();
  renderPicker();
  save();
});
elements.resetPrices.addEventListener("click", () => {
  state.priceOverrides = {};
  for (const item of state.items) {
    item.replacementEok = fixedPrices[item.presetId] ?? defaultPrices[item.presetId] ?? 0;
  }
  renderPicker();
  renderItems();
  update();
});
elements.clearItems.addEventListener("click", () => {
  state.items = [];
  clearCharacterEquipment();
  renderPicker();
  renderCharacterLookup();
  renderItems();
  update();
});
elements.characterForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void loadCharacterEquipment();
});
elements.characterClear.addEventListener("click", () => {
  clearCharacterEquipment();
  renderPicker();
  renderCharacterLookup();
  renderCharacterEquipment();
  update();
  elements.characterName.focus();
});
elements.characterName.addEventListener("input", () => {
  characterLookupStates[state.slot].draft = elements.characterName.value;
  characterLookupStates[state.slot].error = "";
  setCharacterStatus("", currentCharacterName() ? "success" : "");
  renderCharacterEquipment();
});

// 마우스를 어디로 옮겨도 연속 삭제용 높이를 유지한다. 위로 스크롤해 문서
// 최상단에 도달했을 때만 실제 목록 높이로 되돌린다.
window.addEventListener("scroll", releaseItemDeleteAnchorAtTop, {
  passive: true,
});

// 좁은 화면에서만 쓰는 서랍. 데스크톱에서는 버튼과 덮개가 아예 보이지 않는다.
elements.menu.addEventListener("click", () => {
  setDrawer(document.body.dataset.drawer !== "open");
});
elements.backdrop.addEventListener("click", () => setDrawer(false));
elements.pickerClose.addEventListener("click", () => setDrawer(false));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setDrawer(false);
});
// 화면 폭이 경계를 넘나들면 개수 칸의 모양이 달라지므로 다시 그린다.
MOBILE.addEventListener("change", () => {
  setDrawer(false);
  renderItems();
  update();
});
setDrawer(false);
enableDrawerDrag();

/** 주소를 누르면 메일이 열리고, 이 버튼은 복사만 한다. */
elements.contactCopy.addEventListener("click", async () => {
  const mail = elements.contactMail.textContent.trim();
  try {
    await navigator.clipboard.writeText(mail);
  } catch {
    // 클립보드를 막아 둔 브라우저에서는 예전 방식으로 한 번 더 시도한다.
    const helper = document.createElement("textarea");
    helper.value = mail;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.append(helper);
    helper.select();
    try {
      document.execCommand("copy");
    } catch {
      elements.contactCopy.textContent = "실패";
    }
    helper.remove();
  }
  if (elements.contactCopy.textContent !== "실패") {
    elements.contactCopy.textContent = "복사됨";
  }
  elements.contactCopy.dataset.copied = "true";
  setTimeout(() => {
    elements.contactCopy.textContent = "복사";
    delete elements.contactCopy.dataset.copied;
  }, 1500);
});

renderToolNav(document.querySelector("#toolnav"), "starforce");

renderLock();
renderEvents();
renderMvp();
renderPc();
renderPicker();
renderCharacterLookup();
renderItems();
update();

// 가격 전환에 필요한 사본만 유지한다. 공유/개인 설정에는 저장하지 않는다.
let sharedPriceSnapshot = null;
registerResultShare(() => ({
  local: { [STORAGE_KEY]: { ...state, items: undefined, slots: undefined, characterSources: undefined, slot: undefined } },
  session: { [ITEMS_KEY]: { slots: state.slots, slot: state.slot } },
}), { setPersonalPrices: (enabled) => {
  if (enabled === (sharedPriceSnapshot !== null)) return { enabled, message: "" };
  const items = state.slots.flat();
  if (enabled) {
    const prices = readPersonalStarforcePrices();
    if (prices === null) return { enabled: false, message: "불러올 수 있는 저장된 스페어값이 없습니다." };
    sharedPriceSnapshot = {
      overrides: { ...state.priceOverrides },
      items: new Map(items.map((item) => [item, item.replacementEok])),
    };
    state.priceOverrides = prices;
    applyPersonalStarforcePrices(items, prices, { defaults: defaultPrices, fixed: fixedPrices, groups: groupForPreset });
  } else {
    state.priceOverrides = sharedPriceSnapshot.overrides;
    applyPersonalStarforcePrices(items, state.priceOverrides, { defaults: defaultPrices, fixed: fixedPrices, groups: groupForPreset });
    for (const item of items) {
      if (!sharedPriceSnapshot.items.has(item)) continue;
      const price = sharedPriceSnapshot.items.get(item);
      if (price === undefined) delete item.replacementEok;
      else item.replacementEok = price;
    }
    sharedPriceSnapshot = null;
  }
  renderPicker();
  renderItems();
  update();
  return { enabled, message: enabled ? "내 스페어값으로 계산합니다." : "공유 스페어값으로 계산합니다." };
} });
