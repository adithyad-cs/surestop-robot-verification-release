# Build status

## Release

**Status:** release candidate for the Hack in Hills ’26 submission. **Not deployed.**

**Source:** a clean snapshot of the final application, development commit
`70ab7dee74921a956c0ee301aebce363df440f23`. That commit includes:

- the identity-conflict check;
- the capture-time pose traceability fix;
- the demo rehearsal.

**What changed for the release:**

- **Development-only material left out.** Phase and stage engineering reports, UI design notes,
  research-protocol preparation tooling and its two test files (26 tests), and ad-hoc debug
  scripts.
- **Documentation updated to match.** `README.md` and this file were rewritten. Release notes were
  added to `docs/LAYOUT_VARIATION.md`, `docs/LOOKALIKE_INVESTIGATION.md`,
  `docs/FINAL_AUDIT_REPORT.md` and `docs/experiments/identity-conflict/REPORT.md`.
- **Two source comments** that pointed at left-out documents were reworded
  (`src/app/globals.css`, `src/provenance/objects.ts`).
- **One whitespace fix:** a trailing blank line removed from `src/sim/textures.ts`, so that
  `git diff --check` passes.
- **No change to application behaviour, verifier rules, thresholds, models, tests or recorded
  data.**

### Checks on the release snapshot

**Where and how:** 2026-10-27, in a fresh clone of the release tree, on Node 22.22.0, npm 10.9.4 and
Linux, without a GPU.

- **Browser:** checks ran in headless Chromium 153 with SwiftShader WebGL; TF.js chose its WASM
  backend.
- **Why not Playwright's own browser:** its pinned build (1.56.1) could not be downloaded in that
  environment. The suite therefore ran through a local, uncommitted config that only adds
  `executablePath` to `playwright.config.ts`.
- **Server:** the production build was served with `next start -p 3200`.

| Command or check | Result |
|---|---|
| `npm ci` | passed: 418 packages, 0 vulnerabilities reported |
| `npm run build` | passed: 7 routes, all static; build provenance `sourceDirty: false` |
| `npx vitest run` | **376/376** passed, 28 files |
| `npm run lint` | passed |
| `npm run typecheck` | passed |
| `git diff --check` over the whole tree | clean |
| Full Playwright suite, `SURESTOP_PERCEPTION=1` | **30/30** passed, 0 skipped, 0 failed (13.6 min). Includes the identity demo tests and the 4 real-perception tests |
| Routes on the production server | `/`, `/console`, `/lab`, `/method` and `/favicon.ico` return 200; `/diagnostics/mission` returns 404 without `SURESTOP_DIAGNOSTICS=1`; unknown routes return 404 |
| Model and asset loading | the COCO-SSD `model.json` and shards, the TF.js WASM binaries, the glTF assets and `public/data` are served; real missions run end to end |
| Demo rehearsal, `node scripts/dev/rehearse-demo.mjs` | all 12 steps identical to `docs/demo/rehearsal/rehearsal.json` |
| `node scripts/dev/demo-url-check.mjs` | identical to `docs/demo/rehearsal/url-typo-check.jsonl` |

The rehearsal covers:

- demo A, including Run again and Reset;
- demo B, including the frame-11 capture pose;
- demo C, switching methods through the dropdown;
- navigation and the Method-page statements;
- a bad layout value and a blocked model download;
- a reload mid-mission.

**What the figures apply to.** These checks ran on the release tree before these results were
written into `README.md` and `BUILD_STATUS.md`. The published commit differs from the validated
tree only in that text.

### Earlier checks (development history, not this snapshot)

These were measured on development builds and are kept for context only.

- **2026-10-27, final development commit (above):**
  - full Playwright suite 30/30, 0 skipped, including the real-perception spec;
  - Vitest 402/402, including the 26 research-tooling tests left out of this release.
- **2026-10-27, Stage 6 rehearsal:** the three demo scenarios were driven through the real UI on a
  production build. Records and screenshots are in [`docs/demo/rehearsal/`](docs/demo/rehearsal/).
- **2026-10-27, demo-world re-check:** the 12 demo-world missions were identical to their matrix
  records (`docs/experiments/identity-conflict/results/demo-check.json.gz`).
- **2026-10-20, original prototype build:** a 4-trial replay check against the records, and a
  reduced-seed reproduction (77 calibration + 28 evaluation runs identical to the records apart
  from timing). Details in [`docs/FINAL_AUDIT_REPORT.md`](docs/FINAL_AUDIT_REPORT.md).

## Implemented

- **Perception:** COCO-SSD 2.2.3 on real Three.js renders, with a pixel-aligned depth pass and a
  noise model. Feasibility: [`PERCEPTION_FEASIBILITY.md`](PERCEPTION_FEASIBILITY.md).
- **Verification:**
  - per-view relief and two-plane evidence;
  - one vote per 0.75 m × 30° viewpoint cell, with a same-pose guard;
  - CONFIRMED, REJECTED and UNCONFIRMED decisions;
  - a bounded re-observation planner (≤ 4 viewpoints).
- **Experimental identity-conflict check** (`surestop-identity`): a co-located "vase" detection
  withholds confirmation. The table has one pair, `potted plant → vase`.
- **Baselines:** single-frame threshold, temporal persistence, one-view ablation.
- **Mission:** seven scenarios; layouts v1 (recorded) and v2 (seeded variation, validated for
  reachability); A* navigation; candidate tracks; an event log; a separate ground-truth evaluator.
- **UI:**
  - `/`: landing evidence poster;
  - `/console`: Mission Control with a frame scrubber, evidence tables, viewpoint roses, identity
    conflicts and capture-time poses;
  - `/lab`: Verification Lab;
  - `/method`: Method page.
- **Experiment tooling:** a batch harness with durable checkpoints and resume; merge, compare and
  recover tools; aggregation.

## Recorded results

- **Held-out evaluation, layout v1:** 560 missions. SureStop 0/85 false arrivals and 140/140
  completions; tuned single-frame 16/85 and 121/140. See [`docs/RESULTS.md`](docs/RESULTS.md).
- **Identity-conflict development matrix, layout v2:** 294 missions.
  - False arrivals: single-frame 13/98, `surestop` 1/98, `surestop-identity` 0/98.
  - Correct arrivals: 45/84, 83/84 and 84/84.
  - One paired world changed, and the difference is not statistically established. See
    [`docs/experiments/identity-conflict/REPORT.md`](docs/experiments/identity-conflict/REPORT.md).

## Known limitations

- Simulation only, with a category-level target. No physical-robot or safety claims.
- The identity rule covers one confusable pair, chosen from the case it fixes.
- One plant asset and one vase asset; development seeds; no demonstrated generalisation.
- Screen and poster decoys are often never detected (5/14 and 11/14 worlds in the matrix).
- The map prior contains the candidates, and the route was written knowing the object slots.
- SureStop was debugged on calibration seeds; the baselines only had a threshold sweep.
- The scientific evaluation gate remains **BLOCKED** (see the README, "Limitations and non-goals").
