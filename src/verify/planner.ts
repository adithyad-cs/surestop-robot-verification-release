// Bounded re-observation: pick the next verification viewpoint around a candidate.
// Heuristic (not information-theoretic): reachable, line of sight, unused viewpoint cell,
// prefer a substantial change of bearing from earlier views, then shorter travel.
import { bearingDiff, viewpointCell, wrapDeg, type ViewpointCellConfig, DEFAULT_CELL } from "./viewpoint";

export interface NavQuery {
  /** True if the robot can stand at (x, z) (inflated free space). */
  isFree(x: number, z: number): boolean;
  /** Path length (m) from a to b, or null if unreachable. */
  pathLength(a: { x: number; z: number }, b: { x: number; z: number }): number | null;
  /** True if nothing blocks the straight segment from a towards b, ignoring the last `stopShort` metres. */
  lineOfSight(a: { x: number; z: number }, b: { x: number; z: number }, stopShort: number): boolean;
}

export interface PlannerConfig {
  /** Candidate ring radii (m). Kept inside one range bin so that distinct cells mean distinct bearings. */
  ranges: number[];
  /** Candidate bearings are placed at the centres of bins of this width, away from cell edges. */
  bearingStepDeg: number;
  /**
   * Line-of-sight is not checked over this final distance (m) to the candidate's estimated front
   * surface, so the candidate's own (unknown) footprint does not hide it from the far side.
   */
  ownFootprint: number;
  /** Bearing change (deg) beyond which extra change earns no more credit. */
  saturatingChangeDeg: number;
  /** Score penalty per metre of travel. */
  pathWeight: number;
  /** Score bonus per metre closer than the farthest ring (closer views have less depth noise). */
  closenessWeight: number;
  cell: ViewpointCellConfig;
}

export const DEFAULT_PLANNER: PlannerConfig = {
  // Far enough that a ~1 m object is not cut off by the bottom of the 50° view (camera 1.0 m
  // high, pitched −10°: the lowest ray meets the floor 1.43 m ahead); near enough for depth
  // noise below the 30 mm evidence gate. Both rings lie in range bin r2 (1.5–2.25 m).
  ranges: [1.9, 2.2],
  bearingStepDeg: 30,
  ownFootprint: 0.8,
  saturatingChangeDeg: 75,
  pathWeight: 0.12,
  closenessWeight: 0.3,
  cell: DEFAULT_CELL,
};

export interface PlannedViewpoint {
  x: number;
  z: number;
  /** Heading that faces the candidate. */
  theta: number;
  cell: string;
  range: number;
  bearingDeg: number;
  pathLength: number;
  score: number;
  reason: string;
}

export function planNextViewpoint(
  candidate: { x: number; z: number },
  robot: { x: number; z: number },
  usedCells: Set<string>,
  priorBearings: number[],
  nav: NavQuery,
  cfg: PlannerConfig = DEFAULT_PLANNER,
): PlannedViewpoint | null {
  const maxRange = Math.max(...cfg.ranges);
  let best: PlannedViewpoint | null = null;
  for (const r of cfg.ranges) {
    for (let b = cfg.bearingStepDeg / 2; b < 360; b += cfg.bearingStepDeg) {
      const rad = (b * Math.PI) / 180;
      const p = { x: candidate.x + r * Math.cos(rad), z: candidate.z + r * Math.sin(rad) };
      if (!nav.isFree(p.x, p.z)) continue;
      const cell = viewpointCell(p, candidate, cfg.cell);
      if (usedCells.has(cell.key)) continue;
      if (!nav.lineOfSight(p, candidate, cfg.ownFootprint)) continue;
      const len = nav.pathLength(robot, p);
      if (len === null) continue;
      const change = priorBearings.length
        ? Math.min(...priorBearings.map((pb) => bearingDiff(pb, cell.bearingDeg)))
        : 0;
      const changeTerm = priorBearings.length ? Math.min(change, cfg.saturatingChangeDeg) / cfg.saturatingChangeDeg : 0;
      const score = 2 * changeTerm + cfg.closenessWeight * (maxRange - r) - cfg.pathWeight * len;
      if (!best || score > best.score) {
        best = {
          x: p.x,
          z: p.z,
          theta: Math.atan2(candidate.z - p.z, candidate.x - p.x),
          cell: cell.key,
          range: r,
          bearingDeg: wrapDeg(cell.bearingDeg),
          pathLength: len,
          score,
          reason: priorBearings.length
            ? `new viewpoint ${Math.round(change)}° from earlier views at ${r.toFixed(1)} m; ${len.toFixed(1)} m travel`
            : `nearest reachable verification viewpoint at ${r.toFixed(1)} m; ${len.toFixed(1)} m travel`,
        };
      }
    }
  }
  return best;
}
