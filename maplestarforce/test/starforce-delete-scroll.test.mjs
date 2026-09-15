import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createDeleteTargetAnchor } from "../src/shared/delete-target-anchor.js";

const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/style.css", import.meta.url), "utf8");

function fakeContainer(height) {
  const removed = [];
  return {
    height,
    removed,
    style: {
      minHeight: "",
      removeProperty(name) {
        removed.push(name);
        if (name === "min-height") this.minHeight = "";
      },
    },
    getBoundingClientRect() {
      return { height: this.height };
    },
  };
}

function fakeButton(top) {
  return {
    top,
    focusOptions: null,
    focus(options) {
      this.focusOptions = options;
    },
    getBoundingClientRect() {
      return { top: this.top };
    },
  };
}

test("목록 높이를 유지하고 후속 삭제 버튼을 같은 화면 좌표에 맞춘다", () => {
  const container = fakeContainer(721.2);
  const scrolls = [];
  const viewport = {
    scrollBy(left, top) {
      scrolls.push([left, top]);
    },
  };
  const anchor = createDeleteTargetAnchor(container, viewport);
  const snapshot = anchor.retain(fakeButton(340));

  assert.equal(container.style.minHeight, "722px");
  assert.equal(anchor.active, true);
  assert.equal(anchor.align(snapshot, fakeButton(352)), true);
  assert.deepEqual(scrolls, [[0, 12]]);

  const successor = fakeButton(340);
  assert.equal(anchor.align(snapshot, successor), true);
  assert.deepEqual(successor.focusOptions, { preventScroll: true });
});

test("연속 삭제 높이는 누적하지 않고 해제하면 이전 좌표를 무효화한다", () => {
  const container = fakeContainer(900);
  const anchor = createDeleteTargetAnchor(container, { scrollBy() {} });
  const first = anchor.retain(fakeButton(200));
  container.height = 700;
  const second = anchor.retain(fakeButton(200));

  assert.equal(container.style.minHeight, "900px");
  assert.equal(anchor.align(first, fakeButton(200)), false);
  assert.equal(anchor.align(second, fakeButton(200)), true);

  anchor.release();
  assert.equal(anchor.active, false);
  assert.equal(container.style.minHeight, "");
  assert.deepEqual(container.removed, ["min-height"]);
  assert.equal(anchor.align(second, fakeButton(200)), false);
});

test("스타포스 삭제 흐름은 높이를 보존한 채 같은 인덱스의 버튼을 잇는다", () => {
  assert.match(
    source,
    /const anchor = itemDeleteAnchor\.retain\(remove\);[\s\S]*state\.items\.splice\(index, 1\);[\s\S]*renderItems\(true, true\);[\s\S]*requestAnimationFrame/u,
  );
  assert.match(
    source,
    /querySelectorAll\("\.item"\)\[index\][\s\S]*querySelector\("\.button--remove"\)[\s\S]*itemDeleteAnchor\.align/u,
  );
  assert.match(
    source,
    /function releaseItemDeleteAnchorAtTop\(\)[\s\S]*document\.scrollingElement\?\.scrollTop \?\? window\.scrollY[\s\S]*scrollTop <= 0[\s\S]*releaseItemDeleteAnchor\(\)/u,
  );
  assert.match(
    source,
    /window\.addEventListener\("scroll", releaseItemDeleteAnchorAtTop/u,
  );
  assert.doesNotMatch(
    source,
    /document\.addEventListener\("pointermove", \(event\) => \{\s*if \(!itemDeleteAnchor\.active\)/u,
  );
  assert.doesNotMatch(source, /ITEM_DELETE_RELEASE_DELAY|scheduleItemDeleteAnchorRelease/u);
  assert.doesNotMatch(
    source,
    /addEventListener\("(?:wheel|touchstart)", releaseItemDeleteAnchor/u,
  );
  assert.match(styles, /\.items \{[\s\S]*overflow-anchor: none;/u);
});
