


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
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));
}

// Simple toast helper
function showToast(msg, timeout=2200){
  try{
    if(window && window.__toast){ clearTimeout(window.__toast.timer); window.__toast.remove(); window.__toast = null; }
  }catch(e){}
  const el = document.createElement('div'); el.textContent = msg; el.style.position='fixed'; el.style.right='20px'; el.style.bottom='20px'; el.style.zIndex=999999; el.style.background='rgba(0,0,0,0.8)'; el.style.color='#fff'; el.style.padding='10px 14px'; el.style.borderRadius='8px'; el.style.boxShadow='0 6px 18px rgba(0,0,0,.4)'; document.body.appendChild(el); window.__toast = el; window.__toast.timer = setTimeout(()=>{ try{ el.remove(); window.__toast = null; }catch(e){} }, timeout);
  return el;
}

// Spinner helpers (adds/removes a small spinner element inside a button)
function addSpinner(btn){ if(!btn) return; if(!btn.querySelector('.spinner')){ const s=document.createElement('span'); s.className='spinner'; btn.appendChild(s); } btn.setAttribute('aria-busy','true'); }
function removeSpinner(btn){ if(!btn) return; const s = btn.querySelector('.spinner'); if(s) s.remove(); btn.removeAttribute('aria-busy'); }

