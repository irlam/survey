const { test, expect } = require('@playwright/test');
const RUN_PIN = !!process.env.RUN_PIN_DRAG_E2E || !!process.env.RUN_REMOTE_E2E;
if (!RUN_PIN) test.skip('Pin-drag preview E2E skipped (set RUN_PIN_DRAG_E2E=1 to enable)', () => {});
const SITE_URL = process.env.PIN_DRAG_E2E_URL || 'https://survey.defecttracker.uk/';

// Utility to create a fake pdfCanvas to render previews from when running locally
async function ensurePdfCanvas(page){
  await page.evaluate(() => {
    let c = document.getElementById('pdfCanvas');
    if (!c) {
      c = document.createElement('canvas');
      c.id = 'pdfCanvas';
      c.width = 1200; c.height = 900;
      c.style.width = '1200px'; c.style.height = '900px';
      const ctx = c.getContext('2d'); ctx.fillStyle = '#f6f7f9'; ctx.fillRect(0,0,c.width,c.height);
      document.querySelector('#pdfContainer')?.appendChild(c) || document.body.appendChild(c);
    }
  });
}

// Small tolerance for normalized position checks
const TOL = 0.06;

test('Preview shows pin overlay and pin can be dragged in Add Issue mode', async ({ page }) => {
  await page.goto(SITE_URL, { waitUntil: 'networkidle' });

  // ensure add-mode active
  const addBtn = page.locator('#btnAddIssueMode');
  await addBtn.waitFor({ state: 'visible', timeout: 15000 });
  await addBtn.click();

  // ensure pdfCanvas exists for preview rendering
  await ensurePdfCanvas(page);

  // initial normalized coordinates
  const start = { x: 0.28, y: 0.36 };

  // open the issue modal with provided coordinates
  await page.evaluate(({start}) => {
    if (typeof showIssueModal === 'function') {
      showIssueModal({ page: 1, x_norm: start.x, y_norm: start.y, label: 'PV' });
    } else {
      throw new Error('showIssueModal not available');
    }
  }, { start });

  const modal = page.locator('#issueModal');
  await expect(modal).toBeVisible();

  const previewWrap = modal.locator('#issuePreviewWrap');
  await expect(previewWrap).toBeVisible({ timeout: 5000 });

  // wait for preview pin element
  const pin = previewWrap.locator('.preview-pin');
  await pin.waitFor({ state: 'attached', timeout: 5000 });
  await expect(pin).toBeVisible();

  // compute normalized position of the pin and compare with initial coords
  const pos = await pin.evaluate((el, pwSel) => {
    const rPin = el.getBoundingClientRect();
    const rWrap = el.parentElement.getBoundingClientRect();
    const cx = (rPin.left + rPin.width/2 - rWrap.left) / rWrap.width;
    const cy = (rPin.top + rPin.height/2 - rWrap.top) / rWrap.height;
    return { cx, cy };
  });

  expect(Math.abs(pos.cx - start.x)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(pos.cy - start.y)).toBeLessThanOrEqual(TOL);

  // Drag the pin by 80px right and 40px down using mouse events
  const pinBox = await pin.boundingBox();
  if (!pinBox) throw new Error('Pin bounding box not available');
  const startX = pinBox.x + pinBox.width/2; const startY = pinBox.y + pinBox.height/2;
  const targetX = startX + 80; const targetY = startY + 40;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(targetX, targetY, { steps: 8 });
  await page.mouse.up();

  // allow UI to update
  await page.waitForTimeout(200);

  // Check that the coords text updated in the modal
  const coordsText = await modal.locator('#issueCoords').textContent();
  // parse x and y
  const m = (coordsText || '').match(/x:([0-9.]+)\s+y:([0-9.]+)/);
  if (!m) throw new Error('Coords text not found after drag: ' + coordsText);
  const newX = parseFloat(m[1]); const newY = parseFloat(m[2]);
  // expected approx normalized: compute based on delta and wrapper size
  const wrapperBox = await previewWrap.boundingBox();
  const expectedX = Math.max(0, Math.min(1, start.x + (80 / wrapperBox.width)));
  const expectedY = Math.max(0, Math.min(1, start.y + (40 / wrapperBox.height)));
  expect(Math.abs(newX - expectedX)).toBeLessThanOrEqual(0.08);
  expect(Math.abs(newY - expectedY)).toBeLessThanOrEqual(0.08);

  // cleanup
  await page.locator('#issueCancelBtn').click();
});
