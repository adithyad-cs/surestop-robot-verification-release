// Robot-facing mission types. No ground truth here: the mission sees camera frames
// (detections + measured depth features), its own pose and a label-free prior map.
import type { Detection, DetectorInfo } from "@/perception/types";
import type { DepthFeatures } from "@/sensing/depthFeatures";
import type { CandidateDecision, CandidateStatus, EvidenceRecord, IdentityConflict, Pose2, Vec3 } from "@/verify/types";
import type { MethodId } from "@/policies/types";
import type { PersistenceConfig, SingleFrameConfig } from "@/policies/baselines";
import type { SureStopConfig } from "@/verify/surestop";
import type { PlannerConfig } from "@/verify/planner";

export type FramePurpose = "search" | "scan" | "verify" | "persist" | "arrival";

export interface TargetObservation {
  detection: Detection;
  depth: DepthFeatures | null;
  positionWorld: Vec3 | null;
}

export interface SensorFrame {
  frameId: number;
  t: number;
  robot: Pose2;
  /** All detector outputs at or above the reporting floor (any class). */
  detections: Detection[];
  /** Target-class detections at or above the detection floor, with measured depth evidence. */
  targets: TargetObservation[];
  /**
   * Detections of classes confusable with the target (src/verify/identity.ts) at or above the detection
   * floor, localised like targets. Only "surestop-identity" acts on them; absent from older sensors.
   */
  conflicts?: TargetObservation[];
  inferenceMs: number;
  renderMs: number;
  /** True when this exact pose was rendered and inferred earlier in the same session (memoised). */
  cached: boolean;
}

export interface Sensor {
  capture(robot: Pose2, frameId: number, t: number): Promise<SensorFrame>;
  readonly detectorInfo: DetectorInfo | null;
  /** Number of poses whose frames are already cached (rendered and inferred earlier); optional. */
  cacheEntries?(): number;
}

export interface RoutePoint {
  x: number;
  z: number;
  /** World headings (deg; 0 = +X, 90 = +Z) to scan at this waypoint. */
  scan?: number[];
}

export interface MissionConfig {
  method: MethodId;
  targetClass: string;
  /** Minimum detector score for a target-class detection to open or update a candidate track. */
  detectionFloor: number;
  /** Association gate (m) between a new observation and an existing candidate track. */
  associationGate: number;
  /** Distance (m) travelled between search observations. */
  observeEvery: number;
  linearSpeed: number;
  /** deg/s */
  angularSpeed: number;
  /** Seconds the robot dwells per captured frame. */
  captureTime: number;
  /** Distance (m) from the candidate at which the robot stops to declare arrival. */
  standOff: number;
  maxSimTime: number;
  maxFrames: number;
  singleFrame: SingleFrameConfig;
  persistence: PersistenceConfig;
  surestop: SureStopConfig;
  planner: PlannerConfig;
}

export type MissionOutcome = "ARRIVED" | "NOT_FOUND" | "UNRESOLVED" | "NAV_FAILURE" | "ABORTED";

/** What ended the mission (P1-d). */
export type TerminationCause = "approach-complete" | "no-standoff" | "user-abort" | "route-completed" | "frame-budget" | "time-budget";

/**
 * Which outcome rule applied (P1-d); one per branch of MissionRunner.finish:
 * - arrived-after-confirmation        ARRIVED: the approach to a CONFIRMED candidate completed
 * - nav-failure-no-standoff           NAV_FAILURE: a CONFIRMED candidate had no reachable stand-off point
 * - aborted                           ABORTED: abort() was called
 * - unresolved-confirmed-not-reached  UNRESOLVED: route or budget ended after a confirmation, before arrival
 * - unresolved-unconfirmed-candidates UNRESOLVED: at least one engaged candidate ended UNCONFIRMED
 * - not-found                         NOT_FOUND: no confirmed and no unconfirmed candidate
 */
export type OutcomeRule =
  | "arrived-after-confirmation"
  | "nav-failure-no-standoff"
  | "aborted"
  | "unresolved-confirmed-not-reached"
  | "unresolved-unconfirmed-candidates"
  | "not-found";

