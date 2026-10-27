// SureStop candidate verifier: a deterministic sequential evidence policy over distinct
// viewpoints. One vote per viewpoint cell; CONFIRM needs enough volumetric support from
// distinct cells with no flat evidence; REJECT needs enough flat evidence with no support;
// a bounded viewpoint budget ends in UNCONFIRMED. Not an SPRT: votes are not likelihood ratios.
import { assessView, DEFAULT_EVIDENCE, evidenceConfigError, type EvidenceConfig } from "./evidence";
import type {
  CandidateDecision,
  DecisionRule,
  ExhaustRule,
  CandidateObservation,
  CandidateStatus,
  EvidenceRecord,
  IdentityConflict,
  ViewAssessment,
  ViewVerdict,
} from "./types";
import { DEFAULT_CELL, viewpointCell, type ViewpointCellConfig } from "./viewpoint";
import { GRID_RES } from "@/sim/navParams";
import { captureViewInputs } from "./viewInputs";

/**
 * The per-view assessment the verifier uses: a detection of another class is never evidence;
 * otherwise assessView decides. Exported so offline recomputation uses this exact code.
 */
export function assessForTarget(obs: CandidateObservation, targetClass: string, evidence: EvidenceConfig): ViewAssessment {
  // The sensor already filters by class; this keeps the verifier itself from confirming a
  // candidate on another class's detection if a caller passes one.
  const cls = obs.detection?.cls;
  if (obs.detection && cls !== targetClass) {
    return { verdict: "INCONCLUSIVE", reason: `detection class "${String(cls)}" is not the target class "${targetClass}": view not used as evidence` };
  }
  return assessView(obs, evidence);
}

export interface SureStopConfig {
  evidence: EvidenceConfig;
  cell: ViewpointCellConfig;
  /** Distinct viewpoint cells with VOLUMETRIC evidence needed to confirm. */
  requiredSupport: number;
  /** Distinct viewpoint cells with FLAT evidence needed to reject. */
  requiredAgainst: number;
  /**
   * Distinct viewpoint cells from which the candidate was looked for but not re-detected that
   * reject it as a non-reproducible detection (only when there is no volumetric support).
   */
  requiredMisses: number;
  /** Maximum number of planned verification viewpoints per candidate. */
  maxViewpoints: number;
  /** At least one supporting view must be within this range (m) of the candidate. */
  confirmRange: number;
  /**
   * Robot positions within this distance (m, ground plane) are one physical viewpoint (D3). An
   * observation from such a position is counted in the viewpoint cell of the earlier observation,
   * even if a moved candidate estimate puts it in another cell. 0 or absent: no check (behaviour
   * before D3; keeps replays of older records faithful).
   */
  samePoseRadius?: number;
  /**
   * Experimental (method "surestop-identity"): a confusable-class detection at the candidate withholds
   * confirmation (UNCONFIRMED, never REJECTED). Absent or false: conflicts are not accepted.
   */
  identityConflict?: boolean;
}

export const DEFAULT_SURESTOP: SureStopConfig = {
  evidence: DEFAULT_EVIDENCE,
  cell: DEFAULT_CELL,
  requiredSupport: 2,
  requiredAgainst: 2,
  requiredMisses: 3,
  maxViewpoints: 4,
  confirmRange: 2.5,
  // One navigation-grid cell, the resolution at which the robot's positions are planned. At the
  // 1.9 m verification ring 0.1 m moves the bearing by at most 3.02° and the range by at most 0.1 m,
  // about a tenth of the 30° x 0.75 m viewpoint cell, so such poses are one viewpoint by the
  // cell's own scale wherever its boundaries fall.
  samePoseRadius: GRID_RES,
};

const isCount = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 1;
const isPositive = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * Returns the first SureStopConfig field that is missing, non-finite or out of range, or null.
 * `requiredSupport < 1` was already refused; NaN or Infinity also failed that test silently (every
 * comparison with NaN is false), which this closes.
 */
