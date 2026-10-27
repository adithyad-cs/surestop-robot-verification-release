import type { TrialScore } from "./evaluate";
import type { MissionResult } from "@/mission/types";
import { overallStatus, type LabBatch, type LabFailure, type PlannedJob } from "@/lab/batchRecords";

export const TRIAL_CSV_COLUMNS = [
  "scenario",
  "seed",
  "method",
  "outcome",
  "target_present",
  "arrived_at_kind",
  "arrived_at_object",
  "correct_arrival",
  "false_arrival",
  "abstained",
  "nav_failure",
  "candidates_opened",
  "non_target_encountered",
  "target_encountered",
  "correct_terminal",
  "frames",
  "verification_frames",
  "path_length_m",
  "sim_time_s",
  "decision_delay_s",
  "candidate_labels",
] as const;

export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function trialsToCsv(trials: TrialScore[]): string {
  const rows = trials.map((t) =>
    [
      t.scenarioId,
      t.seed,
      t.method,
      t.outcome,
      t.targetPresent,
      t.arrivedAtKind ?? "",
      t.arrivedAtObject ?? "",
      t.correctArrival,
      t.falseArrival,
      t.abstained,
      t.navFailure,
      t.trackLabels.length,
      t.nonTargetEncountered,
      t.targetEncountered,
      t.correctTerminal,
      t.frames,
      t.verificationFrames,
      t.pathLength,
      t.simTime,
      t.decisionDelay ?? "",
      t.trackLabels.map((l) => `${l.trackId}:${l.kind}:${l.status}`).join(" "),
    ]
      .map(csvEscape)
      .join(","),
  );
  return [TRIAL_CSV_COLUMNS.join(","), ...rows].join("\n") + "\n";
}

/** Minimal RFC-4180 parser, used to verify export integrity in tests. */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out;
}

/** A Lab export written before stage 4: runs only; it says nothing about failed missions. */
export interface ExperimentExportV1 {
  schema: "surestop.experiment/1";
  exportedAt: string;
  app: { name: "SureStop"; version: string };
  layout: "v1";
  notes: string;
  runs: ExperimentExport["runs"];
}

export const EXPERIMENT_SCHEMA = "surestop.experiment/2";

/**
 * Lab export, version 2 (stage 4). Version 1 fields are unchanged; failed missions and batch
 * status are added. A failure has no result and no score, and is never one of `runs`.
 */
export interface ExperimentExport {
  schema: typeof EXPERIMENT_SCHEMA;
  exportedAt: string;
  app: { name: "SureStop"; version: string };
  /** World layout of every run in the file. The Lab only holds v1 (recorded-evaluation) runs. */
  layout: "v1";
  notes: string;
  /**
   * Runs as stored. Records written since P1 also carry recordSchema, provenance, layout and the
   * evaluator-only objects; historical (recorded) runs do not, and are exported unchanged. Runs
   * stored by the Lab since stage 4 carry labBatchId, the batch that produced them.
   */
  runs: Array<{ result: MissionResult; score: TrialScore; variant?: string; recordSchema?: string; provenance?: unknown; layout?: unknown; objects?: unknown; labBatchId?: string }>;
  /** Failed missions recorded for these runs' batches, or null where none were recorded (not "no failures"). */
  failures: LabFailure[] | null;
  /** The batches recorded in this browser (status as of the export), or null where none were recorded. */
  batches: LabBatch[] | null;
  /** Planned missions of those batches that neither completed nor failed; null where no batch was recorded. */
  missingJobs: Array<PlannedJob & { batchId: string }> | null;
  /**
   * true only when every exported run belongs to a recorded batch, so that `failures` lists every
   * failed mission of the batches behind `runs`. false: some or all runs came from batches whose
   * failures were never recorded (the recorded reference dataset, or Lab runs from before stage 4).
   */
  failuresRecorded: boolean;
  /** Runs in `runs` that belong to no recorded batch. */
  runsWithoutBatch: number;
  /**
   * Status over `batches` and `failures` (src/lab/batchRecords.ts overallStatus): "complete",
   * "failed" (a mission failed), "incomplete" (a batch was stopped, ended by an error or
   * interrupted), or null when no batch was recorded.
   */
  batchStatus: "complete" | "failed" | "incomplete" | null;
}

/** Failure and batch records to export with runs; omit for data that has none (the recorded dataset). */
export interface BatchRecords {
  failures: LabFailure[];
  batches: LabBatch[];
  missingJobs: Array<PlannedJob & { batchId: string }>;
}

export function experimentToJson(runs: ExperimentExport["runs"], notes: string, version = "0.1.0", records?: BatchRecords): string {
  const runsWithoutBatch = records ? runs.filter((r) => !r.labBatchId).length : runs.length;
  const e: ExperimentExport = {
    schema: EXPERIMENT_SCHEMA,
    exportedAt: new Date().toISOString(),
    app: { name: "SureStop", version },
    layout: "v1",
    notes,
    runs,
    failures: records ? records.failures : null,
    batches: records ? records.batches : null,
    missingJobs: records ? records.missingJobs : null,
    failuresRecorded: !!records && runsWithoutBatch === 0,
    runsWithoutBatch,
    batchStatus: records ? overallStatus(records.batches, records.failures.length) : null,
  };
  return JSON.stringify(e);
}

/**
 * Reads a Lab export of either version. A version 1 file is returned as a version 2 one that says
 * nothing about failures (failures and batches null, failuresRecorded false): its runs are kept,
 * and the absence of failure records is not read as the absence of failures.
 */
export function readExperimentExport(data: unknown): ExperimentExport {
  const d = data as Partial<ExperimentExport> | Partial<ExperimentExportV1> | null;
  if (!d || typeof d !== "object" || !Array.isArray(d.runs)) throw new Error("not a SureStop experiment export (no runs)");
  if (d.schema === "surestop.experiment/1") {
    const v1 = d as ExperimentExportV1;
    return { ...v1, schema: EXPERIMENT_SCHEMA, failures: null, batches: null, missingJobs: null, failuresRecorded: false, runsWithoutBatch: v1.runs.length, batchStatus: null };
  }
  if (d.schema === EXPERIMENT_SCHEMA) {
    const v2 = d as ExperimentExport;
    if (v2.failures !== null && !Array.isArray(v2.failures)) throw new Error("malformed export: failures must be a list or null");
    if (v2.batches !== null && !Array.isArray(v2.batches)) throw new Error("malformed export: batches must be a list or null");
    if (v2.missingJobs !== null && !Array.isArray(v2.missingJobs)) throw new Error("malformed export: missingJobs must be a list or null");
    if (typeof v2.failuresRecorded !== "boolean") throw new Error("malformed export: failuresRecorded missing");
    return v2;
  }
  throw new Error(`unsupported export schema ${String(d.schema)}`);
}
