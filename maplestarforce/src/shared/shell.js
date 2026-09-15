/* 도구가 늘어나면 서로 오갈 길이 있어야 한다. 페이지마다 머리말과 탐색 줄을
   따로 적지 않도록 여기서 한 번에 만든다. */

import { ITEM_MARKET_ENABLED } from "./features.js";
import { installMobileResultBar } from "./mobile-result-bar.js";

const TOOLS = [
  { id: "starforce", name: "스타포스", href: "" },
  { id: "potential", name: "잠재능력", href: "potential/" },
  { id: "add-option", name: "추가옵션", href: "add-option/" },
  { id: "scroll", name: "주문서", href: "scroll/" },
  { id: "ability", name: "어빌리티", href: "ability/" },
  { id: "pet", name: "자석펫", href: "pet/" },
  { id: "item-market", name: "장비 시세", href: "item-market/" },
].filter((tool) => ITEM_MARKET_ENABLED || tool.id !== "item-market");

const TOOLNAV_DESKTOP_QUERY = "(min-width: 1280px)";
const TOOL_PREFETCH_DELAY_MS = 120;
const prefetchedToolPages = new Set();
const prefetchedToolResources = new Set();

const TOOL_ITEM_ICONS = {
  potential: "tool-icons/black-cube.png",
  additional: "tool-icons/white-additional-cube.png",
  "add-option": "tool-icons/black-rebirth-flame.png",
  scroll: "tool-icons/spell-trace.png",
  ability: "tool-icons/large-boss-medal.png",
  pet: "tool-icons/wisp-wonderberry.png",
};

const TOOL_VECTOR_ICONS = {
  starforce: '<path d="m12 2.8 2.78 5.63 6.22.9-4.5 4.39 1.06 6.2L12 17l-5.56 2.92 1.06-6.2L3 9.33l6.22-.9L12 2.8Z"/>',
  "item-market": '<path d="M4 7h16l-1 13H5zM8 7a4 4 0 0 1 8 0"/>',
};

function toolIcon(tool, root) {
  const itemIconPath = TOOL_ITEM_ICONS[tool.id];
  if (itemIconPath) {
    const icon = document.createElement("img");
    icon.className = "toolnav__icon toolnav__icon--item";
    icon.src = `${root}${itemIconPath}`;
    icon.alt = "";
    icon.draggable = false;
    icon.setAttribute("aria-hidden", "true");
    return icon;
  }

  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.classList.add("toolnav__icon");
  icon.classList.add(`toolnav__icon--${tool.id}`);
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = TOOL_VECTOR_ICONS[tool.id] ?? TOOL_VECTOR_ICONS["item-market"];
  return icon;
}

/** 하위 폴더 페이지에서는 한 단계 위가 사이트 뿌리다. */
function rootPrefix(current) {
  return current === "starforce" ? "./" : "../";
}

function prefetchResource(url, kind) {
  if (prefetchedToolResources.has(url)) return;
  prefetchedToolResources.add(url);
  const link = document.createElement("link");
  if (kind === "module") {
    link.rel = "modulepreload";
  } else {
    link.rel = "prefetch";
    link.as = kind;
  }
  link.href = url;
  document.head.append(link);
}

async function prefetchToolPage(link) {
  const url = new URL(link.href, window.location.href).href;
  if (prefetchedToolPages.has(url)) return;
  prefetchedToolPages.add(url);
  try {
    const response = await fetch(url, {
      cache: "force-cache",
      credentials: "same-origin",
      priority: "low",
    });
    if (!response.ok) return;
    const page = new DOMParser().parseFromString(await response.text(), "text/html");
    for (const resource of page.querySelectorAll(
      'script[type="module"][src], link[rel="modulepreload"][href], link[rel="stylesheet"][href]',
    )) {
      const path = resource.getAttribute("src") ?? resource.getAttribute("href");
      if (!path) continue;
      const resourceUrl = new URL(path, url).href;
      prefetchResource(
        resourceUrl,
        resource.matches('link[rel="stylesheet"]') ? "style" : "module",
      );
    }
  } catch {
    // 선행 로드가 실패해도 원래 링크 이동은 그대로 동작한다.
  }
}

function installToolPrefetch(link) {
  let timer = 0;
  const start = () => {
    if (timer) return;
    timer = globalThis.setTimeout(() => {
      timer = 0;
      void prefetchToolPage(link);
    }, TOOL_PREFETCH_DELAY_MS);
  };
  const cancel = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = 0;
  };
  link.addEventListener("pointerenter", start);
  link.addEventListener("pointerleave", cancel);
  link.addEventListener("focus", () => void prefetchToolPage(link));
  link.addEventListener("touchstart", () => void prefetchToolPage(link), {
    passive: true,
    once: true,
  });
}

