// Merge-compatibility rules for batch files (used by scripts/merge-batches.mjs; tested in
// tests/unit/batchCompat.test.ts).
//
// A file is "legacy" (pre-P1) when neither it nor any run carries provenance, "p1" when the file
// has a batch `provenance` block and every run has `recordSchema` and `provenance`; anything else
// is inconsistent and refused.
//
// Rules:
// 1. Legacy and P1 files are never merged together.
// 2. Legacy files merge as before (with a warning that they carry no provenance).
// 3. P1 files merge only if, across all files and runs:
//    - source:    the same non-null sourceCommit, the same sourceDirty and the same buildId
//                 (a dirty build merges only with the identical dirty tree);
//    - artifacts: identical detector, runtime and asset manifest hashes;
//    - runtime:   identical userAgent, TF.js backend and detector version (scores can differ
//                 between browsers/backends);
//    - protocol:  the same non-null protocol hash and descriptor;
//    - each run:  protocolHash = the batch protocol, and missionConfigHash = the hash the protocol
//                 lists for the run's variant label. Different variants legitimately have
//                 different missionConfigHash values; only a mismatch with the protocol is refused.
//    Scenario lists may differ (one protocol is split across processes by scenario); duplicate
//    (scenario, seed, variant, layout) runs are refused by merge-batches itself.

const same = (xs) => xs.every((x) => JSON.stringify(x) === JSON.stringify(xs[0]));

export function classify(file) {
  const runs = file.runs ?? [];
  const withProv = runs.filter((r) => r.provenance || r.recordSchema).length;
  if (!file.provenance && withProv === 0) return "legacy";
  if (file.provenance && runs.every((r) => r.provenance && r.recordSchema)) return "p1";
  return "inconsistent";
}

export function checkMergeCompatibility(files, names = files.map((_, i) => `input ${i + 1}`)) {
  const errors = [];
  const warnings = [];
  const kinds = files.map(classify);
  kinds.forEach((k, i) => {
    if (k === "inconsistent") errors.push(`${names[i]}: some runs carry provenance and others do not, or the batch provenance block is missing`);
  });
  if (errors.length) return { mode: "inconsistent", errors, warnings };
  if (new Set(kinds).size > 1) {
    errors.push(`cannot merge pre-P1 batches (no provenance: ${names.filter((_, i) => kinds[i] === "legacy").join(", ")}) with P1 batches (${names.filter((_, i) => kinds[i] === "p1").join(", ")})`);
    return { mode: "mixed", errors, warnings };
  }
  if (kinds[0] === "legacy") {
    warnings.push("pre-P1 batches: no source commit, configuration hash or artifact provenance is recorded");
    return { mode: "legacy", errors, warnings };
  }

  const prov = files.map((f) => f.provenance);
  const builds = prov.map((p) => p.build);
  if (builds.some((b) => !b || b.sourceCommit === null)) errors.push("source: a batch has no known source commit");
  if (!same(builds.map((b) => [b?.sourceCommit, b?.sourceDirty, b?.buildId]))) errors.push(`source: batches come from different builds (${builds.map((b) => b?.buildId ?? b?.sourceCommit ?? "unknown").join(" vs ")})`);
  if (builds.some((b) => b?.sourceDirty)) warnings.push("source: built from a dirty working tree (merged only with the identical tree)");
  if (!same(prov.map((p) => p.artifacts))) errors.push("artifacts: detector, runtime or asset manifest hashes differ");
  if (!same(prov.map((p) => [p.runtime?.userAgent ?? null, p.runtime?.tfBackend ?? null, p.runtime?.detector?.packageVersion ?? null, p.runtime?.detector?.base ?? null])))
    errors.push("runtime: batches ran on different browsers, TF.js backends or detector versions");
  const protocols = prov.map((p) => p.protocol);
  if (protocols.some((p) => !p || p.hash === null)) errors.push("protocol: a batch has no protocol hash");
  else if (!same(protocols.map((p) => [p.hash, p.descriptor]))) errors.push(`protocol: batches follow different protocols (${protocols.map((p) => p.hash.slice(0, 12)).join(" vs ")})`);

  if (!errors.length) {
    const protocol = protocols[0];
    const variantHash = new Map(protocol.descriptor.variants.map((v) => [v.label, v.missionConfigHash]));
    files.forEach((f, i) => {
      for (const r of f.runs) {
        const p = r.provenance;
        const id = `${names[i]}: ${r.result.scenarioId} seed ${r.result.seed} ${r.variant}`;
        if (p.protocolHash !== protocol.hash) errors.push(`${id}: run protocolHash differs from the batch protocol`);
        if (!variantHash.has(r.variant)) errors.push(`${id}: variant is not in the batch protocol`);
        else if (p.missionConfigHash !== variantHash.get(r.variant)) errors.push(`${id}: missionConfigHash differs from the protocol's hash for this variant`);
        if (p.build?.buildId !== builds[0].buildId || p.build?.sourceCommit !== builds[0].sourceCommit) errors.push(`${id}: run build differs from the batch build`);
        if (JSON.stringify(p.artifacts) !== JSON.stringify(prov[0].artifacts)) errors.push(`${id}: run artifact hashes differ from the batch`);
      }
    });
  }
  return { mode: "p1", errors, warnings };
}
