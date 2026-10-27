// D1 wording: the abstention metric counts every UNRESOLVED mission, and its definition names both
// ways a mission can end UNRESOLVED. Counting is unchanged (outcome === "UNRESOLVED").
import { describe, expect, it } from "vitest";
import { METRIC_DEFINITIONS, missionMetrics } from "@/eval/metrics";
import { evaluateMission } from "@/eval/evaluate";
import { instantiateLayout } from "@/scenarios/generate";
import { runFakeMission } from "./fixtures/fakeMissions";

describe("abstention metric definition (D1)", () => {
  it("names both UNRESOLVED causes and separates NAV_FAILURE", () => {
    const d = METRIC_DEFINITIONS.abstentionRate;
    expect(d).toMatch(/ended UNRESOLVED ÷ trials in which at least one candidate was opened/);
    expect(d).toMatch(/an engaged candidate stayed UNCONFIRMED/);
    expect(d).toMatch(/a candidate was CONFIRMED but the robot did not reach its stand-off point/);
    expect(d).toMatch(/no reachable stand-off point is NAV_FAILURE/);
  });

  it("counts both kinds of UNRESOLVED mission, and nothing else, as abstentions", async () => {
    const objects = instantiateLayout("clear-target", 0, "v1").objects;
    const full = await runFakeMission("clear-target", 0, "v1", "surestop");
    const confirmedAt = full.events.find((e) => e.to === "CONFIRMED")!.frameId!;
    const verifyFrame = full.frames.find((f) => f.purpose === "verify")!.frameId;
    const notReached = await runFakeMission("clear-target", 0, "v1", "surestop", {}, { maxFrames: confirmedAt });
    const unconfirmed = await runFakeMission("clear-target", 0, "v1", "surestop", {}, { maxFrames: verifyFrame });
    expect(notReached.terminal).toMatchObject({ rule: "unresolved-confirmed-not-reached" });
    expect(unconfirmed.terminal).toMatchObject({ rule: "unresolved-unconfirmed-candidates" });

    const scores = [full, notReached, unconfirmed].map((r) => evaluateMission(r, objects, true));
    expect(scores.map((s) => [s.outcome, s.abstained, s.correctArrival, s.falseArrival])).toEqual([
      ["ARRIVED", false, true, false],
      ["UNRESOLVED", true, false, false],
      ["UNRESOLVED", true, false, false],
    ]);
    const m = missionMetrics(scores);
    expect(m.abstentionRate).toMatchObject({ num: 2, den: 3, definition: METRIC_DEFINITIONS.abstentionRate });
    expect(m.completionRate).toMatchObject({ num: 1, den: 3 });
  });
});
