/* 도구가 함께 쓰는 화면 조각. 스타포스든 잠재든 같은 조작감을 유지하려고
   여기 모아 둔다. 계산이나 특정 도구의 사정은 여기 들어오지 않는다. */

export function field(labelText, control, className = "") {
  const label = document.createElement("label");
  label.className = `field${className ? ` ${className}` : ""}`;
  const span = document.createElement("span");
  span.textContent = labelText;
  label.append(span, control);
  return label;
}

// 열려 있는 드롭다운은 하나만 둔다.
let openDropdown = null;
let nextDropdownId = 0;

/* 펼쳐 둔 목록은 바깥을 누르거나 Escape 를 치면 닫는다. 목록 자체와 한 몸이라
   드롭다운을 쓰는 쪽이 따로 붙이지 않아도 되게 여기서 한 번만 건다. */
document.addEventListener("click", (event) => {
  if (openDropdown && !openDropdown.root.contains(event.target)) {
    openDropdown.close();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") openDropdown?.close();
});

export function range(from, to) {
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

/* 네이티브 select로는 펼쳤을 때 스크롤 위치를 정할 수 없어 직접 만든 드롭다운. */
function legacyDropdown({
  options,
  value,
  anchorValue,
  format,
  onChange,
  // 넓은 화면에서 몇 칸씩 끊어 격자로 펼칠지. 없으면 예전처럼 한 줄씩 쌓는다.
  columns = 0,
  // 이 값 이하는 고를 수는 있어도 눈에 덜 띄게 흐려 둔다.
  dimUpTo = null,
  // 목표 미선택처럼 숫자 범위 밖의 의미를 가진 값은 흐림 처리에서 제외한다.
  neverDim = [],
}) {
  const root = document.createElement("div");
  root.className = "dropdown";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "dropdown__button";
  button.setAttribute("role", "combobox");
  button.setAttribute("aria-haspopup", "listbox");
  button.setAttribute("aria-expanded", "false");

  const list = document.createElement("div");
  list.className = "dropdown__list";
  list.id = `dropdown-options-${nextDropdownId += 1}`;
  list.setAttribute("role", "listbox");
  list.hidden = true;
  button.setAttribute("aria-controls", list.id);
  if (columns) list.dataset.columns = String(columns);

  let current = value;
  // 눌린 숫자를 잠깐 모아 둔다. 아직 확정하지 않은 동안은 버퍼를 보여 준다.
  let typed = "";
  // 값은 정해졌지만 뒤에 숫자가 더 붙을 수 있어 확정을 미뤄 둔 값.
  let pending = null;
  let typedTimer = null;
  // 펼친 목록을 한 번에 한 줄씩 넘기려고 재 두는 줄 높이.
  let rowStep = 0;

  const paint = () => {
    button.textContent = typed ? `${typed}…` : format(current);
    for (const option of list.children) {
      if (!option.matches("[role='option']")) continue;
      const selected = Number(option.dataset.value) === current;
      option.setAttribute("aria-selected", String(selected));
      if (selected) button.setAttribute("aria-activedescendant", option.id);
    }
  };

  const commit = (next) => {
    if (next === current || !options.includes(next)) return;
    current = next;
    paint();
    onChange(next);
  };

  const step = (direction) => options[options.indexOf(current) + direction] ?? current;

  const resetTyped = () => {
    clearTimeout(typedTimer);
    typedTimer = null;
    typed = "";
    pending = null;
  };

  /** 눌러 둔 숫자를 버린다. 화살표나 Escape처럼 입력을 물릴 때 쓴다. */
  const forgetTyped = () => {
    if (!typed && pending === null) return;
    resetTyped();
    paint();
  };

  /** 미뤄 둔 값을 확정한다. 기다림이 끝났거나 목록을 닫을 때 쓴다. */
  const flushTyped = () => {
    const value = pending;
    resetTyped();
    if (value !== null) commit(value);
    paint();
    if (value !== null && !list.hidden) {
      list
        .querySelector(`[data-value="${current}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  };

  /** 목록을 열지 않고도 숫자를 그대로 쳐서 고른다. 22 처럼 두 자리도 받는다. */
  const typeDigit = (digit) => {
    const consider = (text) => {
      const number = Number(text);
      const exact = options.includes(number);
      // 12를 치려는 것인지 1에서 멈춘 것인지는 다음 숫자를 봐야 안다.
      const longer = options.some(
        (option) =>
          String(option).length > text.length && String(option).startsWith(text),
      );
      if (!exact && !longer) return null;
      return { text, value: exact ? number : null, longer };
    };
    // 이어 치면 두 자리, 그래도 안 맞으면 방금 친 숫자부터 다시 센다.
    const attempt = consider(typed + digit) ?? consider(digit);
    if (!attempt) return;
    clearTimeout(typedTimer);
    typed = attempt.text;
    pending = attempt.value;
    // 더 붙을 숫자가 없으면 바로 확정한다.
    if (attempt.value !== null && !attempt.longer) {
      flushTyped();
      return;
    }
    // 이어질 수 있으면 잠깐 기다린다. 여기서 바로 확정하면 반대쪽 값을 밀어내며
    // 목록을 다시 그려서, 뒤이어 치는 숫자가 사라진다.
    typedTimer = setTimeout(flushTyped, TYPE_RESET);
    paint();
  };

  const close = () => {
    flushTyped();
    list.hidden = true;
    button.setAttribute("aria-expanded", "false");
    button.removeAttribute("aria-activedescendant");
    if (openDropdown?.root === root) openDropdown = null;
  };

  /* 격자로 깔렸을 때만 보이는 줄 수를 정한다. 글자 크기가 달라져도 따라가도록
     실제로 깔린 높이를 재서 쓴다. 좁은 화면에서는 한 줄에 하나씩 깔리므로
     여기서 손대지 않고 CSS 높이를 그대로 둔다. */
  const fitRows = () => {
    list.style.maxHeight = "";
    rowStep = 0;
    const first = optionNodes[0];
    if (!first) return;
    const next = optionNodes.find((o) => o.offsetTop > first.offsetTop);
    if (!next) return;
    rowStep = next.offsetTop - first.offsetTop;
    // 한 줄에 하나씩 깔리면 격자가 아니므로 높이는 CSS 값을 그대로 둔다.
    if (!columns || optionNodes[1]?.offsetTop !== first.offsetTop) return;
    const style = getComputedStyle(list);
    const chrome =
      parseFloat(style.paddingTop) +
      parseFloat(style.paddingBottom) +
      parseFloat(style.borderTopWidth) +
      parseFloat(style.borderBottomWidth);
    list.style.maxHeight = `${
      rowStep * (VISIBLE_ROWS - 1) + first.offsetHeight + chrome
    }px`;
  };

  /* 시작이 바뀌어도 목표 칸은 다시 그려지지 않는 경우가 있어, 펼칠 때마다
     어디까지 흐릴지 다시 정한다. */
  const paintDim = () => {
    if (dimUpTo === null) return;
    const limit = typeof dimUpTo === "function" ? dimUpTo() : dimUpTo;
    for (const option of optionNodes) {
      const optionValue = Number(option.dataset.value);
      if (!neverDim.includes(optionValue) && optionValue <= limit) {
        option.dataset.dim = "true";
      }
      else delete option.dataset.dim;
    }
  };

  const open = () => {
    openDropdown?.close();
    list.hidden = false;
    paintDim();
    button.setAttribute("aria-expanded", "true");
    paint();
    fitRows();
    // 기준 항목이 든 줄이 목록 맨 위에 오도록 스크롤을 맞춘다.
    const anchorStar =
      typeof anchorValue === "function" ? anchorValue() : anchorValue;
    const anchor = list.querySelector(`[data-value="${anchorStar}"]`);
    // 첫 칸의 offsetTop 이 곧 목록 안쪽 여백이다. 그만큼 빼야 줄이 딱 맞는다.
    const top = optionNodes[0]?.offsetTop ?? 0;
    list.scrollTop = anchor ? Math.max(0, anchor.offsetTop - top) : 0;
    openDropdown = { root, close };
  };

  // 목표는 1성부터라 격자 첫 칸이 비어야 0·6·12… 자리가 맞는다.
  const pad = columns ? ((options[0] % columns) + columns) % columns : 0;
  for (let index = 0; index < pad; index += 1) {
    const filler = document.createElement("span");
    filler.className = "dropdown__pad";
    filler.setAttribute("aria-hidden", "true");
    list.append(filler);
  }

  const optionNodes = options.map((optionValue, index) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "dropdown__option";
    option.dataset.value = String(optionValue);
    option.id = `${list.id}-option-${index}`;
    option.tabIndex = -1;
    option.setAttribute("role", "option");
    option.textContent = format(optionValue);
    option.addEventListener("click", () => {
      resetTyped();
      commit(optionValue);
      close();
      button.focus({ preventScroll: true });
    });
    return option;
  });
  list.append(...optionNodes);

  button.addEventListener("click", () => (list.hidden ? open() : close()));
  root.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const direction = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (direction) {
      event.preventDefault();
      forgetTyped();
      commit(step(direction));
      return;
    }
    if (/^[0-9]$/.test(event.key)) {
      event.preventDefault();
      typeDigit(event.key);
      return;
    }
    if (event.key === "Backspace") forgetTyped();
    if (event.key === "Escape") {
      forgetTyped();
      close();
    }
  });

  // 펼친 목록만 한 줄씩 스크롤한다. 휠로 선택값을 바꾸지는 않는다.
  root.addEventListener(
    "wheel",
    (event) => {
      if (!list.hidden) {
        if (!rowStep) return;
        event.preventDefault();
        const line = Math.round(list.scrollTop / rowStep);
        list.scrollTop = (line + (event.deltaY > 0 ? 1 : -1)) * rowStep;
        return;
      }
    },
    { passive: false },
  );

  paint();
  root.append(button, list);
  return root;
}

/* 시작·목표 성 선택은 숫자 격자, 현재 성 기준 목록 스크롤, 직접 숫자 입력을
   쓰는 스타포스 전용 UI다. 일반 검색형 선택창과 분리한다. */
export function dropdown(options) {
  return legacyDropdown(options);
}

// 격자로 펼쳤을 때 한눈에 보여 줄 줄 수.
const VISIBLE_ROWS = 2;

// 이어 치는 숫자로 볼지 새로 치는 숫자로 볼지 가르는 시간.
const TYPE_RESET = 900;

export function numberInput(value, onChange, extra = {}) {
  const {
    allowDecimalDraft = false,
    allowEmpty = false,
    className,
    stepFor,
    ...attributes
  } = extra;
  const element = document.createElement("input");
  element.type = allowDecimalDraft ? "text" : "number";
  if (allowDecimalDraft) element.inputMode = "decimal";
  if (className) element.className = className;
  Object.assign(element, { min: "0", step: "1", ...attributes });
  element.value = String(value);
  // 눈금은 화살표를 누를 때만 쓴다. step 속성으로 두면 브라우저가
  // 눈금에 안 맞는 입력을 경고하는데, 직접 치는 값은 자유로워야 한다.
  if (stepFor) element.step = "any";
  element.addEventListener("input", () => {
    if (allowEmpty && element.value === "") {
      onChange("");
      return;
    }
    if (allowDecimalDraft) {
      const next = element.value.replace(",", ".");
      if (!/^\d*(?:\.\d*)?$/.test(next)) {
        element.value = String(value);
        return;
      }
      onChange(next);
      return;
    }
    onChange(Number(element.value) || 0);
  });

  /** 값이 커질수록 성큼 움직이고, 눈금에 떨어지는 값만 남긴다. */
  const shift = (direction) => {
    const now = Number(element.value) || 0;
    const size = stepFor ? stepFor(now) : Number(element.step || 1);
    const min = Number(element.min);
    const max = Number(element.max);
    const raw = now + size * direction;
    let next = Math.round(Math.round(raw / size) * size * 100) / 100;
    if (Number.isFinite(min)) next = Math.max(min, next);
    if (Number.isFinite(max) && element.max !== "") next = Math.min(max, next);
    element.value = String(next);
    onChange(next);
  };

  // step을 "any"로 두면 화살표가 1씩 움직이므로 직접 처리한다.
  if (stepFor) {
    element.addEventListener("keydown", (event) => {
      const direction = { ArrowUp: 1, ArrowDown: -1 }[event.key];
      if (!direction || element.readOnly) return;
      event.preventDefault();
      shift(direction);
    });
  }

  // 포커스가 있어도 휠로 숫자가 바뀌지 않게 하고 페이지 스크롤은 허용한다.
  element.addEventListener(
    "wheel",
    () => {
      if (document.activeElement === element) element.blur();
    },
    { passive: true },
  );

  return element;
}

export function chip(label, pressed, onClick, disabled = false, dataset = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chip";
  button.textContent = label;
  button.setAttribute("aria-pressed", String(pressed));
  button.disabled = disabled;
  for (const [key, value] of Object.entries(dataset)) button.dataset[key] = value;
  button.addEventListener("click", onClick);
  return button;
}

/** 여러 선택지 중 하나를 고르는 칩과 독립 ON/OFF 상태를 시각적으로 구분한다. */
export function toggleChip(label, pressed, onClick, disabled = false, dataset = {}) {
  return chip(label, pressed, onClick, disabled, { ...dataset, kind: "toggle" });
}
