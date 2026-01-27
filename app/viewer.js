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
// local toast fallback if global not available
function localShowToast(msg, timeout=2200){ try{ if(window && typeof window.showToast === 'function'){ window.showToast(msg, timeout); return; } }catch(e){} const el = document.createElement('div'); el.textContent = msg; el.style.position='fixed'; el.style.right='20px'; el.style.bottom='20px'; el.style.zIndex=999999; el.style.background='rgba(0,0,0,0.8)'; el.style.color='#fff'; el.style.padding='10px 14px'; el.style.borderRadius='8px'; el.style.boxShadow='0 6px 18px rgba(0,0,0,.4)'; document.body.appendChild(el); setTimeout(()=>{ try{ el.remove(); }catch(e){} }, timeout); }
function stageWidth(){ const stage = qs('#pdfStage'); if(!stage) return window.innerWidth; return Math.max(320, stage.clientWidth - 16); }

function ensureWrapAndOverlay(){
  const container = qs('#pdfContainer'); if(!container) throw new Error('Missing #pdfContainer');
  let wrap = container.querySelector('.pdfWrap'); if(!wrap){ wrap = document.createElement('div'); wrap.className = 'pdfWrap'; container.innerHTML = ''; container.appendChild(wrap); }
  let canvas = wrap.querySelector('canvas'); if(!canvas){ canvas = document.createElement('canvas'); canvas.id = 'pdfCanvas'; wrap.appendChild(canvas); }
  let overlay = wrap.querySelector('.pdfOverlay'); if(!overlay){ overlay = document.createElement('div'); overlay.className = 'pdfOverlay'; wrap.appendChild(overlay);
    // Long-press (1s) to place an issue pin to avoid accidental taps while navigating
    overlay.addEventListener('pointerdown', (e)=>{
      if(!addIssueMode) return;
      // don't start long-press if the pointer is on an existing pin (user may want to drag it)
      if (e.target && e.target.closest && e.target.closest('.pin')) return;
      // only start hold if pointer is within the canvas area
      const canvasRect = canvas.getBoundingClientRect();
      if(e.clientX < canvasRect.left || e.clientX > canvasRect.right || e.clientY < canvasRect.top || e.clientY > canvasRect.bottom) return;
      // store initial coordinates on the overlay for use when timer fires
      overlay._issueHold = overlay._issueHold || {};
      overlay._issueHold.startX = e.clientX;
      overlay._issueHold.startY = e.clientY;
      // clear any previous timer
      if(overlay._issueHold.timer) { clearTimeout(overlay._issueHold.timer); overlay._issueHold.timer = null; }
      // set timer for 1 second
      overlay._issueHold.timer = setTimeout(()=>{
        // when timer fires, compute normalized coords and open modal
        const overlayRect = overlay.getBoundingClientRect();
        const x = overlay._issueHold.startX - overlayRect.left;
        const y = overlay._issueHold.startY - overlayRect.top;
        const w = overlayRect.width; const h = overlayRect.height; if(w<=0||h<=0) return;
        const x_norm = Math.max(0, Math.min(1, x/w));
        const y_norm = Math.max(0, Math.min(1, y/h));
        const label = String(tempPins.filter(p=>p.page===currentPage).length + 1);
        showIssueModal({page: currentPage, x_norm, y_norm, label});
        overlay._issueHold.timer = null;
      }, 1000);
    }, {capture:true});
    // Cancel the hold if the pointer is released/moved/cancelled before 1s
    const cancelHold = (ev)=>{
      if(overlay._issueHold && overlay._issueHold.timer){ clearTimeout(overlay._issueHold.timer); overlay._issueHold.timer = null; }
    };
    overlay.addEventListener('pointerup', cancelHold, {capture:true});
    overlay.addEventListener('pointercancel', cancelHold, {capture:true});
    overlay.addEventListener('pointerleave', cancelHold, {capture:true});
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
    // Convert to JPEG to reduce size (preserve as JPEG). If original is PNG and transparency matters, caller can pass through original file.
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
    if(_pinSvgText){
      try{
        const parser = new DOMParser();
        const doc = parser.parseFromString(_pinSvgText, 'image/svg+xml');
        const svgEl = doc.querySelector('svg');
        if(svgEl){
          const node = document.importNode(svgEl, true);
          const txt = node.querySelector('.pin-number');
          if(txt){ txt.textContent = labelText; txt.setAttribute('font-size', String(fontSize)); }
          el.appendChild(node);
        } else {
          // fallback: inline simple svg
          el.innerHTML = `<svg viewBox="0 0 64 80" width="56" height="72"><circle cx="32" cy="20" r="16" fill="#e12b2b"/><path d="M32 36 C24 48, 16 60, 32 76 C48 60, 40 48, 32 36 Z" fill="#e12b2b"/><text x="32" y="20" text-anchor="middle" dominant-baseline="central" fill="#000" font-weight="900" font-size="${fontSize}">${labelText}</text></svg>`;
        }
      }catch(e){ console.warn('pin SVG parse failed', e); el.innerHTML = `<svg viewBox="0 0 64 80" width="56" height="72"><circle cx="32" cy="20" r="16" fill="#e12b2b"/><path d="M32 36 C24 48, 16 60, 32 76 C48 60, 40 48, 32 36 Z" fill="#e12b2b"/><text x="32" y="20" text-anchor="middle" dominant-baseline="central" fill="#000" font-weight="900" font-size="${fontSize}">${labelText}</text></svg>`; }
    } else {
      el.innerHTML = `<svg viewBox="0 0 64 80" width="56" height="72"><circle cx="32" cy="20" r="16" fill="#e12b2b"/><path d="M32 36 C24 48, 16 60, 32 76 C48 60, 40 48, 32 36 Z" fill="#e12b2b"/><text x="32" y="20" text-anchor="middle" dominant-baseline="central" fill="#000" font-weight="900" font-size="${fontSize}">${labelText}</text></svg>`;
    }
    // append pin element to overlay
    overlay.appendChild(el);
    // make pin draggable when Add Issue mode is active
    if (addIssueMode) {
      (function makeDraggable(elPin, pinObj){
        elPin.style.touchAction = 'none';
        elPin.style.cursor = 'grab';
        let dragging = false, moved = false;
        async function savePin(){ if(!pinObj || !pinObj.id) return; try{ const issue = { id: pinObj.id, plan_id: getPlanIdFromUrl(), page: pinObj.page, x_norm: pinObj.x_norm, y_norm: pinObj.y_norm }; await apiSaveIssue(issue); localShowToast('Pin saved'); await reloadDbPins(); await renderPage(currentPage); }catch(e){ localShowToast('Pin save failed'); console.warn('Pin save failed', e); } }
        function onPointerDown(ev){ ev.preventDefault(); ev.stopPropagation(); try{ elPin.setPointerCapture(ev.pointerId); }catch(e){} dragging = true; moved = false; elPin.style.cursor = 'grabbing'; window.addEventListener('pointermove', onPointerMove); window.addEventListener('pointerup', onPointerUp); if(overlay._issueHold && overlay._issueHold.timer){ clearTimeout(overlay._issueHold.timer); overlay._issueHold.timer = null; } }
        function onPointerMove(ev){ if(!dragging) return; moved = true; const rect = overlay.getBoundingClientRect(); const x = ev.clientX - rect.left; const y = ev.clientY - rect.top; const nx = Math.max(0, Math.min(1, x/viewportWidth)); const ny = Math.max(0, Math.min(1, y/viewportHeight)); pinObj.x_norm = nx; pinObj.y_norm = ny; elPin.style.left = `${nx * viewportWidth}px`; elPin.style.top = `${ny * viewportHeight}px`; }
        function onPointerUp(ev){ try{ elPin.releasePointerCapture(ev.pointerId); }catch(e){} dragging = false; elPin.style.cursor = 'grab'; window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', onPointerUp); setTimeout(()=>{ moved = false; }, 0); // persist change for saved issues
          if (pinObj && pinObj.id) { savePin(); }
        }
        elPin.addEventListener('pointerdown', onPointerDown);
        // ensure click opens modal only when not dragged
        elPin.addEventListener('click', (ev)=>{ if(moved) { ev.stopPropagation(); return; } showIssueModal(pinObj); });
      })(el, p);
    } else {
      el.addEventListener('click', ()=> showIssueModal(p));
    }
  }
  for(const p of tempPins.filter(p=>p.page===currentPage)){
    const el = document.createElement('div');
    el.className = 'pin temp-pin';
    el.style.left = `${p.x_norm * viewportWidth}px`;
    el.style.top = `${p.y_norm * viewportHeight}px`;
    const labelText = String(p.label);
    const fontSize = labelText.length <= 2 ? 12 : (labelText.length === 3 ? 10 : 9);
    if(_pinSvgText){
      try{
        const parser = new DOMParser();
        const doc = parser.parseFromString(_pinSvgText, 'image/svg+xml');
        const svgEl = doc.querySelector('svg');
        if(svgEl){
          const node = document.importNode(svgEl, true);
          const txt = node.querySelector('.pin-number');
          if(txt){ txt.textContent = labelText; txt.setAttribute('font-size', String(fontSize)); }
          el.appendChild(node);
        } else {
          el.innerHTML = `<svg viewBox="0 0 64 80" width="56" height="72"><circle cx="32" cy="20" r="16" fill="#e12b2b"/><path d="M32 36 C24 48, 16 60, 32 76 C48 60, 40 48, 32 36 Z" fill="#e12b2b"/><text x="32" y="20" text-anchor="middle" dominant-baseline="central" fill="#000" font-weight="900" font-size="${fontSize}">${labelText}</text></svg>`;
        }
      }catch(e){ console.warn('pin SVG parse failed', e); el.innerHTML = `<svg viewBox="0 0 64 80" width="56" height="72"><circle cx="32" cy="20" r="16" fill="#e12b2b"/><path d="M32 36 C24 48, 16 60, 32 76 C48 60, 40 48, 32 36 Z" fill="#e12b2b"/><text x="32" y="20" text-anchor="middle" dominant-baseline="central" fill="#000" font-weight="900" font-size="${fontSize}">${labelText}</text></svg>`; }
    } else {
      el.innerHTML = `<svg viewBox="0 0 64 80" width="56" height="72"><circle cx="32" cy="20" r="16" fill="#e12b2b"/><path d="M32 36 C24 48, 16 60, 32 76 C48 60, 40 48, 32 36 Z" fill="#e12b2b"/><text x="32" y="20" text-anchor="middle" dominant-baseline="central" fill="#000" font-weight="900" font-size="${fontSize}">${labelText}</text></svg>`;
    }
    // append pin element to overlay
    overlay.appendChild(el);
    // make temp pin draggable when Add Issue mode is active
    if (addIssueMode) {
      (function makeDraggableTemp(elPin, pinObj){
        elPin.style.touchAction = 'none';
        elPin.style.cursor = 'grab';
        let dragging = false, moved = false;
        function onPointerDown(ev){ ev.preventDefault(); ev.stopPropagation(); try{ elPin.setPointerCapture(ev.pointerId); }catch(e){} dragging = true; moved = false; elPin.style.cursor = 'grabbing'; window.addEventListener('pointermove', onPointerMove); window.addEventListener('pointerup', onPointerUp); if(overlay._issueHold && overlay._issueHold.timer){ clearTimeout(overlay._issueHold.timer); overlay._issueHold.timer = null; } }
        function onPointerMove(ev){ if(!dragging) return; moved = true; const rect = overlay.getBoundingClientRect(); const x = ev.clientX - rect.left; const y = ev.clientY - rect.top; const nx = Math.max(0, Math.min(1, x/viewportWidth)); const ny = Math.max(0, Math.min(1, y/viewportHeight)); pinObj.x_norm = nx; pinObj.y_norm = ny; elPin.style.left = `${nx * viewportWidth}px`; elPin.style.top = `${ny * viewportHeight}px`; }
        function onPointerUp(ev){ try{ elPin.releasePointerCapture(ev.pointerId); }catch(e){} dragging = false; elPin.style.cursor = 'grab'; window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', onPointerUp); setTimeout(()=>{ moved = false; }, 0); }
        elPin.addEventListener('pointerdown', onPointerDown);
        elPin.addEventListener('click', (ev)=>{ if(moved) { ev.stopPropagation(); return; } showIssueModal(pinObj); });
      })(el, p);
    } else {
      el.addEventListener('click', ()=> showIssueModal(p));
    }
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
    modal.style.position='fixed'; modal.style.left='50%'; modal.style.top='50%'; modal.style.transform='translate(-50%,-50%)'; modal.style.background='#222'; modal.style.color='#fff'; modal.style.zIndex=100000; modal.style.padding='20px'; modal.style.borderRadius='12px'; modal.style.boxShadow='0 0 24px #0ff8'; modal.style.maxWidth='96vw'; modal.style.width='680px'; modal.style.fontSize='16px';
    modal.innerHTML = `
      <div class="issueTop" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px;">
        <div style="flex:1;">
          <label style="font-size:14px;">Title:<br>
            <input id="issueTitle" type="text" style="width:100%;font-size:16px;" value="${pin.title||''}" maxlength="255" />
          </label>
          <div style="display:flex;gap:8px;margin-top:8px;">
            <div style="flex:1;">
              <label style="display:block;margin-bottom:4px;">Status:</label>
              <div id="issueStatusSelect" class="customSelect neonSelect selectLike" role="combobox" aria-haspopup="listbox" aria-expanded="false" tabindex="0">
                <button class="selectButton" aria-label="Status"><span class="selectedLabel">${pin.status === 'in_progress' ? 'In Progress' : pin.status ? pin.status.charAt(0).toUpperCase() + pin.status.slice(1) : 'Open'}</span></button>
                <ul class="selectList" role="listbox" tabindex="-1">
                  <li role="option" data-value="open">Open</li>
                  <li role="option" data-value="in_progress">In Progress</li>
                  <li role="option" data-value="resolved">Resolved</li>
                  <li role="option" data-value="closed">Closed</li>
                </ul>
              </div>
            </div>
            <div style="width:140px;">
              <label style="display:block;margin-bottom:4px;">Priority:</label>
              <div id="issuePrioritySelect" class="customSelect neonSelect selectLike" role="combobox" aria-haspopup="listbox" aria-expanded="false" tabindex="0">
                <button class="selectButton" aria-label="Priority"><span class="selectedLabel">${pin.priority ? pin.priority.charAt(0).toUpperCase() + pin.priority.slice(1) : 'Medium'}</span></button>
                <ul class="selectList" role="listbox" tabindex="-1">
                  <li role="option" data-value="low">Low</li>
                  <li role="option" data-value="medium">Medium</li>
                  <li role="option" data-value="high">High</li>
                </ul>
              </div>
            </div>
          </div>
          <label style="display:block;margin-top:8px;">Assignee:<br>
            <input id="issueAssignee" type="text" style="width:100%;font-size:14px;" value="${pin.assignee||''}" />
          </label>
        </div>
        <div style="width:320px;border-left:1px solid rgba(255,255,255,.04);padding-left:12px;font-size:13px;">
          <div><strong>ID:</strong> <span id="issueId">${pin.id||''}</span></div>
          <div><strong>Page:</strong> <span id="issuePage">${pin.page||''}</span></div>

          <div><strong>Created by:</strong> <span id="issueCreatedBy">${pin.created_by||pin.author||''}</span></div>
          <div style="margin-top:6px;"><strong>Created:</strong><div id="issueCreated" style="font-weight:700;margin-top:2px;">&nbsp;</div></div>
        </div>
      </div>
      <div style="margin-bottom:12px;">
        <label>Notes:<br>
          <textarea id="issueNotes" style="width:100%;height:80px;font-size:15px;">${pin.notes||''}</textarea>
        </label>
      </div>
      <div id="photoThumbs" style="margin-bottom:12px;display:flex;flex-wrap:wrap;"></div>
      <!-- Queue for photos added before saving an issue -->
      <div id="photoQueue" style="margin-bottom:12px;display:flex;flex-wrap:wrap;gap:8px;"></div>
      <div class="photoControls" style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
        <label style="flex:1">Select Photo:<br>
          <input id="issuePhotoInput" type="file" accept="image/*" style="width:100%;" />
        </label>
        <button id="issueTakePhotoBtn" class="btn" style="flex:0 0 auto;min-width:140px;padding:10px 16px;">Take Photo</button>
      </div>
      <div id="photoPreview" style="display:none;margin-bottom:12px;align-items:center;gap:8px;">
        <img id="photoPreviewImg" style="max-width:160px;max-height:160px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.6);" />
        <div style="flex:1;">
          <div id="photoPreviewInfo" style="color:var(--muted);font-size:13px;margin-bottom:8px;"></div>
          <div class="photoActions" style="display:flex;gap:8px;flex-wrap:wrap;">
            <button id="issueUploadConfirmBtn" class="btnPrimary">Add to Queue</button>
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
    modal.style.display = 'block';
    modal.querySelector('#issueTitle').value = pin.title||'';
    modal.querySelector('#issueNotes').value = pin.notes||'';
    // show created time if available
    (function(){
      const createdEl = modal.querySelector('#issueCreated');
      const createdVal = pin.created_at || pin.created || pin.createdAt || pin.ts;
      if(!createdEl) return;
      if(createdVal){
        const d = new Date(createdVal);
        const pad = (n)=>n.toString().padStart(2,'0');
        const uk = `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
        createdEl.textContent = uk;
        createdEl.style.display = 'block';
      } else {
        createdEl.style.display='none';
      }
    })();

    // pending photos (queued before issue is saved)
    let pendingPhotos = [];
    function renderPendingPhotos(){
      const q = modal.querySelector('#photoQueue'); if(!q) return; q.innerHTML='';
      pendingPhotos.forEach((f, idx)=>{
        const wrap = document.createElement('div'); wrap.style.display='flex'; wrap.style.flexDirection='column'; wrap.style.alignItems='center'; wrap.style.gap='6px'; wrap.style.width='96px';
        const thumb = document.createElement('img'); thumb.style.maxWidth='88px'; thumb.style.maxHeight='88px'; thumb.style.borderRadius='6px'; thumb.style.boxShadow='0 4px 12px rgba(0,0,0,0.6)';
        thumb.src = f.previewUrl || URL.createObjectURL(f); // cache previewUrl to avoid leaking
        if(!f.previewUrl) f.previewUrl = thumb.src;
        wrap.appendChild(thumb);
        const btnRow = document.createElement('div'); btnRow.style.display='flex'; btnRow.style.gap='6px';
        const ann = document.createElement('button'); ann.className='btn'; ann.textContent='Annotate'; ann.onclick = ()=>{ openAnnotator(f, async (blob)=>{ try{ const newFile = new File([blob], (f.name||('photo_' + idx + '.jpg')), {type: blob.type}); pendingPhotos[idx] = newFile; // replace
              if(f.previewUrl) URL.revokeObjectURL(f.previewUrl);
              newFile.previewUrl = URL.createObjectURL(newFile);
              renderPendingPhotos(); }catch(e){ console.error('Annotate save failed', e); } }); };
        const rem = document.createElement('button'); rem.className='btn'; rem.textContent='Remove'; rem.onclick = ()=>{ try{ if(f.previewUrl) URL.revokeObjectURL(f.previewUrl); }catch(e){} pendingPhotos.splice(idx,1); renderPendingPhotos(); };
        btnRow.appendChild(ann); btnRow.appendChild(rem);
        wrap.appendChild(btnRow);
        q.appendChild(wrap);
      });
    }

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
        // clicking a thumbnail opens a simple lightbox
        img.onclick = ()=>{
          let lb = document.getElementById('imageLightbox');
          if(!lb){
            lb = document.createElement('div'); lb.id = 'imageLightbox';
            lb.style.position='fixed'; lb.style.left=0; lb.style.top=0; lb.style.width='100%'; lb.style.height='100%';
            lb.style.background='rgba(0,0,0,0.85)'; lb.style.display='flex'; lb.style.alignItems='center'; lb.style.justifyContent='center'; lb.style.zIndex=200000; lb.onclick = ()=>{ lb.style.display='none'; };
            const imgEl = document.createElement('img'); imgEl.style.maxWidth='95%'; imgEl.style.maxHeight='95%'; imgEl.id='imageLightboxImg'; lb.appendChild(imgEl); document.body.appendChild(lb);
          }
          const imgEl = document.getElementById('imageLightboxImg'); imgEl.src = t.url || src; document.getElementById('imageLightbox').style.display='flex';
        };
        thumbsDiv.appendChild(img);
      }
    }catch(e){}
  }

  // Simple annotator: opens a modal with a canvas overlay to draw freehand annotations
  function openAnnotator(fileOrBlob, doneCallback){
    try{
      const reader = new FileReader();
      reader.onload = ()=>{
        const imgSrc = reader.result;
        let ann = document.getElementById('annotatorModal');
        if(!ann){
          ann = document.createElement('div'); ann.id='annotatorModal';
          ann.style.position='fixed'; ann.style.left=0; ann.style.top=0; ann.style.width='100%'; ann.style.height='100%'; ann.style.background='rgba(0,0,0,0.85)'; ann.style.display='flex'; ann.style.flexDirection='column'; ann.style.alignItems='center'; ann.style.justifyContent='center'; ann.style.zIndex=200500;
          const wrap = document.createElement('div'); wrap.style.width='min(90%,1000px)'; wrap.style.maxHeight='90%'; wrap.style.background='linear-gradient(180deg,#011014,#021417)'; wrap.style.padding='12px'; wrap.style.borderRadius='10px'; wrap.style.boxShadow='0 18px 60px rgba(0,0,0,0.6)'; wrap.style.display='flex'; wrap.style.flexDirection='column';
          const canvas = document.createElement('canvas'); canvas.id = 'annotatorCanvas'; canvas.style.maxWidth = '100%'; canvas.style.border = '1px solid rgba(255,255,255,0.04)'; canvas.style.borderRadius='6px'; canvas.style.background = '#111';
          const controls = document.createElement('div'); controls.style.display='flex'; controls.style.gap='8px'; controls.style.marginTop='8px';
          const saveBtn = document.createElement('button'); saveBtn.className='btnPrimary'; saveBtn.textContent='Save Annotation';
          const undoBtn = document.createElement('button'); undoBtn.className='btn'; undoBtn.textContent='Undo';
          const clearBtn = document.createElement('button'); clearBtn.className='btn'; clearBtn.textContent='Clear';
          const closeBtn = document.createElement('button'); closeBtn.className='btn'; closeBtn.textContent='Close';
          controls.appendChild(saveBtn); controls.appendChild(undoBtn); controls.appendChild(clearBtn); controls.appendChild(closeBtn);
          wrap.appendChild(canvas); wrap.appendChild(controls); ann.appendChild(wrap); document.body.appendChild(ann);

          // drawing state
          let ctx = canvas.getContext('2d'); let drawing=false; let strokes=[]; let current=[];
          function redraw(){ ctx.clearRect(0,0,canvas.width,canvas.height); const img = new Image(); img.src = canvas.dataset.bg || ''; img.onload = ()=>{ ctx.drawImage(img,0,0,canvas.width,canvas.height); // then draw strokes
              ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle = 'rgba(255,0,0,0.92)'; ctx.lineWidth = 4; for(const s of strokes){ ctx.beginPath(); ctx.moveTo(s[0].x, s[0].y); for(let i=1;i<s.length;i++) ctx.lineTo(s[i].x, s[i].y); ctx.stroke(); }
            };
          }
          // pointer handlers
          canvas.addEventListener('pointerdown', (ev)=>{ ev.preventDefault(); drawing=true; current=[]; const r = canvas.getBoundingClientRect(); current.push({x:(ev.clientX-r.left)*(canvas.width/r.width), y:(ev.clientY-r.top)*(canvas.height/r.height)}); });
          canvas.addEventListener('pointermove', (ev)=>{ if(!drawing) return; const r = canvas.getBoundingClientRect(); current.push({x:(ev.clientX-r.left)*(canvas.width/r.width), y:(ev.clientY-r.top)*(canvas.height/r.height)}); strokes.push([]); // temporary
              // more efficient: redraw once per move
              ctx.beginPath(); ctx.lineCap='round'; ctx.lineJoin='round'; ctx.strokeStyle = 'rgba(255,0,0,0.92)'; ctx.lineWidth = 4; const s = current; ctx.moveTo(s[0].x, s[0].y); for(let i=1;i<s.length;i++) ctx.lineTo(s[i].x, s[i].y); ctx.stroke(); }
          );
          canvas.addEventListener('pointerup', (ev)=>{ if(!drawing) return; drawing=false; strokes.push(current.slice()); current=[]; });

          undoBtn.onclick = ()=>{ if(strokes.length) strokes.pop(); redraw(); };
          clearBtn.onclick = ()=>{ strokes=[]; redraw(); };
          closeBtn.onclick = ()=>{ ann.style.display='none'; };
          saveBtn.onclick = ()=>{
            // export canvas to blob (it's already a canvas draw — but ensure bg image + strokes merged)
            // draw background image first synchronously
            const sav = document.createElement('canvas'); sav.width = canvas.width; sav.height = canvas.height; const sctx = sav.getContext('2d');
            const bg = new Image(); bg.src = canvas.dataset.bg || '';
            bg.onload = ()=>{ sctx.drawImage(bg,0,0,sav.width,sav.height); sctx.lineCap='round'; sctx.lineJoin='round'; sctx.strokeStyle='rgba(255,0,0,0.92)'; sctx.lineWidth = 4; for(const s of strokes){ sctx.beginPath(); sctx.moveTo(s[0].x, s[0].y); for(let i=1;i<s.length;i++) sctx.lineTo(s[i].x, s[i].y); sctx.stroke(); }
              sav.toBlob((blob)=>{ if(typeof doneCallback === 'function') doneCallback(blob); ann.style.display='none'; }, 'image/jpeg', 0.9);
            };
          };
        }
        // setup image
        const canvas = document.getElementById('annotatorCanvas'); const img = new Image(); img.onload = ()=>{ // size canvas at natural size but limit to viewport
          const maxW = Math.min(window.innerWidth*0.85, 1200); const ratio = Math.min(1, maxW / img.width); canvas.width = Math.round(img.width * ratio); canvas.height = Math.round(img.height * ratio); const ctx = canvas.getContext('2d'); ctx.drawImage(img,0,0,canvas.width, canvas.height); canvas.dataset.bg = canvas.toDataURL('image/png'); // store bg for redraws
        }; img.src = imgSrc;
        document.getElementById('annotatorModal').style.display='flex';
      };
      reader.readAsDataURL(fileOrBlob);
    }catch(e){ console.error('openAnnotator failed', e); }
  }
    // helper used by both file inputs -- will resize/compress client-side then upload
    async function uploadProcessedFile(blobOrFile, targetIssueId){
      const planId = getPlanIdFromUrl(); const issueId = targetIssueId || pin.id;
      if(!planId || !issueId) { throw new Error('Missing plan or issue id — save the issue first'); }
      const fd = new FormData(); fd.append('file', blobOrFile, (blobOrFile.name||'photo.jpg'));
      fd.append('plan_id', planId); fd.append('issue_id', issueId);
      try{
        const res = await fetch('/api/upload_photo.php',{method:'POST',body:fd,credentials:'same-origin'});
        const txt = await res.text(); let data; try{ data = JSON.parse(txt); }catch{ throw new Error('Invalid photo upload response'); }
        if(!res.ok || !data.ok) throw new Error(data.error||'Photo upload failed');
        await loadPhotoThumbs();
        // notify the issues list to refresh thumbnails/counts
        try{ document.dispatchEvent(new CustomEvent('photosUpdated', { detail: { issueId } })); }catch(e){}
        localShowToast('Photo uploaded');
      }catch(err){ localShowToast('Photo upload error: '+err.message); }
    }

    // show preview and wire confirm/cancel
    function handleSelectedFile(file){ if(!file) return; const previewWrap = modal.querySelector('#photoPreview'); const imgEl = modal.querySelector('#photoPreviewImg'); const infoEl = modal.querySelector('#photoPreviewInfo'); previewWrap.style.display='flex'; const url = URL.createObjectURL(file); imgEl.src = url; infoEl.textContent = `${Math.round(file.size/1024)} KB — ${file.type}`;
      // set confirm handler to either queue (if issue unsaved) or upload immediately
      const confirmBtn = modal.querySelector('#issueUploadConfirmBtn'); const cancelBtn = modal.querySelector('#issueUploadCancelBtn'); confirmBtn.disabled = false; confirmBtn.onclick = async ()=>{ confirmBtn.disabled = true; try{
        // process the file (resize) into a blob first
        const blob = await resizeImageFile(file);
        const procFile = new File([blob], (file.name||'photo.jpg'), {type: blob.type});
        if(!pin.id){
          // queue the processed file for upload after issue is saved
          procFile.previewUrl = URL.createObjectURL(procFile);
          pendingPhotos.push(procFile);
          renderPendingPhotos();
          previewWrap.style.display='none'; URL.revokeObjectURL(url);
          localShowToast('Photo added to queue — it will upload after you save the issue');
        } else {
          // upload immediately
          await uploadProcessedFile(procFile);
          previewWrap.style.display='none'; URL.revokeObjectURL(url);
        }
      }catch(err){ localShowToast('Image processing failed: '+err.message); confirmBtn.disabled=false; } };
      cancelBtn.onclick = ()=>{ previewWrap.style.display='none'; imgEl.src=''; infoEl.textContent=''; URL.revokeObjectURL(url); };
    }

    modal.querySelector('#issuePhotoInput').onchange = (e)=>{ const f = e.target.files && e.target.files[0]; if(f) handleSelectedFile(f); };
    // camera input (for mobile): hidden input with capture attribute
    let camInput = modal.querySelector('#issueCameraInput');
    if(!camInput){ camInput = document.createElement('input'); camInput.type='file'; camInput.accept='image/*'; camInput.capture='environment'; camInput.id='issueCameraInput'; camInput.style.display='none'; camInput.onchange = (e)=>{ const f = e.target.files && e.target.files[0]; if(f) handleSelectedFile(f); }; modal.appendChild(camInput); }
    const camBtn = modal.querySelector('#issueTakePhotoBtn');
    if(camBtn){ camBtn.onclick = ()=>{ camInput.click(); }; }
    await loadPhotoThumbs();

    // helper to initialize and set values on customSelect widgets
    function initCustomSelect(wrapper){
      if(!wrapper) return;
      const btn = wrapper.querySelector('.selectButton'); const ul = wrapper.querySelector('.selectList');
      // set initial selected label if any aria-selected exists
      const pre = ul.querySelector('li[aria-selected="true"]') || ul.querySelector('li[data-value]');
      if(pre) wrapper.querySelector('.selectedLabel').textContent = pre.textContent;
      wrapper.value = (pre && pre.dataset.value) || '';
      const setSelected = (v)=>{ const sel = Array.from(ul.children).find(li=>li.dataset.value==v); if(sel){ wrapper.querySelector('.selectedLabel').textContent = sel.textContent; wrapper.value = v; ul.querySelectorAll('li').forEach(li=> li.setAttribute('aria-selected', li.dataset.value==v ? 'true' : 'false')); wrapper.dispatchEvent(new Event('change')); }};
      ul.querySelectorAll('li').forEach(li=>{ li.tabIndex=0; li.onclick = (ev)=>{ ev.stopPropagation(); setSelected(li.dataset.value); ul.classList.remove('open'); wrapper.setAttribute('aria-expanded','false'); }; li.onkeydown = (ev)=>{ if(ev.key==='Enter' || ev.key===' '){ ev.preventDefault(); li.click(); } }; });
      btn.onclick = (e)=>{ e.stopPropagation(); const open = ul.classList.toggle('open'); wrapper.setAttribute('aria-expanded', open? 'true':'false'); if(open) ul.focus(); };
      document.addEventListener('click', (ev)=>{ if(!wrapper.contains(ev.target)) { ul.classList.remove('open'); wrapper.setAttribute('aria-expanded','false'); } });
      // expose setter
      wrapper.setValue = setSelected;
      wrapper.setAttribute('role','combobox');
    }

    // populate status/prio/assignee from fetched details if available
    (async ()=>{
      let details = pin;
      if(pin.id && !(pin.created_at || pin.created_by || pin.status)){
        const fetched = await fetchIssueDetails(pin.id); if(fetched) details = Object.assign({}, pin, fetched);
      }
      const statusSelect = modal.querySelector('#issueStatusSelect'); const prioSelect = modal.querySelector('#issuePrioritySelect'); const assigneeInput = modal.querySelector('#issueAssignee');
      if(statusSelect) initCustomSelect(statusSelect);
      if(prioSelect) initCustomSelect(prioSelect);
      if(statusSelect) statusSelect.setValue(details.status || 'open'); if(prioSelect) prioSelect.setValue(details.priority || 'medium'); if(assigneeInput) assigneeInput.value = details.assignee || '';
      const createdByEl = modal.querySelector('#issueCreatedBy'); if(createdByEl) createdByEl.textContent = details.created_by||details.author||'';
      const createdVal = details.created_at || details.created || details.createdAt || details.ts;
      const createdEl = modal.querySelector('#issueCreated'); if(createdEl){ if(createdVal){ if (typeof createdVal === 'string' && createdVal.indexOf('/') !== -1) { createdEl.textContent = createdVal; } else { const d = new Date(createdVal); const pad=(n)=>n.toString().padStart(2,'0'); createdEl.textContent = `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; } createdEl.style.display='block'; } else createdEl.style.display='none'; }
    })();

  modal.querySelector('#issueSaveBtn').onclick = async ()=>{
    const planId = getPlanIdFromUrl();
    const title = modal.querySelector('#issueTitle').value.trim();
    const notes = modal.querySelector('#issueNotes').value.trim();
    const status = modal.querySelector('#issueStatusSelect') ? modal.querySelector('#issueStatusSelect').value : (pin.status||'open');
    const priority = modal.querySelector('#issuePrioritySelect') ? modal.querySelector('#issuePrioritySelect').value : (pin.priority||null);
    const assignee = modal.querySelector('#issueAssignee') ? modal.querySelector('#issueAssignee').value.trim() : (pin.assignee||null);
    if(!title){ localShowToast('Title is required'); return; }
    const issue = { plan_id: planId, page: pin.page, x_norm: pin.x_norm, y_norm: pin.y_norm, title, notes, status, priority, assignee };
    if(pin.id) issue.id = pin.id;
    try{
      const saved = await apiSaveIssue(issue);
      // after saving, upload any queued photos that were added before save
      if(pendingPhotos && pendingPhotos.length){
        pin.id = saved.id || pin.id;
        for(const pf of pendingPhotos){
          try{ await uploadProcessedFile(pf, pin.id); }catch(e){ console.error('Queued photo upload failed', e); }
        }
        pendingPhotos = []; renderPendingPhotos();
      }
      modal.style.display='none';
      await reloadDbPins();
      await renderPage(currentPage);
      if(!pin.id && saved.id){ pin.id = saved.id; await showIssueModal(pin); }
    }catch(e){ localShowToast('Error saving issue: '+e.message); }
  };

  // Cancel handler and close modal
  const cancelBtn = modal.querySelector('#issueCancelBtn'); if(cancelBtn) cancelBtn.onclick = ()=>{ modal.style.display='none'; };

  // Refresh viewer when an issue is deleted elsewhere
  const issueDeletedHandler = (ev)=>{ try{ reloadDbPins(); renderPage(currentPage); }catch(e){} };
  document.addEventListener('issueDeleted', issueDeletedHandler);
  // remove listener when modal removed
  const oldRemove = modal.remove || (()=>{});
  modal.remove = function(){ document.removeEventListener('issueDeleted', issueDeletedHandler); oldRemove.call(this); };
}

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
    // Notify other UI code that a plan has been opened
    try { document.dispatchEvent(new CustomEvent('planOpened', { detail: { planId } })); } catch (e) { console.warn('planOpened event failed', e); }
  } catch (e) {
    console.error(e);
    setStatus(e.message || 'Viewer error');
  }
}
window.startViewer = startViewer;
