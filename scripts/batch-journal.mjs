// Durable batch checkpoints and batch completeness (stage 4). Used by scripts/missions.mjs,
// scripts/recover-batch.mjs, scripts/merge-batches.mjs, scripts/aggregate.ts and
// scripts/compare-runs.mjs; tested in tests/unit/batchJournal.test.ts.
//
// Journal (`<out>.journal.jsonl`, schema surestop.batch-journal/1): an append-only JSON-lines log
// written by missions.mjs while a batch runs. Every line is written with one write() and fsync()ed
// before the page is allowed to start the next mission, so a crash of the browser or of Node loses
// at most the mission in progress. Line types:
//   header   first line: schema, baseUrl, query, startedAt
//   plan     per session: the ordered planned jobs, layout and batch provenance (a resumed session
//            must plan the same jobs with compatible provenance)
//   run      one completed mission (the full RunRecord)
//   failure  one failed mission (a BatchFailure; never scored)
//   end      the session wrote the final batch file: status complete | failed
// A final line without a trailing newline was not completely written: it is reported as torn and
// ignored (that mission is simply not checkpointed). Any other malformed line makes the journal
// unreadable: it is refused, never repaired.
//
// Batch status (field `batchStatus` of a batch file):
//   complete    every planned job has a completed run (and there are no failures)
//   failed      every planned job ended, and at least one has a failure and no run
//   incomplete  some planned job has neither: written only by recover-batch.mjs, never final
// Files without `batchStatus` predate it: they are complete when they have no failures (D7 rule).
import fs from "node:fs";
import path from "node:path";
import { checkMergeCompatibility } from "./batch-compat.mjs";

export const JOURNAL_SCHEMA = "surestop.batch-journal/1";
export const BATCH_STATUSES = ["complete", "failed", "incomplete"];

export const jobKey = (j) => `${j.scenarioId}|${j.seed}|${j.variant}`;
export const runJobKey = (r) => `${r.result.scenarioId}|${r.result.seed}|${r.variant}`;
export const journalPathFor = (out) => `${out}.journal.jsonl`;

/** Append-only, fsync-per-line journal writer. */
export class JournalWriter {
  constructor(file, { create }) {
    if (create && fs.existsSync(file)) throw new Error(`journal ${file} already exists`);
    if (!create && !fs.existsSync(file)) throw new Error(`journal ${file} does not exist`);
    this.file = file;
    this.fd = fs.openSync(file, "a");
    if (create) fsyncDir(file);
  }
  append(entry) {
    const buf = Buffer.from(`${JSON.stringify(entry)}\n`, "utf8");
    let off = 0;
    while (off < buf.length) off += fs.writeSync(this.fd, buf, off, buf.length - off);
    fs.fsyncSync(this.fd);
  }
  close() {
    fs.closeSync(this.fd);
  }
}

function fsyncDir(file) {
  try {
    const fd = fs.openSync(path.dirname(path.resolve(file)), "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Some platforms cannot fsync a directory; the rename itself is still atomic.
  }
}

/** Writes `text` to `file` atomically: temporary file in the same directory, fsync, rename. */
export function writeFileAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  fsyncDir(file);
}

/** Compatibility of a new session's plan with the journal's first plan and its checkpointed runs. */
export function planCompatibility(first, next, runs) {
  const errors = [];
  if (JSON.stringify(first.jobs.map(jobKey)) !== JSON.stringify(next.jobs.map(jobKey))) errors.push("the planned jobs differ from the journal's");
  if (first.layout !== next.layout) errors.push(`the layout differs (${first.layout} vs ${next.layout})`);
  if (!!first.provenance !== !!next.provenance) errors.push("one session has batch provenance and the other does not");
  else if (first.provenance) {
    const c = checkMergeCompatibility([{ provenance: first.provenance, runs }, { provenance: next.provenance, runs: [] }], ["journal", "this session"]);
    errors.push(...c.errors);
  }
  return errors;
}

/**
 * Parses a journal. Returns { header, plan, sessions, runs, failures, end, tornTail, errors }:
 * runs and failures are Maps keyed by job key (a failure is kept only while its job has no run);
 * `errors` non-empty means the journal must not be used.
 */
