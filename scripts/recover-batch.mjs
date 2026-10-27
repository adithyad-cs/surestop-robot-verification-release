// Turns a batch journal (written by scripts/missions.mjs) into a batch file for inspection after a
// crash. The result is always marked batchStatus "incomplete", even if every mission happens to be
// checkpointed: it lacks the final session's console errors and timing, and only
// `missions.mjs ... --resume` may finish a batch. merge-batches and aggregate refuse it;
// compare-runs reads it only with --allow-incomplete. The journal itself is not modified.
// Usage: node scripts/recover-batch.mjs <out.json.journal.jsonl> <recovered.json>
import fs from "node:fs";
import path from "node:path";
import { deriveStatus, jobKey, missingJobs, orderedRuns, parseJournal, writeFileAtomic } from "./batch-journal.mjs";

const [journalPath, out] = process.argv.slice(2);
if (!journalPath || !out) {
  console.error("usage: node scripts/recover-batch.mjs <out.json.journal.jsonl> <recovered.json>");
  process.exit(2);
}
if (path.resolve(out) === path.resolve(journalPath)) {
  console.error("refusing to overwrite the journal");
  process.exit(2);
}
const j = parseJournal(fs.readFileSync(journalPath, "utf8"));
if (j.errors.length) {
  console.error(`journal is not usable: ${j.errors.join("; ")}`);
  process.exit(2);
}
if (!j.plan) {
  console.error("journal has no plan: the batch never started a mission; nothing to recover");
  process.exit(2);
}
const jobs = j.plan.jobs;
const missing = missingJobs(jobs, j.runs, j.failures);
const recovered = {
  batchStatus: "incomplete",
  checkpointStatus: deriveStatus(jobs, j.runs, j.failures),
  recoveredFrom: path.basename(journalPath),
  journalEnded: j.end ? j.end.status : null,
  tornLastLine: j.tornTail,
  sessions: j.sessions,
  plannedJobs: jobs.length,
  missingJobs: missing,
  runs: orderedRuns(jobs, j.runs),
  failures: jobs.map((x) => j.failures.get(jobKey(x))).filter(Boolean),
  provenance: j.plan.provenance ?? undefined,
  backend: j.plan.backend ?? null,
  detector: j.plan.detector ?? null,
};
writeFileAtomic(out, JSON.stringify(recovered));
console.log(`wrote ${out}: batchStatus incomplete; ${recovered.runs.length} completed, ${recovered.failures.length} failed, ${missing.length} not run, of ${jobs.length} planned${j.tornTail ? "; an incomplete last journal line was ignored" : ""}`);
if (!j.end) console.log(`finish the batch: node scripts/missions.mjs ${j.header.baseUrl} "${j.header.query}" ${j.header.out ?? "<out.json>"} --resume`);
