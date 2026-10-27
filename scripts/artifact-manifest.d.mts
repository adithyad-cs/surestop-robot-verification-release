export declare const ARTIFACT_MANIFEST_SCHEMA: "surestop.artifact-manifest/1";
export declare const MANIFEST_PATH: string;

export interface ArtifactFile {
  /** Path as served, e.g. "/assets/models/DiffuseTransmissionPlant.glb". */
  path: string;
  bytes: number;
  sha256: string;
}

export interface ArtifactGroup {
  files: ArtifactFile[];
  /** SHA-256 of canonical JSON {schema, group, files}. */
  sha256: string;
}

export interface ArtifactManifest {
  schema: typeof ARTIFACT_MANIFEST_SCHEMA;
  detector: ArtifactGroup;
  runtime: ArtifactGroup;
  assets: ArtifactGroup;
}

export declare function canonicalJson(v: unknown): string;
export declare function buildArtifactManifest(root: string): ArtifactManifest;
