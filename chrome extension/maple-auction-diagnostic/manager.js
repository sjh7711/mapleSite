import {
  CATALOG_BY_ID,
  CATALOG_BY_NAME,
  CATALOG_ITEMS,
  CATALOG_VALIDATION,
  CATALOG_VERSION,
  classifyPotentialProfiles,
  expandCatalogQueries,
  globalCategoryPotentialExclusion as globalPotentialExclusion,
  starforceBandForValue
} from "./tools/catalog.mjs";
import {
  LANE_PLAN,
  NORMAL_QUERY_LIMIT,
  RESERVE_QUERY_LIMIT,
  HARD_QUERY_LIMIT,
  REQUESTED_PAGE_LIMIT,
  FILTER_SEARCH_MIN_INTERVAL_MS,
  addKstDays,
  advanceAttemptPhase,
  applyEmptyBackoff,
  canBorrowReserveForNormal,
  clearEmptyBackoff,
  createCollectorState,
  createPaginationState,
  createStructuredPageSignature,
  evaluateCollectedPage,
  filterSearchDelayRemaining,
  inferNextEligibleReason,
  isPhysicalQueryComplete,
  quotaRemaining,
  rebaseQuotaSession,
  reconcileObservedQuota,
  releaseUnrequestedReservation,
  resetCollectorProgress,
  reserveQueryQuota,
  rolloverCollectorState,
  selectNextCandidate,
  summarizeEquipmentQueryProgress,
  toKstDateKey
} from "./tools/collector-core.mjs";
import {
  isPriceTabUrl,
  isSubmittedFilterSearchUrl,
  queryMatchesSearchContext,
  requiresFilterSubmission
} from "./tools/preset-core.mjs";
import {
  FILTER_DIAGNOSTIC_QUERY,
  FILTER_DIAGNOSTIC_STAGE_LABELS,
  buildDiagnosticExport,
  diagnosticExportContainsSensitiveData,
  diagnosticFailureMessage,
  mergeDiagnosticSteps,
  redactDiagnosticText
} from "./tools/diagnostic-core.mjs";
import {
  DEFAULT_RESULT_STABLE_MS,
  createResultStabilityState,
  observeResultStability
} from "./tools/result-stability.mjs";
import {
  buildNetworkDiagnosticReport,
  diagnoseNetworkDiagnosticReport,
  formatNetworkDiagnosticEvent,
  networkDiagnosticExportContainsSensitiveData
} from "./tools/network-diagnostic-core.mjs";
import "./tooltip-response-core.js";

const AUCTION_URL_PATTERN = /^https:\/\/auction\.maplestory\.nexon\.com(?:\/|$)/i;
const DATABASE_NAME = "maple-auction-jsonl";
const DATABASE_VERSION = 2;
const SETTINGS_STORE = "settings";
const STATE_STORE = "collector_state";
const PAGE_STORE = "page_captures";
const DIRECTORY_HANDLE_KEY = "marketDataDirectory";
const STATE_KEY = "primary";
const CHECKPOINT_MIRROR_KEY = "mapleAuctionCollectorCheckpointV1";
const MANAGER_SESSION_KEY = "mapleAuctionCollectorManagerIdV1";
const ITEM_WAIT_TIMEOUT_MS = 30_000;
const PRICE_TAB_CLICK_TIMEOUT_MS = 4_000;
const LEASE_DURATION_MS = 5 * 60_000;
const LEASE_HEARTBEAT_INTERVAL_MS = 60_000;
const MAX_RETRY_COUNT = 1;
const QUOTA_SWITCH_CONFIRMATION_READS = 3;
const QUOTA_SWITCH_CONFIRMATION_INTERVAL_MS = 350;
const QUOTA_SWITCH_RECENT_REQUEST_GUARD_MS = 5_000;
const TOOLTIP_NETWORK_CAPTURE_WAIT_MS = 12_000;
const TOOLTIP_NETWORK_POLL_MS = 100;
const TOOLTIP_NETWORK_SORT = "TRADE_DATE_DESC";
const NETWORK_DIAGNOSTIC_DURATION_MS = 5 * 60_000;
const NETWORK_DIAGNOSTIC_POLL_MS = 750;

const tooltipResponseCore = globalThis.MapleAuctionTooltipResponseCore;

const sourceQuery = new URLSearchParams(location.search);
const sourceTabId = Number(sourceQuery.get("tabId"));
const sourceWindowId = Number(sourceQuery.get("windowId"));
const extensionVersion = chrome.runtime.getManifest().version;
const managerId = getOrCreateManagerId();

const elements = Object.fromEntries([
  "chooseFolderButton", "startButton", "pauseButton", "flushButton", "exportStateButton",
  "folderName", "permissionBadge", "catalogBadge", "catalogItemCount", "priorityOneCount",
  "priorityTwoCount", "queryCount", "catalogGroups", "catalogProgressSummary",
  "completedEquipmentCount", "incompleteEquipmentCount", "completedEquipmentList",
  "incompleteEquipmentList", "dailyBadge", "quotaCount", "normalQuota",
  "reserveQuota", "quotaBar", "pageLimitValue", "totalPageCount",
  "accountSyncButton", "resetCollectionProgressButton",
  "targetBadge", "currentJob", "currentJobDetail", "progressTitle", "progressCount",
  "progressBar", "status", "log", "diagnosticButton", "diagnosticBadge", "diagnosticDetails",
  "diagnosticLog", "copyDiagnosticButton", "networkDiagnosticButton", "networkDiagnosticBadge",
  "networkDiagnosticDetails", "networkDiagnosticSummary", "networkDiagnosticLog",
  "copyNetworkDiagnosticButton", "includeFailedTasksOption", "includeFailedTasksCheckbox",
  "deferredFailureCount"
].map((id) => [id, document.getElementById(id)]));

const physicalQueries = expandCatalogQueries();
const fixedTasks = buildFixedTasks(physicalQueries);
let directoryHandle = null;
let collectorState = null;
let collectionRunning = false;
let startPending = false;
let pauseRequested = false;
let managerWindowId = null;
let databasePromise = null;
let extensionContextInvalidated = false;
let leaseHeld = false;
let activeLeaseId = null;
let leaseHeartbeatTimer = null;
let leaseHeartbeatRunning = false;
let foreignLeaseActiveInView = false;
let diagnosticRunning = false;
let quotaSyncRunning = false;
let diagnosticReport = null;
let diagnosticStatusPinned = false;
let transientSiteSearchUsage = null;
let activeDiagnosticId = null;
let diagnosticUsageUnconfirmed = false;
let foreignLeaseRefreshTimer = null;
let lastCatalogProgressSignature = null;
let networkDiagnosticRunning = false;
let networkDiagnosticSessionId = null;
let networkDiagnosticReport = null;
let networkDiagnosticPollTimer = null;
let networkDiagnosticTransition = null;
let networkDiagnosticError = null;
let progressResetRunning = false;
let forcedFailureQueryIdsForRun = new Set();

elements.chooseFolderButton.addEventListener("click", chooseOutputDirectory);
elements.startButton.addEventListener("click", startOrResumeCollection);
elements.pauseButton.addEventListener("click", requestPause);
elements.flushButton.addEventListener("click", flushPendingFromButton);
elements.exportStateButton.addEventListener("click", exportCollectorState);
elements.diagnosticButton.addEventListener("click", runFilterDiagnosticOnce);
elements.copyDiagnosticButton.addEventListener("click", copyDiagnosticResult);
elements.accountSyncButton.addEventListener("click", synchronizeNewAccountQuota);
elements.resetCollectionProgressButton.addEventListener("click", resetCollectionProgressFromButton);
elements.networkDiagnosticButton.addEventListener("click", toggleNetworkDiagnostic);
elements.copyNetworkDiagnosticButton.addEventListener("click", copyNetworkDiagnosticResult);
elements.includeFailedTasksCheckbox.addEventListener("change", updateFailedTasksOptionAppearance);
window.addEventListener("beforeunload", handleBeforeUnload);
window.addEventListener("unhandledrejection", handleUnhandledRejection);

void initialize().catch(handleUnexpectedAsyncError);

async function initialize() {
  renderCatalog();
  let initializationLeaseAcquired = false;
  try {
    managerWindowId = (await chrome.windows.getCurrent()).id;
    [directoryHandle, collectorState] = await Promise.all([
      loadDirectoryHandle(),
      loadCollectorState()
    ]);
    collectorState = ensureApplicationState(
      rolloverCollectorState(collectorState || createCollectorState())
    );
    foreignLeaseActiveInView = false;
    try {
      await acquireLease();
      initializationLeaseAcquired = true;
    } catch (error) {
      if (!isLeaseConflictError(error)) throw error;
      collectorState = ensureApplicationState(
        rolloverCollectorState(await loadCollectorState() || collectorState)
      );
      foreignLeaseActiveInView = hasActiveForeignLease(collectorState);
      if (!foreignLeaseActiveInView) throw error;
    }
    if (initializationLeaseAcquired) {
      collectorState = await recoverInterruptedJob(collectorState);
      collectorState = discardObsoleteCollectorWork(collectorState);
      await saveCollectorState(collectorState);
    }
    await refreshDirectoryUi();
    await verifyAuctionTab();
    await restoreNetworkDiagnosticSession();
    if (initializationLeaseAcquired) await refreshSiteSearchUsage();
    if (foreignLeaseActiveInView) {
      elements.targetBadge.textContent = "다른 창 실행 중";
      elements.targetBadge.className = "badge";
      showStatus("다른 수집 관리자 창이 실행 중입니다. 해당 창을 닫거나 일시정지한 뒤 시작하세요.");
      setRunControls(false);
      scheduleForeignLeaseRefresh();
    } else {
      elements.targetBadge.textContent = "연결됨";
      elements.targetBadge.className = "badge ready";
      setRunControls(false);
      showStatus(directoryHandle
        ? "미완료 작업을 수집할 준비가 되었습니다."
        : "먼저 저장 폴더를 선택하세요.");
    }
  } catch (error) {
    if (!markExtensionContextInvalidated(error)) {
      elements.targetBadge.textContent = "연결 실패";
      elements.targetBadge.className = "badge error";
      showStatus(error.message, "error");
    }
  } finally {
    if (initializationLeaseAcquired && leaseHeld) {
      await releaseOwnedLeaseAndSave(collectorState).catch((error) => {
        if (!isExtensionContextInvalidatedError(error)) console.error(error);
      });
    }
  }
  renderState();
}

function renderCatalog() {
  elements.catalogBadge.textContent = `v${CATALOG_VERSION}`;
  elements.catalogItemCount.textContent = `${CATALOG_VALIDATION.total}종`;
  elements.priorityOneCount.textContent = `${CATALOG_VALIDATION.priority.P1}종`;
  elements.priorityTwoCount.textContent = `${CATALOG_VALIDATION.priority.P2}종`;
  elements.queryCount.textContent = `${physicalQueries.length}개`;
  const groupLabels = new Map(CATALOG_ITEMS.map((item) => [item.group, item.group_label]));
  elements.catalogGroups.replaceChildren(...Object.entries(CATALOG_VALIDATION.group).map(([group, count]) => {
    const chip = document.createElement("span");
    chip.textContent = `${groupLabels.get(group) || group} ${count}`;
    return chip;
  }));
}

function ensureApplicationState(state) {
  const legacyRetries = Array.isArray(state.continuations)
    ? state.continuations.filter((entry) =>
      entry?.retry === true && Number.isInteger(entry.page) && entry.page >= 1
    )
    : [];
  const retries = (Array.isArray(state.retries) ? state.retries : legacyRetries)
    .filter((entry) => entry?.retry === true)
    .map((entry) => ({
      ...entry,
      retry_count: Math.max(1, Number(entry.retry_count || 0))
    }));
  const { continuations: _discardedContinuations, ...current } = state;
  return {
    ...current,
    catalog_version: CATALOG_VERSION,
    run_status: state.run_status || "idle",
    active_job: state.active_job || null,
    retries,
    query_stats: state.query_stats || {},
    watermarks: state.watermarks || {},
    filter_audits: state.filter_audits || {},
    totals: {
      pages: Number(state.totals?.pages || 0),
      observations: Number(state.totals?.observations || 0),
      failures: Number(state.totals?.failures || 0)
    },
    site_search_usage: state.site_search_usage || null,
    last_filter_search_dispatch_at: filterSearchTimestamp(state.last_filter_search_dispatch_at),
    filter_search_dispatch_pending_at: filterSearchTimestamp(state.filter_search_dispatch_pending_at),
    last_error: state.last_error || null,
    lease: state.lease || null
  };
}

function filterSearchTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function taskUsesLegacyAllStatCode(task) {
  return task?.query?.potential_filter?.auction_code === "allStatPercent" ||
    String(task?.id || "").includes("pot-allStatPercent:");
}

function taskUsesLegacyAttackCode(task) {
  return task?.query?.potential_filter?.auction_code === "attackPercent" ||
    String(task?.id || "").includes("pot-attackPercent:");
}

function discardLegacyAllStatWork(state) {
  const legacyToken = "allStatPercent";
  const retries = state.retries.filter((entry) => !taskUsesLegacyAllStatCode(entry.task));
  const activeJobWasLegacy = taskUsesLegacyAllStatCode(state.active_job?.job?.task);
  const filterCurrentKeys = (record) => Object.fromEntries(
    Object.entries(record || {}).filter(([key]) => !key.includes(`pot-${legacyToken}:`))
  );
  const queryStats = filterCurrentKeys(state.query_stats);
  const watermarks = filterCurrentKeys(state.watermarks);
  const hadLegacyState =
    retries.length !== state.retries.length ||
    activeJobWasLegacy ||
    Object.keys(queryStats).length !== Object.keys(state.query_stats).length ||
    Object.keys(watermarks).length !== Object.keys(state.watermarks).length ||
    state.filter_audits?.ALL_STAT_PCT?.auction_code === legacyToken;
  if (!hadLegacyState) return state;

  const filterAudits = { ...state.filter_audits };
  delete filterAudits.ALL_STAT_PCT;
  return {
    ...state,
    active_job: activeJobWasLegacy ? null : state.active_job,
    retries,
    query_stats: queryStats,
    watermarks,
    filter_audits: filterAudits,
    run_status: state.run_status === "running" ? "paused" : state.run_status,
    last_error: null
  };
}

function discardObsoleteCollectorWork(state) {
  const migrated = discardLegacyAllStatWork(state);
  const legacyAttackToken = "attackPercent";
  const currentTasksByStableId = new Map(
    fixedTasks.map((task) => [stableTaskId(task.id), task])
  );
  const retries = migrated.retries.map((entry) => {
    if (
      entry?.retry !== true || !Number.isInteger(entry.page) || entry.page < 1 ||
      taskUsesLegacyAttackCode(entry.task)
    ) return null;
    const currentTask = currentTasksByStableId.get(stableTaskId(entry.task?.id));
    if (!currentTask) return null;
    if (currentTask.id !== entry.task?.id) {
      const retryCount = Math.max(1, Number(entry.retry_count || 0));
      const sweepId = crypto.randomUUID();
      return {
        ...entry,
        id: `retry:${sweepId}:1:${retryCount}`,
        task: currentTask,
        underlying_task_id: currentTask.id,
        page: 1,
        pagination: createPaginationState({ current_page: 1 }),
        sweep_id: sweepId,
        resume_restart_reason: "catalog_query_updated",
        retry_count: retryCount
      };
    }
    return {
      ...entry,
      task: currentTask,
      underlying_task_id: currentTask.id
    };
  }).filter(Boolean);
  const retriesChanged = retries.length !== migrated.retries.length || retries.some((entry, index) =>
    entry.task?.id !== migrated.retries[index]?.task?.id
  );
  const activeJobIsObsolete = taskUsesLegacyAttackCode(migrated.active_job?.job?.task);
  const filterCurrentKeys = (record) => Object.fromEntries(
    Object.entries(record || {}).filter(([key]) => !key.includes(`pot-${legacyAttackToken}:`))
  );
  const compatibleStats = migrateCompatibleQueryStats(
    filterCurrentKeys(migrated.query_stats),
    currentTasksByStableId
  );
  const queryStats = compatibleStats.record;
  const watermarks = {};
  const currentCapabilityIds = new Set(
    physicalQueries.map((query) => query.potential_filter?.capability_id).filter(Boolean)
  );
  const filterAudits = Object.fromEntries(
    Object.entries(migrated.filter_audits || {}).filter(([capabilityId]) =>
      currentCapabilityIds.has(capabilityId)
    )
  );
  const legacyAudit = filterAudits.ATTACK_PCT?.auction_code === legacyAttackToken;
  if (legacyAudit) delete filterAudits.ATTACK_PCT;
  const auditsChanged = Object.keys(filterAudits).length !== Object.keys(migrated.filter_audits || {}).length;
  const changed =
    retriesChanged ||
    activeJobIsObsolete ||
    Object.keys(queryStats).length !== Object.keys(migrated.query_stats).length ||
    compatibleStats.changed ||
    Object.keys(migrated.watermarks).length > 0 ||
    legacyAudit ||
    auditsChanged;
  if (!changed) return migrated;
  return {
    ...migrated,
    active_job: activeJobIsObsolete ? null : migrated.active_job,
    retries,
    query_stats: queryStats,
    watermarks,
    filter_audits: filterAudits,
    run_status: migrated.run_status === "running" ? "paused" : migrated.run_status,
    last_error: null
  };
}

function stableTaskId(taskId) {
  return String(taskId || "").replace(/^\d{4}-\d{2}-\d{2}(?:\.\d+)?:/u, "");
}

function migrateCompatibleQueryStats(record, currentTasksByStableId) {
  const migrated = {};
  let changed = false;
  for (const [taskId, stats] of Object.entries(record || {})) {
    const currentTask = currentTasksByStableId.get(stableTaskId(taskId));
    if (!currentTask) {
      changed = true;
      continue;
    }
    const targetId = currentTask.id;
    changed ||= targetId !== taskId;
    const existing = migrated[targetId] || {};
    const observations = Math.max(
      Number(existing.observations || 0),
      Number(stats?.observations || 0)
    );
    migrated[targetId] = {
      ...stats,
      ...existing,
      pages: Math.max(Number(existing.pages || 0), Number(stats?.pages || 0)),
      observations,
      failures: Math.max(Number(existing.failures || 0), Number(stats?.failures || 0)),
      first_page_captured: existing.first_page_captured === true ||
        stats?.first_page_captured === true || observations > 0,
      last_success_at: [existing.last_success_at, stats?.last_success_at]
        .filter(Boolean)
        .sort()
        .at(-1) || null
    };
  }
  return { record: migrated, changed };
}

async function recoverInterruptedJob(state) {
  const active = state.active_job;
  if (!active?.attempt_id) {
    return { ...state, run_status: state.run_status === "running" ? "paused" : state.run_status };
  }
  const attempt = state.attempts?.[active.attempt_id];
  let next = state;
  const obsoleteReason = taskUsesLegacyAllStatCode(active.job?.task)
    ? "legacy_all_stat_filter"
    : taskUsesLegacyAttackCode(active.job?.task)
      ? "legacy_attack_filter"
      : null;
  if (obsoleteReason) {
    if (attempt?.phase === "reserved") {
      next = releaseUnrequestedReservation(next, active.attempt_id);
    } else if (attempt?.phase === "requested") {
      next = advanceAttemptPhase(next, active.attempt_id, "received", Date.now(), {
        interrupted: true,
        discarded: obsoleteReason
      });
      next = advanceAttemptPhase(next, active.attempt_id, "committed", Date.now(), {
        interrupted: true,
        discarded: obsoleteReason
      });
    } else if (attempt?.phase === "received") {
      next = advanceAttemptPhase(next, active.attempt_id, "committed", Date.now(), {
        interrupted: true,
        discarded: obsoleteReason
      });
    }
    await markCaptureDiscardedByAttempt(active.attempt_id, obsoleteReason);
    return compactAttempts({
      ...next,
      active_job: null,
      run_status: "paused",
      last_error: null
    });
  }
  if (attempt?.phase === "reserved") {
    next = releaseUnrequestedReservation(next, active.attempt_id);
  } else if (attempt?.phase === "requested") {
    next = advanceAttemptPhase(next, active.attempt_id, "received", Date.now(), { interrupted: true });
    next = advanceAttemptPhase(next, active.attempt_id, "committed", Date.now(), { interrupted: true });
  } else if (attempt?.phase === "received") {
    const receivedRecord = await getCaptureRecordByAttempt(active.attempt_id);
    if (receivedRecord?.pagination_result && active.job) {
      const pendingRecord = { ...receivedRecord, file_status: "pending" };
      next = applyCommittedResult(next, active.job, active.attempt_id, pendingRecord, receivedRecord.pagination_result);
      await commitPageAndState(pendingRecord, next);
      await flushCaptureRecord(pendingRecord.page_capture_id).catch(() => {});
      return { ...next, active_job: null, run_status: "paused", last_error: null };
    }
    next = advanceAttemptPhase(next, active.attempt_id, "committed", Date.now(), { interrupted: true });
  }
  if (attempt && attempt.phase !== "reserved" && active.job) {
    if (active.job.retry_id) {
      next = deferRetryCheckpointUntilNextDay(next, active.job, "manager_interrupted_again");
    } else {
      next = enqueueRetry(next, active.job, "manager_interrupted");
    }
  }
  return {
    ...next,
    active_job: null,
    run_status: "paused",
    last_error: attempt?.phase === "reserved" ? null : "이전 실행이 중단되어 해당 페이지를 다시 확인합니다."
  };
}

async function chooseOutputDirectory() {
  if (collectionRunning || diagnosticRunning || quotaSyncRunning || progressResetRunning || typeof window.showDirectoryPicker !== "function") {
    if (typeof window.showDirectoryPicker !== "function") {
      showStatus("이 Chrome에서는 폴더 선택 기능을 사용할 수 없습니다.", "error");
    }
    return;
  }
  try {
    directoryHandle = await window.showDirectoryPicker({
      id: "maple-auction-market-data",
      mode: "readwrite"
    });
    await saveDirectoryHandle(directoryHandle);
    await refreshDirectoryUi();
    await flushPendingCaptures();
    showStatus("저장 폴더를 설정했습니다.", "success");
  } catch (error) {
    if (!markExtensionContextInvalidated(error) && error.name !== "AbortError") {
      showStatus(`폴더를 선택하지 못했습니다: ${error.message}`, "error");
    }
  }
}

