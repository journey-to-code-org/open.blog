import { defineConfig } from "@playwright/test";

// A new site says Getting started is on (init writes it). Every spec but Getting started's own
// runs with the server's switch off, which wins over the site's file; that spec sets its own.
process.env.OPENBLOG_STUDIO_ONBOARDING ??= "off";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.mjs",
  workers: 1,
  timeout: 60000,
  use: { browserName: "chromium", headless: true },
  reporter: "list",
});
