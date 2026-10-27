// P1-a: batch merging keeps within-protocol variant differences and refuses silent pooling of
// different sources, artifacts, runtimes or protocols. P1-b: aggregate reports only measured values.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkMergeCompatibility, classify } from "../../scripts/batch-compat.mjs";

const ROOT = path.resolve(__dirname, "../..");
const H = (c: string) => c.repeat(64);
const build = { schema: "surestop.build-meta/1", source: "git", sourceCommit: "c".repeat(40), sourceDirty: false, dirtyFingerprint: null, buildId: "c".repeat(40), mode: "production", unavailableReason: null };
const artifacts = { manifestSchema: "surestop.artifact-manifest/1", detectorSha256: H("d"), runtimeSha256: H("e"), assetsSha256: H("f") };
const runtime = { userAgent: "Mozilla/5.0 Test", hardwareConcurrency: 4, tfBackend: "wasm", backendReason: "x", glRenderer: "g", detector: { name: "coco-ssd", packageVersion: "2.2.3", tfjsVersion: "4.22.0", base: "lite_mobilenet_v2", backend: "wasm", loadMs: 1 }, unavailable: [] };
const protocol = { hash: H("1"), descriptor: { schema: "surestop.protocol/1", seeds: [1, 2], layout: "v1", swap: null, variants: [{ label: "surestop", method: "surestop", missionConfigHash: H("a") }, { label: "single-frame@0.7", method: "single-frame", missionConfigHash: H("b") }], evaluator: { labelRadius: 1 } } };
const detector = { name: "coco-ssd", packageVersion: "2.2.3", tfjsVersion: "4.22.0", base: "lite_mobilenet_v2", backend: "wasm" };

function run(scenarioId: string, seed: number, variant: string, over: Record<string, unknown> = {}) {
  const cfg = variant === "surestop" ? H("a") : H("b");
  return {
    recordSchema: "surestop.run-record/2",
    variant,
    result: { scenarioId, seed, method: variant.split("@")[0], outcome: "ARRIVED", frames: [], config: {} },
    score: { correctArrival: true },
    layout: { version: "v1", id: `v1-${seed}`, attempt: 0, fallback: false, valid: true, failedChecks: [] },
    provenance: { schema: "surestop.run-provenance/1", canonicalization: "surestop.canonical-json/1", build, missionConfigHash: cfg, protocolHash: protocol.hash, artifacts, runtime, unavailable: [], ...over },
  };
}
function p1File(scenario: string, prov: Record<string, unknown> = {}, runs = [run(scenario, 1, "surestop"), run(scenario, 1, "single-frame@0.7")]) {
  return { detector, backend: { backend: "wasm", reason: "", glRenderer: null }, wallMs: 1, provenance: { schema: "surestop.batch-provenance/1", build, artifacts, runtime, protocol, scenarios: [scenario], ...prov }, runs };
}
const legacyFile = (scenario: string) => ({ detector, backend: { backend: "wasm", reason: "", glRenderer: null }, wallMs: 1, runs: [{ variant: "surestop", result: { scenarioId: scenario, seed: 1, method: "surestop", outcome: "ARRIVED", frames: [], config: {} }, score: {} }] });