async function runFilterDiagnosticOnce() {
  if (
    diagnosticRunning || quotaSyncRunning || collectionRunning || startPending || progressResetRunning || extensionContextInvalidated ||
    diagnosticBlockedByUsage()
  ) {
    return;
  }

  diagnosticRunning = true;
  diagnosticStatusPinned = true;
  diagnosticReport = {
    extension_version: extensionVersion,
    outcome: "failed",
    started_at: new Date().toISOString(),
    finished_at: null,
    search_usage: { before: null, after: null },
    steps: [],
    failure: null
  };
  elements.diagnosticDetails.open = true;
  elements.diagnosticBadge.textContent = "진단 중";
  elements.diagnosticBadge.className = "badge";
  elements.copyDiagnosticButton.disabled = true;
  renderDiagnosticReport();
  setDiagnosticControls(true);
  let activeStage = "price_tab";
  let diagnosticSearchScheduled = false;
  let diagnosticLeaseAcquired = false;
  let beforeUsage = null;
  let afterUsage = null;

  try {
    let tab = await verifyAuctionTab();
    try {
      await acquireLease();
      diagnosticLeaseAcquired = true;
    } catch (error) {
      if (/다른 수집 관리자/u.test(String(error.message || ""))) {
        foreignLeaseActiveInView = true;
        error.diagnosticCode = "lease_conflict";
      }
      throw error;
    }
    const priceTabStartedAt = performance.now();
    const alreadyOpen = isPriceTabUrl(tab.url || "");
    await ensureAuctionPriceTab(tab.url, { log: false });
    addDiagnosticStep({
      name: "price_tab",
      ok: true,
      elapsed_ms: performance.now() - priceTabStartedAt,
      evidence: { already_open: alreadyOpen, tab_clicked: !alreadyOpen }
    });
    renderDiagnosticReport();

    beforeUsage = await readSiteSearchUsageFromAuction();
    diagnosticReport.search_usage.before = beforeUsage;
    transientSiteSearchUsage = { ...beforeUsage, day_key: collectorState.day_key };
    renderState();
    if (beforeUsage.used >= beforeUsage.limit) {
      const error = new Error(`경매장 검색 횟수가 ${beforeUsage.used} / ${beforeUsage.limit}이므로 진단 검색을 실행하지 않습니다.`);
      error.diagnosticCode = "daily_search_limit_reached";
      throw error;
    }

    tab = await verifyAuctionTab();
    const previousKey = new URL(tab.url).searchParams.get("priceSearchKey") || null;
    const diagnosticId = crypto.randomUUID();
    activeDiagnosticId = diagnosticId;

    activeStage = "panel_discovery";
    const prepared = await sendToAuction({
      type: "MAPLE_AUCTION_DIAGNOSTIC_PREPARE_ONCE",
      diagnosticId,
      expectedQuery: FILTER_DIAGNOSTIC_QUERY
    });
    mergeContentDiagnosticReport(prepared?.report);
    renderDiagnosticReport();
    if (!prepared?.ok) {
      const error = new Error(redactDiagnosticText(prepared?.error || "필터 입력 진단을 준비하지 못했습니다."));
      error.diagnosticCode = lastDiagnosticErrorCode() || "diagnostic_prepare_failed";
      throw error;
    }

    activeStage = "submit";
    const submitted = await dispatchFilterSearchWithInterval({
      label: "필터 입력 진단",
      dispatch: () => sendToAuction({
        type: "MAPLE_AUCTION_DIAGNOSTIC_SUBMIT_ONCE",
        diagnosticId,
        expectedQuery: FILTER_DIAGNOSTIC_QUERY
      })
    });
    mergeContentDiagnosticReport(submitted?.report);
    renderDiagnosticReport();
    if (!submitted?.ok || (!submitted.click_scheduled && !submitted.already_scheduled)) {
      const error = new Error(redactDiagnosticText(submitted?.error || "필터 검색 클릭을 실행하지 못했습니다."));
      error.diagnosticCode = lastDiagnosticErrorCode() || "diagnostic_submit_failed";
      throw error;
    }
    diagnosticSearchScheduled = true;

    activeStage = "fresh_key";
    const resultStartedAt = performance.now();
    const appliedUrl = await waitForFreshAppliedFilterSearch(FILTER_DIAGNOSTIC_QUERY, {
      previous_price_search_key: previousKey
    });
    const diagnosticPriceSearchKey = appliedUrl.searchParams.get("priceSearchKey");
    addDiagnosticStep({
      name: "fresh_key",
      ok: true,
      elapsed_ms: performance.now() - resultStartedAt,
      evidence: {
        key_was_present: Boolean(previousKey),
        key_changed: true,
        url_conditions_match: isSubmittedFilterSearchUrl(appliedUrl, FILTER_DIAGNOSTIC_QUERY)
      }
    });
    renderDiagnosticReport();

    activeStage = "page_size";
    const pageSizeStartedAt = performance.now();
    const pageSize = await requestResultPageSize(
      diagnosticId,
      diagnosticPriceSearchKey,
      FILTER_DIAGNOSTIC_QUERY.page_limit
    );
    addDiagnosticStep({
      name: "page_size",
      ok: true,
      elapsed_ms: performance.now() - pageSizeStartedAt,
      evidence: {
        page_size_control_found: pageSize.page_size_control_found === true,
        observed_page_limit: pageSize.observed_page_limit ?? null,
        page_size_changed: pageSize.page_size_changed === true
      }
    });
    renderDiagnosticReport();
    await waitForAppliedFilterSearch(FILTER_DIAGNOSTIC_QUERY, {
      previous_price_search_key: previousKey
    }, {
      page: 1,
      limit: FILTER_DIAGNOSTIC_QUERY.page_limit,
      expectedPriceSearchKey: diagnosticPriceSearchKey
    });

    activeStage = "result_ready";
    const resultReadStartedAt = performance.now();
    const result = await waitForFilterDiagnosticResult(FILTER_DIAGNOSTIC_QUERY, diagnosticId);
    const displayedPageSizeValid = result.displayed_page_limit === FILTER_DIAGNOSTIC_QUERY.page_limit ||
      (result.empty_result === true && result.displayed_page_limit == null);
    const pageSizeValid = result.requested_page_limit === FILTER_DIAGNOSTIC_QUERY.page_limit &&
      displayedPageSizeValid;
    const resultValid = result.key_present === true &&
      result.url_conditions_match === true &&
      result.result_heading_visible === true &&
      result.result_ready === true &&
      result.result_generation_changed === true &&
      result.result_busy === false &&
      result.current_page === 1 &&
      pageSizeValid &&
      result.latest_sale_sort === true &&
      (result.row_count === 0 || result.exact_item_row_count === result.row_count);
    const resultErrorCode = result.result_generation_changed !== true || result.result_busy === true
      ? "result_not_settled"
      : "result_context_mismatch";
    addDiagnosticStep({
      name: "result_ready",
      ok: resultValid,
      elapsed_ms: performance.now() - resultReadStartedAt,
      evidence: result,
      ...(!resultValid ? { error_code: resultErrorCode } : {})
    });
    renderDiagnosticReport();
    if (!resultValid) {
      const error = new Error("필터 검색은 이동했지만 결과 화면의 조건 또는 장비명이 진단 조건과 일치하지 않습니다.");
      error.diagnosticCode = resultErrorCode;
      throw error;
    }

    const usageUpdate = await waitForUpdatedSiteSearchUsage(beforeUsage);
    afterUsage = usageUpdate.usage;
    diagnosticUsageUnconfirmed = !usageUpdate.confirmed;
    diagnosticReport.search_usage.after = afterUsage;
    transientSiteSearchUsage = { ...afterUsage, day_key: collectorState.day_key };
    const resultStep = diagnosticReport.steps.find((step) => step.name === "result_ready");
    if (resultStep) {
      addDiagnosticStep({
        ...resultStep,
        evidence: {
          ...resultStep.evidence,
          search_used: afterUsage.used,
          search_limit: afterUsage.limit,
          search_count_changed: afterUsage.used > beforeUsage.used
        }
      });
    }
    diagnosticReport.outcome = result.empty_result ? "passed_empty" : "passed";
    diagnosticReport.failure = null;
    elements.diagnosticBadge.textContent = diagnosticUsageUnconfirmed
      ? "통과 · 횟수 확인 필요"
      : result.empty_result ? "검색 성공 · 0건" : "진단 통과";
    elements.diagnosticBadge.className = diagnosticUsageUnconfirmed || result.empty_result
      ? "badge"
      : "badge ready";
    showStatus(
      diagnosticUsageUnconfirmed
        ? "필터 흐름은 통과했지만 상단 검색 횟수 증가는 아직 확인되지 않았습니다. 관리자 창을 다시 열어 횟수를 확인해 주세요."
        : result.empty_result
        ? "필터 입력과 검색 제출은 정상입니다. 이 조건의 판매 완료 결과는 0건입니다."
        : `필터 입력부터 결과 확인까지 통과했습니다. 정확한 장비 ${result.exact_item_row_count}건을 확인했습니다.`,
      "success"
    );
  } catch (error) {
    if (markExtensionContextInvalidated(error)) return;
    const failedStep = [...diagnosticReport.steps].reverse().find((step) => step.ok === false);
    if (!failedStep) {
      addDiagnosticStep({
        name: activeStage,
        ok: false,
        elapsed_ms: 0,
        evidence: error.diagnosticResult || {},
        error_code: error.diagnosticCode || `${activeStage}_failed`
      });
    }
    diagnosticReport.outcome = "failed";
    diagnosticReport.failure = {
      stage: failedStep?.name || activeStage,
      code: error.diagnosticCode || failedStep?.error_code || "diagnostic_failed",
      message: diagnosticFailureMessage(error.diagnosticCode || failedStep?.error_code)
    };
    const limitReached = error.diagnosticCode === "daily_search_limit_reached";
    elements.diagnosticBadge.textContent = limitReached ? "검색 한도 도달" : "진단 실패";
    elements.diagnosticBadge.className = limitReached ? "badge" : "badge error";
    showStatus(
      limitReached ? redactDiagnosticText(error.message) : `필터 입력 진단 실패: ${redactDiagnosticText(error.message)}`,
      limitReached ? "success" : "error"
    );
  } finally {
    if (!extensionContextInvalidated && diagnosticSearchScheduled && beforeUsage && !afterUsage) {
      try {
        const usageUpdate = await waitForUpdatedSiteSearchUsage(beforeUsage);
        afterUsage = usageUpdate.usage;
        diagnosticUsageUnconfirmed = !usageUpdate.confirmed;
        diagnosticReport.search_usage.after = afterUsage;
        transientSiteSearchUsage = { ...afterUsage, day_key: collectorState.day_key };
      } catch (error) {
        if (isExtensionContextInvalidatedError(error)) markExtensionContextInvalidated(error);
        diagnosticUsageUnconfirmed = true;
      }
    }
    if (!extensionContextInvalidated && diagnosticLeaseAcquired) {
      await abortAuctionDiagnostic(activeDiagnosticId);
      await cleanupAuctionPage();
    }
    if (diagnosticLeaseAcquired && leaseHeld) {
      const usageToPersist = afterUsage && !diagnosticUsageUnconfirmed
        ? afterUsage
        : !diagnosticSearchScheduled ? beforeUsage : null;
      if (usageToPersist) {
        collectorState = synchronizeSiteUsage(collectorState, usageToPersist);
      }
      // IndexedDB remains available long enough to clear the lease even when
      // Chrome has just invalidated the extension messaging context.
      await releaseOwnedLeaseAndSave(collectorState).catch((error) => {
        if (!isExtensionContextInvalidatedError(error)) console.error(error);
      });
    }
    diagnosticReport.finished_at = new Date().toISOString();
    diagnosticRunning = false;
    elements.copyDiagnosticButton.disabled = extensionContextInvalidated || diagnosticReport.steps.length === 0;
    renderDiagnosticReport();
    if (!extensionContextInvalidated) {
      activeDiagnosticId = null;
      await focusManagerWindow();
      setRunControls(false);
      renderState();
    }
  }
}

function addDiagnosticStep(step) {
  diagnosticReport.steps = mergeDiagnosticSteps(diagnosticReport.steps, [step]);
}

function mergeContentDiagnosticReport(report) {
  if (!report?.steps) return;
  diagnosticReport.steps = mergeDiagnosticSteps(diagnosticReport.steps, report.steps);
}

function lastDiagnosticErrorCode() {
  return [...(diagnosticReport?.steps || [])].reverse().find((step) => step.ok === false)?.error_code || null;
}

async function waitForFilterDiagnosticResult(expectedQuery, diagnosticId) {
  const deadline = Date.now() + ITEM_WAIT_TIMEOUT_MS;
  let lastResult = null;
  let lastError = null;
  let stableSignature = null;
  let stableSince = 0;
  while (Date.now() < deadline) {
    try {
      const response = await sendToAuction({
        type: "MAPLE_AUCTION_DIAGNOSTIC_READ_RESULT",
        expectedQuery,
        diagnosticId
      });
      if (!response?.ok) throw new Error(response?.error || "진단 결과 화면을 읽지 못했습니다.");
      lastResult = response.result;
      if (diagnosticResultCanSettle(lastResult)) {
        const signature = JSON.stringify({
          rows: lastResult.row_count,
          exact_rows: lastResult.exact_item_row_count,
          empty: lastResult.empty_result,
          page: lastResult.current_page,
          requested_limit: lastResult.requested_page_limit,
          displayed_limit: lastResult.displayed_page_limit,
          usage: lastResult.search_used
        });
        if (signature !== stableSignature) {
          stableSignature = signature;
          stableSince = Date.now();
        } else if (Date.now() - stableSince >= 400) {
          return lastResult;
        }
      } else {
        stableSignature = null;
        stableSince = 0;
      }
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) throw error;
      lastError = error;
    }
    await delay(250);
  }
  const error = new Error(lastResult
    ? "새 결과 화면이 안정적으로 유지되는지 확인하지 못했습니다."
    : lastError?.message || "진단 결과 화면이 준비되지 않았습니다.");
  error.diagnosticCode = lastResult ? "result_not_settled" : "result_ready_failed";
  if (lastResult) error.diagnosticResult = lastResult;
  throw error;
}

function diagnosticResultCanSettle(result) {
  const displayedPageSizeValid = result?.displayed_page_limit === FILTER_DIAGNOSTIC_QUERY.page_limit ||
    (result?.empty_result === true && result?.displayed_page_limit == null);
  return Boolean(
    result?.key_present === true &&
    result?.url_conditions_match === true &&
    result?.result_heading_visible === true &&
    result?.result_ready === true &&
    result?.result_generation_changed === true &&
    result?.result_busy === false &&
    result?.current_page === 1 &&
    result?.requested_page_limit === FILTER_DIAGNOSTIC_QUERY.page_limit &&
    displayedPageSizeValid &&
    result?.latest_sale_sort === true &&
    (result?.row_count === 0 || result?.exact_item_row_count === result?.row_count)
  );
}

async function waitForUpdatedSiteSearchUsage(beforeUsage) {
  const deadline = Date.now() + 4_000;
  let latest = beforeUsage;
  while (Date.now() < deadline) {
    try {
      latest = await readSiteSearchUsageFromAuction();
      if (latest.used >= Math.min(latest.limit, beforeUsage.used + 1)) {
        return { usage: latest, confirmed: true };
      }
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) throw error;
    }
    await delay(250);
  }
  return { usage: latest, confirmed: false };
}

function setDiagnosticControls(running) {
  elements.chooseFolderButton.disabled = running;
  elements.startButton.disabled = running;
  elements.pauseButton.disabled = true;
  elements.flushButton.disabled = running;
  elements.exportStateButton.disabled = running;
  elements.diagnosticButton.disabled = running;
  elements.accountSyncButton.disabled = running;
  elements.resetCollectionProgressButton.disabled = running;
}

function setQuotaSyncControls(running) {
  elements.chooseFolderButton.disabled = running;
  elements.startButton.disabled = running;
  elements.pauseButton.disabled = true;
  elements.flushButton.disabled = running;
  elements.exportStateButton.disabled = running;
  elements.diagnosticButton.disabled = running;
  elements.accountSyncButton.disabled = running;
  elements.resetCollectionProgressButton.disabled = running;
}

function renderDiagnosticReport() {
  const steps = diagnosticReport?.steps || [];
  elements.diagnosticLog.replaceChildren(...steps.map((step) => {
    const item = document.createElement("li");
    const label = FILTER_DIAGNOSTIC_STAGE_LABELS[step.name] || step.name;
    const timing = step.elapsed_ms > 0 ? ` · ${step.elapsed_ms.toLocaleString("ko-KR")}ms` : "";
    const failure = step.ok ? "" : ` · ${diagnosticFailureMessage(step.error_code)}`;
    item.textContent = `${step.ok ? "통과" : "실패"} · ${label}${timing}${describeDiagnosticEvidence(step)}${failure}`;
    item.className = step.ok
      ? step.name === "result_ready" && (
        step.evidence?.empty_result || step.evidence?.search_count_changed === false
      ) ? "warning" : "success"
      : "error";
    return item;
  }));
}

function describeDiagnosticEvidence(step) {
  const evidence = step.evidence || {};
  if (step.name === "price_tab") return evidence.already_open ? " · 이미 열림" : " · 탭 클릭 완료";
  if (step.name === "page_size") {
    return ` · ${evidence.observed_page_limit ?? "?"}개${evidence.page_size_changed ? "로 변경" : " 확인"}`;
  }
  if (step.name === "exact_keyword") {
    return ` · 자동완성 ${evidence.exact_candidate_found ? "확인" : "미확인"} · 정확 일치 ${evidence.exact_tag_matches ? "확인" : "미확인"}`;
  }
  if (step.name === "starforce") {
    return ` · ${evidence.observed_starforce_min ?? "빈칸"}~${evidence.observed_starforce_max ?? "빈칸"}`;
  }
  if (step.name === "potential") {
    return ` · ${evidence.observed_potential_code || "미선택"} ${evidence.observed_potential_min ?? "빈칸"}% · 합산 ${evidence.aggregate_checked ? "ON" : "OFF"}`;
  }
  if (step.name === "submit") return evidence.click_scheduled ? " · 실제 클릭 예약 완료" : "";
  if (step.name === "fresh_key") return " · 검색 키 값은 기록하지 않음";
  if (step.name === "result_ready") {
    const rowsKnown = Number.isInteger(evidence.row_count);
    const rows = rowsKnown ? evidence.row_count : null;
    const usage = Number.isInteger(evidence.search_used) && Number.isInteger(evidence.search_limit)
      ? ` · 검색 횟수 ${evidence.search_used}/${evidence.search_limit}`
      : "";
    const usageWarning = evidence.search_count_changed === false ? " · 횟수 증가는 아직 화면에서 확인되지 않음" : "";
    const result = evidence.empty_result === true
      ? " · 결과 0건"
      : rowsKnown
      ? ` · 전체 ${rows}건 · 정확 장비 ${Number(evidence.exact_item_row_count || 0)}건`
      : " · 결과 수 미확인";
    const displayedLimit = evidence.displayed_page_limit == null
      ? "표시 수 미확인"
      : `화면 ${evidence.displayed_page_limit}개`;
    const view = ` · ${evidence.current_page ?? "?"}페이지 · 요청 ${evidence.requested_page_limit ?? "?"}개 · ${displayedLimit} · ${evidence.latest_sale_sort ? "최신 거래순" : "정렬 불일치"}`;
    return `${result}${view}${usage}${usageWarning}`;
  }
  return "";
}

async function copyDiagnosticResult() {
  if (!diagnosticReport) return;
  try {
    const exported = buildDiagnosticExport(diagnosticReport);
    if (diagnosticExportContainsSensitiveData(exported)) {
      throw new Error("진단 결과의 개인정보 안전 검사를 통과하지 못했습니다.");
    }
    await writeTextToClipboard(JSON.stringify(exported, null, 2));
    showStatus("민감정보를 제외한 진단 결과를 복사했습니다.", "success");
  } catch (error) {
    showStatus(`진단 결과를 복사하지 못했습니다: ${redactDiagnosticText(error.message)}`, "error");
  }
}

async function toggleNetworkDiagnostic() {
  if (extensionContextInvalidated || networkDiagnosticTransition) return;
  networkDiagnosticTransition = networkDiagnosticRunning ? "stopping" : "starting";
  networkDiagnosticError = null;
  renderNetworkDiagnosticReport();
  try {
    if (networkDiagnosticRunning) {
      await stopNetworkDiagnostic();
    } else {
      await startNetworkDiagnostic();
    }
  } finally {
    networkDiagnosticTransition = null;
    renderNetworkDiagnosticReport();
  }
}

async function startNetworkDiagnostic() {
  try {
    await verifyAuctionTab();
    networkDiagnosticSessionId = `network-${Date.now()}-${crypto.randomUUID().replace(/-/gu, "").slice(0, 8)}`;
    const response = await chrome.runtime.sendMessage({
      type: "MAPLE_NETWORK_DIAGNOSTIC_START",
      tab_id: sourceTabId,
      session_id: networkDiagnosticSessionId,
      duration_ms: NETWORK_DIAGNOSTIC_DURATION_MS
    });
    if (!response?.ok || !response.report) {
      throw new Error(response?.error || "네트워크 감시를 시작하지 못했습니다.");
    }
    networkDiagnosticError = null;
    networkDiagnosticRunning = true;
    elements.networkDiagnosticDetails.open = true;
    networkDiagnosticReport = await attachPageHookStatus(response.report);
    renderNetworkDiagnosticReport();
    scheduleNetworkDiagnosticPoll();
    if (!collectionRunning) {
      showStatus("네트워크 감시를 시작했습니다. 이제 수집을 실행하거나 문제 상황을 재현하세요.", "success");
    }
  } catch (error) {
    if (!markExtensionContextInvalidated(error)) {
      networkDiagnosticRunning = false;
      networkDiagnosticSessionId = null;
      networkDiagnosticError = redactDiagnosticText(error.message);
      showStatus(`네트워크 감시를 시작하지 못했습니다: ${redactDiagnosticText(error.message)}`, "error");
      renderNetworkDiagnosticReport();
    }
  }
}

async function stopNetworkDiagnostic() {
  stopNetworkDiagnosticPoll();
  try {
    const response = await chrome.runtime.sendMessage({
      type: "MAPLE_NETWORK_DIAGNOSTIC_STOP",
      session_id: networkDiagnosticSessionId,
      tab_id: sourceTabId
    });
    if (!response?.ok) throw new Error(response?.error || "네트워크 감시를 종료하지 못했습니다.");
    if (response.report) networkDiagnosticReport = await attachPageHookStatus(response.report);
    networkDiagnosticError = null;
    networkDiagnosticRunning = false;
    renderNetworkDiagnosticReport();
    if (!collectionRunning) showStatus("네트워크 감시를 종료했습니다. 결과를 복사할 수 있습니다.", "success");
  } catch (error) {
    if (!markExtensionContextInvalidated(error)) {
      networkDiagnosticError = redactDiagnosticText(error.message);
      renderNetworkDiagnosticReport();
      showStatus(`네트워크 감시 종료 중 오류가 발생했습니다: ${redactDiagnosticText(error.message)}`, "error");
      if (networkDiagnosticRunning) scheduleNetworkDiagnosticPoll();
    }
  }
}

async function restoreNetworkDiagnosticSession() {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "MAPLE_NETWORK_DIAGNOSTIC_GET",
      tab_id: sourceTabId
    });
    if (!response?.ok || !response.report) return;
    networkDiagnosticSessionId = response.report.session_id;
    networkDiagnosticRunning = response.report.active === true;
    networkDiagnosticError = null;
    networkDiagnosticReport = await attachPageHookStatus(response.report);
    renderNetworkDiagnosticReport();
    if (networkDiagnosticRunning) scheduleNetworkDiagnosticPoll();
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) throw error;
  }
}

function scheduleNetworkDiagnosticPoll() {
  stopNetworkDiagnosticPoll();
  if (!networkDiagnosticRunning || extensionContextInvalidated) return;
  networkDiagnosticPollTimer = setTimeout(() => {
    void pollNetworkDiagnostic();
  }, NETWORK_DIAGNOSTIC_POLL_MS);
}

function stopNetworkDiagnosticPoll() {
  if (networkDiagnosticPollTimer) clearTimeout(networkDiagnosticPollTimer);
  networkDiagnosticPollTimer = null;
}

async function pollNetworkDiagnostic() {
  if (!networkDiagnosticRunning || extensionContextInvalidated) return;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "MAPLE_NETWORK_DIAGNOSTIC_GET",
      session_id: networkDiagnosticSessionId,
      tab_id: sourceTabId
    });
    if (!response?.ok || !response.report) throw new Error(response?.error || "네트워크 진단 상태가 없습니다.");
    networkDiagnosticReport = await attachPageHookStatus(response.report);
    networkDiagnosticRunning = response.report.active === true;
    networkDiagnosticError = null;
    renderNetworkDiagnosticReport();
  } catch (error) {
    if (markExtensionContextInvalidated(error)) return;
    networkDiagnosticError = redactDiagnosticText(error.message);
    renderNetworkDiagnosticReport();
  }
  if (networkDiagnosticRunning) scheduleNetworkDiagnosticPoll();
}

async function attachPageHookStatus(report) {
  const previousHook = networkDiagnosticReport?.session_id === report?.session_id
    ? networkDiagnosticReport.page_hook
    : null;
  let pageHook = previousHook;
  try {
    const response = await chrome.tabs.sendMessage(sourceTabId, {
      type: "MAPLE_AUCTION_TOOLTIP_NETWORK_STATUS"
    });
    if (response?.ok) pageHook = mergeNetworkPageHookEvidence(previousHook, response);
  } catch (_error) {
    // A navigation can briefly remove the content bridge. Browser-level
    // webRequest events remain available and are still useful on their own.
  }
  return buildNetworkDiagnosticReport(report, pageHook);
}

