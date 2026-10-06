export function installStorageReset({ root = document, scope = globalThis } = {}) {
  const button = root.querySelector("#site-storage-reset");
  const status = root.querySelector("#site-storage-reset-status");
  if (!button || !status) return null;

  button.addEventListener("click", () => {
    const shared = /^#share(?:=|$)/u.test(scope.location.hash);
    const message = "이 사이트의 저장된 계산 설정·캐릭터 정보·테마와 현재 탭의 장비 목록을 모두 삭제합니다."
      + (shared ? "\n공유 링크의 설정도 해제됩니다." : "")
      + "\n삭제한 설정은 되돌릴 수 없습니다. 전체 초기화할까요?";
    if (!scope.confirm(message)) return;

    button.disabled = true;
    status.textContent = "";
    let failed = false;
    // Clear native storage, including keys outside the calculator namespace.
    // Try both independently, even if one storage getter is blocked.
    for (const name of ["localStorage", "sessionStorage"]) {
      try { scope[name].clear(); } catch { failed = true; }
    }
    if (failed) {
      status.textContent = "전체 초기화를 완료하지 못했습니다. 브라우저 설정에서 이 사이트의 데이터를 삭제해 주세요.";
      button.disabled = false;
      return;
    }

    try {
      if (shared) {
        const url = new URL(scope.location.href);
        url.hash = "";
        // replaceState avoids the calculator's hashchange reload handler.
        scope.history.replaceState(null, "", url.href);
      }
      // Reload discards in-memory calculator state and restores the default theme.
      scope.location.reload();
    } catch {
      status.textContent = "저장 데이터를 초기화했습니다. 페이지를 새로고침해 주세요.";
      button.disabled = false;
    }
  });

  return button;
}

if (typeof document !== "undefined") installStorageReset();
