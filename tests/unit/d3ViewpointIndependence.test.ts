// D3: a moving candidate estimate must not turn one physical robot pose into two independent
// viewpoint votes. Fixture evidence only (synthetic observations), not a performance result.
import { describe, expect, it } from "vitest";
import { DEFAULT_SURESTOP, SureStopVerifier, sureStopConfigError, type SureStopConfig } from "@/verify/surestop";
import { replayCandidate } from "@/eval/recomputeEvidence";
import { GRID_RES } from "@/sim/navParams";
import { missionConfig } from "@/mission/runner";
import { at, obs } from "./helpers";

const DEG = Math.PI / 180;
const verifier = (cfg: SureStopConfig = DEFAULT_SURESTOP) => new SureStopVerifier(cfg, { x: 0, z: 0 }, "potted plant");
const LEGACY: SureStopConfig = { ...DEFAULT_SURESTOP, samePoseRadius: 0 };
/** The reproduction pose: 1.9 m from the first estimate at bearing 29° (bearing bin b0). */
const P = at(1.9, 29);
const DRIFT = { x: 0, z: -0.2 };
const flat = { depth: { excessRelief: 0.003 } };

describe("D3 reproduction: one pose, a drifting estimate", () => {
  it("legacy behaviour (radius 0) counts the same pose twice and confirms: the defect", () => {
    const v = verifier(LEGACY);
    const a = v.observe(obs(...P));
    v.setCandidatePosition(DRIFT);
    const b = v.observe(obs(...P));
    expect([a.cell, b.cell]).toEqual(["r2:b0", "r2:b1"]);
    expect([a.counted, b.counted]).toEqual([true, true]);
    expect(v.decision()).toMatchObject({ status: "CONFIRMED", support: 2, distinctViews: 2 });
  });

  it("the correction counts the same pose once; the record keeps its geometric cell and says why", () => {
    const v = verifier();
    v.observe(obs(...P));
    v.setCandidatePosition(DRIFT);
    const b = v.observe(obs(...P));
    expect(b.cell).toBe("r2:b1");
    expect(b.counted).toBe(false);
    expect(b.note).toMatch(/^same robot pose as frame \d+ \(0\.000 m apart\): viewpoint cell r2:b0; same viewpoint cell as frame \d+: not counted as new evidence$/);
    expect(v.decision()).toMatchObject({ status: "PENDING", support: 1, distinctViews: 1 });
    // The planner sees only cells that hold a vote; the merged observation adds none.
    expect([...v.usedCells()]).toEqual(["r2:b0"]);
  });

  it("the same holds for flat evidence (no reject-flat-evidence from one pose)", () => {
    const legacy = verifier(LEGACY);
    legacy.observe(obs(...P, flat));
    legacy.setCandidatePosition(DRIFT);
    legacy.observe(obs(...P, flat));
    expect(legacy.decision()).toMatchObject({ status: "REJECTED", rule: "reject-flat-evidence" });
    const v = verifier();
    v.observe(obs(...P, flat));
    v.setCandidatePosition(DRIFT);
    v.observe(obs(...P, flat));
    expect(v.decision()).toMatchObject({ status: "PENDING", against: 1 });
  });

  it("and for misses (no reject-not-reproducible from one pose)", () => {
    const miss = { score: null, depth: null };
    const legacy = verifier(LEGACY);
    const v = verifier();
    for (const x of [legacy, v]) {
      x.observe(obs(...P, miss));
      x.setCandidatePosition(DRIFT);
      x.observe(obs(...P, miss));
      x.setCandidatePosition({ x: -0.4, z: -0.2 }); // the pose is now 2.35 m away: range bin r3
      x.observe(obs(...P, miss));
    }
    expect(legacy.records().map((r) => r.cell)).toEqual(["r2:b0", "r2:b1", "r3:b0"]);
    expect(legacy.decision()).toMatchObject({ status: "REJECTED", rule: "reject-not-reproducible" });
    expect(v.decision()).toMatchObject({ status: "PENDING", distinctViews: 1 });
  });

  it("a same-pose view still competes in the earlier view's cell: a conclusive view replaces an inconclusive one", () => {
    const v = verifier();
    v.observe(obs(...P, { depth: { validFraction: 0.3 } })); // INCONCLUSIVE (too little valid depth)
    v.setCandidatePosition(DRIFT);
    const b = v.observe(obs(...P));
    expect(b.verdict).toBe("VOLUMETRIC");
    expect(b.counted).toBe(true);
    expect(b.note).toMatch(/viewpoint cell r2:b0; replaces inconclusive vote from frame \d+ in same cell/);
    expect(v.decision()).toMatchObject({ support: 1, distinctViews: 1 });
  });
});