function mergeNetworkPageHookEvidence(previous, current) {
  if (!previous) return current;
  if (!current) return previous;
  const previousCaptureTime = Date.parse(previous.latest_capture?.captured_at || "");
  const currentCaptureTime = Date.parse((current.latest_capture || current.latest)?.captured_at || "");
  const latestCapture = Number.isFinite(currentCaptureTime) &&
    (!Number.isFinite(previousCaptureTime) || currentCaptureTime >= previousCaptureTime)
    ? (current.latest_capture || current.latest)
    : previous.latest_capture;
  return {
    ...previous,
    ...current,
    installed: previous.installed === true || current.installed === true,
    observed_tooltip_request_count: Math.max(
      Number(previous.observed_tooltip_request_count || 0),
      Number(current.observed_tooltip_request_count || 0)
    ),
    latest_capture: latestCapture
  };
}

function renderNetworkDiagnosticReport() {
  const report = networkDiagnosticReport;
  const summary = report?.summary || { total_requests: 0, tooltip_requests: 0, failed_requests: 0, redirects: 0 };
  elements.networkDiagnosticButton.textContent = networkDiagnosticTransition === "starting"
    ? "네트워크 감시 시작 중"
    : networkDiagnosticTransition === "stopping"
      ? "네트워크 감시 종료 중"
      : networkDiagnosticRunning
    ? "네트워크 감시 종료"
    : report ? "새 네트워크 감시 시작" : "네트워크 감시 시작";
  elements.networkDiagnosticButton.classList.toggle("active", networkDiagnosticRunning);
  elements.networkDiagnosticButton.disabled = extensionContextInvalidated || Boolean(networkDiagnosticTransition);
  elements.networkDiagnosticButton.setAttribute("aria-pressed", String(networkDiagnosticRunning));
  elements.networkDiagnosticBadge.textContent = networkDiagnosticError
    ? "확인 오류"
    : networkDiagnosticRunning
    ? "감시 중"
    : report ? "종료" : "대기";
  elements.networkDiagnosticBadge.className = networkDiagnosticError
    ? "badge error"
    : networkDiagnosticRunning
    ? "badge ready"
    : "badge";
  elements.networkDiagnosticSummary.textContent =
    `완료·오류 ${summary.total_requests || 0} · tool-tip ${summary.tooltip_requests || 0} · 리다이렉트 ${summary.redirects || 0} · 오류 ${summary.failed_requests || 0}`;
  elements.copyNetworkDiagnosticButton.disabled = extensionContextInvalidated || !report;

  const rows = [];
  const diagnosis = diagnoseNetworkDiagnosticReport(report);
  if (diagnosis) {
    const item = document.createElement("li");
    item.textContent = diagnosis.text;
    item.className = diagnosis.level;
    rows.push(item);
  }
  for (const event of (report?.events || []).slice(-120).reverse()) {
    const item = document.createElement("li");
    item.textContent = formatNetworkDiagnosticEvent(event);
    item.className = event.phase === "error" || Number(event.status_code) >= 400
      ? "error"
      : event.endpoint === "sold_tooltip" ? "success" : "";
    rows.push(item);
  }
  elements.networkDiagnosticLog.replaceChildren(...rows);
}

async function copyNetworkDiagnosticResult() {
  if (!networkDiagnosticReport) return;
  try {
    if (networkDiagnosticExportContainsSensitiveData(networkDiagnosticReport)) {
      throw new Error("네트워크 진단 결과의 개인정보 안전 검사를 통과하지 못했습니다.");
    }
    await writeTextToClipboard(JSON.stringify(networkDiagnosticReport, null, 2));
    showStatus("민감정보와 응답 본문을 제외한 네트워크 진단 결과를 복사했습니다.", "success");
  } catch (error) {
    showStatus(`네트워크 진단 결과를 복사하지 못했습니다: ${redactDiagnosticText(error.message)}`, "error");
  }
}

async function resetCollectionProgressFromButton() {
  if (
    collectionRunning || startPending || diagnosticRunning || quotaSyncRunning || progressResetRunning ||
    extensionContextInvalidated || foreignLeaseActiveInView
  ) return;
  const confirmed = window.confirm(
    "모든 조사 항목을 미완료로 되돌리고 순회 순서를 처음부터 다시 시작합니다.\n\n" +
    "저장된 raw 파일, 미저장 원본, 누적 원본 수와 오늘 검색 횟수는 유지됩니다."
  );
  if (!confirmed) return;

  progressResetRunning = true;
  setRunControls(false);
  let resetLeaseAcquired = false;
  let resetOutcome = null;
  try {
    await acquireLease();
    resetLeaseAcquired = true;
    collectorState = await recoverInterruptedJob(collectorState);
    const nextState = resetCollectorProgress(collectorState);
    const persistedState = await persistOwnedStateCas(nextState);
    collectorState = persistedState;
    await mirrorCheckpointSafely(persistedState);
    lastCatalogProgressSignature = null;
    resetProgress();
    elements.currentJob.textContent = "대기 중";
    elements.currentJobDetail.textContent = "판매 완료 · 최신 거래순";
    resetOutcome = {
      message: "수집 진행도를 초기화했습니다. 기존 raw 자료와 오늘 검색 횟수는 유지됩니다.",
      type: "success"
    };
  } catch (error) {
    if (!markExtensionContextInvalidated(error)) {
      if (isLeaseConflictError(error)) {
        foreignLeaseActiveInView = true;
        elements.targetBadge.textContent = "다른 창 실행 중";
        elements.targetBadge.className = "badge";
        scheduleForeignLeaseRefresh();
      }
      resetOutcome = {
        message: `진행도를 초기화하지 못했습니다: ${redactDiagnosticText(error.message)}`,
        type: "error"
      };
    }
  } finally {
    if (resetLeaseAcquired && leaseHeld) {
      await releaseOwnedLeaseAndSave(collectorState).catch((error) => {
        if (!isExtensionContextInvalidatedError(error)) console.error(error);
      });
    }
    progressResetRunning = false;
    renderState();
    setRunControls(false);
    if (!extensionContextInvalidated && resetOutcome) {
      showStatus(resetOutcome.message, resetOutcome.type);
    }
  }
}

async function writeTextToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (_error) {
      // 일부 Chrome 확장 페이지에서는 Clipboard API 권한이 제한될 수 있습니다.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  Object.assign(textarea.style, { position: "fixed", left: "-9999px", top: "0" });
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("클립보드 쓰기가 허용되지 않았습니다.");
}

async function startOrResumeCollection() {
  if (
    collectionRunning || startPending || diagnosticRunning || quotaSyncRunning || progressResetRunning || extensionContextInvalidated ||
    foreignLeaseActiveInView
  ) return;
  diagnosticStatusPinned = false;
  const includeDeferredFailures = elements.includeFailedTasksCheckbox.checked;
  startPending = true;
  elements.startButton.disabled = true;
  updateFailedTasksOptionAppearance();
  let collectionLeaseAcquired = false;
  try {
    await ensureDirectoryWritePermission();
    await verifyAuctionTab();
    await acquireLease();
    collectionLeaseAcquired = true;
    collectorState = await recoverInterruptedJob(collectorState);
    collectorState = discardObsoleteCollectorWork(collectorState);
    await flushPendingCaptures();
    forcedFailureQueryIdsForRun = includeDeferredFailures
      ? deferredFailureQueryIds(collectorState)
      : new Set();
    collectionRunning = true;
    pauseRequested = false;
    collectorState = ensureApplicationState(rolloverCollectorState(collectorState));
    collectorState.run_status = "running";
    collectorState.last_error = null;
    await saveCollectorState(collectorState);
    setRunControls(true);
    resetProgress();
    if (forcedFailureQueryIdsForRun.size > 0) {
      appendLog(`보류된 실패 검색 ${forcedFailureQueryIdsForRun.size}개를 이번 수집에 한 번씩 우선 포함합니다.`);
    }
    showStatus(forcedFailureQueryIdsForRun.size > 0
      ? `보류된 실패 검색 ${forcedFailureQueryIdsForRun.size}개를 포함해 시세 조사를 시작합니다.`
      : "판매 완료 시세 조사를 시작합니다.");
    await runCollectorLoop();
  } catch (error) {
    const invalidated = markExtensionContextInvalidated(error);
    if (!invalidated) showStatus(error.message, "error");
    if (collectorState && !invalidated && leaseHeld) {
      collectorState.run_status = "error";
      collectorState.last_error = error.message;
      await saveCollectorState(collectorState).catch((saveError) => {
        markExtensionContextInvalidated(saveError);
      });
    }
  } finally {
    startPending = false;
    collectionRunning = false;
    pauseRequested = false;
    forcedFailureQueryIdsForRun = new Set();
    elements.includeFailedTasksCheckbox.checked = false;
    if (!extensionContextInvalidated && collectionLeaseAcquired) {
      await cleanupAuctionPage();
    }
    if (collectorState && collectionLeaseAcquired && leaseHeld) {
      collectorState.run_status = collectorState.run_status === "running" ? "paused" : collectorState.run_status;
      await releaseOwnedLeaseAndSave(collectorState).catch((saveError) => {
        if (!isExtensionContextInvalidatedError(saveError)) console.error(saveError);
      });
    }
    if (!extensionContextInvalidated) {
      await focusManagerWindow();
    }
    if (!extensionContextInvalidated) {
      setRunControls(false);
      renderState();
    }
  }
}

async function runCollectorLoop() {
  while (!pauseRequested) {
    collectorState = ensureApplicationState(rolloverCollectorState(collectorState));
    const siteUsage = await refreshSiteSearchUsage();
    if (siteUsage?.limit === HARD_QUERY_LIMIT && siteUsage.used >= HARD_QUERY_LIMIT) {
      collectorState.run_status = "daily_limit";
      showStatus("경매장 상단 검색 횟수가 100 / 100이므로 오늘 수집을 중단합니다.", "success");
      break;
    }
    const candidates = buildSchedulerCandidates(collectorState, {
      forced_failure_query_ids: forcedFailureQueryIdsForRun
    });
    const allowNormalOverflow = canBorrowReserveForNormal(collectorState);
    const allowNormalRebalance = collectorState.quota.normal_reserved < NORMAL_QUERY_LIMIT &&
      collectorState.quota.total_reserved < HARD_QUERY_LIMIT;
    const candidate = selectNextCandidate(candidates, {
      lane_usage: collectorState.lane_usage.normal,
      plan: LANE_PLAN,
      now: Date.now(),
      allow_normal_overflow: allowNormalOverflow,
      allow_normal_rebalance: allowNormalRebalance
    });
    if (!candidate) {
      const progress = catalogQueryProgress(collectorState);
      const deferredFailures = deferredFailureQueryIds(collectorState).size;
      const catalogComplete = progress.completed >= progress.total;
      const normalLimitReached = collectorState.quota.normal_reserved >= NORMAL_QUERY_LIMIT;
      collectorState.run_status = catalogComplete
        ? "catalog_complete"
        : normalLimitReached ? "daily_limit" : "waiting_for_recheck";
      elements.currentJob.textContent = catalogComplete
        ? "전체 검색 완료"
        : normalLimitReached ? "오늘 검색 종료" : "재확인 대기";
      elements.currentJobDetail.textContent = catalogComplete
        ? `검색 작업 ${progress.completed} / ${progress.total} 완료`
        : normalLimitReached
          ? `완료 ${progress.completed} / ${progress.total} · 일반 ${collectorState.quota.normal_reserved} / ${NORMAL_QUERY_LIMIT}`
          : `완료 ${progress.completed} / ${progress.total} · 재확인 대기 ${progress.deferred}` +
            (deferredFailures > 0 ? ` (실패 ${deferredFailures})` : "");
      showStatus(catalogComplete
        ? `전체 검색 작업 ${progress.total}개를 모두 처리했습니다.`
        : normalLimitReached
          ? `오늘 사용할 수 있는 일반 검색을 모두 사용했습니다. 완료 ${progress.completed} / ${progress.total}`
          : `현재 실행 가능한 작업이 없습니다. 완료 ${progress.completed} / ${progress.total} · 재확인 대기 ${progress.deferred}개` +
            (deferredFailures > 0 ? ` (실패 ${deferredFailures}개)` : ""), "success");
      break;
    }
    const result = await executeCandidate(candidate);
    renderState();
    if (!result.ran) {
      collectorState.run_status = result.reason?.includes("limit") ? "daily_limit" : "paused";
      showStatus(quotaMessage(result.reason), result.reason?.includes("limit") ? "success" : "error");
      break;
    }
  }
  if (pauseRequested) {
    collectorState.run_status = "paused";
    await saveCollectorState(collectorState);
    showStatus("현재 검색의 남은 페이지 저장을 마치고 일시정지했습니다.", "success");
  }
}

async function executeCandidate(candidate) {
  const job = candidateToJob(candidate);
  const attemptId = crypto.randomUUID();
  const quotaPurpose = job.retry_id
    ? "recovery"
    : canBorrowReserveForNormal(collectorState) ? "normal_overflow" : "normal";
  const normalLaneRebalanced = quotaPurpose === "normal" &&
    Number(collectorState.lane_usage.normal?.[job.reservation_lane] || 0) >=
      Number(LANE_PLAN[job.reservation_lane] || 0);
  const reservation = reserveQueryQuota(collectorState, {
    attempt_id: attemptId,
    task_id: job.task.id,
    lane: job.reservation_lane,
    page_number: job.page,
    pool: quotaPurpose === "normal" ? "normal" : "reserve",
    quota_purpose: quotaPurpose,
    allow_reserve: job.retry_count > 0,
    allow_normal_rebalance: normalLaneRebalanced,
    metadata: {
      catalog_id: job.task.catalog_id,
      catalog_ids: job.task.catalog_ids,
      query_id: job.task.query.query_id,
      retry_count: job.retry_count,
      quota_purpose: quotaPurpose,
      normal_lane_rebalanced: normalLaneRebalanced
    }
  });
  if (!reservation.ok) {
    return { ran: false, reason: reservation.reason };
  }

  // A deferred physical query is admitted at most once by this run's override.
  // It may already have a naturally eligible retry checkpoint, so consume by
  // query id after any successful reservation rather than by candidate flag.
  forcedFailureQueryIdsForRun.delete(job.task.query.query_id);

  collectorState = {
    ...reservation.state,
    active_job: { attempt_id: attemptId, job },
    run_status: "running"
  };
  await saveCollectorState(collectorState);
  if (normalLaneRebalanced) {
    appendLog(`${taskDisplayName(job.task)} · 남는 일반 검색 횟수를 ${job.reservation_lane} 분류에 재배분합니다.`);
  }
  renderCurrentJob(job);

  let requestStarted = false;
  let pageJob = job;
  try {
    const tab = await verifyAuctionTab();
    const pageLimit = REQUESTED_PAGE_LIMIT;
    const auctionQuery = publicAuctionQuery(job.task.query);
    const submission = await openAuctionSearch(tab.url, auctionQuery, job, attemptId, pageLimit, async () => {
      if (requestStarted) return;
      collectorState = advanceAttemptPhase(collectorState, attemptId, "requested");
      await saveCollectorState(collectorState);
      requestStarted = true;
    });

    const effectivePageLimit = submission.effective_page_limit ?? pageLimit;
    const effectiveAuctionQuery = effectivePageLimit === auctionQuery.page_limit
      ? auctionQuery
      : { ...auctionQuery, page_limit: effectivePageLimit };
    const expectedPriceSearchKey = submission.submitted_price_search_key || null;
    let domPageResponse = await waitForAuctionItems({
      requireFilterApplied: requiresFilterSubmission(auctionQuery),
      attemptId,
      expectedQuery: { ...effectiveAuctionQuery, page: 1 },
      previousDocumentToken: submission.result_document_token || null,
      previousPriceSearchKey: submission.previous_price_search_key || null,
      expectedPriceSearchKey
    });
    const firstPageJob = { ...job, page: 1 };
    let previousDocumentToken = domPageResponse.result_document_token || submission.result_document_token || null;
    let networkContextTemplate = domPageResponse.capture || null;
    const initialDomUsage = domPageResponse.capture?.result_summary?.site_search_usage;
    if (!Number.isInteger(initialDomUsage?.used) || initialDomUsage.limit !== HARD_QUERY_LIMIT) {
      throw new Error("필터 검색 뒤 경매장 상단의 검색 횟수를 확인하지 못했습니다.");
    }
    const expectedSearchUsage = initialDomUsage.used;
    let networkCapture = submission.tooltip_network_ready === true
      ? await waitForTooltipNetworkPage({
        page: 1,
        limit: effectivePageLimit,
        timeoutMs: TOOLTIP_NETWORK_CAPTURE_WAIT_MS
      })
      : null;
    // A missing structured response is retryable even when the DOM reports an
    // empty result.  An empty DOM is never sufficient evidence by itself: the
    // validated API response is the authority for an empty page.
    if (!networkCapture) {
      appendLog(`${taskDisplayName(pageJob.task)} · 1페이지 구조화 응답을 다시 받기 위해 결과 페이지를 새로고침합니다.`);
      domPageResponse = await reloadAuctionResultPage({
        query: effectiveAuctionQuery,
        page: 1,
        limit: effectivePageLimit,
        attemptId,
        previousDocumentToken
      });
      previousDocumentToken = domPageResponse.result_document_token || previousDocumentToken;
      networkContextTemplate = domPageResponse.capture || networkContextTemplate;
      assertSearchUsageDidNotIncrease(expectedSearchUsage, domPageResponse.capture?.result_summary?.site_search_usage);
      if (!await ensureTooltipNetworkHookReady()) {
        throw new Error("새로고침 뒤에도 구조화 응답 수집기를 시작하지 못했습니다.");
      }
      networkCapture = await waitForTooltipNetworkPage({
        page: 1,
        limit: effectivePageLimit,
        timeoutMs: TOOLTIP_NETWORK_CAPTURE_WAIT_MS
      });
    }
    let pageResponse;
    if (networkCapture) {
      pageResponse = buildTooltipNetworkListResponse(
        networkCapture,
        networkContextTemplate,
        firstPageJob,
        effectivePageLimit,
        domPageResponse
      );
      appendLog(`${taskDisplayName(pageJob.task)} · 1페이지 구조화 응답으로 ${networkCapture.payload.items.length}개 매물을 확인했습니다.`);
    } else {
      throw new Error(await tooltipNetworkFailureMessage({
        page: 1,
        limit: effectivePageLimit
      }));
    }

    if (pageJob.page > 1) {
      assertSearchContext(pageResponse.capture?.search_context, firstPageJob, effectivePageLimit);
      assertSearchUsageDidNotIncrease(
        expectedSearchUsage,
        pageResponse.capture?.result_summary?.site_search_usage
      );
      const requestedResumePage = pageJob.page;
      const continuationAnchor = pageJob.pagination?.continuation_anchor || null;
      const firstPageSummary = pageResponse.capture?.result_summary || {};
      const firstPageTotalPages = Number.isInteger(firstPageSummary.total_pages)
        ? firstPageSummary.total_pages
        : firstPageSummary.total_results === 0
          ? 0
          : Number.isInteger(firstPageSummary.total_results) &&
            Number.isInteger(firstPageSummary.displayed_page_limit) &&
            firstPageSummary.displayed_page_limit > 0
            ? Math.ceil(firstPageSummary.total_results / firstPageSummary.displayed_page_limit)
            : null;
      let currentResumePage = 1;
      let resumeAnchorResponse = pageResponse;
      let resumeAnchorValid = continuationAnchor?.page === requestedResumePage - 1 &&
        typeof continuationAnchor?.signature === "string" && continuationAnchor.signature.length > 0;
      let resumeRestartReason = resumeAnchorValid ? null : (
        continuationAnchor ? "snapshot_changed" : "anchor_unavailable"
      );

      if (
        resumeAnchorValid &&
        Number.isInteger(firstPageTotalPages) &&
        firstPageTotalPages >= 0 &&
        firstPageTotalPages < requestedResumePage
      ) {
        resumeAnchorValid = false;
        resumeRestartReason = "page_range_changed";
      }

      if (resumeAnchorValid && continuationAnchor.page > 1) {
        appendLog(
          `${taskDisplayName(pageJob.task)} · 이어질 경계를 확인하기 위해 ${continuationAnchor.page} 숫자 버튼을 직접 누릅니다.`
        );
        const anchorJob = { ...pageJob, page: continuationAnchor.page };
        const anchorPage = await loadResultPageByNumber({
          attemptId,
          query: effectiveAuctionQuery,
          pageJob: anchorJob,
          currentPage: 1,
          pageLimit: effectivePageLimit,
          expectedPriceSearchKey,
          expectedSearchUsage,
          previousDocumentToken
        });
        currentResumePage = continuationAnchor.page;
        resumeAnchorResponse = anchorPage.pageResponse;
        domPageResponse = anchorPage.domPageResponse;
        networkContextTemplate = anchorPage.networkContextTemplate;
        previousDocumentToken = anchorPage.previousDocumentToken;
      }

      if (resumeAnchorValid) {
        const observedAnchorSignature = createStructuredPageSignature(
          resumeAnchorResponse.network_tooltip_capture?.payload?.items || []
        );
        resumeAnchorValid = observedAnchorSignature === continuationAnchor.signature;
        if (!resumeAnchorValid) resumeRestartReason = "snapshot_changed";
      }

      if (!resumeAnchorValid) {
        appendLog(
          `${taskDisplayName(pageJob.task)} · 이전 수집 경계와 현재 검색 결과가 달라 1페이지부터 새 묶음으로 수집합니다.`
        );
        if (currentResumePage !== 1) {
          const firstPageAgain = await loadResultPageByNumber({
            attemptId,
            query: effectiveAuctionQuery,
            pageJob: { ...pageJob, page: 1 },
            currentPage: currentResumePage,
            pageLimit: effectivePageLimit,
            expectedPriceSearchKey,
            expectedSearchUsage,
            previousDocumentToken
          });
          pageResponse = firstPageAgain.pageResponse;
          domPageResponse = firstPageAgain.domPageResponse;
          networkContextTemplate = firstPageAgain.networkContextTemplate;
          previousDocumentToken = firstPageAgain.previousDocumentToken;
        }
        pageJob = {
          ...pageJob,
          page: 1,
          pagination: createPaginationState({ current_page: 1 }),
          sweep_id: crypto.randomUUID(),
          resume_restart_reason: resumeRestartReason || "snapshot_changed"
        };
        collectorState = {
          ...collectorState,
          active_job: { attempt_id: attemptId, job: pageJob }
        };
        await saveCollectorState(collectorState);
      } else {
        appendLog(
          `${taskDisplayName(pageJob.task)} · ${continuationAnchor.page}페이지 경계가 같아 ${requestedResumePage} 숫자 버튼을 직접 눌러 이어서 수집합니다.`
        );
        const resumed = await loadResultPageByNumber({
          attemptId,
          query: effectiveAuctionQuery,
          pageJob,
          currentPage: currentResumePage,
          pageLimit: effectivePageLimit,
          expectedPriceSearchKey,
          expectedSearchUsage,
          previousDocumentToken
        });
        pageResponse = resumed.pageResponse;
        domPageResponse = resumed.domPageResponse;
        networkContextTemplate = resumed.networkContextTemplate;
        previousDocumentToken = resumed.previousDocumentToken;
      }
    }

    while (true) {
      assertSearchContext(pageResponse.capture?.search_context, pageJob, effectivePageLimit);
      const pageUsage = pageResponse.capture?.result_summary?.site_search_usage;
      collectorState = synchronizeSiteUsage(collectorState, pageUsage);
      assertSearchUsageDidNotIncrease(expectedSearchUsage, pageUsage);
      const displayedPageLimit = pageResponse.capture?.result_summary?.displayed_page_limit;
      if (
        displayedPageLimit !== REQUESTED_PAGE_LIMIT &&
        !(pageResponse.empty === true && displayedPageLimit == null)
      ) {
        throw new Error("검색 결과의 60개씩 보기 설정이 유지되지 않았습니다.");
      }
      if (pageJob.page === 1) {
        collectorState.page_limit_calibration = {
          requested_limit: REQUESTED_PAGE_LIMIT,
          effective_limit: effectivePageLimit,
          status: effectivePageLimit === REQUESTED_PAGE_LIMIT ? "confirmed_60" : "empty_result_no_selector",
          reason: effectivePageLimit === REQUESTED_PAGE_LIMIT ? "ui_verified" : "empty_result_no_selector",
          calibrated_at: new Date().toISOString()
        };
      }

      const page = await prepareCollectedPage(
        pageJob,
        attemptId,
        pageResponse,
        effectivePageLimit
      );
      if (page.paginationResult.decision.commit_page !== true) {
        throw new Error("같은 페이지 내용이 반복되어 현재 검색을 안전하게 다시 확인해야 합니다.");
      }
      const continuation = page.paginationResult.decision.action === "continue";
      if (continuation) {
        const nextJob = {
          ...pageJob,
          page: page.paginationResult.decision.next_page,
          pagination: page.paginationResult.state
        };
        const nextState = applyIntermediatePageResult(
          collectorState,
          pageJob,
          nextJob,
          attemptId,
          page.prepared,
          page.paginationResult
        );
        await commitPageAndState(page.prepared, nextState);
        collectorState = nextState;
        await flushCommittedCaptureSafely(page.prepared.page_capture_id);
        appendLog(
          `${taskDisplayName(pageJob.task)} · ${pageJob.page}페이지 · ${page.itemCount}건 저장`,
          "success"
        );

        pageJob = nextJob;
        renderCurrentJob(pageJob);
        const moved = await loadResultPageByNumber({
          attemptId,
          query: effectiveAuctionQuery,
          pageJob,
          currentPage: pageJob.page - 1,
          pageLimit: effectivePageLimit,
          expectedPriceSearchKey,
          expectedSearchUsage,
          previousDocumentToken
        });
        pageResponse = moved.pageResponse;
        domPageResponse = moved.domPageResponse;
        networkContextTemplate = moved.networkContextTemplate;
        previousDocumentToken = moved.previousDocumentToken;
        continue;
      }

      collectorState = advanceAttemptPhase(collectorState, attemptId, "received", Date.now(), {
        received_item_count: page.itemCount,
        page_capture_id: page.prepared.page_capture_id
      });
      await saveReceivedPageAndState(page.prepared, collectorState);
      const nextState = applyCommittedResult(
        collectorState,
        pageJob,
        attemptId,
        page.prepared,
        page.paginationResult
      );
      await commitPageAndState(page.prepared, nextState);
      collectorState = nextState;
      await flushCommittedCaptureSafely(page.prepared.page_capture_id);
      appendLog(
        `${taskDisplayName(pageJob.task)} · ${pageJob.page}페이지 · ${page.itemCount}건 저장` +
          (pageJob.page > 1 ? ` · 검색 1회로 ${pageJob.page}페이지까지 수집` : ""),
        "success"
      );
      return { ran: true };
    }
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) throw error;
    const failedJob = collectorState.active_job?.attempt_id === attemptId
      ? collectorState.active_job.job
      : pageJob;
    collectorState = await handleJobFailure(collectorState, failedJob, attemptId, error, requestStarted);
    appendLog(`${taskDisplayName(failedJob.task)} · ${failedJob.page}페이지: ${error.message}`, "error");
    return {
      ran: requestStarted,
      failed: true,
      reason: requestStarted ? null : "form_preparation_failed"
    };
  } finally {
    await cleanupAuctionPage();
  }
}

