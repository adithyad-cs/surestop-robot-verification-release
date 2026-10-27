// Mission Control URL parameters. Kept free of React and the DOM so the rules can be unit-tested.
//
// World layout rules:
// - fresh visit (no scenario, seed or method in the URL) → v2, the seeded layout;
// - explicit layout=v1 or layout=v2 → that layout;
// - a link with scenario/seed/method but no layout (every link made before v2 existed, e.g. Lab
//   replays and docs) → v1, the layout that link reproduced, with a visible notice;
// - any other layout value → an error; no world is built.
import { SCENARIOS, type LayoutVersion } from "@/scenarios/layout";
import { parseLayoutParam } from "@/scenarios/generate";
import type { MethodId } from "@/policies/types";

export const CONSOLE_METHODS: MethodId[] = ["surestop", "surestop-identity", "single-frame", "persistence", "surestop-1view"];

/** Method preselected for fresh visits and new-style links without a method. */
export const DEFAULT_CONSOLE_METHOD: MethodId = "surestop-identity";

export type LayoutSource = "default" | "explicit" | "legacy";

export interface ConsoleParams {
  scenario: string;
  seed: number;
  method: MethodId;
  /** null when the URL's layout value was rejected. */
  layout: LayoutVersion | null;
  layoutSource: LayoutSource;
  layoutError: string | null;
  /** Shown to the user when a legacy link was opened with v1. */
  layoutNotice: string | null;
  backend: string | null;
}

export const LEGACY_LAYOUT_NOTICE =
  "This link has no layout parameter, so it opened the recorded-evaluation layout (v1) it was made for. Choose “Seeded variation (v2)” to vary the room with the seed.";

export function parseConsoleParams(search: string): ConsoleParams {
  const q = new URLSearchParams(search);
  const scenario = SCENARIOS.some((s) => s.id === q.get("scenario")) ? q.get("scenario")! : "poster-decoy";
  const seedN = Number(q.get("seed"));
  // Unchanged from the original rule: an absent seed reads as Number(null) = 0.
  const seed = Number.isInteger(seedN) && seedN >= 0 ? seedN : 1;
  const legacy = !q.has("layout") && (q.has("scenario") || q.has("seed") || q.has("method"));
  // A legacy link reproduces what it showed when it was made: "surestop". Otherwise the default is the
  // identity-conflict check, which met its frozen development criteria
  // (docs/experiments/identity-conflict/REPORT.md); it remains experimental.
  const fallback: MethodId = legacy ? "surestop" : DEFAULT_CONSOLE_METHOD;
  const method = (CONSOLE_METHODS as string[]).includes(q.get("method") ?? "") ? (q.get("method") as MethodId) : fallback;
  const backend = q.get("backend");
  if (q.has("layout")) {
    const p = parseLayoutParam(q.get("layout"), "v2");
    return { scenario, seed, method, backend, layout: p.layout, layoutSource: "explicit", layoutError: p.error, layoutNotice: null };
  }
  return legacy
    ? { scenario, seed, method, backend, layout: "v1", layoutSource: "legacy", layoutError: null, layoutNotice: LEGACY_LAYOUT_NOTICE }
    : { scenario, seed, method, backend, layout: "v2", layoutSource: "default", layoutError: null, layoutNotice: null };
}
