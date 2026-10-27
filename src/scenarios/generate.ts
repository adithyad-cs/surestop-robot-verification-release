// Seeded world-layout generation. `instantiateLayout(scenarioId, seed, "v1")` is the recorded
// evaluation layout (fixed object slots with small jitter, unchanged); "v2" re-places the same
// scenario objects across zones of both rooms, then accepts the layout only if it passes the
// physical and navigational checks in validate.ts. Ground-truth side only: robot-facing modules
// never import this file.
import { deriveSeed, mulberry32, uniform } from "@/lib/rng";
import type { Rect } from "@/nav/grid";
import { ROUTE, SCENARIOS, WALL_T, WALLS, BOUNDS, instantiate, type LayoutInfo, type LayoutVersion, type PlacedObject, type ScenarioInstance } from "./layout";
import { buildPriorGrid, buildSightGrid, posterSpan, rectGap, segRectDist, sightings, simulateSearch, validateInstance, worldFootprint, type LayoutReport } from "./validate";

export const LAYOUT_VERSIONS: LayoutVersion[] = ["v2", "v1"];
export const DEFAULT_LAYOUT: LayoutVersion = "v1";
/** Whole-layout attempts before falling back to the v1 layout (flagged in the layout id). */
export const MAX_ATTEMPTS = 32;
/** Sampling tries per object within one attempt. */
const TRIES_PER_OBJECT = 30;
/** Target positions tried per attempt when the scenario also needs an occluder. */
const TARGET_TRIES_WITH_OCCLUDER = 8;

const DEG = Math.PI / 180;
type Rng = () => number;
type Pt = { x: number; z: number };

interface Zone {
  label: string;
  x: [number, number];
  z: [number, number];
  /** Yaw for a sampled position. */
  yaw: (rng: Rng, p: Pt) => number;
  /** Wall-mounted centre height range (posters). */
  y?: [number, number];
}

const jit = (rng: Rng, a: number) => uniform(rng, -a, a);
const pick = <T,>(rng: Rng, xs: T[]): T => xs[Math.min(xs.length - 1, Math.floor(rng() * xs.length))];
/** Yaw that turns an object's local +Z (its front / printed face) towards point f. */
const yawTowards = (p: Pt, f: Pt) => Math.atan2(f.x - p.x, f.z - p.z);
const fixedYaw = (deg: number, jitterDeg = 0) => (rng: Rng) => (deg + jit(rng, jitterDeg)) * DEG;
const anyYaw = (rng: Rng) => uniform(rng, -Math.PI, Math.PI);

const N_FACE = -5 + WALL_T; // inner face of the north wall (z)
const S_FACE = 5 - WALL_T;
const W_FACE = -7 + WALL_T; // inner face of the west wall (x)
const I_FACE = -WALL_T / 2; // west face of the interior wall (x)

