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
  const delPlanBtn = qs('#btnDeletePlan');
  if(delPlanBtn){ delPlanBtn.style.borderColor = 'rgba(255,80,80,.28)'; delPlanBtn.style.color = '#ff7b7b'; delPlanBtn.onclick = async ()=>{
    const planId = getPlanIdFromUrl(); if(!planId) return alert('No plan open');
    const planTitle = qs('#planTitle') ? qs('#planTitle').textContent : ('Plan ' + planId);
    if(!confirm(`Move plan "${planTitle}" to trash? This will remove the plan and all associated issues, photos and exports from the app, but files will be kept in storage/trash. This action cannot be undone from the UI. Continue?`)) return; 
    delPlanBtn.disabled = true;
    try{
      const res = await fetch('/api/delete_plan.php',{method:'POST',headers:{'Content-Type':'application/json'},body: JSON.stringify({ id: planId }), credentials:'same-origin'});
      const txt = await res.text(); let data; try{ data = JSON.parse(txt); }catch{ data = null; }
      if(!res.ok || !data || !data.ok) throw new Error((data && data.error) ? data.error : ('Delete failed (HTTP ' + res.status + ')'));
      localShowToast('Plan deleted');
      // close viewer and refresh plans list
      const u = new URL(window.location.href); u.searchParams.delete('plan_id'); history.pushState({},'',u.pathname);
      setTitle('Select a plan'); setStatus(''); const c = qs('#pdfContainer'); if(c) c.innerHTML = ''; pdfDoc = null; totalPages = 0; currentPage = 1; userZoom = 1.0; addIssueMode = false; setModeBadge(); setBadges(); document.body.classList.remove('has-viewer');
      try{ if(window.refreshPlans) window.refreshPlans(); }catch(e){}
    }catch(err){ localShowToast('Delete failed: ' + (err.message || err)); console.error('delete plan', err); }
    delPlanBtn.disabled = false;
  }; }
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
              <select id="issueStatusSelect" style="width:100%;min-height:40px;font-size:14px;">
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>
            </label>
            <label style="width:120px">Priority:<br>
              <select id="issuePrioritySelect" style="width:100%;min-height:40px;font-size:14px;">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
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
        <button id="issueSaveBtn" style="background:#0ff;color:#222;font-weight:bold;padding:8px 16px;border-radius:6px;">Save</button>
        <button id="issueCancelBtn" style="background:#444;color:#fff;padding:8px 16px;border-radius:6px;">Cancel</button>
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
        // notify the issues list to refresh thumbnails/counts
        try{ document.dispatchEvent(new CustomEvent('photosUpdated', { detail: { issueId } })); }catch(e){}
        localShowToast('Photo uploaded');
      }catch(err){ localShowToast('Photo upload error: '+err.message); }
    }

    // show preview and wire confirm/cancel
    function handleSelectedFile(file){ if(!file) return; const previewWrap = modal.querySelector('#photoPreview'); const imgEl = modal.querySelector('#photoPreviewImg'); const infoEl = modal.querySelector('#photoPreviewInfo'); previewWrap.style.display='flex'; const url = URL.createObjectURL(file); imgEl.src = url; infoEl.textContent = `${Math.round(file.size/1024)} KB — ${file.type}`;
      // set confirm handler to resize then upload
      const confirmBtn = modal.querySelector('#issueUploadConfirmBtn'); const cancelBtn = modal.querySelector('#issueUploadCancelBtn'); confirmBtn.disabled = false; confirmBtn.onclick = async ()=>{ confirmBtn.disabled = true; try{ const blob = await resizeImageFile(file); // convert to blob
            // try to preserve a filename
            const out = new File([blob], (file.name||'photo.jpg'), {type: blob.type}); await uploadProcessedFile(out); previewWrap.style.display='none'; URL.revokeObjectURL(url);
          }catch(err){ alert('Image processing failed: '+err.message); confirmBtn.disabled=false; } };
      cancelBtn.onclick = ()=>{ previewWrap.style.display='none'; imgEl.src=''; infoEl.textContent=''; URL.revokeObjectURL(url); };
    }

    modal.querySelector('#issuePhotoInput').onchange = (e)=>{ const f = e.target.files && e.target.files[0]; if(f) handleSelectedFile(f); };
    // camera input (for mobile): hidden input with capture attribute
    let camInput = modal.querySelector('#issueCameraInput');
    if(!camInput){ camInput = document.createElement('input'); camInput.type='file'; camInput.accept='image/*'; camInput.capture='environment'; camInput.id='issueCameraInput'; camInput.style.display='none'; camInput.onchange = (e)=>{ const f = e.target.files && e.target.files[0]; if(f) handleSelectedFile(f); }; modal.appendChild(camInput); }
    const camBtn = modal.querySelector('#issueTakePhotoBtn');
    if(camBtn){ camBtn.onclick = ()=>{ camInput.click(); }; }
    await loadPhotoThumbs();

    // populate status/prio/assignee from fetched details if available
    (async ()=>{
      let details = pin;
      if(pin.id && !(pin.created_at || pin.created_by || pin.status)){
        const fetched = await fetchIssueDetails(pin.id); if(fetched) details = Object.assign({}, pin, fetched);
      }
      const statusSelect = modal.querySelector('#issueStatusSelect'); const prioSelect = modal.querySelector('#issuePrioritySelect'); const assigneeInput = modal.querySelector('#issueAssignee');
      if(statusSelect) statusSelect.value = details.status || 'open'; if(prioSelect) prioSelect.value = details.priority || 'medium'; if(assigneeInput) assigneeInput.value = details.assignee || '';
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
      modal.style.display='none';
      await reloadDbPins();
      await renderPage(currentPage);
      if(!pin.id && saved.id){ pin.id = saved.id; await showIssueModal(pin); }
    }catch(e){ localShowToast('Error saving issue: '+e.message); }
  };

  // Cancel handler and close modal
  const cancelBtn = modal.querySelector('#issueCancelBtn'); if(cancelBtn) cancelBtn.onclick = ()=>{ modal.style.display='none'; };
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
