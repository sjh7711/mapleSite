export const NETWORK_DIAGNOSTIC_SCHEMA_VERSION = "maple-auction.network-diagnostic.v1";
export const NETWORK_DIAGNOSTIC_MAX_EVENTS = 400;

const AUCTION_ORIGIN = "https://auction.maplestory.nexon.com";
const TOOLTIP_API_ORIGIN = "https://api.mskr.nexon.com";
const MONITORED_ORIGINS = new Set([AUCTION_ORIGIN, TOOLTIP_API_ORIGIN]);
const UUID_ANY_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;
const SOLD_TOOLTIP_PATTERN = /^\/v1\/market\/web\/items\/searches\/sold\/[^/]+\/tool-tip\/?$/u;
const PUBLIC_PAGE_PATHS = new Set(["/", "/price", "/buy", "/sell"]);
const SAFE_METHOD = /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/u;
const SAFE_SORT = /^[A-Z0-9_]{1,64}$/u;
const SAFE_TYPE = /^[a-z_]{1,32}$/u;
const SAFE_ERROR = /^net::ERR_[A-Z0-9_]{1,64}$/u;
const SAFE_TRANSPORT = /^(?:fetch|xhr|performance_recovery|direct_fetch)$/u;

export function sanitizeNetworkRequestEvent(details = {}, phase = "completed") {
  let url;
  try {
    url = new URL(String(details.url || ""));
  } catch {
    return null;
  }
  if (!MONITORED_ORIGINS.has(url.origin)) return null;

  const originalPath = url.pathname;
  const endpoint = endpointFamily(originalPath, url.origin);
  const isTooltip = endpoint === "sold_tooltip";
  const path = redactPath(originalPath, endpoint);
  const method = String(details.method || "GET").toUpperCase();
  const type = String(details.type || "other").toLowerCase();
  const timestamp = Number(details.timeStamp);
  const statusCode = Number(details.statusCode);
  const error = String(details.error || "");

  return {
    occurred_at: new Date(Number.isFinite(timestamp) ? timestamp : Date.now()).toISOString(),
    phase: ["completed", "error", "redirect"].includes(phase) ? phase : "completed",
    method: SAFE_METHOD.test(method) ? method : "OTHER",
    resource_type: SAFE_TYPE.test(type) ? type : "other",
    path,
    endpoint,
    page: isTooltip ? positiveInteger(url.searchParams.get("page")) : null,
    limit: isTooltip ? positiveInteger(url.searchParams.get("limit")) : null,
    sort: isTooltip ? safeSort(url.searchParams.get("sortType")) : null,
    status_code: Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599
      ? statusCode
      : null,
    from_cache: details.fromCache === true,
    frame_scope: Number(details.frameId) === 0
      ? "top"
      : Number(details.frameId) < 0 ? "unbound" : "subframe",
    error: error && SAFE_ERROR.test(error) ? error : error ? "request_failed" : null
  };
}

export function buildNetworkDiagnosticReport(session = {}, pageHook = null) {
  const events = Array.isArray(session.events)
    ? session.events.map(sanitizeStoredEvent).filter(Boolean)
    : [];
  const completedEvents = events.filter((event) => event.phase !== "redirect");
  const redirects = events.filter((event) => event.phase === "redirect");
  const pathCounts = countBy(completedEvents, (event) => event.path);
  const typeCounts = countBy(completedEvents, (event) => event.resource_type);
  const statusCounts = countBy(completedEvents, (event) => event.phase === "error"
    ? "error"
    : event.status_code == null ? "unknown" : String(event.status_code));
  const tooltips = completedEvents.filter((event) => event.endpoint === "sold_tooltip");
  const errors = completedEvents.filter((event) =>
    event.phase === "error" || (event.status_code != null && event.status_code >= 400)
  );

  return {
    schema_version: NETWORK_DIAGNOSTIC_SCHEMA_VERSION,
    extension_version: safeText(session.extension_version, 24),
    session_id: safeSessionId(session.session_id),
    started_at: safeIso(session.started_at),
    finished_at: safeIso(session.finished_at),
    active: session.active === true,
    expires_at: safeIso(session.expires_at),
    dropped_events: nonNegativeInteger(session.dropped_events),
    summary: {
      total_requests: completedEvents.length,
      tooltip_requests: tooltips.length,
      failed_requests: errors.length,
      redirects: redirects.length,
      paths: pathCounts,
      resource_types: typeCounts,
      statuses: statusCounts
    },
    page_hook: sanitizePageHookStatus(pageHook),
    events
  };
}

