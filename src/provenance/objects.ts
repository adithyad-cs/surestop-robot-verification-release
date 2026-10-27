// Evaluator-only object and asset provenance (P1-f). Written into RunRecord.objects by the
// experiment layer after a mission; never into MissionConfig, MissionResult or anything the robot
// reads (tests/unit/isolation.test.ts).
//
// Lineage: no asset family or lineage is established in this repository (one plant model, one vase
// model; posters, displays and photo boards are renders of the plant; established by the P1
// instrumentation audit, §6, in the development history). Every object is
// therefore recorded with lineage "unknown". Seeds, rescaling or re-rendering do not create families.
import { ASSETS } from "@/sim/assets";
import type { ObjectKind, ScenarioInstance } from "@/scenarios/layout";
import manifest from "./artifact-manifest.json";

export const EVALUATOR_OBJECTS_SCHEMA = "surestop.evaluator-objects/1";

export type ObjectDerivation =
  /** The GLB file placed as shipped (scaled to the catalogue height at load). */
  | "glb-as-shipped"
  /** A picture rendered at runtime from the asset (poster, display, photo board); the image itself is not hashed. */
  | "runtime-render-of-asset"
  /** A procedural box; no file. */
  | "procedural-box";

export interface EvaluatorObject {
  objectId: string;
  /** Ground-truth role in the scenario (target, picture-decoy, lookalike, furniture, ...). */
  kind: ObjectKind;
  label: string;
  model: "asset" | "poster" | "screen" | "board" | "box";
  /** Catalogue id of the placed GLB, or of the asset a picture depicts; null for a box. */
  assetId: string | null;
  /** Served path of that asset file. */
  assetFile: string | null;
  /** SHA-256 of that file from the committed artifact manifest; null if not a file or not listed. */
  assetSha256: string | null;
  derivation: ObjectDerivation;
  /** Asset family / lineage. "unknown" unless established by provenance (it is not, here). */
  lineage: "unknown";
}

export interface EvaluatorObjects {
  schema: typeof EVALUATOR_OBJECTS_SCHEMA;
  objects: EvaluatorObject[];
}

const SHA_BY_PATH = new Map(manifest.assets.files.map((f) => [f.path, f.sha256]));

function asset(assetId: string): { assetFile: string | null; assetSha256: string | null } {
  const spec = ASSETS[assetId];
  if (!spec) return { assetFile: null, assetSha256: null };
  return { assetFile: spec.url, assetSha256: SHA_BY_PATH.get(spec.url) ?? null };
}

export function evaluatorObjects(inst: Pick<ScenarioInstance, "objects">): EvaluatorObjects {
  return {
    schema: EVALUATOR_OBJECTS_SCHEMA,
    objects: inst.objects.map((o): EvaluatorObject => {
      const base = { objectId: o.id, kind: o.kind, label: o.label, lineage: "unknown" as const };
      const m = o.model;
      if (m.type === "asset") return { ...base, model: "asset", assetId: m.assetId, ...asset(m.assetId), derivation: "glb-as-shipped" };
      if (m.type === "box") return { ...base, model: "box", assetId: null, assetFile: null, assetSha256: null, derivation: "procedural-box" };
      return { ...base, model: m.type, assetId: m.ofAsset, ...asset(m.ofAsset), derivation: "runtime-render-of-asset" };
    }),
  };
}
