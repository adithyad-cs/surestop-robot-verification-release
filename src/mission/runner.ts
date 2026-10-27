// Mission runner: shared search behaviour + per-candidate stopping policy.
// Deterministic for a given sensor; simulated time never depends on inference latency.
// Robot-facing: it sees frames from the Sensor, its own pose and a label-free occupancy grid.
import { planPath } from "@/nav/astar";
import type { OccupancyGrid } from "@/nav/grid";
import { PersistencePolicy, SingleFramePolicy } from "@/policies/baselines";
import { SureStopPolicy } from "@/policies/sureStopPolicy";
import type { CandidatePolicy, MethodId, NextStep } from "@/policies/types";
import { DEFAULT_PLANNER, type NavQuery, type PlannedViewpoint } from "@/verify/planner";
import { DEFAULT_SURESTOP } from "@/verify/surestop";
import type { CandidateStatus, Pose2, Vec3 } from "@/verify/types";
import type {
  FrameConflictRecord,
  FramePurpose,
  FrameRecord,
  FrameTargetRecord,
  MissionConfig,
  MissionEvent,
  MissionMode,
  MissionOutcome,
  MissionResult,
  MissionTerminal,
  OutcomeRule,
  TerminationCause,
  MissionStep,
  RoutePoint,
  Sensor,
  SensorFrame,
} from "./types";

const DEG = Math.PI / 180;

export const DEFAULT_MISSION: Omit<MissionConfig, "method"> = {
  targetClass: "potted plant",
  detectionFloor: 0.3,
  associationGate: 0.9,
  observeEvery: 1.0,
  linearSpeed: 0.5,
  angularSpeed: 90,
  captureTime: 0.2,
  standOff: 0.9,
  maxSimTime: 480,
  maxFrames: 160,
  // Baseline thresholds selected on calibration seeds 101-110 (public/data/calibration.json):
  // best completion rate over all scenarios; ties to lower false-arrival rate, then lower τ.
  singleFrame: { threshold: 0.9 },
  persistence: { threshold: 0.8, requiredHits: 3, window: 4, maxConsecutiveMisses: 3, step: 0.5, maxFrames: 10 },
  surestop: DEFAULT_SURESTOP,
  planner: DEFAULT_PLANNER,
};

export function missionConfig(method: MethodId, overrides: Partial<MissionConfig> = {}): MissionConfig {
  const cfg: MissionConfig = { ...DEFAULT_MISSION, ...overrides, method };
  if (method === "surestop-1view" && !overrides.surestop) {
    cfg.surestop = { ...DEFAULT_SURESTOP, requiredSupport: 1, requiredAgainst: 1 };
  }
  if (method === "surestop-identity" && !overrides.surestop) {
    cfg.surestop = { ...DEFAULT_SURESTOP, identityConflict: true };
  }
  return cfg;
}

interface Track {
  id: string;
  pos: Vec3;
  sum: Vec3;
  n: number;
  createdAt: number;
  createdFrame: number;
  decidedAt: number | null;
  lastStatus: CandidateStatus;
  policy: CandidatePolicy;
  maxScore: number;
  /** The policy has acted on this candidate (moved for it or decided it). */
  engaged: boolean;
  /** Indices into MissionRunner.conflictObs already delivered to this candidate ("surestop-identity"). */
  conflictsSeen: Set<number>;
}

