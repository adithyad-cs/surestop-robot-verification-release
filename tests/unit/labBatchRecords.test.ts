// Stage 4: Lab batch status and the version 2 JSON export (failed missions and batch status).
import { describe, expect, it } from "vitest";
import { parseVariant } from "@/experiments/engine";
import { EXPERIMENT_SCHEMA, experimentToJson, readExperimentExport, type ExperimentExportV1 } from "@/eval/export";
import { batchMissingJobs, describeBatch, effectiveBatch, finishBatch, LAB_BATCH_SCHEMA, newBatch, overallStatus, type LabBatch, type LabFailure } from "@/lab/batchRecords";
import { fakeEngine } from "./fixtures/fakeEngine";

const SPEC = { scenarios: ["clear-target", "lookalike-3d"], seeds: [1], variants: ["surestop"], layout: "v1" as const };
const T0 = "2026-10-26T10:00:00.000Z";
const T1 = "2026-10-26T10:05:00.000Z";

const withCounts = (b: LabBatch, completed: number, failed: number): LabBatch => ({ ...b, completed, failed });
const failure = (batchId: string): LabFailure => ({ batchId, scenarioId: "lookalike-3d", seed: 1, variant: "surestop", layout: "v1", error: "Error: asset failed to load" });

describe("Lab batch status", () => {
  it("a new batch is active and plans every scenario x seed x method", () => {
    const b = newBatch("b1", T0, SPEC);
    expect(b).toMatchObject({ schema: LAB_BATCH_SCHEMA, status: "active", planned: 2, completed: 0, failed: 0, endedAt: null });
  });

  it("complete only when every planned mission completed", () => {
    expect(finishBatch(withCounts(newBatch("b", T0, SPEC), 2, 0), T1)).toMatchObject({ status: "complete", incompleteReason: null, endedAt: T1 });
  });

  it("failed when every mission ended and one failed", () => {
    const b = finishBatch(withCounts(newBatch("b", T0, SPEC), 1, 1), T1);
    expect(b.status).toBe("failed");
    expect(describeBatch(b)).toBe("failed: 1 completed, 1 failed of 2 planned");
  });

  it("incomplete when stopped early or ended by an error, even if no mission failed", () => {
    expect(finishBatch(withCounts(newBatch("b", T0, SPEC), 1, 0), T1, { stopped: true })).toMatchObject({ status: "incomplete", incompleteReason: "stopped" });
    const e = finishBatch(withCounts(newBatch("b", T0, SPEC), 0, 0), T1, { error: "detector failed to load" });
    expect(e).toMatchObject({ status: "incomplete", incompleteReason: "error", error: "detector failed to load" });
    expect(describeBatch(e)).toContain("incomplete (error)");
    // An error after the last mission still leaves the batch incomplete, never complete.
    expect(finishBatch(withCounts(newBatch("b", T0, SPEC), 2, 0), T1, { error: "x" }).status).toBe("incomplete");
  });

  it("a stored active batch not running in this page reads as interrupted", () => {
    const b = withCounts(newBatch("b", T0, SPEC), 1, 0);
    expect(effectiveBatch(b, "b")).toBe(b);
    expect(effectiveBatch(b, null)).toMatchObject({ status: "incomplete", incompleteReason: "interrupted", completed: 1 });
    const done = finishBatch(withCounts(b, 2, 0), T1);
    expect(effectiveBatch(done, null)).toBe(done);
  });

  it("overall status: incomplete over failed over complete; null without batches", () => {
    const complete = finishBatch(withCounts(newBatch("a", T0, SPEC), 2, 0), T1);
    const failed = finishBatch(withCounts(newBatch("b", T0, SPEC), 1, 1), T1);
    const stopped = finishBatch(withCounts(newBatch("c", T0, SPEC), 1, 0), T1, { stopped: true });
    expect(overallStatus([], 0)).toBeNull();
    expect(overallStatus([complete], 0)).toBe("complete");
    expect(overallStatus([complete, failed], 1)).toBe("failed");
    expect(overallStatus([complete, failed, stopped], 1)).toBe("incomplete");
    expect(overallStatus([newBatch("d", T0, SPEC)], 0)).toBe("incomplete");
  });
});

describe("Lab missing missions", () => {
  it("lists the planned missions of a batch that neither completed nor failed", () => {
    const b = newBatch("b1", T0, { ...SPEC, seeds: [1, 2] });
    const runs = [{ labBatchId: "b1", variant: "surestop", result: { scenarioId: "clear-target", seed: 1 } }];
    // A run of the same mission from another batch, or from before batches were recorded, does not count.
    const others = [{ labBatchId: "b0", variant: "surestop", result: { scenarioId: "clear-target", seed: 2 } }, { variant: "surestop", result: { scenarioId: "lookalike-3d", seed: 2 } }];
    const missing = batchMissingJobs([b], [...runs, ...others], [failure("b1")]);
    expect(missing).toEqual([
      { scenarioId: "clear-target", seed: 2, variant: "surestop", batchId: "b1" },
      { scenarioId: "lookalike-3d", seed: 2, variant: "surestop", batchId: "b1" },
    ]);
    expect(batchMissingJobs([withCounts(b, 4, 0)], [], [])).toHaveLength(4);
  });
});

