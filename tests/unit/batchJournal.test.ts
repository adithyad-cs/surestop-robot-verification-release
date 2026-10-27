// Stage 4: durable batch checkpoints, incomplete-batch detection, recovery, and the refusal of
// failed or incomplete batches by merge, aggregate and compare-runs.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  JOURNAL_SCHEMA,
  JournalWriter,
  batchCompleteness,
  deriveStatus,
  journalPathFor,
  missingJobs,
  orderedRuns,
  parseJournal,
  writeFileAtomic,
} from "../../scripts/batch-journal.mjs";

const ROOT = path.resolve(__dirname, "../..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "surestop-journal-"));
let n = 0;
const fresh = (name: string) => path.join(tmp, `${++n}-${name}`);

const detector = { name: "coco-ssd", packageVersion: "2.2.3", tfjsVersion: "4.22.0", base: "lite_mobilenet_v2", backend: "wasm" };
const backend = { backend: "wasm", reason: "test", glRenderer: null };
const jobs = [1, 2, 3, 4].map((seed) => ({ scenarioId: "clear-target", seed, variant: "surestop" }));
const run = (seed: number, outcome = "ARRIVED") => ({
  variant: "surestop",
  result: { scenarioId: "clear-target", seed, method: "surestop", outcome, frames: [], config: {}, stats: {} },
  score: { scenarioId: "clear-target", seed, method: "surestop", outcome, targetPresent: true, correctArrival: outcome === "ARRIVED", falseArrival: false, abstained: false, navFailure: false, verificationInitiated: true, nonTargetEncountered: false, targetEncountered: true, correctTerminal: outcome === "ARRIVED", trackLabels: [], simTime: 1, pathLength: 1, frames: 1, verificationFrames: 0, decisionDelay: 0 },
});
const failure = (seed: number) => ({ scenarioId: "clear-target", seed, variant: "surestop", layout: "v1", error: "Error: WebGL context lost" });
const header = { type: "header", schema: JOURNAL_SCHEMA, baseUrl: "http://localhost:3100", query: "run=1&scenarios=clear-target&seeds=1,2,3,4&methods=surestop", out: "out.json" };
const plan = { type: "plan", jobs, layout: "v1", provenance: null, backend, detector };

function journal(entries: object[]): string {
  const f = fresh("out.json.journal.jsonl");
  const w = new JournalWriter(f, { create: true });
  for (const e of entries) w.append(e);
  w.close();
  return f;
}
const node = (script: string, args: string[]) => spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...args], { encoding: "utf8" });
function aggregate(input: string, output: string) {
  try {
    execFileSync("npm", ["run", "-s", "aggregate", "--", "evaluation", input, output], { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
    return { status: 0, stderr: "" };
  } catch (e) {
    const x = e as { status?: number; stderr?: string };
    return { status: x.status ?? 1, stderr: x.stderr ?? "" };
  }
}
const batchFile = (name: string, body: object) => {
  const f = fresh(name);
  fs.writeFileSync(f, JSON.stringify({ detector, backend, wallMs: 1, ...body }));
  return f;
};

describe("journal: durability and parsing", () => {
  it("every append is one complete, fsynced line; a full journal parses to a complete batch", () => {
    const f = journal([header, plan, ...jobs.map((j) => ({ type: "run", run: run(j.seed) })), { type: "end", status: "complete", final: "out.json" }]);
    const text = fs.readFileSync(f, "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(text.trim().split("\n")).toHaveLength(7);
    const j = parseJournal(text);
    expect(j.errors).toEqual([]);
    expect(j.runs.size).toBe(4);
    expect(deriveStatus(jobs, j.runs, j.failures)).toBe("complete");
    expect(j.end).toMatchObject({ status: "complete" });
  });

  it("an existing journal is never overwritten, and resuming needs one", () => {
    const f = journal([header]);
    expect(() => new JournalWriter(f, { create: true })).toThrow(/already exists/);
    expect(() => new JournalWriter(fresh("none.jsonl"), { create: false })).toThrow(/does not exist/);
    expect(journalPathFor("/x/out.json")).toBe("/x/out.json.journal.jsonl");
  });

  it("interruption after checkpoints: completed runs survive and the batch is incomplete", () => {
    const j = parseJournal(fs.readFileSync(journal([header, plan, { type: "run", run: run(1) }, { type: "failure", failure: failure(2) }]), "utf8"));
    expect(j.errors).toEqual([]);
    expect([...j.runs.keys()]).toEqual(["clear-target|1|surestop"]);
    expect([...j.failures.keys()]).toEqual(["clear-target|2|surestop"]);
    expect(deriveStatus(jobs, j.runs, j.failures)).toBe("incomplete");
    expect(missingJobs(jobs, j.runs, j.failures).map((x) => x.seed)).toEqual([3, 4]);
    expect(j.end).toBeNull();
  });

  it("a torn last line (crash mid-write) is reported and ignored; earlier checkpoints stand", () => {
    const f = journal([header, plan, { type: "run", run: run(1) }]);
    fs.appendFileSync(f, JSON.stringify({ type: "run", run: run(2) }).slice(0, 40));
    const j = parseJournal(fs.readFileSync(f, "utf8"));
    expect(j.errors).toEqual([]);
    expect(j.tornTail).toBe(true);
    expect([...j.runs.keys()]).toEqual(["clear-target|1|surestop"]);
  });

  it.each([
    ["a malformed line in the middle", (f: string) => fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace('"type":"run"', '"type":"run"}{')), /not valid JSON/],
    ["a missing header", (f: string) => fs.writeFileSync(f, fs.readFileSync(f, "utf8").split("\n").slice(1).join("\n")), /header/],
    ["a duplicate completed run", (f: string) => fs.appendFileSync(f, `${JSON.stringify({ type: "run", run: run(1) })}\n`), /duplicate/],
    ["a run that was never planned", (f: string) => fs.appendFileSync(f, `${JSON.stringify({ type: "run", run: run(9) })}\n`), /not a planned job/],
    ["an entry after the end", (f: string) => fs.appendFileSync(f, `${JSON.stringify({ type: "end", status: "failed" })}\n${JSON.stringify({ type: "run", run: run(2) })}\n`), /after the end/],
    ["an incompatible resumed plan", (f: string) => fs.appendFileSync(f, `${JSON.stringify({ ...plan, jobs: jobs.slice(0, 2) })}\n`), /not compatible: the planned jobs differ/],
  ])("malformed checkpoint: %s is refused, never repaired", (_name, corrupt, msg) => {
    const f = journal([header, plan, { type: "run", run: run(1) }]);
    corrupt(f);
    const j = parseJournal(fs.readFileSync(f, "utf8"));
    expect(j.errors.join(" ")).toMatch(msg);
    const r = node("recover-batch.mjs", [f, fresh("recovered.json")]);
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/journal is not usable/);
  });

  it("a resumed session with another build is refused (same rules as merging)", () => {
    const prov = (buildId: string) => ({
      schema: "surestop.batch-provenance/1",
      build: { sourceCommit: "a".repeat(40), sourceDirty: false, buildId },
      artifacts: { manifestSchema: "x", detectorSha256: "d", runtimeSha256: "r", assetsSha256: "s" },
      runtime: { userAgent: "UA", tfBackend: "wasm", detector: { packageVersion: "2.2.3", base: "lite_mobilenet_v2" } },
      protocol: { hash: "p".repeat(64), descriptor: { variants: [{ label: "surestop", missionConfigHash: "c".repeat(64) }] } },
      scenarios: ["clear-target"],
    });
    const p1run = { ...run(1), recordSchema: "surestop.run-record/2", provenance: { protocolHash: "p".repeat(64), missionConfigHash: "c".repeat(64), build: { buildId: "b1", sourceCommit: "a".repeat(40) }, artifacts: prov("b1").artifacts } };
    const ok = parseJournal(fs.readFileSync(journal([header, { ...plan, provenance: prov("b1") }, { type: "run", run: p1run }, { ...plan, provenance: prov("b1") }]), "utf8"));
    expect(ok.errors).toEqual([]);
    expect(ok.sessions).toBe(2);
    const bad = parseJournal(fs.readFileSync(journal([header, { ...plan, provenance: prov("b1") }, { type: "run", run: p1run }, { ...plan, provenance: prov("b2") }]), "utf8"));
    expect(bad.errors.join(" ")).toMatch(/not compatible: .*different builds/);
  });

  it("resume never duplicates: a later run supersedes an earlier failure; runs come out in plan order", () => {
    const j = parseJournal(
      fs.readFileSync(
        journal([header, plan, { type: "run", run: run(2) }, { type: "failure", failure: failure(1) }, plan, { type: "run", run: run(1) }, { type: "run", run: run(4) }, { type: "run", run: run(3) }, { type: "end", status: "complete", final: "out.json" }]),
        "utf8",
      ),
    );
    expect(j.errors).toEqual([]);
    expect(j.failures.size).toBe(0);
    expect(deriveStatus(jobs, j.runs, j.failures)).toBe("complete");
    expect(orderedRuns(jobs, j.runs).map((r) => r.result.seed)).toEqual([1, 2, 3, 4]);
  });

  it("writeFileAtomic replaces the file in one step and leaves no temporary file", () => {
    const f = fresh("final.json");
    fs.writeFileSync(f, "old");
    writeFileAtomic(f, '{"new":true}');
    expect(fs.readFileSync(f, "utf8")).toBe('{"new":true}');
    expect(fs.readdirSync(path.dirname(f)).filter((x) => x.includes(".tmp-"))).toEqual([]);
  });
});

describe("batch status: complete, failed and incomplete are distinguished", () => {
  it.each([
    ["no batchStatus, no failures (written before stage 4)", {}, true, /complete \(no batchStatus/],
    ["no batchStatus, with failures", { failures: [failure(1)] }, false, /failed/],
    ["complete", { batchStatus: "complete" }, true, /^complete$/],
    ["failed", { batchStatus: "failed", failures: [failure(1)] }, false, /^failed$/],
    ["incomplete", { batchStatus: "incomplete", missingJobs: [jobs[3]] }, false, /^incomplete$/],
    ["complete but listing failures", { batchStatus: "complete", failures: [failure(1)] }, false, /^complete$/],
    ["unknown status", { batchStatus: "active" }, false, /active/],
    ["a journal header", { schema: JOURNAL_SCHEMA }, false, /journal/],
  ])("%s", (_n, file, ok, status) => {
    const c = batchCompleteness({ runs: [], ...file });
    expect(c.ok).toBe(ok);
    expect(c.status).toMatch(status);
  });
});

describe("recovery and refusal of incomplete batches", () => {
  const partialJournal = () => journal([header, plan, { type: "run", run: run(1) }, { type: "run", run: run(2) }]);

  it("recover-batch writes an incomplete batch with the completed runs and the missing jobs, never a complete one", () => {
    const out = fresh("recovered.json");
    const r = node("recover-batch.mjs", [partialJournal(), out]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/batchStatus incomplete; 2 completed, 0 failed, 2 not run, of 4 planned/);
    expect(r.stdout).toMatch(/--resume/);
    const d = JSON.parse(fs.readFileSync(out, "utf8"));
    expect(d).toMatchObject({ batchStatus: "incomplete", checkpointStatus: "incomplete", plannedJobs: 4, journalEnded: null });
    expect(d.runs.map((x: { result: { seed: number } }) => x.result.seed)).toEqual([1, 2]);
    expect(d.missingJobs.map((x: { seed: number }) => x.seed)).toEqual([3, 4]);
    // Even with every mission checkpointed, recovery does not promote the batch.
    const all = journal([header, plan, ...jobs.map((x) => ({ type: "run", run: run(x.seed) }))]);
    const out2 = fresh("recovered-all.json");
    expect(node("recover-batch.mjs", [all, out2]).status).toBe(0);
    expect(JSON.parse(fs.readFileSync(out2, "utf8"))).toMatchObject({ batchStatus: "incomplete", checkpointStatus: "complete" });
  });

  it("merge-batches refuses an incomplete batch and a journal", () => {
    const out = fresh("recovered.json");
    node("recover-batch.mjs", [partialJournal(), out]);
    const m = node("merge-batches.mjs", [fresh("merged.json"), out]);
    expect(m.status).not.toBe(0);
    expect(m.stderr).toMatch(/not complete:[\s\S]*incomplete batch: 2 planned mission\(s\) never ran/);
    const jm = node("merge-batches.mjs", [fresh("merged2.json"), partialJournal()]);
    expect(jm.status).not.toBe(0);
    expect(jm.stderr).toMatch(/checkpoint journal, not a batch/);
  });

  it("aggregate refuses an incomplete batch", () => {
    const out = fresh("recovered.json");
    node("recover-batch.mjs", [partialJournal(), out]);
    const r = aggregate(out, fresh("eval-runs.json"));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/refusing to aggregate: the batch is not complete \(incomplete batch/);
  }, 120_000);

  it("clean complete batches still merge, and the merge is marked complete", () => {
    const a = batchFile("a.json", { runs: [run(1), run(2)], failures: [], batchStatus: "complete", journal: "a.json.journal.jsonl", sessions: 1 });
    const b = batchFile("b.json", { runs: [run(3), run(4)], failures: [], batchStatus: "complete", journal: "b.json.journal.jsonl", sessions: 2 });
    const out = fresh("merged.json");
    const m = node("merge-batches.mjs", [out, a, b]);
    expect(m.status).toBe(0);
    const d = JSON.parse(fs.readFileSync(out, "utf8"));
    expect(d).toMatchObject({ batchStatus: "complete", journals: ["a.json.journal.jsonl", "b.json.journal.jsonl"] });
    expect(d).not.toHaveProperty("journal");
    expect(d).not.toHaveProperty("sessions");
    expect(d.runs).toHaveLength(4);
  });
});
