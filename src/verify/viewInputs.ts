// Capture of the exact verifier inputs behind each evidence record (P1-c), for offline
// recomputation. No rounding; non-finite numbers become explicit markers; absent fields stay absent.
import type { CandidateObservation, Encoded, NonFinite, ViewInputs } from "./types";
import { VIEW_INPUTS_SCHEMA } from "./types";
import type { ViewpointCell } from "./viewpoint";

function marker(n: number): NonFinite {
  return { nonFinite: Number.isNaN(n) ? "NaN" : n > 0 ? "Infinity" : "-Infinity" };
}

/** Deep copy with every non-finite number replaced by a NonFinite marker; undefined properties are dropped. */
export function encodeNonFinite<T>(v: T): Encoded<T> {
  if (typeof v === "number") return (Number.isFinite(v) ? v : marker(v)) as Encoded<T>;
  if (Array.isArray(v)) return v.map((x) => encodeNonFinite(x)) as Encoded<T>;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = encodeNonFinite(x);
    return out as Encoded<T>;
  }
  return v as Encoded<T>;
}

function isMarker(v: unknown): v is NonFinite {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  const m = (v as NonFinite).nonFinite;
  return keys.length === 1 && (m === "NaN" || m === "Infinity" || m === "-Infinity");
}

/** Inverse of encodeNonFinite. */
export function decodeNonFinite<T>(v: Encoded<T>): T {
  if (isMarker(v)) return (v.nonFinite === "NaN" ? NaN : v.nonFinite === "Infinity" ? Infinity : -Infinity) as T;
  if (Array.isArray(v)) return v.map((x) => decodeNonFinite(x)) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = decodeNonFinite(x as Encoded<unknown>);
    return out as T;
  }
  return v as T;
}

export function captureViewInputs(obs: CandidateObservation, candidate: { x: number; z: number }, cell: ViewpointCell, targetClass: string | null): ViewInputs {
  return {
    schema: VIEW_INPUTS_SCHEMA,
    robot: encodeNonFinite(obs.robot),
    candidateEstimate: encodeNonFinite({ x: candidate.x, z: candidate.z }),
    candidateDistance: encodeNonFinite(cell.range),
    bearingDeg: encodeNonFinite(cell.bearingDeg),
    targetClass,
    detection: obs.detection ? encodeNonFinite(obs.detection) : null,
    depth: obs.depth ? encodeNonFinite(obs.depth) : null,
  };
}
