// Thin wrapper around TensorFlow.js COCO-SSD. The detector only ever receives
// pixels (ImageData) rendered by the robot camera; it never sees scene objects.
import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-webgl";
import "@tensorflow/tfjs-backend-cpu";
import { setWasmPaths } from "@tensorflow/tfjs-backend-wasm";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import type { Detection, DetectorInfo } from "./types";

export type CocoBase = "lite_mobilenet_v2" | "mobilenet_v2";
export type TfBackend = "webgl" | "wasm" | "cpu";

export const COCO_SSD_PACKAGE_VERSION = "2.2.3";
export const TFJS_VERSION = "4.22.0";

export interface DetectorRun {
  detections: Detection[];
  inferenceMs: number;
}

export class CocoSsdDetector {
  private constructor(
    private readonly model: cocoSsd.ObjectDetection,
    readonly info: DetectorInfo,
  ) {}

  /** Loads self-hosted weights from /models/coco-ssd/<base>/model.json. */
  static async load(
    base: CocoBase = "lite_mobilenet_v2",
    basePath = "/models/coco-ssd",
    preferredBackend: TfBackend = "webgl",
  ): Promise<CocoSsdDetector> {
    const t0 = performance.now();
    let backend: string = preferredBackend;
    if (preferredBackend === "wasm") setWasmPaths("/tfjs-wasm/");
    try {
      const ok = await tf.setBackend(preferredBackend);
      if (!ok) throw new Error(`${preferredBackend} backend unavailable`);
    } catch {
      backend = "cpu";
      await tf.setBackend("cpu");
    }
    await tf.ready();
    const model = await cocoSsd.load({ base, modelUrl: `${basePath}/${base}/model.json` });
    const loadMs = performance.now() - t0;
    return new CocoSsdDetector(model, {
      name: "coco-ssd",
      packageVersion: COCO_SSD_PACKAGE_VERSION,
      tfjsVersion: TFJS_VERSION,
      base,
      backend: tf.getBackend() ?? backend,
      loadMs,
    });
  }

  /** Runs genuine inference on the supplied pixels. minScore is the model's own score floor. */
  async detect(image: ImageData, minScore = 0.2, maxBoxes = 20): Promise<DetectorRun> {
    const t0 = performance.now();
    const raw = await this.model.detect(image, maxBoxes, minScore);
    const inferenceMs = performance.now() - t0;
    const detections: Detection[] = raw.map((d) => ({
      cls: d.class,
      score: d.score,
      bbox: [d.bbox[0], d.bbox[1], d.bbox[2], d.bbox[3]],
    }));
    return { detections, inferenceMs };
  }

  dispose(): void {
    this.model.dispose();
  }
}
