# Oracle sign-off

The 15 golden cases in `cases/creditscout/` were reviewed and approved by the repo owner (Arun Rajendiran) on 2026-11-11. Every expected verdict, DSCR, and citation listed there is owner-signed, per the same rule CreditScout itself follows: no case governs a grade until a human has approved its expected values.

This does not cover the *recordings* in `recordings/creditscout/`. Those are hand-authored stand-in agent responses for v1's recorded-trace mode, not output from a live CreditScout agent run. The grader's PASS/FAIL math is real; what it's grading, in this phase, is synthetic data written to exercise the harness, not a live agent's answers. A `--live` mode against the real deployed agent is a later phase (see README).
