// Provenance of experiment records (experiment layer only: robot-facing modules never import this).
//
// missionConfigHash  identifies the effective MissionConfig of one mission:
//                    SHA-256 of canonicalJson({ schema: MISSION_CONFIG_SCHEMA, config }).
// protocolHash       identifies a batch's shared protocol: SHA-256 of canonicalJson(descriptor), where
//                    the descriptor lists the seeds, layout, asset swap, every variant (label, method,
//                    its missionConfigHash) in the order run, and the evaluator settings. The
//                    scenario list is deliberately NOT part of it: batches of one protocol are split
//                    across processes by scenario (README, "Reproduce experiments").
// artifacts          group hashes from the committed, test-checked artifact manifest.
// runtime            values measured in the running page; anything unavailable is null and listed.
import type { MissionConfig } from "@/mission/types";
import type { MethodId } from "@/policies/types";
import type { DetectorInfo } from "@/perception/types";
import type { BackendChoice } from "@/perception/backend";
import type { LayoutVersion } from "@/scenarios/layout";
import { LABEL_RADIUS } from "@/eval/evaluate";
import { CANONICAL_JSON_VERSION, hashCanonical } from "@/lib/canonical";
import manifest from "./artifact-manifest.json";
import { readBuildMeta, type BuildMeta } from "./build";

export const RUN_RECORD_SCHEMA = "surestop.run-record/2";
export const RUN_PROVENANCE_SCHEMA = "surestop.run-provenance/1";
export const MISSION_CONFIG_SCHEMA = "surestop.mission-config/1";
export const PROTOCOL_SCHEMA = "surestop.protocol/1";

export interface ArtifactHashes {
  manifestSchema: string;
  /** model.json and every weight shard it references. */
  detectorSha256: string;
  /** TF.js WASM binaries. */
  runtimeSha256: string;
  /** 3-D asset files (GLB). */
  assetsSha256: string;
}

export const ARTIFACTS: ArtifactHashes = {
  manifestSchema: manifest.schema,
  detectorSha256: manifest.detector.sha256,
  runtimeSha256: manifest.runtime.sha256,
  assetsSha256: manifest.assets.sha256,
};

export interface RuntimeInfo {
  /** navigator.userAgent of the page that ran the mission. */
  userAgent: string | null;
  hardwareConcurrency: number | null;
  /** TF.js backend actually in use (tf.getBackend() after load). */
  tfBackend: string | null;
  /** Why that backend was chosen (BackendChoice.reason). */
  backendReason: string | null;
  /** WebGL renderer string read from the GPU (null if not probed, e.g. backend set explicitly). */
  glRenderer: string | null;
  detector: DetectorInfo | null;
  /** Names of fields that could not be measured, with the reason. */
  unavailable: string[];
}

/** `nav` defaults to the global navigator; pass null to model a runtime without one. */
export function measureRuntime(engine: { backend?: BackendChoice | null; detector?: DetectorInfo | null }, nav: Partial<Navigator> | null = typeof navigator === "undefined" ? null : navigator): RuntimeInfo {
  const unavailable: string[] = [];
  const userAgent = typeof nav?.userAgent === "string" && nav.userAgent ? nav.userAgent : null;
  if (userAgent === null) unavailable.push("userAgent: no navigator in this runtime");
  const hc = nav?.hardwareConcurrency;
  const hardwareConcurrency = typeof hc === "number" && Number.isFinite(hc) && hc > 0 ? hc : null;
  if (hardwareConcurrency === null) unavailable.push("hardwareConcurrency: not reported by this runtime");
  const detector = engine.detector ?? null;
  if (!detector) unavailable.push("detector: no detector loaded");
  const glRenderer = engine.backend?.glRenderer ?? null;
  if (glRenderer === null) unavailable.push("glRenderer: WebGL renderer not probed");
  return { userAgent, hardwareConcurrency, tfBackend: detector?.backend ?? null, backendReason: engine.backend?.reason ?? null, glRenderer, detector, unavailable };
}

export function missionConfigHash(config: MissionConfig): Promise<string | null> {
  return hashCanonical({ schema: MISSION_CONFIG_SCHEMA, config });
}

export interface ProtocolVariant {
  label: string;
  method: MethodId;
  missionConfigHash: string | null;
}

export interface ProtocolDescriptor {
  schema: typeof PROTOCOL_SCHEMA;
  seeds: number[];
  layout: LayoutVersion;
  /** Asset-holdout swap, when the batch uses one (none in this branch). */
  swap: Record<string, string> | null;
  variants: ProtocolVariant[];
  evaluator: { labelRadius: number };
}

export interface Protocol {
  descriptor: ProtocolDescriptor;
  /** null when Web Crypto is unavailable or a variant's config could not be hashed. */
  hash: string | null;
}

export async function describeProtocol(spec: {
  seeds: number[];
  layout: LayoutVersion;
  variants: Array<{ label: string; method: MethodId; config: MissionConfig }>;
}): Promise<Protocol> {
  const variants: ProtocolVariant[] = [];
  for (const v of spec.variants) variants.push({ label: v.label, method: v.method, missionConfigHash: await missionConfigHash(v.config) });
  const descriptor: ProtocolDescriptor = { schema: PROTOCOL_SCHEMA, seeds: [...spec.seeds], layout: spec.layout, swap: null, variants, evaluator: { labelRadius: LABEL_RADIUS } };
  const hash = variants.every((v) => v.missionConfigHash !== null) ? await hashCanonical(descriptor) : null;
  return { descriptor, hash };
}

export interface RunProvenance {
  schema: typeof RUN_PROVENANCE_SCHEMA;
  canonicalization: typeof CANONICAL_JSON_VERSION;
  build: BuildMeta;
  missionConfigHash: string | null;
  /** null for a mission that is not part of a batch protocol (e.g. one Mission Control run). */
  protocolHash: string | null;
  artifacts: ArtifactHashes;
  runtime: RuntimeInfo;
  /** Fields that are null because they could not be computed here, with the reason. */
  unavailable: string[];
}

export async function makeRunProvenance(args: { config: MissionConfig; protocol: Protocol | null; runtime: RuntimeInfo; build?: BuildMeta }): Promise<RunProvenance> {
  const build = args.build ?? readBuildMeta();
  const cfgHash = await missionConfigHash(args.config);
  const unavailable: string[] = [];
  if (build.sourceCommit === null) unavailable.push(`build: ${build.unavailableReason ?? "unknown"}`);
  if (cfgHash === null) unavailable.push("missionConfigHash: Web Crypto (crypto.subtle) unavailable");
  if (args.protocol === null) unavailable.push("protocolHash: not part of a batch protocol");
  else if (args.protocol.hash === null) unavailable.push("protocolHash: could not be computed");
  return {
    schema: RUN_PROVENANCE_SCHEMA,
    canonicalization: CANONICAL_JSON_VERSION,
    build,
    missionConfigHash: cfgHash,
    protocolHash: args.protocol?.hash ?? null,
    artifacts: ARTIFACTS,
    runtime: args.runtime,
    unavailable,
  };
}
