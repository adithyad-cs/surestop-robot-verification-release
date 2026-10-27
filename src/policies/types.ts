import type { CandidateDecision, CandidateObservation, EvidenceRecord, ExhaustRule, Pose2 } from "@/verify/types";
import type { NavQuery, PlannedViewpoint } from "@/verify/planner";

export type MethodId = "single-frame" | "persistence" | "surestop" | "surestop-1view" | "surestop-identity";

export const METHOD_LABELS: Record<MethodId, string> = {
  "single-frame": "Single-frame threshold",
  persistence: "Temporal persistence",
  surestop: "SureStop (multi-view evidence)",
  "surestop-1view": "SureStop ablation: one view",
  "surestop-identity": "SureStop + identity-conflict check (experimental)",
};

export interface PolicyContext {
  robot: Pose2;
  nav: NavQuery;
}

export type NextStep =
  /** A terminal candidate decision has been made. */
  | { kind: "decided"; decision: CandidateDecision }
  /** Not enough to act on: leave the candidate pending and continue the search route. */
  | { kind: "resume-search"; reason: string }
  /** Drive to a planned viewpoint, face the candidate and observe. */
  | { kind: "observe-from"; viewpoint: PlannedViewpoint }
  /** Step towards the candidate by `step` metres and observe again. */
  | { kind: "step-towards"; step: number; reason: string };

/** Per-candidate stopping/verification policy. One instance per candidate track. */
export interface CandidatePolicy {
  readonly method: MethodId;
  observe(obs: CandidateObservation): EvidenceRecord;
  next(ctx: PolicyContext): NextStep;
  decision(): CandidateDecision;
  records(): EvidenceRecord[];
  setCandidatePosition(p: { x: number; z: number }): void;
  /** Ends verification without a decision (e.g., navigation failure). */
  exhaust(why: string, rule: ExhaustRule): void;
}
