// Separate evaluator module. The only module (with the world builder) that reads ground truth.
// It scores a finished mission after the fact; nothing here feeds back into the robot.
import type { MissionResult } from "@/mission/types";
import type { ObjectKind, PlacedObject } from "@/scenarios/layout";

/** Max XZ distance (m) between a candidate track and a ground-truth object to label it. */
export const LABEL_RADIUS = 1.0;

export interface TrackLabel {
  trackId: string;
  objectId: string | null;
  kind: ObjectKind | "none";
  label: string;
  distance: number | null;
  status: string;
}

export interface TrialScore {
  scenarioId: string;
  seed: number;
  method: string;
  outcome: MissionResult["outcome"];
  targetPresent: boolean;
  arrivedAtKind: ObjectKind | "none" | null;
  arrivedAtObject: string | null;
  correctArrival: boolean;
  falseArrival: boolean;
  abstained: boolean;
  navFailure: boolean;
  verificationInitiated: boolean;
  nonTargetEncountered: boolean;
  targetEncountered: boolean;
  correctTerminal: boolean;
  trackLabels: TrackLabel[];
  simTime: number;
  pathLength: number;
  frames: number;
  verificationFrames: number;
  /** Sim time from the first candidate track to the terminal mission decision. */
  decisionDelay: number | null;
}

const CANDIDATE_KINDS: ObjectKind[] = ["target", "picture-decoy", "screen-decoy", "lookalike", "furniture", "obstacle"];

export function labelTrack(pos: { x: number; z: number }, objects: PlacedObject[]): { obj: PlacedObject | null; distance: number | null } {
  let best: PlacedObject | null = null;
  let bestD = LABEL_RADIUS;
  for (const o of objects) {
    if (!CANDIDATE_KINDS.includes(o.kind)) continue;
    const d = Math.hypot(o.x - pos.x, o.z - pos.z);
    // Prefer target/decoy objects over furniture when both are close.
    const bias = o.kind === "furniture" || o.kind === "obstacle" ? 0.25 : 0;
    if (d + bias < bestD) {
      bestD = d + bias;
      best = o;
    }
  }
  return { obj: best, distance: best ? Math.hypot(best.x - pos.x, best.z - pos.z) : null };
}

export function evaluateMission(r: MissionResult, objects: PlacedObject[], targetPresent: boolean): TrialScore {
  const trackLabels: TrackLabel[] = r.tracks.map((t) => {
    const { obj, distance } = labelTrack(t.position, objects);
    return {
      trackId: t.id,
      objectId: obj?.id ?? null,
      kind: obj?.kind ?? "none",
      label: obj?.label ?? "no object nearby (phantom)",
      distance: distance === null ? null : Math.round(distance * 1000) / 1000,
      status: t.status,
    };
  });
  const confirmed = r.confirmedTrackId ? trackLabels.find((l) => l.trackId === r.confirmedTrackId) ?? null : null;
  const arrived = r.outcome === "ARRIVED" && confirmed !== null;
  const correctArrival = arrived && confirmed!.kind === "target";
  const falseArrival = arrived && confirmed!.kind !== "target";
  const nonTargetEncountered = trackLabels.some((l) => l.kind !== "target");
  const targetEncountered = trackLabels.some((l) => l.kind === "target");
  const firstTrackT = r.tracks.length ? Math.min(...r.tracks.map((t) => t.createdAt)) : null;
  return {
    scenarioId: r.scenarioId,
    seed: r.seed,
    method: r.method,
    outcome: r.outcome,
    targetPresent,
    arrivedAtKind: arrived ? confirmed!.kind : null,
    arrivedAtObject: arrived ? confirmed!.objectId : null,
    correctArrival,
    falseArrival,
    abstained: r.outcome === "UNRESOLVED",
    navFailure: r.outcome === "NAV_FAILURE",
    verificationInitiated: r.tracks.length > 0,
    nonTargetEncountered,
    targetEncountered,
    correctTerminal: targetPresent ? correctArrival : r.outcome === "NOT_FOUND",
    trackLabels,
    simTime: r.stats.simTime,
    pathLength: r.stats.pathLength,
    frames: r.stats.frames,
    verificationFrames: r.stats.verificationFrames,
    decisionDelay: firstTrackT === null ? null : Math.round((r.stats.simTime - firstTrackT) * 100) / 100,
  };
}
