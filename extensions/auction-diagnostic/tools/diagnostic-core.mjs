export const FILTER_DIAGNOSTIC_SCHEMA_VERSION = "maple-auction.form-diagnostic.v1";

export const FILTER_DIAGNOSTIC_QUERY = Object.freeze({
  keyword: "거대한 공포",
  page_limit: 60,
  starforce_min: null,
  starforce_max: null,
  server_filter: Object.freeze({
    code: "allStatsPercent",
    minimum: 15
  })
});

export const FILTER_DIAGNOSTIC_STAGE_ORDER = Object.freeze([
  "price_tab",
  "panel_discovery",
  "reset",
  "exact_keyword",
  "starforce",
  "potential",
  "final_form_verified",
  "submit",
  "fresh_key",
  "page_size",
  "result_ready"
]);

export const FILTER_DIAGNOSTIC_STAGE_LABELS = Object.freeze({
  price_tab: "시세 탭 확인",
  panel_discovery: "검색 필터 영역 확인",
  reset: "기존 조건 초기화",
  page_size: "결과 60개씩 보기 확인",
  exact_keyword: "장비명 정확 일치 선택",
  starforce: "스타포스 제한 없음 입력",
  potential: "올스탯 15%·합산 입력",
  final_form_verified: "입력값 최종 검증",
  submit: "필터 검색 클릭",
  fresh_key: "새 검색 결과 생성",
  result_ready: "결과 화면 확인"
});

const EVIDENCE_KEYS = new Set([
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
  "observed_starforce_min",
  "observed_starforce_max",
  "observed_potential_code",
  "observed_potential_min",
  "aggregate_checked",
  "form_matches",
  "click_dispatched",
  "click_scheduled",
  "already_open",
  "tab_clicked",
  "page_kind_sold",
  "key_present",
  "key_was_present",
  "key_changed",
  "url_conditions_match",
  "result_heading_visible",
  "result_ready",
  "row_count",
  "exact_item_row_count",
  "empty_result",
  "displayed_page_limit",
  "requested_page_limit",
  "current_page",
  "latest_sale_sort",
  "search_used",
  "search_limit",
  "search_count_changed",
  "result_generation_changed",
  "result_busy"
]);

const ALLOWED_POTENTIAL_CODES = new Set([
  "strPercent",
  "dexPercent",
  "intPercent",
  "lukPercent",
  "allStatsPercent",
  "attackPercent",
  "physicalAttackPercent",
  "magicAttackPercent"
]);

const SENSITIVE_KEY_PATTERN = /(?:price\s*search\s*key|pricesearchkey|previous_url|current_url|viewer_world|auction_group|innerhtml|outerhtml|full_html|cookie|authorization|csrf|token|seller|maker)/iu;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu;
const URL_PATTERN = /https?:\/\/[^\s]+/giu;

export function sanitizeDiagnosticEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const safe = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (!EVIDENCE_KEYS.has(key) || SENSITIVE_KEY_PATTERN.test(key)) continue;
    if (key === "observed_potential_code") {
      safe[key] = ALLOWED_POTENTIAL_CODES.has(candidate) ? candidate : "unknown";
      continue;
    }
    if (candidate == null || typeof candidate === "boolean" || typeof candidate === "number") {
      safe[key] = candidate;
    } else if (typeof candidate === "string") {
      safe[key] = redactDiagnosticText(candidate).slice(0, 48);
    }
  }
  return safe;
}

export function sanitizeDiagnosticStep(step = {}) {
  const name = FILTER_DIAGNOSTIC_STAGE_ORDER.includes(step.name) ? step.name : "unknown";
  return {
    name,
    ok: step.ok === true,
    elapsed_ms: Number.isFinite(step.elapsed_ms)
      ? Math.max(0, Math.min(120_000, Math.round(step.elapsed_ms)))
      : 0,
    evidence: sanitizeDiagnosticEvidence(step.evidence),
    ...(step.error_code ? {
      error_code: String(step.error_code).replace(/[^a-z0-9_]/giu, "_").slice(0, 64)
    } : {})
  };
}

