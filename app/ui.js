


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

  li.appendChild(left);
  li.appendChild(btn);
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
  });
}


async function renderPlansScreen() {
  setNetDot();
  window.addEventListener('online', setNetDot);
  window.addEventListener('offline', setNetDot);

  const menuBtn = $('#menuBtn');
  if (menuBtn) menuBtn.onclick = () => document.body.classList.toggle('sidebar-open');
  await wireUpload();
  await refreshPlans();
}
window.renderPlansScreen = renderPlansScreen;

// --- Issues Modal Logic ---
function showIssuesModal(planId) {
  const modal = document.getElementById('issuesModal');
  const closeBtn = document.getElementById('closeIssuesModal');
  const issuesList = document.getElementById('issuesList');
  const pdfBtn = document.getElementById('btnGeneratePdf');
  const pdfOut = document.getElementById('pdfReportOut');
  const modalTitle = modal ? modal.querySelector('h2') : null;
  if (!modal || !issuesList || !pdfBtn || !pdfOut) return;

  // hide the close 'x' button as per UX requirement (modal should not close via X)
  if (closeBtn) closeBtn.style.display = 'none';

  modal.style.display = 'block';
  issuesList.innerHTML = '<div class="muted">Loading…</div>';
  pdfOut.textContent = '';

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
        const right = document.createElement('div'); right.style.display = 'flex'; right.style.flexDirection = 'column'; right.style.alignItems = 'flex-end'; right.style.gap = '6px';
        const metaRow = document.createElement('div'); metaRow.style.display = 'flex'; metaRow.style.gap = '8px'; metaRow.style.alignItems = 'center';
        const statusSelect = document.createElement('select'); statusSelect.style.minWidth='110px'; statusSelect.innerHTML = '<option value="open">Open</option><option value="in_progress">In Progress</option><option value="resolved">Resolved</option><option value="closed">Closed</option>'; statusSelect.value = issue.status || 'open';
        const prioSelect = document.createElement('select'); prioSelect.style.minWidth='90px'; prioSelect.innerHTML = '<option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>'; prioSelect.value = issue.priority || 'medium';
        metaRow.appendChild(statusSelect); metaRow.appendChild(prioSelect);
        const assigneeSpan = document.createElement('div'); assigneeSpan.style.fontSize='12px'; assigneeSpan.style.color='var(--muted)'; assigneeSpan.textContent = issue.assignee || '';
        const phs = photosMap[String(issue.id)] || [];
        if(phs.length){ const thumbsWrap = document.createElement('div'); thumbsWrap.style.display='flex'; thumbsWrap.style.gap='6px'; thumbsWrap.style.marginTop='6px'; for(let i=0;i<Math.min(3, phs.length); i++){ const p = phs[i]; const img = document.createElement('img'); img.src = p.thumb_url || p.url; img.style.width='48px'; img.style.height='48px'; img.style.objectFit='cover'; img.style.borderRadius='6px'; img.style.cursor='pointer'; img.onclick = ()=>{ window.open(p.url || p.thumb_url, '_blank'); }; thumbsWrap.appendChild(img); } const countBadge = document.createElement('span'); countBadge.className='pill'; countBadge.textContent = String(phs.length) + ' photos'; countBadge.style.fontSize='12px'; countBadge.style.marginLeft='6px'; left.appendChild(thumbsWrap); left.appendChild(countBadge); }
        const createdDiv = document.createElement('div'); createdDiv.style.fontSize = '12px'; createdDiv.style.color = 'var(--muted)'; if (issue.created_at) { const d = new Date(issue.created_at); const pad = (n) => n.toString().padStart(2,'0'); createdDiv.textContent = `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}` + (issue.created_by ? (' — ' + issue.created_by) : ''); } else if (issue.created_by) { createdDiv.textContent = issue.created_by; }
        const btnRow = document.createElement('div'); btnRow.style.display='flex'; btnRow.style.gap='8px';
        const viewBtn = document.createElement('button'); viewBtn.className='btn'; viewBtn.textContent='View'; viewBtn.onclick = ()=>{ try{ if(window.showIssueModal) window.showIssueModal(issue); else showToast('Viewer not loaded'); }catch(e){ console.error(e); showToast('Unable to open issue'); } };
        const jumpBtn = document.createElement('button'); jumpBtn.className='btn'; jumpBtn.textContent='Jump to page'; jumpBtn.onclick = ()=>{ try{ const u = new URL(window.location.href); u.searchParams.set('plan_id', String(planId)); history.pushState({},'',u.toString()); if(window.startViewer){ window.startViewer().then(()=>{ if(window.viewerGoToPage) window.viewerGoToPage(Number(issue.page||1)); // open modal after short delay
              setTimeout(()=>{ if(window.showIssueModal) window.showIssueModal(issue); }, 600);
            }); } }catch(e){ console.error(e); } };
        const exportBtn = document.createElement('button'); exportBtn.className='btn'; exportBtn.textContent='Export PDF'; exportBtn.onclick = async ()=>{ exportBtn.disabled = true; try{ pdfOut.textContent = 'Generating PDF…'; const r = await fetch('/api/export_report.php', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `plan_id=${encodeURIComponent(planId)}&issue_id=${encodeURIComponent(issue.id)}` }); const data = await r.json(); if(!r.ok || !data || !data.ok) throw new Error(data && data.error ? data.error : 'Export failed'); pdfOut.innerHTML = `<a href="/storage/exports/${encodeURIComponent(data.filename)}" target="_blank">Download PDF</a>`; }catch(e){ pdfOut.textContent = e.message; } exportBtn.disabled = false; };
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
  document.addEventListener('photosUpdated', photosListener);}

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
