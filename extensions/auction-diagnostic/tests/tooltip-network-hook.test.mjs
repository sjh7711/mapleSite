import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
await import(path.join(path.dirname(testDirectory), "tooltip-network-hook.js"));

const {
  CHANNEL,
  HOOK_SOURCE,
  REQUEST_SOURCE,
  installTooltipNetworkHook,
  safeTooltipRequestMetadata,
  sanitizePayload
} = globalThis.MapleAuctionTooltipNetworkHookCore;

const UUID = "42b2ed2d-dbcf-43f9-9add-f5b1d2fcda53";
const SECOND_UUID = "7e88c328-4515-4d37-95d4-c3270f80b21d";
const ACCOUNT_ID = "46314640";
const CHARACTER_ID = "51852377";
const RAW_LISTING_ID = "private-listing-id";
const RAW_TRADE_SN = "private-trade-sn";
const RAW_ITEM_ID = "private-encrypted-item-id";
const TOOLTIP_URL = `https://api.mskr.nexon.com/v1/market/web/items/searches/sold/${UUID}/tool-tip?accountId=${ACCOUNT_ID}&page=1&limit=60&sortType=TRADE_DATE_DESC&characterId=${CHARACTER_ID}`;
const LEGACY_SAME_ORIGIN_TOOLTIP_URL = TOOLTIP_URL.replace(
  "api.mskr.nexon.com",
  "auction.maplestory.nexon.com"
);

function flushTasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForCapture(target, minimumCount = 1) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const captures = target.messages.filter(({ message }) => message.type === "capture_available");
    if (captures.length >= minimumCount) return captures;
    await flushTasks();
  }
  throw new Error(`capture_available ${minimumCount}개를 기다리는 중 시간 초과`);
}

function fakeWindow({ fetch, XMLHttpRequest, performance, PerformanceObserver } = {}) {
  const messages = [];
  const listeners = new Map();
  const target = {
    location: {
      origin: "https://auction.maplestory.nexon.com",
      href: `https://auction.maplestory.nexon.com/price?priceSearchKey=${UUID}`
    },
    fetch,
    XMLHttpRequest,
    performance,
    PerformanceObserver,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    postMessage(message, origin) {
      messages.push({ message, origin });
    }
  };
  target.dispatchRequest = (data, overrides = {}) => {
    for (const listener of listeners.get("message") || []) {
      listener({
        source: overrides.source || target,
        origin: overrides.origin || target.location.origin,
        data
      });
    }
  };
  target.messages = messages;
  return target;
}

