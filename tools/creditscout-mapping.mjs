/**
 * Pure mapping from CreditScout database rows to a creditapp-evals recording.
 *
 * No network, no file system: `export-creditscout-run.mjs` does the reading and
 * the writing, this module only decides what a row means. Unit tested in
 * `creditscout-mapping.test.js`.
 *
 * The recording format the grader reads is
 *   { case_id, verdict: "breach" | "no-breach" | "abstain", dscr, citations[], explanation }
 * plus provenance fields the grader ignores.
 */

/** CreditScout casefile recommendation -> grader verdict. `request` has no clean equivalent. */
export const RECOMMENDATION_TO_VERDICT = Object.freeze({
  escalate: "breach",
  resolve: "no-breach",
  abstain: "abstain",
});

/** CreditScout oracle `expected_outcome` -> expected grader verdict. */
export const EXPECTED_OUTCOME_TO_VERDICT = Object.freeze({
  resolve: "no-breach",
  escalate: "breach",
  compliant_no_action: "no-breach",
  variance_logged_no_investigation: "no-breach",
});

/** Code-only test outcomes (no investigation ran) -> grader verdict. */
export const CODE_OUTCOME_TO_VERDICT = Object.freeze({
  compliant: "no-breach",
  variance_logged: "no-breach",
});

/**
 * The marker CreditScout's `codeAbstain` (lib/agent/enforce.ts) writes when the
 * agent's own answer could not be used, for example at the step cap. When it is
 * present the explanation was written by CreditScout code, not by the agent.
 */
export const CODE_ABSTAIN_BASIS = "No verifiable answer was produced.";

/** Map a recommendation. Unknown or unmappable values come back as verdict null with a flag, never guessed. */
export function mapRecommendation(recommendation) {
  if (Object.prototype.hasOwnProperty.call(RECOMMENDATION_TO_VERDICT, recommendation)) {
    return { verdict: RECOMMENDATION_TO_VERDICT[recommendation], mapping_flag: null };
  }
  return {
    verdict: null,
    mapping_flag: `recommendation "${recommendation ?? "none"}" has no breach / no-breach / abstain equivalent; recorded as is, verdict left null`,
  };
}

/** Map an oracle expected outcome to the expected verdict; throws on anything not in the table. */
export function expectedVerdict(expectedOutcome) {
  if (!Object.prototype.hasOwnProperty.call(EXPECTED_OUTCOME_TO_VERDICT, expectedOutcome)) {
    throw new Error(`no expected-verdict mapping for oracle outcome "${expectedOutcome}"`);
  }
  return EXPECTED_OUTCOME_TO_VERDICT[expectedOutcome];
}

/**
 * The code path a quarterly test took, mirroring CreditScout's `reconcile`
 * (lib/tests/run.ts): an exception row means an investigation; otherwise a
 * flagged variance is `variance_logged` and a clean pass is `compliant`.
 * A failing test with no exception row is inconsistent and returns null.
 */
export function codeOutcome(test, hasException) {
  if (hasException) return "exception";
  if (test.passed !== true) return null;
  return test.variance_flagged ? "variance_logged" : "compliant";
}

