import assert from "node:assert/strict";
import test from "node:test";
import { applyPublishedSoulEtherPrices, fetchPublishedSoulEtherPrices, initializeSoulEtherPrices,
  isSoulEtherPrices } from "../src/shared/soul-ether-prices.js";

const document = { version: 1, revision: 2, prices: [20, 22, 24, 80] };

test("새 방문자는 공통 가격을 받고 예전 저장본의 직접 입력값은 보존한다", () => {
  const fresh = initializeSoulEtherPrices();
  assert.equal(applyPublishedSoulEtherPrices(fresh, document), true);
  assert.deepEqual(fresh.etherPrices, [20, 22, 24, 80]);
  const legacy = initializeSoulEtherPrices({ etherPrices: [18, 33, 0, 70] });
  applyPublishedSoulEtherPrices(legacy, document);
  assert.deepEqual(legacy.etherPrices, [20, 33, 0, 80]);
});

test("같은 값으로 직접 수정한 가격과 요청 중 입력한 값도 유지한다", () => {
  const state = initializeSoulEtherPrices();
  state.etherPriceOverrides[0] = true;
  state.etherPrices[1] = 35; state.etherPriceOverrides[1] = true;
  applyPublishedSoulEtherPrices(state, document);
  assert.deepEqual(state.etherPrices, [18, 35, 24, 80]);
  const restored = initializeSoulEtherPrices(JSON.parse(JSON.stringify(state)));
  applyPublishedSoulEtherPrices(restored, { ...document, revision: 3, prices: [25, 26, 27, 90] });
  assert.deepEqual(restored.etherPrices, [18, 35, 27, 90]);
});

test("공유 계산값은 보존하고 초기화에 쓸 공통 가격만 갱신한다", () => {
  const state = initializeSoulEtherPrices({ etherPrices: [1, 2, 3, 4] }, { preservePrices: true });
  applyPublishedSoulEtherPrices(state, document, { preservePrices: true });
  assert.deepEqual(state.etherPrices, [1, 2, 3, 4]);
  assert.deepEqual(state.publishedEtherPrices, document.prices);
});

test("손상된 캐시와 잘못된 서버 가격은 계산값을 바꾸지 않는다", () => {
  const state = initializeSoulEtherPrices({ etherPrices: [null, -3, "4", NaN], publishedEtherPrices: [1] });
  assert.deepEqual(state.etherPrices, [18, 0, 4, 70]);
  const before = structuredClone(state);
  assert.equal(applyPublishedSoulEtherPrices(state, { ...document, prices: [20, 22, 24, null] }), false);
  assert.deepEqual(state, before);
  assert.equal(isSoulEtherPrices(new Array(4)), false);
});

test("이전 계산기에 저장된 큰 개인 가격도 공통 가격 상한과 무관하게 보존한다", () => {
  const state = initializeSoulEtherPrices({ etherPrices: [2_000_000, 18, 18, 70] });
  applyPublishedSoulEtherPrices(state, document);
  assert.deepEqual(state.etherPrices, [2_000_000, 22, 24, 80]);
});

test("공개 가격 조회 실패와 잘못된 응답을 처리한다", async () => {
  assert.deepEqual(await fetchPublishedSoulEtherPrices(async () => Response.json(document)), document);
  await assert.rejects(fetchPublishedSoulEtherPrices(async () => new Response(null, { status: 503 })));
  await assert.rejects(fetchPublishedSoulEtherPrices(async () => Response.json({ ...document, version: 0 })));
});
