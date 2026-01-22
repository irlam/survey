// app/viewer.js (single clean implementation)
// Exposes `startViewer()` and `openPlanInApp()` on window
window.__viewerDebugCounter = (window.__viewerDebugCounter || 0) + 1;
console.log('[DEBUG] viewer.js loaded, counter:', window.__viewerDebugCounter);

// State
let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;
let userZoom = 1.0;
let fitScale = 1.0;
let fitMode = true;
let addIssueMode = false;
let tempPins = [];
let dbPins = [];

// Helpers
function qs(sel){ return document.querySelector(sel); }
function getPlanIdFromUrl(){ const u = new URL(window.location.href); const v = u.searchParams.get('plan_id'); const n = parseInt(v||'0',10); return Number.isFinite(n) && n>0 ? n : null; }
function setStatus(text){ const el = qs('#viewerMsg'); if(el) el.textContent = text||''; }
function setTitle(text){ const el = qs('#planTitle'); if(el) el.textContent = text||'Plan'; }
function setModeBadge(){ const b = qs('#modeBadge'); if(!b) return; b.style.display = addIssueMode ? 'inline-flex' : 'none'; }
function setBadges(){ const pageBadge = qs('#pageBadge'); if(pageBadge) pageBadge.textContent = totalPages?`Page ${currentPage} / ${totalPages}`:'Page - / -'; const pageInput = qs('#pageInput'); if(pageInput && totalPages) pageInput.value = String(currentPage); const zoomBadge = qs('#zoomBadge'); if(zoomBadge) zoomBadge.textContent = `${Math.round(userZoom*100)}%`; }

function ensurePdfJsConfigured(){ if(!window.pdfjsLib) throw new Error('PDF.js not loaded'); window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js'; }
function stageWidth(){ const stage = qs('#pdfStage'); if(!stage) return window.innerWidth; return Math.max(320, stage.clientWidth - 16); }

function ensureWrapAndOverlay(){
  const container = qs('#pdfContainer'); if(!container) throw new Error('Missing #pdfContainer');
  let wrap = container.querySelector('.pdfWrap'); if(!wrap){ wrap = document.createElement('div'); wrap.className = 'pdfWrap'; container.innerHTML = ''; container.appendChild(wrap); }
  let canvas = wrap.querySelector('canvas'); if(!canvas){ canvas = document.createElement('canvas'); canvas.id = 'pdfCanvas'; wrap.appendChild(canvas); }
  let overlay = wrap.querySelector('.pdfOverlay'); if(!overlay){ overlay = document.createElement('div'); overlay.className = 'pdfOverlay'; wrap.appendChild(overlay);
    overlay.addEventListener('pointerdown', async (e)=>{
      if(!addIssueMode) return;
      const canvasRect = canvas.getBoundingClientRect();
      if(e.clientX < canvasRect.left || e.clientX > canvasRect.right || e.clientY < canvasRect.top || e.clientY > canvasRect.bottom) return;
      const overlayRect = overlay.getBoundingClientRect();
      const x = e.clientX - overlayRect.left; const y = e.clientY - overlayRect.top; const w = overlayRect.width; const h = overlayRect.height; if(w<=0||h<=0) return;
      const x_norm = Math.max(0, Math.min(1, x/w)); const y_norm = Math.max(0, Math.min(1, y/h));
      const label = String(tempPins.filter(p=>p.page===currentPage).length + 1);
      showIssueModal({page: currentPage, x_norm, y_norm, label});
    }, {capture:true});
  }
  overlay.style.pointerEvents = addIssueMode ? 'auto' : 'none';
  return {wrap, canvas, overlay};
}

// API wrappers
async function apiGetPlan(planId){ const res = await fetch(`/api/get_plan.php?plan_id=${encodeURIComponent(planId)}`, {credentials:'same-origin'}); const txt = await res.text(); let data; try{ data = JSON.parse(txt); }catch{ throw new Error(`get_plan invalid JSON: ${txt}`); } if(!res.ok || !data.ok) throw new Error(data.error || `get_plan failed: HTTP ${res.status}`); return data; }
async function apiListIssues(planId){ const res = await fetch(`/api/list_issues.php?plan_id=${encodeURIComponent(planId)}`, {credentials:'same-origin'}); const txt = await res.text(); let data; try{ data = JSON.parse(txt); }catch{ throw new Error(`list_issues invalid JSON: ${txt}`); } if(!res.ok || !data.ok) throw new Error(data.error || `list_issues failed: HTTP ${res.status}`); return data.issues || []; }
async function apiSaveIssue(issue){ const res = await fetch('/api/save_issue.php',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(issue)}); const txt = await res.text(); let data; try{ data = JSON.parse(txt); }catch{ throw new Error(`save_issue invalid JSON: ${txt}`); } if(!res.ok || !data.ok) throw new Error(data.error || `save_issue failed: HTTP ${res.status}`); return data; }

