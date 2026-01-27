const { test, expect } = require('@playwright/test');
// NOTE: This E2E test is skipped by default because it targets the UI wiring
// which requires the local changes to be deployed to the running site.
// It can be enabled for local/dev runs by removing the skip below.
test.skip('skipping remote run - enable locally', async ()=>{});



test('Pin is draggable in Add Issue Mode (UI only)', async ({ page }) => {
  await page.goto('https://survey.defecttracker.uk/');

  // Ensure the viewer globals are present
  await page.waitForLoadState('networkidle');

  // Create a fake pdfCanvas so the preview snapshot can be produced
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
    window.addIssueMode = true; // ensure Add Issue Mode is active
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
  await expect(previewWrap).toBeVisible();
  // wait for the draggable pin to be created (poll for up to 3s)
  let pin = null;
  try {
    pin = await modal.locator('.pin-draggable').first();
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

  // Drag the pin by ~40 pixels to the right
  const box = await pin.boundingBox();
  expect(box).not.toBeNull();
  const startX = box.x + box.width / 2; const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 60, startY, { steps: 8 });
  await page.mouse.up();

  // Wait a moment for onChange/debounce to update coords
  await page.waitForTimeout(500);

  const afterCoords = await coordsEl.textContent();
  expect(initialCoords).not.toBe(afterCoords);
  // coords should be in form x:0.XX y:0.XX
  expect(afterCoords).toMatch(/x:\d\.\d{2} y:\d\.\d{2}/);
});