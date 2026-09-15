export function createDeleteTargetAnchor(container, viewport = window) {
  let retainedHeight = 0;
  let revision = 0;

  function retain(anchor) {
    const measuredHeight = Math.ceil(container.getBoundingClientRect().height);
    retainedHeight = Math.max(retainedHeight, measuredHeight);
    container.style.minHeight = `${retainedHeight}px`;
    revision += 1;
    return {
      revision,
      top: anchor.getBoundingClientRect().top,
    };
  }

  function align(snapshot, target) {
    if (!snapshot || !target || snapshot.revision !== revision || !retainedHeight) {
      return false;
    }
    const delta = target.getBoundingClientRect().top - snapshot.top;
    if (Math.abs(delta) > 0.5) viewport.scrollBy(0, delta);
    target.focus?.({ preventScroll: true });
    return true;
  }

  function release() {
    if (!retainedHeight) return;
    retainedHeight = 0;
    revision += 1;
    container.style.removeProperty("min-height");
  }

  return {
    align,
    get active() {
      return retainedHeight > 0;
    },
    release,
    retain,
  };
}
