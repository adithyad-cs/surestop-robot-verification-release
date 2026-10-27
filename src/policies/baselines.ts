// Baseline stopping rules. They see the same detector outputs as SureStop; neither uses
// depth geometry for the stop decision (depth is used only to localise the candidate).
import type { CandidateDecision, CandidateObservation, CandidateStatus, DecisionRule, EvidenceRecord, ExhaustRule } from "@/verify/types";
import { viewpointCell } from "@/verify/viewpoint";
import { captureViewInputs } from "@/verify/viewInputs";
import type { CandidatePolicy, NextStep } from "./types";

function baseRecord(obs: CandidateObservation, candidate: { x: number; z: number }): EvidenceRecord {
  const cell = viewpointCell(obs.robot, candidate);
  return {
    frameId: obs.frameId,
    t: obs.t,
    cell: cell.key,
    range: cell.range,
    bearingDeg: cell.bearingDeg,
    verdict: "INCONCLUSIVE",
    reason: "",
    counted: true,
    score: obs.detection?.score ?? null,
    excessRelief: obs.depth?.excessRelief ?? null,
    expectedNoise: obs.depth?.expectedNoise ?? null,
    // Baselines decide on the detector score alone and do not check the class (targetClass null).
    inputs: captureViewInputs(obs, candidate, cell, null),
  };
}

export interface SingleFrameConfig {
  /** Detector score at or above which a single frame commits to the candidate. */
  threshold: number;
}

/** Commits on the first frame whose target-class score clears a fixed threshold (VLFM-style). */
export class SingleFramePolicy implements CandidatePolicy {
  readonly method = "single-frame" as const;
  private status: CandidateStatus = "PENDING";
  private reason = "no frame above threshold yet";
  private rule: DecisionRule = "pending";
  private readonly log: EvidenceRecord[] = [];
  private frames = 0;

  constructor(readonly config: SingleFrameConfig, private candidate: { x: number; z: number }) {}

  setCandidatePosition(p: { x: number; z: number }) {
    this.candidate = { ...p };
  }

  observe(obs: CandidateObservation): EvidenceRecord {
    const rec = baseRecord(obs, this.candidate);
    this.frames++;
    const s = obs.detection?.score ?? 0;
    if (this.status !== "PENDING") {
      rec.counted = false;
      rec.reason = `ignored: candidate already ${this.status}`;
    } else if (obs.detection && s >= this.config.threshold) {
      this.status = "CONFIRMED";
      this.rule = "single-frame-score-threshold";
      this.reason = `single frame: detector score ${s.toFixed(2)} ≥ ${this.config.threshold}`;
      rec.reason = this.reason;
    } else {
      rec.reason = obs.detection ? `score ${s.toFixed(2)} < ${this.config.threshold}` : "not detected";
    }
    this.log.push(rec);
    return rec;
  }

  next(): NextStep {
    if (this.status !== "PENDING") return { kind: "decided", decision: this.decision() };
    return { kind: "resume-search", reason: this.reason };
  }

  exhaust(why: string, rule: ExhaustRule) {
    if (this.status === "PENDING") {
      this.status = "UNCONFIRMED";
      this.rule = rule;
      this.reason = why;
    }
  }

  decision(): CandidateDecision {
    return {
      status: this.status,
      reason: this.reason,
      rule: this.rule,
      support: this.status === "CONFIRMED" ? 1 : 0,
      against: 0,
      distinctViews: new Set(this.log.map((r) => r.cell)).size,
      attempts: this.frames,
    };
  }

  records() {
    return this.log;
  }
}

export interface PersistenceConfig {
  threshold: number;
  /** Hits (frames at or above threshold) needed within the sliding window to commit. */
  requiredHits: number;
  /** Sliding window length (frames). */
  window: number;
  /** Consecutive misses (no detection / below threshold) that drop the candidate. */
  maxConsecutiveMisses: number;
  /** Step (m) taken towards the candidate between frames while confirming. */
  step: number;
  /** Maximum frames spent on one candidate before giving up (UNCONFIRMED). */
  maxFrames: number;
}

/**
 * Temporal persistence gate (in the spirit of SG-Nav / AECNav-style accumulation): approach
 * the candidate while re-detecting it; commit once K of the last N frames clear the threshold.
 */
export class PersistencePolicy implements CandidatePolicy {
  readonly method = "persistence" as const;
  private status: CandidateStatus = "PENDING";
  private reason = "accumulating consecutive detections";
  private rule: DecisionRule = "pending";
  private readonly log: EvidenceRecord[] = [];
  private readonly hits: boolean[] = [];
  private misses = 0;
  private frames = 0;

  constructor(readonly config: PersistenceConfig, private candidate: { x: number; z: number }) {
    if (config.requiredHits < 1 || config.window < config.requiredHits) throw new Error("invalid persistence configuration");
  }

  private windowHits(): number {
    return this.hits.slice(-this.config.window).filter(Boolean).length;
  }

  setCandidatePosition(p: { x: number; z: number }) {
    this.candidate = { ...p };
  }

  observe(obs: CandidateObservation): EvidenceRecord {
    const rec = baseRecord(obs, this.candidate);
    if (this.status !== "PENDING") {
      rec.counted = false;
      rec.reason = `ignored: candidate already ${this.status}`;
      this.log.push(rec);
      return rec;
    }
    this.frames++;
    const s = obs.detection?.score ?? 0;
    const hit = !!obs.detection && s >= this.config.threshold;
    this.hits.push(hit);
    if (hit) this.misses = 0;
    else this.misses++;
    const k = this.windowHits();
    rec.reason = hit
      ? `hit (score ${s.toFixed(2)}): ${k}/${this.config.requiredHits} in last ${this.config.window} frames`
      : `miss ${this.misses}/${this.config.maxConsecutiveMisses} (${obs.detection ? `score ${s.toFixed(2)}` : "not detected"})`;
    if (k >= this.config.requiredHits) {
      this.status = "CONFIRMED";
      this.rule = "persistence-hits-in-window";
      this.reason = `${k} of the last ${Math.min(this.config.window, this.hits.length)} frames with score ≥ ${this.config.threshold}`;
    } else if (this.misses >= this.config.maxConsecutiveMisses) {
      this.status = "REJECTED";
      this.rule = "persistence-consecutive-misses";
      this.reason = `lost: ${this.misses} consecutive frames without a detection ≥ ${this.config.threshold}`;
    } else if (this.frames >= this.config.maxFrames) {
      this.status = "UNCONFIRMED";
      this.rule = "persistence-frame-budget";
      this.reason = `frame budget (${this.config.maxFrames}) spent without ${this.config.requiredHits} hits in ${this.config.window} frames`;
    }
    this.log.push(rec);
    return rec;
  }

  next(): NextStep {
    if (this.status !== "PENDING") return { kind: "decided", decision: this.decision() };
    return { kind: "step-towards", step: this.config.step, reason: `${this.windowHits()}/${this.config.requiredHits} hits in window` };
  }

  exhaust(why: string, rule: ExhaustRule) {
    if (this.status === "PENDING") {
      this.status = "UNCONFIRMED";
      this.rule = rule;
      this.reason = why;
    }
  }

  decision(): CandidateDecision {
    return {
      status: this.status,
      reason: this.reason,
      rule: this.rule,
      support: this.windowHits(),
      against: this.misses,
      distinctViews: new Set(this.log.map((r) => r.cell)).size,
      attempts: this.frames,
    };
  }

  records() {
    return this.log;
  }
}
