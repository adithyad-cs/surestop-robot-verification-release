export declare const BUILD_META_SCHEMA: "surestop.build-meta/1";

export interface BuildMeta {
  schema: typeof BUILD_META_SCHEMA;
  source: "git" | "vercel-env" | "unavailable";
  sourceCommit: string | null;
  /** null = unknown. */
  sourceDirty: boolean | null;
  dirtyFingerprint: string | null;
  buildId: string | null;
  mode: "production" | "development";
  unavailableReason: string | null;
}

export declare function computeBuildMeta(opts?: {
  cwd?: string;
  env?: Record<string, string | undefined>;
  git?: (args: string[]) => Buffer | string;
}): BuildMeta;
