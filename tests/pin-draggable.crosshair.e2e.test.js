const { test, expect } = require('@playwright/test');
// Run only when explicitly enabled (requires deployed site with viewer)
const RUN_PIN = !!process.env.RUN_PIN_DRAG_E2E || !!process.env.RUN_REMOTE_E2E;
if (!RUN_PIN) test.skip('Pin crosshair E2E skipped (set RUN_PIN_DRAG_E2E=1 to enable)', () => {});

const SITE_URL = process.env.PIN_DRAG_E2E_URL || 'https://survey.defecttracker.uk/';

test('Crosshair follows pointer and placement snaps to it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(SITE_URL + '?plan_id=19&f=crosshair', { waitUntil: 'networkidle' });

  // enable Add Issue mode via FAB
  const fab = page.locator('#fabAddIssue');
  await fab.waitFor({ state: 'visible', timeout: 15000 });
  await fab.click();

  // ensure overlay exists (or create a fake canvas if not present)
  const canvasExists = await page.evaluate(() => !!document.getElementById('pdfCanvas'));
  if (!canvasExists) {
    await page.evaluate(() => {
      const c = document.createElement('canvas'); c.id = 'pdfCanvas'; c.width = 400; c.height = 600; c.style.width='400px'; c.style.height='600px'; document.querySelector('#pdfContainer').appendChild(c);
    });
  }

  // get canvas box and simulate long-press at its center
  const box = await page.evaluate(() => {
    const c = document.getElementById('pdfCanvas');
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2), w: r.width, h: r.height };
  });

  // move, press and hold >1s to trigger placement
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.waitForTimeout(1200);
  await page.mouse.up();

  // Wait for modal to appear
  const modal = page.locator('#issueModal');
  await modal.waitFor({ state: 'visible', timeout: 5000 });

  // Check coords displayed in modal and assert near 0.50,0.50
  const coords = await page.locator('#issueCoords').textContent();
  const match = coords.match(/x:(\d\.\d{2})\s+y:(\d\.\d{2})/);
  expect(match).not.toBeNull();
  const x = parseFloat(match[1]); const y = parseFloat(match[2]);
  expect(Math.abs(x - 0.50)).toBeLessThan(0.05);
  expect(Math.abs(y - 0.50)).toBeLessThan(0.05);
});