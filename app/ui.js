/* app/ui.js - UI controls, plans list, issues modal, exports, and toasts (04/02/2026) */

function $(sel) { return document.querySelector(sel); }

async function apiJson(url, opts) {
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => null);
  if (!data || data.ok !== true) throw new Error((data && data.error) ? data.error : `Request failed: ${url}`);
  return data;
}

function setNetDot() {
  const dot = $('#netDot');
  if (!dot) return;
  dot.classList.toggle('online', navigator.onLine);
  dot.title = navigator.onLine ? 'Online' : 'Offline';
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));
}

function parseIssueDate(issue){
  const v = issue.created_at || issue.created || issue.createdAt || issue.ts;
  if (!v) return 0;
  if (typeof v === 'string' && v.indexOf('/') !== -1) {
    const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}`).getTime();
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function setupLazyImages(container){
  if(!container || !('IntersectionObserver' in window)) return;
  const imgs = Array.from(container.querySelectorAll('img[data-src]'));
  if(!imgs.length) return;
  const obs = new IntersectionObserver((entries)=>{
    entries.forEach((entry)=>{
      if(entry.isIntersecting){
        const img = entry.target;
        img.src = img.dataset.src;
        img.removeAttribute('data-src');
        obs.unobserve(img);
      }
    });
  }, { root: container, rootMargin: '80px' });
  imgs.forEach(img => obs.observe(img));
}

// Simple toast helper
function showToast(msg, timeout=2200){
  let stack = document.getElementById('toastStack');
  if(!stack){
    stack = document.createElement('div');
    stack.id = 'toastStack';
    stack.setAttribute('role','status');
    stack.setAttribute('aria-live','polite');
    stack.style.position = 'fixed';
    stack.style.right = '20px';
    stack.style.bottom = '20px';
    stack.style.zIndex = 999999;
    stack.style.display = 'flex';
    stack.style.flexDirection = 'column';
    stack.style.gap = '8px';
    stack.style.pointerEvents = 'none';
    document.body.appendChild(stack);
  }
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.background='rgba(0,0,0,0.8)';
  el.style.color='#fff';
  el.style.padding='10px 14px';
  el.style.borderRadius='8px';
  el.style.boxShadow='0 6px 18px rgba(0,0,0,.4)';
  el.style.pointerEvents = 'auto';
  stack.appendChild(el);
  // keep stack small
  while (stack.children.length > 3) {
    try{ stack.removeChild(stack.firstChild); }catch(e){ break; }
  }
  const timer = setTimeout(()=>{ try{ el.remove(); }catch(e){} }, timeout);
  el.addEventListener('click', ()=>{ clearTimeout(timer); try{ el.remove(); }catch(e){} });
  return el;
}

// Spinner helpers (adds/removes a small spinner element inside a button)
function addSpinner(btn){ if(!btn) return; if(!btn.querySelector('.spinner')){ const s=document.createElement('span'); s.className='spinner'; btn.appendChild(s); } btn.setAttribute('aria-busy','true'); }
function removeSpinner(btn){ if(!btn) return; const s = btn.querySelector('.spinner'); if(s) s.remove(); btn.removeAttribute('aria-busy'); }

function planRow(plan) {
  const li = document.createElement('div');
  li.className = 'planRow';
  li.setAttribute('role','listitem');

  const left = document.createElement('div');
  left.className = 'planMeta';
  left.innerHTML = `
    <div class="planName">${escapeHtml(plan.name || ('Plan #' + plan.id))}</div>
    <div class="planSub">${escapeHtml(plan.revision || '')} <span class="muted">#${plan.id}</span></div>
  `;

  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.textContent = 'Open';
  btn.type = 'button';
  btn.onclick = async () => {
    if (window.openPlanInApp) {
      await window.openPlanInApp(plan.id);
    } else {
      alert('Viewer not loaded');
    }
  };

  const del = document.createElement('button');
  del.className = 'btn';
  del.textContent = 'Delete';
  del.type = 'button';
  del.style.borderColor = 'rgba(255,80,80,.28)';
  del.style.color = '#ff7b7b';
  del.onclick = async () => {
    if (!confirm(`Move plan "${plan.name || ('Plan ' + plan.id)}" to trash? This will remove the plan and ALL its issues, photos and generated exports from the app, but files will be kept in storage/trash. This action cannot be undone from the UI. Continue?`)) return; 
    try{
      del.disabled = true;
      const r = await fetch('/api/delete_plan.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: plan.id }), credentials: 'same-origin' });
      const txt = await r.text(); let data; try{ data = JSON.parse(txt); }catch(e){ data = null; }
      if(!r.ok || !data || !data.ok) throw new Error((data && data.error) ? data.error : ('Delete failed (HTTP ' + r.status + ')'));
      showToast('Deleted plan');
      await refreshPlans();
    }catch(err){ showToast('Delete error: ' + (err.message || err)); console.error('delete plan', err); }
    del.disabled = false;
  };

  const rightWrap = document.createElement('div');
  rightWrap.style.display = 'flex';
  rightWrap.style.gap = '8px';
  rightWrap.appendChild(btn);
  const showDelete = $('#plansList').dataset.showDelete === 'true';
  if (showDelete) rightWrap.appendChild(del);

  li.appendChild(left);
  li.appendChild(rightWrap);
  return li;
}

async function refreshPlans() {
  const box = $('#plansList');
  if (!box) return;
  box.setAttribute('aria-busy', 'true');
  box.innerHTML = '<div class="muted">Loading plans…</div>';

  try {
    const data = await apiJson('/api/list_plans.php');
    box.innerHTML = '';
    const plansSearchEl = $('#plansSearch');
    const search = ((plansSearchEl && plansSearchEl.value) || '').trim().toLowerCase();
    const plans = (data.plans || []).filter(p => {
      if (!search) return true;
      const name = `${p.name || ''} ${p.revision || ''} ${p.id || ''}`.toLowerCase();
      return name.includes(search);
    });
    if (!plans.length) {
      box.innerHTML = data.plans.length ? '<div class="muted">No plans match your search.</div>' : '<div class="muted">No plans yet. Upload one.</div>';
      box.setAttribute('aria-busy', 'false');
      return;
    }
    plans.forEach(p => box.appendChild(planRow(p)));
    box.setAttribute('aria-busy', 'false');
  } catch (e) {
    box.innerHTML = `<div class="error">Failed to load plans: ${escapeHtml(e.message)}</div>`;
    box.setAttribute('aria-busy', 'false');
  }
}
window.refreshPlans = refreshPlans;

async function wireUpload() {
  const form = $('#uploadForm');
  const out = $('#uploadOut');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; addSpinner(submitBtn); }
    if (!navigator.onLine) {
      showToast('You are offline — upload may fail');
    }
    out.textContent = 'Uploading…';

    const fd = new FormData(form);
    const r = await fetch('/api/upload_plan.php', { method: 'POST', body: fd });
    const txt = await r.text();
    let data;
    try { data = JSON.parse(txt); } catch (e) { data = { ok:false, error: txt }; }

    if (!r.ok || !data.ok) {
      out.textContent = `Upload failed (HTTP ${r.status}): ${data.error || 'Unknown error'}`;
      if (submitBtn) { removeSpinner(submitBtn); submitBtn.disabled = false; }
      return;
    }

    out.textContent = `Uploaded: ${(data.plan && data.plan.name) || 'OK'}`;
    form.reset();
    await refreshPlans();
    showPlansList(); // reset to list view after upload
    if (submitBtn) { removeSpinner(submitBtn); submitBtn.disabled = false; }
  });
}

function showPlansList() {
  const form = $('#uploadForm');
  const fields = $('#uploadFields');
  const list = $('#plansList');
  const btn = $('#btnPlans');
  if (form) form.style.display = 'block';
  if (fields) fields.style.display = 'none';
  if (list) {
    list.style.display = 'block';
    list.dataset.showDelete = 'false';
  }
  if (btn) btn.textContent = 'Upload Plan';
}

function showUploadForm() {
  const form = $('#uploadForm');
  const fields = $('#uploadFields');
  const list = $('#plansList');
  const btn = $('#btnPlans');
  if (form) form.style.display = 'block';
  if (fields) fields.style.display = 'block';
  if (list) {
    list.style.display = 'block';
    list.dataset.showDelete = 'true';
  }
  if (btn) btn.textContent = 'Back to Plans';
}


async function renderPlansScreen() {
  setNetDot();
  let lastOnline = navigator.onLine;
  const handleNetChange = ()=>{
    setNetDot();
    const nowOnline = navigator.onLine;
    if (nowOnline !== lastOnline) {
      if (nowOnline) showToast('Back online');
      else showToast('Offline — changes will sync when online');
      lastOnline = nowOnline;
    }
  };
  window.addEventListener('online', handleNetChange);
  window.addEventListener('offline', handleNetChange);

  const menuBtn = $('#menuBtn');
  if (menuBtn) menuBtn.onclick = () => document.body.classList.toggle('sidebar-open');
  await wireUpload();
  await refreshPlans();
  const plansSearch = $('#plansSearch');
  if (plansSearch) {
    let searchTimer = null;
    plansSearch.oninput = () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(refreshPlans, 220);
    };
  }
  // wire trash button
  const trashBtn = document.getElementById('btnTrash');
  if (trashBtn) trashBtn.onclick = async ()=>{ showTrashModal(); };
  // wire plans button
  const plansBtn = document.getElementById('btnPlans');
  if (plansBtn) {
    plansBtn.onclick = async () => {
      const fields = $('#uploadFields');
      if (fields && fields.style.display === 'none') {
        showUploadForm();
        await refreshPlans();
      } else {
        showPlansList();
        await refreshPlans();
      }
    };
  }
  showPlansList(); // ensure initial state
}
window.renderPlansScreen = renderPlansScreen;

// --- Trash Modal Logic ---
function showTrashModal(){
  const modalId = 'trashModal';
  let modal = document.getElementById(modalId);
  if(!modal){
    modal = document.createElement('div'); modal.id = modalId; modal.className='modal';
    modal.innerHTML = `<div class="modal-content"><span class="close" id="closeTrashModal">&times;</span><h2>Trash</h2><div id="trashList">Loading…</div></div>`;
    document.body.appendChild(modal);
    document.getElementById('closeTrashModal').onclick = ()=>{ modal.style.display='none'; };
  }
  modal.style.display = 'block';
  const list = modal.querySelector('#trashList'); list.innerHTML = 'Loading…';
  (async ()=>{
    try{
      const res = await fetch('/api/list_trash.php');
      const txt = await res.text(); const data = JSON.parse(txt);
      if(!res.ok || !data.ok) throw new Error(data.error||'Failed to list trash');
      if(!data.trash.length){ list.innerHTML = '<div class="muted">Trash is empty</div>'; return; }
      list.innerHTML = '';
      for(const t of data.trash){
        const card = document.createElement('div'); card.className='card'; card.style.marginBottom='8px';
        const hdr = document.createElement('div'); hdr.style.display='flex'; hdr.style.justifyContent='space-between'; hdr.style.alignItems='center';
        const left = document.createElement('div'); left.innerHTML = `<div style="font-weight:800;">${escapeHtml(t.dir)}</div><div class="muted">${escapeHtml(t.manifest ? ((t.manifest.plan && t.manifest.plan.name) || ('Plan ' + (t.manifest.plan_id || ''))) : '')}</div>`;
        const right = document.createElement('div'); right.style.display='flex'; right.style.gap='8px';
        const restoreBtn = document.createElement('button'); restoreBtn.className='btn'; restoreBtn.textContent='Restore'; restoreBtn.onclick = async ()=>{
          if(!confirm('Restore this trash entry? This will move files back and attempt to recreate DB rows (plans/issues/photos).')) return;
          restoreBtn.disabled = true; try{ const r2 = await fetch('/api/restore_trash.php', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ trash: t.dir }) }); const txt2 = await r2.text(); const j2 = JSON.parse(txt2); if(!r2.ok || !j2.ok) throw new Error(j2.error||'Restore failed'); showToast('Restored: '+ (j2.results.restored || []).length + ' files'); modal.style.display='none'; await refreshPlans(); }catch(e){ showToast('Restore error: ' + e.message); console.error(e); } restoreBtn.disabled = false; };
        const purgeBtn = document.createElement('button'); purgeBtn.className='btn'; purgeBtn.textContent='Delete permanently'; purgeBtn.onclick = async ()=>{
          if(!confirm('Permanently delete this trash folder and all files inside? This action cannot be undone.')) return;
          purgeBtn.disabled = true; try{ const r3 = await fetch('/api/purge_trash.php',{method:'POST',headers:{'Content-Type':'application/json'},body: JSON.stringify({ trash: t.dir })}); const txt3 = await r3.text(); const j3 = JSON.parse(txt3); if(!r3.ok || !j3.ok) throw new Error(j3.error||'Purge failed'); showToast('Trash folder deleted'); modal.style.display='none'; }catch(e){ showToast('Delete error: ' + e.message); console.error(e); } purgeBtn.disabled = false; };
        right.appendChild(restoreBtn); right.appendChild(purgeBtn);
        hdr.appendChild(left); hdr.appendChild(right); card.appendChild(hdr);
        // file list
        const fl = document.createElement('div'); fl.style.marginTop='8px';
        for(const f of t.files){ const fi = document.createElement('div'); fi.textContent = `${f.name} (${Math.round(f.size/1024)} KB)`; fl.appendChild(fi); }
        card.appendChild(fl);
        list.appendChild(card);
      }
    }catch(e){ list.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`; }
  })();
}


