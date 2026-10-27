// D7: a mission that throws must be recorded as a failure (never as an outcome), must not stop or
// erase the rest of a batch, and must not leave Mission Control stuck in "running".
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeError, runJobs } from "@/experiments/batch";
import { ExperimentEngine, type RunRecord, type Variant } from "@/experiments/engine";
import { ConsoleController, type ConsoleState } from "@/console/controller";
import type { MissionStep } from "@/mission/types";
import { instantiateLayout } from "@/scenarios/generate";
import { missionConfig } from "@/mission/runner";

describe("runJobs: per-mission error isolation", () => {
  it("records a failing job with its error, keeps earlier results and runs later jobs", async () => {
    const seen: string[] = [];
    const { results, failures } = await runJobs(
      [1, 2, 3],
      async (n) => {
        if (n === 2) throw new Error("render target lost");
        return n * 10;
      },
      {
        onResult: (r, done, total) => void seen.push(`ok ${r} ${done}/${total}`),
        onFailure: (j, e, done, total) => void seen.push(`fail ${j} ${e.error} ${done}/${total}`),
      },
    );
    expect(results).toEqual([10, 30]);
    expect(failures).toHaveLength(1);
    expect(failures[0].job).toBe(2);
    expect(failures[0].error.error).toBe("Error: render target lost");
    expect(failures[0].error.stack).toMatch(/render target lost/);
    expect(seen).toEqual(["ok 10 1/3", "fail 2 Error: render target lost 2/3", "ok 30 3/3"]);
  });

  it("without failures behaves as a plain sequential loop, and honours shouldStop", async () => {
    let n = 0;
    const all = await runJobs([1, 2, 3], async (x) => x);
    expect(all).toEqual({ results: [1, 2, 3], failures: [] });
    const stopped = await runJobs([1, 2, 3], async (x) => x, { shouldStop: () => ++n > 2 });
    expect(stopped.results).toEqual([1, 2]);
  });

  it("describes non-Error throws", () => {
    expect(describeError("plain")).toEqual({ error: "plain" });
  });
});

