// Per-mission error isolation for batch runs. Kept free of rendering and TF.js so it can be
// unit-tested. A failed mission is recorded as a failure with its reason; it is never turned into
// a mission outcome (ARRIVED, NOT_FOUND, ...) and never stops the missions after it.
import type { RunProvenance } from "@/provenance/run";

export interface BatchFailure {
  scenarioId: string;
  seed: number;
  variant: string;
  /** World layout requested for the mission. */
  layout: string;
  /** The error that ended the mission ("Name: message"). */
  error: string;
  /** Stack trace of that error, when available. */
  stack?: string;
  /** Provenance of the failed mission (same block as a RunRecord's); absent in tests of runJobs alone. */
  provenance?: RunProvenance;
}

export interface JobCallbacks<J, R> {
  /** Called after each completed job; `done` counts completed and failed jobs. */
  onResult?: (result: R, done: number, total: number) => void | Promise<void>;
  onFailure?: (job: J, error: ErrorInfo, done: number, total: number) => void | Promise<void>;
  shouldStop?: () => boolean;
}

export interface ErrorInfo {
  error: string;
  stack?: string;
}

export function describeError(e: unknown): ErrorInfo {
  if (e instanceof Error) return { error: `${e.name}: ${e.message}`, ...(e.stack ? { stack: e.stack } : {}) };
  return { error: String(e) };
}

/**
 * Runs jobs one after another. A job that throws is recorded in `failures` and the next job runs;
 * results of jobs that completed are always returned. Errors thrown by the callbacks themselves
 * are not caught (they are caller bugs, not mission failures).
 */
export async function runJobs<J, R>(
  jobs: J[],
  run: (job: J) => Promise<R>,
  cb: JobCallbacks<J, R> = {},
): Promise<{ results: R[]; failures: Array<{ job: J; error: ErrorInfo }> }> {
  const results: R[] = [];
  const failures: Array<{ job: J; error: ErrorInfo }> = [];
  for (const job of jobs) {
    if (cb.shouldStop?.()) break;
    let result: R;
    try {
      result = await run(job);
    } catch (e) {
      const error = describeError(e);
      failures.push({ job, error });
      await cb.onFailure?.(job, error, results.length + failures.length, jobs.length);
      continue;
    }
    results.push(result);
    await cb.onResult?.(result, results.length + failures.length, jobs.length);
  }
  return { results, failures };
}
