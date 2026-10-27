"use client";

import { useEffect, useState } from "react";
import type { FeasRecord, FeasReport } from "@/diagnostics/feasibility";

let runStarted = false;

declare global {
  interface Window {
    __SURESTOP_FEASIBILITY__?: FeasReport | { error: string };
  }
}

export default function PerceptionCheck() {
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const [recent, setRecent] = useState<FeasRecord[]>([]);
  const [report, setReport] = useState<FeasReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Module-level guard: StrictMode mounts effects twice in development.
    if (params.get("run") !== "1" || runStarted) return;
    runStarted = true;
    const base = params.get("base") === "mobilenet_v2" ? "mobilenet_v2" : "lite_mobilenet_v2";
    const assetIds = (params.get("assets") ?? "plant,sheenChair").split(",").filter(Boolean);
    const decoyAssetIds = (params.get("decoys") ?? "plant").split(",").filter(Boolean);
    const thumbs = params.get("thumbs") !== "0";
    const thumbScale = Number(params.get("thumbScale") ?? "0.4");
    const only = (params.get("only") ?? "").split(",").filter(Boolean);
    (async () => {
      try {
        const { runFeasibility } = await import("@/diagnostics/feasibility");
        const r = await runFeasibility({
          base,
          backend: (["cpu", "wasm"].includes(params.get("backend") ?? "") ? params.get("backend") : "webgl") as "webgl" | "wasm" | "cpu",
          assetIds,
          decoyAssetIds,
          thumbs,
          thumbScale,
          only,
          onProgress: (d, t, rec) => {
            setProgress([d, t]);
            setRecent((prev) => [rec, ...prev].slice(0, 12));
          },
        });
        window.__SURESTOP_FEASIBILITY__ = r;
        setReport(r);
      } catch (e) {
        const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
        window.__SURESTOP_FEASIBILITY__ = { error: msg };
        setError(msg);
      }
    })();
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: "monospace", fontSize: 13 }}>
      <h1 style={{ fontSize: 18 }}>Perception feasibility check</h1>
      <p>Renders candidate assets with Three.js and runs COCO-SSD on the rendered pixels. Add <code>?run=1</code> to start.</p>
      <p data-testid="progress">progress: {progress[0]} / {progress[1]}</p>
      {error && <pre style={{ color: "#f87171" }}>{error}</pre>}
      {report && (
        <table>
          <thead>
            <tr><th>asset</th><th>kind</th><th>class</th><th>n</th><th>≥0.5</th><th>≥0.3</th><th>mean best</th></tr>
          </thead>
          <tbody>
            {report.summary.map((r) => (
              <tr key={r.assetId + r.kind}>
                <td>{r.assetId}</td><td>{r.kind}</td><td>{r.cls}</td><td>{r.n}</td><td>{r.hit50}</td><td>{r.hit30}</td><td>{r.meanBest.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
        {recent.map((r) => (
          <figure key={r.id} style={{ margin: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- data: URL thumbnails */}
            {r.thumb && <img src={r.thumb} alt={r.id} width={256} height={192} />}
            <figcaption>{r.id} · best {(r.match?.score ?? 0).toFixed(2)}</figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}
