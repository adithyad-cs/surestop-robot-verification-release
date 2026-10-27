// P1-d: every candidate decision and every mission ending carries a structured rule that matches
// its status/outcome; reasons, outcomes and thresholds are unchanged.
import { describe, expect, it } from "vitest";
import { SureStopVerifier, DEFAULT_SURESTOP } from "@/verify/surestop";
import { SureStopPolicy } from "@/policies/sureStopPolicy";
import { PersistencePolicy } from "@/policies/baselines";
import { MissionRunner, missionConfig } from "@/mission/runner";
import { instantiateLayout } from "@/scenarios/generate";
import { ROUTE, SCENARIOS } from "@/scenarios/layout";
import { buildPriorGrid } from "@/scenarios/validate";
import type { MissionResult } from "@/mission/types";
import type { NavQuery } from "@/verify/planner";
import { at, obs } from "./helpers";
import { FakeLayoutSensor, runFakeMission } from "./fixtures/fakeMissions";

const OUTCOME_OF_RULE: Record<string, string> = {
  "arrived-after-confirmation": "ARRIVED",
  "nav-failure-no-standoff": "NAV_FAILURE",
  aborted: "ABORTED",
  "unresolved-confirmed-not-reached": "UNRESOLVED",
  "unresolved-unconfirmed-candidates": "UNRESOLVED",
  "not-found": "NOT_FOUND",
};

function trackRule(r: MissionResult, status: string) {
  return r.tracks.filter((t) => t.status === status).map((t) => t.decision.rule);
}

describe("candidate decision rules on real control flow (fake-sensor missions)", () => {
  it("confirm, reject-flat and the baselines' own rules", async () => {
    const clear = await runFakeMission("clear-target", 0, "v1", "surestop");
    expect(trackRule(clear, "CONFIRMED")).toEqual(["confirm-volumetric-support"]);
    const poster = await runFakeMission("poster-decoy", 0, "v1", "surestop");
    expect(trackRule(poster, "REJECTED")).toContain("reject-flat-evidence");
    expect((await runFakeMission("clear-target", 0, "v1", "single-frame")).tracks.find((t) => t.status === "CONFIRMED")!.decision.rule).toBe("single-frame-score-threshold");
    expect((await runFakeMission("clear-target", 0, "v1", "persistence")).tracks.find((t) => t.status === "CONFIRMED")!.decision.rule).toBe("persistence-hits-in-window");
  });

  it("a mission ended during verification exhausts the engaged candidate with exhaust-mission-ended", async () => {
    const full = await runFakeMission("clear-target", 0, "v1", "surestop");
    const verifyFrame = full.frames.find((f) => f.purpose === "verify")!.frameId;
    const cut = await runFakeMission("clear-target", 0, "v1", "surestop", {}, { maxFrames: verifyFrame });
    expect(cut.tracks[0].status).toBe("UNCONFIRMED");
    expect(cut.tracks[0].decision.rule).toBe("exhaust-mission-ended");
    expect(cut.terminal).toEqual({ schema: "surestop.terminal/1", cause: "frame-budget", rule: "unresolved-unconfirmed-candidates" });
  });

  it("every decided track has a rule consistent with its status, across all scenarios and methods", async () => {
    for (const sc of SCENARIOS) {
      for (const method of ["surestop", "surestop-1view", "single-frame", "persistence"] as const) {
        const r = await runFakeMission(sc.id, 1, "v2", method, { dropDepthEvery: 3 });
        for (const t of r.tracks) {
          const rule = t.decision.rule!;
          if (t.status === "PENDING") expect(rule).toBe("pending");
          if (t.status === "CONFIRMED") expect(rule).toMatch(/^(confirm-volumetric-support|single-frame-score-threshold|persistence-hits-in-window)$/);
          if (t.status === "REJECTED") expect(rule).toMatch(/^(reject-flat-evidence|reject-not-reproducible|persistence-consecutive-misses)$/);
          if (t.status === "UNCONFIRMED") expect(rule).toMatch(/^(exhaust-|persistence-frame-budget$)/);
        }
        expect(r.terminal).not.toBeNull();
        expect(OUTCOME_OF_RULE[r.terminal!.rule]).toBe(r.outcome);
      }
    }
  }, 120_000);
});