/** A localised confusable-class detection, kept for the whole mission ("surestop-identity"). */
interface ConflictObservation {
  frameId: number;
  t: number;
  robot: Pose2;
  cls: string;
  score: number;
  bbox: [number, number, number, number];
  pos: Vec3;
  record: FrameConflictRecord;
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

export class MissionRunner {
  private t = 0;
  private frameId = 0;
  private stepIndex = 0;
  private pose: Pose2;
  private mode: MissionMode = "SEARCHING";
  private routeIdx = 0;
  private path: Array<{ x: number; z: number }> = [];
  private scanQueue: number[] = [];
  private scanAt: { x: number; z: number } | null = null;
  private tracks: Track[] = [];
  private readonly conflictObs: ConflictObservation[] = [];
  private focus: Track | null = null;
  private approachTrack: Track | null = null;
  private readonly events: MissionEvent[] = [];
  private readonly frames: FrameRecord[] = [];
  private readonly traj: Array<[number, number, number, number]> = [];
  private lastTrajT = -Infinity;
  private pathLength = 0;
  private marginViolations = 0;
  private verificationFrames = 0;
  private inferenceMsTotal = 0;
  private cachedFrames = 0;
  private outcome: MissionOutcome | null = null;
  private terminal: MissionTerminal | null = null;
  private reason = "";
  private confirmed: Track | null = null;
  private readonly wallStart = Date.now();
  /** Cached sensor poses when this mission started (P1-g); null if the sensor does not say. */
  private readonly cacheAtStart: number | null;
  private wallEnd: number | null = null;
  readonly nav: NavQuery;

  constructor(
    readonly cfg: MissionConfig,
    private readonly grid: OccupancyGrid,
    private readonly route: RoutePoint[],
    start: Pose2,
    private readonly sensor: Sensor,
    readonly meta: { scenarioId: string; seed: number },
  ) {
    if (!route.length) throw new Error("empty search route");
    const cached = sensor.cacheEntries?.();
    this.cacheAtStart = typeof cached === "number" && Number.isFinite(cached) && cached >= 0 ? cached : null;
    this.pose = { ...start };
    this.recordPose(true);
    this.nav = {
      isFree: (x, z) => grid.isFree(x, z),
      pathLength: (a, b) => planPath(grid, a, b)?.length ?? null,
      lineOfSight: (a, b, stopShort) => grid.lineOfSight(a, b, stopShort),
    };
    this.event("mission", `mission started: ${cfg.method}, target class "${cfg.targetClass}"`, undefined, undefined, "SEARCHING");
  }

  get done(): boolean {
    return this.outcome !== null;
  }

  get currentPose(): Pose2 {
    return { ...this.pose };
  }

  get currentMode(): MissionMode {
    return this.mode;
  }

  // ---------------------------------------------------------------- stepping

  async step(): Promise<MissionStep> {
    const firstEvent = this.events.length;
    const segment: Pose2[] = [{ ...this.pose }];
    let frame: SensorFrame | null = null;
    let purpose: FramePurpose | null = null;
    let planned: Array<{ x: number; z: number }> | null = null;

    if (!this.outcome && (this.t >= this.cfg.maxSimTime || this.frameId >= this.cfg.maxFrames)) {
      // Both limits can be reached at once; the frame budget is then reported.
      const cause: TerminationCause = this.frameId >= this.cfg.maxFrames ? "frame-budget" : "time-budget";
      this.finish(null, `mission budget reached (${this.t.toFixed(0)} s, ${this.frameId} frames)`, cause);
    }
    if (!this.outcome) {
      const focus = this.focus;
      switch (this.mode) {
        case "SEARCHING":
        case "SCANNING": {
          const p = this.advanceSearch(segment);
          planned = this.path.length ? [{ x: this.pose.x, z: this.pose.z }, ...this.path] : null;
          if (p === "end") {
            this.finish(null, "search route completed", "route-completed");
            break;
          }
          purpose = p;
          frame = await this.capture(p, null);
          this.process(frame, null);
          this.decide();
          break;
        }
        case "VERIFYING": {
          planned = [{ x: this.pose.x, z: this.pose.z }, ...this.path];
          this.moveAlong(Infinity, segment);
          if (focus) this.face(focus.pos, segment);
          purpose = "verify";
          frame = await this.capture("verify", focus);
          this.verificationFrames++;
          this.process(frame, focus);
          this.decide();
          break;
        }
        case "PERSISTING": {
          if (focus) this.stepTowards(focus, this.cfg.persistence.step, segment);
          purpose = "persist";
          frame = await this.capture("persist", focus);
          this.verificationFrames++;
          this.process(frame, focus);
          this.decide();
          break;
        }
        case "APPROACHING": {
          planned = [{ x: this.pose.x, z: this.pose.z }, ...this.path];
          const target = this.approachTrack!;
          this.moveAlong(Infinity, segment);
          this.face(target.pos, segment);
          purpose = "arrival";
          frame = await this.capture("arrival", target);
          const d = Math.hypot(this.pose.x - target.pos.x, this.pose.z - target.pos.z);
          this.finish("ARRIVED", `arrived ${d.toFixed(2)} m from candidate ${target.id} after CONFIRMED`, "approach-complete");
          break;
        }
        case "DONE":
          break;
      }
    }
    return {
      index: this.stepIndex++,
      mode: this.mode,
      segment,
      frame,
      purpose,
      focusTrackId: this.focus?.id ?? this.approachTrack?.id ?? null,
      events: this.events.slice(firstEvent),
      plannedPath: planned,
      done: this.done,
    };
  }

