// app/viewer.js
// PDF.js viewer + overlay layer + Add Issue Mode (pins only, no DB save yet)

let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;

let userZoom = 1.0;
let fitScale = 1.0;
let fitMode = true;

let addIssueMode = false;
let tempPins = []; // {page, x_norm, y_norm, label}

function qs(sel) { return document.querySelector(sel); }

function getPlanIdFromUrl() {
  const u = new URL(window.location.href);
  const v = u.searchParams.get('plan_id');
  const n = parseInt(v || '0', 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function setStatus(text) {
  const el = qs('#viewerMsg');
  if (el) el.textContent = text || '';
}

function setTitle(text) {
  const el = qs('#planTitle');
  if (el) el.textContent = text || 'Plan';
}

function setModeBadge() {
  const b = qs('#modeBadge');
  if (!b) return;
  b.style.display = addIssueMode ? 'inline-flex' : 'none';
}

function setBadges() {
  const pageBadge = qs('#pageBadge');
  if (pageBadge) pageBadge.textContent = totalPages ? `Page ${currentPage} / ${totalPages}` : 'Page - / -';

  const pageInput = qs('#pageInput');
  if (pageInput && totalPages) pageInput.value = String(currentPage);

  const zoomBadge = qs('#zoomBadge');
  if (zoomBadge) zoomBadge.textContent = `${Math.round(userZoom * 100)}%`;
}

function ensurePdfJsConfigured() {
  if (!window.pdfjsLib) throw new Error('PDF.js not loaded. Check /vendor/pdfjs/pdf.min.js');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
}

function stageWidth() {
  const stage = qs('#pdfStage');
  if (!stage) return window.innerWidth;
  return Math.max(320, stage.clientWidth - 16);
}

function ensureWrapAndOverlay() {
  const container = qs('#pdfContainer');
  if (!container) throw new Error('Missing #pdfContainer');

  let wrap = container.querySelector('.pdfWrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'pdfWrap';
    container.innerHTML = '';
    container.appendChild(wrap);
  }

  let canvas = wrap.querySelector('canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'pdfCanvas';
    wrap.appendChild(canvas);
  }

  let overlay = wrap.querySelector('.pdfOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'pdfOverlay';
    wrap.appendChild(overlay);
  }

  // enable hit-testing when in add mode
  overlay.style.pointerEvents = addIssueMode ? 'auto' : 'none';

  return { wrap, canvas, overlay };
}

async function apiGetPlan(planId) {
  const res = await fetch(`/api/get_plan.php?plan_id=${encodeURIComponent(planId)}`, { credentials: 'same-origin' });
  const txt = await res.text();
  let data;
  try { data = JSON.parse(txt); } catch { throw new Error(`get_plan invalid JSON: ${txt}`); }
  if (!res.ok || !data.ok) throw new Error(data.error || `get_plan failed: HTTP ${res.status}`);
  return data;
}

async function loadPdf(pdfUrl) {
  ensurePdfJsConfigured();
  setStatus('Loading PDF…');

  const task = window.pdfjsLib.getDocument({ url: pdfUrl, withCredentials: true });
  pdfDoc = await task.promise;

  totalPages = pdfDoc.numPages;
  currentPage = 1;

  setStatus('');
  setBadges();
}

function clearOverlay(overlay) {
  overlay.innerHTML = '';
}

function renderPinsForPage(overlay, viewportWidth, viewportHeight) {
  clearOverlay(overlay);

  const pins = tempPins.filter(p => p.page === currentPage);
  for (const p of pins) {
    const el = document.createElement('div');
    el.className = 'pin';
    el.textContent = p.label;
    el.style.left = `${p.x_norm * viewportWidth}px`;
    el.style.top = `${p.y_norm * viewportHeight}px`;
    overlay.appendChild(el);
  }
}

async function renderPage(pageNo) {
  if (!pdfDoc) return;

  const { wrap, canvas, overlay } = ensureWrapAndOverlay();
  const ctx = canvas.getContext('2d');

  setStatus(`Rendering page ${pageNo}…`);
  const page = await pdfDoc.getPage(pageNo);

  const w = stageWidth();
  const v1 = page.getViewport({ scale: 1.0 });
  fitScale = w / v1.width;

  const effectiveScale = fitMode ? (fitScale * userZoom) : userZoom;
  const viewport = page.getViewport({ scale: effectiveScale });

  // HiDPI
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  // Wrap/overlay must match CSS pixel size
  wrap.style.width = `${Math.floor(viewport.width)}px`;
  wrap.style.height = `${Math.floor(viewport.height)}px`;
  overlay.style.width = `${Math.floor(viewport.width)}px`;
  overlay.style.height = `${Math.floor(viewport.height)}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  await page.render({ canvasContext: ctx, viewport }).promise;

  renderPinsForPage(overlay, Math.floor(viewport.width), Math.floor(viewport.height));

  setStatus('');
  setBadges();
  setModeBadge();
}

async function goToPage(n) {
  if (!pdfDoc) return;
  const pageNo = Math.max(1, Math.min(totalPages, n));
  currentPage = pageNo;
  await renderPage(currentPage);
}

function bindUiOnce() {
  if (window.__viewerBound) return;
  window.__viewerBound = true;

  const prevBtn = qs('#btnPrev');
  const nextBtn = qs('#btnNext');
  const goBtn = qs('#btnGo');
  const pageInput = qs('#pageInput');
  const zoomOut = qs('#btnZoomOut');
  const zoomIn = qs('#btnZoomIn');
  const fitBtn = qs('#btnFit');
  const closeBtn = qs('#btnCloseViewer');
  const addBtn = qs('#btnAddIssueMode');

  if (prevBtn) prevBtn.onclick = () => goToPage(currentPage - 1);
  if (nextBtn) nextBtn.onclick = () => goToPage(currentPage + 1);

  if (goBtn) {
    goBtn.onclick = () => {
      const v = parseInt(pageInput ? pageInput.value : '1', 10);
      goToPage(Number.isFinite(v) ? v : 1);
    };
  }
  if (pageInput) {
    pageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const v = parseInt(pageInput.value || '1', 10);
        goToPage(Number.isFinite(v) ? v : 1);
      }
    });
  }

  if (zoomOut) zoomOut.onclick = async () => { userZoom = Math.max(0.25, userZoom - 0.25); await renderPage(currentPage); };
  if (zoomIn) zoomIn.onclick = async () => { userZoom = Math.min(5.0, userZoom + 0.25); await renderPage(currentPage); };
  if (fitBtn) fitBtn.onclick = async () => { fitMode = true; userZoom = 1.0; await renderPage(currentPage); };

  if (addBtn) {
    addBtn.onclick = async () => {
      addIssueMode = !addIssueMode;
      addBtn.textContent = addIssueMode ? 'Done' : 'Add Issue';
      setModeBadge();

      // Enable overlay hit-testing immediately
      const container = qs('#pdfContainer');
      const overlay = container ? container.querySelector('.pdfOverlay') : null;
      if (overlay) overlay.style.pointerEvents = addIssueMode ? 'auto' : 'none';

      console.log('AddIssueMode:', addIssueMode, 'modeBadge:', document.querySelector('#modeBadge'));
      console.log('Overlay:', overlay, 'pointerEvents:', overlay?.style.pointerEvents);

      // Re-render so overlay matches the current canvas size and pins redraw
      if (pdfDoc) await renderPage(currentPage);
    };
  }

  // Tap on overlay to place a temporary pin (pointerdown is better on tablets)
  document.addEventListener('pointerdown', async (e) => {
    console.log('DEBUG: pointerdown event fired', e);
    if (!addIssueMode) return;

    const overlay = qs('.pdfOverlay');
    console.log('tap target:', e.target, 'overlay:', overlay);

    if (!overlay) return;

    // Only accept taps that happen on the overlay itself (or its children)
    if (!overlay.contains(e.target)) return;

    const rect = overlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const w = rect.width;
    const h = rect.height;
    if (w <= 0 || h <= 0) return;

    const x_norm = Math.max(0, Math.min(1, x / w));
    const y_norm = Math.max(0, Math.min(1, y / h));

    const label = String(tempPins.filter(p => p.page === currentPage).length + 1);
    tempPins.push({ page: currentPage, x_norm, y_norm, label });

    await renderPage(currentPage);
  }, { capture: true });

  if (closeBtn) {
    closeBtn.onclick = () => {
      const u = new URL(window.location.href);
      u.searchParams.delete('plan_id');
      history.pushState({}, '', u.pathname);

      setTitle('Select a plan');
      setStatus('');

      const c = qs('#pdfContainer');
      if (c) c.innerHTML = '';

      pdfDoc = null;
      totalPages = 0;
      currentPage = 1;
      userZoom = 1.0;

      addIssueMode = false;
      setModeBadge();
      setBadges();

      document.body.classList.remove('has-viewer');
    };
  }

  window.addEventListener('resize', () => {
    if (pdfDoc) renderPage(currentPage);
  });
}

// Public: open a plan from the sidebar button
export async function openPlanInApp(planId) {
  const u = new URL(window.location.href);
  u.searchParams.set('plan_id', String(planId));
  history.pushState({}, '', u.toString());
  await startViewer();
}

// Public: start viewer based on current URL plan_id
export async function startViewer() {
  bindUiOnce();

  const planId = getPlanIdFromUrl();
  if (!planId) {
    setTitle('Select a plan');
    setStatus('');
    setBadges();
    return;
  }

  document.body.classList.add('has-viewer');

  try {
    const data = await apiGetPlan(planId);
    const plan = data.plan || {};
    const pdfUrl = data.pdf_url || plan.pdf_url || `/api/plan_file.php?plan_id=${planId}`;

    setTitle(plan.name || `Plan ${planId}`);

    fitMode = true;
    userZoom = 1.0;

    await loadPdf(pdfUrl);
    await renderPage(1);
  } catch (e) {
    console.error(e);
    setStatus(e.message || 'Viewer error');
  }
}