let nextRequestId = 1;
async function request(target, action, extra = {}) {
  const requestId = `test-${nextRequestId++}`;
  target.dispatchRequest({
    channel: CHANNEL,
    source: REQUEST_SOURCE,
    type: "request",
    request_id: requestId,
    action,
    ...extra
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await flushTasks();
    for (let index = target.messages.length - 1; index >= 0; index -= 1) {
      const message = target.messages[index].message;
      if (message.type === "response" && message.request_id === requestId) return message;
    }
  }
  return undefined;
}

function payloadForUrl(url, itemName = "거대한 공포") {
  const parsed = new URL(url);
  const pathSegments = parsed.pathname.split("/").filter(Boolean);
  const searchKey = pathSegments[pathSegments.length - 2];
  const page = Number(parsed.searchParams.get("page"));
  const limit = Number(parsed.searchParams.get("limit"));
  return {
    searchKey,
    accountId: Number(ACCOUNT_ID),
    page,
    limit,
    items: [{
      _id: RAW_LISTING_ID,
      tradeSn: RAW_TRADE_SN,
      subIdx: 1,
      encryptedItemId: RAW_ITEM_ID,
      itemIcon: { encryptedLookItemId: RAW_ITEM_ID },
      name: itemName,
      characterId: Number(CHARACTER_ID),
      price: String(page * 100),
      diagnostic: TOOLTIP_URL
    }]
  };
}

function fakeResponse(payload, { ok = true, url = TOOLTIP_URL, rejects = false } = {}) {
  return {
    ok,
    url,
    clone() {
      return {
        json() {
          return rejects ? Promise.reject(new Error("not json")) : Promise.resolve(payload);
        }
      };
    }
  };
}

function assertNoPrivateRequestData(messages) {
  const serialized = JSON.stringify(messages.map(({ message }) => message));
  assert.equal(serialized.includes(ACCOUNT_ID), false, "accountId value crossed postMessage");
  assert.equal(serialized.includes(CHARACTER_ID), false, "characterId value crossed postMessage");
  assert.equal(serialized.includes(UUID), false, "searchKey crossed postMessage");
  assert.equal(serialized.includes(RAW_LISTING_ID), false, "raw _id crossed postMessage");
  assert.equal(serialized.includes(RAW_TRADE_SN), false, "raw tradeSn crossed postMessage");
  assert.equal(serialized.includes(RAW_ITEM_ID), false, "raw encryptedItemId crossed postMessage");
  assert.equal(serialized.includes("/tool-tip"), false, "raw request URL crossed postMessage");
  assert.equal(/account_?id/iu.test(serialized), false, "accountId key crossed postMessage");
  assert.equal(/character_?id/iu.test(serialized), false, "characterId key crossed postMessage");
  assert.equal(/(?:price)?search_?key/iu.test(serialized), false, "searchKey key crossed postMessage");
}

function assertSafeItem(item, { name, price }) {
  assert.equal(item.name, name);
  assert.equal(item.price, price);
  assert.equal(item.diagnostic, null);
  assert.equal("_id" in item, false);
  assert.equal("tradeSn" in item, false);
  assert.equal("subIdx" in item, false);
  assert.equal("encryptedItemId" in item, false);
  assert.deepEqual(item.itemIcon, {});
  assert.deepEqual(Object.keys(item.source_hashes).sort(), ["item", "listing"]);
  for (const hash of Object.values(item.source_hashes)) {
    assert.match(hash, /^sha256:[0-9a-f]{64}$/u);
  }
  const expectedListing = createHash("sha256")
    .update(`auction-tooltip-listing-v1\n${RAW_LISTING_ID}`)
    .digest("hex");
  const expectedItem = createHash("sha256")
    .update(`auction-tooltip-item-v1\n${RAW_ITEM_ID}`)
    .digest("hex");
  assert.equal(item.source_hashes.listing, `sha256:${expectedListing}`);
  assert.equal(item.source_hashes.item, `sha256:${expectedItem}`);
}

assert.deepEqual(safeTooltipRequestMetadata(TOOLTIP_URL), {
  page: 1,
  limit: 60,
  sort: "TRADE_DATE_DESC"
});
assert.deepEqual(
  safeTooltipRequestMetadata(LEGACY_SAME_ORIGIN_TOOLTIP_URL),
  { page: 1, limit: 60, sort: "TRADE_DATE_DESC" },
  "the legacy same-origin endpoint remains supported"
);
assert.equal(safeTooltipRequestMetadata(TOOLTIP_URL.replace("/sold/", "/sale/")), null);
assert.equal(safeTooltipRequestMetadata(TOOLTIP_URL.replace(UUID, "not-a-uuid")), null);
assert.equal(
  safeTooltipRequestMetadata(TOOLTIP_URL.replace("api.mskr.nexon.com", "example.com")),
  null,
  "a cross-origin lookalike endpoint must not be captured"
);

assert.deepEqual(sanitizePayload({
  accountId: 1,
  nested: {
    character_id: 2,
    priceSearchKey: UUID,
    name: "거대한 공포",
    unlabelledRequest: TOOLTIP_URL
  },
  items: [{ requestUrl: TOOLTIP_URL, price: 123 }]
}), {
  nested: { name: "거대한 공포", unlabelledRequest: null },
  items: [{ price: 123 }]
});

{
  const nativeCalls = [];
  const target = fakeWindow({
    async fetch(input, init) {
      const url = String(input);
      nativeCalls.push({ url, init });
      return fakeResponse(payloadForUrl(url), { url });
    }
  });
  const first = installTooltipNetworkHook(target, { maxEntries: 2 });
  const second = installTooltipNetworkHook(target, { maxEntries: 20 });
  assert.equal(first, second, "installation must be idempotent");

  const initialResponse = await target.fetch(TOOLTIP_URL);
  assert.equal(initialResponse.url, TOOLTIP_URL, "the native response must be preserved");
  await waitForCapture(target);
  assert.equal(nativeCalls.length, 1);

  const latest = await request(target, "get_latest");
  assert.equal(latest.source, HOOK_SOURCE);
  assert.equal(latest.ok, true);
  assert.equal(latest.result.capture.payload.page, 1);
  assert.equal(latest.result.capture.payload.limit, 60);
  assert.equal(latest.result.capture.payload.items.length, 1);
  assertSafeItem(latest.result.capture.payload.items[0], { name: "거대한 공포", price: "100" });
  assert.deepEqual(
    {
      page: latest.result.capture.page,
      limit: latest.result.capture.limit,
      sort: latest.result.capture.sort
    },
    { page: 1, limit: 60, sort: "TRADE_DATE_DESC" }
  );
  assert.equal("url" in latest.result.capture, false);

  const firstCaptureId = latest.result.capture.capture_id;
  assert.equal((await request(target, "get")).result.capture, null);
  assert.equal((await request(target, "get", {
    capture_id: firstCaptureId,
    session_token: "session-999"
  })).result.capture, null);
  const cachedPageOne = await request(target, "get_page", {
    page: 1,
    limit: 60,
    sort: "TRADE_DATE_DESC"
  });
  assert.equal(cachedPageOne.ok, true);
  assert.equal(cachedPageOne.result.capture.capture_id, firstCaptureId);

  const missingPage = await request(target, "get_page", {
    capture_id: firstCaptureId,
    page: 2
  });
  assert.equal(missingPage.result.capture, null, "capture_id must not bypass page matching");

  await target.fetch(TOOLTIP_URL.replace("page=1", "page=2"));
  await waitForCapture(target, 2);
  const fetchedPageTwo = await request(target, "get_page", {
    page: 2,
    limit: 60,
    sort: "TRADE_DATE_DESC"
  });
  assert.equal(fetchedPageTwo.ok, true);
  assert.equal(fetchedPageTwo.result.capture.page, 2);
  assert.equal(fetchedPageTwo.result.capture.payload.items.length, 1);
  assertSafeItem(fetchedPageTwo.result.capture.payload.items[0], { name: "거대한 공포", price: "200" });
  assert.deepEqual(
    fetchedPageTwo.result.capture.payload.items[0].source_hashes,
    latest.result.capture.payload.items[0].source_hashes,
    "the same private identifiers must produce stable public hashes"
  );
  assert.equal(nativeCalls.length, 2, "페이지 자체 요청만 네트워크를 사용해야 합니다");
  assert.equal(new URL(nativeCalls[1].url).searchParams.get("page"), "2");

  const fetchedPageTwoAgain = await request(target, "get_page", {
    page: 2
  });
  assert.equal(fetchedPageTwoAgain.result.capture.capture_id, fetchedPageTwo.result.capture.capture_id);
  assert.equal(nativeCalls.length, 2, "an already cached direct page must not be fetched twice");

  const cachedPageTwo = await request(target, "get_page", {
    page: 2,
    limit: 60,
    sort: "TRADE_DATE_DESC"
  });
  assert.equal(cachedPageTwo.result.capture.capture_id, fetchedPageTwo.result.capture.capture_id);

  await target.fetch(TOOLTIP_URL.replace("page=1", "page=3"));
  await waitForCapture(target, 3);
  const list = await request(target, "list");
  assert.deepEqual(list.result.captures.map(({ page }) => page), [2, 3]);
  const statusBeforeClear = (await request(target, "status")).result;
  assert.equal(statusBeforeClear.cache_size, 2);
  assert.equal(statusBeforeClear.latest_capture.page, 3);
  assert.match(statusBeforeClear.latest_capture.captured_at, /^\d{4}-\d{2}-\d{2}T/u);
  assertNoPrivateRequestData(target.messages);
  assert.equal((await request(target, "clear")).result.cache_size, 0);
  const statusAfterClear = (await request(target, "status")).result;
  assert.equal(statusAfterClear.cache_size, 0);
  assert.equal(statusAfterClear.latest_capture.page, 3, "diagnostic metadata must survive a payload-cache clear");
}

{
  const target = fakeWindow({
    async fetch(input) {
      const url = String(input);
      return fakeResponse(payloadForUrl(url), { url });
    }
  });
  installTooltipNetworkHook(target);

  await target.fetch(TOOLTIP_URL);
  await waitForCapture(target, 1);
  const firstSearch = (await request(target, "get_latest")).result.capture;
  await target.fetch(TOOLTIP_URL.replace("page=1", "page=2"));
  await waitForCapture(target, 2);
  const firstSearchPageTwo = (await request(target, "get_page", {
    session_token: firstSearch.session_token,
    page: 2
  })).result.capture;
  assert.equal(firstSearchPageTwo.page, 2);

  const secondTooltipUrl = TOOLTIP_URL.replace(UUID, SECOND_UUID);
  target.location.href = `https://auction.maplestory.nexon.com/price?priceSearchKey=${SECOND_UUID}`;
  await target.fetch(secondTooltipUrl);
  await waitForCapture(target, 3);
  const secondSearch = (await request(target, "get_latest")).result.capture;
  assert.notEqual(secondSearch.session_token, firstSearch.session_token);
  assert.equal(secondSearch.page, 1);

  const implicitWrongPage = await request(target, "get_page", { page: 2 });
  assert.equal(
    implicitWrongPage.result.capture,
    null,
    "get_page must not return another sold search's page with the same safe metadata"
  );
  assert.equal((await request(target, "get_page", {
    anchor_capture_id: 999999,
    page: 2
  })).result.capture, null);
  const explicitHistoricalPage = await request(target, "get_page", {
    session_token: firstSearch.session_token,
    page: 2
  });
  assert.equal(explicitHistoricalPage.result.capture.capture_id, firstSearchPageTwo.capture_id);

  const nothingNew = await request(target, "get_latest", {
    session_token: secondSearch.session_token,
    after_capture_id: secondSearch.capture_id
  });
  assert.equal(nothingNew.result.capture, null);

  const staleDirectFetch = await request(target, "fetch_page", {
    capture_id: firstSearch.capture_id,
    session_token: firstSearch.session_token,
    page: 3
  });
  assert.equal(staleDirectFetch.ok, false);
  assert.equal(staleDirectFetch.error, "unsupported_action");

  const mismatchedSession = await request(target, "fetch_page", {
    capture_id: secondSearch.capture_id,
    session_token: firstSearch.session_token,
    page: 2
  });
  assert.equal(mismatchedSession.ok, false);
  assert.equal(mismatchedSession.error, "unsupported_action");
  assertNoPrivateRequestData(target.messages);
}

{
  const replacementCalls = [];
  const target = fakeWindow({
    async fetch(input) {
      const url = String(input);
      return fakeResponse(payloadForUrl(url), { url });
    }
  });
  const api = installTooltipNetworkHook(target);
  const replacementFetch = async (input) => {
    const url = String(input);
    replacementCalls.push(url);
    return fakeResponse(payloadForUrl(url), { url });
  };
  target.fetch = replacementFetch;
  assert.equal(api.getStatus().fetch_hook_active, true, "status must restore a replaced fetch hook");
  assert.notEqual(target.fetch, replacementFetch);
  assert.equal(installTooltipNetworkHook(target), api, "reinstallation must retain the same bridge API");
  await target.fetch(TOOLTIP_URL);
  await waitForCapture(target);
  assert.equal(replacementCalls.length, 1);
  assert.equal((await request(target, "get_page", {
    page: 1,
    limit: 60,
    sort: "TRADE_DATE_DESC"
  })).result.capture.transport, "fetch");
  assertNoPrivateRequestData(target.messages);
}

{
  const nativeCalls = [];
  const resourceEntries = [{ name: TOOLTIP_URL, startTime: 25 }];
  const nativeFetch = async (input, init) => {
    const url = String(input);
    nativeCalls.push({ url, init });
    return fakeResponse(payloadForUrl(url), { url });
  };
  const target = fakeWindow({
    fetch: nativeFetch,
    performance: {
      now: () => 30,
      getEntriesByType: (type) => type === "resource" ? resourceEntries : []
    }
  });
  installTooltipNetworkHook(target);

  // Simulate a request made through a fetch reference captured before the hook
  // was installed. DevTools/resource timing sees it, but the wrapper does not.
  await nativeFetch(TOOLTIP_URL);
  assert.equal((await request(target, "status")).result.cache_size, 0);
  const recovered = await request(target, "get_page", {
    page: 1,
    limit: 60,
    sort: "TRADE_DATE_DESC"
  });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.result.capture, null);
  assert.equal(nativeCalls.length, 1, "get_page must be cache-only");
  assert.equal((await request(target, "get_page", {
    page: 1,
    limit: 60,
    sort: "TRADE_DATE_DESC"
  })).result.capture, null);
  assert.equal(nativeCalls.length, 1, "repeated get_page polling must not issue a request");
  const observedStatus = (await request(target, "status")).result;
  assert.equal(observedStatus.latest_observed.current_search, true);
  assert.equal("recovery_attempted" in observedStatus.latest_observed, false);
  assertNoPrivateRequestData(target.messages);
}

