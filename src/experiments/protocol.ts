// Seed sets for the experiment protocol. Calibration seeds tune baseline thresholds;
// evaluation seeds are held out and used only for the reported comparison.
export const CALIBRATION_SEEDS = Array.from({ length: 10 }, (_, i) => 101 + i);
export const EVAL_SEEDS = Array.from({ length: 20 }, (_, i) => 1001 + i);
