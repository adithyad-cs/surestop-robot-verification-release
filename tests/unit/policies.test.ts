import { describe, expect, it } from "vitest";
import { PersistencePolicy, SingleFramePolicy } from "@/policies/baselines";
import { SureStopPolicy } from "@/policies/sureStopPolicy";
import { planNextViewpoint, type NavQuery } from "@/verify/planner";
import { DEFAULT_SURESTOP } from "@/verify/surestop";
import { at, obs } from "./helpers";

const open: NavQuery = {
  isFree: () => true,
  pathLength: (a, b) => Math.hypot(a.x - b.x, a.z - b.z),
  lineOfSight: () => true,
};

describe("SingleFramePolicy", () => {
  it("commits on the first frame at or above threshold", () => {
    const p = new SingleFramePolicy({ threshold: 0.5 }, { x: 0, z: 0 });
    p.observe(obs(3, 0, { score: 0.45 }));
    expect(p.next().kind).toBe("resume-search");
    p.observe(obs(3, 0, { score: 0.5 }));
    const n = p.next();
    expect(n.kind).toBe("decided");
    expect(p.decision().status).toBe("CONFIRMED");
  });
});

describe("PersistencePolicy", () => {
  const cfg = { threshold: 0.5, requiredHits: 3, window: 4, maxConsecutiveMisses: 2, step: 0.5, maxFrames: 10 };
  it("confirms after K hits within the last N frames", () => {
    const p = new PersistencePolicy(cfg, { x: 0, z: 0 });
    p.observe(obs(3, 0, { score: 0.9 }));
    p.observe(obs(2.5, 0, { score: 0.9 }));
    p.observe(obs(2, 0, { score: null }));
    expect(p.decision().status).toBe("PENDING");
    expect(p.next().kind).toBe("step-towards");
    p.observe(obs(1.5, 0, { score: 0.9 }));
    expect(p.decision().status).toBe("CONFIRMED");
    expect(p.decision().reason).toMatch(/3 of the last 4/);
  });
  it("does not count hits that fell out of the window", () => {
    const p = new PersistencePolicy({ ...cfg, maxConsecutiveMisses: 5 }, { x: 0, z: 0 });
    for (const s of [0.9, 0.9, null, null, null, 0.9]) p.observe(obs(2, 0, { score: s }));
    expect(p.decision().status).toBe("PENDING");
  });
  it("rejects an invalid configuration", () => {
    expect(() => new PersistencePolicy({ ...cfg, window: 2 }, { x: 0, z: 0 })).toThrow();
  });
  it("drops the candidate after consecutive misses", () => {
    const p = new PersistencePolicy(cfg, { x: 0, z: 0 });
    p.observe(obs(3, 0, { score: 0.9 }));
    p.observe(obs(2.5, 0, { score: 0.2 }));
    p.observe(obs(2, 0, { score: null }));
    expect(p.decision().status).toBe("REJECTED");
  });
  it("ends UNCONFIRMED when the frame budget is spent", () => {
    const p = new PersistencePolicy({ ...cfg, maxFrames: 4, requiredHits: 4, window: 4, maxConsecutiveMisses: 9 }, { x: 0, z: 0 });
    for (let i = 0; i < 4; i++) p.observe(obs(3, 0, { score: i % 2 ? 0.9 : 0.1 }));
    expect(p.decision().status).toBe("UNCONFIRMED");
  });
});

describe("planNextViewpoint", () => {
  it("returns a reachable, unused viewpoint facing the candidate", () => {
    const vp = planNextViewpoint({ x: 0, z: 0 }, { x: 3, z: 0 }, new Set(), [], open)!;
    expect(vp).not.toBeNull();
    expect(Math.hypot(vp.x, vp.z)).toBeCloseTo(vp.range, 6);
    // Heading points from the viewpoint to the candidate.
    expect(Math.cos(vp.theta) * -vp.x + Math.sin(vp.theta) * -vp.z).toBeGreaterThan(0.99 * vp.range);
  });

  it("prefers a large bearing change from earlier views", () => {
    const vp = planNextViewpoint({ x: 0, z: 0 }, { x: 1.5, z: 0 }, new Set(["r2:b0", "r2:b11"]), [0], open)!;
    const change = Math.min(Math.abs(vp.bearingDeg), 360 - vp.bearingDeg);
    expect(change).toBeGreaterThanOrEqual(60);
  });

  it("places candidate viewpoints at bin centres, away from cell edges", () => {
    const vp = planNextViewpoint({ x: 0, z: 0 }, { x: 3, z: 0 }, new Set(), [], open)!;
    expect(vp.bearingDeg % 30).toBeCloseTo(15, 6);
    expect(vp.cell.startsWith("r2:")).toBe(true);
  });

  it("respects blocked space and line of sight", () => {
    const blocked: NavQuery = { ...open, isFree: (x) => x > 0, lineOfSight: (a) => a.z >= 0 };
    const vp = planNextViewpoint({ x: 0, z: 0 }, { x: 2, z: 0 }, new Set(), [], blocked)!;
    expect(vp.x).toBeGreaterThan(0);
    expect(vp.z).toBeGreaterThanOrEqual(0);
    const none = planNextViewpoint({ x: 0, z: 0 }, { x: 2, z: 0 }, new Set(), [], { ...open, isFree: () => false });
    expect(none).toBeNull();
  });
});

describe("SureStopPolicy", () => {
  it("plans viewpoints until the budget is spent, then reports UNCONFIRMED", () => {
    const p = new SureStopPolicy("surestop", { ...DEFAULT_SURESTOP, maxViewpoints: 3 }, undefined, { x: 0, z: 0 }, "potted plant");
    p.observe(obs(...at(4, 0), { depth: { expectedNoise: 0.07 } }));
    let robot = { x: 4, z: 0, theta: Math.PI };
    for (let i = 0; i < 3; i++) {
      const n = p.next({ robot, nav: open });
      expect(n.kind).toBe("observe-from");
      if (n.kind !== "observe-from") return;
      robot = { x: n.viewpoint.x, z: n.viewpoint.z, theta: n.viewpoint.theta };
      p.observe(obs(robot.x, robot.z, { depth: { excessRelief: 0.04 } }));
    }
    const final = p.next({ robot, nav: open });
    expect(final.kind).toBe("decided");
    expect(p.decision().status).toBe("UNCONFIRMED");
    expect(p.decision().reason).toMatch(/budget/);
  });

  it("reports UNCONFIRMED when no viewpoint is reachable", () => {
    const p = new SureStopPolicy("surestop", DEFAULT_SURESTOP, undefined, { x: 0, z: 0 }, "potted plant");
    p.observe(obs(...at(4, 0), { depth: { expectedNoise: 0.07 } }));
    const n = p.next({ robot: { x: 4, z: 0, theta: 0 }, nav: { ...open, pathLength: () => null } });
    expect(n.kind).toBe("decided");
    expect(p.decision().status).toBe("UNCONFIRMED");
  });
});
