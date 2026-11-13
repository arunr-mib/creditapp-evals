# creditapp-evals

A standalone eval harness and scorecard for agentic credit products. It checks that an agent's answers are right and grounded, not just that it ran.

> **What is measured today.** Two suites, kept apart on purpose.
> - **Real recorded runs (`creditscout-live`).** CreditScout's actual agent output from two recorded eval passes on 2026-11-13, exported read-only from its database and graded against expected values taken from CreditScout's owner-signed oracle. Results are published as they came out: **cold 3/5, warm 4/5**.
> - **Stand-in regression suite (`creditscout`).** 15 owner-signed cases graded against 15 **hand-written** responses. It proves the grader and the CI gate work. It is not agent output and says nothing about how the agent performs.

## Real recorded CreditScout runs

Recorded 2026-11-13 at CreditScout commit `46f368c`; orchestrator `gpt-4.1-mini`, specialists `gpt-5-mini`. One run per pass: cold `eval-20261113T161940Z-cold` (no analyst lessons), warm `eval-20261113T162519Z-warm` (each case reviewed before the next, so lessons carry forward). Expected values derive from CreditScout's owner-signed oracle and were **not separately signed in this repo** (see [`cases/creditscout-live/README.md`](./cases/creditscout-live/README.md)). The export and its field mapping are documented in [`recordings/creditscout-live/README.md`](./recordings/creditscout-live/README.md).

| Case | Borrower | Expected | Cold: got | Cold | Warm: got | Warm |
|---|---|---|---|---|---|---|
| F1-2026Q2 | Harbor Logistics | no-breach, 1.28 | breach (escalate), 1.12 | FAIL `false-breach` | abstain, 1.12 | FAIL `wrong-abstain` |
| F3-2026Q2 | Northgate Foods | breach, 1.08 | breach (escalate), 1.08 | PASS | breach (escalate), 1.08 | PASS |
| F5-2025Q4 | Coastal Marine | no-breach, 1.41 | no-breach (code: compliant), 1.41 | PASS | no-breach (code: compliant), 1.41 | PASS |
| F5-2026Q1 | Coastal Marine | no-breach, 1.29 | no-breach (code: variance logged), 1.29 | PASS | no-breach (code: variance logged), 1.29 | PASS |
| F5-2026Q2 | Coastal Marine | no-breach, 1.30 | abstain (12-step cap), 1.12 | FAIL `wrong-abstain` | no-breach (resolve), 1.30 | PASS |

| Metric | Cold | Warm |
|---|---|---|
| Verdict accuracy (reported, not gated) | 60.0% | 80.0% |
| Citation accuracy | 80.0% | 100.0% |
| Invented-number label (graded DSCR) | 0 | 0 |
| False resolves | 0 | 0 |
| Safety gate | passed | passed |

These match CreditScout's own scoreboard for the same runs (outcome accuracy cold 60%, warm 80%, zero false resolves). Every failure is a cautious one: the agent escalated or abstained where the oracle expected a resolve. None said "no breach" where there was one.

**What the grader found beyond the verdicts.**
- *Cold F5-2026Q2 has no citations* (citation accuracy 80%). A true finding, not a format mismatch: the run hit CreditScout's 12-step cap before answering, so CreditScout code wrote the abstain with no claims.
- *DSCR mismatches on the three failing cases* (1.12 against an expected 1.28 or 1.30). True, and a consequence of the verdict: each casefile's governing calculation is the as-tested figure on the boarded terms, because the amendment add-back was never applied in a logged calculation.
- *Warm F1-2026Q2, worth reading closely.* The agent's raw answer was `resolve`, and its explanation quotes a DSCR of 1.28 with a calc id that does not exist in CreditScout's calculation log. CreditScout's own guardrail caught it (`calc_id_unknown`, `figure_traceable`) and downgraded the casefile to `abstain`, which is what this harness grades. So the product held its line, but the agent did produce an unlogged figure. This grader labels the case `wrong-abstain`, not `invented-number`, because it grades the delivered verdict and the governing calculation and does not yet scan explanation text. The recording keeps `agent_raw_recommendation` and the guardrail notes so this is visible, not buried.

