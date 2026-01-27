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
// local toast fallback
function localShowToast(msg, timeout=2200){ try{ if(window && typeof window.showToast === 'function'){ window.showToast(msg, timeout); return; } }catch(e){} const el = document.createElement('div'); el.textContent = msg; el.style.position='fixed'; el.style.right='20px'; el.style.bottom='20px'; el.style.zIndex=999999; el.style.background='rgba(0,0,0,0.8)'; el.style.color='#fff'; el.style.padding='10px 14px'; el.style.borderRadius='8px'; el.style.boxShadow='0 6px 18px rgba(0,0,0,.4)'; document.body.appendChild(el); setTimeout(()=>{ try{ el.remove(); }catch(e){} }, timeout); }
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

// fetch issue details by id via list_issues (safe fallback if no dedicated endpoint)
async function fetchIssueDetails(issueId){ const planId = getPlanIdFromUrl(); if(!planId || !issueId) return null; try{ const issues = await apiListIssues(planId); return issues.find(i=>String(i.id)===String(issueId)) || null; }catch(e){ console.warn('fetchIssueDetails failed', e); return null; } }

// resize/compress image file (returns Blob)
function resizeImageFile(file, maxWidth=1600, maxHeight=1600, quality=0.8){ return new Promise((resolve,reject)=>{
  const img = new Image(); const fr = new FileReader(); fr.onload = ()=>{ img.onload = ()=>{
    let w = img.naturalWidth, h = img.naturalHeight; const ratio = Math.min(1, maxWidth/w, maxHeight/h); if(ratio<1){ w = Math.round(w*ratio); h = Math.round(h*ratio); }
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; const ctx = canvas.getContext('2d'); ctx.drawImage(img,0,0,w,h);
    canvas.toBlob((blob)=>{ if(!blob) return reject(new Error('Image resize failed')); resolve(blob); }, 'image/jpeg', quality);
  }; img.onerror = (e)=>reject(new Error('Image load error')); img.src = fr.result; }; fr.onerror = ()=>reject(new Error('File read error')); fr.readAsDataURL(file); }); }

function clearOverlay(overlay){ overlay.innerHTML = ''; }

// Pin SVG loader (fetch once and cache)
let _pinSvgText = null;
let _pinSvgPromise = null;
function loadPinSvg(){ if(_pinSvgPromise) return _pinSvgPromise; _pinSvgPromise = fetch('/assets/pin.svg', {cache:'no-cache'}).then(r=> r.ok ? r.text() : null).then(t=>{ _pinSvgText = t; return t; }).catch(e=>{ console.warn('loadPinSvg failed', e); _pinSvgText = null; return null; }); return _pinSvgPromise; }

async function renderPinsForPage(overlay, viewportWidth, viewportHeight){ clearOverlay(overlay); await loadPinSvg();
  const pins = dbPins.filter(p=>p.page===currentPage);
  for(const p of pins){
    const el = document.createElement('div');
    el.className = 'pin db-pin';
    el.title = p.title || '';
    el.style.left = `${p.x_norm * viewportWidth}px`;
    el.style.top = `${p.y_norm * viewportHeight}px`;
    const labelText = String(p.id || p.label || p.title || '!');
    const fontSize = labelText.length <= 2 ? 12 : (labelText.length === 3 ? 10 : 9);
    el.innerHTML = `
      <svg viewBox="0 0 64 80" width="56" height="72" aria-hidden="true" focusable="false">
        <defs>
          <filter id="pinShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000" flood-opacity="0.25" />
          </filter>
        </defs>
        <circle cx="32" cy="20" r="16" fill="#e12b2b" filter="url(#pinShadow)" />
        <path d="M32 36 C24 48, 16 60, 32 76 C48 60, 40 48, 32 36 Z" fill="#e12b2b" />
        <text x="32" y="20" text-anchor="middle" dominant-baseline="central" fill="#000" font-weight="900" font-size="${fontSize}">${labelText}</text>
      </svg>
    `;
    overlay.appendChild(el);
    el.addEventListener('click', ()=> showIssueModal(p));
  }
  for(const p of tempPins.filter(p=>p.page===currentPage)){
    const el = document.createElement('div');
    el.className = 'pin temp-pin';
    el.style.left = `${p.x_norm * viewportWidth}px`;
    el.style.top = `${p.y_norm * viewportHeight}px`;
    const labelText = String(p.label);
    const fontSize = labelText.length <= 2 ? 12 : (labelText.length === 3 ? 10 : 9);
    el.innerHTML = `
      <svg viewBox="0 0 64 80" width="56" height="72" aria-hidden="true" focusable="false">
        <circle cx="32" cy="20" r="16" fill="#e12b2b" />
        <path d="M32 36 C24 48, 16 60, 32 76 C48 60, 40 48, 32 36 Z" fill="#e12b2b" />
        <text x="32" y="20" text-anchor="middle" dominant-baseline="central" fill="#000" font-weight="900" font-size="${fontSize}">${labelText}</text>
      </svg>
    `;
    overlay.appendChild(el);
  }
}

