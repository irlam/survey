const { test, expect } = require('@playwright/test');

const primaryBase = process.env.E2E_SITE_URL || process.env.PIN_DRAG_E2E_URL || 'http://localhost:8080';
const fallbackBase = 'https://survey.defecttracker.uk';
let resolvedBase = primaryBase;
const shouldRun = true;

if (!shouldRun) test.skip('E2E smoke skipped (set RUN_E2E_SMOKE=1 to enable)', () => {});

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  for (const candidate of [primaryBase, fallbackBase]) {
    try {
      await page.goto(candidate, { waitUntil: 'domcontentloaded', timeout: 5000 });
      resolvedBase = candidate;
      await page.close();
      return;
    } catch (err) {
      // try next
    }
  }
  await page.close();
  test.skip(true, 'Base URL unreachable for e2e smoke');
});

async function openViewer(page) {
  await page.goto(resolvedBase, { waitUntil: 'networkidle' });
  const planBtn = page.getByText('Plans', { exact: true });
  await expect(planBtn).toBeVisible();
  await planBtn.click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Open' }).first().click();
  await page.waitForSelector('#pdfCanvas', { state: 'attached' });
}

test.describe('Viewer smoke', () => {
  test('open viewer and snapshot', async ({ page }) => {
    await openViewer(page);
    await page.waitForSelector('#pdfCanvas');
    await expect(page.locator('#pdfCanvas')).toBeVisible();
    await expect(page).toHaveScreenshot('viewer-open.png', { fullPage: false });
  });

  test('add issue, pin draggable preview, save', async ({ page }) => {
    await openViewer(page);
    await page.getByRole('button', { name: 'Add Issue' }).click();
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      showIssueModal({ page: 1, x_norm: 0.25, y_norm: 0.25, label: '1', title: 'E2E Smoke' });
    });
    const modal = page.locator('#issueModal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('#issuePreviewWrap')).toBeVisible();
    await expect(modal).toHaveScreenshot('issue-modal.png', { fullPage: false });
    const pin = modal.locator('.pin-draggable').first();
    await pin.waitFor({ state: 'visible' });
    const box = await pin.boundingBox();
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 40, startY + 10, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    await modal.locator('#issueSaveBtn').click();
    await page.waitForTimeout(1200);
    await expect(page.locator('#pdfCanvas')).toBeVisible();
  });

  test('issues list and export toggle', async ({ page }) => {
    await openViewer(page);
    const viewIssues = page.getByRole('button', { name: 'View Issues' });
    await viewIssues.click();
    const modal = page.locator('#issuesModal');
    await expect(modal).toBeVisible();
    await expect(modal).toHaveScreenshot('issues-list.png', { fullPage: false });
    const exportBtn = modal.getByRole('button', { name: /Generate PDF/ });
    if (await exportBtn.isVisible()) {
      await exportBtn.click();
      await page.waitForTimeout(500);
    }
  });
});
