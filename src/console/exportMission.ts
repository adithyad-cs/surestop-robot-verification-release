// Mission Control "Export mission JSON" payload. Pure, so its consistency rules are unit-tested.
import type { MissionResult } from "@/mission/types";
import type { TrialScore } from "@/eval/evaluate";
import type { RecordedLayout } from "@/scenarios/generate";
import type { RunProvenance } from "@/provenance/run";
import type { EvaluatorObjects } from "@/provenance/objects";

/**
 * /3 adds `provenance` and `objects` (P1): the same blocks as a batch RunRecord. A single Mission
 * Control run belongs to no batch protocol, so provenance.protocolHash is null. Either block is null
 * if it could not be computed.
 */
export interface ConsoleMissionExport {
  schema: "surestop.console-mission/3";
  scenarioId: string;
  seed: number;
  method: string;
  /** Same shape as RunRecord.layout: id, fallback flag and validation status cannot disagree. */
  layout: RecordedLayout;
  /** Ground-truth zones (evaluator side), exported after the mission only. */
  zones: Record<string, string> | null;
  result: MissionResult;
  score: TrialScore;
  provenance: RunProvenance | null;
  /** Evaluator-only object and asset provenance, exported after the mission only. */
  objects: EvaluatorObjects | null;
}

export function buildMissionExport(s: {
  scenarioId: string;
  seed: number;
  method: string;
  layoutRecord: RecordedLayout | null;
  layoutZones: Record<string, string> | null;
  result: MissionResult | null;
  score: TrialScore | null;
  provenance?: RunProvenance | null;
  objects?: EvaluatorObjects | null;
}): ConsoleMissionExport {
  if (!s.result || !s.score) throw new Error("no finished mission to export");
  if (!s.layoutRecord) throw new Error("no layout record for the finished mission");
  if (s.result.scenarioId !== s.scenarioId || s.result.seed !== s.seed) {
    throw new Error(`mission ${s.result.scenarioId}/${s.result.seed} does not match the selected ${s.scenarioId}/${s.seed}`);
  }
  return {
    schema: "surestop.console-mission/3",
    scenarioId: s.scenarioId,
    seed: s.seed,
    method: s.method,
    layout: s.layoutRecord,
    zones: s.layoutZones,
    result: s.result,
    score: s.score,
    provenance: s.provenance ?? null,
    objects: s.objects ?? null,
  };
}

export function missionExportFilename(e: ConsoleMissionExport): string {
  return `surestop-${e.scenarioId}-seed${e.seed}-${e.layout.id}-${e.method}.json`;
}
