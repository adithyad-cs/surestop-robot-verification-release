// Post-audit corrections to the protocol text stored in the recorded evaluation file. The
// recorded file is kept byte-for-byte; readers (the Lab and docs/RESULTS.md) show these notes
// next to the recorded text instead of rewriting it. See docs/FINAL_AUDIT_REPORT.md.

export const CORRECTION_LABEL = "Correction (audit, 2026-10-20)";

export const PROTOCOL_CORRECTIONS: Record<string, string> = {
  thresholds:
    "Baseline τ were selected on calibration seeds 101–110 (calibration table). SureStop's evidence gates " +
    "(volumetric relief ≥ 60 mm, flat ≤ 25 mm, expected noise ≤ 30 mm, minimum score 0.4, two-plane fraction 0.85) were set from the Phase A " +
    "feasibility renders and have not changed since. Its decision and planner parameters were not all fixed then: the confirm range (2.2 → 2.5 m), " +
    "the planner rings (1.6/2.0 → 1.9/2.2 m) and the 'not reproducible' rejection rule were changed after inspecting calibration v1 on the " +
    "calibration seeds. The recorded text 'SureStop thresholds fixed from Phase A renders' overstates this.",
};

/** Disclosures printed with the generated results. Each is supported by the audit evidence. */
export const RESULT_NOTES: string[] = [
  "The whole false-arrival difference against the tuned single-frame baseline comes from `photo-board-decoy`, which was designed after calibration v1 showed that, from the search route, the original prints and displays scored below the real plant. On the six original scenarios the tuned threshold also had 0/65 false arrivals, and SureStop's 3 extra completions are not distinguishable at this sample size (exact paired test over matched scenario/seed pairs, p = 0.25).",
  "Adding `photo-board-decoy` to calibration also moved the selected persistence threshold from τ = 0.6 (calibration v1, six scenarios) to τ = 0.8 (v2, seven scenarios). The single-frame and persistence runs on the six original scenarios are identical between v1 and v2.",
  "Development effort was asymmetric: SureStop's planner and decision rules were revised after inspecting calibration v1 (see the protocol correction above and /method), while the baselines received only a threshold sweep.",
  "The persistence baseline engages every candidate at the 0.3 detection floor, steps 0.5 m closer per frame and permanently rejects a candidate after 3 consecutive frames below τ. Close views raise decoy scores (prints up to 0.95, displays up to 0.98 in its held-out frames), and it rejected 24 of 99 real-plant candidates. It is one simple persistence design, not representative of temporal-persistence methods in general.",
  "Mission-level abstention (UNRESOLVED) never occurred on held-out seeds, so its held-out frequency is not validated.",
  "The robot's prior occupancy map contains the footprints of the candidate objects themselves, and the fixed search route was authored knowing where the object slots are. Ground truth is used only by a separate evaluator module written by the same team, not by an independent party.",
  "Repeatability: 16 held-out missions (photo-board-decoy and poster-decoy, seeds 1001–1002, all four methods) were re-run from a clean clone and matched their records exactly. This shows repeatability on the recorded software stack (headless Chromium, SwiftShader, TF.js WASM) only, not on other browsers, GPUs or all 560 missions.",
];
