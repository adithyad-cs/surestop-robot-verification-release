// Screenshots of static routes at several viewports. Usage: node scripts/shots.mjs <baseUrl> <outDir> [routes...]
import { chromium } from "@playwright/test";
import fs from "node:fs";
const [baseUrl = "http://localhost:3000", outDir = "shots", ...routesArg] = process.argv.slice(2);
const routes = routesArg.length ? routesArg : ["/", "/method", "/lab"];
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 390, height: 844 },
];
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  for (const r of routes) {
    await page.goto(baseUrl + r, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const name = r === "/" ? "home" : r.slice(1).replace(/\//g, "-");
    await page.screenshot({ path: `${outDir}/${name}-${vp.name}.png`, fullPage: vp.name !== "desktop" });
    console.log(`${r} @${vp.name}: horizontal overflow ${overflow}px`);
  }
  if (errors.length) console.log(`errors @${vp.name}:`, errors.slice(0, 5));
  await page.close();
}
await browser.close();