async function loadResultPageByNumber({
  attemptId,
  query,
  pageJob,
  currentPage,
  pageLimit,
  expectedPriceSearchKey,
  expectedSearchUsage,
  previousDocumentToken
}) {
  appendLog(
    `${taskDisplayName(pageJob.task)} · 페이지네이션의 ${pageJob.page} 숫자 버튼을 직접 누릅니다.`
  );
  const clickResult = await requestResultPageClick({
    attemptId,
    query,
    currentPage,
    targetPage: pageJob.page,
    pageLimit,
    expectedPriceSearchKey,
    expectedSearchUsage
  });
  assertSearchUsageDidNotIncrease(expectedSearchUsage, clickResult.search_usage);
  await waitForAppliedFilterSearch(query, {}, {
    page: pageJob.page,
    limit: pageLimit,
    expectedPriceSearchKey
  });

  let domPageResponse = await waitForAuctionItems({
    requireFilterApplied: true,
    attemptId,
    expectedQuery: { ...query, page: pageJob.page },
    previousDocumentToken,
    previousPriceSearchKey: null,
    expectedPriceSearchKey
  });
  assertSearchUsageDidNotIncrease(
    expectedSearchUsage,
    domPageResponse.capture?.result_summary?.site_search_usage
  );
  let networkContextTemplate = domPageResponse.capture || null;
  let networkCapture = await waitForTooltipNetworkPage({
    page: pageJob.page,
    limit: pageLimit,
    timeoutMs: TOOLTIP_NETWORK_CAPTURE_WAIT_MS
  });
  // A browser-style numeric click is authoritative. A reload may recover a
  // missed response body, but neither a URL rewrite nor a direct API request
  // may replace the page button interaction.
  if (!networkCapture) {
    appendLog(`${taskDisplayName(pageJob.task)} · ${pageJob.page}페이지 구조화 응답을 다시 받기 위해 새로고침합니다.`);
    domPageResponse = await reloadAuctionResultPage({
      query,
      page: pageJob.page,
      limit: pageLimit,
      attemptId,
      previousDocumentToken: domPageResponse.result_document_token || previousDocumentToken
    });
    networkContextTemplate = domPageResponse.capture || networkContextTemplate;
    assertSearchUsageDidNotIncrease(
      expectedSearchUsage,
      domPageResponse.capture?.result_summary?.site_search_usage
    );
    if (!await ensureTooltipNetworkHookReady()) {
      throw new Error("새로고침 뒤에도 구조화 응답 수집기를 시작하지 못했습니다.");
    }
    networkCapture = await waitForTooltipNetworkPage({
      page: pageJob.page,
      limit: pageLimit,
      timeoutMs: TOOLTIP_NETWORK_CAPTURE_WAIT_MS
    });
  }
  if (!networkCapture) {
    throw new Error(await tooltipNetworkFailureMessage({
      page: pageJob.page,
      limit: pageLimit
    }));
  }

  return {
    pageResponse: buildTooltipNetworkListResponse(
      networkCapture,
      networkContextTemplate,
      pageJob,
      pageLimit,
      domPageResponse
    ),
    domPageResponse,
    networkContextTemplate,
    previousDocumentToken: domPageResponse.result_document_token || previousDocumentToken
  };
}

async function requestResultPageClick({
  attemptId,
  query,
  currentPage,
  targetPage,
  pageLimit,
  expectedPriceSearchKey,
  expectedSearchUsage
}) {
  // Do not use sendToAuction() here: its content-script reinjection retry is
  // appropriate for reads, but a page button must never be dispatched twice.
  const response = await chrome.tabs.sendMessage(sourceTabId, {
    type: "MAPLE_AUCTION_CLICK_RESULT_PAGE_NUMBER",
    attemptId,
    expectedQuery: query,
    currentPage,
    targetPage,
    expectedLimit: pageLimit,
    expectedPriceSearchKey,
    expectedSearchUsed: expectedSearchUsage,
    expectedSearchLimit: HARD_QUERY_LIMIT
  });
  if (!response?.ok || response.clicked !== true || response.target_page !== targetPage) {
    throw new Error(response?.error || `${targetPage} 숫자 페이지 버튼을 누르지 못했습니다.`);
  }
  return response;
}

async function waitForTooltipNetworkPage({ page, limit, timeoutMs }) {
  const deadline = Date.now() + Math.max(0, Number(timeoutMs || 0));
  let lastError = null;
  do {
    try {
      const response = await sendToAuction({
        type: "MAPLE_AUCTION_TOOLTIP_NETWORK_GET_PAGE",
        page,
        limit,
        sort: TOOLTIP_NETWORK_SORT
      });
      if (response?.ok && response.capture) {
        validateTooltipNetworkCapture(response.capture, page, limit);
        return response.capture;
      }
      if (response?.ok !== true) lastError = new Error(response?.error || "구조화 응답을 읽지 못했습니다.");
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) throw error;
      lastError = error;
    }
    if (Date.now() < deadline) await delay(TOOLTIP_NETWORK_POLL_MS);
  } while (Date.now() < deadline);
  if (lastError && /tooltip_network_timeout/u.test(String(lastError.message || lastError))) {
    throw lastError;
  }
  return null;
}

async function tooltipNetworkFailureMessage({ page, limit }) {
  const fallback = "새로고침 뒤에도 판매 매물 구조화 응답을 받지 못했습니다. hover 판독은 사용하지 않습니다.";
  try {
    const status = await sendToAuction({ type: "MAPLE_AUCTION_TOOLTIP_NETWORK_STATUS" });
    if (!status?.ok) return fallback;
    const observed = status.latest_observed;
    if (observed) {
      if (observed.current_search !== true) {
        return `${fallback} 현재 검색이 아닌 이전 tool-tip 요청만 확인했습니다.`;
      }
      const differences = [];
      if (observed.page !== page) differences.push(`페이지 ${observed.page}`);
      if (observed.limit !== limit) differences.push(`${observed.limit}개씩 보기`);
      if (observed.sort !== TOOLTIP_NETWORK_SORT) differences.push("최신 거래순 아님");
      if (differences.length > 0) {
        return `${fallback} 현재 검색의 tool-tip은 보였지만 ${differences.join(" · ")} 응답이었습니다.`;
      }
      return `${fallback} 요청 주소는 확인했지만 응답 본문을 읽지 못했습니다.`;
    }
    if (
      status.fetch_hook_active !== true &&
      status.xhr_hook_active !== true
    ) {
      return `${fallback} 페이지의 응답 본문 수집 훅이 유지되지 않았습니다.`;
    }
    return `${fallback} 현재 검색과 일치하는 tool-tip 요청 자체를 확인하지 못했습니다.`;
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) throw error;
    return fallback;
  }
}

function validateTooltipNetworkCapture(capture, page, limit) {
  if (!tooltipResponseCore?.validateSoldTooltipResponse) {
    throw new Error("구조화 응답 변환기를 불러오지 못했습니다.");
  }
  if (
    !Number.isInteger(capture?.capture_id) || capture.capture_id < 1 ||
    !["fetch", "xhr"].includes(capture.transport) ||
    capture.page !== page || capture.limit !== limit || capture.sort !== TOOLTIP_NETWORK_SORT
  ) {
    throw new Error("요청한 페이지와 구조화 응답의 범위가 일치하지 않습니다.");
  }
  return tooltipResponseCore.validateSoldTooltipResponse(capture.payload, {
    expectedPage: page,
    expectedLimit: limit
  });
}

function buildTooltipNetworkListResponse(capture, contextTemplate, job, pageLimit, domResponse = null) {
  const summary = validateTooltipNetworkCapture(capture, job.page, pageLimit);
  if (domResponse) {
    validateTooltipNetworkPageAgainstDom(capture, domResponse);
  }
  const payload = capture.payload;
  const digits = Math.max(2, String(payload.items.length).length);
  const items = payload.items.map((item, index) => ({
    index,
    api_item_index: index,
    sequence: String(index + 1).padStart(digits, "0"),
    row_name: String(item.itemName || item.toolTip?.itemName || "").trim(),
    base_name: String(item.itemName || item.toolTip?.itemName || "").trim(),
    raw_price: `${item.price} 메소`,
    price_meso: String(item.price),
    observed_date: typeof item.tradeDate === "string" ? item.tradeDate.slice(0, 10) : null,
    starforce: {
      value: Number.isInteger(item.toolTip?.starforce)
        ? item.toolTip.starforce
        : Number.isInteger(item.starforce) ? item.starforce : null,
      source: "api_response"
    },
    potential_grade_raw: item.toolTip?.upgradeInfo?.potential?.description || null,
    additional_potential_grade_raw: item.toolTip?.upgradeInfo?.additionalPotential?.description || null,
    combat_power_change: Number.isFinite(item.attackPowerDiff) ? item.attackPowerDiff : null,
    icon_url: null,
    native_listing_id: null,
    native_item_id: null
  }));
  const sourceCapture = contextTemplate && typeof contextTemplate === "object"
    ? contextTemplate
    : {};
  const sourceSearchContext = sourceCapture.search_context && typeof sourceCapture.search_context === "object"
    ? sourceCapture.search_context
    : {};
  const sourceResultSummary = sourceCapture.result_summary && typeof sourceCapture.result_summary === "object"
    ? sourceCapture.result_summary
    : {};
  return {
    ok: true,
    items,
    empty: items.length === 0,
    pending: false,
    result_document_token: `tooltip-network-v2:${capture.capture_id}:p${job.page}`,
    network_tooltip_capture: capture,
    capture: {
      ...sourceCapture,
      source_path: sourceCapture.source_path || "/price",
      search_context: {
        ...sourceSearchContext,
        page_kind: "sold",
        sort: TOOLTIP_NETWORK_SORT.toLowerCase(),
        page: summary.page,
        limit: summary.limit,
        price_search_key_present: true,
        filter_search_applied: true
      },
      result_summary: {
        ...sourceResultSummary,
        total_results: summary.total,
        total_pages: summary.total_pages,
        current_page: summary.page,
        has_next_page: summary.has_next_page,
        page_item_count: summary.page_item_count,
        requested_page_limit: summary.limit,
        displayed_page_limit: summary.page_item_count === 0 && sourceResultSummary.displayed_page_limit == null
          ? null
          : summary.limit,
        site_search_usage: sourceResultSummary.site_search_usage || null
      },
      quality_warnings: [
        ...(sourceCapture.quality_warnings || []),
        "items_collected_from_structured_tooltip_response"
      ]
    }
  };
}

function validateTooltipNetworkPageAgainstDom(capture, domResponse) {
  const apiItems = capture?.payload?.items;
  const domItems = domResponse?.items;
  if (!Array.isArray(apiItems) || !Array.isArray(domItems)) {
    throw new Error("현재 페이지 구조화 응답과 화면 매물을 함께 검증할 수 없습니다.");
  }
  const domPage = domResponse?.capture?.search_context?.page;
  if (domPage !== capture.page) {
    throw new Error(`구조화 응답 ${capture.page}페이지와 화면 ${domPage ?? "미확인"}페이지가 일치하지 않습니다.`);
  }
  if (apiItems.length !== domItems.length) {
    throw new Error(`현재 페이지 구조화 응답 건수(${apiItems.length})와 화면 매물 건수(${domItems.length})가 일치하지 않습니다.`);
  }
  for (let index = 0; index < apiItems.length; index += 1) {
    const apiItem = apiItems[index] || {};
    const domItem = domItems[index] || {};
    const apiName = String(apiItem.itemName || apiItem.toolTip?.itemName || "")
      .replace(/\s+/gu, " ").trim();
    const domName = String(domItem.base_name || domItem.row_name || "")
      .replace(/\s+/gu, " ").trim();
    if (apiName && domName && apiName !== domName) {
      throw new Error(`현재 페이지 ${index + 1}번 매물 이름이 화면과 일치하지 않습니다.`);
    }
    const apiPrice = String(apiItem.price || "").trim();
    const domPrice = String(domItem.price_meso || "").trim();
    if (apiPrice && domPrice && apiPrice !== domPrice) {
      throw new Error(`현재 페이지 ${index + 1}번 매물 가격이 화면과 일치하지 않습니다.`);
    }
  }
}

async function prepareCollectedPage(job, attemptId, listResponse, pageLimit) {
  const capture = await collectPage(job, attemptId, listResponse, pageLimit);
  if (
    capture.document.capture.collection_summary.exact_name_rows > 0 &&
    capture.document.items.length === 0 &&
    capture.document.capture.collection_summary.failed_items > 0
  ) {
    throw new Error("검색 결과는 있으나 장비 툴팁을 하나도 저장하지 못했습니다.");
  }
  let paginationResult = evaluateCollectedPage(job.pagination, {
    items: capture.document.items,
    page_number: job.page,
    effective_page_limit: pageLimit,
    has_next_page: capture.document.capture.result_summary?.has_next_page,
    row_count: capture.document.capture.collection_summary.page_rows,
    total_results: capture.document.capture.result_summary?.total_results
  });
  paginationResult = applyCollectionPaginationPolicy(job, paginationResult);
  if (paginationResult.decision.commit_page === true) {
    paginationResult = {
      ...paginationResult,
      state: {
        ...paginationResult.state,
        continuation_anchor: {
          page: job.page,
          signature: createStructuredPageSignature(
            listResponse.network_tooltip_capture?.payload?.items || []
          )
        }
      }
    };
  }
  capture.document.capture.result_summary.page_signature = paginationResult.decision.signature;
  capture.document.capture.result_summary.boundary_keys = capture.document.items
    .map(listingIdentity)
    .filter(Boolean);

  const prepared = await prepareCaptureRecord(capture.document, job, attemptId);
  prepared.pagination_result = paginationResult;
  return {
    prepared,
    paginationResult,
    itemCount: capture.document.items.length
  };
}

async function collectPage(job, attemptId, listResponse, pageLimit) {
  const sourceDescriptors = listResponse.items || [];
  const networkPayload = listResponse.network_tooltip_capture?.payload || null;
  const networkCollection = Boolean(networkPayload);
  if (networkCollection) {
    validateTooltipNetworkCapture(listResponse.network_tooltip_capture, job.page, pageLimit);
  } else if (sourceDescriptors.length > 0) {
    throw new Error("구조화 응답 없이 매물 툴팁을 읽지 않습니다. 결과 페이지를 다시 불러와 주세요.");
  }
  const resultCap = Number(job.task.query.page_sweep?.result_cap);
  const committedRows = Number(job.pagination?.committed_rows || 0);
  const remainingRows = Number.isFinite(resultCap)
    ? Math.max(0, resultCap - committedRows)
    : sourceDescriptors.length;
  const allDescriptors = sourceDescriptors.slice(0, remainingRows);
  const cappedRows = Math.max(0, sourceDescriptors.length - allDescriptors.length);
  const taskCatalogIds = Array.isArray(job.task.catalog_ids)
    ? job.task.catalog_ids
    : [job.task.catalog_id].filter(Boolean);
  const allowedNames = new Set(job.task.allowed_names || [job.task.keyword]);
  const globalPotentialSearch = [
    "global_accessory_potential",
    "global_category_potential"
  ].includes(job.task.query.group);
  const descriptors = globalPotentialSearch
    ? allDescriptors
    : allDescriptors.filter((descriptor) => allowedNames.has(descriptor.base_name));
  const mismatched = globalPotentialSearch
    ? []
    : allDescriptors.filter((descriptor) => !allowedNames.has(descriptor.base_name));
  const globalCatalogSearch = job.task.query.search_scope === "catalog_global";
  if (allDescriptors.length > 0 && descriptors.length === 0 && !globalCatalogSearch) {
    throw new Error("검색 결과 행은 있지만 허용된 장비명과 일치하지 않아 빈 결과로 저장하지 않습니다.");
  }
  const batchId = crypto.randomUUID();
  const capturedAtDate = new Date();
  const capturedAt = isoWithLocalOffset(capturedAtDate);
  const items = [];
  const auditedItems = [];
  const failures = [];
  const localExclusions = { category: 0, range: 0 };
  progressCount(`${0} / ${descriptors.length}`);
  appendLog(descriptors.length
    ? `${taskDisplayName(job.task)} ${descriptors.length}개 매물을 읽습니다.`
    : allDescriptors.length > 0
      ? `${taskDisplayName(job.task)} · 현재 페이지에는 고정 조사 목록 매물이 없습니다.`
      : `${taskDisplayName(job.task)} 검색 결과가 없습니다.`);

  for (let index = 0; index < descriptors.length; index += 1) {
    if (index > 0 && index % 10 === 0) await saveCollectorState(collectorState);
    const descriptor = descriptors[index];
    updateProgress(index, descriptors.length, `${descriptor.sequence}번 장비 정보 수집 중`);
    try {
      const catalogItem = CATALOG_BY_NAME[descriptor.base_name] || null;
      if (!globalPotentialSearch && (!catalogItem || !taskCatalogIds.includes(catalogItem.id))) {
        throw new Error(`고정 조사 목록에 없는 장비입니다: ${descriptor.base_name}`);
      }
      const rawItem = networkPayload.items[descriptor.api_item_index];
      if (!rawItem || rawItem.itemName !== descriptor.base_name || String(rawItem.price) !== descriptor.price_meso) {
        throw new Error("구조화 응답의 매물 순서가 검색 결과와 일치하지 않습니다.");
      }
      const collectedItem = await tooltipResponseCore.convertSoldTooltipItem(rawItem, {
        batchId,
        rowIndex: descriptor.index + 1,
        hashId: (material) => sha256Hex(material)
      });
      const enriched = enrichSelection(collectedItem, job.task, catalogItem, {
        allowUncataloguedPotential: globalPotentialSearch
      });
      auditedItems.push(enriched);
      const exclusion = globalPotentialExclusion(enriched, job.task.query);
      if (exclusion) {
        localExclusions[exclusion] += 1;
        continue;
      }
      items.push(enriched);
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) throw error;
      failures.push({ row_index: descriptor.index + 1, message: error.message });
      appendLog(`${descriptor.sequence}번 실패: ${error.message}`, "error");
    }
    updateProgress(index + 1, descriptors.length, `${index + 1} / ${descriptors.length} 처리됨`);
  }

  if (localExclusions.category > 0 || localExclusions.range > 0) {
    appendLog(
      `${taskDisplayName(job.task)} · 분류 밖 ${localExclusions.category}건 · 구간 밖 ${localExclusions.range}건 제외`
    );
  }
  if (
    job.task.query.group === "global_category_potential" &&
    auditedItems.length > 0 &&
    localExclusions.category === auditedItems.length
  ) {
    throw new Error("구조화 응답에서 선택한 장신구·방어구 분류를 한 건도 확인하지 못했습니다.");
  }

  const pageContext = listResponse.capture || {};
  const qualityWarnings = [...(pageContext.quality_warnings || [])];
  if (cappedRows > 0) qualityWarnings.push(`result_cap_rows_excluded:${cappedRows}`);
  if (mismatched.length > 0) {
    qualityWarnings.push(`${globalCatalogSearch ? "non_catalog" : "non_exact"}_item_rows_excluded:${mismatched.length}`);
  }
  if (localExclusions.category > 0) {
    qualityWarnings.push(`global_potential_category_rows_excluded:${localExclusions.category}`);
  }
  if (localExclusions.range > 0) {
    qualityWarnings.push(`global_potential_range_rows_excluded:${localExclusions.range}`);
  }
  if (job.task.query.potential_filter?.evidence_status === "legacy_unverified") {
    qualityWarnings.push(`auction_filter_runtime_verification_required:${job.task.query.potential_filter.capability_id}`);
  }
  const filterAudit = auditServerFilter(auditedItems, job.task.query);
  if (filterAudit?.failed_count > 0) {
    qualityWarnings.push(`auction_filter_semantics_mismatch:${filterAudit.capability_id}:${filterAudit.failed_count}`);
  }
  const document = {
    schema_version: "maple-auction.capture.v2",
    capture: {
      batch_id: batchId,
      captured_at: capturedAt,
      extension_version: extensionVersion,
      source_site: "https://auction.maplestory.nexon.com",
      source_path: pageContext.source_path || null,
      viewer_world: pageContext.viewer_world ?? null,
      auction_group: pageContext.auction_group ?? null,
      collection_mode: job.resume_restart_reason
        ? "catalog_restart"
        : job.retry_count > 0 ? "catalog_resume" : "catalog_sweep",
      collection_transport: networkCollection ? "tooltip_api" : "empty_result_dom",
      catalog: {
        version: CATALOG_VERSION,
        catalog_id: job.task.catalog_id,
        catalog_ids: job.task.catalog_ids,
        exact_name: job.task.query.exact_match === false ? null : job.task.keyword,
        search_keyword: job.task.keyword,
        allowed_names: job.task.allowed_names,
        base_level: job.task.base_level,
        slot: job.task.slot
      },
      query_task: publicTask(job.task),
      filter_audit: filterAudit,
      attempt: {
        attempt_id: attemptId,
        reservation_lane: job.reservation_lane,
        quota_purpose: collectorState.attempts?.[attemptId]?.quota_purpose || null,
        quota_session_id: collectorState.attempts?.[attemptId]?.quota_session_id || null,
        sweep_id: job.sweep_id || null,
        page: job.page,
        retry_count: job.retry_count,
        resume_restart_reason: job.resume_restart_reason || null
      },
      daily_quota: publicQuota(collectorState),
      preset: publicTask(job.task),
      preset_index: null,
      preset_count: null,
      search_context: pageContext.search_context || null,
      result_summary: pageContext.result_summary || {
        total_results: null,
        total_pages: null,
        current_page: job.page,
        has_next_page: null,
        page_item_count: allDescriptors.length,
        requested_page_limit: pageLimit,
        displayed_page_limit: null,
        site_search_usage: null
      },
      collection_summary: {
        source_page_rows: sourceDescriptors.length,
        page_rows: allDescriptors.length,
        exact_name_rows: descriptors.length,
        allowed_name_rows: descriptors.length,
        excluded_name_mismatches: mismatched.length,
        collected_items: items.length,
        locally_excluded_category_rows: localExclusions.category,
        locally_excluded_range_rows: localExclusions.range,
        failed_items: failures.length,
        failures
      },
      quality_warnings: qualityWarnings
    },
    items
  };
  return { document, capturedAtDate };
}

