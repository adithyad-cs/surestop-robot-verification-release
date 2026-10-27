// Geometric end-to-end check of the seeded (v2) layouts: the real MissionRunner, A* planner and
// SureStop/single-frame policies run on the layout's prior map with a geometric fake sensor (FOV,
// range, wall/furniture occlusion, synthetic depth relief). This tests navigation and the
// verification loop on every layout; it is not a perception result (the real-render runs are in
// docs/LAYOUT_VARIATION.md).
import { describe, expect, it } from "vitest";
import { MissionRunner, missionConfig } from "@/mission/runner";
import type { Sensor, SensorFrame, TargetObservation } from "@/mission/types";
import type { MethodId } from "@/policies/types";
import type { Pose2 } from "@/verify/types";
import type { OccupancyGrid } from "@/nav/grid";
import { depthSigma } from "@/sensing/depthFeatures";
import { ROUTE, SCENARIOS, type PlacedObject, type ScenarioInstance } from "@/scenarios/layout";
import { instantiateLayout } from "@/scenarios/generate";
import { buildPriorGrid, buildSightGrid, facing, isPicture, lookPoint, objectVisible } from "@/scenarios/validate";
import { evaluateMission } from "@/eval/evaluate";
import { features } from "./helpers";

const TEST_SEEDS = [0, 1, 2, 17, 42, 123];
const HALF_FOV = (31 * Math.PI) / 180;

interface FakeCandidate {
  /** Ground-truth object the fake detector reports (harness only; never passed to the robot). */
  obj: PlacedObject;
  /** Occupancy without this object, so its own footprint does not hide it (validator's model). */
  sight: OccupancyGrid;
  facing?: number;
  relief: number;
  score: number;
}

/** Candidates the fake detector can report; derived from the layout by the test harness only. */
function candidatesOf(objects: PlacedObject[]): FakeCandidate[] {
  return objects.flatMap((o): FakeCandidate[] => {
    const sight = buildSightGrid(objects, [o]);
    if (o.kind === "target") return [{ obj: o, sight, relief: 0.13, score: 0.97 }];
    if (o.kind === "lookalike") return [{ obj: o, sight, relief: 0.09, score: 0.8 }];
    if (isPicture(o)) {
      const n = facing(o);
      return [{ obj: o, sight, facing: Math.atan2(n.z, n.x), relief: 0.003, score: 0.95 }];
    }
    return [];
  });
}

class FakeSensor implements Sensor {
  readonly detectorInfo = null;
  constructor(private cands: FakeCandidate[]) {}
  async capture(robot: Pose2, frameId: number, t: number): Promise<SensorFrame> {
    const targets: TargetObservation[] = [];
    for (const cand of this.cands) {
      const c = { ...lookPoint(cand.obj), facing: cand.facing, relief: cand.relief, score: cand.score };
      const dx = c.x - robot.x, dz = c.z - robot.z;
      const range = Math.hypot(dx, dz);
      const off = Math.atan2(Math.sin(Math.atan2(dz, dx) - robot.theta), Math.cos(Math.atan2(dz, dx) - robot.theta));
      if (range > 5.5 || Math.abs(off) > HALF_FOV) continue;
      if (!objectVisible(cand.sight, robot, cand.obj)) continue;
      if (c.facing !== undefined) {
        const view = Math.atan2(robot.z - c.z, robot.x - c.x) - c.facing;
        if (Math.abs(Math.atan2(Math.sin(view), Math.cos(view))) > Math.PI / 3) continue;
      }
      const noise = depthSigma(range);
      const u = 320 + (off / HALF_FOV) * 250;
      const h = Math.min(400, 260 / Math.max(range, 0.5));
      targets.push({
        detection: { cls: "potted plant", score: c.score, bbox: [u - h / 3, 200 - h / 2, (2 * h) / 3, h] },
        depth: features({ medianDepth: range, nearDepth: range, expectedNoise: noise, excessRelief: c.relief, planeRms: Math.hypot(c.relief, noise) }),
        positionWorld: { x: c.x, y: 0.5, z: c.z },
      });
    }
    return { frameId, t, robot: { ...robot }, detections: targets.map((x) => x.detection), targets, inferenceMs: 1, renderMs: 0, cached: false };
  }
}

async function runOn(inst: ScenarioInstance, method: MethodId) {
  const grid = buildPriorGrid(inst.objects);
  const runner = new MissionRunner(missionConfig(method), grid, ROUTE, inst.start, new FakeSensor(candidatesOf(inst.objects)), { scenarioId: inst.scenario.id, seed: inst.seed });
  const result = await runner.runToEnd();
  return { result, score: evaluateMission(result, inst.objects, inst.scenario.targetPresent) };
}

describe("v2 layouts, geometric missions (real runner + A*, fake sensor)", () => {
  for (const s of SCENARIOS) {
    it(`${s.id}: SureStop terminates without navigation failure on seeds ${TEST_SEEDS.join(", ")}`, async () => {
      for (const seed of TEST_SEEDS) {
        const inst = instantiateLayout(s.id, seed, "v2");
        const { result, score } = await runOn(inst, "surestop");
        const tag = `${inst.layout.id} (seed ${seed}): ${result.outcome} — ${result.reason}`;
        expect(result.outcome, tag).not.toBe("NAV_FAILURE");
        expect(result.events.some((e) => /unreachable/.test(e.message)), tag).toBe(false);
        if (s.id === "lookalike-3d") continue; // depth cannot separate a 3-D look-alike (documented limitation)
        if (s.targetPresent) expect(score.correctArrival, tag).toBe(true);
        else expect(score.correctTerminal, tag).toBe(true);
        for (const l of score.trackLabels.filter((x) => x.kind !== "target")) expect(l.status, `${tag}: ${l.trackId}`).toBe("REJECTED");
      }
    }, 120_000);
  }

  for (const s of SCENARIOS.filter((x) => x.difficulty === "decoy")) {
    it(`${s.id}: the decoy is met first (single-frame stops at it) on every test seed`, async () => {
      for (const seed of TEST_SEEDS) {
        const inst = instantiateLayout(s.id, seed, "v2");
        const { result, score } = await runOn(inst, "single-frame");
        expect(score.falseArrival, `${inst.layout.id}: ${result.outcome} ${score.arrivedAtKind}`).toBe(true);
      }
    }, 120_000);
  }
});