export function parseJournal(text) {
  const out = { header: null, plan: null, sessions: 0, runs: new Map(), failures: new Map(), end: null, tornTail: false, lines: 0, errors: [] };
  const parts = text.split("\n");
  const tail = parts.pop();
  if (tail !== "") out.tornTail = true;
  parts.forEach((line, i) => {
    if (out.errors.length) return;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      out.errors.push(`line ${i + 1}: not valid JSON (corrupt journal)`);
      return;
    }
    out.lines++;
    if (i === 0) {
      if (e?.type !== "header" || e.schema !== JOURNAL_SCHEMA) out.errors.push(`line 1: not a ${JOURNAL_SCHEMA} header`);
      else out.header = e;
      return;
    }
    if (out.end) {
      out.errors.push(`line ${i + 1}: entry after the end of the batch`);
      return;
    }
    switch (e?.type) {
      case "plan": {
        if (!Array.isArray(e.jobs) || !e.jobs.length) {
          out.errors.push(`line ${i + 1}: plan without jobs`);
          return;
        }
        if (out.plan) {
          const errs = planCompatibility(out.plan, e, [...out.runs.values()]);
          if (errs.length) out.errors.push(`line ${i + 1}: resumed session is not compatible: ${errs.join("; ")}`);
        } else out.plan = e;
        out.sessions++;
        return;
      }
      case "run":
      case "failure": {
        if (!out.plan) {
          out.errors.push(`line ${i + 1}: ${e.type} before any plan`);
          return;
        }
        const key = e.type === "run" ? runJobKey(e.run) : jobKey(e.failure);
        if (!out.plan.jobs.some((j) => jobKey(j) === key)) out.errors.push(`line ${i + 1}: ${key} is not a planned job`);
        else if (out.runs.has(key)) out.errors.push(`line ${i + 1}: ${key} already has a completed run (duplicate)`);
        else if (e.type === "run") {
          out.runs.set(key, e.run);
          out.failures.delete(key);
        } else out.failures.set(key, e.failure);
        return;
      }
      case "end":
        if (!BATCH_STATUSES.includes(e.status) || e.status === "incomplete") out.errors.push(`line ${i + 1}: invalid end status ${e.status}`);
        else out.end = e;
        return;
      default:
        out.errors.push(`line ${i + 1}: unknown entry type ${String(e?.type)}`);
    }
  });
  if (!out.errors.length && !out.header) out.errors.push("empty journal");
  return out;
}

/** complete | failed | incomplete, from the planned jobs and the checkpointed runs and failures. */
export function deriveStatus(jobs, runs, failures) {
  const keys = jobs.map(jobKey);
  if (keys.every((k) => runs.has(k))) return "complete";
  if (keys.every((k) => runs.has(k) || failures.has(k))) return "failed";
  return "incomplete";
}

/** Planned jobs with neither a completed run nor a failure. */
export function missingJobs(jobs, runs, failures) {
  return jobs.filter((j) => !runs.has(jobKey(j)) && !failures.has(jobKey(j)));
}

/** Runs in planned-job order (deterministic regardless of completion order across sessions). */
export function orderedRuns(jobs, runs) {
  return jobs.map((j) => runs.get(jobKey(j))).filter(Boolean);
}

/**
 * Whether a batch file may be merged, aggregated or compared as a complete result.
 * { ok, status, reason }: status is the file's batchStatus, or the legacy reading of a file
 * without one.
 */
export function batchCompleteness(file) {
  if (file && file.schema === JOURNAL_SCHEMA) return { ok: false, status: "journal", reason: "this is a batch journal, not a batch file; run scripts/recover-batch.mjs or resume the batch" };
  const failures = Array.isArray(file?.failures) ? file.failures.length : 0;
  const missing = Array.isArray(file?.missingJobs) ? file.missingJobs.length : 0;
  // null: a Lab export (src/eval/export.ts) of runs with no recorded batch; read like a file written
  // before stage 4.
  if (file?.batchStatus === undefined || file?.batchStatus === null) {
    if (failures) return { ok: false, status: "failed (no batchStatus)", reason: `${failures} failed mission(s)` };
    return { ok: true, status: "complete (no batchStatus: written before stage 4)", reason: null };
  }
  if (!BATCH_STATUSES.includes(file.batchStatus)) return { ok: false, status: String(file.batchStatus), reason: `unknown batchStatus ${JSON.stringify(file.batchStatus)}` };
  if (file.batchStatus === "incomplete") return { ok: false, status: "incomplete", reason: `incomplete batch: ${missing} planned mission(s) never ran${failures ? `, ${failures} failed` : ""}` };
  if (file.batchStatus === "failed") return { ok: false, status: "failed", reason: `${failures} failed mission(s)` };
  if (failures || missing) return { ok: false, status: "complete", reason: `marked complete but lists ${failures} failure(s) and ${missing} missing job(s)` };
  return { ok: true, status: "complete", reason: null };
}
