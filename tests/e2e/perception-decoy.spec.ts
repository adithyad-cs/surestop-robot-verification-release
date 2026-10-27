// Real-perception regression (real rendering + COCO-SSD), opt-in because each case is a full
// mission: SURESTOP_PERCEPTION=1 npx playwright test tests/e2e/perception-decoy.spec.ts
//
// The layout validator's "decoy seen first" check is geometric. In these three v2 layouts it
// passed, but in the recorded real-render runs no track was ever opened on the decoy (the mission
// became a clear-target run). Each gap test first pins the exact layout id, then asserts the
// CURRENT behaviour (no decoy track). It fails if the layout changes or if perception starts to
// meet the decoy; either way the case must then be re-examined. The control case must pass.
import { expect, test, type Page } from "@playwright/test";
import { consolePhase } from "./helpers";

test.skip(process.env.SURESTOP_PERCEPTION !== "1", "real-perception missions are opt-in: set SURESTOP_PERCEPTION=1");
test.setTimeout(20 * 60_000);

type S = {
  phase: string;
  layoutId: string | null;
  result: { outcome: string } | null;
  score: { nonTargetEncountered: boolean; trackLabels: Array<{ kind: string; status: string }> } | null;
};
const state = (page: Page) => page.evaluate(() => (window as unknown as { __surestopConsole: { getState(): S } }).__surestopConsole.getState());

async function runReal(page: Page, scenario: string, seed: number, expectedLayoutId: string) {
  await page.goto(`/console?scenario=${scenario}&seed=${seed}&method=surestop&layout=v2`);
  await expect.poll(() => consolePhase(page), { timeout: 600_000, intervals: [1000] }).toBe("ready");
  // Same layout as the recorded case; if this fails, the generator changed and the case must be re-derived.
  expect((await state(page)).layoutId).toBe(expectedLayoutId);
  await page.getByRole("radio", { name: /Maximum speed/ }).click();
  await page.getByRole("button", { name: "Run mission" }).click();
  await expect.poll(() => consolePhase(page), { timeout: 1_200_000, intervals: [3000] }).toBe("done");
  const s = await state(page);
  test.info().annotations.push({ type: "outcome", description: `${scenario}/${seed} ${s.layoutId}: ${s.result!.outcome}; tracks ${JSON.stringify(s.score!.trackLabels)}` });
  return s;
}

const GAP_CASES: Array<[string, number, string]> = [
  ["poster-decoy", 42, "v2-2805ba1b"],
  ["screen-decoy", 2, "v2-d291bcb9"],
  ["screen-decoy", 17, "v2-8f052f46"],
];

for (const [scenario, seed, id] of GAP_CASES) {
  test(`known gap (current behaviour): no decoy track in ${scenario} seed ${seed} (${id})`, async ({ page }) => {
    const s = await runReal(page, scenario, seed, id);
    expect(s.score!.nonTargetEncountered, "real perception now meets the decoy: the gap is closed, update this case").toBe(false);
  });
}

test("control: real perception meets the decoy in poster-decoy seed 0 (v2-050c7aaa)", async ({ page }) => {
  const s = await runReal(page, "poster-decoy", 0, "v2-050c7aaa");
  expect(s.score!.nonTargetEncountered).toBe(true);
  expect(s.score!.trackLabels.some((l) => l.kind === "picture-decoy" && l.status === "REJECTED")).toBe(true);
});
