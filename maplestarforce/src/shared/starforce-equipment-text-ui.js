import { formatEquipmentText, parseEquipmentText } from "./starforce-equipment-text.js";
import { enableCalculatorStoragePersistence } from "./result-share-state.js";
import "./starforce-equipment-text.css";

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

export function installEquipmentTextTransfer(adapter) {
  if (!adapter) return;
  const board = document.querySelector(".card--enhance");
  if (!board) return;
  board.classList.add("equipment-text-target");
  board.tabIndex = 0;
  const paste = document.querySelector(".equipment-text-paste") ?? element("button", "result-share-button equipment-text-paste");
  paste.disabled = false;
  paste.type = "button";
  paste.title = "장비목록 텍스트 붙여넣기 (Ctrl+V / ⌘V)";
  paste.setAttribute("aria-label", "장비목록 붙여넣기");
  paste.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="8" y="2" width="8" height="6" rx="2"/><path d="M8 13h8m-8 4h5"/></svg><span>장비목록 붙여넣기</span>';

  function showPasteDialog(text = "", opener = paste) {
    if (document.querySelector(".equipment-text-dialog")) return;
    const dialog = element("dialog", "result-share-dialog equipment-text-dialog");
    const title = element("h2", "", "장비목록 붙여넣기");
    title.id = "equipment-text-title";
    dialog.setAttribute("aria-labelledby", title.id);
    const help = element("p", "equipment-text-help", "장비를 한 줄에 하나씩 입력하세요. 현재 설정과 내 스페어값으로 강화 최적화를 적용합니다.");
    help.id = "equipment-text-help";
    const input = element("textarea", "result-share-link equipment-text-input");
    input.value = text;
    input.placeholder = "몽벨 12-21\n거공 12-22";
    input.spellcheck = false;
    input.setAttribute("aria-label", "붙여넣을 장비목록");
    input.setAttribute("aria-describedby", help.id);
    const preview = element("p", "equipment-text-preview");
    preview.setAttribute("role", "status");
    const actions = element("div", "result-share-actions");
    const cancel = element("button", "result-share-action", "취소");
    cancel.type = "button";
    cancel.addEventListener("click", () => dialog.close());
    const replace = element("button", "result-share-action", "현재 슬롯 교체");
    const append = element("button", "result-share-action equipment-text-append", "추가하기");
    replace.type = append.type = "button";
    const validate = () => {
      try {
        const items = parseEquipmentText(input.value);
        preview.textContent = `슬롯 ${adapter.getSlot()}에 장비 ${items.length}개를 불러옵니다.`;
        preview.dataset.invalid = "false";
        replace.disabled = append.disabled = false;
        return items;
      } catch (error) {
        preview.textContent = input.value.trim() ? error.message : "붙여넣을 장비목록을 입력해 주세요.";
        preview.dataset.invalid = String(Boolean(input.value.trim()));
        replace.disabled = append.disabled = true;
        return null;
      }
    };
    const apply = (replaceItems) => {
      const items = validate();
      if (!items) return;
      enableCalculatorStoragePersistence();
      adapter.applyItems(items, replaceItems);
      dialog.close();
    };
    replace.addEventListener("click", () => apply(true));
    append.addEventListener("click", () => apply(false));
    input.addEventListener("input", validate);
    actions.append(cancel, replace, append);
    dialog.append(title, help, input, preview, actions);
    const outside = (event) => {
      const bounds = dialog.getBoundingClientRect();
      return event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
    };
    let pressedOutside = false;
    dialog.addEventListener("pointerdown", (event) => { pressedOutside = outside(event); });
    dialog.addEventListener("pointercancel", () => { pressedOutside = false; });
    dialog.addEventListener("click", (event) => {
      if (pressedOutside && outside(event)) dialog.close();
      pressedOutside = false;
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      (opener?.isConnected ? opener : paste).focus({ preventScroll: true });
    }, { once: true });
    document.body.append(dialog);
    validate();
    dialog.showModal();
    input.focus();
  }

  paste.addEventListener("click", () => showPasteDialog());
  board.addEventListener("paste", (event) => {
    if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
    const text = event.clipboardData?.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    showPasteDialog(text, document.activeElement);
  });
  return { getEquipmentText: () => formatEquipmentText(adapter.getItems()), pasteButton: paste };
}
