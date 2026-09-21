/*
 * 계산기 전체에서 쓰는 검색형 선택창.
 *
 * 페이지마다 네이티브 select나 별도 콤보박스를 만들면 검색, 선택 해제,
 * 키보드 조작이 서로 달라진다. 이 컴포넌트가 열기/닫기, 한 건 자동 선택,
 * 그룹 머리글과 접근성 속성을 한 곳에서 책임진다.
 */

let nextListId = 0;
let openedSelect = null;

const text = (value) => String(value ?? "");
const searchText = (value) => text(value).normalize("NFKC").toLocaleLowerCase("ko-KR");

function normalizeOptions(options) {
  return (Array.isArray(options) ? options : [])
    .map((option) => typeof option === "object"
      ? { ...option, value: text(option.value), label: text(option.label) }
      : { value: text(option), label: text(option) })
    .filter((option) => option.hidden !== true);
}

function closeOpenedSelect(event) {
  if (openedSelect && !openedSelect.root.contains(event.target)) {
    openedSelect.close();
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", closeOpenedSelect);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") openedSelect?.close({ restore: true });
  });
}

export function searchableSelect(options, value, onChange, {
  key,
  ariaLabel = "선택",
  disabled = false,
  className = "",
  clearable = false,
  placeholder = "검색 또는 선택",
  emptyText = "검색 결과 없음",
  filterOptions,
  anchorValue,
  columns = 0,
  optionState,
} = {}) {
  const normalized = normalizeOptions(options);
  let currentValue = text(value);
  let selected = normalized.find((option) => option.value === currentValue);
  let isDisabled = Boolean(disabled);
  let open = false;
  let filtered = [];
  let activeIndex = -1;
  let selectionCommitted = false;
  // 페이지가 선택 직후 DOM을 다시 그릴 때 포커스만 이어 받고 목록은 다시
  // 열지 않는다. 일반 focus와 구분하지 않으면 첫 선택이 곧바로 검색 시작으로
  // 바뀌어 사용자가 같은 옵션을 한 번 더 눌러야 닫힌 것처럼 보인다.
  let restoringFocusAfterRender = false;

  const root = document.createElement("div");
  root.className = `search-select${className ? ` ${className}` : ""}`;
  root.dataset.clearable = String(clearable);
  root.dataset.disabled = String(isDisabled);

  const input = document.createElement("input");
  input.className = "search-select__input";
  input.type = "search";
  input.value = selected?.label ?? "";
  input.placeholder = placeholder;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.disabled = isDisabled;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-label", ariaLabel);
  if (key) input.dataset.key = key;

  const clear = document.createElement("button");
  clear.className = "search-select__clear";
  clear.type = "button";
  clear.textContent = "×";
  clear.disabled = isDisabled;
  clear.setAttribute("aria-label", `${ariaLabel} 선택 해제`);

  const toggle = document.createElement("button");
  toggle.className = "search-select__toggle";
  toggle.type = "button";
  toggle.textContent = "▾";
  toggle.disabled = isDisabled;
  toggle.tabIndex = -1;
  toggle.setAttribute("aria-label", `${ariaLabel} 목록 열기`);

  const list = document.createElement("div");
  list.className = "search-select__options";
  list.id = `search-select-options-${nextListId += 1}`;
  list.hidden = true;
  list.setAttribute("role", "listbox");
  if (columns > 0) list.dataset.columns = String(columns);
  input.setAttribute("aria-controls", list.id);

  const refreshClear = () => {
    clear.hidden = !clearable || !selected || selected.value === "";
  };

  const restoreLabel = () => {
    selected = normalized.find((option) => option.value === currentValue);
    input.value = selected?.label ?? "";
    refreshClear();
  };

  const defaultFilter = (source, query) => {
    const needle = searchText(query).trim();
    if (!needle) return source;
    return source.filter((option) => [
      option.label,
      option.group,
      option.searchText,
    ].some((candidate) => searchText(candidate).includes(needle)));
  };

  const matchingOptions = () => {
    const source = typeof filterOptions === "function"
      ? filterOptions(normalized, input.value)
      : defaultFilter(normalized, input.value);
    return Array.isArray(source) ? source : [];
  };

  const applyOptionState = (control, option) => {
    const dynamic = typeof optionState === "function" ? optionState(option) : null;
    const tone = dynamic?.tone ?? option.groupTone ?? option.tone ?? "";
    const dim = dynamic?.dim ?? option.dim;
    if (tone) control.dataset.tone = tone;
    if (dim) control.dataset.dim = "true";
  };

  const setActive = (index) => {
    if (!filtered.length) {
      activeIndex = -1;
      input.removeAttribute("aria-activedescendant");
      return;
    }
    activeIndex = Math.max(0, Math.min(filtered.length - 1, index));
  };

  const commit = (option, { restoreFocus = true } = {}) => {
    if (!option || option.disabled) return;
    selectionCommitted = true;
    const changed = option.value !== currentValue;
    currentValue = option.value;
    selected = option;
    input.value = option.label;
    refreshClear();
    setOpen(false);
    // 목록에서 골랐더라도 키보드 흐름은 원래 콤보박스에서 이어진다.
    if (restoreFocus && document.activeElement !== input) {
      input.focus({ preventScroll: true });
    }
    if (changed) onChange(option.value);
  };

  const paintOptions = () => {
    filtered = matchingOptions();
    if (activeIndex >= filtered.length) activeIndex = filtered.length - 1;
    if (activeIndex < 0 || filtered[activeIndex]?.disabled) {
      activeIndex = filtered.findIndex((option) => !option.disabled);
    }
    list.replaceChildren();
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "search-select__empty";
      empty.textContent = emptyText;
      empty.setAttribute("role", "status");
      list.append(empty);
      input.removeAttribute("aria-activedescendant");
      return;
    }

    if (columns > 0 && !input.value.trim()) {
      const first = Number(filtered[0]?.value);
      const pad = Number.isFinite(first) ? ((first % columns) + columns) % columns : 0;
      for (let index = 0; index < pad; index += 1) {
        const filler = document.createElement("span");
        filler.className = "search-select__pad";
        filler.setAttribute("aria-hidden", "true");
        list.append(filler);
      }
    }

    let previousGroup = null;
    filtered.forEach((option, index) => {
      if (option.group && option.group !== previousGroup) {
        const heading = document.createElement("div");
        heading.className = "search-select__group";
        heading.textContent = option.group;
        heading.dataset.tone = option.groupTone || option.tone || "";
        list.append(heading);
        previousGroup = option.group;
      }
      const control = document.createElement("button");
      control.className = "search-select__option";
      control.type = "button";
      control.id = `${list.id}-option-${index}`;
      control.textContent = option.label;
      control.disabled = option.disabled === true;
      control.dataset.optionIndex = String(index);
      control.dataset.active = String(index === activeIndex);
      control.setAttribute("role", "option");
      control.setAttribute("aria-selected", String(option.value === currentValue));
      applyOptionState(control, option);
      control.addEventListener("pointerdown", (event) => event.preventDefault());
      control.addEventListener("click", () => commit(option));
      if (control.disabled && option.disabledReason) {
        // 비활성 버튼 대신 감싸는 요소가 마우스를 받아 기본 툴팁을 표시한다.
        const hint = document.createElement("span");
        hint.className = "search-select__option-hint";
        hint.title = text(option.disabledReason);
        hint.setAttribute("role", "presentation");
        control.setAttribute("aria-description", hint.title);
        hint.append(control);
        list.append(hint);
      } else {
        list.append(control);
      }
    });

    const active = list.querySelector(`[data-option-index="${activeIndex}"]`);
    if (active) input.setAttribute("aria-activedescendant", active.id);
    else input.removeAttribute("aria-activedescendant");
  };

  function setOpen(next, { restore = false } = {}) {
    const requested = Boolean(next) && !isDisabled;
    if (requested) {
      if (openedSelect?.root !== root) openedSelect?.close({ restore: true });
      open = true;
      root.dataset.open = "true";
      input.setAttribute("aria-expanded", "true");
      toggle.setAttribute("aria-label", `${ariaLabel} 목록 닫기`);
      list.hidden = false;
      paintOptions();
      const anchor = text(typeof anchorValue === "function" ? anchorValue() : anchorValue ?? currentValue);
      const anchorIndex = filtered.findIndex((option) => option.value === anchor);
      if (anchorIndex >= 0) setActive(anchorIndex);
      paintOptions();
      list.querySelector(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
      openedSelect = { root, close: (options) => setOpen(false, options) };
      return;
    }
    open = false;
    root.dataset.open = "false";
    input.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", `${ariaLabel} 목록 열기`);
    list.hidden = true;
    input.removeAttribute("aria-activedescendant");
    if (restore) restoreLabel();
    if (openedSelect?.root === root) openedSelect = null;
  }

  const moveActive = (direction) => {
    if (!filtered.length) return;
    let next = activeIndex;
    for (let count = 0; count < filtered.length; count += 1) {
      next = (next + direction + filtered.length) % filtered.length;
      if (!filtered[next].disabled) break;
    }
    setActive(next);
    paintOptions();
    list.querySelector(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  };

  // 선택 직후 재렌더링되면 입력칸에 포커스가 남아 있다. 이때 다시 클릭해도
  // focus 이벤트가 발생하지 않으므로, 선택 라벨을 검색어로 오해하지 않게
  // 명시적으로 비우고 전체 목록을 연다.
  const openFullList = () => {
    selectionCommitted = false;
    input.value = "";
    activeIndex = -1;
    setOpen(true);
  };

  input.addEventListener("focus", () => {
    if (restoringFocusAfterRender) return;
    openFullList();
  });
  // 선택 뒤 포커스가 남은 상태에서도 입력칸을 한 번 누르면 다시 펼쳐진다.
  input.addEventListener("click", () => {
    if (!open) openFullList();
  });
  input.addEventListener("input", () => {
    selectionCommitted = false;
    activeIndex = -1;
    setOpen(true);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openFullList();
      moveActive(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      if (!open) return;
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : filtered.length - 1);
      paintOptions();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (!open) {
        openFullList();
        return;
      }
      commit(filtered[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false, { restore: true });
      input.select();
    }
  });
  toggle.addEventListener("pointerdown", (event) => event.preventDefault());
  toggle.addEventListener("click", () => {
    if (open) setOpen(false, { restore: true });
    else if (document.activeElement === input) openFullList();
    else input.focus();
  });
  clear.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  clear.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    selectionCommitted = true;
    setOpen(false);
    input.blur();
    if (currentValue !== "") onChange("");
  });
  root.addEventListener("focusout", () => {
    setTimeout(() => {
      if (selectionCommitted || root.contains(document.activeElement)) return;
      const query = input.value.trim();
      const matches = query
        ? matchingOptions().filter((option) => !option.disabled)
        : [];
      if (matches.length === 1) commit(matches[0], { restoreFocus: false });
      else setOpen(false, { restore: true });
    }, 0);
  });

  Object.defineProperty(root, "disabled", {
    get: () => isDisabled,
    set: (next) => {
      isDisabled = Boolean(next);
      root.dataset.disabled = String(isDisabled);
      input.disabled = isDisabled;
      clear.disabled = isDisabled;
      toggle.disabled = isDisabled;
      if (isDisabled) setOpen(false, { restore: true });
    },
  });
  Object.defineProperty(root, "value", {
    get: () => currentValue,
    set: (next) => {
      currentValue = text(next);
      restoreLabel();
    },
  });
  Object.defineProperty(input, "focusAfterRender", {
    value: (options) => {
      restoringFocusAfterRender = true;
      try {
        input.focus(options);
      } finally {
        restoringFocusAfterRender = false;
      }
    },
  });
  root.openSelect = () => {
    if (document.activeElement === input) openFullList();
    else input.focus();
  };
  root.closeSelect = (restore = true) => setOpen(false, { restore });
  root.stepSelection = (direction) => {
    const enabled = normalized.filter((option) => !option.disabled);
    const index = enabled.findIndex((option) => option.value === currentValue);
    const next = enabled[index + direction];
    if (next) commit(next, { blur: false });
  };

  refreshClear();
  root.append(input, clear, toggle, list);
  return root;
}
