// Identity-conflict check (experimental, method "surestop-identity"): a confusable-class detection
// localised at a candidate withholds confirmation (UNCONFIRMED, never REJECTED). Synthetic inputs only.
import { describe, expect, it } from "vitest";
import { OccupancyGrid } from "@/nav/grid";
import { MissionRunner, missionConfig } from "@/mission/runner";
import type { Sensor, SensorFrame, TargetObservation } from "@/mission/types";
import type { MethodId } from "@/policies/types";
import { depthSigma } from "@/sensing/depthFeatures";
import { DEFAULT_SURESTOP, SureStopVerifier, sureStopConfigError } from "@/verify/surestop";
import { CONFUSABLE_CLASSES, confusableClasses } from "@/verify/identity";
import type { Pose2 } from "@/verify/types";
import { BOUNDS, ROUTE, WALLS, type PlacedObject } from "@/scenarios/layout";
import { evaluateMission } from "@/eval/evaluate";
import { at, features, obs } from "./helpers";

interface Conflict {
  score: number;
  /** Detections (1-based count of sightings of this object) on which the "vase" box is reported; all when absent. */
  on?: number[];
  /** Offset (m) of the conflicting detection's position from the object. */
  dx?: number;
  dz?: number;
  noDepth?: boolean;
}

interface FakeObject {
  x: number;
  z: number;
  relief: number;
  score: number;
  /** The first n sightings are reported only as "vase", not as the target class. */
  vaseOnlyFirst?: number;
  conflict?: Conflict;
}

/** Geometric fake sensor (FOV, range and wall occlusion from the grid); target and confusable detections. */
class FakeSensor implements Sensor {
  readonly detectorInfo = null;
  private seen = new Map<FakeObject, number>();
  constructor(private grid: OccupancyGrid, private objects: FakeObject[]) {}
  async capture(robot: Pose2, frameId: number, t: number): Promise<SensorFrame> {
    const targets: TargetObservation[] = [];
    const conflicts: TargetObservation[] = [];
    for (const o of this.objects) {
      const dx = o.x - robot.x, dz = o.z - robot.z;
      const range = Math.hypot(dx, dz);
      const off = Math.atan2(Math.sin(Math.atan2(dz, dx) - robot.theta), Math.cos(Math.atan2(dz, dx) - robot.theta));
      if (range > 5.5 || Math.abs(off) > (31 * Math.PI) / 180) continue;
      if (!this.grid.lineOfSight(robot, o, 0.5)) continue;
      const n = (this.seen.get(o) ?? 0) + 1;
      this.seen.set(o, n);
      const u = 320 + (off / ((31 * Math.PI) / 180)) * 250;
      const h = Math.min(400, 260 / Math.max(range, 0.5));
      const bbox: [number, number, number, number] = [u - h / 3, 200 - h / 2, (2 * h) / 3, h];
      const depth = features({ medianDepth: range, nearDepth: range, expectedNoise: depthSigma(range), excessRelief: o.relief, planeRms: Math.hypot(o.relief, depthSigma(range)) });
      if (!(o.vaseOnlyFirst && n <= o.vaseOnlyFirst)) {
        targets.push({ detection: { cls: "potted plant", score: o.score, bbox }, depth, positionWorld: { x: o.x, y: 0.5, z: o.z } });
      }
      const c = o.conflict;
      const vaseOnly = !!(o.vaseOnlyFirst && n <= o.vaseOnlyFirst);
      if (vaseOnly || (c && (!c.on || c.on.includes(n)))) {
        const noDepth = !vaseOnly && !!c?.noDepth;
        conflicts.push({
          detection: { cls: "vase", score: c?.score ?? 0.55, bbox: [bbox[0] + 5, bbox[1] + 20, bbox[2] * 0.5, bbox[3] * 0.6] },
          depth: noDepth ? null : depth,
          positionWorld: noDepth ? null : { x: o.x + (c?.dx ?? 0), y: 0.5, z: o.z + (c?.dz ?? 0) },
        });
      }
    }
    const detections = [...targets, ...conflicts].map((x) => x.detection);
    return { frameId, t, robot: { ...robot }, detections, targets, conflicts, inferenceMs: 1, renderMs: 0, cached: false };
  }
}

function grid(objs: FakeObject[]): OccupancyGrid {
  const g = new OccupancyGrid(BOUNDS, 0.1);
  WALLS.forEach((w) => g.addRect(w));
  for (const o of objs) g.addRect({ minX: o.x - 0.3, minZ: o.z - 0.3, maxX: o.x + 0.3, maxZ: o.z + 0.3 });
  g.inflate(0.32);
  return g;
}