function clearOverlay(overlay){ overlay.innerHTML = ''; }

function renderPinsForPage(overlay, viewportWidth, viewportHeight){ clearOverlay(overlay);
  const pins = dbPins.filter(p=>p.page===currentPage);
  for(const p of pins){
    const el = document.createElement('div');
    el.className = 'pin db-pin';
    el.title = p.title || '';
    el.style.left = `${p.x_norm * viewportWidth}px`;
    el.style.top = `${p.y_norm * viewportHeight}px`;
    const labelText = p.label || p.title || '!';
    const span = document.createElement('span');
    span.className = 'pinLabel';
    span.textContent = labelText;
    el.appendChild(span);
    overlay.appendChild(el);
    el.addEventListener('click', ()=> showIssueModal(p));
  }
  for(const p of tempPins.filter(p=>p.page===currentPage)){
    const el = document.createElement('div');
    el.className = 'pin temp-pin';
    el.style.left = `${p.x_norm * viewportWidth}px`;
    el.style.top = `${p.y_norm * viewportHeight}px`;
    const span = document.createElement('span');
    span.className = 'pinLabel';
    span.textContent = p.label;
    el.appendChild(span);
    overlay.appendChild(el);
  }
}

async function renderPage(pageNo){ if(!pdfDoc) return; const {wrap, canvas, overlay} = ensureWrapAndOverlay(); const ctx = canvas.getContext('2d'); setStatus(`Rendering page ${pageNo}…`); const page = await pdfDoc.getPage(pageNo); const w = stageWidth(); const v1 = page.getViewport({scale:1.0}); fitScale = w / v1.width; const effectiveScale = fitMode ? (fitScale * userZoom) : userZoom; const viewport = page.getViewport({scale: effectiveScale}); const dpr = window.devicePixelRatio || 1; canvas.width = Math.floor(viewport.width * dpr); canvas.height = Math.floor(viewport.height * dpr); canvas.style.width = `${Math.floor(viewport.width)}px`; canvas.style.height = `${Math.floor(viewport.height)}px`; wrap.style.width = `${Math.floor(viewport.width)}px`; wrap.style.height = `${Math.floor(viewport.height)}px`; overlay.style.width = `${Math.floor(viewport.width)}px`; overlay.style.height = `${Math.floor(viewport.height)}px`; ctx.setTransform(dpr,0,0,dpr,0,0); await page.render({canvasContext:ctx, viewport}).promise; renderPinsForPage(overlay, Math.floor(viewport.width), Math.floor(viewport.height)); setStatus(''); setBadges(); setModeBadge(); }

async function goToPage(n){ if(!pdfDoc) return; const pageNo = Math.max(1, Math.min(totalPages, n)); currentPage = pageNo; await renderPage(currentPage); }

