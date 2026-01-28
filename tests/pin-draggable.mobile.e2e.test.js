const { test, expect } = require('@playwright/test');
// Fast mobile UI test for FAB presence and toggling Add Issue Mode.
const RUN_PIN = !!process.env.RUN_PIN_DRAG_E2E || !!process.env.RUN_REMOTE_E2E;
if (!RUN_PIN) test.skip('Pin mobile E2E skipped (set RUN_PIN_DRAG_E2E=1 to enable)', () => {});

const SITE_URL = process.env.PIN_DRAG_E2E_URL || 'https://survey.defecttracker.uk/';

test('Mobile FAB toggles Add Issue Mode', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); // emulate typical mobile portrait size
  await page.goto(SITE_URL, { waitUntil: 'networkidle' });

  const fab = page.locator('#fabAddIssue');
  await fab.waitFor({ state: 'visible', timeout: 15000 });

  // Ensure FAB is visible and toggles mode
  await fab.click();
  const modeBadge = page.locator('#modeBadge');
  await expect(modeBadge).toBeVisible();

  // Toggle off again
  await fab.click();
  await expect(modeBadge).toBeHidden();
});