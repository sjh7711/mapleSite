import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../src/shared/theme.js", import.meta.url), "utf8");
const key = "maplestarforce:theme:v1";

function browser({ saved = null, blocked = false } = {}) {
  const root = { dataset: {} };
  const events = {};
  const attributes = {};
  const button = {
    hidden: true,
    setAttribute(name, value) { attributes[name] = value; },
    addEventListener(name, callback) { events[name] = callback; },
  };
  const storage = new Map(saved === null ? [] : [[key, saved]]);
  vm.runInNewContext(source, {
    document: {
      documentElement: root,
      querySelectorAll: () => events.DOMContentLoaded ? [button] : [],
      addEventListener(name, callback) { events[name] = callback; },
    },
    window: { addEventListener(name, callback) { events[name] = callback; } },
    localStorage: {
      getItem(name) { if (blocked) throw new Error("denied"); return storage.get(name) ?? null; },
      setItem(name, value) { if (blocked) throw new Error("denied"); storage.set(name, value); },
    },
  });
  return { root, events, attributes, button, storage };
}

test("첫 방문은 다크모드이며 저장된 테마는 DOM 준비 전부터 적용한다", () => {
  assert.equal(browser().root.dataset.theme, "dark");
  assert.equal(browser({ saved: "light" }).root.dataset.theme, "light");
  assert.equal(browser({ saved: "invalid" }).root.dataset.theme, "dark");
});

test("전환한 테마와 접근성 상태를 저장하고 다음 방문에서도 복원한다", () => {
  const page = browser();
  page.events.DOMContentLoaded();
  assert.equal(page.button.hidden, false);
  assert.equal(page.attributes["aria-checked"], "true");
  page.events.click();
  assert.equal(page.root.dataset.theme, "light");
  assert.equal(page.attributes["aria-checked"], "false");
  assert.equal(page.button.title, "다크모드로 전환");
  assert.equal(browser({ saved: page.storage.get(key) }).root.dataset.theme, "light");
  page.events.click();
  assert.equal(page.storage.get(key), "dark");
});

test("저장소가 차단되어도 테마 전환은 동작한다", () => {
  const page = browser({ blocked: true });
  page.events.DOMContentLoaded();
  page.events.click();
  assert.equal(page.root.dataset.theme, "light");
});

test("다른 탭의 테마 변경과 저장값 초기화를 반영한다", () => {
  const page = browser();
  page.events.DOMContentLoaded();
  page.events.storage({ key, newValue: "light" });
  assert.equal(page.root.dataset.theme, "light");
  page.events.storage({ key: "calculator-state", newValue: null });
  assert.equal(page.root.dataset.theme, "light");
  page.events.storage({ key: null, newValue: null });
  assert.equal(page.root.dataset.theme, "dark");
});
