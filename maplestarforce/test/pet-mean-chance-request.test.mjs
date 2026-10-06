import assert from "node:assert/strict";
import test from "node:test";
import { createPetMeanChanceRequest } from "../src/shared/pet-mean-chance-request.js";

test("pet mean worker ignores obsolete prices, caches results and recovers from errors", () => {
  const original = globalThis.Worker;
  const workers = [];
  class Worker {
    constructor() { workers.push(this); }
    postMessage(data) { this.request = data; }
    terminate() { this.stopped = true; }
    reply(result) { this.onmessage({ data: { key: this.request.key, result } }); }
  }
  globalThis.Worker = Worker;
  try {
    let notified = 0;
    const calculator = createPetMeanChanceRequest(() => notified++);
    assert.equal(calculator.request({ targetCount: 1, price: 20 }), null);
    const old = workers[0];
    calculator.request({ targetCount: 2, price: 30 });
    assert.equal(old.stopped, true);
    old.reply({ chance: .1 });
    assert.equal(notified, 0);
    workers[1].reply({ chance: .597, method: "exact" });
    assert.equal(notified, 1);
    assert.equal(calculator.request({ price: 30, targetCount: 2 }).chance, .597);
    assert.equal(workers.length, 2);
    calculator.request({ targetCount: 3 });
    workers[2].onerror({ message: "test failure", preventDefault() {} });
    assert.equal(calculator.request({ targetCount: 3 }).error, "test failure");
    calculator.request({ targetCount: 1 });
    calculator.stop();
    workers[3].reply({ chance: .63 });
    assert.equal(notified, 2);
  } finally { globalThis.Worker = original; }
});
