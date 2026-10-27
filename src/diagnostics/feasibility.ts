// Phase A perception-feasibility harness. Renders real Three.js images of candidate
// assets, posters and screens from many viewpoints, runs genuine COCO-SSD inference on
// the pixels, and scores detections against projected ground-truth boxes. Ground truth
// here is used only for scoring the feasibility test, never fed to the detector.
import * as THREE from "three";
import { ASSETS, type AssetSpec } from "@/sim/assets";
import { loadAsset } from "@/sim/loadAsset";
import { addLighting, buildBox, buildPhotoBoard, buildPoster, buildRoomShell, buildScreen } from "@/sim/props";
import { inContextPicture, studioPicture } from "@/sim/pictures";
import { getFloorTexture, getWallTexture } from "@/sim/textures";
import { SensorRenderer, makeRobotCamera, ROBOT_CAMERA } from "@/sim/sensorRenderer";
import { CocoSsdDetector, type CocoBase, type TfBackend } from "@/perception/cocoSsd";
import type { Detection } from "@/perception/types";
import { applyDepthNoise, extractDepthFeatures, intrinsicsFromFov, type DepthFeatures } from "@/sensing/depthFeatures";
import { mulberry32 } from "@/lib/rng";

export type CaseKind = "object" | "poster" | "screen" | "poster-occluded" | "photoboard" | "occluded" | "truncated" | "dim" | "empty";

export interface FeasCase {
  id: string;
  kind: CaseKind;
  assetId: string | null;
  distance: number;
  angleDeg: number;
  extra?: number;
}

export interface FeasRecord extends FeasCase {
  gtClass: string | null;
  gtBox: [number, number, number, number] | null;
  detections: Detection[];
  /** Best detection of gtClass matching the GT box (IoU >= 0.25 or centre inside). */
  match: { score: number; iou: number; bbox: [number, number, number, number] } | null;
  /** Best detection of the *asset's* class anywhere in the frame (for posters/screens: the depicted class). */
  depictedBest: number;
  /** Best detection of the probe class (the task's target class) on the GT region, any asset. */
  probe: { score: number; bbox: [number, number, number, number] } | null;
  inferenceMs: number;
  renderMs: number;
  depthClean: DepthFeatures | null;
  depthNoisy: DepthFeatures | null;
  thumb?: string;
}

export interface FeasSummaryRow {
  assetId: string;
  kind: CaseKind;
  cls: string;
  n: number;
  hit50: number;
  hit30: number;
  meanBest: number;
}

export interface DepthValidation {
  pixels: number;
  medianAbsErr: number;
  maxAbsErr: number;
  within1cm: number;
}

export interface FeasReport {
  startedAt: string;
  userAgent: string;
  detector: CocoSsdDetector["info"];
  camera: typeof ROBOT_CAMERA & { heightM: number; pitchDeg: number };
  webgl: { renderer: string; vendor: string };
  records: FeasRecord[];
  summary: FeasSummaryRow[];
  latency: { n: number; medianMs: number; p95Ms: number; meanMs: number };
  depthValidation: DepthValidation;
  depthValidationBy: Record<string, { pixels: number; maxAbsErr: number; within1cm: number }>;
  falsePositivesOnEmpty: Array<{ id: string; detections: Detection[] }>;
}

const CAM_H = 1.0;
const PITCH = -10;
const ROOM = { width: 10, depth: 10, height: 2.8 };

