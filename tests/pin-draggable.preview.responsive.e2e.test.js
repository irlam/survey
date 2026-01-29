const { test, expect } = require('@playwright/test');
const RUN_PIN = !!process.env.RUN_PIN_DRAG_E2E || !!process.env.RUN_REMOTE_E2E;
if (!RUN_PIN) test.skip('Pin-drag responsive E2E skipped (set RUN_PIN_DRAG_E2E=1 to enable)', () => {});
const SITE_URL = process.env.PIN_DRAG_E2E_URL || 'https://survey.defecttracker.uk/';

test('Preview becomes full-width on narrow screens', async ({ page }) => {
  // Narrow mobile-like viewport
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(SITE_URL, { waitUntil: 'networkidle' });

  const addBtn = page.locator('#btnAddIssueMode');
  await addBtn.waitFor({ state: 'visible', timeout: 15000 });
  await addBtn.click();

  // Ensure there's a pdfCanvas to render a preview from
  await page.evaluate(() => {
    let c = document.getElementById('pdfCanvas');
    if (!c) {
      c = document.createElement('canvas');
      c.id = 'pdfCanvas';
      c.width = 800; c.height = 1000;
      c.style.width = '800px'; c.style.height = '1000px';
      const ctx = c.getContext('2d'); ctx.fillStyle = '#444'; ctx.fillRect(0,0,c.width,c.height);
      document.body.appendChild(c);
    }
  });

  // Open the issue modal
  await page.evaluate(() => {
    if (typeof showIssueModal === 'function') {
      showIssueModal({ page: 1, x_norm: 0.25, y_norm: 0.25, label: '1' });
    } else {
      throw new Error('showIssueModal not available');
    }
  });

  const modal = page.locator('#issueModal');
  await expect(modal).toBeVisible();

  const previewWrap = modal.locator('#issuePreviewWrap');
  await expect(previewWrap).toBeVisible({ timeout: 5000 });

  // Ensure the preview width is not larger than max (420) and that it fits the modal on narrow viewport
  const previewWidth = await previewWrap.evaluate((el) => el.getBoundingClientRect().width);
  const modalWidth = await modal.evaluate((el) => el.getBoundingClientRect().width);
  expect(previewWidth).toBeLessThanOrEqual(420);
  // On narrow viewport the preview should be near the modal width (full width) - allow slight tolerance
  expect(Math.abs(previewWidth - modalWidth) <= 16).toBeTruthy();

  // cleanup
  await page.locator('#issueCancelBtn').click();
});