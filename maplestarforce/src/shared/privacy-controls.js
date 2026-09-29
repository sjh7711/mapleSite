export function installGoogleConsentSettings({
  root = document,
  scope = globalThis,
  timeoutMs = 3000,
} = {}) {
  const button = root.querySelector("#google-consent-settings");
  const status = root.querySelector("#google-consent-status");
  const fallback = root.querySelector("#google-consent-fallback");
  if (!button || !status || !fallback) return null;

  const googlefc = scope.googlefc = scope.googlefc || {};
  if (!googlefc.callbackQueue || typeof googlefc.callbackQueue.push !== "function") {
    googlefc.callbackQueue = [];
  }

  let resolveReady;
  const ready = new Promise((resolve) => { resolveReady = resolve; });
  const markReady = () => {
    resolveReady();
    fallback.hidden = true;
    if (status.dataset.state === "unavailable") status.textContent = "";
  };
  googlefc.callbackQueue.push({ CONSENT_API_READY: markReady });
  if (typeof googlefc.showRevocationMessage === "function") markReady();

  const waitForConsentApi = async () => {
    if (typeof scope.googlefc?.showRevocationMessage === "function") return true;
    await Promise.race([
      ready,
      new Promise((resolve) => scope.setTimeout(resolve, timeoutMs)),
    ]);
    return typeof scope.googlefc?.showRevocationMessage === "function";
  };

  button.addEventListener("click", async () => {
    button.disabled = true;
    fallback.hidden = true;
    status.dataset.state = "loading";
    status.textContent = "Google 동의 설정을 불러오는 중입니다.";

    if (await waitForConsentApi()) {
      try {
        scope.googlefc.showRevocationMessage();
        status.dataset.state = "requested";
        status.textContent = "Google에 개인정보 설정 창 표시를 요청했습니다.";
        button.disabled = false;
        return;
      } catch {
        // Fall through to the visible recovery instructions below.
      }
    }

    status.dataset.state = "unavailable";
    status.textContent = "";
    fallback.hidden = false;
    button.disabled = false;
  });

  return { markReady };
}

if (typeof document !== "undefined") installGoogleConsentSettings();
