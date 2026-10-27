// Versioned manifest of the files that shape a mission's inputs: detector weights (model.json and
// every shard its weightsManifest references), the TF.js WASM binaries, and the 3-D asset files.
// The committed manifest (src/provenance/artifact-manifest.json) is checked against the files on
// disk by tests/unit/provenance.test.ts, so a stale manifest fails the test suite; run records
// carry its group hashes instead of hashing tens of megabytes during every mission.
//
// usage: node scripts/artifact-manifest.mjs --write   (regenerate the committed manifest)
//        node scripts/artifact-manifest.mjs --check   (exit 1 if it is stale)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ARTIFACT_MANIFEST_SCHEMA = "surestop.artifact-manifest/1";
export const MANIFEST_PATH = "src/provenance/artifact-manifest.json";

/** Same rules as src/lib/canonical.ts for the values used here (strings, finite integers, arrays, plain objects). */
export function canonicalJson(v) {
  if (v === null || typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("non-finite number");
    return Object.is(v, -0) ? "0" : JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (typeof v === "object") {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
  }
  throw new Error(`unsupported ${typeof v}`);
}

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function entry(root, rel) {
  const buf = fs.readFileSync(path.join(root, "public", rel));
  return { path: `/${rel}`, bytes: buf.length, sha256: sha256(buf) };
}

function group(name, files) {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files: sorted, sha256: sha256(canonicalJson({ schema: ARTIFACT_MANIFEST_SCHEMA, group: name, files: sorted })) };
}

export function buildArtifactManifest(root) {
  const detectorFiles = [];
  const modelsDir = path.join(root, "public/models/coco-ssd");
  for (const base of fs.readdirSync(modelsDir).sort()) {
    const rel = `models/coco-ssd/${base}`;
    const model = JSON.parse(fs.readFileSync(path.join(root, "public", rel, "model.json"), "utf8"));
    detectorFiles.push(entry(root, `${rel}/model.json`));
    for (const g of model.weightsManifest ?? []) for (const p of g.paths) detectorFiles.push(entry(root, `${rel}/${p}`));
  }
  const runtimeFiles = fs.readdirSync(path.join(root, "public/tfjs-wasm")).filter((f) => f.endsWith(".wasm")).map((f) => entry(root, `tfjs-wasm/${f}`));
  const assetFiles = fs.readdirSync(path.join(root, "public/assets/models")).filter((f) => f.endsWith(".glb")).map((f) => entry(root, `assets/models/${f}`));
  return {
    schema: ARTIFACT_MANIFEST_SCHEMA,
    detector: group("detector", detectorFiles),
    runtime: group("runtime", runtimeFiles),
    assets: group("assets", assetFiles),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const built = `${JSON.stringify(buildArtifactManifest(root), null, 2)}\n`;
  const target = path.join(root, MANIFEST_PATH);
  if (process.argv.includes("--write")) {
    fs.writeFileSync(target, built);
    console.log(`wrote ${MANIFEST_PATH}`);
  } else {
    const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    if (current !== built) {
      console.error(`${MANIFEST_PATH} is stale or missing; run node scripts/artifact-manifest.mjs --write`);
      process.exit(1);
    }
    console.log(`${MANIFEST_PATH} matches the files on disk`);
  }
}
