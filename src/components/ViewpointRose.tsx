// Plan-view plot of the observations behind one candidate decision. The candidate sits at the
// centre; each recorded observation is drawn at the robot's bearing and range as seen from the
// candidate, on the verifier's own viewpoint-cell grid (0.75 m range bins × 30° bearing bins,
// one vote per cell). Orientation matches the overview map: +x right, +z down.
// Purely presentational: it draws EvidenceRecord-like data and computes nothing new.
import { DEFAULT_CELL } from "@/verify/viewpoint";
import type { CandidateStatus, ViewVerdict } from "@/verify/types";
import styles from "./ViewpointRose.module.css";

export interface RoseView {
  frameId: number;
  bearingDeg: number;
  range: number;
  verdict: ViewVerdict;
  /** Detector score; null when the candidate was looked for but not re-detected. */
  score: number | null;
  counted: boolean;
  excessRelief: number | null;
}

const R_CELLS = 80; // px radius for 3 range bins (0–2.25 m) plus the 2.25–3.0 m bin
const R_FAR = 96;
const MAX_NEAR = DEFAULT_CELL.rangeBin * 4; // 3.0 m

function radius(range: number): number {
  if (range <= MAX_NEAR) return (range / MAX_NEAR) * R_CELLS;
  return R_CELLS + Math.min(1, (range - MAX_NEAR) / 6) * (R_FAR - R_CELLS);
}

function polar(r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [r * Math.cos(a), r * Math.sin(a)];
}

function sector(r0: number, r1: number, a0: number, a1: number): string {
  const [x0, y0] = polar(r1, a0);
  const [x1, y1] = polar(r1, a1);
  const [x2, y2] = polar(r0, a1);
  const [x3, y3] = polar(r0, a0);
  return `M${x0},${y0} A${r1},${r1} 0 0 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 0 0 ${x3},${y3} Z`;
}

function kindOf(v: RoseView): "vol" | "flat" | "miss" | "inc" {
  if (v.verdict === "VOLUMETRIC") return "vol";
  if (v.verdict === "FLAT") return "flat";
  return v.score === null ? "miss" : "inc";
}

export function roseSummary(views: RoseView[]): { vol: number; flat: number; miss: number; inc: number } {
  const c = { vol: 0, flat: 0, miss: 0, inc: 0 };
  for (const v of views) if (v.counted) c[kindOf(v)]++;
  return c;
}

export default function ViewpointRose({
  id,
  status,
  views,
  selectedFrameId = null,
  size = 220,
}: {
  id: string;
  status: CandidateStatus;
  views: RoseView[];
  selectedFrameId?: number | null;
  size?: number;
}) {
  const bin = DEFAULT_CELL.bearingBinDeg;
  const rb = DEFAULT_CELL.rangeBin;
  const c = roseSummary(views);
  const label =
    `Viewpoints for candidate ${id}, status ${status}: ${views.filter((v) => v.counted).length} counted views — ` +
    `${c.vol} volumetric, ${c.flat} flat, ${c.miss} not re-detected, ${c.inc} inconclusive.`;
  const cells = new Map<string, RoseView>();
  for (const v of views) {
    if (!v.counted) continue;
    const ri = Math.floor(v.range / rb);
    const bi = Math.floor((((v.bearingDeg % 360) + 360) % 360) / bin);
    cells.set(`${ri}:${bi}`, v);
  }
  return (
    <figure className={styles.rose} data-status={status}>
      <svg viewBox="-112 -112 224 224" width={size} height={size} role="img" aria-label={label}>
        <circle r={R_FAR} className={styles.farBand} />
        <circle r={R_CELLS} className={styles.nearDisc} />
        {[...cells.entries()].map(([k, v]) => {
          const [ri, bi] = k.split(":").map(Number);
          const r0 = ri >= 4 ? R_CELLS : radius(ri * rb);
          const r1 = ri >= 4 ? R_FAR : radius((ri + 1) * rb);
          return <path key={k} d={sector(r0, r1, bi * bin, (bi + 1) * bin)} className={styles.cell} data-kind={kindOf(v)} />;
        })}
        {[1, 2, 3].map((i) => (
          <circle key={i} r={radius(i * rb)} className={styles.ring} />
        ))}
        {Array.from({ length: 360 / bin }, (_, i) => {
          const [x, y] = polar(R_CELLS, i * bin);
          return <line key={i} x1={0} y1={0} x2={x} y2={y} className={styles.spoke} />;
        })}
        <text x={radius(2 * rb) + 2} y={-3} className={styles.ringLabel}>
          1.5 m
        </text>
        <text x={R_CELLS + 2} y={-3} className={styles.ringLabel}>
          3 m
        </text>
        <text x={0} y={-R_FAR - 4} textAnchor="middle" className={styles.ringLabel}>
          far
        </text>
        {views.map((v) => {
          const [x, y] = polar(radius(v.range), v.bearingDeg);
          const k = kindOf(v);
          const sel = v.frameId === selectedFrameId;
          return (
            <g key={`${v.frameId}-${v.bearingDeg}`} transform={`translate(${x},${y})`} className={styles.view} data-kind={k} data-counted={v.counted} data-selected={sel}>
              <line x1={0} y1={0} x2={-x} y2={-y} className={styles.ray} />
              {k === "vol" && <circle r={5} />}
              {k === "flat" && <rect x={-7} y={-2.5} width={14} height={5} transform={`rotate(${v.bearingDeg + 90})`} />}
              {k === "miss" && <circle r={4.5} className={styles.hollow} />}
              {k === "inc" && <rect x={-3.5} y={-3.5} width={7} height={7} transform="rotate(45)" className={styles.hollow} />}
              {sel && <circle r={9} className={styles.selRing} />}
            </g>
          );
        })}
        <rect x={-4} y={-4} width={8} height={8} className={styles.centre} />
        <text x={0} y={18} textAnchor="middle" className={styles.centreLabel}>
          {id}
        </text>
      </svg>
      <figcaption className={styles.legend}>
        <span data-kind="vol">
          <i /> volumetric {c.vol}
        </span>
        <span data-kind="flat">
          <i /> flat {c.flat}
        </span>
        <span data-kind="miss">
          <i /> not re-detected {c.miss}
        </span>
        <span data-kind="inc">
          <i /> inconclusive {c.inc}
        </span>
      </figcaption>
    </figure>
  );
}
