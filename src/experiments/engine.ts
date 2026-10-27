// Orchestrates seeded missions in the browser: builds scenario worlds, runs a method's
// mission against the real sensor (render + COCO-SSD), then scores it with the evaluator.
// This is the experiment layer: it may read ground truth, but only to *score* results.
import { CocoSsdDetector, type TfBackend } from "@/perception/cocoSsd";
import { chooseBackend, type BackendChoice } from "@/perception/backend";
import { SensorRenderer } from "@/sim/sensorRenderer";
import { buildWorld, type BuiltWorld } from "@/sim/world";
import { ROUTE, type LayoutInfo, type LayoutVersion, type ScenarioInstance } from "@/scenarios/layout";
import { DEFAULT_LAYOUT, instantiateLayout, layoutRecord, type RecordedLayout } from "@/scenarios/generate";
import { BrowserSensor } from "@/mission/browserSensor";
import { MissionRunner, missionConfig } from "@/mission/runner";
import type { MissionConfig, MissionResult, MissionStep } from "@/mission/types";
import type { MethodId } from "@/policies/types";
import { evaluateMission, type TrialScore } from "@/eval/evaluate";
import { runJobs, type BatchFailure, type ErrorInfo } from "./batch";
import { readBuildMeta, type BuildMeta } from "@/provenance/build";
import { evaluatorObjects, type EvaluatorObjects } from "@/provenance/objects";
import { ARTIFACTS, describeProtocol, makeRunProvenance, measureRuntime, RUN_RECORD_SCHEMA, type ArtifactHashes, type Protocol, type RunProvenance, type RuntimeInfo } from "@/provenance/run";

export type { BatchFailure } from "./batch";

export interface RunRecord {
  /**
   * Record format. Absent on historical (pre-P1) records; every record written by this code has
   * it, together with `provenance` and `layout`.
   */
  recordSchema?: typeof RUN_RECORD_SCHEMA;
  /** Method plus any non-default parameters, e.g. "single-frame@0.7". */
  variant: string;
  result: MissionResult;
  score: TrialScore;
  /** Source, configuration, protocol, artifact and runtime provenance (src/provenance/run.ts). */
  provenance?: RunProvenance;
  /**
   * World layout: version, id, fallback flag and validation status. Written on every record that
   * has `recordSchema` (P1-e), including v1. Absent only on historical (pre-P1) records, where it
   * means v1 by the documented convention (scripts/layout-records.mjs).
   */
  layout?: RecordedLayout;
  /**
   * Evaluator-only object and asset provenance (P1-f): what stood in each slot of this world and its
   * asset file hash. Ground truth: written after the mission, never given to the robot.
   */
  objects?: EvaluatorObjects;
}

export interface Variant {
  method: MethodId;
  label: string;
  overrides?: Partial<MissionConfig>;
}

export function defaultVariant(method: MethodId): Variant {
  return { method, label: method };
}

/** Parses "single-frame@0.7" / "persistence@0.6" / "surestop" into a variant. */
export function parseVariant(spec: string): Variant {
  const [method, param] = spec.split("@") as [MethodId, string | undefined];
  if (!param) return defaultVariant(method);
  const tau = Number(param);
  if (!Number.isFinite(tau) || tau <= 0 || tau >= 1) throw new Error(`bad variant ${spec}`);
  const base = missionConfig(method);
  if (method === "single-frame") return { method, label: spec, overrides: { singleFrame: { threshold: tau } } };
  if (method === "persistence") return { method, label: spec, overrides: { persistence: { ...base.persistence, threshold: tau } } };
  throw new Error(`variant parameter not supported for ${method}`);
}

/** Batch-level provenance written next to `runs` by the diagnostics harness and the Lab. */
export interface BatchProvenance {
  schema: "surestop.batch-provenance/1";
  build: BuildMeta;
  artifacts: ArtifactHashes;
  runtime: RuntimeInfo;
  protocol: Protocol;
  /** Scenarios this batch file covers (not part of the protocol hash; see src/provenance/run.ts). */
  scenarios: string[];
}