const START = { x: -5.6, z: 3.4, theta: -Math.PI / 2 };
const PLANT: FakeObject = { x: 4.9, z: -3.4, relief: 0.13, score: 0.97 };
const VASE: FakeObject = { x: -3.4, z: -4.1, relief: 0.13, score: 0.85 };
const GT: PlacedObject[] = [
  { id: "vase", kind: "lookalike", label: "vase with flowers", model: { type: "asset", assetId: "vaseFlowers" }, x: VASE.x, z: VASE.z, yaw: 0 },
  { id: "plant", kind: "target", label: "plant", model: { type: "asset", assetId: "plant" }, x: PLANT.x, z: PLANT.z, yaw: 0 },
];

async function run(method: MethodId, objs: FakeObject[]) {
  const g = grid(objs);
  return new MissionRunner(missionConfig(method), g, ROUTE, START, new FakeSensor(g, objs), { scenarioId: "test", seed: 1 }).runToEnd();
}

const near = (t: { position: { x: number; z: number } }, o: FakeObject) => Math.hypot(t.position.x - o.x, t.position.z - o.z) < 0.5;

describe("identity-conflict check: verifier", () => {
  it("is refused unless the configuration enables it, so the baseline cannot receive conflicts", () => {
    const v = new SureStopVerifier(DEFAULT_SURESTOP, { x: 0, z: 0 }, "potted plant");
    expect(() => v.identityConflict({ frameId: 1, t: 0, robot: { x: 1, z: 0, theta: Math.PI }, cls: "vase", score: 0.6, bbox: [0, 0, 1, 1], position: { x: 0, z: 0 }, distance: 0 })).toThrow(/not enabled/);
    expect(v.decision().identityConflicts).toBeUndefined();
  });

  it("withholds confirmation as UNCONFIRMED (never REJECTED) and later views cannot overturn it", () => {
    const v = new SureStopVerifier({ ...DEFAULT_SURESTOP, identityConflict: true }, { x: 0, z: 0 }, "potted plant");
    v.observe(obs(...at(1.8, 0)));
    const c = v.identityConflict({ frameId: 99, t: 1, robot: { x: 1.8, z: 0, theta: Math.PI }, cls: "vase", score: 0.57, bbox: [0, 0, 1, 1], position: { x: 0.1, z: 0 }, distance: 0.1 });
    expect(c.used).toBe(true);
    const d = v.decision();
    expect([d.status, d.rule, d.identityConflicts]).toEqual(["UNCONFIRMED", "withhold-identity-conflict", 1]);
    expect(d.reason).toMatch(/identity conflict: the detector also reported "vase" \(0\.57\)/);
    v.observe(obs(...at(1.8, 90)));
    v.observe(obs(...at(1.8, 180)));
    expect(v.decision().status).toBe("UNCONFIRMED");
  });

  it("a conflict after a terminal decision is logged with used = false and changes nothing", () => {
    const v = new SureStopVerifier({ ...DEFAULT_SURESTOP, identityConflict: true }, { x: 0, z: 0 }, "potted plant");
    v.observe(obs(...at(1.8, 0)));
    v.observe(obs(...at(1.8, 90)));
    expect(v.decision().status).toBe("CONFIRMED");
    const c = v.identityConflict({ frameId: 5, t: 2, robot: { x: 0, z: 1.8, theta: 0 }, cls: "vase", score: 0.9, bbox: [0, 0, 1, 1], position: { x: 0, z: 0 }, distance: 0 });
    expect(c.used).toBe(false);
    expect(v.decision().status).toBe("CONFIRMED");
    expect(v.identityConflicts()).toHaveLength(1);
  });

  it("rejects a non-boolean identityConflict setting", () => {
    expect(sureStopConfigError({ ...DEFAULT_SURESTOP, identityConflict: "yes" as unknown as boolean })).toBe("identityConflict");
    expect(sureStopConfigError({ ...DEFAULT_SURESTOP, identityConflict: true })).toBeNull();
  });

  it("the confusable-class table has one entry and no supporting surfaces", () => {
    expect(CONFUSABLE_CLASSES).toEqual({ "potted plant": ["vase"] });
    expect(confusableClasses("chair")).toEqual([]);
  });

  it("the method's mission configuration differs from surestop only by the flag", () => {
    expect(missionConfig("surestop-identity").surestop).toEqual({ ...missionConfig("surestop").surestop, identityConflict: true });
  });
});