/** Distinct claim citations, in the order the agent first gave them. */
export function claimCitations(claims) {
  if (!Array.isArray(claims)) return [];
  const seen = new Set();
  const out = [];
  for (const c of claims) {
    const label = typeof c?.citation === "string" ? c.citation.trim() : "";
    if (label !== "" && !seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out;
}

/** The raw recommendation inside `casefiles.agent_output`, or null when absent or unparseable. */
export function rawAgentRecommendation(agentOutput) {
  if (typeof agentOutput !== "string" || agentOutput.trim() === "") return null;
  try {
    const parsed = JSON.parse(agentOutput);
    return typeof parsed?.recommendation === "string" ? parsed.recommendation : null;
  } catch {
    return null;
  }
}

/**
 * The DSCR a casefile relied on: its governing calculation. CreditScout writes
 * `casefiles.terms.calc_id` as the last calculation logged for the casefile
 * (lib/agent/enforce.ts `writeEnforced`); its value is `calc_log.outputs.dscr`.
 */
export function governingDscr(governingCalcId, calcById) {
  if (!governingCalcId) return null;
  const row = calcById.get(governingCalcId);
  const dscr = row?.outputs?.dscr;
  return typeof dscr === "number" ? dscr : null;
}

/**
 * Build one recording.
 *
 * @param {object} a
 * @param {string} a.caseId
 * @param {string} a.pass                 "cold" | "warm"
 * @param {object} a.test                 tests row
 * @param {object|null} a.exception       exceptions row for the test, or null
 * @param {object|null} a.casefile        casefiles row for the exception, or null
 * @param {string|null} a.governingCalcId casefiles.terms->>calc_id
 * @param {Map} a.calcById                calc_id -> calc_log row
 * @param {object} a.provenance           run-level fields (commit, models, eval run row)
 */
export function buildRecording({ caseId, pass, test, exception, casefile, governingCalcId, calcById, provenance }) {
  const outcome = codeOutcome(test, Boolean(exception));
  const base = {
    case_id: caseId,
    pass,
  };

  if (outcome === "compliant" || outcome === "variance_logged") {
    return {
      ...base,
      verdict: CODE_OUTCOME_TO_VERDICT[outcome],
      dscr: typeof test.computed_dscr === "number" ? test.computed_dscr : null,
      citations: [],
      explanation: null,
      decided_by: "code",
      code_outcome: outcome,
      decided_by_note: "No exception was raised, so no agent investigation ran. CreditScout's deterministic quarterly test decided this case; there is no agent explanation and none is invented here.",
      provenance: {
        ...provenance,
        test_id: test.id,
        casefile_id: null,
        recorded_at: test.created_at,
        computed_dscr: test.computed_dscr,
        reported_dscr: test.reported_dscr,
        threshold: test.threshold,
      },
    };
  }

  if (outcome === "exception" && casefile) {
    const { verdict, mapping_flag } = mapRecommendation(casefile.recommendation);
    const raw = rawAgentRecommendation(casefile.agent_output);
    const codeWritten = casefile.confidence_basis === CODE_ABSTAIN_BASIS;
    const notes = Array.isArray(casefile.guardrail_notes) ? casefile.guardrail_notes : [];
    return {
      ...base,
      verdict,
      dscr: governingDscr(governingCalcId, calcById),
      citations: claimCitations(casefile.claims),
      explanation: casefile.explanation ?? null,
      decided_by: "agent",
      code_outcome: "exception",
      recommendation: casefile.recommendation ?? null,
      agent_raw_recommendation: raw,
      verdict_changed_by_guardrail: raw !== null && casefile.recommendation !== null && raw !== casefile.recommendation,
      explanation_source: codeWritten ? "creditscout-code" : "agent",
      mapping_flag,
      suggested_tag: casefile.suggested_tag ?? null,
      confidence_basis: casefile.confidence_basis ?? null,
      claims: Array.isArray(casefile.claims) ? casefile.claims : [],
      guardrail_notes: notes,
      steps: casefile.steps_count ?? null,
      provenance: {
        ...provenance,
        test_id: test.id,
        exception_id: exception.id,
        casefile_id: casefile.id,
        governing_calc_id: governingCalcId ?? null,
        recorded_at: casefile.created_at,
        computed_dscr: test.computed_dscr,
        reported_dscr: test.reported_dscr,
        threshold: test.threshold,
      },
    };
  }

  return {
    ...base,
    verdict: null,
    dscr: null,
    citations: [],
    explanation: null,
    decided_by: null,
    code_outcome: outcome,
    mapping_flag: outcome === "exception"
      ? "an exception was raised but no casefile was found for this run"
      : "the test row is inconsistent (failed with no exception row)",
    provenance: { ...provenance, test_id: test.id, recorded_at: test.created_at },
  };
}

/**
 * Serialise for disk. Em and en dashes in verbatim CreditScout text are written
 * as JSON unicode escapes, so the file holds no literal dash characters while
 * the parsed value stays byte-for-byte what the database returned.
 */
export function serialiseRecording(recording) {
  return JSON.stringify(recording, null, 2)
    .replace(/\u2014/g, "\\u2014")
    .replace(/\u2013/g, "\\u2013") + "\n";
}
