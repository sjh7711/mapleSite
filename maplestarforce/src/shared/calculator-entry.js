import { initializeResultShare } from "./result-share-state.js";
import { installResultShare } from "./result-share-ui.js";
import "./result-share.css";

const entries = {
  starforce: () => import("../main.js"),
  potential: () => import("../pages/potential.js"),
  additional: () => import("../pages/additional.js"),
  ability: () => import("../pages/ability.js"),
  "add-option": () => import("../pages/add-option.js"),
  scroll: () => import("../pages/scroll.js"),
  pet: () => import("../pages/pet.js"),
  soul: () => import("../pages/soul.js"),
};

async function start() {
  const tool = document.querySelector("[data-calculator]")?.dataset.calculator;
  if (!Object.hasOwn(entries, tool)) return;
  const status = await initializeResultShare(tool);
  try {
    // Character profiles read storage at module initialization, so restore the
    // isolated snapshot before importing any calculator or its dependencies.
    await entries[tool]();
  } catch (error) {
    if (!status.shared) throw error;
    status.error = "공유된 설정으로 계산할 수 없습니다. 새 공유 링크를 만들어 주세요.";
    console.error(error);
  }
  installResultShare(tool, status);
  const hash = location.hash;
  window.addEventListener("hashchange", () => {
    if (location.hash !== hash && (status.shared || location.hash.startsWith("#share="))) location.reload();
  });
}

void start();
