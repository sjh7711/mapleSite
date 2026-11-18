// Inlined in calculator HTML so recovery also works when the entry module
// itself cannot download. Nothing is written to calculator or inbox storage.
(() => {
  let timer;
  const notices = new Map();
  function render() {
    const box = document.getElementById("calculator-startup-error");
    if (!box) return;
    box.hidden = notices.size === 0;
    box.querySelector("span").textContent = [...notices.values()].join(" ");
    box.querySelector("button").onclick = () => location.reload();
  }
  const startup = {
    ready: false,
    fail(message, feature = "calculator") {
      notices.set(feature, message);
      render();
    },
    clear(feature) { notices.delete(feature); render(); },
    finish() {
      this.ready = true;
      clearTimeout(timer);
      notices.delete("calculator");
      document.querySelectorAll("[data-startup-placeholder]").forEach((node) => node.remove());
      document.querySelectorAll("[data-startup-control]").forEach((node) => {
        node.removeAttribute("inert"); node.removeAttribute("aria-hidden");
        node.removeAttribute("data-startup-control");
      });
      render();
    },
  };
  window.calculatorStartup = startup;
  window.addEventListener("error", (event) => {
    if (event.target?.tagName === "SCRIPT" && (event.target.id === "calculator-entry"
      || /\/calculator-entry(?:-[^/]+)?\.js(?:\?|$)/u.test(event.target.src))) {
      startup.fail("계산기를 불러오지 못했습니다. 연결 상태를 확인한 후 다시 시도해 주세요.");
    }
  }, true);
  document.addEventListener("DOMContentLoaded", () => {
    render();
    if (!startup.ready) timer = setTimeout(() => {
      if (!startup.ready) startup.fail("계산기를 불러오는 데 시간이 걸리고 있습니다. 연결 상태를 확인하거나 다시 시도해 주세요.");
    }, 15000);
  });
})();
