/**
 * Export recorded CreditScout eval runs into recordings/creditscout-live/<pass>/.
 *
 *   node --env-file=<path to a CreditScout .env> tools/export-creditscout-run.mjs \
 *     --cold eval-20261113T161940Z-cold --warm eval-20261113T162519Z-warm \
 *     --commit 46f368c --orchestrator-model gpt-4.1-mini --specialist-model gpt-5-mini
 *
 * READ ONLY. Every request is an HTTP GET against the Supabase REST endpoint
 * (a SELECT); nothing is inserted, updated, deleted or called. It reads:
 *   eval_runs  id, mode, created_at                    where metrics->>run_id = <run>
 *   tests      id, facility_id, test_period_end, computed_dscr, reported_dscr,
 *              threshold, passed, variance_flagged, calc_id, created_at  where run_id = <run>
 *   facilities id, borrower_name                       for those tests
 *   exceptions id, test_id                             for those tests
 *   casefiles  id, exception_id, status, recommendation, confidence_basis,
 *              explanation, claims, suggested_tag, guardrail_notes, steps_count,
 *              agent_output, terms->>calc_id, created_at  where run_id = <run>
 *   calc_log   calc_id, outputs                        for the governing calc ids
 *
 * Config comes from the environment only:
 *   SUPABASE_URL                     the project's API base URL
 *   SUPABASE_READ_KEY                preferred: a key that can read these tables
 *   SUPABASE_SERVICE_ROLE_KEY        fallback when no read key is set
 * Nothing from the environment is printed or written. Cases are matched by
 * borrower and test period against cases/creditscout-live/*.json, so a test the
 * case set does not name is ignored, and a case with no test is reported.
 *
 * The mapping itself lives in creditscout-mapping.mjs (pure, unit tested).
 */
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRecording, serialiseRecording } from "./creditscout-mapping.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CASES_DIR = path.join(ROOT, "cases", "creditscout-live");
const OUT_DIR = path.join(ROOT, "recordings", "creditscout-live");

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function required(name) {
  const v = opt(name);
  if (!v) throw new Error(`missing ${name}`);
  return v;
}

const BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_READ_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

/** One SELECT. Errors name the table only, never the URL or key. */
async function select(table, query) {
  const res = await fetch(`${BASE.replace(/\/$/, "")}/rest/v1/${table}?${query}`, {
    method: "GET",
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`select ${table}: HTTP ${res.status}`);
  return res.json();
}

const inList = (ids) => `in.(${ids.map((id) => encodeURIComponent(id)).join(",")})`;

function loadCases() {
  return readdirSync(CASES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(CASES_DIR, f), "utf8")));
}

async function exportPass(pass, runId, cases, shared) {
  const [evalRun] = await select("eval_runs", `select=id,mode,created_at&metrics->>run_id=eq.${encodeURIComponent(runId)}`);
  const tests = await select(
    "tests",
    `select=id,facility_id,test_period_end,computed_dscr,reported_dscr,threshold,passed,variance_flagged,calc_id,created_at&run_id=eq.${encodeURIComponent(runId)}`,
  );
  if (tests.length === 0) throw new Error(`${pass}: no tests found for that run id`);
  const facilities = await select("facilities", `select=id,borrower_name&id=${inList([...new Set(tests.map((t) => t.facility_id))])}`);
  const exceptions = await select("exceptions", `select=id,test_id&test_id=${inList(tests.map((t) => t.id))}`);
  const casefiles = await select(
    "casefiles",
    `select=id,exception_id,status,recommendation,confidence_basis,explanation,claims,suggested_tag,guardrail_notes,steps_count,agent_output,governing_calc_id:terms->>calc_id,created_at&run_id=eq.${encodeURIComponent(runId)}`,
  );
  const calcIds = casefiles.map((c) => c.governing_calc_id).filter(Boolean);
  const calcs = calcIds.length > 0 ? await select("calc_log", `select=calc_id,outputs&calc_id=${inList(calcIds)}`) : [];
  const calcById = new Map(calcs.map((c) => [c.calc_id, c]));

  const borrowerOf = new Map(facilities.map((f) => [f.id, f.borrower_name]));
  const excByTest = new Map(exceptions.map((e) => [e.test_id, e]));
  const cfByExc = new Map(casefiles.map((c) => [c.exception_id, c]));

  const provenance = {
    source: "CreditScout recorded eval run (real run output, not a stand-in)",
    run_id: runId,
    pass,
    eval_run_row_id: evalRun?.id ?? null,
    pass_recorded_at: evalRun?.created_at ?? null,
    creditscout_commit: shared.commit,
    orchestrator_model: shared.orchestratorModel,
    specialist_model: shared.specialistModel,
    exported_at: shared.exportedAt,
  };

  mkdirSync(path.join(OUT_DIR, pass), { recursive: true });
  const written = [];
  for (const c of cases) {
    const test = tests.find((t) => borrowerOf.get(t.facility_id) === c.loan && t.test_period_end === c.test_period_end);
    if (!test) {
      console.log(`  ${pass} ${c.id}: no test in this run, nothing written`);
      continue;
    }
    const exception = excByTest.get(test.id) ?? null;
    const casefile = exception ? cfByExc.get(exception.id) ?? null : null;
    const rec = buildRecording({
      caseId: c.id,
      pass,
      test,
      exception,
      casefile,
      governingCalcId: casefile?.governing_calc_id ?? null,
      calcById,
      provenance,
    });
    writeFileSync(path.join(OUT_DIR, pass, `${c.id}.json`), serialiseRecording(rec));
    written.push(rec);
    console.log(`  ${pass} ${c.id}: ${rec.decided_by ?? "unmapped"} -> ${rec.verdict ?? "null"} (dscr ${rec.dscr ?? "null"})${rec.mapping_flag ? `  FLAG: ${rec.mapping_flag}` : ""}`);
  }
  return written;
}

async function main() {
  if (!BASE || !KEY) throw new Error("set SUPABASE_URL and SUPABASE_READ_KEY (or SUPABASE_SERVICE_ROLE_KEY) in the environment");
  const shared = {
    commit: required("--commit"),
    orchestratorModel: required("--orchestrator-model"),
    specialistModel: required("--specialist-model"),
    exportedAt: new Date().toISOString(),
  };
  const passes = [["cold", opt("--cold")], ["warm", opt("--warm")]].filter(([, id]) => id);
  if (passes.length === 0) throw new Error("name at least one of --cold <run_id> / --warm <run_id>");
  const cases = loadCases();
  for (const [pass, runId] of passes) {
    console.log(`${pass}: ${runId}`);
    await exportPass(pass, runId, cases, shared);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
