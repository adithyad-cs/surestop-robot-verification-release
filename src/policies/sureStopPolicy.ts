import { planNextViewpoint, DEFAULT_PLANNER, type PlannerConfig } from "@/verify/planner";
import { SureStopVerifier, DEFAULT_SURESTOP, type SureStopConfig } from "@/verify/surestop";
import type { CandidateObservation, ExhaustRule, IdentityConflict } from "@/verify/types";
import type { CandidatePolicy, MethodId, NextStep, PolicyContext } from "./types";

/** SureStop: sequential viewpoint evidence + bounded, planned re-observation. */
export class SureStopPolicy implements CandidatePolicy {
  readonly verifier: SureStopVerifier;

  constructor(
    readonly method: Extract<MethodId, "surestop" | "surestop-1view" | "surestop-identity">,
    readonly config: SureStopConfig = DEFAULT_SURESTOP,
    readonly planner: PlannerConfig = DEFAULT_PLANNER,
    candidate: { x: number; z: number },
    targetClass: string,
  ) {
    this.verifier = new SureStopVerifier(config, candidate, targetClass);
  }

  setCandidatePosition(p: { x: number; z: number }) {
    this.verifier.setCandidatePosition(p);
  }

  observe(obs: CandidateObservation) {
    return this.verifier.observe(obs);
  }

  /** Experimental identity-conflict evidence; only valid when the configuration enables it. */
  identityConflict(c: Omit<IdentityConflict, "used">) {
    return this.verifier.identityConflict(c);
  }

  next(ctx: PolicyContext): NextStep {
    const d = this.verifier.decision();
    if (d.status !== "PENDING") return { kind: "decided", decision: d };
    if (!this.verifier.canAttempt()) {
      this.verifier.exhaust(`viewpoint budget (${this.config.maxViewpoints}) spent`, "exhaust-viewpoint-budget");
      return { kind: "decided", decision: this.verifier.decision() };
    }
    const vp = planNextViewpoint(
      this.verifier.candidatePosition,
      ctx.robot,
      this.verifier.usedCells(),
      this.verifier.votedBearings(),
      ctx.nav,
      this.planner,
    );
    if (!vp) {
      this.verifier.exhaust("no reachable, unused verification viewpoint", "exhaust-no-reachable-viewpoint");
      return { kind: "decided", decision: this.verifier.decision() };
    }
    this.verifier.registerAttempt();
    return { kind: "observe-from", viewpoint: vp };
  }

  exhaust(why: string, rule: ExhaustRule) {
    this.verifier.exhaust(why, rule);
  }

  decision() {
    return this.verifier.decision();
  }

  records() {
    return this.verifier.records();
  }
}
