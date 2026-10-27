"use client";

// The landing "motion poster": two recorded robot-camera frames from one mission, each as a
// camera/depth comparison on one shared divider. On load the divider sweeps once from the camera
// image to an even split, then the user controls it (pointer or keyboard). Under reduced motion
// the final state is shown immediately. Every value is passed in from the recorded run.
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import styles from "./EvidencePoster.module.css";

export interface PosterFrame {
  trackId: string;
  frameId: number;
  t: number;
  title: string;
  rgb: string;
  depth: string;
  rgbAlt: string;
  depthAlt: string;
  score: number;
  reliefMm: number;
  range: number;
  verdict: string;
  status: string;
  statusDetail: string;
}

const SWEEP_MS = 1400;
const SWEEP_DELAY_MS = 500;

export default function EvidencePoster({ frames, provenance }: { frames: PosterFrame[]; provenance: string }) {
  const [split, setSplit] = useState(100);
  const [stage, setStage] = useState(0);
  const touched = useRef(false);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const t0 = performance.now() + SWEEP_DELAY_MS;
    const tick = (now: number) => {
      if (touched.current) return;
      if (reduce) {
        // No sweep: show the final, evenly split state at once.
        setSplit(50);
        setStage(2);
        return;
      }
      const k = Math.min(1, Math.max(0, (now - t0) / SWEEP_MS));
      const e = 1 - Math.pow(1 - k, 3);
      const v = 100 - 50 * e;
      setSplit(v);
      if (v <= 75) setStage((s) => Math.max(s, 1));
      if (k >= 1) setStage(2);
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const onInput = (v: number) => {
    touched.current = true;
    setSplit(v);
    setStage(2);
  };

  return (
    <figure className={styles.poster} data-stage={stage} style={{ ["--split" as string]: `${split}%`, ["--split-n" as string]: split }}>
      <div className={styles.frames}>
        {frames.map((f) => (
          <div key={f.trackId} className={styles.frame} data-status={f.status}>
            <div className={styles.view}>
              <Image className={styles.depth} src={f.depth} alt={f.depthAlt} width={480} height={360} sizes="(max-width: 767px) 92vw, 34vw" priority />
              <div className={styles.rgbClip} aria-hidden={split <= 0}>
                <Image className={styles.rgb} src={f.rgb} alt={f.rgbAlt} width={480} height={360} sizes="(max-width: 767px) 92vw, 34vw" priority />
              </div>
              <span className={styles.divider} aria-hidden="true" />
              <span className={`${styles.tag} ${styles.tagRgb}`} aria-hidden="true">
                Camera
              </span>
              <span className={`${styles.tag} ${styles.tagDepth}`} aria-hidden="true">
                Depth
              </span>
            </div>
            <dl className={styles.ledger}>
              <div className={styles.row} data-row="0">
                <dt>Detector</dt>
                <dd>
                  “potted plant” <b className="mono">{f.score.toFixed(2)}</b>
                </dd>
              </div>
              <div className={styles.row} data-row="1">
                <dt>Depth relief</dt>
                <dd>
                  <b className="mono">{f.reliefMm} mm</b> → <span className={styles.verdict}>{f.verdict}</span>
                </dd>
              </div>
              <div className={styles.row} data-row="2">
                <dt>Verifier</dt>
                <dd>
                  <span className={styles.status}>
                    <i aria-hidden="true" />
                    {f.status}
                  </span>{" "}
                  <span className={styles.detail}>{f.statusDetail}</span>
                </dd>
              </div>
            </dl>
            <p className={styles.frameTitle}>
              <span className="mono">{f.trackId}</span> {f.title} · frame {f.frameId} · {f.range.toFixed(2)} m · t {f.t.toFixed(1)} s
            </p>
          </div>
        ))}
      </div>
      <label className={styles.control}>
        <span>Camera</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(split)}
          onChange={(e) => onInput(Number(e.target.value))}
          aria-label="Compare camera image and depth image: drag left to reveal more depth"
          aria-valuetext={`${Math.round(split)}% camera image, ${100 - Math.round(split)}% depth image`}
        />
        <span>Depth</span>
      </label>
      <figcaption className={styles.caption}>{provenance}</figcaption>
      <noscript>
        <style>{`.${styles.row}{opacity:1!important}.${styles.poster}{--split:50%!important;--split-n:50!important}`}</style>
      </noscript>
    </figure>
  );
}