function planRow(plan) {
  const li = document.createElement('div');
  li.className = 'planRow';

  const left = document.createElement('div');
  left.className = 'planMeta';
  left.innerHTML = `
    <div class="planName">${escapeHtml(plan.name || ('Plan #' + plan.id))}</div>
    <div class="planSub">${escapeHtml(plan.revision || '')} <span class="muted">#${plan.id}</span></div>
  `;

  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.textContent = 'Open';
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
  del.style.borderColor = 'rgba(255,80,80,.28)';
  del.style.color = '#ff7b7b';
  del.onclick = async () => {
    if (!confirm(`Move plan "${plan.name || ('Plan ' + plan.id)}" to trash? This will remove the plan and ALL its issues, photos and generated exports from the app, but files will be kept in storage/trash. This action cannot be undone from the UI. Continue?`)) return; 
    try{
      del.disabled = true;
      const r = await fetch('/api/delete_plan.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: plan.id }), credentials: 'same-origin' });
      const txt = await r.text(); let data; try{ data = JSON.parse(txt); }catch{ data = null; }
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
  rightWrap.appendChild(del);

  li.appendChild(left);
  li.appendChild(rightWrap);
  return li;
}

async function refreshPlans() {
  const box = $('#plansList');
  if (!box) return;
  box.innerHTML = '<div class="muted">Loading plans…</div>';

  try {
    const data = await apiJson('/api/list_plans.php');
    box.innerHTML = '';
    if (!data.plans.length) {
      box.innerHTML = '<div class="muted">No plans yet. Upload one.</div>';
      return;
    }
    data.plans.forEach(p => box.appendChild(planRow(p)));
  } catch (e) {
    box.innerHTML = `<div class="error">Failed to load plans: ${escapeHtml(e.message)}</div>`;
  }
}

async function wireUpload() {
  const form = $('#uploadForm');
  const out = $('#uploadOut');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    out.textContent = 'Uploading…';

    const fd = new FormData(form);
    const r = await fetch('/api/upload_plan.php', { method: 'POST', body: fd });
    const txt = await r.text();
    let data;
    try { data = JSON.parse(txt); } catch { data = { ok:false, error: txt }; }

    if (!r.ok || !data.ok) {
      out.textContent = `Upload failed (HTTP ${r.status}): ${data.error || 'Unknown error'}`;
      return;
    }

    out.textContent = `Uploaded: ${data.plan?.name || 'OK'}`;
    form.reset();
    await refreshPlans();
    showPlansList(); // reset to list view after upload
  });
}

function showPlansList() {
  const form = $('#uploadForm');
  const list = $('#plansList');
  const btn = $('#btnPlans');
  if (form) form.style.display = 'none';
  if (list) list.style.display = 'block';
  if (btn) btn.textContent = 'Upload Plan';
}

function showUploadForm() {
  const form = $('#uploadForm');
  const list = $('#plansList');
  const btn = $('#btnPlans');
  if (form) form.style.display = 'block';
  if (list) list.style.display = 'none';
  if (btn) btn.textContent = 'Back to Plans';
}


async function renderPlansScreen() {
  setNetDot();
  window.addEventListener('online', setNetDot);
  window.addEventListener('offline', setNetDot);

  const menuBtn = $('#menuBtn');
  if (menuBtn) menuBtn.onclick = () => document.body.classList.toggle('sidebar-open');
  await wireUpload();
  await refreshPlans();
  // wire trash button
  const trashBtn = document.getElementById('btnTrash');
  if (trashBtn) trashBtn.onclick = async ()=>{ showTrashModal(); };
  // wire plans button
  const plansBtn = document.getElementById('btnPlans');
  if (plansBtn) {
    plansBtn.onclick = () => {
      const form = $('#uploadForm');
      if (form && form.style.display === 'none') {
        showUploadForm();
      } else {
        showPlansList();
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
        const left = document.createElement('div'); left.innerHTML = `<div style="font-weight:800;">${escapeHtml(t.dir)}</div><div class="muted">${escapeHtml(t.manifest? (t.manifest.plan?.name||('Plan ' + (t.manifest.plan_id||''))) : '')}</div>`;
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
  if (!modal || !issuesList || !pdfBtn || !pdfOut) return;

  // Ensure close button is visible so the modal can be dismissed
  if (closeBtn) closeBtn.style.display = '';

  modal.style.display = 'block';
  issuesList.innerHTML = '<div class="muted">Loading…</div>';
  pdfOut.textContent = '';
  if (downloadBtn) { downloadBtn.style.display = 'none'; downloadBtn.disabled = true; downloadBtn.onclick = null; }
  // Wire full-plan export button
  if (pdfBtn) {
    pdfBtn.onclick = async () => {
      // hide/disable existing download button while generating
      if (downloadBtn) { downloadBtn.style.display = 'none'; downloadBtn.disabled = true; downloadBtn.onclick = null; }
      pdfBtn.disabled = true; addSpinner(pdfBtn);
      pdfOut.textContent = 'Generating PDF…';
      try{
        const r = await fetch('/api/export_report.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `plan_id=${encodeURIComponent(planId)}` });
        let data = null;
        try{ data = await r.json(); }catch(parseErr){ const txt = await r.text().catch(()=>null); console.error('export parse error, response text:', txt, parseErr); throw new Error(txt || 'Export failed (invalid JSON)'); }
        if (!r.ok || !data || !data.ok) { console.error('Export error response', r.status, data); throw new Error((data && data.error) ? data.error : (`Export failed (HTTP ${r.status})`)); }
        // show download button to the right of generate
        if (downloadBtn) {
          downloadBtn.textContent = 'Download PDF';
          downloadBtn.style.display = '';
          downloadBtn.disabled = false;
          const url = '/storage/exports/' + encodeURIComponent(data.filename);
          downloadBtn.onclick = () => { window.open(url, '_blank'); };
          pdfOut.textContent = 'Ready: ' + data.filename;
        } else {
          pdfOut.innerHTML = `<a href="/storage/exports/${encodeURIComponent(data.filename)}" target="_blank">Download PDF Report</a>`;
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
      if (modalTitle) modalTitle.textContent = `Issues for: ${plan.name || ('Plan ' + planId)} (#${planId})`;
    }catch(e){ /* ignore */ }
  })();

  // helper to load and render issues list (used initially and on photo updates)
  async function loadIssuesList(){
    issuesList.innerHTML = '<div class="muted">Loading…</div>';
    try{
      const res = await fetch(`/api/list_issues.php?plan_id=${encodeURIComponent(planId)}`);
      const data = await res.json();
      if(!data.ok) throw new Error(data.error || 'Failed to load issues');
      if(!data.issues.length){ issuesList.innerHTML = '<div class="muted">No issues for this plan.</div>'; return; }
      // prefetch photos for thumbnails/counts
      let photosMap = {};
      try{
        const prs = await fetch(`/api/list_photos.php?plan_id=${encodeURIComponent(planId)}`);
        const pjson = await prs.json().catch(()=>null);
        if(pjson && pjson.ok && Array.isArray(pjson.photos)){
          for(const ph of pjson.photos){ const key = String(ph.issue_id||''); photosMap[key] = photosMap[key] || []; photosMap[key].push(ph); }
        }
      }catch(e){ /* ignore */ }
      // build enhanced list
      issuesList.innerHTML = '';
      const container = document.createElement('div');
      container.style.display = 'flex'; container.style.flexDirection = 'column'; container.style.gap = '8px';
      for (const issue of data.issues) {
        const item = document.createElement('div'); item.className = 'card'; item.dataset.issueId = String(issue.id||'');
        item.style.display = 'flex'; item.style.alignItems = 'center'; item.style.justifyContent = 'space-between';
        const left = document.createElement('div'); left.style.flex = '1';
        left.innerHTML = `\n          <div style="font-weight:800;">${escapeHtml(issue.title || ('Issue #' + issue.id))}</div>\n          <div style="font-size:13px;color:var(--muted);margin-top:4px;">${escapeHtml(issue.notes||issue.description||'')}</div>\n          <div style="margin-top:6px;font-size:13px;color:var(--muted);">\n            <strong>ID:</strong> ${escapeHtml(String(issue.id||''))} &nbsp; \n            <strong>Page:</strong> ${escapeHtml(String(issue.page||''))} &nbsp; \n\n          </div>\n        `;
        const right = document.createElement('div'); right.style.display = 'flex'; right.style.flexDirection = 'column'; right.style.alignItems = 'flex-end'; right.style.gap = '6px'; right.style.flex = '0 0 260px'; right.style.minWidth = '220px';
        const metaRow = document.createElement('div'); metaRow.style.display = 'flex'; metaRow.style.gap = '8px'; metaRow.style.alignItems = 'center';
        // Create custom-styled select widgets (neon / customSelect) so dropdown list is styled consistently
        function createCustomSelect(opts, val, extraClass){
          const wrap = document.createElement('div'); wrap.className = (extraClass ? extraClass + ' ' : '') + 'customSelect neonSelect';
          wrap.tabIndex = 0; wrap.setAttribute('role','combobox');
          const btn = document.createElement('button'); btn.className = 'selectButton'; btn.setAttribute('aria-label','Select'); btn.innerHTML = '<span class="selectedLabel"></span>';
          const ul = document.createElement('ul'); ul.className = 'selectList'; ul.setAttribute('role','listbox');
          for(const o of opts){ const li = document.createElement('li'); li.setAttribute('role','option'); li.dataset.value = o.value; li.textContent = o.label; if(o.value===val) li.setAttribute('aria-selected','true'); ul.appendChild(li); }
          wrap.appendChild(btn); wrap.appendChild(ul);
          // hidden value storage
          wrap.value = val || (opts[0] && opts[0].value) || '';
          const setSelected = (v)=>{ const sel = Array.from(ul.children).find(li=>li.dataset.value==v); if(sel){ wrap.querySelector('.selectedLabel').textContent = sel.textContent; wrap.value = v; ul.querySelectorAll('li').forEach(li=> li.setAttribute('aria-selected', li.dataset.value==v ? 'true' : 'false')); }};
          setSelected(wrap.value);
          btn.onclick = (e)=>{ e.stopPropagation(); const open = ul.classList.toggle('open'); wrap.setAttribute('aria-expanded', open? 'true':'false'); if(open) ul.focus(); };
          ul.querySelectorAll('li').forEach(li=>{ li.tabIndex=0; li.onclick = (ev)=>{ ev.stopPropagation(); setSelected(li.dataset.value); ul.classList.remove('open'); wrap.setAttribute('aria-expanded','false'); wrap.dispatchEvent(new Event('change')); }; li.onkeydown = (ev)=>{ if(ev.key==='Enter' || ev.key===' '){ ev.preventDefault(); li.click(); } }; });
          document.addEventListener('click', (ev)=>{ if(!wrap.contains(ev.target)) { ul.classList.remove('open'); wrap.setAttribute('aria-expanded','false'); } });
          return wrap;
        }
        const statusSelect = createCustomSelect([
          {value:'open',label:'Open'},{value:'in_progress',label:'In Progress'},{value:'resolved',label:'Resolved'},{value:'closed',label:'Closed'}
        ], issue.status || 'open');
        statusSelect.style.minWidth='110px'; statusSelect.title='Status'; statusSelect.setAttribute('aria-label','Issue status');
        const prioSelect = createCustomSelect([
          {value:'low',label:'Low'},{value:'medium',label:'Medium'},{value:'high',label:'High'}
        ], issue.priority || 'medium', 'small');
        prioSelect.style.minWidth='90px'; prioSelect.title='Priority'; prioSelect.setAttribute('aria-label','Issue priority');

        metaRow.appendChild(statusSelect); metaRow.appendChild(prioSelect);
        const assigneeSpan = document.createElement('div'); assigneeSpan.style.fontSize='12px'; assigneeSpan.style.color='var(--muted)'; assigneeSpan.textContent = issue.assignee || '';
        const phs = photosMap[String(issue.id)] || [];
        if(phs.length){ const thumbsWrap = document.createElement('div'); thumbsWrap.style.display='flex'; thumbsWrap.style.gap='6px'; thumbsWrap.style.marginTop='6px'; for(let i=0;i<Math.min(3, phs.length); i++){ const p = phs[i]; const img = document.createElement('img'); img.src = p.thumb_url || p.url; img.style.width='48px'; img.style.height='48px'; img.style.objectFit='cover'; img.style.borderRadius='6px'; img.style.cursor='pointer'; img.onclick = ()=>{ window.open(p.url || p.thumb_url, '_blank'); }; thumbsWrap.appendChild(img); } const countBadge = document.createElement('span'); countBadge.className='pill'; countBadge.textContent = String(phs.length) + ' photos'; countBadge.style.fontSize='12px'; countBadge.style.marginLeft='6px'; left.appendChild(thumbsWrap); left.appendChild(countBadge); }
        const createdDiv = document.createElement('div'); createdDiv.style.fontSize = '12px'; createdDiv.style.color = 'var(--muted)'; if (issue.created_at) { const val = issue.created_at; // API may return UK formatted string 'd/m/Y H:i' or ISO; if string contains '/' assume UK and display as-is
        if (typeof val === 'string' && val.indexOf('/') !== -1) { createdDiv.textContent = val + (issue.created_by ? (' — ' + issue.created_by) : ''); }
        else { const d = new Date(val); const pad = (n) => n.toString().padStart(2,'0'); createdDiv.textContent = `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}` + (issue.created_by ? (' — ' + issue.created_by) : ''); } } else if (issue.created_by) { createdDiv.textContent = issue.created_by; }
        const btnRow = document.createElement('div'); btnRow.style.display='flex'; btnRow.style.gap='8px';
        const viewBtn = document.createElement('button'); viewBtn.className='btn'; viewBtn.textContent='View'; viewBtn.onclick = ()=>{ try{ if(window.showIssueModal) window.showIssueModal(issue); else showToast('Viewer not loaded'); }catch(e){ console.error(e); showToast('Unable to open issue'); } };
        const jumpBtn = document.createElement('button'); jumpBtn.className='btn'; jumpBtn.textContent='Jump to page'; jumpBtn.onclick = ()=>{ try{ const u = new URL(window.location.href); u.searchParams.set('plan_id', String(planId)); history.pushState({},'',u.toString()); if(window.startViewer){ window.startViewer().then(()=>{ if(window.viewerGoToPage) window.viewerGoToPage(Number(issue.page||1)); // open modal after short delay
              setTimeout(()=>{ if(window.showIssueModal) window.showIssueModal(issue); }, 600);
            }); } }catch(e){ console.error(e); } };
        const exportBtn = document.createElement('button'); exportBtn.className='btn'; exportBtn.textContent='Export PDF'; exportBtn.onclick = async ()=>{
          exportBtn.disabled = true; addSpinner(exportBtn);
          // hide/disable global download while generating
          if (downloadBtn) { downloadBtn.style.display = 'none'; downloadBtn.disabled = true; downloadBtn.onclick = null; }
          try{
            pdfOut.textContent = 'Generating PDF…';
            const r = await fetch('/api/export_report.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `plan_id=${encodeURIComponent(planId)}&issue_id=${encodeURIComponent(issue.id)}` });
            let data = null;
            try{ data = await r.json(); }catch(parseErr){ const txt = await r.text().catch(()=>null); console.error('export parse error, response text:', txt, parseErr); throw new Error(txt || 'Export failed (invalid JSON)'); }
            if (!r.ok || !data || !data.ok) {
              console.error('Export error response', r.status, data);
              throw new Error((data && data.error) ? data.error : (`Export failed (HTTP ${r.status})`));
            }
            if (downloadBtn) {
              downloadBtn.textContent = 'Download PDF';
              downloadBtn.style.display = '';
              downloadBtn.disabled = false;
              const url = '/storage/exports/' + encodeURIComponent(data.filename);
              downloadBtn.onclick = () => { window.open(url, '_blank'); };
              pdfOut.textContent = 'Ready: ' + data.filename;
            } else {
              pdfOut.innerHTML = `<a href="/storage/exports/${encodeURIComponent(data.filename)}" target="_blank">Download PDF</a>`;
            }
          }catch(e){
            console.error('Export failed', e); pdfOut.textContent = e.message || 'Export failed';
            // try debug retry
            try{
              const dbg = await fetch('/api/export_report.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `plan_id=${encodeURIComponent(planId)}&issue_id=${encodeURIComponent(issue.id)}&debug=1` });
              const dbgJson = await dbg.json().catch(()=>null);
              if(dbgJson && dbgJson.error) pdfOut.textContent += ' — Debug: ' + dbgJson.error;
              else if(dbgJson && dbgJson.exports) pdfOut.textContent += ' — Debug: ' + JSON.stringify(dbgJson.exports.slice(0,5));
            }catch(_){ /* ignore */ }
          }
          removeSpinner(exportBtn); exportBtn.disabled = false;
        };
        const saveBtn = document.createElement('button'); saveBtn.className='btnPrimary'; saveBtn.textContent='Save'; saveBtn.onclick = async ()=>{ saveBtn.disabled = true; try{ const payload = { id: issue.id, plan_id: planId, title: issue.title, notes: issue.notes, page: issue.page, x_norm: issue.x_norm, y_norm: issue.y_norm, status: statusSelect.value, priority: prioSelect.value }; const r = await fetch('/api/save_issue.php',{method:'POST',headers:{'Content-Type':'application/json'},body: JSON.stringify(payload), credentials:'same-origin'}); const txt = await r.text(); let resp; try{ resp = JSON.parse(txt); }catch{ resp = null; } if(!r.ok || !resp || !resp.ok) throw new Error((resp && resp.error) ? resp.error : 'Save failed'); showToast('Saved'); issue.status = statusSelect.value; issue.priority = prioSelect.value; }catch(err){ showToast('Save error: ' + err.message); } saveBtn.disabled = false; };
        btnRow.appendChild(viewBtn); btnRow.appendChild(jumpBtn); btnRow.appendChild(exportBtn); btnRow.appendChild(saveBtn);
        right.appendChild(metaRow); right.appendChild(assigneeSpan); right.appendChild(createdDiv); right.appendChild(btnRow);
        item.appendChild(left); item.appendChild(right); container.appendChild(item);
      }
      issuesList.appendChild(container);
    }catch(e){ issuesList.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`; }
  }
  // initial load
  loadIssuesList();
  // refresh thumbnails/counts when photosUpdated event fires for this plan
  const photosListener = (ev)=>{ loadIssuesList(); };
  document.addEventListener('photosUpdated', photosListener);

  // allow closing with ESC key
  const escKeyHandler = (ev) => { if (ev.key === 'Escape') { modal.style.display = 'none'; issuesList.innerHTML = ''; pdfOut.textContent = ''; document.removeEventListener('photosUpdated', photosListener); document.removeEventListener('keydown', escKeyHandler); } };
  document.addEventListener('keydown', escKeyHandler);

  // wire close button (X) to dismiss modal
  if (closeBtn){
    closeBtn.style.display = '';
    closeBtn.onclick = () => { modal.style.display = 'none'; issuesList.innerHTML = ''; pdfOut.textContent = ''; document.removeEventListener('photosUpdated', photosListener); document.removeEventListener('keydown', escKeyHandler); };
  }
  // clicking outside modal content will also close
  window.onclick = (event) => { if (event.target === modal) { modal.style.display = 'none'; issuesList.innerHTML = ''; pdfOut.textContent = ''; document.removeEventListener('photosUpdated', photosListener); document.removeEventListener('keydown', escKeyHandler); } };
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
    const planId = e?.detail?.planId;
    if (planId) wireViewIssues(planId);
  } catch (err) { console.error('planOpened handler error', err); }
});
