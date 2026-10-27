// Demo rehearsal (docs/FINAL_DEMO_HANDOFF.md): drives the three demo scenarios through the real
// Mission Control UI the way a presenter would (open the link, Max, Run mission, click candidates,
// frame links, Next frame, Run again, Reset, the method dropdown) and records what the page shows,
// with screenshots. Also exercises navigation, a blocked model download and a reload mid-mission.
// Read-only towards the app: it changes nothing and needs no diagnostics build.
// usage: SURESTOP_CHROMIUM=<chrome> node scripts/dev/rehearse-demo.mjs <baseUrl> <outDir>
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const [baseUrl = "http://localhost:3000", outDir = "demo-rehearsal"] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const executablePath = process.env.SURESTOP_CHROMIUM || undefined;
const browser = await chromium.launch({ executablePath, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const log = { baseUrl, browser: `Chromium ${browser.version()}`, startedAt: new Date().toISOString(), steps: [] };
const record = (step, data) => {
  log.steps.push({ step, ...data });
  console.log(`${step}: ${JSON.stringify(data)}`);
};

async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  return { ctx, page, errors };
}
const phase = (page) => page.evaluate(() => window.__surestopConsole?.getState().phase);
async function waitPhase(page, want, timeoutMs) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const p = await phase(page);
    if (want.includes(p)) return p;
    if (Date.now() > end) throw new Error(`phase ${p}, wanted ${want}`);
    await page.waitForTimeout(1000);
  }
}
const setupText = (page) => page.locator('aside[aria-label="Mission setup and decision"]').innerText();
const shot = async (page, name) => {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  return file;
};

/** What the page shows after a mission: setup selections, outcome, candidates, evaluator. */
async function readScreen(page) {
  const method = await page.locator("#method").evaluate((el) => el.options[el.selectedIndex].text);
  const scenario = await page.locator("#scenario").evaluate((el) => el.options[el.selectedIndex].text);
  const seed = await page.locator("#seed").inputValue();
  const layoutId = (await page.getByTestId("layout-id").innerText()).split(" ")[0];
  const candidates = await page.locator(`aside[aria-label="Mission setup and decision"] li > button[aria-pressed]`).allInnerTexts();
  // innerText follows CSS text-transform (several labels render upper-case), so match case-insensitively.
  const text = await setupText(page);
  const grab = (re) => (text.match(re) ?? [null, null])[1];
  const evalBlock = page.locator("div", { has: page.locator("h2", { hasText: /^Evaluator/i }) }).last();
  const hasEval = (await evalBlock.count()) > 0;
  return {
    url: page.url().replace(baseUrl, ""),
    scenario, method, seed, layoutId,
    phase: grab(/Phase\s+(\S+)/i),
    simTime: grab(/Sim time\s+([\d.]+ s)/i),
    frames: grab(/Frames\s+(\d+)/i),
    outcome: grab(/Mission outcome \(robot\)\s+[●◌✕•]?\s*(\S+)/i),
    outcomeReason: grab(/Mission outcome \(robot\)\s+[●◌✕•]?\s*\S+\s+([^\n]+)/i),
    candidates: candidates.map((c) => c.replace(/\s+/g, " ").trim()),
    evaluator: hasEval ? (await evalBlock.locator("p").nth(1).innerText()).trim() : null,
    evaluatorLabels: hasEval ? (await evalBlock.locator("ul").first().allInnerTexts()).join(" | ").replace(/\s+/g, " ") : null,
  };
}
/** Scrolls the Evaluator into view for a second screenshot (it sits below the fold at 1440×900). */
async function evaluatorShot(page, name) {
  await page.locator("h2", { hasText: /^Evaluator/i }).evaluate((el) => el.scrollIntoView({ block: "center" }));
  return shot(page, name);
}
async function runMission(page, button = "Run mission") {
  await page.getByRole("radio", { name: /Maximum speed/ }).click();
  await page.getByRole("button", { name: button }).click();
  await waitPhase(page, ["done"], 15 * 60_000);
}
async function selectCandidate(page, id) {
  await page.locator(`aside[aria-label="Mission setup and decision"] li > button[aria-pressed]`, { hasText: id }).click();
  return (await page.locator("p", { hasText: new RegExp(`^${id} `) }).first().innerText()).trim();
}

