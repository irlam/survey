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
let panX = 0;
let panY = 0;
let pendingHighlightIssueId = null;
let photoCounts = {};

// Helpers
function qs(sel){ return document.querySelector(sel); }
function getPlanIdFromUrl(){ const u = new URL(window.location.href); const v = u.searchParams.get('plan_id'); const n = parseInt(v||'0',10); return Number.isFinite(n) && n>0 ? n : null; }
function getActivePlanId(fallback){
  const id = getPlanIdFromUrl() || window.__currentPlanId || (fallback && fallback.plan_id) || null;
  return id && Number.isFinite(Number(id)) ? Number(id) : null;
}
function setStatus(text){ const el = qs('#viewerMsg'); if(el) el.textContent = text||''; }
function setTitle(text){ const el = qs('#planTitle'); if(el) el.textContent = text||'Plan'; }
function setModeBadge(){ const b = qs('#modeBadge'); if(!b) return; b.style.display = addIssueMode ? 'inline-flex' : 'none'; }
function setBadges(){ const pageBadge = qs('#pageBadge'); if(pageBadge) pageBadge.textContent = totalPages?`Page ${currentPage} / ${totalPages}`:'Page - / -'; const pageInput = qs('#pageInput'); if(pageInput && totalPages) pageInput.value = String(currentPage); const zoomBadge = qs('#zoomBadge'); if(zoomBadge) zoomBadge.textContent = `${Math.round(userZoom*100)}%`; }

// keep UI toggles in sync when add issue mode changes
function updateAddModeVisuals(){
  const addBtn = qs('#btnAddIssueMode');
  const fab = qs('#fabAddIssue');
  if(addBtn) addBtn.textContent = addIssueMode ? 'Done' : 'Add Issue';
  if(fab) fab.setAttribute('data-active', addIssueMode ? 'true' : 'false');
  setModeBadge();
}

function ensurePdfJsConfigured(){ if(!window.pdfjsLib) throw new Error('PDF.js not loaded'); window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js'; }
// local toast fallback if global not available
function localShowToast(msg, timeout=2200){ try{ if(window && typeof window.showToast === 'function'){ window.showToast(msg, timeout); return; } }catch(e){} const el = document.createElement('div'); el.textContent = msg; el.style.position='fixed'; el.style.right='20px'; el.style.bottom='20px'; el.style.zIndex=999999; el.style.background='rgba(0,0,0,0.8)'; el.style.color='#fff'; el.style.padding='10px 14px'; el.style.borderRadius='8px'; el.style.boxShadow='0 6px 18px rgba(0,0,0,.4)'; document.body.appendChild(el); setTimeout(()=>{ try{ el.remove(); }catch(e){} }, timeout); }

// Lightweight analytics helper — sends via sendBeacon when available and keeps an in-memory queue for inspection
window.__analyticsQueue = window.__analyticsQueue || [];
function trackEvent(name, payload = {}){
  try{
    const ev = Object.assign({ event: name, ts: Date.now() }, payload || {});
    window.__analyticsQueue.push(ev);
    if (navigator && typeof navigator.sendBeacon === 'function'){
      try{ const blob = new Blob([JSON.stringify(ev)], {type: 'application/json'}); navigator.sendBeacon('/api/track_event.php', blob); }catch(e){ /* best-effort */ }
    } else if (typeof fetch === 'function'){
      // best-effort non-blocking POST
      try{ fetch('/api/track_event.php', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(ev), keepalive: true }).catch(()=>{}); }catch(e){}
    } else {
      // fallback: console
      console.log('trackEvent:', ev);
    }
  }catch(e){ console.log('trackEvent failed', name, e); }
}

function stageWidth(){ const stage = qs('#pdfStage'); if(!stage) return window.innerWidth; return Math.max(320, stage.clientWidth - 16); }

function stageHeight(){ const stage = qs('#pdfStage'); if(!stage) return window.innerHeight; return Math.max(200, stage.clientHeight - 16); }

function ensureWrapAndOverlay(){
  const container = qs('#pdfContainer'); if(!container) throw new Error('Missing #pdfContainer');
  let wrap = container.querySelector('.pdfWrap'); if(!wrap){ wrap = document.createElement('div'); wrap.className = 'pdfWrap'; container.innerHTML = ''; container.appendChild(wrap); }
  let canvas = wrap.querySelector('canvas'); if(!canvas){ canvas = document.createElement('canvas'); canvas.id = 'pdfCanvas'; wrap.appendChild(canvas); }
  let overlay = wrap.querySelector('.pdfOverlay'); if(!overlay){ overlay = document.createElement('div'); overlay.className = 'pdfOverlay'; wrap.appendChild(overlay);
    overlay.style.touchAction = 'none';
      // Long-press (1s) to place an issue pin (desktop + touch). Small movement cancels to keep navigation smooth.
    overlay.addEventListener('pointerdown', (e)=>{
      if(e.pointerType === 'mouse' && e.button !== 0) return; // ignore right/middle clicks
      if (e.target && e.target.closest && e.target.closest('.pin')) return; // let pin drags/clicks through
      const canvasRect = canvas.getBoundingClientRect();
      if(e.clientX < canvasRect.left || e.clientX > canvasRect.right || e.clientY < canvasRect.top || e.clientY > canvasRect.bottom) return;
      overlay._issueHold = overlay._issueHold || {};
      overlay._issueHold.startX = e.clientX; overlay._issueHold.startY = e.clientY;
      overlay._issueHold.currentX = e.clientX; overlay._issueHold.currentY = e.clientY;
      const movementCancelPx = 12;
      if(overlay._issueHold.timer) { clearTimeout(overlay._issueHold.timer); overlay._issueHold.timer = null; }
      const handleMove = (mv)=>{
        overlay._issueHold.currentX = mv.clientX; overlay._issueHold.currentY = mv.clientY;
        if(Math.abs(mv.clientX - overlay._issueHold.startX) > movementCancelPx || Math.abs(mv.clientY - overlay._issueHold.startY) > movementCancelPx){ cancelHold(); }
      };
      const cancelHold = ()=>{
        if(overlay._issueHold && overlay._issueHold.timer){ clearTimeout(overlay._issueHold.timer); overlay._issueHold.timer = null; }
        overlay.removeEventListener('pointermove', handleMove, true);
      };
      overlay.addEventListener('pointermove', handleMove, true);
      overlay._issueHold.timer = setTimeout(()=>{
        overlay.removeEventListener('pointermove', handleMove, true);
        if(!addIssueMode){ addIssueMode = true; updateAddModeVisuals(); }
        const overlayRect = overlay.getBoundingClientRect();
        let cx = overlay._issueHold.currentX;
        let cy = overlay._issueHold.currentY;
        try{
          const ch = window && window.__crosshair && window.__crosshair.element;
          if (ch && ch.classList && ch.classList.contains('visible')){
            const r = ch.getBoundingClientRect();
            cx = r.left + (r.width/2);
            cy = r.top + (r.height/2);
          }
        }catch(err){ /* ignore */ }
         const x = cx - overlayRect.left;
        const y = cy - overlayRect.top;
        const w = overlayRect.width;
        const h = overlayRect.height;
        const fallbackX = 0.5;
        const fallbackY = 0.5;
        let x_norm, y_norm;
        if(w<=0||h<=0){
          console.warn(`[VIEWER] Overlay has invalid dimensions (w=${w}, h=${h}), using fallback coordinates (${fallbackX}, ${fallbackY})`);
          x_norm = fallbackX;
          y_norm = fallbackY;
        } else {
          x_norm = Math.max(0, Math.min(1, x/w));
          y_norm = Math.max(0, Math.min(1, y/h));
        }
        const label = String(tempPins.filter(p=>p.page===currentPage).length + 1);
        try{ if(navigator && typeof navigator.vibrate === 'function') navigator.vibrate(10); }catch(err){}
        showIssueModal({page: currentPage, x_norm, y_norm, label, plan_id: getActivePlanId()});
        overlay._issueHold.timer = null;
      }, 700);
      const cancelEvents = ['pointerup','pointercancel','pointerleave'];
      cancelEvents.forEach(evt=> overlay.addEventListener(evt, cancelHold, {capture:true, once:true}));
    }, {capture:true});
  }
  overlay.style.pointerEvents = 'auto';
  return {wrap, canvas, overlay};
}

// API wrappers
async function apiGetPlan(planId){ const res = await fetch(`/api/get_plan.php?plan_id=${encodeURIComponent(planId)}`, {credentials:'same-origin'}); const txt = await res.text(); let data; try{ data = JSON.parse(txt); }catch{ throw new Error(`get_plan invalid JSON: ${txt}`); } if(!res.ok || !data.ok) throw new Error(data.error || `get_plan failed: HTTP ${res.status}`); return data; }
async function apiListIssues(planId){ const res = await fetch(`/api/list_issues.php?plan_id=${encodeURIComponent(planId)}`, {credentials:'same-origin'}); const txt = await res.text(); let data; try{ data = JSON.parse(txt); }catch{ throw new Error(`list_issues invalid JSON: ${txt}`); } if(!res.ok || !data.ok) throw new Error(data.error || `list_issues failed: HTTP ${res.status}`); return data.issues || []; }
async function apiSaveIssue(issue){ const res = await fetch('/api/save_issue.php',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(issue)}); const txt = await res.text(); let data; try{ data = JSON.parse(txt); }catch{ throw new Error(`save_issue invalid JSON: ${txt}`); } if(!res.ok || !data.ok) throw new Error(data.error || `save_issue failed: HTTP ${res.status}`); return data; }

// fetch issue details by id via list_issues (safe fallback if no dedicated endpoint)
async function fetchIssueDetails(issueId){ const planId = getActivePlanId(); if(!planId || !issueId) return null; try{ const issues = await apiListIssues(planId); return issues.find(i=>String(i.id)===String(issueId)) || null; }catch(e){ console.warn('fetchIssueDetails failed', e); return null; } }