export function sureStopConfigError(config: SureStopConfig): string | null {
  if (!config || typeof config !== "object") return "config";
  if (!config.evidence || typeof config.evidence !== "object") return "evidence";
  const ev = evidenceConfigError(config.evidence);
  if (ev) return ev;
  if (!config.cell || !isPositive(config.cell.rangeBin)) return "cell.rangeBin";
  if (!isPositive(config.cell.bearingBinDeg) || config.cell.bearingBinDeg > 360) return "cell.bearingBinDeg";
  if (!isCount(config.requiredSupport)) return "requiredSupport";
  if (!isCount(config.requiredAgainst)) return "requiredAgainst";
  if (!isCount(config.requiredMisses)) return "requiredMisses";
  if (!isCount(config.maxViewpoints)) return "maxViewpoints";
  if (!isPositive(config.confirmRange)) return "confirmRange";
  const r = config.samePoseRadius;
  if (r !== undefined && !(typeof r === "number" && Number.isFinite(r) && r >= 0)) return "samePoseRadius";
  if (config.identityConflict !== undefined && typeof config.identityConflict !== "boolean") return "identityConflict";
  return null;
}

interface CellVote {
  verdict: ViewVerdict;
  /** The robot looked for the candidate from this cell and the detector did not report it. */
  miss: boolean;
  noise: number;
  frameId: number;
  range: number;
  bearingDeg: number;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function conclusive(v: ViewVerdict): boolean {
  return v !== "INCONCLUSIVE";
}

/** EvidenceRecord.invalidField when the robot pose or candidate estimate gave a non-finite cell. */
export const POSE_INVALID_FIELD = "robot pose or candidate position";

/** Robot position of a valid observation and the viewpoint cell it was assigned to. */
interface ObservedPose {
  x: number;
  z: number;
  cell: string;
  frameId: number;
}

export class SureStopVerifier {
  private readonly votes = new Map<string, CellVote>();
  /** Every valid observation made while PENDING, for the same-pose check (D3). */
  private readonly poses: ObservedPose[] = [];
  private readonly log: EvidenceRecord[] = [];
  private readonly conflicts: IdentityConflict[] = [];
  private attempts = 0;
  private status: CandidateStatus = "PENDING";
  private reason = "awaiting evidence";
  private rule: DecisionRule = "pending";

  /**
   * @param targetClass The detector class this verifier may confirm (the mission's target class).
   *   A detection of any other class is never used as evidence for or against the candidate.
   */
  constructor(
    readonly config: SureStopConfig = DEFAULT_SURESTOP,
    private candidate: { x: number; z: number },
    readonly targetClass: string,
  ) {
    const bad = sureStopConfigError(config);
    if (bad) throw new Error(`invalid SureStop configuration: ${bad}`);
    if (typeof targetClass !== "string" || !targetClass) throw new Error("invalid SureStop configuration: targetClass");
  }

  setCandidatePosition(p: { x: number; z: number }): void {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) throw new Error("invalid candidate position");
    this.candidate = { x: p.x, z: p.z };
  }

  get candidatePosition(): { x: number; z: number } {
    return this.candidate;
  }

