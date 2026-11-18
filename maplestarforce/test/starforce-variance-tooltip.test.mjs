import test from "node:test";
import assert from "node:assert/strict";
import { varianceTooltipPosition } from "../src/shared/starforce-variance-tooltip.js";

const contains = (position, size, point) => point.x >= position.left - 8 && point.x <= position.left + size.width + 8
  && point.y >= position.top - 8 && point.y <= position.top + size.height + 8;

test("overlay stays inside chart bounds without covering the selected point, including corners", () => {
  for (const width of [240, 350, 840]) {
    const bounds = { left: 6, right: width - 6, top: 70, bottom: 470 };
    const size = { width: Math.min(300, width - 12), height: width < 300 ? 150 : 108 };
    for (let x = bounds.left; x <= bounds.right; x += 8) {
      for (let y = bounds.top; y <= bounds.bottom; y += 8) {
        const point = { x, y }, position = varianceTooltipPosition(bounds, size, [point]);
        assert.equal(contains(position, size, point), false, JSON.stringify({ bounds, size, point, position }));
        assert.ok(position.left >= bounds.left && position.top >= bounds.top);
        assert.ok(position.left + size.width <= bounds.right && position.top + size.height <= bounds.bottom);
      }
    }
  }
});

test("keeps the pointer and paired outcomes visible, with controls above the plot", () => {
  const bounds = { left: 20, right: 860, top: 10, bottom: 500 };
  const size = { width: 290, height: 170 };
  const points = [{ x: 730, y: 150 }, { x: 730, y: 175 }];
  const pointer = { x: 720, y: 200 }, control = { left: 660, right: 860, top: 10, bottom: 50 };
  const position = varianceTooltipPosition(bounds, size, points, [pointer], [control]);
  for (const point of [...points, pointer]) assert.equal(contains(position, size, point), false);
  assert.ok(position.top >= control.bottom || position.left + size.width < control.left);
});