describe("candidate rules reached through the policy or verifier", () => {
  const free: NavQuery = { isFree: () => true, pathLength: () => 3, lineOfSight: () => true };

  it("reject-not-reproducible", () => {
    const v = new SureStopVerifier(DEFAULT_SURESTOP, { x: 0, z: 0 }, "potted plant");
    for (const b of [15, 75, 135]) v.observe(obs(...at(1.9, b), { score: null, depth: null }));
    expect(v.decision()).toMatchObject({ status: "REJECTED", rule: "reject-not-reproducible" });
  });

  it("exhaust-viewpoint-budget and exhaust-no-reachable-viewpoint", () => {
    const p = new SureStopPolicy("surestop", { ...DEFAULT_SURESTOP, maxViewpoints: 1 }, undefined, { x: 0, z: 0 }, "potted plant");
    expect(p.next({ robot: { x: 5, z: 0, theta: 0 }, nav: free }).kind).toBe("observe-from");
    const d = p.next({ robot: { x: 5, z: 0, theta: 0 }, nav: free });
    expect(d.kind === "decided" && d.decision).toMatchObject({ status: "UNCONFIRMED", rule: "exhaust-viewpoint-budget" });
    const q = new SureStopPolicy("surestop", DEFAULT_SURESTOP, undefined, { x: 0, z: 0 }, "potted plant");
    const e = q.next({ robot: { x: 5, z: 0, theta: 0 }, nav: { ...free, isFree: () => false } });
    expect(e.kind === "decided" && e.decision).toMatchObject({ status: "UNCONFIRMED", rule: "exhaust-no-reachable-viewpoint" });
  });

  it("exhaust-viewpoint-unreachable is forwarded by the policy (the runner path is not reachable with the current planner)", () => {
    const p = new SureStopPolicy("surestop", DEFAULT_SURESTOP, undefined, { x: 0, z: 0 }, "potted plant");
    p.exhaust("planned viewpoint became unreachable", "exhaust-viewpoint-unreachable");
    expect(p.decision()).toMatchObject({ status: "UNCONFIRMED", rule: "exhaust-viewpoint-unreachable" });
  });

  it("persistence-consecutive-misses and persistence-frame-budget", () => {
    const cfg = { threshold: 0.5, requiredHits: 3, window: 4, maxConsecutiveMisses: 2, step: 0.5, maxFrames: 10 };
    const lost = new PersistencePolicy(cfg, { x: 0, z: 0 });
    lost.observe(obs(1, 1, { score: 0.1 }));
    lost.observe(obs(1, 1, { score: 0.1 }));
    expect(lost.decision()).toMatchObject({ status: "REJECTED", rule: "persistence-consecutive-misses" });
    const budget = new PersistencePolicy({ ...cfg, maxFrames: 2, maxConsecutiveMisses: 9 }, { x: 0, z: 0 });
    budget.observe(obs(1, 1, { score: 0.9 }));
    budget.observe(obs(1, 1, { score: 0.1 }));
    expect(budget.decision()).toMatchObject({ status: "UNCONFIRMED", rule: "persistence-frame-budget" });
  });

  it("a terminal decision keeps its rule when a later exhaust is attempted", () => {
    const v = new SureStopVerifier(DEFAULT_SURESTOP, { x: 0, z: 0 }, "potted plant");
    v.observe(obs(...at(1.9, 15)));
    v.observe(obs(...at(1.9, 105)));
    v.exhaust("late", "exhaust-mission-ended");
    expect(v.decision()).toMatchObject({ status: "CONFIRMED", rule: "confirm-volumetric-support" });
  });
});

describe("mission termination causes and outcome rules", () => {
  it("arrival, route completion, last-frame confirmation, time budget and abort", async () => {
    expect((await runFakeMission("clear-target", 0, "v1", "surestop")).terminal).toEqual({ schema: "surestop.terminal/1", cause: "approach-complete", rule: "arrived-after-confirmation" });
    expect((await runFakeMission("decoys-only", 0, "v1", "surestop")).terminal).toEqual({ schema: "surestop.terminal/1", cause: "route-completed", rule: "not-found" });
    const full = await runFakeMission("clear-target", 0, "v1", "surestop");
    const confirmedAt = full.events.find((e) => e.to === "CONFIRMED")!.frameId!;
    const d1 = await runFakeMission("clear-target", 0, "v1", "surestop", {}, { maxFrames: confirmedAt });
    expect(d1.terminal).toEqual({ schema: "surestop.terminal/1", cause: "frame-budget", rule: "unresolved-confirmed-not-reached" });
    expect((await runFakeMission("clear-target", 0, "v1", "surestop", {}, { maxSimTime: 5 })).terminal!.cause).toBe("time-budget");

    const inst = instantiateLayout("clear-target", 0, "v1");
    const runner = new MissionRunner(missionConfig("surestop"), buildPriorGrid(inst.objects), ROUTE, inst.start, new FakeLayoutSensor([]), { scenarioId: "clear-target", seed: 0 });
    expect(runner.result().terminal).toBeNull();
    runner.abort();
    expect(runner.result()).toMatchObject({ outcome: "ABORTED", terminal: { cause: "user-abort", rule: "aborted" } });
  });
});
