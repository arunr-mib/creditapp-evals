/**
 * Pure suite logic for the runner: which gate a product is held to, how a
 * product with several recorded passes is graded, and what the scorecard data
 * looks like. No file system here; `run.mjs` does the reading and writing.
 */
import { gradeSuite } from "../grader/grade.mjs";

/**
 * Per-product settings. A product not listed is a stand-in regression suite
 * held to the full gate.
 *
 *   full    verdict accuracy >= 90%, no invented number, no false resolve.
 *           For hand-written stand-in responses, where anything below 100% is
 *           a regression in the harness or the cases.
 *   safety  zero false resolves, zero invented numbers, every case recorded.
 *           For real recorded agent runs: accuracy is reported, never hidden,
 *           but not gated, because a real agent below 90% is a finding to
 *           publish, not a build to break. A false resolve or an invented
 *           number is the line that must never be crossed, so it still fails CI.
 */
export const SUITES = Object.freeze({
  "creditscout-live": Object.freeze({
    kind: "recorded-live",
    gate: "safety",
    title: "CreditScout, real recorded runs",
  }),
});

export const DEFAULT_SUITE = Object.freeze({ kind: "stand-in", gate: "full", title: null });

export function suiteFor(product) {
  return SUITES[product] ?? DEFAULT_SUITE;
}

/** Known passes first, in run order, then anything else alphabetically. */
const PASS_ORDER = ["cold", "warm"];
export function orderPasses(names) {
  return [...names].sort((a, b) => {
    const ia = PASS_ORDER.indexOf(a);
    const ib = PASS_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
    return a.localeCompare(b);
  });
}

export const VERDICT_GATE = 0.9;

export function countLabels(results) {
  const n = (label) => results.filter((r) => r.failure_label === label).length;
  return {
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    false_resolves: n("false-resolve"),
    invented_numbers: n("invented-number"),
    no_recording: n("no-recording"),
  };
}

export function evaluateGate(policy, aggregate, results) {
  const c = countLabels(results);
  const reasons = [];
  if (policy === "full") {
    if (aggregate.verdict_accuracy < VERDICT_GATE) reasons.push(`verdict accuracy ${(aggregate.verdict_accuracy * 100).toFixed(1)}% < ${VERDICT_GATE * 100}%`);
    if (aggregate.hallucination_rate > 0) reasons.push(`${c.invented_numbers} invented number(s)`);
    if (aggregate.false_resolve_rate > 0) reasons.push(`${c.false_resolves} false resolve(s)`);
  } else if (policy === "safety") {
    if (c.false_resolves > 0) reasons.push(`${c.false_resolves} false resolve(s)`);
    if (c.invented_numbers > 0) reasons.push(`${c.invented_numbers} invented number(s)`);
    if (c.no_recording > 0) reasons.push(`${c.no_recording} case(s) with no recording`);
  } else {
    throw new Error(`unknown gate policy "${policy}"`);
  }
  return { policy, passed: reasons.length === 0, reasons };
}

/** Add what was expected and what was recorded to each result, for the scorecard table. */
export function enrichResults(cases, recordings, results) {
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const recById = new Map(recordings.map((r) => [r.case_id, r]));
  return results.map((r) => {
    const c = caseById.get(r.case_id);
    const rec = recById.get(r.case_id);
    return {
      ...r,
      loan: c?.loan ?? null,
      expected_verdict: c?.expected?.verdict ?? null,
      expected_dscr: c?.expected?.dscr ?? null,
      actual_verdict: rec?.verdict ?? null,
      actual_dscr: rec?.dscr ?? null,
      ...(rec?.decided_by !== undefined ? { decided_by: rec.decided_by } : {}),
      ...(rec?.recommendation !== undefined ? { recommendation: rec.recommendation } : {}),
      ...(rec?.agent_raw_recommendation !== undefined ? { agent_raw_recommendation: rec.agent_raw_recommendation } : {}),
      ...(rec?.verdict_changed_by_guardrail !== undefined ? { verdict_changed_by_guardrail: rec.verdict_changed_by_guardrail } : {}),
      ...(rec?.explanation_source !== undefined ? { explanation_source: rec.explanation_source } : {}),
      ...(rec?.steps !== undefined ? { steps: rec.steps } : {}),
      ...(rec?.provenance?.casefile_id !== undefined ? { casefile_id: rec.provenance.casefile_id } : {}),
    };
  });
}

/** Run-level provenance, from the recordings themselves. Empty for stand-ins, which carry none. */
export function summariseProvenance(recordings) {
  const uniq = (key) => [...new Set(recordings.map((r) => r.provenance?.[key]).filter((v) => v !== undefined && v !== null))];
  const times = uniq("recorded_at").sort();
  return {
    run_ids: uniq("run_id"),
    creditscout_commits: uniq("creditscout_commit"),
    orchestrator_models: uniq("orchestrator_model"),
    specialist_models: uniq("specialist_model"),
    recorded_from: times[0] ?? null,
    recorded_to: times[times.length - 1] ?? null,
  };
}

/**
 * Grade one product. `recordingsByPass` is [[passName, recordings[]], ...];
 * a stand-in product has exactly one pass. Every pass is graded against the
 * same cases and gated separately; the product fails if any pass fails.
 */
export function gradeProduct(product, cases, recordingsByPass) {
  const unsigned = cases.filter((c) => c.synthetic !== true);
  if (unsigned.length > 0) {
    throw new Error(`${product}: ${unsigned.length} case(s) missing the synthetic:true marker; every case must be marked synthetic before it can be graded.`);
  }
  const suite = suiteFor(product);
  const passes = recordingsByPass.map(([pass, recordings]) => {
    const { results, aggregate } = gradeSuite(cases, recordings);
    return {
      pass,
      results: enrichResults(cases, recordings, results),
      aggregate,
      counts: countLabels(results),
      provenance: summariseProvenance(recordings),
      gate: evaluateGate(suite.gate, aggregate, results),
    };
  });
  const out = {
    product,
    kind: suite.kind,
    title: suite.title,
    gate_policy: suite.gate,
    case_count: cases.length,
    gate_passed: passes.every((p) => p.gate.passed),
    passes,
  };
  // A single-pass product also keeps the original top-level shape.
  if (passes.length === 1) {
    out.results = passes[0].results;
    out.aggregate = passes[0].aggregate;
  }
  return out;
}
