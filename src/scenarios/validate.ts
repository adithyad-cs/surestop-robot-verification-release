// Physical and navigational checks for a scenario instance (ground-truth side; tests, the layout
// generator and the console's post-mission view use it). It rebuilds the same prior map the world
// builder makes (walls plus non-poster footprints, inflated) and runs the real A* planner on it.
// Nothing here is passed to robot-facing code.
import { OccupancyGrid, type Rect } from "@/nav/grid";
import { planPath } from "@/nav/astar";
import { DEFAULT_PLANNER } from "@/verify/planner";
import { GRID_RES, INFLATION } from "@/sim/navParams";
import { ROBOT_CAMERA } from "@/sim/sensorRenderer";
import { BOUNDS, ROUTE, WALLS, WALL_T, type ModelRef, type PlacedObject, type RouteWaypoint, type ScenarioInstance } from "./layout";

const DEG = Math.PI / 180;

/** Local (pre-yaw) floor footprints in metres. Asset sizes are the normalised GLB bounds. */
export function localFootprint(m: ModelRef): Rect | null {
  const centred = (w: number, d: number): Rect => ({ minX: -w / 2, maxX: w / 2, minZ: -d / 2, maxZ: d / 2 });
  switch (m.type) {
    case "poster":
      return null; // wall-mounted; not in the navigation map
    case "box":
      return centred(m.w, m.d);
    case "screen":
      return centred(1.3, 0.42);
    case "board":
      // Board face at z = 0; rear easel legs reach about 0.33 m behind it.
      return { minX: -m.width / 2, maxX: m.width / 2, minZ: -0.35, maxZ: 0.02 };
    case "asset": {
      const sizes: Record<string, [number, number]> = {
        plant: [0.79, 0.74],
        vaseFlowers: [0.64, 0.42],
        sheenChair: [0.83, 0.57],
        damaskChair: [0.83, 0.57],
        velvetSofa: [2.2, 1.03],
        pouf: [1.3, 1.3],
      };
      const s = sizes[m.assetId];
      if (!s) throw new Error(`no footprint for asset ${m.assetId}`);
      return centred(s[0], s[1]);
    }
  }
}

/** Assets whose plan shape is a disc (the pouf). */
const ROUND_ASSETS = new Set(["pouf"]);

/** World-axis bounding rectangle of an object's footprint (as THREE.Box3 would give), or null for posters. */
export function worldFootprint(o: PlacedObject): Rect | null {
  const l = localFootprint(o.model);
  if (!l) return null;
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [lx, lz] of [[l.minX, l.minZ], [l.maxX, l.minZ], [l.minX, l.maxZ], [l.maxX, l.maxZ]]) {
    // Three.js rotation about +Y: x' = x cos + z sin, z' = -x sin + z cos.
    const x = o.x + lx * c + lz * s;
    const z = o.z - lx * s + lz * c;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  return { minX, minZ, maxX, maxZ };
}

/** Wall-mounted extent of a poster along its wall (a thin rectangle on the wall face). */
export function posterSpan(o: PlacedObject): Rect | null {
  if (o.model.type !== "poster") return null;
  const half = o.model.width / 2 + 0.04;
  const alongX = Math.abs(Math.cos(o.yaw)) > 0.5;
  return alongX
    ? { minX: o.x - half, maxX: o.x + half, minZ: o.z - 0.03, maxZ: o.z + 0.03 }
    : { minX: o.x - 0.03, maxX: o.x + 0.03, minZ: o.z - half, maxZ: o.z + half };
}

/** Unit vector a picture faces (local +Z after yaw). */
export function facing(o: PlacedObject): { x: number; z: number } {
  return { x: Math.sin(o.yaw), z: Math.cos(o.yaw) };
}

export const isPicture = (o: PlacedObject) => o.model.type === "poster" || o.model.type === "screen" || o.model.type === "board";
export const isSemantic = (o: PlacedObject) => o.kind === "target" || o.kind === "picture-decoy" || o.kind === "screen-decoy" || o.kind === "lookalike";

