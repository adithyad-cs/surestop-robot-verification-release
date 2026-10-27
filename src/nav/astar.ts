import type { OccupancyGrid } from "./grid";

export interface Path {
  points: Array<{ x: number; z: number }>;
  length: number;
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(key: number, val: number) {
    this.keys.push(key);
    this.vals.push(val);
    let i = this.keys.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      [this.keys[p], this.keys[i]] = [this.keys[i], this.keys[p]];
      [this.vals[p], this.vals[i]] = [this.vals[i], this.vals[p]];
      i = p;
    }
  }
  pop(): number {
    const top = this.vals[0];
    const lk = this.keys.pop()!;
    const lv = this.vals.pop()!;
    if (this.keys.length) {
      this.keys[0] = lk;
      this.vals[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < this.keys.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.keys.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        [this.keys[m], this.keys[i]] = [this.keys[i], this.keys[m]];
        [this.vals[m], this.vals[i]] = [this.vals[i], this.vals[m]];
        i = m;
      }
    }
    return top;
  }
}

const SQRT2 = Math.SQRT2;
const NEIGHBOURS: Array<[number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

/** 8-connected A* on the inflated grid, followed by line-of-sight shortcutting. */
export function planPath(grid: OccupancyGrid, from: { x: number; z: number }, to: { x: number; z: number }): Path | null {
  const start = grid.nearestFree(from.x, from.z, 0.6);
  const goal = grid.nearestFree(to.x, to.z, 0.3);
  if (!start || !goal) return null;
  const [sc, sr] = grid.toCell(start.x, start.z);
  const [gc, gr] = grid.toCell(goal.x, goal.z);
  const W = grid.cols;
  const N = grid.cols * grid.rows;
  const g = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const s = sr * W + sc;
  const goalIdx = gr * W + gc;
  const h = (c: number, r: number) => {
    const dx = Math.abs(c - gc), dz = Math.abs(r - gr);
    return dx + dz + (SQRT2 - 2) * Math.min(dx, dz);
  };
  g[s] = 0;
  const open = new MinHeap();
  open.push(h(sc, sr), s);
  let found = false;
  while (open.size) {
    const cur = open.pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (cur === goalIdx) {
      found = true;
      break;
    }
    const c = cur % W, r = (cur - c) / W;
    for (const [dc, dr, cost] of NEIGHBOURS) {
      const nc = c + dc, nr = r + dr;
      if (!grid.inside(nc, nr)) continue;
      const ni = nr * W + nc;
      if (grid.blocked[ni] || closed[ni]) continue;
      if (dc && dr && (grid.blocked[r * W + nc] || grid.blocked[nr * W + c])) continue; // no corner cutting
      const ng = g[cur] + cost;
      if (ng < g[ni]) {
        g[ni] = ng;
        came[ni] = cur;
        open.push(ng + h(nc, nr), ni);
      }
    }
  }
  if (!found) return null;
  const cells: Array<{ x: number; z: number }> = [];
  for (let i = goalIdx; i !== -1; i = came[i]) {
    const c = i % W;
    cells.push(grid.cellCentre(c, (i - c) / W));
  }
  cells.reverse();
  cells[0] = start;
  cells[cells.length - 1] = goal;
  const points = shortcut(grid, cells);
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  return { points, length };
}

function shortcut(grid: OccupancyGrid, pts: Array<{ x: number; z: number }>): Array<{ x: number; z: number }> {
  if (pts.length <= 2) return pts;
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !grid.segmentFree(pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}
