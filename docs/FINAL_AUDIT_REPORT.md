# SureStop: final independent audit

> [!NOTE]
> **Release note.** A dated record of the 2026-10-19 audit of the original prototype, with its
> remediation log (§L). The Lab's "Correction (audit, 2026-10-20)" note and the Method page
> chronology cite it. Branches and commit hashes refer to the development history, not to this
> repository, and later changes (layout v2, the identity-conflict check) are not covered here.

_Audit date 2026-10-19. Branch `feature/surestop-prototype` at `27c50ad`. Sections A–K are the
original audit, unchanged; no production code, experiment record, threshold, scenario, test,
README claim or configuration was changed during it. The remediation that followed on
2026-10-20 is logged separately in section L at the end._

Audit scripts lived outside the repository in the audit session's temporary scratchpad directory
(not preserved; written `<audit>/` below):

| Script | What it does |
|---|---|
| `a1_integrity.py` | dataset integrity |
| `a2_margin.py` | margin/clearance check |
| `gt_dump.ts` → `gt.json` | ground-truth dump for relabelling |
| `a3_metrics.py` | independent relabel and metric recomputation |
| `a4_compare.py` | published tables vs recomputed values |
| `a5_claims.py`, `a7_v1claim.py`, `a7b_bymethod.py` | prose claims |
| `a6_calibration.py` | calibration selection |
| `a8_feasibility.py` | Phase A claims |
| `a9_states.mjs`, `a11_export.py` | browser error states and export integrity |
| `a10_rerun_compare.py` | real-inference determinism |

Logs are in `<audit>/logs/`; the clean clone is in `<audit>/clone/`. These files are
session-local: they are not in the repository and will disappear with the container.

---

## A. Verdict

**PASS WITH CONDITIONS.**

**What passed:**
- Every published number was recomputed exactly from the committed held-out records: 104
  table/prose numbers plus all Wilson intervals, with 0 discrepancies.
- The evaluator's ground-truth labels were reproduced independently in 100 % of tracks.
- The robot-side code has no runtime import path to ground truth.
- Calibration and evaluation seeds are disjoint. The baseline thresholds follow from the stated
  rule.
- A clean install from the lockfile passes lint, typecheck, 67 unit tests, the production build
  and the 11 production e2e tests.
- A fresh real-inference re-run of 16 held-out missions (2 scenarios × 2 seeds × 4 methods) from the clean clone reproduced the recorded records exactly: identical poses, detector scores, relief values and evaluator scores.

**No defect was found that invalidates the recorded results**, and nothing was found that
suggests concealment.

**The conditions** are about how the results are described and reproduced, not about the
recorded numbers:
1. Some score claims in the README and on the Method page are contradicted by the raw records
   (J-2).
2. The headline false-arrival gap rests entirely on one post-hoc scenario (J-1). This is
   disclosed, but it must stay the framing.
3. The raw calibration records and code provenance are not in the repository (J-3, J-4).
4. The README reproduction commands are not runnable as written (J-9).
5. Licence text is missing for the redistributed Apache-2.0 binaries, and there is no project
   licence (J-10).
6. Deployment has not been performed or verified (section I).

**Ready to proceed?**
- **Merge into `main`:** yes. Nothing found blocks it technically; the merge decision is the
  owner's.
- **External submission:** only after the "must fix before submission" items in K.

---

## B. Repository identity

| Item | Observed |
|---|---|
| Remote | `https://github.com/adithyad-cs/surestop-robot-verification` |
| Audited branch / HEAD | `feature/surestop-prototype` @ `27c50ad5fb42f1fc4a677bf3af936e79bb90d604`, equal to `origin/feature/surestop-prototype` (`git ls-remote`) |
| `main` | `2732bce` "Initial commit", locally and on origin; not modified |
| Other refs | `origin/claude/determined-fermat-u0d6pa` also points at `27c50ad`; the local branch of that name is still at `2732bce` |
| Working tree | Clean before the audit (`git status --porcelain` empty). The only change afterwards is this untracked file |
| Commits on the branch | 6 since `main`: `1994d8d` Phase A/B → `cac2b54` Phase C → `2c5200c` Phase D/E (calibration v1 build) → `7c1f2a4` fixes after v1 + photo board → `e37e6d7` calibration v2 + thresholds → `27c50ad` evaluation, report, QA |
| Tracked files | 132; `.git` is 40 MB; large tracked files are the weights (18 MB), GLB assets (21 MB) and `public/data` (12 MB) |
| Toolchain used | Node 22.22.0, npm 10.9.4; Chromium headless shell from Playwright 1.56.1 with SwiftShader |

**Committed data checksums (sha256 prefixes):**

| File | sha256 prefix |
|---|---|
| `public/data/eval-runs.json` | `37d9d218005557c3` (10,908,084 B) |
| `public/data/eval-summary.json` | `cff3356142de4bc2` |
| `public/data/calibration.json` | `42f5731e5a41c0e7` |
| `docs/experiments/calibration-v1-summary.json` | `4e4dda17ed1b6f31` |
| `docs/RESULTS.md` | `f1f9012311a203bf` |

---

## C. Metric reconciliation

**Sources:**
- Published values come from `README.md`, `docs/RESULTS.md` and `BUILD_STATUS.md`.
- Recomputed values come from `public/data/eval-runs.json`, using my own relabelling against
  `src/scenarios/layout.ts` ground truth (`<audit>/a3_metrics.py`).

**Definitions (as implemented in `src/eval/metrics.ts`):**
- **FAR** = trials ending in a false arrival ÷ trials in which at least one non-target candidate
  track was opened.
- **CCR** = correct arrivals ÷ target-present trials.
- **Abstention** = UNRESOLVED ÷ trials with at least one track.
- **Completion** = correct terminal outcome ÷ all trials.

No trials were excluded.

