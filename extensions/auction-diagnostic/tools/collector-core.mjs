export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const NORMAL_QUERY_LIMIT = 98;
export const RESERVE_QUERY_LIMIT = 2;
export const HARD_QUERY_LIMIT = NORMAL_QUERY_LIMIT + RESERVE_QUERY_LIMIT;

export const REQUESTED_PAGE_LIMIT = 60;
export const FALLBACK_PAGE_LIMIT = 40;
export const FILTER_SEARCH_MIN_INTERVAL_MS = 10_000;

export const LANE_PLAN = Object.freeze({
  baseline: 33,
  starforce: 28,
  main: 28,
  allstat: 2,
  hp: 0,
  hat: 0,
  glove: 0,
  accessory: 2,
  mitra: 5,
  audit: 0
});

export const LANE_NAMES = Object.freeze(Object.keys(LANE_PLAN));
export const EMPTY_BACKOFF_DAYS = Object.freeze([1, 3, 7, 14]);
export const ATTEMPT_PHASES = Object.freeze(["reserved", "requested", "received", "committed"]);
export const QUOTA_PURPOSES = Object.freeze(["normal", "recovery", "normal_overflow"]);

export function lanePlanTotal(plan = LANE_PLAN) {
  return Object.keys(plan).reduce((sum, lane) => sum + nonNegativeInteger(plan[lane]), 0);
}

export function toKstDateKey(value = Date.now()) {
  const timestamp = toEpochMilliseconds(value);
  return new Date(timestamp + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addKstDays(dateKey, days) {
  const parts = parseDateKey(dateKey);
  if (!Number.isInteger(days)) {
    throw new Error("days는 정수여야 합니다.");
  }
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days)).toISOString().slice(0, 10);
}

export function filterSearchDelayRemaining(
  lastDispatchAt,
  now = Date.now(),
  minimumIntervalMs = FILTER_SEARCH_MIN_INTERVAL_MS
) {
  const previous = Number(lastDispatchAt);
  const current = Number(now);
  const interval = Number(minimumIntervalMs);
  if (
    !Number.isFinite(previous) || previous <= 0 ||
    !Number.isFinite(current) ||
    !Number.isFinite(interval) || interval <= 0
  ) {
    return 0;
  }
  return Math.max(0, Math.ceil(previous + interval - current));
}

export function summarizeEquipmentQueryProgress(queries, fixedTasks, queryStats, options = {}) {
  const today = options.today || toKstDateKey(options.now == null ? Date.now() : options.now);
  const catalogById = new Map((Array.isArray(options.catalog_items) ? options.catalog_items : [])
    .map((item) => [String(item?.id || ""), item])
    .filter(([id]) => Boolean(id)));
  const statsByQueryId = new Map();

  for (const task of Array.isArray(fixedTasks) ? fixedTasks : []) {
    const queryId = String(task?.query?.query_id || "");
    if (!queryId) continue;
    const stats = queryStats?.[task.id] || {};
    const current = statsByQueryId.get(queryId) || { completed: false, deferred: false };
    if (isPhysicalQueryComplete(task.query, stats)) {
      current.completed = true;
    }
    if (stats.next_eligible_date && stats.next_eligible_date > today) {
      current.deferred = true;
    }
    statsByQueryId.set(queryId, current);
  }

  const equipment = new Map();
  const seenQueryIds = new Set();
  let completedQueries = 0;
  let deferredQueries = 0;

  for (const query of Array.isArray(queries) ? queries : []) {
    const queryId = String(query?.query_id || "");
    if (!queryId || seenQueryIds.has(queryId)) continue;
    seenQueryIds.add(queryId);
    const queryProgress = statsByQueryId.get(queryId) || { completed: false, deferred: false };
    if (queryProgress.completed) {
      completedQueries += 1;
    } else if (queryProgress.deferred) {
      deferredQueries += 1;
    }
    if (query?.progress_scope === "global") continue;

    const catalogIds = Array.from(new Set(
      (Array.isArray(query?.catalog_ids) && query.catalog_ids.length > 0
        ? query.catalog_ids
        : [query?.catalog_id])
        .map((value) => String(value || ""))
        .filter(Boolean)
    ));
    if (catalogIds.length === 0) continue;
    for (const [memberIndex, catalogId] of catalogIds.entries()) {
      const catalogItem = catalogById.get(catalogId) || null;
      let item = equipment.get(catalogId);
      if (!item) {
        item = {
          catalog_id: catalogId,
          name: String(catalogItem?.name || query.allowed_names?.[memberIndex] || query.exact_name || catalogId),
          priority: catalogItem?.priority == null
            ? query.priority == null ? null : String(query.priority)
            : String(catalogItem.priority),
          group: catalogItem?.group == null
            ? query.group == null ? null : String(query.group)
            : String(catalogItem.group),
          total: 0,
          completed: 0,
          deferred: 0
        };
        equipment.set(catalogId, item);
      }
      item.total += 1;
      if (queryProgress.completed) item.completed += 1;
      else if (queryProgress.deferred) item.deferred += 1;
    }
  }

  const items = [...equipment.values()].map((item) => {
    const remaining = Math.max(0, item.total - item.completed);
    return {
      ...item,
      remaining,
      status: item.total > 0 && remaining === 0 ? "completed" : "incomplete"
    };
  });
  const completedItems = items.filter((item) => item.status === "completed").length;

  return {
    total_items: items.length,
    completed_items: completedItems,
    incomplete_items: items.length - completedItems,
    total_queries: seenQueryIds.size,
    completed_queries: completedQueries,
    deferred_queries: deferredQueries,
    items
  };
}

export function isPhysicalQueryComplete(query, stats = {}) {
  if (query?.page_sweep?.enabled === true) {
    return stats.page_sweep_complete === true;
  }
  return stats.first_page_captured === true || Number(stats.observations || 0) > 0;
}

