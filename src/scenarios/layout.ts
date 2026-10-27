// Floor layout and scenario definitions. This module is ground truth: it is used by the
// world builder (to place objects) and the evaluator (to score). Robot-facing modules
// (perception, sensing, verify, policies, mission) must not import it.
import type { Rect } from "@/nav/grid";
import { mulberry32, deriveSeed, uniform } from "@/lib/rng";

export const WALL_HEIGHT = 2.7;
export const WALL_T = 0.12;

export const BOUNDS: Rect = { minX: -7, minZ: -5, maxX: 7, maxZ: 5 };

/** Wall segments as thin rectangles (world XZ). Interior wall at x = 0 with a doorway z ∈ [1.0, 2.4]. */
export const WALLS: Rect[] = [
  { minX: -7, minZ: -5, maxX: 7, maxZ: -5 + WALL_T },
  { minX: -7, minZ: 5 - WALL_T, maxX: 7, maxZ: 5 },
  { minX: -7, minZ: -5, maxX: -7 + WALL_T, maxZ: 5 },
  { minX: 7 - WALL_T, minZ: -5, maxX: 7, maxZ: 5 },
  { minX: -WALL_T / 2, minZ: -5, maxX: WALL_T / 2, maxZ: 1.0 },
  { minX: -WALL_T / 2, minZ: 2.4, maxX: WALL_T / 2, maxZ: 5 },
];

export type ObjectKind = "target" | "picture-decoy" | "screen-decoy" | "lookalike" | "furniture" | "obstacle";

export type ModelRef =
  | { type: "asset"; assetId: string }
  | { type: "poster"; ofAsset: string; width: number; height: number }
  | { type: "screen"; ofAsset: string }
  | { type: "board"; ofAsset: string; width: number; height: number }
  | { type: "box"; w: number; h: number; d: number; color: number };

export interface PlacedObject {
  id: string;
  kind: ObjectKind;
  /** Ground-truth semantic label used only by the evaluator. */
  label: string;
  model: ModelRef;
  x: number;
  z: number;
  /** Yaw (rad) about +Y. For posters/screens: the direction the picture faces. */
  yaw: number;
  /** Centre height for wall-mounted posters. */
  y?: number;
}

export interface RouteWaypoint {
  x: number;
  z: number;
  /** Look headings (deg, world frame, 0 = +X, 90 = +Z) to observe at this waypoint. */
  scan?: number[];
}

/** Search route shared by every method. */
export const ROUTE: RouteWaypoint[] = [
  { x: -5.6, z: 3.4 },
  { x: -5.4, z: -2.4, scan: [-90, -30, 30] },
  { x: -2.4, z: -2.6, scan: [-90, 0, 90] },
  { x: -2.6, z: 1.7, scan: [180, -90] },
  { x: 1.4, z: 1.7 },
  { x: 2.4, z: -2.2, scan: [-60, 0] },
  { x: 5.3, z: -1.0, scan: [-90, 0, 90] },
  { x: 4.4, z: 3.0, scan: [0, 90, 180] },
  { x: 1.6, z: 3.6, scan: [-90] },
];

export const ROBOT_START = { x: -5.6, z: 3.4, theta: -Math.PI / 2 };

export interface ScenarioDef {
  id: string;
  title: string;
  summary: string;
  /** Category used by the evaluator when no target is present. */
  targetPresent: boolean;
  difficulty: "baseline" | "decoy" | "visibility" | "limitation";
  objects: (rng: () => number) => PlacedObject[];
}

const deg = Math.PI / 180;

function furniture(rng: () => number): PlacedObject[] {
  const j = (a: number) => uniform(rng, -a, a);
  return [
    { id: "sofa", kind: "furniture", label: "couch", model: { type: "asset", assetId: "velvetSofa" }, x: -6.3 + j(0.05), z: -0.2 + j(0.2), yaw: 90 * deg },
    { id: "chair-a", kind: "furniture", label: "chair", model: { type: "asset", assetId: "sheenChair" }, x: 2.2 + j(0.15), z: -4.3, yaw: j(15 * deg) },
    { id: "chair-b", kind: "furniture", label: "chair", model: { type: "asset", assetId: "damaskChair" }, x: 3.3 + j(0.15), z: -4.3, yaw: j(15 * deg) },
    { id: "pouf", kind: "furniture", label: "pouf", model: { type: "asset", assetId: "pouf" }, x: 2.6 + j(0.2), z: 4.2, yaw: j(Math.PI) },
    { id: "crate-w", kind: "obstacle", label: "crate", model: { type: "box", w: 0.7, h: 0.75, d: 0.55, color: 0x8a7a66 }, x: -2.0 + j(0.2), z: 4.2, yaw: 0 },
  ];
}