function enrichSelection(record, task, catalogItem = null, options = {}) {
  catalogItem ||= CATALOG_BY_NAME[record?.item?.name] || CATALOG_BY_ID[task.catalog_id];
  if (!catalogItem && options.allowUncataloguedPotential === true) {
    catalogItem = syntheticGlobalPotentialCatalogItem(record, task.query);
  }
  if (!catalogItem) throw new Error("수집한 장비를 고정 조사 목록에 연결하지 못했습니다.");
  const catalogId = catalogItem.id || null;
  const catalogPrefix = catalogId || (
    task.query.group === "global_category_potential"
      ? "global:category-potential"
      : "global:accessory-potential"
  );
  const requiredLevel = Number.isInteger(record.item?.required_level)
    ? record.item.required_level
    : null;
  const requiredLevelReduction = Number.isInteger(record.item?.required_level_reduction)
    ? record.item.required_level_reduction
    : Number.isInteger(catalogItem.level) && requiredLevel != null && requiredLevel <= catalogItem.level
      ? catalogItem.level - requiredLevel
      : null;
  record = {
    ...record,
    item: {
      ...record.item,
      catalog_id: catalogId,
      base_level: Number.isInteger(record.item?.base_level)
        ? record.item.base_level
        : catalogId ? catalogItem.level : null,
      required_level_reduction: requiredLevelReduction,
      starforce: record.item?.starforce && typeof record.item.starforce === "object"
        ? {
            ...record.item.starforce,
            applicable: record.item.starforce.applicable ?? catalogItem.starforce_eligible ?? null
          }
        : record.item?.starforce
    }
  };
  const classification = classifyPotentialProfiles(catalogItem, record.item?.potential);
  const matched = catalogId ? [`${catalogId}:BASE_ANY`] : [];
  const channels = catalogId
    ? ["baseline"]
    : task.query.group === "global_category_potential" ? [] : ["accessory"];
  if (task.query.group === "global_category_potential") {
    for (const targetId of task.query.selection_channels || []) {
      matched.push(`${catalogPrefix}:${targetId}`);
      channels.push(targetId);
    }
  }
  const observedStarforceBand = starforceBandIdForRecord(record, task.query);
  if (observedStarforceBand) {
    matched.push(`${catalogPrefix}:${observedStarforceBand}`);
    channels.push("starforce");
  }
  for (const [profileId, value] of Object.entries(classification.profiles)) {
    if (Array.isArray(value)) {
      for (const entry of value.filter((candidate) => candidate.matched)) {
        matched.push(`${catalogPrefix}:${profileId}:${entry.stat}:${entry.grade || "matched"}`);
      }
      if (value.some((entry) => entry.matched)) channels.push(profileChannel(profileId));
    } else if (
      profileId === "ACCESSORY_DROP_MESO" &&
      Array.isArray(value?.matched_targets) &&
      value.matched_targets.length > 0
    ) {
      for (const targetId of value.matched_targets) {
        matched.push(`${catalogPrefix}:${profileId}:${targetId}`);
      }
      channels.push(profileChannel(profileId));
    } else if (value?.matched) {
      matched.push(`${catalogPrefix}:${profileId}:${value.matched_rule || value.grade || "matched"}`);
      channels.push(profileChannel(profileId));
    }
  }
  return {
    ...record,
    catalog_id: catalogId,
    matched_preset_ids: Array.from(new Set(matched)).sort(),
    selection_channels: Array.from(new Set(channels.filter(Boolean))).sort(),
    profile_classification: classification
  };
}

function syntheticGlobalPotentialCatalogItem(record, query = {}) {
  const baseLevel = Number(record?.item?.base_level);
  const statMarketSearch = query.group === "global_category_potential";
  return {
    id: null,
    name: record?.item?.name || "",
    level: Number.isInteger(baseLevel) && baseLevel >= 0 ? baseLevel : 0,
    // The auction filter itself defines this collection channel.  Do not lose
    // a valid drop/meso result merely because the site's category label is new,
    // absent, or spelled differently from the current catalogue.
    main_stats: ["STR", "DEX", "INT", "LUK"],
    potential_profiles: statMarketSearch
      ? ["MAIN_STAT", "ALL_STAT"]
      : ["ACCESSORY_DROP_MESO"],
    starforce_eligible: record?.item?.starforce?.applicable ?? null
  };
}

async function prepareCaptureRecord(document, job, attemptId) {
  const payloadSha256 = await sha256Hex(JSON.stringify(document));
  document.integrity = { algorithm: "SHA-256", payload_sha256: payloadSha256 };
  const outputText = `${JSON.stringify(document)}\n`;
  const fileSha256 = await sha256Hex(outputText);
  const pageCaptureId = `${toKstDateKey()}-${attemptId}-p${job.page}`;
  const filename = buildOutputFilename(taskDisplayName(job.task), job.page, attemptId, new Date());
  return {
    page_capture_id: pageCaptureId,
    attempt_id: attemptId,
    task_id: job.task.id,
    catalog_id: job.task.catalog_id,
    catalog_ids: job.task.catalog_ids,
    created_at: new Date().toISOString(),
    filename,
    relative_path: `raw/${filename}`,
    payload_sha256: payloadSha256,
    file_sha256: fileSha256,
    file_status: "pending",
    document,
    output_text: outputText
  };
}

function applyCommittedResult(state, job, attemptId, captureRecord, paginationResult) {
  let next = advanceAttemptPhase(state, attemptId, "committed", Date.now(), {
    page_capture_id: paginationResult.decision.commit_page ? captureRecord.page_capture_id : null,
    stop_reason: paginationResult.decision.reason
  });
  next = applyCapturedPageStats(
    next,
    job,
    captureRecord,
    paginationResult,
    pageSweepCompleted(job, captureRecord, paginationResult)
  );
  next = {
    ...next,
    active_job: null,
    retries: next.retries.filter((entry) => entry.id !== job.retry_id),
    last_error: null
  };
  return compactAttempts(next);
}

function applyIntermediatePageResult(state, job, nextJob, attemptId, captureRecord, paginationResult) {
  const next = applyCapturedPageStats(state, job, captureRecord, paginationResult, false);
  return {
    ...next,
    active_job: { attempt_id: attemptId, job: nextJob },
    run_status: "running",
    last_error: null
  };
}

function applyCapturedPageStats(state, job, captureRecord, paginationResult, sweepComplete) {
  const count = captureRecord.document.items.length;
  const sourceRowCount = Number(
    captureRecord.document.capture?.collection_summary?.page_rows || 0
  );
  const committedPage = paginationResult.decision.commit_page === true;
  const committedCount = committedPage ? count : 0;
  const sweepEnabled = job.task.query.page_sweep?.enabled === true;
  const lastSuccessAt = new Date().toISOString();
  const updatedQueryStats = { ...state.query_stats };
  for (const sibling of fixedTasks.filter((task) => task.query.query_id === job.task.query.query_id)) {
    const previousStats = updatedQueryStats[sibling.id] || {};
    const emptyFirstPage = job.page === 1 && sourceRowCount === 0;
    const eligibilityStats = emptyFirstPage
      ? previousStats
      : clearEmptyBackoff(previousStats);
    let stats = {
      ...eligibilityStats,
      pages: Number(previousStats.pages || 0) + (committedPage ? 1 : 0),
      observations: Number(previousStats.observations || 0) + committedCount,
      failures: Number(previousStats.failures || 0),
      first_page_captured: previousStats.first_page_captured === true || (
        job.page === 1 && committedPage && sourceRowCount > 0
      ),
      ...(sweepEnabled ? {
        page_sweep_pages: job.page === 1
          ? (committedPage ? 1 : 0)
          : Number(previousStats.page_sweep_pages || 0) + (committedPage ? 1 : 0),
        page_sweep_last_page: committedPage ? job.page : previousStats.page_sweep_last_page || null,
        page_sweep_complete: sweepComplete === true,
        page_sweep_stop_reason: sweepComplete === true ? paginationResult.decision.reason : null,
        page_sweep_truncated: sweepComplete === true &&
          paginationResult.decision.reason === "result_cap_reached"
      } : {}),
      last_success_at: lastSuccessAt
    };
    if (emptyFirstPage) stats = applyEmptyBackoff(stats);
    updatedQueryStats[sibling.id] = stats;
  }

  return {
    ...state,
    watermarks: {},
    query_stats: updatedQueryStats,
    filter_audits: committedPage
      ? updateFilterAudits(state.filter_audits, captureRecord.document.capture.filter_audit)
      : state.filter_audits,
    totals: {
      ...state.totals,
      pages: state.totals.pages + (committedPage ? 1 : 0),
      observations: state.totals.observations + committedCount
    }
  };
}

async function handleJobFailure(state, job, attemptId, error, requestStarted) {
  let next = state;
  const attempt = next.attempts?.[attemptId];
  if (attempt?.phase === "reserved" && !requestStarted) {
    next = releaseUnrequestedReservation(next, attemptId);
  } else if (attempt) {
    if (attempt.phase === "requested") next = advanceAttemptPhase(next, attemptId, "received", Date.now(), { failed: true });
    if (next.attempts?.[attemptId]?.phase === "received") {
      next = advanceAttemptPhase(next, attemptId, "committed", Date.now(), { failed: true, error: error.message });
    }
  }
  if (job.retry_id && requestStarted) {
    next = {
      ...next,
      retries: next.retries.filter((entry) => entry.id !== job.retry_id)
    };
  }
  const previous = next.query_stats[job.task.id] || {};
  const retryExhausted = requestStarted && Number(job.retry_count || 0) >= MAX_RETRY_COUNT;
  const failedStats = {
    ...previous,
    failures: Number(previous.failures || 0) + 1,
    ...(retryExhausted ? {
      next_eligible_date: addKstDays(toKstDateKey(), 1),
      next_eligible_reason: "failure"
    } : {})
  };
  const failedQueryStats = { ...next.query_stats, [job.task.id]: failedStats };
  if (retryExhausted) {
    const nextEligibleDate = failedStats.next_eligible_date;
    for (const sibling of fixedTasks.filter((task) =>
      task.query.query_id === job.task.query.query_id && task.id !== job.task.id
    )) {
      failedQueryStats[sibling.id] = {
        ...(failedQueryStats[sibling.id] || {}),
        next_eligible_date: nextEligibleDate,
        next_eligible_reason: "failure"
      };
    }
  }
  next = {
    ...next,
    active_job: null,
    query_stats: failedQueryStats,
    totals: { ...next.totals, failures: next.totals.failures + 1 },
    last_error: error.message
  };
  if (requestStarted && job.retry_count < MAX_RETRY_COUNT) next = enqueueRetry(next, job, error.message);
  next = compactAttempts(next);
  await saveCollectorState(next);
  return next;
}

function enqueueRetry(state, job, reason) {
  const retryCount = Number(job.retry_count || 0) + 1;
  if (retryCount > MAX_RETRY_COUNT) return state;
  const page = Number.isInteger(job.page) && job.page > 0 ? job.page : 1;
  const sweepId = job.sweep_id || crypto.randomUUID();
  const id = `retry:${sweepId}:${page}:${retryCount}`;
  if (state.retries.some((entry) => entry.id === id)) return state;
  const retryTask = job.task;
  return {
    ...state,
    retries: [...state.retries, {
      id,
      retry: true,
      underlying_task_id: retryTask.id,
      task: retryTask,
      page,
      pagination: createPaginationState({
        ...(job.pagination || {}),
        current_page: page
      }),
      sweep_id: sweepId,
      resume_restart_reason: job.resume_restart_reason || null,
      retry_count: retryCount,
      retry_reason: reason,
      created_at: new Date().toISOString(),
      priority: job.task.priority
    }]
  };
}

function deferPhysicalQueryUntilNextDay(state, job) {
  const nextEligibleDate = addKstDays(toKstDateKey(), 1);
  const queryStats = { ...state.query_stats };
  for (const sibling of fixedTasks.filter((task) =>
    task.query.query_id === job.task.query.query_id
  )) {
    queryStats[sibling.id] = {
      ...(queryStats[sibling.id] || {}),
      next_eligible_date: nextEligibleDate,
      next_eligible_reason: "failure"
    };
  }
  return { ...state, query_stats: queryStats };
}

function deferRetryCheckpointUntilNextDay(state, job, reason) {
  const nextEligibleDate = addKstDays(toKstDateKey(), 1);
  const deferred = deferPhysicalQueryUntilNextDay(state, job);
  let found = false;
  const retries = deferred.retries.map((entry) => {
    if (entry.id !== job.retry_id) return entry;
    found = true;
    return {
      ...entry,
      page: job.page,
      pagination: createPaginationState({
        ...(job.pagination || entry.pagination || {}),
        current_page: job.page
      }),
      sweep_id: job.sweep_id || entry.sweep_id,
      resume_restart_reason: job.resume_restart_reason || entry.resume_restart_reason || null,
      retry_reason: reason,
      next_eligible_date: nextEligibleDate,
      next_eligible_reason: "failure"
    };
  });
  return {
    ...deferred,
    retries: found ? retries : deferred.retries
  };
}

function buildSchedulerCandidates(state, options = {}) {
  const forcedFailureQueryIds = options.forced_failure_query_ids instanceof Set
    ? options.forced_failure_query_ids
    : new Set(options.forced_failure_query_ids || []);
  const retryQuotaAvailable = state.quota.reserve_reserved < RESERVE_QUERY_LIMIT &&
    state.quota.total_reserved < HARD_QUERY_LIMIT;
  const pendingRetryQueryIds = new Set(
    state.retries.map((entry) => entry.task?.query?.query_id).filter(Boolean)
  );
  const candidates = (retryQuotaAvailable ? state.retries : [])
    .filter((entry) => entry?.retry === true && Number.isInteger(entry.page) && entry.page >= 1)
    .map((entry) => ({
      ...entry,
      lane: entry.task?.reservation_lane || entry.task?.lane,
      reservation_lane: entry.task?.reservation_lane || entry.task?.lane,
      next_eligible_date: entry.next_eligible_date || null,
      next_eligible_reason: inferNextEligibleReason(entry),
      failure_recheck: forcedFailureQueryIds.has(entry.task?.query?.query_id) &&
        inferNextEligibleReason(entry) === "failure"
    }));
  for (const task of fixedTasks) {
    if (pendingRetryQueryIds.has(task.query.query_id)) continue;
    const stats = state.query_stats[task.id] || {};
    const nextEligibleReason = inferNextEligibleReason(stats);
    candidates.push({
      ...task,
      observations: Number(stats.observations || 0),
      deficit: Math.max(0, task.target_observations - Number(stats.observations || 0)),
      completed: isPhysicalQueryComplete(task.query, stats),
      next_eligible_date: stats.next_eligible_date || null,
      next_eligible_reason: nextEligibleReason,
      failure_recheck: forcedFailureQueryIds.has(task.query.query_id) &&
        nextEligibleReason === "failure",
      last_success_at: stats.last_success_at || null
    });
  }
  return candidates;
}

function candidateToJob(candidate) {
  if (candidate.retry === true) {
    const page = Number.isInteger(candidate.page) && candidate.page > 0 ? candidate.page : 1;
    return {
      retry_id: candidate.id,
      task: candidate.task,
      page,
      pagination: createPaginationState({
        ...(candidate.pagination || {}),
        current_page: page
      }),
      sweep_id: candidate.sweep_id,
      resume_restart_reason: candidate.resume_restart_reason || null,
      retry_count: Math.max(1, Number(candidate.retry_count || 0)),
      reservation_lane: candidate.reservation_lane || candidate.task?.reservation_lane || candidate.task?.lane
    };
  }
  const underlyingTask = candidate;
  return {
    retry_id: null,
    task: underlyingTask,
    page: 1,
    pagination: createPaginationState({ current_page: 1 }),
    sweep_id: crypto.randomUUID(),
    retry_count: 0,
    reservation_lane: candidate.reservation_lane || candidate.lane
  };
}

function buildFixedTasks(queries) {
  const tasks = [];
  for (const query of queries) {
    const base = {
      query,
      catalog_id: query.catalog_id ?? null,
      catalog_ids: Array.isArray(query.catalog_ids) && query.catalog_ids.length > 0
        ? [...query.catalog_ids]
        : [query.catalog_id].filter(Boolean),
      allowed_names: Array.isArray(query.allowed_names) && query.allowed_names.length > 0
        ? [...query.allowed_names]
        : [query.exact_name].filter(Boolean),
      keyword: query.search_keyword ?? query.exact_name ?? "",
      display_name: query.display_name || query.search_keyword || query.exact_name || "전체 장비",
      base_level: query.level,
      slot: query.slot,
      priority: query.priority,
      target_observations: 60
    };
    const hasStarforce = query.starforce_min != null || query.starforce_max != null;
    const logical = new Set(query.logical_lanes);
    if (hasStarforce) {
      tasks.push(taskForLane(base, "starforce"));
      continue;
    }
    if (query.potential_filter) {
      const lane = [...logical].some((value) => value.startsWith("POT_MITRA"))
        ? "mitra"
        : query.group === "global_category_potential"
          ? query.potential_filter.capability_id === "ALL_STAT_PCT" ? "allstat" : "main"
        : [...logical].some((value) => value.startsWith("POT_ACCESSORY_"))
          ? "accessory"
        : logical.has("POT_ALL_STAT") ? "allstat" : "main";
      tasks.push(taskForLane({ ...base, target_observations: 60 }, lane));
      continue;
    }
    tasks.push(taskForLane(base, "baseline"));
    if (logical.has("POT_MAX_HP")) tasks.push(taskForLane(base, "hp"));
    if (logical.has("POT_HAT_COOLDOWN")) tasks.push(taskForLane(base, "hat"));
    if (logical.has("POT_GLOVE_CRITICAL_DAMAGE")) tasks.push(taskForLane(base, "glove"));
    if (logical.has("POT_ACCESSORY_DROP_MESO")) tasks.push(taskForLane(base, "accessory"));
    if ([...logical].some((value) => value.startsWith("POT_MITRA"))) tasks.push(taskForLane(base, "mitra"));
    tasks.push(taskForLane({ ...base, target_observations: 60 }, "audit"));
  }
  const unique = new Map(tasks.map((task) => [task.id, task]));
  return [...unique.values()].sort(compareTaskId);
}

function taskForLane(base, lane) {
  return {
    ...base,
    id: `${base.query.query_id}#${lane}`,
    lane,
    reservation_lane: lane
  };
}

function publicAuctionQuery(query) {
  return {
    keyword: query.search_keyword ?? query.exact_name ?? "",
    search_scope: query.search_scope || null,
    exact_match: query.exact_match !== false,
    allowed_names: Array.isArray(query.allowed_names) ? [...query.allowed_names] : [query.exact_name].filter(Boolean),
    page_limit: REQUESTED_PAGE_LIMIT,
    starforce_min: query.starforce_min,
    starforce_max: query.starforce_max,
    price_min_meso: query.price_min_meso ?? null,
    price_max_meso: query.price_max_meso ?? null,
    item_category_filter: query.item_category_filter ?? null,
    equipment_subcategory_filter: query.equipment_subcategory_filter ?? null,
    server_filter: query.potential_filter ? {
      code: query.potential_filter.auction_code,
      minimum: query.potential_filter.minimum,
      maximum: query.potential_filter.maximum ?? null
    } : null
  };
}

function publicTask(task) {
  return {
    task_id: task.id,
    query_id: task.query.query_id,
    catalog_id: task.catalog_id,
    catalog_ids: task.catalog_ids,
    allowed_names: task.allowed_names,
    keyword: task.keyword,
    display_name: task.display_name,
    search_scope: task.query.search_scope || null,
    progress_scope: task.query.progress_scope || null,
    exact_match: task.query.exact_match !== false,
    lane: task.lane,
    priority: task.priority,
    starforce_min: task.query.starforce_min,
    starforce_max: task.query.starforce_max,
    price_min_meso: task.query.price_min_meso ?? null,
    price_max_meso: task.query.price_max_meso ?? null,
    item_category_filter: task.query.item_category_filter ?? null,
    equipment_subcategory_filter: task.query.equipment_subcategory_filter ?? null,
    result_category_path_filter: task.query.result_category_path_filter ?? null,
    potential_filter: task.query.potential_filter,
    page_sweep: task.query.page_sweep || null,
    logical_lanes: task.query.logical_lanes,
    selection_channels: task.query.selection_channels,
    post_classify_profiles: task.query.post_classify_profiles
  };
}

function publicQuota(state) {
  return {
    day_key: state.day_key,
    quota_session_id: currentQuotaSessionId(state),
    quota_session_ordinal: Number(state.quota_session?.ordinal || 1),
    normal_reserved: state.quota.normal_reserved,
    reserve_reserved: state.quota.reserve_reserved,
    reserve_recovery_reserved: Number(state.quota.reserve_recovery_reserved || 0),
    reserve_borrowed_for_normal: Number(state.quota.reserve_borrowed_for_normal || 0),
    total_reserved: state.quota.total_reserved,
    hard_limit: HARD_QUERY_LIMIT,
    site_search_usage: state.site_search_usage
  };
}

function assertSearchContext(searchContext, job, pageLimit) {
  if (!queryMatchesSearchContext(searchContext, publicAuctionQuery(job.task.query), {
    page: job.page,
    limit: pageLimit
  })) {
    throw new Error("판매 완료·장비 검색어·페이지 조건이 적용되지 않아 저장을 중단했습니다.");
  }
}

function stopAfterFirstPage(result) {
  if (result.decision.action !== "continue") return result;
  return {
    state: {
      ...result.state,
      done: true,
      stop_reason: "single_page_only"
    },
    decision: {
      ...result.decision,
      action: "stop",
      reason: "single_page_only",
      next_page: null,
      commit_page: result.decision.commit_page
    }
  };
}

function applyCollectionPaginationPolicy(job, result) {
  const sweep = job.task.query.page_sweep;
  if (sweep?.enabled !== true) return stopAfterFirstPage(result);
  const resultCap = Math.max(1, Number(sweep.result_cap || Number.POSITIVE_INFINITY));
  const effectiveLimit = Math.max(1, Number(result.state?.effective_page_limit || REQUESTED_PAGE_LIMIT));
  const maxPages = Math.min(
    Math.max(1, Number(sweep.max_pages || 1)),
    Number.isFinite(resultCap) ? Math.ceil(resultCap / effectiveLimit) : Number.POSITIVE_INFINITY
  );
  const capReached = Number(result.state?.committed_rows || 0) >= resultCap;
  if (capReached) {
    return {
      state: { ...result.state, done: true, stop_reason: "result_cap_reached" },
      decision: {
        ...result.decision,
        action: "stop",
        reason: "result_cap_reached",
        next_page: null,
        commit_page: result.decision.commit_page
      }
    };
  }
  if (result.decision.action !== "continue" || job.page < maxPages) return result;
  return {
    state: {
      ...result.state,
      done: true,
      stop_reason: "result_cap_reached"
    },
    decision: {
      ...result.decision,
      action: "stop",
      reason: "result_cap_reached",
      next_page: null,
      commit_page: result.decision.commit_page
    }
  };
}