| Metric | Previously reported | Independently recomputed | Numerator / denominator | Status | Evidence path |
|---|---|---|---|---|---|
| SureStop FAR, all 7 | 0 % (0/85), CI 0–4 % | 0/85, Wilson 0–4.3 % | false arrivals / trials with a non-target track | MATCH | `public/data/eval-runs.json`; `<audit>/a3_metrics.py` |
| Single-frame τ=0.9 FAR, all 7 | 19 % (16/85), 12–28 % | 16/85, 11.9–28.4 % | same | MATCH | same |
| Persistence τ=0.8 FAR, all 7 | 39 % (33/85), 29–49 % | 33/85, 29.2–49.5 % | same | MATCH | same |
| 1-view ablation FAR, all 7 | 8 % (7/85), 4–16 % | 7/85, 4.0–16.0 % | same | MATCH | same |
| Completion, all 7 (SS / SF / P / 1v) | 140/140, 121/140, 83/140, 133/140 | identical | correct terminal / 140 | MATCH | same |
| CCR, all 7 | 120/120, 101/120, 75/120, 113/120 | identical | correct arrivals / 120 target-present | MATCH ("63 %" for 75/120 is JS half-up rounding of 62.5 %) | same |
| Abstention, all methods | 0/139 | 0/139 | UNRESOLVED / trials with ≥ 1 track | MATCH | same |
| FAR, original 6 (SS / SF / P / 1v) | 0/65, 0/65, 27/65, 7/65 | identical | as above, excluding `photo-board-decoy` | MATCH | same |
| Completion, original 6 | 120/120, 117/120, 70/120, 113/120 | identical | / 120 | MATCH | same |
| Mean path, all 7 (SS / SF / P / 1v) | 36.2, 23.7, 21.7, 28.8 m | identical | mean of `pathLength` over 140 | MATCH | same |
| Path overhead, original 6 | "about 39 %" (36.1 vs 25.9 m) | 36.1 / 25.9 = 1.394 | — | MATCH | same |
| Mean frames, all 7 (SS / SF) | 38.4, 35.4 | identical | mean `frames` | MATCH | same |
| Photo-board false arrivals (SF / SS) | 16/20, 0/20 | identical | per-scenario count | MATCH | same |
| Vase: candidates / UNCONFIRMED (SS) | 18 of 20 trials, all 18 UNCONFIRMED | 18/20, 18 UNCONFIRMED | lookalike tracks | MATCH | `<audit>/a5_claims.py` |
| 1-view false arrivals, look-alike | 7/20 | 7/20 | — | MATCH | same |
| Calibration selection | single-frame τ=0.9, persistence τ=0.8 | identical from 770 raw v2 records | rule in `scripts/aggregate.ts:17` | MATCH (raw records are session-local only; see J-3) | `<audit>/a6_calibration.py` |
| Calibration table (11 rows) | `public/data/calibration.json` | 11/11 rows identical | — | MATCH | same |
| Calibration v1 selection | single-frame 0.9, persistence 0.6 | identical from 660 raw v1 records | — | MATCH | same |
| Phase A: plant detected ≥ 0.5 | 23/24 | 23/24 (mean best 0.85) | — | MATCH | `docs/feasibility/report-webgl-full.json`; `<audit>/a8_feasibility.py` |
| Phase A: print / display maximum | 0.86 / 0.80 | 0.856 / 0.801 | — | MATCH | same |
| Phase A: plant relief ≤ 2 m / 3 m / 4.2 m | 0.12–0.19 / 0.14–0.16 / 0.10–0.14 m | 121–192 / 136–163 / 98–144 mm | — | MATCH | same |
| Phase A: picture relief ≤ 2 m / 3 m | ≤ 0.005 / ≤ 0.012 m | ≤ 4.2 / ≤ 11.7 mm | — | MATCH | same |
| Depth vs ray-cast | median 0.08 mm, 2,436 px | median 0.076 mm, 2,436 px; fridge 95.8 % within 1 cm (glass), all other assets 100 % | — | MATCH | `docs/feasibility/report-wasm-depthval.json` |
| Latency, WASM / WebGL | 140 / 784 ms median | 140 / 784 ms | — | MATCH | feasibility JSON |
| Latency, CPU | 3,236 ms | 3,236 ms, but only in a session-local report | — | NOT VERIFIED from the repository | scratchpad `feas-cpu/report.json` |
| "bench" false label | up to 0.73 | 0.725 in the plant run; **0.840** in the full run | — | MINOR MISMATCH (J-12) | feasibility JSON |
| Two planes explain ≤ 64 % (plant, ≤ 2 m) | ≤ 64 % | no such field in the committed feasibility JSON; held-out mission frames give a maximum of 0.617 (n = 295) | — | NOT VERIFIED directly; consistent | `<audit>/a8_feasibility.py` |
| Prints/displays ≤ 0.77; plant 0.90–0.99 | README.md:66, method page:264 | prints up to **0.949**, screens up to **0.977** (held-out) / **0.992** (v1); target track minimum 0.535 | per-frame / per-track maxima | **CONTRADICTED** as a general statement (J-2) | `<audit>/a7b_bymethod.py` |
| Photo board scores 0.96–0.99 | README.md:70, method page:266 | board track maximum ranges 0.423–0.987 (median 0.886); 23 % of frames ≥ 0.9 | — | **SELECTIVE** (J-2) | `<audit>/a5_claims.py` |

**Paired view (my addition; descriptive only, no new claims).** I ran exact McNemar tests over
the same scenario/seed pairs.
- **SureStop vs single-frame, completion:**
  - all 7 scenarios: 19 discordant pairs, all favouring SureStop, p ≈ 4e-6
  - original 6: 3 discordant pairs, p = 0.25, i.e. not distinguishable
- **False arrivals, all 7:** 16 discordant pairs, all from `photo-board-decoy`.

Seeds within a scenario share the layout, so these tests assume more independence than exists.

---

## D. Ground-truth isolation

