// Compares two batch/record files run by run, keyed by (scenario, seed, variant).
// Wall-clock measurements (inference time, load time, wall time) are ignored because they
// differ on every machine; `provenance` is reported separately (it describes the run's origin,
// not its result); everything else, including every frame, score and decision, must match. `result.config` is reported separately: records made before the baseline thresholds
// were selected carry the old defaults for the *other* methods' unused settings.
// Runs are compared only within the same world layout: a pair whose layout version or layout id
// differs (e.g. a v2 run against a v1 record) is reported as a layout mismatch, never as a
// result difference, and makes the script exit with status 1.
//
// Failed and incomplete inputs (stage 4). Each file's completeness is read from its batchStatus,
// failures and missingJobs (scripts/batch-journal.mjs; a Lab export carries the same fields). By
// default a failed or incomplete input is REFUSED (exit 4): comparing only the missions that
// happened to complete would look like a clean comparison of the whole experiment. With
// --allow-incomplete the comparison runs, every failed or never-run mission is listed as excluded,
// and a comparison with no differences but with exclusions exits 5, never 0.
// Exit codes: 0 every run of the first file matched and nothing was excluded; 1 differences,
// missing runs, layout mismatches or nothing compared; 2 usage; 4 refused (failed or incomplete
// input, default mode); 5 partial comparison without differences (--allow-incomplete).
// Usage: node scripts/compare-runs.mjs [--allow-incomplete] <a.json|a.json.gz> <b.json|b.json.gz>
import fs from "node:fs";
import zlib from "node:zlib";
import { batchCompleteness, jobKey } from "./batch-journal.mjs";
import { layoutTag, layoutVersions, runKey as key, sameLayout } from "./layout-records.mjs";

const TIMING = new Set(["inferenceMs", "inferenceMsTotal", "wallClockMs", "loadMs"]);
const readFile = (f) => JSON.parse((f.endsWith(".gz") ? zlib.gunzipSync(fs.readFileSync(f)) : fs.readFileSync(f)).toString("utf8"));
const canon = (o) => JSON.stringify(o, (k, v) => (TIMING.has(k) ? undefined : v));
// Fields that only records written since P1 have. When one side of a pair is a historical record,
// these are ignored on both sides (and reported), so a re-run can still be compared with it.
const P1_ONLY = new Set(["recordSchema", "provenance", "layout", "objects", "inputs", "invalidField", "rule", "terminal", "sensorCacheEntriesAtStart", "cacheState"]);
const canonLegacy = (o) => JSON.stringify(o, (k, v) => (TIMING.has(k) || P1_ONLY.has(k) ? undefined : v));
let legacyPairs = 0;
let bothProvenance = 0;
let sameProvenance = 0;