/** Point the camera aims at when looking at an object (picture centre, or footprint centre). */
export function lookPoint(o: PlacedObject): { x: number; z: number } {
  if (o.model.type === "poster") {
    const n = facing(o);
    return { x: o.x + n.x * 0.05, z: o.z + n.z * 0.05 };
  }
  if (o.model.type === "screen") {
    const n = facing(o);
    return { x: o.x - n.x * 0.08, z: o.z - n.z * 0.08 };
  }
  return { x: o.x, z: o.z };
}

export function buildPriorGrid(objects: PlacedObject[]): OccupancyGrid {
  const grid = buildSightGrid(objects);
  grid.inflate(INFLATION);
  return grid;
}

/**
 * Raw occupancy (walls plus floor footprints) for line-of-sight checks, leaving out `exclude`.
 * Visibility of an object is always checked on a grid without that object, so its own footprint
 * never hides it and every other footprint, however close, still can. One model serves
 * observability, occlusion and the generator.
 */
export function buildSightGrid(objects: PlacedObject[], exclude: PlacedObject[] = []): OccupancyGrid {
  const grid = new OccupancyGrid(BOUNDS, GRID_RES);
  WALLS.forEach((r) => grid.addRect(r));
  for (const o of objects) {
    if (exclude.includes(o)) continue;
    const f = worldFootprint(o);
    if (f) grid.addRect(f);
  }
  return grid;
}

/**
 * A print's look point lies in the wall's own grid cells (walls are 0.12 m thick on a 0.1 m grid),
 * so the ray stops this short of it. Floor objects use no stop distance.
 */
export const WALL_PRINT_STOP = 0.15;

/** True if nothing in `sightGrid` (built without `o`) blocks the 2-D ray from `from` to `o`. */
export function objectVisible(sightGrid: OccupancyGrid, from: { x: number; z: number }, o: PlacedObject): boolean {
  return sightGrid.lineOfSight(from, lookPoint(o), o.model.type === "poster" ? WALL_PRINT_STOP : 0);
}

// ------------------------------------------------------------------ geometry helpers

export function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX);
  const dz = Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ);
  return Math.hypot(dx, dz);
}

function pointRectDist(p: { x: number; z: number }, r: Rect): number {
  const dx = Math.max(0, r.minX - p.x, p.x - r.maxX);
  const dz = Math.max(0, r.minZ - p.z, p.z - r.maxZ);
  return Math.hypot(dx, dz);
}

function segIntersectsRect(a: { x: number; z: number }, b: { x: number; z: number }, r: Rect): boolean {
  // Liang–Barsky clip.
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dz = b.z - a.z;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
    return true;
  };
  return clip(-dx, a.x - r.minX) && clip(dx, r.maxX - a.x) && clip(-dz, a.z - r.minZ) && clip(dz, r.maxZ - a.z) && t0 <= t1;
}

/** Shortest distance from a rectangle to a segment (0 if they intersect). */
export function segRectDist(a: { x: number; z: number }, b: { x: number; z: number }, r: Rect): number {
  if (segIntersectsRect(a, b, r)) return 0;
  let best = Math.min(pointSegDist({ x: r.minX, z: r.minZ }, a, b), pointSegDist({ x: r.maxX, z: r.minZ }, a, b), pointSegDist({ x: r.minX, z: r.maxZ }, a, b), pointSegDist({ x: r.maxX, z: r.maxZ }, a, b));
  best = Math.min(best, pointRectDist(a, r), pointRectDist(b, r));
  return best;
}

