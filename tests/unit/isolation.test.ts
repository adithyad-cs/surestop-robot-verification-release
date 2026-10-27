// Guards the perception/evaluation boundary: robot-facing modules must not import
// scenario ground truth, the asset catalogue or the evaluator.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseVariant } from "@/experiments/engine";
import { SCENARIOS } from "@/scenarios/layout";
import { fakeEngine } from "./fixtures/fakeEngine";

const ROOT = path.resolve(__dirname, "../../src");
const ROBOT_FACING = ["verify", "policies", "sensing", "perception", "mission", "nav"];
const FORBIDDEN = [
  /@\/sim\/assets/,
  /@\/sim\/world/,
  /@\/eval\//,
  /@\/scenarios\//,
  /groundTruth/i,
  /objectRoots/,
  /\.\.\/sim\/assets/,
  /\.\.\/eval\//,
  // P1: experiment-layer provenance (asset identities, lineage, artifact manifest, batch records).
  /@\/provenance\//,
  /@\/experiments\//,
  /artifact-manifest/,
  /evaluatorObjects/,
  /lineage/i,
];

function files(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

describe("ground-truth isolation", () => {
  for (const mod of ROBOT_FACING) {
    it(`src/${mod} does not reference ground truth or the evaluator`, () => {
      const list = files(path.join(ROOT, mod));
      expect(list.length).toBeGreaterThan(0);
      for (const f of list) {
        const src = fs.readFileSync(f, "utf8");
        for (const re of FORBIDDEN) expect(src, `${path.relative(ROOT, f)} matches ${re}`).not.toMatch(re);
      }
    });
  }
});

// P1-f: the evaluator-only object/asset provenance stays in RunRecord.objects. The robot's own
// outputs and inputs (MissionResult, MissionConfig) carry no asset identity, lineage or label.
describe("evaluator-only provenance never reaches robot-facing data", () => {
  const GT_KEYS = ["objectId", "assetId", "assetFile", "assetSha256", "lineage", "derivation", "targetPresent", "trackLabels", "arrivedAtObject", "arrivedAtKind", "zones", "objects"];

  function keysOf(v: unknown, out = new Set<string>()): Set<string> {
    if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysOf(x, out);
    }
    return out;
  }

  it("MissionResult and MissionConfig contain no ground-truth keys, object ids, labels or asset hashes, for every scenario", async () => {
    const engine = fakeEngine();
    for (const sc of SCENARIOS) {
      const rec = await engine.runOne(sc.id, 2, parseVariant("surestop"), undefined, "v2");
      const robotSide = JSON.stringify({ result: rec.result, config: rec.result.config });
      const keys = keysOf(rec.result);
      for (const k of GT_KEYS) expect(keys.has(k), `${sc.id}: MissionResult has key ${k}`).toBe(false);
      const objects = rec.objects!.objects;
      expect(objects.length).toBeGreaterThan(0);
      for (const o of objects) {
        expect(robotSide).not.toContain(JSON.stringify(o.objectId));
        expect(robotSide).not.toContain(JSON.stringify(o.label));
        if (o.assetFile) expect(robotSide).not.toContain(o.assetFile);
        if (o.assetSha256) expect(robotSide).not.toContain(o.assetSha256);
        if (o.assetId) expect(robotSide).not.toContain(JSON.stringify(o.assetId));
      }
    }
  }, 120_000);
});
