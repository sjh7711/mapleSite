/** Image options with the same single-selection keyboard behavior as a select. */
export function createVarianceEquipmentSelector({ plans, selectedIndex, hasErrors }) {
  const root = document.createElement("div"); root.className = "variance-equipment";
  const caption = document.createElement("span"); caption.textContent = "각 장비 별 편차 확인";
  const picker = document.createElement("div"); picker.className = "variance-equipment__picker";
  const trigger = document.createElement("button"); trigger.type = "button";
  trigger.className = "variance-equipment__select";
  trigger.setAttribute("aria-haspopup", "listbox"); trigger.setAttribute("aria-expanded", "false");
  const list = document.createElement("div"); list.className = "variance-equipment__options";
  list.id = `variance-equipment-${crypto.randomUUID()}`; list.hidden = true;
  list.setAttribute("role", "listbox"); list.setAttribute("aria-label", caption.textContent);
  trigger.setAttribute("aria-controls", list.id);
  const entries = [{ value: "all", text: `전체 장비 · ${plans.reduce((sum, plan) => sum + (plan.quantity ?? 1), 0)}개`, disabled: Boolean(hasErrors) },
    ...plans.map((plan, index) => ({ value: String(index), icon: plan.icon,
      text: `${plan.name} ${plan.startStar}→${plan.targetStar}성${plan.quantity > 1 ? ` · ${plan.quantity}개` : ""}` }))];
  const initial = plans.findIndex((plan) => plan.sourceIndex === selectedIndex);
  let value = initial < 0 ? "all" : String(initial);
  if (entries.find((entry) => entry.value === value)?.disabled) value = "0";
  const content = (entry) => {
    const fragment = document.createDocumentFragment();
    if (entry.icon) {
      const image = document.createElement("img"); image.src = entry.icon; image.alt = "";
      image.width = 24; image.height = 24; image.addEventListener("error", () => image.remove(), { once: true });
      fragment.append(image);
    }
    const text = document.createElement("span"); text.textContent = entry.text; fragment.append(text);
    return fragment;
  };
  const options = entries.map((entry) => {
    const option = document.createElement("div"); option.className = "variance-equipment__option";
    option.setAttribute("role", "option"); option.tabIndex = -1; option.dataset.value = entry.value;
    option.setAttribute("aria-disabled", String(Boolean(entry.disabled))); option.append(content(entry));
    option.addEventListener("click", () => select(entry)); list.append(option); return option;
  });
  const sync = () => {
    const entry = entries.find((entry) => entry.value === value);
    trigger.replaceChildren(content(entry)); trigger.setAttribute("aria-label", `${caption.textContent} · ${entry.text}`);
    options.forEach((option) => option.setAttribute("aria-selected", String(option.dataset.value === value)));
  };
  const close = (focus = false) => {
    list.hidden = true; trigger.setAttribute("aria-expanded", "false");
    if (focus) trigger.focus({ preventScroll: true });
  };
  const open = () => {
    list.hidden = false; trigger.setAttribute("aria-expanded", "true");
    const option = options.find((option) => option.dataset.value === value);
    option.focus({ preventScroll: true }); option.scrollIntoView({ block: "nearest" });
  };
  function select(entry) {
    if (entry.disabled) return;
    const changed = value !== entry.value; value = entry.value; sync(); close(true);
    if (changed) root.dispatchEvent(new Event("change"));
  }
  trigger.addEventListener("click", () => list.hidden ? open() : close());
  trigger.addEventListener("keydown", (event) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); open();
      if (event.key === "Home" || event.key === "End") {
        const enabled = options.filter((option) => option.getAttribute("aria-disabled") !== "true");
        (event.key === "Home" ? enabled[0] : enabled.at(-1)).focus({ preventScroll: true });
      }
    }
  });
  list.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === "Tab") { close(); return; }
    const enabled = options.filter((option) => option.getAttribute("aria-disabled") !== "true");
    const index = enabled.indexOf(document.activeElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1
        : (index + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
      enabled[next].focus({ preventScroll: true }); enabled[next].scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault(); select(entries.find((entry) => entry.value === document.activeElement.dataset.value));
    }
  });
  const outside = (event) => { if (!picker.contains(event.target)) close(); };
  document.addEventListener("pointerdown", outside);
  picker.addEventListener("focusout", (event) => { if (!picker.contains(event.relatedTarget)) close(); });
  sync(); picker.append(trigger, list); root.append(caption, picker);
  return { element: root, get value() { return value; }, destroy() { document.removeEventListener("pointerdown", outside); } };
}
