// Seeded world layouts: determinism, variation, physical validity, real-A* feasibility, scenario
// semantics, and the guarantee that the recorded (v1) layout is unchanged.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SCENARIOS, instantiate, type PlacedObject } from "@/scenarios/layout";
import { generateLayout, instantiateLayout, layoutHash, layoutSummary, MAX_ATTEMPTS } from "@/scenarios/generate";
import { buildPriorGrid, isSemantic, posterSpan, rectGap, simulateSearch, validateInstance, worldFootprint } from "@/scenarios/validate";
import { planPath } from "@/nav/astar";
import { ROUTE } from "@/scenarios/layout";

const TEST_SEEDS = [0, 1, 2, 17, 42, 123];
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/layout-v1-golden.json"), "utf8")) as Record<string, unknown>;

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

describe("v1 (recorded-evaluation) layout is unchanged", () => {
  it("matches the golden snapshot taken before layout v2 existed, for every scenario", () => {
    const keys = Object.keys(golden);
    expect(keys.length).toBe(SCENARIOS.length * 8);
    for (const key of keys) {
      const [id, seed] = key.split(":");
      const i = instantiate(id, Number(seed));
      expect({ objects: i.objects, start: i.start, lightScale: i.lightScale, sunAzimuthDeg: i.sunAzimuthDeg }, key).toEqual(golden[key]);
      const v1 = instantiateLayout(id, Number(seed), "v1");
      expect(v1.objects, key).toEqual(i.objects);
      expect(v1.start, key).toEqual(i.start);
      expect(v1.layout.version).toBe("v1");
    }
  });

  it("instantiateLayout defaults to v1, the layout the engine batch and Lab use", () => {
    expect(instantiateLayout("poster-decoy", 1001).layout.version).toBe("v1");
  });
});

