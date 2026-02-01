const { defineConfig, devices } = require('@playwright/test');

const baseURL = process.env.E2E_SITE_URL || process.env.PIN_DRAG_E2E_URL;

module.exports = defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