export function mergeDiagnosticSteps(current = [], incoming = []) {
  const byName = new Map();
  for (const step of [...current, ...incoming]) {
    const safe = sanitizeDiagnosticStep(step);
    if (safe.name !== "unknown") byName.set(safe.name, safe);
  }
  return FILTER_DIAGNOSTIC_STAGE_ORDER
    .filter((name) => byName.has(name))
    .map((name) => byName.get(name));
}

export function redactDiagnosticText(value) {
  return String(value || "")
    .replace(URL_PATTERN, "[주소 비공개]")
    .replace(UUID_PATTERN, "[식별자 비공개]")
    .replace(/priceSearchKey(?:\s*(?:=|:)\s*[^\s&]+)?/giu, "검색 키 [비공개]")
    .replace(/(?:cookie|authorization|csrf|token)\s*(?:=|:)\s*[^\s,;]+/giu, "인증정보 [비공개]")
    .slice(0, 300);
}

export function buildDiagnosticExport(report = {}) {
  const usage = (value) => value && Number.isInteger(value.used) && Number.isInteger(value.limit)
    ? { used: value.used, limit: value.limit }
    : null;
  return {
    schema_version: FILTER_DIAGNOSTIC_SCHEMA_VERSION,
    extension_version: String(report.extension_version || "unknown").slice(0, 24),
    target: {
      keyword: FILTER_DIAGNOSTIC_QUERY.keyword,
      page_limit: FILTER_DIAGNOSTIC_QUERY.page_limit,
      starforce_min: null,
      starforce_max: null,
      potential_code: FILTER_DIAGNOSTIC_QUERY.server_filter.code,
      potential_min: FILTER_DIAGNOSTIC_QUERY.server_filter.minimum,
      potential_aggregate: true
    },
    outcome: ["passed", "passed_empty", "failed"].includes(report.outcome)
      ? report.outcome
      : "failed",
    started_at: typeof report.started_at === "string" ? report.started_at : null,
    finished_at: typeof report.finished_at === "string" ? report.finished_at : null,
    search_usage: {
      before: usage(report.search_usage?.before),
      after: usage(report.search_usage?.after)
    },
    steps: mergeDiagnosticSteps([], report.steps),
    failure: report.failure ? {
      stage: FILTER_DIAGNOSTIC_STAGE_ORDER.includes(report.failure.stage)
        ? report.failure.stage
        : "unknown",
      code: String(report.failure.code || "diagnostic_failed").replace(/[^a-z0-9_]/giu, "_").slice(0, 64),
      message: diagnosticFailureMessage(report.failure.code)
    } : null,
    privacy: "검색 키 값·전체 URL·HTML·계정·월드·판매자·매물 식별자는 포함하지 않음"
  };
}

export function diagnosticFailureMessage(code) {
  return ({
    daily_search_limit_reached: "오늘 검색 한도에 도달해 실행하지 않았습니다.",
    lease_conflict: "다른 관리자 창이 수집 중입니다.",
    reset_failed: "검색 조건 초기화 단계에서 실패했습니다.",
    page_size_failed: "60개씩 보기 선택을 확인하지 못했습니다.",
    autocomplete_exact_missing: "장비명 자동완성의 정확 일치 항목을 찾지 못했습니다.",
    exact_tag_missing: "장비명 정확 일치 선택을 확인하지 못했습니다.",
    starforce_failed: "스타포스 입력을 확인하지 못했습니다.",
    potential_failed: "잠재능력 입력을 확인하지 못했습니다.",
    aggregate_failed: "잠재능력 합산 설정을 확인하지 못했습니다.",
    filter_submit_failed: "필터 검색 버튼을 실행하지 못했습니다.",
    fresh_key_failed: "새 필터 검색 결과 생성을 확인하지 못했습니다.",
    result_context_mismatch: "결과 화면이 요청한 검색 조건과 일치하지 않습니다.",
    result_not_settled: "새 결과 화면의 렌더링 완료를 확인하지 못했습니다."
  })[code] || "필터 입력 진단 단계에서 실패했습니다.";
}

export function diagnosticExportContainsSensitiveData(report) {
  const serialized = JSON.stringify(report);
  return SENSITIVE_KEY_PATTERN.test(serialized) ||
    /priceSearchKey=/iu.test(serialized) ||
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu.test(serialized) ||
    /https?:\/\/auction\.maplestory\.nexon\.com\/[^\s"']*\?/iu.test(serialized);
}
