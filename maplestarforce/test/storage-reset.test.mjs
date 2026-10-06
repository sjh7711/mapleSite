import assert from "node:assert/strict";
import test from "node:test";
import { installStorageReset } from "../src/shared/storage-reset.js";

function fixture({ accepted = true, hash = "#data-deletion" } = {}) {
  const listeners = new Map();
  const button = { disabled: false, addEventListener: (type, handler) => listeners.set(type, handler) };
  const status = { textContent: "" };
  const local = new Map([["maplestarforce:theme:v1", "light"], ["other-key", "local-value"]]);
  const session = new Map([["maplestarforce:items:v1", "saved-items"], ["other-key", "session-value"]]);
  const calls = [];
  const url = new URL(`https://starforce.pages.dev/potential/?system=additional${hash}`);
  const scope = {
    confirm(message) { calls.push(["confirm", message]); return accepted; },
    localStorage: { clear() { calls.push(["local"]); local.clear(); } },
    sessionStorage: { clear() { calls.push(["session"]); session.clear(); } },
    location: {
      get href() { return url.href; },
      get hash() { return url.hash; },
      reload() { calls.push(["reload"]); },
    },
    history: { replaceState(_state, _title, href) { calls.push(["replace", href]); url.href = href; } },
  };
  const elements = new Map([["#site-storage-reset", button], ["#site-storage-reset-status", status]]);
  installStorageReset({ root: { querySelector: (selector) => elements.get(selector) }, scope });
  return { click: () => listeners.get("click")(), button, status, local, session, calls, scope, url };
}

test("취소하면 두 저장소와 공유 링크를 유지하고 새로고침하지 않는다", () => {
  const f = fixture({ accepted: false, hash: "#share=v2.example" });
  f.click();
  assert.equal(f.local.size, 2);
  assert.equal(f.session.size, 2);
  assert.equal(f.url.hash, "#share=v2.example");
  assert.deepEqual(f.calls.map(([name]) => name), ["confirm"]);
  assert.equal(f.button.disabled, false);
});

test("확인하면 접두사에 관계없이 두 저장소의 모든 키를 삭제한 뒤 새로고침한다", () => {
  const f = fixture();
  f.click();
  assert.equal(f.local.size, 0);
  assert.equal(f.session.size, 0);
  assert.deepEqual(f.calls.map(([name]) => name), ["confirm", "local", "session", "reload"]);
  assert.equal(f.url.hash, "#data-deletion");
  assert.equal(f.button.disabled, true);
});

test("공유 링크의 설정이 다시 적용되지 않도록 공유 해시를 제거하고 새로고침한다", () => {
  for (const hash of ["#share=v2.example", "#share=invalid", "#share"]) {
    const f = fixture({ hash });
    f.click();
    assert.equal(f.url.href, "https://starforce.pages.dev/potential/?system=additional");
    assert.match(f.calls[0][1], /공유 링크의 설정도 해제/u);
    assert.deepEqual(f.calls.map(([name]) => name), ["confirm", "local", "session", "replace", "reload"]);
    assert.equal(f.local.size, 0);
    assert.equal(f.session.size, 0);
  }
});

test("한 저장소의 접근·삭제가 실패해도 다른 저장소를 비우고 실패 사실을 알린다", () => {
  for (const blocked of ["localStorage", "sessionStorage"]) {
    for (const getterFails of [true, false]) {
      const f = fixture();
      const fail = () => { throw new Error("storage blocked"); };
      if (getterFails) Object.defineProperty(f.scope, blocked, { get: fail });
      else f.scope[blocked].clear = fail;
      f.click();
      const remaining = blocked === "localStorage" ? f.local : f.session;
      const cleared = blocked === "localStorage" ? f.session : f.local;
      assert.equal(remaining.size, 2);
      assert.equal(cleared.size, 0);
      assert.ok(!f.calls.some(([name]) => name === "reload"));
      assert.match(f.status.textContent, /전체 초기화를 완료하지 못했습니다/u);
      assert.equal(f.button.disabled, false);
    }
  }
});