  async runToEnd(onStep?: (s: MissionStep) => void | Promise<void>): Promise<MissionResult> {
    let guard = 0;
    while (!this.done) {
      const s = await this.step();
      if (onStep) await onStep(s);
      if (++guard > 10000) throw new Error("mission did not terminate");
    }
    return this.result();
  }

  abort(reason = "aborted by user"): void {
    if (!this.outcome) this.finish("ABORTED", reason, "user-abort");
  }

  // ---------------------------------------------------------------- search

  private advanceSearch(segment: Pose2[]): FramePurpose | "end" {
    for (let guard = 0; guard < 100; guard++) {
      if (this.scanQueue.length) {
        if (this.scanAt && Math.hypot(this.pose.x - this.scanAt.x, this.pose.z - this.scanAt.z) > 0.15) {
          if (!this.path.length) {
            const p = planPath(this.grid, this.pose, this.scanAt);
            if (!p) {
              this.event("navigation", "cannot return to scan point; scan abandoned");
              this.scanQueue = [];
              continue;
            }
            this.path = p.points.slice(1);
          }
          this.setMode("SEARCHING");
          this.moveAlong(this.cfg.observeEvery, segment);
          return "search";
        }
        const h = this.scanQueue.shift()!;
        this.setMode("SCANNING");
        this.turnTo(h * DEG, segment);
        return "scan";
      }
      this.setMode("SEARCHING");
      if (this.path.length) {
        const arrived = this.moveAlong(this.cfg.observeEvery, segment);
        if (arrived) this.arriveAtWaypoint();
        return "search";
      }
      if (this.routeIdx >= this.route.length) return "end";
      const wp = this.route[this.routeIdx];
      const p = planPath(this.grid, this.pose, wp);
      if (!p) {
        this.event("navigation", `waypoint ${this.routeIdx} unreachable; skipped`);
        this.routeIdx++;
        continue;
      }
      this.path = p.points.slice(1);
      if (p.length < 0.05) {
        this.path = [];
        this.arriveAtWaypoint();
      }
    }
    return "end";
  }

  private arriveAtWaypoint() {
    const wp = this.route[this.routeIdx];
    this.scanQueue = [...(wp.scan ?? [])];
    this.scanAt = { x: this.pose.x, z: this.pose.z };
    this.routeIdx++;
  }

  private resumeSearch(reason: string) {
    this.focus = null;
    this.path = [];
    this.setMode("SEARCHING", reason);
  }

  // ---------------------------------------------------------------- perception

  private async capture(purpose: FramePurpose, focus: Track | null): Promise<SensorFrame> {
    this.frameId++;
    this.t += this.cfg.captureTime;
    const f = await this.sensor.capture({ ...this.pose }, this.frameId, this.t);
    this.inferenceMsTotal += f.inferenceMs;
    if (f.cached) this.cachedFrames++;
    this.frames.push({
      frameId: f.frameId,
      t: round(f.t, 2),
      pose: [round(this.pose.x, 3), round(this.pose.z, 3), round(this.pose.theta, 4)],
      purpose,
      focusTrackId: focus?.id ?? null,
      detections: f.detections.filter((d) => d.score >= 0.3).map((d) => ({ cls: d.cls, score: round(d.score, 4), bbox: d.bbox.map((v) => round(v, 1)) as [number, number, number, number] })),
      targets: [],
      inferenceMs: round(f.inferenceMs, 1),
      cached: f.cached,
    });
    return f;
  }