const args = process.argv.slice(2);
const allowIncomplete = args.includes("--allow-incomplete");
const [fa, fb] = args.filter((x) => x !== "--allow-incomplete");
if (!fa || !fb) {
  console.error("usage: node scripts/compare-runs.mjs [--allow-incomplete] <a.json[.gz]> <b.json[.gz]>");
  process.exit(2);
}
const A = readFile(fa);
const B = readFile(fb);
// Missions that ended without a run (failed) or never ran, per file: they cannot be compared.
const notRun = (F) => new Set([...(F.failures ?? []).map(jobKey), ...(F.missingJobs ?? []).map(jobKey)]);
const describe = (name, F, c) => `${name}: ${c.status}; ${(F.runs ?? []).length} completed run(s), ${(F.failures ?? []).length} failed, ${(F.missingJobs ?? []).length} never run`;
const completeA = batchCompleteness(A);
const completeB = batchCompleteness(B);
console.log(describe("first file", A, completeA));
console.log(describe("second file", B, completeB));
if ((!completeA.ok || !completeB.ok) && !allowIncomplete) {
  for (const [n, c] of [["first file", completeA], ["second file", completeB]]) if (!c.ok) console.log(`REFUSED: ${n} is not a complete batch (${c.reason})`);
  console.log("A comparison of only the completed missions would not compare the experiments. Re-run or resume the batch, or pass --allow-incomplete for an explicitly partial comparison.");
  process.exit(4);
}
const notRunA = notRun(A);
const notRunB = notRun(B);
const a = A.runs;
const b = new Map(B.runs.map((r) => [key(r), r]));
let missing = 0, same = 0, sameConfig = 0;
const excluded = [];
const differing = [];
const layoutMismatch = [];
for (const r of a) {
  const o = b.get(key(r));
  if (!o) {
    if (notRunB.has(key(r))) excluded.push(`${key(r)} (failed or not run in the second file)`);
    else missing++;
    continue;
  }
  if (!sameLayout(r, o)) {
    layoutMismatch.push(`${key(r)} (${layoutTag(r)} vs ${layoutTag(o)})`);
    continue;
  }
  const { config: ca, ...ra } = r.result;
  const { config: cb, ...rb } = o.result;
  // Provenance (build, runtime, hashes) describes where a run came from, not its result: reported separately.
  const { provenance: pa, ...ta } = r;
  const { provenance: pb, ...tb } = o;
  if (pa && pb) {
    bothProvenance++;
    if (pa.build?.buildId === pb.build?.buildId && pa.missionConfigHash === pb.missionConfigHash && canon(pa.artifacts) === canon(pb.artifacts)) sameProvenance++;
  }
  const legacy = !r.recordSchema !== !o.recordSchema;
  if (legacy) legacyPairs++;
  const c = legacy ? canonLegacy : canon;
  if (c({ ...ta, result: ra }) === c({ ...tb, result: rb })) same++;
  else differing.push(key(r));
  if (canon(ca) === canon(cb)) sameConfig++;
}
const compared = a.length - missing - layoutMismatch.length - excluded.length;
const firstKeys = new Set(a.map(key));
for (const k of notRunA) excluded.push(`${k} (failed or not run in the first file${notRunB.has(k) ? " and in the second" : ""})`);
const onlySecond = [...b.keys()].filter((k) => !firstKeys.has(k) && !notRunA.has(k));
console.log(`layouts: first file ${JSON.stringify(layoutVersions(a))}, second file ${JSON.stringify(layoutVersions([...b.values()]))}`);
console.log(`compared ${compared} runs (${missing} of ${a.length} not present in the second file, ${layoutMismatch.length} with a different world layout)`);
console.log(`second file: ${onlySecond.length} run(s) not present in the first file (not compared)`);
if (excluded.length) console.log(`EXCLUDED (failed or never run, not compared): ${excluded.length}: ${excluded.slice(0, 20).join(", ")}${excluded.length > 20 ? " …" : ""}`);
console.log(`identical apart from wall-clock timing and config: ${same}/${compared}`);
console.log(`config identical: ${sameConfig}/${compared}`);
if (bothProvenance) console.log(`same build, mission config hash and artifacts: ${sameProvenance}/${bothProvenance} pairs with provenance`);
if (legacyPairs) console.log(`${legacyPairs} pair(s) compare a P1 record with a historical one: fields only P1 records have were ignored (${[...P1_ONLY].join(", ")})`);
if (differing.length) console.log(`differing runs: ${differing.slice(0, 20).join(", ")}${differing.length > 20 ? " …" : ""}`);
if (layoutMismatch.length) console.log(`LAYOUT MISMATCH (not compared): ${layoutMismatch.slice(0, 20).join(", ")}${layoutMismatch.length > 20 ? " …" : ""}`);
if (compared === 0) console.log("NOTHING COMPARED: no run in the first file has a counterpart on the same world layout in the second file.");
if (differing.length || missing || layoutMismatch.length || compared === 0) process.exit(1);
if (excluded.length || !completeA.ok || !completeB.ok) {
  console.log(`PARTIAL COMPARISON: the ${compared} compared run(s) match, but ${excluded.length} mission(s) were excluded and at least one input is not a complete batch. This is not a comparison of the whole experiments.`);
  process.exit(5);
}
process.exit(0);