// resize/compress image file (returns Blob)
function resizeImageFile(file, maxWidth=1600, maxHeight=1600, quality=0.8){ return new Promise((resolve,reject)=>{
  const img = new Image(); const fr = new FileReader(); fr.onload = ()=>{ img.onload = ()=>{
    let w = img.naturalWidth, h = img.naturalHeight; const ratio = Math.min(1, maxWidth/w, maxHeight/h); if(ratio<1){ w = Math.round(w*ratio); h = Math.round(h*ratio); }
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; const ctx = canvas.getContext('2d'); ctx.drawImage(img,0,0,w,h);
    // Convert to JPEG to reduce size (preserve as JPEG). If original is PNG and transparency matters, caller can pass through original file.
    canvas.toBlob((blob)=>{ if(!blob) return reject(new Error('Image resize failed')); resolve(blob); }, 'image/jpeg', quality);
  }; img.onerror = (e)=>reject(new Error('Image load error')); img.src = fr.result; }; fr.onerror = ()=>reject(new Error('File read error')); fr.readAsDataURL(file); }); }

function clearOverlay(overlay){ overlay.innerHTML = ''; }

function applyPanTransform(){
  const wrap = qs('#pdfContainer .pdfWrap');
  if(!wrap) return;
  wrap.style.transform = `translate(${panX}px, ${panY}px)`;
}

function highlightPinById(issueId){
  if(!issueId) return false;
  const overlay = qs('#pdfContainer .pdfOverlay');
  if(!overlay) return false;
  const el = overlay.querySelector(`.pin[data-issue-id="${issueId}"]`);
  if(!el) return false;
  el.classList.remove('pin-highlight');
  // force reflow for restart
  void el.offsetHeight;
  el.classList.add('pin-highlight');
  setTimeout(()=>{ try{ el.classList.remove('pin-highlight'); }catch(e){} }, 1400);
  return true;
}

function showPinTrail(targetX, targetY, overlay){
  if(!overlay) return;
  const rect = overlay.getBoundingClientRect();
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const dx = targetX - cx;
  const dy = targetY - cy;
  const len = Math.max(20, Math.hypot(dx, dy));
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const trail = document.createElement('div');
  trail.className = 'pinTrail';
  trail.style.width = `${len}px`;
  trail.style.left = `${cx}px`;
  trail.style.top = `${cy}px`;
  trail.style.transform = `rotate(${angle}deg)`;
  overlay.appendChild(trail);
  setTimeout(()=>{ try{ trail.remove(); }catch(e){} }, 1000);
}

function ensureLongPressHint(){
  if (!('ontouchstart' in window)) return;
  if (localStorage.getItem('survey_long_press_hint') === '1') return;
  const stage = qs('#pdfStage');
  if(!stage) return;
  let hint = stage.querySelector('.hintBubble');
  if(!hint){
    hint = document.createElement('div');
    hint.className = 'hintBubble';
    hint.textContent = 'Tip: long‑press to drop a pin';
    stage.appendChild(hint);
  }
  hint.classList.add('show');
  setTimeout(()=>{ try{ hint.classList.remove('show'); }catch(e){} }, 2800);
  localStorage.setItem('survey_long_press_hint', '1');
}

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
    el.dataset.issueId = String(p.id || '');
    el.style.left = `${p.x_norm * viewportWidth}px`;
    el.style.top = `${p.y_norm * viewportHeight}px`;
    const count = photoCounts[String(p.id || '')] || 0;
    if (count > 0) {
      const badge = document.createElement('div');
      badge.className = 'pinBadge';
      badge.textContent = String(count);
      el.appendChild(badge);
    }
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
        async function savePin(){ if(!pinObj || !pinObj.id) return; try{ const issue = { id: pinObj.id, plan_id: getActivePlanId(pinObj), page: pinObj.page, x_norm: pinObj.x_norm, y_norm: pinObj.y_norm }; await apiSaveIssue(issue); localShowToast('Pin saved'); await reloadDbPins(); await renderPage(currentPage); try{ document.dispatchEvent(new CustomEvent('issueUpdated', { detail: { issueId: pinObj.id } })); }catch(e){} }catch(e){ localShowToast('Pin save failed'); console.warn('Pin save failed', e); } }
        function onPointerDown(ev){ ev.preventDefault(); ev.stopPropagation(); try{ elPin.setPointerCapture(ev.pointerId); }catch(e){} dragging = true; moved = false; elPin.style.cursor = 'grabbing'; window.addEventListener('pointermove', onPointerMove); window.addEventListener('pointerup', onPointerUp); if(overlay._issueHold && overlay._issueHold.timer){ clearTimeout(overlay._issueHold.timer); overlay._issueHold.timer = null; } // analytics & haptic
          try{ trackEvent('pin_drag_start', { id: pinObj.id || null, page: pinObj.page, x: pinObj.x_norm, y: pinObj.y_norm }); }catch(e){}
          try{ if(navigator && typeof navigator.vibrate === 'function') navigator.vibrate(10); }catch(e){}
        }
        function onPointerMove(ev){ if(!dragging) return; moved = true; const rect = overlay.getBoundingClientRect(); const x = ev.clientX - rect.left; const y = ev.clientY - rect.top; const nx = Math.max(0, Math.min(1, x/viewportWidth)); const ny = Math.max(0, Math.min(1, y/viewportHeight)); pinObj.x_norm = nx; pinObj.y_norm = ny; elPin.style.left = `${nx * viewportWidth}px`; elPin.style.top = `${ny * viewportHeight}px`; }
        function onPointerUp(ev){ try{ elPin.releasePointerCapture(ev.pointerId); }catch(e){} dragging = false; elPin.style.cursor = 'grab'; window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', onPointerUp); setTimeout(()=>{ moved = false; }, 0); // persist change for saved issues
          if (pinObj && pinObj.id) { savePin(); }
          try{ trackEvent('pin_drag_end', { id: pinObj.id || null, page: pinObj.page, x: pinObj.x_norm, y: pinObj.y_norm }); }catch(e){}
          try{ if(navigator && typeof navigator.vibrate === 'function') navigator.vibrate(10); }catch(e){}
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
        function onPointerDown(ev){ ev.preventDefault(); ev.stopPropagation(); try{ elPin.setPointerCapture(ev.pointerId); }catch(e){} dragging = true; moved = false; elPin.style.cursor = 'grabbing'; window.addEventListener('pointermove', onPointerMove); window.addEventListener('pointerup', onPointerUp); if(overlay._issueHold && overlay._issueHold.timer){ clearTimeout(overlay._issueHold.timer); overlay._issueHold.timer = null; } // analytics & haptic
          try{ trackEvent('pin_drag_start', { id: pinObj.id || null, page: pinObj.page, x: pinObj.x_norm, y: pinObj.y_norm }); }catch(e){}
          try{ if(navigator && typeof navigator.vibrate === 'function') navigator.vibrate(10); }catch(e){}
        }
        function onPointerMove(ev){ if(!dragging) return; moved = true; const rect = overlay.getBoundingClientRect(); const x = ev.clientX - rect.left; const y = ev.clientY - rect.top; const nx = Math.max(0, Math.min(1, x/viewportWidth)); const ny = Math.max(0, Math.min(1, y/viewportHeight)); pinObj.x_norm = nx; pinObj.y_norm = ny; elPin.style.left = `${nx * viewportWidth}px`; elPin.style.top = `${ny * viewportHeight}px`; }
        function onPointerUp(ev){ try{ elPin.releasePointerCapture(ev.pointerId); }catch(e){} dragging = false; elPin.style.cursor = 'grab'; window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerup', onPointerUp); setTimeout(()=>{ moved = false; }, 0); try{ trackEvent('pin_drag_end', { id: pinObj.id || null, page: pinObj.page, x: pinObj.x_norm, y: pinObj.y_norm }); }catch(e){}
          try{ if(navigator && typeof navigator.vibrate === 'function') navigator.vibrate(10); }catch(e){}
        }
        elPin.addEventListener('pointerdown', onPointerDown);
        elPin.addEventListener('click', (ev)=>{ if(moved) { ev.stopPropagation(); return; } showIssueModal(pinObj); });
      })(el, p);
    } else {
      el.addEventListener('click', ()=> showIssueModal(p));
    }
  }

  if (pendingHighlightIssueId) {
    const ok = highlightPinById(pendingHighlightIssueId);
    if (ok) pendingHighlightIssueId = null;
  }
}

async function renderPage(pageNo){ if(!pdfDoc) return; const {wrap, canvas, overlay} = ensureWrapAndOverlay(); const ctx = canvas.getContext('2d'); setStatus(`Rendering page ${pageNo}…`); const page = await pdfDoc.getPage(pageNo); const w = stageWidth(); const h = stageHeight(); const v1 = page.getViewport({scale:1.0}); // choose the fit scale that keeps the page within both width and height of the stage
  fitScale = Math.min(w / v1.width, h / v1.height);
  const effectiveScale = fitMode ? (fitScale * userZoom) : userZoom; const viewport = page.getViewport({scale: effectiveScale}); const dpr = window.devicePixelRatio || 1; canvas.width = Math.floor(viewport.width * dpr); canvas.height = Math.floor(viewport.height * dpr); canvas.style.width = `${Math.floor(viewport.width)}px`; canvas.style.height = `${Math.floor(viewport.height)}px`; wrap.style.width = `${Math.floor(viewport.width)}px`; wrap.style.height = `${Math.floor(viewport.height)}px`; overlay.style.width = `${Math.floor(viewport.width)}px`; overlay.style.height = `${Math.floor(viewport.height)}px`; ctx.setTransform(dpr,0,0,dpr,0,0); applyPanTransform(); await page.render({canvasContext:ctx, viewport}).promise; await renderPinsForPage(overlay, Math.floor(viewport.width), Math.floor(viewport.height)); setStatus(''); setBadges(); setModeBadge(); }