  private process(frame: SensorFrame, focus: Track | null) {
    const rec = this.frames[this.frames.length - 1];
    const seen = new Set<Track>();
    const targets = [...frame.targets].sort((a, b) => b.detection.score - a.detection.score);
    /** Highest-scoring target-class detection in this frame that could not be localised (no usable depth). */
    let unlocalised: (typeof targets)[number] | null = null;
    const isSureStop = this.cfg.method === "surestop" || this.cfg.method === "surestop-1view" || this.cfg.method === "surestop-identity";
    if (this.cfg.method === "surestop-identity") this.recordConflicts(frame, rec);
    for (const obs of targets) {
      const tr: FrameTargetRecord = {
        score: round(obs.detection.score, 4),
        bbox: obs.detection.bbox.map((v) => round(v, 1)) as [number, number, number, number],
        excessRelief: obs.depth ? round(obs.depth.excessRelief, 4) : null,
        expectedNoise: obs.depth ? round(obs.depth.expectedNoise, 4) : null,
        twoPlaneFraction: obs.depth ? round(obs.depth.twoPlaneFraction, 3) : null,
        range: obs.depth ? round(obs.depth.medianDepth, 3) : null,
        position: obs.positionWorld ? [round(obs.positionWorld.x, 3), round(obs.positionWorld.z, 3)] : null,
        trackId: null,
        note: "",
      };
      rec.targets.push(tr);
      if (!obs.positionWorld) {
        tr.note = "no valid depth in box: not associated";
        unlocalised ??= obs;
        continue;
      }
      let track = this.associate(obs.positionWorld);
      if (!track) track = this.openTrack(obs.positionWorld, frame);
      tr.trackId = track.id;
      if (seen.has(track)) {
        tr.note = "second detection of the same candidate in this frame: ignored";
        continue;
      }
      seen.add(track);
      const status = track.policy.decision().status;
      if (status !== "PENDING") {
        tr.note = `candidate already ${status}: ignored`;
        continue;
      }
      track.sum = { x: track.sum.x + obs.positionWorld.x, y: track.sum.y + obs.positionWorld.y, z: track.sum.z + obs.positionWorld.z };
      track.n++;
      track.pos = { x: track.sum.x / track.n, y: track.sum.y / track.n, z: track.sum.z / track.n };
      track.maxScore = Math.max(track.maxScore, obs.detection.score);
      track.policy.setCandidatePosition(track.pos);
      // Conflicts first: a frame that carries both a confirming view and a conflicting identity must
      // not confirm on the view before the conflict is seen.
      this.deliverConflicts(track);
      if (track.policy.decision().status !== "PENDING") {
        tr.note = `candidate ${track.policy.decision().status}: ${track.policy.decision().reason}`;
        continue;
      }
      const ev = track.policy.observe({
        frameId: frame.frameId,
        t: frame.t,
        robot: frame.robot,
        detection: obs.detection,
        depth: obs.depth,
        positionWorld: obs.positionWorld,
      });
      tr.note = `${isSureStop ? `${ev.verdict}: ` : ""}${ev.reason}${ev.note ? ` (${ev.note})` : ""}`;
    }
    for (const t of this.tracks) this.deliverConflicts(t);
    if (focus && !seen.has(focus) && focus.policy.decision().status === "PENDING" && isSureStop && unlocalised) {
      // Something of the target class was detected but has no usable depth, so it can be neither
      // associated nor ruled out. Record it as a detection without depth evidence (INCONCLUSIVE,
      // never support), not as "not re-detected": it must not count towards a not-reproducible
      // rejection.
      const ev = focus.policy.observe({ frameId: frame.frameId, t: frame.t, robot: frame.robot, detection: unlocalised.detection, depth: null, positionWorld: null });
      this.event("candidate", `candidate ${focus.id}: target-class detection without usable depth from this viewpoint (${ev.reason}); not counted as a miss`, focus.id, frame.frameId);
    } else if (focus && !seen.has(focus) && focus.policy.decision().status === "PENDING") {
      const ev = focus.policy.observe({ frameId: frame.frameId, t: frame.t, robot: frame.robot, detection: null, depth: null, positionWorld: null });
      this.event("candidate", `candidate ${focus.id} not re-detected from this viewpoint (${ev.reason})`, focus.id, frame.frameId);
    }
    this.syncStatuses(frame.frameId);
  }

