import { expect, test, type Page } from "@playwright/test";
import { consolePhase, trackErrors } from "./helpers";

type Ctl = {
  getState(): { phase: string; frames: number; result: unknown; layout: string; layoutId: string | null; seed: number; scenarioId: string };
  prepared: { inst: { objects: Array<{ id: string; x: number; z: number }> } } | null;
};

const state = (page: Page) => page.evaluate(() => (window as unknown as { __surestopConsole: Ctl }).__surestopConsole.getState());
/** World actually built by the console (positions of every placed object). */
const builtObjects = (page: Page) =>
  page.evaluate(() => (window as unknown as { __surestopConsole: Ctl }).__surestopConsole.prepared!.inst.objects.map((o) => `${o.id}@${o.x.toFixed(2)},${o.z.toFixed(2)}`).join(" "));

async function ready(page: Page) {
  await expect.poll(() => consolePhase(page), { timeout: 600_000, intervals: [1000] }).toBe("ready");
}

test("seed, scenario and layout changes rebuild the world without starting a mission", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/console?scenario=clear-target&seed=0&method=surestop&layout=v2");
  await ready(page);
  const layoutLine = page.getByTestId("layout-id");
  await expect(page.getByLabel("World layout")).toHaveValue("v2");
  const s0 = await state(page);
  expect(s0.layout).toBe("v2");
  expect(s0.layoutId).toMatch(/^v2-[0-9a-f]{8}$/);
  await expect(layoutLine).toContainText(s0.layoutId!);
  const world0 = await builtObjects(page);

  // Seed 17: a different layout, rebuilt but not run.
  await page.getByLabel("Seed", { exact: true }).fill("17");
  await expect.poll(async () => (await state(page)).layoutId, { timeout: 120_000 }).not.toBe(s0.layoutId);
  await ready(page);
  const s17 = await state(page);
  expect(s17.seed).toBe(17);
  expect(s17.frames).toBe(0);
  expect(s17.result).toBeNull();
  expect(await builtObjects(page)).not.toBe(world0);
  await expect(layoutLine).toContainText(s17.layoutId!);
  expect(page.url()).toContain("seed=17");
  await page.waitForTimeout(1500);
  expect(await consolePhase(page)).toBe("ready"); // no auto-run

  // Back to seed 0: the same layout as before (deterministic in the browser too).
  await page.getByLabel("Seed", { exact: true }).fill("0");
  await expect.poll(async () => (await state(page)).layoutId, { timeout: 120_000 }).toBe(s0.layoutId);
  await ready(page);
  expect(await builtObjects(page)).toBe(world0);

  // Scenario change rebuilds too.
  await page.getByLabel("Scenario", { exact: true }).selectOption("decoys-only");
  await expect.poll(async () => (await state(page)).scenarioId, { timeout: 120_000 }).toBe("decoys-only");
  await ready(page);
  const sd = await state(page);
  expect(sd.layoutId).toMatch(/^v2-/);
  expect(sd.layoutId).not.toBe(s0.layoutId);
  expect(sd.frames).toBe(0);

  // Recorded-evaluation layout.
  await page.getByLabel("World layout").selectOption("v1");
  await expect.poll(async () => (await state(page)).layoutId ?? "", { timeout: 120_000 }).toMatch(/^v1-/);
  await ready(page);
  expect(page.url()).toContain("layout=v1");
  await expect(layoutLine).toContainText("recorded-evaluation layout");

  // Step runs exactly one mission step and pauses; Reset rebuilds the same layout with no mission.
  const idBefore = (await state(page)).layoutId;
  await page.getByRole("button", { name: "Step" }).click();
  await expect.poll(() => consolePhase(page), { timeout: 300_000, intervals: [1000] }).toBe("paused");
  expect((await state(page)).frames).toBeGreaterThanOrEqual(1);
  await page.getByRole("button", { name: "Reset" }).click();
  await ready(page);
  const sr = await state(page);
  expect(sr.frames).toBe(0);
  expect(sr.result).toBeNull();
  expect(sr.layoutId).toBe(idBefore);
  expect(errors).toEqual([]);
});

test("Lab replay links pin the recorded (v1) layout", async ({ page }) => {
  await page.goto("/lab");
  await page.getByRole("button", { name: "Inspect" }).first().click();
  const replay = page.getByRole("link", { name: /Replay in Mission Control/ }).first();
  await expect(replay).toHaveAttribute("href", /layout=v1/);
  await page.goto("/console?scenario=photo-board-decoy&seed=1001&method=surestop&layout=v1");
  await ready(page);
  await expect(page.getByLabel("World layout")).toHaveValue("v1");
  expect((await state(page)).layoutId).toMatch(/^v1-/);
});