function plantAt(id: string, x: number, z: number, rng: () => number): PlacedObject {
  return { id, kind: "target", label: "potted plant (3-D)", model: { type: "asset", assetId: "plant" }, x, z, yaw: uniform(rng, -Math.PI, Math.PI) };
}

/** Print hung on the north wall of the west room (first encountered on the route). */
function westPoster(rng: () => number): PlacedObject {
  return {
    id: "poster-w",
    kind: "picture-decoy",
    label: "framed print of a potted plant",
    model: { type: "poster", ofAsset: "plant", width: 0.6, height: 0.8 },
    x: -3.9 + uniform(rng, -0.3, 0.3),
    z: -5 + WALL_T + 0.002,
    y: 1.15,
    yaw: 0,
  };
}

function westScreen(rng: () => number): PlacedObject {
  return {
    id: "screen-w",
    kind: "screen-decoy",
    label: "display showing a potted plant",
    model: { type: "screen", ofAsset: "plant" },
    x: -WALL_T / 2 - 0.24,
    z: -3.3 + uniform(rng, -0.25, 0.25),
    yaw: -90 * deg,
  };
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: "clear-target",
    title: "Clear target",
    summary: "One 3-D potted plant in the east room; furniture only, no decoys.",
    targetPresent: true,
    difficulty: "baseline",
    objects: (rng) => [...furniture(rng), plantAt("plant", 4.9 + uniform(rng, -0.3, 0.3), -3.4 + uniform(rng, -0.3, 0.3), rng)],
  },
  {
    id: "poster-decoy",
    title: "Picture decoy first",
    summary: "A framed print of a potted plant in the west room is seen before the real plant in the east room.",
    targetPresent: true,
    difficulty: "decoy",
    objects: (rng) => [...furniture(rng), westPoster(rng), plantAt("plant", 4.9 + uniform(rng, -0.3, 0.3), -3.4 + uniform(rng, -0.3, 0.3), rng)],
  },
  {
    id: "screen-decoy",
    title: "Display decoy first",
    summary: "A display showing a potted plant in the west room is seen before the real plant.",
    targetPresent: true,
    difficulty: "decoy",
    objects: (rng) => [...furniture(rng), westScreen(rng), plantAt("plant", 4.9 + uniform(rng, -0.3, 0.3), -3.4 + uniform(rng, -0.3, 0.3), rng)],
  },
  {
    id: "decoys-only",
    title: "Decoys only (target absent)",
    summary: "A print and a display of a plant; no real plant exists. Any confirmation is a false arrival.",
    targetPresent: false,
    difficulty: "decoy",
    objects: (rng) => [...furniture(rng), westPoster(rng), westScreen(rng)],
  },
  {
    id: "occluded-target",
    title: "Partially occluded target",
    summary: "The real plant stands behind a crate as seen from the route; a clear view needs another viewpoint.",
    targetPresent: true,
    difficulty: "visibility",
    objects: (rng) => {
      const px = 5.9 + uniform(rng, -0.15, 0.15);
      const pz = 1.6 + uniform(rng, -0.2, 0.2);
      return [
        ...furniture(rng),
        plantAt("plant", px, pz, rng),
        { id: "crate-occ", kind: "obstacle", label: "crate", model: { type: "box", w: 0.9, h: 0.8, d: 0.5, color: 0x7d8a96 }, x: px - 0.85, z: pz - 0.2, yaw: 90 * deg },
      ];
    },
  },
  {
    id: "photo-board-decoy",
    title: "Life-size photo board first",
    summary:
      "A free-standing board printed with a life-size photo of the plant (detector scores as high as the real plant) stands in the west room before the real plant. Added after calibration v1; see Method.",
    targetPresent: true,
    difficulty: "decoy",
    objects: (rng) => [
      ...furniture(rng),
      {
        id: "board-w",
        kind: "picture-decoy",
        label: "life-size photo board of a potted plant",
        model: { type: "board", ofAsset: "plant", width: 0.89, height: 1.19 },
        x: -3.7 + uniform(rng, -0.3, 0.3),
        z: -4.0 + uniform(rng, -0.15, 0.15),
        yaw: uniform(rng, -20, 20) * deg,
      },
      plantAt("plant", 4.9 + uniform(rng, -0.3, 0.3), -3.4 + uniform(rng, -0.3, 0.3), rng),
    ],
  },
  {
    id: "lookalike-3d",
    title: "3-D look-alike (known limitation)",
    summary: "A glass vase of flowers, which COCO-SSD often labels 'potted plant', precedes the real plant. Depth cannot separate it.",
    targetPresent: true,
    difficulty: "limitation",
    objects: (rng) => [
      ...furniture(rng),
      { id: "vase", kind: "lookalike", label: "vase with flowers", model: { type: "asset", assetId: "vaseFlowers" }, x: -3.4 + uniform(rng, -0.3, 0.3), z: -4.1, yaw: uniform(rng, -Math.PI, Math.PI) },
      plantAt("plant", 4.9 + uniform(rng, -0.3, 0.3), -3.4 + uniform(rng, -0.3, 0.3), rng),
    ],
  },
];