export function kstStartEpochMilliseconds(dateKey) {
  const parts = parseDateKey(dateKey);
  return Date.UTC(parts.year, parts.month - 1, parts.day) - KST_OFFSET_MS;
}

export function createLaneUsage(value = 0) {
  const usage = {};
  for (const lane of LANE_NAMES) {
    usage[lane] = nonNegativeInteger(value);
  }
  return usage;
}

export function createQuotaState() {
  return {
    normal_limit: NORMAL_QUERY_LIMIT,
    reserve_limit: RESERVE_QUERY_LIMIT,
    hard_limit: HARD_QUERY_LIMIT,
    normal_reserved: 0,
    reserve_reserved: 0,
    reserve_recovery_reserved: 0,
    reserve_borrowed_for_normal: 0,
    total_reserved: 0
  };
}

export function createQuotaSession(now = Date.now(), options = {}) {
  const timestamp = toEpochMilliseconds(now);
  const dayKey = options.day_key || toKstDateKey(timestamp);
  const ordinal = Math.max(1, positiveIntegerOrNull(options.ordinal) || 1);
  const startedAt = options.started_at || new Date(timestamp).toISOString();
  const baseline = Math.min(HARD_QUERY_LIMIT, nonNegativeInteger(options.baseline_site_used));
  const lastUsed = Math.max(
    baseline,
    Math.min(HARD_QUERY_LIMIT, nonNegativeInteger(options.last_site_used))
  );
  return {
    id: String(options.id || `quota:${dayKey}:${ordinal}:${startedAt}`),
    ordinal,
    day_key: dayKey,
    started_at: startedAt,
    baseline_site_used: baseline,
    last_site_used: lastUsed,
    switch_reason: options.switch_reason == null ? null : String(options.switch_reason)
  };
}

export function createPageLimitCalibration() {
  return {
    requested_limit: REQUESTED_PAGE_LIMIT,
    effective_limit: null,
    status: "uncalibrated",
    reason: null,
    calibrated_at: null
  };
}

export function createCollectorState(now = Date.now()) {
  const timestamp = toEpochMilliseconds(now);
  const dayKey = toKstDateKey(timestamp);
  return {
    schema_version: "maple-auction.collector-state.v1",
    day_key: dayKey,
    daily_started_at: new Date(timestamp).toISOString(),
    quota: createQuotaState(),
    quota_session: createQuotaSession(timestamp, { day_key: dayKey, switch_reason: "initial" }),
    lane_usage: {
      normal: createLaneUsage(),
      reserve: createLaneUsage()
    },
    attempts: {},
    page_limit_calibration: createPageLimitCalibration(),
    last_filter_search_dispatch_at: null,
    filter_search_dispatch_pending_at: null,
    last_recovery_at: null
  };
}

export function resetCollectorProgress(state, now = Date.now()) {
  const current = rolloverCollectorState(state || createCollectorState(now), now);
  return {
    ...current,
    active_job: null,
    retries: [],
    query_stats: {},
    watermarks: {},
    lane_usage: {
      normal: createLaneUsage(),
      reserve: createLaneUsage()
    },
    totals: {
      ...(current.totals || {}),
      failures: 0
    },
    run_status: "idle",
    last_error: null,
    last_recovery_at: null,
    done: false,
    stop_reason: null
  };
}

export function rolloverCollectorState(state, now = Date.now()) {
  const timestamp = toEpochMilliseconds(now);
  const dayKey = toKstDateKey(timestamp);
  if (state && state.day_key === dayKey) {
    return normalizeCollectorState(state, timestamp);
  }

  const previous = state || {};
  return {
    ...previous,
    schema_version: previous.schema_version || "maple-auction.collector-state.v1",
    day_key: dayKey,
    daily_started_at: new Date(timestamp).toISOString(),
    quota: createQuotaState(),
    quota_session: createQuotaSession(timestamp, { day_key: dayKey, switch_reason: "kst_rollover" }),
    lane_usage: {
      normal: createLaneUsage(),
      reserve: createLaneUsage()
    },
    attempts: { ...(previous.attempts || {}) },
    page_limit_calibration: {
      ...createPageLimitCalibration(),
      ...(previous.page_limit_calibration || {})
    },
    last_recovery_at: previous.last_recovery_at || null
  };
}

export function quotaRemaining(state) {
  const quota = normalizeQuota(state && state.quota);
  return {
    normal: Math.max(0, NORMAL_QUERY_LIMIT - quota.normal_reserved),
    reserve: Math.max(0, RESERVE_QUERY_LIMIT - quota.reserve_reserved),
    hard: Math.max(0, HARD_QUERY_LIMIT - quota.total_reserved)
  };
}

export function reconcileObservedQuota(currentQuota, observedUsed) {
  let normal = Math.min(NORMAL_QUERY_LIMIT, nonNegativeInteger(currentQuota?.normal_reserved));
  let reserve = Math.min(RESERVE_QUERY_LIMIT, nonNegativeInteger(currentQuota?.reserve_reserved));
  const borrowed = Math.min(reserve, nonNegativeInteger(currentQuota?.reserve_borrowed_for_normal));
  const recovery = Math.min(
    reserve - borrowed,
    nonNegativeInteger(currentQuota?.reserve_recovery_reserved)
  );
  let unclassified = Math.max(0, nonNegativeInteger(observedUsed) - normal - reserve);
  const normalExtra = Math.min(unclassified, NORMAL_QUERY_LIMIT - normal);
  normal += normalExtra;
  unclassified -= normalExtra;
  reserve += Math.min(unclassified, RESERVE_QUERY_LIMIT - reserve);
  return {
    ...(currentQuota || {}),
    normal_limit: NORMAL_QUERY_LIMIT,
    reserve_limit: RESERVE_QUERY_LIMIT,
    hard_limit: HARD_QUERY_LIMIT,
    normal_reserved: normal,
    reserve_reserved: reserve,
    reserve_recovery_reserved: recovery,
    reserve_borrowed_for_normal: borrowed,
    total_reserved: normal + reserve
  };
}

