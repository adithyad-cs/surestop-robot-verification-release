import { describe, expect, it } from "vitest";
import { OccupancyGrid } from "@/nav/grid";
import { planPath } from "@/nav/astar";

function room(): OccupancyGrid {
  const g = new OccupancyGrid({ minX: -5, minZ: -5, maxX: 5, maxZ: 5 }, 0.1);
  // Outer walls.
  g.addRect({ minX: -5, minZ: -5, maxX: 5, maxZ: -4.9 });
  g.addRect({ minX: -5, minZ: 4.9, maxX: 5, maxZ: 5 });
  g.addRect({ minX: -5, minZ: -5, maxX: -4.9, maxZ: 5 });
  g.addRect({ minX: 4.9, minZ: -5, maxX: 5, maxZ: 5 });
  // Interior wall at x = 0 with a doorway at z in [2, 3.2].
  g.addRect({ minX: -0.05, minZ: -5, maxX: 0.05, maxZ: 2 });
  g.addRect({ minX: -0.05, minZ: 3.2, maxX: 0.05, maxZ: 5 });
  g.inflate(0.3);
  return g;
}

describe("OccupancyGrid", () => {
  it("inflates obstacles by the robot radius", () => {
    const g = room();
    expect(g.isFree(-2, 0)).toBe(true);
    expect(g.isFree(-0.2, 0)).toBe(false);
    expect(g.isOccupied(0, 0)).toBe(true);
    expect(g.isOccupied(-0.2, 0)).toBe(false);
  });
  it("checks line of sight against raw obstacles", () => {
    const g = room();
    expect(g.lineOfSight({ x: -2, z: 0 }, { x: 2, z: 0 })).toBe(false);
    expect(g.lineOfSight({ x: -2, z: 2.6 }, { x: 2, z: 2.6 })).toBe(true);
    expect(g.lineOfSight({ x: -2, z: 0 }, { x: -0.2, z: 0 }, 0)).toBe(true);
  });
  it("finds the nearest free cell", () => {
    const g = room();
    const p = g.nearestFree(-0.1, 0)!;
    expect(g.isFree(p.x, p.z)).toBe(true);
    expect(Math.abs(p.x + 0.1)).toBeLessThan(0.5);
  });
});

describe("planPath", () => {
  it("routes through the doorway and keeps every segment collision-free", () => {
    const g = room();
    const path = planPath(g, { x: -3, z: -3 }, { x: 3, z: -3 })!;
    expect(path).not.toBeNull();
    expect(path.points.some((p) => p.z > 2 && p.z < 3.2 && Math.abs(p.x) < 0.6)).toBe(true);
    for (let i = 1; i < path.points.length; i++) expect(g.segmentFree(path.points[i - 1], path.points[i])).toBe(true);
    expect(path.length).toBeGreaterThan(12);
  });
  it("returns a straight path when unobstructed", () => {
    const g = room();
    const path = planPath(g, { x: -3, z: -3 }, { x: -3, z: 3 })!;
    expect(path.points).toHaveLength(2);
    expect(path.length).toBeCloseTo(6, 1);
  });
  it("returns null when the goal is enclosed", () => {
    const g = room();
    g.addRect({ minX: 2, minZ: -2, maxX: 4, maxZ: -1.9 });
    g.addRect({ minX: 2, minZ: 0, maxX: 4, maxZ: 0.1 });
    g.addRect({ minX: 2, minZ: -2, maxX: 2.1, maxZ: 0.1 });
    g.addRect({ minX: 3.9, minZ: -2, maxX: 4, maxZ: 0.1 });
    g.inflate(0.3);
    expect(planPath(g, { x: -3, z: -3 }, { x: 3, z: -1 })).toBeNull();
  });
});
