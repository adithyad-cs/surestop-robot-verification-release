// Drives /diagnostics/perception in headless Chromium and writes the raw report.
// Needs a build with SURESTOP_DIAGNOSTICS=1 (npm run build:diagnostics) or `next dev`.
// Usage: node scripts/feasibility.mjs [baseUrl] [query] [outDir]
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const baseUrl = process.argv[2] ?? "http://localhost:3000";
const query = process.argv[3] ?? "run=1&assets=plant&decoys=&thumbs=1";
const outDir = process.argv[4] ?? "feasibility-out";
fs.mkdirSync(path.join(outDir, "frames"), { recursive: true });

const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(String(e)));
const t0 = Date.now();
const resp = await page.goto(`${baseUrl}/diagnostics/perception?${query}`, { waitUntil: "load" });
if (!resp || resp.status() === 404) {
  console.error("/diagnostics/perception is not available on this server. Build with SURESTOP_DIAGNOSTICS=1 (npm run build:diagnostics) or use next dev.");
  await browser.close();
  process.exit(2);
}
let last = "";
for (;;) {
  const done = await page.evaluate(() => !!window.__SURESTOP_FEASIBILITY__);
  if (done) break;
  const p = await page.textContent('[data-testid="progress"]').catch(() => "");
  if (p !== last) { process.stdout.write(`\r${p}   (${((Date.now() - t0) / 1000).toFixed(0)} s)`); last = p; }
  await page.waitForTimeout(2000);
  if (Date.now() - t0 > 3 * 3600 * 1000) throw new Error("timeout");
}
const report = await page.evaluate(() => window.__SURESTOP_FEASIBILITY__);
await browser.close();
console.log("");
if (report.error) { console.error(report.error); process.exit(1); }
for (const r of report.records) {
  if (r.thumb) {
    fs.writeFileSync(path.join(outDir, "frames", `${r.id}.jpg`), Buffer.from(r.thumb.split(",")[1], "base64"));
    delete r.thumb;
  }
}
report.consoleErrors = consoleErrors;
report.wallClockS = (Date.now() - t0) / 1000;
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ detector: report.detector, webgl: report.webgl, latency: report.latency, depthValidation: report.depthValidation, wallClockS: report.wallClockS, consoleErrors: consoleErrors.slice(0, 5) }, null, 1));
console.table(report.summary);