export function rebaseQuotaSession(state, observedUsed, options = {}) {
  const timestamp = toEpochMilliseconds(options.now == null ? Date.now() : options.now);
  const current = rolloverCollectorState(state, timestamp);
  const observed = Math.min(HARD_QUERY_LIMIT, nonNegativeInteger(observedUsed));
  const previousSession = normalizeQuotaSession(current.quota_session, current, timestamp);
  const explicitSessionId = String(options.session_id || options.id || "").trim();
  const forcedSwitch = options.force === true || (
    explicitSessionId && explicitSessionId !== previousSession.id
  );
  const usageDecreased = observed < previousSession.last_site_used;

  if (!forcedSwitch && !usageDecreased) {
    const quotaSession = {
      ...previousSession,
      last_site_used: Math.max(previousSession.last_site_used, observed)
    };
    return {
      ok: true,
      rebased: false,
      reason: "usage_reconciled",
      previous_session: previousSession,
      quota_session: quotaSession,
      state: {
        ...current,
        quota: reconcileObservedQuota(current.quota, observed),
        quota_session: quotaSession
      }
    };
  }

  if (usageDecreased && options.confirmed !== true && !forcedSwitch) {
    return {
      ok: false,
      rebased: false,
      reason: "quota_session_rebase_confirmation_required",
      previous_session: previousSession,
      quota_session: previousSession,
      state: current
    };
  }

  if (hasOpenAttemptForQuotaSession(current, previousSession)) {
    return {
      ok: false,
      rebased: false,
      reason: "active_attempt_present",
      previous_session: previousSession,
      quota_session: previousSession,
      state: current
    };
  }

  const ordinal = previousSession.day_key === current.day_key
    ? previousSession.ordinal + 1
    : 1;
  const quotaSession = createQuotaSession(timestamp, {
    id: explicitSessionId || undefined,
    ordinal,
    day_key: current.day_key,
    baseline_site_used: observed,
    last_site_used: observed,
    switch_reason: options.switch_reason || (usageDecreased ? "site_usage_decreased" : "account_switch")
  });
  return {
    ok: true,
    rebased: true,
    reason: null,
    previous_session: previousSession,
    quota_session: quotaSession,
    state: {
      ...current,
      quota: reconcileObservedQuota(createQuotaState(), observed),
      quota_session: quotaSession,
      lane_usage: {
        normal: createLaneUsage(),
        reserve: createLaneUsage()
      },
      site_search_usage: {
        used: observed,
        limit: HARD_QUERY_LIMIT,
        observed_at: new Date(timestamp).toISOString(),
        day_key: current.day_key
      }
    }
  };
}

export function canBorrowReserveForNormal(state) {
  const current = state || {};
  const quota = normalizeQuota(current.quota);
  if (
    quota.normal_reserved !== NORMAL_QUERY_LIMIT ||
    quota.reserve_reserved >= RESERVE_QUERY_LIMIT ||
    quota.total_reserved >= HARD_QUERY_LIMIT
  ) {
    return false;
  }
  if (quota.reserve_reserved - quota.reserve_borrowed_for_normal > 0) {
    return false;
  }
  if ((Array.isArray(current.retries) ? current.retries : []).some((entry) => entry?.retry === true)) {
    return false;
  }
  if (Number(current.active_job?.job?.retry_count || 0) > 0) {
    return false;
  }
  const session = normalizeQuotaSession(
    current.quota_session,
    current,
    toEpochMilliseconds(current.daily_started_at || Date.now())
  );
  return !Object.values(current.attempts || {}).some((attempt) =>
    attemptBelongsToQuotaSession(attempt, session) &&
    attempt?.phase !== "committed" &&
    attemptQuotaPurpose(attempt) === "recovery"
  );
}

export function laneDeficit(lane, laneUsage, plan = LANE_PLAN) {
  if (!Object.prototype.hasOwnProperty.call(plan, lane)) {
    return 0;
  }
  const used = laneUsage && Number.isFinite(Number(laneUsage[lane]))
    ? nonNegativeInteger(laneUsage[lane])
    : 0;
  return Math.max(0, nonNegativeInteger(plan[lane]) - used);
}

