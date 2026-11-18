import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { startCalculator } from "../src/shared/calculator-startup.js";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test("shared storage restoration precedes every calculator and feature dependency", async () => {
  const restored = deferred();
  const calls = [];
  const run = startCalculator({
    initialize: () => restored.promise,
    loadCalculator: async () => { calls.push("calculator"); return "adapter"; },
    features: [{ name: "optional", load: async () => { calls.push("feature"); return "module"; },
      install(module, calculator, status) { assert.equal(module, "module"); assert.equal(calculator, "adapter"); assert.equal(status.shared, true); } }],
  });
  await Promise.resolve();
  assert.deepEqual(calls, []);
  restored.resolve({ shared: true });
  await run;
  assert.deepEqual(calls.sort(), ["calculator", "feature"]);
});

test("a hanging inbox never delays readiness or the independent copy feature", async () => {
  const inbox = deferred();
  const calls = [];
  const run = startCalculator({
    initialize: async () => ({ shared: false }), loadCalculator: async () => ({}),
    onReady: () => calls.push("ready"),
    features: [
      { name: "text", load: async () => ({}), install: () => calls.push("text") },
      { name: "inbox", load: () => inbox.promise, install: () => calls.push("inbox") },
    ],
  });
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(calls, ["ready", "text"]);
  inbox.resolve({}); await run;
  assert.deepEqual(calls, ["ready", "text", "inbox"]);
});

test("optional download and installation failures are isolated and reported", async () => {
  const errors = [];
  let ready = false, text = false;
  await startCalculator({
    initialize: async () => ({}), loadCalculator: async () => ({}), onReady: () => { ready = true; },
    features: [
      { name: "download", load: async () => { throw Error("offline"); } },
      { name: "install", load: async () => ({}), install: () => { throw Error("install failed"); } },
      { name: "text", load: async () => ({}), install: () => { text = true; } },
    ], onError: (error, name) => errors.push([name, error.message]),
  });
  assert.equal(ready && text, true);
  assert.deepEqual(errors, [["download", "offline"], ["install", "install failed"]]);
});

test("core failure propagates to recovery without installing features on a broken adapter", async () => {
  let installed = false;
  await assert.rejects(startCalculator({
    initialize: async () => ({}), loadCalculator: async () => { throw Error("core failed"); },
    features: [{ load: async () => { throw Error("also offline"); }, install: () => { installed = true; } }],
  }), /core failed/u);
  await new Promise((done) => setImmediate(done));
  assert.equal(installed, false);
});

test("entry download failure and slow loading offer recovery without touching stored data", async () => {
  const source = await readFile(new URL("../src/shared/calculator-startup-recovery.js", import.meta.url), "utf8");
  const listeners = {}, timers = [];
  const message = {}, retry = {};
  const box = { hidden: true, querySelector: (tag) => tag === "span" ? message : retry };
  let reloads = 0;
  const context = {
    window: { addEventListener: (name, listener) => { listeners[name] = listener; } },
    document: {
      getElementById: () => box,
      querySelectorAll: () => [],
      addEventListener: (name, listener) => { listeners[name] = listener; },
    },
    location: { reload: () => { reloads += 1; } },
    setTimeout: (callback) => { timers.push(callback); return timers.length; }, clearTimeout: () => {},
  };
  Object.defineProperty(context, "localStorage", { get() { throw Error("must not access storage"); } });
  runInNewContext(source, context);
  listeners.error({ target: { tagName: "SCRIPT", src: "https://example.com/assets/calculator-entry-stale.js" } });
  assert.equal(box.hidden, false);
  assert.match(message.textContent, /불러오지 못했습니다/u);
  retry.onclick(); assert.equal(reloads, 1);
  listeners.DOMContentLoaded(); timers[0]();
  assert.match(message.textContent, /시간이 걸리고/u);
  context.window.calculatorStartup.finish();
  assert.equal(box.hidden, true);
  context.window.calculatorStartup.fail("선택 기능 오류", "inbox");
  context.window.calculatorStartup.finish();
  assert.equal(box.hidden, false);
  context.window.calculatorStartup.clear("inbox");
  assert.equal(box.hidden, true);
});
