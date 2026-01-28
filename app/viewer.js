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
      // track current pointer (updated by pointermove to support snapping to crosshair)
      overlay._issueHold.currentX = overlay._issueHold.currentX || e.clientX;
      overlay._issueHold.currentY = overlay._issueHold.currentY || e.clientY;
      // clear any previous timer
      if(overlay._issueHold.timer) { clearTimeout(overlay._issueHold.timer); overlay._issueHold.timer = null; }
      // set timer for 1 second
      overlay._issueHold.timer = setTimeout(()=>{
        // when timer fires, compute normalized coords and open modal
        const overlayRect = overlay.getBoundingClientRect();
        const cx = (overlay._issueHold.currentX !== undefined) ? overlay._issueHold.currentX : overlay._issueHold.startX;
        const cy = (overlay._issueHold.currentY !== undefined) ? overlay._issueHold.currentY : overlay._issueHold.startY;
        const x = cx - overlayRect.left;
        const y = cy - overlayRect.top;
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

// Crosshair / reticle helper
function initCrosshair(){
  const allowFeature = () => { try{ const u = new URL(window.location.href); if (u.searchParams.get('f') === 'crosshair') return true; }catch(e){} return (window.innerWidth || 0) < 700; };
  if (!allowFeature()) return;
  const ch = document.createElement('div'); ch.className = 'crosshair'; ch.innerHTML = '<div class="ring"></div><div class="dot"></div>';
  document.body.appendChild(ch);

  function showAt(clientX, clientY){ ch.style.left = clientX + 'px'; ch.style.top = clientY + 'px'; ch.classList.add('visible'); }
  function hide(){ ch.classList.remove('visible'); }

  document.addEventListener('pointermove', (e)=>{
    // if not in add mode, hide
    if (!addIssueMode){ hide(); return; }
    // ensure overlay exists and pointer over it
    const overlay = document.querySelector('#pdfContainer .pdfOverlay');
    if (!overlay) { hide(); return; }
    const rect = overlay.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom){ hide(); return; }
    // update overlay hold coords if set
    if (overlay._issueHold){ overlay._issueHold.currentX = e.clientX; overlay._issueHold.currentY = e.clientY; }
    showAt(e.clientX, e.clientY);
  }, { passive:true });

  // hide crosshair when leaving add mode
  const obs = new MutationObserver(()=>{ if (!addIssueMode) hide(); });
  obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  window.__crosshair = { showAt, hide, element: ch };
}

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
  const prevBtn = qs('#btnPrev'); const nextBtn = qs('#btnNext'); const goBtn = qs('#btnGo'); const pageInput = qs('#pageInput'); const zoomOut = qs('#btnZoomOut'); const zoomIn = qs('#btnZoomIn'); const fitBtn = qs('#btnFit'); const closeBtn = qs('#btnCloseViewer'); const addBtn = qs('#btnAddIssueMode'); const fab = qs('#fabAddIssue');
  if(prevBtn) prevBtn.onclick = ()=> goToPage(currentPage-1); if(nextBtn) nextBtn.onclick = ()=> goToPage(currentPage+1);
  if(goBtn){ goBtn.onclick = ()=>{ const v = parseInt(pageInput? pageInput.value:'1',10); goToPage(Number.isFinite(v)?v:1); }; }
  if(pageInput){ pageInput.addEventListener('keydown',(e)=>{ if(e.key==='Enter'){ const v = parseInt(pageInput.value||'1',10); goToPage(Number.isFinite(v)?v:1); } }); }
  if(zoomOut) zoomOut.onclick = async ()=>{ userZoom = Math.max(0.25, userZoom-0.25); await renderPage(currentPage); };
  if(zoomIn) zoomIn.onclick = async ()=>{ userZoom = Math.min(5.0, userZoom+0.25); await renderPage(currentPage); };
  if(fitBtn) fitBtn.onclick = async ()=>{ fitMode = true; userZoom = 1.0; await renderPage(currentPage); };

  // Keep add-mode visuals consistent between desktop Add button and mobile FAB
  function setAddModeVisuals(){
    if(addBtn) addBtn.textContent = addIssueMode ? 'Done' : 'Add Issue';
    if(fab) fab.setAttribute('data-active', addIssueMode ? 'true' : 'false');
    setModeBadge();
  }

  if(addBtn){ addBtn.addEventListener('click', async ()=>{ addIssueMode = !addIssueMode; setAddModeVisuals(); if(pdfDoc) await renderPage(currentPage); }); }
  if(fab){ fab.addEventListener('click', async ()=>{ // mobile: toggle add mode (mirror desktop behaviour)
    if (addBtn) {
      // reuse existing handler to avoid duplication
      addBtn.click();
    } else {
      addIssueMode = !addIssueMode; setAddModeVisuals(); if(pdfDoc) await renderPage(currentPage);
    }
  }); }

  if(closeBtn){ closeBtn.onclick = ()=>{ const u = new URL(window.location.href); u.searchParams.delete('plan_id'); history.pushState({},'',u.pathname); setTitle('Select a plan'); setStatus(''); const c = qs('#pdfContainer'); if(c) c.innerHTML = ''; pdfDoc = null; totalPages = 0; currentPage = 1; userZoom = 1.0; addIssueMode = false; setModeBadge(); setBadges(); document.body.classList.remove('has-viewer'); }; }
  window.addEventListener('resize', ()=>{ if(pdfDoc) renderPage(currentPage); });

  // initialize crosshair helper (mobile-gated)
  try{ initCrosshair(); }catch(e){}

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
            <button id="issueClearAnnotBtn" class="btn">Clear Annotations</button>
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

    // --- Annotation canvas: enable touch/pointer drawing on the preview area ---
    function ensureAnnotCanvas(){
      const wrap = modal.querySelector('#issuePreviewWrap'); if(!wrap) return;
      const dpr = window.devicePixelRatio || 1;
      let c = modal.querySelector('#issueAnnotCanvas');
      if(!c){ c = document.createElement('canvas'); c.id = 'issueAnnotCanvas'; c.style.position = 'absolute'; c.style.left = '0'; c.style.top = '0'; c.style.width = '100%'; c.style.height = '100%'; c.style.touchAction = 'none'; c.style.zIndex = 5; wrap.appendChild(c); }
      const ctx2 = c.getContext('2d');
      function resizeAnnot(){ const rect = wrap.getBoundingClientRect(); c.width = Math.floor(rect.width * dpr); c.height = Math.floor(rect.height * dpr); c.style.width = rect.width + 'px'; c.style.height = rect.height + 'px'; ctx2.setTransform(dpr,0,0,dpr,0,0); }
      resizeAnnot();
      modal._annotCanvas = c; modal._annotCtx = ctx2; modal._annotIsDrawing = false;
      modal._clearAnnotations = ()=>{ modal._annotCtx && modal._annotCtx.clearRect(0,0,modal._annotCanvas.width, modal._annotCanvas.height); };
      modal._annotHasContent = ()=>{ if(!modal._annotCtx) return false; const data = modal._annotCtx.getImageData(0,0,modal._annotCanvas.width, modal._annotCanvas.height).data; for(let i=3;i<data.length;i+=4) if(data[i]!==0) return true; return false; };
      c.addEventListener('pointerdown', function(e){ if(e.button!==0) return; e.preventDefault(); modal._annotIsDrawing = true; try{ c.setPointerCapture(e.pointerId); }catch(ignore){} const rect = c.getBoundingClientRect(); const x = (e.clientX - rect.left); const y = (e.clientY - rect.top); modal._annotCtx.beginPath(); modal._annotCtx.lineWidth = 3; modal._annotCtx.lineCap='round'; modal._annotCtx.strokeStyle = '#ff0000'; modal._annotCtx.moveTo(x,y); });
      c.addEventListener('pointermove', function(e){ if(!modal._annotIsDrawing) return; e.preventDefault(); const rect = c.getBoundingClientRect(); const x = (e.clientX - rect.left); const y = (e.clientY - rect.top); modal._annotCtx.lineTo(x,y); modal._annotCtx.stroke(); });
      c.addEventListener('pointerup', function(e){ if(!modal._annotIsDrawing) return; e.preventDefault(); modal._annotIsDrawing=false; try{ c.releasePointerCapture(e.pointerId); }catch(ignore){} });
      c.addEventListener('pointercancel', function(e){ if(!modal._annotIsDrawing) return; modal._annotIsDrawing=false; try{ c.releasePointerCapture(e.pointerId); }catch(ignore){} });
      window.addEventListener('resize', resizeAnnot);
      // wire Clear button
      const clearBtn = modal.querySelector('#issueClearAnnotBtn'); if(clearBtn) clearBtn.onclick = ()=>{ modal._clearAnnotations(); };
    }
    ensureAnnotCanvas();

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
      // header with badge
      let head = modal.querySelector('#photoQueueHeader'); if(!head){ head = document.createElement('div'); head.id='photoQueueHeader'; head.style.display='flex'; head.style.alignItems='center'; head.style.gap='8px'; head.style.marginBottom='8px'; head.innerHTML = '<strong>Queued Photos</strong> <span id="photoQueueBadge" class="photoQueueBadge">0</span>'; q.parentNode.insertBefore(head, q); }
      const badge = head.querySelector('#photoQueueBadge'); badge.textContent = String(pendingPhotos.length);
      pendingPhotos.forEach((f, idx)=>{
        const wrap = document.createElement('div'); wrap.style.display='flex'; wrap.style.flexDirection='column'; wrap.style.alignItems='center'; wrap.style.gap='6px'; wrap.style.width='120px';
        const thumb = document.createElement('img'); thumb.style.maxWidth='96px'; thumb.style.maxHeight='96px'; thumb.style.borderRadius='6px'; thumb.style.boxShadow='0 4px 12px rgba(0,0,0,0.6)';
        thumb.src = f.previewUrl || URL.createObjectURL(f); // cache previewUrl to avoid leaking
        if(!f.previewUrl) f.previewUrl = thumb.src;
        wrap.appendChild(thumb);
        // progress bar
        const progWrap = document.createElement('div'); progWrap.style.width='100%'; progWrap.style.background='rgba(255,255,255,0.03)'; progWrap.style.borderRadius='6px'; progWrap.style.height='8px'; progWrap.style.marginTop='6px';
        const progBar = document.createElement('div'); progBar.style.height='100%'; progBar.style.width = (f.uploadProgress ? Math.round(f.uploadProgress*100) : 0) + '%'; progBar.style.background = 'linear-gradient(90deg, var(--neon2), var(--neon))'; progBar.style.borderRadius='6px'; progBar.style.transition='width .12s ease'; progWrap.appendChild(progBar); wrap.appendChild(progWrap);
        const btnRow = document.createElement('div'); btnRow.style.display='flex'; btnRow.style.gap='6px'; btnRow.style.marginTop='6px';
        const ann = document.createElement('button'); ann.className='btn'; ann.textContent='Annotate'; ann.onclick = ()=>{ openAnnotator(f, async (blob)=>{ try{ const newFile = new File([blob], (f.name||('photo_' + idx + '.jpg')), {type: blob.type}); // preserve preview
              if(f.previewUrl) URL.revokeObjectURL(f.previewUrl); newFile.previewUrl = URL.createObjectURL(newFile); pendingPhotos[idx] = newFile; renderPendingPhotos(); }catch(e){ console.error('Annotate save failed', e); } }); };
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

          // drawing state with tools, colors and undo stack
          let ctx = canvas.getContext('2d'); let drawing=false; let strokes=[]; let current=null; let toolMode='free'; let drawColor='rgba(255,80,80,0.95)'; let drawWidth=4;
          function redraw(){ ctx.clearRect(0,0,canvas.width,canvas.height); const img = new Image(); img.src = canvas.dataset.bg || ''; img.onload = ()=>{ ctx.drawImage(img,0,0,canvas.width,canvas.height); // then draw strokes
              ctx.lineCap='round'; ctx.lineJoin='round';
              for(const s of strokes){
                if(s.type === 'free'){
                  ctx.strokeStyle = s.color; ctx.lineWidth = s.width; ctx.beginPath(); ctx.moveTo(s.points[0].x, s.points[0].y); for(let i=1;i<s.points.length;i++) ctx.lineTo(s.points[i].x, s.points[i].y); ctx.stroke();
                } else if(s.type === 'arrow'){
                  ctx.strokeStyle = s.color; ctx.lineWidth = s.width; ctx.beginPath(); ctx.moveTo(s.sx,s.sy); ctx.lineTo(s.ex,s.ey); ctx.stroke(); // draw head
                  drawArrowHead(ctx, s.sx, s.sy, s.ex, s.ey, s.width, s.color);
                }
              }
            };
          }
          // helper for arrow heads
          function drawArrowHead(ctx, sx, sy, ex, ey, width, color){ const angle = Math.atan2(ey - sy, ex - sx); const len = Math.max(10, width*4); ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - len * Math.cos(angle - Math.PI/8), ey - len * Math.sin(angle - Math.PI/8)); ctx.lineTo(ex - len * Math.cos(angle + Math.PI/8), ey - len * Math.sin(angle + Math.PI/8)); ctx.closePath(); ctx.fill(); }

          // controls: add tool selector, color input and width slider
          const toolSelect = document.createElement('select'); toolSelect.style.marginRight='8px'; const opt1=document.createElement('option'); opt1.value='free'; opt1.textContent='Freehand'; const opt2=document.createElement('option'); opt2.value='arrow'; opt2.textContent='Arrow'; toolSelect.appendChild(opt1); toolSelect.appendChild(opt2); toolSelect.value = toolMode; toolSelect.onchange = ()=>{ toolMode = toolSelect.value; };
          const colorInput = document.createElement('input'); colorInput.type='color'; colorInput.value = '#ff5050'; colorInput.style.marginRight='8px'; colorInput.onchange = ()=>{ const v = colorInput.value; // convert hex to rgba
            drawColor = hexToRgba(v, 0.95); };
          const widthInput = document.createElement('input'); widthInput.type='range'; widthInput.min=1; widthInput.max=24; widthInput.value = drawWidth; widthInput.style.width='120px'; widthInput.oninput = ()=>{ drawWidth = Number(widthInput.value); };
          // insert controls near buttons
          controls.insertBefore(toolSelect, saveBtn);
          controls.insertBefore(colorInput, saveBtn);
          controls.insertBefore(widthInput, saveBtn);

          function hexToRgba(hex, a){ const bigint = parseInt(hex.replace('#',''), 16); const r = (bigint >> 16) & 255; const g = (bigint >> 8) & 255; const b = bigint & 255; return `rgba(${r},${g},${b},${a})`; }

          // pointer handlers
          canvas.addEventListener('pointerdown', (ev)=>{ ev.preventDefault(); drawing=true; const r = canvas.getBoundingClientRect(); const x = (ev.clientX-r.left)*(canvas.width/r.width); const y = (ev.clientY-r.top)*(canvas.height/r.height); if(toolMode==='free'){ current = [{x,y}]; } else { current = {sx:x, sy:y, ex:x, ey:y}; } });
          canvas.addEventListener('pointermove', (ev)=>{ if(!drawing || !current) return; const r = canvas.getBoundingClientRect(); const x = (ev.clientX-r.left)*(canvas.width/r.width); const y = (ev.clientY-r.top)*(canvas.height/r.height); if(toolMode==='free'){ current.push({x,y}); } else { current.ex = x; current.ey = y; } // redraw full canvas then overlay current
            redraw(); // overlay current
            if(toolMode==='free' && current.length>0){ ctx.strokeStyle = drawColor; ctx.lineWidth = drawWidth; ctx.beginPath(); ctx.moveTo(current[0].x, current[0].y); for(let i=1;i<current.length;i++) ctx.lineTo(current[i].x, current[i].y); ctx.stroke(); }
            if(toolMode==='arrow' && current){ ctx.strokeStyle = drawColor; ctx.lineWidth = drawWidth; ctx.beginPath(); ctx.moveTo(current.sx,current.sy); ctx.lineTo(current.ex,current.ey); ctx.stroke(); drawArrowHead(ctx, current.sx, current.sy, current.ex, current.ey, drawWidth, drawColor); }
          });
          canvas.addEventListener('pointerup', (ev)=>{ if(!drawing || !current) return; drawing=false; if(toolMode==='free'){ if(current.length>1) strokes.push({ type: 'free', points: current.slice(), color: drawColor, width: drawWidth }); } else { strokes.push({ type: 'arrow', sx: current.sx, sy: current.sy, ex: current.ex, ey: current.ey, color: drawColor, width: drawWidth }); } current=null; redraw(); });

          undoBtn.onclick = ()=>{ if(strokes.length) strokes.pop(); redraw(); };
          clearBtn.onclick = ()=>{ strokes=[]; redraw(); };
          closeBtn.onclick = ()=>{ ann.style.display='none'; };
          saveBtn.onclick = ()=>{
            // export canvas to blob (merge bg + strokes)
            const sav = document.createElement('canvas'); sav.width = canvas.width; sav.height = canvas.height; const sctx = sav.getContext('2d');
            const bg = new Image(); bg.src = canvas.dataset.bg || '';
            bg.onload = ()=>{ sctx.drawImage(bg,0,0,sav.width,sav.height);
              // draw strokes
              for(const s of strokes){ if(s.type === 'free'){ sctx.strokeStyle = s.color; sctx.lineWidth = s.width; sctx.lineCap='round'; sctx.lineJoin='round'; sctx.beginPath(); sctx.moveTo(s.points[0].x, s.points[0].y); for(let i=1;i<s.points.length;i++) sctx.lineTo(s.points[i].x, s.points[i].y); sctx.stroke(); } else if(s.type === 'arrow'){ sctx.strokeStyle = s.color; sctx.lineWidth = s.width; sctx.beginPath(); sctx.moveTo(s.sx,s.sy); sctx.lineTo(s.ex,s.ey); sctx.stroke(); drawArrowHead(sctx, s.sx, s.sy, s.ex, s.ey, s.width, s.color); } }
              sav.toBlob((blob)=>{ if(typeof doneCallback === 'function') doneCallback(blob); ann.style.display='none'; }, 'image/jpeg', 0.92);
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
    // upload with progress support; will queue when no issueId
    function uploadProcessedFile(blobOrFile, targetIssueId, onProgress){
      return new Promise((resolve, reject)=>{
        const planId = getPlanIdFromUrl(); const issueId = targetIssueId || pin.id;
        if(!planId || !issueId){ // queue for upload after save
          try{
            const f = (blobOrFile instanceof File) ? blobOrFile : new File([blobOrFile], (blobOrFile.name||'photo.jpg'), {type: blobOrFile.type||'image/jpeg'});
            pendingPhotos.push(f);
            renderPendingPhotos();
            localShowToast('Photo queued — it will upload after saving the issue');
            resolve({ queued:true });
            return;
          }catch(e){ reject(new Error('Failed to queue photo: '+e.message)); return; }
        }
        const fd = new FormData(); fd.append('file', blobOrFile, (blobOrFile.name||'photo.jpg'));
        fd.append('plan_id', planId); fd.append('issue_id', issueId);

        // Use XHR so we can report upload progress
        try{
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/api/upload_photo.php', true);
          xhr.withCredentials = true;
          xhr.upload.onprogress = (ev)=>{ if(ev.lengthComputable && typeof onProgress === 'function'){ onProgress(ev.loaded / ev.total); } };
          xhr.onload = async ()=>{
            if(xhr.status >=200 && xhr.status < 300){
              try{
                const data = JSON.parse(xhr.responseText || '{}');
                if(!data.ok) throw new Error(data.error || 'Photo upload failed');
                await loadPhotoThumbs();
                try{ document.dispatchEvent(new CustomEvent('photosUpdated', { detail: { issueId } })); }catch(e){}
                localShowToast('Photo uploaded');
                resolve(data);
              }catch(err){ reject(err); }
            }else{ reject(new Error('HTTP ' + xhr.status)); }
          };
          xhr.onerror = ()=> reject(new Error('Network error'));
          xhr.send(fd);
        }catch(e){ reject(e); }
      });
    }

    // show preview and wire confirm/cancel
    function handleSelectedFile(file){ if(!file) return; const previewWrap = modal.querySelector('#photoPreview'); const imgEl = modal.querySelector('#photoPreviewImg'); const infoEl = modal.querySelector('#photoPreviewInfo'); previewWrap.style.display='flex'; const url = URL.createObjectURL(file); imgEl.src = url; infoEl.textContent = `${Math.round(file.size/1024)} KB — ${file.type}`;
      // set confirm handler to resize then upload
      const confirmBtn = modal.querySelector('#issueUploadConfirmBtn'); const cancelBtn = modal.querySelector('#issueUploadCancelBtn'); confirmBtn.disabled = false; confirmBtn.onclick = async ()=>{ confirmBtn.disabled = true; try{ 
        if(!pin.id){
          const title = modal.querySelector('#issueTitle').value.trim();
          const notes = modal.querySelector('#issueNotes').value.trim();
          const status = modal.querySelector('#issueStatusSelect').value;
          const priority = modal.querySelector('#issuePrioritySelect').value;
          const assignee = modal.querySelector('#issueAssignee').value.trim();
          if(!title){ localShowToast('Title is required to upload photos.'); confirmBtn.disabled=false; return; }
          const issue = { plan_id: planId, page: pin.page, x_norm: pin.x_norm, y_norm: pin.y_norm, title, notes, status, priority, assignee };
          try{
            const saved = await apiSaveIssue(issue);
            pin.id = saved.id;
            await reloadDbPins();
            await renderPage(currentPage);
          }catch(e){
            localShowToast('Error saving issue: '+e.message);
            confirmBtn.disabled=false;
            return;
          }
        }
        // If there are annotations drawn on the preview, merge them onto the image and upload the merged image
        const annotCanvas = modal._annotCanvas;
        if(annotCanvas && modal._annotHasContent && modal._annotHasContent()){
          // create combined canvas at the annot canvas pixel resolution
          const comb = document.createElement('canvas'); comb.width = annotCanvas.width; comb.height = annotCanvas.height; const cctx = comb.getContext('2d');
          await new Promise((res, rej)=>{
            const im = new Image(); im.onload = ()=>{
              cctx.drawImage(im,0,0,comb.width,comb.height); cctx.drawImage(annotCanvas,0,0,comb.width,comb.height);
              comb.toBlob((b)=>{ if(!b) rej(new Error('Merge failed')); else { uploadProcessedFile(b).then(()=>res()).catch(rej); } }, 'image/jpeg', 0.95);
            };
            im.onerror = ()=>{ rej(new Error('Image load failed for merge')); };
            im.src = url;
          });
        } else {
          const blob = await resizeImageFile(file);
          const out = new File([blob], (file.name||'photo.jpg'), {type: blob.type}); await uploadProcessedFile(out);
        }
        previewWrap.style.display='none'; URL.revokeObjectURL(url);
  }catch(err){ localShowToast('Image processing failed: '+err.message); confirmBtn.disabled=false; } };
      // ensure Cancel clears preview and annotations as well
      cancelBtn.onclick = ()=>{ previewWrap.style.display='none'; imgEl.src=''; infoEl.textContent = ''; URL.revokeObjectURL(url); if(modal._clearAnnotations) modal._clearAnnotations(); };
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
        for(const [idx, pf] of pendingPhotos.entries()){
          try{
            // show progress while uploading
            await uploadProcessedFile(pf, pin.id, (p)=>{ try{ pf.uploadProgress = p; renderPendingPhotos(); }catch(e){} });
          }catch(e){ console.error('Queued photo upload failed', e); }
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
  const cancelBtn = modal.querySelector('#issueCancelBtn'); if(cancelBtn) cancelBtn.onclick = ()=>{ modal.style.display='none'; if(modal._clearAnnotations) modal._clearAnnotations(); };

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