export function reserveQueryQuota(state, options) {
  const config = options || {};
  const timestamp = toEpochMilliseconds(config.now == null ? Date.now() : config.now);
  const current = rolloverCollectorState(state, timestamp);
  const attemptId = String(config.attempt_id || config.attemptId || "").trim();
  const lane = String(config.lane || "").trim();
  const requestedPool = config.pool || "auto";
  const requestedPurpose = config.quota_purpose == null
    ? null
    : String(config.quota_purpose).trim();

  if (!attemptId) {
    return reservationFailure(current, "attempt_id_required");
  }
  if (!Object.prototype.hasOwnProperty.call(LANE_PLAN, lane)) {
    return reservationFailure(current, "unknown_lane");
  }
  if (!["auto", "normal", "reserve"].includes(requestedPool)) {
    return reservationFailure(current, "unknown_pool");
  }
  if (requestedPurpose != null && !QUOTA_PURPOSES.includes(requestedPurpose)) {
    return reservationFailure(current, "unknown_quota_purpose");
  }
  if (
    (requestedPurpose === "normal" && requestedPool === "reserve") ||
    (requestedPurpose !== null && requestedPurpose !== "normal" && requestedPool === "normal")
  ) {
    return reservationFailure(current, "quota_purpose_pool_mismatch");
  }
  if (current.attempts[attemptId]) {
    return {
      ok: true,
      duplicate: true,
      reason: "already_reserved",
      state: current,
      reservation: current.attempts[attemptId]
    };
  }

  const quota = normalizeQuota(current.quota);
  const normalUsage = normalizeLaneUsage(current.lane_usage && current.lane_usage.normal);
  const reserveUsage = normalizeLaneUsage(current.lane_usage && current.lane_usage.reserve);
  const normalLaneAvailable = laneDeficit(lane, normalUsage) > 0 ||
    config.allow_normal_rebalance === true;
  const normalAvailable = quota.normal_reserved < NORMAL_QUERY_LIMIT && normalLaneAvailable;
  const reserveAvailable = quota.reserve_reserved < RESERVE_QUERY_LIMIT && quota.total_reserved < HARD_QUERY_LIMIT;
  const overflowAvailable = reserveAvailable && canBorrowReserveForNormal(current);

  let pool = null;
  let quotaPurpose = requestedPurpose;
  if (
    requestedPurpose !== "recovery" && requestedPurpose !== "normal_overflow" &&
    (requestedPool === "normal" || requestedPool === "auto") && normalAvailable
  ) {
    pool = "normal";
    quotaPurpose = "normal";
  } else if (
    requestedPurpose === "normal_overflow" &&
    (requestedPool === "reserve" || requestedPool === "auto") &&
    overflowAvailable
  ) {
    pool = "reserve";
    quotaPurpose = "normal_overflow";
  } else if (
    requestedPurpose !== "normal" && requestedPurpose !== "normal_overflow" &&
    (requestedPool === "reserve" || (requestedPool === "auto" && config.allow_reserve === true)) &&
    reserveAvailable
  ) {
    pool = "reserve";
    quotaPurpose = "recovery";
  }

  if (!pool) {
    if (quota.total_reserved >= HARD_QUERY_LIMIT) {
      return reservationFailure(current, "hard_limit_reached");
    }
    if (requestedPurpose === "normal_overflow") {
      return reservationFailure(current, "normal_overflow_not_allowed");
    }
    if (requestedPool === "reserve" || config.allow_reserve === true) {
      return reservationFailure(current, "reserve_limit_reached");
    }
    if (laneDeficit(lane, normalUsage) <= 0 && config.allow_normal_rebalance !== true) {
      return reservationFailure(current, "lane_plan_exhausted");
    }
    return reservationFailure(current, "normal_limit_reached");
  }

  const reservedAt = new Date(timestamp).toISOString();
  const reservation = {
    attempt_id: attemptId,
    task_id: config.task_id == null ? null : String(config.task_id),
    lane,
    pool,
    quota_purpose: quotaPurpose,
    quota_session_id: current.quota_session.id,
    day_key: current.day_key,
    phase: "reserved",
    reserved_at: reservedAt,
    requested_at: null,
    received_at: null,
    committed_at: null,
    page_number: positiveIntegerOrNull(config.page_number),
    metadata: copyPlainObject(config.metadata)
  };

  const nextQuota = {
    ...quota,
    normal_reserved: quota.normal_reserved + (pool === "normal" ? 1 : 0),
    reserve_reserved: quota.reserve_reserved + (pool === "reserve" ? 1 : 0),
    reserve_recovery_reserved: quota.reserve_recovery_reserved + (
      quotaPurpose === "recovery" ? 1 : 0
    ),
    reserve_borrowed_for_normal: quota.reserve_borrowed_for_normal + (
      quotaPurpose === "normal_overflow" ? 1 : 0
    ),
    total_reserved: quota.total_reserved + 1
  };
  const nextNormalUsage = { ...normalUsage };
  const nextReserveUsage = { ...reserveUsage };
  if (pool === "normal") {
    nextNormalUsage[lane] += 1;
  } else {
    nextReserveUsage[lane] += 1;
  }

  return {
    ok: true,
    duplicate: false,
    reason: null,
    reservation,
    state: {
      ...current,
      quota: nextQuota,
      lane_usage: {
        normal: nextNormalUsage,
        reserve: nextReserveUsage
      },
      attempts: {
        ...current.attempts,
        [attemptId]: reservation
      }
    }
  };
}

export function canAdvanceAttemptPhase(currentPhase, nextPhase) {
  const currentIndex = ATTEMPT_PHASES.indexOf(currentPhase);
  const nextIndex = ATTEMPT_PHASES.indexOf(nextPhase);
  return currentIndex >= 0 && nextIndex >= 0 && (nextIndex === currentIndex || nextIndex === currentIndex + 1);
}

export function advanceAttemptPhase(state, attemptId, nextPhase, now = Date.now(), patch = null) {
  const current = normalizeCollectorState(state, toEpochMilliseconds(now));
  const existing = current.attempts[String(attemptId)];
  if (!existing) {
    throw new Error(`알 수 없는 수집 시도입니다: ${attemptId}`);
  }
  if (!canAdvanceAttemptPhase(existing.phase, nextPhase)) {
    throw new Error(`수집 단계는 ${existing.phase}에서 ${nextPhase}(으)로 이동할 수 없습니다.`);
  }
  if (existing.phase === nextPhase && !patch) {
    return current;
  }

  const timestamp = new Date(toEpochMilliseconds(now)).toISOString();
  const timestampKey = `${nextPhase}_at`;
  const updated = {
    ...existing,
    ...copyPlainObject(patch),
    phase: nextPhase,
    [timestampKey]: existing[timestampKey] || timestamp
  };
  return {
    ...current,
    attempts: {
      ...current.attempts,
      [String(attemptId)]: updated
    }
  };
}

