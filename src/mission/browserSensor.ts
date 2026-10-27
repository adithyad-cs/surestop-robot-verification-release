// Robot-mounted RGB-D sensor in the browser: renders the scene from the robot's pose,
// runs the detector on the pixels, and measures depth features inside target boxes.
// It never reads object names, ids or labels from the scene: only rendered pixels/depth.
import * as THREE from "three";
import type { CocoSsdDetector } from "@/perception/cocoSsd";
import type { Detection } from "@/perception/types";
import { applyDepthNoise, extractDepthFeatures, intrinsicsFromFov, DEFAULT_DEPTH_NOISE, type Intrinsics } from "@/sensing/depthFeatures";
import { makeRobotCamera, type SensorRenderer } from "@/sim/sensorRenderer";
import { deriveSeed, mulberry32 } from "@/lib/rng";
import type { Pose2 } from "@/verify/types";
import { confusableClasses } from "@/verify/identity";
import type { Sensor, SensorFrame, TargetObservation } from "./types";

export const CAMERA_HEIGHT = 1.0;
export const CAMERA_PITCH_DEG = -10;
/** Detector outputs below this are discarded entirely. */
export const REPORT_FLOOR = 0.2;

interface CachedFrame {
  detections: Detection[];
  targets: TargetObservation[];
  conflicts: TargetObservation[];
  inferenceMs: number;
  renderMs: number;
  image: ImageData | null;
  depth: Float32Array | null;
}

export interface BrowserSensorOptions {
  targetClass: string;
  detectionFloor: number;
  /** Seed for the depth-noise stream (per pose, so memoised frames are exact). */
  noiseSeed: number;
  /** Keep the last RGB and depth images for display. */
  keepImages: boolean;
  /** Classes confusable with the target that are localised as identity-conflict observations. Default: src/verify/identity.ts. */
  confusableClasses?: readonly string[];
}

export class BrowserSensor implements Sensor {
  readonly camera: THREE.PerspectiveCamera;
  readonly intr: Intrinsics;
  private readonly cache = new Map<string, CachedFrame>();
  lastImage: ImageData | null = null;
  lastDepth: Float32Array | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: SensorRenderer,
    private readonly detector: CocoSsdDetector,
    private readonly opts: BrowserSensorOptions,
  ) {
    this.camera = makeRobotCamera(renderer.intr);
    this.intr = intrinsicsFromFov(renderer.intr.width, renderer.intr.height, renderer.intr.vfovDeg);
  }

  get detectorInfo() {
    return this.detector.info;
  }

  /** Places the camera at the robot pose. Heading theta: forward = (cos, sin) in XZ. */
  setPose(p: Pose2): void {
    const cam = this.camera;
    cam.position.set(p.x, CAMERA_HEIGHT, p.z);
    cam.rotation.order = "YXZ";
    cam.rotation.set((CAMERA_PITCH_DEG * Math.PI) / 180, Math.atan2(-Math.cos(p.theta), -Math.sin(p.theta)), 0);
    cam.updateMatrixWorld(true);
  }

  async capture(robot: Pose2, frameId: number, t: number): Promise<SensorFrame> {
    const key = `${robot.x.toFixed(3)},${robot.z.toFixed(3)},${robot.theta.toFixed(4)}`;
    const hit = this.cache.get(key);
    if (hit) {
      if (this.opts.keepImages) {
        this.lastImage = hit.image;
        this.lastDepth = hit.depth;
      }
      return { frameId, t, robot: { ...robot }, detections: hit.detections, targets: hit.targets, conflicts: hit.conflicts, inferenceMs: 0, renderMs: 0, cached: true };
    }
    this.setPose(robot);
    const t0 = performance.now();
    const image = this.renderer.renderRGB(this.scene, this.camera);
    const clean = this.renderer.renderDepth(this.scene, this.camera);
    const depth = applyDepthNoise(clean, mulberry32(deriveSeed(this.opts.noiseSeed, key)), DEFAULT_DEPTH_NOISE);
    const renderMs = performance.now() - t0;
    const { detections, inferenceMs } = await this.detector.detect(image, REPORT_FLOOR);
    const targets: TargetObservation[] = [];
    const conflicts: TargetObservation[] = [];
    const confusable = this.opts.confusableClasses ?? confusableClasses(this.opts.targetClass);
    for (const d of detections) {
      if (d.score < this.opts.detectionFloor) continue;
      const isTarget = d.cls === this.opts.targetClass;
      if (!isTarget && !confusable.includes(d.cls)) continue;
      // The same depth measurement and back-projection for both, so a conflict is localised exactly as
      // a candidate is.
      const f = extractDepthFeatures(depth, this.intr, d.bbox);
      (isTarget ? targets : conflicts).push({ detection: d, depth: f, positionWorld: f ? this.backProject(d.bbox, f.nearDepth) : null });
    }
    const entry: CachedFrame = {
      detections,
      targets,
      conflicts,
      inferenceMs,
      renderMs,
      image: this.opts.keepImages ? image : null,
      depth: this.opts.keepImages ? depth : null,
    };
    this.cache.set(key, entry);
    if (this.opts.keepImages) {
      this.lastImage = image;
      this.lastDepth = depth;
    }
    return { frameId, t, robot: { ...robot }, detections, targets, conflicts, inferenceMs, renderMs, cached: false };
  }

  /** World position of the box-centre ray at the given optical-axis depth. */
  private backProject(bbox: [number, number, number, number], z: number) {
    const u = bbox[0] + bbox[2] / 2;
    const v = bbox[1] + bbox[3] / 2;
    const x = ((u - this.intr.cx) / this.intr.fx) * z;
    const y = (-(v - this.intr.cy) / this.intr.fy) * z;
    const p = new THREE.Vector3(x, y, -z).applyMatrix4(this.camera.matrixWorld);
    return { x: p.x, y: p.y, z: p.z };
  }

  cacheEntries(): number {
    return this.cache.size;
  }

  clearCache(): void {
    this.cache.clear();
  }
}