  /** Records an observation. After a terminal decision, observations are logged but cannot change it. */
  observe(obs: CandidateObservation): EvidenceRecord {
    const cell = viewpointCell(obs.robot, this.candidate, this.config.cell);
    const a = assessForTarget(obs, this.targetClass, this.config.evidence);
    const rec: EvidenceRecord = {
      frameId: obs.frameId,
      t: obs.t,
      cell: cell.key,
      range: cell.range,
      bearingDeg: cell.bearingDeg,
      verdict: a.verdict,
      reason: a.reason,
      counted: false,
      score: obs.detection?.score ?? null,
      excessRelief: obs.depth?.excessRelief ?? null,
      expectedNoise: obs.depth?.expectedNoise ?? null,
      ...(a.invalidField ? { invalidField: a.invalidField } : {}),
      inputs: captureViewInputs(obs, this.candidate, cell, this.targetClass),
    };
    if (this.status !== "PENDING") {
      rec.note = `ignored: candidate already ${this.status}`;
      this.log.push(rec);
      return rec;
    }
    // Fail closed: a non-finite pose or candidate position yields a bogus cell key (e.g.
    // "rInfinity:b0") that would count as an extra distinct viewpoint.
    if (!Number.isFinite(cell.range) || !Number.isFinite(cell.bearingDeg)) {
      rec.verdict = "INCONCLUSIVE";
      rec.reason = "invalid robot pose or candidate position: view not used as evidence";
      rec.note = "invalid robot pose or candidate position: not counted";
      rec.invalidField = POSE_INVALID_FIELD;
      this.log.push(rec);
      return rec;
    }
    // D3: the cell depends on the candidate estimate, which moves as detections are averaged. A
    // robot position already observed from stays the viewpoint it was, so the same physical pose
    // can never become a second independent vote because the estimate moved.
    const same = this.samePose(obs.robot);
    const key = same ? same.pose.cell : cell.key;
    const merged = same !== null && key !== cell.key;
    const samePoseNote = merged ? `same robot pose as frame ${same.pose.frameId} (${same.distance.toFixed(3)} m apart): viewpoint cell ${key}` : "";
    this.poses.push({ x: obs.robot.x, z: obs.robot.z, cell: key, frameId: obs.frameId });
    const prev = this.votes.get(key);
    const noise = obs.depth?.expectedNoise ?? Infinity;
    const vote: CellVote = { verdict: a.verdict, miss: !obs.detection, noise, frameId: obs.frameId, range: cell.range, bearingDeg: cell.bearingDeg };
    if (!prev) {
      this.votes.set(key, vote);
      rec.counted = true;
    } else if (!conclusive(prev.verdict) && conclusive(a.verdict)) {
      this.votes.set(key, vote);
      rec.counted = true;
      rec.note = `replaces inconclusive vote from frame ${prev.frameId} in same cell`;
      this.unmark(prev.frameId);
    } else if (conclusive(prev.verdict) && conclusive(a.verdict) && noise < prev.noise) {
      this.votes.set(key, vote);
      rec.counted = true;
      rec.note = `replaces lower-quality vote from frame ${prev.frameId} in same cell`;
      this.unmark(prev.frameId);
    } else {
      rec.note = `same viewpoint cell as frame ${prev.frameId}: not counted as new evidence`;
    }
    if (merged) rec.note = rec.note ? `${samePoseNote}; ${rec.note}` : samePoseNote;
    this.log.push(rec);
    this.evaluate();
    return rec;
  }

  /**
   * Records a confusable-class detection localised at this candidate. While PENDING it ends verification
   * UNCONFIRMED: the detector named the object as something else, so target-class labels plus geometry
   * cannot establish identity. It never rejects: a look-alike label is not evidence that the object is
   * not the target. After a terminal decision it is logged with used = false and changes nothing.
   */
  identityConflict(c: Omit<IdentityConflict, "used">): IdentityConflict {
    if (!this.config.identityConflict) throw new Error("identity conflicts are not enabled for this verifier");
    const rec: IdentityConflict = { ...c, used: this.status === "PENDING" };
    this.conflicts.push(rec);
    if (!rec.used) return rec;
    this.status = "UNCONFIRMED";
    this.rule = "withhold-identity-conflict";
    const { support } = this.tally();
    this.reason =
      `identity conflict: the detector also reported "${c.cls}" (${c.score.toFixed(2)}) ${c.distance.toFixed(2)} m from this candidate ` +
      `(frame ${c.frameId}); confirmation withheld (${plural(support, "volumetric view")} so far)`;
    return rec;
  }

  identityConflicts(): IdentityConflict[] {
    return this.conflicts;
  }