export function renderToolNav(container, current) {
  if (!container) return;
  const root = rootPrefix(current);
  container.replaceChildren(
    ...TOOLS.map((tool) => {
      const link = document.createElement("a");
      link.className = "toolnav__item";
      link.href = `${root}${tool.href}`;
      link.title = tool.name;
      link.append(
        toolIcon(tool, root),
        Object.assign(document.createElement("span"), {
          className: "toolnav__label",
          textContent: tool.name,
        }),
      );
      if (tool.id === current) {
        link.setAttribute("aria-current", "page");
        // 지금 보고 있는 곳은 눌러도 갈 데가 없다.
        link.removeAttribute("href");
      } else {
        installToolPrefetch(link);
      }
      return link;
    }),
  );
  enhanceToolNav(container);
  if (current !== "starforce") installMobileResultBar();
}

/**
 * 계산기 목록은 넓은 화면에서는 본문 바깥의 왼쪽 사이드바로 보이고,
 * 그 자리가 부족한 화면에서는 제목 옆 버튼으로 여는 서랍이 된다.
 * 스타포스의 장비 목록 서랍과 상태 및 선택자를 완전히 분리한다.
 */
function enhanceToolNav(container) {
  const page = container.closest(".page");
  const header = page?.querySelector(":scope > .page__head");
  const heading = header?.querySelector(":scope > h1");
  if (!page || !header || !heading) return;

  if (!container.id) container.id = "toolnav";

  let titleRow = header.querySelector(":scope > .page__title-row");
  if (!titleRow) {
    titleRow = document.createElement("div");
    titleRow.className = "page__title-row";
    heading.before(titleRow);
    titleRow.append(heading);
  }

  let toggle = titleRow.querySelector(":scope > .toolnav-toggle");
  if (!toggle) {
    toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "toolnav-toggle";
    toggle.setAttribute("aria-controls", container.id);
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "메뉴 열기");
    toggle.title = "메뉴";
    const icon = document.createElement("span");
    icon.className = "toolnav-toggle__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.append(
      document.createElement("span"),
      document.createElement("span"),
      document.createElement("span"),
    );
    toggle.append(icon);
    titleRow.append(toggle);
  }

  const close = document.createElement("button");
  close.type = "button";
  close.className = "toolnav__close";
  close.setAttribute("aria-label", "메뉴 닫기");
  close.append(
    Object.assign(document.createElement("strong"), { textContent: "메뉴" }),
    Object.assign(document.createElement("span"), { textContent: "×" }),
  );
  close.lastElementChild?.setAttribute("aria-hidden", "true");
  container.prepend(close);

  let backdrop = document.querySelector(".toolnav-backdrop");
  if (!backdrop) {
    backdrop = document.createElement("div");
    backdrop.className = "toolnav-backdrop";
    backdrop.setAttribute("aria-hidden", "true");
    document.body.append(backdrop);
  }

  const desktop = typeof window.matchMedia === "function"
    ? window.matchMedia(TOOLNAV_DESKTOP_QUERY)
    : { matches: true };

  const setOpen = (requestedOpen, { restoreFocus = false } = {}) => {
    const open = !desktop.matches && Boolean(requestedOpen);
    if (open) {
      // 모바일 스타포스의 장비 목록 서랍이 열려 있다면 먼저 닫는다.
      const equipmentMenu = document.querySelector("#menu[aria-expanded='true']");
      equipmentMenu?.click();
    }
    document.body.dataset.toolnavDrawer = open ? "open" : "closed";
    container.dataset.open = String(open);
    container.inert = !desktop.matches && !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "메뉴 닫기" : "메뉴 열기");
    if (open) {
      close.focus({ preventScroll: true });
    } else if (restoreFocus && !desktop.matches) {
      toggle.focus({ preventScroll: true });
    }
  };

  toggle.addEventListener("click", () => {
    setOpen(container.dataset.open !== "true", { restoreFocus: true });
  });
  close.addEventListener("click", () => setOpen(false, { restoreFocus: true }));
  backdrop.addEventListener("click", () => setOpen(false, { restoreFocus: true }));
  container.addEventListener("click", (event) => {
    if (event.target.closest?.(".toolnav__item[href]")) setOpen(false);
  });
  document.querySelector("#menu")?.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && container.dataset.open === "true") {
      setOpen(false, { restoreFocus: true });
    }
  });

  const handleLayoutChange = () => setOpen(false);
  if (typeof desktop.addEventListener === "function") {
    desktop.addEventListener("change", handleLayoutChange);
  } else if (typeof desktop.addListener === "function") {
    desktop.addListener(handleLayoutChange);
  }
  setOpen(false);
}

/** 아직 계산을 붙이지 않은 자리에 세워 두는 표지. */
export function draftNotice(lines) {
  const box = document.createElement("div");
  box.className = "draft";
  box.append(
    ...lines.map((line) => {
      const p = document.createElement("p");
      p.className = "draft__line";
      p.textContent = line;
      return p;
    }),
  );
  return box;
}

export { TOOLS };
