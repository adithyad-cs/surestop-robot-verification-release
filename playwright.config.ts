import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3200);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 15 * 60 * 1000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${port}`,
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      // Software WebGL in headless CI containers without a GPU.
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
    },
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx next start -p ${port}`,
        url: `http://localhost:${port}`,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
