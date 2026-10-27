// Batch and CLI reliability (stage 2): completed runs survive a later mission failure, failures are
// recorded and never scored, merge and aggregate refuse batches with failures, and batch files
// written before failures were recorded stay readable.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseVariant } from "@/experiments/engine";
import { fakeEngine } from "./fixtures/fakeEngine";

const ROOT = path.resolve(__dirname, "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "surestop-batch-cli-"));
const detector = { name: "coco-ssd", packageVersion: "2.2.3", tfjsVersion: "4.22.0", base: "lite_mobilenet_v2", backend: "wasm" };
const run = (seed: number) => ({
  variant: "surestop",
  result: { scenarioId: "clear-target", seed, method: "surestop", outcome: "ARRIVED", frames: [], config: {}, stats: {} },
  score: { scenarioId: "clear-target", seed, method: "surestop", outcome: "ARRIVED", targetPresent: true, correctArrival: true, falseArrival: false, abstained: false, navFailure: false, verificationInitiated: true, nonTargetEncountered: false, targetEncountered: true, correctTerminal: true, trackLabels: [], simTime: 1, pathLength: 1, frames: 1, verificationFrames: 0, decisionDelay: 0 },
});
const failure = { scenarioId: "no-such-scenario", seed: 1, variant: "surestop", layout: "v1", error: "Error: unknown scenario no-such-scenario" };
function write(name: string, body: object) {
  const f = path.join(tmp, name);
  fs.writeFileSync(f, JSON.stringify({ detector, backend: { backend: "wasm", reason: "test", glRenderer: null }, wallMs: 1, ...body }));
  return f;
}
const node = (script: string, args: string[]) => spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...args], { encoding: "utf8" });
function aggregate(mode: string, input: string, output: string) {
  try {
    const stdout = execFileSync("npm", ["run", "-s", "aggregate", "--", mode, input, output], { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const x = e as { status?: number; stdout?: string; stderr?: string };
    return { status: x.status ?? 1, stdout: x.stdout ?? "", stderr: x.stderr ?? "" };
  }
}

describe("a batch with a failed mission", () => {
  it("keeps the runs completed before the failure, and records the failure without an outcome or score", async () => {
    const { runs, failures } = await fakeEngine().runBatch({ scenarios: ["clear-target", "no-such-scenario"], seeds: [1], variants: [parseVariant("surestop")] });
    // The fake engine's sensor detects nothing, so the completed mission ends NOT_FOUND; it is kept.
    expect(runs.map((r) => `${r.result.scenarioId} ${r.result.outcome}`)).toEqual(["clear-target NOT_FOUND"]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ scenarioId: "no-such-scenario", seed: 1, variant: "surestop", layout: "v1", error: expect.stringMatching(/unknown scenario/) });
    for (const k of ["result", "score", "outcome"]) expect(failures[0]).not.toHaveProperty(k);
  });

  it("merge-batches refuses it, names the failed mission, and writes nothing", () => {
    const out = path.join(tmp, "merged-failed.json");
    const r = node("merge-batches.mjs", [out, write("ok.json", { runs: [run(1)] }), write("failed.json", { runs: [run(2)], failures: [failure] })]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/batches contain 1 failed mission\(s\); re-run them before merging/);
    expect(r.stderr).toMatch(/failed\.json: no-such-scenario seed 1 surestop/);
    expect(fs.existsSync(out)).toBe(false);
  });

  it.each(["evaluation", "calibration"])("aggregate %s refuses it and writes nothing", (mode) => {
    const out = path.join(tmp, `out-${mode}-eval-runs.json`);
    const r = aggregate(mode, write(`agg-${mode}.json`, { runs: [run(1)], failures: [failure] }), out);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/refusing to aggregate: the batch contains 1 failed mission\(s\)/);
    expect(r.stderr).toMatch(/no-such-scenario seed 1 surestop: Error: unknown scenario/);
    expect(fs.existsSync(out)).toBe(false);
  }, 120_000);
});

describe("compatibility with batch files written before failures were recorded", () => {
  it("merge-batches accepts files with no failures field and with an empty list", () => {
    const out = path.join(tmp, "merged-ok.json");
    const r = node("merge-batches.mjs", [out, write("old.json", { runs: [run(1)] }), write("new.json", { runs: [run(2)], failures: [] })]);
    expect(r.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(out, "utf8")).runs).toHaveLength(2);
  });

  it("the committed calibration v2 batch (no failures field) still merges and aggregates as before", () => {
    const raw = path.join(tmp, "calib2.json");
    fs.writeFileSync(raw, zlib.gunzipSync(fs.readFileSync(path.join(ROOT, "docs/experiments/raw/calib2.json.gz"))));
    expect(JSON.parse(fs.readFileSync(raw, "utf8"))).not.toHaveProperty("failures");
    const merged = path.join(tmp, "calib2-merged.json");
    expect(node("merge-batches.mjs", [merged, raw]).status).toBe(0);
    const out = path.join(tmp, "calibration.json");
    const r = aggregate("calibration", merged, out);
    expect(r.status).toBe(0);
    const cal = JSON.parse(fs.readFileSync(out, "utf8"));
    const committed = JSON.parse(fs.readFileSync(path.join(ROOT, "public/data/calibration.json"), "utf8"));
    expect(cal.selected).toEqual(committed.selected);
    expect(cal.rows.map((x: { variant: string; completion: { num: number; den: number } }) => [x.variant, x.completion.num, x.completion.den])).toEqual(
      committed.rows.map((x: { variant: string; completion: { num: number; den: number } }) => [x.variant, x.completion.num, x.completion.den]),
    );
  }, 120_000);
});