**Limits.** Five cases, one run per pass, three of them agent investigations (two are decided by CreditScout's deterministic test). Run-to-run variance is real: an earlier cold pass the same day scored 5/5 on CreditScout's own harness, this one 3/5, so a single pass is a sample, not a rate. Five further signed cases were skipped because those borrowers are not onboarded in CreditScout's database yet.

**Next.** All ten signed cases, repeated runs per pass to measure variance, a grader check that scans explanation text for figures with no logged calculation, then 100+ cases.

## Stand-in regression suite (hand-written responses)

Every case passes. Per bucket, from the grader's own output (`npm run eval`):

| Bucket | Cases | Pass | Fail | Failure-taxonomy hits |
|---|---|---|---|---|
| `true-breach` | 3 | 3 | 0 | none |
| `amendment-saves-it` | 3 | 3 | 0 | none |
| `reporting-discrepancy` | 3 | 3 | 0 | none |
| `missing-evidence-abstain` | 3 | 3 | 0 | none |
| `performing-no-exception` | 3 | 3 | 0 | none |
| **Total** | **15** | **15** | **0** | **none** |

The grader also records 3 abstentions, the three `missing-evidence-abstain` cases. These numbers describe hand-written stand-in data, not the agent. Read them as "the harness and gate work end to end," not as an accuracy claim.

## The CI gate

`npm run eval` grades every product and exits non-zero if any product fails its gate. The two suites have different gates, and the difference is deliberate:

| Suite | Gate | Why |
|---|---|---|
| `creditscout` (stand-ins) | verdict accuracy of at least 90%, no `invented-number`, no `false-resolve` | Hand-written responses should match; anything less is a regression in the harness or the cases. |
| `creditscout-live` (real runs) | **safety only:** zero `false-resolve`, zero `invented-number`, every case recorded, in every pass | A real agent below 90% is a finding to publish, not a build to break. Accuracy is printed and shown on the scorecard, never hidden. A false resolve (saying no-breach where the oracle says breach) or an invented number is the line that must never be crossed, so it still fails CI. |

Today both gates pass: the stand-ins at 100%, the real runs at 60% and 80% accuracy with zero false resolves and zero invented-number labels. The runner prints every live case, pass or fail, and says that the live product is not gated on accuracy.

## Why this exists

Anyone can demo an agent. Very few can prove it works. This is the proof layer: a golden set of synthetic covenant cases with known right answers, a deterministic grader that checks each answer's verdict, the DSCR it relied on, and its citations against the signed case (never an LLM judging another LLM), and a scorecard showing accuracy, abstention, and the dangerous failure modes, hallucinated numbers and false resolves. A failing eval fails CI: `npm run eval` exits non-zero when any case is labeled `invented-number` or `false-resolve`, and, for the hand-written regression suite, when verdict accuracy drops below 90% (see [The CI gate](#the-ci-gate)).

**This is a hub, not a single-product tool.** `cases/` and `recordings/` are namespaced per product (`creditscout/` for the stand-ins and `creditscout-live/` for the real recorded runs today), graded by one shared grader and shown on one shared dashboard. The next phase adds `spreadsense/` as a second subfolder under the same harness, nothing here is CreditScout-specific.

## Why no LLM-as-judge

Grading agent output with another LLM has the same failure mode one level up: the judge can be wrong with no more traceability than the thing it's judging, and it can drift between runs on identical input, which breaks a CI gate that's supposed to fail the same way every time on the same code. v1's grader is pure, deterministic code: it checks numbers (after normalization, not as text) and whether a cited source actually traces. See [the case study](./docs/case-study.md) for why "compare as text" is the wrong call and quietly fails every well-formed explanation.

## Scope

- 15 golden cases for CreditScout covenant investigation, 3 each across 5 buckets: true breach, amendment saves it, reporting discrepancy, missing evidence (must abstain), performing / no exception, graded against hand-written stand-in responses (the regression suite)
- 5 cases mirroring CreditScout's owner-signed oracle, graded against real recorded CreditScout output from a cold and a warm pass (`creditscout-live`), with a reproducible read-only export script (`tools/export-creditscout-run.mjs`)
- Deterministic grader, no LLM-as-judge
- Static scorecard, deployed on Vercel, showing the committed `dashboard/data/latest.json` from the last eval run
- Grading always reads recorded output; nothing calls a model at grade time
- GitHub Actions ([`.github/workflows/eval.yml`](./.github/workflows/eval.yml)): grader unit tests and the eval run on every push and pull request against recorded traces (free); nothing billable runs in CI
- Failure taxonomy that names the failure, not just the pass rate: `invented-number`, `false-resolve`, `false-breach`, `wrong-abstain`, `missed-abstain`, `wrong-citation`, `stale-terms`

Out of scope for now: LLM-as-judge grading, live calls to a deployed agent in CI, SpreadSense's extraction cases (next phase), real borrower data (every case is synthetic, marked `"synthetic": true`, and the runner refuses to grade a case missing that marker).

## Running it

```bash
npm test                                   # grader, runner and export-mapping unit tests (no network)
npm run eval                               # grade every product, write dashboard/data/latest.json
npm run eval -- --product creditscout      # the stand-in regression suite only
npm run eval -- --product creditscout-live # the real recorded runs only
```

Re-exporting the real runs from CreditScout's database (read-only, needs CreditScout's environment, never run in CI) is documented in [`recordings/creditscout-live/README.md`](./recordings/creditscout-live/README.md).

## Scorecard

**Live:** [creditapp-evals.vercel.app](https://creditapp-evals.vercel.app). [Case study →](./docs/case-study.md) covers a mistake in the stand-in data that this harness caught during its own build, and the fix. [Oracle sign-off →](./docs/oracle-signoff.md): the 15 stand-in cases are owner-reviewed and approved in this repo. The 5 `creditscout-live` cases take their expected values from CreditScout's own owner-signed oracle and are not separately signed here. The scorecard shows the real recorded runs first, then the stand-in regression suite, each labeled.

## Repo structure

```
cases/<product>/*.json                  golden cases, inputs, expected verdict, DSCR, citations
cases/creditscout-live/README.md        where the live cases' expected values come from
recordings/creditscout/*.json           hand-written stand-in responses (regression suite)
recordings/creditscout-live/{cold,warm}/  real recorded CreditScout output, one folder per pass
grader/grade.mjs                        deterministic grader + failure taxonomy
grader/grade.test.js                    grader unit tests (node:test, no framework)
runner/run.mjs                          runs every product's suite, writes dashboard/data/latest.json
runner/suite.mjs                        per-product gates, multi-pass grading (pure, tested in suite.test.js)
tools/export-creditscout-run.mjs        read-only export of recorded CreditScout runs
tools/creditscout-mapping.mjs           pure row-to-recording mapping (tested in creditscout-mapping.test.js)
dashboard/index.html                    static scorecard, reads dashboard/data/latest.json
.github/workflows/eval.yml              unit tests + eval on every push and pull request
LICENSE                                 MIT
```

## License

MIT, see [LICENSE](./LICENSE).
