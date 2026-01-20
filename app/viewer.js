let _pdf = null;
let _pageNum = 1;
let _zoom = 1;            // 1 = fit
let _fitScale = 1;
let _renderTask = null;

function $(sel) { return document.querySelector(sel); }

function setMsg(text) {
  const el = $('#viewerMsg');
  if (el) el.textContent = text || '';
}

function setPageBadge() {
  const badge = $('#pageBadge');
  if (badge && _pdf) badge.textContent = `Page ${_pageNum} / ${_pdf.numPages}`;
}

function setZoomBadge() {
  const z = $('#zoomBadge');
  if (!z) return;
  const pct = Math.round(_zoom * 100);
  z.textContent = `${pct}%`;
}

function ensureCanvas() {
  const container = $('#pdfContainer');
  if (!container) throw new Error('Missing #pdfContainer in HTML');
  let canvas = container.querySelector('canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'pdfCanvas';
    container.innerHTML = '';
    container.appendChild(canvas);
  }
  return canvas;
}

function wireDragToPan() {
  const stage = $('#pdfStage');
  if (!stage) return;

  let down = false;
  let startX = 0, startY = 0, startL = 0, startT = 0;

  stage.addEventListener('pointerdown', (e) => {
    // allow text inputs/buttons to work
    if (e.target.closest('button,input,select,textarea,a')) return;
    down = true;
    stage.setPointerCapture(e.pointerId);
    startX = e.clientX;
    startY = e.clientY;
    startL = stage.scrollLeft;
    startT = stage.scrollTop;
    stage.classList.add('dragging');
  });

  stage.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    stage.scrollLeft = startL - dx;
    stage.scrollTop = startT - dy;
  });

  const end = () => {
    down = false;
    stage.classList.remove('dragging');
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
}

async function loadPdf(planId) {
  setMsg('Loading plan…');

  const r = await fetch(`/api/get_plan.php?plan_id=${encodeURIComponent(planId)}`);
  const data = await r.json();
  if (!data.ok) throw new Error(data.error || 'Failed to load plan');

  const title = $('#planTitle');
  if (title) title.textContent = data.plan?.name ? data.plan.name : `Plan #${planId}`;

  // PDF.js global
  if (!window.pdfjsLib) throw new Error('PDF.js not loaded (check /vendor/pdfjs/pdf.min.js)');

  // worker path
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';

  setMsg('Loading PDF…');
  const task = window.pdfjsLib.getDocument({ url: data.pdf_url });
  _pdf = await task.promise;

  _pageNum = 1;
  _zoom = 1;

  await renderPage(true);
  wireControls();
  wireDragToPan();

  setMsg('');
}

async function renderPage(fit = false) {
  if (!_pdf) return;

  // cancel any in-flight render
  try { if (_renderTask) _renderTask.cancel(); } catch {}
  _renderTask = null;

  const page = await _pdf.getPage(_pageNum);

  const stage = $('#pdfStage');
  const canvas = ensureCanvas();
  const ctx = canvas.getContext('2d', { alpha: false });

  // Compute fit scale to available width
  const padding = 24;
  const stageWidth = Math.max(320, (stage?.clientWidth || window.innerWidth) - padding);

  const vp1 = page.getViewport({ scale: 1 });
  _fitScale = stageWidth / vp1.width;

  const scale = (fit ? _fitScale : _fitScale * _zoom);
  const viewport = page.getViewport({ scale });

  // HiDPI
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = Math.floor(viewport.width) + 'px';
  canvas.style.height = Math.floor(viewport.height) + 'px';

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, viewport.width, viewport.height);

  setPageBadge();
  setZoomBadge();

  _renderTask = page.render({ canvasContext: ctx, viewport });
  await _renderTask.promise;
  _renderTask = null;
}

function wireControls() {
  // Only wire once
  if (window.__viewerWired) return;
  window.__viewerWired = true;

  const prev = $('#btnPrev');
  const next = $('#btnNext');
  const go = $('#btnGo');
  const pageInput = $('#pageInput');

  const zoomOut = $('#btnZoomOut');
  const zoomIn = $('#btnZoomIn');
  const fit = $('#btnFit');

  const close = $('#btnCloseViewer');

  if (prev) prev.onclick = async () => {
    if (!_pdf || _pageNum <= 1) return;
    _pageNum--;
    await renderPage(false);
  };

  if (next) next.onclick = async () => {
    if (!_pdf || _pageNum >= _pdf.numPages) return;
    _pageNum++;
    await renderPage(false);
  };

  if (go) go.onclick = async () => {
    if (!_pdf) return;
    const n = parseInt(pageInput?.value || '1', 10);
    if (!Number.isFinite(n) || n < 1 || n > _pdf.numPages) return;
    _pageNum = n;
    await renderPage(false);
  };

  if (pageInput) {
    pageInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        go?.click();
      }
    });
  }

  if (zoomOut) zoomOut.onclick = async () => {
    _zoom = Math.max(0.5, _zoom - 0.25);
    await renderPage(false);
  };

  if (zoomIn) zoomIn.onclick = async () => {
    _zoom = Math.min(4, _zoom + 0.25);
    await renderPage(false);
  };

  if (fit) fit.onclick = async () => {
    _zoom = 1;
    await renderPage(true);
  };

  if (close) close.onclick = () => {
    document.body.classList.remove('has-viewer');
    setMsg('');
  };

  window.addEventListener('resize', () => {
    if (_pdf) renderPage(true);
  });
}

export async function openPlanInApp(planId) {
  document.body.classList.add('has-viewer');
  await loadPdf(planId);
}