function pointSegDist(p: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = b.x - a.x, dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// ------------------------------------------------------------------ route observation model

export interface ObsPose {
  x: number;
  z: number;
  theta: number;
  /** Index in the simulated search sequence (earlier = seen first). */
  index: number;
  waypoint: number;
}

/** Half the horizontal field of view of the robot camera, minus a margin for the bbox to fit. */
export const OBS_HALF_FOV_DEG =
  (Math.atan(Math.tan((ROBOT_CAMERA.vfovDeg / 2) * DEG) * (ROBOT_CAMERA.width / ROBOT_CAMERA.height)) / DEG) - 4;
/** Below this range the bottom of a ~1 m object leaves the frame (camera 1.0 m high, pitched −10°). */
export const OBS_MIN_RANGE = 1.6;
export const OBS_MAX_RANGE = 5.5;
/** Pictures must face the camera within this angle to be recognisable. */
export const OBS_MAX_INCIDENCE_DEG = 60;

/**
 * Simulates the search route as the mission runner drives it, without verification detours:
 * A* between waypoints, a frame every `observeEvery` metres facing the direction of travel, and
 * the waypoint scan headings. Returns the camera poses, or the first leg that A* cannot plan.
 */
export function simulateSearch(
  grid: OccupancyGrid,
  start: { x: number; z: number; theta: number },
  route: RouteWaypoint[] = ROUTE,
  observeEvery = 1.0,
): { poses: ObsPose[]; legLengths: number[]; failedLeg: number | null } {
  const poses: ObsPose[] = [];
  const legLengths: number[] = [];
  let pose = { x: start.x, z: start.z, theta: start.theta };
  poses.push({ ...pose, index: 0, waypoint: -1 });
  for (let i = 0; i < route.length; i++) {
    const wp = route[i];
    const p = planPath(grid, pose, wp);
    if (!p) return { poses, legLengths, failedLeg: i };
    legLengths.push(p.length);
    let carry = 0;
    for (let k = 1; k < p.points.length; k++) {
      const a = p.points[k - 1], b = p.points[k];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const th = Math.atan2(b.z - a.z, b.x - a.x);
      let s = observeEvery - carry;
      while (s <= len + 1e-9) {
        poses.push({ x: a.x + ((b.x - a.x) * s) / len, z: a.z + ((b.z - a.z) * s) / len, theta: th, index: poses.length, waypoint: i });
        s += observeEvery;
      }
      carry = len - (s - observeEvery);
      pose = { x: b.x, z: b.z, theta: th };
    }
    for (const h of wp.scan ?? []) {
      pose = { ...pose, theta: h * DEG };
      poses.push({ ...pose, index: poses.length, waypoint: i });
    }
  }
  return { poses, legLengths, failedLeg: null };
}

export interface Sighting {
  index: number;
  range: number;
  bearingOffDeg: number;
  incidenceDeg: number | null;
}

/**
 * Route poses from which the object is geometrically in view (FOV, range, LOS, facing).
 * `sightGrid` must be built without `o` (buildSightGrid(objects, [o])).
 */
export function sightings(sightGrid: OccupancyGrid, o: PlacedObject, poses: ObsPose[], opts: { ignoreLos?: boolean } = {}): Sighting[] {
  const c = lookPoint(o);
  const out: Sighting[] = [];
  for (const p of poses) {
    const dx = c.x - p.x, dz = c.z - p.z;
    const range = Math.hypot(dx, dz);
    if (range < OBS_MIN_RANGE || range > OBS_MAX_RANGE) continue;
    const off = Math.abs(wrap(Math.atan2(dz, dx) - p.theta)) / DEG;
    if (off > OBS_HALF_FOV_DEG) continue;
    let incidence: number | null = null;
    if (isPicture(o)) {
      const n = facing(o);
      incidence = Math.acos(Math.max(-1, Math.min(1, (-dx * n.x - dz * n.z) / range))) / DEG;
      if (incidence > OBS_MAX_INCIDENCE_DEG) continue;
    }
    if (!opts.ignoreLos && !objectVisible(sightGrid, p, o)) continue;
    out.push({ index: p.index, range, bearingOffDeg: off, incidenceDeg: incidence });
  }
  return out;
}

/**
 * Verification viewpoints the SureStop planner could use around an object (free, LOS, A*-reachable).
 * This mirrors the robot's own planner check (verify/planner.ts) on the robot's map, including its
 * 0.8 m own-footprint allowance; it models what the robot will do, not what is visible.
 */
export function verificationViewpoints(grid: OccupancyGrid, o: PlacedObject, from: { x: number; z: number }): number[] {
  const c = lookPoint(o);
  const bearings: number[] = [];
  for (const r of DEFAULT_PLANNER.ranges) {
    for (let b = DEFAULT_PLANNER.bearingStepDeg / 2; b < 360; b += DEFAULT_PLANNER.bearingStepDeg) {
      const p = { x: c.x + r * Math.cos(b * DEG), z: c.z + r * Math.sin(b * DEG) };
      if (!grid.isFree(p.x, p.z)) continue;
      if (!grid.lineOfSight(p, c, DEFAULT_PLANNER.ownFootprint)) continue;
      if (isPicture(o)) {
        const n = facing(o);
        const v = { x: (p.x - c.x) / r, z: (p.z - c.z) / r };
        if (v.x * n.x + v.z * n.z <= 0) continue; // behind the picture or the wall
      }
      if (!planPath(grid, from, p)) continue;
      bearings.push(b);
    }
  }
  return bearings;
}

function bearingSpread(bs: number[]): number {
  let best = 0;
  for (const a of bs) for (const b of bs) best = Math.max(best, Math.abs(wrap((a - b) * DEG)) / DEG);
  return best;
}

// ------------------------------------------------------------------ report

export interface LayoutCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface ObjectReport {
  id: string;
  kind: PlacedObject["kind"];
  firstSeenIndex: number | null;
  sightings: number;
  verificationViewpoints: number;
  viewpointSpreadDeg: number;
}

export interface LayoutReport {
  ok: boolean;
  checks: LayoutCheck[];
  objects: ObjectReport[];
  routeLength: number | null;
  observationPoses: number;
}

/** Thresholds a usable layout must meet. The recorded (v1) layouts meet all of them. */
export const CHECK_LIMITS = {
  /** Minimum gap between two floor footprints (m). */
  minObjectGap: 0.05,
  /** Interior-wall faces and outer walls: footprints must stay inside by this margin (m). */
  wallMargin: 0.0,
  /** Target needs this many reachable verification viewpoints, spanning at least this bearing range. */
  targetViewpoints: 3,
  targetSpreadDeg: 60,
  /** Decoys need at least this many, so the verifier can re-observe them. */
  decoyViewpoints: 2,
};

export interface ValidateOptions {
  /**
   * Navigation map to check against instead of the analytic one (e.g. the world builder's grid in
   * a browser test). Line-of-sight checks always use the analytic footprints, which can exclude
   * single objects.
   */
  navGrid?: OccupancyGrid;
}

export function validateInstance(inst: ScenarioInstance, opts: ValidateOptions = {}): LayoutReport {
  const checks: LayoutCheck[] = [];
  const add = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });
  const objs = inst.objects;
  const fps = objs.map((o) => ({ o, f: worldFootprint(o) }));

  // 1. Inside the rooms, clear of the walls, not straddling the interior wall.
  const inner: Rect = { minX: BOUNDS.minX + WALL_T, minZ: BOUNDS.minZ + WALL_T, maxX: BOUNDS.maxX - WALL_T, maxZ: BOUNDS.maxZ - WALL_T };
  const bad: string[] = [];
  for (const { o, f } of fps) {
    if (!f) {
      const s = posterSpan(o)!;
      const onWall = WALLS.some((w) => rectGap(w, s) < 0.01);
      const inRange = s.minX >= inner.minX - 0.05 && s.maxX <= inner.maxX + 0.05 && s.minZ >= inner.minZ - 0.05 && s.maxZ <= inner.maxZ + 0.05;
      if (!onWall || !inRange) bad.push(`${o.id} (poster not on a wall face)`);
      continue;
    }
    // Round assets: the physical extent is the unrotated disc, not the rotated bounding box the
    // navigation map uses (that box may touch a wall without the object doing so).
    const l = localFootprint(o.model)!;
    const phys = o.model.type === "asset" && ROUND_ASSETS.has(o.model.assetId) ? { minX: o.x + l.minX, maxX: o.x + l.maxX, minZ: o.z + l.minZ, maxZ: o.z + l.maxZ } : f;
    const m = CHECK_LIMITS.wallMargin;
    if (phys.minX < inner.minX + m || phys.maxX > inner.maxX - m || phys.minZ < inner.minZ + m || phys.maxZ > inner.maxZ - m) bad.push(`${o.id} (outside walls)`);
    if (WALLS.slice(4).some((w) => rectGap(w, phys) <= 0)) bad.push(`${o.id} (intersects interior wall)`);
  }
  add("inside-walls", bad.length === 0, bad.length ? bad.join("; ") : `${objs.length} objects inside the rooms`);

  // 2. No overlaps between floor objects, or between wall-mounted pictures.
  const overlaps: string[] = [];
  for (let i = 0; i < fps.length; i++) {
    for (let j = i + 1; j < fps.length; j++) {
      const a = fps[i], b = fps[j];
      const ra = a.f ?? posterSpan(a.o)!, rb = b.f ?? posterSpan(b.o)!;
      if (!a.f && b.f && b.o.kind !== "screen-decoy") continue; // a floor object may stand below a print
      if (!b.f && a.f && a.o.kind !== "screen-decoy") continue;
      const g = rectGap(ra, rb);
      if (g < CHECK_LIMITS.minObjectGap) overlaps.push(`${a.o.id}/${b.o.id} gap ${g.toFixed(2)} m`);
    }
  }
  add("no-overlap", overlaps.length === 0, overlaps.length ? overlaps.join("; ") : "all footprints separated");

  // 3. Navigation: start free, every route leg plannable by the real A*.
  const grid = opts.navGrid ?? buildPriorGrid(objs);
  const startFree = grid.isFree(inst.start.x, inst.start.z) || !!grid.nearestFree(inst.start.x, inst.start.z, 0.6);
  add("start-free", startFree, `start (${inst.start.x.toFixed(2)}, ${inst.start.z.toFixed(2)})`);
  const wpBlocked = ROUTE.map((w, i) => (grid.nearestFree(w.x, w.z, 0.3) ? null : i)).filter((i) => i !== null);
  add("waypoints-free", wpBlocked.length === 0, wpBlocked.length ? `blocked waypoints ${wpBlocked.join(",")}` : `${ROUTE.length} waypoints free`);
  const sim = simulateSearch(grid, inst.start);
  const routeLength = sim.failedLeg === null ? sim.legLengths.reduce((a, b) => a + b, 0) : null;
  add("route-astar", sim.failedLeg === null, sim.failedLeg === null ? `route ${routeLength!.toFixed(1)} m, ${sim.poses.length} observation poses` : `A* found no path to waypoint ${sim.failedLeg}`);

  // 4. Observability, reachability, verification viewpoints.
  const reports: ObjectReport[] = [];
  const semantic = objs.filter(isSemantic);
  for (const o of semantic) {
    const s = sightings(buildSightGrid(objs, [o]), o, sim.poses);
    const vps = verificationViewpoints(grid, o, inst.start);
    reports.push({ id: o.id, kind: o.kind, firstSeenIndex: s.length ? s[0].index : null, sightings: s.length, verificationViewpoints: vps.length, viewpointSpreadDeg: bearingSpread(vps) });
  }
  const unseen = reports.filter((r) => r.firstSeenIndex === null).map((r) => r.id);
  add("observable-from-route", unseen.length === 0, unseen.length ? `never in view: ${unseen.join(", ")}` : reports.map((r) => `${r.id}: ${r.sightings} poses`).join("; "));

  const target = objs.find((o) => o.kind === "target");
  if (target) {
    const r = reports.find((x) => x.id === target.id)!;
    add(
      "target-verifiable",
      r.verificationViewpoints >= CHECK_LIMITS.targetViewpoints && r.viewpointSpreadDeg >= CHECK_LIMITS.targetSpreadDeg,
      `${r.verificationViewpoints} reachable viewpoints spanning ${r.viewpointSpreadDeg.toFixed(0)}°`,
    );
    let approach = false;
    for (let k = 0; k < 8 && !approach; k++) {
      const a = (k * 45 * Math.PI) / 180;
      const g = grid.nearestFree(target.x + Math.cos(a) * 0.9, target.z + Math.sin(a) * 0.9, 1.0);
      approach = !!g && !!planPath(grid, inst.start, g);
    }
    add("target-approachable", approach, approach ? "a 0.9 m stand-off point is A*-reachable" : "no reachable stand-off point");
  }
  const decoyReports = reports.filter((r) => r.kind !== "target");
  const weak = decoyReports.filter((r) => r.verificationViewpoints < CHECK_LIMITS.decoyViewpoints).map((r) => `${r.id} (${r.verificationViewpoints})`);
  add("decoys-reobservable", weak.length === 0, weak.length ? `too few viewpoints: ${weak.join(", ")}` : decoyReports.length ? decoyReports.map((r) => `${r.id}: ${r.verificationViewpoints}`).join("; ") : "no decoys");

  // 5. Scenario semantics.
  const sem: string[] = [];
  if (inst.scenario.targetPresent !== !!target) sem.push(inst.scenario.targetPresent ? "target missing" : "target present in a target-absent scenario");
  if (objs.filter((o) => o.kind === "target").length > 1) sem.push("more than one target");
  if (target) {
    const t = reports.find((x) => x.id === target.id)!;
    const late = decoyReports.filter((d) => d.firstSeenIndex !== null && t.firstSeenIndex !== null && d.firstSeenIndex >= t.firstSeenIndex);
    if (late.length && inst.scenario.difficulty !== "baseline") sem.push(`decoy seen after target: ${late.map((d) => d.id).join(", ")}`);
  }
  const occ = objs.find((o) => o.id === "crate-occ");
  if (inst.scenario.id === "occluded-target") {
    if (!occ || !target) sem.push("occluder or target missing");
    else {
      // Same visibility model as observability: the first route pose that would see the target if
      // the crate were absent must lose sight of it when the crate is present.
      const first = sightings(buildSightGrid(objs, [target, occ]), target, sim.poses)[0];
      const p = first ? sim.poses[first.index] : null;
      if (!p) sem.push("target never in view even without the crate");
      else if (objectVisible(buildSightGrid(objs, [target]), p, target)) sem.push("crate does not occlude the first view of the target");
    }
  }
  add("scenario-semantics", sem.length === 0, sem.length ? sem.join("; ") : `${inst.scenario.id}: semantics hold`);

  return { ok: checks.every((c) => c.pass), checks, objects: reports, routeLength, observationPoses: sim.poses.length };
}

