import {
  enableCalculatorStoragePersistence,
  initializeResultShare,
} from "./result-share-state.js";
import { installResultShare } from "./result-share-ui.js";
import "./result-share.css";
import { startCalculator } from "./calculator-startup.js";

const entries = {
  starforce: () => import("../main.js"),
  potential: () => import("../pages/potential.js"),
  additional: () => import("../pages/additional.js"),
  ability: () => import("../pages/ability.js"),
  "add-option": () => import("../pages/add-option.js"),
  scroll: () => import("../pages/scroll.js"),
  pet: () => import("../pages/pet.js"),
  soul: () => import("../pages/soul.js"),
  "hexa-stat": () => import("../pages/hexa-stat.js"),
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
    if (control.closest(".site-footer, .calculator-guide, .toolnav, .page__head, .calculator-startup-error")) return;
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
  const textTransfer = tool === "starforce" && import.meta.env.VITE_STARFORCE_TEXT_TRANSFER_ENABLED === "true";
  const inbox = tool === "starforce" && import.meta.env.VITE_STARFORCE_INBOX_ENABLED === "true";
  const features = [];
  if (textTransfer) features.push({
    name: "장비목록 복사·붙여넣기",
    load: () => import("./starforce-equipment-text-ui.js"),
    install: (module, calculator, status) => {
      const transfer = module.installEquipmentTextTransfer(calculator.equipmentTextTransfer);
      installResultShare(tool, status, transfer);
    },
  });
  if (inbox) features.push({
    name: "대장장이 예약",
    load: () => import("./blacksmith-inbox-ui.js"),
    install: (module, calculator) => module.installBlacksmithInbox(calculator.blacksmithInbox),
  });
  await startCalculator({
    initialize: () => initializeResultShare(tool),
    loadCalculator: entries[tool],
    features,
    onReady: (calculator, status) => {
      window.calculatorStartup?.finish();
      if (!textTransfer) installResultShare(tool, status);
      const hash = location.hash;
      window.addEventListener("hashchange", () => {
        if (location.hash !== hash && (status.shared || location.hash.startsWith("#share="))) location.reload();
      });
    },
    onError: (error, feature) => {
      console.error(`${feature} 초기화 실패`, error);
      window.calculatorStartup?.fail(`${feature} 기능을 불러오지 못했습니다. 다시 시도해 주세요.`, feature);
    },
  });
}

void start().catch((error) => {
  console.error("계산기 초기화 실패", error);
  window.calculatorStartup?.fail("계산기를 불러오지 못했습니다. 연결 상태를 확인한 후 다시 시도해 주세요.");
});
