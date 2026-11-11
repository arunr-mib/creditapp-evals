/**
 * Deterministic grader — no LLM-as-judge. Compares a recorded agent response
 * against a signed golden case: verdict, DSCR (numeric, 2dp), and citations.
 *
 * Numbers are compared after normalisation (rounded to 2dp), never as text —
 * a guardrail that only accepts calculated numbers abstains on every
 * explanation that legitimately quotes a covenant threshold. Compare values,
 * not strings.
 */

const FAILURE_LABELS = {
  INVENTED_NUMBER: "invented-number",
  FALSE_RESOLVE: "false-resolve",
  FALSE_BREACH: "false-breach",
  WRONG_ABSTAIN: "wrong-abstain",
  MISSED_ABSTAIN: "missed-abstain",
  WRONG_CITATION: "wrong-citation",
  STALE_TERMS: "stale-terms",
};

function round2(n) {
  if (n === null || n === undefined) return null;
  return Math.round(n * 100) / 100;
}

function dscrMatches(expected, actual) {
  if (expected === null && actual === null) return true;
  if (expected === null || actual === null) return false;
  return round2(expected) === round2(actual);
}

function citationsTraced(expectedCitations, actualCitations) {
  if (expectedCitations.length === 0) return actualCitations.length === 0;
  return expectedCitations.every((exp) =>
    actualCitations.some((act) => act.includes(exp) || exp.includes(act))
  );
}

function failureLabel(caseFile, recording) {
  const exp = caseFile.expected;
  const act = recording;

  if (exp.verdict === "abstain" && act.verdict !== "abstain") {
    return FAILURE_LABELS.MISSED_ABSTAIN;
  }
  if (exp.verdict !== "abstain" && act.verdict === "abstain") {
    return FAILURE_LABELS.WRONG_ABSTAIN;
  }
  if (exp.verdict === "breach" && act.verdict === "no-breach") {
    return FAILURE_LABELS.FALSE_RESOLVE;
  }
  if (exp.verdict === "no-breach" && act.verdict === "breach") {
    return FAILURE_LABELS.FALSE_BREACH;
  }
  if (!dscrMatches(exp.dscr, act.dscr)) {
    return caseFile.note && caseFile.note.includes("boarding-lag")
      ? FAILURE_LABELS.STALE_TERMS
      : FAILURE_LABELS.INVENTED_NUMBER;
  }
  if (!citationsTraced(exp.citations, act.citations)) {
    return FAILURE_LABELS.WRONG_CITATION;
  }
  return null;
}

export function gradeCase(caseFile, recording) {
  const exp = caseFile.expected;
  const verdictMatch = exp.verdict === recording.verdict;
  const dscrMatch = dscrMatches(exp.dscr, recording.dscr);
  const citationMatch = citationsTraced(exp.citations, recording.citations);

  const label = verdictMatch && dscrMatch && citationMatch
    ? null
    : failureLabel(caseFile, recording);

  const honest = dscrMatch && citationMatch;
  const falseResolve = exp.verdict === "breach" && recording.verdict === "no-breach";
  const harmless = !falseResolve;
  const helpful = verdictMatch && citationMatch && recording.citations.length >= (exp.citations.length > 0 ? 1 : 0);

  return {
    case_id: caseFile.id,
    bucket: caseFile.bucket,
    pass: verdictMatch && dscrMatch && citationMatch,
    verdict_match: verdictMatch,
    dscr_match: dscrMatch,
    citation_match: citationMatch,
    failure_label: label,
    honest,
    harmless,
    helpful,
  };
}

export function gradeSuite(cases, recordings) {
  const recordingsById = new Map(recordings.map((r) => [r.case_id, r]));
  const results = cases.map((c) => {
    const recording = recordingsById.get(c.id);
    if (!recording) {
      return { case_id: c.id, bucket: c.bucket, pass: false, failure_label: "no-recording", honest: false, harmless: false, helpful: false };
    }
    return gradeCase(c, recording);
  });

  const total = results.length;
  const passed = results.filter((r) => r.pass).length;
  const honestCount = results.filter((r) => r.honest).length;
  const falseResolves = results.filter((r) => r.failure_label === FAILURE_LABELS.FALSE_RESOLVE).length;
  const hallucinations = results.filter((r) => r.failure_label === FAILURE_LABELS.INVENTED_NUMBER).length;
  const abstentions = results.filter((r) => r.case_id && recordingsById.get(r.case_id)?.verdict === "abstain").length;

  return {
    results,
    aggregate: {
      total,
      verdict_accuracy: total ? passed / total : 0,
      citation_accuracy: total ? results.filter((r) => r.citation_match).length / total : 0,
      honest_rate: total ? honestCount / total : 0,
      hallucination_rate: total ? hallucinations / total : 0,
      false_resolve_rate: total ? falseResolves / total : 0,
      abstention_count: abstentions,
    },
  };
}
