# Demonstration script (about 5 minutes)

The short presenter sheet, with rehearsed observations and recovery steps, is
[`FINAL_DEMO_HANDOFF.md`](FINAL_DEMO_HANDOFF.md).

**Every expected outcome below** was recorded on 2026-10-27 in the development matrix:

- file: `docs/experiments/identity-conflict/results/matrix-v2.json.gz`;
- build: `c0ff984`;
- runtime: real COCO-SSD inference, WASM backend, software WebGL.

Missions are deterministic for a given build, layout and seed, so the same worlds give the same
outcomes. Detector scores can differ slightly on other GPUs or browsers.

**Re-checked at the freeze.** The demo worlds (`lookalike-3d` and `photo-board-decoy`, seeds 17 and
123, all three methods) were re-run on a clean build of `ecb16eb`. All 12 missions were identical to
their matrix records (`docs/experiments/identity-conflict/results/demo-check.json.gz`). Steps 1 and 2
are also asserted in the browser by `tests/e2e/identity.spec.ts`.

## Setup

```
npm ci
npm run build
npm start                     # http://localhost:3000
```

**Requirements:**

- Node ≥ 20.9.
- A browser with WebGL2 and float render targets. The console says so if they are missing.
- The detector weights (about 18 MB) and 3-D assets are served from `public/`. No network model download,
  account or key is needed.

**Timing:** on software WebGL a mission takes about 30–60 s at "Max" playback.

## 1. The false arrival SureStop could not prevent (baseline)

**Open:** `/console?scenario=lookalike-3d&seed=123&method=surestop&layout=v2`

**Then:** choose **Max**, then **Run mission**.

**Expected:**

- The layout id reads `v2-04a6cf82`.
- The robot opens candidate C1 at a vase of flowers. COCO-SSD labels it "potted plant" (0.84 and
  0.67).
- Depth is volumetric from two viewpoints, so C1 is **CONFIRMED** and the mission is **ARRIVED**.
- The Evaluator (ground truth, shown only after the mission) reads **False arrival**.

**Point:** geometry is right, because the vase is 3-D. Repeated wrong labels are not identity.

## 2. The same world with the identity-conflict check (experimental)

**Open:** `/console?scenario=lookalike-3d&seed=123&method=surestop-identity&layout=v2`

This is also what Mission Control preselects for new-style links without a method.

**Expected:**

- C1 is **UNCONFIRMED**. Its reason reads: `identity conflict: the detector also reported "vase"
  (0.57) 0.46 m from this candidate (frame 11); confirmation withheld`.
- The search resumes. C2 (the plant) is **CONFIRMED** from two volumetric views, and the mission is
  **ARRIVED**.
- The Evaluator reads **Correct arrival**.

**Traceability:**

1. Select **C1**. Its *Identity conflicts* list shows `#11 "vase" 0.57 at 0.46 m · withheld confirmation`.
2. Select **#11**.
   - The camera panel shows frame 11, with the vase box.
   - The evidence panel lists the conflict.
   - *Pose at #11 (capture)* appears next to *Pose (now)*.
   - The 3-D view shows an amber capture-pose marker where the robot stood for frame 11.
3. Selecting the newest frame removes the marker.

**Say:**

- **It withholds; it never rejects.** It needs the detector to name the object as a vase in at least
  one localised view.
- **It is experimental.** In 98 development worlds it removed this one false arrival, with no measured
  cost: 84/84 genuine plants reached. That is not a statistically established improvement.

## 3. Flat decoy: the baseline that arrives at a picture

**Open:** `/console?scenario=photo-board-decoy&seed=17&method=single-frame&layout=v2`

**Expected:** the layout id reads `v2-60cecb85`. COCO-SSD labels the life-size photo board
"potted plant" (0.93), so single-frame τ = 0.9 arrives at it. The Evaluator reads **False
arrival**.

**Then switch** the method to *SureStop + identity-conflict check* and run again.

**Expected:**

- The board is detected again (up to 0.99), so this is a real rejection, not a missed decoy.
- C1 (the board) is **REJECTED**: `flat-surface evidence from 2 distinct viewpoints, no volumetric
  evidence`.
- C2 (the plant) is **CONFIRMED**, and the mission is **ARRIVED**.
- The Evaluator reads **Correct arrival**.

## 4. Evidence and experiments

- **`/lab`:** the recorded held-out results (v1 layout, 560 missions) with denominators and Wilson
  intervals.
  - *Run an experiment* runs real missions in the browser.
  - CSV and JSON exports reflect the recorded runs.
- **`/method`:** the verification policy, the experimental check, and the limitations.

## What not to claim

- No real robot, ROS or hardware.
- No safety claim.
- Not general object identity.
- The development matrix is not a confirmatory evaluation: one plant asset, one vase asset, seeds
  that were seen during development.
- The confusable-class table has one entry (`potted plant → vase`), chosen from this very case. It is
  a conflict rule over the detector's own labels, not a semantic identity system.
- The 1 vs 0 false-arrival difference over 98 worlds is not statistically established.
- Do not use `poster-decoy` seed 42 or `screen-decoy` seeds 2 and 17 as rejection examples: real
  perception never made the decoy a candidate there (`tests/e2e/perception-decoy.spec.ts`). The
  screen decoy became a candidate in only 5 of 14 development worlds.
