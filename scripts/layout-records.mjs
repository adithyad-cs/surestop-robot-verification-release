// World-layout identity of a batch/record run.
// - Records with `recordSchema` (P1 and later) always carry `layout`, including v1; one without it
//   is refused rather than guessed.
// - Historical records (no `recordSchema`) without `layout` are v1: every one of them (calibration,
//   held-out evaluation, asset holdout) was produced on v1, and v2/v3 runs always recorded a layout.
export function runLayout(r) {
  const L = r.layout;
  if (!L) {
    if (r.recordSchema) throw new Error(`${runKey(r)}: record ${r.recordSchema} has no layout`);
    return { version: "v1", id: null, fallback: false, valid: null };
  }
  return { version: L.version, id: L.id ?? null, fallback: !!L.fallback, valid: L.valid ?? null };
}

/**
 * Same world layout: same version and id. A historical v1 record has no id; it matches any v1
 * record (the v1 layout of a scenario and seed is fixed and unchanged since it was recorded).
 */
export function sameLayout(a, b) {
  const A = runLayout(a), B = runLayout(b);
  if (A.version !== B.version) return false;
  if (A.version === "v1" && (A.id === null || B.id === null)) return true;
  return A.id === B.id;
}

/** "v1:-" for historical v1 runs, "<version>:<id>" for recorded layouts. */
export const layoutTag = (r) => {
  const L = runLayout(r);
  return `${L.version}:${L.id ?? "-"}`;
};

export const runKey = (r) => `${r.result.scenarioId}|${r.result.seed}|${r.variant}`;

/** Count of runs per layout version, e.g. { v1: 28 } or { v1: 3, v2: 5 }. */
export function layoutVersions(runs) {
  const out = {};
  for (const r of runs) {
    const v = runLayout(r).version;
    out[v] = (out[v] ?? 0) + 1;
  }
  return out;
}