describe("genuine distinct viewpoints still count", () => {
  it("distinct poses confirm despite estimate drift between them", () => {
    const v = verifier();
    v.observe(obs(...at(1.9, 15)));
    v.setCandidatePosition({ x: 0.15, z: -0.1 });
    v.observe(obs(...at(1.9, 105)));
    expect(v.decision()).toMatchObject({ status: "CONFIRMED", support: 2, distinctViews: 2 });
  });

  it("poses just beyond the radius are separate viewpoints when their cells differ (unchanged behaviour)", () => {
    // Two poses on either side of the 30° bearing boundary, 0.13 m apart (> 0.1 m).
    const a = at(1.9, 28);
    const b = at(1.9, 32);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeGreaterThan(GRID_RES);
    for (const cfg of [DEFAULT_SURESTOP, LEGACY]) {
      const v = verifier(cfg);
      v.observe(obs(...a));
      v.observe(obs(...b));
      expect(v.decision()).toMatchObject({ status: "CONFIRMED", distinctViews: 2 });
    }
  });

  it("every planner ring viewpoint pair is farther apart than the radius", () => {
    // Planned viewpoints sit at bearing-bin centres on rings of 1.9 and 2.2 m; the closest two in
    // different cells are 30° apart on the 1.9 m ring: 2 x 1.9 x sin(15°) = 0.98 m >> 0.1 m.
    expect(2 * 1.9 * Math.sin(15 * DEG)).toBeGreaterThan(9 * GRID_RES);
  });
});

describe("repeated observations from nearby poses", () => {
  it("poses within the radius straddling a cell boundary count once, even without drift", () => {
    const a = at(1.9, 29.9);
    const b = at(1.9, 30.5); // 0.02 m away, bearing bin b1
    const legacy = verifier(LEGACY);
    legacy.observe(obs(...a));
    legacy.observe(obs(...b));
    expect(legacy.decision()).toMatchObject({ status: "CONFIRMED", distinctViews: 2 });
    const v = verifier();
    v.observe(obs(...a));
    const r = v.observe(obs(...b));
    expect(r.cell).toBe("r2:b1");
    expect(r.counted).toBe(false);
    expect(v.decision()).toMatchObject({ status: "PENDING", distinctViews: 1 });
  });

  it("nearby poses in the same cell keep the existing rule: the lower-noise conclusive view wins", () => {
    const v = verifier();
    v.observe(obs(...at(1.9, 45), { depth: { expectedNoise: 0.02 } }));
    const better = v.observe(obs(...at(1.95, 45), { depth: { expectedNoise: 0.01 } }));
    expect(better.counted).toBe(true);
    expect(better.note).toMatch(/^replaces lower-quality vote/);
    expect(v.decision().distinctViews).toBe(1);
  });

  it("a pose is matched to the nearest earlier pose within the radius", () => {
    const v = verifier();
    v.observe(obs(1.9, 0.0)); // r2:b0
    v.observe(obs(...at(1.9, 31))); // r2:b1, 0.98 m from the first
    const r = v.observe(obs(...at(1.9, 31.5))); // 0.017 m from the second
    expect(r.note ?? "").not.toMatch(/same robot pose/);
    expect(v.decision().distinctViews).toBe(2);
  });
});

