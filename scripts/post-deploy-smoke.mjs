// Post-deployment smoke test for the SureStop baseline prototype.
// Usage, from a checkout with node_modules installed:
//   node scripts/post-deploy-smoke.mjs https://<deployment-host>
// Exits 0 only if every check passes. The expected demo outcomes are the ones reproduced on the
// production builds of the original prototype (9e2ef2f) and of this branch on 2026-10-25.
// The demo scenes name scenario, seed and method but no layout, so they open layout v1.
import { chromium } from "@playwright/test";

const base = (process.argv[2] || "").replace(/\/$/, "");
if (!/^https?:\/\//.test(base)) {
  console.error("usage: node scripts/post-deploy-smoke.mjs <base-url>");
  process.exit(2);
}

const fetchChecks = [
  // [path, expected status, expected content-type prefix or null]
  ["/", 200, "text/html"],
  ["/console", 200, "text/html"],
  ["/lab", 200, "text/html"],
  ["/method", 200, "text/html"],
  ["/models/coco-ssd/lite_mobilenet_v2/model.json", 200, "application/json"],
  ["/models/coco-ssd/lite_mobilenet_v2/group1-shard1of5", 200, null],
  ["/tfjs-wasm/tfjs-backend-wasm.wasm", 200, "application/wasm"],
  ["/data/eval-runs.json", 200, "application/json"],
  ["/diagnostics/mission", 404, null], // research harness must stay off in production
  ["/no-such-page", 404, null],
];

// [scenario, seed, method, expected outcome, expected evaluator text, expected track statuses]
const scenes = [
  ["photo-board-decoy", 1002, "single-frame", "ARRIVED", "False arrival", ["C1:CONFIRMED"]],
  ["photo-board-decoy", 1002, "surestop", "ARRIVED", "Correct arrival", ["C1:REJECTED", "C2:CONFIRMED"]],
  ["lookalike-3d", 1001, "surestop", "ARRIVED", "Correct arrival", ["C1:UNCONFIRMED", "C2:CONFIRMED"]],
];

(async () => {
  let failures = 0;
  const fail = (msg) => { failures++; console.log(`FAIL ${msg}`); };

  for (const [path, status, type] of fetchChecks) {
    const r = await fetch(base + path, { redirect: "follow" });
    const ct = r.headers.get("content-type") || "";
    if (r.status !== status) fail(`${path}: HTTP ${r.status}, expected ${status}`);
    else if (type && !ct.startsWith(type)) fail(`${path}: content-type "${ct}", expected ${type}`);
    else console.log(`ok   ${path} ${r.status} ${ct}`);
  }

  // Same software-rendering flags as the recorded runs, so the WASM backend path is exercised.
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  for (const route of ["/", "/console", "/lab", "/method"]) {
    const p = await browser.newPage();
    const errs = [];
    p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    p.on("pageerror", (e) => errs.push(String(e)));
    await p.goto(base + route, { waitUntil: "networkidle" });
    if (errs.length) fail(`${route}: ${errs.length} console error(s): ${errs[0]}`);
    else console.log(`ok   ${route} renders without console errors`);
    await p.close();
  }

  for (const [sc, seed, method, outcome, evalText, tracks] of scenes) {
    const p = await browser.newPage();
    const errs = [];
    p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    const name = `${sc}/${seed}/${method}`;
    try {
      await p.goto(`${base}/console?scenario=${sc}&seed=${seed}&method=${method}`);
      const phase = () => p.evaluate(() => { try { return window.__surestopConsole.getState().phase; } catch { return null; } });
      for (let i = 0; i < 150 && (await phase()) !== "ready"; i++) await p.waitForTimeout(2000);
      if ((await phase()) !== "ready") throw new Error("console never became ready (model or asset load failed?)");
      await p.getByRole("radio", { name: /Maximum speed/ }).click();
      await p.getByRole("button", { name: "Run mission" }).click();
      for (let i = 0; i < 400 && (await phase()) !== "done"; i++) await p.waitForTimeout(3000);
      if ((await phase()) !== "done") throw new Error("mission did not finish");
      const r = await p.evaluate(() => {
        const s = window.__surestopConsole.getState().result;
        return { outcome: s.outcome, tracks: s.tracks.map((t) => `${t.id}:${t.status}`) };
      });
      const body = await p.locator("body").innerText();
      const ok = r.outcome === outcome && body.includes(evalText) && JSON.stringify(r.tracks) === JSON.stringify(tracks) && errs.length === 0;
      if (ok) console.log(`ok   ${name}: ${r.outcome}, ${r.tracks.join(" ")}, "${evalText}"`);
      else fail(`${name}: got ${JSON.stringify(r)}, evaluator "${evalText}" ${body.includes(evalText) ? "present" : "absent"}, ${errs.length} console error(s)`);
    } catch (e) {
      fail(`${name}: ${e.message}`);
    }
    await p.close();
  }
  await browser.close();
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
})();
