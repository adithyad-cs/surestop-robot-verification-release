// Turns raw batch output (scripts/missions.mjs) into the Lab's data files.
//   calibration: node .cache/aggregate.mjs calibration <in.json> public/data/calibration.json
//   evaluation:  node .cache/aggregate.mjs evaluation <in.json> public/data/eval-runs.json
// The threshold-selection rule below was fixed before the calibration results were inspected.
import fs from "node:fs";
import { groupBy, METRIC_DEFINITIONS, missionMetrics, type Rate } from "@/eval/metrics";
import { CORRECTION_LABEL, PROTOCOL_CORRECTIONS, RESULT_NOTES } from "@/eval/protocolNotes";
import type { BatchProvenance, RunRecord } from "@/experiments/engine";
import { batchCompleteness } from "./batch-journal.mjs";

interface BatchFile {
  runs: RunRecord[];
  parallelProcesses?: number;
  backend: { backend: string; reason: string; glRenderer: string | null };
  detector: { name: string; packageVersion: string; tfjsVersion: string; base: string; backend: string };
  wallMs: number;
  /** Batch provenance (P1). Absent on pre-P1 batches. */
  provenance?: BatchProvenance;
  /** Missions that threw (scripts/missions.mjs). Absent on batches written before D7. */
  failures?: Array<{ scenarioId: string; seed: number; variant: string; error: string }>;
  /** Stage 4: complete | failed | incomplete (scripts/batch-journal.mjs). Absent on older batches. */
  batchStatus?: string;
}

export const SELECTION_RULE =
  "For each baseline, choose the threshold τ with the highest completion rate over all calibration scenarios and seeds; ties go to the lower false-arrival rate, then to the lower τ.";

const [mode, input, output] = process.argv.slice(2);
if (!mode || !input || !output) {
  console.error("usage: aggregate <calibration|evaluation> <in.json> <out.json>");
  process.exit(2);
}
let batch: BatchFile;
try {
  batch = JSON.parse(fs.readFileSync(input, "utf8")) as BatchFile;
} catch (e) {
  console.error(`refusing to aggregate: ${input} is not a JSON batch file (${e instanceof Error ? e.message : String(e)}). A *.journal.jsonl is a checkpoint journal: finish it with missions.mjs --resume.`);
  process.exit(1);
}
// A failed mission has no outcome. Aggregating the rest would silently shrink every denominator,
// so a batch with failures is refused, as scripts/merge-batches.mjs does. Batches written before
// failures were recorded have no `failures` field and are read as before.
if ((mode === "calibration" || mode === "evaluation") && batch.failures?.length) {
  const list = batch.failures.map((f) => `${f.scenarioId} seed ${f.seed} ${f.variant}: ${f.error}`).join("\n");
  console.error(`refusing to aggregate: the batch contains ${batch.failures.length} failed mission(s); re-run them first:\n${list}`);
  process.exit(1);
}
if (mode === "calibration" || mode === "evaluation") {
  const c = batchCompleteness(batch);
  if (!c.ok) {
    console.error(`refusing to aggregate: the batch is not complete (${c.reason})`);
    process.exit(1);
  }
}
// The calibration and evaluation protocols are defined on the v1 (recorded) layout. Runs on any
// other layout carry a `layout` field and are refused rather than pooled into these datasets.
const nonV1 = batch.runs.filter((r) => r.layout && r.layout.version !== "v1");
if (nonV1.length) {
  console.error(`refusing to aggregate: ${nonV1.length} of ${batch.runs.length} runs are not on the v1 layout (e.g. ${nonV1[0].layout!.id}). Layout v2 results are not part of the recorded protocol.`);
  process.exit(1);
}

