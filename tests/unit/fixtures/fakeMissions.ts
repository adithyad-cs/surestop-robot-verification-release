// Deterministic fake-sensor missions on real layouts (same geometric sensor as
// tests/unit/layoutMissions.test.ts and the Phase 2 comparison harness), with optional input
// faults to exercise every evidence-validity path end to end.
import { MissionRunner, missionConfig } from "@/mission/runner";
import type { MissionConfig, MissionResult, Sensor, SensorFrame, TargetObservation } from "@/mission/types";
import type { MethodId } from "@/policies/types";
import type { Pose2 } from "@/verify/types";
import type { OccupancyGrid } from "@/nav/grid";
import { depthSigma, type DepthFeatures } from "@/sensing/depthFeatures";
import { ROUTE, type LayoutVersion, type PlacedObject } from "@/scenarios/layout";
import { instantiateLayout } from "@/scenarios/generate";
import { buildPriorGrid, buildSightGrid, facing, isPicture, lookPoint, objectVisible } from "@/scenarios/validate";
import { features } from "../helpers";

const HALF_FOV = (31 * Math.PI) / 180;

export interface Faults {
  /** Every n-th detection of a candidate has no depth and no position. */
  dropDepthEvery?: number;
  /** Every n-th detection of a candidate has NaN valid-depth and two-plane fractions. */
  corruptEvery?: number;
  /** Every n-th detection of a candidate is reported with class "vase". */
  wrongClassEvery?: number;
}

interface Cand {
  obj: PlacedObject;
  sight: OccupancyGrid;
  facing?: number;
  relief: number;
  score: number;
}

function candidatesOf(objects: PlacedObject[]): Cand[] {
  return objects.flatMap((o): Cand[] => {
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

export class FakeLayoutSensor implements Sensor {
  readonly detectorInfo = null;
  private seen = new Map<string, number>();
  constructor(private cands: Cand[], private faults: Faults = {}) {}
  async capture(robot: Pose2, frameId: number, t: number): Promise<SensorFrame> {
    const targets: TargetObservation[] = [];
    for (const cand of this.cands) {
      const c = { ...lookPoint(cand.obj), facing: cand.facing };
      const dx = c.x - robot.x, dz = c.z - robot.z;
      const range = Math.hypot(dx, dz);
      const off = Math.atan2(Math.sin(Math.atan2(dz, dx) - robot.theta), Math.cos(Math.atan2(dz, dx) - robot.theta));
      if (range > 5.5 || Math.abs(off) > HALF_FOV) continue;
      if (!objectVisible(cand.sight, robot, cand.obj)) continue;
      if (c.facing !== undefined) {
        const view = Math.atan2(robot.z - c.z, robot.x - c.x) - c.facing;
        if (Math.abs(Math.atan2(Math.sin(view), Math.cos(view))) > Math.PI / 3) continue;
      }
      const n = (this.seen.get(cand.obj.id) ?? 0) + 1;
      this.seen.set(cand.obj.id, n);
      const every = (k?: number) => k !== undefined && n % k === 0;
      const noise = depthSigma(range);
      const u = 320 + (off / HALF_FOV) * 250;
      const h = Math.min(400, 260 / Math.max(range, 0.5));
      const drop = every(this.faults.dropDepthEvery);
      const corrupt: Partial<DepthFeatures> = every(this.faults.corruptEvery) ? { validFraction: NaN, twoPlaneFraction: NaN } : {};
      targets.push({
        detection: { cls: every(this.faults.wrongClassEvery) ? "vase" : "potted plant", score: cand.score, bbox: [u - h / 3, 200 - h / 2, (2 * h) / 3, h] },
        depth: drop ? null : features({ medianDepth: range, nearDepth: range, expectedNoise: noise, excessRelief: cand.relief, planeRms: Math.hypot(cand.relief, noise), ...corrupt }),
        positionWorld: drop ? null : { x: c.x, y: 0.5, z: c.z },
      });
    }
    return { frameId, t, robot: { ...robot }, detections: targets.map((x) => x.detection), targets, inferenceMs: 1, renderMs: 0, cached: false };
  }
}

export async function runFakeMission(scenarioId: string, seed: number, layout: LayoutVersion, method: MethodId, faults: Faults = {}, overrides: Partial<MissionConfig> = {}): Promise<MissionResult> {
  const inst = instantiateLayout(scenarioId, seed, layout);
  const runner = new MissionRunner(missionConfig(method, overrides), buildPriorGrid(inst.objects), ROUTE, inst.start, new FakeLayoutSensor(candidatesOf(inst.objects), faults), { scenarioId, seed });
  return runner.runToEnd();
}