  /** Keeps this frame's localised confusable-class detections for the rest of the mission and records them. */
  private recordConflicts(frame: SensorFrame, rec: FrameRecord) {
    rec.conflicts = [];
    for (const c of frame.conflicts ?? []) {
      const r: FrameConflictRecord = {
        cls: c.detection.cls,
        score: round(c.detection.score, 4),
        bbox: c.detection.bbox.map((v) => round(v, 1)) as [number, number, number, number],
        range: c.depth ? round(c.depth.medianDepth, 3) : null,
        position: c.positionWorld ? [round(c.positionWorld.x, 3), round(c.positionWorld.z, 3)] : null,
        trackIds: [],
      };
      rec.conflicts.push(r);
      // Without depth it cannot be localised, so it can be associated with no candidate.
      if (c.positionWorld) {
        this.conflictObs.push({ frameId: frame.frameId, t: frame.t, robot: { ...frame.robot }, cls: c.detection.cls, score: c.detection.score, bbox: c.detection.bbox, pos: c.positionWorld, record: r });
      }
    }
  }

  /**
   * Delivers every not-yet-delivered conflict within the association gate of the candidate's current
   * estimate, from any frame of the mission (including frames before the candidate was opened).
   */
  private deliverConflicts(track: Track) {
    if (this.cfg.method !== "surestop-identity" || !(track.policy instanceof SureStopPolicy)) return;
    for (let i = 0; i < this.conflictObs.length; i++) {
      if (track.conflictsSeen.has(i)) continue;
      const c = this.conflictObs[i];
      const d = Math.hypot(track.pos.x - c.pos.x, track.pos.z - c.pos.z);
      if (d > this.cfg.associationGate) continue;
      track.conflictsSeen.add(i);
      c.record.trackIds.push(track.id);
      const used = track.policy.identityConflict({
        frameId: c.frameId,
        t: c.t,
        robot: c.robot,
        cls: c.cls,
        score: c.score,
        bbox: c.bbox,
        position: { x: c.pos.x, z: c.pos.z },
        distance: d,
      }).used;
      this.event(
        "candidate",
        `candidate ${track.id}: identity conflict, "${c.cls}" ${c.score.toFixed(2)} at ${d.toFixed(2)} m (frame ${c.frameId})${used ? "" : `; candidate already ${track.policy.decision().status}, not used`}`,
        track.id,
        this.frameId,
      );
    }
  }

