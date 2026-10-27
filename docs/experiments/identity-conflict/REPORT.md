# Identity-conflict check: development report (2026-10-27)

> [!NOTE]
> **Release note.** Commit hashes below refer to the development history, not to this repository.
> §1 cites research-governance records (G0, Stage 5N-B, `PROTOCOL_READINESS.md`) that belong to a
> separate research repository and are not included here; they define which data this work was
> allowed to use. Check results in §7 and §9 were measured on the development builds named there;
> the checks run on this release are in [`BUILD_STATUS.md`](../../../BUILD_STATUS.md).

**What this is.** A development comparison under the frozen design in `DESIGN.md` (commit `1df29d3`,
written before the candidate existed). It is not a confirmatory evaluation.

**Code identity:**

| Commit | What it holds |
|---|---|
| `c0ff984` | The candidate (`surestop-identity`) |
| `e8aee7d` | Console traceability changes. They do not touch decision code |

The matrix ran on a diagnostics build of `c0ff984`.

## 1. Data access in this workstream

**Application data used.**

- **The project's own development assets:** `public/assets/models/*.glb`, the plant and vase
  lineage group. G0 marks it development-only; the Stage 5N-B recovery plan lists it as permitted
  for development (X-3).
- **Synthetic fixtures.**
- **Recorded runs and calibration data,** read by the existing unit tests. `PROTOCOL_READINESS.md`
  §5.1 classifies them as a previously inspected regression and development set, not test data.

**Research data not used.**

- No G0 object, candidate data, split mapping, sealed-member metadata or fingerprint, or research
  evidence from `research/asset-family-acquisition` or `research/g0-asset-audit` was read.
- This worktree (`claude/peaceful-newton-8lasli`, from `b18a5fd`) does not contain those files.

**Seeds.**

- The held-out seeds 1001–1020 and the asset-holdout seeds 3001–3010 were not run.
- 5001–5010 were unused before this design and are development seeds from now on.

## 2. Diagnosis (before the change)

Reproduced on 2026-10-27, `lookalike-3d` seed 123, layout `v2-04a6cf82`. Real COCO-SSD 2.2.3
(`lite_mobilenet_v2`) inference in Chromium 153 on the WASM backend.

**Result:** `surestop` ARRIVED at the vase (C1) after CONFIRMED, at frame 19. The single-frame
baseline arrived at the plant.

| Frame | Robot pose (x, z, θ) | Detector output at the vase (≥ 0.3) | Verifier |
|---|---|---|---|
| f11 | (−5.40, −2.40, −30°) | "vase" 0.569 | not seen: the sensor dropped non-target classes |
| f16 | (−2.40, −2.60, −90°) | "potted plant" 0.838 | VOLUMETRIC (relief 117 mm above noise), cell r2:b3 |
| f17 | (−4.06, −3.95, −15°) | "vase" 0.443 and "potted plant" 0.361 | INCONCLUSIVE, cell r2:b5 |
| f18 | (−0.87, −2.95, −135°) | "potted plant" 0.668 | VOLUMETRIC, cell r2:b1 → **CONFIRMED** |

**Failure categories:**

- **Semantic failure:** the detector labels the vase "potted plant".
- **Verification failure:** two volumetric cells were accepted as identity.

It is **not** a geometry failure (the vase is volumetric) and not an association failure (every view
is of C1).

## 3. Change

Method `surestop-identity`, opt-in (`src/verify/identity.ts`, `src/verify/surestop.ts`,
`src/mission/runner.ts`, `src/mission/browserSensor.ts`).

**How a conflict is found:**

- A detection of a class confusable with the target (`"potted plant" → ["vase"]`, the only entry)
  is localised by the same depth back-projection as target detections.
- It is associated by the same 0.9 m gate, from any frame of the mission.

**What it does:**

- It withholds confirmation: the candidate ends **UNCONFIRMED** with rule
  `withhold-identity-conflict`, never REJECTED, and the search resumes.
- Conflicts are delivered before a frame's target evidence.

