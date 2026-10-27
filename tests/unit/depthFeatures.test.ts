import { describe, expect, it } from "vitest";
import {
  applyDepthNoise,
  depthSigma,
  extractDepthFeatures,
  intrinsicsFromFov,
  smallestEigenvector,
} from "@/sensing/depthFeatures";
import { mulberry32 } from "@/lib/rng";

const intr = intrinsicsFromFov(160, 120, 50);

/** Depth image of an infinite plane n·X = d seen by the pinhole camera (camera frame: x right, y up, z forward). */
function planeDepth(n: [number, number, number], d: number): Float32Array {
  const out = new Float32Array(intr.width * intr.height);
  for (let v = 0; v < intr.height; v++) {
    for (let u = 0; u < intr.width; u++) {
      const rx = (u + 0.5 - intr.cx) / intr.fx;
      const ry = -(v + 0.5 - intr.cy) / intr.fy;
      const denom = n[0] * rx + n[1] * ry + n[2];
      out[v * intr.width + u] = d / denom; // z such that n·(rx z, ry z, z) = d
    }
  }
  return out;
}

describe("extractDepthFeatures", () => {
  it("measures ~zero relief on a fronto-parallel plane", () => {
    const f = extractDepthFeatures(planeDepth([0, 0, 1], 2), intr, [40, 30, 80, 60])!;
    expect(f.planeRms).toBeLessThan(1e-4);
    expect(f.excessRelief).toBe(0);
    expect(f.medianDepth).toBeCloseTo(2, 3);
    expect(f.planeIncidenceDeg).toBeLessThan(5);
  });

  it("measures ~zero relief on an oblique plane (viewing angle does not create relief)", () => {
    const n: [number, number, number] = [Math.sin(1), 0, Math.cos(1)]; // ~57° tilt
    const f = extractDepthFeatures(planeDepth(n, 2), intr, [40, 30, 80, 60])!;
    expect(f.planeRms).toBeLessThan(1e-3);
    expect(f.planeIncidenceDeg).toBeGreaterThan(40);
  });

  it("subtracts expected sensor noise from relief on a noisy plane", () => {
    const clean = planeDepth([0, 0, 1], 2);
    const noisy = applyDepthNoise(clean, mulberry32(3));
    const f = extractDepthFeatures(noisy, intr, [40, 30, 80, 60])!;
    expect(f.planeRms).toBeGreaterThan(0.5 * depthSigma(2));
    expect(f.planeRms).toBeLessThan(1.5 * depthSigma(2));
    expect(f.excessRelief).toBeLessThan(0.01);
  });

  it("reports large relief for a non-planar (stepped) surface", () => {
    const d = planeDepth([0, 0, 1], 2);
    for (let v = 0; v < intr.height; v++) for (let u = 0; u < intr.width; u += 2) d[v * intr.width + u] = 1.7;
    const f = extractDepthFeatures(d, intr, [40, 30, 80, 60])!;
    expect(f.excessRelief).toBeGreaterThan(0.1);
  });

  it("explains a flat occluder in front of a flat picture with two planes", () => {
    const d = planeDepth([0, 0, 1], 2.5);
    for (let v = 60; v < intr.height; v++) for (let u = 0; u < intr.width; u++) d[v * intr.width + u] = 1.5;
    const f = extractDepthFeatures(d, intr, [40, 30, 80, 60])!;
    // A single tilted plane cannot fit the step, so relief exceeds the volumetric threshold...
    expect(f.excessRelief).toBeGreaterThan(0.06);
    // ...but two flat planes explain every point, which the evidence rule treats as non-volumetric.
    expect(f.dominantPlaneFraction).toBeLessThan(0.8);
    expect(f.twoPlaneFraction).toBeGreaterThan(0.97);
  });

  it("does not explain a curved (volumetric) surface with two planes", () => {
    const d = new Float32Array(intr.width * intr.height);
    for (let v = 0; v < intr.height; v++) {
      for (let u = 0; u < intr.width; u++) {
        const x = (u - intr.cx) / 40, y = (v - intr.cy) / 40;
        d[v * intr.width + u] = 1.6 - 0.35 * Math.cos(x * 2.5) * Math.cos(y * 2.5);
      }
    }
    const f = extractDepthFeatures(d, intr, [20, 10, 120, 100])!;
    expect(f.excessRelief).toBeGreaterThan(0.06);
    expect(f.twoPlaneFraction).toBeLessThan(0.85);
  });

  it("produces identical features for identical inputs (deterministic RANSAC)", () => {
    const d = applyDepthNoise(planeDepth([0, 0, 1], 2), mulberry32(5));
    expect(extractDepthFeatures(d, intr, [40, 30, 80, 60])).toEqual(extractDepthFeatures(d, intr, [40, 30, 80, 60]));
  });

  it("flags truncation when the box touches the image border", () => {
    const f = extractDepthFeatures(planeDepth([0, 0, 1], 2), intr, [0, 30, 60, 60])!;
    expect(f.truncated).toBe(true);
  });

  it("rejects invalid inputs", () => {
    expect(() => extractDepthFeatures(new Float32Array(10), intr, [0, 0, 10, 10])).toThrow();
    expect(extractDepthFeatures(planeDepth([0, 0, 1], 2), intr, [10, 10, 0, 0])).toBeNull();
    expect(extractDepthFeatures(planeDepth([0, 0, 1], 2), intr, [NaN, 10, 20, 20])).toBeNull();
    expect(extractDepthFeatures(new Float32Array(intr.width * intr.height), intr, [40, 30, 80, 60])).toBeNull();
  });

  it("drops returns beyond max range when adding noise", () => {
    const d = new Float32Array([0, 5, 20, -1]);
    const n = applyDepthNoise(d, mulberry32(1));
    expect(n[0]).toBe(0);
    expect(n[1]).toBeGreaterThan(0);
    expect(n[2]).toBe(0);
    expect(n[3]).toBe(0);
  });

  it("is reproducible for a fixed noise seed", () => {
    const d = planeDepth([0, 0, 1], 2);
    expect(applyDepthNoise(d, mulberry32(9))).toEqual(applyDepthNoise(d, mulberry32(9)));
    expect(applyDepthNoise(d, mulberry32(9))).not.toEqual(applyDepthNoise(d, mulberry32(10)));
  });
});

describe("smallestEigenvector", () => {
  it("finds the normal of a covariance with one tiny axis", () => {
    const e = smallestEigenvector([4, 0, 0, 1, 0, 0.001]);
    expect(Math.abs(e[2])).toBeCloseTo(1, 6);
  });
  it("handles rotated covariances", () => {
    // Covariance of points spread in the x=y=z plane's orthogonal complement is smallest along (1,1,1)/√3.
    const a = 1, b = -0.5;
    const e = smallestEigenvector([a, b, b, a, b, a]);
    const s = 1 / Math.sqrt(3);
    expect(Math.abs(e[0] * s + e[1] * s + e[2] * s)).toBeCloseTo(1, 5);
  });
});
