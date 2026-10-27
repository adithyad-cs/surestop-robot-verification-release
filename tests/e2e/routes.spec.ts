import { expect, test } from "@playwright/test";
import { trackErrors } from "./helpers";

test("landing has one dominant ENTER SYSTEM action that opens Mission Control", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/verify the intended target before reporting arrival/i);
  const cta = page.getByRole("link", { name: "ENTER SYSTEM" });
  await expect(cta).toHaveCount(1);
  await expect(page.locator("main a.btn")).toHaveCount(1);
  await cta.click();
  await expect(page).toHaveURL(/\/console$/);
  await expect(page.getByRole("heading", { name: "Mission setup" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("ENTER SYSTEM is reachable by keyboard with a visible focus ring", async ({ page }) => {
  await page.goto("/");
  let focused = "";
  for (let i = 0; i < 12 && focused !== "ENTER SYSTEM"; i++) {
    await page.keyboard.press("Tab");
    focused = (await page.evaluate(() => document.activeElement?.textContent?.trim())) ?? "";
  }
  expect(focused).toBe("ENTER SYSTEM");
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
  expect(outline).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/console$/);
});

for (const [path, heading] of [
  ["/console", "Mission setup"],
  ["/lab", "Verification Lab"],
  ["/method", "Method"],
] as const) {
  test(`${path} loads directly and after refresh`, async ({ page }) => {
    const errors = trackErrors(page);
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" }).locator('a[aria-current="page"]')).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

for (const vp of [
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
]) {
  test(`no horizontal page overflow at ${vp.width}px`, async ({ page }) => {
    await page.setViewportSize(vp);
    for (const path of ["/", "/console", "/lab", "/method"]) {
      await page.goto(path);
      await page.waitForTimeout(500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
}