// ---- A: the original failure (surestop, seed 123)
{
  const { ctx, page, errors } = await newPage();
  await page.goto(`${baseUrl}/console?scenario=lookalike-3d&seed=123&method=surestop&layout=v2`);
  await waitPhase(page, ["ready"], 10 * 60_000);
  await runMission(page);
  const a = await readScreen(page);
  a.C1 = await selectCandidate(page, "C1");
  a.screenshot = await shot(page, "A-surestop-seed123-false-arrival");
  a.evaluatorScreenshot = await evaluatorShot(page, "A-surestop-seed123-evaluator");
  record("A first run", a);
  // Repeat: "Run again" rebuilds the same world and runs it again.
  await page.getByRole("button", { name: "Run again" }).click();
  await waitPhase(page, ["done"], 15 * 60_000);
  const again = await readScreen(page);
  record("A run again", { outcome: again.outcome, evaluator: again.evaluator, evaluatorLabels: again.evaluatorLabels, candidates: again.candidates, frames: again.frames, simTime: again.simTime, sameAsFirst: again.outcome === a.outcome && again.evaluator === a.evaluator && again.frames === a.frames && JSON.stringify(again.candidates) === JSON.stringify(a.candidates) });
  // Reset clears the mission without starting one.
  await page.getByRole("button", { name: "Reset" }).click();
  await waitPhase(page, ["ready"], 10 * 60_000);
  const r = await readScreen(page);
  record("A reset", { phase: r.phase, frames: r.frames, outcome: r.outcome, candidates: r.candidates, noCandidateText: (await setupText(page)).includes("No candidate yet"), errors });
  await ctx.close();
}

