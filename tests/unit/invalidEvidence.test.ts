// Invalid or missing evidence must fail closed: it can never count as volumetric support, so it can
// never help a candidate to CONFIRMED (and hence to ARRIVED). Valid-input behaviour is covered by
// verifier.test.ts and must not change.
import { describe, expect, it } from "vitest";
import { assessView } from "@/verify/evidence";
import { SureStopVerifier, DEFAULT_SURESTOP } from "@/verify/surestop";
import type { CandidateObservation } from "@/verify/types";
import { at, obs } from "./helpers";

const origin = { x: 0, z: 0 };
const volumetric = { excessRelief: 0.12, planeRms: 0.12 };
const flat = { excessRelief: 0.004, planeRms: 0.012 };
const NON_FINITE = [NaN, Infinity, -Infinity];
const DEPTH_KEYS = ["validFraction", "expectedNoise", "excessRelief", "twoPlaneFraction", "medianDepth"] as const;

/** A volumetric-looking observation from 1.5 m with one field replaced. */
function corrupt(patch: (o: CandidateObservation) => void, bearingDeg = 0): CandidateObservation {
  const o = obs(...at(1.5, bearingDeg), { depth: volumetric });
  patch(o);
  return o;
}

describe("assessView fails closed on invalid inputs", () => {
  it("baseline: the uncorrupted observation is VOLUMETRIC", () => {
    expect(assessView(corrupt(() => {})).verdict).toBe("VOLUMETRIC");
  });

  it("treats NaN and ±Infinity in any score, box or depth value as INCONCLUSIVE", () => {
    for (const bad of NON_FINITE) {
      expect(assessView(corrupt((o) => { o.detection!.score = bad; })).verdict).toBe("INCONCLUSIVE");
      for (const i of [0, 1, 2, 3]) {
        expect(assessView(corrupt((o) => { o.detection!.bbox[i] = bad; })).verdict).toBe("INCONCLUSIVE");
      }
      for (const key of DEPTH_KEYS) {
        const a = assessView(corrupt((o) => { o.depth![key] = bad; }));
        expect(a.verdict, `${key} = ${bad}`).toBe("INCONCLUSIVE");
        expect(a.reason).toMatch(/invalid/);
      }
    }
  });

  it("treats missing fields as INCONCLUSIVE", () => {
    const del = (o: object, k: string) => { delete (o as Record<string, unknown>)[k]; };
    expect(assessView(corrupt((o) => del(o.detection!, "score"))).verdict).toBe("INCONCLUSIVE");
    expect(assessView(corrupt((o) => del(o.detection!, "bbox"))).verdict).toBe("INCONCLUSIVE");
    expect(assessView(corrupt((o) => { o.detection!.bbox = [200, 120, 160] as unknown as [number, number, number, number]; })).verdict).toBe("INCONCLUSIVE");
    for (const key of [...DEPTH_KEYS, "truncated"]) {
      expect(assessView(corrupt((o) => del(o.depth!, key))).verdict, key).toBe("INCONCLUSIVE");
    }
  });

  it("treats out-of-range scores and depth values as INCONCLUSIVE, never VOLUMETRIC or FLAT", () => {
    const cases: Array<[string, (o: CandidateObservation) => void]> = [
      ["score > 1", (o) => { o.detection!.score = 1.5; }],
      ["score < 0", (o) => { o.detection!.score = -0.2; }],
      ["validFraction > 1", (o) => { o.depth!.validFraction = 1.5; }],
      ["validFraction < 0", (o) => { o.depth!.validFraction = -0.1; }],
      ["twoPlaneFraction > 1", (o) => { o.depth!.twoPlaneFraction = 1.2; }],
      ["twoPlaneFraction < 0", (o) => { o.depth!.twoPlaneFraction = -0.5; }],
      ["expectedNoise < 0", (o) => { o.depth!.expectedNoise = -0.01; }],
      ["excessRelief < 0 (would otherwise read FLAT)", (o) => { o.depth!.excessRelief = -0.1; }],
      ["medianDepth = 0", (o) => { o.depth!.medianDepth = 0; }],
      ["medianDepth < 0", (o) => { o.depth!.medianDepth = -1; }],
    ];
    for (const [name, patch] of cases) expect(assessView(corrupt(patch)).verdict, name).toBe("INCONCLUSIVE");
  });

  it("keeps valid boundary values valid", () => {
    expect(assessView(corrupt((o) => { o.detection!.score = 1; })).verdict).toBe("VOLUMETRIC");
    expect(assessView(corrupt((o) => { o.depth!.validFraction = 1; })).verdict).toBe("VOLUMETRIC");
    expect(assessView(corrupt((o) => { o.depth!.twoPlaneFraction = 0; })).verdict).toBe("VOLUMETRIC");
    expect(assessView(corrupt((o) => { o.depth!.excessRelief = 0; })).verdict).toBe("FLAT");
  });
});

