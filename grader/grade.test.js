import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeCase, gradeSuite } from "./grade.mjs";

const breachCase = {
  id: "t1",
  bucket: "true-breach",
  expected: { verdict: "breach", dscr: 1.12, citations: ["Agreement §7.11(a)"] },
};

test("exact match passes on verdict, dscr and citation", () => {
  const r = gradeCase(breachCase, { verdict: "breach", dscr: 1.12, citations: ["Agreement §7.11(a)"] });
  assert.equal(r.pass, true);
  assert.equal(r.failure_label, null);
});

test("quoted covenant threshold in the citation text still matches after normalisation", () => {
  const r = gradeCase(breachCase, {
    verdict: "breach",
    dscr: 1.12,
    citations: ["Agreement §7.11(a) (requires 1.25x minimum DSCR)"],
  });
  assert.equal(r.citation_match, true, "a quoted threshold alongside the citation should not break the match");
});

test("false resolve on a true breach fails Harmless and is labeled", () => {
  const r = gradeCase(breachCase, { verdict: "no-breach", dscr: 1.30, citations: ["Agreement §7.11(a)"] });
  assert.equal(r.harmless, false);
  assert.equal(r.failure_label, "false-resolve");
});

test("missed abstain: evidence insufficient but agent guessed", () => {
  const abstainCase = { id: "t2", bucket: "missing-evidence-abstain", expected: { verdict: "abstain", dscr: null, citations: [] } };
  const r = gradeCase(abstainCase, { verdict: "no-breach", dscr: 1.40, citations: ["some doc"] });
  assert.equal(r.failure_label, "missed-abstain");
});

test("wrong abstain: evidence was sufficient but agent abstained anyway", () => {
  const r = gradeCase(breachCase, { verdict: "abstain", dscr: null, citations: [] });
  assert.equal(r.failure_label, "wrong-abstain");
});

test("invented number: dscr does not match oracle even though verdict matches", () => {
  const r = gradeCase(breachCase, { verdict: "breach", dscr: 1.05, citations: ["Agreement §7.11(a)"] });
  assert.equal(r.failure_label, "invented-number");
  assert.equal(r.pass, false);
});

test("stale terms: boarding-lag case graded wrong is labeled stale-terms, not invented-number", () => {
  const lagCase = {
    id: "t3",
    bucket: "amendment-saves-it",
    note: "covenant-boarding-lag twist",
    expected: { verdict: "no-breach", dscr: 1.22, citations: ["Amendment No. 2 §4"] },
  };
  const r = gradeCase(lagCase, { verdict: "no-breach", dscr: 1.09, citations: ["Amendment No. 2 §4"] });
  assert.equal(r.failure_label, "stale-terms");
});

test("gradeSuite computes aggregate verdict accuracy and false-resolve rate", () => {
  const cases = [breachCase];
  const recordings = [{ case_id: "t1", verdict: "no-breach", dscr: 1.30, citations: ["Agreement §7.11(a)"] }];
  const { aggregate } = gradeSuite(cases, recordings);
  assert.equal(aggregate.total, 1);
  assert.equal(aggregate.verdict_accuracy, 0);
  assert.equal(aggregate.false_resolve_rate, 1);
});

test("a case with no matching recording fails closed, not silently skipped", () => {
  const { results } = gradeSuite([breachCase], []);
  assert.equal(results[0].pass, false);
  assert.equal(results[0].failure_label, "no-recording");
});