if (mode === "calibration") {
  const rows = [...groupBy(batch.runs, (r) => r.variant).entries()]
    .map(([variant, rs]) => {
      const m = missionMetrics(rs.map((r) => r.score));
      return { variant, trials: m.trials, completion: m.completionRate, far: m.falseArrivalRate, ccr: m.correctConfirmationRate, abstention: m.abstentionRate };
    })
    .sort((a, b) => a.variant.localeCompare(b.variant, undefined, { numeric: true }));
  const selected: Record<string, number> = {};
  for (const method of ["single-frame", "persistence"]) {
    const cands = rows
      .filter((r) => r.variant.startsWith(`${method}@`))
      .map((r) => ({ ...r, tau: Number(r.variant.split("@")[1]) }))
      .sort((a, b) => (b.completion.value ?? 0) - (a.completion.value ?? 0) || (a.far.value ?? 0) - (b.far.value ?? 0) || a.tau - b.tau);
    if (cands.length) selected[method] = cands[0].tau;
  }
  const seeds = [...new Set(batch.runs.map((r) => r.result.seed))].sort((a, b) => a - b);
  const out = { generatedAt: new Date().toISOString(), seeds, rule: SELECTION_RULE, selected, detector: batch.detector, backend: batch.backend.backend, rows };
  fs.writeFileSync(output, JSON.stringify(out, null, 1));
  console.log("selected thresholds:", selected);
  for (const r of rows)
    console.log(
      `${r.variant.padEnd(22)} n=${r.trials}  completion ${r.completion.num}/${r.completion.den}  FAR ${r.far.num}/${r.far.den}  CCR ${r.ccr.num}/${r.ccr.den}  abst ${r.abstention.num}/${r.abstention.den}`,
    );
} else if (mode === "evaluation") {
  const seeds = [...new Set(batch.runs.map((r) => r.result.seed))].sort((a, b) => a - b);
  const out = {
    schema: "surestop.recorded/1",
    generatedAt: new Date().toISOString(),
    environment: {
      detector: `${batch.detector.name} ${batch.detector.packageVersion} (${batch.detector.base}), tfjs ${batch.detector.tfjsVersion}`,
      backend: `${batch.detector.backend} (${batch.backend.reason})`,
      gl: batch.backend.glRenderer ?? "n/a",
      // Only values measured in the page are reported; a pre-P1 batch measured neither.
      browser: batch.provenance?.runtime.userAgent ?? "not measured (batch has no provenance)",
      machine:
        batch.provenance?.runtime.hardwareConcurrency != null
          ? `${batch.provenance.runtime.hardwareConcurrency} logical cores (navigator.hardwareConcurrency)`
          : "not measured (batch has no provenance)",
      wallClock: `${(batch.wallMs / 60000).toFixed(1)} min for ${batch.runs.length} missions (${batch.parallelProcesses ?? 1} parallel browser process${(batch.parallelProcesses ?? 1) > 1 ? "es" : ""})`,
    },
    protocol: {
      seeds: `${seeds[0]}–${seeds[seeds.length - 1]} (${seeds.length} held-out seeds, disjoint from calibration seeds)`,
      scenarios: [...new Set(batch.runs.map((r) => r.result.scenarioId))].join(", "),
      methods: [...new Set(batch.runs.map((r) => r.variant))].join(", "),
      unit: "one seeded mission = one trial",
      thresholds: "baseline τ selected on calibration seeds (see calibration table); SureStop thresholds fixed from Phase A renders",
    },
    ...(batch.provenance ? { provenance: batch.provenance } : {}),
    runs: batch.runs,
  };
  fs.writeFileSync(output, JSON.stringify(out));
  // Compact companion loaded by the Lab first; full runs are fetched on demand.
  const summaryPath = output.replace(/eval-runs\.json$/, "eval-summary.json");
  const summary = {
    ...out,
    schema: "surestop.recorded-summary/1",
    fullDataset: "/data/eval-runs.json",
    runs: batch.runs.map((r) => ({
      variant: r.variant,
      score: r.score,
      result: {
        scenarioId: r.result.scenarioId,
        seed: r.result.seed,
        method: r.result.method,
        outcome: r.result.outcome,
        reason: r.result.reason,
        confirmedTrackId: r.result.confirmedTrackId,
        stats: r.result.stats,
        config: { singleFrame: r.result.config.singleFrame, persistence: r.result.config.persistence },
      },
    })),
  };
  if (summaryPath !== output) fs.writeFileSync(summaryPath, JSON.stringify(summary));
  const byV = groupBy(batch.runs, (r) => r.variant);
  for (const [v, rs] of byV) {
    const m = missionMetrics(rs.map((r) => r.score));
    console.log(
      `${v.padEnd(22)} n=${m.trials}  FAR ${m.falseArrivalRate.num}/${m.falseArrivalRate.den}  CCR ${m.correctConfirmationRate.num}/${m.correctConfirmationRate.den}  abst ${m.abstentionRate.num}/${m.abstentionRate.den}  completion ${m.completionRate.num}/${m.completionRate.den}  frames ${m.meanFrames.toFixed(1)}  path ${m.meanPathLength.toFixed(1)}`,
    );
  }
} else if (mode === "report") {
  // Inputs: <eval-runs.json (recorded file)> <out.md>; reads public/data/calibration.json too.
  const rec = JSON.parse(fs.readFileSync(input, "utf8")) as { generatedAt: string; environment: Record<string, string>; protocol: Record<string, string>; runs: RunRecord[] };
  const cal = JSON.parse(fs.readFileSync("public/data/calibration.json", "utf8")) as {
    seeds: number[];
    rule: string;
    selected: Record<string, number>;
    rows: Array<{ variant: string; trials: number; completion: Rate; far: Rate; ccr: Rate; abstention: Rate }>;
  };
  const f = (r: Rate) => (r.value === null ? "—" : `${(r.value * 100).toFixed(0)}% (${r.num}/${r.den})`);
  const ci = (r: Rate) => (r.ci95 ? `${(r.ci95[0] * 100).toFixed(0)}–${(r.ci95[1] * 100).toFixed(0)}%` : "—");
  const order = ["single-frame", "persistence", "surestop-1view", "surestop"];
  const label = (v: string, rs: RunRecord[]) => {
    const c = rs[0].result.config;
    if (v === "single-frame") return `Single-frame (τ=${c.singleFrame.threshold})`;
    if (v === "persistence") return `Persistence (τ=${c.persistence.threshold}, ${c.persistence.requiredHits} of ${c.persistence.window})`;
    if (v === "surestop") return "SureStop";
    if (v === "surestop-1view") return "SureStop 1-view ablation";
    return v;
  };
  const table = (runs: RunRecord[]) => {
    const g = groupBy(runs, (r) => r.variant);
    const lines = [
      "| Method | Trials | False-arrival rate ↓ | 95% CI | Correct confirmation ↑ | Abstention | Completion ↑ | 95% CI | Frames | Path (m) |",
      "|---|---|---|---|---|---|---|---|---|---|",
    ];
    for (const v of order) {
      const rs = g.get(v);
      if (!rs) continue;
      const m = missionMetrics(rs.map((r) => r.score));
      lines.push(
        `| ${label(v, rs)} | ${m.trials} | ${f(m.falseArrivalRate)} | ${ci(m.falseArrivalRate)} | ${f(m.correctConfirmationRate)} | ${f(m.abstentionRate)} | ${f(m.completionRate)} | ${ci(m.completionRate)} | ${m.meanFrames.toFixed(1)} | ${m.meanPathLength.toFixed(1)} |`,
      );
    }
    return lines.join("\n");
  };
  const scenarios = [...new Set(rec.runs.map((r) => r.result.scenarioId))];
  const perScenario = scenarios
    .map((sc) => {
      const g = groupBy(
        rec.runs.filter((r) => r.result.scenarioId === sc),
        (r) => r.variant,
      );
      const cells = order.map((v) => {
        const rs = g.get(v) ?? [];
        const ok = rs.filter((r) => r.score.correctTerminal).length;
        const fa = rs.filter((r) => r.score.falseArrival).length;
        const ab = rs.filter((r) => r.score.abstained).length;
        return `${ok}/${rs.length} ok · ${fa} FA · ${ab} abst`;
      });
      return `| \`${sc}\` | ${cells.join(" | ")} |`;
    })
    .join("\n");
  const calRows = cal.rows
    .map((r) => `| ${r.variant} | ${r.trials} | ${f(r.completion)} | ${f(r.far)} | ${f(r.ccr)} | ${f(r.abstention)} |`)
    .join("\n");
  const md = `# Results (generated)

Generated by \`npm run aggregate -- report\` from \`public/data/eval-runs.json\` (recorded ${rec.generatedAt}) and \`public/data/calibration.json\`.
Do not edit by hand. All numbers come from recorded missions with real rendering and real COCO-SSD inference; ground truth is used only by the evaluator.

**Environment:** ${Object.entries(rec.environment).map(([k, v]) => `${k}: ${v}`).join("; ")}.
**Protocol (as recorded):** ${Object.entries(rec.protocol).map(([k, v]) => `${k}: ${v}`).join("; ")}.
${Object.entries(PROTOCOL_CORRECTIONS)
  .filter(([k]) => k in rec.protocol)
  .map(([k, v]) => `\n> **${CORRECTION_LABEL} to \`${k}\`:** ${v}`)
  .join("\n")}

