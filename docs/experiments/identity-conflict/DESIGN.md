# Identity-conflict check: frozen development design (2026-10-27)

**Status.** Frozen **before** the candidate method was implemented or run. Any later change is
recorded in `REPORT.md` as a deviation; this file is not edited after candidate results exist.

**What this is.** A development comparison, not a confirmatory evaluation.

- The scenes reuse one plant asset and one vase asset.
- The named seeds were seen during earlier development.
- Nothing here can support a claim about unseen look-alikes or objects.

## 1. The failure being addressed

**The case.** `lookalike-3d`, seed 123, layout v2 (`v2-04a6cf82`), reproduced on 2026-10-27 with
real COCO-SSD inference in Chromium (backend: WASM). Result: `surestop` **ARRIVED at the vase**
(candidate C1); the evaluator scored it a false arrival.

**Why it happened**, from the run record:

| Frame | What the detector reported |
|---|---|
| f16 | "potted plant" 0.838 on the vase |
| f18 | "potted plant" 0.668 on the vase |
| f11 | "vase" 0.569 at C1's bearing from 3.7 m |
| f17 (verification view) | "vase" 0.443, alongside a weak "potted plant" 0.361 |

- Each "potted plant" view of the vase was **VOLUMETRIC**. The geometry was right: the vase is a real
  3-D object. Two distinct cells met the confirmation rule.
- The sensor passes only target-class detections to the runner, so the verifier never saw the
  "vase" detections.
- **Repeated wrong labels plus correct geometry produced CONFIRMED.**

**Already rejected.** The semantic model previously proposed for this failure (MobileCLIP-S0,
`origin/research/semantic-validation` at `6413c23`) failed its pre-registered feasibility gate
(Gate D: D1, D2, D3, D5 and D6). It is not reconsidered here.

## 2. Candidate method: `surestop-identity` (experimental, opt-in)

It is identical to `surestop` (configuration `DEFAULT_SURESTOP`, unchanged) except for one rule.

**The rule.**

- **Confusable classes.** A fixed table maps the target class to COCO classes that are plausible
  alternative identities for the same object: `"potted plant" → ["vase"]`. This is the only entry.
  - The choice is informed by the diagnosed case. That is a known risk of fitting this one
    look-alike, and is reported as such.
- **Identity-conflict observation.** A detection of a confusable class, with score ≥ the mission's
  detection floor (0.3, the floor target detections already use) and valid depth in its box, is
  back-projected exactly as target detections are.
- **Association.** It is associated with a candidate when its position is within the mission's
  association gate (0.9 m, the gate target detections already use) of that candidate's current
  position estimate.
  - Observations from every frame of the mission count, including frames before the candidate was
    opened.
- **Effect.** While a candidate is PENDING, an associated identity conflict ends its verification as
  **UNCONFIRMED**, with rule `withhold-identity-conflict`. It is never REJECTED. The mission resumes
  the search. A conflict observed after a terminal decision is logged and changes nothing.
- **Inputs.** Detector outputs, depth and the robot's own pose only. No ground truth, object
  identifiers, mesh names, seeds or scene graph.

## 3. Matrix

**Layout:** v2 for every mission.

**Scenarios (7):**

- `clear-target`
- `poster-decoy`
- `screen-decoy`
- `decoys-only`
- `occluded-target`
- `photo-board-decoy`
- `lookalike-3d`

**Seeds (14):**

- 2, 17, 42, 123 — the named development cases;
- 5001–5010 — not used before this design; they are development seeds from now on.

**Methods (3):**

- `single-frame` (τ = 0.9, unchanged) — reference;
- `surestop` — the unchanged baseline;
- `surestop-identity` — the candidate.

**Total:** 7 × 14 × 3 = **294 missions**. Every world is identical across methods (same scenario,
seed and layout).

**Not covered on this branch:** a small genuine plant. This branch has one plant asset at one
scale. That control is **not tested** and is reported as such.

## 4. Metrics

**The unit is the mission.** Counts are reported with denominators.

| Metric | Definition |
|---|---|
| False arrival | ARRIVED at anything other than the target (evaluator) |
| Correct arrival | ARRIVED at the target, among target-present missions |
| Abstention | UNRESOLVED |
| Other outcomes | NOT_FOUND; NAV_FAILURE; failed (crashed) missions |
| Cost | Path length, simulated time, frames, verification frames |
| Runtime | Inference ms |

- **Uncertainty:** 95 % Wilson intervals on pooled mission proportions. Not a significance test.
- **Failure categories:** detection, semantic, association, geometry, verification and mission, read
  from each record.

## 5. Criteria for making `surestop-identity` the Mission Control default

All must hold. Otherwise it stays opt-in and experimental.

| Id | Criterion |
|---|---|
| A1 | 0 false arrivals on `lookalike-3d` seed 123 |
| A2 | False arrivals ≤ `surestop` in every scenario, and strictly fewer on `lookalike-3d` pooled when `surestop` has any there |
| A3 | Correct arrivals on target-present missions ≥ `surestop` − max(1, ⌊n/40⌋) |
| A4 | NAV_FAILURE not increased; UNRESOLVED increased by at most max(1, ⌊n/40⌋), where n is all missions |
| A5 | Median simulated time ≤ 1.15 × `surestop` |
| A6 | Code review: no seed-, scene-, object- or mesh-specific logic |

**Even if all pass,** the `surestop` method keeps its definition, so that records stay comparable. Only
the console's default method selection may change.

**Not confirmatory.** No result here is a validated or confirmatory claim.