// ---- B: the identity-conflict check (surestop-identity, seed 123) and the evidence trace
{
  const { ctx, page, errors } = await newPage();
  await page.goto(`${baseUrl}/console?scenario=lookalike-3d&seed=123&method=surestop-identity&layout=v2`);
  await waitPhase(page, ["ready"], 10 * 60_000);
  await runMission(page);
  const b = await readScreen(page);
  b.C2 = await selectCandidate(page, "C2");
  b.C1 = await selectCandidate(page, "C1");
  b.identityConflicts = (await page.getByTestId("identity-conflicts").innerText()).replace(/\s+/g, " ").trim();
  b.screenshot = await shot(page, "B-identity-seed123-C1-withheld");
  b.evaluatorScreenshot = await evaluatorShot(page, "B-identity-seed123-evaluator");
  record("B run", b);
  // The conflict's frame link opens that earlier frame with its capture-time pose.
  await page.getByTestId("identity-conflicts").getByRole("button", { name: /Show frame/ }).first().click();
  const text = await setupText(page);
  const trace = {
    poseNow: (text.match(/Pose \(now\)\s+([^\n]+)/) ?? [])[1],
    captureRow: (await page.getByTestId("capture-pose").innerText()).trim(),
    captureLabel: (text.match(/Pose at #(\d+)/) ?? [])[1],
    cameraImage: await page.getByRole("img", { name: /Robot camera frame \d+/ }).first().getAttribute("alt").catch(() => null),
    frameConflicts: (await page.getByTestId("frame-conflicts").innerText()).replace(/\s+/g, " ").trim(),
  };
  trace.screenshot = await shot(page, "B-identity-seed123-frame11-capture-pose");
  record("B trace", trace);
  // Step to the newest frame with the scrubber's Next button: the capture-pose row must go away.
  let presses = 0;
  while (await page.getByRole("button", { name: "Next frame" }).isEnabled() && presses < 200) {
    await page.getByRole("button", { name: "Next frame" }).click();
    presses++;
  }
  record("B newest frame", { nextPresses: presses, captureRowCount: await page.getByTestId("capture-pose").count(), errors });
  await ctx.close();
}

// ---- C: a real flat-decoy rejection (photo-board seed 17): single-frame, then the dropdown
{
  const { ctx, page, errors } = await newPage();
  await page.goto(`${baseUrl}/console?scenario=photo-board-decoy&seed=17&method=single-frame&layout=v2`);
  await waitPhase(page, ["ready"], 10 * 60_000);
  await runMission(page);
  const c1 = await readScreen(page);
  c1.C1 = await selectCandidate(page, "C1");
  c1.screenshot = await shot(page, "C-single-frame-seed17-false-arrival");
  c1.evaluatorScreenshot = await evaluatorShot(page, "C-single-frame-seed17-evaluator");
  record("C single-frame", c1);
  // Method selection through the dropdown (what a presenter does), then Run mission.
  await page.getByRole("button", { name: "Reset" }).click();
  await waitPhase(page, ["ready"], 10 * 60_000);
  await page.locator("#method").selectOption("surestop-identity");
  await waitPhase(page, ["ready"], 10 * 60_000);
  await runMission(page);
  const c2 = await readScreen(page);
  c2.C2 = await selectCandidate(page, "C2");
  c2.C1 = await selectCandidate(page, "C1");
  c2.C1evidence = (await page.getByRole("region", { name: "Evidence table for candidate C1" }).innerText()).replace(/\t/g, " ").split("\n").filter(Boolean);
  c2.screenshot = await shot(page, "C-identity-seed17-board-rejected");
  c2.evaluatorScreenshot = await evaluatorShot(page, "C-identity-seed17-evaluator");
  c2.errors = errors;
  record("C surestop-identity via dropdown", c2);
  await ctx.close();
}

// ---- Navigation, Method page and error states
{
  const { ctx, page, errors } = await newPage();
  await page.goto(`${baseUrl}/`);
  await page.getByRole("link", { name: /ENTER SYSTEM/i }).click();
  await page.waitForURL(/\/console/);
  const landing = page.url().replace(baseUrl, "");
  const method = await page.goto(`${baseUrl}/method`).then(() => page.locator("main").innerText());
  const has = (s) => method.includes(s);
  record("navigation", {
    enterSystemOpens: landing,
    methodPage: {
      matrix: has("294 missions = 7 scenarios × 14 seeds × 3 methods"),
      singleFrame: has("false arrivals 13/98") && has("correct arrivals 45/84"),
      surestop: has("false arrivals 1/98") && has("correct arrivals 83/84"),
      identity: has("false arrivals 0/98") && has("correct arrivals 84/84"),
      notSignificant: has("not a statistically established improvement"),
      notIdentitySystem: has("not a general semantic identity system"),
      decoyExposure: has("5 of 14 screen-decoy"),
    },
    lab: (await page.goto(`${baseUrl}/lab`)).status(),
    unknownRoute: (await page.goto(`${baseUrl}/no-such-page`)).status(),
    errors: errors.filter((e) => !e.includes("404")),
  });
  await page.goto(`${baseUrl}/console?scenario=lookalike-3d&seed=123&method=surestop&layout=v9`);
  await page.waitForTimeout(3000);
  record("bad layout parameter", { phase: await phase(page), alert: (await page.getByRole("alert").allInnerTexts()).join(" | ").replace(/\s+/g, " ") });
  await ctx.close();
}
{
  // The detector weights cannot be fetched: the console must say so and show nothing invented.
  const { ctx, page } = await newPage();
  await page.route("**/models/**", (r) => r.abort());
  await page.goto(`${baseUrl}/console?scenario=lookalike-3d&seed=123&method=surestop-identity&layout=v2`);
  const p = await waitPhase(page, ["error", "ready", "unsupported"], 5 * 60_000);
  record("model download blocked", { phase: p, alert: (await page.getByRole("alert").allInnerTexts()).join(" | ").replace(/\s+/g, " "), screenshot: await shot(page, "E-model-blocked") });
  await ctx.close();
}
{
  // Reload in the middle of a mission, then run it to the end.
  const { ctx, page, errors } = await newPage();
  const url = `${baseUrl}/console?scenario=lookalike-3d&seed=123&method=surestop-identity&layout=v2`;
  await page.goto(url);
  await waitPhase(page, ["ready"], 10 * 60_000);
  await page.getByRole("button", { name: "Run mission" }).click();
  await page.waitForFunction(() => (window.__surestopConsole?.getState().frames ?? 0) >= 3, null, { timeout: 5 * 60_000 });
  const before = await readScreen(page);
  await page.reload();
  const afterReload = await waitPhase(page, ["ready"], 10 * 60_000);
  const fresh = await readScreen(page);
  await runMission(page);
  const end = await readScreen(page);
  record("reload mid-mission", { phaseBefore: before.phase, framesBefore: before.frames, phaseAfterReload: afterReload, framesAfterReload: fresh.frames, methodAfterReload: fresh.method, rerunOutcome: end.outcome, rerunEvaluator: end.evaluator, rerunEvaluatorLabels: end.evaluatorLabels, rerunCandidates: end.candidates, errors });
  await ctx.close();
}

await browser.close();
log.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(outDir, "rehearsal.json"), JSON.stringify(log, null, 1) + "\n");
console.log(`wrote ${path.join(outDir, "rehearsal.json")}`);
