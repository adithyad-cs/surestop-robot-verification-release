// What Mission Control selects for a mistyped method or scenario, or a missing layout, in a demo
// link (no mission is run). Rehearsal companion to scripts/dev/rehearse-demo.mjs.
// usage: SURESTOP_CHROMIUM=<chrome> node scripts/dev/demo-url-check.mjs <baseUrl>
import { chromium } from "@playwright/test";
const base = process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.SURESTOP_CHROMIUM, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage();
for (const q of [
  "scenario=lookalike-3d&seed=123&method=surestp&layout=v2",
  "scenario=lookalike3d&seed=123&method=surestop&layout=v2",
  "scenario=lookalike-3d&seed=123&method=surestop",
]) {
  await page.goto(`${base}/console?${q}`);
  await page.waitForFunction(() => ["ready", "error"].includes(window.__surestopConsole?.getState().phase), null, { timeout: 600_000 });
  const sel = async (id) => page.locator(`#${id}`).evaluate((el) => el.options[el.selectedIndex].text);
  console.log(JSON.stringify({ query: q, scenario: await sel("scenario"), method: await sel("method"), layout: await sel("layout"), layoutId: (await page.getByTestId("layout-id").innerText()).split(" ")[0], notice: await page.getByTestId("layout-notice").innerText().catch(() => null) }));
}
await browser.close();