describe("Lab JSON export, version 2", () => {
  it("exports failed missions separately from scored runs, with the batch status", async () => {
    const r = { ...(await fakeEngine().runOne("clear-target", 1, parseVariant("surestop"))), labBatchId: "b1" };
    const b = finishBatch(withCounts(newBatch("b1", T0, SPEC), 1, 1), T1);
    const out = JSON.parse(experimentToJson([r], "test", undefined, { batches: [b], failures: [failure("b1")], missingJobs: [] }));
    expect(out.schema).toBe(EXPERIMENT_SCHEMA);
    expect(out.runs).toHaveLength(1);
    expect(out.runs[0].labBatchId).toBe("b1");
    expect(out.failures).toEqual([failure("b1")]);
    // A failure is never a scored mission: it has no result, score or outcome.
    expect(out.failures[0]).not.toHaveProperty("result");
    expect(out.failures[0]).not.toHaveProperty("score");
    expect(out.failures[0]).not.toHaveProperty("outcome");
    expect(out.batches[0]).toMatchObject({ batchId: "b1", status: "failed", planned: 2, completed: 1, failed: 1 });
    expect(out).toMatchObject({ failuresRecorded: true, runsWithoutBatch: 0, batchStatus: "failed" });
  });

  it("a clean batch exports batchStatus complete with no failures", async () => {
    const r = { ...(await fakeEngine().runOne("clear-target", 1, parseVariant("surestop"))), labBatchId: "b1" };
    const b = finishBatch(withCounts(newBatch("b1", T0, { ...SPEC, scenarios: ["clear-target"] }), 1, 0), T1);
    const out = JSON.parse(experimentToJson([r], "test", undefined, { batches: [b], failures: [], missingJobs: [] }));
    expect(out).toMatchObject({ failures: [], failuresRecorded: true, batchStatus: "complete" });
  });

  it("an interrupted batch exports as incomplete, also when all its missions so far succeeded", async () => {
    const r = { ...(await fakeEngine().runOne("clear-target", 1, parseVariant("surestop"))), labBatchId: "b1" };
    const b = effectiveBatch(withCounts(newBatch("b1", T0, SPEC), 1, 0), null);
    const out = JSON.parse(experimentToJson([r], "test", undefined, { batches: [b], failures: [], missingJobs: [] }));
    expect(out.batchStatus).toBe("incomplete");
    expect(out.batches[0].incompleteReason).toBe("interrupted");
  });

  it("runs from before failures were recorded are counted and make failuresRecorded false", async () => {
    const old = await fakeEngine().runOne("clear-target", 2, parseVariant("surestop"));
    const out = JSON.parse(experimentToJson([old], "test", undefined, { batches: [], failures: [], missingJobs: [] }));
    expect(out).toMatchObject({ failuresRecorded: false, runsWithoutBatch: 1, batchStatus: null });
  });

  it("data without failure records (the recorded dataset) exports failures as unknown, not as none", async () => {
    const r = await fakeEngine().runOne("clear-target", 1, parseVariant("surestop"));
    const out = JSON.parse(experimentToJson([r], "recorded"));
    expect(out).toMatchObject({ failures: null, batches: null, missingJobs: null, failuresRecorded: false, runsWithoutBatch: 1, batchStatus: null });
  });

  it("reads its own output back unchanged", async () => {
    const r = { ...(await fakeEngine().runOne("clear-target", 1, parseVariant("surestop"))), labBatchId: "b1" };
    const b = finishBatch(withCounts(newBatch("b1", T0, SPEC), 1, 1), T1);
    const text = experimentToJson([r], "test", undefined, { batches: [b], failures: [failure("b1")], missingJobs: [] });
    expect(readExperimentExport(JSON.parse(text))).toEqual(JSON.parse(text));
  });

  it("reads a version 1 export: runs kept, failures unknown", async () => {
    const r = await fakeEngine().runOne("clear-target", 1, parseVariant("surestop"));
    // The exact shape experimentToJson wrote before stage 4.
    const v1: ExperimentExportV1 = { schema: "surestop.experiment/1", exportedAt: T0, app: { name: "SureStop", version: "0.1.0" }, layout: "v1", notes: "old", runs: [r] };
    const read = readExperimentExport(JSON.parse(JSON.stringify(v1)));
    expect(read.runs).toEqual(JSON.parse(JSON.stringify([r])));
    expect(read).toMatchObject({ schema: EXPERIMENT_SCHEMA, notes: "old", exportedAt: T0, failures: null, batches: null, missingJobs: null, failuresRecorded: false, runsWithoutBatch: 1, batchStatus: null });
  });

  it("rejects unknown and malformed exports", () => {
    expect(() => readExperimentExport({ schema: "surestop.experiment/9", runs: [] })).toThrow(/unsupported export schema/);
    expect(() => readExperimentExport({ schema: EXPERIMENT_SCHEMA })).toThrow(/no runs/);
    expect(() => readExperimentExport({ schema: EXPERIMENT_SCHEMA, runs: [], failures: {}, batches: null, failuresRecorded: false })).toThrow(/failures/);
    expect(() => readExperimentExport({ schema: EXPERIMENT_SCHEMA, runs: [], failures: [], batches: [], missingJobs: 3 })).toThrow(/missingJobs/);
    expect(() => readExperimentExport({ schema: EXPERIMENT_SCHEMA, runs: [], failures: [], batches: [], missingJobs: [] })).toThrow(/failuresRecorded/);
    expect(() => readExperimentExport(null)).toThrow();
  });
});
