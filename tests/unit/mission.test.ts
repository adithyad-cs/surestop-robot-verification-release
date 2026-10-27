import { describe, expect, it } from "vitest";
import { OccupancyGrid } from "@/nav/grid";
import { MissionRunner, missionConfig } from "@/mission/runner";
import type { Sensor, SensorFrame, TargetObservation } from "@/mission/types";
import type { MethodId } from "@/policies/types";
import { depthSigma, type DepthFeatures } from "@/sensing/depthFeatures";
import type { Pose2 } from "@/verify/types";
import { BOUNDS, ROUTE, WALLS, type PlacedObject } from "@/scenarios/layout";
import { evaluateMission } from "@/eval/evaluate";
import { candidateMetrics, missionMetrics, wilson, rate } from "@/eval/metrics";
import { parseCsv, trialsToCsv, TRIAL_CSV_COLUMNS, experimentToJson } from "@/eval/export";
import { features } from "./helpers";

interface FakeCandidate {
  x: number;
  z: number;
  /** Flat pictures face this direction (rad) and are only detected within ±60° of it. */
  facing?: number;
  relief: number;
  score: number;
  /** Overrides applied to the synthetic depth features (e.g. corrupted values). */
  depth?: Partial<DepthFeatures>;
  /** After this many detections, the candidate is still detected but has no usable depth. */
  noDepthAfter?: number;
  /** After this many detections, the candidate is no longer detected at all. */
  vanishAfter?: number;
}

/** Geometric fake sensor: FOV, range and wall occlusion from the grid; synthetic depth features. */
class FakeSensor implements Sensor {
  readonly detectorInfo = null;
  calls = 0;
  private detected = new Map<FakeCandidate, number>();
  constructor(private grid: OccupancyGrid, private cands: FakeCandidate[]) {}
  async capture(robot: Pose2, frameId: number, t: number): Promise<SensorFrame> {
    this.calls++;
    const targets: TargetObservation[] = [];
    for (const c of this.cands) {
      const dx = c.x - robot.x, dz = c.z - robot.z;
      const range = Math.hypot(dx, dz);
      const bearing = Math.atan2(dz, dx) - robot.theta;
      const off = Math.atan2(Math.sin(bearing), Math.cos(bearing));
      if (range > 5.5 || Math.abs(off) > (31 * Math.PI) / 180) continue;
      if (!this.grid.lineOfSight(robot, c, 0.5)) continue;
      if (c.facing !== undefined) {
        const view = Math.atan2(robot.z - c.z, robot.x - c.x) - c.facing;
        if (Math.abs(Math.atan2(Math.sin(view), Math.cos(view))) > Math.PI / 3) continue;
      }
      const n = (this.detected.get(c) ?? 0) + 1;
      if (c.vanishAfter !== undefined && n > c.vanishAfter) continue;
      this.detected.set(c, n);
      const noDepth = c.noDepthAfter !== undefined && n > c.noDepthAfter;
      const noise = depthSigma(range);
      const u = 320 + (off / ((31 * Math.PI) / 180)) * 250;
      const h = Math.min(400, 260 / Math.max(range, 0.5));
      targets.push({
        detection: { cls: "potted plant", score: c.score, bbox: [u - h / 3, 200 - h / 2, (2 * h) / 3, h] },
        depth: noDepth ? null : features({ medianDepth: range, nearDepth: range, expectedNoise: noise, excessRelief: c.relief, planeRms: Math.hypot(c.relief, noise), ...c.depth }),
        positionWorld: noDepth ? null : { x: c.x, y: 0.5, z: c.z },
      });
    }
    return { frameId, t, robot: { ...robot }, detections: targets.map((x) => x.detection), targets, inferenceMs: 1, renderMs: 0, cached: false };
  }
}

function layoutGrid(extra: Array<{ x: number; z: number; r: number }> = []): OccupancyGrid {
  const g = new OccupancyGrid(BOUNDS, 0.1);
  WALLS.forEach((w) => g.addRect(w));
  for (const e of extra) g.addRect({ minX: e.x - e.r, minZ: e.z - e.r, maxX: e.x + e.r, maxZ: e.z + e.r });
  g.inflate(0.32);
  return g;
}

const START = { x: -5.6, z: 3.4, theta: -Math.PI / 2 };
const POSTER: FakeCandidate = { x: -3.9, z: -4.85, facing: Math.PI / 2, relief: 0.003, score: 0.95 };
const PLANT: FakeCandidate = { x: 4.9, z: -3.4, relief: 0.13, score: 0.97 };
const GT: PlacedObject[] = [
  { id: "poster-w", kind: "picture-decoy", label: "print", model: { type: "poster", ofAsset: "plant", width: 0.6, height: 0.8 }, x: -3.9, z: -4.85, yaw: 0 },
  { id: "plant", kind: "target", label: "plant", model: { type: "asset", assetId: "plant" }, x: 4.9, z: -3.4, yaw: 0 },
];

