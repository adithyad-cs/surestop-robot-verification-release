// Offline recomputation of SureStop evidence from the inputs captured in each EvidenceRecord (P1-c).
// Evaluation-side tool: it reads records, never ground truth, and never feeds back into a mission.
import { assessForTarget, POSE_INVALID_FIELD, SureStopVerifier, type SureStopConfig } from "@/verify/surestop";
import type { DepthFeatures } from "@/sensing/depthFeatures";
import type { CandidateDecision, CandidateObservation, EvidenceRecord, ExhaustRule, Pose2, ViewAssessment } from "@/verify/types";
import { decodeNonFinite } from "@/verify/viewInputs";

export function observationFromRecord(rec: EvidenceRecord): CandidateObservation {
  const i = rec.inputs;
  if (!i) throw new Error(`evidence for frame ${rec.frameId} has no captured inputs (pre-P1 record)`);
  return {
    frameId: rec.frameId,
    t: rec.t,
    robot: decodeNonFinite<Pose2>(i.robot),
    detection: i.detection ? decodeNonFinite<NonNullable<CandidateObservation["detection"]>>(i.detection) : null,
    depth: i.depth ? decodeNonFinite<DepthFeatures>(i.depth) : null,
    positionWorld: null,
  };
}

/**
 * Recomputes one SureStop record's verdict from its inputs with the verifier's own code. The
 * invalid-pose override applies only while the candidate was still pending, which the record's
 * note states ("ignored: candidate already …"); replayCandidate derives that state itself.
 */
export function recomputeView(rec: EvidenceRecord, config: SureStopConfig): ViewAssessment {
  const i = rec.inputs!;
  if (i.targetClass === null) throw new Error("not a SureStop record (no target class)");
  const a = assessForTarget(observationFromRecord(rec), i.targetClass, config.evidence);
  const afterDecision = rec.note?.startsWith("ignored: candidate already") ?? false;
  const dist = decodeNonFinite<number>(i.candidateDistance);
  const bearing = decodeNonFinite<number>(i.bearingDeg);
  if (!afterDecision && (!Number.isFinite(dist) || !Number.isFinite(bearing))) {
    return { verdict: "INCONCLUSIVE", reason: "invalid robot pose or candidate position: view not used as evidence", invalidField: POSE_INVALID_FIELD };
  }
  return a;
}

/**
 * Replays a candidate's records, in order, through a fresh SureStopVerifier: each observation with
 * the candidate estimate it was made against. An UNCONFIRMED final decision was reached by
 * exhaust(), which is not an observation; it is applied with the recorded reason prefix.
 * Not reconstructable from evidence: `attempts` (planned viewpoints, counted by the policy).
 */
export function replayCandidate(evidence: EvidenceRecord[], config: SureStopConfig, final: CandidateDecision): { decision: CandidateDecision; records: EvidenceRecord[] } {
  if (!evidence.length) throw new Error("no evidence to replay");
  const first = evidence[0].inputs!;
  if (first.targetClass === null) throw new Error("not a SureStop record (no target class)");
  const v = new SureStopVerifier(config, decodeNonFinite<{ x: number; z: number }>(first.candidateEstimate), first.targetClass);
  for (const rec of evidence) {
    const est = decodeNonFinite<{ x: number; z: number }>(rec.inputs!.candidateEstimate);
    const cur = v.candidatePosition;
    if ((est.x !== cur.x || est.z !== cur.z) && Number.isFinite(est.x) && Number.isFinite(est.z)) v.setCandidatePosition(est);
    v.observe(observationFromRecord(rec));
  }
  if (final.status === "UNCONFIRMED" && v.decision().status === "PENDING") {
    const pending = v.decision().reason;
    const why = final.reason.endsWith(`; ${pending}`) ? final.reason.slice(0, -(pending.length + 2)) : final.reason;
    if (!final.rule || !final.rule.startsWith("exhaust-")) throw new Error(`UNCONFIRMED decision without an exhaust rule (${final.rule ?? "absent"})`);
    v.exhaust(why, final.rule as ExhaustRule);
  }
  return { decision: v.decision(), records: v.records() };
}
