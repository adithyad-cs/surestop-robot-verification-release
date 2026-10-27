// Stage 4: compare-runs reports failed and incomplete inputs instead of comparing only the
// missions that happened to complete.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JOURNAL_SCHEMA, JournalWriter } from "../../scripts/batch-journal.mjs";

const ROOT = path.resolve(__dirname, "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "surestop-compare-"));
let n = 0;
const fresh = (name: string) => path.join(tmp, `${++n}-${name}`);
const detector = { name: "coco-ssd", packageVersion: "2.2.3", tfjsVersion: "4.22.0", base: "lite_mobilenet_v2", backend: "wasm" };
const backend = { backend: "wasm", reason: "test", glRenderer: null };
const jobs = [1, 2, 3, 4].map((seed) => ({ scenarioId: "clear-target", seed, variant: "surestop" }));
const run = (seed: number, outcome = "ARRIVED") => ({
  variant: "surestop",
  result: { scenarioId: "clear-target", seed, method: "surestop", outcome, frames: [], config: {}, stats: {} },
  score: { scenarioId: "clear-target", seed, method: "surestop", outcome, correctArrival: outcome === "ARRIVED" },
});
const failure = (seed: number) => ({ scenarioId: "clear-target", seed, variant: "surestop", layout: "v1", error: "Error: WebGL context lost" });
const header = { type: "header", schema: JOURNAL_SCHEMA, baseUrl: "http://localhost:3100", query: "run=1", out: "out.json" };
const plan = { type: "plan", jobs, layout: "v1", provenance: null, backend, detector };
function journal(entries: object[]): string {
  const f = fresh("out.json.journal.jsonl");
  const w = new JournalWriter(f, { create: true });
  for (const e of entries) w.append(e);
  w.close();
  return f;
}
const node = (script: string, args: string[]) => spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...args], { encoding: "utf8" });
const batchFile = (name: string, body: object) => {
  const f = fresh(name);
  fs.writeFileSync(f, JSON.stringify({ detector, backend, wallMs: 1, ...body }));
  return f;
};

describe("compare-runs with failed and incomplete inputs", () => {
  const complete = () => batchFile("complete.json", { runs: jobs.map((j) => run(j.seed)), failures: [], batchStatus: "complete" });
  const failed = () => batchFile("failed.json", { runs: [run(1), run(2), run(3)], failures: [failure(4)], batchStatus: "failed" });

  it("two complete identical batches: exit 0, and runs only in the second file are reported", () => {
    const r = node("compare-runs.mjs", [batchFile("sub.json", { runs: [run(1)], batchStatus: "complete", failures: [] }), complete()]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/identical apart from wall-clock timing and config: 1\/1/);
    expect(r.stdout).toMatch(/second file: 3 run\(s\) not present in the first file \(not compared\)/);
  });

  it("a failed input is refused by default (exit 4) and named", () => {
    const r = node("compare-runs.mjs", [complete(), failed()]);
    expect(r.status).toBe(4);
    expect(r.stdout).toMatch(/second file: failed; 3 completed run\(s\), 1 failed, 0 never run/);
    expect(r.stdout).toMatch(/REFUSED: second file is not a complete batch \(1 failed mission\(s\)\)/);
    expect(r.stdout).not.toMatch(/identical apart/);
  });

  it("an incomplete (recovered) input is refused by default", () => {
    const out = fresh("recovered.json");
    node("recover-batch.mjs", [journal([header, plan, { type: "run", run: run(1) }]), out]);
    const r = node("compare-runs.mjs", [out, complete()]);
    expect(r.status).toBe(4);
    expect(r.stdout).toMatch(/REFUSED: first file is not a complete batch \(incomplete batch: 3 planned/);
  });

  it("--allow-incomplete compares explicitly, lists every exclusion, and never exits 0", () => {
    const r = node("compare-runs.mjs", ["--allow-incomplete", complete(), failed()]);
    expect(r.status).toBe(5);
    expect(r.stdout).toMatch(/EXCLUDED \(failed or never run, not compared\): 1: clear-target\|4\|surestop \(failed or not run in the second file\)/);
    expect(r.stdout).toMatch(/identical apart from wall-clock timing and config: 3\/3/);
    expect(r.stdout).toMatch(/PARTIAL COMPARISON/);
    // Differences still fail in this mode.
    const diff = batchFile("diff.json", { runs: [run(1), run(2), run(3, "NOT_FOUND")], failures: [failure(4)], batchStatus: "failed" });
    const d = node("compare-runs.mjs", ["--allow-incomplete", complete(), diff]);
    expect(d.status).toBe(1);
    expect(d.stdout).toMatch(/differing runs: clear-target\|3\|surestop/);
  });

  it("historical complete files (no batchStatus, no failures) compare as before", () => {
    const a = batchFile("h1.json", { runs: [run(1), run(2)] });
    const b = batchFile("h2.json", { runs: [run(1), run(2)] });
    const r = node("compare-runs.mjs", [a, b]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/first file: complete \(no batchStatus: written before stage 4\)/);
  });
});

describe("compare-runs with Lab exports (surestop.experiment/2)", () => {
  const labExport = (body: object) =>
    batchFile("lab.json", { schema: "surestop.experiment/2", layout: "v1", notes: "", runsWithoutBatch: 0, failuresRecorded: true, ...body });
  const all = () => batchFile("complete.json", { runs: jobs.map((j) => run(j.seed)), failures: [], batchStatus: "complete" });

  it("an export without batch records (recorded dataset) is read like a file from before stage 4", () => {
    const r = node("compare-runs.mjs", [labExport({ runs: jobs.map((j) => run(j.seed)), failures: null, batches: null, missingJobs: null, failuresRecorded: false, batchStatus: null }), all()]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/complete \(no batchStatus: written before stage 4\)/);
  });

  it("a failed Lab batch is refused", () => {
    const r = node("compare-runs.mjs", [labExport({ runs: [run(1), run(2), run(3)], failures: [{ ...failure(4), batchId: "b" }], batches: [], missingJobs: [], batchStatus: "failed" }), all()]);
    expect(r.status).toBe(4);
    expect(r.stdout).toMatch(/REFUSED: first file is not a complete batch \(1 failed mission\(s\)\)/);
  });

  it("an interrupted Lab batch is refused; with --allow-incomplete its never-run missions are listed as excluded", () => {
    const missingJobs = [3, 4].map((seed) => ({ scenarioId: "clear-target", seed, variant: "surestop", batchId: "b" }));
    const f = labExport({ runs: [run(1), run(2)], failures: [], batches: [], missingJobs, batchStatus: "incomplete" });
    const refused = node("compare-runs.mjs", [f, all()]);
    expect(refused.status).toBe(4);
    expect(refused.stdout).toMatch(/incomplete batch: 2 planned mission\(s\) never ran/);
    const partial = node("compare-runs.mjs", ["--allow-incomplete", f, all()]);
    expect(partial.status).toBe(5);
    expect(partial.stdout).toMatch(/EXCLUDED[^\n]*clear-target\|3\|surestop/);
    expect(partial.stdout).toMatch(/EXCLUDED[^\n]*clear-target\|4\|surestop/);
  });

  it("a complete Lab batch compares like any complete batch", () => {
    const r = node("compare-runs.mjs", [labExport({ runs: jobs.map((j) => run(j.seed)), failures: [], batches: [], missingJobs: [], batchStatus: "complete" }), all()]);
    expect(r.status).toBe(0);
  });
});
