// Layout v2 hardening: URL rules, asynchronous world builds, export consistency, and agreement
// between the validator's analytic map and the world builder's real grid.
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { consolePhase, trackErrors } from "./helpers";

type State = {
  phase: string;
  seed: number;
  scenarioId: string;
  layout: string;
  layoutId: string | null;
  frames: number;
  result: { scenarioId: string; seed: number } | null;
  error: string | null;
  layoutNotice: string | null;
};
type Ctl = {
  getState(): State;
  subscribe(fn: () => void): () => void;
  worldMatchesSelection(): boolean;
  configure(p: object): Promise<void>;
  start(): void;
  prepared: { inst: { seed: number; objects: Array<{ id: string; x: number; z: number }> } } | null;
  gridCheck(): Promise<{
    layoutId: string;
    comparison: { worldOnly: number; worldOnlyMaxDistCells: number; blockedWorldOnly: number; blockedWorldOnlyMaxDistCells: number };
    worldGridChecks: Array<{ name: string; pass: boolean; detail: string }>;
  } | null>;
};

const state = (page: Page) => page.evaluate(() => (window as unknown as { __surestopConsole: Ctl }).__surestopConsole.getState());
const world = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as { __surestopConsole: Ctl }).__surestopConsole.prepared;
    return p ? `${p.inst.seed}|` + p.inst.objects.map((o) => `${o.id}@${o.x.toFixed(2)},${o.z.toFixed(2)}`).join(" ") : null;
  });
const ready = (page: Page) => expect.poll(() => consolePhase(page), { timeout: 600_000, intervals: [500] }).toBe("ready");

/** Records every state change; flags any moment the panel and the built world disagree. */
async function watchInvariants(page: Page) {
  await page.evaluate(() => {
    const ctl = (window as unknown as { __surestopConsole: Ctl }).__surestopConsole;
    const w = window as unknown as { __violations: string[] };
    w.__violations = [];
    ctl.subscribe(() => {
      const s = ctl.getState();
      if (s.phase === "preparing" && s.layoutId !== null) w.__violations.push(`preparing with stale layout id ${s.layoutId} (seed ${s.seed})`);
      if (s.phase === "ready" && (!s.layoutId || !ctl.worldMatchesSelection())) w.__violations.push(`ready but world does not match selection (seed ${s.seed}, id ${s.layoutId})`);
      if ((s.phase === "running" || s.phase === "done") && !ctl.worldMatchesSelection()) w.__violations.push(`${s.phase} on a world that does not match seed ${s.seed}`);
    });
  });
}
const violations = (page: Page) => page.evaluate(() => (window as unknown as { __violations: string[] }).__violations);

/** Layout id and world of a scenario/seed/layout loaded fresh in its own page. */
async function freshLayout(page: Page, query: string) {
  const p2 = await page.context().newPage();
  await p2.goto(`/console?${query}`);
  await ready(p2);
  const out = { id: (await state(p2)).layoutId, world: await world(p2) };
  await p2.close();
  return out;
}

