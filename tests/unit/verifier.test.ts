import { describe, expect, it } from "vitest";
import { assessView, DEFAULT_EVIDENCE } from "@/verify/evidence";
import { SureStopVerifier, DEFAULT_SURESTOP } from "@/verify/surestop";
import { bearingDiff, viewpointCell, wrapDeg } from "@/verify/viewpoint";
import { at, obs } from "./helpers";

const origin = { x: 0, z: 0 };
const volumetric = { excessRelief: 0.12, planeRms: 0.12 };
const flat = { excessRelief: 0.004, planeRms: 0.012 };

describe("viewpoint cells", () => {
  it("bins range and bearing", () => {
    expect(viewpointCell({ x: 1.0, z: 0 }, origin).key).toBe("r1:b0");
    expect(viewpointCell({ x: 0, z: 1.6 }, origin).key).toBe("r2:b3");
    expect(viewpointCell({ x: -1, z: -0.001 }, origin).bearingDeg).toBeCloseTo(180, 0);
  });
  it("wraps and differences bearings", () => {
    expect(wrapDeg(-30)).toBe(330);
    expect(bearingDiff(350, 10)).toBe(20);
    expect(bearingDiff(0, 180)).toBe(180);
  });
});

describe("assessView", () => {
  it("is VOLUMETRIC for a well-observed relief", () => {
    expect(assessView(obs(...at(1.5, 0), { depth: volumetric })).verdict).toBe("VOLUMETRIC");
  });
  it("is FLAT for a planar surface", () => {
    expect(assessView(obs(...at(1.5, 0), { depth: flat })).verdict).toBe("FLAT");
  });
  it("is INCONCLUSIVE when far (depth noise too large)", () => {
    const a = assessView(obs(...at(4, 0), { depth: { ...volumetric, expectedNoise: 0.066 } }));
    expect(a.verdict).toBe("INCONCLUSIVE");
    expect(a.reason).toMatch(/noise/);
  });
  it("is INCONCLUSIVE when truncated, occluded, small, sparse, missing depth or missed", () => {
    expect(assessView(obs(1, 0, { depth: { truncated: true } })).verdict).toBe("INCONCLUSIVE");
    expect(assessView(obs(1, 0, { depth: { twoPlaneFraction: 0.95 } })).verdict).toBe("INCONCLUSIVE");
    expect(assessView(obs(1, 0, { bbox: [0, 0, 10, 10] })).verdict).toBe("INCONCLUSIVE");
    expect(assessView(obs(1, 0, { depth: { validFraction: 0.2 } })).verdict).toBe("INCONCLUSIVE");
    expect(assessView(obs(1, 0, { depth: null })).verdict).toBe("INCONCLUSIVE");
    expect(assessView(obs(1, 0, { score: null })).verdict).toBe("INCONCLUSIVE");
  });
  it("does not let a low detector score support the candidate", () => {
    const a = assessView(obs(1, 0, { score: DEFAULT_EVIDENCE.minScore - 0.1, depth: volumetric }));
    expect(a.verdict).toBe("INCONCLUSIVE");
  });
  it("treats relief between thresholds as INCONCLUSIVE", () => {
    expect(assessView(obs(1, 0, { depth: { excessRelief: 0.04 } })).verdict).toBe("INCONCLUSIVE");
  });
});

