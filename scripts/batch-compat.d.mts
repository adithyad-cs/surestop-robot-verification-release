export type BatchKind = "legacy" | "p1" | "inconsistent";

export declare function classify(file: { provenance?: unknown; runs?: object[] }): BatchKind;

export declare function checkMergeCompatibility(
  files: unknown[],
  names?: string[],
): { mode: "legacy" | "p1" | "mixed" | "inconsistent"; errors: string[]; warnings: string[] };