async function goToPage(n){ if(!pdfDoc) return; const pageNo = Math.max(1, Math.min(totalPages, n)); currentPage = pageNo; panX = 0; panY = 0; await renderPage(currentPage); }

// Expose a global helper to let other UI code jump the viewer to a page
window.viewerGoToPage = async function(n){ try{ if(typeof goToPage==='function') await goToPage(n); }catch(e){ console.warn('viewerGoToPage failed', e); } };

// Jump to an issue and highlight its pin
window.viewerJumpToIssue = async function(issue){
  try{
    if(!issue || !issue.page) return;
    pendingHighlightIssueId = String(issue.id || '');
    await goToPage(Number(issue.page || 1));
    // try immediate highlight in case render finished before pending set
    const overlay = qs('#pdfContainer .pdfOverlay');
    const pin = dbPins.find(p=>String(p.id)===String(issue.id));
    if (overlay && pin) {
      showPinTrail(pin.x_norm * overlay.clientWidth, pin.y_norm * overlay.clientHeight, overlay);
    }
    highlightPinById(pendingHighlightIssueId);
  }catch(e){ console.warn('viewerJumpToIssue failed', e); }
};

// Preview highlight only (no page jump)
window.viewerPreviewIssue = function(issue){
  try{
    if(!issue || !issue.page) return;
    if (Number(issue.page) !== Number(currentPage)) return;
    pendingHighlightIssueId = String(issue.id || '');
    highlightPinById(pendingHighlightIssueId);
  }catch(e){ /* ignore */ }
};

function bindUiOnce(){ if(window.__viewerBound) return; window.__viewerBound = true;
  const prevBtn = qs('#btnPrev'); const nextBtn = qs('#btnNext'); const goBtn = qs('#btnGo'); const pageInput = qs('#pageInput'); const zoomOut = qs('#btnZoomOut'); const zoomIn = qs('#btnZoomIn'); const fitBtn = qs('#btnFit'); const closeBtn = qs('#btnCloseViewer'); const addBtn = qs('#btnAddIssueMode'); const fab = qs('#fabAddIssue');
  const mPrev = qs('#mBtnPrev'); const mNext = qs('#mBtnNext'); const mAdd = qs('#mBtnAdd'); const mIssues = qs('#mBtnIssues');
  if(prevBtn) prevBtn.onclick = ()=> goToPage(currentPage-1); if(nextBtn) nextBtn.onclick = ()=> goToPage(currentPage+1);
  if(goBtn){ goBtn.onclick = ()=>{ const v = parseInt(pageInput? pageInput.value:'1',10); goToPage(Number.isFinite(v)?v:1); }; }
  if(pageInput){ pageInput.addEventListener('keydown',(e)=>{ if(e.key==='Enter'){ const v = parseInt(pageInput.value||'1',10); goToPage(Number.isFinite(v)?v:1); } }); }
  if(zoomOut) zoomOut.onclick = async ()=>{ userZoom = Math.max(0.25, userZoom-0.25); await renderPage(currentPage); };
  if(zoomIn) zoomIn.onclick = async ()=>{ userZoom = Math.min(5.0, userZoom+0.25); await renderPage(currentPage); };
  if(fitBtn) fitBtn.onclick = async ()=>{ fitMode = true; userZoom = 1.0; panX = 0; panY = 0; await renderPage(currentPage); };
  // Keep add-mode visuals consistent between desktop Add button and mobile FAB
  function setAddModeVisuals(){
    updateAddModeVisuals();
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
  if(mPrev) mPrev.onclick = ()=> goToPage(currentPage-1);
  if(mNext) mNext.onclick = ()=> goToPage(currentPage+1);
  if(mAdd) mAdd.onclick = ()=>{ if(addBtn) addBtn.click(); };
  if(mIssues) mIssues.onclick = ()=>{ const btn = qs('#btnViewIssues'); if(btn) btn.click(); };

  // Touch pinch-to-zoom on mobile
  const stage = qs('#pdfStage');
  if (stage && !stage.__pinchBound) {
    stage.__pinchBound = true;
    stage.style.touchAction = 'none';
    const pointers = new Map();
    let startDist = 0;
    let startZoom = userZoom;
    let pinchActive = false;
    let renderTimer = null;
    let panActive = false;
    let panLastX = 0;
    let panLastY = 0;
    let lastCenter = null;
    const scheduleRender = () => {
      if (renderTimer) return;
      renderTimer = setTimeout(async () => {
        renderTimer = null;
        if (pdfDoc) await renderPage(currentPage);
      }, 80);
    };
    const getDist = () => {
      const pts = Array.from(pointers.values());
      if (pts.length < 2) return 0;
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      return Math.hypot(dx, dy);
    };
    stage.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1 && !addIssueMode) {
        panActive = true;
        panLastX = e.clientX;
        panLastY = e.clientY;
        stage.classList.add('dragging');
      }
      if (pointers.size === 2) {
        pinchActive = true;
        startDist = getDist();
        startZoom = userZoom;
        fitMode = false;
        const pts = Array.from(pointers.values());
        lastCenter = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      }
    });
    stage.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch') return;
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!pinchActive && pointers.size === 1 && panActive) {
        const dx = e.clientX - panLastX;
        const dy = e.clientY - panLastY;
        panX += dx;
        panY += dy;
        panLastX = e.clientX;
        panLastY = e.clientY;
        applyPanTransform();
        e.preventDefault();
      }
      if (pinchActive && pointers.size === 2) {
        const pts = Array.from(pointers.values());
        const center = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        if (lastCenter) {
          panX += center.x - lastCenter.x;
          panY += center.y - lastCenter.y;
          applyPanTransform();
        }
        lastCenter = center;
        const dist = getDist();
        if (startDist > 0) {
          const scale = dist / startDist;
          const nextZoom = Math.max(0.25, Math.min(5.0, startZoom * scale));
          if (Math.abs(nextZoom - userZoom) > 0.01) {
            userZoom = nextZoom;
            fitMode = false;
            setBadges();
            scheduleRender();
          }
        }
      }
    });
    const endPinch = (e) => {
      if (e.pointerType !== 'touch') return;
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        panActive = false;
        stage.classList.remove('dragging');
      }
      if (pointers.size < 2) {
        pinchActive = false;
        startDist = 0;
        startZoom = userZoom;
        lastCenter = null;
        if (pdfDoc) renderPage(currentPage);
      }
    };
    stage.addEventListener('pointerup', endPinch);
    stage.addEventListener('pointercancel', endPinch);
  }
  if(closeBtn){ closeBtn.onclick = ()=>{ const u = new URL(window.location.href); u.searchParams.delete('plan_id'); history.pushState({},'',u.pathname); setTitle('Select a plan'); setStatus(''); const c = qs('#pdfContainer'); if(c) c.innerHTML = ''; pdfDoc = null; totalPages = 0; currentPage = 1; userZoom = 1.0; panX = 0; panY = 0; addIssueMode = false; setModeBadge(); setBadges(); document.body.classList.remove('has-viewer'); }; }
  window.addEventListener('resize', ()=>{ if(pdfDoc) { panX = 0; panY = 0; renderPage(currentPage); } });

  // initialize crosshair helper (mobile-gated)
  try{ initCrosshair(); }catch(e){}

  // Keyboard shortcuts (avoid when typing)
  document.addEventListener('keydown', (e)=>{
    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return;
    if (e.key === 'a' || e.key === 'A'){ if(addBtn) addBtn.click(); }
    if (e.key === 'Escape'){ const modal = document.getElementById('issueModal'); if(modal && modal.style.display === 'block'){ modal.style.display='none'; } }
    if (e.key === '['){ goToPage(currentPage-1); }
    if (e.key === ']'){ goToPage(currentPage+1); }
    if (e.key === '+' || e.key === '='){ userZoom = Math.min(5.0, userZoom+0.25); renderPage(currentPage); }
    if (e.key === '-' || e.key === '_'){ userZoom = Math.max(0.25, userZoom-0.25); renderPage(currentPage); }
  });

}

