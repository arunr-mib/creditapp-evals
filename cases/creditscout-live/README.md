# creditscout-live: cases for the real recorded CreditScout runs

Five cases, one per CreditScout oracle row that its 2026-11-13 eval runs actually exercised. They are graded against the real recorded agent output in [`recordings/creditscout-live/`](../../recordings/creditscout-live/).

## Where the expected values come from

- **Source:** CreditScout's owner-signed oracle, `data/expected-values-template.csv` at CreditScout commit `46f368c`. Every row there is marked `owner_signed_off = YES` in CreditScout.
- **Not signed here.** These expected values derive from CreditScout's owner-signed oracle and were **not separately signed in this repo**. [`docs/oracle-signoff.md`](../../docs/oracle-signoff.md) covers only the 15 stand-in cases in `cases/creditscout/`.
- **Different from the stand-in cases.** The stand-in suite uses its own invented values (for example a 1.30x Harbor minimum). These cases use CreditScout's real seed values (a 1.25x minimum for all five). The two sets are separate and neither is derived from the other.

Each case file carries the oracle row verbatim under `oracle`, `terms` and `financials`, and an `expected_derivation` sentence explaining how the graded `expected` block was built from it.

| Case | Borrower | Period | Oracle outcome | Expected verdict | Expected DSCR | Expected citations |
|---|---|---|---|---|---|---|
| F1-2026Q2 | Harbor Logistics | 2026-06-30 | resolve (amendment_addback) | no-breach | 1.28 (remapped) | CA §7.11, Amd 2 §3(a) |
| F3-2026Q2 | Northgate Foods | 2026-06-30 | escalate (true_breach) | breach | 1.08 (as tested) | CA §7.11 |
| F5-2025Q4 | Coastal Marine | 2025-12-31 | compliant_no_action | no-breach | 1.41 (as tested) | none |
| F5-2026Q1 | Coastal Marine | 2026-03-31 | variance_logged_no_investigation | no-breach | 1.29 (as tested) | none |
| F5-2026Q2 | Coastal Marine | 2026-06-30 | resolve (amendment_addback) | no-breach | 1.30 (remapped) | CA §7.11, Amd 2 §3(a) |

## How the expected block is derived

- **Verdict.** Oracle `resolve` maps to `no-breach`, `escalate` to `breach`, `compliant_no_action` and `variance_logged_no_investigation` to `no-breach`.
- **DSCR.** For a `resolve`, the oracle's `expected_dscr_remapped`, because the resolve rests on the unboarded amendment's add-back. Otherwise the oracle's `expected_dscr_as_tested`.
- **Citations.** The oracle has no citation column, so these are this repo's choice, taken from CreditScout's seed (`data/facilities.js`): the threshold clause `CA §7.11` for every investigated case, plus the Amendment No. 2 add-back clause `Amd 2 §3(a)` where the resolve depends on it. The two code-only cases expect no citations, because no agent ran. The grader matches citations by substring in either direction, so `CA §7.11(a)` satisfies `CA §7.11` and `Amd 2 §3` satisfies `Amd 2 §3(a)`.

## Not covered

CreditScout's oracle has five further signed rows (ZHATSAPP, MARCUS, ORION, PETWORKS, VANTAGE, all 2026Q3). CreditScout's run skipped them because those borrowers are not onboarded in its database yet, so there is no recorded output to grade and they are not included here.