async function renderPage(pageNo){ if(!pdfDoc) return; const {wrap, canvas, overlay} = ensureWrapAndOverlay(); const ctx = canvas.getContext('2d'); setStatus(`Rendering page ${pageNo}…`); const page = await pdfDoc.getPage(pageNo); const w = stageWidth(); const v1 = page.getViewport({scale:1.0}); fitScale = w / v1.width; const effectiveScale = fitMode ? (fitScale * userZoom) : userZoom; const viewport = page.getViewport({scale: effectiveScale}); const dpr = window.devicePixelRatio || 1; canvas.width = Math.floor(viewport.width * dpr); canvas.height = Math.floor(viewport.height * dpr); canvas.style.width = `${Math.floor(viewport.width)}px`; canvas.style.height = `${Math.floor(viewport.height)}px`; wrap.style.width = `${Math.floor(viewport.width)}px`; wrap.style.height = `${Math.floor(viewport.height)}px`; overlay.style.width = `${Math.floor(viewport.width)}px`; overlay.style.height = `${Math.floor(viewport.height)}px`; ctx.setTransform(dpr,0,0,dpr,0,0); await page.render({canvasContext:ctx, viewport}).promise; await renderPinsForPage(overlay, Math.floor(viewport.width), Math.floor(viewport.height)); setStatus(''); setBadges(); setModeBadge(); }

async function goToPage(n){ if(!pdfDoc) return; const pageNo = Math.max(1, Math.min(totalPages, n)); currentPage = pageNo; await renderPage(currentPage); }