describe("layout v2: every scenario × test seeds", () => {
  // Scenarios are discovered from the catalogue, so a new scenario is covered automatically.
  for (const s of SCENARIOS) {
    describe(s.id, () => {
      const layouts = TEST_SEEDS.map((seed) => generateLayout(s.id, seed));

      it("is deterministic: same scenario and seed → identical layout and id", () => {
        for (const [k, seed] of TEST_SEEDS.entries()) {
          const again = generateLayout(s.id, seed);
          expect(again.objects).toEqual(layouts[k].objects);
          expect(again.start).toEqual(layouts[k].start);
          expect(again.lightScale).toBe(layouts[k].lightScale);
          expect(again.layout).toEqual(layouts[k].layout);
        }
      });

      it("produces a validated layout for every test seed (no fallback)", () => {
        for (const g of layouts) {
          expect(g.layout.fallback, `${g.layout.id} rejected: ${g.rejected.join("; ")}`).toBe(false);
          expect(g.layout.attempt).toBeLessThan(MAX_ATTEMPTS);
          const failed = g.report.checks.filter((c) => !c.pass);
          expect(failed, JSON.stringify(failed)).toEqual([]);
        }
      });

      it("keeps the scenario's object set, kinds, labels and models; only poses change", () => {
        for (const g of layouts) {
          const v1 = instantiate(s.id, g.seed);
          const sig = (o: PlacedObject) => `${o.id}|${o.kind}|${o.label}|${JSON.stringify(o.model)}`;
          expect(g.objects.map(sig)).toEqual(v1.objects.map(sig));
          expect(g.objects.filter((o) => o.kind === "target").length).toBe(s.targetPresent ? 1 : 0);
        }
      });

      it("seeds 0 and 17 differ materially (v1, the baseline, does not)", () => {
        const a = layouts[TEST_SEEDS.indexOf(0)], b = layouts[TEST_SEEDS.indexOf(17)];
        expect(a.layout.id).not.toBe(b.layout.id);
        const moved = a.objects.map((o, i) => dist(o, b.objects[i]));
        const mean = moved.reduce((x, y) => x + y, 0) / moved.length;
        // Whole layout: objects move ≥ 1 m on average and at least one moves ≥ 2 m (another wall/zone).
        expect(mean).toBeGreaterThanOrEqual(1.0);
        expect(Math.max(...moved)).toBeGreaterThanOrEqual(2.0);
        // A scenario-defining object (target, decoy, look-alike) moves ≥ 0.5 m.
        expect(Math.max(...a.objects.map((o, i) => (isSemantic(o) ? moved[i] : 0)))).toBeGreaterThanOrEqual(0.5);
        // The robot starts somewhere else or facing elsewhere.
        expect(dist(a.start, b.start) >= 0.5 || Math.abs(Math.atan2(Math.sin(a.start.theta - b.start.theta), Math.cos(a.start.theta - b.start.theta))) >= Math.PI / 6).toBe(true);
        // The same criterion applied to the recorded v1 layout fails: v1 seeds only jitter objects.
        const a1 = instantiate(s.id, 0), b1 = instantiate(s.id, 17);
        const moved1 = a1.objects.map((o, i) => dist(o, b1.objects[i]));
        expect(moved1.reduce((x, y) => x + y, 0) / moved1.length).toBeLessThan(1.0);
      });

      it("gives each test seed a distinct layout id", () => {
        expect(new Set(layouts.map((g) => g.layout.id)).size).toBe(TEST_SEEDS.length);
      });

      it("differs from the v1 layout of the same seed", () => {
        for (const g of layouts) expect(g.layout.id.slice(3)).not.toBe(layoutHash(instantiate(s.id, g.seed)));
      });

      it("geometry: inside the rooms, no overlaps, nothing in the doorway", () => {
        for (const g of layouts) {
          const floor = g.objects.map((o) => ({ o, f: worldFootprint(o) })).filter((x) => x.f);
          for (const { o, f } of floor) {
            expect(f!.minX, o.id).toBeGreaterThan(-6.88);
            expect(f!.maxX, o.id).toBeLessThan(6.88);
            expect(f!.minZ, o.id).toBeGreaterThan(-4.88);
            expect(f!.maxZ, o.id).toBeLessThan(4.88);
            // One room only: never across the interior wall at x = 0.
            expect(f!.maxX < -0.06 || f!.minX > 0.06, o.id).toBe(true);
          }
          for (let i = 0; i < floor.length; i++) for (let j = i + 1; j < floor.length; j++) expect(rectGap(floor[i].f!, floor[j].f!)).toBeGreaterThan(0.05);
          for (const o of g.objects.filter((x) => x.model.type === "poster")) {
            // Centre on a wall face: north/south (z = ∓4.878), west (x = −6.878) or the interior wall's west face (x = −0.062).
            const onWall = Math.abs(o.z + 4.878) < 0.01 || Math.abs(o.z - 4.878) < 0.01 || Math.abs(o.x + 6.878) < 0.01 || Math.abs(o.x + 0.062) < 0.01;
            expect(posterSpan(o)).not.toBeNull();
            expect(onWall, `${o.id} on a wall face`).toBe(true);
          }
        }
      });

      it("navigation (real A*): start free, every route waypoint reachable in order, target approachable", () => {
        for (const g of layouts) {
          const grid = buildPriorGrid(g.objects);
          expect(grid.isFree(g.start.x, g.start.z)).toBe(true);
          let at = { x: g.start.x, z: g.start.z };
          for (const [i, wp] of ROUTE.entries()) {
            const p = planPath(grid, at, wp);
            expect(p, `${g.layout.id}: waypoint ${i}`).not.toBeNull();
            at = p!.points[p!.points.length - 1];
          }
          const sim = simulateSearch(grid, g.start);
          expect(sim.failedLeg).toBeNull();
          const target = g.objects.find((o) => o.kind === "target");
          if (target) expect(g.report.checks.find((c) => c.name === "target-approachable")!.pass).toBe(true);
        }
      });

      it("semantics: decoys and look-alikes are met before the target; occluder hides the first view", () => {
        for (const g of layouts) {
          const r = g.report;
          const t = r.objects.find((o) => o.kind === "target");
          for (const o of r.objects) expect(o.firstSeenIndex, `${g.layout.id}: ${o.id} observable`).not.toBeNull();
          if (t && s.difficulty !== "baseline") for (const d of r.objects.filter((o) => o.kind !== "target")) expect(d.firstSeenIndex!).toBeLessThan(t.firstSeenIndex!);
          expect(r.checks.find((c) => c.name === "scenario-semantics")!.pass).toBe(true);
          // Decoys stay in the west room, the target in the east room (the scenario summaries say so).
          for (const o of g.objects) {
            if (o.kind === "target") expect(o.x).toBeGreaterThan(0);
            if (o.kind === "picture-decoy" || o.kind === "screen-decoy" || o.kind === "lookalike") expect(o.x).toBeLessThan(0);
          }
        }
      });
    });
  }

  it("seed change does not disturb another scenario's layout (independent streams)", () => {
    const a = generateLayout("poster-decoy", 5);
    generateLayout("clear-target", 6);
    expect(generateLayout("poster-decoy", 5).objects).toEqual(a.objects);
  });

  it("rejects bad input", () => {
    expect(() => generateLayout("nope", 1)).toThrow(/unknown scenario/);
    expect(() => generateLayout("clear-target", -1)).toThrow(/invalid seed/);
    expect(() => generateLayout("clear-target", 1.5)).toThrow(/invalid seed/);
  });

  it("the pre-mission summary names no object or zone", () => {
    for (const s of SCENARIOS) {
      const inst = instantiateLayout(s.id, 17, "v2");
      const text = layoutSummary(inst);
      for (const o of inst.objects) expect(text).not.toContain(o.id);
      for (const z of Object.values(inst.layout.zones)) expect(text).not.toContain(z);
      expect(text).not.toMatch(/plant|poster|screen|board|vase|east|west/i);
    }
  });
});

