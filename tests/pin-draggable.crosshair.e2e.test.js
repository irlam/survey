const { test, expect } = require('@playwright/test');
// Run only when explicitly enabled (requires deployed site with viewer)
const RUN_PIN = !!process.env.RUN_PIN_DRAG_E2E || !!process.env.RUN_REMOTE_E2E;
if (!RUN_PIN) test.skip('Pin crosshair E2E skipped (set RUN_PIN_DRAG_E2E=1 to enable)', () => {});

const SITE_URL = process.env.PIN_DRAG_E2E_URL || 'https://survey.defecttracker.uk/';

test('Crosshair follows pointer and placement snaps to it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  page.on('console', msg => { try{ console.log('PAGE LOG:', msg.text()); }catch(e){} });
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

  // Dispatch pointerdown then pointerup via page context to reliably trigger long-press (1.2s)
  await page.evaluate(({x,y}) => {
    const overlay = document.querySelector('#pdfContainer .pdfOverlay') || document.querySelector('#pdfContainer');
    if (!overlay) throw new Error('No overlay element to dispatch pointer events');
    const dispatch = (type, clientX, clientY) => {
      const ev = new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', clientX, clientY });
      overlay.dispatchEvent(ev);
    };
    dispatch('pointerdown', x, y);
    // send a couple of pointermove events during the hold so the crosshair handler updates overlay._issueHold.currentX/Y
    setTimeout(()=> dispatch('pointermove', x+2, y+2), 300);
    setTimeout(()=> dispatch('pointermove', x-2, y-2), 800);
    return new Promise(res => setTimeout(() => { dispatch('pointerup', x, y); res(); }, 1200));
  }, { x: box.x, y: box.y });

  // Wait for modal to appear (give more time in case of slow rendering)
  const modal = page.locator('#issueModal');
  await modal.waitFor({ state: 'visible', timeout: 15000 });

  // Debug: capture overlay hold and rect info
  const debug = await page.evaluate(()=>{ const overlay = document.querySelector('#pdfContainer .pdfOverlay'); const hold = overlay && overlay._issueHold ? { startX: overlay._issueHold.startX, startY: overlay._issueHold.startY, currentX: overlay._issueHold.currentX, currentY: overlay._issueHold.currentY } : null; const rect = overlay ? { left: overlay.getBoundingClientRect().left, top: overlay.getBoundingClientRect().top, width: overlay.getBoundingClientRect().width, height: overlay.getBoundingClientRect().height } : null; return { hold, rect }; });

  // ensure crosshair is visible and used for snapping
  const crossVisible = await page.evaluate(()=>{ const el = window.__crosshair && window.__crosshair.element; return !!(el && el.classList && el.classList.contains('visible')); });
  console.log('DEBUG: crosshair visible =>', crossVisible);
  expect(crossVisible).toBe(true);

  const coords = await page.locator('#issueCoords').textContent();
  console.log('DEBUG: overlay hold/rect =>', JSON.stringify(debug));
  console.log('DEBUG: issue coords =>', coords);
  const match = coords.match(/x:(\d\.\d{2})\s+y:(\d\.\d{2})/);
  expect(match).not.toBeNull();
  const x = parseFloat(match[1]); const y = parseFloat(match[2]);
  // tighter acceptance tolerance: within ~2.5% (~0.025)
  expect(Math.abs(x - 0.50)).toBeLessThan(0.025);
  expect(Math.abs(y - 0.50)).toBeLessThan(0.025);
});