export function releaseUnrequestedReservation(state, attemptId, now = Date.now()) {
  const current = rolloverCollectorState(state, now);
  const key = String(attemptId);
  const attempt = current.attempts[key];
  if (!attempt) {
    return current;
  }
  if (attempt.phase !== "reserved") {
    throw new Error("요청이 시작된 예약은 일일 사용량에서 되돌릴 수 없습니다.");
  }
  if (
    attempt.day_key !== current.day_key ||
    !attemptBelongsToQuotaSession(attempt, current.quota_session)
  ) {
    const attempts = { ...current.attempts };
    delete attempts[key];
    return { ...current, attempts };
  }

  const quota = normalizeQuota(current.quota);
  const normalUsage = normalizeLaneUsage(current.lane_usage && current.lane_usage.normal);
  const reserveUsage = normalizeLaneUsage(current.lane_usage && current.lane_usage.reserve);
  const usage = attempt.pool === "reserve" ? reserveUsage : normalUsage;
  usage[attempt.lane] = Math.max(0, usage[attempt.lane] - 1);

  const attempts = { ...current.attempts };
  delete attempts[key];
  return {
    ...current,
    quota: {
      ...quota,
      normal_reserved: Math.max(0, quota.normal_reserved - (attempt.pool === "normal" ? 1 : 0)),
      reserve_reserved: Math.max(0, quota.reserve_reserved - (attempt.pool === "reserve" ? 1 : 0)),
      reserve_recovery_reserved: Math.max(
        0,
        quota.reserve_recovery_reserved - (attemptQuotaPurpose(attempt) === "recovery" ? 1 : 0)
      ),
      reserve_borrowed_for_normal: Math.max(
        0,
        quota.reserve_borrowed_for_normal - (attemptQuotaPurpose(attempt) === "normal_overflow" ? 1 : 0)
      ),
      total_reserved: Math.max(0, quota.total_reserved - 1)
    },
    lane_usage: {
      normal: normalUsage,
      reserve: reserveUsage
    },
    attempts
  };
}

export function interruptedRecoveryActions(state, now = Date.now()) {
  const current = rolloverCollectorState(state, now);
  return Object.keys(current.attempts)
    .sort(compareText)
    .map((attemptId) => current.attempts[attemptId])
    .filter((attempt) => attempt && attempt.phase !== "committed")
    .map((attempt) => {
      if (attempt.phase === "received") {
        return {
          attempt_id: attempt.attempt_id,
          action: "commit_received",
          requires_new_reservation: false,
          replay_page: null
        };
      }
      if (attempt.phase === "requested") {
        return {
          attempt_id: attempt.attempt_id,
          action: "replay_request",
          requires_new_reservation: true,
          replay_page: attempt.page_number || 1
        };
      }
      return {
        attempt_id: attempt.attempt_id,
        action: "resume_reserved",
        requires_new_reservation: attempt.day_key !== current.day_key,
        replay_page: attempt.page_number || 1
      };
    });
}

export function recoverInterruptedState(state, now = Date.now()) {
  const timestamp = toEpochMilliseconds(now);
  const current = rolloverCollectorState(state, timestamp);
  return {
    state: {
      ...current,
      last_recovery_at: new Date(timestamp).toISOString()
    },
    actions: interruptedRecoveryActions(current, timestamp)
  };
}

export function emptyBackoffDays(consecutiveEmptyResults) {
  const streak = nonNegativeInteger(consecutiveEmptyResults);
  if (streak <= 0) {
    return 0;
  }
  return EMPTY_BACKOFF_DAYS[Math.min(streak, EMPTY_BACKOFF_DAYS.length) - 1];
}

export function applyEmptyBackoff(task, now = Date.now()) {
  const current = task || {};
  const streak = nonNegativeInteger(current.consecutive_empty_results) + 1;
  const dayKey = toKstDateKey(now);
  const delayDays = emptyBackoffDays(streak);
  return {
    ...current,
    consecutive_empty_results: streak,
    last_empty_date: dayKey,
    next_eligible_date: addKstDays(dayKey, delayDays),
    next_eligible_reason: "empty_result"
  };
}

export function clearEmptyBackoff(task) {
  return {
    ...(task || {}),
    consecutive_empty_results: 0,
    last_empty_date: null,
    next_eligible_date: null,
    next_eligible_reason: null
  };
}

/** Distinguish retry failures from empty-result backoff, including legacy state. */
export function inferNextEligibleReason(record = {}) {
  if (["failure", "empty_result"].includes(record.next_eligible_reason)) {
    return record.next_eligible_reason;
  }
  if (!record.next_eligible_date && !record.next_eligible_at) return null;
  if (nonNegativeInteger(record.consecutive_empty_results) > 0) return "empty_result";
  if (record.retry === true || nonNegativeInteger(record.failures) > 0) return "failure";
  return null;
}

export function isCandidateEligible(candidate, context = {}) {
  if (!candidate || candidate.eligible === false || candidate.blocked === true || candidate.completed === true) {
    return false;
  }
  const lane = candidateLane(candidate);
  if (!Object.prototype.hasOwnProperty.call(LANE_PLAN, lane)) {
    return false;
  }
  const now = context.now == null ? Date.now() : context.now;
  const today = toKstDateKey(now);
  const failureDateOverride = candidate.failure_recheck === true &&
    inferNextEligibleReason(candidate) === "failure";
  if (candidate.next_eligible_date && candidate.next_eligible_date > today && !failureDateOverride) {
    return false;
  }
  if (candidate.next_eligible_at) {
    const eligibleAt = Date.parse(candidate.next_eligible_at);
    if (Number.isFinite(eligibleAt) && eligibleAt > toEpochMilliseconds(now)) {
      return false;
    }
  }
  if (candidate.retry === true) return true;
  if (failureDateOverride) return true;
  const usage = contextLaneUsage(context);
  return laneDeficit(lane, usage, context.plan || LANE_PLAN) > 0 ||
    context.allow_normal_overflow === true ||
    context.allow_normal_rebalance === true;
}

export function compareCollectorCandidates(left, right, context = {}) {
  const leftRetry = left?.retry === true ? 0 : 1;
  const rightRetry = right?.retry === true ? 0 : 1;
  if (leftRetry !== rightRetry) {
    return leftRetry - rightRetry;
  }

  const leftEligible = isCandidateEligible(left, context) ? 0 : 1;
  const rightEligible = isCandidateEligible(right, context) ? 0 : 1;
  if (leftEligible !== rightEligible) {
    return leftEligible - rightEligible;
  }

  const leftFailureRecheck = left?.failure_recheck === true ? 0 : 1;
  const rightFailureRecheck = right?.failure_recheck === true ? 0 : 1;
  if (leftFailureRecheck !== rightFailureRecheck) {
    return leftFailureRecheck - rightFailureRecheck;
  }

  const priorityDifference = candidatePriority(left) - candidatePriority(right);
  if (priorityDifference !== 0) {
    return priorityDifference;
  }

  const usage = contextLaneUsage(context);
  const plan = context.plan || LANE_PLAN;
  const leftDeficit = candidateDeficit(left, usage, plan);
  const rightDeficit = candidateDeficit(right, usage, plan);
  if (leftDeficit !== rightDeficit) {
    return rightDeficit - leftDeficit;
  }

  const oldestDifference = candidateOldestTimestamp(left) - candidateOldestTimestamp(right);
  if (oldestDifference !== 0) {
    return oldestDifference;
  }
  return compareText(candidateId(left), candidateId(right));
}

