export interface RunLayout {
  version: string;
  id: string | null;
  fallback: boolean;
  valid: boolean | null;
}
export declare function runLayout(r: object): RunLayout;
export declare function sameLayout(a: object, b: object): boolean;
export declare const layoutTag: (r: object) => string;
export declare const runKey: (r: object) => string;
export declare function layoutVersions(runs: object[]): Record<string, number>;
