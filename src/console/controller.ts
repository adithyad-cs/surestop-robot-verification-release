// Mission Control controller: owns the experiment engine, a mission runner and playback.
// React subscribes through subscribe()/getState() (useSyncExternalStore).
import type { ExperimentEngine, Prepared } from "@/experiments/engine";
import type { MissionRunner } from "@/mission/runner";
import type { FrameConflictRecord, MissionEvent, MissionMode, MissionResult, MissionStep, SensorFrame } from "@/mission/types";
import type { TrialScore } from "@/eval/evaluate";
import type { MethodId } from "@/policies/types";
import type { Pose2 } from "@/verify/types";
import type { DetectorInfo } from "@/perception/types";
import type { BackendChoice } from "@/perception/backend";
import type { LayoutVersion } from "@/scenarios/layout";
import { layoutRecord, layoutSummary, type RecordedLayout } from "@/scenarios/generate";
import { makeRunProvenance, measureRuntime, type RunProvenance } from "@/provenance/run";
import { evaluatorObjects, type EvaluatorObjects } from "@/provenance/objects";
import { SceneView } from "./SceneView";
import { drawDepth, drawDetections } from "./draw";

export type Phase = "booting" | "ready" | "preparing" | "running" | "paused" | "done" | "error" | "unsupported";
export type Speed = 1 | 4 | 16 | "instant";

export interface FrameView {
  frameId: number;
  t: number;
  purpose: string | null;
  focusTrackId: string | null;
  pose: Pose2;
  detections: SensorFrame["detections"];
  targets: Array<{
    score: number;
    bbox: [number, number, number, number];
    relief: number | null;
    noise: number | null;
    twoPlane: number | null;
    range: number | null;
    trackId: string | null;
    note: string;
  }>;
  /**
   * Localised confusable-class detections ("surestop-identity" only). The runner's own frame records,
   * so candidates associated later (e.g. once a candidate opens) appear here too.
   */
  conflicts: FrameConflictRecord[];
  inferenceMs: number;
  cached: boolean;
  rgbUrl: string;
  depthUrl: string;
}

export interface ConsoleState {
  phase: Phase;
  stage: string;
  error: string | null;
  backend: BackendChoice | null;
  detector: DetectorInfo | null;
  scenarioId: string;
  seed: number;
  /** World-layout generator: v2 varies the layout with the seed; v1 is the recorded-evaluation layout. */
  layout: LayoutVersion;
  /** Content hash of the built layout (null until a world is built). */
  layoutId: string | null;
  /** Non-revealing description of the built layout (object count, start pose, lighting). */
  layoutSummary: string;
  /** Zone of each object (ground truth); shown only once the mission has ended. */
  layoutZones: Record<string, string> | null;
  /** Layout identity of the built world as recorded in exports (id, fallback, validation). */
  layoutRecord: RecordedLayout | null;
  /** Shown when a legacy link (no layout parameter) was opened with v1. */
  layoutNotice: string | null;
  /** The page URL was refused (unknown layout); no world is built. */
  rejected: boolean;
  method: MethodId;
  speed: Speed;
  mode: MissionMode | null;
  pose: Pose2 | null;
  simTime: number;
  frames: number;
  pathLength: number;
  tracks: MissionResult["tracks"];
  events: MissionEvent[];
  frameViews: FrameView[];
  selectedFrameId: number | null;
  /** Panels follow the newest frame until the user picks an earlier one (UI state only). */
  followLive: boolean;
  selectedTrackId: string | null;
  result: MissionResult | null;
  score: TrialScore | null;
  /** Provenance of the finished mission (P1); null until it is done. */
  provenance: RunProvenance | null;
  /** Evaluator-only object and asset provenance of the finished mission (P1-f); null until done. */
  objects: EvaluatorObjects | null;
  showGroundTruth: boolean;
}

const MAX_FRAME_VIEWS = 200;

