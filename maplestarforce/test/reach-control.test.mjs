import assert from "node:assert/strict";
import test from "node:test";
import { createReachChanceControl } from "../src/shared/reach-control.js";

class Element extends EventTarget {
  constructor(tag) { super(); this.tag = tag; this.children = []; this.dataset = {}; }
  append(...children) { this.children.push(...children); }
  setAttribute() {}
}
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }

test("mean endpoints remain exact; moving the slider selects a finite manual quantile", () => {
  const original = globalThis.document;
  globalThis.document = { createElement: (tag) => new Element(tag) };
  try {
    let selected;
    const control = createReachChanceControl({ id: "test", value: 63.21, min: .01, max: 99.99,
      average: true, averageValue: 100,
      onChange: (value, { average }) => { selected = { value, average }; } });
    const nodes = descendants(control);
    const range = nodes.find((n) => n.type === "range");
    const number = nodes.find((n) => n.type === "number");
    const reset = nodes.find((n) => n.textContent === "평균으로 보기");
    assert.deepEqual(selected, { value: 100, average: true });
    assert.equal(number.value, "100");
    range.value = "100";
    range.dispatchEvent(new Event("input"));
    assert.deepEqual(selected, { value: 99.99, average: false });
    reset.dispatchEvent(new Event("click"));
    assert.deepEqual(selected, { value: 100, average: true });
    range.value = "0";
    range.dispatchEvent(new Event("input"));
    assert.deepEqual(selected, { value: .01, average: false });
    const pending = createReachChanceControl({ id: "pending", value: 63.21, min: .01, max: 99.99,
      average: true, averageValue: null });
    assert.equal(descendants(pending).find((n) => n.type === "number").value, "");
    assert.equal(descendants(pending).find((n) => n.type === "range").disabled, true);
  } finally { globalThis.document = original; }
});
