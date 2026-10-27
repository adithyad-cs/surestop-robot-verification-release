// Robot-facing types for candidate verification. Nothing in src/verify may import
// scenario ground truth (src/sim/assets, src/eval): inputs are detector outputs,
// depth-derived features and the robot's own pose.
import type { DepthFeatures } from "@/sensing/depthFeatures";

export type CandidateOutcome = "CONFIRMED" | "REJECTED" | "UNCONFIRMED";
export type CandidateStatus = "PENDING" | CandidateOutcome;

export interface Pose2 {
  x: number;
  z: number;
  /** Heading (rad); forward vector is (cos theta, sin theta) in the XZ plane. */
  theta: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** One frame in which the policy looked for a given candidate. */
export interface CandidateObservation {
  frameId: number;
  t: number;
  robot: Pose2;
  /**
   * Target-class detection associated with the candidate in this frame, or null when the
   * robot was facing the candidate's estimated position but the detector reported nothing
   * there (a "miss").
   */
  detection: { cls: string; score: number; bbox: [number, number, number, number] } | null;
  depth: DepthFeatures | null;
  /** Candidate position estimated from the depth centroid (world frame), if available. */
  positionWorld: Vec3 | null;
}

export type ViewVerdict = "VOLUMETRIC" | "FLAT" | "INCONCLUSIVE";

export interface ViewAssessment {
  verdict: ViewVerdict;
  reason: string;
  /** Set when an input was missing, non-finite or out of range (the field's name, e.g. "detector score"). */
  invalidField?: string;
}

/** A non-finite number, which JSON cannot represent (JSON.stringify would write null). */
export interface NonFinite {
  nonFinite: "NaN" | "Infinity" | "-Infinity";
}

/** T with every number possibly replaced by a NonFinite marker (see encodeNonFinite). */
export type Encoded<T> = T extends number ? number | NonFinite : T extends readonly unknown[] ? { [K in keyof T]: Encoded<T[K]> } : T extends object ? { [K in keyof T]: Encoded<T[K]> } : T;

export const VIEW_INPUTS_SCHEMA = "surestop.view-inputs/1";

/**
 * The exact inputs one evidence record was computed from, as the verifier received them, unrounded.
 * Units: metres and radians in the world XZ plane unless stated. Numbers that were not finite are
 * stored as NonFinite markers; fields that were absent stay absent.
 */
export interface ViewInputs {
  schema: typeof VIEW_INPUTS_SCHEMA;
  /** Robot pose of the observation (x, z in m; theta in rad, forward = (cos, sin)). */
  robot: Encoded<Pose2>;
  /** Candidate position estimate (world XZ, m) the viewpoint cell was computed from. */
  candidateEstimate: Encoded<{ x: number; z: number }>;
  /**
   * Robot-to-candidate-estimate distance (m) in the ground plane: the same quantity as the legacy
   * EvidenceRecord.range. Not the optical-axis depth, which is depth.medianDepth.
   */
  candidateDistance: number | NonFinite;
  /** Bearing of the robot as seen from the candidate estimate (deg, [0, 360)). */
  bearingDeg: number | NonFinite;
  /** The class the verifier may confirm; null for policies that do not check the class. */
  targetClass: string | null;
  /** Detection exactly as received: class, score, box [x, y, w, h] in pixels (unrounded). */
  detection: Encoded<NonNullable<CandidateObservation["detection"]>> | null;
  /**
   * Depth features exactly as received. medianDepth / nearDepth are ranges along the optical axis
   * (m); centroidCam is in the camera frame (x right, y up, z forward).
   */
  depth: Encoded<DepthFeatures> | null;
}

/**
 * A detection of a class confusable with the target (src/verify/identity.ts), localised within the
 * association gate of a candidate's position estimate. Experimental (method "surestop-identity").
 */
export interface IdentityConflict {
  frameId: number;
  t: number;
  robot: Pose2;
  cls: string;
  /** Raw detector score of the confusable-class detection. */
  score: number;
  bbox: [number, number, number, number];
  /** Back-projected position of the confusable detection (world XZ, m). */
  position: { x: number; z: number };
  /** Distance (m) from that position to the candidate estimate when the conflict was associated. */
  distance: number;
  /** Whether it changed the decision; false when it arrived after a terminal decision. */
  used: boolean;
}

export interface EvidenceRecord {
  frameId: number;
  t: number;
  cell: string;
  range: number;
  bearingDeg: number;
  verdict: ViewVerdict;
  reason: string;
  /** Whether this observation supplied the vote for its viewpoint cell. */
  counted: boolean;
  /** Why it was not counted (duplicate cell, superseded, etc.). */
  note?: string;
  /** Structured name of the invalid input when the verdict came from the input check (P1-c). */
  invalidField?: string;
  /** Exact verifier inputs for offline recomputation (P1-c). Absent on pre-P1 records. */
  inputs?: ViewInputs;
  score: number | null;
  excessRelief: number | null;
  expectedNoise: number | null;
}

/**
 * Which rule produced a candidate's current status (P1-d). Stable identifiers; the human-readable
 * `reason` is unchanged. Each value maps to one code path:
 * - pending                         no terminal rule has fired yet
 * - confirm-volumetric-support      SureStopVerifier.evaluate: enough VOLUMETRIC cells, no FLAT, one within confirmRange
 * - reject-flat-evidence            SureStopVerifier.evaluate: enough FLAT cells, no support
 * - reject-not-reproducible         SureStopVerifier.evaluate: enough miss cells, no support
 * - exhaust-viewpoint-budget        SureStopPolicy.next: maxViewpoints planned viewpoints used
 * - exhaust-no-reachable-viewpoint  SureStopPolicy.next: the planner found no reachable, unused viewpoint
 * - exhaust-viewpoint-unreachable   MissionRunner.startVerify: no path to the planned viewpoint
 * - exhaust-mission-ended           MissionRunner.finish: the mission ended while the candidate was engaged and pending
 * - withhold-identity-conflict      SureStopVerifier.identityConflict: a confusable-class detection at the
 *                                   candidate (method "surestop-identity"); UNCONFIRMED, never REJECTED
 * - single-frame-score-threshold    SingleFramePolicy: a frame's score ≥ threshold
 * - persistence-hits-in-window      PersistencePolicy: requiredHits within the window
 * - persistence-consecutive-misses  PersistencePolicy: maxConsecutiveMisses misses in a row
 * - persistence-frame-budget        PersistencePolicy: maxFrames observed without a decision
 */
export type DecisionRule =
  | "pending"
  | "confirm-volumetric-support"
  | "reject-flat-evidence"
  | "reject-not-reproducible"
  | ExhaustRule
  | "withhold-identity-conflict"
  | "single-frame-score-threshold"
  | "persistence-hits-in-window"
  | "persistence-consecutive-misses"
  | "persistence-frame-budget";

export type ExhaustRule = "exhaust-viewpoint-budget" | "exhaust-no-reachable-viewpoint" | "exhaust-viewpoint-unreachable" | "exhaust-mission-ended";

export interface CandidateDecision {
  status: CandidateStatus;
  reason: string;
  /** Structured rule behind `status` (P1-d). Absent on pre-P1 records. */
  rule?: DecisionRule;
  support: number;
  against: number;
  distinctViews: number;
  attempts: number;
  /** Identity conflicts associated with the candidate (method "surestop-identity" only). */
  identityConflicts?: number;
}