export function networkDiagnosticExportContainsSensitiveData(report) {
  const serialized = JSON.stringify(report || {});
  return UUID_ANY_PATTERN.test(serialized) ||
    /(?:accountId|characterId|priceSearchKey|searchKey|encryptedItemId|tradeSn|authorization|cookie|csrf|otp)/iu.test(serialized) ||
    /https?:\/\//iu.test(serialized);
}

export function formatNetworkDiagnosticEvent(event = {}) {
  const time = safeIso(event.occurred_at)
    ? new Date(event.occurred_at).toLocaleTimeString("ko-KR", { hour12: false })
    : "--:--:--";
  const status = event.phase === "error"
    ? "오류"
    : event.status_code == null ? "상태 ?" : String(event.status_code);
  const tooltip = event.endpoint === "sold_tooltip"
    ? ` · ${event.page ?? "?"}페이지 · ${event.limit ?? "?"}개 · ${event.sort || "정렬 ?"}`
    : "";
  const cache = event.from_cache ? " · 캐시" : "";
  return `${time} · ${status} · ${event.resource_type || "other"} · ${event.method || "GET"} ${event.path || "/"}${tooltip}${cache}`;
}

export function diagnoseNetworkDiagnosticReport(report) {
  if (!report) return null;
  const summary = report.summary || {};
  const tooltips = (report.events || []).filter((event) =>
    event.endpoint === "sold_tooltip" && event.phase !== "redirect"
  );
  if ((summary.total_requests || 0) === 0) {
    return { level: "warning", text: "아직 완료되거나 실패한 네트워크 요청이 없습니다." };
  }
  if (tooltips.length === 0) {
    return { level: "warning", text: "경매장 요청은 보이지만 판매 매물 tool-tip 요청은 발생하지 않았습니다." };
  }

  const successfulTooltips = tooltips.filter((event) =>
    event.phase === "completed" && isSuccessfulStatus(event.status_code)
  );
  const failedTooltips = tooltips.filter((event) =>
    event.phase === "error" || (event.status_code != null && Number(event.status_code) >= 400)
  );
  if (successfulTooltips.length === 0) {
    return failedTooltips.length > 0
      ? { level: "error", text: "판매 매물 tool-tip 요청에서 HTTP 또는 네트워크 오류가 확인됐습니다." }
      : { level: "warning", text: "판매 매물 tool-tip의 완료된 정상 응답은 아직 확인되지 않았습니다." };
  }

  const hook = report.page_hook;
  if (!hook?.installed) {
    return { level: "error", text: "브라우저는 tool-tip 요청을 확인했지만 페이지 구조화 응답 훅은 연결되지 않았습니다." };
  }
  const capture = hook.latest_capture;
  const captureTime = Date.parse(capture?.captured_at || "");
  const sessionStart = Date.parse(report.started_at || "");
  const capturedDuringSession = Number.isFinite(captureTime) && Number.isFinite(sessionStart) &&
    captureTime >= sessionStart;
  const captureMatchesResponse = capturedDuringSession && successfulTooltips.some((event) =>
    event.page === capture?.page && event.limit === capture?.limit && event.sort === capture?.sort
  );
  if (!captureMatchesResponse) {
    return { level: "error", text: "브라우저는 정상 tool-tip 응답을 확인했지만 페이지 훅이 같은 페이지·개수·정렬 응답을 잡지 못했습니다." };
  }
  if (failedTooltips.length > 0) {
    return { level: "warning", text: "정상 tool-tip 응답과 구조화 캡처를 확인했습니다. 일부 이전 요청은 취소되거나 실패했습니다." };
  }
  return { level: "success", text: "브라우저 요청과 같은 진단 구간의 페이지 구조화 응답이 모두 확인됐습니다." };
}

