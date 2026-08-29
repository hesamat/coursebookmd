import { defineConfig, devices } from "@playwright/test";

// Overridable so parallel worktrees running their own dev servers don't
// collide (or get their running server silently reused) on the default port.
const PORT = process.env.E2E_PORT || "8208";
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: BASE_URL,
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
  },
});