function bindUiOnce(){ if(window.__viewerBound) return; window.__viewerBound = true;
  const prevBtn = qs('#btnPrev'); const nextBtn = qs('#btnNext'); const goBtn = qs('#btnGo'); const pageInput = qs('#pageInput'); const zoomOut = qs('#btnZoomOut'); const zoomIn = qs('#btnZoomIn'); const fitBtn = qs('#btnFit'); const closeBtn = qs('#btnCloseViewer'); const addBtn = qs('#btnAddIssueMode');
  if(prevBtn) prevBtn.onclick = ()=> goToPage(currentPage-1); if(nextBtn) nextBtn.onclick = ()=> goToPage(currentPage+1);
  if(goBtn){ goBtn.onclick = ()=>{ const v = parseInt(pageInput? pageInput.value:'1',10); goToPage(Number.isFinite(v)?v:1); }; }
  if(pageInput){ pageInput.addEventListener('keydown',(e)=>{ if(e.key==='Enter'){ const v = parseInt(pageInput.value||'1',10); goToPage(Number.isFinite(v)?v:1); } }); }
  if(zoomOut) zoomOut.onclick = async ()=>{ userZoom = Math.max(0.25, userZoom-0.25); await renderPage(currentPage); };
  if(zoomIn) zoomIn.onclick = async ()=>{ userZoom = Math.min(5.0, userZoom+0.25); await renderPage(currentPage); };
  if(fitBtn) fitBtn.onclick = async ()=>{ fitMode = true; userZoom = 1.0; await renderPage(currentPage); };
  if(addBtn){ addBtn.onclick = async ()=>{ addIssueMode = !addIssueMode; addBtn.textContent = addIssueMode ? 'Done' : 'Add Issue'; setModeBadge(); if(pdfDoc) await renderPage(currentPage); }; }
  if(closeBtn){ closeBtn.onclick = ()=>{ const u = new URL(window.location.href); u.searchParams.delete('plan_id'); history.pushState({},'',u.pathname); setTitle('Select a plan'); setStatus(''); const c = qs('#pdfContainer'); if(c) c.innerHTML = ''; pdfDoc = null; totalPages = 0; currentPage = 1; userZoom = 1.0; addIssueMode = false; setModeBadge(); setBadges(); document.body.classList.remove('has-viewer'); }; }
  window.addEventListener('resize', ()=>{ if(pdfDoc) renderPage(currentPage); });
}