export interface Prepared {
  inst: ScenarioInstance & { layout: LayoutInfo };
  world: BuiltWorld;
  sensor: BrowserSensor;
}

let sharedEngine: { key: string; promise: Promise<ExperimentEngine> } | null = null;

export class ExperimentEngine {
  private current: { key: string; prepared: Prepared } | null = null;
  /** Serialises world builds: a later prepare() never interleaves with (or disposes) an earlier one mid-build. */
  private building: Promise<unknown> = Promise.resolve();

  /**
   * Page-level singleton. TF.js backends are global, so concurrent initialisations (e.g. React
   * StrictMode double-mount, or navigating between Console and Lab) must share one engine.
   */
  static shared(backendOverride?: string | null): Promise<ExperimentEngine> {
    const key = backendOverride ?? "auto";
    if (!sharedEngine || sharedEngine.key !== key) {
      const promise = ExperimentEngine.create(backendOverride);
      sharedEngine = { key, promise };
      promise.catch(() => {
        if (sharedEngine?.promise === promise) sharedEngine = null;
      });
    }
    return sharedEngine.promise;
  }

  private constructor(
    readonly detector: CocoSsdDetector,
    readonly renderer: SensorRenderer,
    readonly backend: BackendChoice,
  ) {}

  static async create(backendOverride?: string | null): Promise<ExperimentEngine> {
    const backend = chooseBackend(backendOverride);
    const renderer = new SensorRenderer();
    const detector = await CocoSsdDetector.load("lite_mobilenet_v2", "/models/coco-ssd", backend.backend as TfBackend);
    return new ExperimentEngine(detector, renderer, backend);
  }

  /**
   * Builds (or reuses) the world for a scenario/seed/layout. Reuse keeps the per-pose sensor cache.
   * The default layout is v1, the layout of every recorded experiment.
   */
  prepare(scenarioId: string, seed: number, keepImages = false, layout: LayoutVersion = DEFAULT_LAYOUT): Promise<Prepared> {
    const next = this.building.then(() => this.prepareNow(scenarioId, seed, keepImages, layout));
    this.building = next.catch(() => undefined);
    return next;
  }

  private async prepareNow(scenarioId: string, seed: number, keepImages: boolean, layout: LayoutVersion): Promise<Prepared> {
    const key = `${scenarioId}:${seed}:${keepImages}:${layout}`;
    if (this.current?.key === key) return this.current.prepared;
    this.current?.prepared.world.dispose();
    this.current = null;
    const inst = instantiateLayout(scenarioId, seed, layout);
    const world = await buildWorld(inst, this.renderer);
    const sensor = new BrowserSensor(world.scene, this.renderer, this.detector, {
      targetClass: "potted plant",
      detectionFloor: missionConfig("surestop").detectionFloor,
      noiseSeed: seed,
      keepImages,
    });
    this.current = { key, prepared: { inst, world, sensor } };
    return this.current.prepared;
  }

  createRunner(p: Prepared, method: MethodId, overrides: Partial<MissionConfig> = {}): MissionRunner {
    return new MissionRunner(missionConfig(method, overrides), p.world.grid, ROUTE, p.inst.start, p.sensor, {
      scenarioId: p.inst.scenario.id,
      seed: p.inst.seed,
    });
  }

  score(p: Prepared, result: MissionResult): TrialScore {
    return evaluateMission(result, p.inst.objects, p.inst.scenario.targetPresent);
  }

  async runOne(
    scenarioId: string,
    seed: number,
    variant: Variant,
    onStep?: (s: MissionStep) => void | Promise<void>,
    layout: LayoutVersion = DEFAULT_LAYOUT,
    protocol: Protocol | null = null,
  ): Promise<RunRecord> {
    const p = await this.prepare(scenarioId, seed, false, layout);
    const runner = this.createRunner(p, variant.method, variant.overrides);
    const result = await runner.runToEnd(onStep);
    const rec: RunRecord = {
      recordSchema: RUN_RECORD_SCHEMA,
      variant: variant.label,
      result,
      score: this.score(p, result),
      provenance: await makeRunProvenance({ config: runner.cfg, protocol, runtime: this.runtime() }),
    };
    rec.layout = layoutRecord(p.inst.layout);
    rec.objects = evaluatorObjects(p.inst);
    return rec;
  }