{
  const resourceEntries = [{ name: TOOLTIP_URL.replace(UUID, SECOND_UUID), startTime: 25 }];
  const target = fakeWindow({
    fetch: async (input) => {
      const url = String(input);
      return fakeResponse(payloadForUrl(url), { url });
    },
    performance: {
      now: () => 30,
      getEntriesByType: () => resourceEntries
    }
  });
  installTooltipNetworkHook(target);
  const response = await request(target, "get_page", {
    page: 1,
    limit: 60,
    sort: "TRADE_DATE_DESC"
  });
  assert.equal(response.result.capture, null, "another priceSearchKey resource must never be recovered");
  assertNoPrivateRequestData(target.messages);
}

{
  const response = fakeResponse({ ignored: true }, { rejects: true });
  const target = fakeWindow({ fetch: async () => response });
  installTooltipNetworkHook(target);
  assert.equal(await target.fetch(TOOLTIP_URL), response);
  await flushTasks();
  assert.equal((await request(target, "status")).result.cache_size, 0);
}

{
  let resolveNative;
  const target = fakeWindow({
    fetch: () => new Promise((resolve) => { resolveNative = resolve; })
  });
  installTooltipNetworkHook(target);
  const staleRequest = target.fetch(TOOLTIP_URL);
  assert.equal((await request(target, "clear")).result.cache_size, 0);
  resolveNative(fakeResponse(payloadForUrl(TOOLTIP_URL)));
  await staleRequest;
  await flushTasks();
  assert.equal(
    (await request(target, "status")).result.cache_size,
    0,
    "a response started before clear must not enter the next search generation"
  );
}