const W1 = ROUTE[1], W2 = ROUTE[2];
const nearestOf = (p: Pt, pts: Pt[]) => pts.reduce((b, q) => (Math.hypot(q.x - p.x, q.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? q : b));

// ------------------------------------------------------------------ zones
// The target stays in the east room and decoys in the west room, so the route still meets the
// decoy first ("decoy first" scenarios). Within each room every wall and the open floor is used.

const PLANT_ZONES: Zone[] = [
  { label: "east-north", x: [3.4, 6.2], z: [-4.3, -3.1], yaw: anyYaw },
  { label: "east-wall", x: [6.0, 6.4], z: [-3.8, 3.8], yaw: anyYaw },
  { label: "east-centre", x: [2.9, 3.9], z: [0.2, 1.4], yaw: anyYaw },
  { label: "east-south", x: [5.0, 6.3], z: [3.6, 4.4], yaw: anyYaw },
  { label: "east-northwest", x: [0.6, 1.6], z: [-4.4, -3.3], yaw: anyYaw },
];

const POSTER_ZONES: Zone[] = [
  { label: "west-room north wall", x: [-5.6, -1.0], z: [N_FACE + 0.002, N_FACE + 0.002], yaw: fixedYaw(0), y: [1.05, 1.25] },
  { label: "interior wall", x: [I_FACE - 0.002, I_FACE - 0.002], z: [-4.4, 0.5], yaw: fixedYaw(-90), y: [1.05, 1.25] },
  { label: "west wall", x: [W_FACE + 0.002, W_FACE + 0.002], z: [0.8, 4.0], yaw: fixedYaw(90), y: [1.05, 1.25] },
  { label: "west-room south wall", x: [-4.4, -0.8], z: [S_FACE - 0.002, S_FACE - 0.002], yaw: fixedYaw(180), y: [1.05, 1.25] },
];

const SCREEN_ZONES: Zone[] = [
  { label: "interior wall", x: [I_FACE - 0.24, I_FACE - 0.24], z: [-4.3, -0.4], yaw: fixedYaw(-90) },
  { label: "west-room north wall", x: [-5.4, -1.0], z: [N_FACE + 0.24, N_FACE + 0.24], yaw: fixedYaw(0) },
  { label: "west wall", x: [W_FACE + 0.24, W_FACE + 0.24], z: [1.0, 4.1], yaw: fixedYaw(90) },
  { label: "west-room south wall", x: [-4.2, -1.0], z: [S_FACE - 0.24, S_FACE - 0.24], yaw: fixedYaw(180) },
];

/** Free-standing west-room spots; a photo board turns its face towards a nearby route stretch. */
const WEST_FLOOR_ZONES: Array<Zone & { focus: (p: Pt) => Pt }> = [
  { label: "west-room north strip", x: [-5.0, -1.6], z: [-4.4, -3.8], yaw: anyYaw, focus: (p) => nearestOf(p, [W1, W2]) },
  { label: "west-room centre", x: [-4.6, -3.4], z: [-1.6, 0.4], yaw: anyYaw, focus: () => W1 },
  { label: "west-room south strip", x: [-4.4, -2.9], z: [2.8, 4.3], yaw: anyYaw, focus: () => ({ x: -2.55, z: 0.5 }) },
  { label: "interior-wall strip", x: [-1.4, -0.8], z: [-4.3, -0.6], yaw: anyYaw, focus: () => W2 },
];

const FURNITURE_ZONES: Record<string, Zone[]> = {
  sofa: [
    { label: "west-room south wall", x: [-4.2, -2.4], z: [4.33, 4.33], yaw: fixedYaw(180) },
    { label: "west-room north wall", x: [-4.9, -1.4], z: [-4.33, -4.33], yaw: fixedYaw(0) },
    { label: "east-room south wall", x: [3.6, 5.6], z: [4.33, 4.33], yaw: fixedYaw(180) },
    { label: "east-room north wall", x: [2.0, 5.4], z: [-4.33, -4.33], yaw: fixedYaw(0) },
    { label: "east wall", x: [6.33, 6.33], z: [-3.6, -2.6], yaw: fixedYaw(-90) },
  ],
  chair: [
    { label: "east-room north wall", x: [0.8, 6.2], z: [-4.38, -4.38], yaw: fixedYaw(0, 15) },
    { label: "east-room south wall", x: [0.9, 6.2], z: [4.38, 4.38], yaw: fixedYaw(180, 15) },
    { label: "west-room north wall", x: [-6.2, -1.0], z: [-4.38, -4.38], yaw: fixedYaw(0, 15) },
    { label: "west-room south wall", x: [-4.6, -0.8], z: [4.38, 4.38], yaw: fixedYaw(180, 15) },
    { label: "east wall", x: [6.45, 6.45], z: [-3.6, 3.8], yaw: fixedYaw(-90, 15) },
  ],
  pouf: [
    { label: "east-room south", x: [1.4, 6.0], z: [3.85, 4.05], yaw: fixedYaw(0, 10) },
    { label: "east-room north", x: [1.5, 6.0], z: [-4.05, -3.85], yaw: fixedYaw(0, 10) },
    { label: "west-room south", x: [-4.3, -1.0], z: [3.85, 4.05], yaw: fixedYaw(0, 10) },
    { label: "west-room north", x: [-6.0, -1.0], z: [-4.05, -3.85], yaw: fixedYaw(0, 10) },
  ],
  crate: [
    { label: "west-room south wall", x: [-4.4, -0.6], z: [4.5, 4.5], yaw: fixedYaw(0, 5) },
    { label: "west-room north wall", x: [-6.4, -0.8], z: [-4.5, -4.5], yaw: fixedYaw(0, 5) },
    { label: "east-room south wall", x: [0.6, 6.3], z: [4.5, 4.5], yaw: fixedYaw(0, 5) },
    { label: "east wall", x: [6.5, 6.5], z: [-3.5, 3.8], yaw: fixedYaw(90, 5) },
    { label: "west wall, north end", x: [-6.5, -6.5], z: [-4.3, -3.0], yaw: fixedYaw(90, 5) },
  ],
};

const START_ZONES: Zone[] = [
  { label: "south-west", x: [-6.2, -4.6], z: [2.6, 4.3], yaw: anyYaw },
  { label: "south-centre", x: [-4.2, -2.9], z: [2.6, 4.3], yaw: anyYaw },
  { label: "west", x: [-6.2, -4.8], z: [0.9, 2.4], yaw: anyYaw },
];

// ------------------------------------------------------------------ placement rules
// Stricter than the validator: the generator keeps the route corridor, the doorway and the space
// in front of pictures clear, so the fixed search route is not obstructed.

const RULES = {
  wallMargin: 0.03,
  objectGap: 0.25,
  /** Clearance from a footprint to every route segment (robot inflation is 0.32 m). */
  routeClearance: 0.45,
  /** The occluder stands between the target and a route pose, so it may come closer (still > 0.32 m). */
  occluderRouteClearance: 0.38,
  waypointClearance: 0.75,
  startClearance: 0.6,
  /** Floor space kept clear in front of a wall print (m). */
  pictureApron: 1.0,
  doorway: { minX: -1.0, maxX: 1.0, minZ: 0.5, maxZ: 2.9 } as Rect,
};

const INNER: Rect = { minX: BOUNDS.minX + WALL_T, minZ: BOUNDS.minZ + WALL_T, maxX: BOUNDS.maxX - WALL_T, maxZ: BOUNDS.maxZ - WALL_T };
const INTERIOR_WALLS = WALLS.slice(4);

function apron(o: PlacedObject): Rect | null {
  const s = posterSpan(o);
  if (!s) return null;
  const nx = Math.round(Math.sin(o.yaw)), nz = Math.round(Math.cos(o.yaw));
  const d = RULES.pictureApron;
  return {
    minX: Math.min(s.minX, s.minX + nx * d),
    maxX: Math.max(s.maxX, s.maxX + nx * d),
    minZ: Math.min(s.minZ, s.minZ + nz * d),
    maxZ: Math.max(s.maxZ, s.maxZ + nz * d),
  };
}

function routeSegments(start: Pt): Array<[Pt, Pt]> {
  const pts: Pt[] = [start, ...ROUTE];
  return pts.slice(1).map((p, i) => [pts[i], p]);
}

/**
 * True if `o` can be added to `placed` under the generator rules. `closeTo` lets an occluder
 * stand nearer than the usual gap to the one object it is meant to hide.
 */
function admissible(o: PlacedObject, placed: PlacedObject[], start: Pt, closeTo?: { id: string; gap: number; routeClearance: number }): boolean {
  const f = worldFootprint(o);
  if (!f) {
    const s = posterSpan(o)!;
    const ap = apron(o)!;
    for (const q of placed) {
      const qs = posterSpan(q);
      if (qs && rectGap(qs, s) < 0.4) return false;
      const qf = worldFootprint(q);
      if (qf && rectGap(qf, ap) < 0.05) return false;
    }
    return true;
  }
  const m = RULES.wallMargin;
  if (f.minX < INNER.minX + m || f.maxX > INNER.maxX - m || f.minZ < INNER.minZ + m || f.maxZ > INNER.maxZ - m) return false;
  if (INTERIOR_WALLS.some((w) => rectGap(w, f) < 0.05)) return false;
  if (rectGap(f, RULES.doorway) <= 0) return false;
  const routeClearance = closeTo?.routeClearance ?? RULES.routeClearance;
  for (const [a, b] of routeSegments(start)) if (segRectDist(a, b, f) < routeClearance) return false;
  for (const w of ROUTE) if (segRectDist(w, w, f) < RULES.waypointClearance) return false;
  if (segRectDist(start, start, f) < RULES.startClearance) return false;
  for (const q of placed) {
    const qf = worldFootprint(q);
    const minGap = closeTo && q.id === closeTo.id ? closeTo.gap : RULES.objectGap;
    if (qf && rectGap(qf, f) < minGap) return false;
    const ap = apron(q);
    if (ap && rectGap(ap, f) < 0.05) return false;
  }
  return true;
}

function sampleIn(rng: Rng, z: Zone): { p: Pt; yaw: number; y?: number } {
  const p = { x: uniform(rng, z.x[0], z.x[1]), z: uniform(rng, z.z[0], z.z[1]) };
  return { p, yaw: z.yaw(rng, p), y: z.y ? uniform(rng, z.y[0], z.y[1]) : undefined };
}

function placeInZones(base: PlacedObject, zones: Zone[], rng: Rng, placed: PlacedObject[], start: Pt, orient?: (zone: Zone, p: Pt, rng: Rng) => number): { o: PlacedObject; zone: string } | null {
  for (let t = 0; t < TRIES_PER_OBJECT; t++) {
    const zone = pick(rng, zones);
    const s = sampleIn(rng, zone);
    const yaw = orient ? orient(zone, s.p, rng) : s.yaw;
    const o: PlacedObject = { ...base, x: s.p.x, z: s.p.z, yaw, ...(s.y !== undefined ? { y: s.y } : {}) };
    if (admissible(o, placed, start)) return { o, zone: zone.label };
  }
  return null;
}

/** Role of a scenario object, derived from its kind and model (so every scenario is covered). */
type Role = "target" | "poster" | "screen" | "board" | "lookalike" | "occluder" | "sofa" | "chair" | "pouf" | "crate";

function roleOf(o: PlacedObject): Role | null {
  if (o.kind === "target") return "target";
  if (o.model.type === "poster") return "poster";
  if (o.model.type === "screen") return "screen";
  if (o.model.type === "board") return "board";
  if (o.kind === "lookalike") return "lookalike";
  if (o.id === "crate-occ") return "occluder";
  if (o.model.type === "asset" && o.model.assetId === "velvetSofa") return "sofa";
  if (o.model.type === "asset" && (o.model.assetId === "sheenChair" || o.model.assetId === "damaskChair")) return "chair";
  if (o.model.type === "asset" && o.model.assetId === "pouf") return "pouf";
  if (o.model.type === "box") return "crate";
  return null;
}

const SEMANTIC_ORDER: Role[] = ["poster", "screen", "board", "lookalike", "target", "occluder"];

interface Attempt {
  inst: ScenarioInstance;
  zones: Record<string, string>;
  report: LayoutReport | null;
  failure: string | null;
}

function attemptLayout(scenarioId: string, seed: number, attempt: number): Attempt {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;
  const stream = (name: string) => mulberry32(deriveSeed(seed, `${scenarioId}#layout-v2#${attempt}#${name}`));
  const rngSem = stream("semantic");
  const rngFurn = stream("furniture");
  const rngStart = stream("start");
  // Lighting does not depend on the attempt number, so a retry changes only the geometry.
  const rngLight = mulberry32(deriveSeed(seed, `${scenarioId}#layout-v2#light`));

  // The object set (ids, kinds, models, labels) is the scenario's own; only poses change.
  const template = scenario.objects(mulberry32(deriveSeed(seed, scenarioId)));
  const startZone = pick(rngStart, START_ZONES);
  const s0 = sampleIn(rngStart, startZone);
  const start = { x: s0.p.x, z: s0.p.z, theta: s0.yaw };
  const zones: Record<string, string> = { start: startZone.label };
  const placed: PlacedObject[] = [];
  const fail = (why: string): Attempt => ({ inst: null as unknown as ScenarioInstance, zones, report: null, failure: why });

  const byRole = (r: Role) => template.filter((o) => roleOf(o) === r);
  const unknown = template.filter((o) => roleOf(o) === null);
  if (unknown.length) throw new Error(`layout v2 has no placement rule for ${unknown.map((o) => o.id).join(", ")} in ${scenarioId}`);

  // An occluder is placed together with its target: if no crate position hides the target's first
  // view, the target is re-sampled within the same attempt.
  const occluderBase = byRole("occluder")[0];
  let occluder: { o: PlacedObject; zone: string } | null = null;
  for (const role of SEMANTIC_ORDER) {
    for (const base of byRole(role)) {
      let r: { o: PlacedObject; zone: string } | null = null;
      if (role === "target") {
        for (let k = 0; k < (occluderBase ? TARGET_TRIES_WITH_OCCLUDER : 1); k++) {
          r = placeInZones(base, PLANT_ZONES, rngSem, placed, start);
          if (!r || !occluderBase) break;
          occluder = placeOccluder(occluderBase, [...placed, r.o], start, rngSem);
          if (occluder) break;
          r = null;
        }
      } else if (role === "poster") r = placeInZones(base, POSTER_ZONES, rngSem, placed, start);
      else if (role === "screen") r = placeInZones(base, SCREEN_ZONES, rngSem, placed, start);
      else if (role === "board")
        r = placeInZones(base, WEST_FLOOR_ZONES, rngSem, placed, start, (zone, p, rng) => yawTowards(p, (zone as (typeof WEST_FLOOR_ZONES)[number]).focus(p)) + jit(rng, 20 * DEG));
      else if (role === "lookalike") r = placeInZones(base, WEST_FLOOR_ZONES, rngSem, placed, start);
      else if (role === "occluder") r = occluder;
      if (!r) return fail(`could not place ${base.id}`);
      placed.push(r.o);
      zones[r.o.id] = r.zone;
    }
  }
  for (const role of ["sofa", "chair", "pouf", "crate"] as Role[]) {
    for (const base of byRole(role)) {
      const r = placeInZones(base, FURNITURE_ZONES[role], rngFurn, placed, start);
      if (!r) return fail(`could not place ${base.id}`);
      placed.push(r.o);
      zones[r.o.id] = r.zone;
    }
  }
  // Keep the scenario's object order (the scene graph and evaluator iterate it).
  const objects = template.map((t) => placed.find((p) => p.id === t.id)!);
  const inst: ScenarioInstance = {
    scenario,
    seed,
    objects,
    start,
    lightScale: uniform(rngLight, 0.8, 1.15),
    sunAzimuthDeg: uniform(rngLight, 0, 360),
  };
  const report = validateInstance(inst);
  return { inst, zones, report, failure: report.ok ? null : report.checks.filter((c) => !c.pass).map((c) => c.name).join(", ") };
}

/**
 * The occluding crate stands at most this far in front of the target (m), so the plant still
 * "stands behind a crate" (v1 uses about 0.87 m). A 2.4 m cap balanced the plant zones better but
 * put the crate mid-room; see docs/LAYOUT_VARIATION.md.
 */
const OCCLUDER_MAX_DIST = 1.8;

/** Puts the occluding crate between the target and the first route pose that would see it. */
function placeOccluder(base: PlacedObject, placed: PlacedObject[], start: { x: number; z: number; theta: number }, rng: Rng): { o: PlacedObject; zone: string } | null {
  const target = placed.find((o) => o.kind === "target");
  if (!target) return null;
  const sim = simulateSearch(buildPriorGrid(placed), start);
  const first = sightings(buildSightGrid(placed, [target]), target, sim.poses)[0];
  if (!first) return null;
  const p = sim.poses[first.index];
  const d = Math.hypot(p.x - target.x, p.z - target.z);
  const ux = (p.x - target.x) / d, uz = (p.z - target.z) / d;
  for (let t = 0; t < TRIES_PER_OBJECT; t++) {
    // Part-way along the line of sight: far enough from the plant that the crate's shadow is
    // narrow (other route poses still see the plant), short of the viewer's route corridor.
    const along = Math.min(OCCLUDER_MAX_DIST, Math.max(0.95, d * uniform(rng, 0.35, 0.6)));
    const side = jit(rng, 0.1);
    const o: PlacedObject = {
      ...base,
      x: target.x + ux * along - uz * side,
      z: target.z + uz * along + ux * side,
      // Wide (0.9 m) face towards the first viewer.
      yaw: Math.atan2(ux, uz) + jit(rng, 8 * DEG),
    };
    if (admissible(o, placed, start, { id: target.id, gap: 0.08, routeClearance: RULES.occluderRouteClearance })) return { o, zone: `between target and route pose ${first.index}` };
  }
  return null;
}

// ------------------------------------------------------------------ public API

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Content hash of the geometry and lighting (cm / degree resolution). */
export function layoutHash(inst: Pick<ScenarioInstance, "scenario" | "objects" | "start" | "lightScale" | "sunAzimuthDeg">): string {
  const r2 = (v: number) => v.toFixed(2);
  const d0 = (v: number) => ((v * 180) / Math.PI).toFixed(0);
  const parts = [
    inst.scenario.id,
    ...inst.objects.map((o) => `${o.id}:${r2(o.x)},${r2(o.z)},${d0(o.yaw)}${o.y !== undefined ? `,${r2(o.y)}` : ""}`),
    `start:${r2(inst.start.x)},${r2(inst.start.z)},${d0(inst.start.theta)}`,
    `light:${r2(inst.lightScale)},${inst.sunAzimuthDeg.toFixed(0)}`,
  ];
  return fnv1a(parts.join("|"));
}

export interface GeneratedLayout extends ScenarioInstance {
  layout: LayoutInfo;
  report: LayoutReport;
  /** Why earlier attempts were rejected (diagnostics). */
  rejected: string[];
}

const failedChecks = (r: LayoutReport) => r.checks.filter((c) => !c.pass).map((c) => c.name);

/**
 * Seeded v2 world layout: same seed → same layout; every accepted layout passes validateInstance().
 * `opts.maxAttempts` exists for tests that force the fallback path.
 */
export function generateLayout(scenarioId: string, seed: number, opts: { maxAttempts?: number } = {}): GeneratedLayout {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId);
  if (!scenario) throw new Error(`unknown scenario ${scenarioId}`);
  if (!Number.isInteger(seed) || seed < 0) throw new Error(`invalid seed ${seed}`);
  const maxAttempts = opts.maxAttempts ?? MAX_ATTEMPTS;
  const rejected: string[] = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const a = attemptLayout(scenarioId, seed, attempt);
    if (!a.failure && a.report) {
      return {
        ...a.inst,
        layout: { version: "v2", id: `v2-${layoutHash(a.inst)}`, attempt, fallback: false, valid: true, failedChecks: [], zones: a.zones },
        report: a.report,
        rejected,
      };
    }
    rejected.push(`attempt ${attempt}: ${a.failure}`);
  }
  // Deterministic fallback: the recorded layout for this seed. It is flagged in the id, in
  // `fallback`, and its own validation result is recorded as is (it may fail checks).
  const inst = instantiate(scenarioId, seed);
  const report = validateInstance(inst);
  return {
    ...inst,
    layout: {
      version: "v2",
      id: `v2-fallback-${layoutHash(inst)}`,
      attempt: maxAttempts,
      fallback: true,
      valid: report.ok,
      failedChecks: failedChecks(report),
      zones: Object.fromEntries(inst.objects.map((o) => [o.id, "v1 slot"])),
    },
    report,
    rejected,
  };
}

