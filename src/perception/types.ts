/** One detector output on one camera image. bbox is [x, y, width, height] in pixels. */
export interface Detection {
  cls: string;
  score: number;
  bbox: [number, number, number, number];
}

export interface DetectorInfo {
  name: "coco-ssd";
  packageVersion: string;
  tfjsVersion: string;
  base: string;
  backend: string;
  loadMs: number;
}
