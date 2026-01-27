const { test, expect } = require('@playwright/test');
// NOTE: This E2E test is skipped by default because it targets the UI wiring
// which requires a deployed/dev site available. Enable by setting the
// environment variable `RUN_PIN_DRAG_E2E=1` and optionally `PIN_DRAG_E2E_URL`.
const RUN_PIN = !!process.env.RUN_PIN_DRAG_E2E || !!process.env.RUN_REMOTE_E2E;
if (!RUN_PIN) test.skip('Pin-drag E2E skipped (set RUN_PIN_DRAG_E2E=1 to enable)', () => {});

const SITE_URL = process.env.PIN_DRAG_E2E_URL || 'https://survey.defecttracker.uk/';

test('Pin is draggable in Add Issue Mode (UI only)', async ({ page }) => {
  await page.goto(SITE_URL, { waitUntil: 'networkidle' });

  // Wait for the Add Issue toggle to be available then enable it via UI
  const addBtn = page.locator('#btnAddIssueMode');
  await addBtn.waitFor({ state: 'visible', timeout: 15000 });
  await addBtn.click();

  // Ensure the viewer globals are present
  await page.waitForLoadState('networkidle');

  // Create a fake pdfCanvas if the site doesn't render one
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

  // Open the issue modal directly with a new pin
  await page.evaluate(() => {
    if (typeof showIssueModal === 'function') {
      showIssueModal({ page: 1, x_norm: 0.25, y_norm: 0.25, label: '1' });
    } else {
      throw new Error('showIssueModal not available');
    }
  });

  // Wait for the modal and preview area to appear
  const modal = page.locator('#issueModal');
  await expect(modal).toBeVisible();

  // debug: ensure PinDraggable lib loaded (or attempted)
  const libLoaded = await page.evaluate(() => !!window.PinDraggable);
  console.log('PinDraggable lib present:', libLoaded);

  const previewWrap = modal.locator('#issuePreviewWrap');
  try{
    await expect(previewWrap).toBeVisible({ timeout: 5000 });
  }catch(e){
    const inner = await modal.innerHTML();
    console.log('Modal innerHTML snapshot (first 1000 chars):', inner.slice(0,1000));
    throw new Error('Preview area not available on the site. Ensure the deployed code includes the preview markup (#issuePreviewWrap / #issuePreviewCanvas).');
  }

  // wait for the draggable pin to be created (poll for up to 3s)
  let pin = null;
  try {
    pin = modal.locator('.pin-draggable').first();
    await pin.waitFor({ state: 'visible', timeout: 3000 });
  } catch (e) {
    // On failure, capture preview innerHTML for diagnostics
    const inner = await previewWrap.innerHTML();
    console.log('Preview innerHTML snapshot:', inner.slice(0, 500));
    throw e;
  }

  // Record initial coords text
  const coordsEl = modal.locator('#issueCoords');
  const initialCoords = await coordsEl.textContent();

  // Drag the pin by ~60 pixels to the right
  const box = await pin.boundingBox();
  expect(box).not.toBeNull();
  const startX = box.x + box.width / 2; const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 60, startY, { steps: 8 });
  await page.mouse.up();

  // Wait a moment for onChange/debounce to update coords
  await page.waitForTimeout(700);

  const afterCoords = await coordsEl.textContent();
  expect(initialCoords).not.toBe(afterCoords);
  // coords should be in form x:0.XX y:0.XX
  expect(afterCoords).toMatch(/x:\d\.\d{2} y:\d\.\d{2}/);
});