export function buildCases(assetIds: string[], decoyAssetIds: string[]): FeasCase[] {
  const cases: FeasCase[] = [];
  for (const a of assetIds) {
    for (const d of [1.2, 2.0, 3.0, 4.2]) {
      for (const az of [0, 60, 120, 180, 240, 300]) {
        cases.push({ id: `${a}-obj-d${d}-az${az}`, kind: "object", assetId: a, distance: d, angleDeg: az });
      }
    }
  }
  for (const a of decoyAssetIds) {
    for (const d of [1.2, 2.0, 3.0]) {
      for (const ang of [0, 35, 60, 75]) {
        cases.push({ id: `${a}-poster-d${d}-a${ang}`, kind: "poster", assetId: a, distance: d, angleDeg: ang });
        cases.push({ id: `${a}-screen-d${d}-a${ang}`, kind: "screen", assetId: a, distance: d, angleDeg: ang });
      }
    }
    for (const d of [2.0, 3.0]) {
      for (const lat of [0, 0.3]) {
        for (const az of [0, 90]) {
          cases.push({ id: `${a}-occ-d${d}-l${lat}-az${az}`, kind: "occluded", assetId: a, distance: d, angleDeg: az, extra: lat });
        }
      }
    }
    for (const d of [1.2, 2.0, 3.0]) {
      for (const ang of [0, 30, 60]) {
        cases.push({ id: `${a}-photoboard-d${d}-a${ang}`, kind: "photoboard", assetId: a, distance: d, angleDeg: ang });
      }
    }
    for (const d of [1.5, 2.2]) {
      for (const lat of [0, 0.25]) {
        for (const ang of [0, 35]) {
          cases.push({ id: `${a}-posterocc-d${d}-l${lat}-a${ang}`, kind: "poster-occluded", assetId: a, distance: d, angleDeg: ang, extra: lat });
        }
      }
    }
    for (const frac of [0.25, 0.5]) {
      for (const side of [-1, 1]) {
        cases.push({ id: `${a}-trunc-${frac}-${side}`, kind: "truncated", assetId: a, distance: 2.0, angleDeg: 0, extra: side * frac });
      }
    }
    for (const az of [0, 120, 240]) {
      cases.push({ id: `${a}-dim-az${az}`, kind: "dim", assetId: a, distance: 2.5, angleDeg: az });
    }
  }
  for (let i = 0; i < 12; i++) {
    cases.push({ id: `empty-${i}`, kind: "empty", assetId: null, distance: 2 + (i % 3), angleDeg: i * 30 });
  }
  return cases;
}

function setCamera(cam: THREE.PerspectiveCamera, pos: THREE.Vector3, lookAtXZ: THREE.Vector3, yawOffsetDeg = 0) {
  cam.position.copy(pos);
  const dir = new THREE.Vector3(lookAtXZ.x - pos.x, 0, lookAtXZ.z - pos.z).normalize();
  const yaw = Math.atan2(dir.x, -dir.z) + (yawOffsetDeg * Math.PI) / 180;
  cam.rotation.set(0, 0, 0);
  cam.rotation.order = "YXZ";
  cam.rotation.y = -yaw;
  cam.rotation.x = (PITCH * Math.PI) / 180;
  cam.updateMatrixWorld(true);
}

function projectBox(obj: THREE.Object3D, cam: THREE.PerspectiveCamera): [number, number, number, number] | null {
  const box = new THREE.Box3().setFromObject(obj);
  const { width: w, height: h } = ROBOT_CAMERA;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const camInv = cam.matrixWorldInverse;
  for (let i = 0; i < 8; i++) {
    const p = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
    const pc = p.clone().applyMatrix4(camInv);
    if (pc.z > -0.05) continue;
    p.project(cam);
    const px = ((p.x + 1) / 2) * w;
    const py = ((1 - p.y) / 2) * h;
    x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
  }
  if (!Number.isFinite(x0)) return null;
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w, x1); y1 = Math.min(h, y1);
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  return [x0, y0, x1 - x0, y1 - y0];
}

export function iou(a: [number, number, number, number], b: [number, number, number, number]): number {
  const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const u = a[2] * a[3] + b[2] * b[3] - inter;
  return u > 0 ? inter / u : 0;
}

function centreInside(d: [number, number, number, number], g: [number, number, number, number]): boolean {
  const cx = d[0] + d[2] / 2, cy = d[1] + d[3] / 2;
  return cx >= g[0] && cx <= g[0] + g[2] && cy >= g[1] && cy <= g[1] + g[3];
}

function posterSize(spec: AssetSpec): [number, number] {
  if (spec.id === "plant" || spec.id === "vaseFlowers") return [0.6, 0.8];
  if (spec.id.includes("Sofa")) return [1.1, 0.62];
  return [0.8, 0.6];
}

export function thumbnail(img: ImageData, dets: Detection[], gt: [number, number, number, number] | null, scale = 0.4): string {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d")!;
  ctx.putImageData(img, 0, 0);
  if (gt) {
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.strokeRect(gt[0], gt[1], gt[2], gt[3]);
    ctx.setLineDash([]);
  }
  ctx.font = "16px monospace";
  for (const d of dets) {
    ctx.strokeStyle = d.score >= 0.5 ? "#22d3ee" : "#f59e0b";
    ctx.lineWidth = 3;
    ctx.strokeRect(d.bbox[0], d.bbox[1], d.bbox[2], d.bbox[3]);
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(d.bbox[0], d.bbox[1] - 18, 200, 18);
    ctx.fillStyle = "#fff";
    ctx.fillText(`${d.cls} ${d.score.toFixed(2)}`, d.bbox[0] + 3, d.bbox[1] - 4);
  }
  const t = document.createElement("canvas");
  t.width = Math.round(img.width * scale);
  t.height = Math.round(img.height * scale);
  t.getContext("2d")!.drawImage(c, 0, 0, t.width, t.height);
  return t.toDataURL("image/jpeg", 0.8);
}

