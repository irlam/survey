// app/viewer.js
// In-app PDF.js viewer: loads plan via API then renders with PDF.js

let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;
let scale = 1.0;

function qs(sel) { return document.querySelector(sel); }
function qsa(sel) { return Array.from(document.querySelectorAll(sel)); }

function getPlanIdFromUrl() {
  const u = new URL(window.location.href);
  const v = u.searchParams.get('plan_id');
  const n = parseInt(v || '0', 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function setStatus(text) {
  const el = qs('#viewerStatus');
  if (el) el.textContent = text || '';
}

function setPageBadge() {
  const badge = qs('#pageBadge');
  if (badge) badge.textContent = totalPages ? `Page ${currentPage} / ${totalPages}` : 'Page - / -';
  const input = qs('#pageInput');
  if (input) input.value = totalPages ? String(currentPage) : '';
  const zoom = qs('#zoomPct');
  if (zoom) zoom.textContent = `${Math.round(scale * 100)}%`;
}

function getCanvas() {
  return qs('#pdfCanvas');
}

function getContainer() {
  return qs('#pdfStage');
}

async function fetchPlan(planId) {
  const res = await fetch(`/api/get_plan.php?plan_id=${encodeURIComponent(planId)}`, { credentials: 'same-origin' });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`get_plan invalid JSON: ${text}`); }
  if (!res.ok || !data.ok) throw new Error(data.error || `get_plan failed: HTTP ${res.status}`);
  return data;
}

function ensurePdfJsConfigured() {
  // Expect pdfjsLib global from /vendor/pdfjs/pdf.min.js
  if (!window.pdfjsLib) throw new Error('PDF.js not loaded. Check /vendor/pdfjs/pdf.min.js');
  // Worker path
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
}

async function loadPdf(pdfUrl) {
  ensurePdfJsConfigured();
  setStatus('Loading PDF…');
  const task = window.pdfjsLib.getDocument({ url: pdfUrl, withCredentials: true });
  pdfDoc = await task.promise;
  totalPages = pdfDoc.numPages;
  currentPage = 1;
  setStatus('');
  setPageBadge();
}

async function renderPage(pageNo) {
  if (!pdfDoc) return;
  const canvas = getCanvas();
  const stage = getContainer();
  if (!canvas || !stage) throw new Error('Missing #pdfCanvas or #pdfStage in HTML');

  setStatus(`Rendering page ${pageNo}…`);
  const page = await pdfDoc.getPage(pageNo);

  // Calculate a sensible "fit" scale if scale is not set yet
  // We'll keep current scale, but if it is tiny/NaN, compute fit-to-width.
  let desiredScale = scale;
  if (!desiredScale || !Number.isFinite(desiredScale) || desiredScale < 0.1) desiredScale = 1.0;

  // Fit-to-width helper (stage width)
  const stageWidth = stage.clientWidth || window.innerWidth;
  const viewport1 = page.getViewport({ scale: 1.0 });
  const fitScale = stageWidth ? (stageWidth / viewport1.width) : 1.0;

  // If we're in "fit" mode we set scale = fitScale; otherwise keep.
  if (window.__viewerFitMode === true) {
    scale = Math.min(Math.max(fitScale, 0.25), 5.0);
  }

  const viewport = page.getViewport({ scale });

  // HiDPI support
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  await page.render({ canvasContext: ctx, viewport }).promise;

  setStatus('');
  setPageBadge();
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
      const v = parseInt((pageInput && pageInput.value) ? pageInput.value : '1', 10);
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
      window.__viewerFitMode = false;
      scale = Math.max(0.25, scale - 0.25);
      await renderPage(currentPage);
    };
  }
  if (zoomIn) {
    zoomIn.onclick = async () => {
      window.__viewerFitMode = false;
      scale = Math.min(5.0, scale + 0.25);
      await renderPage(currentPage);
    };
  }
  if (fitBtn) {
    fitBtn.onclick = async () => {
      window.__viewerFitMode = true;
      await renderPage(currentPage);
    };
  }

  // Re-render on resize (keeps fit mode correct)
  window.addEventListener('resize', () => {
    if (window.__viewerFitMode) renderPage(currentPage);
  });
}

export async function startViewer() {
  const planId = getPlanIdFromUrl();
  if (!planId) {
    setStatus('Missing plan_id in URL');
    return;
  }

  bindUi();

  try {
    const data = await fetchPlan(planId);
    const pdfUrl = data.pdf_url || (data.plan ? data.plan.pdf_url : null) || data.plan_url;
    // Your get_plan.php should return: { ok:true, plan:{...}, pdf_url:"/api/plan_file.php?plan_id=..." }
    const finalUrl = pdfUrl || (data.plan && data.plan.file_path ? `/api/plan_file.php?plan_id=${planId}` : null);
    if (!finalUrl) throw new Error('No pdf_url returned from API');

    window.__viewerFitMode = true; // start in Fit mode (best for mobile)
    await loadPdf(finalUrl);
    await renderPage(1);
  } catch (e) {
    console.error(e);
    setStatus(e.message || 'Viewer error');
  }
}
