"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "@/components/AppHeader";
import StatusBadge from "@/components/StatusBadge";
import ViewpointRose from "@/components/ViewpointRose";
import { SCENARIOS } from "@/scenarios/layout";
import { candidateMetrics, groupBy, METRIC_DEFINITIONS, missionMetrics, type Rate } from "@/eval/metrics";
import { experimentToJson, trialsToCsv } from "@/eval/export";
import { CORRECTION_LABEL, PROTOCOL_CORRECTIONS } from "@/eval/protocolNotes";
import type { RunRecord } from "@/experiments/engine";
import type { MissionResult } from "@/mission/types";
import { clearRuns, loadBatches, loadFailures, loadRuns, saveBatch, saveFailure, saveRun, type StoredRun } from "@/lib/runStore";
import { batchMissingJobs, describeBatch, effectiveBatch, finishBatch, newBatch, overallStatus, type LabBatch, type LabFailure } from "./batchRecords";
import { METHOD_LABELS, type MethodId } from "@/policies/types";
import styles from "./LabApp.module.css";

/** A run as listed in the Lab: full (browser runs, or fetched) or summary-only (recorded list). */
interface LabRun {
  variant: string;
  score: RunRecord["score"];
  result: Pick<MissionResult, "scenarioId" | "seed" | "method" | "outcome" | "reason" | "stats" | "confirmedTrackId"> & {
    config: Pick<MissionResult["config"], "singleFrame" | "persistence">;
  } & Partial<MissionResult>;
}

interface RecordedFile {
  schema: string;
  generatedAt: string;
  environment: Record<string, string>;
  protocol: Record<string, unknown>;
  fullDataset?: string;
  runs: LabRun[];
}

const runKey = (r: LabRun) => `${r.result.scenarioId}|${r.result.seed}|${r.variant}`;

let fullRecorded: Promise<Map<string, RunRecord>> | null = null;
/** Fetches the full recorded dataset (frames, evidence, events) once, on demand. */
function loadFullRecorded(url = "/data/eval-runs.json"): Promise<Map<string, RunRecord>> {
  if (!fullRecorded) {
    fullRecorded = fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { runs: RunRecord[] }) => new Map(d.runs.map((r) => [runKey(r), r])));
    fullRecorded.catch(() => (fullRecorded = null));
  }
  return fullRecorded;
}

function isFull(r: LabRun): r is RunRecord {
  return Array.isArray(r.result.tracks) && Array.isArray(r.result.events);
}

type Source = "recorded" | "local";

/** Added after calibration v1 (see Method); results are also shown without it. */
const POST_HOC_SCENARIO = "photo-board-decoy";

const RUNNABLE: Array<{ spec: string; label: string }> = [
  { spec: "surestop", label: METHOD_LABELS.surestop },
  { spec: "single-frame", label: METHOD_LABELS["single-frame"] },
  { spec: "persistence", label: METHOD_LABELS.persistence },
  { spec: "surestop-1view", label: METHOD_LABELS["surestop-1view"] },
  { spec: "surestop-identity", label: METHOD_LABELS["surestop-identity"] },
];

function pct(r: Rate): string {
  return r.value === null ? "—" : `${(r.value * 100).toFixed(0)}%`;
}

