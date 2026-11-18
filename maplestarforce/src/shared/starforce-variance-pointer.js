// A touch selection stays visible after the finger lifts. Only one chart per
// document owns an outside-tap listener, including across chart redraws.
const selections = new WeakMap();
function release(surface) {
  const doc = surface.ownerDocument, selected = selections.get(doc);
  if (selected?.surface !== surface) return;
  doc.removeEventListener("pointerdown", selected.outside, true);
  selections.delete(doc);
}

export function bindVariancePointer(surface, pointer, hide) {
  let pointerType = "";
  const dismiss = () => { release(surface); hide(); };
  const down = (event) => {
    pointerType = event.pointerType;
    if (pointerType === "touch" || pointerType === "pen") {
      const doc = surface.ownerDocument, previous = selections.get(doc);
      if (previous?.surface !== surface) previous?.dismiss();
      release(surface);
      const outside = (next) => { if (!surface.isConnected || !surface.contains(next.target)) dismiss(); };
      selections.set(doc, { surface, outside, dismiss });
      doc.addEventListener("pointerdown", outside, true);
    }
    pointer(event);
  };
  const leave = (event) => { if (event.pointerType !== "touch" && event.pointerType !== "pen") dismiss(); };
  const context = (event) => {
    if (pointerType === "touch" || pointerType === "pen") event.preventDefault();
  };
  surface.addEventListener("pointerdown", down);
  surface.addEventListener("pointermove", pointer);
  surface.addEventListener("pointerleave", leave);
  surface.addEventListener("pointercancel", dismiss);
  surface.addEventListener("blur", dismiss);
  surface.addEventListener("contextmenu", context);
  return () => {
    dismiss();
    for (const [type, listener] of [["pointerdown", down], ["pointermove", pointer], ["pointerleave", leave],
      ["pointercancel", dismiss], ["blur", dismiss], ["contextmenu", context]]) surface.removeEventListener(type, listener);
  };
}
