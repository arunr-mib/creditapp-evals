# creditscout-live recordings: real CreditScout output

These are **not** hand-written. Each file is CreditScout's actual output for one case in one recorded eval pass, exported read-only from CreditScout's database by [`tools/export-creditscout-run.mjs`](../../tools/export-creditscout-run.mjs).

| Pass | Run id | Recorded | CreditScout commit | Orchestrator | Specialists |
|---|---|---|---|---|---|
| `cold/` | `eval-20261113T161940Z-cold` | 2026-11-13 | `46f368c` | gpt-4.1-mini | gpt-5-mini |
| `warm/` | `eval-20261113T162519Z-warm` | 2026-11-13 | `46f368c` | gpt-4.1-mini | gpt-5-mini |

Cold runs with no analyst lessons. Warm reviews each case before the next one runs, so later cases can draw on earlier lessons. Both are graded against the same five cases in [`cases/creditscout-live/`](../../cases/creditscout-live/).

## Mapping from CreditScout to the recording format

| Field | Taken from |
|---|---|
| `verdict` | The casefile's final `recommendation`: `escalate` to `breach`, `resolve` to `no-breach`, `abstain` to `abstain`. A `request` (or anything else) has no clean equivalent and is recorded with `verdict: null` and a `mapping_flag`; none occurred in these runs. When no exception was raised, the deterministic test decided the case: `compliant` and `variance_logged` both map to `no-breach`, marked `decided_by: "code"`. |
| `dscr` | Investigated cases: the casefile's governing calculation (`casefiles.terms.calc_id`, which CreditScout writes as the last calculation logged for the casefile), value `calc_log.outputs.dscr`. Code-only cases: `tests.computed_dscr`. Never a figure read out of the agent's prose. |
| `citations` | The distinct `citation` labels of the casefile's `claims`, in the order given. Code-only cases: none. |
| `explanation` | `casefiles.explanation`, verbatim. Code-only cases: `null`; no explanation is invented. |

Extra fields the grader ignores but a reader may want: `recommendation`, `agent_raw_recommendation` (the recommendation in the agent's raw answer before CreditScout's guardrail), `verdict_changed_by_guardrail`, `explanation_source` (`agent`, or `creditscout-code` when CreditScout wrote the abstain itself, for example at the step cap), `claims` (with verbatim quotes), `guardrail_notes`, `steps`, and `provenance` (run id, eval run row, test, exception, casefile and governing calc ids, recorded time, commit, models).

Em and en dashes inside verbatim CreditScout text are stored as JSON unicode escapes, so the parsed value is exactly what the database returned.

All data is synthetic: invented borrowers, lender and figures.

## Re-exporting

```bash
node --env-file=<path to a CreditScout .env> tools/export-creditscout-run.mjs \
  --cold eval-20261113T161940Z-cold --warm eval-20261113T162519Z-warm \
  --commit 46f368c --orchestrator-model gpt-4.1-mini --specialist-model gpt-5-mini
```

Config is environment only: `SUPABASE_URL` and `SUPABASE_READ_KEY` (or, failing that, `SUPABASE_SERVICE_ROLE_KEY`). The script issues HTTP GETs (SELECTs) only, prints no environment value, and writes only into this folder. Re-exporting changes only `provenance.exported_at` unless the underlying rows changed.