**What it does not change:** `surestop`, the baselines and their record formats.

**Inputs:** detector outputs, depth and the robot's own pose. No ground truth, object identifiers,
seeds or scene graph.

## 4. Results

Generated from `results/matrix-summary.json` (`scripts/dev/identity-matrix.py`).

### 4.1 Batch

| Item | Value |
|---|---|
| File | `results/matrix-v2.json.gz` (SHA-256 `22da127e…2e9`) |
| Status | 294 of 294 missions complete; 0 failed missions; 0 console errors; wall time 1,947 s (`wallMs` in the batch file) |
| Build | Clean production build of `c0ff984` (`sourceDirty: false`) |
| Runtime | Chromium 153 (not Playwright's pinned 1194, which cannot be installed here), SwiftShader WebGL; COCO-SSD 2.2.3 `lite_mobilenet_v2` on WASM |
| Protocol hash | `5d764a96…1799` |
| Summary | `results/matrix-summary.json`, which regenerates byte-identically from the `.gz` |

### 4.2 Pooled

98 missions per method; 84 target-present (6 scenarios × 14 seeds); 95 % Wilson intervals.

| Method | False arrivals | Correct arrivals (target present) | UNRESOLVED | NOT_FOUND | NAV_FAILURE | Median sim time | Median path | Mean verification frames |
|---|---|---|---|---|---|---|---|---|
| `single-frame` (τ 0.9) | **13/98** [0.079, 0.214] | 45/84 [0.430, 0.638] | 0 | 40 | 0 | 77.6 s | 28.3 m | 0 |
| `surestop` (baseline) | **1/98** [0.002, 0.056] | 83/84 [0.936, 0.998] | 0 | 14 | 0 | 93.7 s | 33.4 m | 3.58 |
| `surestop-identity` | **0/98** [0.000, 0.038] | 84/84 [0.956, 1.000] | 0 | 14 | 0 | 89.2 s | 31.5 m | 3.17 |

**NOT_FOUND = 14** for both SureStop methods means the `decoys-only` missions (14/14), which are
correct terminal outcomes there.

**Per-method detector latency cannot be measured.** Variants of one world share the sensor's
per-pose frame cache, so later variants mostly replay earlier frames. Detector inference over all
4,655 uncached frames: median 98.9 ms, p95 141.9 ms (WASM, software rendering). The model loaded
in 373 ms on this run, from the browser cache.

### 4.3 Per scenario

Each cell is false arrivals / correct arrivals, out of 14.

| Scenario | `single-frame` | `surestop` | `surestop-identity` |
|---|---|---|---|
| clear-target | 0 / 12 | 0 / 14 | 0 / 14 |
| poster-decoy | 0 / 10 | 0 / 14 | 0 / 14 |
| screen-decoy | 0 / 6 | 0 / 14 | 0 / 14 |
| occluded-target | 1 / 6 | 0 / 14 | 0 / 14 |
| photo-board-decoy | **11** / 1 | 0 / 14 | 0 / 14 |
| lookalike-3d | 0 / 10 | **1** / 13 | 0 / 14 |
| decoys-only (no target) | **1** false arrival | 0 | 0 |

### 4.4 Paired changes, `surestop` → `surestop-identity`

98 identical worlds (scenario, seed, layout id). **Exactly one mission outcome differs:**
`lookalike-3d` seed 123 `v2-04a6cf82`, a false arrival → a correct arrival.

### 4.5 What the check withheld

14 candidates, all ending UNCONFIRMED; none REJECTED.

| Object | Withheld | Note |
|---|---|---|
| The vase | **13** of the 13 missions in which it became a candidate | Under baseline `surestop` the same 13 vases were 12 UNCONFIRMED (viewpoint budget spent) and **1 CONFIRMED** (seed 123) |
| A printed poster (`poster-decoy` seed 5008) | 1 | COCO-SSD called it "vase" 0.50. It never led to an arrival. A flat decoy ends UNCONFIRMED here instead of REJECTED by the flatness rule, which is a loss of information though not of safety |
| Genuine plants | **0 of 84** | — |

**The conflicting "vase" detections** that were used had scores 0.30–0.58 and lay 0.01–0.63 m from
the candidate estimate. In 4 of 13 vase cases (seeds 42, 123, 5006 and 5009) the conflict came
from a frame before the candidate opened.

**Effect on viewpoints:** mean verification frames per mission fall from 3.58 to 3.17. A withheld vase
is no longer re-observed until the budget is spent.

### 4.6 Failure categories (DESIGN.md §4)

| Method | Categories |
|---|---|
| `single-frame` | NOT_FOUND because no frame reached τ (27); geometry, a flat decoy confirmed (12); arrived at an obstacle (1) |
| `surestop` | Semantic: the look-alike labelled as the target and confirmed (1) |
| `surestop-identity` | None |

### 4.6a Decoy exposure: did real perception ever propose the decoy?

**A correct arrival in a decoy scenario is no evidence of decoy rejection** when the detector never
proposed the decoy. These counts are in `results/matrix-summary.json` (`decoyExposure`).

| Scenario | Missions in which the decoy became a candidate (all methods alike) | `surestop` decoy candidates | `surestop-identity` decoy candidates |
|---|---|---|---|
| poster-decoy | 11/14 | 11 REJECTED | 10 REJECTED, 1 UNCONFIRMED (withheld) |
| screen-decoy | **5/14** | 5 REJECTED | 5 REJECTED |
| photo-board-decoy | 14/14 | 14 REJECTED | 14 REJECTED |
| decoys-only | 13/14 (16 decoy candidates under `single-frame`, 17 under each SureStop method) | 17 REJECTED | 17 REJECTED |
| lookalike-3d | 13/14 | 12 UNCONFIRMED, **1 CONFIRMED** | 13 UNCONFIRMED (withheld) |

**The named development cases poster seed 42, screen seed 2 and screen seed 17** are **detection
gaps**:

- real perception never made the decoy a candidate under any method;
- their correct arrivals test nothing about rejection;
- the opt-in perception spec (`tests/e2e/perception-decoy.spec.ts`) documents this. It was skipped in
  the matrix-era check run (§7) and run in the freeze verification (§9).

The screen decoy reached the verifier in only 5 of 14 missions.

### 4.7 Criteria (DESIGN.md §5)

| Id | Result |
|---|---|
| A1 | 0 false arrivals at seed 123 — **pass** |
| A2 | ≤ baseline in every scenario; 0 vs 1 on `lookalike-3d` — **pass** |
| A3 | 84 ≥ 83 − 2 — **pass** |
| A4 | NAV_FAILURE 0 = 0; UNRESOLVED 0 = 0 — **pass** |
| A5 | 89.2 s ≤ 1.15 × 93.7 s — **pass** |
| A6 | `src/verify/identity.ts`, `surestop.ts`, `runner.ts` and `browserSensor.ts` contain no seed, scene, object-identifier or mesh logic; the only domain input is the class table — **pass** |

**Consequence, as DESIGN.md allows:** Mission Control preselects `surestop-identity` for fresh visits
and new-style links. Legacy links keep `surestop`. The `surestop` method and all recorded results
are unchanged. The method stays labelled **experimental**.

**What the comparison cannot show.** The false-arrival difference is 1 versus 0 in 98. The intervals
overlap; this is not a statistically distinguishable improvement. What the matrix shows is:

- the known failure is fixed on its world;
- no measured cost to genuine targets, abstention, navigation or time on these 98 worlds.

## 5. Deviations from DESIGN.md

- **Detector latency.** It is reported pooled over uncached frames, not per method (§4.2): the
  shared frame cache makes per-method latency meaningless. Not a change to any criterion.
- Otherwise none. The matrix, seeds, layout, methods, metrics and criteria are as frozen.

## 6. Limitations

- **One look-alike asset and one plant asset.** The confusable-class table was chosen from the
  diagnosed case. Nothing here shows the check works for other look-alikes, other target classes or
  real images.
- **It depends on the detector naming the look-alike correctly in at least one localised view.**
  A look-alike that COCO-SSD never calls "vase" (or that has no valid depth when it does) is not
  caught. The synthetic test for a conflict without depth shows that the false arrival then remains.
- **A false "vase" detection within 0.9 m of a genuine plant withholds that plant permanently.**
  The cost to genuine targets is measured below only on this asset, this layout generator and these
  seeds.
- **Development seeds and scenes only;** the named seeds were seen earlier. Intervals describe this
  sample, not a population.

## 7. Checks

All checks ran in `/home/user/surestop-app` on 2026-10-27.

**Browsers.** Browser checks used Chromium 153 at `/opt/pw-browsers/chromium` through a local,
uncommitted config that extends `playwright.config.ts` with that executable. The pinned headless
shell 1194 cannot be installed here.

| Command | Result |
|---|---|
| `npm ci` | exit 0; 418 packages from the unchanged lockfile |
| `npx vitest run` | **402/402 pass**, 30 files. The new `identityConflict.test.ts` has 15 tests (an earlier count of 16 was a miscount): verifier, ordering, pre-candidate conflicts, no depth, gate, unchanged baseline records, console default method, Method-page summary copy. The Mission Control stub gained one view method |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run build` and `npm run build:diagnostics` | exit 0 |
| `git diff --check` | clean |
| `node scripts/missions.mjs … lookalike-3d 123 surestop,single-frame` (before the change) | `surestop` false arrival reproduced (`results/repro-123.json.gz`) |
| `node scripts/missions.mjs … lookalike-3d 123 surestop,surestop-identity` | `surestop` false arrival; `surestop-identity` correct arrival (`results/fix-123.json.gz`) |
| `node scripts/missions.mjs …` (the frozen matrix, 294 missions) | batchStatus complete, 0 failed missions, 0 console errors |
| `npx playwright test -c .cache/pw-substitute.config.ts` (full suite, production build of `23dcbc9`) | **26 passed, 4 skipped, 0 failed** (11.2 min). Includes both new `identity.spec.ts` tests. The 4 skips are the opt-in real-perception specs (`SURESTOP_PERCEPTION=1`) |
| `npx playwright test … routes.spec.ts` (final sources, after the Method-page change) | 7 passed |

**Not run:**

- the opt-in `perception-decoy.spec.ts` (4 tests);
- `npm run aggregate`;
- deployment (not authorized);
- any research-workstream command.

**Categories, not interchangeable:**

| Kind of check | What it shows | What it does not show |
|---|---|---|
| Unit tests | Logic, on synthetic inputs | Model behaviour |
| Browser tests | The app and real inference run end to end on named worlds | General reliability |
| The matrix | Development behaviour on 98 worlds per method | A confirmatory evaluation |

## 8. Mission lifecycle and traceability audit

**Read from source and covered by tests.** Each property names the tests that check it.

| Property | Where it is enforced | Tests |
|---|---|---|
| Arrival only after CONFIRMED; proximity alone never arrives | `MissionRunner.decide` → `startApproach` only for a CONFIRMED track; ARRIVED only in APPROACHING | `mission.test.ts`, `decisionRules.test.ts` |
| A failed model call or step never becomes an outcome | The step throws → Mission Control `error` phase, no result or score; Reset rebuilds | `missionFailures.test.ts` ("ends in the error phase…", "operator recovery…") |
| Invalid, missing or non-finite evidence is never VOLUMETRIC or FLAT, and cannot add a viewpoint cell | `assessView`, `SureStopVerifier.observe` (fail closed, `1e81265`) | `invalidEvidence.test.ts` |
| UNCONFIRMED is never success | `finish` maps unconfirmed candidates to UNRESOLVED; a confirmation on the last frame is UNRESOLVED | `mission.test.ts` ("ambiguous evidence…", "…last allowed frame…") |
| An identity conflict cannot be overtaken by the same frame's confirming view | Conflicts are delivered before the frame's target evidence | `identityConflict.test.ts` ("a conflict in the very frame…") |
| No seed, scene or ground-truth input to robot-facing code | `src/verify` and `src/mission` import no `src/sim/assets` or `src/eval` | `isolation.test.ts` |
| Selecting an earlier frame shows that frame's capture pose (fixed this round) | `ConsoleController.historicalFrame`, `SceneView.setCapturePose`, the "Pose at #N" row | `tests/e2e/identity.spec.ts` |

**Defect found and fixed:**

- **Before:** the camera, depth and evidence panels followed a selected earlier frame, but the 3-D
  view and the "Pose" readout kept showing the live robot.
- **After:** while an earlier frame is selected, the 3-D view shows an amber capture-pose marker with
  the camera's field of view, and the state panel shows that frame's pose separately from the live
  pose.

## 9. Freeze verification (2026-10-27)

No algorithm, model, feature or UI change. Only documentation accuracy fixes (`ecb16eb`), a recorded
re-check (`a82294f`) and this text.

**Final-source browser suite.** The full suite was run twice, each time against a clean production build
whose embedded provenance reads `sourceDirty: false`. Both runs included the opt-in perception specs.

| Build | Command | Result |
|---|---|---|
| `4d0d28d` | `SURESTOP_PERCEPTION=1 PW_CHROME=/opt/pw-browsers/chromium npx playwright test -c .cache/pw-substitute.config.ts` | **30 passed, 0 skipped, 0 failed** (13.5 min); exit 0 |
| `a82294f` | the same | **30 passed, 0 skipped, 0 failed** (13.7 min); exit 0 |

**The four perception-decoy tests passed in both runs:**

- **Detection gaps:** poster-decoy seed 42, screen-decoy seeds 2 and 17. No decoy track; this is the
  documented current behaviour, not a rejection.
- **Control:** poster-decoy seed 0. The decoy is met and REJECTED.

**Server start (local tooling).** Each run used a production server started from the app root
(`npx next start -p 3200`), which `reuseExistingServer` then reuses.

- **Why:** when the local substitute config lets Playwright start the server itself, it runs from
  `.cache/`. `next.config.ts` then cannot resolve `./scripts/build-meta.mjs`, and no test runs.
- **Scope:** this affects only the uncommitted local config, not the committed `playwright.config.ts`.

**Other checks on the freeze sources (`ecb16eb` and later; `a82294f` adds only a data file):**

| Command | Result |
|---|---|
| `npx vitest run` | exit 0; **402/402**, 30 files |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run build` | exit 0; provenance `a82294f…`, `sourceDirty: false` |
| `npm run build:diagnostics` | exit 0; provenance `ecb16eb…`, `sourceDirty: false` |
| `git diff --check` | clean |

**Demo-world re-check:**

- **Command:** `node scripts/missions.mjs http://localhost:3100 "run=1&scenarios=lookalike-3d,photo-board-decoy&seeds=17,123&methods=single-frame,surestop,surestop-identity&layout=v2" …`, on the diagnostics build of `ecb16eb`.
- **Batch:** 12 missions, batchStatus complete, 0 failed, 0 console errors. Detector, runtime and
  asset hashes are identical to the matrix.
- **Result:** all 12 are identical to their `matrix-v2` records in layout id, outcome, track statuses
  and rules, detector scores, frame counts and identity conflicts. They are recorded in
  `results/demo-check.json.gz`.

**Documentation audit.** Every figure on the Method page is read from `results/matrix-summary.json`.
I recomputed the figures in REPORT §4 independently from the raw batch. Corrections:

- the wall time is 1,947 s (`wallMs`), not 1,953 s;
- `single-frame` had 16 decoys-only decoy candidates, not 17;
- this file's test count (above).

The summary script now also writes `decoyExposure`. Every other field regenerates unchanged.

**Still not run:**

- `npm run aggregate`;
- deployment (not authorized);
- any research-workstream command.

**The scientific evaluation gate stays BLOCKED.** These are development results on seeds seen during
development, with one vase asset and one plant asset.
