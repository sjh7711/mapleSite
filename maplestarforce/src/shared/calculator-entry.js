import {
  enableCalculatorStoragePersistence,
  initializeResultShare,
} from "./result-share-state.js";
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

// Calculators may render and normalize defaults on import. Keep those writes in
// memory until a real visitor operates a calculator control; page view alone
// must not create or replace local/session storage entries.
function installCalculatorStorageActivation() {
  const page = document.querySelector("[data-calculator]");
  if (!page) return;
  const events = ["pointerdown", "keydown", "click", "input", "change"];
  const cleanup = () => {
    for (const type of events) document.removeEventListener(type, activate, true);
  };
  const activate = (event) => {
    if (event.isTrusted === false || !(event.target instanceof Element)) return;
    const control = event.target.closest(
      'input, select, textarea, button, [role="button"], [contenteditable="true"]',
    );
    if (!control || !page.contains(control)) return;
    if (control.closest(".site-footer, .calculator-guide, .toolnav, .page__head")) return;
    enableCalculatorStoragePersistence();
    cleanup();
  };
  for (const type of events) {
    document.addEventListener(type, activate, { capture: true, passive: true });
  }
}

installCalculatorStorageActivation();

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
