// P1-a / P1-b: build metadata, artifact manifest, configuration and protocol hashes, runtime info.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildArtifactManifest } from "../../scripts/artifact-manifest.mjs";
import { computeBuildMeta } from "../../scripts/build-meta.mjs";
import { readBuildMeta } from "@/provenance/build";
import { ARTIFACTS, describeProtocol, makeRunProvenance, measureRuntime, missionConfigHash } from "@/provenance/run";
import { missionConfig } from "@/mission/runner";
import { parseVariant } from "@/experiments/engine";
import { ASSETS } from "@/sim/assets";
import committed from "@/provenance/artifact-manifest.json";

const ROOT = path.resolve(__dirname, "../..");

describe("artifact manifest", () => {
  it("the committed manifest matches the files on disk (regenerate with scripts/artifact-manifest.mjs --write)", () => {
    expect(buildArtifactManifest(ROOT)).toEqual(committed);
  });

  it("covers model.json and every weight shard it references, the WASM binaries and every asset the app loads", () => {
    const model = JSON.parse(fs.readFileSync(path.join(ROOT, "public/models/coco-ssd/lite_mobilenet_v2/model.json"), "utf8"));
    const detector = committed.detector.files.map((f) => f.path);
    expect(detector).toContain("/models/coco-ssd/lite_mobilenet_v2/model.json");
    for (const p of model.weightsManifest[0].paths) expect(detector).toContain(`/models/coco-ssd/lite_mobilenet_v2/${p}`);
    expect(committed.runtime.files.map((f) => f.path)).toEqual(["/tfjs-wasm/tfjs-backend-wasm-simd.wasm", "/tfjs-wasm/tfjs-backend-wasm-threaded-simd.wasm", "/tfjs-wasm/tfjs-backend-wasm.wasm"]);
    const assets = committed.assets.files.map((f) => f.path);
    for (const a of Object.values(ASSETS)) expect(assets).toContain(a.url);
    expect(ARTIFACTS).toEqual({ manifestSchema: committed.schema, detectorSha256: committed.detector.sha256, runtimeSha256: committed.runtime.sha256, assetsSha256: committed.assets.sha256 });
  });
});

describe("build metadata (scripts/build-meta.mjs)", () => {
  const COMMIT = "a".repeat(40);
  const fakeGit = (status: string, diff = "") => (args: string[]) => {
    if (args[0] === "rev-parse") return `${COMMIT}\n`;
    if (args[0] === "status") return status;
    if (args[0] === "diff") return diff;
    if (args[0] === "ls-files") return "";
    throw new Error(`unexpected git ${args.join(" ")}`);
  };

  it("a clean tree: buildId is the commit and the tree is reported clean", () => {
    const m = computeBuildMeta({ git: fakeGit(""), env: { NODE_ENV: "production" } });
    expect(m).toMatchObject({ source: "git", sourceCommit: COMMIT, sourceDirty: false, dirtyFingerprint: null, buildId: COMMIT, mode: "production", unavailableReason: null });
  });

  it("a dirty tree is never reported clean; its buildId is deterministic and changes with the diff", () => {
    const a = computeBuildMeta({ git: fakeGit(" M src/x.ts\n", "diff-1"), env: {} });
    const b = computeBuildMeta({ git: fakeGit(" M src/x.ts\n", "diff-1"), env: {} });
    const c = computeBuildMeta({ git: fakeGit(" M src/x.ts\n", "diff-2"), env: {} });
    expect(a.sourceDirty).toBe(true);
    expect(a.buildId).toMatch(new RegExp(`^${COMMIT}-dirty-[0-9a-f]{12}$`));
    expect(a).toEqual(b);
    expect(c.buildId).not.toBe(a.buildId);
  });

  it("without git: commit from VERCEL_GIT_COMMIT_SHA with an unknown tree state, else everything unavailable", () => {
    const fail = () => {
      throw new Error("not a git repository");
    };
    expect(computeBuildMeta({ git: fail, env: { VERCEL_GIT_COMMIT_SHA: COMMIT } })).toMatchObject({ source: "vercel-env", sourceCommit: COMMIT, sourceDirty: null, buildId: null });
    const none = computeBuildMeta({ git: fail, env: {} });
    expect(none).toMatchObject({ source: "unavailable", sourceCommit: null, sourceDirty: null, buildId: null });
    expect(none.unavailableReason).toMatch(/not a git repository/);
  });

  it("reads this repository's real Git state", () => {
    const m = computeBuildMeta({ cwd: ROOT });
    expect(m.source).toBe("git");
    expect(m.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof m.sourceDirty).toBe("boolean");
  });

  it("the runtime reader reports unavailable rather than guessing", () => {
    expect(readBuildMeta(undefined)).toMatchObject({ source: "unavailable", sourceCommit: null, sourceDirty: null });
    expect(readBuildMeta("{not json").unavailableReason).toMatch(/not valid JSON/);
    expect(readBuildMeta(JSON.stringify({ schema: "x" })).unavailableReason).toMatch(/malformed/);
    const real = computeBuildMeta({ git: fakeGit(""), env: {} });
    expect(readBuildMeta(JSON.stringify(real))).toEqual(real);
  });
});