async function run(method: MethodId, cands: FakeCandidate[], overrides = {}) {
  const grid = layoutGrid(cands.filter((c) => c.facing === undefined).map((c) => ({ x: c.x, z: c.z, r: 0.3 })));
  const sensor = new FakeSensor(grid, cands);
  const runner = new MissionRunner(missionConfig(method, overrides), grid, ROUTE, START, sensor, { scenarioId: "test", seed: 1 });
  return runner.runToEnd();
}

describe("MissionRunner (fake sensor)", () => {
  it("single-frame commits to the picture decoy: false arrival", async () => {
    const r = await run("single-frame", [POSTER, PLANT]);
    expect(r.outcome).toBe("ARRIVED");
    const s = evaluateMission(r, GT, true);
    expect(s.falseArrival).toBe(true);
    expect(s.arrivedAtKind).toBe("picture-decoy");
  });

  it("SureStop rejects the flat decoy from distinct viewpoints, then confirms the plant", async () => {
    const r = await run("surestop", [POSTER, PLANT]);
    expect(r.outcome).toBe("ARRIVED");
    const poster = r.tracks.find((t) => Math.abs(t.position.z + 4.85) < 0.3)!;
    expect(poster.status).toBe("REJECTED");
    expect(poster.decision.against).toBeGreaterThanOrEqual(2);
    const s = evaluateMission(r, GT, true);
    expect(s.correctArrival).toBe(true);
    expect(s.nonTargetEncountered).toBe(true);
    expect(r.stats.marginViolations).toBe(0);
    // Both candidate-level and mission-level transitions are logged.
    expect(r.events.some((e) => e.kind === "candidate" && e.to === "REJECTED")).toBe(true);
    expect(r.events.some((e) => e.kind === "mission" && e.to === "ARRIVED")).toBe(true);
  });

  it("decoys only: SureStop ends NOT_FOUND; single-frame falsely arrives", async () => {
    const a = await run("surestop", [POSTER]);
    expect(a.outcome).toBe("NOT_FOUND");
    expect(evaluateMission(a, GT.slice(0, 1), false).correctTerminal).toBe(true);
    const b = await run("single-frame", [POSTER]);
    expect(evaluateMission(b, GT.slice(0, 1), false).falseArrival).toBe(true);
  });

  it("ambiguous evidence exhausts the viewpoint budget: candidate UNCONFIRMED, mission UNRESOLVED", async () => {
    const r = await run("surestop", [{ ...PLANT, relief: 0.04 }]);
    expect(r.outcome).toBe("UNRESOLVED");
    const t = r.tracks[0];
    expect(t.status).toBe("UNCONFIRMED");
    expect(t.decision.attempts).toBeLessThanOrEqual(4);
    expect(evaluateMission(r, GT.slice(1), true).abstained).toBe(true);
  });

  it("enforces the mission frame budget", async () => {
    const r = await run("surestop", [POSTER, PLANT], { maxFrames: 5 });
    expect(r.stats.frames).toBeLessThanOrEqual(5);
    expect(["NOT_FOUND", "UNRESOLVED"]).toContain(r.outcome);
    expect(r.reason).toMatch(/budget/);
  });

  it("a confirmation on the last allowed frame ends UNRESOLVED, not NOT_FOUND or ARRIVED (D1)", async () => {
    const full = await run("surestop", [PLANT]);
    expect(full.outcome).toBe("ARRIVED");
    const confirmedAt = full.events.find((e) => e.kind === "candidate" && e.to === "CONFIRMED")!.frameId!;
    expect(confirmedAt).toBeLessThan(full.stats.frames);

    const cut = await run("surestop", [PLANT], { maxFrames: confirmedAt });
    expect(cut.stats.frames).toBe(confirmedAt);
    expect(cut.outcome).toBe("UNRESOLVED");
    expect(cut.reason).toMatch(/budget/);
    expect(cut.reason).toMatch(/C1 CONFIRMED but not reached: arrival not declared/);
    expect(cut.reason).not.toMatch(/no candidate confirmed/);
    expect(cut.confirmedTrackId).toBe("C1");
    expect(cut.tracks[0].status).toBe("CONFIRMED");
    const s = evaluateMission(cut, GT.slice(1), true);
    expect(s.correctArrival).toBe(false);
    expect(s.falseArrival).toBe(false);
    expect(s.arrivedAtKind).toBeNull();

    // One more frame lets the approach step run: the normal outcome is unchanged.
    const enough = await run("surestop", [PLANT], { maxFrames: confirmedAt + 1 });
    expect(enough.outcome).toBe("ARRIVED");
  });

  it("a detection without usable depth is not logged or counted as a miss (D4)", async () => {
    // Relief between the flat and volumetric thresholds: the first view is INCONCLUSIVE, so no
    // support exists and enough misses would reject the candidate as not reproducible.
    const ambiguous: FakeCandidate = { ...PLANT, relief: 0.04 };

    // Control: the candidate genuinely disappears. Misses still count and reject it.
    const gone = await run("surestop", [{ ...ambiguous, vanishAfter: 1 }]);
    expect(gone.tracks[0].status).toBe("REJECTED");
    expect(gone.tracks[0].decision.reason).toMatch(/not re-detected/);

    // Still detected, but with no usable depth: never a miss, never support.
    const noDepth = await run("surestop", [{ ...ambiguous, noDepthAfter: 1 }]);
    const t = noDepth.tracks[0];
    expect(t.status).not.toBe("REJECTED");
    expect(t.status).not.toBe("CONFIRMED");
    expect(t.decision.support).toBe(0);
    expect(t.decision.reason).toMatch(/, 0 not re-detected of /);
    expect(t.decision.reason).not.toMatch(/detection not reproducible/);
    const depthless = t.evidence.filter((e) => e.excessRelief === null);
    expect(depthless.length).toBeGreaterThan(0);
    for (const e of depthless) {
      expect(e.verdict).toBe("INCONCLUSIVE");
      expect(e.score).toBe(ambiguous.score);
      expect(e.reason).toMatch(/no usable depth/);
    }
    expect(t.evidence.some((e) => /not re-detected/.test(e.reason))).toBe(false);
    expect(noDepth.events.some((e) => /without usable depth.*not counted as a miss/.test(e.message))).toBe(true);
    expect(noDepth.outcome).not.toBe("ARRIVED");
  });

  it("is deterministic for identical inputs", async () => {
    const a = await run("surestop", [POSTER, PLANT]);
    const b = await run("surestop", [POSTER, PLANT]);
    const strip = (r: typeof a) => ({ ...r, stats: { ...r.stats, wallClockMs: 0 } });
    expect(strip(a)).toEqual(strip(b));
  });

  it("invalid depth evidence cannot cause a SureStop false arrival", async () => {
    // A picture decoy whose depth features are corrupted to look volumetric, with non-finite
    // fields that would otherwise slip past the thresholds.
    const corrupted: FakeCandidate = { ...POSTER, relief: 0.13, depth: { twoPlaneFraction: NaN, validFraction: NaN } };
    const a = await run("surestop", [corrupted]);
    expect(a.outcome).not.toBe("ARRIVED");
    expect(a.tracks.every((t) => t.status !== "CONFIRMED" && t.decision.support === 0)).toBe(true);
    expect(evaluateMission(a, GT.slice(0, 1), false).falseArrival).toBe(false);
    // With the genuine plant present, SureStop still arrives at the plant, not the decoy.
    const b = await run("surestop", [corrupted, PLANT]);
    expect(b.outcome).toBe("ARRIVED");
    expect(evaluateMission(b, GT, true).correctArrival).toBe(true);
  });

  it("persistence commits after K hits while approaching", async () => {
    const r = await run("persistence", [PLANT]);
    expect(r.outcome).toBe("ARRIVED");
    expect(r.tracks[0].decision.reason).toMatch(/of the last/);
  });
});