// Expose a global helper to let other UI code jump the viewer to a page
window.viewerGoToPage = async function(n){ try{ if(typeof goToPage==='function') await goToPage(n); }catch(e){ console.warn('viewerGoToPage failed', e); } };

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
  if(!modal){
    modal = document.createElement('div');
    modal.id='issueModal';
    modal.style.position='fixed'; modal.style.left='50%'; modal.style.top='50%'; modal.style.transform='translate(-50%,-50%)'; modal.style.background='#222'; modal.style.color='#fff'; modal.style.zIndex=100000; modal.style.padding='20px'; modal.style.borderRadius='12px'; modal.style.boxShadow='0 0 24px #0ff8'; modal.style.maxWidth='90vw'; modal.style.width='420px'; modal.style.fontSize='16px';
    modal.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px;">
        <div style="flex:1;">
          <label style="font-size:14px;">Title:<br>
            <input id="issueTitle" type="text" style="width:100%;font-size:16px;" value="${pin.title||''}" maxlength="255" />
          </label>
          <div style="display:flex;gap:8px;margin-top:8px;">
            <label style="flex:1">Status:<br>
              <div id="issueStatusSelect" class="customSelect neonSelect selectLike" role="combobox" aria-haspopup="listbox" aria-expanded="false" tabindex="0">
                <button class="selectButton" aria-label="Status"><span class="selectedLabel">Open</span></button>
                <ul class="selectList" role="listbox" tabindex="-1">
                  <li role="option" data-value="open">Open</li>
                  <li role="option" data-value="in_progress">In Progress</li>
                  <li role="option" data-value="resolved">Resolved</li>
                  <li role="option" data-value="closed">Closed</li>
                </ul>
              </div>
            </label>
            <label style="width:120px">Priority:<br>
              <div id="issuePrioritySelect" class="customSelect neonSelect small selectLike" role="combobox" aria-haspopup="listbox" aria-expanded="false" tabindex="0">
                <button class="selectButton" aria-label="Priority"><span class="selectedLabel">Medium</span></button>
                <ul class="selectList" role="listbox" tabindex="-1">
                  <li role="option" data-value="low">Low</li>
                  <li role="option" data-value="medium">Medium</li>
                  <li role="option" data-value="high">High</li>
                </ul>
              </div>
            </label>
          </div>
          <label style="display:block;margin-top:8px;">Assignee:<br>
            <input id="issueAssignee" type="text" style="width:100%;font-size:14px;" value="${pin.assignee||''}" />
          </label>
        </div>
        <div style="width:220px;border-left:1px solid rgba(255,255,255,.04);padding-left:12px;font-size:13px;">
          <div><strong>ID:</strong> <span id="issueId">${pin.id||''}</span></div>
          <div><strong>Page:</strong> <span id="issuePage">${pin.page||''}</span></div>

          <div><strong>Created by:</strong> <span id="issueCreatedBy">${pin.created_by||pin.author||''}</span></div>
          <div style="margin-top:6px;"><strong>Created:</strong><div id="issueCreated" style="font-weight:700;margin-top:2px;">&nbsp;</div></div>

          <div id="issuePreview" style="margin-top:8px;">
            <div style="font-size:13px;margin-bottom:6px;"><strong>Preview</strong></div>
            <div id="issuePreviewWrap" style="width:220px;border:1px solid rgba(255,255,255,.06);position:relative;overflow:hidden;background:#111;">
              <canvas id="issuePreviewCanvas" style="display:block;width:100%;height:auto;"></canvas>
              <div id="issuePreviewOverlay" style="position:absolute;left:0;top:0;right:0;bottom:0;"></div>
            </div>
            <div style="font-size:12px;color:var(--muted);margin-top:6px;">Coords: <span id="issueCoords">x:0.00 y:0.00</span></div>
          </div>
        </div>
      </div>
      <div style="margin-bottom:12px;">
        <label>Notes:<br>
          <textarea id="issueNotes" style="width:100%;height:80px;font-size:15px;">${pin.notes||''}</textarea>
        </label>
      </div>
      <div id="photoThumbs" style="margin-bottom:12px;display:flex;flex-wrap:wrap;"></div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
        <label style="flex:1">Select Photo:<br>
          <input id="issuePhotoInput" type="file" accept="image/*" style="width:100%;" />
        </label>
        <button id="issueTakePhotoBtn" class="btn" style="flex:0 0 auto;min-width:120px;">Take Photo</button>
      </div>
      <div id="photoPreview" style="display:none;margin-bottom:12px;align-items:center;gap:8px;">
        <img id="photoPreviewImg" style="max-width:160px;max-height:160px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.6);" />
        <div style="flex:1;">
          <div id="photoPreviewInfo" style="color:var(--muted);font-size:13px;margin-bottom:8px;"></div>
          <div style="display:flex;gap:8px;">
            <button id="issueUploadConfirmBtn" class="btnPrimary">Upload Photo</button>
            <button id="issueUploadCancelBtn" class="btn">Cancel</button>
          </div>
        </div>
      </div>
      <div style="text-align:right;">
        <button id="issueSaveBtn" class="btnPrimary" style="min-width:120px;padding:10px 18px;">Save</button>
        <button id="issueCancelBtn" class="btn" style="min-width:110px;padding:10px 14px;">Cancel</button>
      </div>
    `;
    document.body.appendChild(modal);
  }
  modal.style.display='block'; modal.querySelector('#issueTitle').value = pin.title||''; modal.querySelector('#issueNotes').value = pin.notes||'';

  async function loadPhotoThumbs(){
    const planId = getPlanIdFromUrl(); if(!planId || !pin.id) return;
    try{
      const res = await fetch(`/api/list_photos.php?plan_id=${planId}`);
      const txt = await res.text(); let data; try{ data = JSON.parse(txt);}catch{return;} if(!data.ok || !Array.isArray(data.photos)) return;
      const thumbs = data.photos.filter(p=>p.issue_id==pin.id);
      const thumbsDiv = modal.querySelector('#photoThumbs');
      thumbsDiv.innerHTML='';
      for(const t of thumbs){
        const img = document.createElement('img');
        const src = t.thumb_url ? t.thumb_url : t.url;
        img.src = src; img.alt='Photo'; img.style.maxWidth='64px'; img.style.maxHeight='64px'; img.style.margin='2px'; img.style.cursor='zoom-in';
        img.onclick = ()=>{
          let lb = document.getElementById('imageLightbox');
          if(!lb){ lb = document.createElement('div'); lb.id = 'imageLightbox'; lb.style.position='fixed'; lb.style.left=0; lb.style.top=0; lb.style.width='100%'; lb.style.height='100%'; lb.style.background='rgba(0,0,0,0.85)'; lb.style.display='flex'; lb.style.alignItems='center'; lb.style.justifyContent='center'; lb.style.zIndex=200000; lb.onclick = ()=>{ lb.style.display='none'; };
            const imgEl = document.createElement('img'); imgEl.style.maxWidth='95%'; imgEl.style.maxHeight='95%'; imgEl.id='imageLightboxImg'; lb.appendChild(imgEl); document.body.appendChild(lb);
          }
          const imgEl = document.getElementById('imageLightboxImg'); imgEl.src = t.url || src; document.getElementById('imageLightbox').style.display='flex';
        };
        thumbsDiv.appendChild(img);
      }
    }catch(e){}
  }
  await loadPhotoThumbs();

  // populate status/prio/assignee and created fields from fetched details if available
  (async ()=>{
    let details = pin;
    if(pin.id && !(pin.created_at || pin.created_by || pin.status)){
      const fetched = await fetchIssueDetails(pin.id); if(fetched) details = Object.assign({}, pin, fetched);
    }
    const statusSelect = modal.querySelector('#issueStatusSelect'); const prioSelect = modal.querySelector('#issuePrioritySelect'); const assigneeInput = modal.querySelector('#issueAssignee');
    function initCustomSelect(wrapper){ if(!wrapper) return; const btn = wrapper.querySelector('.selectButton'); const ul = wrapper.querySelector('.selectList'); const pre = ul.querySelector('li[aria-selected="true"]') || ul.querySelector('li[data-value]'); if(pre) wrapper.querySelector('.selectedLabel').textContent = pre.textContent; wrapper.value = (pre && pre.dataset.value) || ''; const setSelected = (v)=>{ const sel = Array.from(ul.children).find(li=>li.dataset.value==v); if(sel){ wrapper.querySelector('.selectedLabel').textContent = sel.textContent; wrapper.value = v; ul.querySelectorAll('li').forEach(li=> li.setAttribute('aria-selected', li.dataset.value==v ? 'true' : 'false')); wrapper.dispatchEvent(new Event('change')); }}; ul.querySelectorAll('li').forEach(li=>{ li.tabIndex=0; li.onclick = (ev)=>{ ev.stopPropagation(); setSelected(li.dataset.value); ul.classList.remove('open'); wrapper.setAttribute('aria-expanded','false'); }; li.onkeydown = (ev)=>{ if(ev.key==='Enter' || ev.key===' '){ ev.preventDefault(); li.click(); } }; }); btn.onclick = (e)=>{ e.stopPropagation(); const open = ul.classList.toggle('open'); wrapper.setAttribute('aria-expanded', open? 'true':'false'); if(open) ul.focus(); }; document.addEventListener('click', (ev)=>{ if(!wrapper.contains(ev.target)) { ul.classList.remove('open'); wrapper.setAttribute('aria-expanded','false'); } }); wrapper.setValue = setSelected; }
    if(statusSelect) initCustomSelect(statusSelect);
    if(prioSelect) initCustomSelect(prioSelect);
    if(statusSelect) statusSelect.setValue(details.status || 'open'); if(prioSelect) prioSelect.setValue(details.priority || 'medium'); if(assigneeInput) assigneeInput.value = details.assignee || '';
    const createdByEl = modal.querySelector('#issueCreatedBy'); if(createdByEl) createdByEl.textContent = details.created_by||details.author||'';
    const createdVal = details.created_at || details.created || details.createdAt || details.ts;
    const createdEl = modal.querySelector('#issueCreated'); if(createdEl){ if(createdVal){ if (typeof createdVal === 'string' && createdVal.indexOf('/') !== -1) { createdEl.textContent = createdVal; } else { const d = new Date(createdVal); const pad=(n)=>n.toString().padStart(2,'0'); createdEl.textContent = `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; } createdEl.style.display='block'; } else createdEl.style.display='none'; }

    // Setup PinDraggable preview if Add Issue Mode is active and feature enabled
    (async ()=>{
      try{
        if(!addIssueMode) return; // only enable during add-issue workflow
        if(window.FEATURE_PIN_DRAG === false) return; // respect opt-out flag if provided
        // attempt to load PinDraggable lib if not present
        if(!window.PinDraggable){ await new Promise((resolve,reject)=>{
          const s = document.createElement('script'); s.src = '/app/pin-draggable.js'; s.onload = resolve; s.onerror = ()=>{ console.warn('Failed to load pin-draggable.js'); resolve(); }; document.head.appendChild(s);
        }); }
        if(!window.PinDraggable) return; // library missing
        const previewWrap = modal.querySelector('#issuePreviewWrap'); const previewCanvas = modal.querySelector('#issuePreviewCanvas'); const previewOverlay = modal.querySelector('#issuePreviewOverlay'); if(!previewWrap || !previewCanvas) return;
        // render a scaled snapshot of the current viewer canvas into previewCanvas
        const mainCanvas = document.getElementById('pdfCanvas'); if(!mainCanvas) return;
        const previewWidth = Math.min(220, mainCanvas.clientWidth);
        const scale = previewWidth / mainCanvas.clientWidth;
        previewCanvas.width = Math.floor(mainCanvas.width * scale);
        previewCanvas.height = Math.floor(mainCanvas.height * scale);
        previewCanvas.getContext('2d').drawImage(mainCanvas, 0, 0, previewCanvas.width, previewCanvas.height);
        previewWrap.style.width = previewWidth + 'px'; previewWrap.style.height = Math.round(mainCanvas.clientHeight * scale) + 'px';

        // instantiate PinDraggable on the preview
        let pd = null;
        try{
          const PD = window.PinDraggable && window.PinDraggable.PinDraggable ? window.PinDraggable.PinDraggable : window.PinDraggable;
          pd = new PD({
            container: previewWrap,
            img: previewCanvas,
            initial: { x_norm: (pin.x_norm !== undefined ? pin.x_norm : 0.5), y_norm: (pin.y_norm !== undefined ? pin.y_norm : 0.5) },
            onChange: (coords)=>{ pin.x_norm = coords.x_norm; pin.y_norm = coords.y_norm; const el = modal.querySelector('#issueCoords'); if(el) el.textContent = `x:${coords.x_norm.toFixed(2)} y:${coords.y_norm.toFixed(2)}`; },
            onSave: (coords)=>{ pin.x_norm = coords.x_norm; pin.y_norm = coords.y_norm; const el = modal.querySelector('#issueCoords'); if(el) el.textContent = `x:${coords.x_norm.toFixed(2)} y:${coords.y_norm.toFixed(2)}`; }
          });
          // set initial coords display
          const elc = modal.querySelector('#issueCoords'); if(elc) elc.textContent = `x:${(pin.x_norm||0.5).toFixed(2)} y:${(pin.y_norm||0.5).toFixed(2)}`;
        }catch(e){ console.warn('PinDraggable init failed', e); }

        // cleanup when modal is closed or cancelled
        const cleanup = ()=>{ try{ if(pd && typeof pd.destroy === 'function') pd.destroy(); }catch(e){} };
        const cancelBtn = modal.querySelector('#issueCancelBtn'); if(cancelBtn){ const prev = cancelBtn.onclick; cancelBtn.onclick = ()=>{ cleanup(); if(typeof prev === 'function') prev(); }; }
        // also cleanup on save hide
        const saveBtn = modal.querySelector('#issueSaveBtn'); if(saveBtn){ const prevS = saveBtn.onclick; saveBtn.onclick = async ()=>{ if(typeof pd !== 'undefined' && pd && typeof pd.destroy === 'function') pd.destroy(); if(typeof prevS === 'function') await prevS(); } }
      }catch(e){ console.warn('Setting up pin draggable preview failed', e); }
    })();

  })();

  // helper used by both file inputs -- will resize/compress client-side then upload
  async function uploadProcessedFile(blobOrFile){
    const planId = getPlanIdFromUrl(); const issueId = pin.id;
    if(!planId || !issueId){ localShowToast('Save the issue first before uploading photos.'); return; }
    const fd = new FormData(); fd.append('file', blobOrFile, (blobOrFile.name||'photo.jpg'));
    fd.append('plan_id', planId); fd.append('issue_id', issueId);
    try{
      const res = await fetch('/api/upload_photo.php',{method:'POST',body:fd,credentials:'same-origin'});
      const txt = await res.text(); let data; try{ data = JSON.parse(txt); }catch{ throw new Error('Invalid photo upload response'); }
      if(!res.ok || !data.ok) throw new Error(data.error||'Photo upload failed');
      await loadPhotoThumbs();
      try{ document.dispatchEvent(new CustomEvent('photosUpdated', { detail: { issueId } })); }catch(e){}
      localShowToast('Photo uploaded');
    }catch(err){ localShowToast('Photo upload error: '+err.message); }
  }

  function handleSelectedFile(file){ if(!file) return; const previewWrap = modal.querySelector('#photoPreview'); const imgEl = modal.querySelector('#photoPreviewImg'); const infoEl = modal.querySelector('#photoPreviewInfo'); previewWrap.style.display='flex'; const url = URL.createObjectURL(file); imgEl.src = url; infoEl.textContent = `${Math.round(file.size/1024)} KB — ${file.type}`;
    const confirmBtn = modal.querySelector('#issueUploadConfirmBtn'); const cancelBtn = modal.querySelector('#issueUploadCancelBtn'); confirmBtn.disabled = false; confirmBtn.onclick = async ()=>{ confirmBtn.disabled = true; try{ const blob = await resizeImageFile(file); const out = new File([blob], (file.name||'photo.jpg'), {type: blob.type}); await uploadProcessedFile(out); previewWrap.style.display='none'; URL.revokeObjectURL(url); }catch(err){ alert('Image processing failed: '+err.message); confirmBtn.disabled=false; } };
    cancelBtn.onclick = ()=>{ previewWrap.style.display='none'; imgEl.src=''; infoEl.textContent=''; URL.revokeObjectURL(url); };
  }

  modal.querySelector('#issuePhotoInput').onchange = (e)=>{ const f = e.target.files && e.target.files[0]; if(f) handleSelectedFile(f); };
  let camInput = modal.querySelector('#issueCameraInput');
  if(!camInput){ camInput = document.createElement('input'); camInput.type='file'; camInput.accept='image/*'; camInput.capture='environment'; camInput.id='issueCameraInput'; camInput.style.display='none'; camInput.onchange = (e)=>{ const f = e.target.files && e.target.files[0]; if(f) handleSelectedFile(f); }; modal.appendChild(camInput); }
  const camBtn = modal.querySelector('#issueTakePhotoBtn'); if(camBtn){ camBtn.onclick = ()=>{ camInput.click(); }; }

  modal.querySelector('#issueSaveBtn').onclick = async ()=>{ const planId = getPlanIdFromUrl(); const title = modal.querySelector('#issueTitle').value.trim(); const notes = modal.querySelector('#issueNotes').value.trim(); const status = modal.querySelector('#issueStatusSelect') ? modal.querySelector('#issueStatusSelect').value : (pin.status||'open'); const priority = modal.querySelector('#issuePrioritySelect') ? modal.querySelector('#issuePrioritySelect').value : (pin.priority||null); const assignee = modal.querySelector('#issueAssignee') ? modal.querySelector('#issueAssignee').value.trim() : (pin.assignee||null); if(!title){ alert('Title is required'); return; } const issue = { plan_id: planId, page: pin.page, x_norm: pin.x_norm, y_norm: pin.y_norm, title, notes, status, priority, assignee }; if(pin.id) issue.id = pin.id; try{ const saved = await apiSaveIssue(issue); modal.style.display='none'; await reloadDbPins(); await renderPage(currentPage); if(!pin.id && saved.id){ pin.id = saved.id; await showIssueModal(pin); } }catch(e){ alert('Error saving issue: '+e.message); } };
  modal.querySelector('#issueSaveBtn').onclick = async ()=>{ const planId = getPlanIdFromUrl(); const title = modal.querySelector('#issueTitle').value.trim(); const notes = modal.querySelector('#issueNotes').value.trim(); const status = modal.querySelector('#issueStatusSelect') ? modal.querySelector('#issueStatusSelect').value : (pin.status||'open'); const priority = modal.querySelector('#issuePrioritySelect') ? modal.querySelector('#issuePrioritySelect').value : (pin.priority||null); const assignee = modal.querySelector('#issueAssignee') ? modal.querySelector('#issueAssignee').value.trim() : (pin.assignee||null); if(!title){ localShowToast('Title is required'); return; } const issue = { plan_id: planId, page: pin.page, x_norm: pin.x_norm, y_norm: pin.y_norm, title, notes, status, priority, assignee }; if(pin.id) issue.id = pin.id; try{ const saved = await apiSaveIssue(issue); modal.style.display='none'; await reloadDbPins(); await renderPage(currentPage); if(!pin.id && saved.id){ pin.id = saved.id; await showIssueModal(pin); } localShowToast('Saved'); }catch(e){ localShowToast('Error saving issue: '+e.message); } };


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
      label: issue.label || issue.id,
      created_at: issue.created_at || issue.created || issue.createdAt || issue.ts,
      created_by: issue.created_by || issue.author || issue.user || null,
      status: issue.status || 'open',
      priority: issue.priority || null,
      assignee: issue.assignee || null
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
