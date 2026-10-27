export declare const JOURNAL_SCHEMA: "surestop.batch-journal/1";
export declare const BATCH_STATUSES: Array<"complete" | "failed" | "incomplete">;

export interface Job {
  scenarioId: string;
  seed: number;
  variant: string;
}

export declare function jobKey(j: Job): string;
export declare function runJobKey(r: { result: { scenarioId: string; seed: number }; variant: string }): string;
export declare function journalPathFor(out: string): string;

export declare class JournalWriter {
  constructor(file: string, opts: { create: boolean });
  readonly file: string;
  append(entry: object): void;
  close(): void;
}

export declare function writeFileAtomic(file: string, text: string): void;

export interface PlanEntry {
  type: "plan";
  jobs: Job[];
  layout: string;
  provenance?: unknown;
  [k: string]: unknown;
}

export declare function planCompatibility(first: PlanEntry, next: PlanEntry, runs: object[]): string[];

export interface RunLike {
  variant: string;
  result: { scenarioId: string; seed: number; [k: string]: unknown };
  [k: string]: unknown;
}

export interface FailureLike extends Job {
  error: string;
  [k: string]: unknown;
}

export interface ParsedJournal {
  header: { type: "header"; schema: string; [k: string]: unknown } | null;
  plan: PlanEntry | null;
  sessions: number;
  runs: Map<string, RunLike>;
  failures: Map<string, FailureLike>;
  end: { type: "end"; status: "complete" | "failed"; [k: string]: unknown } | null;
  tornTail: boolean;
  lines: number;
  errors: string[];
}

export declare function parseJournal(text: string): ParsedJournal;
export declare function deriveStatus(jobs: Job[], runs: Map<string, unknown>, failures: Map<string, unknown>): "complete" | "failed" | "incomplete";
export declare function missingJobs(jobs: Job[], runs: Map<string, unknown>, failures: Map<string, unknown>): Job[];
export declare function orderedRuns<R>(jobs: Job[], runs: Map<string, R>): R[];
export declare function batchCompleteness(file: unknown): { ok: boolean; status: string; reason: string | null };
