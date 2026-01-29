const { test, expect } = require('@playwright/test');
const RUN_PIN = !!process.env.RUN_PIN_DRAG_E2E || !!process.env.RUN_REMOTE_E2E;
if (!RUN_PIN) test.skip('Pin-drag annotate E2E skipped (set RUN_PIN_DRAG_E2E=1 to enable)', () => {});
const SITE_URL = process.env.PIN_DRAG_E2E_URL || 'https://survey.defecttracker.uk/';

test('Preview annotate toggle is off by default and can be enabled', async ({ page }) => {
  await page.goto(SITE_URL, { waitUntil: 'networkidle' });
  const addBtn = page.locator('#btnAddIssueMode');
  await addBtn.waitFor({ state: 'visible', timeout: 15000 });
  await addBtn.click();
  await page.waitForLoadState('networkidle');

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

  const annotCanvas = modal.locator('#issueAnnotCanvas');
  await expect(annotCanvas).toBeVisible();

  const toggle = modal.locator('#issueAnnotToggleBtn');
  await expect(toggle).toHaveText('Annotate');

  // pointer-events should be none by default
  const peBefore = await page.evaluate(() => getComputedStyle(document.querySelector('#issueAnnotCanvas')).pointerEvents);
  expect(peBefore).toBe('none');

  // enable annotate
  await toggle.click();
  await expect(toggle).toHaveText('Stop');
  const peAfter = await page.evaluate(() => getComputedStyle(document.querySelector('#issueAnnotCanvas')).pointerEvents);
  expect(peAfter === 'auto' || peAfter === 'all').toBeTruthy();

  // cleanup close modal
  await page.locator('#issueCancelBtn').click();
});