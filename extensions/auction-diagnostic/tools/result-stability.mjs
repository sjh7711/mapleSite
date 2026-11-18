export const DEFAULT_RESULT_STABLE_MS = 700;

export function createResultStabilityState() {
  return {
    signature: null,
    stable_since: null,
    stable_poll_count: 0
  };
}

/**
 * A new priceSearchKey only proves that the SPA changed its URL.  It does not
 * prove that the rows now belong to that search.  Keep this gate deliberately
 * strict: the content script must first prove a new result generation, then
 * the same ready DOM snapshot must survive more than one poll.
 */
export function observeResultStability(
  previousState,
  observation,
  observedAt = Date.now(),
  stableMs = DEFAULT_RESULT_STABLE_MS
) {
  const state = previousState || createResultStabilityState();
  const eligible = resultObservationIsEligible(observation);
  if (!eligible) {
    return {
      state: createResultStabilityState(),
      ready: false,
      stable_for_ms: 0,
      stable_poll_count: 0
    };
  }

  const signature = observation.result_signature;
  const sameSignature = state.signature === signature;
  const stableSince = sameSignature && Number.isFinite(state.stable_since)
    ? state.stable_since
    : observedAt;
  const stablePollCount = sameSignature
    ? Number(state.stable_poll_count || 0) + 1
    : 1;
  const stableForMs = Math.max(0, observedAt - stableSince);
  const mutationQuiet = observation.document_replaced === true ||
    Number(observation.last_result_mutation_age_ms) >= stableMs;
  const nextState = {
    signature,
    stable_since: stableSince,
    stable_poll_count: stablePollCount
  };

  return {
    state: nextState,
    ready: mutationQuiet && stablePollCount >= 2 && stableForMs >= stableMs,
    stable_for_ms: stableForMs,
    stable_poll_count: stablePollCount
  };
}

export function resultObservationIsEligible(observation) {
  return Boolean(
    observation?.attempt_matches === true &&
    observation?.fresh_price_search_key === true &&
    observation?.result_context_matches === true &&
    observation?.result_generation_changed === true &&
    observation?.result_heading_visible === true &&
    observation?.result_ready === true &&
    observation?.result_busy === false &&
    typeof observation?.requires_exact_rows === "boolean" &&
    observation?.row_scope_valid === true &&
    (observation.requires_exact_rows === false || observation?.all_rows_exact === true) &&
    typeof observation?.result_signature === "string" &&
    observation.result_signature.length > 0
  );
}
