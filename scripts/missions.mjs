// Runs /diagnostics/mission headlessly and writes the full results.
// Needs a build with SURESTOP_DIAGNOSTICS=1 (npm run build:diagnostics) or `next dev`.
// Usage: node scripts/missions.mjs <baseUrl> "<query>" <out.json> [--resume]
// Browser: Playwright's pinned Chromium. SURESTOP_CHROMIUM=<executable> runs another Chromium
// instead (e.g. where the pinned one cannot be installed); the browser actually used is printed and
// recorded in the batch provenance (runtime.userAgent), so such a run is never mistaken for one on
// the pinned browser.
//
// Checkpoints (stage 4; format and rules in scripts/batch-journal.mjs): every completed mission and
// every failure is appended to <out>.journal.jsonl and fsync()ed before the page starts the next
// mission. If the browser or this process dies, the checkpointed missions survive in the journal:
//   node scripts/recover-batch.mjs <out>.journal.jsonl <partial.json>   inspect them (incomplete)
//   node scripts/missions.mjs <baseUrl> "<same query>" <out.json> --resume
//                                                    run only the missions not yet completed
// A resumed session must plan the same jobs with a compatible build, runtime and protocol; failed
// and missing missions are run again, completed ones never. The final <out.json> is written
// atomically and only when every planned mission has ended: batchStatus "complete" (exit 0) or
// "failed" (exit 3). An existing journal is never overwritten: without --resume the command refuses.
// Exit codes: 0 complete; 3 complete with failed missions; 1 page error, browser crash or journal
// inconsistency (checkpointed missions kept); 2 setup refused (no diagnostics route, journal state).
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { JOURNAL_SCHEMA, JournalWriter, deriveStatus, jobKey, journalPathFor, missingJobs, orderedRuns, parseJournal, planCompatibility, runJobKey, writeFileAtomic } from "./batch-journal.mjs";

const argv = process.argv.slice(2);
const resume = argv.includes("--resume");
const [baseUrl = "http://localhost:3100", query = "run=1", out = "missions-out.json"] = argv.filter((a) => a !== "--resume");
const journalPath = journalPathFor(out);
const refuse = (msg) => {
  console.error(msg);
  process.exit(2);
};

// ---- journal state before the browser starts
let prior = null;
if (resume) {
  if (!fs.existsSync(journalPath)) refuse(`--resume: no journal at ${journalPath}`);
  let text = fs.readFileSync(journalPath, "utf8");
  prior = parseJournal(text);
  if (prior.errors.length) refuse(`--resume: journal ${journalPath} is not usable: ${prior.errors.join("; ")}`);
  if (prior.end) refuse(`--resume: the batch already ended (${prior.end.status}); its final file is ${prior.end.final}`);
  if (prior.header.query !== query) refuse(`--resume: the query differs from the journal's (${prior.header.query})`);
  if (prior.tornTail) {
    // The last line was never completely written (the process died mid-write). It was not a
    // checkpoint; cut it so that appended lines stay well-formed. Its mission will run again.
    const keep = text.lastIndexOf("\n") + 1;
    fs.truncateSync(journalPath, Buffer.byteLength(text.slice(0, keep), "utf8"));
    console.warn(`--resume: removed an incomplete last journal line (${Buffer.byteLength(text.slice(keep), "utf8")} bytes)`);
    text = text.slice(0, keep);
  }
  console.log(`resuming ${journalPath}: ${prior.runs.size} completed, ${prior.failures.size} failed (will run again), ${prior.plan ? missingJobs(prior.plan.jobs, prior.runs, prior.failures).length : "?"} not yet run`);
} else if (fs.existsSync(journalPath)) {
  refuse(`a batch journal already exists at ${journalPath}. Resume it with --resume, inspect it with scripts/recover-batch.mjs, or move it away first.`);
}
const journal = new JournalWriter(journalPath, { create: !resume });
if (!resume) journal.append({ type: "header", schema: JOURNAL_SCHEMA, baseUrl, query, out: path.basename(out), startedAt: new Date().toISOString() });

let plan = prior?.plan ?? null;
const runs = new Map(prior?.runs ?? []);
const failures = new Map(prior?.failures ?? []);
let planned = false;