function pageSweepCompleted(job, captureRecord, paginationResult) {
  const sourceRowCount = Number(
    captureRecord.document.capture?.collection_summary?.page_rows || 0
  );
  if (job.task.query.page_sweep?.enabled !== true) {
    return job.page === 1 && paginationResult.decision.commit_page === true &&
      sourceRowCount > 0;
  }
  if (job.page === 1 && sourceRowCount === 0) return false;
  return paginationResult.decision.action === "stop";
}

function synchronizeSiteUsage(state, usage) {
  if (!usage || usage.limit !== HARD_QUERY_LIMIT || !Number.isInteger(usage.used)) return state;
  const used = Math.max(0, Math.min(HARD_QUERY_LIMIT, usage.used));
  const previous = currentSessionSiteUsage(state);
  if (previous && used < previous.used) return state;
  const quota = reconcileObservedQuota(state.quota, used);
  const observedAt = new Date().toISOString();
  return {
    ...state,
    quota,
    quota_session: {
      ...(state.quota_session || {}),
      last_site_used: Math.max(Number(state.quota_session?.last_site_used || 0), used),
      last_observed_at: observedAt
    },
    site_search_usage: tagSiteUsageForCurrentSession(state, usage, observedAt)
  };
}

async function refreshSiteSearchUsage() {
  let usage = await readSiteSearchUsageFromAuction();
  diagnosticUsageUnconfirmed = false;
  let previous = currentSessionSiteUsage(collectorState);
  let rebaseObservation = quotaRebaseObservation(collectorState, previous, usage);
  let sessionChanged = false;
  if (
    rebaseObservation.required &&
    !canAutomaticallyRebaseQuotaSession(
      collectorState,
      rebaseObservation.previous_used,
      usage.used
    )
  ) {
    await delay(QUOTA_SWITCH_RECENT_REQUEST_GUARD_MS);
    usage = await readSiteSearchUsageFromAuction();
    previous = currentSessionSiteUsage(collectorState);
    rebaseObservation = quotaRebaseObservation(collectorState, previous, usage);
  }
  if (rebaseObservation.required) {
    if (!canAutomaticallyRebaseQuotaSession(
      collectorState,
      rebaseObservation.previous_used,
      usage.used
    )) {
      throw new Error("검색 횟수가 낮아졌지만 이전 요청 정리가 끝나지 않아 새 검색을 시작하지 않습니다. 잠시 뒤 다시 이어서 수집해 주세요.");
    }
    const confirmed = await confirmStableSiteSearchUsage(usage);
    if (!confirmed) {
      throw new Error("검색 횟수가 낮아졌지만 표시값이 안정되지 않아 새 검색을 시작하지 않습니다. 잠시 뒤 다시 이어서 수집해 주세요.");
    }
    const rebased = rebaseQuotaSession(collectorState, confirmed.used, {
      now: Date.now(),
      confirmed: true,
      force: rebaseObservation.legacy_mismatch,
      switch_reason: "counter_decreased"
    });
    if (!rebased.ok || !rebased.rebased) {
      throw new Error("새 계정의 검색 한도를 안전하게 분리하지 못해 수집을 중단했습니다. 새 계정 동기화를 눌러 다시 확인해 주세요.");
    }
    collectorState = ensureApplicationState({
      ...rebased.state,
      run_status: collectionRunning ? "running" : "paused",
      last_error: null
    });
    usage = confirmed;
    sessionChanged = true;
    appendLog(
      `새 계정 검색 한도 ${usage.used} / ${usage.limit}을 확인했습니다. 완료된 수집 기록은 유지하고 다음 미완료 작업부터 이어갑니다.`,
      "success"
    );
  }
  transientSiteSearchUsage = tagSiteUsageForCurrentSession(collectorState, usage);
  if (sessionChanged) {
    collectorState = {
      ...collectorState,
      site_search_usage: tagSiteUsageForCurrentSession(collectorState, usage)
    };
  } else {
    collectorState = synchronizeSiteUsage(collectorState, usage);
  }
  await saveCollectorState(collectorState);
  renderState();
  return collectorState.site_search_usage;
}

function quotaRebaseObservation(state, previous, usage) {
  const legacyMismatch = state.quota_session?.switch_reason === "legacy_state" &&
    state.quota.total_reserved - usage.used >= 2;
  const counterDecreased = Boolean(previous && usage.used < previous.used);
  return {
    required: legacyMismatch || counterDecreased,
    legacy_mismatch: legacyMismatch,
    previous_used: legacyMismatch ? state.quota.total_reserved : Number(previous?.used || usage.used)
  };
}

async function synchronizeNewAccountQuota() {
  if (
    quotaSyncRunning || collectionRunning || diagnosticRunning || startPending || progressResetRunning ||
    extensionContextInvalidated || foreignLeaseActiveInView
  ) return;

  quotaSyncRunning = true;
  let syncLeaseAcquired = false;
  setQuotaSyncControls(true);
  showStatus("현재 로그인한 계정의 검색 횟수를 확인합니다.");
  try {
    await verifyAuctionTab();
    await acquireLease();
    syncLeaseAcquired = true;
    collectorState = await recoverInterruptedJob(collectorState);
    const first = await readSiteSearchUsageFromAuction();
    const usage = await confirmStableSiteSearchUsage(first);
    if (!usage) {
      throw new Error("검색 횟수가 갱신 중입니다. 잠시 뒤 다시 동기화해 주세요.");
    }
    const rebased = rebaseQuotaSession(collectorState, usage.used, {
      now: Date.now(),
      force: true,
      switch_reason: "manual_account_switch"
    });
    if (!rebased.ok) {
      throw new Error(rebased.reason === "active_attempt_present"
        ? "완료되지 않은 검색 요청이 있어 새 계정 한도를 적용할 수 없습니다. 수집을 한 번 재개해 복구한 뒤 다시 시도해 주세요."
        : `새 계정 한도를 적용하지 못했습니다: ${rebased.reason}`);
    }
    collectorState = ensureApplicationState({
      ...rebased.state,
      run_status: "paused",
      last_error: null,
      site_search_usage: tagSiteUsageForCurrentSession(rebased.state, usage)
    });
    transientSiteSearchUsage = tagSiteUsageForCurrentSession(collectorState, usage);
    showStatus(
      `새 계정의 ${usage.used} / ${usage.limit} 기준으로 동기화했습니다. 저장된 매물과 완료 작업은 그대로 유지됩니다.`,
      "success"
    );
  } catch (error) {
    if (!markExtensionContextInvalidated(error)) showStatus(error.message, "error");
  } finally {
    if (syncLeaseAcquired && leaseHeld) {
      await releaseOwnedLeaseAndSave(collectorState).catch((error) => {
        if (!isExtensionContextInvalidatedError(error)) console.error(error);
      });
    }
    quotaSyncRunning = false;
    if (!extensionContextInvalidated) {
      setRunControls(false);
      renderState();
    }
  }
}

async function confirmStableSiteSearchUsage(firstUsage) {
  let expected = firstUsage;
  if (!validSiteSearchUsage(expected)) return null;
  for (let index = 1; index < QUOTA_SWITCH_CONFIRMATION_READS; index += 1) {
    await delay(QUOTA_SWITCH_CONFIRMATION_INTERVAL_MS);
    const observed = await readSiteSearchUsageFromAuction();
    if (!validSiteSearchUsage(observed) || observed.used !== expected.used || observed.limit !== expected.limit) {
      return null;
    }
    expected = observed;
  }
  return expected;
}

function validSiteSearchUsage(usage) {
  return usage?.limit === HARD_QUERY_LIMIT && Number.isInteger(usage.used) &&
    usage.used >= 0 && usage.used <= usage.limit;
}

function currentQuotaSessionId(state) {
  return state?.quota_session?.id || null;
}

function currentSessionSiteUsage(state) {
  const usage = state?.site_search_usage;
  if (!validSiteSearchUsage(usage) || usage.day_key !== state.day_key) return null;
  const currentSessionId = currentQuotaSessionId(state);
  if (usage.quota_session_id && currentSessionId && usage.quota_session_id !== currentSessionId) return null;
  return usage;
}

function tagSiteUsageForCurrentSession(state, usage, observedAt = new Date().toISOString()) {
  return {
    ...usage,
    observed_at: observedAt,
    day_key: state.day_key,
    quota_session_id: currentQuotaSessionId(state)
  };
}

function canAutomaticallyRebaseQuotaSession(state, previousUsed, observedUsed) {
  if (state.active_job) return false;
  const currentSessionId = currentQuotaSessionId(state);
  const attempts = Object.values(state.attempts || {}).filter((attempt) =>
    attempt.quota_session_id
      ? !currentSessionId || attempt.quota_session_id === currentSessionId
      : Number(state.quota_session?.ordinal || 1) === 1 && attempt.day_key === state.day_key
  );
  if (attempts.some((attempt) => attempt.phase !== "committed")) return false;
  const latestRequestAt = attempts.reduce((latest, attempt) => {
    const timestamp = Date.parse(attempt.requested_at || attempt.committed_at || "");
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, 0);
  const largeDrop = previousUsed - observedUsed >= 2;
  return largeDrop || latestRequestAt === 0 || Date.now() - latestRequestAt >= QUOTA_SWITCH_RECENT_REQUEST_GUARD_MS;
}

async function readSiteSearchUsageFromAuction() {
  const deadline = Date.now() + 5_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await sendToAuction({ type: "MAPLE_AUCTION_READ_SEARCH_USAGE" });
      if (!response?.ok) throw new Error(response?.error || "경매장 검색 횟수를 읽지 못했습니다.");
      const usage = response.usage;
      if (usage?.limit === HARD_QUERY_LIMIT && Number.isInteger(usage.used)) {
        return { used: usage.used, limit: usage.limit };
      }
      lastError = new Error("경매장 상단의 '검색 횟수 n / 100' 표시를 찾지 못했습니다.");
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) throw error;
      lastError = error;
    }
    await delay(200);
  }
  throw lastError || new Error("경매장 검색 횟수를 읽지 못했습니다.");
}

function compactAttempts(state) {
  const entries = Object.entries(state.attempts || {}).sort((left, right) =>
    String(right[1]?.reserved_at || "").localeCompare(String(left[1]?.reserved_at || ""))
  );
  return { ...state, attempts: Object.fromEntries(entries.slice(0, 220)) };
}

function starforceBandIdForRecord(record, query) {
  const raw = record?.item?.starforce;
  const value = Number.isInteger(raw) ? raw : Number.isInteger(raw?.value) ? raw.value : null;
  const observedBand = starforceBandForValue(value);
  return observedBand;
}

function profileChannel(profileId) {
  return ({
    MAIN_STAT: "main",
    ALL_STAT: "allstat",
    MAX_HP: "hp",
    XENON_MIXED: "allstat",
    HAT_COOLDOWN: "hat",
    GLOVE_CRITICAL_DAMAGE: "glove",
    ACCESSORY_DROP_MESO: "accessory",
    MITRA_OPTIMAL: "mitra"
  })[profileId] || null;
}

function auditServerFilter(items, query) {
  const filter = query.potential_filter;
  if (!filter) return null;
  let passed = 0;
  let failed = 0;
  for (const record of items) {
    const totals = record.profile_classification?.totals?.percent || {};
    let value = null;
    if (/_PCT$/u.test(filter.capability_id)) {
      const stat = filter.capability_id.replace(/_PCT$/u, "");
      value = Number(totals[stat] || 0);
      if (["STR", "DEX", "INT", "LUK"].includes(stat)) {
        value += Number(totals.ALL_STAT || 0);
      }
    }
    if (value != null && value >= filter.minimum) passed += 1;
    else failed += 1;
  }
  return {
    capability_id: filter.capability_id,
    auction_code: filter.auction_code,
    minimum: filter.minimum,
    maximum: filter.maximum ?? null,
    evidence_status_before: filter.evidence_status,
    passed_count: passed,
    failed_count: failed,
    status: items.length === 0 ? "inconclusive_empty" : failed === 0 ? "observed_compatible" : "observed_mismatch"
  };
}

function updateFilterAudits(previous, audit) {
  if (!audit) return previous || {};
  const current = previous?.[audit.capability_id] || {};
  return {
    ...(previous || {}),
    [audit.capability_id]: {
      capability_id: audit.capability_id,
      auction_code: audit.auction_code,
      passed_count: Number(current.passed_count || 0) + audit.passed_count,
      failed_count: Number(current.failed_count || 0) + audit.failed_count,
      status: current.status === "observed_mismatch" || audit.status === "observed_mismatch"
        ? "observed_mismatch"
        : audit.status,
      last_observed_at: new Date().toISOString()
    }
  };
}

function listingIdentity(item) {
  if (item.listing?.listing_id && item.listing.listing_id_source === "native") {
    return `native:${item.listing.listing_id}`;
  }
  return item.listing?.listing_fingerprint ? `fingerprint:${item.listing.listing_fingerprint}` : null;
}

async function commitPageAndState(pageRecord, nextState) {
  const persistedState = await persistOwnedStateCas(nextState, { pageRecord });
  await mirrorCheckpointSafely(persistedState);
}

async function saveReceivedPageAndState(pageRecord, nextState) {
  const persistedState = await persistOwnedStateCas(nextState, {
    pageRecord: { ...pageRecord, file_status: "received" }
  });
  await mirrorCheckpointSafely(persistedState);
}

async function mirrorCheckpointSafely(state) {
  try {
    await mirrorCheckpoint(state);
  } catch (error) {
    markExtensionContextInvalidated(error);
    appendLog(`브라우저 체크포인트 미러 저장을 보류했습니다: ${error.message}`, "error");
  }
}

async function flushPendingCaptures() {
  const pending = await getPendingCaptureRecords();
  for (const record of pending) await flushCaptureRecord(record.page_capture_id);
  renderState();
  return pending.length;
}

async function flushCaptureRecord(pageCaptureId) {
  const record = await getPageCaptureRecord(pageCaptureId);
  if (!record || record.file_status === "flushed") return;
  if (!record.output_text) throw new Error(`원본 ${pageCaptureId}의 임시 내용이 없습니다.`);
  await ensureDirectoryWritePermission();
  const rawDirectory = directoryHandle.name.toLowerCase() === "raw"
    ? directoryHandle
    : await directoryHandle.getDirectoryHandle("raw", { create: true });
  let filename = record.filename;
  const existing = await getFileIfExists(rawDirectory, filename);
  if (existing) {
    const existingHash = await sha256Hex(await existing.text());
    if (existingHash !== record.file_sha256) {
      filename = record.filename.replace(/\.jsonl$/u, `_recovered_${crypto.randomUUID().slice(0, 8)}.jsonl`);
    }
  }
  if (!existing || filename !== record.filename) {
    const handle = await rawDirectory.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    try { await writable.write(record.output_text); } finally { await writable.close(); }
  }
  const database = await openDatabase();
  await transactionPromise(database, PAGE_STORE, "readwrite", (transaction) => {
    transaction.objectStore(PAGE_STORE).put({
      ...record,
      filename,
      relative_path: directoryHandle.name.toLowerCase() === "raw" ? filename : `raw/${filename}`,
      file_status: "flushed",
      flushed_at: new Date().toISOString(),
      document: null,
      output_text: null
    });
  });
}

async function flushCommittedCaptureSafely(pageCaptureId) {
  try {
    await flushCaptureRecord(pageCaptureId);
    return true;
  } catch (error) {
    markExtensionContextInvalidated(error);
    appendLog(`원본 파일 쓰기를 보류했습니다. '미저장 원본 확인'에서 다시 저장할 수 있습니다: ${error.message}`, "error");
    return false;
  }
}

async function flushPendingFromButton() {
  try {
    await ensureDirectoryWritePermission();
    const count = await flushPendingCaptures();
    showStatus(count ? `${count}개 원본을 저장했습니다.` : "미저장 원본이 없습니다.", "success");
  } catch (error) {
    if (!markExtensionContextInvalidated(error)) showStatus(error.message, "error");
  }
}

async function exportCollectorState() {
  try {
    await ensureDirectoryWritePermission();
    const root = directoryHandle;
    const directory = await root.getDirectoryHandle("manifests", { create: true });
    const now = new Date();
    const filename = `maple-auction_collector-state_${formatLocalTimestamp(now)}_${crypto.randomUUID().slice(0, 8)}.json`;
    const handle = await directory.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    const exported = {
      schema_version: "maple-auction.collector-export.v1",
      exported_at: isoWithLocalOffset(now),
      catalog_version: CATALOG_VERSION,
      state: { ...collectorState, lease: null, active_job: null }
    };
    try { await writable.write(`${JSON.stringify(exported, null, 2)}\n`); } finally { await writable.close(); }
    showStatus(`진행 상태를 manifests/${filename}에 저장했습니다.`, "success");
  } catch (error) {
    if (!markExtensionContextInvalidated(error)) showStatus(error.message, "error");
  }
}

async function acquireLease() {
  if (leaseHeld || activeLeaseId) {
    throw new Error("이 관리자 창이 이미 수집 실행 잠금을 보유하고 있습니다.");
  }
  collectorState = await recoverOrphanedForeignLease(
    ensureApplicationState(rolloverCollectorState(await loadCollectorState() || collectorState))
  );
  const now = Date.now();
  const leaseId = crypto.randomUUID();
  const database = await openDatabase();
  collectorState = await new Promise((resolve, reject) => {
    const transaction = database.transaction(STATE_STORE, "readwrite");
    const store = transaction.objectStore(STATE_STORE);
    const request = store.get(STATE_KEY);
    let acquired = null;
    let conflict = false;
    request.onsuccess = () => {
      const latest = ensureApplicationState(rolloverCollectorState(request.result || collectorState));
      const lease = latest.lease;
      if (hasActiveForeignLease(latest, now)) {
        conflict = true;
        transaction.abort();
        return;
      }
      acquired = {
        ...latest,
        lease: {
          lease_id: leaseId,
          owner: managerId,
          extension_version: extensionVersion,
          manager_window_id: managerWindowId,
          expires_at: new Date(now + LEASE_DURATION_MS).toISOString()
        }
      };
      store.put(acquired, STATE_KEY);
    };
    transaction.oncomplete = () => resolve(acquired);
    transaction.onabort = () => reject(conflict
      ? createLeaseConflictError("다른 수집 관리자 창이 실행 중입니다.")
      : transaction.error || new Error("수집 실행 잠금을 얻지 못했습니다."));
    transaction.onerror = () => reject(transaction.error);
  });
  activeLeaseId = leaseId;
  leaseHeld = true;
  foreignLeaseActiveInView = false;
  scheduleLeaseHeartbeat();
  await mirrorCheckpoint(collectorState).catch(() => {});
}

async function recoverOrphanedForeignLease(state) {
  let next = discardStaleForeignLease(state);
  if (!hasActiveForeignLease(next)) return next;
  if (await isLeaseOwnerManagerAlive(next.lease)) return next;

  const orphan = next.lease;
  const database = await openDatabase();
  next = await new Promise((resolve, reject) => {
    const transaction = database.transaction(STATE_STORE, "readwrite");
    const store = transaction.objectStore(STATE_STORE);
    const request = store.get(STATE_KEY);
    let recovered = null;
    request.onsuccess = () => {
      const latestRaw = request.result || next;
      const sameLease = leaseIdentityMatches(latestRaw.lease, orphan);
      const recoveredRaw = sameLease ? { ...latestRaw, lease: null } : latestRaw;
      recovered = ensureApplicationState(rolloverCollectorState(recoveredRaw));
      if (sameLease) store.put(recoveredRaw, STATE_KEY);
    };
    transaction.oncomplete = () => resolve(recovered || next);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("남은 실행 잠금을 확인하지 못했습니다."));
  });
  return next;
}

async function isLeaseOwnerManagerAlive(lease) {
  const ownerWindowId = Number(lease?.manager_window_id);
  if (!Number.isInteger(ownerWindowId) || ownerWindowId < 0) return false;
  if (ownerWindowId === managerWindowId) return ownsActiveLease(lease);

  try {
    if (typeof chrome.runtime.getContexts === "function") {
      const managerUrl = chrome.runtime.getURL("manager.html");
      const contexts = await chrome.runtime.getContexts({ contextTypes: ["TAB"] });
      return contexts.some((context) =>
        context.windowId === ownerWindowId && String(context.documentUrl || "").startsWith(managerUrl)
      );
    }
    await chrome.windows.get(ownerWindowId);
    return true;
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) throw error;
    return false;
  }
}

function scheduleForeignLeaseRefresh() {
  if (foreignLeaseRefreshTimer) clearTimeout(foreignLeaseRefreshTimer);
  if (!foreignLeaseActiveInView || extensionContextInvalidated) return;
  foreignLeaseRefreshTimer = setTimeout(() => {
    foreignLeaseRefreshTimer = null;
    void refreshForeignLeaseState();
  }, 1_500);
}

async function refreshForeignLeaseState() {
  if (!foreignLeaseActiveInView || collectionRunning || diagnosticRunning || extensionContextInvalidated) return;
  try {
    const latest = ensureApplicationState(
      rolloverCollectorState(await loadCollectorState() || collectorState)
    );
    collectorState = await recoverOrphanedForeignLease(latest);
    foreignLeaseActiveInView = hasActiveForeignLease(collectorState);
    if (foreignLeaseActiveInView) {
      scheduleForeignLeaseRefresh();
      return;
    }
    elements.targetBadge.textContent = "연결됨";
    elements.targetBadge.className = "badge ready";
    setRunControls(false);
    showStatus("이전 관리자 창의 실행 잠금이 해제되었습니다. 바로 시작할 수 있습니다.", "success");
    renderState();
  } catch (error) {
    if (markExtensionContextInvalidated(error)) return;
    scheduleForeignLeaseRefresh();
  }
}

function hasActiveForeignLease(state, now = Date.now()) {
  const lease = state?.lease;
  return Boolean(
    lease?.owner &&
    lease.extension_version === extensionVersion &&
    Date.parse(lease.expires_at || "") > now &&
    !ownsActiveLease(lease)
  );
}

function discardStaleForeignLease(state, now = Date.now()) {
  const lease = state?.lease;
  if (!lease) return state;
  if (lease.extension_version !== extensionVersion || Date.parse(lease.expires_at || "") <= now) {
    return { ...state, lease: null };
  }
  return state;
}

function leaseIdentityMatches(left, right) {
  if (!left || !right) return false;
  if (left.lease_id || right.lease_id) {
    return Boolean(left.lease_id) && left.lease_id === right.lease_id &&
      left.owner === right.owner && left.extension_version === right.extension_version;
  }
  return left.owner === right.owner &&
    left.extension_version === right.extension_version &&
    left.manager_window_id === right.manager_window_id &&
    left.expires_at === right.expires_at;
}

function ownsActiveLease(lease, leaseId = activeLeaseId) {
  return Boolean(
    leaseId && lease?.lease_id === leaseId && lease.owner === managerId &&
    lease.extension_version === extensionVersion
  );
}

function renewedLeaseRecord(lease, now = Date.now()) {
  return {
    ...lease,
    manager_window_id: managerWindowId,
    expires_at: new Date(now + LEASE_DURATION_MS).toISOString()
  };
}

function createLeaseConflictError(message = "수집 실행 잠금을 더 이상 보유하고 있지 않습니다.") {
  const error = new Error(message);
  error.code = "lease_conflict";
  return error;
}

function isLeaseConflictError(error) {
  return error?.code === "lease_conflict" || /수집 관리자 창|실행 잠금/u.test(String(error?.message || ""));
}

