import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { trackErrors } from "./helpers";

test("recorded results load with counts and denominators, and export real records", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/lab");
  const table = page.getByRole("table").filter({ hasText: "Correct confirmation ↑" }).first();
  await expect(table).toBeVisible({ timeout: 60_000 });
  await expect(table.locator("tbody tr").first()).toContainText(/\d+\/\d+/);
  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export CSV" }).click()]);
  const text = fs.readFileSync((await csv.path())!, "utf8");
  const lines = text.trim().split("\n");
  expect(lines[0]).toContain("scenario,seed,method,outcome");
  expect(lines.length).toBeGreaterThan(10);
  const [json] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export JSON" }).click()]);
  const data = JSON.parse(fs.readFileSync((await json.path())!, "utf8"));
  expect(data.schema).toBe("surestop.experiment/2");
  expect(data.runs.length).toBe(lines.length - 1);
  // The recorded dataset has no failure records: unknown, not "no failures".
  expect(data).toMatchObject({ failures: null, batches: null, failuresRecorded: false, batchStatus: null, runsWithoutBatch: data.runs.length });
  // Inspecting a trial lazily loads and shows its full decision trace.
  await page.getByRole("button", { name: "Inspect" }).first().click();
  await expect(page.getByRole("heading", { name: "Event history" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Candidates and evidence" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a live batch runs in the browser and is stored separately", async ({ page }) => {
  await page.goto("/lab");
  await page.getByLabel("Picture decoy first").uncheck();
  await page.getByLabel("Clear target").check();
  await page.getByLabel("SureStop (multi-view evidence)").uncheck();
  await page.getByLabel("Count").fill("1");
  await page.getByRole("button", { name: /Run 1 mission/ }).click();
  await expect(page.getByRole("button", { name: /View browser runs \(1\)/ })).toBeVisible({ timeout: 600_000 });
  await page.getByRole("button", { name: /View browser runs/ }).click();
  await expect(page.getByRole("tab", { name: /Runs in this browser \(1\)/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("table").filter({ hasText: "Correct confirmation ↑" }).first().locator("tbody tr")).toHaveCount(1);
  await expect(page.getByTestId("batch-status")).toHaveText(/Every recorded batch is complete/);
  const batchRows = page.getByRole("region", { name: "Batches run in this browser" }).locator("tbody tr");
  await expect(batchRows).toHaveCount(1);
  await expect(batchRows.first()).toContainText("complete");
  const [json] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export JSON" }).click()]);
  const data = JSON.parse(fs.readFileSync((await json.path())!, "utf8"));
  expect(data).toMatchObject({ schema: "surestop.experiment/2", failures: [], failuresRecorded: true, runsWithoutBatch: 0, batchStatus: "complete" });
  expect(data.batches).toHaveLength(1);
  expect(data.batches[0]).toMatchObject({ status: "complete", planned: 1, completed: 1, failed: 0 });
  expect(data.runs[0].labBatchId).toBe(data.batches[0].batchId);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Clear browser runs" }).click();
  await expect(page.getByRole("tab", { name: /Runs in this browser \(0\)/ })).toBeVisible();
  await expect(page.getByTestId("batch-status")).toHaveCount(0);
});

test("a failed mission is recorded, reported and exported, never scored", async ({ page }) => {
  // A real per-mission failure without test hooks: the vase model cannot be fetched, so the 3-D
  // look-alike mission fails while building its world; the clear-target mission completes.
  await page.route("**/GlassVaseFlowers.glb", (r) => r.abort());
  await page.goto("/lab");
  await page.getByLabel("Picture decoy first").uncheck();
  await page.getByLabel("Clear target").check();
  await page.getByLabel("3-D look-alike (known limitation)").check();
  await page.getByLabel("SureStop (multi-view evidence)").uncheck();
  await page.getByLabel("Count").fill("1");
  await page.getByRole("button", { name: /Run 2 missions/ }).click();
  const status = page.getByRole("status");
  await expect(status).toContainText("Batch failed: 1 completed, 1 failed of 2 planned", { timeout: 600_000 });
  await expect(status).toContainText(/not scored: lookalike-3d seed 1 single-frame \(TypeError: Failed to fetch\)/);
  // Only the completed mission is a run; the failure is listed apart.
  await expect(page.getByRole("button", { name: /View browser runs \(1\)/ })).toBeVisible();
  await page.getByRole("button", { name: /View browser runs/ }).click();
  await expect(page.getByRole("table").filter({ hasText: "Correct confirmation ↑" }).first().locator("tbody tr")).toHaveCount(1);
  await expect(page.getByTestId("batch-status")).toHaveText(/Not a clean result: 1 mission\(s\) failed/);
  const failed = page.getByRole("region", { name: "Failed missions (not scored)" }).locator("tbody tr");
  await expect(failed).toHaveCount(1);
  await expect(failed.first()).toContainText("lookalike-3d");
  const [json] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export JSON" }).click()]);
  const data = JSON.parse(fs.readFileSync((await json.path())!, "utf8"));
  expect(data).toMatchObject({ schema: "surestop.experiment/2", failuresRecorded: true, runsWithoutBatch: 0, batchStatus: "failed" });
  expect(data.runs).toHaveLength(1);
  expect(data.runs[0].result.scenarioId).toBe("clear-target");
  expect(data.failures).toHaveLength(1);
  expect(data.failures[0]).toMatchObject({ scenarioId: "lookalike-3d", seed: 1, variant: "single-frame", batchId: data.batches[0].batchId });
  expect(data.failures[0].error).toBeTruthy();
  expect(data.failures[0]).not.toHaveProperty("score");
  expect(data.failures[0]).not.toHaveProperty("result");
  expect(data.batches[0]).toMatchObject({ status: "failed", planned: 2, completed: 1, failed: 1 });
  // The records survive a reload (IndexedDB), with the same status.
  await page.reload();
  await page.getByRole("tab", { name: /Runs in this browser \(1\)/ }).click();
  await expect(page.getByTestId("batch-status")).toHaveText(/Not a clean result: 1 mission\(s\) failed/);
  await expect(page.getByRole("region", { name: "Failed missions (not scored)" }).locator("tbody tr")).toHaveCount(1);
});

test("a batch cut off by a reload is shown and exported as incomplete", async ({ page }) => {
  await page.goto("/lab");
  await page.getByLabel("Picture decoy first").uncheck();
  await page.getByLabel("Clear target").check();
  await page.getByLabel("SureStop (multi-view evidence)").uncheck();
  await page.getByLabel("Count").fill("3");
  await page.getByRole("button", { name: /Run 3 missions/ }).click();
  // Reload once the first mission is stored, while the batch is still running.
  await expect(page.getByRole("button", { name: /View browser runs \(1\)/ })).toBeVisible({ timeout: 600_000 });
  await page.reload();
  await page.getByRole("tab", { name: /Runs in this browser/ }).click();
  await expect(page.getByTestId("batch-status")).toHaveText(/Not a complete result/);
  await expect(page.getByRole("region", { name: "Batches run in this browser" }).locator("tbody tr").first()).toContainText(/incomplete.*interrupted/);
  const [json] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export JSON" }).click()]);
  const data = JSON.parse(fs.readFileSync((await json.path())!, "utf8"));
  expect(data.batchStatus).toBe("incomplete");
  expect(data.batches[0]).toMatchObject({ status: "incomplete", incompleteReason: "interrupted", planned: 3 });
  expect(data.batches[0].completed).toBe(data.runs.length);
  expect(data.runs.length).toBeGreaterThanOrEqual(1);
  expect(data.runs.length).toBeLessThan(3);
});

test("runs stored by an earlier Lab version (database v1) stay readable after the upgrade", async ({ page }) => {
  await page.goto("/");
  // Write a run the way the pre-stage-4 Lab did: IndexedDB "surestop" version 1, store "runs" only.
  const stored = await page.evaluate(async () => {
    const run = (await (await fetch("/data/eval-runs.json")).json()).runs[0];
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("surestop", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("runs", { autoIncrement: true });
      req.onsuccess = () => {
        const t = req.result.transaction("runs", "readwrite");
        t.objectStore("runs").add(run);
        t.oncomplete = () => (req.result.close(), resolve());
        t.onerror = () => reject(t.error);
      };
      req.onerror = () => reject(req.error);
    });
    return { scenarioId: run.result.scenarioId, seed: run.result.seed };
  });
  await page.goto("/lab");
  await page.getByRole("tab", { name: /Runs in this browser \(1\)/ }).click();
  await expect(page.getByRole("table").filter({ hasText: "Correct confirmation ↑" }).first().locator("tbody tr")).toHaveCount(1);
  const [json] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export JSON" }).click()]);
  const data = JSON.parse(fs.readFileSync((await json.path())!, "utf8"));
  expect(data.runs).toHaveLength(1);
  expect(data.runs[0].result).toMatchObject(stored);
  // Its batch's failures were never recorded, and the export says so.
  expect(data).toMatchObject({ failures: [], batches: [], failuresRecorded: false, runsWithoutBatch: 1, batchStatus: null });
  const version = await page.evaluate(
    () => new Promise<number>((resolve) => { const r = indexedDB.open("surestop"); r.onsuccess = () => { resolve(r.result.version); r.result.close(); }; }),
  );
  expect(version).toBe(2);
});
