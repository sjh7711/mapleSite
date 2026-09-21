// head에서 실행해 저장된 테마를 첫 화면을 그리기 전에 적용한다.
(() => {
  const storageKey = "maplestarforce:theme:v1";
  const root = document.documentElement;
  const normalize = (value) => value === "light" ? "light" : "dark";

  function applyTheme(value) {
    const theme = normalize(value);
    root.dataset.theme = theme;
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.setAttribute("aria-checked", String(theme === "dark"));
      button.title = theme === "dark" ? "라이트모드로 전환" : "다크모드로 전환";
      button.hidden = false;
    });
  }

  let initial = "dark";
  try {
    initial = localStorage.getItem(storageKey);
  } catch {
    // 저장소가 차단되어도 기본 테마와 현재 페이지의 전환은 사용할 수 있다.
  }
  applyTheme(initial);

  document.addEventListener("DOMContentLoaded", () => {
    applyTheme(root.dataset.theme);
    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const next = root.dataset.theme === "dark" ? "light" : "dark";
        applyTheme(next);
        try {
          localStorage.setItem(storageKey, next);
        } catch {
          // 저장 실패가 계산기 사용이나 테마 전환을 막지 않게 한다.
        }
      });
    });
  }, { once: true });

  window.addEventListener("storage", (event) => {
    if (event.key === storageKey || event.key === null) applyTheme(event.newValue);
  });
})();