// ------------------------------------------------------------------ analytic map vs built map

export interface GridComparison {
  cells: number;
  /** Raw occupancy. */
  occupiedBoth: number;
  analyticOnly: number;
  /** Occupied in the built world but free in the analytic map: obstacles the validator misses. */
  worldOnly: number;
  /** Largest distance (cells) from a world-only occupied cell to the nearest analytic occupied cell. */
  worldOnlyMaxDistCells: number;
  /** Inflated (robot-centre) masks. */
  blockedAnalyticOnly: number;
  blockedWorldOnly: number;
  blockedWorldOnlyMaxDistCells: number;
}

function maskDiff(a: Uint8Array, b: Uint8Array, cols: number, rows: number) {
  let both = 0, aOnly = 0, bOnly = 0, maxDist = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) both++;
    else if (a[i]) aOnly++;
    else if (b[i]) {
      bOnly++;
      // Chebyshev distance to the nearest cell set in `a` (searched up to 10 cells).
      const c = i % cols, r = (i - c) / cols;
      let d = 11;
      for (let k = 1; k <= 10 && d > 10; k++) {
        for (let dr = -k; dr <= k && d > 10; dr++) {
          for (let dc = -k; dc <= k; dc++) {
            if (Math.max(Math.abs(dr), Math.abs(dc)) !== k) continue;
            const cc = c + dc, rr = r + dr;
            if (cc >= 0 && rr >= 0 && cc < cols && rr < rows && a[rr * cols + cc]) {
              d = k;
              break;
            }
          }
        }
      }
      maxDist = Math.max(maxDist, d);
    }
  }
  return { both, aOnly, bOnly, maxDist };
}

/** Cell-by-cell comparison of the validator's analytic map with a built (world) map. */
export function compareGrids(analytic: OccupancyGrid, world: OccupancyGrid): GridComparison {
  if (analytic.cols !== world.cols || analytic.rows !== world.rows) throw new Error("grids differ in size");
  const occ = maskDiff(analytic.occ, world.occ, analytic.cols, analytic.rows);
  const blk = maskDiff(analytic.blocked, world.blocked, analytic.cols, analytic.rows);
  return {
    cells: analytic.occ.length,
    occupiedBoth: occ.both,
    analyticOnly: occ.aOnly,
    worldOnly: occ.bOnly,
    worldOnlyMaxDistCells: occ.maxDist,
    blockedAnalyticOnly: blk.aOnly,
    blockedWorldOnly: blk.bOnly,
    blockedWorldOnlyMaxDistCells: blk.maxDist,
  };
}
