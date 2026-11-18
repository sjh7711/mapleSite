// A received request is a separate workspace. Persistent calculator slots always
// point at home while it is active, including during autosave and page reload.
export function createBlacksmithWorkspace(state, prepareItems, render) {
  let home = null, current = null;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const snapshot = () => ({ slots: state.slots, characterSources: state.characterSources, slot: state.slot });
  function saveDraft() { if (current) current.save(clone(state.items)); }
  return {
    savedSlots: () => home ?? snapshot(),
    saveDraft,
    active: () => current?.id ?? null,
    open(id, items, draft, save) {
      saveDraft();
      home ??= snapshot();
      current = { id, save };
      state.slots = [draft ? clone(draft) : prepareItems(items), [], []];
      state.characterSources = Array.from({ length: 3 }, () => ({ name: "", equipment: [], presets: [] }));
      state.slot = 0;
      render(true);
    },
    leave() {
      if (!home) return;
      saveDraft();
      Object.assign(state, home);
      home = null;
      current = null;
      render(false);
    },
  };
}
