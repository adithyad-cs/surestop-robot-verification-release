// Phase 2 hardening: URL rules, layout records and fallback consistency, mission export,
// the shared line-of-sight/occlusion model, grid comparison, and layout-aware batch scripts.
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseConsoleParams, LEGACY_LAYOUT_NOTICE } from "@/console/params";
import { buildMissionExport, missionExportFilename } from "@/console/exportMission";
import { generateLayout, instantiateLayout, layoutRecord, layoutSummary, parseLayoutParam } from "@/scenarios/generate";
import { buildPriorGrid, buildSightGrid, compareGrids, objectVisible, validateInstance } from "@/scenarios/validate";
import type { LayoutInfo, PlacedObject, ScenarioInstance } from "@/scenarios/layout";
import type { MissionResult } from "@/mission/types";
import type { TrialScore } from "@/eval/evaluate";

const ROOT = path.resolve(__dirname, "../..");

describe("Mission Control URL rules", () => {
  it("fresh visit → v2", () => {
    for (const q of ["", "?", "?backend=wasm"]) {
      const p = parseConsoleParams(q);
      expect(p.layout).toBe("v2");
      expect(p.layoutSource).toBe("default");
      expect(p.layoutNotice).toBeNull();
      expect(p.layoutError).toBeNull();
    }
  });

  it("legacy replay links (scenario/seed/method, no layout) → v1 with a notice, never v2", () => {
    for (const q of ["?scenario=photo-board-decoy&seed=1001&method=surestop", "?scenario=poster-decoy", "?seed=7", "?method=persistence"]) {
      const p = parseConsoleParams(q);
      expect(p.layout, q).toBe("v1");
      expect(p.layoutSource).toBe("legacy");
      expect(p.layoutNotice).toBe(LEGACY_LAYOUT_NOTICE);
    }
    const p = parseConsoleParams("?scenario=photo-board-decoy&seed=1001&method=surestop");
    expect([p.scenario, p.seed, p.method]).toEqual(["photo-board-decoy", 1001, "surestop"]);
  });

  it("explicit layout=v1 and layout=v2 are honoured, with or without other parameters", () => {
    expect(parseConsoleParams("?layout=v1").layout).toBe("v1");
    expect(parseConsoleParams("?layout=v2").layout).toBe("v2");
    expect(parseConsoleParams("?scenario=clear-target&seed=3&layout=v2").layout).toBe("v2");
    expect(parseConsoleParams("?scenario=clear-target&seed=3&layout=v1").layout).toBe("v1");
    expect(parseConsoleParams("?layout=v2").layoutSource).toBe("explicit");
  });

  it("unknown layout values are rejected, not mapped to a version", () => {
    for (const q of ["?layout=v3", "?layout=V2", "?layout=", "?layout=1", "?scenario=clear-target&seed=1&layout=legacy"]) {
      const p = parseConsoleParams(q);
      expect(p.layout, q).toBeNull();
      expect(p.layoutError).toMatch(/Unknown world layout/);
    }
  });

  it("diagnostics parameter: absent → v1 (documented batch default), unknown → error", () => {
    expect(parseLayoutParam(null, "v1")).toEqual({ layout: "v1", error: null });
    expect(parseLayoutParam("v2", "v1")).toEqual({ layout: "v2", error: null });
    expect(parseLayoutParam("v9", "v1").layout).toBeNull();
    expect(parseLayoutParam("", "v1").layout).toBeNull();
  });
});

