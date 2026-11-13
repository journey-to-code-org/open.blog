import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.mjs",
  workers: 1,
  timeout: 60000,
  // CI runners are slower, and a save may wait a few seconds for a send-out to free the content
  // lock: give assertions room there. A longer wait never turns a failure into a pass.
  expect: { timeout: process.env.CI ? 15000 : 5000 },
  use: { browserName: "chromium", headless: true },
  reporter: "list",
});