describe("layout v2: broader sweep", () => {
  it("seeds 0–199 of every scenario validate without fallback", () => {
    const fallbacks: string[] = [];
    for (const s of SCENARIOS) {
      for (let seed = 0; seed < 200; seed++) {
        const g = generateLayout(s.id, seed);
        if (g.layout.fallback || !g.report.ok) fallbacks.push(`${s.id}:${seed}`);
      }
    }
    expect(fallbacks).toEqual([]);
  }, 120_000);
});

describe("validator", () => {
  it("catches an object placed on the route, an overlap and a blocked start", () => {
    const g = generateLayout("clear-target", 3);
    const plant = g.objects.find((o) => o.kind === "target")!;
    const bad = { ...g, objects: g.objects.map((o) => (o === plant ? { ...o, x: ROUTE[6].x, z: ROUTE[6].z } : o)) };
    const r = validateInstance(bad);
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.name === "waypoints-free")!.pass).toBe(false);
    const sofa = g.objects.find((o) => o.id === "sofa")!;
    const overlap = { ...g, objects: g.objects.map((o) => (o.id === "chair-a" ? { ...o, x: sofa.x, z: sofa.z } : o)) };
    expect(validateInstance(overlap).checks.find((c) => c.name === "no-overlap")!.pass).toBe(false);
    const blocked = { ...g, start: { x: sofa.x, z: sofa.z, theta: 0 } };
    expect(validateInstance(blocked).checks.find((c) => c.name === "start-free")!.pass).toBe(false);
  });

  it("flags a decoys-only layout that contains a target", () => {
    const g = generateLayout("decoys-only", 4);
    const withTarget = { ...g, objects: [...g.objects, { id: "plant", kind: "target" as const, label: "plant", model: { type: "asset" as const, assetId: "plant" }, x: 3.4, z: 0.8, yaw: 0 }] };
    expect(validateInstance(withTarget).checks.find((c) => c.name === "scenario-semantics")!.pass).toBe(false);
  });
});
