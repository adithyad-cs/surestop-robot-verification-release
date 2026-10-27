// Viewpoint accounting: repeated frames from nearly the same place relative to a
// candidate are correlated, so they share one vote. A viewpoint cell is the pair
// (range bin, bearing bin) of the robot relative to the candidate's estimated position.

export interface ViewpointCellConfig {
  /** Range bin width (m). */
  rangeBin: number;
  /** Bearing bin width (deg). */
  bearingBinDeg: number;
}

export const DEFAULT_CELL: ViewpointCellConfig = { rangeBin: 0.75, bearingBinDeg: 30 };

export interface ViewpointCell {
  key: string;
  range: number;
  /** Bearing of the robot as seen from the candidate, degrees in [0, 360). */
  bearingDeg: number;
}

export function wrapDeg(d: number): number {
  const r = d % 360;
  return r < 0 ? r + 360 : r;
}

/** Smallest absolute difference between two bearings, in degrees [0, 180]. */
export function bearingDiff(a: number, b: number): number {
  const d = Math.abs(wrapDeg(a) - wrapDeg(b));
  return d > 180 ? 360 - d : d;
}

export function viewpointCell(
  robot: { x: number; z: number },
  candidate: { x: number; z: number },
  cfg: ViewpointCellConfig = DEFAULT_CELL,
): ViewpointCell {
  const dx = robot.x - candidate.x;
  const dz = robot.z - candidate.z;
  const range = Math.hypot(dx, dz);
  const bearingDeg = wrapDeg((Math.atan2(dz, dx) * 180) / Math.PI);
  const ri = Math.floor(range / cfg.rangeBin);
  const bi = Math.floor(bearingDeg / cfg.bearingBinDeg) % Math.round(360 / cfg.bearingBinDeg);
  return { key: `r${ri}:b${bi}`, range, bearingDeg };
}