export interface MissionTerminal {
  schema: "surestop.terminal/1";
  cause: TerminationCause;
  rule: OutcomeRule;
}

export type MissionMode = "SEARCHING" | "SCANNING" | "VERIFYING" | "PERSISTING" | "APPROACHING" | "DONE";

export interface MissionEvent {
  t: number;
  frameId?: number;
  kind: "mission" | "candidate" | "navigation" | "perception";
  trackId?: string;
  from?: string;
  to?: string;
  message: string;
}

export interface FrameTargetRecord {
  score: number;
  bbox: [number, number, number, number];
  excessRelief: number | null;
  expectedNoise: number | null;
  twoPlaneFraction: number | null;
  range: number | null;
  position: [number, number] | null;
  trackId: string | null;
  note: string;
}

/** A localised confusable-class detection in a frame (method "surestop-identity" records only). */
export interface FrameConflictRecord {
  cls: string;
  score: number;
  bbox: [number, number, number, number];
  range: number | null;
  position: [number, number] | null;
  /** Candidates it was associated with in this frame. */
  trackIds: string[];
}

export interface FrameRecord {
  frameId: number;
  t: number;
  pose: [number, number, number];
  purpose: FramePurpose;
  focusTrackId: string | null;
  detections: Array<{ cls: string; score: number; bbox: [number, number, number, number] }>;
  targets: FrameTargetRecord[];
  /** Present only on "surestop-identity" records. */
  conflicts?: FrameConflictRecord[];
  inferenceMs: number;
  cached: boolean;
}

export interface TrackRecord {
  id: string;
  position: Vec3;
  createdAt: number;
  createdFrame: number;
  decidedAt: number | null;
  status: CandidateStatus;
  decision: CandidateDecision;
  evidence: EvidenceRecord[];
  observations: number;
  maxScore: number;
  /** Identity conflicts associated with the candidate ("surestop-identity" records only). */
  identityConflicts?: IdentityConflict[];
}

export interface MissionStats {
  simTime: number;
  pathLength: number;
  frames: number;
  verificationFrames: number;
  inferenceMsTotal: number;
  cachedFrames: number;
  /** Trajectory samples whose centre entered the inflated obstacle margin. */
  marginViolations: number;
  /**
   * Wall-clock time of the mission in this browser. It includes rendering and inference only for
   * frames not served from the per-pose cache, so it depends on the cache state below and on the
   * machine; it is not comparable across methods unless every compared mission started cold.
   */
  wallClockMs: number;
  /**
   * Poses already in the sensor's frame cache when the mission started (P1-g); null if the sensor
   * does not report it. In a batch, variants of the same world run in sequence and share the
   * cache, so later variants start warm. Absent on pre-P1 records.
   */
  sensorCacheEntriesAtStart?: number | null;
  /** "cold" (0 cached poses at start), "warm" (> 0), or "unknown" (not reported). */
  cacheState?: "cold" | "warm" | "unknown";
}

export interface MissionResult {
  schema: "surestop.mission/1";
  scenarioId: string;
  seed: number;
  method: MethodId;
  config: MissionConfig;
  detector: DetectorInfo | null;
  outcome: MissionOutcome;
  reason: string;
  /** Structured termination cause and outcome rule (P1-d); null while running; absent on pre-P1 records. */
  terminal?: MissionTerminal | null;
  confirmedTrackId: string | null;
  finalPose: Pose2;
  tracks: TrackRecord[];
  frames: FrameRecord[];
  events: MissionEvent[];
  /** [t, x, z, theta] sampled at most every 0.25 s. */
  trajectory: Array<[number, number, number, number]>;
  stats: MissionStats;
}

/** One unit of progress, used by the console to animate and inspect the mission. */
export interface MissionStep {
  index: number;
  mode: MissionMode;
  segment: Pose2[];
  frame: SensorFrame | null;
  purpose: FramePurpose | null;
  focusTrackId: string | null;
  events: MissionEvent[];
  plannedPath: Array<{ x: number; z: number }> | null;
  done: boolean;
}