export interface RunOptions {
  base: CocoBase;
  backend: TfBackend;
  assetIds: string[];
  decoyAssetIds: string[];
  thumbs: boolean;
  thumbScale?: number;
  /** Run only cases whose id is listed. */
  only?: string[];
  probeClass?: string;
  onProgress?: (done: number, total: number, rec: FeasRecord) => void;
}

export async function runFeasibility(opts: RunOptions): Promise<FeasReport> {
  const startedAt = new Date().toISOString();
  const detector = await CocoSsdDetector.load(opts.base, "/models/coco-ssd", opts.backend);
  const sensor = new SensorRenderer();
  const gl = sensor.renderer.getContext();
  const dbg = gl.getExtension("WEBGL_debug_renderer_info");
  const webgl = {
    renderer: String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
    vendor: String(dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)),
  };
  const intr = intrinsicsFromFov(ROBOT_CAMERA.width, ROBOT_CAMERA.height, ROBOT_CAMERA.vfovDeg);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf0eee9);
  scene.add(buildRoomShell(ROOM));
  const lights = addLighting(scene);
  const cam = makeRobotCamera();
  const pictures = new Map<string, THREE.Texture>();
  const boards = new Map<string, THREE.Texture>();
  for (const id of [...opts.assetIds, ...opts.decoyAssetIds]) {
    if (!ASSETS[id]) throw new Error(`unknown or unshipped asset "${id}" (see src/sim/assets.ts)`);
  }
  for (const id of opts.decoyAssetIds) {
    const spec = ASSETS[id];
    const [pw, ph] = posterSize(spec);
    pictures.set(id, await studioPicture(sensor, spec, pw / ph));
    boards.set(id, await inContextPicture(sensor, spec, 0.75, getFloorTexture(), getWallTexture()));
  }

  const cases = buildCases(opts.assetIds, opts.decoyAssetIds).filter((c) => !opts.only?.length || opts.only.includes(c.id));
  const records: FeasRecord[] = [];
  const latencies: number[] = [];
  const depthErrs: number[] = [];
  const depthErrsBy = new Map<string, number[]>();
  const raycaster = new THREE.Raycaster();
  const rng = mulberry32(1234);

  // Warm-up inference (excluded from latency statistics).
  await detector.detect(sensor.renderRGB(scene, cam), 0.2);

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const spec = c.assetId ? ASSETS[c.assetId] : null;
    const dyn = new THREE.Group();
    scene.add(dyn);
    let gtObj: THREE.Object3D | null = null;
    const lookAt = new THREE.Vector3();
    const camPos = new THREE.Vector3();
    let yawOffset = 0;
    lights.children.forEach((l) => {
      const light = l as THREE.Light;
      if (light.isLight) light.intensity = (light as THREE.HemisphereLight).isHemisphereLight ? 0.55 : 1.6;
    });
    const az = (c.angleDeg * Math.PI) / 180;

    if (c.kind === "empty") {
      camPos.set(Math.sin(az) * c.distance * 0.6, CAM_H, Math.cos(az) * c.distance * 0.6);
      lookAt.set(camPos.x + Math.sin(az), 0, camPos.z + Math.cos(az));
      if (i % 4 === 0) dyn.add(buildBox(0.6, 0.7, 0.5).translateX(1.5));
    } else if ((c.kind === "poster" || c.kind === "poster-occluded") && spec) {
      const [pw, ph] = posterSize(spec);
      const poster = buildPoster(pictures.get(spec.id)!, pw, ph);
      poster.position.set(0, 1.3, -ROOM.depth / 2 + 0.001);
      dyn.add(poster);
      gtObj = poster.children[poster.children.length - 1];
      camPos.set(Math.sin(az) * c.distance, CAM_H, -ROOM.depth / 2 + Math.cos(az) * c.distance);
      lookAt.set(0, 0, -ROOM.depth / 2);
      if (c.kind === "poster-occluded") {
        const occ = buildBox(0.6, 1.05, 0.4, 0x7d8a96);
        occ.position.set(c.extra ?? 0, 0.525, -ROOM.depth / 2 + 0.55);
        dyn.add(occ);
      }
    } else if (c.kind === "photoboard" && spec) {
      const bh = spec.height / 0.8;
      const board = buildPhotoBoard(boards.get(spec.id)!, bh * 0.75, bh);
      dyn.add(board);
      gtObj = board.children[1];
      camPos.set(Math.sin(az) * c.distance, CAM_H, Math.cos(az) * c.distance);
      lookAt.set(0, 0, 0);
    } else if (c.kind === "screen" && spec) {
      const [pw, ph] = posterSize(spec);
      const sh = 0.62;
      const screen = buildScreen(pictures.get(spec.id)!, Math.min(1.2, (sh * pw) / ph), sh);
      screen.position.set(0, 0, -ROOM.depth / 2 + 0.3);
      dyn.add(screen);
      gtObj = screen.children[screen.children.length - 1];
      camPos.set(Math.sin(az) * c.distance, CAM_H, -ROOM.depth / 2 + 0.3 + Math.cos(az) * c.distance);
      lookAt.set(0, 0, -ROOM.depth / 2 + 0.3);
    } else if (spec) {
      const obj = await loadAsset(spec);
      dyn.add(obj);
      gtObj = obj;
      camPos.set(Math.sin(az) * c.distance, CAM_H, Math.cos(az) * c.distance);
      lookAt.set(0, 0, 0);
      if (c.kind === "occluded") {
        const occ = buildBox(0.55, 0.55, 0.35, 0x7d8a96);
        const toCam = new THREE.Vector3(Math.sin(az), 0, Math.cos(az));
        const lateral = new THREE.Vector3(toCam.z, 0, -toCam.x).multiplyScalar(c.extra ?? 0);
        occ.position.add(toCam.multiplyScalar(0.6)).add(lateral);
        dyn.add(occ);
      }
      if (c.kind === "truncated") {
        const hfov = 2 * Math.atan(Math.tan((ROBOT_CAMERA.vfovDeg * Math.PI) / 360) * (ROBOT_CAMERA.width / ROBOT_CAMERA.height));
        const objHalf = Math.atan2(0.4, c.distance);
        yawOffset = Math.sign(c.extra ?? 1) * ((hfov / 2 + objHalf * (1 - 2 * Math.abs(c.extra ?? 0.5))) * 180) / Math.PI;
      }
      if (c.kind === "dim") {
        lights.children.forEach((l) => {
          const light = l as THREE.Light;
          if (light.isLight) light.intensity *= 0.3;
        });
      }
    }

    setCamera(cam, camPos, lookAt, yawOffset);
    scene.updateMatrixWorld(true);
    const t0 = performance.now();
    const img = sensor.renderRGB(scene, cam);
    const depth = sensor.renderDepth(scene, cam);
    const renderMs = performance.now() - t0;
    const { detections, inferenceMs } = await detector.detect(img, 0.2);
    latencies.push(inferenceMs);

    const gtBox = gtObj ? projectBox(gtObj, cam) : null;
    const gtClass = spec ? (c.kind === "poster" || c.kind === "screen" || c.kind === "poster-occluded" || c.kind === "photoboard" ? null : spec.groundTruthClass) : null;
    const depictedClass = spec?.groundTruthClass ?? null;
    let match: FeasRecord["match"] = null;
    let depictedBest = 0;
    for (const d of detections) {
      if (depictedClass && d.cls === depictedClass) {
        depictedBest = Math.max(depictedBest, d.score);
        if (gtBox && (iou(d.bbox, gtBox) >= 0.25 || centreInside(d.bbox, gtBox))) {
          if (!match || d.score > match.score) match = { score: d.score, iou: gtBox ? iou(d.bbox, gtBox) : 0, bbox: d.bbox };
        }
      }
    }
    const probeClass = opts.probeClass ?? "potted plant";
    let probe: FeasRecord["probe"] = null;
    for (const d of detections) {
      if (d.cls === probeClass && gtBox && (iou(d.bbox, gtBox) >= 0.25 || centreInside(d.bbox, gtBox))) {
        if (!probe || d.score > probe.score) probe = { score: d.score, bbox: d.bbox };
      }
    }
    const featBox = probe?.bbox ?? match?.bbox ?? gtBox;
    const depthClean = featBox ? extractDepthFeatures(depth, intr, featBox) : null;
    const depthNoisy = featBox ? extractDepthFeatures(applyDepthNoise(depth, mulberry32(1000 + i)), intr, featBox) : null;

    // Validate depth/ray alignment on random pixels (skip frames with alpha-masked foliage,
    // where the raycaster cannot honour alpha tests).
    if (c.assetId !== "plant" && c.assetId !== "vaseFlowers") {
      for (let k = 0; k < 12; k++) {
        const u = Math.floor(rng() * ROBOT_CAMERA.width);
        const v = Math.floor(rng() * ROBOT_CAMERA.height);
        const ndc = new THREE.Vector2(((u + 0.5) / ROBOT_CAMERA.width) * 2 - 1, -(((v + 0.5) / ROBOT_CAMERA.height) * 2 - 1));
        raycaster.setFromCamera(ndc, cam);
        const hits = raycaster.intersectObjects(scene.children, true).filter((h) => (h.object as THREE.Mesh).isMesh);
        const z = depth[v * ROBOT_CAMERA.width + u];
        if (!hits.length || !(z > 0)) continue;
        const fwd = new THREE.Vector3();
        cam.getWorldDirection(fwd);
        const zRay = hits[0].distance * raycaster.ray.direction.dot(fwd);
        depthErrs.push(Math.abs(zRay - z));
        const key = `${c.assetId ?? "none"}:${c.kind}`;
        depthErrsBy.set(key, [...(depthErrsBy.get(key) ?? []), Math.abs(zRay - z)]);
      }
    }

    const rec: FeasRecord = {
      ...c,
      gtClass,
      gtBox,
      detections,
      match,
      depictedBest,
      probe,
      inferenceMs,
      renderMs,
      depthClean,
      depthNoisy,
      thumb: opts.thumbs ? thumbnail(img, detections, opts.thumbScale && opts.thumbScale >= 1 ? null : gtBox, opts.thumbScale ?? 0.4) : undefined,
    };
    records.push(rec);
    scene.remove(dyn);
    opts.onProgress?.(i + 1, cases.length, rec);
  }

  const summaryMap = new Map<string, FeasSummaryRow & { sum: number }>();
  for (const r of records) {
    if (!r.assetId) continue;
    const key = `${r.assetId}|${r.kind}`;
    const cls = ASSETS[r.assetId].groundTruthClass;
    const row = summaryMap.get(key) ?? { assetId: r.assetId, kind: r.kind, cls, n: 0, hit50: 0, hit30: 0, meanBest: 0, sum: 0 };
    const s = r.kind === "poster" || r.kind === "screen" || r.kind === "poster-occluded" || r.kind === "photoboard" ? bestOnGt(r) : r.match?.score ?? 0;
    row.n++;
    if (s >= 0.5) row.hit50++;
    if (s >= 0.3) row.hit30++;
    row.sum += s;
    summaryMap.set(key, row);
  }
  const summary = [...summaryMap.values()].map(({ sum, ...row }) => ({ ...row, meanBest: sum / row.n }));
  const sorted = [...latencies].sort((a, b) => a - b);
  const depthSorted = [...depthErrs].sort((a, b) => a - b);
  const report: FeasReport = {
    startedAt,
    userAgent: navigator.userAgent,
    detector: detector.info,
    camera: { ...ROBOT_CAMERA, heightM: CAM_H, pitchDeg: PITCH },
    webgl,
    records,
    summary,
    latency: {
      n: sorted.length,
      medianMs: sorted[Math.floor(sorted.length / 2)] ?? 0,
      p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
      meanMs: sorted.reduce((a, b) => a + b, 0) / Math.max(1, sorted.length),
    },
    depthValidation: {
      pixels: depthSorted.length,
      medianAbsErr: depthSorted[Math.floor(depthSorted.length / 2)] ?? NaN,
      maxAbsErr: depthSorted[depthSorted.length - 1] ?? NaN,
      within1cm: depthSorted.filter((e) => e < 0.01).length / Math.max(1, depthSorted.length),
    },
    depthValidationBy: Object.fromEntries(
      [...depthErrsBy.entries()].map(([k, v]) => [
        k,
        { pixels: v.length, maxAbsErr: Math.max(...v), within1cm: v.filter((e) => e < 0.01).length / v.length },
      ]),
    ),
    falsePositivesOnEmpty: records
      .filter((r) => r.kind === "empty")
      .map((r) => ({ id: r.id, detections: r.detections.filter((d) => d.score >= 0.3) }))
      .filter((r) => r.detections.length > 0),
  };
  detector.dispose();
  sensor.dispose();
  return report;
}

/** For posters/screens: best score of the depicted class on the picture region. */
function bestOnGt(r: FeasRecord): number {
  if (!r.assetId || !r.gtBox) return 0;
  const cls = ASSETS[r.assetId].groundTruthClass;
  let best = 0;
  for (const d of r.detections) {
    if (d.cls === cls && (iou(d.bbox, r.gtBox) >= 0.25 || centreInside(d.bbox, r.gtBox))) best = Math.max(best, d.score);
  }
  return best;
}