function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function LabApp() {
  const [recorded, setRecorded] = useState<RecordedFile | null>(null);
  const [recordedError, setRecordedError] = useState<string | null>(null);
  const [local, setLocal] = useState<StoredRun[]>([]);
  const [localFailures, setLocalFailures] = useState<LabFailure[]>([]);
  const [storedBatches, setStoredBatches] = useState<LabBatch[]>([]);
  const [runningBatchId, setRunningBatchId] = useState<string | null>(null);
  const [source, setSource] = useState<Source>("recorded");
  const [scenario, setScenario] = useState<string>("all");
  const [selected, setSelected] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetch("/data/eval-summary.json")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: RecordedFile) => setRecorded(d))
      .catch((e) => setRecordedError(String(e)));
    void loadRuns().then(setLocal);
    void loadFailures().then(setLocalFailures);
    void loadBatches().then(setStoredBatches);
  }, []);

  // A stored batch still "active" that is not running in this page was cut off (reload, closed tab).
  const batches = useMemo(
    () => storedBatches.map((b) => effectiveBatch(b, runningBatchId)).sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    [storedBatches, runningBatchId],
  );
  const putBatch = useCallback((b: LabBatch) => setStoredBatches((l) => [...l.filter((x) => x.batchId !== b.batchId), b]), []);

  const runs = useMemo<LabRun[]>(() => {
    const rs: LabRun[] = source === "recorded" ? recorded?.runs ?? [] : local;
    rememberThresholds(rs);
    return rs;
  }, [source, recorded, local]);
  const inFilter = useCallback(
    (scenarioId: string) => (scenario === "all" ? true : scenario === "original" ? scenarioId !== POST_HOC_SCENARIO : scenarioId === scenario),
    [scenario],
  );
  const filtered = useMemo(() => runs.filter((r) => inFilter(r.result.scenarioId)), [runs, inFilter]);
  // Failure and batch records exist only for runs in this browser; the recorded dataset has none.
  const filteredFailures = useMemo(() => (source === "local" ? localFailures.filter((f) => inFilter(f.scenarioId)) : []), [source, localFailures, inFilter]);
  const filteredBatches = useMemo(() => (source === "local" ? batches.filter((b) => b.spec.scenarios.some(inFilter)) : []), [source, batches, inFilter]);
  const hasLocalRecords = source === "local" && (filteredFailures.length > 0 || filteredBatches.length > 0);

  return (
    <>
      <AppHeader />
      <main className={styles.page}>
        <header className={styles.intro}>
          <h1>Verification Lab</h1>
          <p>
            Every number below is computed in your browser from recorded mission runs (real rendering + real COCO-SSD inference, ground truth used only by the
            evaluator). Re-run any seed here or in Mission Control (world layout v1) to reproduce it.
          </p>
        </header>

        <div className={styles.toolbar}>
          <div className={styles.tabs} role="tablist" aria-label="Dataset">
            <button role="tab" aria-selected={source === "recorded"} className={styles.tab} onClick={() => { setSource("recorded"); setSelected(null); }}>
              Recorded reference runs {recorded ? `(${recorded.runs.length})` : ""}
            </button>
            <button role="tab" aria-selected={source === "local"} className={styles.tab} onClick={() => { setSource("local"); setSelected(null); }}>
              Runs in this browser ({local.length})
            </button>
          </div>
          <div className="field">
            <span className="label" id="set-label">
              Scenario set
            </span>
            <div className={styles.tabs} role="radiogroup" aria-labelledby="set-label">
              {[
                ["all", "All 7"],
                ["original", "Original 6"],
                [POST_HOC_SCENARIO, "Photo board only"],
              ].map(([v, l]) => (
                <button key={v} role="radio" aria-checked={scenario === v} className={styles.tab} onClick={() => { setScenario(v); setSelected(null); }}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="scen-filter">Or one scenario</label>
            <select id="scen-filter" className="select" value={scenario} onChange={(e) => { setScenario(e.target.value); setSelected(null); }}>
              <option value="all">All scenarios</option>
              <option value="original">Original six (excl. post-hoc photo board)</option>
              {SCENARIOS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </div>
          <div className={styles.exports}>
            <button className="btn" disabled={!filtered.length} onClick={() => download(`surestop-trials-${source}-${scenario}.csv`, trialsToCsv(filtered.map((r) => r.score)), "text/csv")}>
              Export CSV
            </button>
            <button
              className="btn"
              disabled={(!filtered.length && !hasLocalRecords) || exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  let full: RunRecord[];
                  if (source === "recorded") {
                    const all = await loadFullRecorded(recorded?.fullDataset);
                    full = filtered.map((r) => all.get(runKey(r))).filter((r): r is RunRecord => !!r);
                  } else full = filtered.filter(isFull);
                  // Missing missions are found against every stored run and failure, then filtered like them.
                  const missingJobs = batchMissingJobs(filteredBatches, local, localFailures).filter((j) => inFilter(j.scenarioId));
                  const records = source === "local" ? { failures: filteredFailures, batches: filteredBatches, missingJobs } : undefined;
                  download(`surestop-runs-${source}-${scenario}.json`, experimentToJson(full, `${source} dataset, scenario filter: ${scenario}`, undefined, records), "application/json");
                } catch (e) {
                  window.alert(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
                } finally {
                  setExporting(false);
                }
              }}
            >
              {exporting ? "Preparing JSON…" : "Export JSON"}
            </button>
          </div>
        </div>

        {source === "recorded" && recorded && <Provenance file={recorded} />}
        {source === "recorded" && recorded && (
          <aside className={styles.reading} aria-label="How to read these results">
            <h2>Reading these results</h2>
            <ul>
              <li>
                On the six original scenarios, the single-frame baseline with a threshold tuned on calibration seeds also avoids false arrivals; there SureStop
                differs mainly in cost (longer paths, more frames).
              </li>
              <li>
                The false-arrival gap comes from the life-size photo board, a scenario we added after the first calibration run showed that, seen from the
                search route, our original decoys scored below the target (closer views score higher). Its flat-surface evidence is independent of the
                detector score; its prevalence in real buildings is not something this simulation can tell you. Use “Scenario set” to compare with and without
                it.
              </li>
              <li>
                The vase look-alike is not rejected by depth (it is volumetric). SureStop left it UNCONFIRMED because the detector did not label it consistently
                from two distinct viewpoints; the one-view ablation shows what happens without that requirement. A consistently detected look-alike would be
                confirmed.
              </li>
              <li>
                The persistence baseline is one simple design: it approaches every candidate, close views raise decoy scores, and three low-scoring frames
                reject a candidate for good. Do not read its numbers as representative of persistence methods.
              </li>
              <li>Simulation only, decoys designed by us, 20 held-out seeds per cell: preliminary.</li>
            </ul>
          </aside>
        )}
        {source === "recorded" && !recorded && (
          <p className={styles.note}>{recordedError ? `Recorded dataset could not be loaded (${recordedError}).` : "Loading recorded runs…"}</p>
        )}

        {source === "local" && (filteredBatches.length > 0 || filteredFailures.length > 0) && (
          <BatchRecordsView batches={filteredBatches} failures={filteredFailures} runsWithoutBatch={filtered.filter((r) => !(r as StoredRun).labBatchId).length} />
        )}

        {filtered.length === 0 ? (
          <div className={styles.empty}>
            <h2>No runs {source === "local" ? "in this browser yet" : "for this filter"}</h2>
            <p>Use “Run an experiment” below. Each mission renders the scene, runs the detector on every observation and is scored by the evaluator afterwards.</p>
          </div>
        ) : (
          <>
            <Summary runs={filtered} />
            <TrialTable runs={filtered} selected={selected} onSelect={setSelected} />
            {selected !== null && filtered[selected] && <TrialDetailLoader run={filtered[selected]} fullUrl={recorded?.fullDataset} onClose={() => setSelected(null)} />}
          </>
        )}

        <Runner
          onBatch={async (b, active) => {
            const saved = await saveBatch(b);
            putBatch(b);
            setRunningBatchId(active ? b.batchId : null);
            return saved;
          }}
          // Shown once stored, so the counts on screen are what a reload would find.
          onRun={async (r, b) => {
            const saved = await saveRun(r, b);
            setLocal((l) => [...l, r]);
            putBatch(b);
            return saved;
          }}
          onFailure={async (f, b) => {
            const saved = await saveFailure(f, b);
            setLocalFailures((l) => [...l, f]);
            putBatch(b);
            return saved;
          }}
          onClear={async () => {
            await clearRuns();
            setLocal([]);
            setLocalFailures([]);
            setStoredBatches([]);
          }}
          stored={{ runs: local.length, failures: localFailures.length, batches: batches.length }}
          onShowLocal={() => setSource("local")}
        />
        {source === "recorded" && <Calibration />}
      </main>
    </>
  );
}

function Provenance({ file }: { file: RecordedFile }) {
  return (
    <details className={styles.prov}>
      <summary>
        Provenance: recorded {new Date(file.generatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC · {String(file.environment.detector ?? "")} · backend{" "}
        {String(file.environment.backend ?? "")}
      </summary>
      <dl>
        {Object.entries(file.environment).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{String(v)}</dd>
          </div>
        ))}
        {Object.entries(file.protocol).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>
              {typeof v === "string" ? v : JSON.stringify(v)}
              {PROTOCOL_CORRECTIONS[k] && (
                <span className={styles.correction}>
                  {CORRECTION_LABEL}: {PROTOCOL_CORRECTIONS[k]}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function RateCell({ r }: { r: Rate }) {
  return (
    <td title={r.ci95 ? `95% Wilson interval ${(r.ci95[0] * 100).toFixed(0)}–${(r.ci95[1] * 100).toFixed(0)}%` : "no eligible trials"}>
      <span className={styles.rate}>{pct(r)}</span>
      <span className={styles.frac}>
        {r.num}/{r.den}
      </span>
    </td>
  );
}

function Summary({ runs }: { runs: LabRun[] }) {
  const byVariant = useMemo(() => [...groupBy(runs, (r) => r.variant).entries()].sort(([a], [b]) => variantRank(a) - variantRank(b) || a.localeCompare(b)), [runs]);
  const rows = byVariant.map(([variant, rs]) => ({ variant, m: missionMetrics(rs.map((r) => r.score)), c: candidateMetrics(rs.map((r) => r.score)) }));
  const small = rows.some((r) => r.m.trials < 20);
  return (
    <section className={styles.section} aria-labelledby="summary-h">
      <div className={styles.sectionHead}>
        <h2 id="summary-h">Mission-level comparison</h2>
        <p className={styles.note}>
          Unit of analysis: one seeded mission (trial). Cells show rate and numerator/denominator; hover for the 95% Wilson interval.
          {small && " Some groups have fewer than 20 trials: treat as preliminary."}
        </p>
      </div>
      <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Mission-level comparison table">
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Method</th>
              <th scope="col">Trials</th>
              <th scope="col" title={METRIC_DEFINITIONS.falseArrivalRate}>False-arrival rate ↓</th>
              <th scope="col" title={METRIC_DEFINITIONS.correctConfirmationRate}>Correct confirmation ↑</th>
              <th scope="col" title={METRIC_DEFINITIONS.abstentionRate}>Abstention</th>
              <th scope="col" title={METRIC_DEFINITIONS.completionRate}>Completion ↑</th>
              <th scope="col">Frames / mission</th>
              <th scope="col">Path (m)</th>
              <th scope="col">Sim time (s)</th>
              <th scope="col">Nav failures</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ variant, m }) => (
              <tr key={variant}>
                <th scope="row">{labelFor(variant)}</th>
                <td>{m.trials}</td>
                <RateCell r={m.falseArrivalRate} />
                <RateCell r={m.correctConfirmationRate} />
                <RateCell r={m.abstentionRate} />
                <RateCell r={m.completionRate} />
                <td>{m.meanFrames.toFixed(1)}</td>
                <td>{m.meanPathLength.toFixed(1)}</td>
                <td>{m.meanSimTime.toFixed(0)}</td>
                <td>{m.navFailures}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.plots}>
        <IntervalPlot rows={rows.map((r) => ({ label: labelFor(r.variant), far: r.m.falseArrivalRate, comp: r.m.completionRate }))} />
        <PathPlot rows={byVariant.map(([variant, rs]) => ({ label: labelFor(variant), paths: rs.map((r) => r.score.pathLength) }))} />
      </div>
      <details className={styles.defs}>
        <summary>Metric definitions and candidate-level counts</summary>
        <ul>
          {Object.entries(METRIC_DEFINITIONS).map(([k, v]) => (
            <li key={k}>
              <strong>{k}</strong>: {v}
            </li>
          ))}
        </ul>
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Candidate-level outcomes by ground-truth kind">
          <table className={styles.table}>
            <caption className={styles.note}>Candidate level: one encounter = one candidate track (verification episode), not one frame.</caption>
            <thead>
              <tr>
                <th scope="col">Method</th>
                <th scope="col">Candidate kind (ground truth)</th>
                <th scope="col">Encounters</th>
                <th scope="col">Confirmed</th>
                <th scope="col">Rejected</th>
                <th scope="col">Unconfirmed</th>
                <th scope="col">Not engaged</th>
              </tr>
            </thead>
            <tbody>
              {rows.flatMap(({ variant, c }) =>
                Object.entries(c.byKind).map(([kind, k]) => (
                  <tr key={variant + kind}>
                    <td>{labelFor(variant)}</td>
                    <td>{kind}</td>
                    <td>{k.encounters}</td>
                    <td>{k.confirmed}</td>
                    <td>{k.rejected}</td>
                    <td>{k.unconfirmed}</td>
                    <td>{k.notEngaged}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

const VARIANT_ORDER = ["single-frame", "persistence", "surestop-1view", "surestop", "surestop-identity"];
function variantRank(v: string): number {
  const i = VARIANT_ORDER.indexOf(v.split("@")[0]);
  return i < 0 ? VARIANT_ORDER.length : i;
}

const thresholdOf = new Map<string, number>();

/** Display name for a variant; baselines always show their threshold τ (from the run's recorded config). */
function labelFor(variant: string): string {
  const [m, p] = variant.split("@");
  const base = METHOD_LABELS[m as MethodId] ?? m;
  const tau = p ?? thresholdOf.get(variant)?.toString();
  return tau ? `${base} (τ=${tau})` : base;
}

function rememberThresholds(runs: LabRun[]) {
  for (const r of runs) {
    const c = r.result.config;
    if (r.result.method === "single-frame") thresholdOf.set(r.variant, c.singleFrame.threshold);
    if (r.result.method === "persistence") thresholdOf.set(r.variant, c.persistence.threshold);
  }
}

function IntervalPlot({ rows }: { rows: Array<{ label: string; far: Rate; comp: Rate }> }) {
  const rowH = 30;
  const left = 230;
  const width = 860;
  const labelCol = 100;
  const plotW = width - left - labelCol - 16;
  const h = rows.length * rowH + 44;
  const x = (v: number) => left + v * plotW;
  return (
    <figure className={styles.plot} tabIndex={0} aria-label="Interval plot of false-arrival and completion rates (scrolls horizontally on small screens)">
      <figcaption className={styles.note}>
        Mission-level rates with 95% Wilson intervals. <span className={styles.keyFar}>■</span> false-arrival rate (lower is better) ·{" "}
        <span className={styles.keyComp}>■</span> completion rate (higher is better). n = denominator shown at right.
      </figcaption>
      <svg viewBox={`0 0 ${width} ${h}`} role="img" aria-label="Interval plot of false-arrival and completion rates by method">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={10} y2={h - 26} className={styles.grid} />
            <text x={x(t)} y={h - 10} textAnchor="middle" className={styles.axis}>
              {t * 100}%
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = 22 + i * rowH;
          const mark = (rate: Rate, cls: string, dy: number) =>
            rate.value === null || !rate.ci95 ? null : (
              <g className={cls}>
                <line x1={x(rate.ci95[0])} x2={x(rate.ci95[1])} y1={y + dy} y2={y + dy} strokeWidth={2} />
                <circle cx={x(rate.value)} cy={y + dy} r={4} />
              </g>
            );
          return (
            <g key={r.label}>
              <text x={left - 10} y={y + 4} textAnchor="end" className={styles.rowLabel}>
                {r.label}
              </text>
              {mark(r.far, styles.farMark, -5)}
              {mark(r.comp, styles.compMark, 5)}
              <text x={width - 4} y={y + 4} textAnchor="end" className={styles.axis}>
                n={r.far.den}/{r.comp.den}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Per-trial path length by method: median (dot), interquartile range (bar) and full range (thin line). Descriptive only. */
function PathPlot({ rows }: { rows: Array<{ label: string; paths: number[] }> }) {
  const rowH = 30;
  const left = 230;
  const width = 860;
  const plotW = width - left - 116;
  const h = rows.length * rowH + 44;
  const all = rows.flatMap((r) => r.paths);
  const max = Math.max(10, Math.ceil(Math.max(...all, 0) / 10) * 10);
  const x = (v: number) => left + (v / max) * plotW;
  const q = (s: number[], p: number) => {
    const i = (s.length - 1) * p;
    const lo = Math.floor(i);
    return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo);
  };
  const ticks = Array.from({ length: max / 10 + 1 }, (_, i) => i * 10);
  return (
    <figure className={styles.plot} tabIndex={0} aria-label="Path length plot (scrolls horizontally on small screens)">
      <figcaption className={styles.note}>
        Cost: path driven per trial (m). <span className={styles.keyPath}>●</span> median · thick bar 25–75th percentile · thin line full range. Descriptive
        statistics of the same trials; no interval estimate.
      </figcaption>
      <svg viewBox={`0 0 ${width} ${h}`} role="img" aria-label="Path length per trial by method: median, interquartile range and full range">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={10} y2={h - 26} className={styles.grid} />
            <text x={x(t)} y={h - 10} textAnchor="middle" className={styles.axis}>
              {t} m
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = 22 + i * rowH;
          const s = [...r.paths].sort((a, b) => a - b);
          if (!s.length) return null;
          const med = q(s, 0.5);
          return (
            <g key={r.label}>
              <text x={left - 10} y={y + 4} textAnchor="end" className={styles.rowLabel}>
                {r.label}
              </text>
              <g className={styles.pathMark}>
                <line x1={x(s[0])} x2={x(s[s.length - 1])} y1={y} y2={y} strokeWidth={1} />
                <line x1={x(q(s, 0.25))} x2={x(q(s, 0.75))} y1={y} y2={y} strokeWidth={5} />
                <circle cx={x(med)} cy={y} r={4.5} />
              </g>
              <text x={width - 4} y={y + 4} textAnchor="end" className={styles.axis}>
                median {med.toFixed(1)} · n={s.length}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

function verdictOf(r: LabRun): string {
  const s = r.score;
  if (s.correctArrival) return "correct arrival";
  if (s.falseArrival) return `FALSE ARRIVAL (${s.arrivedAtKind})`;
  if (!s.targetPresent && s.outcome === "NOT_FOUND") return "correct: no arrival";
  if (s.abstained) return "abstained";
  return "target not reached";
}

function TrialTable({ runs, selected, onSelect }: { runs: LabRun[]; selected: number | null; onSelect: (i: number | null) => void }) {
  const [onlyFailures, setOnlyFailures] = useState(false);
  const idx = runs.map((r, i) => ({ r, i })).filter(({ r }) => !onlyFailures || !r.score.correctTerminal);
  return (
    <section className={styles.section} aria-labelledby="trials-h">
      <div className={styles.sectionHead}>
        <h2 id="trials-h">Trials</h2>
        <label className={styles.check}>
          <input type="checkbox" checked={onlyFailures} onChange={(e) => setOnlyFailures(e.target.checked)} /> Show only trials without the correct terminal outcome
        </label>
      </div>
      <div className={`${styles.tableWrap} ${styles.trials}`} tabIndex={0} role="region" aria-label="Trials table (scrolls)">
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              <th scope="col">Seed</th>
              <th scope="col">Method</th>
              <th scope="col">Robot outcome</th>
              <th scope="col">Evaluator verdict</th>
              <th scope="col">Candidates</th>
              <th scope="col">Frames</th>
              <th scope="col">Path (m)</th>
              <th scope="col"><span className="visually-hidden">Inspect</span></th>
            </tr>
          </thead>
          <tbody>
            {idx.map(({ r, i }) => (
              <tr key={i} aria-selected={selected === i} data-bad={r.score.falseArrival}>
                <td>{r.result.scenarioId}</td>
                <td className="mono">{r.result.seed}</td>
                <td>{labelFor(r.variant)}</td>
                <td>
                  <StatusBadge status={r.result.outcome} />
                </td>
                <td>{verdictOf(r)}</td>
                <td className="mono">{r.score.trackLabels.map((l) => `${l.trackId}:${l.status[0]}`).join(" ") || "—"}</td>
                <td className="mono">{r.result.stats.frames}</td>
                <td className="mono">{r.result.stats.pathLength.toFixed(1)}</td>
                <td>
                  <button className={styles.linkBtn} onClick={() => onSelect(selected === i ? null : i)} aria-expanded={selected === i}>
                    {selected === i ? "Close" : "Inspect"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TrialDetailLoader({ run, fullUrl, onClose }: { run: LabRun; fullUrl?: string; onClose: () => void }) {
  const [full, setFull] = useState<{ key: string; run: RunRecord } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = runKey(run);
  useEffect(() => {
    if (isFull(run)) return;
    let live = true;
    loadFullRecorded(fullUrl)
      .then((m) => {
        if (!live) return;
        const r = m.get(key);
        if (r) setFull({ key, run: r });
        else setError("This trial is not in the full dataset.");
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [run, key, fullUrl]);
  const resolved = isFull(run) ? run : full?.key === key ? full.run : null;
  if (resolved) return <TrialDetail run={resolved} onClose={onClose} />;
  return (
    <section className={styles.detail} aria-label="Trial decision trace" role="status">
      <p className={styles.note}>{error ?? "Loading the full recorded trace (frames, evidence, events)…"}</p>
    </section>
  );
}

function TrialDetail({ run, onClose }: { run: RunRecord; onClose: () => void }) {
  const r = run.result;
  const ref = useRef<HTMLElement>(null);
  useEffect(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), [run]);
  const consoleLink = !run.variant.includes("@") ? `/console?scenario=${r.scenarioId}&seed=${r.seed}&method=${r.method}&layout=v1` : null;
  return (
    <section className={styles.detail} ref={ref} aria-label="Trial decision trace">
      <div className={styles.sectionHead}>
        <h2>
          {r.scenarioId} · seed {r.seed} · {labelFor(run.variant)}
        </h2>
        <div className={styles.exports}>
          {consoleLink && (
            <a className="btn" href={consoleLink}>
              Replay in Mission Control
            </a>
          )}
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      <p>
        <StatusBadge status={r.outcome} /> {r.reason}
      </p>
      <p className={styles.evalLine}>
        <span className="provenance prov-eval">Evaluator</span> {verdictOf(run)} ·{" "}
        {run.score.trackLabels.map((l) => `${l.trackId} = ${l.label} (${l.status})`).join("; ") || "no candidates"}
      </p>
      <div className={styles.detailGrid}>
        <div>
          <h3>Candidates and evidence</h3>
          {r.tracks.map((t) => (
            <div key={t.id} className={styles.track}>
              <p>
                <strong className="mono">{t.id}</strong> <StatusBadge status={t.status} /> {t.decision.reason}
              </p>
              {r.method.startsWith("surestop") && t.evidence.length > 0 && (
                <ViewpointRose id={t.id} status={t.status} views={t.evidence} size={200} />
              )}
              <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={`Evidence table for candidate ${t.id}`}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col">Frame</th>
                      <th scope="col">Cell</th>
                      <th scope="col">Range</th>
                      <th scope="col">Score</th>
                      <th scope="col">Relief</th>
                      <th scope="col">Verdict / reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.evidence.map((e, i) => (
                      <tr key={i} data-counted={e.counted}>
                        <td className="mono">#{e.frameId}</td>
                        <td className="mono">{e.cell}</td>
                        <td className="mono">{e.range.toFixed(2)}</td>
                        <td className="mono">{e.score === null ? "miss" : e.score.toFixed(2)}</td>
                        <td className="mono">{e.excessRelief === null ? "—" : `${Math.round(e.excessRelief * 1000)} mm`}</td>
                        <td>
                          {e.verdict !== "INCONCLUSIVE" || r.method.startsWith("surestop") ? `${e.verdict}: ` : ""}
                          {e.reason}
                          {e.note ? <span className={styles.noteInline}> — {e.note}</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
        <div>
          <h3>Event history</h3>
          <ol className={styles.events}>
            {r.events.map((e, i) => (
              <li key={i}>
                <span className="mono">{e.t.toFixed(1)} s</span> <span className={styles.kind}>{e.kind}</span> {e.message}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

const BATCH_STATUS_LABEL: Record<LabBatch["status"], string> = { active: "running", complete: "complete", failed: "failed", incomplete: "incomplete" };

/** Batches run in this browser and their failed missions. Failures have no outcome and no score. */
function BatchRecordsView({ batches, failures, runsWithoutBatch }: { batches: LabBatch[]; failures: LabFailure[]; runsWithoutBatch: number }) {
  const overall = overallStatus(batches, failures.length);
  return (
    <section className={styles.section} aria-labelledby="batches-h">
      <div className={styles.sectionHead}>
        <h2 id="batches-h">Batches in this browser</h2>
        <p className={styles.note} data-testid="batch-status">
          {batches.some((b) => b.status === "active")
            ? "A batch is running in this page; its result is not complete until it ends."
            : overall === null
            ? "No batch recorded."
            : overall === "complete"
              ? "Every recorded batch is complete: all planned missions ran and none failed."
              : overall === "failed"
                ? `Not a clean result: ${failures.length} mission(s) failed. The tables above score completed missions only; failed missions are listed below.`
                : "Not a complete result: at least one batch did not run all its planned missions (stopped, ended by an error, or interrupted)."}
          {runsWithoutBatch > 0 && ` ${runsWithoutBatch} run(s) were stored before batches and failures were recorded; failures of their batches are unknown.`}
        </p>
      </div>
      <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Batches run in this browser">
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Started (UTC)</th>
              <th scope="col">Status</th>
              <th scope="col">Planned</th>
              <th scope="col">Completed</th>
              <th scope="col">Failed</th>
              <th scope="col">Not run</th>
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.batchId}>
                <td className="mono">{b.startedAt.slice(0, 19).replace("T", " ")}</td>
                <th scope="row">{BATCH_STATUS_LABEL[b.status]}</th>
                <td>{b.planned}</td>
                <td>{b.completed}</td>
                <td>{b.failed}</td>
                <td>{Math.max(0, b.planned - b.completed - b.failed)}</td>
                <td>{b.status === "incomplete" ? `${b.incompleteReason === "interrupted" ? "interrupted (page closed or reloaded, or still running in another tab)" : b.incompleteReason}${b.error ? `: ${b.error}` : ""}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {failures.length > 0 && (
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Failed missions (not scored)">
          <table className={styles.table}>
            <caption className={styles.note}>Failed missions (not scored)</caption>
            <thead>
              <tr>
                <th scope="col">Scenario</th>
                <th scope="col">Seed</th>
                <th scope="col">Method</th>
                <th scope="col">Error</th>
              </tr>
            </thead>
            <tbody>
              {failures.map((f, i) => (
                <tr key={`${f.batchId}-${i}`}>
                  <td>{f.scenarioId}</td>
                  <td className="mono">{f.seed}</td>
                  <td>{labelFor(f.variant)}</td>
                  <td>{f.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function newBatchId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface RunnerProps {
  /** Records a new or finished batch; `active` while it runs. Resolves false if it could not be stored. */
  onBatch: (b: LabBatch, active: boolean) => Promise<boolean>;
  /** Records a completed run with its batch's updated counters. */
  onRun: (r: StoredRun, b: LabBatch) => Promise<boolean>;
  /** Records a failed mission (never scored) with its batch's updated counters. */
  onFailure: (f: LabFailure, b: LabBatch) => Promise<boolean>;
  onClear: () => Promise<void>;
  stored: { runs: number; failures: number; batches: number };
  onShowLocal: () => void;
}

function Runner({ onBatch, onRun, onFailure, onClear, stored, onShowLocal }: RunnerProps) {
  const [scen, setScen] = useState<string[]>(["poster-decoy"]);
  const [variants, setVariants] = useState<string[]>(["surestop", "single-frame"]);
  const [seedStart, setSeedStart] = useState(1);
  const [seedCount, setSeedCount] = useState(2);
  const [status, setStatus] = useState<{ running: boolean; done: number; total: number; msg: string; error?: string }>({ running: false, done: 0, total: 0, msg: "" });
  const stop = useRef(false);
  const total = scen.length * variants.length * seedCount;
  const localCount = stored.runs;
  const storedCount = stored.runs + stored.failures + stored.batches;

  const run = useCallback(async () => {
    stop.current = false;
    setStatus({ running: true, done: 0, total, msg: "Loading detector and scene…" });
    const seeds = Array.from({ length: seedCount }, (_, i) => seedStart + i);
    // The batch is recorded before its first mission, and its counters with every run and failure,
    // so a batch cut off by a reload or a closed tab is still listed (as incomplete).
    let batch = newBatch(newBatchId(), new Date().toISOString(), { scenarios: scen, seeds, variants, layout: "v1" });
    let unsaved = !(await onBatch(batch, true));
    const finish = async (opts: { stopped?: boolean; error?: string }) => {
      batch = finishBatch(batch, new Date().toISOString(), opts);
      unsaved = !(await onBatch(batch, false)) || unsaved;
      return batch;
    };
    try {
      const { ExperimentEngine, parseVariant } = await import("@/experiments/engine");
      const engine = await ExperimentEngine.shared(new URLSearchParams(window.location.search).get("backend"));
      const { failures } = await engine.runBatch(
        { scenarios: scen, seeds, variants: variants.map(parseVariant) },
        {
          shouldStop: () => stop.current,
          onRun: async (r, done, tot) => {
            batch = { ...batch, completed: batch.completed + 1 };
            unsaved = !(await onRun({ ...r, labBatchId: batch.batchId }, batch)) || unsaved;
            setStatus({ running: true, done, total: tot, msg: `${r.result.scenarioId} seed ${r.result.seed} ${r.variant}: ${r.result.outcome}` });
          },
          // A failed mission is recorded as a failure (no outcome, never scored); the batch continues.
          onFailure: async (f, done, tot) => {
            batch = { ...batch, failed: batch.failed + 1 };
            unsaved = !(await onFailure({ ...f, batchId: batch.batchId }, batch)) || unsaved;
            setStatus({ running: true, done, total: tot, msg: `${f.scenarioId} seed ${f.seed} ${f.variant}: mission failed (${f.error})` });
          },
        },
      );
      const b = await finish({ stopped: stop.current });
      const failed = failures.length
        ? ` ${failures.length} mission(s) failed and were not scored: ${failures.map((f) => `${f.scenarioId} seed ${f.seed} ${f.variant} (${f.error})`).join("; ")}. They are listed with the runs in this browser and in the JSON export.`
        : "";
      setStatus((s) => ({
        ...s,
        running: false,
        msg: `${stop.current ? `Stopped after ${s.done} of ${s.total} missions.` : `Finished ${s.done} missions.`} Batch ${describeBatch(b)}.${failed}${unsaved ? " Some records could not be saved in this browser's storage; they are kept for this page only." : ""}`,
      }));
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      const b = await finish({ error });
      setStatus((s) => ({ ...s, running: false, error: `${error} (batch ${describeBatch(b)})` }));
    }
  }, [scen, variants, seedStart, seedCount, total, onBatch, onRun, onFailure]);

  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <section className={styles.section} aria-labelledby="run-h">
      <div className={styles.sectionHead}>
        <h2 id="run-h">Run an experiment</h2>
        <p className={styles.note}>Runs in this tab with real rendering and inference. Results are saved in this browser only (IndexedDB) and never mixed into the recorded dataset. Runs use the recorded-evaluation (v1) layout. A mission that fails is recorded with its error, listed separately and never scored.</p>
      </div>
      <div className={styles.runGrid}>
        <fieldset className={styles.fieldset}>
          <legend>Scenarios</legend>
          {SCENARIOS.map((s) => (
            <label key={s.id} className={styles.check}>
              <input type="checkbox" checked={scen.includes(s.id)} onChange={() => toggle(scen, setScen, s.id)} disabled={status.running} /> {s.title}
            </label>
          ))}
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend>Methods</legend>
          {RUNNABLE.map((m) => (
            <label key={m.spec} className={styles.check}>
              <input type="checkbox" checked={variants.includes(m.spec)} onChange={() => toggle(variants, setVariants, m.spec)} disabled={status.running} /> {m.label}
            </label>
          ))}
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend>Seeds</legend>
          <div className={styles.seedRow}>
            <div className="field">
              <label htmlFor="seed-start">First seed</label>
              <input id="seed-start" className="input mono" type="number" min={0} value={seedStart} disabled={status.running} onChange={(e) => setSeedStart(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
            </div>
            <div className="field">
              <label htmlFor="seed-count">Count</label>
              <input id="seed-count" className="input mono" type="number" min={1} max={50} value={seedCount} disabled={status.running} onChange={(e) => setSeedCount(Math.min(50, Math.max(1, Math.floor(Number(e.target.value) || 1))))} />
            </div>
          </div>
          <p className={styles.note}>{total} missions. Expect roughly 5–30 s each depending on your GPU.</p>
        </fieldset>
      </div>
      <div className={styles.runBar}>
        {status.running ? (
          <button className="btn" onClick={() => (stop.current = true)}>
            Stop after current mission
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => void run()} disabled={!total}>
            Run {total} mission{total === 1 ? "" : "s"}
          </button>
        )}
        <div className={styles.progress} role="status" aria-live="polite">
          {status.total > 0 && (
            <>
              <progress max={status.total} value={status.done} aria-label="Missions completed" />
              <span className="mono">
                {status.done}/{status.total}
              </span>
            </>
          )}
          <span className={styles.note}>{status.error ? `Error: ${status.error}` : status.msg}</span>
        </div>
        <div className={styles.exports}>
          <button className="btn" onClick={onShowLocal} disabled={!localCount}>
            View browser runs ({localCount})
          </button>
          <button
            className="btn btn-ghost"
            disabled={!storedCount || status.running}
            onClick={() => {
              const what = `${stored.runs} runs, ${stored.failures} failed-mission records and ${stored.batches} batch records`;
              if (window.confirm(`Delete all ${what} stored in this browser? The recorded reference dataset is not affected.`)) void onClear();
            }}
          >
            Clear browser runs
          </button>
        </div>
      </div>
    </section>
  );
}

interface CalibFile {
  generatedAt: string;
  seeds: number[];
  rule: string;
  selected: Record<string, number>;
  rows: Array<{ variant: string; trials: number; completion: Rate; far: Rate; ccr: Rate }>;
}

function Calibration() {
  const [cal, setCal] = useState<CalibFile | null>(null);
  useEffect(() => {
    fetch("/data/calibration.json")
      .then((r) => (r.ok ? r.json() : null))
      .then(setCal)
      .catch(() => setCal(null));
  }, []);
  if (!cal) return null;
  return (
    <section className={styles.section} aria-labelledby="cal-h">
      <div className={styles.sectionHead}>
        <h2 id="cal-h">Baseline threshold calibration</h2>
        <p className={styles.note}>
          Seeds {cal.seeds[0]}–{cal.seeds[cal.seeds.length - 1]} (disjoint from the evaluation seeds). {cal.rule}
        </p>
      </div>
      <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Baseline threshold calibration table">
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Variant</th>
              <th scope="col">Trials</th>
              <th scope="col">Completion</th>
              <th scope="col">False-arrival rate</th>
              <th scope="col">Correct confirmation</th>
            </tr>
          </thead>
          <tbody>
            {cal.rows.map((r) => (
              <tr key={r.variant} data-selected={Object.entries(cal.selected).some(([m, t]) => r.variant === `${m}@${t}`)}>
                <th scope="row">
                  {labelFor(r.variant)}
                  {Object.entries(cal.selected).some(([m, t]) => r.variant === `${m}@${t}`) && <span className={styles.sel}> selected</span>}
                </th>
                <td>{r.trials}</td>
                <RateCell r={r.completion} />
                <RateCell r={r.far} />
                <RateCell r={r.ccr} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