function stopLeaseHeartbeat() {
  if (leaseHeartbeatTimer) clearTimeout(leaseHeartbeatTimer);
  leaseHeartbeatTimer = null;
}

function scheduleLeaseHeartbeat() {
  stopLeaseHeartbeat();
  if (!leaseHeld || !activeLeaseId || extensionContextInvalidated) return;
  leaseHeartbeatTimer = setTimeout(() => {
    leaseHeartbeatTimer = null;
    void runLeaseHeartbeat();
  }, LEASE_HEARTBEAT_INTERVAL_MS);
}

async function runLeaseHeartbeat() {
  if (leaseHeartbeatRunning || !leaseHeld || !activeLeaseId || extensionContextInvalidated) return;
  const expectedLeaseId = activeLeaseId;
  leaseHeartbeatRunning = true;
  try {
    const renewedLease = await renewOwnedLeaseCas(expectedLeaseId);
    if (activeLeaseId === expectedLeaseId && collectorState) {
      collectorState = { ...collectorState, lease: renewedLease };
    }
  } catch (error) {
    if (activeLeaseId === expectedLeaseId) markOwnedLeaseLost(expectedLeaseId, error);
  } finally {
    leaseHeartbeatRunning = false;
    if (activeLeaseId === expectedLeaseId) scheduleLeaseHeartbeat();
  }
}

async function renewOwnedLeaseCas(expectedLeaseId) {
  const database = await openDatabase();
  let renewedLease = null;
  let conflict = false;
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STATE_STORE, "readwrite");
    const store = transaction.objectStore(STATE_STORE);
    const request = store.get(STATE_KEY);
    request.onsuccess = () => {
      const latest = request.result
        ? ensureApplicationState(rolloverCollectorState(request.result))
        : null;
      if (!ownsActiveLease(latest?.lease, expectedLeaseId)) {
        conflict = true;
        transaction.abort();
        return;
      }
      renewedLease = renewedLeaseRecord(latest.lease);
      store.put({ ...latest, lease: renewedLease }, STATE_KEY);
    };
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(conflict
      ? createLeaseConflictError()
      : transaction.error || new Error("수집 실행 잠금을 갱신하지 못했습니다."));
    transaction.onerror = () => {
      if (!conflict) reject(transaction.error);
    };
  });
  return renewedLease;
}

function markOwnedLeaseLost(expectedLeaseId, error) {
  if (activeLeaseId !== expectedLeaseId) return;
  stopLeaseHeartbeat();
  activeLeaseId = null;
  leaseHeld = false;
  pauseRequested = true;
  if (collectorState) collectorState = { ...collectorState, lease: null };
  if (!extensionContextInvalidated) {
    elements.targetBadge.textContent = "실행 잠금 상실";
    elements.targetBadge.className = "badge error";
    showStatus(error?.message || "다른 관리자 창이 실행 권한을 가져가 수집을 중단합니다.", "error");
  }
}

async function releaseOwnedLeaseAndSave(nextState = collectorState) {
  const expectedLeaseId = activeLeaseId;
  if (!leaseHeld || !expectedLeaseId) throw createLeaseConflictError();
  stopLeaseHeartbeat();
  const database = await openDatabase();
  let persistedState = nextState;
  let released = false;
  let conflict = false;
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STATE_STORE, "readwrite");
      const store = transaction.objectStore(STATE_STORE);
      const request = store.get(STATE_KEY);
      request.onsuccess = () => {
        const latest = request.result
          ? ensureApplicationState(rolloverCollectorState(request.result))
          : null;
        if (!ownsActiveLease(latest?.lease, expectedLeaseId)) {
          conflict = true;
          persistedState = latest || nextState;
          transaction.abort();
          return;
        }
        persistedState = { ...nextState, lease: null };
        store.put(persistedState, STATE_KEY);
        released = true;
      };
      transaction.oncomplete = resolve;
      transaction.onerror = () => {
        if (!conflict) reject(transaction.error);
      };
      transaction.onabort = () => reject(conflict
        ? createLeaseConflictError()
        : transaction.error || new Error("실행 잠금을 해제하지 못했습니다."));
    });
  } catch (error) {
    markOwnedLeaseLost(expectedLeaseId, error);
    throw error;
  }
  collectorState = persistedState;
  activeLeaseId = null;
  leaseHeld = false;
  if (released) await mirrorCheckpoint(persistedState).catch(() => {});
}

function requestPause() {
  pauseRequested = true;
  elements.pauseButton.disabled = true;
  showStatus("현재 검색의 남은 페이지를 안전하게 저장한 뒤 일시정지합니다.");
}

function handleBeforeUnload() {
  pauseRequested = true;
  if (foreignLeaseRefreshTimer) clearTimeout(foreignLeaseRefreshTimer);
  stopNetworkDiagnosticPoll();
  stopLeaseHeartbeat();
  if (ownsActiveLease(collectorState?.lease)) {
    if (collectionRunning) collectorState.run_status = "paused";
    void shutdownOwnedSession().catch(() => {});
  }
}

async function shutdownOwnedSession() {
  if (activeDiagnosticId) await abortAuctionDiagnostic(activeDiagnosticId);
  if (collectionRunning || leaseHeld) await cleanupAuctionPage();
  if (ownsActiveLease(collectorState?.lease)) {
    await releaseOwnedLeaseAndSave(collectorState);
  }
}

function handleUnhandledRejection(event) {
  if (markExtensionContextInvalidated(event.reason)) {
    event.preventDefault();
  }
}

function handleUnexpectedAsyncError(error) {
  if (markExtensionContextInvalidated(error)) return;
  console.error(error);
  showStatus(error?.message || "예상하지 못한 오류가 발생했습니다.", "error");
}

function isExtensionContextInvalidatedError(error) {
  const message = String(error?.message || error || "");
  if (/Extension context invalidated/iu.test(message)) return true;
  try {
    return !globalThis.chrome?.runtime?.id;
  } catch (_error) {
    return true;
  }
}

function markExtensionContextInvalidated(error) {
  if (!isExtensionContextInvalidatedError(error)) return false;
  if (extensionContextInvalidated) return true;
  extensionContextInvalidated = true;
  stopNetworkDiagnosticPoll();
  stopLeaseHeartbeat();
  collectionRunning = false;
  startPending = false;
  networkDiagnosticRunning = false;
  pauseRequested = true;
  elements.targetBadge.textContent = "다시 열기 필요";
  elements.targetBadge.className = "badge error";
  elements.chooseFolderButton.disabled = true;
  elements.startButton.disabled = true;
  elements.pauseButton.disabled = true;
  elements.flushButton.disabled = true;
  elements.exportStateButton.disabled = true;
  elements.diagnosticButton.disabled = true;
  elements.copyDiagnosticButton.disabled = true;
  elements.accountSyncButton.disabled = true;
  elements.resetCollectionProgressButton.disabled = true;
  elements.includeFailedTasksCheckbox.disabled = true;
  elements.networkDiagnosticButton.disabled = true;
  elements.copyNetworkDiagnosticButton.disabled = true;
  showStatus("확장 프로그램이 새로고침되었습니다. 이 관리자 창을 새로고침하거나 닫고 경매장 탭에서 다시 열어 주세요.", "error");
  return true;
}

function renderState() {
  if (!collectorState) return;
  const state = ensureApplicationState(rolloverCollectorState(collectorState));
  collectorState = state;
  const total = state.quota.total_reserved;
  const currentSessionId = currentQuotaSessionId(state);
  const persistedUsage = currentSessionSiteUsage(state);
  const transientUsage = transientSiteSearchUsage?.day_key === state.day_key &&
    transientSiteSearchUsage?.limit === HARD_QUERY_LIMIT &&
    (!transientSiteSearchUsage.quota_session_id || !currentSessionId ||
      transientSiteSearchUsage.quota_session_id === currentSessionId)
    ? transientSiteSearchUsage
    : null;
  const observedUsage = transientUsage && (!persistedUsage || transientUsage.used >= persistedUsage.used)
    ? transientUsage
    : persistedUsage;
  const displayedTotal = Math.max(observedUsage?.used || 0, total);
  const displayedQuota = reconcileObservedQuota(state.quota, displayedTotal);
  const displayedNormal = displayedQuota.normal_reserved;
  const displayedReserve = displayedQuota.reserve_reserved;
  const borrowedForNormal = Math.min(
    displayedReserve,
    Number(displayedQuota.reserve_borrowed_for_normal || 0)
  );
  const recoveryUsed = Math.min(
    displayedReserve - borrowedForNormal,
    Number(displayedQuota.reserve_recovery_reserved || 0)
  );
  const sessionOrdinal = Number(state.quota_session?.ordinal || 1);
  elements.dailyBadge.textContent = `${state.day_key} · 세션 ${sessionOrdinal}`;
  elements.quotaCount.textContent = `${displayedTotal} / ${HARD_QUERY_LIMIT}`;
  elements.normalQuota.textContent = `일반 ${displayedNormal} / ${NORMAL_QUERY_LIMIT}`;
  elements.reserveQuota.textContent = `예비 ${displayedReserve} / 2 (복구 ${recoveryUsed} · 추가 ${borrowedForNormal})`;
  elements.quotaBar.style.width = `${Math.min(100, displayedTotal)}%`;
  const calibration = state.page_limit_calibration;
  elements.pageLimitValue.textContent = calibration.status === "confirmed_60"
    ? "60 · 확인됨"
    : "60 · 검색 전 확인";
  elements.totalPageCount.textContent = `${state.totals.pages}페이지`;
  const queryProgress = catalogQueryProgress(state);
  elements.queryCount.textContent = `${queryProgress.completed} / ${queryProgress.total}개`;
  renderCatalogEquipmentProgress(queryProgress.equipment);
  updateFailedTasksOptionAppearance();
  elements.startButton.textContent = queryProgress.completed > 0 || state.run_status === "paused" ? "수집 계속" : "수집 시작";
  if (!collectionRunning && !diagnosticRunning && !quotaSyncRunning && !progressResetRunning) {
    elements.startButton.disabled = foreignLeaseActiveInView || extensionContextInvalidated;
    elements.diagnosticButton.disabled = diagnosticBlockedByUsage() ||
      foreignLeaseActiveInView || extensionContextInvalidated;
    elements.accountSyncButton.disabled = quotaSyncRunning || foreignLeaseActiveInView || extensionContextInvalidated;
    elements.resetCollectionProgressButton.disabled = foreignLeaseActiveInView || extensionContextInvalidated;
  }
  if (!collectionRunning && !diagnosticRunning && !diagnosticStatusPinned && !foreignLeaseActiveInView && state.last_error) {
    showStatus(state.last_error, "error");
  }
}

function catalogQueryProgress(state) {
  const equipment = summarizeEquipmentQueryProgress(
    physicalQueries,
    fixedTasks,
    state?.query_stats || {},
    { today: toKstDateKey(), catalog_items: CATALOG_ITEMS }
  );
  return {
    completed: equipment.completed_queries,
    deferred: equipment.deferred_queries,
    total: equipment.total_queries,
    equipment
  };
}

function deferredFailureQueryIds(state, today = toKstDateKey()) {
  const queryIds = new Set();
  for (const entry of state?.retries || []) {
    const queryId = entry?.task?.query?.query_id;
    if (
      queryId && entry.next_eligible_date > today &&
      inferNextEligibleReason(entry) === "failure"
    ) {
      queryIds.add(queryId);
    }
  }
  for (const task of fixedTasks) {
    const stats = state?.query_stats?.[task.id] || {};
    if (
      stats.next_eligible_date > today &&
      inferNextEligibleReason(stats) === "failure" &&
      !isPhysicalQueryComplete(task.query, stats)
    ) {
      queryIds.add(task.query.query_id);
    }
  }
  return queryIds;
}

function updateFailedTasksOptionAppearance() {
  if (!elements.includeFailedTasksCheckbox || !elements.includeFailedTasksOption) return;
  const count = collectorState ? deferredFailureQueryIds(collectorState).size : 0;
  const busy = collectionRunning || startPending || diagnosticRunning || quotaSyncRunning ||
    progressResetRunning || foreignLeaseActiveInView || extensionContextInvalidated;
  if (count === 0 && !collectionRunning && !startPending) {
    elements.includeFailedTasksCheckbox.checked = false;
  }
  elements.deferredFailureCount.textContent = `${count}개`;
  elements.includeFailedTasksCheckbox.disabled = busy || count === 0;
  elements.includeFailedTasksOption.classList.toggle(
    "enabled",
    elements.includeFailedTasksCheckbox.checked && count > 0
  );
  elements.includeFailedTasksOption.classList.toggle("disabled", busy || count === 0);
}

function renderCatalogEquipmentProgress(progress) {
  if (!progress) return;
  elements.catalogProgressSummary.textContent =
    `완료 ${progress.completed_items} · 미완료 ${progress.incomplete_items}`;
  elements.completedEquipmentCount.textContent = `${progress.completed_items}종`;
  elements.incompleteEquipmentCount.textContent = `${progress.incomplete_items}종`;

  const signature = progress.items
    .map((item) => `${item.catalog_id}:${item.completed}:${item.deferred}`)
    .join("|");
  if (signature === lastCatalogProgressSignature) return;
  lastCatalogProgressSignature = signature;

  renderCatalogEquipmentList(
    elements.completedEquipmentList,
    progress.items.filter((item) => item.status === "completed"),
    "아직 완료된 장비가 없습니다."
  );
  renderCatalogEquipmentList(
    elements.incompleteEquipmentList,
    progress.items.filter((item) => item.status === "incomplete"),
    "모든 장비 조사가 완료되었습니다."
  );
}

function renderCatalogEquipmentList(list, items, emptyMessage) {
  const previousScrollTop = list.scrollTop;
  if (items.length === 0) {
    const empty = document.createElement("li");
    empty.className = "catalog-equipment-empty";
    empty.textContent = emptyMessage;
    list.replaceChildren(empty);
    return;
  }

  const rows = items.map((item) => {
    const row = document.createElement("li");
    row.className = "catalog-equipment-item";
    row.title = `${item.name} · 검색 ${item.completed} / ${item.total}`;

    const main = document.createElement("div");
    main.className = "catalog-equipment-main";
    const name = document.createElement("span");
    name.className = "catalog-equipment-name";
    name.textContent = item.name;
    const priority = document.createElement("span");
    priority.className = "catalog-equipment-priority";
    priority.textContent = item.priority || "";
    main.append(name, priority);

    const meta = document.createElement("div");
    meta.className = "catalog-equipment-meta";
    if (item.status === "completed") {
      meta.textContent = `검색 ${item.total}개 완료`;
    } else {
      meta.textContent = `검색 ${item.completed} / ${item.total} · ${item.remaining}개 남음` +
        (item.deferred > 0 ? ` · 재확인 대기 ${item.deferred}` : "");
    }
    row.append(main, meta);
    return row;
  });
  list.replaceChildren(...rows);
  list.scrollTop = Math.max(0, Math.min(previousScrollTop, list.scrollHeight - list.clientHeight));
}

function renderCurrentJob(job) {
  elements.currentJob.textContent = taskDisplayName(job.task);
  const conditions = describeFilterConditions(job.task.query);
  const grouped = job.task.query.exact_match === false
    ? ["global_accessory_potential", "global_category_potential"].includes(job.task.query.group)
      ? " · 전체 결과 후분류"
      : ` · ${job.task.query.search_scope === "catalog_global" ? "카탈로그 " : ""}${job.task.allowed_names.length}종 후분류`
    : "";
  elements.currentJobDetail.textContent = `${conditions}${grouped} · ${job.page}페이지 · ${job.task.priority}`;
}

function taskDisplayName(task) {
  return String(task?.display_name || task?.query?.display_name || task?.keyword || "전체 장비");
}

function setRunControls(running) {
  const exclusiveBusy = running || diagnosticRunning || quotaSyncRunning || progressResetRunning;
  elements.chooseFolderButton.disabled = exclusiveBusy;
  elements.startButton.disabled = exclusiveBusy || foreignLeaseActiveInView || extensionContextInvalidated;
  elements.pauseButton.disabled = !running;
  elements.flushButton.disabled = exclusiveBusy;
  elements.exportStateButton.disabled = exclusiveBusy;
  elements.diagnosticButton.disabled = exclusiveBusy || diagnosticBlockedByUsage() ||
    foreignLeaseActiveInView || extensionContextInvalidated;
  elements.accountSyncButton.disabled = exclusiveBusy || quotaSyncRunning ||
    foreignLeaseActiveInView || extensionContextInvalidated;
  elements.resetCollectionProgressButton.disabled = exclusiveBusy ||
    foreignLeaseActiveInView || extensionContextInvalidated;
  elements.networkDiagnosticButton.disabled = extensionContextInvalidated || Boolean(networkDiagnosticTransition);
  if (extensionContextInvalidated) elements.copyNetworkDiagnosticButton.disabled = true;
  updateFailedTasksOptionAppearance();
}

function diagnosticBlockedByUsage() {
  const sessionId = currentQuotaSessionId(collectorState);
  const persisted = currentSessionSiteUsage(collectorState);
  const transient = transientSiteSearchUsage?.day_key === collectorState?.day_key &&
    (!transientSiteSearchUsage.quota_session_id || !sessionId ||
      transientSiteSearchUsage.quota_session_id === sessionId)
    ? transientSiteSearchUsage
    : null;
  const used = Math.max(Number(persisted?.used || 0), Number(transient?.used || 0));
  return diagnosticUsageUnconfirmed || used >= HARD_QUERY_LIMIT;
}

function resetProgress() {
  elements.progressTitle.textContent = "준비 중";
  progressCount("0 / 0");
  elements.progressBar.style.width = "0%";
  elements.log.replaceChildren();
}

function updateProgress(completed, total, title) {
  elements.progressTitle.textContent = title;
  progressCount(`${completed} / ${total}`);
  elements.progressBar.style.width = `${total ? completed / total * 100 : 0}%`;
}

function progressCount(value) { elements.progressCount.textContent = value; }
function showStatus(message, type = "") {
  elements.status.textContent = message;
  elements.status.className = `status${type ? ` ${type}` : ""}`;
}
function appendLog(message, type = "") {
  const item = document.createElement("li");
  item.textContent = message;
  item.className = type;
  elements.log.append(item);
  elements.log.scrollTop = elements.log.scrollHeight;
}

async function navigateAuctionUrl(url) {
  const targetUrl = new URL(url);
  await chrome.tabs.update(sourceTabId, { url: targetUrl.href, active: true });
  await chrome.windows.update(sourceWindowId, { focused: true });
  const deadline = Date.now() + ITEM_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(sourceTabId);
    if (
      tab.status === "complete" &&
      AUCTION_URL_PATTERN.test(tab.url || "") &&
      navigationReachedTarget(tab.url, targetUrl)
    ) {
      await delay(650);
      return;
    }
    await delay(180);
  }
  throw new Error("경매장 검색 페이지 이동 시간이 초과되었습니다.");
}

async function reloadAuctionResultPage({ query, page, limit, attemptId, previousDocumentToken }) {
  const before = await chrome.tabs.get(sourceTabId);
  const beforeUrl = new URL(before.url);
  const priceSearchKey = beforeUrl.searchParams.get("priceSearchKey") || null;
  if (!priceSearchKey) throw new Error("새로고침할 필터 검색 키가 없습니다.");
  await chrome.tabs.reload(sourceTabId);
  await chrome.windows.update(sourceWindowId, { focused: true });
  const deadline = Date.now() + ITEM_WAIT_TIMEOUT_MS;
  let reloadCompleted = false;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(sourceTabId);
    if (
      tab.status === "complete" &&
      AUCTION_URL_PATTERN.test(tab.url || "") &&
      new URL(tab.url).searchParams.get("priceSearchKey") === priceSearchKey
    ) {
      reloadCompleted = true;
      break;
    }
    await delay(180);
  }
  if (!reloadCompleted) throw new Error("경매장 결과 페이지 새로고침 시간이 초과되었습니다.");
  await waitForAppliedFilterSearch(query, {}, {
    page,
    limit,
    expectedPriceSearchKey: priceSearchKey
  });
  return waitForAuctionItems({
    requireFilterApplied: true,
    attemptId,
    expectedQuery: { ...query, page },
    previousDocumentToken: previousDocumentToken || null,
    previousPriceSearchKey: null,
    expectedPriceSearchKey: priceSearchKey
  });
}

function assertSearchUsageDidNotIncrease(expectedUsed, observedUsage) {
  if (
    !Number.isInteger(expectedUsed) ||
    !Number.isInteger(observedUsage?.used) ||
    observedUsage?.limit !== HARD_QUERY_LIMIT
  ) {
    throw new Error("결과 페이지 이동 전후의 경매장 검색 횟수를 확인하지 못했습니다.");
  }
  if (observedUsage.used !== expectedUsed) {
    throw new Error("결과 페이지를 다시 불러오는 동안 경매장 검색 횟수가 변했습니다.");
  }
}

function navigationReachedTarget(currentUrl, targetUrl) {
  try {
    const current = new URL(currentUrl);
    if (current.origin !== targetUrl.origin || current.pathname !== targetUrl.pathname) return false;
    for (const key of new Set(targetUrl.searchParams.keys())) {
      const currentValues = current.searchParams.getAll(key).sort();
      const targetValues = targetUrl.searchParams.getAll(key).sort();
      if (
        currentValues.length !== targetValues.length ||
        currentValues.some((value, index) => value !== targetValues[index])
      ) {
        return false;
      }
    }
    return true;
  } catch (_error) {
    return false;
  }
}

async function waitForFilterSearchDispatchWindow(label) {
  if (filterSearchTimestamp(collectorState?.filter_search_dispatch_pending_at)) {
    const recoveredAt = Date.now();
    collectorState = {
      ...collectorState,
      last_filter_search_dispatch_at: Math.max(
        filterSearchTimestamp(collectorState.last_filter_search_dispatch_at) || 0,
        recoveredAt
      ),
      filter_search_dispatch_pending_at: null
    };
    await saveCollectorState(collectorState);
  }

  const remaining = filterSearchDelayRemaining(
    collectorState?.last_filter_search_dispatch_at,
    Date.now(),
    FILTER_SEARCH_MIN_INTERVAL_MS
  );
  if (remaining <= 0) return;
  if (label) {
    appendLog(`${label} · 다음 필터 검색까지 ${Math.ceil(remaining / 1000)}초 기다립니다.`);
  }
  const notBefore = (filterSearchTimestamp(collectorState.last_filter_search_dispatch_at) || 0) +
    FILTER_SEARCH_MIN_INTERVAL_MS;
  while (Date.now() < notBefore) {
    await delay(Math.min(250, Math.max(1, notBefore - Date.now())));
  }
}

async function dispatchFilterSearchWithInterval({ label, beforeDispatch = null, dispatch }) {
  await waitForFilterSearchDispatchWindow(label);
  if (beforeDispatch) await beforeDispatch();

  const pendingAt = Date.now();
  collectorState = {
    ...collectorState,
    filter_search_dispatch_pending_at: pendingAt
  };
  await saveCollectorState(collectorState);

  try {
    return await dispatch();
  } finally {
    const dispatchedAt = Date.now();
    collectorState = {
      ...collectorState,
      last_filter_search_dispatch_at: Math.max(
        filterSearchTimestamp(collectorState.last_filter_search_dispatch_at) || 0,
        dispatchedAt
      ),
      filter_search_dispatch_pending_at: null
    };
    await saveCollectorState(collectorState);
  }
}