| Check | Method | Result |
|---|---|---|
| Transitive runtime imports of the robot side | esbuild metafile bundles of `mission/runner.ts`, `mission/browserSensor.ts`, `policies/*`, `verify/surestop.ts`, `verify/planner.ts` | The runner pulls 8 inputs: mission, nav, policies, verify. The sensor pulls 4: rng, browserSensor, depthFeatures, sensorRenderer. **None** reaches `scenarios/`, `eval/`, `sim/assets`, `sim/world`, `experiments/`, `console/` or `lab/`. PASS |
| What the runner receives | `src/experiments/engine.ts:102` | `MissionRunner(config, world.grid, ROUTE, inst.start, sensor)`: an occupancy grid, the fixed route, the start pose and the sensor. No object list. PASS |
| Sensor reads only pixels and depth | `src/mission/browserSensor.ts` and `src/sim/sensorRenderer.ts` read in full | Renders RGB and depth at the robot pose and runs COCO-SSD on the `ImageData`. The depth pass inspects materials only to drop see-through glass. No names, ids or `userData` are read. PASS |
| Overlays kept out of sensor renders | `SceneView.ts:19` puts every overlay (robot body, FOV wedge, trail, candidate markers, ground-truth rings) on layer 1; the robot camera is layer 0 only (`sensorRenderer.ts:20`); three r186 tests `object.layers.test(camera.layers)` in both the main pass and `WebGLShadowMap.js:522` | PASS by inspection. Not tested empirically with a pixel diff |
| Ground-truth overlay in the console | `controller.ts:256` | Enabled only when `phase === "done"`. PASS |
| Ground-truth importers | grep of `@/scenarios` and `@/eval` | Only: world builder, engine, evaluator, UI pages (scenario titles and metric definitions), snapshot diagnostics. PASS |
| Fake sensors | grep of `implements Sensor` | `FakeSensor` exists only in `tests/unit/mission.test.ts`. PASS |
| Independent relabel | nearest-object rule rebuilt from `layout.ts` | 100 % agreement with the recorded `trackLabels` (a stricter "nearest of any kind" rule also agreed). PASS |
| **Map prior** | `src/sim/world.ts:127-136` | The occupancy grid includes the footprints of every non-poster object: the target plant, the photo board, the screen and the vase. It is label-free, but it is a perfect, current map that contains the candidates themselves. The route's scan headings were authored knowing the object slots (`layout.ts:53`). **This idealisation is not stated** (J-14) |

---

## E. Experimental validity

**Seeds.**
- Calibration seeds are 101–110 and evaluation seeds 1001–1020: disjoint.
- Scenario randomness comes from `mulberry32(deriveSeed(seed, scenarioId))`.
- I checked every surviving session batch file and the repository scripts and tests:
  - Development and e2e runs used seeds 1, 2, 3 and 5.
  - Calibration used seeds 101–110.
  - Seeds 1001–1020 appear only in the evaluation batch: `evalb.json` 16:40, `evala.json`
    16:47, merged `generatedAt 16:48:12Z`.
- Files that no longer exist cannot be checked.

**Chronology** (commit times and record timestamps, all 2026-10-19 UTC):
1. Calibration v1 was run on the `2c5200c` build (15:06). Its records carry that build's
   SureStop config: `confirmRange` 2.2, rings 1.6/2.0 m, no `requiredMisses`.
2. The v1 results were inspected.
3. `7c1f2a4` (15:18) changed SureStop:
   - planner rings 1.6/2.0 → 1.9/2.2 m
   - `confirmRange` 2.2 → 2.5 m
   - a new "not reproducible" REJECTED rule
   - the post-hoc `photo-board-decoy` scenario
4. Calibration v2 was then run (770 records).
5. `e37e6d7` (15:51) set τ = 0.9 / 0.8.
6. The held-out evaluation ran next (16:48Z).
7. `27c50ad` (17:01) followed.

**Code identity.**
- `git diff e37e6d7 27c50ad -- src/verify src/sensing src/policies src/mission src/perception
  src/nav src/sim` is **empty**, so the robot logic at HEAD equals the logic at the threshold
  commit.
- The method page discloses all of the post-v1 changes (`src/app/method/page.tsx:248-270`, `#changes`).

**Baseline stability across builds.** On the six original scenarios, all 540 single-frame and
persistence calibration runs are identical between v1 and v2: same outcome, frame count and
path. The SureStop changes did not touch the baselines.

**Effect of the post-hoc scenario on the baselines.** Adding `photo-board-decoy` alone moved the
persistence selection from τ = 0.6 (v1) to τ = 0.8 (v2). The single-frame selection stayed at
0.9. Not disclosed explicitly (J-7).

**Selection rule.**
- `scripts/aggregate.ts:17` implements "best completion, then lower FAR, then lower τ".
  Recomputed from the raw records, it gives the published selection.
- Robustness check (report only, no reselection): "minimum FAR, then maximum completion" and
  "maximum CCR − FAR" both select the same τ (0.9 / 0.8).
- The rule's **text** said "over all six scenarios" when applied to seven at `e37e6d7`. It was
  corrected after evaluation in `27c50ad`, together with a regenerated `calibration.json`; only
  `generatedAt` and `rule` changed (J-7).

**Asymmetric tuning effort.** SureStop's planner and verifier were revised after inspecting v1
outcomes on the calibration seeds. The baselines received only a τ sweep. This is disclosed
("SureStop was debugged on the calibration seeds"). However, `docs/RESULTS.md:7` and the
`protocol.thresholds` field say "SureStop thresholds fixed from Phase A renders". That is true
only of the evidence gates (60 / 25 mm, 30 mm noise, score 0.4), not of `confirmRange` or the
planner (J-6).

**Where the effect comes from (J-1).**
- **Original six scenarios:** the tuned single-frame baseline has the same false-arrival rate as
  SureStop (0/65). SureStop's only measurable gains there are 3 occluded-target completions
  (p = 0.25), at about 39 % more path.
- **All seven:** the entire FAR gap comes from the post-hoc photo-board scenario.
- This is disclosed in the README, the Method page and the Lab.

**Fair comparison: the persistence baseline (J-5).**
- How it works:
  - It engages every track at the 0.3 detection floor.
  - It steps 0.5 m toward the track per frame.
  - It rejects permanently after 3 consecutive sub-τ frames.
