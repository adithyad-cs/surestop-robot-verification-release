// Build metadata from the repository's actual Git state, computed when next.config.ts is loaded
// (next build / next dev) and injected as NEXT_PUBLIC_SURESTOP_BUILD_META.
//
// - sourceCommit: `git rev-parse HEAD`.
// - sourceDirty: true if `git status --porcelain --untracked-files=all` lists anything (tracked
//   changes or untracked, non-ignored files). Never reported clean when it is not.
// - dirtyFingerprint: SHA-256 over `git diff HEAD --binary` plus each untracked file's path and
//   content hash, so two builds of the same dirty tree get the same buildId.
// - buildId: sourceCommit for a clean tree, `<commit>-dirty-<first 12 hex of the fingerprint>` for
//   a dirty one. No timestamps, so the value is deterministic for a given tree.
// - When Git is unavailable, falls back to VERCEL_GIT_COMMIT_SHA with sourceDirty = null
//   (unknown); otherwise every Git field is null and `unavailableReason` says why.
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const BUILD_META_SCHEMA = "surestop.build-meta/1";

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

export function computeBuildMeta({ cwd = process.cwd(), env = process.env, git } = {}) {
  const run = git ?? ((args) => execFileSync("git", args, { cwd, encoding: "buffer", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 }));
  const mode = env.NODE_ENV === "production" ? "production" : "development";
  try {
    const commit = run(["rev-parse", "HEAD"]).toString().trim();
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`unexpected commit "${commit}"`);
    const status = run(["status", "--porcelain=v1", "--untracked-files=all"]).toString();
    const dirty = status.trim().length > 0;
    let fingerprint = null;
    if (dirty) {
      const h = crypto.createHash("sha256");
      h.update(run(["diff", "HEAD", "--binary"]));
      const untracked = run(["ls-files", "--others", "--exclude-standard", "-z"]).toString().split("\0").filter(Boolean).sort();
      for (const f of untracked) {
        const p = path.join(cwd, f);
        h.update(`\0${f}\0${fs.existsSync(p) && fs.statSync(p).isFile() ? sha256(fs.readFileSync(p)) : "missing"}`);
      }
      fingerprint = h.digest("hex");
    }
    return {
      schema: BUILD_META_SCHEMA,
      source: "git",
      sourceCommit: commit,
      sourceDirty: dirty,
      dirtyFingerprint: fingerprint,
      buildId: dirty ? `${commit}-dirty-${fingerprint.slice(0, 12)}` : commit,
      mode,
      unavailableReason: null,
    };
  } catch (e) {
    const vercel = env.VERCEL_GIT_COMMIT_SHA;
    if (vercel && /^[0-9a-f]{40}$/.test(vercel)) {
      return { schema: BUILD_META_SCHEMA, source: "vercel-env", sourceCommit: vercel, sourceDirty: null, dirtyFingerprint: null, buildId: null, mode, unavailableReason: "git unavailable; commit from VERCEL_GIT_COMMIT_SHA, working-tree state unknown" };
    }
    return { schema: BUILD_META_SCHEMA, source: "unavailable", sourceCommit: null, sourceDirty: null, dirtyFingerprint: null, buildId: null, mode, unavailableReason: `git unavailable: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}` };
  }
}
