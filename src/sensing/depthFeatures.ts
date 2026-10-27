// Geometric evidence computed from the range (depth) image inside a detection box.
// Pure functions: no scene access, no labels. Inputs are measured depth + intrinsics.

export interface Intrinsics {
  width: number;
  height: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
}

export function intrinsicsFromFov(width: number, height: number, vfovDeg: number): Intrinsics {
  const fy = height / 2 / Math.tan((vfovDeg * Math.PI) / 360);
  return { width, height, fx: fy, fy, cx: width / 2, cy: height / 2 };
}

export interface DepthNoiseModel {
  /** Per-pixel noise standard deviation (m) at range z: sigma0 + k * z^2. */
  sigma0: number;
  k: number;
  /** Maximum valid range (m). Returns beyond it are dropped. */
  maxRange: number;
}

export const DEFAULT_DEPTH_NOISE: DepthNoiseModel = { sigma0: 0.002, k: 0.004, maxRange: 8 };

export function depthSigma(z: number, model: DepthNoiseModel = DEFAULT_DEPTH_NOISE): number {
  return model.sigma0 + model.k * z * z;
}

export interface DepthFeatures {
  /** Number of sampled pixels and fraction that returned a valid range. */
  samples: number;
  validFraction: number;
  /** Median range (m) to the sampled surface. */
  medianDepth: number;
  /** 25th-percentile range (m): the candidate's near surface, robust to background seen through gaps. */
  nearDepth: number;
  /** Centroid of sampled points in camera frame (x right, y up, z forward), metres. */
  centroidCam: [number, number, number];
  /** RMS distance (m) of points to the best-fit plane. */
  planeRms: number;
  /** Expected per-pixel noise (m) at the median range under the sensor noise model. */
  expectedNoise: number;
  /** sqrt(max(0, planeRms^2 - expectedNoise^2)): surface relief not explained by sensor noise. */
  excessRelief: number;
  /** Fraction of points farther than max(0.03 m, 3 sigma) from the plane. */
  offPlaneFraction: number;
  /** Depth spread p90 - p10 (m). */
  depthSpread: number;
  /** Angle (deg) between the optical ray to the centroid and the fitted plane normal. */
  planeIncidenceDeg: number;
  /** True if the box touches the image border (object possibly truncated). */
  truncated: boolean;
  /** Fraction of points explained by the single best RANSAC plane (inlier band max(2 cm, 2.5 sigma)). */
  dominantPlaneFraction: number;
  /**
   * Fraction of points explained by the best two RANSAC planes. High values mean the box is
   * piecewise flat (e.g. a box occluding a picture, or a wall corner) rather than volumetric.
   */
  twoPlaneFraction: number;
}

/** Applies the sensor noise model to a clean depth image using a seeded RNG. */
export function applyDepthNoise(
  depth: Float32Array,
  rng: () => number,
  model: DepthNoiseModel = DEFAULT_DEPTH_NOISE,
): Float32Array {
  const out = new Float32Array(depth.length);
  for (let i = 0; i < depth.length; i++) {
    const z = depth[i];
    if (!(z > 0) || z > model.maxRange) {
      out[i] = 0;
      continue;
    }
    out[i] = Math.max(0.01, z + gaussian(rng) * depthSigma(z, model));
  }
  return out;
}