describe("merge compatibility rules", () => {
  it("one protocol split across processes by scenario merges, with different variant config hashes inside it", () => {
    const r = checkMergeCompatibility([p1File("clear-target"), p1File("poster-decoy")]);
    expect(r).toEqual({ mode: "p1", errors: [], warnings: [] });
  });

  it("pre-P1 files merge as before, with a warning; mixing them with P1 files is refused", () => {
    expect(classify(legacyFile("a"))).toBe("legacy");
    const legacy = checkMergeCompatibility([legacyFile("a"), legacyFile("b")]);
    expect(legacy.errors).toEqual([]);
    expect(legacy.warnings[0]).toMatch(/no source commit/);
    expect(checkMergeCompatibility([legacyFile("a"), p1File("b")]).errors[0]).toMatch(/cannot merge pre-P1/);
  });

  it("refuses a file in which only some runs carry provenance", () => {
    const f = p1File("a");
    const { provenance: _p, recordSchema: _s, ...bare } = f.runs[0];
    void _p;
    void _s;
    f.runs[0] = bare as (typeof f.runs)[number];
    expect(classify(f)).toBe("inconsistent");
    expect(checkMergeCompatibility([f]).errors[0]).toMatch(/some runs carry provenance/);
  });

  it("refuses different builds, unknown sources, different artifacts, runtimes or protocols", () => {
    const other = { ...build, sourceCommit: "e".repeat(40), buildId: "e".repeat(40) };
    expect(checkMergeCompatibility([p1File("a"), p1File("b", { build: other })]).errors.join()).toMatch(/different builds/);
    expect(checkMergeCompatibility([p1File("a", { build: { ...build, sourceCommit: null, buildId: null } })]).errors.join()).toMatch(/no known source commit/);
    expect(checkMergeCompatibility([p1File("a"), p1File("b", { artifacts: { ...artifacts, assetsSha256: H("9") } })]).errors.join()).toMatch(/artifacts/);
    expect(checkMergeCompatibility([p1File("a"), p1File("b", { runtime: { ...runtime, userAgent: "Other" } })]).errors.join()).toMatch(/different browsers/);
    expect(checkMergeCompatibility([p1File("a"), p1File("b", { protocol: { ...protocol, hash: H("2") } })]).errors.join()).toMatch(/different protocols/);
  });

  it("a dirty build merges only with the identical dirty tree, with a warning", () => {
    const dirty = { ...build, sourceDirty: true, dirtyFingerprint: H("7"), buildId: `${"c".repeat(40)}-dirty-777777777777` };
    const files = [p1File("a", { build: dirty }, [run("a", 1, "surestop", { build: dirty })]), p1File("b", { build: dirty }, [run("b", 1, "surestop", { build: dirty })])];
    const r = checkMergeCompatibility(files);
    expect(r.errors).toEqual([]);
    expect(r.warnings.join()).toMatch(/dirty working tree/);
    expect(checkMergeCompatibility([files[0], p1File("b")]).errors.join()).toMatch(/different builds/);
  });

  it("refuses a run whose config hash does not match the protocol's hash for its variant, or whose variant is not in the protocol", () => {
    const bad = p1File("a", {}, [run("a", 1, "surestop", { missionConfigHash: H("b") })]);
    expect(checkMergeCompatibility([bad]).errors.join()).toMatch(/missionConfigHash differs/);
    const extra = p1File("a", {}, [run("a", 1, "persistence")]);
    expect(checkMergeCompatibility([extra]).errors.join()).toMatch(/not in the batch protocol/);
  });
});

describe("batch scripts with provenance", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "surestop-p1-"));
  const write = (name: string, data: object) => {
    const f = path.join(tmp, name);
    fs.writeFileSync(f, JSON.stringify(data));
    return f;
  };

  it("merge-batches merges one protocol across scenario files and refuses a different build", () => {
    const out = path.join(tmp, "merged.json");
    const ok = spawnSync(process.execPath, [path.join(ROOT, "scripts/merge-batches.mjs"), out, write("a.json", p1File("clear-target")), write("b.json", p1File("poster-decoy"))], { encoding: "utf8" });
    expect(ok.status).toBe(0);
    const merged = JSON.parse(fs.readFileSync(out, "utf8"));
    expect(merged.runs).toHaveLength(4);
    expect(merged.provenance.scenarios).toEqual(["clear-target", "poster-decoy"]);
    expect(merged.provenance.protocol.hash).toBe(protocol.hash);
    const other = { ...build, sourceCommit: "e".repeat(40), buildId: "e".repeat(40) };
    const bad = spawnSync(process.execPath, [path.join(ROOT, "scripts/merge-batches.mjs"), path.join(tmp, "bad.json"), write("c.json", p1File("clear-target")), write("d.json", p1File("poster-decoy", { build: other }))], { encoding: "utf8" });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toMatch(/refusing to merge incompatible batches/);
    expect(fs.existsSync(path.join(tmp, "bad.json"))).toBe(false);
  });

  it("aggregate reports the measured user agent and cores, and 'not measured' for a pre-P1 batch", () => {
    const agg = (input: string, out: string) => {
      execFileSync("npm", ["run", "-s", "aggregate", "--", "evaluation", input, out], { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
      return JSON.parse(fs.readFileSync(out, "utf8"));
    };
    const p1 = agg(write("p1.json", p1File("clear-target")), path.join(tmp, "p1-eval-runs.json"));
    expect(p1.environment.browser).toBe("Mozilla/5.0 Test");
    expect(p1.environment.machine).toBe("4 logical cores (navigator.hardwareConcurrency)");
    expect(p1.provenance.protocol.hash).toBe(protocol.hash);
    const old = agg(write("old.json", legacyFile("clear-target")), path.join(tmp, "old-eval-runs.json"));
    expect(old.environment.browser).toBe("not measured (batch has no provenance)");
    expect(old.environment.machine).toBe("not measured (batch has no provenance)");
    expect(old.provenance).toBeUndefined();
  }, 120_000);
});