describe("ExperimentEngine.runBatch: a failed mission does not destroy the batch", () => {
  it("returns completed runs and a failure record with scenario, seed, variant, layout and error", async () => {
    const engine = Object.create(ExperimentEngine.prototype) as ExperimentEngine;
    Object.assign(engine, {
      backend: { backend: "wasm", reason: "test", glRenderer: null },
      detector: { info: { name: "coco-ssd", packageVersion: "2.2.3", tfjsVersion: "4.22.0", base: "lite_mobilenet_v2", backend: "wasm", loadMs: 0 } },
    });
    const fake = (scenarioId: string, seed: number, v: Variant) => ({ variant: v.label, result: { scenarioId, seed, outcome: "ARRIVED" }, score: {} }) as unknown as RunRecord;
    engine.runOne = async (scenarioId: string, seed: number, v: Variant) => {
      if (seed === 2 && v.label === "surestop") throw new Error("WebGL context lost");
      return fake(scenarioId, seed, v);
    };
    const failuresSeen: string[] = [];
    const { runs, failures, provenance } = await engine.runBatch(
      { scenarios: ["poster-decoy"], seeds: [1, 2, 3], variants: [{ method: "single-frame", label: "single-frame" }, { method: "surestop", label: "surestop" }] },
      { onFailure: (f, done, total) => void failuresSeen.push(`${f.seed} ${f.variant} ${done}/${total}`) },
    );
    expect(runs.map((r) => `${r.result.seed} ${r.variant}`)).toEqual(["1 single-frame", "1 surestop", "2 single-frame", "3 single-frame", "3 surestop"]);
    const surestopHash = provenance.protocol.descriptor.variants.find((v) => v.label === "surestop")!.missionConfigHash;
    expect(failures).toEqual([
      {
        scenarioId: "poster-decoy",
        seed: 2,
        variant: "surestop",
        layout: "v1",
        error: "Error: WebGL context lost",
        stack: expect.stringMatching(/WebGL context lost/),
        // P1: a failure carries the same provenance block as a completed run.
        provenance: expect.objectContaining({ missionConfigHash: surestopHash, protocolHash: provenance.protocol.hash }),
      },
    ]);
    expect(provenance.protocol.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(provenance.scenarios).toEqual(["poster-decoy"]);
    expect(failuresSeen).toEqual(["2 surestop 4/6"]);
  });
});

describe("Mission Control: a mission step that throws", () => {
  afterEach(() => vi.unstubAllGlobals());

  type Internals = { runner: unknown; engine: unknown; prepared: unknown; set(p: Partial<ConsoleState>): void };

  function controllerWith(step: (i: number) => Promise<MissionStep>, isDone: (i: number) => boolean) {
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 0));
    const c = new ConsoleController({ scenarioId: "clear-target", seed: 1, method: "surestop", layout: "v1" });
    let i = 0;
    const runner = {
      cfg: missionConfig("surestop"),
      get done() {
        return isDone(i);
      },
      currentPose: { x: 0, z: 0, theta: 0 },
      step: () => step(++i),
      result: () => ({ outcome: "ARRIVED", stats: { simTime: 0, frames: 0, pathLength: 0 }, tracks: [], events: [], frames: [] }),
    };
    const internals = c as unknown as Internals;
    internals.runner = runner;
    internals.engine = { score: () => ({ correctArrival: true }) };
    internals.prepared = { inst: { scenario: { id: "clear-target" }, seed: 1, layout: { version: "v1" }, objects: instantiateLayout("clear-target", 1, "v1").objects } };
    internals.set({ phase: "ready" });
    return c;
  }

  const okStep = (i: number): MissionStep => ({ index: i, mode: "SEARCHING", segment: [{ x: 0, z: 0, theta: 0 }], frame: null, purpose: null, focusTrackId: null, events: [], plannedPath: null, done: false });

  it("ends in the error phase with the reason, no outcome, and cannot be resumed", async () => {
    const c = controllerWith(async (i) => {
      if (i === 2) throw new Error("detector backend lost");
      return okStep(i);
    }, () => false);
    c.start();
    await vi.waitFor(() => expect(c.getState().phase).toBe("error"));
    const s = c.getState();
    expect(s.error).toMatch(/Mission step failed: detector backend lost/);
    expect(s.error).toMatch(/No mission outcome was recorded/);
    expect(s.result).toBeNull();
    expect(s.score).toBeNull();
    expect(c.worldMatchesSelection()).toBe(false);
    c.start();
    c.step();
    expect(c.getState().phase).toBe("error");
  });

  it("operator recovery: after a failed step, Reset rebuilds the scenario and a fresh mission can run", async () => {
    const inst = instantiateLayout("clear-target", 1, "v1");
    let built = 0;
    let fail = true;
    const c = controllerWith(async (i) => {
      if (fail && i === 1) throw new Error("detector backend lost");
      return okStep(i);
    }, (i) => !fail && i >= 2);
    const noop = () => undefined;
    const internals = c as unknown as Internals & { view: unknown };
    internals.view = { setWorld: noop, setRobot: noop, setCandidates: noop, setPlannedPath: noop, setGroundTruth: noop, setCapturePose: noop };
    const runner = internals.runner;
    internals.engine = {
      score: () => ({ correctArrival: true }),
      prepare: async () => (built++, { inst, world: { scene: {} }, sensor: {} }),
      createRunner: () => runner,
    };
    c.start();
    await vi.waitFor(() => expect(c.getState().phase).toBe("error"));
    fail = false;
    await c.reset();
    expect(built).toBe(1);
    expect(c.getState().phase).toBe("ready");
    expect(c.getState().error).toBeNull();
    expect(c.worldMatchesSelection()).toBe(true);
    c.start();
    await vi.waitFor(() => expect(c.getState().phase).toBe("done"));
    expect(c.getState().result?.outcome).toBe("ARRIVED");
  });

  it("a mission that completes normally still ends in the done phase with its result", async () => {
    const c = controllerWith(async (i) => okStep(i), (i) => i >= 3);
    c.start();
    await vi.waitFor(() => expect(c.getState().phase).toBe("done"));
    expect(c.getState().result?.outcome).toBe("ARRIVED");
    expect(c.getState().error).toBeNull();
    // P1: the finished console mission carries the same provenance blocks as a batch record.
    expect(c.getState().provenance).toMatchObject({ schema: "surestop.run-provenance/1", protocolHash: null, missionConfigHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(c.getState().objects!.objects.map((o) => o.objectId)).toContain("plant");
  });
});