// --- Issues Modal Logic ---
function showIssuesModal(planId) {
  const modal = document.getElementById('issuesModal');
  const closeBtn = document.getElementById('closeIssuesModal');
  const issuesList = document.getElementById('issuesList');
  const pdfBtn = document.getElementById('btnGeneratePdf');
  const downloadBtn = document.getElementById('btnDownloadPdf');
  const pdfOut = document.getElementById('pdfReportOut');
  const modalTitle = modal ? modal.querySelector('h2') : null;
  const searchInput = document.getElementById('issuesSearch');
  const assigneeFilter = document.getElementById('issuesAssigneeFilter');
  const sortSelect = document.getElementById('issuesSort');
  const statusFilter = document.getElementById('issuesStatusFilter');
  const priorityFilter = document.getElementById('issuesPriorityFilter');
  const addIssueBtn = document.getElementById('issuesAddBtn');
  const selectAll = document.getElementById('issuesSelectAll');
  const exportSelectedBtn = document.getElementById('issuesExportSelected');
  const selectedCount = document.getElementById('issuesSelectedCount');
  const compactToggle = document.getElementById('issuesCompactToggle');
  const recentBox = document.getElementById('recentIssues');
  if (!modal || !issuesList || !pdfBtn || !pdfOut) return;
  const selectedIds = modal._selectedIds || new Set();
  modal._selectedIds = selectedIds;
  let outsideClickHandler = null;
  let filterTimer = null;
  const cleanupModal = () => {
    if (modal._selectCloseHandler) {
      document.removeEventListener('click', modal._selectCloseHandler);
      modal._selectCloseHandler = null;
      modal._selectCloseBound = false;
    }
  };

  // Ensure close button is visible so the modal can be dismissed
  if (closeBtn) closeBtn.style.display = '';

  modal.style.display = 'block';
  issuesList.innerHTML = '<div class="muted">Loading…</div>';
  pdfOut.textContent = '';
  if (addIssueBtn) {
    addIssueBtn.onclick = ()=>{ try{ modal.style.display='none'; const add = document.getElementById('btnAddIssueMode'); if(add) add.click(); }catch(e){} };
  }
  const updateSelectedUi = ()=>{
    if (selectedCount) selectedCount.textContent = `${selectedIds.size} selected`;
    if (exportSelectedBtn) exportSelectedBtn.disabled = selectedIds.size === 0;
  };
  updateSelectedUi();
  if (sortSelect) {
    const savedSort = localStorage.getItem('issues_sort') || 'manual';
    sortSelect.value = savedSort;
    sortSelect.onchange = ()=>{ localStorage.setItem('issues_sort', sortSelect.value); loadIssuesList(); };
  }
  if (selectAll) {
    selectAll.onchange = ()=>{ 
      const checks = issuesList.querySelectorAll('input.issueSelect');
      checks.forEach(ch=>{ ch.checked = selectAll.checked; if (ch.checked) selectedIds.add(ch.value); else selectedIds.delete(ch.value); });
      updateSelectedUi();
    };
  }
  if (exportSelectedBtn) {
    exportSelectedBtn.onclick = async ()=>{
      if (selectedIds.size === 0) return;
      exportSelectedBtn.disabled = true; addSpinner(exportSelectedBtn);
      try{
        const ids = Array.from(selectedIds);
        const body = new URLSearchParams();
        body.set('plan_id', String(planId));
        body.set('issue_ids', ids.join(','));
        const chk = document.getElementById('chkIncludePin');
        body.set('include_pin', (chk && chk.checked) ? '1' : '0');
        const r = await fetch('/api/export_report.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
        const data = await r.json();
        if (!r.ok || !data || !data.ok) throw new Error((data && data.error) ? data.error : 'Export failed');
        const url = '/storage/exports/' + encodeURIComponent(data.filename);
        const a = document.createElement('a'); a.href = url; a.download = data.filename; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
        pdfOut.textContent = 'Ready: ' + data.filename;
      }catch(e){ showToast('Export failed: ' + e.message); }
      removeSpinner(exportSelectedBtn); exportSelectedBtn.disabled = false;
    };
  }
  if (compactToggle) {
    compactToggle.checked = localStorage.getItem('issues_compact') === '1';
    compactToggle.onchange = ()=>{ 
      localStorage.setItem('issues_compact', compactToggle.checked ? '1' : '0');
      issuesList.classList.toggle('compact', compactToggle.checked);
    };
    issuesList.classList.toggle('compact', compactToggle.checked);
  }
  if (downloadBtn) { downloadBtn.style.display = 'none'; downloadBtn.disabled = true; downloadBtn.onclick = null; }
  // Wire full-plan export button
  if (pdfBtn) {
    pdfBtn.onclick = async () => {
      // hide/disable existing download button while generating
      if (downloadBtn) { downloadBtn.style.display = 'none'; downloadBtn.disabled = true; downloadBtn.onclick = null; }
      pdfBtn.disabled = true; addSpinner(pdfBtn);
      pdfOut.textContent = 'Generating PDF…';
      try{
        const chk = document.getElementById('chkIncludePin');
      const includePinParam = (chk && chk.checked) ? '&include_pin=1' : '&include_pin=0';
      const r = await fetch('/api/export_report.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `plan_id=${encodeURIComponent(planId)}${includePinParam}` });
        let data = null;
        try{ data = await r.json(); }catch(parseErr){ const txt = await r.text().catch(()=>null); console.error('export parse error, response text:', txt, parseErr); throw new Error(txt || 'Export failed (invalid JSON)'); }
        if (!r.ok || !data || !data.ok) { console.error('Export error response', r.status, data); throw new Error((data && data.error) ? data.error : (`Export failed (HTTP ${r.status})`)); }
        // show download button to the right of generate
        if (downloadBtn) {
          downloadBtn.textContent = 'Download PDF';
          downloadBtn.style.display = '';
          downloadBtn.disabled = false;
          const url = '/storage/exports/' + encodeURIComponent(data.filename);
          downloadBtn.onclick = () => { const w = window.open(url, '_blank', 'noopener'); if (w) w.opener = null; };
          pdfOut.textContent = 'Ready: ' + data.filename;
        } else {
          pdfOut.innerHTML = `<a href="/storage/exports/${encodeURIComponent(data.filename)}" target="_blank" rel="noopener">Download PDF Report</a>`;
        }
      }catch(e){ console.error('Export failed', e); pdfOut.textContent = e.message || 'Export failed';
        // Try debug retry to get more server-side info
        try{
          const dbg = await fetch('/api/export_report.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `plan_id=${encodeURIComponent(planId)}&debug=1` });
          const dbgJson = await dbg.json().catch(()=>null);
          if(dbgJson && dbgJson.error) pdfOut.textContent += ' — Debug: ' + dbgJson.error;
          else if(dbgJson && dbgJson.exports) pdfOut.textContent += ' — Debug: ' + JSON.stringify(dbgJson.exports.slice(0,5));
        }catch(_){ /* ignore */ }
      }
      removeSpinner(pdfBtn); pdfBtn.disabled = false;
    };
  }

  // fetch plan details to show in modal title
  (async ()=>{
    try{
      const data = await apiJson('/api/get_plan.php?plan_id=' + encodeURIComponent(planId));
      const plan = data.plan || {};
      const planLabel = `${plan.name || ('Plan ' + planId)} (#${planId})`;
      if (modalTitle) {
        modalTitle.textContent = `Issues for: ${planLabel}`;
      }
      // ensure the trigger button shows text (regression guard)
      const trigger = document.getElementById('btnViewIssues');
      if (trigger && !trigger.textContent.trim()) trigger.textContent = 'View Issues';
    }catch(e){ /* ignore */ }
  })();

  // helper to load and render issues list (used initially and on photo updates)
  async function loadIssuesList(force){
    issuesList.setAttribute('aria-busy', 'true');
    issuesList.innerHTML = '<div class="muted">Loading…</div>';
    try{
      let allIssues = null;
      const cachedIssues = modal._issuesCache;
      if (!force && cachedIssues && cachedIssues.planId === planId) {
        allIssues = cachedIssues.items;
      }
      if (force || !allIssues) {
        const res = await fetch(`/api/list_issues.php?plan_id=${encodeURIComponent(planId)}`);
        const data = await res.json();
        if(!data.ok) throw new Error(data.error || 'Failed to load issues');
        allIssues = Array.isArray(data.issues) ? data.issues.slice() : [];
        modal._issuesCache = { planId, items: allIssues };
      }
      const q = (searchInput && searchInput.value || '').trim().toLowerCase();
      const aVal = (assigneeFilter && assigneeFilter.value || '').trim().toLowerCase();
      const sVal = statusFilter ? statusFilter.value : '';
      const pVal = priorityFilter ? priorityFilter.value : '';
      const sortMode = sortSelect ? sortSelect.value : 'manual';
      let filtered = allIssues.filter(i=>{
        if (sVal && String(i.status||'') !== sVal) return false;
        if (pVal && String(i.priority||'') !== pVal) return false;
        if (aVal) {
          const assignee = (i.assigned_to || i.assignee || '').toLowerCase();
          if (!assignee.includes(aVal)) return false;
        }
        if (q) {
          const hay = `${i.title||''} ${i.notes||i.description||''} ${i.id||''} ${i.assigned_to||i.assignee||''} ${i.due_date||''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      const orderKey = `issues_order_${planId}`;
      const savedOrder = (localStorage.getItem(orderKey) || '').split(',').map(v => v.trim()).filter(Boolean);
      if (sortMode === 'newest') {
        filtered.sort((a, b) => parseIssueDate(b) - parseIssueDate(a));
      } else if (sortMode === 'oldest') {
        filtered.sort((a, b) => parseIssueDate(a) - parseIssueDate(b));
      } else if (savedOrder.length) {
        const orderMap = new Map(savedOrder.map((id, idx) => [id, idx]));
        filtered.sort((a, b) => {
          const aKey = orderMap.has(String(a.id)) ? orderMap.get(String(a.id)) : Number.POSITIVE_INFINITY;
          const bKey = orderMap.has(String(b.id)) ? orderMap.get(String(b.id)) : Number.POSITIVE_INFINITY;
          if (aKey !== bKey) return aKey - bKey;
          return parseIssueDate(a) - parseIssueDate(b);
        });
      }
      // recent issues (top 3 by date)
      if (recentBox) {
        const recent = allIssues.slice().sort((a,b)=> parseIssueDate(b) - parseIssueDate(a)).slice(0,3);
        if (recent.length) {
          recentBox.style.display = '';
          recentBox.innerHTML = '';
          for (const r of recent) {
            const card = document.createElement('div'); card.className='recentIssueCard';
            const left = document.createElement('div');
            left.innerHTML = `<div class="recentIssueTitle">${escapeHtml(r.title || ('Issue #' + r.id))}</div><div class="recentIssueMeta">Page ${escapeHtml(String(r.page||''))}</div>`;
            const btn = document.createElement('button'); btn.className='btn'; btn.textContent='Jump';
            btn.onclick = ()=>{ const go = ()=>{ if(window.viewerJumpToIssue) window.viewerJumpToIssue(r); }; if(window.startViewer) window.startViewer().then(go).catch(()=>go()); else go(); };
            card.appendChild(left); card.appendChild(btn);
            recentBox.appendChild(card);
          }
        } else {
          recentBox.style.display = 'none';
        }
      }
      if(!filtered.length){
        const hasFilters = Boolean(q || aVal || sVal || pVal);
        issuesList.innerHTML = `
          <div class="card" style="display:flex;flex-direction:column;gap:10px;align-items:flex-start;">
            <div style="font-weight:800;">${hasFilters ? 'No matching issues' : 'No issues yet'}</div>
            <div class="muted">${hasFilters ? 'Try clearing filters or search terms.' : 'Tap Add Issue mode, then long‑press on the plan to drop your first pin.'}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button id="issuesEmptyAdd" class="btnPrimary" type="button">Add Issue</button>
              <button id="issuesEmptyClose" class="btn" type="button">Close</button>
            </div>
          </div>
        `;
        const addBtn = document.getElementById('issuesEmptyAdd');
        const closeEmpty = document.getElementById('issuesEmptyClose');
        if (addBtn) addBtn.onclick = ()=>{ try{ modal.style.display='none'; const add = document.getElementById('btnAddIssueMode'); if(add) add.click(); }catch(e){} };
        if (closeEmpty) closeEmpty.onclick = ()=>{ modal.style.display='none'; };
        issuesList.setAttribute('aria-busy', 'false');
        return;
      }
      // prefetch photos for thumbnails/counts (cache per modal/session)
      let photosMap = {};
      const cached = modal._photosCache;
      if (cached && cached.planId === planId) {
        photosMap = cached.map || {};
      } else {
        try{
          const prs = await fetch(`/api/list_photos.php?plan_id=${encodeURIComponent(planId)}`);
          const pjson = await prs.json().catch(()=>null);
          if(pjson && pjson.ok && Array.isArray(pjson.photos)){
            for(const ph of pjson.photos){ const key = String(ph.issue_id||''); photosMap[key] = photosMap[key] || []; photosMap[key].push(ph); }
          }
        }catch(e){ /* ignore */ }
        modal._photosCache = { planId, map: photosMap };
      }
      // build enhanced list
      issuesList.innerHTML = '';
      const container = document.createElement('div');
      container.style.display = 'flex'; container.style.flexDirection = 'column'; container.style.gap = '8px';
      for (const issue of filtered) {
        const item = document.createElement('div'); item.className = 'card issueCard'; item.dataset.issueId = String(issue.id||''); item.setAttribute('role','listitem');
        item.dataset.status = (issue.status || 'Open');
        item.dataset.priority = (issue.priority || 'Medium');
        item.dataset.category = (issue.category || 'Other');
        const header = document.createElement('div'); header.className = 'issueHeader';
        const titleWrap = document.createElement('div'); titleWrap.className = 'issueTitleWrap';
        const selectWrap = document.createElement('label'); selectWrap.className = 'issueSelectWrap';
        const selectBox = document.createElement('input'); selectBox.type='checkbox'; selectBox.className='issueSelect'; selectBox.value = String(issue.id||'');
        selectBox.checked = selectedIds.has(selectBox.value);
        selectBox.onchange = ()=>{ if(selectBox.checked) selectedIds.add(selectBox.value); else selectedIds.delete(selectBox.value); updateSelectedUi(); };
        selectWrap.appendChild(selectBox);
        const dragHandle = document.createElement('button'); dragHandle.className='issueDragHandle'; dragHandle.type='button'; dragHandle.textContent='⋮⋮';
        const title = document.createElement('div'); title.className = 'issueTitleText'; title.textContent = issue.title || ('Issue #' + issue.id);
        const sub = document.createElement('div'); sub.className = 'issueSubText';
        sub.textContent = `#${issue.id || ''} · Page ${issue.page || ''}`;
        titleWrap.appendChild(title); titleWrap.appendChild(sub);
        const badges = document.createElement('div'); badges.className = 'issueBadges';
        // Create custom-styled select widgets (neon / customSelect) so dropdown list is styled consistently
        function normalizeSelectValue(val, opts){
          if (!val) return (opts[0] && opts[0].value) || '';
          const raw = String(val).trim();
          const norm = raw.toLowerCase().replace(/[_\s]+/g, ' ');
          const match = opts.find(o => String(o.value).toLowerCase().replace(/[_\s]+/g, ' ') === norm)
            || opts.find(o => String(o.label).toLowerCase().replace(/[_\s]+/g, ' ') === norm);
          return (match && match.value) || (opts[0] && opts[0].value) || raw;
        }
        function createCustomSelect(opts, val, extraClass){
          const wrap = document.createElement('div'); wrap.className = (extraClass ? extraClass + ' ' : '') + 'customSelect neonSelect';
          wrap.tabIndex = 0; wrap.setAttribute('role','combobox');
          const btn = document.createElement('button'); btn.className = 'selectButton'; btn.setAttribute('aria-label','Select'); btn.innerHTML = '<span class="selectedLabel"></span>';
          const ul = document.createElement('ul'); ul.className = 'selectList'; ul.setAttribute('role','listbox'); ul.tabIndex = -1;
          for(const o of opts){ const li = document.createElement('li'); li.setAttribute('role','option'); li.dataset.value = o.value; li.textContent = o.label; if(o.value===val) li.setAttribute('aria-selected','true'); ul.appendChild(li); }
          wrap.appendChild(btn); wrap.appendChild(ul);
          // hidden value storage
          wrap.value = normalizeSelectValue(val, opts);
          const setSelected = (v)=>{ const sel = Array.from(ul.children).find(li=>li.dataset.value==v); if(sel){ wrap.querySelector('.selectedLabel').textContent = sel.textContent; wrap.value = v; ul.querySelectorAll('li').forEach(li=> li.setAttribute('aria-selected', li.dataset.value==v ? 'true' : 'false')); }};
          const labelEl = wrap.querySelector('.selectedLabel'); labelEl.style.color = '#041013'; labelEl.style.fontWeight = '900';
          btn.style.color = '#041013';
          setSelected(wrap.value);
          btn.onclick = (e)=>{ e.stopPropagation(); const open = ul.classList.toggle('open'); wrap.setAttribute('aria-expanded', open? 'true':'false'); if(open) ul.focus(); };
          ul.querySelectorAll('li').forEach(li=>{ li.tabIndex=0; li.onclick = (ev)=>{ ev.stopPropagation(); setSelected(li.dataset.value); ul.classList.remove('open'); wrap.setAttribute('aria-expanded','false'); wrap.dispatchEvent(new Event('change')); }; li.onkeydown = (ev)=>{ if(ev.key==='Enter' || ev.key===' '){ ev.preventDefault(); li.click(); } }; });
          wrap._closeList = ()=>{ ul.classList.remove('open'); wrap.setAttribute('aria-expanded','false'); };
          return wrap;
        }
        const statusSelect = createCustomSelect([
          {value:'Open',label:'Open'},{value:'In Progress',label:'In Progress'},{value:'Closed',label:'Closed'}
        ], issue.status || 'Open');
        statusSelect.style.minWidth='110px'; statusSelect.title='Status'; statusSelect.setAttribute('aria-label','Issue status');
        const prioSelect = createCustomSelect([
          {value:'Low',label:'Low'},{value:'Medium',label:'Medium'},{value:'High',label:'High'}
        ], issue.priority || 'Medium', 'small');
        prioSelect.style.minWidth='90px'; prioSelect.title='Priority'; prioSelect.setAttribute('aria-label','Issue priority');
        const scheduleQuickSave = (() => {
          let timer = null;
          return () => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(async () => {
              try{
                const payload = {
                  id: issue.id,
                  plan_id: planId,
                  title: issue.title,
                  notes: issue.notes,
                  page: issue.page,
                  x_norm: issue.x_norm,
                  y_norm: issue.y_norm,
                  status: statusSelect.value,
                  priority: prioSelect.value
                };
                const r = await fetch('/api/save_issue.php',{
                  method:'POST',
                  headers:{'Content-Type':'application/json'},
                  body: JSON.stringify(payload),
                  credentials:'same-origin'
                });
                const txt = await r.text();
                let resp; try{ resp = JSON.parse(txt); }catch(e){ resp = null; }
                if(!r.ok || !resp || !resp.ok) throw new Error((resp && resp.error) ? resp.error : 'Save failed');
                issue.status = statusSelect.value;
                issue.priority = prioSelect.value;
                showToast('Updated');
              }catch(err){
                showToast('Update failed: ' + err.message);
              }
            }, 550);
          };
        })();
        statusSelect.addEventListener('change', scheduleQuickSave);
        prioSelect.addEventListener('change', scheduleQuickSave);

        const catChip = document.createElement('span'); catChip.className='issueChip'; catChip.textContent = issue.category || 'Other';
        badges.appendChild(statusSelect); badges.appendChild(prioSelect); badges.appendChild(catChip);
        header.appendChild(selectWrap); header.appendChild(dragHandle); header.appendChild(titleWrap); header.appendChild(badges);

        const body = document.createElement('div'); body.className = 'issueBody';
        const notes = document.createElement('div'); notes.className = 'issueNotesText'; notes.textContent = issue.notes || issue.description || 'No notes';
        body.appendChild(notes);

        const meta = document.createElement('div'); meta.className = 'issueMetaRow';
        const createdDiv = document.createElement('div'); createdDiv.className = 'issueMetaItem';
        if (issue.created_at) { const val = issue.created_at; if (typeof val === 'string' && val.indexOf('/') !== -1) { createdDiv.textContent = val + (issue.created_by ? (' — ' + issue.created_by) : ''); }
          else { const d = new Date(val); const pad = (n) => n.toString().padStart(2,'0'); createdDiv.textContent = `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}` + (issue.created_by ? (' — ' + issue.created_by) : ''); } }
        else if (issue.created_by) { createdDiv.textContent = issue.created_by; }
        const assignee = document.createElement('div'); assignee.className = 'issueMetaItem';
        const assigneeVal = issue.assigned_to || issue.assignee || '';
        assignee.textContent = assigneeVal ? ('Assignee: ' + assigneeVal) : 'Unassigned';
        const due = document.createElement('div'); due.className = 'issueMetaItem';
        due.textContent = issue.due_date ? ('Due: ' + issue.due_date) : '';
        meta.appendChild(createdDiv); meta.appendChild(assignee);
        if (issue.due_date) meta.appendChild(due);
        body.appendChild(meta);

        const previews = document.createElement('div'); previews.className = 'issuePreviews';
        const phs = photosMap[String(issue.id)] || [];
        const countBadge = document.createElement('span'); countBadge.className='pill issuePhotoCount'; countBadge.textContent = String(phs.length) + ' photos';
        const thumbsWrap = document.createElement('div'); thumbsWrap.className = 'issueThumbs';
        if(phs.length){
          for(let i=0;i<Math.min(4, phs.length); i++){
            const p = phs[i];
            const img = document.createElement('img');
            img.dataset.src = p.thumb_url || p.url;
            img.alt = 'Issue photo';
            img.loading = 'lazy';
            img.onclick = ()=>{ const w = window.open(p.url || p.thumb_url, '_blank', 'noopener'); if (w) w.opener = null; };
            thumbsWrap.appendChild(img);
          }
        }
        previews.appendChild(thumbsWrap);
        previews.appendChild(countBadge);

        const pinPreview = document.createElement('div'); pinPreview.className = 'issuePinPreview';
        const pinImg = document.createElement('img'); pinImg.alt = 'Pin preview'; pinImg.style.display = 'none'; pinImg.loading = 'lazy';
        pinImg.onerror = ()=>{ pinImg.style.display = 'none'; };
        pinImg.onclick = ()=>{
          if(!pinImg.src) return;
          let lb = document.getElementById('imageLightbox');
          if(!lb){
            lb = document.createElement('div'); lb.id = 'imageLightbox';
            lb.style.position='fixed'; lb.style.left=0; lb.style.top=0; lb.style.width='100%'; lb.style.height='100%';
            lb.style.background='rgba(0,0,0,0.85)'; lb.style.display='flex'; lb.style.alignItems='center'; lb.style.justifyContent='center'; lb.style.zIndex=200000; lb.onclick = ()=>{ lb.style.display='none'; };
            const imgEl = document.createElement('img'); imgEl.style.maxWidth='95%'; imgEl.style.maxHeight='95%'; imgEl.id='imageLightboxImg'; lb.appendChild(imgEl); document.body.appendChild(lb);
          }
          const imgEl = document.getElementById('imageLightboxImg'); imgEl.src = pinImg.src; document.getElementById('imageLightbox').style.display='flex';
        };
        pinPreview.appendChild(pinImg);
        previews.appendChild(pinPreview);
        body.appendChild(previews);

        // fetch pin preview
        (async ()=>{
          try{
            const u = '/api/render_pin.php?plan_id='+encodeURIComponent(planId)+'&issue_id='+encodeURIComponent(issue.id);
            const res = await fetch(u, {cache: 'no-store', credentials: 'same-origin'});
            if (res.ok && res.headers.get('Content-Type') && res.headers.get('Content-Type').includes('image')) {
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              pinImg.src = url;
              pinImg.onload = ()=>{ pinImg.style.display = ''; URL.revokeObjectURL(url); };
            }
          }catch(e){ /* ignore */ }
        })();

        const actions = document.createElement('div'); actions.className = 'issueActions';
        const primary = document.createElement('div'); primary.className = 'issueActionsPrimary';
        const secondary = document.createElement('div'); secondary.className = 'issueActionsSecondary';
        const viewBtn = document.createElement('button'); viewBtn.className='btnPrimary'; viewBtn.textContent='Open';
        viewBtn.onclick = ()=>{ try{ if(window.showIssueModal) window.showIssueModal(issue); else showToast('Viewer not loaded'); }catch(e){ console.error(e); showToast('Unable to open issue'); } };
        const jumpBtn = document.createElement('button'); jumpBtn.className='btn'; jumpBtn.textContent='Jump';
        jumpBtn.onclick = ()=>{ try{
          const u = new URL(window.location.href); u.searchParams.set('plan_id', String(planId)); history.pushState({},'',u.toString());
          if(window.startViewer){
            window.startViewer().then(()=>{
              if(window.viewerJumpToIssue) window.viewerJumpToIssue(issue);
              else if(window.viewerGoToPage) window.viewerGoToPage(Number(issue.page||1));
            });
          }
        }catch(e){ console.error(e); } };
        const exportBtn = document.createElement('button'); exportBtn.className='btn'; exportBtn.textContent='Export';
        exportBtn.onclick = async ()=>{
          exportBtn.disabled = true; addSpinner(exportBtn);
          if (downloadBtn) { downloadBtn.style.display = 'none'; downloadBtn.disabled = true; downloadBtn.onclick = null; }
          try{
            pdfOut.textContent = 'Generating PDF…';
            const chk2 = document.getElementById('chkIncludePin');
            const includePinParam2 = (chk2 && chk2.checked) ? '&include_pin=1' : '&include_pin=0';
            const r = await fetch('/api/export_report.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `plan_id=${encodeURIComponent(planId)}&issue_id=${encodeURIComponent(issue.id)}${includePinParam2}` });
            let data = null;
            try{ data = await r.json(); }catch(parseErr){ const txt = await r.text().catch(()=>null); console.error('export parse error, response text:', txt, parseErr); throw new Error(txt || 'Export failed (invalid JSON)'); }
            if (!r.ok || !data || !data.ok) throw new Error((data && data.error) ? data.error : (`Export failed (HTTP ${r.status})`));
            const url = '/storage/exports/' + encodeURIComponent(data.filename);
            const a = document.createElement('a'); a.href = url; a.download = data.filename; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
            pdfOut.textContent = 'Ready: ' + data.filename;
          }catch(e){
            console.error('Export failed', e); pdfOut.textContent = e.message || 'Export failed';
            try{
              const chk3 = document.getElementById('chkIncludePin');
              const includePinParam3 = (chk3 && chk3.checked) ? '&include_pin=1' : '&include_pin=0';
              const dbg = await fetch('/api/export_report.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `plan_id=${encodeURIComponent(planId)}&issue_id=${encodeURIComponent(issue.id)}&debug=1${includePinParam3}` });
              const dbgJson = await dbg.json().catch(()=>null);
              if(dbgJson && dbgJson.error) pdfOut.textContent += ' — Debug: ' + dbgJson.error;
              else if(dbgJson && dbgJson.exports) pdfOut.textContent += ' — Debug: ' + JSON.stringify(dbgJson.exports.slice(0,5));
            }catch(_){ /* ignore */ }
          }
          removeSpinner(exportBtn); exportBtn.disabled = false;
        };
        const delIssueBtn = document.createElement('button'); delIssueBtn.className='btn'; delIssueBtn.textContent='Delete';
        delIssueBtn.onclick = async ()=>{
          if(!confirm(`Delete issue "${issue.title || ('#' + issue.id)}"? This will remove it and its photos.`)) return;
          delIssueBtn.disabled = true;
          try{
            const res = await fetch('/api/delete_issue.php',{method:'POST',headers:{'Content-Type':'application/json'},body: JSON.stringify({ id: issue.id, plan_id: planId })});
            const txt = await res.text(); let data; try{ data = JSON.parse(txt); }catch(e){ data = null; }
            if(!res.ok || !data || !data.ok) throw new Error((data && data.error) ? data.error : ('Delete failed (HTTP ' + res.status + ')'));
            showToast('Issue deleted');
            await loadIssuesList();
            try{ document.dispatchEvent(new CustomEvent('issueDeleted',{detail:{issueId: issue.id}})); }catch(e){}
          }catch(err){ showToast('Delete error: ' + (err.message || err)); console.error('delete issue', err); }
          delIssueBtn.disabled = false;
        };
        const saveBtn = document.createElement('button'); saveBtn.className='btn'; saveBtn.textContent='Save';
        saveBtn.onclick = async ()=>{ saveBtn.disabled = true; try{ const payload = { id: issue.id, plan_id: planId, title: issue.title, notes: issue.notes, page: issue.page, x_norm: issue.x_norm, y_norm: issue.y_norm, status: statusSelect.value, priority: prioSelect.value }; const r = await fetch('/api/save_issue.php',{method:'POST',headers:{'Content-Type':'application/json'},body: JSON.stringify(payload), credentials:'same-origin'}); const txt = await r.text(); let resp; try{ resp = JSON.parse(txt); }catch(e){ resp = null; } if(!r.ok || !resp || !resp.ok) throw new Error((resp && resp.error) ? resp.error : 'Save failed'); showToast('Saved'); issue.status = statusSelect.value; issue.priority = prioSelect.value; }catch(err){ showToast('Save error: ' + err.message); } saveBtn.disabled = false; };
        primary.appendChild(viewBtn); primary.appendChild(jumpBtn);
        secondary.appendChild(exportBtn); secondary.appendChild(saveBtn); secondary.appendChild(delIssueBtn);
        actions.appendChild(primary); actions.appendChild(secondary);

        item.appendChild(header);
        item.appendChild(body);
        item.appendChild(actions);
        container.appendChild(item);
        item.addEventListener('click', (ev)=>{
          if (ev.target && ev.target.closest && (ev.target.closest('button') || ev.target.closest('.customSelect'))) return;
          const go = () => {
            if (window.viewerJumpToIssue) window.viewerJumpToIssue(issue);
            else if (window.viewerGoToPage) window.viewerGoToPage(Number(issue.page||1));
          };
          if (window.startViewer) window.startViewer().then(go).catch(()=>go());
          else go();
        });
        item.addEventListener('mouseenter', ()=>{
          if (window.viewerPreviewIssue) window.viewerPreviewIssue(issue);
        });
      }
      issuesList.appendChild(container);
      setupLazyImages(container);
      if (selectAll) {
        const checks = issuesList.querySelectorAll('input.issueSelect');
        selectAll.checked = checks.length > 0 && Array.from(checks).every(ch=>ch.checked);
      }
      // drag-reorder (touch + desktop)
      if (!container._dragBound) {
        container._dragBound = true;
        let dragging = null;
        let dropTarget = null;
        const clearDrop = ()=>{
          if (dropTarget) dropTarget.classList.remove('issueDropTarget');
          dropTarget = null;
        };
        const onMove = (ev)=>{
          if (!dragging) return;
          const el = document.elementFromPoint(ev.clientX, ev.clientY);
          const card = el && el.closest ? el.closest('.issueCard') : null;
          if (card && card !== dragging) {
            const rect = card.getBoundingClientRect();
            const before = (ev.clientY < rect.top + rect.height / 2);
            if (dropTarget && dropTarget !== card) dropTarget.classList.remove('issueDropTarget');
            dropTarget = card;
            dropTarget.classList.add('issueDropTarget');
            container.insertBefore(dragging, before ? card : card.nextSibling);
          }
        };
        const onUp = ()=>{
          if (!dragging) return;
          dragging.classList.remove('dragging');
          clearDrop();
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          const orderKey = `issues_order_${planId}`;
          const orderIds = Array.from(container.querySelectorAll('.issueCard')).map(card => card.dataset.issueId).filter(Boolean);
          if (orderIds.length) {
            localStorage.setItem(orderKey, orderIds.join(','));
            showToast('Issue order saved');
          }
          dragging = null;
        };
        container.addEventListener('pointerdown', (ev)=>{
          const handle = ev.target.closest && ev.target.closest('.issueDragHandle');
          if (!handle) return;
          if (handle.setPointerCapture) handle.setPointerCapture(ev.pointerId);
          dragging = handle.closest('.issueCard');
          if (!dragging) return;
          dragging.classList.add('dragging');
          document.addEventListener('pointermove', onMove);
          document.addEventListener('pointerup', onUp);
        });
      }
      issuesList.setAttribute('aria-busy', 'false');
    }catch(e){ issuesList.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`; issuesList.setAttribute('aria-busy', 'false'); }
  }
  if (!modal._filtersBound) {
    const triggerReload = ()=>{ loadIssuesList(); };
    const scheduleReload = ()=>{ if (filterTimer) clearTimeout(filterTimer); filterTimer = setTimeout(loadIssuesList, 220); };
    if (searchInput) searchInput.addEventListener('input', scheduleReload);
    if (assigneeFilter) assigneeFilter.addEventListener('input', scheduleReload);
    if (sortSelect) sortSelect.addEventListener('change', triggerReload);
    if (statusFilter) statusFilter.addEventListener('change', triggerReload);
    if (priorityFilter) priorityFilter.addEventListener('change', triggerReload);
    modal._filtersBound = true;
  }
  if (!modal._selectCloseBound) {
    const closeHandler = (ev)=>{
      if (!modal || modal.style.display !== 'block') return;
      if (ev && ev.target && ev.target.closest && ev.target.closest('.customSelect')) return;
      modal.querySelectorAll('.customSelect').forEach((wrap)=>{
        if (wrap && typeof wrap._closeList === 'function') wrap._closeList();
      });
    };
    modal._selectCloseHandler = closeHandler;
    document.addEventListener('click', closeHandler);
    modal._selectCloseBound = true;
  }
  // initial load
  loadIssuesList();
  // refresh thumbnails/counts when photosUpdated or issueUpdated event fires for this plan
  const photosListener = (ev)=>{ modal._photosCache = null; loadIssuesList(); };
  document.addEventListener('photosUpdated', photosListener);
  const issueUpdatedListener = (ev)=>{ modal._issuesCache = null; loadIssuesList(true); };
  document.addEventListener('issueUpdated', issueUpdatedListener);

  // allow closing with ESC key
  const escKeyHandler = (ev) => { if (ev.key === 'Escape') { modal.style.display = 'none'; issuesList.innerHTML = ''; pdfOut.textContent = ''; document.removeEventListener('photosUpdated', photosListener); document.removeEventListener('issueUpdated', issueUpdatedListener); document.removeEventListener('keydown', escKeyHandler); if (outsideClickHandler) window.removeEventListener('click', outsideClickHandler); cleanupModal(); } };
  document.addEventListener('keydown', escKeyHandler);

  // wire close button (X) to dismiss modal
  if (closeBtn){
    closeBtn.style.display = '';
    closeBtn.onclick = () => { modal.style.display = 'none'; issuesList.innerHTML = ''; pdfOut.textContent = ''; document.removeEventListener('photosUpdated', photosListener); document.removeEventListener('issueUpdated', issueUpdatedListener); document.removeEventListener('keydown', escKeyHandler); if (outsideClickHandler) window.removeEventListener('click', outsideClickHandler); cleanupModal(); };
  }
  // clicking outside modal content will also close
  outsideClickHandler = (event) => {
    if (event.target === modal) {
      modal.style.display = 'none';
      issuesList.innerHTML = '';
      pdfOut.textContent = '';
      document.removeEventListener('photosUpdated', photosListener);
      document.removeEventListener('issueUpdated', issueUpdatedListener);
      document.removeEventListener('keydown', escKeyHandler);
      window.removeEventListener('click', outsideClickHandler);
      cleanupModal();
    }
  };
  window.addEventListener('click', outsideClickHandler);
}


// Attach View Issues button logic after plan is opened
function wireViewIssues(planId) {
  const btn = document.getElementById('btnViewIssues');
  if (btn) {
    btn.onclick = () => showIssuesModal(planId);
  }
}

// Attempt to wrap the global `openPlanInApp` when it becomes available
(function waitAndWire(){
  function tryWrap(){
    if (window.openPlanInApp && !window.__viewIssuesPatched){
      const orig = window.openPlanInApp;
      window.openPlanInApp = async function(planId){
        await orig(planId);
        try { wireViewIssues(planId); } catch(e) { console.error('wireViewIssues error', e); }
      };
      window.__viewIssuesPatched = true;
      return true;
    }
    return false;
  }
  if (!tryWrap()){
    const iv = setInterval(()=>{ if (tryWrap()) clearInterval(iv); }, 200);
  }
})();

// Listen for planOpened events (fired by viewer) and wire View Issues button
document.addEventListener('planOpened', (e) => {
  try {
    const planId = (e && e.detail && e.detail.planId);
    if (planId) wireViewIssues(planId);
  } catch (err) { console.error('planOpened handler error', err); }
});