/** Which world-layout generator produced an instance (see src/scenarios/generate.ts). */
export type LayoutVersion = "v1" | "v2";

export interface LayoutInfo {
  version: LayoutVersion;
  /** Short content hash of the placed objects, start pose and lighting, e.g. "v2-3fa9c1d2". */
  id: string;
  /** Generator attempt that produced a valid layout (v2; 0 for v1). */
  attempt: number;
  /** True if no attempt validated and the v1 layout was used instead (v2 only). */
  fallback: boolean;
  /** validateInstance() passed for this exact layout (always true for a non-fallback v2 layout). */
  valid: boolean;
  /** Names of the validator checks this layout fails (empty when valid). */
  failedChecks: string[];
  /** Zone label chosen for each placed object id (ground truth: evaluator/debug display only). */
  zones: Record<string, string>;
}

export interface ScenarioInstance {
  scenario: ScenarioDef;
  seed: number;
  objects: PlacedObject[];
  start: { x: number; z: number; theta: number };
  lightScale: number;
  sunAzimuthDeg: number;
  /** Set by instantiateLayout(); absent on plain instantiate() results. */
  layout?: LayoutInfo;
}

export function instantiate(scenarioId: string, seed: number): ScenarioInstance {
  const scenario = SCENARIOS.find((s) => s.id === scenarioId);
  if (!scenario) throw new Error(`unknown scenario ${scenarioId}`);
  if (!Number.isInteger(seed) || seed < 0) throw new Error(`invalid seed ${seed}`);
  const rng = mulberry32(deriveSeed(seed, scenarioId));
  const objects = scenario.objects(rng);
  return {
    scenario,
    seed,
    objects,
    start: {
      x: ROBOT_START.x + uniform(rng, -0.2, 0.2),
      z: ROBOT_START.z + uniform(rng, -0.2, 0.2),
      theta: ROBOT_START.theta + uniform(rng, -10, 10) * deg,
    },
    lightScale: uniform(rng, 0.8, 1.15),
    sunAzimuthDeg: uniform(rng, 20, 70),
  };
}

/** Footprint rectangle of a placed object given its model's half extents. */
export function footprint(o: PlacedObject, halfW: number, halfD: number): Rect {
  const c = Math.abs(Math.cos(o.yaw)), s = Math.abs(Math.sin(o.yaw));
  const hx = halfW * c + halfD * s;
  const hz = halfW * s + halfD * c;
  return { minX: o.x - hx, minZ: o.z - hz, maxX: o.x + hx, maxZ: o.z + hz };
}