test.describe("URL rules", () => {
  test("fresh visit opens the seeded v2 layout with no notice", async ({ page }) => {
    await page.goto("/console");
    await ready(page);
    const s = await state(page);
    expect(s.layout).toBe("v2");
    expect(s.layoutId).toMatch(/^v2-/);
    await expect(page.getByTestId("layout-notice")).toHaveCount(0);
  });

  test("a legacy replay link (no layout) opens v1, says so, and makes the layout explicit", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/console?scenario=photo-board-decoy&seed=1001&method=surestop");
    await ready(page);
    const s = await state(page);
    expect(s.layout).toBe("v1");
    await expect(page.getByLabel("World layout")).toHaveValue("v1");
    await expect(page.getByTestId("layout-notice")).toContainText("no layout parameter");
    expect(page.url()).toContain("layout=v1");
    const explicit = await freshLayout(page, "scenario=photo-board-decoy&seed=1001&method=surestop&layout=v1");
    expect(s.layoutId).toBe(explicit.id);
    expect(await world(page)).toBe(explicit.world);
    // Choosing a layout explicitly retires the notice.
    await page.getByLabel("World layout").selectOption("v2");
    await ready(page);
    await expect(page.getByTestId("layout-notice")).toHaveCount(0);
    expect(page.url()).toContain("layout=v2");
    expect(errors).toEqual([]);
  });

  test("explicit layout=v1 and layout=v2 build the named layout", async ({ page }) => {
    for (const layout of ["v1", "v2"]) {
      await page.goto(`/console?scenario=screen-decoy&seed=2&method=surestop&layout=${layout}`);
      await ready(page);
      expect((await state(page)).layoutId).toMatch(new RegExp(`^${layout}-`));
      await expect(page.getByTestId("layout-notice")).toHaveCount(0);
    }
  });

  test("an unknown layout value is rejected: no world, no mission, clear message", async ({ page }) => {
    await page.goto("/console?scenario=clear-target&seed=4&layout=v3");
    await expect(page.getByRole("alert").filter({ hasText: "Unknown world layout" })).toContainText('Unknown world layout "v3"');
    const s = await state(page);
    expect(s.phase).toBe("error");
    expect(s.layoutId).toBeNull();
    expect(await world(page)).toBeNull();
    await expect(page.getByRole("button", { name: "Run mission" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Step" })).toBeDisabled();
    await expect(page.getByLabel("World layout")).toBeDisabled();
  });
});

test("typing a multi-digit seed character by character ends on the final seed's world, mission and export", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/console?scenario=clear-target&seed=0&method=surestop&layout=v2");
  await ready(page);
  await watchInvariants(page);
  const seed = page.getByLabel("Seed", { exact: true });
  // As a user would: select the current value and type over it, one key at a time.
  await seed.selectText();
  await seed.pressSequentially("123", { delay: 0 });
  await expect.poll(async () => (await state(page)).seed, { timeout: 60_000 }).toBe(123);
  await ready(page);
  await expect(seed).toHaveValue("123");
  const s = await state(page);
  const expected = await freshLayout(page, "scenario=clear-target&seed=123&method=surestop&layout=v2");
  expect(s.layoutId).toBe(expected.id);
  expect(await world(page)).toBe(expected.world);
  await expect(page.getByTestId("layout-id")).toContainText(expected.id!);
  expect(page.url()).toContain("seed=123");
  expect(page.url()).toContain("layout=v2");

  // The mission runs on that world.
  await page.getByRole("radio", { name: /Maximum speed/ }).click();
  await page.getByRole("button", { name: "Run mission" }).click();
  await expect.poll(() => consolePhase(page), { timeout: 900_000, intervals: [2000] }).toBe("done");
  const done = await state(page);
  expect(done.result!.seed).toBe(123);
  expect(done.result!.scenarioId).toBe("clear-target");
  expect(done.layoutId).toBe(expected.id);

  // The export names the same seed and layout, with the fallback flag and validation status.
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export mission JSON" }).click()]);
  expect(dl.suggestedFilename()).toContain(expected.id!);
  const json = JSON.parse(fs.readFileSync((await dl.path())!, "utf8"));
  // P1 bumped the export from /2 to /3: same fields plus `provenance` and evaluator `objects`.
  expect(json.schema).toBe("surestop.console-mission/3");
  expect(json.provenance).toMatchObject({ schema: "surestop.run-provenance/1", protocolHash: null, missionConfigHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
  expect(json.provenance.build.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
  expect(json.provenance.runtime.userAgent).toEqual(expect.any(String));
  expect(json.objects.schema).toBe("surestop.evaluator-objects/1");
  expect(json.seed).toBe(123);
  expect(json.result.seed).toBe(123);
  expect(json.layout).toMatchObject({ version: "v2", id: expected.id, fallback: false, valid: true, failedChecks: [] });

  expect(await violations(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test("concurrent configure calls: the last selection wins and nothing can start on a stale world", async ({ page }) => {
  await page.goto("/console?scenario=poster-decoy&seed=0&method=surestop&layout=v2");
  await ready(page);
  await watchInvariants(page);
  // Three builds requested back to back; Run pressed while they are in flight.
  await page.evaluate(() => {
    const ctl = (window as unknown as { __surestopConsole: Ctl }).__surestopConsole;
    void ctl.configure({ seed: 1 });
    void ctl.configure({ seed: 12 });
    ctl.start();
    void ctl.configure({ seed: 123 });
    ctl.start();
  });
  await ready(page);
  const s = await state(page);
  expect(s.seed).toBe(123);
  expect(s.frames).toBe(0);
  expect(s.result).toBeNull();
  const expected = await freshLayout(page, "scenario=poster-decoy&seed=123&method=surestop&layout=v2");
  expect(s.layoutId).toBe(expected.id);
  expect(await world(page)).toBe(expected.world);
  expect(await violations(page)).toEqual([]);
});

test("validator map vs world builder grid: agreement within one cell; v2 navigation checks hold on the real grid", async ({ page }) => {
  await page.goto("/console?scenario=clear-target&seed=0&method=surestop&layout=v2");
  await ready(page);
  const scenarios = ["clear-target", "poster-decoy", "screen-decoy", "decoys-only", "occluded-target", "photo-board-decoy", "lookalike-3d"];
  const cases: Array<[string, number, string]> = [];
  for (const sc of scenarios) cases.push([sc, 0, "v2"], [sc, 17, "v2"], [sc, 42, "v2"], [sc, 0, "v1"]);
  const report: string[] = [];
  for (const [scenarioId, seed, layout] of cases) {
    await page.evaluate((p) => (window as unknown as { __surestopConsole: Ctl }).__surestopConsole.configure(p), { scenarioId, seed, layout });
    await ready(page);
    const r = (await page.evaluate(() => (window as unknown as { __surestopConsole: Ctl }).__surestopConsole.gridCheck()))!;
    const c = r.comparison;
    const tag = `${scenarioId}/${seed}/${r.layoutId}`;
    report.push(`${tag}: worldOnly=${c.worldOnly} (≤${c.worldOnlyMaxDistCells} cell), blockedWorldOnly=${c.blockedWorldOnly} (≤${c.blockedWorldOnlyMaxDistCells} cell)`);
    // Obstacles in the real map that the validator lacks may only be grid-boundary cells (0.1 m).
    expect(c.worldOnlyMaxDistCells, tag).toBeLessThanOrEqual(1);
    expect(c.blockedWorldOnlyMaxDistCells, tag).toBeLessThanOrEqual(1);
    if (layout === "v2") {
      const failed = r.worldGridChecks.filter((x) => !x.pass);
      expect(failed, `${tag}: ${JSON.stringify(failed)}`).toEqual([]);
    }
  }
  test.info().annotations.push({ type: "grid-agreement", description: report.join("\n") });
});