describe("layout records and fallback consistency", () => {
  it("a validated v2 layout records id, fallback=false and valid=true consistently", () => {
    const g = generateLayout("poster-decoy", 17);
    const rec = layoutRecord(g.layout);
    expect(rec).toMatchObject({ version: "v2", fallback: false, valid: true, failedChecks: [] });
    expect(rec.id).toMatch(/^v2-[0-9a-f]{8}$/);
    expect(g.report.ok).toBe(true);
    expect(layoutSummary(g)).toMatch(/validated/);
    expect(layoutSummary(g)).not.toMatch(/FALLBACK/);
  });

  it("a forced fallback is flagged in id, flag, summary and validation status, never as a validated v2 layout", () => {
    for (const [scenario, seed] of [["clear-target", 3], ["decoys-only", 1001], ["occluded-target", 0]] as const) {
      const g = generateLayout(scenario, seed, { maxAttempts: 0 });
      const rec = layoutRecord(g.layout);
      expect(rec.fallback).toBe(true);
      expect(rec.id).toMatch(/^v2-fallback-[0-9a-f]{8}$/);
      // Validity is the fallback (v1) layout's own result, not assumed.
      expect(rec.valid).toBe(g.report.ok);
      expect(rec.failedChecks).toEqual(g.report.checks.filter((c) => !c.pass).map((c) => c.name));
      expect(layoutSummary(g)).toMatch(/FALLBACK/);
      // The fallback is the v1 layout of the same seed.
      expect(g.objects).toEqual(instantiateLayout(scenario, seed, "v1").objects);
    }
    // A forced fallback whose v1 layout fails validation (decoys-only seed 1: the pouf blocks waypoint 8)
    // is recorded as invalid, not passed off as validated.
    const bad = layoutRecord(generateLayout("decoys-only", 1, { maxAttempts: 0 }).layout);
    expect(bad.valid).toBe(false);
    expect(bad.failedChecks).toContain("waypoints-free");
  });

  it("layoutRecord refuses contradictory layout info", () => {
    const ok: LayoutInfo = { version: "v2", id: "v2-0000abcd", attempt: 0, fallback: false, valid: true, failedChecks: [], zones: {} };
    expect(() => layoutRecord({ ...ok, fallback: true })).toThrow(/disagree/);
    expect(() => layoutRecord({ ...ok, id: "v2-fallback-0000abcd" })).toThrow(/disagree/);
    expect(() => layoutRecord({ ...ok, valid: false })).toThrow(/invalid/);
    expect(() => layoutRecord({ ...ok, id: "v2-fallback-0000abcd", fallback: true, valid: false })).not.toThrow();
  });

  it("v1 instances carry their own validation result", () => {
    const v1 = instantiateLayout("decoys-only", 1001, "v1");
    expect(v1.layout.valid).toBe(validateInstance(v1).ok);
    expect(v1.layout.fallback).toBe(false);
  });
});

describe("mission export", () => {
  const fakeResult = (scenarioId: string, seed: number) => ({ scenarioId, seed }) as unknown as MissionResult;
  const fakeScore = {} as TrialScore;

  it("exports the same layout record for a valid v2 layout and a fallback", () => {
    for (const g of [generateLayout("screen-decoy", 2), generateLayout("screen-decoy", 2, { maxAttempts: 0 })]) {
      const rec = layoutRecord(g.layout);
      const e = buildMissionExport({ scenarioId: "screen-decoy", seed: 2, method: "surestop", layoutRecord: rec, layoutZones: g.layout.zones, result: fakeResult("screen-decoy", 2), score: fakeScore });
      expect(e.layout).toEqual(rec);
      expect(missionExportFilename(e)).toContain(rec.id);
      expect(e.layout.fallback).toBe(rec.id.startsWith("v2-fallback-"));
    }
  });

  it("refuses to export a mission that does not match the selected scenario/seed or has no layout", () => {
    const rec = layoutRecord(generateLayout("screen-decoy", 2).layout);
    const base = { scenarioId: "screen-decoy", seed: 2, method: "surestop", layoutRecord: rec, layoutZones: null, score: fakeScore };
    expect(() => buildMissionExport({ ...base, result: fakeResult("screen-decoy", 3) })).toThrow(/does not match/);
    expect(() => buildMissionExport({ ...base, layoutRecord: null, result: fakeResult("screen-decoy", 2) })).toThrow(/no layout record/);
    expect(() => buildMissionExport({ ...base, result: null })).toThrow(/no finished mission/);
  });
});

describe("one line-of-sight model for observability and occlusion", () => {
  const plant: PlacedObject = { id: "plant", kind: "target", label: "plant", model: { type: "asset", assetId: "plant" }, x: 3.0, z: 0, yaw: 0.6 };
  const crate = (x: number): PlacedObject => ({ id: "crate", kind: "obstacle", label: "crate", model: { type: "box", w: 0.9, h: 0.8, d: 0.5, color: 0 }, x, z: 0, yaw: Math.PI / 2 });
  const from = { x: 0.5, z: 0 };

  it("an object never hides itself", () => {
    expect(objectVisible(buildSightGrid([plant], [plant]), from, plant)).toBe(true);
  });

  it("an occluder close to the target blocks it (the old own-radius allowance ignored it)", () => {
    // Crate face 0.45 m in front of the plant centre: inside the old 0.6–0.8 m allowance.
    const c = crate(2.3);
    expect(objectVisible(buildSightGrid([plant, c], [plant]), from, plant)).toBe(false);
    expect(objectVisible(buildSightGrid([plant, c], [plant, c]), from, plant)).toBe(true);
  });

  it("the occluded-target semantic check uses the same model: moving the crate out of the line breaks it", () => {
    const g = generateLayout("occluded-target", 0);
    expect(g.report.checks.find((c) => c.name === "scenario-semantics")!.pass).toBe(true);
    const moved: ScenarioInstance = { ...g, objects: g.objects.map((o) => (o.id === "crate-occ" ? { ...o, x: -2.0, z: 3.5 } : o)) };
    const r = validateInstance(moved);
    expect(r.checks.find((c) => c.name === "scenario-semantics")!.detail).toMatch(/does not occlude/);
  });

  it("a wall print is visible from in front of its wall", () => {
    const poster: PlacedObject = { id: "p", kind: "picture-decoy", label: "print", model: { type: "poster", ofAsset: "plant", width: 0.6, height: 0.8 }, x: -3.9, z: -4.878, yaw: 0, y: 1.15 };
    expect(objectVisible(buildSightGrid([poster], [poster]), { x: -3.9, z: -2.5 }, poster)).toBe(true);
  });
});

