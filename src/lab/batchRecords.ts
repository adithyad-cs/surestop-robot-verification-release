// Lab batch bookkeeping (stage 4). A batch run in the Lab is recorded as a LabBatch, and each failed
// mission as a LabFailure, in this browser's IndexedDB next to the runs (src/lib/runStore.ts), so
// failures survive a reload and reach the JSON export. Pure functions only: no storage, no React.
//
// Status (same words as scripts/batch-journal.mjs):
//   active      the batch is running in this page
//   complete    every planned mission completed
//   failed      every planned mission ended and at least one failed (failures are never scored)
//   incomplete  the batch ended early: stopped by the user, ended by an error, or interrupted (a
//               batch still "active" when the Lab loads was cut off by a reload or closed tab)
import type { BatchFailure } from "@/experiments/batch";

export const LAB_BATCH_SCHEMA = "surestop.lab-batch/1";

export type LabBatchStatus = "active" | "complete" | "failed" | "incomplete";
export type IncompleteReason = "stopped" | "error" | "interrupted";

export interface LabBatch {
  schema: typeof LAB_BATCH_SCHEMA;
  batchId: string;
  startedAt: string;
  endedAt: string | null;
  status: LabBatchStatus;
  incompleteReason: IncompleteReason | null;
  error: string | null;
  spec: { scenarios: string[]; seeds: number[]; variants: string[]; layout: "v1" };
  planned: number;
  completed: number;
  failed: number;
}

/** A failed mission of a Lab batch. It has no result and no score. */
export interface LabFailure extends BatchFailure {
  batchId: string;
}

export function newBatch(batchId: string, startedAt: string, spec: LabBatch["spec"]): LabBatch {
  return {
    schema: LAB_BATCH_SCHEMA,
    batchId,
    startedAt,
    endedAt: null,
    status: "active",
    incompleteReason: null,
    error: null,
    spec,
    planned: spec.scenarios.length * spec.seeds.length * spec.variants.length,
    completed: 0,
    failed: 0,
  };
}

export function finishBatch(b: LabBatch, endedAt: string, opts: { stopped?: boolean; error?: string | null } = {}): LabBatch {
  const ended = b.completed + b.failed;
  let status: LabBatchStatus;
  let incompleteReason: IncompleteReason | null = null;
  if (opts.error) {
    status = "incomplete";
    incompleteReason = "error";
  } else if (ended < b.planned) {
    status = "incomplete";
    incompleteReason = opts.stopped ? "stopped" : "error";
  } else status = b.failed ? "failed" : "complete";
  return { ...b, endedAt, status, incompleteReason, error: opts.error ?? null };
}

/** The status to show and export: a stored "active" batch that is not running here was interrupted. */
export function effectiveBatch(b: LabBatch, runningBatchId: string | null): LabBatch {
  if (b.status === "active" && b.batchId !== runningBatchId) return { ...b, status: "incomplete", incompleteReason: "interrupted" };
  return b;
}

/** Overall status of a set of batches (and any failures): null when there are no batches. */
export function overallStatus(batches: LabBatch[], failures: number): "complete" | "failed" | "incomplete" | null {
  if (!batches.length) return failures ? "failed" : null;
  if (batches.some((b) => b.status === "incomplete" || b.status === "active")) return "incomplete";
  if (failures || batches.some((b) => b.status === "failed")) return "failed";
  return "complete";
}

export interface PlannedJob {
  scenarioId: string;
  seed: number;
  variant: string;
}

const jobKey = (j: PlannedJob) => `${j.scenarioId}|${j.seed}|${j.variant}`;

/** The missions a batch planned, in run order (scenario, then seed, then method). */
export function plannedJobs(b: LabBatch): PlannedJob[] {
  return b.spec.scenarios.flatMap((scenarioId) => b.spec.seeds.flatMap((seed) => b.spec.variants.map((variant) => ({ scenarioId, seed, variant }))));
}

/**
 * Planned missions of each batch that neither completed (a run with its labBatchId) nor failed:
 * not yet run (active), or never run (stopped, error, interrupted). Same meaning as missingJobs in
 * scripts/batch-journal.mjs.
 */
export function batchMissingJobs(
  batches: LabBatch[],
  runs: Array<{ labBatchId?: string; variant: string; result: { scenarioId: string; seed: number } }>,
  failures: LabFailure[],
): Array<PlannedJob & { batchId: string }> {
  const ended = new Set([
    ...runs.filter((r) => r.labBatchId).map((r) => `${r.labBatchId}#${jobKey({ scenarioId: r.result.scenarioId, seed: r.result.seed, variant: r.variant })}`),
    ...failures.map((f) => `${f.batchId}#${jobKey(f)}`),
  ]);
  return batches.flatMap((b) => plannedJobs(b).filter((j) => !ended.has(`${b.batchId}#${jobKey(j)}`)).map((j) => ({ ...j, batchId: b.batchId })));
}

export function describeBatch(b: LabBatch): string {
  const base = `${b.completed} completed, ${b.failed} failed of ${b.planned} planned`;
  if (b.status === "incomplete") return `incomplete (${b.incompleteReason ?? "unknown"}): ${base}${b.error ? `; ${b.error}` : ""}`;
  return `${b.status}: ${base}`;
}