- Close views raise the decoy scores: prints reach 0.949 and screens 0.977 in persistence frames,
  against ≤ 0.78 and ≤ 0.44 on route views. Persistence therefore arrives at decoys that
  single-frame never commits to.
- It also rejects 24 of 99 real targets.
- So it is weaker than single-frame on every scenario except the photo board. "May be weaker" is
  disclosed; the mechanism is not.

**Sample size.** There are 20 seeds per cell. All decoys and scenarios were designed by the
developer in one layout. Intervals are wide: the SureStop FAR upper bound is 4.3 % on all 7 and
5.6 % on the original 6.

---

## F. Technical verification

**Verifier rules vs documentation.** `src/verify/surestop.ts` (`tally` / `evaluate`) and
`src/verify/evidence.ts` (`assessView`) implement exactly what `/method` and the README state:
- CONFIRMED needs ≥ 2 VOLUMETRIC cells, 0 FLAT, and support within 2.5 m.
- REJECTED needs ≥ 2 FLAT cells and 0 VOLUMETRIC, or ≥ 3 miss cells and 0 support.
- UNCONFIRMED comes from the viewpoint budget (4), no viewpoint, or the mission budget.
- Each viewpoint cell (0.75 m × 30°) gets one vote; a vote can be replaced only by a conclusive
  or lower-noise one.
- Decisions are final.
- The 1-view ablation sets `requiredSupport` and `requiredAgainst` to 1 (`runner.ts:50`).
- Recorded configs equal the code defaults: one config per method across all 560 runs.

**Terminology.** No SPRT, likelihood, calibration, information-gain or guarantee claims are made.
The code and the Method page explicitly disclaim them. "Independent evaluator"
(`README.md:13`, `src/app/page.tsx:29`) means a separate module, not an independent party
(J-13).

**Perception.**
- Real COCO-SSD 2.2.3 `lite_mobilenet_v2` runs on rendered pixels with self-hosted weights. All
  560 records report the WASM backend.
- WASM and WebGL scores agree in the feasibility runs (0.32320 vs 0.32320 on the same frame).

**Sensor.**
- Depth noise σ(z) = 2 mm + 0.004·z².
- Depth is validated against ray casting.
- Back-projection puts the candidate at the box-centre ray, at the box's near depth
  (`nearDepth`).

**Measured relief on held-out frames at conclusive range:**

| Object | Excess relief |
|---|---|
| target | 120–190 mm |
| print | ≤ 7 mm |
| screen | ≤ 4 mm |
| board | 0 mm |
| vase | 51–132 mm |

So the volumetric vase is not rejected by depth. It ended UNCONFIRMED (18/18) because it was
not re-detected consistently, as documented.

**Integrity of the records:**
- 560 unique, complete records.
- One detector/backend.
- Shared mission parameters are identical across methods.
- `eval-summary.json` agrees with the full records: 0 score mismatches.
- Six runs have one sampled margin violation each. Their closest wall approach is ≥ 0.33 m.
  Contact with furniture cannot be checked, because object geometry is not in the records (J-15).

**Landing frames.** The `public/media` frames match the recorded run photo-board/1001/surestop:
- frame 2: C1, 0.9672, relief 0, FLAT
- frame 28: C2, 0.9842, 164 mm, VOLUMETRIC

**Determinism.** I re-ran 16 held-out missions (`photo-board-decoy` and `poster-decoy`, seeds 1001–1002, all 4 methods) from the clean clone's production build, with real rendering and real COCO-SSD inference (WASM). Every mission matched its committed record exactly: same outcome, reason and confirmed track; same frame count; identical poses and per-frame targets; max |Δscore|, |Δrelief| = 0; evaluator scores identical; 0 console errors (`<audit>/rerun.json`, `<audit>/a10_rerun_compare.py`). This shows determinism on this software stack (Chromium headless with SwiftShader and TF.js WASM). Other hardware or browsers were not tested.

---

## G. Tests actually executed

Unless noted, every command ran in a fresh `git clone` of the local repository checked out at
`27c50ad`, in `<audit>/clone/`, not in the working tree. Logs are in `<audit>/logs/`.

