# creditapp-evals, case study

## The problem this solves

CreditScout's own README makes a strong claim: the model never produces a number, every figure traces to a calculation or a citation, or the system abstains. A claim like that is worthless without a way to check it mechanically, on every change, forever, not just once in a demo. That's what this repo is for: the part of the portfolio that proves the other parts aren't just well-written READMEs.

## Why the grader doesn't use an LLM to judge the agent

The tempting version of this product asks a second model "did the first model get it right?" I didn't build that, for the same reason CreditScout itself refuses to let a model produce a number: a judge that can't show its work is just a second thing you have to trust, and it can disagree with itself between runs on identical input, which breaks the one property a CI gate needs: that the same code gets the same verdict every time. The grader here is pure, deterministic code: it rounds DSCR to 2 decimal places and compares the value, not the text, and checks whether a cited source actually appears, nothing more exotic than that.

## A real failure this harness caught during its own build

While writing the 15 cases, I built one case around CreditScout's known "covenant boarding lag" twist, a loan where an amendment is on file but deliberately not yet reflected in the system of record (`northgate-amendment-boarding-lag`). Writing the sibling true-breach case for the same borrower (`northgate-breach-expired-amendment`, a *different* amendment that actually expired), I recorded the agent's output using the same pattern as the boarding-lag case: apply the amendment, resolve the breach. That was wrong. An expired amendment doesn't govern the test the way an unboarded-but-live one does, and the recorded response applied it anyway, landing on `no-breach` / 1.20x against an oracle of `breach` / 1.09x.

The grader caught it immediately: `verdict accuracy 93.3%`, `false resolve rate 6.7%`, case `northgate-breach-expired-amendment` labeled `false-resolve`: the single most dangerous failure mode this harness tracks, because it tells an analyst a breach is resolved when it isn't. The fix wasn't to the grader; it was to notice that "amendment on file" and "amendment currently in force" are different facts, and the harness needs both represented as genuinely different cases, not variations on the same template. The corrected recording now resolves to `breach` / 1.09x, matching the oracle, and the suite runs at 100% verdict and citation accuracy with zero hallucinations and zero false resolves.

## Why citations compare after normalization, not as text

This is a known trap carried over from CreditScout directly: a groundedness guardrail that only accepts *calculated* numbers abstains on every legitimate explanation, because real explanations quote the covenant itself ("requires 1.25x"). The eval would read as flawless while the product did nothing useful: a metric that looks perfect because it's measuring the wrong thing. The grader's unit tests pin this directly (`grade.test.js`: "quoted covenant threshold in the citation text still matches after normalisation") so a future change can't silently reintroduce it.

## What v2 adds

A second product subfolder (`spreadsense/`) under the same grader and dashboard, grading extraction confidence rather than covenant verdicts, proving the harness generalizes rather than being CreditScout-shaped underneath a generic name. An opt-in `--live` mode, clearly marked billable, for running the suite against a real deployed agent rather than recorded traces, never the CI default.