const executablePath = process.env.SURESTOP_CHROMIUM || undefined;
const browser = await chromium.launch({ executablePath, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
console.log(`browser: Chromium ${browser.version()}${executablePath ? ` from SURESTOP_CHROMIUM=${executablePath} (not the pinned browser)` : " (Playwright pinned)"}`);
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

// Called by the page after each mission; resolves only after the journal line is on disk.
await page.exposeFunction("__surestopCheckpoint", async (entry) => {
  if (entry?.type === "plan") {
    if (planned) throw new Error("a second plan in one session");
    if (plan) {
      const errs = planCompatibility(plan, entry, [...runs.values()]);
      if (errs.length) return { error: errs.join("; ") };
    } else plan = entry;
    journal.append({ type: "plan", jobs: entry.jobs, layout: entry.layout, provenance: entry.provenance ?? null, backend: entry.backend ?? null, detector: entry.detector ?? null, at: new Date().toISOString() });
    planned = true;
    return { skip: [...runs.keys()] };
  }
  if (!planned) throw new Error(`checkpoint ${entry?.type} before the plan`);
  if (entry.type === "run") {
    const key = runJobKey(entry.run);
    if (runs.has(key)) throw new Error(`duplicate completed run ${key}`);
    journal.append({ type: "run", run: entry.run });
    runs.set(key, entry.run);
    failures.delete(key);
    return null;
  }
  if (entry.type === "failure") {
    const key = jobKey(entry.failure);
    if (runs.has(key)) throw new Error(`failure for already completed run ${key}`);
    journal.append({ type: "failure", failure: entry.failure });
    failures.set(key, entry.failure);
    return null;
  }
  throw new Error(`unknown checkpoint entry ${entry?.type}`);
});

const t0 = Date.now();
const abandon = async (msg) => {
  console.error(msg);
  console.error(`checkpointed in ${journalPath}: ${runs.size} completed, ${failures.size} failed. Inspect with scripts/recover-batch.mjs; finish with --resume.`);
  journal.close();
  await browser.close().catch(() => {});
  process.exit(1);
};

let data;
try {
  const resp = await page.goto(`${baseUrl}/diagnostics/mission?${query}`);
  if (!resp || resp.status() === 404) {
    console.error("/diagnostics/mission is not available on this server. Build with SURESTOP_DIAGNOSTICS=1 (npm run build:diagnostics) or use next dev.");
    journal.close();
    if (!resume && runs.size === 0 && failures.size === 0) fs.rmSync(journalPath); // nothing was checkpointed
    await browser.close();
    process.exit(2);
  }
  let seen = 0;
  for (;;) {
    const done = await page.evaluate(() => !!window.__SURESTOP_MISSIONS__);
    const lines = (await page.textContent('[data-testid="log"]').catch(() => "")).split("\n").filter(Boolean);
    for (const l of lines.slice(seen)) console.log(l);
    seen = lines.length;
    if (done) break;
    await page.waitForTimeout(1000);
    if (Date.now() - t0 > 6 * 3600 * 1000) throw new Error("timeout");
  }
  data = await page.evaluate(() => window.__SURESTOP_MISSIONS__);
} catch (e) {
  await abandon(`batch interrupted (browser or page failed): ${e instanceof Error ? e.message : String(e)}`);
}
await browser.close();
if (data.error) await abandon(data.error);

// The page's own result must agree with the journal: every mission it reports is checkpointed.
const unjournaled = [...data.runs.map(runJobKey), ...(data.failures ?? []).map(jobKey)].filter((k) => !runs.has(k) && !failures.has(k));
if (unjournaled.length || !plan) await abandon(`journal inconsistency: ${unjournaled.length} mission(s) reported by the page are not in the journal`);
const status = deriveStatus(plan.jobs, runs, failures);
if (status === "incomplete") {
  await abandon(`the page finished but ${missingJobs(plan.jobs, runs, failures).length} planned mission(s) never ran; not writing ${out}`);
}
const finalFailures = plan.jobs.map((j) => failures.get(jobKey(j))).filter(Boolean);
const final = {
  ...data,
  runs: orderedRuns(plan.jobs, runs),
  failures: finalFailures,
  consoleErrors: errors,
  batchStatus: status,
  journal: path.basename(journalPath),
  // wallMs covers this session only; sessions > 1 means the batch was resumed.
  sessions: (prior?.sessions ?? 0) + 1,
};
writeFileAtomic(out, JSON.stringify(final));
journal.append({ type: "end", status, final: path.basename(out), at: new Date().toISOString() });
journal.close();
console.log(`wrote ${out}: ${final.runs.length} runs in ${((Date.now() - t0) / 1000).toFixed(0)} s; console errors: ${errors.length}; failed missions: ${finalFailures.length}; batchStatus: ${status}${final.sessions > 1 ? `; sessions: ${final.sessions}` : ""}`);
if (finalFailures.length) {
  // The completed runs are kept in the file; a failed mission has no outcome and is never scored.
  for (const f of finalFailures) console.error(`FAILED ${f.scenarioId} seed ${f.seed} ${f.variant}: ${f.error}`);
  process.exit(3);
}
