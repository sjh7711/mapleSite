import assert from "node:assert/strict";
import test from "node:test";

import {
  WHEEL_DEFAULT_REVISION,
  migrateWheelPreference,
} from "../src/shared/starforce-wheel-preference.js";

test("스크롤 허용은 기본 OFF이며 과거 저장값을 한 번 삭제한다", () => {
  assert.deepEqual(migrateWheelPreference({}), {
    wheelEnabled: false,
    wheelDefaultRevision: WHEEL_DEFAULT_REVISION,
  });
  assert.deepEqual(migrateWheelPreference({ wheelEnabled: true }), {
    wheelEnabled: false,
    wheelDefaultRevision: WHEEL_DEFAULT_REVISION,
  });
});

test("기본값 개정 이후 사용자가 다시 켠 설정은 유지한다", () => {
  assert.deepEqual(migrateWheelPreference({
    wheelEnabled: true,
    wheelDefaultRevision: WHEEL_DEFAULT_REVISION,
  }), {
    wheelEnabled: true,
    wheelDefaultRevision: WHEEL_DEFAULT_REVISION,
  });
});