| Command | Executed | Exit | Evidence | Status |
|---|---|---|---|---|
| `git clone … && git checkout 27c50ad`; `git status --porcelain` | yes | 0 | clean clone, 0 changes | PASS |
| `npm ci --no-audit --no-fund` | yes | 0 | `npm-ci.log`: "added 418 packages in 32s"; one deprecation warning (eslint 9.39.5) | PASS |
| `npm run lint` (`eslint .`) | yes | 0 | `lint.log`, no findings | PASS |
| `npm run typecheck` (`tsc --noEmit`) | yes | 0 | `typecheck.log` | PASS |
| `npm test` (`vitest run`) | yes | 0 | `test.log`: 6 files, **67/67** passed | PASS |
| `npm run build` (`next build`, Next 16.3.8 Turbopack) | yes | 0 | `build.log`: 8 static routes, including `/diagnostics/mission` and `/diagnostics/perception` | PASS (see J-11) |
| `E2E_PORT=3300 npx playwright test` (production `next start`) | yes | 0 | `e2e.log`: **11/11 passed** in 2.7 min (real mission end to end, reduced motion, Lab export and inspect, live Lab batch, ENTER SYSTEM by mouse and keyboard, `/console` `/lab` `/method` direct and refresh, no overflow at 1024 and 390 px) | PASS |
| Real-inference smoke test: `node scripts/missions.mjs http://localhost:3300 "run=1&scenarios=photo-board-decoy,poster-decoy&seeds=1001,1002&methods=single-frame,persistence,surestop,surestop-1view"` | yes | 0 | `rerun.log`, `<audit>/rerun.json`, `a10_rerun_compare.py` | PASS: 16/16 identical to the committed records (Δ = 0); 133 s; 0 console errors |
| Asset serving (`curl -D -` on `next start`) | yes | — | `.wasm` → `application/wasm`; `model.json` → `application/json`; `.glb` → `model/gltf-binary`; unknown route → 404 HTML; `/assets/models/SheenWoodLeatherSofa.glb` → **404** (referenced in `src/sim/assets.ts:73`, not shipped) | PASS (see J-10) |
| Error states: WebGL disabled (`--disable-webgl --disable-3d-apis`) | yes | — | `/console` shows an alert box: "Unsupported browser. This browser does not provide WebGL2…". Phase is UNSUPPORTED and **Run mission** is disabled (`<audit>/a9b_modelblock.mjs`, `states/state-nowebgl-2.png`). The first probe in `a9_states.mjs` mis-targeted Next.js's empty route-announcer `role=alert`; the result was confirmed by a filtered locator and a screenshot | PASS |
| Error states: `/models/**` blocked | yes | — | With every `/models/**` request aborted, the console shows "Something failed: Failed to fetch" after about 1 s. Phase is ERROR and Run is disabled; no fake output is shown. The box's advice ("Try a current desktop Chrome…") is generic for a network failure (cosmetic) | PASS |
| Error states: `eval-summary.json` returns 404 in the Lab | yes | — | The Lab shows "Recorded dataset could not be loaded (Error: HTTP 404)." | PASS |
| Unknown route / deep link | yes | — | `/no-such-page` → HTTP 404, "404: This page could not be found."; the deep link `/console?scenario=photo-board-decoy&seed=1001&method=surestop` → 200. Direct load and refresh of `/console`, `/lab` and `/method` are covered by the e2e tests | PASS |
| CSV/JSON export integrity vs records | yes | — | The Lab's recorded set was exported as `surestop-trials-recorded-all.csv` and `surestop-runs-recorded-all.json`. CSV: 560 unique rows, 8,400 field checks (outcome, flags, frames, path, sim time, candidate labels) against `eval-runs.json`, **0 mismatches**. JSON: schema `surestop.experiment/1`, 560 runs, 0 score/outcome mismatches (`<audit>/a11_export.py`) | PASS |
| First-load transfer (decoded bytes, cold context) | yes | — | Decoded bytes until network idle: `/` 1.48 MB (JS 1.23 MB); `/method` 1.49 MB; `/lab` 2.12 MB (including the 0.66 MB summary; the 10.9 MB full runs are fetched only on Inspect); `/console` **41.3 MB** (17 MB weights, about 20 MB of GLB assets, a 1.12 MB 3-D chunk, WASM) | MEASURED (no budget defined) |
| `npm audit` / `npm audit --omit=dev` (working tree, same lockfile) | yes | 1 / 0 | 5 high, dev-only (`braces` ← micromatch ← fast-glob ← `@next/eslint-plugin-next` ← `eslint-config-next`; the only fix is a breaking downgrade); **0** in production dependencies | PASS for production; dev-only risk noted |
| Secrets / local-path grep over tracked files | yes | — | no tokens or keys; one absolute session path in `scripts/dev/diag-console.mjs:14` | PASS with a LOW finding (J-11) |
| Visual review at 1440 / 1024 / 390 px | no (this audit) | — | only the e2e overflow checks were executed | NOT VERIFIED in this audit |
| Hardware-GPU WebGL backend | no | — | no GPU in the container | BLOCKED (environment) |
| Deployed URL smoke test | no | — | no deployment exists; no Vercel credentials | BLOCKED |

---

## H. Licensing, security and documentation

**Project licence.** No `LICENSE` file exists. This is the owner's decision, and the audit has
not chosen one. Without it, others have no right to reuse the code.

**Redistributed third-party files:**
- **COCO-SSD weights** (`public/models/coco-ssd/…`) and **TF.js WASM binaries**
  (`public/tfjs-wasm/*.wasm`) are Apache-2.0. Section 4(a) requires giving recipients a copy of
  the licence, but no Apache-2.0 text is shipped (J-10).
- **Geist fonts** (SIL OFL 1.1) are bundled into the build by `next/font`. The README says the
  details are in `THIRD_PARTY_NOTICES.md`, but that file does not mention the fonts.
- **GLB assets:** the six shipped GLBs carry CC0 / CC-BY attributions in `THIRD_PARTY_NOTICES.md`
  that match `src/sim/assets.ts`.
- **Assets not in the repository:** `src/sim/assets.ts` also lists `SheenWoodLeatherSofa`,
  `CommercialRefrigerator`, `WaterBottle` and `DiffuseTransmissionTeacup`, which are not in the
  repository. The Phase A sofa/fridge rows and the depth validation (fridge) therefore cannot be
  re-run from the repository.

**Security:**
- The app is static and client-only: no API routes, secrets or environment variables are needed.
- No credentials were found in tracked files.
- One session-local absolute path is committed in a dev script.
- Production dependencies have 0 known vulnerabilities.
- The diagnostic harness routes ship in production (J-11).

**Documentation accuracy.**
- **Score claims** (J-2): `README.md:66`, `:70`; `src/app/method/page.tsx:264-266`.
- **Protocol string** (J-6): `docs/RESULTS.md:7`; `public/data/eval-runs.json`
  `protocol.thresholds`.
- **Reproduction commands** (J-9):
  - `README.md:125` lists six calibration scenarios, so as written it reproduces v1, not the v2
    calibration actually used.
  - `README.md:128` and `src/app/method/page.tsx:328` use `…` placeholders.
- **Accurate:** `BUILD_STATUS.md` and the README's results tables (all numbers MATCH).

---

## I. Deployment readiness

**Status:** NOT DEPLOYED. No public URL exists, and none is claimed. Vercel account limits,
build minutes and asset-size rules could not be checked from this environment: there are no
Vercel credentials, and none were requested. **NOT VERIFIED.**

**Locally verified prerequisites:**
- `next build` produces only static routes.
- `next start` serves `.wasm` as `application/wasm`.
- The weights and assets load from `public/`.
- No server code and no environment variables are required.
- The largest single static files are:

| File | Size |
|---|---|
| `public/data/eval-runs.json` | 10.9 MB |
| `public/assets/models/DiffuseTransmissionPlant.glb` | 5.8 MB |
| weight shards | about 4 MB each |

