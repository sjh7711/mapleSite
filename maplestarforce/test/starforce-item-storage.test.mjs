import assert from "node:assert/strict";
import test from "node:test";
import { createCalculatorStorage, buildResultSnapshot } from "../src/shared/result-share-state.js";
import { readStarforceItems, STARFORCE_ITEMS_KEY as KEY } from "../src/shared/starforce-item-storage.js";

function native(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const saved = {
  slots: [
    [{ presetId: "dreamy-belt", startStar: 17, targetStar: 22, replacementEok: 47 }],
    [{ presetId: "bloody-soul", startStar: 12, targetStar: 21, replacementEok: 810 }],
    [],
  ],
  slot: 1,
  characterSources: [{ name: "테스트" }, {}, {}],
};

test("탭 저장소가 없는 새 방문에서도 세 목록·선택 슬롯·장비 설정을 복원한다", () => {
  const disk = native();
  const firstVisit = createCalculatorStorage(() => disk);
  firstVisit.enablePersistence();
  firstVisit.setItem(KEY, JSON.stringify(saved));
  const nextVisit = createCalculatorStorage(() => disk);
  assert.deepEqual(readStarforceItems(nextVisit, native()), saved);
});

test("이전 탭 목록을 읽고 이후 저장한 영구 목록을 우선 복원한다", () => {
  const local = native();
  const legacy = native({ [KEY]: JSON.stringify(saved) });
  assert.deepEqual(readStarforceItems(local, legacy), saved);
  const cleared = { slots: [[], [], []], slot: 0 };
  local.setItem(KEY, JSON.stringify(cleared));
  assert.deepEqual(readStarforceItems(local, legacy), cleared);
});

test("손상되거나 접근할 수 없는 저장소는 이전 탭 목록으로 복구한다", () => {
  const legacy = native({ [KEY]: JSON.stringify(saved) });
  for (const local of [native({ [KEY]: "{" }), native({ [KEY]: "{}" }), {
    getItem() { throw new Error("blocked"); },
  }]) assert.deepEqual(readStarforceItems(local, legacy), saved);
  assert.equal(readStarforceItems(native(), native()), null);
  assert.deepEqual(readStarforceItems(native(), native({ [KEY]: JSON.stringify(saved.slots[0]) })), saved.slots[0]);
});

test("영구 목록을 공유해도 현재 선택한 슬롯만 링크에 담는다", () => {
  const local = native({ [KEY]: JSON.stringify(saved) });
  const snapshot = buildResultSnapshot("starforce", {}, local, native());
  assert.deepEqual(snapshot.session[KEY], { slots: [saved.slots[1], [], []], slot: 0 });
  assert.equal(snapshot.local[KEY], undefined);
  assert.ok(!JSON.stringify(snapshot).includes("테스트"));
});

test("공유 링크를 편집해도 영구 목록과 이전 탭 목록을 덮어쓰지 않는다", () => {
  const disk = native({ [KEY]: JSON.stringify(saved) });
  const legacyDisk = native({ [KEY]: JSON.stringify(saved.slots[0]) });
  const local = createCalculatorStorage(() => disk);
  const session = createCalculatorStorage(() => legacyDisk);
  const shared = { slots: [[{ presetId: "meister-ring", targetStar: 22 }], [], []], slot: 0 };
  local.isolate();
  session.isolate({ [KEY]: shared });
  assert.deepEqual(readStarforceItems(local, session), shared);
  local.enablePersistence();
  local.setItem(KEY, JSON.stringify({ slots: [[], [], []], slot: 0 }));
  assert.deepEqual(JSON.parse(disk.getItem(KEY)), saved);
  assert.deepEqual(JSON.parse(legacyDisk.getItem(KEY)), saved.slots[0]);
});
