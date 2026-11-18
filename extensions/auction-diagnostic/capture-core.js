(() => {
  const MINIMUM_STAR_MARKER_COUNT = 5;

  function nonNegativeInteger(value) {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }

  function starforceObservationFromMarkerCounts(activeCount, inactiveCount) {
    const active = nonNegativeInteger(activeCount);
    const inactive = nonNegativeInteger(inactiveCount);
    if (active == null || inactive == null || active + inactive < MINIMUM_STAR_MARKER_COUNT) {
      return null;
    }
    return {
      value: active,
      applicable: true,
      source: "dom",
      confidence: "confirmed"
    };
  }

  function resolveStarforceEvidence({
    row_observation: rowObservation,
    tooltip_observation: tooltipObservation,
    starforce_eligible: starforceEligible,
    starforce_min: starforceMin,
    starforce_max: starforceMax
  } = {}) {
    const eligibility = typeof starforceEligible === "boolean" ? starforceEligible : null;
    const rowValue = nonNegativeInteger(rowObservation?.value);
    const tooltipValue = nonNegativeInteger(tooltipObservation?.value);
    const exactZeroFilter = starforceMin === 0 && starforceMax === 0;
    const exactPositiveFilter = Number.isInteger(starforceMin) && starforceMin > 0 &&
      starforceMax === starforceMin;
    const warnings = [];

    if (rowValue != null && tooltipValue != null && rowValue !== tooltipValue) {
      return {
        observation: unknownStarforce(eligibility),
        warnings: ["starforce_evidence_conflict:row_tooltip_mismatch"]
      };
    }

    const observed = tooltipValue != null
      ? { ...tooltipObservation, value: tooltipValue, applicable: true }
      : rowValue != null
        ? { ...rowObservation, value: rowValue, applicable: true }
        : null;

    if (observed) {
      if (eligibility === false) {
        warnings.push("starforce_evidence_conflict:catalog_marks_not_applicable");
      }
      if ((starforceMin != null && observed.value < starforceMin) ||
          (starforceMax != null && observed.value > starforceMax)) {
        return {
          observation: unknownStarforce(eligibility),
          warnings: [...warnings, "starforce_evidence_conflict:outside_submitted_filter"]
        };
      }
      return { observation: observed, warnings };
    }

    if (tooltipObservation?.applicable === false) {
      if (eligibility === true) {
        warnings.push("starforce_evidence_conflict:catalog_marks_applicable");
      }
      if (exactZeroFilter) {
        warnings.push("starforce_evidence_conflict:zero_filter_on_not_applicable_item");
      }
      return {
        observation: {
          value: null,
          applicable: false,
          source: tooltipObservation.source || "dom",
          confidence: tooltipObservation.confidence || "confirmed"
        },
        warnings
      };
    }

    if (eligibility === false) {
      return {
        observation: {
          value: null,
          applicable: false,
          source: "catalog",
          confidence: "confirmed"
        },
        warnings
      };
    }

    if (exactZeroFilter) {
      return {
        observation: {
          value: 0,
          applicable: true,
          source: "query_filter",
          confidence: "inferred"
        },
        warnings: ["starforce_zero_inferred_from_exact_filter"]
      };
    }

    if (exactPositiveFilter) {
      return {
        observation: {
          value: starforceMin,
          applicable: true,
          source: "query_filter",
          confidence: "inferred"
        },
        warnings: ["starforce_inferred_from_exact_filter"]
      };
    }

    return {
      observation: unknownStarforce(eligibility),
      warnings
    };
  }

  function unknownStarforce(eligibility) {
    return {
      value: null,
      applicable: eligibility === true ? true : null,
      source: "unknown",
      confidence: "unknown"
    };
  }

  globalThis.MapleAuctionCaptureCore = Object.freeze({
    resolveStarforceEvidence,
    starforceObservationFromMarkerCounts
  });
})();
