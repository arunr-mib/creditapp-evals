/**
 * creditapp-evals: runner (recorded-trace mode).
 *
 *   npm run eval                              grade every product's recorded cases
 *   npm run eval -- --product creditscout     one product
 *   npm run eval -- --product creditscout-live
 *
 * This is a hub: cases/<product>/*.json and recordings/<product>/, one
 * subfolder per credit product evaluated here, all graded by one grader and
 * shown on one dashboard.
 *
 * A product's recordings are either flat (recordings/<product>/*.json, one
 * pass) or split into one subfolder per pass (recordings/<product>/cold/,
 * recordings/<product>/warm/). Each pass is graded against the same cases and
 * reported separately.
 *
 * Two kinds of product, two gates (see runner/suite.mjs):
 *   stand-in       hand-written responses (creditscout): the full gate, verdict
 *                  accuracy >= 90% and no invented number or false resolve.
 *   recorded-live  real recorded agent runs (creditscout-live): every result is
 *                  published, pass or fail; CI fails only on a false resolve,
 *                  an invented number, or a case with no recording.
 *
 * Grading reads recorded traces only (free, reproducible, no live calls). A
 * live mode that calls a deployed agent stays opt-in, billable, and out of CI.
 */
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gradeProduct, orderPasses } from "./suite.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CASES_DIR = path.join(ROOT, "cases");
const RECORDINGS_DIR = path.join(ROOT, "recordings");
const OUT_DIR = path.join(ROOT, "dashboard", "data");

function loadJsonDir(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")));
}

function listProducts() {
  return readdirSync(CASES_DIR)
    .filter((f) => statSync(path.join(CASES_DIR, f)).isDirectory())
    .filter((f) => readdirSync(path.join(CASES_DIR, f)).some((x) => x.endsWith(".json")))
    .sort();
}

/** [[pass, recordings[]], ...]: one entry per subfolder, or a single "recorded" pass for a flat folder. */
function loadRecordings(product) {
  const dir = path.join(RECORDINGS_DIR, product);
  if (!existsSync(dir)) return [["recorded", []]];
  const subdirs = readdirSync(dir).filter((f) => statSync(path.join(dir, f)).isDirectory());
  if (subdirs.length === 0) return [["recorded", loadJsonDir(dir)]];
  return orderPasses(subdirs).map((pass) => [pass, loadJsonDir(path.join(dir, pass))]);
}

const pct = (n) => `${(n * 100).toFixed(1)}%`;

function printProduct(run) {
  const live = run.kind === "recorded-live";
  console.log(`\n${run.product}: ${run.case_count} cases${live ? `, ${run.passes.length} recorded passes` : ""}`);
  if (live) {
    console.log("  REAL recorded agent runs. Every result below is published, pass or fail.");
    console.log("  Gate for this product: safety only (zero false resolves, zero invented numbers, every case recorded).");
    console.log("  Verdict accuracy is reported, not gated.");
  } else {
    console.log("  Stand-in regression suite (hand-written responses). Gate: verdict accuracy >= 90%, no invented number, no false resolve.");
  }
  for (const p of run.passes) {
    const a = p.aggregate;
    const indent = run.passes.length > 1 ? "    " : "  ";
    if (run.passes.length > 1) {
      const runIds = p.provenance.run_ids.join(", ") || "none";
      console.log(`  pass ${p.pass} (run ${runIds}): ${p.counts.passed}/${a.total} pass`);
    }
    console.log(`${indent}verdict accuracy:    ${pct(a.verdict_accuracy)}`);
    console.log(`${indent}citation accuracy:   ${pct(a.citation_accuracy)}`);
    console.log(`${indent}hallucination rate:  ${pct(a.hallucination_rate)}`);
    console.log(`${indent}false resolve rate:  ${pct(a.false_resolve_rate)}`);
    if (live) {
      for (const r of p.results) {
        const got = `${r.actual_verdict ?? "null"} @ ${r.actual_dscr ?? "null"}`;
        const want = `${r.expected_verdict} @ ${r.expected_dscr ?? "null"}`;
        console.log(`${indent}  ${r.pass ? "PASS" : "FAIL"} ${r.case_id.padEnd(10)} expected ${want.padEnd(16)} got ${got.padEnd(16)} ${r.failure_label ?? ""}`.trimEnd());
      }
    } else {
      const failed = p.results.filter((r) => !r.pass);
      if (failed.length > 0) {
        console.log(`${indent}failures:`);
        for (const f of failed) console.log(`${indent}  - ${f.case_id} [${f.failure_label}]`);
      }
    }
    console.log(`${indent}gate (${p.gate.policy}): ${p.gate.passed ? "within gate" : `FAILED: ${p.gate.reasons.join("; ")}`}`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const productFlagIdx = args.indexOf("--product");
  const products = productFlagIdx >= 0 ? [args[productFlagIdx + 1]] : listProducts();

  const runs = products.map((product) =>
    gradeProduct(product, loadJsonDir(path.join(CASES_DIR, product)), loadRecordings(product)),
  );

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    path.join(OUT_DIR, "latest.json"),
    JSON.stringify({ generated_at: new Date().toISOString(), products: runs }, null, 2) + "\n",
  );

  for (const run of runs) printProduct(run);

  const failed = runs.filter((r) => !r.gate_passed);
  if (failed.length > 0) {
    console.error(`\nEval gate failed for: ${failed.map((r) => r.product).join(", ")}.`);
    process.exit(1);
  }
  console.log("\nAll products within their gates.");
  if (runs.some((r) => r.kind === "recorded-live" && r.passes.some((p) => p.counts.failed > 0))) {
    console.log("Note: the real recorded runs above include failing cases. They are published as is and do not break CI, because their gate is safety only.");
  }
}

main();
