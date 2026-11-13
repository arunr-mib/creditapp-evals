# creditapp-evals, case study

## The problem this solves

CreditScout's own README makes a strong claim: the model never produces a number, every figure traces to a calculation or a citation, or the system abstains. A claim like that is worthless without a way to check it mechanically, on every change, forever, not just once in a demo. That's what this repo is for: the part of the portfolio that proves the other parts aren't just well-written READMEs.

## Why the grader doesn't use an LLM to judge the agent

The tempting version of this product asks a second model "did the first model get it right?" I didn't build that, for the same reason CreditScout itself refuses to let a model produce a number: a judge that can't show its work is just a second thing you have to trust, and it can disagree with itself between runs on identical input, which breaks the one property a CI gate needs: that the same code gets the same verdict every time. The grader here is pure, deterministic code: it rounds DSCR to 2 decimal places and compares the value, not the text, and checks whether a cited source actually appears, nothing more exotic than that.

## A mistake in the stand-in data this harness caught during its own build

While writing the 15 cases, I built one case around CreditScout's known "covenant boarding lag" twist, a loan where an amendment is on file but deliberately not yet reflected in the system of record (`northgate-amendment-boarding-lag`). Writing the sibling true-breach case for the same borrower (`northgate-breach-expired-amendment`, a *different* amendment that actually expired), I hand-wrote its stand-in response using the same pattern as the boarding-lag case: apply the amendment, resolve the breach. (v1's recordings are hand-authored stand-ins, not live agent output; see [oracle sign-off](./oracle-signoff.md).) That was wrong. An expired amendment doesn't govern the test the way an unboarded-but-live one does, and the recorded response applied it anyway, landing on `no-breach` / 1.20x against an oracle of `breach` / 1.09x.

The grader caught it immediately: `verdict accuracy 93.3%`, `false resolve rate 6.7%`, case `northgate-breach-expired-amendment` labeled `false-resolve`: the single most dangerous failure mode this harness tracks, because it tells an analyst a breach is resolved when it isn't. The fix wasn't to the grader; it was to notice that "amendment on file" and "amendment currently in force" are different facts, and the harness needs both represented as genuinely different cases, not variations on the same template. The corrected stand-in now resolves to `breach` / 1.09x, matching the oracle, and the suite runs at 100% verdict and citation accuracy with zero hallucinations and zero false resolves, against stand-in data. The stand-ins stay as a regression suite; the same grader now also runs, unchanged, on real recorded CreditScout output (next section).

## Why citations compare after normalization, not as text

This is a known trap carried over from CreditScout directly: a groundedness guardrail that only accepts *calculated* numbers abstains on every legitimate explanation, because real explanations quote the covenant itself ("requires 1.25x"). The eval would read as flawless while the product did nothing useful: a metric that looks perfect because it's measuring the wrong thing. The grader's unit tests pin this directly (`grade.test.js`: "quoted covenant threshold in the citation text still matches after normalisation") so a future change can't silently reintroduce it.

## Grading real recorded runs, not just stand-ins

A grader that only ever sees hand-written answers proves the grader works, not the agent. So the harness now also grades CreditScout's real output: two recorded eval passes from 2026-11-13 (CreditScout commit `46f368c`, orchestrator `gpt-4.1-mini`, specialists `gpt-5-mini`), exported read-only from CreditScout's database by a committed script, against five cases whose expected values come from CreditScout's owner-signed oracle.

The results are published as they came out. Cold: 3 of 5. Warm: 4 of 5. Harbor Logistics (F1) failed in both passes: cold escalated it as a breach, warm abstained. Coastal Marine Q2 (F5-2026Q2) abstained cold after hitting the 12-step cap, then resolved correctly warm. Northgate and both code-decided Coastal quarters passed both times. Every miss was cautious: no false resolves in either pass.

Two decisions came out of this.

**A different gate for real runs.** The stand-in suite fails CI below 90% verdict accuracy, which is right for hand-written answers. Applying that bar to a real agent would either break CI on every honest run or tempt someone to tune the cases until it passed. Instead, the live product is gated on safety only: zero false resolves, zero invented numbers, every case recorded. Accuracy is reported in full, on the scorecard and in the runner output, and not gated. A false resolve still fails the build.

**Record what the guardrail did, not just the verdict.** In the warm pass the agent's raw answer on Harbor was `resolve`, and its explanation quoted a DSCR of 1.28 with a calc id that is not in CreditScout's calculation log. CreditScout's guardrail caught the unlogged figure and downgraded the casefile to `abstain`. Graded at the product boundary that is a `wrong-abstain`, and that is what the scorecard shows. But the agent did produce a figure no calculation backs, and this grader does not yet scan explanation text, so it could not have labeled that on its own. The export keeps the raw recommendation and the guardrail notes in every recording so the event stays visible, and an explanation-text check is on the list below.

The limits are stated next to the numbers: five cases, one run per pass, and real run-to-run variance (an earlier cold pass the same day scored 5/5 on CreditScout's own harness).

## What comes next

All ten of CreditScout's signed cases (five are waiting on borrowers to be onboarded), repeated runs per pass so a pass rate means something, a grader check for figures in explanation text that no logged calculation backs, then 100+ cases. Beyond CreditScout: a second product subfolder (`spreadsense/`) under the same grader and dashboard, grading extraction confidence rather than covenant verdicts, proving the harness generalizes. An opt-in live mode, clearly marked billable, stays out of CI.