async function openAuctionSearch(currentUrl, query, job, attemptId, pageLimit, markRequested) {
  await ensureAuctionPriceTab(currentUrl);
  await waitForFilterSearchDispatchWindow(taskDisplayName(job.task));
  let tooltipNetworkReady = await prepareTooltipNetworkCapture();
  const keywordAction = query.search_scope === "catalog_global"
    ? "장비명 비움 확인"
    : query.exact_match === false ? "장비군 검색어 입력" : "장비명 정확 선택";
  appendLog(
    `${taskDisplayName(job.task)} · 초기화 → ${keywordAction} → ${describeFilterConditions(query)} 입력 → '필터 검색' → 60개씩 보기 확인 순서로 실행합니다.`
  );
  await requestFilterSearchPreparation(attemptId, query);
  if (tooltipNetworkReady) {
    const cleared = await sendToAuction({ type: "MAPLE_AUCTION_TOOLTIP_NETWORK_CLEAR" });
    tooltipNetworkReady = cleared?.ok === true && cleared.cache_size === 0;
  }
  const quotaDayKey = collectorState.attempts?.[attemptId]?.day_key || collectorState.day_key;
  const submission = await dispatchFilterSearchWithInterval({
    label: taskDisplayName(job.task),
    beforeDispatch: async () => {
      if (quotaDayKey !== toKstDateKey()) {
        throw new Error("KST 날짜가 바뀌어 이전 날짜의 검색 예약을 실행하지 않습니다.");
      }
      await markRequested();
    },
    dispatch: () => requestFilterSearchClick(attemptId, query, quotaDayKey)
  });
  const submittedUrl = await waitForFreshAppliedFilterSearch(query, submission);
  const priceSearchKey = submittedUrl.searchParams.get("priceSearchKey");
  const pageSize = await requestResultPageSize(attemptId, priceSearchKey, pageLimit);
  const effectivePageLimit = pageSize.page_size_not_applicable === true && pageSize.empty_result === true
    ? Number(submittedUrl.searchParams.get("limit")) || pageLimit
    : pageLimit;
  await waitForAppliedFilterSearch(query, submission, {
    page: 1,
    limit: effectivePageLimit,
    expectedPriceSearchKey: priceSearchKey
  });
  return {
    ...submission,
    effective_page_limit: effectivePageLimit,
    submitted_price_search_key: priceSearchKey,
    tooltip_network_ready: tooltipNetworkReady
  };
}

async function ensureAuctionPriceTab(currentUrl, options = {}) {
  if (isPriceTabUrl(currentUrl)) return;
  if (options.log !== false) appendLog("시세 탭으로 이동합니다.");
  try {
    const response = await sendToAuction({ type: "MAPLE_AUCTION_OPEN_PRICE_TAB" });
    if (response?.ok && (response.clicked || response.already_open)) {
      const deadline = Date.now() + PRICE_TAB_CLICK_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const tab = await chrome.tabs.get(sourceTabId);
        if (tab.status === "complete" && isPriceTabUrl(tab.url || "")) {
          await delay(650);
          return;
        }
        await delay(180);
      }
    }
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) throw error;
  }

  if (options.log !== false) appendLog("상단 시세 탭 클릭을 확인하지 못해 시세 주소로 이동합니다.");
  const latestTab = await chrome.tabs.get(sourceTabId);
  if (isPriceTabUrl(latestTab.url || "")) {
    await delay(650);
    return;
  }
  if (!AUCTION_URL_PATTERN.test(latestTab.url || "")) {
    throw new Error("연결된 탭이 메이플스토리 경매장을 벗어나 시세 탭으로 이동하지 않았습니다.");
  }
  const fallbackUrl = new URL("/price", latestTab.url);
  fallbackUrl.search = "";
  fallbackUrl.hash = "";
  await navigateAuctionUrl(fallbackUrl);
}

async function requestFilterSearchPreparation(attemptId, expectedQuery) {
  const deadline = Date.now() + ITEM_WAIT_TIMEOUT_MS;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await sendToAuction({
        type: "MAPLE_AUCTION_PREPARE_FILTER_SEARCH",
        attemptId,
        expectedQuery
      });
      if (response?.ok && response.prepared === true) return response;
      lastError = new Error(response?.error || "검색 필터를 아직 준비할 수 없습니다.");
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) throw error;
      lastError = error;
    }
    await delay(300);
  }
  throw new Error(lastError?.message || "검색 필터를 준비하지 못했습니다.");
}

async function requestFilterSearchClick(attemptId, expectedQuery, quotaDayKey) {
  const deadline = Date.now() + ITEM_WAIT_TIMEOUT_MS;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await sendToAuction({
        type: "MAPLE_AUCTION_CLICK_FILTER_SEARCH",
        attemptId,
        expectedQuery,
        quotaDayKey
      });
      if (response?.ok && (response.clicked || response.already_applied || response.already_scheduled)) {
        return response;
      }
      lastError = new Error(response?.error || "'필터 검색' 버튼을 아직 누를 수 없습니다.");
      if (/KST 날짜가 바뀌어/u.test(lastError.message)) throw lastError;
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) throw error;
      if (/KST 날짜가 바뀌어/u.test(String(error?.message || error))) throw error;
      lastError = error;
    }
    await delay(300);
  }
  throw new Error(lastError?.message || "'필터 검색' 버튼을 누르지 못했습니다.");
}

async function waitForFreshAppliedFilterSearch(query, submission = {}) {
  const deadline = Date.now() + ITEM_WAIT_TIMEOUT_MS;
  let lastUrl = null;
  const previousKey = submission.previous_price_search_key || null;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(sourceTabId);
    if (AUCTION_URL_PATTERN.test(tab.url || "")) {
      lastUrl = tab.url;
      const currentKey = new URL(tab.url).searchParams.get("priceSearchKey") || null;
      const freshResult = currentKey && (!previousKey || currentKey !== previousKey);
      if (
        freshResult &&
        isSubmittedFilterSearchUrl(tab.url, query) &&
        tab.status === "complete"
      ) {
        await delay(250);
        return new URL(tab.url);
      }
    }
    await delay(180);
  }
  const keyWasCreated = lastUrl && new URL(lastUrl).searchParams.has("priceSearchKey");
  throw new Error(keyWasCreated
    ? "필터 검색 키는 생성됐지만 선택한 세부 조건과 일치하지 않습니다."
    : "'필터 검색' 결과가 생성되지 않았습니다.");
}

async function requestResultPageSize(attemptId, expectedPriceSearchKey, expectedLimit) {
  const deadline = Date.now() + ITEM_WAIT_TIMEOUT_MS;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await sendToAuction({
        type: "MAPLE_AUCTION_ENSURE_RESULT_PAGE_SIZE",
        attemptId,
        expectedPriceSearchKey,
        expectedLimit
      });
      if (
        response?.ok &&
        ((
          response.page_size_control_found === true &&
          response.observed_page_limit === expectedLimit
        ) || (
          response.page_size_not_applicable === true &&
          response.empty_result === true &&
          Number.isInteger(response.observed_page_limit)
        )) &&
        response.price_search_key_preserved === true
      ) {
        return response;
      }
      lastError = new Error(response?.error || `${expectedLimit}개씩 보기를 아직 확인하지 못했습니다.`);
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) throw error;
      lastError = error;
    }
    await delay(300);
  }
  throw new Error(lastError?.message || `${expectedLimit}개씩 보기 설정을 확인할 수 없습니다.`);
}

async function waitForAppliedFilterSearch(query, submission = {}, options = {}) {
  const deadline = Date.now() + ITEM_WAIT_TIMEOUT_MS;
  let lastUrl = null;
  const previousKey = submission.previous_price_search_key || null;
  const expectedPriceSearchKey = options.expectedPriceSearchKey || null;
  const expectedPage = options.page ?? 1;
  const expectedLimit = options.limit ?? query.page_limit ?? REQUESTED_PAGE_LIMIT;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(sourceTabId);
    if (AUCTION_URL_PATTERN.test(tab.url || "")) {
      lastUrl = tab.url;
      const currentKey = new URL(tab.url).searchParams.get("priceSearchKey") || null;
      const freshResult = expectedPriceSearchKey
        ? currentKey === expectedPriceSearchKey
        : currentKey && (!previousKey || currentKey !== previousKey);
      if (
        freshResult &&
        isSubmittedFilterSearchUrl(tab.url, query) &&
        submittedResultViewMatches(tab.url, expectedPage, expectedLimit) &&
        tab.status === "complete"
      ) {
        await delay(650);
        return new URL(tab.url);
      }
    }
    await delay(180);
  }
  const keyWasCreated = lastUrl && new URL(lastUrl).searchParams.has("priceSearchKey");
  const detailsMatch = keyWasCreated && isSubmittedFilterSearchUrl(lastUrl, query);
  throw new Error(keyWasCreated
    ? detailsMatch
      ? `필터 조건은 적용됐지만 ${expectedLimit}개씩 보기·${expectedPage}페이지·최신 거래순을 확인하지 못했습니다.`
      : "필터 검색 키는 생성됐지만 선택한 세부 조건과 일치하지 않습니다."
    : "'필터 검색' 결과가 생성되지 않았습니다.");
}

function submittedResultViewMatches(currentUrl, page, limit) {
  try {
    const url = new URL(currentUrl);
    return Number(url.searchParams.get("page")) === page &&
      Number(url.searchParams.get("limit")) === limit &&
      url.searchParams.get("sortType") === "TRADE_DATE_DESC";
  } catch (_error) {
    return false;
  }
}

async function waitForAuctionItems(options = {}) {
  const deadline = Date.now() + ITEM_WAIT_TIMEOUT_MS;
  let lastError = null;
  let stability = createResultStabilityState();
  while (Date.now() < deadline) {
    try {
      const response = await sendToAuction({
        type: "MAPLE_JSONL_LIST_ITEMS",
        attemptId: options.attemptId || null,
        expectedQuery: options.expectedQuery || null,
        previousDocumentToken: options.previousDocumentToken || null,
        previousPriceSearchKey: options.previousPriceSearchKey || null,
        expectedPriceSearchKey: options.expectedPriceSearchKey || null
      });
      const resultReady = (response?.items || []).length > 0 || response?.empty === true;
      const filterReady = !options.requireFilterApplied || (
        response?.capture?.search_context?.filter_search_applied === true &&
        response?.capture?.search_context?.price_search_key_present === true
      );
      const observed = observeResultStability(
        stability,
        response?.capture?.result_readiness,
        Date.now(),
        DEFAULT_RESULT_STABLE_MS
      );
      stability = observed.state;
      if (response?.ok && resultReady && filterReady && observed.ready) {
        response.capture.result_readiness = {
          ...response.capture.result_readiness,
          stable_for_ms: observed.stable_for_ms,
          stable_poll_count: observed.stable_poll_count
        };
        return response;
      }
      if (response?.ok && resultReady && !filterReady) {
        lastError = new Error("필터 검색 결과가 적용되기를 기다리는 중입니다.");
      } else if (response?.ok && filterReady) {
        lastError = new Error("새 검색 결과 DOM이 완전히 바뀌고 안정화되기를 기다리는 중입니다.");
      } else {
        lastError = new Error(response?.error || "검색 결과를 아직 읽지 못했습니다.");
      }
    } catch (error) {
      if (isExtensionContextInvalidatedError(error)) throw error;
      lastError = error;
    }
    await delay(450);
  }
  throw new Error(lastError?.message || "검색 결과 대기 시간이 초과되었습니다.");
}

async function verifyAuctionTab() {
  if (!Number.isInteger(sourceTabId) || !Number.isInteger(sourceWindowId)) {
    throw new Error("경매장 탭 정보가 없습니다. 경매장 탭에서 다시 열어 주세요.");
  }
  const tab = await chrome.tabs.get(sourceTabId);
  if (tab.windowId !== sourceWindowId || !AUCTION_URL_PATTERN.test(tab.url || "")) {
    throw new Error("원래의 메이플스토리 경매장 탭이 닫혔거나 이동했습니다.");
  }
  return tab;
}

async function prepareTooltipNetworkCapture() {
  try {
    if (!await ensureTooltipNetworkHookReady()) return false;
    const cleared = await sendToAuction({ type: "MAPLE_AUCTION_TOOLTIP_NETWORK_CLEAR" });
    return cleared?.ok === true && cleared.cache_size === 0;
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) throw error;
    return false;
  }
}

async function ensureTooltipNetworkHookReady() {
  await chrome.scripting.executeScript({
    target: { tabId: sourceTabId },
    world: "MAIN",
    files: ["tooltip-network-hook.js"]
  });
  const status = await sendToAuction({ type: "MAPLE_AUCTION_TOOLTIP_NETWORK_STATUS" });
  return Boolean(
    status?.ok && status.installed === true &&
    (
      status.fetch_hook_active === true ||
      status.xhr_hook_active === true
    )
  );
}

async function sendToAuction(message) {
  try { return await chrome.tabs.sendMessage(sourceTabId, message); }
  catch (error) {
    if (isExtensionContextInvalidatedError(error)) throw error;
    await chrome.scripting.executeScript({
      target: { tabId: sourceTabId },
      files: ["capture-core.js", "content.js"]
    });
    return chrome.tabs.sendMessage(sourceTabId, message);
  }
}

async function cleanupAuctionPage() {
  try {
    await sendToAuction({ type: "MAPLE_JSONL_CLEANUP" });
  } catch (error) {
    markExtensionContextInvalidated(error); // Other failures are expected while the tab is navigating.
  }
}

async function abortAuctionDiagnostic(diagnosticId) {
  if (!diagnosticId) return;
  try {
    await sendToAuction({
      type: "MAPLE_AUCTION_DIAGNOSTIC_ABORT",
      diagnosticId
    });
  } catch (error) {
    markExtensionContextInvalidated(error);
  }
}

async function focusManagerWindow() {
  if (!Number.isInteger(managerWindowId)) return;
  try {
    await chrome.windows.update(managerWindowId, { focused: true });
  } catch (error) {
    markExtensionContextInvalidated(error); // A normally closed window is otherwise ignored.
  }
}

async function ensureDirectoryWritePermission() {
  if (!directoryHandle) throw new Error("먼저 market-data 저장 폴더를 선택해 주세요.");
  let permission = await directoryHandle.queryPermission({ mode: "readwrite" });
  if (permission !== "granted") permission = await directoryHandle.requestPermission({ mode: "readwrite" });
  if (permission !== "granted") throw new Error("선택한 폴더에 저장할 권한이 필요합니다.");
}

async function refreshDirectoryUi() {
  if (!directoryHandle) {
    elements.folderName.textContent = "아직 선택된 루트 폴더가 없습니다.";
    elements.permissionBadge.textContent = "선택 필요";
    elements.permissionBadge.className = "badge";
    return;
  }
  const permission = await directoryHandle.queryPermission({ mode: "readwrite" });
  elements.folderName.textContent = directoryHandle.name.toLowerCase() === "raw"
    ? directoryHandle.name
    : `${directoryHandle.name}/raw`;
  elements.permissionBadge.textContent = permission === "granted" ? "쓰기 가능" : "권한 확인 필요";
  elements.permissionBadge.className = permission === "granted" ? "badge ready" : "badge";
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SETTINGS_STORE)) database.createObjectStore(SETTINGS_STORE);
      if (!database.objectStoreNames.contains(STATE_STORE)) database.createObjectStore(STATE_STORE);
      if (!database.objectStoreNames.contains(PAGE_STORE)) {
        const store = database.createObjectStore(PAGE_STORE, { keyPath: "page_capture_id" });
        store.createIndex("file_status", "file_status", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { databasePromise = null; reject(request.error); };
  });
  return databasePromise;
}

async function transactionPromise(database, stores, mode, operation) {
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(stores, mode);
    operation(transaction);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
  });
}

async function saveDirectoryHandle(handle) {
  const database = await openDatabase();
  await transactionPromise(database, SETTINGS_STORE, "readwrite", (transaction) => {
    transaction.objectStore(SETTINGS_STORE).put(handle, DIRECTORY_HANDLE_KEY);
  });
}

async function loadDirectoryHandle() {
  const database = await openDatabase();
  return requestPromise(database.transaction(SETTINGS_STORE, "readonly").objectStore(SETTINGS_STORE).get(DIRECTORY_HANDLE_KEY));
}

async function loadCollectorState() {
  const database = await openDatabase();
  return requestPromise(database.transaction(STATE_STORE, "readonly").objectStore(STATE_STORE).get(STATE_KEY));
}

async function saveCollectorState(state) {
  const persistedState = await persistOwnedStateCas(state);
  await mirrorCheckpoint(persistedState);
}

async function persistOwnedStateCas(nextState, { pageRecord = null } = {}) {
  const expectedLeaseId = activeLeaseId;
  if (!leaseHeld || !expectedLeaseId) throw createLeaseConflictError();
  const database = await openDatabase();
  const stores = pageRecord ? [PAGE_STORE, STATE_STORE] : STATE_STORE;
  let persistedState = null;
  let conflict = false;
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(stores, "readwrite");
      const stateStore = transaction.objectStore(STATE_STORE);
      const request = stateStore.get(STATE_KEY);
      request.onsuccess = () => {
        const latest = request.result
          ? ensureApplicationState(rolloverCollectorState(request.result))
          : null;
        if (!ownsActiveLease(latest?.lease, expectedLeaseId)) {
          conflict = true;
          transaction.abort();
          return;
        }
        const lease = renewedLeaseRecord(latest.lease);
        persistedState = { ...nextState, lease };
        if (pageRecord) transaction.objectStore(PAGE_STORE).put(pageRecord);
        stateStore.put(persistedState, STATE_KEY);
      };
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(conflict
        ? createLeaseConflictError()
        : transaction.error || new Error("수집 상태를 저장하지 못했습니다."));
      transaction.onerror = () => {
        if (!conflict) reject(transaction.error || new Error("수집 상태를 저장하지 못했습니다."));
      };
    });
  } catch (error) {
    if (conflict) markOwnedLeaseLost(expectedLeaseId, error);
    throw error;
  }
  if (activeLeaseId === expectedLeaseId) {
    if (nextState === collectorState) collectorState = persistedState;
    else if (nextState && typeof nextState === "object") nextState.lease = persistedState.lease;
    scheduleLeaseHeartbeat();
  }
  return persistedState;
}

async function mirrorCheckpoint(state) {
  await chrome.storage.local.set({
    [CHECKPOINT_MIRROR_KEY]: {
      schema_version: state.schema_version,
      catalog_version: state.catalog_version,
      day_key: state.day_key,
      quota_session: state.quota_session,
      run_status: state.run_status,
      quota: state.quota,
      totals: state.totals,
      retry_count: state.retries.length,
      active_attempt_id: state.active_job?.attempt_id || null,
      updated_at: new Date().toISOString()
    }
  });
}

async function getPendingCaptureRecords() {
  const database = await openDatabase();
  const store = database.transaction(PAGE_STORE, "readonly").objectStore(PAGE_STORE);
  const request = store.indexNames.contains("file_status")
    ? store.index("file_status").getAll("pending")
    : store.getAll();
  const records = await requestPromise(request);
  return records.filter((record) => record.file_status === "pending");
}

async function getPageCaptureRecord(id) {
  const database = await openDatabase();
  return requestPromise(database.transaction(PAGE_STORE, "readonly").objectStore(PAGE_STORE).get(id));
}

async function getCaptureRecordByAttempt(attemptId) {
  const database = await openDatabase();
  const records = await requestPromise(
    database.transaction(PAGE_STORE, "readonly").objectStore(PAGE_STORE).getAll()
  );
  return records
    .filter((record) => record.attempt_id === attemptId)
    .sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")))
    .find((record) => ["received", "pending"].includes(record.file_status)) ||
    records.find((record) => record.attempt_id === attemptId) || null;
}

async function markCaptureDiscardedByAttempt(attemptId, reason) {
  const record = await getCaptureRecordByAttempt(attemptId);
  if (!record?.page_capture_id) return;
  const database = await openDatabase();
  await transactionPromise(database, PAGE_STORE, "readwrite", (transaction) => {
    transaction.objectStore(PAGE_STORE).put({
      ...record,
      file_status: "discarded",
      discarded_reason: reason
    });
  });
}

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function getFileIfExists(directory, filename) {
  try { return await (await directory.getFileHandle(filename)).getFile(); }
  catch (error) { if (error.name === "NotFoundError") return null; throw error; }
}

function buildOutputFilename(keyword, page, attemptId, date) {
  return `maple-auction_page_${formatLocalTimestamp(date)}_${sanitizeFilenamePart(keyword)}_p${page}_${attemptId.slice(0, 8)}.jsonl`;
}

function formatLocalTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function isoWithLocalOffset(date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().replace("Z", "");
  return `${local}${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

function sanitizeFilenamePart(value) {
  return String(value || "items")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .replace(/\s+/g, "-")
    .replace(/[. ]+$/g, "")
    .slice(0, 60) || "items";
}

function getOrCreateManagerId() {
  try {
    const existing = sessionStorage.getItem(MANAGER_SESSION_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    sessionStorage.setItem(MANAGER_SESSION_KEY, created);
    return created;
  } catch (_error) {
    return crypto.randomUUID();
  }
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function compareTaskId(left, right) { return String(left.id).localeCompare(String(right.id), "ko"); }
function describeFilterConditions(query = {}) {
  const starforce = query.starforce_min == null && query.starforce_max == null &&
    query.price_min_meso != null
    ? "스타포스 0성 이상"
    : describeStarforceCondition(query.starforce_min, query.starforce_max);
  const filter = query.potential_filter || query.server_filter || null;
  const code = filter?.auction_code || filter?.code || query.potential_code || null;
  const minimum = filter?.minimum ?? query.potential_min ?? null;
  const maximum = filter?.maximum ?? null;
  const potential = code && minimum != null
    ? `${potentialFilterLabel(code)} 합산 ${maximum == null ? `${minimum}% 이상` : `${minimum}~${maximum}%`}`
    : "잠재 없음";
  const category = query.equipment_subcategory_filter
    ? `${query.equipment_subcategory_filter} · `
    : "";
  const price = query.price_min_meso != null || query.price_max_meso != null
    ? ` · ${describePriceCondition(query.price_min_meso, query.price_max_meso)}`
    : "";
  return `${category}${starforce} · ${potential}${price}`;
}
function describePriceCondition(minimum, maximum) {
  const min = minimum ?? null;
  const max = maximum ?? null;
  if (min != null && max != null) return `가격 ${formatMesoCondition(min)}~${formatMesoCondition(max)}`;
  if (min != null) return `최소 가격 ${formatMesoCondition(min)} · 최대 가격 제한 없음`;
  return `최대 가격 ${formatMesoCondition(max)}`;
}
function formatMesoCondition(value) {
  if (Number.isInteger(value) && value > 0 && value % 100_000_000 === 0) {
    return `${value / 100_000_000}억 메소`;
  }
  if (Number.isInteger(value) && value > 0 && value % 10_000 === 0) {
    return `${(value / 10_000).toLocaleString("ko-KR")}만 메소`;
  }
  return `${Number(value || 0).toLocaleString("ko-KR")} 메소`;
}
function describeStarforceCondition(minimum, maximum) {
  const min = minimum ?? null;
  const max = maximum ?? null;
  if (min == null && max == null) return "스타포스 제한 없음";
  if (min === max) return `스타포스 ${min}성`;
  if (min == null) return `스타포스 ${max}성 이하`;
  if (max == null) return `스타포스 ${min}성 이상`;
  return `스타포스 ${min}~${max}성`;
}
function potentialFilterLabel(code) {
  return ({
    strPercent: "STR%",
    dexPercent: "DEX%",
    intPercent: "INT%",
    lukPercent: "LUK%",
    allStatsPercent: "올스탯%",
    allStatPercent: "올스탯%",
    attackPercent: "공격력%",
    physicalAttackPercent: "공격력%",
    magicAttackPercent: "마력%",
    itemDropPercent: "아이템 획득 확률 증가",
    mesosObtainedPercent: "메소 획득량 증가"
  })[code] || code;
}
function laneLabel(lane) {
  return ({
    baseline: "기본 시세", starforce: "스타포스", main: "주스탯%",
    allstat: "올스탯%", hp: "HP%", hat: "모자 쿨감", glove: "장갑 크뎀",
    accessory: "드롭·메획", mitra: "미트라", audit: "필터 점검"
  })[lane] || lane;
}
function quotaMessage(reason) {
  if (reason === "normal_limit_reached" || reason === "lane_plan_exhausted") return "오늘 일반 조사 98회를 모두 사용했습니다.";
  if (reason === "hard_limit_reached" || reason === "reserve_limit_reached") return "오늘 검색 한도 100회를 모두 사용했습니다.";
  return `다음 작업을 예약하지 못했습니다: ${reason || "알 수 없는 이유"}`;
}
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
