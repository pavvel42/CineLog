import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:5599",
    viewport: { width: 1280, height: 900 },
    // Aplikacja loguje sporo w konsoli; podnosimy próg, by nie fałszować wyników
    ignoreHTTPSErrors: true,
  },
  webServer: {
    command: "PORT=5599 python3 run.py",
    url: "http://localhost:5599/api/movies",
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
