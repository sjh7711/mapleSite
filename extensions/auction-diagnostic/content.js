(() => {
  const GRADE_MAP = {
    레전드리: "legendary",
    유니크: "unique",
    에픽: "epic",
    레어: "rare"
  };
  const POTENTIAL_TIER_BY_RGB = new Map([
    ["rgb(204,255,0)", "legendary"],
    ["rgb(255,204,0)", "unique"],
    ["rgb(183,117,249)", "epic"],
    ["rgb(102,255,255)", "rare"]
  ]);
  const STAT_LABELS = new Map([
    ["STR", { code: "str", unit: "flat" }],
    ["DEX", { code: "dex", unit: "flat" }],
    ["INT", { code: "int", unit: "flat" }],
    ["LUK", { code: "luk", unit: "flat" }],
    ["최대 HP", { code: "hp", unit: "flat" }],
    ["최대 MP", { code: "mp", unit: "flat" }],
    ["공격력", { code: "attack", unit: "flat" }],
    ["마력", { code: "magic_attack", unit: "flat" }],
    ["방어력", { code: "defense", unit: "flat" }],
    ["이동속도", { code: "speed", unit: "flat" }],
    ["점프력", { code: "jump", unit: "flat" }],
    ["올스탯", { code: "all_stat", unit: "flat" }],
    ["데미지", { code: "damage", unit: "pct" }],
    ["보스 몬스터 공격 시 데미지", { code: "boss_damage", unit: "pct" }],
    ["몬스터 방어율 무시", { code: "ignore_defense", unit: "pct" }]
  ]);
  const POTENTIAL_CODE_MAP = new Map([
    ["STR", "STR"],
    ["DEX", "DEX"],
    ["INT", "INT"],
    ["LUK", "LUK"],
    ["올스탯", "ALL_STAT"],
    ["최대 HP", "HP"],
    ["최대 MP", "MP"],
    ["공격력", "ATTACK"],
    ["마력", "MAGIC_ATTACK"],
    ["방어력", "DEFENSE"],
    ["데미지", "DAMAGE"],
    ["보스 몬스터 공격 시 데미지", "BOSS_DAMAGE"],
    ["보스 공격 시 데미지", "BOSS_DAMAGE"],
    ["몬스터 방어율 무시", "IGNORE_DEFENSE"],
    ["방어율 무시", "IGNORE_DEFENSE"],
    ["크리티컬 확률", "CRITICAL_RATE"],
    ["크리티컬 데미지", "CRITICAL_DAMAGE"],
    ["아이템 드롭률", "ITEM_DROP_RATE"],
    ["메소 획득량", "MESO_OBTAINED"],
    ["HP 회복 아이템 및 회복 스킬 효율", "HP_RECOVERY_EFFICIENCY"],
    ["MP 회복 아이템 및 회복 스킬 효율", "MP_RECOVERY_EFFICIENCY"],
    ["상태 이상에 걸린 시간", "ABNORMAL_STATUS_DURATION"],
    ["이동속도", "SPEED"],
    ["점프력", "JUMP"],
    ["피격 후 무적시간", "INVINCIBILITY_AFTER_HIT"]
  ]);
  const AUCTION_POTENTIAL_LABEL_BY_CODE = new Map([
    ["strPercent", "STR %증가"],
    ["dexPercent", "DEX %증가"],
    ["intPercent", "INT %증가"],
    ["lukPercent", "LUK %증가"],
    ["allStatsPercent", "올스탯 %증가"],
    ["physicalAttackPercent", "공격력 %증가"],
    ["magicAttackPercent", "마력 %증가"],
    ["itemDropPercent", "아이템 획득 확률 증가"],
    ["mesosObtainedPercent", "메소 획득량 증가"]
  ]);
  const captureCore = globalThis.MapleAuctionCaptureCore;
  const TOOLTIP_NETWORK_CHANNEL = "maple-auction-tooltip-network-v2";
  const TOOLTIP_NETWORK_PROTOCOL_VERSION = 2;
  const TOOLTIP_NETWORK_REQUEST_SOURCE = "maple-auction-content-script";
  const TOOLTIP_NETWORK_HOOK_SOURCE = "maple-auction-page-hook";
  const TOOLTIP_NETWORK_BRIDGE_KEY = "__MAPLE_AUCTION_TOOLTIP_NETWORK_BRIDGE_V2__";
  const TOOLTIP_NETWORK_REQUEST_ID_PATTERN = /^[a-z0-9._:-]{1,128}$/iu;
  const TOOLTIP_NETWORK_DEFAULT_TIMEOUT_MS = 15_000;
  const TOOLTIP_NETWORK_MAX_TIMEOUT_MS = 60_000;
  const resultDocumentToken = globalThis.crypto?.randomUUID?.() ||
    `document-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const captureState = {
    originalScrollTop: null,
    filterSearchAttemptId: null,
    filterSearchPreviousUrl: null,
    filterSearchPreviousKey: null,
    filterSearchClickPromise: null,
    filterSearchClickResult: null,
    preparedFilterSearch: null,
    filterSearchResultTracker: null,
    formDiagnostic: null
  };

  // The network hook runs in the page's MAIN world. Keep this bridge in the
  // isolated world and put it on globalThis so reinjecting content.js does not
  // add another message listener or strand an earlier request table.
  const tooltipNetworkBridge = globalThis[TOOLTIP_NETWORK_BRIDGE_KEY] ||
    createTooltipNetworkBridge();
  globalThis[TOOLTIP_NETWORK_BRIDGE_KEY] = tooltipNetworkBridge;

  function currentKstDateKey(now = Date.now()) {
    return new Date(now + KST_OFFSET_MS).toISOString().slice(0, 10);
  }

  if (globalThis.__MAPLE_JSONL_MESSAGE_LISTENER__) {
    chrome.runtime.onMessage.removeListener(globalThis.__MAPLE_JSONL_MESSAGE_LISTENER__);
  }

  const messageListener = (message, _sender, sendResponse) => {
    if (message?.type === "MAPLE_AUCTION_TOOLTIP_NETWORK_STATUS") {
      void handleTooltipNetworkRuntimeRequest("status", {}, sendResponse);
      return true;
    }

    if (message?.type === "MAPLE_AUCTION_TOOLTIP_NETWORK_CLEAR") {
      void handleTooltipNetworkRuntimeRequest("clear", {}, sendResponse);
      return true;
    }

    if (message?.type === "MAPLE_AUCTION_TOOLTIP_NETWORK_GET_PAGE") {
      void handleTooltipNetworkRuntimeRequest("get_page", {
        capture_id: message.capture_id,
        page: message.page,
        limit: message.limit,
        sort: message.sort
      }, sendResponse);
      return true;
    }

    if (message?.type === "MAPLE_JSONL_LIST_ITEMS") {
      try {
        const result = listItems({
          attemptId: message.attemptId || null,
          expectedQuery: message.expectedQuery || null,
          previousDocumentToken: message.previousDocumentToken || null,
          previousPriceSearchKey: message.previousPriceSearchKey || null,
          expectedPriceSearchKey: message.expectedPriceSearchKey || null
        });
        safeSendResponse(sendResponse, { ok: true, ...result });
      } catch (error) {
        safeSendResponse(sendResponse, { ok: false, error: error.message });
      }
      return false;
    }

    if (message?.type === "MAPLE_AUCTION_CLICK_FILTER_SEARCH") {
      void scheduleFilterSearchClick(message.attemptId, message.expectedQuery, message.quotaDayKey)
        .then(
          (result) => safeSendResponse(sendResponse, { ok: true, ...result }),
          (error) => safeSendResponse(sendResponse, { ok: false, error: error.message })
        );
      return true;
    }

    if (message?.type === "MAPLE_AUCTION_PREPARE_FILTER_SEARCH") {
      void prepareCollectionFilterSearch(message.attemptId, message.expectedQuery)
        .then(
          (result) => safeSendResponse(sendResponse, { ok: true, ...result }),
          (error) => safeSendResponse(sendResponse, { ok: false, error: error.message })
        );
      return true;
    }

    if (message?.type === "MAPLE_AUCTION_ENSURE_RESULT_PAGE_SIZE") {
      void ensureResultPageSize(
        message.attemptId || null,
        message.expectedPriceSearchKey || null,
        message.expectedLimit ?? 60
      ).then(
        (result) => safeSendResponse(sendResponse, { ok: true, ...result }),
        (error) => safeSendResponse(sendResponse, { ok: false, error: error.message })
      );
      return true;
    }

    if (message?.type === "MAPLE_AUCTION_CLICK_RESULT_PAGE_NUMBER") {
      void clickResultPageNumber({
        attemptId: message.attemptId || null,
        expectedPriceSearchKey: message.expectedPriceSearchKey || null,
        expectedQuery: message.expectedQuery || null,
        currentPage: message.currentPage,
        targetPage: message.targetPage,
        expectedLimit: message.expectedLimit ?? 60,
        expectedSearchUsed: message.expectedSearchUsed,
        expectedSearchLimit: message.expectedSearchLimit
      }).then(
        (result) => safeSendResponse(sendResponse, { ok: true, ...result }),
        (error) => safeSendResponse(sendResponse, { ok: false, error: error.message })
      );
      return true;
    }

    if (message?.type === "MAPLE_AUCTION_DIAGNOSTIC_PREPARE_ONCE") {
      void prepareFilterSearchDiagnostic(message.diagnosticId, message.expectedQuery)
        .then(
          (result) => safeSendResponse(sendResponse, result),
          (error) => safeSendResponse(sendResponse, { ok: false, error: error.message })
        );
      return true;
    }

    if (message?.type === "MAPLE_AUCTION_DIAGNOSTIC_SUBMIT_ONCE") {
      void submitFilterSearchDiagnostic(message.diagnosticId, message.expectedQuery)
        .then(
          (result) => safeSendResponse(sendResponse, result),
          (error) => safeSendResponse(sendResponse, { ok: false, error: error.message })
        );
      return true;
    }

    if (message?.type === "MAPLE_AUCTION_DIAGNOSTIC_READ_RESULT") {
      try {
        safeSendResponse(sendResponse, {
          ok: true,
          result: readFilterSearchDiagnosticResult(message.expectedQuery, message.diagnosticId)
        });
      } catch (error) {
        safeSendResponse(sendResponse, { ok: false, error: error.message });
      }
      return false;
    }

    if (message?.type === "MAPLE_AUCTION_DIAGNOSTIC_ABORT") {
      abortFormDiagnostic(message.diagnosticId);
      safeSendResponse(sendResponse, { ok: true });
      return false;
    }

    if (message?.type === "MAPLE_AUCTION_OPEN_PRICE_TAB") {
      try {
        const result = openPriceTab();
        safeSendResponse(sendResponse, { ok: true, ...result });
      } catch (error) {
        safeSendResponse(sendResponse, { ok: false, error: error.message });
      }
      return false;
    }

    if (message?.type === "MAPLE_AUCTION_READ_SEARCH_USAGE") {
      safeSendResponse(sendResponse, { ok: true, usage: readSiteSearchUsage() });
      return false;
    }

    if (message?.type === "MAPLE_JSONL_CLEANUP") {
      cleanupSession();
      safeSendResponse(sendResponse, { ok: true });
      return false;
    }

    return false;
  };

  globalThis.__MAPLE_JSONL_MESSAGE_LISTENER__ = messageListener;
  chrome.runtime.onMessage.addListener(messageListener);

  function safeSendResponse(sendResponse, payload) {
    try {
      sendResponse(payload);
    } catch (_error) {
      // The extension may have been reloaded while a tooltip promise was open.
    }
  }

  function createTooltipNetworkBridge() {
    const pending = new Map();
    const captureMetadata = new Map();
    let requestSequence = 0;

    function validBridgeMessage(event) {
      const message = event?.data;
      return event?.source === window &&
        event?.origin === location.origin &&
        message && typeof message === "object" &&
        message.channel === TOOLTIP_NETWORK_CHANNEL &&
        message.protocol_version === TOOLTIP_NETWORK_PROTOCOL_VERSION &&
        message.source === TOOLTIP_NETWORK_HOOK_SOURCE;
    }

    function rememberCaptureMetadata(capture) {
      if (!capture || typeof capture !== "object") return;
      const captureId = Number(capture.capture_id);
      const page = Number(capture.page);
      const limit = Number(capture.limit);
      const sort = String(capture.sort || "").trim().toUpperCase();
      if (!Number.isInteger(captureId) || captureId <= 0 || captureId > 0x7fffffff ||
          !Number.isInteger(page) || page <= 0 || page > 0x7fffffff ||
          !Number.isInteger(limit) || limit <= 0 || limit > 1000 ||
          !/^[A-Z0-9_]{1,64}$/u.test(sort)) {
        return;
      }
      captureMetadata.set(captureId, {
        capture_id: captureId,
        captured_at: typeof capture.captured_at === "string" ? capture.captured_at : null,
        transport: typeof capture.transport === "string" ? capture.transport : null,
        page,
        limit,
        sort
      });
      if (captureMetadata.size > 50) {
        captureMetadata.delete(captureMetadata.keys().next().value);
      }
    }

    function rejectPending(error) {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(error);
      }
      pending.clear();
    }

    function onMessage(event) {
      if (!validBridgeMessage(event)) return;
      const message = event.data;
      if (message.type === "capture_available") {
        rememberCaptureMetadata(message.capture);
        return;
      }
      if (message.type !== "response" ||
          typeof message.request_id !== "string" ||
          !TOOLTIP_NETWORK_REQUEST_ID_PATTERN.test(message.request_id) ||
          typeof message.ok !== "boolean") {
        return;
      }
      const request = pending.get(message.request_id);
      if (!request) return;
      pending.delete(message.request_id);
      clearTimeout(request.timer);
      if (message.ok) request.resolve(message.result ?? null);
      else request.reject(new Error(typeof message.error === "string" && message.error
        ? message.error
        : "tooltip_network_bridge_failed"));
    }

    window.addEventListener("message", onMessage);

    function request(action, params = {}, options = {}) {
      const normalizedAction = String(action || "");
      if (!["status", "clear", "get_page"].includes(normalizedAction)) {
        return Promise.reject(new Error("unsupported_tooltip_network_action"));
      }
      const timeoutValue = Number(options.timeout_ms ?? TOOLTIP_NETWORK_DEFAULT_TIMEOUT_MS);
      const timeoutMs = Number.isFinite(timeoutValue)
        ? Math.max(1, Math.min(TOOLTIP_NETWORK_MAX_TIMEOUT_MS, Math.floor(timeoutValue)))
        : TOOLTIP_NETWORK_DEFAULT_TIMEOUT_MS;
      const requestId = `bridge-${Date.now().toString(36)}-${(++requestSequence).toString(36)}`;
      const message = {
        channel: TOOLTIP_NETWORK_CHANNEL,
        protocol_version: TOOLTIP_NETWORK_PROTOCOL_VERSION,
        source: TOOLTIP_NETWORK_REQUEST_SOURCE,
        type: "request",
        request_id: requestId,
        action: normalizedAction,
        ...params
      };
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          if (!pending.delete(requestId)) return;
          reject(new Error(`tooltip_network_timeout:${normalizedAction}`));
        }, timeoutMs);
        pending.set(requestId, { resolve, reject, timer });
        try {
          window.postMessage(message, location.origin);
        } catch (error) {
          pending.delete(requestId);
          clearTimeout(timer);
          reject(error);
        }
      });
    }

    return Object.freeze({
      request,
      getPendingCount: () => pending.size,
      getCaptureMetadata: (captureId) => captureMetadata.get(Number(captureId)) || null,
      rejectPending
    });
  }

  async function handleTooltipNetworkRuntimeRequest(action, params, sendResponse) {
    try {
      const normalized = validateTooltipNetworkRuntimeParams(action, params);
      const result = await tooltipNetworkBridge.request(action, normalized, {
        timeout_ms: TOOLTIP_NETWORK_DEFAULT_TIMEOUT_MS
      });
      safeSendResponse(sendResponse, { ok: true, ...(result && typeof result === "object" ? result : { result }) });
    } catch (error) {
      safeSendResponse(sendResponse, {
        ok: false,
        error: String(error?.message || error || "tooltip_network_bridge_failed")
      });
    }
  }

  function validateTooltipNetworkRuntimeParams(action, params = {}) {
    if (action === "status" || action === "clear") return {};
    const captureId = params.capture_id == null || params.capture_id === ""
      ? null
      : Number(params.capture_id);
    const page = params.page == null || params.page === "" ? null : Number(params.page);
    const limit = params.limit == null || params.limit === "" ? null : Number(params.limit);
    const sort = params.sort == null || params.sort === ""
      ? null
      : String(params.sort).trim().toUpperCase();
    if (captureId != null && (!Number.isInteger(captureId) || captureId <= 0 || captureId > 0x7fffffff)) {
      throw new Error("invalid_tooltip_capture_id");
    }
    if (page != null && (!Number.isInteger(page) || page <= 0 || page > 0x7fffffff)) {
      throw new Error("invalid_tooltip_page");
    }
    if (limit != null && (!Number.isInteger(limit) || limit <= 0 || limit > 1000)) {
      throw new Error("invalid_tooltip_limit");
    }
    if (sort != null && !/^[A-Z0-9_]{1,64}$/u.test(sort)) {
      throw new Error("invalid_tooltip_sort");
    }
    return {
      ...(captureId == null ? {} : { capture_id: captureId }),
      ...(page == null ? {} : { page }),
      ...(limit == null ? {} : { limit }),
      ...(sort == null ? {} : { sort })
    };
  }

  function openPriceTab() {
    if (/^\/price(?:\/|$)/u.test(location.pathname)) {
      return { already_open: true, clicked: false };
    }
    const control = findPriceTabControl();
    if (!control) throw new Error("상단 메뉴에서 '시세' 탭을 찾지 못했습니다.");
    setTimeout(() => {
      const liveControl = control.isConnected && isVisibleElement(control)
        ? control
        : findPriceTabControl();
      liveControl?.focus();
      liveControl?.click();
    }, 0);
    return { already_open: false, clicked: true };
  }

  function findPriceTabControl() {
    const links = Array.from(document.querySelectorAll('a[href]'))
      .filter(isVisibleElement)
      .filter((element) => cleanText(element.textContent) === "시세")
      .filter((element) => {
        try {
          return new URL(element.href, location.href).pathname === "/price";
        } catch (_error) {
          return false;
        }
      });
    if (links.length === 1) return links[0];
    if (links.length > 1) return links.sort((left, right) => left.childElementCount - right.childElementCount)[0];

    const controls = Array.from(document.querySelectorAll('button, [role="tab"], [role="link"]'))
      .filter(isVisibleElement)
      .filter((element) => cleanText(element.textContent) === "시세");
    return controls.sort((left, right) => {
      const leftPriority = left.closest("header, nav, [role='tablist']") ? 0 : 1;
      const rightPriority = right.closest("header, nav, [role='tablist']") ? 0 : 1;
      return leftPriority - rightPriority ||
        left.getBoundingClientRect().top - right.getBoundingClientRect().top ||
        left.childElementCount - right.childElementCount;
    })[0] || null;
  }

  function listItems(options = {}) {
    const rows = findListingRows();
    const emptyResult = rows.length === 0 && hasVisibleEmptyResultMarker();
    const resultReadiness = options.expectedQuery
      ? readCollectionResultReadiness(rows, emptyResult, options)
      : null;
    if (rows.length === 0 && !emptyResult) {
      if (resultReadiness) {
        return {
          items: [],
          capture: collectCaptureContext(rows, resultReadiness),
          result_document_token: resultDocumentToken,
          empty: false,
          pending: true
        };
      }
      throw new Error("현재 페이지에서 가격이 표시된 장비 매물을 찾지 못했습니다.");
    }

    if (resultReadiness && resultReadiness.candidate_ready !== true) {
      return {
        items: [],
        capture: collectCaptureContext(rows, resultReadiness),
        result_document_token: resultDocumentToken,
        empty: false,
        pending: true
      };
    }

    const scrollRoot = document.getElementById("scroll-root");
    if (captureState.originalScrollTop == null) {
      captureState.originalScrollTop = scrollRoot?.scrollTop || 0;
    }

    return {
      items: rows.map((row, index) => describeListingRow(row, index, rows.length)),
      capture: collectCaptureContext(rows, resultReadiness),
      result_document_token: resultDocumentToken,
      empty: emptyResult
    };
  }

  async function prepareFilterSearchDiagnostic(diagnosticId, expectedQuery) {
    if (typeof diagnosticId !== "string" || !diagnosticId) {
      throw new Error("진단 실행 ID가 없습니다.");
    }
    expireFormDiagnostic();
    const existing = captureState.formDiagnostic;
    if (existing?.id === diagnosticId) {
      if (existing.phase === "preparing") {
        await waitUntil(() => existing.phase !== "preparing", 12_000);
      }
      if (existing.phase === "prepared") {
        return { ok: true, already_prepared: true, report: publicDiagnosticReport(existing.report) };
      }
      if (existing.phase === "failed") {
        return { ok: false, error: "이 진단 준비는 이미 실패했습니다.", report: publicDiagnosticReport(existing.report) };
      }
      throw new Error("같은 진단 요청을 처리하고 있습니다.");
    }
    if (existing && ["preparing", "prepared", "dispatching", "clicked"].includes(existing.phase)) {
      throw new Error("다른 필터 진단이 아직 끝나지 않았습니다.");
    }
    if (captureState.filterSearchAttemptId || captureState.preparedFilterSearch) {
      throw new Error("일반 수집 검색이 진행 중이라 진단할 수 없습니다.");
    }
    if (!filterRequestMatchesCurrentUrl(expectedQuery)) {
      throw new Error("현재 화면이 시세 탭이 아니어서 검색 필터를 진단할 수 없습니다.");
    }

    const report = {
      schema_version: "maple-auction.form-diagnostic.v1",
      outcome: "preparing",
      total_elapsed_ms: 0,
      steps: []
    };
    const state = {
      id: diagnosticId,
      phase: "preparing",
      createdAt: Date.now(),
      startedAt: performance.now(),
      expectedQuery: copyDiagnosticQuery(expectedQuery),
      report,
      resultMutationObserved: false,
      resultObserver: null
    };
    captureState.formDiagnostic = state;

    try {
      const button = findFilterSearchButton();
      if (!button) throw new Error("세부 조건의 '필터 검색' 버튼을 찾지 못했습니다.");
      assertFilterSearchButtonReady(button);
      await prepareFilterSearchForm(button, expectedQuery, report.steps);
      state.phase = "prepared";
      report.outcome = "prepared";
      report.total_elapsed_ms = Math.round(performance.now() - state.startedAt);
      return { ok: true, report: publicDiagnosticReport(report) };
    } catch (error) {
      state.phase = "failed";
      report.outcome = "failed";
      report.total_elapsed_ms = Math.round(performance.now() - state.startedAt);
      return {
        ok: false,
        error: error.message,
        report: publicDiagnosticReport(report)
      };
    }
  }

  async function submitFilterSearchDiagnostic(diagnosticId, expectedQuery) {
    expireFormDiagnostic();
    const state = captureState.formDiagnostic;
    if (!state || state.id !== diagnosticId || !diagnosticQueriesEqual(state.expectedQuery, expectedQuery)) {
      throw new Error("준비된 진단과 제출할 검색 조건이 일치하지 않습니다.");
    }
    if (state.phase === "dispatching" && state.clickPromise) {
      const clickResult = await state.clickPromise;
      return {
        ok: true,
        already_dispatched: true,
        ...clickResult,
        report: publicDiagnosticReport(state.report)
      };
    }
    if (state.phase === "clicked") {
      return {
        ok: true,
        already_dispatched: true,
        ...(state.clickResult || {}),
        report: publicDiagnosticReport(state.report)
      };
    }
    if (state.phase !== "prepared") {
      throw new Error("필터 입력 진단이 준비되지 않았습니다.");
    }

    try {
      await measuredDiagnosticStep(state.report.steps, "submit", async () => {
        const button = findFilterSearchButton();
        if (!button) throw new Error("필터 값을 적용한 뒤 '필터 검색' 버튼을 다시 찾지 못했습니다.");
        assertFilterSearchButtonReady(button);
        const panel = findFilterPanel(button);
        if (!panel || !filterFormMatchesExpected(readFilterFormState(panel, expectedQuery), expectedQuery)) {
          throw new Error("검색 직전 필터 값이 진단 조건과 달라졌습니다.");
        }
        observeDiagnosticResultMutations(state);
        state.phase = "dispatching";
        state.clickPromise = dispatchFilterSearchButtonClick(button, expectedQuery, () =>
          captureState.formDiagnostic === state && state.phase === "dispatching"
        );
        const clickResult = await state.clickPromise;
        state.clickResult = clickResult;
        state.phase = "clicked";
        return clickResult;
      });
      state.report.outcome = "submitted";
      state.report.total_elapsed_ms = Math.round(performance.now() - state.startedAt);
      return {
        ok: true,
        ...(state.clickResult || {}),
        report: publicDiagnosticReport(state.report)
      };
    } catch (error) {
      state.phase = "failed";
      state.report.outcome = "failed";
      state.report.total_elapsed_ms = Math.round(performance.now() - state.startedAt);
      return { ok: false, error: error.message, report: publicDiagnosticReport(state.report) };
    }
  }

  async function prepareCollectionFilterSearch(attemptId, expectedQuery) {
    if (typeof attemptId !== "string" || !attemptId) {
      throw new Error("필터 검색 시도 ID가 없습니다.");
    }
    expireFormDiagnostic();
    if (captureState.formDiagnostic && ["preparing", "prepared", "dispatching", "clicked"].includes(captureState.formDiagnostic.phase)) {
      throw new Error("필터 입력 진단이 진행 중이라 일반 검색을 준비할 수 없습니다.");
    }
    if (captureState.filterSearchAttemptId) {
      throw new Error("필터 검색 클릭을 처리하고 있어 입력 폼을 다시 준비하지 않습니다.");
    }
    if (!filterRequestMatchesCurrentUrl(expectedQuery)) {
      throw new Error("현재 화면이 시세 탭이 아니어서 검색 필터를 입력할 수 없습니다.");
    }
    const prepared = captureState.preparedFilterSearch;
    if (
      prepared?.attemptId === attemptId &&
      diagnosticQueriesEqual(prepared.expectedQuery, expectedQuery)
    ) {
      try {
        const currentButton = findFilterSearchButton();
        const currentPanel = findFilterPanel(currentButton);
        const currentForm = currentPanel ? readFilterFormState(currentPanel, expectedQuery) : null;
        if (
          currentButton && currentPanel &&
          filterFormMatchesExpected(currentForm, expectedQuery)
        ) {
          return {
            prepared: true,
            already_prepared: true,
            verified_form: currentForm
          };
        }
      } catch (_error) {
        // React가 입력 폼을 교체한 경우 아래에서 처음부터 다시 준비합니다.
      }
    }
    captureState.preparedFilterSearch = null;
    const button = findFilterSearchButton();
    if (!button) throw new Error("세부 조건의 '필터 검색' 버튼을 찾지 못했습니다.");
    assertFilterSearchButtonReady(button);
    const verifiedForm = await prepareFilterSearchForm(button, expectedQuery);
    captureState.preparedFilterSearch = {
      attemptId,
      expectedQuery: copyDiagnosticQuery(expectedQuery),
      verifiedForm,
      preparedAt: Date.now()
    };
    return { prepared: true, verified_form: verifiedForm };
  }

  async function scheduleFilterSearchClick(attemptId, expectedQuery, quotaDayKey = null) {
    if (typeof attemptId !== "string" || !attemptId) {
      throw new Error("필터 검색 시도 ID가 없습니다.");
    }
    expireFormDiagnostic();
    if (captureState.formDiagnostic && ["preparing", "prepared", "dispatching", "clicked"].includes(captureState.formDiagnostic.phase)) {
      throw new Error("필터 입력 진단이 진행 중이라 일반 검색을 시작할 수 없습니다.");
    }
    if (captureState.filterSearchAttemptId === attemptId) {
      if (captureState.filterSearchClickPromise) {
        const result = await captureState.filterSearchClickPromise;
        return { ...result, already_dispatched: true };
      }
      return {
        ...(captureState.filterSearchClickResult || {}),
        clicked: captureState.filterSearchClickResult?.clicked === true,
        already_dispatched: true,
        button_text: "필터 검색",
        previous_url: captureState.filterSearchPreviousUrl || null,
        previous_price_search_key: captureState.filterSearchPreviousKey || null
      };
    }
    if (captureState.filterSearchAttemptId) {
      throw new Error("다른 필터 검색 클릭을 처리하고 있습니다.");
    }
    if (!filterRequestMatchesCurrentUrl(expectedQuery)) {
      throw new Error("현재 화면이 시세 탭이 아니어서 검색 필터를 입력할 수 없습니다.");
    }

    const prepared = captureState.preparedFilterSearch;
    if (
      !prepared || prepared.attemptId !== attemptId ||
      !diagnosticQueriesEqual(prepared.expectedQuery, expectedQuery)
    ) {
      throw new Error("이 시도에 대해 준비된 검색 필터가 없거나 조건이 다릅니다.");
    }

    const previousUrl = location.href;
    const previousPriceSearchKey = new URL(previousUrl).searchParams.get("priceSearchKey") || null;
    let button = findFilterSearchButton();
    if (!button) {
      throw new Error("세부 조건의 '필터 검색' 버튼을 찾지 못했습니다.");
    }
    assertFilterSearchButtonReady(button);
    const preparedPanel = findFilterPanel(button);
    if (!preparedPanel || !filterFormMatchesExpected(readFilterFormState(preparedPanel, expectedQuery), expectedQuery)) {
      throw new Error("준비 후 검색 직전의 필터 값이 바뀌었습니다. 잘못된 조건으로 검색하지 않습니다.");
    }
    const formState = readFilterFormState(preparedPanel, expectedQuery);

    captureState.filterSearchAttemptId = attemptId;
    captureState.filterSearchPreviousUrl = previousUrl;
    captureState.filterSearchPreviousKey = previousPriceSearchKey;
    captureState.filterSearchClickResult = null;
    captureState.preparedFilterSearch = null;
    captureState.filterSearchClickPromise = (async () => {
      button = findFilterSearchButton();
      if (!button) throw new Error("필터 값을 적용한 뒤 '필터 검색' 버튼을 다시 찾지 못했습니다.");
      assertFilterSearchButtonReady(button);
      const clickResult = await dispatchFilterSearchButtonClick(
        button,
        expectedQuery,
        () => captureState.filterSearchAttemptId === attemptId,
        () => {
          if (quotaDayKey && quotaDayKey !== currentKstDateKey()) {
            throw new Error("KST 날짜가 바뀌어 이전 날짜의 검색 예약을 실행하지 않습니다.");
          }
          beginCollectionResultTracking(attemptId);
        }
      );
      return {
        ...clickResult,
        already_applied: false,
        button_text: "필터 검색",
        reset_clicked: true,
        previous_url: previousUrl,
        previous_price_search_key: previousPriceSearchKey,
        result_document_token: resultDocumentToken,
        verified_form: formState
      };
    })();

    try {
      const result = await captureState.filterSearchClickPromise;
      captureState.filterSearchClickResult = result;
      captureState.filterSearchClickPromise = null;
      return result;
    } catch (error) {
      if (captureState.filterSearchAttemptId === attemptId) {
        captureState.filterSearchAttemptId = null;
        captureState.filterSearchPreviousUrl = null;
        captureState.filterSearchPreviousKey = null;
        captureState.filterSearchClickPromise = null;
        captureState.filterSearchClickResult = null;
      }
      throw error;
    }
  }

  function assertFilterSearchButtonReady(button) {
    if (button.disabled || button.getAttribute("aria-disabled") === "true") {
      throw new Error("세부 조건을 불러오는 중이라 '필터 검색' 버튼을 아직 누를 수 없습니다.");
    }
    if (button.closest('[aria-busy="true"]') || getComputedStyle(button).pointerEvents === "none") {
      throw new Error("세부 조건 검색 화면이 아직 준비되지 않았습니다.");
    }
  }

  async function dispatchFilterSearchButtonClick(
    initialButton,
    expectedQuery,
    isStillActive = () => true,
    beforeClick = null
  ) {
    let lastError = null;
    for (let attempts = 0; attempts < 20; attempts += 1) {
      try {
        if (!isStillActive()) throw new Error("필터 검색 클릭 요청이 취소되었습니다.");
        const liveButton = initialButton.isConnected && isVisibleElement(initialButton)
          ? initialButton
          : findFilterSearchButton();
        if (!liveButton) throw new Error("필터 검색 버튼이 렌더링되지 않았습니다.");
        assertFilterSearchButtonReady(liveButton);
        const panel = findFilterPanel(liveButton);
        if (!panel || !filterFormMatchesExpected(readFilterFormState(panel, expectedQuery), expectedQuery)) {
          throw new Error("검색 직전 필터 값이 요청 조건과 달라졌거나 다른 조건이 남아 있습니다.");
        }
        if (beforeClick) beforeClick();

        let clickDispatched = false;
        const onClick = (event) => {
          const path = typeof event.composedPath === "function" ? event.composedPath() : [];
          if (path.includes(liveButton) || event.target === liveButton || liveButton.contains(event.target)) {
            clickDispatched = true;
          }
        };
        document.addEventListener("click", onClick, true);
        try {
          liveButton.focus();
          liveButton.click();
        } finally {
          document.removeEventListener("click", onClick, true);
        }
        if (!clickDispatched) throw new Error("필터 검색 클릭 이벤트가 전달되지 않았습니다.");
        return {
          clicked: true,
          click_dispatched: true,
          // Kept for manager compatibility; this flag is now returned only
          // after the click event has actually been dispatched.
          click_scheduled: true
        };
      } catch (error) {
        lastError = error;
        if (/(?:취소되었습니다|KST 날짜가 바뀌어)/u.test(error.message)) break;
        await delay(50);
      }
    }
    throw lastError || new Error("필터 검색 버튼을 클릭하지 못했습니다.");
  }

  async function prepareFilterSearchForm(button, expectedQuery, diagnosticSteps = null) {
    let panel;
    if (Array.isArray(diagnosticSteps)) {
      panel = await measuredDiagnosticStep(diagnosticSteps, "panel_discovery", async () => {
        const found = findFilterPanel(button);
        if (!found) throw new Error("검색 필터 입력 영역을 찾지 못했습니다.");
        return found;
      }, () => ({ control_found: true, visible: true }));
    } else {
      panel = findFilterPanel(button);
      if (!panel) throw new Error("검색 필터 입력 영역을 찾지 못했습니다.");
    }

    await measuredDiagnosticStep(diagnosticSteps, "reset", async () => {
      const resetButton = panel.querySelector('button[aria-label="초기화"]');
      if (!resetButton || !isVisibleElement(resetButton) || resetButton.disabled) {
        throw new Error("이전 검색 조건을 지울 초기화 버튼을 찾지 못했습니다.");
      }
      resetButton.click();
      await delay(120);
      let stableSince = null;
      const resetReady = await waitUntil(() => {
        const latestButton = findFilterSearchButton();
        const latestPanel = findFilterPanel(latestButton);
        if (!latestPanel || !findKeywordSearchInput(latestPanel) || latestButton?.disabled) {
          stableSince = null;
          return false;
        }
        try {
          const controlsReady = Boolean(
            findPriceInputs(latestPanel) &&
            findStarforceInputs(latestPanel) &&
            findPotentialControls(latestPanel)
          );
          const noUnexpectedFilters = unexpectedFilterSelections(latestPanel).length === 0;
          if (!controlsReady || !noUnexpectedFilters) {
            stableSince = null;
            return false;
          }
          stableSince ??= Date.now();
          return Date.now() - stableSince >= 200;
        } catch (_error) {
          stableSince = null;
          return false;
        }
      }, 4_000);
      if (!resetReady) {
        const latestPanel = findFilterPanel(findFilterSearchButton());
        const residual = latestPanel ? unexpectedFilterSelections(latestPanel) : [];
        throw new Error(residual.length > 0
          ? `검색 필터 초기화 후 이전 조건이 남아 있습니다: ${residual.join(", ")}`
          : "검색 필터 초기화 상태가 안정되지 않아 확인하지 못했습니다.");
      }
      return { control_found: true, enabled: true, reset_completed: true };
    });

    panel = findFilterPanel(findFilterSearchButton());
    if (!panel) throw new Error("검색 조건을 초기화한 뒤 필터 입력 영역을 찾지 못했습니다.");
    await measuredDiagnosticStep(diagnosticSteps, "item_category", async () => {
      await setItemCategoryFilter(panel, expectedQuery);
      const latestPanel = findFilterPanel(findFilterSearchButton());
      return {
        observed_item_category: readItemCategorySelection(latestPanel)
      };
    });

    panel = findFilterPanel(findFilterSearchButton());
    if (!panel) throw new Error("상위 장비 분류를 선택한 뒤 필터 입력 영역을 다시 찾지 못했습니다.");
    await measuredDiagnosticStep(diagnosticSteps, "equipment_subcategory", async () => {
      await setEquipmentSubcategoryFilter(panel, expectedQuery);
      const latestPanel = findFilterPanel(findFilterSearchButton());
      return {
        observed_equipment_subcategory: readEquipmentSubcategorySelection(latestPanel)
      };
    });

    panel = findFilterPanel(findFilterSearchButton());
    if (!panel) throw new Error("장비 분류를 선택한 뒤 필터 입력 영역을 다시 찾지 못했습니다.");
    await measuredDiagnosticStep(diagnosticSteps, "exact_keyword", () =>
      setFilterKeyword(panel, expectedQuery.keyword, expectedQuery.exact_match !== false)
    );

    panel = findFilterPanel(findFilterSearchButton());
    if (!panel) throw new Error("장비명을 선택한 뒤 필터 입력 영역을 다시 찾지 못했습니다.");
    await setPriceFormValues(panel, expectedQuery);

    panel = findFilterPanel(findFilterSearchButton());
    if (!panel) throw new Error("가격을 입력한 뒤 필터 입력 영역을 다시 찾지 못했습니다.");
    await measuredDiagnosticStep(diagnosticSteps, "starforce", async () => {
      await setStarforceFormValues(panel, expectedQuery);
      const latestPanel = findFilterPanel(findFilterSearchButton());
      const inputs = findStarforceInputs(latestPanel);
      return {
        observed_starforce_min: parseFormInteger(inputs?.minimum?.value),
        observed_starforce_max: parseFormInteger(inputs?.maximum?.value)
      };
    });

    await measuredDiagnosticStep(diagnosticSteps, "potential", async () => {
      await setPotentialFormValues(expectedQuery);
      const latestPanel = findFilterPanel(findFilterSearchButton());
      const controls = findPotentialControls(latestPanel);
      const label = potentialSelectionLabel(controls?.combobox);
      return {
        observed_potential_code: potentialCodeFromLabel(label),
        observed_potential_min: parseFormInteger(controls?.minimum?.value),
        aggregate_checked: controls?.aggregate?.getAttribute("aria-checked") === "true"
      };
    });

    await delay(80);
    panel = findFilterPanel(findFilterSearchButton());
    const current = await measuredDiagnosticStep(diagnosticSteps, "final_form_verified", async () => {
      const actual = readFilterFormState(panel, expectedQuery);
      if (!filterFormMatchesExpected(actual, expectedQuery)) {
        throw new Error(`필터 화면을 요청 조건으로 맞추지 못했습니다. 실제 값: ${formatFilterFormState(actual)}`);
      }
      return actual;
    }, (actual) => ({
      exact_tag_matches: filterKeywordMatchesExpected(actual, expectedQuery),
      observed_item_category: actual.item_category_filter,
      observed_equipment_subcategory: actual.equipment_subcategory,
      observed_starforce_min: actual.starforce_min,
      observed_starforce_max: actual.starforce_max,
      observed_potential_code: actual.potential_code,
      observed_potential_min: actual.potential_min,
      aggregate_checked: actual.potential_aggregate,
      form_matches: true
    }));
    return current;
  }

  const DIAGNOSTIC_EVIDENCE_KEYS = new Set([
    "control_found",
    "visible",
    "enabled",
    "reset_completed",
    "page_size_control_found",
    "observed_page_limit",
    "page_size_changed",
    "keyword_input_found",
    "controlled_popup_found",
    "exact_candidate_found",
    "exact_tag_matches",
    "observed_item_category",
    "observed_equipment_subcategory",
    "observed_starforce_min",
    "observed_starforce_max",
    "observed_potential_code",
    "observed_potential_min",
    "aggregate_checked",
    "form_matches",
    "click_dispatched",
    "click_scheduled"
  ]);

  async function measuredDiagnosticStep(steps, name, operation, evidenceMapper = null) {
    if (!Array.isArray(steps)) return operation();
    const startedAt = performance.now();
    try {
      const value = await operation();
      const evidence = evidenceMapper ? evidenceMapper(value) : value;
      steps.push({
        name,
        ok: true,
        elapsed_ms: Math.max(0, Math.round(performance.now() - startedAt)),
        evidence: sanitizeDiagnosticEvidence(evidence)
      });
      return value;
    } catch (error) {
      steps.push({
        name,
        ok: false,
        elapsed_ms: Math.max(0, Math.round(performance.now() - startedAt)),
        evidence: {},
        error_code: diagnosticErrorCode(name, error)
      });
      throw error;
    }
  }

  function sanitizeDiagnosticEvidence(value) {
    if (!value || typeof value !== "object") return {};
    const safe = {};
    for (const [key, candidate] of Object.entries(value)) {
      if (!DIAGNOSTIC_EVIDENCE_KEYS.has(key)) continue;
      if (key === "observed_potential_code") {
        safe[key] = AUCTION_POTENTIAL_LABEL_BY_CODE.has(candidate) ? candidate : "unknown";
        continue;
      }
      if (candidate == null || ["boolean", "number", "string"].includes(typeof candidate)) {
        safe[key] = typeof candidate === "string" ? candidate.slice(0, 40) : candidate;
      }
    }
    return safe;
  }

  function diagnosticErrorCode(name, error) {
    const message = String(error?.message || "");
    if (/초기화/u.test(message)) return "reset_failed";
    if (/개씩\s*보기|페이지\s*표시/u.test(message)) return "page_size_failed";
    if (/자동완성/u.test(message)) return "autocomplete_exact_missing";
    if (/정확히 일치/u.test(message)) return "exact_tag_missing";
    if (/상위 장비 분류/u.test(message)) return "item_category_failed";
    if (/장비 분류|하위 분류|장신구|방어구/u.test(message)) return "equipment_subcategory_failed";
    if (/스타포스/u.test(message)) return "starforce_failed";
    if (/잠재능력/u.test(message)) return "potential_failed";
    if (/합산/u.test(message)) return "aggregate_failed";
    if (/필터 검색/u.test(message)) return "filter_submit_failed";
    return `${String(name || "unknown").replace(/[^a-z0-9_]/giu, "_")}_failed`;
  }

  function publicDiagnosticReport(report) {
    return {
      schema_version: "maple-auction.form-diagnostic.v1",
      outcome: ["preparing", "prepared", "submitted", "failed"].includes(report?.outcome)
        ? report.outcome
        : "failed",
      total_elapsed_ms: Number.isFinite(report?.total_elapsed_ms)
        ? Math.max(0, Math.round(report.total_elapsed_ms))
        : 0,
      steps: Array.isArray(report?.steps) ? report.steps.map((step) => ({
        name: String(step?.name || "unknown").replace(/[^a-z0-9_]/giu, "_").slice(0, 48),
        ok: step?.ok === true,
        elapsed_ms: Number.isFinite(step?.elapsed_ms) ? Math.max(0, Math.round(step.elapsed_ms)) : 0,
        evidence: sanitizeDiagnosticEvidence(step?.evidence),
        ...(step?.error_code ? {
          error_code: String(step.error_code).replace(/[^a-z0-9_]/giu, "_").slice(0, 64)
        } : {})
      })) : []
    };
  }

  function copyDiagnosticQuery(query = {}) {
    return {
      keyword: String(query.keyword || "").trim(),
      search_scope: query.search_scope === "catalog_global" ? "catalog_global" : null,
      exact_match: query.exact_match !== false,
      item_category_filter: normalizeItemCategoryFilter(query.item_category_filter),
      equipment_subcategory_filter: normalizeEquipmentSubcategory(
        query.equipment_subcategory_filter
      ),
      allowed_names: Array.isArray(query.allowed_names)
        ? query.allowed_names.map((name) => String(name || "").trim()).filter(Boolean)
        : [],
      page: Number.isInteger(query.page) && query.page > 0 ? query.page : 1,
      page_limit: Number.isInteger(query.page_limit) ? query.page_limit : 60,
      starforce_min: query.starforce_min ?? null,
      starforce_max: query.starforce_max ?? null,
      price_min_meso: query.price_min_meso ?? null,
      price_max_meso: query.price_max_meso ?? null,
      server_filter: query.server_filter ? {
        code: query.server_filter.code ?? null,
        minimum: query.server_filter.minimum ?? null
      } : null
    };
  }

  function diagnosticQueriesEqual(left, right) {
    const expected = copyDiagnosticQuery(left);
    const actual = copyDiagnosticQuery(right);
    return expected.keyword === actual.keyword &&
      expected.search_scope === actual.search_scope &&
      expected.exact_match === actual.exact_match &&
      expected.item_category_filter === actual.item_category_filter &&
      expected.equipment_subcategory_filter === actual.equipment_subcategory_filter &&
      expected.page_limit === actual.page_limit &&
      expected.starforce_min === actual.starforce_min &&
      expected.starforce_max === actual.starforce_max &&
      expected.price_min_meso === actual.price_min_meso &&
      expected.price_max_meso === actual.price_max_meso &&
      expected.server_filter?.code === actual.server_filter?.code &&
      expected.server_filter?.minimum === actual.server_filter?.minimum;
  }

  function expireFormDiagnostic() {
    const diagnostic = captureState.formDiagnostic;
    if (diagnostic && Date.now() - diagnostic.createdAt > 90_000) {
      abortFormDiagnostic(diagnostic.id);
    }
  }

  function observeDiagnosticResultMutations(state) {
    state.resultObserver?.disconnect();
    state.resultMutationObserved = false;
    state.resultUrlBeforeSubmit = location.href;
    const rows = findListingRows();
    const root = rows[0]?.parentElement || findFilterSearchButton()?.closest("main, #main-container") ||
      document.querySelector("#main-container, main") || document.body;
    if (!root || typeof MutationObserver !== "function") return;
    state.resultObserver = new MutationObserver(() => {
      state.resultMutationObserved = true;
    });
    state.resultObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-busy", "aria-disabled"]
    });
  }

  function beginCollectionResultTracking(attemptId) {
    captureState.filterSearchResultTracker?.observer?.disconnect();
    const rows = findListingRows();
    const emptyMarker = findVisibleEmptyResultMarkerElement();
    const tracker = {
      attemptId,
      baselineSignature: resultDomSignature(rows, Boolean(emptyMarker)),
      baselinePrimaryNode: rows[0] || emptyMarker || null,
      resultMutationObserved: false,
      sawResultInvalidated: false,
      lastMutationAt: null,
      observer: null
    };
    const root = findResultObservationRoot(rows, emptyMarker);
    if (root && typeof MutationObserver === "function") {
      tracker.observer = new MutationObserver(() => {
        tracker.resultMutationObserved = true;
        tracker.lastMutationAt = Date.now();
        const currentRows = findListingRows();
        const currentEmpty = hasVisibleEmptyResultMarker();
        if (
          isResultViewBusy() ||
          !findFilterSearchResultHeadingElement() ||
          (currentRows.length === 0 && !currentEmpty)
        ) {
          tracker.sawResultInvalidated = true;
        }
      });
      tracker.observer.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["aria-busy", "aria-disabled", "class"]
      });
    }
    captureState.filterSearchResultTracker = tracker;
  }

  function findResultObservationRoot(rows, emptyMarker) {
    const primary = rows[0] || emptyMarker || null;
    const heading = findFilterSearchResultHeadingElement();
    if (primary && heading) {
      const ancestors = new Set();
      for (let node = primary; node; node = node.parentElement) ancestors.add(node);
      for (let node = heading; node; node = node.parentElement) {
        if (ancestors.has(node)) return node;
      }
    }
    return primary?.parentElement?.parentElement || heading?.parentElement?.parentElement ||
      document.querySelector("#main-container, main") || document.body;
  }

  function abortFormDiagnostic(diagnosticId = null) {
    const diagnostic = captureState.formDiagnostic;
    if (!diagnostic || (diagnosticId && diagnostic.id !== diagnosticId)) return;
    diagnostic.resultObserver?.disconnect();
    captureState.formDiagnostic = null;
  }

  function findFilterPanel(button) {
    let ancestor = button?.parentElement || null;
    for (let depth = 0; ancestor && depth < 8; depth += 1, ancestor = ancestor.parentElement) {
      if (
        ancestor.querySelector('button[aria-label="초기화"]') &&
        findStarforceInputs(ancestor) &&
        findPotentialControls(ancestor)
      ) {
        return ancestor;
      }
    }
    return null;
  }

  function findPageSizeTrigger() {
    const direct = Array.from(document.querySelectorAll("button, [role='combobox']"))
      .filter(isVisibleElement)
      .filter((element) => /^\d+개씩\s*보기$/u.test(cleanText(element.textContent) || ""));
    const nested = Array.from(document.querySelectorAll("span, p"))
      .filter(isVisibleElement)
      .filter((element) => /^\d+개씩\s*보기$/u.test(cleanText(element.textContent) || ""))
      .map((element) => element.closest("button, [role='combobox']"))
      .filter(Boolean)
      .filter(isVisibleElement);
    const candidates = Array.from(new Set([...direct, ...nested]))
      .filter((element) => !element.closest('[role="listbox"]'))
      .sort((left, right) => left.childElementCount - right.childElementCount);
    return candidates[0] || null;
  }

  function pageSizeFromTrigger(trigger) {
    return parseFirstInteger(cleanText(trigger?.textContent));
  }

  async function ensurePageSize(expectedLimit = 60) {
    if (expectedLimit !== 60) throw new Error("페이지 표시는 60개씩 보기만 지원합니다.");
    let trigger = null;
    await waitUntil(() => {
      trigger = findPageSizeTrigger();
      return Boolean(trigger);
    }, 5_000);
    if (!trigger) throw new Error("60개씩 보기 설정을 확인할 수 없습니다.");
    const before = pageSizeFromTrigger(trigger);
    if (before === expectedLimit) {
      return {
        page_size_control_found: true,
        observed_page_limit: expectedLimit,
        page_size_changed: false
      };
    }

    trigger.click();
    await delay(80);
    const controlledId = trigger.getAttribute("aria-controls") || "";
    const controlled = controlledId ? document.getElementById(controlledId) : null;
    const roots = controlled && isVisibleElement(controlled)
      ? [controlled]
      : Array.from(document.querySelectorAll('[role="listbox"], [role="menu"]')).filter(isVisibleElement);
    let option = null;
    await waitUntil(() => {
      const optionCandidates = [];
      const searchRoots = roots.length > 0 ? roots : [document];
      for (const root of searchRoots) {
        for (const element of root.querySelectorAll('[role="option"], [role="menuitem"], button, li, [data-radix-collection-item], div, span, p')) {
          if (!isVisibleElement(element)) continue;
          const text = cleanText(element.textContent) || "";
          if (text === `${expectedLimit}개씩 보기` || text === `${expectedLimit}개`) {
            optionCandidates.push(element);
          }
        }
      }
      option = optionCandidates.sort((left, right) =>
        left.childElementCount - right.childElementCount
      )[0] || null;
      return Boolean(option);
    }, 1_500);
    if (!option) throw new Error("페이지 표시 목록에서 60개씩 보기를 찾지 못했습니다.");
    option.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerType: "mouse"
    }));
    option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    option.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    option.click();

    const applied = await waitUntil(() => {
      trigger = findPageSizeTrigger();
      return pageSizeFromTrigger(trigger) === expectedLimit;
    }, 2_500);
    if (!applied) throw new Error("60개씩 보기 선택이 화면에 반영되지 않았습니다.");
    return {
      page_size_control_found: true,
      observed_page_limit: expectedLimit,
      page_size_changed: true
    };
  }

  async function ensureResultPageSize(attemptId, expectedPriceSearchKey, expectedLimit = 60) {
    if (
      attemptId &&
      captureState.filterSearchAttemptId &&
      captureState.filterSearchAttemptId !== attemptId
    ) {
      throw new Error("다른 필터 검색 결과의 페이지 표시를 변경할 수 없습니다.");
    }
    if (typeof expectedPriceSearchKey !== "string" || !expectedPriceSearchKey) {
      throw new Error("페이지 표시를 변경할 필터 검색 키가 없습니다.");
    }
    const keyBefore = new URL(location.href).searchParams.get("priceSearchKey") || null;
    if (keyBefore !== expectedPriceSearchKey) {
      throw new Error("현재 결과가 방금 실행한 필터 검색 결과와 다릅니다.");
    }

    let result;
    try {
      result = await ensurePageSize(expectedLimit);
    } catch (error) {
      const emptyResultWithoutSelector = await waitUntil(() =>
        Boolean(
          findFilterSearchResultHeadingElement() &&
          hasVisibleEmptyResultMarker() &&
          !isResultViewBusy() &&
          !findPageSizeTrigger()
        ),
      2_000);
      if (!emptyResultWithoutSelector) throw error;
      result = {
        page_size_control_found: false,
        observed_page_limit: parseNullableInteger(new URL(location.href).searchParams.get("limit")),
        page_size_changed: false,
        page_size_not_applicable: true,
        empty_result: true
      };
    }
    const keyAfter = new URL(location.href).searchParams.get("priceSearchKey") || null;
    if (keyAfter !== expectedPriceSearchKey) {
      throw new Error("60개씩 보기 변경 중 필터 검색 결과가 바뀌었습니다.");
    }
    return {
      ...result,
      price_search_key_preserved: true
    };
  }

  function visiblePaginationRoots() {
    const heading = findFilterSearchResultHeadingElement();
    const rows = findListingRows();
    const emptyMarker = findVisibleEmptyResultMarkerElement();
    const boundary = document.querySelector("#main-container") || document.querySelector("main");
    const roots = Array.from(document.querySelectorAll(
      ".pagination-conatiner, .pagination-container"
    )).filter(isVisibleElement);
    return roots
      .filter((root) => !roots.some((other) => other !== root && root.contains(other)))
      .filter((root) => {
        if (!boundary?.contains(root) || !heading) return false;
        const pageSizeControl = Array.from(root.querySelectorAll("button, [role='combobox'], span, p"))
          .some((element) => /^\d+개씩\s*보기$/u.test(cleanText(element.textContent) || ""));
        if (!pageSizeControl) return false;
        for (let ancestor = root.parentElement; ancestor && ancestor !== boundary; ancestor = ancestor.parentElement) {
          const containsResult = rows.length > 0
            ? rows.some((row) => ancestor.contains(row))
            : Boolean(emptyMarker && ancestor.contains(emptyMarker));
          if (ancestor.contains(heading) && containsResult) return true;
        }
        return false;
      });
  }

  function numericPaginationButtons(root) {
    return Array.from(root?.querySelectorAll("button") || [])
      .filter(isVisibleElement)
      .filter((button) => /^\d+$/u.test(cleanText(button.textContent) || ""));
  }

  function isSelectedPaginationButton(button) {
    return button?.getAttribute("aria-current") === "page" ||
      button?.getAttribute("aria-selected") === "true" ||
      button?.getAttribute("data-state") === "active";
  }

  function hasSelectedPaginationStyle(button) {
    return typeof button?.className === "string" && button.className.split(/\s+/u).some((token) =>
      /^(?:border|text|bg)-(?:\[#F68600\]|bg-orange-500|orange-500|primary-500)$/iu.test(token)
    );
  }

  function readVerifiedPaginationState() {
    const roots = visiblePaginationRoots();
    if (roots.length !== 1) {
      throw new Error(roots.length === 0
        ? "검색 결과의 페이지네이션을 하나로 확인하지 못했습니다."
        : "검색 결과 페이지네이션 후보가 여러 개라 숫자 버튼을 안전하게 선택할 수 없습니다.");
    }
    const root = roots[0];
    const buttons = numericPaginationButtons(root);
    const selectedSignals = new Set([
      ...buttons.filter(isSelectedPaginationButton),
      ...buttons.filter((button) => button.disabled || button.getAttribute("aria-disabled") === "true"),
      ...buttons.filter(hasSelectedPaginationStyle)
    ]);
    if (buttons.length === 0 || selectedSignals.size !== 1) {
      throw new Error("현재 페이지가 선택된 숫자 버튼을 하나로 확인하지 못했습니다.");
    }
    const selectedButton = [...selectedSignals][0];
    return {
      root,
      buttons,
      selectedButton,
      selectedPage: Number(cleanText(selectedButton.textContent))
    };
  }

  function requireNumericPaginationButton(currentPage, targetPage) {
    const state = readVerifiedPaginationState();
    if (state.selectedPage !== currentPage) {
      throw new Error(`페이지네이션의 현재 페이지가 ${currentPage}페이지와 일치하지 않습니다.`);
    }
    const targets = state.buttons.filter((button) =>
      cleanText(button.textContent) === String(targetPage)
    );
    if (targets.length !== 1) {
      throw new Error(`${targetPage} 숫자 페이지 버튼을 하나로 확인하지 못했습니다.`);
    }
    const target = targets[0];
    if (target.disabled || target.getAttribute("aria-disabled") === "true") {
      throw new Error(`${targetPage} 숫자 페이지 버튼이 비활성화되어 있습니다.`);
    }
    return target;
  }

  function resultPageMatchesClickTarget(expectedQuery, expectedPriceSearchKey, targetPage, expectedLimit) {
    const url = new URL(location.href);
    if (
      url.searchParams.get("priceSearchKey") !== expectedPriceSearchKey ||
      Number(url.searchParams.get("page")) !== targetPage ||
      Number(url.searchParams.get("limit")) !== expectedLimit ||
      url.searchParams.get("sortType") !== "TRADE_DATE_DESC"
    ) {
      return false;
    }
    const rows = findListingRows();
    const emptyResult = rows.length === 0 && hasVisibleEmptyResultMarker();
    if (
      !findFilterSearchResultHeadingElement() ||
      (rows.length === 0 && !emptyResult) ||
      isResultViewBusy()
    ) {
      return false;
    }
    const searchContext = collectSearchContext();
    if (!resultSearchContextMatchesExpected(searchContext, {
      ...expectedQuery,
      page: targetPage,
      page_limit: expectedLimit
    })) {
      return false;
    }
    try {
      return readVerifiedPaginationState().selectedPage === targetPage;
    } catch (_error) {
      return false;
    }
  }

  async function clickResultPageNumber(options = {}) {
    const currentPage = Number(options.currentPage);
    const targetPage = Number(options.targetPage);
    const expectedLimit = Number(options.expectedLimit);
    const expectedSearchLimit = Number(options.expectedSearchLimit);
    const expectedQuery = options.expectedQuery;
    const expectedPriceSearchKey = options.expectedPriceSearchKey;
    if (!options.attemptId || !expectedQuery) {
      throw new Error("숫자 페이지 이동을 추적할 수집 정보가 없습니다.");
    }
    if (
      !Number.isInteger(currentPage) || currentPage < 1 ||
      !Number.isInteger(targetPage) || targetPage < 1 || targetPage === currentPage
    ) {
      throw new Error("이동할 현재·목표 페이지 번호가 올바르지 않습니다.");
    }
    if (expectedLimit !== 60) {
      throw new Error("숫자 페이지 이동은 60개씩 보기 결과만 지원합니다.");
    }
    if (typeof expectedPriceSearchKey !== "string" || !expectedPriceSearchKey) {
      throw new Error("숫자 페이지 이동에 사용할 필터 검색 키가 없습니다.");
    }

    const keyBefore = new URL(location.href).searchParams.get("priceSearchKey") || null;
    const contextBefore = collectSearchContext();
    const rowsBefore = findListingRows();
    const emptyBefore = rowsBefore.length === 0 && hasVisibleEmptyResultMarker();
    const summaryBefore = collectResultSummary(rowsBefore, contextBefore);
    if (keyBefore !== expectedPriceSearchKey) {
      throw new Error("현재 결과가 이어서 수집할 필터 검색 결과와 다릅니다.");
    }
    if (!resultSearchContextMatchesExpected(contextBefore, {
      ...expectedQuery,
      page: currentPage,
      page_limit: expectedLimit
    })) {
      throw new Error("숫자 버튼을 누르기 전 필터·페이지·정렬 조건이 일치하지 않습니다.");
    }
    if (
      !findFilterSearchResultHeadingElement() ||
      (rowsBefore.length === 0 && !emptyBefore) ||
      isResultViewBusy()
    ) {
      throw new Error("숫자 버튼을 누르기 전 현재 결과 화면이 안정되지 않았습니다.");
    }
    if (summaryBefore.displayed_page_limit !== expectedLimit) {
      throw new Error("숫자 버튼을 누르기 전 60개씩 보기를 확인하지 못했습니다.");
    }
    const usageBefore = summaryBefore.site_search_usage;
    if (
      !Number.isInteger(options.expectedSearchUsed) ||
      !Number.isInteger(expectedSearchLimit) ||
      !Number.isInteger(usageBefore?.used) ||
      !Number.isInteger(usageBefore?.limit)
    ) {
      throw new Error("숫자 버튼을 누르기 전 경매장 검색 횟수를 확인하지 못했습니다.");
    }
    if (
      usageBefore.used !== Number(options.expectedSearchUsed) ||
      usageBefore.limit !== expectedSearchLimit
    ) {
      throw new Error("숫자 버튼을 누르기 전 경매장 검색 횟수가 예상과 달라졌습니다.");
    }

    const targetButton = requireNumericPaginationButton(currentPage, targetPage);
    const signatureBefore = resultDomSignature(rowsBefore, emptyBefore);
    const primaryBefore = rowsBefore[0] || findVisibleEmptyResultMarkerElement() || null;
    beginCollectionResultTracking(options.attemptId);
    if (!targetButton.isConnected || !isVisibleElement(targetButton)) {
      throw new Error(`${targetPage} 숫자 페이지 버튼이 클릭 직전에 교체되었습니다.`);
    }
    targetButton.scrollIntoView({ block: "nearest", inline: "nearest" });
    let clickDispatched = false;
    const onClick = (event) => {
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      if (path.includes(targetButton) || event.target === targetButton || targetButton.contains(event.target)) {
        clickDispatched = true;
      }
    };
    document.addEventListener("click", onClick, true);
    try {
      targetButton.focus({ preventScroll: true });
      targetButton.click();
    } finally {
      document.removeEventListener("click", onClick, true);
    }
    if (!clickDispatched) {
      throw new Error(`${targetPage} 숫자 페이지 버튼에 클릭 이벤트가 전달되지 않았습니다.`);
    }

    const moved = await waitUntil(() => {
      if (!resultPageMatchesClickTarget(
        expectedQuery,
        expectedPriceSearchKey,
        targetPage,
        expectedLimit
      )) {
        return false;
      }
      const rows = findListingRows();
      const emptyResult = rows.length === 0 && hasVisibleEmptyResultMarker();
      const signature = resultDomSignature(rows, emptyResult);
      const primary = rows[0] || findVisibleEmptyResultMarkerElement() || null;
      return signature !== signatureBefore || primary !== primaryBefore;
    }, 30_000);
    if (!moved) {
      throw new Error(`${targetPage} 숫자 버튼 클릭 뒤 새 결과 화면을 확인하지 못했습니다.`);
    }

    const rowsAfter = findListingRows();
    const contextAfter = collectSearchContext();
    const summaryAfter = collectResultSummary(rowsAfter, contextAfter);
    if (
      !Number.isInteger(summaryAfter.site_search_usage?.used) ||
      !Number.isInteger(summaryAfter.site_search_usage?.limit)
    ) {
      throw new Error("숫자 페이지 이동 뒤 경매장 검색 횟수를 확인하지 못했습니다.");
    }
    if (
      summaryAfter.site_search_usage.used !== usageBefore.used ||
      summaryAfter.site_search_usage.limit !== expectedSearchLimit
    ) {
      throw new Error("숫자 페이지 이동 중 경매장 검색 횟수가 변했습니다.");
    }
    return {
      clicked: true,
      current_page: currentPage,
      target_page: targetPage,
      observed_page_limit: summaryAfter.displayed_page_limit,
      search_usage: summaryAfter.site_search_usage || null
    };
  }

  function findStarforceInputs(panel) {
    if (!panel) return null;
    for (const row of panel.querySelectorAll("div")) {
      const text = cleanText(row.textContent);
      const inputs = Array.from(row.querySelectorAll('input[type="number"]'));
      if (/^스타포스\s*~/u.test(text) && inputs.length === 2) {
        return { minimum: inputs[0], maximum: inputs[1] };
      }
    }
    return null;
  }

  function findPotentialControls(panel) {
    if (!panel) return null;
    const headers = Array.from(panel.querySelectorAll("div"))
      .filter((element) => normalizeUiLabel(element.textContent) === "잠재능력합산")
      .filter((element) => element.querySelector('[role="switch"]'));
    const header = headers.sort((left, right) => left.childElementCount - right.childElementCount)[0];
    const group = header?.parentElement || null;
    if (!group) return null;
    const combobox = group.querySelector('[role="combobox"]');
    const minimum = group.querySelector('input[type="number"][placeholder="최소값"]');
    const aggregate = header.querySelector('[role="switch"]');
    return combobox && minimum && aggregate ? { combobox, minimum, aggregate, group } : null;
  }

  function normalizeEquipmentSubcategory(value) {
    const normalized = normalizeUiLabel(value);
    if (normalized === "장신구") return "장신구";
    if (normalized === "방어구") return "방어구";
    return null;
  }

  function normalizeItemCategoryFilter(value) {
    const normalized = String(value || "").trim().toUpperCase();
    return normalized === "ARMOR" ? "ARMOR" : null;
  }

  function findEquipmentSubcategoryCombobox(panel) {
    const group = findNamedFilterGroup(panel, "하위 분류");
    if (!group) return null;
    return Array.from(group.querySelectorAll('[role="combobox"], select'))
      .filter((control) => !control.parentElement?.closest('[role="combobox"]'))
      .sort((left, right) => left.childElementCount - right.childElementCount)[0] || null;
  }

  function findTopLevelCategoryButton(panel, label) {
    const expected = cleanText(label);
    if (!panel || !expected) return null;
    const candidates = Array.from(panel.querySelectorAll("button"))
      .filter((button) => isVisibleElement(button))
      .filter((button) => normalizeUiLabel(button.textContent) === normalizeUiLabel(expected))
      .filter((button) => !button.closest('[role="listbox"]'));
    for (const candidate of candidates) {
      let ancestor = candidate.parentElement;
      for (let depth = 0; ancestor && ancestor !== panel && depth < 4; depth += 1, ancestor = ancestor.parentElement) {
        const siblingLabels = new Set(Array.from(ancestor.querySelectorAll("button"))
          .filter(isVisibleElement)
          .map((button) => normalizeUiLabel(button.textContent)));
        if (
          siblingLabels.has(normalizeUiLabel(expected)) &&
          ["장신구", "무기", "소비", "캐시", "코디", "기타"].some((label) =>
            siblingLabels.has(normalizeUiLabel(label))
          )
        ) {
          return candidate;
        }
      }
    }
    return null;
  }

  function findTopLevelEquipmentCategoryButton(panel, target) {
    const expected = normalizeEquipmentSubcategory(target);
    return expected ? findTopLevelCategoryButton(panel, expected) : null;
  }

  function isTopLevelEquipmentCategorySelected(button) {
    if (!button) return false;
    if (["true", "page"].includes(button.getAttribute("aria-current"))) return true;
    if (button.getAttribute("aria-pressed") === "true" || button.getAttribute("aria-selected") === "true") {
      return true;
    }
    if (["active", "checked", "on"].includes(button.getAttribute("data-state"))) return true;
    return button.classList.contains("bg-white") ||
      Array.from(button.classList).some((name) => name.includes("drop-shadow"));
  }

  function readItemCategorySelection(panel) {
    const armorButton = findTopLevelCategoryButton(panel, "방어구");
    const accessoryButton = findTopLevelCategoryButton(panel, "장신구");
    return isTopLevelEquipmentCategorySelected(armorButton) ||
      isTopLevelEquipmentCategorySelected(accessoryButton)
      ? "ARMOR"
      : null;
  }

  async function setItemCategoryFilter(panel, expectedQuery = {}) {
    const rawTarget = expectedQuery?.item_category_filter;
    if (rawTarget == null || String(rawTarget).trim() === "") return;
    const target = normalizeItemCategoryFilter(rawTarget);
    if (!target) throw new Error(`지원하지 않는 상위 장비 분류입니다: ${String(rawTarget).slice(0, 30)}`);
    if (readItemCategorySelection(panel) === target) return;
    const button = findTopLevelCategoryButton(panel, "방어구");
    if (!button) throw new Error("상위 장비 분류 '방어구' 버튼을 찾지 못했습니다.");
    button.click();
    const selected = await waitUntil(() => {
      const latestPanel = findFilterPanel(findFilterSearchButton());
      return readItemCategorySelection(latestPanel) === target;
    }, 1_500);
    if (!selected) throw new Error("상위 장비 분류 '방어구' 선택이 화면에 반영되지 않았습니다.");
  }

  function readEquipmentSubcategorySelection(panel) {
    const combobox = findEquipmentSubcategoryCombobox(panel);
    const nestedSelection = normalizeEquipmentSubcategory(filterChoiceLabel(combobox));
    if (nestedSelection) return nestedSelection;
    for (const target of ["장신구", "방어구"]) {
      const button = findTopLevelEquipmentCategoryButton(panel, target);
      if (isTopLevelEquipmentCategorySelected(button)) return target;
    }
    return null;
  }

  async function selectTopLevelEquipmentCategory(panel, target) {
    const button = findTopLevelEquipmentCategoryButton(panel, target);
    if (!button) return false;
    button.click();
    return waitUntil(() => {
      const latestPanel = findFilterPanel(findFilterSearchButton());
      const latestButton = findTopLevelEquipmentCategoryButton(latestPanel, target);
      return isTopLevelEquipmentCategorySelected(latestButton) &&
        readEquipmentSubcategorySelection(latestPanel) === target;
    }, 1_500);
  }

  async function selectNestedEquipmentSubcategory(target) {
    let panel = findFilterPanel(findFilterSearchButton());
    let combobox = findEquipmentSubcategoryCombobox(panel);
    if (!combobox) return false;
    if (normalizeEquipmentSubcategory(filterChoiceLabel(combobox)) === target) return true;
    if (combobox.getAttribute("aria-expanded") !== "true") combobox.click();
    await delay(80);
    const option = findVisibleListboxOption(target, combobox);
    if (!option) {
      combobox.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return false;
    }
    activateListboxOption(option);
    return waitUntil(() => {
      panel = findFilterPanel(findFilterSearchButton());
      combobox = findEquipmentSubcategoryCombobox(panel);
      return combobox && combobox.getAttribute("aria-expanded") !== "true" &&
        normalizeEquipmentSubcategory(filterChoiceLabel(combobox)) === target;
    }, 1_500);
  }

  async function setEquipmentSubcategoryFilter(panel, expectedQuery = {}) {
    const rawTarget = expectedQuery?.equipment_subcategory_filter;
    if (rawTarget == null || String(rawTarget).trim() === "") return;
    const target = normalizeEquipmentSubcategory(rawTarget);
    if (!target) throw new Error(`지원하지 않는 장비 분류입니다: ${String(rawTarget).slice(0, 30)}`);

    // Some versions expose 장신구 as a top-level category. Prefer that exact
    // button when present; the older UI exposes both targets under 하위 분류.
    if (target === "장신구" && findTopLevelEquipmentCategoryButton(panel, target)) {
      if (await selectTopLevelEquipmentCategory(panel, target)) return;
    }
    if (await selectNestedEquipmentSubcategory(target)) return;
    if (await selectTopLevelEquipmentCategory(
      findFilterPanel(findFilterSearchButton()) || panel,
      target
    )) return;
    throw new Error(`장비 분류 '${target}'를 화면에서 선택하지 못했습니다.`);
  }

  function findNamedFilterGroup(panel, headingLabel) {
    if (!panel) return null;
    const expected = normalizeUiLabel(headingLabel);
    const headers = Array.from(panel.querySelectorAll("p, span, div"))
      .filter((element) => {
        const normalized = normalizeUiLabel(element.textContent);
        return normalized === expected || normalized === `${expected}합산`;
      })
      .sort((left, right) => left.childElementCount - right.childElementCount);
    for (const header of headers) {
      let ancestor = header.parentElement;
      for (let depth = 0; ancestor && ancestor !== panel && depth < 4; depth += 1, ancestor = ancestor.parentElement) {
        if (ancestor.querySelector('[role="combobox"], select, input[type="number"], input[type="checkbox"], input[type="radio"]')) {
          return ancestor;
        }
      }
    }
    return null;
  }

  function filterChoiceLabel(control) {
    if (!control) return "";
    const inputValue = control.querySelector?.("input")?.value;
    return cleanText(inputValue || control.value || control.textContent || "") || "";
  }

  function isDefaultFilterChoice(value) {
    const normalized = normalizeUiLabel(value);
    return !normalized || /^(?:전체|선택안함|없음|미선택|제한없음)$/u.test(normalized);
  }

  function readPotentialFilterRows(group) {
    if (!group) return [];
    const comboboxes = Array.from(group.querySelectorAll('[role="combobox"]'))
      .filter((element) => !element.parentElement?.closest('[role="combobox"]'));
    const minimums = Array.from(group.querySelectorAll('input[type="number"][placeholder="최소값"]'));
    return comboboxes.map((combobox, index) => {
      const label = potentialSelectionLabel(combobox);
      return {
        code: potentialCodeFromLabel(label),
        minimum: parseFormInteger(minimums[index]?.value),
        aggregate: group.querySelector('[role="switch"]')?.getAttribute("aria-checked") === "true"
      };
    }).filter((row) => row.code !== null || row.minimum !== null);
  }

  function readNamedChoiceFilter(panel, label) {
    const expected = normalizeUiLabel(label);
    const labels = Array.from(panel?.querySelectorAll?.("p, span, label, div") || [])
      .filter((element) => normalizeUiLabel(element.textContent) === expected)
      .sort((left, right) => left.childElementCount - right.childElementCount);
    for (const labelElement of labels) {
      let ancestor = labelElement.parentElement;
      for (let depth = 0; ancestor && ancestor !== panel && depth < 4; depth += 1, ancestor = ancestor.parentElement) {
        const controls = Array.from(ancestor.querySelectorAll('[role="combobox"], select'))
          .filter((control) => !control.parentElement?.closest('[role="combobox"]'));
        if (controls.length === 1) return filterChoiceLabel(controls[0]);
      }
    }
    return "";
  }

  function activeFilterDetailsInGroup(group, label) {
    if (!group) return [];
    const active = [];
    const comboboxes = Array.from(group.querySelectorAll('[role="combobox"], select'))
      .filter((control) => !control.parentElement?.closest('[role="combobox"]'));
    for (const control of comboboxes) {
      const value = filterChoiceLabel(control);
      if (!isDefaultFilterChoice(value)) active.push(`${label} 선택`);
    }
    for (const input of group.querySelectorAll('input[type="number"]')) {
      const value = parseFormInteger(input.value);
      if (value !== null && value !== 0) active.push(`${label} 수치`);
    }
    for (const input of group.querySelectorAll('input[type="checkbox"], input[type="radio"]')) {
      if (input.checked) active.push(`${label} 체크`);
    }
    return active;
  }

  function findLabeledControl(panel, label, selector) {
    const expected = normalizeUiLabel(label);
    const labels = Array.from(panel?.querySelectorAll?.("p, span, label, div") || [])
      .filter((element) => normalizeUiLabel(element.textContent) === expected)
      .sort((left, right) => left.childElementCount - right.childElementCount);
    for (const labelElement of labels) {
      let ancestor = labelElement.parentElement;
      for (let depth = 0; ancestor && ancestor !== panel && depth < 4; depth += 1, ancestor = ancestor.parentElement) {
        const controls = Array.from(ancestor.querySelectorAll(selector));
        if (controls.length === 1) return controls[0];
      }
    }
    return null;
  }

  function findPriceInputs(panel) {
    if (!panel) return null;
    const minimum = panel.querySelector('input[aria-label="최소 가격"]') ||
      findLabeledControl(panel, "최소 가격", "input");
    const maximum = panel.querySelector('input[aria-label="최대 가격"]') ||
      findLabeledControl(panel, "최대 가격", "input");
    return minimum && maximum && minimum !== maximum ? { minimum, maximum } : null;
  }

  function unexpectedFilterSelections(panel, expectedQuery = null) {
    const active = [];
    for (const label of ["에디셔널 잠재능력", "추가 옵션", "주문서 강화"]) {
      active.push(...activeFilterDetailsInGroup(findNamedFilterGroup(panel, label), label));
    }
    const expectedSubcategory = normalizeEquipmentSubcategory(
      expectedQuery?.equipment_subcategory_filter
    );
    for (const label of ["하위 분류", "직업군", "잠재등급", "에디셔널 등급"]) {
      const value = readNamedChoiceFilter(panel, label);
      if (
        label === "하위 분류" && expectedSubcategory &&
        normalizeEquipmentSubcategory(value) === expectedSubcategory
      ) {
        continue;
      }
      if (!isDefaultFilterChoice(value)) active.push(`${label} 선택`);
    }
    const levelInputs = (() => {
      const expected = normalizeUiLabel("레벨");
      const label = Array.from(panel?.querySelectorAll?.("p, span, label, div") || [])
        .filter((element) => normalizeUiLabel(element.textContent) === expected)
        .sort((left, right) => left.childElementCount - right.childElementCount)[0];
      let ancestor = label?.parentElement || null;
      for (let depth = 0; ancestor && ancestor !== panel && depth < 4; depth += 1, ancestor = ancestor.parentElement) {
        const inputs = Array.from(ancestor.querySelectorAll('input[type="number"]'));
        if (inputs.length === 2) return inputs;
      }
      return [];
    })();
    if (levelInputs.some((input) => {
      const value = parseFormInteger(input.value);
      return value !== null && value !== 0;
    })) active.push("레벨 입력");
    const currentWorld = findLabeledControl(panel, "현재 월드 아이템만", 'input[type="checkbox"], [role="checkbox"]');
    if (currentWorld && (currentWorld.checked || currentWorld.getAttribute("aria-checked") === "true")) {
      active.push("현재 월드만 선택");
    }
    return Array.from(new Set(active));
  }

  function findKeywordSearchInput(panel = document) {
    const selectors = [
      'input[inputmode="search"][role="combobox"][aria-controls]',
      'input[enterkeyhint="search"][role="combobox"][aria-controls]'
    ];
    const scoped = selectors.flatMap((selector) => Array.from(panel?.querySelectorAll?.(selector) || []));
    const candidates = scoped.length > 0
      ? scoped
      : selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    const visible = Array.from(new Set(candidates)).filter(isVisibleElement);
    const preferred = visible.filter((input) => /item-autocomplete/iu.test(input.getAttribute("aria-controls") || ""));
    const matches = preferred.length > 0 ? preferred : visible;
    if (matches.length > 1) throw new Error("장비명 검색 입력칸 후보가 여러 개입니다.");
    return matches[0] || null;
  }

  function findKeywordSearchRoot(input) {
    let ancestor = input?.parentElement || null;
    for (let depth = 0; ancestor && depth < 6; depth += 1, ancestor = ancestor.parentElement) {
      if (ancestor.querySelector('button[aria-label="검색어 지우기"]')) return ancestor;
    }
    return input?.parentElement || null;
  }

  function findExactKeywordTag(keyword = null) {
    const expected = keyword == null ? null : `'${keyword}' 정확히 일치 태그 해제`;
    return Array.from(document.querySelectorAll('button[aria-label$="정확히 일치 태그 해제"]'))
      .filter(isVisibleElement)
      .find((button) => expected == null || cleanText(button.getAttribute("aria-label")) === expected) || null;
  }

  async function setExactKeyword(panel, keyword) {
    if (typeof keyword !== "string" || !keyword.trim()) throw new Error("입력할 장비명이 없습니다.");
    const expected = keyword.trim();
    let input = findKeywordSearchInput(panel);
    if (!input) throw new Error("장비명 검색 입력칸을 찾지 못했습니다.");

    const existingTags = Array.from(document.querySelectorAll('button[aria-label$="정확히 일치 태그 해제"]'))
      .filter(isVisibleElement);
    for (const tag of existingTags) {
      tag.click();
      await delay(45);
    }
    input = findKeywordSearchInput(findFilterPanel(findFilterSearchButton()) || document);
    if (!input) throw new Error("기존 장비명을 지운 뒤 검색 입력칸을 다시 찾지 못했습니다.");
    const root = findKeywordSearchRoot(input);
    const clearButton = root?.querySelector('button[aria-label="검색어 지우기"]');
    if (input.value || findExactKeywordTag()) {
      clearButton?.click();
      await delay(60);
      input = findKeywordSearchInput(findFilterPanel(findFilterSearchButton()) || document);
      if (!input) throw new Error("검색어를 지운 뒤 장비명 입력칸을 다시 찾지 못했습니다.");
    }

    input.focus();
    await setNativeInputValue(input, expected, { blur: false, change: false });
    input.dispatchEvent(new KeyboardEvent("keyup", {
      key: expected.at(-1) || "",
      bubbles: true,
      cancelable: true
    }));

    let option = null;
    let controlledPopupFound = false;
    const optionReady = await waitUntil(() => {
      input = findKeywordSearchInput(findFilterPanel(findFilterSearchButton()) || document);
      const controlledId = input?.getAttribute("aria-controls") || "";
      controlledPopupFound = Boolean(controlledId && document.getElementById(controlledId));
      option = findExactKeywordAutocompleteOption(input, expected);
      return Boolean(option);
    }, 4_000);
    if (!optionReady || !option) {
      throw new Error(`장비명 자동완성에서 '${expected}' 항목을 찾지 못했습니다.`);
    }
    option.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "mouse" }));
    option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    option.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    option.click();

    const exactSelected = await waitUntil(() => Boolean(findExactKeywordTag(expected)), 2_000);
    if (!exactSelected) {
      throw new Error(`'${expected}' 장비가 정확히 일치 조건으로 선택되지 않았습니다.`);
    }
    return {
      keyword_input_found: true,
      controlled_popup_found: controlledPopupFound,
      exact_candidate_found: true,
      exact_tag_matches: true
    };
  }

  async function setFilterKeyword(panel, keyword, exactMatch = true) {
    const expected = String(keyword ?? "").trim();
    if (!expected) {
      let input = findKeywordSearchInput(panel);
      if (!input) throw new Error("장비명 검색 입력칸을 찾지 못했습니다.");
      const existingTags = Array.from(document.querySelectorAll('button[aria-label$="정확히 일치 태그 해제"]'))
        .filter(isVisibleElement);
      for (const tag of existingTags) {
        tag.click();
        await delay(45);
      }
      input = findKeywordSearchInput(findFilterPanel(findFilterSearchButton()) || document);
      if (!input) throw new Error("기존 장비명을 지운 뒤 검색 입력칸을 다시 찾지 못했습니다.");
      const root = findKeywordSearchRoot(input);
      if (input.value) {
        root?.querySelector('button[aria-label="검색어 지우기"]')?.click();
        await delay(60);
      }
      const cleared = await waitUntil(() => {
        const latest = findKeywordSearchInput(findFilterPanel(findFilterSearchButton()) || document);
        return cleanText(latest?.value) == null && !findExactKeywordTag();
      }, 1_500);
      if (!cleared) throw new Error("장비명 없이 검색하도록 검색어를 비우지 못했습니다.");
      return {
        keyword_input_found: true,
        controlled_popup_found: Boolean(input.getAttribute("aria-controls")),
        exact_candidate_found: false,
        exact_tag_matches: true
      };
    }
    if (exactMatch) return setExactKeyword(panel, keyword);
    let input = findKeywordSearchInput(panel);
    if (!input) throw new Error("장비명 검색 입력칸을 찾지 못했습니다.");

    const existingTags = Array.from(document.querySelectorAll('button[aria-label$="정확히 일치 태그 해제"]'))
      .filter(isVisibleElement);
    for (const tag of existingTags) {
      tag.click();
      await delay(45);
    }
    input = findKeywordSearchInput(findFilterPanel(findFilterSearchButton()) || document);
    if (!input) throw new Error("기존 장비명을 지운 뒤 검색 입력칸을 다시 찾지 못했습니다.");
    const root = findKeywordSearchRoot(input);
    if (input.value) {
      root?.querySelector('button[aria-label="검색어 지우기"]')?.click();
      await delay(60);
      input = findKeywordSearchInput(findFilterPanel(findFilterSearchButton()) || document);
      if (!input) throw new Error("검색어를 지운 뒤 장비명 입력칸을 다시 찾지 못했습니다.");
    }

    input.focus();
    await setNativeInputValue(input, expected, { blur: false, change: false });
    input.dispatchEvent(new KeyboardEvent("keyup", {
      key: expected.at(-1) || "",
      bubbles: true,
      cancelable: true
    }));
    const entered = await waitUntil(() => {
      const latest = findKeywordSearchInput(findFilterPanel(findFilterSearchButton()) || document);
      return cleanText(latest?.value) === expected && !findExactKeywordTag();
    }, 1_500);
    if (!entered) throw new Error(`장비군 검색어 '${expected}'를 입력하지 못했습니다.`);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return {
      keyword_input_found: true,
      controlled_popup_found: Boolean(input.getAttribute("aria-controls")),
      exact_candidate_found: false,
      exact_tag_matches: false,
      partial_keyword_matches: true
    };
  }

  function findExactKeywordAutocompleteOption(input, keyword) {
    const controlledId = input?.getAttribute("aria-controls") || "";
    const controlled = controlledId ? document.getElementById(controlledId) : null;
    const containers = controlled && isVisibleElement(controlled)
      ? [controlled]
      : Array.from(document.querySelectorAll('[role="listbox"]')).filter(isVisibleElement);
    const candidates = [];
    for (const container of containers) {
      for (const element of container.querySelectorAll('[role="option"], button, li, [data-radix-collection-item], div')) {
        if (!isVisibleElement(element)) continue;
        const text = cleanText(element.textContent) || "";
        if (text === keyword || text.startsWith(keyword)) {
          candidates.push({ element, exact: text === keyword ? 0 : 1, textLength: text.length });
        }
      }
    }
    candidates.sort((left, right) =>
      left.exact - right.exact || left.textLength - right.textLength ||
      left.element.childElementCount - right.element.childElementCount
    );
    return candidates[0]?.element || null;
  }

  function readFilterFormState(panel, expectedQuery = null) {
    const starforce = findStarforceInputs(panel);
    const potential = findPotentialControls(panel);
    const prices = findPriceInputs(panel);
    if (!starforce || !potential || !prices) {
      throw new Error("가격·스타포스 또는 잠재능력 필터 입력칸을 찾지 못했습니다.");
    }
    const selectedLabel = potentialSelectionLabel(potential.combobox);
    return {
      exact_keyword: cleanText(findExactKeywordTag()?.textContent) || null,
      keyword_value: cleanText(findKeywordSearchInput(panel)?.value) || null,
      item_category_filter: readItemCategorySelection(panel),
      equipment_subcategory: readEquipmentSubcategorySelection(panel),
      starforce_min: parseFormInteger(starforce.minimum.value),
      starforce_max: parseFormInteger(starforce.maximum.value),
      price_min_meso: parseMesoFormInteger(prices.minimum.value),
      price_max_meso: parseMesoFormInteger(prices.maximum.value),
      price_min_valid: isValidMesoFormInteger(prices.minimum.value),
      price_max_valid: isValidMesoFormInteger(prices.maximum.value),
      potential_code: potentialCodeFromLabel(selectedLabel),
      potential_label: selectedLabel || null,
      potential_min: parseFormInteger(potential.minimum.value),
      potential_aggregate: potential.aggregate.getAttribute("aria-checked") === "true",
      potential_rows: readPotentialFilterRows(potential.group),
      unexpected_filters: unexpectedFilterSelections(panel, expectedQuery)
    };
  }

  function filterFormMatchesExpected(actual, expectedQuery) {
    const expectedCode = expectedQuery?.server_filter?.code ?? expectedQuery?.potential_code ?? null;
    const expectedMinimum = expectedQuery?.server_filter?.minimum ?? expectedQuery?.potential_min ?? null;
    const expectedStarforceMin = expectedQuery?.starforce_min ?? null;
    const expectedStarforceMax = expectedQuery?.starforce_max ?? null;
    const expectedPriceMin = expectedQuery?.price_min_meso ?? null;
    const expectedPriceMax = expectedQuery?.price_max_meso ?? null;
    const expectedSubcategory = normalizeEquipmentSubcategory(
      expectedQuery?.equipment_subcategory_filter
    );
    const expectedItemCategory = normalizeItemCategoryFilter(
      expectedQuery?.item_category_filter
    );
    // The auction UI renders the exact 0-star upper bound as an empty field,
    // while the URL and submitted search retain starforceMax=0.
    const zeroStarUiAlias = expectedStarforceMin === 0 && expectedStarforceMax === 0 &&
      actual.starforce_min === 0 && actual.starforce_max === null;
    const unrestrictedStarUiAlias = expectedStarforceMin === null && actual.starforce_min === 0;
    const unrestrictedPriceUiAlias = expectedPriceMin === null && actual.price_min_meso === 0;
    const unrestrictedPriceMaxUiAlias = expectedPriceMax === null && actual.price_max_meso === 0;
    const expectedPotentialRows = expectedCode ? 1 : 0;
    return (
      filterKeywordMatchesExpected(actual, expectedQuery) &&
      (!expectedItemCategory || actual.item_category_filter === expectedItemCategory) &&
      (!expectedSubcategory || actual.equipment_subcategory === expectedSubcategory) &&
      (actual.starforce_min === expectedStarforceMin || unrestrictedStarUiAlias) &&
      (actual.starforce_max === expectedStarforceMax || zeroStarUiAlias) &&
      (actual.price_min_meso === expectedPriceMin || unrestrictedPriceUiAlias) &&
      (actual.price_max_meso === expectedPriceMax || unrestrictedPriceMaxUiAlias) &&
      actual.price_min_valid === true &&
      actual.price_max_valid === true &&
      actual.potential_code === expectedCode &&
      actual.potential_min === expectedMinimum &&
      (!expectedCode || actual.potential_aggregate === true) &&
      Array.isArray(actual.potential_rows) &&
      actual.potential_rows.length === expectedPotentialRows &&
      (expectedPotentialRows === 0 || (
        actual.potential_rows[0].code === expectedCode &&
        actual.potential_rows[0].minimum === expectedMinimum &&
        actual.potential_rows[0].aggregate === true
      )) &&
      Array.isArray(actual.unexpected_filters) &&
      actual.unexpected_filters.length === 0
    );
  }

  function filterKeywordMatchesExpected(actual, expectedQuery = {}) {
    const expected = String(expectedQuery.keyword ?? "").trim();
    if (!expected) {
      return expectedQuery.search_scope === "catalog_global" &&
        actual.exact_keyword == null && actual.keyword_value == null;
    }
    return expectedQuery.exact_match === false
      ? actual.exact_keyword == null && actual.keyword_value === expected
      : actual.exact_keyword === expected;
  }

  async function setStarforceFormValues(panel, expectedQuery) {
    let inputs = findStarforceInputs(panel);
    if (!inputs) throw new Error("스타포스 입력칸을 찾지 못했습니다.");
    await setNativeInputValue(inputs.minimum, expectedQuery?.starforce_min ?? 0);
    panel = findFilterPanel(findFilterSearchButton());
    inputs = findStarforceInputs(panel);
    if (!inputs) throw new Error("스타포스 최대 입력칸을 다시 찾지 못했습니다.");
    await setNativeInputValue(inputs.maximum, expectedQuery?.starforce_max ?? null);
  }

  async function setPriceFormValues(panel, expectedQuery) {
    let inputs = findPriceInputs(panel);
    if (!inputs) throw new Error("최소·최대 가격 입력칸을 찾지 못했습니다.");
    await setNativeInputValue(inputs.minimum, expectedQuery?.price_min_meso ?? null);
    panel = findFilterPanel(findFilterSearchButton());
    inputs = findPriceInputs(panel);
    if (!inputs) throw new Error("최소 가격 입력 후 가격 입력칸을 다시 찾지 못했습니다.");
    await setNativeInputValue(inputs.maximum, expectedQuery?.price_max_meso ?? null);
    const matched = await waitUntil(() => {
      const latestPanel = findFilterPanel(findFilterSearchButton());
      const latest = findPriceInputs(latestPanel);
      const actualMinimum = parseMesoFormInteger(latest?.minimum?.value);
      const actualMaximum = parseMesoFormInteger(latest?.maximum?.value);
      const expectedMinimum = expectedQuery?.price_min_meso ?? null;
      const expectedMaximum = expectedQuery?.price_max_meso ?? null;
      return latest &&
        isValidMesoFormInteger(latest.minimum.value) &&
        isValidMesoFormInteger(latest.maximum.value) &&
        (actualMinimum === expectedMinimum || (expectedMinimum === null && actualMinimum === 0)) &&
        (actualMaximum === expectedMaximum || (expectedMaximum === null && actualMaximum === 0));
    }, 1_500);
    if (!matched) throw new Error("최소·최대 가격을 요청 조건으로 입력하지 못했습니다.");
  }

  async function setPotentialFormValues(expectedQuery) {
    const expectedCode = expectedQuery?.server_filter?.code ?? expectedQuery?.potential_code ?? null;
    const expectedMinimum = expectedQuery?.server_filter?.minimum ?? expectedQuery?.potential_min ?? null;
    if (!expectedCode) {
      let panel = findFilterPanel(findFilterSearchButton());
      let controls = findPotentialControls(panel);
      if (!controls) throw new Error("잠재능력 필터 입력칸을 찾지 못했습니다.");
      if (potentialCodeFromLabel(potentialSelectionLabel(controls.combobox)) !== null) {
        await clearPotentialOption(controls.combobox);
      }
      panel = findFilterPanel(findFilterSearchButton());
      controls = findPotentialControls(panel);
      if (!controls) throw new Error("잠재능력 수치 입력칸을 다시 찾지 못했습니다.");
      await setNativeInputValue(controls.minimum, null);
      return;
    }
    const label = AUCTION_POTENTIAL_LABEL_BY_CODE.get(expectedCode);
    if (!label) throw new Error(`지원하지 않는 경매장 잠재 필터 코드입니다: ${expectedCode}`);

    let panel = findFilterPanel(findFilterSearchButton());
    let controls = findPotentialControls(panel);
    if (!controls) throw new Error("잠재능력 필터 입력칸을 찾지 못했습니다.");
    await selectPotentialOption(controls.combobox, label, expectedCode);

    panel = findFilterPanel(findFilterSearchButton());
    controls = findPotentialControls(panel);
    if (!controls) throw new Error("잠재능력 수치 입력칸을 다시 찾지 못했습니다.");
    await setNativeInputValue(controls.minimum, expectedMinimum);

    panel = findFilterPanel(findFilterSearchButton());
    controls = findPotentialControls(panel);
    if (!controls) throw new Error("잠재능력 합산 설정을 다시 찾지 못했습니다.");
    if (controls.aggregate.getAttribute("aria-checked") !== "true") {
      controls.aggregate.click();
      await waitUntil(() => {
        const latestPanel = findFilterPanel(findFilterSearchButton());
        return findPotentialControls(latestPanel)?.aggregate.getAttribute("aria-checked") === "true";
      }, 800);
    }
  }

  async function selectPotentialOption(combobox, label, expectedCode) {
    if (
      potentialCodeFromLabel(potentialSelectionLabel(combobox)) === expectedCode &&
      combobox.getAttribute("aria-expanded") !== "true"
    ) return;
    if (combobox.getAttribute("aria-expanded") !== "true") combobox.click();
    await delay(80);

    let option = findVisibleListboxOption(label, combobox);
    if (!option) {
      const searchInput = combobox.querySelector("input");
      if (searchInput) {
        await setNativeInputValue(searchInput, label, { blur: false });
        await delay(80);
        option = findVisibleListboxOption(label, combobox);
      }
    }
    if (!option) {
      throw new Error(`잠재능력 목록에서 '${label}' 항목을 찾지 못했습니다.`);
    }
    activateListboxOption(option);
    const selected = await waitUntil(() => {
      const panel = findFilterPanel(findFilterSearchButton());
      const latest = findPotentialControls(panel)?.combobox;
      return latest &&
        latest.getAttribute("aria-expanded") !== "true" &&
        potentialCodeFromLabel(potentialSelectionLabel(latest)) === expectedCode;
    }, 1_200);
    if (!selected) throw new Error(`잠재능력 '${label}' 선택이 화면에 반영되지 않았습니다.`);
  }

  async function clearPotentialOption(combobox) {
    if (combobox.getAttribute("aria-expanded") !== "true") combobox.click();
    await delay(80);
    const labels = ["선택 안 함", "없음"];
    const option = labels.map((label) => findVisibleListboxOption(label, combobox)).find(Boolean);
    if (option) {
      activateListboxOption(option);
    } else {
      const searchInput = combobox.querySelector("input");
      if (searchInput) await setNativeInputValue(searchInput, "", { blur: false });
      combobox.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    }
    const cleared = await waitUntil(() => {
      const panel = findFilterPanel(findFilterSearchButton());
      const latest = findPotentialControls(panel)?.combobox;
      return latest &&
        latest.getAttribute("aria-expanded") !== "true" &&
        potentialCodeFromLabel(potentialSelectionLabel(latest)) === null;
    }, 1_200);
    if (!cleared) throw new Error("이전에 남은 잠재능력 필터를 지우지 못했습니다.");
  }

  function activateListboxOption(option) {
    const eventOptions = { bubbles: true, cancelable: true, view: window };
    if (typeof PointerEvent === "function") {
      option.dispatchEvent(new PointerEvent("pointerdown", eventOptions));
    }
    option.dispatchEvent(new MouseEvent("mousedown", eventOptions));
    if (typeof PointerEvent === "function") {
      option.dispatchEvent(new PointerEvent("pointerup", eventOptions));
    }
    option.dispatchEvent(new MouseEvent("mouseup", eventOptions));
    option.click();
  }

  function findVisibleListboxOption(label, combobox = null) {
    const expected = normalizeUiLabel(label);
    const controlledId = combobox?.getAttribute("aria-controls") || "";
    const controlled = controlledId ? document.getElementById(controlledId) : null;
    const listboxes = controlled && isVisibleElement(controlled)
      ? [controlled]
      : Array.from(document.querySelectorAll('[role="listbox"]')).filter(isVisibleElement);
    const candidates = [];
    for (const listbox of listboxes) {
      for (const element of listbox.querySelectorAll('[role="option"], button, div')) {
        if (isVisibleElement(element) && normalizeUiLabel(element.textContent) === expected) {
          candidates.push(element);
        }
      }
    }
    return candidates.sort((left, right) => left.childElementCount - right.childElementCount)[0] || null;
  }

  async function setNativeInputValue(input, value, options = {}) {
    if (!input) throw new Error("필터 입력칸을 찾지 못했습니다.");
    const nextValue = value == null ? "" : String(value);
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    descriptor?.set?.call(input, nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    if (options.change !== false) input.dispatchEvent(new Event("change", { bubbles: true }));
    if (options.blur !== false) input.blur();
    await delay(45);
  }

  async function waitUntil(predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (predicate()) return true;
      } catch (_error) {
        // React may replace the control between reads; retry with the new node.
      }
      await delay(40);
    }
    return false;
  }

  function potentialSelectionLabel(combobox) {
    const inputValue = combobox?.querySelector("input")?.value;
    const raw = cleanText(inputValue || combobox?.textContent || "") || "";
    return /^(?:선택\s*안\s*함|없음|전체)$/u.test(raw) ? "" : raw;
  }

  function potentialCodeFromLabel(label) {
    if (!label) return null;
    const normalized = normalizeUiLabel(label);
    for (const [code, expectedLabel] of AUCTION_POTENTIAL_LABEL_BY_CODE) {
      if (normalizeUiLabel(expectedLabel) === normalized) return code;
    }
    if ([
      "아이템드롭률", "아이템드롭률%증가", "아이템획득확률", "아이템획득확률증가", "아이템획득확률%증가"
    ].includes(normalized)) {
      return "itemDropPercent";
    }
    if ([
      "메소획득량", "메소획득량증가", "메소획득량%증가", "메소획득확률", "메소획득확률%증가"
    ].includes(normalized)) {
      return "mesosObtainedPercent";
    }
    return `unknown:${label}`;
  }

  function normalizeUiLabel(value) {
    return String(value || "").replace(/\s+/gu, "").toUpperCase();
  }

  function parseFormInteger(value) {
    if (value == null || String(value).trim() === "") return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }

  function parseMesoFormInteger(value) {
    if (value == null || String(value).trim() === "") return null;
    const normalized = String(value).replace(/[\s,]/gu, "");
    if (!/^\d+$/u.test(normalized)) return null;
    const parsed = Number(normalized);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  function isValidMesoFormInteger(value) {
    if (value == null || String(value).trim() === "") return true;
    const normalized = String(value).replace(/[\s,]/gu, "");
    return /^\d+$/u.test(normalized) && Number.isSafeInteger(Number(normalized));
  }

  function formatFilterFormState(state) {
    const keyword = state.exact_keyword
      ? `장비 ${state.exact_keyword}`
      : state.keyword_value ? `장비군 ${state.keyword_value}` : "장비 미선택";
    const starforce = `${state.starforce_min ?? "빈칸"}~${state.starforce_max ?? "빈칸"}`;
    const price = `${state.price_min_meso ?? "빈칸"}~${state.price_max_meso ?? "빈칸"}`;
    const potential = state.potential_code
      ? `${state.potential_label || state.potential_code} ${state.potential_min ?? "빈칸"} (합산 ${state.potential_aggregate ? "ON" : "OFF"})`
      : "잠재 없음";
    const subcategory = state.equipment_subcategory
      ? `분류 ${state.equipment_subcategory}`
      : "분류 미선택";
    const itemCategory = state.item_category_filter
      ? `상위 분류 ${state.item_category_filter}`
      : "상위 분류 미선택";
    return `${keyword}, ${itemCategory}, ${subcategory}, 가격 ${price}, 스타포스 ${starforce}, ${potential}`;
  }

  function filterRequestMatchesCurrentUrl(expectedQuery) {
    if (!expectedQuery || typeof expectedQuery.keyword !== "string") return false;
    const url = new URL(location.href);
    return /^\/price(?:\/|$)/u.test(url.pathname);
  }

  function findFilterSearchButton() {
    const candidates = Array.from(document.querySelectorAll("#main-container button, main button"))
      .filter((button) => cleanText(button.textContent) === "필터 검색" && isVisibleElement(button))
      .filter((button) => hasNearbyFilterSaveButton(button));
    if (candidates.length > 1) {
      throw new Error("'필터 검색' 버튼 후보가 여러 개라 안전하게 선택할 수 없습니다.");
    }
    return candidates[0] || null;
  }

  function hasNearbyFilterSaveButton(button) {
    let ancestor = button.parentElement;
    for (let depth = 0; ancestor && depth < 4; depth += 1, ancestor = ancestor.parentElement) {
      const hasFilterSave = Array.from(ancestor.querySelectorAll("button")).some((candidate) =>
        cleanText(candidate.textContent) === "필터 저장"
      );
      if (hasFilterSave) return true;
    }
    return false;
  }

  function isVisibleElement(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== "none" &&
      style.visibility !== "hidden" && style.opacity !== "0";
  }

  function findListingRows() {
    return Array.from(document.querySelectorAll("div.isolate.relative.flex")).filter((row) => {
      const text = cleanText(row.innerText || row.textContent) || "";
      return Boolean(row.querySelector("img[alt]")) && /메소/u.test(text) && extractRawPrice(text);
    });
  }

  function describeListingRow(row, index, totalCount) {
    const text = cleanText(row.innerText || row.textContent) || "";
    const image = row.querySelector("img[alt]");
    const rowName = findRowItemName(row) || image?.alt?.trim() || `장비${index + 1}`;
    const baseName = image?.alt?.trim() || rowName.replace(/\s*\(\+?\d+\)\s*$/u, "").trim();
    const rawPrice = extractRawPrice(text);
    const grades = extractRowGrades(row);

    return {
      index,
      sequence: String(index + 1).padStart(Math.max(2, String(totalCount).length), "0"),
      row_name: rowName,
      base_name: baseName,
      raw_price: rawPrice,
      price_meso: rawPriceToMesoString(rawPrice),
      observed_date: text.match(/\d{4}-\d{2}-\d{2}/u)?.[0] || null,
      starforce: extractStarforceObservation(row),
      potential_grade_raw: grades[0] || null,
      additional_potential_grade_raw: grades[1] || null,
      combat_power_change: extractCombatPower(text),
      icon_url: safePublicUrl(image?.currentSrc || image?.src),
      native_listing_id: findNativeListingId(row),
      native_item_id: findNativeItemId(row)
    };
  }

  async function buildCaptureItem(row, descriptor, leftPanel, batchId, collectionContext) {
    const qualityWarnings = [];
    const itemTitle = findTooltipItemTitle(leftPanel, descriptor) || descriptor.row_name;
    const categoryPath = collectCategoryPath(leftPanel);
    const requiredJobRaw = findLabeledValue(leftPanel, "착용 직업");
    const requiredLevelRaw = findLabeledValue(leftPanel, "요구 레벨");
    const setName = findLabeledValue(leftPanel, "세트효과");
    const tradeRaw = findTradeText(leftPanel);
    const upgradeRaw = findLeafText(leftPanel, (text) => /^주문서 강화/u.test(text));
    const statLines = collectStatLines(leftPanel);
    const potential = collectPotential(leftPanel, false, descriptor.potential_grade_raw);
    const additionalPotential = collectPotential(
      leftPanel,
      true,
      descriptor.additional_potential_grade_raw
    );
    const tooltipStarforce = extractTooltipStarforceObservation(leftPanel);
    const starforceResolution = captureCore.resolveStarforceEvidence({
      row_observation: descriptor.starforce,
      tooltip_observation: tooltipStarforce,
      starforce_eligible: collectionContext?.starforce_eligible,
      starforce_min: collectionContext?.starforce_min,
      starforce_max: collectionContext?.starforce_max
    });
    const starforce = starforceResolution.observation;
    qualityWarnings.push(...starforceResolution.warnings);
    const nativeListingId = descriptor.native_listing_id;
    const nativeItemId = descriptor.native_item_id;
    const status = listingStatusForPath(location.pathname);
    const tooltipCombatPower = findCombatPowerInTooltip(leftPanel) || descriptor.combat_power_change;

    if (!nativeListingId) {
      qualityWarnings.push("native_listing_id_unavailable; fingerprint_is_not_a_global_deduplication_id");
    }
    if (!nativeItemId) {
      qualityWarnings.push("native_item_id_unavailable; catalog_key_uses_name_and_icon_asset_key");
    }
    if (statLines.length === 0) {
      qualityWarnings.push("stat_lines_not_parsed");
    }
    if (!potential.collected && descriptor.potential_grade_raw) {
      qualityWarnings.push("potential_lines_not_parsed");
    }
    if (!additionalPotential.collected && descriptor.additional_potential_grade_raw) {
      qualityWarnings.push("additional_potential_lines_not_parsed");
    }

    const stats = buildStatsObject(statLines);
    const upgrade = parseUpgrade(upgradeRaw);
    const trade = parseTrade(tradeRaw);
    if (starforce.value == null && starforce.applicable !== false) {
      qualityWarnings.push("starforce_not_confirmed; null_preserved");
    }
    if (trade.scissors_remaining == null || trade.scissors_total == null) {
      qualityWarnings.push("scissors_count_not_exposed; null_preserved");
    }
    const catalogBaseLevel = Number.isInteger(collectionContext?.base_level)
      ? collectionContext.base_level
      : null;
    if (catalogBaseLevel == null) {
      qualityWarnings.push("base_level_unavailable; catalog_join_required");
    }

    const listingFingerprintPayload = {
      page_kind: status,
      observed_date: descriptor.observed_date,
      price_meso: descriptor.price_meso,
      item_name: descriptor.base_name,
      display_name: itemTitle,
      starforce: starforce.value,
      combat_power_change: tooltipCombatPower,
      trade: trade.raw,
      upgrade: upgrade.raw,
      stats: statLines.map((line) => line.raw),
      potential: potential.lines.map((line) => line.raw),
      additional_potential: additionalPotential.lines.map((line) => line.raw)
    };
    const derivedFingerprint = await sha256Hex(JSON.stringify(listingFingerprintPayload));
    const iconAssetKey = extractIconAssetKey(descriptor.icon_url);
    const catalogKey = iconAssetKey
      ? `name_icon_sha256:${await sha256Hex(`${descriptor.base_name}\n${iconAssetKey}`)}`
      : null;
    const requiredLevel = parseFirstInteger(requiredLevelRaw);
    const requiredLevelReduction = catalogBaseLevel != null && requiredLevel != null && requiredLevel <= catalogBaseLevel
      ? catalogBaseLevel - requiredLevel
      : null;

    return {
      observation_id: `${batchId}:${descriptor.index + 1}`,
      row_index: descriptor.index + 1,
      result_rank: descriptor.index + 1,
      matched_preset_ids: [],
      selection_channels: [],
      listing: {
        listing_id: nativeListingId?.value || null,
        listing_id_source: nativeListingId ? "native" : "unavailable",
        listing_id_collision_risk: false,
        listing_fingerprint: `sha256:${derivedFingerprint}`,
        listing_fingerprint_collision_risk: true,
        status,
        price_meso: descriptor.price_meso,
        quantity: 1,
        expires_at: null,
        sold_at: status === "sold" ? descriptor.observed_date : null,
        sold_at_precision: status === "sold" && descriptor.observed_date ? "date" : null,
        listing_world: null,
        is_cross_world: null
      },
      item: {
        item_id: nativeItemId?.value || null,
        item_id_source: nativeItemId ? "native" : iconAssetKey ? "icon_asset_key" : "unavailable",
        catalog_key: catalogKey,
        name: descriptor.base_name,
        catalog_id: collectionContext?.catalog_id || null,
        icon_asset_key: iconAssetKey,
        starforce_preset_id: null,
        category: categoryPath.at(-1) || null,
        category_path: categoryPath,
        base_level: catalogBaseLevel,
        required_level: requiredLevel,
        required_level_reduction: requiredLevelReduction,
        required_job: requiredJobRaw,
        starforce,
        set_name: setName,
        upgrade,
        trade,
        stats,
        potential,
        additional_potential: additionalPotential
      },
      raw_evidence: {
        listing_row: {
          sequence: descriptor.sequence,
          display_name: descriptor.row_name,
          price_raw: descriptor.raw_price,
          observed_date: descriptor.observed_date,
          combat_power_change: descriptor.combat_power_change,
          starforce: descriptor.starforce,
          potential_grade: descriptor.potential_grade_raw,
          additional_potential_grade: descriptor.additional_potential_grade_raw
        },
        tooltip: {
          display_name: itemTitle,
          icon_url: descriptor.icon_url,
          trade: tradeRaw,
          upgrade: upgradeRaw,
          category_path: categoryPath,
          required_job: requiredJobRaw,
          required_level: requiredLevelRaw,
          set_name: setName,
          starforce: tooltipStarforce,
          stat_lines: statLines.map((line) => line.raw),
          potential_heading: potential.raw_heading,
          additional_potential_heading: additionalPotential.raw_heading
        }
      },
      quality_warnings: qualityWarnings
    };
  }

  function collectStatLines(leftPanel) {
    const results = [];
    const seenCodes = new Set();
    const candidates = Array.from(leftPanel.querySelectorAll("div"));

    for (const labelElement of candidates) {
      const label = cleanText(labelElement.textContent);
      const definition = STAT_LABELS.get(label);
      if (!definition || seenCodes.has(definition.code)) {
        continue;
      }

      const row = labelElement.parentElement;
      if (!row || row.children.length < 2 || row.firstElementChild !== labelElement) {
        continue;
      }

      const valueElement = row.children[1];
      const valueText = cleanText(valueElement.textContent);
      const firstValueText = cleanText(valueElement.firstElementChild?.textContent || valueText);
      const total = parseSignedNumber(firstValueText);
      if (total == null) {
        continue;
      }

      const breakdownElement = Array.from(valueElement.querySelectorAll("span")).find((element) =>
        element.classList.contains("inline-flex") && element.classList.contains("items-baseline")
      );
      const breakdown = breakdownElement
        ? Array.from(breakdownElement.children)
          .map((element) => parseBreakdownToken(element, definition.unit))
          .filter(Boolean)
        : [];

      const unit = valueText?.includes("%") ? "pct" : definition.unit;
      results.push({
        code: definition.code,
        key: statKey(definition.code, unit),
        label,
        total,
        unit,
        breakdown,
        component_sum_matches_total: breakdown.length > 0
          ? breakdown.reduce((sum, token) => sum + token.value, 0) === total
          : null,
        raw: `${label} ${valueText}`
      });
      seenCodes.add(definition.code);
    }

    return results;
  }

  function parseBreakdownToken(element, defaultUnit) {
    const raw = cleanText(element.textContent);
    const value = parseSignedNumber(raw);
    if (value == null) {
      return null;
    }

    const colorClass = Array.from(element.classList).find((className) =>
      className.startsWith("text-pc-item-tooltip-option-")
    ) || null;

    return {
      value,
      unit: raw.includes("%") ? "pct" : defaultUnit,
      source_hint: classifyStatSource(colorClass, getComputedStyle(element).color || null),
      raw,
      color_class: colorClass,
      color_rgb: getComputedStyle(element).color || null,
      component_hint: colorClass
        ? colorClass.replace("text-pc-item-tooltip-option-", "site_color:")
        : null
    };
  }

  function buildStatsObject(lines) {
    if (lines.length === 0) {
      return {
        collected: false,
        normalized: false,
        base: null,
        starforce: null,
        scroll: null,
        flame: null,
        total: null,
        lines: []
      };
    }

    const total = {};
    for (const line of lines) {
      total[line.key] = line.total;
    }

    return {
      collected: true,
      normalized: false,
      base: null,
      starforce: null,
      scroll: null,
      flame: null,
      total,
      lines
    };
  }

  function statKey(code, unit) {
    if (unit === "pct") {
      return `${code}_pct`;
    }
    if (unit === "seconds") {
      return `${code}_seconds`;
    }
    return `${code}_flat`;
  }

  function classifyStatSource(colorClass, colorRgb) {
    if (colorClass?.endsWith("yellow-orange")) {
      return "starforce";
    }
    if (colorClass?.endsWith("purple-soft")) {
      return "scroll";
    }
    if (colorClass?.endsWith("green-mint")) {
      return "flame";
    }
    if (!colorClass && (!colorRgb || colorRgb === "rgb(255, 255, 255)")) {
      return "base";
    }
    return "unknown";
  }

  function collectPotential(leftPanel, additional, fallbackGradeRaw) {
    const headings = Array.from(leftPanel.querySelectorAll("div")).filter((element) => {
      const text = cleanText(element.textContent) || "";
      if (!/잠재능력\s*:/u.test(text) || text.length > 60) {
        return false;
      }
      return additional ? /에디셔널 잠재능력/u.test(text) : !/에디셔널/u.test(text);
    });
    const heading = headings.sort((left, right) => left.children.length - right.children.length)[0] || null;

    if (!heading) {
      return {
        collected: false,
        grade: normalizeGrade(fallbackGradeRaw),
        grade_raw: fallbackGradeRaw || null,
        grade_source: fallbackGradeRaw ? "listing_row" : null,
        lines: [],
        raw_heading: null
      };
    }

    const rawHeading = cleanText(heading.textContent);
    const section = heading.parentElement;
    const gradeRaw = rawHeading?.match(/:\s*(\S+)/u)?.[1] || fallbackGradeRaw || null;

    if (gradeRaw === "없음") {
      return {
        collected: true,
        grade: "none",
        grade_raw: gradeRaw,
        grade_source: "tooltip",
        lines: [],
        raw_heading: rawHeading
      };
    }

    const grade = normalizeGrade(gradeRaw);
    const lines = Array.from(section?.children || [])
      .filter((element) => element !== heading)
      .map((element) => {
        const raw = cleanText(element.textContent);
        const bullet = element.querySelector("div[style*='background-color']");
        if (!raw || !bullet) {
          return null;
        }
        const colorRgb = getComputedStyle(bullet).backgroundColor;
        const tier = potentialTierFromColor(colorRgb);
        return {
          ...parsePotentialLine(raw),
          tier,
          is_prime: grade && tier ? grade === tier : null,
          evidence: {
            color_rgb: colorRgb
          }
        };
      })
      .filter(Boolean)
      .slice(0, 3)
      .map((line, index) => ({ line_index: index + 1, ...line }));

    return {
      collected: true,
      grade,
      grade_raw: gradeRaw,
      grade_source: "tooltip",
      lines,
      raw_heading: rawHeading
    };
  }

  function parsePotentialLine(raw) {
    const normalized = raw.replace(/\s*:\s*/g, " ").trim();
    let match = normalized.match(/^(\d+)%\s*확률로\s*받은 피해의\s*(\d+)%를\s*반사$/u);
    if (match) {
      return {
        code: "DAMAGE_REFLECT",
        value: null,
        unit: null,
        params: {
          trigger_chance_pct: Number(match[1]),
          reflected_damage_pct: Number(match[2])
        },
        raw
      };
    }

    match = normalized.match(/^피격 시\s*(\d+)%\s*확률로\s*(\d+)초간\s*무적$/u);
    if (match) {
      return {
        code: "INVINCIBLE_ON_HIT",
        value: null,
        unit: null,
        params: {
          trigger_chance_pct: Number(match[1]),
          duration_seconds: Number(match[2])
        },
        raw
      };
    }

    match = normalized.match(/^피격 시\s*(\d+)%\s*확률로\s*데미지의\s*(\d+)%\s*무시$/u);
    if (match) {
      return {
        code: "DAMAGE_IGNORE_ON_HIT",
        value: null,
        unit: null,
        params: {
          trigger_chance_pct: Number(match[1]),
          ignored_damage_pct: Number(match[2])
        },
        raw
      };
    }

    match = normalized.match(/^캐릭터 기준\s*(\d+)\s*레벨\s*당\s*(.+?)\s*([+-]\d+)$/u);
    if (match) {
      return {
        code: "STAT_PER_CHARACTER_LEVEL",
        value: null,
        unit: null,
        params: {
          levels_per_increment: Number(match[1]),
          stat_code: POTENTIAL_CODE_MAP.get(match[2].trim()) || "UNKNOWN",
          stat_value: Number(match[3])
        },
        raw
      };
    }

    match = normalized.match(
      /^(?:(?:모든\s*스킬의?|스킬)\s*)?재사용 대기시간\s*(?:-\s*(\d+)\s*초(?:\s*감소)?|(\d+)\s*초\s*감소)$/u
    );
    if (match) {
      return {
        code: "COOLDOWN_REDUCTION",
        value: Number(match[1] || match[2]),
        unit: "seconds",
        params: {},
        raw
      };
    }

    match = normalized.match(/^공격\s*시\s*(\d+(?:\.\d+)?)%\s*확률로\s*오토스틸$/u);
    if (match) {
      return {
        code: "AUTO_STEAL",
        value: Number(match[1]),
        unit: "pct",
        params: {},
        raw
      };
    }

    match = normalized.match(/^(.+?)\s*스킬(?:의)?\s*레벨\s*([+-]\d+)$/u);
    if (match) {
      return {
        code: "SKILL_LEVEL",
        value: Number(match[2]),
        unit: "level",
        params: { skill_name: match[1].trim() },
        raw
      };
    }

    match = normalized.match(/^피격 시\s*(\d+)%\s*확률로\s*(\d+)%의\s*(HP|MP)\s*회복$/u);
    if (match) {
      return {
        code: `${match[3]}_RECOVERY_ON_HIT`,
        value: null,
        unit: null,
        params: {
          trigger_chance_pct: Number(match[1]),
          recovery_pct: Number(match[2])
        },
        raw
      };
    }

    match = normalized.match(/^(.+?)\s*([+-]\d+)\s*(%|초)?$/u);
    if (!match) {
      return {
        code: "UNKNOWN",
        value: null,
        unit: null,
        params: {},
        raw
      };
    }

    const label = match[1].trim();
    return {
      code: POTENTIAL_CODE_MAP.get(label) || "UNKNOWN",
      value: Number(match[2]),
      unit: match[3] === "%" ? "pct" : match[3] === "초" ? "seconds" : "flat",
      params: {},
      raw
    };
  }

  function potentialTierFromColor(colorRgb) {
    const normalized = String(colorRgb || "").replace(/\s+/g, "").toLowerCase();
    return POTENTIAL_TIER_BY_RGB.get(normalized) || null;
  }

  function parseUpgrade(raw) {
    if (!raw) {
      return {
        collected: false,
        applied: null,
        remaining: null,
        recoverable: null,
        scroll_type: null,
        raw: null
      };
    }

    const appliedMatch = raw.match(/주문서 강화\s*(\d+)회/u);
    return {
      collected: true,
      applied: /주문서 강화 없음/u.test(raw) ? 0 : appliedMatch ? Number(appliedMatch[1]) : null,
      remaining: numberAfterLabel(raw, "잔여"),
      recoverable: numberAfterLabel(raw, "복구 가능"),
      scroll_type: null,
      raw
    };
  }

  function parseTrade(raw) {
    let state = null;
    if (raw) {
      if (/1회 교환 가능/u.test(raw)) {
        state = "one_trade_left";
      } else if (/장착 시 교환 불가/u.test(raw)) {
        state = "untradeable_after_equip";
      } else if (/교환 불가/u.test(raw)) {
        state = "untradeable";
      } else if (/교환 가능/u.test(raw)) {
        state = "tradeable";
      }
    }

    const scissors = raw?.match(/가위 사용 잔여 횟수\s*:\s*(\d+)\s*\/\s*(\d+)/u);
    return {
      collected: Boolean(raw),
      state,
      scissors_remaining: scissors ? Number(scissors[1]) : null,
      scissors_total: scissors ? Number(scissors[2]) : null,
      raw: raw || null
    };
  }

  function collectCategoryPath(leftPanel) {
    return Array.from(leftPanel.querySelectorAll("span"))
      .filter((element) => element.classList.contains("rounded-full"))
      .map((element) => cleanText(element.textContent))
      .filter(Boolean)
      .slice(0, 2);
  }

  function findTooltipItemTitle(leftPanel, descriptor) {
    const candidates = Array.from(leftPanel.querySelectorAll("div")).filter((element) => {
      const text = cleanText(element.textContent) || "";
      return (
        element.classList.contains("text-center") &&
        element.classList.contains("font-[700]") &&
        text.includes(descriptor.base_name) &&
        text.length < 100
      );
    });
    return cleanText(candidates[0]?.textContent) || null;
  }

  function findLabeledValue(root, label) {
    const labelElement = findExactTextElement(root, label);
    if (!labelElement?.parentElement) {
      return null;
    }

    const parentText = cleanText(labelElement.parentElement.textContent);
    if (parentText?.startsWith(label)) {
      const valueFromParent = parentText.slice(label.length).trim();
      if (valueFromParent) {
        return valueFromParent;
      }
    }

    const siblings = Array.from(labelElement.parentElement.children).filter((element) => element !== labelElement);
    const value = cleanText(siblings.map((element) => element.textContent).join(" "));
    return value || null;
  }

  function findCombatPowerInTooltip(leftPanel) {
    const label = findExactTextElement(leftPanel, "전투력 증가량");
    if (!label?.parentElement) {
      return null;
    }
    const text = cleanText(label.parentElement.textContent) || "";
    return text.match(/전투력\s*증가량\s*(\+\d+(?:만\s*\d+)?)/u)?.[1]?.replace(/\s+/g, " ") || null;
  }

  function findExactTextElement(root, target) {
    return Array.from(root.querySelectorAll("*")).filter((element) => cleanText(element.textContent) === target)
      .sort((left, right) => left.children.length - right.children.length)[0] || null;
  }

  function findLeafText(root, predicate) {
    const candidates = Array.from(root.querySelectorAll("*")).filter((element) => {
      const text = cleanText(element.textContent);
      return text && predicate(text);
    });
    candidates.sort((left, right) => left.children.length - right.children.length);
    return cleanText(candidates[0]?.textContent) || null;
  }

  function findTradeText(root) {
    const candidates = Array.from(root.querySelectorAll("*"))
      .map((element) => cleanText(element.textContent))
      .filter((text) => (
        text &&
        text.length <= 180 &&
        /(?:1회 교환 가능|장착 시 교환 불가|교환 불가|교환 가능)/u.test(text) &&
        !/중복/u.test(text)
      ));
    const unique = Array.from(new Set(candidates));
    const withScissors = unique
      .filter((text) => /가위 사용 잔여 횟수/u.test(text))
      .sort((left, right) => left.length - right.length);

    if (withScissors.length > 0) {
      return withScissors[0];
    }

    return unique.sort((left, right) => left.length - right.length)[0] || null;
  }

  function findRowItemName(row) {
    const candidates = Array.from(row.querySelectorAll("span")).map((element) => cleanText(element.textContent));
    return candidates.find((text) => text && !GRADE_MAP[text] && /[가-힣A-Za-z]/u.test(text) && text.length < 80) || null;
  }

  function extractRowGrades(row) {
    return Array.from(row.querySelectorAll("span"))
      .map((element) => cleanText(element.textContent))
      .filter((text) => text && Object.hasOwn(GRADE_MAP, text));
  }

  function extractStarforceObservation(row) {
    const candidates = Array.from(row.querySelectorAll("div, span"));
    for (const element of candidates) {
      const text = cleanText(element.textContent);
      if (/^\d{1,2}$/u.test(text || "") && element.querySelector("svg")) {
        return {
          value: Number(text),
          applicable: true,
          source: "dom",
          confidence: "confirmed"
        };
      }
    }

    for (const element of [row, ...row.querySelectorAll("*")]) {
      const evidence = [
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        element.getAttribute("data-tooltip"),
        element.getAttribute("data-starforce")
      ].filter(Boolean).join(" ");
      const explicitValue = evidence.match(/(?:스타포스\s*)?(\d{1,2})\s*(?:성|강)/u)?.[1];
      if (explicitValue != null) {
        return {
          value: Number(explicitValue),
          applicable: true,
          source: "dom",
          confidence: "confirmed"
        };
      }
      if (/(?:스타포스\s*없음|0성)/u.test(evidence)) {
        return {
          value: 0,
          applicable: true,
          source: "tooltip_absence",
          confidence: "confirmed"
        };
      }
    }

    return {
      value: null,
      applicable: null,
      source: "unknown",
      confidence: "unknown"
    };
  }

  function extractTooltipStarforceObservation(leftPanel) {
    const starMarkers = Array.from(leftPanel.querySelectorAll("svg")).filter(isTooltipStarMarker);
    if (starMarkers.length > 0) {
      const inactiveCount = starMarkers.filter((svg) => svg.classList.contains("text-white/20")).length;
      const markerObservation = captureCore.starforceObservationFromMarkerCounts(
        starMarkers.length - inactiveCount,
        inactiveCount
      );
      if (markerObservation) {
        return markerObservation;
      }
    }

    const tooltipText = cleanText(leftPanel.textContent) || "";
    if (/스타포스[^.]{0,80}강화 불가/u.test(tooltipText)) {
      return {
        value: null,
        applicable: false,
        source: "dom",
        confidence: "confirmed"
      };
    }
    return null;
  }

  function isTooltipStarMarker(svg) {
    if (String(svg.getAttribute("viewBox") || "").replace(/\s+/g, " ").trim() !== "0 0 12 12") {
      return false;
    }
    return Array.from(svg.querySelectorAll("path")).some((path) =>
      String(path.getAttribute("d") || "").replace(/\s+/g, " ").trim().startsWith("M4.46888 3.03361")
    );
  }

  function extractCombatPower(text) {
    const normalized = String(text).replace(/\s+/g, " ");
    return normalized.match(/전투력\s*증가량\s*(\+\d+(?:만\s*\d+)?)/u)?.[1]?.replace(/\s+/g, " ") || null;
  }

  function extractRawPrice(text) {
    return String(text).match(
      /((?:\d[\d,]*조)(?:\s*\d[\d,]*억)?(?:\s*\d[\d,]*만)?(?:\s*\d[\d,]*)?|(?:\d[\d,]*억)(?:\s*\d[\d,]*만)?(?:\s*\d[\d,]*)?|(?:\d[\d,]*만)(?:\s*\d[\d,]*)?|\d[\d,]*)\s*메소/u
    )?.[1] || null;
  }

  function rawPriceToMesoString(rawPrice) {
    if (!rawPrice) {
      return null;
    }

    const jo = parseBigIntGroup(rawPrice.match(/(\d[\d,]*)조/u)?.[1]);
    const eok = parseBigIntGroup(rawPrice.match(/(\d[\d,]*)억/u)?.[1]);
    const man = parseBigIntGroup(rawPrice.match(/(\d[\d,]*)만/u)?.[1]);
    const remainderText = rawPrice
      .replace(/\d[\d,]*조/u, "")
      .replace(/\d[\d,]*억/u, "")
      .replace(/\d[\d,]*만/u, "")
      .trim();
    const remainder = parseBigIntGroup(remainderText);
    return (jo * 1_000_000_000_000n + eok * 100_000_000n + man * 10_000n + remainder).toString();
  }

  function parseBigIntGroup(value) {
    const digits = String(value || "").replace(/,/g, "").trim();
    return /^\d+$/u.test(digits) ? BigInt(digits) : 0n;
  }

  function parseSignedNumber(value) {
    const match = String(value || "").replace(/,/g, "").match(/[+-]?\d+/u);
    return match ? Number(match[0]) : null;
  }

  function parseFirstInteger(value) {
    const match = String(value || "").replace(/,/g, "").match(/\d+/u);
    return match ? Number(match[0]) : null;
  }

  function numberAfterLabel(text, label) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = String(text).match(new RegExp(`${escaped}\\s*(\\d+)회`, "u"));
    return match ? Number(match[1]) : null;
  }

  function normalizeGrade(raw) {
    if (raw === "없음") {
      return "none";
    }
    return raw && Object.hasOwn(GRADE_MAP, raw) ? GRADE_MAP[raw] : null;
  }

  function listingStatusForPath(pathname) {
    if (/^\/price(?:\/|$)/u.test(pathname)) {
      return "sold";
    }
    if (/^\/(?:buy|search)(?:\/|$)/u.test(pathname)) {
      return "active";
    }
    return "unknown";
  }

  function readCollectionResultReadiness(rows, emptyResult, options) {
    const searchContext = collectSearchContext();
    const tracker = captureState.filterSearchResultTracker;
    const trackerMatches = tracker?.attemptId === options.attemptId;
    const documentReplaced = Boolean(
      options.previousDocumentToken && options.previousDocumentToken !== resultDocumentToken
    );
    const currentKey = new URL(location.href).searchParams.get("priceSearchKey") || null;
    const freshPriceSearchKey = Boolean(currentKey && (
      options.expectedPriceSearchKey
        ? currentKey === options.expectedPriceSearchKey
        : !options.previousPriceSearchKey || currentKey !== options.previousPriceSearchKey
    ));
    const resultSignature = resultDomSignature(rows, emptyResult);
    const primaryNode = rows[0] || findVisibleEmptyResultMarkerElement() || null;
    const domSnapshotChanged = Boolean(trackerMatches && (
      resultSignature !== tracker.baselineSignature || primaryNode !== tracker.baselinePrimaryNode
    ));
    if (domSnapshotChanged && tracker.lastMutationAt == null) {
      // A replaced result subtree can escape an observer attached to the old
      // React node. The changed snapshot itself is still valid mutation proof.
      tracker.lastMutationAt = Date.now();
    }
    const completedInvalidationCycle = Boolean(
      trackerMatches && tracker.sawResultInvalidated && tracker.resultMutationObserved
    );
    const resultGenerationChanged = documentReplaced || domSnapshotChanged || completedInvalidationCycle;
    const headingVisible = Boolean(findFilterSearchResultHeadingElement());
    const resultBusy = isResultViewBusy();
    const exactItemRowCount = rows.filter((row) => rowMatchesExactKeyword(row, options.expectedQuery.keyword)).length;
    const allRowsExact = rows.length === 0 || exactItemRowCount === rows.length;
    const allowedNames = new Set(
      Array.isArray(options.expectedQuery.allowed_names) ? options.expectedQuery.allowed_names : []
    );
    const allowedItemRowCount = rows.filter((row) => rowMatchesAllowedName(row, allowedNames)).length;
    const requiresExactRows = options.expectedQuery.exact_match !== false;
    const rowScopeValid = !requiresExactRows || allRowsExact;
    const resultReady = Boolean(headingVisible && (rows.length > 0 || emptyResult));
    const resultContextMatches = resultSearchContextMatchesExpected(searchContext, options.expectedQuery);
    const attemptMatches = documentReplaced || trackerMatches;
    const lastMutationAge = documentReplaced
      ? null
      : trackerMatches && tracker.lastMutationAt != null
        ? Math.max(0, Date.now() - tracker.lastMutationAt)
        : null;
    const candidateReady = attemptMatches && freshPriceSearchKey && resultContextMatches &&
      resultGenerationChanged && resultReady && !resultBusy && rowScopeValid;

    return {
      attempt_matches: attemptMatches,
      fresh_price_search_key: freshPriceSearchKey,
      result_context_matches: resultContextMatches,
      result_generation_changed: resultGenerationChanged,
      result_heading_visible: headingVisible,
      result_ready: resultReady,
      result_busy: resultBusy,
      requires_exact_rows: requiresExactRows,
      row_scope_valid: rowScopeValid,
      all_rows_exact: allRowsExact,
      row_count: rows.length,
      exact_item_row_count: exactItemRowCount,
      allowed_item_row_count: allowedItemRowCount,
      empty_result: emptyResult,
      result_signature: resultSignature,
      document_replaced: documentReplaced,
      last_result_mutation_age_ms: lastMutationAge,
      candidate_ready: candidateReady
    };
  }

  function resultSearchContextMatchesExpected(searchContext, expectedQuery = {}) {
    const expected = copyDiagnosticQuery(expectedQuery);
    const potential = searchContext.filters?.enhancement?.potential?.[0] || null;
    const actualStarforceMin = searchContext.filters?.enhancement?.starforce_min ?? null;
    const actualStarforceMax = searchContext.filters?.enhancement?.starforce_max ?? null;
    const actualPriceMin = searchContext.filters?.price?.minimum_meso ?? null;
    const actualPriceMax = searchContext.filters?.price?.maximum_meso ?? null;
    const expectedItemCategory = expected.item_category_filter;
    const actualItemCategory = String(searchContext.raw_filters?.itemCategory || "").trim().toUpperCase() || null;
    const expectedSubcategory = expected.equipment_subcategory_filter;
    const actualSubcategory = normalizeEquipmentSubcategory(
      searchContext.raw_filters?.["form::equipmentSubcategory"] ??
      searchContext.filters?.equipment_subcategory
    );
    const priceEvidenceValid = [
      searchContext.raw_filters?.["price::min"],
      searchContext.raw_filters?.["price::max"],
      searchContext.raw_filters?.["form::priceMinMeso"],
      searchContext.raw_filters?.["form::priceMaxMeso"]
    ].every(isValidMesoFormInteger);
    const unrestrictedStarforceAlias = expected.starforce_min == null && actualStarforceMin === 0;
    const zeroStarMaximumAlias = expected.starforce_min === 0 && expected.starforce_max === 0 &&
      actualStarforceMin === 0 && actualStarforceMax == null;
    // The form represents both selections under ARMOR, then the result URL
    // canonicalizes them to ARMOR_ACCESSORY or ARMOR_ARMOR. The matching URL
    // code is also sufficient evidence if React replaces the subcategory
    // control before the result snapshot is read.
    const canonicalCategoryForSubcategory = expectedItemCategory === "ARMOR"
      ? expectedSubcategory === "장신구"
        ? "ARMOR_ACCESSORY"
        : expectedSubcategory === "방어구"
          ? "ARMOR_ARMOR"
          : null
      : null;
    const subcategoryCategoryAlias = canonicalCategoryForSubcategory != null &&
      actualItemCategory === canonicalCategoryForSubcategory;
    const canonicalSubcategoryEvidence = expectedSubcategory != null &&
      actualSubcategory === null && subcategoryCategoryAlias;
    return searchContext.page_kind === "sold" &&
      normalizeSearchKeyword(searchContext.keyword) === normalizeSearchKeyword(expected.keyword) &&
      exactMatchContextMatches(searchContext.raw_filters?.isExactMatch, expected) &&
      searchContext.raw_filters?.searchTab === "condition" &&
      (!expectedItemCategory || actualItemCategory === expectedItemCategory || subcategoryCategoryAlias) &&
      (!expectedSubcategory || actualSubcategory === expectedSubcategory || canonicalSubcategoryEvidence) &&
      (actualStarforceMin === expected.starforce_min || unrestrictedStarforceAlias) &&
      (actualStarforceMax === expected.starforce_max || zeroStarMaximumAlias) &&
      priceEvidenceValid &&
      actualPriceMin === expected.price_min_meso &&
      actualPriceMax === expected.price_max_meso &&
      (potential?.code ?? null) === (expected.server_filter?.code ?? null) &&
      (potential?.minimum ?? null) === (expected.server_filter?.minimum ?? null) &&
      searchContext.page === expected.page &&
      searchContext.limit === expected.page_limit &&
      searchContext.sort === "trade_date_desc";
  }

  function normalizeSearchKeyword(value) {
    return String(value ?? "").trim();
  }

  function rowMatchesExactKeyword(row, keyword) {
    const expected = String(keyword || "").trim();
    const imageName = row.querySelector("img[alt]")?.alt?.trim() || "";
    const rowName = findRowItemName(row) || "";
    return imageName === expected || rowName.replace(/\s*\(\+?\d+\)\s*$/u, "").trim() === expected;
  }

  function exactMatchContextMatches(value, expectedQuery = {}) {
    if (
      expectedQuery.search_scope === "catalog_global" &&
      normalizeSearchKeyword(expectedQuery.keyword) === ""
    ) {
      return value == null || parseNullableBoolean(value) != null;
    }
    const expected = expectedQuery.exact_match !== false;
    const actual = parseNullableBoolean(value);
    return actual === expected || (expected === false && value == null);
  }

  function rowMatchesAllowedName(row, allowedNames) {
    if (!(allowedNames instanceof Set) || allowedNames.size === 0) return false;
    const imageName = row.querySelector("img[alt]")?.alt?.trim() || "";
    const rowName = (findRowItemName(row) || "").replace(/\s*\(\+?\d+\)\s*$/u, "").trim();
    return allowedNames.has(imageName) || allowedNames.has(rowName);
  }

  function isResultViewBusy() {
    return Array.from(document.querySelectorAll(
      '#main-container [aria-busy="true"], main [aria-busy="true"], #main-container [class*="animate-spin"], main [class*="animate-spin"]'
    )).some(isVisibleElement);
  }

  function resultDomSignature(rows, emptyResult) {
    const heading = cleanText(findFilterSearchResultHeadingElement()?.textContent) || "";
    const rowParts = rows.map((row, index) => {
      const descriptor = describeListingRow(row, index, rows.length);
      return [
        descriptor.base_name,
        descriptor.row_name,
        descriptor.raw_price,
        descriptor.observed_date,
        descriptor.native_listing_id,
        descriptor.native_item_id
      ].map((value) => value ?? "").join("\u001f");
    });
    const payload = [heading, emptyResult ? "empty" : "rows", ...rowParts].join("\u001e");
    return `dom-v1:${rows.length}:${hashResultSnapshot(payload)}`;
  }

  function hashResultSnapshot(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function readFilterSearchDiagnosticResult(expectedQuery = {}, diagnosticId = null) {
    const rows = findListingRows();
    const searchContext = collectSearchContext();
    const summary = collectResultSummary(rows, searchContext);
    const emptyResult = rows.length === 0 && hasVisibleEmptyResultMarker();
    const headingVisible = Boolean(findFilterSearchResultHeadingElement());
    const activeDiagnostic = captureState.formDiagnostic;
    const resultGenerationChanged = activeDiagnostic?.id === diagnosticId
      ? activeDiagnostic.resultMutationObserved === true || activeDiagnostic.resultUrlBeforeSubmit !== location.href
      : !activeDiagnostic && Boolean(diagnosticId && searchContext.price_search_key_present);
    const resultBusy = isResultViewBusy();
    const expected = copyDiagnosticQuery(expectedQuery);
    const exactItemRows = rows.filter((row) => rowMatchesExactKeyword(row, expected.keyword)).length;
    const urlConditionsMatch = resultSearchContextMatchesExpected(searchContext, expected);

    return {
      page_kind_sold: searchContext.page_kind === "sold",
      key_present: searchContext.price_search_key_present === true,
      url_conditions_match: urlConditionsMatch,
      result_heading_visible: headingVisible,
      result_ready: Boolean(headingVisible && (rows.length > 0 || emptyResult)),
      row_count: rows.length,
      exact_item_row_count: exactItemRows,
      empty_result: emptyResult,
      displayed_page_limit: summary.displayed_page_limit,
      requested_page_limit: searchContext.limit,
      current_page: summary.current_page,
      latest_sale_sort: searchContext.sort === "trade_date_desc",
      result_generation_changed: resultGenerationChanged,
      result_busy: resultBusy,
      search_used: summary.site_search_usage?.used ?? null,
      search_limit: summary.site_search_usage?.limit ?? null
    };
  }

  function collectCaptureContext(rows, resultReadiness = null) {
    const searchContext = collectSearchContext();
    const viewerWorld = findMetadataValue(["조회 월드", "캐릭터 월드", "현재 월드"]);
    const auctionGroup = findMetadataValue(["옥션 그룹", "경매장 그룹"]);
    const qualityWarnings = [];

    if (!viewerWorld) {
      qualityWarnings.push("viewer_world_not_exposed; null_preserved");
    }
    if (!auctionGroup) {
      qualityWarnings.push("auction_group_not_exposed; null_preserved");
    }
    if (searchContext.only_current_world == null) {
      qualityWarnings.push("only_current_world_not_exposed; null_preserved");
    }

    return {
      source_path: location.pathname,
      viewer_world: viewerWorld,
      auction_group: auctionGroup,
      search_context: searchContext,
      result_summary: collectResultSummary(rows, searchContext),
      ...(resultReadiness ? { result_readiness: resultReadiness } : {}),
      quality_warnings: qualityWarnings
    };
  }

  function collectSearchContext() {
    const url = new URL(location.href);
    const reserved = new Set([
      "keyword",
      "sortType",
      "page",
      "limit",
      "onlyCurrentWorld",
      "isOnlyCurrentWorld",
      "worldOnly"
    ]);
    const allowedFilterKeys = new Set([
      "searchTab",
      "isExactMatch",
      "itemCategory",
      "enhancementOption::starforceMin",
      "enhancementOption::starforceMax",
      "enhancementOption::potentialFilters::optionRows",
      "price::min",
      "price::max"
    ]);
    const rawFilters = {};

    for (const [key, value] of url.searchParams.entries()) {
      if (!reserved.has(key) && allowedFilterKeys.has(key)) {
        rawFilters[key] = value;
      }
    }

    try {
      const panel = findFilterPanel(findFilterSearchButton());
      const prices = findPriceInputs(panel);
      const equipmentSubcategory = readEquipmentSubcategorySelection(panel);
      const minimum = parseMesoFormInteger(prices?.minimum?.value);
      const maximum = parseMesoFormInteger(prices?.maximum?.value);
      if (equipmentSubcategory) {
        rawFilters["form::equipmentSubcategory"] = equipmentSubcategory;
      }
      if (!isValidMesoFormInteger(prices?.minimum?.value)) {
        rawFilters["form::priceMinMeso"] = "invalid";
      } else if (minimum != null && minimum !== 0) {
        rawFilters["form::priceMinMeso"] = String(minimum);
      }
      if (!isValidMesoFormInteger(prices?.maximum?.value)) {
        rawFilters["form::priceMaxMeso"] = "invalid";
      } else if (maximum != null && maximum !== 0) {
        rawFilters["form::priceMaxMeso"] = String(maximum);
      }
    } catch (_error) {
      // URL 가격 키가 있으면 그 값을 사용하고, 없으면 context 검증이 안전하게 실패합니다.
    }

    const onlyCurrentWorldRaw = ["onlyCurrentWorld", "isOnlyCurrentWorld", "worldOnly"]
      .map((key) => url.searchParams.get(key))
      .find((value) => value != null);

    return {
      page_kind: listingStatusForPath(url.pathname),
      keyword: url.searchParams.get("keyword"),
      sort: normalizeSort(url.searchParams.get("sortType")),
      page: findCurrentPage() || parseNullableInteger(url.searchParams.get("page")),
      limit: parseNullableInteger(url.searchParams.get("limit")),
      only_current_world: parseNullableBoolean(onlyCurrentWorldRaw) ?? findOnlyCurrentWorldSelection(),
      price_search_key_present: Boolean(url.searchParams.get("priceSearchKey")),
      filter_search_applied: Boolean(
        url.searchParams.get("priceSearchKey") && findFilterSearchResultHeading()
      ),
      filters: normalizeSearchFilters(rawFilters),
      raw_filters: rawFilters
    };
  }

  function findFilterSearchResultHeading() {
    return Boolean(findFilterSearchResultHeadingElement());
  }

  function findFilterSearchResultHeadingElement() {
    return Array.from(document.querySelectorAll("#main-container div, #main-container span, main div, main span"))
      .filter((element) => {
        const text = cleanText(element.textContent) || "";
        return /^필터\s*검색\s*결과(?:\s*[\d,]+건)?$/u.test(text) && isVisibleElement(element);
      })
      .sort((left, right) => left.childElementCount - right.childElementCount)[0] || null;
  }

  function hasVisibleEmptyResultMarker() {
    return Boolean(findVisibleEmptyResultMarkerElement());
  }

  function findVisibleEmptyResultMarkerElement() {
    const pattern = /^(?:일치하는 아이템이 없습니다\.?|검색 결과가 없습니다\.?|매물이 없습니다\.?|거래 내역이 없습니다\.?)$/u;
    return Array.from(document.querySelectorAll("#main-container div, #main-container p, #main-container span, main div, main p, main span"))
      .filter((element) => pattern.test(cleanText(element.textContent) || "") && isVisibleElement(element))
      .sort((left, right) => left.childElementCount - right.childElementCount)[0] || null;
  }

  function normalizeSearchFilters(rawFilters) {
    const normalized = {
      search_tab: rawFilters.searchTab || null,
      exact_match: parseNullableBoolean(rawFilters.isExactMatch),
      item_category: rawFilters.itemCategory || null,
      equipment_subcategory: normalizeEquipmentSubcategory(
        rawFilters["form::equipmentSubcategory"]
      ),
      enhancement: {
        starforce_min: parseNullableInteger(rawFilters["enhancementOption::starforceMin"]),
        starforce_max: parseNullableInteger(rawFilters["enhancementOption::starforceMax"]),
        potential: []
      },
      price: {
        minimum_meso: parseNullablePriceInteger(
          rawFilters["form::priceMinMeso"] ?? rawFilters["price::min"]
        ),
        maximum_meso: parseNullablePriceInteger(
          rawFilters["form::priceMaxMeso"] ?? rawFilters["price::max"]
        )
      },
      other: {}
    };
    const handled = new Set([
      "searchTab",
      "isExactMatch",
      "itemCategory",
      "enhancementOption::starforceMin",
      "enhancementOption::starforceMax",
      "enhancementOption::potentialFilters::optionRows",
      "price::min",
      "price::max",
      "form::equipmentSubcategory",
      "form::priceMinMeso",
      "form::priceMaxMeso"
    ]);
    const optionRows = rawFilters["enhancementOption::potentialFilters::optionRows"];
    if (optionRows) {
      const [code, minimum] = optionRows.split("\u001f");
      normalized.enhancement.potential.push({
        code: code || null,
        minimum: parseNullableInteger(minimum)
      });
    }
    for (const [key, value] of Object.entries(rawFilters)) {
      if (!handled.has(key)) {
        normalized.other[key] = value;
      }
    }
    return normalized;
  }

  function collectResultSummary(rows, searchContext) {
    const bodyText = cleanText(document.body?.innerText || "") || "";
    const resultHeadingText = cleanText(findFilterSearchResultHeadingElement()?.textContent) || "";
    const totalResultsRaw = resultHeadingText.match(/필터\s*검색\s*결과\s*([\d,]+)\s*건/u)?.[1] ||
      bodyText.match(/필터\s*검색\s*결과\s*([\d,]+)\s*건/u)?.[1] || null;
    const totalPagesFromText = bodyText.match(/(?:총|전체)\s*([\d,]+)\s*페이지/u)?.[1] || null;
    const lastPageControl = Array.from(document.querySelectorAll("a, button")).find((element) => {
      const label = [element.getAttribute("aria-label"), element.getAttribute("title")].filter(Boolean).join(" ");
      return /(?:마지막|last)\s*(?:페이지|page)/iu.test(label) && /\d/u.test(label);
    });
    const lastPageFromControl = [lastPageControl?.getAttribute("aria-label"), lastPageControl?.getAttribute("title")]
      .filter(Boolean).join(" ").match(/([\d,]+)/u)?.[1] || null;
    let paginationState = null;
    try {
      paginationState = readVerifiedPaginationState();
    } catch (_error) {
      paginationState = null;
    }
    const pagination = paginationState?.root || null;
    const nextControl = Array.from(pagination?.querySelectorAll("a, button") || []).find((element) => {
      const label = [cleanText(element.textContent), element.getAttribute("aria-label"), element.getAttribute("title")]
        .filter(Boolean).join(" ");
      return /(?:다음|next)/iu.test(label) && /(?:페이지|page|다음)/iu.test(label);
    });
    const disabled = nextControl
      ? nextControl.hasAttribute("disabled") || nextControl.getAttribute("aria-disabled") === "true"
      : null;
    const paginationButtons = Array.from(pagination?.querySelectorAll("button") || []);
    const numberedButtons = paginationButtons.filter((button) => /^\d+$/u.test(cleanText(button.textContent) || ""));
    const currentNumber = paginationState?.selectedPage ?? null;
    const laterNumberVisible = Number.isInteger(currentNumber) && numberedButtons.some((button) =>
      parseFirstInteger(cleanText(button.textContent)) > currentNumber
    );
    const buttonsAfterNumbers = numberedButtons.length > 0
      ? paginationButtons.slice(paginationButtons.lastIndexOf(numberedButtons.at(-1)) + 1)
      : [];
    const enabledForwardButton = buttonsAfterNumbers.some((button) =>
      !button.disabled && button.getAttribute("aria-disabled") !== "true"
    );
    const paginationHasNext = pagination
      ? Boolean(laterNumberVisible || enabledForwardButton)
      : null;
    const pageSizeControl = Array.from(document.querySelectorAll(
      "button, [role='combobox'], [role='option'], span, p"
    ))
      .filter(isVisibleElement)
      .map((element) => ({
        element,
        text: cleanText(element.textContent) || ""
      }))
      .filter(({ text }) => /^\d+개씩\s*보기$/u.test(text))
      .sort((left, right) => left.element.childElementCount - right.element.childElementCount)[0];
    const displayedPageLimit = parseFirstInteger(
      pageSizeControl?.text || (cleanText(pagination?.textContent) || "").match(/(\d+)개씩\s*보기/u)?.[1]
    );
    const siteSearchUsage = readSiteSearchUsage();
    const totalResults = totalResultsRaw ? Number(totalResultsRaw.replace(/,/g, "")) : null;
    const arithmeticHasNext = Number.isInteger(totalResults) && Number.isInteger(searchContext.page) &&
      Number.isInteger(displayedPageLimit || searchContext.limit)
      ? searchContext.page * (displayedPageLimit || searchContext.limit) < totalResults
      : null;

    return {
      total_results: totalResults,
      total_pages: totalPagesFromText || lastPageFromControl
        ? Number(String(totalPagesFromText || lastPageFromControl).replace(/,/g, ""))
        : null,
      current_page: searchContext.page,
      has_next_page: arithmeticHasNext ?? (nextControl ? !disabled : paginationHasNext),
      page_item_count: rows.length,
      requested_page_limit: searchContext.limit,
      displayed_page_limit: displayedPageLimit,
      site_search_usage: siteSearchUsage
    };
  }

  function readSiteSearchUsage() {
    const pattern = /검색\s*횟수\s*([\d,]+)\s*\/\s*([\d,]+)/u;
    const visibleCounter = Array.from(document.querySelectorAll("span, p, strong, div"))
      .filter((element) => element.childElementCount <= 3 && isVisibleElement(element))
      .map((element) => cleanText(element.textContent) || "")
      .filter((text) => text.length <= 60 && pattern.test(text))
      .sort((left, right) => left.length - right.length)[0];
    const bodyText = cleanText(document.body?.innerText || "") || "";
    const match = (visibleCounter || bodyText).match(pattern);
    if (!match) return null;
    const used = Number(match[1].replace(/,/g, ""));
    const limit = Number(match[2].replace(/,/g, ""));
    return Number.isInteger(used) && Number.isInteger(limit) ? { used, limit } : null;
  }

  function findCurrentPage() {
    try {
      return readVerifiedPaginationState().selectedPage;
    } catch (_error) {
      return null;
    }
  }

  function findOnlyCurrentWorldSelection() {
    const labels = Array.from(document.querySelectorAll("label")).filter((label) =>
      /(?:현재|내)\s*월드.*(?:만|한정)/u.test(cleanText(label.textContent) || "")
    );
    for (const label of labels) {
      const input = label.querySelector("input[type='checkbox']") ||
        (label.htmlFor ? document.getElementById(label.htmlFor) : null);
      if (input?.type === "checkbox") {
        return input.checked;
      }
    }
    return null;
  }

  function findMetadataValue(labels) {
    for (const label of labels) {
      const value = findLabeledValue(document, label);
      if (value && value.length <= 40) {
        return value;
      }
    }
    return null;
  }

  function normalizeSort(raw) {
    if (!raw) {
      return null;
    }
    return raw.toLowerCase();
  }

  function parseNullableInteger(value) {
    if (value == null || !/^\d+$/u.test(value)) {
      return null;
    }
    return Number(value);
  }

  function parseNullablePriceInteger(value) {
    const normalized = String(value ?? "").replace(/[\s,]/gu, "");
    const parsed = parseNullableInteger(normalized);
    return parsed === 0 ? null : parsed;
  }

  function parseNullableBoolean(value) {
    if (value == null) {
      return null;
    }
    if (/^(?:true|1|yes)$/iu.test(value)) {
      return true;
    }
    if (/^(?:false|0|no)$/iu.test(value)) {
      return false;
    }
    return null;
  }

  function findNativeListingId(row) {
    return findNativeId(row, {
      attributeNames: [
        "data-listing-id",
        "data-auction-id",
        "data-auction-no",
        "data-trade-id",
        "data-trade-no"
      ],
      queryNames: ["listingId", "auctionId", "auctionNo", "tradeId", "tradeNo"]
    });
  }

  function findNativeItemId(row) {
    return findNativeId(row, {
      attributeNames: ["data-item-id", "data-item-code", "data-item-no"],
      queryNames: ["itemId", "itemCode", "itemNo"]
    });
  }

  function findNativeId(root, config) {
    for (const element of [root, ...root.querySelectorAll("*")]) {
      for (const attributeName of config.attributeNames) {
        const value = element.getAttribute(attributeName);
        if (isPlausibleId(value)) {
          return { value, source: `dom_attribute:${attributeName}` };
        }
      }
    }

    for (const anchor of root.querySelectorAll("a[href]")) {
      try {
        const url = new URL(anchor.href, location.href);
        for (const queryName of config.queryNames) {
          const value = url.searchParams.get(queryName);
          if (isPlausibleId(value)) {
            return { value, source: `url_parameter:${queryName}` };
          }
        }
      } catch (_error) {
        // 잘못된 링크는 ID 후보에서 제외합니다.
      }
    }

    return null;
  }

  function isPlausibleId(value) {
    return typeof value === "string" && value.length >= 4 && value.length <= 160 && /^[A-Za-z0-9:_-]+$/u.test(value);
  }

  function extractIconAssetKey(url) {
    if (!url) {
      return null;
    }
    try {
      const filename = new URL(url).pathname.split("/").at(-1) || "";
      return filename.replace(/\.[A-Za-z0-9]+$/u, "") || null;
    } catch (_error) {
      return null;
    }
  }

  function safePublicUrl(value) {
    if (!value) {
      return null;
    }
    try {
      const url = new URL(value, location.href);
      return url.protocol === "https:" ? url.href : null;
    } catch (_error) {
      return null;
    }
  }

  async function sha256Hex(value) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function isoWithLocalOffset(date) {
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const absolute = Math.abs(offsetMinutes);
    const localTime = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
      .toISOString()
      .replace("Z", "");
    return `${localTime}${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
  }

  function cleanupSession() {
    tooltipNetworkBridge.rejectPending(new Error("tooltip_network_session_cleaned"));

    const scrollRoot = document.getElementById("scroll-root");
    if (scrollRoot && captureState.originalScrollTop != null) {
      scrollRoot.scrollTop = captureState.originalScrollTop;
    }
    captureState.originalScrollTop = null;
    captureState.filterSearchAttemptId = null;
    captureState.filterSearchPreviousUrl = null;
    captureState.filterSearchPreviousKey = null;
    captureState.filterSearchClickPromise = null;
    captureState.filterSearchClickResult = null;
    captureState.preparedFilterSearch = null;
    captureState.filterSearchResultTracker?.observer?.disconnect();
    captureState.filterSearchResultTracker = null;
    abortFormDiagnostic();
  }

  function cleanText(value) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    return normalized || null;
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
})();
