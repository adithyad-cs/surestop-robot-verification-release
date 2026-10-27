import { expect, test } from "@playwright/test";
import { consolePhase, trackErrors } from "./helpers";

test("a real mission runs end to end: detector, verification, decision, evaluator", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/console?scenario=poster-decoy&seed=1&method=surestop");
  await expect.poll(() => consolePhase(page), { timeout: 600_000, intervals: [2000] }).toBe("ready");
  // The detector really loaded (backend shown in the header).
  await expect(page.locator("header")).toContainText("COCO-SSD 2.2.3");
  // Evaluator ground truth is not shown before the mission ends.
  await expect(page.getByRole("heading", { name: /Evaluator/ })).toHaveCount(0);
  await page.getByRole("radio", { name: /Maximum speed/ }).click();
  await page.getByRole("button", { name: "Run mission" }).click();
  // The camera panel shows a real frame while running.
  await expect(page.getByRole("img", { name: /Robot camera frame/ })).toBeVisible({ timeout: 300_000 });
  await expect.poll(() => consolePhase(page), { timeout: 900_000, intervals: [3000] }).toBe("done");
  const state = await page.evaluate(() => {
    const s = (window as unknown as { __surestopConsole: { getState(): { result: { outcome: string; tracks: Array<{ status: string }>; frames: unknown[] } } } }).__surestopConsole.getState();
    return { outcome: s.result.outcome, statuses: s.result.tracks.map((t) => t.status), frames: s.result.frames.length };
  });
  expect(state.outcome).toBe("ARRIVED");
  expect(state.statuses).toContain("REJECTED");
  expect(state.statuses).toContain("CONFIRMED");
  expect(state.frames).toBeGreaterThan(10);
  await expect(page.getByText("Mission outcome (robot)")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Evaluator/ })).toBeVisible();
  await expect(page.getByText("Correct arrival")).toBeVisible();
  await expect(page.getByRole("table").filter({ hasText: "Message" }).locator("tbody tr")).not.toHaveCount(0);
  // Selecting a candidate reveals its evidence table.
  await page.getByRole("button", { name: /C1/ }).first().click();
  await expect(page.getByRole("table", { name: /Evidence for candidate C1/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test("reduced-motion preference disables robot animation", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.goto("/console");
  await page.waitForFunction(() => !!(window as unknown as { __surestopConsole?: unknown }).__surestopConsole);
  const reduced = await page.evaluate(() => (window as unknown as { __surestopConsole: { reducedMotion: boolean } }).__surestopConsole.reducedMotion);
  expect(reduced).toBe(true);
  await ctx.close();
});
