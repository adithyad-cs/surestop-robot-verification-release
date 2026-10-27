// Loads /console, runs one mission (animation skipped) and saves screenshots.
// Usage: node scripts/console-shot.mjs <baseUrl> <outDir> [query] [width] [height]
import { chromium } from "@playwright/test";
import fs from "node:fs";
const [baseUrl = "http://localhost:3000", outDir = "shots", query = "scenario=poster-decoy&seed=1&method=surestop", w = "1440", h = "900"] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const t0 = Date.now();
await page.goto(`${baseUrl}/console?${query}`);
await page.waitForFunction(() => ["ready", "error", "unsupported"].includes(window.__surestopConsole?.getState().phase), null, { timeout: 600000 });
console.log("ready after", (Date.now() - t0) / 1000, "s");
await page.screenshot({ path: `${outDir}/console-ready-${w}.png` });
await page.getByRole("radio", { name: /Maximum speed/ }).click();
await page.getByRole("button", { name: "Run mission" }).click();
await page.waitForTimeout(8000);
await page.screenshot({ path: `${outDir}/console-running-${w}.png` });
await page.waitForFunction(() => window.__surestopConsole?.getState().phase === "done", null, { timeout: 1200000, polling: 2000 });
console.log("done after", (Date.now() - t0) / 1000, "s");
await page.screenshot({ path: `${outDir}/console-done-${w}.png` });
await page.getByLabel("Show ground-truth labels in the scene").check().catch(() => {});
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/console-gt-${w}.png`, fullPage: true });
const heroes = await page.evaluate(() => {
  const fv = window.__surestopConsole.getState().frameViews;
  const pick = (v) => fv.find((f) => f.targets.some((t) => t.note.startsWith(v)));
  const out = {};
  for (const v of ["FLAT", "VOLUMETRIC"]) {
    const f = pick(v);
    if (f) out[v] = { rgb: f.rgbUrl, depth: f.depthUrl, frameId: f.frameId, targets: f.targets };
  }
  return out;
});
for (const [k, v] of Object.entries(heroes)) {
  fs.writeFileSync(`${outDir}/hero-${k}.jpg`, Buffer.from(v.rgb.split(",")[1], "base64"));
  fs.writeFileSync(`${outDir}/hero-${k}-depth.jpg`, Buffer.from(v.depth.split(",")[1], "base64"));
  console.log(k, v.frameId, JSON.stringify(v.targets));
}
console.log("errors:", errors.slice(0, 10));
await browser.close();
