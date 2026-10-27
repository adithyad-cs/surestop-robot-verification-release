// Merges batch outputs from parallel scripts/missions.mjs processes.
// Usage: node scripts/merge-batches.mjs out.json in1.json in2.json ...
import fs from "node:fs";
import { checkMergeCompatibility } from "./batch-compat.mjs";
import { batchCompleteness } from "./batch-journal.mjs";
import { layoutTag, layoutVersions, runKey, runLayout } from "./layout-records.mjs";
const [out, ...inputs] = process.argv.slice(2);
const files = inputs.map((f) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch (e) {
    throw new Error(`${f}: not a JSON batch file (${e.message}). A *.journal.jsonl is a checkpoint journal, not a batch: finish it with missions.mjs --resume.`);
  }
});
const key = (f) => JSON.stringify([f.detector.name, f.detector.packageVersion, f.detector.tfjsVersion, f.detector.base, f.detector.backend, f.backend.backend]);
if (new Set(files.map(key)).size !== 1) throw new Error("batches used different detectors/backends; refusing to merge");
// Failed missions are not results; merging would drop them silently, so refuse instead.
const failed = files.flatMap((f, i) => (f.failures ?? []).map((x) => `${inputs[i]}: ${x.scenarioId} seed ${x.seed} ${x.variant}`));
if (failed.length) throw new Error(`batches contain ${failed.length} failed mission(s); re-run them before merging:\n${failed.join("\n")}`);
// Incomplete (recovered from a journal), unknown-status or inconsistent batches are not results.
const notComplete = files.map((f, i) => [inputs[i], batchCompleteness(f)]).filter(([, c]) => !c.ok);
if (notComplete.length) throw new Error(`refusing to merge batches that are not complete:\n${notComplete.map(([n, c]) => `${n}: ${c.reason}`).join("\n")}`);
// Source, artifact, runtime and protocol compatibility (rules in scripts/batch-compat.mjs).
const compat = checkMergeCompatibility(files, inputs);
for (const w of compat.warnings) console.warn(`warning: ${w}`);
if (compat.errors.length) throw new Error(`refusing to merge incompatible batches:\n${compat.errors.join("\n")}`);
const runs = files.flatMap((f) => f.runs);
// One batch, one world-layout version: v1 (recorded protocol) and v2 runs are never merged.
const versions = layoutVersions(runs);
if (Object.keys(versions).length > 1) throw new Error(`batches mix world layouts ${JSON.stringify(versions)}; refusing to merge`);
const ids = new Set(runs.map((r) => `${runKey(r)}|${layoutTag(r)}`));
if (ids.size !== runs.length) throw new Error("duplicate (scenario, seed, variant, layout) runs");
const fallbacks = runs.filter((r) => runLayout(r).fallback).length;
const invalid = runs.filter((r) => runLayout(r).valid === false).length;
if (fallbacks || invalid) console.warn(`warning: ${fallbacks} run(s) on fallback layouts, ${invalid} run(s) on layouts that fail validation`);
const merged = { ...files[0], runs, wallMs: Math.max(...files.map((f) => f.wallMs)), parallelProcesses: inputs.length, consoleErrors: files.flatMap((f) => f.consoleErrors ?? []) };
// journal and sessions describe one missions.mjs process; the merge lists every input's journal.
delete merged.journal;
delete merged.sessions;
// A merge of complete stage-4 batches is complete; a merge of older files keeps their (absent) status.
if (files.every((f) => f.batchStatus === "complete")) {
  merged.batchStatus = "complete";
  merged.journals = files.map((f) => f.journal ?? null);
} else delete merged.batchStatus;
if (compat.mode === "p1") merged.provenance = { ...files[0].provenance, scenarios: [...new Set(files.flatMap((f) => f.provenance.scenarios))] };
fs.writeFileSync(out, JSON.stringify(merged));
console.log(`merged ${runs.length} runs (${JSON.stringify(versions)}) from ${inputs.length} files; console errors: ${merged.consoleErrors.length}`);
