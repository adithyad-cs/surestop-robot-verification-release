import type { DepthFeatures } from "@/sensing/depthFeatures";
import type { CandidateObservation } from "@/verify/types";

export function features(p: Partial<DepthFeatures> = {}): DepthFeatures {
  return {
    samples: 1000,
    validFraction: 0.95,
    medianDepth: 1.6,
    nearDepth: 1.5,
    centroidCam: [0, 0, 1.6],
    planeRms: 0.12,
    expectedNoise: 0.012,
    excessRelief: 0.12,
    offPlaneFraction: 0.4,
    depthSpread: 0.3,
    planeIncidenceDeg: 20,
    truncated: false,
    dominantPlaneFraction: 0.3,
    twoPlaneFraction: 0.5,
    ...p,
  };
}

let frame = 0;
/** Observation of a candidate at the origin from robot position (x, z). */
export function obs(
  x: number,
  z: number,
  opts: { score?: number | null; depth?: Partial<DepthFeatures> | null; bbox?: [number, number, number, number] } = {},
): CandidateObservation {
  const score = opts.score === undefined ? 0.9 : opts.score;
  return {
    frameId: ++frame,
    t: frame * 0.5,
    robot: { x, z, theta: Math.atan2(-z, -x) },
    detection: score === null ? null : { cls: "potted plant", score, bbox: opts.bbox ?? [200, 120, 160, 220] },
    depth: opts.depth === null ? null : features(opts.depth ?? {}),
    positionWorld: { x: 0, y: 0.5, z: 0 },
  };
}

/** Robot position at a given range/bearing from the origin. */
export function at(range: number, bearingDeg: number): [number, number] {
  const r = (bearingDeg * Math.PI) / 180;
  return [range * Math.cos(r), range * Math.sin(r)];
}
