// Dev helper: opens Mission Control, polls its state and saves a screenshot.
// Usage: node scripts/dev/diag-console.mjs [baseUrl] [screenshot.png]
import { chromium } from "@playwright/test";
const [baseUrl = "http://localhost:3000", shot = "diag.png"] = process.argv.slice(2);
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on("pageerror", (e) => logs.push("pageerror " + String(e)));
page.on("console", (m) => logs.push(m.type() + " " + m.text()));
await page.goto(`${baseUrl}/console?scenario=poster-decoy&seed=1&method=surestop`);
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(10000);
  const st = await page.evaluate(() => { const c = window.__surestopConsole; return c ? { phase: c.getState().phase, stage: c.getState().stage, error: c.getState().error } : null; });
  console.log(i * 10 + 10, "s", JSON.stringify(st));
  if (st && (st.phase === "ready" || st.phase === "error" || st.phase === "unsupported")) break;
}
await page.screenshot({ path: shot });
console.log(logs.slice(0, 15).join("\n"));
await browser.close();