// Issue modal with photo upload
async function showIssueModal(pin){
  let modal = document.getElementById('issueModal');
  if(!modal){ modal = document.createElement('div'); modal.id='issueModal'; modal.style.position='fixed'; modal.style.left='50%'; modal.style.top='50%'; modal.style.transform='translate(-50%,-50%)'; modal.style.background='#222'; modal.style.color='#fff'; modal.style.zIndex=100000; modal.style.padding='20px'; modal.style.borderRadius='12px'; modal.style.boxShadow='0 0 24px #0ff8'; modal.style.maxWidth='90vw'; modal.style.width='320px'; modal.style.fontSize='16px'; modal.innerHTML = `
      <div style="margin-bottom:12px;">
        <label>Title:<br>
          <input id="issueTitle" type="text" style="width:100%;font-size:16px;" value="${pin.title||''}" maxlength="255" />
        </label>
      </div>
      <div style="margin-bottom:12px;">
        <label>Notes:<br>
          <textarea id="issueNotes" style="width:100%;height:60px;font-size:15px;">${pin.notes||''}</textarea>
        </label>
      </div>
      <div id="photoThumbs" style="margin-bottom:12px;"></div>
      <div style="margin-bottom:12px;">
        <label>Upload Photo:<br>
          <input id="issuePhotoInput" type="file" accept="image/jpeg,image/png" style="width:100%;" />
        </label>
      </div>
      <div style="text-align:right;">
        <button id="issueSaveBtn" style="background:#0ff;color:#222;font-weight:bold;padding:8px 16px;border-radius:6px;">Save</button>
        <button id="issueCancelBtn" style="background:#444;color:#fff;padding:8px 16px;border-radius:6px;">Cancel</button>
      </div>
    `; document.body.appendChild(modal); }
  modal.style.display='block'; modal.querySelector('#issueTitle').value = pin.title||''; modal.querySelector('#issueNotes').value = pin.notes||'';

  async function loadPhotoThumbs(){ const planId = getPlanIdFromUrl(); if(!planId || !pin.id) return; try{ const res = await fetch(`/api/list_photos.php?plan_id=${planId}`); const txt = await res.text(); let data; try{ data = JSON.parse(txt);}catch{return;} if(!data.ok || !Array.isArray(data.photos)) return; const thumbs = data.photos.filter(p=>p.issue_id==pin.id); const thumbsDiv = modal.querySelector('#photoThumbs'); thumbsDiv.innerHTML=''; for(const t of thumbs){ const img = document.createElement('img'); const src = t.thumb_url ? t.thumb_url : t.url; img.src = src; img.alt='Photo'; img.style.maxWidth='64px'; img.style.maxHeight='64px'; img.style.margin='2px'; thumbsDiv.appendChild(img); } }catch(e){} }
  await loadPhotoThumbs();

  modal.querySelector('#issuePhotoInput').onchange = async (e)=>{ const file = e.target.files[0]; if(!file) return; const planId = getPlanIdFromUrl(); const issueId = pin.id; if(!planId || !issueId){ alert('Save the issue first before uploading photos.'); return; } const fd = new FormData(); fd.append('file', file); fd.append('plan_id', planId); fd.append('issue_id', issueId); try{ const res = await fetch('/api/upload_photo.php',{method:'POST',body:fd,credentials:'same-origin'}); const txt = await res.text(); let data; try{ data = JSON.parse(txt); }catch{ throw new Error('Invalid photo upload response'); } if(!res.ok || !data.ok) throw new Error(data.error||'Photo upload failed'); await loadPhotoThumbs(); alert('Photo uploaded'); }catch(err){ alert('Photo upload error: '+err.message); } };

  modal.querySelector('#issueSaveBtn').onclick = async ()=>{ const planId = getPlanIdFromUrl(); const title = modal.querySelector('#issueTitle').value.trim(); const notes = modal.querySelector('#issueNotes').value.trim(); if(!title){ alert('Title is required'); return; } const issue = { plan_id: planId, page: pin.page, x_norm: pin.x_norm, y_norm: pin.y_norm, title, notes }; if(pin.id) issue.id = pin.id; try{ const saved = await apiSaveIssue(issue); modal.style.display='none'; await reloadDbPins(); await renderPage(currentPage); if(!pin.id && saved.id){ pin.id = saved.id; await showIssueModal(pin); } }catch(e){ alert('Error saving issue: '+e.message); } };


async function reloadDbPins() {
  const planId = getPlanIdFromUrl();
  if (!planId) return;
  try {
    const issues = await apiListIssues(planId);
    dbPins = issues.map(issue => ({
      id: issue.id,
      page: issue.page || 1,
      x_norm: issue.x_norm,
      y_norm: issue.y_norm,
      title: issue.title,
      notes: issue.notes,
      label: issue.label || issue.id
    }));
  } catch (e) {
    dbPins = [];
    console.error('Failed to load issues:', e);
  }
}

// Public: open a plan from the sidebar button
async function openPlanInApp(planId) {
  const u = new URL(window.location.href);
  u.searchParams.set('plan_id', String(planId));
  history.pushState({}, '', u.toString());
  await startViewer();
}
window.openPlanInApp = openPlanInApp;

// Load a PDF into the viewer
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

// Public: start viewer based on current URL plan_id
async function startViewer() {
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
    await reloadDbPins();
    await renderPage(1);
  } catch (e) {
    console.error(e);
    setStatus(e.message || 'Viewer error');
  }
}
window.startViewer = startViewer;
