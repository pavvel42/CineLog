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
    // E2e działa na izolowanej kopii danych (DATA_DIR), żeby smoke testy
    // nie mutowały committowanego demo w data/ ani static/data/.
    command:
      "mkdir -p /tmp/cinelog-e2e-data && " +
      "cp data/movies_parsed.json data/shows_parsed.json data/movies_backup.json data/shows_backup.json /tmp/cinelog-e2e-data/ && " +
      'echo "{}" > /tmp/cinelog-e2e-data/vod_cache.json && echo "{}" > /tmp/cinelog-e2e-data/upcoming_cache.json && ' +
      "PORT=5599 DATA_DIR=/tmp/cinelog-e2e-data python3 run.py",
    url: "http://localhost:5599/api/movies",
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
