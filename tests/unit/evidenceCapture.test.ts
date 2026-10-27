// P1-c: every SureStop evidence record carries the exact verifier inputs, and its verdict and the
// candidate decision can be recomputed offline from the serialised record alone.
import { describe, expect, it } from "vitest";
import { DEFAULT_SURESTOP, SureStopVerifier } from "@/verify/surestop";
import { decodeNonFinite, encodeNonFinite } from "@/verify/viewInputs";
import { observationFromRecord, recomputeView, replayCandidate } from "@/eval/recomputeEvidence";
import { SCENARIOS } from "@/scenarios/layout";
import type { MissionResult } from "@/mission/types";
import type { EvidenceRecord } from "@/verify/types";
import { at, obs } from "./helpers";
import { runFakeMission, type Faults } from "./fixtures/fakeMissions";

const roundTrip = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("captured view inputs", () => {
  it("are the values the verifier received, unrounded, with the two distances kept apart", () => {
    const o = obs(...at(1.9137, 47.3), { score: 0.912345678, bbox: [101.23456, 99.87654, 160.5, 220.25], depth: { medianDepth: 1.83217, validFraction: 0.912 } });
    const v = new SureStopVerifier(DEFAULT_SURESTOP, { x: 0.01234, z: -0.00321 }, "potted plant");
    const rec = roundTrip(v.observe(o));
    const i = rec.inputs!;
    expect(i.schema).toBe("surestop.view-inputs/1");
    expect(i.detection).toEqual(o.detection);
    expect(i.depth).toEqual(o.depth);
    expect(i.robot).toEqual(o.robot);
    expect(i.candidateEstimate).toEqual({ x: 0.01234, z: -0.00321 });
    expect(i.candidateDistance).toBe(rec.range);
    expect(i.depth!.medianDepth).toBe(1.83217);
    expect(i.candidateDistance).not.toBe(i.depth!.medianDepth);
    expect(i.targetClass).toBe("potted plant");
  });

  it("keep non-finite values explicit through JSON instead of turning them into null", () => {
    const o = obs(1.5, 0.5, { depth: { validFraction: NaN, excessRelief: Infinity } });
    const v = new SureStopVerifier(DEFAULT_SURESTOP, { x: 0, z: 0 }, "potted plant");
    const rec = roundTrip(v.observe(o));
    expect(rec.inputs!.depth!.validFraction).toEqual({ nonFinite: "NaN" });
    expect(rec.inputs!.depth!.excessRelief).toEqual({ nonFinite: "Infinity" });
    expect(rec.invalidField).toBe("valid-depth fraction");
    const back = observationFromRecord(rec);
    expect(back.depth!.validFraction).toBeNaN();
    expect(back.depth!.excessRelief).toBe(Infinity);
    expect(decodeNonFinite(encodeNonFinite([-Infinity, 1, { a: NaN }]))).toEqual([-Infinity, 1, { a: NaN }]);
  });

  it("missing inputs stay missing: a miss has no detection and no depth", () => {
    const v = new SureStopVerifier(DEFAULT_SURESTOP, { x: 0, z: 0 }, "potted plant");
    const rec = roundTrip(v.observe(obs(1.5, 0.5, { score: null, depth: null })));
    expect(rec.inputs!.detection).toBeNull();
    expect(rec.inputs!.depth).toBeNull();
    expect(recomputeView(rec, DEFAULT_SURESTOP).verdict).toBe("INCONCLUSIVE");
  });
});

describe("offline recomputation on deterministic fake-sensor missions", () => {
  const cases: Array<[string, Faults]> = [
    ["valid inputs", {}],
    ["every 3rd detection without depth", { dropDepthEvery: 3 }],
    ["every 2nd detection with NaN depth fractions", { corruptEvery: 2 }],
    ["every 2nd detection reported as another class", { wrongClassEvery: 2 }],
  ];

  it.each(cases)("%s: every SureStop verdict and every candidate decision is reproduced from the serialised record", async (_name, faults) => {
    let records = 0;
    let tracks = 0;
    let invalid = 0;
    let classMismatch = 0;
    for (const sc of SCENARIOS) {
      for (const layout of ["v1", "v2"] as const) {
        for (const seed of [0, 1, 2]) {
          for (const method of ["surestop", "surestop-1view"] as const) {
            const r: MissionResult = roundTrip(await runFakeMission(sc.id, seed, layout, method, faults));
            for (const t of r.tracks) {
              tracks++;
              for (const rec of t.evidence) {
                records++;
                if (rec.invalidField) invalid++;
                if (/is not the target class/.test(rec.reason)) classMismatch++;
                const a = recomputeView(rec, r.config.surestop);
                expect({ verdict: a.verdict, reason: a.reason, invalidField: a.invalidField }).toEqual({ verdict: rec.verdict, reason: rec.reason, invalidField: rec.invalidField });
              }
              if (!t.evidence.length) continue;
              const replay = roundTrip(replayCandidate(t.evidence, r.config.surestop, t.decision));
              const { attempts: _a, ...want } = t.decision;
              const { attempts: _b, ...got } = replay.decision;
              void _a;
              void _b;
              expect(got).toEqual(want);
              const strip = (e: EvidenceRecord) => ({ frameId: e.frameId, cell: e.cell, verdict: e.verdict, reason: e.reason, counted: e.counted, note: e.note, invalidField: e.invalidField });
              expect(replay.records.map(strip)).toEqual(t.evidence.map(strip));
            }
          }
        }
      }
    }
    expect(records).toBeGreaterThan(100);
    expect(tracks).toBeGreaterThan(40);
    if (faults.corruptEvery) expect(invalid).toBeGreaterThan(0);
    if (faults.wrongClassEvery) expect(classMismatch).toBeGreaterThan(0);
  }, 120_000);
});
