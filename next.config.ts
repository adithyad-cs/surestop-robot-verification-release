import type { NextConfig } from "next";
import { computeBuildMeta } from "./scripts/build-meta.mjs";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Do not auto-generate AGENTS.md / CLAUDE.md in the working tree.
  agentRules: false,
  // Provenance: the repository's Git state when this build (or dev server) started. Read by
  // src/provenance/build.ts; see scripts/build-meta.mjs for the field definitions.
  env: { NEXT_PUBLIC_SURESTOP_BUILD_META: JSON.stringify(computeBuildMeta()) },
};

export default nextConfig;
