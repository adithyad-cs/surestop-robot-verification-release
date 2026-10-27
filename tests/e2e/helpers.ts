import type { Page } from "@playwright/test";

/** Collects page errors and console errors, ignoring benign driver performance warnings. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  return errors;
}

export async function consolePhase(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (window as unknown as { __surestopConsole?: { getState(): { phase: string } } }).__surestopConsole?.getState().phase);
}
