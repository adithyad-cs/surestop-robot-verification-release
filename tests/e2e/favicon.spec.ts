import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// D8: the app serves a real favicon, so the browser's automatic /favicon.ico request succeeds.
// No console error is filtered anywhere; this checks the request itself.
test("GET /favicon.ico returns the committed icon, and pages link it", async ({ page, request }) => {
  const res = await request.get("/favicon.ico");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/^image\/(x-icon|vnd\.microsoft\.icon)/);
  const committed = fs.readFileSync(path.resolve(__dirname, "../../src/app/favicon.ico"));
  expect(Buffer.from(await res.body()).equals(committed)).toBe(true);

  const failed: string[] = [];
  page.on("response", (r) => {
    if (new URL(r.url()).pathname === "/favicon.ico" && r.status() >= 400) failed.push(`${r.status()} ${r.url()}`);
  });
  await page.goto("/console");
  await expect(page.locator('head link[rel="icon"][href^="/favicon.ico"]')).toHaveCount(1);
  expect(failed).toEqual([]);
});