Small samples (20 trials per scenario and method): treat differences as preliminary; intervals are 95% Wilson.

## All seven scenarios (held-out seeds)

${table(rec.runs)}

## Original six scenarios (excluding the post-hoc \`photo-board-decoy\`)

${table(rec.runs.filter((r) => r.result.scenarioId !== "photo-board-decoy"))}

## Per scenario (correct terminal outcome · false arrivals · abstentions)

| Scenario | ${order.join(" | ")} |
|---|${order.map(() => "---").join("|")}|
${perScenario}

## Baseline threshold calibration (seeds ${cal.seeds[0]}–${cal.seeds[cal.seeds.length - 1]})

${cal.rule} Selected: ${Object.entries(cal.selected).map(([k, v]) => `${k} τ=${v}`).join(", ")}.

| Variant | Trials | Completion | False-arrival rate | Correct confirmation | Abstention |
|---|---|---|---|---|---|
${calRows}

## Notes and disclosures

${RESULT_NOTES.map((n) => `- ${n}`).join("\n")}

Raw calibration records (both runs, byte-exact) and their checksums: \`docs/experiments/raw/MANIFEST.md\`.

## Metric definitions

${Object.entries(METRIC_DEFINITIONS).map(([k, v]) => `- **${k}**: ${v}`).join("\n")}
`;
  fs.writeFileSync(output, md);
  console.log(`wrote ${output}`);
} else {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}
