# Layout v2 smoke-test data

These are real-render runs on the **seeded v2 layouts**: headless Chromium with SwiftShader WebGL,
TF.js WASM and COCO-SSD 2.2.3 `lite_mobilenet_v2`, via `/diagnostics/mission?...&layout=v2` on
`next dev`.

- **Not part of the recorded protocol.** Calibration and held-out evaluation are v1. These runs
  sit outside `public/data/`.
- **Rejected by the pipeline.** `scripts/merge-batches.mjs` and `scripts/aggregate.ts` refuse
  them, and `scripts/compare-runs.mjs` reports them as a layout mismatch against v1 records.
- **Not an evaluation.** They are a smoke test on a handful of seeds, and no rates or statistical
  claims are drawn from them.

| File | SHA-256 (file as stored) | Contents |
|---|---|---|
| `v2-matrix-a.json.gz` | `26523ecff831efb8dd735439914378e509dba9490358752b562f28ca565da4b2` | 48 runs (2026-10-20): clear-target, poster-decoy, screen-decoy, decoys-only × seeds 0, 1, 2, 17, 42, 123 × SureStop and single-frame |
| `v2-matrix-b.json.gz` | `744a48f3ba391c842428cfa30bbd6eb8b5b99512f80ec304a5041c567a1614b7` | 36 runs (2026-10-20): occluded-target, photo-board-decoy, lookalike-3d × the same seeds and methods |
| `v2-occluded-rerun.json.gz` | `264e6a1162368d8e98e72223d73cab008db113b64772a0ebf0f87e3ba18fc0ef` | 4 runs (phase 2): occluded-target seeds 42 and 123, whose layouts changed when line-of-sight and occlusion were unified (`v2-5a542bb9`, `v2-5d58a8bd`) |
| `lookalike-3d-seed123-surestop-trace.json` | `d0c482be0e3f3ad836b0f66049f698ad3bf3826b72e9d6839e7b96e660a5d09e` | The verbatim run record of the SureStop false arrival at the vase (`v2-04a6cf82`), with detector and backend metadata |

The uncompressed batch files have these SHA-256 values, matching the files the runs were written
to:

| File | SHA-256 |
|---|---|
| `v2-matrix-a.json` | `1a4ba429d77812710070d5a68110c6a7dc824b8db4f5301713131a56b1de1065` |
| `v2-matrix-b.json` | `9a8bac39f20276cf73d25a0b7592c92f9885fbc480c52b1a3433865feab6d94a` |
| `v2-occluded-rerun.json` | `1047451851c67c48a590697865cd774dec6e95ddc8a2217389a870c719ebd897` |

**Record format.**

- **Older batches.** The two 2026-10-20 batches predate phase 2. Their runs carry
  `layout: {version, id}` only.
- **Phase-2 batch.** The occluded re-run also carries `attempt`, `fallback`, `valid` and
  `failedChecks`.

**Layout changes.**

- **Superseded runs.** In the 2026-10-20 batches, the occluded-target runs for seeds 42 and 123
  were made on layouts `v2-e84e4599` and `v2-f50286bc`. The current generator no longer produces
  these layouts.
- **Unchanged runs.** Every other run's layout id is still produced by the current generator.
