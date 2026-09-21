/** 빌드 시 HTML과 브라우저 메뉴가 같은 목록·아이콘을 사용한다. */
const TOOLS = [
  { id: "starforce", name: "스타포스", href: "" },
  { id: "potential", name: "잠재능력", href: "potential/" },
  { id: "add-option", name: "추가옵션", href: "add-option/" },
  { id: "scroll", name: "주문서", href: "scroll/" },
  { id: "ability", name: "어빌리티", href: "ability/" },
  { id: "pet", name: "자석펫", href: "pet/" },
  { id: "soul", name: "소울", href: "soul/" },
  { id: "item-market", name: "장비 시세", href: "item-market/" },
];

export function getTools({ itemMarketEnabled = false } = {}) {
  return TOOLS.filter((tool) => itemMarketEnabled || tool.id !== "item-market");
}

export const TOOL_ITEM_ICONS = {
  potential: "tool-icons/black-cube.png",
  additional: "tool-icons/white-additional-cube.png",
  "add-option": "tool-icons/black-rebirth-flame.png",
  scroll: "tool-icons/spell-trace.png",
  ability: "tool-icons/large-boss-medal.png",
  pet: "tool-icons/wisp-wonderberry.png",
  soul: "tool-icons/soul.webp",
};

export const TOOL_VECTOR_ICONS = {
  starforce: '<path d="m12 2.8 2.78 5.63 6.22.9-4.5 4.39 1.06 6.2L12 17l-5.56 2.92 1.06-6.2L3 9.33l6.22-.9L12 2.8Z"/>',
  "item-market": '<path d="M4 7h16l-1 13H5zM8 7a4 4 0 0 1 8 0"/>',
};

/** 하위 폴더 페이지에서는 한 단계 위가 사이트 뿌리다. */
export function rootPrefix(current) {
  return current === "starforce" ? "./" : "../";
}

export function renderStaticToolNav(current, options) {
  const root = rootPrefix(current);
  return getTools(options).map((tool) => {
    const itemIconPath = TOOL_ITEM_ICONS[tool.id];
    const icon = itemIconPath
      ? `<img class="toolnav__icon toolnav__icon--item" src="${root}${itemIconPath}" alt="" draggable="false" aria-hidden="true">`
      : `<svg class="toolnav__icon toolnav__icon--${tool.id}" viewBox="0 0 24 24" aria-hidden="true">${TOOL_VECTOR_ICONS[tool.id]}</svg>`;
    const destination = tool.id === current
      ? 'aria-current="page"'
      : `href="${root}${tool.href}"`;
    return `<a class="toolnav__item" ${destination} title="${tool.name}">${icon}<span class="toolnav__label">${tool.name}</span></a>`;
  }).join("\n");
}