export class ConsoleController {
  private state: ConsoleState;
  private readonly listeners = new Set<() => void>();
  private engine: ExperimentEngine | null = null;
  private prepared: Prepared | null = null;
  private runner: MissionRunner | null = null;
  private view: SceneView | null = null;
  private loopToken = 0;
  private bootToken = 0;
  private pauseRequested = false;
  private stepOnce = false;
  private resumeResolve: (() => void) | null = null;
  readonly reducedMotion: boolean;

  private loadToken = 0;

  constructor(init: { scenarioId: string; seed: number; method: MethodId; layout: LayoutVersion }) {
    this.reducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    this.state = {
      phase: "booting",
      stage: "Starting",
      error: null,
      backend: null,
      detector: null,
      ...init,
      layoutId: null,
      layoutSummary: "",
      layoutZones: null,
      layoutRecord: null,
      layoutNotice: null,
      rejected: false,
      speed: 4,
      mode: null,
      pose: null,
      simTime: 0,
      frames: 0,
      pathLength: 0,
      tracks: [],
      events: [],
      frameViews: [],
      selectedFrameId: null,
      followLive: true,
      selectedTrackId: null,
      result: null,
      score: null,
      provenance: null,
      objects: null,
      showGroundTruth: false,
    };
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = () => this.state;

  private set(patch: Partial<ConsoleState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  // ------------------------------------------------------------------ lifecycle

  async boot(
    container: HTMLElement,
    backendOverride: string | null,
    init?: Partial<Pick<ConsoleState, "scenarioId" | "seed" | "method" | "layout" | "layoutNotice">>,
  ) {
    if (this.view) return;
    const token = ++this.bootToken;
    if (init) this.set(init);
    try {
      const probe = document.createElement("canvas").getContext("webgl2");
      if (!probe) {
        this.set({ phase: "unsupported", error: "This browser does not provide WebGL2, which the simulator and depth sensor require." });
        return;
      }
      if (!probe.getExtension("EXT_color_buffer_float")) {
        this.set({ phase: "unsupported", error: "WebGL2 float render targets (EXT_color_buffer_float) are unavailable, so the depth sensor cannot run." });
        return;
      }
      probe.getExtension("WEBGL_lose_context")?.loseContext();
      this.view = new SceneView(container);
      this.set({ stage: "Loading detector weights (17 MB, cached after first visit)" });
      const { ExperimentEngine } = await import("@/experiments/engine");
      const engine = await ExperimentEngine.shared(backendOverride);
      if (token !== this.bootToken) return;
      this.engine = engine;
      this.set({ backend: engine.backend, detector: engine.detector.info });
      await this.loadScenario();
    } catch (e) {
      this.set({ phase: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** Refuses the page's parameters (e.g. an unknown layout): shows the reason and builds nothing. */
  reject(message: string, shown: Partial<Pick<ConsoleState, "scenarioId" | "seed" | "method">> = {}) {
    this.bootToken++;
    this.set({ ...shown, phase: "error", stage: "", error: message, rejected: true });
  }

  dispose() {
    this.bootToken++;
    this.loopToken++;
    this.resumeResolve?.();
    this.view?.setWorld(null);
    this.view?.dispose();
    // The engine is a shared page-level resource (see ExperimentEngine.shared); it is not disposed here.
    this.view = null;
    this.engine = null;
    this.runner = null;
    this.prepared = null;
  }

  /**
   * Builds the world for the current selection (after applying `patch`). The new selection and the
   * "preparing" phase are published in one state update, so no observer ever sees the new seed next
   * to the old world.
   */
  private async loadScenario(patch: Partial<ConsoleState> = {}) {
    if (!this.engine || !this.view) return;
    this.loopToken++;
    this.pauseRequested = false;
    this.resumeResolve?.();
    const token = ++this.loadToken;
    // Nothing from the previous world may remain usable or visible while the new one is built.
    this.prepared = null;
    this.runner = null;
    this.set({ ...patch, phase: "preparing", stage: "Building scene and loading 3-D assets", layoutId: null, layoutSummary: "", layoutZones: null, layoutRecord: null, result: null, score: null, provenance: null, objects: null });
    const want = { scenarioId: this.state.scenarioId, seed: this.state.seed, layout: this.state.layout };
    let prepared: Prepared;
    try {
      prepared = await this.engine.prepare(want.scenarioId, want.seed, true, want.layout);
    } catch (e) {
      // A failed build that has since been superseded must not overwrite the newer state.
      if (token === this.loadToken) this.set({ phase: "error", error: e instanceof Error ? e.message : String(e) });
      return;
    }
    // A newer scenario/seed/layout choice arrived while this world was being built.
    if (token !== this.loadToken || !this.view) return;
    const inst = prepared.inst;
    if (inst.scenario.id !== want.scenarioId || inst.seed !== want.seed || inst.layout.version !== want.layout) {
      this.set({ phase: "error", error: `internal: built ${inst.scenario.id}/${inst.seed}/${inst.layout.version}, expected ${want.scenarioId}/${want.seed}/${want.layout}` });
      return;
    }
    this.prepared = prepared;
    this.view.setWorld(prepared.world.scene);
    this.view.setRobot(inst.start);
    this.runner = this.engine.createRunner(prepared, this.state.method);
    this.set({
      phase: "ready",
      stage: "",
      // A successful rebuild (e.g. Reset after a failed mission step) clears the previous error.
      error: null,
      layoutId: inst.layout.id,
      layoutSummary: layoutSummary(inst),
      layoutZones: inst.layout.zones,
      layoutRecord: layoutRecord(inst.layout),
      mode: null,
      pose: inst.start,
      simTime: 0,
      frames: 0,
      pathLength: 0,
      tracks: [],
      events: [],
      frameViews: [],
      selectedFrameId: null,
      followLive: true,
      selectedTrackId: null,
      result: null,
      score: null,
      showGroundTruth: false,
    });
  }

  /**
   * Test hook (evaluator side, never given to the robot): compares the validator's analytic
   * navigation map with the world builder's grid for the built world, and re-runs the validator's
   * navigation checks on the real grid.
   */
  async gridCheck() {
    const p = this.prepared;
    if (!p) return null;
    const { buildPriorGrid, compareGrids, validateInstance } = await import("@/scenarios/validate");
    const cmp = compareGrids(buildPriorGrid(p.inst.objects), p.world.grid);
    const onWorld = validateInstance(p.inst, { navGrid: p.world.grid });
    return {
      layoutId: p.inst.layout.id,
      comparison: cmp,
      worldGridChecks: onWorld.checks.map((c) => ({ name: c.name, pass: c.pass, detail: c.detail })),
      objects: p.inst.objects.map((o) => ({ id: o.id, model: o.model.type === "asset" ? o.model.assetId : o.model.type, yawDeg: Math.round((o.yaw * 180) / Math.PI) })),
    };
  }

  /** True only if the built world is exactly the one the controls currently select. */
  worldMatchesSelection(): boolean {
    const p = this.prepared;
    return !!p && !!this.runner && p.inst.scenario.id === this.state.scenarioId && p.inst.seed === this.state.seed && p.inst.layout.version === this.state.layout;
  }

  async configure(patch: Partial<Pick<ConsoleState, "scenarioId" | "seed" | "method" | "layout">>) {
    if (this.state.phase === "running" || this.state.rejected) return;
    // Choosing a layout explicitly retires the legacy-link notice.
    const full = patch.layout ? { ...patch, layoutNotice: null } : patch;
    if (this.engine && this.view) await this.loadScenario(full);
    else this.set(full);
  }

  setSpeed(speed: Speed) {
    this.set({ speed });
  }

  async reset() {
    this.pauseRequested = false;
    this.resumeResolve?.();
    await this.loadScenario();
  }

  start() {
    if (!this.runner || !(this.state.phase === "ready" || this.state.phase === "paused")) return;
    if (!this.worldMatchesSelection()) return;
    if (this.state.phase === "paused") {
      this.pauseRequested = false;
      this.set({ phase: "running" });
      this.resumeResolve?.();
      return;
    }
    this.pauseRequested = false;
    void this.loop();
  }

  pause() {
    if (this.state.phase === "running") this.pauseRequested = true;
  }

  /** Executes exactly one mission step, then pauses. */
  step() {
    if (!this.runner || !this.worldMatchesSelection()) return;
    if (this.state.phase === "ready") {
      this.pauseRequested = true;
      void this.loop();
    } else if (this.state.phase === "paused") {
      this.stepOnce = true;
      this.set({ phase: "running" });
      this.resumeResolve?.();
    }
  }

  abort() {
    this.runner?.abort();
    if (this.state.phase === "paused") {
      this.pauseRequested = false;
      this.resumeResolve?.();
    }
  }

  select(patch: { frameId?: number | null; trackId?: string | null }) {
    const p: Partial<ConsoleState> = {};
    if (patch.frameId !== undefined) {
      const latest = this.state.frameViews[this.state.frameViews.length - 1]?.frameId ?? null;
      p.selectedFrameId = patch.frameId;
      p.followLive = patch.frameId === null || patch.frameId === latest;
    }
    if (patch.trackId !== undefined) p.selectedTrackId = patch.trackId;
    this.set(p);
    this.refreshMarkers();
    this.refreshCapturePose();
  }

  /** Return the camera, depth and evidence panels to the newest frame. */
  followLatest() {
    const latest = this.state.frameViews[this.state.frameViews.length - 1]?.frameId ?? null;
    this.set({ followLive: true, selectedFrameId: latest });
    this.refreshCapturePose();
  }

  /** The frame the panels show when it is an earlier frame than the newest one, else null. */
  historicalFrame(): FrameView | null {
    const s = this.state;
    if (s.followLive || s.selectedFrameId === null) return null;
    return s.frameViews.find((f) => f.frameId === s.selectedFrameId) ?? null;
  }

  /** Shows the capture-time pose of a selected earlier frame in the scene, so it never reads as the live pose. */
  private refreshCapturePose() {
    const f = this.historicalFrame();
    this.view?.setCapturePose(f ? f.pose : null, f ? `#${f.frameId} capture pose` : "");
  }

  toggleGroundTruth(on: boolean) {
    if (this.state.phase !== "done" || !this.prepared) return;
    this.set({ showGroundTruth: on });
    this.view?.setGroundTruth(
      on
        ? this.prepared.inst.objects
            .filter((o) => o.kind !== "furniture" && o.kind !== "obstacle")
            .map((o) => ({ id: o.id, x: o.x, z: o.z, label: o.label, isTarget: o.kind === "target" }))
        : null,
    );
  }

  // ------------------------------------------------------------------ loop

  private async loop() {
    const token = ++this.loopToken;
    try {
      await this.runLoop(token);
    } catch (e) {
      // A failed mission step must not leave the console "running" with no way out. The mission
      // has no outcome: nothing is scored, and the runner is dropped so it cannot be resumed.
      // Reset rebuilds the world and a fresh runner.
      if (token !== this.loopToken) return;
      this.loopToken++;
      this.runner = null;
      this.pauseRequested = false;
      this.stepOnce = false;
      const msg = e instanceof Error ? e.message : String(e);
      this.set({ phase: "error", error: `Mission step failed: ${msg}. No mission outcome was recorded; use Reset to rebuild the scenario.`, result: null, score: null });
    }
  }

  private async runLoop(token: number) {
    const runner = this.runner!;
    this.set({ phase: "running" });
    while (!runner.done && token === this.loopToken) {
      // Yield to the browser every step so input (Pause, Abort) and painting stay responsive.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      if (token !== this.loopToken) return;
      const s = await runner.step();
      if (token !== this.loopToken) return;
      await this.present(s, token);
      if (token !== this.loopToken) return;
      if (runner.done) break;
      if (this.pauseRequested || this.stepOnce) {
        this.stepOnce = false;
        this.set({ phase: "paused" });
        await new Promise<void>((r) => (this.resumeResolve = r));
        this.resumeResolve = null;
        if (token !== this.loopToken) return;
      }
    }
    if (token !== this.loopToken) return;
    const result = runner.result();
    const score = this.engine!.score(this.prepared!, result);
    // Same provenance blocks as a batch RunRecord; one console run belongs to no batch protocol.
    const engine = this.engine!;
    const provenance = await makeRunProvenance({ config: runner.cfg, protocol: null, runtime: measureRuntime({ backend: engine.backend, detector: engine.detector?.info ?? null }) });
    if (token !== this.loopToken) return;
    this.set({ phase: "done", result, score, tracks: result.tracks, mode: "DONE", provenance, objects: evaluatorObjects(this.prepared!.inst) });
    this.refreshMarkers();
  }

  private async present(s: MissionStep, token: number) {
    const view = this.view;
    if (view) {
      view.setPlannedPath(s.plannedPath);
      await this.animate(s.segment, token);
      const end = s.segment[s.segment.length - 1];
      view.setRobot(end);
    }
    const r = this.runner!.result();
    let frameViews = this.state.frameViews;
    if (s.frame && this.prepared) {
      const fr = r.frames[r.frames.length - 1];
      const sensor = this.prepared.sensor;
      const fv: FrameView = {
        frameId: s.frame.frameId,
        t: s.frame.t,
        purpose: s.purpose,
        focusTrackId: s.focusTrackId,
        pose: s.frame.robot,
        detections: s.frame.detections,
        targets: (fr?.targets ?? []).map((t) => ({
          score: t.score,
          bbox: t.bbox,
          relief: t.excessRelief,
          noise: t.expectedNoise,
          twoPlane: t.twoPlaneFraction,
          range: t.range,
          trackId: t.trackId,
          note: t.note,
        })),
        conflicts: fr?.conflicts ?? [],
        inferenceMs: s.frame.inferenceMs,
        cached: s.frame.cached,
        rgbUrl: sensor.lastImage ? drawDetections(sensor.lastImage, s.frame.detections, "potted plant") : "",
        depthUrl: sensor.lastDepth ? drawDepth(sensor.lastDepth, sensor.intr.width, sensor.intr.height, s.frame.targets.map((t) => t.detection.bbox)) : "",
      };
      frameViews = [...frameViews, fv].slice(-MAX_FRAME_VIEWS);
    }
    this.set({
      mode: s.mode,
      pose: this.runner!.currentPose,
      simTime: r.stats.simTime,
      frames: r.stats.frames,
      pathLength: r.stats.pathLength,
      tracks: r.tracks,
      events: r.events,
      frameViews,
      selectedFrameId: s.frame && this.state.followLive ? s.frame.frameId : this.state.selectedFrameId,
    });
    this.refreshMarkers();
    this.refreshCapturePose();
  }

  private refreshMarkers() {
    this.view?.setCandidates(
      this.state.tracks.map((t) => ({
        id: t.id,
        x: t.position.x,
        z: t.position.z,
        status: t.status,
        selected: t.id === this.state.selectedTrackId,
      })),
    );
  }

  private animate(seg: Pose2[], token: number): Promise<void> {
    const view = this.view;
    if (!view || seg.length < 2) return Promise.resolve();
    const speed = this.state.speed;
    if (speed === "instant" || this.reducedMotion) {
      for (const p of seg) view.setRobot(p);
      return Promise.resolve();
    }
    // Segment poses are 0.1 s of simulated time apart.
    const duration = ((seg.length - 1) * 100) / speed;
    return new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        if (token !== this.loopToken) return resolve();
        const k = Math.min(1, (performance.now() - t0) / duration);
        const f = k * (seg.length - 1);
        const i = Math.min(seg.length - 2, Math.floor(f));
        const a = seg[i], b = seg[i + 1], u = f - i;
        const dth = Math.atan2(Math.sin(b.theta - a.theta), Math.cos(b.theta - a.theta));
        view.setRobot({ x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, theta: a.theta + dth * u });
        if (k < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
  }
}