// Issue modal with photo upload
async function showIssueModal(pin){
  const normalizeStatusLabel = (val)=>{
    if(!val) return 'Open';
    const norm = String(val).toLowerCase().replace(/[_\s]+/g,' ');
    if (norm === 'in progress') return 'In Progress';
    if (norm === 'closed') return 'Closed';
    return 'Open';
  };
  const normalizePriorityLabel = (val)=>{
    if(!val) return 'Medium';
    const norm = String(val).toLowerCase().replace(/[_\s]+/g,' ');
    if (norm === 'low') return 'Low';
    if (norm === 'high') return 'High';
    return 'Medium';
  };
  pin.status = normalizeStatusLabel(pin.status);
  pin.priority = normalizePriorityLabel(pin.priority);
  let modal = document.getElementById('issueModal');
  if(!modal){
    modal = document.createElement('div');
    modal.id='issueModal';
    // Anchor near top on tall screens, allow scrolling when content exceeds viewport
    modal.style.position='fixed';
    modal.style.left='50%';
    modal.style.top='4vh';
    modal.style.transform='translateX(-50%)';
    modal.style.background='#222'; modal.style.color='#fff'; modal.style.zIndex=100000; modal.style.padding='20px'; modal.style.borderRadius='12px'; modal.style.boxShadow='0 0 24px #0ff8'; modal.style.maxWidth='96vw'; modal.style.width='680px'; modal.style.fontSize='16px'; modal.style.maxHeight='92vh'; modal.style.overflowY='auto';
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
                <button class="selectButton" aria-label="Status"><span class="selectedLabel">${pin.status ? pin.status : 'Open'}</span></button>
                <ul class="selectList" role="listbox" tabindex="-1">
                  <li role="option" data-value="Open">Open</li>
                  <li role="option" data-value="In Progress">In Progress</li>
                  <li role="option" data-value="Closed">Closed</li>
                </ul>
              </div>
            </div>
            <div style="width:140px;">
              <label style="display:block;margin-bottom:4px;">Priority:</label>
              <div id="issuePrioritySelect" class="customSelect neonSelect selectLike" role="combobox" aria-haspopup="listbox" aria-expanded="false" tabindex="0">
                <button class="selectButton" aria-label="Priority"><span class="selectedLabel">${pin.priority ? pin.priority : 'Medium'}</span></button>
                <ul class="selectList" role="listbox" tabindex="-1">
                  <li role="option" data-value="Low">Low</li>
                  <li role="option" data-value="Medium">Medium</li>
                  <li role="option" data-value="High">High</li>
                </ul>
              </div>
            </div>
          </div>
          <label style="display:block;margin-top:8px;">Assignee:<br>
            <input id="issueAssignee" type="text" style="width:100%;font-size:14px;" value="${pin.assigned_to||pin.assignee||''}" />
          </label>

          <!-- Moved: Preview block now under Assignee; enlarged and annotated -->
          <div id="issuePreview" style="margin-top:8px;">
            <div style="font-size:13px;margin-bottom:6px;display:flex;align-items:center;gap:8px;"><strong>Preview</strong><button id="issueAnnotToggleBtn" class="btn" style="padding:4px 8px;font-size:12px;">Annotate</button></div>
            <div id="issuePreviewWrap" style="width:100%;max-width:none;border:1px solid rgba(255,255,255,.06);position:relative;overflow:hidden;background:#111;">
              <canvas id="issuePreviewCanvas" style="display:block;width:100%;height:auto;background:#0b1416;"></canvas>
              <div id="issuePreviewOverlay" style="position:absolute;left:0;top:0;right:0;bottom:0;background:transparent;pointer-events:none;"></div>
            </div>
            <!-- coords display removed -->

          </div>
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

    // Normalize pin coordinates to numbers to avoid TypeErrors (e.g., when values are strings from the API)
    try{
      if(pin){
        pin.x_norm = (pin.x_norm !== undefined && pin.x_norm !== null) ? Number(pin.x_norm) : 0.5;
        pin.y_norm = (pin.y_norm !== undefined && pin.y_norm !== null) ? Number(pin.y_norm) : 0.5;
        if(!isFinite(pin.x_norm)) pin.x_norm = 0.5;
        if(!isFinite(pin.y_norm)) pin.y_norm = 0.5;
        // ensure page is numeric when present
        if(pin.page !== undefined && pin.page !== null) {
          const pn = Number(pin.page);
          if(isFinite(pn)) pin.page = pn;
        }
      }
    }catch(ignore){}


    // --- Annotation canvas: enable touch/pointer drawing on the preview area ---
    function ensureAnnotCanvas(){
      const wrap = modal.querySelector('#issuePreviewWrap'); if(!wrap) return;
      const dpr = window.devicePixelRatio || 1;
      let c = modal.querySelector('#issueAnnotCanvas');
      if(!c){ c = document.createElement('canvas'); c.id = 'issueAnnotCanvas'; c.style.position = 'absolute'; c.style.left = '0'; c.style.top = '0'; c.style.width = '100%'; c.style.height = '100%'; c.style.touchAction = 'none'; c.style.zIndex = 5; c.style.pointerEvents = 'none'; wrap.appendChild(c); }
      const ctx2 = c.getContext('2d');
      function resizeAnnot(){ const rect = wrap.getBoundingClientRect(); c.width = Math.floor(rect.width * dpr); c.height = Math.floor(rect.height * dpr); c.style.width = rect.width + 'px'; c.style.height = rect.height + 'px'; ctx2.setTransform(dpr,0,0,dpr,0,0); }
      resizeAnnot();
      modal._annotCanvas = c; modal._annotCtx = ctx2; modal._annotIsDrawing = false; modal._annotEnabled = false;
      modal._clearAnnotations = ()=>{ modal._annotCtx && modal._annotCtx.clearRect(0,0,modal._annotCanvas.width, modal._annotCanvas.height); };
      modal._annotHasContent = ()=>{ if(!modal._annotCtx) return false; const data = modal._annotCtx.getImageData(0,0,modal._annotCanvas.width, modal._annotCanvas.height).data; for(let i=3;i<data.length;i+=4) if(data[i]!==0) return true; return false; };
      c.addEventListener('pointerdown', function(e){ if(!modal._annotEnabled) return; if(e.button!==0) return; e.preventDefault(); modal._annotIsDrawing = true; try{ c.setPointerCapture(e.pointerId); }catch(ignore){} const rect = c.getBoundingClientRect(); const x = (e.clientX - rect.left); const y = (e.clientY - rect.top); modal._annotCtx.beginPath(); modal._annotCtx.lineWidth = 3; modal._annotCtx.lineCap='round'; modal._annotCtx.strokeStyle = '#ff0000'; modal._annotCtx.moveTo(x,y); });
      c.addEventListener('pointermove', function(e){ if(!modal._annotEnabled || !modal._annotIsDrawing) return; e.preventDefault(); const rect = c.getBoundingClientRect(); const x = (e.clientX - rect.left); const y = (e.clientY - rect.top); modal._annotCtx.lineTo(x,y); modal._annotCtx.stroke(); });
      c.addEventListener('pointerup', function(e){ if(!modal._annotEnabled || !modal._annotIsDrawing) return; e.preventDefault(); modal._annotIsDrawing=false; try{ c.releasePointerCapture(e.pointerId); }catch(ignore){} });
      c.addEventListener('pointercancel', function(e){ if(!modal._annotEnabled || !modal._annotIsDrawing) return; modal._annotIsDrawing=false; try{ c.releasePointerCapture(e.pointerId); }catch(ignore){} });
      window.addEventListener('resize', resizeAnnot);
      // wire Clear button
      const clearBtn = modal.querySelector('#issueClearAnnotBtn'); if(clearBtn) clearBtn.onclick = ()=>{ modal._clearAnnotations(); };
      // wire Annotate toggle
      const toggle = modal.querySelector('#issueAnnotToggleBtn'); if(toggle){ toggle.onclick = ()=>{ modal._annotEnabled = !modal._annotEnabled; modal._annotCanvas.style.pointerEvents = modal._annotEnabled ? 'auto' : 'none'; toggle.textContent = modal._annotEnabled ? 'Stop' : 'Annotate'; toggle.setAttribute('aria-pressed', modal._annotEnabled ? 'true' : 'false'); if(modal._annotEnabled){ modal._annotCanvas.focus && modal._annotCanvas.focus(); } }; }
    }
    ensureAnnotCanvas();

    // precision nudge and keyboard nudge removed

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
    const planId = getActivePlanId(pin); if(!planId || !pin.id) return;
    try{
      const res = await fetch(`/api/list_photos.php?plan_id=${planId}`);
      const txt = await res.text(); let data; try{ data = JSON.parse(txt);}catch{return;} if(!data.ok || !Array.isArray(data.photos)) return;
      const thumbs = data.photos.filter(p=>p.issue_id==pin.id);
      const thumbsDiv = modal.querySelector('#photoThumbs');
      thumbsDiv.innerHTML='';
      if (!thumbs.length) {
        thumbsDiv.innerHTML = '<div class="muted">No photos yet. Use Upload or Take Photo.</div>';
        return;
      }
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
        // create a small wrapper so we can add annotate button below each thumb
        const item = document.createElement('div');
        item.style.display='flex'; item.style.flexDirection='column'; item.style.alignItems='center'; item.style.gap='6px'; item.style.width='72px'; item.style.margin='2px';
        item.appendChild(img);
        const btnRow = document.createElement('div'); btnRow.style.display='flex'; btnRow.style.gap='6px';
        const annBtn = document.createElement('button'); annBtn.className='btn'; annBtn.textContent='Annotate';
        annBtn.onclick = async ()=>{
          try{
            annBtn.disabled = true;
            // fetch the full-size image (prefer t.url)
            const fetchUrl = t.url || src;
            const resp = await fetch(fetchUrl, { credentials: 'same-origin' });
            if(!resp.ok) throw new Error('Failed to fetch image');
            const blob = await resp.blob();
            openAnnotator(blob, async (annotBlob)=>{
              try{
                // replace the existing photo on server
                await uploadProcessedFile(annotBlob, t.issue_id || pin.id, null, { replace_photo_id: t.id });
                await loadPhotoThumbs();
                localShowToast('Photo replaced');
              }catch(e){
                console.error('Replace failed', e);
                localShowToast('Replace failed: ' + (e.message || e));
              } finally { annBtn.disabled = false; }
            });
          }catch(e){ annBtn.disabled = false; localShowToast('Failed to fetch image: ' + (e.message || e)); }
        };
        btnRow.appendChild(annBtn);
        item.appendChild(btnRow);
        thumbsDiv.appendChild(item);
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
          ann.className = 'annotatorModal';
          const wrap = document.createElement('div'); wrap.className = 'annotatorWrap';
          const header = document.createElement('div'); header.className = 'annotatorHeader';
          header.innerHTML = `<div><div class="annotatorTitle">Annotate Photo</div><div class="annotatorHint">Draw with finger or mouse. Pinch to zoom the page outside this dialog if needed.</div></div>`;
          const closeBtn = document.createElement('button'); closeBtn.className='btn'; closeBtn.textContent='Close';
          header.appendChild(closeBtn);
          const toolbar = document.createElement('div'); toolbar.className = 'annotatorToolbar';
          const canvasWrap = document.createElement('div'); canvasWrap.className = 'annotatorCanvasWrap';
          const canvas = document.createElement('canvas'); canvas.id = 'annotatorCanvas'; canvas.className = 'annotatorCanvas';
          canvasWrap.appendChild(canvas);
          const footer = document.createElement('div'); footer.className = 'annotatorFooter';
          const saveBtn = document.createElement('button'); saveBtn.className='btnPrimary'; saveBtn.textContent='Save';
          const undoBtn = document.createElement('button'); undoBtn.className='btn'; undoBtn.textContent='Undo';
          const undoBadge = document.createElement('span'); undoBadge.className='undoBadge'; undoBadge.textContent='0';
          undoBtn.appendChild(undoBadge);
          const clearBtn = document.createElement('button'); clearBtn.className='btn'; clearBtn.textContent='Clear';
          footer.appendChild(undoBtn); footer.appendChild(clearBtn); footer.appendChild(saveBtn);
          wrap.appendChild(header); wrap.appendChild(toolbar); wrap.appendChild(canvasWrap); wrap.appendChild(footer);
          ann.appendChild(wrap); document.body.appendChild(ann);

          // drawing state with tools, colors and undo stack
          let ctx = canvas.getContext('2d'); let drawing=false; let strokes=[]; let current=null; let toolMode='free'; let drawColor='rgba(255,80,80,0.95)'; let drawWidth=4;
          let zoom = 1; let fitMode = true;
          function applyZoom(){
            canvas.style.transform = `scale(${zoom})`;
            canvas.style.transformOrigin = 'top left';
            const zLabel = wrap.querySelector('#annotatorZoomLabel');
            if (zLabel) zLabel.textContent = Math.round(zoom * 100) + '%';
          }
          function fitZoom(){
            if (!canvas.width || !canvas.height) return;
            const pad = 16;
            const w = Math.max(200, canvasWrap.clientWidth - pad);
            const h = Math.max(200, canvasWrap.clientHeight - pad);
            zoom = Math.min(w / canvas.width, h / canvas.height, 2);
            zoom = Math.max(0.5, zoom);
            fitMode = true;
            applyZoom();
          }
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
          const toolSelect = document.createElement('select'); const opt1=document.createElement('option'); opt1.value='free'; opt1.textContent='Freehand'; const opt2=document.createElement('option'); opt2.value='arrow'; opt2.textContent='Arrow'; toolSelect.appendChild(opt1); toolSelect.appendChild(opt2); toolSelect.value = toolMode; toolSelect.onchange = ()=>{ toolMode = toolSelect.value; };
          const colorInput = document.createElement('input'); colorInput.type='color'; colorInput.value = '#ff5050'; colorInput.onchange = ()=>{ const v = colorInput.value; // convert hex to rgba
            drawColor = hexToRgba(v, 0.95); };
          const widthInput = document.createElement('input'); widthInput.type='range'; widthInput.min=1; widthInput.max=24; widthInput.value = drawWidth; widthInput.oninput = ()=>{ drawWidth = Number(widthInput.value); };
          const toolGroup = document.createElement('div'); toolGroup.className = 'annotatorToolGroup';
          const colorGroup = document.createElement('div'); colorGroup.className = 'annotatorToolGroup';
          const widthGroup = document.createElement('div'); widthGroup.className = 'annotatorToolGroup';
          toolGroup.innerHTML = '<label>Tool</label>'; toolGroup.appendChild(toolSelect);
          colorGroup.innerHTML = '<label>Color</label>'; colorGroup.appendChild(colorInput);
          widthGroup.innerHTML = '<label>Width</label>'; widthGroup.appendChild(widthInput);
          const swatches = document.createElement('div'); swatches.className = 'annotatorSwatches';
          const swatchColors = ['#ff5050','#ff7b00','#ffd400','#39ff14','#00ffe7','#2b7bff','#b026ff','#ffffff','#000000'];
          swatchColors.forEach((hex)=>{
            const b = document.createElement('button'); b.type='button'; b.className='swatchBtn'; b.style.background = hex;
            b.setAttribute('aria-label', `Color ${hex}`);
            b.onclick = ()=>{ colorInput.value = hex; drawColor = hexToRgba(hex, 0.95); };
            swatches.appendChild(b);
          });
          const zoomGroup = document.createElement('div'); zoomGroup.className = 'annotatorToolGroup';
          zoomGroup.innerHTML = '<label>Zoom</label>';
          const zoomControls = document.createElement('div'); zoomControls.className = 'annotatorZoomControls';
          const zoomOutBtn = document.createElement('button'); zoomOutBtn.className='btn'; zoomOutBtn.textContent='−';
          const zoomLabel = document.createElement('div'); zoomLabel.id='annotatorZoomLabel'; zoomLabel.className='annotatorZoomLabel'; zoomLabel.textContent='100%';
          const zoomInBtn = document.createElement('button'); zoomInBtn.className='btn'; zoomInBtn.textContent='+';
          const fitBtn = document.createElement('button'); fitBtn.className='btn'; fitBtn.textContent='Fit';
          zoomOutBtn.onclick = ()=>{ zoom = Math.max(0.5, zoom - 0.1); fitMode = false; applyZoom(); };
          zoomInBtn.onclick = ()=>{ zoom = Math.min(3, zoom + 0.1); fitMode = false; applyZoom(); };
          fitBtn.onclick = ()=>{ fitZoom(); };
          zoomControls.appendChild(zoomOutBtn); zoomControls.appendChild(zoomLabel); zoomControls.appendChild(zoomInBtn); zoomControls.appendChild(fitBtn);
          zoomGroup.appendChild(zoomControls);
          toolbar.appendChild(toolGroup); toolbar.appendChild(colorGroup); toolbar.appendChild(widthGroup); toolbar.appendChild(swatches); toolbar.appendChild(zoomGroup);

          function hexToRgba(hex, a){ const bigint = parseInt(hex.replace('#',''), 16); const r = (bigint >> 16) & 255; const g = (bigint >> 8) & 255; const b = bigint & 255; return `rgba(${r},${g},${b},${a})`; }

          function updateUndoBadge(){ undoBadge.textContent = String(strokes.length); }

          // pointer handlers
          canvas.addEventListener('pointerdown', (ev)=>{ ev.preventDefault(); try{ canvas.setPointerCapture && canvas.setPointerCapture(ev.pointerId); }catch(ignore){} drawing=true; const r = canvas.getBoundingClientRect(); const x = (ev.clientX-r.left)*(canvas.width/r.width); const y = (ev.clientY-r.top)*(canvas.height/r.height); if(toolMode==='free'){ current = [{x,y}]; } else { current = {sx:x, sy:y, ex:x, ey:y}; } });
          canvas.addEventListener('pointermove', (ev)=>{ if(!drawing || !current) return; ev.preventDefault(); const r = canvas.getBoundingClientRect(); const x = (ev.clientX-r.left)*(canvas.width/r.width); const y = (ev.clientY-r.top)*(canvas.height/r.height); if(toolMode==='free'){ current.push({x,y}); } else { current.ex = x; current.ey = y; } // redraw full canvas then overlay current
            redraw(); // overlay current
            if(toolMode==='free' && current.length>0){ ctx.strokeStyle = drawColor; ctx.lineWidth = drawWidth; ctx.beginPath(); ctx.moveTo(current[0].x, current[0].y); for(let i=1;i<current.length;i++) ctx.lineTo(current[i].x, current[i].y); ctx.stroke(); }
            if(toolMode==='arrow' && current){ ctx.strokeStyle = drawColor; ctx.lineWidth = drawWidth; ctx.beginPath(); ctx.moveTo(current.sx,current.sy); ctx.lineTo(current.ex,current.ey); ctx.stroke(); drawArrowHead(ctx, current.sx, current.sy, current.ex, current.ey, drawWidth, drawColor); }
          });
          canvas.addEventListener('pointerup', (ev)=>{ if(!drawing || !current) return; try{ canvas.releasePointerCapture && canvas.releasePointerCapture(ev.pointerId); }catch(ignore){} drawing=false; if(toolMode==='free'){ if(current.length>1) strokes.push({ type: 'free', points: current.slice(), color: drawColor, width: drawWidth }); } else { strokes.push({ type: 'arrow', sx: current.sx, sy: current.sy, ex: current.ex, ey: current.ey, color: drawColor, width: drawWidth }); } current=null; redraw(); updateUndoBadge(); });
          canvas.addEventListener('pointercancel', (ev)=>{ try{ canvas.releasePointerCapture && canvas.releasePointerCapture(ev.pointerId); }catch(ignore){} if(!drawing) return; drawing=false; current=null; redraw(); });

          undoBtn.onclick = ()=>{ if(strokes.length) strokes.pop(); redraw(); updateUndoBadge(); };
          clearBtn.onclick = ()=>{ strokes=[]; redraw(); updateUndoBadge(); };
          closeBtn.onclick = ()=>{ ann.style.display='none'; if(ann._resizeHandler){ window.removeEventListener('resize', ann._resizeHandler); ann._resizeHandler = null; } };
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
          // apply initial fit zoom
          try{ if(typeof fitZoom === 'function') fitZoom(); else { zoom = 1; applyZoom(); } }catch(e){}
          try{ if(typeof updateUndoBadge === 'function') updateUndoBadge(); }catch(e){}
          if(!ann._resizeHandler){
            ann._resizeHandler = ()=>{ try{ if(fitMode) fitZoom(); }catch(e){} };
            window.addEventListener('resize', ann._resizeHandler);
          }
        }; img.src = imgSrc;
        document.getElementById('annotatorModal').style.display='flex';
      };
      reader.readAsDataURL(fileOrBlob);
    }catch(e){ console.error('openAnnotator failed', e); }
  }
    // helper used by both file inputs -- will resize/compress client-side then upload
    // upload with progress support; will queue when no issueId
    function uploadProcessedFile(blobOrFile, targetIssueId, onProgress, opts){
      opts = opts || {};
      return new Promise((resolve, reject)=>{
        const planId = getActivePlanId(pin); const issueId = targetIssueId || pin.id;
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
        if (opts.replace_photo_id) fd.append('replace_photo_id', opts.replace_photo_id);

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
                try{ if(navigator && typeof navigator.vibrate === 'function') navigator.vibrate(30); }catch(e){}
                localShowToast(opts.replace_photo_id ? 'Photo replaced' : 'Photo uploaded');
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
        const planId = getActivePlanId(pin);
        if(!pin.id){
          const title = modal.querySelector('#issueTitle').value.trim();
          const notes = modal.querySelector('#issueNotes').value.trim();
          const status = modal.querySelector('#issueStatusSelect').value;
          const priority = modal.querySelector('#issuePrioritySelect').value;
          const assigned_to = modal.querySelector('#issueAssignee').value.trim();
          if(!title){ localShowToast('Title is required to upload photos.'); confirmBtn.disabled=false; return; }
          const issue = { plan_id: planId, page: pin.page, x_norm: pin.x_norm, y_norm: pin.y_norm, title, notes, status, priority, assigned_to };
          try{
            const saved = await apiSaveIssue(issue);
            pin.id = saved.issue?.id || saved.id;
            await reloadDbPins();
            await renderPage(currentPage);
          }catch(e){
            localShowToast('Error saving issue: '+(e && e.message ? e.message : e));
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
    }

    modal.querySelector('#issuePhotoInput').onchange = (e)=>{ const f = e.target.files && e.target.files[0]; if(f) handleSelectedFile(f); };
    // camera input (for mobile): hidden input with capture attribute
    let camInput = modal.querySelector('#issueCameraInput');
    if(!camInput){ camInput = document.createElement('input'); camInput.type='file'; camInput.accept='image/*'; camInput.capture='environment'; camInput.id='issueCameraInput'; camInput.style.display='none'; camInput.onchange = (e)=>{ const f = e.target.files && e.target.files[0]; if(f) handleSelectedFile(f); }; modal.appendChild(camInput); }
    const camBtn = modal.querySelector('#issueTakePhotoBtn');
    if(camBtn){ camBtn.onclick = ()=>{ camInput.value = ''; camInput.click(); }; }
    await loadPhotoThumbs();

    // helper to initialize and set values on customSelect widgets
    function normalizeSelectValue(val, opts){
      if (!val) return (opts[0] && opts[0].value) || '';
      const raw = String(val).trim();
      const norm = raw.toLowerCase().replace(/[_\s]+/g, ' ');
      const match = opts.find(o => String(o.value).toLowerCase().replace(/[_\s]+/g, ' ') === norm)
        || opts.find(o => String(o.label).toLowerCase().replace(/[_\s]+/g, ' ') === norm);
      return (match && match.value) || (opts[0] && opts[0].value) || raw;
    }
    function initCustomSelect(wrapper){
      if(!wrapper) return;
      const btn = wrapper.querySelector('.selectButton'); const ul = wrapper.querySelector('.selectList');
      // set initial selected label if any aria-selected exists
      const pre = ul.querySelector('li[aria-selected="true"]') || ul.querySelector('li[data-value]');
      if(pre) wrapper.querySelector('.selectedLabel').textContent = pre.textContent;
      const opts = Array.from(ul.querySelectorAll('li')).map(li => ({ value: li.dataset.value || li.textContent, label: li.textContent }));
      wrapper.value = normalizeSelectValue((pre && pre.dataset.value) || '', opts);
      const setSelected = (v)=>{ const sel = Array.from(ul.children).find(li=>li.dataset.value==v); if(sel){ wrapper.querySelector('.selectedLabel').textContent = sel.textContent; wrapper.value = v; ul.querySelectorAll('li').forEach(li=> li.setAttribute('aria-selected', li.dataset.value==v ? 'true' : 'false')); wrapper.dispatchEvent(new Event('change')); }};
      ul.querySelectorAll('li').forEach(li=>{ li.tabIndex=0; li.onclick = (ev)=>{ ev.stopPropagation(); setSelected(li.dataset.value); ul.classList.remove('open'); wrapper.setAttribute('aria-expanded','false'); }; li.onkeydown = (ev)=>{ if(ev.key==='Enter' || ev.key===' '){ ev.preventDefault(); li.click(); } }; });
      btn.onclick = (e)=>{ e.stopPropagation(); const open = ul.classList.toggle('open'); wrapper.setAttribute('aria-expanded', open? 'true':'false'); if(open) ul.focus(); };
      document.addEventListener('click', (ev)=>{ if(!wrapper.contains(ev.target)) { ul.classList.remove('open'); wrapper.setAttribute('aria-expanded','false'); } });
      // expose setter
      wrapper.setValue = setSelected;
      wrapper.setAttribute('role','combobox');
    }

    // populate status/prio/assignee from fetched details if available
    ;(async ()=>{
      let details = pin;
      if(pin.id && !(pin.created_at || pin.created_by || pin.status)){
        const fetched = await fetchIssueDetails(pin.id); if(fetched) details = Object.assign({}, pin, fetched);
      }
      const statusSelect = modal.querySelector('#issueStatusSelect'); const prioSelect = modal.querySelector('#issuePrioritySelect'); const assigneeInput = modal.querySelector('#issueAssignee');
      if(statusSelect) initCustomSelect(statusSelect);
      if(prioSelect) initCustomSelect(prioSelect);
      if(statusSelect) statusSelect.setValue(normalizeSelectValue(details.status || 'Open', [{value:'Open',label:'Open'},{value:'In Progress',label:'In Progress'},{value:'Closed',label:'Closed'}]));
      if(prioSelect) prioSelect.setValue(normalizeSelectValue(details.priority || 'Medium', [{value:'Low',label:'Low'},{value:'Medium',label:'Medium'},{value:'High',label:'High'}]));
      if(assigneeInput) assigneeInput.value = details.assigned_to || details.assignee || '';
      const createdByEl = modal.querySelector('#issueCreatedBy'); if(createdByEl) createdByEl.textContent = details.created_by||details.author||'';
      const createdVal = details.created_at || details.created || details.createdAt || details.ts;
      const createdEl = modal.querySelector('#issueCreated'); if(createdEl){ if(createdVal){ if (typeof createdVal === 'string' && createdVal.indexOf('/') !== -1) { createdEl.textContent = createdVal; } else { const d = new Date(createdVal); const pad=(n)=>n.toString().padStart(2,'0'); createdEl.textContent = `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; } createdEl.style.display='block'; } else createdEl.style.display='none'; }
    })();

    // Setup PinDraggable preview if Add Issue Mode is active and feature enabled
    (async ()=>{
      try{
        // Always render a static snapshot for preview; only initialize PinDraggable when in add-issue workflow
        if(window.FEATURE_PIN_DRAG === false) console.debug('[DEBUG] Pin draggable feature disabled; preview will be static');
        const previewWrap = modal.querySelector('#issuePreviewWrap'); const previewCanvas = modal.querySelector('#issuePreviewCanvas'); const previewOverlay = modal.querySelector('#issuePreviewOverlay'); if(!previewWrap || !previewCanvas) return;
        // render a scaled snapshot of the current viewer canvas into previewCanvas (retry if layout not ready)
        const mainCanvas = document.getElementById('pdfCanvas'); if(!mainCanvas) return;
        // shared state for preview instance (pd may be created only in add mode)
        let pd = null;

        // load PinDraggable on-demand when add issue mode is active
        let pinLibReady = false;
        async function ensurePinLib(){
          if(window.FEATURE_PIN_DRAG === false) return false;
          if(window.PinDraggable){ pinLibReady = true; return true; }
          return new Promise((resolve)=>{
            const s = document.createElement('script'); s.src = '/app/pin-draggable.js';
            s.onload = ()=>{ pinLibReady = true; resolve(true); };
            s.onerror = ()=>{ console.warn('Failed to load pin-draggable.js'); resolve(false); };
            document.head.appendChild(s);
          });
        }
        await ensurePinLib();
        // place a preview pin overlay inside previewWrap (static fallback when PinDraggable is unavailable)
        function placePreviewPin(){
          try{
            const existing = previewWrap.querySelector('.preview-pin'); if(existing) existing.remove();
            const w = previewWrap.clientWidth || previewCanvas.clientWidth || previewCanvas.width || 0;
            const h = previewWrap.clientHeight || previewCanvas.clientHeight || previewCanvas.height || 0;
            if(!w || !h) return;
            const el = document.createElement('div'); el.className = 'pin preview-pin'; el.title = pin.title || '';
            const left = (pin.x_norm !== undefined ? (pin.x_norm * w) : (0.5 * w));
            const top = (pin.y_norm !== undefined ? (pin.y_norm * h) : (0.5 * h));
            el.style.left = left + 'px'; el.style.top = top + 'px';
            const labelText = String(pin.id || pin.label || pin.title || '!');
            const fontSize = labelText.length <= 2 ? 12 : (labelText.length === 3 ? 10 : 9);
            if(_pinSvgText){ try{ const parser = new DOMParser(); const doc = parser.parseFromString(_pinSvgText, 'image/svg+xml'); const svgEl = doc.querySelector('svg'); if(svgEl){ const node = document.importNode(svgEl, true); const txt = node.querySelector('.pin-number'); if(txt){ txt.textContent = labelText; txt.setAttribute('font-size', String(fontSize)); } el.appendChild(node); } else { el.innerHTML = `<svg viewBox="0 0 64 80" width="56" height="72"><circle cx="32" cy="20" r="16" fill="#e12b2b"/><path d="M32 36 C24 48, 16 60, 32 76 C48 60, 40 48, 32 36 Z" fill="#e12b2b"/><text x="32" y="20" text-anchor="middle" dominant-baseline="central" fill="#000" font-weight="900" font-size="${fontSize}">${labelText}</text></svg>`; } }catch(e){ console.warn('preview pin SVG parse failed', e); el.innerHTML = `<svg viewBox="0 0 64 80" width="56" height="72"><circle cx="32" cy="20" r="16" fill="#e12b2b"/><path d="M32 36 C24 48, 16 60, 32 76 C48 60, 40 48, 32 36 Z" fill="#e12b2b"/><text x="32" y="20" text-anchor="middle" dominant-baseline="central" fill="#000" font-weight="900" font-size="${fontSize}">${labelText}</text></svg>`; }
            }
            // when user nudges via keyboard controls, keep preview pin in sync by updating attributes
            previewWrap.appendChild(el);
            // if add mode is active, make preview pin draggable (simple pointer drag that updates pin.x_norm / y_norm)
            if(addIssueMode){
              el.style.cursor='grab'; el.style.touchAction='none';
              let dragging=false, moved=false;
              function onDown(ev){ ev.preventDefault(); try{ el.setPointerCapture(ev.pointerId); }catch(ignore){} dragging=true; el.style.cursor='grabbing'; window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); }
              function onMove(ev){ if(!dragging) return; moved=true; const r = previewWrap.getBoundingClientRect(); const x = ev.clientX - r.left; const y = ev.clientY - r.top; const nx = Math.max(0, Math.min(1, x / r.width)); const ny = Math.max(0, Math.min(1, y / r.height)); pin.x_norm = nx; pin.y_norm = ny; el.style.left = (nx * r.width) + 'px'; el.style.top = (ny * r.height) + 'px'; const coordEl = modal.querySelector('#issueCoords'); if(coordEl) coordEl.textContent = `x:${nx.toFixed(2)} y:${ny.toFixed(2)}`; }
              function onUp(ev){ try{ el.releasePointerCapture(ev.pointerId); }catch(ignore){} dragging=false; el.style.cursor='grab'; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); // persist if saved
                if(pin && pin.id){ const issue = { id: pin.id, plan_id: getActivePlanId(pin), page: pin.page, x_norm: pin.x_norm, y_norm: pin.y_norm }; apiSaveIssue(issue).then(()=>{ localShowToast('Pin saved'); reloadDbPins(); renderPage(currentPage); }).catch(()=>{}); }
              }
              el.addEventListener('pointerdown', onDown);
            }
          }catch(e){ console.warn('placePreviewPin failed', e); }
        }
        const ensurePreview = (attemptsLeft = 6) => {
          // Prefer the canvas' displayed CSS size (clientWidth/clientHeight) so the preview matches
          // exactly what the user sees in the main viewer. Using the internal bitmap size caused
          // mismatches (devicePixelRatio) and the old HEIGHT_MULT distorted vertical scale.
          const cssBaseW = mainCanvas.clientWidth || mainCanvas.width || 0;
          const cssBaseH = mainCanvas.clientHeight || mainCanvas.height || 0;
          const deviceW = mainCanvas.width || cssBaseW;
          const deviceH = mainCanvas.height || cssBaseH;
          if ((cssBaseW < 20 || cssBaseH < 20) && attemptsLeft > 0) { console.debug('[DEBUG] preview deferred: main canvas not ready, retrying', { attemptsLeft, cssBaseW, cssBaseH, clientW: mainCanvas.clientWidth, clientH: mainCanvas.clientHeight, deviceW, deviceH }); setTimeout(()=> ensurePreview(attemptsLeft - 1), 200); return; }
          if (cssBaseW < 20 || cssBaseH < 20) {
            // placeholder when preview can't be rendered; surface a helpful UI message and set diagnostic attribute
            const ctx = previewCanvas.getContext('2d'); const pw = previewWrap.clientWidth || 420; const ph = 260;
            previewCanvas.width = pw; previewCanvas.height = ph;
            ctx.fillStyle = '#0b1416'; ctx.fillRect(0,0,pw,ph);
            try{ ctx.fillStyle = '#6b7c80'; ctx.font = '12px sans-serif'; ctx.fillText('Preview not ready — PDF rendering', 10, 20); }catch(ignore){}
            previewWrap.style.width = '100%'; previewWrap.style.maxWidth = 'none'; previewWrap.style.height = ph + 'px';
            try{ previewWrap.setAttribute('data-preview-error', 'canvas-unready'); const msg = previewWrap.querySelector('.issuePreviewMsg'); if(msg){ msg.querySelector('.issuePreviewMsgText').textContent = 'Preview not ready — PDF is still rendering or unavailable. Click Retry preview when the PDF has finished loading.'; msg.style.display = 'flex'; }
            }catch(ignore){}
            return;
          }
          // prefer the preview container width (fluid on small screens)
          const available = previewWrap.clientWidth || cssBaseW;
          const previewWidth = Math.max(1, available);
          const HEIGHT_MULT = 1.0; // preserve aspect ratio (do not artificially stretch)
          const cssScale = previewWidth / cssBaseW;
          const newW = Math.max(1, Math.round(deviceW * cssScale));
          const newH = Math.max(1, Math.round(deviceH * cssScale * HEIGHT_MULT));
          // Keep the bitmap at device-pixel resolution so the preview matches main viewer clarity
          previewCanvas.width = newW;
          previewCanvas.height = newH;
          const ctx = previewCanvas.getContext('2d');
          console.debug('[DEBUG] preview bitmap sizes (with HEIGHT_MULT)', { bitmapW: previewCanvas.width, bitmapH: previewCanvas.height, cssScale, HEIGHT_MULT, deviceW, deviceH });
          // Ensure a small overlay exists for user-visible preview errors / retry
          let msgEl = previewWrap.querySelector('.issuePreviewMsg');
          if(!msgEl){
            msgEl = document.createElement('div');
            msgEl.className = 'issuePreviewMsg';
            msgEl.style.position = 'absolute'; msgEl.style.left = '0'; msgEl.style.top = '0'; msgEl.style.right = '0'; msgEl.style.bottom = '0';
            msgEl.style.display = 'none'; msgEl.style.alignItems = 'center'; msgEl.style.justifyContent = 'center'; msgEl.style.flexDirection = 'column'; msgEl.style.gap = '8px';
            msgEl.style.pointerEvents = 'auto'; msgEl.style.background = 'linear-gradient(180deg, rgba(11,20,22,0.6), rgba(11,20,22,0.6))';
            msgEl.style.color = '#9fb3b6'; msgEl.style.fontSize = '13px'; msgEl.style.textAlign = 'center'; msgEl.style.padding = '12px'; msgEl.style.zIndex = 10; msgEl.style.borderRadius = '4px';
            const text = document.createElement('div'); text.className = 'issuePreviewMsgText'; text.textContent = '';
            const btn = document.createElement('button'); btn.className = 'btn'; btn.textContent = 'Retry preview'; btn.style.marginTop = '6px';
            btn.onclick = ()=>{ try{ msgEl.style.display = 'none'; ensurePreview(1); }catch(ignore){} };
            msgEl.appendChild(text); msgEl.appendChild(btn);
            previewWrap.appendChild(msgEl);
          }
          try{
            console.debug('[DEBUG] preview draw sizes', { cssBaseW, cssBaseH, deviceW, deviceH, previewW: previewCanvas.width, previewH: previewCanvas.height, cssScale });
            ctx.clearRect(0,0,previewCanvas.width, previewCanvas.height);
            ctx.drawImage(mainCanvas, 0, 0, previewCanvas.width, previewCanvas.height);
            // hide any previous message and clear diagnostic attribute
            try{ msgEl.style.display = 'none'; previewWrap.removeAttribute('data-preview-error'); }catch(ignore){}
            try{ placePreviewPin(); }catch(ignore){}
          }catch(e){
            console.warn('preview drawImage failed', e); // Draw a clear placeholder with message so it's obvious why the preview is empty
            ctx.fillStyle = '#0b1416'; ctx.fillRect(0,0,previewCanvas.width, previewCanvas.height);
            try{ ctx.fillStyle = '#6b7c80'; ctx.font = '12px sans-serif'; ctx.fillText('Preview unavailable', 10, 20); }catch(err){}
            // expose failure for diagnostics/tests
            try{ previewWrap.setAttribute('data-preview-error', String(e && e.message || 'drawImage failed')); }catch(ignore){}
            // show a user-visible message and allow retry
            try{ msgEl.querySelector('.issuePreviewMsgText').textContent = 'Preview unavailable — ' + (e && e.message ? e.message : 'drawImage failed'); msgEl.style.display = 'flex'; }catch(ignore){}
            // Fallback: try to render the PDF page directly into the preview canvas using PDF.js
            (async ()=>{
              try{
                if(window.pdfDoc && typeof window.pdfDoc.getPage === 'function'){
                  const pageNum = (pin && pin.page) ? Number(pin.page) : currentPage || 1;
                  const page = await window.pdfDoc.getPage(pageNum);
                  const unscaled = page.getViewport({ scale: 1 });
                  const scale = previewCanvas.width / Math.max(1, unscaled.width);
                  const viewport = page.getViewport({ scale });
                  await page.render({ canvasContext: ctx, viewport }).promise;
                  // clear any error flag if render succeeds
                  try{ previewWrap.removeAttribute('data-preview-error'); msgEl.style.display = 'none'; }catch(ignore){}
                  // ensure preview pin overlays after fallback render
                  try{ placePreviewPin(); }catch(ignore){}
                } else {
                  // If PDF.js not available here, surface a hint to the user
                  try{ msgEl.querySelector('.issuePreviewMsgText').textContent = 'Preview fallback unavailable — PDF not loaded'; msgEl.style.display='flex'; }catch(ignore){}
                }
              }catch(err2){ console.warn('preview fallback render failed', err2); try{ msgEl.querySelector('.issuePreviewMsgText').textContent = 'Preview fallback failed — ' + (err2 && err2.message || String(err2)); msgEl.style.display='flex'; }catch(ignore){} }
            })(); }
          const cssHeight = Math.round(cssBaseH * cssScale * HEIGHT_MULT);
          previewWrap.style.width = '100%'; previewWrap.style.maxWidth = 'none'; previewWrap.style.height = cssHeight + 'px';
          // Ensure canvas CSS size matches wrapper to avoid cropping
          try{ previewCanvas.style.width = previewWidth + 'px'; previewCanvas.style.height = cssHeight + 'px'; console.debug('[DEBUG] preview CSS sizes set', { previewWidth, cssHeight, canvasBitmapW: previewCanvas.width, canvasBitmapH: previewCanvas.height }); }catch(ignore){}

          // instantiate PinDraggable after ensuring canvas is sized
          try{
            console.log('[DEBUG] PinDraggable init pin.x_norm,y_norm =', pin.x_norm, pin.y_norm);
            const PD = pinLibReady ? (window.PinDraggable && window.PinDraggable.PinDraggable ? window.PinDraggable.PinDraggable : window.PinDraggable) : null;
            if (PD) {
              pd = new PD({
                container: previewWrap,
                img: previewCanvas,
                initial: { x_norm: (pin.x_norm !== undefined ? pin.x_norm : 0.5), y_norm: (pin.y_norm !== undefined ? pin.y_norm : 0.5) },
                onChange: (coords)=>{ pin.x_norm = coords.x_norm; pin.y_norm = coords.y_norm; const el = modal.querySelector('#issueCoords'); if(el) el.textContent = `x:${coords.x_norm.toFixed(2)} y:${coords.y_norm.toFixed(2)}`; try{ trackEvent('pin_drag_move', { x: coords.x_norm, y: coords.y_norm }); }catch(e){} },
                onSave: (coords)=>{ pin.x_norm = coords.x_norm; pin.y_norm = coords.y_norm; const el = modal.querySelector('#issueCoords'); if(el) el.textContent = `x:${coords.x_norm.toFixed(2)} y:${coords.y_norm.toFixed(2)}`; try{ trackEvent('pin_save_preview', { x: coords.x_norm, y: coords.y_norm }); }catch(e){} }
              });
              modal._pinDraggable = pd;
            } else if(addIssueMode && window.FEATURE_PIN_DRAG !== false) {
              console.warn('PinDraggable library not available; preview will be static');
            }
          }catch(e){ console.warn('PinDraggable init failed', e); }
        };
        ensurePreview();
        const _previewResizeHandler = ()=> ensurePreview();
        window.addEventListener('resize', _previewResizeHandler);
          // detect pointer interactions on preview pins (start/end)
          previewWrap.addEventListener('pointerdown', (ev)=>{ if(ev.target && ev.target.closest && ev.target.closest('.pin')){ try{ trackEvent('pin_drag_start', { id: pin.id || null, page: pin.page, x: pin.x_norm, y: pin.y_norm }); }catch(e){} try{ if(navigator && typeof navigator.vibrate === 'function') navigator.vibrate(10); }catch(e){} } });
          previewWrap.addEventListener('pointerup', (ev)=>{ if(ev.target && ev.target.closest && ev.target.closest('.pin')){ try{ trackEvent('pin_drag_end', { id: pin.id || null, page: pin.page, x: pin.x_norm, y: pin.y_norm }); }catch(e){} try{ if(navigator && typeof navigator.vibrate === 'function') navigator.vibrate(10); }catch(e){} } });
          // set initial coords display
          const elc = modal.querySelector('#issueCoords'); if(elc) elc.textContent = `x:${(pin.x_norm||0.5).toFixed(2)} y:${(pin.y_norm||0.5).toFixed(2)}`;
          console.debug('[DEBUG] PinDraggable created, display coords set to', elc && elc.textContent);

        // cleanup when modal is closed or cancelled
        const cleanup = ()=>{ try{ if(pd && typeof pd.destroy === 'function') pd.destroy(); }catch(e){} try{ window.removeEventListener('resize', _previewResizeHandler); }catch(e){} };
        const cancelBtn = modal.querySelector('#issueCancelBtn'); if(cancelBtn){ const prev = cancelBtn.onclick; cancelBtn.onclick = ()=>{ cleanup(); if(typeof prev === 'function') prev(); }; }
        // also cleanup on save hide
        const saveBtn = modal.querySelector('#issueSaveBtn'); if(saveBtn){ const prevS = saveBtn.onclick; saveBtn.onclick = async ()=>{ if(typeof pd !== 'undefined' && pd && typeof pd.destroy === 'function') pd.destroy(); try{ window.removeEventListener('resize', _previewResizeHandler); }catch(e){} if(typeof prevS === 'function') await prevS(); } }
      }catch(e){ console.warn('Setting up pin draggable preview failed', e); }
    })();

    modal.querySelector('#issueSaveBtn').onclick = async ()=>{
    const planId = getActivePlanId(pin);
    const title = modal.querySelector('#issueTitle').value.trim();
    const notes = modal.querySelector('#issueNotes').value.trim();
    const status = modal.querySelector('#issueStatusSelect') ? modal.querySelector('#issueStatusSelect').value : (pin.status||'Open');
    const priority = modal.querySelector('#issuePrioritySelect') ? modal.querySelector('#issuePrioritySelect').value : (pin.priority||null);
    const assigned_to = modal.querySelector('#issueAssignee') ? modal.querySelector('#issueAssignee').value.trim() : (pin.assigned_to||pin.assignee||null);
    if(!title){ localShowToast('Title is required'); return; }
    const issue = { plan_id: planId, page: pin.page, x_norm: pin.x_norm, y_norm: pin.y_norm, title, notes, status, priority, assigned_to };
    if(pin.id) issue.id = pin.id;
    try{
      const saved = await apiSaveIssue(issue);
      const savedId = saved.issue?.id || saved.id;
      try{ trackEvent('pin_save_success', { id: savedId || null, x: issue.x_norm, y: issue.y_norm }); }catch(e){}
      try{ if(navigator && typeof navigator.vibrate === 'function') navigator.vibrate(50); }catch(e){}
      addIssueMode = true;
      updateAddModeVisuals();
      localShowToast('Saved — long‑press to add another');
      // after saving, upload any queued photos that were added before save
      if(pendingPhotos && pendingPhotos.length){
        pin.id = savedId || pin.id;
        for(const [idx, pf] of pendingPhotos.entries()){
          try{
            // show progress while uploading
            await uploadProcessedFile(pf, pin.id, (p)=>{ try{ pf.uploadProgress = p; renderPendingPhotos(); }catch(e){} });
          }catch(e){ console.error('Queued photo upload failed', e); }
        }
        pendingPhotos = []; renderPendingPhotos();
      }
      modal.style.display='none';
      window.removeEventListener('keydown', modal._keyHandler);
      await reloadDbPins();
      await renderPage(currentPage);
      if(!pin.id && savedId){ pin.id = savedId; await showIssueModal(pin); }
    }catch(e){ localShowToast('Error saving issue: '+e.message); try{ trackEvent('pin_save_failure', { error: e && e.message || String(e) }); }catch(x){} try{ if(navigator && typeof navigator.vibrate === 'function') navigator.vibrate(20); }catch(x){} }
  };

  // Cancel handler and close modal
    const cancelBtn = modal.querySelector('#issueCancelBtn'); if(cancelBtn) cancelBtn.onclick = ()=>{ try{ if(!pin.id) trackEvent('pin_create_cancel', { x: pin.x_norm, y: pin.y_norm, title: modal.querySelector('#issueTitle')?.value || '' }); }catch(e){} modal.style.display='none'; if(modal._clearAnnotations) modal._clearAnnotations(); window.removeEventListener('keydown', modal._keyHandler); };

  // Refresh viewer when an issue is deleted elsewhere
  const issueDeletedHandler = (ev)=>{ try{ reloadDbPins(); renderPage(currentPage); }catch(e){} };
  document.addEventListener('issueDeleted', issueDeletedHandler);
  // remove listener when modal removed
  const oldRemove = modal.remove || (()=>{});
  modal.remove = function(){ document.removeEventListener('issueDeleted', issueDeletedHandler); oldRemove.call(this); };
}

async function reloadDbPins() {
  const planId = getActivePlanId();
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
      status: issue.status || 'Open',
      priority: issue.priority || null,
      assignee: issue.assigned_to || issue.assignee || null,
      assigned_to: issue.assigned_to || issue.assignee || null
    }));
    await loadPhotoCounts(planId);
  } catch (e) {
    dbPins = [];
    console.error('Failed to load issues:', e);
  }
}

async function loadPhotoCounts(planId){
  try{
    const res = await fetch(`/api/list_photos.php?plan_id=${planId}`, {credentials:'same-origin'});
    const txt = await res.text();
    let data; try{ data = JSON.parse(txt); }catch{ return; }
    if(!data.ok || !Array.isArray(data.photos)) return;
    const counts = {};
    for(const p of data.photos){
      const key = String(p.issue_id || '');
      if(!key) continue;
      counts[key] = (counts[key] || 0) + 1;
    }
    photoCounts = counts;
  }catch(e){ /* ignore */ }
}

// Public: open a plan from the sidebar button
async function openPlanInApp(planId) {
  const u = new URL(window.location.href);
  u.searchParams.set('plan_id', String(planId));
  history.pushState({}, '', u.toString());
  window.__currentPlanId = Number(planId);
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
  window.__currentPlanId = Number(planId);
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
    ensureLongPressHint();
    // Notify other UI code that a plan has been opened
    try { document.dispatchEvent(new CustomEvent('planOpened', { detail: { planId } })); } catch (e) { console.warn('planOpened event failed', e); }
  } catch (e) {
    console.error(e);
    setStatus(e.message || 'Viewer error');
  }
}
window.startViewer = startViewer;
