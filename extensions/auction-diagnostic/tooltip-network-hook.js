(() => {
  "use strict";

  const PROTOCOL_VERSION = 2;
  const CHANNEL = "maple-auction-tooltip-network-v2";
  const REQUEST_SOURCE = "maple-auction-content-script";
  const HOOK_SOURCE = "maple-auction-page-hook";
  const DEFAULT_MAX_CACHE_ENTRIES = 10;
  const DEFAULT_MAX_OBSERVED_REQUESTS = 20;
  const INSTALL_KEY = Symbol.for("maple-auction.tooltip-network-hook.v2");
  const AUCTION_PAGE_ORIGIN = "https://auction.maplestory.nexon.com";
  const TOOLTIP_API_ORIGIN = "https://api.mskr.nexon.com";
  const ALLOWED_TOOLTIP_ORIGINS = new Set([AUCTION_PAGE_ORIGIN, TOOLTIP_API_ORIGIN]);
  const SOLD_TOOLTIP_PATH = /^\/v1\/market\/web\/items\/searches\/sold\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/tool-tip\/?$/iu;
  const SEARCH_KEY_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  const SAFE_REQUEST_ID = /^[a-z0-9._:-]{1,128}$/iu;
  const SAFE_SESSION_TOKEN = /^session-[1-9][0-9]*$/u;
  const SENSITIVE_PAYLOAD_KEYS = new Set([
    "id",
    "accountid",
    "characterid",
    "encrypteditemid",
    "encryptedlookitemid",
    "encryptedsetitemid",
    "itemids",
    "pricesearchkey",
    "searchkey",
    "subidx",
    "tradesn",
    "query",
    "querystring",
    "rawquery",
    "requestquery",
    "rawurl",
    "requesturl"
  ]);
  const SENSITIVE_REQUEST_TEXT = /(?:\/v1\/market\/web\/items\/searches\/sold\/[0-9a-f-]+\/tool-tip(?:[/?#]|$)|(?:accountId|characterId|priceSearchKey|searchKey)=)/iu;

  function positiveInteger(value) {
    if (value == null || value === "") return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  function safeSort(value) {
    const normalized = String(value || "").trim().toUpperCase();
    return /^[A-Z0-9_]{1,64}$/u.test(normalized) ? normalized : null;
  }

  function normalizePayloadKey(value) {
    return String(value || "").replace(/[^a-z0-9]/giu, "").toLowerCase();
  }

  function collectSensitiveIdentifierValues(value, output = new Set(), seen = new WeakSet()) {
    if (!value || typeof value !== "object" || seen.has(value)) return output;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const child of value) collectSensitiveIdentifierValues(child, output, seen);
      return output;
    }
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = normalizePayloadKey(key);
      if (SENSITIVE_PAYLOAD_KEYS.has(normalizedKey)) {
        const values = Array.isArray(child) ? child : [child];
        for (const identifier of values) {
          if ((typeof identifier === "string" || typeof identifier === "number") && String(identifier)) {
            output.add(String(identifier));
          }
        }
      }
      collectSensitiveIdentifierValues(child, output, seen);
    }
    return output;
  }

  async function sha256Hex(target, value) {
    if (value == null || value === "") return null;
    const subtle = target.crypto?.subtle || globalThis.crypto?.subtle;
    const Encoder = target.TextEncoder || globalThis.TextEncoder;
    if (!subtle || typeof subtle.digest !== "function" || typeof Encoder !== "function") return null;
    try {
      const bytes = new Encoder().encode(String(value));
      const digest = await subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    } catch {
      return null;
    }
  }

  async function stableItemHashes(target, payload) {
    if (!Array.isArray(payload?.items)) return [];
    return Promise.all(payload.items.map(async (item) => {
      if (!item || typeof item !== "object") return null;
      const candidates = {
        listing: typeof item._id === "string" && item._id
          ? `auction-tooltip-listing-v1\n${item._id}`
          : null,
        item: typeof item.encryptedItemId === "string" && item.encryptedItemId
          ? `auction-tooltip-item-v1\n${item.encryptedItemId}`
          : null
      };
      const hashes = {};
      await Promise.all(Object.entries(candidates).map(async ([name, source]) => {
        const hash = await sha256Hex(target, source);
        if (hash) hashes[name] = `sha256:${hash}`;
      }));
      return Object.keys(hashes).length ? hashes : null;
    }));
  }

  function sanitizePayload(value, seen = new WeakMap(), sensitiveValues = new Set()) {
    if (typeof value === "string") {
      if (SENSITIVE_REQUEST_TEXT.test(value)) return null;
      for (const sensitiveValue of sensitiveValues) {
        if (!sensitiveValue) continue;
        if (value === sensitiveValue || (sensitiveValue.length >= 16 && value.includes(sensitiveValue))) {
          return null;
        }
      }
      return value;
    }
    if (value == null || typeof value !== "object") return value;
    if (seen.has(value)) return null;

    const clone = Array.isArray(value) ? [] : {};
    seen.set(value, clone);

    if (Array.isArray(value)) {
      for (const child of value) clone.push(sanitizePayload(child, seen, sensitiveValues));
      return clone;
    }

    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_PAYLOAD_KEYS.has(normalizePayloadKey(key))) continue;
      clone[key] = sanitizePayload(child, seen, sensitiveValues);
    }
    return clone;
  }

  function requestUrlValue(input) {
    if (typeof input === "string") return input;
    if (typeof URL !== "undefined" && input instanceof URL) return input.href;
    if (input && typeof input.url === "string") return input.url;
    return null;
  }

  function safeTooltipRequestMetadata(input, baseUrl = `${AUCTION_PAGE_ORIGIN}/`) {
    const rawValue = requestUrlValue(input);
    if (!rawValue) return null;

    let parsed;
    try {
      parsed = new URL(rawValue, baseUrl);
    } catch {
      return null;
    }

    if (!ALLOWED_TOOLTIP_ORIGINS.has(parsed.origin)) return null;
    if (!SOLD_TOOLTIP_PATH.test(parsed.pathname)) return null;
    return {
      page: positiveInteger(parsed.searchParams.get("page")),
      limit: positiveInteger(parsed.searchParams.get("limit")),
      sort: safeSort(parsed.searchParams.get("sortType"))
    };
  }

  function privateTooltipRequestMetadata(input, baseUrl = `${AUCTION_PAGE_ORIGIN}/`) {
    const rawValue = requestUrlValue(input);
    if (!rawValue) return null;
    let parsed;
    try {
      parsed = new URL(rawValue, baseUrl);
    } catch {
      return null;
    }
    const match = parsed.pathname.match(SOLD_TOOLTIP_PATH);
    const safe = safeTooltipRequestMetadata(parsed, baseUrl);
    if (!match || !safe) return null;
    const pathSegments = parsed.pathname.split("/").filter(Boolean);
    return {
      ...safe,
      // These values stay inside the page-world closure. They are never
      // returned through postMessage or written by the extension.
      private_url: parsed.href,
      private_search_key: pathSegments[pathSegments.length - 2] || null
    };
  }

  function publicCaptureMetadata(capture) {
    if (!capture) return null;
    return {
      capture_id: capture.capture_id,
      captured_at: capture.captured_at,
      transport: capture.transport,
      session_token: capture.session_token,
      page: capture.page,
      limit: capture.limit,
      sort: capture.sort
    };
  }

  function publicCapture(capture) {
    if (!capture) return null;
    return {
      ...publicCaptureMetadata(capture),
      payload: capture.payload
    };
  }

  function installTooltipNetworkHook(target = globalThis, options = {}) {
    if (!target || typeof target !== "object") return null;
    if (target[INSTALL_KEY]) {
      target[INSTALL_KEY].ensureHooks?.();
      target[INSTALL_KEY].scanResourceTimings?.();
      return target[INSTALL_KEY].api;
    }

    const requestedMax = positiveInteger(options.maxEntries);
    const maxEntries = Math.min(requestedMax || DEFAULT_MAX_CACHE_ENTRIES, 50);
    const cache = [];
    const privateCaptureAnchors = new WeakMap();
    const xhrRequests = new WeakMap();
    const observedTooltipRequests = [];
    const observedTooltipRequestKeys = new Set();
    let nextCaptureId = 1;
    let nextSessionId = 1;
    let captureGeneration = 0;
    let performanceCutoff = 0;
    let installedFetchHook = null;
    let installedXhrPrototype = null;
    let installedXhrOpenHook = null;
    let installedXhrSendHook = null;
    let installedXhrNativeOpen = null;
    let installedXhrNativeSend = null;
    let performanceObserver = null;
    let latestCaptureMetadata = null;

    const state = {
      installed: true,
      fetch_hooked: false,
      xhr_hooked: false,
      performance_recovery_available: false,
      max_entries: maxEntries
    };

    const targetOrigin = typeof target.location?.origin === "string" && target.location.origin !== "null"
      ? target.location.origin
      : "*";

    function post(message) {
      try {
        target.postMessage(message, targetOrigin);
      } catch {
        // The network request must never fail because the bridge cannot post.
      }
    }

    function validPayloadForRequest(metadata, payload) {
      if (!metadata || !payload || typeof payload !== "object" || !Array.isArray(payload.items)) {
        return false;
      }
      if (positiveInteger(payload.page) !== metadata.page || positiveInteger(payload.limit) !== metadata.limit) {
        return false;
      }
      return typeof payload.searchKey !== "string" || !metadata.private_search_key ||
        payload.searchKey === metadata.private_search_key;
    }

    function sessionTokenForSearchKey(searchKey) {
      for (let index = cache.length - 1; index >= 0; index -= 1) {
        const privateAnchor = privateCaptureAnchors.get(cache[index]);
        if (privateAnchor?.private_search_key === searchKey) return cache[index].session_token;
      }
      return `session-${nextSessionId++}`;
    }

    function currentPrivateSearchKey() {
      let currentUrl;
      try {
        currentUrl = new URL(target.location?.href || "", target.location?.origin);
      } catch {
        return null;
      }
      if (currentUrl.origin !== targetOrigin) return null;
      const searchKey = currentUrl.searchParams.get("priceSearchKey");
      return SEARCH_KEY_VALUE.test(String(searchKey || "")) ? searchKey : null;
    }

    function currentSessionToken() {
      const currentSearchKey = currentPrivateSearchKey();
      if (!currentSearchKey) return null;
      for (let index = cache.length - 1; index >= 0; index -= 1) {
        const privateAnchor = privateCaptureAnchors.get(cache[index]);
        if (privateAnchor?.private_search_key === currentSearchKey) return cache[index].session_token;
      }
      return null;
    }

    async function addCapture(metadata, payload, transport) {
      if (metadata?.private_generation !== captureGeneration || !validPayloadForRequest(metadata, payload)) {
        return null;
      }
      const sensitiveValues = new Set([
        metadata.private_search_key,
        metadata.private_url
      ].filter(Boolean));
      for (const identifier of collectSensitiveIdentifierValues(payload)) sensitiveValues.add(identifier);
      const itemHashes = await stableItemHashes(target, payload);
      if (metadata?.private_generation !== captureGeneration) return null;
      const safePayload = sanitizePayload(payload, new WeakMap(), sensitiveValues);
      if (Array.isArray(safePayload?.items)) {
        for (let index = 0; index < safePayload.items.length; index += 1) {
          if (itemHashes[index] && safePayload.items[index] && typeof safePayload.items[index] === "object") {
            safePayload.items[index].source_hashes = itemHashes[index];
          }
        }
      }
      const capture = {
        capture_id: nextCaptureId++,
        captured_at: new Date().toISOString(),
        transport,
        session_token: sessionTokenForSearchKey(metadata.private_search_key),
        page: metadata.page,
        limit: metadata.limit,
        sort: metadata.sort,
        payload: safePayload
      };
      latestCaptureMetadata = publicCaptureMetadata(capture);
      // Direct-page details are deliberately held outside the serializable
      // capture cache. publicCapture() has no path to this WeakMap.
      privateCaptureAnchors.set(capture, {
        private_url: metadata.private_url,
        private_search_key: metadata.private_search_key
      });
      cache.push(capture);
      if (cache.length > maxEntries) cache.splice(0, cache.length - maxEntries);
      post({
        channel: CHANNEL,
        protocol_version: PROTOCOL_VERSION,
        source: HOOK_SOURCE,
        type: "capture_available",
        capture: {
          ...publicCaptureMetadata(capture),
          current_search: currentPrivateSearchKey() === metadata.private_search_key
        }
      });
      return capture;
    }

    function captureFetchResponse(response, metadata, transport = "fetch") {
      if (!metadata || !response || response.ok !== true || typeof response.clone !== "function") {
        return Promise.resolve(null);
      }
      try {
        const clone = response.clone();
        if (!clone || typeof clone.json !== "function") return Promise.resolve(null);
        return Promise.resolve(clone.json())
          .then((payload) => addCapture(metadata, payload, transport))
          .catch(() => null);
      } catch {
        // A consumed/non-cloneable response should remain usable by the page.
        return Promise.resolve(null);
      }
    }

    function numericPerformanceNow() {
      try {
        const value = Number(target.performance?.now?.());
        return Number.isFinite(value) && value >= 0 ? value : 0;
      } catch {
        return 0;
      }
    }

    function rememberObservedTooltipRequest(entry) {
      const name = typeof entry === "string" ? entry : entry?.name;
      const metadata = privateTooltipRequestMetadata(name, target.location?.href);
      if (!metadata) return false;
      const startTimeValue = typeof entry === "string" ? numericPerformanceNow() : Number(entry?.startTime);
      const startTime = Number.isFinite(startTimeValue) && startTimeValue >= 0
        ? startTimeValue
        : numericPerformanceNow();
      if (startTime + 0.5 < performanceCutoff) return false;
      const requestKey = `${startTime}:${metadata.private_url}`;
      if (observedTooltipRequestKeys.has(requestKey)) return false;
      observedTooltipRequestKeys.add(requestKey);
      observedTooltipRequests.push({ requestKey, startTime, metadata });
      if (observedTooltipRequests.length > DEFAULT_MAX_OBSERVED_REQUESTS) {
        const removed = observedTooltipRequests.splice(
          0,
          observedTooltipRequests.length - DEFAULT_MAX_OBSERVED_REQUESTS
        );
        for (const request of removed) {
          observedTooltipRequestKeys.delete(request.requestKey);
        }
      }
      return true;
    }

    function scanResourceTimings() {
      let entries;
      try {
        entries = target.performance?.getEntriesByType?.("resource");
      } catch {
        return 0;
      }
      if (!Array.isArray(entries)) return 0;
      let added = 0;
      for (const entry of entries) {
        if (rememberObservedTooltipRequest(entry)) added += 1;
      }
      return added;
    }

    function observedRequestForPage(message) {
      scanResourceTimings();
      const page = positiveInteger(message.page);
      const limit = positiveInteger(message.limit);
      const sort = safeSort(message.sort);
      const currentSearchKey = currentPrivateSearchKey();
      if (!page || !currentSearchKey) return null;
      for (let index = observedTooltipRequests.length - 1; index >= 0; index -= 1) {
        const request = observedTooltipRequests[index];
        const metadata = request.metadata;
        if (metadata.private_search_key !== currentSearchKey || metadata.page !== page) continue;
        if (limit && metadata.limit !== limit) continue;
        if (sort && metadata.sort !== sort) continue;
        return request;
      }
      return null;
    }

    function publicObservedRequestMetadata(request) {
      if (!request?.metadata) return null;
      return {
        page: request.metadata.page,
        limit: request.metadata.limit,
        sort: request.metadata.sort,
        current_search: request.metadata.private_search_key === currentPrivateSearchKey()
      };
    }

    function captureXhrResponse(xhr, metadata) {
      if (!metadata || !xhr || xhr.status < 200 || xhr.status >= 300) return;
      try {
        const responseType = String(xhr.responseType || "").toLowerCase();
        if (responseType === "json") {
          void addCapture(metadata, xhr.response, "xhr").catch(() => {});
          return;
        }
        if (responseType === "" || responseType === "text") {
          void addCapture(metadata, JSON.parse(xhr.responseText), "xhr").catch(() => {});
        }
      } catch {
        // Ignore non-JSON or inaccessible responses without affecting page handlers.
      }
    }

    function ensureFetchHook() {
      if (typeof target.fetch !== "function") {
        state.fetch_hooked = false;
        return false;
      }
      if (installedFetchHook && target.fetch === installedFetchHook) {
        state.fetch_hooked = true;
        return true;
      }

      const underlyingFetch = target.fetch;
      const hookedFetch = function (...args) {
        const requestGeneration = captureGeneration;
        let requestMetadata = privateTooltipRequestMetadata(args[0], target.location?.href);
        if (requestMetadata) requestMetadata.private_generation = requestGeneration;
        let result;
        try {
          result = Reflect.apply(underlyingFetch, this, args);
        } catch (error) {
          throw error;
        }
        return Promise.resolve(result).then((response) => {
          if (!requestMetadata) {
            requestMetadata = privateTooltipRequestMetadata(response?.url, target.location?.href);
            if (requestMetadata) requestMetadata.private_generation = requestGeneration;
          }
          void captureFetchResponse(response, requestMetadata);
          return response;
        });
      };
      try {
        target.fetch = hookedFetch;
        if (target.fetch !== hookedFetch) throw new Error("fetch_hook_rejected");
        installedFetchHook = hookedFetch;
        state.fetch_hooked = true;
        return true;
      } catch {
        state.fetch_hooked = false;
        return false;
      }
    }

    function ensureXhrHook() {
      const xhrPrototype = target.XMLHttpRequest?.prototype;
      if (!xhrPrototype || typeof xhrPrototype.open !== "function" || typeof xhrPrototype.send !== "function") {
        state.xhr_hooked = false;
        return false;
      }
      if (
        xhrPrototype === installedXhrPrototype &&
        xhrPrototype.open === installedXhrOpenHook &&
        xhrPrototype.send === installedXhrSendHook
      ) {
        state.xhr_hooked = true;
        return true;
      }

      const nativeOpen = xhrPrototype === installedXhrPrototype && xhrPrototype.open === installedXhrOpenHook
        ? installedXhrNativeOpen
        : xhrPrototype.open;
      const nativeSend = xhrPrototype === installedXhrPrototype && xhrPrototype.send === installedXhrSendHook
        ? installedXhrNativeSend
        : xhrPrototype.send;
      if (typeof nativeOpen !== "function" || typeof nativeSend !== "function") {
        state.xhr_hooked = false;
        return false;
      }

      const hookedOpen = function (method, url, ...args) {
        const result = Reflect.apply(nativeOpen, this, [method, url, ...args]);
        const metadata = privateTooltipRequestMetadata(url, target.location?.href);
        if (metadata) metadata.private_generation = captureGeneration;
        if (metadata) xhrRequests.set(this, { metadata, listener: null });
        else xhrRequests.delete(this);
        return result;
      };

      const hookedSend = function (...args) {
        const request = xhrRequests.get(this);
        if (request && typeof this.addEventListener === "function") {
          const xhr = this;
          const listener = () => {
            const latest = xhrRequests.get(xhr);
            if (latest !== request) return;
            xhrRequests.delete(xhr);
            captureXhrResponse(xhr, request.metadata);
          };
          request.listener = listener;
          this.addEventListener("load", listener, { once: true });
        }
        try {
          return Reflect.apply(nativeSend, this, args);
        } catch (error) {
          if (request?.listener && typeof this.removeEventListener === "function") {
            try {
              this.removeEventListener("load", request.listener);
            } catch {
              // Preserve the native exception when listener cleanup fails.
            }
          }
          xhrRequests.delete(this);
          throw error;
        }
      };

      try {
        xhrPrototype.open = hookedOpen;
        xhrPrototype.send = hookedSend;
        if (xhrPrototype.open !== hookedOpen || xhrPrototype.send !== hookedSend) {
          throw new Error("xhr_hook_rejected");
        }
        installedXhrPrototype = xhrPrototype;
        installedXhrNativeOpen = nativeOpen;
        installedXhrNativeSend = nativeSend;
        installedXhrOpenHook = hookedOpen;
        installedXhrSendHook = hookedSend;
        state.xhr_hooked = true;
        return true;
      } catch {
        state.xhr_hooked = false;
        return false;
      }
    }

    function installPerformanceRecovery() {
      const canScan = typeof target.performance?.getEntriesByType === "function";
      if (!performanceObserver && typeof target.PerformanceObserver === "function") {
        try {
          performanceObserver = new target.PerformanceObserver((entryList) => {
            const entries = entryList?.getEntries?.() || [];
            for (const entry of entries) rememberObservedTooltipRequest(entry);
          });
          try {
            performanceObserver.observe({ type: "resource", buffered: true });
          } catch {
            performanceObserver.observe({ entryTypes: ["resource"] });
          }
        } catch {
          performanceObserver = null;
        }
      }
      state.performance_recovery_available = canScan || Boolean(performanceObserver);
      scanResourceTimings();
      return state.performance_recovery_available;
    }

    function ensureHooks() {
      ensureFetchHook();
      ensureXhrHook();
      installPerformanceRecovery();
      return state.fetch_hooked || state.xhr_hooked || state.performance_recovery_available;
    }

    const api = Object.freeze({
      protocol_version: PROTOCOL_VERSION,
      channel: CHANNEL,
      getStatus() {
        ensureHooks();
        return {
          ...state,
          fetch_hook_active: Boolean(installedFetchHook && target.fetch === installedFetchHook),
          xhr_hook_active: Boolean(
            installedXhrPrototype &&
            installedXhrPrototype.open === installedXhrOpenHook &&
            installedXhrPrototype.send === installedXhrSendHook
          ),
          observed_tooltip_request_count: observedTooltipRequests.length,
          latest_observed: publicObservedRequestMetadata(
            observedTooltipRequests.length
              ? observedTooltipRequests[observedTooltipRequests.length - 1]
              : null
          ),
          cache_size: cache.length,
          latest_capture: latestCaptureMetadata,
          current_session_token: currentSessionToken(),
          latest: publicCaptureMetadata(cache.length ? cache[cache.length - 1] : null)
        };
      }
    });

    const installedRecord = { api, ensureHooks, scanResourceTimings };
    try {
      Object.defineProperty(target, INSTALL_KEY, {
        value: installedRecord,
        configurable: false,
        enumerable: false,
        writable: false
      });
    } catch {
      try {
        target[INSTALL_KEY] = installedRecord;
      } catch {
        return null;
      }
    }

    ensureHooks();

    if (typeof target.addEventListener === "function") {
      target.addEventListener("message", (event) => {
        const message = event?.data;
        if (event.source !== target ||
            (targetOrigin !== "*" && event.origin !== targetOrigin) ||
            !message || message.channel !== CHANNEL || message.source !== REQUEST_SOURCE ||
            message.type !== "request" || !SAFE_REQUEST_ID.test(String(message.request_id || ""))) {
          return;
        }

        void handleBridgeRequest(message).then(({ ok, result, error }) => {
          post({
            channel: CHANNEL,
            protocol_version: PROTOCOL_VERSION,
            source: HOOK_SOURCE,
            type: "response",
            request_id: String(message.request_id),
            ok,
            result,
            error
          });
        });
      });
    }

    function captureById(value) {
      const captureId = positiveInteger(value);
      if (!captureId) return null;
      return cache.find((entry) => entry.capture_id === captureId) || null;
    }

    function matchingCapture(message) {
      const captureId = positiveInteger(message.capture_id);
      const page = positiveInteger(message.page);
      const limit = positiveInteger(message.limit);
      const sort = safeSort(message.sort);
      const rawSessionToken = message.session_token == null ? "" : String(message.session_token);
      if (rawSessionToken && !SAFE_SESSION_TOKEN.test(rawSessionToken)) return null;
      const sessionToken = rawSessionToken || null;
      const afterCaptureId = Number.isInteger(Number(message.after_capture_id)) && Number(message.after_capture_id) >= 0
        ? Number(message.after_capture_id)
        : null;
      for (let index = cache.length - 1; index >= 0; index -= 1) {
        const entry = cache[index];
        if (captureId && entry.capture_id !== captureId) continue;
        if (sessionToken && entry.session_token !== sessionToken) continue;
        if (afterCaptureId != null && entry.capture_id <= afterCaptureId) continue;
        if (page && entry.page !== page) continue;
        if (limit && entry.limit !== limit) continue;
        if (sort && entry.sort !== sort) continue;
        return entry;
      }
      return null;
    }

    function selectedSessionToken(message) {
      if (message.session_token != null && message.session_token !== "") {
        const explicit = String(message.session_token);
        return SAFE_SESSION_TOKEN.test(explicit) ? explicit : null;
      }
      const anchorValue = message.anchor_capture_id || message.capture_id;
      if (anchorValue != null && anchorValue !== "") {
        return captureById(anchorValue)?.session_token || null;
      }
      return currentSessionToken();
    }

    async function handleBridgeRequest(message) {
      const action = String(message.action || "");
      try {
        if (action === "status") return { ok: true, result: api.getStatus(), error: null };
        if (action === "list") return { ok: true, result: { captures: cache.map(publicCaptureMetadata) }, error: null };
        if (action === "get_latest") {
          const sessionToken = selectedSessionToken(message);
          const latest = sessionToken
            ? matchingCapture({
              session_token: sessionToken,
              after_capture_id: message.after_capture_id
            })
            : null;
          return { ok: true, result: { capture: publicCapture(latest) }, error: null };
        }
        if (action === "get") {
          const capture = captureById(message.capture_id);
          const sessionToken = message.session_token == null ? null : String(message.session_token);
          const sessionMatches = !sessionToken ||
            (SAFE_SESSION_TOKEN.test(sessionToken) && capture?.session_token === sessionToken);
          return {
            ok: true,
            result: { capture: publicCapture(sessionMatches ? capture : null) },
            error: null
          };
        }
        if (action === "get_page") {
          const page = positiveInteger(message.page);
          if (!page) throw new Error("invalid_page_request");
          const sessionToken = selectedSessionToken(message);
          const capture = sessionToken
            ? matchingCapture({
              session_token: sessionToken,
              page,
              limit: message.limit,
              sort: message.sort
            })
            : null;
          return { ok: true, result: { capture: publicCapture(capture) }, error: null };
        }
        if (action === "clear") {
          captureGeneration += 1;
          performanceCutoff = numericPerformanceNow();
          cache.splice(0, cache.length);
          observedTooltipRequests.splice(0, observedTooltipRequests.length);
          observedTooltipRequestKeys.clear();
          return { ok: true, result: { cache_size: 0 }, error: null };
        }
        return { ok: false, result: null, error: "unsupported_action" };
      } catch (error) {
        return { ok: false, result: null, error: String(error?.message || error || "network_bridge_failed") };
      }
    }

    return api;
  }

  globalThis.MapleAuctionTooltipNetworkHookCore = Object.freeze({
    CHANNEL,
    DEFAULT_MAX_CACHE_ENTRIES,
    HOOK_SOURCE,
    PROTOCOL_VERSION,
    REQUEST_SOURCE,
    installTooltipNetworkHook,
    safeTooltipRequestMetadata,
    sanitizePayload
  });

  if (typeof window !== "undefined" && window === globalThis) {
    installTooltipNetworkHook(window);
  }
})();