**Manual steps for the owner** (to be done by a person with access; none of these were performed
in this audit):
1. Decide whether `feature/surestop-prototype` should be merged into `main`, or deployed from the
   branch. Vercel can deploy any branch.
2. On vercel.com: **Add New → Project**, import `adithyad-cs/surestop-robot-verification`.
   - Framework: Next.js; build command `next build`; Node 20 or later.
   - `.npmrc` already sets `legacy-peer-deps=true`.
   - Choose the production branch.
3. Deploy, then on the deployment URL:
   - Open `/`, `/console`, `/lab` and `/method` directly and after a refresh.
   - Run one Mission Control mission. Confirm the detector line shows a loaded backend and that
     the mission reaches a decision.
   - In the Lab, export CSV and JSON. Confirm the trial count (560 recorded).
4. In the browser dev tools, check that `/tfjs-wasm/*.wasm` is served as `application/wasm` and
   that `/models/coco-ssd/...` shards return 200.
5. Optionally, run the e2e suite against the deployment:
   `E2E_BASE_URL=https://<deployment> npx playwright test`.
6. Record the URL and the verification date in `BUILD_STATUS.md`. Until then, keep the "no
   deployment" statement.

---

## J. Prioritised findings

Severity is about the validity of the submission, not code quality. **None of these blocks the
merge on technical grounds.** "Blocks submission" means it should be corrected or disclosed
before external submission or judging.

**J-1 · MEDIUM · The headline FAR gap depends on one post-hoc scenario.**
- **Where:** `README.md:57-71`, `docs/RESULTS.md`, Lab reading notes.
- **Evidence:**
  - Original 6: single-frame 0/65 vs SureStop 0/65 FAR; completion 117/120 vs 120/120 (exact
    McNemar p = 0.25).
  - All 16 single-frame false arrivals come from `photo-board-decoy`, which was designed after
    calibration v1 showed the score gap.
- **Why it matters:** any summary saying SureStop "eliminates false arrivals compared with a
  tuned baseline" is driven by how the scenarios were built, not by an observed general
  advantage.
- **Correction:** keep reporting both tables, and present the photo board as a stress test of
  the mechanism. Do not use the 19 % vs 0 % figure as a standalone headline.
- **Blocks submission:** no, if the current framing is kept (it is disclosed). Treat as disclose
  as limitation.

**J-2 · MEDIUM · Decoy and target score claims are contradicted by the raw records.**
- **Where:** `README.md:66` ("≤ 0.77 against 0.90–0.99"), `README.md:70` (board "0.96–0.99"),
  `src/app/method/page.tsx:264-266`.
- **Evidence, held-out per-frame maxima:**

| Object | Route views (search/scan) | Persistence approach | SureStop verify views |
|---|---|---|---|
| print | 0.777 | 0.949 | 0.892 |
| screen | 0.439 | 0.977 | — |

- **More evidence:**
  - In calibration v1: print 0.949, screen 0.992 (persistence frames).
  - Target track maxScore: minimum 0.535 overall; in single-frame runs 0.799, with 3 of 104
    below 0.9.
  - Board track maxScore: 0.423–0.987, median 0.886; 23 % of board frames ≥ 0.9.
- **Why it matters:** the claim attributes the threshold's success to intrinsically weak decoys.
  The data shows the separation depends on viewpoint: the fixed route keeps decoys far away, and
  closer views score as high as the plant.
- **Correction:** state the route-view maxima and add that closer views reach 0.95–0.99.
  Describe the board as "up to 0.99".
- **Blocks submission:** yes (documentation only).

**J-3 · MEDIUM · Raw calibration records are not in the repository.**
- **Evidence:**
  - Only the summaries `public/data/calibration.json` and
    `docs/experiments/calibration-v1-summary.json` are committed.
  - The raw 770 v2 and 660 v1 records exist only in the session scratchpad (`calib2.json`
    sha256 `35480389…`, `calib-v1.json` `1708ccd1…`), which is ephemeral.
- **Why it matters:** the threshold selection cannot be audited by anyone else.
- **Correction:** commit the raw records (about 12 MB and 11 MB), or attach them as a release
  artefact with checksums.
- **Blocks submission:** yes (reproducibility).

**J-4 · MEDIUM · Records have no code provenance.**
- **Evidence:** `eval-runs.json` embeds the config, detector and backend, but no commit SHA or
  build ID. Traceability depends on timestamps (16:48Z, between `e37e6d7` and `27c50ad`) and on
  the robot code being unchanged between those commits.
- **Why it matters:** a dirty working tree at run time cannot be excluded from the records alone.
  Mitigation: the 16-mission re-run at HEAD reproduced the recorded runs bit for bit, so the records are consistent with HEAD's robot code. That holds for these 16 runs only, not all 560.
- **Correction:** state in `docs/RESULTS.md` that the records were produced with robot code equal
  to `e37e6d7`. Embed `git rev-parse HEAD` in future batches.
- **Blocks submission:** no; disclose.

**J-5 · MEDIUM (interpretation) · The persistence baseline is a weak design.**
- **Where:** `src/policies/baselines.ts:107-186` (PersistencePolicy), `src/mission/runner.ts:424-470` (`decide` / `act`: every PENDING track at the 0.3 floor is engaged).
- **Evidence:**
  - It approaches every candidate ≥ 0.3, and close views inflate decoy scores.
  - It permanently rejects 24/99 real targets after 3 consecutive misses.
  - Completion is 83/140, below single-frame on 6 of 7 scenarios.
- **Why it matters:** comparisons against "persistence" do not represent persistence methods in
  general.
- **Correction:** disclose the mechanism; do not cite persistence numbers as evidence for
  SureStop.
- **Blocks submission:** no; disclose as limitation.

**J-6 · LOW-MEDIUM · The protocol text overstates how fixed SureStop was.**
- **Where:** `docs/RESULTS.md:7`; `public/data/eval-runs.json` `protocol.thresholds`.
- **Evidence:** `confirmRange`, the planner rings and the "not reproducible" rule were changed
  after calibration v1 (`7c1f2a4`). Only the evidence gates came from Phase A.