/** Scenario instance for a layout version; "v1" is identical to instantiate() plus its validation result. */
export function instantiateLayout(scenarioId: string, seed: number, version: LayoutVersion = DEFAULT_LAYOUT): ScenarioInstance & { layout: LayoutInfo } {
  if (version === "v2") {
    const g = generateLayout(scenarioId, seed);
    return { scenario: g.scenario, seed: g.seed, objects: g.objects, start: g.start, lightScale: g.lightScale, sunAzimuthDeg: g.sunAzimuthDeg, layout: g.layout };
  }
  const inst = instantiate(scenarioId, seed);
  const report = validateInstance(inst);
  return {
    ...inst,
    layout: { version: "v1", id: `v1-${layoutHash(inst)}`, attempt: 0, fallback: false, valid: report.ok, failedChecks: failedChecks(report), zones: Object.fromEntries(inst.objects.map((o) => [o.id, "v1 slot"])) },
  };
}

export function isLayoutVersion(v: unknown): v is LayoutVersion {
  return v === "v1" || v === "v2";
}

/**
 * Parses a `layout` URL parameter. Absent → `whenAbsent`; "v1"/"v2" → that version; anything else
 * is an error (never silently mapped to a version).
 */
export function parseLayoutParam(raw: string | null, whenAbsent: LayoutVersion): { layout: LayoutVersion; error: null } | { layout: null; error: string } {
  if (raw === null) return { layout: whenAbsent, error: null };
  if (isLayoutVersion(raw)) return { layout: raw, error: null };
  return { layout: null, error: `Unknown world layout "${raw}". Use layout=v1 (recorded evaluation) or layout=v2 (seeded variation).` };
}