{
  class FakeXhr {
    constructor() {
      this.listeners = new Map();
      this.status = 0;
      this.responseType = "";
      this.responseText = "";
    }

    open(method, url) {
      this.method = method;
      this.url = url;
      return "opened";
    }

    send(body) {
      this.body = body;
      return "sent";
    }

    addEventListener(type, listener) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(listener);
    }

    removeEventListener(type, listener) {
      this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry !== listener));
    }

    emit(type) {
      for (const listener of [...(this.listeners.get(type) || [])]) listener.call(this);
    }
  }

  const target = fakeWindow({ XMLHttpRequest: FakeXhr });
  installTooltipNetworkHook(target);
  const xhr = new target.XMLHttpRequest();
  assert.equal(xhr.open("GET", TOOLTIP_URL), "opened");
  assert.equal(xhr.send(null), "sent");
  xhr.status = 200;
  xhr.responseText = JSON.stringify(payloadForUrl(TOOLTIP_URL, "고통의 근원"));
  xhr.emit("load");
  await waitForCapture(target);
  const latest = (await request(target, "get_latest")).result.capture;
  assert.equal(latest.transport, "xhr");
  assert.equal(latest.payload.items.length, 1);
  assertSafeItem(latest.payload.items[0], { name: "고통의 근원", price: "100" });
  assertNoPrivateRequestData(target.messages);
}

console.log("tooltip-network-hook: all tests passed");
