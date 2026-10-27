"use client";

// One time control for the whole console (the Rerun/Foxglove convention: a single shared index
// drives every evidence view). Each tick is one camera frame of the mission, coloured by why it
// was taken; marks above the ticks are the verifier's per-view verdicts; vertical rules are
// candidate decisions. The native range input gives keyboard and touch control.
import type { MissionEvent } from "@/mission/types";
import type { FrameView } from "./controller";
import styles from "./FrameScrubber.module.css";

function verdictOf(f: FrameView): "VOLUMETRIC" | "FLAT" | "INCONCLUSIVE" | "DETECTED" | null {
  if (!f.targets.length) return null;
  for (const v of ["FLAT", "VOLUMETRIC", "INCONCLUSIVE"] as const) if (f.targets.some((t) => t.note.startsWith(`${v}:`))) return v;
  return "DETECTED";
}

const PURPOSE_LABEL: Record<string, string> = {
  search: "search",
  scan: "scan",
  verify: "verification view",
  persist: "persistence step",
  arrival: "arrival",
};

export default function FrameScrubber({
  frames,
  events,
  selectedFrameId,
  followLive,
  running,
  onSelect,
  onFollow,
}: {
  frames: FrameView[];
  events: MissionEvent[];
  selectedFrameId: number | null;
  followLive: boolean;
  running: boolean;
  onSelect: (frameId: number) => void;
  onFollow: () => void;
}) {
  const n = frames.length;
  const idx = Math.max(0, frames.findIndex((f) => f.frameId === selectedFrameId));
  const cur = n ? frames[selectedFrameId === null ? n - 1 : idx] : null;
  const curIdx = cur ? frames.indexOf(cur) : 0;
  const x = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
  const decisions = events.filter((e) => e.kind === "candidate" && (e.to === "CONFIRMED" || e.to === "REJECTED" || e.to === "UNCONFIRMED") && e.frameId);
  const curVerdict = cur ? verdictOf(cur) : null;
  return (
    <div className={styles.scrubber}>
      <div className={styles.head}>
        <h2 className={styles.title} id="frames-h">
          Frames
        </h2>
        <span className={styles.now}>
          {cur ? (
            <>
              <b className="mono">#{cur.frameId}</b> of {n} · t {cur.t.toFixed(1)} s · {PURPOSE_LABEL[cur.purpose ?? ""] ?? cur.purpose ?? "—"}
              {curVerdict && curVerdict !== "DETECTED" ? ` · ${curVerdict}` : ""}
            </>
          ) : (
            "No frames yet"
          )}
        </span>
        <div className={styles.nav}>
          <button className="btn" aria-label="Previous frame" disabled={!cur || curIdx <= 0} onClick={() => onSelect(frames[curIdx - 1].frameId)}>
            ‹
          </button>
          <button className="btn" aria-label="Next frame" disabled={!cur || curIdx >= n - 1} onClick={() => onSelect(frames[curIdx + 1].frameId)}>
            ›
          </button>
          {running && !followLive && (
            <button className="btn" onClick={onFollow}>
              Follow live
            </button>
          )}
        </div>
      </div>
      <div className={styles.track} data-empty={n === 0}>
        {frames.map((f, i) => {
          const v = verdictOf(f);
          return (
            <span key={f.frameId} className={styles.tick} data-purpose={f.purpose ?? "other"} style={{ left: `${x(i)}%` }}>
              {v && <i className={styles.mark} data-verdict={v} />}
            </span>
          );
        })}
        {decisions.map((e, i) => {
          const fi = frames.findIndex((f) => f.frameId === e.frameId);
          if (fi < 0) return null;
          return (
            <span key={i} className={styles.decision} data-to={e.to} data-edge={x(fi) > 88} style={{ left: `${x(fi)}%` }}>
              <span className={styles.decisionLabel}>
                {e.trackId} {e.to === "CONFIRMED" ? "●" : e.to === "REJECTED" ? "✕" : "◌"}
              </span>
            </span>
          );
        })}
        {cur && <span className={styles.cursor} style={{ left: `${x(curIdx)}%` }} aria-hidden="true" />}
        <input
          className={styles.range}
          type="range"
          min={0}
          max={Math.max(0, n - 1)}
          step={1}
          value={curIdx}
          disabled={n === 0}
          aria-labelledby="frames-h"
          aria-valuetext={cur ? `Frame ${cur.frameId} of ${n}, t ${cur.t.toFixed(1)} s, ${PURPOSE_LABEL[cur.purpose ?? ""] ?? cur.purpose}${curVerdict ? `, ${curVerdict.toLowerCase()}` : ""}` : "no frames"}
          onChange={(e) => {
            const f = frames[Number(e.target.value)];
            if (f) onSelect(f.frameId);
          }}
        />
      </div>
      <div className={styles.legend} aria-hidden="true">
        <span>
          <i data-purpose="search" /> search / scan
        </span>
        <span>
          <i data-purpose="verify" /> verification view
        </span>
        <span>
          <i data-purpose="arrival" /> arrival
        </span>
        <span>
          <i className={styles.mark} data-verdict="FLAT" /> flat
        </span>
        <span>
          <i className={styles.mark} data-verdict="VOLUMETRIC" /> volumetric
        </span>
        <span>
          <i className={styles.mark} data-verdict="DETECTED" /> detection
        </span>
      </div>
    </div>
  );
}
