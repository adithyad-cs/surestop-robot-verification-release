// Reads the build metadata injected by next.config.ts (scripts/build-meta.mjs). Outside a Next
// build or dev server (e.g. unit tests) nothing is injected, and every field is reported as
// unavailable rather than guessed.
import type { BuildMeta } from "../../scripts/build-meta.mjs";

export type { BuildMeta } from "../../scripts/build-meta.mjs";
export const BUILD_META_SCHEMA = "surestop.build-meta/1";

export function unavailableBuildMeta(reason: string): BuildMeta {
  return { schema: BUILD_META_SCHEMA, source: "unavailable", sourceCommit: null, sourceDirty: null, dirtyFingerprint: null, buildId: null, mode: "development", unavailableReason: reason };
}

function isBuildMeta(v: unknown): v is BuildMeta {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  const strOrNull = (x: unknown) => x === null || typeof x === "string";
  return (
    m.schema === BUILD_META_SCHEMA &&
    (m.source === "git" || m.source === "vercel-env" || m.source === "unavailable") &&
    strOrNull(m.sourceCommit) &&
    (m.sourceDirty === null || typeof m.sourceDirty === "boolean") &&
    strOrNull(m.dirtyFingerprint) &&
    strOrNull(m.buildId) &&
    (m.mode === "production" || m.mode === "development") &&
    strOrNull(m.unavailableReason)
  );
}

/** `raw` defaults to the value Next inlined at build time (the literal access below is required for inlining). */
export function readBuildMeta(raw: string | undefined = process.env.NEXT_PUBLIC_SURESTOP_BUILD_META): BuildMeta {
  if (!raw) return unavailableBuildMeta("build metadata not injected (not a Next build or dev server)");
  try {
    const v = JSON.parse(raw) as unknown;
    return isBuildMeta(v) ? v : unavailableBuildMeta("injected build metadata is malformed");
  } catch {
    return unavailableBuildMeta("injected build metadata is not valid JSON");
  }
}