  private associate(p: Vec3): Track | null {
    let best: Track | null = null;
    let bestD = this.cfg.associationGate;
    for (const t of this.tracks) {
      const d = Math.hypot(t.pos.x - p.x, t.pos.z - p.z);
      if (d <= bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  private openTrack(p: Vec3, frame: SensorFrame): Track {
    const id = `C${this.tracks.length + 1}`;
    const c = { x: p.x, z: p.z };
    let policy: CandidatePolicy;
    switch (this.cfg.method) {
      case "single-frame":
        policy = new SingleFramePolicy(this.cfg.singleFrame, c);
        break;
      case "persistence":
        policy = new PersistencePolicy(this.cfg.persistence, c);
        break;
      default:
        policy = new SureStopPolicy(this.cfg.method, this.cfg.surestop, this.cfg.planner, c, this.cfg.targetClass);
    }
    const track: Track = {
      id,
      pos: { ...p },
      sum: { x: 0, y: 0, z: 0 },
      n: 0,
      createdAt: frame.t,
      createdFrame: frame.frameId,
      decidedAt: null,
      lastStatus: "PENDING",
      policy,
      maxScore: 0,
      engaged: false,
      conflictsSeen: new Set(),
    };
    this.tracks.push(track);
    this.event("candidate", `candidate ${id} opened at (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`, id, frame.frameId, undefined, "PENDING");
    return track;
  }

  private syncStatuses(frameId?: number) {
    for (const tr of this.tracks) {
      const d = tr.policy.decision();
      if (d.status !== tr.lastStatus) {
        this.event("candidate", `candidate ${tr.id} ${d.status}: ${d.reason}`, tr.id, frameId, tr.lastStatus, d.status);
        tr.lastStatus = d.status;
        tr.decidedAt = this.t;
        tr.engaged = true;
      }
    }
  }

  // ---------------------------------------------------------------- decisions

  private decide() {
    const confirmed = this.tracks.find((t) => t.lastStatus === "CONFIRMED");
    if (confirmed) {
      this.startApproach(confirmed);
      return;
    }
    if (this.focus) {
      if (this.focus.lastStatus !== "PENDING") {
        this.resumeSearch(`candidate ${this.focus.id} ${this.focus.lastStatus}; resuming search`);
        return;
      }
      this.act(this.focus, this.focus.policy.next({ robot: this.pose, nav: this.nav }));
      return;
    }
    for (const tr of this.tracks) {
      if (tr.lastStatus !== "PENDING") continue;
      const n = tr.policy.next({ robot: this.pose, nav: this.nav });
      if (n.kind === "resume-search") continue;
      this.act(tr, n);
      if (this.focus || this.mode === "APPROACHING") return;
    }
  }

  private act(tr: Track, n: NextStep) {
    switch (n.kind) {
      case "decided": {
        this.syncStatuses();
        if (n.decision.status === "CONFIRMED") this.startApproach(tr);
        else if (this.focus === tr) this.resumeSearch(`candidate ${tr.id} ${n.decision.status}; resuming search`);
        return;
      }
      case "resume-search":
        if (this.focus === tr) this.resumeSearch(`candidate ${tr.id} left pending: ${n.reason}`);
        return;
      case "observe-from":
        tr.engaged = true;
        this.startVerify(tr, n.viewpoint);
        return;
      case "step-towards":
        tr.engaged = true;
        if (this.focus !== tr) {
          this.focus = tr;
          this.setMode("PERSISTING", `confirming candidate ${tr.id} by persistence (${n.reason})`);
        }
        return;
    }
  }

  private startVerify(tr: Track, vp: PlannedViewpoint) {
    const p = planPath(this.grid, this.pose, vp);
    if (!p) {
      tr.policy.exhaust("planned viewpoint became unreachable", "exhaust-viewpoint-unreachable");
      this.syncStatuses();
      this.resumeSearch(`candidate ${tr.id}: viewpoint unreachable`);
      return;
    }
    this.focus = tr;
    this.path = p.points.slice(1);
    const from = this.mode;
    this.mode = "VERIFYING";
    this.event("mission", `candidate ${tr.id}: re-observe from ${vp.cell} (${vp.reason})`, tr.id, undefined, from, "VERIFYING");
  }

  private startApproach(tr: Track) {
    if (this.approachTrack) return;
    this.focus = null;
    this.approachTrack = tr;
    this.confirmed = tr;
    const dx = this.pose.x - tr.pos.x, dz = this.pose.z - tr.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    const goal = this.grid.nearestFree(tr.pos.x + (dx / len) * this.cfg.standOff, tr.pos.z + (dz / len) * this.cfg.standOff, 1.0);
    const p = goal ? planPath(this.grid, this.pose, goal) : null;
    if (!p) {
      this.finish("NAV_FAILURE", `candidate ${tr.id} CONFIRMED but no reachable stand-off point`, "no-standoff");
      return;
    }
    this.path = p.points.slice(1);
    this.setMode("APPROACHING", `approaching CONFIRMED candidate ${tr.id}`);
  }

  private finish(outcome: MissionOutcome | null, why: string, cause: TerminationCause) {
    for (const tr of this.tracks) {
      if (tr.lastStatus === "PENDING" && tr.engaged) tr.policy.exhaust(`mission ended (${why})`, "exhaust-mission-ended");
    }
    this.syncStatuses();
    let rule: OutcomeRule;
    if (outcome) {
      this.outcome = outcome;
      this.reason = why;
      rule = outcome === "ARRIVED" ? "arrived-after-confirmation" : outcome === "NAV_FAILURE" ? "nav-failure-no-standoff" : "aborted";
    } else if (this.confirmed) {
      rule = "unresolved-confirmed-not-reached";
      // The budget ran out after a candidate was CONFIRMED but before the robot reached it. Arrival
      // was not declared, so this is not ARRIVED; a candidate was confirmed, so it is not NOT_FOUND.
      this.outcome = "UNRESOLVED";
      this.reason = `${why}; candidate ${this.confirmed.id} CONFIRMED but not reached: arrival not declared`;
    } else {
      const unresolved = this.tracks.filter((t) => t.lastStatus === "UNCONFIRMED");
      if (unresolved.length) {
        this.outcome = "UNRESOLVED";
        rule = "unresolved-unconfirmed-candidates";
        this.reason = `${why}; ${unresolved.length} candidate(s) UNCONFIRMED (${unresolved.map((t) => t.id).join(", ")}): arrival not declared`;
      } else {
        this.outcome = "NOT_FOUND";
        rule = "not-found";
        const rej = this.tracks.filter((t) => t.lastStatus === "REJECTED").length;
        this.reason = `${why}; no candidate confirmed${rej ? ` (${rej} rejected)` : ""}`;
      }
    }
    this.terminal = { schema: "surestop.terminal/1", cause, rule };
    this.focus = null;
    this.wallEnd = Date.now();
    this.setMode("DONE");
    this.event("mission", `mission ${this.outcome}: ${this.reason}`, undefined, undefined, undefined, this.outcome);
  }

  // ---------------------------------------------------------------- motion

  private setMode(mode: MissionMode, why?: string) {
    if (mode === this.mode) return;
    const from = this.mode;
    this.mode = mode;
    if (why || mode === "VERIFYING" || mode === "APPROACHING" || mode === "PERSISTING") {
      this.event("mission", why ?? mode, this.focus?.id ?? this.approachTrack?.id, undefined, from, mode);
    }
  }

  private recordPose(force = false) {
    if (force || this.t - this.lastTrajT >= 0.25) {
      this.traj.push([round(this.t, 2), round(this.pose.x, 3), round(this.pose.z, 3), round(this.pose.theta, 3)]);
      this.lastTrajT = this.t;
    }
    if (!this.grid.isFree(this.pose.x, this.pose.z)) this.marginViolations++;
  }

  private turnTo(theta: number, segment: Pose2[]) {
    const dt = 0.1;
    const rate = this.cfg.angularSpeed * DEG;
    for (let guard = 0; guard < 200; guard++) {
      const err = wrapAngle(theta - this.pose.theta);
      if (Math.abs(err) < 1e-3) break;
      const stepA = Math.sign(err) * Math.min(Math.abs(err), rate * dt);
      this.pose.theta = wrapAngle(this.pose.theta + stepA);
      this.t += (Math.abs(stepA) / rate) || dt;
      segment.push({ ...this.pose });
      this.recordPose();
    }
  }

  private face(p: { x: number; z: number }, segment: Pose2[]) {
    this.turnTo(Math.atan2(p.z - this.pose.z, p.x - this.pose.x), segment);
  }

  /** Moves along the current path for at most maxDist metres. Returns true when the path is complete. */
  private moveAlong(maxDist: number, segment: Pose2[]): boolean {
    let remaining = 0;
    let prev = { x: this.pose.x, z: this.pose.z };
    for (const p of this.path) {
      remaining += Math.hypot(p.x - prev.x, p.z - prev.z);
      prev = p;
    }
    // Do not leave a sliver (< 0.25 m) of path for a separate observation.
    let budget = remaining - maxDist < 0.25 ? remaining : maxDist;
    const dt = 0.1;
    while (this.path.length && budget > 1e-6) {
      const target = this.path[0];
      const dx = target.x - this.pose.x, dz = target.z - this.pose.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1e-4) {
        this.path.shift();
        continue;
      }
      const heading = Math.atan2(dz, dx);
      if (Math.abs(wrapAngle(heading - this.pose.theta)) > 3 * DEG) this.turnTo(heading, segment);
      const stepD = Math.min(dist, budget, this.cfg.linearSpeed * dt);
      this.pose.x += (dx / dist) * stepD;
      this.pose.z += (dz / dist) * stepD;
      this.pathLength += stepD;
      budget -= stepD;
      this.t += stepD / this.cfg.linearSpeed;
      segment.push({ ...this.pose });
      this.recordPose();
      if (stepD >= dist - 1e-6) this.path.shift();
    }
    return this.path.length === 0;
  }

  private stepTowards(tr: Track, step: number, segment: Pose2[]) {
    const dx = tr.pos.x - this.pose.x, dz = tr.pos.z - this.pose.z;
    const dist = Math.hypot(dx, dz);
    const move = Math.min(step, dist - this.cfg.standOff);
    if (move > 0.05) {
      const goal = { x: this.pose.x + (dx / dist) * move, z: this.pose.z + (dz / dist) * move };
      if (this.grid.segmentFree(this.pose, goal)) {
        this.path = [goal];
      } else {
        const p = planPath(this.grid, this.pose, goal);
        this.path = p ? p.points.slice(1) : [];
      }
      this.moveAlong(step + 0.5, segment);
      this.path = [];
    }
    this.face(tr.pos, segment);
  }

  // ---------------------------------------------------------------- output

  private event(kind: MissionEvent["kind"], message: string, trackId?: string, frameId?: number, from?: string, to?: string) {
    this.events.push({ t: round(this.t, 2), frameId, kind, trackId, from, to, message });
  }

  result(): MissionResult {
    return {
      schema: "surestop.mission/1",
      scenarioId: this.meta.scenarioId,
      seed: this.meta.seed,
      method: this.cfg.method,
      config: this.cfg,
      detector: this.sensor.detectorInfo,
      outcome: this.outcome ?? "ABORTED",
      reason: this.reason,
      terminal: this.terminal,
      confirmedTrackId: this.confirmed?.id ?? null,
      finalPose: { ...this.pose },
      tracks: this.tracks.map((t) => ({
        id: t.id,
        position: { x: round(t.pos.x, 3), y: round(t.pos.y, 3), z: round(t.pos.z, 3) },
        createdAt: t.createdAt,
        createdFrame: t.createdFrame,
        decidedAt: t.decidedAt,
        status: t.policy.decision().status,
        decision: t.policy.decision(),
        evidence: t.policy.records(),
        observations: t.n,
        maxScore: round(t.maxScore, 4),
        ...(t.policy instanceof SureStopPolicy && this.cfg.method === "surestop-identity" ? { identityConflicts: t.policy.verifier.identityConflicts() } : {}),
      })),
      frames: this.frames,
      events: this.events,
      trajectory: this.traj,
      stats: {
        simTime: round(this.t, 2),
        pathLength: round(this.pathLength, 2),
        frames: this.frameId,
        verificationFrames: this.verificationFrames,
        inferenceMsTotal: round(this.inferenceMsTotal, 1),
        cachedFrames: this.cachedFrames,
        marginViolations: this.marginViolations,
        wallClockMs: (this.wallEnd ?? Date.now()) - this.wallStart,
        sensorCacheEntriesAtStart: this.cacheAtStart,
        cacheState: this.cacheAtStart === null ? "unknown" : this.cacheAtStart === 0 ? "cold" : "warm",
      },
    };
  }
}

function round(v: number, d: number): number {
  const k = 10 ** d;
  return Math.round(v * k) / k;
}
