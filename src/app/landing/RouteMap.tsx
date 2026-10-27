"use client";

// Plan view of the recorded mission: walls (the robot's prior map), the trajectory the robot
// actually drove, the planned verification viewpoints it moved to, and its candidate estimates
// with their terminal decisions. Robot-side data only; no ground-truth object is drawn. The
// path draws itself once when the map scrolls into view (not under reduced motion).
import { useEffect, useRef, useState } from "react";
import styles from "./RouteMap.module.css";

interface Rect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface RouteData {
  walls: Rect[];
  bounds: Rect;
  trajectory: Array<[number, number]>;
  tracks: Array<{ id: string; x: number; z: number; status: string }>;
  verifyViews: Array<{ frameId: number; x: number; z: number; trackId: string | null; detected: boolean }>;
}

export default function RouteMap({ data, caption }: { data: RouteData; caption: string }) {
  const ref = useRef<HTMLElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      const raf = requestAnimationFrame(() => setInView(true));
      return () => cancelAnimationFrame(raf);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const b = data.bounds;
  const pad = 0.5;
  const vb = `${b.minX - pad} ${b.minZ - pad} ${b.maxX - b.minX + 2 * pad} ${b.maxZ - b.minZ + 2 * pad}`;
  const pts = data.trajectory.map(([x, z]) => `${x},${z}`).join(" ");
  const start = data.trajectory[0];
  const end = data.trajectory[data.trajectory.length - 1];
  const trackById = new Map(data.tracks.map((t) => [t.id, t]));

  return (
    <figure ref={ref} className={styles.map} data-inview={inView}>
      <svg viewBox={vb} role="img" aria-label={`Plan view of the recorded mission: the robot's path from the start to the arrival point, ${data.verifyViews.length} planned verification viewpoints, and candidates ${data.tracks.map((t) => `${t.id} ${t.status}`).join(", ")}.`}>
        <rect x={b.minX} y={b.minZ} width={b.maxX - b.minX} height={b.maxZ - b.minZ} className={styles.floor} />
        {data.walls.map((w, i) => (
          <rect key={i} x={w.minX} y={w.minZ} width={w.maxX - w.minX} height={w.maxZ - w.minZ} className={styles.wall} />
        ))}
        {data.verifyViews.map((v) => {
          const t = v.trackId ? trackById.get(v.trackId) : null;
          return t ? <line key={`ray-${v.frameId}`} x1={v.x} y1={v.z} x2={t.x} y2={t.z} className={styles.ray} data-detected={v.detected} /> : null;
        })}
        <polyline points={pts} pathLength={1} className={styles.path} />
        {data.verifyViews.map((v) => (
          <circle key={`vp-${v.frameId}`} cx={v.x} cy={v.z} r={0.13} className={styles.viewpoint} data-detected={v.detected} />
        ))}
        <circle cx={start[0]} cy={start[1]} r={0.16} className={styles.start} />
        <text x={start[0] + 0.3} y={start[1] + 0.12} className={styles.label}>
          start
        </text>
        {data.tracks.map((t) => (
          <g key={t.id} className={styles.cand} data-status={t.status} transform={`translate(${t.x},${t.z})`}>
            <circle r={0.42} className={styles.candRing} />
            <rect x={-0.1} y={-0.1} width={0.2} height={0.2} />
            <text x={0} y={-0.62} textAnchor="middle" className={styles.candLabel}>
              {t.id} · {t.status}
            </text>
          </g>
        ))}
        <g className={styles.arrival} transform={`translate(${end[0]},${end[1]})`}>
          <circle r={0.2} />
          <text x={-0.36} y={0.14} textAnchor="end" className={styles.label}>
            arrived
          </text>
        </g>
      </svg>
      <figcaption className={styles.legend}>
        <span>
          <i className={styles.kPath} /> driven path
        </span>
        <span>
          <i className={styles.kView} /> planned verification viewpoint
        </span>
        <span>
          <i className={styles.kMiss} /> viewpoint where it was not re-detected
        </span>
        <span>
          <i className={styles.kWall} /> prior map (walls)
        </span>
      </figcaption>
      <p className={styles.caption}>{caption}</p>
    </figure>
  );
}