describe("SureStopVerifier", () => {
  it("confirms after volumetric evidence from two distinct viewpoints", () => {
    const v = new SureStopVerifier(DEFAULT_SURESTOP, origin, "potted plant");
    v.observe(obs(...at(1.5, 0), { depth: volumetric }));
    expect(v.decision().status).toBe("PENDING");
    v.observe(obs(...at(1.5, 70), { depth: volumetric }));
    const d = v.decision();
    expect(d.status).toBe("CONFIRMED");
    expect(d.support).toBe(2);
    expect(d.reason).toMatch(/2 distinct viewpoints/);
  });

  it("does not count repeated frames from the same viewpoint cell as new evidence", () => {
    const v = new SureStopVerifier(DEFAULT_SURESTOP, origin, "potted plant");
    for (let i = 0; i < 6; i++) v.observe(obs(...at(1.5 + i * 0.01, 5), { depth: volumetric }));
    expect(v.decision().status).toBe("PENDING");
    expect(v.decision().distinctViews).toBe(1);
    expect(v.records().filter((r) => r.counted)).toHaveLength(1);
    expect(v.records()[3].note).toMatch(/same viewpoint cell/);
  });

  it("rejects after flat evidence from two distinct viewpoints", () => {
    const v = new SureStopVerifier(DEFAULT_SURESTOP, origin, "potted plant");
    v.observe(obs(...at(1.5, 80), { depth: flat }));
    v.observe(obs(...at(1.5, 130), { depth: flat }));
    expect(v.decision().status).toBe("REJECTED");
  });

  it("keeps conflicting evidence pending and ends UNCONFIRMED when exhausted", () => {
    const v = new SureStopVerifier(DEFAULT_SURESTOP, origin, "potted plant");
    v.observe(obs(...at(1.5, 0), { depth: volumetric }));
    v.observe(obs(...at(1.5, 60), { depth: flat }));
    v.observe(obs(...at(1.5, 120), { depth: volumetric }));
    expect(v.decision().status).toBe("PENDING");
    expect(v.decision().reason).toMatch(/conflicting/);
    v.exhaust("viewpoint budget (4) spent", "exhaust-viewpoint-budget");
    expect(v.decision().status).toBe("UNCONFIRMED");
    expect(v.decision().reason).toMatch(/budget/);
  });

  it("bounds planned viewpoint attempts", () => {
    const v = new SureStopVerifier({ ...DEFAULT_SURESTOP, maxViewpoints: 4 }, origin, "potted plant");
    for (let i = 0; i < 4; i++) {
      expect(v.canAttempt()).toBe(true);
      v.registerAttempt();
      v.observe(obs(...at(1.5, i * 60), { depth: { excessRelief: 0.04 } }));
    }
    expect(v.canAttempt()).toBe(false);
  });

  it("cannot be re-decided after a terminal outcome (no stale confirmation)", () => {
    const v = new SureStopVerifier(DEFAULT_SURESTOP, origin, "potted plant");
    v.observe(obs(...at(1.5, 0), { depth: flat }));
    v.observe(obs(...at(1.5, 90), { depth: flat }));
    expect(v.decision().status).toBe("REJECTED");
    v.observe(obs(...at(1.5, 180), { depth: volumetric }));
    v.observe(obs(...at(1.5, 270), { depth: volumetric }));
    expect(v.decision().status).toBe("REJECTED");
    expect(v.records().at(-1)!.note).toMatch(/already REJECTED/);
    v.exhaust("late", "exhaust-mission-ended");
    expect(v.decision().status).toBe("REJECTED");
  });

  it("a fresh verifier starts with no state (reset semantics)", () => {
    const a = new SureStopVerifier(DEFAULT_SURESTOP, origin, "potted plant");
    a.observe(obs(...at(1.5, 0), { depth: volumetric }));
    const b = new SureStopVerifier(DEFAULT_SURESTOP, origin, "potted plant");
    expect(b.decision()).toMatchObject({ status: "PENDING", support: 0, against: 0, distinctViews: 0, attempts: 0 });
    b.observe(obs(...at(1.5, 90), { depth: volumetric }));
    expect(b.decision().status).toBe("PENDING");
  });

  it("requires a supporting view within the confirmation range", () => {
    const v = new SureStopVerifier({ ...DEFAULT_SURESTOP, confirmRange: 1.0 }, origin, "potted plant");
    v.observe(obs(...at(1.5, 0), { depth: volumetric }));
    v.observe(obs(...at(1.5, 90), { depth: volumetric }));
    expect(v.decision().status).toBe("PENDING");
    v.observe(obs(...at(0.9, 200), { depth: volumetric }));
    expect(v.decision().status).toBe("CONFIRMED");
  });

  it("lets a conclusive view replace an inconclusive vote in the same cell", () => {
    const v = new SureStopVerifier(DEFAULT_SURESTOP, origin, "potted plant");
    v.observe(obs(...at(1.6, 10), { depth: { truncated: true } }));
    const r = v.observe(obs(...at(1.65, 12), { depth: volumetric }));
    expect(r.counted).toBe(true);
    expect(v.records()[0].counted).toBe(false);
    expect(v.decision().support).toBe(1);
  });

  it("rejects a detection that cannot be reproduced from distinct viewpoints", () => {
    const v = new SureStopVerifier(DEFAULT_SURESTOP, origin, "potted plant");
    v.observe(obs(...at(3.5, 0), { depth: { expectedNoise: 0.05 } }));
    v.observe(obs(...at(2.0, 45), { score: null }));
    v.observe(obs(...at(2.0, 105), { score: null }));
    expect(v.decision().status).toBe("PENDING");
    v.observe(obs(...at(2.0, 165), { score: null }));
    expect(v.decision().status).toBe("REJECTED");
    expect(v.decision().reason).toMatch(/not re-detected from 3 distinct viewpoints/);
  });

  it("does not reject on misses when there is volumetric support", () => {
    const v = new SureStopVerifier(DEFAULT_SURESTOP, origin, "potted plant");
    v.observe(obs(...at(2.0, 15), { depth: volumetric }));
    for (const b of [75, 135, 195]) v.observe(obs(...at(2.0, b), { score: null }));
    expect(v.decision().status).toBe("PENDING");
    v.exhaust("budget", "exhaust-viewpoint-budget");
    expect(v.decision().status).toBe("UNCONFIRMED");
  });

  it("validates configuration and positions", () => {
    expect(() => new SureStopVerifier({ ...DEFAULT_SURESTOP, requiredSupport: 0 }, origin, "potted plant")).toThrow();
    const v = new SureStopVerifier(DEFAULT_SURESTOP, origin, "potted plant");
    expect(() => v.setCandidatePosition({ x: NaN, z: 0 })).toThrow();
  });

  it("single-view ablation confirms or rejects on one conclusive view", () => {
    const cfg = { ...DEFAULT_SURESTOP, requiredSupport: 1, requiredAgainst: 1 };
    const a = new SureStopVerifier(cfg, origin, "potted plant");
    a.observe(obs(...at(1.5, 0), { depth: volumetric }));
    expect(a.decision().status).toBe("CONFIRMED");
    const b = new SureStopVerifier(cfg, origin, "potted plant");
    b.observe(obs(...at(1.5, 0), { depth: flat }));
    expect(b.decision().status).toBe("REJECTED");
  });
});
