// app/viewer.js
// In-app PDF.js viewer wired to viewer.html markup

let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;

let userZoom = 1.0;   // 1.0 = 100% of fit scale
let fitScale = 1.0;   // computed each render
let fitMode = true;   // keep fit mode for tablet/mobile

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

function ensureCanvas() {
  const container = qs('#pdfContainer');
  if (!container) throw new Error('Missing #pdfContainer in HTML');

  let canvas = container.querySelector('canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'pdfCanvas';
    canvas.style.display = 'block';
    canvas.style.margin = '0 auto';
    canvas.style.background = '#0b1220';
    container.innerHTML = '';
    container.appendChild(canvas);
  }
  return canvas;
}

function stageWidth() {
  const stage = qs('#pdfStage');
  if (!stage) return window.innerWidth;
  return Math.max(320, stage.clientWidth - 16);
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

async function renderPage(pageNo) {
  if (!pdfDoc) return;

  const canvas = ensureCanvas();
  const ctx = canvas.getContext('2d');

  setStatus(`Rendering page ${pageNo}…`);
  const page = await pdfDoc.getPage(pageNo);

  // Fit-to-width is base; userZoom scales around it
  const w = stageWidth();
  const v1 = page.getViewport({ scale: 1.0 });
  fitScale = w / v1.width;

  const effectiveScale = fitMode ? (fitScale * userZoom) : userZoom;
  const viewport = page.getViewport({ scale: effectiveScale });

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  await page.render({ canvasContext: ctx, viewport }).promise;

  setStatus('');
  setBadges();
}

async function goToPage(n) {
  if (!pdfDoc) return;
  const pageNo = Math.max(1, Math.min(totalPages, n));
  currentPage = pageNo;
  await renderPage(currentPage);
}

function showViewerShell(on) {
  // viewer.html always shows it, but you might want to toggle message/state
  // Keep as a hook for later if you hide/show panels
  const shell = qs('.viewerShell');
  if (shell) shell.style.display = on ? '' : '';
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

  if (zoomOut) {
    zoomOut.onclick = async () => {
      userZoom = Math.max(0.25, userZoom - 0.25);
      await renderPage(currentPage);
    };
  }
  if (zoomIn) {
    zoomIn.onclick = async () => {
      userZoom = Math.min(5.0, userZoom + 0.25);
      await renderPage(currentPage);
    };
  }

  if (fitBtn) {
    fitBtn.onclick = async () => {
      fitMode = true;
      userZoom = 1.0;
      await renderPage(currentPage);
    };
  }

  if (closeBtn) {
    closeBtn.onclick = () => {
      const u = new URL(window.location.href);
      u.searchParams.delete('plan_id');
      history.pushState({}, '', u.pathname);
      setTitle('Select a plan');
      setStatus('');
      // Clear canvas (optional)
      const c = qs('#pdfContainer');
      if (c) c.innerHTML = '';
      pdfDoc = null;
      totalPages = 0;
      currentPage = 1;
      userZoom = 1.0;
      setBadges();
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
    showViewerShell(true);
    setTitle('Select a plan');
    setStatus('');
    setBadges();
    return;
  }

  showViewerShell(true);

  try {
    const data = await apiGetPlan(planId);
    const plan = data.plan || {};
    const pdfUrl = data.pdf_url || plan.pdf_url || `/api/plan_file.php?plan_id=${planId}`;

    setTitle(plan.name || `Plan ${planId}`);

    // Start in fit mode for mobile/tablets
    fitMode = true;
    userZoom = 1.0;

    await loadPdf(pdfUrl);
    await renderPage(1);
  } catch (e) {
    console.error(e);
    setStatus(e.message || 'Viewer error');
  }
}