describe("identity-conflict check: missions (fake sensor)", () => {
  it("baseline SureStop confirms a volumetric look-alike labelled as the target: false arrival", async () => {
    const r = await run("surestop", [{ ...VASE, conflict: { score: 0.55 } }, PLANT]);
    expect(r.outcome).toBe("ARRIVED");
    expect(evaluateMission(r, GT, true).falseArrival).toBe(true);
  });

  it("surestop-identity withholds it, resumes the search and arrives at the genuine plant", async () => {
    const r = await run("surestop-identity", [{ ...VASE, conflict: { score: 0.55 } }, PLANT]);
    const vase = r.tracks.find((t) => near(t, VASE))!;
    expect([vase.status, vase.decision.rule]).toEqual(["UNCONFIRMED", "withhold-identity-conflict"]);
    expect(vase.identityConflicts!.filter((c) => c.used)).toHaveLength(1);
    expect(r.tracks.every((t) => t.status !== "REJECTED" || !near(t, VASE))).toBe(true);
    expect(r.outcome).toBe("ARRIVED");
    const s = evaluateMission(r, GT, true);
    expect([s.correctArrival, s.falseArrival]).toEqual([true, false]);
    expect(r.events.some((e) => e.kind === "candidate" && /identity conflict, "vase"/.test(e.message))).toBe(true);
    const f = r.frames.find((x) => x.conflicts?.length)!;
    expect(f.conflicts![0]).toMatchObject({ cls: "vase", score: 0.55 });
  });

  it("a conflict in the very frame that would confirm is applied before the view", async () => {
    const base = await run("surestop", [VASE, PLANT]);
    const confirmFrame = base.events.find((e) => e.kind === "candidate" && e.to === "CONFIRMED")!.frameId!;
    const vaseTrack = base.tracks.find((t) => near(t, VASE))!;
    expect(base.tracks.find((t) => t.status === "CONFIRMED")!.id).toBe(vaseTrack.id);
    // The sighting count of the vase on the confirming frame, from the baseline record.
    const sightings = base.frames.filter((f) => f.frameId <= confirmFrame && f.targets.some((x) => x.trackId === vaseTrack.id)).length;
    const r = await run("surestop-identity", [{ ...VASE, conflict: { score: 0.5, on: [sightings] } }, PLANT]);
    const vase = r.tracks.find((t) => near(t, VASE))!;
    expect(vase.status).toBe("UNCONFIRMED");
    expect(vase.identityConflicts!.find((c) => c.used)!.frameId).toBe(confirmFrame);
  });

  it("a conflict seen before the candidate was opened is associated once the candidate exists", async () => {
    const r = await run("surestop-identity", [{ ...VASE, vaseOnlyFirst: 1 }, PLANT]);
    const vase = r.tracks.find((t) => near(t, VASE))!;
    expect(vase.status).toBe("UNCONFIRMED");
    expect(vase.identityConflicts![0].frameId).toBeLessThan(vase.createdFrame);
  });

  it("a conflicting detection without depth cannot be localised: recorded, never associated", async () => {
    const r = await run("surestop-identity", [{ ...VASE, conflict: { score: 0.6, noDepth: true } }, PLANT]);
    const recs = r.frames.flatMap((f) => f.conflicts ?? []);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((c) => c.position === null && c.trackIds.length === 0)).toBe(true);
    // The limitation stays visible: without a localised conflict the look-alike is confirmed as before.
    expect(evaluateMission(r, GT, true).falseArrival).toBe(true);
  });

  it("a confusable detection outside the association gate does not affect a genuine plant", async () => {
    const r = await run("surestop-identity", [{ ...PLANT, conflict: { score: 0.7, dx: 1.5 } }]);
    expect(r.outcome).toBe("ARRIVED");
    expect(r.tracks.find((t) => t.status === "CONFIRMED")!.identityConflicts).toEqual([]);
  });

  it("baseline records are unchanged: no conflict fields on frames, tracks or decisions", async () => {
    const r = await run("surestop", [{ ...VASE, conflict: { score: 0.55 } }, PLANT]);
    expect(r.frames.every((f) => !("conflicts" in f))).toBe(true);
    expect(r.tracks.every((t) => !("identityConflicts" in t) && !("identityConflicts" in t.decision))).toBe(true);
  });
});

describe("Mission Control default method", () => {
  it("fresh visits and new-style links preselect surestop-identity; legacy links keep surestop", async () => {
    const { parseConsoleParams } = await import("@/console/params");
    expect(parseConsoleParams("").method).toBe("surestop-identity");
    expect(parseConsoleParams("?scenario=lookalike-3d&seed=123&layout=v2").method).toBe("surestop-identity");
    expect(parseConsoleParams("?scenario=lookalike-3d&seed=123").method).toBe("surestop");
    expect(parseConsoleParams("?scenario=lookalike-3d&seed=123&method=surestop&layout=v2").method).toBe("surestop");
  });
});

describe("Method page numbers", () => {
  it("the application copy of the development-matrix summary is byte-identical to the committed record", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "../..");
    const app = fs.readFileSync(path.join(root, "src/app/method/identity-matrix-summary.json"));
    const record = fs.readFileSync(path.join(root, "docs/experiments/identity-conflict/results/matrix-summary.json"));
    expect(app.equals(record)).toBe(true);
  });
});
