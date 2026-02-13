import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ path: ".env.e2e" });
dotenv.config();

const port = Number.parseInt(process.env.E2E_PORT ?? "4173", 10);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;
const useExistingServer = process.env.E2E_USE_EXISTING_SERVER === "1";
const retries = Number.parseInt(process.env.E2E_RETRIES ?? "", 10);
const resolvedRetries = Number.isFinite(retries) ? retries : process.env.CI ? 1 : 0;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  retries: resolvedRetries,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    headless: true,
  },
  ...(useExistingServer
    ? {}
    : {
        webServer: {
          command: `npm run dev -- --port ${port}`,
          url: baseURL,
          timeout: 120_000,
          reuseExistingServer: !process.env.CI,
          env: process.env as Record<string, string>,
        },
      }),
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      grepInvert: /@mobile/,
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 5"] },
      grep: /@mobile/,
    },
  ],
});
