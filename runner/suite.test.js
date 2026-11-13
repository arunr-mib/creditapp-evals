import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeProduct, evaluateGate, orderPasses, suiteFor, summariseProvenance } from "./suite.mjs";

const cases = [
  { id: "a", bucket: "true-breach", synthetic: true, expected: { verdict: "breach", dscr: 1.08, citations: ["CA §7.11"] } },
  { id: "b", bucket: "amendment-saves-it", synthetic: true, expected: { verdict: "no-breach", dscr: 1.3, citations: [] } },
];
const right = [
  { case_id: "a", verdict: "breach", dscr: 1.08, citations: ["CA §7.11(a)"], provenance: { run_id: "r-cold", recorded_at: "2026-11-13T16:20:00Z" } },
  { case_id: "b", verdict: "no-breach", dscr: 1.3, citations: [], provenance: { run_id: "r-cold", recorded_at: "2026-11-13T16:21:00Z" } },
];
const abstained = [right[0], { case_id: "b", verdict: "abstain", dscr: 1.12, citations: [], provenance: { run_id: "r-warm" } }];
const falseResolve = [{ case_id: "a", verdict: "no-breach", dscr: 1.3, citations: ["CA §7.11"] }, right[1]];

test("passes order cold, warm, then the rest", () => {
  assert.deepEqual(orderPasses(["warm", "zeta", "cold", "alpha"]), ["cold", "warm", "alpha", "zeta"]);
});

test("creditscout-live is a recorded-live product with the safety gate; others default to the full gate", () => {
  assert.equal(suiteFor("creditscout-live").gate, "safety");
  assert.equal(suiteFor("creditscout-live").kind, "recorded-live");
  assert.equal(suiteFor("creditscout").gate, "full");
});

test("two passes are graded separately against the same cases", () => {
  const out = gradeProduct("creditscout-live", cases, [["cold", right], ["warm", abstained]]);
  assert.equal(out.passes.length, 2);
  assert.equal(out.passes[0].pass, "cold");
  assert.equal(out.passes[0].aggregate.verdict_accuracy, 1);
  assert.equal(out.passes[1].aggregate.verdict_accuracy, 0.5);
  assert.equal(out.passes[1].results[1].failure_label, "wrong-abstain");
  assert.equal(out.passes[1].results[1].expected_verdict, "no-breach");
  assert.equal(out.passes[1].results[1].actual_verdict, "abstain");
  assert.deepEqual(out.passes[0].provenance.run_ids, ["r-cold"]);
  assert.equal(out.results, undefined, "multi-pass products do not pretend to have one result set");
});

test("safety gate: a wrong abstain below 90% accuracy is published but does not fail", () => {
  const out = gradeProduct("creditscout-live", cases, [["warm", abstained]]);
  assert.equal(out.passes[0].aggregate.verdict_accuracy, 0.5);
  assert.equal(out.gate_passed, true);
});

test("safety gate: a false resolve in any pass fails the product", () => {
  const out = gradeProduct("creditscout-live", cases, [["cold", right], ["warm", falseResolve]]);
  assert.equal(out.passes[0].gate.passed, true);
  assert.equal(out.passes[1].gate.passed, false);
  assert.match(out.passes[1].gate.reasons.join(), /false resolve/);
  assert.equal(out.gate_passed, false);
});

test("safety gate: an invented number fails, and a missing recording fails closed", () => {
  const invented = [{ ...right[0], dscr: 1.01 }, right[1]];
  assert.equal(gradeProduct("creditscout-live", cases, [["cold", invented]]).gate_passed, false);
  assert.equal(gradeProduct("creditscout-live", cases, [["cold", [right[0]]]]).gate_passed, false);
});

test("full gate is unchanged for stand-ins: below 90% verdict accuracy fails", () => {
  const out = gradeProduct("creditscout", cases, [["recorded", abstained]]);
  assert.equal(out.gate_passed, false);
  assert.match(out.passes[0].gate.reasons[0], /verdict accuracy 50.0% < 90%/);
  assert.ok(out.results, "single-pass products keep the top-level results");
});

test("unknown gate policy throws rather than passing silently", () => {
  assert.throws(() => evaluateGate("lenient", { verdict_accuracy: 1 }, []));
});

test("provenance summary is empty for stand-ins and spans the recorded times otherwise", () => {
  assert.deepEqual(summariseProvenance([{ case_id: "x" }]).run_ids, []);
  const p = summariseProvenance(right);
  assert.equal(p.recorded_from, "2026-11-13T16:20:00Z");
  assert.equal(p.recorded_to, "2026-11-13T16:21:00Z");
});

test("a case missing the synthetic marker refuses to grade", () => {
  assert.throws(() => gradeProduct("creditscout-live", [{ ...cases[0], synthetic: undefined }], [["cold", right]]), /synthetic/);
});
