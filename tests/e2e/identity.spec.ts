import { expect, test, type Page } from "@playwright/test";
import { consolePhase, trackErrors } from "./helpers";

// The development case lookalike-3d seed 123 (layout v2), with real COCO-SSD inference in the browser.
// Baseline SureStop confirms the vase (the open false arrival); the experimental identity-conflict
// check withholds it and the mission arrives at the plant. Also checks that a selected earlier frame
// shows its own capture-time pose, never the live pose.

interface Ctl {
  getState(): {
    result: { outcome: string; tracks: Array<{ id: string; status: string; decision: { rule?: string } }> };
    score: { correctArrival: boolean; falseArrival: boolean };
    pose: { x: number; z: number; theta: number };
    frameViews: Array<{ frameId: number; pose: { x: number; z: number; theta: number } }>;
  };
  select(p: { frameId?: number | null }): void;
  historicalFrame(): { frameId: number } | null;
}
const ctl = (page: Page) => page.evaluate(() => (window as unknown as { __surestopConsole: Ctl }).__surestopConsole.getState());

async function runMission(page: Page, method: string) {
  await page.goto(`/console?scenario=lookalike-3d&seed=123&method=${method}&layout=v2`);
  await expect.poll(() => consolePhase(page), { timeout: 600_000, intervals: [2000] }).toBe("ready");
  await expect(page.getByTestId("layout-id")).toContainText("v2-04a6cf82");
  await page.getByRole("radio", { name: /Maximum speed/ }).click();
  await page.getByRole("button", { name: "Run mission" }).click();
  await expect.poll(() => consolePhase(page), { timeout: 900_000, intervals: [3000] }).toBe("done");
}

test("baseline SureStop still confirms the vase at seed 123 (open failure, kept visible)", async ({ page }) => {
  const errors = trackErrors(page);
  await runMission(page, "surestop");
  const s = await ctl(page);
  expect(s.result.outcome).toBe("ARRIVED");
  expect(s.score.falseArrival).toBe(true);
  await expect(page.getByText("False arrival")).toBeVisible();
  expect(errors).toEqual([]);
});

test("surestop-identity withholds the vase, arrives at the plant, and shows capture-time poses", async ({ page }) => {
  const errors = trackErrors(page);
  await runMission(page, "surestop-identity");
  const s = await ctl(page);
  expect(s.result.outcome).toBe("ARRIVED");
  expect([s.score.correctArrival, s.score.falseArrival]).toEqual([true, false]);
  const withheld = s.result.tracks.find((t) => t.decision.rule === "withhold-identity-conflict");
  expect(withheld?.status).toBe("UNCONFIRMED");
  await expect(page.getByText("Correct arrival")).toBeVisible();

  // The withheld candidate lists its identity conflict; its frame link selects that earlier frame.
  await page.getByRole("button", { name: new RegExp(withheld!.id) }).first().click();
  const conflicts = page.getByTestId("identity-conflicts");
  await expect(conflicts).toContainText("vase");
  await conflicts.getByRole("button", { name: /Show frame/ }).first().click();
  const sel = await page.evaluate(() => (window as unknown as { __surestopConsole: Ctl }).__surestopConsole.historicalFrame());
  expect(sel).not.toBeNull();
  const after = await ctl(page);
  const fv = after.frameViews.find((f) => f.frameId === sel!.frameId)!;
  // The capture pose is shown separately from the live pose, and it is the frame's own pose.
  const row = page.getByTestId("capture-pose");
  await expect(row).toContainText(`x ${fv.pose.x.toFixed(2)}`);
  await expect(row).toContainText(`z ${fv.pose.z.toFixed(2)}`);
  expect(Math.hypot(fv.pose.x - after.pose.x, fv.pose.z - after.pose.z)).toBeGreaterThan(0.5);
  await expect(page.getByRole("img", { name: new RegExp(`Robot camera frame ${sel!.frameId} `) })).toBeVisible();
  await expect(page.getByTestId("frame-conflicts")).toContainText("vase");

  // Returning to the newest frame removes the capture-pose row and marker.
  const latest = after.frameViews[after.frameViews.length - 1].frameId;
  await page.evaluate((id) => (window as unknown as { __surestopConsole: Ctl }).__surestopConsole.select({ frameId: id }), latest);
  await expect(page.getByTestId("capture-pose")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __surestopConsole: Ctl }).__surestopConsole.historicalFrame())).toBeNull();
  expect(errors).toEqual([]);
});