describe("existing confirmation, rejection and unresolved cases are unchanged", () => {
  it("confirm from two distinct cells", () => {
    const v = verifier();
    v.observe(obs(...at(1.9, 15)));
    v.observe(obs(...at(1.9, 105)));
    expect(v.decision()).toMatchObject({ status: "CONFIRMED", rule: "confirm-volumetric-support" });
  });

  it("reject flat from two distinct cells; reject not reproducible from three", () => {
    const f = verifier();
    f.observe(obs(...at(1.9, 15), flat));
    f.observe(obs(...at(1.9, 75), flat));
    expect(f.decision()).toMatchObject({ status: "REJECTED", rule: "reject-flat-evidence" });
    const m = verifier();
    for (const b of [15, 75, 135]) m.observe(obs(...at(1.9, b), { score: null, depth: null }));
    expect(m.decision()).toMatchObject({ status: "REJECTED", rule: "reject-not-reproducible" });
  });

  it("unresolved: conflicting evidence ends UNCONFIRMED when the budget is spent", () => {
    const v = verifier();
    v.observe(obs(...at(1.9, 15)));
    v.observe(obs(...at(1.9, 75), flat));
    v.exhaust("viewpoint budget (4) spent", "exhaust-viewpoint-budget");
    expect(v.decision()).toMatchObject({ status: "UNCONFIRMED", rule: "exhaust-viewpoint-budget", support: 1, against: 1 });
  });

  it("a non-finite pose still fails closed before the same-pose check", () => {
    const v = verifier();
    const r = v.observe({ ...obs(...P), robot: { x: NaN, z: 0, theta: 0 } });
    expect(r.invalidField).toBe("robot pose or candidate position");
    expect(v.decision().distinctViews).toBe(0);
  });
});

describe("configuration and replay", () => {
  it("the default radius is one navigation-grid cell and every SureStop mission config carries it", () => {
    expect(DEFAULT_SURESTOP.samePoseRadius).toBe(GRID_RES);
    expect(missionConfig("surestop").surestop.samePoseRadius).toBe(GRID_RES);
    expect(missionConfig("surestop-1view").surestop.samePoseRadius).toBe(GRID_RES);
  });

  it.each([NaN, -0.1, Infinity, "0.1"])("refuses samePoseRadius = %s", (bad) => {
    const cfg = { ...DEFAULT_SURESTOP, samePoseRadius: bad as number };
    expect(sureStopConfigError(cfg)).toBe("samePoseRadius");
    expect(() => verifier(cfg)).toThrow("invalid SureStop configuration: samePoseRadius");
  });

  it("absent or 0 means no check: older configurations (and records) replay as they were made", () => {
    const { samePoseRadius: _r, ...absent } = DEFAULT_SURESTOP;
    void _r;
    expect(sureStopConfigError(absent)).toBeNull();
    for (const cfg of [absent, LEGACY]) {
      const v = verifier(cfg);
      v.observe(obs(...P));
      v.setCandidatePosition(DRIFT);
      v.observe(obs(...P));
      expect(v.decision().status).toBe("CONFIRMED");
    }
  });

  it("offline replay reproduces both behaviours from the recorded inputs and the recorded config", () => {
    for (const cfg of [DEFAULT_SURESTOP, LEGACY]) {
      const v = verifier(cfg);
      v.observe(obs(...P));
      v.setCandidatePosition(DRIFT);
      v.observe(obs(...P));
      const replay = replayCandidate(v.records(), cfg, v.decision());
      expect(replay.decision).toEqual(v.decision());
      expect(replay.records.map((r) => [r.counted, r.note])).toEqual(v.records().map((r) => [r.counted, r.note]));
    }
  });
});
