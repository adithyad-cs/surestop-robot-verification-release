// D5: a non-finite or out-of-range verifier configuration is refused, never repaired. NaN in a
// threshold made its comparison always false and silently disabled that check.
import { describe, expect, it } from "vitest";
import { assessView, DEFAULT_EVIDENCE, evidenceConfigError, type EvidenceConfig } from "@/verify/evidence";
import { DEFAULT_SURESTOP, SureStopVerifier, sureStopConfigError, type SureStopConfig } from "@/verify/surestop";
import { missionConfig } from "@/mission/runner";
import { obs } from "./helpers";

const origin = { x: 0, z: 0 };

describe("evidence configuration", () => {
  it("the audit reproduction: NaN thresholds no longer disable the score and two-plane checks", () => {
    const low = obs(1.5, 0, { score: 0.05 });
    expect(assessView(low).verdict).toBe("INCONCLUSIVE");
    expect(() => assessView(low, { ...DEFAULT_EVIDENCE, minScore: NaN })).toThrow(/invalid SureStop configuration: evidence.minScore/);
    const layered = obs(1.5, 0, { depth: { twoPlaneFraction: 0.99 } });
    expect(assessView(layered).verdict).toBe("INCONCLUSIVE");
    expect(() => assessView(layered, { ...DEFAULT_EVIDENCE, maxTwoPlaneFraction: NaN })).toThrow(/evidence.maxTwoPlaneFraction/);
  });

  const bad: Array<[keyof EvidenceConfig, number]> = [
    ["minScore", NaN], ["minScore", -0.1], ["minScore", 1.5], ["minScore", Infinity],
    ["minBoxW", NaN], ["minBoxW", -1], ["minBoxH", Infinity],
    ["minValidFraction", NaN], ["minValidFraction", 2],
    ["maxExpectedNoise", NaN], ["maxExpectedNoise", Infinity], ["maxExpectedNoise", 0],
    ["volumetricRelief", NaN], ["volumetricRelief", 0], ["volumetricRelief", -Infinity],
    ["flatRelief", NaN], ["flatRelief", -0.01],
    ["maxTwoPlaneFraction", NaN], ["maxTwoPlaneFraction", 0], ["maxTwoPlaneFraction", 1.2],
  ];
  it.each(bad)("refuses %s = %s", (field, value) => {
    expect(evidenceConfigError({ ...DEFAULT_EVIDENCE, [field]: value })).toBe(`evidence.${field}`);
  });

  it("accepts the defaults and valid boundary values, with unchanged verdicts", () => {
    expect(evidenceConfigError(DEFAULT_EVIDENCE)).toBeNull();
    expect(evidenceConfigError({ ...DEFAULT_EVIDENCE, minScore: 0, flatRelief: 0, maxTwoPlaneFraction: 1, minValidFraction: 1 })).toBeNull();
    expect(assessView(obs(1.5, 0)).verdict).toBe("VOLUMETRIC");
    expect(assessView(obs(1.5, 0, { depth: { excessRelief: 0.003 } })).verdict).toBe("FLAT");
  });
});

describe("SureStop configuration", () => {
  const bad: Array<[string, Partial<SureStopConfig>]> = [
    ["requiredSupport", { requiredSupport: NaN }],
    ["requiredSupport", { requiredSupport: 0 }],
    ["requiredSupport", { requiredSupport: 1.5 }],
    ["requiredAgainst", { requiredAgainst: Infinity }],
    ["requiredMisses", { requiredMisses: NaN }],
    ["maxViewpoints", { maxViewpoints: Infinity }],
    ["confirmRange", { confirmRange: NaN }],
    ["confirmRange", { confirmRange: 0 }],
    ["cell.rangeBin", { cell: { rangeBin: NaN, bearingBinDeg: 30 } }],
    ["cell.bearingBinDeg", { cell: { rangeBin: 0.75, bearingBinDeg: 0 } }],
    ["evidence.minScore", { evidence: { ...DEFAULT_EVIDENCE, minScore: NaN } }],
  ];
  it.each(bad)("refuses an invalid %s at construction", (field, patch) => {
    const cfg = { ...DEFAULT_SURESTOP, ...patch };
    expect(sureStopConfigError(cfg)).toBe(field);
    expect(() => new SureStopVerifier(cfg, origin, "potted plant")).toThrow(`invalid SureStop configuration: ${field}`);
  });

  it("accepts every configuration the app constructs", () => {
    expect(sureStopConfigError(DEFAULT_SURESTOP)).toBeNull();
    expect(sureStopConfigError(missionConfig("surestop").surestop)).toBeNull();
    expect(sureStopConfigError(missionConfig("surestop-1view").surestop)).toBeNull();
  });
});