function gaussian(rng: () => number): number {
  let u = 0;
  while (u <= 1e-12) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface FeatureOptions {
  /** Fraction of box width/height trimmed from each side before sampling (reduces background bleed). */
  shrink: number;
  /** RANSAC iterations per plane (deterministic sampling). */
  ransacIterations: number;
  /** Approximate maximum number of sampled pixels. */
  maxSamples: number;
  noise: DepthNoiseModel;
}

export const DEFAULT_FEATURE_OPTIONS: FeatureOptions = {
  shrink: 0.2,
  ransacIterations: 150,
  maxSamples: 1600,
  noise: DEFAULT_DEPTH_NOISE,
};

export function extractDepthFeatures(
  depth: Float32Array,
  intr: Intrinsics,
  bbox: [number, number, number, number],
  opts: Partial<FeatureOptions> = {},
): DepthFeatures | null {
  const o = { ...DEFAULT_FEATURE_OPTIONS, ...opts };
  if (depth.length !== intr.width * intr.height) throw new Error("depth image size does not match intrinsics");
  const [bx, by, bw, bh] = bbox;
  if (!(bw > 2 && bh > 2) || ![bx, by, bw, bh].every(Number.isFinite)) return null;
  const truncated = bx <= 2 || by <= 2 || bx + bw >= intr.width - 2 || by + bh >= intr.height - 2;
  const x0 = Math.max(0, Math.floor(bx + bw * o.shrink));
  const x1 = Math.min(intr.width - 1, Math.ceil(bx + bw * (1 - o.shrink)));
  const y0 = Math.max(0, Math.floor(by + bh * o.shrink));
  const y1 = Math.min(intr.height - 1, Math.ceil(by + bh * (1 - o.shrink)));
  if (x1 <= x0 || y1 <= y0) return null;
  const area = (x1 - x0 + 1) * (y1 - y0 + 1);
  const stride = Math.max(1, Math.floor(Math.sqrt(area / o.maxSamples)));

  const pts: number[] = [];
  const zs: number[] = [];
  let samples = 0;
  for (let v = y0; v <= y1; v += stride) {
    for (let u = x0; u <= x1; u += stride) {
      samples++;
      const z = depth[v * intr.width + u];
      if (!(z > 0) || z > o.noise.maxRange) continue;
      const x = ((u + 0.5 - intr.cx) * z) / intr.fx;
      const y = (-(v + 0.5 - intr.cy) * z) / intr.fy;
      pts.push(x, y, z);
      zs.push(z);
    }
  }
  const n = zs.length;
  if (n < 12) return null;
  zs.sort((a, b) => a - b);
  const q = (p: number) => zs[Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))))];
  const medianDepth = q(0.5);

  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < n; i++) {
    mx += pts[3 * i];
    my += pts[3 * i + 1];
    mz += pts[3 * i + 2];
  }
  mx /= n; my /= n; mz /= n;
  let cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0;
  for (let i = 0; i < n; i++) {
    const dx = pts[3 * i] - mx, dy = pts[3 * i + 1] - my, dz = pts[3 * i + 2] - mz;
    cxx += dx * dx; cxy += dx * dy; cxz += dx * dz;
    cyy += dy * dy; cyz += dy * dz; czz += dz * dz;
  }
  const normal = smallestEigenvector([cxx / n, cxy / n, cxz / n, cyy / n, cyz / n, czz / n]);
  const expectedNoise = depthSigma(medianDepth, o.noise);
  const offThresh = Math.max(0.03, 3 * expectedNoise);
  let ss = 0;
  let off = 0;
  for (let i = 0; i < n; i++) {
    const r = (pts[3 * i] - mx) * normal[0] + (pts[3 * i + 1] - my) * normal[1] + (pts[3 * i + 2] - mz) * normal[2];
    ss += r * r;
    if (Math.abs(r) > offThresh) off++;
  }
  const planeRms = Math.sqrt(ss / n);
  const excessRelief = Math.sqrt(Math.max(0, planeRms * planeRms - expectedNoise * expectedNoise));
  const band = Math.max(0.02, 2.5 * expectedNoise);
  const all = new Uint8Array(n).fill(1);
  const first = ransacPlane(pts, all, band, o.ransacIterations, 0x5eed);
  const rest = new Uint8Array(n);
  for (let i = 0; i < n; i++) rest[i] = first.inlier[i] ? 0 : 1;
  const second = ransacPlane(pts, rest, band, o.ransacIterations, 0x5eed + 1);
  const rayLen = Math.hypot(mx, my, mz) || 1;
  const cosInc = Math.abs((mx * normal[0] + my * normal[1] + mz * normal[2]) / rayLen);
  return {
    samples,
    validFraction: n / samples,
    medianDepth,
    nearDepth: q(0.25),
    centroidCam: [mx, my, mz],
    planeRms,
    expectedNoise,
    excessRelief,
    offPlaneFraction: off / n,
    depthSpread: q(0.9) - q(0.1),
    planeIncidenceDeg: (Math.acos(Math.min(1, cosInc)) * 180) / Math.PI,
    truncated,
    dominantPlaneFraction: first.count / n,
    twoPlaneFraction: (first.count + second.count) / n,
  };
}

/**
 * Deterministic RANSAC plane fit over the points whose mask is 1. Sampling uses a fixed
 * seed so that identical inputs always give identical features.
 */
function ransacPlane(
  pts: number[],
  mask: Uint8Array,
  band: number,
  iterations: number,
  seed: number,
): { count: number; inlier: Uint8Array } {
  const idx: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i]) idx.push(i);
  const inlier = new Uint8Array(mask.length);
  if (idx.length < 3) return { count: 0, inlier };
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  let bestCount = 0;
  let best: [number, number, number, number] | null = null;
  for (let it = 0; it < iterations; it++) {
    const a = idx[Math.floor(rnd() * idx.length)];
    const b = idx[Math.floor(rnd() * idx.length)];
    const c = idx[Math.floor(rnd() * idx.length)];
    if (a === b || b === c || a === c) continue;
    const ux = pts[3 * b] - pts[3 * a], uy = pts[3 * b + 1] - pts[3 * a + 1], uz = pts[3 * b + 2] - pts[3 * a + 2];
    const vx = pts[3 * c] - pts[3 * a], vy = pts[3 * c + 1] - pts[3 * a + 1], vz = pts[3 * c + 2] - pts[3 * a + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) continue;
    nx /= len; ny /= len; nz /= len;
    const d = -(nx * pts[3 * a] + ny * pts[3 * a + 1] + nz * pts[3 * a + 2]);
    let count = 0;
    for (const i of idx) {
      if (Math.abs(nx * pts[3 * i] + ny * pts[3 * i + 1] + nz * pts[3 * i + 2] + d) <= band) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = [nx, ny, nz, d];
    }
  }
  if (best) {
    const [nx, ny, nz, d] = best;
    for (const i of idx) {
      if (Math.abs(nx * pts[3 * i] + ny * pts[3 * i + 1] + nz * pts[3 * i + 2] + d) <= band) inlier[i] = 1;
    }
  }
  return { count: bestCount, inlier };
}

/**
 * Eigenvector for the smallest eigenvalue of a symmetric 3x3 matrix
 * given as [a00, a01, a02, a11, a12, a22], via Jacobi rotations.
 */
export function smallestEigenvector(m: [number, number, number, number, number, number]): [number, number, number] {
  const a = [
    [m[0], m[1], m[2]],
    [m[1], m[3], m[4]],
    [m[2], m[4], m[5]],
  ];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 32; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-14) break;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-18) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  let idx = 0;
  if (a[1][1] < a[idx][idx]) idx = 1;
  if (a[2][2] < a[idx][idx]) idx = 2;
  const e: [number, number, number] = [v[0][idx], v[1][idx], v[2][idx]];
  const len = Math.hypot(e[0], e[1], e[2]) || 1;
  return [e[0] / len, e[1] / len, e[2] / len];
}