describe("metrics and export", () => {
  it("computes counts, denominators and Wilson intervals", async () => {
    const trials = [
      evaluateMission(await run("single-frame", [POSTER, PLANT]), GT, true),
      evaluateMission(await run("surestop", [POSTER, PLANT]), GT, true),
      evaluateMission(await run("surestop", [{ ...PLANT, relief: 0.04 }]), GT.slice(1), true),
    ];
    const m = missionMetrics(trials);
    expect(m.trials).toBe(3);
    expect(m.falseArrivalRate).toMatchObject({ num: 1, den: 2 });
    expect(m.correctConfirmationRate).toMatchObject({ num: 1, den: 3 });
    expect(m.abstentionRate).toMatchObject({ num: 1, den: 3 });
    expect(m.completionRate).toMatchObject({ num: 1, den: 3 });
    const c = candidateMetrics(trials);
    expect(c.byKind["picture-decoy"].encounters).toBe(2);
    expect(c.byKind["picture-decoy"].confirmed + c.byKind["picture-decoy"].rejected).toBe(2);
    expect(rate(0, 0, "x").value).toBeNull();
    expect(() => rate(3, 2, "x")).toThrow();
    const ci = wilson(5, 10)!;
    expect(ci[0]).toBeCloseTo(0.2366, 3);
    expect(ci[1]).toBeCloseTo(0.7634, 3);
  });

  it("CSV export round-trips every trial and column", async () => {
    const trials = [evaluateMission(await run("surestop", [POSTER, PLANT]), GT, true)];
    trials[0].scenarioId = 'odd, "quoted"\nname';
    const rows = parseCsv(trialsToCsv(trials));
    expect(rows[0]).toEqual([...TRIAL_CSV_COLUMNS]);
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe('odd, "quoted"\nname');
    expect(rows[1][3]).toBe("ARRIVED");
    expect(rows[1].length).toBe(TRIAL_CSV_COLUMNS.length);
  });

  it("JSON export contains full results and scores", async () => {
    const result = await run("surestop", [POSTER, PLANT]);
    const json = JSON.parse(experimentToJson([{ result, score: evaluateMission(result, GT, true) }], "test"));
    expect(json.schema).toBe("surestop.experiment/2");
    expect(json.runs[0].result.events.length).toBeGreaterThan(3);
    expect(json.runs[0].score.correctArrival).toBe(true);
  });
});
