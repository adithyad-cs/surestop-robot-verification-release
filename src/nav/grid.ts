// 2-D occupancy grid used by navigation (a prior map, as a pre-built SLAM map would be).
// It stores only free/occupied cells, never object identities. The verifier never reads it.

export interface Rect {
  /** Axis-aligned footprint in world XZ (metres). */
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export class OccupancyGrid {
  readonly cols: number;
  readonly rows: number;
  /** 1 = occupied (raw obstacles). */
  readonly occ: Uint8Array;
  /** 1 = not traversable for the robot centre (obstacles inflated by robot radius). */
  readonly blocked: Uint8Array;

  constructor(
    readonly bounds: Rect,
    readonly res: number,
  ) {
    this.cols = Math.ceil((bounds.maxX - bounds.minX) / res);
    this.rows = Math.ceil((bounds.maxZ - bounds.minZ) / res);
    this.occ = new Uint8Array(this.cols * this.rows);
    this.blocked = new Uint8Array(this.cols * this.rows);
  }

  toCell(x: number, z: number): [number, number] {
    return [Math.floor((x - this.bounds.minX) / this.res), Math.floor((z - this.bounds.minZ) / this.res)];
  }

  cellCentre(c: number, r: number): { x: number; z: number } {
    return { x: this.bounds.minX + (c + 0.5) * this.res, z: this.bounds.minZ + (r + 0.5) * this.res };
  }

  inside(c: number, r: number): boolean {
    return c >= 0 && r >= 0 && c < this.cols && r < this.rows;
  }

  addRect(rect: Rect): void {
    const [c0, r0] = this.toCell(rect.minX, rect.minZ);
    const [c1, r1] = this.toCell(rect.maxX - 1e-9, rect.maxZ - 1e-9);
    for (let r = Math.max(0, r0); r <= Math.min(this.rows - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(this.cols - 1, c1); c++) this.occ[r * this.cols + c] = 1;
    }
  }

  /** Recomputes the traversability mask by inflating obstacles with a disc of `radius` metres. */
  inflate(radius: number): void {
    this.blocked.fill(0);
    const k = Math.ceil(radius / this.res);
    const offsets: Array<[number, number]> = [];
    for (let dr = -k; dr <= k; dr++) {
      for (let dc = -k; dc <= k; dc++) if (Math.hypot(dc, dr) * this.res <= radius + 1e-9) offsets.push([dc, dr]);
    }
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!this.occ[r * this.cols + c]) continue;
        for (const [dc, dr] of offsets) {
          const cc = c + dc, rr = r + dr;
          if (this.inside(cc, rr)) this.blocked[rr * this.cols + cc] = 1;
        }
      }
    }
  }

  isFree(x: number, z: number): boolean {
    const [c, r] = this.toCell(x, z);
    return this.inside(c, r) && !this.blocked[r * this.cols + c];
  }

  isOccupied(x: number, z: number): boolean {
    const [c, r] = this.toCell(x, z);
    return !this.inside(c, r) || !!this.occ[r * this.cols + c];
  }

  /**
   * True if the straight segment a→b crosses no raw obstacle cell, ignoring the final
   * `stopShort` metres (so the target's own footprint does not block the view of it).
   */
  lineOfSight(a: { x: number; z: number }, b: { x: number; z: number }, stopShort = 0): boolean {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const usable = len - stopShort;
    if (usable <= 0) return true;
    const steps = Math.ceil(usable / (this.res * 0.5));
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps) * (usable / len);
      if (this.isOccupied(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  }

  /** Traversable segment for the robot centre (uses the inflated mask). */
  segmentFree(a: { x: number; z: number }, b: { x: number; z: number }): boolean {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(len / (this.res * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!this.isFree(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  }

  /** Nearest free cell centre to (x, z) within maxDist, or null. */
  nearestFree(x: number, z: number, maxDist = 1.5): { x: number; z: number } | null {
    if (this.isFree(x, z)) return { x, z };
    const [c0, r0] = this.toCell(x, z);
    const k = Math.ceil(maxDist / this.res);
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    for (let dr = -k; dr <= k; dr++) {
      for (let dc = -k; dc <= k; dc++) {
        const c = c0 + dc, r = r0 + dr;
        if (!this.inside(c, r) || this.blocked[r * this.cols + c]) continue;
        const p = this.cellCentre(c, r);
        const d = Math.hypot(p.x - x, p.z - z);
        if (d < bestD && d <= maxDist) {
          bestD = d;
          best = p;
        }
      }
    }
    return best;
  }
}