  /** Nearest earlier observed robot position within samePoseRadius, or null. */
  private samePose(robot: { x: number; z: number }): { pose: ObservedPose; distance: number } | null {
    const radius = this.config.samePoseRadius ?? 0;
    if (!(radius > 0)) return null;
    let best: { pose: ObservedPose; distance: number } | null = null;
    for (const p of this.poses) {
      const d = Math.hypot(robot.x - p.x, robot.z - p.z);
      if (d <= radius && (!best || d < best.distance)) best = { pose: p, distance: d };
    }
    return best;
  }

  private unmark(frameId: number) {
    for (const r of this.log) {
      if (r.frameId === frameId && r.counted) {
        r.counted = false;
        r.note = "superseded by a better observation from the same cell";
      }
    }
  }

  /** Call when the robot reaches a planned verification viewpoint. */
  registerAttempt(): void {
    this.attempts++;
  }

  canAttempt(): boolean {
    return this.status === "PENDING" && this.attempts < this.config.maxViewpoints;
  }

  usedCells(): Set<string> {
    return new Set(this.votes.keys());
  }

  /** Bearings (deg) of cells that hold a conclusive vote or any vote. */
  votedBearings(): number[] {
    return [...this.votes.values()].map((v) => v.bearingDeg);
  }

  private tally() {
    let support = 0;
    let against = 0;
    let misses = 0;
    let minSupportRange = Infinity;
    for (const v of this.votes.values()) {
      if (v.verdict === "VOLUMETRIC") {
        support++;
        minSupportRange = Math.min(minSupportRange, v.range);
      } else if (v.verdict === "FLAT") against++;
      else if (v.miss) misses++;
    }
    return { support, against, misses, minSupportRange };
  }

  private evaluate(): void {
    if (this.status !== "PENDING") return;
    const { support, against, misses, minSupportRange } = this.tally();
    const c = this.config;
    if (support >= c.requiredSupport && against === 0) {
      if (minSupportRange <= c.confirmRange) {
        this.status = "CONFIRMED";
        this.rule = "confirm-volumetric-support";
        this.reason = `volumetric evidence from ${plural(support, "distinct viewpoint")}, no flat evidence; closest supporting view ${minSupportRange.toFixed(2)} m`;
      } else {
        this.reason = `support from ${support} views but none within ${c.confirmRange} m`;
      }
      return;
    }
    if (against >= c.requiredAgainst && support === 0) {
      this.status = "REJECTED";
      this.rule = "reject-flat-evidence";
      this.reason = `flat-surface evidence from ${plural(against, "distinct viewpoint")}, no volumetric evidence (picture-like candidate)`;
      return;
    }
    if (misses >= c.requiredMisses && support === 0) {
      this.status = "REJECTED";
      this.rule = "reject-not-reproducible";
      this.reason = `not re-detected from ${plural(misses, "distinct viewpoint")} with line of sight, no volumetric evidence (detection not reproducible)`;
      return;
    }
    if (support > 0 && against > 0) this.reason = `conflicting evidence: ${support} volumetric vs ${against} flat views`;
    else this.reason = `insufficient evidence: ${support} volumetric, ${against} flat, ${misses} not re-detected of ${this.votes.size} distinct views`;
  }

  /** Ends verification without a decision (budget spent, no reachable viewpoint, timeout). */
  exhaust(why: string, rule: ExhaustRule): void {
    if (this.status !== "PENDING") return;
    this.status = "UNCONFIRMED";
    this.rule = rule;
    this.reason = `${why}; ${this.reason}`;
  }

  decision(): CandidateDecision {
    const { support, against } = this.tally();
    return {
      status: this.status,
      reason: this.reason,
      rule: this.rule,
      support,
      against,
      distinctViews: this.votes.size,
      attempts: this.attempts,
      ...(this.config.identityConflict ? { identityConflicts: this.conflicts.length } : {}),
    };
  }

  records(): EvidenceRecord[] {
    return this.log;
  }
}
