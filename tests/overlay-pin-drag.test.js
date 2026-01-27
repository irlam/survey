const assert = require('assert');
const { JSDOM } = require('jsdom');

// Load viewer into test env (it attaches globals)
const vm = new JSDOM('<!doctype html><html><body><div id="pdfContainer"></div></body></html>', { url: 'http://localhost' });
global.window = vm.window; global.document = vm.window.document; global.navigator = vm.window.navigator;
// Provide a no-op fetch for loadPinSvg if triggered
global.fetch = async ()=>({ ok: true, text: async ()=>'<svg><circle/></svg>' });

require('../app/viewer.js');

(async ()=>{
  // Setup environment
  currentPage = 1;
  dbPins = [{ id: 999, page: 1, x_norm: 0.2, y_norm: 0.3, label: '1' }];
  addIssueMode = true;
  // prevent network svg work by setting cached svg text
  _pinSvgText = '<svg><circle/></svg>';

  // Create overlay element and stub its bbox
  const overlay = document.createElement('div'); overlay.id = 'overlay'; overlay.style.width = '400px'; overlay.style.height = '300px';
  overlay.getBoundingClientRect = ()=>({ left: 0, top: 0, width: 400, height: 300 });

  // Call renderPinsForPage to create pins
  await renderPinsForPage(overlay, 400, 300);

  // Find the created pin element
  const pinEl = overlay.querySelector('.db-pin');
  assert(pinEl, 'db-pin should exist');

  // Stub pointer capture methods
  pinEl.setPointerCapture = ()=>{};
  pinEl.releasePointerCapture = ()=>{};

  // Stub apiSaveIssue to capture calls
  let savedIssue = null;
  apiSaveIssue = async (issue) => { savedIssue = issue; return { ok:true, id: issue.id || 123 }; };

  // Simulate pointerdown at x=80 (norm 0.2*400=80) y=90
  const down = new window.PointerEvent('pointerdown', { clientX: 80, clientY: 90, pointerId: 5, bubbles: true });
  pinEl.dispatchEvent(down);

  // Simulate move to x=200 (norm 0.5)
  const move = new window.PointerEvent('pointermove', { clientX: 200, clientY: 150, pointerId: 5, bubbles: true });
  window.dispatchEvent(move);

  // Simulate pointerup
  const up = new window.PointerEvent('pointerup', { clientX: 200, clientY: 150, pointerId: 5, bubbles: true });
  window.dispatchEvent(up);

  // Wait a tick for async save to complete
  await new Promise(r=>setTimeout(r, 50));

  assert(savedIssue, 'apiSaveIssue should have been called');
  assert(Math.abs(savedIssue.x_norm - 0.5) < 0.02, 'x_norm should be updated to ~0.5');
  assert(Math.abs(savedIssue.y_norm - 0.5) < 0.02, 'y_norm should be updated to ~0.5');

  console.log('Overlay pin drag test passed');
})();