describe("grid comparison", () => {
  it("identical maps agree; an extra obstacle is reported with its distance", () => {
    const g = generateLayout("clear-target", 5);
    const a = buildPriorGrid(g.objects);
    expect(compareGrids(a, buildPriorGrid(g.objects))).toMatchObject({ analyticOnly: 0, worldOnly: 0, blockedWorldOnly: 0 });
    const extra: PlacedObject = { id: "x", kind: "obstacle", label: "x", model: { type: "box", w: 0.4, h: 0.4, d: 0.4, color: 0 }, x: 0.6, z: -4.2, yaw: 0 };
    const b = buildPriorGrid([...g.objects, extra]);
    const c = compareGrids(a, b);
    expect(c.worldOnly).toBeGreaterThan(0);
    expect(c.worldOnlyMaxDistCells).toBeGreaterThan(1);
  });
});

describe("layout-aware batch scripts", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "surestop-layout-"));
  const detector = { name: "coco-ssd", packageVersion: "2.2.3", tfjsVersion: "x", base: "lite_mobilenet_v2", backend: "wasm" };
  const run = (seed: number, layout?: object) => ({
    variant: "surestop",
    result: { scenarioId: "clear-target", seed, method: "surestop", outcome: "ARRIVED", frames: [], config: {} },
    score: { correctArrival: true },
    ...(layout ? { layout } : {}),
  });
  const v2 = { version: "v2", id: "v2-1234abcd", attempt: 0, fallback: false, valid: true, failedChecks: [] };
  const write = (name: string, runs: object[]) => {
    const f = path.join(tmp, name);
    fs.writeFileSync(f, JSON.stringify({ runs, detector, backend: { backend: "wasm", reason: "", glRenderer: null }, wallMs: 1 }));
    return f;
  };
  const node = (script: string, args: string[]) => spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...args], { encoding: "utf8" });

  it("merge-batches refuses to mix v1 and v2 runs and accepts a single-layout set", () => {
    const a = write("a.json", [run(1)]);
    const b = write("b.json", [run(2, v2)]);
    const mixed = node("merge-batches.mjs", [path.join(tmp, "m.json"), a, b]);
    expect(mixed.status).not.toBe(0);
    expect(mixed.stderr).toMatch(/mix world layouts/);
    expect(fs.existsSync(path.join(tmp, "m.json"))).toBe(false);
    const ok = node("merge-batches.mjs", [path.join(tmp, "ok.json"), a, write("c.json", [run(3)])]);
    expect(ok.status).toBe(0);
  });

  it("compare-runs reports a layout mismatch for the same scenario/seed/variant and exits 1", () => {
    const a = write("ca.json", [run(1, v2)]);
    const b = write("cb.json", [run(1)]);
    const r = node("compare-runs.mjs", [a, b]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/LAYOUT MISMATCH/);
    expect(r.stdout).toMatch(/v2:v2-1234abcd vs v1:-/);
    const same = node("compare-runs.mjs", [b, write("cc.json", [run(1)])]);
    expect(same.status).toBe(0);
    expect(same.stdout).toMatch(/identical apart from wall-clock timing and config: 1\/1/);
  });

  it("aggregate refuses v2 runs for the recorded protocol", () => {
    const f = write("agg.json", [run(1, v2)]);
    let err = "";
    try {
      execFileSync("npm", ["run", "-s", "aggregate", "--", "evaluation", f, path.join(tmp, "out-eval-runs.json")], { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      err = String((e as { stderr?: string }).stderr ?? e);
    }
    expect(err).toMatch(/refusing to aggregate/);
    expect(fs.existsSync(path.join(tmp, "out-eval-runs.json"))).toBe(false);
  }, 60_000);
});

describe("mission export provenance (P1)", () => {
  it("schema /3 always carries provenance and objects, null when not supplied", () => {
    const rec = layoutRecord(generateLayout("screen-decoy", 2).layout);
    const e = buildMissionExport({ scenarioId: "screen-decoy", seed: 2, method: "surestop", layoutRecord: rec, layoutZones: null, result: { scenarioId: "screen-decoy", seed: 2 } as unknown as MissionResult, score: {} as TrialScore });
    expect(e.schema).toBe("surestop.console-mission/3");
    expect(e.provenance).toBeNull();
    expect(e.objects).toBeNull();
  });
});
