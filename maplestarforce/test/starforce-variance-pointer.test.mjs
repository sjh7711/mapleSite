import test from "node:test";
import assert from "node:assert/strict";
import { bindVariancePointer } from "../src/shared/starforce-variance-pointer.js";

function event(type, pointerType = "touch", target) {
  const value = new Event(type, { cancelable: true });
  Object.assign(value, { pointerType, clientX: 120, clientY: 80 });
  if (target) Object.defineProperty(value, "target", { value: target });
  return value;
}
function chart(doc = new EventTarget()) {
  const surface = new EventTarget();
  Object.assign(surface, { ownerDocument: doc, isConnected: true, contains: node => node === surface });
  let visible = false, updates = 0;
  const destroy = bindVariancePointer(surface, () => { visible = true; updates++; }, () => { visible = false; });
  return { doc, surface, destroy, get visible() { return visible; }, get updates() { return updates; } };
}

test("a short touch remains selected after pointerup and pointerleave, and another tap or drag updates it", () => {
  const c = chart();
  const down = event("pointerdown"); c.surface.dispatchEvent(down);
  assert.equal(down.defaultPrevented, false, "native vertical scroll and pinch remain available");
  c.surface.dispatchEvent(event("pointerup")); c.surface.dispatchEvent(event("pointerleave"));
  assert.equal(c.visible, true);
  c.surface.dispatchEvent(event("pointerdown")); c.surface.dispatchEvent(event("pointermove"));
  assert.equal(c.updates, 3); assert.equal(c.visible, true);
  c.doc.dispatchEvent(event("pointerdown", "touch", c.surface)); assert.equal(c.visible, true);
  c.doc.dispatchEvent(event("pointerdown")); assert.equal(c.visible, false);
  c.destroy();
});
test("touch context menus are suppressed while desktop hover and right-click behavior remain available", () => {
  const c = chart();
  c.surface.dispatchEvent(event("pointerdown"));
  const touchMenu = event("contextmenu"); c.surface.dispatchEvent(touchMenu);
  assert.equal(touchMenu.defaultPrevented, true);
  c.surface.dispatchEvent(event("pointerdown", "mouse"));
  const mouseMenu = event("contextmenu", "mouse"); c.surface.dispatchEvent(mouseMenu);
  assert.equal(mouseMenu.defaultPrevented, false);
  c.surface.dispatchEvent(event("pointermove", "mouse")); assert.equal(c.visible, true);
  c.surface.dispatchEvent(event("pointerleave", "mouse")); assert.equal(c.visible, false);
  c.destroy();
});
test("scroll cancellation, focus loss and disposal dismiss the touch selection", () => {
  const c = chart();
  for (const type of ["pointercancel", "blur"]) {
    c.surface.dispatchEvent(event("pointerdown")); assert.equal(c.visible, true);
    c.surface.dispatchEvent(event(type)); assert.equal(c.visible, false);
  }
  c.surface.dispatchEvent(event("pointerdown")); c.destroy(); assert.equal(c.visible, false);
  const updates = c.updates;
  c.surface.dispatchEvent(event("pointermove")); assert.equal(c.updates, updates);
});
test("a new chart dismisses the old touch selection even when a redraw detached its surface", () => {
  const a = chart(), b = chart(a.doc);
  a.surface.dispatchEvent(event("pointerdown")); a.surface.isConnected = false;
  b.surface.dispatchEvent(event("pointerdown"));
  assert.equal(a.visible, false); assert.equal(b.visible, true);
  a.destroy(); assert.equal(b.visible, true, "disposing an old chart does not clear the current selection");
  b.doc.dispatchEvent(event("pointerdown")); assert.equal(b.visible, false);
  b.destroy();
});
