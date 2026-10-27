# Raw calibration records

These files are the original batch outputs of the two calibration runs. They were written by
`scripts/missions.mjs` (calibration v2 also used `scripts/merge-batches.mjs`).

**How they were preserved.** Until 2026-10-20 the files existed only in the build session's
temporary scratchpad. The final audit flagged that (finding J-3). They were then copied here
byte for byte and compressed with `gzip -9 -n`. The `-n` flag stores no file name or timestamp,
so re-compressing gives the same bytes. The JSON inside was not edited.

**Verify a file:**

```bash
gunzip -c docs/experiments/raw/calib2.json.gz | sha256sum   # must equal the "original sha256" below
```

## Files

| File in this folder | Original file | Original bytes | Compressed bytes | Original sha256 | Compressed sha256 |
|---|---|---|---|---|---|
| `calib-v1.json.gz` | `calib-v1.json` | 10,920,055 | 734,866 | `1708ccd1a01a3eae2d32ce073527462e5ff84748d73bf787cfc7a768f4360869` | `706910eef3aa206e0868bcaf40f50f31419b656488766c6b6f7a29bb13a8e0c8` |
| `calib2.json.gz` | `calib2.json` | 12,208,375 | 887,797 | `35480389a3488e99639a5ec18d67551c017e63bbba4cc5d3024417257e15d0a4` | `35c249604e25c50f1adc40d9f198fab32fa55d452170ab56b027983d89fbd753` |
| `calib.log.gz` | `calib.log` (console log of calibration v1) | 101,759 | 5,012 | `2e95ecce3e84f73db05e0a59e9233174b502a071f34300769cb3287d42937298` | — |
| `calib2a.log.gz` | `calib2a.log` (calibration v2, process A) | 67,609 | 3,411 | `55b01eb656281c0d85c43686e09b65e4d7691c6ce5ba8d105319e09d3540a731` | — |
| `calib2b.log.gz` | `calib2b.log` (calibration v2, process B) | 51,473 | 2,702 | `04032189f9cd043a49e907d5fe7e10a5016fa19220d03f9c61989881f5c2c25d` | — |
| `evala.log.gz` | `evala.log` (held-out evaluation, process A) | 48,883 | 2,651 | `84de989eed42290f3f2b95b9b45006633de6102d5ca1dc2f1a4c658902d3672e` | — |
| `evalb.log.gz` | `evalb.log` (held-out evaluation, process B) | 37,001 | 2,186 | `14a7e4c3433a198c8e7fa23dd564b40b574362aae2fcd09c41234abc1d276f71` | — |

Each `.gz` was decompressed and compared with `cmp` against its scratchpad original; every file
was byte-identical.

## Contents

All values below were read from the files themselves.

| | `calib-v1.json` | `calib2.json` |
|---|---|---|
| Format | One JSON object: `runs`, `backend`, `detector`, `wallMs`, `consoleErrors` | Same, plus `parallelProcesses: 2` |
| Run schema | `surestop.mission/1`; each run has `variant`, `result` (full mission record), `score` (evaluator output) | same |
| Runs | 660, all unique by (scenario, seed, variant) | 770, all unique |
| Scenarios | the 6 original scenarios: `clear-target`, `poster-decoy`, `screen-decoy`, `decoys-only`, `occluded-target`, `lookalike-3d` | the same 6 + `photo-board-decoy` |
| Seeds | 101–110 | 101–110 |
| Variants (11) | `single-frame@0.5…0.9`, `persistence@0.5…0.8`, `surestop`, `surestop-1view` | same |
| Detector / backend | COCO-SSD 2.2.3 `lite_mobilenet_v2`, TF.js 4.22.0, WASM | same |
| Console errors | 0 | 0 |
| Wall clock | 38.7 min, 1 process | 31.7 min, 2 processes |
| Summary committed in the repository | `docs/experiments/calibration-v1-summary.json` | `public/data/calibration.json` |

**Check after copying.** `npm run aggregate -- calibration` was not re-run on these files. I
recomputed the selection independently instead:
- `calib2.json` gives single-frame τ = 0.9 and persistence τ = 0.8.
- `calib-v1.json` gives single-frame τ = 0.9 and persistence τ = 0.6.
- All 11 rows of each committed summary match.

See `docs/FINAL_AUDIT_REPORT.md`, section C.

## Provenance

**Established from the records and from Git:**
- `calib-v1.json`:
  - Its SureStop config has `confirmRange: 2.2`, planner rings `[1.6, 2.0]` and no
    `requiredMisses`.
  - Those are the defaults at commit `2c5200c`, and they changed in `7c1f2a4`.
- `calib2.json`:
  - Its SureStop config has `confirmRange: 2.5`, rings `[1.9, 2.2]` and `requiredMisses: 3`.
  - Those are the defaults from `7c1f2a4` onward.
  - The baseline thresholds in its configs are the pre-selection defaults (0.5), which places it
    before `e37e6d7`.
- `calib2.json` is exactly the union of the two process outputs (440 + 330 runs). The audit
  verified this by comparing the sorted runs.
- The 540 single-frame and persistence runs on the six original scenarios are identical between
  v1 and v2 (outcome, frames, path).

**Inferred, not recorded in the files:**
- The records carry **no commit SHA or build id**. The build commits above are inferred from the
  configs, the file timestamps (v1 written 15:12 UTC; v2 written 15:45 and 15:50 UTC, on
  2026-10-19) and the commit times. Do not cite a code SHA as recorded provenance.

**Commands used.** These were recovered from the build session's transcript. Both processes ran
against one `npm run build && npx next start -p 3100` server.

```bash
# calibration v1 (single process)
node scripts/missions.mjs http://localhost:3100 "run=1&scenarios=clear-target,poster-decoy,screen-decoy,decoys-only,occluded-target,lookalike-3d&seeds=101,102,103,104,105,106,107,108,109,110&methods=single-frame@0.5,single-frame@0.6,single-frame@0.7,single-frame@0.8,single-frame@0.9,persistence@0.5,persistence@0.6,persistence@0.7,persistence@0.8,surestop,surestop-1view" calib.json

# calibration v2 (two processes in parallel, then merged)
SEEDS=$(seq -s, 101 110)
V="single-frame@0.5,single-frame@0.6,single-frame@0.7,single-frame@0.8,single-frame@0.9,persistence@0.5,persistence@0.6,persistence@0.7,persistence@0.8,surestop,surestop-1view"
node scripts/missions.mjs http://localhost:3100 "run=1&scenarios=clear-target,poster-decoy,screen-decoy,decoys-only&seeds=$SEEDS&methods=$V" calib2a.json &
node scripts/missions.mjs http://localhost:3100 "run=1&scenarios=occluded-target,photo-board-decoy,lookalike-3d&seeds=$SEEDS&methods=$V" calib2b.json &
wait
node scripts/merge-batches.mjs calib2.json calib2a.json calib2b.json
npm run aggregate -- calibration calib2.json public/data/calibration.json
```

**Not preserved here:**
- The per-process JSON files `calib2a.json` and `calib2b.json`: their runs are entirely contained
  in `calib2.json`.
- The raw held-out evaluation batches `evala.json`, `evalb.json` and `eval.json`: their `runs`
  array is byte-for-byte the `runs` array of the committed `public/data/eval-runs.json`. The
  audit checked this with a JSON string comparison.
