/**
 * creditapp-evals — runner (recorded-trace mode, v1).
 *
 *   npm run eval                       grade every product's recorded cases
 *   npm run eval -- --product creditscout
 *
 * This is a hub: cases/<product>/*.json and recordings/<product>/*.json, one
 * subfolder per credit product evaluated here. v1 ships creditscout; later
 * phases add spreadsense and others as their own subfolders under the same
 * grader and dashboard — nothing below is CreditScout-specific.
 *
 * v1 grades against recorded traces only (free, reproducible, no live calls).
 * A --live mode that calls a real deployed agent is a later phase, product by
 * product, and must stay opt-in and clearly marked billable — never the
 * default a CI workflow runs on every push.
 */
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gradeSuite } from "../grader/grade.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CASES_DIR = path.join(ROOT, "cases");
const RECORDINGS_DIR = path.join(ROOT, "recordings");
const OUT_DIR = path.join(ROOT, "dashboard", "data");

function loadJsonDir(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")));
}

function listProducts() {
  return readdirSync(CASES_DIR).filter((f) =>
    existsSync(path.join(CASES_DIR, f)) && readdirSync(path.join(CASES_DIR, f)).length > 0
  );
}

function runProduct(product) {
  const cases = loadJsonDir(path.join(CASES_DIR, product));
  const recordingsPath = path.join(RECORDINGS_DIR, product);
  const recordings = existsSync(recordingsPath) ? loadJsonDir(recordingsPath) : [];
  const unsigned = cases.filter((c) => c.synthetic !== true);
  if (unsigned.length > 0) {
    throw new Error(
      `${product}: ${unsigned.length} case(s) missing the synthetic:true marker — every case must be marked synthetic before it can be graded.`
    );
  }
  const { results, aggregate } = gradeSuite(cases, recordings);
  return { product, results, aggregate, case_count: cases.length };
}

function main() {
  const args = process.argv.slice(2);
  const productFlagIdx = args.indexOf("--product");
  const products = productFlagIdx >= 0 ? [args[productFlagIdx + 1]] : listProducts();

  const runs = products.map(runProduct);

  mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    generated_at: new Date().toISOString(),
    products: runs,
  };
  writeFileSync(path.join(OUT_DIR, "latest.json"), JSON.stringify(payload, null, 2));

  let anyFail = false;
  for (const run of runs) {
    const a = run.aggregate;
    console.log(`\n${run.product} — ${run.case_count} cases`);
    console.log(`  verdict accuracy:    ${(a.verdict_accuracy * 100).toFixed(1)}%`);
    console.log(`  citation accuracy:   ${(a.citation_accuracy * 100).toFixed(1)}%`);
    console.log(`  hallucination rate:  ${(a.hallucination_rate * 100).toFixed(1)}%`);
    console.log(`  false resolve rate:  ${(a.false_resolve_rate * 100).toFixed(1)}%`);
    const failed = run.results.filter((r) => !r.pass);
    if (failed.length > 0) {
      console.log(`  failures:`);
      for (const f of failed) console.log(`    - ${f.case_id} [${f.failure_label}]`);
    }
    if (a.verdict_accuracy < 0.9 || a.hallucination_rate > 0 || a.false_resolve_rate > 0) {
      anyFail = true;
    }
  }

  if (anyFail) {
    console.error("\nEval gate failed: verdict accuracy < 90%, or any hallucination / false resolve.");
    process.exit(1);
  }
  console.log("\nAll products within gate.");
}

main();
