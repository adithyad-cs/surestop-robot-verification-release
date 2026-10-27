# Investigation plan: SureStop false arrival at the 3-D look-alike (layout v2)

> [!NOTE]
> **Superseded; kept as a historical record.** This was the investigation plan written while the
> failure was open. The diagnosis and the experimental identity-conflict check that followed are in
> [`experiments/identity-conflict/REPORT.md`](experiments/identity-conflict/REPORT.md). The original
> `surestop` method is unchanged and still confirms the vase in `lookalike-3d` seed 123. Commit
> hashes below refer to the development history, not to this repository.

_Status: open. No change has been made to address this failure. Evidence thresholds,
confirmation rules and detector settings are as in baseline `9e2ef2f`. The only later verifier
change is commit `1e81265`, which treats missing, non-finite or out-of-range inputs as
INCONCLUSIVE. The score, relief, noise and two-plane values recorded in this trace are finite
and in range; the trace does not store every input that check reads, so a full replay against
the current code has not been done. Line references below are to
`9e2ef2f`/`e509299`; at `63cec2e` they are `evidence.ts:82` and `verify/surestop.ts:187`._

## The failure

Run: `lookalike-3d`, seed 123, layout `v2-04a6cf82`, SureStop. The verbatim trace is in
`docs/experiments/layout-v2-smoke/lookalike-3d-seed123-surestop-trace.json`.

| Frame | Purpose | Detection | Depth evidence | `assessView` verdict |
|---|---|---|---|---|
| 16 | route scan | "potted plant" 0.838 | relief 117 mm (volumetric threshold 60 mm), two-plane < 0.85 | VOLUMETRIC |
| 17 | verify | "potted plant" 0.361. The same frame also has "vase" 0.443 and "dining table" 0.629 in other boxes | two-plane fraction 0.97 | INCONCLUSIVE (`evidence.ts:60`, checked before the score) |
| 18 | verify | "potted plant" 0.668 | relief 111 mm | VOLUMETRIC |

**Decision** (`verify/surestop.ts:178`):
- support = 2 (≥ `requiredSupport` 2);
- against = 0;
- closest supporting view 1.85 m (≤ `confirmRange` 2.5 m).

This gave CONFIRMED, then ARRIVED at the vase.

**Classification.**
- **Known method limitation.** The verifier tests flat versus volumetric over distinct viewpoints.
  It does not test identity, so a 3-D object that COCO-SSD labels "potted plant" from 2 viewpoint
  cells satisfies it.
- **Newly realised.** In the recorded v1 held-out data, SureStop had **0/20** look-alike false
  arrivals; the vase was never re-detected consistently. Only the 1-view ablation had any (7/20).
  In the v2 smoke test, SureStop confirmed the vase in 1 of 6 look-alike layouts and left it
  REJECTED or UNCONFIRMED in the other 5.

**Not established.**
- Whether the relief partly comes from the wall behind the flowers. The vase stood about 0.35 m
  from the north wall, and relief is a plane-fit RMS over the inner 60% of the box; the depth
  frames were not kept.
- Whether any candidate fix below helps without costing real-target completion.

## Candidate fixes (to be compared, none chosen)

1. **Metric size consistency.**
   - The candidate's physical height comes from box height × range ÷ focal length (≈ 515 px).
   - From this trace: about 0.68 m (frame 16) and 0.52 m (frame 18) for the vase, against
     0.95 m for the real plant.
   - Require a plausible "potted plant" height band, with the band set on calibration seeds only.
   - Risk: it encodes the size of one asset, so the band must be justified by the category, not
     by this vase.
2. **Supporting-view score floor.** Raise the score a VOLUMETRIC view needs before it counts as
   support (for example 0.7). Risk: real plants seen obliquely score lower, which would cost
   completion.
3. **More support.** Require 3 supporting cells instead of 2. Risk: longer paths, and more
   UNCONFIRMED real plants within the viewpoint budget (4).
4. **Cross-class conflict.** A view where another COCO class ("vase") overlaps the candidate's box
   counts against it. In this trace it would not have helped: frames 16 and 18 have no "vase" box.
   Listed so it is not rediscovered as a fix.
5. **Background-robust relief.** Compute relief on the near-surface quantile band only (for example
   points within 0.3 m of `nearDepth`). This addresses the background hypothesis, if it is true.

## Evaluation protocol (before any change is adopted)

- **Do not tune on the failing case.** Never tune on seed 123, or on any single failing case. The
  failing case is a regression check after the choice, not the basis for it.
- **Freeze before evaluating.** Freeze each candidate's parameter on **calibration seeds 101–110,
  v1 layout** using the existing selection-rule style: best completion, then lowest false-arrival
  rate. Record the frozen value before any evaluation run.
- **Evaluate on unseen data.** Use held-out seeds that have not been looked at:
  - v1 layout: new seeds (not 1001–1020);
  - v2 layout: seeds outside {0, 1, 2, 17, 42, 123}.

  Run all 7 scenarios × {current SureStop, each candidate} on both layouts.
- **Report.** For each candidate, give completion on target-present scenarios (real plant
  CONFIRMED and reached) and the false-arrival rate overall and on `lookalike-3d` alone, each
  with numerator/denominator and Wilson intervals, plus mean path length.
- **Accept only on a clear trade-off.** A candidate is acceptable only if completion is not
  credibly lower than current SureStop. Otherwise report the trade-off and keep the limitation
  documented.
- **Regression tests to add with any change.**
  - Unit: replay the three recorded views of this trace through `assessView` and `SureStopVerifier`
    as synthetic `CandidateObservation`s. Today this gives CONFIRMED; it must give the outcome the
    chosen fix is designed to produce.
  - Unit: a real-plant trace from v1 records (for example `lookalike-3d` 1001, SureStop) must still
    be CONFIRMED.
  - Real render (opt-in, like `tests/e2e/perception-decoy.spec.ts`): `lookalike-3d` seed 123 on
    `v2-04a6cf82`, plus the control seeds.