export function rankCollectorCandidates(candidates, context = {}) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => {
      const compared = compareCollectorCandidates(left.candidate, right.candidate, context);
      return compared || left.index - right.index;
    })
    .map((entry) => entry.candidate);
}

export function selectNextCandidate(candidates, context = {}) {
  const plannedContext = context.allow_normal_rebalance === true
    ? { ...context, allow_normal_rebalance: false }
    : context;
  const planned = rankCollectorCandidates(candidates, plannedContext)
    .find((candidate) => isCandidateEligible(candidate, plannedContext));
  if (planned || context.allow_normal_rebalance !== true) return planned || null;

  const rebalancedContext = { ...context, allow_normal_rebalance: true };
  return rankCollectorCandidates(candidates, rebalancedContext)
    .find((candidate) => isCandidateEligible(candidate, rebalancedContext)) || null;
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const keys = Object.keys(value).sort(compareText);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export function listingBoundaryIdentity(item) {
  const listing = item && item.listing ? item.listing : item || {};
  const listingId = listing.listing_id || null;
  const listingIdSource = listing.listing_id_source || null;
  if (listingId && (
    listingIdSource === "native" ||
    String(listingIdSource).startsWith("dom_attribute:") ||
    String(listingIdSource).startsWith("url_parameter:")
  )) {
    return `native:${listingId}`;
  }
  if (listing.listing_fingerprint) {
    return `fingerprint:${listing.listing_fingerprint}`;
  }
  return null;
}

export function pageRowKey(item, index = 0) {
  const source = item || {};
  const listing = source.listing || source;
  const itemData = source.item || {};
  return stableStringify({
    identity: listingBoundaryIdentity(item),
    sold_at: listing.sold_at || null,
    price_meso: listing.price_meso || null,
    item_name: itemData.name || source.name || null,
    row_index: source.row_index || index + 1
  });
}

export function createPageSignature(items) {
  const rows = (Array.isArray(items) ? items : []).map((item, index) => pageRowKey(item, index));
  return `page-v1:${hashText(rows.join("\n"))}:${rows.length}`;
}

export function createStructuredPageSignature(items) {
  const rows = (Array.isArray(items) ? items : []).map((item) => stableStringify({
    listing_hash: item?.source_hashes?.listing || null,
    item_hash: item?.source_hashes?.item || null,
    item_name: item?.itemName || item?.toolTip?.itemName || item?.name || null,
    price_meso: item?.price == null ? null : String(item.price),
    quantity: item?.quantity == null ? null : Number(item.quantity),
    sold_at: item?.tradeDate || null
  }));
  return `structured-page-v1:${hashText(rows.join("\n"))}:${rows.length}`;
}

export function createPageBoundary(items) {
  const rows = (Array.isArray(items) ? items : [])
    .map((item) => {
      const listing = item && item.listing ? item.listing : item || {};
      return {
        sold_at: listing.sold_at || null,
        identity: listingBoundaryIdentity(item)
      };
    })
    .filter((row) => row.sold_at && row.identity);
  if (rows.length === 0) {
    return null;
  }
  const soldAt = rows[rows.length - 1].sold_at;
  const identities = rows
    .filter((row) => row.sold_at === soldAt)
    .map((row) => row.identity)
    .sort(compareText);
  return {
    sold_at: soldAt,
    identities: Array.from(new Set(identities))
  };
}

export function boundaryOverlap(items, boundary) {
  if (!boundary || !boundary.sold_at || !Array.isArray(boundary.identities)) {
    return { matched: false, count: 0, identities: [] };
  }
  const wanted = new Set(boundary.identities);
  const identities = [];
  for (const item of Array.isArray(items) ? items : []) {
    const listing = item && item.listing ? item.listing : item || {};
    const identity = listingBoundaryIdentity(item);
    if (listing.sold_at === boundary.sold_at && identity && wanted.has(identity)) {
      identities.push(identity);
    }
  }
  const unique = Array.from(new Set(identities)).sort(compareText);
  return { matched: unique.length > 0, count: unique.length, identities: unique };
}

export function createPaginationState(options = {}) {
  const continuationAnchor = options.continuation_anchor &&
    positiveIntegerOrNull(options.continuation_anchor.page) &&
    typeof options.continuation_anchor.signature === "string" &&
    options.continuation_anchor.signature
    ? {
        page: positiveIntegerOrNull(options.continuation_anchor.page),
        signature: options.continuation_anchor.signature
      }
    : null;
  return {
    current_page: positiveIntegerOrNull(options.current_page) || 1,
    last_committed_page: nonNegativeInteger(options.last_committed_page),
    last_signature: options.last_signature || null,
    seen_signatures: Array.isArray(options.seen_signatures) ? [...options.seen_signatures] : [],
    continuation_anchor: continuationAnchor,
    committed_rows: nonNegativeInteger(options.committed_rows),
    effective_page_limit: positiveIntegerOrNull(options.effective_page_limit),
    total_results: nonNegativeIntegerOrNull(options.total_results),
    stop_boundary: options.stop_boundary || null,
    boundary_reached: options.boundary_reached === true,
    overlap_pages_remaining: nonNegativeInteger(
      options.overlap_pages_remaining == null ? 1 : options.overlap_pages_remaining
    ),
    done: options.done === true,
    stop_reason: options.stop_reason || null
  };
}

export function evaluateCollectedPage(paginationState, page) {
  const current = createPaginationState(paginationState || {});
  const items = page && Array.isArray(page.items) ? page.items : [];
  const pageNumber = positiveIntegerOrNull(page && page.page_number) || current.current_page;
  const signature = createPageSignature(items);
  // Equal-looking listings can legitimately occupy consecutive sold-result
  // pages.  Only reject a signature when the same page number is replayed;
  // the manager separately verifies the URL page and search key.
  const repeated = current.seen_signatures.includes(signature) &&
    pageNumber <= current.last_committed_page;
  const overlap = boundaryOverlap(items, current.stop_boundary);
  const effectiveLimit = positiveIntegerOrNull(page && page.effective_page_limit);
  const rowCount = nonNegativeIntegerOrNull(page && page.row_count) ?? items.length;
  const totalResults = nonNegativeIntegerOrNull(page && page.total_results) ?? current.total_results;
  const hasNextPage = page ? page.has_next_page : null;
  const inferredEnd = hasNextPage == null && effectiveLimit != null && rowCount < effectiveLimit;

  if (repeated) {
    return pageDecision(current, {
      action: "stop",
      reason: "repeated_page_signature",
      commit_page: false,
      signature,
      page_number: pageNumber,
      boundary_overlap: overlap
    });
  }

  const seenSignatures = [...current.seen_signatures, signature];
  const nextBase = {
    ...current,
    last_committed_page: pageNumber,
    last_signature: signature,
    seen_signatures: seenSignatures,
    committed_rows: current.committed_rows + rowCount,
    effective_page_limit: effectiveLimit || current.effective_page_limit,
    total_results: totalResults
  };

  if (rowCount === 0) {
    return pageDecision(nextBase, {
      action: "stop",
      reason: "empty_page",
      commit_page: true,
      signature,
      page_number: pageNumber,
      boundary_overlap: overlap
    });
  }
  if (hasNextPage === false || inferredEnd) {
    return pageDecision(nextBase, {
      action: "stop",
      reason: hasNextPage === false ? "last_page" : "short_page",
      commit_page: true,
      signature,
      page_number: pageNumber,
      boundary_overlap: overlap
    });
  }

  let boundaryReached = current.boundary_reached;
  let overlapRemaining = current.overlap_pages_remaining;
  if (boundaryReached) {
    overlapRemaining = Math.max(0, overlapRemaining - 1);
    if (overlapRemaining === 0) {
      return pageDecision({
        ...nextBase,
        boundary_reached: true,
        overlap_pages_remaining: 0
      }, {
        action: "stop",
        reason: "boundary_overlap_complete",
        commit_page: true,
        signature,
        page_number: pageNumber,
        boundary_overlap: overlap
      });
    }
  } else if (overlap.matched) {
    boundaryReached = true;
    if (overlapRemaining === 0) {
      return pageDecision({
        ...nextBase,
        boundary_reached: true,
        overlap_pages_remaining: 0
      }, {
        action: "stop",
        reason: "boundary_reached",
        commit_page: true,
        signature,
        page_number: pageNumber,
        boundary_overlap: overlap
      });
    }
  }

  const nextPage = pageNumber + 1;
  return pageDecision({
    ...nextBase,
    current_page: nextPage,
    boundary_reached: boundaryReached,
    overlap_pages_remaining: overlapRemaining
  }, {
    action: "continue",
    reason: boundaryReached ? "collect_overlap" : "more_pages",
    commit_page: true,
    signature,
    page_number: pageNumber,
    next_page: nextPage,
    boundary_overlap: overlap
  });
}

export function pageShiftDetected(expectedSignature, observedSignature) {
  return Boolean(expectedSignature && observedSignature && expectedSignature !== observedSignature);
}

export function replayPageAfterShift(pageNumber) {
  const page = positiveIntegerOrNull(pageNumber) || 1;
  return Math.max(1, page - 1);
}

export function calibratePageLimit(observation, now = Date.now()) {
  const value = observation || {};
  const requested = positiveIntegerOrNull(value.requested_limit) || REQUESTED_PAGE_LIMIT;
  const reported = positiveIntegerOrNull(value.reported_limit);
  const actual = nonNegativeInteger(value.actual_count);
  const totalResults = nonNegativeIntegerOrNull(value.total_results);
  const moreResults = value.has_next_page === true || (totalResults != null && totalResults > actual);
  const calibratedAt = new Date(toEpochMilliseconds(now)).toISOString();

  if (reported === FALLBACK_PAGE_LIMIT && requested === REQUESTED_PAGE_LIMIT) {
    return pageLimitResult(requested, FALLBACK_PAGE_LIMIT, "fallback_40", "site_reported_40", calibratedAt);
  }
  if (actual === requested) {
    return pageLimitResult(requested, requested, "confirmed_60", "requested_count_observed", calibratedAt);
  }
  if (requested === REQUESTED_PAGE_LIMIT && actual === FALLBACK_PAGE_LIMIT && moreResults) {
    return pageLimitResult(requested, FALLBACK_PAGE_LIMIT, "fallback_40", "40_rows_with_more_results", calibratedAt);
  }
  if (!moreResults && actual < requested) {
    return pageLimitResult(requested, null, "inconclusive", "short_last_page", calibratedAt);
  }
  return pageLimitResult(requested, null, "unexpected", `unexpected_row_count:${actual}`, calibratedAt);
}

export function effectivePageLimit(calibration) {
  const value = calibration || {};
  return positiveIntegerOrNull(value.effective_limit) || REQUESTED_PAGE_LIMIT;
}

function normalizeCollectorState(state, now) {
  const current = state || createCollectorState(now);
  const dayKey = current.day_key || toKstDateKey(now);
  const dailyStartedAt = current.daily_started_at || new Date(now).toISOString();
  return {
    ...current,
    schema_version: current.schema_version || "maple-auction.collector-state.v1",
    day_key: dayKey,
    daily_started_at: dailyStartedAt,
    quota: normalizeQuota(current.quota),
    quota_session: normalizeQuotaSession(current.quota_session, {
      ...current,
      day_key: dayKey,
      daily_started_at: dailyStartedAt
    }, now),
    lane_usage: {
      normal: normalizeLaneUsage(current.lane_usage && current.lane_usage.normal),
      reserve: normalizeLaneUsage(current.lane_usage && current.lane_usage.reserve)
    },
    attempts: { ...(current.attempts || {}) },
    page_limit_calibration: {
      ...createPageLimitCalibration(),
      ...(current.page_limit_calibration || {})
    },
    last_recovery_at: current.last_recovery_at || null
  };
}

function normalizeQuota(quota) {
  const current = quota || {};
  const normal = nonNegativeInteger(current.normal_reserved);
  const reserve = nonNegativeInteger(current.reserve_reserved);
  const normalizedReserve = Math.min(reserve, RESERVE_QUERY_LIMIT);
  const borrowed = Math.min(
    normalizedReserve,
    nonNegativeInteger(current.reserve_borrowed_for_normal)
  );
  const recovery = Math.min(
    normalizedReserve - borrowed,
    nonNegativeInteger(current.reserve_recovery_reserved)
  );
  return {
    normal_limit: NORMAL_QUERY_LIMIT,
    reserve_limit: RESERVE_QUERY_LIMIT,
    hard_limit: HARD_QUERY_LIMIT,
    normal_reserved: Math.min(normal, NORMAL_QUERY_LIMIT),
    reserve_reserved: normalizedReserve,
    reserve_recovery_reserved: recovery,
    reserve_borrowed_for_normal: borrowed,
    total_reserved: Math.min(normal + normalizedReserve, HARD_QUERY_LIMIT)
  };
}

function normalizeQuotaSession(session, state, now) {
  const current = session || {};
  const dayKey = state?.day_key || toKstDateKey(now);
  const startedAt = current.started_at || state?.daily_started_at || new Date(now).toISOString();
  const observed = Math.min(
    HARD_QUERY_LIMIT,
    nonNegativeInteger(state?.site_search_usage?.used ?? state?.quota?.total_reserved)
  );
  return createQuotaSession(startedAt, {
    id: current.id,
    ordinal: current.ordinal,
    day_key: current.day_key || dayKey,
    started_at: startedAt,
    baseline_site_used: current.baseline_site_used,
    last_site_used: current.last_site_used == null ? observed : current.last_site_used,
    switch_reason: current.switch_reason == null
      ? (session ? null : "legacy_state")
      : current.switch_reason
  });
}

function attemptQuotaPurpose(attempt) {
  const explicit = String(attempt?.quota_purpose || "");
  if (QUOTA_PURPOSES.includes(explicit)) return explicit;
  return attempt?.pool === "reserve" ? "recovery" : "normal";
}

function attemptBelongsToQuotaSession(attempt, session) {
  if (!attempt || !session) return false;
  if (attempt.quota_session_id != null) {
    return String(attempt.quota_session_id) === String(session.id);
  }
  return session.ordinal === 1 && attempt.day_key === session.day_key;
}

function hasOpenAttemptForQuotaSession(state, session) {
  return Object.values(state?.attempts || {}).some((attempt) =>
    attemptBelongsToQuotaSession(attempt, session) && attempt?.phase !== "committed"
  );
}

function normalizeLaneUsage(usage) {
  const normalized = createLaneUsage();
  for (const lane of LANE_NAMES) {
    normalized[lane] = nonNegativeInteger(usage && usage[lane]);
  }
  return normalized;
}

function reservationFailure(state, reason) {
  return { ok: false, duplicate: false, reason, state, reservation: null };
}

function pageDecision(state, decision) {
  const done = decision.action === "stop";
  return {
    state: {
      ...state,
      done,
      stop_reason: done ? decision.reason : null
    },
    decision
  };
}

function pageLimitResult(requested, effective, status, reason, calibratedAt) {
  return {
    requested_limit: requested,
    effective_limit: effective,
    status,
    reason,
    calibrated_at: calibratedAt
  };
}

function candidateLane(candidate) {
  return String(candidate && candidate.lane || "");
}

function contextLaneUsage(context) {
  const source = context || {};
  const usage = source.lane_usage || source.laneUsage ||
    (source.state && source.state.lane_usage) || {};
  return usage.normal || usage;
}

function candidatePriority(candidate) {
  const value = candidate && candidate.priority;
  if (typeof value === "string" && /^P\d+$/i.test(value)) {
    return Number(value.slice(1));
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function candidateDeficit(candidate, usage, plan) {
  if (candidate && Number.isFinite(Number(candidate.deficit))) {
    return Math.max(0, Number(candidate.deficit));
  }
  return laneDeficit(candidateLane(candidate), usage, plan);
}

function candidateOldestTimestamp(candidate) {
  const value = candidate && (
    candidate.last_success_at ||
    candidate.last_success ||
    candidate.last_collected_at ||
    candidate.last_completed_at
  );
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function candidateId(candidate) {
  return String(candidate && (candidate.id || candidate.task_id || candidate.preset_id) || "");
}

function positiveIntegerOrNull(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeIntegerOrNull(value) {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function nonNegativeInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function copyPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}

function toEpochMilliseconds(value) {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    if (Number.isFinite(timestamp)) {
      return timestamp;
    }
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) {
      return timestamp;
    }
  }
  throw new Error("유효한 날짜 또는 시간이 필요합니다.");
}

function parseDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey));
  if (!match) {
    throw new Error(`잘못된 KST 날짜 키입니다: ${dateKey}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const checked = new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
  if (checked !== dateKey) {
    throw new Error(`존재하지 않는 KST 날짜입니다: ${dateKey}`);
  }
  return { year, month, day };
}

function hashText(value) {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}

function compareText(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}
