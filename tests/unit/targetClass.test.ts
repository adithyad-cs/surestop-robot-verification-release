// D6: the verifier knows the mission's target class; a detection of another class is never
// evidence for or against the candidate (not support, not flat, not a miss).
import { describe, expect, it } from "vitest";
import { DEFAULT_SURESTOP, SureStopVerifier } from "@/verify/surestop";
import type { CandidateObservation } from "@/verify/types";
import { at, obs } from "./helpers";

const origin = { x: 0, z: 0 };
const as = (o: CandidateObservation, cls: string): CandidateObservation => ({ ...o, detection: o.detection && { ...o.detection, cls } });

describe("target-class boundary", () => {
  it("the audit reproduction: two volumetric 'vase' views from distinct cells no longer confirm", () => {
    const v = new SureStopVerifier(DEFAULT_SURESTOP, origin, "potted plant");
    const a = v.observe(as(obs(...at(1.9, 15)), "vase"));
    const b = v.observe(as(obs(...at(1.9, 105)), "vase"));
    expect(a.verdict).toBe("INCONCLUSIVE");
    expect(a.reason).toMatch(/detection class "vase" is not the target class "potted plant"/);
    expect(b.verdict).toBe("INCONCLUSIVE");
    const d = v.decision();
    expect(d.status).toBe("PENDING");
    expect(d.support).toBe(0);
    expect(d.against).toBe(0);
  });

  it("other-class views are not misses: they cannot reject the candidate as not reproducible", () => {
    const v = new SureStopVerifier(DEFAULT_SURESTOP, origin, "potted plant");
    for (const b of [15, 75, 135, 195, 255]) v.observe(as(obs(...at(1.9, b), { depth: { excessRelief: 0.04 } }), "vase"));
    expect(v.decision().status).toBe("PENDING");
    expect(v.decision().reason).toMatch(/, 0 not re-detected of /);
  });

  it("the target class behaves exactly as before", () => {
    const v = new SureStopVerifier(DEFAULT_SURESTOP, origin, "potted plant");
    v.observe(obs(...at(1.9, 15)));
    v.observe(obs(...at(1.9, 105)));
    expect(v.decision().status).toBe("CONFIRMED");
    expect(v.decision().support).toBe(2);
  });

  it("a mixed sequence counts only the target-class views", () => {
    const v = new SureStopVerifier(DEFAULT_SURESTOP, origin, "potted plant");
    v.observe(obs(...at(1.9, 15)));
    v.observe(as(obs(...at(1.9, 105)), "vase"));
    expect(v.decision().status).toBe("PENDING");
    v.observe(obs(...at(1.9, 195)));
    expect(v.decision().status).toBe("CONFIRMED");
    expect(v.decision().support).toBe(2);
  });

  it("refuses a missing target class", () => {
    expect(() => new SureStopVerifier(DEFAULT_SURESTOP, origin, "")).toThrow(/targetClass/);
  });
});