function sanitizeStoredEvent(event) {
  if (!event || typeof event !== "object") return null;
  const endpoint = ["sold_tooltip", "auction_api", "static_asset", "page", "other"].includes(event.endpoint)
    ? event.endpoint
    : "other";
  const path = redactPath(String(event.path || "/"), endpoint);
  if (!path.startsWith("/")) return null;
  return {
    sequence: positiveInteger(event.sequence),
    occurred_at: safeIso(event.occurred_at),
    phase: ["completed", "error", "redirect"].includes(event.phase) ? event.phase : "completed",
    method: SAFE_METHOD.test(String(event.method || "")) ? event.method : "OTHER",
    resource_type: SAFE_TYPE.test(String(event.resource_type || "")) ? event.resource_type : "other",
    path,
    endpoint,
    page: positiveInteger(event.page),
    limit: positiveInteger(event.limit),
    sort: safeSort(event.sort),
    status_code: Number.isInteger(event.status_code) && event.status_code >= 100 && event.status_code <= 599
      ? event.status_code
      : null,
    from_cache: event.from_cache === true,
    frame_scope: ["top", "subframe", "unbound"].includes(event.frame_scope)
      ? event.frame_scope
      : "unbound",
    error: typeof event.error === "string" && SAFE_ERROR.test(event.error) ? event.error : null
  };
}

function sanitizePageHookStatus(status) {
  if (!status || typeof status !== "object") return null;
  const latest = status.latest_observed && typeof status.latest_observed === "object"
    ? {
      page: positiveInteger(status.latest_observed.page),
      limit: positiveInteger(status.latest_observed.limit),
      sort: safeSort(status.latest_observed.sort),
      current_search: status.latest_observed.current_search === true,
      recovery_attempted: status.latest_observed.recovery_attempted === true
    }
    : null;
  const capture = status.latest_capture || status.latest;
  const latestCapture = capture && typeof capture === "object"
    ? {
      captured_at: safeIso(capture.captured_at),
      transport: SAFE_TRANSPORT.test(String(capture.transport || "")) ? capture.transport : null,
      page: positiveInteger(capture.page),
      limit: positiveInteger(capture.limit),
      sort: safeSort(capture.sort)
    }
    : null;
  return {
    installed: status.installed === true,
    fetch_hook_active: status.fetch_hook_active === true,
    xhr_hook_active: status.xhr_hook_active === true,
    performance_recovery_available: status.performance_recovery_available === true,
    observed_tooltip_request_count: nonNegativeInteger(status.observed_tooltip_request_count),
    cache_size: nonNegativeInteger(status.cache_size),
    latest_observed: latest,
    latest_capture: latestCapture
  };
}

function endpointFamily(path, origin = AUCTION_ORIGIN) {
  if (SOLD_TOOLTIP_PATTERN.test(path)) return "sold_tooltip";
  if (String(path).startsWith("/v1/")) return "auction_api";
  if (origin === TOOLTIP_API_ORIGIN) return "other";
  if (String(path).startsWith("/_next/")) return "static_asset";
  if (PUBLIC_PAGE_PATHS.has(path)) return "page";
  return "other";
}

function redactPath(value, endpoint = null) {
  const raw = String(value || "/").split(/[?#]/u, 1)[0] || "/";
  const family = endpoint || endpointFamily(raw);
  if (family === "sold_tooltip") {
    return "/v1/market/web/items/searches/sold/:search-key/tool-tip";
  }
  if (family === "auction_api") return "/v1/:endpoint";
  if (family === "static_asset") return "/_next/:asset";
  if (family === "page" && PUBLIC_PAGE_PATHS.has(raw)) return raw;
  return "/other";
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 1_000_000 ? parsed : null;
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function safeSort(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return SAFE_SORT.test(normalized) ? normalized : null;
}

function safeSessionId(value) {
  const normalized = String(value || "");
  return /^network-[0-9]+-[a-z0-9]{4,16}$/u.test(normalized) ? normalized : null;
}

function safeText(value, maxLength) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function safeIso(value) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function countBy(values, keyFor) {
  const counts = {};
  for (const value of values) {
    const key = String(keyFor(value) || "unknown").slice(0, 240);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) =>
    right[1] - left[1] || left[0].localeCompare(right[0])
  ));
}

function isSuccessfulStatus(value) {
  const status = Number(value);
  return (status >= 200 && status < 300) || status === 304;
}