/** Layout identity as stored in mission records and exports. Absent for v1 batch records (historical format). */
export interface RecordedLayout {
  version: LayoutVersion;
  id: string;
  attempt: number;
  fallback: boolean;
  /** validateInstance() passed for the layout actually built. */
  valid: boolean;
  failedChecks: string[];
}

/** The one place a LayoutInfo becomes a record, so id, fallback and validity cannot disagree. */
export function layoutRecord(info: LayoutInfo): RecordedLayout {
  const fallbackId = info.id.startsWith(`${info.version}-fallback-`);
  if (fallbackId !== info.fallback) throw new Error(`layout ${info.id}: id and fallback flag disagree`);
  if (info.version === "v2" && !info.fallback && !info.valid) throw new Error(`layout ${info.id}: generated v2 layout recorded as invalid`);
  return { version: info.version, id: info.id, attempt: info.attempt, fallback: info.fallback, valid: info.valid, failedChecks: [...info.failedChecks] };
}

/** One-line description that reveals no object identities or positions (safe to show before a mission). */
export function layoutSummary(inst: ScenarioInstance & { layout: LayoutInfo }): string {
  const L = inst.layout;
  const th = Math.round((inst.start.theta * 180) / Math.PI);
  const base = `${inst.objects.length} objects · start (${inst.start.x.toFixed(1)}, ${inst.start.z.toFixed(1)}) ${th}° · light ×${inst.lightScale.toFixed(2)}`;
  if (L.version === "v1") return `${base} · recorded-evaluation layout`;
  if (L.fallback)
    return `${base} · FALLBACK: no valid v2 layout in ${L.attempt} attempts, v1 layout used${L.valid ? "" : ` (fails ${L.failedChecks.join(", ")})`}`;
  return `${base} · validated, attempt ${L.attempt + 1}`;
}