describe("configuration and protocol hashes", () => {
  it("missionConfigHash is deterministic and independent of key order", async () => {
    const cfg = missionConfig("surestop");
    const reordered = JSON.parse(JSON.stringify(cfg, Object.keys(cfg).sort().reverse()));
    const h = await missionConfigHash(cfg);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await missionConfigHash(cfg)).toBe(h);
    expect(await missionConfigHash({ ...reordered, surestop: cfg.surestop, planner: cfg.planner, singleFrame: cfg.singleFrame, persistence: cfg.persistence })).toBe(h);
  });

  it("different variants have different missionConfigHash values", async () => {
    const specs = ["surestop", "surestop-1view", "single-frame", "single-frame@0.7", "persistence"];
    const hashes = await Promise.all(specs.map((s) => parseVariant(s)).map((v) => missionConfigHash(missionConfig(v.method, v.overrides))));
    expect(new Set(hashes).size).toBe(specs.length);
  });

  it("the protocol lists each variant's own config hash, and its hash depends on seeds, variants and layout", async () => {
    const variants = ["surestop", "single-frame@0.7"].map(parseVariant).map((v) => ({ label: v.label, method: v.method, config: missionConfig(v.method, v.overrides) }));
    const p = await describeProtocol({ seeds: [1, 2], layout: "v1", variants });
    expect(p.descriptor.variants.map((v) => v.label)).toEqual(["surestop", "single-frame@0.7"]);
    expect(p.descriptor.variants[0].missionConfigHash).toBe(await missionConfigHash(variants[0].config));
    expect(p.descriptor.variants[0].missionConfigHash).not.toBe(p.descriptor.variants[1].missionConfigHash);
    expect(p.hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await describeProtocol({ seeds: [1, 2], layout: "v1", variants })).hash).toBe(p.hash);
    expect((await describeProtocol({ seeds: [1, 3], layout: "v1", variants })).hash).not.toBe(p.hash);
    expect((await describeProtocol({ seeds: [1, 2], layout: "v2", variants })).hash).not.toBe(p.hash);
    expect((await describeProtocol({ seeds: [1, 2], layout: "v1", variants: [...variants].reverse() })).hash).not.toBe(p.hash);
  });
});

describe("runtime information", () => {
  it("reports measured values when the runtime provides them", () => {
    const rt = measureRuntime(
      { backend: { backend: "wasm", reason: "software WebGL detected; WASM is faster", glRenderer: "ANGLE (SwiftShader)" }, detector: { name: "coco-ssd", packageVersion: "2.2.3", tfjsVersion: "4.22.0", base: "lite_mobilenet_v2", backend: "wasm", loadMs: 1 } },
      { userAgent: "Mozilla/5.0 Test", hardwareConcurrency: 4 },
    );
    expect(rt).toMatchObject({ userAgent: "Mozilla/5.0 Test", hardwareConcurrency: 4, tfBackend: "wasm", glRenderer: "ANGLE (SwiftShader)", unavailable: [] });
  });

  it("reports unavailable values as null and says why, never a default", () => {
    const rt = measureRuntime({ backend: null, detector: null }, null);
    expect(rt).toMatchObject({ userAgent: null, hardwareConcurrency: null, tfBackend: null, glRenderer: null, detector: null });
    expect(rt.unavailable.join(" | ")).toMatch(/userAgent.*hardwareConcurrency.*detector.*glRenderer/);
  });

  it("run provenance lists what it could not determine", async () => {
    const p = await makeRunProvenance({ config: missionConfig("surestop"), protocol: null, runtime: measureRuntime({}, null), build: readBuildMeta(undefined) });
    expect(p.build.sourceCommit).toBeNull();
    expect(p.missionConfigHash).toMatch(/^[0-9a-f]{64}$/);
    expect(p.protocolHash).toBeNull();
    expect(p.unavailable).toEqual(expect.arrayContaining([expect.stringMatching(/^build: /), "protocolHash: not part of a batch protocol"]));
    expect(p.artifacts).toEqual(ARTIFACTS);
  });
});
