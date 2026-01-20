// app/viewer.js
// In-app PDF.js viewer wired to your current index.html markup

let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;
let scale = 1.0;          // user zoom multiplier
let fitScale = 1.0;       // computed each render
let fitMode = true;       // start in fit mode

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
  if (zoomBadge) {
    // show the *effective* scale (fitScale * userScale)
    const effective = fitScale * scale;
    zoomBadge.textContent = `${Math.round(effective * 100)}%`;
  }
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

function getStageWidth() {
  const stage = qs('#pdfStage');
  if (!stage) return window.innerWidth;
  // Use container width (minus a little padding)
  return Math.max(320, stage.clientWidth - 16);
}

async function fetchPlan(planId) {
  const res = await fetch(`/api/get_plan.php?plan_id=${encodeURIComponent(planId)}`, { credentials: 'same-origin' });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`get_plan invalid JSON: ${text}`); }
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

  // compute fitScale based on stage width
  const stageW = getStageWidth();
  const v1 = page.getViewport({ scale: 1.0 });
  fitScale = stageW / v1.width;

  // effective scale
  const effectiveScale = fitMode ? fitScale * scale : scale;

  const viewport = page.getViewport({ scale: effectiveScale });

  // HiDPI
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

function bindUi() {
  const prevBtn = qs('#btnPrev');
  const nextBtn = qs('#btnNext');
  const goBtn = qs('#btnGo');
  const pageInput = qs('#pageInput');
  const zoomOut = qs('#btnZoomOut');
  const zoomIn = qs('#btnZoomIn');
  const fitBtn = qs('#btnFit');

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
      // keep fit mode on, just reduce user zoom
      scale = Math.max(0.25, scale - 0.25);
      await renderPage(currentPage);
    };
  }
  if (zoomIn) {
    zoomIn.onclick = async () => {
      scale = Math.min(5.0, scale + 0.25);
      await renderPage(currentPage);
    };
  }
  if (fitBtn) {
    fitBtn.onclick = async () => {
      // toggle fit mode
      fitMode = true;
      scale = 1.0;
      await renderPage(currentPage);
    };
  }

  // Re-render on resize (especially important for tablet landscape)
  window.addEventListener('resize', () => {
    if (pdfDoc) renderPage(currentPage);
  });
}

export async function startViewer() {
  const planId = getPlanIdFromUrl();
  if (!planId) {
    setStatus('Select a plan to view');
    return;
  }

  bindUi();

  try {
    const data = await fetchPlan(planId);

    // support both styles:
    // { ok:true, plan:{...}, pdf_url:"..." }
    const plan = data.plan || {};
    const pdfUrl = data.pdf_url || plan.pdf_url || `/api/plan_file.php?plan_id=${planId}`;

    setTitle(plan.name || `Plan ${planId}`);

    // Start in fit mode, 100%
    fitMode = true;
    scale = 1.0;

    await loadPdf(pdfUrl);
    await renderPage(1);
  } catch (e) {
    console.error(e);
    setStatus(e.message || 'Viewer error');
  }
}