- **Correction:** the protocol text should name these changes. The Method page `#changes` section
  already does.
- **Blocks submission:** yes (small text fix; regenerate the report from the records without
  re-running).

**J-7 · LOW · Selection-rule text and the effect of the post-hoc scenario on persistence.**
- **Evidence:**
  - At `e37e6d7` the rule text said "all six scenarios" while seven were used.
  - The text was fixed after evaluation; selection values were unchanged.
  - Adding the photo board changed persistence τ from 0.6 to 0.8. The six-scenario baseline runs
    are identical between v1 and v2.
- **Correction:** add one sentence to the Method page.
- **Blocks submission:** no; disclose.

**J-8 · INFO · The selection objective is robust.**
- Completion-only selection treats a false arrival and a miss as equal cost.
- The alternatives tested ("minimum FAR, then completion"; "CCR − FAR") pick the same τ.
- No action needed.

**J-9 · LOW · The reproduction commands are not runnable as written.**
- **Where:** `README.md:125` (missing `photo-board-decoy`), `README.md:128` and
  `src/app/method/page.tsx:328` (`…` placeholders).
- **Correction:** write out the exact v2 calibration and evaluation commands, including the two
  parallel processes and `scripts/merge-batches.mjs` if those were used.
- **Blocks submission:** yes (reproducibility).