describe("SureStopVerifier cannot be confirmed by invalid evidence", () => {
  it("one valid volumetric view plus a corrupted volumetric view from another cell stays PENDING", () => {
    for (const key of DEPTH_KEYS) {
      const v = new SureStopVerifier(DEFAULT_SURESTOP, origin, "potted plant");
      v.observe(obs(...at(1.5, 0), { depth: volumetric }));
      v.observe(corrupt((o) => { o.depth![key] = NaN; }, 90));
      expect(v.decision().status, key).toBe("PENDING");
      expect(v.decision().support).toBe(1);
    }
  });

  it("an invalid robot pose cannot create an extra viewpoint cell", () => {
    for (const bad of NON_FINITE) {
      const v = new SureStopVerifier(DEFAULT_SURESTOP, origin, "potted plant");
      v.observe(obs(...at(1.5, 0), { depth: volumetric }));
      const r = v.observe(corrupt((o) => { o.robot.x = bad; }, 90));
      expect(r.counted).toBe(false);
      expect(r.verdict).toBe("INCONCLUSIVE");
      expect(r.note).toMatch(/invalid robot pose or candidate position/);
      expect(v.decision()).toMatchObject({ status: "PENDING", support: 1, distinctViews: 1 });
    }
  });

  it("an invalid candidate position counts no evidence at all", () => {
    const v = new SureStopVerifier(DEFAULT_SURESTOP, { x: NaN, z: 0 }, "potted plant");
    for (const b of [0, 90, 180, 270]) v.observe(obs(...at(1.5, b), { depth: volumetric }));
    expect(v.decision()).toMatchObject({ status: "PENDING", support: 0, distinctViews: 0 });
    v.exhaust("viewpoint budget (4) spent", "exhaust-viewpoint-budget");
    expect(v.decision().status).toBe("UNCONFIRMED");
  });

  it("only corrupted views, from four distinct cells, end UNCONFIRMED (never CONFIRMED)", () => {
    const v = new SureStopVerifier(DEFAULT_SURESTOP, origin, "potted plant");
    [0, 90, 180, 270].forEach((b, i) => v.observe(corrupt((o) => { o.depth![DEPTH_KEYS[i]] = NaN; }, b)));
    expect(v.decision().support).toBe(0);
    v.exhaust("viewpoint budget (4) spent", "exhaust-viewpoint-budget");
    expect(v.decision().status).toBe("UNCONFIRMED");
  });

  it("conflicting signals: a corrupted 'volumetric' view cannot block a valid flat rejection", () => {
    const v = new SureStopVerifier(DEFAULT_SURESTOP, origin, "potted plant");
    v.observe(corrupt((o) => { o.depth!.twoPlaneFraction = NaN; }, 0));
    v.observe(obs(...at(1.5, 90), { depth: flat }));
    v.observe(obs(...at(1.5, 180), { depth: flat }));
    expect(v.decision().status).toBe("REJECTED");
    expect(v.decision().support).toBe(0);
  });

  it("an invalid view does not replace a valid conclusive vote in the same cell", () => {
    const v = new SureStopVerifier(DEFAULT_SURESTOP, origin, "potted plant");
    v.observe(obs(...at(1.5, 0), { depth: flat }));
    const r = v.observe(corrupt((o) => { o.depth!.expectedNoise = NaN; }, 2));
    expect(r.counted).toBe(false);
    expect(v.decision()).toMatchObject({ support: 0, against: 1 });
  });
});
