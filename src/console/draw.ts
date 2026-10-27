// Canvas helpers that turn the sensor's actual pixels/depth into display images.
import type { Detection } from "@/perception/types";

const W = 480;

function scratch(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

/** The exact RGB image given to the detector, with its real outputs drawn on top. */
export function drawDetections(img: ImageData, dets: Detection[], targetClass: string): string {
  const [full, fctx] = scratch(img.width, img.height);
  fctx.putImageData(img, 0, 0);
  const s = W / img.width;
  const [c, ctx] = scratch(W, Math.round(img.height * s));
  ctx.drawImage(full, 0, 0, c.width, c.height);
  ctx.font = "600 15px ui-monospace, Menlo, monospace";
  for (const d of dets) {
    if (d.score < 0.3) continue;
    const isTarget = d.cls === targetClass;
    const color = isTarget ? "#f5a524" : "rgba(231,233,236,0.75)";
    const [x, y, w, h] = d.bbox.map((v) => v * s);
    ctx.lineWidth = isTarget ? 3 : 1.5;
    ctx.strokeStyle = color;
    ctx.setLineDash(isTarget ? [] : [3, 2]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    const label = `${d.cls} ${d.score.toFixed(2)}`;
    const tw = ctx.measureText(label).width + 8;
    const lh = 19;
    const ly = y > lh ? y - lh : y;
    ctx.fillStyle = "rgba(14,16,19,0.88)";
    ctx.fillRect(x, ly, tw, lh);
    ctx.fillStyle = color;
    ctx.fillText(label, x + 4, ly + 14);
  }
  return c.toDataURL("image/jpeg", 0.82);
}

/** Measured (noisy) depth as a grayscale-to-cyan ramp: near = bright. 0 = no return (black). */
export function drawDepth(depth: Float32Array, width: number, height: number, boxes: Array<[number, number, number, number]>): string {
  const s = W / width;
  const h = Math.round(height * s);
  const [c, ctx] = scratch(W, h);
  const img = ctx.createImageData(W, h);
  const maxZ = 8;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(height - 1, Math.floor(y / s));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(width - 1, Math.floor(x / s));
      const z = depth[sy * width + sx];
      const o = (y * W + x) * 4;
      if (!(z > 0)) {
        img.data[o + 3] = 255;
        continue;
      }
      const k = 1 - Math.min(1, z / maxZ);
      const v = Math.pow(k, 1.6);
      img.data[o] = Math.round(20 + 36 * v);
      img.data[o + 1] = Math.round(26 + 163 * v);
      img.data[o + 2] = Math.round(34 + 214 * v);
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = "#f5a524";
  ctx.lineWidth = 1.5;
  for (const b of boxes) {
    const [x, y, w, bh] = b.map((v) => v * s);
    // The inner region actually sampled by the feature extractor (20% inset).
    ctx.setLineDash([3, 2]);
    ctx.strokeRect(x + w * 0.2, y + bh * 0.2, w * 0.6, bh * 0.6);
    ctx.setLineDash([]);
  }
  return c.toDataURL("image/jpeg", 0.82);
}
