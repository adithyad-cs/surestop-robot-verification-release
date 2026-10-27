// Build-time summary of the recorded held-out evaluation, for server components only (the
// landing and Method pages). It reads the committed compact summary file from disk, so no
// dataset is shipped to the browser, and recomputes metrics with the same missionMetrics()
// the Lab uses.
import fs from "node:fs";
import path from "node:path";
import type { TrialScore } from "./evaluate";
import { missionMetrics, type MissionMetrics } from "./metrics";

export const METHOD_ORDER = ["single-frame", "persistence", "surestop-1view", "surestop"] as const;
export const POST_HOC_SCENARIO = "photo-board-decoy";

interface SummaryRun {
  variant: string;
  score: TrialScore;
  result: { scenarioId: string; seed: number; config: { singleFrame: { threshold: number }; persistence: { threshold: number; requiredHits: number; window: number } } };
}

export interface RecordedRow {
  variant: string;
  label: string;
  all: MissionMetrics;
  original6: MissionMetrics;
  postHoc: MissionMetrics;
}

export interface RecordedSummary {
  generatedAt: string;
  trials: number;
  scenarios: number;
  seeds: string;
  rows: RecordedRow[];
}

let cache: RecordedSummary | null = null;

export function recordedSummary(): RecordedSummary {
  if (cache) return cache;
  const file = JSON.parse(fs.readFileSync(path.join(process.cwd(), "public/data/eval-summary.json"), "utf8")) as {
    generatedAt: string;
    runs: SummaryRun[];
  };
  const runs = file.runs;
  const seeds = [...new Set(runs.map((r) => r.result.seed))].sort((a, b) => a - b);
  const rows = METHOD_ORDER.map((variant) => {
    const rs = runs.filter((r) => r.variant === variant);
    const c = rs[0].result.config;
    const label =
      variant === "single-frame"
        ? `Single-frame, τ = ${c.singleFrame.threshold} (tuned)`
        : variant === "persistence"
          ? `Persistence, τ = ${c.persistence.threshold}, ${c.persistence.requiredHits} of ${c.persistence.window} (tuned)`
          : variant === "surestop-1view"
            ? "SureStop, one-view ablation"
            : "SureStop";
    return {
      variant,
      label,
      all: missionMetrics(rs.map((r) => r.score)),
      original6: missionMetrics(rs.filter((r) => r.result.scenarioId !== POST_HOC_SCENARIO).map((r) => r.score)),
      postHoc: missionMetrics(rs.filter((r) => r.result.scenarioId === POST_HOC_SCENARIO).map((r) => r.score)),
    };
  });
  cache = {
    generatedAt: file.generatedAt,
    trials: runs.length,
    scenarios: new Set(runs.map((r) => r.result.scenarioId)).size,
    seeds: `${seeds[0]}–${seeds[seeds.length - 1]}`,
    rows,
  };
  return cache;
}
