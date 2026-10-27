// A real ExperimentEngine whose prepare() builds the layout's prior grid and a fake sensor instead
// of a WebGL world, so runOne/runBatch run their real code paths in Node.
import { ExperimentEngine, type Prepared } from "@/experiments/engine";
import { instantiateLayout } from "@/scenarios/generate";
import type { LayoutVersion } from "@/scenarios/layout";
import { buildPriorGrid } from "@/scenarios/validate";
import { FakeLayoutSensor } from "./fakeMissions";

/** A real ExperimentEngine whose world is the fake-sensor layout (no WebGL). */
export function fakeEngine(): ExperimentEngine {
  const engine = Object.create(ExperimentEngine.prototype) as ExperimentEngine;
  Object.assign(engine, {
    backend: { backend: "wasm", reason: "test", glRenderer: null },
    detector: { info: { name: "coco-ssd", packageVersion: "2.2.3", tfjsVersion: "4.22.0", base: "lite_mobilenet_v2", backend: "wasm", loadMs: 0 } },
  });
  engine.prepare = async (scenarioId: string, seed: number, keepImages = false, layout: LayoutVersion = "v1") => {
    void keepImages;
    const inst = instantiateLayout(scenarioId, seed, layout);
    return { inst, world: { grid: buildPriorGrid(inst.objects), scene: null, objectRoots: new Map(), dispose() {} }, sensor: new FakeLayoutSensor([]) } as unknown as Prepared;
  };
  return engine;
}
