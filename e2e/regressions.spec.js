const { test, expect } = require('@playwright/test');

const primaryBase = process.env.E2E_SITE_URL || process.env.PIN_DRAG_E2E_URL || 'http://localhost:8080';
const fallbackBase = 'https://survey.defecttracker.uk';
let resolvedBase = primaryBase;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  for (const candidate of [primaryBase, fallbackBase]) {
    try {
      await page.goto(candidate, { waitUntil: 'domcontentloaded', timeout: 5000 });
      resolvedBase = candidate;
      await page.close();
      return;
    } catch {
      /* try next */
    }
  }
  await page.close();
  test.skip(true, 'Base URL unreachable for e2e regressions');
});

async function openFirstPlan(page) {
  await page.goto(resolvedBase, { waitUntil: 'networkidle' });
  await page.getByText('Plans', { exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Open' }).first().click();
  await page.waitForSelector('#pdfCanvas', { state: 'attached' });
}

test.describe('Regressions', () => {
  test('all-issues PDF shows pins and details', async ({ page }) => {
    await openFirstPlan(page);
    await page.getByRole('button', { name: 'View Issues' }).click();
    const modal = page.locator('#issuesModal');
    await expect(modal).toBeVisible();
    // generate full report
    await page.getByRole('button', { name: 'Generate PDF Report' }).click();
    const download = page.getByRole('button', { name: 'Download PDF' });
    await expect(download).toBeVisible({ timeout: 30000 });
    // open PDF in new tab and validate first page contains pin numbers + issue text
    const [pdfPage] = await Promise.all([
      page.context().waitForEvent('page'),
      download.click(),
    ]);
    await pdfPage.waitForLoadState('domcontentloaded');
    const content = await pdfPage.content();
    expect(content).toMatch(/Issue\s+#\d+/i);
    expect(content).toMatch(/Page\s+1/);
    await pdfPage.close();
  });

  test('photo add after capture queues without planid error', async ({ page }) => {
    await openFirstPlan(page);
    await page.getByRole('button', { name: 'Add Issue' }).click();
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      showIssueModal({ page: 1, x_norm: 0.4, y_norm: 0.4, label: '99', title: 'PWA photo' });
    });
    const modal = page.locator('#issueModal');
    await expect(modal).toBeVisible();
    const input = modal.locator('#issuePhotoInput');
    const dummy = Buffer.from('fake', 'utf-8');
    await input.setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: dummy });
    await modal.getByRole('button', { name: 'Add to Queue' }).click();
    await expect(modal.getByText(/Photo queued/i)).toBeVisible({ timeout: 5000 });
  });

  test('PWA offline cache available', async ({ page, context }) => {
    await openFirstPlan(page);
    // ensure service worker registered
    await page.waitForTimeout(500);
    const registrations = await context.serviceWorkers();
    expect(registrations.length).toBeGreaterThan(0);
  });

  test('Issues modal shows button text', async ({ page }) => {
    await openFirstPlan(page);
    const viewBtn = page.getByRole('button', { name: /View Issues/i });
    await expect(viewBtn).toBeVisible();
    await viewBtn.click();
    const modal = page.locator('#issuesModal');
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('heading', { name: /Issues for:/i })).toBeVisible();
  });
});
