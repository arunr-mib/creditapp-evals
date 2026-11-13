import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapRecommendation,
  expectedVerdict,
  codeOutcome,
  claimCitations,
  rawAgentRecommendation,
  governingDscr,
  buildRecording,
  serialiseRecording,
  CODE_ABSTAIN_BASIS,
} from "./creditscout-mapping.mjs";

const prov = { run_id: "eval-x-cold", creditscout_commit: "abc1234" };
const test0 = { id: "t1", passed: false, variance_flagged: false, computed_dscr: 1.12, reported_dscr: 1.12, threshold: 1.25, created_at: "2026-11-13T00:00:00Z" };
const calcs = new Map([
  ["c-base", { calc_id: "c-base", outputs: { dscr: 1.12 } }],
  ["c-fixed", { calc_id: "c-fixed", outputs: { dscr: 1.3 } }],
]);

test("recommendation mapping: escalate, resolve, abstain", () => {
  assert.deepEqual(mapRecommendation("escalate"), { verdict: "breach", mapping_flag: null });
  assert.deepEqual(mapRecommendation("resolve"), { verdict: "no-breach", mapping_flag: null });
  assert.deepEqual(mapRecommendation("abstain"), { verdict: "abstain", mapping_flag: null });
});

test("request (and anything unknown) is not guessed: verdict null with a flag", () => {
  for (const rec of ["request", null, "approve"]) {
    const m = mapRecommendation(rec);
    assert.equal(m.verdict, null);
    assert.match(m.mapping_flag, /no breach \/ no-breach \/ abstain equivalent/);
  }
});

test("expected outcome mapping, and an unknown outcome throws", () => {
  assert.equal(expectedVerdict("resolve"), "no-breach");
  assert.equal(expectedVerdict("escalate"), "breach");
  assert.equal(expectedVerdict("compliant_no_action"), "no-breach");
  assert.equal(expectedVerdict("variance_logged_no_investigation"), "no-breach");
  assert.throws(() => expectedVerdict("request"));
});

test("code outcome mirrors CreditScout reconcile", () => {
  assert.equal(codeOutcome({ passed: false }, true), "exception");
  assert.equal(codeOutcome({ passed: true, variance_flagged: false }, false), "compliant");
  assert.equal(codeOutcome({ passed: true, variance_flagged: true }, false), "variance_logged");
  assert.equal(codeOutcome({ passed: false }, false), null, "a failing test with no exception is inconsistent");
});

test("claim citations are distinct and keep first-seen order", () => {
  assert.deepEqual(
    claimCitations([{ citation: "CA §7.11" }, { citation: "CA §1.01" }, { citation: "CA §7.11" }, { citation: "" }, {}]),
    ["CA §7.11", "CA §1.01"],
  );
  assert.deepEqual(claimCitations(null), []);
});

test("raw agent recommendation parses agent_output, null when absent or malformed", () => {
  assert.equal(rawAgentRecommendation('{"recommendation":"resolve"}'), "resolve");
  assert.equal(rawAgentRecommendation(null), null);
  assert.equal(rawAgentRecommendation("not json"), null);
});

test("governing DSCR comes from the logged calc, never from the agent's text", () => {
  assert.equal(governingDscr("c-fixed", calcs), 1.3);
  assert.equal(governingDscr("missing", calcs), null);
  assert.equal(governingDscr(null, calcs), null);
});

test("code-only case: no-breach, test DSCR, no citations, no invented explanation", () => {
  const r = buildRecording({
    caseId: "F5-2025Q4", pass: "cold",
    test: { ...test0, passed: true, computed_dscr: 1.41 },
    exception: null, casefile: null, governingCalcId: null, calcById: calcs, provenance: prov,
  });
  assert.equal(r.verdict, "no-breach");
  assert.equal(r.dscr, 1.41);
  assert.deepEqual(r.citations, []);
  assert.equal(r.explanation, null);
  assert.equal(r.decided_by, "code");
  assert.equal(r.code_outcome, "compliant");
  assert.equal(r.provenance.casefile_id, null);
});

test("variance-logged case maps to no-breach and says so", () => {
  const r = buildRecording({
    caseId: "F5-2026Q1", pass: "warm",
    test: { ...test0, passed: true, variance_flagged: true, computed_dscr: 1.29 },
    exception: null, casefile: null, governingCalcId: null, calcById: calcs, provenance: prov,
  });
  assert.equal(r.verdict, "no-breach");
  assert.equal(r.code_outcome, "variance_logged");
});

test("agent case: verdict from the final recommendation, DSCR from the governing calc, real citations and explanation", () => {
  const r = buildRecording({
    caseId: "F5-2026Q2", pass: "warm", test: test0,
    exception: { id: "e1" },
    casefile: {
      id: "cf1", recommendation: "resolve", explanation: "Applied the amendment.",
      claims: [{ citation: "CA §7.11(a)" }, { citation: "Amd 2 §3" }],
      agent_output: '{"recommendation":"resolve"}', confidence_basis: "x", steps_count: 8, created_at: "2026-11-13T01:00:00Z",
    },
    governingCalcId: "c-fixed", calcById: calcs, provenance: prov,
  });
  assert.equal(r.verdict, "no-breach");
  assert.equal(r.dscr, 1.3);
  assert.deepEqual(r.citations, ["CA §7.11(a)", "Amd 2 §3"]);
  assert.equal(r.explanation, "Applied the amendment.");
  assert.equal(r.verdict_changed_by_guardrail, false);
  assert.equal(r.explanation_source, "agent");
  assert.equal(r.provenance.casefile_id, "cf1");
  assert.equal(r.provenance.run_id, "eval-x-cold");
});

test("a guardrail downgrade is recorded: final abstain, raw resolve, flagged", () => {
  const r = buildRecording({
    caseId: "F1-2026Q2", pass: "warm", test: test0, exception: { id: "e1" },
    casefile: { id: "cf2", recommendation: "abstain", agent_output: '{"recommendation":"resolve"}', claims: [], created_at: "t" },
    governingCalcId: "c-base", calcById: calcs, provenance: prov,
  });
  assert.equal(r.verdict, "abstain");
  assert.equal(r.agent_raw_recommendation, "resolve");
  assert.equal(r.verdict_changed_by_guardrail, true);
  assert.equal(r.dscr, 1.12);
});

test("a code-written abstain (step cap) is marked as not the agent's explanation", () => {
  const r = buildRecording({
    caseId: "F5-2026Q2", pass: "cold", test: test0, exception: { id: "e1" },
    casefile: { id: "cf3", recommendation: "abstain", confidence_basis: CODE_ABSTAIN_BASIS, explanation: "step cap", claims: [], agent_output: null, created_at: "t" },
    governingCalcId: "c-base", calcById: calcs, provenance: prov,
  });
  assert.equal(r.explanation_source, "creditscout-code");
  assert.equal(r.agent_raw_recommendation, null);
  assert.equal(r.verdict_changed_by_guardrail, false);
});

test("an exception with no casefile is flagged, not filled in", () => {
  const r = buildRecording({
    caseId: "X", pass: "cold", test: test0, exception: { id: "e1" }, casefile: null,
    governingCalcId: null, calcById: calcs, provenance: prov,
  });
  assert.equal(r.verdict, null);
  assert.match(r.mapping_flag, /no casefile/);
});

test("serialised files carry no literal dash characters but parse back to the exact text", () => {
  const rec = { explanation: "a \u2014 b \u2013 c" };
  const text = serialiseRecording(rec);
  assert.equal(/[\u2013\u2014]/.test(text), false);
  assert.equal(JSON.parse(text).explanation, rec.explanation);
});
