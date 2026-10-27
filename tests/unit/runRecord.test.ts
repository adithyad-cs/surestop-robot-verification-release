// P1-e (and the record-level parts of P1-a/f/g): records written by ExperimentEngine.runOne, and
// backward compatibility with the committed historical records.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseVariant, type RunRecord } from "@/experiments/engine";
import { instantiateLayout } from "@/scenarios/generate";
import { runLayout, sameLayout } from "../../scripts/layout-records.mjs";
import { fakeEngine } from "./fixtures/fakeEngine";
import { recordedSummary } from "@/eval/recordedSummary";
import manifest from "@/provenance/artifact-manifest.json";
import { experimentToJson } from "@/eval/export";

const ROOT = path.resolve(__dirname, "../..");

describe("layout identity on new records (P1-e)", () => {
  it("every record written by runOne carries recordSchema and its layout, v1 included", async () => {
    const engine = fakeEngine();
    for (const layout of ["v1", "v2"] as const) {
      const r = await engine.runOne("poster-decoy", 3, parseVariant("surestop"), undefined, layout);
      expect(r.recordSchema).toBe("surestop.run-record/2");
      expect(r.layout).toEqual(expect.objectContaining({ version: layout, id: instantiateLayout("poster-decoy", 3, layout).layout.id }));
      expect(runLayout(r)).toMatchObject({ version: layout, id: r.layout!.id });
    }
  });

  it("the historical convention (absent layout = v1) applies only to pre-P1 records", () => {
    expect(runLayout({ result: { scenarioId: "a", seed: 1 }, variant: "x" })).toEqual({ version: "v1", id: null, fallback: false, valid: null });
    expect(() => runLayout({ recordSchema: "surestop.run-record/2", result: { scenarioId: "a", seed: 1 }, variant: "x" })).toThrow(/has no layout/);
    const v1 = { layout: { version: "v1", id: "v1-abc" } };
    expect(sameLayout({}, v1)).toBe(true);
    expect(sameLayout(v1, { layout: { version: "v1", id: "v1-def" } })).toBe(false);
    expect(sameLayout({}, { layout: { version: "v2", id: "v2-abc" } })).toBe(false);
  });
});

describe("backward compatibility with the committed historical records", () => {
  const read = (rel: string) => {
    const buf = fs.readFileSync(path.join(ROOT, rel));
    return JSON.parse((rel.endsWith(".gz") ? zlib.gunzipSync(buf) : buf).toString("utf8"));
  };

  it("historical files are pre-P1 and still read as before", () => {
    for (const rel of ["public/data/eval-runs.json", "docs/experiments/raw/calib2.json.gz", "docs/experiments/layout-v2-smoke/v2-matrix-b.json.gz"]) {
      const d = read(rel);
      for (const r of d.runs as RunRecord[]) {
        expect(r.recordSchema).toBeUndefined();
        expect(r.provenance).toBeUndefined();
        expect(() => runLayout(r)).not.toThrow();
      }
    }
    const s = recordedSummary();
    expect(s.trials).toBe(560);
    expect(s.rows.map((r) => r.all.completionRate.num)).toEqual([121, 83, 133, 140]);
  });

  it("compare-runs matches a P1 re-run with its historical record, ignoring only P1 fields, and still catches a changed decision", () => {
    const hist = read("public/data/eval-runs.json").runs.find((r: RunRecord) => r.variant === "surestop" && r.result.scenarioId === "poster-decoy" && r.result.seed === 1001);
    const p1 = structuredClone(hist);
    p1.recordSchema = "surestop.run-record/2";
    p1.layout = { version: "v1", id: "v1-0000", attempt: 0, fallback: false, valid: true, failedChecks: [] };
    p1.provenance = { schema: "surestop.run-provenance/1" };
    p1.result.terminal = { schema: "surestop.terminal/1", cause: "approach-complete", rule: "arrived-after-confirmation" };
    for (const t of p1.result.tracks) {
      t.decision.rule = "pending";
      for (const e of t.evidence) e.inputs = { schema: "surestop.view-inputs/1" };
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "surestop-cmp-"));
    const write = (n: string, runs: unknown[]) => {
      const f = path.join(tmp, n);
      fs.writeFileSync(f, JSON.stringify({ runs }));
      return f;
    };
    const cmp = (a: string, b: string) => spawnSync(process.execPath, [path.join(ROOT, "scripts/compare-runs.mjs"), a, b], { encoding: "utf8" });
    const ok = cmp(write("p1.json", [p1]), write("hist.json", [hist]));
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/identical apart from wall-clock timing and config: 1\/1/);
    expect(ok.stdout).toMatch(/1 pair\(s\) compare a P1 record with a historical one/);
    const changed = structuredClone(p1);
    changed.result.tracks[0].decision.status = "UNCONFIRMED";
    const bad = cmp(write("changed.json", [changed]), write("hist2.json", [hist]));
    expect(bad.status).toBe(1);
    expect(bad.stdout).toMatch(/differing runs/);
  });
});

describe("evaluator-only object and asset provenance (P1-f)", () => {
  it("records each placed object with its asset file hash from the manifest and lineage 'unknown'", async () => {
    const r = await fakeEngine().runOne("lookalike-3d", 4, parseVariant("surestop"), undefined, "v1");
    expect(r.objects!.schema).toBe("surestop.evaluator-objects/1");
    const by = new Map(r.objects!.objects.map((o) => [o.objectId, o]));
    const sha = (url: string) => manifest.assets.files.find((f) => f.path === url)!.sha256;
    expect(by.get("vase")).toEqual({ objectId: "vase", kind: "lookalike", label: "vase with flowers", model: "asset", assetId: "vaseFlowers", assetFile: "/assets/models/GlassVaseFlowers.glb", assetSha256: sha("/assets/models/GlassVaseFlowers.glb"), derivation: "glb-as-shipped", lineage: "unknown" });
    expect(by.get("plant")).toMatchObject({ kind: "target", assetId: "plant", assetSha256: sha("/assets/models/DiffuseTransmissionPlant.glb"), lineage: "unknown" });
    expect(by.get("crate-w")).toMatchObject({ model: "box", assetId: null, assetSha256: null, derivation: "procedural-box", lineage: "unknown" });
    expect(r.objects!.objects.map((o) => o.objectId)).toEqual(instantiateLayout("lookalike-3d", 4, "v1").objects.map((o) => o.id));
    const poster = (await fakeEngine().runOne("poster-decoy", 4, parseVariant("surestop"), undefined, "v1")).objects!.objects.find((o) => o.kind === "picture-decoy")!;
    expect(poster).toMatchObject({ model: "poster", assetId: "plant", derivation: "runtime-render-of-asset", lineage: "unknown" });
    expect(new Set(r.objects!.objects.map((o) => o.lineage))).toEqual(new Set(["unknown"]));
  });
});

describe("Lab JSON export keeps P1 fields", () => {
  it("experimentToJson writes provenance, layout and objects of new records, and historical runs unchanged", async () => {
    const r = await fakeEngine().runOne("clear-target", 1, parseVariant("surestop"));
    const out = JSON.parse(experimentToJson([r], "test"));
    expect(out.runs[0].recordSchema).toBe("surestop.run-record/2");
    expect(out.runs[0].provenance.missionConfigHash).toBe(r.provenance!.missionConfigHash);
    expect(out.runs[0].layout).toEqual(r.layout);
    expect(out.runs[0].objects).toEqual(r.objects);
  });
});
