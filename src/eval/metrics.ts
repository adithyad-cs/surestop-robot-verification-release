// Mission-level and candidate-level metrics with explicit numerators and denominators.
import type { TrialScore } from "./evaluate";

export interface Rate {
  num: number;
  den: number;
  /** num/den, or null when den = 0. */
  value: number | null;
  /** Wilson 95% interval, or null when den = 0. */
  ci95: [number, number] | null;
  definition: string;
}

export function wilson(num: number, den: number, z = 1.96): [number, number] | null {
  if (den <= 0) return null;
  const p = num / den;
  const z2 = z * z;
  const centre = (p + z2 / (2 * den)) / (1 + z2 / den);
  const half = (z * Math.sqrt((p * (1 - p)) / den + z2 / (4 * den * den))) / (1 + z2 / den);
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export function rate(num: number, den: number, definition: string): Rate {
  if (num < 0 || den < 0 || num > den || !Number.isInteger(num) || !Number.isInteger(den)) {
    throw new Error(`invalid rate ${num}/${den}`);
  }
  return { num, den, value: den ? num / den : null, ci95: wilson(num, den), definition };
}

export interface MissionMetrics {
  trials: number;
  falseArrivalRate: Rate;
  correctConfirmationRate: Rate;
  abstentionRate: Rate;
  completionRate: Rate;
  navFailures: number;
  aborted: number;
  meanFrames: number;
  meanVerificationFrames: number;
  meanPathLength: number;
  meanSimTime: number;
  meanDecisionDelay: number | null;
}

export const METRIC_DEFINITIONS = {
  falseArrivalRate:
    "Trials that ended ARRIVED at a candidate that is not a 3-D potted plant ÷ trials in which at least one non-target candidate was opened (encountered).",
  correctConfirmationRate: "Trials that ended ARRIVED at the 3-D potted plant ÷ trials in which a 3-D potted plant is present.",
  abstentionRate:
    "Trials that ended UNRESOLVED ÷ trials in which at least one candidate was opened. UNRESOLVED means arrival was not declared because either an engaged candidate stayed UNCONFIRMED, or a candidate was CONFIRMED but the robot did not reach its stand-off point before the mission ended. (A CONFIRMED candidate with no reachable stand-off point is NAV_FAILURE instead.)",
  completionRate:
    "Trials with the correct terminal outcome (ARRIVED at the target if present; NOT_FOUND if absent) ÷ all trials (excluding aborted).",
} as const;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function missionMetrics(trials: TrialScore[]): MissionMetrics {
  const ok = trials.filter((t) => t.outcome !== "ABORTED");
  const delays = ok.map((t) => t.decisionDelay).filter((d): d is number => d !== null);
  return {
    trials: ok.length,
    falseArrivalRate: rate(
      ok.filter((t) => t.nonTargetEncountered && t.falseArrival).length,
      ok.filter((t) => t.nonTargetEncountered).length,
      METRIC_DEFINITIONS.falseArrivalRate,
    ),
    correctConfirmationRate: rate(
      ok.filter((t) => t.targetPresent && t.correctArrival).length,
      ok.filter((t) => t.targetPresent).length,
      METRIC_DEFINITIONS.correctConfirmationRate,
    ),
    abstentionRate: rate(
      ok.filter((t) => t.verificationInitiated && t.abstained).length,
      ok.filter((t) => t.verificationInitiated).length,
      METRIC_DEFINITIONS.abstentionRate,
    ),
    completionRate: rate(ok.filter((t) => t.correctTerminal).length, ok.length, METRIC_DEFINITIONS.completionRate),
    navFailures: ok.filter((t) => t.navFailure).length,
    aborted: trials.length - ok.length,
    meanFrames: mean(ok.map((t) => t.frames)),
    meanVerificationFrames: mean(ok.map((t) => t.verificationFrames)),
    meanPathLength: mean(ok.map((t) => t.pathLength)),
    meanSimTime: mean(ok.map((t) => t.simTime)),
    meanDecisionDelay: delays.length ? mean(delays) : null,
  };
}

export interface CandidateMetrics {
  /** One encounter = one candidate track (one verification episode), not one frame. */
  byKind: Record<string, { encounters: number; confirmed: number; rejected: number; unconfirmed: number; notEngaged: number }>;
}

export function candidateMetrics(trials: TrialScore[]): CandidateMetrics {
  const byKind: CandidateMetrics["byKind"] = {};
  for (const t of trials) {
    for (const l of t.trackLabels) {
      const k = (byKind[l.kind] ??= { encounters: 0, confirmed: 0, rejected: 0, unconfirmed: 0, notEngaged: 0 });
      k.encounters++;
      if (l.status === "CONFIRMED") k.confirmed++;
      else if (l.status === "REJECTED") k.rejected++;
      else if (l.status === "UNCONFIRMED") k.unconfirmed++;
      else k.notEngaged++;
    }
  }
  return { byKind };
}

export function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    m.set(k, [...(m.get(k) ?? []), x]);
  }
  return m;
}
