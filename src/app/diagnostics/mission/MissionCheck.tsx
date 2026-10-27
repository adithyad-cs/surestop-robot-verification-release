"use client";

import { useEffect, useState } from "react";
import type { BatchFailure, BatchProvenance, RunRecord } from "@/experiments/engine";
import { parseLayoutParam } from "@/scenarios/generate";

let started = false;

declare global {
  interface Window {
    __SURESTOP_MISSIONS__?: { runs: RunRecord[]; failures: BatchFailure[]; provenance: BatchProvenance; backend: unknown; detector: unknown; wallMs: number } | { error: string };
    __SURESTOP_SNAP__?: { images: Record<string, string> } | { error: string };
    /**
     * Installed by scripts/missions.mjs (Playwright exposeFunction). Each call resolves only after
     * the entry is durably written to the batch journal, so the next mission starts only after
     * the previous one is checkpointed. The plan reply lists jobs already completed (resume).
     */
    __surestopCheckpoint?: (entry: object) => Promise<{ skip?: string[]; error?: string } | null>;
  }
}

/**
 * Headless batch runner used for end-to-end checks:
 * /diagnostics/mission?run=1&scenarios=..&seeds=..&methods=..[&layout=v1|v2] (default v1, the recorded layout).
 */
export default function MissionCheck() {
  const [log, setLog] = useState<string[]>([]);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("run") !== "1" || started) return;
    started = true;
    const scenarios = (q.get("scenarios") ?? "poster-decoy").split(",");
    const seeds = (q.get("seeds") ?? "1").split(",").map(Number);
    const variantSpecs = (q.get("methods") ?? "single-frame,surestop").split(",");
    // Absent → v1 (the recorded layout every batch command assumes); unknown values are refused.
    const parsed = parseLayoutParam(q.get("layout"), "v1");
    if (parsed.error !== null) {
      window.__SURESTOP_MISSIONS__ = { error: parsed.error };
      const msg = parsed.error;
      void Promise.resolve().then(() => setLog((l) => [...l, `ERROR ${msg}`]));
      return;
    }
    const layout = parsed.layout;
    const t0 = performance.now();
    if (q.get("snap") === "1") {
      (async () => {
        try {
          const { snapshot } = await import("@/diagnostics/snapshot");
          window.__SURESTOP_SNAP__ = { images: await snapshot(scenarios[0], seeds[0], q.get("backend")) };
          setLog((l) => [...l, "snapshot done"]);
        } catch (e) {
          window.__SURESTOP_SNAP__ = { error: e instanceof Error ? `${e.message}\n${e.stack}` : String(e) };
        }
      })();
      return;
    }
    (async () => {
      try {
        const { ExperimentEngine, parseVariant } = await import("@/experiments/engine");
        const variants = variantSpecs.map(parseVariant);
        const engine = await ExperimentEngine.create(q.get("backend"));
        setLog((l) => [...l, `backend ${engine.detector.info.backend} (${engine.backend.reason})`]);
        const checkpoint = window.__surestopCheckpoint;
        let skip: Set<string> | null = null;
        if (checkpoint) {
          // Same job order as ExperimentEngine.runBatch.
          const jobs = scenarios.flatMap((scenarioId) => seeds.flatMap((seed) => variants.map((v) => ({ scenarioId, seed, variant: v.label }))));
          const protocol = await engine.protocol({ seeds, variants, layout });
          const reply = await checkpoint({ type: "plan", jobs, layout, provenance: engine.batchProvenance(protocol, scenarios), backend: engine.backend, detector: engine.detector.info });
          if (reply?.error) throw new Error(`batch journal refused this batch: ${reply.error}`);
          skip = new Set(reply?.skip ?? []);
          const n = skip.size;
          if (n) setLog((l) => [...l, `resuming: ${n} mission(s) already completed in the journal are not run again`]);
        }
        const { runs, failures, provenance } = await engine.runBatch(
          { scenarios, seeds, variants, layout, skip: skip ? (j) => skip.has(`${j.scenarioId}|${j.seed}|${j.variant}`) : undefined },
          {
            onRun: async (r, d, t) => {
              if (checkpoint) await checkpoint({ type: "run", run: r });
              setLog((l) => [
                ...l,
                `[${d}/${t}] ${r.result.scenarioId} seed ${r.result.seed}${r.layout ? ` ${r.layout.id}${r.layout.fallback ? " (FALLBACK)" : ""}` : ""} ${r.variant}: ${r.result.outcome} — ${r.result.reason} | eval: correct=${r.score.correctArrival} false=${r.score.falseArrival} frames=${r.result.stats.frames}`,
              ]);
            },
            // A failed mission has no outcome; it is logged and recorded separately, never scored.
            onFailure: async (f, d, t) => {
              if (checkpoint) await checkpoint({ type: "failure", failure: f });
              setLog((l) => [...l, `[${d}/${t}] ${f.scenarioId} seed ${f.seed} ${f.variant}: MISSION FAILED — ${f.error}`]);
            },
          },
        );
        window.__SURESTOP_MISSIONS__ = { runs, failures, provenance, backend: engine.backend, detector: engine.detector.info, wallMs: performance.now() - t0 };
      } catch (e) {
        const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
        window.__SURESTOP_MISSIONS__ = { error: msg };
        setLog((l) => [...l, `ERROR ${msg}`]);
      }
    })();
  }, []);
  return (
    <main style={{ padding: 24, fontFamily: "monospace", fontSize: 12 }}>
      <h1 style={{ fontSize: 16 }}>Mission batch check</h1>
      <pre data-testid="log">{log.join("\n")}</pre>
    </main>
  );
}