  /** Runtime values measured in this page (user agent, cores, TF.js backend, GL renderer, detector). */
  runtime(): RuntimeInfo {
    return measureRuntime({ backend: this.backend, detector: this.detector.info });
  }

  /** Protocol of a batch spec: seeds, layout, every variant's effective-config hash, evaluator settings. */
  protocol(spec: { seeds: number[]; variants: Variant[]; layout?: LayoutVersion }): Promise<Protocol> {
    return describeProtocol({
      seeds: spec.seeds,
      layout: spec.layout ?? DEFAULT_LAYOUT,
      variants: spec.variants.map((v) => ({ label: v.label, method: v.method, config: missionConfig(v.method, v.overrides) })),
    });
  }

  batchProvenance(protocol: Protocol, scenarios: string[]): BatchProvenance {
    return { schema: "surestop.batch-provenance/1", build: readBuildMeta(), artifacts: ARTIFACTS, runtime: this.runtime(), protocol, scenarios: [...scenarios] };
  }

  /**
   * Runs every variant for each scenario/seed in turn (variants share the per-pose sensor cache).
   * A mission that throws is recorded in `failures` with its error and the batch continues; the
   * runs that completed are always returned.
   *
   * `skip` (resuming a checkpointed batch): jobs for which it returns true are not run. The
   * protocol is still built from the full spec, so a resumed batch keeps the same protocol hash.
   */
  async runBatch(
    spec: { scenarios: string[]; seeds: number[]; variants: Variant[]; layout?: LayoutVersion; skip?: (job: { scenarioId: string; seed: number; variant: string }) => boolean },
    cb: {
      onRun?: (r: RunRecord, done: number, total: number) => void | Promise<void>;
      onFailure?: (f: BatchFailure, done: number, total: number) => void | Promise<void>;
      shouldStop?: () => boolean;
    } = {},
  ): Promise<{ runs: RunRecord[]; failures: BatchFailure[]; provenance: BatchProvenance }> {
    const layout = spec.layout ?? DEFAULT_LAYOUT;
    const protocol = await this.protocol(spec);
    const jobs = spec.scenarios
      .flatMap((scenarioId) => spec.seeds.flatMap((seed) => spec.variants.map((v) => ({ scenarioId, seed, v }))))
      .filter((j) => !spec.skip?.({ scenarioId: j.scenarioId, seed: j.seed, variant: j.v.label }));
    // A failed mission carries the same provenance as a completed one, so it can be attributed.
    const toFailure = async (j: (typeof jobs)[number], e: ErrorInfo): Promise<BatchFailure> => ({
      scenarioId: j.scenarioId,
      seed: j.seed,
      variant: j.v.label,
      layout,
      ...e,
      provenance: await makeRunProvenance({ config: missionConfig(j.v.method, j.v.overrides), protocol, runtime: this.runtime() }),
    });
    const failed: BatchFailure[] = [];
    const { results, failures } = await runJobs(
      jobs,
      async ({ scenarioId, seed, v }) => {
        // Yield a macrotask between runs so the page stays responsive and progress can render.
        await new Promise((r) => setTimeout(r, 0));
        let steps = 0;
        return this.runOne(
          scenarioId,
          seed,
          v,
          async () => {
            if (++steps % 4 === 0) await new Promise((res) => setTimeout(res, 0));
          },
          spec.layout,
          protocol,
        );
      },
      {
        shouldStop: cb.shouldStop,
        onResult: cb.onRun,
        onFailure: async (j, error, done, total) => {
          const f = await toFailure(j, error);
          failed.push(f);
          await cb.onFailure?.(f, done, total);
        },
      },
    );
    if (failed.length !== failures.length) throw new Error("internal: failure bookkeeping mismatch");
    return { runs: results, failures: failed, provenance: this.batchProvenance(protocol, spec.scenarios) };
  }

  dispose(): void {
    this.current?.prepared.world.dispose();
    this.detector.dispose();
    this.renderer.dispose();
  }
}
