import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { installGoogleConsentSettings } from "../src/shared/privacy-controls.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

function consentFixture() {
  const listeners = new Map();
  const button = {
    disabled: false,
    addEventListener: (type, listener) => listeners.set(type, listener),
  };
  const status = { dataset: {}, textContent: "" };
  const fallback = { hidden: true };
  const elements = new Map([
    ["#google-consent-settings", button],
    ["#google-consent-status", status],
    ["#google-consent-fallback", fallback],
  ]);
  return {
    button,
    status,
    fallback,
    listeners,
    root: { querySelector: (selector) => elements.get(selector) ?? null },
  };
}

test("공통 푸터는 항상 보이는 Google 광고 동의 변경 제어와 실패 경로를 제공한다", async () => {
  const [footer, controls, styles] = await Promise.all([
    read("../partials/site-footer.html"),
    read("../src/shared/privacy-controls.js"),
    read("../src/style.css"),
  ]);
  assert.match(footer, /id="google-consent-settings"/u);
  assert.doesNotMatch(footer, /google-consent-settings[^>]+hidden/u);
  assert.match(footer, /aria-describedby="google-consent-status google-consent-fallback"/u);
  assert.match(footer, /광고 코드가 있는 계산기 페이지에서 다시 시도/u);
  assert.match(footer, /myadcenter\.google\.com/u);
  assert.match(footer, /src="\/src\/shared\/privacy-controls\.js"/u);
  assert.match(controls, /callbackQueue\.push\(\{ CONSENT_API_READY: markReady \}\)/u);
  assert.match(controls, /googlefc\.showRevocationMessage\(\)/u);
  assert.match(controls, /fallback\.hidden = false/u);
  assert.match(styles, /\.site-footer__privacy-button:focus-visible/u);
});

test("Google 동의 제어는 준비된 CallbackQueue 객체를 보존하고 철회 API를 호출한다", async () => {
  const fixture = consentFixture();
  const callbacks = [];
  const callbackQueue = { push: (callback) => callbacks.push(callback) };
  let calls = 0;
  const scope = {
    googlefc: {
      callbackQueue,
      showRevocationMessage: () => { calls += 1; },
    },
    setTimeout,
  };
  installGoogleConsentSettings({ root: fixture.root, scope, timeoutMs: 0 });
  assert.equal(scope.googlefc.callbackQueue, callbackQueue);
  assert.equal(callbacks.length, 1);
  assert.equal(typeof callbacks[0].CONSENT_API_READY, "function");
  await fixture.listeners.get("click")();
  assert.equal(calls, 1);
  assert.equal(fixture.button.disabled, false);
  assert.equal(fixture.fallback.hidden, true);
  assert.equal(fixture.status.dataset.state, "requested");
});

test("Google 동의 API가 없거나 호출에 실패하면 복구 안내를 표시하고 늦은 준비 신호도 처리한다", async () => {
  for (const showRevocationMessage of [undefined, () => { throw new Error("blocked"); }]) {
    const fixture = consentFixture();
    const callbacks = [];
    const scope = {
      googlefc: {
        callbackQueue: { push: (callback) => callbacks.push(callback) },
        ...(showRevocationMessage ? { showRevocationMessage } : {}),
      },
      setTimeout: (callback) => { callback(); return 1; },
    };
    installGoogleConsentSettings({ root: fixture.root, scope, timeoutMs: 0 });
    await fixture.listeners.get("click")();
    assert.equal(fixture.fallback.hidden, false);
    assert.equal(fixture.button.disabled, false);
    assert.equal(fixture.status.dataset.state, "unavailable");
    callbacks[0].CONSENT_API_READY();
    assert.equal(fixture.fallback.hidden, true);
    assert.equal(fixture.status.textContent, "");
  }
});

test("계산기 저장은 신뢰할 수 있는 계산기 조작 전까지 영구 저장을 활성화하지 않는다", async () => {
  const entry = await read("../src/shared/calculator-entry.js");
  assert.match(entry, /event\.isTrusted === false/u);
  for (const event of ["pointerdown", "keydown", "click", "input", "change"]) {
    assert.ok(entry.includes(`"${event}"`));
  }
  assert.match(entry, /enableCalculatorStoragePersistence\(\)/u);
  assert.match(entry, /\.site-footer, \.calculator-guide, \.toolnav, \.page__head/u);
  assert.ok(entry.indexOf("installCalculatorStorageActivation();") < entry.indexOf("void start();"));
});

test("개인정보처리방침은 실제 저장 시점·처리 근거·국외 처리·권리·철회 방법을 설명한다", async () => {
  const policy = await read("../privacy/index.html");
  for (const phrase of [
    "2026년 9월 28일",
    "계산기 페이지를 보기만 할 때에는",
    "처리 목적",
    "국외 처리",
    "처리 제한",
    "처리 반대",
    "데이터 이동",
    "감독기관에 불만",
    "Google 광고 개인정보 설정",
  ]) assert.match(policy, new RegExp(phrase, "u"));
});