**J-10 · LOW · Licensing gaps.**
- No project licence (owner's decision).
- No Apache-2.0 text for the redistributed weights and WASM.
- OFL fonts are not listed in the notices.
- Four asset entries reference GLBs that are not shipped (`src/sim/assets.ts:73,93,103,113`).
- **Correction:** add `LICENSES/Apache-2.0.txt` and a fonts entry. Either remove the unused asset
  entries or note them as not redistributed.
- **Blocks submission:** yes for public release (licence text); the project licence is the
  owner's call.

**J-11 · LOW · Diagnostics in production; a local path is committed.**
- `/diagnostics/mission` and `/diagnostics/perception` are public routes. The perception harness
  references assets that are not shipped.
- `scripts/dev/diag-console.mjs:14` contains a session-local absolute path.
- **Correction:** gate or document the routes; replace the path with an argument.
- **Blocks submission:** no.

**J-12 · LOW · Minor Phase A report slips.**
- "bench up to 0.73": the full run recorded 0.840.
- The two-plane "≤ 64 %" figure has no committed raw data. It is consistent with the mission
  frames (≤ 0.617).
- The CPU latency source is not committed.
- **Correction:** amend `PERCEPTION_FEASIBILITY.md`.
- **Blocks submission:** no.

**J-13 · LOW · Wording: "independent evaluator".**
- It is a separate module written by the same developer.
- **Correction:** use "separate evaluator module".
- **Blocks submission:** no.

**J-14 · LOW · Idealised map prior is not stated.**
- **Where:** `src/sim/world.ts:127-136`, `src/scenarios/layout.ts:53`.
- The occupancy map contains the candidates' footprints, and the route was authored with
  knowledge of the object slots.
- **Correction:** add this to the Method page limitations.
- **Blocks submission:** no; disclose.

**J-15 · LOW · Clearance is only partly verifiable.**
- Six runs have one margin-violation sample each; the minimum wall clearance is 0.33 m. Object
  contact is not checkable.
- **Correction:** log the minimum obstacle clearance per run in future.
- **Blocks submission:** no.

**J-16 · INFO · Abstention never occurred on held-out seeds** (0/139 for every method). It is
disclosed. Calibration v1 had 3 UNRESOLVED SureStop missions; v2 had none. The mission-level
abstention path is therefore untested on held-out data.

**J-17 · INFO · Dev-only vulnerabilities.** `npm audit` reports 5 high-severity issues in the
ESLint chain. Production dependencies have none.

No **serious integrity, data-leakage, reproducibility or evaluation defect** was found that would
have required stopping the audit.

---

## K. Final decision

**Must fix before merge:** none on technical grounds. The merge is the owner's decision; this
audit did not merge or change `main`.

**Must fix before submission** (documentation and artefacts only; no re-tuning and no new runs):
1. Correct the score claims (J-2) in `README.md:66,70` and `src/app/method/page.tsx:264-266`.
2. Commit or attach the raw calibration records with checksums (J-3).
3. Fix the protocol text that says "SureStop thresholds fixed from Phase A renders" (J-6).
4. Make the reproduction commands exact and runnable (J-9).
5. Ship the Apache-2.0 licence text and the font notice; tidy the asset list (J-10). Choosing a
   project licence is the owner's decision.
6. Deploy and smoke-test following section I, or keep stating that there is no deployment.

**Disclose as limitations:**
- The FAR gap is entirely from the post-hoc photo-board scenario; on the original six the tuned
  threshold matches SureStop (J-1).
- The persistence baseline's design weaknesses (J-5).
- Asymmetric development effort, and the post-hoc scenario changing persistence τ (J-6, J-7).
- No code SHA in the records (J-4).
- An idealised map that contains the candidates, and a route written with knowledge of the slots
  (J-14).
- Mission-level abstention is untested on held-out data (J-16).
- WASM-only experiments; no GPU timings.
- 20 seeds per cell; one layout; designer-made decoys.

**Future research** (no novelty claims follow from simulation alone):
- Fresh scenarios and decoys designed by someone other than the developer, chosen before any
  run.
- More seeds and layouts.
- A stronger persistence baseline (re-approach after rejection; engage only when score ≥ τ).
- A baseline that combines a score threshold with a depth-flatness check.
- Consistently detected 3-D look-alikes.
- Real RGB-D data, correlated depth noise, imperfect maps and odometry.
- Calibrated evidence models, if probabilities are to be claimed.

---

## L. Remediation log (2026-10-20, after the audit)

This section records what was changed in response to the findings above. It does not change the
original verdict.

Throughout:
- No threshold, verifier or planner rule, baseline, scenario, asset used by the recorded runs,
  or evaluation logic was changed.
- No experiment was re-run to change a result.
- `public/data/eval-runs.json`, `eval-summary.json` and `calibration.json` are byte-identical to
  their audited versions (SHA-256 re-checked).

| Finding | Status | What changed (paths) | Evidence |
|---|---|---|---|
| J-3 raw calibration records | **Fixed** | `docs/experiments/raw/calib-v1.json.gz`, `calib2.json.gz`, batch logs, `MANIFEST.md` (commit `0bc3840`) | Each file was decompressed and compared with `cmp` against the scratchpad original: byte-identical. Original SHA-256 `1708ccd1…` (660 runs) and `35480389…` (770 runs) |
| J-2 score claims | **Fixed** | `README.md` results notes; `src/app/method/page.tsx` (#changes); `PERCEPTION_FEASIBILITY.md` | Wording now separates route views (prints ≤ 0.78, displays ≤ 0.44) from close views (prints 0.95, displays 0.98 / 0.99 in v1). Per-encounter maxima are used for the plant (0.80–0.99, median 0.98) and the board (single-frame 0.87–0.99, median 0.97). The board's 9-view probe report is now committed (`docs/feasibility/report-wasm-board.json`) |
| J-6 protocol text | **Fixed (corrected next to the record)** | `src/eval/protocolNotes.ts`; `scripts/aggregate.ts`; regenerated `docs/RESULTS.md`; Lab provenance panel | The recorded string in `eval-runs.json` is kept unchanged. Readers now see a dated correction next to it |
| J-1, J-5, J-7, J-14, J-16 disclosures | **Fixed** | `docs/RESULTS.md` "Notes and disclosures" (generated from `RESULT_NOTES`); README caveats; Method limitations | Post-hoc scenario, persistence τ 0.6 → 0.8, weak persistence mechanism, idealised map and route, abstention not validated |
| J-4 code provenance | **Disclosed** | `docs/experiments/raw/MANIFEST.md` (inferred provenance, marked as such) | Records still carry no SHA; nothing was invented |
| J-9 reproduction commands | **Fixed and re-run (reduced seeds)** | `README.md` "Reproduce experiments"; `package.json` `build:diagnostics`; new `scripts/compare-runs.mjs` | The documented commands were run verbatim from a clean copy, with seeds reduced to 101 and 1001. **77/77 calibration and 28/28 evaluation runs matched** the preserved and committed records, apart from wall-clock timing fields. This is repeatability on the same software stack only |
| J-10 licences | **Fixed (project licence open)** | `LICENSES/Apache-2.0.txt` (canonical, SHA-256 `cfc7749b…`, identical to tfjs `LICENSE`), `LICENSES/OFL-1.1-Geist.txt`, `LICENSES/MIT-bundled-libraries.txt`; `THIRD_PARTY_NOTICES.md`; README | Project licence: **still not chosen; owner decision** |
| J-10 unshipped assets | **Fixed** | `src/sim/assets.ts`: the 4 unshipped entries are removed, with a note; `src/diagnostics/feasibility.ts` rejects unknown ids | None of the 4 was used by any scenario (checked in `layout.ts` and `world.ts`) |
| J-11 diagnostics in production | **Fixed** | `src/app/diagnostics/layout.tsx`: `/diagnostics/*` returns 404 unless built with `SURESTOP_DIAGNOSTICS=1`; harness scripts fail fast with instructions | Default `next build` + `next start`: `/diagnostics/mission` and `/diagnostics/perception` → 404; `/`, `/console`, `/lab`, `/method` → 200 |
| J-11 local path | **Fixed** | `scripts/dev/diag-console.mjs` takes the base URL and output path as arguments | `grep -rn "/tmp\|/home" scripts` returns nothing |
| J-12 Phase A slips | **Fixed** | `PERCEPTION_FEASIBILITY.md`; `docs/feasibility/report-cpu.json` committed unmodified (SHA-256 `e5b635c1…`) | "bench" maximum corrected to 0.84 (0.73 in the plant run). The unsupported "≤ 64 %" is replaced by the held-out figure (≤ 0.62, n = 295, from committed records) |
| J-13 wording | **Fixed** | `README.md`, `src/app/page.tsx`, `src/eval/evaluate.ts` comment | "Separate evaluator module" |
| J-15, J-17 | Unchanged (informational) | — | — |

**Still open:**
- the project licence
- deployment
- a commit SHA in future records
- the strength of the persistence baseline (would need new experiments, labelled exploratory)

### L.2 Checks after the UI redesign (design changes, separate from remediation)

The redesign touched only UI files:
- `src/app/*`, `src/console/*`, `src/lab/*` and `src/components/*`
- `src/eval/recordedSummary.ts` (build-time, read-only)
- `scripts/poster-data.mjs`

`git diff 27c50ad` shows that, in the pipeline directories (`src/verify`, `src/sensing`,
`src/policies`, `src/mission`, `src/perception`, `src/nav`, `src/scenarios`,
`src/experiments`, `src/sim`, `src/lib`) and the model and asset directories, only
`src/sim/assets.ts` (remediation J-10) changed.

| Check | Result |
|---|---|
| Mission Control on the new build vs the `27c50ad` build, same 4 trials | Results identical apart from wall-clock timing in **4/4** |
| Mission Control replay vs the committed records, same 4 trials | Identical: trajectory, every target-class observation, candidate tracks and evidence, events, outcome, evaluator score. Different: memoisation `cached` flags (run order: the batch harness shares one world across methods) and 2 of 92 detections of non-target classes, in the 4th decimal (e.g. "umbrella" 0.3788 vs 0.3785). The `27c50ad` build shows the same differences, so they predate the redesign. **New observation:** replay through the console is not bit-identical to the batch harness for every detection score. The Method page and README now say so |
| e2e suite on the final build | 11/11 |
| axe-core 4.10.2 on all routes at 1440 and 390 px | 0 violations (initial states) |
| Lab export against the records | 0 mismatches in 8,400 field checks |
